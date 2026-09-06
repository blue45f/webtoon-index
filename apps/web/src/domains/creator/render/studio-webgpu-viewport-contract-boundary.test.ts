import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

describe("studio WebGPU viewport contract boundary", () => {
  it("keeps the shared viewport contract type-only and renderer-neutral", () => {
    const contract = source("./studio-webgpu-viewport-contract.ts");

    expect(contract).not.toMatch(/^import\s/mu);
    expect(contract).not.toMatch(/\b(?:HTMLCanvasElement|CanvasRenderingContext2D|OffscreenCanvas)\b/u);
    expect(contract).not.toMatch(/\b(?:GPUDevice|GPUBuffer|GPUTexture|GPUCanvasContext)\b/u);
    expect(contract).not.toMatch(/\b(?:Konva|React|useEffect|useState)\b/u);
    expect(contract).not.toContain("studio-webgpu-engine");
  });

  it("removes viewport consumers' type back-edge into the concrete engine", () => {
    const engine = source("./studio-webgpu-engine.ts");
    const viewport = source("./studio-webgpu-viewport.ts");
    const canvas = source("../StudioWebGpuCanvas.tsx");

    expect(engine).toContain('from "./studio-webgpu-viewport-contract"');
    expect(engine).toMatch(
      /export type \{[\s\S]*StudioGpuViewport[\s\S]*\} from "\.\/studio-webgpu-viewport-contract"/u
    );
    expect(engine).not.toContain("export interface StudioGpuViewTransform");
    expect(engine).not.toContain("export interface StudioGpuViewport");
    expect(viewport).toContain('from "./studio-webgpu-viewport-contract"');
    expect(viewport).not.toContain('from "./studio-webgpu-engine"');
    expect(canvas).toContain('from "./render/studio-webgpu-viewport-contract"');
  });
});
