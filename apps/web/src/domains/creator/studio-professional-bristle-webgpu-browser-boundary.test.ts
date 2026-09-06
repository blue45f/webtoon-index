import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const browserEntry = readFileSync(
  resolve(root, "scripts/studio-professional-bristle-webgpu-browser.ts"),
  "utf8",
);
const verifier = readFileSync(
  resolve(root, "scripts/verify-studio-professional-bristle-webgpu.mjs"),
  "utf8",
);

describe("professional bristle real Chromium WebGPU boundary", () => {
  it("lowers the clean-room bristle contract into the production analytic runtime", () => {
    expect(browserEntry).toContain("lowerStudioProfessionalBristleToWebGpu");
    expect(browserEntry).toContain("createStudioEngineWebGpuBrushRuntime");
    expect(browserEntry).toContain("fingerprintStudioEngineWebGpuBrushPlan");
    expect(browserEntry).toContain("navigator.gpu.requestAdapter");
    expect(browserEntry).toContain(
      'backend: "professional-bristle-rgba16float-webgpu"',
    );
    expect(browserEntry).not.toContain("FakeGpu");
    expect(browserEntry).not.toContain("mockDevice");
    expect(verifier).toContain(
      'const HARNESS_ENTRY = "/scripts/studio-professional-bristle-webgpu-browser.ts";',
    );
    expect(verifier).toContain('appType: "custom"');
  });

  it("uses aligned RGBA16F MAP_READ and an independent affine half-float oracle", () => {
    expect(browserEntry).toContain("readRgba16Float");
    expect(browserEntry).toContain("ROW_ALIGNMENT = 256");
    expect(browserEntry).toContain("RGBA16_BYTES_PER_PIXEL = 8");
    expect(browserEntry).toContain("encoder.copyTextureToBuffer");
    expect(browserEntry).toContain("buffer.mapAsync(MAP_READ");
    expect(browserEntry).toContain("float32ToFloat16");
    expect(browserEntry).toContain("float16ToFloat32");
    expect(browserEntry).toContain("rasterIndependentCpu");
    expect(browserEntry).toContain("evaluateMetric");
    expect(verifier).toContain("independent affine/half CPU parity failed");
  });

  it("covers rake, curvature, contact, fan, turn, fixed scale, affine scatter and OKLCH", () => {
    for (const id of [
      "straight-rake",
      "curved-turn",
      "pressure-tilt-fan",
      "fixed-feature-scale",
      "affine-reflection-shear-oklch",
      "contact-angle",
      "destination-out",
    ]) {
      expect(browserEntry).toContain(`"${id}"`);
      expect(verifier).toContain(`"${id}"`);
    }
    expect(browserEntry).toContain("maximumLongitudinalDisplacement");
    expect(browserEntry).toContain("maximumDiameterDelta");
    expect(browserEntry).toContain("maximumInverseBasisScatterDelta");
    expect(browserEntry).toContain("negativeDeterminants");
    expect(browserEntry).toContain("distinctColors");
    expect(verifier).toContain("local-disk affine scatter");
    expect(verifier).toContain("gamut-safe per-bristle OKLCH");
  });

  it("requires exact append/rebuild output and destination-out ordering", () => {
    expect(browserEntry).toContain("appendRebuildEvidence");
    expect(browserEntry).toContain("exactHalfWordMismatches");
    expect(browserEntry).toContain("contentFingerprintEqual");
    expect(browserEntry).toContain("planFingerprintDifferent");
    expect(verifier).toContain('"append-vs-rebuild.diff.png"');
    expect(verifier).toContain('["source-over", "destination-out"]');
  });

  it("fails closed for hostile and unsupported inputs before GPU work", () => {
    expect(browserEntry).toContain("hostileCanonical");
    expect(browserEntry).toContain("hostileExtension");
    expect(browserEntry).toContain("getterReads");
    for (const reason of [
      "display-p3",
      "non-normal-blend",
      "texture-tip",
      "grain",
      "wet-media",
      "unsupported-tip-shape",
    ]) expect(verifier).toContain(`"${reason}"`);
    expect(verifier).toContain("hostile descriptor preflight");
    expect(verifier).toContain("pre-aborted lowering");
  });

  it("probes backpressure, stale epoch/sequence, cancellation and actual device loss", () => {
    expect(browserEntry).toContain("maximumInFlightSubmissions: 1");
    expect(browserEntry).toContain("appendWithoutBase");
    expect(browserEntry).toContain("resizeEpochMismatch");
    expect(browserEntry).toContain("staleResizeEpoch");
    expect(browserEntry).toContain("new AbortController()");
    expect(browserEntry).toContain("rawDevice.destroy()");
    expect(browserEntry).toContain("rawDevice.lost");
    expect(verifier).toContain('"gpu-backpressure"');
    expect(verifier).toContain('"stale-request-sequence"');
    expect(verifier).toContain('"resize-epoch-mismatch"');
    expect(verifier).toContain("actual GPUDevice destroy");
  });

  it("requires clean WGSL, GPU scopes and browser diagnostics under CSP", () => {
    expect(browserEntry).toContain("getCompilationInfo");
    expect(browserEntry).toContain('pushErrorScope("validation")');
    expect(browserEntry).toContain('pushErrorScope("out-of-memory")');
    expect(browserEntry).toContain('addEventListener("uncapturederror"');
    expect(verifier).toContain('page.on("console"');
    expect(verifier).toContain('page.on("pageerror"');
    expect(verifier).toContain('page.on("requestfailed"');
    expect(verifier).toContain("Content-Security-Policy");
    expect(verifier).toContain("zeroShaderMessages");
    expect(verifier).toContain("zeroBrowserDiagnostics");
  });

  it("persists JSON plus CPU, GPU and diff PNG evidence", () => {
    expect(verifier).toContain('writeJson("browser-result.json"');
    expect(verifier).toContain('writeJson("observations.json"');
    expect(verifier).toContain('writeJson("summary.json"');
    expect(verifier).toContain('`${evidence.id}.cpu.png`');
    expect(verifier).toContain('`${evidence.id}.webgpu.png`');
    expect(verifier).toContain('`${evidence.id}.diff.png`');
    expect(verifier).toContain("process.exitCode = 2");
  });
});
