import { describe, expect, it } from "vitest";

import {
  planStudioLivingInkGpuPasses,
  STUDIO_LIVING_INK_PHONE_FRAME_CONTRACT,
  STUDIO_LIVING_INK_SHARED_SMOKE_KERNEL_IDS,
} from "./studio-living-ink-gpu-protocol";
import { STUDIO_SMOKE_KERNEL_IDS } from "./studio-smoke-core";

const fullCapabilities = {
  webgpu: true,
  webgl2: true,
  worker: true,
  offscreenCanvas: true,
  halfFloatRenderable: true,
  maxTextureDimension2D: 8_192,
} as const;

describe("Studio Living Ink GPU pass protocol", () => {
  it("prefers WebGPU, reuses stable-fluid kernels and declares separate physical fields", () => {
    const result = planStudioLivingInkGpuPasses({
      width: 2_048,
      height: 2_048,
      operationKind: "ink",
      dirtyBounds: { x: 320, y: 480, width: 256, height: 192 },
      hasSelectionMask: true,
      simulationTicks: 2,
      quality: "interactive",
      material: {
        brushSizeCells: 18,
        flow: 0.82,
        bleed: 0.7,
        dryRate: 0.12,
        chromaticSeparation: 0.18,
        brushPigmentLoad: 0.74,
        capillaryCreep: 0.4,
        vorticity: 0.24,
        dryingEdgeDeposition: 0.62,
        wetOnWetMixing: 0.78,
        glazeOverFixed: 0.2,
        paperFiber: 0.58,
        paperTooth: 0.64,
        granulation: 0.52,
        edgeDarkening: 0.6,
        wetSheen: 0.3,
        vignette: 0.1,
        beerLambertDensity: 0.88,
      },
      inputPolicy: {
        toolMode: "pigment-water-brush",
        pointerSource: "pen",
        pressureSource: "hardware",
        barrelMomentarySwap: "ink-water",
        rejectPalm: true,
        rejectSecondaryPointer: true,
      },
      displayMode: "flow",
      visibilityStepping: "visible-dirty-only",
    }, fullCapabilities);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.backend).toBe("webgpu");
    expect(result.value.execution).toBe("dedicated-worker-offscreen");
    expect(result.value.shaderReuse).toBe("studio-smoke-wgsl-stable-fluid");
    expect(result.value.canonicalAuthority).toBe("gpu-rgba8-frame-plus-operation-journal");
    expect(result.value.runtimeCoverage).toBe("provider-must-certify-declared-passes");
    expect(result.value.coarseVelocityScale).toBe(4);
    expect(result.value.material.chromaticSeparation).toBe(0.18);
    expect(result.value.material.glazeOverFixed).toBe(0.2);
    expect(result.value.inputPolicy.toolMode).toBe("pigment-water-brush");
    expect(result.value.inputPolicy.barrelMomentarySwap).toBe("ink-water");
    expect(result.value.displayMode).toBe("flow");
    expect(result.value.visibilityStepping).toBe("visible-dirty-only");

    const resources = new Map(result.value.resources.map((resource) => [resource.id, resource]));
    expect(resources.get("wetness")?.format).toBe("r16float");
    expect(resources.get("mobile-pigment")?.format).toBe("rgba16float");
    expect(resources.get("fixed-pigment")?.persistence).toBe("document");
    expect(resources.get("velocity-a")?.phase).toBe("coarse");
    expect(resources.get("pressure-a")?.phase).toBe("coarse");

    const first = result.value.passes[0]!;
    expect(first.kernel).toEqual({ family: "living-ink", id: "deposit-ink" });
    expect(first.maskPolicy).toBe("selection-alpha");
    const shared = result.value.passes
      .filter((pass) => pass.kernel.family === "shared-stable-fluid")
      .map((pass) => pass.kernel.id);
    expect(shared).toContain("advect_velocity");
    expect(shared).toContain("pressure_jacobi");
    expect(shared).toContain("subtract_gradient");
    for (const kernel of STUDIO_LIVING_INK_SHARED_SMOKE_KERNEL_IDS) {
      expect(STUDIO_SMOKE_KERNEL_IDS).toContain(kernel);
    }
  });

  it("falls back to WebGL2 without changing pass semantics", () => {
    const result = planStudioLivingInkGpuPasses({
      width: 512,
      height: 512,
      operationKind: "water",
      dirtyBounds: { x: 64, y: 64, width: 128, height: 128 },
      hasSelectionMask: false,
      simulationTicks: 1,
      quality: "settle",
    }, { ...fullCapabilities, webgpu: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.backend).toBe("webgl2");
    expect(result.value.passes[0]?.backendShaderLanguage).toBe("glsl-es-300");
    expect(result.value.passes[0]?.kernel).toEqual({
      family: "living-ink",
      id: "inject-water",
    });
    expect(result.value.coarseVelocityScale).toBe(2);
  });

  it("fails closed without Worker/OffscreenCanvas or half-float GPU support", () => {
    expect(planStudioLivingInkGpuPasses({
      width: 128,
      height: 128,
      operationKind: "clear",
      dirtyBounds: { x: 0, y: 0, width: 128, height: 128 },
      hasSelectionMask: false,
      simulationTicks: 0,
      quality: "interactive",
    }, { ...fullCapabilities, worker: false })).toMatchObject({
      ok: false,
      reason: "execution-boundary-unavailable",
    });
    expect(planStudioLivingInkGpuPasses({
      width: 128,
      height: 128,
      operationKind: "clear",
      dirtyBounds: { x: 0, y: 0, width: 128, height: 128 },
      hasSelectionMask: false,
      simulationTicks: 0,
      quality: "interactive",
    }, { ...fullCapabilities, webgpu: false, webgl2: false })).toMatchObject({
      ok: false,
      reason: "gpu-backend-unavailable",
    });
  });

  it("steps only dirty tiles and mechanically bounds every phone frame batch", () => {
    const result = planStudioLivingInkGpuPasses({
      width: 4_096,
      height: 4_096,
      operationKind: "advance",
      dirtyBounds: { x: 1_024, y: 1_024, width: 1_024, height: 1_024 },
      hasSelectionMask: false,
      simulationTicks: 1,
      quality: "interactive",
    }, fullCapabilities);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.coarseVelocityScale).toBe(8);
    expect(result.value.dirtyRegions.length).toBeLessThanOrEqual(
      STUDIO_LIVING_INK_PHONE_FRAME_CONTRACT.maximumDirtyTilesPerPlan,
    );
    const dirtyArea = result.value.dirtyRegions.reduce(
      (sum, region) => sum + region.width * region.height,
      0,
    );
    expect(dirtyArea).toBeLessThan(4_096 * 4_096);
    for (const batch of result.value.frameBatches) {
      expect(batch.estimatedCellUpdates).toBeLessThanOrEqual(
        STUDIO_LIVING_INK_PHONE_FRAME_CONTRACT.maximumCellUpdatesPerFrame,
      );
      expect(batch.targetFrameMilliseconds).toBeCloseTo(16.6667, 3);
    }
  });
});
