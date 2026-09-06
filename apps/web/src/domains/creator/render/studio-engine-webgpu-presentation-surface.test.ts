import { describe, expect, it, vi } from "vitest";

import {
  acquireStudioEngineWebGpuPresentationProducerWrite,
  createStudioEngineWebGpuPresentationSurface,
  settleStudioEngineWebGpuPresentationProducerWrite,
  STUDIO_ENGINE_WEBGPU_PRESENTATION_COLOR_MODEL,
  STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_FORMAT,
  STUDIO_ENGINE_WEBGPU_PRESENTATION_WORK_SURFACE_USAGE,
  type StudioEngineWebGpuPresentationFrameLease,
  type StudioEngineWebGpuPresentationFrameRequest,
  type StudioEngineWebGpuPresentationLayout,
  type StudioEngineWebGpuPresentationProducerReceipt,
  type StudioEngineWebGpuPresentationProducerWriteClaim,
  type StudioEngineWebGpuPresentationSurface,
  type StudioEngineWebGpuPresentationWriteMode,
} from "./studio-engine-webgpu-presentation-surface";

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

interface FakeTexture {
  readonly descriptor: GPUTextureDescriptor;
  readonly createView: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
}

interface FakePass {
  readonly descriptor: GPURenderPassDescriptor;
  readonly setPipeline: ReturnType<typeof vi.fn>;
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
  readonly passes: FakePass[];
  readonly shaderDescriptors: GPUShaderModuleDescriptor[];
  readonly pipelineDescriptors: GPURenderPipelineDescriptor[];
  readonly bindGroupDescriptors: GPUBindGroupDescriptor[];
  readonly configure: ReturnType<typeof vi.fn>;
  readonly unconfigure: ReturnType<typeof vi.fn>;
  readonly getCurrentTexture: ReturnType<typeof vi.fn>;
  readonly submit: ReturnType<typeof vi.fn>;
  readonly onSubmittedWorkDone: ReturnType<typeof vi.fn>;
  readonly pushErrorScope: ReturnType<typeof vi.fn>;
  readonly popErrorScope: ReturnType<typeof vi.fn>;
  readonly destroyDevice: ReturnType<typeof vi.fn>;
  readonly scopeErrors: Array<GPUError | null>;
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
  maximumTextureDimension2D = 8_192,
): FakeGpuHarness {
  const lost = deferred<GPUDeviceLostInfo>();
  const textures: FakeTexture[] = [];
  const passes: FakePass[] = [];
  const shaderDescriptors: GPUShaderModuleDescriptor[] = [];
  const pipelineDescriptors: GPURenderPipelineDescriptor[] = [];
  const bindGroupDescriptors: GPUBindGroupDescriptor[] = [];
  const scopeErrors: Array<GPUError | null> = [];
  const pushErrorScope = vi.fn();
  const popErrorScope = vi.fn(async () => scopeErrors.shift() ?? null);
  const submit = vi.fn();
  const onSubmittedWorkDone = vi.fn(fence);
  const destroyDevice = vi.fn();
  const device = {
    lost: lost.promise,
    limits: { maxTextureDimension2D: maximumTextureDimension2D },
    queue: {
      submit,
      onSubmittedWorkDone,
    },
    pushErrorScope,
    popErrorScope,
    createBindGroupLayout: vi.fn((descriptor: GPUBindGroupLayoutDescriptor) => ({
      descriptor,
    })),
    createShaderModule: vi.fn((descriptor: GPUShaderModuleDescriptor) => {
      shaderDescriptors.push(descriptor);
      return { descriptor };
    }),
    createPipelineLayout: vi.fn((descriptor: GPUPipelineLayoutDescriptor) => ({
      descriptor,
    })),
    createRenderPipeline: vi.fn((descriptor: GPURenderPipelineDescriptor) => {
      pipelineDescriptors.push(descriptor);
      return { descriptor };
    }),
    createTexture: vi.fn((descriptor: GPUTextureDescriptor) => {
      const createView = vi.fn((viewDescriptor?: GPUTextureViewDescriptor) => ({
        descriptor: viewDescriptor,
        textureLabel: descriptor.label,
      }));
      const destroy = vi.fn();
      const texture = { descriptor, createView, destroy };
      textures.push(texture);
      return texture;
    }),
    createBindGroup: vi.fn((descriptor: GPUBindGroupDescriptor) => {
      bindGroupDescriptors.push(descriptor);
      return { descriptor };
    }),
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
  const configure = vi.fn();
  const unconfigure = vi.fn();
  const getCurrentTexture = vi.fn(() => ({
    createView: vi.fn(() => ({ presentationView: true })),
  }));
  const context = {
    configure,
    unconfigure,
    getCurrentTexture,
  } as unknown as GPUCanvasContext;
  return {
    device,
    context,
    canvas: { width: 1, height: 1 },
    lost,
    textures,
    passes,
    shaderDescriptors,
    pipelineDescriptors,
    bindGroupDescriptors,
    configure,
    unconfigure,
    getCurrentTexture,
    submit,
    onSubmittedWorkDone,
    pushErrorScope,
    popErrorScope,
    destroyDevice,
    scopeErrors,
  };
}

function layout(
  overrides: Partial<StudioEngineWebGpuPresentationLayout> = {},
): StudioEngineWebGpuPresentationLayout {
  const base: StudioEngineWebGpuPresentationLayout = {
    presentationEpoch: 1,
    resizeEpoch: 1,
    viewportEpoch: 1,
    flipEpoch: 1,
    cssWidth: 320,
    cssHeight: 180,
    dpr: 2,
    viewport: {
      logicalWidth: 100,
      logicalHeight: 50,
      scaleX: 2,
      scaleY: 3,
      offsetX: 10,
      offsetY: 20,
      flipX: true,
      flipY: false,
    },
  };
  return {
    ...base,
    ...overrides,
    viewport: {
      ...base.viewport,
      ...overrides.viewport,
    },
  };
}

function frameRequest(
  overrides: Partial<StudioEngineWebGpuPresentationFrameRequest> = {},
): StudioEngineWebGpuPresentationFrameRequest {
  return {
    requestSequence: 1,
    deviceEpoch: 1,
    presentationEpoch: 1,
    resizeEpoch: 1,
    viewportEpoch: 1,
    flipEpoch: 1,
    sourceFrameFingerprint: "sha256:canonical-frame-1",
    ...overrides,
  };
}

const completedProducerReceipts = new WeakMap<
  StudioEngineWebGpuPresentationFrameLease,
  StudioEngineWebGpuPresentationProducerReceipt
>();

function receiptFromClaim(
  frame: StudioEngineWebGpuPresentationFrameLease,
  claim: StudioEngineWebGpuPresentationProducerWriteClaim,
  overrides: Partial<StudioEngineWebGpuPresentationProducerReceipt> = {},
): StudioEngineWebGpuPresentationProducerReceipt {
  return {
    backend: "webgpu",
    textureFormat: STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_FORMAT,
    colorModel: STUDIO_ENGINE_WEBGPU_PRESENTATION_COLOR_MODEL,
    requestSequence: frame.requestSequence,
    deviceEpoch: frame.deviceEpoch,
    renderTarget: "presentation",
    sourceFrameFingerprint: frame.sourceFrameFingerprint,
    workSurfaceEpoch: frame.workSurface.workSurfaceEpoch,
    mode: claim.mode,
    baseContentGeneration: claim.baseContentGeneration,
    baseContentFingerprint: claim.baseContentFingerprint,
    contentGeneration: claim.contentGeneration,
    contentFingerprint: claim.contentFingerprint,
    queueState: "completed",
    complete: true,
    ...overrides,
  };
}

function producerReceipt(
  frame: StudioEngineWebGpuPresentationFrameLease,
  overrides: Partial<StudioEngineWebGpuPresentationProducerReceipt> = {},
  mode: StudioEngineWebGpuPresentationWriteMode = "rebuild",
): StudioEngineWebGpuPresentationProducerReceipt {
  let receipt = completedProducerReceipts.get(frame);
  if (!receipt) {
    const acquired = acquireStudioEngineWebGpuPresentationProducerWrite(
      frame,
      { mode, sourceFrameFingerprint: frame.sourceFrameFingerprint },
    );
    if (acquired.status !== "ready") throw new Error(acquired.reason);
    const settled = settleStudioEngineWebGpuPresentationProducerWrite(
      acquired.claim,
      "completed",
    );
    if (settled.status !== "completed") throw new Error(settled.status);
    receipt = Object.freeze(receiptFromClaim(frame, acquired.claim));
    completedProducerReceipts.set(frame, receipt);
  }
  return { ...receipt, ...overrides };
}

function runtime(
  harness: FakeGpuHarness,
  overrides: Partial<Parameters<
    typeof createStudioEngineWebGpuPresentationSurface
  >[0]> = {},
): StudioEngineWebGpuPresentationSurface {
  const created = createStudioEngineWebGpuPresentationSurface({
    device: harness.device,
    context: harness.context,
    canvas: harness.canvas,
    canvasFormat: "bgra8unorm",
    ...overrides,
  });
  if (created.status !== "ready") throw new Error(created.reason);
  return created.surface;
}

function configuredFrame(
  surface: StudioEngineWebGpuPresentationSurface,
  request: StudioEngineWebGpuPresentationFrameRequest = frameRequest(),
) {
  const configured = surface.configure(layout());
  if (configured.status !== "ready") throw new Error(configured.status);
  const begun = surface.beginFrame(request);
  if (begun.status !== "ready") throw new Error(begun.reason);
  return begun.frame;
}

describe("shared linear WebGPU presentation surface", () => {
  it("allocates an exact RGBA16F work surface and resolves DPR, viewport and flip", () => {
    const harness = fakeGpuHarness();
    const surface = runtime(harness);

    expect(surface.visibility()).toEqual({
      visible: false,
      reason: "unconfigured",
    });
    const configured = surface.configure(layout());

    expect(configured.status).toBe("ready");
    if (configured.status !== "ready") return;
    expect(configured.allocation).toBe("created");
    expect(configured.configuration).toMatchObject({
      physicalWidth: 640,
      physicalHeight: 360,
      surfacePixels: 230_400,
      surfaceBytes: 1_843_200,
      documentToSurface: {
        m11: -4,
        m12: 0,
        m21: 0,
        m22: 6,
        dx: 420,
        dy: 40,
      },
    });
    expect(Object.isFrozen(configured.configuration)).toBe(true);
    expect(Object.isFrozen(configured.configuration.viewport)).toBe(true);
    expect(harness.canvas).toEqual({ width: 640, height: 360 });
    expect(harness.textures).toHaveLength(1);
    expect(harness.textures[0]?.descriptor).toMatchObject({
      size: { width: 640, height: 360, depthOrArrayLayers: 1 },
      format: STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_FORMAT,
      usage: STUDIO_ENGINE_WEBGPU_PRESENTATION_WORK_SURFACE_USAGE,
    });
    expect(harness.configure).toHaveBeenCalledWith({
      device: harness.device,
      format: "bgra8unorm",
      usage: 0x10,
      alphaMode: "premultiplied",
      colorSpace: "srgb",
    });
    const begun = surface.beginFrame(frameRequest());
    expect(begun.status).toBe("ready");
    if (begun.status !== "ready") return;
    expect(begun.frame.workSurface).toMatchObject({
      kind: "studio-engine-webgpu-shared-linear-work-surface",
      format: "rgba16float",
      colorModel: STUDIO_ENGINE_WEBGPU_PRESENTATION_COLOR_MODEL,
      width: 640,
      height: 360,
      byteLength: 1_843_200,
      workSurfaceEpoch: 1,
    });
    expect(begun.frame.workSurface.texture).toBe(harness.textures[0]);
    expect(Object.isFrozen(begun.frame)).toBe(true);
    expect(Object.isFrozen(begun.frame.workSurface)).toBe(true);
    expect(surface.visibility()).toEqual({
      visible: false,
      reason: "awaiting-present",
    });
  });

  it("publishes visibility only after current-texture submission, error scopes and queue fence", async () => {
    const fence = deferred<void>();
    const harness = fakeGpuHarness(() => fence.promise);
    const surface = runtime(harness);
    const frame = configuredFrame(surface);

    const pending = surface.presentFrame(frame, producerReceipt(frame));

    expect(harness.getCurrentTexture).toHaveBeenCalledTimes(1);
    expect(harness.submit).toHaveBeenCalledTimes(1);
    expect(harness.onSubmittedWorkDone).toHaveBeenCalledTimes(1);
    expect(harness.pushErrorScope.mock.calls.map(([filter]) => filter)).toEqual([
      "internal",
      "out-of-memory",
      "validation",
    ]);
    expect(harness.popErrorScope).toHaveBeenCalledTimes(3);
    expect(harness.passes).toHaveLength(1);
    expect(harness.passes[0]?.setPipeline).toHaveBeenCalledTimes(1);
    expect(harness.passes[0]?.setBindGroup).toHaveBeenCalledWith(
      0,
      expect.anything(),
    );
    expect(harness.passes[0]?.draw).toHaveBeenCalledWith(3, 1, 0, 0);
    expect(harness.passes[0]?.end).toHaveBeenCalledTimes(1);
    expect(surface.visibility()).toEqual({
      visible: false,
      reason: "awaiting-present",
    });
    expect(surface.stats()).toMatchObject({
      presentationInFlight: true,
      presentations: 0,
      lastPresentedRequestSequence: 0,
    });

    fence.resolve();
    const result = await pending;

    expect(result.status).toBe("presented");
    if (result.status !== "presented") return;
    expect(result.receipt).toMatchObject({
      kind: "studio-engine-webgpu-presentation-receipt",
      backend: "webgpu",
      requestSequence: 1,
      sourceFrameFingerprint: "sha256:canonical-frame-1",
      deviceEpoch: 1,
      presentationEpoch: 1,
      resizeEpoch: 1,
      viewportEpoch: 1,
      flipEpoch: 1,
      workSurfaceEpoch: 1,
      width: 640,
      height: 360,
      textureFormat: "rgba16float",
      canvasFormat: "bgra8unorm",
      queueState: "completed",
      presentationState: "presented",
      visible: true,
      complete: true,
    });
    expect(Object.isFrozen(result.receipt)).toBe(true);
    expect(surface.visibility()).toEqual({
      visible: true,
      receipt: result.receipt,
    });
    expect(surface.authorizesVisibility(result.receipt)).toBe(true);
    expect(surface.authorizesVisibility({ ...result.receipt })).toBe(false);
    expect(surface.stats()).toMatchObject({
      presentationInFlight: false,
      presentations: 1,
      lastPresentedRequestSequence: 1,
    });

    const shader = String(harness.shaderDescriptors[0]?.code);
    expect(shader).toContain("textureLoad(linear_surface");
    expect(shader).toContain("linear_to_srgb_channel");
    expect(shader).toContain("pixel.rgb / max(alpha");
    expect(harness.pipelineDescriptors[0]?.fragment?.targets).toEqual([{
      format: "bgra8unorm",
    }]);
  });

  it("uses independent monotonic epochs and reallocates only for physical size changes", async () => {
    const harness = fakeGpuHarness();
    const surface = runtime(harness);
    const initial = surface.configure(layout());
    expect(initial.status).toBe("ready");
    const originalTexture = harness.textures[0];

    const unchanged = surface.configure(layout());
    expect(unchanged.status).toBe("unchanged");
    expect(harness.textures).toHaveLength(1);
    expect(harness.configure).toHaveBeenCalledTimes(1);

    expect(surface.configure(layout({
      viewport: { ...layout().viewport, flipX: false },
    }))).toEqual({ status: "rejected", reason: "epoch-conflict" });
    expect(surface.configure(layout({
      flipEpoch: 2,
      viewport: { ...layout().viewport, flipX: false },
    }))).toEqual({ status: "rejected", reason: "epoch-conflict" });

    const flipped = surface.configure(layout({
      presentationEpoch: 2,
      flipEpoch: 2,
      viewport: { ...layout().viewport, flipX: false, flipY: true },
    }));
    expect(flipped.status).toBe("ready");
    if (flipped.status !== "ready") return;
    expect(flipped.allocation).toBe("reused");
    expect(flipped.configuration.documentToSurface).toEqual({
      m11: 4,
      m12: 0,
      m21: 0,
      m22: -6,
      dx: 20,
      dy: 340,
    });
    expect(harness.textures).toHaveLength(1);
    expect(originalTexture?.destroy).not.toHaveBeenCalled();
    expect(surface.visibility()).toEqual({
      visible: false,
      reason: "awaiting-present",
    });

    expect(surface.configure(layout({
      presentationEpoch: 1,
    }))).toEqual({ status: "rejected", reason: "stale-epoch" });

    const resized = surface.configure(layout({
      presentationEpoch: 3,
      resizeEpoch: 2,
      flipEpoch: 2,
      cssWidth: 400,
      cssHeight: 200,
      dpr: 1.5,
      viewport: { ...layout().viewport, flipX: false, flipY: true },
    }));
    expect(resized.status).toBe("ready");
    if (resized.status !== "ready") return;
    expect(resized.allocation).toBe("created");
    expect(resized.configuration).toMatchObject({
      physicalWidth: 600,
      physicalHeight: 300,
    });
    expect(harness.textures).toHaveLength(2);
    expect(originalTexture?.destroy).toHaveBeenCalledTimes(1);
    expect(harness.configure).toHaveBeenCalledTimes(2);
    expect(surface.stats()).toMatchObject({
      presentationEpoch: 3,
      resizeEpoch: 2,
      viewportEpoch: 1,
      flipEpoch: 2,
      workSurfaceEpoch: 2,
      surfaceTextureAllocations: 2,
    });

    const begun = surface.beginFrame(frameRequest({
      requestSequence: 2,
      presentationEpoch: 3,
      resizeEpoch: 2,
      flipEpoch: 2,
    }));
    expect(begun.status).toBe("ready");
    if (begun.status !== "ready") return;
    const presented = await surface.presentFrame(
      begun.frame,
      producerReceipt(begun.frame),
    );
    expect(presented.status).toBe("presented");
  });

  it("enforces opaque single-writer leases, exact epochs and monotonic requests", () => {
    const harness = fakeGpuHarness();
    const surface = runtime(harness);
    expect(surface.configure(layout()).status).toBe("ready");

    expect(surface.beginFrame(frameRequest({
      deviceEpoch: 2,
    }))).toEqual({
      status: "rejected",
      reason: "device-epoch-mismatch",
    });
    expect(surface.beginFrame(frameRequest({
      viewportEpoch: 2,
    }))).toEqual({
      status: "rejected",
      reason: "epoch-mismatch",
    });
    expect(surface.beginFrame(frameRequest({
      sourceFrameFingerprint: " bad ",
    }))).toEqual({
      status: "rejected",
      reason: "invalid-request",
    });

    const begun = surface.beginFrame(frameRequest());
    expect(begun.status).toBe("ready");
    if (begun.status !== "ready") return;
    expect(surface.beginFrame(frameRequest({
      requestSequence: 2,
    }))).toEqual({
      status: "rejected",
      reason: "frame-in-flight",
    });
    expect(surface.configure(layout({
      presentationEpoch: 2,
    }))).toEqual({
      status: "rejected",
      reason: "gpu-backpressure",
    });
    const forged = { ...begun.frame };
    expect(surface.abortFrame(forged)).toEqual({
      status: "rejected",
      reason: "invalid-frame",
    });
    expect(surface.abortFrame(begun.frame)).toEqual({ status: "aborted" });
    expect(surface.abortFrame(begun.frame)).toEqual({
      status: "rejected",
      reason: "invalid-frame",
    });
    expect(surface.beginFrame(frameRequest())).toEqual({
      status: "rejected",
      reason: "stale-request-sequence",
    });
    expect(surface.beginFrame(frameRequest({
      requestSequence: 2,
    })).status).toBe("ready");
  });

  it("requires initialized content, rejects cloned capabilities and chains append lineage", async () => {
    const harness = fakeGpuHarness();
    const surface = runtime(harness);
    expect(surface.configure(layout()).status).toBe("ready");
    const first = surface.beginFrame(frameRequest());
    expect(first.status).toBe("ready");
    if (first.status !== "ready") return;

    expect(acquireStudioEngineWebGpuPresentationProducerWrite(
      { ...first.frame },
      {
        mode: "rebuild",
        sourceFrameFingerprint: first.frame.sourceFrameFingerprint,
      },
    )).toEqual({ status: "rejected", reason: "invalid-frame" });
    expect(acquireStudioEngineWebGpuPresentationProducerWrite(
      first.frame,
      {
        mode: "append",
        sourceFrameFingerprint: first.frame.sourceFrameFingerprint,
      },
    )).toEqual({ status: "rejected", reason: "content-uninitialized" });
    expect(surface.abortFrame(first.frame)).toEqual({ status: "aborted" });

    const rebuilt = surface.beginFrame(frameRequest({
      requestSequence: 2,
      sourceFrameFingerprint: "sha256:canonical-rebuild",
    }));
    expect(rebuilt.status).toBe("ready");
    if (rebuilt.status !== "ready") return;
    const rebuildClaim = acquireStudioEngineWebGpuPresentationProducerWrite(
      rebuilt.frame,
      {
        mode: "rebuild",
        sourceFrameFingerprint: rebuilt.frame.sourceFrameFingerprint,
      },
    );
    expect(rebuildClaim.status).toBe("ready");
    if (rebuildClaim.status !== "ready") return;
    const rebuildSettlement =
      settleStudioEngineWebGpuPresentationProducerWrite(
        rebuildClaim.claim,
        "completed",
      );
    expect(rebuildSettlement.status).toBe("completed");
    if (rebuildSettlement.status !== "completed") return;
    expect(await surface.presentFrame(
      rebuilt.frame,
      receiptFromClaim(rebuilt.frame, rebuildClaim.claim),
    )).toMatchObject({ status: "presented" });

    const appended = surface.beginFrame(frameRequest({
      requestSequence: 3,
      sourceFrameFingerprint: "sha256:canonical-append",
    }));
    expect(appended.status).toBe("ready");
    if (appended.status !== "ready") return;
    const appendClaim = acquireStudioEngineWebGpuPresentationProducerWrite(
      appended.frame,
      {
        mode: "append",
        sourceFrameFingerprint: appended.frame.sourceFrameFingerprint,
      },
    );
    expect(appendClaim.status).toBe("ready");
    if (appendClaim.status !== "ready") return;
    expect(appendClaim.claim.baseContentGeneration).toBe(
      rebuildClaim.claim.contentGeneration,
    );
    expect(appendClaim.claim.baseContentFingerprint).toBe(
      rebuildClaim.claim.contentFingerprint,
    );
    expect(appendClaim.claim.contentGeneration).toBeGreaterThan(
      rebuildClaim.claim.contentGeneration,
    );
    expect(appendClaim.claim.contentFingerprint).not.toBe(
      rebuildClaim.claim.contentFingerprint,
    );
    expect(settleStudioEngineWebGpuPresentationProducerWrite(
      appendClaim.claim,
      "completed",
    ).status).toBe("completed");
    const appendPresentation = await surface.presentFrame(
      appended.frame,
      receiptFromClaim(appended.frame, appendClaim.claim),
    );
    expect(appendPresentation).toMatchObject({
      status: "presented",
      receipt: {
        mode: "append",
        baseContentFingerprint: rebuildClaim.claim.contentFingerprint,
        contentFingerprint: appendClaim.claim.contentFingerprint,
      },
    });
    expect(surface.stats()).toMatchObject({
      contentInitialized: true,
      contentGeneration: appendClaim.claim.contentGeneration,
      contentFingerprint: appendClaim.claim.contentFingerprint,
    });
  });

  it("revokes an in-flight producer claim on abort and blocks layout work until settlement", async () => {
    const harness = fakeGpuHarness();
    const surface = runtime(harness);
    const rebuilt = configuredFrame(surface);
    const rebuildPresentation = await surface.presentFrame(
      rebuilt,
      producerReceipt(rebuilt),
    );
    expect(rebuildPresentation.status).toBe("presented");
    const append = surface.beginFrame(frameRequest({
      requestSequence: 2,
      sourceFrameFingerprint: "sha256:abort-append",
    }));
    expect(append.status).toBe("ready");
    if (append.status !== "ready") return;
    const claim = acquireStudioEngineWebGpuPresentationProducerWrite(
      append.frame,
      {
        mode: "append",
        sourceFrameFingerprint: append.frame.sourceFrameFingerprint,
      },
    );
    expect(claim.status).toBe("ready");
    if (claim.status !== "ready") return;

    expect(surface.abortFrame(append.frame)).toEqual({ status: "aborted" });
    expect(surface.configure(layout({
      presentationEpoch: 2,
    }))).toEqual({ status: "rejected", reason: "gpu-backpressure" });
    expect(settleStudioEngineWebGpuPresentationProducerWrite(
      claim.claim,
      "completed",
    )).toEqual({ status: "rejected", reason: "claim-revoked" });
    expect(surface.stats()).toMatchObject({
      producerWriteInFlight: false,
      contentInitialized: false,
      contentFingerprint: null,
    });
    expect(surface.configure(layout({
      presentationEpoch: 2,
    })).status).toBe("ready");
  });

  it("invalidates append authority after a producer error and a layout-only transition", async () => {
    const harness = fakeGpuHarness();
    const surface = runtime(harness);
    const rebuilt = configuredFrame(surface);
    expect((await surface.presentFrame(
      rebuilt,
      producerReceipt(rebuilt),
    )).status).toBe("presented");

    const failedFrame = surface.beginFrame(frameRequest({
      requestSequence: 2,
      sourceFrameFingerprint: "sha256:failed-append",
    }));
    expect(failedFrame.status).toBe("ready");
    if (failedFrame.status !== "ready") return;
    const failedClaim = acquireStudioEngineWebGpuPresentationProducerWrite(
      failedFrame.frame,
      {
        mode: "append",
        sourceFrameFingerprint: failedFrame.frame.sourceFrameFingerprint,
      },
    );
    expect(failedClaim.status).toBe("ready");
    if (failedClaim.status !== "ready") return;
    expect(settleStudioEngineWebGpuPresentationProducerWrite(
      failedClaim.claim,
      "failed",
    )).toMatchObject({
      status: "invalidated",
      reason: "producer-failed",
      content: { initialized: false, fingerprint: null },
    });
    expect(surface.abortFrame(failedFrame.frame)).toEqual({ status: "aborted" });

    const recovered = surface.beginFrame(frameRequest({
      requestSequence: 3,
      sourceFrameFingerprint: "sha256:recovery-rebuild",
    }));
    expect(recovered.status).toBe("ready");
    if (recovered.status !== "ready") return;
    expect(producerReceipt(recovered.frame).mode).toBe("rebuild");
    expect((await surface.presentFrame(
      recovered.frame,
      producerReceipt(recovered.frame),
    )).status).toBe("presented");
    const generationBeforeLayout = surface.stats().contentGeneration;

    expect(surface.configure(layout({
      presentationEpoch: 2,
      viewportEpoch: 2,
      viewport: {
        ...layout().viewport,
        offsetX: 12,
      },
    })).status).toBe("ready");
    expect(surface.stats()).toMatchObject({
      contentInitialized: false,
      contentFingerprint: null,
      contentGeneration: generationBeforeLayout + 1,
      workSurfaceEpoch: 1,
    });
    const staleAppend = surface.beginFrame(frameRequest({
      requestSequence: 4,
      presentationEpoch: 2,
      viewportEpoch: 2,
      sourceFrameFingerprint: "sha256:layout-stale-append",
    }));
    expect(staleAppend.status).toBe("ready");
    if (staleAppend.status !== "ready") return;
    expect(acquireStudioEngineWebGpuPresentationProducerWrite(
      staleAppend.frame,
      {
        mode: "append",
        sourceFrameFingerprint: staleAppend.frame.sourceFrameFingerprint,
      },
    )).toEqual({ status: "rejected", reason: "content-uninitialized" });
  });

  it("never presents a lease without an exact completed producer receipt", async () => {
    const harness = fakeGpuHarness();
    const surface = runtime(harness);
    const frame = configuredFrame(surface);

    expect(await surface.presentFrame(frame, {
      backend: "webgpu",
      textureFormat: STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_FORMAT,
      colorModel: STUDIO_ENGINE_WEBGPU_PRESENTATION_COLOR_MODEL,
      requestSequence: frame.requestSequence,
      deviceEpoch: frame.deviceEpoch,
      renderTarget: "presentation",
      sourceFrameFingerprint: frame.sourceFrameFingerprint,
      workSurfaceEpoch: frame.workSurface.workSurfaceEpoch,
      mode: "rebuild",
      baseContentGeneration: 0,
      baseContentFingerprint: null,
      contentGeneration: 1,
      contentFingerprint: `sha256:${"a".repeat(64)}`,
      queueState: "completed",
      complete: true,
    })).toEqual({
      status: "rejected",
      reason: "producer-receipt-invalid",
    });
    const mismatches: Partial<StudioEngineWebGpuPresentationProducerReceipt>[] = [
      { requestSequence: frame.requestSequence + 1 },
      { deviceEpoch: frame.deviceEpoch + 1 },
      { renderTarget: "private" },
      { sourceFrameFingerprint: `${frame.sourceFrameFingerprint}:wrong` },
      { workSurfaceEpoch: frame.workSurface.workSurfaceEpoch + 1 },
      { contentFingerprint: `sha256:${"f".repeat(64)}` },
      { queueState: "pending" as "completed" },
      { complete: false as true },
    ];
    for (const mismatch of mismatches) {
      expect(await surface.presentFrame(
        frame,
        producerReceipt(frame, mismatch),
      )).toEqual({
        status: "rejected",
        reason: "producer-receipt-invalid",
      });
    }
    expect(harness.getCurrentTexture).not.toHaveBeenCalled();
    expect(surface.visibility()).toEqual({
      visible: false,
      reason: "awaiting-present",
    });

    expect(await surface.presentFrame(
      frame,
      producerReceipt(frame),
    )).toMatchObject({ status: "presented" });
  });

  it("keeps the old receipt before submission but revokes it until the replacement fence completes", async () => {
    const replacementFence = deferred<void>();
    let submission = 0;
    const harness = fakeGpuHarness(() => {
      submission += 1;
      return submission === 1 ? Promise.resolve() : replacementFence.promise;
    });
    const surface = runtime(harness);
    const firstFrame = configuredFrame(surface);
    const first = await surface.presentFrame(
      firstFrame,
      producerReceipt(firstFrame),
    );
    expect(first.status).toBe("presented");
    if (first.status !== "presented") return;

    const second = surface.beginFrame(frameRequest({
      requestSequence: 2,
      sourceFrameFingerprint: "sha256:canonical-frame-2",
    }));
    expect(second.status).toBe("ready");
    expect(surface.visibility()).toEqual({
      visible: true,
      receipt: first.receipt,
    });
    expect(surface.authorizesVisibility(first.receipt)).toBe(true);
    if (second.status !== "ready") return;

    const pending = surface.presentFrame(
      second.frame,
      producerReceipt(second.frame),
    );
    expect(surface.visibility()).toEqual({
      visible: false,
      reason: "awaiting-present",
    });
    expect(surface.authorizesVisibility(first.receipt)).toBe(false);
    replacementFence.resolve();
    const secondResult = await pending;
    expect(secondResult.status).toBe("presented");
    if (secondResult.status !== "presented") return;
    expect(surface.visibility()).toEqual({
      visible: true,
      receipt: secondResult.receipt,
    });

    const reconfigured = surface.configure(layout({
      presentationEpoch: 2,
      viewportEpoch: 2,
      viewport: {
        ...layout().viewport,
        offsetX: 12,
      },
    }));
    expect(reconfigured.status).toBe("ready");
    expect(surface.visibility()).toEqual({
      visible: false,
      reason: "awaiting-present",
    });
    expect(surface.authorizesVisibility(secondResult.receipt)).toBe(false);
  });

  it("fails closed on scoped GPU errors and never issues a visible receipt", async () => {
    const harness = fakeGpuHarness();
    harness.scopeErrors.push({
      message: "validation failed",
    } as GPUError);
    const surface = runtime(harness);
    const frame = configuredFrame(surface);

    const result = await surface.presentFrame(frame, producerReceipt(frame));

    expect(result).toEqual({ status: "failed", reason: "gpu-error" });
    expect(surface.visibility()).toEqual({ visible: false, reason: "failed" });
    expect(surface.stats()).toMatchObject({
      status: "failed",
      configured: false,
      presentations: 0,
    });
    expect(harness.unconfigure).toHaveBeenCalledTimes(1);
    expect(harness.textures[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(surface.configure(layout())).toEqual({
      status: "rejected",
      reason: "runtime-failed",
    });
  });

  it("fails closed when current presentation texture acquisition throws", async () => {
    const harness = fakeGpuHarness();
    harness.getCurrentTexture.mockImplementationOnce(() => {
      throw new Error("detached");
    });
    const surface = runtime(harness);
    const frame = configuredFrame(surface);

    expect(await surface.presentFrame(frame, producerReceipt(frame))).toEqual({
      status: "failed",
      reason: "presentation-failed",
    });
    expect(surface.visibility()).toEqual({ visible: false, reason: "failed" });
    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.popErrorScope).toHaveBeenCalledTimes(3);
    expect(harness.unconfigure).toHaveBeenCalledTimes(1);
  });

  it("retires an in-flight generation on device loss without authorizing its frame", async () => {
    const fence = deferred<void>();
    const harness = fakeGpuHarness(() => fence.promise);
    const onDeviceLost = vi.fn();
    const surface = runtime(harness, { onDeviceLost });
    const frame = configuredFrame(surface);
    const pending = surface.presentFrame(frame, producerReceipt(frame));
    const lostInfo = {
      reason: "unknown",
      message: "adapter reset",
    } as GPUDeviceLostInfo;

    harness.lost.resolve(lostInfo);
    await Promise.resolve();
    fence.resolve();

    expect(await pending).toEqual({
      status: "rejected",
      reason: "device-lost",
    });
    expect(surface.visibility()).toEqual({
      visible: false,
      reason: "device-lost",
    });
    expect(surface.stats()).toMatchObject({
      status: "device-lost",
      configured: false,
      deviceEpoch: 2,
      presentations: 0,
    });
    expect(onDeviceLost).toHaveBeenCalledWith(lostInfo);
    expect(harness.unconfigure).toHaveBeenCalledTimes(1);
    expect(harness.textures[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(surface.beginFrame(frameRequest())).toEqual({
      status: "rejected",
      reason: "device-lost",
    });
  });

  it("owns context teardown and optionally owns device teardown", () => {
    const harness = fakeGpuHarness();
    const surface = runtime(harness, { ownsDevice: true });
    expect(surface.configure(layout()).status).toBe("ready");

    surface.dispose();
    surface.dispose();

    expect(surface.visibility()).toEqual({
      visible: false,
      reason: "disposed",
    });
    expect(surface.stats().status).toBe("disposed");
    expect(harness.unconfigure).toHaveBeenCalledTimes(1);
    expect(harness.textures[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(harness.destroyDevice).toHaveBeenCalledTimes(1);
    expect(surface.configure(layout())).toEqual({
      status: "rejected",
      reason: "disposed",
    });
    expect(surface.beginFrame(frameRequest())).toEqual({
      status: "rejected",
      reason: "disposed",
    });
  });

  it("rejects malformed creation and over-budget layouts without partial allocation", () => {
    const harness = fakeGpuHarness();
    expect(createStudioEngineWebGpuPresentationSurface({
      device: harness.device,
      context: harness.context,
      canvas: harness.canvas,
      canvasFormat: "bgra8unorm",
      maximumSurfacePixels: 0,
    })).toEqual({ status: "rejected", reason: "invalid-options" });
    expect(createStudioEngineWebGpuPresentationSurface({
      device: harness.device,
      context: harness.context,
      canvas: harness.canvas,
      canvasFormat: "bgra8unorm-srgb" as "bgra8unorm",
    })).toEqual({ status: "rejected", reason: "invalid-options" });

    const surface = runtime(harness, { maximumSurfacePixels: 1_000 });
    expect(surface.configure(layout())).toEqual({
      status: "rejected",
      reason: "surface-limit",
    });
    expect(harness.textures).toHaveLength(0);
    expect(harness.configure).not.toHaveBeenCalled();
    expect(surface.stats()).toMatchObject({
      status: "ready",
      configured: false,
      surfaceTextureAllocations: 0,
    });
    expect(surface.configure(layout({
      cssWidth: Number.NaN,
    }))).toEqual({
      status: "rejected",
      reason: "invalid-layout",
    });
  });

  it("rolls back backing dimensions and retires the runtime when context configuration fails", () => {
    const harness = fakeGpuHarness();
    harness.canvas.width = 7;
    harness.canvas.height = 9;
    harness.configure.mockImplementationOnce(() => {
      throw new Error("configuration rejected");
    });
    const surface = runtime(harness);

    expect(surface.configure(layout())).toEqual({
      status: "failed",
      reason: "configuration-failed",
    });
    expect(harness.canvas).toEqual({ width: 7, height: 9 });
    expect(harness.textures).toHaveLength(1);
    expect(harness.textures[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(harness.unconfigure).toHaveBeenCalledTimes(1);
    expect(surface.visibility()).toEqual({ visible: false, reason: "failed" });
  });

  it("fails closed when another owner mutates the backing size between acquire and present", async () => {
    const harness = fakeGpuHarness();
    const surface = runtime(harness);
    const frame = configuredFrame(surface);
    harness.canvas.width = 639;

    expect(await surface.presentFrame(frame, producerReceipt(frame))).toEqual({
      status: "failed",
      reason: "presentation-failed",
    });
    expect(surface.visibility()).toEqual({ visible: false, reason: "failed" });
    expect(harness.getCurrentTexture).not.toHaveBeenCalled();
    expect(harness.textures[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(harness.unconfigure).toHaveBeenCalledTimes(1);
  });

  it("honors the device texture-dimension limit before creating GPU resources", () => {
    const harness = fakeGpuHarness(async () => undefined, 512);
    const surface = runtime(harness);

    expect(surface.configure(layout())).toEqual({
      status: "rejected",
      reason: "surface-limit",
    });
    expect(harness.textures).toHaveLength(0);
    expect(harness.configure).not.toHaveBeenCalled();
  });
});
