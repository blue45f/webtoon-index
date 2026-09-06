import {
  activateStudioFloatingPointerSession,
  applyStudioFloatingPointerCommittedRect,
  cancelStudioFloatingPointerFrame,
  createStudioFloatingPointerSessionState,
  restoreStudioFloatingPointerStartRect,
  scheduleStudioFloatingPointerPreview,
  studioFloatingPointerDistance,
  STUDIO_FLOATING_POINTER_ACTIVATION_DISTANCE,
  STUDIO_FLOATING_TOUCH_ACTIVATION_DELAY_MS,
  STUDIO_FLOATING_TOUCH_ACTIVATION_TOLERANCE,
} from "./studio-floating-surface-pointer-state";

import type { StudioFloatingSurfaceRect } from "./studio-floating-surface";
import type {
  StartStudioFloatingSurfacePointerSessionOptions,
  StudioFloatingSurfacePointerSession,
} from "./studio-floating-surface-pointer-contract";

export type {
  StartStudioFloatingSurfacePointerSessionOptions,
  StudioFloatingSurfaceInteractionKind,
  StudioFloatingSurfacePointerSession,
} from "./studio-floating-surface-pointer-contract";

/**
 * Owns one mouse, pen, or touch pointer interaction for a floating Studio surface.
 *
 * The DOM receives rAF previews while React and persistence see a single commit. Cleanup always
 * runs before the external commit callback, so a failed owner update cannot strand pointer capture,
 * body cursor, or text-selection state.
 */
export function startStudioFloatingSurfacePointerSession(
  options: StartStudioFloatingSurfacePointerSessionOptions,
): StudioFloatingSurfacePointerSession {
  const session = createStudioFloatingPointerSessionState(options);

  const detach = (): void => {
    globalThis.removeEventListener("pointermove", onMove);
    globalThis.removeEventListener("pointerup", onUp);
    globalThis.removeEventListener("pointercancel", onCancel);
    globalThis.removeEventListener("blur", onBlur);
    document.removeEventListener("keydown", onKeyDown, true);
    session.target.removeEventListener("lostpointercapture", onLostPointerCapture);
  };

  const finish = (action: "commit" | "cancel"): void => {
    if (session.finished) return;
    session.finished = true;
    if (session.activationTimer !== null) {
      window.clearTimeout(session.activationTimer);
      session.activationTimer = null;
    }
    cancelStudioFloatingPointerFrame(session);

    let committedRect: StudioFloatingSurfaceRect | null = null;
    if (session.active && action === "commit") {
      committedRect = session.resolveRect(
        session.latestClientX - session.startClientX,
        session.latestClientY - session.startClientY,
        true,
      );
      applyStudioFloatingPointerCommittedRect(session, committedRect);
    } else {
      restoreStudioFloatingPointerStartRect(session);
    }

    detach();
    try {
      if (session.target.hasPointerCapture(session.pointerId)) {
        session.target.releasePointerCapture(session.pointerId);
      }
    } catch {
      // Global listeners are the recovery path when capture is unavailable or already lost.
    }
    document.body.style.userSelect = session.previousBodyUserSelect;
    document.body.style.cursor = session.previousBodyCursor;
    if (session.kind === "move") {
      session.node.dataset.dragging = "false";
    } else {
      session.node.dataset.resizing = "false";
    }
    if (session.active) session.onActiveChange(false);
    session.onComplete();
    if (committedRect) session.onCommit(committedRect);
  };

  function onMove(event: PointerEvent): void {
    if (event.pointerId !== session.pointerId || session.finished) return;
    session.latestClientX = event.clientX;
    session.latestClientY = event.clientY;
    if (!session.active) {
      const distance = studioFloatingPointerDistance(session);
      if (session.kind === "resize") {
        activateStudioFloatingPointerSession(session);
      } else if (session.pointerType === "touch") {
        if (distance > STUDIO_FLOATING_TOUCH_ACTIVATION_TOLERANCE) {
          finish("cancel");
          return;
        }
      } else if (distance >= STUDIO_FLOATING_POINTER_ACTIVATION_DISTANCE) {
        activateStudioFloatingPointerSession(session);
      }
    }
    if (session.active) scheduleStudioFloatingPointerPreview(session);
  }

  function onUp(event: PointerEvent): void {
    if (event.pointerId === session.pointerId) finish("commit");
  }

  function onCancel(event: PointerEvent): void {
    if (event.pointerId === session.pointerId) finish("cancel");
  }

  function onBlur(): void {
    finish("cancel");
  }

  function onLostPointerCapture(event: PointerEvent): void {
    if (event.pointerId === session.pointerId) finish("cancel");
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !session.active) return;
    event.preventDefault();
    event.stopPropagation();
    finish("cancel");
  }

  globalThis.addEventListener("pointermove", onMove, { passive: true });
  globalThis.addEventListener("pointerup", onUp, { passive: true });
  globalThis.addEventListener("pointercancel", onCancel, { passive: true });
  globalThis.addEventListener("blur", onBlur, { passive: true });
  document.addEventListener("keydown", onKeyDown, true);
  session.target.addEventListener("lostpointercapture", onLostPointerCapture);
  try {
    session.target.setPointerCapture(session.pointerId);
  } catch {
    // Global listeners keep mouse, pen, and touch sessions functional without capture support.
  }

  if (session.kind === "resize") {
    activateStudioFloatingPointerSession(session);
  } else if (session.pointerType === "touch") {
    session.activationTimer = window.setTimeout(
      () => activateStudioFloatingPointerSession(session),
      STUDIO_FLOATING_TOUCH_ACTIVATION_DELAY_MS,
    );
  }

  return { cancel: () => finish("cancel") };
}
