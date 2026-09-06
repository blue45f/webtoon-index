/**
 * One live-transform gesture's frame scheduler.
 *
 * Konva can emit several `transform` events before the browser can paint. Projecting every event
 * repeats route/clip work and scene-node writes that only the newest event can make visible. This
 * module keeps that pressure behind a two-method interface: callers offer frames, and dispose the
 * session when the gesture resolves. At most one newest frame crosses the renderer seam per rAF.
 *
 * The document is deliberately outside this module. Pointer-up remains the sole owner of geometry
 * baking, history and CRDT publication; this session can only drive a transient renderer adapter.
 */
import { classifyStudioLiveTransformPreviewFrame } from "./studio-live-transform-preview";

import type { StudioDrawObjectTransformBounds } from "./brush/studio-draw-object-transform";
import type { StudioLiveSelectionTransformFrame } from "./studio-live-canvas-gesture";
import type {
  StudioLiveTransformPreviewFrame,
  StudioLiveTransformPreviewNodeAttrs,
} from "./studio-live-transform-preview";
import type { StudioLiveTransformRenderRoute } from "./studio-live-transform-render-route";

export interface StudioLiveTransformPreviewPresentation {
  readonly frame: StudioLiveTransformPreviewFrame;
  readonly attrs: StudioLiveTransformPreviewNodeAttrs;
}

/** Renderer adapter at the transient-preview seam. It must never mutate the document. */
export interface StudioLiveTransformPreviewAdapter {
  /** Present affine authority; false means the adapter already restored release-only authority. */
  readonly apply: (presentation: StudioLiveTransformPreviewPresentation) => boolean;
  /**
   * O(1) renderer facts that can change an affine admission verdict without changing geometry.
   * When omitted, affine frames keep the original attrs-only dedupe contract.
   */
  readonly presentationEnvironmentKey?: () => string | number;
  /**
   * Optional exact fallback for a valid frame the retained affine cannot reproduce. The adapter
   * replans and presents the model draft; false keeps the honest release-only fallback.
   */
  readonly applyExact?: (frame: StudioLiveTransformPreviewFrame) => boolean;
  /** Return the renderer to the document-authored pose after an unsupported frame. */
  readonly neutralize: () => void;
}

/** Injectable rAF-shaped scheduler so generation and cancellation are deterministic in tests. */
export interface StudioLiveTransformPreviewScheduler {
  readonly requestFrame: (callback: () => void) => number;
  readonly cancelFrame: (handle: number) => void;
}

export interface StudioLiveTransformPreviewSession {
  /** Latest frame wins. Calls after disposal are intentionally ignored as late browser events. */
  readonly push: (frame: StudioLiveSelectionTransformFrame) => void;
  /** Cancels pending work and invalidates even an already-dispatched callback. Idempotent. */
  readonly dispose: () => void;
}

export interface CreateStudioLiveTransformPreviewSessionOptions {
  readonly sourceBounds: StudioDrawObjectTransformBounds;
  readonly renderRoute?: StudioLiveTransformRenderRoute;
  readonly scheduler: StudioLiveTransformPreviewScheduler;
  readonly adapter: StudioLiveTransformPreviewAdapter;
  /** Diagnostics only. Throwing here must never escape back into the pointer gesture. */
  readonly onError?: (error: unknown) => void;
  /**
   * Called only when a partial renderer write cannot be neutralized. The owner must cancel the
   * outer gesture because a safe authoritative handoff can no longer be proven.
   */
  readonly onFatalError?: (error: unknown) => void;
}

type StudioLiveTransformNeutralizationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: unknown };

const STUDIO_LIVE_TRANSFORM_NEUTRALIZED: StudioLiveTransformNeutralizationResult = {
  ok: true,
};

function sameAttrs(
  left: StudioLiveTransformPreviewNodeAttrs | null,
  right: StudioLiveTransformPreviewNodeAttrs,
): boolean {
  return left !== null
    && left.x === right.x
    && left.y === right.y
    && left.rotationDeg === right.rotationDeg
    && left.scaleX === right.scaleX
    && left.scaleY === right.scaleY
    && left.offsetX === right.offsetX
    && left.offsetY === right.offsetY;
}

/**
 * Creates a single-generation, latest-frame-wins preview session.
 *
 * Performance contract: `push` is O(1), schedules at most one callback, and performs no geometry,
 * renderer or document work. Classification and adapter writes happen at most once per animation
 * frame. Invalid transient readings hold the last valid pose; valid retained-affine rejections use
 * an exact model adapter when available and otherwise neutralize once so handles cannot leave
 * frozen ink behind.
 */
export function createStudioLiveTransformPreviewSession(
  options: CreateStudioLiveTransformPreviewSessionOptions,
): StudioLiveTransformPreviewSession {
  const sourceBounds = { ...options.sourceBounds };
  let disposed = false;
  let generation = 0;
  let scheduledFrame: number | null = null;
  let pending: StudioLiveSelectionTransformFrame | null = null;
  let presentedAttrs: StudioLiveTransformPreviewNodeAttrs | null = null;
  let presentedEnvironmentKey: string | number | undefined;
  let presentationKind: "none" | "affine" | "exact" = "none";

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // A diagnostic hook is not allowed to break the pointer gesture it observes.
    }
  };

  const forceNeutralize = (): StudioLiveTransformNeutralizationResult => {
    try {
      options.adapter.neutralize();
      return STUDIO_LIVE_TRANSFORM_NEUTRALIZED;
    } catch (error) {
      reportError(error);
      return { ok: false, error };
    }
  };

  const neutralize = (): StudioLiveTransformNeutralizationResult => {
    if (presentationKind === "none") return STUDIO_LIVE_TRANSFORM_NEUTRALIZED;
    const neutralized = forceNeutralize();
    presentedAttrs = null;
    presentedEnvironmentKey = undefined;
    presentationKind = "none";
    return neutralized;
  };

  const failFatally = (error: unknown): void => {
    if (disposed) return;
    disposed = true;
    generation += 1;
    pending = null;
    presentedAttrs = null;
    presentedEnvironmentKey = undefined;
    presentationKind = "none";
    try {
      options.onFatalError?.(error);
    } catch (fatalCallbackError) {
      reportError(fatalCallbackError);
    }
  };

  const present = (gestureFrame: StudioLiveSelectionTransformFrame): void => {
    const frame: StudioLiveTransformPreviewFrame = {
      sourceBounds,
      targetBounds: { ...gestureFrame.targetBounds },
      rotationDeg: gestureFrame.rotationDeg,
      ...(options.renderRoute !== undefined
        ? { renderRoute: options.renderRoute }
        : {}),
    };
    const projection = classifyStudioLiveTransformPreviewFrame(frame);
    if (!projection.ok) {
      // A malformed intermediate box commonly recovers on the next event, so retain the last good
      // pose. A valid unsupported pose first asks the model-backed adapter for an exact render;
      // only unavailable exact presentation falls back to a neutral, release-only gesture.
      if (projection.reason !== "invalid") {
        try {
          if (options.adapter.applyExact?.(frame) === true) {
            presentedAttrs = null;
            presentedEnvironmentKey = undefined;
            presentationKind = "exact";
            return;
          }
        } catch (error) {
          reportError(error);
          const neutralized = forceNeutralize();
          if (!neutralized.ok) {
            failFatally(error);
            return;
          }
          presentedAttrs = null;
          presentedEnvironmentKey = undefined;
          presentationKind = "none";
          return;
        }
        const neutralized = neutralize();
        if (!neutralized.ok) {
          // `applyExact === false` is safe only after the previously presented authority has been
          // restored. If that handoff fails, stop accepting frames and make the gesture owner
          // cancel; continuing could leave stale affine ink or a partially cleared exact draft.
          failFatally(neutralized.error);
        }
      }
      return;
    }
    try {
      const environmentKey = options.adapter.presentationEnvironmentKey?.();
      if (
        presentationKind === "affine"
        && sameAttrs(presentedAttrs, projection.attrs)
        && Object.is(presentedEnvironmentKey, environmentKey)
      ) {
        return;
      }
      const presented = options.adapter.apply({ frame, attrs: projection.attrs });
      if (!presented) {
        presentedAttrs = null;
        presentedEnvironmentKey = undefined;
        presentationKind = "none";
        return;
      }
      presentedAttrs = projection.attrs;
      presentedEnvironmentKey = environmentKey;
      presentationKind = "affine";
    } catch (error) {
      reportError(error);
      // `apply` may have completed only some scene writes. Best-effort neutralization makes the
      // next frame and the caller's eventual cleanup start from the document-authored pose.
      const neutralized = forceNeutralize();
      if (!neutralized.ok) {
        failFatally(error);
        return;
      }
      presentedAttrs = null;
      presentedEnvironmentKey = undefined;
      presentationKind = "none";
    }
  };

  const flush = (scheduledGeneration: number): void => {
    if (disposed || scheduledGeneration !== generation) return;
    scheduledFrame = null;
    const latest = pending;
    pending = null;
    if (latest) present(latest);
    if (pending && !disposed) schedule();
  };

  const schedule = (): void => {
    if (disposed || scheduledFrame !== null || pending === null) return;
    const scheduledGeneration = generation;
    try {
      scheduledFrame = options.scheduler.requestFrame(() => flush(scheduledGeneration));
    } catch (error) {
      // A synchronous projection here would violate the hot-path contract precisely when the host
      // is degraded. Disable this preview generation and keep the authoritative release commit;
      // the gesture remains usable without putting geometry work back into pointer events.
      reportError(error);
      scheduledFrame = null;
      pending = null;
      const neutralized = neutralize();
      if (!neutralized.ok) {
        failFatally(error);
      } else {
        disposed = true;
      }
    }
  };

  return {
    push: (frame) => {
      if (disposed) return;
      pending = {
        targetBounds: { ...frame.targetBounds },
        rotationDeg: frame.rotationDeg,
      };
      schedule();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      generation += 1;
      pending = null;
      const handle = scheduledFrame;
      scheduledFrame = null;
      if (handle === null) return;
      try {
        options.scheduler.cancelFrame(handle);
      } catch (error) {
        reportError(error);
      }
    },
  };
}
