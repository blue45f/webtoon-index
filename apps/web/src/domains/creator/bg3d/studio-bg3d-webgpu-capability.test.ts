import { describe, expect, it } from "vitest";

import { probeStudioBg3dWebGpuCapability } from "./studio-bg3d-webgpu-capability";

const GOOD_LIMITS = {
  maxBufferSize: 256 * 1024 * 1024,
  maxStorageBufferBindingSize: 64 * 1024 * 1024,
  maxComputeWorkgroupSizeX: 256,
};

describe("Studio BG3D WebGPU capability probe", () => {
  it("fails closed before adapter allocation for insecure or unavailable APIs", async () => {
    await expect(probeStudioBg3dWebGpuCapability({ secureContext: false }))
      .resolves.toMatchObject({ supported: false, reason: "insecure-context" });
    await expect(probeStudioBg3dWebGpuCapability({ secureContext: true }))
      .resolves.toMatchObject({ supported: false, reason: "api-unavailable" });
  });

  it("admits a sufficiently capable adapter and reports optional instrumentation", async () => {
    const result = await probeStudioBg3dWebGpuCapability({
      secureContext: true,
      gpu: {
        requestAdapter: async () => ({
          features: new Set(["timestamp-query"]),
          limits: GOOD_LIMITS,
        }),
      },
    });

    expect(result).toEqual({
      supported: true,
      reason: "available",
      computeSupported: true,
      timestampQuerySupported: true,
      limits: GOOD_LIMITS,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.limits)).toBe(true);
  });

  it("reads WebIDL-style non-enumerable limit getters explicitly", async () => {
    const limits = Object.create(null) as Record<string, number>;
    for (const [name, value] of Object.entries(GOOD_LIMITS)) {
      Object.defineProperty(limits, name, { get: () => value, enumerable: false });
    }
    expect(Object.keys(limits)).toEqual([]);

    await expect(probeStudioBg3dWebGpuCapability({
      secureContext: true,
      gpu: { requestAdapter: async () => ({ limits }) },
    })).resolves.toMatchObject({ supported: true, reason: "available", limits: GOOD_LIMITS });
  });

  it("reports an adapter without compute as unsuitable for a compute-capable runtime", async () => {
    await expect(probeStudioBg3dWebGpuCapability({
      secureContext: true,
      gpu: {
        requestAdapter: async () => ({
          limits: { ...GOOD_LIMITS, maxComputeWorkgroupSizeX: 0 },
        }),
      },
    })).resolves.toMatchObject({ supported: true, computeSupported: false });
  });

  it("rejects low allocation limits and observes abort while adapter selection is pending", async () => {
    await expect(probeStudioBg3dWebGpuCapability({
      secureContext: true,
      gpu: {
        requestAdapter: async () => ({
          limits: { ...GOOD_LIMITS, maxBufferSize: 64 * 1024 * 1024 },
        }),
      },
    })).resolves.toMatchObject({ supported: false, reason: "insufficient-limits" });

    const controller = new AbortController();
    const pending = probeStudioBg3dWebGpuCapability({
      secureContext: true,
      signal: controller.signal,
      gpu: { requestAdapter: () => new Promise(() => undefined) },
    });
    controller.abort();
    await expect(pending).resolves.toMatchObject({ supported: false, reason: "aborted" });
  });

  it("reports a rejected adapter request as unavailable rather than throwing", async () => {
    await expect(probeStudioBg3dWebGpuCapability({
      secureContext: true,
      gpu: { requestAdapter: async () => { throw new Error("no adapter"); } },
    })).resolves.toMatchObject({ supported: false, reason: "adapter-unavailable" });
  });
});
