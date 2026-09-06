import { describe, expect, it, vi } from "vitest";

import { createStudioLiveTransformPreviewSession } from "./studio-live-transform-preview-session";

import type {
  StudioLiveTransformPreviewPresentation,
  StudioLiveTransformPreviewScheduler,
} from "./studio-live-transform-preview-session";

function manualScheduler() {
  let nextHandle = 1;
  const callbacks = new Map<number, () => void>();
  const scheduler: StudioLiveTransformPreviewScheduler = {
    requestFrame: vi.fn((callback) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    }),
    cancelFrame: vi.fn((handle) => {
      callbacks.delete(handle);
    }),
  };
  return {
    scheduler,
    pendingCount: () => callbacks.size,
    flush: () => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback();
    },
    capturePending: () => [...callbacks.values()],
  };
}

const sourceBounds = { x: 10, y: 20, width: 100, height: 50 };

describe("createStudioLiveTransformPreviewSession", () => {
  it("coalesces a pointer burst to one newest renderer projection per animation frame", () => {
    const clock = manualScheduler();
    const apply = vi.fn((_presentation: StudioLiveTransformPreviewPresentation) => true);
    const session = createStudioLiveTransformPreviewSession({
      sourceBounds,
      scheduler: clock.scheduler,
      adapter: { apply, neutralize: vi.fn() },
    });

    for (let index = 1; index <= 100; index += 1) {
      session.push({
        targetBounds: {
          x: 10 + index,
          y: 20 + index,
          width: 100 + index,
          height: 50 + index / 2,
        },
        rotationDeg: index,
      });
    }

    expect(clock.scheduler.requestFrame).toHaveBeenCalledTimes(1);
    expect(clock.pendingCount()).toBe(1);
    expect(apply).not.toHaveBeenCalled();

    clock.flush();

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]?.[0]).toMatchObject({
      frame: {
        targetBounds: { x: 110, y: 120, width: 200, height: 100 },
        rotationDeg: 100,
      },
      attrs: {
        x: 110,
        y: 120,
        scaleX: 2,
        scaleY: 2,
        rotationDeg: 100,
      },
    });
  });

  it("re-evaluates identical affine geometry when its renderer environment changes", () => {
    const clock = manualScheduler();
    let environmentKey = "dpr-1:backing-small";
    let admitted = true;
    const apply = vi.fn(() => admitted);
    const session = createStudioLiveTransformPreviewSession({
      sourceBounds,
      scheduler: clock.scheduler,
      adapter: {
        apply,
        presentationEnvironmentKey: () => environmentKey,
        neutralize: vi.fn(),
      },
    });
    const frame = {
      targetBounds: { x: 30, y: 40, width: 200, height: 100 },
      rotationDeg: 20,
    };

    session.push(frame);
    clock.flush();
    session.push(frame);
    clock.flush();
    expect(apply).toHaveBeenCalledTimes(1);

    environmentKey = "dpr-3:backing-large";
    admitted = false;
    session.push(frame);
    clock.flush();
    expect(apply).toHaveBeenCalledTimes(2);

    // A false receipt is release-only, not a retained affine presentation eligible for dedupe.
    session.push(frame);
    clock.flush();
    expect(apply).toHaveBeenCalledTimes(3);

    admitted = true;
    session.push(frame);
    clock.flush();
    session.push(frame);
    clock.flush();
    expect(apply).toHaveBeenCalledTimes(4);
  });

  it("contains an environment-key read failure through the renderer neutralization boundary", () => {
    const clock = manualScheduler();
    const keyError = new Error("renderer environment unavailable");
    let shouldFail = true;
    const apply = vi.fn(() => true);
    const neutralize = vi.fn();
    const onError = vi.fn();
    const session = createStudioLiveTransformPreviewSession({
      sourceBounds,
      scheduler: clock.scheduler,
      adapter: {
        apply,
        presentationEnvironmentKey: () => {
          if (shouldFail) throw keyError;
          return "dpr-1:backing-small";
        },
        neutralize,
      },
      onError,
    });
    const frame = {
      targetBounds: { x: 30, y: 40, width: 200, height: 100 },
      rotationDeg: 20,
    };

    session.push(frame);
    clock.flush();
    expect(onError).toHaveBeenCalledWith(keyError);
    expect(neutralize).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();

    shouldFail = false;
    session.push(frame);
    clock.flush();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("holds the last good pose for an invalid reading and neutralizes once for unsupported input", () => {
    const clock = manualScheduler();
    const apply = vi.fn(() => true);
    const neutralize = vi.fn();
    const session = createStudioLiveTransformPreviewSession({
      sourceBounds,
      scheduler: clock.scheduler,
      adapter: { apply, neutralize },
    });

    session.push({
      targetBounds: { x: 30, y: 40, width: 200, height: 100 },
      rotationDeg: 20,
    });
    clock.flush();
    expect(apply).toHaveBeenCalledTimes(1);

    session.push({
      targetBounds: { x: 30, y: 40, width: Number.NaN, height: 100 },
      rotationDeg: 20,
    });
    clock.flush();
    expect(neutralize).not.toHaveBeenCalled();

    session.push({
      targetBounds: { x: 30, y: 40, width: 200, height: 150 },
      rotationDeg: 20,
    });
    clock.flush();
    expect(neutralize).toHaveBeenCalledTimes(1);

    session.push({
      targetBounds: { x: 31, y: 41, width: 200, height: 150 },
      rotationDeg: 21,
    });
    clock.flush();
    expect(neutralize).toHaveBeenCalledTimes(1);
  });

  it("uses a model-backed exact adapter for non-uniform and route-changing frames", () => {
    const clock = manualScheduler();
    const apply = vi.fn(() => true);
    const applyExact = vi.fn(() => true);
    const neutralize = vi.fn();
    const session = createStudioLiveTransformPreviewSession({
      sourceBounds,
      renderRoute: {
        pointCount: 2,
        strokeDistance: 100,
        strokeWidth: 4,
        drawsArrowHead: false,
        isPerfectFamily: false,
        isPerfectInk: false,
      },
      scheduler: clock.scheduler,
      adapter: { apply, applyExact, neutralize },
    });

    session.push({
      targetBounds: { x: 10, y: 20, width: 200, height: 75 },
      rotationDeg: 0,
    });
    clock.flush();
    expect(applyExact).toHaveBeenCalledTimes(1);
    expect(neutralize).not.toHaveBeenCalled();

    // A uniform route-changing frame also takes the exact path instead of freezing old ink.
    session.push({
      targetBounds: { x: 10, y: 20, width: 4, height: 2 },
      rotationDeg: 0,
    });
    clock.flush();
    expect(applyExact).toHaveBeenCalledTimes(2);
    expect(apply).not.toHaveBeenCalled();
  });

  it("fails fatally when an exact rejection cannot neutralize an earlier presentation", () => {
    const clock = manualScheduler();
    const neutralizeError = new Error("renderer authority rollback failed");
    const apply = vi.fn(() => true);
    const applyExact = vi.fn(() => false);
    const neutralize = vi.fn(() => {
      throw neutralizeError;
    });
    const onError = vi.fn();
    const onFatalError = vi.fn();
    const session = createStudioLiveTransformPreviewSession({
      sourceBounds,
      scheduler: clock.scheduler,
      adapter: { apply, applyExact, neutralize },
      onError,
      onFatalError,
    });

    // Establish renderer authority through a valid retained-affine presentation first.
    session.push({
      targetBounds: { x: 20, y: 30, width: 200, height: 100 },
      rotationDeg: 0,
    });
    clock.flush();
    expect(apply).toHaveBeenCalledTimes(1);

    // This valid non-uniform frame asks the exact adapter, which rejects admission. Returning to
    // release-only requires neutralizing the prior affine authority; that rollback now fails.
    session.push({
      targetBounds: { x: 30, y: 40, width: 200, height: 75 },
      rotationDeg: 0,
    });
    clock.flush();

    expect(applyExact).toHaveBeenCalledTimes(1);
    expect(neutralize).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(neutralizeError);
    expect(onFatalError).toHaveBeenCalledWith(neutralizeError);
    expect(onFatalError).toHaveBeenCalledTimes(1);

    // Fatal authority loss disposes this generation; later handle events cannot write again.
    session.push({
      targetBounds: { x: 40, y: 50, width: 300, height: 150 },
      rotationDeg: 10,
    });
    clock.flush();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(clock.pendingCount()).toBe(0);
  });

  it("switches exact and affine presentations through adapter-owned cleanup", () => {
    const clock = manualScheduler();
    const calls: string[] = [];
    const session = createStudioLiveTransformPreviewSession({
      sourceBounds,
      scheduler: clock.scheduler,
      adapter: {
        apply: () => {
          calls.push("affine");
          return true;
        },
        applyExact: () => {
          calls.push("exact");
          return true;
        },
        neutralize: () => calls.push("neutral"),
      },
    });

    session.push({
      targetBounds: { x: 10, y: 20, width: 200, height: 75 },
      rotationDeg: 0,
    });
    clock.flush();
    session.push({
      targetBounds: { x: 30, y: 40, width: 200, height: 100 },
      rotationDeg: 15,
    });
    clock.flush();
    session.push({
      targetBounds: { x: 30, y: 40, width: 210, height: 100 },
      rotationDeg: 15,
    });
    clock.flush();

    expect(calls).toEqual(["exact", "affine", "exact"]);
  });

  it("invalidates pending and already-dispatched callbacks when the gesture resolves", () => {
    const clock = manualScheduler();
    const apply = vi.fn(() => true);
    const session = createStudioLiveTransformPreviewSession({
      sourceBounds,
      scheduler: clock.scheduler,
      adapter: { apply, neutralize: vi.fn() },
    });

    session.push({
      targetBounds: { x: 30, y: 40, width: 200, height: 100 },
      rotationDeg: 0,
    });
    const [lateCallback] = clock.capturePending();
    expect(lateCallback).toBeTypeOf("function");

    session.dispose();
    session.dispose();
    lateCallback?.();
    session.push({
      targetBounds: { x: 50, y: 60, width: 300, height: 150 },
      rotationDeg: 45,
    });

    expect(clock.scheduler.cancelFrame).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(clock.pendingCount()).toBe(0);
  });

  it("disables preview instead of moving geometry work into the pointer hot path when scheduling fails", () => {
    const schedulerError = new Error("requestAnimationFrame unavailable");
    const apply = vi.fn(() => true);
    const onError = vi.fn();
    const session = createStudioLiveTransformPreviewSession({
      sourceBounds,
      scheduler: {
        requestFrame: () => {
          throw schedulerError;
        },
        cancelFrame: vi.fn(),
      },
      adapter: { apply, neutralize: vi.fn() },
      onError,
    });

    session.push({
      targetBounds: { x: 20, y: 30, width: 150, height: 75 },
      rotationDeg: 0,
    });

    expect(onError).toHaveBeenCalledWith(schedulerError);
    expect(apply).not.toHaveBeenCalled();

    session.push({
      targetBounds: { x: 30, y: 40, width: 200, height: 100 },
      rotationDeg: 10,
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it("contains a partial adapter failure and can present a later frame", () => {
    const clock = manualScheduler();
    const adapterError = new Error("renderer write failed");
    const apply = vi.fn()
      .mockImplementationOnce(() => {
        throw adapterError;
      })
      .mockImplementation(() => true);
    const neutralize = vi.fn();
    const onError = vi.fn();
    const session = createStudioLiveTransformPreviewSession({
      sourceBounds,
      scheduler: clock.scheduler,
      adapter: { apply, neutralize },
      onError,
    });

    session.push({
      targetBounds: { x: 20, y: 30, width: 150, height: 75 },
      rotationDeg: 0,
    });
    clock.flush();
    expect(onError).toHaveBeenCalledWith(adapterError);
    expect(neutralize).toHaveBeenCalledTimes(1);

    session.push({
      targetBounds: { x: 30, y: 40, width: 200, height: 100 },
      rotationDeg: 0,
    });
    clock.flush();
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("escalates when a partial renderer write cannot be neutralized", () => {
    const clock = manualScheduler();
    const applyError = new Error("partial renderer write");
    const neutralizeError = new Error("renderer rollback failed");
    const onError = vi.fn();
    const onFatalError = vi.fn();
    const apply = vi.fn(() => {
      throw applyError;
    });
    const session = createStudioLiveTransformPreviewSession({
      sourceBounds,
      scheduler: clock.scheduler,
      adapter: {
        apply,
        neutralize: () => {
          throw neutralizeError;
        },
      },
      onError,
      onFatalError,
    });

    session.push({
      targetBounds: { x: 20, y: 30, width: 150, height: 75 },
      rotationDeg: 0,
    });
    clock.flush();
    session.push({
      targetBounds: { x: 30, y: 40, width: 200, height: 100 },
      rotationDeg: 0,
    });
    clock.flush();

    expect(onError).toHaveBeenCalledWith(applyError);
    expect(onError).toHaveBeenCalledWith(neutralizeError);
    expect(onFatalError).toHaveBeenCalledWith(applyError);
    expect(onFatalError).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
