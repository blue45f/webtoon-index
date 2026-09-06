import { describe, expect, it } from "vitest";

import {
  applyWetMixDab,
  sampleWetMixDabAverage,
  wetMixStroke,
  type WetMixSettings,
} from "./studio-wet-mix";

// ---------------------------------------------------------------------------
// 테스트 픽스처 — studio-smudge.test.ts / studio-dodge-burn.test.ts 의 makeImageData 와 동일 기법
// (좌표 색상 함수 → RGBA 버퍼).
// ---------------------------------------------------------------------------

function makeImageData(
  w: number,
  h: number,
  colorAt: (x: number, y: number) => readonly [number, number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = colorAt(x, y);
      const idx = (y * w + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  return data;
}

function pixelAt(
  data: Uint8ClampedArray,
  w: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const idx = (y * w + x) * 4;
  return [data[idx]!, data[idx + 1]!, data[idx + 2]!, data[idx + 3]!];
}

const RED = [255, 0, 0, 255] as const;
const WHITE = [255, 255, 255, 255] as const;
const BLUE = [30, 60, 220, 255] as const;
const CLEAR = [0, 0, 0, 0] as const;

function settings(overrides: Partial<WetMixSettings> = {}): WetMixSettings {
  return {
    radiusPx: 8,
    hardness: 1,
    strength: 1,
    wetness: 0,
    pickup: 0.5,
    paintColor: { r: 255, g: 0, b: 0 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// sampleWetMixDabAverage
// ---------------------------------------------------------------------------

describe("sampleWetMixDabAverage", () => {
  it("returns the flat canvas color exactly on a uniform opaque image", () => {
    const data = makeImageData(24, 24, () => BLUE);
    const avg = sampleWetMixDabAverage(data, 24, 24, { x: 11, y: 11 }, 6, 1);
    expect(avg).not.toBeNull();
    expect(avg!.r).toBeCloseTo(30, 6);
    expect(avg!.g).toBeCloseTo(60, 6);
    expect(avg!.b).toBeCloseTo(220, 6);
  });

  it("ignores fully transparent pixels so stored black does not bleed into the average", () => {
    // 왼쪽 절반 불투명 빨강, 오른쪽 절반 완전 투명(저장색 검정) — 평균은 순수 빨강이어야 한다.
    const data = makeImageData(24, 24, (x) => (x < 12 ? RED : CLEAR));
    const avg = sampleWetMixDabAverage(data, 24, 24, { x: 11.5, y: 11 }, 6, 1);
    expect(avg).not.toBeNull();
    expect(avg!.r).toBeCloseTo(255, 6);
    expect(avg!.g).toBeCloseTo(0, 6);
    expect(avg!.b).toBeCloseTo(0, 6);
  });

  it("returns null when the whole footprint is transparent or out of range", () => {
    const data = makeImageData(16, 16, () => CLEAR);
    expect(sampleWetMixDabAverage(data, 16, 16, { x: 8, y: 8 }, 5, 1)).toBeNull();
    expect(sampleWetMixDabAverage(data, 16, 16, { x: 8, y: 8 }, 0, 1)).toBeNull();
    expect(sampleWetMixDabAverage(data, 16, 16, { x: Number.NaN, y: 8 }, 5, 1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// wetMixStroke — 안료 얹기(wetness=0)
// ---------------------------------------------------------------------------

describe("wetMixStroke deposit (wetness=0)", () => {
  it("deposits the pure paint color at full strength regardless of pickup", () => {
    const data = makeImageData(24, 24, () => BLUE);
    wetMixStroke(data, 24, 24, [{ x: 12, y: 12 }], settings({ wetness: 0, pickup: 1 }));
    expect(pixelAt(data, 24, 12, 12)).toEqual([255, 0, 0, 255]);
  });

  it("lerps toward the paint color by strength on an opaque canvas", () => {
    const data = makeImageData(24, 24, () => WHITE);
    wetMixStroke(
      data, 24, 24, [{ x: 12, y: 12 }],
      settings({ strength: 0.5, paintColor: { r: 0, g: 0, b: 0 } }),
    );
    // 소스-오버(불투명 바닥) = lerp(255→0, 0.5) = 127.5 → 클램프 배열 반올림 128.
    expect(pixelAt(data, 24, 12, 12)).toEqual([128, 128, 128, 255]);
  });

  it("keeps a fully opaque canvas fully opaque (alpha never decreases)", () => {
    const data = makeImageData(24, 24, () => BLUE);
    wetMixStroke(data, 24, 24, [{ x: 4, y: 12 }, { x: 20, y: 12 }], settings({ strength: 0.6 }));
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) expect(pixelAt(data, 24, x, y)[3]).toBe(255);
    }
  });
});

// ---------------------------------------------------------------------------
// wetMixStroke — 혼색(wetness=1)
// ---------------------------------------------------------------------------

describe("wetMixStroke mixing (wetness=1)", () => {
  it("leaves a flat canvas unchanged — the deposit equals the sampled color", () => {
    const data = makeImageData(24, 24, () => BLUE);
    const before = data.slice();
    wetMixStroke(
      data, 24, 24, [{ x: 6, y: 12 }, { x: 18, y: 12 }],
      settings({ wetness: 1, pickup: 0.5 }),
    );
    expect(Array.from(data)).toEqual(Array.from(before));
  });

  it("softens a color boundary — the white side takes on the sampled mixture", () => {
    const W = 40;
    const data = makeImageData(W, 20, (x) => (x < 20 ? RED : WHITE));
    wetMixStroke(
      data, W, 20, [{ x: 12, y: 10 }, { x: 28, y: 10 }],
      settings({ radiusPx: 5, wetness: 1, pickup: 1 }),
    );
    // 경계 바로 오른쪽(원래 순백) — 도장 평균에 빨강이 섞여 g 가 255 밑으로 내려온다.
    const [r, g] = pixelAt(data, W, 21, 10);
    expect(r).toBe(255);
    expect(g).toBeLessThan(255);
    expect(g).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// wetMixStroke — 묻힘(pickup)이 앞서 지난 색을 끌고 온다
// ---------------------------------------------------------------------------

describe("wetMixStroke pickup carry", () => {
  const W = 64;
  const H = 20;
  /** 빨강(좌) → 흰색(우) 캔버스를 가로지르는 스트로크 후 (x,10) 픽셀. */
  function dragRedIntoWhite(pickup: number, x: number): [number, number, number, number] {
    const data = makeImageData(W, H, (px) => (px < 28 ? RED : WHITE));
    wetMixStroke(
      data, W, H, [{ x: 4, y: 10 }, { x: 58, y: 10 }],
      settings({ radiusPx: 4, wetness: 1, pickup }),
    );
    return pixelAt(data, W, x, 10);
  }

  it("leaves a pink trail in the white area after dragging through red", () => {
    const [r, g, b] = dragRedIntoWhite(0.45, 44);
    expect(r).toBe(255); // 빨강·흰색 모두 r=255 — 빨강기는 g/b 감소로 나타난다.
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(255);
    expect(b).toBeLessThan(255);
  });

  it("carries earlier colors farther when pickup is low (the well updates slowly)", () => {
    const gLowPickup = dragRedIntoWhite(0.15, 50)[1];
    const gHighPickup = dragRedIntoWhite(0.9, 50)[1];
    expect(gLowPickup).toBeLessThan(gHighPickup); // 낮은 묻힘율 = 빨강을 더 멀리 끌고 온다.
  });
});

// ---------------------------------------------------------------------------
// 하드니스 페더
// ---------------------------------------------------------------------------

describe("wetMixStroke hardness falloff", () => {
  it("hardness=1 stamps the full deposit inside the radius; hardness=0 feathers it", () => {
    const hard = makeImageData(24, 24, () => WHITE);
    const soft = makeImageData(24, 24, () => WHITE);
    wetMixStroke(hard, 24, 24, [{ x: 12, y: 12 }], settings({ hardness: 1 }));
    wetMixStroke(soft, 24, 24, [{ x: 12, y: 12 }], settings({ hardness: 0 }));

    // 중심에서 6px(반경 8 안쪽) — 하드는 완전 빨강, 소프트는 부분 블렌드(0 < g < 255).
    expect(pixelAt(hard, 24, 18, 12)).toEqual([255, 0, 0, 255]);
    const softG = pixelAt(soft, 24, 18, 12)[1];
    expect(softG).toBeGreaterThan(0);
    expect(softG).toBeLessThan(255);
    // 소프트도 정중앙(감쇠 1)은 완전 빨강.
    expect(pixelAt(soft, 24, 12, 12)).toEqual([255, 0, 0, 255]);
  });
});

// ---------------------------------------------------------------------------
// 투명 캔버스 — 새 안료 얹기(알파 규칙)
// ---------------------------------------------------------------------------

describe("wetMixStroke on transparent canvas", () => {
  it("lays new pigment: paint color at falloff alpha where nothing existed", () => {
    const data = makeImageData(24, 24, () => CLEAR);
    wetMixStroke(data, 24, 24, [{ x: 12, y: 12 }], settings({ hardness: 0, wetness: 0.7 }));

    // 정중앙 — 감쇠 1 → 완전 불투명 순수 안료(머금을 바닥색이 없어 deposit = paint).
    expect(pixelAt(data, 24, 12, 12)).toEqual([255, 0, 0, 255]);
    // 중심에서 6px — 감쇠 0.25 → 안료색 rgb 그대로, 알파만 부분(0 < a < 255).
    const [r, g, b, a] = pixelAt(data, 24, 18, 12);
    expect([r, g, b]).toEqual([255, 0, 0]);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(255);
    // 반경 밖은 그대로 투명.
    expect(pixelAt(data, 24, 2, 2)).toEqual([0, 0, 0, 0]);
  });

  it("only increases alpha on a semi-transparent canvas", () => {
    const data = makeImageData(24, 24, () => [30, 60, 220, 128] as const);
    wetMixStroke(data, 24, 24, [{ x: 12, y: 12 }], settings({ strength: 0.5, hardness: 0 }));
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) expect(pixelAt(data, 24, x, y)[3]).toBeGreaterThanOrEqual(128);
    }
  });
});

// ---------------------------------------------------------------------------
// 계약 — 결정성·경계 안전·같은 참조·no-op
// ---------------------------------------------------------------------------

describe("wetMixStroke contracts", () => {
  const stroke = [{ x: 5, y: 5 }, { x: 30, y: 14 }, { x: 12, y: 18 }];

  it("is deterministic — identical inputs produce byte-identical outputs", () => {
    const base = makeImageData(36, 24, (x, y) => [x * 7 % 256, y * 11 % 256, (x + y) % 256, 255]);
    const a = base.slice();
    const b = base.slice();
    const s = settings({ radiusPx: 6, hardness: 0.4, strength: 0.8, wetness: 0.6, pickup: 0.3 });
    wetMixStroke(a, 36, 24, stroke, s);
    wetMixStroke(b, 36, 24, stroke, s);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("returns the same reference and survives strokes far outside the canvas", () => {
    const data = makeImageData(16, 16, () => BLUE);
    const result = wetMixStroke(
      data, 16, 16,
      [{ x: -80, y: -80 }, { x: 96, y: 96 }],
      settings({ radiusPx: 40 }),
    );
    expect(result).toBe(data);
    expect(result.length).toBe(16 * 16 * 4);
  });

  it("no-ops (same reference, unchanged pixels) on empty points, zero strength, or empty canvas", () => {
    const data = makeImageData(16, 16, () => BLUE);
    const before = data.slice();

    expect(wetMixStroke(data, 16, 16, [], settings())).toBe(data);
    expect(wetMixStroke(data, 16, 16, stroke, settings({ strength: 0 }))).toBe(data);
    expect(wetMixStroke(data, 0, 16, stroke, settings())).toBe(data);
    expect(wetMixStroke(data, 16, -1, stroke, settings())).toBe(data);
    expect(Array.from(data)).toEqual(Array.from(before));
  });

  it("sanitizes pathological settings instead of crashing (NaN radius, out-of-range channels)", () => {
    const data = makeImageData(16, 16, () => WHITE);
    const result = wetMixStroke(
      data, 16, 16, [{ x: 8, y: 8 }],
      settings({
        radiusPx: Number.NaN,
        hardness: 5,
        wetness: -3,
        pickup: Number.POSITIVE_INFINITY,
        paintColor: { r: 999, g: -40, b: Number.NaN },
      }),
    );
    expect(result).toBe(data);
    // NaN 반경 → 최소 1px 도장, 채널은 0..255 클램프(999→255, -40→0, NaN→0).
    expect(pixelAt(data, 16, 8, 8)).toEqual([255, 0, 0, 255]);
  });
});

// ---------------------------------------------------------------------------
// applyWetMixDab — 단일 도장 합성 규칙
// ---------------------------------------------------------------------------

describe("applyWetMixDab", () => {
  it("composites source-over: transparent gets the deposit, opaque blends toward it", () => {
    const data = makeImageData(16, 16, (x) => (x < 8 ? CLEAR : WHITE));
    applyWetMixDab(data, 16, 16, { x: 7.5, y: 8 }, { r: 0, g: 200, b: 0 }, 4, 1, 0.5);

    const clearSide = pixelAt(data, 16, 6, 8);
    expect([clearSide[0], clearSide[1], clearSide[2]]).toEqual([0, 200, 0]);
    expect(clearSide[3]).toBe(128); // 0.5 × 255 반올림

    const opaqueSide = pixelAt(data, 16, 9, 8);
    expect(opaqueSide[3]).toBe(255);
    expect(opaqueSide[1]).toBeGreaterThan(200); // lerp(255→200, 0.5) ≈ 228
    expect(opaqueSide[1]).toBeLessThan(255);
  });

  it("ignores non-positive radius/strength and out-of-bounds centers", () => {
    const data = makeImageData(8, 8, () => BLUE);
    const before = data.slice();
    applyWetMixDab(data, 8, 8, { x: 4, y: 4 }, { r: 0, g: 0, b: 0 }, 0, 1, 1);
    applyWetMixDab(data, 8, 8, { x: 4, y: 4 }, { r: 0, g: 0, b: 0 }, 4, 1, 0);
    applyWetMixDab(data, 8, 8, { x: Number.NaN, y: 4 }, { r: 0, g: 0, b: 0 }, 4, 1, 1);
    expect(Array.from(data)).toEqual(Array.from(before));
  });
});
