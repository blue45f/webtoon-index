import { describe, expect, it } from "vitest";

import {
  TEXT_FX_PRESETS,
  textFxResetPatch,
  type TextFxPatch,
} from "./studio-text-effects";

// TextFxPatch의 전체 키 집합(textFxResetPatch가 빠짐없이 채워야 하는 키들).
const ALL_PATCH_KEYS = [
  "fill",
  "stroke",
  "strokeWidth",
  "fontStyle",
  "shadowColor",
  "shadowBlur",
  "shadowOffsetX",
  "shadowOffsetY",
  "shadowOpacity",
  "fillType",
  "gradientColorStart",
  "gradientColorEnd",
  "gradientDirection",
];

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const FONT_STYLES = new Set(["normal", "bold", "italic", "bold italic"]);
const COLOR_KEYS = new Set(["fill", "stroke", "shadowColor", "gradientColorStart", "gradientColorEnd"]);

// 수치 키별 허용 범위(인스펙터 슬라이더/엔진 한계와 동일).
const NUMERIC_RANGES: Record<string, { min: number; max: number }> = {
  strokeWidth: { min: 0, max: 20 },
  shadowBlur: { min: 0, max: 40 },
  shadowOffsetX: { min: -20, max: 20 },
  shadowOffsetY: { min: -20, max: 20 },
  shadowOpacity: { min: 0, max: 1 },
};

describe("textFxResetPatch", () => {
  it("explicitly lists every patch key with an undefined value", () => {
    const patch = textFxResetPatch();
    expect(Object.keys(patch).sort()).toEqual([...ALL_PATCH_KEYS].sort());
    expect(Object.keys(patch)).toHaveLength(ALL_PATCH_KEYS.length);
    for (const value of Object.values(patch)) expect(value).toBeUndefined();
  });

  it("returns a fresh object each call", () => {
    expect(textFxResetPatch()).not.toBe(textFxResetPatch());
    expect(textFxResetPatch()).toEqual(textFxResetPatch());
  });
});

describe("TEXT_FX_PRESETS", () => {
  const RESET_KEYS = new Set(Object.keys(textFxResetPatch()));

  it("has unique ids and the plain reset preset first", () => {
    const ids = TEXT_FX_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(TEXT_FX_PRESETS[0]!.id).toBe("plain");
    expect(TEXT_FX_PRESETS[0]!.label).toBe("기본");
    expect(TEXT_FX_PRESETS[0]!.patch).toEqual(textFxResetPatch());
    expect(TEXT_FX_PRESETS.length).toBeGreaterThanOrEqual(12);
  });

  it("has non-empty labels and tips", () => {
    for (const preset of TEXT_FX_PRESETS) {
      expect(preset.label.trim().length).toBeGreaterThan(0);
      expect(preset.tip.trim().length).toBeGreaterThan(0);
    }
  });

  it("only uses known patch keys with in-range, well-typed values", () => {
    for (const preset of TEXT_FX_PRESETS.slice(1)) {
      const entries = Object.entries(preset.patch) as [keyof TextFxPatch, unknown][];
      expect(entries.length).toBeGreaterThan(0);
      for (const [key, value] of entries) {
        expect(RESET_KEYS.has(key)).toBe(true);
        if (value === undefined) continue;
        if (key === "fontStyle") {
          expect(FONT_STYLES.has(value as string)).toBe(true);
        } else if (key === "fillType") {
          expect(value === "solid" || value === "gradient").toBe(true);
        } else if (key === "gradientDirection") {
          expect(value === "vertical" || value === "horizontal").toBe(true);
        } else if (COLOR_KEYS.has(key)) {
          expect(typeof value).toBe("string");
          // 색은 유효 #rrggbb/#rgb 헥스여야 한다.
          expect(HEX_RE.test(value as string)).toBe(true);
        } else {
          const range = NUMERIC_RANGES[key];
          expect(range).toBeDefined();
          expect(typeof value).toBe("number");
          expect(value as number).toBeGreaterThanOrEqual(range!.min);
          expect(value as number).toBeLessThanOrEqual(range!.max);
        }
      }
    }
  });

  it("pairs gradient fills with both gradient stop colors", () => {
    for (const preset of TEXT_FX_PRESETS) {
      if (preset.patch.fillType !== "gradient") continue;
      expect(typeof preset.patch.gradientColorStart).toBe("string");
      expect(typeof preset.patch.gradientColorEnd).toBe("string");
      expect(HEX_RE.test(preset.patch.gradientColorStart!)).toBe(true);
      expect(HEX_RE.test(preset.patch.gradientColorEnd!)).toBe(true);
    }
  });
});
