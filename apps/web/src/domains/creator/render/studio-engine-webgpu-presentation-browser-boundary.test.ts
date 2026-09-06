import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");
const browserEntry = readFileSync(
  resolve(root, "scripts/studio-engine-webgpu-presentation-browser.ts"),
  "utf8",
);

describe("shared presentation surface real Chromium WebGPU boundary", () => {
  it("uses the production presentation owner and strict textured specialist", () => {
    expect(browserEntry).toContain("createStudioEngineWebGpuPresentationSurface");
    expect(browserEntry).toContain("createStudioEngineWebGpuTexturedBrushRuntime");
    expect(browserEntry).toContain("presentationOnly: true");
    expect(browserEntry).toContain("presentationLease: firstFrameResult.frame");
    expect(browserEntry).toContain("presentationLease: secondFrameResult.frame");
    expect(browserEntry).not.toContain("FakeGpu");
    expect(browserEntry).not.toContain("mockDevice");
    expect(browserEntry).not.toContain("fakeGpuHarness");
  });

  it("requires a real adapter, device and OffscreenCanvas WebGPU context", () => {
    expect(browserEntry).toContain("navigator.gpu.requestAdapter");
    expect(browserEntry).toContain("adapter.requestDevice");
    expect(browserEntry).toContain('canvas.getContext("webgpu")');
    expect(browserEntry).toContain("navigator.gpu.getPreferredCanvasFormat");
    expect(browserEntry).toContain('status: "unsupported"');
    expect(browserEntry).toContain('"webgpu-unavailable"');
    expect(browserEntry).toContain('"adapter-unavailable"');
    expect(browserEntry).toContain('"context-unavailable"');
  });

  it("reads the shared RGBA16F texture and optionally reads the presented canvas", () => {
    expect(browserEntry).toContain("copyTextureToBuffer");
    expect(browserEntry).toContain("RGBA16_BYTES_PER_PIXEL = 8");
    expect(browserEntry).toContain("ROW_ALIGNMENT = 256");
    expect(browserEntry).toContain("float16ToFloat32");
    expect(browserEntry).toContain("transferToImageBitmap");
    expect(browserEntry).toContain("getImageData");
    expect(browserEntry).toContain("nonZeroAlphaPixels");
  });

  it("covers DPR, viewport flip, resize epochs and receipt-gated visibility", () => {
    expect(browserEntry).toContain("dpr: 2");
    expect(browserEntry).toContain("flipX");
    expect(browserEntry).toContain("presentation.configure(firstLayout)");
    expect(browserEntry).toContain("presentation.configure(secondLayout)");
    expect(browserEntry).toContain("workSurfaceEpoch");
    expect(browserEntry).toContain("presentation.authorizesVisibility");
    expect(browserEntry).toContain("presentation.presentFrame");
  });

  it("proves a real rebuild-to-append content generation chain", () => {
    expect(browserEntry).toContain("appendPlanWithoutFingerprint");
    expect(browserEntry).toContain('"append content authority did not chain');
    expect(browserEntry).toContain("baseContentGeneration");
    expect(browserEntry).toContain("baseContentFingerprint");
    expect(browserEntry).toContain("contentGeneration");
    expect(browserEntry).toContain("contentFingerprint");
    expect(browserEntry).toContain("chainLinked");
  });

  it("fails closed for missing and stale leases", () => {
    expect(browserEntry).toContain('"presentation-lease-required"');
    expect(browserEntry).toContain('"presentation-lease-invalid"');
    expect(browserEntry).toContain("invalidStaleLease");
    expect(browserEntry).toContain("firstFrameResult.frame,\n    firstRender.receipt");
    expect(browserEntry).toContain("secondFrameResult.frame,\n    secondRender.receipt");
    expect(browserEntry).toContain('"invalid-frame"');
    expect(browserEntry).toContain("presentation.abortFrame");
  });

  it("proves disposal does not destroy an externally owned GPUDevice", () => {
    expect(browserEntry).toContain("ownsDevice: false");
    expect(browserEntry).toContain("runtime.dispose()");
    expect(browserEntry).toContain("presentation.dispose()");
    expect(browserEntry).toContain("externallyOwnedDeviceUsable");
    expect(browserEntry).toContain("device.queue.onSubmittedWorkDone()");
    expect(browserEntry).toContain("device.destroy()");
    expect(browserEntry).toContain("lostPromise");
  });

  it("captures uncaptured errors and a validation error scope", () => {
    expect(browserEntry).toContain('addEventListener("uncapturederror"');
    expect(browserEntry).toContain('pushErrorScope("validation")');
    expect(browserEntry).toContain("popErrorScope");
    expect(browserEntry).toContain("validationError");
  });
});
