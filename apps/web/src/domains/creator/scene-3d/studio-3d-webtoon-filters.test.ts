import { describe, expect, it } from "vitest";

import {
  Studio3DWebtoonFilterEngine,
  type WebtoonFilterId,
} from "./studio-3d-webtoon-filters";

describe("Studio3DWebtoonFilterEngine", () => {
  const engine = new Studio3DWebtoonFilterEngine();

  it("registers 7 unique presets across diverse webtoon genres", () => {
    const presets = engine.listPresets();
    expect(presets.length).toBe(7);

    const ids = new Set(presets.map((p) => p.id));
    expect(ids.size).toBe(7);
    expect(ids.has("classic-bw-ink")).toBe(true);
    expect(ids.has("romance-fantasy-pastel")).toBe(true);
    expect(ids.has("modern-crisp-cel")).toBe(true);
    expect(ids.has("dark-action-noir")).toBe(true);
    expect(ids.has("retro-screentone-pop")).toBe(true);
    expect(ids.has("cyberpunk-neon-rim")).toBe(true);
    expect(ids.has("watercolor-wash")).toBe(true);
  });

  it("retrieves specific preset and provides fallback for unknown id", () => {
    const bw = engine.getPreset("classic-bw-ink");
    expect(bw.celSteps).toBe(2);
    expect(bw.colorSaturation).toBe(0.0);

    const fallback = engine.getPreset("unknown-id" as WebtoonFilterId);
    expect(fallback.id).toBe("modern-crisp-cel");
  });

  it("filters presets by category", () => {
    const bwList = engine.listPresets("bw");
    expect(bwList.length).toBe(1);
    expect(bwList[0].id).toBe("classic-bw-ink");

    const actionList = engine.listPresets("action");
    expect(actionList.length).toBe(2);
  });

  it("evaluates discrete cel shading ramps for 2, 3, and 4 steps", () => {
    // 2 steps
    expect(engine.evaluateCelRamp(0.6, 2, 0.5)).toBe(1.0);
    expect(engine.evaluateCelRamp(0.3, 2, 0.5)).toBe(0.35);

    // 3 steps
    expect(engine.evaluateCelRamp(0.8, 3, 0.5)).toBe(1.0);
    expect(engine.evaluateCelRamp(0.55, 3, 0.5)).toBe(0.65);
    expect(engine.evaluateCelRamp(0.2, 3, 0.5)).toBe(0.3);

    // 4 steps
    expect(engine.evaluateCelRamp(0.9, 4)).toBe(1.0);
    expect(engine.evaluateCelRamp(0.6, 4)).toBe(0.75);
    expect(engine.evaluateCelRamp(0.4, 4)).toBe(0.5);
    expect(engine.evaluateCelRamp(0.1, 4)).toBe(0.25);
  });

  it("synthesizes valid CSS filter strings for browser composite layer", () => {
    const romance = engine.getPreset("romance-fantasy-pastel");
    const cssFilter = engine.generateCssFilterString(romance);

    expect(cssFilter).toContain("saturate(");
    expect(cssFilter).toContain("contrast(");
    expect(cssFilter).toContain("brightness(");

    const neutral = engine.blendFilters(romance, romance, 0);
    expect(typeof engine.generateCssFilterString(neutral)).toBe("string");
  });

  it("applies color grade transform without clipping errors", () => {
    const noir = engine.getPreset("dark-action-noir");
    const sample = engine.applyColorGradeRgb(150, 100, 80, noir);

    expect(sample.r).toBeGreaterThanOrEqual(0);
    expect(sample.r).toBeLessThanOrEqual(255);
    expect(sample.g).toBeGreaterThanOrEqual(0);
    expect(sample.g).toBeLessThanOrEqual(255);
    expect(sample.b).toBeGreaterThanOrEqual(0);
    expect(sample.b).toBeLessThanOrEqual(255);
  });

  it("blends two filter configurations smoothly for scene transitions", () => {
    const a = engine.getPreset("classic-bw-ink");
    const b = engine.getPreset("cyberpunk-neon-rim");
    const mid = engine.blendFilters(a, b, 0.5);

    expect(mid.lineThicknessPx).toBeCloseTo(1.85, 1);
    expect(mid.colorSaturation).toBeCloseTo(0.75, 1);
  });
});
