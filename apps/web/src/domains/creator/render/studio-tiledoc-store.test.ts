import { describe, expect, it } from "vitest";

import { studioTileDocDirtyRegionForRect } from "./studio-tiledoc-dirty";
import {
  STUDIO_TILEDOC_TILE_BYTES,
  studioTileDocGridTileCount,
} from "./studio-tiledoc-geometry";
import {
  StudioTiledDocumentStore,
  type StudioTileDocSnapshot,
  type StudioTileDocTileWriter,
} from "./studio-tiledoc-store";

const PAGE = { documentWidth: 4000, documentHeight: 6000 } as const;
/** 64px tiles = 16 KiB each: volume tests stay fast while the byte math stays exact. */
const SMALL = { documentWidth: 256, documentHeight: 256, tileSize: 64 } as const;
const SMALL_TILE_BYTES = 64 * 64 * 4;

function fillOpaque(red: number): StudioTileDocTileWriter {
  return (pixels) => {
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = red;
      pixels[index + 3] = 255;
    }
  };
}

const eraseAll: StudioTileDocTileWriter = (pixels) => pixels.fill(0);
const noop: StudioTileDocTileWriter = () => undefined;

function paintAllTiles(store: StudioTiledDocumentStore, layerId: string, red: number): void {
  const columns = Math.ceil(store.documentWidth / store.tileSize);
  const rows = Math.ceil(store.documentHeight / store.tileSize);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      store.writeTile(layerId, column, row, fillOpaque(red));
    }
  }
}

describe("studio tiled document store — sparse allocation", () => {
  it("allocates nothing for an empty document", () => {
    const store = new StudioTiledDocumentStore(PAGE);
    const stats = store.stats();
    expect(stats.distinctBufferCount).toBe(0);
    expect(stats.currentTileCount).toBe(0);
    expect(stats.residentBytes).toBe(0);
    expect(stats.retainedBytes).toBe(0);
    expect(store.queryViewport({ x: 0, y: 0, width: 4000, height: 6000 })).toEqual([]);
  });

  it("allocates only the tiles a small stroke touches", () => {
    const store = new StudioTiledDocumentStore(PAGE);
    const region = studioTileDocDirtyRegionForRect(
      { x: 100, y: 100, width: 40, height: 60 },
      { bounds: { width: 4000, height: 6000 } }
    );
    expect(region.tiles.map((tile) => tile.id)).toEqual(["0:0"]);

    const applied = store.applyRegion("layer-a", region, fillOpaque(10));
    expect(applied.written).toBe(1);
    expect(applied.allocated).toBe(1);

    const stats = store.stats();
    expect(stats.currentTileCount).toBe(1);
    expect(stats.distinctBufferCount).toBe(1);
    expect(stats.residentBytes).toBe(STUDIO_TILEDOC_TILE_BYTES);
    // 1 MiB instead of the 4000x6000x4 = 96,000,000 B full-page layer bitmap it replaces.
    expect(stats.residentBytes).toBe(1_048_576);
    expect(4000 * 6000 * 4).toBe(96_000_000);
    expect(studioTileDocGridTileCount({ width: 4000, height: 6000 })).toBe(96);
  });

  it("keeps a transparent write at zero cost", () => {
    const store = new StudioTiledDocumentStore(PAGE);
    const result = store.writeTile("layer-a", 0, 0, noop);
    expect(result.status).toBe("pruned");
    expect(result.allocated).toBe(true);
    const stats = store.stats();
    expect(stats.distinctBufferCount).toBe(0);
    expect(stats.residentBytes).toBe(0);
    expect(stats.prunes).toBe(1);
  });

  it("prunes a tile back out when an erase clears it", () => {
    const store = new StudioTiledDocumentStore(SMALL);
    store.writeTile("layer-a", 1, 1, fillOpaque(10));
    expect(store.stats().distinctBufferCount).toBe(1);

    const erased = store.writeTile("layer-a", 1, 1, eraseAll);
    expect(erased.status).toBe("pruned");
    expect(store.stats().distinctBufferCount).toBe(0);
    expect(store.layerTileCount("layer-a")).toBe(0);
    expect(store.readTilePixels("layer-a", 1, 1)).toBeNull();
  });

  it("keeps transparent tiles when auto-pruning is disabled", () => {
    const store = new StudioTiledDocumentStore({ ...SMALL, autoPrune: false });
    expect(store.writeTile("layer-a", 0, 0, noop).status).toBe("written");
    expect(store.stats().distinctBufferCount).toBe(1);
  });

  it("rejects tiles outside the document unless explicitly allowed", () => {
    const store = new StudioTiledDocumentStore(SMALL);
    expect(store.writeTile("layer-a", 4, 0, fillOpaque(10)).status).toBe("out-of-bounds");
    expect(store.writeTile("layer-a", -1, 0, fillOpaque(10)).status).toBe("out-of-bounds");
    expect(store.stats().distinctBufferCount).toBe(0);

    const loose = new StudioTiledDocumentStore({ ...SMALL, allowOutOfBounds: true });
    expect(loose.writeTile("layer-a", -1, -1, fillOpaque(10)).status).toBe("written");
    expect(loose.stats().distinctBufferCount).toBe(1);
  });

  it("deletes tiles, regions and layers", () => {
    const store = new StudioTiledDocumentStore(SMALL);
    paintAllTiles(store, "layer-a", 10);
    expect(store.stats().currentTileCount).toBe(16);

    expect(store.deleteTile("layer-a", 0, 0)).toBe(true);
    expect(store.deleteTile("layer-a", 0, 0)).toBe(false);
    expect(store.stats().currentTileCount).toBe(15);

    // Partially covered tiles survive a region clear; fully covered ones do not.
    expect(store.clearRegion("layer-a", { x: 64, y: 0, width: 100, height: 64 })).toBe(1);
    expect(store.stats().currentTileCount).toBe(14);

    expect(store.deleteLayer("layer-a")).toBe(true);
    expect(store.deleteLayer("layer-a")).toBe(false);
    expect(store.stats().distinctBufferCount).toBe(0);
    expect(store.stats().residentBytes).toBe(0);
  });
});

describe("studio tiled document store — copy-on-write history", () => {
  it("grows by only the touched tiles across repeated snapshots", () => {
    const store = new StudioTiledDocumentStore(SMALL);
    paintAllTiles(store, "layer-a", 1);
    const baseTiles = store.stats().currentTileCount;
    expect(baseTiles).toBe(16);
    expect(store.stats().distinctBufferCount).toBe(16);

    const snapshots: StudioTileDocSnapshot[] = [];
    const edits = 8;
    for (let step = 0; step < edits; step += 1) {
      snapshots.push(store.snapshot(`edit-${step}`));
      const result = store.writeTile("layer-a", 0, 0, fillOpaque(10 + step));
      expect(result.copied).toBe(true);
    }

    const stats = store.stats();
    // 16 base tiles + exactly one cloned tile per snapshotted edit.
    expect(stats.distinctBufferCount).toBe(baseTiles + edits);
    expect(stats.distinctBufferCount).toBe(24);
    expect(stats.copyOnWriteCopies).toBe(edits);
    expect(stats.layerMapCopies).toBe(edits);
    expect(stats.currentTileCount).toBe(16);
    expect(stats.retainedBytes).toBe(24 * SMALL_TILE_BYTES);

    // Snapshot-per-edit without sharing would be 16 * (8 + 1) = 144 tiles.
    const naiveTiles = baseTiles * (edits + 1);
    expect(naiveTiles).toBe(144);
    expect(naiveTiles / stats.distinctBufferCount).toBe(6);
  });

  it("does not clone again for further writes inside the same snapshot interval", () => {
    const store = new StudioTiledDocumentStore(SMALL);
    store.writeTile("layer-a", 0, 0, fillOpaque(1));
    store.snapshot("before");

    expect(store.writeTile("layer-a", 0, 0, fillOpaque(2)).copied).toBe(true);
    expect(store.writeTile("layer-a", 0, 0, fillOpaque(3)).copied).toBe(false);
    expect(store.writeTile("layer-a", 0, 0, fillOpaque(4)).copied).toBe(false);
    expect(store.stats().copyOnWriteCopies).toBe(1);
    expect(store.stats().distinctBufferCount).toBe(2);
  });

  it("keeps untouched tiles shared between the snapshot and the current document", () => {
    const store = new StudioTiledDocumentStore(SMALL);
    paintAllTiles(store, "layer-a", 1);
    const snapshot = store.snapshot("base");
    // Row-major painting assigns buffer ids 1..16; tile 0:0 is 1 and tile 3:3 is 16.
    expect(store.bufferIdAt("layer-a", 0, 0)).toBe(1);
    expect(store.bufferIdAt("layer-a", 3, 3)).toBe(16);
    store.writeTile("layer-a", 0, 0, fillOpaque(2));

    // 15 untouched tiles stay byte-identical *and* pointer-identical across the fork.
    expect(store.bufferIdAt("layer-a", 3, 3)).toBe(16);
    expect(store.readSnapshotTilePixels(snapshot, "layer-a", 3, 3))
      .toBe(store.readTilePixels("layer-a", 3, 3));
    // Only the edited tile diverged, into exactly one new buffer.
    expect(store.bufferIdAt("layer-a", 0, 0)).toBe(17);
    expect(store.stats().distinctBufferCount).toBe(17);
  });

  it("keeps a snapshot immutable while the current document changes", () => {
    const store = new StudioTiledDocumentStore(SMALL);
    store.writeTile("layer-a", 0, 0, fillOpaque(10));
    const snapshot = store.snapshot("v1");
    expect(store.readSnapshotTilePixels(snapshot, "layer-a", 0, 0)?.[0]).toBe(10);

    store.writeTile("layer-a", 0, 0, fillOpaque(200));
    expect(store.readTilePixels("layer-a", 0, 0)?.[0]).toBe(200);
    expect(store.readSnapshotTilePixels(snapshot, "layer-a", 0, 0)?.[0]).toBe(10);

    // A tile added after the snapshot must not appear inside it.
    store.writeTile("layer-a", 1, 0, fillOpaque(55));
    expect(store.readSnapshotTilePixels(snapshot, "layer-a", 1, 0)).toBeNull();
    expect(store.readTilePixels("layer-a", 1, 0)?.[0]).toBe(55);

    // Deleting a layer must not reach into history either.
    store.deleteLayer("layer-a");
    expect(store.readTilePixels("layer-a", 0, 0)).toBeNull();
    expect(store.readSnapshotTilePixels(snapshot, "layer-a", 0, 0)?.[0]).toBe(10);
  });

  it("restores a snapshot without copying pixels and re-forks on the next write", () => {
    const store = new StudioTiledDocumentStore(SMALL);
    store.writeTile("layer-a", 0, 0, fillOpaque(10));
    const first = store.snapshot("v1");
    store.writeTile("layer-a", 0, 0, fillOpaque(20));
    const buffersAfterEdit = store.stats().distinctBufferCount;
    expect(buffersAfterEdit).toBe(2);

    expect(store.restore(first)).toBe(true);
    expect(store.readTilePixels("layer-a", 0, 0)?.[0]).toBe(10);
    // Restore is pointer work: the forked buffer is dropped, nothing new is allocated.
    expect(store.stats().distinctBufferCount).toBe(1);
    expect(store.stats().copyOnWriteCopies).toBe(1);

    store.writeTile("layer-a", 0, 0, fillOpaque(30));
    expect(store.readSnapshotTilePixels(first, "layer-a", 0, 0)?.[0]).toBe(10);
    expect(store.readTilePixels("layer-a", 0, 0)?.[0]).toBe(30);
    expect(store.restore({ ...first, id: "missing" })).toBe(false);
  });

  it("frees history-only buffers when snapshots are released", () => {
    const store = new StudioTiledDocumentStore(SMALL);
    paintAllTiles(store, "layer-a", 1);
    const snapshots: StudioTileDocSnapshot[] = [];
    for (let step = 0; step < 8; step += 1) {
      snapshots.push(store.snapshot(`edit-${step}`));
      store.writeTile("layer-a", 0, 0, fillOpaque(10 + step));
    }
    expect(store.stats().distinctBufferCount).toBe(24);
    expect(store.liveSnapshots().map((snapshot) => snapshot.sequence))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    for (const snapshot of snapshots) expect(store.releaseSnapshot(snapshot)).toBe(true);
    expect(store.stats().distinctBufferCount).toBe(16);
    expect(store.stats().snapshotCount).toBe(0);
    expect(store.releaseSnapshot(snapshots[0])).toBe(false);
  });
});

describe("studio tiled document store — viewport queries", () => {
  it("returns exactly the tiles a viewport rect needs", () => {
    const store = new StudioTiledDocumentStore({
      documentWidth: 2048,
      documentHeight: 2048,
    });
    paintAllTiles(store, "layer-a", 1);
    expect(store.stats().currentTileCount).toBe(16);

    expect(store.queryViewportTileIds({ x: 512, y: 0, width: 512, height: 512 }))
      .toEqual(["1:0"]);
    expect(store.queryViewportTileIds({ x: 511, y: 0, width: 2, height: 1 }))
      .toEqual(["0:0", "1:0"]);
    expect(store.queryViewportTileIds({ x: 0, y: 0, width: 0, height: 512 })).toEqual([]);
    expect(store.queryViewportTileIds({ x: 0, y: 0, width: 2048, height: 2048 }))
      .toHaveLength(16);
    // Out-of-document viewport area is clamped away rather than producing phantom tiles.
    expect(store.queryViewportTileIds({ x: 1900, y: 1900, width: 4000, height: 4000 }))
      .toEqual(["3:3"]);
  });

  it("clips the reported rect to the document and orders results deterministically", () => {
    const store = new StudioTiledDocumentStore({
      documentWidth: 1000,
      documentHeight: 700,
    });
    paintAllTiles(store, "layer-b", 2);
    paintAllTiles(store, "layer-a", 1);

    const tiles = store.queryViewport({ x: 0, y: 0, width: 1000, height: 700 });
    expect(tiles.map((tile) => `${tile.layerId}/${tile.id}`)).toEqual([
      "layer-b/0:0", "layer-b/1:0", "layer-b/0:1", "layer-b/1:1",
      "layer-a/0:0", "layer-a/1:0", "layer-a/0:1", "layer-a/1:1",
    ]);
    // Trailing tiles are clipped: column 1 is 1000-512=488 wide, row 1 is 700-512=188 tall.
    expect(tiles[3].rect).toEqual({ x: 512, y: 512, width: 488, height: 188 });
    expect(tiles.every((tile) => tile.resident)).toBe(true);

    const filtered = store.queryViewport(
      { x: 0, y: 0, width: 1000, height: 700 },
      { layerIds: ["layer-a"] }
    );
    expect(filtered).toHaveLength(4);
    expect(filtered.every((tile) => tile.layerId === "layer-a")).toBe(true);
    expect(store.queryViewport(
      { x: 0, y: 0, width: 10, height: 10 },
      { layerIds: ["missing"] }
    )).toEqual([]);
  });

  it("skips tiles a sparse layer never allocated", () => {
    const store = new StudioTiledDocumentStore({
      documentWidth: 2048,
      documentHeight: 2048,
    });
    store.writeTile("layer-a", 2, 3, fillOpaque(9));
    expect(store.queryViewportTileIds({ x: 0, y: 0, width: 2048, height: 2048 }))
      .toEqual(["2:3"]);
  });

  it("reuses an immutable viewport feed while the camera remains inside one tile span", () => {
    const store = new StudioTiledDocumentStore(SMALL);
    paintAllTiles(store, "layer-a", 1);

    const first = store.queryViewport({ x: 1, y: 1, width: 62, height: 62 });
    const second = store.queryViewport({ x: 2, y: 2, width: 60, height: 60 });

    expect(second).toBe(first);
    expect(store.viewportScopeId({ x: 1, y: 1, width: 62, height: 62 }))
      .toBe(store.viewportScopeId({ x: 2, y: 2, width: 60, height: 60 }));
    expect(store.viewportScopeId({ x: 64, y: 0, width: 64, height: 64 }))
      .not.toBe(store.viewportScopeId({ x: 0, y: 0, width: 64, height: 64 }));
    expect(store.viewportCacheStats()).toMatchObject({
      compositeHits: 1,
      geometryHits: 3,
    });
  });

  it("reorders layers by reusing their cached tile feeds instead of rebuilding descriptors", () => {
    const store = new StudioTiledDocumentStore(SMALL);
    store.writeTile("layer-a", 0, 0, fillOpaque(10));
    store.writeTile("layer-b", 0, 0, fillOpaque(20));
    const rect = { x: 0, y: 0, width: 64, height: 64 };

    const backToFront = store.queryViewport(rect, { layerIds: ["layer-a", "layer-b"] });
    const frontToBack = store.queryViewport(rect, { layerIds: ["layer-b", "layer-a"] });

    expect(backToFront.map((tile) => tile.layerId)).toEqual(["layer-a", "layer-b"]);
    expect(frontToBack.map((tile) => tile.layerId)).toEqual(["layer-b", "layer-a"]);
    expect(frontToBack[0]).toBe(backToFront[1]);
    expect(frontToBack[1]).toBe(backToFront[0]);
    expect(store.viewportCacheStats().layerHits).toBe(2);
  });

  it("rebuilds only the edited layer and preserves unchanged tile descriptor identities", () => {
    const store = new StudioTiledDocumentStore(SMALL);
    store.writeTile("ink", 0, 0, fillOpaque(10));
    store.writeTile("ink", 1, 0, fillOpaque(11));
    store.writeTile("color", 0, 0, fillOpaque(20));
    store.writeTile("color", 1, 0, fillOpaque(21));
    const rect = { x: 0, y: 0, width: 128, height: 64 };
    const first = store.queryViewport(rect, { layerIds: ["ink", "color"] });
    const firstByKey = new Map(first.map((tile) => [`${tile.layerId}/${tile.id}`, tile]));

    store.writeTile("ink", 0, 0, fillOpaque(99));
    const second = store.queryViewport(rect, { layerIds: ["ink", "color"] });
    const secondByKey = new Map(second.map((tile) => [`${tile.layerId}/${tile.id}`, tile]));

    expect(secondByKey.get("ink/0:0")).not.toBe(firstByKey.get("ink/0:0"));
    expect(secondByKey.get("ink/0:0")?.contentRevision)
      .toBeGreaterThan(firstByKey.get("ink/0:0")?.contentRevision ?? 0);
    expect(secondByKey.get("ink/1:0")).toBe(firstByKey.get("ink/1:0"));
    expect(secondByKey.get("color/0:0")).toBe(firstByKey.get("color/0:0"));
    expect(secondByKey.get("color/1:0")).toBe(firstByKey.get("color/1:0"));
    expect(store.viewportCacheStats()).toMatchObject({
      descriptorReuses: 1,
      layerHits: 1,
    });
  });
});

describe("studio tiled document store — residency and determinism", () => {
  it("refuses to evict pixels that are not durable yet", () => {
    const store = new StudioTiledDocumentStore(SMALL);
    store.writeTile("layer-a", 0, 0, fillOpaque(10));
    const bufferId = store.bufferIdAt("layer-a", 0, 0);
    expect(bufferId).not.toBeNull();

    const refused = store.evictBuffers([bufferId as number]);
    expect(refused.evicted).toEqual([]);
    expect(refused.skipped).toEqual([bufferId]);
    expect(store.stats().residentBytes).toBe(SMALL_TILE_BYTES);

    expect(store.markPersisted(bufferId as number, "tiledoc/doc/tiles/abc.bin")).toBe(true);
    const evicted = store.evictBuffers([bufferId as number]);
    expect(evicted.evicted).toEqual([bufferId]);
    expect(evicted.freedBytes).toBe(SMALL_TILE_BYTES);
    expect(store.stats().residentBytes).toBe(0);
    // Still retained: the tile exists, its pixels just are not decoded.
    expect(store.stats().retainedBytes).toBe(SMALL_TILE_BYTES);
    expect(store.readTilePixels("layer-a", 0, 0)).toBeNull();
    expect(store.writeTile("layer-a", 0, 0, fillOpaque(11)).status).toBe("evicted");
  });

  it("hydrates an evicted buffer back to writable", () => {
    const store = new StudioTiledDocumentStore(SMALL);
    store.writeTile("layer-a", 0, 0, fillOpaque(10));
    const bufferId = store.bufferIdAt("layer-a", 0, 0) as number;
    store.markPersisted(bufferId, "tiledoc/doc/tiles/abc.bin");
    store.evictBuffers([bufferId]);

    expect(store.hydrateBuffer(bufferId, new Uint8ClampedArray(4))).toBe(false);
    const restored = new Uint8ClampedArray(SMALL_TILE_BYTES);
    restored.fill(255);
    expect(store.hydrateBuffer(bufferId, restored)).toBe(true);
    expect(store.hydrateBuffer(bufferId, restored)).toBe(false);
    expect(store.readTilePixels("layer-a", 0, 0)?.[0]).toBe(255);
    expect(store.stats().residentBytes).toBe(SMALL_TILE_BYTES);
  });

  it("describes residency with history-only and pinned classification", () => {
    const store = new StudioTiledDocumentStore(SMALL);
    store.writeTile("layer-a", 0, 0, fillOpaque(10));
    const snapshot = store.snapshot("v1");
    store.writeTile("layer-a", 0, 0, fillOpaque(20));

    const entries = store.describeResidency([2]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ bufferId: 1, historyOnly: true, pinned: false });
    expect(entries[1]).toMatchObject({ bufferId: 2, historyOnly: false, pinned: true });
    expect(entries.every((entry) => entry.resident && !entry.persisted)).toBe(true);
    expect(entries[0].lastUsed).toBeLessThan(entries[1].lastUsed);
    // Without an explicit pin, a current-document tile is still LRU-evictable.
    expect(store.describeResidency()[1].pinned).toBe(false);

    store.releaseSnapshot(snapshot);
    expect(store.describeResidency().map((entry) => entry.bufferId)).toEqual([2]);
  });

  it("produces identical state for identical operation sequences", () => {
    const run = () => {
      const store = new StudioTiledDocumentStore(SMALL);
      paintAllTiles(store, "layer-a", 3);
      const snapshot = store.snapshot("v1");
      store.writeTile("layer-a", 1, 1, fillOpaque(7));
      store.writeTile("layer-b", 2, 2, fillOpaque(8));
      store.snapshot("v2");
      store.writeTile("layer-a", 1, 1, eraseAll);
      store.restore(snapshot);
      store.writeTile("layer-a", 0, 3, fillOpaque(9));
      return {
        stats: store.stats(),
        layers: store.layerIds(),
        viewport: store.queryViewport({ x: 0, y: 0, width: 256, height: 256 }),
        digests: store.describeResidency()
          .map((entry) => `${entry.bufferId}:${store.bufferDigest(entry.bufferId)}`),
      };
    };
    const first = run();
    const second = run();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.digests.length).toBeGreaterThan(0);
  });

  it("caches a digest until the tile is written again", () => {
    const store = new StudioTiledDocumentStore(SMALL);
    store.writeTile("layer-a", 0, 0, fillOpaque(10));
    const bufferId = store.bufferIdAt("layer-a", 0, 0) as number;
    const digest = store.bufferDigest(bufferId);
    expect(digest).toMatch(/^[0-9a-f]{32}$/u);
    expect(store.bufferDigest(bufferId)).toBe(digest);

    store.markPersisted(bufferId, "key");
    expect(store.bufferBlobKey(bufferId)).toBe("key");
    store.writeTile("layer-a", 0, 0, fillOpaque(11));
    // A write invalidates both the digest and the durability claim.
    expect(store.bufferBlobKey(bufferId)).toBeNull();
    expect(store.bufferDigest(bufferId)).not.toBe(digest);
    expect(store.bufferDigest(999)).toBeNull();
  });

  it("drops everything on dispose", () => {
    const store = new StudioTiledDocumentStore(SMALL);
    paintAllTiles(store, "layer-a", 1);
    store.snapshot("v1");
    store.dispose();
    expect(store.stats()).toMatchObject({
      distinctBufferCount: 0,
      residentBytes: 0,
      retainedBytes: 0,
      currentTileCount: 0,
      snapshotCount: 0,
    });
  });
});
