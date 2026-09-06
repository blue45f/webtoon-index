import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./studio-tiledoc-webgpu-composite-consumer.ts", import.meta.url),
  "utf8"
);

function bodyBetween(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("tiledoc WebGPU hot-path boundary", () => {
  it("keeps GPU-to-CPU copies and mapping exclusively in the explicit validation seam", () => {
    const presentPath = bodyBetween(
      "private async executePlan(",
      "private ensureRetainedTile("
    );
    expect(presentPath).not.toMatch(/copyTextureToBuffer|mapAsync|getImageData|readPixels/u);

    const validationPath = bodyBetween(
      "public async readbackRetainedTileForValidation(",
      "/** Clears retained tile textures"
    );
    expect(validationPath).toContain("copyTextureToBuffer");
    expect(validationPath).toContain("mapAsync");
    expect(source).toContain("readonly hotPathReadbackCount: 0");
  });

  it("uses StudioGpuFabric by default and destroys only isolated override devices", () => {
    expect(source).toContain('this.acquireDevice = options.acquireDevice ?? acquireStudioGpuDevice');
    expect(source).toContain('ownership = "studio-gpu-fabric"');
    expect(source).toContain("if (state.lease) state.lease.release()");
    expect(source).toContain("else safeDestroyDevice(state.device)");
  });
});
