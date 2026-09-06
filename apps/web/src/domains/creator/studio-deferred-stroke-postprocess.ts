import { isStudioDynamicBrushCausalDepositPipeline } from "./brush/studio-brush-dynamics";
import {
  planStudioStrokePostprocess,
  type StudioStrokePostprocessPlan,
} from "./brush/studio-stroke-postprocess-worker-planner";
import { isStudioPixelPencilRenderMode } from "./studio-pixel-pencil";

import type { DrawEl } from "./studio-element-model";

/**
 * Leaves a small margin before the editor's 200ms deferred-commit timer. A slow or crashed
 * worker therefore never owns document durability: the unchanged authoritative stroke remains
 * eligible for the normal commit when this deadline expires.
 */
export const STUDIO_DEFERRED_STROKE_POSTPROCESS_TIMEOUT_MS = 175;

export interface StudioDeferredStrokePostprocessInput {
  readonly stroke: DrawEl;
  readonly strength: number;
  readonly causalStateSealed: boolean;
  readonly quickShapeActive: boolean;
  readonly workerAvailable: boolean;
}

export interface StudioPendingStrokePostprocessBatch {
  readonly pageId: string;
  strokes: DrawEl[];
}

export interface StudioDeferredStrokePostprocessTarget {
  readonly pageId: string;
  readonly strokeId: string;
  readonly sourcePoints: readonly number[];
}

export type StudioPendingStrokePostprocessReplacement =
  | "invalid-result"
  | "missing-batch"
  | "replaced"
  | "stale-stroke";

/**
 * Selects only large, ordinary freehand strokes whose exact live pixels can remain visible in
 * the editor's existing deferred-commit window. QuickShape and immediate-compositing tools keep
 * their synchronous release semantics.
 */
export function planStudioDeferredStrokePostprocess(
  input: StudioDeferredStrokePostprocessInput,
): StudioStrokePostprocessPlan | null {
  const stroke = input.stroke;
  if (
    input.quickShapeActive
    || input.causalStateSealed
    || input.strength <= 0
    || stroke.mode === "eraser"
    || (stroke.kind ?? "freehand") !== "freehand"
    || isStudioPixelPencilRenderMode(stroke.brush)
    || stroke.stampPipeline === "causal-walker-v2"
    || stroke.watercolorPipeline === "causal-walker-v2"
    || (
      stroke.brushDynamics?.depositPipeline !== undefined
      && isStudioDynamicBrushCausalDepositPipeline(
        stroke.brushDynamics.depositPipeline,
      )
    )
  ) {
    return null;
  }
  const plan = planStudioStrokePostprocess({
    coordinateCount: stroke.points.length,
    strength: input.strength,
    workerAvailable: input.workerAvailable,
  });
  return plan.kind === "worker" ? plan : null;
}

function isValidCorrectedPointPayload(
  sourcePoints: readonly number[],
  correctedPoints: readonly number[],
): boolean {
  if (correctedPoints.length !== sourcePoints.length || correctedPoints.length % 2 !== 0) {
    return false;
  }
  return correctedPoints.every(Number.isFinite);
}

/**
 * Applies a Worker result only while the same pending stroke still owns the same immutable point
 * array. A timer flush, page switch, retry, replacement, or deletion makes the result stale and
 * leaves the durable document untouched.
 */
export function replaceStudioPendingStrokePostprocess(
  batch: StudioPendingStrokePostprocessBatch | null,
  target: StudioDeferredStrokePostprocessTarget,
  correctedPoints: readonly number[],
): StudioPendingStrokePostprocessReplacement {
  if (!isValidCorrectedPointPayload(target.sourcePoints, correctedPoints)) {
    return "invalid-result";
  }
  if (!batch || batch.pageId !== target.pageId) return "missing-batch";
  const index = batch.strokes.findIndex((stroke) => stroke.id === target.strokeId);
  if (index < 0) return "stale-stroke";
  const stroke = batch.strokes[index];
  if (!stroke || stroke.points !== target.sourcePoints) return "stale-stroke";
  batch.strokes[index] = {
    ...stroke,
    points: Array.from(correctedPoints),
  };
  return "replaced";
}
