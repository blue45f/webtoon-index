import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { probeStudioBg3dWebGpuCapability } from "./studio-bg3d-webgpu-capability";

import type { StudioBg3dGpuAdapterLike } from "./studio-bg3d-webgpu-capability";

const ADAPTER: StudioBg3dGpuAdapterLike = {
  features: ["timestamp-query"],
  limits: {
    maxBufferSize: 268_435_456,
    maxStorageBufferBindingSize: 134_217_728,
    maxComputeWorkgroupSizeX: 256,
  },
};

function deferredAdapter() {
  let resolve!: (value: StudioBg3dGpuAdapterLike | null) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<StudioBg3dGpuAdapterLike | null>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("BG3D late native adapter settlement", () => {
  it("keeps the three-second deadline and observes the same late request exactly once", async () => {
    const pending = deferredAdapter();
    const onLateResult = vi.fn();
    const requestAdapter = vi.fn(() => pending.promise);
    const finished = vi.fn();
    const result = probeStudioBg3dWebGpuCapability({
      secureContext: true, gpu: { requestAdapter }, onLateResult,
    });
    void result.then(finished);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(finished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ supported: false, reason: "timeout" });
    expect(onLateResult).not.toHaveBeenCalled();
    pending.resolve(ADAPTER);
    await vi.advanceTimersByTimeAsync(0);
    expect(onLateResult).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      supported: true, reason: "available", computeSupported: true,
    }));
    expect(requestAdapter).toHaveBeenCalledExactlyOnceWith({ powerPreference: "high-performance" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not notify the late observer for an on-time response", async () => {
    const onLateResult = vi.fn();
    const result = await probeStudioBg3dWebGpuCapability({
      secureContext: true,
      gpu: { requestAdapter: async () => ADAPTER },
      onLateResult,
    });
    expect(result.supported).toBe(true);
    expect(onLateResult).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    [null, "adapter-unavailable"],
    [{ limits: { maxBufferSize: 1, maxStorageBufferBindingSize: 1 } }, "insufficient-limits"],
  ] as const)("keeps late unavailable/insufficient adapters fail-closed: %s", async (adapter, reason) => {
    const pending = deferredAdapter();
    const onLateResult = vi.fn();
    const result = probeStudioBg3dWebGpuCapability({
      secureContext: true, gpu: { requestAdapter: () => pending.promise }, onLateResult,
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await result).reason).toBe("timeout");
    pending.resolve(adapter);
    await vi.advanceTimersByTimeAsync(0);
    expect(onLateResult).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      supported: false, reason,
    }));
  });

  it("observes a late rejection without an unhandled promise", async () => {
    const pending = deferredAdapter();
    const onLateResult = vi.fn();
    const result = probeStudioBg3dWebGpuCapability({
      secureContext: true, gpu: { requestAdapter: () => pending.promise }, onLateResult,
    });
    await vi.advanceTimersByTimeAsync(3_000);
    await result;
    pending.reject(new Error("device unavailable"));
    await vi.advanceTimersByTimeAsync(0);
    expect(onLateResult).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      supported: false, reason: "adapter-unavailable",
    }));
  });

  it.each(["before-timeout", "after-timeout"])("suppresses results aborted %s", async (when) => {
    const pending = deferredAdapter();
    const onLateResult = vi.fn();
    const controller = new AbortController();
    const result = probeStudioBg3dWebGpuCapability({
      secureContext: true,
      gpu: { requestAdapter: () => pending.promise },
      signal: controller.signal,
      onLateResult,
    });
    if (when === "after-timeout") await vi.advanceTimersByTimeAsync(3_000);
    controller.abort();
    expect((await result).reason).toBe(when === "after-timeout" ? "timeout" : "aborted");
    pending.resolve(ADAPTER);
    await vi.advanceTimersByTimeAsync(0);
    expect(onLateResult).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("isolates and reports an observer error without changing the initial verdict", async () => {
    const pending = deferredAdapter();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = probeStudioBg3dWebGpuCapability({
      secureContext: true,
      gpu: { requestAdapter: () => pending.promise },
      onLateResult: () => { throw new Error("observer stopped"); },
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await result).reason).toBe("timeout");
    pending.resolve(ADAPTER);
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledOnce();
  });
});
