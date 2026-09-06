import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { sha256HexPortable } from "../studio-sha256";

import {
  STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
  STUDIO_SCENE_LAYER_LIFT_REQUEST_KIND,
  calculateStudioSceneLayerLiftProviderReceiptSha256,
  isStudioSceneLayerLiftTrustedSuccess,
  parseStudioSceneLayerLiftLocalProviderReceipt,
  parseStudioSceneLayerLiftResult,
} from "./studio-layer-lift-contract";
import {
  STUDIO_LAYER_LIFT_LOCAL_FOREGROUND_CAPABILITY,
  StudioLayerLiftLocalForegroundProviderError,
  applyStudioLayerLiftLocalForegroundCorrection,
  createStudioLayerLiftLocalForegroundProvider,
  type StudioLayerLiftLocalForegroundInferenceEngine,
  type StudioLayerLiftLocalForegroundInferenceInput,
} from "./studio-layer-lift-local-provider";

const hashBytes = (bytes: Uint8Array) =>
  `sha256:${sha256HexPortable(bytes)}` as const;

function sourceBytes(): Uint8Array {
  return new Uint8Array([
    10, 20, 30, 255,
    40, 50, 60, 128,
    70, 80, 90, 255,
    100, 110, 120, 0,
  ]);
}

function request(
  requestedRoles: readonly string[] = ["background", "character"],
) {
  const bytes = sourceBytes();
  return {
    kind: STUDIO_SCENE_LAYER_LIFT_REQUEST_KIND,
    version: STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
    requestId: "lift-local-001",
    source: {
      sourceId: "cut-local-001",
      sourceName: "cut-local-001.png",
      mimeType: "image/png",
      width: 2,
      height: 2,
      pixelCount: 4,
      pixelFormat: "rgba8-srgb-straight",
      channels: 4,
      byteLength: bytes.byteLength,
      sha256: hashBytes(bytes),
      bytes,
    },
    requestedRoles,
  };
}

function engine(
  confidence = new Float32Array([0, 0.9, 0.75, 0]),
  inferOverride?: (
    input: StudioLayerLiftLocalForegroundInferenceInput,
  ) => Promise<{ width: number; height: number; confidence: Float32Array }>,
): StudioLayerLiftLocalForegroundInferenceEngine {
  return {
    model: {
      providerId: "mediapipe-image-segmenter",
      providerVersion: "0.10.35",
      modelId: "selfie-segmenter",
      modelVersion: "latest",
      executionRoute: "gpu",
    },
    infer: inferOverride ?? (async () => ({
      width: 2,
      height: 2,
      confidence,
    })),
  };
}

function errorCode(cause: unknown): string | undefined {
  return cause instanceof StudioLayerLiftLocalForegroundProviderError
    ? cause.code
    : undefined;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Studio Layer Lift local person/character foreground provider", () => {
  it("returns one trusted character layer with canonical model/options provenance", async () => {
    const infer = vi.fn(engine().infer);
    const loadInference = vi.fn(async () => ({
      ...engine(),
      infer,
    }));
    const times = [100, 112.5];
    const provider = createStudioLayerLiftLocalForegroundProvider({
      loadInference,
      now: () => times.shift() ?? 112.5,
    });

    expect(provider.capability)
      .toBe(STUDIO_LAYER_LIFT_LOCAL_FOREGROUND_CAPABILITY);
    const result = await provider.analyze(request(), {
      threshold: 0.5,
      feather: 0,
    });

    expect(loadInference).toHaveBeenCalledTimes(1);
    expect(infer).toHaveBeenCalledTimes(1);
    expect(isStudioSceneLayerLiftTrustedSuccess(result)).toBe(true);
    expect(result).toMatchObject({
      requestId: "lift-local-001",
      status: "success",
      source: {
        sourceId: "cut-local-001",
        width: 2,
        height: 2,
        sha256: request().source.sha256,
      },
      layers: [{
        layerId: "lift-local-001:person-character-foreground",
        role: "character",
        order: 0,
        label: "인물·캐릭터 전경",
      }],
      receipt: {
        providerId:
          "mediapipe-image-segmenter.selfie-segmenter",
        providerVersion: expect.stringMatching(
          /^0\.10\.35\+latest\+gpu\+o\.[0-9a-f]{16}$/u,
        ),
        execution: "local-device",
        networkUsed: false,
        sourceSha256: request().source.sha256,
        inputByteLength: 16,
        outputByteLength: 20,
        maskByteLength: 4,
        layerCount: 1,
        durationMilliseconds: 12.5,
        outcome: "success",
      },
    });
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "PROVIDER_FALLBACK",
        layerId: "lift-local-001:person-character-foreground",
      }),
    ]));
    expect(result.receipt.receiptSha256).toBe(
      calculateStudioSceneLayerLiftProviderReceiptSha256({
        kind: result.receipt.kind,
        version: result.receipt.version,
        providerId: result.receipt.providerId,
        providerVersion: result.receipt.providerVersion,
        execution: result.receipt.execution,
        networkUsed: result.receipt.networkUsed,
        requestId: result.receipt.requestId,
        sourceSha256: result.receipt.sourceSha256,
        inputByteLength: result.receipt.inputByteLength,
        outputByteLength: result.receipt.outputByteLength,
        maskByteLength: result.receipt.maskByteLength,
        layerCount: result.receipt.layerCount,
        durationMilliseconds: result.receipt.durationMilliseconds,
        outcome: result.receipt.outcome,
      }),
    );
    expect(parseStudioSceneLayerLiftLocalProviderReceipt(result.receipt).ok)
      .toBe(true);
  });

  it("constructs straight-alpha foreground RGBA and hashes actual plane bytes", async () => {
    const provider = createStudioLayerLiftLocalForegroundProvider({
      loadInference: async () => engine(),
      now: () => 0,
    });
    const input = request(["character"]);
    const result = await provider.analyze(input, {
      threshold: 0.5,
      feather: 0,
    });
    const layer = result.layers[0]!;

    expect([...layer.mask.bytes]).toEqual([0, 255, 255, 0]);
    expect([...layer.rgba.bytes]).toEqual([
      10, 20, 30, 0,
      40, 50, 60, 128,
      70, 80, 90, 255,
      100, 110, 120, 0,
    ]);
    expect(layer.rgba.sha256).toBe(hashBytes(layer.rgba.bytes));
    expect(layer.mask.sha256).toBe(hashBytes(layer.mask.bytes));
    expect(layer.rgba.bytes).not.toBe(input.source.bytes);
  });

  it("keeps the admitted source authoritative when inference mutates its RGBA copy", async () => {
    const input = request(["foreground"]);
    const original = new Uint8Array(input.source.bytes);
    const provider = createStudioLayerLiftLocalForegroundProvider({
      loadInference: async () => engine(
        new Float32Array([1, 1, 1, 1]),
        async (inferenceInput) => {
          expect(inferenceInput.rgba).not.toBe(input.source.bytes);
          inferenceInput.rgba.fill(0);
          return {
            width: 2,
            height: 2,
            confidence: new Float32Array([1, 1, 1, 1]),
          };
        },
      ),
      now: () => 0,
    });

    const result = await provider.analyze(input, {
      threshold: 0.5,
      feather: 0,
    });
    expect(input.source.bytes).toEqual(original);
    expect([...result.layers[0]!.rgba.bytes]).toEqual([...original]);
    expect(result.source.sha256).toBe(hashBytes(original));
  });

  it("accepts a native low-resolution confidence mask and rejects unsafe dimensions or values", async () => {
    const resamplingProvider = createStudioLayerLiftLocalForegroundProvider({
      loadInference: async () => engine(
        new Float32Array([1]),
        async () => ({
          width: 1,
          height: 1,
          confidence: new Float32Array([1]),
        }),
      ),
      now: () => 0,
    });
    await expect(resamplingProvider.analyze(
      request(["character"]),
      { feather: 0 },
    )).resolves.toMatchObject({ status: "success" });

    for (const inferenceResult of [
      {
        width: 0,
        height: 1,
        confidence: new Float32Array(),
      },
      {
        width: 2,
        height: 2,
        confidence: new Float32Array([0, Number.NaN, 1, 0]),
      },
      {
        width: 2,
        height: 2,
        confidence: new Float32Array([0, -0.1, 1, 0]),
      },
      {
        width: 2,
        height: 2,
        confidence: new Float32Array([0, 1]),
      },
    ]) {
      const provider = createStudioLayerLiftLocalForegroundProvider({
        loadInference: async () => engine(
          inferenceResult.confidence,
          async () => inferenceResult,
        ),
        now: () => 0,
      });
      await expect(provider.analyze(request(["character"]))).rejects
        .toSatisfy((cause: unknown) => errorCode(cause) === "invalid-inference");
    }
  });

  it("fails closed before model loading for invalid requests, roles, and options", async () => {
    const loadInference = vi.fn(async () => engine());
    const provider = createStudioLayerLiftLocalForegroundProvider({
      loadInference,
    });
    const tampered = request(["character"]);
    tampered.source.bytes[0] ^= 0xff;

    await expect(provider.analyze(tampered)).rejects
      .toSatisfy((cause: unknown) => errorCode(cause) === "invalid-request");
    await expect(provider.analyze(request(["background"]))).rejects
      .toSatisfy(
        (cause: unknown) => errorCode(cause) === "unsupported-capability",
      );
    await expect(provider.analyze(request(["character"]), {
      threshold: Number.NaN,
    })).rejects
      .toSatisfy((cause: unknown) => errorCode(cause) === "invalid-options");
    await expect(provider.analyze(request(["character"]), {
      threshold: 0.02,
      feather: 0.1,
    })).rejects
      .toSatisfy((cause: unknown) => errorCode(cause) === "invalid-options");
    expect(loadInference).not.toHaveBeenCalled();
  });

  it("rejects an empty or fully transparent foreground without forging success", async () => {
    const provider = createStudioLayerLiftLocalForegroundProvider({
      loadInference: async () => engine(new Float32Array([0, 0, 0, 0])),
      now: () => 0,
    });
    await expect(provider.analyze(request(["character"]))).rejects
      .toSatisfy((cause: unknown) => errorCode(cause) === "empty-foreground");

    const transparent = request(["character"]);
    for (let index = 3; index < transparent.source.bytes.length; index += 4) {
      transparent.source.bytes[index] = 0;
    }
    transparent.source.sha256 = hashBytes(transparent.source.bytes);
    const visibleMaskProvider = createStudioLayerLiftLocalForegroundProvider({
      loadInference: async () => engine(new Float32Array([1, 1, 1, 1])),
      now: () => 0,
    });
    await expect(visibleMaskProvider.analyze(transparent)).rejects
      .toSatisfy((cause: unknown) => errorCode(cause) === "empty-foreground");
  });

  it("aborts before loading and releases an in-flight non-cooperative inference", async () => {
    const preAborted = new AbortController();
    preAborted.abort();
    const loadInference = vi.fn(async () => engine());
    const provider = createStudioLayerLiftLocalForegroundProvider({
      loadInference,
    });

    await expect(provider.analyze(
      request(["character"]),
      { signal: preAborted.signal },
    )).rejects.toMatchObject({ name: "AbortError", code: "aborted" });
    expect(loadInference).not.toHaveBeenCalled();

    const runningController = new AbortController();
    let engineSignal: AbortSignal | undefined;
    const runningProvider = createStudioLayerLiftLocalForegroundProvider({
      loadInference: async () => engine(
        undefined,
        async (input) => {
          engineSignal = input.signal;
          return new Promise(() => undefined);
        },
      ),
    });
    const pending = runningProvider.analyze(
      request(["character"]),
      { signal: runningController.signal },
    );
    await vi.waitFor(() => expect(engineSignal).toBeDefined());
    runningController.abort();

    await expect(pending).rejects
      .toMatchObject({ name: "AbortError", code: "aborted" });
    expect(engineSignal?.aborted).toBe(true);
  });

  it("times out and aborts a non-cooperative model without accepting late output", async () => {
    vi.useFakeTimers();
    let engineSignal: AbortSignal | undefined;
    const provider = createStudioLayerLiftLocalForegroundProvider({
      loadInference: async () => engine(
        undefined,
        async (input) => {
          engineSignal = input.signal;
          return new Promise(() => undefined);
        },
      ),
    });
    const pending = provider.analyze(
      request(["character"]),
      { timeoutMs: 25 },
    );
    const rejection = expect(pending).rejects
      .toMatchObject({ name: "TimeoutError", code: "timeout" });
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(engineSignal?.aborted).toBe(true);
  });

  it("binds output-affecting options into providerVersion and receipt SHA", async () => {
    const createProvider = () =>
      createStudioLayerLiftLocalForegroundProvider({
        loadInference: async () => engine(),
        now: () => 0,
      });
    const first = await createProvider().analyze(
      request(["character"]),
      { threshold: 0.5, feather: 0 },
    );
    const replay = await createProvider().analyze(
      request(["character"]),
      { threshold: 0.5, feather: 0 },
    );
    const changed = await createProvider().analyze(
      request(["character"]),
      { threshold: 0.7, feather: 0 },
    );

    expect(replay.receipt.providerVersion)
      .toBe(first.receipt.providerVersion);
    expect(replay.receipt.receiptSha256).toBe(first.receipt.receiptSha256);
    expect(changed.receipt.providerVersion)
      .not.toBe(first.receipt.providerVersion);
    expect(changed.receipt.receiptSha256)
      .not.toBe(first.receipt.receiptSha256);
  });

  it("keeps a valid maximum-length request ID inside the layer identifier budget", async () => {
    const longRequest = request(["character"]);
    longRequest.requestId = `r${"a".repeat(159)}`;
    const provider = createStudioLayerLiftLocalForegroundProvider({
      loadInference: async () => engine(),
      now: () => 0,
    });

    const result = await provider.analyze(longRequest, { feather: 0 });
    expect(result.requestId).toBe(longRequest.requestId);
    expect(result.layers[0]!.layerId).toMatch(
      /^person-character-foreground:[0-9a-f]{64}$/u,
    );
    expect(result.layers[0]!.layerId.length).toBeLessThanOrEqual(160);
  });

  it("re-admits an artist-corrected mask without mutating the model result", async () => {
    const input = request(["character"]);
    const provider = createStudioLayerLiftLocalForegroundProvider({
      loadInference: async () => engine(),
      now: () => 0,
    });
    const modelResult = await provider.analyze(input, { feather: 0 });
    const originalMask = new Uint8Array(modelResult.layers[0]!.mask.bytes);

    const corrected = applyStudioLayerLiftLocalForegroundCorrection({
      request: input,
      providerResult: modelResult,
      mask: new Uint8Array([255, 0, 255, 0]),
    });

    expect(isStudioSceneLayerLiftTrustedSuccess(corrected)).toBe(true);
    expect([...corrected.layers[0]!.mask.bytes]).toEqual([255, 0, 255, 0]);
    expect([...corrected.layers[0]!.rgba.bytes]).toEqual([
      10, 20, 30, 255,
      40, 50, 60, 0,
      70, 80, 90, 255,
      100, 110, 120, 0,
    ]);
    expect(corrected.receipt.providerVersion).toMatch(/^manual\.[0-9a-f]{32}$/u);
    expect(corrected.receipt.receiptSha256)
      .not.toBe(modelResult.receipt.receiptSha256);
    expect([...modelResult.layers[0]!.mask.bytes]).toEqual([...originalMask]);
  });

  it("rejects empty or detached user-correction masks", async () => {
    const input = request(["character"]);
    const provider = createStudioLayerLiftLocalForegroundProvider({
      loadInference: async () => engine(),
      now: () => 0,
    });
    const modelResult = await provider.analyze(input, { feather: 0 });

    expect(() => applyStudioLayerLiftLocalForegroundCorrection({
      request: input,
      providerResult: modelResult,
      mask: new Uint8Array(4),
    })).toThrowError(StudioLayerLiftLocalForegroundProviderError);

    const backing = new Uint8Array([9, 255, 0, 255, 0, 9]);
    expect(() => applyStudioLayerLiftLocalForegroundCorrection({
      request: input,
      providerResult: modelResult,
      mask: backing.subarray(1, 5) as Uint8Array<ArrayBuffer>,
    })).toThrowError(StudioLayerLiftLocalForegroundProviderError);
  });

  it("does not grant identity trust to a structural clone or hand-built forgery", async () => {
    const provider = createStudioLayerLiftLocalForegroundProvider({
      loadInference: async () => engine(),
      now: () => 0,
    });
    const result = await provider.analyze(
      request(["character"]),
      { feather: 0 },
    );
    const clone = structuredClone(result);
    const forgery = {
      ...result,
      layers: result.layers,
    };

    expect(isStudioSceneLayerLiftTrustedSuccess(result)).toBe(true);
    expect(isStudioSceneLayerLiftTrustedSuccess(clone)).toBe(false);
    expect(isStudioSceneLayerLiftTrustedSuccess(forgery)).toBe(false);

    const reparsed = parseStudioSceneLayerLiftResult(clone);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok || reparsed.value.status !== "success") return;
    expect(isStudioSceneLayerLiftTrustedSuccess(reparsed.value)).toBe(true);
    clone.layers[0]!.mask.bytes[0] ^= 0xff;
    expect(reparsed.value.layers[0]!.mask.bytes[0])
      .toBe(result.layers[0]!.mask.bytes[0]);
  });

  it("sanitizes provider failures and rejects malformed model identities", async () => {
    const failureProvider = createStudioLayerLiftLocalForegroundProvider({
      loadInference: async () => engine(
        undefined,
        async () => {
          throw new Error("secret provider implementation detail");
        },
      ),
    });
    await expect(failureProvider.analyze(request(["character"]))).rejects
      .toMatchObject({
        code: "inference-failed",
        detail: "inference.run",
      });

    const invalidIdentityProvider =
      createStudioLayerLiftLocalForegroundProvider({
        loadInference: async () => ({
          ...engine(),
          model: {
            ...engine().model,
            modelId: "../hostile model",
          },
        }),
      });
    await expect(
      invalidIdentityProvider.analyze(request(["character"])),
    ).rejects.toSatisfy(
      (cause: unknown) => errorCode(cause) === "invalid-model-identity",
    );
  });
});
