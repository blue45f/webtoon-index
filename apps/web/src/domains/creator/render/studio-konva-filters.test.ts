import { describe, expect, it, vi } from "vitest";

import {
  studioAdjustmentDefaultParams,
  type StudioAdjustmentEngineId,
} from "../studio-adjustment-stack";
import { IMAGE_FILTER_PRESETS, type StudioImageDataLike } from "../studio-filters";

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

// 내장 필터 스텁을 가진 가짜 konva — node 없이 순수 검증.
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

// 단색 채운 가짜 ImageData(width*height 픽셀).
function solidImage(width: number, height: number, r: number, g: number, b: number): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { data, width, height };
}

function patternedImage(width = 19, height = 17): StudioImageDataLike {
  const image = solidImage(width, height, 0, 0, 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      image.data[index] = (x * 31 + y * 17 + (x % 3) * 71) % 256;
      image.data[index + 1] = (x * 11 + y * 47 + (y % 4) * 53) % 256;
      image.data[index + 2] = (x * 61 + y * 7 + ((x + y) % 5) * 37) % 256;
      image.data[index + 3] = 173;
    }
  }
  return image;
}

const CUSTOM = [
  "Screentone",
  "Lineart",
  "Chromatic",
  "Posterize",
  "Noise",
  "Temperature",
  "Sharpen",
  "InkThreshold",
  "Duotone",
  "InkWash",
  "ExposureAdjustment",
  "UnsharpMask",
  "Morphology",
  "PixelOffset",
  "Convolution",
  "Clouds",
  "ColorToAlpha",
  "DifferenceOfGaussians",
  "DustScratches",
  "TileableBlur",
] as const;

describe("registerStudioKonvaFilters", () => {
  it("커스텀 필터를 함수로 등록한다", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    for (const name of CUSTOM) {
      expect(typeof konva.Filters[name]).toBe("function");
    }
  });

  it("멱등 — 두 번 호출해도 함수로 유지되고 throw 없음", () => {
    const konva = fakeKonva();
    expect(() => {
      registerStudioKonvaFilters(konva);
      registerStudioKonvaFilters(konva);
    }).not.toThrow();
    for (const name of CUSTOM) {
      expect(typeof konva.Filters[name]).toBe("function");
    }
  });

  it("내장 Blur 참조를 덮어쓰지 않는다", () => {
    const konva = fakeKonva();
    const originalBlur = konva.Filters.Blur;
    registerStudioKonvaFilters(konva);
    expect(konva.Filters.Blur).toBe(originalBlur);
  });

  it("Temperature 래퍼가 attrs로 호출되면 ImageData를 실제로 변형한다(따뜻하게: r↑ b↓)", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    const img = solidImage(1, 1, 128, 128, 128);
    konva.Filters.Temperature!.call({ attrs: { temperature: 100 } }, img);
    expect(img.data[0]!).toBeGreaterThan(128); // red 증가
    expect(img.data[2]!).toBeLessThan(128); // blue 감소
  });

  it("0/무효 스타일 attrs는 no-op이고 Lineart는 기존 alpha를 보존한다", () => {
    const konva: KonvaLike = { Filters: {} };
    registerStudioKonvaFilters(konva);
    const source = solidImage(4, 4, 64, 128, 192);
    source.data[3] = 37;
    const before = Array.from(source.data);
    const F = konva.Filters as Record<string, (imageData: StudioImageDataLike) => void>;

    F.Chromatic!.call({ attrs: { chromatic: 0 } }, source);
    F.Posterize!.call({ attrs: { posterize: 0 } }, source);
    F.Noise!.call({ attrs: { noise: Number.NaN } }, source);
    expect(Array.from(source.data)).toEqual(before);

    F.Lineart!.call({ attrs: {} }, source);
    expect(source.data[3]).toBe(37);
  });

  it("Chromatic 정수 오프셋은 정수 시프트와 동일하고 실수 오프셋은 서브픽셀 보간한다", () => {
    const konva: KonvaLike = { Filters: {} };
    registerStudioKonvaFilters(konva);
    const F = konva.Filters as Record<string, (imageData: StudioImageDataLike) => void>;
    // 가로 그라디언트: r = b = x*20, g = 100.
    const gradient = (): StudioImageDataLike => {
      const img = solidImage(8, 1, 0, 100, 0);
      for (let x = 0; x < 8; x += 1) {
        img.data[x * 4] = x * 20;
        img.data[x * 4 + 2] = x * 20;
      }
      return img;
    };

    const integer = gradient();
    F.Chromatic!.call({ attrs: { chromatic: 2 } }, integer);
    // x=4: r은 x-2=2에서 40, b는 x+2=6에서 120 — 기존 정수 시프트 그대로.
    expect(integer.data[4 * 4]).toBe(40);
    expect(integer.data[4 * 4 + 2]).toBe(120);

    const fractional = gradient();
    F.Chromatic!.call({ attrs: { chromatic: 2.5 } }, fractional);
    // x=4: r은 x-2.5=1.5 보간 (20+40)/2=30, b는 x+2.5=6.5 보간 (120+140)/2=130.
    expect(fractional.data[4 * 4]).toBe(30);
    expect(fractional.data[4 * 4 + 2]).toBe(130);
    // 왼쪽 가장자리 클램프: x=1 → rx=max(0, -1.5)=0 → 보간 없이 0.
    expect(fractional.data[1 * 4]).toBe(0);
  });
});

describe("buildImageFilters", () => {
  it("보정 없음 → 빈 filters + 빈 attrs", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    const { filters, attrs } = buildImageFilters({}, konva);
    expect(filters).toEqual([]);
    expect(attrs).toEqual({});
  });

  it("blur만 → [Blur] + { blurRadius }", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    const { filters, attrs } = buildImageFilters({ blur: 5 }, konva);
    expect(filters).toEqual([konva.Filters.Blur]);
    expect(attrs).toEqual({ blurRadius: 5 });
  });

  it("saturation만 → [HSL] + { saturation, hue:0, luminance:0 }", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    const { filters, attrs } = buildImageFilters({ saturation: 0.5 }, konva);
    expect(filters).toEqual([konva.Filters.HSL]);
    expect(attrs).toEqual({ saturation: 0.5, hue: 0, luminance: 0 });
  });

  it("hue -90 → attrs.hue === 270 (0..359로 정규화)", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    const { attrs } = buildImageFilters({ hue: -90 }, konva);
    expect(attrs.hue).toBe(270);
    expect(attrs.saturation).toBe(0);
  });

  it("hue 420 → attrs.hue === 60", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    const { attrs } = buildImageFilters({ hue: 420 }, konva);
    expect(attrs.hue).toBe(60);
  });

  it("듀오톤은 shadow만 있으면 포함되지 않는다", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    const { filters, attrs } = buildImageFilters({ duotoneShadow: "#101040" }, konva);
    expect(filters).not.toContain(konva.Filters.Duotone);
    expect(attrs.duotoneShadow).toBeUndefined();
  });

  it("듀오톤은 shadow+highlight 둘 다 있으면 포함된다", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    const { filters, attrs } = buildImageFilters(
      { duotoneShadow: "#101040", duotoneHighlight: "#ff8fb3" },
      konva,
    );
    expect(filters).toContain(konva.Filters.Duotone);
    expect(attrs.duotoneShadow).toBe("#101040");
    expect(attrs.duotoneHighlight).toBe("#ff8fb3");
  });

  it("pixelate → pixelSize는 max(1, round)", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    expect(buildImageFilters({ pixelate: 3.6 }, konva).attrs.pixelSize).toBe(4);
    expect(buildImageFilters({ pixelate: 0.2 }, konva).attrs.pixelSize).toBe(1);
  });

  it("풀 콤보 — 멤버십과 순서(색조정 → 스타일라이즈)가 올바르다", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    const el: ImageFilterFields = {
      brightness: 0.2,
      contrast: 10,
      saturation: 0.3,
      hue: 30,
      temperature: 20,
      sharpen: 0.5,
      grayscale: true,
      sepia: true,
      invert: true,
      inkThreshold: 0.5,
      duotoneShadow: "#101040",
      duotoneHighlight: "#ff8fb3",
      screentone: true,
      lineart: true,
      chromatic: 4,
      posterize: 4,
      noise: 20,
      pixelate: 8,
      blur: 2,
    };
    const { filters } = buildImageFilters(el, konva);
    const F = konva.Filters;

    // 활성 보정 전부 포함.
    const expectedMembers = [
      F.Brighten,
      F.Contrast,
      F.Blur,
      F.HSL,
      F.Temperature,
      F.Sharpen,
      F.Grayscale,
      F.Sepia,
      F.Invert,
      F.InkThreshold,
      F.Duotone,
      F.Screentone,
      F.Lineart,
      F.Chromatic,
      F.Posterize,
      F.Noise,
      F.Pixelate,
    ];
    for (const fn of expectedMembers) {
      expect(filters).toContain(fn);
    }

    // 모든 색/톤 보정이 모든 스타일라이즈보다 앞.
    const colorTone = [F.Brighten, F.Contrast, F.Blur, F.HSL, F.Temperature, F.Sharpen, F.Grayscale, F.Sepia, F.Invert];
    const stylize = [F.InkThreshold, F.Duotone, F.Screentone, F.Lineart, F.Chromatic, F.Posterize, F.Noise, F.Pixelate];
    const maxColorIdx = Math.max(...colorTone.map((fn) => filters.indexOf(fn as (i: StudioImageDataLike) => void)));
    const minStyleIdx = Math.min(...stylize.map((fn) => filters.indexOf(fn as (i: StudioImageDataLike) => void)));
    expect(maxColorIdx).toBeLessThan(minStyleIdx);
  });

  it("0 값 숫자 필드는 비활성으로 취급한다", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    const { filters, attrs } = buildImageFilters({ blur: 0, brightness: 0, chromatic: 0 }, konva);
    expect(filters).toEqual([]);
    expect(attrs).toEqual({});
  });

  // 의도적 변경(2026-07-24): grain.chroma → attrs.grainChroma 배선 — 0/누락은 attrs에
  // 싣지 않아 기존 문서의 attrs 형태(grainType/Amount/Size/Seed 4개)가 그대로 유지된다.
  it("grain.chroma>0 → attrs.grainChroma 포함, 0/누락 → 레거시 4개 attrs만", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    const withChroma = buildImageFilters(
      { grain: { type: "film", amount: 30, size: 1, seed: 7, chroma: 40 } },
      konva,
    );
    expect(withChroma.filters).toContain(konva.Filters.Grain);
    expect(withChroma.attrs).toEqual({
      grainType: "film",
      grainAmount: 30,
      grainSize: 1,
      grainSeed: 7,
      grainChroma: 40,
    });

    for (const grain of [
      { type: "film", amount: 30, size: 1, seed: 7 } as const,
      { type: "film", amount: 30, size: 1, seed: 7, chroma: 0 } as const,
    ]) {
      const legacy = buildImageFilters({ grain }, konva);
      expect(legacy.attrs).toEqual({ grainType: "film", grainAmount: 30, grainSize: 1, grainSeed: 7 });
    }
  });

  it("NaN/Infinity/음수 강도는 비활성이고 유한한 거대값은 UI 안전 범위로 제한한다", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    const malformed = {
      blur: Number.NaN,
      brightness: Number.POSITIVE_INFINITY,
      chromatic: -5,
      posterize: -1,
      noise: Number.NEGATIVE_INFINITY,
      duotoneShadow: "invalid",
      duotoneHighlight: "#fff",
    } as ImageFilterFields;
    expect(hasActiveImageFilters(malformed)).toBe(false);
    expect(buildImageFilters(malformed, konva)).toMatchObject({ filters: [], attrs: {} });

    expect(buildImageFilters({ blur: 1e12 }, konva).attrs.blurRadius).toBe(30);
    expect(buildImageFilters({ brightness: -1e12 }, konva).attrs.brightness).toBe(-0.8);
    expect(buildImageFilters({ contrast: 1e12 }, konva).attrs.contrast).toBe(80);
    expect(buildImageFilters({ posterize: 1 }, konva).attrs.posterize).toBe(2);
    expect(buildImageFilters({ pixelate: 1e12 }, konva).attrs.pixelSize).toBe(40);
  });

  it("수묵 재질은 활성값만 필터와 전용 attrs로 직렬화한다", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    const { filters, attrs } = buildImageFilters(
      {
        inkWash: {
          strength: 82,
          spread: 4,
          edgeBleed: 55,
          granulation: 36,
          paper: 64,
          inkColor: "#264c70",
          seed: 112,
        },
      },
      konva,
    );
    expect(filters).toContain(konva.Filters.InkWash);
    expect(attrs).toMatchObject({
      inkWashStrength: 82,
      inkWashSpread: 4,
      inkWashEdgeBleed: 55,
      inkWashGranulation: 36,
      inkWashPaper: 64,
      inkWashColor: "#264c70",
      inkWashSeed: 112,
    });
  });

  it("수묵 재질의 세기 0은 캐시를 켜지 않는 항등값이다", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    expect(hasActiveImageFilters({ inkWash: { strength: 0 } as ImageFilterFields["inkWash"] })).toBe(false);
    expect(buildImageFilters({ inkWash: { strength: 0 } as ImageFilterFields["inkWash"] }, konva).filters).toEqual([]);
  });

  it("신규 고급 필터를 정규화한 attrs와 결정적 실행 순서로 빌드한다", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    const { filters, attrs } = buildImageFilters({
      pixelOffset: { x: 4, y: -2, edge: "wrap" },
      morphology: { mode: "erode", radius: 2 },
      unsharpMask: { amount: 1.2, radius: 3, threshold: 10 },
      convolution: { kernel: [0, -1, 0, -1, 5, -1, 0, -1, 0], divisor: 1, bias: 0 },
      exposureAdjustment: { exposure: 1, gamma: 0.8, offset: 0.05 },
      clouds: { amount: 0.4, scale: 80, seed: 42, mode: "screen" },
    }, konva);
    expect(attrs).toMatchObject({
      pixelOffsetX: 4,
      pixelOffsetY: -2,
      pixelOffsetEdge: "wrap",
      morphMode: "erode",
      morphRadius: 2,
      unsharpAmount: 1.2,
      unsharpRadius: 3,
      unsharpThreshold: 10,
      convKernel: [0, -1, 0, -1, 5, -1, 0, -1, 0],
      convDivisor: 1,
      convBias: 0,
      exposureEv: 1,
      exposureGamma: 0.8,
      exposureOffset: 0.05,
      cloudAmount: 0.4,
      cloudScale: 80,
      cloudSeed: 42,
      cloudMode: "screen",
    });
    expect(attrs).not.toHaveProperty("offsetX");
    expect(attrs).not.toHaveProperty("offsetY");
    expect(filters.indexOf(konva.Filters.PixelOffset as never))
      .toBeLessThan(filters.indexOf(konva.Filters.Morphology as never));
    expect(filters.indexOf(konva.Filters.ExposureAdjustment as never))
      .toBeLessThan(filters.indexOf(konva.Filters.Clouds as never));
  });

  it("톤·압축 노이즈 정리 3종을 원자적 입력 컨디셔닝 순서와 정규화 attrs로 빌드한다", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    const { filters, attrs } = buildImageFilters({
      lineCleanup: { threshold: 0.64, strength: 0.45 },
      screentoneRemoval: { radius: 2, strength: 0.88, inkLumaThreshold: 72 },
      jpegArtifactReduction: {
        deblockStrength: 0.72,
        deringStrength: 0.45,
        boundaryThreshold: 6,
        protectedEdgeThreshold: 88,
        ringingThreshold: 18,
        inkLumaThreshold: 64,
      },
      edgeAwareDenoise: { radius: 1, strength: 0.78, rangeThreshold: 72 },
    }, konva);
    expect(attrs).toMatchObject({
      jpegDeblockStrength: 0.72,
      jpegDeringStrength: 0.45,
      jpegBoundaryThreshold: 6,
      jpegProtectedEdgeThreshold: 88,
      jpegRingingThreshold: 18,
      jpegInkThreshold: 64,
      toneRemovalRadius: 2,
      toneRemovalStrength: 0.88,
      toneRemovalInkThreshold: 72,
      edgeDenoiseRadius: 1,
      edgeDenoiseStrength: 0.78,
      edgeDenoiseRangeThreshold: 72,
      lineCleanupThreshold: 0.64,
      lineCleanupStrength: 0.45,
    });
    expect(filters.indexOf(konva.Filters.JpegArtifactReduction as never))
      .toBeLessThan(filters.indexOf(konva.Filters.ScreentoneRemoval as never));
    expect(filters.indexOf(konva.Filters.ScreentoneRemoval as never))
      .toBeLessThan(filters.indexOf(konva.Filters.EdgeAwareDenoise as never));
    expect(filters.indexOf(konva.Filters.EdgeAwareDenoise as never))
      .toBeLessThan(filters.indexOf(konva.Filters.LineCleanup as never));
  });

  it("전문 필터 4종을 보존된 순서와 Worker 실행 표식으로 빌드한다", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    const { filters, attrs } = buildImageFilters({
      tileableBlur: { radius: 5, sigma: 2.2, strength: 0.8 },
      dustScratches: { radius: 2, threshold: 24, strength: 0.9 },
      differenceOfGaussians: {
        smallSigma: 0.8,
        largeSigma: 2,
        threshold: 1.5,
        strength: 12,
      },
      colorToAlpha: { keyColor: "#ffffff", strength: 85 },
    }, konva, "worker");

    expect(attrs).toMatchObject({
      professionalFilterExecution: "worker",
      tileableBlurRadius: 5,
      tileableBlurSigma: 2.2,
      tileableBlurStrength: 0.8,
      dustScratchRadius: 2,
      dustScratchThreshold: 24,
      dustScratchStrength: 0.9,
      dogSmallSigma: 0.8,
      dogLargeSigma: 2,
      dogThreshold: 1.5,
      dogStrength: 12,
      ctaColor: "#ffffff",
      ctaStrength: 85,
    });
    const ordered = [
      konva.Filters.TileableBlur,
      konva.Filters.DustScratches,
      konva.Filters.DifferenceOfGaussians,
      konva.Filters.ColorToAlpha,
    ].map((filter) => filters.indexOf(filter as never));
    expect(ordered.every((index) => index >= 0)).toBe(true);
    expect(ordered).toEqual([...ordered].sort((left, right) => left - right));
  });

  it("신규 항등 객체는 필터 모듈과 캐시를 활성화하지 않는다", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    const identity: ImageFilterFields = {
      exposureAdjustment: { exposure: 0, gamma: 1, offset: 0 },
      unsharpMask: { amount: 0, radius: 2, threshold: 0 },
      morphology: { mode: "dilate", radius: 0 },
      pixelOffset: { x: 0, y: 0, edge: "wrap" },
      convolution: { kernel: [0, 0, 0, 0, 1, 0, 0, 0, 0], divisor: 1, bias: 0 },
      clouds: { amount: 0, scale: 96, seed: 42, mode: "overlay" },
      screentoneRemoval: { radius: 2, strength: 0, inkLumaThreshold: 72 },
      jpegArtifactReduction: {
        deblockStrength: 0,
        deringStrength: 0,
        boundaryThreshold: 6,
        protectedEdgeThreshold: 88,
        ringingThreshold: 18,
        inkLumaThreshold: 64,
      },
      edgeAwareDenoise: { radius: 1, strength: 0, rangeThreshold: 72 },
      tileableBlur: { radius: 5, sigma: 2.2, strength: 0 },
      dustScratches: { radius: 2, threshold: 24, strength: 0 },
      differenceOfGaussians: {
        smallSigma: 0.8,
        largeSigma: 2,
        threshold: 1.5,
        strength: 0,
      },
      colorToAlpha: { keyColor: "#ffffff", strength: 0 },
    };
    expect(hasActiveImageFilters(identity)).toBe(false);
    expect(hasLightweightActiveImageFilters(identity)).toBe(false);
    expect(buildImageFilters(identity, konva).filters).toEqual([]);
  });

  it("runs smart-filter entries in stored order and retains duplicate engines with private attrs", () => {
    const konva: KonvaLike = { Filters: {} };
    registerStudioKonvaFilters(konva);
    const program = (
      smartFilters: NonNullable<ImageFilterFields["smartFilters"]>,
    ): ImageFilterFields => ({ smartFilters });
    const brightnessThenInvert: ImageFilterFields = program({
      version: 1,
      entries: [
        { id: "bright-a", engine: "brightness-contrast", enabled: true, params: { brightness: 0.1 } },
        { id: "bright-b", engine: "brightness-contrast", enabled: true, params: { brightness: 0.1 } },
        { id: "invert", engine: "invert", enabled: true, params: {} },
      ],
    });
    const invertThenBrightness: ImageFilterFields = program({
      version: 1,
      entries: [
        { id: "invert", engine: "invert", enabled: true, params: {} },
        { id: "bright-a", engine: "brightness-contrast", enabled: true, params: { brightness: 0.1 } },
        { id: "bright-b", engine: "brightness-contrast", enabled: true, params: { brightness: 0.1 } },
      ],
    });
    const first = solidImage(1, 1, 60, 60, 60);
    const second = solidImage(1, 1, 60, 60, 60);
    const firstBuild = buildImageFilters(brightnessThenInvert, konva);
    const secondBuild = buildImageFilters(invertThenBrightness, konva);

    expect(firstBuild.filters).toHaveLength(3);
    expect(firstBuild.attrs).toEqual({});
    applyImageFilters(first, firstBuild.filters, firstBuild.attrs);
    applyImageFilters(second, secondBuild.filters, secondBuild.attrs);

    expect(first.data[0]).toBe(143);
    expect(second.data[0]).toBe(246);
  });

  it("uses a stable scalar-noise seed without consulting Math.random", () => {
    const konva: KonvaLike = { Filters: {} };
    registerStudioKonvaFilters(konva);
    const first = solidImage(8, 1, 128, 128, 128);
    const second = solidImage(8, 1, 128, 128, 128);
    const different = solidImage(8, 1, 128, 128, 128);
    const random = vi.spyOn(Math, "random");
    try {
      const seeded = buildImageFilters({ noise: 30, noiseSeed: 42 }, konva);
      applyImageFilters(first, seeded.filters, seeded.attrs);
      applyImageFilters(second, seeded.filters, seeded.attrs);
      const otherSeed = buildImageFilters({ noise: 30, noiseSeed: 43 }, konva);
      applyImageFilters(different, otherSeed.filters, otherSeed.attrs);

      expect(Array.from(first.data)).toEqual(Array.from(second.data));
      expect(Array.from(first.data)).not.toEqual(Array.from(different.data));
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });

  it("each added smart filter executes a distinct deterministic pixel program", () => {
    const konva: KonvaLike = { Filters: {} };
    registerStudioKonvaFilters(konva);
    const engines = [
      "spin-blur",
      "zoom-blur",
      "pixelate",
      "posterize",
      "ink-threshold",
      "line-extraction",
      "screentone",
      "color-halftone",
      "chromatic-aberration",
      "grayscale",
      "sepia",
      "edge-detect",
      "emboss",
      "high-pass",
      "median-despeckle",
      "solarize",
      "oil-paint",
      "smart-sharpen",
      "color-to-alpha",
      "difference-of-gaussians",
      "dust-scratches",
      "tileable-blur",
    ] as const satisfies readonly StudioAdjustmentEngineId[];
    const source = patternedImage();
    const sourceRgb = Array.from(source.data).filter((_, index) => index % 4 !== 3);
    const signatures = new Map<StudioAdjustmentEngineId, string>();

    for (const engine of engines) {
      const image = {
        ...source,
        data: new Uint8ClampedArray(source.data),
      };
      const { filters, attrs } = buildImageFilters({
        smartFilters: {
          version: 1,
          entries: [{
            id: `effect-${engine}`,
            engine,
            enabled: true,
            params: studioAdjustmentDefaultParams(engine),
          }],
        },
      }, konva);
      expect(filters.length, engine).toBeGreaterThan(0);
      applyImageFilters(image, filters, attrs);
      const rgb = Array.from(image.data).filter((_, index) => index % 4 !== 3);
      expect(rgb, engine).not.toEqual(sourceRgb);
      const alpha = Array.from(image.data).filter((_, index) => index % 4 === 3);
      if (engine === "color-to-alpha") {
        expect(alpha.some((value) => value !== 173), engine).toBe(true);
      } else {
        expect(alpha, engine)
          .toEqual(Array.from({ length: source.width * source.height }, () => 173));
      }
      signatures.set(engine, rgb.join(","));
    }

    expect(new Set(signatures.values()).size).toBe(engines.length);
  });
});

describe("IMAGE_FILTER_PRESETS pixel integration", () => {
  it("원본 외 모든 프리셋이 실제 RGB를 바꾸고 일정 alpha를 보존한다", () => {
    const konva: KonvaLike = { Filters: {} };
    registerStudioKonvaFilters(konva);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.75);
    try {
      for (const preset of IMAGE_FILTER_PRESETS) {
        const img = solidImage(7, 7, 0, 0, 0);
        for (let i = 0; i < img.data.length; i += 4) {
          const pixel = i / 4;
          img.data[i] = (pixel * 37 + 19) % 256;
          img.data[i + 1] = (pixel * 71 + 53) % 256;
          img.data[i + 2] = (pixel * 109 + 97) % 256;
          img.data[i + 3] = 173;
        }
        const beforeRgb = Array.from(img.data).filter((_, index) => index % 4 !== 3);
        const { filters, attrs } = buildImageFilters(preset.patch, konva);
        applyImageFilters(img, filters, attrs);
        const afterRgb = Array.from(img.data).filter((_, index) => index % 4 !== 3);

        if (preset.id === "original") expect(afterRgb, preset.id).toEqual(beforeRgb);
        else expect(afterRgb, preset.id).not.toEqual(beforeRgb);
        expect(Array.from(img.data).filter((_, index) => index % 4 === 3), preset.id)
          .toEqual(Array.from({ length: 49 }, () => 173));
      }
    } finally {
      random.mockRestore();
    }
  });
});

describe("hasActiveImageFilters", () => {
  it("활성 보정이 있으면 true", () => {
    expect(hasActiveImageFilters({ blur: 3 })).toBe(true);
    expect(hasActiveImageFilters({ grayscale: true })).toBe(true);
    expect(hasActiveImageFilters({ hue: -90 })).toBe(true);
    expect(hasActiveImageFilters({ duotoneShadow: "#000", duotoneHighlight: "#fff" })).toBe(true);
    expect(hasActiveImageFilters({
      smartFilters: {
        version: 1,
        entries: [{ id: "invert", engine: "invert", enabled: true, params: {} }],
      },
    })).toBe(true);
    expect(hasActiveImageFilters({
      screentoneRemoval: { radius: 2, strength: 0.88, inkLumaThreshold: 72 },
    })).toBe(true);
    expect(hasActiveImageFilters({
      jpegArtifactReduction: {
        deblockStrength: 0.72,
        deringStrength: 0.45,
        boundaryThreshold: 6,
        protectedEdgeThreshold: 88,
        ringingThreshold: 18,
        inkLumaThreshold: 64,
      },
    })).toBe(true);
    expect(hasActiveImageFilters({
      edgeAwareDenoise: { radius: 1, strength: 0.78, rangeThreshold: 72 },
    })).toBe(true);
    expect(hasActiveImageFilters({
      lensBlur: {
        radius: 4,
        sampleCount: 21,
        apertureBlades: 6,
        apertureRotationRadians: 0,
      },
    })).toBe(true);
    expect(hasLightweightActiveImageFilters({
      selectiveGaussianBlur: {
        radius: 3,
        spatialSigma: 2,
        edgeThreshold: 20,
        edgeSoftness: 0.35,
      },
    })).toBe(true);
    expect(hasActiveImageFilters({
      tileableBlur: { radius: 5, sigma: 2.2, strength: 0.8 },
    })).toBe(true);
    expect(hasActiveImageFilters({
      dustScratches: { radius: 2, threshold: 24, strength: 0.9 },
    })).toBe(true);
    expect(hasActiveImageFilters({
      differenceOfGaussians: {
        smallSigma: 0.8,
        largeSigma: 2,
        threshold: 1.5,
        strength: 12,
      },
    })).toBe(true);
    expect(hasActiveImageFilters({
      colorToAlpha: { keyColor: "#ffffff", strength: 85 },
    })).toBe(true);
  });

  it("보정 없음 또는 0/false면 false", () => {
    expect(hasActiveImageFilters({})).toBe(false);
    expect(hasActiveImageFilters({ blur: 0, brightness: 0, chromatic: 0, noise: 0 })).toBe(false);
    expect(hasActiveImageFilters({ grayscale: false, sepia: false, invert: false })).toBe(false);
    // 듀오톤은 한쪽만 있으면 비활성.
    expect(hasActiveImageFilters({ duotoneShadow: "#000" })).toBe(false);
  });

  it("가벼운 초기 청크 판정도 strength 0 수묵 객체로 필터 모듈을 불러오지 않는다", () => {
    const none = { strength: 0, spread: 3, edgeBleed: 48, granulation: 38, paper: 46, inkColor: "#20282c", seed: 41 };
    expect(hasLightweightActiveImageFilters({ inkWash: none })).toBe(false);
    expect(hasLightweightActiveImageFilters({ inkWash: { ...none, strength: 1 } })).toBe(true);
    expect(hasLightweightActiveImageFilters({ inkWash: {} as ImageFilterFields["inkWash"] })).toBe(false);
  });

  it("가벼운 초기 청크 판정은 비유한·음수 강도로 필터 엔진을 불필요하게 불러오지 않는다", () => {
    expect(hasLightweightActiveImageFilters({
      blur: Number.NaN,
      brightness: Number.POSITIVE_INFINITY,
      contrast: Number.NEGATIVE_INFINITY,
      chromatic: -3,
      posterize: -1,
      noise: -20,
      pixelate: -4,
      sharpen: -0.5,
      inkThreshold: -1,
      levelsGamma: Number.NaN,
    })).toBe(false);
    expect(hasLightweightActiveImageFilters({ hue: -90 })).toBe(true);
    expect(hasLightweightActiveImageFilters({ brightness: -0.25 })).toBe(true);
  });

  it("가벼운 초기 청크 판정이 새 스마트 필터 ID를 모두 보존한다", () => {
    const engines = [
      "spin-blur",
      "zoom-blur",
      "pixelate",
      "posterize",
      "ink-threshold",
      "line-extraction",
      "screentone-removal",
      "jpeg-artifact-reduction",
      "edge-aware-denoise",
      "lens-blur",
      "field-iris-blur",
      "tilt-shift-blur",
      "selective-gaussian-blur",
      "screentone",
      "color-halftone",
      "chromatic-aberration",
      "grayscale",
      "sepia",
      "edge-detect",
      "emboss",
      "high-pass",
      "median-despeckle",
      "solarize",
      "oil-paint",
      "smart-sharpen",
    ] as const satisfies readonly StudioAdjustmentEngineId[];
    expect(hasLightweightActiveImageFilters({
      smartFilters: {
        version: 1,
        entries: engines.map((engine) => ({
          id: `lightweight-${engine}`,
          engine,
          enabled: true,
          params: studioAdjustmentDefaultParams(engine),
        })),
      },
    })).toBe(true);
  });

  it("첫 24개가 비활성이어도 25번째 활성 스마트 필터를 렌더 계획에 포함한다", () => {
    const disabledPrefix: NonNullable<ImageFilterFields["smartFilterOperations"]> = Array.from(
      { length: 24 },
      (_, index) => ({
        id: `disabled-${index}`,
        engine: "invert" as const,
        enabled: false,
        params: {},
      }),
    );
    const fields: ImageFilterFields = {
      smartFilterOperations: [
        ...disabledPrefix,
        { id: "tail", engine: "blur", enabled: true, params: { radius: 2 } },
      ],
    };

    expect(hasLightweightActiveImageFilters(fields)).toBe(true);
    expect(hasActiveImageFilters(fields)).toBe(true);
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    expect(buildImageFilters(fields, konva).filters).toHaveLength(1);
  });

  it.each([
    [
      "blurFx",
      { blurFx: { type: "gaussian", strength: 0, radius: 8, angle: 0 } },
      { blurFx: { type: "gaussian", strength: 1, radius: 8, angle: 0 } },
    ],
    [
      "clarity",
      { clarity: { clarity: 0, dehaze: 0 } },
      { clarity: { clarity: 0, dehaze: 1 } },
    ],
    [
      "outline",
      { outline: { color: "#ffffff", width: 0, opacity: 100 } },
      { outline: { color: "#ffffff", width: 0, opacity: 100, secondWidth: 1 } },
    ],
    [
      "glow",
      { glow: { strength: 0, size: 12, threshold: 60, color: "auto" } },
      { glow: { strength: 1, size: 12, threshold: 60, color: "auto" } },
    ],
    [
      "autoAdjust",
      { autoAdjust: { mode: "none", strength: 100 } },
      { autoAdjust: { mode: "contrast", strength: 100 } },
    ],
  ] as const)("%s의 경량 항등 판정이 정규화 엔진과 같다", (_name, identity, active) => {
    expect(hasLightweightActiveImageFilters(identity as ImageFilterFields)).toBe(false);
    expect(hasActiveImageFilters(identity as ImageFilterFields)).toBe(false);
    expect(hasLightweightActiveImageFilters(active as ImageFilterFields)).toBe(true);
    expect(hasActiveImageFilters(active as ImageFilterFields)).toBe(true);
  });

  const identityCurve = [{ x: 0, y: 0 }, { x: 128, y: 128 }, { x: 255, y: 255 }];
  const identityLevels = { blackPoint: 0, whitePoint: 255, gamma: 1, outBlack: 0, outWhite: 255 };
  const identityMixer = {
    red: { r: 1, g: 0, b: 0, constant: 0 },
    green: { r: 0, g: 1, b: 0, constant: 0 },
    blue: { r: 0, g: 0, b: 1, constant: 0 },
    monochrome: false,
  };
  const identitySelectiveHsl = {
    red: { hue: 0, sat: 0, lum: 0 },
    orange: { hue: 0, sat: 0, lum: 0 },
    yellow: { hue: 0, sat: 0, lum: 0 },
    green: { hue: 0, sat: 0, lum: 0 },
    aqua: { hue: 0, sat: 0, lum: 0 },
    blue: { hue: 0, sat: 0, lum: 0 },
    purple: { hue: 0, sat: 0, lum: 0 },
    magenta: { hue: 0, sat: 0, lum: 0 },
  };

  it.each([
    ["levelsCh", { levelsCh: { r: identityLevels, g: identityLevels, b: identityLevels } }, { levelsCh: { r: { ...identityLevels, gamma: 1.2 } } }],
    ["curve", { curve: identityCurve }, { curve: [{ x: 0, y: 0 }, { x: 128, y: 155 }, { x: 255, y: 255 }] }],
    ["curveCh", { curveCh: { r: identityCurve, g: identityCurve, b: identityCurve } }, { curveCh: { b: [{ x: 0, y: 20 }, { x: 255, y: 255 }] } }],
    ["colorBalance", { colorBalance: { shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0] } }, { colorBalance: { shadows: [0, 0, 0], midtones: [0, -1, 0], highlights: [0, 0, 0] } }],
    ["channelMixer", { channelMixer: identityMixer }, { channelMixer: { ...identityMixer, monochrome: true } }],
    ["selectiveHsl", { selectiveHsl: identitySelectiveHsl }, { selectiveHsl: { ...identitySelectiveHsl, blue: { hue: 0, sat: 1, lum: 0 } } }],
    ["vibrance", { vibrance: { vibrance: 0, saturation: 0 } }, { vibrance: { vibrance: -1, saturation: 0 } }],
    ["photoFilter", { photoFilter: { color: "#ec8a00", density: 0, preserveLuminosity: true } }, { photoFilter: { color: "#ec8a00", density: 1, preserveLuminosity: true } }],
    ["shadowHighlight", { shadowHighlight: { shadows: 0, shadowsWidth: 50, highlights: 0, highlightsWidth: 50, midtoneContrast: 0 } }, { shadowHighlight: { shadows: 0, shadowsWidth: 50, highlights: 0, highlightsWidth: 50, midtoneContrast: -1 } }],
    ["halftone", { halftone: { dotSize: 4, angle: 15, mode: "cmyk", strength: 0 } }, { halftone: { dotSize: 4, angle: 15, mode: "cmyk", strength: 1 } }],
    ["grain", { grain: { type: "film", amount: 0, size: 1, seed: 1 } }, { grain: { type: "film", amount: 1, size: 1, seed: 1 } }],
    ["distort", { distort: { type: "twirl", amount: 0, scale: 50 } }, { distort: { type: "twirl", amount: -1, scale: 50 } }],
    ["stylize", { stylize: { type: "emboss", strength: 0, detail: 3 } }, { stylize: { type: "emboss", strength: 1, detail: 3 } }],
    ["light", { light: { type: "lensFlare", intensity: 0, x: 30, y: 30, hue: 45 } }, { light: { type: "lensFlare", intensity: 1, x: 30, y: 30, hue: 45 } }],
    ["sketch", { sketch: { type: "photocopy", strength: 0, detail: 3 } }, { sketch: { type: "photocopy", strength: 1, detail: 3 } }],
    ["detail", { detail: { type: "smartSharpen", amount: 0, radius: 2 } }, { detail: { type: "smartSharpen", amount: 1, radius: 2 } }],
  ] as const)("%s reset/default 객체는 Worker 후보가 아니고 활성값은 보존한다", (_name, identity, active) => {
    expect(hasLightweightActiveImageFilters(identity as ImageFilterFields)).toBe(false);
    expect(hasActiveImageFilters(identity as ImageFilterFields)).toBe(false);
    expect(hasLightweightActiveImageFilters(active as ImageFilterFields)).toBe(true);
    expect(hasActiveImageFilters(active as ImageFilterFields)).toBe(true);
  });

  it.each([
    ["gradientMap", { gradientMap: { stops: [{ pos: 0, color: "#000000" }, { pos: 1, color: "#ffffff" }] } }],
    ["lineCleanup", { lineCleanup: { threshold: 0.62, strength: 0.45 } }],
    ["lensBlur", { lensBlur: { radius: 4, sampleCount: 21, apertureBlades: 6, apertureRotationRadians: 0 } }],
    ["fieldIrisBlur", { fieldIrisBlur: { focusCenterX: 0.5, focusCenterY: 0.5, focusRadius: 0.2, feather: 0.2, maximumBlurRadius: 4, sampleCount: 21, apertureBlades: 6 } }],
    ["tiltShiftBlur", { tiltShiftBlur: { axisRadians: 0, focusWidth: 0.2, feather: 0.2, maximumBlurRadius: 4, sampleCount: 21 } }],
    ["selectiveGaussianBlur", { selectiveGaussianBlur: { radius: 3, spatialSigma: 2, edgeThreshold: 20, edgeSoftness: 0.35 } }],
  ] as const)("%s는 설정 존재 자체가 canonical 활성 조건이다", (_name, fields) => {
    expect(hasLightweightActiveImageFilters(fields as ImageFilterFields)).toBe(true);
    expect(hasActiveImageFilters(fields as ImageFilterFields)).toBe(true);
  });

  it("seeded object-field corpus에서 lightweight와 canonical 판정이 일치한다", () => {
    let state = 0x5eeda11;
    const random = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    };
    const signed = (iteration: number) => iteration % 7 === 0 ? 0 : (random() * 300) - 150;

    for (let iteration = 0; iteration < 96; iteration += 1) {
      const amount = signed(iteration);
      const curve = iteration % 5 === 0
        ? identityCurve
        : [{ x: 0, y: 0 }, { x: 128, y: Math.round(random() * 255) }, { x: 255, y: 255 }];
      const cases: Array<[string, ImageFilterFields]> = [
        ["levelsCh", { levelsCh: { r: { ...identityLevels, gamma: iteration % 6 === 0 ? 1 : Math.max(0.1, random() * 10) } } }],
        ["curve", { curve }],
        ["curveCh", { curveCh: { g: curve } }],
        ["colorBalance", { colorBalance: { shadows: [amount, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0] } }],
        ["channelMixer", { channelMixer: { ...identityMixer, red: { ...identityMixer.red, g: amount / 100 } } }],
        ["selectiveHsl", { selectiveHsl: { ...identitySelectiveHsl, red: { hue: amount, sat: 0, lum: 0 } } }],
        ["vibrance", { vibrance: { vibrance: amount, saturation: 0 } }],
        ["photoFilter", { photoFilter: { color: "#ec8a00", density: amount, preserveLuminosity: true } }],
        ["shadowHighlight", { shadowHighlight: { shadows: amount, shadowsWidth: 50, highlights: 0, highlightsWidth: 50, midtoneContrast: 0 } }],
        ["halftone", { halftone: { dotSize: 4, angle: 15, mode: "cmyk", strength: amount } }],
        ["grain", { grain: { type: "film", amount, size: 1, seed: iteration } }],
        ["distort", { distort: { type: "twirl", amount, scale: 50 } }],
        ["stylize", { stylize: { type: "emboss", strength: amount, detail: 3 } }],
        ["light", { light: { type: "lensFlare", intensity: amount, x: 30, y: 30, hue: 45 } }],
        ["sketch", { sketch: { type: "photocopy", strength: amount, detail: 3 } }],
        ["detail", { detail: { type: "smartSharpen", amount, radius: 2 } }],
      ];
      for (const [name, fields] of cases) {
        expect(
          hasLightweightActiveImageFilters(fields),
          `${name} iteration ${iteration}`,
        ).toBe(hasActiveImageFilters(fields));
      }
    }
  });
});

describe("imageFilterCacheKey", () => {
  it("같은 입력은 안정적이고, 필드가 바뀌면 키도 바뀐다", () => {
    const base: ImageFilterFields = { blur: 2, brightness: 0.1 };
    expect(imageFilterCacheKey(base)).toBe(imageFilterCacheKey({ blur: 2, brightness: 0.1 }));
    expect(imageFilterCacheKey(base)).not.toBe(imageFilterCacheKey({ blur: 3, brightness: 0.1 }));
    expect(imageFilterCacheKey(base)).not.toBe(imageFilterCacheKey({ blur: 2, brightness: 0.1, grayscale: true }));
    expect(imageFilterCacheKey(base)).not.toBe(imageFilterCacheKey({
      ...base,
      exposureAdjustment: { exposure: 1, gamma: 1, offset: 0 },
    }));
    expect(imageFilterCacheKey(base)).not.toBe(imageFilterCacheKey({
      ...base,
      screentoneRemoval: { radius: 2, strength: 0.88, inkLumaThreshold: 72 },
    }));
    expect(imageFilterCacheKey(base)).not.toBe(imageFilterCacheKey({
      ...base,
      jpegArtifactReduction: {
        deblockStrength: 0.72,
        deringStrength: 0.45,
        boundaryThreshold: 6,
        protectedEdgeThreshold: 88,
        ringingThreshold: 18,
        inkLumaThreshold: 64,
      },
    }));
    expect(imageFilterCacheKey(base)).not.toBe(imageFilterCacheKey({
      ...base,
      edgeAwareDenoise: { radius: 1, strength: 0.78, rangeThreshold: 72 },
    }));
    expect(imageFilterCacheKey(base)).not.toBe(imageFilterCacheKey({
      ...base,
      lensBlur: {
        radius: 4,
        sampleCount: 21,
        apertureBlades: 6,
        apertureRotationRadians: 0,
      },
    }));
    const firstOrder: ImageFilterFields = {
      smartFilters: {
        version: 1,
        entries: [
          { id: "a", engine: "invert", enabled: true, params: {} },
          { id: "b", engine: "blur", enabled: true, params: { radius: 2 } },
        ],
      },
    };
    const secondOrder: ImageFilterFields = {
      smartFilters: {
        version: 1,
        entries: [...firstOrder.smartFilters!.entries].reverse(),
      },
    };
    expect(imageFilterCacheKey(firstOrder)).not.toBe(imageFilterCacheKey(secondOrder));
  });

  it("빈 객체와 명시적 undefined는 동일한 키", () => {
    expect(imageFilterCacheKey({})).toBe(imageFilterCacheKey({ blur: undefined, hue: undefined }));
  });

  it("25번째 스마트 필터 파라미터가 바뀌면 캐시 키도 바뀐다", () => {
    const disabledPrefix: NonNullable<ImageFilterFields["smartFilterOperations"]> = Array.from(
      { length: 24 },
      (_, index) => ({
        id: `disabled-${index}`,
        engine: "invert" as const,
        enabled: false,
        params: {},
      }),
    );
    const withTailRadius = (radius: number): ImageFilterFields => ({
      smartFilterOperations: [
        ...disabledPrefix,
        { id: "tail", engine: "blur", enabled: true, params: { radius } },
      ],
    });

    expect(imageFilterCacheKey(withTailRadius(1))).not.toBe(imageFilterCacheKey(withTailRadius(2)));
  });

  // 의도적 변경(2026-07-24): grain 객체 전체가 직렬화되므로 새 chroma 필드도
  // 캐시 키에 자동 포함된다 — chroma만 바뀌어도 재계산이 일어난다(stale 캐시 방지).
  it("grain.chroma가 바뀌면 캐시 키도 바뀐다", () => {
    const base: ImageFilterFields = { grain: { type: "film", amount: 30, size: 1, seed: 7 } };
    const withChroma: ImageFilterFields = { grain: { type: "film", amount: 30, size: 1, seed: 7, chroma: 40 } };
    const otherChroma: ImageFilterFields = { grain: { type: "film", amount: 30, size: 1, seed: 7, chroma: 80 } };
    expect(imageFilterCacheKey(base)).not.toBe(imageFilterCacheKey(withChroma));
    expect(imageFilterCacheKey(withChroma)).not.toBe(imageFilterCacheKey(otherChroma));
    expect(imageFilterCacheKey(withChroma)).toBe(
      imageFilterCacheKey({ grain: { type: "film", amount: 30, size: 1, seed: 7, chroma: 40 } }),
    );
  });
});
