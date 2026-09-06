import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_LAYER_BORDER_EFFECT,
  type StudioLayerBorderEffectSettings,
} from "../layer/studio-layer-border-effect";

import {
  hasActiveImageFilters as hasLightweightActiveImageFilters,
  imageFilterCacheKey,
} from "./studio-konva-filter-fields";
import {
  applyImageFilters,
  buildImageFilters,
  hasActiveImageFilters,
  registerStudioKonvaFilters,
  type ImageFilterFields,
  type KonvaLike,
} from "./studio-konva-filters";
import {
  hasActiveStudioLayerBorderEffect,
  layerBorderEffectKonvaFilter,
  studioLayerBorderEffectCachePad,
  studioLayerBorderEffectFilterAttrs,
} from "./studio-layer-border-effect-compositor";

function fakeKonva(): KonvaLike {
  return {
    Filters: {
      Blur() {},
      Brighten() {},
      Contrast() {},
      Grayscale() {},
      Sepia() {},
      HSL() {},
      Pixelate() {},
      Invert() {},
    },
  };
}

// 가운데 1px만 불투명한 5×5 표면 — outer fuchi가 이웃 픽셀에 그려져야 한다.
function centerDotSurface(): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(5 * 5 * 4);
  data[(2 * 5 + 2) * 4 + 3] = 255;
  return { width: 5, height: 5, data };
}

const ACTIVE_BORDER: StudioLayerBorderEffectSettings = {
  enabled: true,
  thickness: 1,
  color: "#ff0000",
  type: "outer",
  antiAliased: false,
};

describe("studio-layer-border-effect-compositor — Konva 필터 계약", () => {
  it("this.attrs.layerBorder*로 순수 경계 효과를 in-place 적용한다", () => {
    const surface = centerDotSurface();
    layerBorderEffectKonvaFilter.call(
      { attrs: { ...studioLayerBorderEffectFilterAttrs(ACTIVE_BORDER) } },
      surface,
    );
    const right = (2 * 5 + 3) * 4;
    expect([...surface.data.slice(right, right + 4)]).toEqual([255, 0, 0, 255]);
    // 원본 알파는 보존된다.
    expect(surface.data[(2 * 5 + 2) * 4 + 3]).toBe(255);
  });

  it("무효 굵기 attrs는 픽셀을 건드리지 않는 항등이다(fail-closed)", () => {
    for (const thickness of [undefined, Number.NaN, -1, 0, "3"]) {
      const surface = centerDotSurface();
      const before = surface.data.slice();
      layerBorderEffectKonvaFilter.call(
        { attrs: { layerBorderThickness: thickness, layerBorderColor: "#ff0000", layerBorderType: "outer" } },
        surface,
      );
      expect(surface.data).toEqual(before);
    }
  });

  it("attrs 빌더는 정규화된 절대값만 싣는다", () => {
    expect(studioLayerBorderEffectFilterAttrs({ enabled: true, thickness: 99, color: "", type: "inner" as const })).toEqual({
      layerBorderThickness: 32,
      layerBorderColor: "#000000",
      layerBorderType: "inner",
      layerBorderAntiAliased: 1,
    });
    expect(
      studioLayerBorderEffectFilterAttrs({ ...ACTIVE_BORDER, antiAliased: false }).layerBorderAntiAliased,
    ).toBe(0);
  });

  it("cachePad — outer/center는 굵기+1, inner와 항등은 0", () => {
    expect(studioLayerBorderEffectCachePad({ ...ACTIVE_BORDER, thickness: 4 })).toBe(5);
    expect(studioLayerBorderEffectCachePad({ ...ACTIVE_BORDER, thickness: 4, type: "center" })).toBe(5);
    expect(studioLayerBorderEffectCachePad({ ...ACTIVE_BORDER, type: "inner" })).toBe(0);
    expect(studioLayerBorderEffectCachePad({ ...ACTIVE_BORDER, enabled: false })).toBe(0);
    expect(studioLayerBorderEffectCachePad(undefined)).toBe(0);
  });
});

describe("studio-layer-border-effect-compositor — 렌더 계획 배선", () => {
  it("buildImageFilters가 활성 borderEffect를 마지막 단계 attrs·cachePad와 함께 태운다", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    const el: ImageFilterFields = { borderEffect: { ...ACTIVE_BORDER, thickness: 3 } };
    const built = buildImageFilters(el, konva);
    expect(built.filters).toHaveLength(1);
    expect(built.attrs.layerBorderThickness).toBe(3);
    expect(built.attrs.layerBorderColor).toBe("#ff0000");
    expect(built.attrs.layerBorderType).toBe("outer");
    expect(built.cachePad).toBe(4);
  });

  it("applyImageFilters 경유(메인 폴백·Worker 공용 루프)로도 같은 픽셀이 나온다", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    const el: ImageFilterFields = { borderEffect: ACTIVE_BORDER };
    const built = buildImageFilters(el, konva);
    const viaPlan = centerDotSurface();
    applyImageFilters(viaPlan, built.filters, built.attrs);
    const direct = centerDotSurface();
    layerBorderEffectKonvaFilter.call(
      { attrs: { ...studioLayerBorderEffectFilterAttrs(ACTIVE_BORDER) } },
      direct,
    );
    expect(viaPlan.data).toEqual(direct.data);
  });

  it("항등 borderEffect는 필터·캐시를 켜지 않는다", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    for (const value of [
      undefined,
      DEFAULT_STUDIO_LAYER_BORDER_EFFECT,
      { ...ACTIVE_BORDER, enabled: false },
      { ...ACTIVE_BORDER, thickness: 0 },
      { ...ACTIVE_BORDER, thickness: Number.NaN },
    ]) {
      const el: ImageFilterFields = { borderEffect: value as ImageFilterFields["borderEffect"] };
      expect(hasActiveStudioLayerBorderEffect(el)).toBe(false);
      expect(buildImageFilters(el, konva).filters).toHaveLength(0);
      expect(buildImageFilters(el, konva).cachePad).toBe(0);
    }
  });

  it("경량(첫 청크)·정규화(canonical) 활성 판정이 항상 일치한다 — 섀도 패리티", () => {
    const cases: Array<ImageFilterFields["borderEffect"]> = [
      undefined,
      DEFAULT_STUDIO_LAYER_BORDER_EFFECT,
      ACTIVE_BORDER,
      { ...ACTIVE_BORDER, enabled: false },
      { ...ACTIVE_BORDER, thickness: 0 },
      { ...ACTIVE_BORDER, thickness: 0.5 },
      { ...ACTIVE_BORDER, thickness: 500 },
      { ...ACTIVE_BORDER, thickness: Number.NaN },
      { ...ACTIVE_BORDER, thickness: Number.POSITIVE_INFINITY },
      { ...ACTIVE_BORDER, type: "center" },
      { ...ACTIVE_BORDER, type: "inner" },
    ];
    for (const [index, borderEffect] of cases.entries()) {
      const el: ImageFilterFields = { borderEffect };
      expect(hasLightweightActiveImageFilters(el), `case ${index}`).toBe(hasActiveImageFilters(el));
    }
  });

  it("borderEffect가 바뀌면 imageFilterCacheKey도 바뀐다(stale 캐시 없음)", () => {
    const off = imageFilterCacheKey({});
    const on = imageFilterCacheKey({ borderEffect: ACTIVE_BORDER });
    const thicker = imageFilterCacheKey({ borderEffect: { ...ACTIVE_BORDER, thickness: 5 } });
    expect(on).not.toBe(off);
    expect(thicker).not.toBe(on);
    expect(imageFilterCacheKey({ borderEffect: ACTIVE_BORDER })).toBe(on);
  });
});
