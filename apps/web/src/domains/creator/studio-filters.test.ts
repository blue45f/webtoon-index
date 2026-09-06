import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_GRADE,
  IMAGE_ADJUSTMENT_RANGES,
  IMAGE_FILTER_PRESETS,
  PAGE_GRADE_PRESETS,
  PAGE_GRADE_RANGES,
  STUDIO_PIXEL_FILTERS,
  applyDuotone,
  applyInkThreshold,
  applySharpen,
  applyTemperature,
  drawVignette,
  hexToRgb,
  imageFilterResetPatch,
  isDefaultPageGrade,
  normalizePageGrade,
  pageGradeToCssFilter,
  vignetteCss,
  withStudioFilterScratchBuffer,
  type ImageFilterPatch,
  type PageGrade,
  type StudioImageDataLike,
  type VignetteCtx,
} from "./studio-filters";

// ---- 테스트용 가짜 ImageData 빌더 ----

/** [r,g,b,a] 픽셀 배열로 StudioImageDataLike 생성. */
function makeImage(width: number, height: number, pixels: number[][]): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((px, i) => data.set(px, i * 4));
  return { data, width, height };
}

/** 균일 회색(r=g=b) 이미지 — 휘도 계산이 단순해진다. */
function makeGray(width: number, height: number, grays: number[], alpha = 255): StudioImageDataLike {
  return makeImage(
    width,
    height,
    grays.map((g) => [g, g, g, alpha])
  );
}

function pixelAt(img: StudioImageDataLike, index: number): number[] {
  return Array.from(img.data.slice(index * 4, index * 4 + 4));
}

describe("filter scratch working set", () => {
  it("reuses sequential exact-size leases without aliasing nested filter execution", () => {
    let first: Uint8ClampedArray | null = null;
    withStudioFilterScratchBuffer(64, (outer) => {
      first = outer;
      outer.fill(17);
      withStudioFilterScratchBuffer(64, (nested) => {
        expect(nested).not.toBe(outer);
        nested.fill(99);
      });
      expect(Array.from(outer)).toEqual(Array.from({ length: 64 }, () => 17));
    });
    withStudioFilterScratchBuffer(64, (next) => {
      expect(next).toBe(first);
    });
  });

  it("rejects malformed byte lengths before allocating", () => {
    expect(() => withStudioFilterScratchBuffer(Number.NaN, () => undefined)).toThrow(RangeError);
    expect(() => withStudioFilterScratchBuffer(-1, () => undefined)).toThrow(RangeError);
  });
});

describe("hexToRgb", () => {
  it("parses #rgb shorthand by doubling digits", () => {
    expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#abc")).toEqual({ r: 170, g: 187, b: 204 });
  });

  it("parses #rrggbb including uppercase", () => {
    expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#FF8800")).toEqual({ r: 255, g: 136, b: 0 });
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("falls back to black for invalid input", () => {
    expect(hexToRgb("")).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb("red")).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb("#ggg")).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb("#12345")).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb("123456")).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe("applyTemperature (색온도)", () => {
  it("warm: shifts r up and b down by 0.6*amount, keeping g and alpha", () => {
    const img = makeImage(2, 1, [
      [100, 100, 100, 200],
      [250, 100, 10, 128],
    ]);
    applyTemperature(img, 50); // shift = 30
    expect(pixelAt(img, 0)).toEqual([130, 100, 70, 200]);
    // 클램프: 250+30 → 255, 10-30 → 0
    expect(pixelAt(img, 1)).toEqual([255, 100, 0, 128]);
  });

  it("cool: negative amount shifts r down and b up", () => {
    const img = makeImage(1, 1, [[100, 100, 100, 255]]);
    applyTemperature(img, -50);
    expect(pixelAt(img, 0)).toEqual([70, 100, 130, 255]);
  });

  it("is a no-op for amount 0 or non-finite", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    applyTemperature(img, 0);
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
    applyTemperature(img, Number.NaN);
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });
});

describe("applySharpen (언샤프 마스크)", () => {
  // 3x3 회색 이미지: 중앙만 다른 값.
  const grid = (center: number, around: number): StudioImageDataLike =>
    makeGray(3, 3, [around, around, around, around, center, around, around, around, around], 77);

  it("pushes a bright center brighter: c(1+4a) - a*(상하좌우 합)", () => {
    const img = grid(120, 100);
    applySharpen(img, 0.5);
    // 120*3 - 0.5*400 = 160
    expect(pixelAt(img, 4).slice(0, 3)).toEqual([160, 160, 160]);
  });

  it("pushes a dark center darker and clamps at 0", () => {
    const softened = grid(80, 100);
    applySharpen(softened, 0.5); // 80*3 - 200 = 40
    expect(pixelAt(softened, 4).slice(0, 3)).toEqual([40, 40, 40]);

    const extreme = grid(0, 255);
    applySharpen(extreme, 1); // 0 - 4*255 → 클램프 0
    expect(pixelAt(extreme, 4).slice(0, 3)).toEqual([0, 0, 0]);
  });

  it("keeps edge pixels and alpha untouched", () => {
    const img = grid(200, 100);
    applySharpen(img, 0.8);
    for (const edge of [0, 1, 2, 3, 5, 6, 7, 8]) {
      expect(pixelAt(img, edge)).toEqual([100, 100, 100, 77]);
    }
    expect(pixelAt(img, 4)[3]).toBe(77);
  });

  it("is a no-op for amount 0 and for images smaller than 3x3", () => {
    const img = grid(120, 100);
    applySharpen(img, 0);
    expect(pixelAt(img, 4).slice(0, 3)).toEqual([120, 120, 120]);

    const tiny = makeGray(2, 1, [120, 100]);
    applySharpen(tiny, 1);
    expect(pixelAt(tiny, 0).slice(0, 3)).toEqual([120, 120, 120]);
  });
});

describe("applyInkThreshold (먹선 잉크)", () => {
  it("maps luminance below level*255 to pure black, others to pure white", () => {
    const img = makeImage(4, 1, [
      [100, 100, 100, 200], // 휘도 100 < 127.5 → 흑
      [200, 200, 200, 64], // 휘도 200 → 백
      [255, 0, 0, 255], // 휘도 76.245 → 흑
      [0, 255, 0, 255], // 휘도 149.685 → 백
    ]);
    applyInkThreshold(img, 0.5);
    expect(pixelAt(img, 0)).toEqual([0, 0, 0, 200]);
    expect(pixelAt(img, 1)).toEqual([255, 255, 255, 64]);
    expect(pixelAt(img, 2)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(img, 3)).toEqual([255, 255, 255, 255]);
  });

  it("is a no-op for level 0", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    applyInkThreshold(img, 0);
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("level 1 turns everything below pure white luminance to black", () => {
    const img = makeImage(2, 1, [
      [254, 254, 254, 255],
      [255, 255, 255, 255],
    ]);
    applyInkThreshold(img, 1);
    expect(pixelAt(img, 0).slice(0, 3)).toEqual([0, 0, 0]);
    expect(pixelAt(img, 1).slice(0, 3)).toEqual([255, 255, 255]);
  });
});

describe("applyDuotone (그라디언트 맵)", () => {
  it("maps pure black to the shadow color and pure white to the highlight color", () => {
    const img = makeImage(2, 1, [
      [0, 0, 0, 90],
      [255, 255, 255, 180],
    ]);
    applyDuotone(img, "#102030", "#ffeedd");
    expect(pixelAt(img, 0)).toEqual([16, 32, 48, 90]);
    expect(pixelAt(img, 1)).toEqual([255, 238, 221, 180]);
  });

  it("lerps mid luminance between the two colors", () => {
    // 회색 102 → t = 0.4 정확히. 흑→백 듀오톤이면 102 그대로.
    const neutral = makeGray(1, 1, [102]);
    applyDuotone(neutral, "#000000", "#ffffff");
    expect(pixelAt(neutral, 0).slice(0, 3)).toEqual([102, 102, 102]);

    // shadow 0, highlight 200 → 0 + 200*0.4 = 80 (±1: 클램프 배열 반올림 허용)
    const tinted = makeGray(1, 1, [102]);
    applyDuotone(tinted, "#000000", "#c8c8c8");
    for (const channel of pixelAt(tinted, 0).slice(0, 3)) {
      expect(Math.abs(channel - 80)).toBeLessThanOrEqual(1);
    }
  });

  it("treats invalid hex as black (hexToRgb fallback)", () => {
    const img = makeGray(1, 1, [255]);
    applyDuotone(img, "oops", "nope"); // 둘 다 검정 → 결과도 검정
    expect(pixelAt(img, 0).slice(0, 3)).toEqual([0, 0, 0]);
  });
});

describe("STUDIO_PIXEL_FILTERS (Konva 레지스트리)", () => {
  const KEYS = ["Temperature", "Sharpen", "InkThreshold", "Duotone"];

  it("exposes exactly the four expected filter keys", () => {
    expect(Object.keys(STUDIO_PIXEL_FILTERS).sort()).toEqual([...KEYS].sort());
  });

  it("does nothing (and never throws) when attrs are missing or wrong-typed", () => {
    for (const key of KEYS) {
      const img = makeImage(3, 3, Array.from({ length: 9 }, () => [10, 20, 30, 40]));
      const before = Array.from(img.data);
      expect(() => STUDIO_PIXEL_FILTERS[key]!(img, {})).not.toThrow();
      expect(() =>
        STUDIO_PIXEL_FILTERS[key]!(img, {
          temperature: "hot",
          sharpen: null,
          inkThreshold: Number.NaN,
          duotoneShadow: 3,
          duotoneHighlight: "#fff",
        })
      ).not.toThrow();
      expect(Array.from(img.data)).toEqual(before);
    }
  });

  it("Duotone 레지스트리는 잘못된 hex 문자열을 픽셀 손상 없이 무시한다", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    const before = Array.from(img.data);
    STUDIO_PIXEL_FILTERS.Duotone!(img, {
      duotoneShadow: "not-a-color",
      duotoneHighlight: "#ffffff",
    });
    expect(Array.from(img.data)).toEqual(before);
  });

  it("applies Temperature from attrs.temperature and clamps out-of-range values", () => {
    const viaAttrs = makeGray(1, 1, [100]);
    STUDIO_PIXEL_FILTERS.Temperature!(viaAttrs, { temperature: 50 });
    expect(pixelAt(viaAttrs, 0).slice(0, 3)).toEqual([130, 100, 70]);

    const clamped = makeGray(1, 1, [100]);
    const max = makeGray(1, 1, [100]);
    STUDIO_PIXEL_FILTERS.Temperature!(clamped, { temperature: 9999 });
    STUDIO_PIXEL_FILTERS.Temperature!(max, { temperature: 100 });
    expect(Array.from(clamped.data)).toEqual(Array.from(max.data));
  });

  it("applies Sharpen and InkThreshold from their attrs", () => {
    const sharp = makeGray(3, 3, [100, 100, 100, 100, 120, 100, 100, 100, 100]);
    STUDIO_PIXEL_FILTERS.Sharpen!(sharp, { sharpen: 0.5 });
    expect(pixelAt(sharp, 4).slice(0, 3)).toEqual([160, 160, 160]);

    const ink = makeGray(2, 1, [100, 200]);
    STUDIO_PIXEL_FILTERS.InkThreshold!(ink, { inkThreshold: 0.5 });
    expect(pixelAt(ink, 0).slice(0, 3)).toEqual([0, 0, 0]);
    expect(pixelAt(ink, 1).slice(0, 3)).toEqual([255, 255, 255]);
  });

  it("applies Duotone only when both colors are strings", () => {
    const both = makeGray(1, 1, [0]);
    STUDIO_PIXEL_FILTERS.Duotone!(both, { duotoneShadow: "#102030", duotoneHighlight: "#ffffff" });
    expect(pixelAt(both, 0).slice(0, 3)).toEqual([16, 32, 48]);

    const onlyOne = makeGray(1, 1, [0]);
    STUDIO_PIXEL_FILTERS.Duotone!(onlyOne, { duotoneShadow: "#102030" });
    expect(pixelAt(onlyOne, 0).slice(0, 3)).toEqual([0, 0, 0]);
  });
});

describe("imageFilterResetPatch", () => {
  const ALL_PATCH_KEYS = [
    "blur",
    "brightness",
    "contrast",
    "grayscale",
    "sepia",
    "screentone",
    "lineart",
    "chromatic",
    "posterize",
    "noise",
    "saturation",
    "hue",
    "temperature",
    "sharpen",
    "pixelate",
    "invert",
    "inkThreshold",
    "duotoneShadow",
    "duotoneHighlight",
  ];

  it("explicitly lists every patch key with an undefined value", () => {
    const patch = imageFilterResetPatch();
    expect(Object.keys(patch).sort()).toEqual([...ALL_PATCH_KEYS].sort());
    for (const value of Object.values(patch)) expect(value).toBeUndefined();
  });

  it("returns a fresh object each call", () => {
    expect(imageFilterResetPatch()).not.toBe(imageFilterResetPatch());
  });
});

describe("IMAGE_FILTER_PRESETS", () => {
  const RESET_KEYS = new Set(Object.keys(imageFilterResetPatch()));
  const NUMERIC_RANGES: Record<string, { min: number; max: number }> = {
    blur: { min: 0, max: 30 },
    brightness: { min: -0.8, max: 0.8 },
    contrast: { min: -80, max: 80 },
    chromatic: { min: 0, max: 12 },
    posterize: { min: 0, max: 8 },
    noise: { min: 0, max: 100 },
    saturation: IMAGE_ADJUSTMENT_RANGES.saturation,
    hue: IMAGE_ADJUSTMENT_RANGES.hue,
    temperature: IMAGE_ADJUSTMENT_RANGES.temperature,
    sharpen: IMAGE_ADJUSTMENT_RANGES.sharpen,
    pixelate: IMAGE_ADJUSTMENT_RANGES.pixelate,
    inkThreshold: IMAGE_ADJUSTMENT_RANGES.inkThreshold,
  };
  const BOOLEAN_KEYS = new Set(["grayscale", "sepia", "screentone", "lineart", "invert"]);
  const COLOR_KEYS = new Set(["duotoneShadow", "duotoneHighlight"]);

  it("has unique ids and the reset preset first", () => {
    const ids = IMAGE_FILTER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(IMAGE_FILTER_PRESETS[0]!.id).toBe("original");
    expect(IMAGE_FILTER_PRESETS[0]!.label).toBe("원본");
    expect(IMAGE_FILTER_PRESETS[0]!.patch).toEqual(imageFilterResetPatch());
    expect(IMAGE_FILTER_PRESETS.length).toBeGreaterThanOrEqual(12);
  });

  it("has non-empty labels and tips", () => {
    for (const preset of IMAGE_FILTER_PRESETS) {
      expect(preset.label.trim().length).toBeGreaterThan(0);
      expect(preset.tip.trim().length).toBeGreaterThan(0);
    }
  });

  it("only uses known patch keys with in-range, well-typed values", () => {
    for (const preset of IMAGE_FILTER_PRESETS.slice(1)) {
      const entries = Object.entries(preset.patch) as [keyof ImageFilterPatch, unknown][];
      expect(entries.length).toBeGreaterThan(0);
      for (const [key, value] of entries) {
        expect(RESET_KEYS.has(key)).toBe(true);
        if (value === undefined) continue;
        if (BOOLEAN_KEYS.has(key)) {
          expect(typeof value).toBe("boolean");
        } else if (COLOR_KEYS.has(key)) {
          expect(typeof value).toBe("string");
          // 듀오톤 색은 유효 헥스(검정 폴백이 아닌 의도된 색)여야 한다.
          expect(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value as string)).toBe(true);
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
});

describe("normalizePageGrade", () => {
  it("returns defaults for undefined/null and a fresh object", () => {
    expect(normalizePageGrade()).toEqual(DEFAULT_PAGE_GRADE);
    expect(normalizePageGrade(null)).toEqual(DEFAULT_PAGE_GRADE);
    expect(normalizePageGrade()).not.toBe(DEFAULT_PAGE_GRADE);
  });

  it("fills missing keys with defaults and keeps valid values", () => {
    const grade = normalizePageGrade({ brightness: 1.5, vignette: 0.3 });
    expect(grade).toEqual({ ...DEFAULT_PAGE_GRADE, brightness: 1.5, vignette: 0.3 });
  });

  it("clamps out-of-range numbers to PAGE_GRADE_RANGES", () => {
    const grade = normalizePageGrade({ brightness: 99, hue: -999, sepia: -1, saturation: 7 });
    expect(grade.brightness).toBe(PAGE_GRADE_RANGES.brightness.max);
    expect(grade.hue).toBe(PAGE_GRADE_RANGES.hue.min);
    expect(grade.sepia).toBe(0);
    expect(grade.saturation).toBe(PAGE_GRADE_RANGES.saturation.max);
  });

  it("replaces non-numeric or non-finite values with defaults", () => {
    const dirty = {
      brightness: "bright",
      contrast: Number.NaN,
      hue: Number.POSITIVE_INFINITY,
    } as unknown as Partial<PageGrade>;
    expect(normalizePageGrade(dirty)).toEqual(DEFAULT_PAGE_GRADE);
  });
});

describe("isDefaultPageGrade / pageGradeToCssFilter", () => {
  it("detects the default grade", () => {
    expect(isDefaultPageGrade(DEFAULT_PAGE_GRADE)).toBe(true);
    expect(isDefaultPageGrade(normalizePageGrade())).toBe(true);
    expect(isDefaultPageGrade({ ...DEFAULT_PAGE_GRADE, vignette: 0.1 })).toBe(false);
  });

  it("returns an empty string for an all-default grade", () => {
    expect(pageGradeToCssFilter(DEFAULT_PAGE_GRADE)).toBe("");
  });

  it("omits default entries and keeps the fixed order", () => {
    const grade: PageGrade = { ...DEFAULT_PAGE_GRADE, brightness: 1.1, saturation: 0.8, hue: -15 };
    expect(pageGradeToCssFilter(grade)).toBe("brightness(1.1) saturate(0.8) hue-rotate(-15deg)");

    const full: PageGrade = {
      brightness: 0.8,
      contrast: 1.2,
      saturation: 1.5,
      hue: 30,
      sepia: 0.4,
      grayscale: 0.2,
      vignette: 0.5, // CSS filter에는 포함되지 않는다
    };
    expect(pageGradeToCssFilter(full)).toBe(
      "brightness(0.8) contrast(1.2) saturate(1.5) hue-rotate(30deg) sepia(0.4) grayscale(0.2)"
    );
  });

  it("rounds to two decimals and strips trailing zeros", () => {
    const fp: PageGrade = { ...DEFAULT_PAGE_GRADE, saturation: 0.1 + 0.2 }; // 0.30000000000000004
    expect(pageGradeToCssFilter(fp)).toBe("saturate(0.3)");
    const third: PageGrade = { ...DEFAULT_PAGE_GRADE, contrast: 4 / 3 };
    expect(pageGradeToCssFilter(third)).toBe("contrast(1.33)");
  });
});

describe("vignetteCss / drawVignette", () => {
  it('returns "none" for zero or invalid strength', () => {
    expect(vignetteCss(0)).toBe("none");
    expect(vignetteCss(-1)).toBe("none");
    expect(vignetteCss(Number.NaN)).toBe("none");
  });

  it("produces a radial-gradient that darkens with strength", () => {
    expect(vignetteCss(1)).toBe("radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.7) 100%)");
    const soft = vignetteCss(0.2);
    expect(soft.startsWith("radial-gradient(ellipse at center")).toBe(true);
    const alphaOf = (css: string) => Number(/rgba\(0,0,0,([\d.]+)\) 100%/.exec(css)![1]);
    expect(alphaOf(vignetteCss(0.9))).toBeGreaterThan(alphaOf(soft));
  });

  // CanvasRenderingContext2D 호출 기록 스텁 — DOM 없이 합성 로직 검증.
  function makeStubCtx() {
    const stops: { offset: number; color: string }[] = [];
    const fills: number[][] = [];
    const gradient = { addColorStop: (offset: number, color: string) => void stops.push({ offset, color }) };
    const ctx: VignetteCtx = {
      createRadialGradient: () => gradient,
      fillStyle: null,
      fillRect: (...args: number[]) => void fills.push(args),
    };
    return { ctx, stops, fills, gradient };
  }

  it("does nothing for strength <= 0", () => {
    const { ctx, stops, fills } = makeStubCtx();
    drawVignette(ctx, 800, 600, 0);
    drawVignette(ctx, 800, 600, -0.5);
    expect(stops).toHaveLength(0);
    expect(fills).toHaveLength(0);
    expect(ctx.fillStyle).toBeNull();
  });

  it("fills the full canvas with a center-transparent gradient", () => {
    const { ctx, stops, fills, gradient } = makeStubCtx();
    drawVignette(ctx, 800, 600, 1);
    expect(fills).toEqual([[0, 0, 800, 600]]);
    expect(ctx.fillStyle).toBe(gradient);
    expect(stops[0]).toEqual({ offset: 0, color: "rgba(0,0,0,0)" });
    expect(stops[stops.length - 1]).toEqual({ offset: 1, color: "rgba(0,0,0,0.7)" });
    // 미리보기(vignetteCss)와 동일 톤: 시작점 45%, 최대 어둡기 0.7.
    expect(stops.some((s) => s.offset === 0.45 && s.color === "rgba(0,0,0,0)")).toBe(true);
  });
});

describe("PAGE_GRADE_PRESETS", () => {
  it("has unique ids and the neutral preset first", () => {
    const ids = PAGE_GRADE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PAGE_GRADE_PRESETS[0]!.id).toBe("neutral");
    expect(PAGE_GRADE_PRESETS[0]!.label).toBe("기본");
    expect(PAGE_GRADE_PRESETS[0]!.grade).toEqual(DEFAULT_PAGE_GRADE);
    expect(PAGE_GRADE_PRESETS.length).toBeGreaterThanOrEqual(8);
  });

  it("keeps every grade inside PAGE_GRADE_RANGES (normalize is identity)", () => {
    for (const preset of PAGE_GRADE_PRESETS) {
      expect(preset.label.trim().length).toBeGreaterThan(0);
      expect(preset.tip.trim().length).toBeGreaterThan(0);
      expect(normalizePageGrade(preset.grade)).toEqual(preset.grade);
    }
  });
});
