import { describe, expect, it } from "vitest";

import {
  intersectStudioVolumeBounds,
  prepareStudioVolume,
  studioVolumeWorldRayToObject,
  type StudioVolumeGrid,
  type StudioVolumePrepared,
} from "./studio-volume-grid";
import { createStudioVolumeSampler } from "./studio-volume-sampler";
import {
  beerLambertTransmittance,
  deltaTrackingTransmittance,
  rayMarchOpticalDepth,
  rayMarchTransmittance,
  ratioTrackingTransmittance,
  studioVolumeShadowTransmittance,
} from "./studio-volume-transmittance";

const MID = (): number => 0.5;

/** 밀도가 완전히 균질한 상자 — 해석해 exp(-σd) 와 직접 대조할 수 있다. */
function homogeneousSlab(density: number, size = 1, n = 8, matrix?: number[]): StudioVolumePrepared {
  const grid: StudioVolumeGrid = {
    resolution: [n, n, n],
    density: new Float32Array(n * n * n).fill(density),
    boundsMin: [0, 0, 0],
    boundsMax: [size, size, size],
    objectToWorld: matrix ?? null,
  };
  return prepareStudioVolume(grid);
}

/** 가운데 구형 블롭만 밀도가 있는 비균질 볼륨. */
function blobVolume(n = 24): StudioVolumePrepared {
  const density = new Float32Array(n * n * n);
  for (let k = 0; k < n; k += 1) {
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const x = (i + 0.5) / n - 0.5;
        const y = (j + 0.5) / n - 0.5;
        const z = (k + 0.5) / n - 0.5;
        const r = Math.hypot(x, y, z);
        density[i + n * (j + n * k)] = r < 0.28 ? 4 * (1 - r / 0.28) : 0;
      }
    }
  }
  return prepareStudioVolume({
    resolution: [n, n, n],
    density,
    boundsMin: [0, 0, 0],
    boundsMax: [1, 1, 1],
  });
}

describe("studio-volume-transmittance · 비어–람베르트", () => {
  it("균질 슬랩의 레이 마칭 투과율이 exp(-σd) 와 상대오차 1e-12 이내로 일치한다", () => {
    const density = 2.5;
    const densityScale = 1.7;
    const prepared = homogeneousSlab(density, 1);
    const span = intersectStudioVolumeBounds(prepared, -1, 0.5, 0.5, 1, 0, 0)!;
    const distance = span.tExit - span.tEnter;
    expect(distance).toBeCloseTo(1, 12);

    const sigma = densityScale * density;
    const analytic = Math.exp(-sigma * distance);

    for (const steps of [1, 2, 7, 64, 513]) {
      const measured = rayMarchTransmittance(
        prepared,
        densityScale,
        -1,
        0.5,
        0.5,
        1,
        0,
        0,
        span.tEnter,
        span.tExit,
        steps,
        MID
      );
      expect(Math.abs(measured - analytic) / analytic).toBeLessThan(1e-12);
    }
    // 실제 수치도 명시적으로 못 박는다: exp(-4.25) = 0.0142642...
    expect(analytic).toBeCloseTo(0.014264233908999256, 15);
  });

  it("여러 광학두께에서 σ·d 를 직접 맞춘다", () => {
    for (const [density, scale, size] of [
      [1, 1, 1],
      [0.5, 0.25, 2],
      [10, 1, 0.5],
      [0.01, 3, 4],
    ]) {
      const prepared = homogeneousSlab(density, size);
      const span = intersectStudioVolumeBounds(prepared, -5, size / 2, size / 2, 1, 0, 0)!;
      const distance = span.tExit - span.tEnter;
      const tau = rayMarchOpticalDepth(
        prepared,
        scale,
        -5,
        size / 2,
        size / 2,
        1,
        0,
        0,
        span.tEnter,
        span.tExit,
        128,
        MID
      );
      // 밀도는 Float32Array 에 저장되므로 기대값도 f32 반올림을 거친 값으로 계산한다.
      const sigma = scale * Math.fround(density);
      expect(tau).toBeCloseTo(sigma * distance, 10);
      expect(Math.exp(-tau)).toBeCloseTo(beerLambertTransmittance(sigma, distance), 14);
    }
  });

  it("지터를 넣어도 균질 매질에서는 결과가 변하지 않는다(σ 가 상수라 리만 합이 정확)", () => {
    const prepared = homogeneousSlab(3, 1);
    const span = intersectStudioVolumeBounds(prepared, -1, 0.5, 0.5, 1, 0, 0)!;
    const jittered = rayMarchTransmittance(
      prepared,
      1,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      span.tEnter,
      span.tExit,
      50,
      (k) => ((k * 7919) % 1000) / 1000
    );
    expect(jittered).toBeCloseTo(Math.exp(-3), 12);
  });

  it("비스듬한 레이는 실제 현 길이만큼 감쇠한다(대각선 = √3)", () => {
    const prepared = homogeneousSlab(1, 1);
    const inv = Math.sqrt(1 / 3);
    const span = intersectStudioVolumeBounds(prepared, -1, -1, -1, inv, inv, inv)!;
    const distance = span.tExit - span.tEnter;
    expect(distance).toBeCloseTo(Math.sqrt(3), 10);
    const measured = rayMarchTransmittance(
      prepared,
      1,
      -1,
      -1,
      -1,
      inv,
      inv,
      inv,
      span.tEnter,
      span.tExit,
      256,
      MID
    );
    expect(measured).toBeCloseTo(Math.exp(-Math.sqrt(3)), 10);
  });

  it("비균등 스케일 변환에서도 t 는 월드 거리다(2배 스케일 → 광학두께 2배)", () => {
    const scale2 = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1];
    const prepared = homogeneousSlab(1, 1, 8, scale2);
    const ray = studioVolumeWorldRayToObject(prepared, -1, 1, 1, 1, 0, 0);
    const span = intersectStudioVolumeBounds(
      prepared,
      ray[0],
      ray[1],
      ray[2],
      ray[3],
      ray[4],
      ray[5]
    )!;
    const tau = rayMarchOpticalDepth(
      prepared,
      1,
      ray[0],
      ray[1],
      ray[2],
      ray[3],
      ray[4],
      ray[5],
      span.tEnter,
      span.tExit,
      256,
      MID
    );
    expect(tau).toBeCloseTo(2, 10);
    expect(Math.exp(-tau)).toBeCloseTo(Math.exp(-2), 12);
  });
});

describe("studio-volume-transmittance · 단조성과 치역", () => {
  it("레이를 따라 투과율은 단조 감소하고 [0,1] 을 벗어나지 않는다", () => {
    // 같은 스텝 격자의 접두(prefix)로 잘라 비교한다. dt 를 고정해야 구적(quadrature)이 아니라
    // 물리(σ ≥ 0 이므로 τ 단조 증가)를 검증하게 된다 — 스텝 수를 고정한 채 구간만 줄이면
    // 격자가 바뀌어 구적 오차 때문에 미세한 비단조가 생길 수 있다.
    const prepared = blobVolume();
    const steps = 120;
    const span = intersectStudioVolumeBounds(prepared, -1, 0.5, 0.5, 1, 0, 0)!;
    const dt = (span.tExit - span.tEnter) / steps;
    let previous = 1;
    for (let i = 0; i <= steps; i += 1) {
      const t =
        i === 0
          ? 1
          : rayMarchTransmittance(
              prepared,
              3,
              -1,
              0.5,
              0.5,
              1,
              0,
              0,
              span.tEnter,
              span.tEnter + i * dt,
              i,
              MID
            );
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
      // 1e-12 상대 여유는 물리가 아니라 dt 재계산((tEnd-tEnter)/i)의 부동소수 반올림 몫이다.
      expect(t).toBeLessThanOrEqual(previous * (1 + 1e-12));
      previous = t;
    }
    expect(previous).toBeLessThan(0.9);
  });

  it("광학두께가 커지면 투과율은 0 으로 수렴한다", () => {
    const prepared = homogeneousSlab(1, 1);
    let previous = 1;
    for (const scale of [1, 5, 20, 100, 500]) {
      const span = intersectStudioVolumeBounds(prepared, -1, 0.5, 0.5, 1, 0, 0)!;
      const t = rayMarchTransmittance(
        prepared,
        scale,
        -1,
        0.5,
        0.5,
        1,
        0,
        0,
        span.tEnter,
        span.tExit,
        64,
        MID
      );
      expect(t).toBeLessThan(previous);
      previous = t;
    }
    expect(previous).toBeLessThan(1e-200);
  });

  it("빈 그리드는 투과율이 정확히 1 이다", () => {
    const prepared = homogeneousSlab(0, 1);
    expect(prepared.maxDensity).toBe(0);
    const span = intersectStudioVolumeBounds(prepared, -1, 0.5, 0.5, 1, 0, 0)!;
    expect(
      rayMarchTransmittance(prepared, 1, -1, 0.5, 0.5, 1, 0, 0, span.tEnter, span.tExit, 32, MID)
    ).toBe(1);
    const sampler = createStudioVolumeSampler(1, 2);
    expect(
      ratioTrackingTransmittance(prepared, 1, -1, 0.5, 0.5, 1, 0, 0, span.tEnter, span.tExit, sampler)
    ).toBe(1);
    expect(sampler.drawn).toBe(0);
    expect(
      deltaTrackingTransmittance(prepared, 1, -1, 0.5, 0.5, 1, 0, 0, span.tEnter, span.tExit, sampler)
    ).toBe(1);
  });

  it("densityScale 0 또는 빈 구간은 투과율 1", () => {
    const prepared = homogeneousSlab(5, 1);
    expect(rayMarchTransmittance(prepared, 0, -1, 0.5, 0.5, 1, 0, 0, 0, 1, 8, MID)).toBe(1);
    expect(rayMarchTransmittance(prepared, 1, -1, 0.5, 0.5, 1, 0, 0, 1, 1, 8, MID)).toBe(1);
    expect(beerLambertTransmittance(0, 5)).toBe(1);
    expect(beerLambertTransmittance(5, 0)).toBe(1);
  });
});

describe("studio-volume-transmittance · 비율 추적 / 델타 추적", () => {
  it("비율 추적의 기댓값이 exp(-σd) 로 수렴한다(무편향)", () => {
    const prepared = homogeneousSlab(1, 1);
    const densityScale = 1;
    const span = intersectStudioVolumeBounds(prepared, -1, 0.5, 0.5, 1, 0, 0)!;
    const analytic = Math.exp(-1);

    let sum = 0;
    const trials = 40000;
    for (let i = 0; i < trials; i += 1) {
      sum += ratioTrackingTransmittance(
        prepared,
        densityScale,
        -1,
        0.5,
        0.5,
        1,
        0,
        0,
        span.tEnter,
        span.tExit,
        createStudioVolumeSampler(777, i)
      );
    }
    const mean = sum / trials;
    expect(Math.abs(mean - analytic)).toBeLessThan(0.01);
  });

  it("majorant 여유가 있으면 비율 추적 분산이 델타 추적보다 확실히 작다", () => {
    // maxDensity 10 이지만 레이가 지나는 경로 밀도는 1 → majorant 헤드룸 10배.
    const n = 8;
    const density = new Float32Array(n * n * n).fill(1);
    density[n * n * n - 1] = 10;
    const prepared = prepareStudioVolume({
      resolution: [n, n, n],
      density,
      boundsMin: [0, 0, 0],
      boundsMax: [1, 1, 1],
    });
    expect(prepared.maxDensity).toBe(10);

    const trials = 20000;
    let ratioSum = 0;
    let ratioSumSq = 0;
    let deltaSum = 0;
    let deltaSumSq = 0;
    for (let i = 0; i < trials; i += 1) {
      const r = ratioTrackingTransmittance(
        prepared,
        1,
        -1,
        0.3,
        0.3,
        1,
        0,
        0,
        0.7,
        1.7,
        createStudioVolumeSampler(31337, i)
      );
      const d = deltaTrackingTransmittance(
        prepared,
        1,
        -1,
        0.3,
        0.3,
        1,
        0,
        0,
        0.7,
        1.7,
        createStudioVolumeSampler(31337, i)
      );
      ratioSum += r;
      ratioSumSq += r * r;
      deltaSum += d;
      deltaSumSq += d * d;
    }
    const ratioMean = ratioSum / trials;
    const deltaMean = deltaSum / trials;
    const ratioVar = ratioSumSq / trials - ratioMean * ratioMean;
    const deltaVar = deltaSumSq / trials - deltaMean * deltaMean;

    // 두 추정기 모두 같은 기댓값으로 간다(둘 다 무편향).
    expect(Math.abs(ratioMean - deltaMean)).toBeLessThan(0.02);
    // 하지만 분산은 비율 추적이 훨씬 작다 — 그림자 레이 기본값으로 고른 이유.
    expect(ratioVar).toBeLessThan(deltaVar * 0.5);
    expect(deltaVar).toBeGreaterThan(0.1);
  });

  it("비율 추적 결과는 항상 [0,1] 이며 결정적이다", () => {
    const prepared = blobVolume(16);
    for (let i = 0; i < 300; i += 1) {
      const a = ratioTrackingTransmittance(
        prepared,
        6,
        -1,
        0.5,
        0.5,
        1,
        0,
        0,
        0,
        2,
        createStudioVolumeSampler(9, i)
      );
      const b = ratioTrackingTransmittance(
        prepared,
        6,
        -1,
        0.5,
        0.5,
        1,
        0,
        0,
        0,
        2,
        createStudioVolumeSampler(9, i)
      );
      expect(a).toBe(b);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it("비균질 매질에서도 비율 추적 평균이 레이 마칭 기준값과 맞는다", () => {
    const prepared = blobVolume(24);
    const densityScale = 2;
    const span = intersectStudioVolumeBounds(prepared, -1, 0.5, 0.5, 1, 0, 0)!;
    const reference = rayMarchTransmittance(
      prepared,
      densityScale,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      span.tEnter,
      span.tExit,
      8192,
      MID
    );
    let sum = 0;
    const trials = 30000;
    for (let i = 0; i < trials; i += 1) {
      sum += ratioTrackingTransmittance(
        prepared,
        densityScale,
        -1,
        0.5,
        0.5,
        1,
        0,
        0,
        span.tEnter,
        span.tExit,
        createStudioVolumeSampler(5150, i)
      );
    }
    expect(Math.abs(sum / trials - reference)).toBeLessThan(0.01);
  });

  it("볼륨을 비껴가는 그림자 레이는 투과율 1", () => {
    const prepared = blobVolume(8);
    const sampler = createStudioVolumeSampler(1, 1);
    expect(studioVolumeShadowTransmittance(prepared, 5, -1, 9, 9, 1, 0, 0, 100, sampler)).toBe(1);
  });

  it("퇴화 볼륨의 그림자 레이는 투과율 1", () => {
    const degenerate = prepareStudioVolume({
      resolution: [2, 2, 2],
      density: new Float32Array(8).fill(1),
      boundsMin: [0, 0, 0],
      boundsMax: [0, 0, 0],
    });
    const sampler = createStudioVolumeSampler(1, 1);
    expect(
      studioVolumeShadowTransmittance(degenerate, 5, 0, 0, 0, 1, 0, 0, 100, sampler)
    ).toBe(1);
  });
});
