import { describe, expect, it } from "vitest";

import { isStudioTileDocDigest, studioTileDocDigest } from "./studio-tiledoc-digest";
import { STUDIO_TILEDOC_TILE_FORMAT } from "./studio-tiledoc-geometry";
import {
  STUDIO_TILEDOC_MANIFEST_VERSION,
  parseStudioTileDocManifest,
  planStudioTileDocGarbageCollection,
  planStudioTileDocHydration,
  planStudioTileDocPersist,
  runStudioTileDocPersist,
  serializeStudioTileDocManifest,
  studioTileDocManifestKey,
  studioTileDocTileBlobKey,
  type StudioTileDocBlobStore,
} from "./studio-tiledoc-persistence";
import { StudioTiledDocumentStore } from "./studio-tiledoc-store";

const TILE_SIZE = 64;
const TILE_BYTES = TILE_SIZE * TILE_SIZE * 4;

function buildStore(): StudioTiledDocumentStore {
  const store = new StudioTiledDocumentStore({
    documentWidth: 256,
    documentHeight: 256,
    tileSize: TILE_SIZE,
  });
  let value = 1;
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const red = value;
      value += 1;
      store.writeTile("layer-a", column, row, (pixels) => {
        for (let index = 0; index < pixels.length; index += 4) {
          pixels[index] = red;
          pixels[index + 3] = 255;
        }
      });
    }
  }
  return store;
}

function persistInput(store: StudioTiledDocumentStore, durableKeys: readonly string[] = []) {
  return {
    documentId: "doc-1",
    tileSize: store.tileSize,
    documentWidth: store.documentWidth,
    documentHeight: store.documentHeight,
    format: STUDIO_TILEDOC_TILE_FORMAT,
    frames: store.describeFrames(),
    digestOf: (bufferId: number) => store.bufferDigest(bufferId),
    byteLengthOf: () => TILE_BYTES,
    durableKeys,
  };
}

class MemoryBlobStore implements StudioTileDocBlobStore {
  public readonly blobs = new Map<string, Uint8Array>();
  public readonly order: string[] = [];
  public failOn: string | null = null;

  public put(key: string, bytes: Uint8Array): Promise<void> {
    if (this.failOn === key) return Promise.reject(new Error("disk full"));
    this.blobs.set(key, bytes);
    this.order.push(key);
    return Promise.resolve();
  }

  public get(key: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.blobs.get(key) ?? null);
  }

  public delete(keys: readonly string[]): Promise<void> {
    for (const key of keys) this.blobs.delete(key);
    return Promise.resolve();
  }

  public list(prefix: string): Promise<readonly string[]> {
    return Promise.resolve([...this.blobs.keys()].filter((key) => key.startsWith(prefix)));
  }
}

describe("studio tiled document digest", () => {
  it("is deterministic, content sensitive and length committed", () => {
    const left = new Uint8ClampedArray([1, 2, 3, 4]);
    const right = new Uint8ClampedArray([1, 2, 3, 4]);
    expect(studioTileDocDigest(left)).toBe(studioTileDocDigest(right));
    expect(isStudioTileDocDigest(studioTileDocDigest(left))).toBe(true);
    expect(studioTileDocDigest(left)).toHaveLength(32);

    right[3] = 5;
    expect(studioTileDocDigest(left)).not.toBe(studioTileDocDigest(right));
    // A single flipped bit five bytes deep must still move the digest.
    const long = new Uint8ClampedArray(64);
    const flipped = new Uint8ClampedArray(64);
    flipped[37] = 1;
    expect(studioTileDocDigest(long)).not.toBe(studioTileDocDigest(flipped));
    // Truncation cannot collide with the longer buffer.
    expect(studioTileDocDigest(new Uint8ClampedArray(8)))
      .not.toBe(studioTileDocDigest(new Uint8ClampedArray(16)));
    expect(isStudioTileDocDigest("nope")).toBe(false);
    expect(isStudioTileDocDigest(42)).toBe(false);
  });
});

describe("studio tiled document persistence planning", () => {
  it("writes one blob per distinct tile even when history shares tiles", () => {
    const store = buildStore();
    store.snapshot("v1");
    store.writeTile("layer-a", 0, 0, (pixels) => pixels.fill(99));

    const plan = planStudioTileDocPersist(persistInput(store));
    expect(plan.manifest.frames.map((frame) => frame.id))
      .toEqual(["current", "tiledoc-snapshot:1"]);
    // 2 frames x 16 tiles = 32 references, but only 17 distinct contents exist.
    expect(plan.naiveWriteBytes).toBe(32 * TILE_BYTES);
    expect(plan.writes).toHaveLength(17);
    expect(plan.writeBytes).toBe(17 * TILE_BYTES);
    expect(plan.skippedBufferIds).toHaveLength(15);
    expect(plan.unresolvedBufferIds).toEqual([]);
    expect(plan.manifestKey).toBe(studioTileDocManifestKey("doc-1"));
    expect(new Set(plan.writes.map((write) => write.key)).size).toBe(17);
  });

  it("skips blobs that are already durable", () => {
    const store = buildStore();
    const first = planStudioTileDocPersist(persistInput(store));
    expect(first.writes).toHaveLength(16);

    const durable = first.writes.map((write) => write.key);
    const second = planStudioTileDocPersist(persistInput(store, durable));
    expect(second.writes).toEqual([]);
    expect(second.writeBytes).toBe(0);
    expect(second.naiveWriteBytes).toBe(16 * TILE_BYTES);
    // The manifest is unchanged, so nothing needs rewriting either.
    expect(serializeStudioTileDocManifest(second.manifest))
      .toBe(serializeStudioTileDocManifest(first.manifest));
  });

  it("defers tiles whose content identity cannot be resolved", () => {
    const store = buildStore();
    const bufferId = store.bufferIdAt("layer-a", 0, 0) as number;
    store.markPersisted(bufferId, "stale");
    store.evictBuffers([bufferId]);

    const plan = planStudioTileDocPersist({
      ...persistInput(store),
      // Simulate an evicted buffer with no cached digest.
      digestOf: (id: number) => (id === bufferId ? null : store.bufferDigest(id)),
    });
    expect(plan.unresolvedBufferIds).toEqual([bufferId]);
    expect(plan.writes).toHaveLength(15);
    expect(plan.manifest.frames[0].layers[0].tiles).toHaveLength(15);
  });

  it("round-trips a canonical manifest and rejects malformed ones", () => {
    const store = buildStore();
    store.snapshot("v1");
    const plan = planStudioTileDocPersist(persistInput(store));
    const text = serializeStudioTileDocManifest(plan.manifest);
    const parsed = parseStudioTileDocManifest(text);

    expect(parsed).not.toBeNull();
    expect(serializeStudioTileDocManifest(parsed!)).toBe(text);
    expect(parsed?.version).toBe(STUDIO_TILEDOC_MANIFEST_VERSION);
    expect(parsed?.tileSize).toBe(TILE_SIZE);
    expect(parsed?.format).toBe(STUDIO_TILEDOC_TILE_FORMAT);
    expect(parsed?.frames[0].layers[0].tiles.map((tile) => tile.tileId))
      .toEqual(["0:0", "0:1", "0:2", "0:3", "1:0", "1:1", "1:2", "1:3",
        "2:0", "2:1", "2:2", "2:3", "3:0", "3:1", "3:2", "3:3"]);

    expect(parseStudioTileDocManifest("{")).toBeNull();
    expect(parseStudioTileDocManifest("[]")).toBeNull();
    expect(parseStudioTileDocManifest(JSON.stringify({ version: 99 }))).toBeNull();
    expect(parseStudioTileDocManifest(JSON.stringify({
      ...JSON.parse(text),
      frames: [{ id: "current", sequence: 0, label: "", layers: [{ layerId: "a", tiles: [{ tileId: "0:0", digest: "zz" }] }] }],
    }))).toBeNull();
  });

  it("orders hydration viewport-first and deduplicates shared tiles", () => {
    const store = buildStore();
    store.snapshot("v1");
    const plan = planStudioTileDocPersist(persistInput(store));

    const requests = planStudioTileDocHydration({
      manifest: plan.manifest,
      frameId: "current",
      viewportTileIds: ["1:1", "2:2"],
    });
    expect(requests).toHaveLength(16);
    expect(requests.slice(0, 2).map((request) => request.tileId)).toEqual(["1:1", "2:2"]);
    expect(requests.slice(0, 2).every((request) => request.priority === 0)).toBe(true);
    expect(requests[0].key).toBe(studioTileDocTileBlobKey("doc-1", requests[0].digest));

    // Already-decoded content is not re-fetched.
    const present = requests.slice(0, 4).map((request) => request.digest);
    expect(planStudioTileDocHydration({
      manifest: plan.manifest,
      frameId: "current",
      presentDigests: present,
    })).toHaveLength(12);

    expect(planStudioTileDocHydration({
      manifest: plan.manifest,
      frameId: "missing",
    })).toEqual([]);
    expect(planStudioTileDocHydration({
      manifest: plan.manifest,
      frameId: "current",
      layerIds: ["other"],
    })).toEqual([]);
  });

  it("finds orphaned blobs no live frame references", () => {
    const store = buildStore();
    const plan = planStudioTileDocPersist(persistInput(store));
    const existing = [
      ...plan.writes.map((write) => write.key),
      studioTileDocTileBlobKey("doc-1", "ffffffffffffffffffffffffffffffff"),
      "tiledoc/other-doc/tiles/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bin",
      studioTileDocManifestKey("doc-1"),
    ];
    expect(planStudioTileDocGarbageCollection(plan.manifest, existing))
      .toEqual([studioTileDocTileBlobKey("doc-1", "ffffffffffffffffffffffffffffffff")]);
  });
});

describe("studio tiled document persistence execution", () => {
  it("writes every blob before the manifest", async () => {
    const store = buildStore();
    const plan = planStudioTileDocPersist(persistInput(store));
    const blobStore = new MemoryBlobStore();

    const outcome = await runStudioTileDocPersist(
      plan,
      blobStore,
      (bufferId) => store.bufferPixels(bufferId)
    );
    expect(outcome.failed).toEqual([]);
    expect(outcome.manifestWritten).toBe(true);
    expect(outcome.written).toHaveLength(16);
    expect(blobStore.order.at(-1)).toBe(plan.manifestKey);
    expect(blobStore.blobs.size).toBe(17);
    expect((await blobStore.get(plan.writes[0].key))?.byteLength).toBe(TILE_BYTES);
    expect(await blobStore.list("tiledoc/doc-1/tiles/")).toHaveLength(16);
  });

  it("leaves the manifest unwritten when a tile blob fails", async () => {
    const store = buildStore();
    const plan = planStudioTileDocPersist(persistInput(store));
    const blobStore = new MemoryBlobStore();
    blobStore.failOn = plan.writes[3].key;

    const outcome = await runStudioTileDocPersist(
      plan,
      blobStore,
      (bufferId) => store.bufferPixels(bufferId)
    );
    expect(outcome.manifestWritten).toBe(false);
    expect(outcome.failed).toEqual([{ key: plan.writes[3].key, reason: "disk full" }]);
    expect(blobStore.blobs.has(plan.manifestKey)).toBe(false);
  });

  it("reports buffers that vanished before the flush", async () => {
    const store = buildStore();
    const plan = planStudioTileDocPersist(persistInput(store));
    const blobStore = new MemoryBlobStore();

    const outcome = await runStudioTileDocPersist(plan, blobStore, () => null);
    expect(outcome.written).toEqual([]);
    expect(outcome.manifestWritten).toBe(false);
    expect(outcome.failed).toHaveLength(16);
    expect(outcome.failed[0].reason).toBe("buffer-unavailable");
  });
});
