import { describe, expect, it } from "vitest";

import {
  applyDodgeBurnDab,
  dodgeBurnBrushFalloff,
  dodgeBurnStroke,
  dodgeBurnTonalWeight,
  type DodgeBurnPixelPoint,
  type DodgeBurnSettings,
} from "./studio-dodge-burn";
import { rgbToHsl } from "./studio-selective-hsl";

// ---------------------------------------------------------------------------
// 테스트 픽스처 — studio-smudge.test.ts 의 makeImageData 와 동일 기법(좌표 색상 함수 → RGBA 버퍼).
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

function pixelAt(data: Uint8ClampedArray, w: number, x: number, y: number): [number, number, number, number] {
  const idx = (y * w + x) * 4;
  return [data[idx]!, data[idx + 1]!, data[idx + 2]!, data[idx + 3]!];
}

function settings(overrides: Partial<DodgeBurnSettings> = {}): DodgeBurnSettings {
  return {
    radiusPx: 6,
    hardness: 1,
    exposure: 100,
    mode: "dodge",
    range: "midtones",
    sponge: "saturate",
    ...overrides,
  };
}

const W = 21;
const H = 21;
const CX = 10;
const CY = 10;

/** 단색 이미지에 도장 1개를 중앙에 찍고 중앙 픽셀을 반환한다. */
function dabOnFlat(
  color: readonly [number, number, number, number],
  s: DodgeBurnSettings,
): { data: Uint8ClampedArray; center: [number, number, number, number] } {
  const data = makeImageData(W, H, () => color);
  applyDodgeBurnDab(data, W, H, { x: CX, y: CY }, s);
  return { data, center: pixelAt(data, W, CX, CY) };
}

// ---------------------------------------------------------------------------
// dodgeBurnTonalWeight
// ---------------------------------------------------------------------------

describe("dodgeBurnTonalWeight", () => {
  it("midtones weight peaks at L=0.5 and decays toward both ends", () => {
    expect(dodgeBurnTonalWeight(0.5, "midtones")).toBe(1);
    expect(dodgeBurnTonalWeight(0.1, "midtones")).toBeLessThan(dodgeBurnTonalWeight(0.3, "midtones"));
    expect(dodgeBurnTonalWeight(0.9, "midtones")).toBeLessThan(dodgeBurnTonalWeight(0.7, "midtones"));
  });

  it("shadows favors dark tones and highlights favors bright tones", () => {
    expect(dodgeBurnTonalWeight(0.1, "shadows")).toBeGreaterThan(dodgeBurnTonalWeight(0.5, "shadows"));
    expect(dodgeBurnTonalWeight(0.5, "shadows")).toBeGreaterThan(dodgeBurnTonalWeight(0.9, "shadows"));
    expect(dodgeBurnTonalWeight(0.9, "highlights")).toBeGreaterThan(dodgeBurnTonalWeight(0.5, "highlights"));
    expect(dodgeBurnTonalWeight(0.5, "highlights")).toBeGreaterThan(dodgeBurnTonalWeight(0.1, "highlights"));
  });
});

// ---------------------------------------------------------------------------
// dodgeBurnBrushFalloff
// ---------------------------------------------------------------------------

describe("dodgeBurnBrushFalloff", () => {
  it("is 1 at the center and 0 beyond the radius", () => {
    expect(dodgeBurnBrushFalloff(0, 10, 0.5)).toBe(1);
    expect(dodgeBurnBrushFalloff(11, 10, 0.5)).toBe(0);
  });

  it("hardness=1 keeps full strength up to the radius; hardness=0 feathers from the center", () => {
    expect(dodgeBurnBrushFalloff(9.9, 10, 1)).toBe(1);
    expect(dodgeBurnBrushFalloff(5, 10, 0)).toBeCloseTo(0.5, 5);
    expect(dodgeBurnBrushFalloff(10, 10, 0)).toBeCloseTo(0, 5);
  });

  it("is monotonically non-increasing as distance grows", () => {
    const distances = [0, 2, 4, 6, 8, 9.9];
    const weights = distances.map((d) => dodgeBurnBrushFalloff(d, 10, 0.3));
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]!).toBeLessThanOrEqual(weights[i - 1]!);
    }
  });
});

// ---------------------------------------------------------------------------
// applyDodgeBurnDab — 닷지/번
// ---------------------------------------------------------------------------

describe("applyDodgeBurnDab (dodge/burn)", () => {
  const MID_GRAY: [number, number, number, number] = [128, 128, 128, 255];
  const DARK_GRAY: [number, number, number, number] = [30, 30, 30, 255];

  it("dodge lightens, and with range=midtones lightens midtones more than shadows", () => {
    const s = settings({ mode: "dodge", range: "midtones" });
    const mid = dabOnFlat(MID_GRAY, s);
    const dark = dabOnFlat(DARK_GRAY, s);

    const midDelta = mid.center[0] - MID_GRAY[0];
    const darkDelta = dark.center[0] - DARK_GRAY[0];
    expect(midDelta).toBeGreaterThan(0);
    expect(darkDelta).toBeGreaterThan(0);
    expect(midDelta).toBeGreaterThan(darkDelta);
    // 무채색 유지(색조 발명 없음) + 알파 보존.
    expect(mid.center[0]).toBe(mid.center[1]);
    expect(mid.center[1]).toBe(mid.center[2]);
    expect(mid.center[3]).toBe(255);
  });

  it("burn darkens midtones and never overshoots below 0", () => {
    const s = settings({ mode: "burn", range: "midtones" });
    const mid = dabOnFlat(MID_GRAY, s);
    expect(mid.center[0]).toBeLessThan(MID_GRAY[0]);
    expect(mid.center[0]).toBeGreaterThanOrEqual(0);

    const black = dabOnFlat([0, 0, 0, 255], s);
    expect(black.center).toEqual([0, 0, 0, 255]); // L=0 은 번으로 더 어두워질 수 없다.
  });

  it("range=shadows moves dark pixels more than bright pixels", () => {
    const s = settings({ mode: "dodge", range: "shadows" });
    const dark = dabOnFlat(DARK_GRAY, s);
    const bright = dabOnFlat([225, 225, 225, 255], s);
    expect(dark.center[0] - DARK_GRAY[0]).toBeGreaterThan(bright.center[0] - 225);
  });

  it("preserves hue on colored pixels (dodge only lifts lightness)", () => {
    const RED: [number, number, number, number] = [180, 60, 60, 255];
    const { center } = dabOnFlat(RED, settings({ mode: "dodge", range: "midtones" }));
    const before = rgbToHsl(RED[0], RED[1], RED[2]);
    const after = rgbToHsl(center[0], center[1], center[2]);
    expect(after.l).toBeGreaterThan(before.l);
    expect(Math.abs(after.h - before.h)).toBeLessThan(2); // 반올림 오차 이내 — 색조 보존.
  });

  it("fully transparent pixels are skipped and alpha is never modified", () => {
    const data = makeImageData(W, H, (x) => (x < CX ? [128, 128, 128, 255] : [40, 40, 40, 0]));
    const before = data.slice();
    applyDodgeBurnDab(data, W, H, { x: CX, y: CY }, settings({ mode: "dodge" }));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        expect(data[idx + 3]).toBe(before[idx + 3]); // 알파 보존
        if (before[idx + 3] === 0) {
          expect(pixelAt(data, W, x, y)).toEqual(pixelAt(before, W, x, y)); // 투명 픽셀 무변화
        }
      }
    }
  });

  it("soft brush (hardness=0) affects a mid-radius pixel less than a hard brush", () => {
    const MID: [number, number, number, number] = [128, 128, 128, 255];
    const hard = dabOnFlat(MID, settings({ mode: "dodge", radiusPx: 8, hardness: 1 }));
    const soft = dabOnFlat(MID, settings({ mode: "dodge", radiusPx: 8, hardness: 0 }));
    const probeX = CX + 6; // dist=6 < radius=8
    const hardDelta = pixelAt(hard.data, W, probeX, CY)[0] - MID[0];
    const softDelta = pixelAt(soft.data, W, probeX, CY)[0] - MID[0];
    expect(hardDelta).toBeGreaterThan(0);
    expect(softDelta).toBeGreaterThan(0);
    expect(softDelta).toBeLessThan(hardDelta);
    // 소프트 브러시는 중심이 가장자리보다 강하다.
    expect(soft.center[0] - MID[0]).toBeGreaterThan(softDelta);
  });

  it("pixels outside the radius are untouched", () => {
    const MID: [number, number, number, number] = [128, 128, 128, 255];
    const { data } = dabOnFlat(MID, settings({ mode: "dodge", radiusPx: 4 }));
    expect(pixelAt(data, W, CX + 5, CY)).toEqual(MID);
    expect(pixelAt(data, W, 0, 0)).toEqual(MID);
  });
});

// ---------------------------------------------------------------------------
// applyDodgeBurnDab — 스펀지
// ---------------------------------------------------------------------------

describe("applyDodgeBurnDab (sponge)", () => {
  const MUTED_RED: [number, number, number, number] = [180, 90, 90, 255];

  function saturationAt(data: Uint8ClampedArray, x: number, y: number): number {
    const [r, g, b] = pixelAt(data, W, x, y);
    return rgbToHsl(r, g, b).s;
  }

  it("saturate raises saturation monotonically across repeated dabs (clamped at 1)", () => {
    const data = makeImageData(W, H, () => MUTED_RED);
    const s = settings({ mode: "sponge", sponge: "saturate" });
    let prev = saturationAt(data, CX, CY);
    for (let i = 0; i < 8; i++) {
      applyDodgeBurnDab(data, W, H, { x: CX, y: CY }, s);
      const next = saturationAt(data, CX, CY);
      expect(next).toBeGreaterThanOrEqual(prev);
      expect(next).toBeLessThanOrEqual(1);
      prev = next;
    }
    expect(prev).toBeGreaterThan(rgbToHsl(MUTED_RED[0], MUTED_RED[1], MUTED_RED[2]).s);
  });

  it("desaturate lowers saturation monotonically toward 0", () => {
    const data = makeImageData(W, H, () => MUTED_RED);
    const s = settings({ mode: "sponge", sponge: "desaturate" });
    let prev = saturationAt(data, CX, CY);
    for (let i = 0; i < 8; i++) {
      applyDodgeBurnDab(data, W, H, { x: CX, y: CY }, s);
      const next = saturationAt(data, CX, CY);
      expect(next).toBeLessThanOrEqual(prev);
      expect(next).toBeGreaterThanOrEqual(0);
      prev = next;
    }
    expect(prev).toBeLessThan(rgbToHsl(MUTED_RED[0], MUTED_RED[1], MUTED_RED[2]).s);
  });

  it("gray pixels are protected — saturate must not invent a hue", () => {
    const GRAY: [number, number, number, number] = [128, 128, 128, 255];
    const { center } = dabOnFlat(GRAY, settings({ mode: "sponge", sponge: "saturate" }));
    expect(center).toEqual(GRAY);
  });
});

// ---------------------------------------------------------------------------
// dodgeBurnStroke
// ---------------------------------------------------------------------------

describe("dodgeBurnStroke", () => {
  const MID: [number, number, number, number] = [128, 128, 128, 255];

  it("empty points returns the input unchanged (same reference)", () => {
    const data = makeImageData(W, H, () => MID);
    const result = dodgeBurnStroke(data, W, H, [], settings());
    expect(result).toBe(data);
    expect(pixelAt(data, W, CX, CY)).toEqual(MID);
  });

  it("exposure <= 0 returns the input unchanged (same reference)", () => {
    const data = makeImageData(W, H, () => MID);
    const before = data.slice();
    const result = dodgeBurnStroke(data, W, H, [{ x: CX, y: CY }], settings({ exposure: 0 }));
    expect(result).toBe(data);
    expect(data).toEqual(before);
  });

  it("a single point (tap) applies exactly one dab", () => {
    const stroke = makeImageData(W, H, () => MID);
    const single = makeImageData(W, H, () => MID);
    dodgeBurnStroke(stroke, W, H, [{ x: CX, y: CY }], settings());
    applyDodgeBurnDab(single, W, H, { x: CX, y: CY }, settings());
    expect(stroke).toEqual(single);
    expect(pixelAt(stroke, W, CX, CY)[0]).toBeGreaterThan(MID[0]);
  });

  it("a dragged stroke lightens along the path and leaves far pixels untouched", () => {
    const data = makeImageData(W, H, () => MID);
    const points: DodgeBurnPixelPoint[] = [
      { x: 3, y: CY },
      { x: 17, y: CY },
    ];
    dodgeBurnStroke(data, W, H, points, settings({ radiusPx: 3 }));
    expect(pixelAt(data, W, 10, CY)[0]).toBeGreaterThan(MID[0]); // 경로 위
    expect(pixelAt(data, W, 10, CY + 8)).toEqual(MID); // 반경 밖
  });

  it("is deterministic — identical inputs produce identical outputs", () => {
    const patterned = (x: number, y: number): readonly [number, number, number, number] => [
      (x * 13 + y * 7) % 256,
      (x * 5 + y * 11) % 256,
      (x * 3 + y * 17) % 256,
      255,
    ];
    const a = makeImageData(W, H, patterned);
    const b = makeImageData(W, H, patterned);
    const points: DodgeBurnPixelPoint[] = [
      { x: 2, y: 3 },
      { x: 12, y: 9 },
      { x: 18, y: 15 },
    ];
    const s = settings({ mode: "burn", range: "highlights", hardness: 0.3, exposure: 70 });
    dodgeBurnStroke(a, W, H, points, s);
    dodgeBurnStroke(b, W, H, points, s);
    expect(a).toEqual(b);
  });

  it("a stroke crossing image bounds does not crash and keeps every channel in 0..255", () => {
    const data = makeImageData(W, H, (x, y) => [x * 10, y * 9, 120, 255]);
    const points: DodgeBurnPixelPoint[] = [
      { x: -5, y: -5 },
      { x: 3, y: 4 },
      { x: W + 6, y: H + 6 },
    ];
    expect(() => dodgeBurnStroke(data, W, H, points, settings({ radiusPx: 5 }))).not.toThrow();
    for (let i = 0; i < data.length; i++) {
      expect(Number.isFinite(data[i])).toBe(true);
      expect(data[i]!).toBeGreaterThanOrEqual(0);
      expect(data[i]!).toBeLessThanOrEqual(255);
    }
  });
});
