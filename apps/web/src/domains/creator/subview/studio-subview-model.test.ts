import { describe, expect, it } from "vitest";

import {
  clampSubViewZoom,
  DEFAULT_SUBVIEW_IMAGES,
  DEFAULT_SUBVIEW_STATE,
  normalizeRotationDeg,
  rgbToHex,
  samplePixelColorFromRgbaData,
} from "./studio-subview-model";

describe("studio-subview-model", () => {
  it("initializes with default sample reference images", () => {
    expect(DEFAULT_SUBVIEW_IMAGES.length).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_SUBVIEW_STATE.activeIndex).toBe(0);
    expect(DEFAULT_SUBVIEW_STATE.zoom).toBe(1.0);
    expect(DEFAULT_SUBVIEW_STATE.eyedropperActive).toBe(true);
  });

  it("clamps zoom within bounds and falls back on non-finite input", () => {
    expect(clampSubViewZoom(0.1)).toBe(0.25);
    expect(clampSubViewZoom(5.0)).toBe(4.0);
    expect(clampSubViewZoom(1.5)).toBe(1.5);
    expect(clampSubViewZoom(Number.NaN)).toBe(1.0);
  });

  it("normalizes rotation degrees cleanly", () => {
    expect(normalizeRotationDeg(360)).toBe(0);
    expect(normalizeRotationDeg(450)).toBe(90);
    expect(normalizeRotationDeg(-90)).toBe(270);
    expect(normalizeRotationDeg(Number.NaN)).toBe(0);
  });

  it("converts RGB numbers to hex strings", () => {
    expect(rgbToHex(255, 0, 0)).toBe("#ff0000");
    expect(rgbToHex(0, 255, 0)).toBe("#00ff00");
    expect(rgbToHex(0, 0, 255)).toBe("#0000ff");
    expect(rgbToHex(24, 30, 42)).toBe("#181e2a");
  });

  it("samples pixel color from RGBA typed array with boundary protection", () => {
    const width = 2;
    const height = 2;
    // 2x2 image:
    // (0,0): red
    // (1,0): green
    // (0,1): blue
    // (1,1): white
    const data = new Uint8ClampedArray([
      255, 0, 0, 255,   0, 255, 0, 255,
      0, 0, 255, 255,   255, 255, 255, 255,
    ]);

    const topLeft = samplePixelColorFromRgbaData(data, width, height, 0, 0);
    expect(topLeft.hex).toBe("#ff0000");
    expect(topLeft.r).toBe(255);

    const topRight = samplePixelColorFromRgbaData(data, width, height, 1, 0);
    expect(topRight.hex).toBe("#00ff00");

    const bottomLeft = samplePixelColorFromRgbaData(data, width, height, 0, 1);
    expect(bottomLeft.hex).toBe("#0000ff");

    const bottomRight = samplePixelColorFromRgbaData(data, width, height, 1, 1);
    expect(bottomRight.hex).toBe("#ffffff");

    // Out of bound clamping
    const clamped = samplePixelColorFromRgbaData(data, width, height, 99, 99);
    expect(clamped.hex).toBe("#ffffff");
  });
});
