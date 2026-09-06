import { describe, expect, it } from "vitest";

import {
  STUDIO_LIQUIFY_APPLY_MAX_POINTS,
  studioLiquifyDragMinDistance,
  studioLiquifyTrailCanvasPoints,
  thinStudioLiquifyPointsForApply,
  thinStudioLiquifyPointsForPreview,
} from "./studio-liquify-stroke-sampling";

function line(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    x: index / Math.max(1, count - 1),
    y: 0.5,
    pressure: 0.6,
  }));
}

describe("studio liquify stroke sampling", () => {
  it("spaces journal thresholds by brush radius", () => {
    expect(studioLiquifyDragMinDistance(0.05)).toBeCloseTo(0.011, 5);
    expect(studioLiquifyDragMinDistance(0)).toBe(0.004);
    expect(studioLiquifyDragMinDistance(1)).toBe(0.08);
  });

  it("thins long journals while keeping endpoints and pressure on samples", () => {
    const points = line(2_000);
    const thinned = thinStudioLiquifyPointsForApply(points);
    expect(thinned.length).toBeLessThanOrEqual(STUDIO_LIQUIFY_APPLY_MAX_POINTS);
    expect(thinned[0]).toEqual(points[0]);
    expect(thinned[thinned.length - 1]).toEqual(points[points.length - 1]);
    expect(thinned.every((point) => point.pressure === 0.6)).toBe(true);

    const preview = thinStudioLiquifyPointsForPreview(points);
    expect(preview.length).toBeLessThanOrEqual(96);
    expect(preview[0]).toEqual(points[0]);
  });

  it("builds a short Konva trail from normalized samples", () => {
    const flat = studioLiquifyTrailCanvasPoints(line(100), { width: 200, height: 100 }, 8);
    expect(flat.length).toBeGreaterThanOrEqual(4);
    expect(flat.length % 2).toBe(0);
    expect(flat[0]).toBe(0);
    expect(flat[flat.length - 2]).toBeCloseTo(200, 5);
  });
});
