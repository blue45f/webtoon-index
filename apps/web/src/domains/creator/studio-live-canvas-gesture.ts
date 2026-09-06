/**
 * Renderer-neutral lifecycle for a transient Studio canvas gesture.
 *
 * The public interface is intentionally small and stable across gesture kinds: begin once, offer
 * transient frames, then resolve exactly once through commit or cancel. Geometry projection stays
 * in the renderer adapter and durable scene/history/CRDT work stays behind the commit port.
 */

export type StudioLiveCanvasGestureCancelReason =
  | "escape"
  | "pointer-cancel"
  | "window-blur"
  | "document-hidden"
  | "selection-changed"
  | "source-changed"
  | "disabled"
  | "unmount"
  | "invalid-terminal-frame"
  | "preview-error"
  | "commit-error";

export type StudioLiveCanvasGestureCloseOutcome<Frame> =
  | { readonly kind: "commit"; readonly terminalFrame: Frame }
  | {
      readonly kind: "cancel";
      readonly reason: StudioLiveCanvasGestureCancelReason;
    };

export interface StudioLiveCanvasGestureCommitSettlement {
  readonly kind: "commit";
  /** False means the commit port rejected/no-op'd and any retained handoff must roll back. */
  readonly committed: boolean;
}

/**
 * Canonical, renderer-neutral intent for one selection resize/rotate frame.
 *
 * Values are absolute against the immutable source snapshot captured at `begin`; adapters must
 * never accumulate deltas from the previously presented frame. That keeps coalescing safe and
 * prevents drift when browser events are dropped.
 */
export interface StudioLiveSelectionTransformFrame {
  readonly targetBounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly rotationDeg: number;
}

/** Local-substitutable renderer adapter. It is forbidden from mutating the document. */
export interface StudioLiveCanvasGestureTransientAdapter<Frame> {
  /** Hot path: implementations should only replace a latest-frame mailbox. */
  readonly offer: (frame: Frame) => void;
  /**
   * Release active-frame renderer ownership. A successful terminal preview may transfer one
   * bounded handoff claim to `settle` rather than restoring it here. Implementations must be
   * retry-safe: throwing means ownership is still retained and the common lifecycle will call
   * `close` again from its recovery scheduler. A return is the receipt that all close-critical
   * renderer state has been released.
   */
  readonly close: (outcome: StudioLiveCanvasGestureCloseOutcome<Frame>) => void;
  /**
   * Optional second phase for renderers that retain the last preview until authoritative receipt.
   * Called after the commit port resolves, including false/throw paths. `false` is a non-exceptional
   * pending receipt; returning `true`/`void` acknowledges settlement. A throw is also retryable.
   */
  readonly settle?: (
    settlement: StudioLiveCanvasGestureCommitSettlement
  ) => void | boolean;
}

/** Remote-owned durable seam. A production adapter delegates to the existing document commit. */
export interface StudioLiveCanvasGestureCommitPort<Frame> {
  /** Acquire locks/leases and capture source identity before any transient renderer claim. */
  readonly acquire: () => boolean;
  /**
   * The only method allowed to publish scene/history/CRDT state. Called at most once.
   *
   * `false` means the port rejected/no-op'd without a durable mutation. The common lifecycle keeps
   * the acquired writer lease through renderer settlement and calls `release` afterwards.
   */
  readonly commit: (terminalFrame: Frame) => boolean;
  /** Release the writer lease after a non-throwing commit result has fully settled in the renderer. */
  readonly release: () => void;
  /** Release an acquired gesture without a durable mutation. Called at most once. */
  readonly cancel: (reason: StudioLiveCanvasGestureCancelReason) => void;
}

export interface StudioLiveCanvasGestureSession<Frame> {
  readonly offer: (frame: Frame) => void;
  /** Returns false for a late or re-entrant resolution; commit remains exactly-once. */
  readonly finish: (terminalFrame: Frame) => boolean;
  /** Returns false for a late or re-entrant cancellation. */
  readonly cancel: (reason: StudioLiveCanvasGestureCancelReason) => boolean;
  readonly isActive: () => boolean;
}

export type StudioLiveCanvasGestureBeginResult<Frame> =
  | { readonly ok: true; readonly session: StudioLiveCanvasGestureSession<Frame> }
  | { readonly ok: false; readonly reason: "rejected" | "preview-setup-error" };

export interface BeginStudioLiveCanvasGestureOptions<Frame> {
  readonly commitPort: StudioLiveCanvasGestureCommitPort<Frame>;
  /** Invoked only after acquire succeeds, so a rejected gesture cannot claim renderer resources. */
  readonly createTransient: () => StudioLiveCanvasGestureTransientAdapter<Frame>;
  /** Diagnostics only. A diagnostic failure never escapes into the pointer event. */
  readonly onError?: (error: unknown) => void;
  /**
   * Host-owned deferred recovery. The callback must run asynchronously; production uses a
   * 16ms-to-1s backoff so recovery continues without spinning while animation frames are suspended.
   */
  readonly scheduleRecovery?: (callback: () => void, delayMs: number) => void;
}

const STUDIO_LIVE_CANVAS_GESTURE_RECOVERY_INITIAL_DELAY_MS = 16;
const STUDIO_LIVE_CANVAS_GESTURE_RECOVERY_MAX_DELAY_MS = 1_000;

function scheduleStudioLiveCanvasGestureRecovery(
  callback: () => void,
  delayMs: number,
): void {
  const handle = globalThis.setTimeout(callback, delayMs);
  // Node-based tests/SSR must not keep the process alive solely for renderer recovery. Browsers
  // return a number and simply skip this optional host capability.
  (handle as unknown as { unref?: () => void }).unref?.();
}

/**
 * Begins one gesture generation.
 *
 * Ordering invariants:
 * 1. acquire durable lease/source snapshot;
 * 2. claim transient renderer resources;
 * 3. offer may touch only the transient adapter;
 * 4. resolution seals the session before callbacks (re-entrancy safe);
 * 5. close/rollback transient state before the sole commit or cancel callback.
 */
export function beginStudioLiveCanvasGesture<Frame>(
  options: BeginStudioLiveCanvasGestureOptions<Frame>,
): StudioLiveCanvasGestureBeginResult<Frame> {
  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // Diagnostics cannot become a second gesture failure.
    }
  };

  let acquired: boolean;
  try {
    acquired = options.commitPort.acquire();
  } catch (error) {
    reportError(error);
    return { ok: false, reason: "rejected" };
  }
  if (!acquired) return { ok: false, reason: "rejected" };

  let transient: StudioLiveCanvasGestureTransientAdapter<Frame>;
  try {
    transient = options.createTransient();
  } catch (error) {
    reportError(error);
    try {
      options.commitPort.cancel("preview-error");
    } catch (cancelError) {
      reportError(cancelError);
    }
    return { ok: false, reason: "preview-setup-error" };
  }

  let state: "active" | "resolving" | "resolved" = "active";
  const scheduleRecovery = options.scheduleRecovery
    ?? scheduleStudioLiveCanvasGestureRecovery;

  const closeTransient = (
    outcome: StudioLiveCanvasGestureCloseOutcome<Frame>,
    reportFailure = true,
  ): boolean => {
    try {
      transient.close(outcome);
      return true;
    } catch (error) {
      if (reportFailure) reportError(error);
      return false;
    }
  };

  const retainRecovery = (attempt: () => boolean): void => {
    let delayMs = STUDIO_LIVE_CANVAS_GESTURE_RECOVERY_INITIAL_DELAY_MS;
    const run = (): void => {
      if (attempt()) return;
      delayMs = Math.min(
        STUDIO_LIVE_CANVAS_GESTURE_RECOVERY_MAX_DELAY_MS,
        delayMs * 2,
      );
      request();
    };
    const request = (): void => {
      try {
        scheduleRecovery(run, delayMs);
      } catch (error) {
        // An injected host scheduler is not allowed to drop the only reference to a renderer
        // claim. Fall back to the built-in timer after reporting the host integration failure.
        reportError(error);
        scheduleStudioLiveCanvasGestureRecovery(run, delayMs);
      }
    };
    request();
  };

  let acquiredReleased = false;
  const cancelAcquired = (reason: StudioLiveCanvasGestureCancelReason): void => {
    if (acquiredReleased) return;
    // Seal before invoking the remote-owned port: a throwing/re-entrant cancel still receives at
    // most one release attempt, matching the commit-port contract.
    acquiredReleased = true;
    try {
      options.commitPort.cancel(reason);
    } catch (error) {
      reportError(error);
    }
  };

  const releaseAcquired = (): void => {
    if (acquiredReleased) return;
    // A non-throwing commit has already decided durable outcome. Keep the same exactly-once seal as
    // cancellation, but use the neutral release port so a successful commit is never mislabeled.
    acquiredReleased = true;
    try {
      options.commitPort.release();
    } catch (error) {
      reportError(error);
    }
  };

  const settleTransient = (committed: boolean, reportFailure = true): boolean => {
    try {
      return transient.settle?.({ kind: "commit", committed }) !== false;
    } catch (error) {
      if (reportFailure) reportError(error);
      return false;
    }
  };

  const settleTransientWithRecovery = (
    committed: boolean,
    onSettled: () => void,
  ): void => {
    if (settleTransient(committed)) {
      onSettled();
      return;
    }
    // A durable commit cannot be undone here. Retain the adapter itself as the authority lease and
    // retry settlement until its source/draft handoff acknowledges completion. The page writer
    // lease remains held until that receipt, preventing a second writer from racing this recovery.
    retainRecovery(() => {
      if (!settleTransient(committed, false)) return false;
      onSettled();
      return true;
    });
  };

  const closeTransientWithRecovery = (
    outcome: StudioLiveCanvasGestureCloseOutcome<Frame>,
    onRecovered?: () => void,
  ): void => {
    retainRecovery(() => {
      if (!closeTransient(outcome, false)) return false;
      onRecovered?.();
      return true;
    });
  };

  const session: StudioLiveCanvasGestureSession<Frame> = {
    offer: (frame) => {
      if (state !== "active") return;
      try {
        transient.offer(frame);
      } catch (error) {
        // A renderer failure cannot be allowed to leave an active lease waiting for pointer-up.
        reportError(error);
        state = "resolving";
        const outcome = { kind: "cancel", reason: "preview-error" } as const;
        const closed = closeTransient(outcome);
        state = "resolved";
        if (closed) cancelAcquired("preview-error");
        else {
          // The page lease is also the writer-exclusion lease. Keep it until renderer ownership is
          // actually home so a new gesture cannot race this old recovery on the same nodes.
          closeTransientWithRecovery(outcome, () => cancelAcquired("preview-error"));
        }
      }
    },
    finish: (terminalFrame) => {
      if (state !== "active") return false;
      state = "resolving";
      // If cleanup cannot prove that the transient pose is gone, fail closed instead of baking a
      // document transform underneath a potentially stale renderer transform.
      if (!closeTransient({ kind: "commit", terminalFrame })) {
        state = "resolved";
        closeTransientWithRecovery(
          { kind: "commit", terminalFrame },
          () => {
            settleTransientWithRecovery(false, () => cancelAcquired("preview-error"));
          },
        );
        return false;
      }
      try {
        const committed = options.commitPort.commit(terminalFrame);
        settleTransientWithRecovery(committed, releaseAcquired);
        state = "resolved";
        return committed;
      } catch (error) {
        reportError(error);
        // Renderer settlement still precedes cancellation because a terminal draft can remain
        // authoritative even when durable publication threw partway through its transaction.
        settleTransientWithRecovery(false, () => cancelAcquired("commit-error"));
        state = "resolved";
        return false;
      }
    },
    cancel: (reason) => {
      if (state !== "active") return false;
      state = "resolving";
      const outcome = { kind: "cancel", reason } as const;
      const closed = closeTransient(outcome);
      state = "resolved";
      if (closed) cancelAcquired(reason);
      else closeTransientWithRecovery(outcome, () => cancelAcquired(reason));
      return true;
    },
    isActive: () => state === "active",
  };

  return { ok: true, session };
}
