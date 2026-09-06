import { describe, expect, it } from "vitest";

import { sanitizeStudioVrmMtoonControls } from "./studio-vrm-mtoon-controls";
import {
  STUDIO_VRM_MTOON_PRESETS,
  STUDIO_VRM_MTOON_PRESET_IDS,
  createStudioVrmMtoonControlsFromPreset,
  findStudioVrmMtoonPreset,
  isStudioVrmMtoonLineArtPreset,
} from "./studio-vrm-mtoon-presets";

/** LT 의 휘도 계산과 같은 Rec.709 가중치. */
function luma(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  return (
    (((value >> 16) & 0xff) * 0.2126 + ((value >> 8) & 0xff) * 0.7152 + (value & 0xff) * 0.0722) /
    255
  );
}

function preset(id: string) {
  const found = findStudioVrmMtoonPreset(id);
  if (!found) throw new Error(`missing preset: ${id}`);
  return found;
}

describe("studio-vrm-mtoon-presets catalogue", () => {
  it("ships a usable spread with unique ids and LT notes", () => {
    expect(STUDIO_VRM_MTOON_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(STUDIO_VRM_MTOON_PRESET_IDS).size).toBe(STUDIO_VRM_MTOON_PRESETS.length);
    for (const item of STUDIO_VRM_MTOON_PRESETS) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.hint.length).toBeGreaterThan(0);
      // ltNote 는 UI 에 그대로 노출되는 계약 — 빈 문자열이면 프리셋의 존재 이유가 사라진다.
      expect(item.ltNote.length).toBeGreaterThan(20);
      expect(sanitizeStudioVrmMtoonControls(item.controls)).toEqual(item.controls);
    }
  });

  it("covers both outline width modes plus an outline-free tone preset", () => {
    const modes = new Set(
      STUDIO_VRM_MTOON_PRESETS.filter((item) => item.controls.outline.enabled).map(
        (item) => item.controls.outline.mode,
      ),
    );
    expect(modes.has("worldCoordinates")).toBe(true);
    expect(modes.has("screenCoordinates")).toBe(true);
    expect(modes.has("none")).toBe(true);
  });

  it("keeps every line-art preset's outline lighting mix at zero", () => {
    for (const item of STUDIO_VRM_MTOON_PRESETS) {
      if (!item.controls.outline.enabled) continue;
      // 조명이 섞이면 같은 윤곽선이 부위마다 다른 휘도로 찍혀 소벨 임계값 하나로는 못 잡는다.
      expect(item.controls.outline.lightingMix).toBe(0);
    }
  });

  it("keeps rim light off for every line-art preset", () => {
    const lineArt = STUDIO_VRM_MTOON_PRESETS.filter(isStudioVrmMtoonLineArtPreset);
    expect(lineArt.length).toBe(STUDIO_VRM_MTOON_PRESETS.length - 1);
    for (const item of lineArt) expect(item.controls.rim.mix).toBe(0);

    const drama = preset("rim-drama");
    expect(isStudioVrmMtoonLineArtPreset(drama)).toBe(false);
    expect(drama.ltNote).toContain("경고");
  });
});

describe("studio-vrm-mtoon-presets values", () => {
  it("model-original disables every group so cached uniforms are restored", () => {
    const original = preset("model-original").controls;
    expect(original.outline.enabled).toBe(false);
    expect(original.shading.enabled).toBe(false);
    expect(original.rim.enabled).toBe(false);
  });

  it("clean-line is a thin resolution-independent screen outline with a hard terminator", () => {
    const controls = preset("clean-line").controls;
    expect(controls.outline.mode).toBe("screenCoordinates");
    expect(controls.outline.screenWidthRatio).toBeCloseTo(0.0022, 6);
    expect(controls.outline.color).toBe("#1a1a1a");
    expect(controls.shading.toony).toBeGreaterThanOrEqual(0.9);
  });

  it("bold-ink is a thicker pure-black world outline than clean-line", () => {
    const bold = preset("bold-ink").controls;
    expect(bold.outline.mode).toBe("worldCoordinates");
    expect(bold.outline.color).toBe("#000000");
    expect(bold.outline.worldWidthMeters).toBeGreaterThan(
      preset("hairline").controls.outline.screenWidthRatio,
    );
    expect(bold.shading.toony).toBe(1);
  });

  it("hairline is the thinnest outline of the screen-space presets", () => {
    const hairline = preset("hairline").controls;
    const clean = preset("clean-line").controls;
    expect(hairline.outline.mode).toBe("screenCoordinates");
    expect(hairline.outline.screenWidthRatio).toBeLessThan(clean.outline.screenWidthRatio);
  });

  it("flat-two-tone removes the outline and locks a two-level terminator", () => {
    const flat = preset("flat-two-tone");
    expect(flat.controls.outline.mode).toBe("none");
    expect(flat.controls.shading.toony).toBe(1);
    expect(flat.controls.shading.shadingShift).toBe(0);
    // 톤 전용 프리셋이므로 tone.levels 와의 관계를 반드시 안내해야 한다.
    expect(flat.ltNote).toContain("tone.levels");
  });

  it("deep-shadow widens and darkens the shade region", () => {
    const deep = preset("deep-shadow").controls;
    const clean = preset("clean-line").controls;
    expect(deep.shading.shadingShift).toBeLessThan(0);
    expect(luma(deep.shading.shadeColor)).toBeLessThan(luma(clean.shading.shadeColor));
  });
});

describe("studio-vrm-mtoon-presets lookup", () => {
  it("creates independent control objects", () => {
    const first = createStudioVrmMtoonControlsFromPreset("clean-line");
    const second = createStudioVrmMtoonControlsFromPreset("clean-line");
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.outline).not.toBe(preset("clean-line").controls.outline);
  });

  it("falls back to defaults for unknown ids", () => {
    expect(findStudioVrmMtoonPreset("nope")).toBeNull();
    expect(findStudioVrmMtoonPreset(42)).toBeNull();
    const fallback = createStudioVrmMtoonControlsFromPreset(undefined);
    expect(fallback.outline.enabled).toBe(false);
    expect(fallback.shading.enabled).toBe(false);
  });
});
