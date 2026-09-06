import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_DUAL_TIP_PACKED_LAYOUT,
  STUDIO_DUAL_TIP_PACKED_STRIDE,
} from "./studio-dual-brush-tip-engine";
import {
  buildStudioDynamicDualTipExactPlanV2,
  buildStudioDynamicDualTipExactPlanV2FromPackedCommands,
  createStudioDynamicDualTipExactWebGpuRuntimeV2,
  packStudioDynamicDualTipExactDepositionsV2,
  selectStudioDynamicDualTipExactExecutionRoute,
  STUDIO_DYNAMIC_DUAL_TIP_EXACT_EXECUTION_ROUTE,
  STUDIO_DYNAMIC_DUAL_TIP_EXACT_PROVIDER_CAPABILITY,
  STUDIO_DYNAMIC_DUAL_TIP_EXACT_WEBGPU_INSTANCE_FLOATS,
} from "./studio-dynamic-dual-tip-webgpu-runtime-v2";

import type {
  StudioDualTipPackedCommands,
} from "./studio-dual-brush-tip-engine";
import type {
  StudioDynamicDualTipExactDepositionInputV2,
  StudioDynamicDualTipExactPlanV2,
} from "./studio-dynamic-dual-tip-webgpu-runtime-v2";

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

interface FakeGpuHarness {
  readonly device: GPUDevice;
  readonly lost: Deferred<GPUDeviceLostInfo>;
  readonly shaders: GPUShaderModuleDescriptor[];
  readonly pipelines: GPURenderPipelineDescriptor[];
  readonly textures: Array<{
    readonly descriptor: GPUTextureDescriptor;
    readonly destroy: ReturnType<typeof vi.fn>;
  }>;
  readonly buffers: Array<{
    readonly descriptor: GPUBufferDescriptor;
    readonly destroy: ReturnType<typeof vi.fn>;
  }>;
  readonly passes: Array<{
    readonly descriptor: GPURenderPassDescriptor;
    readonly setPipeline: ReturnType<typeof vi.fn>;
    readonly setBindGroup: ReturnType<typeof vi.fn>;
    readonly draw: ReturnType<typeof vi.fn>;
    readonly end: ReturnType<typeof vi.fn>;
  }>;
  readonly writeBuffer: ReturnType<typeof vi.fn>;
  readonly writeTexture: ReturnType<typeof vi.fn>;
  readonly submit: ReturnType<typeof vi.fn>;
  readonly destroyDevice: ReturnType<typeof vi.fn>;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function fakeGpu(
  fence: () => Promise<void> = async () => undefined,
): FakeGpuHarness {
  const lost = deferred<GPUDeviceLostInfo>();
  const shaders: GPUShaderModuleDescriptor[] = [];
  const pipelines: GPURenderPipelineDescriptor[] = [];
  const textures: FakeGpuHarness["textures"] = [];
  const buffers: FakeGpuHarness["buffers"] = [];
  const passes: FakeGpuHarness["passes"] = [];
  const writeBuffer = vi.fn();
  const writeTexture = vi.fn();
  const submit = vi.fn();
  const destroyDevice = vi.fn();
  const device = {
    limits: { maxStorageBufferBindingSize: 32 * 1024 * 1024 },
    lost: lost.promise,
    queue: {
      writeBuffer,
      writeTexture,
      submit,
      onSubmittedWorkDone: vi.fn(fence),
    },
    createTexture: vi.fn((descriptor: GPUTextureDescriptor) => {
      const destroy = vi.fn();
      textures.push({ descriptor, destroy });
      return {
        createView: vi.fn(() => ({ label: descriptor.label })),
        destroy,
      } as unknown as GPUTexture;
    }),
    createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => {
      const destroy = vi.fn();
      buffers.push({ descriptor, destroy });
      return { destroy } as unknown as GPUBuffer;
    }),
    createSampler: vi.fn((descriptor: GPUSamplerDescriptor) => ({ descriptor })),
    createShaderModule: vi.fn((descriptor: GPUShaderModuleDescriptor) => {
      shaders.push(descriptor);
      return { descriptor };
    }),
    createBindGroupLayout: vi.fn((descriptor: GPUBindGroupLayoutDescriptor) => ({
      descriptor,
    })),
    createPipelineLayout: vi.fn((descriptor: GPUPipelineLayoutDescriptor) => ({
      descriptor,
    })),
    createRenderPipeline: vi.fn((descriptor: GPURenderPipelineDescriptor) => {
      pipelines.push(descriptor);
      return { descriptor };
    }),
    createBindGroup: vi.fn((descriptor: GPUBindGroupDescriptor) => ({ descriptor })),
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass: vi.fn((descriptor: GPURenderPassDescriptor) => {
        const pass = {
          descriptor,
          setPipeline: vi.fn(),
          setBindGroup: vi.fn(),
          draw: vi.fn(),
          end: vi.fn(),
        };
        passes.push(pass);
        return pass;
      }),
      finish: vi.fn(() => ({ encoded: true })),
    })),
    destroy: destroyDevice,
  } as unknown as GPUDevice;
  return {
    device,
    lost,
    shaders,
    pipelines,
    textures,
    buffers,
    passes,
    writeBuffer,
    writeTexture,
    submit,
    destroyDevice,
  };
}

const PRIMARY_ASSET = {
  assetId: "primary-r8",
  width: 2,
  height: 2,
  channel: "alpha" as const,
  bytes: new Uint8Array([255, 128, 64, 0]),
};

const SECONDARY_ASSET = {
  assetId: "secondary-r8",
  width: 2,
  height: 2,
  channel: "alpha" as const,
  bytes: new Uint8Array([0, 64, 128, 255]),
};

function deposition(
  index: number,
  porterDuff: "source-over" | "destination-out" = "source-over",
): StudioDynamicDualTipExactDepositionInputV2 {
  return {
    primary: {
      center: [10 + index * 3, 12],
      localToDocument: [4, 1, -0.5, 3],
      maskOpacity: 0.8,
      hardness: -1,
    },
    secondary: {
      center: [11 + index * 3, 13],
      localToDocument: [3, -0.5, 1, 2],
      maskOpacity: 0.7,
      hardness: 0.5,
    },
    paintAlpha: 0.2 + index * 0.1,
    linearColor: [0.2 + index * 0.1, 0.5, 0.8],
    blendFamily: index === 0 ? "multiply" : index === 1 ? "screen" : "difference",
    porterDuff,
  };
}

function exactPlan(
  mode: "append" | "rebuild" = "rebuild",
  commandSequence = 1,
): StudioDynamicDualTipExactPlanV2 {
  const result = buildStudioDynamicDualTipExactPlanV2({
    mode,
    strokeId: "exact-dual-stroke",
    commandSequence,
    primaryAsset: PRIMARY_ASSET,
    secondaryAsset: SECONDARY_ASSET,
    depositions: [
      deposition(0),
      deposition(1, "destination-out"),
      deposition(2),
    ],
  });
  if (result.status !== "ready") throw new Error(result.reason);
  return result.plan;
}

function runtime(harness: FakeGpuHarness, overrides = {}) {
  const result = createStudioDynamicDualTipExactWebGpuRuntimeV2({
    device: harness.device,
    width: 64,
    height: 48,
    ...overrides,
  });
  if (result.status !== "ready") throw new Error(result.reason);
  return result.runtime;
}

function packedCommands(): StudioDualTipPackedCommands {
  const values = Array.from(
    { length: STUDIO_DUAL_TIP_PACKED_STRIDE * 2 },
    () => 0,
  );
  const set = (
    command: number,
    field: (typeof STUDIO_DUAL_TIP_PACKED_LAYOUT)[number],
    value: number,
  ) => {
    values[
      command * STUDIO_DUAL_TIP_PACKED_STRIDE
        + STUDIO_DUAL_TIP_PACKED_LAYOUT.indexOf(field)
    ] = value;
  };
  for (let command = 0; command < 2; command += 1) {
    set(command, "centerX", 10 + command * 4);
    set(command, "centerY", 12);
    set(command, "diameter", 8);
    set(command, "opacity", command === 0 ? 0.2 : 0.6);
    set(command, "primaryRotationRadians", 0.1);
    set(command, "primaryScaleX", 1);
    set(command, "primaryScaleY", 0.75);
    set(command, "secondaryRotationRadians", -0.2);
    set(command, "secondaryScaleX", 0.8);
    set(command, "secondaryScaleY", 1.2);
    set(command, "secondaryOffsetX", 1);
    set(command, "secondaryOffsetY", -2);
    set(command, "combineModeCode", command === 0 ? 0 : 5);
    set(command, "linearRed", command === 0 ? 0.2 : 0.9);
    set(command, "linearGreen", 0.4);
    set(command, "linearBlue", 0.7);
  }
  return {
    kind: "studio-dual-tip-packed-f32",
    layoutVersion: 1,
    scalar: "float32",
    byteOrder: "little-endian",
    stride: STUDIO_DUAL_TIP_PACKED_STRIDE,
    layout: STUDIO_DUAL_TIP_PACKED_LAYOUT,
    count: 2,
    values,
  };
}

describe("dynamic dual-tip exact WebGPU v2 plan", () => {
  it("converts CPU packed commands into one versioned record per logical deposition", () => {
    const result = buildStudioDynamicDualTipExactPlanV2FromPackedCommands({
      mode: "rebuild",
      strokeId: "packed-exact",
      commandSequence: 4,
      primaryAsset: PRIMARY_ASSET,
      secondaryAsset: SECONDARY_ASSET,
      commands: packedCommands(),
      porterDuff: ["source-over", "destination-out"],
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.plan).toMatchObject({
      version: 2,
      providerCapability: STUDIO_DYNAMIC_DUAL_TIP_EXACT_PROVIDER_CAPABILITY,
      executionRoute: STUDIO_DYNAMIC_DUAL_TIP_EXACT_EXECUTION_ROUTE,
      compositionOrder: "combine-same-deposition-then-premultiplied-authority",
    });
    expect(result.plan.depositions).toHaveLength(2);
    expect(result.plan.depositions[0]).toMatchObject({
      paintAlpha: Math.fround(0.2),
      linearColor: [Math.fround(0.2), Math.fround(0.4), Math.fround(0.7)],
      blendFamily: "multiply",
      porterDuff: "source-over",
    });
    expect(result.plan.depositions[1]).toMatchObject({
      blendFamily: "soft-intersect",
      porterDuff: "destination-out",
    });
    expect(result.plan.depositions[0]!.secondary.center).toEqual([
      Math.fround(11),
      Math.fround(10),
    ]);
  });

  it("packs union bounds, inverse transforms, varying paint and operation controls", () => {
    const plan = exactPlan();
    const packed = packStudioDynamicDualTipExactDepositionsV2(plan);

    expect(packed).toHaveLength(
      3 * STUDIO_DYNAMIC_DUAL_TIP_EXACT_WEBGPU_INSTANCE_FLOATS,
    );
    expect([...packed.slice(20, 25)]).toEqual([
      Math.fround(0.2),
      Math.fround(0.5),
      Math.fround(0.8),
      Math.fround(0.2),
      3,
    ]);
    expect(packed[STUDIO_DYNAMIC_DUAL_TIP_EXACT_WEBGPU_INSTANCE_FLOATS + 25]).toBe(1);
    expect([...packed.slice(0, 4)]).toEqual(plan.depositions[0]!.bounds);
  });

  it("selects WebGPU only for the exact v2 contract and keeps v1 on CPU authority", () => {
    expect(selectStudioDynamicDualTipExactExecutionRoute(exactPlan(), true)).toBe(
      STUDIO_DYNAMIC_DUAL_TIP_EXACT_EXECUTION_ROUTE,
    );
    expect(selectStudioDynamicDualTipExactExecutionRoute({
      kind: "studio-dynamic-dual-tip-plan",
      version: 1,
    }, true)).toBe("cpu-f32-oracle");
    expect(selectStudioDynamicDualTipExactExecutionRoute(exactPlan(), false)).toBe(
      "cpu-f32-oracle",
    );
  });
});

describe("dynamic dual-tip exact WebGPU v2 runtime", () => {
  it("combines both tips inside each fragment before ordered authority blending", async () => {
    const harness = fakeGpu();
    const target = runtime(harness);
    const result = await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: exactPlan(),
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.receipt).toMatchObject({
      providerCapability: STUDIO_DYNAMIC_DUAL_TIP_EXACT_PROVIDER_CAPABILITY,
      executionRoute: STUDIO_DYNAMIC_DUAL_TIP_EXACT_EXECUTION_ROUTE,
      compositionOrder: "combine-same-deposition-then-premultiplied-authority",
      exactness: "algorithmically-exact-deposition-order",
      depositionCount: 3,
      blendFamilies: ["multiply", "screen", "difference"],
      porterDuffOperations: ["source-over", "destination-out"],
      complete: true,
    });
    expect(harness.passes).toHaveLength(1);
    expect(harness.passes[0]!.descriptor.label).toBe(
      "Studio exact dual-tip v2 rebuild authority",
    );
    expect(harness.passes[0]!.draw.mock.calls).toEqual([
      [6, 1, 0, 0],
      [6, 1, 0, 1],
      [6, 1, 0, 2],
    ]);
    const shader = String(harness.shaders[0]!.code);
    expect(shader).toContain("sample_primary(input.document, deposition)");
    expect(shader).toContain("sample_secondary(input.document, deposition)");
    expect(shader).toContain("combine_same_deposition");
    expect(shader).toContain("straight_color_paint_alpha.rgb * source_alpha");
    expect(shader).not.toContain("paint_alpha_ratio");
    expect(shader).not.toContain("primary_raw_mask_layer");
    expect(harness.textures.filter(
      ({ descriptor }) => descriptor.format === "rgba16float",
    )).toHaveLength(1);
    expect(harness.pipelines).toHaveLength(2);
    expect(harness.pipelines[0]!.fragment!.targets[0]!.blend).toEqual({
      color: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
    });
    expect(harness.pipelines[1]!.fragment!.targets[0]!.blend).toEqual({
      color: { operation: "add", srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
      alpha: { operation: "add", srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
    });
  });

  it("preserves rebuild/append load semantics, budgets and fail-closed mutation checks", async () => {
    const harness = fakeGpu();
    const target = runtime(harness, { maximumResidentAssetBytes: 8 });

    expect((await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: exactPlan("rebuild", 1),
    })).status).toBe("completed");
    expect((await target.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: exactPlan("append", 2),
    })).status).toBe("completed");
    expect(harness.passes.map(
      (pass) => pass.descriptor.colorAttachments[0]!.loadOp,
    )).toEqual(["clear", "load"]);

    const mutated = exactPlan("append", 3);
    mutated.primaryAsset.bytes[0] = 0;
    expect((await target.execute({
      requestSequence: 3,
      deviceEpoch: 1,
      plan: mutated,
    }))).toEqual({ status: "rejected", reason: "invalid-frame" });

    const tooSmall = runtime(fakeGpu(), { maximumResidentAssetBytes: 7 });
    expect((await tooSmall.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: exactPlan(),
    }))).toEqual({ status: "rejected", reason: "resident-asset-budget" });
  });

  it("honors abort/backpressure and fails closed after queue failure or device loss", async () => {
    const gate = deferred<void>();
    const harness = fakeGpu(() => gate.promise);
    const target = runtime(harness);
    const aborted = new AbortController();
    aborted.abort();
    expect((await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: exactPlan(),
    }, aborted.signal))).toEqual({ status: "cancelled" });

    const first = target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: exactPlan(),
    });
    await Promise.resolve();
    expect((await target.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: exactPlan("append", 2),
    }))).toEqual({ status: "busy", inFlight: 1, maximum: 1 });
    gate.resolve();
    expect((await first).status).toBe("completed");

    const failing = runtime(fakeGpu(async () => {
      throw new Error("queue failed");
    }));
    expect((await failing.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: exactPlan(),
    }))).toEqual({ status: "failed", reason: "gpu-error" });
    expect((await failing.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: exactPlan("append", 2),
    }))).toEqual({ status: "failed", reason: "gpu-error" });

    const lostHarness = fakeGpu();
    const lost = runtime(lostHarness, { ownsDevice: true });
    lostHarness.lost.resolve({
      reason: "destroyed",
      message: "test loss",
    } as GPUDeviceLostInfo);
    await Promise.resolve();
    await Promise.resolve();
    expect(lost.deviceEpoch).toBe(2);
    expect((await lost.execute({
      requestSequence: 1,
      deviceEpoch: 2,
      plan: exactPlan(),
    }))).toEqual({ status: "device-lost", deviceEpoch: 2 });
    lost.dispose();
    expect(lostHarness.destroyDevice).toHaveBeenCalledOnce();
  });
});
