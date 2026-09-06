import type Konva from "konva";

export interface StudioClientPointerCoordinate {
  readonly clientX: number;
  readonly clientY: number;
}

export interface StudioStagePointerBatchMapper {
  /** Maps one browser client sample without another layout read or transform inversion. */
  pointFor(sample: StudioClientPointerCoordinate): { x: number; y: number } | null;
}

export interface StudioStagePointerFrameScheduler {
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
}

export interface StudioStagePointerFrameMapperCache {
  /** Reuses one coordinate snapshot for raw and processed deliveries in the same paint frame. */
  mapperFor(stage: StudioStageCoordinateSource): StudioStagePointerBatchMapper;
  /** Invalidates immediately when the pointer session or view ownership changes. */
  invalidate(): void;
  /** Permanently releases the scheduled frame callback. */
  dispose(): void;
}

export interface StudioStagePointerFrameMapperCacheRef {
  current: StudioStagePointerFrameMapperCache | null;
}

export interface StudioStagePointerFrameMapperCacheLease {
  /** The exact cache owned by this effect setup. Retained late calls fail after release. */
  readonly cache: StudioStagePointerFrameMapperCache;
  /** Clears only this lease from the shared ref and permanently disposes its cache. */
  release(): void;
}

type StudioStageCoordinateSource = Pick<Konva.Stage, "getAbsoluteTransform" | "getContent">;
type StudioStagePointerContent = Pick<HTMLElement, "contains">;

function positiveFiniteScale(renderedSize: number, layoutSize: number): number {
  if (!(renderedSize > 0) || !(layoutSize > 0)) return 1;
  const scale = renderedSize / layoutSize;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * A native window-capture listener runs before Konva's listener on the Stage content. When the
 * event is already routed through that content, Konva will synchronize its pointer bookkeeping
 * later in the same DOM dispatch; doing it manually in the capture listener would force a second
 * `getBoundingClientRect()` read for every high-rate pen sample.
 *
 * Pointer capture can still fail in an embedded host. Events then arrive from outside the Stage,
 * so the native drawing path must retain the manual synchronization fallback.
 */
export function shouldSynchronizeStudioStagePointerPosition(
  content: StudioStagePointerContent | null | undefined,
  eventTarget: EventTarget | null
): boolean {
  if (!content || !eventTarget) return true;
  if (eventTarget === (content as unknown as EventTarget)) return false;
  try {
    return !content.contains(eventTarget as Node);
  } catch {
    return true;
  }
}

/**
 * Konva's public `setPointersPositions` + `getRelativePointerPosition` pair is correct for a
 * dispatched event, but each call reads `getBoundingClientRect` and copies/inverts the Stage
 * transform. A pen event can contain many coalesced and predicted hardware samples, all delivered
 * against the same layout snapshot. Capture that snapshot once, then map the whole browser batch.
 */
export function snapshotStudioStagePointerBatchMapper(
  stage: StudioStageCoordinateSource
): StudioStagePointerBatchMapper {
  const content = stage.getContent();
  const rect = content?.getBoundingClientRect?.();
  const left = Number.isFinite(rect?.left) ? rect.left : 0;
  const top = Number.isFinite(rect?.top) ? rect.top : 0;
  const scaleX = positiveFiniteScale(rect?.width ?? 0, content?.clientWidth ?? 0);
  const scaleY = positiveFiniteScale(rect?.height ?? 0, content?.clientHeight ?? 0);
  const inverse = stage.getAbsoluteTransform().copy().invert();

  return {
    pointFor(sample) {
      if (!Number.isFinite(sample.clientX) || !Number.isFinite(sample.clientY)) return null;
      const mapped = inverse.point({
        x: (sample.clientX - left) / scaleX,
        y: (sample.clientY - top) / scaleY,
      });
      return Number.isFinite(mapped.x) && Number.isFinite(mapped.y) ? mapped : null;
    },
  };
}

/**
 * Shares the expensive DOM/layout and inverse-transform snapshot across raw and processed pen
 * events delivered before the next animation frame. The cache never spans a paint boundary, so
 * resize and layout changes are observed on the following frame without a polling clock.
 */
export function createStudioStagePointerFrameMapperCache(
  scheduler: StudioStagePointerFrameScheduler
): StudioStagePointerFrameMapperCache {
  let cachedStage: StudioStageCoordinateSource | null = null;
  let cachedMapper: StudioStagePointerBatchMapper | null = null;
  let frameHandle: number | null = null;
  let disposed = false;

  const clearSnapshot = (): void => {
    cachedStage = null;
    cachedMapper = null;
  };

  const invalidate = (): void => {
    if (frameHandle !== null) scheduler.cancelFrame(frameHandle);
    frameHandle = null;
    clearSnapshot();
  };

  return {
    mapperFor(stage) {
      if (disposed) throw new Error("Studio stage pointer mapper cache is disposed");
      if (cachedStage !== stage || cachedMapper === null) {
        cachedStage = stage;
        cachedMapper = snapshotStudioStagePointerBatchMapper(stage);
      }
      if (frameHandle === null) {
        frameHandle = scheduler.requestFrame(() => {
          frameHandle = null;
          clearSnapshot();
        });
      }
      return cachedMapper;
    },
    invalidate,
    dispose() {
      if (disposed) return;
      invalidate();
      disposed = true;
    },
  };
}

/**
 * Acquires one cache for a React effect setup. StrictMode and Fast Refresh may immediately run the
 * matching cleanup and setup again, so cleanup must release the exact captured instance instead of
 * leaving a disposed cache in the ref. A late holder of the released instance still observes the
 * cache's fail-closed `disposed` contract.
 */
export function acquireStudioStagePointerFrameMapperCache(
  target: StudioStagePointerFrameMapperCacheRef,
  scheduler: StudioStagePointerFrameScheduler
): StudioStagePointerFrameMapperCacheLease {
  const cache = createStudioStagePointerFrameMapperCache(scheduler);
  target.current = cache;
  let released = false;

  return Object.freeze({
    cache,
    release() {
      if (released) return;
      released = true;
      if (target.current === cache) target.current = null;
      cache.dispose();
    },
  });
}
