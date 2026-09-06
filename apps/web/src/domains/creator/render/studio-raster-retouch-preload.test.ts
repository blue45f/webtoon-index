import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSvgWorkerClient: vi.fn(),
  preloadSvgWorker: vi.fn(),
  preloadVectorRasterizer: vi.fn(),
}));

vi.mock("../export/studio-document-export-loaders", () => ({
  loadStudioSvgExportWorkerClientModule: mocks.loadSvgWorkerClient,
}));
vi.mock("../studio-vector-fill-reference", () => ({
  preloadStudioVectorReferenceRasterizer: mocks.preloadVectorRasterizer,
}));
vi.mock("./studio-raster-edit-preparation", () => ({}));
vi.mock("../studio-pixel-edit-brush-runtime", () => ({}));
vi.mock("../studio-liquify-browser", () => ({}));

describe("Studio raster retouch intent preload", () => {
  let preloadStudioRasterRetouchRuntime: typeof import("./studio-raster-retouch-preload"
  )["preloadStudioRasterRetouchRuntime"];

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.loadSvgWorkerClient.mockResolvedValue({
      preloadStudioSvgExportWorker: mocks.preloadSvgWorker,
    });
    ({ preloadStudioRasterRetouchRuntime } = await import("./studio-raster-retouch-preload"));
  });

  it("caches common code but re-arms empty Worker leases for every later intent", async () => {
    await preloadStudioRasterRetouchRuntime();
    await preloadStudioRasterRetouchRuntime();

    expect(mocks.loadSvgWorkerClient).toHaveBeenCalledOnce();
    expect(mocks.preloadSvgWorker).toHaveBeenCalledTimes(2);
    expect(mocks.preloadVectorRasterizer).toHaveBeenCalledTimes(2);
  });

  it("adds the liquify runtime to the same idempotent common warmup", async () => {
    await preloadStudioRasterRetouchRuntime({ liquify: true });
    await preloadStudioRasterRetouchRuntime({ liquify: true });

    expect(mocks.loadSvgWorkerClient).toHaveBeenCalledOnce();
    expect(mocks.preloadSvgWorker).toHaveBeenCalledTimes(2);
    expect(mocks.preloadVectorRasterizer).toHaveBeenCalledTimes(2);
  });

  it("retries a failed Worker-client chunk without an unhandled side preload", async () => {
    mocks.loadSvgWorkerClient.mockRejectedValueOnce(new Error("stale deployment chunk"));

    await expect(preloadStudioRasterRetouchRuntime()).rejects.toThrow("stale deployment chunk");
    mocks.loadSvgWorkerClient.mockResolvedValue({
      preloadStudioSvgExportWorker: mocks.preloadSvgWorker,
    });
    await expect(preloadStudioRasterRetouchRuntime()).resolves.toBeUndefined();

    expect(mocks.loadSvgWorkerClient).toHaveBeenCalledTimes(2);
    expect(mocks.preloadSvgWorker).toHaveBeenCalledOnce();
    expect(mocks.preloadVectorRasterizer).toHaveBeenCalledOnce();
  });
});
