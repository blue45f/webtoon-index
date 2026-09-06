import type { StudioBg3dShotBatchPlan } from "./studio-bg3d-shot-batch-plan";

export type StudioBg3dShotBatchQueueStatus = "pending" | "running" | "succeeded" | "failed";
export type StudioBg3dShotBatchFailureCode =
  | "scene-restore-failed"
  | "view-timeout"
  | "capture-failed"
  | "raster-failed"
  | "encode-failed"
  | "artifact-budget-exceeded"
  | "visibility-interrupted"
  | "unknown";

export const STUDIO_BG3D_SHOT_BATCH_MAX_ATTEMPTS = 1_000;

export interface StudioBg3dShotBatchQueueItem {
  readonly shotId: string;
  readonly status: StudioBg3dShotBatchQueueStatus;
  readonly attempts: number;
  readonly failureCode?: StudioBg3dShotBatchFailureCode;
}

export interface StudioBg3dShotBatchQueue {
  readonly version: 2;
  readonly resumeKey: string;
  readonly items: readonly StudioBg3dShotBatchQueueItem[];
}

function replaceItem(
  queue: StudioBg3dShotBatchQueue,
  shotId: string,
  replace: (item: StudioBg3dShotBatchQueueItem) => StudioBg3dShotBatchQueueItem | null,
): StudioBg3dShotBatchQueue | null {
  const index = queue.items.findIndex((item) => item.shotId === shotId);
  if (index < 0) return null;
  const nextItem = replace(queue.items[index]!);
  if (!nextItem) return null;
  const items = [...queue.items];
  items[index] = nextItem;
  return { ...queue, items };
}

export function createStudioBg3dShotBatchQueue(
  plan: StudioBg3dShotBatchPlan,
): StudioBg3dShotBatchQueue {
  return {
    version: 2,
    resumeKey: plan.resumeKey,
    items: plan.shots.map(({ shotId }) => ({
      shotId,
      status: "pending",
      attempts: 0,
    })),
  };
}

export function isStudioBg3dShotBatchQueueCompatible(
  queue: StudioBg3dShotBatchQueue,
  plan: StudioBg3dShotBatchPlan,
): boolean {
  return queue.version === 2 &&
    queue.resumeKey === plan.resumeKey &&
    queue.items.length === plan.shots.length &&
    queue.items.every((item, index) => item.shotId === plan.shots[index]?.shotId);
}

export function retryStudioBg3dShotBatchQueue(
  queue: StudioBg3dShotBatchQueue,
): StudioBg3dShotBatchQueue {
  return {
    ...queue,
    items: queue.items.map((item) => item.status === "succeeded"
      ? item
      : { shotId: item.shotId, status: "pending", attempts: item.attempts }),
  };
}

export function startStudioBg3dShotBatchQueueItem(
  queue: StudioBg3dShotBatchQueue,
  shotId: string,
): StudioBg3dShotBatchQueue | null {
  if (queue.items.some((item) => item.status === "running")) return null;
  return replaceItem(queue, shotId, (item) => item.status === "pending" &&
    item.attempts < STUDIO_BG3D_SHOT_BATCH_MAX_ATTEMPTS
    ? { shotId, status: "running", attempts: item.attempts + 1 }
    : null);
}

export function succeedStudioBg3dShotBatchQueueItem(
  queue: StudioBg3dShotBatchQueue,
  shotId: string,
): StudioBg3dShotBatchQueue | null {
  return replaceItem(queue, shotId, (item) => item.status === "running"
    ? { shotId, status: "succeeded", attempts: item.attempts }
    : null);
}

export function failStudioBg3dShotBatchQueueItem(
  queue: StudioBg3dShotBatchQueue,
  shotId: string,
  failureCode: StudioBg3dShotBatchFailureCode,
): StudioBg3dShotBatchQueue | null {
  return replaceItem(queue, shotId, (item) => item.status === "running"
    ? { shotId, status: "failed", attempts: item.attempts, failureCode }
    : null);
}

export function studioBg3dShotBatchQueueCompletedCount(
  queue: StudioBg3dShotBatchQueue,
): number {
  return queue.items.filter(({ status }) => status === "succeeded").length;
}

interface VisibilityDocumentLike {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

function visibilityAbortError(): Error {
  const error = new Error("컷 배치 표시 상태 대기를 취소했습니다.");
  error.name = "AbortError";
  return error;
}

/** RAF-based capture must not enter a new shot while the browser has suspended a hidden tab. */
export function waitForStudioBg3dBatchDocumentVisible(
  visibilityDocument: VisibilityDocumentLike,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return Promise.reject(visibilityAbortError());
  if (visibilityDocument.visibilityState !== "hidden") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      visibilityDocument.removeEventListener("visibilitychange", onVisibility);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onVisibility = () => {
      if (visibilityDocument.visibilityState !== "hidden") finish(resolve);
    };
    const onAbort = () => finish(() => reject(visibilityAbortError()));
    visibilityDocument.addEventListener("visibilitychange", onVisibility);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
