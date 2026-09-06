import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  createStudioLayerLiftMediaPipeInferenceLoader,
  type StudioLayerLiftMediaPipeRaster,
} from "./studio-layer-lift-mediapipe-inference";

import type { StudioLocalForegroundSegmenterRuntime } from "../studio-bg-remove";

function mask(
  values: readonly number[],
){
  return {
    width: values.length,
    height: 1,
    getAsFloat32Array: () => new Float32Array(values),
    close: vi.fn<() => void>(),
  };
}

function runtime(
  delegate: "GPU" | "CPU",
  segment: StudioLocalForegroundSegmenterRuntime["segmenter"]["segment"],
): StudioLocalForegroundSegmenterRuntime {
  return {
    selectedDelegate: delegate,
    activeDelegate: delegate,
    providerSelection: delegate === "GPU"
      ? "product-default-gpu"
      : "explicit-before-execution",
    attemptedDelegates: [delegate],
    segmenter: { segment },
  };
}

function input(signal: AbortSignal) {
  return {
    width: 2,
    height: 1,
    pixelCount: 2,
    sourceSha256: `sha256:${"a".repeat(64)}` as const,
    rgba: new Uint8Array([10, 20, 30, 255, 40, 50, 60, 128]),
    signal,
  };
}

describe("Studio Layer Lift MediaPipe inference bridge", () => {
  it("keeps the foreground implementation out of the eager inference bridge", () => {
    const source = readFileSync(
      new URL("./studio-layer-lift-mediapipe-inference.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(
      /import\s+\{[^}]*getStudioLocalForegroundSegmenterRuntime[^}]*\}\s+from\s+["']\.\/studio-bg-remove["']/u,
    );
    expect(source).toContain('await import("../studio-bg-remove")');
  });

  it("keeps raw RGBA local, returns a defensive mask, and disposes resources", async () => {
    const foreground = mask([0.25, 0.9]);
    const resultClose = vi.fn();
    const segment = vi.fn(() => ({
      confidenceMasks: [foreground],
      close: resultClose,
    }));
    const rasterDispose = vi.fn();
    const raster = {
      source: {} as TexImageSource,
      dispose: rasterDispose,
    } satisfies StudioLayerLiftMediaPipeRaster;
    const createRaster = vi.fn(() => raster);
    const loader = createStudioLayerLiftMediaPipeInferenceLoader({
      loadRuntime: async () => runtime("GPU", segment),
      createRaster,
    });
    const controller = new AbortController();

    const engine = await loader(controller.signal);
    const output = await engine.infer(input(controller.signal));

    expect(engine.model).toEqual({
      providerId: "mediapipe-image-segmenter",
      providerVersion: "0.10.35",
      modelId: "selfie-segmenter",
      modelVersion: "float16-latest",
      executionRoute: "gpu",
    });
    expect(createRaster).toHaveBeenCalledOnce();
    expect(segment).toHaveBeenCalledWith(raster.source);
    expect(output.confidence[0]).toBeCloseTo(0.25);
    expect(output.confidence[1]).toBeCloseTo(0.9);
    expect(foreground.close).toHaveBeenCalledOnce();
    expect(resultClose).toHaveBeenCalledOnce();
    expect(rasterDispose).toHaveBeenCalledOnce();
  });

  it("publishes CPU only for an explicitly preselected CPU loader", async () => {
    const foreground = mask([1, 1]);
    const loader = createStudioLayerLiftMediaPipeInferenceLoader({
      delegate: "CPU",
      loadRuntime: async () => runtime("CPU", () => ({
        confidenceMasks: [foreground],
      })),
      createRaster: () => ({ source: {} as TexImageSource }),
    });
    const controller = new AbortController();

    const engine = await loader(controller.signal);

    expect(engine.model.executionRoute).toBe("cpu-explicit");
  });

  it("rejects a runtime whose delegate differs from the loader selection", async () => {
    const loader = createStudioLayerLiftMediaPipeInferenceLoader({
      loadRuntime: async () => runtime("CPU", vi.fn()),
      createRaster: () => ({ source: {} as TexImageSource }),
    });
    const controller = new AbortController();

    await expect(loader(controller.signal)).rejects.toThrow(/identity mismatch/u);
  });

  it("fails closed before model loading and after raster creation when cancelled", async () => {
    const preAborted = new AbortController();
    preAborted.abort();
    const loadRuntime = vi.fn(async () => runtime("GPU", vi.fn()));
    const loader = createStudioLayerLiftMediaPipeInferenceLoader({
      loadRuntime,
      createRaster: () => ({ source: {} as TexImageSource }),
    });

    await expect(loader(preAborted.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(loadRuntime).not.toHaveBeenCalled();

    const controller = new AbortController();
    const dispose = vi.fn();
    const activeLoader = createStudioLayerLiftMediaPipeInferenceLoader({
      loadRuntime: async () => runtime("GPU", vi.fn()),
      createRaster: () => {
        controller.abort();
        return { source: {} as TexImageSource, dispose };
      },
    });
    const engine = await activeLoader(controller.signal);

    await expect(engine.infer(input(controller.signal))).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(dispose).toHaveBeenCalledOnce();
  });
});
