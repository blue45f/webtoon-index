import { describe, expect, it, vi } from "vitest";

import { StudioCrdtLiveStrokePublisher } from "./studio-crdt-live-stroke-publisher";

function schedulerHarness() {
  let nextFrame = 1;
  let nextTimer = 100;
  const frames = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, () => void>();
  const scheduler = {
    requestFrame: vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    }),
    cancelFrame: vi.fn((id: number) => frames.delete(id)),
    setTimer: vi.fn((callback: () => void) => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    }),
    clearTimer: vi.fn((id: number) => timers.delete(id)),
  };
  return {
    frames,
    scheduler,
    timers,
    runFrame() {
      const [id, callback] = [...frames][0] ?? [];
      if (id === undefined || !callback) throw new Error("No scheduled frame");
      frames.delete(id);
      callback(16);
    },
    runTimer() {
      const [id, callback] = [...timers][0] ?? [];
      if (id === undefined || !callback) throw new Error("No scheduled timer");
      timers.delete(id);
      callback();
    },
  };
}

describe("StudioCrdtLiveStrokePublisher", () => {
  it("publishes begin and a coalesced suffix only after a paint opportunity", () => {
    const harness = schedulerHarness();
    const order: string[] = [];
    const publisher = new StudioCrdtLiveStrokePublisher<{ points: number[] }>({
      scheduler: harness.scheduler,
      onError: vi.fn(),
    });

    publisher.begin("stroke-a", () => order.push("begin"));
    publisher.append("stroke-a", {
      snapshot: { points: [0, 0, 1, 1] },
      startSample: 1,
      publish: (_snapshot, start) => order.push(`append:${start}`),
    });
    publisher.append("stroke-a", {
      snapshot: { points: [0, 0, 1, 1, 2, 2] },
      startSample: 2,
      publish: (snapshot, start) => order.push(`append:${start}:${snapshot.points.length}`),
    });

    expect(order).toEqual([]);
    expect(harness.scheduler.requestFrame).toHaveBeenCalledOnce();
    harness.runFrame();
    expect(order).toEqual([]);
    harness.runTimer();
    expect(order).toEqual(["begin", "append:1:6"]);
  });

  it("flushes synchronously on release and cancels the scheduled callbacks", () => {
    const harness = schedulerHarness();
    const publish = vi.fn();
    const publisher = new StudioCrdtLiveStrokePublisher<object>({
      scheduler: harness.scheduler,
      onError: vi.fn(),
    });
    publisher.append("stroke-a", { snapshot: {}, startSample: 3, publish });

    expect(publisher.flush("stroke-a")).toBe(true);
    expect(publish).toHaveBeenCalledWith({}, 3);
    expect(harness.frames.size).toBe(0);
    expect(harness.timers.size).toBe(0);
  });

  it("drops an abandoned stroke and never executes its deferred begin", () => {
    const harness = schedulerHarness();
    const begin = vi.fn();
    const publisher = new StudioCrdtLiveStrokePublisher<object>({
      scheduler: harness.scheduler,
      onError: vi.fn(),
    });
    publisher.begin("stroke-a", begin);
    publisher.cancel("stroke-a");

    expect(begin).not.toHaveBeenCalled();
    expect(publisher.pendingStrokeId).toBeNull();
    expect(harness.frames.size).toBe(0);
  });

  it("reports a publish failure once and recovers for the next stroke", () => {
    const harness = schedulerHarness();
    const failure = new Error("Yjs unavailable");
    const onError = vi.fn();
    const next = vi.fn();
    const publisher = new StudioCrdtLiveStrokePublisher<object>({
      scheduler: harness.scheduler,
      onError,
    });
    publisher.begin("stroke-a", () => { throw failure; });

    expect(publisher.flush()).toBe(false);
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    publisher.begin("stroke-b", next);
    expect(publisher.flush()).toBe(true);
    expect(next).toHaveBeenCalledOnce();
  });
});
