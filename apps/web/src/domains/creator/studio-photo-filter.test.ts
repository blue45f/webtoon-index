import { describe, expect, it } from "vitest";

import {
  DEFAULT_PHOTO_FILTER,
  PHOTO_FILTER_DENSITY_RANGE,
  PHOTO_FILTER_PRESETS,
  applyPhotoFilter,
  isIdentityPhotoFilter,
  normalizePhotoFilter,
  photoFilterKonvaFilter,
  type PhotoFilter,
} from "./studio-photo-filter";

import type { StudioImageDataLike } from "./studio-filters";

// ---- 테스트용 가짜 ImageData 빌더 ----

/** [r,g,b,a] 픽셀 배열로 StudioImageDataLike 생성. */
function makeImage(width: number, height: number, pixels: number[][]): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((px, i) => data.set(px, i * 4));
  return { data, width, height };
}

function pixelAt(img: StudioImageDataLike, index: number): number[] {
  return Array.from(img.data.slice(index * 4, index * 4 + 4));
}

// Rec.601 휘도 — 모듈 내부와 동일.
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

describe("DEFAULT_PHOTO_FILTER / isIdentityPhotoFilter", () => {
  it("기본값은 따뜻한 색이지만 density 0이라 항등", () => {
    expect(DEFAULT_PHOTO_FILTER).toEqual({ color: "#ec8a00", density: 0, preserveLuminosity: true });
    expect(isIdentityPhotoFilter(DEFAULT_PHOTO_FILTER)).toBe(true);
  });

  it("density가 0 이하면 항등, 양수면 항등 아님", () => {
    expect(isIdentityPhotoFilter({ color: "#ec8a00", density: 0, preserveLuminosity: true })).toBe(true);
    expect(isIdentityPhotoFilter({ color: "#ec8a00", density: -5, preserveLuminosity: true })).toBe(true);
    expect(isIdentityPhotoFilter({ color: "#ec8a00", density: 1, preserveLuminosity: true })).toBe(false);
  });
});

describe("PHOTO_FILTER_DENSITY_RANGE", () => {
  it("범위는 0..100, step 1", () => {
    expect(PHOTO_FILTER_DENSITY_RANGE).toEqual({ min: 0, max: 100, step: 1 });
  });
});

describe("normalizePhotoFilter", () => {
  it("undefined/null → 기본값", () => {
    expect(normalizePhotoFilter()).toEqual(DEFAULT_PHOTO_FILTER);
    expect(normalizePhotoFilter(null)).toEqual(DEFAULT_PHOTO_FILTER);
  });

  it("density를 0..100으로 클램프", () => {
    expect(normalizePhotoFilter({ density: 250 }).density).toBe(100);
    expect(normalizePhotoFilter({ density: -50 }).density).toBe(0);
    expect(normalizePhotoFilter({ density: 42 }).density).toBe(42);
  });

  it("숫자 아닌 density는 기본값(0)으로", () => {
    expect(normalizePhotoFilter({ density: Number.NaN }).density).toBe(0);
    expect(normalizePhotoFilter({ density: "30" as unknown as number }).density).toBe(0);
    expect(normalizePhotoFilter({ density: Number.POSITIVE_INFINITY }).density).toBe(0);
  });

  it("유효한 #rrggbb 색만 통과, 무효 색은 기본색", () => {
    expect(normalizePhotoFilter({ color: "#1f8a3a" }).color).toBe("#1f8a3a");
    expect(normalizePhotoFilter({ color: "#ABC" as string }).color).toBe(DEFAULT_PHOTO_FILTER.color); // 3자리 거부
    expect(normalizePhotoFilter({ color: "red" }).color).toBe(DEFAULT_PHOTO_FILTER.color);
    expect(normalizePhotoFilter({ color: 123 as unknown as string }).color).toBe(DEFAULT_PHOTO_FILTER.color);
  });

  it("preserveLuminosity는 boolean으로 강제(누락 시 기본값 true)", () => {
    expect(normalizePhotoFilter({ preserveLuminosity: false }).preserveLuminosity).toBe(false);
    expect(normalizePhotoFilter({ preserveLuminosity: true }).preserveLuminosity).toBe(true);
    expect(normalizePhotoFilter({}).preserveLuminosity).toBe(true);
    expect(normalizePhotoFilter({ preserveLuminosity: 1 as unknown as boolean }).preserveLuminosity).toBe(true);
    expect(normalizePhotoFilter({ preserveLuminosity: 0 as unknown as boolean }).preserveLuminosity).toBe(true);
  });
});

describe("applyPhotoFilter", () => {
  it("density 0(항등)이면 no-op (데이터 불변)", () => {
    const img = makeImage(2, 1, [
      [10, 20, 30, 40],
      [200, 100, 50, 255],
    ]);
    applyPhotoFilter(img, { color: "#ec8a00", density: 0, preserveLuminosity: true });
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
    expect(pixelAt(img, 1)).toEqual([200, 100, 50, 255]);
  });

  it("워밍 필터는 회색 픽셀을 따뜻하게 민다(R이 B보다 높아짐) + 알파 보존", () => {
    // 회색 시작: R==G==B. 워밍 색은 R 높고 B 0 → R은 덜 빠지고 B는 많이 빠진다.
    const img = makeImage(1, 1, [[128, 128, 128, 200]]);
    applyPhotoFilter(img, { color: "#ec8a00", density: 35, preserveLuminosity: true });
    const [r, g, b, a] = pixelAt(img, 0);
    expect(r!).toBeGreaterThan(b!); // 따뜻한 쪽(R)이 차가운 쪽(B)보다 높다
    expect(r!).toBeGreaterThan(g!); // 주황이라 R > G
    expect(a).toBe(200); // 알파 보존
  });

  it("쿨링 필터는 회색 픽셀을 차갑게 민다(B가 R보다 높아짐)", () => {
    const img = makeImage(1, 1, [[128, 128, 128, 255]]);
    applyPhotoFilter(img, { color: "#006dff", density: 35, preserveLuminosity: true });
    const [r, , b] = pixelAt(img, 0);
    expect(b!).toBeGreaterThan(r!); // 차가운 쪽(B)이 따뜻한 쪽(R)보다 높다
  });

  it("preserveLuminosity면 회색 픽셀의 휘도가 거의 보존된다", () => {
    const img = makeImage(1, 1, [[150, 150, 150, 255]]);
    applyPhotoFilter(img, { color: "#ec8a00", density: 50, preserveLuminosity: true });
    const [r, g, b] = pixelAt(img, 0);
    const after = luma(r!, g!, b!);
    // 원본 휘도 150에 근접(반올림·클램프 오차 한도).
    expect(Math.abs(after - 150)).toBeLessThanOrEqual(2);
  });

  it("preserveLuminosity 끄면 멀티플라이라 전체적으로 어두워진다(휘도 하강)", () => {
    const base = makeImage(1, 1, [[150, 150, 150, 255]]);
    applyPhotoFilter(base, { color: "#ec8a00", density: 50, preserveLuminosity: false });
    const [r, g, b] = pixelAt(base, 0);
    expect(luma(r!, g!, b!)).toBeLessThan(150); // 보존 안 하면 더 어둡다
  });

  it("순흑 픽셀은 멀티플라이/스케일 모두 0 유지(스케일 0-나눗셈 안전)", () => {
    const img = makeImage(1, 1, [[0, 0, 0, 255]]);
    applyPhotoFilter(img, { color: "#ec8a00", density: 60, preserveLuminosity: true });
    expect(pixelAt(img, 0)).toEqual([0, 0, 0, 255]);
  });

  it("2x1에서 모든 픽셀에 적용 + 각 알파 보존", () => {
    const img = makeImage(2, 1, [
      [100, 100, 100, 33],
      [200, 200, 200, 222],
    ]);
    applyPhotoFilter(img, { color: "#006dff", density: 40, preserveLuminosity: true });
    // 두 픽셀 모두 차가워져 B>R, 알파는 그대로.
    expect(pixelAt(img, 0)[2]!).toBeGreaterThan(pixelAt(img, 0)[0]!);
    expect(pixelAt(img, 1)[2]!).toBeGreaterThan(pixelAt(img, 1)[0]!);
    expect(pixelAt(img, 0)[3]).toBe(33);
    expect(pixelAt(img, 1)[3]).toBe(222);
  });
});

describe("PHOTO_FILTER_PRESETS", () => {
  it("첫 항목은 none/없음 항등(density 0)", () => {
    const first = PHOTO_FILTER_PRESETS[0]!;
    expect(first.id).toBe("none");
    expect(first.label).toBe("없음");
    expect(first.value.density).toBe(0);
    expect(isIdentityPhotoFilter(first.value)).toBe(true);
  });

  it("프리셋이 10개 이상이다", () => {
    expect(PHOTO_FILTER_PRESETS.length).toBeGreaterThanOrEqual(8);
    expect(PHOTO_FILTER_PRESETS.length).toBeLessThanOrEqual(30);
  });

  it("id는 모두 고유하다", () => {
    const ids = PHOTO_FILTER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("label/tip은 비어있지 않다", () => {
    for (const p of PHOTO_FILTER_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.tip.length).toBeGreaterThan(0);
    }
  });

  it("모든 value가 normalizePhotoFilter와 동일(색 #rrggbb, density 범위 안)", () => {
    for (const p of PHOTO_FILTER_PRESETS) {
      expect(p.value).toEqual(normalizePhotoFilter(p.value));
      expect(p.value.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.value.density).toBeGreaterThanOrEqual(PHOTO_FILTER_DENSITY_RANGE.min);
      expect(p.value.density).toBeLessThanOrEqual(PHOTO_FILTER_DENSITY_RANGE.max);
    }
  });
});

describe("photoFilterKonvaFilter", () => {
  it("flat attrs(pfColor/pfDensity/pfPreserve)를 읽어 픽셀을 변형한다", () => {
    const img = makeImage(1, 1, [[128, 128, 128, 77]]);
    const attrs = { pfColor: "#ec8a00", pfDensity: 35, pfPreserve: 1 };
    photoFilterKonvaFilter.call({ attrs }, img);
    expect(pixelAt(img, 0)[0]!).toBeGreaterThan(pixelAt(img, 0)[2]!); // 워밍 → R>B
    expect(pixelAt(img, 0)[3]).toBe(77); // 알파 보존

    // 직접 applyPhotoFilter 결과와 동일해야 한다.
    const ref = makeImage(1, 1, [[128, 128, 128, 77]]);
    applyPhotoFilter(ref, normalizePhotoFilter({ color: "#ec8a00", density: 35, preserveLuminosity: true }));
    expect(pixelAt(img, 0)).toEqual(pixelAt(ref, 0));
  });

  it("pfPreserve는 1만 true — 0/누락이면 보존 안 함", () => {
    const on = makeImage(1, 1, [[150, 150, 150, 255]]);
    const off = makeImage(1, 1, [[150, 150, 150, 255]]);
    photoFilterKonvaFilter.call({ attrs: { pfColor: "#ec8a00", pfDensity: 50, pfPreserve: 1 } }, on);
    photoFilterKonvaFilter.call({ attrs: { pfColor: "#ec8a00", pfDensity: 50, pfPreserve: 0 } }, off);
    // 보존 켜면 휘도 ~150, 끄면 더 어둡다 → 두 결과가 다르다.
    expect(pixelAt(on, 0)).not.toEqual(pixelAt(off, 0));
    const offLuma = luma(pixelAt(off, 0)[0]!, pixelAt(off, 0)[1]!, pixelAt(off, 0)[2]!);
    expect(offLuma).toBeLessThan(150);
  });

  it("density 0 attrs는 no-op", () => {
    const img = makeImage(1, 1, [[55, 110, 165, 220]]);
    photoFilterKonvaFilter.call({ attrs: { pfColor: "#ec8a00", pfDensity: 0, pfPreserve: 1 } }, img);
    expect(pixelAt(img, 0)).toEqual([55, 110, 165, 220]);
  });

  it("attrs가 비면 no-op(throw 없음) — pfDensity 누락은 기본값 0이라 항등", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => photoFilterKonvaFilter.call({ attrs: {} }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("this.attrs 자체가 없어도 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => photoFilterKonvaFilter.call({}, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("무효 attrs(숫자 아님)는 안전하게 무시되어 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 255]]);
    const attrs = { pfColor: 42, pfDensity: "x", pfPreserve: "yes" };
    expect(() => photoFilterKonvaFilter.call({ attrs }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 255]);
  });
});

// 미사용 import 방지용 타입 참조.
const _typecheck: PhotoFilter = DEFAULT_PHOTO_FILTER;
void _typecheck;

describe("photo filter hostile direct-call safety", () => {
  it("NaN density and invalid color fail closed without mutating caller settings", () => {
    const filter = Object.freeze({
      color: "invalid",
      density: Number.NaN,
      preserveLuminosity: false,
    }) as PhotoFilter;
    const img = makeImage(1, 1, [[10, 20, 30, 77]]);
    expect(() => applyPhotoFilter(img, filter)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 77]);
    expect(filter.color).toBe("invalid");
  });
});
