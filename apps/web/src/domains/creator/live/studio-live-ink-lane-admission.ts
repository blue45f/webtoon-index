import { studioBrushGpuQualityEvidenceAllows } from "../brush/studio-brush-gpu-quality-evidence";

import type { DrawEl } from "../studio-element-model";

/**
 * Lane admission rules the editor host applies BEFORE it enters the selected WebGPU live-ink lane.
 *
 * `decideStudioLiveInkBackend` is the authority on whether the lane can render an operation, but
 * it answers after the lane has been selected, and the host's contract is that a selected lane is
 * either admitted or the stroke is refused. Selecting the lane for an operation it provably cannot
 * render therefore deleted the stroke instead of drawing it — and the headless shell the
 * long-stroke gate runs in never selects the GPU lane, so none of it was visible there.
 *
 * Measured on a browser with working WebGPU:
 *
 *  - a translucent brush (marker, opacity 0.6) left 0 px and raised "선택 거부 사유: opacity";
 *  - the eraser never erased and raised "선택 거부 사유: eraser".
 *
 * These predicates mirror the decision's style gates so an unrenderable style picks Canvas2D from
 * the start. That is a selection rule, not a hand-over after a GPU failure: the lane's own refusal
 * still owns real initialization, audit and journal failures.
 */
export function studioLiveInkLaneAdmitsStyle(element: DrawEl): boolean {
  // The lane always prepares a transparent overlay, so destination-out can never reach the
  // committed canvas below it, and a translucent stroke has no representation without a
  // preparation proof the planner does not build. Fills and symmetry need proofs of their own.
  return (element.opacity ?? 1) >= 0.999
    && element.mode !== "eraser"
    && !element.fill
    && (element.symmetry?.type ?? "none") === "none";
}

export interface StudioLiveInkLaneSelectionInput {
  readonly element: DrawEl;
  /** `VITE_STUDIO_LIVE_INK_BACKEND` — an explicit choice overrides the rollout either way. */
  readonly explicitBackend: string | undefined;
  readonly hardwareReady: boolean;
  readonly rolloutPrefersGpu: boolean;
}

/** Whether the WebGPU live-ink lane may own this operation at all. */
export function studioLiveInkLaneSelectsGpu(input: StudioLiveInkLaneSelectionInput): boolean {
  if (input.explicitBackend === "canvas2d") return false;
  if (!studioLiveInkLaneAdmitsStyle(input.element)) return false;
  if (input.explicitBackend === "webgpu") return true;
  return input.rolloutPrefersGpu
    && input.hardwareReady
    && studioBrushGpuQualityEvidenceAllows(input.element.brushCatalogId);
}

/**
 * Completes the previous stroke's deferred commit at the moment a new stroke is admitted.
 *
 * The admission guard refuses new surface work while a WebGPU authority is queued. That queue was
 * held by the 2 s idle timer rather than by a missing receipt, so an artist hatching at a 0.6 s
 * interval lost every second stroke. A new stroke ends the previous stroke's idle window by
 * definition, and the commit plus its surface-release layout effect must finish in the same task
 * the guard reads — which is what the caller's synchronous flush buys. The flush keeps its own
 * terminal receipt gate, so a genuinely unreceipted stroke still refuses honestly.
 */
export function commitPendingStrokeBatchForAdmission(
  pendingGpuAuthority: boolean,
  admissionFlushRef: { current: boolean },
  flushPendingStrokeCommitsSync: () => void,
): void {
  if (!pendingGpuAuthority) return;
  admissionFlushRef.current = true;
  try {
    flushPendingStrokeCommitsSync();
  } finally {
    admissionFlushRef.current = false;
  }
}
