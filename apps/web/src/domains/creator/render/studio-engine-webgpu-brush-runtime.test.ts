import { describe, expect, it, vi } from "vitest";

import { studioHighBitSrgbToLinear } from "../studio-highbit-transfer";

import {
  adaptLoweredStudioCanonicalBrushWebGpuDabs,
  convertLegacyStudioGpuDabPlanToWebGpuDiagnosticOracle,
  createStudioEngineWebGpuBrushRuntime,
  fingerprintStudioEngineWebGpuBrushPlan,
  packStudioEngineWebGpuBrushDabs,
  STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL,
  STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING,
  STUDIO_ENGINE_WEBGPU_BRUSH_INSTANCE_BYTES,
  STUDIO_ENGINE_WEBGPU_BRUSH_PRESENTATION_COLOR_SPACE,
  STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
  STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE,
  validateStudioEngineWebGpuBrushPlan,
  type StudioEngineWebGpuBrushFrame,
  type StudioEngineWebGpuBrushPlan,
  type StudioEngineWebGpuBrushRuntime,
} from "./studio-engine-webgpu-brush-runtime";

import type {
  LoweredStudioCanonicalBrushWebGpuDabs,
  StudioCanonicalBrushWebGpuLoweringResult,
  StudioCanonicalWebGpuAnalyticDab,
} from "../studio-canonical-brush-webgpu-lowering";
import type {
  StudioGpuDab,
  StudioGpuDabRenderUpdate,
} from "./studio-webgpu-dab-plan-contract";

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (reason?: unknown) => void;
}

interface FakeBuffer {
  readonly buffer: GPUBuffer;
  readonly descriptor: GPUBufferDescriptor;
  readonly destroy: ReturnType<typeof vi.fn>;
}

interface FakeTexture {
  readonly texture: GPUTexture;
  readonly descriptor: GPUTextureDescriptor;
  readonly destroy: ReturnType<typeof vi.fn>;
}

interface FakePass {
  readonly descriptor: GPURenderPassDescriptor;
  readonly setPipeline: ReturnType<typeof vi.fn>;
  readonly setVertexBuffer: ReturnType<typeof vi.fn>;
  readonly setBindGroup: ReturnType<typeof vi.fn>;
  readonly draw: ReturnType<typeof vi.fn>;
  readonly end: ReturnType<typeof vi.fn>;
}

interface FakeGpuHarness {
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly surface: {
    width: number;
    height: number;
    getContext: ReturnType<
      typeof vi.fn<(contextId: "webgpu") => GPUCanvasContext | null>
    >;
  };
  readonly lost: Deferred<GPUDeviceLostInfo>;
  readonly buffers: FakeBuffer[];
  readonly textures: FakeTexture[];
  readonly passes: FakePass[];
  readonly pipelineDescriptors: GPURenderPipelineDescriptor[];
  readonly shaderDescriptors: GPUShaderModuleDescriptor[];
  readonly writeBuffer: ReturnType<typeof vi.fn>;
  readonly uploaded: Float32Array[];
  readonly submit: ReturnType<typeof vi.fn>;
  readonly onSubmittedWorkDone: ReturnType<typeof vi.fn>;
  readonly configure: ReturnType<typeof vi.fn>;
  readonly unconfigure: ReturnType<typeof vi.fn>;
  readonly destroyDevice: ReturnType<typeof vi.fn>;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fakeGpuHarness(
  options: {
    readonly width?: number;
    readonly height?: number;
    readonly fence?: () => Promise<void>;
  } = {},
): FakeGpuHarness {
  const lost = deferred<GPUDeviceLostInfo>();
  const buffers: FakeBuffer[] = [];
  const textures: FakeTexture[] = [];
  const passes: FakePass[] = [];
  const pipelineDescriptors: GPURenderPipelineDescriptor[] = [];
  const shaderDescriptors: GPUShaderModuleDescriptor[] = [];
  const uploaded: Float32Array[] = [];
  const configure = vi.fn();
  const unconfigure = vi.fn();
  const context = {
    configure,
    unconfigure,
    getCurrentTexture: vi.fn(() => ({
      createView: vi.fn(() => ({ canvas: true })),
    })),
  } as unknown as GPUCanvasContext;
  const surface = {
    width: options.width ?? 64,
    height: options.height ?? 32,
    getContext: vi.fn(
      (kind: "webgpu"): GPUCanvasContext | null => kind === "webgpu" ? context : null,
    ),
  };
  const writeBuffer = vi.fn((
    _buffer: GPUBuffer,
    _bufferOffset: number,
    data: AllowSharedBufferSource,
    dataOffset = 0,
    size?: number,
  ) => {
    const byteLength = size ?? data.byteLength - dataOffset;
    const source = ArrayBuffer.isView(data) ? data.buffer : data;
    uploaded.push(new Float32Array(source.slice(dataOffset, dataOffset + byteLength)));
  });
  const submit = vi.fn();
  const onSubmittedWorkDone = vi.fn(options.fence ?? (async () => undefined));
  const destroyDevice = vi.fn();
  const device = {
    lost: lost.promise,
    limits: { maxTextureDimension2D: 8_192 },
    queue: { writeBuffer, submit, onSubmittedWorkDone },
    createShaderModule: vi.fn((descriptor: GPUShaderModuleDescriptor) => {
      shaderDescriptors.push(descriptor);
      return { descriptor };
    }),
    createBindGroupLayout: vi.fn((descriptor: GPUBindGroupLayoutDescriptor) => ({
      descriptor,
    })),
    createPipelineLayout: vi.fn((descriptor: GPUPipelineLayoutDescriptor) => ({
      descriptor,
    })),
    createRenderPipeline: vi.fn((descriptor: GPURenderPipelineDescriptor) => {
      pipelineDescriptors.push(descriptor);
      return { descriptor };
    }),
    createTexture: vi.fn((descriptor: GPUTextureDescriptor) => {
      const destroy = vi.fn();
      const texture = {
        descriptor,
        createView: vi.fn(() => ({ texture: descriptor.label })),
        destroy,
      } as unknown as GPUTexture;
      textures.push({ texture, descriptor, destroy });
      return texture;
    }),
    createBindGroup: vi.fn((descriptor: GPUBindGroupDescriptor) => ({ descriptor })),
    createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => {
      const destroy = vi.fn();
      const buffer = { descriptor, destroy } as unknown as GPUBuffer;
      buffers.push({ buffer, descriptor, destroy });
      return buffer;
    }),
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass: vi.fn((descriptor: GPURenderPassDescriptor) => {
        const pass: FakePass = {
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
    context,
    surface,
    lost,
    buffers,
    textures,
    passes,
    pipelineDescriptors,
    shaderDescriptors,
    writeBuffer,
    uploaded,
    submit,
    onSubmittedWorkDone,
    configure,
    unconfigure,
    destroyDevice,
  };
}

function analyticDab(
  overrides: Partial<StudioCanonicalWebGpuAnalyticDab> = {},
): StudioCanonicalWebGpuAnalyticDab {
  const base: StudioCanonicalWebGpuAnalyticDab = {
    index: 0,
    stationX: 8,
    stationY: 4,
    x: 8,
    y: 4,
    pressure: 0.7,
    diameter: 4,
    opacity: 0.8,
    flow: 0.5,
    color: {
      space: "linear-srgb",
      alphaMode: "straight",
      components: [0.5, 0.25, 1, 0.4],
    },
    composite: {
      porterDuff: "source-over",
      blendMode: "normal",
    },
    tip: {
      shape: "ellipse",
      hardness: 0.65,
      edgeSoftness: 0.2,
      roundness: 0.5,
      angleRadians: 0.25,
      localToDocument: [2, 0.5, -0.75, 1],
    },
  };
  return {
    ...base,
    ...overrides,
    color: overrides.color ?? base.color,
    composite: overrides.composite ?? base.composite,
    tip: overrides.tip ?? base.tip,
  };
}

function lowered(
  inputDabs: readonly StudioCanonicalWebGpuAnalyticDab[] = [analyticDab()],
  overrides: Partial<LoweredStudioCanonicalBrushWebGpuDabs> = {},
): LoweredStudioCanonicalBrushWebGpuDabs {
  const dabs = inputDabs.map((dab, index) => ({ ...dab, index }));
  const batches: LoweredStudioCanonicalBrushWebGpuDabs["batches"][number][] = [];
  for (let index = 0; index < dabs.length;) {
    const composite = dabs[index]!.composite;
    const colorSpace = dabs[index]!.color.space;
    let end = index + 1;
    while (
      end < dabs.length
      && dabs[end]!.composite.porterDuff === composite.porterDuff
      && dabs[end]!.composite.blendMode === composite.blendMode
      && dabs[end]!.color.space === colorSpace
    ) end += 1;
    batches.push({
      composite,
      colorSpace,
      firstInstance: index,
      instanceCount: end - index,
    });
    index = end;
  }
  return {
    status: "lowered",
    version: 1,
    strokeId: "stroke-rich-1",
    dabs,
    batches,
    ...overrides,
  };
}

function plan(
  mode: "append" | "rebuild",
  dabs: readonly StudioCanonicalWebGpuAnalyticDab[] = [analyticDab()],
): StudioEngineWebGpuBrushPlan {
  const result = adaptLoweredStudioCanonicalBrushWebGpuDabs(mode, lowered(dabs));
  if (result.status !== "ready") throw new Error(`plan adaptation failed: ${result.status}`);
  return result.plan;
}

function frame(
  requestSequence: number,
  update: StudioEngineWebGpuBrushPlan = plan("rebuild"),
  overrides: Partial<StudioEngineWebGpuBrushFrame> = {},
): StudioEngineWebGpuBrushFrame {
  return {
    requestSequence,
    resizeEpoch: 1,
    rasterRect: { x: 0, y: 0, width: 64, height: 32 },
    update,
    ...overrides,
  };
}

function legacyDab(overrides: Partial<StudioGpuDab> = {}): StudioGpuDab {
  return {
    x: 8,
    y: 4,
    radius: 2,
    red: 0.5,
    green: 0.25,
    blue: 1,
    alpha: 0.4,
    composite: "normal",
    ...overrides,
  };
}

function legacyUpdate(
  mode: "append" | "rebuild",
  dabs: readonly StudioGpuDab[],
): StudioGpuDabRenderUpdate {
  const batches: StudioGpuDabRenderUpdate["batches"] = [];
  for (let index = 0; index < dabs.length;) {
    const composite = dabs[index]!.composite;
    let end = index + 1;
    while (end < dabs.length && dabs[end]!.composite === composite) end += 1;
    batches.push({ composite, firstInstance: index, instanceCount: end - index });
    index = end;
  }
  return { mode, dabs: [...dabs], batches, complete: true };
}

async function readyRuntime(
  harness: FakeGpuHarness,
  options: {
    readonly maxDabs?: number;
    readonly maxSurfacePixels?: number;
    readonly maxInFlightSubmissions?: number;
    readonly ownsDevice?: boolean;
    readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
  } = {},
): Promise<StudioEngineWebGpuBrushRuntime> {
  const result = await createStudioEngineWebGpuBrushRuntime({
    surface: harness.surface,
    boundary: {
      device: harness.device,
      context: harness.context,
      canvasFormat: "bgra8unorm",
      ownsDevice: options.ownsDevice,
    },
    maxDabs: options.maxDabs,
    maxSurfacePixels: options.maxSurfacePixels,
    maxInFlightSubmissions: options.maxInFlightSubmissions,
    onDeviceLost: options.onDeviceLost,
  });
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("fake WebGPU runtime did not initialize");
  return result.runtime;
}

function attachment(pass: FakePass): GPURenderPassColorAttachment {
  return pass.descriptor.colorAttachments[0] as GPURenderPassColorAttachment;
}

describe("Studio Engine Worker rich WebGPU brush runtime", () => {
  it("fails closed with an explicit unsupported result when WebGPU is absent", async () => {
    const harness = fakeGpuHarness();
    await expect(createStudioEngineWebGpuBrushRuntime({
      surface: harness.surface,
      gpu: null,
    })).resolves.toEqual({
      status: "unsupported",
      reason: "webgpu-unavailable",
    });
    expect(harness.surface.getContext).not.toHaveBeenCalled();
  });

  it("creates RGBA16F affine-tip pipelines and a readback-capable authority texture", async () => {
    const harness = fakeGpuHarness();
    const runtime = await readyRuntime(harness);

    expect(harness.textures).toHaveLength(1);
    expect(harness.textures[0]!.descriptor).toMatchObject({
      format: STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
      size: { width: 64, height: 32, depthOrArrayLayers: 1 },
    });
    expect(Number(harness.textures[0]!.descriptor.usage) & 0x01).toBe(0x01);
    expect(harness.configure).toHaveBeenCalledWith(expect.objectContaining({
      device: harness.device,
      format: "bgra8unorm",
      alphaMode: "premultiplied",
      colorSpace: "srgb",
    }));

    const normal = harness.pipelineDescriptors.find(
      (descriptor) =>
        descriptor.label === "Studio Engine Worker source-over rich analytic dab pipeline",
    );
    const erase = harness.pipelineDescriptors.find(
      (descriptor) =>
        descriptor.label === "Studio Engine Worker destination-out rich analytic dab pipeline",
    );
    expect(normal?.vertex.buffers?.[0]).toMatchObject({
      arrayStride: STUDIO_ENGINE_WEBGPU_BRUSH_INSTANCE_BYTES,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x2" },
        { shaderLocation: 1, offset: 8, format: "float32x2" },
        { shaderLocation: 2, offset: 16, format: "float32x2" },
        { shaderLocation: 3, offset: 24, format: "float32x4" },
        { shaderLocation: 4, offset: 40, format: "float32x4" },
        { shaderLocation: 5, offset: 56, format: "float32x2" },
      ],
    });
    expect(normal?.fragment?.targets?.[0]).toMatchObject({
      format: "rgba16float",
      blend: {
        color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      },
    });
    expect(erase?.fragment?.targets?.[0]).toMatchObject({
      format: "rgba16float",
      blend: {
        color: { srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
        alpha: { srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
      },
    });
    const shader = String(harness.shaderDescriptors[0]!.code);
    expect(shader).toContain("basis_x * local.x + basis_y * local.y");
    expect(shader).toContain("square_metric");
    expect(shader).toContain("edge_softness");
    expect(runtime.stats()).toMatchObject({
      status: "ready",
      surfaceBytes: 64 * 32 * 8,
      surfaceTextureAllocations: 1,
    });
  });

  it("adapts canonical analytic lowering without losing affine, hardness, or shape data", () => {
    const source = lowered([
      analyticDab({
        tip: {
          shape: "square",
          hardness: 0.37,
          edgeSoftness: 0.42,
          roundness: 0.63,
          angleRadians: -0.75,
          localToDocument: [-3, 1.25, 0.5, 2],
        },
      }),
    ]);
    const result = adaptLoweredStudioCanonicalBrushWebGpuDabs("rebuild", source);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.plan.dabs[0]!.tip).toEqual(source.dabs[0]!.tip);
    expect(result.plan.dabs[0]!.color).toEqual(source.dabs[0]!.color);
    expect(result.plan.dabs[0]).not.toBe(source.dabs[0]);
    expect(result.plan.dabs[0]!.tip).not.toBe(source.dabs[0]!.tip);
    expect(Object.isFrozen(result.plan)).toBe(true);
    expect(Object.isFrozen(result.plan.dabs[0]!.tip.localToDocument)).toBe(true);
  });

  it("fails closed for specialist paths, Display-P3, and unsupported blend modes", () => {
    const specialist: StudioCanonicalBrushWebGpuLoweringResult = {
      status: "lowering-required",
      strokeId: "wet-1",
      requirements: ["texture-tip", "grain", "wet-media"],
    };
    expect(adaptLoweredStudioCanonicalBrushWebGpuDabs("rebuild", specialist)).toEqual({
      status: "lowering-required",
      strokeId: "wet-1",
      requirements: ["texture-tip", "grain", "wet-media"],
    });

    const p3 = lowered([analyticDab({
      color: {
        space: "linear-display-p3",
        alphaMode: "straight",
        components: [1, 0.2, 0.1, 1],
      },
    })]);
    expect(adaptLoweredStudioCanonicalBrushWebGpuDabs("rebuild", p3)).toEqual({
      status: "unsupported",
      reason: "unsupported-color-space",
      colorSpace: "linear-display-p3",
    });

    const multiply = lowered([analyticDab({
      composite: { porterDuff: "source-over", blendMode: "multiply" },
    })]);
    expect(adaptLoweredStudioCanonicalBrushWebGpuDabs("rebuild", multiply)).toEqual({
      status: "unsupported",
      reason: "unsupported-blend-mode",
      blendMode: "multiply",
    });
  });

  it("packs reflected/sheared affine bases, tip metadata, and straight-linear colour exactly once", () => {
    const packed = packStudioEngineWebGpuBrushDabs(
      [analyticDab({
        tip: {
          shape: "square",
          hardness: 0.4,
          edgeSoftness: 0.25,
          roundness: 0.5,
          angleRadians: -0.75,
          localToDocument: [-2, 0.5, 1, 1.5],
        },
      })],
      { x: 0, y: 0, width: 64, height: 32 },
      64,
      32,
    );

    expect(packed).toHaveLength(16);
    expect(packed[0]).toBeCloseTo(-0.75);
    expect(packed[1]).toBeCloseTo(0.75);
    expect(packed[2]).toBeCloseTo(-4 / 64);
    expect(packed[3]).toBeCloseTo(-1 / 32);
    expect(packed[4]).toBeCloseTo(2 / 64);
    expect(packed[5]).toBeCloseTo(-3 / 32);
    expect(packed.slice(6, 10)).toEqual(new Float32Array([0.2, 0.1, 0.4, 0.4]));
    expect(packed[10]).toBe(2);
    expect(packed[11]).toBeCloseTo(0.4);
    expect(packed[12]).toBeCloseTo(0.25);
    expect(packed[13]).toBeGreaterThan(1);
    expect(packed[14]).toBeCloseTo(0.5);
    expect(packed[15]).toBeCloseTo(-0.75);
  });

  it("keeps encoded-sRGB legacy conversion behind a branded diagnostic oracle", () => {
    const diagnostic = convertLegacyStudioGpuDabPlanToWebGpuDiagnosticOracle(
      legacyUpdate("rebuild", [legacyDab()]),
    );

    expect(diagnostic.kind).toBe("studio-engine-webgpu-legacy-diagnostic-oracle");
    expect(diagnostic.plan.strokeId).toBe("legacy-diagnostic-oracle");
    expect(diagnostic.plan.dabs[0]!.color.components).toEqual([
      studioHighBitSrgbToLinear(0.5),
      studioHighBitSrgbToLinear(0.25),
      1,
      0.4,
    ]);
    expect(diagnostic.plan.dabs[0]!.tip.localToDocument).toEqual([2, 0, 0, 2]);
  });

  it("submits source-over and destination-out batches in canonical order with a pure receipt", async () => {
    const harness = fakeGpuHarness();
    const runtime = await readyRuntime(harness);
    const renderFrame = frame(1, plan("rebuild", [
      analyticDab(),
      analyticDab(),
      analyticDab({
        composite: { porterDuff: "destination-out", blendMode: "normal" },
        color: {
          space: "linear-srgb",
          alphaMode: "straight",
          components: [0, 0, 0, 0.25],
        },
      }),
      analyticDab(),
    ]));

    const result = await runtime.execute(renderFrame);

    expect(result.status).toBe("presented");
    if (result.status !== "presented") return;
    expect(harness.writeBuffer).toHaveBeenCalledTimes(1);
    expect(harness.uploaded[0]).toHaveLength(4 * 16);
    expect(harness.submit).toHaveBeenCalledTimes(1);
    expect(harness.passes).toHaveLength(2);
    expect(attachment(harness.passes[0]!).loadOp).toBe("clear");
    expect(harness.passes[0]!.draw.mock.calls).toEqual([
      [6, 2, 0, 0],
      [6, 1, 0, 2],
      [6, 1, 0, 3],
    ]);
    expect(
      harness.passes[0]!.setPipeline.mock.calls.map(([pipeline]) =>
        (pipeline as { descriptor: GPURenderPipelineDescriptor }).descriptor.label),
    ).toEqual([
      "Studio Engine Worker source-over rich analytic dab pipeline",
      "Studio Engine Worker destination-out rich analytic dab pipeline",
      "Studio Engine Worker source-over rich analytic dab pipeline",
    ]);
    expect(result.receipt).toEqual({
      kind: "studio-engine-webgpu-brush-receipt",
      revision: 2,
      backend: "webgpu",
      requestSequence: 1,
      resizeEpoch: 1,
      deviceEpoch: 1,
      width: 64,
      height: 32,
      textureFormat: STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
      colorModel: STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL,
      workingColorSpace: STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE,
      inputColorEncoding: STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING,
      presentationColorSpace: STUDIO_ENGINE_WEBGPU_BRUSH_PRESENTATION_COLOR_SPACE,
      mode: "rebuild",
      strokeId: "stroke-rich-1",
      loweringVersion: 1,
      dabCount: 4,
      batchCount: 3,
      batchOrder: ["source-over", "destination-out", "source-over"],
      planFingerprint: fingerprintStudioEngineWebGpuBrushPlan(renderFrame),
      queueState: "submitted",
      complete: true,
    });
    expect(Object.isFrozen(result.receipt)).toBe(true);
    expect(Object.isFrozen(result.receipt.batchOrder)).toBe(true);
    expect(JSON.parse(JSON.stringify(result.receipt))).toEqual(result.receipt);
    expect(Object.keys(result.receipt)).not.toContain("device");
    expect(Object.keys(result.receipt)).not.toContain("context");
  });

  it("does not await a full GPU fence per append and applies bounded queue backpressure", async () => {
    const fence = deferred<void>();
    const harness = fakeGpuHarness({ fence: () => fence.promise });
    const runtime = await readyRuntime(harness, { maxInFlightSubmissions: 2 });

    await expect(runtime.execute(frame(1, plan("rebuild")))).resolves.toMatchObject({
      status: "presented",
      receipt: { queueState: "submitted" },
    });
    await expect(runtime.execute(frame(2, plan("append")))).resolves.toMatchObject({
      status: "presented",
      receipt: { queueState: "submitted" },
    });
    expect(harness.onSubmittedWorkDone).toHaveBeenCalledTimes(1);
    expect(runtime.stats()).toMatchObject({
      submissions: 2,
      inFlightSubmissions: 2,
      completedSubmissionSequence: 0,
    });
    expect(runtime.resize({ width: 128, height: 64, resizeEpoch: 2 })).toEqual({
      status: "rejected",
      reason: "gpu-backpressure",
    });
    await expect(runtime.execute(frame(3, plan("append")))).resolves.toEqual({
      status: "rejected",
      reason: "gpu-backpressure",
    });

    fence.resolve();
    await fence.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.stats()).toMatchObject({
      submissions: 2,
      inFlightSubmissions: 0,
      completedSubmissionSequence: 2,
    });
    await expect(runtime.execute(frame(3, plan("append")))).resolves.toMatchObject({
      status: "presented",
    });
  });

  it("retains the RGBA16F surface for append with bounded grow-only instance allocations", async () => {
    const harness = fakeGpuHarness();
    const runtime = await readyRuntime(harness, { maxDabs: 4 });

    await expect(runtime.execute(frame(1, plan("append")))).resolves.toEqual({
      status: "rejected",
      reason: "append-without-base",
    });
    await expect(runtime.execute(frame(1, plan("rebuild")))).resolves.toMatchObject({
      status: "presented",
    });
    await expect(runtime.execute(frame(2, plan("append", [
      analyticDab(),
      analyticDab(),
      analyticDab(),
    ])))).resolves.toMatchObject({
      status: "presented",
      receipt: { mode: "append", requestSequence: 2 },
    });

    expect(attachment(harness.passes[2]!).loadOp).toBe("load");
    expect(harness.buffers).toHaveLength(1);
    expect(harness.buffers[0]!.descriptor.size).toBe(4 * STUDIO_ENGINE_WEBGPU_BRUSH_INSTANCE_BYTES);
    expect(runtime.stats()).toMatchObject({
      instanceCapacity: 4,
      instanceBufferAllocations: 1,
      surfaceTextureAllocations: 1,
      submissions: 2,
    });
  });

  it("rejects malformed coverage and hostile getters before GPU mutation", async () => {
    const harness = fakeGpuHarness();
    const runtime = await readyRuntime(harness);
    const valid = plan("rebuild");
    const gapped: StudioEngineWebGpuBrushPlan = {
      ...valid,
      batches: [{ ...valid.batches[0]!, firstInstance: 1 }],
    };
    const hostileFrame = new Proxy(frame(1), {
      get(target, property, receiver) {
        if (property === "update") throw new Error("hostile update getter");
        return Reflect.get(target, property, receiver);
      },
    });

    expect(validateStudioEngineWebGpuBrushPlan(gapped, 8)).toBeNull();
    await expect(runtime.execute(frame(1, gapped))).resolves.toEqual({
      status: "rejected",
      reason: "invalid-plan",
    });
    await expect(runtime.execute(hostileFrame)).resolves.toEqual({
      status: "rejected",
      reason: "invalid-plan",
    });
    expect(harness.writeBuffer).not.toHaveBeenCalled();
    expect(harness.submit).not.toHaveBeenCalled();
    expect(runtime.stats().status).toBe("ready");
  });

  it("makes resize epochs monotonic, destroys prior surfaces, and requires a rebuild", async () => {
    const harness = fakeGpuHarness();
    const runtime = await readyRuntime(harness);
    await runtime.execute(frame(1));
    await Promise.resolve();
    const originalTexture = harness.textures[0]!;

    expect(runtime.resize({ width: 128, height: 64, resizeEpoch: 1 })).toEqual({
      status: "rejected",
      reason: "stale-resize-epoch",
    });
    expect(runtime.resize({ width: 128, height: 64, resizeEpoch: 2 })).toEqual({
      status: "ready",
      resizeEpoch: 2,
      width: 128,
      height: 64,
    });
    expect(originalTexture.destroy).toHaveBeenCalledTimes(1);
    expect(harness.textures.at(-1)!.descriptor).toMatchObject({
      format: "rgba16float",
      size: { width: 128, height: 64 },
    });
    await expect(runtime.execute(frame(2, plan("append"), {
      resizeEpoch: 2,
      rasterRect: { x: 0, y: 0, width: 128, height: 64 },
    }))).resolves.toEqual({
      status: "rejected",
      reason: "append-without-base",
    });
  });

  it("device loss invalidates resources and owns no compatibility fallback", async () => {
    const harness = fakeGpuHarness();
    const onDeviceLost = vi.fn();
    const runtime = await readyRuntime(harness, { onDeviceLost });
    await runtime.execute(frame(1));
    const texture = harness.textures[0]!;
    const buffer = harness.buffers[0]!;
    const info = { reason: "unknown", message: "test loss" } as GPUDeviceLostInfo;

    harness.lost.resolve(info);
    await harness.lost.promise;
    await Promise.resolve();

    expect(runtime.stats()).toMatchObject({
      status: "device-lost",
      deviceEpoch: 2,
      instanceCapacity: 0,
    });
    expect(texture.destroy).toHaveBeenCalledTimes(1);
    expect(buffer.destroy).toHaveBeenCalledTimes(1);
    expect(harness.unconfigure).toHaveBeenCalledTimes(1);
    expect(onDeviceLost).toHaveBeenCalledWith(info);
    await expect(runtime.execute(frame(2))).resolves.toEqual({
      status: "rejected",
      reason: "device-lost",
    });
  });

  it("turns a rejected batched fence into a fail-closed disposable mirror", async () => {
    const harness = fakeGpuHarness({
      fence: async () => {
        throw new Error("validation failure");
      },
    });
    const runtime = await readyRuntime(harness);

    await expect(runtime.execute(frame(1))).resolves.toMatchObject({
      status: "presented",
      receipt: { queueState: "submitted" },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.stats().status).toBe("failed");
    expect(harness.textures[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(harness.buffers[0]!.destroy).toHaveBeenCalledTimes(1);
    await expect(runtime.execute(frame(2))).resolves.toEqual({
      status: "rejected",
      reason: "runtime-failed",
    });
  });

  it("respects shared versus owned device disposal", async () => {
    const shared = fakeGpuHarness();
    const sharedRuntime = await readyRuntime(shared);
    sharedRuntime.dispose();
    expect(shared.destroyDevice).not.toHaveBeenCalled();

    const dedicated = fakeGpuHarness();
    const ownedRuntime = await readyRuntime(dedicated, { ownsDevice: true });
    ownedRuntime.dispose();
    ownedRuntime.dispose();
    expect(dedicated.destroyDevice).toHaveBeenCalledTimes(1);
  });
});
