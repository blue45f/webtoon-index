import { describe, expect, it } from "vitest";

import {
  DEFAULT_INTERMEDIATE_CORNERS,
  generateIntermediateColorGrid,
  hexToRgb,
  interpolateBilinearColor,
  rgbToHex,
  STUDIO_INTERMEDIATE_COLOR_PRESETS,
} from "./studio-intermediate-color";

describe("studio-intermediate-color", () => {
  it("converts hex to RGB and RGB to hex accurately", () => {
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#f00")).toEqual([255, 0, 0]);
    expect(hexToRgb("invalid")).toEqual([128, 128, 128]);

    expect(rgbToHex(255, 255, 255)).toBe("#ffffff");
    expect(rgbToHex(0, 0, 0)).toBe("#000000");
    expect(rgbToHex(255, 0, 0)).toBe("#ff0000");
  });

  it("performs bilinear color interpolation correctly at corners and midpoint", () => {
    const c00 = "#000000"; // Top-Left: black
    const c10 = "#ffffff"; // Top-Right: white
    const c01 = "#000000"; // Bottom-Left: black
    const c11 = "#ffffff"; // Bottom-Right: white

    // At u=0, v=0 -> Top-Left corner
    expect(interpolateBilinearColor(c00, c10, c01, c11, 0, 0)).toBe("#000000");
    // At u=1, v=0 -> Top-Right corner
    expect(interpolateBilinearColor(c00, c10, c01, c11, 1, 0)).toBe("#ffffff");
    // At u=0.5, v=0 -> Mid-gray
    const midTop = interpolateBilinearColor(c00, c10, c01, c11, 0.5, 0);
    const [r] = hexToRgb(midTop);
    expect(r).toBeCloseTo(128, -1);
  });

  it("generates an NxN grid of intermediate colors", () => {
    const grid4x4 = generateIntermediateColorGrid(DEFAULT_INTERMEDIATE_CORNERS, 4);
    expect(grid4x4.length).toBe(4);
    expect(grid4x4[0]?.length).toBe(4);
    expect(grid4x4[0]?.[0]?.toLowerCase()).toBe(DEFAULT_INTERMEDIATE_CORNERS.c00.toLowerCase());
    expect(grid4x4[0]?.[3]?.toLowerCase()).toBe(DEFAULT_INTERMEDIATE_CORNERS.c10.toLowerCase());
    expect(grid4x4[3]?.[0]?.toLowerCase()).toBe(DEFAULT_INTERMEDIATE_CORNERS.c01.toLowerCase());
    expect(grid4x4[3]?.[3]?.toLowerCase()).toBe(DEFAULT_INTERMEDIATE_CORNERS.c11.toLowerCase());

    const grid6x6 = generateIntermediateColorGrid(DEFAULT_INTERMEDIATE_CORNERS, 6);
    expect(grid6x6.length).toBe(6);
    expect(grid6x6[0]?.length).toBe(6);
  });

  it("provides curated webtoon presets", () => {
    expect(STUDIO_INTERMEDIATE_COLOR_PRESETS.length).toBeGreaterThanOrEqual(4);
    const skinPreset = STUDIO_INTERMEDIATE_COLOR_PRESETS.find((p) => p.id === "korean-webtoon-skin");
    expect(skinPreset).toBeDefined();
    expect(skinPreset?.corners.c00).toBe("#fff0e6");
  });
});
