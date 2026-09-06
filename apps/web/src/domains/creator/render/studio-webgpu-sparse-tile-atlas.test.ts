import { describe, expect, it } from "vitest";

import { StudioGpuSparseTileAtlas } from "./studio-webgpu-sparse-tile-atlas";

function prepared(
  atlas: StudioGpuSparseTileAtlas,
  frameId: string,
  tileIds: readonly string[],
) {
  const result = atlas.prepareFrame(frameId, tileIds);
  expect(result.status).toBe("prepared");
  if (result.status !== "prepared") throw new Error(result.reason);
  return result.frame;
}

describe("Studio WebGPU sparse physical tile atlas", () => {
  it("assigns stable physical slots and reuses them across completed frames", () => {
    const atlas = new StudioGpuSparseTileAtlas({
      columns: 2,
      rows: 1,
      tileSize: 128,
      bleed: 2,
    });
    const first = prepared(atlas, "frame-1", ["0:0", "1:0"]);
    expect(first.assignments).toEqual([
      {
        logicalTileId: "0:0",
        slot: 0,
        column: 0,
        row: 0,
        pixelX: 0,
        pixelY: 0,
        physicalExtent: 132,
      },
      {
        logicalTileId: "1:0",
        slot: 1,
        column: 1,
        row: 0,
        pixelX: 132,
        pixelY: 0,
        physicalExtent: 132,
      },
    ]);
    expect(atlas.completeFrame(first.token).status).toBe("completed");

    const second = prepared(atlas, "frame-2", ["1:0", "0:0"]);
    expect(second.hits).toBe(2);
    expect(second.misses).toBe(0);
    expect(second.assignments.map(({ slot }) => slot)).toEqual([1, 0]);
    expect(atlas.completeFrame(second.token).status).toBe("completed");
    expect(atlas.stats()).toMatchObject({
      capacity: 2,
      atlasWidth: 264,
      atlasHeight: 132,
      residentTiles: 2,
      hits: 2,
      misses: 2,
      evictions: 0,
    });
  });

  it("evicts the least recently used inactive mapping deterministically", () => {
    const atlas = new StudioGpuSparseTileAtlas({ columns: 2, rows: 1 });
    const first = prepared(atlas, "seed", ["A", "B"]);
    atlas.completeFrame(first.token);
    const touchB = prepared(atlas, "touch-b", ["B"]);
    atlas.completeFrame(touchB.token);

    const insertC = prepared(atlas, "insert-c", ["C"]);
    expect(insertC.evictions).toBe(1);
    expect(insertC.assignments[0]?.slot).toBe(0);
    atlas.completeFrame(insertC.token);

    expect(atlas.lookup("A")).toBeNull();
    expect(atlas.lookup("B")?.slot).toBe(1);
    expect(atlas.lookup("C")?.slot).toBe(0);
    expect(atlas.stats().evictions).toBe(1);
  });

  it("pins every requested tile while selecting an eviction candidate", () => {
    const atlas = new StudioGpuSparseTileAtlas({ columns: 2, rows: 1 });
    const first = prepared(atlas, "seed", ["A", "B"]);
    atlas.completeFrame(first.token);

    const replacement = prepared(atlas, "replace", ["A", "C"]);
    expect(replacement.assignments.map(({ logicalTileId, slot }) => ({
      logicalTileId,
      slot,
    }))).toEqual([
      { logicalTileId: "A", slot: 0 },
      { logicalTileId: "C", slot: 1 },
    ]);
    atlas.completeFrame(replacement.token);
    expect(atlas.lookup("A")?.slot).toBe(0);
    expect(atlas.lookup("B")).toBeNull();
    expect(atlas.lookup("C")?.slot).toBe(1);
  });

  it("rolls tentative evictions back when a frame is aborted", () => {
    const atlas = new StudioGpuSparseTileAtlas({ columns: 2, rows: 1 });
    const first = prepared(atlas, "seed", ["A", "B"]);
    atlas.completeFrame(first.token);
    const before = atlas.stats();

    const replacement = prepared(atlas, "aborted", ["C"]);
    expect(replacement.evictions).toBe(1);
    expect(atlas.abortFrame(replacement.token).status).toBe("aborted");

    expect(atlas.lookup("A")?.slot).toBe(0);
    expect(atlas.lookup("B")?.slot).toBe(1);
    expect(atlas.lookup("C")).toBeNull();
    expect(atlas.stats()).toMatchObject({
      hits: before.hits,
      misses: before.misses,
      evictions: before.evictions,
      residentTiles: 2,
    });
  });

  it("allows only one prepared frame and revokes tokens on device reset", () => {
    const atlas = new StudioGpuSparseTileAtlas({ columns: 1, rows: 1 });
    const first = prepared(atlas, "frame-1", ["A"]);
    expect(atlas.prepareFrame("frame-2", ["B"])).toEqual({
      status: "rejected",
      reason: "busy",
      activeFrameId: "frame-1",
    });

    expect(atlas.resetDevice()).toBe(2);
    expect(atlas.completeFrame(first.token)).toEqual({
      status: "rejected",
      reason: "stale-generation",
    });
    expect(atlas.stats()).toMatchObject({
      deviceGeneration: 2,
      residentTiles: 0,
      activeFrameId: null,
    });
  });

  it("fails closed for invalid requests, capacity overflow and disposal", () => {
    const atlas = new StudioGpuSparseTileAtlas({ columns: 1, rows: 1 });
    expect(atlas.prepareFrame("duplicates", ["A", "A"])).toEqual({
      status: "rejected",
      reason: "capacity",
    });
    expect(atlas.prepareFrame("too-many", ["A", "B"])).toEqual({
      status: "rejected",
      reason: "capacity",
    });
    expect(atlas.prepareFrame("", [])).toEqual({
      status: "rejected",
      reason: "invalid-input",
    });

    atlas.dispose();
    expect(atlas.prepareFrame("after-dispose", [])).toEqual({
      status: "rejected",
      reason: "disposed",
    });
    expect(() => new StudioGpuSparseTileAtlas({
      columns: 200,
      rows: 1,
      tileSize: 128,
      bleed: 2,
      maximumTextureDimension2D: 1_024,
    })).toThrow("sparse tile atlas exceeds device limits");
  });
});
