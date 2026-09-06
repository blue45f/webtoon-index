/**
 * Live scroll-viewport store for the Studio canvas host.
 *
 * The canvas scroll host emits `scroll` on every pan frame. Publishing those
 * coordinates through `useState` on `StudioPage` re-rendered the whole editor
 * once per frame — measured at 42 react-dom commits for a 40-move hand drag,
 * p95 100ms (400ms under CPU 4x). That is the same failure the wheel-zoom
 * gesture already avoids by keeping per-tick state out of React and committing
 * once on settle.
 *
 * This module is the pan-side equivalent of that pattern: every frame publishes
 * here (no React work at all), and only the handful of subtrees that must track
 * the scroll offset at frame rate subscribe. `StudioPage` keeps a *settled*
 * snapshot in React state for the consumers that only need geometry, so a
 * continuous drag produces one commit instead of one per frame.
 *
 * Pure module: no React import, no DOM ownership. The React binding lives in
 * `useStudioScrollViewport`.
 */

/**
 * Quiet window after the last scroll frame before the deferred React snapshot
 * commits. Matches the wheel-zoom gesture settle constant so a wheel scroll and
 * a wheel zoom converge on the same cadence.
 */
export const STUDIO_SCROLL_VIEWPORT_SETTLE_MS = 170;

export interface StudioScrollViewport {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
}

export const STUDIO_SCROLL_VIEWPORT_ORIGIN: StudioScrollViewport = Object.freeze({
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  scrollWidth: 0,
  scrollHeight: 0,
});

export function studioScrollViewportsEqual(
  a: StudioScrollViewport,
  b: StudioScrollViewport,
): boolean {
  return a.left === b.left
    && a.top === b.top
    && a.width === b.width
    && a.height === b.height
    && a.scrollWidth === b.scrollWidth
    && a.scrollHeight === b.scrollHeight;
}

/**
 * Decide how a freshly measured scroll viewport reaches React.
 *
 * - `"none"`: identical to what React already holds; nothing to do.
 * - `"live"`: only the scroll offset moved. This is the pan/scroll hot path, so
 *   the value goes to live subscribers only and the React snapshot is left for
 *   the settle commit. Deferring is safe because every consumer that must stay
 *   frame-accurate (rulers, minimap viewport box) subscribes to the store.
 * - `"immediate"`: the viewport *box* changed (resize, panel toggle, zoom
 *   relayout, rotation). These are user-paced, not per-frame, and page layout
 *   derived from them must not lag, so they commit synchronously.
 */
export type StudioScrollViewportCommitMode = "none" | "live" | "immediate";

export function planStudioScrollViewportCommit(
  committed: StudioScrollViewport,
  next: StudioScrollViewport,
): StudioScrollViewportCommitMode {
  if (studioScrollViewportsEqual(committed, next)) return "none";
  const boxUnchanged = committed.width === next.width
    && committed.height === next.height
    && committed.scrollWidth === next.scrollWidth
    && committed.scrollHeight === next.scrollHeight;
  return boxUnchanged ? "live" : "immediate";
}

export interface StudioScrollViewportStore {
  /** `useSyncExternalStore` subscribe. Returns the unsubscribe callback. */
  readonly subscribe: (onStoreChange: () => void) => () => void;
  /** `useSyncExternalStore` snapshot. Identity is stable while the value is. */
  readonly getSnapshot: () => StudioScrollViewport;
  /** Publish a measured viewport. Returns true when subscribers were notified. */
  readonly publish: (next: StudioScrollViewport) => boolean;
}

export function createStudioScrollViewportStore(
  initial: StudioScrollViewport = STUDIO_SCROLL_VIEWPORT_ORIGIN,
): StudioScrollViewportStore {
  let snapshot: StudioScrollViewport = Object.freeze({ ...initial });
  const listeners = new Set<() => void>();
  return {
    subscribe(onStoreChange) {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    publish(next) {
      if (studioScrollViewportsEqual(snapshot, next)) return false;
      snapshot = Object.freeze({ ...next });
      for (const listener of listeners) listener();
      return true;
    },
  };
}
