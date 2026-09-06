import { describe, expect, it, vi } from "vitest";

import {
  runStudioVrmComponentPsdExport,
  type StudioVrmComponentPsdExportProgress,
} from "./studio-vrm-component-psd-export-job";

import type { StudioVrmLinkedSceneDescriptor } from "./studio-vrm-component-psd";

const SCENE: StudioVrmLinkedSceneDescriptor = Object.freeze({
  sceneId: "scene-variant-a",
  sceneRevision: 21,
  cameraId: "camera-main",
  renderPresetId: "toon-ink-v3",
  width: 2,
  height: 2,
});

const RENDERABLES = Object.freeze([
  Object.freeze({ objectId: "hair", objectName: "Hair_Bangs" }),
  Object.freeze({ objectId: "eyes", objectName: "Iris" }),
  Object.freeze({ objectId: "skin", objectName: "Face_Skin" }),
  Object.freeze({ objectId: "clothes", objectName: "Hero_Jacket" }),
  Object.freeze({ objectId: "props", objectName: "Glasses_Accessory" }),
]);

function pixels(seed: number): Uint8Array {
  return Uint8Array.from({ length: 16 }, (_, index) => (seed + index * 13) % 256);
}

describe("VRM component PSD export job", () => {
  it("captures every semantic request serially and emits a real editable PSD package", async () => {
    const active: string[] = [];
    let concurrent = 0;
    let maximumConcurrent = 0;
    const progress: StudioVrmComponentPsdExportProgress[] = [];
    const capture = vi.fn(async (request: { id: string }) => {
      concurrent += 1;
      maximumConcurrent = Math.max(maximumConcurrent, concurrent);
      active.push(request.id);
      await Promise.resolve();
      concurrent -= 1;
      return pixels(active.length * 19);
    });

    const result = await runStudioVrmComponentPsdExport({
      scene: SCENE,
      renderables: RENDERABLES,
      capture,
      onProgress: (entry) => progress.push(entry),
    });

    expect(maximumConcurrent).toBe(1);
    expect(active).toEqual(result.plan.requests.map(({ id }) => id));
    expect(capture).toHaveBeenCalledTimes(result.plan.requests.length);
    expect(new TextDecoder("ascii").decode(result.package.bytes.subarray(0, 4))).toBe("8BPS");
    expect(result.package.manifest.passes.map(({ id }) => id)).toEqual(active);
    expect(progress[0]).toEqual({ phase: "planning", completed: 0, total: 0 });
    expect(progress.at(-1)).toEqual({
      phase: "complete",
      completed: result.plan.requests.length,
      total: result.plan.requests.length,
    });
  });

  it("requires an explicit review decision before exporting ambiguous component models", async () => {
    const capture = vi.fn(async () => pixels(1));
    await expect(runStudioVrmComponentPsdExport({
      scene: SCENE,
      renderables: [{ objectId: "mesh-unknown", objectName: "Mesh_042" }],
      capture,
    })).rejects.toThrow(/requires review/u);
    expect(capture).not.toHaveBeenCalled();

    await expect(runStudioVrmComponentPsdExport({
      scene: SCENE,
      renderables: [{ objectId: "mesh-unknown", objectName: "Mesh_042" }],
      capture,
      allowReviewedAmbiguity: true,
    })).resolves.toEqual(expect.objectContaining({
      plan: expect.objectContaining({ requiresReview: true }),
    }));
    expect(capture).toHaveBeenCalled();
  });

  it("stops immediately when cancellation arrives between serial render passes", async () => {
    const controller = new AbortController();
    const captured: string[] = [];
    const capture = vi.fn(async (request: { id: string }) => {
      captured.push(request.id);
      controller.abort(new DOMException("closed by user", "AbortError"));
      return pixels(7);
    });

    await expect(runStudioVrmComponentPsdExport({
      scene: SCENE,
      renderables: RENDERABLES,
      capture,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(captured).toHaveLength(1);
  });

  it("rejects an invalid capture buffer before requesting another pass", async () => {
    const capture = vi.fn(async () => new Uint8Array(4));
    await expect(runStudioVrmComponentPsdExport({
      scene: SCENE,
      renderables: RENDERABLES,
      capture,
    })).rejects.toThrow(/16 RGBA bytes/u);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid dimensions before touching the renderer", async () => {
    const capture = vi.fn(async () => pixels(3));
    await expect(runStudioVrmComponentPsdExport({
      scene: { ...SCENE, width: 0 },
      renderables: RENDERABLES,
      capture,
    })).rejects.toThrow(/scene.width/u);
    expect(capture).not.toHaveBeenCalled();
  });
});
