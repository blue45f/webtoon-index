import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  STUDIO_FLUID_PAINT_BRUSH,
  STUDIO_FLUID_PAINT_DISPLAY,
  STUDIO_GPU_BRISTLE_LIMITS,
} from "./studio-gpu-bristle-contract";
import {
  studioGpuBristleImpastoResolveWgsl,
  studioGpuBristleSolveWgsl,
  studioGpuBristleSplatWgsl,
  STUDIO_GPU_BRISTLE_WGSL_PASS_ORDER,
} from "./studio-gpu-bristle-wgsl";

/**
 * Two gates in one file.
 *
 * L2 — the numeric-tunable gate. No physics or display tunable may be written inside shader text;
 * everything arrives through a uniform whose value comes from `studio-gpu-bristle-contract.ts`.
 * This is the discipline that made the living-ink oracle honest
 * (`../studio-living-ink-execution-protocol.ts:17-20`), made mechanical rather than aspirational.
 * Structural sizes ARE textual, so the gate also proves they are interpolated from the caller's
 * layout rather than typed as literals.
 *
 * G5 — the browser-verifier boundary: the parity harness must load the real runtime through an
 * isolated literal entry, must require a real Chromium WebGPU device, and must emit a structured
 * skip (`status: "skipped"`, `process.exitCode = 2`) rather than a false pass when the environment
 * has no GPU.
 */

const ROOT = resolve(import.meta.dirname, "../../../..");
const WGSL_MODULE = readFileSync(
  resolve(ROOT, "apps/web/src/domains/creator/render/studio-gpu-bristle-wgsl.ts"),
  "utf8",
);
const BROWSER_ENTRY = readFileSync(
  resolve(ROOT, "scripts/studio-gpu-bristle-parity-browser.ts"),
  "utf8",
);
const VERIFIER = readFileSync(
  resolve(ROOT, "scripts/verify-studio-gpu-bristle-parity.mjs"),
  "utf8",
);

const LAYOUT = {
  verticesPerBristle: STUDIO_GPU_BRISTLE_LIMITS.verticesPerBristle,
  maxBristles: STUDIO_GPU_BRISTLE_LIMITS.maxBristleCount,
  maxStationsPerBatch: STUDIO_GPU_BRISTLE_LIMITS.maxStationsPerBatch,
  solveWorkgroupSize: STUDIO_GPU_BRISTLE_LIMITS.workgroupSize,
};

/**
 * Every WGSL template literal in the module, concatenated. Anchored on `return \`` so the
 * extraction cannot run away into the module's own prose header.
 */
function shaderTextRegions(source: string): string {
  const regions: string[] = [];
  for (const match of source.matchAll(/return `\n([\s\S]*?)\n`\.trim\(\);/gu)) {
    regions.push(match[1]!);
  }
  return regions.join("\n");
}

describe("gpu-bristle shader tunable gate (L2)", () => {
  const shaderText = shaderTextRegions(WGSL_MODULE);

  it("actually extracted the shader regions (gate sanity)", () => {
    // Without this the assertions below pass vacuously on an empty string.
    expect(shaderText).toContain("@compute");
    expect(shaderText).toContain("fn splat_fragment");
    expect(shaderText).toContain("fn resolve_fragment");
  });

  it("writes no dli fractional tunable as a literal anywhere in shader text", () => {
    // Fractional tunables are unambiguous: nothing else in a shader legitimately needs `0.075`.
    const forbidden = [
      STUDIO_FLUID_PAINT_BRUSH.bristleLength,
      STUDIO_FLUID_PAINT_BRUSH.bristleJitter,
      STUDIO_FLUID_PAINT_BRUSH.damping,
      STUDIO_FLUID_PAINT_BRUSH.stiffnessVariation,
      STUDIO_FLUID_PAINT_DISPLAY.roughness,
      STUDIO_FLUID_PAINT_DISPLAY.f0,
      STUDIO_FLUID_PAINT_DISPLAY.specularScale,
      STUDIO_FLUID_PAINT_DISPLAY.diffuseScale,
    ].filter((value) => !Number.isInteger(value));
    expect(forbidden.length).toBeGreaterThan(0);
    for (const value of forbidden) {
      expect(shaderText).not.toMatch(new RegExp(`(?<![\\d.])${String(value)}(?![\\d])`, "u"));
    }
  });

  it("reads gravity, damping and the iteration count from the uniform blocks", () => {
    expect(shaderText).toContain("let gravity = u.physics.y;");
    expect(shaderText).toContain("let damping = u.physics.z;");
    expect(shaderText).toContain("let iterations = u.counts.z;");
    expect(shaderText).toContain("let bristle_length = u.geometry.x;");
    expect(shaderText).toContain("let z_threshold = u.geometry.w;");
    // Display tunables likewise: NORMAL_SCALE is `d.light.w`, never a number.
    expect(shaderText).toContain("let normal_scale = d.light.w;");
    expect(shaderText).toContain("let roughness = d.material.x;");
  });

  it("interpolates structural sizes from the caller's layout instead of baking them", () => {
    // A mutated layout must change the emitted text; a baked literal would not.
    const standard = studioGpuBristleSolveWgsl(LAYOUT)!;
    const mutated = studioGpuBristleSolveWgsl({ ...LAYOUT, verticesPerBristle: 7 })!;
    expect(standard).toContain(`array<vec4f, ${LAYOUT.verticesPerBristle}>`);
    expect(standard).toContain(`const VERTICES : u32 = ${LAYOUT.verticesPerBristle}u;`);
    expect(mutated).toContain("array<vec4f, 7>");
    expect(mutated).toContain("const VERTICES : u32 = 7u;");
    expect(mutated).not.toContain(`const VERTICES : u32 = ${LAYOUT.verticesPerBristle}u;`);
    expect(
      studioGpuBristleSolveWgsl({ ...LAYOUT, solveWorkgroupSize: 64, maxBristles: 64 })!,
    ).toContain("@workgroup_size(64)");
  });

  it("refuses an impossible layout instead of emitting invalid WGSL", () => {
    expect(studioGpuBristleSolveWgsl({ ...LAYOUT, verticesPerBristle: 1 })).toBeNull();
    expect(studioGpuBristleSolveWgsl({ ...LAYOUT, solveWorkgroupSize: 0 })).toBeNull();
    // A workgroup narrower than the tuft would silently drop bristles.
    expect(studioGpuBristleSolveWgsl({ ...LAYOUT, solveWorkgroupSize: 16 })).toBeNull();
    expect(studioGpuBristleSplatWgsl({ ...LAYOUT, maxStationsPerBatch: 0 })).toBeNull();
  });

  it("uses no atomics and addresses splat slots station-major", () => {
    // Atomic append is order non-deterministic across dispatches; with `blend {one, one}` the sums
    // differ in the last ulp and gate G1 becomes unimplementable.
    expect(shaderText).not.toContain("atomic");
    expect(shaderText).toContain("let slot = s * bristle_count + lane;");
  });

  it("composes the paper grain sampler rather than duplicating it", () => {
    const resolveWgsl = studioGpuBristleImpastoResolveWgsl({
      group: 1,
      textureBinding: 0,
      samplerBinding: 1,
      uniformBinding: 2,
      prefix: "studio_gpu_bristle_grain",
    })!;
    expect(resolveWgsl).toContain("fn studio_gpu_bristle_grain_alpha_multiplier(");
    expect(resolveWgsl).toContain("textureSample(studio_gpu_bristle_grain_texture");
    // Paint and height are `textureLoad`ed — 1:1 integer texels, no dependence on vendor filtering.
    expect(resolveWgsl).toContain("textureLoad(paint_tex");
    expect(resolveWgsl).toContain("textureLoad(height_tex");
    expect(resolveWgsl).not.toContain("textureSample(paint_tex");
    expect(resolveWgsl).not.toContain("textureSample(height_tex");
    expect(studioGpuBristleImpastoResolveWgsl({
      group: 1,
      textureBinding: 0,
      samplerBinding: 0,
      uniformBinding: 2,
    })).toBeNull();
  });

  it("names its three passes in execution order", () => {
    expect([...STUDIO_GPU_BRISTLE_WGSL_PASS_ORDER]).toEqual([
      "bristle-solve",
      "splat-deposit",
      "impasto-resolve",
    ]);
  });

  it("keeps the dli provenance header on the derived shader module", () => {
    expect(WGSL_MODULE).toContain("https://github.com/dli/paint");
    expect(WGSL_MODULE).toContain("Copyright (c) 2017 David Li");
    expect(WGSL_MODULE).toContain("third_party/dli-paint/LICENSE");
    for (const upstream of [
      "distanceconstraint.frag",
      "bendingconstraint.frag",
      "planeconstraint.frag",
      "setbristles.frag",
      "updatevelocity.frag",
      "shaders/splat.frag",
      "shaders/painting.frag",
    ]) {
      expect(WGSL_MODULE).toContain(upstream);
    }
  });
});

describe("gpu-bristle parity browser boundary (G5)", () => {
  it("loads the real runtime through an isolated literal browser entry", () => {
    expect(BROWSER_ENTRY).toContain(
      'from "../apps/web/src/domains/creator/render/studio-gpu-bristle-runtime"',
    );
    expect(BROWSER_ENTRY).toContain(
      'from "../apps/web/src/domains/creator/render/studio-gpu-bristle-reference"',
    );
    expect(VERIFIER).toContain(
      'const HARNESS_ENTRY = "/scripts/studio-gpu-bristle-parity-browser.ts";',
    );
    expect(VERIFIER).toContain('appType: "custom"');
    expect(VERIFIER).not.toContain("StudioPage");
  });

  it("requires a real Chromium WebGPU OffscreenCanvas and emits a structured skip", () => {
    expect(BROWSER_ENTRY).toContain("new OffscreenCanvas(SURFACE.widthPx, SURFACE.heightPx)");
    expect(BROWSER_ENTRY).toContain("navigator.gpu !== undefined");
    expect(BROWSER_ENTRY).not.toContain("fakeGpu");
    expect(BROWSER_ENTRY).not.toContain("FakeGpu");
    expect(VERIFIER).toContain('result.status === "unsupported"');
    expect(VERIFIER).toContain('status: "skipped"');
    expect(VERIFIER).toContain("process.exitCode = 2");
  });

  it("gates on byte-exact self-parity across two different chunkings", () => {
    expect(BROWSER_ENTRY).toContain("uniformChunks(STATION_COUNT)");
    expect(BROWSER_ENTRY).toContain("seededChunks(STATION_COUNT, 0x5eed)");
    expect(BROWSER_ENTRY).not.toMatch(/Math\.random\(/u);
    expect(VERIFIER).toContain("result.selfParity?.bristleState?.equal");
    expect(VERIFIER).toContain("result.selfParity?.splatSlots?.equal");
  });

  it("gates on every G3 judgement plus a degenerate-tuft floor", () => {
    for (const metric of [
      "constraint-satisfaction",
      "pigment-conservation",
      "tip-lag",
      "terminal-load-ks",
    ]) {
      expect(VERIFIER).toContain(`"${metric}"`);
    }
    // Two identically degenerate samples agree perfectly, so KS alone cannot see a uniform rake.
    expect(VERIFIER).toContain("result.metrics?.gpuTerminalLoadStdDev > 0");
    expect(VERIFIER).toContain("result.metrics?.depositedSplatCount > 0");
  });

  it("gates on the four-threshold picture admission, ridge contrast included", () => {
    expect(BROWSER_ENTRY).toContain("evaluateStudioGpuBristleProbe(");
    expect(BROWSER_ENTRY).toContain("proveStudioGpuBristleAdmission(");
    expect(VERIFIER).toContain('result.admission?.status !== "observed"');
    expect(VERIFIER).toContain("result.admission.admitted !== true");
  });

  it("uses an actual GPUDevice loss signal instead of a fake capability claim", () => {
    expect(BROWSER_ENTRY).toContain("lease.device.destroy()");
    expect(BROWSER_ENTRY).toContain("await lease.device.lost");
    expect(BROWSER_ENTRY).not.toContain("simulateDeviceLoss");
    expect(VERIFIER).toContain('result.deviceLoss.runtimeStatus !== "device-lost"');
    expect(VERIFIER).toContain('result.deviceLoss.advanceAfterLoss !== "device-lost"');
  });
});
