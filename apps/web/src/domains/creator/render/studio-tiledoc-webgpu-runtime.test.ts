import { describe, expect, it, vi } from "vitest";

import { StudioTiledDocumentStore } from "./studio-tiledoc-store";
import {
  StudioTileDocWebGpuRuntime,
  type StudioTileDocWebGpuRuntimeFrameRequest,
} from "./studio-tiledoc-webgpu-runtime";

import type {
  StudioTileDocWebGpuPresentRequest,
  StudioTileDocWebGpuPresentResult,
} from "./studio-tiledoc-webgpu-bridge";
import type { StudioTileDocWebGpuCompositeConsumerStats } from "./studio-tiledoc-webgpu-composite-consumer";

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

function emptyConsumerStats(deviceGeneration: number): StudioTileDocWebGpuCompositeConsumerStats {
  return {
    active: false,
    disposed: false,
    deviceGeneration,
    retainedEntries: 0,
    retainedBytes: 0,
    uploadPoolEntries: 0,
    uploadPoolBytes: 0,
    activeUploadBytes: 0,
    sourceCacheEntries: 0,
    sourceCacheBytes: 0,
    sourceCacheHits: 0,
    sourceCacheMisses: 0,
    sourceCacheEvictions: 0,
    retainedCacheHits: 0,
    retainedCacheMisses: 0,
    retainedCacheEvictions: 0,
    compositeCacheReuses: 0,
    sourceUploadCount: 0,
    sourcePayloadBytesUploaded: 0,
    physicalBytesUploaded: 0,
    presentedFrames: 0,
    presentationDraws: 0,
    hotPathReadbackCount: 0,
    validationReadbackCount: 0,
    validationReadbackBytes: 0,
    trackedGpuBytes: 0,
    peakTrackedGpuBytes: 0,
    deviceOwnership: "none",
    deviceEpoch: 0,
  };
}

class FakeAnimationFrames {
  private nextHandle = 1;
  private readonly callbacks = new Map<number, FrameRequestCallback>();

  public readonly request = vi.fn((callback: FrameRequestCallback): number => {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.callbacks.set(handle, callback);
    return handle;
  });

  public readonly cancel = vi.fn((handle: number): void => {
    this.callbacks.delete(handle);
  });

  public pendingCount(): number {
    return this.callbacks.size;
  }

  public runNext(timestamp = 16): boolean {
    const next = [...this.callbacks.entries()].sort((left, right) => left[0] - right[0])[0];
    if (!next) return false;
    this.callbacks.delete(next[0]);
    next[1](timestamp);
    return true;
  }
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function frame(frameId: string): StudioTileDocWebGpuRuntimeFrameRequest {
  return {
    frameId,
    viewport: { x: 0, y: 0, width: 128, height: 64 },
    layers: [{ id: "ink" }],
  };
}

function readyPresentation(
  requestSequence: number,
  deviceGeneration = 1
): Extract<StudioTileDocWebGpuPresentResult, { status: "ready" }> {
  return {
    status: "ready",
    requestSequence,
    presentationRevision: requestSequence,
    contentRevision: requestSequence,
    plannerFrameSequence: requestSequence,
    plannerVisualRevision: requestSequence,
    scopeId: "tiledoc-viewport:0:0:1:0",
    deviceGeneration,
    visibleTileCount: 2,
    dirtyTileIds: ["0:0", "1:0"],
    snapshotBytes: 2 * 64 * 64 * 4,
  };
}

function rejectedPresentation(
  requestSequence: number,
  consumerReason: string
): Extract<StudioTileDocWebGpuPresentResult, { status: "rejected" }> {
  return {
    status: "rejected",
    reason: "consumer-rejected",
    requestSequence,
    consumerReason,
  };
}

function fakeCanvas(): HTMLCanvasElement {
  return {
    width: 300,
    height: 150,
    style: {},
    getContext: vi.fn(),
  } as unknown as HTMLCanvasElement;
}

function fakeStore(): StudioTiledDocumentStore {
  return new StudioTiledDocumentStore({
    documentWidth: 128,
    documentHeight: 64,
    tileSize: 64,
  });
}

function runtimeHarness(options: {
  readonly present?: (
    request: StudioTileDocWebGpuPresentRequest
  ) => Promise<StudioTileDocWebGpuPresentResult>;
  readonly maxDeviceRecoveryAttempts?: number;
} = {}) {
  const animationFrames = new FakeAnimationFrames();
  const canvas = fakeCanvas();
  const consumerInvalidate = vi.fn();
  const consumerDispose = vi.fn();
  const bridgeInvalidate = vi.fn();
  const bridgeDispose = vi.fn();
  const consumerFactory = vi.fn();
  const bridgeFactory = vi.fn();
  let defaultPresentSequence = 0;
  const defaultPresent = async (): Promise<StudioTileDocWebGpuPresentResult> => {
    defaultPresentSequence += 1;
    return readyPresentation(defaultPresentSequence);
  };
  const bridgePresent = vi.fn(options.present ?? defaultPresent);
  let deviceLost: ((info: GPUDeviceLostInfo) => void) | null = null;

  consumerFactory.mockImplementation((context) => {
    deviceLost = context.onDeviceLost;
    return {
      supportedBlendModes: ["normal"],
      present: vi.fn(),
      invalidate: consumerInvalidate,
      dispose: consumerDispose,
      stats: () => emptyConsumerStats(1),
    };
  });
  bridgeFactory.mockImplementation(() => ({
    present: bridgePresent,
    invalidate: bridgeInvalidate,
    dispose: bridgeDispose,
    stats: () => ({
      active: false,
      disposed: false,
      requestSequence: bridgePresent.mock.calls.length,
      presentationRevision: bridgePresent.mock.calls.length,
      contentRevision: bridgePresent.mock.calls.length,
    }),
  }));
  const onFrameReady = vi.fn();
  const onUnavailable = vi.fn();
  const onDeviceLost = vi.fn();
  const onStatusChange = vi.fn();
  const runtime = new StudioTileDocWebGpuRuntime({
    canvas,
    store: fakeStore(),
    requestAnimationFrame: animationFrames.request,
    cancelAnimationFrame: animationFrames.cancel,
    createConsumer: consumerFactory,
    createBridge: bridgeFactory,
    maxDeviceRecoveryAttempts: options.maxDeviceRecoveryAttempts,
    onFrameReady,
    onUnavailable,
    onDeviceLost,
    onStatusChange,
  });

  return {
    runtime,
    canvas,
    animationFrames,
    bridgePresent,
    bridgeInvalidate,
    bridgeDispose,
    consumerInvalidate,
    consumerDispose,
    consumerFactory,
    bridgeFactory,
    onFrameReady,
    onUnavailable,
    onDeviceLost,
    onStatusChange,
    loseDevice(info = { reason: "unknown", message: "test loss" } as GPUDeviceLostInfo) {
      if (!deviceLost) throw new Error("consumer_not_created");
      deviceLost(info);
    },
  };
}

describe("StudioTileDocWebGpuRuntime", () => {
  it("lazily creates the engine and coalesces queued frames to the latest RAF request", async () => {
    const harness = runtimeHarness();
    expect(harness.consumerFactory).not.toHaveBeenCalled();
    expect(harness.bridgeFactory).not.toHaveBeenCalled();
    expect(harness.canvas.style.visibility).toBe("hidden");
    expect(harness.runtime.resize({
      cssWidth: 320,
      cssHeight: 180,
      devicePixelRatio: 2,
    })).toEqual({
      status: "resized",
      cssWidth: 320,
      cssHeight: 180,
      devicePixelRatio: 2,
      backingWidth: 640,
      backingHeight: 360,
    });

    const first = harness.runtime.requestFrame(frame("frame-1"));
    const second = harness.runtime.requestFrame(frame("frame-2"));
    const latest = harness.runtime.requestFrame(frame("frame-3"));
    expect(await first).toMatchObject({ status: "superseded", frameId: "frame-1" });
    expect(await second).toMatchObject({ status: "superseded", frameId: "frame-2" });
    expect(harness.animationFrames.pendingCount()).toBe(1);
    expect(harness.consumerFactory).not.toHaveBeenCalled();

    harness.animationFrames.runNext();
    expect(await latest).toMatchObject({ status: "ready", frameId: "frame-3" });
    expect(harness.consumerFactory).toHaveBeenCalledTimes(1);
    expect(harness.bridgeFactory).toHaveBeenCalledTimes(1);
    expect(harness.bridgePresent).toHaveBeenCalledTimes(1);
    expect(harness.canvas.style.visibility).toBe("visible");
    expect(harness.runtime.stats()).toMatchObject({
      status: "ready",
      scheduledFrames: 3,
      presentedFrames: 1,
      coalescedFrames: 2,
      lastFrameId: "frame-3",
    });
  });

  it("keeps only the latest pending frame while an earlier GPU submission is active", async () => {
    const firstSubmission = deferred<StudioTileDocWebGpuPresentResult>();
    let call = 0;
    const harness = runtimeHarness({
      present: async () => {
        call += 1;
        return call === 1 ? firstSubmission.promise : readyPresentation(call);
      },
    });
    const first = harness.runtime.requestFrame(frame("active"));
    harness.animationFrames.runNext();
    await Promise.resolve();

    const middle = harness.runtime.requestFrame(frame("middle"));
    const latest = harness.runtime.requestFrame(frame("latest"));
    expect(await middle).toMatchObject({ status: "superseded", frameId: "middle" });
    firstSubmission.resolve(readyPresentation(1));
    expect(await first).toMatchObject({ status: "ready", frameId: "active" });
    await vi.waitFor(() => expect(harness.animationFrames.pendingCount()).toBe(1));

    harness.animationFrames.runNext();
    expect(await latest).toMatchObject({ status: "ready", frameId: "latest" });
    expect(harness.bridgePresent).toHaveBeenCalledTimes(2);
  });

  it("re-presents the last camera after DPR resize and fails closed for unsafe backing sizes", async () => {
    const harness = runtimeHarness();
    const initial = harness.runtime.requestFrame(frame("camera"));
    harness.animationFrames.runNext();
    await initial;

    expect(harness.runtime.resize({
      cssWidth: 400,
      cssHeight: 300,
      devicePixelRatio: 2,
    })).toMatchObject({
      status: "resized",
      backingWidth: 800,
      backingHeight: 600,
    });
    await vi.waitFor(() => expect(harness.animationFrames.pendingCount()).toBe(1));
    harness.animationFrames.runNext();
    await vi.waitFor(() => expect(harness.bridgePresent).toHaveBeenCalledTimes(2));

    expect(harness.runtime.resize({
      cssWidth: 100_000,
      cssHeight: 100_000,
      devicePixelRatio: 2,
    })).toEqual({ status: "rejected", reason: "backing-size-limit" });
    expect(harness.runtime.stats()).toMatchObject({
      status: "unavailable",
      unavailableActive: true,
      unavailableCount: 1,
    });
    expect(harness.canvas.style.visibility).toBe("hidden");
    expect(harness.onUnavailable).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: "studio-tiledoc-webgpu-unavailable",
      reason: "invalid-resize",
      bridgeReason: "backing-size-limit",
    }));
  });

  it("pauses pending work while hidden and resumes the exact latest frame when visible", async () => {
    const harness = runtimeHarness();
    const pending = harness.runtime.requestFrame(frame("hidden-frame"));
    expect(harness.animationFrames.pendingCount()).toBe(1);

    harness.runtime.setVisible(false);
    expect(harness.animationFrames.pendingCount()).toBe(0);
    expect(harness.runtime.stats().status).toBe("paused");
    expect(harness.bridgePresent).not.toHaveBeenCalled();

    harness.runtime.setVisible(true);
    expect(harness.animationFrames.pendingCount()).toBe(1);
    harness.animationFrames.runNext();
    expect(await pending).toMatchObject({ status: "ready", frameId: "hidden-frame" });
  });

  it("aborts an active hidden-tab submission and preserves its promise for visible retry", async () => {
    let call = 0;
    const harness = runtimeHarness({
      present: async (request) => {
        call += 1;
        if (call > 1) return readyPresentation(2);
        return new Promise((resolve) => {
          request.signal?.addEventListener("abort", () => {
            resolve(rejectedPresentation(1, "aborted"));
          }, { once: true });
        });
      },
    });
    const result = harness.runtime.requestFrame(frame("active-pause"));
    harness.animationFrames.runNext();
    await Promise.resolve();
    harness.runtime.setVisible(false);
    await vi.waitFor(() => expect(harness.runtime.stats()).toMatchObject({
      status: "paused",
      pendingFrameId: "active-pause",
      activeFrameId: null,
    }));
    expect(harness.canvas.style.visibility).toBe("hidden");

    harness.runtime.setVisible(true);
    harness.animationFrames.runNext();
    expect(await result).toMatchObject({
      status: "ready",
      frameId: "active-pause",
    });
    expect(harness.bridgePresent).toHaveBeenCalledTimes(2);
  });

  it("pairs consumer/bridge invalidation and retries the same promise after device loss", async () => {
    const harnessRef: { current?: ReturnType<typeof runtimeHarness> } = {};
    let call = 0;
    const harness = runtimeHarness({
      present: async () => {
        call += 1;
        if (call === 1) {
          harnessRef.current!.loseDevice();
          return rejectedPresentation(1, "device-lost");
        }
        return readyPresentation(2, 2);
      },
    });
    harnessRef.current = harness;
    const result = harness.runtime.requestFrame(frame("recover"));
    harness.animationFrames.runNext();
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.consumerInvalidate).toHaveBeenCalledTimes(1);
    expect(harness.bridgeInvalidate).toHaveBeenCalledTimes(1);
    expect(harness.onDeviceLost).toHaveBeenCalledTimes(1);
    expect(harness.animationFrames.pendingCount()).toBe(1);
    expect(harness.runtime.stats()).toMatchObject({
      status: "scheduled",
      deviceLossCount: 1,
      recoveryAttempts: 1,
    });

    harness.animationFrames.runNext();
    expect(await result).toMatchObject({
      status: "ready",
      frameId: "recover",
      presentation: { deviceGeneration: 2 },
    });
    expect(harness.runtime.stats()).toMatchObject({
      status: "ready",
      recoveryAttempts: 0,
      presentedFrames: 1,
    });
  });

  it("fails closed as unavailable after bounded WebGPU recovery exhaustion", async () => {
    const harnessRef: { current?: ReturnType<typeof runtimeHarness> } = {};
    const harness = runtimeHarness({
      maxDeviceRecoveryAttempts: 1,
      present: async () => {
        harnessRef.current!.loseDevice();
        return rejectedPresentation(1, "device-lost");
      },
    });
    harnessRef.current = harness;
    const result = harness.runtime.requestFrame(frame("unstable"));
    harness.animationFrames.runNext();
    await Promise.resolve();
    await Promise.resolve();
    harness.animationFrames.runNext();

    expect(await result).toMatchObject({
      status: "unavailable",
      frameId: "unstable",
      failure: {
        kind: "studio-tiledoc-webgpu-unavailable",
        reason: "device-recovery-exhausted",
        recoverable: false,
        bridgeReason: "device-lost",
      },
    });
    expect(harness.runtime.stats()).toMatchObject({
      status: "unavailable",
      unavailableActive: true,
      deviceLossCount: 2,
      unavailableCount: 1,
    });
  });

  it("keeps unavailable sticky until an explicit same-provider retry", async () => {
    let fail = true;
    const harness = runtimeHarness({
      present: async () => (
        fail
          ? rejectedPresentation(1, "webgpu-unavailable")
          : readyPresentation(2)
      ),
    });
    const first = harness.runtime.requestFrame(frame("unavailable-1"));
    harness.animationFrames.runNext();
    expect(await first).toMatchObject({
      status: "unavailable",
      failure: {
        reason: "presentation-rejected",
        consumerReason: "webgpu-unavailable",
      },
    });

    const second = await harness.runtime.requestFrame(frame("unavailable-2"));
    expect(second).toMatchObject({ status: "unavailable", frameId: "unavailable-2" });
    expect(harness.bridgePresent).toHaveBeenCalledTimes(1);
    fail = false;
    expect(harness.runtime.retrySelectedWebGpu()).toBe(true);
    expect(harness.consumerInvalidate).toHaveBeenCalled();
    expect(harness.bridgeInvalidate).toHaveBeenCalled();
    harness.animationFrames.runNext();
    await vi.waitFor(() => expect(harness.onFrameReady).toHaveBeenCalledWith(
      "unavailable-2",
      expect.objectContaining({ status: "ready" })
    ));
    expect(harness.runtime.stats()).toMatchObject({
      status: "ready",
      unavailableActive: false,
    });
  });

  it("cancels pending lifecycle work and releases lazy resources on dispose", async () => {
    const pendingHarness = runtimeHarness();
    const pending = pendingHarness.runtime.requestFrame(frame("pending-dispose"));
    pendingHarness.runtime.dispose();
    expect(await pending).toEqual({
      status: "rejected",
      requestSequence: 1,
      frameId: "pending-dispose",
      reason: "disposed",
    });
    expect(pendingHarness.animationFrames.pendingCount()).toBe(0);
    expect(pendingHarness.consumerFactory).not.toHaveBeenCalled();

    const activeHarness = runtimeHarness();
    const ready = activeHarness.runtime.requestFrame(frame("ready"));
    activeHarness.animationFrames.runNext();
    await ready;
    activeHarness.runtime.dispose();
    expect(activeHarness.bridgeDispose).toHaveBeenCalledTimes(1);
    expect(activeHarness.consumerDispose).toHaveBeenCalledTimes(1);
    expect(activeHarness.runtime.stats()).toMatchObject({ status: "disposed" });
    expect(activeHarness.canvas.style.visibility).toBe("hidden");
  });

  it("disposes a lazily created consumer when bridge construction fails", async () => {
    const animationFrames = new FakeAnimationFrames();
    const consumerDispose = vi.fn();
    const onUnavailable = vi.fn();
    const runtime = new StudioTileDocWebGpuRuntime({
      canvas: fakeCanvas(),
      store: fakeStore(),
      requestAnimationFrame: animationFrames.request,
      cancelAnimationFrame: animationFrames.cancel,
      createConsumer: () => ({
        supportedBlendModes: ["normal"],
        present: vi.fn(),
        invalidate: vi.fn(),
        dispose: consumerDispose,
        stats: () => emptyConsumerStats(0),
      }),
      createBridge: () => {
        throw new Error("bridge construction failed");
      },
      onUnavailable,
    });
    const result = runtime.requestFrame(frame("construction-failure"));
    animationFrames.runNext();

    expect(await result).toMatchObject({
      status: "unavailable",
      failure: {
        reason: "runtime-error",
        bridgeReason: "runtime-construction-failed",
      },
    });
    expect(consumerDispose).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });
});
