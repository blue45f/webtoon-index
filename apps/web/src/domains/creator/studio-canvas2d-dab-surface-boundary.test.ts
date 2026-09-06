import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

describe("studio Canvas2D dab surface ownership boundary", () => {
  it("depends only on the renderer-neutral dab-plan and viewport contracts", () => {
    const surface = source("./studio-canvas2d-dab-surface.ts");
    const dependencies = [...surface.matchAll(/from "([^"]+)"/gu)]
      .map((match) => match[1]);

    expect(dependencies).toEqual([
      "./render/studio-webgpu-dab-plan-contract",
      "./render/studio-webgpu-viewport-contract",
    ]);
    expect(surface).not.toContain("studio-webgpu-engine");
    expect(surface).not.toMatch(/\b(?:StudioWebGpuEngine|StudioGpuFrameReceipt|frameGeneration|requestId)\b/u);
    expect(surface).not.toMatch(/\b(?:GPUDevice|GPUBuffer|GPUTexture|GPUCanvasContext)\b/u);
    expect(surface).not.toMatch(/\b(?:Konva|React|useEffect|useState)\b/u);
  });

  it("leaves lifecycle, planning, and frame authority inside the engine", () => {
    const engine = source("./render/studio-webgpu-engine.ts");

    expect(engine).toContain('from "../studio-canvas2d-dab-surface"');
    expect(engine).toContain("const update = this.planRenderUpdate(strokes)");
    expect(engine).toContain("const complete = this.recordRenderedFrame(strokes, update)");
    expect(engine).toContain("const receipt = this.createFrameReceipt(strokes, requestId)");
    expect(engine).toContain("this.publishAuthorityFrame(receipt, null)");
    expect(engine).not.toContain("private clearCanvas2d");
    expect(engine).not.toContain("context.globalCompositeOperation = dab.composite");
  });
});
