import { describe, expect, it } from "vitest";

import {
  AUTO_ADJUST_PRESETS,
  AUTO_MODES,
  AUTO_STRENGTH_RANGE,
  DEFAULT_AUTO_ADJUST,
  applyAutoAdjust,
  autoAdjustKonvaFilter,
  collectImageStats,
  computeAutoAdjustCoeffs,
  isIdentityAutoAdjust,
  normalizeAutoAdjust,
  type AutoAdjust,
  type AutoMode,
} from "./studio-auto-adjust";

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

/** 한 채널의 모든 픽셀 값 배열(0=R,1=G,2=B). */
function channel(img: StudioImageDataLike, ch: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < img.data.length; i += 4) out.push(img.data[i + ch]!);
  return out;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** N칸 그레이 그라데이션 — lo..hi 균등(저대비 테스트용). 알파는 모두 255. */
function grayGradient(lo: number, hi: number, n: number): number[][] {
  const px: number[][] = [];
  for (let k = 0; k < n; k++) {
    const v = Math.round(lo + ((hi - lo) * k) / (n - 1));
    px.push([v, v, v, 255]);
  }
  return px;
}

describe("DEFAULT_AUTO_ADJUST / isIdentityAutoAdjust / AUTO_MODES / AUTO_STRENGTH_RANGE", () => {
  it("기본값은 none/strength 100", () => {
    expect(DEFAULT_AUTO_ADJUST).toEqual({ mode: "none", strength: 100 });
  });

  it("AUTO_MODES는 5개 모드 전부", () => {
    expect(AUTO_MODES).toEqual(["none", "contrast", "tone", "color", "whiteBalance"]);
  });

  it("AUTO_STRENGTH_RANGE는 0..100, step 1", () => {
    expect(AUTO_STRENGTH_RANGE).toEqual({ min: 0, max: 100, step: 1 });
  });

  it("mode===none이면 강도와 무관하게 항등", () => {
    expect(isIdentityAutoAdjust({ mode: "none", strength: 100 })).toBe(true);
    expect(isIdentityAutoAdjust(DEFAULT_AUTO_ADJUST)).toBe(true);
  });

  it("strength<=0이면 모드와 무관하게 항등", () => {
    expect(isIdentityAutoAdjust({ mode: "contrast", strength: 0 })).toBe(true);
    expect(isIdentityAutoAdjust({ mode: "color", strength: -5 })).toBe(true);
  });

  it("모드가 none이 아니고 강도>0이면 항등이 아니다", () => {
    expect(isIdentityAutoAdjust({ mode: "contrast", strength: 1 })).toBe(false);
    expect(isIdentityAutoAdjust({ mode: "whiteBalance", strength: 100 })).toBe(false);
  });
});

describe("collectImageStats / computeAutoAdjustCoeffs", () => {
  it("collects histograms in one pass and contrast coeffs stretch low-contrast gradients", () => {
    const img = makeImage(4, 1, grayGradient(40, 200, 4));
    const stats = collectImageStats(img.data);
    expect(stats.total).toBe(4);
    expect(stats.sum[0]).toBeGreaterThan(0);
    const coeffs = computeAutoAdjustCoeffs("contrast", stats);
    expect(coeffs[0].scale).toBeGreaterThan(1);
  });
});

describe("normalizeAutoAdjust", () => {
  it("undefined/null → 기본값(none/100)", () => {
    expect(normalizeAutoAdjust()).toEqual(DEFAULT_AUTO_ADJUST);
    expect(normalizeAutoAdjust(null)).toEqual(DEFAULT_AUTO_ADJUST);
  });

  it("무효 모드는 none으로 떨어진다", () => {
    expect(normalizeAutoAdjust({ mode: "bogus" as unknown as AutoMode }).mode).toBe("none");
    expect(normalizeAutoAdjust({ mode: 42 as unknown as AutoMode }).mode).toBe("none");
    expect(normalizeAutoAdjust({ mode: undefined }).mode).toBe("none");
  });

  it("유효 모드는 그대로 보존", () => {
    for (const m of AUTO_MODES) {
      expect(normalizeAutoAdjust({ mode: m }).mode).toBe(m);
    }
  });

  it("강도는 0..100으로 클램프", () => {
    expect(normalizeAutoAdjust({ mode: "contrast", strength: 999 }).strength).toBe(100);
    expect(normalizeAutoAdjust({ mode: "contrast", strength: -50 }).strength).toBe(0);
    expect(normalizeAutoAdjust({ mode: "contrast", strength: 37 }).strength).toBe(37);
  });

  it("숫자가 아닌 강도는 기본 100", () => {
    expect(normalizeAutoAdjust({ mode: "tone", strength: Number.NaN }).strength).toBe(100);
    expect(normalizeAutoAdjust({ mode: "tone", strength: "50" as unknown as number }).strength).toBe(100);
    expect(normalizeAutoAdjust({ mode: "tone", strength: Number.POSITIVE_INFINITY }).strength).toBe(100);
  });
});

describe("applyAutoAdjust — 항등/no-op", () => {
  it("mode none이면 no-op (데이터 불변)", () => {
    const img = makeImage(2, 1, [
      [10, 20, 30, 40],
      [200, 100, 50, 255],
    ]);
    applyAutoAdjust(img, { mode: "none", strength: 100 });
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
    expect(pixelAt(img, 1)).toEqual([200, 100, 50, 255]);
  });

  it("strength 0이면 어떤 모드든 no-op", () => {
    const before = [
      [110, 120, 130, 255],
      [140, 145, 150, 255],
    ];
    const img = makeImage(2, 1, before);
    applyAutoAdjust(img, { mode: "contrast", strength: 0 });
    expect(pixelAt(img, 0)).toEqual(before[0]);
    expect(pixelAt(img, 1)).toEqual(before[1]);
  });
});

describe("applyAutoAdjust — contrast", () => {
  it("저대비 그레이 그라데이션(100..150)의 min..max를 0..255 쪽으로 넓힌다", () => {
    const px = grayGradient(100, 150, 51);
    const img = makeImage(51, 1, px);
    const beforeR = channel(img, 0);
    const beforeMin = Math.min(...beforeR);
    const beforeMax = Math.max(...beforeR);
    expect(beforeMin).toBe(100);
    expect(beforeMax).toBe(150);

    applyAutoAdjust(img, { mode: "contrast", strength: 100 });
    const afterR = channel(img, 0);
    const afterMin = Math.min(...afterR);
    const afterMax = Math.max(...afterR);
    // 폭이 0..255 방향으로 크게 벌어진다.
    expect(afterMin).toBeLessThan(beforeMin);
    expect(afterMax).toBeGreaterThan(beforeMax);
    expect(afterMin).toBeLessThanOrEqual(5);
    expect(afterMax).toBeGreaterThanOrEqual(250);
  });

  it("전 채널 동일 계수 — 회색 입력은 회색 출력(R=G=B)을 유지한다", () => {
    const px = grayGradient(90, 160, 40);
    const img = makeImage(40, 1, px);
    applyAutoAdjust(img, { mode: "contrast", strength: 100 });
    for (let idx = 0; idx < 40; idx++) {
      const [r, g, b, a] = pixelAt(img, idx);
      expect(r).toBe(g);
      expect(g).toBe(b);
      expect(a).toBe(255); // 알파 보존
    }
  });

  it("strength 50은 원본과 풀-오토 사이 결과를 낸다", () => {
    const px = grayGradient(100, 150, 51);
    const base = makeImage(51, 1, px);
    const half = makeImage(51, 1, px);
    const full = makeImage(51, 1, px);
    applyAutoAdjust(half, { mode: "contrast", strength: 50 });
    applyAutoAdjust(full, { mode: "contrast", strength: 100 });

    // 가장 어두운 픽셀(원본 100)은 풀-오토에서 0 근처로 눌린다.
    // 절반 강도는 원본(100)과 풀-오토 사이에 있어야 한다.
    const orig0 = base.data[0]!; // 100
    const half0 = half.data[0]!;
    const full0 = full.data[0]!;
    expect(full0).toBeLessThan(orig0);
    expect(half0).toBeGreaterThan(full0);
    expect(half0).toBeLessThan(orig0);
  });
});

describe("applyAutoAdjust — tone", () => {
  it("채널별 독립 스트레치 — 좁게 분포한 각 채널을 0..255로 편다", () => {
    // R은 80..120, G는 100..140, B는 60..100으로 서로 다른 좁은 구간.
    const n = 41;
    const px: number[][] = [];
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      px.push([
        Math.round(80 + 40 * t),
        Math.round(100 + 40 * t),
        Math.round(60 + 40 * t),
        255,
      ]);
    }
    const img = makeImage(n, 1, px);
    applyAutoAdjust(img, { mode: "tone", strength: 100 });
    for (const ch of [0, 1, 2]) {
      const vals = channel(img, ch);
      // 각 채널이 거의 풀레인지로 펴진다.
      expect(Math.min(...vals)).toBeLessThanOrEqual(5);
      expect(Math.max(...vals)).toBeGreaterThanOrEqual(250);
    }
    expect(pixelAt(img, 0)[3]).toBe(255); // 알파 보존
  });
});

describe("applyAutoAdjust — color (그레이월드)", () => {
  it("붉은 캐스트 이미지의 R 평균을 중립 쪽으로 낮춘다", () => {
    const px = [
      [200, 60, 60, 255],
      [180, 50, 40, 255],
      [220, 70, 80, 255],
      [160, 40, 30, 255],
    ];
    const img = makeImage(4, 1, px);
    const rBefore = mean(channel(img, 0));
    applyAutoAdjust(img, { mode: "color", strength: 100 });
    const rAfter = mean(channel(img, 0));
    // 과한 빨강이 전체 평균(그레이) 쪽으로 끌려 내려온다.
    expect(rAfter).toBeLessThan(rBefore);
    expect(pixelAt(img, 0)[3]).toBe(255); // 알파 보존
  });

  it("strength 50은 R 평균을 원본과 풀-오토 사이로 만든다", () => {
    const px = [
      [200, 60, 60, 255],
      [180, 50, 40, 255],
      [220, 70, 80, 255],
      [160, 40, 30, 255],
    ];
    const base = makeImage(4, 1, px);
    const half = makeImage(4, 1, px);
    const full = makeImage(4, 1, px);
    applyAutoAdjust(half, { mode: "color", strength: 50 });
    applyAutoAdjust(full, { mode: "color", strength: 100 });

    const rOrig = mean(channel(base, 0));
    const rHalf = mean(channel(half, 0));
    const rFull = mean(channel(full, 0));
    expect(rFull).toBeLessThan(rOrig);
    expect(rHalf).toBeLessThan(rOrig);
    expect(rHalf).toBeGreaterThan(rFull);
  });
});

describe("applyAutoAdjust — whiteBalance", () => {
  it("푸른 조명 하이라이트를 흰색 기준으로 맞춰 가장 밝은 영역의 색 치우침을 줄인다", () => {
    // 밝은 영역이 푸르스름(파랑이 가장 큼). 화이트밸런스가 R/G를 끌어올려 균형을 맞춘다.
    const px = [
      [200, 210, 245, 255],
      [190, 205, 240, 255],
      [180, 195, 235, 255],
      [60, 70, 90, 255],
    ];
    const img = makeImage(4, 1, px);
    // 가장 밝은 픽셀(인덱스 0)의 채널 폭(파랑 - 빨강)이 줄어드는지 본다.
    const before = pixelAt(img, 0);
    const spreadBefore = before[2]! - before[0]!;
    applyAutoAdjust(img, { mode: "whiteBalance", strength: 100 });
    const after = pixelAt(img, 0);
    const spreadAfter = after[2]! - after[0]!;
    expect(spreadAfter).toBeLessThan(spreadBefore);
    expect(after[3]).toBe(255); // 알파 보존
  });
});

describe("applyAutoAdjust — 안전성(빈/단색)·알파 보존", () => {
  it("빈 이미지(픽셀 0개)는 throw 없이 no-op", () => {
    const img = makeImage(0, 0, []);
    expect(() => applyAutoAdjust(img, { mode: "contrast", strength: 100 })).not.toThrow();
    expect(img.data.length).toBe(0);
  });

  it("단색 이미지는 모든 모드에서 no-op(0-division 가드)", () => {
    for (const mode of ["contrast", "tone", "color", "whiteBalance"] as AutoMode[]) {
      const flat = [
        [128, 128, 128, 200],
        [128, 128, 128, 200],
        [128, 128, 128, 200],
      ];
      const img = makeImage(3, 1, flat);
      applyAutoAdjust(img, { mode, strength: 100 });
      expect(pixelAt(img, 0)).toEqual([128, 128, 128, 200]);
      expect(pixelAt(img, 1)).toEqual([128, 128, 128, 200]);
      expect(pixelAt(img, 2)).toEqual([128, 128, 128, 200]);
    }
  });

  it("순흑 단색(평균 0)도 color/whiteBalance에서 안전", () => {
    for (const mode of ["color", "whiteBalance"] as AutoMode[]) {
      const img = makeImage(2, 1, [
        [0, 0, 0, 255],
        [0, 0, 0, 128],
      ]);
      expect(() => applyAutoAdjust(img, { mode, strength: 100 })).not.toThrow();
      expect(pixelAt(img, 0)).toEqual([0, 0, 0, 255]);
      expect(pixelAt(img, 1)[3]).toBe(128); // 알파 보존
    }
  });

  it("여러 픽셀에서 알파를 보존한다(contrast)", () => {
    const img = makeImage(4, 1, [
      [100, 100, 100, 11],
      [120, 120, 120, 222],
      [140, 140, 140, 77],
      [150, 150, 150, 200],
    ]);
    applyAutoAdjust(img, { mode: "contrast", strength: 80 });
    expect(pixelAt(img, 0)[3]).toBe(11);
    expect(pixelAt(img, 1)[3]).toBe(222);
    expect(pixelAt(img, 2)[3]).toBe(77);
    expect(pixelAt(img, 3)[3]).toBe(200);
  });
});

describe("AUTO_ADJUST_PRESETS", () => {
  it("정확히 5개", () => {
    expect(AUTO_ADJUST_PRESETS.length).toBe(5);
  });

  it("첫 항목은 none 항등", () => {
    const first = AUTO_ADJUST_PRESETS[0]!;
    expect(first.id).toBe("none");
    expect(first.value.mode).toBe("none");
    expect(isIdentityAutoAdjust(first.value)).toBe(true);
  });

  it("나머지는 각 모드를 강도 100으로 — 항등이 아니다", () => {
    const rest = AUTO_ADJUST_PRESETS.slice(1);
    const modes = rest.map((p) => p.value.mode);
    expect(modes).toEqual(["contrast", "tone", "color", "whiteBalance"]);
    for (const p of rest) {
      expect(p.value.strength).toBe(100);
      expect(isIdentityAutoAdjust(p.value)).toBe(false);
    }
  });

  it("id는 모두 고유하다", () => {
    const ids = AUTO_ADJUST_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("label/tip은 비어있지 않다", () => {
    for (const p of AUTO_ADJUST_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.tip.length).toBeGreaterThan(0);
    }
  });

  it("모든 value가 normalizeAutoAdjust와 동일(모드 유효·강도 0..100)", () => {
    for (const p of AUTO_ADJUST_PRESETS) {
      expect(p.value).toEqual(normalizeAutoAdjust(p.value));
      expect(AUTO_MODES).toContain(p.value.mode);
      expect(p.value.strength).toBeGreaterThanOrEqual(AUTO_STRENGTH_RANGE.min);
      expect(p.value.strength).toBeLessThanOrEqual(AUTO_STRENGTH_RANGE.max);
    }
  });
});

describe("autoAdjustKonvaFilter", () => {
  it("attrs(autoMode/autoStrength)를 읽어 픽셀을 변형한다", () => {
    const px = grayGradient(100, 150, 51);
    const img = makeImage(51, 1, px);
    autoAdjustKonvaFilter.call({ attrs: { autoMode: "contrast", autoStrength: 100 } }, img);

    // 직접 applyAutoAdjust 결과와 동일해야 한다.
    const ref = makeImage(51, 1, px);
    applyAutoAdjust(ref, normalizeAutoAdjust({ mode: "contrast", strength: 100 }));
    expect(Array.from(img.data)).toEqual(Array.from(ref.data));
    // 실제로 폭이 벌어졌는지(no-op 아님) 확인.
    const r = channel(img, 0);
    expect(Math.min(...r)).toBeLessThan(100);
    expect(Math.max(...r)).toBeGreaterThan(150);
  });

  it("attrs가 비면 no-op(throw 없음)", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => autoAdjustKonvaFilter.call({ attrs: {} }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("this.attrs 자체가 없어도 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => autoAdjustKonvaFilter.call({}, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("autoMode none은 no-op", () => {
    const img = makeImage(2, 1, [
      [100, 120, 140, 255],
      [110, 130, 150, 255],
    ]);
    autoAdjustKonvaFilter.call({ attrs: { autoMode: "none", autoStrength: 100 } }, img);
    expect(pixelAt(img, 0)).toEqual([100, 120, 140, 255]);
    expect(pixelAt(img, 1)).toEqual([110, 130, 150, 255]);
  });

  it("autoStrength 0은 no-op", () => {
    const img = makeImage(2, 1, [
      [100, 120, 140, 255],
      [110, 130, 150, 255],
    ]);
    autoAdjustKonvaFilter.call({ attrs: { autoMode: "contrast", autoStrength: 0 } }, img);
    expect(pixelAt(img, 0)).toEqual([100, 120, 140, 255]);
    expect(pixelAt(img, 1)).toEqual([110, 130, 150, 255]);
  });

  it("무효 attrs(숫자/문자 아님)는 안전하게 무시 — 모드 누락이면 none으로 no-op", () => {
    const img = makeImage(1, 1, [[55, 110, 165, 220]]);
    const attrs = { autoMode: 42, autoStrength: "x" };
    expect(() => autoAdjustKonvaFilter.call({ attrs }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([55, 110, 165, 220]);
  });
});

// 미사용 import 방지용 타입 참조.
const _typecheck: AutoAdjust = DEFAULT_AUTO_ADJUST;
void _typecheck;
