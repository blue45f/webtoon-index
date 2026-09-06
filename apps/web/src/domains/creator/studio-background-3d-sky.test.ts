import { describe, expect, it } from "vitest";

import {
  BG_SKY_PRESETS,
  clampPanoramaRotationDegrees,
  DEFAULT_SKY_PRESET_ID,
  getSkyPreset,
  normalizePanoramaRotationDegrees,
} from "./studio-background-3d-sky";

describe("studio-background-3d-sky", () => {
  it("exposes only the four canonical, URL-free allowlisted presets", () => {
    expect(BG_SKY_PRESETS.map((preset) => preset.id)).toEqual([
      "blank",
      "clear_day",
      "sunset",
      "night",
    ]);
    const ids = new Set(BG_SKY_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(BG_SKY_PRESETS.length);
    expect(BG_SKY_PRESETS[0]?.kind).toBe("solid");
    expect(BG_SKY_PRESETS.slice(1).every((preset) => preset.kind === "procedural-panorama"))
      .toBe(true);
    expect(JSON.stringify(BG_SKY_PRESETS)).not.toMatch(/url|href|path|token/iu);
  });

  it("DEFAULT_SKY_PRESET_ID resolves to a real entry", () => {
    const preset = getSkyPreset(DEFAULT_SKY_PRESET_ID);
    expect(preset.id).toBe(DEFAULT_SKY_PRESET_ID);
    expect(BG_SKY_PRESETS.some((p) => p.id === DEFAULT_SKY_PRESET_ID)).toBe(true);
  });

  it("getSkyPreset falls back to BG_SKY_PRESETS[0] for an unknown id", () => {
    expect(getSkyPreset("bogus")).toBe(BG_SKY_PRESETS[0]);
  });

  it("normalizes finite horizontal rotations into the editor's -180°…180° range", () => {
    expect(normalizePanoramaRotationDegrees(0)).toBe(0);
    expect(normalizePanoramaRotationDegrees(180)).toBe(180);
    expect(normalizePanoramaRotationDegrees(-180)).toBe(-180);
    expect(normalizePanoramaRotationDegrees(181)).toBe(-179);
    expect(normalizePanoramaRotationDegrees(-181)).toBe(179);
    expect(normalizePanoramaRotationDegrees(540)).toBe(180);
    expect(normalizePanoramaRotationDegrees(-540)).toBe(-180);
    expect(normalizePanoramaRotationDegrees(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizePanoramaRotationDegrees("90")).toBe(0);
  });

  it("clamps direct numeric commits without surprising wraparound", () => {
    expect(clampPanoramaRotationDegrees(-999)).toBe(-180);
    expect(clampPanoramaRotationDegrees(-45.5)).toBe(-45.5);
    expect(clampPanoramaRotationDegrees(-0)).toBe(0);
    expect(clampPanoramaRotationDegrees(45.5)).toBe(45.5);
    expect(clampPanoramaRotationDegrees(999)).toBe(180);
    expect(clampPanoramaRotationDegrees("90")).toBe(0);
    expect(clampPanoramaRotationDegrees(Number.NaN)).toBe(0);
  });
});
