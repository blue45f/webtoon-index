import { describe, expect, it } from "vitest";

import {
  collageGridSlots,
  findStudioCollageLayout,
  listStudioCollageLayouts,
  materializeStudioCollage,
  planStudioCollageImagePlacements,
  STUDIO_COLLAGE_LAYOUTS,
  studioCollageLayoutIsValid,
  studioCollagePreviewRects,
} from "./studio-collage";

describe("studio-collage", () => {
  it("ships PicsArt-depth layouts with unique ids and valid slots", () => {
    const ids = STUDIO_COLLAGE_LAYOUTS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(18);
    for (const layout of STUDIO_COLLAGE_LAYOUTS) {
      expect(studioCollageLayoutIsValid(layout)).toBe(true);
      expect(layout.cells).toBe(layout.slots.length);
    }
  });

  it("filters by category", () => {
    const grids = listStudioCollageLayouts("grid");
    expect(grids.every((l) => l.category === "grid")).toBe(true);
    expect(grids.some((l) => l.id === "c3x3")).toBe(true);
  });

  it("builds uniform grid slots", () => {
    const slots = collageGridSlots(2, 2);
    expect(slots).toHaveLength(4);
    expect(slots[0]).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
    expect(slots[3]).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });

  it("materializes frames with gap and padding", () => {
    const layout = findStudioCollageLayout("c2x2")!;
    const result = materializeStudioCollage(layout, {
      canvasW: 720,
      canvasH: 720,
      padding: 20,
      gap: 10,
      borderWidth: 2,
      borderColor: "#16100c",
      cellBg: "#eee",
    });
    expect(result.frames).toHaveLength(4);
    expect(result.canvasH).toBe(720);
    for (const frame of result.frames) {
      expect(frame.width).toBeGreaterThan(50);
      expect(frame.height).toBeGreaterThan(50);
      expect(frame.groupId).toBe(result.groupId);
      expect(frame.strokeWidth).toBe(2);
      expect(frame.collageLayoutId).toBe("c2x2");
    }
    // Frames should not overlap when gap > 0
    const a = result.frames[0]!;
    const b = result.frames[1]!;
    expect(a.x + a.width).toBeLessThanOrEqual(b.x + 0.5);
  });

  it("plans cover placements into slots", () => {
    const layout = findStudioCollageLayout("c2h")!;
    const { frames } = materializeStudioCollage(layout, {
      canvasW: 720,
      canvasH: 400,
      padding: 0,
      gap: 0,
      borderWidth: 0,
      borderColor: "#000",
      cellBg: "#fff",
    });
    const placements = planStudioCollageImagePlacements(
      frames,
      [
        { id: "img-a", width: 100, height: 200 },
        { id: "img-b", width: 400, height: 100 },
      ],
      "cover"
    );
    expect(placements).toHaveLength(2);
    expect(placements[0]!.imageId).toBe("img-a");
    // Cover: height fills slot when image is portrait
    expect(placements[0]!.height).toBeGreaterThanOrEqual(frames[0]!.height - 1);
  });

  it("builds preview rects for tray tiles", () => {
    const layout = findStudioCollageLayout("c3x3")!;
    const rects = studioCollagePreviewRects(layout, 54, 54, 2, 3);
    expect(rects).toHaveLength(9);
    expect(rects.every((r) => r.w > 0 && r.h > 0)).toBe(true);
  });
});
