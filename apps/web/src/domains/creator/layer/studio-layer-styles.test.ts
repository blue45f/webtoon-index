import { describe, expect, it } from "vitest";

import { isIdentityOutline, normalizeOutline } from "../studio-outline";

import {
  COMBO_LAYER_STYLE_PRESETS,
  hasActiveLayerStyle,
  LAYER_STYLE_PRESETS,
  LAYER_STYLE_RANGES,
  layerStyleResetPatch,
  type LayerStylePatch,
} from "./studio-layer-styles";

// LayerStylePatch의 전체 키 집합(layerStyleResetPatch가 빠짐없이 채워야 하는 6개 키).
const ALL_PATCH_KEYS = [
  "shadowColor",
  "shadowBlur",
  "shadowOffsetX",
  "shadowOffsetY",
  "shadowOpacity",
  "cornerRadius",
];

const HEX_RE = /^#[0-9a-f]{6}$/i;
const COLOR_KEYS = new Set(["shadowColor"]);

describe("LAYER_STYLE_RANGES", () => {
  it("matches the spec'd ranges for every slider", () => {
    expect(LAYER_STYLE_RANGES.shadowBlur).toEqual({ min: 0, max: 60, step: 1 });
    expect(LAYER_STYLE_RANGES.shadowOffsetX).toEqual({ min: -40, max: 40, step: 1 });
    expect(LAYER_STYLE_RANGES.shadowOffsetY).toEqual({ min: -40, max: 40, step: 1 });
    expect(LAYER_STYLE_RANGES.shadowOpacity).toEqual({ min: 0, max: 1, step: 0.05 });
    expect(LAYER_STYLE_RANGES.cornerRadius).toEqual({ min: 0, max: 120, step: 1 });
  });

  it("has min < max and positive step for each range", () => {
    for (const range of Object.values(LAYER_STYLE_RANGES)) {
      expect(range.min).toBeLessThan(range.max);
      expect(range.step).toBeGreaterThan(0);
    }
  });
});

describe("layerStyleResetPatch", () => {
  it("explicitly lists all 6 patch keys with an undefined value", () => {
    const patch = layerStyleResetPatch();
    expect(Object.keys(patch)).toHaveLength(6);
    expect(Object.keys(patch).sort()).toEqual([...ALL_PATCH_KEYS].sort());
    for (const value of Object.values(patch)) expect(value).toBeUndefined();
  });

  it("returns a fresh equal object each call", () => {
    expect(layerStyleResetPatch()).not.toBe(layerStyleResetPatch());
    expect(layerStyleResetPatch()).toEqual(layerStyleResetPatch());
  });
});

describe("LAYER_STYLE_PRESETS", () => {
  const RESET_KEYS = new Set(Object.keys(layerStyleResetPatch()));
  // 수치 키 → 범위 매핑(슬라이더와 동일). 색/문자열 키는 제외.
  const NUMERIC_RANGES = LAYER_STYLE_RANGES as Record<string, { min: number; max: number; step: number }>;

  it("has the none/기본 reset preset first and unique ids", () => {
    const ids = LAYER_STYLE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(LAYER_STYLE_PRESETS[0]!.id).toBe("none");
    expect(LAYER_STYLE_PRESETS[0]!.label).toBe("기본");
    expect(LAYER_STYLE_PRESETS[0]!.patch).toEqual(layerStyleResetPatch());
  });

  it("ships roughly ten presets", () => {
    expect(LAYER_STYLE_PRESETS.length).toBeGreaterThanOrEqual(8);
    expect(LAYER_STYLE_PRESETS.length).toBeLessThanOrEqual(12);
  });

  it("has non-empty labels and tips", () => {
    for (const preset of LAYER_STYLE_PRESETS) {
      expect(preset.label.trim().length).toBeGreaterThan(0);
      expect(preset.tip.trim().length).toBeGreaterThan(0);
    }
  });

  it("only uses known patch keys with in-range, well-typed values", () => {
    for (const preset of LAYER_STYLE_PRESETS.slice(1)) {
      const entries = Object.entries(preset.patch) as [keyof LayerStylePatch, unknown][];
      expect(entries.length).toBeGreaterThan(0);
      for (const [key, value] of entries) {
        // 모든 patch 키는 LayerStylePatch(=reset 키)의 부분집합이어야 한다.
        expect(RESET_KEYS.has(key)).toBe(true);
        if (value === undefined) continue;
        if (COLOR_KEYS.has(key)) {
          expect(typeof value).toBe("string");
          // 색은 유효 #rrggbb 헥스여야 한다.
          expect(HEX_RE.test(value as string)).toBe(true);
        } else {
          const range = NUMERIC_RANGES[key];
          expect(range).toBeDefined();
          expect(typeof value).toBe("number");
          expect(Number.isFinite(value as number)).toBe(true);
          expect(value as number).toBeGreaterThanOrEqual(range!.min);
          expect(value as number).toBeLessThanOrEqual(range!.max);
        }
      }
    }
  });

  it("makes every non-reset preset render a visible style", () => {
    for (const preset of LAYER_STYLE_PRESETS.slice(1)) {
      expect(hasActiveLayerStyle(preset.patch)).toBe(true);
    }
  });
});

describe("COMBO_LAYER_STYLE_PRESETS (테두리+그림자 콤보)", () => {
  const RESET_KEYS = new Set(Object.keys(layerStyleResetPatch()));
  const NUMERIC_RANGES = LAYER_STYLE_RANGES as Record<string, { min: number; max: number; step: number }>;

  it("스티커/이중 테두리/네온 3종을 고유 id로 담고 있다", () => {
    const ids = COMBO_LAYER_STYLE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["sticker-outline-shadow", "double-outline", "neon-glow-outline"]);
  });

  it("label/tip은 비어있지 않다", () => {
    for (const preset of COMBO_LAYER_STYLE_PRESETS) {
      expect(preset.label.trim().length).toBeGreaterThan(0);
      expect(preset.tip.trim().length).toBeGreaterThan(0);
    }
  });

  it("layer 패치는 알려진 키만 쓰고 범위/형식 안이다", () => {
    for (const preset of COMBO_LAYER_STYLE_PRESETS) {
      for (const [key, value] of Object.entries(preset.layer) as [keyof LayerStylePatch, unknown][]) {
        expect(RESET_KEYS.has(key)).toBe(true);
        if (value === undefined) continue;
        if (COLOR_KEYS.has(key)) {
          expect(typeof value).toBe("string");
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

  it("outline은 전부 normalizeOutline을 통과한 비항등 값이다(실제로 테두리가 그려짐)", () => {
    for (const preset of COMBO_LAYER_STYLE_PRESETS) {
      expect(preset.outline).toEqual(normalizeOutline(preset.outline));
      expect(isIdentityOutline(preset.outline)).toBe(false);
    }
  });

  it("스티커/네온 콤보는 그림자도 실제로 보인다, 이중 테두리는 그림자 없이 테두리만", () => {
    const byId = new Map(COMBO_LAYER_STYLE_PRESETS.map((p) => [p.id, p]));
    expect(hasActiveLayerStyle(byId.get("sticker-outline-shadow")!.layer)).toBe(true);
    expect(hasActiveLayerStyle(byId.get("neon-glow-outline")!.layer)).toBe(true);
    // 이중 테두리는 layer가 비어 reset만 적용(그림자 제거) — 테두리는 2차 링 포함.
    expect(hasActiveLayerStyle(byId.get("double-outline")!.layer)).toBe(false);
    expect(byId.get("double-outline")!.outline.secondWidth).toBeGreaterThan(0);
    // 스티커 콤보는 흰 테두리, 네온 콤보는 시안 테두리.
    expect(byId.get("sticker-outline-shadow")!.outline.color).toBe("#ffffff");
    expect(byId.get("neon-glow-outline")!.outline.color).toBe("#00e5ff");
  });
});

describe("hasActiveLayerStyle", () => {
  it("treats an empty patch as inactive", () => {
    expect(hasActiveLayerStyle({})).toBe(false);
    expect(hasActiveLayerStyle(layerStyleResetPatch())).toBe(false);
  });

  it("is active when cornerRadius is positive", () => {
    expect(hasActiveLayerStyle({ cornerRadius: 10 })).toBe(true);
    expect(hasActiveLayerStyle({ cornerRadius: 0 })).toBe(false);
  });

  it("needs both a shadow color and some spread", () => {
    // 색만 있고 번짐/오프셋이 없으면 비활성.
    expect(hasActiveLayerStyle({ shadowColor: "#000" })).toBe(false);
    expect(hasActiveLayerStyle({ shadowColor: "#000", shadowBlur: 8 })).toBe(true);
    expect(hasActiveLayerStyle({ shadowColor: "#000", shadowOffsetY: 6 })).toBe(true);
    expect(hasActiveLayerStyle({ shadowColor: "#000", shadowOffsetX: -4 })).toBe(true);
  });

  it("treats spread without a color as inactive", () => {
    expect(hasActiveLayerStyle({ shadowBlur: 12, shadowOffsetY: 8 })).toBe(false);
  });

  it("treats zero opacity as inactive even with spread", () => {
    expect(hasActiveLayerStyle({ shadowColor: "#000", shadowBlur: 8, shadowOpacity: 0 })).toBe(false);
  });

  it("treats missing opacity as fully opaque", () => {
    expect(hasActiveLayerStyle({ shadowColor: "#000", shadowBlur: 8 })).toBe(true);
  });
});
