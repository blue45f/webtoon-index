import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_BG3D_ARTIFACT_CAPTURE_KIND,
  STUDIO_BG3D_ARTIFACT_CAPTURE_PROFILE,
  STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
  STUDIO_BG3D_STABLE_ID_PROFILE,
} from "./studio-bg3d-artifact-capture-v2";
import {
  captureStudioBg3dMagicObjectIds,
  STUDIO_BG3D_MAGIC_OBJECT_ID_RUNTIME_CAPABILITIES,
  StudioBg3dMagicObjectIdCaptureError,
  type StudioBg3dMagicBabylonBackend,
  type StudioBg3dMagicObjectIdRuntimeFactoryInput,
} from "./studio-bg3d-magic-object-id-capture";
import {
  createStudioBg3dRuntimeSnapshot,
  type StudioBg3dRuntimeAdapter,
  type StudioBg3dRuntimeAdapterJob,
  type StudioBg3dSpecialistResult,
} from "./studio-bg3d-runtime-adapter";
import { DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT } from "./studio-bg3d-scene-document";

const snapshot = createStudioBg3dRuntimeSnapshot(
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  new Map(),
);

function successResult(width: number, height: number): StudioBg3dSpecialistResult {
  const objectIds = new Uint32Array(width * height);
  objectIds[Math.floor(objectIds.length / 2)] = 1;
  return {
    kind: STUDIO_BG3D_ARTIFACT_CAPTURE_KIND,
    version: STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
    profile: STUDIO_BG3D_ARTIFACT_CAPTURE_PROFILE,
    width,
    height,
    artifacts: [{
      kind: "object-id",
      width,
      height,
      profile: STUDIO_BG3D_STABLE_ID_PROFILE,
      data: objectIds,
      legend: [{
        id: 1,
        stableId: "obj/selected",
        label: "Selected",
      }],
    }],
  };
}

function adapter(
  backend: StudioBg3dMagicBabylonBackend,
  run: (job: StudioBg3dRuntimeAdapterJob) => Promise<StudioBg3dSpecialistResult>,
  dispose = vi.fn(),
): StudioBg3dRuntimeAdapter {
  return {
    runtimeId: backend === "webgpu" ? "babylon-webgpu-lab" : "babylon-webgl-lab",
    capabilities: new Set([
      "capture-rgba-depth",
      "multi-artifact-capture",
      backend === "webgpu" ? "webgpu" : "webgl",
    ]),
    runIsolated: run,
    dispose,
  };
}

function input(
  createRuntime: (
    backend: StudioBg3dMagicBabylonBackend,
  ) => StudioBg3dRuntimeAdapter,
  backends: readonly StudioBg3dMagicBabylonBackend[] = ["webgpu"],
) {
  return {
    snapshot,
    width: 3,
    height: 2,
    jobId: "magic-object-id",
    backends,
    createCanvas: vi.fn(() => ({ width: 0, height: 0 })),
    createRuntime: vi.fn(({ backend }: StudioBg3dMagicObjectIdRuntimeFactoryInput) =>
      createRuntime(backend)
    ),
  };
}

describe("captureStudioBg3dMagicObjectIds", () => {
  it("returns a defensive canonical object-ID receipt from the preferred backend", async () => {
    const webGpuResult = successResult(3, 2);
    const jobs: StudioBg3dRuntimeAdapterJob[] = [];
    const disposeWebGpu = vi.fn();
    const disposeWebGl = vi.fn();
    const request = input((backend) =>
      adapter(
        backend,
        async (job) => {
          jobs.push(job);
          return backend === "webgpu" ? webGpuResult : successResult(3, 2);
        },
        backend === "webgpu" ? disposeWebGpu : disposeWebGl,
      )
    );

    const result = await captureStudioBg3dMagicObjectIds(request);

    expect(result).toMatchObject({
      width: 3,
      height: 2,
      backend: "webgpu",
      legend: [{ id: 1, stableId: "obj/selected", label: "Selected" }],
      attempts: [{ runtimeId: "babylon-webgpu-lab", outcome: "succeeded" }],
    });
    expect([...result.objectIds]).toEqual([0, 0, 0, 1, 0, 0]);
    expect(request.createRuntime).toHaveBeenCalledTimes(1);
    for (const [factoryInput] of request.createRuntime.mock.calls) {
      expect(factoryInput.capabilities)
        .toBe(STUDIO_BG3D_MAGIC_OBJECT_ID_RUNTIME_CAPABILITIES);
    }
    expect(jobs).toHaveLength(1);
    const capturedJob = jobs[0];
    expect(capturedJob?.request).toEqual({
      kind: "artifact-capture-v2",
      version: STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
      width: 3,
      height: 2,
      artifacts: [{
        kind: "object-id",
        profile: STUDIO_BG3D_STABLE_ID_PROFILE,
      }],
    });
    expect(Object.isFrozen(capturedJob?.request)).toBe(true);
    if (!capturedJob || capturedJob.request.kind !== "artifact-capture-v2") {
      throw new Error("expected canonical artifact capture request");
    }
    expect(Object.isFrozen(capturedJob.request.artifacts)).toBe(true);
    expect(Object.isFrozen(capturedJob.request.artifacts[0])).toBe(true);
    const source = webGpuResult.kind === STUDIO_BG3D_ARTIFACT_CAPTURE_KIND
      ? webGpuResult.artifacts[0]
      : null;
    if (source?.kind !== "object-id") throw new Error("invalid fixture");
    source.data.fill(9);
    expect([...result.objectIds]).toEqual([0, 0, 0, 1, 0, 0]);
    expect(disposeWebGpu).toHaveBeenCalledOnce();
    expect(disposeWebGl).not.toHaveBeenCalled();
  });

  it("fails closed on an eligible WebGPU failure without constructing WebGL2", async () => {
    const webGlRun = vi.fn(async () => successResult(3, 2));
    const request = input((backend) =>
      adapter(backend, async () => {
        if (backend === "webgpu") {
          throw Object.assign(new Error("device unavailable"), {
            code: "engine-init-failed",
          });
        }
        return webGlRun();
      })
    );

    await expect(captureStudioBg3dMagicObjectIds(request)).rejects.toMatchObject({
      code: "capture-failed",
    });
    expect(request.createRuntime).toHaveBeenCalledTimes(1);
    expect(request.createRuntime).toHaveBeenCalledWith(expect.objectContaining({
      backend: "webgpu",
    }));
    expect(webGlRun).not.toHaveBeenCalled();
  });

  it("runs WebGL2 when it is the one explicit backend", async () => {
    const request = input(
      (backend) => adapter(backend, async () => successResult(3, 2)),
      ["webgl2"],
    );
    const result = await captureStudioBg3dMagicObjectIds(request);
    expect(result).toMatchObject({
      backend: "webgl2",
      attempts: [{ runtimeId: "babylon-webgl-lab", outcome: "succeeded" }],
    });
    expect(request.createRuntime).toHaveBeenCalledTimes(1);
  });

  it("keeps unknown failures terminal instead of hiding them behind fallback", async () => {
    const webGlRun = vi.fn(async () => successResult(3, 2));
    const request = input((backend) =>
      adapter(
        backend,
        backend === "webgpu"
          ? async () => {
            throw new Error("programming defect");
          }
          : webGlRun,
      )
    );

    await expect(captureStudioBg3dMagicObjectIds(request)).rejects.toMatchObject({
      code: "capture-failed",
    });
    expect(webGlRun).not.toHaveBeenCalled();
  });

  it("fails closed on malformed dimensions, multiple backends, or returned artifact", async () => {
    const valid = input((backend) => adapter(backend, async () => successResult(3, 2)));
    await expect(captureStudioBg3dMagicObjectIds({
      ...valid,
      width: 0,
    })).rejects.toBeInstanceOf(StudioBg3dMagicObjectIdCaptureError);
    await expect(captureStudioBg3dMagicObjectIds({
      ...valid,
      backends: ["webgl2", "webgl2"],
    })).rejects.toMatchObject({ code: "invalid-input" });
    await expect(captureStudioBg3dMagicObjectIds({
      ...valid,
      backends: ["webgpu", "webgl2"],
    })).rejects.toMatchObject({ code: "invalid-input" });

    const malformed = input((backend) =>
      adapter(backend, async () => ({
        ...successResult(3, 2),
        width: 4,
      } as StudioBg3dSpecialistResult)),
      ["webgl2"],
    );
    await expect(captureStudioBg3dMagicObjectIds(malformed)).rejects.toMatchObject({
      code: "capture-failed",
    });
  });

  it("propagates abort and still disposes every registered runtime", async () => {
    const controller = new AbortController();
    const disposers = [vi.fn(), vi.fn()];
    const request = input((backend) =>
      adapter(backend, async (job) => {
        controller.abort();
        if (!job.signal.aborted) throw new Error("expected shared abort signal");
        throw Object.assign(new Error("aborted"), { code: "aborted" });
      }, disposers[backend === "webgpu" ? 0 : 1])
    );

    await expect(captureStudioBg3dMagicObjectIds({
      ...request,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: "aborted", name: "AbortError" });
    expect(disposers[0]).toHaveBeenCalledOnce();
    expect(disposers[1]).not.toHaveBeenCalled();
  });

  it("sizes every caller-owned canvas before constructing its runtime", async () => {
    const canvasRecords: { width: number; height: number }[] = [];
    const request = input((backend) =>
      adapter(backend, async () => successResult(3, 2))
    );
    request.createCanvas.mockImplementation(() => {
      const canvas = { width: 0, height: 0 };
      canvasRecords.push(canvas);
      return canvas;
    });

    await captureStudioBg3dMagicObjectIds(request);

    expect(canvasRecords).toEqual([{ width: 3, height: 2 }]);
  });
});
