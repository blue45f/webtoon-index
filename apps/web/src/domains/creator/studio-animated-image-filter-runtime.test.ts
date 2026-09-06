import { describe, expect, it, vi } from "vitest";

import {
  evaluateStudioAnimatedImageFilterCapability,
  startStudioAnimatedImageFilterFrameLoop,
  type StudioAnimatedImageFilterCapabilityInput,
} from "./studio-animated-image-filter-runtime";

function capability(
  overrides: Partial<StudioAnimatedImageFilterCapabilityInput> = {},
): StudioAnimatedImageFilterCapabilityInput {
  return {
    cachePad: 0,
    filterCapabilityRuntime: "ready",
    filterCount: 2,
    filterMask: "none",
    filterRequested: true,
    filterRuntime: "ready",
    height: 480,
    isAnimatedGif: true,
    multiFramePlayback: false,
    requestedDensity: 1,
    requiresOffthreadProvider: false,
    sourceReady: true,
    width: 640,
    ...overrides,
  };
}

function frameHarness() {
  let nextId = 1;
  const pending = new Map<number, FrameRequestCallback>();
  const requestFrame = vi.fn((callback: FrameRequestCallback) => {
    const id = nextId;
    nextId += 1;
    pending.set(id, callback);
    return id;
  });
  const cancelFrame = vi.fn((id: number) => {
    pending.delete(id);
  });
  const fireNext = (now: number) => {
    const next = pending.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!next) throw new Error("No frame pending");
    pending.delete(next[0]);
    next[1](now);
  };
  return { cancelFrame, fireNext, pending, requestFrame };
}

function fakeNode() {
  const layer = { batchDraw: vi.fn() };
  return {
    cache: vi.fn(),
    clearCache: vi.fn(),
    getLayer: vi.fn(() => layer),
    layer,
  };
}

describe("animated GIF filter admission", () => {
  it("admits bounded live-frame filtering with an explicit cache owner", () => {
    const result = evaluateStudioAnimatedImageFilterCapability(capability());

    expect(result).toMatchObject({
      cacheConfig: { pixelRatio: 1 },
      owner: "konva-live-gif-frame-cache-v1",
      pixelCount: 640 * 480,
      pixelPasses: 640 * 480 * 2,
      reason: "live-frame-cache",
      state: "active",
    });
  });

  it("caps supersampling to 1x before dropping animation filtering", () => {
    const result = evaluateStudioAnimatedImageFilterCapability(capability({
      height: 1_000,
      requestedDensity: 2,
      width: 1_000,
    }));

    expect(result).toMatchObject({
      cacheConfig: { pixelRatio: 1 },
      density: 1,
      reason: "density-capped",
      state: "active",
    });
  });

  it("degrades explicitly when pixels, filter passes, or offthread-only effects exceed safety", () => {
    expect(evaluateStudioAnimatedImageFilterCapability(capability({
      height: 4_096,
      width: 4_096,
    }))).toMatchObject({ reason: "pixel-budget-exceeded", state: "degraded" });

    expect(evaluateStudioAnimatedImageFilterCapability(capability({
      filterCount: 9,
      height: 1_024,
      width: 1_024,
    }))).toMatchObject({ reason: "pixel-pass-budget-exceeded", state: "degraded" });

    expect(evaluateStudioAnimatedImageFilterCapability(capability({
      requiresOffthreadProvider: true,
    }))).toMatchObject({ reason: "offthread-provider-required", state: "degraded" });
  });

  it("does not claim success while runtimes, masks, or sources are unavailable", () => {
    expect(evaluateStudioAnimatedImageFilterCapability(capability({
      filterRuntime: "loading",
    }))).toMatchObject({ reason: "filter-runtime-loading", state: "preparing" });
    expect(evaluateStudioAnimatedImageFilterCapability(capability({
      filterMask: "unavailable",
    }))).toMatchObject({ reason: "filter-mask-unavailable", state: "degraded" });
    expect(evaluateStudioAnimatedImageFilterCapability(capability({
      sourceReady: false,
    }))).toMatchObject({ reason: "source-loading", state: "preparing" });
  });
});

describe("animated GIF live-frame loop", () => {
  it("recaches the current browser frame immediately and at the bounded 80ms cadence", () => {
    const clock = frameHarness();
    const node = fakeNode();
    const onFilteredFrame = vi.fn();
    const loop = startStudioAnimatedImageFilterFrameLoop({
      cacheConfig: { pixelRatio: 1 },
      cancelFrame: clock.cancelFrame,
      filterFrames: true,
      isCurrent: () => true,
      isPenDown: () => false,
      node,
      onFilteredFrame,
      requestFrame: clock.requestFrame,
    });

    expect(node.clearCache).toHaveBeenCalledTimes(1);
    expect(node.cache).toHaveBeenCalledWith({ pixelRatio: 1 });
    expect(node.layer.batchDraw).toHaveBeenCalledTimes(1);
    expect(onFilteredFrame).toHaveBeenCalledTimes(1);

    clock.fireNext(79);
    expect(node.cache).toHaveBeenCalledTimes(1);
    clock.fireNext(80);
    expect(node.cache).toHaveBeenCalledTimes(2);
    expect(node.layer.batchDraw).toHaveBeenCalledTimes(2);

    loop.stop();
  });

  it("pauses cache and redraw work during pen-down and resumes on the next frame", () => {
    const clock = frameHarness();
    const node = fakeNode();
    let penDown = true;
    const loop = startStudioAnimatedImageFilterFrameLoop({
      cacheConfig: { pixelRatio: 1 },
      cancelFrame: clock.cancelFrame,
      filterFrames: true,
      isCurrent: () => true,
      isPenDown: () => penDown,
      node,
      requestFrame: clock.requestFrame,
    });

    expect(node.cache).not.toHaveBeenCalled();
    clock.fireNext(80);
    expect(node.cache).not.toHaveBeenCalled();
    expect(node.layer.batchDraw).not.toHaveBeenCalled();

    penDown = false;
    clock.fireNext(81);
    expect(node.cache).toHaveBeenCalledTimes(1);
    expect(node.layer.batchDraw).toHaveBeenCalledTimes(1);

    loop.stop();
  });

  it("cancels pending work and releases the filtered cache on unmount", () => {
    const clock = frameHarness();
    const node = fakeNode();
    const loop = startStudioAnimatedImageFilterFrameLoop({
      cacheConfig: { offset: 4, pixelRatio: 1 },
      cancelFrame: clock.cancelFrame,
      filterFrames: true,
      isCurrent: () => true,
      isPenDown: () => false,
      node,
      requestFrame: clock.requestFrame,
    });
    const pendingId = clock.pending.keys().next().value as number;
    node.clearCache.mockClear();
    node.layer.batchDraw.mockClear();

    loop.stop();

    expect(clock.cancelFrame).toHaveBeenCalledWith(pendingId);
    expect(clock.pending).toHaveLength(0);
    expect(node.clearCache).toHaveBeenCalledTimes(1);
    expect(node.layer.batchDraw).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale source callback without recaching or scheduling more frames", () => {
    const clock = frameHarness();
    const node = fakeNode();
    let current = true;
    startStudioAnimatedImageFilterFrameLoop({
      cancelFrame: clock.cancelFrame,
      filterFrames: false,
      isCurrent: () => current,
      isPenDown: () => false,
      node,
      requestFrame: clock.requestFrame,
    });

    current = false;
    clock.fireNext(80);

    expect(node.cache).not.toHaveBeenCalled();
    expect(node.layer.batchDraw).not.toHaveBeenCalled();
    expect(clock.pending).toHaveLength(0);
  });

  it("reports a cache failure once and never redraws the raw animation", () => {
    const clock = frameHarness();
    const node = fakeNode();
    const error = new Error("canvas allocation failed");
    node.cache.mockImplementationOnce(() => {
      throw error;
    });
    const onRuntimeFailure = vi.fn();
    const loop = startStudioAnimatedImageFilterFrameLoop({
      cacheConfig: { pixelRatio: 1 },
      cancelFrame: clock.cancelFrame,
      filterFrames: true,
      isCurrent: () => true,
      isPenDown: () => false,
      node,
      onRuntimeFailure,
      requestFrame: clock.requestFrame,
    });

    expect(onRuntimeFailure).toHaveBeenCalledOnce();
    expect(onRuntimeFailure).toHaveBeenCalledWith(error);
    expect(node.layer.batchDraw).not.toHaveBeenCalled();
    expect(node.cache).toHaveBeenCalledOnce();
    expect(clock.pending).toHaveLength(0);

    loop.stop();
    expect(node.clearCache).toHaveBeenCalledTimes(1);
    expect(node.layer.batchDraw).not.toHaveBeenCalled();
  });
});
