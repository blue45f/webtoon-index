import { describe, expect, it, vi } from "vitest";

import { loadStudioBg3dShotBatchRuntime } from "./studio-bg3d-shot-batch-runtime-loader";

import type { StudioBg3dShotBatchRuntime } from "./studio-bg3d-shot-batch-runtime-loader";

const runtime = {} as StudioBg3dShotBatchRuntime;

describe("Studio BG3D shot-batch runtime loader", () => {
  it("does not start the optional import when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const importer = vi.fn(async () => runtime);

    await expect(loadStudioBg3dShotBatchRuntime(controller.signal, importer))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(importer).not.toHaveBeenCalled();
  });

  it("releases the caller immediately when an in-flight import is cancelled", async () => {
    const controller = new AbortController();
    const importer = vi.fn(() => new Promise<StudioBg3dShotBatchRuntime>(() => undefined));
    const loading = loadStudioBg3dShotBatchRuntime(controller.signal, importer);

    controller.abort();

    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
    expect(importer).toHaveBeenCalledOnce();
  });

  it("returns the imported runtime and preserves loader failures", async () => {
    await expect(loadStudioBg3dShotBatchRuntime(
      new AbortController().signal,
      async () => runtime,
    )).resolves.toBe(runtime);

    const failure = new Error("chunk unavailable");
    await expect(loadStudioBg3dShotBatchRuntime(
      new AbortController().signal,
      async () => {
        throw failure;
      },
    )).rejects.toBe(failure);
  });
});
