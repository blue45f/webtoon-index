import { describe, expect, it, vi } from "vitest";

import { StudioWorkAssetRequestError } from "./studio-work-asset-client";
import {
  studioWorkAssetResidentByteCost,
  StudioWorkAssetHydrator,
} from "./studio-work-asset-hydrator";
import { createStudioWorkAssetHydratorRuntime } from "./studio-work-asset-hydrator-runtime";

import type {
  DownloadedStudioWorkAsset,
  StudioWorkAssetReference,
} from "./studio-work-asset-client";
import type { StudioWorkAssetHydratorDependencies } from "./studio-work-asset-hydrator";

const reference = { assetId: "asset-1", elementType: "image" as const };

function assetReference(id: string) {
  return { assetId: id, elementType: "image" as const };
}

function downloaded(id = "asset-1", byteLength = 1): DownloadedStudioWorkAsset {
  return {
    manifest: {
      version: 1,
      assetId: id,
      elementType: "image",
      mimeType: "image/png",
      byteSize: byteLength,
      sha256: "a".repeat(64),
      intrinsicImage: { width: 1, height: 1, decodedRgbaBytes: 4 },
      descriptor: {
        version: 1,
        element: {
          id,
          type: "image",
          x: 5,
          y: 6,
          width: 100,
          height: 200,
          rotation: 0,
        },
      },
      updatedAt: "2026-07-16T00:00:00.000Z",
    },
    blob: new Blob([new Uint8Array(byteLength).fill(1)], { type: "image/png" }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

const loadTestRuntime = async () => ({ createStudioWorkAssetHydratorRuntime });

function createHydrator(
  workId: string | null,
  dependencies: StudioWorkAssetHydratorDependencies = {}
): StudioWorkAssetHydrator {
  return new StudioWorkAssetHydrator(workId, {
    ...dependencies,
    loadRuntime: dependencies.loadRuntime ?? loadTestRuntime,
  });
}

describe("StudioWorkAssetHydrator", () => {
  it("charges decoded RGBA plus compressed Blob bytes instead of compressed size alone", () => {
    const candidate = downloaded();
    candidate.manifest.intrinsicImage = {
      width: 4_096,
      height: 4_096,
      decodedRgbaBytes: 64 * 1024 * 1024,
    };
    expect(studioWorkAssetResidentByteCost(candidate.manifest, 1))
      .toBe(64 * 1024 * 1024 + 1);
    candidate.manifest.intrinsicImage.decodedRgbaBytes -= 1;
    expect(() => studioWorkAssetResidentByteCost(candidate.manifest, 1))
      .toThrow(/RGBA/u);
  });

  it("publishes placeholder -> ready and deduplicates a repeated frontier reference", async () => {
    const pending = deferred<DownloadedStudioWorkAsset>();
    const download = vi.fn(() => pending.promise);
    const createObjectUrl = vi.fn(() => "blob:asset-1");
    const hydrator = createHydrator("work-1", { download, createObjectUrl });
    hydrator.observe([reference, reference]);
    expect(hydrator.get(reference)).toMatchObject({
      status: "loading",
      placeholder: { assetId: "asset-1", elementType: "image" },
    });
    await flush();
    expect(download).toHaveBeenCalledOnce();

    pending.resolve(downloaded());
    await flush();
    expect(hydrator.get(reference)).toMatchObject({
      status: "ready",
      source: { id: "asset-1", type: "image", src: "work-asset://image/asset-1", x: 5 },
      resourceUrl: "blob:asset-1",
    });
    expect(hydrator.readySources().get("asset-1")?.src).toBe("work-asset://image/asset-1");
    expect(hydrator.resourceUrl(reference)).toBe("blob:asset-1");
    hydrator.dispose();
  });

  it("does not notify React subscribers when the observed reference set is unchanged", async () => {
    const download = vi.fn((
      _workId: string,
      _reference: StudioWorkAssetReference
    ) => new Promise<DownloadedStudioWorkAsset>(() => {}));
    const hydrator = createHydrator("work-1", { download });
    const listener = vi.fn();
    hydrator.subscribe(listener);
    const initialVersion = hydrator.getVersion();

    hydrator.observe([reference]);
    expect(listener).toHaveBeenCalledOnce();
    expect(hydrator.getVersion()).toBe(initialVersion + 1);
    await flush();

    listener.mockClear();
    hydrator.observe([reference, reference]);
    expect(listener).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledOnce();
    expect(hydrator.getVersion()).toBe(initialVersion + 1);
    hydrator.dispose();
  });

  it("aborts removed references and ignores their late response", async () => {
    const pending = deferred<DownloadedStudioWorkAsset>();
    const captured: { signal: AbortSignal | null } = { signal: null };
    const createObjectUrl = vi.fn(() => "blob:stale");
    const hydrator = createHydrator("work-1", {
      download: (_workId, _reference, signal) => {
        captured.signal = signal;
        return pending.promise;
      },
      createObjectUrl,
    });
    hydrator.observe([reference]);
    await flush();
    hydrator.observe([]);
    expect(captured.signal?.aborted).toBe(true);
    pending.resolve(downloaded());
    await flush();
    expect(hydrator.get(reference)).toBeNull();
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("rotates work scope, revokes ready URLs, and blocks stale work responses", async () => {
    const first = deferred<DownloadedStudioWorkAsset>();
    const second = deferred<DownloadedStudioWorkAsset>();
    const download = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const revokeObjectUrl = vi.fn();
    const hydrator = createHydrator("work-a", {
      download,
      createObjectUrl: () => "blob:ready",
      revokeObjectUrl,
    });
    hydrator.observe([reference]);
    await flush();
    hydrator.setWorkId("work-b");
    hydrator.observe([reference]);
    first.resolve(downloaded());
    second.resolve(downloaded());
    await flush();
    expect(hydrator.get(reference)).toMatchObject({ status: "ready" });
    expect(download.mock.calls.map((call) => call[0])).toEqual(["work-a", "work-b"]);
    hydrator.setWorkId("work-c");
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:ready");
    expect(hydrator.get(reference)).toBeNull();
  });

  it.each([
    [403, "forbidden"],
    [404, "missing"],
    [null, "invalid"],
    [503, "network"],
  ] as const)("maps request status %s to a retryable %s placeholder", async (status, code) => {
    const hydrator = createHydrator("work-1", {
      download: async () => {
        throw new StudioWorkAssetRequestError("failed", status);
      },
    });
    hydrator.observe([reference]);
    await flush();
    expect(hydrator.get(reference)).toMatchObject({
      status: "error",
      code,
      placeholder: { assetId: "asset-1" },
    });
  });

  it("fails closed when a downloader returns a different ID/type", async () => {
    const createObjectUrl = vi.fn(() => "blob:wrong");
    const hydrator = createHydrator("work-1", {
      download: async () => downloaded("different-id"),
      createObjectUrl,
    });
    hydrator.observe([reference]);
    await flush();
    expect(hydrator.get(reference)).toMatchObject({ status: "error", code: "invalid" });
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("retries an error and exposes only the replacement response", async () => {
    const download = vi.fn()
      .mockRejectedValueOnce(new StudioWorkAssetRequestError("offline", 503))
      .mockResolvedValueOnce(downloaded());
    const hydrator = createHydrator("work-1", {
      download,
      createObjectUrl: () => "blob:retry",
    });
    hydrator.observe([reference]);
    await flush();
    expect(hydrator.get(reference)?.status).toBe("error");
    hydrator.retry(reference);
    expect(hydrator.get(reference)?.status).toBe("loading");
    await flush();
    expect(hydrator.get(reference)).toMatchObject({
      status: "ready",
      source: { src: "work-asset://image/asset-1" },
      resourceUrl: "blob:retry",
    });
  });

  it("prioritizes the current page and never exceeds the bounded download pool", async () => {
    const requests = new Map<string, ReturnType<typeof deferred<DownloadedStudioWorkAsset>>>();
    const download = vi.fn((_workId: string, nextReference: StudioWorkAssetReference) => {
      const request = deferred<DownloadedStudioWorkAsset>();
      requests.set(nextReference.assetId, request);
      return request.promise;
    });
    const references = Array.from({ length: 5 }, (_, index) => assetReference(`asset-${index + 1}`));
    const hydrator = createHydrator("work-1", {
      download,
      maximumConcurrent: 2,
      createObjectUrl: () => "blob:ready",
    });
    hydrator.observe(references, { priorityReferences: [references[3]!] });
    await flush();
    expect(download).toHaveBeenCalledTimes(2);
    expect(download.mock.calls.map((call) => call[1].assetId)).toEqual(["asset-4", "asset-1"]);

    requests.get("asset-4")?.resolve(downloaded("asset-4"));
    await flush();
    expect(download).toHaveBeenCalledTimes(3);
    expect(download.mock.calls[2]?.[1].assetId).toBe("asset-2");
    hydrator.dispose();
  });

  it("enforces a resident byte budget and retries a protected page after priority changes", async () => {
    let objectUrlSequence = 0;
    const revokeObjectUrl = vi.fn();
    const download = vi.fn(async (_workId: string, nextReference: StudioWorkAssetReference) =>
      downloaded(nextReference.assetId, 2)
    );
    const first = assetReference("asset-first");
    const second = assetReference("asset-second");
    const hydrator = createHydrator("work-1", {
      download,
      maximumConcurrent: 1,
      maximumResidentBytes: 9,
      createObjectUrl: () => `blob:resident-${++objectUrlSequence}`,
      revokeObjectUrl,
    });

    hydrator.observe([first, second], { priorityReferences: [first] });
    await flush();
    await flush();
    expect(hydrator.get(first)?.status).toBe("ready");
    expect(hydrator.get(second)).toMatchObject({ status: "error", code: "resource" });
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    hydrator.observe([first, second], { priorityReferences: [second] });
    await flush();
    await flush();
    expect(hydrator.get(first)).toMatchObject({ status: "error", code: "resource" });
    expect(hydrator.get(second)?.status).toBe("ready");
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:resident-1");
    expect(download.mock.calls.map((call) => call[1].assetId)).toEqual([
      "asset-first",
      "asset-second",
      "asset-second",
    ]);
    hydrator.dispose();
  });

  it("refuses a tiny compressed image whose decoded RGBA surface exceeds the budget", async () => {
    const oversized = downloaded();
    oversized.manifest.intrinsicImage = {
      width: 4_096,
      height: 4_096,
      decodedRgbaBytes: 64 * 1024 * 1024,
    };
    const createObjectUrl = vi.fn(() => "blob:should-not-exist");
    const hydrator = createHydrator("work-1", {
      download: async () => oversized,
      maximumResidentBytes: 32 * 1024 * 1024,
      createObjectUrl,
    });
    hydrator.observe([reference]);
    await flush();
    expect(hydrator.get(reference)).toMatchObject({ status: "error", code: "resource" });
    expect(createObjectUrl).not.toHaveBeenCalled();
    hydrator.dispose();
  });

  it("loads the runtime only for a non-empty frontier without a duplicate handoff notification", async () => {
    const runtimeLoad = deferred<{ createStudioWorkAssetHydratorRuntime: typeof createStudioWorkAssetHydratorRuntime }>();
    const loadRuntime = vi.fn(() => runtimeLoad.promise);
    const download = vi.fn(() => new Promise<DownloadedStudioWorkAsset>(() => {}));
    const hydrator = new StudioWorkAssetHydrator("work-1", { download, loadRuntime });
    const listener = vi.fn();
    hydrator.subscribe(listener);

    hydrator.observe([]);
    await flush();
    expect(loadRuntime).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();

    hydrator.observe([reference]);
    expect(hydrator.get(reference)).toMatchObject({ status: "loading" });
    expect(listener).toHaveBeenCalledOnce();
    const placeholderVersion = hydrator.getVersion();
    await flush();
    expect(loadRuntime).toHaveBeenCalledOnce();

    runtimeLoad.resolve({ createStudioWorkAssetHydratorRuntime });
    await flush();
    expect(download).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();
    expect(hydrator.getVersion()).toBe(placeholderVersion);
    expect(hydrator.get(reference)).toMatchObject({ status: "loading" });
    hydrator.dispose();
  });

  it("fences a pending runtime import to the latest work and observed frontier", async () => {
    const runtimeLoad = deferred<{ createStudioWorkAssetHydratorRuntime: typeof createStudioWorkAssetHydratorRuntime }>();
    const download = vi.fn((
      _workId: string,
      _reference: StudioWorkAssetReference
    ) => new Promise<DownloadedStudioWorkAsset>(() => {}));
    const latestReference = assetReference("asset-latest");
    const hydrator = new StudioWorkAssetHydrator("work-old", {
      download,
      loadRuntime: () => runtimeLoad.promise,
    });

    hydrator.observe([reference]);
    hydrator.setWorkId("work-latest");
    hydrator.observe([latestReference]);
    runtimeLoad.resolve({ createStudioWorkAssetHydratorRuntime });
    await flush();

    expect(download.mock.calls.map(([workId, candidate]) => [workId, candidate.assetId]))
      .toEqual([["work-latest", "asset-latest"]]);
    expect(hydrator.get(reference)).toBeNull();
    expect(hydrator.get(latestReference)).toMatchObject({ status: "loading" });
    hydrator.dispose();
  });

  it("retries a failed runtime chunk load through the stable public retry API", async () => {
    const download = vi.fn(async () => downloaded());
    const loadRuntime = vi.fn()
      .mockRejectedValueOnce(new Error("chunk offline"))
      .mockResolvedValueOnce({ createStudioWorkAssetHydratorRuntime });
    const hydrator = new StudioWorkAssetHydrator("work-1", {
      download,
      createObjectUrl: () => "blob:runtime-retry",
      loadRuntime,
    });

    hydrator.observe([reference]);
    await flush();
    expect(hydrator.get(reference)).toMatchObject({
      status: "error",
      code: "network",
      message: "chunk offline",
    });

    hydrator.retry(reference);
    expect(hydrator.get(reference)).toMatchObject({ status: "loading" });
    await flush();
    expect(loadRuntime).toHaveBeenCalledTimes(2);
    expect(download).toHaveBeenCalledOnce();
    expect(hydrator.get(reference)).toMatchObject({
      status: "ready",
      resourceUrl: "blob:runtime-retry",
    });
    hydrator.dispose();
  });

  it("does not construct a runtime when disposed before a late import resolves", async () => {
    const runtimeLoad = deferred<{ createStudioWorkAssetHydratorRuntime: typeof createStudioWorkAssetHydratorRuntime }>();
    const createRuntime = vi.fn(createStudioWorkAssetHydratorRuntime);
    const download = vi.fn(() => new Promise<DownloadedStudioWorkAsset>(() => {}));
    const hydrator = new StudioWorkAssetHydrator("work-1", {
      download,
      loadRuntime: () => runtimeLoad.promise,
    });
    const listener = vi.fn();
    hydrator.subscribe(listener);

    hydrator.observe([reference]);
    await flush();
    hydrator.dispose();
    runtimeLoad.resolve({ createStudioWorkAssetHydratorRuntime: createRuntime });
    await flush();

    expect(createRuntime).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledOnce();
    expect(hydrator.get(reference)).toBeNull();
  });
});
