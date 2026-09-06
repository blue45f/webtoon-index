import { Image, encodePng } from "image-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sha256HexPortable } from "../studio-sha256";

import {
  StudioBrushR8GrainHydrator,
  collectStudioBrushR8GrainSources,
  decodeStudioBrushR8GrainPng,
  projectStudioBrushR8GrainRenderElements,
} from "./studio-brush-r8-grain-hydrator";
import {
  hydrateStudioBrushR8GrainAsset,
  resetStudioBrushR8GrainRegistry,
  resolveStudioBrushR8GrainSampler,
} from "./studio-brush-r8-grain-runtime";

import type { StudioBrushR8TextureGrainSource } from "./studio-brush-r8-grain-asset-contract";
import type { DownloadedStudioWorkAsset } from "../studio-work-asset-client";

function sourceForPng(
  assetId: string,
  encoded: Uint8Array,
  decoded: Uint8Array,
  width: number,
  height: number,
  channel: "alpha" | "luminance",
): StudioBrushR8TextureGrainSource {
  return {
    kind: "r8-texture-v1",
    asset: {
      assetId,
      encodedSha256: `sha256:${sha256HexPortable(encoded)}`,
      decodedSha256: `sha256:${sha256HexPortable(decoded)}`,
      byteLength: encoded.byteLength,
      mediaType: "image/png",
      width,
      height,
      channel,
      encoding: "r8-unorm",
    },
  };
}

function drawWithSource(
  id: string,
  source: StudioBrushR8TextureGrainSource | null | Record<string, unknown>,
) {
  return {
    id,
    type: "draw",
    brushDynamics: {
      grain: { source },
    },
  };
}

function downloadedFor(
  source: StudioBrushR8TextureGrainSource,
  encoded: Uint8Array,
): DownloadedStudioWorkAsset {
  const blobBuffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(blobBuffer).set(encoded);
  return {
    manifest: {
      version: 1,
      assetId: source.asset.assetId,
      elementType: "image",
      mimeType: "image/png",
      byteSize: encoded.byteLength,
      sha256: sha256HexPortable(encoded),
      intrinsicImage: {
        width: source.asset.width,
        height: source.asset.height,
        decodedRgbaBytes: source.asset.width * source.asset.height * 4,
      },
      descriptor: {
        version: 1,
        element: {
          id: source.asset.assetId,
          type: "image",
          x: 0,
          y: 0,
          width: source.asset.width,
          height: source.asset.height,
          rotation: 0,
        },
      },
      updatedAt: "2026-07-29T00:00:00.000Z",
    },
    blob: new Blob([blobBuffer], { type: "image/png" }),
  };
}

function rgbaPng(
  width: number,
  height: number,
  values: readonly number[],
): Uint8Array {
  return encodePng(new Image(width, height, {
    colorModel: "RGBA",
    bitDepth: 8,
    data: Uint8Array.from(values),
  }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("studio brush R8 grain source collection", () => {
  it("collects canonical non-null draw sources once from only the current history authority", () => {
    const encoded = Uint8Array.of(1, 2, 3);
    const decoded = Uint8Array.of(40);
    const source = sourceForPng("paper-collect", encoded, decoded, 1, 1, "alpha");
    const stale = sourceForPng("paper-stale", encoded, decoded, 1, 1, "alpha");
    const currentPages = [{
      elements: [
        drawWithSource("draw-a", source),
        drawWithSource("draw-b", structuredClone(source)),
        drawWithSource("draw-null", null),
        { id: "image", type: "image", brushDynamics: { grain: { source: stale } } },
      ],
    }];
    const result = collectStudioBrushR8GrainSources({
      currentPages,
      history: [
        [{ elements: [drawWithSource("old", stale)] }],
        currentPages,
      ],
      historyIndex: 1,
      extraElements: [drawWithSource("master", source)],
    });
    expect(result).toEqual([source]);
  });

  it("clones only R8 draw references for a memo-safe hydration rerender", () => {
    const encoded = Uint8Array.of(1);
    const source = sourceForPng(
      "paper-projection",
      encoded,
      Uint8Array.of(90),
      1,
      1,
      "luminance",
    );
    const textured = drawWithSource("textured", source);
    const ordinary = { id: "ordinary", type: "draw" };
    const image = { id: "image", type: "image" };
    const projected = projectStudioBrushR8GrainRenderElements([
      textured,
      ordinary,
      image,
    ], 1);
    expect(projected[0]).not.toBe(textured);
    expect(projected[0]).toEqual(textured);
    expect(projected[1]).toBe(ordinary);
    expect(projected[2]).toBe(image);
  });
});

describe("studio brush R8 PNG decode", () => {
  it("extracts alpha and fixed integer BT.709 luminance through the real lazy image-js decoder", async () => {
    const encoded = rgbaPng(2, 1, [
      255, 0, 0, 40,
      0, 255, 0, 230,
    ]);
    const alpha = Uint8Array.of(40, 230);
    const luminance = Uint8Array.of(
      (54 * 255 + 128) >> 8,
      (183 * 255 + 128) >> 8,
    );
    await expect(decodeStudioBrushR8GrainPng(
      sourceForPng("paper-alpha", encoded, alpha, 2, 1, "alpha"),
      encoded,
    )).resolves.toEqual(alpha);
    await expect(decodeStudioBrushR8GrainPng(
      sourceForPng("paper-luminance", encoded, luminance, 2, 1, "luminance"),
      encoded,
    )).resolves.toEqual(luminance);
  });

  it("rejects missing alpha, non-8-bit, and dimension mismatches", async () => {
    const encoded = Uint8Array.of(1);
    const decoded = Uint8Array.of(1);
    const source = sourceForPng("paper-decode-reject", encoded, decoded, 1, 1, "alpha");
    await expect(decodeStudioBrushR8GrainPng(source, encoded, () => ({
      width: 1,
      height: 1,
      bitDepth: 8,
      colorModel: "RGB",
      components: 3,
      channels: 3,
      alpha: false,
      getValueByIndex: () => 1,
    }))).rejects.toThrow(/알파 채널/u);
    await expect(decodeStudioBrushR8GrainPng(source, encoded, () => ({
      width: 1,
      height: 1,
      bitDepth: 16,
      colorModel: "RGBA",
      components: 3,
      channels: 4,
      alpha: true,
      getValueByIndex: () => 1,
    }))).rejects.toThrow(/비트 깊이/u);
    await expect(decodeStudioBrushR8GrainPng(source, encoded, () => ({
      width: 2,
      height: 1,
      bitDepth: 8,
      colorModel: "RGBA",
      components: 3,
      channels: 4,
      alpha: true,
      getValueByIndex: () => 1,
    }))).rejects.toThrow(/고유 크기/u);
  });
});

describe("studio brush R8 grain hydrator lifecycle", () => {
  const hydrators: StudioBrushR8GrainHydrator[] = [];

  beforeEach(() => resetStudioBrushR8GrainRegistry());
  afterEach(() => {
    for (const hydrator of hydrators.splice(0)) hydrator.dispose();
    resetStudioBrushR8GrainRegistry();
  });

  it("deduplicates downloads, validates, hydrates, and notifies completion", async () => {
    const encoded = rgbaPng(1, 1, [10, 20, 30, 180]);
    const decoded = Uint8Array.of(180);
    const source = sourceForPng("paper-ready", encoded, decoded, 1, 1, "alpha");
    const download = vi.fn(async () => downloadedFor(source, encoded));
    let decodedInput: Uint8Array | null = null;
    let encodedInput: Uint8Array | null = null;
    const hydrator = new StudioBrushR8GrainHydrator({
      download,
      decodePng: (bytes) => {
        encodedInput = bytes;
        return {
          width: 1,
          height: 1,
          bitDepth: 8,
          colorModel: "RGBA",
          components: 3,
          channels: 4,
          alpha: true,
          getValueByIndex: (_index, channel) => channel === 3 ? 180 : 0,
        };
      },
      hydrate: (candidate, bytes) => {
        decodedInput = bytes as Uint8Array;
        return hydrateStudioBrushR8GrainAsset(candidate, bytes);
      },
    });
    hydrators.push(hydrator);
    const versions: number[] = [];
    hydrator.subscribe(() => versions.push(hydrator.getVersion()));

    hydrator.observe("work-ready", [source, structuredClone(source)]);
    await vi.waitFor(() => expect(hydrator.getSnapshot().status).toBe("ready"));

    expect(download).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledWith(
      "work-ready",
      { assetId: "paper-ready", elementType: "image" },
      expect.any(AbortSignal),
    );
    expect(resolveStudioBrushR8GrainSampler(source)).not.toBeNull();
    expect(hydrator.getSnapshot()).toMatchObject({
      observed: 1,
      pending: 0,
      ready: 1,
      unavailable: 0,
      errors: [],
      canRetry: false,
    });
    expect(versions.length).toBeGreaterThanOrEqual(2);
    expect(versions.at(-1)).toBe(hydrator.getSnapshot().version);
    expect(encodedInput).not.toBeNull();
    expect(decodedInput).not.toBeNull();
    expect([...encodedInput!]).toEqual(new Array(encoded.byteLength).fill(0));
    expect([...decodedInput!]).toEqual([0]);
  });

  it("keeps persisted PNG hydration within the configured concurrency bound", async () => {
    const encoded = rgbaPng(1, 1, [10, 20, 30, 180]);
    const decoded = Uint8Array.of(180);
    const sources = Array.from({ length: 5 }, (_, index) =>
      sourceForPng(`paper-bounded-${index}`, encoded, decoded, 1, 1, "alpha")
    );
    const sourceById = new Map(sources.map((source) => [source.asset.assetId, source]));
    const gate = deferred<void>();
    let active = 0;
    let maximumActive = 0;
    const download = vi.fn(async (
      _workId: string,
      reference: { assetId: string; elementType: "image" },
    ) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await gate.promise;
      active -= 1;
      return downloadedFor(sourceById.get(reference.assetId)!, encoded);
    });
    const hydrator = new StudioBrushR8GrainHydrator({
      download,
      maximumConcurrent: 2,
    });
    hydrators.push(hydrator);
    hydrator.observe("work-bounded", sources);
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    expect(maximumActive).toBe(2);
    gate.resolve();
    await vi.waitFor(() => expect(hydrator.getSnapshot().status).toBe("ready"));
    expect(download).toHaveBeenCalledTimes(5);
    expect(maximumActive).toBe(2);
  });

  it.each([
    {
      name: "manifest hash",
      patch: (asset: DownloadedStudioWorkAsset) => ({
        ...asset,
        manifest: { ...asset.manifest, sha256: "0".repeat(64) },
      }),
    },
    {
      name: "byte length",
      patch: (asset: DownloadedStudioWorkAsset) => ({
        ...asset,
        manifest: { ...asset.manifest, byteSize: asset.manifest.byteSize + 1 },
      }),
    },
    {
      name: "intrinsic dimensions",
      patch: (asset: DownloadedStudioWorkAsset) => ({
        ...asset,
        manifest: {
          ...asset.manifest,
          intrinsicImage: {
            ...asset.manifest.intrinsicImage!,
            width: asset.manifest.intrinsicImage!.width + 1,
          },
        },
      }),
    },
    {
      name: "content bytes",
      patch: (asset: DownloadedStudioWorkAsset) => ({
        ...asset,
        blob: new Blob([Uint8Array.from(
          new Uint8Array(asset.manifest.byteSize),
          (_, index) => index === 0 ? 1 : 0,
        ).buffer as ArrayBuffer], { type: "image/png" }),
      }),
    },
  ])("fails closed for tampered $name", async ({ name, patch }) => {
    const encoded = rgbaPng(1, 1, [1, 2, 3, 90]);
    const source = sourceForPng(
      `paper-tampered-${name.replaceAll(" ", "-")}`,
      encoded,
      Uint8Array.of(90),
      1,
      1,
      "alpha",
    );
    const hydrator = new StudioBrushR8GrainHydrator({
      download: async () => patch(downloadedFor(source, encoded)),
    });
    hydrators.push(hydrator);
    hydrator.observe("work-tampered", [source]);
    await vi.waitFor(() => expect(hydrator.getSnapshot().status).toBe("error"));
    expect(hydrator.getSnapshot()).toMatchObject({
      ready: 0,
      canRetry: true,
      errors: [{ assetId: source.asset.assetId }],
    });
    expect(resolveStudioBrushR8GrainSampler(source)).toBeNull();
  });

  it("aborts a previous work and ignores a late stale generation", async () => {
    const firstEncoded = rgbaPng(1, 1, [1, 2, 3, 40]);
    const secondEncoded = rgbaPng(1, 1, [4, 5, 6, 200]);
    const first = sourceForPng(
      "paper-first-work",
      firstEncoded,
      Uint8Array.of(40),
      1,
      1,
      "alpha",
    );
    const second = sourceForPng(
      "paper-second-work",
      secondEncoded,
      Uint8Array.of(200),
      1,
      1,
      "alpha",
    );
    const firstFlight = deferred<DownloadedStudioWorkAsset>();
    const secondFlight = deferred<DownloadedStudioWorkAsset>();
    const signals: AbortSignal[] = [];
    const download = vi.fn((
      workId: string,
      _reference: { assetId: string; elementType: "image" },
      signal: AbortSignal,
    ) => {
      signals.push(signal);
      return workId === "work-first" ? firstFlight.promise : secondFlight.promise;
    });
    const hydrator = new StudioBrushR8GrainHydrator({ download });
    hydrators.push(hydrator);

    hydrator.observe("work-first", [first]);
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    hydrator.observe("work-second", [second]);
    expect(signals[0]?.aborted).toBe(true);
    firstFlight.resolve(downloadedFor(first, firstEncoded));
    secondFlight.resolve(downloadedFor(second, secondEncoded));
    await vi.waitFor(() => expect(hydrator.getSnapshot().status).toBe("ready"));
    expect(resolveStudioBrushR8GrainSampler(first)).toBeNull();
    expect(resolveStudioBrushR8GrainSampler(second)).not.toBeNull();
  });

  it("retains retryable error state and succeeds on explicit retry", async () => {
    const encoded = rgbaPng(1, 1, [10, 20, 30, 111]);
    const source = sourceForPng("paper-retry", encoded, Uint8Array.of(111), 1, 1, "alpha");
    const download = vi.fn()
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce(downloadedFor(source, encoded));
    const hydrator = new StudioBrushR8GrainHydrator({ download });
    hydrators.push(hydrator);
    hydrator.observe("work-retry", [source]);
    await vi.waitFor(() => expect(hydrator.getSnapshot().status).toBe("error"));
    expect(hydrator.getSnapshot().canRetry).toBe(true);

    hydrator.retry();
    await vi.waitFor(() => expect(hydrator.getSnapshot().status).toBe("ready"));
    expect(download).toHaveBeenCalledTimes(2);
    expect(resolveStudioBrushR8GrainSampler(source)).not.toBeNull();
  });

  it("does not fetch an unsaved source and exposes it only when already verified", () => {
    const encoded = Uint8Array.of(1);
    const decoded = Uint8Array.of(77);
    const source = sourceForPng("paper-local", encoded, decoded, 1, 1, "luminance");
    const download = vi.fn();
    const hydrator = new StudioBrushR8GrainHydrator({ download });
    hydrators.push(hydrator);
    hydrator.observe(null, [source]);
    expect(hydrator.getSnapshot()).toMatchObject({
      status: "idle",
      ready: 0,
      unavailable: 1,
      canRetry: false,
    });
    expect(download).not.toHaveBeenCalled();

    expect(hydrateStudioBrushR8GrainAsset(source, decoded).status).toBe("ready");
    const verifiedHydrator = new StudioBrushR8GrainHydrator({ download });
    hydrators.push(verifiedHydrator);
    verifiedHydrator.observe(null, [source]);
    expect(verifiedHydrator.getSnapshot()).toMatchObject({
      status: "ready",
      ready: 1,
      unavailable: 0,
    });
    expect(download).not.toHaveBeenCalled();
  });
});
