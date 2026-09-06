import { describe, expect, it, vi } from "vitest";

import {
  createStudioProceduralArtisticBrushProvider,
  type StudioProceduralArtisticBrushRequest,
} from "../studio-procedural-artistic-brush-provider";

import {
  STUDIO_P5_BRUSH_STANDALONE_ADAPTER_VERSION,
  STUDIO_P5_BRUSH_STANDALONE_CAPABILITIES,
  createStudioP5BrushStandaloneAdapterLoader,
  type StudioP5BrushStandaloneEnvironment,
} from "./studio-p5-brush-standalone-runtime-adapter";

interface FakeModule {
  readonly calls: string[];
  readonly load: ReturnType<typeof vi.fn>;
  readonly render: ReturnType<typeof vi.fn>;
  readonly clear: ReturnType<typeof vi.fn>;
  readonly seed: ReturnType<typeof vi.fn>;
  readonly noiseSeed: ReturnType<typeof vi.fn>;
  readonly angleMode: ReturnType<typeof vi.fn>;
  readonly push: ReturnType<typeof vi.fn>;
  readonly pop: ReturnType<typeof vi.fn>;
  readonly translate: ReturnType<typeof vi.fn>;
  readonly box: ReturnType<typeof vi.fn>;
  readonly set: ReturnType<typeof vi.fn>;
  readonly noStroke: ReturnType<typeof vi.fn>;
  readonly noFill: ReturnType<typeof vi.fn>;
  readonly noHatch: ReturnType<typeof vi.fn>;
  readonly noMass: ReturnType<typeof vi.fn>;
  readonly noField: ReturnType<typeof vi.fn>;
  readonly noWash: ReturnType<typeof vi.fn>;
  readonly noClip: ReturnType<typeof vi.fn>;
  readonly fill: ReturnType<typeof vi.fn>;
  readonly fillBleed: ReturnType<typeof vi.fn>;
  readonly fillTexture: ReturnType<typeof vi.fn>;
  readonly wash: ReturnType<typeof vi.fn>;
  readonly listFields: ReturnType<typeof vi.fn>;
  readonly field: ReturnType<typeof vi.fn>;
  readonly refreshField: ReturnType<typeof vi.fn>;
  readonly spline: ReturnType<typeof vi.fn>;
  readonly hatch: ReturnType<typeof vi.fn>;
  readonly hatchStyle: ReturnType<typeof vi.fn>;
  readonly mass: ReturnType<typeof vi.fn>;
  readonly polygon: ReturnType<typeof vi.fn>;
  readonly RADIANS: "radians";
}

function fakeModule(): FakeModule {
  const calls: string[] = [];
  const call = (name: string) => vi.fn((..._args: unknown[]) => {
    calls.push(name);
  });
  return {
    calls,
    RADIANS: "radians",
    load: call("load"),
    render: call("render"),
    clear: call("clear"),
    seed: call("seed"),
    noiseSeed: call("noiseSeed"),
    angleMode: call("angleMode"),
    push: call("push"),
    pop: call("pop"),
    translate: call("translate"),
    box: vi.fn(() => [
      "HB",
      "pen",
      "charcoal",
    ]),
    set: call("set"),
    noStroke: call("noStroke"),
    noFill: call("noFill"),
    noHatch: call("noHatch"),
    noMass: call("noMass"),
    noField: call("noField"),
    noWash: call("noWash"),
    noClip: call("noClip"),
    fill: call("fill"),
    fillBleed: call("fillBleed"),
    fillTexture: call("fillTexture"),
    wash: call("wash"),
    listFields: vi.fn(() => ["waves", "seabed"]),
    field: call("field"),
    refreshField: call("refreshField"),
    spline: call("spline"),
    hatch: call("hatch"),
    hatchStyle: call("hatchStyle"),
    mass: call("mass"),
    polygon: call("polygon"),
  };
}

function fakeGl() {
  const readbackDestinations: Uint8Array[] = [];
  return {
    DITHER: 0x0bd0,
    FRAMEBUFFER: 0x8d40,
    PACK_ALIGNMENT: 0x0d05,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    bindFramebuffer: vi.fn(),
    disable: vi.fn(),
    pixelStorei: vi.fn(),
    finish: vi.fn(),
    readPixels: vi.fn((
      _x: number,
      _y: number,
      width: number,
      height: number,
      _format: number,
      _type: number,
      output: Uint8Array,
    ) => {
      readbackDestinations.push(output);
      const rowBytes = width * 4;
      for (let row = 0; row < height; row += 1) {
        output.fill(row + 1, row * rowBytes, (row + 1) * rowBytes);
      }
    }),
    readbackDestinations,
  };
}

function fakeSurface(width = 2, height = 2) {
  const gl = fakeGl();
  const canvas = {
    width,
    height,
    getContext: vi.fn(() => gl),
  };
  return {
    gl,
    canvas,
    dispose: vi.fn(),
    surface: {
      kind: "offscreen-canvas-webgl2" as const,
      executionLocality: "dedicated-worker" as const,
      transferredFromMainThread: false as const,
      width,
      height,
      canvas,
      context: gl,
      dispose: vi.fn(),
    },
  };
}

const ENVIRONMENT: StudioP5BrushStandaloneEnvironment = Object.freeze({
  isDedicatedWorkerScope: () => true,
  isOffscreenCanvas: () => true,
  isWebGl2Context: () => true,
});

function request(
  technique: StudioProceduralArtisticBrushRequest["plan"]["technique"],
  overrides: Partial<StudioProceduralArtisticBrushRequest["plan"]> = {},
): StudioProceduralArtisticBrushRequest {
  const presetId =
    technique === "watercolor-fill" || technique === "flat-wash"
      ? `studio-procedural-${technique}-v1`
      : `preset-${technique}`;
  return {
    kind: "studio-procedural-artistic-brush/request",
    version: 1,
    requestSequence: 1,
    engineEpoch: 4,
    strokeId: `stroke-${technique}`,
    stage: "settled",
    seed: 0x1234_abcd,
    width: 2,
    height: 2,
    pixelRatio: 1,
    plan: {
      technique,
      presetId,
      samples: [
        {
          x: 0,
          y: 0,
          pressure: 0.25,
          tiltX: 0,
          tiltY: 0,
          timeMilliseconds: 0,
        },
        {
          x: 1,
          y: 0,
          pressure: 0.5,
          tiltX: 0,
          tiltY: 0,
          timeMilliseconds: 8,
        },
        {
          x: 1,
          y: 1,
          pressure: 0.75,
          tiltX: 0,
          tiltY: 0,
          timeMilliseconds: 16,
        },
      ],
      parameters: {},
      ...overrides,
    },
  };
}

function createHarness(runtime: FakeModule) {
  const target = fakeSurface();
  const loader = createStudioP5BrushStandaloneAdapterLoader({
    importStandalone: vi.fn(async () => runtime),
    environment: ENVIRONMENT,
  });
  const creation = createStudioProceduralArtisticBrushProvider({
    engineEpoch: 4,
    executionLocality: "dedicated-worker",
    loadAdapter: loader,
    createSurface: () => target.surface,
  });
  if (creation.status !== "ready") throw new Error("provider creation failed");
  return { provider: creation.provider, target };
}

describe("Studio p5.brush standalone concrete adapter", () => {
  it("advertises the five proven artistic techniques at adapter revision 7", async () => {
    expect(STUDIO_P5_BRUSH_STANDALONE_ADAPTER_VERSION).toBe(
      "2.2.1-adapter.7",
    );
    expect(STUDIO_P5_BRUSH_STANDALONE_CAPABILITIES).toEqual([
      "procedural:flow-field",
      "procedural:hatch",
      "procedural:mass",
      "procedural:watercolor-fill",
      "procedural:flat-wash",
      "execution:settled-only",
      "surface:offscreen-canvas",
      "gpu:webgl2",
      "seed:deterministic",
      "authority:none",
    ]);
    const load = createStudioP5BrushStandaloneAdapterLoader({
      importStandalone: async () => fakeModule(),
      environment: ENVIRONMENT,
    });
    const runtime = await load();
    expect(runtime?.descriptor.capabilities).not.toContain("tip:image");
    expect(runtime?.descriptor.capabilities).not.toContain("tip:custom");
  });

  it("uses identical bootstrap entropy for independent imports and restores Math.random", async () => {
    const originalRandom = Math.random;
    const observations: number[][] = [];
    const createLoader = () => createStudioP5BrushStandaloneAdapterLoader({
      importStandalone: async () => {
        await Promise.resolve();
        observations.push([
          Math.random(),
          Math.random(),
          Math.random(),
          Math.random(),
        ]);
        return fakeModule();
      },
      environment: ENVIRONMENT,
    });

    await expect(createLoader()()).resolves.not.toBeNull();
    expect(Math.random).toBe(originalRandom);
    await expect(createLoader()()).resolves.not.toBeNull();
    expect(Math.random).toBe(originalRandom);
    expect(observations).toHaveLength(2);
    expect(observations[1]).toEqual(observations[0]);
  });

  it("restores Math.random when standalone module evaluation fails", async () => {
    const originalRandom = Math.random;
    const load = createStudioP5BrushStandaloneAdapterLoader({
      importStandalone: async () => {
        Math.random();
        throw new Error("module evaluation failed");
      },
      environment: ENVIRONMENT,
    });

    await expect(load()).resolves.toBeNull();
    expect(Math.random).toBe(originalRandom);
  });

  it("releases the import queue when the host forbids replacing Math.random", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Math, "random");
    const originalRandom = Math.random;
    Object.defineProperty(Math, "random", {
      configurable: true,
      enumerable: descriptor?.enumerable ?? false,
      value: originalRandom,
      writable: false,
    });
    try {
      const blocked = createStudioP5BrushStandaloneAdapterLoader({
        importStandalone: async () => fakeModule(),
        environment: ENVIRONMENT,
      });
      await expect(blocked()).resolves.toBeNull();
    } finally {
      if (descriptor) Object.defineProperty(Math, "random", descriptor);
    }

    const recovered = createStudioP5BrushStandaloneAdapterLoader({
      importStandalone: async () => fakeModule(),
      environment: ENVIRONMENT,
    });
    await expect(recovered()).resolves.not.toBeNull();
  });

  it.each(["fill", "fillBleed", "fillTexture", "wash"] as const)(
    "fails closed when the standalone %s API is absent",
    async (api) => {
      const incomplete = {
        ...fakeModule(),
        [api]: undefined,
      };
      const load = createStudioP5BrushStandaloneAdapterLoader({
        importStandalone: async () => incomplete,
        environment: ENVIRONMENT,
      });

      await expect(load()).resolves.toBeNull();
    },
  );

  it("loads a Worker OffscreenCanvas, seeds, centers, flushes and vertically normalizes flow output", async () => {
    const runtime = fakeModule();
    const { provider, target } = createHarness(runtime);
    const result = await provider.render(request("flow-field", {
      parameters: {
        brush: "HB",
        field: "seabed",
        color: "#334455",
        weight: 2,
        curvature: 0.65,
        fieldTime: 3,
      },
    }));
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;

    expect(runtime.load).toHaveBeenCalledWith(target.canvas);
    expect(runtime.seed).toHaveBeenCalledBefore(runtime.load);
    expect(runtime.noiseSeed).toHaveBeenCalledBefore(runtime.load);
    expect(runtime.seed).toHaveBeenCalledWith(0x1234_abcd);
    expect(runtime.noiseSeed).toHaveBeenCalledWith(0x1234_abcd);
    expect(target.gl.disable).toHaveBeenCalledWith(target.gl.DITHER);
    expect(target.gl.disable).toHaveBeenCalledBefore(runtime.load);
    expect(runtime.translate).toHaveBeenCalledWith(-1, -1);
    expect(runtime.set).toHaveBeenCalledWith("HB", "#334455", 2);
    expect(runtime.field).toHaveBeenCalledWith("seabed");
    expect(runtime.refreshField).toHaveBeenCalledWith(3);
    expect(runtime.spline).toHaveBeenCalledWith([
      [0, 0, 0.25],
      [1, 0, 0.5],
      [1, 1, 0.75],
    ], 0.65);
    expect(runtime.render).toHaveBeenCalledTimes(3);
    expect(
      runtime.seed.mock.calls.filter(([seed]) => seed === 0x1234_abcd),
    ).toHaveLength(3);
    expect(
      runtime.noiseSeed.mock.calls.filter(([seed]) => seed === 0x1234_abcd),
    ).toHaveLength(3);
    expect(target.gl.finish).toHaveBeenCalledBefore(target.gl.readPixels);
    expect([...result.artifact.pixels.slice(0, 8)]).toEqual(
      Array.from({ length: 8 }, () => 2),
    );
    expect([...result.artifact.pixels.slice(8)]).toEqual(
      Array.from({ length: 8 }, () => 1),
    );
    expect(target.gl.readbackDestinations).toHaveLength(1);
    expect(result.artifact.pixels).not.toBe(
      target.gl.readbackDestinations[0],
    );
    target.gl.readbackDestinations[0]?.fill(9);
    expect([...result.artifact.pixels.slice(0, 8)]).toEqual(
      Array.from({ length: 8 }, () => 2),
    );
    expect(result.artifact.receipt.capabilitiesUsed).toEqual([
      "procedural:flow-field",
    ]);
    expect(runtime.pop).toHaveBeenCalledTimes(2);
    expect(runtime.noField).toHaveBeenCalled();
    expect(runtime.clear).toHaveBeenCalledTimes(3);
  });

  it("returns one vertically flipped readback buffer from the adapter", async () => {
    const runtime = fakeModule();
    const target = fakeSurface(1, 3);
    const load = createStudioP5BrushStandaloneAdapterLoader({
      importStandalone: async () => runtime,
      environment: ENVIRONMENT,
    });
    const adapter = await load();
    if (!adapter) throw new Error("adapter creation failed");
    const brushRequest = request("flow-field");
    const output = await adapter.renderSettled({
      requestSequence: brushRequest.requestSequence,
      engineEpoch: brushRequest.engineEpoch,
      strokeId: brushRequest.strokeId,
      stage: "settled",
      seed: brushRequest.seed,
      width: 1,
      height: 3,
      pixelRatio: brushRequest.pixelRatio,
      plan: brushRequest.plan,
      surface: target.surface,
    }, new AbortController().signal);

    expect(target.gl.readbackDestinations).toHaveLength(1);
    expect(output.pixels).toBe(target.gl.readbackDestinations[0]);
    expect([...output.pixels.slice(0, 4)]).toEqual(
      Array.from({ length: 4 }, () => 3),
    );
    expect([...output.pixels.slice(4, 8)]).toEqual(
      Array.from({ length: 4 }, () => 2),
    );
    expect([...output.pixels.slice(8, 12)]).toEqual(
      Array.from({ length: 4 }, () => 1),
    );
  });

  it("replays deterministically on its first context and rejects a second context", async () => {
    const runtime = fakeModule();
    const firstTarget = fakeSurface();
    const secondTarget = fakeSurface();
    const load = createStudioP5BrushStandaloneAdapterLoader({
      importStandalone: async () => runtime,
      environment: ENVIRONMENT,
    });
    const adapter = await load();
    if (!adapter) throw new Error("adapter creation failed");
    const brushRequest = request("watercolor-fill", {
      parameters: {
        angle: Math.PI / 6,
        color: "#315f8f",
        density: 0.64,
        opacity: 0.72,
        strength: 0.34,
      },
    });
    const input = {
      requestSequence: brushRequest.requestSequence,
      engineEpoch: brushRequest.engineEpoch,
      strokeId: brushRequest.strokeId,
      stage: "settled" as const,
      seed: brushRequest.seed,
      width: brushRequest.width,
      height: brushRequest.height,
      pixelRatio: brushRequest.pixelRatio,
      plan: brushRequest.plan,
      surface: firstTarget.surface,
    };

    const first = await adapter.renderSettled(
      input,
      new AbortController().signal,
    );
    const replay = await adapter.renderSettled(
      {
        ...input,
        requestSequence: input.requestSequence + 1,
        strokeId: `${input.strokeId}-replay`,
      },
      new AbortController().signal,
    );
    expect([...replay.pixels]).toEqual([...first.pixels]);
    expect(runtime.load).toHaveBeenCalledTimes(1);
    expect(runtime.render).toHaveBeenCalledTimes(5);

    await expect(adapter.renderSettled(
      {
        ...input,
        requestSequence: input.requestSequence + 2,
        strokeId: `${input.strokeId}-foreign-context`,
        surface: secondTarget.surface,
      },
      new AbortController().signal,
    )).rejects.toThrow(/context-affine/u);
    expect(runtime.load).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized direct adapter call before runtime or readback allocation", async () => {
    const runtime = fakeModule();
    const target = fakeSurface(8_192, 4_097);
    const load = createStudioP5BrushStandaloneAdapterLoader({
      importStandalone: async () => runtime,
      environment: ENVIRONMENT,
    });
    const adapter = await load();
    if (!adapter) throw new Error("adapter creation failed");
    const brushRequest = request("flow-field");

    await expect(adapter.renderSettled({
      requestSequence: brushRequest.requestSequence,
      engineEpoch: brushRequest.engineEpoch,
      strokeId: brushRequest.strokeId,
      stage: "settled",
      seed: brushRequest.seed,
      width: 8_192,
      height: 4_097,
      pixelRatio: brushRequest.pixelRatio,
      plan: brushRequest.plan,
      surface: target.surface,
    }, new AbortController().signal)).rejects.toThrow(
      /bounded resident-memory budget/u,
    );
    expect(runtime.load).not.toHaveBeenCalled();
    expect(target.gl.readPixels).not.toHaveBeenCalled();
    expect(target.gl.readbackDestinations).toHaveLength(0);
  });

  it("enforces the eight-frame fill budget at the direct adapter boundary", async () => {
    const runtime = fakeModule();
    const target = fakeSurface(4_096, 3_073);
    const load = createStudioP5BrushStandaloneAdapterLoader({
      importStandalone: async () => runtime,
      environment: ENVIRONMENT,
    });
    const adapter = await load();
    if (!adapter) throw new Error("adapter creation failed");
    const brushRequest = request("watercolor-fill", {
      parameters: {
        angle: 0,
        color: "#315f8f",
        density: 0.64,
        opacity: 0.72,
        strength: 0.34,
      },
    });

    await expect(adapter.renderSettled({
      requestSequence: brushRequest.requestSequence,
      engineEpoch: brushRequest.engineEpoch,
      strokeId: brushRequest.strokeId,
      stage: "settled",
      seed: brushRequest.seed,
      width: 4_096,
      height: 3_073,
      pixelRatio: brushRequest.pixelRatio,
      plan: brushRequest.plan,
      surface: target.surface,
    }, new AbortController().signal)).rejects.toThrow(
      /bounded resident-memory budget/u,
    );
    expect(runtime.load).not.toHaveBeenCalled();
    expect(target.gl.readPixels).not.toHaveBeenCalled();
    expect(target.gl.readbackDestinations).toHaveLength(0);
  });

  it("maps hatch and mass settings to their proven public APIs", async () => {
    const hatchRuntime = fakeModule();
    const hatchHarness = createHarness(hatchRuntime);
    const hatch = await hatchHarness.provider.render(request("hatch", {
      parameters: {
        color: "#112233",
        weight: 1.5,
        distance: 7,
        angle: 30,
        randomness: 0.2,
        continuous: true,
        gradient: 0.4,
      },
    }));
    expect(hatch.status).toBe("completed");
    expect(hatchRuntime.hatch).toHaveBeenCalledWith(7, 30, {
      rand: 0.2,
      continuous: true,
      gradient: 0.4,
    });
    expect(hatchRuntime.hatchStyle).toHaveBeenCalledWith(
      "pen",
      "#112233",
      1.5,
    );
    expect(hatchRuntime.polygon).toHaveBeenCalledTimes(2);

    const massRuntime = fakeModule();
    const massHarness = createHarness(massRuntime);
    const mass = await massHarness.provider.render(request("mass", {
      parameters: {
        brush: "charcoal",
        color: "#445566",
        precision: 0.7,
        strength: 0.9,
        gradient: 0.3,
        outline: true,
      },
    }));
    expect(mass.status).toBe("completed");
    expect(massRuntime.mass).toHaveBeenCalledWith(
      "charcoal",
      "#445566",
      {
        precision: 0.7,
        strength: 0.9,
        gradient: 0.3,
        outline: true,
      },
    );
    expect(massRuntime.polygon).toHaveBeenCalledTimes(2);
  });

  it("maps watercolor density, strength, radians and opacity to the official fill APIs", async () => {
    const runtime = fakeModule();
    const { provider } = createHarness(runtime);
    const result = await provider.render(request("watercolor-fill", {
      parameters: {
        angle: Math.PI / 3,
        color: "#315f8f",
        density: 0.67,
        opacity: 0.5,
        strength: 0.42,
      },
    }));

    expect(result.status).toBe("completed");
    expect(runtime.fill).toHaveBeenCalledTimes(2);
    expect(runtime.fill).toHaveBeenNthCalledWith(1, "#315f8f", 128);
    expect(runtime.fill).toHaveBeenNthCalledWith(2, "#315f8f", 128);
    expect(runtime.fillBleed).toHaveBeenCalledTimes(2);
    expect(runtime.fillBleed).toHaveBeenNthCalledWith(
      1,
      0.42,
      "out",
      Math.PI / 3,
    );
    expect(runtime.fillTexture).toHaveBeenCalledTimes(2);
    expect(runtime.fillTexture).toHaveBeenNthCalledWith(
      1,
      0.67,
      0.4,
      true,
    );
    expect(runtime.polygon).toHaveBeenCalledTimes(2);
    expect(runtime.wash).not.toHaveBeenCalled();
    expect(runtime.noStroke).toHaveBeenCalledTimes(6);
    expect(runtime.noHatch).toHaveBeenCalledTimes(6);
    expect(runtime.noMass).toHaveBeenCalledTimes(6);
    expect(runtime.noWash).toHaveBeenCalledTimes(6);
    expect(runtime.noField).toHaveBeenCalledTimes(6);
    expect(runtime.noFill).toHaveBeenCalledTimes(4);
    if (result.status === "completed") {
      expect(result.artifact.receipt.capabilitiesUsed).toEqual([
        "procedural:watercolor-fill",
      ]);
    }
  });

  it("maps flat wash color and opacity while seed remains request-owned", async () => {
    const runtime = fakeModule();
    const { provider } = createHarness(runtime);
    const result = await provider.render(request("flat-wash", {
      parameters: {
        color: "#c46f3d",
        opacity: 0.25,
      },
    }));

    expect(result.status).toBe("completed");
    expect(runtime.wash).toHaveBeenCalledTimes(2);
    expect(runtime.wash).toHaveBeenNthCalledWith(1, "#c46f3d", 65);
    expect(runtime.wash).toHaveBeenNthCalledWith(2, "#c46f3d", 65);
    expect(runtime.fill).not.toHaveBeenCalled();
    expect(runtime.polygon).toHaveBeenCalledTimes(2);
    expect(
      runtime.seed.mock.calls.filter(([seed]) => seed === 0x1234_abcd),
    ).toHaveLength(3);
    expect(
      runtime.noiseSeed.mock.calls.filter(([seed]) => seed === 0x1234_abcd),
    ).toHaveLength(3);
    expect(runtime.noStroke).toHaveBeenCalledTimes(6);
    expect(runtime.noFill).toHaveBeenCalledTimes(6);
    expect(runtime.noHatch).toHaveBeenCalledTimes(6);
    expect(runtime.noMass).toHaveBeenCalledTimes(6);
    expect(runtime.noField).toHaveBeenCalledTimes(6);
    expect(runtime.noWash).toHaveBeenCalledTimes(4);
    if (result.status === "completed") {
      expect(result.artifact.receipt.capabilitiesUsed).toEqual([
        "procedural:flat-wash",
      ]);
    }
  });

  it("fails closed for image/custom tips and never invokes runtime drawing", async () => {
    const runtime = fakeModule();
    const { provider } = createHarness(runtime);
    const imageTip = await provider.render(request("image-tip", {
      tip: {
        kind: "image",
        assetId: "tip-image",
        width: 1,
        height: 1,
        rgba8: new Uint8Array([255, 255, 255, 255]),
      },
    }));
    expect(imageTip).toMatchObject({
      status: "rejected",
      consumed: false,
      reason: "unsupported-capability",
    });
    expect(runtime.load).not.toHaveBeenCalled();
  });

  it("verifies Dedicated Worker, OffscreenCanvas and WebGL2 identity", async () => {
    const runtime = fakeModule();
    const target = fakeSurface();
    const loader = createStudioP5BrushStandaloneAdapterLoader({
      importStandalone: async () => runtime,
      environment: {
        ...ENVIRONMENT,
        isDedicatedWorkerScope: () => false,
      },
    });
    const creation = createStudioProceduralArtisticBrushProvider({
      engineEpoch: 4,
      executionLocality: "dedicated-worker",
      loadAdapter: loader,
      createSurface: () => target.surface,
    });
    if (creation.status !== "ready") throw new Error("provider creation failed");
    await expect(
      creation.provider.render(request("flow-field")),
    ).resolves.toMatchObject({
      status: "rejected",
      reason: "adapter-failed",
    });
    expect(runtime.load).not.toHaveBeenCalled();
    expect(target.surface.dispose).toHaveBeenCalledOnce();
  });

  it("serializes the module-global runtime across adapter instances", async () => {
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstRuntime = fakeModule();
    firstRuntime.render.mockImplementation(async () => {
      if (!events.includes("first-start")) {
        events.push("first-start");
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        events.push("first-end");
      } else {
        events.push("first-retained");
      }
    });
    const secondRuntime = fakeModule();
    secondRuntime.render.mockImplementation(() => {
      events.push("second");
    });
    const first = createHarness(firstRuntime);
    const second = createHarness(secondRuntime);

    const firstRender = first.provider.render(request("flow-field"));
    await vi.waitFor(() => expect(events).toContain("first-start"));
    const secondRender = second.provider.render(request("flow-field"));
    await Promise.resolve();
    expect(events).toEqual(["first-start"]);
    releaseFirst?.();
    await Promise.all([firstRender, secondRender]);
    expect(events).toEqual([
      "first-start",
      "first-end",
      "first-retained",
      "first-retained",
      "second",
      "second",
      "second",
    ]);
  });
});
