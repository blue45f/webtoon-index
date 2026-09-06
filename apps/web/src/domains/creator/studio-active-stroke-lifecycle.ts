import { isCompleteStudioDrawOp } from "./brush/studio-draw-completion";

import type { DrawEl } from "./studio-element-model";

export type StudioActiveStrokePointerType = "pen" | "mouse" | "touch" | "unknown";

function lastFiniteSample(values: readonly number[] | undefined): number | null {
  const value = values?.at(-1);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * A live stroke does not advance the document generation until pointerup. This compact fingerprint
 * lets repeated pagehide/visibility snapshots notice a newer live prefix without retaining or
 * serializing a second full point array during normal editing.
 */
export function studioActiveStrokeRecoveryFingerprint(stroke: DrawEl | null): string {
  if (!stroke || !isCompleteStudioDrawOp(stroke)) return "";
  return JSON.stringify([
    stroke.id,
    stroke.kind ?? "freehand",
    stroke.mode ?? "pen",
    stroke.points.length,
    stroke.points.at(-2) ?? null,
    stroke.points.at(-1) ?? null,
    stroke.pressures?.length ?? 0,
    lastFiniteSample(stroke.pressures),
    stroke.tiltXs?.length ?? 0,
    lastFiniteSample(stroke.tiltXs),
    stroke.tiltYs?.length ?? 0,
    lastFiniteSample(stroke.tiltYs),
    stroke.twists?.length ?? 0,
    lastFiniteSample(stroke.twists),
  ]);
}

export interface StudioActiveStrokePendingBatch<Stroke extends DrawEl = DrawEl> {
  readonly pageId: string;
  readonly strokes: readonly Stroke[];
}

export type StudioActiveStrokeUnmountRecoveryPlan<Stroke extends DrawEl = DrawEl> =
  | { readonly action: "none"; readonly reason: "no-active-stroke" }
  | {
      readonly action: "discard";
      readonly reason: "touch-contact" | "unsupported-contact" | "incomplete-stroke";
      readonly strokeId: string;
    }
  | {
      readonly action: "already-recoverable";
      readonly reason: "stable-page" | "pending-batch";
      readonly strokeId: string;
    }
  | {
      readonly action: "blocked";
      readonly reason: "pending-page-conflict";
      readonly strokeId: string;
    }
  | {
      readonly action: "recover";
      readonly strokeId: string;
      readonly pending: {
        readonly pageId: string;
        readonly strokes: Stroke[];
      };
    };

/**
 * Decides whether an interrupted contact is meaningful enough for lifecycle recovery. Touch
 * contacts remain cancellation-owned because a route transition can race a two-finger navigation
 * gesture; only complete pen/mouse marks are promoted. The returned batch is idempotent by id and
 * never mutates the stable page or an existing deferred batch.
 */
export function planStudioActiveStrokeUnmountRecovery<Stroke extends DrawEl>(input: {
  readonly activeStroke: Stroke | null;
  readonly activePageId: string;
  readonly pointerType: StudioActiveStrokePointerType;
  readonly stableElementIds: ReadonlySet<string>;
  readonly pending: StudioActiveStrokePendingBatch<Stroke> | null;
}): StudioActiveStrokeUnmountRecoveryPlan<Stroke> {
  const stroke = input.activeStroke;
  if (!stroke) return { action: "none", reason: "no-active-stroke" };
  if (input.pointerType === "touch") {
    return { action: "discard", reason: "touch-contact", strokeId: stroke.id };
  }
  if (input.pointerType !== "pen" && input.pointerType !== "mouse") {
    return { action: "discard", reason: "unsupported-contact", strokeId: stroke.id };
  }
  if (!isCompleteStudioDrawOp(stroke)) {
    return { action: "discard", reason: "incomplete-stroke", strokeId: stroke.id };
  }
  if (input.stableElementIds.has(stroke.id)) {
    return { action: "already-recoverable", reason: "stable-page", strokeId: stroke.id };
  }
  if (input.pending?.strokes.some((candidate) => candidate.id === stroke.id)) {
    return { action: "already-recoverable", reason: "pending-batch", strokeId: stroke.id };
  }
  if (input.pending && input.pending.pageId !== input.activePageId) {
    return { action: "blocked", reason: "pending-page-conflict", strokeId: stroke.id };
  }
  return {
    action: "recover",
    strokeId: stroke.id,
    pending: {
      pageId: input.activePageId,
      strokes: [...(input.pending?.strokes ?? []), stroke],
    },
  };
}

export interface StudioDrawingUnmountLifecycleSteps {
  readonly promoteActiveStroke: () => void;
  readonly persistRecovery: () => void;
  readonly cleanupDrawing: () => void;
  readonly disposePointerTransport: () => void;
  readonly clearPendingCommit: () => void;
}

/**
 * Lifecycle cleanup must be best-effort and exhaustive. In particular, a detached CRDT document or
 * capture target may throw, but neither failure may prevent the local recovery write or the rest of
 * the browser-resource cleanup. Recovery intentionally precedes CRDT draft deletion.
 */
export function runStudioDrawingUnmountLifecycle(
  steps: StudioDrawingUnmountLifecycleSteps
): readonly unknown[] {
  const failures: unknown[] = [];
  const run = (step: () => void) => {
    try {
      step();
    } catch (cause) {
      failures.push(cause);
    }
  };

  run(steps.promoteActiveStroke);
  run(steps.persistRecovery);
  run(steps.cleanupDrawing);
  run(steps.disposePointerTransport);
  run(steps.clearPendingCommit);
  return failures;
}
