import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIGHT,
  LIGHT_HUE_RANGE,
  LIGHT_INTENSITY_RANGE,
  LIGHT_PRESETS,
  LIGHT_TYPES,
  LIGHT_X_RANGE,
  LIGHT_Y_RANGE,
  applyLight,
  isIdentityLight,
  lightKonvaFilter,
  normalizeLight,
  type Light,
  type LightType,
} from "./studio-light";

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

/** 알파 채널(인덱스 +3)이 모두 동일한지 — 빛은 알파를 절대 안 바꿔야 한다. */
function alphaEqual(a: StudioImageDataLike, b: StudioImageDataLike): boolean {
  if (a.data.length !== b.data.length) return false;
  for (let i = 3; i < a.data.length; i += 4) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

/** 평균 휘도(0.299r+0.587g+0.114b) — 빛이 전체를 밝혔는지 판정용. */
function meanLuma(img: StudioImageDataLike): number {
  const n = img.width * img.height;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    sum += 0.299 * img.data[j]! + 0.587 * img.data[j + 1]! + 0.114 * img.data[j + 2]!;
  }
  return sum / n;
}

// ---------------------------------------------------------------------------

describe("DEFAULT_LIGHT / isIdentityLight", () => {
  it("기본값은 lensFlare·intensity0·x30·y30·hue45 항등", () => {
    expect(DEFAULT_LIGHT).toEqual({ type: "lensFlare", intensity: 0, x: 30, y: 30, hue: 45 });
    expect(isIdentityLight(DEFAULT_LIGHT)).toBe(true);
  });

  it("intensity<=0이면 항등, intensity>0이면 항등 아님", () => {
    expect(isIdentityLight({ type: "lensFlare", intensity: 0, x: 50, y: 50, hue: 0 })).toBe(true);
    expect(isIdentityLight({ type: "sunburst", intensity: -5, x: 50, y: 50, hue: 200 })).toBe(true);
    expect(isIdentityLight({ type: "lensFlare", intensity: 1, x: 50, y: 50, hue: 0 })).toBe(false);
    expect(isIdentityLight({ type: "lightLeak", intensity: 50, x: 50, y: 50, hue: 300 })).toBe(false);
  });
});

describe("범위·종류 상수", () => {
  it("세기 범위는 0..100, step 1", () => {
    expect(LIGHT_INTENSITY_RANGE).toEqual({ min: 0, max: 100, step: 1 });
  });
  it("광원 X 범위는 0..100, step 1", () => {
    expect(LIGHT_X_RANGE).toEqual({ min: 0, max: 100, step: 1 });
  });
  it("광원 Y 범위는 0..100, step 1", () => {
    expect(LIGHT_Y_RANGE).toEqual({ min: 0, max: 100, step: 1 });
  });
  it("hue 범위는 0..360, step 1", () => {
    expect(LIGHT_HUE_RANGE).toEqual({ min: 0, max: 360, step: 1 });
  });
  it("LIGHT_TYPES는 4종(lensFlare·lightLeak·sunburst·glowStreak)과 한글 라벨", () => {
    expect(LIGHT_TYPES.map((t) => t.id)).toEqual(["lensFlare", "lightLeak", "sunburst", "glowStreak"]);
    const labels = new Map(LIGHT_TYPES.map((t) => [t.id, t.label]));
    expect(labels.get("lensFlare")).toBe("렌즈 플레어");
    expect(labels.get("lightLeak")).toBe("라이트 릭");
    expect(labels.get("sunburst")).toBe("햇살");
    expect(labels.get("glowStreak")).toBe("광선");
  });
});

describe("normalizeLight", () => {
  it("undefined/null → 기본값", () => {
    expect(normalizeLight()).toEqual(DEFAULT_LIGHT);
    expect(normalizeLight(null)).toEqual(DEFAULT_LIGHT);
  });

  it("누락 키는 기본값으로 채운다", () => {
    expect(normalizeLight({ intensity: 40 })).toEqual({ type: "lensFlare", intensity: 40, x: 30, y: 30, hue: 45 });
    expect(normalizeLight({ type: "sunburst" })).toEqual({ type: "sunburst", intensity: 0, x: 30, y: 30, hue: 45 });
  });

  it("범위 밖 숫자는 각 범위로 클램프", () => {
    expect(normalizeLight({ type: "sunburst", intensity: 999, x: 999, y: 999, hue: 999 })).toEqual({
      type: "sunburst",
      intensity: 100,
      x: 100,
      y: 100,
      hue: 360,
    });
    expect(normalizeLight({ intensity: -50, x: -3, y: -10, hue: -20 })).toEqual({
      type: "lensFlare",
      intensity: 0,
      x: 0,
      y: 0,
      hue: 0,
    });
  });

  it("유효하지 않은 type은 기본 'lensFlare'으로", () => {
    expect(normalizeLight({ type: "bogus" as unknown as LightType }).type).toBe("lensFlare");
    expect(normalizeLight({ type: 42 as unknown as LightType }).type).toBe("lensFlare");
    // 유효 type은 그대로 유지.
    for (const t of LIGHT_TYPES) {
      expect(normalizeLight({ type: t.id }).type).toBe(t.id);
    }
  });

  it("숫자가 아닌 값/NaN/Infinity는 기본값", () => {
    const out = normalizeLight({
      intensity: "50" as unknown as number,
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      hue: Number.NEGATIVE_INFINITY,
    });
    expect(out).toEqual({ type: "lensFlare", intensity: 0, x: 30, y: 30, hue: 45 });
  });
});

describe("applyLight — 항등/no-op", () => {
  it("intensity0이면 no-op(데이터 불변, 픽셀 0회 기록)", () => {
    const img = makeImage(3, 1, [
      [10, 20, 30, 40],
      [200, 100, 50, 255],
      [0, 255, 128, 77],
    ]);
    applyLight(img, { type: "lensFlare", intensity: 0, x: 50, y: 50, hue: 200 });
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
    expect(pixelAt(img, 1)).toEqual([200, 100, 50, 255]);
    expect(pixelAt(img, 2)).toEqual([0, 255, 128, 77]);
  });

  it("intensity<=0(음수)도 no-op", () => {
    const img = makeSolid(8, 8, 100);
    const before = makeSolid(8, 8, 100);
    applyLight(img, { type: "sunburst", intensity: -10, x: 50, y: 50, hue: 40 });
    expect(dataEqual(img, before)).toBe(true);
  });

  it("폭/높이 0이면 no-op(throw 없음)", () => {
    const img: StudioImageDataLike = { data: new Uint8ClampedArray(0), width: 0, height: 0 };
    expect(() => applyLight(img, { type: "lensFlare", intensity: 80, x: 50, y: 50, hue: 0 })).not.toThrow();
  });
});

describe("applyLight — 가산광이 전체를 밝힌다(SCREEN)", () => {
  it("모든 종류가 intensity100에서 평균 휘도를 높인다 + 결정적", () => {
    for (const type of LIGHT_TYPES) {
      const a = makeSolid(24, 24, 60);
      const b = makeSolid(24, 24, 60);
      const base = makeSolid(24, 24, 60);
      applyLight(a, { type: type.id, intensity: 100, x: 40, y: 35, hue: 50 });
      applyLight(b, { type: type.id, intensity: 100, x: 40, y: 35, hue: 50 });
      // 가산광이 실제로 톤을 바꾼다.
      expect(dataEqual(a, base)).toBe(false);
      // 빛은 SCREEN이라 어두워지지 않고 평균 휘도가 올라간다.
      expect(meanLuma(a)).toBeGreaterThan(meanLuma(base));
      // 결정적 — 같은 입력은 같은 출력.
      expect(dataEqual(a, b)).toBe(true);
    }
  });

  it("SCREEN은 채널을 절대 어둡게 만들지 않는다(모든 픽셀 ≥ 원본)", () => {
    for (const type of LIGHT_TYPES) {
      const img = makeSolid(20, 16, 90);
      const base = makeSolid(20, 16, 90);
      applyLight(img, { type: type.id, intensity: 80, x: 55, y: 45, hue: 210 });
      for (let j = 0; j < img.data.length; j += 4) {
        expect(img.data[j]!).toBeGreaterThanOrEqual(base.data[j]!);
        expect(img.data[j + 1]!).toBeGreaterThanOrEqual(base.data[j + 1]!);
        expect(img.data[j + 2]!).toBeGreaterThanOrEqual(base.data[j + 2]!);
      }
    }
  });

  it("intensity가 클수록 더 밝다(약→강)", () => {
    for (const type of LIGHT_TYPES) {
      const soft = makeSolid(20, 20, 70);
      const hard = makeSolid(20, 20, 70);
      applyLight(soft, { type: type.id, intensity: 30, x: 50, y: 50, hue: 30 });
      applyLight(hard, { type: type.id, intensity: 90, x: 50, y: 50, hue: 30 });
      expect(meanLuma(hard)).toBeGreaterThan(meanLuma(soft));
    }
  });

  it("hue가 광색을 물들인다 — 따뜻한 hue는 차가운 hue보다 R 평균이 높다", () => {
    // 같은 위치·세기에서 hue만 바꿔 채널 편향을 비교(가산광이라 hue가 색조를 만든다).
    const warm = makeSolid(20, 20, 50);
    const cool = makeSolid(20, 20, 50);
    applyLight(warm, { type: "lightLeak", intensity: 90, x: 50, y: 50, hue: 25 }); // 주황
    applyLight(cool, { type: "lightLeak", intensity: 90, x: 50, y: 50, hue: 210 }); // 파랑
    let warmR = 0;
    let coolR = 0;
    let warmB = 0;
    let coolB = 0;
    for (let j = 0; j < warm.data.length; j += 4) {
      warmR += warm.data[j]!;
      coolR += cool.data[j]!;
      warmB += warm.data[j + 2]!;
      coolB += cool.data[j + 2]!;
    }
    expect(warmR).toBeGreaterThan(coolR); // 따뜻한 빛은 R이 더 크다
    expect(coolB).toBeGreaterThan(warmB); // 차가운 빛은 B가 더 크다
  });
});

describe("applyLight — 알파/투명 보존", () => {
  it("모든 종류가 알파(+3)를 정확히 보존한다", () => {
    for (const type of LIGHT_TYPES) {
      const W = 8;
      const H = 8;
      const px: number[][] = [];
      for (let i = 0; i < W * H; i++) px.push([80, 80, 80, (i * 13) % 256]);
      const img = makeImage(W, H, px);
      applyLight(img, { type: type.id, intensity: 100, x: 50, y: 50, hue: 120 });
      for (let i = 0; i < W * H; i++) {
        expect(img.data[i * 4 + 3]).toBe((i * 13) % 256);
      }
    }
  });

  it("완전 투명(알파 0) 픽셀은 RGB까지 그대로다(투명 영역 헤일로 없음)", () => {
    for (const type of LIGHT_TYPES) {
      // 광원을 (0,0)에 두고 그 자리 픽셀을 투명으로 — 빛이 가장 셀 위치라도 손대면 안 된다.
      const img = makeImage(4, 4, [[123, 45, 67, 0]]); // 인덱스 0만 알파 0, 나머지는 0,0,0,0
      // 인덱스 0을 명시적으로 투명 컬러 픽셀로.
      img.data.set([123, 45, 67, 0], 0);
      applyLight(img, { type: type.id, intensity: 100, x: 0, y: 0, hue: 60 });
      // 알파 0 픽셀은 RGB도 불변.
      expect(pixelAt(img, 0)).toEqual([123, 45, 67, 0]);
    }
  });

  it("부분 투명 픽셀은 알파 비례로만 밝아진다(불투명보다 덜 밝음)", () => {
    // 같은 위치의 불투명(255) vs 반투명(64) 픽셀 — 빛 기여가 알파/255로 스케일된다.
    for (const type of LIGHT_TYPES) {
      const opaque = makeImage(1, 1, [[40, 40, 40, 255]]);
      const faint = makeImage(1, 1, [[40, 40, 40, 64]]);
      applyLight(opaque, { type: type.id, intensity: 100, x: 0, y: 0, hue: 0 });
      applyLight(faint, { type: type.id, intensity: 100, x: 0, y: 0, hue: 0 });
      // 반투명은 불투명보다 덜 밝거나 같다(같은 경우는 falloff 0 영역).
      expect(meanLuma(faint)).toBeLessThanOrEqual(meanLuma(opaque));
      // 알파는 각각 보존.
      expect(opaque.data[3]).toBe(255);
      expect(faint.data[3]).toBe(64);
    }
  });
});

describe("applyLight — 비유한 입력 방어(검은 픽셀 회귀 방지)", () => {
  // 정규화를 안 거친 직접 applyLight 호출에서 intensity/hue가 비유한(NaN/±Infinity)이어도
  // addLight의 비유한 가드 덕분에 픽셀이 검게 뭉개지지 않는다. 라이브 경로(lightKonvaFilter)는
  // normalizeLight가 막지만, 공개 export applyLight의 계약(알파/RGB 보존) 회귀 방지용.
  it("비유한 intensity(NaN/±Infinity)는 이미지를 손대지 않는다", () => {
    for (const intensity of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const img = makeSolid(8, 8, 120);
      const before = Array.from(img.data);
      expect(() => applyLight(img, { type: "sunburst", intensity, x: 50, y: 50, hue: 40 })).not.toThrow();
      expect(Array.from(img.data)).toEqual(before);
    }
  });

  it("비유한 hue(NaN)는 픽셀을 검게 만들지 않는다(SCREEN은 가산뿐)", () => {
    const img = makeSolid(8, 8, 120);
    expect(() => applyLight(img, { type: "lensFlare", intensity: 100, x: 50, y: 50, hue: Number.NaN })).not.toThrow();
    for (let i = 0; i < img.data.length; i += 4) {
      expect(img.data[i]).toBeGreaterThanOrEqual(120);
    }
  });
});

describe("applyLight — lensFlare(코어+고스트)", () => {
  it("광원 근처가 먼 모서리보다 밝다(방사 코어)", () => {
    const W = 24;
    const H = 24;
    const img = makeSolid(W, H, 50);
    // 광원을 좌상단(0,0)에.
    applyLight(img, { type: "lensFlare", intensity: 100, x: 0, y: 0, hue: 45 });
    const near = pixelAt(img, 0); // (0,0) 광원 자리
    const far = pixelAt(img, (H - 1) * W + (W - 1)); // 반대편 모서리
    const nearLuma = 0.299 * near[0]! + 0.587 * near[1]! + 0.114 * near[2]!;
    const farLuma = 0.299 * far[0]! + 0.587 * far[1]! + 0.114 * far[2]!;
    expect(nearLuma).toBeGreaterThan(farLuma);
  });
});

describe("applyLight — sunburst(방사 광선)", () => {
  it("광원 중심에서 멀어지면 전반적으로 어두워진다(방사 감쇠)", () => {
    const W = 32;
    const H = 32;
    const img = makeSolid(W, H, 40);
    applyLight(img, { type: "sunburst", intensity: 100, x: 50, y: 50, hue: 42 });
    // 중심 픽셀(코어) vs 모서리 평균.
    const center = pixelAt(img, Math.floor(H / 2) * W + Math.floor(W / 2));
    const centerLuma = 0.299 * center[0]! + 0.587 * center[1]! + 0.114 * center[2]!;
    expect(centerLuma).toBeGreaterThan(40); // 중심은 밝아진다
  });
});

describe("applyLight — glowStreak(아나모픽 가로 스트릭)", () => {
  it("광원 행이 위/아래 먼 행보다 밝다(가로로 길게)", () => {
    const W = 32;
    const H = 32;
    const img = makeSolid(W, H, 40);
    const my = 16;
    applyLight(img, { type: "glowStreak", intensity: 100, x: 50, y: (my / H) * 100, hue: 200 });
    // 광원 행 가장자리(x=W-1)와, 같은 x의 먼 행(y=0)을 비교 — 스트릭이 가로로 퍼진다.
    const onRow = pixelAt(img, my * W + (W - 1));
    const offRow = pixelAt(img, 0 * W + (W - 1));
    const onLuma = 0.299 * onRow[0]! + 0.587 * onRow[1]! + 0.114 * onRow[2]!;
    const offLuma = 0.299 * offRow[0]! + 0.587 * offRow[1]! + 0.114 * offRow[2]!;
    expect(onLuma).toBeGreaterThan(offLuma);
  });
});

describe("applyLight — 작은 이미지 / 클램프", () => {
  it("1x1 이미지(가장 작은 케이스)도 throw 없이 안전하고 알파 보존", () => {
    for (const type of LIGHT_TYPES) {
      const img = makeImage(1, 1, [[130, 90, 60, 200]]);
      expect(() => applyLight(img, { type: type.id, intensity: 100, x: 50, y: 50, hue: 180 })).not.toThrow();
      expect(pixelAt(img, 0)[3]).toBe(200); // 알파 보존
      for (const v of img.data) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });

  it("광원이 화면 밖(x/y 0 또는 100, 극단 좌표)이어도 안전", () => {
    for (const type of LIGHT_TYPES) {
      for (const [x, y] of [
        [0, 0],
        [100, 0],
        [0, 100],
        [100, 100],
      ]) {
        const img = makeSolid(6, 6, 80);
        expect(() => applyLight(img, { type: type.id, intensity: 100, x: x!, y: y!, hue: 300 })).not.toThrow();
        for (const v of img.data) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(255);
        }
      }
    }
  });

  it("모든 종류가 강한 설정에도 채널을 유한 0..255로 유지", () => {
    for (const type of LIGHT_TYPES) {
      const img = makeSolid(16, 16, 200); // 거의 밝은 입력 → 가산광이 255 부근으로 몰린다
      applyLight(img, { type: type.id, intensity: 100, x: 50, y: 50, hue: 90 });
      for (const v of img.data) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });

  it("결정적 — 모든 종류가 같은 입력은 같은 출력", () => {
    for (const type of LIGHT_TYPES) {
      const a = makeSolid(18, 14, 70);
      const b = makeSolid(18, 14, 70);
      applyLight(a, { type: type.id, intensity: 70, x: 35, y: 60, hue: 222 });
      applyLight(b, { type: type.id, intensity: 70, x: 35, y: 60, hue: 222 });
      expect(dataEqual(a, b)).toBe(true);
    }
  });
});

describe("LIGHT_PRESETS", () => {
  it("첫 항목이 '없음/기본' 항등이 아니다(바로 효과)", () => {
    const first = LIGHT_PRESETS[0]!;
    expect(isIdentityLight(first.value)).toBe(false);
    expect(first.id).not.toBe("none");
  });

  it("5개 내외이고 전부 실효(intensity>0) 프리셋이다", () => {
    expect(LIGHT_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(LIGHT_PRESETS.length).toBeLessThanOrEqual(8);
    for (const p of LIGHT_PRESETS) {
      expect(isIdentityLight(p.value)).toBe(false);
      expect(p.value.intensity).toBeGreaterThan(0);
    }
  });

  it("id는 모두 고유하다", () => {
    const ids = LIGHT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("label/tip은 비어있지 않다", () => {
    for (const p of LIGHT_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.tip.length).toBeGreaterThan(0);
    }
  });

  it("모든 value가 normalizeLight와 동일(범위 안·type 유효)", () => {
    for (const p of LIGHT_PRESETS) {
      expect(p.value).toEqual(normalizeLight(p.value));
      expect(p.value.intensity).toBeGreaterThanOrEqual(LIGHT_INTENSITY_RANGE.min);
      expect(p.value.intensity).toBeLessThanOrEqual(LIGHT_INTENSITY_RANGE.max);
      expect(p.value.x).toBeGreaterThanOrEqual(LIGHT_X_RANGE.min);
      expect(p.value.x).toBeLessThanOrEqual(LIGHT_X_RANGE.max);
      expect(p.value.y).toBeGreaterThanOrEqual(LIGHT_Y_RANGE.min);
      expect(p.value.y).toBeLessThanOrEqual(LIGHT_Y_RANGE.max);
      expect(p.value.hue).toBeGreaterThanOrEqual(LIGHT_HUE_RANGE.min);
      expect(p.value.hue).toBeLessThanOrEqual(LIGHT_HUE_RANGE.max);
      expect(LIGHT_TYPES.some((t) => t.id === p.value.type)).toBe(true);
    }
  });

  it("명세된 대표 프리셋 값을 담고 있다", () => {
    const byId = new Map(LIGHT_PRESETS.map((p) => [p.id, p.value]));
    // 렌즈 플레어(lensFlare)
    const flare = byId.get("lens-flare")!;
    expect(flare.type).toBe("lensFlare");
    // 햇살(sunburst)
    const sun = byId.get("sunburst-warm")!;
    expect(sun.type).toBe("sunburst");
    // 라이트 릭(lightLeak)
    const leak = byId.get("light-leak")!;
    expect(leak.type).toBe("lightLeak");
    // 광선 스트릭(glowStreak)
    const streak = byId.get("glow-streak")!;
    expect(streak.type).toBe("glowStreak");
    // 골든아워(lightLeak warm)
    const golden = byId.get("golden-hour")!;
    expect(golden.type).toBe("lightLeak");
  });

  it("각 프리셋을 실제로 적용하면 균일 이미지를 밝히고(평균 휘도↑) 변형한다", () => {
    for (const p of LIGHT_PRESETS) {
      const img = makeSolid(20, 20, 60);
      const before = makeSolid(20, 20, 60);
      applyLight(img, p.value);
      expect(dataEqual(img, before)).toBe(false);
      expect(meanLuma(img)).toBeGreaterThan(meanLuma(before));
      expect(alphaEqual(img, before)).toBe(true);
    }
  });
});

describe("lightKonvaFilter", () => {
  it("flat attrs(ltType/ltIntensity/ltX/ltY/ltHue)를 읽어 applyLight와 동일하게 변형", () => {
    const img = makeSolid(20, 12, 60);
    lightKonvaFilter.call({ attrs: { ltType: "sunburst", ltIntensity: 100, ltX: 40, ltY: 35, ltHue: 50 } }, img);

    const ref = makeSolid(20, 12, 60);
    applyLight(ref, normalizeLight({ type: "sunburst", intensity: 100, x: 40, y: 35, hue: 50 }));
    expect(dataEqual(img, ref)).toBe(true);
    // 실제로 변형됐는지.
    expect(dataEqual(img, makeSolid(20, 12, 60))).toBe(false);
  });

  it("lensFlare attrs도 동일하게 적용", () => {
    const img = makeSolid(16, 16, 70);
    lightKonvaFilter.call({ attrs: { ltType: "lensFlare", ltIntensity: 80, ltX: 60, ltY: 30, ltHue: 200 } }, img);
    const ref = makeSolid(16, 16, 70);
    applyLight(ref, normalizeLight({ type: "lensFlare", intensity: 80, x: 60, y: 30, hue: 200 }));
    expect(dataEqual(img, ref)).toBe(true);
  });

  it("attrs가 비면 no-op(throw 없음)", () => {
    const img = makeImage(2, 2, [[10, 20, 30, 40]]);
    const before = Array.from(img.data);
    expect(() => lightKonvaFilter.call({ attrs: {} }, img)).not.toThrow();
    expect(Array.from(img.data)).toEqual(before);
  });

  it("this.attrs 자체가 없어도 no-op", () => {
    const img = makeImage(2, 2, [[10, 20, 30, 40]]);
    const before = Array.from(img.data);
    expect(() => lightKonvaFilter.call({}, img)).not.toThrow();
    expect(Array.from(img.data)).toEqual(before);
  });

  it("intensity0으로 정규화되는 attrs는 no-op", () => {
    const img = makeSolid(8, 8, 130);
    const before = Array.from(img.data);
    lightKonvaFilter.call({ attrs: { ltType: "sunburst", ltIntensity: 0, ltX: 50, ltY: 50, ltHue: 0 } }, img);
    expect(Array.from(img.data)).toEqual(before);
  });

  it("무효 attrs(숫자 아님)는 intensity 기본 0으로 → no-op", () => {
    const img = makeSolid(8, 8, 130);
    const before = Array.from(img.data);
    const attrs = { ltType: "lightLeak", ltIntensity: Number.NaN, ltX: "x", ltY: "y", ltHue: "z" };
    expect(() => lightKonvaFilter.call({ attrs }, img)).not.toThrow();
    // intensity 누락→기본 0 → no-op.
    expect(Array.from(img.data)).toEqual(before);
  });
});

// 미사용 import 방지용 타입 참조.
const _typecheck: Light = DEFAULT_LIGHT;
void _typecheck;
