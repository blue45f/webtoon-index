import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  STUDIO_DENOISE_ATROUS_KERNEL,
  denoiseStudioFrame,
  finishStudioDenoise,
  prepareStudioDenoiseFrame,
  runStudioDenoiseAtrousCpu,
  studioDenoiseStepWidth,
} from "./studio-denoise-atrous";
import { StudioDenoiseInputError, type StudioDenoiseFrame } from "./studio-denoise-contract";
import {
  createStudioDenoiseHighlightScene,
  createStudioDenoiseMaterialSplitScene,
  createStudioDenoiseVarianceSplitScene,
  studioDenoiseMean,
  studioDenoiseReferenceBlur,
  studioDenoiseRmse,
  studioDenoiseRmseWhere,
} from "./studio-denoise-scene-fixture";

const rgbAt = (buffer: Float32Array, width: number, x: number, y: number): number =>
  buffer[(y * width + x) * 3];

/** 세로 경계선(x = mid-1 | mid)을 가로지르는 평균 RGB 계단 크기. */
function verticalStep(buffer: Float32Array, width: number, height: number, mid: number): number {
  let sum = 0;
  for (let y = 0; y < height; y += 1) {
    const l = (y * width + (mid - 1)) * 3;
    const r = (y * width + mid) * 3;
    sum +=
      Math.abs(buffer[l] - buffer[r]) +
      Math.abs(buffer[l + 1] - buffer[r + 1]) +
      Math.abs(buffer[l + 2] - buffer[r + 2]);
  }
  return sum / height;
}

/** 지정 x 범위 내부의 평균 인접 픽셀 기울기(잔여 노이즈 척도). */
function interiorGradient(
  buffer: Float32Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
): number {
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const l = (y * width + x) * 3;
      const r = (y * width + x + 1) * 3;
      sum +=
        Math.abs(buffer[l] - buffer[r]) +
        Math.abs(buffer[l + 1] - buffer[r + 1]) +
        Math.abs(buffer[l + 2] - buffer[r + 2]);
      count += 1;
    }
  }
  return sum / Math.max(1, count);
}

function meanAbsoluteChange(
  out: Float32Array,
  input: Float32Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
): number {
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const b = (y * width + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        sum += Math.abs(out[b + c] - input[b + c]);
        count += 1;
      }
    }
  }
  return sum / Math.max(1, count);
}

describe("studio-denoise à-trous — 정답 대비 오차 감소", () => {
  it("정답이 있는 합성 씬에서 노이즈 입력보다 RMSE 가 실제로 낮아진다", () => {
    const scene = createStudioDenoiseMaterialSplitScene({
      width: 96,
      height: 96,
      seed: 12345,
      sampleCount: 16,
      noiseSigma: 1.4,
    });
    const result = denoiseStudioFrame(scene.frame);

    const noisyRmse = studioDenoiseRmse(scene.frame.color, scene.groundTruth);
    const denoisedRmse = studioDenoiseRmse(result.color, scene.groundTruth);

    // 실측: noisy 0.16404 → denoised 0.02294 (86.0% 감소). 여유를 두고 4배 이상 개선을 고정.
    expect(noisyRmse).toBeGreaterThan(0.15);
    expect(denoisedRmse).toBeLessThan(noisyRmse * 0.25);
    expect(denoisedRmse).toBeLessThan(0.03);
  });

  it("같은 지지 반경의 순수 가우시안 블러보다 오차가 낮다 (엣지 스토핑이 이득을 만든다)", () => {
    const scene = createStudioDenoiseMaterialSplitScene({
      width: 96,
      height: 96,
      seed: 2024,
      sampleCount: 16,
      noiseSigma: 1.4,
    });
    const denoised = denoiseStudioFrame(scene.frame);
    const blurred = studioDenoiseReferenceBlur(scene.frame.color, scene.width, scene.height, 4);

    const denoisedRmse = studioDenoiseRmse(denoised.color, scene.groundTruth);
    const blurRmse = studioDenoiseRmse(blurred, scene.groundTruth);
    expect(denoisedRmse).toBeLessThan(blurRmse * 0.75);
  });

  it("전체 에너지(평균 밝기)를 5% 이내로 보존한다 — log1p 도메인 편향이 유계다", () => {
    const scene = createStudioDenoiseMaterialSplitScene({
      width: 96,
      height: 96,
      seed: 4711,
      sampleCount: 16,
      noiseSigma: 1.4,
    });
    const result = denoiseStudioFrame(scene.frame);
    const truthMean = studioDenoiseMean(scene.groundTruth);
    const outMean = studioDenoiseMean(result.color);
    expect(Math.abs(outMean / truthMean - 1)).toBeLessThan(0.05);
  });

  it("levels 를 늘리면 오차가 단조 감소하다 포화한다 (레벨당 stepwidth 2배)", () => {
    const scene = createStudioDenoiseMaterialSplitScene({
      width: 64,
      height: 64,
      seed: 606,
      sampleCount: 16,
      noiseSigma: 1.4,
    });
    const errors = [0, 1, 3, 5].map((levels) =>
      studioDenoiseRmse(denoiseStudioFrame(scene.frame, { levels }).color, scene.groundTruth),
    );
    expect(errors[1]).toBeLessThan(errors[0]);
    expect(errors[2]).toBeLessThan(errors[1]);
    expect(errors[3]).toBeLessThanOrEqual(errors[2]);
    expect(studioDenoiseStepWidth(0)).toBe(1);
    expect(studioDenoiseStepWidth(4)).toBe(16);
  });

  it("B3-스플라인 커널은 정규화되어 있다", () => {
    const sum = STUDIO_DENOISE_ATROUS_KERNEL.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 12);
  });
});

describe("studio-denoise à-trous — 엣지 보존", () => {
  it("알베도·노멀·깊이 불연속을 가로질러 번지지 않는다", () => {
    const scene = createStudioDenoiseMaterialSplitScene({
      width: 96,
      height: 96,
      seed: 999,
      sampleCount: 16,
      noiseSigma: 1.4,
    });
    const denoised = denoiseStudioFrame(scene.frame);
    const blurred = studioDenoiseReferenceBlur(scene.frame.color, scene.width, scene.height, 4);
    const mid = scene.width / 2;

    const truthStep = verticalStep(scene.groundTruth, scene.width, scene.height, mid);
    const denoisedStep = verticalStep(denoised.color, scene.width, scene.height, mid);
    const blurStep = verticalStep(blurred, scene.width, scene.height, mid);

    // 실측: gt 1.4688 / denoised 1.3836 (94.2% 유지) / blur 0.2996 (20.4% 유지)
    expect(denoisedStep).toBeGreaterThan(truthStep * 0.85);
    expect(denoisedStep).toBeGreaterThan(blurStep * 3);
  });

  it("경계는 지키면서 재질 내부의 노이즈는 실제로 제거한다", () => {
    const scene = createStudioDenoiseMaterialSplitScene({
      width: 96,
      height: 96,
      seed: 999,
      sampleCount: 16,
      noiseSigma: 1.4,
    });
    const denoised = denoiseStudioFrame(scene.frame);
    const mid = scene.width / 2;

    const noisyInterior = interiorGradient(scene.frame.color, scene.width, scene.height, 5, mid - 5);
    const denoisedInterior = interiorGradient(denoised.color, scene.width, scene.height, 5, mid - 5);

    // 실측: 0.3664 → 0.0111 (33배 감소). 내부는 평탄해지고 경계만 남는다.
    expect(denoisedInterior).toBeLessThan(noisyInterior * 0.1);
  });

  it("기하 가이드를 빼면 같은 경계가 실제로 뭉개진다 (가이드가 load-bearing 임을 증명)", () => {
    const scene = createStudioDenoiseMaterialSplitScene({
      width: 96,
      height: 96,
      seed: 999,
      sampleCount: 16,
      noiseSigma: 1.4,
    });
    const mid = scene.width / 2;
    const guided = denoiseStudioFrame(scene.frame);
    const unguided = denoiseStudioFrame(
      { width: scene.width, height: scene.height, color: scene.frame.color, sampleCount: 16 },
      { useLuminanceWeight: false },
    );

    const guidedStep = verticalStep(guided.color, scene.width, scene.height, mid);
    const unguidedStep = verticalStep(unguided.color, scene.width, scene.height, mid);
    expect(guidedStep).toBeGreaterThan(unguidedStep * 3);
  });
});

describe("studio-denoise à-trous — 파이어플라이 억제", () => {
  const scene = createStudioDenoiseHighlightScene({
    width: 64,
    height: 64,
    seed: 4242,
    sampleCount: 16,
    noiseSigma: 1.2,
    fireflies: [
      { x: 8, y: 8, illumination: 320 },
      { x: 50, y: 12, illumination: 900 },
      { x: 20, y: 48, illumination: 150 },
    ],
  });
  const centerX = Math.floor(scene.width / 2);
  const centerY = Math.floor(scene.height / 2);

  it("고립된 스파이크를 제거해 배경 정답값으로 되돌린다", () => {
    const result = denoiseStudioFrame(scene.frame);
    for (const [x, y] of [
      [8, 8],
      [50, 12],
      [20, 48],
    ] as const) {
      const input = rgbAt(scene.frame.color, scene.width, x, y);
      const output = rgbAt(result.color, scene.width, x, y);
      const truth = rgbAt(scene.groundTruth, scene.width, x, y);
      expect(input).toBeGreaterThan(50); // 입력에 실제로 스파이크가 있다
      expect(output).toBeLessThan(truth * 1.5); // 배경 수준으로 회수됐다
    }
    expect(result.stats.fireflyClamped).toBeGreaterThanOrEqual(3);
  });

  it("클램프를 끄면 같은 스파이크가 그대로 살아남는다 (억제가 load-bearing)", () => {
    const off = denoiseStudioFrame(scene.frame, { firefly: { enabled: false } });
    const on = denoiseStudioFrame(scene.frame);
    const survived = rgbAt(off.color, scene.width, 8, 8);
    const suppressed = rgbAt(on.color, scene.width, 8, 8);
    expect(survived).toBeGreaterThan(50);
    expect(suppressed).toBeLessThan(survived / 1000);
  });

  it("공간적으로 응집된 진짜 하이라이트는 살아남는다", () => {
    const result = denoiseStudioFrame(scene.frame);
    const truth = rgbAt(scene.groundTruth, scene.width, centerX, centerY);
    const output = rgbAt(result.color, scene.width, centerX, centerY);
    // 실측: gt 3.60 → 3.27 (90.9% 유지). 파이어플라이와 달리 뭉개지지 않는다.
    expect(output).toBeGreaterThan(truth * 0.8);
    expect(output).toBeLessThan(truth * 1.2);

    // 하이라이트 원반 내부 평균도 유지된다(가장자리 한 픽셀만 우연히 남은 것이 아니다).
    let sum = 0;
    let truthSum = 0;
    let count = 0;
    for (let y = 0; y < scene.height; y += 1) {
      for (let x = 0; x < scene.width; x += 1) {
        if (Math.hypot(x - centerX, y - centerY) > 4) continue;
        sum += rgbAt(result.color, scene.width, x, y);
        truthSum += rgbAt(scene.groundTruth, scene.width, x, y);
        count += 1;
      }
    }
    expect(count).toBeGreaterThan(40);
    expect(sum / count).toBeGreaterThan((truthSum / count) * 0.8);
  });

  it("하이라이트 픽셀은 단 하나도 파이어플라이로 클램프되지 않는다", () => {
    const on = denoiseStudioFrame(scene.frame);
    const off = denoiseStudioFrame(scene.frame, { firefly: { enabled: false } });
    // 원반 내부에서 두 결과가 완전히 동일 = 클램프가 하이라이트를 전혀 건드리지 않았다.
    for (let y = 0; y < scene.height; y += 1) {
      for (let x = 0; x < scene.width; x += 1) {
        if (Math.hypot(x - centerX, y - centerY) > 4) continue;
        expect(rgbAt(on.color, scene.width, x, y)).toBe(rgbAt(off.color, scene.width, x, y));
      }
    }
  });

  it("스파이크가 없는 씬에서 클램프의 오탐 비용이 무시할 수준이다", () => {
    const clean = createStudioDenoiseMaterialSplitScene({
      width: 96,
      height: 96,
      seed: 12345,
      sampleCount: 16,
      noiseSigma: 1.4,
    });
    const on = denoiseStudioFrame(clean.frame);
    const off = denoiseStudioFrame(clean.frame, { firefly: { enabled: false } });
    const onRmse = studioDenoiseRmse(on.color, clean.groundTruth);
    const offRmse = studioDenoiseRmse(off.color, clean.groundTruth);
    // 실측: 0.02199 vs 0.02191 (+0.4%). 오탐은 9/9216 픽셀.
    expect(onRmse).toBeLessThan(offRmse * 1.05);
    expect(on.stats.fireflyClamped).toBeLessThan(clean.width * clean.height * 0.005);
  });
});

describe("studio-denoise à-trous — 분산 인지 동작", () => {
  const scene = createStudioDenoiseVarianceSplitScene({
    width: 64,
    height: 64,
    seed: 31337,
    sampleCount: 16,
    noiseSigma: 1.6,
  });
  const half = scene.width / 2;

  it("수렴한(저분산) 영역은 노이즈 영역보다 훨씬 덜 변한다", () => {
    const result = denoiseStudioFrame(scene.frame);
    const noisyChange = meanAbsoluteChange(
      result.color,
      scene.frame.color,
      scene.width,
      scene.height,
      0,
      half,
    );
    const convergedChange = meanAbsoluteChange(
      result.color,
      scene.frame.color,
      scene.width,
      scene.height,
      half,
      scene.width,
    );
    // 실측: 0.1274 vs 0.00068 → 188배. 정답 조명은 양쪽이 완전히 같으므로 차이는 오직 분산에서 온다.
    expect(noisyChange / convergedChange).toBeGreaterThan(50);
  });

  it("휘도(분산) 게이트를 끄면 수렴 영역이 유의미하게 더 많이 변한다", () => {
    const guided = denoiseStudioFrame(scene.frame);
    const unguided = denoiseStudioFrame(scene.frame, { useLuminanceWeight: false });
    const guidedChange = meanAbsoluteChange(
      guided.color,
      scene.frame.color,
      scene.width,
      scene.height,
      half,
      scene.width,
    );
    const unguidedChange = meanAbsoluteChange(
      unguided.color,
      scene.frame.color,
      scene.width,
      scene.height,
      half,
      scene.width,
    );
    expect(unguidedChange).toBeGreaterThan(guidedChange * 3);
  });

  it("그러면서도 노이즈 영역의 오차는 실제로 줄인다", () => {
    const result = denoiseStudioFrame(scene.frame);
    const before = studioDenoiseRmseWhere(
      scene.frame.color,
      scene.groundTruth,
      scene.width,
      scene.height,
      (x) => x < half,
    );
    const after = studioDenoiseRmseWhere(
      result.color,
      scene.groundTruth,
      scene.width,
      scene.height,
      (x) => x < half,
    );
    expect(after).toBeLessThan(before * 0.25);
  });

  it("추정 분산이 노이즈 영역에서 수렴 영역보다 크다", () => {
    const result = denoiseStudioFrame(scene.frame);
    const mean = (x0: number, x1: number): number => {
      let sum = 0;
      let count = 0;
      for (let y = 0; y < scene.height; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          sum += result.varianceInput[y * scene.width + x];
          count += 1;
        }
      }
      return sum / count;
    };
    expect(mean(0, half)).toBeGreaterThan(mean(half, scene.width) * 100);
  });

  it("누적 샘플 수가 많을수록 덜 필터링한다 (sampleCount 가 계약에서 실제로 작동)", () => {
    const base = createStudioDenoiseMaterialSplitScene({
      width: 48,
      height: 48,
      seed: 55,
      sampleCount: 16,
      noiseSigma: 1.4,
    });
    const change = (spp: number): number => {
      const out = denoiseStudioFrame({ ...base.frame, sampleCount: spp });
      let sum = 0;
      for (let i = 0; i < out.color.length; i += 1) {
        sum += Math.abs(out.color[i] - base.frame.color[i]);
      }
      return sum / out.color.length;
    };
    const low = change(4);
    const mid = change(64);
    const high = change(1024);
    expect(mid).toBeLessThanOrEqual(low);
    expect(high).toBeLessThan(mid);
    expect(high).toBeLessThan(low * 0.8);
  });
});

describe("studio-denoise à-trous — 결정성과 순수성", () => {
  const scene = createStudioDenoiseMaterialSplitScene({
    width: 32,
    height: 32,
    seed: 8,
    sampleCount: 8,
    noiseSigma: 1.4,
  });

  it("같은 입력이면 비트 동일한 출력을 낸다", () => {
    const a = denoiseStudioFrame(scene.frame);
    const b = denoiseStudioFrame(scene.frame);
    expect(Array.from(a.color)).toEqual(Array.from(b.color));
    expect(Array.from(a.variance)).toEqual(Array.from(b.variance));
  });

  it("입력 버퍼를 변형하지 않는다", () => {
    const snapshot = Float32Array.from(scene.frame.color);
    denoiseStudioFrame(scene.frame);
    expect(Array.from(scene.frame.color)).toEqual(Array.from(snapshot));
  });

  it("prepare → 필터 → finish 분해가 통짜 호출과 비트 동일하다", () => {
    const direct = denoiseStudioFrame(scene.frame);
    const prepared = prepareStudioDenoiseFrame(scene.frame);
    const filtered = runStudioDenoiseAtrousCpu(prepared);
    const composed = finishStudioDenoise(prepared, filtered, "cpu");
    // GPU 경로가 쓰는 분해 — 같은 signal 버퍼에서 같은 결과가 나와야 백엔드 패리티가 성립한다.
    expect(filtered.length).toBe(prepared.signal.length);
    expect(Array.from(composed.color)).toEqual(Array.from(direct.color));
    expect(Array.from(composed.variance)).toEqual(Array.from(direct.variance));
    expect(prepared.options.levels).toBe(5);
  });
});

describe("studio-denoise à-trous — degenerate 입력", () => {
  it("1x1 프레임을 던지지 않고 통과시킨다", () => {
    const result = denoiseStudioFrame({
      width: 1,
      height: 1,
      color: new Float32Array([1, 2, 3]),
      sampleCount: 4,
    });
    expect(Array.from(result.color)).toEqual([1, 2, 3]);
    expect(result.stats.filteredPixels).toBe(1);
  });

  it("샘플 수 0 에서도 0 나눗셈 없이 동작한다", () => {
    const result = denoiseStudioFrame({
      width: 4,
      height: 4,
      color: new Float32Array(48).fill(0.5),
      sampleCount: 0,
    });
    expect(result.color.every((v) => Number.isFinite(v))).toBe(true);
  });

  it("픽셀별 sampleCount 가 전부 0 이어도 안전하다", () => {
    const result = denoiseStudioFrame({
      width: 3,
      height: 3,
      color: new Float32Array(27).fill(1),
      sampleCount: new Uint32Array(9),
    });
    expect(result.color.every((v) => Number.isFinite(v))).toBe(true);
  });

  it("NaN/Inf/음수를 복구하고 출력에 비유한값을 남기지 않는다", () => {
    const color = new Float32Array(12).fill(0.5);
    color[0] = Number.NaN;
    color[1] = Number.POSITIVE_INFINITY;
    color[2] = Number.NEGATIVE_INFINITY;
    color[3] = -1;
    const result = denoiseStudioFrame({ width: 2, height: 2, color, sampleCount: 4 });
    expect(result.color.every((v) => Number.isFinite(v))).toBe(true);
    expect(result.stats.repairs.nonFiniteColor).toBe(3);
    expect(result.stats.repairs.negativeColor).toBe(1);
  });

  it("노멀/깊이에 NaN 이 섞여도 던지지 않는다", () => {
    const normal = new Float32Array(12);
    normal.fill(0);
    normal[0] = Number.NaN;
    const depth = new Float32Array([Number.NaN, Number.POSITIVE_INFINITY, -3, 5]);
    const result = denoiseStudioFrame({
      width: 2,
      height: 2,
      color: new Float32Array(12).fill(0.4),
      albedo: new Float32Array(12).fill(0.5),
      normal,
      depth,
      sampleCount: 2,
    });
    expect(result.color.every((v) => Number.isFinite(v))).toBe(true);
    expect(result.stats.repairs.degenerateNormal).toBe(4);
    expect(result.stats.repairs.invalidDepth).toBe(3);
    expect(result.stats.passthroughPixels).toBe(3);
  });

  it("0x0 프레임은 빈 결과를 낸다", () => {
    const result = denoiseStudioFrame({ width: 0, height: 0, color: new Float32Array(0) });
    expect(result.color.length).toBe(0);
    expect(result.stats.filteredPixels).toBe(0);
  });

  it("배경(depth<=0) 픽셀은 입력 색 그대로 통과한다", () => {
    const color = new Float32Array([9, 9, 9, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2]);
    const result = denoiseStudioFrame({
      width: 2,
      height: 2,
      color,
      depth: new Float32Array([0, 3, 3, 3]),
      sampleCount: 8,
    });
    expect(Array.from(result.color).slice(0, 3)).toEqual([9, 9, 9]);
  });

  it("버퍼 길이가 구조적으로 어긋나면 진단 가능한 오류를 던진다", () => {
    const frame: StudioDenoiseFrame = {
      width: 4,
      height: 4,
      color: new Float32Array(10),
    };
    expect(() => denoiseStudioFrame(frame)).toThrow(StudioDenoiseInputError);
    try {
      denoiseStudioFrame(frame);
    } catch (error) {
      expect((error as StudioDenoiseInputError).issues[0].code).toBe("color-length");
    }
  });
});

describe("studio-denoise — 결정성 경계 계약", () => {
  const modules = [
    "./studio-denoise-contract.ts",
    "./studio-denoise-atrous.ts",
    "./studio-denoise-temporal.ts",
    "./studio-denoise-gpu.ts",
    "./studio-denoise-scene-fixture.ts",
  ];

  it("어떤 디노이즈 모듈도 비결정적 소스를 호출하지 않는다", () => {
    for (const file of modules) {
      const code = readFileSync(new URL(file, import.meta.url), "utf8");
      // 주석에서 이름을 언급하는 것은 허용하되 실제 호출은 금지한다.
      const stripped = code.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
      expect(stripped, file).not.toMatch(/Math\.random\s*\(/u);
      expect(stripped, file).not.toMatch(/Date\.now\s*\(/u);
      expect(stripped, file).not.toMatch(/performance\.now\s*\(/u);
      expect(stripped, file).not.toMatch(/new Date\s*\(/u);
      expect(stripped, file).not.toMatch(/crypto\.(?:randomUUID|getRandomValues)/u);
    }
  });

  it("코어 디노이저는 렌더러/DOM/React 에 결합되지 않는다 (헤드리스 테스트 가능)", () => {
    const core = readFileSync(new URL("./studio-denoise-atrous.ts", import.meta.url), "utf8");
    expect(core).not.toMatch(/\b(?:Konva|React|useEffect|useState|document|window)\b/u);
    expect(core).not.toMatch(/\bGPUDevice\b/u);
    // 계약 외 모듈을 import 하지 않는다.
    const imports = [...core.matchAll(/from\s+"([^"]+)"/gu)].map((m) => m[1]);
    expect(imports).toEqual(["./studio-denoise-contract"]);
  });
});
