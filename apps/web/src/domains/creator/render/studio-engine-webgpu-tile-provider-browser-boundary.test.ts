import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");
const browserEntry = readFileSync(
  resolve(root, "scripts/studio-engine-webgpu-tile-provider-browser.ts"),
  "utf8",
);
const verifier = readFileSync(
  resolve(root, "scripts/verify-studio-engine-webgpu-tile-provider.mjs"),
  "utf8",
);

describe("StudioEngineWebGpuTileProviderV1 real Chromium boundary", () => {
  it("uses the production provider and canonical lowering without a fake GPU", () => {
    expect(browserEntry).toContain("createStudioEngineWebGpuTileProviderV1");
    expect(browserEntry).toContain("lowerStudioCanonicalBrushPlanToWebGpuDabs");
    expect(browserEntry).toContain('backend: "webgpu-rgba16float-tile-provider-v1"');
    expect(browserEntry).not.toContain("fakeGpuHarness");
    expect(browserEntry).not.toContain("FakeGpu");
    expect(browserEntry).not.toContain("mockDevice");
    expect(verifier).toContain(
      'const HARNESS_ENTRY = "/scripts/studio-engine-webgpu-tile-provider-browser.ts";',
    );
    expect(verifier).toContain('appType: "custom"');
  });

  it("uploads and reads full RGBA16F tiles through an aligned MAP_READ layout", () => {
    expect(browserEntry).toContain("STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH");
    expect(browserEntry).toContain("STUDIO_ENGINE_WEBGPU_TILE_ROW_BYTES");
    expect(browserEntry).toContain("WEBGPU_BYTES_PER_ROW_ALIGNMENT = 256");
    expect(browserEntry).toContain("uploadedBaseBytes");
    expect(browserEntry).toContain('readback: "full-tile-256-byte-aligned-map-read"');
    expect(verifier).toContain("full-tile 256-byte aligned MAP_READ");
    expect(verifier).toContain("TILE_BYTES * EXPECTED_TILE_ORDER.length");
  });

  it("proves three-tile row-major order, digest stability, and append/rebuild exactness", () => {
    expect(browserEntry).toContain("[0, 0]");
    expect(browserEntry).toContain("[1, 0]");
    expect(browserEntry).toContain("[0, 1]");
    expect(verifier).toContain('["0:0", "1:0", "0:1"]');
    expect(browserEntry).toContain("studioEngineTileProviderBatchDigest");
    expect(browserEntry).toContain("appendRebuildExactHalfWordMismatches");
    expect(browserEntry).toContain("stableBatchDigest");
    expect(verifier).toContain("append/rebuild bytes, tile digests, or batch digest");
  });

  it("uses an independent half-float CPU oracle with explicit edge-aware tolerance", () => {
    expect(browserEntry).toContain("float32ToFloat16");
    expect(browserEntry).toContain("float16ToFloat32");
    expect(browserEntry).toContain("rasterCpuTile");
    expect(browserEntry).toContain("evaluateMetric");
    expect(browserEntry).toContain("HALF_FLOAT_ABSOLUTE_TOLERANCE");
    expect(browserEntry).toContain("HALF_FLOAT_OUTSIDE_EDGE_TOLERANCE");
    expect(browserEntry).toContain("unaffectedExactHalfWordMismatches");
    expect(verifier).toContain("CPU half-float parity");
    expect(verifier).toContain("tile-edge CPU/GPU samples");
  });

  it("exercises request/device epochs, backpressure, cancellation, and actual device loss", () => {
    expect(browserEntry).toContain("staleRequestEpochReason");
    expect(browserEntry).toContain("staleDeviceEpochReason");
    expect(browserEntry).toContain("new AbortController()");
    expect(browserEntry).toContain("backpressureReason");
    expect(browserEntry).toContain("rawDevice.destroy()");
    expect(browserEntry).toContain("rawDevice.lost");
    expect(verifier).toContain('"stale-request-epoch"');
    expect(verifier).toContain('"stale-device-epoch"');
    expect(verifier).toContain('"gpu-backpressure"');
    expect(verifier).toContain('"device-lost"');
  });

  it("captures shader compilation, error scopes, uncaptured errors, and browser diagnostics", () => {
    expect(browserEntry).toContain("getCompilationInfo");
    expect(browserEntry).toContain('pushErrorScope("validation")');
    expect(browserEntry).toContain('pushErrorScope("out-of-memory")');
    expect(browserEntry).toContain('addEventListener("uncapturederror"');
    expect(verifier).toContain('page.on("console"');
    expect(verifier).toContain('page.on("pageerror"');
    expect(verifier).toContain('page.on("requestfailed"');
    expect(verifier).toContain("zeroShaderErrors");
    expect(verifier).toContain("zeroErrorScopeFailures");
  });

  it("saves CPU, GPU, and diff PNGs plus structured JSON evidence", () => {
    for (const fileName of [
      "cpu-oracle.png",
      "append-webgpu.png",
      "append-vs-cpu-diff.png",
      "rebuild-webgpu.png",
      "append-vs-rebuild-diff.png",
    ]) {
      expect(verifier).toContain(`"${fileName}"`);
    }
    expect(verifier).toContain('writeJson("browser-result.json"');
    expect(verifier).toContain('writeJson("observations.json"');
    expect(verifier).toContain('writeJson("summary.json"');
    expect(verifier).toContain("process.exitCode = 2");
  });
});
