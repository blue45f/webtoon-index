import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  StudioGpuBackend as CompatibleStudioGpuBackend,
  StudioGpuFrameReadbackRequest as CompatibleStudioGpuFrameReadbackRequest,
  StudioGpuFrameReadbackResult as CompatibleStudioGpuFrameReadbackResult,
  StudioGpuFrameReceipt as CompatibleStudioGpuFrameReceipt,
  StudioGpuPerformanceMetrics as CompatibleStudioGpuPerformanceMetrics,
} from "./studio-webgpu-engine";
import type {
  StudioGpuBackend,
  StudioGpuFrameReadbackRequest,
  StudioGpuFrameReadbackResult,
  StudioGpuFrameReceipt,
  StudioGpuPerformanceMetrics,
} from "./studio-webgpu-frame-contract";

function receipt(backend: StudioGpuBackend): StudioGpuFrameReceipt {
  return {
    requestId: "frame:42",
    fingerprint: "frame-fingerprint",
    backend,
    complete: true,
    strokeCount: 2,
    dabCount: 8,
    physicalWidth: 640,
    physicalHeight: 960,
  };
}

describe("studio WebGPU frame contract", () => {
  it("preserves receipt identity, backend, and readback discriminants", () => {
    const frameReceipt = receipt("webgpu");
    const request: StudioGpuFrameReadbackRequest = {
      receipt: frameReceipt,
      area: { kind: "viewport" },
    };
    const result: StudioGpuFrameReadbackResult = {
      status: "captured",
      receipt: frameReceipt,
      area: request.area,
      pixelRect: { x: 0, y: 0, width: 2, height: 1 },
      width: 2,
      height: 1,
      pixels: new Uint8ClampedArray(8),
      format: "rgba8unorm",
      alphaMode: "unpremultiplied",
    };

    expect(result.status).toBe("captured");
    expect(result.receipt).toBe(frameReceipt);
    expect(result.pixels).toHaveLength(8);
  });

  it("keeps engine-path type exports exactly compatible", () => {
    expectTypeOf<CompatibleStudioGpuBackend>().toEqualTypeOf<StudioGpuBackend>();
    expectTypeOf<CompatibleStudioGpuFrameReceipt>().toEqualTypeOf<StudioGpuFrameReceipt>();
    expectTypeOf<CompatibleStudioGpuFrameReadbackRequest>()
      .toEqualTypeOf<StudioGpuFrameReadbackRequest>();
    expectTypeOf<CompatibleStudioGpuFrameReadbackResult>()
      .toEqualTypeOf<StudioGpuFrameReadbackResult>();
    expectTypeOf<CompatibleStudioGpuPerformanceMetrics>()
      .toEqualTypeOf<StudioGpuPerformanceMetrics>();
  });

  it("retains bounded allocation metrics without exposing renderer resources", () => {
    const metrics: StudioGpuPerformanceMetrics = {
      instanceBufferAllocations: 1,
      presentationBufferAllocations: 2,
      presentationBindGroupAllocations: 3,
      presentationBindGroupReuses: 4,
    };

    expect(metrics.presentationBindGroupReuses).toBe(4);
  });
});
