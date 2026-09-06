import { afterEach, describe, expect, it } from "vitest";

import {
  getStudioReliabilityStatusSnapshot,
  resetStudioReliabilityStatus,
} from "./studio-reliability-status-store";
import {
  disposeStudioSafeModeRuntime,
  ensureStudioSafeModeRuntime,
} from "./studio-safe-mode-runtime";

import type { StudioDeviceLossClock } from "./studio-device-loss-recovery";

interface ManualClock extends StudioDeviceLossClock {
  /** 예약된 콜백을 순서대로 실행한다. */
  flush(): void;
  pending(): number;
}

function createManualClock(): ManualClock {
  let time = 0;
  const queue: (() => void)[] = [];
  return {
    now: () => (time += 1),
    schedule(callback) {
      queue.push(callback);
      return queue.length;
    },
    cancel(handle) {
      const index = (handle as number) - 1;
      if (index >= 0 && index < queue.length) queue[index] = () => undefined;
    },
    flush() {
      while (queue.length > 0) {
        const next = queue.shift();
        next?.();
      }
    },
    pending: () => queue.length,
  };
}

afterEach(() => {
  disposeStudioSafeModeRuntime();
  resetStudioReliabilityStatus();
});

describe("studio safe mode runtime — recovery wiring", () => {
  it("does not acquire a GPU device merely by being installed", () => {
    let acquisitions = 0;
    ensureStudioSafeModeRuntime({
      clock: createManualClock(),
      subscribeDeviceLoss: () => () => undefined,
      acquireDevice: async () => {
        acquisitions += 1;
        return {};
      },
    });

    expect(acquisitions).toBe(0);
    expect(getStudioReliabilityStatusSnapshot().gpu).toBeNull();
    expect(getStudioReliabilityStatusSnapshot().safeMode.active).toBe(false);
  });

  it("turns an injected device loss into a user-visible notice and safe mode", async () => {
    const clock = createManualClock();
    const runtime = ensureStudioSafeModeRuntime({
      clock,
      subscribeDeviceLoss: () => () => undefined,
      acquireDevice: async () => null,
    });

    runtime.announceGpuLoss("device-removed");
    await Promise.resolve();
    await Promise.resolve();

    const snapshot = getStudioReliabilityStatusSnapshot();
    expect(snapshot.gpu).not.toBeNull();
    expect(snapshot.gpu?.level).toBe("degraded");
    expect(snapshot.gpu?.title).toContain("GPU 렌더러");
    expect(snapshot.gpu?.detail).toContain("자동 전환하지 않고");
    expect(snapshot.safeMode.active).toBe(true);
    expect(snapshot.safeMode.reasons).toContain("gpu-device-lost");
    expect(snapshot.safeMode.quality.gpuLanesDisabled).toBe(true);
  });

  it("fans out the fabric loss event through the same entry point", async () => {
    const clock = createManualClock();
    let emit: ((event: { readonly reason: string }) => void) | null = null;
    ensureStudioSafeModeRuntime({
      clock,
      subscribeDeviceLoss: (listener) => {
        emit = listener;
        return () => {
          emit = null;
        };
      },
      acquireDevice: async () => null,
    });

    expect(emit).not.toBeNull();
    emit!({ reason: "fabric-loss" });
    await Promise.resolve();
    await Promise.resolve();

    expect(getStudioReliabilityStatusSnapshot().safeMode.active).toBe(true);
  });

  it("leaves safe mode and reports recovery when the device comes back", async () => {
    const clock = createManualClock();
    let acquisitions = 0;
    const runtime = ensureStudioSafeModeRuntime({
      clock,
      subscribeDeviceLoss: () => () => undefined,
      acquireDevice: async () => {
        acquisitions += 1;
        return { id: acquisitions };
      },
    });

    runtime.announceGpuLoss("transient");
    await Promise.resolve();
    await Promise.resolve();
    expect(getStudioReliabilityStatusSnapshot().safeMode.active).toBe(true);

    clock.flush();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const snapshot = getStudioReliabilityStatusSnapshot();
    expect(acquisitions).toBe(1);
    expect(snapshot.safeMode.active).toBe(false);
    expect(snapshot.gpu?.level).toBe("ok");
    expect(snapshot.gpu?.title).toContain("다시");
  });

  it("parks in a permanent demotion after repeated losses and says so", async () => {
    const clock = createManualClock();
    const runtime = ensureStudioSafeModeRuntime({
      clock,
      subscribeDeviceLoss: () => () => undefined,
      acquireDevice: async () => ({}),
      permanentDemotionThreshold: 1,
    });

    runtime.announceGpuLoss("hard-loss");
    await Promise.resolve();
    await Promise.resolve();

    const snapshot = getStudioReliabilityStatusSnapshot();
    expect(runtime.state()).toBe("permanently-demoted");
    expect(snapshot.gpu?.level).toBe("failed");
    expect(snapshot.safeMode.reasons).toContain("gpu-permanently-demoted");
    expect(snapshot.gpu?.detail).toContain("마지막 정상 프레임은 그대로 보존");
    expect(snapshot.gpu?.detail).toContain("다른 엔진은 직접 선택");
  });

  it("keeps one state machine per session across repeated ensure calls", () => {
    const clock = createManualClock();
    const first = ensureStudioSafeModeRuntime({
      clock,
      subscribeDeviceLoss: () => () => undefined,
      acquireDevice: async () => null,
    });
    const second = ensureStudioSafeModeRuntime();
    expect(second).toBe(first);
  });
});
