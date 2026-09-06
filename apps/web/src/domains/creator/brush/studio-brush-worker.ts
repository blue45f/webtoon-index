/// <reference lib="webworker" />
/**
 * Dedicated Web Worker for background brush stroke calculation & smoothing.
 */
import { processFreehandPoints } from "../studio-brush";

import {
  STUDIO_BRUSH_WORKER_PROTOCOL_VERSION,
  type StudioBrushWorkerPlanRequest,
  type StudioBrushWorkerPlanResponse,
} from "./studio-brush-worker-protocol";

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const data = event.data as Partial<StudioBrushWorkerPlanRequest> | null;
  if (!data || data.version !== STUDIO_BRUSH_WORKER_PROTOCOL_VERSION || typeof data.id !== "string") {
    return;
  }

  try {
    const points = Array.isArray(data.points) ? data.points : [];
    const minDistance = typeof data.sampleSpacing === "number" ? Math.max(0.5, data.sampleSpacing) : 3;
    const smoothed = processFreehandPoints(points, minDistance);

    const response: StudioBrushWorkerPlanResponse = {
      version: STUDIO_BRUSH_WORKER_PROTOCOL_VERSION,
      id: data.id,
      ok: true,
      points: smoothed,
      dabCount: Math.floor(smoothed.length / 2),
    };

    workerScope.postMessage(response);
  } catch (error) {
    const response: StudioBrushWorkerPlanResponse = {
      version: STUDIO_BRUSH_WORKER_PROTOCOL_VERSION,
      id: data.id,
      ok: false,
      points: Array.isArray(data.points) ? data.points : [],
      dabCount: 0,
      error: error instanceof Error ? error.message : "worker-stroke-failed",
    };

    workerScope.postMessage(response);
  }
});
