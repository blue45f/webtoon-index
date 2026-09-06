import { afterEach, describe, expect, it, vi } from "vitest";

import {
  probeStudioCapabilitySnapshot,
  studioCapabilityProbeInputFromGlobals,
  type StudioCapabilityAdapterLike,
  type StudioCapabilityNavigatorLike,
} from "./studio-capability-probe";
import { classifyStudioCapabilityTier } from "./studio-capability-tier";

const MIB = 1024 * 1024;

const GOOD_LIMITS = {
  maxBufferSize: 1024 * MIB,
  maxStorageBufferBindingSize: 512 * MIB,
  maxUniformBufferBindingSize: 65_536,
  maxComputeWorkgroupStorageSize: 32_768,
  maxComputeInvocationsPerWorkgroup: 256,
  maxTextureDimension2D: 16_384,
  maxTextureDimension3D: 2_048,
  maxStorageBuffersPerShaderStage: 8,
};

function navigatorWith(
  adapter: StudioCapabilityAdapterLike | null,
  extra: Partial<StudioCapabilityNavigatorLike> = {},
): StudioCapabilityNavigatorLike {
  return {
    gpu: { requestAdapter: () => Promise.resolve(adapter) },
    hardwareConcurrency: 8,
    deviceMemory: 8,
    ...extra,
  };
}

/** GPUSupportedLimits 처럼 프로토타입 getter 로만 노출되는 한도 객체를 흉내 낸다. */
function prototypeLimits(values: Record<string, number>, throwing: readonly string[] = []) {
  const prototype: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(prototype, key, { get: () => value, enumerable: false });
  }
  for (const key of throwing) {
    Object.defineProperty(prototype, key, {
      get: () => {
        throw new Error(`unsupported limit: ${key}`);
      },
      enumerable: false,
    });
  }
  return Object.create(prototype) as Record<string, unknown>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("probeStudioCapabilitySnapshot — 실패 경로", () => {
  it("navigator 자체가 없어도 던지지 않는다", async () => {
    const snapshot = await probeStudioCapabilitySnapshot();
    expect(snapshot.webgpuAvailable).toBe(false);
    expect(snapshot.adapterAvailable).toBe(false);
    expect(snapshot.probeFailure).toBe("webgpu-api-unavailable");
  });

  it("navigator.gpu 가 없으면 API 미지원으로 기록한다", async () => {
    const snapshot = await probeStudioCapabilitySnapshot({
      navigator: { hardwareConcurrency: 12 },
    });
    expect(snapshot.webgpuAvailable).toBe(false);
    expect(snapshot.probeFailure).toBe("webgpu-api-unavailable");
    expect(snapshot.hardwareConcurrency).toBe(12);
  });

  it("navigator.gpu 접근이 막혀 있어도 던지지 않는다", async () => {
    const blocked = {} as StudioCapabilityNavigatorLike;
    Object.defineProperty(blocked, "gpu", {
      get: () => {
        throw new Error("permissions policy");
      },
    });
    const snapshot = await probeStudioCapabilitySnapshot({ navigator: blocked });
    expect(snapshot.webgpuAvailable).toBe(false);
    expect(snapshot.probeFailure).toBe("webgpu-api-unavailable");
  });

  it("어댑터가 null 이면 WebGPU 는 있고 어댑터만 없음으로 구분한다", async () => {
    const snapshot = await probeStudioCapabilitySnapshot({ navigator: navigatorWith(null) });
    expect(snapshot.webgpuAvailable).toBe(true);
    expect(snapshot.adapterAvailable).toBe(false);
    expect(snapshot.probeFailure).toBe("adapter-unavailable");
    expect(classifyStudioCapabilityTier(snapshot).code).toBe("adapter-unavailable");
  });

  it("requestAdapter 가 동기로 던져도 스냅샷으로 흡수한다", async () => {
    const snapshot = await probeStudioCapabilitySnapshot({
      navigator: {
        gpu: {
          requestAdapter: () => {
            throw new Error("driver crash");
          },
        },
      },
    });
    expect(snapshot.webgpuAvailable).toBe(true);
    expect(snapshot.probeFailure).toBe("adapter-request-failed");
  });

  it("requestAdapter 가 reject 해도 스냅샷으로 흡수한다", async () => {
    const snapshot = await probeStudioCapabilitySnapshot({
      navigator: { gpu: { requestAdapter: () => Promise.reject(new Error("nope")) } },
    });
    expect(snapshot.probeFailure).toBe("adapter-request-failed");
  });

  it("응답이 없으면 타임아웃으로 끊는다", async () => {
    vi.useFakeTimers();
    const pending = probeStudioCapabilitySnapshot({
      navigator: { gpu: { requestAdapter: () => new Promise(() => {}) } },
      timeoutMs: 1,
    });
    // timeoutMs 는 최소 250ms 로 보정된다.
    await vi.advanceTimersByTimeAsync(249);
    await vi.advanceTimersByTimeAsync(1);
    const snapshot = await pending;
    expect(snapshot.probeFailure).toBe("adapter-request-timeout");
    expect(snapshot.adapterAvailable).toBe(false);
  });

  it("이미 중단된 signal 이면 어댑터를 요청하지 않는다", async () => {
    const requestAdapter = vi.fn(() => Promise.resolve(null));
    const controller = new AbortController();
    controller.abort();
    const snapshot = await probeStudioCapabilitySnapshot({
      navigator: { gpu: { requestAdapter } },
      signal: controller.signal,
    });
    expect(requestAdapter).not.toHaveBeenCalled();
    expect(snapshot.probeFailure).toBe("adapter-request-aborted");
  });

  it("요청 도중 중단되면 중단으로 기록한다", async () => {
    const controller = new AbortController();
    const pending = probeStudioCapabilitySnapshot({
      navigator: { gpu: { requestAdapter: () => new Promise(() => {}) } },
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).resolves.toMatchObject({ probeFailure: "adapter-request-aborted" });
  });
});

describe("probeStudioCapabilitySnapshot — 어댑터 판독", () => {
  it("프로토타입 getter 로만 노출되는 한도를 이름으로 읽는다", async () => {
    const snapshot = await probeStudioCapabilitySnapshot({
      navigator: navigatorWith({
        limits: prototypeLimits(GOOD_LIMITS),
        features: new Set(["timestamp-query", "shader-f16"]),
      }),
      crossOriginIsolated: true,
      sharedArrayBufferAvailable: true,
    });
    expect(snapshot.adapterAvailable).toBe(true);
    expect(snapshot.limits).toEqual(GOOD_LIMITS);
    expect(snapshot.features).toEqual(["timestamp-query", "shader-f16"]);
    expect(snapshot.crossOriginIsolated).toBe(true);
    expect(snapshot.sharedArrayBufferAvailable).toBe(true);
    expect(snapshot.hardwareConcurrency).toBe(8);
    expect(snapshot.deviceMemoryGb).toBe(8);
    expect(classifyStudioCapabilityTier(snapshot).tier).toBe("full");
  });

  it("던지는 한도 getter 는 그 한도만 확인 불가로 남긴다", async () => {
    const { maxTextureDimension3D: _omitted, ...rest } = GOOD_LIMITS;
    const snapshot = await probeStudioCapabilitySnapshot({
      navigator: navigatorWith({
        limits: prototypeLimits(rest, ["maxTextureDimension3D"]),
        features: [],
      }),
    });
    expect(snapshot.limits.maxTextureDimension3D).toBeUndefined();
    expect(snapshot.limits.maxBufferSize).toBe(1024 * MIB);
  });

  it("iterable 이 없는 기능 집합은 has() 로 되묻는다", async () => {
    const supported = new Set(["float32-filterable"]);
    const snapshot = await probeStudioCapabilitySnapshot({
      navigator: navigatorWith({
        limits: prototypeLimits(GOOD_LIMITS),
        features: { has: (feature: string) => supported.has(feature) },
      }),
    });
    expect(snapshot.features).toEqual(["float32-filterable"]);
  });

  it("has() 가 던지는 기능 이름은 없는 것으로 본다", async () => {
    const snapshot = await probeStudioCapabilitySnapshot({
      navigator: navigatorWith({
        limits: prototypeLimits(GOOD_LIMITS),
        features: {
          has: (feature: string) => {
            if (feature === "shader-f16") throw new Error("unknown feature");
            return feature === "timestamp-query";
          },
        },
      }),
    });
    expect(snapshot.features).toEqual(["timestamp-query"]);
  });

  it("기능·한도가 아예 없어도 빈 값으로 정규화한다", async () => {
    const snapshot = await probeStudioCapabilitySnapshot({ navigator: navigatorWith({}) });
    expect(snapshot.adapterAvailable).toBe(true);
    expect(snapshot.features).toEqual([]);
    expect(snapshot.limits).toEqual({});
    expect(classifyStudioCapabilityTier(snapshot).code).toBe("below-floor");
  });

  it("잘못된 호스트 신호는 확인 불가로 남긴다", async () => {
    const snapshot = await probeStudioCapabilitySnapshot({
      navigator: navigatorWith(
        { limits: prototypeLimits(GOOD_LIMITS), features: [] },
        { hardwareConcurrency: Number.NaN, deviceMemory: -2 },
      ),
    });
    expect(snapshot.hardwareConcurrency).toBeNull();
    expect(snapshot.deviceMemoryGb).toBeNull();
  });

  it("powerPreference 를 어댑터 요청에 그대로 전달한다", async () => {
    const requestAdapter = vi.fn(() => Promise.resolve(null));
    await probeStudioCapabilitySnapshot({
      navigator: { gpu: { requestAdapter } },
      powerPreference: "high-performance",
    });
    expect(requestAdapter).toHaveBeenCalledWith({ powerPreference: "high-performance" });
  });
});

describe("studioCapabilityProbeInputFromGlobals", () => {
  it("교차 출처 격리와 SharedArrayBuffer 가 모두 있을 때만 공유 메모리를 사용 가능으로 본다", () => {
    const isolated = studioCapabilityProbeInputFromGlobals({
      navigator: { hardwareConcurrency: 16 },
      crossOriginIsolated: true,
      SharedArrayBuffer: function SharedArrayBufferMock() {},
    });
    expect(isolated.crossOriginIsolated).toBe(true);
    expect(isolated.sharedArrayBufferAvailable).toBe(true);
    expect(isolated.powerPreference).toBe("high-performance");

    const notIsolated = studioCapabilityProbeInputFromGlobals({
      navigator: { hardwareConcurrency: 16 },
      crossOriginIsolated: false,
      SharedArrayBuffer: function SharedArrayBufferMock() {},
    });
    expect(notIsolated.sharedArrayBufferAvailable).toBe(false);
  });

  it("전역 접근이 던져도 안전한 기본값으로 수렴한다", () => {
    const hostile = {};
    for (const key of ["navigator", "crossOriginIsolated", "SharedArrayBuffer"]) {
      Object.defineProperty(hostile, key, {
        get: () => {
          throw new Error(`blocked: ${key}`);
        },
      });
    }
    const input = studioCapabilityProbeInputFromGlobals(hostile);
    expect(input.navigator).toBeNull();
    expect(input.crossOriginIsolated).toBe(false);
    expect(input.sharedArrayBufferAvailable).toBe(false);
  });

  it("빈 전역에서도 던지지 않는다", () => {
    const input = studioCapabilityProbeInputFromGlobals({});
    expect(input.navigator).toBeNull();
    expect(input.sharedArrayBufferAvailable).toBe(false);
  });
});
