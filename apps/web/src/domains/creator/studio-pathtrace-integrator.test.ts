import { describe, expect, it } from "vitest";

import { buildStudioPathtraceBvh } from "./studio-pathtrace-bvh";
import { createStudioPathtraceRay } from "./studio-pathtrace-geometry";
import {
  createStudioPathtraceContext,
  evalStudioPathtraceEnvironment,
  generateStudioPathtraceCameraRay,
  studioPathtracePowerHeuristic,
  traceStudioPathtraceRadiance,
} from "./studio-pathtrace-integrator";
import {
  createStudioPathtraceMaterial,
  createStudioPathtraceSceneBuilder,
  finalizeStudioPathtraceScene,
} from "./studio-pathtrace-scene";
import {
  appendQuad,
  createAreaLightScene,
  createFurnaceCornerScene,
  createFurnaceQuadScene,
  createPointLightScene,
} from "./studio-pathtrace-test-scenes";

import type { StudioPathtraceIntegratorOptions } from "./studio-pathtrace-integrator";

interface Moments {
  mean: number;
  variance: number;
  count: number;
  stderr: number;
}

function collect(
  ctx: ReturnType<typeof createStudioPathtraceContext>,
  pixels: number,
  samplesPerPixel: number,
): Moments {
  const out = new Float64Array(3);
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let p = 0; p < pixels; p += 1) {
    for (let s = 0; s < samplesPerPixel; s += 1) {
      traceStudioPathtraceRadiance(ctx, p, s, out);
      sum += out[0];
      sumSq += out[0] * out[0];
      count += 1;
    }
  }
  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  return { mean, variance, count, stderr: Math.sqrt(variance / count) };
}

describe("환경 평가", () => {
  it("constant 는 방향과 무관하게 같은 radiance 를 준다", () => {
    const out = [0, 0, 0];
    evalStudioPathtraceEnvironment({ kind: "constant", radianceLinear: [0.2, 0.4, 0.6] }, 0, 1, 0, out);
    expect([out[0], out[1], out[2]]).toEqual([0.2, 0.4, 0.6]);
    evalStudioPathtraceEnvironment({ kind: "constant", radianceLinear: [0.2, 0.4, 0.6] }, 1, 0, 0, out);
    expect([out[0], out[1], out[2]]).toEqual([0.2, 0.4, 0.6]);
  });

  it("gradient 는 +y 에서 zenith, -y 에서 horizon, 수평에서 중간값이다", () => {
    const env = {
      kind: "gradient" as const,
      zenithLinear: [0, 0, 1] as const,
      horizonLinear: [1, 0, 0] as const,
    };
    const out = [0, 0, 0];
    evalStudioPathtraceEnvironment(env, 0, 1, 0, out);
    expect([out[0], out[2]]).toEqual([0, 1]);
    evalStudioPathtraceEnvironment(env, 0, -1, 0, out);
    expect([out[0], out[2]]).toEqual([1, 0]);
    evalStudioPathtraceEnvironment(env, 1, 0, 0, out);
    expect(out[0]).toBeCloseTo(0.5, 12);
    expect(out[2]).toBeCloseTo(0.5, 12);
  });
});

describe("power heuristic", () => {
  it("β=2 공식이 맞고 대칭 가중치의 합이 1 이다", () => {
    expect(studioPathtracePowerHeuristic(2, 1)).toBeCloseTo(4 / 5, 12);
    expect(studioPathtracePowerHeuristic(1, 2)).toBeCloseTo(1 / 5, 12);
    expect(studioPathtracePowerHeuristic(3, 4) + studioPathtracePowerHeuristic(4, 3)).toBeCloseTo(1, 12);
    expect(studioPathtracePowerHeuristic(0, 0)).toBe(0);
    expect(studioPathtracePowerHeuristic(5, 0)).toBe(1);
  });
});

describe("카메라 레이", () => {
  it("중심 픽셀 레이가 타깃을 향하고 종횡비가 반영된다", () => {
    const { scene, bvh } = createFurnaceQuadScene();
    const ctx = createStudioPathtraceContext({
      scene,
      bvh,
      width: 65,
      height: 65,
      options: { samplesPerPixel: 1, seed: 1 },
    });
    const ray = createStudioPathtraceRay();
    generateStudioPathtraceCameraRay(ctx, 32 * 65 + 32, 0, ray);
    // 중심 픽셀 안의 지터라 방향이 카메라 forward(0,0,-1) 에서 1픽셀 각도 이내여야 한다.
    expect(ray.dz).toBeLessThan(-0.999);
    expect(Math.abs(ray.dx)).toBeLessThan(0.02);
    expect(Math.abs(ray.dy)).toBeLessThan(0.02);
    expect(Math.abs(Math.hypot(ray.dx, ray.dy, ray.dz) - 1)).toBeLessThan(1e-12);

    const wide = createStudioPathtraceContext({
      scene,
      bvh,
      width: 128,
      height: 64,
      options: { samplesPerPixel: 1, seed: 1 },
    });
    const left = createStudioPathtraceRay();
    const top = createStudioPathtraceRay();
    generateStudioPathtraceCameraRay(wide, 32 * 128 + 0, 0, left);
    generateStudioPathtraceCameraRay(wide, 0 * 128 + 64, 0, top);
    // aspect = 2 라 가로 화각이 세로보다 넓다.
    expect(Math.abs(left.dx)).toBeGreaterThan(Math.abs(top.dy));
    expect(left.dx).toBeLessThan(0);
    expect(top.dy).toBeGreaterThan(0);
  });
});

describe("furnace — 에너지 보존", () => {
  const options: Partial<StudioPathtraceIntegratorOptions> = {
    mode: "nee-mis",
    maxBounces: 4,
    russianRoulette: true,
    rrStartBounce: 3,
    seed: 4242,
    samplesPerPixel: 16,
  };

  it("단일 quad · albedo 1 · 환경 1 은 샘플마다 정확히 1 이다", () => {
    const { scene, bvh } = createFurnaceQuadScene(1, 1);
    const ctx = createStudioPathtraceContext({ scene, bvh, width: 8, height: 8, options });
    const out = new Float64Array(3);
    for (let p = 0; p < 64; p += 1) {
      for (let s = 0; s < 16; s += 1) {
        traceStudioPathtraceRadiance(ctx, p, s, out);
        expect(Math.abs(out[0] - 1), `pixel ${p} sample ${s}`).toBeLessThan(1e-9);
        expect(Math.abs(out[1] - 1)).toBeLessThan(1e-9);
        expect(Math.abs(out[2] - 1)).toBeLessThan(1e-9);
      }
    }
  });

  it("albedo 0.5 는 정확히 (0.5 + 0.5·환경) 이 아니라 0.5·환경 + ... — 단일 반사라 0.5 다", () => {
    const { scene, bvh } = createFurnaceQuadScene(0.5, 1);
    const ctx = createStudioPathtraceContext({ scene, bvh, width: 4, height: 4, options });
    const out = new Float64Array(3);
    traceStudioPathtraceRadiance(ctx, 5, 0, out);
    expect(Math.abs(out[0] - 0.5)).toBeLessThan(1e-9);
  });

  it("3면 코너(다중 반사) 는 RR on/off 모두 1.0 으로 수렴한다", () => {
    const { scene, bvh } = createFurnaceCornerScene();
    const base: Partial<StudioPathtraceIntegratorOptions> = {
      mode: "nee-mis",
      maxBounces: 24,
      rrStartBounce: 3,
      seed: 777,
      samplesPerPixel: 1024,
    };
    const withRr = createStudioPathtraceContext({
      scene,
      bvh,
      width: 4,
      height: 4,
      options: { ...base, russianRoulette: true },
    });
    const withoutRr = createStudioPathtraceContext({
      scene,
      bvh,
      width: 4,
      height: 4,
      options: { ...base, russianRoulette: false },
    });
    const a = collect(withRr, 16, 1024);
    const b = collect(withoutRr, 16, 1024);

    // RR 이 없으면 albedo 1 · 환경 1 이라 **모든 경로가 정확히 1** 을 돌려준다
    // (throughput 이 바운스마다 정확히 albedo=1 로 유지되고 결국 환경 1 을 만난다).
    // maxBounces=24 안에서 탈출하지 못한 경로가 하나라도 있으면 평균이 1 아래로 떨어진다.
    expect(Math.abs(b.mean - 1), `RR-off 평균 ${b.mean}`).toBeLessThan(1e-9);
    expect(b.variance).toBeLessThan(1e-18);
    // RR 은 무편향이지만 분산이 생긴다. 허용오차는 이론 표준오차의 4배로 잡는다.
    const tolerance = Math.max(0.005, 4 * a.stderr);
    expect(Math.abs(a.mean - 1), `RR 평균 ${a.mean} (stderr ${a.stderr})`).toBeLessThan(tolerance);
    // RR 이 실제로 분산을 만들었는지(= 켜져 있는지) 확인 — 공허한 통과 방지.
    expect(a.variance).toBeGreaterThan(b.variance);
  });
});

describe("NEE 정확도", () => {
  it("포인트 광원 직접광이 해석해와 일치한다", () => {
    // 바닥 quad(노멀 +y) 바로 위 2m 에 광도 8 인 포인트 광원.
    // L = (albedo/π) · I / d² · cosθ = (0.8/π)·8/4·1
    const builder = createStudioPathtraceSceneBuilder();
    appendQuad(builder, [-2, 0, -2], [0, 0, 4], [4, 0, 0], 0);
    const scene = finalizeStudioPathtraceScene(builder, {
      materials: [
        createStudioPathtraceMaterial({
          baseColorLinear: [0.8, 0.8, 0.8],
          roughness: 1,
          metallic: 0,
          ior: 1,
        }),
      ],
      lights: [{ kind: "point", positionWorld: [0, 2, 0], intensityLinear: [8, 8, 8], radius: 0 }],
      environment: { kind: "constant", radianceLinear: [0, 0, 0] },
      // 좁은 화각으로 원점을 정면에서 내려다본다 → 모든 지터가 사실상 (0,0,0) 을 맞춘다.
      camera: { position: [0, 3, 0], target: [0, 0, 0], up: [0, 0, 1], fovYRadians: 0.002 },
    });
    const bvh = buildStudioPathtraceBvh(scene.positions, scene.indices);
    const ctx = createStudioPathtraceContext({
      scene,
      bvh,
      width: 1,
      height: 1,
      options: {
        mode: "nee-mis",
        maxBounces: 1,
        russianRoulette: false,
        seed: 99,
        samplesPerPixel: 256,
      },
    });
    const moments = collect(ctx, 1, 256);
    const expected = (0.8 / Math.PI) * (8 / 4);
    // 남는 편차는 자기 교차 방지 오프셋(STUDIO_PATHTRACE_RAY_EPSILON = 1e-4)만큼
    // 광원과 가까워져 생기는 1/d² 이득이다 → 상대오차 ~1e-4. 그 이상은 실제 버그다.
    const relative = moments.mean / expected - 1;
    expect(relative, `상대오차 ${relative}`).toBeGreaterThan(0);
    expect(relative).toBeLessThan(3e-4);
    // 델타 광원 + 고정 기하라 분산이 사실상 0 이어야 한다.
    expect(moments.variance).toBeLessThan(1e-10);
  });

  it("소프트 섀도(radius > 0)는 그림자 경계를 부드럽게 하되 평균을 크게 바꾸지 않는다", () => {
    const hard = createPointLightScene(0);
    const soft = createPointLightScene(0.4);
    const opts: Partial<StudioPathtraceIntegratorOptions> = {
      mode: "nee-mis",
      maxBounces: 1,
      russianRoulette: false,
      seed: 31,
      samplesPerPixel: 64,
    };
    const hardCtx = createStudioPathtraceContext({ ...hard, width: 8, height: 8, options: opts });
    const softCtx = createStudioPathtraceContext({ ...soft, width: 8, height: 8, options: opts });
    const a = collect(hardCtx, 64, 64);
    const b = collect(softCtx, 64, 64);
    expect(a.mean).toBeGreaterThan(0.05);
    expect(Math.abs(a.mean - b.mean) / a.mean).toBeLessThan(0.05);
  });
});

describe("NEE 대 naive-bsdf", () => {
  it("NEE 는 분산을 두 자릿수 줄이면서 같은 값으로 수렴한다", () => {
    const scene = createAreaLightScene();
    const base: Partial<StudioPathtraceIntegratorOptions> = {
      maxBounces: 1,
      russianRoulette: false,
      seed: 20260724,
    };
    const nee = collect(
      createStudioPathtraceContext({
        ...scene,
        width: 8,
        height: 8,
        options: { ...base, mode: "nee-mis", samplesPerPixel: 1024 },
      }),
      64,
      1024,
    );
    // naive 추정기는 꼬리가 매우 두꺼워(작은 광원을 우연히 맞출 때만 값이 튄다) CLT 기반
    // 표준오차가 실제 흩어짐을 과소평가한다. 평균 비교가 의미 있으려면 샘플이 많아야 한다.
    const naive = collect(
      createStudioPathtraceContext({
        ...scene,
        width: 8,
        height: 8,
        options: { ...base, mode: "naive-bsdf", samplesPerPixel: 16384 },
      }),
      64,
      16384,
    );

    expect(nee.mean).toBeGreaterThan(0.01);
    expect(naive.mean).toBeGreaterThan(0.01);
    expect(naive.variance).toBeGreaterThan(0);
    expect(nee.variance).toBeGreaterThan(0);

    // 1) 둘 다 무편향 → 결합 표준오차 4배 안에서 일치. (실측 0.1σ)
    const combined = Math.hypot(nee.stderr, naive.stderr);
    expect(Math.abs(nee.mean - naive.mean), `nee=${nee.mean} naive=${naive.mean} se=${combined}`)
      .toBeLessThan(4 * combined);

    // 2) 샘플당 분산은 spp 와 무관한 추정기 고유값이다. 실측 비 ≈ 117배.
    const ratio = naive.variance / nee.variance;
    expect(ratio, `분산비 naive/nee = ${ratio}`).toBeGreaterThan(20);
  });
});

describe("결정성", () => {
  it("같은 (pixel, sample, seed) 는 항상 같은 radiance 를 준다", () => {
    const { scene, bvh } = createAreaLightScene();
    const ctx = createStudioPathtraceContext({
      scene,
      bvh,
      width: 16,
      height: 16,
      options: { seed: 5, samplesPerPixel: 16, maxBounces: 3 },
    });
    const a = new Float64Array(3);
    const b = new Float64Array(3);
    for (let p = 0; p < 256; p += 7) {
      for (let s = 0; s < 16; s += 3) {
        traceStudioPathtraceRadiance(ctx, p, s, a);
        traceStudioPathtraceRadiance(ctx, p, s, b);
        expect([b[0], b[1], b[2]]).toEqual([a[0], a[1], a[2]]);
      }
    }
  });

  it("픽셀을 어떤 순서로 순회해도 같은 값이 나온다", () => {
    const { scene, bvh } = createAreaLightScene();
    const ctx = createStudioPathtraceContext({
      scene,
      bvh,
      width: 8,
      height: 8,
      options: { seed: 6, samplesPerPixel: 8, maxBounces: 3 },
    });
    const forward = new Map<string, number>();
    const out = new Float64Array(3);
    for (let p = 0; p < 64; p += 1) {
      for (let s = 0; s < 8; s += 1) {
        traceStudioPathtraceRadiance(ctx, p, s, out);
        forward.set(`${p}:${s}`, out[0]);
      }
    }
    for (let p = 63; p >= 0; p -= 1) {
      for (let s = 7; s >= 0; s -= 1) {
        traceStudioPathtraceRadiance(ctx, p, s, out);
        expect(out[0]).toBe(forward.get(`${p}:${s}`));
      }
    }
  });

  it("시드를 바꾸면 값이 달라진다(시드가 실제로 쓰인다)", () => {
    const { scene, bvh } = createAreaLightScene();
    const make = (seed: number) =>
      createStudioPathtraceContext({
        scene,
        bvh,
        width: 8,
        height: 8,
        options: { seed, samplesPerPixel: 8, maxBounces: 3 },
      });
    const a = new Float64Array(3);
    const b = new Float64Array(3);
    let different = 0;
    for (let p = 0; p < 64; p += 1) {
      traceStudioPathtraceRadiance(make(1), p, 0, a);
      traceStudioPathtraceRadiance(make(2), p, 0, b);
      if (a[0] !== b[0]) different += 1;
    }
    expect(different).toBeGreaterThan(32);
  });
});
