import { afterEach, describe, expect, it, vi } from "vitest";

import { resetStudioReliabilityStatus } from "../studio-reliability-status-store";
import { disposeStudioSafeModeRuntime } from "../studio-safe-mode-runtime";

import {
  STUDIO_CANONICAL_FILTER_CURVE_INTERPOLATION,
  STUDIO_CANONICAL_FILTER_CURVE_LUT_SIZE,
  STUDIO_CANONICAL_FILTER_GAUSSIAN_TRUNCATE,
  rebuildStudioCanonicalFilterRecipe,
  planStudioCanonicalFilterExecution,
  studioCanonicalFilterGaussianRadius,
} from "./studio-engine-canonical-filter-plan";
import {
  STUDIO_ENGINE_WEBGPU_FILTER_CURVES_WGSL,
  STUDIO_ENGINE_WEBGPU_FILTER_GAUSSIAN_WGSL,
  STUDIO_ENGINE_WEBGPU_FILTER_KERNELS,
  STUDIO_ENGINE_WEBGPU_FILTER_MATRIX_WGSL,
  STUDIO_ENGINE_WEBGPU_FILTER_MORPHOLOGY_WGSL,
  STUDIO_ENGINE_WEBGPU_FILTER_POINT_WGSL,
  STUDIO_ENGINE_WEBGPU_FILTER_TEXTURE_FORMAT,
  STUDIO_ENGINE_WEBGPU_FILTER_UNSHARP_WGSL,
  StudioEngineWebGpuFilterRuntime,
} from "./studio-engine-webgpu-filter-runtime";

import type {
  StudioCanonicalFilterExecutionPlan,
  StudioCanonicalFilterOperationNode,
  StudioCanonicalFilterRecipe,
} from "./studio-engine-canonical-filter-plan";
import type {
  StudioEngineWebGpuFilterExecutionRequest,
} from "./studio-engine-webgpu-filter-runtime";

// 디바이스 로스 고지는 세션 단위 Safe Mode 상태기계를 세운다(백오프 타이머 포함).
// 테스트마다 내려서 타이머와 전역 신호가 다음 테스트로 새지 않게 한다.
afterEach(() => {
  disposeStudioSafeModeRuntime();
  resetStudioReliabilityStatus();
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

interface FakeGpuHarness {
  readonly device: GPUDevice;
  readonly lost: Deferred<GPUDeviceLostInfo>;
  readonly fence: Deferred<void>;
  readonly createShaderModule: ReturnType<typeof vi.fn>;
  readonly createComputePipeline: ReturnType<typeof vi.fn>;
  readonly createTexture: ReturnType<typeof vi.fn>;
  readonly createBuffer: ReturnType<typeof vi.fn>;
  readonly createBindGroup: ReturnType<typeof vi.fn>;
  readonly beginComputePass: ReturnType<typeof vi.fn>;
  readonly dispatchWorkgroups: ReturnType<typeof vi.fn>;
  readonly copyTextureToTexture: ReturnType<typeof vi.fn>;
  readonly writeBuffer: ReturnType<typeof vi.fn>;
  readonly submit: ReturnType<typeof vi.fn>;
  readonly onSubmittedWorkDone: ReturnType<typeof vi.fn>;
  readonly destroyDevice: ReturnType<typeof vi.fn>;
}

function createFakeGpu(options: { readonly immediateFence?: boolean } = {}): FakeGpuHarness {
  const lost = deferred<GPUDeviceLostInfo>();
  const fence = deferred<void>();
  const createShaderModule = vi.fn((descriptor: GPUShaderModuleDescriptor) => ({
    label: descriptor.label,
  }));
  const createComputePipeline = vi.fn((descriptor: GPUComputePipelineDescriptor) => ({
    label: descriptor.label,
    getBindGroupLayout: vi.fn(() => ({})),
  }));
  const createTexture = vi.fn((descriptor: GPUTextureDescriptor) => ({
    label: descriptor.label,
    descriptor,
    createView: vi.fn(() => ({ textureLabel: descriptor.label })),
    destroy: vi.fn(),
  }));
  const createBuffer = vi.fn((descriptor: GPUBufferDescriptor) => ({
    label: descriptor.label,
    descriptor,
    destroy: vi.fn(),
  }));
  const createBindGroup = vi.fn((descriptor: GPUBindGroupDescriptor) => ({
    label: descriptor.label,
  }));
  const dispatchWorkgroups = vi.fn();
  const computePass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    dispatchWorkgroups,
    end: vi.fn(),
  };
  const beginComputePass = vi.fn(() => computePass);
  const copyTextureToTexture = vi.fn();
  const encoder = {
    beginComputePass,
    copyTextureToTexture,
    finish: vi.fn(() => ({ commandBuffer: true })),
  };
  const writeBuffer = vi.fn();
  const submit = vi.fn();
  const onSubmittedWorkDone = vi.fn(() =>
    options.immediateFence ? Promise.resolve() : fence.promise
  );
  const destroyDevice = vi.fn();
  const device = {
    createShaderModule,
    createComputePipeline,
    createTexture,
    createBuffer,
    createBindGroup,
    createCommandEncoder: vi.fn(() => encoder),
    queue: { writeBuffer, submit, onSubmittedWorkDone },
    limits: {
      maxTextureDimension2D: 16_384,
      maxComputeWorkgroupsPerDimension: 65_535,
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
    },
    lost: lost.promise,
    destroy: destroyDevice,
  } as unknown as GPUDevice;
  return {
    device,
    lost,
    fence,
    createShaderModule,
    createComputePipeline,
    createTexture,
    createBuffer,
    createBindGroup,
    beginComputePass,
    dispatchWorkgroups,
    copyTextureToTexture,
    writeBuffer,
    submit,
    onSubmittedWorkDone,
    destroyDevice,
  };
}

function fakeTexture(
  label: string,
  width: number,
  height: number,
  usage: number,
): GPUTexture {
  return {
    label,
    width,
    height,
    depthOrArrayLayers: 1,
    mipLevelCount: 1,
    sampleCount: 1,
    dimension: "2d",
    format: "rgba16float",
    usage,
    createView: vi.fn(() => ({ label: `${label}-view` })),
    destroy: vi.fn(),
  } as unknown as GPUTexture;
}

function exposureRecipe(): StudioCanonicalFilterRecipe {
  return rebuildStudioCanonicalFilterRecipe(
    { recipeId: "gpu-exposure" },
    [{
      id: "exposure",
      kind: "exposure-contrast",
      input: "source",
      exposureStops: 0.5,
      contrast: 1.1,
      pivot: 0.18,
    }],
  );
}

function readyPlan(
  recipe: StudioCanonicalFilterRecipe,
  width = 4,
  height = 4,
  tileSize = 2,
): StudioCanonicalFilterExecutionPlan {
  const result = planStudioCanonicalFilterExecution(recipe, width, height, { tileSize });
  if (result.status !== "ready") throw new Error(`test plan rejected: ${result.reason}`);
  return result.plan;
}

function requestFor(
  recipe: StudioCanonicalFilterRecipe,
  plan: StudioCanonicalFilterExecutionPlan,
  sequence: number,
  overrides: Partial<StudioEngineWebGpuFilterExecutionRequest> = {},
): StudioEngineWebGpuFilterExecutionRequest {
  return {
    recipe,
    plan,
    sourceTexture: fakeTexture("source", plan.width, plan.height, 0x01 | 0x04),
    targetTexture: fakeTexture("target", plan.width, plan.height, 0x02),
    requestSequence: sequence,
    requestEpoch: 1,
    deviceEpoch: 1,
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("future WebGPU filter shaders", () => {
  it("declare RGBA16F tiled halo reads and explicit premultiplied colour boundaries", () => {
    expect(STUDIO_ENGINE_WEBGPU_FILTER_TEXTURE_FORMAT).toBe("rgba16float");
    expect(STUDIO_ENGINE_WEBGPU_FILTER_GAUSSIAN_WGSL).toContain(
      "texture_storage_2d<rgba16float, write>",
    );
    expect(STUDIO_ENGINE_WEBGPU_FILTER_GAUSSIAN_WGSL).toContain("load_border");
    expect(STUDIO_ENGINE_WEBGPU_FILTER_GAUSSIAN_WGSL).toContain("reflect_axis");
    expect(STUDIO_ENGINE_WEBGPU_FILTER_GAUSSIAN_WGSL).toContain("tile_origin");
    expect(STUDIO_ENGINE_WEBGPU_FILTER_GAUSSIAN_WGSL).toContain("gaussian_weights");
    expect(STUDIO_ENGINE_WEBGPU_FILTER_UNSHARP_WGSL).toContain("unpremultiply");
    expect(STUDIO_ENGINE_WEBGPU_FILTER_UNSHARP_WGSL).toContain("premultiply");
    expect(STUDIO_ENGINE_WEBGPU_FILTER_CURVES_WGSL).toContain("curve_sample");
    expect(STUDIO_ENGINE_WEBGPU_FILTER_POINT_WGSL).toContain("apply_levels");
    expect(STUDIO_ENGINE_WEBGPU_FILTER_POINT_WGSL).toContain(
      "floor(clamp(rgb, vec3f(0.0), vec3f(1.0)) * scale + vec3f(0.5))",
    );
    expect(STUDIO_ENGINE_WEBGPU_FILTER_MATRIX_WGSL).toContain("coefficients");
    expect(STUDIO_ENGINE_WEBGPU_FILTER_MORPHOLOGY_WGSL).toContain("best_alpha");
    expect(STUDIO_ENGINE_WEBGPU_FILTER_MORPHOLOGY_WGSL).toContain(
      "select((sample.a < best_alpha), (sample.a > best_alpha), use_max)",
    );
    expect(Object.keys(STUDIO_ENGINE_WEBGPU_FILTER_KERNELS)).toEqual([
      "gaussian",
      "unsharp",
      "point",
      "matrix",
      "curves",
      "morphology",
    ]);
  });
});

describe("future WebGPU filter runtime", () => {
  it("submits one bounded compute dispatch per planned tile and returns a quality receipt", async () => {
    const harness = createFakeGpu({ immediateFence: true });
    const runtime = new StudioEngineWebGpuFilterRuntime({ device: harness.device });
    const recipe = exposureRecipe();
    const plan = readyPlan(recipe);
    const result = await runtime.execute(requestFor(recipe, plan, 1));

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.receipt).toMatchObject({
      backend: "webgpu",
      textureFormat: "rgba16float",
      workingSpace: "linear-display-p3",
      storageAlphaMode: "premultiplied",
      filterMathAlphaMode: "straight",
      stageCount: 1,
      dispatchCount: 4,
      queueState: "completed",
      complete: true,
    });
    expect(harness.createTexture).toHaveBeenCalledTimes(1);
    expect(harness.createTexture.mock.calls[0]![0]).toMatchObject({
      format: "rgba16float",
      size: { width: 4, height: 4, depthOrArrayLayers: 1 },
    });
    expect(harness.beginComputePass).toHaveBeenCalledTimes(1);
    expect(harness.dispatchWorkgroups).toHaveBeenCalledTimes(4);
    expect(harness.createBindGroup).toHaveBeenCalledTimes(4);
    expect(harness.copyTextureToTexture).toHaveBeenCalledTimes(1);
    expect(harness.submit).toHaveBeenCalledTimes(1);
    expect(runtime.getStats()).toMatchObject({
      status: "ready",
      submitted: 1,
      completed: 1,
      inFlight: 0,
      pipelineCount: 1,
    });
  });

  it("lowers every supported production foundation without substituting another node", async () => {
    const identity = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ] as const;
    const sigma = 0.75;
    const operations: readonly StudioCanonicalFilterOperationNode[] = [
      {
        id: "exposure",
        kind: "exposure-contrast",
        input: "source",
        exposureStops: 0.2,
        contrast: 1.1,
        pivot: 0.18,
      },
      {
        id: "levels",
        kind: "levels",
        input: "exposure",
        inputBlack: [0, 0, 0],
        inputWhite: [1, 1, 1],
        gamma: [1, 1, 1],
        outputBlack: [0, 0, 0],
        outputWhite: [1, 1, 1],
      },
      {
        id: "curves",
        kind: "curves",
        input: "levels",
        interpolation: STUDIO_CANONICAL_FILTER_CURVE_INTERPOLATION,
        lutSize: STUDIO_CANONICAL_FILTER_CURVE_LUT_SIZE,
        rgb: identity,
        red: identity,
        green: identity,
        blue: identity,
      },
      {
        id: "matrix",
        kind: "color-matrix",
        input: "curves",
        matrix: [
          1, 0, 0, 0, 0,
          0, 1, 0, 0, 0,
          0, 0, 1, 0, 0,
          0, 0, 0, 1, 0,
        ],
      },
      {
        id: "mixer",
        kind: "channel-mixer",
        input: "matrix",
        matrix: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
        ],
      },
      {
        id: "threshold",
        kind: "threshold",
        input: "mixer",
        threshold: 0.4,
        mode: "luminance",
      },
      {
        id: "posterize",
        kind: "posterize",
        input: "threshold",
        levels: 8,
      },
      {
        id: "blur",
        kind: "gaussian-blur",
        input: "posterize",
        sigma,
        radius: studioCanonicalFilterGaussianRadius(sigma),
        truncate: STUDIO_CANONICAL_FILTER_GAUSSIAN_TRUNCATE,
        borderMode: "reflect",
      },
      {
        id: "unsharp",
        kind: "unsharp-mask",
        input: "blur",
        sigma,
        radius: studioCanonicalFilterGaussianRadius(sigma),
        truncate: STUDIO_CANONICAL_FILTER_GAUSSIAN_TRUNCATE,
        amount: 0.75,
        threshold: 0.01,
        borderMode: "transparent",
      },
      {
        id: "morph",
        kind: "morphology",
        input: "unsharp",
        operation: "max",
        metric: "alpha",
        radius: 1,
        borderMode: "clamp",
      },
    ];
    const recipe = rebuildStudioCanonicalFilterRecipe({ recipeId: "all-foundations" }, operations);
    const plan = readyPlan(recipe, 2, 2, 2);
    const harness = createFakeGpu({ immediateFence: true });
    const runtime = new StudioEngineWebGpuFilterRuntime({ device: harness.device });
    const result = await runtime.execute(requestFor(recipe, plan, 1));

    expect(result.status).toBe("completed");
    expect(runtime.getStats().pipelineCount).toBe(6);
    expect(harness.createComputePipeline).toHaveBeenCalledTimes(6);
    expect(harness.copyTextureToTexture).toHaveBeenCalledTimes(1);
    expect(harness.dispatchWorkgroups).toHaveBeenCalledTimes(plan.dispatchCount);
  });

  it("applies queue backpressure and invalidates an in-flight request by epoch", async () => {
    const harness = createFakeGpu();
    const runtime = new StudioEngineWebGpuFilterRuntime({
      device: harness.device,
      budgets: { maxInFlightSubmissions: 1 },
    });
    const recipe = exposureRecipe();
    const plan = readyPlan(recipe);
    const first = runtime.execute(requestFor(recipe, plan, 1));
    await flushMicrotasks();
    expect(harness.submit).toHaveBeenCalledTimes(1);

    expect(await runtime.execute(requestFor(recipe, plan, 2))).toEqual({
      status: "rejected",
      reason: "gpu-backpressure",
    });
    expect(runtime.invalidateRequests()).toBe(2);
    harness.fence.resolve();
    expect(await first).toEqual({
      status: "rejected",
      reason: "request-epoch-mismatch",
    });
    expect(runtime.getStats()).toMatchObject({ completed: 1, inFlight: 0, requestEpoch: 2 });
  });

  it("observes AbortSignal after submission and never upgrades cancellation to success", async () => {
    const harness = createFakeGpu();
    const runtime = new StudioEngineWebGpuFilterRuntime({ device: harness.device });
    const recipe = exposureRecipe();
    const plan = readyPlan(recipe);
    const controller = new AbortController();
    const execution = runtime.execute(
      requestFor(recipe, plan, 1, { signal: controller.signal }),
    );
    await flushMicrotasks();
    controller.abort();
    harness.fence.resolve();
    expect(await execution).toEqual({ status: "rejected", reason: "cancelled" });
  });

  it("fails closed on device loss and advances the device epoch", async () => {
    const harness = createFakeGpu({ immediateFence: true });
    const lost = vi.fn();
    const runtime = new StudioEngineWebGpuFilterRuntime({
      device: harness.device,
      onDeviceLost: lost,
    });
    harness.lost.resolve({
      reason: "unknown",
      message: "test loss",
    } as GPUDeviceLostInfo);
    await flushMicrotasks();

    const recipe = exposureRecipe();
    const plan = readyPlan(recipe);
    expect(await runtime.execute(requestFor(recipe, plan, 1))).toEqual({
      status: "rejected",
      reason: "device-lost",
    });
    expect(runtime.getStats()).toMatchObject({
      status: "device-lost",
      deviceEpoch: 2,
      submitted: 0,
    });
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it("rejects recipe/plan mismatch, unsupported nodes and resource overcommit", async () => {
    const harness = createFakeGpu({ immediateFence: true });
    const runtime = new StudioEngineWebGpuFilterRuntime({
      device: harness.device,
      budgets: { maxIntermediateBytes: 64 },
    });
    const recipe = exposureRecipe();
    const plan = readyPlan(recipe);
    const mismatchedPlan = { ...plan, recipeHash: `sha256:${"0".repeat(64)}` };
    expect(await runtime.execute(requestFor(recipe, mismatchedPlan, 1))).toEqual({
      status: "rejected",
      reason: "recipe-plan-mismatch",
    });

    const unsupported = {
      ...recipe,
      nodes: [
        recipe.nodes[0],
        { id: "unsupported", kind: "legacy-byte-filter", input: "source" },
      ],
      outputNodeId: "unsupported",
    } as unknown as StudioCanonicalFilterRecipe;
    expect(await runtime.execute(requestFor(unsupported, plan, 2))).toEqual({
      status: "rejected",
      reason: "unsupported-node",
    });

    expect(await runtime.execute(requestFor(recipe, plan, 3))).toEqual({
      status: "rejected",
      reason: "resource-budget-exceeded",
    });
    expect(harness.submit).not.toHaveBeenCalled();
  });

  it("rejects non-RGBA16F or incorrectly sized external textures before encoding", async () => {
    const harness = createFakeGpu({ immediateFence: true });
    const runtime = new StudioEngineWebGpuFilterRuntime({ device: harness.device });
    const recipe = exposureRecipe();
    const plan = readyPlan(recipe);
    const incompatibleTarget = {
      ...fakeTexture("encoded-target", plan.width, plan.height, 0x02),
      format: "rgba8unorm",
    } as unknown as GPUTexture;

    expect(
      await runtime.execute(
        requestFor(recipe, plan, 1, { targetTexture: incompatibleTarget }),
      ),
    ).toEqual({ status: "rejected", reason: "incompatible-texture" });
    expect(harness.submit).not.toHaveBeenCalled();
  });

  it("turns a rejected queue fence into a terminal failed runtime", async () => {
    const harness = createFakeGpu();
    const runtime = new StudioEngineWebGpuFilterRuntime({ device: harness.device });
    const recipe = exposureRecipe();
    const plan = readyPlan(recipe);
    const execution = runtime.execute(requestFor(recipe, plan, 1));
    await flushMicrotasks();
    harness.fence.reject(new Error("queue failed"));
    expect(await execution).toEqual({ status: "rejected", reason: "queue-failed" });
    expect(runtime.getStats()).toMatchObject({ status: "failed", inFlight: 0 });
    expect(await runtime.execute(requestFor(recipe, plan, 2))).toEqual({
      status: "rejected",
      reason: "runtime-failed",
    });
  });

  it("destroys an owned device exactly once on disposal", () => {
    const harness = createFakeGpu({ immediateFence: true });
    const runtime = new StudioEngineWebGpuFilterRuntime({
      device: harness.device,
      ownsDevice: true,
    });
    runtime.dispose();
    runtime.dispose();
    expect(harness.destroyDevice).toHaveBeenCalledTimes(1);
    expect(runtime.getStats().status).toBe("disposed");
  });
});
