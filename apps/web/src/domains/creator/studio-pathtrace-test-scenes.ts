/**
 * Studio Path Tracer — 테스트 씬 픽스처 (studio-pathtrace-test-scenes)
 *
 * `.test.ts` 파일들만 import 하는 순수 씬 빌더다(앱 코드는 참조하지 않으므로 프로덕션
 * 청크에 들어가지 않는다). 시드 기반 결정적 생성만 쓰며 Math.random 은 없다.
 */

import { buildStudioPathtraceBvh } from "./studio-pathtrace-bvh";
import { studioPathtraceHash } from "./studio-pathtrace-sampler";
import {
  appendStudioPathtraceTriangles,
  createStudioPathtraceMaterial,
  createStudioPathtraceSceneBuilder,
  finalizeStudioPathtraceScene,
} from "./studio-pathtrace-scene";

import type { StudioPathtraceBvh } from "./studio-pathtrace-bvh";
import type {
  StudioPathtraceCamera,
  StudioPathtraceEnvironment,
  StudioPathtraceLight,
  StudioPathtraceMaterial,
  StudioPathtraceScene,
  StudioPathtraceSceneBuilder,
  StudioPathtraceVec3,
} from "./studio-pathtrace-scene";

/** 시드 기반 [0,1) — 테스트 픽스처 전용(엔진과 같은 해시). */
export function fixtureRandom(seed: number, index: number): number {
  return studioPathtraceHash(index, 0, 0, 0, seed) * 2.3283064365386963e-10;
}

/** 평행사변형(2 삼각형)을 빌더에 추가한다. */
export function appendQuad(
  builder: StudioPathtraceSceneBuilder,
  origin: StudioPathtraceVec3,
  edgeU: StudioPathtraceVec3,
  edgeV: StudioPathtraceVec3,
  materialIndex: number,
): void {
  const [ox, oy, oz] = origin;
  const [ux, uy, uz] = edgeU;
  const [vx, vy, vz] = edgeV;
  const positions = [
    ox,
    oy,
    oz,
    ox + ux,
    oy + uy,
    oz + uz,
    ox + ux + vx,
    oy + uy + vy,
    oz + uz + vz,
    ox + vx,
    oy + vy,
    oz + vz,
  ];
  appendStudioPathtraceTriangles(builder, positions, [0, 1, 2, 0, 2, 3], materialIndex);
}

export interface FixtureSceneInput {
  readonly materials: readonly StudioPathtraceMaterial[];
  readonly lights?: readonly StudioPathtraceLight[];
  readonly environment: StudioPathtraceEnvironment;
  readonly camera: StudioPathtraceCamera;
}

export function finalizeFixture(
  builder: StudioPathtraceSceneBuilder,
  input: FixtureSceneInput,
): { scene: StudioPathtraceScene; bvh: StudioPathtraceBvh } {
  const scene = finalizeStudioPathtraceScene(builder, {
    materials: input.materials,
    lights: input.lights ?? [],
    environment: input.environment,
    camera: input.camera,
  });
  return { scene, bvh: buildStudioPathtraceBvh(scene.positions, scene.indices) };
}

/**
 * furnace 기본형: XY 평면의 큰 quad(노멀 +z) 하나 + 균일 환경.
 * albedo 1 · ior 1(스페큘러 완전 오프)이면 수렴값이 정확히 환경 radiance 와 같아야 한다.
 */
export function createFurnaceQuadScene(
  albedo = 1,
  environmentRadiance = 1,
): { scene: StudioPathtraceScene; bvh: StudioPathtraceBvh } {
  const builder = createStudioPathtraceSceneBuilder();
  appendQuad(builder, [-10, -10, 0], [20, 0, 0], [0, 20, 0], 0);
  return finalizeFixture(builder, {
    materials: [
      createStudioPathtraceMaterial({
        baseColorLinear: [albedo, albedo, albedo],
        roughness: 1,
        metallic: 0,
        ior: 1,
      }),
    ],
    environment: { kind: "constant", radianceLinear: [environmentRadiance, environmentRadiance, environmentRadiance] },
    camera: { position: [0, 0, 3], target: [0, 0, 0], up: [0, 1, 0], fovYRadians: Math.PI / 4 },
  });
}

/** 순수 금속(F0 = baseColor) quad — GGX 단일 산란 에너지 측정용. */
export function createGgxFurnaceScene(roughness: number): {
  scene: StudioPathtraceScene;
  bvh: StudioPathtraceBvh;
} {
  const builder = createStudioPathtraceSceneBuilder();
  appendQuad(builder, [-10, -10, 0], [20, 0, 0], [0, 20, 0], 0);
  return finalizeFixture(builder, {
    materials: [
      createStudioPathtraceMaterial({
        baseColorLinear: [1, 1, 1],
        roughness,
        metallic: 1,
        ior: 1.5,
      }),
    ],
    environment: { kind: "constant", radianceLinear: [1, 1, 1] },
    camera: { position: [0, 0, 3], target: [0, 0, 0], up: [0, 1, 0], fovYRadians: Math.PI / 4 },
  });
}

/** 3면 코너(다중 반사) + 균일 환경 — RR 무편향 검증용. */
export function createFurnaceCornerScene(): {
  scene: StudioPathtraceScene;
  bvh: StudioPathtraceBvh;
} {
  const builder = createStudioPathtraceSceneBuilder();
  appendQuad(builder, [0, 0, 0], [4, 0, 0], [0, 4, 0], 0); // z = 0, 노멀 +z
  appendQuad(builder, [0, 0, 0], [0, 0, 4], [0, 4, 0], 0); // x = 0
  appendQuad(builder, [0, 0, 0], [4, 0, 0], [0, 0, 4], 0); // y = 0
  return finalizeFixture(builder, {
    materials: [
      createStudioPathtraceMaterial({
        baseColorLinear: [1, 1, 1],
        roughness: 1,
        metallic: 0,
        ior: 1,
      }),
    ],
    environment: { kind: "constant", radianceLinear: [1, 1, 1] },
    camera: { position: [3, 3, 3], target: [0.6, 0.6, 0.6], up: [0, 1, 0], fovYRadians: Math.PI / 3 },
  });
}

/** 확산 바닥 + 작은 면적 광원(환경 0) — NEE 대 naive 분산 비교용. */
export function createAreaLightScene(): {
  scene: StudioPathtraceScene;
  bvh: StudioPathtraceBvh;
} {
  const builder = createStudioPathtraceSceneBuilder();
  appendQuad(builder, [-2, 0, -2], [0, 0, 4], [4, 0, 0], 0); // 노멀 +y
  const light: StudioPathtraceLight = {
    kind: "area",
    origin: [-0.3, 2, -0.3],
    edgeU: [0.6, 0, 0],
    edgeV: [0, 0, 0.6],
    emissiveLinear: [40, 40, 40],
    twoSided: false,
  };
  return finalizeFixture(builder, {
    materials: [
      createStudioPathtraceMaterial({
        baseColorLinear: [0.7, 0.7, 0.7],
        roughness: 1,
        metallic: 0,
        ior: 1,
      }),
    ],
    lights: [light],
    environment: { kind: "constant", radianceLinear: [0, 0, 0] },
    camera: { position: [0, 1.4, 3.4], target: [0, 0.1, 0], up: [0, 1, 0], fovYRadians: Math.PI / 4 },
  });
}

/** 확산 바닥 + 포인트 광원 — 델타 광원 NEE 경로 검증용. */
export function createPointLightScene(radius = 0): {
  scene: StudioPathtraceScene;
  bvh: StudioPathtraceBvh;
} {
  const builder = createStudioPathtraceSceneBuilder();
  appendQuad(builder, [-2, 0, -2], [0, 0, 4], [4, 0, 0], 0);
  const light: StudioPathtraceLight = {
    kind: "point",
    positionWorld: [0, 2, 0],
    intensityLinear: [8, 8, 8],
    radius,
  };
  return finalizeFixture(builder, {
    materials: [
      createStudioPathtraceMaterial({
        baseColorLinear: [0.8, 0.8, 0.8],
        roughness: 1,
        metallic: 0,
        ior: 1,
      }),
    ],
    lights: [light],
    environment: { kind: "constant", radianceLinear: [0, 0, 0] },
    camera: { position: [0, 1.4, 3.4], target: [0, 0.1, 0], up: [0, 1, 0], fovYRadians: Math.PI / 4 },
  });
}

/** 시드 기반 랜덤 삼각형 수프 — BVH 대 brute-force 대조용. */
export function createRandomTriangleSoup(
  seed: number,
  triangleCount: number,
): { positions: Float32Array; indices: Uint32Array } {
  const positions = new Float32Array(triangleCount * 9);
  const indices = new Uint32Array(triangleCount * 3);
  for (let t = 0; t < triangleCount; t += 1) {
    const cx = fixtureRandom(seed, t * 7 + 1) * 8 - 4;
    const cy = fixtureRandom(seed, t * 7 + 2) * 8 - 4;
    const cz = fixtureRandom(seed, t * 7 + 3) * 8 - 4;
    for (let v = 0; v < 3; v += 1) {
      positions[t * 9 + v * 3] = cx + fixtureRandom(seed, t * 7 + 4 + v) * 1.2 - 0.6;
      positions[t * 9 + v * 3 + 1] = cy + fixtureRandom(seed, t * 31 + v * 3 + 11) * 1.2 - 0.6;
      positions[t * 9 + v * 3 + 2] = cz + fixtureRandom(seed, t * 53 + v * 3 + 17) * 1.2 - 0.6;
    }
    indices[t * 3] = t * 3;
    indices[t * 3 + 1] = t * 3 + 1;
    indices[t * 3 + 2] = t * 3 + 2;
  }
  return { positions, indices };
}

/**
 * 공유 edge 를 갖는 격자 메시(watertight 검증용).
 * `cells × cells` 사각형을 각각 2 삼각형으로 쪼개고 정점을 공유한다 —
 * 인접 삼각형이 같은 edge 를 서로 다르게 판정하면 레이가 격자를 그대로 통과한다.
 */
export function createSharedEdgeGrid(cells: number): {
  positions: Float32Array;
  indices: Uint32Array;
} {
  const side = cells + 1;
  const positions = new Float32Array(side * side * 3);
  for (let j = 0; j < side; j += 1) {
    for (let i = 0; i < side; i += 1) {
      const k = (j * side + i) * 3;
      // 격자를 살짝 비틀어 축 정렬 edge 와 사선 edge 를 모두 만든다.
      positions[k] = i / cells - 0.5;
      positions[k + 1] = j / cells - 0.5;
      positions[k + 2] = 0.08 * Math.sin(i * 1.7) * Math.cos(j * 2.3);
    }
  }
  const indices = new Uint32Array(cells * cells * 6);
  let w = 0;
  for (let j = 0; j < cells; j += 1) {
    for (let i = 0; i < cells; i += 1) {
      const a = j * side + i;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      indices[w] = a;
      indices[w + 1] = b;
      indices[w + 2] = d;
      indices[w + 3] = a;
      indices[w + 4] = d;
      indices[w + 5] = c;
      w += 6;
    }
  }
  return { positions, indices };
}
