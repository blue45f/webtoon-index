import { describe, expect, it } from "vitest";

import {
  applyMultiPassExportPreset,
  planMultiPassExport,
  WEBTOON_RENDER_PASSES,
  type MultiPassExportConfig,
} from "./studio-3d-webtoon-multipass-exporter";

const BASE_CONFIG: MultiPassExportConfig = {
  resolutionWidth: 1920,
  resolutionHeight: 1080,
  transparentBackground: true,
  includeLineArt: true,
  includeFlatColor: true,
  includeShadow: true,
  includeHighlight: true,
  includeDepthMap: false,
  includeObjectIdMask: true,
  includeNormalMap: false,
  includeMaterialIdMask: false,
  includeAmbientOcclusion: false,
  includeEmission: false,
  includeVelocity: false,
  format: "png-zip",
};

describe("Studio 3D Webtoon Multi-Pass Layer Auto-Split Engine", () => {
  it("provides manuscript, relight, stable-ID and motion passes with explicit formats", () => {
    expect(WEBTOON_RENDER_PASSES).toHaveLength(11);
    expect(WEBTOON_RENDER_PASSES.find((pass) => pass.kind === "line-art")?.layerName).toContain("선화");
    expect(WEBTOON_RENDER_PASSES.find((pass) => pass.kind === "shadow-ambient")?.blendMode).toBe("multiply");
    expect(WEBTOON_RENDER_PASSES.find((pass) => pass.kind === "specular-highlight")?.blendMode).toBe("screen");
    expect(WEBTOON_RENDER_PASSES.find((pass) => pass.kind === "normal-map")?.pixelFormat).toBe("rg8-octahedral");
    expect(WEBTOON_RENDER_PASSES.find((pass) => pass.kind === "velocity-map")?.bytesPerPixel).toBe(8);
  });

  it("plans the default hybrid manuscript export with separate file and working-set estimates", () => {
    const planned = planMultiPassExport(BASE_CONFIG);
    expect(planned.totalPasses).toBe(5);
    expect(planned.activePasses.some((pass) => pass.kind === "line-art")).toBe(true);
    expect(planned.activePasses.some((pass) => pass.kind === "depth-map")).toBe(false);
    expect(planned.captureProfile).toBe("hybrid");
    expect(planned.estimatedFileSizeMb).toBeGreaterThan(0.5);
    expect(planned.estimatedWorkingSetMb).toBeGreaterThan(planned.estimatedFileSizeMb);
  });

  it("applies an AI control preset with depth, normal and stable ID maps", () => {
    const config = applyMultiPassExportPreset(BASE_CONFIG, "ai-control");
    const planned = planMultiPassExport(config);

    expect(config.includeDepthMap).toBe(true);
    expect(config.includeNormalMap).toBe(true);
    expect(config.includeMaterialIdMask).toBe(true);
    expect(planned.activePasses.map((pass) => pass.kind)).toEqual([
      "line-art",
      "depth-map",
      "normal-map",
      "object-id-mask",
      "material-id-mask",
    ]);
    expect(planned.captureProfile).toBe("hybrid");
  });

  it("warns when a complete high-resolution deck exceeds single-capture budgets", () => {
    const config = applyMultiPassExportPreset({
      ...BASE_CONFIG,
      resolutionWidth: 9000,
      resolutionHeight: 9000,
    }, "complete");
    const planned = planMultiPassExport(config);

    expect(planned.recommendedExecution).toBe("worker");
    expect(planned.warnings.some((warning) => warning.includes("분할 렌더"))).toBe(true);
    expect(planned.warnings.some((warning) => warning.includes("256MB"))).toBe(true);
  });
});
