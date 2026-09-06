/**
 * NEE 다중 광원 회귀 — 광원 선택 확률(1/N) 보정 계약.
 *
 * 기존 해석해 테스트는 광원이 **하나뿐인** 씬만 다뤄서, 델타(포인트) 광원 경로에
 * 1/N 선택 확률의 역수가 빠진 버그를 잡지 못했다(N=1 에서는 보정 계수가 1 이라
 * 증상이 사라진다). 여기서는 같은 총 광량을 여러 광원으로 쪼개도 수렴값이 보존되는지
 * 확인한다 — 쪼갠 개수만큼 어두워지면 실패한다.
 */
import { describe, expect, it } from "vitest";

import { buildStudioPathtraceBvh } from "./studio-pathtrace-bvh";
import {
  createStudioPathtraceContext,
  traceStudioPathtraceRadiance,
} from "./studio-pathtrace-integrator";
import {
  createStudioPathtraceMaterial,
  createStudioPathtraceSceneBuilder,
  finalizeStudioPathtraceScene,
} from "./studio-pathtrace-scene";
import { appendQuad } from "./studio-pathtrace-test-scenes";
import { STUDIO_PATHTRACE_WGSL } from "./studio-pathtrace-wgsl";

import type { StudioPathtraceLight } from "./studio-pathtrace-scene";

/**
 * 바닥 quad(노멀 +y)를 좁은 화각으로 내려다보는 고정 씬. 광원 목록만 바꿔가며
 * 같은 해석해를 재현한다: L = (albedo/π)·I_total/d²·cosθ.
 */
function meanRadiance(lights: readonly StudioPathtraceLight[], samples: number): number {
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
    lights,
    environment: { kind: "constant", radianceLinear: [0, 0, 0] },
    camera: { position: [0, 3, 0], target: [0, 0, 0], up: [0, 0, 1], fovYRadians: 0.002 },
  });
  const ctx = createStudioPathtraceContext({
    scene,
    bvh: buildStudioPathtraceBvh(scene.positions, scene.indices),
    width: 1,
    height: 1,
    options: {
      mode: "nee-mis",
      maxBounces: 1,
      russianRoulette: false,
      seed: 99,
      samplesPerPixel: samples,
    },
  });
  const out = new Float64Array(3);
  let sum = 0;
  for (let s = 0; s < samples; s += 1) {
    traceStudioPathtraceRadiance(ctx, 0, s, out);
    sum += out[0];
  }
  return sum / samples;
}

const POINT_AT_2M = (intensity: number): StudioPathtraceLight => ({
  kind: "point",
  positionWorld: [0, 2, 0],
  intensityLinear: [intensity, intensity, intensity],
  radius: 0,
});

/** 광원과 무관한 방향(바닥 아래)을 보는 면적 광원 — 기하 기여 0, 개수만 늘린다. */
const DOWNWARD_AREA_LIGHT: StudioPathtraceLight = {
  kind: "area",
  origin: [-0.3, -3, -0.3],
  edgeU: [0.6, 0, 0],
  edgeV: [0, 0, 0.6],
  emissiveLinear: [0, 0, 0],
  twoSided: false,
};

describe("NEE 광원 선택 확률 보정", () => {
  const expected = (0.8 / Math.PI) * (8 / 4);

  it("포인트 광원 1개는 해석해와 일치한다", () => {
    const mean = meanRadiance([POINT_AT_2M(8)], 256);
    const relative = mean / expected - 1;
    expect(relative, `상대오차 ${relative}`).toBeGreaterThan(0);
    expect(relative).toBeLessThan(3e-4);
  });

  it("같은 위치의 포인트 광원 2개로 쪼개도 총 radiance 가 보존된다", () => {
    const mean = meanRadiance([POINT_AT_2M(4), POINT_AT_2M(4)], 8192);
    // 보정이 빠지면 정확히 1/2 이 나온다(실측). 통계 오차 여유 2%.
    expect(Math.abs(mean / expected - 1), `평균 ${mean} / 기대 ${expected}`).toBeLessThan(0.02);
  });

  it("4개로 쪼개도, 기여 없는 광원을 섞어도 총 radiance 가 보존된다", () => {
    const four = meanRadiance([POINT_AT_2M(2), POINT_AT_2M(2), POINT_AT_2M(2), POINT_AT_2M(2)], 16384);
    expect(Math.abs(four / expected - 1), `4분할 평균 ${four}`).toBeLessThan(0.03);

    // 기여가 0 인 광원이 섞여도(선택 확률만 희석) 평균은 그대로여야 한다.
    const mixed = meanRadiance([POINT_AT_2M(8), DOWNWARD_AREA_LIGHT], 8192);
    expect(Math.abs(mixed / expected - 1), `혼합 평균 ${mixed}`).toBeLessThan(0.03);
  });

  it("WGSL 커널도 같은 보정을 담고 있다(백엔드 드리프트 방지)", () => {
    expect(STUDIO_PATHTRACE_WGSL).toContain("geom = f32(pt_u.lightCount) / (dist * dist);");
    expect(STUDIO_PATHTRACE_WGSL).not.toContain("geom = 1.0 / (dist * dist);");
  });
});
