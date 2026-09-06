/**
 * Studio Volume — 디바이스 심(device seam) · GPU 디스패치 플랜
 *
 * 렌더 호출부는 `StudioVolumeBackend` 만 안다. 백엔드는 두 가지다:
 *
 *   · CPU 참조 백엔드 — 호출자가 작업 전에 명시적으로 선택하는 정확성 기준이다.
 *   · GPU 백엔드 — 주입된 `StudioVolumeGpuRuntime` 에 **디스패치 플랜**(WGSL + 패킹된 uniform +
 *     스토리지 버퍼들)을 넘긴다. 미지원/실패 시 같은 작업을 CPU 로 다시 실행하지 않는다.
 *
 * 이 심 덕분에 node 테스트에서 WebGPU 없이도 GPU 경로의 **계약**(uniform 바이트 레이아웃, 워크그룹
 * 개수, 실패 격리, 출력 디코딩)을 전부 검증할 수 있다. 실제 WebGPU 어댑터 구현은 이 모듈 밖에
 * 있으며, `dispatch()` 하나만 채우면 된다.
 *
 * ── GPU 경로가 fail-closed 하는 미지원 조건 ───────────────────────────────
 *   · samplesPerPixel > 1  — 셰이더는 픽셀 중심 1샘플만 쏜다(누적은 상위 레이어 몫).
 *   · backgroundDistance   — 픽셀별 깊이 클립 버퍼를 아직 바인딩하지 않는다.
 *   · 퇴화 볼륨 / 광원 0개 — 디스패치할 가치가 없다.
 */

import { studioVolumeCameraBasis, renderStudioVolume } from "./studio-volume-render";
import {
  STUDIO_VOLUME_BINDINGS,
  STUDIO_VOLUME_ENTRY_POINT,
  STUDIO_VOLUME_UNIFORM_BYTES,
  STUDIO_VOLUME_UNIFORM_OFFSETS,
  STUDIO_VOLUME_WGSL,
  STUDIO_VOLUME_WORKGROUP_X,
  STUDIO_VOLUME_WORKGROUP_Y,
} from "./studio-volume-wgsl";

import type { StudioVolumePrepared } from "./studio-volume-grid";
import type { StudioVolumeOccupancy } from "./studio-volume-occupancy";
import type { StudioVolumeMarchParams, StudioVolumeScene } from "./studio-volume-raymarch";
import type {
  StudioVolumeCamera,
  StudioVolumeImage,
  StudioVolumeRenderOptions,
} from "./studio-volume-render";

export interface StudioVolumeRenderRequest {
  readonly prepared: StudioVolumePrepared;
  readonly scene: StudioVolumeScene;
  readonly march: StudioVolumeMarchParams;
  readonly occupancy: StudioVolumeOccupancy | null;
  readonly camera: StudioVolumeCamera;
  readonly options: StudioVolumeRenderOptions;
  /** CPU 가 미리 구운 방출 LUT(studio-volume-emission). 없으면 GPU 경로는 방출을 0 으로 둔다. */
  readonly emissionLut?: Float32Array | null;
}

export interface StudioVolumeGpuDispatchPlan {
  readonly wgsl: string;
  readonly entryPoint: string;
  readonly bindings: typeof STUDIO_VOLUME_BINDINGS;
  readonly workgroupCount: readonly [number, number, number];
  /** 336바이트 uniform 블록(리틀 엔디안). */
  readonly uniforms: ArrayBuffer;
  readonly density: Float32Array;
  /** 온도가 없어도 길이 1 더미를 보낸다 — 길이 0 스토리지 버퍼는 WebGPU 에서 금지다. */
  readonly temperature: Float32Array;
  readonly occupancy: Float32Array;
  readonly emissionLut: Float32Array;
  readonly lights: Float32Array;
  readonly outputFloatLength: number;
  readonly width: number;
  readonly height: number;
}

/** 주입 심 — 실제 WebGPU 어댑터가 이 하나만 구현하면 된다. */
export interface StudioVolumeGpuRuntime {
  readonly label?: string;
  /** 플랜을 실행하고 픽셀당 8 float([rgba, T, depth, expectedDepth, steps])을 돌려준다. */
  dispatch(plan: StudioVolumeGpuDispatchPlan): Promise<Float32Array>;
}

export interface StudioVolumeBackend {
  readonly kind: "cpu" | "gpu";
  render(request: StudioVolumeRenderRequest): Promise<StudioVolumeImage>;
}

export type StudioVolumeGpuBackendErrorCode =
  | "runtime-unavailable"
  | "unsupported-request"
  | "dispatch-failed"
  | "invalid-output";

export class StudioVolumeGpuBackendError extends Error {
  constructor(
    readonly code: StudioVolumeGpuBackendErrorCode,
    options?: ErrorOptions,
  ) {
    super(`studio-volume-gpu:${code}`, options);
    this.name = "StudioVolumeGpuBackendError";
  }
}

const EMPTY_FLOATS = new Float32Array(1);

function writeVec4f(
  view: DataView,
  offset: number,
  x: number,
  y: number,
  z: number,
  w: number
): void {
  view.setFloat32(offset, x, true);
  view.setFloat32(offset + 4, y, true);
  view.setFloat32(offset + 8, z, true);
  view.setFloat32(offset + 12, w, true);
}

function writeVec4u(
  view: DataView,
  offset: number,
  x: number,
  y: number,
  z: number,
  w: number
): void {
  view.setUint32(offset, x >>> 0, true);
  view.setUint32(offset + 4, y >>> 0, true);
  view.setUint32(offset + 8, z >>> 0, true);
  view.setUint32(offset + 12, w >>> 0, true);
}

/**
 * 광원 배열을 스토리지 버퍼로 패킹한다.
 *   slot0 = (position | -direction 원본, kindFlag)   kindFlag: 0 = point, 1 = directional
 *   slot1 = (color * intensity, inverseSquare ? 1 : 0)
 */
export function packStudioVolumeLights(scene: StudioVolumeScene): Float32Array {
  const lights = scene.lights;
  if (lights.length === 0) return new Float32Array(8);
  const out = new Float32Array(lights.length * 8);
  for (let i = 0; i < lights.length; i += 1) {
    const light = lights[i];
    const base = i * 8;
    if (light.kind === "directional") {
      out[base] = light.direction[0];
      out[base + 1] = light.direction[1];
      out[base + 2] = light.direction[2];
      out[base + 3] = 1;
      out[base + 7] = 0;
    } else {
      out[base] = light.position[0];
      out[base + 1] = light.position[1];
      out[base + 2] = light.position[2];
      out[base + 3] = 0;
      out[base + 7] = light.inverseSquare === false ? 0 : 1;
    }
    out[base + 4] = light.color[0] * light.intensity;
    out[base + 5] = light.color[1] * light.intensity;
    out[base + 6] = light.color[2] * light.intensity;
  }
  return out;
}

/** uniform 블록 패킹. 오프셋은 STUDIO_VOLUME_UNIFORM_OFFSETS 표를 그대로 따른다. */
export function packStudioVolumeUniforms(request: StudioVolumeRenderRequest): ArrayBuffer {
  const buffer = new ArrayBuffer(STUDIO_VOLUME_UNIFORM_BYTES);
  const view = new DataView(buffer);
  const o = STUDIO_VOLUME_UNIFORM_OFFSETS;
  const { prepared, scene, march, occupancy, camera, options } = request;

  for (let i = 0; i < 16; i += 1) {
    view.setFloat32(o.worldToObject + i * 4, prepared.worldToObject[i], true);
  }

  const basis = studioVolumeCameraBasis(camera);
  writeVec4f(view, o.cameraOrigin, camera.origin[0], camera.origin[1], camera.origin[2], 0);
  writeVec4f(view, o.cameraRight, basis[0], basis[1], basis[2], 0);
  writeVec4f(view, o.cameraUp, basis[3], basis[4], basis[5], 0);
  writeVec4f(view, o.cameraForward, basis[6], basis[7], basis[8], 0);

  writeVec4f(view, o.boundsMin, prepared.boundsMin[0], prepared.boundsMin[1], prepared.boundsMin[2], 0);
  writeVec4f(view, o.boundsMax, prepared.boundsMax[0], prepared.boundsMax[1], prepared.boundsMax[2], 0);
  writeVec4f(
    view,
    o.invCellSize,
    prepared.invCellSize[0],
    prepared.invCellSize[1],
    prepared.invCellSize[2],
    0
  );

  writeVec4u(
    view,
    o.resolution,
    prepared.resolution[0],
    prepared.resolution[1],
    prepared.resolution[2],
    prepared.voxelCount
  );

  const dims = occupancy?.dims ?? [0, 0, 0];
  writeVec4u(view, o.blockDims, dims[0], dims[1], dims[2], occupancy?.blockSize ?? 0);
  const extent = occupancy?.blockExtent ?? [1, 1, 1];
  writeVec4f(view, o.blockExtent, extent[0] || 1, extent[1] || 1, extent[2] || 1, 0);

  const medium = scene.medium;
  writeVec4f(
    view,
    o.medium,
    medium.densityScale,
    medium.scatteringAlbedo,
    medium.anisotropy,
    medium.emissionScale
  );

  const tanHalf = Math.tan(camera.fovY * 0.5);
  writeVec4f(
    view,
    o.march,
    march.stepSize,
    tanHalf,
    march.transmittanceCutoff,
    occupancy?.threshold ?? 0
  );

  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  writeVec4u(view, o.image, width, height, march.maxSteps, march.seed);

  const lutSize = request.emissionLut ? request.emissionLut.length >> 2 : 0;
  writeVec4u(
    view,
    o.flags,
    scene.lights.length,
    march.useOccupancy && occupancy && occupancy.totalBlocks > 0 ? 1 : 0,
    lutSize,
    march.shadowMode === "ratio-tracking" ? 1 : 0
  );

  const emission = medium.emission;
  writeVec4f(view, o.emission, emission.ignitionK, emission.referenceK, emission.maxK, emission.exponent);
  writeVec4f(
    view,
    o.emissionRamp,
    emission.rampK,
    march.depthAlphaThreshold,
    march.jitter,
    prepared.maxDensity
  );

  const ambient = medium.ambientRadiance;
  writeVec4f(view, o.ambient, ambient[0], ambient[1], ambient[2], 0);
  return buffer;
}

/** WGSL + 버퍼 + 워크그룹 개수를 한 덩어리로 묶는다. */
export function buildStudioVolumeDispatchPlan(
  request: StudioVolumeRenderRequest
): StudioVolumeGpuDispatchPlan {
  const width = Math.max(1, Math.floor(request.options.width));
  const height = Math.max(1, Math.floor(request.options.height));
  return {
    wgsl: STUDIO_VOLUME_WGSL,
    entryPoint: STUDIO_VOLUME_ENTRY_POINT,
    bindings: STUDIO_VOLUME_BINDINGS,
    workgroupCount: [
      Math.ceil(width / STUDIO_VOLUME_WORKGROUP_X),
      Math.ceil(height / STUDIO_VOLUME_WORKGROUP_Y),
      1,
    ],
    uniforms: packStudioVolumeUniforms(request),
    density: request.prepared.density.length > 0 ? request.prepared.density : EMPTY_FLOATS,
    temperature: request.prepared.temperature ?? EMPTY_FLOATS,
    occupancy:
      request.occupancy && request.occupancy.maxDensity.length > 0
        ? request.occupancy.maxDensity
        : EMPTY_FLOATS,
    emissionLut: request.emissionLut ?? EMPTY_FLOATS,
    lights: packStudioVolumeLights(request.scene),
    outputFloatLength: width * height * 8,
    width,
    height,
  };
}

/** GPU 경로가 이 요청을 완전하게 처리할 수 있는지 사전 확인한다. */
export function canStudioVolumeUseGpu(request: StudioVolumeRenderRequest): boolean {
  if (request.prepared.degenerate) return false;
  if (request.prepared.maxDensity <= 0) return false;
  if (Math.floor(request.options.samplesPerPixel) > 1) return false;
  if (request.options.backgroundDistance) return false;
  return true;
}

/** 픽셀당 8 float 출력 → StudioVolumeImage. */
export function decodeStudioVolumeGpuOutput(
  raw: Float32Array,
  width: number,
  height: number
): StudioVolumeImage {
  const pixels = width * height;
  const rgba = new Float32Array(pixels * 4);
  const transmittance = new Float32Array(pixels);
  const depth = new Float32Array(pixels);
  const expectedDepth = new Float32Array(pixels);
  let densitySamples = 0;

  for (let i = 0; i < pixels; i += 1) {
    const src = i * 8;
    const dst = i * 4;
    rgba[dst] = raw[src];
    rgba[dst + 1] = raw[src + 1];
    rgba[dst + 2] = raw[src + 2];
    rgba[dst + 3] = raw[src + 3];
    transmittance[i] = raw[src + 4];
    depth[i] = raw[src + 5];
    expectedDepth[i] = raw[src + 6];
    densitySamples += raw[src + 7];
  }

  return {
    width,
    height,
    rgba,
    transmittance,
    depth,
    expectedDepth,
    stats: { rays: pixels, densitySamples, shadowSamples: 0, plannedSteps: 0 },
  };
}

/** 항상 동작하는 CPU 참조 백엔드. */
export function createStudioVolumeCpuBackend(): StudioVolumeBackend {
  return {
    kind: "cpu",
    render(request) {
      return Promise.resolve(
        renderStudioVolume(
          request.prepared,
          request.scene,
          request.march,
          request.occupancy,
          request.camera,
          request.options
        )
      );
    },
  };
}

/** Exact GPU backend. CPU rendering is a separate, preselected backend. */
export function createStudioVolumeGpuBackend(
  runtime: StudioVolumeGpuRuntime | null,
): StudioVolumeBackend {
  if (!runtime) throw new StudioVolumeGpuBackendError("runtime-unavailable");
  return {
    kind: "gpu",
    async render(request) {
      if (!canStudioVolumeUseGpu(request)) {
        throw new StudioVolumeGpuBackendError("unsupported-request");
      }
      const plan = buildStudioVolumeDispatchPlan(request);
      let raw: Float32Array;
      try {
        raw = await runtime.dispatch(plan);
      } catch (cause) {
        throw new StudioVolumeGpuBackendError("dispatch-failed", { cause });
      }
      if (
        !(raw instanceof Float32Array)
        || raw.length !== plan.outputFloatLength
      ) {
        throw new StudioVolumeGpuBackendError("invalid-output");
      }
      return decodeStudioVolumeGpuOutput(raw, plan.width, plan.height);
    },
  };
}
