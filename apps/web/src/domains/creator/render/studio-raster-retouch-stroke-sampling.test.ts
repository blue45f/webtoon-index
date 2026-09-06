import { describe, expect, it } from "vitest";

import {
  appendStudioRasterRetouchDragPoint,
  STUDIO_RASTER_RETOUCH_APPLY_MAX_POINTS,
  STUDIO_RASTER_RETOUCH_DRAG_MAX_POINTS,
  thinStudioRasterRetouchPointsForApply,
} from "./studio-raster-retouch-stroke-sampling";

import type { SelPoint } from "../studio-selection-tools";

function point(x: number, y: number): SelPoint {
  return { x, y };
}

describe("studio raster retouch stroke sampling", () => {
  it("spaces drag samples by brush radius instead of packing every pointer event", () => {
    const points: SelPoint[] = [];
    expect(appendStudioRasterRetouchDragPoint(points, point(0.1, 0.1), 0.05)).toBe(true);
    // Tiny move under brush spacing must not append.
    expect(appendStudioRasterRetouchDragPoint(points, point(0.101, 0.1), 0.05)).toBe(false);
    expect(points).toHaveLength(1);
    expect(appendStudioRasterRetouchDragPoint(points, point(0.2, 0.1), 0.05)).toBe(true);
    expect(points).toHaveLength(2);
  });

  it("caps drag journals and preserves the latest tip", () => {
    const points: SelPoint[] = Array.from(
      { length: STUDIO_RASTER_RETOUCH_DRAG_MAX_POINTS },
      (_, i) => point(i * 0.0001, 0.2),
    );
    expect(
      appendStudioRasterRetouchDragPoint(points, point(0.99, 0.55), 0.05),
    ).toBe(true);
    expect(points).toHaveLength(STUDIO_RASTER_RETOUCH_DRAG_MAX_POINTS);
    expect(points[points.length - 1]).toEqual(point(0.99, 0.55));
  });

  it("thins bake input while keeping endpoints", () => {
    const dense = Array.from({ length: 2_000 }, (_, i) => point(i / 2_000, 0.4));
    const thinned = thinStudioRasterRetouchPointsForApply(dense);
    expect(thinned.length).toBeLessThanOrEqual(STUDIO_RASTER_RETOUCH_APPLY_MAX_POINTS);
    expect(thinned[0]).toEqual(dense[0]);
    expect(thinned[thinned.length - 1]).toEqual(dense[dense.length - 1]);
    expect(thinStudioRasterRetouchPointsForApply(dense.slice(0, 3))).toHaveLength(3);
  });
});
