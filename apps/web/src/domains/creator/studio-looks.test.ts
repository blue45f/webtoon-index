import { describe, expect, it } from "vitest";

import { normalizeInkWash } from "./brush/studio-ink-wash";
import {
  DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS,
  DEFAULT_STUDIO_LENS_BLUR_OPTIONS,
  DEFAULT_STUDIO_SELECTIVE_GAUSSIAN_BLUR_OPTIONS,
  DEFAULT_STUDIO_TILT_SHIFT_BLUR_OPTIONS,
} from "./studio-advanced-blur-filter-kernels";
import { normalizeClarity } from "./studio-clarity";
import { normalizeColorBalance } from "./studio-color-balance";
import { normalizeCurve } from "./studio-curves";
import { normalizeGlow } from "./studio-glow";
import { normalizeGradientMap } from "./studio-gradient-map";
import { normalizeGrain } from "./studio-grain";
import { normalizeHalftone } from "./studio-halftone";
import { normalizeLight } from "./studio-light";
import { normalizeLineArtCleanup } from "./studio-line-cleanup";
import {
  LOOK_FILTER_KEYS,
  STUDIO_LOOKS,
  extractFilterFields,
  looksResetPatch,
  type StudioLook,
  type StudioLookCategory,
} from "./studio-looks";
import { normalizePhotoFilter } from "./studio-photo-filter";
import { normalizeShadowHighlight } from "./studio-shadow-highlight";
import { normalizeSketch } from "./studio-sketch";
import { normalizeStylize } from "./studio-stylize";
import {
  normalizeStudioEdgeAwareDenoiseOptions,
  normalizeStudioJpegArtifactReductionOptions,
  normalizeStudioScreentoneRemovalOptions,
} from "./studio-tone-artifact-filter-kernels";
import { normalizeVibrance } from "./studio-vibrance";

import type { ImageFilterFields } from "./render/studio-konva-filters";

// 유효 카테고리 집합 — 룩 category 검증용.
const VALID_CATEGORIES: StudioLookCategory[] = ["만화", "시네마틱", "빈티지", "감성", "흑백", "실험"];

// 객체 필드명 → 해당 모듈의 normalizeX. 룩 patch의 객체 값이 자기 normalize를 통과(round-trip)하는지
// 확인할 때 쓴다. 여기 없는 키(스칼라/불리언)는 round-trip 검사를 건너뛴다.
const OBJECT_NORMALIZERS: Partial<Record<keyof ImageFilterFields, (v: unknown) => unknown>> = {
  curve: (v) => normalizeCurve(v as never),
  colorBalance: (v) => normalizeColorBalance(v as never),
  photoFilter: (v) => normalizePhotoFilter(v as never),
  vibrance: (v) => normalizeVibrance(v as never),
  gradientMap: (v) => normalizeGradientMap(v as never),
  halftone: (v) => normalizeHalftone(v as never),
  grain: (v) => normalizeGrain(v as never),
  inkWash: (v) => normalizeInkWash(v as never),
  glow: (v) => normalizeGlow(v as never),
  stylize: (v) => normalizeStylize(v as never),
  light: (v) => normalizeLight(v as never),
  sketch: (v) => normalizeSketch(v as never),
  clarity: (v) => normalizeClarity(v as never),
  shadowHighlight: (v) => normalizeShadowHighlight(v as never),
  lineCleanup: (v) => normalizeLineArtCleanup(v as never),
  screentoneRemoval: (v) => normalizeStudioScreentoneRemovalOptions(v),
  jpegArtifactReduction: (v) => normalizeStudioJpegArtifactReductionOptions(v),
  edgeAwareDenoise: (v) => normalizeStudioEdgeAwareDenoiseOptions(v),
};

// ---------------------------------------------------------------------------

describe("STUDIO_LOOKS 카탈로그", () => {
  it("16개 이상의 룩을 제공한다", () => {
    expect(STUDIO_LOOKS.length).toBeGreaterThanOrEqual(16);
  });

  it("모든 룩 id가 유일하다", () => {
    const ids = STUDIO_LOOKS.map((look) => look.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("모든 룩의 label/tip이 비어있지 않은 문자열이다", () => {
    for (const look of STUDIO_LOOKS) {
      expect(typeof look.label).toBe("string");
      expect(look.label.trim().length).toBeGreaterThan(0);
      expect(typeof look.tip).toBe("string");
      expect(look.tip.trim().length).toBeGreaterThan(0);
    }
  });

  it("모든 룩 category가 유효하다", () => {
    for (const look of STUDIO_LOOKS) {
      expect(VALID_CATEGORIES).toContain(look.category);
    }
  });

  it("모든 룩 patch가 비어있지 않고, 키가 전부 LOOK_FILTER_KEYS에 속한다", () => {
    for (const look of STUDIO_LOOKS) {
      const keys = Object.keys(look.patch) as (keyof ImageFilterFields)[];
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(LOOK_FILTER_KEYS).toContain(key);
      }
    }
  });

  it("모든 카테고리가 최소 1개 이상의 룩을 가진다", () => {
    for (const category of VALID_CATEGORIES) {
      const count = STUDIO_LOOKS.filter((look) => look.category === category).length;
      expect(count).toBeGreaterThan(0);
    }
  });

  it("모든 객체 필드 값은 자기 normalizeX를 round-trip한다(value deep-equals normalizeX(value))", () => {
    let checked = 0;
    for (const look of STUDIO_LOOKS) {
      for (const [rawKey, value] of Object.entries(look.patch)) {
        const key = rawKey as keyof ImageFilterFields;
        const normalize = OBJECT_NORMALIZERS[key];
        if (!normalize) continue; // 스칼라/불리언은 직접 세팅이라 검사 제외
        // 객체 값은 절대 undefined가 아니어야 한다(있으면 키 자체가 없어야 함).
        expect(value).not.toBeUndefined();
        // 값이 이미 정규화 결과와 deep-equal이면 무효/범위밖 값이 없다는 뜻.
        expect(value).toEqual(normalize(value));
        checked++;
      }
    }
    // 최소한 몇 개의 객체 필드는 실제로 검증되어야 한다(테스트가 공회전하지 않도록).
    expect(checked).toBeGreaterThan(0);
  });

  it("StudioLook 타입 형태를 준수한다(id/label/tip/category/patch 존재)", () => {
    for (const look of STUDIO_LOOKS) {
      const shaped: StudioLook = look;
      expect(shaped).toHaveProperty("id");
      expect(shaped).toHaveProperty("label");
      expect(shaped).toHaveProperty("tip");
      expect(shaped).toHaveProperty("category");
      expect(shaped).toHaveProperty("patch");
    }
  });
});

describe("웹툰 컷 룩 (VRM 캡처용)", () => {
  it("웹툰 셀(webtoon-cel)은 만화 카테고리의 컬러 보존 셀 룩이다", () => {
    const look = STUDIO_LOOKS.find((l) => l.id === "webtoon-cel");
    expect(look).toBeDefined();
    expect(look!.category).toBe("만화");
    // 컬러 셀 룩이므로 흑백/세피아/반전으로 색을 죽이면 안 된다.
    expect(look!.patch.grayscale).toBeUndefined();
    expect(look!.patch.sepia).toBeUndefined();
    expect(look!.patch.invert).toBeUndefined();
    // 셀 밴딩의 핵심인 posterize를 활성값(>0)으로 쓴다.
    expect(typeof look!.patch.posterize).toBe("number");
    expect(look!.patch.posterize!).toBeGreaterThan(0);
  });

  it("클린 라인아트(clean-lineart)는 lineart로 윤곽선만 남긴다", () => {
    const look = STUDIO_LOOKS.find((l) => l.id === "clean-lineart");
    expect(look).toBeDefined();
    expect(look!.category).toBe("만화");
    expect(look!.patch.lineart).toBe(true);
  });
});

describe("LOOK_FILTER_KEYS", () => {
  it("키가 중복 없이 유일하다", () => {
    expect(new Set(LOOK_FILTER_KEYS).size).toBe(LOOK_FILTER_KEYS.length);
  });

  it("ImageFilterFields의 알려진 키를 모두 포함한다(스냅샷 가드)", () => {
    // ImageFilterFields의 전체 키 — 모듈이 키를 추가/제거하면 이 목록과 함께 갱신해야 한다.
    const expected: (keyof ImageFilterFields)[] = [
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
      "levelsBlack",
      "levelsWhite",
      "levelsGamma",
      "levelsOutBlack",
      "levelsOutWhite",
      "levelsCh",
      "curve",
      "curveCh",
      "colorBalance",
      "channelMixer",
      "selectiveHsl",
      "vibrance",
      "gradientMap",
      "photoFilter",
      "autoAdjust",
      "clarity",
      "shadowHighlight",
      "outline",
      "glow",
      "halftone",
      "grain",
      "inkWash",
      "blurFx",
      "lensBlur",
      "fieldIrisBlur",
      "tiltShiftBlur",
      "selectiveGaussianBlur",
      "distort",
      "stylize",
      "light",
      "sketch",
      "detail",
      "lineCleanup",
      "screentoneRemoval",
      "jpegArtifactReduction",
      "edgeAwareDenoise",
      "colorToAlpha",
      "differenceOfGaussians",
      "dustScratches",
      "tileableBlur",
    ];
    // 순서 무관하게 같은 키 집합인지.
    expect(new Set(LOOK_FILTER_KEYS)).toEqual(new Set(expected));
    expect(LOOK_FILTER_KEYS.length).toBe(expected.length);
  });
});

describe("looksResetPatch", () => {
  it("모든 LOOK_FILTER_KEYS 키가 undefined로 채워져 있다", () => {
    const reset = looksResetPatch();
    for (const key of LOOK_FILTER_KEYS) {
      // 키 자체는 존재하되 값은 undefined여야 한다(요소 객체에서 필드를 지우는 패치).
      expect(Object.prototype.hasOwnProperty.call(reset, key)).toBe(true);
      expect(reset[key]).toBeUndefined();
    }
  });

  it("LOOK_FILTER_KEYS 외의 키는 만들지 않는다", () => {
    const reset = looksResetPatch();
    const keys = Object.keys(reset) as (keyof ImageFilterFields)[];
    expect(keys.length).toBe(LOOK_FILTER_KEYS.length);
    for (const key of keys) {
      expect(LOOK_FILTER_KEYS).toContain(key);
    }
  });

  it("호출마다 새 객체를 반환한다(공유 변형 방지)", () => {
    expect(looksResetPatch()).not.toBe(looksResetPatch());
  });
});

describe("extractFilterFields", () => {
  it("설정된 키는 유지하고 undefined 키는 버린다", () => {
    const el: Partial<ImageFilterFields> = {
      grayscale: true,
      contrast: 20,
      saturation: undefined, // 버려져야 함
      grain: normalizeGrain({ type: "film", amount: 30, size: 2, seed: 7 }),
    };
    const out = extractFilterFields(el);
    expect(out).toEqual({
      grayscale: true,
      contrast: 20,
      grain: normalizeGrain({ type: "film", amount: 30, size: 2, seed: 7 }),
    });
    expect(Object.prototype.hasOwnProperty.call(out, "saturation")).toBe(false);
  });

  it("false/0 같은 falsy지만 설정된 값은 유지한다", () => {
    const el: Partial<ImageFilterFields> = { grayscale: false, contrast: 0, brightness: 0 };
    const out = extractFilterFields(el);
    expect(out).toEqual({ grayscale: false, contrast: 0, brightness: 0 });
  });

  it("고급 블러 옵션 네 종류를 필터 복사와 전체 리셋 대상에 포함한다", () => {
    const advancedBlurFields: Partial<ImageFilterFields> = {
      lensBlur: { ...DEFAULT_STUDIO_LENS_BLUR_OPTIONS },
      fieldIrisBlur: { ...DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS },
      tiltShiftBlur: { ...DEFAULT_STUDIO_TILT_SHIFT_BLUR_OPTIONS },
      selectiveGaussianBlur: { ...DEFAULT_STUDIO_SELECTIVE_GAUSSIAN_BLUR_OPTIONS },
    };

    expect(extractFilterFields(advancedBlurFields)).toEqual(advancedBlurFields);
    expect(looksResetPatch()).toMatchObject({
      lensBlur: undefined,
      fieldIrisBlur: undefined,
      tiltShiftBlur: undefined,
      selectiveGaussianBlur: undefined,
    });
  });

  it("입력을 변형하지 않고 새 객체를 반환한다(순수)", () => {
    const el: Partial<ImageFilterFields> = { contrast: 10 };
    const out = extractFilterFields(el);
    expect(out).not.toBe(el);
    out.contrast = 999;
    expect(el.contrast).toBe(10); // 원본 불변
  });

  it("LOOK_FILTER_KEYS에 없는 임의 키는 무시한다", () => {
    const el = { contrast: 5, bogusField: 123 } as unknown as Partial<ImageFilterFields>;
    const out = extractFilterFields(el);
    expect(out).toEqual({ contrast: 5 });
    expect(Object.prototype.hasOwnProperty.call(out, "bogusField")).toBe(false);
  });

  it("빈 입력은 빈 객체를 반환한다", () => {
    expect(extractFilterFields({})).toEqual({});
  });

  it("룩 적용 시뮬레이션 — reset 위에 patch를 얹으면 추출 결과가 룩 patch와 일치한다", () => {
    const look = STUDIO_LOOKS.find((l) => l.id === "classic-manga")!;
    const applied: Partial<ImageFilterFields> = { ...looksResetPatch(), ...look.patch };
    // reset이 깐 undefined 키들은 extract에서 전부 떨어지고, patch가 세팅한 값만 남는다.
    expect(extractFilterFields(applied)).toEqual(look.patch);
  });
});
