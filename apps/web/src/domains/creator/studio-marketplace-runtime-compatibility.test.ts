import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_MARKETPLACE_COMPATIBILITY_VERSION,
  getProductStudioMarketplaceRuntimeCompatibility,
  probeStudioMarketplaceRuntimeCompatibility,
} from "./studio-marketplace-runtime-compatibility";

describe("Studio marketplace runtime compatibility", () => {
  it("publishes a compatibility authority independent from the application package version", () => {
    expect(STUDIO_MARKETPLACE_COMPATIBILITY_VERSION).toBe("1.0.0");
  });

  it("admits only engines proven by actual contexts and a WebGPU adapter", async () => {
    const context = await probeStudioMarketplaceRuntimeCompatibility({
      probeCanvasContext: (contextId) => contextId === "2d" || contextId === "webgl2",
      probeWebGpuAdapter: async () => true,
    });

    expect(context).toEqual({
      currentStudioVersion: "1.0.0",
      supportedEngines: ["canvas2d", "webgl2", "webgpu", "three"],
      unverifiedEngines: [],
    });
  });

  it("keeps only a thrown adapter probe unverified while preserving known Canvas support", async () => {
    const context = await probeStudioMarketplaceRuntimeCompatibility({
      probeCanvasContext: (contextId) => contextId === "2d",
      probeWebGpuAdapter: async () => {
        throw new Error("adapter denied");
      },
    });

    expect(context).toEqual({
      currentStudioVersion: "1.0.0",
      supportedEngines: ["canvas2d"],
      unverifiedEngines: ["webgpu"],
    });
  });

  it("preserves an explicit unmeasured engine state outside a browser runtime", async () => {
    const context = await probeStudioMarketplaceRuntimeCompatibility({
      probeCanvasContext: () => null,
      probeWebGpuAdapter: async () => null,
    });

    expect(context).toEqual({
      currentStudioVersion: "1.0.0",
      supportedEngines: [],
      unverifiedEngines: ["canvas2d", "webgl2", "webgpu", "three"],
    });
  });

  it("preserves known Canvas and WebGL engines when only WebGPU is inconclusive", async () => {
    const context = await probeStudioMarketplaceRuntimeCompatibility({
      probeCanvasContext: () => true,
      probeWebGpuAdapter: async () => null,
    });

    expect(context).toEqual({
      currentStudioVersion: "1.0.0",
      supportedEngines: ["canvas2d", "webgl2", "three"],
      unverifiedEngines: ["webgpu"],
    });
  });

  it("ties Three uncertainty to an inconclusive WebGL2 context without hiding Canvas2D", async () => {
    const context = await probeStudioMarketplaceRuntimeCompatibility({
      probeCanvasContext: (contextId) => contextId === "2d" ? true : null,
      probeWebGpuAdapter: async () => false,
    });

    expect(context).toEqual({
      currentStudioVersion: "1.0.0",
      supportedEngines: ["canvas2d"],
      unverifiedEngines: ["webgl2", "three"],
    });
  });

  it("keeps explicit negative probes conclusively unsupported", async () => {
    const context = await probeStudioMarketplaceRuntimeCompatibility({
      probeCanvasContext: () => false,
      probeWebGpuAdapter: async () => false,
    });

    expect(context).toEqual({
      currentStudioVersion: "1.0.0",
      supportedEngines: [],
      unverifiedEngines: [],
    });
  });

  it("evicts a partial product probe so an explicit retry performs fresh measurements", async () => {
    const probeCanvasContext = vi.fn((contextId: "2d" | "webgl2") => contextId === "2d");
    const probeWebGpuAdapter = vi.fn(async () => null);
    const options = { probeCanvasContext, probeWebGpuAdapter } as const;

    const firstProbe = getProductStudioMarketplaceRuntimeCompatibility(options);
    await expect(firstProbe).resolves.toEqual({
      currentStudioVersion: "1.0.0",
      supportedEngines: ["canvas2d"],
      unverifiedEngines: ["webgpu"],
    });

    const retryProbe = getProductStudioMarketplaceRuntimeCompatibility(options);
    expect(retryProbe).not.toBe(firstProbe);
    await retryProbe;
    expect(probeCanvasContext).toHaveBeenCalledTimes(4);
    expect(probeWebGpuAdapter).toHaveBeenCalledTimes(2);
  });
});
