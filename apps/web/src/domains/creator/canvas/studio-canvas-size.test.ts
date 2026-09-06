import { describe, expect, it } from "vitest";

import { CANVAS_W } from "../studio-assets";

import {
  adjustStudioCanvasHeight,
  clampStudioCanvasHeight,
  nearestStudioCanvasHeightPresetId,
  studioCanvasAspectLabel,
  studioCanvasAspectPreviewRect,
  studioCanvasSizeSummary,
  STUDIO_CANVAS_H_RANGE,
  STUDIO_CANVAS_HEIGHT_PRESETS,
} from "./studio-canvas-size";

describe("studio-canvas-size", () => {
  it("clamps height into safe page bounds", () => {
    expect(clampStudioCanvasHeight(10)).toBe(STUDIO_CANVAS_H_RANGE.min);
    expect(clampStudioCanvasHeight(99999)).toBe(STUDIO_CANVAS_H_RANGE.max);
    expect(clampStudioCanvasHeight(1080)).toBe(1080);
  });

  it("adjusts height with clamp", () => {
    expect(adjustStudioCanvasHeight(480, -200)).toBe(STUDIO_CANVAS_H_RANGE.min);
    expect(adjustStudioCanvasHeight(720, 40)).toBe(760);
  });

  it("labels common aspects", () => {
    expect(studioCanvasAspectLabel(720, 720)).toBe("1:1");
    expect(studioCanvasAspectLabel(720, 1280)).toBe("9:16");
    expect(studioCanvasAspectLabel(720, 405)).toBe("16:9");
  });

  it("finds nearest height preset", () => {
    expect(nearestStudioCanvasHeightPresetId(CANVAS_W)).toBe("square");
    expect(nearestStudioCanvasHeightPresetId(999)).toBeNull();
  });

  it("builds centered preview rects", () => {
    const r = studioCanvasAspectPreviewRect(720, 720, 40);
    expect(r.w).toBeCloseTo(r.h, 5);
    expect(r.x + r.w).toBeLessThanOrEqual(40.01);
  });

  it("summarizes size for UI", () => {
    expect(studioCanvasSizeSummary(720, 720)).toContain("720×720");
    expect(STUDIO_CANVAS_HEIGHT_PRESETS.length).toBeGreaterThanOrEqual(5);
  });
});
