import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");
const browserEntry = readFileSync(
  resolve(root, "scripts/studio-engine-webgpu-brush-parity-browser.ts"),
  "utf8",
);
const verifier = readFileSync(
  resolve(root, "scripts/verify-studio-engine-webgpu-brush-parity.mjs"),
  "utf8",
);

describe("Studio Engine real WebGPU brush parity browser boundary", () => {
  it("loads the new worker-compatible runtime through an isolated literal browser entry", () => {
    expect(browserEntry).toContain(
      'from "../apps/web/src/domains/creator/render/studio-engine-webgpu-brush-runtime"',
    );
    expect(verifier).toContain(
      'const HARNESS_ENTRY = "/scripts/studio-engine-webgpu-brush-parity-browser.ts";',
    );
    expect(verifier).toContain('appType: "custom"');
    expect(verifier).not.toContain("StudioPage");
    expect(verifier).not.toContain("packageJson");
  });

  it("requires a real Chromium WebGPU OffscreenCanvas and emits a structured skip", () => {
    expect(browserEntry).toContain("new OffscreenCanvas(WIDTH, HEIGHT)");
    expect(browserEntry).toContain('.getContext("webgpu")');
    expect(browserEntry).toContain("surface.transferToImageBitmap()");
    expect(browserEntry).toContain("navigator.gpu.requestAdapter");
    expect(browserEntry).not.toContain("fakeGpu");
    expect(browserEntry).not.toContain("FakeGpu");
    expect(verifier).toContain('result.status === "unsupported"');
    expect(verifier).toContain('status: "skipped"');
    expect(verifier).toContain("process.exitCode = 2");
  });

  it("keeps legacy round baselines diagnostic and routes rich cases through canonical lowering", () => {
    for (const id of [
      "diagnostic-round-normal",
      "diagnostic-translucent-linear-overlap",
      "diagnostic-destination-out-erase",
      "canonical-append-base",
      "canonical-append-result",
      "canonical-rebuild-equivalent",
      "canonical-linear-premultiplied-presentation",
      "canonical-rotated-sheared-ellipse",
      "canonical-square",
      "canonical-hardness-edge-softness",
      "canonical-affine-footprint",
    ]) {
      expect(browserEntry).toContain(`"${id}"`);
      expect(verifier).toContain(`"${id}"`);
    }
    expect(browserEntry).toContain(
      "convertLegacyStudioGpuDabPlanToWebGpuDiagnosticOracle(",
    );
    expect(browserEntry).toContain("legacyUpdate(mode, dabs),");
    expect(browserEntry).toContain(").plan;");
    expect(browserEntry).toContain("parseStudioCanonicalBrushPlan(candidate");
    expect(browserEntry).toContain("lowerStudioCanonicalBrushPlanToWebGpuDabs");
    expect(browserEntry).toContain("adaptLoweredStudioCanonicalBrushWebGpuDabs");
    expect(browserEntry).toContain('"canonical-lowering-adapter"');
    expect(verifier).toContain("productionCasesRequireCanonicalLoweringAdapter: true");
  });

  it("uses a rich basis/shape/hardness CPU oracle and strict pixel budgets", () => {
    expect(browserEntry).toContain("goldenPixelForFullCoverage");
    expect(browserEntry).toContain("rasterCpuOracle");
    expect(browserEntry).toContain("const determinant = xx * yy - xy * yx;");
    expect(browserEntry).toContain('dab.tip.shape === "square"');
    expect(browserEntry).toContain("(1 - dab.tip.hardness) + dab.tip.edgeSoftness");
    expect(browserEntry).toContain("EDGE_BAND_PIXELS * Math.max(evaluation.fwidth");
    expect(verifier).toContain("appendVsRebuildExact: true");
    expect(verifier).toContain("MAX_GOLDEN_SAMPLE_CHANNEL_DELTA = 2");
    expect(verifier).toContain("MAX_OUTSIDE_EDGE_CHANGED_PIXELS_TOLERANCE_2 = 0");
    expect(verifier).toContain(
      "MAX_MEAN_PREMULTIPLIED_ABSOLUTE_CHANNEL_DELTA = 0.25",
    );
    expect(browserEntry).toContain("meanPremultipliedAbsoluteDelta");
  });

  it("binds every readback to rich receipt v2 epochs and the completed queue submission", () => {
    expect(browserEntry).toContain("validateProviderReceipt");
    expect(browserEntry).toContain("validateReadbackEpochs");
    expect(browserEntry).toContain("waitForQueueFence");
    expect(browserEntry).toContain(
      "stats.completedSubmissionSequence >= submittedSubmissionSequence",
    );
    expect(browserEntry).toContain(
      "queueFence.completedSubmissionSequence",
    );
    expect(browserEntry).toContain(
      "readback.requestSequence !== receipt.requestSequence",
    );
    expect(browserEntry).toContain("readback.resizeEpoch !== receipt.resizeEpoch");
    expect(browserEntry).toContain('receipt.queueState !== "submitted"');
    expect(browserEntry).toContain(
      "receipt.workingColorSpace !== STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE",
    );
    expect(browserEntry).toContain(
      "receipt.presentationColorSpace",
    );
    expect(verifier).toContain("receipt.requestSequence !== readback.requestSequence");
    expect(verifier).toContain("receipt.resizeEpoch !== readback.resizeEpoch");
    expect(verifier).toContain("receipt.revision !== 2");
    expect(verifier).toContain(
      "readback.completedSubmissionSequence < readback.submittedSubmissionSequence",
    );
  });

  it("preserves JSON/PNG evidence for every rich and diagnostic case", () => {
    expect(verifier).toContain('writeJson("summary.json"');
    expect(verifier).toContain('writeDataUrlPng(`${parityCase.id}.cpu.png`');
    expect(verifier).toContain('writeDataUrlPng(`${parityCase.id}.webgpu.png`');
    expect(verifier).toContain('writeDataUrlPng(`${parityCase.id}.diff.png`');
  });

  it("uses an actual GPUDevice loss signal instead of a fake capability claim", () => {
    expect(browserEntry).toContain("device.destroy()");
    expect(browserEntry).toContain("device.lost.then");
    expect(browserEntry).toContain("runtime onDeviceLost callback");
    expect(browserEntry).toContain('runtimeStatus: "device-lost"');
    expect(browserEntry).not.toContain("simulateDeviceLoss");
    expect(browserEntry).not.toContain("fakeDeviceLoss");
  });
});
