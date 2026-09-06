import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");
const browserEntry = readFileSync(
  resolve(root, "scripts/studio-engine-webgpu-filter-parity-browser.ts"),
  "utf8",
);
const verifier = readFileSync(
  resolve(root, "scripts/verify-studio-engine-webgpu-filter-parity.mjs"),
  "utf8",
);

describe("Studio Engine real WebGPU filter parity browser boundary", () => {
  it("loads only the canonical CPU oracle and RGBA16F WebGPU runtime", () => {
    expect(browserEntry).toContain(
      'from "../apps/web/src/domains/creator/render/studio-engine-canonical-filter-plan"',
    );
    expect(browserEntry).toContain(
      'from "../apps/web/src/domains/creator/render/studio-engine-webgpu-filter-runtime"',
    );
    expect(browserEntry).toContain("applyStudioCanonicalFilterRecipeCpu");
    expect(browserEntry).toContain("new StudioEngineWebGpuFilterRuntime");
    expect(verifier).toContain(
      'const HARNESS_ENTRY = "/scripts/studio-engine-webgpu-filter-parity-browser.ts";',
    );
    expect(verifier).toContain('appType: "custom"');
    expect(browserEntry).not.toContain("StudioPage");
    expect(verifier).not.toContain("packageJson");
  });

  it("requires a real navigator.gpu device and emits exit code two for unsupported environments", () => {
    expect(browserEntry).toContain("navigator.gpu.requestAdapter");
    expect(browserEntry).toContain("adapter.requestDevice()");
    expect(browserEntry).toContain("device.createTexture");
    expect(browserEntry).not.toContain("FakeGpu");
    expect(browserEntry).not.toContain("fakeGpu");
    expect(verifier).toContain('result.status === "unsupported"');
    expect(verifier).toContain('status: "skipped"');
    expect(verifier).toContain("process.exitCode = 2");
  });

  it("uploads and reads actual scene-linear premultiplied RGBA16F data", () => {
    expect(browserEntry).toContain("float32ToFloat16");
    expect(browserEntry).toContain("float16ToFloat32");
    expect(browserEntry).toContain("scene-linear-premultiplied-f16");
    expect(browserEntry).toContain("alignedBytesPerRow");
    expect(browserEntry).toContain("COPY_BYTES_PER_ROW_ALIGNMENT = 256");
    expect(browserEntry).toContain("encoder.copyTextureToBuffer");
    expect(browserEntry).toContain("buffer.mapAsync(GPU_MAP_READ)");
    expect(browserEntry).toContain('format: STUDIO_ENGINE_WEBGPU_FILTER_TEXTURE_FORMAT');
    expect(verifier).toContain('textureFormat === "rgba16float"');
  });

  it("covers every canonical filter foundation and adversarial tiled border path", () => {
    for (const id of [
      "identity",
      "gaussian-reflect-small-tiles",
      "gaussian-clamp-radius-larger-than-tile",
      "gaussian-transparent-no-dark-fringe",
      "unsharp-mask",
      "exposure-contrast-levels",
      "monotone-curves",
      "color-matrix-channel-mixer",
      "posterize-threshold",
      "morphology-min",
      "morphology-max",
      "order-exposure-then-posterize",
      "order-posterize-then-exposure",
    ]) {
      expect(browserEntry).toContain(`"${id}"`);
      expect(verifier).toContain(`"${id}"`);
    }
    expect(browserEntry).toContain("radius-larger-than-tile");
    expect(browserEntry).toContain('borderMode: "transparent"');
    expect(browserEntry).toContain("transparentEdgeEvidence");
    expect(verifier).toContain("transparentEdgeMaxStraightRgbDelta: 0.02");
  });

  it("enforces explicit half-float tolerance, exact identity/morphology and order semantics", () => {
    expect(browserEntry).toContain("ABSOLUTE_HALF_FLOAT_TOLERANCE = 0.008");
    expect(browserEntry).toContain("RELATIVE_HALF_FLOAT_TOLERANCE = 0.006");
    expect(browserEntry).toContain("ALPHA_HALF_FLOAT_TOLERANCE = 0.004");
    expect(browserEntry).toContain("exactHalfWordMismatches");
    expect(browserEntry).toContain("compareOrderDifference");
    expect(verifier).toContain("zeroComponentsOutsideDeclaredHalfFloatTolerance: true");
    expect(verifier).toContain("identityExactHalfWords: true");
    expect(verifier).toContain("morphologyExactHalfWords: true");
    expect(verifier).toContain("orderDifferenceMinimumMaxDelta: 0.02");
  });

  it("captures shader compilation, error scopes, uncaptured errors, receipts and real device loss", () => {
    expect(browserEntry).toContain("getCompilationInfo");
    expect(browserEntry).toContain('device.pushErrorScope("out-of-memory")');
    expect(browserEntry).toContain('device.pushErrorScope("validation")');
    expect(browserEntry).toContain('device.addEventListener("uncapturederror"');
    expect(browserEntry).toContain("execution.receipt");
    expect(browserEntry).toContain("device.destroy()");
    expect(browserEntry).toContain("device.lost");
    expect(browserEntry).toContain('runtimeStatus: runtime.getStats().status');
    expect(browserEntry).not.toContain("simulateDeviceLoss");
    expect(verifier).toContain('receipt.queueState !== "completed"');
    expect(verifier).toContain('rejectedExecutionReason !== "device-lost"');
  });

  it("preserves structured JSON and visual CPU/GPU/diff evidence for every case", () => {
    expect(verifier).toContain('writeJson("observations.json"');
    expect(verifier).toContain('writeJson("summary.json"');
    expect(verifier).toContain('writeDataUrlPng(`${parityCase.id}.cpu.png`');
    expect(verifier).toContain('writeDataUrlPng(`${parityCase.id}.webgpu.png`');
    expect(verifier).toContain('writeDataUrlPng(`${parityCase.id}.diff.png`');
    expect(verifier).toContain("delete summary.cpuPixels");
    expect(verifier).toContain("delete summary.gpuPixels");
  });
});
