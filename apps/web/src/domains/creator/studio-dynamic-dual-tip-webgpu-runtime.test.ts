import { describe, expect, it, vi } from "vitest";

import {
  createStudioDynamicDualTipWebGpuRuntime,
  packStudioDynamicDualTipSecondaryInstances,
  STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_SECONDARY_INSTANCE_FLOATS,
} from "./studio-dynamic-dual-tip-webgpu-runtime";
import { sha256HexPortable } from "./studio-sha256";

import type {
  StudioDynamicDualTipPlan,
} from "./studio-dynamic-dual-tip-plan";

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
    readonly setVertexBuffer: ReturnType<typeof vi.fn>;
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
          setVertexBuffer: vi.fn(),
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

const PRIMARY_BYTES = new Uint8Array([255, 192, 96, 0]);
const SECONDARY_BYTES = new Uint8Array([0, 64, 128, 192, 255, 96]);

function hash(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function dualPlan(
  blendFamily: StudioDynamicDualTipPlan["extension"]["blendFamily"] = "multiply",
  porterDuff: "source-over" | "destination-out" = "source-over",
): StudioDynamicDualTipPlan {
  const primaryAsset = {
    assetIndex: 0,
    role: "tip" as const,
    assetId: "primary",
    contentHash: hash(PRIMARY_BYTES),
    width: 2,
    height: 2,
    channel: "alpha" as const,
    format: "r8-unorm" as const,
    byteLength: PRIMARY_BYTES.byteLength,
    bytes: new Uint8Array(PRIMARY_BYTES),
  };
  const secondaryAsset = {
    assetIndex: 1,
    role: "tip" as const,
    assetId: "secondary",
    contentHash: hash(SECONDARY_BYTES),
    width: 3,
    height: 2,
    channel: "alpha" as const,
    format: "r8-unorm" as const,
    byteLength: SECONDARY_BYTES.byteLength,
    bytes: new Uint8Array(SECONDARY_BYTES),
  };
  return {
    kind: "studio-dynamic-dual-tip-plan",
    version: 1,
    mode: "rebuild",
    strokeId: "dual-stroke",
    commandSequence: 1,
    providerCapability: "dynamic-dual-tip-r8-aggregate-preview-v1",
    executionRoute: "experimental-webgpu-aggregate-preview-v1",
    exactExecutionRoute: "webgpu-exact-packed-deposition-v2",
    fidelity: "aggregate-mask-preview-only",
    singleTipFallback: "forbidden",
    textureFormat: "rgba16float",
    maskFormat: "r8-unorm",
    primary: {
      kind: "studio-engine-webgpu-textured-brush-plan",
      version: 1,
      loweringVersion: 1,
      mode: "rebuild",
      strokeId: "dual-stroke",
      commandSequence: 1,
      dualTip: "extension-required",
      textureFormat: "rgba16float",
      colorModel: "scene-linear-premultiplied",
      tip: {
        assetIndex: 0,
        channel: "alpha",
        filtering: "bilinear",
        edgeMode: "transparent-zero-border",
        hardnessTransfer: "zero-to-one-smoothstep",
      },
      grain: null,
      assets: [primaryAsset],
      dabs: [{
        index: 0,
        stationX: 16,
        stationY: 12,
        x: 16,
        y: 12,
        pressure: 0.8,
        diameter: 12,
        opacity: 0.75,
        flow: 0.5,
        grainDepth: 0,
        color: {
          space: "linear-srgb",
          alphaMode: "straight",
          components: [0.2, 0.5, 0.8, 0.6],
        },
        composite: { porterDuff, blendMode: "normal" },
        tip: {
          hardness: 0.7,
          roundness: 0.5,
          angleRadians: 0.2,
          localToDocument: [6, 1.5, -2, 3],
        },
      }],
      batches: [{
        key: `${hash(PRIMARY_BYTES)}|none|${porterDuff}`,
        tipAssetIndex: 0,
        grainAssetIndex: null,
        porterDuff,
        firstInstance: 0,
        instanceCount: 1,
      }],
    },
    secondaryAsset,
    extension: {
      kind: "studio-dynamic-dual-tip-extension",
      version: 1,
      secondaryTip: {
        kind: "studio-dynamic-dual-tip-r8-reference",
        version: 1,
        assetId: "secondary",
        contentHash: hash(SECONDARY_BYTES),
        width: 3,
        height: 2,
        channel: "alpha",
      },
      units: {
        diameter: "canonical-local-css-px",
        spacing: "document-css-px",
        scatter: "document-css-px",
        angle: "radians-relative-to-stroke",
      },
      secondaryDiameter: 8,
      secondarySpacing: 5,
      scatterAxes: "both-axes",
      scatterDistance: 4,
      count: 2,
      countJitter: 0,
      angleRadians: 0.3,
      roundness: 0.6,
      seed: 0x1234_5678,
      blendFamily,
      secondaryOpacity: 0.7,
    },
    secondaryStations: [{
      index: 0,
      arcLength: 0,
      x: 17,
      y: 13,
      pressure: 0.8,
      localTangentX: 1,
      localTangentY: 0,
      documentTangentX: 1,
      documentTangentY: 0,
      documentNormalX: 0,
      documentNormalY: 1,
      instanceCount: 2,
    }],
    secondaryInstances: [
      {
        index: 0,
        stationIndex: 0,
        countIndex: 0,
        randomUint32: 1,
        assetIndex: 1,
        x: 17,
        y: 13,
        sourceDiameter: 8,
        opacity: Math.fround(0.7),
        angleRadians: 0.3,
        roundness: Math.fround(0.6),
        localToDocument: [4, 1, -1.25, 2.4],
      },
      {
        index: 1,
        stationIndex: 0,
        countIndex: 1,
        randomUint32: 2,
        assetIndex: 1,
        x: 21,
        y: 15,
        sourceDiameter: 8,
        opacity: Math.fround(0.7),
        angleRadians: 0.3,
        roundness: Math.fround(0.6),
        localToDocument: [4, 1, -1.25, 2.4],
      },
    ],
    fingerprint: `sha256:${"a".repeat(64)}`,
  };
}

function runtime(harness: FakeGpuHarness, overrides = {}) {
  const result = createStudioDynamicDualTipWebGpuRuntime({
    device: harness.device,
    width: 64,
    height: 48,
    ...overrides,
  });
  if (result.status !== "ready") throw new Error(result.reason);
  return result.runtime;
}

describe("dynamic dual-tip WebGPU specialist runtime", () => {
  it("packs every independently scheduled secondary affine footprint", () => {
    const packed = packStudioDynamicDualTipSecondaryInstances(dualPlan());

    expect(packed).toHaveLength(
      2 * STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_SECONDARY_INSTANCE_FLOATS,
    );
    expect([...packed.slice(0, 9)]).toEqual([
      17,
      13,
      4,
      1,
      -1.25,
      Math.fround(2.4),
      Math.fround(0.7),
      3,
      2,
    ]);
    expect([...packed.slice(12, 21)]).toEqual([
      21,
      15,
      4,
      1,
      -1.25,
      Math.fround(2.4),
      Math.fround(0.7),
      3,
      2,
    ]);
  });

  it("renders the explicitly approximate v1 aggregate preview for all 8 families", async () => {
    const harness = fakeGpu();
    const target = runtime(harness);

    const result = await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: dualPlan("difference"),
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.receipt).toMatchObject({
      backend: "webgpu",
      providerCapability: "dynamic-dual-tip-r8-aggregate-preview-v1",
      textureFormat: "rgba16float",
      colorModel: "scene-linear-premultiplied",
      maskCombination: "independent-primary-secondary-aggregate-preview-v1",
      fidelity: "aggregate-mask-preview-only",
      exactExecutionRoute: "webgpu-exact-packed-deposition-v2",
      blendFamily: "difference",
      primaryDabCount: 1,
      secondaryStationCount: 1,
      secondaryInstanceCount: 2,
      assetCount: 2,
      assetBytes: 10,
      queueState: "completed",
      complete: false,
    });
    expect(harness.passes).toHaveLength(3);
    expect(harness.passes.map((pass) => pass.descriptor.label)).toEqual([
      "Studio dynamic dual-tip independent primary mask",
      "Studio dynamic dual-tip independent secondary mask",
      "Studio dynamic dual-tip rebuild authority combine",
    ]);
    expect(harness.passes[0]!.draw).toHaveBeenCalledWith(6, 1, 0, 0);
    expect(harness.passes[1]!.draw).toHaveBeenCalledWith(6, 2, 0, 0);
    expect(harness.passes[2]!.draw).toHaveBeenCalledWith(3, 1, 0, 0);
    const shader = harness.shaders.find(
      (descriptor) => descriptor.label === "Studio dynamic dual-tip 8-family combine shader",
    )!.code;
    for (let family = 0; family <= 6; family += 1) {
      expect(shader).toContain(`case ${family}u`);
    }
    expect(shader).toContain("return abs(primary - secondary)");
    expect(shader).toContain("primary * secondary");
    expect(shader).toContain("max(primary, secondary)");
    expect(shader).toContain("min(1.0, primary + secondary)");
    expect(harness.pipelines.map((pipeline) => pipeline.label)).toEqual([
      "Studio dynamic dual-tip primary mask pipeline",
      "Studio dynamic dual-tip secondary mask pipeline",
      "Studio dynamic dual-tip source-over combine pipeline",
      "Studio dynamic dual-tip destination-out combine pipeline",
    ]);
    expect(harness.pipelines[0]!.fragment!.targets).toHaveLength(2);
    const primaryShader = harness.shaders.find(
      (descriptor) => descriptor.label === "Studio dynamic dual-tip primary clean-room shader",
    )!.code;
    expect(primaryShader).toContain("@location(1) raw_mask");
    expect(primaryShader).toContain("output.raw_mask = vec4f(raw_mask)");
    expect(shader).toContain("primary_raw_mask_layer");
    expect(shader).toContain("preview_paint_alpha");
    expect(shader).not.toContain("paint_alpha_ratio");
  });

  it("supports append/rebuild and destination-out without changing the two-mask schedule", async () => {
    const harness = fakeGpu();
    const target = runtime(harness);
    const rebuild = dualPlan("screen");
    const append = {
      ...dualPlan("screen", "destination-out"),
      mode: "append" as const,
      commandSequence: 2,
      primary: {
        ...dualPlan("screen", "destination-out").primary,
        mode: "append" as const,
        commandSequence: 2,
      },
    };

    expect((await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: rebuild,
    })).status).toBe("completed");
    expect((await target.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: append,
    })).status).toBe("completed");

    const combinePasses = harness.passes.filter(
      (pass) => String(pass.descriptor.label).includes("authority combine"),
    );
    expect(combinePasses).toHaveLength(2);
    expect(combinePasses[0]!.descriptor.colorAttachments[0]!.loadOp).toBe("clear");
    expect(combinePasses[1]!.descriptor.colorAttachments[0]!.loadOp).toBe("load");
    expect(combinePasses[1]!.setPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        descriptor: expect.objectContaining({
          label: "Studio dynamic dual-tip destination-out combine pipeline",
        }),
      }),
    );
  });

  it("rejects mutated content, stale sequence/epoch and resident/request budgets", async () => {
    const harness = fakeGpu();
    const target = runtime(harness, {
      maximumPrimaryDabs: 1,
      maximumSecondaryInstances: 2,
      maximumResidentAssetBytes: 9,
    });
    const plan = dualPlan();

    expect((await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan,
    }))).toEqual({ status: "rejected", reason: "resident-asset-budget" });
    expect(harness.submit).not.toHaveBeenCalled();

    const enough = runtime(fakeGpu(), { maximumResidentAssetBytes: 10 });
    const mutated = dualPlan();
    mutated.secondaryAsset.bytes[0] = 255;
    expect((await enough.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: mutated,
    }))).toEqual({ status: "rejected", reason: "invalid-frame" });
    expect((await enough.execute({
      requestSequence: 1,
      deviceEpoch: 2,
      plan: dualPlan(),
    }))).toEqual({ status: "rejected", reason: "device-epoch" });
    expect((await enough.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: dualPlan(),
    })).status).toBe("completed");
    expect((await enough.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: dualPlan(),
    }))).toEqual({ status: "rejected", reason: "request-sequence" });
  });

  it("does not consume cancelled or busy sequences and fails closed after GPU failure", async () => {
    const gate = deferred<void>();
    const harness = fakeGpu(() => gate.promise);
    const target = runtime(harness, { maximumInFlightSubmissions: 1 });
    const aborted = new AbortController();
    aborted.abort();
    expect((await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: dualPlan(),
    }, aborted.signal))).toEqual({ status: "cancelled" });

    const first = target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: dualPlan(),
    });
    await Promise.resolve();
    expect((await target.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: dualPlan(),
    }))).toEqual({ status: "busy", inFlight: 1, maximum: 1 });
    gate.resolve();
    expect((await first).status).toBe("completed");
    expect((await target.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: dualPlan(),
    })).status).toBe("completed");

    const failingHarness = fakeGpu(async () => {
      throw new Error("device queue rejected");
    });
    const failing = runtime(failingHarness);
    expect((await failing.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: dualPlan(),
    }))).toEqual({ status: "failed", reason: "gpu-error" });
    expect((await failing.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: dualPlan(),
    }))).toEqual({ status: "failed", reason: "gpu-error" });
  });

  it("advances the epoch after device loss and owns device destruction only when requested", async () => {
    const harness = fakeGpu();
    const callback = vi.fn();
    const target = runtime(harness, {
      ownsDevice: true,
      onDeviceLost: callback,
    });
    harness.lost.resolve({
      reason: "destroyed",
      message: "test loss",
    } as GPUDeviceLostInfo);
    await Promise.resolve();
    await Promise.resolve();

    expect(target.deviceEpoch).toBe(2);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ reason: "destroyed" }));
    expect((await target.execute({
      requestSequence: 1,
      deviceEpoch: 2,
      plan: dualPlan(),
    }))).toEqual({ status: "device-lost", deviceEpoch: 2 });
    target.dispose();
    expect(harness.destroyDevice).toHaveBeenCalledOnce();
    for (const texture of harness.textures) expect(texture.destroy).toHaveBeenCalledOnce();
  });

  it("enforces a serial authority writer and rejects secondary schedule drift", async () => {
    expect(createStudioDynamicDualTipWebGpuRuntime({
      device: fakeGpu().device,
      width: 64,
      height: 48,
      maximumInFlightSubmissions: 2,
    })).toEqual({ status: "rejected", reason: "initialization-failed" });

    const harness = fakeGpu();
    const target = runtime(harness);
    const drifted = dualPlan();
    const first = drifted.secondaryInstances[0]!;
    const invalid = {
      ...drifted,
      secondaryInstances: [
        { ...first, opacity: Math.fround(0.2) },
        drifted.secondaryInstances[1]!,
      ],
    };
    expect((await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: invalid,
    }))).toEqual({ status: "rejected", reason: "invalid-frame" });
    expect(harness.submit).not.toHaveBeenCalled();
  });
});
