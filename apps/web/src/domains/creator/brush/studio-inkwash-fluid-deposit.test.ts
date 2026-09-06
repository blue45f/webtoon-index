import { describe, expect, it } from "vitest";

import {
  createStudioInkwashFluidSession,
  depositStudioInkwashFluidStroke,
} from "./studio-inkwash-fluid";

/**
 * 침착은 **점 개수에 불변**이어야 한다.
 *
 * 문서는 점당 시간을 저장하지 않아서 replay 가 타임스탬프를 만들어 낸다(`index * 고정간격`).
 * 예전에는 그 합성 시간에서 속도를 유도했기 때문에 "속도"가 손의 빠르기가 아니라 점이 얼마나
 * 촘촘히 남았는지를 재고 있었다. 직선 획은 커밋되면서 2점으로 단순화되므로 한 구간의 거리가
 * 획 전체가 되고, 감쇠가 획을 시작점 한 방울로 눌러 버렸다 —
 * 391px 수묵 세필 직선이 커밋 후 52px 얼룩 하나로 남았다.
 */

const WIDTH = 420;
const HEIGHT = 60;

function polyline(pointCount: number): Array<{
  x: number;
  y: number;
  pressure: number;
  timeMs: number;
}> {
  return Array.from({ length: pointCount }, (_, index) => {
    const amount = pointCount === 1 ? 0 : index / (pointCount - 1);
    return {
      x: 30 + 360 * amount,
      y: 30,
      pressure: 0.55,
      // 두 생산자(라이브 오버레이와 커밋 플래너)가 실제로 쓰는 합성 타임스탬프.
      timeMs: index * (1_000 / 240),
    };
  });
}

function depositAt(pointCount: number): Float32Array {
  const session = createStudioInkwashFluidSession({ width: WIDTH, height: HEIGHT });
  depositStudioInkwashFluidStroke(session, {
    tool: "pen",
    samples: polyline(pointCount),
    radius: 12,
    pigmentLoad: 0.82,
    wetnessLoad: 1,
    inkColor: { r: 0.06, g: 0.06, b: 0.08 },
  });
  return session.fluid.pigment.slice();
}

/** 획 진행 방향으로 자른 열별 최대 안료. 마크가 어디까지 그려졌는지 본다. */
function columnPeaks(pigment: Float32Array): number[] {
  const peaks = new Array<number>(WIDTH).fill(0);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const base = (y * WIDTH + x) * 4;
      const density = pigment[base]! + pigment[base + 1]! + pigment[base + 2]!;
      if (density > peaks[x]!) peaks[x] = density;
    }
  }
  return peaks;
}

describe("depositStudioInkwashFluidStroke", () => {
  it("lays the same mark whether the polyline kept 2 points or 33", () => {
    const sparse = columnPeaks(depositAt(2));
    const dense = columnPeaks(depositAt(33));

    for (let x = 0; x < WIDTH; x += 1) {
      expect(Math.abs(sparse[x]! - dense[x]!)).toBeLessThan(1e-6);
    }
  });

  it("covers the whole stroke instead of collapsing onto the first sample", () => {
    const peaks = columnPeaks(depositAt(2));
    const strongest = Math.max(...peaks);
    expect(strongest).toBeGreaterThan(0);

    // 시작(x≈30)과 끝(x≈390) 모두 최대 농도의 의미 있는 비율을 가져야 한다. 붕괴한 획은
    // 시작만 남고 끝이 0 이었다.
    const nearStart = Math.max(...peaks.slice(30, 60));
    const nearEnd = Math.max(...peaks.slice(360, 390));
    expect(nearStart / strongest).toBeGreaterThan(0.35);
    expect(nearEnd / strongest).toBeGreaterThan(0.35);
  });

  it("still thins where the artist genuinely sped up mid-stroke", () => {
    const session = createStudioInkwashFluidSession({ width: WIDTH, height: HEIGHT });
    // 앞 절반은 촘촘하고 뒤 절반은 성기다 — 같은 획 안에서 손이 빨라진 경우.
    const samples = [
      ...Array.from({ length: 17 }, (_, index) => ({
        x: 30 + index * 6,
        y: 30,
        pressure: 0.55,
        timeMs: index * (1_000 / 240),
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        x: 132 + (index + 1) * 60,
        y: 30,
        pressure: 0.55,
        timeMs: (17 + index) * (1_000 / 240),
      })),
    ];
    depositStudioInkwashFluidStroke(session, {
      tool: "pen",
      samples,
      radius: 12,
      pigmentLoad: 0.82,
      wetnessLoad: 1,
      inkColor: { r: 0.06, g: 0.06, b: 0.08 },
    });
    const peaks = columnPeaks(session.fluid.pigment);
    const slowHalf = Math.max(...peaks.slice(60, 120));
    const fastHalf = Math.max(...peaks.slice(240, 300));
    expect(slowHalf).toBeGreaterThan(0);
    expect(fastHalf).toBeGreaterThan(0);
    expect(fastHalf).toBeLessThan(slowHalf);
  });
});
