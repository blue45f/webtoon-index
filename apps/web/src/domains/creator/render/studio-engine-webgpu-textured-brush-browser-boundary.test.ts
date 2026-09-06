import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");
const browserEntry = readFileSync(
  resolve(root, "scripts/studio-engine-webgpu-textured-brush-browser.ts"),
  "utf8",
);
const verifier = readFileSync(
  resolve(root, "scripts/verify-studio-engine-webgpu-textured-brush.mjs"),
  "utf8",
);

describe("textured-brush real Chromium WebGPU boundary", () => {
  it("uses the production clean-room plan and runtime against navigator.gpu", () => {
    expect(browserEntry).toContain("buildStudioEngineWebGpuTexturedBrushPlan");
    expect(browserEntry).toContain("createStudioEngineWebGpuTexturedBrushRuntime");
    expect(browserEntry).toContain("hydrateStudioBrushR8GrainAsset");
    expect(browserEntry).toContain("navigator.gpu.requestAdapter");
    expect(browserEntry).toContain('backend: "webgpu-textured-brush-rgba16float"');
    expect(browserEntry).not.toContain("fakeGpuHarness");
    expect(browserEntry).not.toContain("FakeGpu");
    expect(browserEntry).not.toContain("mockDevice");
    expect(verifier).toContain(
      'const HARNESS_ENTRY = "/scripts/studio-engine-webgpu-textured-brush-browser.ts";',
    );
    expect(verifier).toContain('appType: "custom"');
  });

  it("performs aligned RGBA16F MAP_READ and an independent half-float CPU oracle", () => {
    expect(browserEntry).toContain("readRgba16Float");
    expect(browserEntry).toContain("ROW_ALIGNMENT = 256");
    expect(browserEntry).toContain("RGBA16_BYTES_PER_PIXEL = 8");
    expect(browserEntry).toContain("float32ToFloat16");
    expect(browserEntry).toContain("float16ToFloat32");
    expect(browserEntry).toContain("rasterIndependentCpu");
    expect(browserEntry).not.toContain("sampleStudioEngineTexturedBrushTipCpu");
    expect(browserEntry).not.toContain("sampleStudioEngineTexturedBrushGrainCpu");
    expect(browserEntry).not.toContain("compositeStudioEngineTexturedBrushPixelCpu");
    expect(verifier).toContain("independent CPU parity failed");
  });

  it("covers zero-border R8 tips, both grain kinds and both anchor spaces", () => {
    for (const id of [
      "zero-border-source-over",
      "procedural-document",
      "procedural-stroke",
      "asset-document",
      "asset-stroke",
      "durable-r8-alpha-canvas",
      "durable-r8-alpha-stroke",
      "durable-r8-luminance-canvas",
      "durable-r8-luminance-stroke",
      "destination-out",
    ]) {
      expect(browserEntry).toContain(`"${id}"`);
      expect(verifier).toContain(`"${id}"`);
    }
    expect(browserEntry).toContain("zeroBorderTexel");
    expect(browserEntry).toContain("repeatTexel");
    expect(browserEntry).toContain("integerNoise");
    expect(browserEntry).toContain("0xffff_ffff");
    expect(verifier).toContain("R8 tip zero-border bilinear evidence");
    expect(verifier).toContain("procedural document/stroke grain");
    expect(verifier).toContain("asset R8 document/stroke grain");
    expect(verifier).toContain("durable native R8 identity/parity evidence");
    expect(verifier).toContain("durable source omission/presence");
    expect(browserEntry).toContain('"native-repeat-seam-left"');
    expect(browserEntry).toContain('"native-repeat-seam-right"');
  });

  it("checks source-over, destination-out, first append initialization and exact rebuild", () => {
    expect(browserEntry).toContain('dab.composite.porterDuff === "destination-out"');
    expect(browserEntry).toContain("doublePlan");
    expect(browserEntry).toContain("uninitializedAppendEvidence");
    expect(browserEntry).toContain("appendRebuildEvidence");
    expect(verifier).toContain('["source-over", "destination-out"]');
    expect(verifier).toContain(
      "an append without canonical base content did not fail closed before GPU mutation",
    );
    expect(verifier).toContain("uninitializedAppendFailsClosed: true");
    expect(verifier).toContain("exactHalfWordMismatches !== 0");
  });

  it("guards metadata-aware asset caching, budgets and mutated hashes", () => {
    expect(browserEntry).toContain("metadataAliasTextureCreations");
    expect(browserEntry).toContain("width: 2");
    expect(browserEntry).toContain("height: 8");
    expect(browserEntry).toContain("maximumResidentAssetBytes");
    expect(browserEntry).toContain("mutatedHashStatus");
    expect(verifier).toContain("metadata-alias/hash fail-close");
    expect(verifier).toContain("metadataAwareAssetCache: true");
    expect(verifier).toContain("mutatedAssetHashFailClosed: true");
  });

  it("probes sequence, epoch, cancellation, backpressure and actual device loss", () => {
    expect(browserEntry).toContain("new AbortController()");
    expect(browserEntry).toContain("maximumInFlightSubmissions: 1");
    expect(browserEntry).toContain("rawDevice.destroy()");
    expect(browserEntry).toContain("rawDevice.lost");
    expect(browserEntry).toContain("runtimeDeviceEpoch");
    expect(verifier).toContain('"request-sequence"');
    expect(verifier).toContain('"device-epoch"');
    expect(verifier).toContain('"device-lost"');
    expect(verifier).toContain("actual device destroy");
  });

  it("requires actual shader compilation and zero browser/GPU diagnostics under CSP", () => {
    expect(browserEntry).toContain("getCompilationInfo");
    expect(browserEntry).toContain('pushErrorScope("validation")');
    expect(browserEntry).toContain('pushErrorScope("out-of-memory")');
    expect(browserEntry).toContain('addEventListener("uncapturederror"');
    expect(verifier).toContain('page.on("console"');
    expect(verifier).toContain('page.on("pageerror"');
    expect(verifier).toContain('page.on("requestfailed"');
    expect(verifier).toContain("Content-Security-Policy");
    expect(verifier).toContain("zeroShaderMessages");
    expect(verifier).toContain("zeroConsoleErrorsAndWarnings");
  });

  it("preserves structured JSON and CPU/GPU/diff PNG evidence", () => {
    expect(verifier).toContain('writeJson("browser-result.json"');
    expect(verifier).toContain('writeJson("observations.json"');
    expect(verifier).toContain('writeJson("summary.json"');
    expect(verifier).toContain('`${evidence.id}.cpu.png`');
    expect(verifier).toContain('`${evidence.id}.webgpu.png`');
    expect(verifier).toContain('`${evidence.id}.diff.png`');
    expect(verifier).toContain('"append-vs-rebuild.diff.png"');
    expect(verifier).toContain("process.exitCode = 2");
  });
});
