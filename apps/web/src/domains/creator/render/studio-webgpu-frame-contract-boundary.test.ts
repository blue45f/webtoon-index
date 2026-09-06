import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

describe("studio WebGPU frame contract boundary", () => {
  it("keeps the public frame contract type-only and renderer-neutral", () => {
    const contract = source("./studio-webgpu-frame-contract.ts");
    const imports = [...contract.matchAll(/^import\s+([^;]+);$/gmu)]
      .map((match) => match[0]);

    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatch(/^import type /u);
    expect(contract).toContain('from "./studio-webgpu-readback"');
    expect(contract).not.toContain("studio-webgpu-engine");
    expect(contract).not.toMatch(/\b(?:HTMLCanvasElement|CanvasRenderingContext2D|OffscreenCanvas)\b/u);
    expect(contract).not.toMatch(/\b(?:GPUDevice|GPUBuffer|GPUTexture|GPUCanvasContext)\b/u);
    expect(contract).not.toMatch(/\b(?:Konva|React|useEffect|useState)\b/u);
    expect(contract.split("\n").length).toBeLessThanOrEqual(80);
  });

  it("leaves engine behavior in place while removing consumer type back-edges", () => {
    const engine = source("./studio-webgpu-engine.ts");
    const canvas = source("../StudioWebGpuCanvas.tsx");
    const page = source("../StudioCuttoonEditorHost.tsx");

    expect(engine).toContain('from "./studio-webgpu-frame-contract"');
    expect(engine).toMatch(
      /export type \{[\s\S]*StudioGpuFrameReceipt[\s\S]*\} from "\.\/studio-webgpu-frame-contract"/u
    );
    expect(engine).not.toContain("export type StudioGpuBackend =");
    expect(engine).not.toContain("export interface StudioGpuFrameReceipt");
    expect(engine).not.toContain("export interface StudioGpuPerformanceMetrics");
    expect(engine).not.toContain("export interface StudioGpuFrameReadbackRequest");
    expect(canvas).toContain('from "./render/studio-webgpu-frame-contract"');
    expect(canvas).not.toMatch(
      /import \{[\s\S]{0,320}type StudioGpuBackend[\s\S]{0,320}\} from "\.\/render\/studio-webgpu-engine"/u
    );
    expect(page).toMatch(
      /import type \{[\s\S]{0,320}\bStudioGpuBackend\b[\s\S]{0,320}\} from "\.\/render\/studio-webgpu-frame-contract"/u
    );
    expect(page).not.toContain(
      'import type { StudioGpuBackend } from "./render/studio-webgpu-engine"'
    );
  });
});
