import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1,
  STUDIO_BG3D_THREE_WEBGL_CAPTURE_IMPLEMENTATION_V1,
} from "./studio-bg3d-capture-adapter";
import {
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  serializeStudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";
import {
  STUDIO_BG3D_SHOT_BATCH_LT_PIPELINE_V1,
  STUDIO_BG3D_SHOT_BATCH_PNG_ENCODING_V1,
  STUDIO_BG3D_SHOT_BATCH_PSD_ENCODING_V1,
  createStudioBg3dShotBatchPlan,
} from "./studio-bg3d-shot-batch-plan";
import {
  createStudioBg3dShotBatchQueue,
  failStudioBg3dShotBatchQueueItem,
  isStudioBg3dShotBatchQueueCompatible,
  retryStudioBg3dShotBatchQueue,
  startStudioBg3dShotBatchQueueItem,
  studioBg3dShotBatchQueueCompletedCount,
  succeedStudioBg3dShotBatchQueueItem,
  waitForStudioBg3dBatchDocumentVisible,
} from "./studio-bg3d-shot-batch-queue";

async function plan(revision = "scene-a") {
  const shots = [
    { id: "shot-a", name: "A" },
    { id: "shot-b", name: "B" },
  ];
  const sourceRevision = serializeStudioBg3dSceneDocument({
    ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
    shots,
    render: {
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.render,
      exposure: revision === "scene-a" ? 1 : 1.1,
    },
    output: {
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.output,
      exportHeight: 360,
    },
  });
  if (!sourceRevision) throw new Error("canonical test scene unavailable");
  const result = await createStudioBg3dShotBatchPlan(shots, {
    sourceRevision,
    scope: {
      durability: "durable",
      authUserId: "user-a",
      workId: "work-a",
      pageId: "page-a",
      elementId: "element-a",
    },
    capture: {
      owner: {
        backend: "three-webgl",
        engineId: "three",
        engineRevision: "184",
        implementationRevision: STUDIO_BG3D_THREE_WEBGL_CAPTURE_IMPLEMENTATION_V1,
        graphicsApi: "webgl2",
        profileId: STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1,
        sourceWidth: 640,
        sourceHeight: 360,
        maxPixels: 1_000_000,
        maxEdge: 4_096,
        deviceProfile: "desktop",
        textureScale: 1,
        lodBias: 0,
        ltPipelineId: STUDIO_BG3D_SHOT_BATCH_LT_PIPELINE_V1,
        pngEncodingId: STUDIO_BG3D_SHOT_BATCH_PNG_ENCODING_V1,
        psdEncodingId: STUDIO_BG3D_SHOT_BATCH_PSD_ENCODING_V1,
      },
      shots: shots.map(({ id }) => ({
        shotId: id,
        width: 640,
        height: 360,
        requestedHeight: 360,
        wasReduced: false,
        includeDepth: false,
        shadows: true,
        shadowMapSize: 1_024,
        background: { color: "#ffffff", alpha: 1 },
      })),
    },
  });
  if (!result.ok) throw new Error(result.message);
  return result.plan;
}

describe("Studio BG3D retryable shot queue", () => {
  it("allows only pending→running→succeeded|failed and preserves successes on retry", async () => {
    const initial = createStudioBg3dShotBatchQueue(await plan());
    const runningA = startStudioBg3dShotBatchQueueItem(initial, "shot-a")!;
    expect(startStudioBg3dShotBatchQueueItem(runningA, "shot-b")).toBeNull();
    expect(succeedStudioBg3dShotBatchQueueItem(initial, "shot-a")).toBeNull();
    const succeededA = succeedStudioBg3dShotBatchQueueItem(runningA, "shot-a")!;
    const runningB = startStudioBg3dShotBatchQueueItem(succeededA, "shot-b")!;
    const failedB = failStudioBg3dShotBatchQueueItem(runningB, "shot-b", "capture-failed")!;
    const retry = retryStudioBg3dShotBatchQueue(failedB);

    expect(studioBg3dShotBatchQueueCompletedCount(retry)).toBe(1);
    expect(retry.items).toEqual([
      { shotId: "shot-a", status: "succeeded", attempts: 1 },
      { shotId: "shot-b", status: "pending", attempts: 1 },
    ]);
    expect(initial.items.every(({ status }) => status === "pending")).toBe(true);
  });

  it("invalidates recovery when the canonical source or scope changes", async () => {
    const first = await plan("scene-a");
    const queue = createStudioBg3dShotBatchQueue(first);
    expect(isStudioBg3dShotBatchQueueCompatible(queue, await plan("scene-a"))).toBe(true);
    expect(isStudioBg3dShotBatchQueueCompatible(queue, await plan("scene-b"))).toBe(false);
  });

  it("turns interrupted running/failed work back into pending without replaying successes", async () => {
    const initial = createStudioBg3dShotBatchQueue(await plan());
    const running = startStudioBg3dShotBatchQueueItem(initial, "shot-a")!;
    const recovered = retryStudioBg3dShotBatchQueue(running);
    expect(recovered.items).toEqual([
      { shotId: "shot-a", status: "pending", attempts: 1 },
      { shotId: "shot-b", status: "pending", attempts: 0 },
    ]);
  });

  it("waits while hidden, resumes on visibility, and removes listeners on abort", async () => {
    let visibilityState = "hidden";
    const listeners = new Set<() => void>();
    const visibilityDocument = {
      get visibilityState() { return visibilityState; },
      addEventListener: vi.fn((_type: "visibilitychange", listener: () => void) => listeners.add(listener)),
      removeEventListener: vi.fn((_type: "visibilitychange", listener: () => void) => listeners.delete(listener)),
    };
    let resolved = false;
    const waiting = waitForStudioBg3dBatchDocumentVisible(visibilityDocument).then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    visibilityState = "visible";
    for (const listener of listeners) listener();
    await waiting;
    expect(resolved).toBe(true);
    expect(listeners.size).toBe(0);

    visibilityState = "hidden";
    const controller = new AbortController();
    const aborted = waitForStudioBg3dBatchDocumentVisible(visibilityDocument, controller.signal);
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    expect(listeners.size).toBe(0);
  });
});
