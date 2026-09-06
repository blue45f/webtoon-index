import { describe, expect, it } from "vitest";

import {
  StudioTileDocDirtyTracker,
  emptyStudioTileDocDirtyRegion,
  studioTileDocDirtyRegionForRect,
} from "./studio-tiledoc-dirty";
import { studioTileDocGridTileCount } from "./studio-tiledoc-geometry";

const PAGE = { width: 4000, height: 6000 } as const;

describe("studio tiled document dirty tracking", () => {
  it("coalesces a whole stroke into the tiles it actually crosses", () => {
    const tracker = new StudioTileDocDirtyTracker({ bounds: PAGE });
    // 200 dab footprints scrubbing a 60x40 patch that straddles the 512px column boundary.
    for (let sample = 0; sample < 200; sample += 1) {
      tracker.addPoint(500 + (sample % 61), 100 + (sample % 41), 6);
    }
    const region = tracker.take();

    expect(region.rectCount).toBe(200);
    expect(region.acceptedRectCount).toBe(200);
    expect(region.overflowed).toBe(false);
    // Two tiles out of the page's 96 — the stroke does not invalidate the world.
    expect(region.tiles.map((tile) => tile.id)).toEqual(["0:0", "1:0"]);
    expect(studioTileDocGridTileCount(PAGE)).toBe(96);
    expect(region.bounds).toEqual({ x: 494, y: 94, width: 72, height: 52 });
    // Sub-rects are clipped per tile so an uploader can do partial writes.
    expect(region.tiles[0].rect).toEqual({ x: 494, y: 94, width: 18, height: 52 });
    expect(region.tiles[1].rect).toEqual({ x: 512, y: 94, width: 54, height: 52 });
    expect(region.tiles.every((tile) => tile.full)).toBe(false);
  });

  it("unions overlapping rects inside one tile into a single entry", () => {
    const tracker = new StudioTileDocDirtyTracker({ bounds: PAGE });
    tracker.addRect({ x: 10, y: 10, width: 20, height: 20 });
    tracker.addRect({ x: 20, y: 20, width: 20, height: 20 });
    tracker.addRect({ x: 15, y: 5, width: 5, height: 5 });
    expect(tracker.dirtyTileCount).toBe(1);

    const region = tracker.peek();
    expect(region.tiles).toHaveLength(1);
    expect(region.tiles[0].rect).toEqual({ x: 10, y: 5, width: 30, height: 35 });
    expect(tracker.isEmpty).toBe(false);
    // peek does not drain.
    expect(tracker.peek().tiles).toHaveLength(1);
  });

  it("aligns fractional rects outward so no touched pixel is missed", () => {
    const region = studioTileDocDirtyRegionForRect(
      { x: 10.4, y: 10.6, width: 5.2, height: 5.2 },
      { bounds: PAGE }
    );
    expect(region.bounds).toEqual({ x: 10, y: 10, width: 6, height: 6 });
    expect(region.tiles[0].rect).toEqual({ x: 10, y: 10, width: 6, height: 6 });
  });

  it("marks a tile full only when the dirty box covers the whole cell", () => {
    const region = studioTileDocDirtyRegionForRect(
      { x: 0, y: 0, width: 512, height: 512 },
      { bounds: PAGE }
    );
    expect(region.tiles).toHaveLength(1);
    expect(region.tiles[0].full).toBe(true);
  });

  it("clips off-canvas and negative edits to the document", () => {
    const tracker = new StudioTileDocDirtyTracker({ bounds: PAGE });
    tracker.addRect({ x: -300, y: -300, width: 400, height: 400 });
    // Inside the last tile column (tile 7 spans 3584..4096) but past the 4000px document edge.
    tracker.addRect({ x: 4050, y: 10, width: 10, height: 10 });
    // Entirely outside every tile the document owns.
    tracker.addRect({ x: -900, y: -900, width: 100, height: 100 });

    const region = tracker.take();
    expect(region.rectCount).toBe(3);
    expect(region.acceptedRectCount).toBe(1);
    expect(region.tiles.map((tile) => tile.id)).toEqual(["0:0"]);
    expect(region.tiles[0].rect).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("keeps negative tiles when the tracker is unbounded", () => {
    const region = studioTileDocDirtyRegionForRect({ x: -1, y: -1, width: 2, height: 2 });
    expect(region.tiles.map((tile) => tile.id))
      .toEqual(["-1:-1", "0:-1", "-1:0", "0:0"]);
  });

  it("degrades to bounding-box mode past the tile cap and still reports every tile", () => {
    const tracker = new StudioTileDocDirtyTracker({ bounds: PAGE, maxTiles: 4 });
    tracker.addRect({ x: 0, y: 0, width: 1400, height: 1400 }); // 3x3 = 9 tiles > cap
    expect(tracker.dirtyTileCount).toBe(9);

    const region = tracker.take();
    expect(region.overflowed).toBe(true);
    expect(region.tiles).toHaveLength(9);
    expect(region.tiles.every((tile) => tile.full)).toBe(true);
    expect(region.tiles.map((tile) => tile.id)).toEqual([
      "0:0", "1:0", "2:0",
      "0:1", "1:1", "2:1",
      "0:2", "1:2", "2:2",
    ]);
  });

  it("drains and resets on take", () => {
    const tracker = new StudioTileDocDirtyTracker({ bounds: PAGE });
    expect(tracker.isEmpty).toBe(true);
    expect(tracker.take()).toBe(emptyStudioTileDocDirtyRegion());
    tracker.addRect({ x: 0, y: 0, width: 10, height: 10 });
    expect(tracker.take().tiles).toHaveLength(1);
    expect(tracker.isEmpty).toBe(true);
    expect(tracker.take().tiles).toHaveLength(0);
  });

  it("is deterministic for the same input sequence", () => {
    const run = () => {
      const tracker = new StudioTileDocDirtyTracker({ bounds: PAGE });
      for (let sample = 0; sample < 50; sample += 1) {
        tracker.addPoint(400 + sample * 13, 300 + sample * 7, 9);
      }
      return JSON.stringify(tracker.take());
    };
    expect(run()).toBe(run());
  });
});
