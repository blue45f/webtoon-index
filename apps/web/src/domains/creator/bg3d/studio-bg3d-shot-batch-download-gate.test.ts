import { describe, expect, it, vi } from "vitest";

import { commitStudioBg3dShotBatchDownload } from "./studio-bg3d-shot-batch-download-gate";

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("Studio BG3D shot batch download gate", () => {
  it("does not download when the editor aborts during delayed IndexedDB bookkeeping", async () => {
    const controller = new AbortController();
    const mark = deferred();
    const download = vi.fn();
    const assertAccess = vi.fn(async () => undefined);
    const pending = commitStudioBg3dShotBatchDownload({
      signal: controller.signal,
      isActive: () => true,
      assertAccess,
      markDownloadRequested: () => mark.promise,
      download,
    });
    await vi.waitFor(() => expect(assertAccess).toHaveBeenCalledOnce());

    controller.abort();
    mark.resolve();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(assertAccess).toHaveBeenCalledOnce();
    expect(download).not.toHaveBeenCalled();
  });

  it("requires fresh access after bookkeeping and downloads with no later await", async () => {
    const controller = new AbortController();
    const download = vi.fn();
    const assertAccess = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error("revoked"), { name: "AbortError" }));

    await expect(commitStudioBg3dShotBatchDownload({
      signal: controller.signal,
      isActive: () => true,
      assertAccess,
      markDownloadRequested: async () => undefined,
      download,
    })).rejects.toThrow("revoked");
    expect(assertAccess).toHaveBeenCalledTimes(2);
    expect(download).not.toHaveBeenCalled();

    assertAccess.mockReset();
    assertAccess.mockResolvedValue(undefined);
    await commitStudioBg3dShotBatchDownload({
      signal: controller.signal,
      isActive: () => true,
      assertAccess,
      markDownloadRequested: async () => undefined,
      download,
    });
    expect(assertAccess).toHaveBeenCalledTimes(2);
    expect(download).toHaveBeenCalledOnce();
  });
});
