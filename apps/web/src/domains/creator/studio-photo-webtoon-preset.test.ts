import { describe, expect, it } from "vitest";

import {
  PHOTO_WEBTOON_PRESETS,
  PHOTO_WEBTOON_TOUCHED_KEYS,
  applyPhotoWebtoonPreset,
  findPhotoWebtoonPreset,
  resetPhotoWebtoonPreset,
  type PhotoWebtoonPreset,
} from "./studio-photo-webtoon-preset";

import type { ImageFilterFields } from "./render/studio-konva-filter-fields";

// ---------------------------------------------------------------------------

describe("PHOTO_WEBTOON_PRESETS 카탈로그", () => {
  it("정확히 3개의 프리셋을 제공한다", () => {
    expect(PHOTO_WEBTOON_PRESETS.length).toBe(3);
  });

  it("모든 프리셋 id가 유일하다", () => {
    const ids = PHOTO_WEBTOON_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("모든 프리셋의 label/tip이 비어있지 않은 문자열이다", () => {
    for (const preset of PHOTO_WEBTOON_PRESETS) {
      expect(typeof preset.label).toBe("string");
      expect(preset.label.trim().length).toBeGreaterThan(0);
      expect(typeof preset.tip).toBe("string");
      expect(preset.tip.trim().length).toBeGreaterThan(0);
    }
  });

  it("모든 프리셋의 swatch가 #rrggbb 형식이다", () => {
    for (const preset of PHOTO_WEBTOON_PRESETS) {
      expect(preset.swatch).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("모든 프리셋 patch가 비어있지 않고, 키가 전부 PHOTO_WEBTOON_TOUCHED_KEYS에 속한다", () => {
    for (const preset of PHOTO_WEBTOON_PRESETS) {
      const keys = Object.keys(preset.patch) as (keyof ImageFilterFields)[];
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(PHOTO_WEBTOON_TOUCHED_KEYS).toContain(key);
      }
    }
  });

  it("PhotoWebtoonPreset 타입 형태를 준수한다(id/label/tip/swatch/patch 존재)", () => {
    for (const preset of PHOTO_WEBTOON_PRESETS) {
      const shaped: PhotoWebtoonPreset = preset;
      expect(shaped).toHaveProperty("id");
      expect(shaped).toHaveProperty("label");
      expect(shaped).toHaveProperty("tip");
      expect(shaped).toHaveProperty("swatch");
      expect(shaped).toHaveProperty("patch");
    }
  });

  it("각 프리셋의 숫자 하위 필드가 소유 엔진의 검증된 범위 안에 있다", () => {
    for (const preset of PHOTO_WEBTOON_PRESETS) {
      const { patch } = preset;
      if (patch.contrast != null) {
        expect(patch.contrast).toBeGreaterThanOrEqual(-80);
        expect(patch.contrast).toBeLessThanOrEqual(80);
      }
      if (patch.posterize != null) {
        expect(patch.posterize).toBeGreaterThanOrEqual(0);
        expect(patch.posterize).toBeLessThanOrEqual(8);
      }
      if (patch.vibrance) {
        expect(patch.vibrance.vibrance).toBeGreaterThanOrEqual(-100);
        expect(patch.vibrance.vibrance).toBeLessThanOrEqual(100);
        expect(patch.vibrance.saturation).toBeGreaterThanOrEqual(-100);
        expect(patch.vibrance.saturation).toBeLessThanOrEqual(100);
      }
      if (patch.clarity) {
        expect(patch.clarity.clarity).toBeGreaterThanOrEqual(-100);
        expect(patch.clarity.clarity).toBeLessThanOrEqual(100);
        expect(patch.clarity.dehaze).toBeGreaterThanOrEqual(0);
        expect(patch.clarity.dehaze).toBeLessThanOrEqual(100);
      }
      if (patch.stylize) {
        expect(patch.stylize.strength).toBeGreaterThanOrEqual(0);
        expect(patch.stylize.strength).toBeLessThanOrEqual(100);
        expect(patch.stylize.detail).toBeGreaterThanOrEqual(1);
        expect(patch.stylize.detail).toBeLessThanOrEqual(10);
      }
      if (patch.halftone) {
        expect(patch.halftone.strength).toBeGreaterThanOrEqual(0);
        expect(patch.halftone.strength).toBeLessThanOrEqual(100);
        expect(patch.halftone.dotSize).toBeGreaterThanOrEqual(2);
        expect(patch.halftone.dotSize).toBeLessThanOrEqual(16);
      }
      if (patch.photoFilter) {
        expect(patch.photoFilter.density).toBeGreaterThanOrEqual(0);
        expect(patch.photoFilter.density).toBeLessThanOrEqual(100);
      }
    }
  });

  it("어떤 프리셋도 halftone과 stylize/sketch를 같은 patch에서 함께 쓰지 않는다(파이프라인 순서 리그레션 가드)", () => {
    for (const preset of PHOTO_WEBTOON_PRESETS) {
      const hasHalftone = preset.patch.halftone != null;
      const hasStylizeOrSketch = preset.patch.stylize != null || preset.patch.sketch != null;
      expect(hasHalftone && hasStylizeOrSketch).toBe(false);
    }
  });
});

describe("findPhotoWebtoonPreset", () => {
  it("유효한 id로 해당 프리셋을 찾는다", () => {
    expect(findPhotoWebtoonPreset("vivid-cartoon")?.id).toBe("vivid-cartoon");
    expect(findPhotoWebtoonPreset("soft-cel-shade")?.id).toBe("soft-cel-shade");
    expect(findPhotoWebtoonPreset("mono-screentone")?.id).toBe("mono-screentone");
  });

  it("알 수 없는 id는 undefined를 반환한다", () => {
    expect(findPhotoWebtoonPreset("no-such-preset")).toBeUndefined();
    expect(findPhotoWebtoonPreset("")).toBeUndefined();
  });
});

describe("PHOTO_WEBTOON_TOUCHED_KEYS", () => {
  it("키가 중복 없이 유일하다", () => {
    expect(new Set(PHOTO_WEBTOON_TOUCHED_KEYS).size).toBe(PHOTO_WEBTOON_TOUCHED_KEYS.length);
  });
});

describe("applyPhotoWebtoonPreset", () => {
  it("빈 객체에 vivid-cartoon을 적용하면 정확히 vivid-cartoon.patch와 일치한다(reset 키는 undefined라 떨어짐)", () => {
    const vivid = findPhotoWebtoonPreset("vivid-cartoon")!;
    const result = applyPhotoWebtoonPreset({}, "vivid-cartoon");
    for (const key of Object.keys(vivid.patch) as (keyof ImageFilterFields)[]) {
      expect(result[key]).toEqual(vivid.patch[key]);
    }
    // touched 키 중 vivid-cartoon.patch에 없는 키는 undefined여야 한다.
    for (const key of PHOTO_WEBTOON_TOUCHED_KEYS) {
      if (!(key in vivid.patch)) {
        expect(result[key]).toBeUndefined();
      }
    }
  });

  it("알 수 없는 presetId는 currentFields를 그대로(값 변경 없이) 반환한다", () => {
    const fields: Partial<ImageFilterFields> = { contrast: 5, grayscale: true };
    const result = applyPhotoWebtoonPreset(fields, "unknown-id");
    expect(result).toEqual(fields);
  });

  it("프리셋 전환 시 이전 프리셋의 잔여값이 남지 않는다", () => {
    const afterVivid = applyPhotoWebtoonPreset({}, "vivid-cartoon");
    expect(afterVivid.vibrance).toBeDefined();
    expect(afterVivid.clarity).toBeDefined();
    expect(afterVivid.stylize).toBeDefined();
    expect(afterVivid.posterize).toBeDefined();

    const afterMono = applyPhotoWebtoonPreset(afterVivid, "mono-screentone");
    // vivid-cartoon이 세팅한 필드는 mono-screentone에 없으므로 지워져야 한다.
    expect(afterMono.vibrance).toBeUndefined();
    expect(afterMono.clarity).toBeUndefined();
    expect(afterMono.stylize).toBeUndefined();
    // posterize는 mono-screentone에도 없으므로 지워져야 한다.
    expect(afterMono.posterize).toBeUndefined();
    // mono-screentone 고유 필드는 남아있다.
    expect(afterMono.grayscale).toBe(true);
    expect(afterMono.halftone).toEqual(findPhotoWebtoonPreset("mono-screentone")!.patch.halftone);
  });

  it("같은 프리셋을 두 번 적용해도 결과가 동일하다(멱등)", () => {
    const once = applyPhotoWebtoonPreset({}, "soft-cel-shade");
    const twice = applyPhotoWebtoonPreset(once, "soft-cel-shade");
    expect(twice).toEqual(once);
  });

  it("PHOTO_WEBTOON_TOUCHED_KEYS 밖의 필드는 그대로 살아남는다", () => {
    const fields: Partial<ImageFilterFields> = {
      glow: { strength: 10, size: 5, threshold: 50, color: "auto" },
      outline: { width: 4, color: "#000000", feather: 0 } as unknown as ImageFilterFields["outline"],
    };
    const result = applyPhotoWebtoonPreset(fields, "vivid-cartoon");
    expect(result.glow).toEqual(fields.glow);
    expect(result.outline).toEqual(fields.outline);
  });
});

describe("resetPhotoWebtoonPreset", () => {
  it("PHOTO_WEBTOON_TOUCHED_KEYS만 지우고 그 외 필드는 유지한다", () => {
    const fields: Partial<ImageFilterFields> = {
      ...applyPhotoWebtoonPreset({}, "vivid-cartoon"),
      brightness: 0.2,
      glow: { strength: 10, size: 5, threshold: 50, color: "auto" },
    };
    const result = resetPhotoWebtoonPreset(fields);
    for (const key of PHOTO_WEBTOON_TOUCHED_KEYS) {
      expect(result[key]).toBeUndefined();
    }
    expect(result.brightness).toBe(0.2);
    expect(result.glow).toEqual(fields.glow);
  });
});
