import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_ADAPTER_VERSION,
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_TECHNIQUES,
  StudioProceduralArtisticBrushProductError,
  generateStudioProceduralArtisticBrushProduct,
  probeStudioProceduralArtisticBrushProduct,
  type StudioProceduralArtisticBrushProductGenerateOptions,
} from "./studio-procedural-artistic-brush-product";

import type {
  StudioProceduralArtisticBrushArtifact,
  StudioProceduralArtisticBrushReceipt,
} from "./studio-procedural-artistic-brush-provider";
import type { StudioProceduralArtisticBrushSettings } from "./StudioProceduralArtisticBrushController";

const runtimeMocks = vi.hoisted(() => ({
  probe: vi.fn(),
  render: vi.fn(),
  encode: vi.fn(),
}));

vi.mock(
  "./studio-procedural-artistic-brush-worker-client",
  () => ({
    probeStudioProceduralArtisticBrushWorker: runtimeMocks.probe,
    renderStudioProceduralArtisticBrushInWorker: runtimeMocks.render,
  }),
);
vi.mock(
  "./studio-procedural-artistic-brush-browser",
  () => ({
    encodeStudioProceduralArtisticBrushPngDataUrl: runtimeMocks.encode,
  }),
);

function settings(
  overrides: Partial<StudioProceduralArtisticBrushSettings> = {},
): StudioProceduralArtisticBrushSettings {
  return {
    technique: "flow-field",
    color: "#336699",
    density: 64,
    angle: 35,
    weight: 2.4,
    strength: 0.78,
    seed: 91,
    ...overrides,
  };
}

function options(
  overrides: Partial<StudioProceduralArtisticBrushProductGenerateOptions> = {},
): StudioProceduralArtisticBrushProductGenerateOptions {
  return {
    width: 320,
    height: 240,
    requestSequence: 3,
    engineEpoch: 7,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function receipt(
  technique: StudioProceduralArtisticBrushSettings["technique"] =
    "flow-field",
  seed = 91,
): StudioProceduralArtisticBrushReceipt {
  return {
    kind: "studio-procedural-artistic-brush/receipt",
    version: 1,
    requestSequence: 3,
    engineEpoch: 7,
    strokeId: `studio-procedural-${technique}-${seed}-3`,
    seed,
    technique,
    presetId: `studio-procedural-${technique}-v1`,
    width: 320,
    height: 240,
    outputBytes: 320 * 240 * 4,
    inputFingerprint: `sha256:${"1".repeat(64)}`,
    pixelHash: `sha256:${"2".repeat(64)}`,
    replayFingerprint: `sha256:${"3".repeat(64)}`,
    adapter: {
      id: "p5-brush-standalone-worker",
      version: "2.2.1-adapter.3",
      compatibility: "p5.brush/standalone",
    },
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
    capabilitiesUsed: [
      technique === "flow-field"
        ? "procedural:flow-field"
        : technique === "hatch"
          ? "procedural:hatch"
          : technique === "mass"
            ? "procedural:mass"
            : technique === "watercolor-fill"
              ? "procedural:watercolor-fill"
              : "procedural:flat-wash",
    ],
    complete: true,
  };
}

function artifact(
  technique: StudioProceduralArtisticBrushSettings["technique"] =
    "flow-field",
  seed = 91,
): StudioProceduralArtisticBrushArtifact {
  return {
    kind: "studio-procedural-artistic-brush/artifact",
    version: 1,
    width: 320,
    height: 240,
    encoding: "rgba8-unorm",
    colorSpace: "srgb",
    alpha: "straight",
    pixels: new Uint8ClampedArray(320 * 240 * 4),
    receipt: receipt(technique, seed),
  };
}

function completedPng(
  providerArtifact: StudioProceduralArtisticBrushArtifact,
) {
  return {
    status: "completed" as const,
    consumed: false as const,
    artifact: {
      kind: "studio-procedural-artistic-brush-browser/png-data-url-artifact" as const,
      version: 1 as const,
      width: providerArtifact.width,
      height: providerArtifact.height,
      mediaType: "image/png" as const,
      dataUrl: "data:image/png;base64,iVBORw0KGgo=" as const,
      pngByteLength: 8,
      dataUrlCodeUnits: 34,
      source: {
        providerVersion: 1 as const,
        requestSequence: providerArtifact.receipt.requestSequence,
        engineEpoch: providerArtifact.receipt.engineEpoch,
        strokeId: providerArtifact.receipt.strokeId,
        pixelHash: providerArtifact.receipt.pixelHash,
        replayFingerprint:
          providerArtifact.receipt.replayFingerprint,
      },
      authority: {
        mainScene: false as const,
        document: false as const,
        history: false as const,
        persistence: false as const,
        output: "lossless-png-insertion-suggestion" as const,
      },
    },
  };
}

function installCapableBrowserGlobals(): void {
  class FakeOffscreenCanvas {
    public constructor(
      public readonly width: number,
      public readonly height: number,
    ) {}

    public getContext(type: string) {
      return type === "webgl2"
        ? {
            getExtension: () => ({
              loseContext: vi.fn(),
            }),
          }
        : null;
    }
  }
  vi.stubGlobal("Worker", class FakeWorker {});
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  vi.stubGlobal("ImageData", class FakeImageData {});
  vi.stubGlobal("Blob", class FakeBlob {});
  vi.stubGlobal("FileReader", class FakeFileReader {});
  vi.stubGlobal("atob", vi.fn(() => ""));
  vi.stubGlobal("crypto", {
    subtle: {
      digest: vi.fn(),
    },
  });
  vi.stubGlobal("document", {
    createElement: vi.fn(() => ({
      width: 0,
      height: 0,
      getContext: vi.fn((type: string) => (
        type === "2d"
          ? { putImageData: vi.fn() }
          : null
      )),
      toBlob: vi.fn(),
    })),
  });
}

afterEach(() => {
  runtimeMocks.render.mockReset();
  runtimeMocks.probe.mockReset();
  runtimeMocks.encode.mockReset();
  vi.unstubAllGlobals();
});

describe("studio procedural artistic brush product facade", () => {
  it("pins the exact five product techniques and adapter contract", () => {
    expect(STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_TECHNIQUES).toEqual([
      "flow-field",
      "hatch",
      "mass",
      "watercolor-fill",
      "flat-wash",
    ]);
    expect(
      Object.isFrozen(STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_TECHNIQUES),
    ).toBe(true);
    expect(STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_ADAPTER_VERSION).toBe(
      "2.2.1-adapter.3",
    );
  });

  it("contains no static runtime import of planner, Worker client, or PNG bridge", () => {
    const source = readFileSync(
      new URL("./studio-procedural-artistic-brush-product.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      'import("./studio-procedural-artistic-brush-plan")',
    );
    expect(source).toContain(
      'import("./studio-procedural-artistic-brush-worker-client")',
    );
    expect(source).toContain(
      'import("./studio-procedural-artistic-brush-browser")',
    );
    expect(source).not.toMatch(
      /import\s+\{[^}]*\}\s+from\s+"\.\/studio-procedural-artistic-brush-(?:plan|worker-client|browser)"/u,
    );
  });

  it("probes browser primitives and lazy runtime modules on demand", async () => {
    installCapableBrowserGlobals();
    runtimeMocks.probe.mockResolvedValue({
      available: true,
      probe: {
        workerScope: "DedicatedWorkerGlobalScope",
        dedicatedWorker: true,
        offscreenCanvas: true,
        webgl2: true,
        privateSurface: true,
        mainThreadFallback: false,
        webglVersion: "WebGL 2.0",
      },
    });
    const result = await probeStudioProceduralArtisticBrushProduct(
      new AbortController().signal,
    );
    expect(result).toEqual({
      available: true,
      message:
        "전용 Worker · OffscreenCanvas · WebGL 2.0 · PNG 경로를 사용할 수 있습니다.",
    });
    expect(runtimeMocks.probe).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
    expect(runtimeMocks.render).not.toHaveBeenCalled();
  });

  it("fails the probe closed without Web Crypto or a usable Canvas 2D context", async () => {
    installCapableBrowserGlobals();
    vi.stubGlobal("crypto", {});
    await expect(
      probeStudioProceduralArtisticBrushProduct(
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      available: false,
      message: expect.stringContaining("PNG"),
    });
    expect(runtimeMocks.probe).not.toHaveBeenCalled();

    installCapableBrowserGlobals();
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => null),
        toBlob: vi.fn(),
      })),
    });
    await expect(
      probeStudioProceduralArtisticBrushProduct(
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      available: false,
      message: expect.stringContaining("Canvas 2D"),
    });
    expect(runtimeMocks.probe).not.toHaveBeenCalled();
  });

  it("fails the probe closed without PNG primitives or Worker WebGL2", async () => {
    const missingPng = await probeStudioProceduralArtisticBrushProduct(
      new AbortController().signal,
    );
    expect(missingPng).toMatchObject({
      available: false,
      message: expect.stringContaining("PNG"),
    });
    expect(runtimeMocks.probe).not.toHaveBeenCalled();

    installCapableBrowserGlobals();
    runtimeMocks.probe.mockResolvedValue({
      available: false,
      reason: "webgl2-unavailable",
      detail: "Worker WebGL2 unavailable",
    });
    const missingWebGl2 = await probeStudioProceduralArtisticBrushProduct(
      new AbortController().signal,
    );
    expect(missingWebGl2).toMatchObject({
      available: false,
      message: expect.stringContaining("WebGL2"),
    });
    expect(runtimeMocks.render).not.toHaveBeenCalled();
  });

  it.each([
    [{ density: 0 }, options(), "invalid-input"],
    [{ color: "red" }, options(), "invalid-input"],
    [settings(), { ...options(), width: 31 }, "budget-exceeded"],
    [settings(), { ...options(), width: 1_025 }, "budget-exceeded"],
    [settings(), { ...options(), height: 1_025 }, "budget-exceeded"],
  ])(
    "rejects hostile or over-budget inputs before rendering",
    async (settingsCandidate, optionsCandidate, reason) => {
      await expect(
        generateStudioProceduralArtisticBrushProduct(
          settingsCandidate as StudioProceduralArtisticBrushSettings,
          optionsCandidate as StudioProceduralArtisticBrushProductGenerateOptions,
        ),
      ).rejects.toMatchObject({
        name: "StudioProceduralArtisticBrushProductError",
        reason,
      });
      expect(runtimeMocks.render).not.toHaveBeenCalled();
      expect(runtimeMocks.encode).not.toHaveBeenCalled();
    },
  );

  it("rejects accessors without invoking them", async () => {
    const getter = vi.fn(() => 64);
    const hostile = { ...settings() } as Record<string, unknown>;
    Object.defineProperty(hostile, "density", {
      enumerable: true,
      get: getter,
    });
    await expect(
      generateStudioProceduralArtisticBrushProduct(
        hostile as unknown as StudioProceduralArtisticBrushSettings,
        options(),
      ),
    ).rejects.toMatchObject({
      reason: "invalid-input",
      path: "$.settings.density",
    });
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects provider-only techniques before rendering", async () => {
    await expect(
      generateStudioProceduralArtisticBrushProduct(
        {
          ...settings(),
          technique: "image-tip",
        } as unknown as StudioProceduralArtisticBrushSettings,
        options(),
      ),
    ).rejects.toMatchObject({
      reason: "invalid-input",
      path: "$.settings.technique",
    });
    expect(runtimeMocks.render).not.toHaveBeenCalled();
    expect(runtimeMocks.encode).not.toHaveBeenCalled();
  });

  it("admits the exact 1024px product boundary before Worker execution", async () => {
    runtimeMocks.render.mockRejectedValue(new Error("boundary stop"));
    await expect(
      generateStudioProceduralArtisticBrushProduct(
        settings(),
        options({ width: 1_024, height: 1_024 }),
      ),
    ).rejects.toMatchObject({ reason: "render-failed" });
    expect(runtimeMocks.render).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 1_024,
        height: 1_024,
      }),
      expect.any(Object),
    );
  });

  it.each([
    ["flow-field", "흐름장"],
    ["hatch", "해칭"],
    ["mass", "매스"],
    ["watercolor-fill", "수채 채움"],
    ["flat-wash", "플랫 워시"],
  ] as const)(
    "returns a lossless PNG %s layer result with technique and seed metadata",
    async (technique, KoreanTechnique) => {
      const providerArtifact = artifact(technique);
      runtimeMocks.render.mockResolvedValue(providerArtifact);
      runtimeMocks.encode.mockResolvedValue(
        completedPng(providerArtifact),
      );
      const sourceSettings = Object.freeze(settings({ technique }));
      const sourceOptions = Object.freeze(options());
      const settingsBefore = structuredClone(sourceSettings);
      const result = await generateStudioProceduralArtisticBrushProduct(
        sourceSettings,
        sourceOptions,
      );

      expect(result).toMatchObject({
        src: expect.stringMatching(/^data:image\/png;base64,/u),
        width: 320,
        height: 240,
        receipt: providerArtifact.receipt,
      });
      expect(result.name).toContain(KoreanTechnique);
      expect(result.name).toContain("시드 91");
      expect(result.message).toContain(result.name);
      expect(result.receipt.adapter.version).toBe(
        STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_ADAPTER_VERSION,
      );
      expect(Object.isFrozen(result)).toBe(true);
      expect(sourceSettings).toEqual(settingsBefore);
      expect(sourceOptions).toEqual(options({
        signal: sourceOptions.signal,
      }));
      expect(runtimeMocks.render).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: "settled",
          seed: 91,
          width: 320,
          height: 240,
          plan: expect.objectContaining({ technique }),
        }),
        { signal: sourceOptions.signal },
      );
      expect(
        Object.hasOwn(runtimeMocks.render.mock.calls[0]![0], "signal"),
      ).toBe(false);
      expect(runtimeMocks.encode).toHaveBeenCalledWith(
        providerArtifact,
        expect.objectContaining({
          signal: sourceOptions.signal,
          limits: expect.objectContaining({
            maxWidth: 1_024,
            maxHeight: 1_024,
            maxPixels: 1_048_576,
          }),
        }),
      );
    },
  );

  it("propagates cancellation between Worker render and PNG encoding", async () => {
    const controller = new AbortController();
    let resolveRender!: (
      value: StudioProceduralArtisticBrushArtifact,
    ) => void;
    runtimeMocks.render.mockImplementation(() => new Promise((resolve) => {
      resolveRender = resolve;
    }));
    const generation = generateStudioProceduralArtisticBrushProduct(
      settings(),
      options({ signal: controller.signal }),
    );
    await vi.waitFor(() => {
      expect(runtimeMocks.render).toHaveBeenCalledTimes(1);
    });
    controller.abort();
    resolveRender(artifact());
    await expect(generation).rejects.toMatchObject({ name: "AbortError" });
    expect(runtimeMocks.encode).not.toHaveBeenCalled();
  });

  it("maps Worker and PNG failures to stable fail-closed product errors", async () => {
    runtimeMocks.render.mockRejectedValueOnce(new Error("Worker crash"));
    await expect(
      generateStudioProceduralArtisticBrushProduct(settings(), options()),
    ).rejects.toMatchObject({
      name: "StudioProceduralArtisticBrushProductError",
      reason: "render-failed",
      message: "Worker crash",
    });

    const providerArtifact = artifact();
    runtimeMocks.render.mockResolvedValueOnce(providerArtifact);
    runtimeMocks.encode.mockResolvedValueOnce({
      status: "rejected",
      consumed: false,
      reason: "invalid-png-result",
      detail: "PNG signature mismatch",
    });
    await expect(
      generateStudioProceduralArtisticBrushProduct(settings(), options()),
    ).rejects.toMatchObject({
      reason: "png-failed",
      message: "PNG signature mismatch",
    });
  });

  it("rejects a receipt/PNG integrity mismatch", async () => {
    const providerArtifact = artifact();
    runtimeMocks.render.mockResolvedValue(providerArtifact);
    const png = completedPng(providerArtifact);
    runtimeMocks.encode.mockResolvedValue({
      ...png,
      artifact: {
        ...png.artifact,
        source: {
          ...png.artifact.source,
          pixelHash: `sha256:${"f".repeat(64)}`,
        },
      },
    });
    await expect(
      generateStudioProceduralArtisticBrushProduct(settings(), options()),
    ).rejects.toMatchObject({
      reason: "integrity-failed",
    });
  });

  it("rejects a receipt from any non-product adapter version", async () => {
    const sourceArtifact = artifact("watercolor-fill");
    const incompatibleArtifact = {
      ...sourceArtifact,
      receipt: {
        ...sourceArtifact.receipt,
        adapter: {
          ...sourceArtifact.receipt.adapter,
          version: "2.2.1-adapter.2",
        },
      },
    } satisfies StudioProceduralArtisticBrushArtifact;
    runtimeMocks.render.mockResolvedValue(incompatibleArtifact);
    runtimeMocks.encode.mockResolvedValue(completedPng(incompatibleArtifact));

    await expect(
      generateStudioProceduralArtisticBrushProduct(
        settings({ technique: "watercolor-fill" }),
        options(),
      ),
    ).rejects.toMatchObject({
      reason: "integrity-failed",
    });
  });

  it("honors a pre-aborted signal before importing or rendering", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      generateStudioProceduralArtisticBrushProduct(
        settings(),
        options({ signal: controller.signal }),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(runtimeMocks.render).not.toHaveBeenCalled();
    expect(runtimeMocks.encode).not.toHaveBeenCalled();
  });

  it("honors a pre-aborted signal before starting the Worker probe", async () => {
    installCapableBrowserGlobals();
    const controller = new AbortController();
    controller.abort();
    await expect(
      probeStudioProceduralArtisticBrushProduct(controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(runtimeMocks.probe).not.toHaveBeenCalled();
    expect(runtimeMocks.render).not.toHaveBeenCalled();
  });

  it("exposes a typed product error without leaking arbitrary objects", () => {
    const error = new StudioProceduralArtisticBrushProductError(
      "integrity-failed",
      "검증 실패",
      "$.receipt",
    );
    expect(error).toMatchObject({
      name: "StudioProceduralArtisticBrushProductError",
      reason: "integrity-failed",
      path: "$.receipt",
      message: "검증 실패",
    });
  });
});
