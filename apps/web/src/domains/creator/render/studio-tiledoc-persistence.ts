/**
 * Serialization plan for the tiled document.
 *
 * Persistence is **content addressed**: a blob key is derived from the tile payload's digest, so
 * copy-on-write sharing survives the round trip — ten undo snapshots that share a tile write one
 * blob, and the manifest references it ten times. Without content addressing, spilling history to
 * disk would re-introduce exactly the multiplication that copy-on-write removed in RAM.
 *
 * The blob store itself is **not implemented here and not imported**. `StudioTileDocBlobStore` is
 * the contract an OPFS-backed implementation (`studio-opfs-*`, owned by another slice) must
 * satisfy: four async primitives, no transactions, no ordering assumptions beyond "a `put` that
 * resolved is readable". Everything in this module below `runStudioTileDocPersist` is pure
 * planning, so the plan can be computed on the commit path and executed off it.
 *
 * Layout:
 *   tiledoc/{documentId}/tiles/{digest}.bin      raw tile payload, STUDIO_TILEDOC_TILE_FORMAT
 *   tiledoc/{documentId}/manifest.json           canonical JSON, see StudioTileDocManifest
 */

import { isStudioTileDocDigest } from "./studio-tiledoc-digest";

export const STUDIO_TILEDOC_MANIFEST_VERSION = 1;

export interface StudioTileDocBlobStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(keys: readonly string[]): Promise<void>;
  list(prefix: string): Promise<readonly string[]>;
}

export interface StudioTileDocManifestTile {
  readonly tileId: string;
  readonly digest: string;
}

export interface StudioTileDocManifestLayer {
  readonly layerId: string;
  readonly tiles: readonly StudioTileDocManifestTile[];
}

export interface StudioTileDocManifestFrame {
  /** `"current"` for the live document, otherwise the snapshot id. */
  readonly id: string;
  readonly sequence: number;
  readonly label: string;
  readonly layers: readonly StudioTileDocManifestLayer[];
}

export interface StudioTileDocManifest {
  readonly version: number;
  readonly documentId: string;
  readonly tileSize: number;
  readonly format: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly frames: readonly StudioTileDocManifestFrame[];
}

export interface StudioTileDocPersistWrite {
  readonly key: string;
  readonly digest: string;
  readonly bufferId: number;
  readonly byteLength: number;
}

export interface StudioTileDocPersistPlan {
  readonly manifest: StudioTileDocManifest;
  readonly manifestKey: string;
  /** Blobs that must be written. Deduplicated by digest — shared tiles appear once. */
  readonly writes: readonly StudioTileDocPersistWrite[];
  /** Buffers skipped because an identical blob is already durable. */
  readonly skippedBufferIds: readonly number[];
  /** Buffers whose digest could not be resolved (evicted with no cached digest). */
  readonly unresolvedBufferIds: readonly number[];
  readonly writeBytes: number;
  /** Bytes the same content would have cost without digest deduplication. */
  readonly naiveWriteBytes: number;
}

export interface StudioTileDocPersistFrameInput {
  readonly id: string;
  readonly sequence: number;
  readonly label?: string;
  readonly layers: readonly {
    readonly layerId: string;
    readonly tiles: readonly { readonly tileId: string; readonly bufferId: number }[];
  }[];
}

export interface StudioTileDocPersistInput {
  readonly documentId: string;
  readonly tileSize: number;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly format: string;
  readonly frames: readonly StudioTileDocPersistFrameInput[];
  /** Digest lookup, normally `store.bufferDigest`. Returning null defers that buffer. */
  readonly digestOf: (bufferId: number) => string | null;
  readonly byteLengthOf: (bufferId: number) => number;
  /** Blob keys already durable, so an unchanged tile is not rewritten. */
  readonly durableKeys?: Iterable<string>;
}

export function studioTileDocTileBlobKey(documentId: string, digest: string): string {
  return `tiledoc/${documentId}/tiles/${digest}.bin`;
}

export function studioTileDocManifestKey(documentId: string): string {
  return `tiledoc/${documentId}/manifest.json`;
}

export function studioTileDocTilePrefix(documentId: string): string {
  return `tiledoc/${documentId}/tiles/`;
}

/**
 * Builds the manifest and the deduplicated write set for the current document plus every live
 * snapshot. Pure: no I/O, no mutation of the inputs.
 */
export function planStudioTileDocPersist(
  input: StudioTileDocPersistInput
): StudioTileDocPersistPlan {
  const durable = new Set<string>(input.durableKeys ?? []);
  const writesByDigest = new Map<string, StudioTileDocPersistWrite>();
  const skipped = new Set<number>();
  const unresolved = new Set<number>();
  const frames: StudioTileDocManifestFrame[] = [];
  let naiveWriteBytes = 0;

  for (const frame of [...input.frames].sort((left, right) => (
    left.sequence - right.sequence || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  ))) {
    const layers: StudioTileDocManifestLayer[] = [];
    for (const layer of [...frame.layers].sort((left, right) => (
      left.layerId < right.layerId ? -1 : left.layerId > right.layerId ? 1 : 0
    ))) {
      const tiles: StudioTileDocManifestTile[] = [];
      for (const tile of [...layer.tiles].sort((left, right) => (
        left.tileId < right.tileId ? -1 : left.tileId > right.tileId ? 1 : 0
      ))) {
        const digest = input.digestOf(tile.bufferId);
        if (!digest || !isStudioTileDocDigest(digest)) {
          unresolved.add(tile.bufferId);
          continue;
        }
        tiles.push(Object.freeze({ tileId: tile.tileId, digest }));
        const byteLength = input.byteLengthOf(tile.bufferId);
        naiveWriteBytes += byteLength;
        const key = studioTileDocTileBlobKey(input.documentId, digest);
        if (durable.has(key)) {
          skipped.add(tile.bufferId);
          continue;
        }
        if (writesByDigest.has(digest)) {
          skipped.add(tile.bufferId);
          continue;
        }
        writesByDigest.set(digest, Object.freeze({
          key,
          digest,
          bufferId: tile.bufferId,
          byteLength,
        }));
      }
      layers.push(Object.freeze({ layerId: layer.layerId, tiles: Object.freeze(tiles) }));
    }
    frames.push(Object.freeze({
      id: frame.id,
      sequence: frame.sequence,
      label: frame.label ?? "",
      layers: Object.freeze(layers),
    }));
  }

  const writes = [...writesByDigest.values()].sort((left, right) => (
    left.digest < right.digest ? -1 : left.digest > right.digest ? 1 : 0
  ));
  const writeBytes = writes.reduce((total, write) => total + write.byteLength, 0);
  const manifest: StudioTileDocManifest = Object.freeze({
    version: STUDIO_TILEDOC_MANIFEST_VERSION,
    documentId: input.documentId,
    tileSize: input.tileSize,
    format: input.format,
    documentWidth: input.documentWidth,
    documentHeight: input.documentHeight,
    frames: Object.freeze(frames),
  });

  return Object.freeze({
    manifest,
    manifestKey: studioTileDocManifestKey(input.documentId),
    writes: Object.freeze(writes),
    skippedBufferIds: Object.freeze([...skipped].sort((left, right) => left - right)),
    unresolvedBufferIds: Object.freeze([...unresolved].sort((left, right) => left - right)),
    writeBytes,
    naiveWriteBytes,
  });
}

/** Canonical JSON — key order is fixed so an unchanged document serializes byte-identically. */
export function serializeStudioTileDocManifest(manifest: StudioTileDocManifest): string {
  return JSON.stringify({
    version: manifest.version,
    documentId: manifest.documentId,
    tileSize: manifest.tileSize,
    format: manifest.format,
    documentWidth: manifest.documentWidth,
    documentHeight: manifest.documentHeight,
    frames: manifest.frames.map((frame) => ({
      id: frame.id,
      sequence: frame.sequence,
      label: frame.label,
      layers: frame.layers.map((layer) => ({
        layerId: layer.layerId,
        tiles: layer.tiles.map((tile) => ({ tileId: tile.tileId, digest: tile.digest })),
      })),
    })),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseStudioTileDocManifest(text: string): StudioTileDocManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.version !== STUDIO_TILEDOC_MANIFEST_VERSION) return null;
  if (typeof parsed.documentId !== "string" || parsed.documentId.length === 0) return null;
  if (!Number.isSafeInteger(parsed.tileSize) || (parsed.tileSize as number) <= 0) return null;
  if (typeof parsed.format !== "string") return null;
  if (!Array.isArray(parsed.frames)) return null;

  const frames: StudioTileDocManifestFrame[] = [];
  for (const rawFrame of parsed.frames) {
    if (!isRecord(rawFrame) || typeof rawFrame.id !== "string") return null;
    const sequence = rawFrame.sequence;
    if (typeof sequence !== "number" || !Number.isSafeInteger(sequence)) return null;
    if (!Array.isArray(rawFrame.layers)) return null;
    const layers: StudioTileDocManifestLayer[] = [];
    for (const rawLayer of rawFrame.layers) {
      if (!isRecord(rawLayer) || typeof rawLayer.layerId !== "string") return null;
      if (!Array.isArray(rawLayer.tiles)) return null;
      const tiles: StudioTileDocManifestTile[] = [];
      for (const rawTile of rawLayer.tiles) {
        if (!isRecord(rawTile) || typeof rawTile.tileId !== "string") return null;
        if (!isStudioTileDocDigest(rawTile.digest)) return null;
        tiles.push(Object.freeze({ tileId: rawTile.tileId, digest: rawTile.digest }));
      }
      layers.push(Object.freeze({ layerId: rawLayer.layerId, tiles: Object.freeze(tiles) }));
    }
    frames.push(Object.freeze({
      id: rawFrame.id,
      sequence,
      label: typeof rawFrame.label === "string" ? rawFrame.label : "",
      layers: Object.freeze(layers),
    }));
  }
  return Object.freeze({
    version: STUDIO_TILEDOC_MANIFEST_VERSION,
    documentId: parsed.documentId,
    tileSize: parsed.tileSize as number,
    format: parsed.format,
    documentWidth: Number(parsed.documentWidth) || 0,
    documentHeight: Number(parsed.documentHeight) || 0,
    frames: Object.freeze(frames),
  });
}

export interface StudioTileDocHydrationRequest {
  readonly key: string;
  readonly digest: string;
  readonly tileId: string;
  readonly layerId: string;
  /** 0 = inside the viewport, 1 = rest of the frame. Sorted ascending. */
  readonly priority: number;
}

export interface StudioTileDocHydrationInput {
  readonly manifest: StudioTileDocManifest;
  /** Frame to open — `"current"` or a snapshot id. */
  readonly frameId: string;
  readonly viewportTileIds?: Iterable<string>;
  /** Digests already decoded in RAM. */
  readonly presentDigests?: Iterable<string>;
  readonly layerIds?: readonly string[];
}

/**
 * Ordered blob fetches to open a frame: viewport tiles first, deduplicated by digest so a tile
 * shared across layers or snapshots is fetched once.
 */
export function planStudioTileDocHydration(
  input: StudioTileDocHydrationInput
): readonly StudioTileDocHydrationRequest[] {
  const frame = input.manifest.frames.find((candidate) => candidate.id === input.frameId);
  if (!frame) return Object.freeze([]);
  const viewport = new Set<string>(input.viewportTileIds ?? []);
  const present = new Set<string>(input.presentDigests ?? []);
  const allowLayer = input.layerIds ? new Set(input.layerIds) : null;
  const seen = new Set<string>();
  const requests: StudioTileDocHydrationRequest[] = [];
  for (const layer of frame.layers) {
    if (allowLayer && !allowLayer.has(layer.layerId)) continue;
    for (const tile of layer.tiles) {
      if (present.has(tile.digest) || seen.has(tile.digest)) continue;
      seen.add(tile.digest);
      requests.push(Object.freeze({
        key: studioTileDocTileBlobKey(input.manifest.documentId, tile.digest),
        digest: tile.digest,
        tileId: tile.tileId,
        layerId: layer.layerId,
        priority: viewport.has(tile.tileId) ? 0 : 1,
      }));
    }
  }
  requests.sort((left, right) => (
    left.priority - right.priority
    || (left.tileId < right.tileId ? -1 : left.tileId > right.tileId ? 1 : 0)
    || (left.digest < right.digest ? -1 : left.digest > right.digest ? 1 : 0)
  ));
  return Object.freeze(requests);
}

/** Blob keys no live frame references any more — safe to delete after the manifest is written. */
export function planStudioTileDocGarbageCollection(
  manifest: StudioTileDocManifest,
  existingKeys: Iterable<string>
): readonly string[] {
  const referenced = new Set<string>();
  for (const frame of manifest.frames) {
    for (const layer of frame.layers) {
      for (const tile of layer.tiles) {
        referenced.add(studioTileDocTileBlobKey(manifest.documentId, tile.digest));
      }
    }
  }
  const prefix = studioTileDocTilePrefix(manifest.documentId);
  const orphans: string[] = [];
  for (const key of existingKeys) {
    if (!key.startsWith(prefix)) continue;
    if (!referenced.has(key)) orphans.push(key);
  }
  return Object.freeze(orphans.sort());
}

export interface StudioTileDocPersistOutcome {
  readonly written: readonly string[];
  readonly failed: readonly { readonly key: string; readonly reason: string }[];
  readonly manifestWritten: boolean;
}

/**
 * Executes a plan against any store satisfying `StudioTileDocBlobStore`. The manifest is written
 * **last**: a manifest may only reference blobs that already landed, so a crash mid-flush leaves
 * unreferenced blobs (collectable) rather than a manifest pointing at missing tiles.
 */
export async function runStudioTileDocPersist(
  plan: StudioTileDocPersistPlan,
  blobStore: StudioTileDocBlobStore,
  bytesOf: (bufferId: number) => Uint8Array | Uint8ClampedArray | null
): Promise<StudioTileDocPersistOutcome> {
  const written: string[] = [];
  const failed: { key: string; reason: string }[] = [];
  for (const write of plan.writes) {
    const source = bytesOf(write.bufferId);
    if (!source) {
      failed.push({ key: write.key, reason: "buffer-unavailable" });
      continue;
    }
    const bytes = source instanceof Uint8Array
      ? source
      : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    try {
      await blobStore.put(write.key, bytes);
      written.push(write.key);
    } catch (error) {
      failed.push({ key: write.key, reason: error instanceof Error ? error.message : "put-failed" });
    }
  }
  let manifestWritten = false;
  if (failed.length === 0) {
    try {
      await blobStore.put(
        plan.manifestKey,
        new TextEncoder().encode(serializeStudioTileDocManifest(plan.manifest))
      );
      manifestWritten = true;
    } catch (error) {
      failed.push({
        key: plan.manifestKey,
        reason: error instanceof Error ? error.message : "put-failed",
      });
    }
  }
  return Object.freeze({
    written: Object.freeze(written),
    failed: Object.freeze(failed),
    manifestWritten,
  });
}
