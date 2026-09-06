import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_COMPANION_REFERENCE_SOURCE_HEIGHT,
  STUDIO_COMPANION_REFERENCE_SOURCE_MAX_RGBA_BYTES,
  STUDIO_COMPANION_REFERENCE_SOURCE_WIDTH,
  createStudioCompanionReferenceSourceRuntime,
  fitStudioCompanionReferenceSourceDimensions,
  normalizeStudioCompanionReferenceRaster,
  type StudioCompanionReferenceDecodedSource,
  type StudioCompanionReferencePrivateCanvas,
  type StudioCompanionReferenceSourceDependencies,
} from "./studio-companion-reference-source-runtime";

import type { StudioAsset } from "@/src/domains/creator/studio-asset-library";
import type {
  StudioReferenceBoardDocument,
  StudioReferenceBoardItem,
} from "@/src/domains/creator/studio-reference-board";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;

function item(
  id: string,
  sha256 = HASH_A,
  assetId?: string
): StudioReferenceBoardItem {
  return {
    id,
    asset: {
      sha256,
      ...(assetId ? { assetId } : {}),
      width: 1_920,
      height: 1_080,
    },
    view: {
      centerX: 0.5,
      centerY: 0.5,
      zoom: 1,
      rotationDeg: 0,
      flipX: false,
      flipY: false,
      opacity: 1,
      grayscale: false,
    },
  };
}

function board(items: readonly StudioReferenceBoardItem[]): StudioReferenceBoardDocument {
  return { version: 1, items: [...items] };
}

function asset(
  id: string,
  dataUrl: string,
  contentHash?: string
): StudioAsset {
  return {
    id,
    name: id,
    dataUrl,
    ...(contentHash ? { contentHash: contentHash as `sha256:${string}` } : {}),
    width: 4,
    height: 2,
    createdAt: 1,
  };
}

function decoded(
  fill = 17,
  width = 4,
  height = 2
): StudioCompanionReferenceDecodedSource & {
  drawable: { width: number; height: number };
  release: () => void;
} {
  return {
    drawable: { width, height },
    width,
    height,
    pixels: new Uint8ClampedArray(width * height * 4).fill(fill),
    release: vi.fn(),
  };
}

function dependencies(options: {
  document?: StudioReferenceBoardDocument | null;
  assets?: StudioAsset[];
  actualHashes?: Readonly<Record<string, string>>;
  decodeAsset?: StudioCompanionReferenceSourceDependencies["decodeAsset"];
  release?: () => void;
} = {}): StudioCompanionReferenceSourceDependencies {
  const parsed = options.document === undefined ? board([item("one")]) : options.document;
  return {
    parseDocument: vi.fn(() => parsed),
    findAssetCandidates: vi.fn(async (
      descriptors: readonly StudioReferenceBoardItem["asset"][]
    ) => new Map<string, readonly StudioAsset[]>(
      descriptors.map((descriptor) => [descriptor.sha256, options.assets ?? []])
    )),
    canonicalizeContentHash: vi.fn((value: unknown) => (
      typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value)
        ? value.toLowerCase()
        : null
    )),
    hashDataUrl: vi.fn(async (dataUrl: string) => options.actualHashes?.[dataUrl] ?? HASH_B),
    decodeAsset: options.decodeAsset ?? vi.fn(async () => decoded()),
    ...(options.release ? { release: options.release } : {}),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("reference source dimension fitting", () => {
  it("fits landscape and portrait sources into the private 1280x720 envelope", () => {
    const maximumPixels = STUDIO_COMPANION_REFERENCE_SOURCE_WIDTH
      * STUDIO_COMPANION_REFERENCE_SOURCE_HEIGHT;
    expect(fitStudioCompanionReferenceSourceDimensions(3_840, 2_160, maximumPixels))
      .toEqual({ width: 1_280, height: 720 });
    expect(fitStudioCompanionReferenceSourceDimensions(1_080, 1_920, maximumPixels))
      .toEqual({ width: 405, height: 720 });
    expect(fitStudioCompanionReferenceSourceDimensions(100, 50, 1_000))
      .toEqual({ width: 44, height: 22 });
    expect(fitStudioCompanionReferenceSourceDimensions(0, 50, 1_000)).toBeNull();
    expect(fitStudioCompanionReferenceSourceDimensions(100, 50, 0)).toBeNull();
  });

  it("normalizes RGBA into a private canvas and zeroes both source and released output", () => {
    const raster = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([
        255, 0, 0, 255,
        0, 0, 255, 255,
      ]),
    };
    const written: Uint8ClampedArray[] = [];
    const canvas: StudioCompanionReferencePrivateCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        createImageData: (width, height) => ({
          width,
          height,
          data: new Uint8ClampedArray(width * height * 4),
          colorSpace: "srgb",
        }) as ImageData,
        putImageData: (imageData) => { written.push(new Uint8ClampedArray(imageData.data)); },
      }),
    };

    const normalized = normalizeStudioCompanionReferenceRaster(raster, 1, () => canvas);

    expect(normalized).toMatchObject({ width: 1, height: 1, drawable: canvas });
    expect([...raster.data]).toEqual(new Array(8).fill(0));
    expect([...normalized!.pixels]).toEqual([128, 0, 128, 255]);
    expect([...written[0]!]).toEqual([128, 0, 128, 255]);

    normalized!.release?.();
    normalized!.release?.();
    expect([...normalized!.pixels]).toEqual([0, 0, 0, 0]);
    expect(canvas).toMatchObject({ width: 1, height: 1 });
  });
});

describe("Studio companion reference source demand runtime", () => {
  it("does not load any dynamic dependency while demand is inactive", async () => {
    const loadDependencies = vi.fn(async () => dependencies());
    const runtime = createStudioCompanionReferenceSourceRuntime({ loadDependencies });

    await expect(runtime.setDemand({ active: false, document: board([]) }))
      .resolves.toEqual({ status: "inactive", snapshot: null });
    expect(loadDependencies).not.toHaveBeenCalled();
    expect(runtime.current()).toBeNull();
  });

  it("resolves a verified SHA candidate before an earlier id fallback", async () => {
    const fallback = asset("hint", "data:image/png;base64,fallback", HASH_B);
    const hashMatch = asset("hash", "data:image/png;base64,hash", HASH_A);
    const decodedSource = decoded(31);
    const deps = dependencies({
      document: board([item("one", HASH_A, "hint")]),
      assets: [fallback, hashMatch],
      actualHashes: {
        [fallback.dataUrl]: HASH_A,
        [hashMatch.dataUrl]: HASH_A,
      },
      decodeAsset: vi.fn(async () => decodedSource),
    });
    const runtime = createStudioCompanionReferenceSourceRuntime({
      loadDependencies: async () => deps,
    });

    const result = await runtime.setDemand({ active: true, document: board([]) });

    expect(result.status).toBe("ready");
    expect(deps.hashDataUrl).toHaveBeenCalledOnce();
    expect(deps.hashDataUrl).toHaveBeenCalledWith(hashMatch.dataUrl, expect.any(AbortSignal));
    expect(deps.decodeAsset).toHaveBeenCalledWith(
      expect.objectContaining({ id: "hash", dataUrl: hashMatch.dataUrl }),
      expect.objectContaining({
        maximumWidth: 1_280,
        maximumHeight: 720,
      })
    );
    expect(result.snapshot).toMatchObject({
      boardWidth: 1_280,
      boardHeight: 720,
      itemCount: 1,
      resolvedItemCount: 1,
      canPickColor: true,
    });
    expect(result.snapshot?.previewInput).toBe(result.snapshot?.colorSamplingInput);
    expect(result.snapshot?.previewInput.items[0]?.source).toMatchObject({
      layoutWidth: 1_920,
      layoutHeight: 1_080,
    });
  });

  it("uses the id only as a hash-verified fallback and never substitutes mismatching bytes", async () => {
    const hinted = asset("hint", "data:image/png;base64,hint");
    const goodDeps = dependencies({
      document: board([item("one", HASH_A, "hint")]),
      assets: [hinted],
      actualHashes: { [hinted.dataUrl]: HASH_A },
    });
    const good = createStudioCompanionReferenceSourceRuntime({
      loadDependencies: async () => goodDeps,
    });
    const goodResult = await good.setDemand({ active: true, document: board([]) });
    expect(goodResult.snapshot?.resolvedItemCount).toBe(1);

    const badDeps = dependencies({
      document: board([item("one", HASH_A, "hint")]),
      assets: [hinted],
      actualHashes: { [hinted.dataUrl]: HASH_B },
    });
    const bad = createStudioCompanionReferenceSourceRuntime({
      loadDependencies: async () => badDeps,
    });
    const badResult = await bad.setDemand({ active: true, document: board([]) });
    expect(badResult).toMatchObject({
      status: "ready",
      snapshot: { itemCount: 1, resolvedItemCount: 0, canPickColor: false },
    });
    expect(badDeps.decodeAsset).not.toHaveBeenCalled();
    expect(badResult.snapshot?.previewInput.items[0]?.source).toBeNull();
  });

  it("preserves every bounded id hint for duplicate hashes while decoding the shared source once", async () => {
    const stale = asset("stale-id", "data:image/png;base64,c3RhbGU=");
    const valid = asset("valid-id", "data:image/png;base64,dmFsaWQ=");
    const source = decoded(61);
    const decodeAsset = vi.fn(async () => source);
    const deps = dependencies({
      document: board([
        item("back", HASH_A, stale.id),
        item("front", HASH_A, valid.id),
      ]),
      assets: [stale, valid],
      actualHashes: {
        [stale.dataUrl]: HASH_B,
        [valid.dataUrl]: HASH_A,
      },
      decodeAsset,
    });
    const runtime = createStudioCompanionReferenceSourceRuntime({
      loadDependencies: async () => deps,
    });

    const result = await runtime.setDemand({ active: true, document: board([]) });

    expect(deps.findAssetCandidates).toHaveBeenCalledOnce();
    expect(deps.findAssetCandidates).toHaveBeenCalledWith(
      [
        expect.objectContaining({ sha256: HASH_A, assetId: stale.id }),
        expect.objectContaining({ sha256: HASH_A, assetId: valid.id }),
      ],
      expect.any(AbortSignal)
    );
    expect(deps.hashDataUrl).toHaveBeenNthCalledWith(
      1,
      stale.dataUrl,
      expect.any(AbortSignal)
    );
    expect(deps.hashDataUrl).toHaveBeenNthCalledWith(
      2,
      valid.dataUrl,
      expect.any(AbortSignal)
    );
    expect(decodeAsset).toHaveBeenCalledOnce();
    expect(decodeAsset).toHaveBeenCalledWith(valid, expect.any(Object));
    expect(result.snapshot?.resolvedItemCount).toBe(2);
  });

  it("deduplicates equal hashes and applies one aggregate RGBA share per board item", async () => {
    const local = asset("same", "data:image/png;base64,same", HASH_A);
    const source = decoded(73);
    const decodeAsset = vi.fn(async () => source);
    const deps = dependencies({
      document: board([item("back", HASH_A), item("front", HASH_A)]),
      assets: [local],
      actualHashes: { [local.dataUrl]: HASH_A },
      decodeAsset,
    });
    const runtime = createStudioCompanionReferenceSourceRuntime({
      loadDependencies: async () => deps,
    });

    const result = await runtime.setDemand({ active: true, document: board([]) });

    expect(decodeAsset).toHaveBeenCalledOnce();
    expect(decodeAsset).toHaveBeenCalledWith(local, expect.objectContaining({
      maximumOutputPixels: STUDIO_COMPANION_REFERENCE_SOURCE_MAX_RGBA_BYTES / 4 / 2,
    }));
    expect(result.snapshot?.resolvedItemCount).toBe(2);
    expect(result.snapshot?.previewInput.items[0]?.source?.drawable)
      .toBe(result.snapshot?.previewInput.items[1]?.source?.drawable);
    expect(result.snapshot?.previewInput.items[0]?.source?.pixels)
      .toBe(result.snapshot?.previewInput.items[1]?.source?.pixels);
  });

  it("releases canvas, RGBA, and adapter-owned URL-like resources when demand ends", async () => {
    const local = asset("same", "data:image/png;base64,same", HASH_A);
    const source = decoded(99);
    const deps = dependencies({
      document: board([item("one", HASH_A)]),
      assets: [local],
      actualHashes: { [local.dataUrl]: HASH_A },
      decodeAsset: vi.fn(async () => source),
    });
    const runtime = createStudioCompanionReferenceSourceRuntime({
      loadDependencies: async () => deps,
    });

    await runtime.setDemand({ active: true, document: board([]) });
    expect(runtime.current()?.resolvedItemCount).toBe(1);
    expect(source.pixels.some((value) => value !== 0)).toBe(true);

    await expect(runtime.setDemand({ active: false, document: board([]) }))
      .resolves.toEqual({ status: "inactive", snapshot: null });
    expect(runtime.current()).toBeNull();
    expect(source.release).toHaveBeenCalledOnce();
    expect(source.pixels.every((value) => value === 0)).toBe(true);
    expect(source.drawable).toEqual({ width: 1, height: 1 });

    runtime.release();
    expect(source.release).toHaveBeenCalledOnce();
  });

  it.each([
    ["offset view", () => new Uint8ClampedArray(new ArrayBuffer(8), 4, 4)],
    ["oversized backing buffer", () => new Uint8ClampedArray(new ArrayBuffer(8), 0, 4)],
  ])("rejects and releases decoded RGBA with a non-owned %s", async (_label, pixelsFactory) => {
    const local = asset("same", "data:image/png;base64,c2FtZQ==", HASH_A);
    const rejectedSource = {
      drawable: { width: 1, height: 1 },
      width: 1,
      height: 1,
      pixels: pixelsFactory().fill(77),
      release: vi.fn(),
    } satisfies StudioCompanionReferenceDecodedSource;
    const deps = dependencies({
      document: board([item("one", HASH_A)]),
      assets: [local],
      actualHashes: { [local.dataUrl]: HASH_A },
      decodeAsset: vi.fn(async () => rejectedSource),
    });
    const runtime = createStudioCompanionReferenceSourceRuntime({
      loadDependencies: async () => deps,
    });

    const result = await runtime.setDemand({ active: true, document: board([]) });

    expect(result).toMatchObject({
      status: "ready",
      snapshot: { resolvedItemCount: 0, canPickColor: false },
    });
    expect(rejectedSource.release).toHaveBeenCalledOnce();
    expect([...rejectedSource.pixels]).toEqual([0, 0, 0, 0]);
    expect(rejectedSource.drawable).toEqual({ width: 1, height: 1 });
  });

  it("releases the demand-owned worker dependency exactly once when demand ends", async () => {
    const local = asset("same", "data:image/png;base64,same", HASH_A);
    const release = vi.fn();
    const deps = dependencies({
      document: board([item("one", HASH_A)]),
      assets: [local],
      actualHashes: { [local.dataUrl]: HASH_A },
      release,
    });
    const runtime = createStudioCompanionReferenceSourceRuntime({
      loadDependencies: async () => deps,
    });

    await runtime.setDemand({ active: true, document: board([]) });
    expect(release).not.toHaveBeenCalled();
    await runtime.setDemand({ active: false, document: board([]) });
    runtime.release();

    expect(release).toHaveBeenCalledOnce();
  });

  it("epoch-fences an in-flight decode and releases its late result after demand ends", async () => {
    const local = asset("same", "data:image/png;base64,same", HASH_A);
    const pending = deferred<StudioCompanionReferenceDecodedSource | null>();
    const source = decoded(45);
    const decodeAsset = vi.fn(() => pending.promise);
    const deps = dependencies({
      document: board([item("one", HASH_A)]),
      assets: [local],
      actualHashes: { [local.dataUrl]: HASH_A },
      decodeAsset,
    });
    const runtime = createStudioCompanionReferenceSourceRuntime({
      loadDependencies: async () => deps,
    });

    const active = runtime.setDemand({ active: true, document: board([]) });
    await vi.waitFor(() => expect(decodeAsset).toHaveBeenCalledOnce());
    await runtime.setDemand({ active: false, document: board([]) });

    await expect(active).resolves.toEqual({ status: "stale", snapshot: null });
    pending.resolve(source);
    await vi.waitFor(() => expect(source.release).toHaveBeenCalledOnce());
    expect(source.release).toHaveBeenCalledOnce();
    expect(source.pixels.every((value) => value === 0)).toBe(true);
    expect(runtime.current()).toBeNull();
  });

  it("returns stale promptly and releases dependencies that load after abort", async () => {
    const pending = deferred<StudioCompanionReferenceSourceDependencies>();
    const release = vi.fn();
    const caller = new AbortController();
    const runtime = createStudioCompanionReferenceSourceRuntime({
      loadDependencies: () => pending.promise,
    });

    const active = runtime.setDemand({
      active: true,
      document: board([]),
      signal: caller.signal,
    });
    caller.abort();

    await expect(active).resolves.toEqual({ status: "stale", snapshot: null });
    pending.resolve(dependencies({ release }));
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    expect(runtime.current()).toBeNull();
  });

  it("returns stale promptly when candidate lookup ignores abort", async () => {
    const pendingCandidates = deferred<ReadonlyMap<string, readonly StudioAsset[]>>();
    const release = vi.fn();
    const deps = dependencies({
      document: board([item("one", HASH_A)]),
      release,
    });
    vi.mocked(deps.findAssetCandidates).mockReturnValue(pendingCandidates.promise);
    const caller = new AbortController();
    const runtime = createStudioCompanionReferenceSourceRuntime({
      loadDependencies: async () => deps,
    });

    const active = runtime.setDemand({
      active: true,
      document: board([]),
      signal: caller.signal,
    });
    await vi.waitFor(() => expect(deps.findAssetCandidates).toHaveBeenCalledOnce());
    caller.abort();

    await expect(active).resolves.toEqual({ status: "stale", snapshot: null });
    expect(release).toHaveBeenCalledOnce();
    pendingCandidates.resolve(new Map());
    expect(runtime.current()).toBeNull();
  });

  it("returns stale promptly when content hashing ignores abort", async () => {
    const local = asset("same", "data:image/png;base64,c2FtZQ==", HASH_A);
    const pendingHash = deferred<string>();
    const release = vi.fn();
    const deps = dependencies({
      document: board([item("one", HASH_A)]),
      assets: [local],
      release,
    });
    vi.mocked(deps.hashDataUrl).mockReturnValue(pendingHash.promise);
    const caller = new AbortController();
    const runtime = createStudioCompanionReferenceSourceRuntime({
      loadDependencies: async () => deps,
    });

    const active = runtime.setDemand({
      active: true,
      document: board([]),
      signal: caller.signal,
    });
    await vi.waitFor(() => expect(deps.hashDataUrl).toHaveBeenCalledOnce());
    caller.abort();

    await expect(active).resolves.toEqual({ status: "stale", snapshot: null });
    expect(release).toHaveBeenCalledOnce();
    pendingHash.resolve(HASH_A);
    expect(deps.decodeAsset).not.toHaveBeenCalled();
    expect(runtime.current()).toBeNull();
  });

  it("never lets stale demand cleanup release the latest dependency scope", async () => {
    const local = asset("same", "data:image/png;base64,same", HASH_A);
    const pendingA = deferred<StudioCompanionReferenceDecodedSource | null>();
    const pendingB = deferred<StudioCompanionReferenceDecodedSource | null>();
    const sourceA = decoded(45);
    const sourceB = decoded(81);
    const releaseA = vi.fn();
    const releaseB = vi.fn();
    const decodeA = vi.fn(() => pendingA.promise);
    const decodeB = vi.fn(() => pendingB.promise);
    const depsA = dependencies({
      document: board([item("one", HASH_A)]),
      assets: [local],
      actualHashes: { [local.dataUrl]: HASH_A },
      decodeAsset: decodeA,
      release: releaseA,
    });
    const depsB = dependencies({
      document: board([item("one", HASH_A)]),
      assets: [local],
      actualHashes: { [local.dataUrl]: HASH_A },
      decodeAsset: decodeB,
      release: releaseB,
    });
    let loadCount = 0;
    const runtime = createStudioCompanionReferenceSourceRuntime({
      loadDependencies: async () => (loadCount++ === 0 ? depsA : depsB),
    });

    const firstDemand = runtime.setDemand({ active: true, document: board([]) });
    await vi.waitFor(() => expect(decodeA).toHaveBeenCalledOnce());
    const secondDemand = runtime.setDemand({ active: true, document: board([]) });
    await vi.waitFor(() => expect(decodeB).toHaveBeenCalledOnce());
    expect(releaseA).toHaveBeenCalledOnce();
    expect(releaseB).not.toHaveBeenCalled();

    pendingA.resolve(sourceA);
    await expect(firstDemand).resolves.toEqual({ status: "stale", snapshot: null });
    expect(sourceA.release).toHaveBeenCalledOnce();
    expect(releaseB).not.toHaveBeenCalled();

    pendingB.resolve(sourceB);
    await expect(secondDemand).resolves.toMatchObject({
      status: "ready",
      snapshot: { resolvedItemCount: 1 },
    });
    expect(releaseB).not.toHaveBeenCalled();

    runtime.release();
    expect(releaseB).toHaveBeenCalledOnce();
  });

  it("fails closed and removes a caller abort hook when signal registration throws", async () => {
    const loadDependencies = vi.fn(async () => dependencies());
    const removeEventListener = vi.fn(() => {
      throw new Error("detached signal");
    });
    const signal = {
      aborted: false,
      addEventListener: vi.fn(() => {
        throw new Error("detached signal");
      }),
      removeEventListener,
    } as unknown as AbortSignal;
    const runtime = createStudioCompanionReferenceSourceRuntime({ loadDependencies });

    await expect(runtime.setDemand({ active: true, document: board([]), signal }))
      .resolves.toEqual({ status: "stale", snapshot: null });

    expect(loadDependencies).not.toHaveBeenCalled();
    expect(removeEventListener).toHaveBeenCalledOnce();
    expect(runtime.current()).toBeNull();
  });

  it("keeps decoded and dependency cleanup reachable when caller listener removal throws", async () => {
    const local = asset("same", "data:image/png;base64,c2FtZQ==", HASH_A);
    const source = decoded(93, 1, 1);
    const release = vi.fn();
    const deps = dependencies({
      document: board([item("one", HASH_A)]),
      assets: [local],
      actualHashes: { [local.dataUrl]: HASH_A },
      decodeAsset: vi.fn(async () => source),
      release,
    });
    const signal = {
      aborted: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(() => {
        throw new Error("detached signal");
      }),
    } as unknown as AbortSignal;
    const runtime = createStudioCompanionReferenceSourceRuntime({
      loadDependencies: async () => deps,
    });

    await expect(runtime.setDemand({ active: true, document: board([]), signal }))
      .resolves.toMatchObject({ status: "ready", snapshot: { resolvedItemCount: 1 } });
    runtime.release();

    expect(signal.removeEventListener).toHaveBeenCalledOnce();
    expect(source.release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(runtime.current()).toBeNull();
  });

  it("returns an empty ready projection without touching IndexedDB for an empty board", async () => {
    const deps = dependencies({ document: board([]) });
    const runtime = createStudioCompanionReferenceSourceRuntime({
      loadDependencies: async () => deps,
    });

    const result = await runtime.setDemand({ active: true, document: board([]) });

    expect(result).toMatchObject({
      status: "ready",
      snapshot: { itemCount: 0, resolvedItemCount: 0, canPickColor: false },
    });
    expect(deps.findAssetCandidates).not.toHaveBeenCalled();
  });

  it("looks up only the canonical descriptors required by the board instead of listing assets", async () => {
    const localA = asset("a", "data:image/png;base64,YQ==", HASH_A);
    const localB = asset("b", "data:image/png;base64,Yg==", HASH_B);
    const deps = dependencies({
      document: board([
        item("a-back", HASH_A, "a"),
        item("a-front", HASH_A, "a"),
        item("b", HASH_B, "b"),
      ]),
      actualHashes: {
        [localA.dataUrl]: HASH_A,
        [localB.dataUrl]: HASH_B,
      },
    });
    vi.mocked(deps.findAssetCandidates).mockImplementation(async (descriptors) => new Map(
      descriptors.map((descriptor) => [
        descriptor.sha256,
        descriptor.sha256 === HASH_A ? [localA] : [localB],
      ])
    ));
    const runtime = createStudioCompanionReferenceSourceRuntime({
      loadDependencies: async () => deps,
    });

    const result = await runtime.setDemand({ active: true, document: board([]) });

    expect(result.snapshot?.resolvedItemCount).toBe(3);
    expect(deps.findAssetCandidates).toHaveBeenCalledOnce();
    expect(deps.findAssetCandidates).toHaveBeenCalledWith(
      [
        expect.objectContaining({ sha256: HASH_A, assetId: "a" }),
        expect.objectContaining({ sha256: HASH_B, assetId: "b" }),
      ],
      expect.any(AbortSignal)
    );
  });

  it("fails closed when dynamic dependencies or canonical board parsing are unavailable", async () => {
    const unavailable = createStudioCompanionReferenceSourceRuntime({
      loadDependencies: async () => { throw new Error("chunk unavailable"); },
    });
    await expect(unavailable.setDemand({ active: true, document: board([]) }))
      .resolves.toEqual({ status: "unavailable", snapshot: null });

    const invalid = createStudioCompanionReferenceSourceRuntime({
      loadDependencies: async () => dependencies({ document: null }),
    });
    await expect(invalid.setDemand({ active: true, document: board([]) }))
      .resolves.toEqual({ status: "unavailable", snapshot: null });
  });
});
