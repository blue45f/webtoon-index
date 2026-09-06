import { describe, expect, it } from "vitest";

import { STUDIO_TILEDOC_TILE_BYTES } from "./studio-tiledoc-geometry";
import {
  STUDIO_TILEDOC_BASE64_RATIO,
  planStudioTileDocMigration,
  studioTileDocEncodedHistoryBytes,
  studioTileDocFullPageBytes,
  studioTileDocHistoryModel,
  studioTileDocViewportResidentBytes,
} from "./studio-tiledoc-migration";

const MIB = 1024 * 1024;

describe("studio tiled document cost model", () => {
  it("quantifies the current full-page-bitmap model", () => {
    // One 4000x6000 RGBA layer bitmap.
    expect(studioTileDocFullPageBytes({ width: 4000, height: 6000, layerCount: 1 }))
      .toBe(96_000_000);
    // 20 layers of the same page, all decoded at once.
    expect(studioTileDocFullPageBytes({ width: 4000, height: 6000, layerCount: 20 }))
      .toBe(1_920_000_000);
    // Long-scroll strip at the project's 100,000px height cap, authored at 2x width.
    expect(studioTileDocFullPageBytes({ width: 1440, height: 100_000, layerCount: 1 }))
      .toBe(576_000_000);
    expect(studioTileDocFullPageBytes({ width: 1440, height: 100_000, layerCount: 20 }))
      .toBe(11_520_000_000);
  });

  it("quantifies what today's history retains as encoded data URLs", () => {
    expect(STUDIO_TILEDOC_BASE64_RATIO).toBeCloseTo(1.3333, 4);
    // 50 destructive edits, each re-encoding the whole 4000x6000 layer at ~10% PNG ratio.
    expect(studioTileDocEncodedHistoryBytes({ width: 4000, height: 6000, edits: 50 }))
      .toBe(640_000_000);
    expect(studioTileDocEncodedHistoryBytes({ width: 4000, height: 6000, edits: 1 }))
      .toBe(12_800_000);
    expect(studioTileDocEncodedHistoryBytes({ width: 4000, height: 6000, edits: 0 })).toBe(0);
  });

  it("measures the copy-on-write saving for a realistic undo run", () => {
    // A 4000x6000 layer is 96 tiles. 50 brush strokes, each dirtying 2 tiles.
    const model = studioTileDocHistoryModel({
      baseTiles: 96,
      edits: 50,
      tilesPerEdit: 2,
      tileBytes: STUDIO_TILEDOC_TILE_BYTES,
    });
    expect(model.copyOnWriteTiles).toBe(196);
    expect(model.naiveTiles).toBe(4896);
    expect(model.copyOnWriteBytes).toBe(196 * MIB);
    expect(model.naiveBytes).toBe(4896 * MIB);
    expect(model.savedBytes).toBe(4700 * MIB);
    expect(model.ratio).toBeCloseTo(24.98, 2);

    // A one-tile edit is the common case and is even cheaper.
    expect(studioTileDocHistoryModel({
      baseTiles: 96,
      edits: 50,
      tilesPerEdit: 1,
      tileBytes: STUDIO_TILEDOC_TILE_BYTES,
    }).ratio).toBeCloseTo(33.53, 2);

    expect(studioTileDocHistoryModel({
      baseTiles: 0,
      edits: 0,
      tilesPerEdit: 0,
      tileBytes: STUDIO_TILEDOC_TILE_BYTES,
    })).toMatchObject({ copyOnWriteBytes: 0, naiveBytes: 0, ratio: 0 });
  });
});

describe("studio tiled document migration planning", () => {
  it("slices a sparse 20-layer page and reports the saving", () => {
    // 20 layers, each holding one panel's worth of ink (a 1024x1024 patch of the page).
    const layers = Array.from({ length: 20 }, (unused, index) => ({
      id: `layer-${index}`,
      bounds: {
        x: (index % 4) * 1024,
        y: Math.floor(index / 4) * 1024,
        width: 1024,
        height: 1024,
      },
      coverage: 1,
    }));
    const plan = planStudioTileDocMigration({
      documentWidth: 4096,
      documentHeight: 6144,
      layers,
    });

    // Each 1024x1024 patch spans 2x2 = 4 tiles at 512px.
    expect(plan.layers[0].tileCount).toBe(4);
    expect(plan.layers[0].tiles.map((tile) => tile.id)).toEqual(["0:0", "1:0", "0:1", "1:1"]);
    expect(plan.totalTileCount).toBe(80);
    expect(plan.tiledBytes).toBe(80 * MIB);
    expect(plan.tiledBytes).toBe(83_886_080);
    // A tile-aligned document has no grid padding.
    expect(plan.gridOverheadBytes).toBe(0);

    // Against the model this replaces — one full-page bitmap per layer, ink or not.
    const fullPage = studioTileDocFullPageBytes({
      width: 4096,
      height: 6144,
      layerCount: 20,
    });
    expect(fullPage).toBe(2_013_265_920);
    expect(fullPage / plan.tiledBytes).toBe(24);
  });

  it("honours a coverage estimate so mostly-empty layers cost almost nothing", () => {
    const plan = planStudioTileDocMigration({
      documentWidth: 720,
      documentHeight: 100_000,
      layers: [
        { id: "ink", bounds: { x: 0, y: 0, width: 720, height: 100_000 }, coverage: 0.08 },
      ],
    });
    // Full strip coverage would be 2 x 196 = 392 tiles.
    expect(plan.totalTileCount).toBe(392);
    expect(plan.retainedTileCount).toBe(Math.ceil(392 * 0.08));
    expect(plan.retainedTileCount).toBe(32);
    expect(plan.tiledBytes).toBe(32 * MIB);
    expect(plan.legacyBytes).toBe(720 * 100_000 * 4);
    expect(plan.legacyBytes).toBe(288_000_000);
    expect(plan.ratio).toBeCloseTo(8.58, 2);
  });

  it("is honest that a fully opaque layer costs slightly more when tiled", () => {
    const plan = planStudioTileDocMigration({
      documentWidth: 4000,
      documentHeight: 6000,
      layers: [{ id: "flat", bounds: { x: 0, y: 0, width: 4000, height: 6000 } }],
    });
    expect(plan.totalTileCount).toBe(96);
    expect(plan.tiledBytes).toBe(96 * MIB);
    expect(plan.tiledBytes).toBe(100_663_296);
    expect(plan.legacyBytes).toBe(96_000_000);
    expect(plan.savedBytes).toBeLessThan(0);
    // 4.86% grid padding: the page rounds up to 4096x6144.
    expect(plan.ratio).toBeCloseTo(0.9537, 4);
  });

  it("clamps layer bitmaps that hang off the document", () => {
    const plan = planStudioTileDocMigration({
      documentWidth: 1024,
      documentHeight: 1024,
      layers: [{ id: "overhang", bounds: { x: -600, y: -600, width: 700, height: 700 } }],
    });
    expect(plan.layers[0].tiles.map((tile) => tile.id)).toEqual(["0:0"]);
    expect(plan.retainedTileCount).toBe(1);

    const outside = planStudioTileDocMigration({
      documentWidth: 1024,
      documentHeight: 1024,
      layers: [{ id: "gone", bounds: { x: -900, y: -900, width: 100, height: 100 } }],
    });
    expect(outside.totalTileCount).toBe(0);
    expect(outside.tiledBytes).toBe(0);
    expect(outside.ratio).toBe(0);
  });

  it("bounds resident bytes by the viewport, not the document height", () => {
    const shortStrip = studioTileDocViewportResidentBytes({
      viewportWidth: 720,
      viewportHeight: 1600,
      layerCount: 20,
    });
    const longStrip = studioTileDocViewportResidentBytes({
      viewportWidth: 720,
      viewportHeight: 1600,
      layerCount: 20,
    });
    expect(shortStrip).toBe(longStrip);
    // (ceil(720/512)+1+2) x (ceil(1600/512)+1+2) = 5 x 7 = 35 tiles per layer.
    expect(shortStrip).toBe(35 * 20 * MIB);

    expect(studioTileDocViewportResidentBytes({
      viewportWidth: 720,
      viewportHeight: 1600,
      layerCount: 20,
      overscanTiles: 0,
    })).toBe(3 * 5 * 20 * MIB);
  });
});
