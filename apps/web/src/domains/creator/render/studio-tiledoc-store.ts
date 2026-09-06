/**
 * Sparse, copy-on-write tiled document store.
 *
 * Replaces "one full-page bitmap per layer, one full-page bitmap per undo step" with:
 *
 * - **Sparse allocation.** A layer owns only the tiles that hold non-transparent pixels. An empty
 *   document allocates nothing; a 40px stroke on a 4000×6000 page allocates one 1 MiB tile instead
 *   of a 91.5 MiB layer bitmap. Writes that leave a tile fully transparent are pruned back out.
 *
 * - **Copy-on-write history.** A snapshot is O(layer count): it retains the current per-layer tile
 *   maps instead of copying pixels. The first write into a layer after a snapshot clones that
 *   layer's *map* (pointer copies only), and the first write into a tile whose buffer is visible to
 *   more than one map clones that *tile* (1 MiB). So N snapshots with a k-tile edit each cost
 *   `base + N*k` tiles, not `base * (N+1)`.
 *
 * - **Residency.** Buffers carry byte accounting and an access sequence so
 *   `studio-tiledoc-residency` can evict decoded pixels under a budget. Eviction is only legal for
 *   a buffer that has been persisted (`markPersisted`), which is the hard interlock that stops
 *   eviction from destroying undo data.
 *
 * Everything here is synchronous, allocation-explicit and free of DOM/GPU access so it can be
 * exercised headlessly. Presentation stays with `studio-webgpu-tile-runtime`; this module is the
 * storage/editing authority that feeds it.
 */

import { studioTileDocDigest, type StudioTileDocDigestFn } from "./studio-tiledoc-digest";
import {
  intersectStudioTileDocRects,
  resolveStudioTileDocTileSize,
  studioTileDocTileId,
  studioTileDocTileRect,
  studioTileDocTileSpan,
  studioTileDocTilesForRect,
  type StudioTileDocRect,
} from "./studio-tiledoc-geometry";

import type { StudioTileDocDirtyRegion } from "./studio-tiledoc-dirty";

export type StudioTileDocWriteStatus =
  | "written"
  | "pruned"
  | "evicted"
  | "out-of-bounds";

export interface StudioTileDocWriteContext {
  readonly layerId: string;
  readonly tileId: string;
  readonly column: number;
  readonly row: number;
  readonly tileSize: number;
  /** Document coordinate of this tile's pixel (0, 0). */
  readonly originX: number;
  readonly originY: number;
  /** True when the buffer handed to the writer was freshly zero-filled. */
  readonly allocated: boolean;
  /** Dirty sub-rect in document coordinates, or the whole tile for a direct write. */
  readonly rect: StudioTileDocRect;
}

export type StudioTileDocTileWriter = (
  pixels: Uint8ClampedArray,
  context: StudioTileDocWriteContext
) => void;

export interface StudioTileDocWriteResult {
  readonly tileId: string;
  readonly column: number;
  readonly row: number;
  readonly status: StudioTileDocWriteStatus;
  /** A zero-filled buffer was created for this write. */
  readonly allocated: boolean;
  /** A shared buffer was cloned before the write (copy-on-write). */
  readonly copied: boolean;
  readonly bufferId: number | null;
}

export interface StudioTileDocRegionWriteResult {
  readonly results: readonly StudioTileDocWriteResult[];
  readonly written: number;
  readonly allocated: number;
  readonly copied: number;
  readonly pruned: number;
  readonly evicted: number;
}

export interface StudioTileDocSnapshot {
  readonly id: string;
  readonly label: string;
  readonly sequence: number;
  /** Internal retained tile maps. Treat as opaque; mutation breaks undo correctness. */
  readonly layers: ReadonlyMap<string, StudioTileDocLayerTiles>;
}

export interface StudioTileDocTileRef {
  readonly id: string;
  readonly column: number;
  readonly row: number;
  readonly bufferId: number;
}

export interface StudioTileDocLayerTiles {
  readonly tiles: Map<string, StudioTileDocTileRef>;
  refCount: number;
}

export interface StudioTileDocStoreOptions {
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly tileSize?: number;
  /** Drop tiles that a write left fully transparent. Default true. */
  readonly autoPrune?: boolean;
  /** Permit tiles outside the document extent (bleed authoring). Default false. */
  readonly allowOutOfBounds?: boolean;
  readonly digest?: StudioTileDocDigestFn;
}

export interface StudioTileDocStats {
  readonly layerCount: number;
  readonly snapshotCount: number;
  /** Tile references held by the current document across all layers. */
  readonly currentTileCount: number;
  /** Distinct pixel buffers alive across the current document *and* every live snapshot. */
  readonly distinctBufferCount: number;
  /** Bytes of buffers whose pixels are decoded in RAM right now. */
  readonly residentBytes: number;
  /** Bytes of every alive buffer, counting evicted ones at their uncompressed size. */
  readonly retainedBytes: number;
  readonly copyOnWriteCopies: number;
  readonly layerMapCopies: number;
  readonly allocations: number;
  readonly prunes: number;
  readonly evictions: number;
}

export interface StudioTileDocViewportTile {
  readonly layerId: string;
  readonly id: string;
  readonly column: number;
  readonly row: number;
  /** Tile rect clipped to the document extent. */
  readonly rect: StudioTileDocRect;
  readonly bufferId: number;
  /**
   * Monotonic content identity for this buffer. An in-place write keeps `bufferId` stable but
   * advances this revision, allowing retained compositors to invalidate exactly one tile.
   */
  readonly contentRevision: number;
  readonly resident: boolean;
}

/**
 * Detached, revision-fenced pixels for an asynchronous renderer or persistence consumer.
 *
 * `pixels` is a private copy: consumers may transfer or mutate it without reaching back into the
 * copy-on-write store. The store returns `null` when the requested revision is stale or evicted,
 * so a compositor can fail closed instead of uploading bytes under the wrong tile identity.
 */
export interface StudioTileDocBufferSnapshot {
  readonly bufferId: number;
  readonly contentRevision: number;
  readonly byteLength: number;
  readonly pixels: Uint8ClampedArray;
}

export interface StudioTileDocViewportOptions {
  /** Restrict and order the result by these layers. Default: all layers in insertion order. */
  readonly layerIds?: readonly string[];
}

export interface StudioTileDocViewportCacheStats {
  /** Exact ordered viewport result reused without rebuilding or concatenating layer feeds. */
  readonly compositeHits: number;
  /** Per-layer viewport feeds reused across visibility/order changes. */
  readonly layerHits: number;
  /** Overlapping immutable tile descriptors reused while a changed layer feed was rebuilt. */
  readonly descriptorReuses: number;
  /** Tile-address geometry reused while the viewport stayed inside the same storage-tile span. */
  readonly geometryHits: number;
}

export interface StudioTileDocResidencyDescriptor {
  readonly bufferId: number;
  readonly byteLength: number;
  readonly resident: boolean;
  readonly lastUsed: number;
  /**
   * Protected for this frame — normally the viewport working set. Being referenced by the current
   * document is *not* enough: an offscreen tile of a 100,000px strip must stay evictable, which is
   * the whole point of virtualising the document.
   */
  readonly pinned: boolean;
  /** Referenced only by history snapshots. */
  readonly historyOnly: boolean;
  /** Has a durable blob key, so its pixels can be dropped and fetched back. */
  readonly persisted: boolean;
}

/** Frame id used for the live document in a persistence manifest. */
export const STUDIO_TILEDOC_CURRENT_FRAME_ID = "current";

export interface StudioTileDocFrameLayerDescription {
  readonly layerId: string;
  readonly tiles: readonly { readonly tileId: string; readonly bufferId: number }[];
}

export interface StudioTileDocFrameDescription {
  readonly id: string;
  readonly sequence: number;
  readonly label: string;
  readonly layers: readonly StudioTileDocFrameLayerDescription[];
}

function describeFrame(
  id: string,
  sequence: number,
  label: string,
  layers: ReadonlyMap<string, StudioTileDocLayerTiles>
): StudioTileDocFrameDescription {
  const described: StudioTileDocFrameLayerDescription[] = [];
  for (const [layerId, layer] of layers) {
    const tiles = [...layer.tiles.values()]
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((ref) => Object.freeze({ tileId: ref.id, bufferId: ref.bufferId }));
    described.push(Object.freeze({ layerId, tiles: Object.freeze(tiles) }));
  }
  return Object.freeze({ id, sequence, label, layers: Object.freeze(described) });
}

interface TileBuffer {
  readonly id: number;
  readonly byteLength: number;
  pixels: Uint8ClampedArray | null;
  /** Advances after every accepted write, including in-place edits that keep this buffer id. */
  contentRevision: number;
  /** Number of layer tile maps (current + snapshots) referencing this buffer. */
  refCount: number;
  lastUsed: number;
  blobKey: string | null;
  digest: string | null;
}

interface ViewportGeometryCache {
  readonly key: string;
  readonly addresses: ReturnType<typeof studioTileDocTilesForRect>;
}

interface LayerViewportCacheEntry {
  readonly geometryKey: string;
  readonly layerRevision: number;
  readonly residencyEpoch: number;
  readonly tiles: readonly StudioTileDocViewportTile[];
}

interface CompositeViewportCacheEntry {
  readonly geometryKey: string;
  readonly layerIds: readonly string[];
  readonly layerRevisions: readonly number[];
  readonly residencyEpoch: number;
  readonly tiles: readonly StudioTileDocViewportTile[];
}

const EMPTY_VIEWPORT_TILES = Object.freeze([]) as readonly StudioTileDocViewportTile[];

function isFullyTransparent(pixels: Uint8ClampedArray): boolean {
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 0) return false;
  }
  return true;
}

function positiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const floored = Math.floor(value);
  return floored > 0 ? floored : fallback;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameViewportTile(
  tile: StudioTileDocViewportTile,
  layerId: string,
  buffer: TileBuffer,
  rect: StudioTileDocRect
): boolean {
  return tile.layerId === layerId
    && tile.bufferId === buffer.id
    && tile.contentRevision === buffer.contentRevision
    && tile.resident === (buffer.pixels !== null)
    && Object.is(tile.rect.x, rect.x)
    && Object.is(tile.rect.y, rect.y)
    && Object.is(tile.rect.width, rect.width)
    && Object.is(tile.rect.height, rect.height);
}

export class StudioTiledDocumentStore {
  public readonly tileSize: number;
  public readonly documentWidth: number;
  public readonly documentHeight: number;

  private readonly autoPrune: boolean;
  private readonly allowOutOfBounds: boolean;
  private readonly digestFn: StudioTileDocDigestFn;
  private readonly tileBytes: number;

  private readonly layers = new Map<string, StudioTileDocLayerTiles>();
  private readonly pool = new Map<number, TileBuffer>();
  private readonly snapshots = new Map<string, StudioTileDocSnapshot>();
  /** One bounded viewport feed per layer; entries are replaced on pan/zoom, never accumulated. */
  private readonly layerViewportCache = new Map<string, LayerViewportCacheEntry>();
  private readonly layerRevisions = new Map<string, number>();

  private nextBufferId = 1;
  private nextSnapshotSequence = 1;
  private nextContentRevision = 1;
  private accessSequence = 0;
  private residentBytesValue = 0;
  private retainedBytesValue = 0;
  private copyOnWriteCopies = 0;
  private layerMapCopies = 0;
  private allocations = 0;
  private prunes = 0;
  private evictions = 0;
  private residencyEpoch = 0;
  private viewportGeometryCache: ViewportGeometryCache | null = null;
  private compositeViewportCache: CompositeViewportCacheEntry | null = null;
  private viewportCompositeHits = 0;
  private viewportLayerHits = 0;
  private viewportDescriptorReuses = 0;
  private viewportGeometryHits = 0;

  public constructor(options: StudioTileDocStoreOptions) {
    this.tileSize = resolveStudioTileDocTileSize(options.tileSize);
    this.documentWidth = positiveInteger(options.documentWidth, 1);
    this.documentHeight = positiveInteger(options.documentHeight, 1);
    this.autoPrune = options.autoPrune !== false;
    this.allowOutOfBounds = options.allowOutOfBounds === true;
    this.digestFn = options.digest ?? studioTileDocDigest;
    this.tileBytes = this.tileSize * this.tileSize * 4;
  }

  // ── statistics ────────────────────────────────────────────────────────────

  public stats(): StudioTileDocStats {
    let currentTileCount = 0;
    for (const layer of this.layers.values()) currentTileCount += layer.tiles.size;
    return Object.freeze({
      layerCount: this.layers.size,
      snapshotCount: this.snapshots.size,
      currentTileCount,
      distinctBufferCount: this.pool.size,
      residentBytes: this.residentBytesValue,
      retainedBytes: this.retainedBytesValue,
      copyOnWriteCopies: this.copyOnWriteCopies,
      layerMapCopies: this.layerMapCopies,
      allocations: this.allocations,
      prunes: this.prunes,
      evictions: this.evictions,
    });
  }

  /** Headless profiling counters for proving that presentation planning stays incremental. */
  public viewportCacheStats(): StudioTileDocViewportCacheStats {
    return Object.freeze({
      compositeHits: this.viewportCompositeHits,
      layerHits: this.viewportLayerHits,
      descriptorReuses: this.viewportDescriptorReuses,
      geometryHits: this.viewportGeometryHits,
    });
  }

  public layerTileCount(layerId: string): number {
    return this.layers.get(layerId)?.tiles.size ?? 0;
  }

  public layerIds(): readonly string[] {
    return Object.freeze([...this.layers.keys()]);
  }

  public bufferIdAt(layerId: string, column: number, row: number): number | null {
    const ref = this.layers.get(layerId)?.tiles.get(studioTileDocTileId(column, row));
    return ref ? ref.bufferId : null;
  }

  // ── editing ───────────────────────────────────────────────────────────────

  public writeTile(
    layerId: string,
    column: number,
    row: number,
    writer: StudioTileDocTileWriter,
    rect?: StudioTileDocRect
  ): StudioTileDocWriteResult {
    const tileId = studioTileDocTileId(column, row);
    if (!this.isTileInBounds(column, row)) {
      return this.result(tileId, column, row, "out-of-bounds", false, false, null);
    }
    const layer = this.ensureWritableLayer(layerId);
    const existing = layer.tiles.get(tileId);
    let buffer: TileBuffer;
    let allocated = false;
    let copied = false;

    if (!existing) {
      buffer = this.allocateBuffer();
      allocated = true;
    } else {
      const current = this.pool.get(existing.bufferId);
      if (!current || current.pixels === null) {
        return this.result(tileId, column, row, "evicted", false, false, existing.bufferId);
      }
      if (current.refCount > 1) {
        buffer = this.cloneBuffer(current);
        copied = true;
      } else {
        buffer = current;
      }
    }

    const pixels = buffer.pixels;
    /* c8 ignore next */
    if (!pixels) return this.result(tileId, column, row, "evicted", false, false, buffer.id);
    this.accessSequence += 1;
    buffer.lastUsed = this.accessSequence;
    writer(pixels, Object.freeze({
      layerId,
      tileId,
      column,
      row,
      tileSize: this.tileSize,
      originX: column * this.tileSize,
      originY: row * this.tileSize,
      allocated,
      rect: rect ?? studioTileDocTileRect(column, row, this.tileSize),
    }));
    buffer.contentRevision = this.nextContentRevision;
    this.nextContentRevision = this.nextContentRevision >= Number.MAX_SAFE_INTEGER
      ? 1
      : this.nextContentRevision + 1;
    this.bumpLayerRevision(layerId);
    // Content changed: any cached identity is stale until re-derived.
    buffer.digest = null;
    buffer.blobKey = null;

    if (this.autoPrune && isFullyTransparent(pixels)) {
      this.prunes += 1;
      if (allocated || copied) this.discardBuffer(buffer);
      if (existing) {
        layer.tiles.delete(tileId);
        this.releaseBuffer(existing.bufferId);
      }
      return this.result(tileId, column, row, "pruned", allocated, copied, null);
    }

    if (allocated || copied) {
      layer.tiles.set(tileId, Object.freeze({ id: tileId, column, row, bufferId: buffer.id }));
      if (existing) this.releaseBuffer(existing.bufferId);
      buffer.refCount = 1;
    }
    return this.result(tileId, column, row, "written", allocated, copied, buffer.id);
  }

  /** Applies one writer across every tile a coalesced dirty region touches. */
  public applyRegion(
    layerId: string,
    region: StudioTileDocDirtyRegion,
    writer: StudioTileDocTileWriter
  ): StudioTileDocRegionWriteResult {
    const results: StudioTileDocWriteResult[] = [];
    let written = 0;
    let allocated = 0;
    let copied = 0;
    let pruned = 0;
    let evicted = 0;
    for (const tile of region.tiles) {
      const result = this.writeTile(layerId, tile.column, tile.row, writer, tile.rect);
      results.push(result);
      if (result.allocated) allocated += 1;
      if (result.copied) copied += 1;
      if (result.status === "written") written += 1;
      else if (result.status === "pruned") pruned += 1;
      else if (result.status === "evicted") evicted += 1;
    }
    return Object.freeze({
      results: Object.freeze(results),
      written,
      allocated,
      copied,
      pruned,
      evicted,
    });
  }

  public deleteTile(layerId: string, column: number, row: number): boolean {
    const layer = this.layers.get(layerId);
    if (!layer) return false;
    const tileId = studioTileDocTileId(column, row);
    if (!layer.tiles.has(tileId)) return false;
    const writable = this.ensureWritableLayer(layerId);
    const ref = writable.tiles.get(tileId);
    if (!ref) return false;
    writable.tiles.delete(tileId);
    this.releaseBuffer(ref.bufferId);
    this.bumpLayerRevision(layerId);
    return true;
  }

  /** Drops every tile fully covered by the rect. Partially covered tiles are left alone. */
  public clearRegion(layerId: string, rect: StudioTileDocRect): number {
    const layer = this.layers.get(layerId);
    if (!layer || layer.tiles.size === 0) return 0;
    const addresses = studioTileDocTilesForRect(rect, { tileSize: this.tileSize });
    let removed = 0;
    for (const address of addresses) {
      const tileRect = studioTileDocTileRect(address.column, address.row, this.tileSize);
      const overlap = intersectStudioTileDocRects(tileRect, rect);
      if (!overlap || overlap.width < this.tileSize || overlap.height < this.tileSize) continue;
      if (this.deleteTile(layerId, address.column, address.row)) removed += 1;
    }
    return removed;
  }

  public deleteLayer(layerId: string): boolean {
    const layer = this.layers.get(layerId);
    if (!layer) return false;
    this.layers.delete(layerId);
    this.releaseLayerTiles(layer);
    this.layerRevisions.delete(layerId);
    this.layerViewportCache.delete(layerId);
    this.compositeViewportCache = null;
    return true;
  }

  // ── reads ─────────────────────────────────────────────────────────────────

  /**
   * Live view of a tile's pixels, or null when the tile is absent or evicted.
   * The caller must not mutate it — go through `writeTile`, which owns copy-on-write.
   */
  public readTilePixels(
    layerId: string,
    column: number,
    row: number
  ): Uint8ClampedArray | null {
    const ref = this.layers.get(layerId)?.tiles.get(studioTileDocTileId(column, row));
    if (!ref) return null;
    return this.touchBuffer(ref.bufferId);
  }

  public readSnapshotTilePixels(
    snapshot: StudioTileDocSnapshot,
    layerId: string,
    column: number,
    row: number
  ): Uint8ClampedArray | null {
    const ref = snapshot.layers.get(layerId)?.tiles.get(studioTileDocTileId(column, row));
    if (!ref) return null;
    return this.touchBuffer(ref.bufferId);
  }

  public copyTilePixels(
    layerId: string,
    column: number,
    row: number
  ): Uint8ClampedArray | null {
    const pixels = this.readTilePixels(layerId, column, row);
    return pixels ? new Uint8ClampedArray(pixels) : null;
  }

  /**
   * Copies one buffer only when its exact content revision is still current.
   *
   * This is the safe handoff for asynchronous GPU/Worker consumers. A viewport descriptor can
   * become stale before an upload begins; checking both identities closes that race without
   * exposing a mutable store-owned array.
   */
  public copyBufferSnapshot(
    bufferId: number,
    contentRevision: number
  ): StudioTileDocBufferSnapshot | null {
    if (
      !Number.isSafeInteger(bufferId)
      || bufferId <= 0
      || !Number.isSafeInteger(contentRevision)
      || contentRevision < 0
    ) {
      return null;
    }
    const buffer = this.pool.get(bufferId);
    if (
      !buffer
      || buffer.pixels === null
      || buffer.contentRevision !== contentRevision
    ) {
      return null;
    }
    this.accessSequence += 1;
    buffer.lastUsed = this.accessSequence;
    return Object.freeze({
      bufferId,
      contentRevision,
      byteLength: buffer.byteLength,
      pixels: new Uint8ClampedArray(buffer.pixels),
    });
  }

  // ── viewport query ────────────────────────────────────────────────────────

  /**
   * Stable identity for the storage-tile span covered by a viewport. Pass this to
   * `StudioTileDocCompositePlanner.scopeId`; sub-tile camera movement intentionally keeps it
   * unchanged so retained tile stacks remain reusable.
   */
  public viewportScopeId(rect: StudioTileDocRect): string {
    return `tiledoc-viewport:${this.viewportGeometry(rect).key}`;
  }

  /**
   * Exactly the tiles a viewport rect needs, in a deterministic order
   * (layer order, then row, then column). This is the feed for the compositor: the ids match
   * `studio-webgpu-tile-plan`'s `${column}:${row}` identity.
   */
  public queryViewport(
    rect: StudioTileDocRect,
    options: StudioTileDocViewportOptions = {}
  ): readonly StudioTileDocViewportTile[] {
    const geometry = this.viewportGeometry(rect);
    if (geometry.addresses.length === 0) return EMPTY_VIEWPORT_TILES;
    const layerIds = [...(options.layerIds ?? this.layers.keys())];
    const layerRevisions = layerIds.map((layerId) => this.layerRevision(layerId));
    const composite = this.compositeViewportCache;
    if (
      composite
      && composite.geometryKey === geometry.key
      && composite.residencyEpoch === this.residencyEpoch
      && sameStrings(composite.layerIds, layerIds)
      && sameNumbers(composite.layerRevisions, layerRevisions)
    ) {
      this.viewportCompositeHits += 1;
      return composite.tiles;
    }

    const tiles: StudioTileDocViewportTile[] = [];
    for (let index = 0; index < layerIds.length; index += 1) {
      tiles.push(...this.queryLayerViewport(
        layerIds[index]!,
        layerRevisions[index]!,
        geometry
      ));
    }
    const result = Object.freeze(tiles);
    this.compositeViewportCache = {
      geometryKey: geometry.key,
      layerIds: Object.freeze(layerIds),
      layerRevisions: Object.freeze(layerRevisions),
      residencyEpoch: this.residencyEpoch,
      tiles: result,
    };
    return result;
  }

  /** Union of tile ids a viewport needs across the selected layers. */
  public queryViewportTileIds(
    rect: StudioTileDocRect,
    options: StudioTileDocViewportOptions = {}
  ): readonly string[] {
    const seen = new Set<string>();
    for (const tile of this.queryViewport(rect, options)) seen.add(tile.id);
    return Object.freeze([...seen].sort());
  }

  // ── history ───────────────────────────────────────────────────────────────

  /**
   * Immutable snapshot. O(layer count): retains the current tile maps, copies no pixels.
   * Every buffer it can reach becomes shared, so the next write to any of them clones first.
   */
  public snapshot(label = ""): StudioTileDocSnapshot {
    const sequence = this.nextSnapshotSequence;
    this.nextSnapshotSequence += 1;
    const layers = new Map<string, StudioTileDocLayerTiles>();
    for (const [layerId, layer] of this.layers) {
      layer.refCount += 1;
      layers.set(layerId, layer);
    }
    const snapshot: StudioTileDocSnapshot = Object.freeze({
      id: `tiledoc-snapshot:${sequence}`,
      label,
      sequence,
      layers,
    });
    this.snapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  /** Makes the snapshot the current document. The snapshot itself stays valid and immutable. */
  public restore(snapshot: StudioTileDocSnapshot): boolean {
    if (!this.snapshots.has(snapshot.id)) return false;
    const previous = [...this.layers.values()];
    this.layers.clear();
    for (const [layerId, layer] of snapshot.layers) {
      layer.refCount += 1;
      this.layers.set(layerId, layer);
    }
    for (const layer of previous) this.releaseLayerTiles(layer);
    this.layerRevisions.clear();
    for (const layerId of this.layers.keys()) this.layerRevisions.set(layerId, 1);
    this.resetViewportCaches();
    return true;
  }

  /** Drops a snapshot from history; buffers it alone kept are freed. */
  public releaseSnapshot(snapshot: StudioTileDocSnapshot): boolean {
    if (!this.snapshots.delete(snapshot.id)) return false;
    for (const layer of snapshot.layers.values()) this.releaseLayerTiles(layer);
    return true;
  }

  public liveSnapshots(): readonly StudioTileDocSnapshot[] {
    return Object.freeze(
      [...this.snapshots.values()].sort((left, right) => left.sequence - right.sequence)
    );
  }

  /**
   * Frame descriptions for the persistence planner: the live document plus every live snapshot.
   * Structurally compatible with `StudioTileDocPersistFrameInput` without importing it, which
   * keeps storage and persistence independently replaceable.
   */
  public describeFrames(): readonly StudioTileDocFrameDescription[] {
    const frames: StudioTileDocFrameDescription[] = [
      describeFrame(STUDIO_TILEDOC_CURRENT_FRAME_ID, 0, "", this.layers),
    ];
    for (const snapshot of this.liveSnapshots()) {
      frames.push(describeFrame(snapshot.id, snapshot.sequence, snapshot.label, snapshot.layers));
    }
    return Object.freeze(frames);
  }

  // ── residency ─────────────────────────────────────────────────────────────

  /**
   * Residency snapshot for `studio-tiledoc-residency`. `pinnedBufferIds` is the caller's frame
   * working set (typically `queryViewport(...).map((tile) => tile.bufferId)`).
   */
  public describeResidency(
    pinnedBufferIds: Iterable<number> = []
  ): readonly StudioTileDocResidencyDescriptor[] {
    const current = new Set<number>();
    for (const layer of this.layers.values()) {
      for (const ref of layer.tiles.values()) current.add(ref.bufferId);
    }
    const pinned = new Set<number>(pinnedBufferIds);
    const descriptors = [...this.pool.values()]
      .sort((left, right) => left.id - right.id)
      .map((buffer) => Object.freeze({
        bufferId: buffer.id,
        byteLength: buffer.byteLength,
        resident: buffer.pixels !== null,
        lastUsed: buffer.lastUsed,
        pinned: pinned.has(buffer.id),
        historyOnly: !current.has(buffer.id),
        persisted: buffer.blobKey !== null,
      }));
    return Object.freeze(descriptors);
  }

  /**
   * Drops decoded pixels. Refuses any buffer without a durable blob key — that is the interlock
   * that keeps eviction from silently deleting undo history.
   */
  public evictBuffers(bufferIds: readonly number[]): {
    readonly evicted: readonly number[];
    readonly skipped: readonly number[];
    readonly freedBytes: number;
  } {
    const evicted: number[] = [];
    const skipped: number[] = [];
    let freedBytes = 0;
    for (const bufferId of bufferIds) {
      const buffer = this.pool.get(bufferId);
      if (!buffer || buffer.pixels === null || buffer.blobKey === null) {
        skipped.push(bufferId);
        continue;
      }
      buffer.pixels = null;
      this.residentBytesValue -= buffer.byteLength;
      this.evictions += 1;
      freedBytes += buffer.byteLength;
      evicted.push(bufferId);
    }
    if (evicted.length > 0) this.invalidateViewportResidency();
    return Object.freeze({
      evicted: Object.freeze(evicted),
      skipped: Object.freeze(skipped),
      freedBytes,
    });
  }

  public hydrateBuffer(bufferId: number, pixels: Uint8ClampedArray): boolean {
    const buffer = this.pool.get(bufferId);
    if (!buffer || buffer.pixels !== null || pixels.length !== buffer.byteLength) return false;
    buffer.pixels = pixels;
    this.residentBytesValue += buffer.byteLength;
    this.accessSequence += 1;
    buffer.lastUsed = this.accessSequence;
    this.invalidateViewportResidency();
    return true;
  }

  // ── persistence support ───────────────────────────────────────────────────

  /**
   * Content digest of a buffer's pixels, cached until the next write. An evicted buffer keeps the
   * digest it was persisted under, so garbage collection can still reason about it.
   */
  public bufferDigest(bufferId: number): string | null {
    const buffer = this.pool.get(bufferId);
    if (!buffer) return null;
    if (buffer.digest !== null) return buffer.digest;
    if (buffer.pixels === null) return null;
    buffer.digest = this.digestFn(buffer.pixels);
    return buffer.digest;
  }

  public bufferBlobKey(bufferId: number): string | null {
    return this.pool.get(bufferId)?.blobKey ?? null;
  }

  public markPersisted(bufferId: number, blobKey: string): boolean {
    const buffer = this.pool.get(bufferId);
    if (!buffer || blobKey.length === 0) return false;
    buffer.blobKey = blobKey;
    return true;
  }

  public bufferPixels(bufferId: number): Uint8ClampedArray | null {
    return this.pool.get(bufferId)?.pixels ?? null;
  }

  public dispose(): void {
    this.layers.clear();
    this.snapshots.clear();
    this.pool.clear();
    this.layerRevisions.clear();
    this.resetViewportCaches();
    this.residentBytesValue = 0;
    this.retainedBytesValue = 0;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private layerRevision(layerId: string): number {
    return this.layerRevisions.get(layerId) ?? 0;
  }

  private bumpLayerRevision(layerId: string): void {
    const previous = this.layerRevision(layerId);
    this.layerRevisions.set(
      layerId,
      previous >= Number.MAX_SAFE_INTEGER ? 1 : previous + 1
    );
    // Keep the stale layer entry for descriptor-level reuse, but never reuse the ordered aggregate.
    this.compositeViewportCache = null;
  }

  private viewportGeometry(rect: StudioTileDocRect): ViewportGeometryCache {
    const geometryOptions = {
      tileSize: this.tileSize,
      bounds: { width: this.documentWidth, height: this.documentHeight },
    } as const;
    const span = studioTileDocTileSpan(rect, geometryOptions);
    const key = span
      ? `${span.firstColumn}:${span.firstRow}:${span.lastColumn}:${span.lastRow}`
      : "empty";
    if (this.viewportGeometryCache?.key === key) {
      this.viewportGeometryHits += 1;
      return this.viewportGeometryCache;
    }
    const addresses = studioTileDocTilesForRect(rect, geometryOptions);
    const geometry = { key, addresses };
    this.viewportGeometryCache = geometry;
    return geometry;
  }

  private queryLayerViewport(
    layerId: string,
    layerRevision: number,
    geometry: ViewportGeometryCache
  ): readonly StudioTileDocViewportTile[] {
    const cached = this.layerViewportCache.get(layerId);
    if (
      cached
      && cached.geometryKey === geometry.key
      && cached.layerRevision === layerRevision
      && cached.residencyEpoch === this.residencyEpoch
    ) {
      this.viewportLayerHits += 1;
      return cached.tiles;
    }

    const layer = this.layers.get(layerId);
    const reusable = new Map((cached?.tiles ?? EMPTY_VIEWPORT_TILES).map((tile) => [tile.id, tile]));
    const tiles: StudioTileDocViewportTile[] = [];
    if (layer && layer.tiles.size > 0) {
      const documentRect: StudioTileDocRect = {
        x: 0,
        y: 0,
        width: this.documentWidth,
        height: this.documentHeight,
      };
      for (const address of geometry.addresses) {
        const ref = layer.tiles.get(address.id);
        if (!ref) continue;
        const buffer = this.pool.get(ref.bufferId);
        if (!buffer) continue;
        const clipped = intersectStudioTileDocRects(
          studioTileDocTileRect(address.column, address.row, this.tileSize),
          documentRect
        );
        /* c8 ignore next */
        if (!clipped) continue;
        const previous = reusable.get(address.id);
        if (previous && sameViewportTile(previous, layerId, buffer, clipped)) {
          this.viewportDescriptorReuses += 1;
          tiles.push(previous);
          continue;
        }
        tiles.push(Object.freeze({
          layerId,
          id: address.id,
          column: address.column,
          row: address.row,
          rect: clipped,
          bufferId: ref.bufferId,
          contentRevision: buffer.contentRevision,
          resident: buffer.pixels !== null,
        }));
      }
    }
    const result = tiles.length === 0 ? EMPTY_VIEWPORT_TILES : Object.freeze(tiles);
    this.layerViewportCache.set(layerId, {
      geometryKey: geometry.key,
      layerRevision,
      residencyEpoch: this.residencyEpoch,
      tiles: result,
    });
    return result;
  }

  private invalidateViewportResidency(): void {
    this.residencyEpoch = this.residencyEpoch >= Number.MAX_SAFE_INTEGER
      ? 1
      : this.residencyEpoch + 1;
    this.compositeViewportCache = null;
  }

  private resetViewportCaches(): void {
    this.viewportGeometryCache = null;
    this.compositeViewportCache = null;
    this.layerViewportCache.clear();
  }

  private isTileInBounds(column: number, row: number): boolean {
    if (this.allowOutOfBounds) return Number.isSafeInteger(column) && Number.isSafeInteger(row);
    if (!Number.isSafeInteger(column) || !Number.isSafeInteger(row)) return false;
    if (column < 0 || row < 0) return false;
    return column * this.tileSize < this.documentWidth
      && row * this.tileSize < this.documentHeight;
  }

  private ensureWritableLayer(layerId: string): StudioTileDocLayerTiles {
    const existing = this.layers.get(layerId);
    if (!existing) {
      const created: StudioTileDocLayerTiles = { tiles: new Map(), refCount: 1 };
      this.layers.set(layerId, created);
      return created;
    }
    if (existing.refCount === 1) return existing;
    // Shared with at least one snapshot: clone the map (pointer copies) and retain its buffers.
    const cloned: StudioTileDocLayerTiles = { tiles: new Map(existing.tiles), refCount: 1 };
    for (const ref of cloned.tiles.values()) {
      const buffer = this.pool.get(ref.bufferId);
      if (buffer) buffer.refCount += 1;
    }
    existing.refCount -= 1;
    this.layers.set(layerId, cloned);
    this.layerMapCopies += 1;
    return cloned;
  }

  private allocateBuffer(): TileBuffer {
    const buffer: TileBuffer = {
      id: this.nextBufferId,
      byteLength: this.tileBytes,
      pixels: new Uint8ClampedArray(this.tileBytes),
      contentRevision: 0,
      refCount: 0,
      lastUsed: this.accessSequence,
      blobKey: null,
      digest: null,
    };
    this.nextBufferId += 1;
    this.pool.set(buffer.id, buffer);
    this.residentBytesValue += buffer.byteLength;
    this.retainedBytesValue += buffer.byteLength;
    this.allocations += 1;
    return buffer;
  }

  private cloneBuffer(source: TileBuffer): TileBuffer {
    const buffer = this.allocateBuffer();
    /* c8 ignore next */
    if (source.pixels && buffer.pixels) buffer.pixels.set(source.pixels);
    this.copyOnWriteCopies += 1;
    return buffer;
  }

  private discardBuffer(buffer: TileBuffer): void {
    if (!this.pool.delete(buffer.id)) return;
    if (buffer.pixels !== null) this.residentBytesValue -= buffer.byteLength;
    this.retainedBytesValue -= buffer.byteLength;
    buffer.pixels = null;
  }

  private releaseBuffer(bufferId: number): void {
    const buffer = this.pool.get(bufferId);
    if (!buffer) return;
    buffer.refCount -= 1;
    if (buffer.refCount > 0) return;
    this.discardBuffer(buffer);
  }

  private releaseLayerTiles(layer: StudioTileDocLayerTiles): void {
    layer.refCount -= 1;
    if (layer.refCount > 0) return;
    for (const ref of layer.tiles.values()) this.releaseBuffer(ref.bufferId);
    layer.tiles.clear();
  }

  private touchBuffer(bufferId: number): Uint8ClampedArray | null {
    const buffer = this.pool.get(bufferId);
    if (!buffer || buffer.pixels === null) return null;
    this.accessSequence += 1;
    buffer.lastUsed = this.accessSequence;
    return buffer.pixels;
  }

  private result(
    tileId: string,
    column: number,
    row: number,
    status: StudioTileDocWriteStatus,
    allocated: boolean,
    copied: boolean,
    bufferId: number | null
  ): StudioTileDocWriteResult {
    return Object.freeze({ tileId, column, row, status, allocated, copied, bufferId });
  }
}
