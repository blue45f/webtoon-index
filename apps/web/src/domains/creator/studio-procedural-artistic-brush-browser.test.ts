import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PNG_ENCODE_WATCHDOG_MS,
  encodeStudioProceduralArtisticBrushPngDataUrl,
  type StudioProceduralArtisticBrushBrowserBlob,
  type StudioProceduralArtisticBrushBrowserCanvas,
  type StudioProceduralArtisticBrushBrowserEnvironment,
  type StudioProceduralArtisticBrushBrowserFileReader,
  type StudioProceduralArtisticBrushBrowserImageData,
} from "./studio-procedural-artistic-brush-browser";
import {
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_CAPABILITIES,
  type StudioProceduralArtisticBrushArtifact,
} from "./studio-procedural-artistic-brush-provider";

const PNG_PREFIX = "data:image/png;base64,";
const HASH_B = `sha256:${"b".repeat(64)}` as const;

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value >>> 24;
  bytes[offset + 1] = value >>> 16;
  bytes[offset + 2] = value >>> 8;
  bytes[offset + 3] = value;
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeUint32(bytes, 8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  writeUint32(bytes, 16, width);
  writeUint32(bytes, 20, height);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}

function pngWithInvalidIhdrLength(width: number, height: number): Uint8Array {
  const bytes = pngHeader(width, height);
  writeUint32(bytes, 8, 12);
  return bytes;
}

function dataUrl(bytes: Uint8Array): `data:image/png;base64,${string}` {
  return `${PNG_PREFIX}${Buffer.from(bytes).toString("base64")}`;
}

function sourceArtifact(
  pixels = Uint8ClampedArray.of(
    255, 0, 0, 255,
    0, 128, 255, 192,
  ),
  width = 2,
  height = 1,
): StudioProceduralArtisticBrushArtifact {
  const pixelHash = `sha256:${createHash("sha256")
    .update(new Uint8Array(
      pixels.buffer,
      pixels.byteOffset,
      pixels.byteLength,
    ))
    .digest("hex")}` as const;
  return {
    kind: "studio-procedural-artistic-brush/artifact",
    version: 1,
    width,
    height,
    encoding: "rgba8-unorm",
    colorSpace: "srgb",
    alpha: "straight",
    pixels,
    receipt: {
      kind: "studio-procedural-artistic-brush/receipt",
      version: 1,
      requestSequence: 7,
      engineEpoch: 3,
      strokeId: "stroke-browser-bridge",
      seed: 42,
      technique: "flow-field",
      presetId: "flow-default",
      width,
      height,
      outputBytes: pixels.byteLength,
      inputFingerprint: HASH_B,
      pixelHash,
      replayFingerprint: HASH_B,
      adapter: {
        id: "p5-brush-standalone",
        version: "2.2.1",
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
      capabilitiesUsed: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_CAPABILITIES,
      complete: true,
    },
  };
}

interface HarnessOptions {
  readonly png?: Uint8Array;
  readonly blob?: StudioProceduralArtisticBrushBrowserBlob | null;
  readonly dataUrl?: string | ArrayBuffer | null;
  readonly contextAvailable?: boolean;
  readonly mutatePrivatePixels?: boolean;
  readonly imageDataMode?: "valid" | "missing" | "copied";
  readonly readerMode?: "load" | "error" | "abort" | "idle";
  readonly canvasMode?: "valid" | "missing" | "wrong-size" | "throw";
  readonly toBlobMode?: "callback" | "manual" | "throw" | "idle";
}

function harness(
  width = 2,
  height = 1,
  options: HarnessOptions = {},
): Readonly<{
  environment: StudioProceduralArtisticBrushBrowserEnvironment;
  createCanvas: ReturnType<typeof vi.fn>;
  createImageData: ReturnType<typeof vi.fn>;
  putImageData: ReturnType<typeof vi.fn>;
  reader: StudioProceduralArtisticBrushBrowserFileReader;
  imageDataInputs: Uint8ClampedArray[];
  canvases: StudioProceduralArtisticBrushBrowserCanvas[];
  toBlobCallbacks: Array<() => void>;
  digestSha256: ReturnType<typeof vi.fn>;
}> {
  const png = options.png ?? pngHeader(width, height);
  const blob = options.blob === undefined
    ? { size: png.byteLength, type: "image/png" }
    : options.blob;
  const readerResult = options.dataUrl === undefined
    ? dataUrl(png)
    : options.dataUrl;
  const imageDataInputs: Uint8ClampedArray[] = [];
  const canvases: StudioProceduralArtisticBrushBrowserCanvas[] = [];
  const toBlobCallbacks: Array<() => void> = [];
  const putImageData = vi.fn(
    (imageData: StudioProceduralArtisticBrushBrowserImageData) => {
      if (options.mutatePrivatePixels) imageData.data[0] ^= 0xff;
    },
  );
  const createCanvas = vi.fn((requestedWidth: number, requestedHeight: number) => {
    if (options.canvasMode === "missing") return null;
    if (options.canvasMode === "throw") throw new Error("canvas failure");
    const canvas: StudioProceduralArtisticBrushBrowserCanvas = {
      width:
        options.canvasMode === "wrong-size"
          ? requestedWidth + 1
          : requestedWidth,
      height: requestedHeight,
      getContext: () => (
        options.contextAvailable === false
          ? null
          : { putImageData }
      ),
      toBlob: (
        callback: (
          value: StudioProceduralArtisticBrushBrowserBlob | null,
        ) => void,
      ) => {
        if (options.toBlobMode === "throw") {
          throw new Error("encode failure");
        }
        if (options.toBlobMode === "manual") {
          toBlobCallbacks.push(() => callback(blob));
        } else if (options.toBlobMode !== "idle") {
          queueMicrotask(() => callback(blob));
        }
      },
    };
    canvases.push(canvas);
    return canvas;
  });
  const createImageData = vi.fn(
    (
      pixels: Uint8ClampedArray,
      requestedWidth: number,
      requestedHeight: number,
    ) => {
      imageDataInputs.push(pixels);
      if (options.imageDataMode === "missing") return null;
      return {
        data:
          options.imageDataMode === "copied"
            ? new Uint8ClampedArray(pixels)
            : pixels,
        width: requestedWidth,
        height: requestedHeight,
      };
    },
  );
  const reader: StudioProceduralArtisticBrushBrowserFileReader = {
    result: null,
    error: null,
    onload: null,
    onerror: null,
    onabort: null,
    readAsDataURL: vi.fn(function readAsDataUrl() {
      if (options.readerMode === "idle") return;
      queueMicrotask(() => {
        if (options.readerMode === "error") {
          reader.error = new Error("read failed");
          reader.onerror?.();
        } else if (options.readerMode === "abort") {
          reader.onabort?.();
        } else {
          reader.result = readerResult;
          reader.onload?.();
        }
      });
    }),
    abort: vi.fn(() => reader.onabort?.()),
  };
  const digestSha256 = vi.fn(async (bytes: Uint8Array<ArrayBuffer>) => (
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const
  ));
  return Object.freeze({
    environment: {
      createCanvas,
      createImageData,
      isBlob: (
        value: unknown,
      ): value is StudioProceduralArtisticBrushBrowserBlob => (
        typeof value === "object"
        && value !== null
        && "size" in value
        && "type" in value
      ),
      createFileReader: () => reader,
      decodeBase64: (value) => Uint8Array.from(
        Buffer.from(value, "base64"),
      ),
      digestSha256,
    },
    createCanvas,
    createImageData,
    putImageData,
    reader,
    imageDataInputs,
    canvases,
    toBlobCallbacks,
    digestSha256,
  });
}

async function flushMicrotasks(iterations = 20): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

describe("studio procedural artistic brush browser bridge", () => {
  it("encodes a verified private RGBA copy into a validated lossless PNG data URL", async () => {
    const pixels = Uint8ClampedArray.of(
      255, 0, 0, 255,
      0, 128, 255, 192,
    );
    const original = Uint8ClampedArray.from(pixels);
    const sourceBuffer = pixels.buffer;
    const runtime = harness();

    const result = await encodeStudioProceduralArtisticBrushPngDataUrl(
      sourceArtifact(pixels),
      { environment: runtime.environment },
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error(result.reason);
    expect(result.consumed).toBe(false);
    expect(result.artifact).toMatchObject({
      kind:
        "studio-procedural-artistic-brush-browser/png-data-url-artifact",
      version: 1,
      width: 2,
      height: 1,
      mediaType: "image/png",
      pngByteLength: 32,
      source: {
        providerVersion: 1,
        requestSequence: 7,
        engineEpoch: 3,
        strokeId: "stroke-browser-bridge",
        pixelHash: sourceArtifact(pixels).receipt.pixelHash,
        replayFingerprint: HASH_B,
      },
      authority: {
        mainScene: false,
        document: false,
        history: false,
        persistence: false,
        output: "lossless-png-insertion-suggestion",
      },
    });
    expect(result.artifact.dataUrl).toBe(dataUrl(pngHeader(2, 1)));
    expect(result.artifact.dataUrlCodeUnits).toBe(
      result.artifact.dataUrl.length,
    );
    expect(Object.isFrozen(result.artifact)).toBe(true);
    expect(Object.isFrozen(result.artifact.source)).toBe(true);
    expect(Object.isFrozen(result.artifact.authority)).toBe(true);

    expect(runtime.createCanvas).toHaveBeenCalledWith(2, 1);
    expect(runtime.createImageData).toHaveBeenCalledOnce();
    expect(runtime.putImageData).toHaveBeenCalledOnce();
    expect(runtime.imageDataInputs[0]).not.toBe(pixels);
    expect(runtime.imageDataInputs[0]).toEqual(pixels);
    expect(pixels).toEqual(original);
    expect(pixels.buffer).toBe(sourceBuffer);
    expect(pixels.buffer.byteLength).toBe(original.byteLength);
    expect(runtime.canvases[0]).toMatchObject({ width: 1, height: 1 });
  });

  it("uses only the asynchronous digest primitive for a 1024px raster", async () => {
    const width = 1_024;
    const height = 1_024;
    const pixels = new Uint8ClampedArray(width * height * 4);
    pixels.fill(0x7f);
    const runtime = harness(width, height);

    await expect(
      encodeStudioProceduralArtisticBrushPngDataUrl(
        sourceArtifact(pixels, width, height),
        { environment: runtime.environment },
      ),
    ).resolves.toMatchObject({
      status: "completed",
      artifact: { width, height },
    });

    expect(runtime.digestSha256).toHaveBeenCalledTimes(2);
    expect(runtime.digestSha256.mock.calls.map(
      ([bytes]) => (bytes as Uint8Array).byteLength,
    )).toEqual([width * height * 4, width * height * 4]);
  });

  it("rejects malformed dimensions, RGBA lengths and receipt hash before canvas work", async () => {
    const runtime = harness();
    const wrongLength = sourceArtifact(
      Uint8ClampedArray.of(1, 2, 3, 4),
      2,
      1,
    );
    await expect(
      encodeStudioProceduralArtisticBrushPngDataUrl(wrongLength, {
        environment: runtime.environment,
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid-artifact",
    });

    const tampered = sourceArtifact();
    tampered.pixels[0] ^= 0xff;
    await expect(
      encodeStudioProceduralArtisticBrushPngDataUrl(tampered, {
        environment: runtime.environment,
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      reason: "pixel-hash-mismatch",
    });

    await expect(
      encodeStudioProceduralArtisticBrushPngDataUrl({
        ...sourceArtifact(),
        width: 0,
      }, {
        environment: runtime.environment,
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid-artifact",
    });
    expect(runtime.createCanvas).not.toHaveBeenCalled();
  });

  it("enforces configurable raster and encoded-memory budgets before allocation", async () => {
    const runtime = harness();
    await expect(
      encodeStudioProceduralArtisticBrushPngDataUrl(sourceArtifact(), {
        environment: runtime.environment,
        limits: {
          maxWidth: 2,
          maxHeight: 1,
          maxPixels: 1,
          maxRgbaBytes: 8,
          maxPngBlobBytes: 32,
          maxDataUrlCodeUnits: 128,
        },
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      reason: "budget-exceeded",
    });
    expect(runtime.createImageData).not.toHaveBeenCalled();
    expect(runtime.createCanvas).not.toHaveBeenCalled();
  });

  it.each([
    ["canvas", { canvasMode: "missing" }, "canvas-unavailable"],
    ["wrong canvas size", { canvasMode: "wrong-size" }, "canvas-unavailable"],
    ["2D context", { contextAvailable: false }, "context-unavailable"],
    ["ImageData", { imageDataMode: "missing" }, "image-data-unavailable"],
    ["aliased ImageData", { imageDataMode: "copied" }, "image-data-unavailable"],
  ] as const)(
    "fails closed when %s is unavailable or violates the private buffer contract",
    async (_label, configuration, reason) => {
      const runtime = harness(2, 1, configuration);
      await expect(
        encodeStudioProceduralArtisticBrushPngDataUrl(sourceArtifact(), {
          environment: runtime.environment,
        }),
      ).resolves.toMatchObject({
        status: "rejected",
        reason,
        consumed: false,
      });
    },
  );

  it("fails closed when Blob or FileReader is unavailable", async () => {
    const withoutBlob = harness();
    await expect(
      encodeStudioProceduralArtisticBrushPngDataUrl(sourceArtifact(), {
        environment: {
          ...withoutBlob.environment,
          isBlob: null,
        },
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      reason: "blob-unavailable",
    });

    const withoutReader = harness();
    await expect(
      encodeStudioProceduralArtisticBrushPngDataUrl(sourceArtifact(), {
        environment: {
          ...withoutReader.environment,
          createFileReader: null,
        },
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      reason: "file-reader-unavailable",
    });
  });

  it("fails closed when asynchronous Web Crypto hashing is unavailable", async () => {
    const runtime = harness();
    await expect(
      encodeStudioProceduralArtisticBrushPngDataUrl(sourceArtifact(), {
        environment: {
          ...runtime.environment,
          digestSha256: null,
        },
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      reason: "digest-unavailable",
      consumed: false,
    });
    expect(runtime.createCanvas).not.toHaveBeenCalled();
  });

  it.each([
    [
      "null Blob",
      { blob: null },
      {},
      "png-encode-failed",
    ],
    [
      "wrong Blob MIME",
      { blob: { size: 32, type: "image/jpeg" } },
      {},
      "invalid-png-result",
    ],
    [
      "oversized Blob",
      { blob: { size: 33, type: "image/png" } },
      { maxPngBlobBytes: 32 },
      "invalid-png-result",
    ],
    [
      "FileReader error",
      { readerMode: "error" },
      {},
      "png-read-failed",
    ],
    [
      "non-string FileReader result",
      { dataUrl: new ArrayBuffer(8) },
      {},
      "png-read-failed",
    ],
  ] as const)(
    "rejects %s",
    async (_label, configuration, limits, reason) => {
      const runtime = harness(
        2,
        1,
        configuration as HarnessOptions,
      );
      await expect(
        encodeStudioProceduralArtisticBrushPngDataUrl(sourceArtifact(), {
          environment: runtime.environment,
          limits,
        }),
      ).resolves.toMatchObject({
        status: "rejected",
        reason,
      });
    },
  );

  it.each([
    ["wrong media prefix", "data:image/jpeg;base64,AAAA"],
    ["invalid base64", `${PNG_PREFIX}%%%=`],
    ["wrong PNG signature", dataUrl(new Uint8Array(32))],
    ["wrong IHDR length", dataUrl(pngWithInvalidIhdrLength(2, 1))],
    ["wrong IHDR dimensions", dataUrl(pngHeader(9, 9))],
  ])("rejects an invalid PNG data URL: %s", async (_label, invalidDataUrl) => {
    const runtime = harness(2, 1, {
      dataUrl: invalidDataUrl,
    });
    await expect(
      encodeStudioProceduralArtisticBrushPngDataUrl(sourceArtifact(), {
        environment: runtime.environment,
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid-png-result",
    });
  });

  it("rejects mutation of the private ImageData copy without touching caller pixels", async () => {
    const pixels = Uint8ClampedArray.of(
      255, 0, 0, 255,
      0, 128, 255, 192,
    );
    const original = Uint8ClampedArray.from(pixels);
    const runtime = harness(2, 1, { mutatePrivatePixels: true });

    await expect(
      encodeStudioProceduralArtisticBrushPngDataUrl(sourceArtifact(pixels), {
        environment: runtime.environment,
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      reason: "pixel-copy-mutated",
    });
    expect(pixels).toEqual(original);
    expect(pixels.buffer.byteLength).toBe(original.byteLength);
  });

  it("keeps an aborted toBlob owner and its backing until the callback settles", async () => {
    const before = new AbortController();
    before.abort("before");
    const preflightRuntime = harness();
    await expect(
      encodeStudioProceduralArtisticBrushPngDataUrl(sourceArtifact(), {
        environment: preflightRuntime.environment,
        signal: before.signal,
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      reason: "aborted",
    });
    expect(preflightRuntime.createCanvas).not.toHaveBeenCalled();

    const during = new AbortController();
    const pendingRuntime = harness(2, 1, { toBlobMode: "manual" });
    const first = encodeStudioProceduralArtisticBrushPngDataUrl(
      sourceArtifact(),
      {
        environment: pendingRuntime.environment,
        signal: during.signal,
      },
    );
    await flushMicrotasks();
    expect(pendingRuntime.toBlobCallbacks).toHaveLength(1);
    expect(pendingRuntime.createCanvas).toHaveBeenCalledTimes(1);

    during.abort("during");
    let firstSettled = false;
    void first.then(() => {
      firstSettled = true;
    });
    await flushMicrotasks(2);
    expect(firstSettled).toBe(false);
    expect(pendingRuntime.canvases[0]).toMatchObject({
      width: 2,
      height: 1,
    });

    const second = encodeStudioProceduralArtisticBrushPngDataUrl(
      sourceArtifact(),
      { environment: pendingRuntime.environment },
    );
    await flushMicrotasks();
    expect(pendingRuntime.createCanvas).toHaveBeenCalledTimes(1);

    pendingRuntime.toBlobCallbacks.shift()?.();
    await expect(first).resolves.toMatchObject({
      status: "rejected",
      reason: "aborted",
    });
    await flushMicrotasks();
    expect(pendingRuntime.canvases[0]).toMatchObject({
      width: 1,
      height: 1,
    });
    expect(pendingRuntime.createCanvas).toHaveBeenCalledTimes(2);
    expect(pendingRuntime.toBlobCallbacks).toHaveLength(1);

    pendingRuntime.toBlobCallbacks.shift()?.();
    await expect(second).resolves.toMatchObject({ status: "completed" });
    expect(pendingRuntime.canvases[1]).toMatchObject({
      width: 1,
      height: 1,
    });
  });

  it("serializes PNG backing stores across independent environments", async () => {
    const firstRuntime = harness(2, 1, { toBlobMode: "manual" });
    const secondRuntime = harness(2, 1, { toBlobMode: "manual" });

    const first = encodeStudioProceduralArtisticBrushPngDataUrl(
      sourceArtifact(),
      { environment: firstRuntime.environment },
    );
    const second = encodeStudioProceduralArtisticBrushPngDataUrl(
      sourceArtifact(),
      { environment: secondRuntime.environment },
    );
    await flushMicrotasks();
    expect(firstRuntime.createCanvas).toHaveBeenCalledTimes(1);
    expect(firstRuntime.toBlobCallbacks).toHaveLength(1);
    expect(firstRuntime.createImageData).toHaveBeenCalledTimes(1);
    expect(secondRuntime.createCanvas).not.toHaveBeenCalled();
    expect(secondRuntime.createImageData).not.toHaveBeenCalled();
    expect(secondRuntime.digestSha256).not.toHaveBeenCalled();

    firstRuntime.toBlobCallbacks.shift()?.();
    await expect(first).resolves.toMatchObject({ status: "completed" });
    await flushMicrotasks();
    expect(secondRuntime.createCanvas).toHaveBeenCalledTimes(1);
    expect(secondRuntime.toBlobCallbacks).toHaveLength(1);
    expect(secondRuntime.createImageData).toHaveBeenCalledTimes(1);

    secondRuntime.toBlobCallbacks.shift()?.();
    await expect(second).resolves.toMatchObject({ status: "completed" });
    expect(firstRuntime.canvases[0]).toMatchObject({ width: 1, height: 1 });
    expect(secondRuntime.canvases[0]).toMatchObject({ width: 1, height: 1 });
  });

  it("quarantines an abandoned encode until its late native callback settles", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const runtime = harness(2, 1, { toBlobMode: "manual" });
      const pending = encodeStudioProceduralArtisticBrushPngDataUrl(
        sourceArtifact(),
        {
          environment: runtime.environment,
          signal: controller.signal,
        },
      );
      await flushMicrotasks();
      expect(runtime.createCanvas).toHaveBeenCalledTimes(1);
      expect(runtime.toBlobCallbacks).toHaveLength(1);
      controller.abort("watchdog");

      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(
        STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PNG_ENCODE_WATCHDOG_MS - 1,
      );
      expect(settled).toBe(false);
      expect(runtime.canvases[0]).toMatchObject({ width: 2, height: 1 });

      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({
        status: "rejected",
        reason: "aborted",
      });
      expect(runtime.canvases[0]).toMatchObject({ width: 1, height: 1 });

      const blockedRuntime = harness();
      await expect(
        encodeStudioProceduralArtisticBrushPngDataUrl(sourceArtifact(), {
          environment: blockedRuntime.environment,
        }),
      ).resolves.toMatchObject({
        status: "rejected",
        reason: "png-encode-failed",
      });
      expect(blockedRuntime.createCanvas).not.toHaveBeenCalled();

      runtime.toBlobCallbacks.shift()?.();
      await flushMicrotasks();
      const recoveredRuntime = harness();
      await expect(
        encodeStudioProceduralArtisticBrushPngDataUrl(sourceArtifact(), {
          environment: recoveredRuntime.environment,
        }),
      ).resolves.toMatchObject({ status: "completed" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects malformed options and disabled base64 validation", async () => {
    const runtime = harness();
    await expect(
      encodeStudioProceduralArtisticBrushPngDataUrl(sourceArtifact(), {
        environment: {
          ...runtime.environment,
          decodeBase64: null,
        },
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid-png-result",
    });
    await expect(
      encodeStudioProceduralArtisticBrushPngDataUrl(
        sourceArtifact(),
        {
          environment: runtime.environment,
          legacyTransferPixels: true,
        } as never,
      ),
    ).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid-options",
    });
  });

  it("keeps the browser bridge non-authoritative and never transfers caller pixels", () => {
    const source = readFileSync(
      new URL("./studio-procedural-artistic-brush-browser.ts",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).toContain(
      "new Uint8ClampedArray(artifact.expectedRgbaBytes)",
    );
    expect(source).toContain("ownedPixels.set(artifact.artifact.pixels)");
    expect(source).toContain("privateCanvas.context.putImageData");
    expect(source).toContain('"image/png"');
    expect(source).toContain("reader.readAsDataURL(blob)");
    expect(source).toContain("normalized.pixelHash");
    expect(source).toContain('subtle.digest("SHA-256", ownedBytes)');
    expect(source).toContain("Math.ceil(blobByteLength / 3) * 4");
    expect(source).toContain('readonly mainScene: false');
    expect(source).toContain('readonly history: false');
    expect(source).not.toContain("sha256HexPortable");
    expect(source).not.toContain("index < payload.length");
    expect(source).not.toContain("value.slice(PNG_DATA_URL_PREFIX.length)");
    expect(source).not.toContain(".toDataURL(");
    expect(source).not.toContain("postMessage(");
    expect(source).not.toContain("structuredClone(");
    expect(source).not.toContain("transfer(");
  });
});
