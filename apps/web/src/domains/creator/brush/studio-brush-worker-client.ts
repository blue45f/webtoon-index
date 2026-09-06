/**
 * Web Worker client for asynchronous brush stroke calculation.
 */
import { processFreehandPoints } from "../studio-brush";

import {
  STUDIO_BRUSH_WORKER_PROTOCOL_VERSION,
  type StudioBrushWorkerPlanRequest,
  type StudioBrushWorkerPlanResponse,
} from "./studio-brush-worker-protocol";

let globalBrushWorker: Worker | null = null;
const pendingRequests = new Map<
  string,
  { resolve: (res: StudioBrushWorkerPlanResponse) => void; reject: (err: unknown) => void }
>();

function getOrCreateBrushWorker(): Worker | null {
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  if (globalBrushWorker) return globalBrushWorker;

  try {
    globalBrushWorker = new Worker(
      new URL("./studio-brush-worker.ts", import.meta.url),
      { type: "module" }
    );

    globalBrushWorker.onmessage = (event: MessageEvent<StudioBrushWorkerPlanResponse>) => {
      const data = event.data;
      if (!data || typeof data.id !== "string") return;
      const deferred = pendingRequests.get(data.id);
      if (!deferred) return;
      pendingRequests.delete(data.id);
      deferred.resolve(data);
    };

    globalBrushWorker.onerror = (err) => {
      for (const [id, deferred] of pendingRequests.entries()) {
        pendingRequests.delete(id);
        deferred.reject(err);
      }
    };

    return globalBrushWorker;
  } catch {
    return null;
  }
}

let requestIdCounter = 0;

export async function processFreehandPointsInWorker(
  points: number[],
  minDistance?: number,
  brushId = "pen",
  strokeWidth = 6,
  seed = 42
): Promise<number[]> {
  const worker = getOrCreateBrushWorker();
  if (!worker) {
    return processFreehandPoints(points, minDistance);
  }

  const id = `brush-work-${++requestIdCounter}-${Date.now()}`;
  const request: StudioBrushWorkerPlanRequest = {
    version: STUDIO_BRUSH_WORKER_PROTOCOL_VERSION,
    id,
    brushId,
    points,
    strokeWidth,
    seed,
    sampleSpacing: minDistance,
  };

  return new Promise<number[]>((resolve) => {
    pendingRequests.set(id, {
      resolve: (res) => resolve(res.ok ? res.points : processFreehandPoints(points, minDistance)),
      reject: () => resolve(processFreehandPoints(points, minDistance)),
    });
    worker.postMessage(request);
  });
}
