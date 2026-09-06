/**
 * HiDPI 필터 슈퍼샘플 밀도 계약 테스트.
 *
 * StudioKonvaImageNode 의 studioImageFilterSupersampleDensity 는 "같은 룩, 더 선명한 픽셀"
 * 보증이 성립하는 경우(활성 보정 전부가 per-pixel 포인트 연산이거나 정규화 좌표 연산)에만
 * min(2, dpr)를 돌려주고, px 단위 파라미터(블러 반경·망점 도트·테두리 굵기·커널 풋프린트 등)가
 * 하나라도 활성이면 1을 돌려줘 기존 밀도를 유지해야 한다. 여기서는 화이트리스트를 손으로
 * 재나열하는 대신 실제 buildImageFilters 출력(attrs)과 대조해 필터 패밀리별로 검증한다 —
 * 새 필터가 attrs 를 추가하면 default-deny 로 자동 1× 이 되는 것도 함께 고정한다.
 */
import { describe, expect, it, vi } from "vitest";

import {
  buildImageFilters,
  registerStudioKonvaFilters,
  type KonvaLike,
} from "./studio-konva-filters";

import type { ImageFilterFields } from "./studio-konva-filter-fields";

// 순수 밀도 헬퍼만 쓰므로 렌더러/Konva 런타임은 로드하지 않는다(노드 환경 안전).
vi.mock("react-konva/lib/ReactKonvaCore", () => ({ Image: () => null }));
vi.mock("./studio-konva-runtime", () => ({ studioKonvaRuntime: { Filters: {} } }));

const {
  STUDIO_DENSITY_INVARIANT_FILTER_ATTRS,
  studioImageFilterSupersampleDensity,
} = await import("../StudioKonvaImageNode");

const registry: KonvaLike = { Filters: {} };
registerStudioKonvaFilters(registry);

function densityFor(el: ImageFilterFields, dpr = 2): number {
  const built = buildImageFilters(el, registry);
  return studioImageFilterSupersampleDensity({
    attrs: built.attrs,
    el,
    devicePixelRatio: dpr,
  });
}

// 밀도 불변(슈퍼샘플 허용) — 전부 per-pixel 포인트 연산 또는 정규화 좌표 연산.
const INVARIANT_FIXTURES: Record<string, ImageFilterFields> = {
  brightness: { brightness: 0.2 },
  contrast: { contrast: 25 },
  grayscale: { grayscale: true },
  sepia: { sepia: true },
  invert: { invert: true },
  hsl: { saturation: 0.4, hue: 120 },
  temperature: { temperature: 40 },
  levels: { levelsBlack: 12, levelsGamma: 1.4, levelsCh: { r: { gamma: 1.2 } } },
  curve: {
    curve: [{ x: 0, y: 20 }, { x: 255, y: 255 }],
    curveCh: { g: [{ x: 0, y: 10 }, { x: 255, y: 250 }] },
  },
  colorBalance: {
    colorBalance: { shadows: [10, 0, -5], midtones: [0, 0, 0], highlights: [0, 5, 0] },
  },
  channelMixer: {
    channelMixer: {
      red: { r: 0.8, g: 0.2, b: 0, constant: 0 },
      green: { r: 0, g: 1, b: 0, constant: 0 },
      blue: { r: 0, g: 0, b: 1, constant: 0 },
      monochrome: false,
    },
  },
  selectiveHsl: {
    selectiveHsl: {
      red: { hue: 15, sat: 10, lum: 0 },
    } as ImageFilterFields["selectiveHsl"],
  },
  vibrance: { vibrance: { vibrance: 40, saturation: 10 } },
  gradientMap: {
    gradientMap: { stops: [{ pos: 0, color: "#102030" }, { pos: 1, color: "#ffeedd" }] },
  },
  photoFilter: { photoFilter: { color: "#ff8800", density: 40, preserveLuminosity: true } },
  colorToAlpha: { colorToAlpha: { keyColor: "#ffffff", strength: 80 } },
  shadowHighlight: {
    shadowHighlight: {
      shadows: 40,
      shadowsWidth: 50,
      highlights: 20,
      highlightsWidth: 50,
      midtoneContrast: 10,
    },
  },
  duotone: { duotoneShadow: "#123456", duotoneHighlight: "#ffeedd" },
  inkThreshold: { inkThreshold: 0.5 },
  posterize: { posterize: 4 },
  exposure: { exposureAdjustment: { exposure: 0.8, gamma: 1.1, offset: 0.05 } },
  vignette: { vignetteFx: { darkness: 50, size: 40, roundness: 80, feather: 60 } },
};

// px 단위 파라미터 보유(또는 통계/커널/스택이라 증명 불가) — 반드시 1× 유지.
const PX_UNIT_FIXTURES: Record<string, ImageFilterFields> = {
  blur: { blur: 6 },
  sharpen: { sharpen: 0.5 },
  pixelate: { pixelate: 8 },
  chromatic: { chromatic: 4 },
  noise: { noise: 30 },
  screentone: { screentone: true },
  lineart: { lineart: true },
  lineCleanup: { lineCleanup: { threshold: 0.6, strength: 0.5 } },
  screentoneRemoval: {
    screentoneRemoval: { radius: 2, strength: 0.88, inkLumaThreshold: 72 },
  },
  jpegArtifactReduction: {
    jpegArtifactReduction: {
      deblockStrength: 0.72,
      deringStrength: 0.45,
      boundaryThreshold: 6,
      protectedEdgeThreshold: 88,
      ringingThreshold: 18,
      inkLumaThreshold: 64,
    },
  },
  edgeAwareDenoise: {
    edgeAwareDenoise: { radius: 1, strength: 0.78, rangeThreshold: 72 },
  },
  lensBlur: {
    lensBlur: {
      radius: 4,
      sampleCount: 21,
      apertureBlades: 6,
      apertureRotationRadians: 0,
    },
  },
  fieldIrisBlur: {
    fieldIrisBlur: {
      focusCenterX: 0.5,
      focusCenterY: 0.5,
      focusRadius: 0.16,
      feather: 0.24,
      maximumBlurRadius: 7,
      sampleCount: 21,
      apertureBlades: 8,
    },
  },
  tiltShiftBlur: {
    tiltShiftBlur: {
      axisRadians: 0,
      focusWidth: 0.2,
      feather: 0.22,
      maximumBlurRadius: 7,
      sampleCount: 19,
    },
  },
  selectiveGaussianBlur: {
    selectiveGaussianBlur: {
      radius: 3,
      spatialSigma: 2,
      edgeThreshold: 20,
      edgeSoftness: 0.35,
    },
  },
  halftone: { halftone: { dotSize: 6, angle: 15, mode: "cmyk", strength: 80 } },
  grain: { grain: { type: "film", amount: 40, size: 3, seed: 7 } },
  inkWash: {
    inkWash: {
      strength: 50,
      spread: 4,
      edgeBleed: 30,
      granulation: 30,
      paper: 20,
      inkColor: "#223344",
      seed: 11,
    },
  },
  blurFx: { blurFx: { type: "gaussian", strength: 50, radius: 8, angle: 0 } },
  distort: { distort: { type: "wave", amount: 40, scale: 12 } },
  stylize: { stylize: { type: "emboss", strength: 50, detail: 4 } },
  sketch: { sketch: { type: "photocopy", strength: 50, detail: 4 } },
  detail: { detail: { type: "highPass", amount: 50, radius: 3 } },
  clarity: { clarity: { clarity: 30, dehaze: 0 } },
  glow: { glow: { strength: 60, size: 10, threshold: 60, color: "auto" } },
  outline: { outline: { color: "#000000", width: 6, opacity: 1 } },
  unsharpMask: { unsharpMask: { amount: 1.2, radius: 2, threshold: 4 } },
  morphology: { morphology: { mode: "dilate", radius: 2 } },
  pixelOffset: { pixelOffset: { x: 4, y: 0, edge: "wrap" } },
  convolution: { convolution: { kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], divisor: 1, bias: 0 } },
  clouds: { clouds: { amount: 50, scale: 20, seed: 3, mode: "overlay" } },
  glitch: { glitchFx: { intensity: 40, slices: 8, split: 4, seed: 1337 } },
  light: { light: { type: "glowStreak", intensity: 50, x: 30, y: 30, hue: 45 } },
  autoAdjust: { autoAdjust: { mode: "contrast", strength: 80 } },
  smartFilter: {
    smartFilterOperations: [
      { id: "a1", engine: "gaussian-blur", enabled: true, params: { radius: 6 } },
    ],
  },
};

describe("studioImageFilterSupersampleDensity", () => {
  it("밀도 불변 필터 패밀리는 min(2, dpr)로 슈퍼샘플링한다", () => {
    for (const [name, el] of Object.entries(INVARIANT_FIXTURES)) {
      const built = buildImageFilters(el, registry);
      // 픽스처가 실제로 필터를 활성화하는지 먼저 보증(항등이면 검증이 무의미해진다).
      expect(built.filters.length, `${name} fixture must activate a filter`).toBeGreaterThan(0);
      expect(densityFor(el, 2), `${name} should supersample`).toBe(2);
      // density=2 의 근거: 부착된 attrs 전부가 명시적 화이트리스트에 있다.
      for (const key of Object.keys(built.attrs)) {
        expect(
          STUDIO_DENSITY_INVARIANT_FILTER_ATTRS.has(key),
          `${name} attr ${key} must be allowlisted`,
        ).toBe(true);
      }
    }
  });

  it("px 단위·증명 불가 필터가 하나라도 활성이면 1×를 유지한다(같은 룩 보증)", () => {
    for (const [name, el] of Object.entries(PX_UNIT_FIXTURES)) {
      const built = buildImageFilters(el, registry);
      expect(built.filters.length, `${name} fixture must activate a filter`).toBeGreaterThan(0);
      expect(densityFor(el, 2), `${name} must stay at 1x density`).toBe(1);
    }
  });

  it("불변 + px 단위 혼합 프로그램도 1×로 떨어진다(버퍼는 하나라 필터별 밀도가 불가능)", () => {
    expect(densityFor({ brightness: 0.2, blur: 4 }, 2)).toBe(1);
    expect(densityFor({ contrast: 20, outline: { color: "#000000", width: 4, opacity: 1 } }, 2)).toBe(1);
  });

  it("dpr 경계 — 1 이하/비유한은 1, 분수는 그대로, 2 초과는 2로 캡", () => {
    const el: ImageFilterFields = { brightness: 0.2 };
    expect(densityFor(el, 1)).toBe(1);
    expect(densityFor(el, 0)).toBe(1);
    expect(densityFor(el, Number.NaN)).toBe(1);
    expect(densityFor(el, Number.POSITIVE_INFINITY)).toBe(1);
    expect(densityFor(el, 1.5)).toBe(1.5);
    expect(densityFor(el, 2)).toBe(2);
    expect(densityFor(el, 3)).toBe(2);
  });

  it("미등재 attr 는 default-deny — 미래에 추가될 필터도 등재 전까지 1×", () => {
    expect(
      studioImageFilterSupersampleDensity({
        attrs: { futurePxFilterRadius: 3 },
        el: {},
        devicePixelRatio: 2,
      }),
    ).toBe(1);
    // 스마트 필터 스택은 attrs 가 래퍼 클로저에 숨으므로 el 플래그만으로 보수적으로 차단된다.
    expect(
      studioImageFilterSupersampleDensity({
        attrs: {},
        el: { smartFilters: { version: 1, entries: [] } },
        devicePixelRatio: 2,
      }),
    ).toBe(1);
  });
});
