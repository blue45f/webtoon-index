import { describe, expect, it } from "vitest";

import {
  STUDIO_TILEDOC_TILE_BYTES,
  STUDIO_TILEDOC_TILE_FORMAT,
  STUDIO_TILEDOC_TILE_SIZE,
  alignStudioTileDocRect,
  intersectStudioTileDocRects,
  parseStudioTileDocTileId,
  resolveStudioTileDocTileSize,
  studioTileDocGridTileCount,
  studioTileDocTileCountForRect,
  studioTileDocTileId,
  studioTileDocTileRect,
  studioTileDocTileSpan,
  studioTileDocTilesForRect,
  unionStudioTileDocRects,
} from "./studio-tiledoc-geometry";
import { STUDIO_GPU_TILE_SIZE } from "./studio-webgpu-tile-plan";

describe("studio tiled document geometry", () => {
  it("keeps storage tiles on the compositor's 512px grid at exactly 1 MiB each", () => {
    expect(STUDIO_TILEDOC_TILE_SIZE).toBe(512);
    expect(STUDIO_TILEDOC_TILE_SIZE).toBe(STUDIO_GPU_TILE_SIZE);
    expect(STUDIO_TILEDOC_TILE_BYTES).toBe(1_048_576);
    expect(STUDIO_TILEDOC_TILE_FORMAT).toBe("rgba8-premultiplied");
    // Same id shape as studio-webgpu-tile-plan, so a query result needs no translation.
    expect(studioTileDocTileId(3, 7)).toBe("3:7");
    expect(parseStudioTileDocTileId("3:7")).toMatchObject({ column: 3, row: 7 });
    expect(parseStudioTileDocTileId("-2:-1")).toMatchObject({ column: -2, row: -1 });
    expect(parseStudioTileDocTileId("3:x")).toBeNull();
    expect(parseStudioTileDocTileId("3.5:1")).toBeNull();
  });

  it("treats rects as half-open so a boundary-aligned rect stays in one column", () => {
    expect(studioTileDocTileSpan({ x: 512, y: 0, width: 512, height: 1 })).toMatchObject({
      firstColumn: 1,
      lastColumn: 1,
    });
    expect(studioTileDocTileSpan({ x: 0, y: 0, width: 512, height: 512 })).toMatchObject({
      firstColumn: 0,
      lastColumn: 0,
      firstRow: 0,
      lastRow: 0,
    });
    expect(studioTileDocTileSpan({ x: 511, y: 0, width: 2, height: 1 })).toMatchObject({
      firstColumn: 0,
      lastColumn: 1,
    });
    // Fractional stroke bounds must still cover both touched pixels.
    expect(studioTileDocTileSpan({ x: 511.5, y: 0, width: 1, height: 1 })).toMatchObject({
      firstColumn: 0,
      lastColumn: 1,
    });
  });

  it("maps negative coordinates onto negative tile indices", () => {
    expect(studioTileDocTileSpan({ x: -1, y: -1, width: 2, height: 2 })).toEqual({
      firstColumn: -1,
      lastColumn: 0,
      firstRow: -1,
      lastRow: 0,
    });
    expect(studioTileDocTileSpan({ x: -600, y: 0, width: 100, height: 1 })).toMatchObject({
      firstColumn: -2,
      lastColumn: -1,
    });
    // With document bounds the off-canvas part is dropped instead of allocating negative tiles.
    expect(studioTileDocTileSpan(
      { x: -600, y: -600, width: 700, height: 700 },
      { bounds: { width: 4000, height: 6000 } }
    )).toEqual({ firstColumn: 0, lastColumn: 0, firstRow: 0, lastRow: 0 });
    expect(studioTileDocTileSpan(
      { x: -600, y: -600, width: 100, height: 100 },
      { bounds: { width: 4000, height: 6000 } }
    )).toBeNull();
  });

  it("rejects degenerate rects instead of inventing tiles", () => {
    expect(studioTileDocTileSpan({ x: 0, y: 0, width: 0, height: 10 })).toBeNull();
    expect(studioTileDocTileSpan({ x: 0, y: 0, width: -5, height: 10 })).toBeNull();
    expect(studioTileDocTileSpan({ x: Number.NaN, y: 0, width: 10, height: 10 })).toBeNull();
    expect(studioTileDocTileSpan({ x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 1 }))
      .toBeNull();
    expect(studioTileDocTilesForRect({ x: 0, y: 0, width: 0, height: 0 })).toEqual([]);
    expect(studioTileDocTileCountForRect({ x: 0, y: 0, width: 0, height: 0 })).toBe(0);
  });

  it("enumerates tiles row-major and counts a full page grid", () => {
    const tiles = studioTileDocTilesForRect({ x: 500, y: 500, width: 100, height: 100 });
    expect(tiles.map((tile) => tile.id)).toEqual(["0:0", "1:0", "0:1", "1:1"]);
    // 4000x6000 page: ceil(4000/512)=8 columns, ceil(6000/512)=12 rows.
    expect(studioTileDocGridTileCount({ width: 4000, height: 6000 })).toBe(96);
    expect(studioTileDocTileCountForRect(
      { x: 0, y: 0, width: 4000, height: 6000 }
    )).toBe(96);
    // 720x100000 long-scroll strip: 2 columns, 196 rows.
    expect(studioTileDocGridTileCount({ width: 720, height: 100_000 })).toBe(392);
  });

  it("provides tile rects, intersection, union and integer alignment", () => {
    expect(studioTileDocTileRect(2, 3)).toEqual({ x: 1024, y: 1536, width: 512, height: 512 });
    expect(intersectStudioTileDocRects(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 5, y: 5, width: 10, height: 10 }
    )).toEqual({ x: 5, y: 5, width: 5, height: 5 });
    expect(intersectStudioTileDocRects(
      { x: 0, y: 0, width: 5, height: 5 },
      { x: 5, y: 0, width: 5, height: 5 }
    )).toBeNull();
    expect(unionStudioTileDocRects(
      { x: 0, y: 0, width: 5, height: 5 },
      { x: 10, y: 10, width: 5, height: 5 }
    )).toEqual({ x: 0, y: 0, width: 15, height: 15 });
    expect(alignStudioTileDocRect({ x: 10.4, y: 10.6, width: 5.2, height: 5.2 }))
      .toEqual({ x: 10, y: 10, width: 6, height: 6 });
    expect(alignStudioTileDocRect({ x: 0, y: 0, width: 0, height: 1 })).toBeNull();
  });

  it("falls back to the default tile size for invalid overrides", () => {
    expect(resolveStudioTileDocTileSize(undefined)).toBe(512);
    expect(resolveStudioTileDocTileSize(0)).toBe(512);
    expect(resolveStudioTileDocTileSize(-64)).toBe(512);
    expect(resolveStudioTileDocTileSize(Number.NaN)).toBe(512);
    expect(resolveStudioTileDocTileSize(128)).toBe(128);
  });
});
