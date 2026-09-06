import { describe, expect, it, vi } from "vitest";

import { StudioBrushR8GrainRegistry } from "../brush/studio-brush-r8-grain-runtime";
import { sha256HexPortable } from "../studio-sha256";

import {
  createStudioEngineWebGpuPresentationSurface,
  type StudioEngineWebGpuPresentationFrameLease,
  type StudioEngineWebGpuPresentationLayout,
  type StudioEngineWebGpuPresentationSurface,
} from "./studio-engine-webgpu-presentation-surface";
import {
  fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics,
  type StudioEngineWebGpuTexturedBrushPlan,
} from "./studio-engine-webgpu-textured-brush-plan";
import {
  createStudioEngineWebGpuTexturedBrushRuntime,
  packStudioEngineWebGpuTexturedBrushDabs,
  packStudioEngineWebGpuTexturedBrushViewportUniform,
  STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_INSTANCE_FLOATS,
} from "./studio-engine-webgpu-textured-brush-runtime";
import {
  planStudioWebGpuR8GrainNative,
  StudioWebGpuR8GrainTextureCache,
} from "./studio-webgpu-r8-grain-native";

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

interface FakeTexture {
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
  readonly canvas: { width: number; height: number };
  readonly lost: Deferred<GPUDeviceLostInfo>;
  readonly textures: FakeTexture[];
  readonly buffers: Array<{
    readonly descriptor: GPUBufferDescriptor;
    readonly destroy: ReturnType<typeof vi.fn>;
  }>;
  readonly passes: FakePass[];
  readonly shaderDescriptors: GPUShaderModuleDescriptor[];
  readonly pipelineDescriptors: GPURenderPipelineDescriptor[];
  readonly bindGroupDescriptors: GPUBindGroupDescriptor[];
  readonly writeBuffer: ReturnType<typeof vi.fn>;
  readonly writeTexture: ReturnType<typeof vi.fn>;
  readonly uploadedBuffers: Uint8Array[];
  readonly submitted: ReturnType<typeof vi.fn>;
  readonly onSubmittedWorkDone: ReturnType<typeof vi.fn>;
  readonly pushErrorScope: ReturnType<typeof vi.fn>;
  readonly popErrorScope: ReturnType<typeof vi.fn>;
  readonly scopeErrors: Array<GPUError | null>;
  readonly destroyDevice: ReturnType<typeof vi.fn>;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function fakeGpuHarness(
  fence: () => Promise<void> = async () => undefined,
): FakeGpuHarness {
  const lost = deferred<GPUDeviceLostInfo>();
  const textures: FakeTexture[] = [];
  const buffers: FakeGpuHarness["buffers"] = [];
  const passes: FakePass[] = [];
  const shaderDescriptors: GPUShaderModuleDescriptor[] = [];
  const pipelineDescriptors: GPURenderPipelineDescriptor[] = [];
  const bindGroupDescriptors: GPUBindGroupDescriptor[] = [];
  const uploadedBuffers: Uint8Array[] = [];
  const writeBuffer = vi.fn((
    _buffer: GPUBuffer,
    _offset: number,
    data: AllowSharedBufferSource,
  ) => {
    const source = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
    uploadedBuffers.push(new Uint8Array(source));
  });
  const writeTexture = vi.fn();
  const submitted = vi.fn();
  const onSubmittedWorkDone = vi.fn(fence);
  const scopeErrors: Array<GPUError | null> = [];
  const pushErrorScope = vi.fn();
  const popErrorScope = vi.fn(async () => scopeErrors.shift() ?? null);
  const destroyDevice = vi.fn();
  const device = {
    lost: lost.promise,
    queue: {
      writeBuffer,
      writeTexture,
      submit: submitted,
      onSubmittedWorkDone,
    },
    pushErrorScope,
    popErrorScope,
    createTexture: vi.fn((descriptor: GPUTextureDescriptor) => {
      const destroy = vi.fn();
      textures.push({ descriptor, destroy });
      return {
        descriptor,
        createView: vi.fn(() => ({ textureLabel: descriptor.label })),
        destroy,
      } as unknown as GPUTexture;
    }),
    createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => {
      const destroy = vi.fn();
      buffers.push({ descriptor, destroy });
      return { descriptor, destroy } as unknown as GPUBuffer;
    }),
    createSampler: vi.fn((descriptor: GPUSamplerDescriptor) => ({ descriptor })),
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
    createBindGroup: vi.fn((descriptor: GPUBindGroupDescriptor) => {
      bindGroupDescriptors.push(descriptor);
      return { descriptor };
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
  const context = {
    configure: vi.fn(),
    unconfigure: vi.fn(),
    getCurrentTexture: vi.fn(() => ({
      createView: vi.fn(() => ({ presentationView: true })),
    })),
  } as unknown as GPUCanvasContext;
  return {
    device,
    context,
    canvas: { width: 1, height: 1 },
    lost,
    textures,
    buffers,
    passes,
    shaderDescriptors,
    pipelineDescriptors,
    bindGroupDescriptors,
    writeBuffer,
    writeTexture,
    uploadedBuffers,
    submitted,
    onSubmittedWorkDone,
    pushErrorScope,
    popErrorScope,
    scopeErrors,
    destroyDevice,
  };
}

function texturedPlan(
  overrides: Partial<StudioEngineWebGpuTexturedBrushPlan> = {},
): StudioEngineWebGpuTexturedBrushPlan {
  const assetBytes = new Uint8Array([0, 64, 128, 255]);
  const porterDuff = overrides.dabs?.[0]?.composite.porterDuff ?? "source-over";
  const assets: StudioEngineWebGpuTexturedBrushPlan["assets"] = [{
    assetIndex: 0,
    role: "tip",
    assetId: "tip",
    contentHash: `sha256:${sha256HexPortable(assetBytes)}`,
    width: 2,
    height: 2,
    channel: "alpha",
    format: "r8-unorm",
    byteLength: 4,
    bytes: assetBytes,
  }];
  const dabs: StudioEngineWebGpuTexturedBrushPlan["dabs"] = [{
    index: 0,
    stationX: 8,
    stationY: 4,
    x: 8,
    y: 4,
    pressure: 0.7,
    diameter: 4,
    opacity: 0.8,
    flow: 0.5,
    grainDepth: 0.6,
    color: {
      space: "linear-srgb",
      alphaMode: "straight",
      components: [0.5, 0.25, 1, 0.4],
    },
    composite: { porterDuff, blendMode: "normal" },
    tip: {
      hardness: 0.65,
      roundness: 0.5,
      angleRadians: 0.25,
      localToDocument: [2, 0.5, -0.75, 1],
    },
  }];
  const batches: StudioEngineWebGpuTexturedBrushPlan["batches"] = [{
    key: `tip|none|${porterDuff}`,
    tipAssetIndex: 0,
    grainAssetIndex: null,
    porterDuff,
    firstInstance: 0,
    instanceCount: 1,
  }];
  return {
    kind: "studio-engine-webgpu-textured-brush-plan",
    version: 1,
    loweringVersion: 1,
    mode: "rebuild",
    strokeId: "textured-stroke",
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
    grain: {
      kind: "procedural-integer-noise",
      assetIndex: null,
      space: "stroke",
      scale: 8,
      depth: 0.75,
      contrast: 0.4,
      invert: false,
      seed: 0xabcd_1234,
      originX: 8,
      originY: 4,
      filtering: "integer-cell",
      edgeMode: "infinite",
    },
    assets,
    dabs,
    batches,
    ...overrides,
  };
}

function texturedPlanWithTip(
  assetId: string,
  values: readonly number[],
): StudioEngineWebGpuTexturedBrushPlan {
  if (values.length !== 4) throw new RangeError("test tip must remain 2x2");
  const base = texturedPlan();
  const bytes = new Uint8Array(values);
  return texturedPlan({
    assets: [{
      ...base.assets[0]!,
      assetId,
      contentHash: `sha256:${sha256HexPortable(bytes)}`,
      byteLength: bytes.byteLength,
      bytes,
    }],
    batches: [{
      ...base.batches[0]!,
      key: assetId + "|none|source-over",
    }],
  });
}

function runtime(harness: FakeGpuHarness, overrides = {}) {
  const result = createStudioEngineWebGpuTexturedBrushRuntime({
    device: harness.device,
    width: 64,
    height: 32,
    ...overrides,
  });
  if (result.status !== "ready") throw new Error(result.reason);
  return result.runtime;
}

function fingerprinted(
  plan: StudioEngineWebGpuTexturedBrushPlan,
): StudioEngineWebGpuTexturedBrushPlan {
  const semanticFingerprint =
    fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics({
      ...plan,
      semanticFingerprint: undefined,
    });
  if (!semanticFingerprint) throw new Error("semantic fingerprint failed");
  return { ...plan, semanticFingerprint };
}

function presentationLease(
  harness: FakeGpuHarness,
  plan: StudioEngineWebGpuTexturedBrushPlan,
  overrides: Partial<StudioEngineWebGpuPresentationFrameLease> = {},
): Readonly<{
  lease: StudioEngineWebGpuPresentationFrameLease;
  owner: StudioEngineWebGpuPresentationSurface;
  texture: FakeTexture;
  view: GPUTextureView;
}> {
  const sourceFrameFingerprint =
    fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics(plan);
  if (!sourceFrameFingerprint) throw new Error("semantic fingerprint failed");
  const activeLayout: StudioEngineWebGpuPresentationLayout = {
    presentationEpoch: 4,
    resizeEpoch: 2,
    viewportEpoch: 3,
    flipEpoch: 1,
    cssWidth: 160,
    cssHeight: 90,
    dpr: 2,
    viewport: {
      logicalWidth: 64,
      logicalHeight: 32,
      scaleX: 1.5,
      scaleY: 2,
      offsetX: 7,
      offsetY: 11,
      flipX: false,
      flipY: true,
    },
  };
  const created = createStudioEngineWebGpuPresentationSurface({
    device: harness.device,
    context: harness.context,
    canvas: harness.canvas,
    canvasFormat: "bgra8unorm",
    ownsDevice: false,
  });
  if (created.status !== "ready") throw new Error(created.reason);
  const configured = created.surface.configure(activeLayout);
  if (configured.status !== "ready") throw new Error(configured.status);
  const begun = created.surface.beginFrame({
    requestSequence: 1,
    deviceEpoch: 1,
    presentationEpoch: activeLayout.presentationEpoch,
    resizeEpoch: activeLayout.resizeEpoch,
    viewportEpoch: activeLayout.viewportEpoch,
    flipEpoch: activeLayout.flipEpoch,
    sourceFrameFingerprint,
  });
  if (begun.status !== "ready") throw new Error(begun.reason);
  const authoritativeLease = begun.frame;
  const lease = Object.keys(overrides).length > 0
    ? { ...authoritativeLease, ...overrides }
    : authoritativeLease;
  const texture = harness.textures.at(-1)!;
  return {
    lease,
    owner: created.surface,
    texture,
    view: authoritativeLease.workSurface.view,
  };
}

describe("textured RGBA16F WebGPU specialist runtime", () => {
  it("packs a document-to-surface affine independently from document-space grain", () => {
    expect([
      ...packStudioEngineWebGpuTexturedBrushViewportUniform(320, 180, {
        m11: 3,
        m12: 0,
        m21: 0,
        m22: -4,
        dx: 14,
        dy: 150,
      }),
    ]).toEqual([
      320,
      180,
      Math.fround(1 / 320),
      Math.fround(1 / 180),
      3,
      -4,
      14,
      150,
    ]);
    expect(() => packStudioEngineWebGpuTexturedBrushViewportUniform(320, 180, {
      m11: 1,
      m12: 1 as 0,
      m21: 0,
      m22: 1,
      dx: 0,
      dy: 0,
    })).toThrow("invalid-textured-brush-viewport");
  });

  it("packs premultiplied colour, grain flags, seeds and texture dimensions", () => {
    const packed = packStudioEngineWebGpuTexturedBrushDabs(texturedPlan());

    expect(packed).toHaveLength(STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_INSTANCE_FLOATS);
    expect([...packed.slice(0, 6)]).toEqual([8, 4, 2, 0.5, -0.75, 1]);
    expect([...packed.slice(6, 10)]).toEqual([
      Math.fround(0.5 * 0.4),
      Math.fround(0.25 * 0.4),
      Math.fround(1 * 0.4),
      Math.fround(0.4),
    ]);
    expect([...packed.slice(10, 16)]).toEqual([
      Math.fround(0.65),
      Math.fround(0.6),
      8,
      Math.fround(0.4),
      8,
      4,
    ]);
    expect([...packed.slice(20, 28)]).toEqual([
      1,
      1,
      0x1234,
      0xabcd,
      2,
      2,
      1,
      1,
    ]);

    const base = texturedPlan();
    const maximumSeed = packStudioEngineWebGpuTexturedBrushDabs(texturedPlan({
      grain: {
        ...base.grain!,
        seed: 0xffff_ffff,
      },
    }));
    const low = maximumSeed[22]!;
    const high = maximumSeed[23]!;
    expect(Number.isInteger(low)).toBe(true);
    expect(Number.isInteger(high)).toBe(true);
    expect(((high << 16) | low) >>> 0).toBe(0xffff_ffff);
  });

  it("rejects malformed paint channels and impossible opacity-flow alpha before GPU mutation", async () => {
    const harness = fakeGpuHarness();
    const target = runtime(harness);
    const initialWriteBufferCalls = harness.writeBuffer.mock.calls.length;
    const base = texturedPlan();
    const baseDab = base.dabs[0]!;
    const malformedDabs: StudioEngineWebGpuTexturedBrushPlan["dabs"][] = [
      [{ ...baseDab, pressure: -0.01 }],
      [{ ...baseDab, opacity: 1.01 }],
      [{ ...baseDab, flow: -0.01 }],
      [{ ...baseDab, grainDepth: 1.01 }],
      [{
        ...baseDab,
        color: { ...baseDab.color, components: [1.01, 0.25, 1, 0.4] },
      }],
      [{
        ...baseDab,
        // opacity × flow is 0.4, so no straight source alpha in [0, 1] can produce 0.41.
        color: { ...baseDab.color, components: [0.5, 0.25, 1, 0.41] },
      }],
      [{
        ...baseDab,
        tip: { ...baseDab.tip, hardness: 1.01 },
      }],
      [{
        ...baseDab,
        tip: { ...baseDab.tip, roundness: 0 },
      }],
    ];

    for (const dabs of malformedDabs) {
      await expect(target.execute({
        requestSequence: 1,
        deviceEpoch: 1,
        plan: texturedPlan({ dabs }),
      })).resolves.toEqual({ status: "rejected", reason: "invalid-frame" });
    }
    expect(harness.writeBuffer).toHaveBeenCalledTimes(initialWriteBufferCalls);
    expect(harness.submitted).not.toHaveBeenCalled();
  });

  it("admits translucent source alpha when it remains within the opacity-flow ceiling", async () => {
    const harness = fakeGpuHarness();
    const target = runtime(harness);
    const base = texturedPlan();
    const result = await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: texturedPlan({
        dabs: [{
          ...base.dabs[0]!,
          // 0.2 = source alpha 0.5 × opacity 0.8 × flow 0.5.
          color: {
            ...base.dabs[0]!.color,
            components: [0.5, 0.25, 1, 0.2],
          },
        }],
      }),
    });

    expect(result.status).toBe("completed");
    expect(harness.submitted).toHaveBeenCalledTimes(1);
  });

  it("packs a wrapped durable centre UV before million-pixel f32 precision is lost", () => {
    const bytes = new Uint8Array([0, 255]);
    const source = {
      kind: "r8-texture-v1" as const,
      asset: {
        assetId: "paper.large-anchor",
        encodedSha256:
          "sha256:1111111111111111111111111111111111111111111111111111111111111111" as const,
        decodedSha256: `sha256:${sha256HexPortable(bytes)}` as const,
        byteLength: 64,
        mediaType: "image/png" as const,
        width: 2,
        height: 1,
        channel: "alpha" as const,
        encoding: "r8-unorm" as const,
      },
    };
    const strokeOriginX = 999_999.91;
    const strokeOriginY = -999_999.89;
    const native = planStudioWebGpuR8GrainNative({
      source,
      space: "stroke-fixed",
      scale: 0.3,
      amount: 1,
      contrast: 0,
      seed: 0x1234,
      strokeOriginX,
      strokeOriginY,
      strokeSeed: 0x5678,
    });
    expect(native.status).toBe("ready");
    if (native.status !== "ready") return;
    const base = texturedPlan();
    const dabX = strokeOriginX - 0.09;
    const dabY = strokeOriginY + 0.11;
    const packed = packStudioEngineWebGpuTexturedBrushDabs(
      texturedPlan({
        dabs: [{
          ...base.dabs[0]!,
          x: dabX,
          y: dabY,
        }],
      }),
      undefined,
      {
        source: native.plan.source,
        parameters: native.plan.parameters,
      },
    );
    expect(native.plan.parameters.anchorX).toBe(strokeOriginX);
    expect(native.plan.parameters.anchorY).toBe(strokeOriginY);
    expect(packed[14]).toBe(Math.fround(strokeOriginX));
    const wrap = (value: number) => ((value % 1) + 1) % 1;
    const expectedCenterU = wrap(
      (dabX - native.plan.parameters.anchorX) / native.plan.parameters.scale
        + native.plan.parameters.phaseX
    );
    const expectedCenterV = wrap(
      (dabY - native.plan.parameters.anchorY) / native.plan.parameters.scale
        + native.plan.parameters.phaseY
    );
    expect(packed[26]).toBeCloseTo(expectedCenterU, 6);
    expect(packed[27]).toBeCloseTo(expectedCenterV, 6);

    const localOffsetX = 0.04;
    const vertexUv = packed[26]! + localOffsetX / packed[12]!;
    const expectedOffsetUv = wrap(
      (dabX + localOffsetX - native.plan.parameters.anchorX)
        / native.plan.parameters.scale
        + native.plan.parameters.phaseX
    );
    expect(wrap(vertexUv)).toBeCloseTo(expectedOffsetUv, 5);

    const lossyFragmentUv = (
      (Math.fround(dabX) - Math.fround(native.plan.parameters.anchorX))
        / native.plan.parameters.scale
        + native.plan.parameters.phaseX
    );
    expect(
      Math.abs(wrap(lossyFragmentUv) - packed[26]!),
    ).toBeGreaterThan(0.05);
  });

  it("creates explicit source-over/destination-out pipelines and submits stable bound batches", async () => {
    const harness = fakeGpuHarness();
    const target = runtime(harness);
    const result = await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: texturedPlan(),
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.receipt).toMatchObject({
      backend: "webgpu",
      textureFormat: "rgba16float",
      colorModel: "scene-linear-premultiplied",
      requestSequence: 1,
      deviceEpoch: 1,
      mode: "rebuild",
      dabCount: 1,
      batchCount: 1,
      assetCount: 1,
      assetBytes: 4,
      renderTarget: "private",
      workSurfaceEpoch: null,
      queueState: "completed",
      complete: true,
    });
    expect(result.receipt.sourceFrameFingerprint).toBe(
      fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics(texturedPlan()),
    );
    expect(harness.pipelineDescriptors).toHaveLength(2);
    expect(harness.pipelineDescriptors.map((descriptor) => descriptor.label)).toEqual([
      "Studio textured brush source-over pipeline",
      "Studio textured brush destination-out pipeline",
    ]);
    const shader = harness.shaderDescriptors[0]!.code;
    expect(shader).toContain("@vertex");
    expect(shader).toContain("@fragment");
    for (let binding = 0; binding <= 4; binding += 1) {
      expect(shader).toContain(`@binding(${binding})`);
    }
    expect(shader).toContain("integer_noise");
    expect(shader).toContain("let asset_grain = textureSample");
    expect(shader).not.toContain("if (grain_kind");
    expect(shader).toContain("let padded_size = tip_size + vec2f(2.0)");
    expect(shader).toContain(
      "let padded_uv = (uv * tip_size + vec2f(1.0)) / padded_size",
    );
    expect(shader).toContain("grain_invert");
    expect(shader).toContain(
      "u32(input.flags.z + 0.5) | (u32(input.flags.w + 0.5) << 16u)",
    );
    const sourceTarget = harness.pipelineDescriptors[0]!.fragment!.targets[0]!;
    const eraseTarget = harness.pipelineDescriptors[1]!.fragment!.targets[0]!;
    expect(sourceTarget).toMatchObject({
      format: "rgba16float",
      blend: {
        color: {
          operation: "add",
          srcFactor: "one",
          dstFactor: "one-minus-src-alpha",
        },
        alpha: {
          operation: "add",
          srcFactor: "one",
          dstFactor: "one-minus-src-alpha",
        },
      },
    });
    expect(eraseTarget).toMatchObject({
      format: "rgba16float",
      blend: {
        color: {
          operation: "add",
          srcFactor: "zero",
          dstFactor: "one-minus-src-alpha",
        },
        alpha: {
          operation: "add",
          srcFactor: "zero",
          dstFactor: "one-minus-src-alpha",
        },
      },
    });
    expect(harness.writeTexture).toHaveBeenCalledTimes(2);
    expect(harness.textures[1]!.descriptor.size).toEqual({
      width: 4,
      height: 4,
      depthOrArrayLayers: 1,
    });
    expect(harness.bindGroupDescriptors[0]!.entries).toHaveLength(5);
    expect(harness.passes[0]!.draw).toHaveBeenCalledWith(6, 1, 0, 0);
    expect(harness.passes[0]!.descriptor.colorAttachments[0]).toMatchObject({
      loadOp: "clear",
      storeOp: "store",
    });
    expect(harness.submitted).toHaveBeenCalledTimes(1);
  });

  it("renders directly into an exact shared presentation lease and packs its affine", async () => {
    const harness = fakeGpuHarness();
    const plan = texturedPlan();
    const shared = presentationLease(harness, plan);
    const texturesBeforeRuntime = harness.textures.length;
    const created = createStudioEngineWebGpuTexturedBrushRuntime({
      device: harness.device,
      presentationOnly: true,
    });
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;
    const target = created.runtime;

    expect(harness.textures).toHaveLength(texturesBeforeRuntime);
    expect(harness.textures.some((texture) => (
      texture.descriptor.label === "Studio textured brush rgba16float authority"
    ))).toBe(false);

    const result = await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan,
      presentationLease: shared.lease,
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.receipt).toMatchObject({
      renderTarget: "presentation",
      sourceFrameFingerprint: shared.lease.sourceFrameFingerprint,
      workSurfaceEpoch: shared.lease.workSurface.workSurfaceEpoch,
    });
    expect(
      harness.passes[0]!.descriptor.colorAttachments[0]!.view,
    ).toBe(shared.view);
    const viewportWrites = harness.uploadedBuffers
      .filter((bytes) => bytes.byteLength === 32)
      .map((bytes) => new Float32Array(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
      ));
    expect([...viewportWrites.at(-1)!]).toEqual([
      320,
      180,
      Math.fround(1 / 320),
      Math.fround(1 / 180),
      3,
      -4,
      14,
      150,
    ]);
    expect(harness.shaderDescriptors.find((descriptor) => (
      descriptor.label === "Studio textured brush clean-room shader"
    ))?.code).toContain(
      "let surface = document * viewport.document_scale + viewport.document_offset",
    );
  });

  it("requires a rebuild on a new shared surface and chains later append content", async () => {
    const harness = fakeGpuHarness();
    const appendOnlyPlan = texturedPlan({ mode: "append" });
    const fresh = presentationLease(harness, appendOnlyPlan);
    const target = runtime(harness, { presentationOnly: true });

    expect(await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: appendOnlyPlan,
      presentationLease: fresh.lease,
    })).toEqual({ status: "rejected", reason: "content-uninitialized" });
    expect(harness.submitted).not.toHaveBeenCalled();
    expect(fresh.owner.abortFrame(fresh.lease)).toEqual({ status: "aborted" });

    const rebuildPlan = texturedPlan({
      strokeId: "content-chain-rebuild",
      commandSequence: 2,
    });
    const rebuildFingerprint =
      fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics(rebuildPlan);
    if (!rebuildFingerprint) throw new Error("rebuild fingerprint failed");
    const rebuildFrame = fresh.owner.beginFrame({
      requestSequence: 2,
      deviceEpoch: 1,
      presentationEpoch: fresh.lease.presentationEpoch,
      resizeEpoch: fresh.lease.resizeEpoch,
      viewportEpoch: fresh.lease.viewportEpoch,
      flipEpoch: fresh.lease.flipEpoch,
      sourceFrameFingerprint: rebuildFingerprint,
    });
    expect(rebuildFrame.status).toBe("ready");
    if (rebuildFrame.status !== "ready") return;
    const rebuilt = await target.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: rebuildPlan,
      presentationLease: rebuildFrame.frame,
    });
    expect(rebuilt.status).toBe("completed");
    if (rebuilt.status !== "completed") return;
    expect(rebuilt.receipt).toMatchObject({
      mode: "rebuild",
      baseContentFingerprint: null,
      contentGeneration: expect.any(Number),
      contentFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
    expect((await fresh.owner.presentFrame(
      rebuildFrame.frame,
      rebuilt.receipt,
    )).status).toBe("presented");

    const appendPlan = texturedPlan({
      mode: "append",
      strokeId: "content-chain-append",
      commandSequence: 3,
    });
    const appendFingerprint =
      fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics(appendPlan);
    if (!appendFingerprint) throw new Error("append fingerprint failed");
    const appendFrame = fresh.owner.beginFrame({
      requestSequence: 3,
      deviceEpoch: 1,
      presentationEpoch: fresh.lease.presentationEpoch,
      resizeEpoch: fresh.lease.resizeEpoch,
      viewportEpoch: fresh.lease.viewportEpoch,
      flipEpoch: fresh.lease.flipEpoch,
      sourceFrameFingerprint: appendFingerprint,
    });
    expect(appendFrame.status).toBe("ready");
    if (appendFrame.status !== "ready") return;
    const appended = await target.execute({
      requestSequence: 3,
      deviceEpoch: 1,
      plan: appendPlan,
      presentationLease: appendFrame.frame,
    });
    expect(appended.status).toBe("completed");
    if (appended.status !== "completed") return;
    expect(appended.receipt.baseContentGeneration).toBe(
      rebuilt.receipt.contentGeneration,
    );
    expect(appended.receipt.baseContentFingerprint).toBe(
      rebuilt.receipt.contentFingerprint,
    );
    expect(appended.receipt.contentGeneration).toBeGreaterThan(
      rebuilt.receipt.contentGeneration!,
    );
    expect(appended.receipt.contentFingerprint).not.toBe(
      rebuilt.receipt.contentFingerprint,
    );
    expect((await fresh.owner.presentFrame(
      appendFrame.frame,
      appended.receipt,
    )).status).toBe("presented");
  });

  it("withholds completion when an owner aborts a submitted shared write", async () => {
    const gate = deferred<void>();
    const harness = fakeGpuHarness(() => gate.promise);
    const plan = texturedPlan();
    const shared = presentationLease(harness, plan);
    const target = runtime(harness, { presentationOnly: true });
    const pending = target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan,
      presentationLease: shared.lease,
    });
    await vi.waitFor(() => expect(harness.submitted).toHaveBeenCalledTimes(1));

    expect(shared.owner.abortFrame(shared.lease)).toEqual({ status: "aborted" });
    expect(shared.owner.stats()).toMatchObject({
      producerWriteInFlight: true,
      contentInitialized: false,
    });
    gate.resolve();
    expect(await pending).toEqual({
      status: "rejected",
      reason: "presentation-lease-invalid",
    });
    expect(shared.owner.stats()).toMatchObject({
      producerWriteInFlight: false,
      contentInitialized: false,
      contentFingerprint: null,
    });
  });

  it("fails closed for missing, stale or mismatched presentation authority", async () => {
    const harness = fakeGpuHarness();
    const plan = texturedPlan();
    const target = runtime(harness, { presentationOnly: true });

    expect(await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan,
    })).toEqual({
      status: "rejected",
      reason: "presentation-lease-required",
    });

    const stale = presentationLease(harness, plan, { requestSequence: 2 });
    expect(await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan,
      presentationLease: stale.lease,
    })).toEqual({
      status: "rejected",
      reason: "presentation-lease-invalid",
    });

    const wrongDevice = presentationLease(harness, plan, { deviceEpoch: 2 });
    expect(await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan,
      presentationLease: wrongDevice.lease,
    })).toEqual({
      status: "rejected",
      reason: "presentation-lease-invalid",
    });

    const wrongFingerprint = presentationLease(harness, plan, {
      sourceFrameFingerprint:
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    });
    expect(await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan,
      presentationLease: wrongFingerprint.lease,
    })).toEqual({
      status: "rejected",
      reason: "presentation-lease-invalid",
    });

    const valid = presentationLease(harness, plan);
    expect((await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan,
      presentationLease: valid.lease,
    })).status).toBe("completed");
    expect(harness.submitted).toHaveBeenCalledTimes(1);
  });

  it("never destroys a presentation-owned work surface", async () => {
    const harness = fakeGpuHarness();
    const plan = texturedPlan();
    const shared = presentationLease(harness, plan);
    const target = runtime(harness, { presentationOnly: true });
    expect((await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan,
      presentationLease: shared.lease,
    })).status).toBe("completed");

    target.dispose();
    target.dispose();

    expect(shared.texture.destroy).not.toHaveBeenCalled();
    const runtimeTextures = harness.textures.filter(
      (texture) => texture !== shared.texture,
    );
    expect(runtimeTextures.length).toBeGreaterThan(0);
    expect(runtimeTextures.every((texture) => (
      texture.destroy.mock.calls.length === 1
    ))).toBe(true);
  });

  it("reuses resident textures and stable bind groups across request sequences", async () => {
    const harness = fakeGpuHarness();
    const target = runtime(harness);
    expect((await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: texturedPlan(),
    })).status).toBe("completed");
    const textureWrites = harness.writeTexture.mock.calls.length;
    const bindGroups = harness.bindGroupDescriptors.length;
    expect((await target.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: texturedPlan({ mode: "append" }),
    })).status).toBe("completed");

    expect(harness.writeTexture).toHaveBeenCalledTimes(textureWrites);
    expect(harness.bindGroupDescriptors).toHaveLength(bindGroups);
    expect(harness.passes[1]!.descriptor.colorAttachments[0]).toMatchObject({
      loadOp: "load",
    });
  });

  it("executes durable R8 grain through one native texture and exact CPU-compatible parameters", async () => {
    let failFence = false;
    let heldFence: Deferred<void> | null = null;
    const harness = fakeGpuHarness(async () => {
      if (failFence) throw new Error("synthetic queue failure");
      if (heldFence) await heldFence.promise;
    });
    const decodedBytes = new Uint8Array([0, 64, 192, 255]);
    const source = {
      kind: "r8-texture-v1" as const,
      asset: {
        assetId: "paper.runtime-native.v1",
        encodedSha256:
          "sha256:1111111111111111111111111111111111111111111111111111111111111111" as const,
        decodedSha256: `sha256:${sha256HexPortable(decodedBytes)}` as const,
        byteLength: 128,
        mediaType: "image/png" as const,
        width: 2,
        height: 2,
        channel: "alpha" as const,
        encoding: "r8-unorm" as const,
      },
    };
    const registry = new StudioBrushR8GrainRegistry();
    expect(registry.hydrate(source, decodedBytes).status).toBe("ready");
    const nativeCache = new StudioWebGpuR8GrainTextureCache({
      device: harness.device,
      snapshotForTransfer: (candidate) => registry.snapshotForTransfer(candidate),
    });
    const target = runtime(harness, { nativeR8GrainTextureCache: nativeCache });
    const nativeR8Grain = {
      space: "stroke" as const,
      scale: 8,
      depth: 0.75,
      contrast: 0.5,
      seed: 0x1234,
      originX: 12,
      originY: 6,
    };
    const base = texturedPlan();
    const nativePlan = fingerprinted({
      ...base,
      grain: {
        kind: "asset-r8-repeat",
        assetIndex: 1,
        ...nativeR8Grain,
        invert: false,
        filtering: "bilinear",
        edgeMode: "repeat",
      },
      durableR8GrainSource: source,
      grainPhaseStrokeSeed: 0x5678,
      grainSamplingSemantics: "durable-r8-cpu-parity-v1",
      assets: [
        base.assets[0]!,
        {
          assetIndex: 1,
          role: "grain",
          assetId: source.asset.assetId,
          contentHash: source.asset.decodedSha256,
          width: source.asset.width,
          height: source.asset.height,
          channel: source.asset.channel,
          format: "r8-unorm",
          byteLength: decodedBytes.byteLength,
          bytes: new Uint8Array(decodedBytes),
        },
      ],
      dabs: [{ ...base.dabs[0]!, grainDepth: nativeR8Grain.depth }],
      batches: [{
        ...base.batches[0]!,
        key: `${base.assets[0]!.contentHash}|${source.asset.decodedSha256}|source-over`,
        grainAssetIndex: 1,
      }],
    });
    const result = await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: nativePlan,
    });
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.receipt).toMatchObject({
      nativeR8GrainSourceKey: JSON.stringify(source),
      nativeR8GrainTextureBytes: 4,
      planSemanticFingerprint: nativePlan.semanticFingerprint,
      grainSamplingSemantics: "durable-r8-cpu-parity-v1",
    });
    expect(nativeCache.stats()).toMatchObject({
      entries: 1,
      uploads: 1,
      activeLeases: 0,
    });
    expect(harness.textures.some((texture) => texture.descriptor.format === "r8unorm")).toBe(true);
    const nativeUpload = harness.writeTexture.mock.calls.find((call) => (
      (call[0] as { texture?: { descriptor?: GPUTextureDescriptor } }).texture
        ?.descriptor?.label === `Studio verified R8 grain ${source.asset.decodedSha256}`
    ));
    expect(nativeUpload).toBeDefined();

    const packed = new Float32Array(harness.uploadedBuffers.at(-1)!.buffer);
    expect(packed[11]).toBeCloseTo(nativeR8Grain.depth, 7);
    expect(packed[12]).toBeCloseTo(nativeR8Grain.scale, 7);
    expect(packed[13]).toBeCloseTo(nativeR8Grain.contrast, 7);
    expect((packed[21]! | 0) & 4).toBe(4);
    expect(packed[26]).toBeGreaterThanOrEqual(0);
    expect(packed[26]).toBeLessThan(1);
    expect(packed[27]).toBeGreaterThanOrEqual(0);
    expect(packed[27]).toBeLessThan(1);

    const writes = harness.writeTexture.mock.calls.length;
    const bindGroups = harness.bindGroupDescriptors.length;
    const replay = await target.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: fingerprinted({
        ...nativePlan,
        semanticFingerprint: undefined,
        mode: "append",
        dabs: [{ ...nativePlan.dabs[0]!, grainDepth: 0.25 }],
      }),
    });
    expect(replay.status).toBe("completed");
    expect(harness.writeTexture).toHaveBeenCalledTimes(writes);
    // Durable bind groups are intentionally request-scoped to the texture lease.
    expect(harness.bindGroupDescriptors).toHaveLength(bindGroups + 1);

    heldFence = deferred<void>();
    const controller = new AbortController();
    const submissionsBeforeCancellation = harness.submitted.mock.calls.length;
    const cancelledPromise = target.execute({
      requestSequence: 3,
      deviceEpoch: 1,
      plan: fingerprinted({
        ...nativePlan,
        semanticFingerprint: undefined,
        mode: "append",
      }),
    }, controller.signal);
    await vi.waitFor(() => {
      expect(nativeCache.stats().activeLeases).toBe(1);
      expect(harness.submitted).toHaveBeenCalledTimes(
        submissionsBeforeCancellation + 1,
      );
    });
    controller.abort("cancel-after-submit");
    heldFence.resolve(undefined);
    // Submission is an irreversible mutation boundary. A later AbortSignal cannot relabel
    // certified pixels as cancelled; the caller may discard the completed receipt instead.
    expect((await cancelledPromise).status).toBe("completed");
    expect(nativeCache.stats().activeLeases).toBe(0);
    heldFence = null;

    expect(await target.execute({
      requestSequence: 4,
      deviceEpoch: 1,
      plan: {
        ...nativePlan,
        semanticFingerprint:
          "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      },
    })).toEqual({ status: "rejected", reason: "invalid-frame" });
    expect(await target.execute({
      requestSequence: 4,
      deviceEpoch: 1,
      plan: {
        ...nativePlan,
        durableR8GrainSource: undefined,
      },
    })).toEqual({ status: "rejected", reason: "invalid-frame" });
    failFence = true;
    const failed = await target.execute({
      requestSequence: 4,
      deviceEpoch: 1,
      plan: fingerprinted({
        ...nativePlan,
        semanticFingerprint: undefined,
        mode: "append",
      }),
    });
    expect(failed).toEqual({ status: "failed", reason: "gpu-error" });
    expect(nativeCache.stats().activeLeases).toBe(0);
    failFence = false;
    const nativeTexture = harness.textures.find(
      (texture) => texture.descriptor.format === "r8unorm",
    );
    expect(nativeTexture).toBeDefined();
    target.dispose();
    expect(nativeTexture!.destroy).not.toHaveBeenCalled();
    nativeCache.dispose();
    expect(nativeTexture!.destroy).toHaveBeenCalledTimes(1);
  });

  it("separates cache entries for hash aliases with different dimensions or channels", async () => {
    const harness = fakeGpuHarness();
    const target = runtime(harness);
    const base = texturedPlan();
    expect((await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: base,
    })).status).toBe("completed");
    const afterBase = harness.writeTexture.mock.calls.length;
    const reshaped = texturedPlan({
      assets: [{
        ...base.assets[0]!,
        width: 1,
        height: 4,
      }],
    });
    expect((await target.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: reshaped,
    })).status).toBe("completed");
    expect(harness.writeTexture).toHaveBeenCalledTimes(afterBase + 1);
    expect(harness.textures.map((texture) => texture.descriptor.size)).toContainEqual({
      width: 3,
      height: 6,
      depthOrArrayLayers: 1,
    });

    const luminance = texturedPlan({
      tip: { ...base.tip, channel: "luminance" },
      assets: [{
        ...base.assets[0]!,
        channel: "luminance",
      }],
    });
    expect((await target.execute({
      requestSequence: 3,
      deviceEpoch: 1,
      plan: luminance,
    })).status).toBe("completed");
    expect(harness.writeTexture).toHaveBeenCalledTimes(afterBase + 2);
    expect(harness.bindGroupDescriptors).toHaveLength(3);

    const writesBeforeReplay = harness.writeTexture.mock.calls.length;
    expect((await target.execute({
      requestSequence: 4,
      deviceEpoch: 1,
      plan: luminance,
    })).status).toBe("completed");
    expect(harness.writeTexture).toHaveBeenCalledTimes(writesBeforeReplay);
  });

  it("rejects mutable asset bytes whose content no longer matches the plan hash", async () => {
    const harness = fakeGpuHarness();
    const target = runtime(harness);
    const base = texturedPlan();
    const mutated = texturedPlan({
      assets: [{
        ...base.assets[0]!,
        bytes: new Uint8Array([1, 64, 128, 255]),
      }],
    });

    expect(await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: mutated,
    })).toEqual({ status: "rejected", reason: "invalid-frame" });
    expect(harness.submitted).not.toHaveBeenCalled();
  });

  it("selects destination-out without changing the linear-premultiplied packing path", async () => {
    const harness = fakeGpuHarness();
    const target = runtime(harness);
    const base = texturedPlan();
    const destinationOut = texturedPlan({
      mode: "append",
      dabs: [{
        ...base.dabs[0]!,
        composite: { porterDuff: "destination-out", blendMode: "normal" },
      }],
      batches: [{
        ...base.batches[0]!,
        key: "tip|none|destination-out",
        porterDuff: "destination-out",
      }],
    });
    expect((await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: base,
    })).status).toBe("completed");
    expect((await target.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: destinationOut,
    })).status).toBe("completed");

    const pipeline = harness.passes[1]!.setPipeline.mock.calls[0]![0] as {
      descriptor: GPURenderPipelineDescriptor;
    };
    expect(pipeline.descriptor.label).toBe(
      "Studio textured brush destination-out pipeline",
    );
  });

  it("enforces in-flight backpressure without consuming the rejected sequence", async () => {
    const gate = deferred<void>();
    const harness = fakeGpuHarness(() => gate.promise);
    const target = runtime(harness, { maximumInFlightSubmissions: 1 });
    const first = target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: texturedPlan(),
    });
    expect(await target.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: texturedPlan({ mode: "append" }),
    })).toEqual({ status: "busy", inFlight: 1, maximum: 1 });
    gate.resolve();
    expect((await first).status).toBe("completed");

    expect((await target.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: texturedPlan({ mode: "append" }),
    })).status).toBe("completed");
  });

  it("serializes device-global GPU error scopes while allowing a bounded execution queue", async () => {
    const gate = deferred<void>();
    const harness = fakeGpuHarness(() => gate.promise);
    const target = runtime(harness, { maximumInFlightSubmissions: 2 });
    const first = target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: texturedPlan(),
    });
    await vi.waitFor(() => expect(harness.pushErrorScope).toHaveBeenCalledTimes(3));
    const second = target.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: texturedPlan({ mode: "append" }),
    });
    await Promise.resolve();
    expect(target.inFlight).toBe(2);
    expect(harness.pushErrorScope).toHaveBeenCalledTimes(3);

    gate.resolve();
    expect((await first).status).toBe("completed");
    expect((await second).status).toBe("completed");
    expect(harness.pushErrorScope).toHaveBeenCalledTimes(6);
    expect(harness.popErrorScope).toHaveBeenCalledTimes(6);
    expect(harness.submitted).toHaveBeenCalledTimes(2);
  });

  it("reclaims least-recently-used idle textures during long brush-switch sessions", async () => {
    const harness = fakeGpuHarness();
    const target = runtime(harness, { maximumResidentAssetBytes: 8 });
    const planA = texturedPlanWithTip("tip-a", [0, 32, 128, 255]);
    const planB = texturedPlanWithTip("tip-b", [255, 128, 32, 0]);
    const planC = texturedPlanWithTip("tip-c", [0, 255, 64, 192]);
    const tipTextures = () => harness.textures.filter((texture) => (
      String(texture.descriptor.label).startsWith("Studio textured brush tip ")
    ));
    const textureFor = (plan: StudioEngineWebGpuTexturedBrushPlan) => (
      tipTextures().find((texture) => (
        String(texture.descriptor.label).includes(plan.assets[0]!.contentHash)
      ))
    );

    expect((await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: planA,
    })).status).toBe("completed");
    expect((await target.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: planB,
    })).status).toBe("completed");
    const textureA = textureFor(planA)!;
    const textureB = textureFor(planB)!;
    expect(tipTextures()).toHaveLength(2);

    expect((await target.execute({
      requestSequence: 3,
      deviceEpoch: 1,
      plan: planC,
    })).status).toBe("completed");
    const textureC = textureFor(planC)!;
    expect(textureA.destroy).toHaveBeenCalledTimes(1);
    expect(textureB.destroy).not.toHaveBeenCalled();
    expect(textureC.destroy).not.toHaveBeenCalled();
    expect(tipTextures()).toHaveLength(3);
    expect(harness.bindGroupDescriptors).toHaveLength(3);

    const texturesBeforeBReplay = tipTextures().length;
    expect((await target.execute({
      requestSequence: 4,
      deviceEpoch: 1,
      plan: planB,
    })).status).toBe("completed");
    expect(tipTextures()).toHaveLength(texturesBeforeBReplay);
    expect(harness.bindGroupDescriptors).toHaveLength(3);

    expect((await target.execute({
      requestSequence: 5,
      deviceEpoch: 1,
      plan: planA,
    })).status).toBe("completed");
    expect(textureC.destroy).toHaveBeenCalledTimes(1);
    expect(textureB.destroy).not.toHaveBeenCalled();
    expect(tipTextures()).toHaveLength(texturesBeforeBReplay + 1);
    expect(harness.bindGroupDescriptors).toHaveLength(4);
  });

  it("reuses content-addressed textures and bind groups across plan-local aliases", async () => {
    const harness = fakeGpuHarness();
    const target = runtime(harness);
    const values = [0, 32, 128, 255] as const;
    const planA = texturedPlanWithTip("alias-a", values);
    const planB = texturedPlanWithTip("alias-b", values);

    expect((await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: planA,
    })).status).toBe("completed");
    expect((await target.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: planB,
    })).status).toBe("completed");

    expect(harness.textures.filter((texture) => (
      String(texture.descriptor.label).startsWith("Studio textured brush tip ")
    ))).toHaveLength(1);
    expect(harness.bindGroupDescriptors).toHaveLength(1);
  });

  it("reuses the CPU dab staging allocation across sequential GPU submissions", async () => {
    const harness = fakeGpuHarness();
    const target = runtime(harness);

    expect((await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: texturedPlan(),
    })).status).toBe("completed");
    expect((await target.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: texturedPlan(),
    })).status).toBe("completed");

    const backingBuffers = harness.writeBuffer.mock.calls
      .filter((call) => (
        (call[0] as unknown as { descriptor?: GPUBufferDescriptor })
          .descriptor?.label === "Studio textured brush instance buffer"
      ))
      .map((call) => (
        (call[2] as unknown as Float32Array).buffer
      ));
    expect(backingBuffers).toHaveLength(2);
    expect(backingBuffers[0]).toBe(backingBuffers[1]);
  });

  it("does not evict a texture while submitted GPU work can still reference it", async () => {
    const gate = deferred<void>();
    const harness = fakeGpuHarness(() => gate.promise);
    const target = runtime(harness, {
      maximumInFlightSubmissions: 2,
      maximumResidentAssetBytes: 4,
    });
    const planA = texturedPlanWithTip("in-flight-a", [0, 64, 128, 255]);
    const planB = texturedPlanWithTip("in-flight-b", [255, 128, 64, 0]);
    const first = target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: planA,
    });
    await vi.waitFor(() => expect(harness.submitted).toHaveBeenCalledTimes(1));
    const textureA = harness.textures.find((texture) => (
      String(texture.descriptor.label).includes(planA.assets[0]!.contentHash)
    ))!;

    expect(await target.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: planB,
    })).toEqual({ status: "rejected", reason: "resident-asset-budget" });
    expect(textureA.destroy).not.toHaveBeenCalled();

    gate.resolve();
    expect((await first).status).toBe("completed");
    expect((await target.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: planB,
    })).status).toBe("completed");
    expect(textureA.destroy).toHaveBeenCalledTimes(1);
  });

  it("rejects cancellation, stale request/device epochs and resident asset overflow", async () => {
    const harness = fakeGpuHarness();
    const target = runtime(harness);
    const controller = new AbortController();
    controller.abort();
    expect(await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: texturedPlan(),
    }, controller.signal)).toEqual({ status: "cancelled" });
    expect(await target.execute({
      requestSequence: 1,
      deviceEpoch: 2,
      plan: texturedPlan(),
    })).toEqual({ status: "rejected", reason: "device-epoch" });
    expect((await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: texturedPlan(),
    })).status).toBe("completed");
    expect(await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: texturedPlan(),
    })).toEqual({ status: "rejected", reason: "request-sequence" });

    const limitedHarness = fakeGpuHarness();
    const limited = runtime(limitedHarness, { maximumResidentAssetBytes: 2 });
    expect(await limited.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: texturedPlan(),
    })).toEqual({ status: "rejected", reason: "resident-asset-budget" });
  });

  it("requires a clean queue fence and nested GPU error scopes before certifying pixels", async () => {
    const harness = fakeGpuHarness();
    harness.scopeErrors.push(
      { message: "validation failed" } as GPUError,
      null,
      null,
    );
    const target = runtime(harness);

    expect(await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: texturedPlan(),
    })).toEqual({ status: "failed", reason: "gpu-error" });
    expect(harness.pushErrorScope.mock.calls.map(([filter]) => filter)).toEqual([
      "internal",
      "out-of-memory",
      "validation",
    ]);
    expect(harness.popErrorScope).toHaveBeenCalledTimes(3);
    expect(await target.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: texturedPlan({ mode: "append" }),
    })).toEqual({ status: "failed", reason: "gpu-error" });
    expect(harness.submitted).toHaveBeenCalledTimes(1);
  });

  it("fails closed on device loss and disposes every owned resource exactly once", async () => {
    const harness = fakeGpuHarness();
    const onDeviceLost = vi.fn();
    const target = runtime(harness, { ownsDevice: true, onDeviceLost });
    const completed = await target.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      plan: texturedPlan(),
    });
    expect(completed.status).toBe("completed");
    if (completed.status !== "completed") return;
    expect(completed.receipt.deviceEpoch).toBe(1);
    const info = { reason: "unknown", message: "test loss" } as GPUDeviceLostInfo;
    harness.lost.resolve(info);
    await Promise.resolve();
    expect(onDeviceLost).toHaveBeenCalledWith(info);
    expect(target.deviceEpoch).toBe(2);
    expect(await target.execute({
      requestSequence: 2,
      deviceEpoch: 1,
      plan: texturedPlan(),
    })).toEqual({ status: "device-lost", deviceEpoch: 2 });

    target.dispose();
    target.dispose();
    expect(harness.destroyDevice).toHaveBeenCalledTimes(1);
    expect(harness.textures.every((texture) => texture.destroy.mock.calls.length === 1)).toBe(true);
    expect(harness.buffers.every((buffer) => buffer.destroy.mock.calls.length === 1)).toBe(true);
    expect(await target.execute({
      requestSequence: 3,
      deviceEpoch: 1,
      plan: texturedPlan(),
    })).toEqual({ status: "disposed" });
  });
});
