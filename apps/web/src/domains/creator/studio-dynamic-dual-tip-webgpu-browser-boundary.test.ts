import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const browserEntry = readFileSync(
  resolve(root, "scripts/studio-dynamic-dual-tip-webgpu-browser.ts"),
  "utf8",
);
const verifier = readFileSync(
  resolve(root, "scripts/verify-studio-dynamic-dual-tip-webgpu.mjs"),
  "utf8",
);

describe("dynamic dual-tip actual Chromium WebGPU boundary", () => {
  it("uses the production planner and specialist runtime against navigator.gpu", () => {
    expect(browserEntry).toContain("buildStudioDynamicDualTipPlan");
    expect(browserEntry).toContain("createStudioDynamicDualTipWebGpuRuntime");
    expect(browserEntry).toContain("navigator.gpu.requestAdapter");
    expect(browserEntry).toContain(
      'backend: "dynamic-dual-tip-rgba16float-webgpu"',
    );
    expect(browserEntry).not.toContain("fakeGpu");
    expect(browserEntry).not.toContain("mockDevice");
    expect(verifier).toContain(
      'const HARNESS_ENTRY = "/scripts/studio-dynamic-dual-tip-webgpu-browser.ts";',
    );
    expect(verifier).toContain('appType: "custom"');
  });

  it("compares aligned RGBA16F readback to an independent affine/half CPU oracle", () => {
    expect(browserEntry).toContain("readRgba16Float");
    expect(browserEntry).toContain("ROW_ALIGNMENT = 256");
    expect(browserEntry).toContain("RGBA16_BYTES_PER_PIXEL = 8");
    expect(browserEntry).toContain("float32ToFloat16");
    expect(browserEntry).toContain("float16ToFloat32");
    expect(browserEntry).toContain("rasterIndependentCpu");
    expect(browserEntry).toContain("insideAffine");
    expect(browserEntry).toContain("sampleZeroBorder");
    expect(browserEntry).not.toContain("packStudioDynamicDualTipSecondaryInstances");
    expect(verifier).toContain("independent CPU parity failed");
  });

  it("executes all eight families without reducing the secondary schedule to one tip", () => {
    for (const family of [
      "intersect",
      "darken",
      "lighten",
      "multiply",
      "screen",
      "add",
      "subtract",
      "difference",
    ]) {
      expect(browserEntry).toContain(`"${family}"`);
      expect(verifier).toContain(`"${family}"`);
    }
    expect(browserEntry).toContain("`family-${BLEND_FAMILIES[index]}`");
    expect(browserEntry).toContain("secondaryInstances");
    expect(browserEntry).toContain("countJitter: 1");
    expect(browserEntry).toContain('scatterAxes: "both-axes"');
    expect(verifier).toContain("independent count/scatter/reflected affine evidence");
    expect(verifier).toContain("eightBlendFamilyAggregatePreviewCoverage: true");
    expect(verifier).toContain("exactPerDepositionComposition: false");
    expect(verifier).not.toContain("exactEightBlendFamilies: true");
  });

  it("proves append/rebuild, destination-out, cache budgets and fail-closed hashes", () => {
    expect(browserEntry).toContain('"append-sequence"');
    expect(browserEntry).toContain('"destination-out"');
    expect(browserEntry).toContain("mutatedPlan");
    expect(browserEntry).toContain("maximumResidentAssetBytes");
    expect(verifier).toContain('["rebuild", "append"]');
    expect(verifier).toContain("resident-asset-budget");
    expect(verifier).toContain("contentAddressedAssetCacheAndBudgets: true");
  });

  it("tests cancellation, backpressure, actual device loss and diagnostics under CSP", () => {
    expect(browserEntry).toContain("new AbortController()");
    expect(browserEntry).toContain("maximumInFlightSubmissions: 1");
    expect(browserEntry).toContain("rawDevice.destroy()");
    expect(browserEntry).toContain("getCompilationInfo");
    expect(browserEntry).toContain('pushErrorScope("validation")');
    expect(browserEntry).toContain('addEventListener("uncapturederror"');
    expect(verifier).toContain('"--use-angle=swiftshader"');
    expect(verifier).toContain("Content-Security-Policy");
    expect(verifier).toContain("actualDeviceLossEpoch: true");
    expect(verifier).toContain("zeroGpuAndBrowserDiagnostics: true");
  });

  it("retains structured JSON and per-case CPU/GPU/diff PNG evidence", () => {
    expect(verifier).toContain('writeJson("browser-result.json"');
    expect(verifier).toContain('writeJson("observations.json"');
    expect(verifier).toContain('writeJson("summary.json"');
    expect(verifier).toContain('`${evidence.id}.cpu.png`');
    expect(verifier).toContain('`${evidence.id}.webgpu.png`');
    expect(verifier).toContain('`${evidence.id}.diff.png`');
    expect(verifier).toContain("process.exitCode = 2");
  });
});
