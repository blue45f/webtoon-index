import { describe, expect, it } from "vitest";

import { denoiseStudioFrame } from "./studio-denoise-atrous";
import { sanitizeStudioDenoiseFrame, type StudioDenoiseFrame } from "./studio-denoise-contract";
import {
  createStudioDenoiseGaussian,
  createStudioDenoiseMaterialSplitScene,
  studioDenoiseRmse,
} from "./studio-denoise-scene-fixture";
import {
  accumulateStudioDenoiseTemporal,
  createStudioDenoiseHistory,
  type StudioDenoiseHistory,
} from "./studio-denoise-temporal";

function flatFrame(
  width: number,
  height: number,
  value: number,
  depthValue = 4,
): StudioDenoiseFrame {
  const pixels = width * height;
  const color = new Float32Array(pixels * 3).fill(value);
  const normal = new Float32Array(pixels * 3);
  for (let p = 0; p < pixels; p += 1) normal[p * 3 + 2] = 1;
  return {
    width,
    height,
    color,
    normal,
    depth: new Float32Array(pixels).fill(depthValue),
  };
}

describe("studio-denoise 시간 누적 — 프로그레시브 평균", () => {
  it("항등 리프로젝션에서 정확한 누적 평균이 된다", () => {
    let history = createStudioDenoiseHistory(2, 2);
    const values = [1, 2, 3, 4, 5];
    for (const v of values) {
      history = accumulateStudioDenoiseTemporal(history, flatFrame(2, 2, v)).history;
    }
    // 1..5 의 평균 = 3
    expect(history.color[0]).toBeCloseTo(3, 6);
    expect(history.historyLength[0]).toBe(5);
  });

  it("minAlpha 를 주면 지수 이동 평균으로 전환되어 최신 프레임에 더 가중한다", () => {
    let exact = createStudioDenoiseHistory(1, 1);
    let ema = createStudioDenoiseHistory(1, 1);
    for (let i = 0; i < 20; i += 1) {
      const frame = flatFrame(1, 1, i < 19 ? 0 : 10);
      exact = accumulateStudioDenoiseTemporal(exact, frame).history;
      ema = accumulateStudioDenoiseTemporal(ema, frame, { minAlpha: 0.2 }).history;
    }
    expect(exact.color[0]).toBeCloseTo(0.5, 6); // 10/20
    expect(ema.color[0]).toBeCloseTo(2, 6); // 0 + 0.2*(10-0)
    expect(ema.color[0]).toBeGreaterThan(exact.color[0]);
  });

  it("모멘트로 계산한 분산이 실제 표본 분산과 일치한다", () => {
    let history = createStudioDenoiseHistory(1, 1);
    const samples = [0.2, 0.8, 0.5, 1.1, 0.4, 0.6];
    let last: StudioDenoiseFrame | null = null;
    for (const v of samples) {
      const step = accumulateStudioDenoiseTemporal(history, flatFrame(1, 1, v));
      history = step.history;
      last = step.frame;
    }
    const sanitized = sanitizeStudioDenoiseFrame(last as StudioDenoiseFrame);

    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const expectedSampleVariance =
      samples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / samples.length;
    // sanitize 는 표본분산을 샘플 수로 나눈 "평균의 분산"을 만든다.
    expect(sanitized.momentVariance?.[0]).toBeCloseTo(expectedSampleVariance / samples.length, 5);
  });

  it("누적된 프레임을 공간 디노이저에 넣으면 sampleCount 로 히스토리 길이가 전달된다", () => {
    let history = createStudioDenoiseHistory(2, 2);
    let step = accumulateStudioDenoiseTemporal(history, flatFrame(2, 2, 0.5));
    history = step.history;
    step = accumulateStudioDenoiseTemporal(history, flatFrame(2, 2, 0.7));
    expect(step.frame.sampleCount).toBe(step.history.historyLength);
    expect(Array.from(step.history.historyLength)).toEqual([2, 2, 2, 2]);
    expect(() => denoiseStudioFrame(step.frame)).not.toThrow();
  });
});

describe("studio-denoise 시간 누적 — 히스토리 기각", () => {
  it("노멀이 크게 바뀌면 히스토리를 버리고 다시 센다", () => {
    let history = createStudioDenoiseHistory(1, 1);
    history = accumulateStudioDenoiseTemporal(history, flatFrame(1, 1, 1)).history;
    expect(history.historyLength[0]).toBe(1);

    const flipped = flatFrame(1, 1, 5);
    flipped.normal?.set([1, 0, 0]);
    const step = accumulateStudioDenoiseTemporal(history, flipped);
    expect(step.rejected).toBe(1);
    expect(step.history.historyLength[0]).toBe(1);
    expect(step.history.color[0]).toBe(5); // 이전 값과 섞이지 않는다
  });

  it("깊이가 임계 이상 튀면(디스오클루전) 히스토리를 버린다", () => {
    let history = createStudioDenoiseHistory(1, 1);
    history = accumulateStudioDenoiseTemporal(history, flatFrame(1, 1, 1, 4)).history;
    const step = accumulateStudioDenoiseTemporal(history, flatFrame(1, 1, 9, 20));
    expect(step.rejected).toBe(1);
    expect(step.history.color[0]).toBe(9);
  });

  it("깊이가 임계 이내로 흔들리면 히스토리를 유지한다", () => {
    let history = createStudioDenoiseHistory(1, 1);
    history = accumulateStudioDenoiseTemporal(history, flatFrame(1, 1, 1, 4)).history;
    const step = accumulateStudioDenoiseTemporal(history, flatFrame(1, 1, 3, 4.1));
    expect(step.rejected).toBe(0);
    expect(step.history.color[0]).toBeCloseTo(2, 6);
  });

  it("reprojection = -1 이면 그 픽셀은 디스오클루전으로 리셋된다", () => {
    let history = createStudioDenoiseHistory(2, 1);
    history = accumulateStudioDenoiseTemporal(history, flatFrame(2, 1, 1)).history;
    const step = accumulateStudioDenoiseTemporal(history, flatFrame(2, 1, 7), {
      reprojection: new Int32Array([-1, 0]),
    });
    expect(step.disoccluded).toBe(1);
    expect(step.history.color[0]).toBe(7); // 리셋
    expect(step.history.color[3]).toBeCloseTo(4, 6); // 유지 (1과 7의 평균)
  });

  it("리프로젝션으로 이웃 픽셀의 히스토리를 끌어올 수 있다", () => {
    let history = createStudioDenoiseHistory(2, 1);
    const first = flatFrame(2, 1, 0);
    first.color[0] = 10;
    first.color[1] = 10;
    first.color[2] = 10;
    history = accumulateStudioDenoiseTemporal(history, first).history;

    const second = flatFrame(2, 1, 0);
    // 픽셀 1 이 이전 프레임의 픽셀 0 에서 왔다고 알려준다.
    const step = accumulateStudioDenoiseTemporal(history, second, {
      reprojection: new Int32Array([-1, 0]),
    });
    expect(step.history.color[3]).toBeCloseTo(5, 6); // (10 + 0) / 2
  });

  it("해상도가 바뀌면 전체 히스토리를 버린다", () => {
    let history = createStudioDenoiseHistory(2, 2);
    history = accumulateStudioDenoiseTemporal(history, flatFrame(2, 2, 4)).history;
    const step = accumulateStudioDenoiseTemporal(history, flatFrame(3, 3, 9));
    expect(step.disoccluded).toBe(9);
    expect(step.history.width).toBe(3);
    expect(Array.from(step.history.historyLength)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("입력 히스토리를 변형하지 않는다", () => {
    const history = createStudioDenoiseHistory(2, 2);
    const before = Array.from(history.color);
    accumulateStudioDenoiseTemporal(history, flatFrame(2, 2, 3));
    expect(Array.from(history.color)).toEqual(before);
  });

  it("NaN 색이 섞여도 히스토리를 오염시키지 않는다", () => {
    const frame = flatFrame(1, 1, 1);
    frame.color[0] = Number.NaN;
    const step = accumulateStudioDenoiseTemporal(createStudioDenoiseHistory(1, 1), frame);
    expect(step.history.color.every((v) => Number.isFinite(v))).toBe(true);
    expect(step.history.momentLuma.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe("studio-denoise 시간 누적 — 품질 기여", () => {
  it("여러 프레임을 누적하면 오차가 줄고, 모멘트 분산이 공간 디노이저를 안내한다", () => {
    const width = 48;
    const height = 48;
    const base = createStudioDenoiseMaterialSplitScene({
      width,
      height,
      seed: 2,
      sampleCount: 4,
      noiseSigma: 1.2,
    });
    const gaussian = createStudioDenoiseGaussian(9001);

    // 같은 정답에 서로 다른 시드 노이즈를 얹은 8 프레임을 누적한다.
    let history: StudioDenoiseHistory = createStudioDenoiseHistory(width, height);
    let accumulated = base.frame;
    for (let f = 0; f < 8; f += 1) {
      const color = new Float32Array(base.groundTruth.length);
      for (let p = 0; p < width * height; p += 1) {
        const sigma = 0.35;
        const noise = Math.exp(sigma * gaussian() - (sigma * sigma) / 2);
        for (let c = 0; c < 3; c += 1) color[p * 3 + c] = base.groundTruth[p * 3 + c] * noise;
      }
      const step = accumulateStudioDenoiseTemporal(history, {
        ...base.frame,
        color,
      });
      history = step.history;
      accumulated = step.frame;
    }

    const accumulatedRmse = studioDenoiseRmse(accumulated.color, base.groundTruth);
    const singleFrameRmse = studioDenoiseRmse(base.frame.color, base.groundTruth);
    expect(accumulatedRmse).toBeLessThan(singleFrameRmse);

    // 모멘트 경로로 디노이즈하면 누적본보다도 오차가 더 낮아진다.
    const denoised = denoiseStudioFrame(accumulated);
    expect(studioDenoiseRmse(denoised.color, base.groundTruth)).toBeLessThan(accumulatedRmse);

    // 모멘트가 실제로 쓰였는지: 분산 추정이 0 이 아니다.
    expect(denoised.varianceInput.some((v) => v > 0)).toBe(true);
  });

  it("결정적이다 — 같은 시퀀스는 같은 히스토리를 만든다", () => {
    const run = (): number[] => {
      let history = createStudioDenoiseHistory(3, 3);
      for (const v of [0.1, 0.9, 0.4, 0.7]) {
        history = accumulateStudioDenoiseTemporal(history, flatFrame(3, 3, v)).history;
      }
      return Array.from(history.color);
    };
    expect(run()).toEqual(run());
  });
});
