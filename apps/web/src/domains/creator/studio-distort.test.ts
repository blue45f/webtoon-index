import { describe, expect, it } from "vitest";

import {
  DEFAULT_DISTORT,
  DISTORT_AMOUNT_RANGE,
  DISTORT_PRESETS,
  DISTORT_SCALE_RANGE,
  DISTORT_TYPES,
  applyDistort,
  distortKonvaFilter,
  isIdentityDistort,
  normalizeDistort,
  type Distort,
  type DistortType,
} from "./studio-distort";

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
 * 균일색은 왜곡해도 안 변하므로, 변형 감지 테스트는 패턴 이미지로 한다(알파는 인자로).
 */
function makePattern(width: number, height: number, alpha = 255): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 17) % 256; // R: 가로 줄무늬
      data[i + 1] = (y * 23) % 256; // G: 세로 줄무늬
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

// ---------------------------------------------------------------------------

describe("DEFAULT_DISTORT / isIdentityDistort", () => {
  it("기본값은 twirl·amount0·scale20 항등", () => {
    expect(DEFAULT_DISTORT).toEqual({ type: "twirl", amount: 0, scale: 20 });
    expect(isIdentityDistort(DEFAULT_DISTORT)).toBe(true);
  });

  it("amount===0이면 항등, 그 외(양/음)는 항등 아님", () => {
    expect(isIdentityDistort({ type: "twirl", amount: 0, scale: 30 })).toBe(true);
    expect(isIdentityDistort({ type: "ripple", amount: 1, scale: 10 })).toBe(false);
    expect(isIdentityDistort({ type: "pinch", amount: -1, scale: 10 })).toBe(false);
    expect(isIdentityDistort({ type: "wave", amount: 50, scale: 12 })).toBe(false);
  });
});

describe("범위·종류 상수", () => {
  it("세기 범위는 -100..100, step 1", () => {
    expect(DISTORT_AMOUNT_RANGE).toEqual({ min: -100, max: 100, step: 1 });
  });
  it("스케일 범위는 1..50, step 1", () => {
    expect(DISTORT_SCALE_RANGE).toEqual({ min: 1, max: 50, step: 1 });
  });
  it("DISTORT_TYPES는 4종(twirl·ripple·pinch·wave)과 한글 라벨", () => {
    expect(DISTORT_TYPES.map((t) => t.id)).toEqual(["twirl", "ripple", "pinch", "wave"]);
    const labels = new Map(DISTORT_TYPES.map((t) => [t.id, t.label]));
    expect(labels.get("twirl")).toBe("비틀기");
    expect(labels.get("ripple")).toBe("물결");
    expect(labels.get("pinch")).toBe("핀치");
    expect(labels.get("wave")).toBe("웨이브");
  });
});

describe("normalizeDistort", () => {
  it("undefined/null → 기본값", () => {
    expect(normalizeDistort()).toEqual(DEFAULT_DISTORT);
    expect(normalizeDistort(null)).toEqual(DEFAULT_DISTORT);
  });

  it("누락 키는 기본값으로 채운다", () => {
    expect(normalizeDistort({ amount: 40 })).toEqual({ type: "twirl", amount: 40, scale: 20 });
    expect(normalizeDistort({ type: "wave" })).toEqual({ type: "wave", amount: 0, scale: 20 });
  });

  it("범위 밖 숫자는 각 범위로 클램프(음수 amount는 -100까지 허용)", () => {
    expect(normalizeDistort({ type: "wave", amount: 999, scale: 99 })).toEqual({
      type: "wave",
      amount: 100,
      scale: 50,
    });
    expect(normalizeDistort({ amount: -999, scale: -3 })).toEqual({
      type: "twirl",
      amount: -100,
      scale: 1,
    });
  });

  it("유효하지 않은 type은 기본 'twirl'으로", () => {
    expect(normalizeDistort({ type: "bogus" as unknown as DistortType }).type).toBe("twirl");
    expect(normalizeDistort({ type: 42 as unknown as DistortType }).type).toBe("twirl");
    // 유효 type은 그대로 유지.
    for (const t of DISTORT_TYPES) {
      expect(normalizeDistort({ type: t.id }).type).toBe(t.id);
    }
  });

  it("숫자가 아닌 값/NaN/Infinity는 기본값", () => {
    const out = normalizeDistort({
      amount: "50" as unknown as number,
      scale: Number.NaN,
    });
    expect(out).toEqual({ type: "twirl", amount: 0, scale: 20 });
    expect(normalizeDistort({ amount: Number.POSITIVE_INFINITY, scale: Number.NEGATIVE_INFINITY })).toEqual(
      DEFAULT_DISTORT
    );
  });
});

describe("applyDistort — 항등/no-op", () => {
  it("amount0이면 no-op(데이터 불변)", () => {
    const img = makePattern(8, 8);
    const before = makePattern(8, 8);
    applyDistort(img, { type: "twirl", amount: 0, scale: 20 });
    expect(dataEqual(img, before)).toBe(true);
  });

  it("모든 종류가 amount0에서 정확한 no-op", () => {
    for (const t of DISTORT_TYPES) {
      const img = makePattern(8, 8);
      const before = makePattern(8, 8);
      applyDistort(img, { type: t.id, amount: 0, scale: 15 });
      expect(dataEqual(img, before)).toBe(true);
    }
  });

  it("폭/높이 0이면 no-op(throw 없음)", () => {
    const img: StudioImageDataLike = { data: new Uint8ClampedArray(0), width: 0, height: 0 };
    expect(() => applyDistort(img, { type: "wave", amount: 50, scale: 12 })).not.toThrow();
  });
});

describe("applyDistort — twirl(비틀기)", () => {
  it("중심 픽셀(cx,cy)은 회전 0이라 그대로 유지된다", () => {
    // 짝수 크기 → (cx,cy)=(w/2,h/2)가 정수 픽셀 좌표. r=0이라 자기 자신을 샘플.
    const W = 16;
    const H = 16;
    const img = makePattern(W, H);
    const before = makePattern(W, H);
    applyDistort(img, { type: "twirl", amount: 90, scale: 20 });
    const centerIdx = (H / 2) * W + W / 2;
    expect(pixelAt(img, centerIdx)).toEqual(pixelAt(before, centerIdx));
  });

  it("중간 영역 픽셀은 실제로 비틀린다(전체가 바뀜)", () => {
    const img = makePattern(16, 16);
    const before = makePattern(16, 16);
    applyDistort(img, { type: "twirl", amount: 90, scale: 20 });
    expect(dataEqual(img, before)).toBe(false);
  });

  it("부호(amount)가 반대면 결과가 다르다(CW vs CCW)", () => {
    const cw = makePattern(16, 16);
    const ccw = makePattern(16, 16);
    applyDistort(cw, { type: "twirl", amount: 70, scale: 20 });
    applyDistort(ccw, { type: "twirl", amount: -70, scale: 20 });
    expect(dataEqual(cw, ccw)).toBe(false);
  });

  it("결정적 — 같은 입력 두 번이 완전히 동일", () => {
    const a = makePattern(20, 16);
    const b = makePattern(20, 16);
    applyDistort(a, { type: "twirl", amount: 55, scale: 18 });
    applyDistort(b, { type: "twirl", amount: 55, scale: 18 });
    expect(dataEqual(a, b)).toBe(true);
  });

  it("알파는 보존된다(불투명 패턴은 알파 255 유지)", () => {
    const img = makePattern(16, 16, 255);
    applyDistort(img, { type: "twirl", amount: 80, scale: 20 });
    for (let i = 0; i < img.width * img.height; i++) {
      expect(pixelAt(img, i)[3]).toBe(255);
    }
  });

  it("scale은 픽셀 단위 영향 반경이라 값에 따라 실제 결과가 달라진다", () => {
    const smallRadius = makePattern(64, 64);
    const largeRadius = makePattern(64, 64);
    const before = makePattern(64, 64);
    applyDistort(smallRadius, { type: "twirl", amount: 80, scale: 8 });
    applyDistort(largeRadius, { type: "twirl", amount: 80, scale: 24 });

    const betweenRadii = 32 * 64 + 44; // center=(32,32), r=12
    expect(pixelAt(smallRadius, betweenRadii)).toEqual(pixelAt(before, betweenRadii));
    expect(pixelAt(largeRadius, betweenRadii)).not.toEqual(pixelAt(before, betweenRadii));
    expect(dataEqual(smallRadius, largeRadius)).toBe(false);
  });
});

describe("applyDistort — ripple(물결)", () => {
  it("중심 픽셀은 진동량 0이라 그대로 유지된다", () => {
    const W = 16;
    const H = 16;
    const img = makePattern(W, H);
    const before = makePattern(W, H);
    applyDistort(img, { type: "ripple", amount: 50, scale: 8 });
    const centerIdx = (H / 2) * W + W / 2;
    expect(pixelAt(img, centerIdx)).toEqual(pixelAt(before, centerIdx));
  });

  it("패턴을 실제로 일렁이게 바꾼다(결정적)", () => {
    const a = makePattern(24, 24);
    const b = makePattern(24, 24);
    const base = makePattern(24, 24);
    applyDistort(a, { type: "ripple", amount: 40, scale: 6 });
    applyDistort(b, { type: "ripple", amount: 40, scale: 6 });
    expect(dataEqual(a, base)).toBe(false); // 일렁임이 생긴다
    expect(dataEqual(a, b)).toBe(true); // 결정적
  });

  it("알파는 보존된다", () => {
    const img = makePattern(16, 16, 200);
    applyDistort(img, { type: "ripple", amount: 60, scale: 7 });
    for (let i = 0; i < img.width * img.height; i++) {
      expect(pixelAt(img, i)[3]).toBe(200);
    }
  });
});

describe("applyDistort — pinch(핀치/어안)", () => {
  it("중심 픽셀은 변위 0이라 그대로 유지된다(핀치·부풀림 양쪽)", () => {
    const W = 16;
    const H = 16;
    const centerIdx = (H / 2) * W + W / 2;
    for (const amount of [60, -60]) {
      const img = makePattern(W, H);
      const before = makePattern(W, H);
      applyDistort(img, { type: "pinch", amount, scale: 20 });
      expect(pixelAt(img, centerIdx)).toEqual(pixelAt(before, centerIdx));
    }
  });

  it("a>0(핀치)와 a<0(부풀림)은 서로 다른 결과", () => {
    const pinch = makePattern(20, 20);
    const bulge = makePattern(20, 20);
    applyDistort(pinch, { type: "pinch", amount: 70, scale: 20 });
    applyDistort(bulge, { type: "pinch", amount: -70, scale: 20 });
    const base = makePattern(20, 20);
    expect(dataEqual(pinch, base)).toBe(false);
    expect(dataEqual(bulge, base)).toBe(false);
    expect(dataEqual(pinch, bulge)).toBe(false);
  });

  it("강한 핀치에도 채널은 유한 0..255(반지름 음수 클램프로 안전)", () => {
    const img = makePattern(16, 16);
    applyDistort(img, { type: "pinch", amount: 100, scale: 50 });
    for (const v of img.data) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it("알파는 보존된다", () => {
    const img = makePattern(16, 16, 123);
    applyDistort(img, { type: "pinch", amount: -80, scale: 20 });
    for (let i = 0; i < img.width * img.height; i++) {
      expect(pixelAt(img, i)[3]).toBe(123);
    }
  });

  it("scale은 픽셀 단위 영향 반경이라 값에 따라 실제 결과가 달라진다", () => {
    const smallRadius = makePattern(64, 64);
    const largeRadius = makePattern(64, 64);
    const before = makePattern(64, 64);
    applyDistort(smallRadius, { type: "pinch", amount: 80, scale: 8 });
    applyDistort(largeRadius, { type: "pinch", amount: 80, scale: 24 });

    const betweenRadii = 32 * 64 + 44; // center=(32,32), r=12
    expect(pixelAt(smallRadius, betweenRadii)).toEqual(pixelAt(before, betweenRadii));
    expect(pixelAt(largeRadius, betweenRadii)).not.toEqual(pixelAt(before, betweenRadii));
    expect(dataEqual(smallRadius, largeRadius)).toBe(false);
  });

  it("영향 반경 경계와 바깥은 정확한 no-op이라 음수 falloff/방향 반전이 없다", () => {
    const width = 20;
    const height = 12;
    const effectR = Math.min(width, height) / 2;
    const img = makePattern(width, height);
    const before = makePattern(width, height);
    applyDistort(img, { type: "pinch", amount: 100, scale: 50 });

    const cx = width / 2;
    const cy = height / 2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        if (Math.hypot(x - cx, y - cy) >= effectR) {
          expect(pixelAt(img, index)).toEqual(pixelAt(before, index));
        }
      }
    }

    const justInside = 6 * width + 15; // r=5
    const boundary = 6 * width + 16; // r=6
    const justOutside = 6 * width + 17; // r=7
    expect(pixelAt(img, justInside)).not.toEqual(pixelAt(before, justInside));
    expect(pixelAt(img, boundary)).toEqual(pixelAt(before, boundary));
    expect(pixelAt(img, justOutside)).toEqual(pixelAt(before, justOutside));
  });
});

describe("applyDistort — wave(웨이브)", () => {
  it("패턴을 출렁이게 바꾼다(결정적), 다른 부호는 다른 결과", () => {
    const a = makePattern(24, 24);
    const b = makePattern(24, 24);
    const neg = makePattern(24, 24);
    const base = makePattern(24, 24);
    applyDistort(a, { type: "wave", amount: 40, scale: 8 });
    applyDistort(b, { type: "wave", amount: 40, scale: 8 });
    applyDistort(neg, { type: "wave", amount: -40, scale: 8 });
    expect(dataEqual(a, base)).toBe(false); // 흔들림이 생긴다
    expect(dataEqual(a, b)).toBe(true); // 결정적
    expect(dataEqual(a, neg)).toBe(false); // 부호 방향성
  });

  it("알파는 보존된다", () => {
    const img = makePattern(16, 16, 77);
    applyDistort(img, { type: "wave", amount: 50, scale: 9 });
    for (let i = 0; i < img.width * img.height; i++) {
      expect(pixelAt(img, i)[3]).toBe(77);
    }
  });
});

describe("applyDistort — 균일색 불변 / 작은 이미지 안전성", () => {
  it("균일 단색은 어떤 왜곡으로도 변하지 않는다(가장자리 클램프 샘플)", () => {
    // 모든 소스 픽셀이 같으면 이중선형 결과도 같은 색 → 기하 왜곡이 보이지 않는다.
    for (const t of DISTORT_TYPES) {
      const img = makeSolid(16, 16, [90, 140, 210, 255]);
      const before = makeSolid(16, 16, [90, 140, 210, 255]);
      applyDistort(img, { type: t.id, amount: 100, scale: 12 });
      expect(dataEqual(img, before)).toBe(true);
    }
  });

  it("1x1 이미지(가장 작은 케이스)도 throw 없이 안전하고 알파 보존", () => {
    for (const t of DISTORT_TYPES) {
      const img = makeImage(1, 1, [[130, 90, 60, 200]]);
      expect(() => applyDistort(img, { type: t.id, amount: 100, scale: 5 })).not.toThrow();
      expect(pixelAt(img, 0)).toEqual([130, 90, 60, 200]); // 유일 픽셀이라 자기 자신 클램프
    }
  });

  it("3x3 작은 이미지도 모든 종류에서 throw 없이 유한 출력", () => {
    for (const t of DISTORT_TYPES) {
      const img = makeImage(3, 3, [
        [10, 20, 30, 255],
        [200, 100, 50, 255],
        [80, 160, 240, 255],
        [128, 128, 128, 255],
        [0, 0, 0, 255],
        [255, 255, 255, 255],
        [60, 120, 180, 255],
        [240, 30, 90, 255],
        [15, 200, 75, 255],
      ]);
      expect(() => applyDistort(img, { type: t.id, amount: -100, scale: 50 })).not.toThrow();
      for (const v of img.data) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe("DISTORT_PRESETS", () => {
  it("첫 항목이 '없음/기본' 항등이 아니다(바로 효과)", () => {
    const first = DISTORT_PRESETS[0]!;
    expect(isIdentityDistort(first.value)).toBe(false);
    expect(first.id).not.toBe("none");
  });

  it("전부 실효(amount!==0) 프리셋이고 5개 내외다", () => {
    expect(DISTORT_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(DISTORT_PRESETS.length).toBeLessThanOrEqual(8);
    for (const p of DISTORT_PRESETS) {
      expect(isIdentityDistort(p.value)).toBe(false);
      expect(p.value.amount).not.toBe(0);
    }
  });

  it("id는 모두 고유하다", () => {
    const ids = DISTORT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("label/tip은 비어있지 않다", () => {
    for (const p of DISTORT_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.tip.length).toBeGreaterThan(0);
    }
  });

  it("모든 value가 normalizeDistort와 동일(범위 안·type 유효)", () => {
    for (const p of DISTORT_PRESETS) {
      expect(p.value).toEqual(normalizeDistort(p.value));
      expect(p.value.amount).toBeGreaterThanOrEqual(DISTORT_AMOUNT_RANGE.min);
      expect(p.value.amount).toBeLessThanOrEqual(DISTORT_AMOUNT_RANGE.max);
      expect(p.value.scale).toBeGreaterThanOrEqual(DISTORT_SCALE_RANGE.min);
      expect(p.value.scale).toBeLessThanOrEqual(DISTORT_SCALE_RANGE.max);
      expect(DISTORT_TYPES.some((t) => t.id === p.value.type)).toBe(true);
    }
  });

  it("명세된 대표 프리셋 값을 담고 있다(소용돌이/역소용돌이/잔물결/어안/흔들림)", () => {
    const byId = new Map(DISTORT_PRESETS.map((p) => [p.id, p.value]));
    // 소용돌이(twirl +)
    const swirl = byId.get("swirl")!;
    expect(swirl.type).toBe("twirl");
    expect(swirl.amount).toBeGreaterThan(0);
    // 역소용돌이(twirl -)
    const rev = byId.get("swirl-reverse")!;
    expect(rev.type).toBe("twirl");
    expect(rev.amount).toBeLessThan(0);
    // 잔물결(ripple)
    expect(byId.get("ripple")!.type).toBe("ripple");
    // 어안(pinch -, bulge)
    const fisheye = byId.get("fisheye")!;
    expect(fisheye.type).toBe("pinch");
    expect(fisheye.amount).toBeLessThan(0);
    // 흔들림(wave)
    expect(byId.get("shake")!.type).toBe("wave");
  });
});

describe("distortKonvaFilter", () => {
  it("flat attrs(dsType/dsAmount/dsScale)를 읽어 applyDistort와 동일하게 변형", () => {
    const img = makePattern(16, 16);
    distortKonvaFilter.call({ attrs: { dsType: "twirl", dsAmount: 70, dsScale: 18 } }, img);

    // applyDistort 직접 호출과 동일해야 한다.
    const ref = makePattern(16, 16);
    applyDistort(ref, normalizeDistort({ type: "twirl", amount: 70, scale: 18 }));
    expect(dataEqual(img, ref)).toBe(true);
    // 실제로 변형됐는지.
    expect(dataEqual(img, makePattern(16, 16))).toBe(false);
  });

  it("wave attrs도 동일하게 적용", () => {
    const img = makePattern(20, 20);
    distortKonvaFilter.call({ attrs: { dsType: "wave", dsAmount: -40, dsScale: 9 } }, img);
    const ref = makePattern(20, 20);
    applyDistort(ref, normalizeDistort({ type: "wave", amount: -40, scale: 9 }));
    expect(dataEqual(img, ref)).toBe(true);
  });

  it("attrs가 비면 no-op(throw 없음)", () => {
    const img = makeImage(2, 2, [[10, 20, 30, 40]]);
    const before = Array.from(img.data);
    expect(() => distortKonvaFilter.call({ attrs: {} }, img)).not.toThrow();
    expect(Array.from(img.data)).toEqual(before);
  });

  it("this.attrs 자체가 없어도 no-op", () => {
    const img = makeImage(2, 2, [[10, 20, 30, 40]]);
    const before = Array.from(img.data);
    expect(() => distortKonvaFilter.call({}, img)).not.toThrow();
    expect(Array.from(img.data)).toEqual(before);
  });

  it("amount0으로 정규화되는 attrs는 no-op", () => {
    const img = makePattern(8, 8);
    const before = Array.from(img.data);
    distortKonvaFilter.call({ attrs: { dsType: "ripple", dsAmount: 0, dsScale: 12 } }, img);
    expect(Array.from(img.data)).toEqual(before);
  });

  it("무효 attrs(숫자 아님)는 안전하게 무시 — type만 유효해도 amount 누락이면 항등 no-op", () => {
    const img = makePattern(8, 8);
    const before = Array.from(img.data);
    const attrs = { dsType: "wave", dsAmount: Number.NaN, dsScale: "x" };
    expect(() => distortKonvaFilter.call({ attrs }, img)).not.toThrow();
    expect(Array.from(img.data)).toEqual(before);
  });
});

// 정규화를 거치지 않은 직접 applyDistort 호출에서 scale=0 / 비유한 amount가 들어와도
// sampleBilinear의 비유한 가드 덕분에 좌표 NaN이 0으로 고정돼 알파(+3)가 0으로 뭉개지지 않는다.
// (라이브 Konva 경로는 normalizeDistort가 막지만, 직접 경로의 회귀 방지용.)
describe("applyDistort — 비유한 좌표 방어(알파 보존)", () => {
  const allAlpha255 = (img: StudioImageDataLike): boolean => {
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] !== 255) return false;
    return true;
  };

  it("scale=0 ripple/wave도 알파(+3)를 보존한다", () => {
    for (const type of ["ripple", "wave"] as DistortType[]) {
      const img = makePattern(8, 8, 255);
      expect(() => applyDistort(img, { type, amount: 50, scale: 0 })).not.toThrow();
      expect(allAlpha255(img)).toBe(true);
    }
  });

  it("비유한 amount(NaN/±Infinity)도 알파를 보존한다(throw 없음)", () => {
    for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const img = makePattern(8, 8, 255);
      expect(() => applyDistort(img, { type: "wave", amount, scale: 10 })).not.toThrow();
      expect(allAlpha255(img)).toBe(true);
    }
  });

  it("모든 종류가 scale=0에서도 알파를 보존한다", () => {
    for (const t of DISTORT_TYPES) {
      const img = makePattern(6, 6, 255);
      applyDistort(img, { type: t.id, amount: 80, scale: 0 });
      expect(allAlpha255(img)).toBe(true);
    }
  });
});

// 미사용 import 방지용 타입 참조.
const _typecheck: Distort = DEFAULT_DISTORT;
void _typecheck;
