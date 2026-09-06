import { afterEach, describe, expect, it, vi } from "vitest";

import { disposeStudioGpuFabric } from "./studio-gpu-fabric";
import {
  applyGpuFilterChain,
  isStudioGpuFilterChainEligible,
  planStudioGpuFilterChain,
  presentGpuFilterChain,
} from "./studio-gpu-filter-apply";
import {
  STUDIO_GPU_FILTER_KERNELS,
  packStudioGpuBrightnessContrastLut,
  packStudioGpuCurvesLut,
  packStudioGpuLevelsLut,
} from "./studio-gpu-filter-kernels";
import { disposeStudioGpuFilterRuntime } from "./studio-gpu-filter-runtime";
import { buildImageFilters, registerStudioKonvaFilters, type KonvaLike } from "./studio-konva-filters";

import type { StudioGpuFilterKernelId } from "./studio-gpu-filter-kernels";
import type { StudioGpuFilterPresentationSurface } from "./studio-gpu-filter-presentation";
import type { ImageFilterFields } from "./studio-konva-filter-fields";

const registry: KonvaLike = { Filters: {} };
registerStudioKonvaFilters(registry);

// buildImageFilters 가 돌려주는 필터 함수 → GPU 커널 id 매핑(지원 6함수만).
const SUPPORTED_FILTER_FN_TO_KERNEL = new Map<unknown, StudioGpuFilterKernelId>([
  [registry.Filters.Brighten, "brightness-contrast"],
  [registry.Filters.Contrast, "brightness-contrast"],
  [registry.Filters.HSL, "hsl"],
  [registry.Filters.Levels, "levels"],
  [registry.Filters.Curve, "curves"],
  [registry.Filters.ColorBalance, "color-balance"],
]);

/** CPU 체인에서 지원 필터만 추출해 (인접 중복 제거된) 커널 id 순서를 만든다. */
function cpuKernelOrder(el: ImageFilterFields): StudioGpuFilterKernelId[] {
  const { filters } = buildImageFilters(el, registry);
  const ids: StudioGpuFilterKernelId[] = [];
  for (const filter of filters) {
    const id = SUPPORTED_FILTER_FN_TO_KERNEL.get(filter);
    if (!id) continue;
    if (ids[ids.length - 1] !== id) ids.push(id);
  }
  return ids;
}

/**
 * plan 의 LUT 융합을 커널 id 수준에서 재현 — 인접한 LUT 커널 런(run)을 하나로 접는다.
 * 반환: [기대 스텝 id 순서, 스텝별 원본 run(융합 스텝만 길이>1)].
 */
function fusedKernelOrder(
  ids: readonly StudioGpuFilterKernelId[],
): [StudioGpuFilterKernelId[], StudioGpuFilterKernelId[][]] {
  const stepIds: StudioGpuFilterKernelId[] = [];
  const runs: StudioGpuFilterKernelId[][] = [];
  for (const id of ids) {
    const usesLut = STUDIO_GPU_FILTER_KERNELS[id].usesLut;
    const lastRun = runs[runs.length - 1];
    if (usesLut && lastRun && STUDIO_GPU_FILTER_KERNELS[stepIds[stepIds.length - 1]!].usesLut) {
      lastRun.push(id);
      stepIds[stepIds.length - 1] = "lut-fused";
      continue;
    }
    stepIds.push(id);
    runs.push([id]);
  }
  return [stepIds, runs];
}

/** CPU 체인이 지원 필터만으로 구성됐는지(비지원 필터가 끼면 GPU plan 은 null 이어야 한다). */
function cpuChainFullySupported(el: ImageFilterFields): boolean {
  const { filters } = buildImageFilters(el, registry);
  return filters.every((filter) => SUPPORTED_FILTER_FN_TO_KERNEL.has(filter));
}

function imageData(width = 4, height = 3) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 1) data[i] = (i * 37) % 256;
  return { data, width, height };
}

afterEach(() => {
  disposeStudioGpuFabric();
  disposeStudioGpuFilterRuntime();
  vi.unstubAllGlobals();
});

describe("studio-gpu-filter-apply: 체인 계획", () => {
  const FIVE_FIELD_CASES: readonly [string, ImageFilterFields][] = [
    ["밝기만", { brightness: 0.3 }],
    ["대비만", { contrast: -25 }],
    ["밝기+대비", { brightness: -0.2, contrast: 45 }],
    ["색조만", { hue: 130 }],
    ["채도만", { saturation: 0.5 }],
    ["레벨 마스터", { levelsBlack: 20, levelsWhite: 235, levelsGamma: 1.3 }],
    ["레벨 채널만", { levelsCh: { r: { gamma: 0.8 } } }],
    ["커브 마스터", { curve: [{ x: 0, y: 0 }, { x: 128, y: 160 }, { x: 255, y: 255 }] }],
    ["커브 채널만", { curveCh: { b: [{ x: 0, y: 30 }, { x: 255, y: 255 }] } }],
    ["컬러 밸런스", { colorBalance: { shadows: [20, 0, -10], midtones: [0, 0, 0], highlights: [0, 0, 0] } }],
    [
      "5종 전부",
      {
        brightness: 0.1,
        contrast: 20,
        saturation: 0.4,
        hue: -40,
        levelsBlack: 15,
        levelsCh: { g: { whitePoint: 240 } },
        curve: [{ x: 0, y: 0 }, { x: 64, y: 48 }, { x: 255, y: 255 }],
        curveCh: { r: [{ x: 0, y: 10 }, { x: 255, y: 245 }] },
        colorBalance: { shadows: [0, 0, 0], midtones: [0, 12, 0], highlights: [-8, 0, 8] },
      },
    ],
  ];

  it("스텝 순서가 buildImageFilters 의 지원-필드 적용 순서(인접 LUT 융합 포함)와 정확히 일치한다", () => {
    for (const [label, el] of FIVE_FIELD_CASES) {
      // 전제: 이 케이스들의 CPU 체인은 지원 필터만으로 구성된다.
      expect(cpuChainFullySupported(el), label).toBe(true);
      const plan = planStudioGpuFilterChain(el);
      expect(plan, label).not.toBeNull();
      const [expectedIds, expectedRuns] = fusedKernelOrder(cpuKernelOrder(el));
      expect(plan!.map((step) => step.kernelId), label).toEqual(expectedIds);
      for (const [index, step] of plan!.entries()) {
        // LUT 커널 스텝은 항상 768칸 LUT 를 동반한다.
        if (
          step.kernelId in STUDIO_GPU_FILTER_KERNELS
          && STUDIO_GPU_FILTER_KERNELS[step.kernelId as StudioGpuFilterKernelId].usesLut
        ) {
          expect(step.lut, label).toBeInstanceOf(Uint32Array);
          expect(step.lut!.length, label).toBe(768);
        } else {
          expect(step.lut, label).toBeUndefined();
        }
        // 융합 스텝만 원본 커널 순서를 보존하는 fusedKernelIds 를 가진다.
        if (step.kernelId === "lut-fused") {
          expect(step.fusedKernelIds, label).toEqual(expectedRuns[index]);
          expect(expectedRuns[index]!.length, label).toBeGreaterThan(1);
        } else {
          expect(step.fusedKernelIds, label).toBeUndefined();
        }
      }
    }
  });

  it("인접 LUT 스텝 융합 — 합성 LUT 가 순차 LUT 조회와 비트 단위로 동일하다", () => {
    // 밝기대비→레벨→커브 전부 LUT: 단일 lut-fused 스텝으로 융합돼야 한다.
    const el: ImageFilterFields = {
      brightness: -0.2,
      contrast: 45,
      levelsBlack: 20,
      levelsWhite: 235,
      levelsGamma: 1.3,
      levelsCh: { r: { gamma: 0.8 } },
      curve: [{ x: 0, y: 0 }, { x: 64, y: 48 }, { x: 255, y: 255 }],
      curveCh: { g: [{ x: 0, y: 10 }, { x: 255, y: 245 }] },
    };
    const plan = planStudioGpuFilterChain(el);
    expect(plan).not.toBeNull();
    expect(plan!.length).toBe(1);
    expect(plan![0]!.kernelId).toBe("lut-fused");
    expect(plan![0]!.fusedKernelIds).toEqual(["brightness-contrast", "levels", "curves"]);

    // 순차 실행 오라클: 개별 스테이지 LUT 를 순서대로 정수 조회.
    const bc = packStudioGpuBrightnessContrastLut({ brightness: el.brightness, contrast: el.contrast });
    const levels = packStudioGpuLevelsLut({
      master: { blackPoint: 20, whitePoint: 235, gamma: 1.3 },
      channels: el.levelsCh,
    });
    const curves = packStudioGpuCurvesLut({ master: el.curve, channels: el.curveCh });
    const fusedLut = plan![0]!.lut!;
    for (let channel = 0; channel < 3; channel += 1) {
      const base = channel * 256;
      for (let i = 0; i < 256; i += 1) {
        const sequential = curves[base + levels[base + bc[base + i]!]!]!;
        expect(fusedLut[base + i], `channel=${channel} v=${i}`).toBe(sequential);
      }
    }
  });

  it("수식 커널(HSL/컬러밸런스)이 사이에 끼면 그 경계 너머로는 융합하지 않는다", () => {
    // 밝기대비 | HSL | 레벨+커브 — 체인 순서 의미 보존을 위해 HSL 양쪽은 분리 유지.
    const acrossHsl = planStudioGpuFilterChain({
      brightness: 0.2,
      hue: 90,
      levelsBlack: 20,
      curve: [{ x: 0, y: 0 }, { x: 128, y: 150 }, { x: 255, y: 255 }],
    });
    expect(acrossHsl).not.toBeNull();
    expect(acrossHsl!.map((step) => step.kernelId)).toEqual(["brightness-contrast", "hsl", "lut-fused"]);
    expect(acrossHsl![2]!.fusedKernelIds).toEqual(["levels", "curves"]);

    // 컬러밸런스는 체인 끝(수식) — LUT 융합 스텝 뒤에 그대로 남는다.
    const withColorBalance = planStudioGpuFilterChain({
      brightness: 0.2,
      levelsBlack: 20,
      colorBalance: { shadows: [10, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0] },
    });
    expect(withColorBalance).not.toBeNull();
    expect(withColorBalance!.map((step) => step.kernelId)).toEqual(["lut-fused", "color-balance"]);
    expect(withColorBalance![0]!.fusedKernelIds).toEqual(["brightness-contrast", "levels"]);
  });

  it("Gaussian→morphology→convolution을 CPU 필터 순서로 확장하고 LUT 체인은 뒤에 둔다", () => {
    const plan = planStudioGpuFilterChain({
      blurFx: { type: "gaussian", strength: 73, radius: 6, angle: 0 },
      morphology: { mode: "erode", radius: 2 },
      convolution: {
        kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
        divisor: 1,
        bias: 128,
      },
      brightness: 0.2,
      levelsBlack: 12,
    });
    expect(plan).not.toBeNull();
    expect(plan!.map((step) => step.kernelId)).toEqual([
      "gaussian-decode",
      "gaussian-box-horizontal",
      "gaussian-box-vertical",
      "gaussian-box-horizontal",
      "gaussian-box-vertical",
      "gaussian-box-horizontal",
      "gaussian-box-vertical",
      "gaussian-resolve",
      "morphology-horizontal",
      "morphology-vertical",
      "convolution-3x3",
      "lut-fused",
    ]);
    expect(plan!.at(-1)?.fusedKernelIds).toEqual(["brightness-contrast", "levels"]);
    expect(new DataView(plan![1]!.uniform).getUint32(12, true)).toBe(5);
    expect(new DataView(plan![5]!.uniform).getUint32(12, true)).toBe(6);
  });

  it("공간 필터 항등은 계획에서 빠지고 non-Gaussian blur는 전체 CPU 폴백한다", () => {
    expect(planStudioGpuFilterChain({
      blurFx: { type: "gaussian", strength: 0, radius: 40, angle: 0 },
      morphology: { mode: "dilate", radius: 0 },
      convolution: { kernel: [0, 0, 0, 0, 1, 0, 0, 0, 0], divisor: 1, bias: 0 },
    })).toBeNull();
    expect(planStudioGpuFilterChain({
      blurFx: { type: "motion", strength: 50, radius: 12, angle: 45 },
      brightness: 0.2,
    })).toBeNull();
    expect(isStudioGpuFilterChainEligible({
      blurFx: { type: "motion", strength: 50, radius: 12, angle: 45 },
    })).toBe(false);
  });

  it("raw Gaussian radius 0/과대값도 CPU normalizer 경계(1..40)를 그대로 따른다", () => {
    const minimum = planStudioGpuFilterChain({
      blurFx: { type: "gaussian", strength: 100, radius: 0, angle: 0 },
    });
    expect(minimum?.map((step) => step.kernelId)).toEqual([
      "gaussian-decode",
      "gaussian-box-horizontal",
      "gaussian-box-vertical",
      "gaussian-resolve",
    ]);
    expect(new DataView(minimum![1]!.uniform).getUint32(12, true)).toBe(1);

    const maximum = planStudioGpuFilterChain({
      blurFx: { type: "gaussian", strength: 100, radius: 999, angle: 0 },
    });
    expect(maximum).toHaveLength(8);
    expect(new DataView(maximum![5]!.uniform).getUint32(12, true)).toBe(40);
  });

  it("활성 보정이 없으면 null — 항등 값(0/항등 곡선/항등 레벨)도 비활성으로 본다", () => {
    expect(planStudioGpuFilterChain({})).toBeNull();
    expect(planStudioGpuFilterChain({ brightness: 0, contrast: 0 })).toBeNull();
    expect(planStudioGpuFilterChain({ levelsBlack: 0, levelsWhite: 255, levelsGamma: 1 })).toBeNull();
    expect(planStudioGpuFilterChain({ curve: [{ x: 0, y: 0 }, { x: 255, y: 255 }] })).toBeNull();
    expect(planStudioGpuFilterChain({
      colorBalance: { shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0] },
    })).toBeNull();
  });

  it("지원 외 보정이 하나라도 활성이면 전체 CPU 폴백(null) — 부분 GPU 실행 금지", () => {
    expect(planStudioGpuFilterChain({ brightness: 0.2, sepia: true })).toBeNull();
    expect(planStudioGpuFilterChain({ brightness: 0.2, blur: 3 })).toBeNull();
    expect(planStudioGpuFilterChain({ contrast: 20, temperature: 15 })).toBeNull();
    expect(planStudioGpuFilterChain({ hue: 90, grayscale: true })).toBeNull();
    expect(planStudioGpuFilterChain({ curve: [{ x: 0, y: 10 }, { x: 255, y: 255 }], sharpen: 0.5 })).toBeNull();
    expect(planStudioGpuFilterChain({
      colorBalance: { shadows: [10, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0] },
      vignetteFx: { darkness: 0.4, size: 0.5, roundness: 0.5, feather: 0.5 },
    })).toBeNull();
    expect(planStudioGpuFilterChain({
      brightness: 0.2,
      smartFilterOperations: [{ id: "a", engine: "invert", enabled: true, params: {} }],
    })).toBeNull();
  });

  it("isStudioGpuFilterChainEligible 은 plan 유무와 일치한다", () => {
    expect(isStudioGpuFilterChainEligible({ brightness: 0.2 })).toBe(true);
    expect(isStudioGpuFilterChainEligible({})).toBe(false);
    expect(isStudioGpuFilterChainEligible({ brightness: 0.2, lineart: true })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 폴백 경로 — GPU 미지원/실패는 예외 없이 null 로 강등돼야 한다.
// ---------------------------------------------------------------------------

interface FakeGpuHarness {
  readonly gpu: GPU;
  readonly device: GPUDevice;
  readonly requestAdapter: ReturnType<typeof vi.fn>;
  readonly requestDevice: ReturnType<typeof vi.fn>;
  readonly dispatchCalls: [number, number][];
  readonly createBuffer: ReturnType<typeof vi.fn>;
  readonly createShaderModule: ReturnType<typeof vi.fn>;
  readonly createComputePipeline: ReturnType<typeof vi.fn>;
  readonly destroyDevice: ReturnType<typeof vi.fn>;
  readonly pushErrorScope: ReturnType<typeof vi.fn>;
  readonly popErrorScope: ReturnType<typeof vi.fn>;
  popErrorScopeResults: (object | null)[];
  resolveDeviceLoss(): void;
}

function createFakeGpu(overrides?: {
  createBufferThrows?: boolean;
  loseOnPopErrorScope?: boolean;
  limits?: Partial<{
    maxStorageBufferBindingSize: number;
    maxBufferSize: number;
    maxComputeWorkgroupsPerDimension: number;
    maxComputeInvocationsPerWorkgroup: number;
    maxComputeWorkgroupSizeX: number;
  }>;
}): FakeGpuHarness {
  const dispatchCalls: [number, number][] = [];
  const harness: { popErrorScopeResults: (object | null)[] } = { popErrorScopeResults: [null, null] };
  let resolveLost: ((info: GPUDeviceLostInfo) => void) | null = null;
  const lost = new Promise<GPUDeviceLostInfo>((resolve) => {
    resolveLost = resolve;
  });
  const resolveDeviceLoss = () => {
    if (!resolveLost) return;
    resolveLost({ reason: "unknown", message: "test loss" } as GPUDeviceLostInfo);
    resolveLost = null;
  };
  const createBuffer = vi.fn((descriptor: { size: number }) => {
    if (overrides?.createBufferThrows) throw new Error("out of memory");
    return {
      size: descriptor.size,
      destroy: vi.fn(),
      mapAsync: vi.fn(async () => undefined),
      getMappedRange: vi.fn(() => new ArrayBuffer(descriptor.size)),
      unmap: vi.fn(),
    };
  });
  const createShaderModule = vi.fn(() => ({}));
  const createComputePipeline = vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) }));
  const destroyDevice = vi.fn();
  const pushErrorScope = vi.fn();
  const popErrorScope = vi.fn(async () => {
    if (overrides?.loseOnPopErrorScope) {
      resolveDeviceLoss();
      await Promise.resolve();
    }
    return harness.popErrorScopeResults.shift() ?? null;
  });
  const device = {
    createShaderModule,
    createComputePipeline,
    createBindGroup: vi.fn(() => ({})),
    createBuffer,
    createCommandEncoder: vi.fn(() => ({
      beginComputePass: vi.fn(() => ({
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        dispatchWorkgroups: vi.fn((x: number, y: number) => {
          dispatchCalls.push([x, y]);
        }),
        end: vi.fn(),
      })),
      copyBufferToBuffer: vi.fn(),
      finish: vi.fn(() => ({})),
    })),
    queue: { writeBuffer: vi.fn(), submit: vi.fn() },
    destroy: destroyDevice,
    lost,
    limits: {
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
      maxBufferSize: 256 * 1024 * 1024,
      maxComputeWorkgroupsPerDimension: 65_535,
      maxComputeInvocationsPerWorkgroup: 256,
      maxComputeWorkgroupSizeX: 256,
      ...overrides?.limits,
    },
    pushErrorScope,
    popErrorScope,
  };
  const requestDevice = vi.fn(async () => device);
  const requestAdapter = vi.fn(async () => ({ requestDevice }));
  return {
    gpu: { requestAdapter } as unknown as GPU,
    device: device as unknown as GPUDevice,
    requestAdapter,
    requestDevice,
    dispatchCalls,
    createBuffer,
    createShaderModule,
    createComputePipeline,
    destroyDevice,
    pushErrorScope,
    popErrorScope,
    resolveDeviceLoss,
    get popErrorScopeResults() {
      return harness.popErrorScopeResults;
    },
    set popErrorScopeResults(next: (object | null)[]) {
      harness.popErrorScopeResults = next;
    },
  };
}

async function flushDeviceLoss(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("studio-gpu-filter-apply: StudioGpuFabric cutover", () => {
  it("기본 호출 두 번은 어댑터·디바이스·런타임을 공유하고 적용별 cleanup이 디바이스를 파기하지 않는다", async () => {
    const harness = createFakeGpu();
    vi.stubGlobal("navigator", { gpu: harness.gpu });

    const first = await applyGpuFilterChain(imageData(), { brightness: 0.2 });
    const second = await applyGpuFilterChain(imageData(), { brightness: 0.3 });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(harness.requestAdapter).toHaveBeenCalledTimes(1);
    expect(harness.requestDevice).toHaveBeenCalledTimes(1);
    expect(harness.createShaderModule).toHaveBeenCalledTimes(1);
    expect(harness.createComputePipeline).toHaveBeenCalledTimes(1);
    expect(harness.pushErrorScope).toHaveBeenCalledTimes(4);
    expect(harness.popErrorScope).toHaveBeenCalledTimes(4);
    expect(harness.destroyDevice).not.toHaveBeenCalled();
  });

  it("명시적 options.gpu는 fabric을 우회해 호출마다 독립 런타임을 소유·폐기한다", async () => {
    const production = createFakeGpu();
    const override = createFakeGpu();
    vi.stubGlobal("navigator", { gpu: production.gpu });

    expect(await applyGpuFilterChain(
      imageData(),
      { brightness: 0.2 },
      { gpu: override.gpu },
    )).not.toBeNull();
    expect(await applyGpuFilterChain(
      imageData(),
      { brightness: 0.3 },
      { gpu: override.gpu },
    )).not.toBeNull();

    expect(production.requestAdapter).not.toHaveBeenCalled();
    expect(override.requestAdapter).toHaveBeenCalledTimes(2);
    expect(override.requestDevice).toHaveBeenCalledTimes(2);
    expect(override.createShaderModule).toHaveBeenCalledTimes(2);
    expect(override.destroyDevice).toHaveBeenCalledTimes(2);
  });

  it("fabric 명시적 dispose 뒤 기본 호출은 새 어댑터·디바이스·런타임을 획득한다", async () => {
    const first = createFakeGpu();
    vi.stubGlobal("navigator", { gpu: first.gpu });
    expect(await applyGpuFilterChain(imageData(), { brightness: 0.2 })).not.toBeNull();

    disposeStudioGpuFabric();
    expect(first.destroyDevice).toHaveBeenCalledTimes(1);

    const replacement = createFakeGpu();
    vi.stubGlobal("navigator", { gpu: replacement.gpu });
    expect(await applyGpuFilterChain(imageData(), { brightness: 0.2 })).not.toBeNull();
    expect(replacement.requestAdapter).toHaveBeenCalledTimes(1);
    expect(replacement.requestDevice).toHaveBeenCalledTimes(1);
    expect(replacement.createShaderModule).toHaveBeenCalledTimes(1);
    expect(replacement.destroyDevice).not.toHaveBeenCalled();
  });

  it("fabric device loss 뒤 기본 호출은 새 디바이스로 복구하고 stale 런타임을 재사용하지 않는다", async () => {
    const first = createFakeGpu();
    vi.stubGlobal("navigator", { gpu: first.gpu });
    expect(await applyGpuFilterChain(imageData(), { brightness: 0.2 })).not.toBeNull();

    first.resolveDeviceLoss();
    await flushDeviceLoss();

    const replacement = createFakeGpu();
    vi.stubGlobal("navigator", { gpu: replacement.gpu });
    expect(await applyGpuFilterChain(imageData(), { brightness: 0.2 })).not.toBeNull();
    expect(first.requestAdapter).toHaveBeenCalledTimes(1);
    expect(replacement.requestAdapter).toHaveBeenCalledTimes(1);
    expect(replacement.requestDevice).toHaveBeenCalledTimes(1);
    expect(replacement.createShaderModule).toHaveBeenCalledTimes(1);
    expect(replacement.destroyDevice).not.toHaveBeenCalled();
  });
});

describe("studio-gpu-filter-apply: 폴백 경로", () => {
  it("node 환경(WebGPU 없음)에서는 유효한 체인도 null → 호출부 CPU 폴백", async () => {
    expect(await applyGpuFilterChain(imageData(), { brightness: 0.2 })).toBeNull();
  });

  it("지원 외 보정 활성이면 디바이스 획득 시도조차 하지 않는다", async () => {
    const harness = createFakeGpu();
    const result = await applyGpuFilterChain(
      imageData(),
      { brightness: 0.2, sepia: true },
      { gpu: harness.gpu },
    );
    expect(result).toBeNull();
    expect(harness.requestAdapter).not.toHaveBeenCalled();
  });

  it.each([
    ["선화 정리", { lineCleanup: { threshold: 0.64, strength: 0.45 } }],
    [
      "스크린톤 제거",
      { screentoneRemoval: { radius: 2, strength: 0.88, inkLumaThreshold: 72 } },
    ],
    [
      "JPEG 아티팩트 감소",
      {
        jpegArtifactReduction: {
          deblockStrength: 0.72,
          deringStrength: 0.45,
          boundaryThreshold: 6,
          protectedEdgeThreshold: 88,
          ringingThreshold: 18,
          inkLumaThreshold: 64,
        },
      },
    ],
    [
      "엣지 보존 노이즈 감소",
      { edgeAwareDenoise: { radius: 1, strength: 0.78, rangeThreshold: 72 } },
    ],
    [
      "렌즈 블러",
      {
        lensBlur: {
          radius: 4,
          sampleCount: 21,
          apertureBlades: 6,
          apertureRotationRadians: 0,
        },
      },
    ],
    [
      "필드 아이리스 블러",
      {
        fieldIrisBlur: {
          focusCenterX: 0.5,
          focusCenterY: 0.5,
          focusRadius: 0.16,
          feather: 0.24,
          maximumBlurRadius: 7,
          sampleCount: 21,
          apertureBlades: 8,
        },
      },
    ],
    [
      "틸트 시프트 블러",
      {
        tiltShiftBlur: {
          axisRadians: 0,
          focusWidth: 0.2,
          feather: 0.22,
          maximumBlurRadius: 7,
          sampleCount: 19,
        },
      },
    ],
    [
      "선택적 가우시안 블러",
      {
        selectiveGaussianBlur: {
          radius: 3,
          spatialSigma: 2,
          edgeThreshold: 20,
          edgeSoftness: 0.35,
        },
      },
    ],
    [
      "타일러블 블러",
      { tileableBlur: { radius: 5, sigma: 2.2, strength: 0.8 } },
    ],
    [
      "가우시안 차분",
      {
        differenceOfGaussians: {
          smallSigma: 0.8,
          largeSigma: 2,
          threshold: 1.5,
          strength: 12,
        },
      },
    ],
    [
      "먼지·스크래치",
      { dustScratches: { radius: 2, threshold: 24, strength: 0.9 } },
    ],
    [
      "색상 투명화",
      { colorToAlpha: { keyColor: "#ffffff", strength: 85 } },
    ],
  ] as const)("%s는 CPU/Worker 전용 커널이므로 WebGPU가 픽셀을 일부만 처리하지 않는다", async (
    _label,
    fields,
  ) => {
    const harness = createFakeGpu();
    const result = await applyGpuFilterChain(
      imageData(),
      fields,
      { gpu: harness.gpu },
    );
    expect(result).toBeNull();
    expect(harness.requestAdapter).not.toHaveBeenCalled();
  });

  it("손상된 imageData(치수·바이트 불일치)는 null", async () => {
    const harness = createFakeGpu();
    const broken = { data: new Uint8ClampedArray(8), width: 4, height: 3 };
    expect(await applyGpuFilterChain(broken, { brightness: 0.2 }, { gpu: harness.gpu })).toBeNull();
    expect(harness.requestAdapter).not.toHaveBeenCalled();
  });

  it("버퍼 생성이 던지면 예외를 삼키고 null", async () => {
    const harness = createFakeGpu({ createBufferThrows: true });
    expect(await applyGpuFilterChain(imageData(), { brightness: 0.2 }, { gpu: harness.gpu })).toBeNull();
  });

  it("검증 오류(error scope)가 잡히면 '무필터 픽셀'을 성공으로 돌려주지 않고 null", async () => {
    const harness = createFakeGpu();
    harness.popErrorScopeResults = [{ message: "validation failed" }, null];
    expect(await applyGpuFilterChain(imageData(), { brightness: 0.2 }, { gpu: harness.gpu })).toBeNull();
  });

  it("가우시안 float4 scratch가 storage/buffer limit을 넘으면 할당 전에 CPU 폴백한다", async () => {
    const harness = createFakeGpu({
      limits: {
        // 4x3 packed=48 bytes는 들어가지만 float4 scratch=192 bytes는 들어가지 않는다.
        maxStorageBufferBindingSize: 100,
        maxBufferSize: 100,
      },
    });
    const result = await applyGpuFilterChain(
      imageData(),
      { blurFx: { type: "gaussian", strength: 100, radius: 40, angle: 0 } },
      { gpu: harness.gpu },
    );
    expect(result).toBeNull();
    expect(harness.requestAdapter).toHaveBeenCalledTimes(1);
    expect(harness.createBuffer).not.toHaveBeenCalled();
  });

  it("workgroup 크기나 2D dispatch limit을 넘으면 제출하지 않고 CPU 폴백한다", async () => {
    const tooSmallWorkgroup = createFakeGpu({
      limits: { maxComputeInvocationsPerWorkgroup: 32, maxComputeWorkgroupSizeX: 32 },
    });
    expect(await applyGpuFilterChain(
      imageData(),
      { brightness: 0.2 },
      { gpu: tooSmallWorkgroup.gpu },
    )).toBeNull();
    expect(tooSmallWorkgroup.createBuffer).not.toHaveBeenCalled();

    const tooFewRows = createFakeGpu({
      limits: { maxComputeWorkgroupsPerDimension: 256 },
    });
    expect(await applyGpuFilterChain(
      imageData(4_194_305, 1),
      { brightness: 0.2 },
      { gpu: tooFewRows.gpu },
    )).toBeNull();
    expect(tooFewRows.createBuffer).not.toHaveBeenCalled();

    const tooNarrowDispatch = createFakeGpu({
      limits: { maxComputeWorkgroupsPerDimension: 128 },
    });
    expect(await applyGpuFilterChain(
      imageData(),
      { brightness: 0.2 },
      { gpu: tooNarrowDispatch.gpu },
    )).toBeNull();
    expect(tooNarrowDispatch.createBuffer).not.toHaveBeenCalled();
  });

  it("이미 취소됐거나 stale인 요청은 디바이스 획득 전 fail-closed한다", async () => {
    const abortedHarness = createFakeGpu();
    const controller = new AbortController();
    controller.abort();
    expect(await applyGpuFilterChain(
      imageData(),
      { brightness: 0.2 },
      { gpu: abortedHarness.gpu, signal: controller.signal },
    )).toBeNull();
    expect(abortedHarness.requestAdapter).not.toHaveBeenCalled();

    const staleHarness = createFakeGpu();
    const isSourceRevisionCurrent = vi.fn(() => false);
    expect(await applyGpuFilterChain(
      imageData(),
      { brightness: 0.2 },
      {
        gpu: staleHarness.gpu,
        sourceRevision: 7,
        isSourceRevisionCurrent,
      },
    )).toBeNull();
    expect(isSourceRevisionCurrent).toHaveBeenCalledWith(7);
    expect(staleHarness.requestAdapter).not.toHaveBeenCalled();
  });

  it("GPU 제출 뒤 revision이 stale해져도 readback 픽셀을 게시하지 않는다", async () => {
    const harness = createFakeGpu();
    let checks = 0;
    const isSourceRevisionCurrent = vi.fn(() => {
      checks += 1;
      return checks < 4;
    });
    expect(await applyGpuFilterChain(
      imageData(),
      { brightness: 0.2 },
      {
        gpu: harness.gpu,
        sourceRevision: "rev-a",
        isSourceRevisionCurrent,
      },
    )).toBeNull();
    expect(harness.dispatchCalls).toHaveLength(1);
    expect(isSourceRevisionCurrent).toHaveBeenCalledWith("rev-a");
  });

  it("제출 중 device loss가 발생하면 readback 결과를 게시하지 않고 null", async () => {
    const harness = createFakeGpu({ loseOnPopErrorScope: true });
    expect(await applyGpuFilterChain(
      imageData(),
      { morphology: { mode: "dilate", radius: 2 } },
      { gpu: harness.gpu },
    )).toBeNull();
    expect(harness.dispatchCalls).toHaveLength(2);
  });

  it("가우시안은 packed 2개+float4 2개를 사용하고 모든 분리 패스를 디스패치한다", async () => {
    const harness = createFakeGpu();
    const img = imageData(5, 3);
    const el: ImageFilterFields = {
      blurFx: { type: "gaussian", strength: 73, radius: 6, angle: 0 },
    };
    const plan = planStudioGpuFilterChain(el);
    expect(plan).not.toBeNull();
    expect(plan).toHaveLength(8);

    const result = await applyGpuFilterChain(img, el, { gpu: harness.gpu });
    expect(result).not.toBeNull();
    expect(harness.dispatchCalls).toHaveLength(8);
    const sizes = harness.createBuffer.mock.calls.map(([descriptor]) => (
      descriptor as { size: number }
    ).size);
    // packed ping/pong (60) + float4 ping/pong (240); other small entries are uniforms/readback.
    expect(sizes.filter((size) => size === 60)).toHaveLength(3);
    expect(sizes.filter((size) => size === 240)).toHaveLength(2);
  });

  it("정상 경로 — 스텝 수만큼 디스패치하고 치수 보존 버퍼를 돌려준다", async () => {
    const harness = createFakeGpu();
    const img = imageData(5, 4);
    const el: ImageFilterFields = {
      brightness: 0.2,
      colorBalance: { shadows: [10, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0] },
    };
    const plan = planStudioGpuFilterChain(el);
    expect(plan).not.toBeNull();

    const result = await applyGpuFilterChain(img, el, { gpu: harness.gpu });
    expect(result).not.toBeNull();
    expect(result!.width).toBe(5);
    expect(result!.height).toBe(4);
    expect(result!.data).toBeInstanceOf(Uint8ClampedArray);
    expect(result!.data.length).toBe(5 * 4 * 4);
    // 입력 버퍼는 변형하지 않는다(새 버퍼 반환).
    expect(result!.data).not.toBe(img.data);
    expect(harness.dispatchCalls.length).toBe(plan!.length);
    // 2D 디스패치 그리드: x=16384/64=256, y=ceil(20/16384)=1.
    for (const [x, y] of harness.dispatchCalls) {
      expect(x).toBe(256);
      expect(y).toBe(1);
    }
  });
});

describe("studio-gpu-filter-apply: retained interactive presentation", () => {
  function presentationSurface() {
    const canvas = { height: 3, width: 4 } as unknown as HTMLCanvasElement;
    const present = vi.fn<StudioGpuFilterPresentationSurface["present"]>(async () => ({
      status: "presented",
      revision: 1,
    }));
    const dispose = vi.fn();
    return {
      canvas,
      dispose,
      present,
      revision: 0,
    } satisfies StudioGpuFilterPresentationSurface;
  }

  it("hands GPUCanvasContext the native fabric device instead of the lifecycle facade", async () => {
    const harness = createFakeGpu();
    const surface = presentationSurface();
    vi.stubGlobal("navigator", { gpu: harness.gpu });

    const frame = await presentGpuFilterChain(
      imageData(),
      { brightness: 0.2 },
      { surface },
    );

    expect(frame).not.toBeNull();
    expect(surface.present).toHaveBeenCalledWith(expect.objectContaining({
      device: harness.device,
    }));
    expect(harness.requestAdapter).toHaveBeenCalledTimes(1);
    expect(harness.requestDevice).toHaveBeenCalledTimes(1);
    expect(harness.destroyDevice).not.toHaveBeenCalled();
    frame!.dispose();
  });

  it("publishes the GPU canvas without mapping a staging buffer, then reads once after settle", async () => {
    const harness = createFakeGpu();
    const surface = presentationSurface();
    const frame = await presentGpuFilterChain(
      imageData(),
      { brightness: 0.2 },
      { gpu: harness.gpu, sourceRevision: "slider-7", surface },
    );

    expect(frame).not.toBeNull();
    expect(frame!.canvas).toBe(surface.canvas);
    expect(frame!.sourceRevision).toBe("slider-7");
    expect(surface.present).toHaveBeenCalledTimes(1);
    const buffersBeforeSettle = harness.createBuffer.mock.results
      .map((result) => result.value as { mapAsync: ReturnType<typeof vi.fn> });
    expect(buffersBeforeSettle.every((buffer) => buffer.mapAsync.mock.calls.length === 0)).toBe(true);
    expect(harness.destroyDevice).not.toHaveBeenCalled();

    const canonical = await frame!.readbackFinal();
    expect(canonical).not.toBeNull();
    expect(canonical).toMatchObject({ width: 4, height: 3 });
    const buffersAfterSettle = harness.createBuffer.mock.results
      .map((result) => result.value as { mapAsync: ReturnType<typeof vi.fn> });
    expect(buffersAfterSettle.reduce(
      (count, buffer) => count + buffer.mapAsync.mock.calls.length,
      0,
    )).toBe(1);
    expect(harness.destroyDevice).toHaveBeenCalledTimes(1);
    expect(await frame!.readbackFinal()).toBe(canonical);
  });

  it("drops a superseded preview without any final readback and reports presentation failure", async () => {
    const harness = createFakeGpu();
    const surface = presentationSurface();
    const frame = await presentGpuFilterChain(
      imageData(),
      { brightness: 0.4 },
      { gpu: harness.gpu, surface },
    );
    expect(frame).not.toBeNull();
    frame!.dispose();
    frame!.dispose();

    const mapped = harness.createBuffer.mock.results
      .map((result) => result.value as { mapAsync: ReturnType<typeof vi.fn> })
      .reduce((count, buffer) => count + buffer.mapAsync.mock.calls.length, 0);
    expect(mapped).toBe(0);
    expect(await frame!.readbackFinal()).toBeNull();
    expect(harness.destroyDevice).toHaveBeenCalledTimes(1);

    const failedHarness = createFakeGpu();
    const failedSurface = presentationSurface();
    failedSurface.present.mockResolvedValueOnce({
      status: "unavailable",
      reason: "context lost",
    });
    const onFailure = vi.fn();
    await expect(presentGpuFilterChain(
      imageData(),
      { brightness: 0.6 },
      { gpu: failedHarness.gpu, onFailure, surface: failedSurface },
    )).resolves.toBeNull();
    expect(onFailure).toHaveBeenCalledWith({
      phase: "presentation",
      message: "context lost",
    });
  });
});
