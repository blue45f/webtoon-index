import { describe, expect, it } from "vitest";

import {
  SCENE_MOOD_PALETTES,
  WEBTOON_SKIN_PALETTES,
  WebtoonColorHarmonyAssistant,
} from "./webtoon-color-harmony-assistant";

function hexToRgb(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function relativeLuminance(hex: string): number {
  const channels = hexToRgb(hex).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function rgbToHue(hex: string): number {
  const [red, green, blue] = hexToRgb(hex).map((channel) => channel / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (delta === 0) return 0;

  const raw =
    max === red
      ? ((green - blue) / delta) % 6
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  return (raw * 60 + 360) % 360;
}

function hueDistance(a: number, b: number): number {
  const delta = Math.abs(a - b) % 360;
  return Math.min(delta, 360 - delta);
}

describe("WebtoonColorHarmonyAssistant", () => {
  const assistant = new WebtoonColorHarmonyAssistant();

  it("contains 5 distinct character skin tone palettes", () => {
    expect(Object.keys(WEBTOON_SKIN_PALETTES).length).toBe(5);

    const warmFair = assistant.getSkinPalette("warm-fair");
    expect(warmFair.base).toBe("#ffedd5");
    expect(warmFair.shadow1).toBe("#fbcfe8");
    expect(warmFair.blushTint).toBe("#fb7185");

    const coolPale = assistant.getSkinPalette("cool-pale");
    expect(coolPale.base).toBe("#f1f5f9");
    expect(coolPale.shadow2).toBe("#94a3b8");
  });

  it("provides and retrieves 4 lighting scene mood presets", () => {
    expect(SCENE_MOOD_PALETTES.length).toBe(4);
    const ids = SCENE_MOOD_PALETTES.map((scene) => scene.id);
    expect(ids).toContain("romance-golden-sunset");
    expect(ids).toContain("fresh-academy-sky");
    expect(ids).toContain("dark-fantasy-noir");
    expect(ids).toContain("cyberpunk-neon-night");
    expect(assistant.getSceneMoodPalette("dark-fantasy-noir")?.genre).toBe("액션 / 스릴러");
    expect(assistant.getSceneMoodPalette("unknown")).toBeUndefined();
  });

  it("generates a strictly darker two-step shadow ramp and a lighter highlight", () => {
    const base = "#ffedd5";
    const colors = assistant.generateHueShiftShadow(base);

    expect(colors.shadow1).toMatch(/^#[0-9a-f]{6}$/i);
    expect(colors.shadow2).toMatch(/^#[0-9a-f]{6}$/i);
    expect(colors.highlight).toMatch(/^#[0-9a-f]{6}$/i);
    expect(relativeLuminance(colors.highlight)).toBeGreaterThanOrEqual(relativeLuminance(base));
    expect(relativeLuminance(colors.shadow1)).toBeLessThan(relativeLuminance(base));
    expect(relativeLuminance(colors.shadow2)).toBeLessThan(relativeLuminance(colors.shadow1));
  });

  it("moves warm bases toward the cool blue-violet target rather than toward yellow", () => {
    const base = "#f97316";
    const colors = assistant.generateHueShiftShadow(base);
    const targetHue = 265;

    expect(hueDistance(rgbToHue(colors.shadow1), targetHue)).toBeLessThan(
      hueDistance(rgbToHue(base), targetHue),
    );
    expect(hueDistance(rgbToHue(colors.shadow2), targetHue)).toBeLessThan(
      hueDistance(rgbToHue(colors.shadow1), targetHue),
    );
  });

  it("gives neutral gray a chromatic cool shadow instead of a muddy gray overlay", () => {
    const colors = assistant.generateHueShiftShadow("#808080");
    const [red, green, blue] = hexToRgb(colors.shadow1);

    expect(new Set([red, green, blue]).size).toBeGreaterThan(1);
    expect(blue).toBeGreaterThan(red);
  });

  it("normalizes valid six-digit hex and rejects malformed colors", () => {
    expect(assistant.generateHueShiftShadow(" FFEDD5 ").shadow1).toMatch(/^#[0-9a-f]{6}$/);
    expect(() => assistant.generateHueShiftShadow("#fff")).toThrow(RangeError);
    expect(() => assistant.generateHueShiftShadow("not-a-color")).toThrow(RangeError);
  });
});