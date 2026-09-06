import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_CAPABILITIES,
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS,
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION,
  createStudioProceduralArtisticBrushProvider,
  estimateStudioProceduralArtisticBrushRasterMemory,
  type StudioProceduralArtisticBrushAdapter,
  type StudioProceduralArtisticBrushAdapterInput,
  type StudioProceduralArtisticBrushAdapterOutput,
  type StudioProceduralArtisticBrushCapability,
  type StudioProceduralArtisticBrushRequest,
} from "./studio-procedural-artistic-brush-provider";

const ALL_CAPABILITIES =
  [...STUDIO_PROCEDURAL_ARTISTIC_BRUSH_CAPABILITIES];

function techniqueCapability(
  technique: StudioProceduralArtisticBrushRequest["plan"]["technique"],
): StudioProceduralArtisticBrushCapability {
  switch (technique) {
    case "flow-field":
      return "procedural:flow-field";
    case "hatch":
      return "procedural:hatch";
    case "mass":
      return "procedural:mass";
    case "watercolor-fill":
      return "procedural:watercolor-fill";
    case "flat-wash":
      return "procedural:flat-wash";
    case "image-tip":
      return "tip:image";
    case "custom-tip":
      return "tip:custom";
  }
}

function request(
  overrides: Partial<StudioProceduralArtisticBrushRequest> = {},
): StudioProceduralArtisticBrushRequest {
  return {
    kind: "studio-procedural-artistic-brush/request",
    version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION,
    requestSequence: 1,
    engineEpoch: 7,
    strokeId: "stroke-artistic-1",
    stage: "settled",
    seed: 0x1234_abcd,
    width: 2,
    height: 2,
    pixelRatio: 2,
    plan: {
      technique: "flow-field",
      presetId: "flow-watercolor",
      samples: [
        {
          x: 1,
          y: 2,
          pressure: 0.4,
          tiltX: 10,
          tiltY: -4,
          timeMilliseconds: 10,
        },
        {
          x: 3,
          y: 5,
          pressure: 0.8,
          tiltX: 12,
          tiltY: -2,
          timeMilliseconds: 18,
        },
      ],
      parameters: {
        bleed: 0.6,
        field: "curl",
        textured: true,
      },
    },
    ...overrides,
  };
}

function watercolorFillRequest(
  overrides: Partial<StudioProceduralArtisticBrushRequest> = {},
): StudioProceduralArtisticBrushRequest {
  return request({
    plan: {
      technique: "watercolor-fill",
      presetId: "studio-procedural-watercolor-fill-v1",
      samples: request().plan.samples,
      parameters: {
        angle: 0.6109,
        color: "#336699",
        density: 0.64,
        opacity: 0.72,
        strength: 0.78,
      },
    },
    ...overrides,
  });
}

function adapter(
  capabilities: readonly StudioProceduralArtisticBrushCapability[] =
    ALL_CAPABILITIES,
): StudioProceduralArtisticBrushAdapter {
  return {
    descriptor: {
      id: "p5-brush-standalone-worker",
      version: "2.2.1-adapter.3",
      compatibility: "p5.brush/standalone",
      executionStage: "settled-only",
      executionLocality: "dedicated-worker",
      surface: "offscreen-canvas-webgl2",
      deterministicSeed: true,
      mainSceneAuthority: false,
      capabilities,
    },
    renderSettled: vi.fn((
      input: StudioProceduralArtisticBrushAdapterInput,
    ): StudioProceduralArtisticBrushAdapterOutput => {
      const pixels = new Uint8Array(input.width * input.height * 4);
      pixels.fill(input.seed & 0xff);
      return {
        kind: "studio-procedural-artistic-brush/adapter-output",
        width: input.width,
        height: input.height,
        seed: input.seed,
        backend: "webgl2",
        executionStage: "settled",
        complete: true,
        pixels,
        capabilitiesUsed: [techniqueCapability(input.plan.technique)],
      };
    }),
  };
}

function surfaceFactory() {
  const dispose = vi.fn();
  const createSurface = vi.fn((input: Readonly<{
    width: number;
    height: number;
  }>) => ({
    kind: "offscreen-canvas-webgl2" as const,
    executionLocality: "dedicated-worker" as const,
    transferredFromMainThread: false as const,
    width: input.width,
    height: input.height,
    canvas: {},
    context: {},
    dispose,
  }));
  return { createSurface, dispose };
}

describe("Studio procedural artistic brush provider boundary", () => {
  it("declares the isolated p5.brush-compatible capability envelope", () => {
    expect(ALL_CAPABILITIES).toEqual([
      "procedural:flow-field",
      "procedural:hatch",
      "procedural:mass",
      "procedural:watercolor-fill",
      "procedural:flat-wash",
      "tip:image",
      "tip:custom",
      "execution:settled-only",
      "surface:offscreen-canvas",
      "gpu:webgl2",
      "seed:deterministic",
      "authority:none",
    ]);
  });

  it("loads lazily, renders deterministically, copies pixels and owns no authority", async () => {
    const runtime = adapter();
    const loadAdapter = vi.fn(() => runtime);
    const { createSurface, dispose } = surfaceFactory();
    const creation = createStudioProceduralArtisticBrushProvider({
      engineEpoch: 7,
      executionLocality: "dedicated-worker",
      loadAdapter,
      createSurface,
    });
    expect(creation.status).toBe("ready");
    if (creation.status !== "ready") return;

    expect(loadAdapter).not.toHaveBeenCalled();
    expect(creation.provider.snapshot()).toMatchObject({
      phase: "cold",
      loaderCalls: 0,
      adapterLoaded: false,
      authority: "none",
    });

    const first = await creation.provider.render(request());
    const second = await creation.provider.render(request({
      requestSequence: 2,
    }));
    expect(first.status).toBe("completed");
    expect(second.status).toBe("completed");
    expect(loadAdapter).toHaveBeenCalledTimes(1);
    expect(createSurface).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(2);
    if (first.status !== "completed" || second.status !== "completed") return;
    expect(first.consumed).toBe(false);
    expect(first.artifact.receipt).toMatchObject({
      seed: 0x1234_abcd,
      technique: "flow-field",
      execution: {
        stage: "settled",
        locality: "dedicated-worker",
        surface: "offscreen-canvas-webgl2",
        backend: "webgl2",
        mainThreadFallback: false,
      },
      authority: {
        mainScene: false,
        document: false,
        history: false,
        persistence: false,
        output: "settled-raster-suggestion",
      },
    });
    expect(first.artifact.receipt.inputFingerprint).toBe(
      second.artifact.receipt.inputFingerprint,
    );
    expect(first.artifact.receipt.pixelHash).toBe(
      second.artifact.receipt.pixelHash,
    );
    expect(first.artifact.receipt.replayFingerprint).toBe(
      second.artifact.receipt.replayFingerprint,
    );
    expect(first.artifact.pixels).not.toBe(
      (runtime.renderSettled as ReturnType<typeof vi.fn>).mock.results[0]
        ?.value.pixels,
    );
  });

  it("accepts and defensively owns the clamped RGBA form promised by the adapter contract", async () => {
    const runtime = adapter();
    const adapterPixels = new Uint8ClampedArray(2 * 2 * 4);
    adapterPixels.fill(177);
    runtime.renderSettled = vi.fn((
      input: StudioProceduralArtisticBrushAdapterInput,
    ): StudioProceduralArtisticBrushAdapterOutput => ({
      kind: "studio-procedural-artistic-brush/adapter-output",
      width: input.width,
      height: input.height,
      seed: input.seed,
      backend: "webgl2",
      executionStage: "settled",
      complete: true,
      pixels: adapterPixels,
      capabilitiesUsed: ["procedural:flow-field"],
    }));
    const { createSurface } = surfaceFactory();
    const creation = createStudioProceduralArtisticBrushProvider({
      engineEpoch: 7,
      executionLocality: "dedicated-worker",
      loadAdapter: () => runtime,
      createSurface,
    });
    if (creation.status !== "ready") throw new Error("provider creation failed");

    const result = await creation.provider.render(request());

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.artifact.pixels).toEqual(adapterPixels);
    expect(result.artifact.pixels).not.toBe(adapterPixels);
    adapterPixels.fill(0);
    expect(result.artifact.pixels[0]).toBe(177);
  });

  it("rejects live execution before loading any runtime", async () => {
    const loadAdapter = vi.fn(() => adapter());
    const { createSurface } = surfaceFactory();
    const creation = createStudioProceduralArtisticBrushProvider({
      engineEpoch: 7,
      executionLocality: "dedicated-worker",
      loadAdapter,
      createSurface,
    });
    if (creation.status !== "ready") throw new Error("provider creation failed");

    await expect(
      creation.provider.render(request({ stage: "live" })),
    ).resolves.toMatchObject({
      status: "rejected",
      consumed: false,
      reason: "live-stage-forbidden",
    });
    expect(loadAdapter).not.toHaveBeenCalled();
    expect(createSurface).not.toHaveBeenCalled();
  });

  it("fails a large raster at the peak-resident boundary before allocation", async () => {
    expect(STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS).toMatchObject({
      residentRgbaFrames: 3,
      compositedFillResidentRgbaFrames: 8,
      rgbaBytesPerPixel: 4,
      maxResidentBytes: 384 * 1024 * 1024,
    });
    expect(
      estimateStudioProceduralArtisticBrushRasterMemory(8_192, 4_096),
    ).toEqual({
      pixelCount: 33_554_432,
      outputBytes: 134_217_728,
      gpuDrawingBufferBytes: 134_217_728,
      adapterReadbackBytes: 134_217_728,
      artifactOwnershipBytes: 134_217_728,
      peakResidentBytes: 402_653_184,
    });
    expect(
      estimateStudioProceduralArtisticBrushRasterMemory(8_192, 4_097),
    ).toBeNull();
    expect(
      estimateStudioProceduralArtisticBrushRasterMemory(
        4_096,
        3_072,
        "watercolor-fill",
      ),
    ).toEqual({
      pixelCount: 12_582_912,
      outputBytes: 50_331_648,
      gpuDrawingBufferBytes: 50_331_648,
      adapterReadbackBytes: 50_331_648,
      artifactOwnershipBytes: 50_331_648,
      peakResidentBytes: 402_653_184,
    });
    expect(
      estimateStudioProceduralArtisticBrushRasterMemory(
        4_096,
        3_073,
        "watercolor-fill",
      ),
    ).toBeNull();
    expect(
      estimateStudioProceduralArtisticBrushRasterMemory(
        4_096,
        3_073,
        "flat-wash",
      ),
    ).toBeNull();

    const loadAdapter = vi.fn(() => adapter());
    const { createSurface } = surfaceFactory();
    const creation = createStudioProceduralArtisticBrushProvider({
      engineEpoch: 7,
      executionLocality: "dedicated-worker",
      loadAdapter,
      createSurface,
    });
    if (creation.status !== "ready") throw new Error("provider creation failed");

    await expect(creation.provider.render(request({
      width: 8_192,
      height: 4_097,
    }))).resolves.toMatchObject({
      status: "rejected",
      consumed: false,
      reason: "invalid-request",
    });
    expect(loadAdapter).not.toHaveBeenCalled();
    expect(createSurface).not.toHaveBeenCalled();
  });

  it("admits composited fills only within the eight-frame budget", async () => {
    const loadAcceptedAdapter = vi.fn(() => null);
    const accepted = createStudioProceduralArtisticBrushProvider({
      engineEpoch: 7,
      executionLocality: "dedicated-worker",
      loadAdapter: loadAcceptedAdapter,
      createSurface: surfaceFactory().createSurface,
    });
    if (accepted.status !== "ready") {
      throw new Error("provider creation failed");
    }
    await expect(accepted.provider.render(watercolorFillRequest({
      width: 4_096,
      height: 3_072,
    }))).resolves.toMatchObject({
      status: "rejected",
      reason: "runtime-unavailable",
    });
    expect(loadAcceptedAdapter).toHaveBeenCalledOnce();

    const loadRejectedAdapter = vi.fn(() => adapter());
    const rejected = createStudioProceduralArtisticBrushProvider({
      engineEpoch: 7,
      executionLocality: "dedicated-worker",
      loadAdapter: loadRejectedAdapter,
      createSurface: surfaceFactory().createSurface,
    });
    if (rejected.status !== "ready") {
      throw new Error("provider creation failed");
    }
    await expect(rejected.provider.render(watercolorFillRequest({
      width: 4_096,
      height: 3_073,
    }))).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid-request",
    });
    expect(loadRejectedAdapter).not.toHaveBeenCalled();
  });

  it("requires exact bounded watercolor-fill and flat-wash plans", async () => {
    const loadAdapter = vi.fn(() => adapter());
    const creation = createStudioProceduralArtisticBrushProvider({
      engineEpoch: 7,
      executionLocality: "dedicated-worker",
      loadAdapter,
      createSurface: surfaceFactory().createSurface,
    });
    if (creation.status !== "ready") {
      throw new Error("provider creation failed");
    }

    const validWatercolor = await creation.provider.render(
      watercolorFillRequest(),
    );
    expect(validWatercolor).toMatchObject({
      status: "completed",
      artifact: {
        receipt: {
          technique: "watercolor-fill",
          presetId: "studio-procedural-watercolor-fill-v1",
          adapter: { version: "2.2.1-adapter.3" },
          capabilitiesUsed: ["procedural:watercolor-fill"],
        },
      },
    });
    const validFlatWash = await creation.provider.render(request({
      requestSequence: 2,
      plan: {
        technique: "flat-wash",
        presetId: "studio-procedural-flat-wash-v1",
        samples: request().plan.samples,
        parameters: {
          color: "#336699",
          opacity: 0.78,
        },
      },
    }));
    expect(validFlatWash).toMatchObject({
      status: "completed",
      artifact: {
        receipt: {
          technique: "flat-wash",
          presetId: "studio-procedural-flat-wash-v1",
          capabilitiesUsed: ["procedural:flat-wash"],
        },
      },
    });

    for (const plan of [
      {
        ...watercolorFillRequest().plan,
        parameters: {
          ...watercolorFillRequest().plan.parameters,
          extra: true,
        },
      },
      {
        ...watercolorFillRequest().plan,
        parameters: {
          ...watercolorFillRequest().plan.parameters,
          density: 1.01,
        },
      },
      {
        ...watercolorFillRequest().plan,
        presetId: "wrong-watercolor-fill",
      },
      {
        technique: "flat-wash" as const,
        presetId: "studio-procedural-flat-wash-v1",
        samples: request().plan.samples,
        parameters: {
          color: "#336699",
          opacity: 0,
        },
      },
    ]) {
      await expect(creation.provider.render(request({
        requestSequence: 3,
        plan,
      }))).resolves.toMatchObject({
        status: "rejected",
        reason: "invalid-request",
      });
    }
    expect(loadAdapter).toHaveBeenCalledOnce();
  });

  it("fails closed when the dynamic runtime is missing", async () => {
    const loadAdapter = vi.fn(() => null);
    const { createSurface } = surfaceFactory();
    const creation = createStudioProceduralArtisticBrushProvider({
      engineEpoch: 7,
      executionLocality: "dedicated-worker",
      loadAdapter,
      createSurface,
    });
    if (creation.status !== "ready") throw new Error("provider creation failed");

    await expect(creation.provider.render(request())).resolves.toMatchObject({
      status: "rejected",
      consumed: false,
      reason: "runtime-unavailable",
    });
    expect(createSurface).not.toHaveBeenCalled();
    expect(creation.provider.snapshot()).toMatchObject({
      adapterLoaded: false,
      loaderCalls: 1,
      completed: 0,
      rejected: 1,
    });
  });

  it("fails closed when capability or Offscreen WebGL2 is unavailable", async () => {
    const restricted = adapter([
      "procedural:hatch",
      "execution:settled-only",
      "surface:offscreen-canvas",
      "gpu:webgl2",
      "seed:deterministic",
      "authority:none",
    ]);
    const unavailableSurface = vi.fn(() => null);
    const unsupported = createStudioProceduralArtisticBrushProvider({
      engineEpoch: 7,
      executionLocality: "dedicated-worker",
      loadAdapter: () => restricted,
      createSurface: unavailableSurface,
    });
    if (unsupported.status !== "ready") {
      throw new Error("provider creation failed");
    }
    await expect(unsupported.provider.render(request())).resolves.toMatchObject({
      status: "rejected",
      reason: "unsupported-capability",
    });
    expect(unavailableSurface).not.toHaveBeenCalled();

    const noSurface = createStudioProceduralArtisticBrushProvider({
      engineEpoch: 7,
      executionLocality: "dedicated-worker",
      loadAdapter: () => adapter(),
      createSurface: unavailableSurface,
    });
    if (noSurface.status !== "ready") throw new Error("provider creation failed");
    await expect(noSurface.provider.render(request())).resolves.toMatchObject({
      status: "rejected",
      reason: "surface-unavailable",
    });
  });

  it("requires matching bounded image/custom tip payloads", async () => {
    const loadAdapter = vi.fn(() => adapter());
    const { createSurface } = surfaceFactory();
    const creation = createStudioProceduralArtisticBrushProvider({
      engineEpoch: 7,
      executionLocality: "dedicated-worker",
      loadAdapter,
      createSurface,
    });
    if (creation.status !== "ready") throw new Error("provider creation failed");

    await expect(creation.provider.render(request({
      plan: {
        ...request().plan,
        technique: "image-tip",
      },
    }))).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid-request",
    });
    expect(loadAdapter).not.toHaveBeenCalled();
  });

  it("rejects invalid adapter raster output without a CPU or main-thread fallback", async () => {
    const runtime = adapter();
    runtime.renderSettled = vi.fn((
      input: StudioProceduralArtisticBrushAdapterInput,
    ): StudioProceduralArtisticBrushAdapterOutput => ({
      kind: "studio-procedural-artistic-brush/adapter-output",
      width: input.width,
      height: input.height,
      seed: input.seed,
      backend: "webgl2",
      executionStage: "settled",
      complete: true,
      pixels: new Uint8Array(3),
      capabilitiesUsed: ["procedural:flow-field"],
    }));
    const { createSurface, dispose } = surfaceFactory();
    const creation = createStudioProceduralArtisticBrushProvider({
      engineEpoch: 7,
      executionLocality: "dedicated-worker",
      loadAdapter: () => runtime,
      createSurface,
    });
    if (creation.status !== "ready") throw new Error("provider creation failed");

    await expect(creation.provider.render(request())).resolves.toMatchObject({
      status: "rejected",
      consumed: false,
      reason: "invalid-adapter-output",
    });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("aborts active work on epoch advance and disposes the adapter idempotently", async () => {
    let release: (() => void) | undefined;
    const runtime = adapter();
    runtime.renderSettled = vi.fn(async (
      input: StudioProceduralArtisticBrushAdapterInput,
      signal: AbortSignal,
    ): Promise<StudioProceduralArtisticBrushAdapterOutput> => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      return {
        kind: "studio-procedural-artistic-brush/adapter-output",
        width: input.width,
        height: input.height,
        seed: input.seed,
        backend: "webgl2",
        executionStage: "settled",
        complete: true,
        pixels: new Uint8Array(input.width * input.height * 4),
        capabilitiesUsed: ["procedural:flow-field"],
      };
    });
    runtime.dispose = vi.fn();
    const { createSurface } = surfaceFactory();
    const creation = createStudioProceduralArtisticBrushProvider({
      engineEpoch: 7,
      executionLocality: "dedicated-worker",
      loadAdapter: () => runtime,
      createSurface,
    });
    if (creation.status !== "ready") throw new Error("provider creation failed");

    const pending = creation.provider.render(request());
    await vi.waitFor(() => expect(runtime.renderSettled).toHaveBeenCalledOnce());
    expect(creation.provider.advanceEngineEpoch()).toBe(8);
    release?.();
    await expect(pending).resolves.toMatchObject({
      status: "rejected",
      reason: "aborted",
    });
    await creation.provider.dispose();
    await creation.provider.dispose();
    expect(runtime.dispose).toHaveBeenCalledOnce();
    await expect(
      creation.provider.render(request({ engineEpoch: 8 })),
    ).resolves.toMatchObject({
      status: "rejected",
      reason: "disposed",
    });
  });

  it("disposes an adapter that resolves after disposal starts", async () => {
    let resolveAdapter:
      | ((value: StudioProceduralArtisticBrushAdapter) => void)
      | undefined;
    const runtime = adapter();
    runtime.dispose = vi.fn();
    const loadAdapter = vi.fn(() => (
      new Promise<StudioProceduralArtisticBrushAdapter>((resolve) => {
        resolveAdapter = resolve;
      })
    ));
    const creation = createStudioProceduralArtisticBrushProvider({
      engineEpoch: 7,
      executionLocality: "dedicated-worker",
      loadAdapter,
      createSurface: surfaceFactory().createSurface,
    });
    if (creation.status !== "ready") throw new Error("provider creation failed");

    const render = creation.provider.render(request());
    await vi.waitFor(() => expect(loadAdapter).toHaveBeenCalledOnce());
    const disposal = creation.provider.dispose();
    const concurrentDisposal = creation.provider.dispose();
    expect(concurrentDisposal).toBe(disposal);
    let concurrentDisposalSettled = false;
    void concurrentDisposal.then(() => {
      concurrentDisposalSettled = true;
    });
    await Promise.resolve();
    expect(concurrentDisposalSettled).toBe(false);
    resolveAdapter?.(runtime);

    await Promise.all([disposal, concurrentDisposal]);
    expect(concurrentDisposalSettled).toBe(true);
    await expect(render).resolves.toMatchObject({
      status: "rejected",
      reason: "disposed",
    });
    expect(runtime.renderSettled).not.toHaveBeenCalled();
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(creation.provider.snapshot()).toMatchObject({
      phase: "disposed",
      adapterLoaded: false,
      active: false,
    });
  });

  it("rejects non-worker construction so the library cannot capture the main canvas", () => {
    expect(createStudioProceduralArtisticBrushProvider({
      engineEpoch: 7,
      executionLocality: "main",
      loadAdapter: () => adapter(),
      createSurface: surfaceFactory().createSurface,
    })).toEqual({
      status: "rejected",
      reason: "invalid-options",
      path: "options",
    });
  });
});
