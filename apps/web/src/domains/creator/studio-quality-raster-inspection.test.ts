import { describe, expect, it, vi } from "vitest";

import { inspectStudioRasterAssets } from "./studio-quality-raster-inspection";

import type { El } from "./studio-element-model";
import type { PageState } from "./studio-page-state";

function page(elements: readonly El[]): PageState {
  return {
    id: "page-1",
    name: "1화",
    elements: [...elements],
    bg: "#ffffff",
    bgGrad: null,
    canvasH: 2_000,
    review: { status: "approved", locked: true },
  };
}

function image(
  source: string,
  overrides: Partial<Extract<El, { type: "image" }>> = {}
): Extract<El, { type: "image" }> {
  return {
    id: "image-1",
    type: "image",
    src: source,
    x: 0,
    y: 0,
    width: 400,
    height: 200,
    rotation: 0,
    ...overrides,
  };
}

function codes(result: Awaited<ReturnType<typeof inspectStudioRasterAssets>>): Set<string> {
  return new Set(result.issues.map((issue) => issue.code));
}

describe("studio raster quality inspection", () => {
  it("turns decoder failures into blocking image findings", async () => {
    const probe = vi.fn(async () => {
      throw new Error("decode failed");
    });
    const result = await inspectStudioRasterAssets([page([image("broken.png")])], {
      probe,
    });

    expect(result.status).toBe("complete");
    expect(probe).toHaveBeenCalledTimes(1);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "BROKEN_RASTER_ASSET",
        severity: "blocking",
        elementId: "image-1",
      })
    );
  });

  it("detects severe upscaling and aspect-ratio distortion from intrinsic pixels", async () => {
    const result = await inspectStudioRasterAssets([page([image("small.png")])], {
      probe: async () => ({ width: 100, height: 100 }),
    });
    const found = codes(result);

    expect(found.has("EXTREME_RASTER_UPSCALE")).toBe(true);
    expect(found.has("RASTER_ASPECT_RATIO_DISTORTION")).toBe(true);
  });

  it("compares animation frame and mask dimensions within the same element", async () => {
    const dimensions: Record<string, { width: number; height: number }> = {
      "frame-a.png": { width: 400, height: 200 },
      "frame-b.png": { width: 420, height: 200 },
      "mask.png": { width: 200, height: 100 },
      "filter-mask.png": { width: 400, height: 100 },
    };
    const animated = image("frame-a.png", {
      frames: [
        { id: "frame-a", src: "frame-a.png" },
        { id: "frame-b", src: "frame-b.png" },
      ],
      maskEnabled: true,
      maskSrc: "mask.png",
      filterMaskEnabled: true,
      filterMaskSrc: "filter-mask.png",
    });
    const result = await inspectStudioRasterAssets([page([animated])], {
      probe: async (source) => dimensions[source]!,
    });
    const found = codes(result);

    expect(found.has("ANIMATION_FRAME_DIMENSION_MISMATCH")).toBe(true);
    expect(found.has("MASK_DIMENSION_MISMATCH")).toBe(true);
    expect(
      result.issues.filter((issue) => issue.code === "MASK_DIMENSION_MISMATCH")
    ).toHaveLength(2);
  });

  it("bounds work, reports skipped assets, and emits monotonic progress", async () => {
    const progress: Array<{ completed: number; total: number }> = [];
    const elements = ["one.png", "two.png", "three.png"].map((source, index) =>
      image(source, { id: `image-${index + 1}` })
    );
    const result = await inspectStudioRasterAssets([page(elements)], {
      maxSources: 2,
      concurrency: 1,
      probe: async () => ({ width: 400, height: 200 }),
      onProgress: (value) => progress.push(value),
    });

    expect(result.probedSourceCount).toBe(2);
    expect(result.skippedSourceCount).toBe(1);
    expect(codes(result).has("RASTER_PROBE_LIMIT_REACHED")).toBe(true);
    expect(progress[0]).toEqual({ completed: 0, total: 2 });
    expect(progress.at(-1)).toEqual({ completed: 2, total: 2 });
    expect(progress.map((item) => item.completed)).toEqual([0, 1, 2]);
  });

  it("stops cleanly when the caller aborts before probing", async () => {
    const controller = new AbortController();
    controller.abort();
    const probe = vi.fn(async () => ({ width: 400, height: 200 }));
    const result = await inspectStudioRasterAssets([page([image("asset.png")])], {
      signal: controller.signal,
      probe,
    });

    expect(result.status).toBe("aborted");
    expect(result.issues).toEqual([]);
    expect(probe).not.toHaveBeenCalled();
  });
});
