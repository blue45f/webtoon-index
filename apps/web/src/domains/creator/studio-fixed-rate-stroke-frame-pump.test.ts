import { describe, expect, it, vi } from "vitest";

import {
  advanceFixedRateStrokeFrameClock,
  advanceFixedRateStrokeSampleClockFloor,
  createFixedRateStrokeFrameClock,
  createFixedRateStrokeFramePump,
  createFixedRateStrokeSampleClock,
  normalizeFixedRateStrokeSampleTimeStamps,
  type FixedRateStrokeFrameCallback,
} from "./studio-fixed-rate-stroke-frame-pump";

function createFrameScheduler() {
  let nextHandle = 1;
  const callbacks = new Map<number, FixedRateStrokeFrameCallback>();
  const requestFrame = vi.fn((callback: FixedRateStrokeFrameCallback) => {
    const handle = nextHandle;
    nextHandle += 1;
    callbacks.set(handle, callback);
    return handle;
  });
  const cancelFrame = vi.fn((handle: number) => {
    callbacks.delete(handle);
  });
  const callbackFor = (handle: number): FixedRateStrokeFrameCallback => {
    const callback = callbacks.get(handle);
    if (!callback) throw new Error(`Missing scheduled frame ${handle}`);
    return callback;
  };
  const fire = (handle: number, timeStamp: number): void => {
    const callback = callbackFor(handle);
    callbacks.delete(handle);
    callback(timeStamp);
  };
  return { callbackFor, callbacks, requestFrame, cancelFrame, fire };
}

describe("fixed-rate stroke frame clock", () => {
  it("maps epoch-based pointer timestamps from frame-relative elapsed time", () => {
    const eventOrigin = 1_753_456_789_012;
    const clock = createFixedRateStrokeFrameClock(eventOrigin, 4_200.25);
    const advanced = advanceFixedRateStrokeFrameClock(clock, 4_216.75);

    expect(advanced.watermark).toBe(eventOrigin + 16.5);
    expect(advanced.state).toEqual({
      eventOriginTimeStamp: eventOrigin,
      frameOriginTimeStamp: 4_200.25,
      watermark: eventOrigin + 16.5,
    });
  });

  it("preserves zero and reduced pointer-event clock origins", () => {
    const zeroClock = createFixedRateStrokeFrameClock(0, 8_000.125);
    expect(
      advanceFixedRateStrokeFrameClock(zeroClock, 8_016.625).watermark
    ).toBe(16.5);

    const roundedClock = createFixedRateStrokeFrameClock(123, 8_000.125);
    expect(
      advanceFixedRateStrokeFrameClock(roundedClock, 8_016.625).watermark
    ).toBe(139.5);
  });

  it("never regresses its event-clock watermark when rAF timestamps regress", () => {
    const initial = createFixedRateStrokeFrameClock(500, 1_000);
    const first = advanceFixedRateStrokeFrameClock(initial, 1_020);
    const regressed = advanceFixedRateStrokeFrameClock(first.state, 1_010);
    const malformed = advanceFixedRateStrokeFrameClock(
      regressed.state,
      Number.NaN
    );
    const recovered = advanceFixedRateStrokeFrameClock(
      malformed.state,
      1_033
    );

    expect(first.watermark).toBe(520);
    expect(regressed.watermark).toBe(520);
    expect(regressed.state).toBe(first.state);
    expect(malformed.watermark).toBe(520);
    expect(recovered.watermark).toBe(533);
  });
});

describe("fixed-rate stroke sample clock", () => {
  it("preserves plausible high-resolution and epoch browser timestamps", () => {
    const origin = 1_753_456_789_000;
    const clock = createFixedRateStrokeSampleClock(origin, 2_000);
    const batch = normalizeFixedRateStrokeSampleTimeStamps(
      clock,
      [origin + 4, origin + 8, origin + 12],
      2_016
    );
    expect(batch.timeStamps).toEqual([origin + 4, origin + 8, origin + 12]);
  });

  it("spreads equal zero timestamps across the observed arrival window", () => {
    const clock = createFixedRateStrokeSampleClock(0, 1_000);
    const batch = normalizeFixedRateStrokeSampleTimeStamps(
      clock,
      [0, 0, 0, 0],
      1_016
    );
    expect(batch.timeStamps).toEqual([4, 8, 12, 16]);
    expect(batch.state.lastCanonicalTimeStamp).toBe(16);
  });

  it("keeps delivery order monotonic for regressing clocks and caps background spans", () => {
    const clock = createFixedRateStrokeSampleClock(100, 1_000);
    const first = normalizeFixedRateStrokeSampleTimeStamps(
      clock,
      [99, 70, 80],
      1_012
    );
    expect(first.timeStamps).toEqual([104, 108, 112]);

    const resumed = normalizeFixedRateStrokeSampleTimeStamps(
      first.state,
      [80, 80],
      61_000
    );
    expect(resumed.timeStamps).toEqual([60_075, 60_100]);
    expect(resumed.timeStamps[0]).toBeGreaterThanOrEqual(60_050);
    expect(resumed.timeStamps.at(-1)).toBe(60_100);
  });

  it("never synthesizes repeated reduced-clock batches beyond their arrival time", () => {
    const clock = createFixedRateStrokeSampleClock(0, 1_000);
    const first = normalizeFixedRateStrokeSampleTimeStamps(clock, [0, 0, 0, 0], 1_016);
    const repeated = normalizeFixedRateStrokeSampleTimeStamps(
      first.state,
      [0, 0, 0, 0],
      1_016
    );
    expect(repeated.timeStamps).toEqual([16, 16, 16, 16]);
    expect(repeated.timeStamps.every((timeStamp) => timeStamp <= 16)).toBe(true);
  });

  it("remaps late samples after an already-published frame watermark", () => {
    const clock = createFixedRateStrokeSampleClock(0, 1_000);
    const published = advanceFixedRateStrokeSampleClockFloor(clock, 16);
    const late = normalizeFixedRateStrokeSampleTimeStamps(published, [8, 10, 12], 1_017);
    expect(late.timeStamps).toEqual([16 + 1 / 3, 16 + 2 / 3, 17]);
    expect(late.timeStamps.every((timeStamp) => timeStamp >= 16)).toBe(true);
  });
});

describe("fixed-rate stroke frame pump", () => {
  it("starts idempotently and keeps exactly one frame scheduled while requested", () => {
    const scheduler = createFrameScheduler();
    const onFrame = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const pump = createFixedRateStrokeFramePump({
      requestFrame: scheduler.requestFrame,
      cancelFrame: scheduler.cancelFrame,
      onFrame,
    });

    pump.start();
    pump.start();
    expect(pump.isRunning()).toBe(true);
    expect(scheduler.requestFrame).toHaveBeenCalledTimes(1);
    expect(scheduler.callbacks.size).toBe(1);

    scheduler.fire(1, 16);
    expect(onFrame).toHaveBeenLastCalledWith(16);
    expect(scheduler.requestFrame).toHaveBeenCalledTimes(2);
    expect(scheduler.callbacks.size).toBe(1);

    pump.start();
    expect(scheduler.requestFrame).toHaveBeenCalledTimes(2);

    scheduler.fire(2, 32);
    expect(onFrame).toHaveBeenLastCalledWith(32);
    expect(pump.isRunning()).toBe(false);
    expect(scheduler.requestFrame).toHaveBeenCalledTimes(2);
    expect(scheduler.callbacks.size).toBe(0);
  });

  it("cancels on stop and ignores a late callback from the stopped generation", () => {
    const scheduler = createFrameScheduler();
    const onFrame = vi.fn(() => true);
    const pump = createFixedRateStrokeFramePump({
      requestFrame: scheduler.requestFrame,
      cancelFrame: scheduler.cancelFrame,
      onFrame,
    });

    pump.start();
    const staleCallback = scheduler.callbackFor(1);
    pump.stop();

    expect(pump.isRunning()).toBe(false);
    expect(scheduler.cancelFrame).toHaveBeenCalledOnce();
    expect(scheduler.cancelFrame).toHaveBeenCalledWith(1);
    expect(scheduler.callbacks.size).toBe(0);

    pump.start();
    expect(scheduler.requestFrame).toHaveBeenCalledTimes(2);
    staleCallback(17);

    expect(onFrame).not.toHaveBeenCalled();
    expect(pump.isRunning()).toBe(true);
    expect(scheduler.callbacks.size).toBe(1);

    scheduler.fire(2, 33);
    expect(onFrame).toHaveBeenCalledOnce();
    expect(onFrame).toHaveBeenCalledWith(33);
    expect(scheduler.requestFrame).toHaveBeenCalledTimes(3);
    pump.stop();
    expect(scheduler.cancelFrame).toHaveBeenLastCalledWith(3);
  });

  it("fails closed when frame cancellation throws and keeps repeated stops idempotent", () => {
    const cancellationFailure = new Error("frame cancellation failed");
    const lateCallbacks: FixedRateStrokeFrameCallback[] = [];
    const requestFrame = vi.fn((callback: FixedRateStrokeFrameCallback) => {
      lateCallbacks.push(callback);
      return 41;
    });
    const cancelFrame = vi.fn(() => {
      throw cancellationFailure;
    });
    const onFrame = vi.fn(() => true);
    const onError = vi.fn();
    const pump = createFixedRateStrokeFramePump({
      requestFrame,
      cancelFrame,
      onFrame,
      onError,
    });

    pump.start();
    expect(() => pump.stop()).not.toThrow();

    expect(pump.isRunning()).toBe(false);
    expect(cancelFrame).toHaveBeenCalledOnce();
    expect(cancelFrame).toHaveBeenCalledWith(41);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(cancellationFailure);

    pump.stop();
    expect(cancelFrame).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();

    lateCallbacks[0]?.(17);
    expect(onFrame).not.toHaveBeenCalled();
    expect(pump.isRunning()).toBe(false);
    expect(requestFrame).toHaveBeenCalledOnce();
  });

  it("fails closed and reports an asynchronous frame consumer error", () => {
    const scheduler = createFrameScheduler();
    const failure = new Error("frame failed");
    const onError = vi.fn();
    const pump = createFixedRateStrokeFramePump({
      requestFrame: scheduler.requestFrame,
      cancelFrame: scheduler.cancelFrame,
      onFrame: () => {
        throw failure;
      },
      onError,
    });

    pump.start();
    expect(() => scheduler.fire(1, 16)).not.toThrow();
    expect(pump.isRunning()).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(scheduler.callbacks.size).toBe(0);
  });

  it("fails closed when requesting the first frame throws", () => {
    const failure = new Error("scheduler unavailable");
    const onError = vi.fn();
    const pump = createFixedRateStrokeFramePump({
      requestFrame: () => {
        throw failure;
      },
      cancelFrame: vi.fn(),
      onFrame: () => true,
      onError,
    });

    expect(() => pump.start()).not.toThrow();
    expect(pump.isRunning()).toBe(false);
    expect(onError).toHaveBeenCalledWith(failure);
  });
});
