import { describe, expect, it } from "vitest";

import {
  DEFAULT_DETAIL,
  DETAIL_AMOUNT_RANGE,
  DETAIL_PRESETS,
  DETAIL_RADIUS_RANGE,
  DETAIL_TYPES,
  applyDetail,
  detailKonvaFilter,
  isIdentityDetail,
  normalizeDetail,
  type Detail,
  type DetailType,
} from "./studio-detail";

import type { StudioImageDataLike } from "./studio-filters";

// ---- 테스트용 가짜 ImageData 빌더 ----

/** [r,g,b,a] 픽셀 배열로 StudioImageDataLike 생성(부분 채움 허용). */
function makeImage(width: number, height: number, pixels: number[][]): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((px, i) => data.set(px, i * 4));
  return { data, width, height };
}

function pixelAt(img: StudioImageDataLike, index: number): number[] {
  return Array.from(img.data.slice(index * 4, index * 4 + 4));
}

/** width*height 균일 단색 이미지 — 모든 픽셀 [r,g,b,a]. */
function makeSolid(width: number, height: number, rgba: [number, number, number, number]): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { data, width, height };
}

/**
 * 좌표 의존 패턴 이미지 — r/g/b가 x,y에 따라 변하는 결정적 그라디언트.
 * 균일색은 디테일 도구에서 평탄해 변화가 약하므로, 변형 감지는 패턴으로 한다(알파는 인자로).
 */
function makePattern(width: number, height: number, alpha = 255): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 17 + 13) % 256; // R: 가로 줄무늬
      data[i + 1] = (y * 23 + 7) % 256; // G: 세로 줄무늬
      data[i + 2] = (x * 7 + y * 11) % 256; // B: 대각
      data[i + 3] = alpha;
    }
  }
  return { data, width, height };
}

/** 두 이미지의 픽셀 데이터가 완전히 같은지. */
function dataEqual(a: StudioImageDataLike, b: StudioImageDataLike): boolean {
  if (a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

/** 모든 픽셀의 알파(+3)가 기대 배열과 일치하는지(원본 알파 보존 검증). */
function alphaPreserved(img: StudioImageDataLike, before: StudioImageDataLike): boolean {
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] !== before.data[i]) return false;
  }
  return true;
}

// 모든 종류(amount>0, opaque)에서 픽셀이 실제로 바뀌는지 검증할 때 쓰는 설정.
const ALL_TYPES: DetailType[] = ["highPass", "median", "smartSharpen"];

// ---------------------------------------------------------------------------

describe("DEFAULT_DETAIL / isIdentityDetail", () => {
  it("기본값은 smartSharpen·amount0·radius2 항등", () => {
    expect(DEFAULT_DETAIL).toEqual({ type: "smartSharpen", amount: 0, radius: 2 });
    expect(isIdentityDetail(DEFAULT_DETAIL)).toBe(true);
  });

  it("amount<=0이면 항등, amount>0이면 항등 아님", () => {
    expect(isIdentityDetail({ type: "highPass", amount: 0, radius: 5 })).toBe(true);
    expect(isIdentityDetail({ type: "median", amount: -5, radius: 1 })).toBe(true);
    expect(isIdentityDetail({ type: "smartSharpen", amount: 1, radius: 2 })).toBe(false);
    expect(isIdentityDetail({ type: "highPass", amount: 80, radius: 4 })).toBe(false);
  });
});

describe("범위·종류 상수", () => {
  it("세기 범위는 0..100, step 1", () => {
    expect(DETAIL_AMOUNT_RANGE).toEqual({ min: 0, max: 100, step: 1 });
  });
  it("반경 범위는 1..10, step 1", () => {
    expect(DETAIL_RADIUS_RANGE).toEqual({ min: 1, max: 10, step: 1 });
  });
  it("DETAIL_TYPES는 3종(highPass·median·smartSharpen)과 한글 라벨", () => {
    expect(DETAIL_TYPES.map((t) => t.id)).toEqual(["highPass", "median", "smartSharpen"]);
    const labels = new Map(DETAIL_TYPES.map((t) => [t.id, t.label]));
    expect(labels.get("highPass")).toBe("하이패스");
    expect(labels.get("median")).toBe("미디언");
    expect(labels.get("smartSharpen")).toBe("스마트 샤픈");
  });
});

describe("normalizeDetail", () => {
  it("undefined/null → 기본값", () => {
    expect(normalizeDetail()).toEqual(DEFAULT_DETAIL);
    expect(normalizeDetail(null)).toEqual(DEFAULT_DETAIL);
  });

  it("누락 키는 기본값으로 채운다", () => {
    expect(normalizeDetail({ amount: 40 })).toEqual({ type: "smartSharpen", amount: 40, radius: 2 });
    expect(normalizeDetail({ type: "highPass" })).toEqual({ type: "highPass", amount: 0, radius: 2 });
  });

  it("범위 밖 숫자는 각 범위로 클램프", () => {
    expect(normalizeDetail({ type: "median", amount: 999, radius: 99 })).toEqual({
      type: "median",
      amount: 100,
      radius: 10,
    });
    expect(normalizeDetail({ amount: -50, radius: -3 })).toEqual({
      type: "smartSharpen",
      amount: 0,
      radius: 1,
    });
  });

  it("유효하지 않은 type은 기본 'smartSharpen'으로", () => {
    expect(normalizeDetail({ type: "bogus" as unknown as DetailType }).type).toBe("smartSharpen");
    expect(normalizeDetail({ type: 42 as unknown as DetailType }).type).toBe("smartSharpen");
    // 유효 type은 그대로 유지.
    for (const t of DETAIL_TYPES) {
      expect(normalizeDetail({ type: t.id }).type).toBe(t.id);
    }
  });

  it("숫자가 아닌 값/NaN/Infinity는 기본값", () => {
    const out = normalizeDetail({
      amount: "50" as unknown as number,
      radius: Number.NaN,
    });
    expect(out).toEqual({ type: "smartSharpen", amount: 0, radius: 2 });
    expect(normalizeDetail({ amount: Number.POSITIVE_INFINITY, radius: Number.NEGATIVE_INFINITY })).toEqual(
      DEFAULT_DETAIL
    );
  });

  it("소수 radius는 정수로 내림", () => {
    expect(normalizeDetail({ radius: 5.9 }).radius).toBe(5);
    expect(normalizeDetail({ radius: 1.2 }).radius).toBe(1);
  });
});

describe("applyDetail — 항등/no-op", () => {
  it("amount0이면 no-op(데이터 불변)", () => {
    const img = makePattern(8, 8);
    const before = makePattern(8, 8);
    applyDetail(img, { type: "highPass", amount: 0, radius: 3 });
    expect(dataEqual(img, before)).toBe(true);
  });

  it("모든 종류가 amount0에서 정확한 no-op(픽셀 쓰기 0)", () => {
    for (const type of ALL_TYPES) {
      const img = makePattern(8, 8);
      const before = makePattern(8, 8);
      applyDetail(img, { type, amount: 0, radius: 4 });
      expect(dataEqual(img, before)).toBe(true);
    }
  });

  it("amount<=0(음수)도 no-op", () => {
    const img = makePattern(6, 6);
    const before = makePattern(6, 6);
    applyDetail(img, { type: "smartSharpen", amount: -10, radius: 3 });
    expect(dataEqual(img, before)).toBe(true);
  });

  it("폭/높이 0이면 no-op(throw 없음)", () => {
    const img: StudioImageDataLike = { data: new Uint8ClampedArray(0), width: 0, height: 0 };
    expect(() => applyDetail(img, { type: "median", amount: 100, radius: 2 })).not.toThrow();
  });
});

describe("applyDetail — 각 종류가 픽셀을 눈에 띄게 바꾼다", () => {
  it("모든 종류가 패턴(불투명)을 실제로 변형한다", () => {
    for (const type of ALL_TYPES) {
      const img = makePattern(16, 16, 255);
      const before = makePattern(16, 16, 255);
      applyDetail(img, { type, amount: 100, radius: 3 });
      expect(dataEqual(img, before)).toBe(false);
    }
  });

  it("모든 종류가 결정적 — 같은 입력 두 번이 완전히 동일", () => {
    for (const type of ALL_TYPES) {
      const a = makePattern(20, 16, 255);
      const b = makePattern(20, 16, 255);
      applyDetail(a, { type, amount: 70, radius: 3 });
      applyDetail(b, { type, amount: 70, radius: 3 });
      expect(dataEqual(a, b)).toBe(true);
    }
  });

  it("모든 종류가 알파(+3)를 보존한다(불투명·반투명 모두)", () => {
    for (const alpha of [255, 120]) {
      for (const type of ALL_TYPES) {
        const img = makePattern(16, 16, alpha);
        const before = makePattern(16, 16, alpha);
        applyDetail(img, { type, amount: 90, radius: 3 });
        expect(alphaPreserved(img, before)).toBe(true);
      }
    }
  });

  it("모든 종류가 채널을 유한 0..255로 클램프한다(강한 설정)", () => {
    for (const type of ALL_TYPES) {
      const img = makePattern(16, 16, 255);
      applyDetail(img, { type, amount: 100, radius: 10 });
      for (const v of img.data) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe("applyDetail — highPass(하이패스 주파수 분리)", () => {
  it("평탄 영역(균일색)은 ~128 중립 회색으로 수렴한다", () => {
    // 평탄 영역은 src≈blur → out = 128 + (src-blur) ≈ 128.
    const img = makeSolid(8, 8, [80, 140, 210, 255]);
    applyDetail(img, { type: "highPass", amount: 100, radius: 2 });
    const center = pixelAt(img, 4 * 8 + 4);
    expect(Math.abs(center[0]! - 128)).toBeLessThanOrEqual(2);
    expect(Math.abs(center[1]! - 128)).toBeLessThanOrEqual(2);
    expect(Math.abs(center[2]! - 128)).toBeLessThanOrEqual(2);
  });

  it("엣지가 있는 패턴은 128에서 벗어난 고주파가 남는다", () => {
    const img = makePattern(24, 24, 255);
    applyDetail(img, { type: "highPass", amount: 100, radius: 3 });
    let hasNon128 = false;
    for (let i = 0; i < img.data.length; i += 4) {
      if (Math.abs(img.data[i]! - 128) > 4) {
        hasNon128 = true;
        break;
      }
    }
    expect(hasNon128).toBe(true);
  });

  it("완전 투명(alpha 0) 픽셀은 효과를 더하지 않아 r/g/b가 원본 그대로다(헤일로 없음)", () => {
    // 투명 픽셀은 (alpha/255)=0 스케일이라 블렌드 강도 0 → 원본 유지.
    const img = makePattern(8, 8, 0);
    const before = makePattern(8, 8, 0);
    applyDetail(img, { type: "highPass", amount: 100, radius: 3 });
    expect(dataEqual(img, before)).toBe(true);
  });

  it("radius가 다르면 결과가 달라진다(블러 반경)", () => {
    const a = makePattern(24, 24, 255);
    const b = makePattern(24, 24, 255);
    applyDetail(a, { type: "highPass", amount: 100, radius: 1 });
    applyDetail(b, { type: "highPass", amount: 100, radius: 5 });
    expect(dataEqual(a, b)).toBe(false);
  });
});

describe("applyDetail — median(미디언 노이즈 제거)", () => {
  it("단일 핫픽셀(스페클)을 이웃 톤으로 제거한다", () => {
    // 균일 회색 한가운데 흰 점 하나 → 미디언이 이웃 회색으로 되돌린다.
    const img = makeSolid(5, 5, [100, 100, 100, 255]);
    const center = 2 * 5 + 2;
    img.data.set([255, 255, 255, 255], center * 4); // 핫픽셀 주입
    applyDetail(img, { type: "median", amount: 100, radius: 1 });
    const px = pixelAt(img, center);
    expect(px[0]).toBe(100); // 핫픽셀이 이웃 중앙값(100)으로 치환
    expect(px[1]).toBe(100);
    expect(px[2]).toBe(100);
    expect(px[3]).toBe(255); // 알파 보존
  });

  it("균일색은 미디언으로도 변하지 않는다(모든 이웃 같은 값)", () => {
    const img = makeSolid(12, 12, [90, 140, 210, 255]);
    const before = makeSolid(12, 12, [90, 140, 210, 255]);
    applyDetail(img, { type: "median", amount: 100, radius: 2 });
    expect(dataEqual(img, before)).toBe(true);
  });

  it("radius(반경)가 다르면 결과가 달라진다", () => {
    const a = makePattern(24, 24, 255);
    const b = makePattern(24, 24, 255);
    applyDetail(a, { type: "median", amount: 100, radius: 1 });
    applyDetail(b, { type: "median", amount: 100, radius: 3 });
    expect(dataEqual(a, b)).toBe(false);
  });

  it("부분 적용(amount<100)은 원본과 중앙값 사이로 블렌드된다", () => {
    const img = makeSolid(5, 5, [100, 100, 100, 255]);
    const center = 2 * 5 + 2;
    img.data.set([200, 200, 200, 255], center * 4); // 200 핫픽셀(중앙값 100)
    applyDetail(img, { type: "median", amount: 50, radius: 1 });
    const r = pixelAt(img, center)[0]!;
    // 200과 100 사이로 블렌드(약 150).
    expect(r).toBeGreaterThan(100);
    expect(r).toBeLessThan(200);
  });
});

describe("applyDetail — smartSharpen(엣지 인식 샤픈)", () => {
  it("엣지 대비를 키운다(어두운 쪽 더 어둡게, 밝은 쪽 더 밝게)", () => {
    // 좌측 어두운 100, 우측 밝은 160의 세로 경계 → 경계 양옆 대비가 벌어진다.
    const w = 9;
    const h = 3;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = x < w / 2 ? 100 : 160;
        const i = (y * w + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const img: StudioImageDataLike = { data, width: w, height: h };
    const darkBefore = data[(1 * w + 3) * 4]!; // 경계 왼쪽(어두운 쪽)
    const lightBefore = data[(1 * w + 5) * 4]!; // 경계 오른쪽(밝은 쪽)
    applyDetail(img, { type: "smartSharpen", amount: 100, radius: 2 });
    const darkAfter = img.data[(1 * w + 3) * 4]!;
    const lightAfter = img.data[(1 * w + 5) * 4]!;
    // 엣지 근처에서 대비가 커진다(어두운 쪽은 더 어둡거나 같고, 밝은 쪽은 더 밝거나 같으며, 합산 대비는 증가).
    expect(lightAfter - darkAfter).toBeGreaterThan(lightBefore - darkBefore);
  });

  it("평탄한 미세 노이즈는 증폭하지 않는다(임계 이하 고주파 무시)", () => {
    // 균일색에 임계(6) 이하 ±2 미세 변동 → 엣지로 보지 않아 거의 변화 없음.
    const w = 8;
    const h = 8;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = 128 + ((x + y) % 2 === 0 ? 1 : -1); // ±1 미세 변동
        const i = (y * w + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const img: StudioImageDataLike = { data, width: w, height: h };
    applyDetail(img, { type: "smartSharpen", amount: 100, radius: 2 });
    // 미세 변동은 임계 이하라 증폭되지 않는다 — 값이 127..129 부근에 머문다.
    for (let i = 0; i < img.data.length; i += 4) {
      expect(img.data[i]!).toBeGreaterThanOrEqual(125);
      expect(img.data[i]!).toBeLessThanOrEqual(131);
    }
  });

  it("균일색(고주파 0)은 변하지 않는다", () => {
    const img = makeSolid(10, 10, [70, 120, 180, 255]);
    const before = makeSolid(10, 10, [70, 120, 180, 255]);
    applyDetail(img, { type: "smartSharpen", amount: 100, radius: 3 });
    expect(dataEqual(img, before)).toBe(true);
  });

  // [의도적 변경] 하드 임계 게이트 → 소프트 램프(smoothstep, thr..2·thr) — 임계 부근 고주파는
  // 부분 증폭만 받아 임계 경계에서 증폭이 0↔1로 튀며 생기던 헤일로/팝핑이 사라진다.
  it("임계~2배 임계 사이 고주파는 부분 증폭된다(소프트 게이트 램프)", () => {
    // 균일 128 위 한 픽셀만 +9(=137) — radius1 박스 블러에서 hi = 137-129 = 8 (thr 6 < 8 < 12).
    const img = makeSolid(5, 5, [128, 128, 128, 255]);
    const center = 2 * 5 + 2;
    img.data.set([137, 137, 137, 255], center * 4);
    applyDetail(img, { type: "smartSharpen", amount: 100, radius: 1 });
    const r = img.data[center * 4]!;
    // 부분 증폭 — 원본(137)보다 커지되, 완전 증폭(137 + 8*1.5 = 149)에는 못 미친다.
    expect(r).toBeGreaterThan(137);
    expect(r).toBeLessThan(146);
  });

  it("강한 샤픈에도 채널은 유한 0..255", () => {
    const img = makePattern(16, 16, 255);
    applyDetail(img, { type: "smartSharpen", amount: 100, radius: 5 });
    for (const v of img.data) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});

describe("applyDetail — 작은 이미지 안전성", () => {
  it("1x1 이미지(가장 작은 케이스)도 throw 없이 안전하고 알파 보존", () => {
    for (const type of ALL_TYPES) {
      const img = makeImage(1, 1, [[130, 90, 60, 200]]);
      expect(() => applyDetail(img, { type, amount: 100, radius: 10 })).not.toThrow();
      expect(pixelAt(img, 0)[3]).toBe(200); // 알파 보존
      for (const v of img.data) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });

  it("2x2 작은 이미지도 모든 종류에서 throw 없이 유한 출력", () => {
    for (const type of ALL_TYPES) {
      const img = makeImage(2, 2, [
        [10, 20, 30, 255],
        [200, 100, 50, 255],
        [80, 160, 240, 255],
        [128, 128, 128, 255],
      ]);
      expect(() => applyDetail(img, { type, amount: 100, radius: 8 })).not.toThrow();
      for (const v of img.data) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe("DETAIL_PRESETS", () => {
  it("첫 항목이 '없음/기본' 항등이 아니다(바로 효과)", () => {
    const first = DETAIL_PRESETS[0]!;
    expect(isIdentityDetail(first.value)).toBe(false);
    expect(first.id).not.toBe("none");
  });

  it("전부 실효(amount>0) 프리셋이고 5개 내외다", () => {
    expect(DETAIL_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(DETAIL_PRESETS.length).toBeLessThanOrEqual(8);
    for (const p of DETAIL_PRESETS) {
      expect(isIdentityDetail(p.value)).toBe(false);
      expect(p.value.amount).toBeGreaterThan(0);
    }
  });

  it("id는 모두 고유하다", () => {
    const ids = DETAIL_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("label/tip은 비어있지 않다", () => {
    for (const p of DETAIL_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.tip.length).toBeGreaterThan(0);
    }
  });

  it("모든 value가 normalizeDetail과 동일(범위 안·type 유효)", () => {
    for (const p of DETAIL_PRESETS) {
      expect(p.value).toEqual(normalizeDetail(p.value));
      expect(p.value.amount).toBeGreaterThanOrEqual(DETAIL_AMOUNT_RANGE.min);
      expect(p.value.amount).toBeLessThanOrEqual(DETAIL_AMOUNT_RANGE.max);
      expect(p.value.radius).toBeGreaterThanOrEqual(DETAIL_RADIUS_RANGE.min);
      expect(p.value.radius).toBeLessThanOrEqual(DETAIL_RADIUS_RANGE.max);
      expect(DETAIL_TYPES.some((t) => t.id === p.value.type)).toBe(true);
    }
  });

  it("명세된 대표 프리셋 값을 담고 있다(하이패스/미디언 약/미디언 강/스마트 샤픈/강한 샤픈)", () => {
    const byId = new Map(DETAIL_PRESETS.map((p) => [p.id, p.value]));
    expect(byId.get("highpass-texture")!.type).toBe("highPass");
    const soft = byId.get("median-soft")!;
    expect(soft.type).toBe("median");
    const strong = byId.get("median-strong")!;
    expect(strong.type).toBe("median");
    // 미디언 강은 더 큰 반경/세기.
    expect(strong.radius).toBeGreaterThanOrEqual(soft.radius);
    expect(strong.amount).toBeGreaterThan(soft.amount);
    expect(byId.get("smart-sharpen")!.type).toBe("smartSharpen");
    const sharpStrong = byId.get("smart-sharpen-strong")!;
    expect(sharpStrong.type).toBe("smartSharpen");
    expect(sharpStrong.amount).toBe(100);
  });
});

describe("detailKonvaFilter", () => {
  it("flat attrs(dtType/dtAmount/dtRadius)를 읽어 applyDetail과 동일하게 변형", () => {
    const img = makePattern(16, 16, 255);
    detailKonvaFilter.call({ attrs: { dtType: "highPass", dtAmount: 100, dtRadius: 3 } }, img);

    // applyDetail 직접 호출과 동일해야 한다.
    const ref = makePattern(16, 16, 255);
    applyDetail(ref, normalizeDetail({ type: "highPass", amount: 100, radius: 3 }));
    expect(dataEqual(img, ref)).toBe(true);
    // 실제로 변형됐는지.
    expect(dataEqual(img, makePattern(16, 16, 255))).toBe(false);
  });

  it("median attrs도 동일하게 적용", () => {
    const img = makePattern(20, 20, 255);
    detailKonvaFilter.call({ attrs: { dtType: "median", dtAmount: 90, dtRadius: 2 } }, img);
    const ref = makePattern(20, 20, 255);
    applyDetail(ref, normalizeDetail({ type: "median", amount: 90, radius: 2 }));
    expect(dataEqual(img, ref)).toBe(true);
  });

  it("attrs가 비면 no-op(throw 없음)", () => {
    const img = makeImage(2, 2, [[10, 20, 30, 40]]);
    const before = Array.from(img.data);
    expect(() => detailKonvaFilter.call({ attrs: {} }, img)).not.toThrow();
    expect(Array.from(img.data)).toEqual(before);
  });

  it("this.attrs 자체가 없어도 no-op", () => {
    const img = makeImage(2, 2, [[10, 20, 30, 40]]);
    const before = Array.from(img.data);
    expect(() => detailKonvaFilter.call({}, img)).not.toThrow();
    expect(Array.from(img.data)).toEqual(before);
  });

  it("amount0으로 정규화되는 attrs는 no-op", () => {
    const img = makePattern(8, 8);
    const before = Array.from(img.data);
    detailKonvaFilter.call({ attrs: { dtType: "median", dtAmount: 0, dtRadius: 2 } }, img);
    expect(Array.from(img.data)).toEqual(before);
  });

  it("무효 attrs(숫자 아님)는 안전하게 무시 — type만 유효해도 amount 누락이면 항등 no-op", () => {
    const img = makePattern(8, 8);
    const before = Array.from(img.data);
    const attrs = { dtType: "highPass", dtAmount: Number.NaN, dtRadius: "x" };
    expect(() => detailKonvaFilter.call({ attrs }, img)).not.toThrow();
    expect(Array.from(img.data)).toEqual(before);
  });
});

// 모든 종류가 완전 투명(알파 0) 픽셀의 RGB까지 보존하는지(헤일로 없음) — 알파 가드 회귀 방지.
// highPass는 평탄 영역을 회색(128)으로 보내므로 알파 가드가 없으면 투명 영역이 회색으로 샌다.
describe("applyDetail — 완전 투명 픽셀 RGB 보존(전 종류)", () => {
  it("알파 0 패턴은 모든 종류에서 RGB까지 그대로다", () => {
    for (const type of ALL_TYPES) {
      const img = makePattern(8, 8, 0); // 알파 0(투명)
      const before = makePattern(8, 8, 0);
      applyDetail(img, { type, amount: 100, radius: 3 });
      expect(dataEqual(img, before)).toBe(true);
    }
  });
});

// 정규화를 안 거친 직접 applyDetail 호출에서 amount/radius가 비유한(NaN/±Infinity)이어도
// 픽셀이 검게(0) 뭉개지지 않는다(median buf[undefined]→NaN, highPass inv NaN 차단). 라이브 경로는 normalizeDetail이 막는다.
describe("applyDetail — 비유한 입력 방어(검은 픽셀 회귀 방지)", () => {
  const anyNonBlack = (img: StudioImageDataLike): boolean => {
    for (let i = 0; i < img.data.length; i += 4)
      if (img.data[i] || img.data[i + 1] || img.data[i + 2]) return true;
    return false;
  };

  it("비유한 amount는 이미지를 손대지 않는다(t=0)", () => {
    for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const img = makePattern(8, 8, 255);
      const before = makePattern(8, 8, 255);
      expect(() => applyDetail(img, { type: "highPass", amount, radius: 2 })).not.toThrow();
      expect(dataEqual(img, before)).toBe(true);
    }
  });

  it("비유한 radius여도 알파 보존 + 검은 오염 없음(모든 종류)", () => {
    for (const type of ALL_TYPES) {
      const img = makePattern(8, 8, 255);
      const before = makePattern(8, 8, 255);
      expect(() => applyDetail(img, { type, amount: 100, radius: Number.NaN })).not.toThrow();
      expect(alphaPreserved(img, before)).toBe(true);
      expect(anyNonBlack(img)).toBe(true);
    }
  });
});

// 미사용 import 방지용 타입 참조.
const _typecheck: Detail = DEFAULT_DETAIL;
void _typecheck;
