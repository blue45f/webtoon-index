import { describe, expect, it } from "vitest";

import {
  applyImageFilters,
  buildImageFilters,
  hasActiveImageFilters,
  registerStudioKonvaFilters,
  type ImageFilterFields,
  type KonvaLike,
} from "../render/studio-konva-filters";
import { hexToRgb, type StudioImageDataLike } from "../studio-filters";
import {
  denoiseStudioRgba,
  reduceStudioJpegArtifacts,
  removeStudioScreentoneArtifacts,
  type StudioToneArtifactAppliedResult,
} from "../studio-tone-artifact-filter-kernels";

import {
  STUDIO_FILTER_LABELS,
  STUDIO_FILTER_MENU_KINDS,
  cloneStudioFilterDraft,
  createStudioFilterDraft,
  isStudioFilterPackDraft,
  studioFilterDraftToPatch,
  type StudioFilterDraft,
} from "./studio-filter-menu";
import {
  DEFAULT_GLITCH_FX,
  DEFAULT_VIGNETTE_FX,
  STUDIO_FILTER_PACK_DEFS,
  STUDIO_FILTER_PACK_KINDS,
  STUDIO_FILTER_PACK_LABELS,
  STUDIO_FILTER_PACK_MENU,
  applyGlitchFx,
  applyVignetteFx,
  glitchFxKonvaFilter,
  isIdentityGlitchFx,
  isIdentityVignetteFx,
  isStudioFilterPackKind,
  normalizeGlitchFx,
  normalizeStudioFilterPackValues,
  normalizeVignetteFx,
  studioFilterPackValuesToPatch,
  vignetteFxKonvaFilter,
} from "./studio-filter-pack";

// ---------------------------------------------------------------------------
// 헬퍼 — 순수 가짜 ImageData(테스트는 node 환경, Konva/DOM 없음)
// ---------------------------------------------------------------------------

function solidImage(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a = 255,
): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return { data, width, height };
}

function patternedImage(width = 24, height = 16, alpha = 255): StudioImageDataLike {
  const image = solidImage(width, height, 0, 0, 0, alpha);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      image.data[index] = (x * 31 + y * 17) % 256;
      image.data[index + 1] = (x * 11 + y * 47) % 256;
      image.data[index + 2] = (x * 61 + y * 7) % 256;
      image.data[index + 3] = alpha;
    }
  }
  return image;
}

function cloneImage(img: StudioImageDataLike): StudioImageDataLike {
  return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
}

// 종단 간 하네스 — 빈 레지스트리에 등록하면 내장 필터도 attrs 기반 순수 포팅으로 채워진다.
function pixelsAfterPatch(
  patch: Partial<ImageFilterFields>,
  img: StudioImageDataLike,
): StudioImageDataLike {
  const konva: KonvaLike = { Filters: {} };
  registerStudioKonvaFilters(konva);
  const built = buildImageFilters(patch as ImageFilterFields, konva);
  const out = cloneImage(img);
  applyImageFilters(out, built.filters, built.attrs);
  return out;
}

function packDraft(kind: (typeof STUDIO_FILTER_PACK_KINDS)[number], values: Record<string, number | string>): StudioFilterDraft {
  return { kind, values } as StudioFilterDraft;
}

// ---------------------------------------------------------------------------
// 카탈로그 등록 — 메뉴/라벨/스키마 무결성
// ---------------------------------------------------------------------------

describe("studio filter pack 카탈로그", () => {
  it("요구된 신규 필터 종류가 전부 등록되어 있다", () => {
    const required = [
      "mosaic",
      "radial-blur",
      "zoom-blur",
      "lens-blur",
      "field-iris-blur",
      "tilt-shift-blur",
      "selective-gaussian-blur",
      "tileable-blur",
      "chromatic-aberration",
      "glitch",
      "scanline",
      "vignette",
      "lens-flare",
      "emboss",
      "solarize",
      "threshold",
      "oil-paint",
      "surface-blur",
      "line-cleanup",
      "screentone-removal",
      "jpeg-artifact-reduction",
      "edge-aware-denoise",
      "dust-scratches",
      "difference-of-gaussians",
      "color-to-alpha",
      "duotone",
      "noise-add",
    ];
    for (const kind of required) {
      expect(STUDIO_FILTER_PACK_KINDS).toContain(kind);
      expect(isStudioFilterPackKind(kind)).toBe(true);
    }
    expect(new Set(STUDIO_FILTER_PACK_KINDS).size).toBe(STUDIO_FILTER_PACK_KINDS.length);
  });

  it("코어 필터 종류는 팩 종류로 오인되지 않는다", () => {
    for (const kind of [
      "gaussian-blur",
      "motion-blur",
      "hue-saturation-brightness",
      "brightness-contrast",
      "color-curves",
    ]) {
      expect(isStudioFilterPackKind(kind)).toBe(false);
    }
  });

  it("메뉴 등록 목록이 코어 5개 + 팩 전체를 포함하고 라벨 사전이 완전하다", () => {
    expect(STUDIO_FILTER_MENU_KINDS.slice(0, 5)).toEqual([
      "gaussian-blur",
      "motion-blur",
      "hue-saturation-brightness",
      "brightness-contrast",
      "color-curves",
    ]);
    for (const kind of STUDIO_FILTER_PACK_KINDS) {
      expect(STUDIO_FILTER_MENU_KINDS).toContain(kind);
      expect(STUDIO_FILTER_LABELS[kind]).toBe(STUDIO_FILTER_PACK_LABELS[kind]);
      expect(STUDIO_FILTER_LABELS[kind]!.length).toBeGreaterThan(0);
    }
    expect(STUDIO_FILTER_PACK_MENU.map((entry) => entry.kind)).toEqual([
      ...STUDIO_FILTER_PACK_KINDS,
    ]);
  });

  it("모든 정의의 스키마가 정합적이다(기본값이 파라미터 범위 안)", () => {
    for (const kind of STUDIO_FILTER_PACK_KINDS) {
      const def = STUDIO_FILTER_PACK_DEFS[kind];
      expect(def.kind).toBe(kind);
      expect(def.params.length).toBeGreaterThan(0);
      for (const param of def.params) {
        const fallback = def.defaults[param.key];
        expect(fallback).toBeDefined();
        if (param.control === "slider") {
          expect(param.min).toBeLessThan(param.max);
          expect(typeof fallback).toBe("number");
          expect(fallback as number).toBeGreaterThanOrEqual(param.min);
          expect(fallback as number).toBeLessThanOrEqual(param.max);
        } else {
          expect(typeof fallback).toBe("string");
        }
      }
      const patch = def.toPatch(normalizeStudioFilterPackValues(kind, null));
      expect(Object.keys(patch).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 드래프트 라이프사이클 — 기존 5개와 같은 등록 패턴(생성/복제/패치)
// ---------------------------------------------------------------------------

describe("studio filter pack 드래프트", () => {
  it("기본 드래프트를 만들고 현재 이미지 필드를 되읽는다(다시 열기 패리티)", () => {
    expect(createStudioFilterDraft("mosaic", {})).toEqual({
      kind: "mosaic",
      values: { cell: 8 },
    });
    expect(createStudioFilterDraft("mosaic", { pixelate: 12 })).toEqual({
      kind: "mosaic",
      values: { cell: 12 },
    });
    expect(createStudioFilterDraft("threshold", { inkThreshold: 0.5 })).toEqual({
      kind: "threshold",
      values: { level: 128 },
    });
    expect(
      createStudioFilterDraft("line-cleanup", {
        lineCleanup: { threshold: 0.64, strength: 0.45 },
      }),
    ).toEqual({
      kind: "line-cleanup",
      values: { threshold: 64, strength: 45 },
    });
    expect(
      createStudioFilterDraft("screentone-removal", {
        screentoneRemoval: { radius: 3, strength: 0.76, inkLumaThreshold: 84 },
      }),
    ).toEqual({
      kind: "screentone-removal",
      values: { radius: 3, strength: 76, inkLumaThreshold: 84 },
    });
    expect(
      createStudioFilterDraft("jpeg-artifact-reduction", {
        jpegArtifactReduction: {
          deblockStrength: 0.68,
          deringStrength: 0.42,
          boundaryThreshold: 7,
          protectedEdgeThreshold: 96,
          ringingThreshold: 20,
          inkLumaThreshold: 60,
        },
      }),
    ).toEqual({
      kind: "jpeg-artifact-reduction",
      values: {
        deblockStrength: 68,
        deringStrength: 42,
        boundaryThreshold: 7,
        protectedEdgeThreshold: 96,
        ringingThreshold: 20,
        inkLumaThreshold: 60,
      },
    });
    expect(
      createStudioFilterDraft("edge-aware-denoise", {
        edgeAwareDenoise: { radius: 2, strength: 0.66, rangeThreshold: 80 },
      }),
    ).toEqual({
      kind: "edge-aware-denoise",
      values: { radius: 2, strength: 66, rangeThreshold: 80 },
    });
    expect(
      createStudioFilterDraft("lens-blur", {
        lensBlur: {
          radius: 5.5,
          sampleCount: 27,
          apertureBlades: 9,
          apertureRotationRadians: Math.PI / 4,
        },
      }),
    ).toEqual({
      kind: "lens-blur",
      values: {
        radius: 5.5,
        sampleCount: 27,
        apertureBlades: 9,
        apertureRotation: 45,
      },
    });
    expect(
      createStudioFilterDraft("field-iris-blur", {
        fieldIrisBlur: {
          focusCenterX: 0.35,
          focusCenterY: 0.62,
          focusRadius: 0.2,
          feather: 0.3,
          maximumBlurRadius: 8,
          sampleCount: 25,
          apertureBlades: 7,
        },
      }),
    ).toEqual({
      kind: "field-iris-blur",
      values: {
        focusCenterX: 35,
        focusCenterY: 62,
        focusRadius: 20,
        feather: 30,
        maximumBlurRadius: 8,
        sampleCount: 25,
        apertureBlades: 7,
      },
    });
    expect(
      createStudioFilterDraft("tilt-shift-blur", {
        tiltShiftBlur: {
          axisRadians: -Math.PI / 2,
          focusWidth: 0.24,
          feather: 0.18,
          maximumBlurRadius: 6,
          sampleCount: 23,
        },
      }),
    ).toEqual({
      kind: "tilt-shift-blur",
      values: {
        axis: -90,
        focusWidth: 24,
        feather: 18,
        maximumBlurRadius: 6,
        sampleCount: 23,
      },
    });
    expect(
      createStudioFilterDraft("selective-gaussian-blur", {
        selectiveGaussianBlur: {
          radius: 4,
          spatialSigma: 2.5,
          edgeThreshold: 36,
          edgeSoftness: 0.55,
        },
      }),
    ).toEqual({
      kind: "selective-gaussian-blur",
      values: {
        radius: 4,
        spatialSigma: 2.5,
        edgeThreshold: 36,
        edgeSoftness: 0.55,
      },
    });
    expect(
      createStudioFilterDraft("tileable-blur", {
        tileableBlur: { radius: 7, sigma: 3.4, strength: 0.72 },
      }),
    ).toEqual({
      kind: "tileable-blur",
      values: { radius: 7, sigma: 3.4, strength: 72 },
    });
    expect(
      createStudioFilterDraft("dust-scratches", {
        dustScratches: { radius: 3, threshold: 42, strength: 0.66 },
      }),
    ).toEqual({
      kind: "dust-scratches",
      values: { radius: 3, threshold: 42, strength: 66 },
    });
    expect(
      createStudioFilterDraft("difference-of-gaussians", {
        differenceOfGaussians: {
          smallSigma: 1,
          largeSigma: 2.8,
          threshold: 3.5,
          strength: 16,
        },
      }),
    ).toEqual({
      kind: "difference-of-gaussians",
      values: { smallSigma: 1, largeSigma: 2.8, threshold: 3.5, strength: 16 },
    });
    expect(
      createStudioFilterDraft("color-to-alpha", {
        colorToAlpha: { keyColor: "#f2ead9", strength: 78 },
      }),
    ).toEqual({
      kind: "color-to-alpha",
      values: { keyColor: "#f2ead9", strength: 78 },
    });
    expect(
      createStudioFilterDraft("emboss", {
        stylize: { type: "emboss", strength: 70, detail: 5 },
      }),
    ).toEqual({ kind: "emboss", values: { depth: 5, mix: 70 } });
    // 다른 타입의 stylize는 되읽지 않는다.
    expect(
      createStudioFilterDraft("emboss", {
        stylize: { type: "oilPaint", strength: 70, detail: 5 },
      }),
    ).toEqual({ kind: "emboss", values: { depth: 3, mix: 100 } });
  });

  it("복제는 값 가방을 깊이 복사한다", () => {
    const source = createStudioFilterDraft("glitch", {});
    const cloned = cloneStudioFilterDraft(source);
    expect(isStudioFilterPackDraft(cloned)).toBe(true);
    if (isStudioFilterPackDraft(cloned) && isStudioFilterPackDraft(source)) {
      cloned.values.seed = 42;
      expect(source.values.seed).toBe(1337);
    }
  });

  it("범위 밖 값은 렌더러 실제 클램프 범위로 눌러 패치한다(bounds safety)", () => {
    expect(studioFilterDraftToPatch(packDraft("mosaic", { cell: 999 }))).toEqual({
      pixelate: 40,
    });
    expect(studioFilterDraftToPatch(packDraft("mosaic", { cell: -3 }))).toEqual({
      pixelate: 2,
    });
    expect(
      studioFilterDraftToPatch(packDraft("chromatic-aberration", { offset: 99 })),
    ).toEqual({ chromatic: 12 });
    expect(
      studioFilterDraftToPatch(packDraft("threshold", { level: Number.NaN })),
    ).toEqual({ inkThreshold: 128 / 255 });
  });
});

// ---------------------------------------------------------------------------
// 패치 매핑 — 각 필터가 내보내는 정확한 비파괴 문서 필드
// ---------------------------------------------------------------------------

describe("studio filter pack 패치 매핑", () => {
  it("방사형/줌 블러는 blurFx spin/zoom으로 매핑된다", () => {
    expect(
      studioFilterDraftToPatch(packDraft("radial-blur", { strength: 60, angle: 12 })),
    ).toEqual({ blurFx: { type: "spin", strength: 60, radius: 12, angle: 0 } });
    expect(
      studioFilterDraftToPatch(packDraft("zoom-blur", { strength: 70, amount: 20 })),
    ).toEqual({ blurFx: { type: "zoom", strength: 70, radius: 20, angle: 0 } });
  });

  it("스캔라인은 grain scanline, 렌즈 플레어는 light lensFlare로 매핑된다", () => {
    expect(
      studioFilterDraftToPatch(packDraft("scanline", { darkness: 45, spacing: 2 })),
    ).toEqual({ grain: { type: "scanline", amount: 45, size: 2, seed: 1 } });
    expect(
      studioFilterDraftToPatch(
        packDraft("lens-flare", { intensity: 60, x: 30, y: 30, hue: 45 }),
      ),
    ).toEqual({ light: { type: "lensFlare", intensity: 60, x: 30, y: 30, hue: 45 } });
  });

  it("엠보스/유화/표면 블러는 stylize·detail 엔진 필드로 매핑된다", () => {
    expect(studioFilterDraftToPatch(packDraft("emboss", { depth: 3, mix: 100 }))).toEqual({
      stylize: { type: "emboss", strength: 100, detail: 3 },
    });
    expect(
      studioFilterDraftToPatch(packDraft("oil-paint", { radius: 4, strength: 80 })),
    ).toEqual({ stylize: { type: "oilPaint", strength: 80, detail: 4 } });
    expect(
      studioFilterDraftToPatch(packDraft("surface-blur", { radius: 3, strength: 70 })),
    ).toEqual({ detail: { type: "median", amount: 70, radius: 3 } });
  });

  it("솔라라이즈 임계값은 stylize.detail로 왕복 변환된다", () => {
    // 엔진: threshold = 128 - (detail-3)*10 → 임계값 108이면 detail 5.
    expect(
      studioFilterDraftToPatch(packDraft("solarize", { threshold: 108, strength: 100 })),
    ).toEqual({ stylize: { type: "solarize", strength: 100, detail: 5 } });
    expect(
      createStudioFilterDraft("solarize", {
        stylize: { type: "solarize", strength: 100, detail: 5 },
      }),
    ).toEqual({ kind: "solarize", values: { threshold: 108, strength: 100 } });
  });

  it("선화 정리는 정규화된 비파괴 합성 필드로 매핑된다", () => {
    expect(
      studioFilterDraftToPatch(
        packDraft("line-cleanup", { threshold: 64, strength: 45 }),
      ),
    ).toEqual({
      lineCleanup: { threshold: 0.64, strength: 0.45 },
    });
  });

  it("톤·압축 노이즈 정리 3종은 정규화된 비파괴 필드로 매핑된다", () => {
    expect(studioFilterDraftToPatch(
      packDraft("screentone-removal", {
        radius: 3,
        strength: 76,
        inkLumaThreshold: 84,
      }),
    )).toEqual({
      screentoneRemoval: { radius: 3, strength: 0.76, inkLumaThreshold: 84 },
    });
    expect(studioFilterDraftToPatch(
      packDraft("jpeg-artifact-reduction", {
        deblockStrength: 68,
        deringStrength: 42,
        boundaryThreshold: 7,
        protectedEdgeThreshold: 96,
        ringingThreshold: 20,
        inkLumaThreshold: 60,
      }),
    )).toEqual({
      jpegArtifactReduction: {
        deblockStrength: 0.68,
        deringStrength: 0.42,
        boundaryThreshold: 7,
        protectedEdgeThreshold: 96,
        ringingThreshold: 20,
        inkLumaThreshold: 60,
      },
    });
    expect(studioFilterDraftToPatch(
      packDraft("edge-aware-denoise", {
        radius: 2,
        strength: 66,
        rangeThreshold: 80,
      }),
    )).toEqual({
      edgeAwareDenoise: { radius: 2, strength: 0.66, rangeThreshold: 80 },
    });
  });

  it("듀오톤은 헥스 색상만 허용하고 무효 색은 기본값으로 대체한다", () => {
    expect(
      studioFilterDraftToPatch(packDraft("duotone", { shadow: "#102030", highlight: "#f0e0d0" })),
    ).toEqual({ duotoneShadow: "#102030", duotoneHighlight: "#f0e0d0" });
    expect(
      studioFilterDraftToPatch(
        packDraft("duotone", { shadow: "javascript:alert(1)", highlight: 12 }),
      ),
    ).toEqual({ duotoneShadow: "#2b1d0e", duotoneHighlight: "#ffe9c9" });
  });

  it("노이즈 추가는 결정적 시드와 함께 매핑되고, 글리치/비네트는 정규화된 확장 필드를 내보낸다", () => {
    expect(
      studioFilterDraftToPatch(packDraft("noise-add", { amount: 25, seed: 77 })),
    ).toEqual({ noise: 25, noiseSeed: 77 });
    expect(
      studioFilterDraftToPatch(
        packDraft("glitch", { intensity: 60, slices: 8, split: 4, seed: 7 }),
      ),
    ).toEqual({ glitchFx: { intensity: 60, slices: 8, split: 4, seed: 7 } });
    expect(
      studioFilterDraftToPatch(
        packDraft("vignette", { darkness: 55, size: 45, roundness: 100, feather: 60 }),
      ),
    ).toEqual({ vignetteFx: { darkness: 55, size: 45, roundness: 100, feather: 60 } });
  });

  it("기존 엔진 필드 패치는 렌더러 활성 판정을 통과한다", () => {
    for (const kind of STUDIO_FILTER_PACK_KINDS) {
      if (kind === "glitch" || kind === "vignette") continue; // 확장 필드는 별도 등록(INTEGRATION SPEC)
      const patch = studioFilterPackValuesToPatch(kind, {});
      expect(hasActiveImageFilters(patch as ImageFilterFields)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 글리치 엔진 — 시드 결정성/조각 이동/경계 안전/알파
// ---------------------------------------------------------------------------

describe("applyGlitchFx", () => {
  it("항등(intensity 0)은 픽셀을 건드리지 않는다", () => {
    const img = patternedImage();
    const before = new Uint8ClampedArray(img.data);
    applyGlitchFx(img, normalizeGlitchFx({ intensity: 0, seed: 3 }));
    expect(img.data).toEqual(before);
    expect(isIdentityGlitchFx(DEFAULT_GLITCH_FX)).toBe(true);
  });

  it("같은 시드는 항상 같은 출력, 다른 시드는 다른 출력(Math.random 없음)", () => {
    const base = patternedImage();
    const a = cloneImage(base);
    const b = cloneImage(base);
    const c = cloneImage(base);
    const fx = normalizeGlitchFx({ intensity: 80, slices: 8, split: 3, seed: 11 });
    applyGlitchFx(a, fx);
    applyGlitchFx(b, fx);
    applyGlitchFx(c, normalizeGlitchFx({ intensity: 80, slices: 8, split: 3, seed: 12 }));
    expect(a.data).toEqual(b.data);
    expect(a.data).not.toEqual(c.data);
    expect(a.data).not.toEqual(base.data); // 실제로 픽셀을 움직였다
  });

  it("색 분리 0이면 각 행은 원본 행의 순환 이동이다(래핑 — 픽셀 소실 없음)", () => {
    const base = patternedImage(24, 16);
    const out = cloneImage(base);
    applyGlitchFx(out, normalizeGlitchFx({ intensity: 100, slices: 8, split: 0, seed: 5 }));
    for (let y = 0; y < base.height; y++) {
      const rowPixels = (img: StudioImageDataLike) => {
        const pixels: string[] = [];
        for (let x = 0; x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          pixels.push(
            `${img.data[i]},${img.data[i + 1]},${img.data[i + 2]},${img.data[i + 3]}`,
          );
        }
        return pixels.sort();
      };
      expect(rowPixels(out)).toEqual(rowPixels(base));
    }
  });

  it("경계 안전 — 1x1, 극단 조각 수/분리에서도 던지지 않고 값이 범위 안이다", () => {
    const tiny = solidImage(1, 1, 10, 20, 30);
    expect(() =>
      applyGlitchFx(tiny, normalizeGlitchFx({ intensity: 100, slices: 24, split: 12, seed: 9 })),
    ).not.toThrow();
    const skinny = patternedImage(3, 2);
    applyGlitchFx(skinny, normalizeGlitchFx({ intensity: 100, slices: 24, split: 12, seed: 9 }));
    for (const value of skinny.data) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(255);
    }
  });

  it("완전 투명 이미지는 투명하게 유지된다(알파 이동 정합)", () => {
    const img = patternedImage(12, 8, 0);
    applyGlitchFx(img, normalizeGlitchFx({ intensity: 90, slices: 6, split: 4, seed: 21 }));
    for (let i = 3; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(0);
    }
  });

  it("normalize가 무효 입력을 기본값·범위로 정리한다", () => {
    expect(normalizeGlitchFx(null)).toEqual(DEFAULT_GLITCH_FX);
    expect(
      normalizeGlitchFx({ intensity: 500, slices: 0.4, split: 99, seed: 123456 }),
    ).toEqual({ intensity: 100, slices: 1, split: 12, seed: 9999 });
  });

  it("Konva 래퍼는 attrs 계약으로 순수 엔진과 동일한 결과를 낸다", () => {
    const base = patternedImage();
    const direct = cloneImage(base);
    const viaKonva = cloneImage(base);
    const fx = normalizeGlitchFx({ intensity: 70, slices: 10, split: 2, seed: 8 });
    applyGlitchFx(direct, fx);
    glitchFxKonvaFilter.call(
      { attrs: { glitchIntensity: 70, glitchSlices: 10, glitchSplit: 2, glitchSeed: 8 } },
      viaKonva,
    );
    expect(viaKonva.data).toEqual(direct.data);
    // attrs 없음/항등이면 no-op.
    const untouched = cloneImage(base);
    glitchFxKonvaFilter.call({}, untouched);
    glitchFxKonvaFilter.call({ attrs: { glitchIntensity: 0 } }, untouched);
    expect(untouched.data).toEqual(base.data);
  });
});

// ---------------------------------------------------------------------------
// 비네트 엔진 — 중앙 보존/가장자리 감광/둥글기/알파
// ---------------------------------------------------------------------------

describe("applyVignetteFx", () => {
  const corner = (img: StudioImageDataLike) => img.data[0]!;
  const center = (img: StudioImageDataLike) => {
    const cx = Math.floor(img.width / 2);
    const cy = Math.floor(img.height / 2);
    return img.data[(cy * img.width + cx) * 4]!;
  };

  it("항등(darkness 0)은 픽셀을 건드리지 않는다", () => {
    const img = patternedImage(9, 9);
    const before = new Uint8ClampedArray(img.data);
    applyVignetteFx(img, normalizeVignetteFx({ darkness: 0 }));
    expect(img.data).toEqual(before);
    expect(isIdentityVignetteFx(DEFAULT_VIGNETTE_FX)).toBe(true);
  });

  it("중앙은 보존하고 모서리는 어둡게 한다(darkness 100 → 완전 검정)", () => {
    const img = solidImage(9, 9, 255, 255, 255);
    applyVignetteFx(
      img,
      normalizeVignetteFx({ darkness: 100, size: 10, roundness: 100, feather: 10 }),
    );
    expect(center(img)).toBe(255);
    expect(corner(img)).toBe(0);
  });

  it("어둡기가 클수록 모서리가 더 어둡다(단조성)", () => {
    const soft = solidImage(9, 9, 200, 200, 200);
    const hard = solidImage(9, 9, 200, 200, 200);
    const shape = { size: 45, roundness: 100, feather: 60 };
    applyVignetteFx(soft, normalizeVignetteFx({ ...shape, darkness: 40 }));
    applyVignetteFx(hard, normalizeVignetteFx({ ...shape, darkness: 90 }));
    expect(corner(hard)).toBeLessThan(corner(soft));
  });

  it("둥글기 100(타원)은 둥글기 0(사각)보다 모서리를 더 어둡게 만든다", () => {
    const round = solidImage(9, 9, 200, 200, 200);
    const square = solidImage(9, 9, 200, 200, 200);
    applyVignetteFx(
      round,
      normalizeVignetteFx({ darkness: 100, size: 45, roundness: 100, feather: 60 }),
    );
    applyVignetteFx(
      square,
      normalizeVignetteFx({ darkness: 100, size: 45, roundness: 0, feather: 60 }),
    );
    expect(corner(round)).toBeLessThan(corner(square));
  });

  it("알파는 절대 건드리지 않는다", () => {
    const img = patternedImage(8, 6, 173);
    applyVignetteFx(img, normalizeVignetteFx({ darkness: 100, size: 0, feather: 0 }));
    for (let i = 3; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(173);
    }
  });

  it("경계 안전 — 1x1에서도 던지지 않는다", () => {
    const tiny = solidImage(1, 1, 100, 100, 100);
    expect(() => applyVignetteFx(tiny, normalizeVignetteFx({ darkness: 100 }))).not.toThrow();
  });

  it("Konva 래퍼는 attrs 계약으로 순수 엔진과 동일한 결과를 낸다", () => {
    const base = patternedImage(9, 9);
    const direct = cloneImage(base);
    const viaKonva = cloneImage(base);
    const fx = normalizeVignetteFx({ darkness: 80, size: 30, roundness: 60, feather: 40 });
    applyVignetteFx(direct, fx);
    vignetteFxKonvaFilter.call(
      {
        attrs: {
          vignetteDarkness: 80,
          vignetteSize: 30,
          vignetteRoundness: 60,
          vignetteFeather: 40,
        },
      },
      viaKonva,
    );
    expect(viaKonva.data).toEqual(direct.data);
    const untouched = cloneImage(base);
    vignetteFxKonvaFilter.call({}, untouched);
    expect(untouched.data).toEqual(base.data);
  });
});

// ---------------------------------------------------------------------------
// 종단 간 — 드래프트 → 패치 → buildImageFilters → 실제 픽셀(tiny-image 기대값)
// ---------------------------------------------------------------------------

describe("studio filter pack 종단 간(라이브 엔진)", () => {
  it("모자이크 — 셀 평균으로 픽셀화된다", () => {
    const img: StudioImageDataLike = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([10, 20, 30, 255, 30, 40, 50, 255]),
    };
    const patch = studioFilterDraftToPatch(packDraft("mosaic", { cell: 2 }));
    const out = pixelsAfterPatch(patch, img);
    expect([...out.data]).toEqual([20, 30, 40, 255, 20, 30, 40, 255]);
  });

  it("한계값 — 레벨 기준으로 순흑/순백 2값화된다", () => {
    const img: StudioImageDataLike = {
      width: 1,
      height: 2,
      data: new Uint8ClampedArray([10, 10, 10, 255, 200, 200, 200, 128]),
    };
    const patch = studioFilterDraftToPatch(packDraft("threshold", { level: 128 }));
    const out = pixelsAfterPatch(patch, img);
    expect([...out.data]).toEqual([0, 0, 0, 255, 255, 255, 255, 128]);
  });

  it("선화 정리 — 페이지 합성 픽셀도 표준 필터 체인에서 이진화한다", () => {
    const img: StudioImageDataLike = {
      width: 3,
      height: 1,
      data: new Uint8ClampedArray([
        35, 45, 55, 255,
        160, 170, 180, 192,
        235, 240, 245, 0,
      ]),
    };
    const patch = studioFilterDraftToPatch(
      packDraft("line-cleanup", { threshold: 60, strength: 0 }),
    );
    const out = pixelsAfterPatch(patch, img);
    expect([...out.data]).toEqual([
      0, 0, 0, 255,
      255, 255, 255, 192,
      255, 255, 255, 0,
    ]);
  });

  it("톤·압축 노이즈 정리 3종은 순수 커널과 바이트 단위로 같은 페이지 합성 결과를 만든다", () => {
    const source = patternedImage(24, 16);
    const cases: readonly {
      kind: (typeof STUDIO_FILTER_PACK_KINDS)[number];
      values: Record<string, number>;
      pure: StudioToneArtifactAppliedResult;
    }[] = [
      {
        kind: "screentone-removal" as const,
        values: { radius: 2, strength: 88, inkLumaThreshold: 72 },
        pure: removeStudioScreentoneArtifacts(source, {
          radius: 2,
          strength: 0.88,
          inkLumaThreshold: 72,
        }),
      },
      {
        kind: "jpeg-artifact-reduction" as const,
        values: {
          deblockStrength: 72,
          deringStrength: 45,
          boundaryThreshold: 6,
          protectedEdgeThreshold: 88,
          ringingThreshold: 18,
          inkLumaThreshold: 64,
        },
        pure: reduceStudioJpegArtifacts(source, {
          deblockStrength: 0.72,
          deringStrength: 0.45,
          boundaryThreshold: 6,
          protectedEdgeThreshold: 88,
          ringingThreshold: 18,
          inkLumaThreshold: 64,
        }),
      },
      {
        kind: "edge-aware-denoise" as const,
        values: { radius: 1, strength: 78, rangeThreshold: 72 },
        pure: denoiseStudioRgba(source, {
          radius: 1,
          strength: 0.78,
          rangeThreshold: 72,
        }),
      },
    ];
    for (const testCase of cases) {
      expect(testCase.pure.status, testCase.kind).toBe("applied");
      if (testCase.pure.status !== "applied") continue;
      const patch = studioFilterDraftToPatch(packDraft(testCase.kind, testCase.values));
      expect(pixelsAfterPatch(patch, source).data, testCase.kind)
        .toEqual(testCase.pure.image.data);
    }
  });

  it("솔라라이즈 — 임계값 초과 채널만 반전된다", () => {
    const img: StudioImageDataLike = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([200, 50, 100, 255]),
    };
    const patch = studioFilterDraftToPatch(
      packDraft("solarize", { threshold: 128, strength: 100 }),
    );
    const out = pixelsAfterPatch(patch, img);
    expect([...out.data]).toEqual([55, 50, 100, 255]);
  });

  it("듀오톤 — 검정은 어두운 색, 흰색은 밝은 색으로 매핑된다", () => {
    const img: StudioImageDataLike = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]),
    };
    const patch = studioFilterDraftToPatch(
      packDraft("duotone", { shadow: "#2b1d0e", highlight: "#ffe9c9" }),
    );
    const out = pixelsAfterPatch(patch, img);
    const lo = hexToRgb("#2b1d0e");
    const hi = hexToRgb("#ffe9c9");
    expect([...out.data]).toEqual([lo.r, lo.g, lo.b, 255, hi.r, hi.g, hi.b, 255]);
  });

  it("엠보스 — 평탄한 이미지는 중립 회색(128) 릴리프가 된다", () => {
    const img = solidImage(3, 3, 100, 140, 90);
    const patch = studioFilterDraftToPatch(packDraft("emboss", { depth: 1, mix: 100 }));
    const out = pixelsAfterPatch(patch, img);
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(128);
      expect(out.data[i + 1]).toBe(128);
      expect(out.data[i + 2]).toBe(128);
      expect(out.data[i + 3]).toBe(255);
    }
  });

  it("노이즈 추가 — 같은 시드는 같은 픽셀, 다른 시드는 다른 픽셀(결정적)", () => {
    const base = solidImage(6, 6, 120, 120, 120);
    const a = pixelsAfterPatch(
      studioFilterDraftToPatch(packDraft("noise-add", { amount: 60, seed: 7 })),
      base,
    );
    const b = pixelsAfterPatch(
      studioFilterDraftToPatch(packDraft("noise-add", { amount: 60, seed: 7 })),
      base,
    );
    const c = pixelsAfterPatch(
      studioFilterDraftToPatch(packDraft("noise-add", { amount: 60, seed: 8 })),
      base,
    );
    expect(a.data).toEqual(b.data);
    expect(a.data).not.toEqual(c.data);
    expect(a.data).not.toEqual(base.data);
  });

  it("고급 블러·방사형/줌 블러·스캔라인·색수차·렌즈 플레어 패치도 라이브 필터 체인을 구성한다", () => {
    const konva: KonvaLike = { Filters: {} };
    registerStudioKonvaFilters(konva);
    for (const kind of [
      "radial-blur",
      "zoom-blur",
      "lens-blur",
      "field-iris-blur",
      "tilt-shift-blur",
      "selective-gaussian-blur",
      "tileable-blur",
      "scanline",
      "chromatic-aberration",
      "lens-flare",
      "oil-paint",
      "surface-blur",
      "line-cleanup",
      "screentone-removal",
      "jpeg-artifact-reduction",
      "edge-aware-denoise",
      "dust-scratches",
      "difference-of-gaussians",
      "color-to-alpha",
    ] as const) {
      const patch = studioFilterPackValuesToPatch(kind, {});
      const built = buildImageFilters(patch as ImageFilterFields, konva);
      expect(built.filters.length).toBeGreaterThan(0);
      // 실제 픽셀 실행에서도 던지지 않는다.
      const img = patternedImage(12, 10);
      expect(() => applyImageFilters(img, built.filters, built.attrs)).not.toThrow();
    }
  });

  it("다시 열기 값으로 만든 드래프트가 동일 패치를 재생성한다(마지막 필터 반복 계약)", () => {
    const firstPatch = studioFilterDraftToPatch(
      packDraft("scanline", { darkness: 62, spacing: 3 }),
    );
    // StudioPage가 lastFilterDraft를 넘겨 다이얼로그를 다시 열었을 때의 드래프트.
    const reopened = createStudioFilterDraft("scanline", firstPatch as ImageFilterFields);
    expect(studioFilterDraftToPatch(reopened)).toEqual(firstPatch);
  });
});
