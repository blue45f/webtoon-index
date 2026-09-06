import type { StudioFloatingSurfaceRect } from "./studio-floating-surface";
import type {
  StartStudioFloatingSurfacePointerSessionOptions,
  StudioFloatingSurfaceInteractionKind,
} from "./studio-floating-surface-pointer-contract";

export const STUDIO_FLOATING_POINTER_ACTIVATION_DISTANCE = 8;
export const STUDIO_FLOATING_TOUCH_ACTIVATION_DELAY_MS = 250;
export const STUDIO_FLOATING_TOUCH_ACTIVATION_TOLERANCE = 8;

export interface StudioFloatingPointerSessionState {
  readonly kind: StudioFloatingSurfaceInteractionKind;
  readonly target: HTMLElement;
  readonly node: HTMLElement;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startRect: StudioFloatingSurfaceRect;
  readonly cursor: string;
  readonly resolveRect: StartStudioFloatingSurfacePointerSessionOptions["resolveRect"];
  readonly onActiveChange: StartStudioFloatingSurfacePointerSessionOptions["onActiveChange"];
  readonly onCommit: StartStudioFloatingSurfacePointerSessionOptions["onCommit"];
  readonly onComplete: StartStudioFloatingSurfacePointerSessionOptions["onComplete"];
  readonly previousBodyCursor: string;
  readonly previousBodyUserSelect: string;
  latestClientX: number;
  latestClientY: number;
  active: boolean;
  finished: boolean;
  activationTimer: number | null;
  frame: number | null;
}

export function createStudioFloatingPointerSessionState(
  options: StartStudioFloatingSurfacePointerSessionOptions,
): StudioFloatingPointerSessionState {
  return {
    kind: options.kind,
    target: options.target,
    node: options.node,
    pointerId: options.pointerId,
    pointerType: options.pointerType || "mouse",
    startClientX: options.clientX,
    startClientY: options.clientY,
    latestClientX: options.clientX,
    latestClientY: options.clientY,
    startRect: options.startRect,
    cursor: options.cursor
      ?? (options.kind === "move" ? "grabbing" : "se-resize"),
    resolveRect: options.resolveRect,
    onActiveChange: options.onActiveChange,
    onCommit: options.onCommit,
    onComplete: options.onComplete,
    previousBodyCursor: document.body.style.cursor,
    previousBodyUserSelect: document.body.style.userSelect,
    active: false,
    finished: false,
    activationTimer: null,
    frame: null,
  };
}

function requestFrame(callback: FrameRequestCallback): number {
  return typeof globalThis.requestAnimationFrame === "function"
    ? globalThis.requestAnimationFrame(callback)
    : window.setTimeout(() => callback(Date.now()), 0);
}

export function cancelStudioFloatingPointerFrame(
  session: StudioFloatingPointerSessionState,
): void {
  if (session.frame === null) return;
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(session.frame);
  } else {
    window.clearTimeout(session.frame);
  }
  session.frame = null;
}

export function studioFloatingPointerDistance(
  session: StudioFloatingPointerSessionState,
): number {
  return Math.hypot(
    session.latestClientX - session.startClientX,
    session.latestClientY - session.startClientY,
  );
}

function applyPreview(session: StudioFloatingPointerSessionState): void {
  if (session.finished) return;
  const rect = session.resolveRect(
    session.latestClientX - session.startClientX,
    session.latestClientY - session.startClientY,
    false,
  );
  if (session.kind === "move") {
    session.node.style.transform = `translate3d(${rect.x - session.startRect.x}px, ${rect.y - session.startRect.y}px, 0)`;
  } else {
    session.node.style.left = `${rect.x}px`;
    session.node.style.top = `${rect.y}px`;
    session.node.style.width = `${rect.width}px`;
    session.node.style.height = `${rect.height}px`;
  }
}

export function scheduleStudioFloatingPointerPreview(
  session: StudioFloatingPointerSessionState,
): void {
  if (session.frame !== null || session.finished) return;
  session.frame = requestFrame(() => {
    session.frame = null;
    applyPreview(session);
  });
}

export function activateStudioFloatingPointerSession(
  session: StudioFloatingPointerSessionState,
): void {
  if (session.active || session.finished) return;
  session.active = true;
  if (session.activationTimer !== null) {
    window.clearTimeout(session.activationTimer);
    session.activationTimer = null;
  }
  document.body.style.userSelect = "none";
  document.body.style.cursor = session.cursor;
  if (session.kind === "move") {
    session.node.dataset.dragging = "true";
  } else {
    session.node.dataset.resizing = "true";
  }
  session.onActiveChange(true);
  scheduleStudioFloatingPointerPreview(session);
}

export function restoreStudioFloatingPointerStartRect(
  session: StudioFloatingPointerSessionState,
): void {
  session.node.style.left = `${session.startRect.x}px`;
  session.node.style.top = `${session.startRect.y}px`;
  session.node.style.transform = "translate3d(0, 0, 0)";
  session.node.style.width = `${session.startRect.width}px`;
  session.node.style.height = `${session.startRect.height}px`;
}

export function applyStudioFloatingPointerCommittedRect(
  session: StudioFloatingPointerSessionState,
  rect: StudioFloatingSurfaceRect,
): void {
  session.node.style.left = `${rect.x}px`;
  session.node.style.top = `${rect.y}px`;
  session.node.style.width = `${rect.width}px`;
  session.node.style.height = `${rect.height}px`;
  session.node.style.transform = "translate3d(0, 0, 0)";
}
