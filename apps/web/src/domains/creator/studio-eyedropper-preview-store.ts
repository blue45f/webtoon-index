import type { StudioEyedropperSample, StudioEyedropperTarget } from "./studio-eyedropper";
import type { StudioEyedropperCapture } from "./studio-eyedropper-capture";
import type { StudioEyedropperPointerAnchor } from "./studio-eyedropper-loupe";

export type StudioEyedropperPreviewFrame = Readonly<{
  pointer: StudioEyedropperPointerAnchor;
  capture: StudioEyedropperCapture;
  sample: StudioEyedropperSample | null;
  target: StudioEyedropperTarget;
  currentTargetColor: string;
  referenceLabel: string;
  layerName?: string | null;
  viewport?: Readonly<{ width: number; height: number }>;
}>;

export interface StudioEyedropperPreviewStore {
  getSnapshot: () => StudioEyedropperPreviewFrame | null;
  getServerSnapshot: () => null;
  subscribe: (listener: () => void) => () => void;
  /** Coalesces pointer-rate updates to the latest frame once per animation frame. */
  publish: (frame: StudioEyedropperPreviewFrame) => void;
  /** Hides immediately; pointerleave must not leave one queued loupe frame behind. */
  hide: () => void;
  destroy: () => void;
}

type FrameScheduler = Readonly<{
  request: (callback: FrameRequestCallback) => number;
  cancel: (handle: number) => void;
}>;

function defaultScheduler(): FrameScheduler {
  return {
    request: globalThis.requestAnimationFrame?.bind(globalThis)
      ?? ((callback) => globalThis.setTimeout(() => callback(performance.now()), 16) as unknown as number),
    cancel: globalThis.cancelAnimationFrame?.bind(globalThis)
      ?? ((handle) => globalThis.clearTimeout(handle)),
  };
}

/**
 * High-frequency loupe state deliberately lives outside StudioPage. Only StudioEyedropperLoupeHost
 * subscribes, so 120 Hz pen hover does not re-render the canvas, layer tree, or inspector.
 */
export function createStudioEyedropperPreviewStore(
  scheduler: FrameScheduler = defaultScheduler(),
): StudioEyedropperPreviewStore {
  const listeners = new Set<() => void>();
  let snapshot: StudioEyedropperPreviewFrame | null = null;
  let pending: StudioEyedropperPreviewFrame | null = null;
  let frameHandle: number | null = null;
  let destroyed = false;

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const commitPending = (): void => {
    frameHandle = null;
    if (destroyed || !pending) return;
    snapshot = pending;
    pending = null;
    notify();
  };

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => null,
    subscribe: (listener) => {
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish: (frame) => {
      if (destroyed) return;
      pending = frame;
      frameHandle ??= scheduler.request(commitPending);
    },
    hide: () => {
      if (destroyed) return;
      pending = null;
      if (frameHandle !== null) {
        scheduler.cancel(frameHandle);
        frameHandle = null;
      }
      if (snapshot === null) return;
      snapshot = null;
      notify();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      pending = null;
      if (frameHandle !== null) scheduler.cancel(frameHandle);
      frameHandle = null;
      snapshot = null;
      listeners.clear();
    },
  };
}
