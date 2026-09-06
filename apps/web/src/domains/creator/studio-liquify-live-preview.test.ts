import { describe, expect, it } from "vitest";

import {
  estimateStudioLiquifyStrokeRoiPixels,
  mapLiquifyRoiToDocumentFrame,
  planStudioLiquifyLivePreview,
  STUDIO_LIQUIFY_LIVE_PREVIEW_MAX_ROI_PIXELS,
  studioLiquifyLivePreviewScale,
} from "./studio-liquify-live-preview";

describe("studio liquify live preview plan", () => {
  it("never upscales and caps the longest edge on the downscale fallback", () => {
    expect(studioLiquifyLivePreviewScale(200, 100, 384)).toBe(1);
    expect(studioLiquifyLivePreviewScale(2000, 1000, 384)).toBeCloseTo(384 / 2000, 6);
  });

  it("prefers full-resolution ROI for compact brush footprints", () => {
    const points = Array.from({ length: 40 }, (_, index) => ({
      x: 0.4 + index * 0.002,
      y: 0.5,
      pressure: 0.7,
    }));
    const plan = planStudioLiquifyLivePreview({
      points,
      sourceWidth: 2000,
      sourceHeight: 1000,
      elementWidth: 500,
      radiusCanvasPx: 40,
    });
    expect(plan).not.toBeNull();
    expect(plan!.mode).toBe("roi-full-res");
    expect(plan!.scale).toBe(1);
    expect(plan!.width).toBe(2000);
    expect(plan!.height).toBe(1000);
    expect(plan!.points.length).toBeLessThanOrEqual(96);
    expect(plan!.estimatedRoiPixels).toBeLessThanOrEqual(
      STUDIO_LIQUIFY_LIVE_PREVIEW_MAX_ROI_PIXELS,
    );
    // Device points stay in full source space (not downscaled).
    expect(plan!.points[0]!.x).toBeCloseTo(0.4 * 2000, 5);
  });

  it("falls back to frame downscale when ROI would be huge", () => {
    const points = Array.from({ length: 200 }, (_, index) => ({
      x: index / 199,
      y: 0.4,
      pressure: 0.7,
    }));
    const plan = planStudioLiquifyLivePreview({
      points,
      sourceWidth: 4000,
      sourceHeight: 4000,
      elementWidth: 1000,
      radiusCanvasPx: 200,
      forceDownscale: true,
    });
    expect(plan).not.toBeNull();
    expect(plan!.mode).toBe("frame-downscale");
    expect(plan!.width).toBeLessThanOrEqual(384);
    expect(plan!.points[0]!.x).toBeCloseTo(0, 5);
  });

  it("returns null for empty journals", () => {
    expect(
      planStudioLiquifyLivePreview({
        points: [],
        sourceWidth: 100,
        sourceHeight: 100,
        elementWidth: 100,
        radiusCanvasPx: 20,
      }),
    ).toBeNull();
  });

  it("maps ROI rects into document frames with optional flips", () => {
    const mapped = mapLiquifyRoiToDocumentFrame(
      { x: 100, y: 50, width: 200, height: 100 },
      1000,
      500,
      { x: 10, y: 20, width: 400, height: 200, rotation: 0 },
      false,
      false,
    );
    expect(mapped.x).toBeCloseTo(10 + 40, 5);
    expect(mapped.y).toBeCloseTo(20 + 20, 5);
    expect(mapped.width).toBeCloseTo(80, 5);
    expect(mapped.height).toBeCloseTo(40, 5);

    const flipped = mapLiquifyRoiToDocumentFrame(
      { x: 100, y: 50, width: 200, height: 100 },
      1000,
      500,
      { x: 10, y: 20, width: 400, height: 200, rotation: 0 },
      true,
      false,
    );
    expect(flipped.scaleX).toBe(-1);
    expect(flipped.x).toBeCloseTo(10 + 400 - 40, 5);
  });

  it("estimates compact ROI for short strokes", () => {
    const pixels = estimateStudioLiquifyStrokeRoiPixels(
      [{ x: 100, y: 100 }, { x: 120, y: 105 }],
      40,
      2000,
      2000,
    );
    expect(pixels).toBeLessThan(2000 * 2000);
    expect(pixels).toBeGreaterThan(40 * 40);
  });
});
