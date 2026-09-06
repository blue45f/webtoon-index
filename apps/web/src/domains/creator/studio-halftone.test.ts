import { describe, expect, it } from "vitest";

import {
  DEFAULT_HALFTONE,
  HALFTONE_ANGLE_RANGE,
  HALFTONE_DOT_RANGE,
  HALFTONE_PRESETS,
  HALFTONE_STRENGTH_RANGE,
  applyHalftone,
  halftoneKonvaFilter,
  isIdentityHalftone,
  normalizeHalftone,
  type Halftone,
} from "./studio-halftone";

import type { StudioImageDataLike } from "./studio-filters";

// ---- 테스트용 가짜 ImageData 빌더 ----

/** 단색 채움 이미지 — 모든 픽셀 [r,g,b,a]. */
function makeSolid(width: number, height: number, rgba: [number, number, number, number]): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { data, width, height };
}

/** [r,g,b,a] 픽셀 배열로 StudioImageDataLike 생성(부분 채움 허용). */
function makeImage(width: number, height: number, pixels: number[][]): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((px, i) => data.set(px, i * 4));
  return { data, width, height };
}

function pixelAt(img: StudioImageDataLike, index: number): number[] {
  return Array.from(img.data.slice(index * 4, index * 4 + 4));
}

/** R 채널 평균(0..255). */
function avgChannel(img: StudioImageDataLike, ch: number): number {
  let sum = 0;
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) sum += img.data[i * 4 + ch]!;
  return sum / n;
}

/** R 채널 분산(망점 패턴 유무 판정용). */
function varChannel(img: StudioImageDataLike, ch: number): number {
  const m = avgChannel(img, ch);
  let s = 0;
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    const d = img.data[i * 4 + ch]! - m;
    s += d * d;
  }
  return s / n;
}

describe("DEFAULT_HALFTONE / 항등", () => {
  it("기본값은 dot4·angle15·cmyk·strength0", () => {
    expect(DEFAULT_HALFTONE).toEqual({ dotSize: 4, angle: 15, mode: "cmyk", strength: 0 });
  });

  it("기본값은 strength0이라 항등", () => {
    expect(isIdentityHalftone(DEFAULT_HALFTONE)).toBe(true);
  });
});

describe("범위 상수", () => {
  it("dot 2..16 step1", () => {
    expect(HALFTONE_DOT_RANGE).toEqual({ min: 2, max: 16, step: 1 });
  });
  it("angle 0..90 step1", () => {
    expect(HALFTONE_ANGLE_RANGE).toEqual({ min: 0, max: 90, step: 1 });
  });
  it("strength 0..100 step1", () => {
    expect(HALFTONE_STRENGTH_RANGE).toEqual({ min: 0, max: 100, step: 1 });
  });
});

describe("normalizeHalftone", () => {
  it("undefined/null → 기본값", () => {
    expect(normalizeHalftone()).toEqual(DEFAULT_HALFTONE);
    expect(normalizeHalftone(null)).toEqual(DEFAULT_HALFTONE);
  });

  it("누락 키는 기본값으로 채운다", () => {
    expect(normalizeHalftone({ strength: 50 })).toEqual({ dotSize: 4, angle: 15, mode: "cmyk", strength: 50 });
  });

  it("범위 밖 dot/angle/strength는 각 범위로 클램프", () => {
    expect(normalizeHalftone({ dotSize: 999, angle: 999, strength: 999, mode: "mono" })).toEqual({
      dotSize: 16,
      angle: 90,
      mode: "mono",
      strength: 100,
    });
    expect(normalizeHalftone({ dotSize: -5, angle: -5, strength: -5 })).toEqual({
      dotSize: 2,
      angle: 0,
      mode: "cmyk",
      strength: 0,
    });
  });

  it("mode가 cmyk/mono가 아니면 기본 cmyk로 검증", () => {
    expect(normalizeHalftone({ mode: "rgb" as unknown as Halftone["mode"], strength: 30 }).mode).toBe("cmyk");
    expect(normalizeHalftone({ mode: undefined, strength: 30 }).mode).toBe("cmyk");
    expect(normalizeHalftone({ mode: "mono", strength: 30 }).mode).toBe("mono");
  });

  it("숫자가 아닌 값/NaN/Infinity는 기본값", () => {
    const out = normalizeHalftone({
      dotSize: "8" as unknown as number,
      angle: Number.NaN,
      strength: Number.POSITIVE_INFINITY,
    });
    expect(out).toEqual(DEFAULT_HALFTONE);
  });
});

describe("isIdentityHalftone", () => {
  it("strength<=0이면 항등", () => {
    expect(isIdentityHalftone({ dotSize: 4, angle: 15, mode: "cmyk", strength: 0 })).toBe(true);
    expect(isIdentityHalftone({ dotSize: 8, angle: 30, mode: "mono", strength: -10 })).toBe(true);
  });

  it("strength>0이면 항등 아님", () => {
    expect(isIdentityHalftone({ dotSize: 4, angle: 15, mode: "cmyk", strength: 1 })).toBe(false);
    expect(isIdentityHalftone({ dotSize: 4, angle: 15, mode: "mono", strength: 100 })).toBe(false);
  });
});

describe("applyHalftone — 항등/no-op", () => {
  it("strength0이면 no-op (데이터 불변)", () => {
    const img = makeImage(4, 4, []);
    const ref = makeImage(4, 4, []);
    img.data.set([10, 20, 30, 40], 0);
    ref.data.set([10, 20, 30, 40], 0);
    applyHalftone(img, { dotSize: 4, angle: 15, mode: "cmyk", strength: 0 });
    expect(Array.from(img.data)).toEqual(Array.from(ref.data));
  });

  it("0x0 / 빈 이미지도 throw 없이 no-op", () => {
    const img: StudioImageDataLike = { data: new Uint8ClampedArray(0), width: 0, height: 0 };
    expect(() => applyHalftone(img, { dotSize: 4, angle: 15, mode: "cmyk", strength: 100 })).not.toThrow();
  });
});

describe("applyHalftone — cmyk 망점화", () => {
  it("평탄한 중간 그레이에 망점 패턴이 생긴다(셀 분산 증가) + 평균 밝기 대략 보존", () => {
    const W = 24;
    const H = 24;
    const flat = makeSolid(W, H, [128, 128, 128, 255]);
    const out = makeSolid(W, H, [128, 128, 128, 255]);
    applyHalftone(out, { dotSize: 4, angle: 15, mode: "cmyk", strength: 100 });

    // 원본은 완전 균일(분산 0) → 망점화 후 점/바탕이 섞여 분산이 크게 증가.
    expect(varChannel(flat, 0)).toBe(0);
    expect(varChannel(out, 0)).toBeGreaterThan(100);

    // 균일하지 않다 — 적어도 한 픽셀은 원본 128에서 벗어난다.
    let differs = false;
    for (let i = 0; i < W * H; i++) {
      if (out.data[i * 4] !== 128) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);

    // 톤 보존: K 망점 면적이 커버리지에 비례 → 평균 밝기는 원본 근처(±60).
    expect(avgChannel(out, 0)).toBeGreaterThan(128 - 60);
    expect(avgChannel(out, 0)).toBeLessThan(128 + 60);
  });

  it("빨강 영역은 C 점(시안)을 거의 안 찍는다 — 빨강은 R 평균이 높게 유지", () => {
    const W = 20;
    const H = 20;
    const out = makeSolid(W, H, [220, 40, 40, 255]);
    applyHalftone(out, { dotSize: 4, angle: 15, mode: "cmyk", strength: 100 });
    // 빨강은 C 커버리지가 거의 0(시안 점 없음) → R 채널 평균이 높게 남는다.
    expect(avgChannel(out, 0)).toBeGreaterThan(150);
    // G/B는 M·Y 점이 찍혀 평균이 낮아진다(빨강이 유지됨).
    expect(avgChannel(out, 1)).toBeLessThan(avgChannel(out, 0));
  });

  it("순백 이미지는 잉크 점이 없어 흰색으로 남는다", () => {
    const out = makeSolid(12, 12, [255, 255, 255, 255]);
    applyHalftone(out, { dotSize: 4, angle: 0, mode: "cmyk", strength: 100 });
    // 커버리지 0 → 점 없음 → 전부 흰색 유지.
    expect(avgChannel(out, 0)).toBeGreaterThan(250);
    expect(varChannel(out, 0)).toBe(0);
  });
});

describe("applyHalftone — mono 망점화", () => {
  // [의도적 변경] 망점 가장자리 안티에일리어싱 도입 — 점 경계 1px 램프가 중간톤을 만든다.
  // 이전에는 완전 이봉(mid === 0)이었지만, 이제 이봉 "지배"(점/바탕이 다수) + AA 중간톤 존재를 검증한다.
  it("그라디언트에 단일 흑색 망점 — 검정/흰색이 지배하고 점 경계엔 AA 중간톤이 있다", () => {
    const W = 32;
    const H = 8;
    // 가로 그라디언트(0..255).
    const px: number[][] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = Math.round((x / (W - 1)) * 255);
        px.push([v, v, v, 255]);
      }
    }
    const out = makeImage(W, H, px);
    applyHalftone(out, { dotSize: 4, angle: 45, mode: "mono", strength: 100 });

    // strength100 mono는 점 내부=0·바탕=255가 지배하고, 점 경계에만 AA 중간톤이 남는다.
    let near0 = 0;
    let near255 = 0;
    let mid = 0;
    for (let i = 0; i < W * H; i++) {
      const v = out.data[i * 4]!;
      if (v <= 1) near0++;
      else if (v >= 254) near255++;
      else mid++;
    }
    expect(near0).toBeGreaterThan(0); // 어두운 쪽엔 검정 점
    expect(near255).toBeGreaterThan(0); // 밝은 쪽엔 흰 바탕
    expect(mid).toBeGreaterThan(0); // 점 경계 AA 중간톤 존재(계단 방지)
    expect(mid).toBeLessThan(near0 + near255); // 이봉 지배(중간톤은 소수)
  });

  it("품질 지표 — 점 경계 대부분이 AA 램프를 지나 0↔255 하드 점프는 극소수다", () => {
    // 큰 점(dotSize 8) 균일 중간톤 — 이전(이진 마스크)에는 모든 경계 스텝이 0↔255 점프였다.
    // AA 도입 후 경계는 중간 커버리지 픽셀을 지나며, 정확히 방사 방향과 정렬된 극소수 스텝만 남는다.
    const W = 32;
    const H = 32;
    const out = makeSolid(W, H, [128, 128, 128, 255]);
    applyHalftone(out, { dotSize: 8, angle: 0, mode: "mono", strength: 100 });
    let aaPixels = 0;
    for (let i = 0; i < W * H; i++) {
      const v = out.data[i * 4]!;
      if (v > 10 && v < 245) aaPixels++;
    }
    let hardSteps = 0;
    let significantSteps = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 1; x < W; x++) {
        const a = out.data[(y * W + x - 1) * 4]!;
        const b = out.data[(y * W + x) * 4]!;
        const d = Math.abs(a - b);
        if (d >= 50) significantSteps++;
        if (d >= 250) hardSteps++;
      }
    }
    expect(significantSteps).toBeGreaterThan(0); // 점 패턴은 존재
    expect(aaPixels).toBeGreaterThan(0); // 경계 AA 중간톤 존재
    // 하드 점프는 경계 스텝의 극소수(이진 마스크였다면 전부 하드 점프).
    expect(hardSteps).toBeLessThan(significantSteps / 10);
  });

  it("어두운 영역일수록 검정 점 비율이 높다(톤 방향성)", () => {
    const W = 16;
    const H = 16;
    const dark = makeSolid(W, H, [40, 40, 40, 255]);
    const light = makeSolid(W, H, [210, 210, 210, 255]);
    applyHalftone(dark, { dotSize: 4, angle: 45, mode: "mono", strength: 100 });
    applyHalftone(light, { dotSize: 4, angle: 45, mode: "mono", strength: 100 });
    // 어두운 단색은 검정 점이 많아 평균이 낮고, 밝은 단색은 점이 적어 평균이 높다.
    expect(avgChannel(dark, 0)).toBeLessThan(avgChannel(light, 0));
  });
});

describe("applyHalftone — strength 블렌드 / 알파 보존", () => {
  it("strength50은 원본과 100%의 중간으로 블렌드된다", () => {
    const W = 20;
    const H = 20;
    const base: [number, number, number, number] = [128, 128, 128, 255];
    const full = makeSolid(W, H, base);
    const half = makeSolid(W, H, base);
    applyHalftone(full, { dotSize: 4, angle: 15, mode: "cmyk", strength: 100 });
    applyHalftone(half, { dotSize: 4, angle: 15, mode: "cmyk", strength: 50 });

    // 블렌드 정의상 half = 128 + (full - 128) * 0.5 (픽셀별).
    for (let i = 0; i < W * H; i++) {
      const j = i * 4;
      const expected = 128 + (full.data[j]! - 128) * 0.5;
      // Uint8ClampedArray 반올림 오차 허용(±1).
      expect(Math.abs(half.data[j]! - expected)).toBeLessThanOrEqual(1);
    }
    // 50% 블렌드는 100%보다 원본(128)에 더 가깝다 → 분산이 더 작다.
    expect(varChannel(half, 0)).toBeLessThan(varChannel(full, 0));
    expect(varChannel(half, 0)).toBeGreaterThan(0);
  });

  it("알파는 모든 모드에서 보존된다", () => {
    const W = 16;
    const H = 4;
    const px: number[][] = [];
    for (let i = 0; i < W * H; i++) px.push([100, 150, 200, (i * 13) % 256]);
    const cmyk = makeImage(W, H, px);
    const mono = makeImage(W, H, px);
    applyHalftone(cmyk, { dotSize: 4, angle: 15, mode: "cmyk", strength: 100 });
    applyHalftone(mono, { dotSize: 4, angle: 30, mode: "mono", strength: 80 });
    for (let i = 0; i < W * H; i++) {
      expect(cmyk.data[i * 4 + 3]).toBe((i * 13) % 256);
      expect(mono.data[i * 4 + 3]).toBe((i * 13) % 256);
    }
  });
});

describe("applyHalftone — 작은 이미지 안전성", () => {
  it("1x1 이미지도 throw 없이 동작하고 알파 보존", () => {
    const img = makeImage(1, 1, [[130, 90, 60, 200]]);
    expect(() => applyHalftone(img, { dotSize: 8, angle: 45, mode: "cmyk", strength: 100 })).not.toThrow();
    expect(pixelAt(img, 0)[3]).toBe(200);
    for (const v of img.data) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it("dotSize보다 작은 3x3 이미지도 안전(cmyk·mono)", () => {
    const mk = () =>
      makeImage(3, 3, [
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
    const a = mk();
    const b = mk();
    expect(() => applyHalftone(a, { dotSize: 16, angle: 70, mode: "cmyk", strength: 100 })).not.toThrow();
    expect(() => applyHalftone(b, { dotSize: 16, angle: 70, mode: "mono", strength: 100 })).not.toThrow();
    for (const v of a.data) expect(Number.isFinite(v)).toBe(true);
    for (const v of b.data) expect(Number.isFinite(v)).toBe(true);
  });

  it("결정적 — 같은 입력은 같은 출력", () => {
    const mk = () => makeSolid(20, 20, [120, 90, 200, 255]);
    const a = mk();
    const b = mk();
    applyHalftone(a, { dotSize: 5, angle: 22, mode: "cmyk", strength: 100 });
    applyHalftone(b, { dotSize: 5, angle: 22, mode: "cmyk", strength: 100 });
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
});

describe("HALFTONE_PRESETS", () => {
  it("첫 항목이 항등(strength0)이 아니다 — 전부 실효 프리셋", () => {
    expect(HALFTONE_PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const p of HALFTONE_PRESETS) {
      expect(isIdentityHalftone(p.value)).toBe(false);
      expect(p.value.strength).toBeGreaterThan(0);
    }
  });

  it("id는 모두 고유하다", () => {
    const ids = HALFTONE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("label/tip은 비어있지 않다", () => {
    for (const p of HALFTONE_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.tip.length).toBeGreaterThan(0);
    }
  });

  it("모든 value가 normalizeHalftone과 동일(범위 안·mode 유효)", () => {
    for (const p of HALFTONE_PRESETS) {
      expect(p.value).toEqual(normalizeHalftone(p.value));
      expect(["cmyk", "mono"]).toContain(p.value.mode);
      expect(p.value.dotSize).toBeGreaterThanOrEqual(HALFTONE_DOT_RANGE.min);
      expect(p.value.dotSize).toBeLessThanOrEqual(HALFTONE_DOT_RANGE.max);
      expect(p.value.angle).toBeGreaterThanOrEqual(HALFTONE_ANGLE_RANGE.min);
      expect(p.value.angle).toBeLessThanOrEqual(HALFTONE_ANGLE_RANGE.max);
    }
  });

  it("명세된 대표 프리셋 값을 담고 있다", () => {
    const byId = new Map(HALFTONE_PRESETS.map((p) => [p.id, p.value]));
    expect(byId.get("comic-color")).toEqual({ dotSize: 4, angle: 15, mode: "cmyk", strength: 100 });
    expect(byId.get("coarse-print")).toEqual({ dotSize: 8, angle: 15, mode: "cmyk", strength: 100 });
    expect(byId.get("mono-dots")).toEqual({ dotSize: 4, angle: 45, mode: "mono", strength: 100 });
    expect(byId.get("newsprint")).toEqual({ dotSize: 3, angle: 45, mode: "mono", strength: 90 });
    expect(byId.get("pop-art")).toEqual({ dotSize: 10, angle: 15, mode: "cmyk", strength: 100 });
  });
});

describe("halftoneKonvaFilter", () => {
  it("flat attrs(htDot/htAngle/htMode/htStrength)를 읽어 applyHalftone과 동일하게 변형", () => {
    const mk = () => makeSolid(20, 20, [128, 128, 128, 255]);
    const img = mk();
    halftoneKonvaFilter.call({ attrs: { htDot: 4, htAngle: 15, htMode: "cmyk", htStrength: 100 } }, img);

    const ref = mk();
    applyHalftone(ref, normalizeHalftone({ dotSize: 4, angle: 15, mode: "cmyk", strength: 100 }));
    expect(Array.from(img.data)).toEqual(Array.from(ref.data));
    // 실제로 변형됐는지(분산 증가).
    expect(varChannel(img, 0)).toBeGreaterThan(0);
  });

  it("mono attrs도 동일하게 적용", () => {
    const mk = () => makeSolid(16, 16, [60, 60, 60, 255]);
    const img = mk();
    halftoneKonvaFilter.call({ attrs: { htDot: 4, htAngle: 45, htMode: "mono", htStrength: 100 } }, img);
    const ref = mk();
    applyHalftone(ref, normalizeHalftone({ dotSize: 4, angle: 45, mode: "mono", strength: 100 }));
    expect(Array.from(img.data)).toEqual(Array.from(ref.data));
  });

  it("attrs가 비면 no-op(throw 없음)", () => {
    const img = makeImage(2, 2, [[10, 20, 30, 40]]);
    const before = Array.from(img.data);
    expect(() => halftoneKonvaFilter.call({ attrs: {} }, img)).not.toThrow();
    expect(Array.from(img.data)).toEqual(before);
  });

  it("this.attrs 자체가 없어도 no-op", () => {
    const img = makeImage(2, 2, [[10, 20, 30, 40]]);
    const before = Array.from(img.data);
    expect(() => halftoneKonvaFilter.call({}, img)).not.toThrow();
    expect(Array.from(img.data)).toEqual(before);
  });

  it("strength0으로 정규화되는 attrs는 no-op", () => {
    const img = makeSolid(8, 8, [55, 110, 165, 220]);
    const before = Array.from(img.data);
    halftoneKonvaFilter.call({ attrs: { htDot: 4, htAngle: 15, htMode: "cmyk", htStrength: 0 } }, img);
    expect(Array.from(img.data)).toEqual(before);
  });

  it("무효 attrs(숫자 아님)는 dot/angle/strength 기본값으로 → strength0 no-op", () => {
    const img = makeSolid(8, 8, [55, 110, 165, 220]);
    const before = Array.from(img.data);
    const attrs = { htDot: "x", htAngle: Number.NaN, htMode: "weird", htStrength: "y" };
    expect(() => halftoneKonvaFilter.call({ attrs }, img)).not.toThrow();
    // strength 누락→기본 0 → no-op.
    expect(Array.from(img.data)).toEqual(before);
  });

  it("line, diamond, cross 패턴을 지원하며 결정적 결과를 생성", () => {
    const mk = () => makeSolid(24, 24, [100, 100, 100, 255]);
    const imgCircle = mk();
    const imgLine = mk();
    const imgDiamond = mk();
    const imgCross = mk();

    applyHalftone(imgCircle, normalizeHalftone({ dotSize: 6, angle: 15, mode: "mono", strength: 100, pattern: "circle" }));
    applyHalftone(imgLine, normalizeHalftone({ dotSize: 6, angle: 15, mode: "mono", strength: 100, pattern: "line" }));
    applyHalftone(imgDiamond, normalizeHalftone({ dotSize: 6, angle: 15, mode: "mono", strength: 100, pattern: "diamond" }));
    applyHalftone(imgCross, normalizeHalftone({ dotSize: 6, angle: 15, mode: "mono", strength: 100, pattern: "cross" }));

    // 각 패턴마다 다른 텍스처 데이터가 생성되어야 함
    expect(Array.from(imgLine.data)).not.toEqual(Array.from(imgCircle.data));
    expect(Array.from(imgDiamond.data)).not.toEqual(Array.from(imgCircle.data));
    expect(Array.from(imgCross.data)).not.toEqual(Array.from(imgCircle.data));

    // 결정성 검증: 동일한 line 패턴 적용 시 동일한 결과
    const imgLine2 = mk();
    applyHalftone(imgLine2, normalizeHalftone({ dotSize: 6, angle: 15, mode: "mono", strength: 100, pattern: "line" }));
    expect(Array.from(imgLine2.data)).toEqual(Array.from(imgLine.data));
  });
});

// 미사용 import 방지용 타입 참조.
const _typecheck: Halftone = DEFAULT_HALFTONE;
void _typecheck;
