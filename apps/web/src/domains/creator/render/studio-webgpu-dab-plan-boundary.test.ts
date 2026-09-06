import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

describe("studio WebGPU dab-plan ownership boundary", () => {
  it("keeps the shared contract type-only and renderer-neutral", () => {
    const contract = source("./studio-webgpu-dab-plan-contract.ts");

    expect(contract).toContain('import type { StudioGpuComposite } from "./studio-webgpu-stroke"');
    expect(contract).not.toMatch(/\b(?:HTMLCanvasElement|CanvasRenderingContext2D|OffscreenCanvas)\b/u);
    expect(contract).not.toMatch(/\b(?:GPUDevice|GPUBuffer|GPUTexture|GPUCanvasContext)\b/u);
    expect(contract).not.toMatch(/\b(?:Konva|React|useEffect|useState)\b/u);
    expect(contract).not.toContain("studio-webgpu-engine");
    expect(contract).not.toContain("studio-webgpu-tile-compositor");
    expect(contract.split("\n").length).toBeLessThanOrEqual(80);
  });

  it("removes the tiled compositor's type back-edge into the engine", () => {
    const engine = source("./studio-webgpu-engine.ts");
    const compositor = source("./studio-webgpu-tile-compositor.ts");

    expect(engine).toContain('from "./studio-webgpu-dab-plan-contract"');
    expect(engine).toMatch(
      /export type \{[\s\S]*PlannedStudioGpuDabs[\s\S]*\} from "\.\/studio-webgpu-dab-plan-contract"/u
    );
    expect(compositor).toContain('from "./studio-webgpu-dab-plan-contract"');
    expect(compositor).not.toContain('from "./studio-webgpu-engine"');
  });

  it("keeps CPU planning and raster capture outside concrete renderer runtimes", () => {
    const planner = source("./studio-webgpu-dab-planner.ts");
    const capture = source("../live/studio-crdt-raster-stroke-capture.ts");
    const engine = source("./studio-webgpu-engine.ts");
    const captureDependencies = [...capture.matchAll(/from "([^"]+)"/gu)]
      .map((match) => match[1]);

    expect(planner).toContain('from "./studio-webgpu-dab-plan-contract"');
    expect(planner).toContain('import type { StudioGpuRect } from "./studio-webgpu-tile-plan"');
    expect(planner).toContain("export function isStudioWebGpuCanvasActive(");
    expect(planner).not.toContain("studio-webgpu-engine");
    expect(planner).not.toContain("studio-canvas2d-dab-surface");
    expect(planner).not.toContain("studio-webgpu-tile-compositor");
    expect(planner).not.toContain("studio-webgpu-tile-runtime");
    expect(planner).not.toMatch(
      /\b(?:HTMLCanvasElement|CanvasRenderingContext2D|OffscreenCanvas|GPUDevice|GPUBuffer|GPUTexture|GPUCanvasContext|React|useEffect|useState)\b/u
    );
    expect(captureDependencies).toEqual([
      "../render/studio-webgpu-dab-planner",
      "../render/studio-webgpu-dab-plan-contract",
      "../render/studio-webgpu-stroke",
    ]);
    expect(capture).not.toContain("studio-webgpu-engine");
    expect(engine).toContain('from "./studio-webgpu-dab-planner"');
    expect(engine).not.toContain("export function planStudioGpuDabs(");
    expect(engine).not.toContain("export function planStudioGpuDabUpdate(");
    expect(engine).not.toContain("export function isValidStudioGpuStroke(");
    expect(engine).not.toContain("export function routeStudioWebGpuCanvasRequest(");
  });
});
