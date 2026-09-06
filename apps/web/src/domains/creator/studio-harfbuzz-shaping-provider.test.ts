import { describe, expect, it, vi } from "vitest";

import {
  createStudioHarfBuzzShapingProvider,
  STUDIO_HARFBUZZ_SHAPING_BUDGETS,
  StudioHarfBuzzProviderError,
  type StudioHarfBuzzFeature,
  type StudioHarfBuzzRuntime,
  type StudioHarfBuzzRuntimeGlyph,
} from "./studio-harfbuzz-shaping-provider";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fakeRuntime(
  glyphs: readonly StudioHarfBuzzRuntimeGlyph[] = [
    {
      codepoint: 501,
      cluster: 0,
      xAdvance: 0,
      yAdvance: -1000,
      xOffset: 500,
      yOffset: -880,
      flags: 0,
    },
    {
      codepoint: 502,
      cluster: 1,
      xAdvance: 0,
      yAdvance: -1000,
      xOffset: 500,
      yOffset: -880,
      flags: 1,
    },
    {
      codepoint: 700,
      cluster: 2,
      xAdvance: 0,
      yAdvance: -1000,
      xOffset: 500,
      yOffset: -880,
      flags: 0,
    },
  ],
) {
  const events: string[] = [];
  const receivedFonts: number[][] = [];
  const segmentMetadata: Record<string, unknown> = {};
  let handleSequence = 0;
  const handle = (kind: string) => ({ kind, id: ++handleSequence });
  const runtime: StudioHarfBuzzRuntime = {
    version: "fake-harfbuzz-11.0.0",
    createBlob: vi.fn((bytes: ArrayBuffer) => {
      events.push("create:blob");
      receivedFonts.push([...new Uint8Array(bytes)]);
      return handle("blob");
    }),
    destroyBlob: vi.fn(() => events.push("destroy:blob")),
    createFace: vi.fn((_blob, faceIndex) => {
      events.push(`create:face:${faceIndex}`);
      return handle("face");
    }),
    destroyFace: vi.fn(() => events.push("destroy:face")),
    getUnitsPerEm: vi.fn(() => 1000),
    createFont: vi.fn(() => {
      events.push("create:font");
      return handle("font");
    }),
    destroyFont: vi.fn(() => events.push("destroy:font")),
    setFontScale: vi.fn((_font, xScale, yScale) => {
      segmentMetadata.scale = [xScale, yScale];
    }),
    createBuffer: vi.fn(() => {
      events.push("create:buffer");
      return handle("buffer");
    }),
    destroyBuffer: vi.fn(() => events.push("destroy:buffer")),
    addText: vi.fn((_buffer, text) => {
      segmentMetadata.text = text;
    }),
    setDirection: vi.fn((_buffer, direction) => {
      segmentMetadata.direction = direction;
    }),
    setScript: vi.fn((_buffer, script) => {
      segmentMetadata.script = script;
    }),
    setLanguage: vi.fn((_buffer, language) => {
      segmentMetadata.language = language;
    }),
    setMonotoneGraphemeClusters: vi.fn(() => {
      segmentMetadata.clusterLevel = "monotone-graphemes";
    }),
    shape: vi.fn(
      (
        _font: unknown,
        _buffer: unknown,
        features: readonly Readonly<Required<StudioHarfBuzzFeature>>[],
      ) => {
        segmentMetadata.features = features.map((feature) => ({ ...feature }));
        events.push("shape");
      },
    ),
    getGlyphs: vi.fn(() => glyphs),
    destroy: vi.fn(() => {
      events.push("destroy:runtime");
    }),
  };
  return {
    runtime,
    events,
    receivedFonts,
    segmentMetadata,
  };
}

function request(fontBytes: ArrayBuffer | ArrayBufferView = Uint8Array.of(1, 2, 3)) {
  return {
    fontBytes,
    text: "한글가",
    faceIndex: 0,
    direction: "ttb" as const,
    script: "Hang",
    language: "ko-KR",
    features: [
      { tag: "vert", value: 1 },
      { tag: "kern", value: 0, start: 1, end: 4 },
    ],
  };
}

describe("Studio HarfBuzz shaping provider", () => {
  it("rejects accessor-backed font bytes without invoking them or loading WASM", async () => {
    const getter = vi.fn(() => {
      throw new Error("must not run");
    });
    const load = vi.fn(() => fakeRuntime().runtime);
    const provider = createStudioHarfBuzzShapingProvider({ runtimeLoader: load });
    const candidate = { ...request() } as Record<string, unknown>;
    Object.defineProperty(candidate, "fontBytes", {
      enumerable: true,
      get: getter,
    });

    await expect(provider.shape(candidate as never)).rejects.toMatchObject({
      code: "invalid-request",
    });
    expect(getter).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("rejects accessor-backed feature slots without invoking them", async () => {
    const getter = vi.fn(() => ({ tag: "kern", value: 1 }));
    const features: unknown[] = [];
    Object.defineProperty(features, "0", {
      enumerable: true,
      configurable: true,
      get: getter,
    });
    features.length = 1;
    const load = vi.fn(() => fakeRuntime().runtime);
    const provider = createStudioHarfBuzzShapingProvider({ runtimeLoader: load });
    await expect(provider.shape({
      ...request(),
      features: features as never,
    })).rejects.toMatchObject({ code: "invalid-request" });
    expect(getter).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("stays lazy, detaches an exact font view, and emits deterministic vertical Hangul metadata", async () => {
    const fake = fakeRuntime();
    const load = vi.fn(async () => fake.runtime);
    const provider = createStudioHarfBuzzShapingProvider({
      runtimeLoader: load,
    });
    expect(load).not.toHaveBeenCalled();

    const backing = Uint8Array.of(99, 1, 2, 3, 88);
    const pending = provider.shape(request(backing.subarray(1, 4)));
    backing.fill(7);
    const receipt = await pending;

    expect(load).toHaveBeenCalledTimes(1);
    expect(fake.receivedFonts).toEqual([[1, 2, 3]]);
    expect(fake.segmentMetadata).toEqual({
      scale: [1000, 1000],
      text: "한글가",
      clusterLevel: "monotone-graphemes",
      direction: "ttb",
      script: "Hang",
      language: "ko-KR",
      features: [
        { tag: "vert", value: 1, start: 0, end: 0xffff_ffff },
        { tag: "kern", value: 0, start: 1, end: 4 },
      ],
    });
    expect(receipt).toMatchObject({
      kind: "studio-harfbuzz-shape-receipt",
      revision: 1,
      providerId: "harfbuzz-wasm",
      runtimeVersion: "fake-harfbuzz-11.0.0",
      direction: "ttb",
      script: "Hang",
      language: "ko-KR",
      unitsPerEm: 1000,
      xScale: 1000,
      yScale: 1000,
      textCodeUnits: 4,
      fontByteLength: 3,
      totals: { xAdvance: 0, yAdvance: -3000 },
    });
    expect(receipt.glyphs).toEqual([
      {
        glyphId: 501,
        cluster: 0,
        xAdvance: 0,
        yAdvance: -1000,
        xOffset: 500,
        yOffset: -880,
        flags: 0,
      },
      {
        glyphId: 502,
        cluster: 1,
        xAdvance: 0,
        yAdvance: -1000,
        xOffset: 500,
        yOffset: -880,
        flags: 1,
      },
      {
        glyphId: 700,
        cluster: 2,
        xAdvance: 0,
        yAdvance: -1000,
        xOffset: 500,
        yOffset: -880,
        flags: 0,
      },
    ]);
    expect(receipt.requestHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(receipt.fontHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(receipt.glyphHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(structuredClone(receipt)).toEqual(receipt);
    expect(fake.events.slice(-4)).toEqual([
      "destroy:buffer",
      "destroy:font",
      "destroy:face",
      "destroy:blob",
    ]);
  });

  it("returns the same hashes and glyph receipt for the same canonical request", async () => {
    const fake = fakeRuntime();
    const provider = createStudioHarfBuzzShapingProvider({
      runtimeLoader: () => fake.runtime,
    });
    const first = await provider.shape(request());
    const second = await provider.shape(request());
    expect(second).toEqual(first);
  });

  it("destroys every created handle in reverse order when shaping throws", async () => {
    const fake = fakeRuntime();
    vi.mocked(fake.runtime.shape).mockImplementationOnce(() => {
      fake.events.push("shape:failed");
      throw new Error("fake shaping failure");
    });
    const provider = createStudioHarfBuzzShapingProvider({
      runtimeLoader: () => fake.runtime,
    });

    await expect(provider.shape(request())).rejects.toMatchObject({
      name: "StudioHarfBuzzProviderError",
      code: "runtime-failed",
    });
    expect(fake.events.slice(-5)).toEqual([
      "shape:failed",
      "destroy:buffer",
      "destroy:font",
      "destroy:face",
      "destroy:blob",
    ]);
  });

  it("rejects malformed and oversized input before initializing WASM", async () => {
    const fake = fakeRuntime();
    const load = vi.fn(() => fake.runtime);
    const provider = createStudioHarfBuzzShapingProvider({
      runtimeLoader: load,
    });

    await expect(
      provider.shape({ ...request(), script: "Hangul" }),
    ).rejects.toBeInstanceOf(StudioHarfBuzzProviderError);
    await expect(
      provider.shape({
        ...request(),
        text: "가".repeat(
          STUDIO_HARFBUZZ_SHAPING_BUDGETS.maxTextCodeUnits + 1,
        ),
      }),
    ).rejects.toMatchObject({ code: "budget-exceeded" });
    await expect(
      provider.shape({
        ...request(),
        features: Array.from(
          { length: STUDIO_HARFBUZZ_SHAPING_BUDGETS.maxFeatures + 1 },
          () => ({ tag: "kern", value: 1 }),
        ),
      }),
    ).rejects.toMatchObject({ code: "budget-exceeded" });
    expect(load).not.toHaveBeenCalled();
  });

  it("enforces backpressure and destroys the loaded runtime exactly once", async () => {
    const fake = fakeRuntime();
    const runtimeGate = deferred<StudioHarfBuzzRuntime>();
    const provider = createStudioHarfBuzzShapingProvider({
      runtimeLoader: () => runtimeGate.promise,
      maxConcurrentShapes: 1,
    });
    const first = provider.shape(request());
    await expect(provider.shape(request())).rejects.toMatchObject({
      code: "backpressure",
    });
    runtimeGate.resolve(fake.runtime);
    await first;

    await Promise.all([provider.destroy(), provider.destroy()]);
    expect(fake.runtime.destroy).toHaveBeenCalledTimes(1);
    expect(provider.snapshot()).toEqual({
      state: "destroyed",
      runtimeLoaded: false,
      activeShapes: 0,
    });
    await expect(provider.shape(request())).rejects.toMatchObject({
      code: "disposed",
    });
  });

  it("fails closed for invalid glyph clusters and metrics while still cleaning up", async () => {
    const fake = fakeRuntime([
      {
        codepoint: 12,
        cluster: 99,
        xAdvance: Number.POSITIVE_INFINITY,
      },
    ]);
    const provider = createStudioHarfBuzzShapingProvider({
      runtimeLoader: () => fake.runtime,
    });
    await expect(provider.shape(request())).rejects.toMatchObject({
      code: "invalid-runtime-output",
    });
    expect(fake.events.slice(-4)).toEqual([
      "destroy:buffer",
      "destroy:font",
      "destroy:face",
      "destroy:blob",
    ]);
  });
});
