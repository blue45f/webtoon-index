import { describe, it, expect } from "vitest";

import { StudioAssetBatchInserter, type BatchInsertItem } from "./studio-asset-batch-inserter";

describe("StudioAssetBatchInserter", () => {
  function sampleItems(): BatchInsertItem[] {
    return [
      { id: "item-1", name: "말풍선 1", type: "bubble", width: 180, height: 120 },
      { id: "item-2", name: "3D 의자", type: "3d-model", width: 200, height: 200 },
      { id: "item-3", name: "스티커 1", type: "sticker", width: 100, height: 100 },
    ];
  }

  it("layouts items in grid mode with spacing and zIndex", () => {
    const items = sampleItems();
    const placed = StudioAssetBatchInserter.layoutBatchItems(items, {
      mode: "grid",
      spacing: 20,
      startX: 50,
      startY: 50,
      baseZIndex: 10,
    });

    expect(placed.length).toBe(3);
    expect(placed[0].x).toBe(50);
    expect(placed[0].y).toBe(50);
    expect(placed[0].zIndex).toBe(10);

    expect(placed[1].x).toBe(50 + 180 + 20); // 250
    expect(placed[1].zIndex).toBe(11);
  });

  it("layouts items in horizontal mode", () => {
    const items = sampleItems();
    const placed = StudioAssetBatchInserter.layoutBatchItems(items, {
      mode: "horizontal",
      spacing: 15,
      startX: 0,
      startY: 100,
    });

    expect(placed[0].x).toBe(0);
    expect(placed[1].x).toBe(180 + 15);
    expect(placed[2].x).toBe(180 + 15 + 200 + 15);
  });

  it("layouts items centered", () => {
    const items = [sampleItems()[0]];
    const placed = StudioAssetBatchInserter.layoutBatchItems(items, {
      mode: "centered",
      spacing: 0,
      startX: 500,
      startY: 500,
    });

    expect(placed[0].x).toBe(500 - 90);
    expect(placed[0].y).toBe(500 - 60);
  });

  it("provides default dimensions for all asset types", () => {
    expect(StudioAssetBatchInserter.getDefaultDimensions("bubble")).toEqual({ width: 180, height: 120 });
    expect(StudioAssetBatchInserter.getDefaultDimensions("3d-model")).toEqual({ width: 300, height: 300 });
    expect(StudioAssetBatchInserter.getDefaultDimensions("sticker")).toEqual({ width: 120, height: 120 });
    expect(StudioAssetBatchInserter.getDefaultDimensions("background")).toEqual({ width: 800, height: 1200 });
  });
});
