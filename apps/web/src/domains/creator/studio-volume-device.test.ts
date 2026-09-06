import { describe, expect, it, vi } from "vitest";

import {
  buildStudioVolumeDispatchPlan,
  canStudioVolumeUseGpu,
  createStudioVolumeCpuBackend,
  createStudioVolumeGpuBackend,
  decodeStudioVolumeGpuOutput,
  packStudioVolumeLights,
  packStudioVolumeUniforms,
  type StudioVolumeGpuRuntime,
  type StudioVolumeRenderRequest,
} from "./studio-volume-device";
import {
  buildStudioVolumeEmissionLut,
  normalizeStudioVolumeEmissionParams,
} from "./studio-volume-emission";
import { prepareStudioVolume, studioVolumeVoxelIndex } from "./studio-volume-grid";
import { buildStudioVolumeOccupancy } from "./studio-volume-occupancy";
import {
  normalizeStudioVolumeMarch,
  normalizeStudioVolumeMedium,
  type StudioVolumeScene,
} from "./studio-volume-raymarch";
import {
  STUDIO_VOLUME_UNIFORM_BYTES,
  STUDIO_VOLUME_UNIFORM_OFFSETS,
  STUDIO_VOLUME_WGSL,
} from "./studio-volume-wgsl";

import type { StudioVolumeCamera } from "./studio-volume-render";

function makeRequest(overrides: Partial<StudioVolumeRenderRequest> = {}): StudioVolumeRenderRequest {
  const n = 16;
  const density = new Float32Array(n * n * n);
  for (let k = 4; k < 12; k += 1) {
    for (let j = 4; j < 12; j += 1) {
      for (let i = 4; i < 12; i += 1) {
        density[studioVolumeVoxelIndex([n, n, n], i, j, k)] = 3;
      }
    }
  }
  const temperature = new Float32Array(n * n * n).fill(1800);
  const prepared = prepareStudioVolume({
    resolution: [n, n, n],
    density,
    temperature,
    boundsMin: [0, 0, 0],
    boundsMax: [1, 1, 1],
  });
  const camera: StudioVolumeCamera = {
    origin: [0.5, 0.5, 3],
    target: [0.5, 0.5, 0.5],
    up: [0, 1, 0],
    fovY: 0.7,
  };
  const scene: StudioVolumeScene = {
    medium: normalizeStudioVolumeMedium({ densityScale: 1.25, anisotropy: 0.4 }),
    lights: [
      { kind: "point", position: [2, 2, 2], color: [1, 0.9, 0.8], intensity: 5 },
      { kind: "directional", direction: [0, -1, 0], color: [0.4, 0.5, 0.7], intensity: 2 },
    ],
  };
  return {
    prepared,
    scene,
    march: normalizeStudioVolumeMarch({ stepSize: 0.05, maxSteps: 96, seed: 1234 }),
    occupancy: buildStudioVolumeOccupancy(prepared, 8),
    camera,
    options: { width: 12, height: 10, samplesPerPixel: 1 },
    emissionLut: buildStudioVolumeEmissionLut(normalizeStudioVolumeEmissionParams(), 64),
    ...overrides,
  };
}

describe("studio-volume-device · uniform 패킹", () => {
  it("버퍼 크기가 계약과 같고 필드가 표대로 들어간다", () => {
    const request = makeRequest();
    const buffer = packStudioVolumeUniforms(request);
    expect(buffer.byteLength).toBe(STUDIO_VOLUME_UNIFORM_BYTES);
    const view = new DataView(buffer);
    const o = STUDIO_VOLUME_UNIFORM_OFFSETS;

    // worldToObject 는 항등 → 대각 1.
    expect(view.getFloat32(o.worldToObject, true)).toBe(1);
    expect(view.getFloat32(o.worldToObject + 20, true)).toBe(1);
    expect(view.getFloat32(o.worldToObject + 40, true)).toBe(1);
    expect(view.getFloat32(o.worldToObject + 60, true)).toBe(1);

    expect(view.getFloat32(o.cameraOrigin, true)).toBeCloseTo(0.5, 6);
    expect(view.getFloat32(o.cameraOrigin + 8, true)).toBeCloseTo(3, 6);
    // 카메라는 -z 를 본다.
    expect(view.getFloat32(o.cameraForward + 8, true)).toBeCloseTo(-1, 6);

    expect(view.getFloat32(o.boundsMax, true)).toBe(1);
    expect(view.getFloat32(o.invCellSize, true)).toBe(16);

    expect(view.getUint32(o.resolution, true)).toBe(16);
    expect(view.getUint32(o.resolution + 12, true)).toBe(16 * 16 * 16);
    expect(view.getUint32(o.blockDims, true)).toBe(2);
    expect(view.getUint32(o.blockDims + 12, true)).toBe(8);

    expect(view.getFloat32(o.medium, true)).toBeCloseTo(1.25, 6);
    expect(view.getFloat32(o.medium + 8, true)).toBeCloseTo(0.4, 6);

    expect(view.getFloat32(o.march, true)).toBeCloseTo(0.05, 6);
    expect(view.getFloat32(o.march + 4, true)).toBeCloseTo(Math.tan(0.35), 6);

    expect(view.getUint32(o.image, true)).toBe(12);
    expect(view.getUint32(o.image + 4, true)).toBe(10);
    expect(view.getUint32(o.image + 8, true)).toBe(96);
    expect(view.getUint32(o.image + 12, true)).toBe(1234);

    expect(view.getUint32(o.flags, true)).toBe(2); // 광원 2개
    expect(view.getUint32(o.flags + 4, true)).toBe(1); // occupancy on
    expect(view.getUint32(o.flags + 8, true)).toBe(64); // LUT 크기
    expect(view.getUint32(o.flags + 12, true)).toBe(1); // ratio-tracking 그림자

    // emissionRamp = (rampK, depthAlphaThreshold, jitter, maxDensity)
    expect(view.getFloat32(o.emissionRamp + 4, true)).toBeCloseTo(0.5, 6);
    expect(view.getFloat32(o.emissionRamp + 8, true)).toBeCloseTo(1, 6);
    expect(view.getFloat32(o.emissionRamp + 12, true)).toBeCloseTo(3, 6);
  });

  it("occupancy 가 없으면 blockDims 0 · 플래그 off", () => {
    const buffer = packStudioVolumeUniforms(makeRequest({ occupancy: null }));
    const view = new DataView(buffer);
    expect(view.getUint32(STUDIO_VOLUME_UNIFORM_OFFSETS.blockDims, true)).toBe(0);
    expect(view.getUint32(STUDIO_VOLUME_UNIFORM_OFFSETS.flags + 4, true)).toBe(0);
    // blockExtent 는 0 나눗셈을 막으려 1 로 폴백한다.
    expect(view.getFloat32(STUDIO_VOLUME_UNIFORM_OFFSETS.blockExtent, true)).toBe(1);
  });

  it("useOccupancy=false 면 플래그가 꺼진다", () => {
    const request = makeRequest();
    const buffer = packStudioVolumeUniforms({
      ...request,
      march: normalizeStudioVolumeMarch({ ...request.march, useOccupancy: false }),
    });
    expect(new DataView(buffer).getUint32(STUDIO_VOLUME_UNIFORM_OFFSETS.flags + 4, true)).toBe(0);
  });
});

describe("studio-volume-device · 광원 패킹", () => {
  it("점광원은 kind 0 · 색×세기 · 1/r² 플래그를 싣는다", () => {
    const packed = packStudioVolumeLights({
      medium: normalizeStudioVolumeMedium(),
      lights: [{ kind: "point", position: [1, 2, 3], color: [0.5, 0.25, 0.125], intensity: 4 }],
    });
    expect(packed.length).toBe(8);
    expect(Array.from(packed.slice(0, 4))).toEqual([1, 2, 3, 0]);
    expect(packed[4]).toBeCloseTo(2, 6);
    expect(packed[5]).toBeCloseTo(1, 6);
    expect(packed[6]).toBeCloseTo(0.5, 6);
    expect(packed[7]).toBe(1);
  });

  it("inverseSquare=false 는 감쇠 플래그를 끈다", () => {
    const packed = packStudioVolumeLights({
      medium: normalizeStudioVolumeMedium(),
      lights: [
        {
          kind: "point",
          position: [0, 0, 0],
          color: [1, 1, 1],
          intensity: 1,
          inverseSquare: false,
        },
      ],
    });
    expect(packed[7]).toBe(0);
  });

  it("방향광은 kind 1 이고 진행방향 원본을 그대로 싣는다", () => {
    const packed = packStudioVolumeLights({
      medium: normalizeStudioVolumeMedium(),
      lights: [{ kind: "directional", direction: [0, -1, 0], color: [1, 1, 1], intensity: 3 }],
    });
    expect(Array.from(packed.slice(0, 4))).toEqual([0, -1, 0, 1]);
    expect(packed[4]).toBe(3);
    expect(packed[7]).toBe(0);
  });

  it("광원이 없어도 길이 0 버퍼를 만들지 않는다(WebGPU 제약)", () => {
    const packed = packStudioVolumeLights({ medium: normalizeStudioVolumeMedium(), lights: [] });
    expect(packed.length).toBe(8);
  });
});

describe("studio-volume-device · 디스패치 플랜", () => {
  it("워크그룹 개수는 ceil(크기 / 8) 이다", () => {
    const plan = buildStudioVolumeDispatchPlan(makeRequest());
    expect(plan.workgroupCount).toEqual([2, 2, 1]);
    const wide = buildStudioVolumeDispatchPlan(
      makeRequest({ options: { width: 1920, height: 1080, samplesPerPixel: 1 } })
    );
    expect(wide.workgroupCount).toEqual([240, 135, 1]);
  });

  it("WGSL 소스와 출력 길이를 함께 싣는다", () => {
    const plan = buildStudioVolumeDispatchPlan(makeRequest());
    expect(plan.wgsl).toBe(STUDIO_VOLUME_WGSL);
    expect(plan.entryPoint).toBe("main");
    expect(plan.outputFloatLength).toBe(12 * 10 * 8);
    expect(plan.density.length).toBe(16 * 16 * 16);
    expect(plan.temperature.length).toBe(16 * 16 * 16);
    expect(plan.occupancy.length).toBe(8);
    expect(plan.lights.length).toBe(16);
  });

  it("온도/LUT/occupancy 가 없어도 길이 0 버퍼를 내보내지 않는다", () => {
    const noTemp = prepareStudioVolume({
      resolution: [4, 4, 4],
      density: new Float32Array(64).fill(1),
      boundsMin: [0, 0, 0],
      boundsMax: [1, 1, 1],
    });
    const plan = buildStudioVolumeDispatchPlan(
      makeRequest({ prepared: noTemp, occupancy: null, emissionLut: null })
    );
    expect(plan.temperature.length).toBeGreaterThan(0);
    expect(plan.occupancy.length).toBeGreaterThan(0);
    expect(plan.emissionLut.length).toBeGreaterThan(0);
  });
});

describe("studio-volume-device · 백엔드 심", () => {
  it("CPU 백엔드는 항상 이미지를 낸다", async () => {
    const backend = createStudioVolumeCpuBackend();
    expect(backend.kind).toBe("cpu");
    const image = await backend.render(makeRequest());
    expect(image.width).toBe(12);
    expect(image.height).toBe(10);
    expect(image.rgba.length).toBe(12 * 10 * 4);
  });

  it("선택한 GPU 런타임이 없으면 생성 단계에서 실패한다", () => {
    expect(() => createStudioVolumeGpuBackend(null)).toThrow(
      expect.objectContaining({ code: "runtime-unavailable" }),
    );
  });

  it("GPU 런타임이 있으면 플랜을 넘기고 결과를 디코딩한다", async () => {
    const request = makeRequest();
    const plan = buildStudioVolumeDispatchPlan(request);
    const raw = new Float32Array(plan.outputFloatLength);
    for (let i = 0; i < plan.width * plan.height; i += 1) {
      raw[i * 8] = 0.25;
      raw[i * 8 + 3] = 0.5;
      raw[i * 8 + 4] = 0.5;
      raw[i * 8 + 5] = 2.5;
      raw[i * 8 + 6] = 2.7;
      raw[i * 8 + 7] = 42;
    }
    const dispatch = vi.fn().mockResolvedValue(raw);
    const runtime: StudioVolumeGpuRuntime = { label: "fake", dispatch };
    const backend = createStudioVolumeGpuBackend(runtime);
    expect(backend.kind).toBe("gpu");

    const image = await backend.render(request);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].uniforms.byteLength).toBe(STUDIO_VOLUME_UNIFORM_BYTES);
    expect(image.rgba[0]).toBe(0.25);
    expect(image.rgba[3]).toBe(0.5);
    expect(image.transmittance[0]).toBe(0.5);
    expect(image.depth[0]).toBe(2.5);
    expect(image.expectedDepth[0]).toBe(Math.fround(2.7));
    expect(image.stats.densitySamples).toBe(42 * 120);
  });

  it("dispatch 가 던지면 CPU 재실행 없이 실패한다", async () => {
    const dispatch = vi.fn().mockRejectedValue(new Error("device lost"));
    const backend = createStudioVolumeGpuBackend({ dispatch });
    await expect(backend.render(makeRequest())).rejects.toMatchObject({
      code: "dispatch-failed",
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("출력 길이가 모자라면 결과를 게시하지 않는다", async () => {
    const dispatch = vi.fn().mockResolvedValue(new Float32Array(4));
    const backend = createStudioVolumeGpuBackend({ dispatch });
    await expect(backend.render(makeRequest())).rejects.toMatchObject({
      code: "invalid-output",
    });
  });

  it("미지원 옵션(spp>1 · 배경 깊이 · 퇴화 볼륨)은 dispatch 를 아예 부르지 않는다", async () => {
    const dispatch = vi.fn().mockResolvedValue(new Float32Array(0));
    const backend = createStudioVolumeGpuBackend({ dispatch });

    await expect(backend.render(makeRequest({
      options: { width: 4, height: 4, samplesPerPixel: 4 },
    }))).rejects.toMatchObject({ code: "unsupported-request" });
    await expect(backend.render(
      makeRequest({
        options: {
          width: 4,
          height: 4,
          samplesPerPixel: 1,
          backgroundDistance: new Float32Array(16).fill(3),
        },
      }),
    )).rejects.toMatchObject({ code: "unsupported-request" });
    const degenerate = prepareStudioVolume({
      resolution: [2, 2, 2],
      density: new Float32Array(8).fill(1),
      boundsMin: [0, 0, 0],
      boundsMax: [0, 1, 1],
    });
    await expect(backend.render(makeRequest({
      prepared: degenerate,
      occupancy: null,
    }))).rejects.toMatchObject({ code: "unsupported-request" });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it("canStudioVolumeUseGpu 가 지원 조건을 그대로 보고한다", () => {
    expect(canStudioVolumeUseGpu(makeRequest())).toBe(true);
    expect(
      canStudioVolumeUseGpu(makeRequest({ options: { width: 4, height: 4, samplesPerPixel: 2 } }))
    ).toBe(false);
    const empty = prepareStudioVolume({
      resolution: [4, 4, 4],
      density: new Float32Array(64),
      boundsMin: [0, 0, 0],
      boundsMax: [1, 1, 1],
    });
    expect(canStudioVolumeUseGpu(makeRequest({ prepared: empty }))).toBe(false);
  });

  it("디코딩은 픽셀당 8 float 스트라이드를 지킨다", () => {
    const raw = new Float32Array(2 * 8);
    raw[8] = 1;
    raw[11] = 0.75;
    raw[12] = 0.25;
    const image = decodeStudioVolumeGpuOutput(raw, 2, 1);
    expect(image.rgba[0]).toBe(0);
    expect(image.rgba[4]).toBe(1);
    expect(image.rgba[7]).toBe(0.75);
    expect(image.transmittance[1]).toBe(0.25);
  });
});
