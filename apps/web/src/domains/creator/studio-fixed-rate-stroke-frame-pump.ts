/**
 * Browser-frame clock and scheduling primitives for a fixed-rate live stroke.
 *
 * PointerEvent.timeStamp is not guaranteed to share requestAnimationFrame's clock domain. Some
 * engines report an epoch timestamp, while privacy-reduced clocks can begin at zero or a rounded
 * value. The clock below anchors both domains at pointerdown and maps later frame deltas back onto
 * the event timeline without allowing a regressing frame timestamp to regress the watermark.
 *
 * The pump deliberately receives its scheduler as a dependency. It therefore has no DOM or React
 * dependency and its cancellation/generation rules can be tested without fake global timers.
 */

export interface FixedRateStrokeFrameClockState {
  /** Pointerdown's timestamp, used as the fixed-rate filter's event-clock origin. */
  readonly eventOriginTimeStamp: number;
  /** performance.now() captured alongside pointerdown, in requestAnimationFrame's clock domain. */
  readonly frameOriginTimeStamp: number;
  /** Last event-clock watermark returned to the fixed-rate filter. */
  readonly watermark: number;
}

export interface FixedRateStrokeFrameClockTransition {
  readonly state: FixedRateStrokeFrameClockState;
  readonly watermark: number;
}

export interface FixedRateStrokeSampleClockState {
  readonly eventOriginTimeStamp: number;
  readonly frameOriginTimeStamp: number;
  readonly lastBrowserTimeStamp: number;
  readonly lastCanonicalTimeStamp: number;
}

export interface FixedRateStrokeSampleClockTransition {
  readonly state: FixedRateStrokeSampleClockState;
  /** One event-clock timestamp per delivered sample, in the original delivery order. */
  readonly timeStamps: readonly number[];
}

const MAX_SYNTHETIC_BATCH_SPAN_MS = 50;
const MAX_BROWSER_FUTURE_SKEW_MS = 32;

function finiteNonNegativeTimeStamp(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

/**
 * Captures the pointer-event and animation-frame clock origins at pointerdown.
 *
 * Keeping the two origins instead of guessing whether an event timestamp is epoch-relative makes
 * the mapping work for high-resolution, epoch, and privacy-reduced timestamps alike.
 */
export function createFixedRateStrokeFrameClock(
  eventOriginTimeStamp: number,
  frameOriginTimeStamp: number
): FixedRateStrokeFrameClockState {
  const normalizedEventOrigin = finiteNonNegativeTimeStamp(eventOriginTimeStamp, 0);
  return {
    eventOriginTimeStamp: normalizedEventOrigin,
    frameOriginTimeStamp: finiteNonNegativeTimeStamp(frameOriginTimeStamp, 0),
    watermark: normalizedEventOrigin,
  };
}

/** Creates the companion clock used to repair equal, zero, or regressing hardware timestamps. */
export function createFixedRateStrokeSampleClock(
  eventOriginTimeStamp: number,
  frameOriginTimeStamp: number
): FixedRateStrokeSampleClockState {
  const frameClock = createFixedRateStrokeFrameClock(
    eventOriginTimeStamp,
    frameOriginTimeStamp
  );
  return {
    eventOriginTimeStamp: frameClock.eventOriginTimeStamp,
    frameOriginTimeStamp: frameClock.frameOriginTimeStamp,
    lastBrowserTimeStamp: frameClock.eventOriginTimeStamp,
    lastCanonicalTimeStamp: frameClock.eventOriginTimeStamp,
  };
}

/** Moves the input clock's causal floor to an already-published frame watermark. */
export function advanceFixedRateStrokeSampleClockFloor(
  state: FixedRateStrokeSampleClockState,
  publishedWatermark: number
): FixedRateStrokeSampleClockState {
  const floor = finiteNonNegativeTimeStamp(
    publishedWatermark,
    state.lastCanonicalTimeStamp
  );
  if (floor <= state.lastCanonicalTimeStamp) return state;
  return { ...state, lastCanonicalTimeStamp: floor };
}

/**
 * Normalizes one browser delivery batch onto the filter event clock.
 *
 * Strictly increasing, plausible browser timestamps pass through byte-for-byte. If a webview or
 * privacy-reduced driver reports equal/zero/regressing values, the samples are spread across the
 * elapsed arrival window instead of repeatedly replacing one zero-order hold at the same instant.
 * The fallback span is bounded so returning from a suspended tab cannot create an enormous raw
 * chronology; the frame pump remains responsible for catching the held cascade up to display time.
 */
export function normalizeFixedRateStrokeSampleTimeStamps(
  state: FixedRateStrokeSampleClockState,
  browserTimeStamps: readonly number[],
  arrivalFrameTimeStamp: number
): FixedRateStrokeSampleClockTransition {
  if (browserTimeStamps.length === 0) return { state, timeStamps: [] };

  const arrivalFrame = finiteNonNegativeTimeStamp(
    arrivalFrameTimeStamp,
    state.frameOriginTimeStamp
  );
  const arrivalElapsed = Math.max(0, arrivalFrame - state.frameOriginTimeStamp);
  const mappedArrival = state.eventOriginTimeStamp + arrivalElapsed;
  const finiteMappedArrival = Number.isFinite(mappedArrival)
    ? mappedArrival
    : state.lastCanonicalTimeStamp;
  const normalizedBrowserTimes = browserTimeStamps.map((timeStamp) => (
    finiteNonNegativeTimeStamp(timeStamp, state.lastBrowserTimeStamp)
  ));

  const fallbackEnd = Math.max(
    state.lastCanonicalTimeStamp,
    finiteMappedArrival
  );
  const fallbackStart = Math.max(
    state.lastCanonicalTimeStamp,
    fallbackEnd - MAX_SYNTHETIC_BATCH_SPAN_MS
  );
  const fallbackSpan = fallbackEnd - fallbackStart;
  let priorBrowser = state.lastBrowserTimeStamp;
  let priorCanonical = state.lastCanonicalTimeStamp;
  const timeStamps = normalizedBrowserTimes.map((timeStamp, index) => {
    const browserClockIsUsable = timeStamp > priorBrowser
      && timeStamp >= priorCanonical
      && timeStamp <= finiteMappedArrival + MAX_BROWSER_FUTURE_SKEW_MS;
    const fallback = fallbackStart
      + fallbackSpan * ((index + 1) / normalizedBrowserTimes.length);
    const canonical = browserClockIsUsable
      ? timeStamp
      : Math.max(priorCanonical, fallback);
    priorBrowser = timeStamp;
    priorCanonical = canonical;
    return canonical;
  });

  const lastBrowserTimeStamp = normalizedBrowserTimes.at(-1)
    ?? state.lastBrowserTimeStamp;
  const lastCanonicalTimeStamp = timeStamps.at(-1)
    ?? state.lastCanonicalTimeStamp;
  return {
    state: {
      ...state,
      lastBrowserTimeStamp,
      lastCanonicalTimeStamp,
    },
    timeStamps,
  };
}

/** Maps one rAF timestamp onto the event clock and clamps the result monotonically. */
export function advanceFixedRateStrokeFrameClock(
  state: FixedRateStrokeFrameClockState,
  frameTimeStamp: number
): FixedRateStrokeFrameClockTransition {
  const normalizedFrameTimeStamp = finiteNonNegativeTimeStamp(
    frameTimeStamp,
    state.frameOriginTimeStamp
  );
  const elapsed = Math.max(
    0,
    normalizedFrameTimeStamp - state.frameOriginTimeStamp
  );
  const mappedTimeStamp = state.eventOriginTimeStamp + elapsed;
  const finiteMappedTimeStamp = Number.isFinite(mappedTimeStamp)
    ? mappedTimeStamp
    : state.watermark;
  const watermark = Math.max(state.watermark, finiteMappedTimeStamp);

  if (watermark === state.watermark) {
    return { state, watermark };
  }

  const nextState: FixedRateStrokeFrameClockState = {
    ...state,
    watermark,
  };
  return { state: nextState, watermark };
}

export type FixedRateStrokeFrameCallback = (frameTimeStamp: number) => void;

export interface FixedRateStrokeFramePumpOptions {
  readonly requestFrame: (callback: FixedRateStrokeFrameCallback) => number;
  readonly cancelFrame: (handle: number) => void;
  /** Return true to request another frame; false ends this pump generation. */
  readonly onFrame: (frameTimeStamp: number) => boolean;
  /** Reports scheduler/consumer failures after the pump has stopped and invalidated the generation. */
  readonly onError?: (error: unknown) => void;
}

export interface FixedRateStrokeFramePump {
  /** Starts one generation. Calling start while it is running is a no-op. */
  readonly start: () => void;
  /** Stops the generation, cancels its pending frame, and invalidates late callbacks. */
  readonly stop: () => void;
  readonly isRunning: () => boolean;
}

/**
 * Creates a single-flight animation-frame pump.
 *
 * A generation token matters even after cancelFrame: an already-dispatched browser callback can
 * still arrive after pointerup/unmount, and an old callback must never act on a restarted stroke.
 */
export function createFixedRateStrokeFramePump(
  options: FixedRateStrokeFramePumpOptions
): FixedRateStrokeFramePump {
  let running = false;
  let generation = 0;
  let pendingFrame: number | null = null;

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // A diagnostic hook must never resurrect the async exception that this boundary contains.
    }
  };

  const fail = (scheduledGeneration: number, error: unknown): void => {
    if (running && generation === scheduledGeneration) {
      running = false;
      generation += 1;
    }
    pendingFrame = null;
    reportError(error);
  };

  const schedule = (scheduledGeneration: number): void => {
    if (
      !running
      || generation !== scheduledGeneration
      || pendingFrame !== null
    ) {
      return;
    }

    try {
      pendingFrame = options.requestFrame((frameTimeStamp) => {
        if (!running || generation !== scheduledGeneration) return;

        pendingFrame = null;
        let shouldContinue: boolean;
        try {
          shouldContinue = options.onFrame(frameTimeStamp);
        } catch (error) {
          fail(scheduledGeneration, error);
          return;
        }

        if (!running || generation !== scheduledGeneration) return;
        if (!shouldContinue) {
          running = false;
          generation += 1;
          return;
        }
        schedule(scheduledGeneration);
      });
    } catch (error) {
      fail(scheduledGeneration, error);
    }
  };

  const start = (): void => {
    if (running) return;
    running = true;
    generation += 1;
    schedule(generation);
  };

  const stop = (): void => {
    if (!running && pendingFrame === null) return;

    const frameToCancel = pendingFrame;
    pendingFrame = null;
    running = false;
    generation += 1;
    if (frameToCancel === null) return;

    try {
      options.cancelFrame(frameToCancel);
    } catch (error) {
      reportError(error);
    }
  };

  return {
    start,
    stop,
    isRunning: () => running,
  };
}
