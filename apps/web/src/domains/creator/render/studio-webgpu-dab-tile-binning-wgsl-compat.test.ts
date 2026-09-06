import { describe, expect, it } from "vitest";

import {
  STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WGSL,
} from "./studio-webgpu-dab-tile-binning-compute";

/**
 * Chromium's WGSL grammar evolves independently from TypeScript parsing. Keep identifiers that
 * have become reserved words out of every shader module so fake-device unit tests cannot mask a
 * real-browser pipeline creation failure again.
 */
describe("WebGPU dab tile-binning WGSL compatibility", () => {
  it("avoids reserved identifiers in count, scan, and stable-scatter modules", () => {
    for (const shader of Object.values(
      STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WGSL,
    )) {
      expect(shader).not.toMatch(/\b(meta|active)\b/u);
      expect(shader).toContain("var<uniform> config: Meta;");
    }
    expect(STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WGSL.scan).toContain(
      "var level_count = 2048u;",
    );
    expect(STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WGSL.scan).toContain(
      "level_count >>= 1u;",
    );
    expect(STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WGSL.scan).toContain(
      "level_count *= 2u;",
    );
  });
});
