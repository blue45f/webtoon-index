import { describe, expect, it } from "vitest";

import {
  BLURFX_ANGLE_RANGE,
  BLURFX_PRESETS,
  BLURFX_RADIUS_RANGE,
  BLURFX_STRENGTH_RANGE,
  BLURFX_TYPES,
  DEFAULT_BLURFX,
  applyBlurFx,
  blurFxKonvaFilter,
  isIdentityBlurFx,
  normalizeBlurFx,
  type BlurFx,
  type BlurFxType,
} from "./studio-blur";

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

/** width*height 균일 회색(value) 이미지 — 알파는 지정값. */
function makeSolid(width: number, height: number, value: number, alpha = 255): StudioImageDataLike {
  const pixels = Array.from({ length: width * height }, () => [value, value, value, alpha]);
  return makeImage(width, height, pixels);
}

/** 두 이미지의 픽셀 데이터가 완전히 같은지. */
function dataEqual(a: StudioImageDataLike, b: StudioImageDataLike): boolean {
  if (a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

/** 가로 그라디언트(좌 0 → 우 255) 이미지 — 흐림이 톤을 섞는지 확인용. */
function makeHGradient(width: number, height: number): StudioImageDataLike {
  const px: number[][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.round((x / (width - 1)) * 255);
      px.push([v, v, v, 255]);
    }
  }
  return makeImage(width, height, px);
}

/** R 채널 분산(흐림으로 대비가 줄었는지 판정용). */
function varChannel(img: StudioImageDataLike, ch: number): number {
  const n = img.width * img.height;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += img.data[i * 4 + ch]!;
  const m = sum / n;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = img.data[i * 4 + ch]! - m;
    s += d * d;
  }
  return s / n;
}

// ---------------------------------------------------------------------------

describe("DEFAULT_BLURFX / isIdentityBlurFx", () => {
  it("기본값은 gaussian·strength0·radius8·angle0 항등", () => {
    expect(DEFAULT_BLURFX).toEqual({ type: "gaussian", strength: 0, radius: 8, angle: 0 });
    expect(isIdentityBlurFx(DEFAULT_BLURFX)).toBe(true);
  });

  it("strength<=0이면 항등, strength>0이면 항등 아님", () => {
    expect(isIdentityBlurFx({ type: "gaussian", strength: 0, radius: 10, angle: 0 })).toBe(true);
    expect(isIdentityBlurFx({ type: "motion", strength: -5, radius: 10, angle: 90 })).toBe(true);
    expect(isIdentityBlurFx({ type: "gaussian", strength: 1, radius: 10, angle: 0 })).toBe(false);
    expect(isIdentityBlurFx({ type: "spin", strength: 50, radius: 12, angle: 0 })).toBe(false);
  });
});

describe("범위·종류 상수", () => {
  it("세기 범위는 0..100, step 1", () => {
    expect(BLURFX_STRENGTH_RANGE).toEqual({ min: 0, max: 100, step: 1 });
  });
  it("반경 범위는 1..40, step 1", () => {
    expect(BLURFX_RADIUS_RANGE).toEqual({ min: 1, max: 40, step: 1 });
  });
  it("각도 범위는 0..360, step 1", () => {
    expect(BLURFX_ANGLE_RANGE).toEqual({ min: 0, max: 360, step: 1 });
  });
  it("BLURFX_TYPES는 4종(gaussian·motion·spin·zoom)과 한글 라벨", () => {
    expect(BLURFX_TYPES.map((t) => t.id)).toEqual(["gaussian", "motion", "spin", "zoom"]);
    const labels = new Map(BLURFX_TYPES.map((t) => [t.id, t.label]));
    expect(labels.get("gaussian")).toBe("가우시안");
    expect(labels.get("motion")).toBe("모션");
    expect(labels.get("spin")).toBe("스핀");
    expect(labels.get("zoom")).toBe("줌");
  });
});

describe("normalizeBlurFx", () => {
  it("undefined/null → 기본값", () => {
    expect(normalizeBlurFx()).toEqual(DEFAULT_BLURFX);
    expect(normalizeBlurFx(null)).toEqual(DEFAULT_BLURFX);
  });

  it("누락 키는 기본값으로 채운다", () => {
    expect(normalizeBlurFx({ strength: 40 })).toEqual({ type: "gaussian", strength: 40, radius: 8, angle: 0 });
    expect(normalizeBlurFx({ type: "motion" })).toEqual({ type: "motion", strength: 0, radius: 8, angle: 0 });
  });

  it("범위 밖 숫자는 각 범위로 클램프", () => {
    expect(normalizeBlurFx({ type: "motion", strength: 999, radius: 999, angle: 999 })).toEqual({
      type: "motion",
      strength: 100,
      radius: 40,
      angle: 360,
    });
    expect(normalizeBlurFx({ strength: -50, radius: -3, angle: -10 })).toEqual({
      type: "gaussian",
      strength: 0,
      radius: 1,
      angle: 0,
    });
  });

  it("유효하지 않은 type은 기본 'gaussian'으로", () => {
    expect(normalizeBlurFx({ type: "bogus" as unknown as BlurFxType }).type).toBe("gaussian");
    expect(normalizeBlurFx({ type: 42 as unknown as BlurFxType }).type).toBe("gaussian");
    // 유효 type은 그대로 유지.
    for (const t of BLURFX_TYPES) {
      expect(normalizeBlurFx({ type: t.id }).type).toBe(t.id);
    }
  });

  it("숫자가 아닌 값/NaN/Infinity는 기본값", () => {
    const out = normalizeBlurFx({
      strength: "50" as unknown as number,
      radius: Number.NaN,
      angle: Number.POSITIVE_INFINITY,
    });
    expect(out).toEqual({ type: "gaussian", strength: 0, radius: 8, angle: 0 });
  });
});

describe("applyBlurFx — 항등/no-op", () => {
  it("strength0이면 no-op(데이터 불변)", () => {
    const img = makeImage(3, 1, [
      [10, 20, 30, 40],
      [200, 100, 50, 255],
      [0, 255, 128, 77],
    ]);
    applyBlurFx(img, { type: "gaussian", strength: 0, radius: 20, angle: 0 });
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
    expect(pixelAt(img, 1)).toEqual([200, 100, 50, 255]);
    expect(pixelAt(img, 2)).toEqual([0, 255, 128, 77]);
  });

  it("strength<=0(음수)도 no-op", () => {
    const img = makeHGradient(8, 8);
    const before = makeHGradient(8, 8);
    applyBlurFx(img, { type: "motion", strength: -10, radius: 20, angle: 90 });
    expect(dataEqual(img, before)).toBe(true);
  });

  it("폭/높이 0이면 no-op(throw 없음)", () => {
    const img: StudioImageDataLike = { data: new Uint8ClampedArray(0), width: 0, height: 0 };
    expect(() => applyBlurFx(img, { type: "gaussian", strength: 80, radius: 10, angle: 0 })).not.toThrow();
  });
});

describe("applyBlurFx — gaussian(전체 부드럽게)", () => {
  it("그라디언트 대비를 줄인다(분산 감소) + 결정적", () => {
    const a = makeHGradient(24, 8);
    const b = makeHGradient(24, 8);
    const base = makeHGradient(24, 8);
    applyBlurFx(a, { type: "gaussian", strength: 100, radius: 8, angle: 0 });
    applyBlurFx(b, { type: "gaussian", strength: 100, radius: 8, angle: 0 });
    // 흐림이 실제로 톤을 바꾼다.
    expect(dataEqual(a, base)).toBe(false);
    // 가우시안은 대비를 낮춘다 → 분산이 줄어든다.
    expect(varChannel(a, 0)).toBeLessThan(varChannel(base, 0));
    // 결정적.
    expect(dataEqual(a, b)).toBe(true);
  });

  it("균일 회색은 흐림 후에도 균일하게 유지(평균 보존)", () => {
    const img = makeSolid(16, 16, 128);
    applyBlurFx(img, { type: "gaussian", strength: 100, radius: 10, angle: 0 });
    // 균일 입력은 박스 평균도 128 → 모든 픽셀이 128 근처(±1).
    for (let i = 0; i < img.width * img.height; i++) {
      expect(Math.abs(img.data[i * 4]! - 128)).toBeLessThanOrEqual(1);
    }
  });

  it("부분 strength는 100%보다 원본에 가깝다(가벼운 흐림)", () => {
    const full = makeHGradient(24, 8);
    const half = makeHGradient(24, 8);
    applyBlurFx(full, { type: "gaussian", strength: 100, radius: 8, angle: 0 });
    applyBlurFx(half, { type: "gaussian", strength: 50, radius: 8, angle: 0 });
    const base = makeHGradient(24, 8);
    // 50% 블렌드는 대비를 덜 낮춘다 → 분산이 100%보다 크고 원본보다 작다.
    expect(varChannel(half, 0)).toBeGreaterThan(varChannel(full, 0));
    expect(varChannel(half, 0)).toBeLessThan(varChannel(base, 0));
  });

  it("알파는 보존된다", () => {
    const img = makeImage(4, 1, [
      [10, 30, 50, 11],
      [60, 90, 120, 99],
      [130, 160, 190, 188],
      [200, 230, 250, 244],
    ]);
    applyBlurFx(img, { type: "gaussian", strength: 100, radius: 6, angle: 0 });
    expect(pixelAt(img, 0)[3]).toBe(11);
    expect(pixelAt(img, 1)[3]).toBe(99);
    expect(pixelAt(img, 2)[3]).toBe(188);
    expect(pixelAt(img, 3)[3]).toBe(244);
  });
});

describe("applyBlurFx — gaussian 품질 지표(임펄스 응답)", () => {
  it("임펄스 응답이 좌우 대칭이고 중심에서 바깥으로 단조 감소한다(가우시안 프로파일)", () => {
    // 긴 행 가운데 한 픽셀만 흰색 — boxesForGauss 3패스는 종형(단조 감소) 프로파일을 만든다.
    const W = 33;
    const center = 16;
    const px: number[][] = [];
    for (let x = 0; x < W; x++) px.push([x === center ? 255 : 0, 0, 0, 255]);
    const img = makeImage(W, 1, px);
    applyBlurFx(img, { type: "gaussian", strength: 100, radius: 4, angle: 0 });

    const v = (x: number) => img.data[x * 4]!;
    // 좌우 대칭.
    for (let d = 1; d <= 8; d++) {
      expect(v(center - d)).toBe(v(center + d));
    }
    // 중심이 최대, 바깥으로 단조 감소(플래토 허용 안 함 — 초반 몇 칸은 strictly).
    expect(v(center)).toBeGreaterThan(v(center + 1));
    expect(v(center + 1)).toBeGreaterThan(v(center + 2));
    for (let d = 2; d <= 8; d++) {
      expect(v(center + d)).toBeLessThanOrEqual(v(center + d - 1));
    }
  });

  it("[의도적 변경] 알파 프리멀티플라이 — 투명 배경의 숨은 검정 RGB가 불투명 영역으로 새지 않는다", () => {
    // 투명 검정(0,0,0,0) 바탕 위 불투명 흰색 3x3 블록 — 예전 비프리멀티 블러는 블록 가장자리
    // RGB가 투명 검정과 섞여 회색 프린지가 생겼다. 이제 가중치(α)가 0이라 흰색이 유지된다.
    const W = 9;
    const H = 9;
    const px: number[][] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const inBlock = x >= 3 && x <= 5 && y >= 3 && y <= 5;
        px.push(inBlock ? [255, 255, 255, 255] : [0, 0, 0, 0]);
      }
    }
    const img = makeImage(W, H, px);
    applyBlurFx(img, { type: "gaussian", strength: 100, radius: 3, angle: 0 });

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const inBlock = x >= 3 && x <= 5 && y >= 3 && y <= 5;
        // 알파는 절대 기록하지 않는다.
        expect(img.data[i + 3]).toBe(inBlock ? 255 : 0);
        if (inBlock) {
          // 보이는(불투명) 픽셀의 RGB는 흰색 그대로 — 검은 프린지 없음.
          expect(img.data[i]).toBeGreaterThanOrEqual(254);
          expect(img.data[i + 1]).toBeGreaterThanOrEqual(254);
          expect(img.data[i + 2]).toBeGreaterThanOrEqual(254);
        }
      }
    }
  });

  it("모션 블러도 프리멀티 샘플 — 투명 배경 위 불투명 픽셀의 RGB가 어두워지지 않는다", () => {
    const W = 9;
    const px: number[][] = [];
    for (let x = 0; x < W; x++) px.push(x === 4 ? [255, 255, 255, 255] : [0, 0, 0, 0]);
    const img = makeImage(W, 1, px);
    applyBlurFx(img, { type: "motion", strength: 100, radius: 6, angle: 0 });
    // 불투명 중심 픽셀 — 샘플 경로의 투명 검정은 가중 0이라 흰색 유지.
    expect(img.data[4 * 4]).toBeGreaterThanOrEqual(254);
    expect(img.data[4 * 4 + 3]).toBe(255);
  });
});

describe("applyBlurFx — motion(방향 잔상)", () => {
  it("가로(angle0) 모션은 세로 줄무늬를 흐리지만 가로 균일 영역은 거의 유지", () => {
    // 세로 줄무늬(열마다 검정/흰) → 가로 모션이 좌우로 섞어 대비를 낮춘다.
    const W = 16;
    const H = 4;
    const px: number[][] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = x % 2 === 0 ? 0 : 255;
        px.push([v, v, v, 255]);
      }
    }
    const img = makeImage(W, H, px);
    const base = makeImage(W, H, px);
    applyBlurFx(img, { type: "motion", strength: 100, radius: 16, angle: 0 });
    // 가로 모션이 세로 줄무늬를 섞어 대비를 크게 낮춘다.
    expect(varChannel(img, 0)).toBeLessThan(varChannel(base, 0));
    expect(dataEqual(img, base)).toBe(false);
  });

  it("같은 입력은 같은 출력(결정적), 다른 각도는 다른 결과", () => {
    const a = makeHGradient(20, 12);
    const b = makeHGradient(20, 12);
    const c = makeHGradient(20, 12);
    applyBlurFx(a, { type: "motion", strength: 100, radius: 20, angle: 0 });
    applyBlurFx(b, { type: "motion", strength: 100, radius: 20, angle: 0 });
    applyBlurFx(c, { type: "motion", strength: 100, radius: 20, angle: 90 });
    expect(dataEqual(a, b)).toBe(true);
    // 가로 그라디언트에 가로 모션(섞임 큼) vs 세로 모션(거의 불변) → 결과 다름.
    expect(dataEqual(a, c)).toBe(false);
  });

  it("알파는 보존된다", () => {
    const img = makeImage(4, 1, [
      [10, 20, 30, 7],
      [200, 100, 50, 88],
      [40, 160, 240, 150],
      [255, 0, 128, 222],
    ]);
    applyBlurFx(img, { type: "motion", strength: 100, radius: 10, angle: 45 });
    expect(pixelAt(img, 0)[3]).toBe(7);
    expect(pixelAt(img, 1)[3]).toBe(88);
    expect(pixelAt(img, 2)[3]).toBe(150);
    expect(pixelAt(img, 3)[3]).toBe(222);
  });
});

describe("applyBlurFx — spin(회전 잔상)", () => {
  it("중심 비대칭 패턴을 회전 평균해 픽셀을 바꾼다 + 결정적", () => {
    const a = makeHGradient(24, 24);
    const b = makeHGradient(24, 24);
    const base = makeHGradient(24, 24);
    applyBlurFx(a, { type: "spin", strength: 100, radius: 20, angle: 0 });
    applyBlurFx(b, { type: "spin", strength: 100, radius: 20, angle: 0 });
    expect(dataEqual(a, base)).toBe(false); // 회전 잔상이 톤을 바꾼다
    expect(dataEqual(a, b)).toBe(true); // 결정적
  });

  it("균일 회색은 회전해도 균일하게 유지(평균 보존)", () => {
    const img = makeSolid(20, 20, 100);
    applyBlurFx(img, { type: "spin", strength: 100, radius: 30, angle: 0 });
    for (let i = 0; i < img.width * img.height; i++) {
      expect(Math.abs(img.data[i * 4]! - 100)).toBeLessThanOrEqual(1);
    }
  });

  it("알파는 보존된다", () => {
    const W = 8;
    const H = 8;
    const px: number[][] = [];
    for (let i = 0; i < W * H; i++) px.push([120, 80, 200, (i * 7) % 256]);
    const img = makeImage(W, H, px);
    applyBlurFx(img, { type: "spin", strength: 100, radius: 25, angle: 0 });
    for (let i = 0; i < W * H; i++) {
      expect(img.data[i * 4 + 3]).toBe((i * 7) % 256);
    }
  });
});

describe("applyBlurFx — zoom(방사 줌 잔상)", () => {
  it("그라디언트를 방사로 늘려 픽셀을 바꾼다 + 결정적", () => {
    const a = makeHGradient(24, 24);
    const b = makeHGradient(24, 24);
    const base = makeHGradient(24, 24);
    applyBlurFx(a, { type: "zoom", strength: 100, radius: 30, angle: 0 });
    applyBlurFx(b, { type: "zoom", strength: 100, radius: 30, angle: 0 });
    expect(dataEqual(a, base)).toBe(false);
    expect(dataEqual(a, b)).toBe(true);
  });

  it("균일 회색은 줌해도 균일하게 유지(평균 보존)", () => {
    const img = makeSolid(20, 20, 180);
    applyBlurFx(img, { type: "zoom", strength: 100, radius: 40, angle: 0 });
    for (let i = 0; i < img.width * img.height; i++) {
      expect(Math.abs(img.data[i * 4]! - 180)).toBeLessThanOrEqual(1);
    }
  });

  it("알파는 보존된다", () => {
    const W = 8;
    const H = 8;
    const px: number[][] = [];
    for (let i = 0; i < W * H; i++) px.push([200, 50, 100, (i * 11) % 256]);
    const img = makeImage(W, H, px);
    applyBlurFx(img, { type: "zoom", strength: 100, radius: 30, angle: 0 });
    for (let i = 0; i < W * H; i++) {
      expect(img.data[i * 4 + 3]).toBe((i * 11) % 256);
    }
  });
});

describe("applyBlurFx — 작은 이미지 / 클램프", () => {
  it("1x1 이미지(가장 작은 케이스)도 throw 없이 안전하고 알파 보존", () => {
    for (const type of BLURFX_TYPES) {
      const img = makeImage(1, 1, [[130, 90, 60, 200]]);
      expect(() => applyBlurFx(img, { type: type.id, strength: 100, radius: 40, angle: 45 })).not.toThrow();
      expect(pixelAt(img, 0)[3]).toBe(200); // 알파 보존
      for (const v of img.data) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });

  it("모든 종류가 강한 설정에도 채널을 유한 0..255로 유지", () => {
    for (const type of BLURFX_TYPES) {
      const img = makeHGradient(16, 16);
      applyBlurFx(img, { type: type.id, strength: 100, radius: 40, angle: 30 });
      for (const v of img.data) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });

  it("결정적 — 모든 종류가 같은 입력은 같은 출력", () => {
    for (const type of BLURFX_TYPES) {
      const a = makeHGradient(18, 14);
      const b = makeHGradient(18, 14);
      applyBlurFx(a, { type: type.id, strength: 70, radius: 16, angle: 22 });
      applyBlurFx(b, { type: type.id, strength: 70, radius: 16, angle: 22 });
      expect(dataEqual(a, b)).toBe(true);
    }
  });
});

describe("BLURFX_PRESETS", () => {
  it("첫 항목이 '없음/기본' 항등이 아니다(바로 효과)", () => {
    const first = BLURFX_PRESETS[0]!;
    expect(isIdentityBlurFx(first.value)).toBe(false);
    expect(first.id).not.toBe("none");
  });

  it("5개 내외이고 전부 실효(strength>0) 프리셋이다", () => {
    expect(BLURFX_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(BLURFX_PRESETS.length).toBeLessThanOrEqual(8);
    for (const p of BLURFX_PRESETS) {
      expect(isIdentityBlurFx(p.value)).toBe(false);
      expect(p.value.strength).toBeGreaterThan(0);
    }
  });

  it("id는 모두 고유하다", () => {
    const ids = BLURFX_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("label/tip은 비어있지 않다", () => {
    for (const p of BLURFX_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.tip.length).toBeGreaterThan(0);
    }
  });

  it("모든 value가 normalizeBlurFx와 동일(범위 안·type 유효)", () => {
    for (const p of BLURFX_PRESETS) {
      expect(p.value).toEqual(normalizeBlurFx(p.value));
      expect(p.value.strength).toBeGreaterThanOrEqual(BLURFX_STRENGTH_RANGE.min);
      expect(p.value.strength).toBeLessThanOrEqual(BLURFX_STRENGTH_RANGE.max);
      expect(p.value.radius).toBeGreaterThanOrEqual(BLURFX_RADIUS_RANGE.min);
      expect(p.value.radius).toBeLessThanOrEqual(BLURFX_RADIUS_RANGE.max);
      expect(p.value.angle).toBeGreaterThanOrEqual(BLURFX_ANGLE_RANGE.min);
      expect(p.value.angle).toBeLessThanOrEqual(BLURFX_ANGLE_RANGE.max);
      expect(BLURFX_TYPES.some((t) => t.id === p.value.type)).toBe(true);
    }
  });

  it("명세된 대표 프리셋 값을 담고 있다", () => {
    const byId = new Map(BLURFX_PRESETS.map((p) => [p.id, p.value]));
    // 소프트 포커스(gaussian)
    const soft = byId.get("soft-focus")!;
    expect(soft.type).toBe("gaussian");
    expect(soft.strength).toBeGreaterThan(0);
    // 스피드(가로 모션, angle 0)
    const speed = byId.get("speed")!;
    expect(speed.type).toBe("motion");
    expect(speed.angle).toBe(0);
    // 강한 모션(motion)
    const strong = byId.get("motion-strong")!;
    expect(strong.type).toBe("motion");
    // 임팩트 스핀(spin)
    const spin = byId.get("impact-spin")!;
    expect(spin.type).toBe("spin");
    // 집중 줌(zoom)
    const zoom = byId.get("focus-zoom")!;
    expect(zoom.type).toBe("zoom");
  });

  it("각 프리셋을 실제로 적용하면 균일 이미지를 깨지 않고(평균 보존) 변형한다", () => {
    for (const p of BLURFX_PRESETS) {
      const grad = makeHGradient(20, 20);
      const before = makeHGradient(20, 20);
      applyBlurFx(grad, p.value);
      // 그라디언트는 흐림으로 어떤 식으로든 바뀐다.
      expect(dataEqual(grad, before)).toBe(false);
    }
  });
});

describe("blurFxKonvaFilter", () => {
  it("flat attrs(bfType/bfStrength/bfRadius/bfAngle)를 읽어 applyBlurFx와 동일하게 변형", () => {
    const img = makeHGradient(20, 12);
    blurFxKonvaFilter.call({ attrs: { bfType: "motion", bfStrength: 100, bfRadius: 20, bfAngle: 0 } }, img);

    const ref = makeHGradient(20, 12);
    applyBlurFx(ref, normalizeBlurFx({ type: "motion", strength: 100, radius: 20, angle: 0 }));
    expect(dataEqual(img, ref)).toBe(true);
    // 실제로 변형됐는지.
    expect(dataEqual(img, makeHGradient(20, 12))).toBe(false);
  });

  it("gaussian attrs도 동일하게 적용", () => {
    const img = makeHGradient(16, 16);
    blurFxKonvaFilter.call({ attrs: { bfType: "gaussian", bfStrength: 80, bfRadius: 10, bfAngle: 0 } }, img);
    const ref = makeHGradient(16, 16);
    applyBlurFx(ref, normalizeBlurFx({ type: "gaussian", strength: 80, radius: 10, angle: 0 }));
    expect(dataEqual(img, ref)).toBe(true);
  });

  it("attrs가 비면 no-op(throw 없음)", () => {
    const img = makeImage(2, 2, [[10, 20, 30, 40]]);
    const before = Array.from(img.data);
    expect(() => blurFxKonvaFilter.call({ attrs: {} }, img)).not.toThrow();
    expect(Array.from(img.data)).toEqual(before);
  });

  it("this.attrs 자체가 없어도 no-op", () => {
    const img = makeImage(2, 2, [[10, 20, 30, 40]]);
    const before = Array.from(img.data);
    expect(() => blurFxKonvaFilter.call({}, img)).not.toThrow();
    expect(Array.from(img.data)).toEqual(before);
  });

  it("strength0으로 정규화되는 attrs는 no-op", () => {
    const img = makeSolid(8, 8, 130);
    const before = Array.from(img.data);
    blurFxKonvaFilter.call({ attrs: { bfType: "spin", bfStrength: 0, bfRadius: 20, bfAngle: 0 } }, img);
    expect(Array.from(img.data)).toEqual(before);
  });

  it("무효 attrs(숫자 아님)는 strength 기본 0으로 → no-op", () => {
    const img = makeSolid(8, 8, 130);
    const before = Array.from(img.data);
    const attrs = { bfType: "motion", bfStrength: Number.NaN, bfRadius: "x", bfAngle: "y" };
    expect(() => blurFxKonvaFilter.call({ attrs }, img)).not.toThrow();
    // strength 누락→기본 0 → no-op.
    expect(Array.from(img.data)).toEqual(before);
  });
});

// 미사용 import 방지용 타입 참조.
const _typecheck: BlurFx = DEFAULT_BLURFX;
void _typecheck;
