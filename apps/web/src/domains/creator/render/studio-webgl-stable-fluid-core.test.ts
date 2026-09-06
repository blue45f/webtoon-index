import { describe, expect, it } from "vitest";

import {
  resolveStudioFluidDemoAdoptionPlan,
  studioFluidDemoEvaluationById,
} from "../studio-fluid-demo-evaluation";

import {
  createStudioStableFluidState,
  splatStudioStableFluid,
  stepStudioStableFluid,
  studioStableFluidMaxSpeed,
  studioStableFluidTotalDensity,
} from "./studio-webgl-stable-fluid-core";

describe("studio webgl stable fluid core (MIT fluid lineage)", () => {
  it("transports dye under a velocity splat and keeps finite fields", () => {
    const state = createStudioStableFluidState({ width: 48, height: 48 });
    splatStudioStableFluid(state, {
      x: 12,
      y: 24,
      radius: 3,
      velocityX: 18,
      velocityY: 0,
      density: 1,
      wet: 1,
    });
    const densityBefore = studioStableFluidTotalDensity(state);
    expect(densityBefore).toBeGreaterThan(0.5);
    for (let i = 0; i < 12; i += 1) stepStudioStableFluid(state);
    expect(studioStableFluidTotalDensity(state)).toBeGreaterThan(0);
    expect(studioStableFluidMaxSpeed(state)).toBeGreaterThan(0);
    // Dye should have moved rightward of the deposit column on average.
    let moment = 0;
    let mass = 0;
    for (let y = 0; y < 48; y += 1) {
      for (let x = 0; x < 48; x += 1) {
        const d = state.density[y * 48 + x] ?? 0;
        moment += d * x;
        mass += d;
      }
    }
    expect(mass).toBeGreaterThan(0);
    expect(moment / mass).toBeGreaterThan(12);
  });

  it("damps velocity outside the wet mask (inkwash-inspired confinement)", () => {
    const wet = createStudioStableFluidState({ width: 32, height: 32 });
    const dry = createStudioStableFluidState({ width: 32, height: 32 });
    dry.wet.fill(0.02);
    for (const state of [wet, dry]) {
      splatStudioStableFluid(state, {
        x: 16,
        y: 16,
        radius: 2.5,
        velocityX: 10,
        velocityY: 4,
        density: 0.8,
      });
      for (let i = 0; i < 8; i += 1) stepStudioStableFluid(state);
    }
    expect(studioStableFluidMaxSpeed(wet)).toBeGreaterThan(
      studioStableFluidMaxSpeed(dry) * 1.5,
    );
  });
});

describe("studio fluid demo evaluation", () => {
  it("allows MIT fluid as supporting kernel and blocks unlicensed inkwash vendoring", () => {
    const plan = resolveStudioFluidDemoAdoptionPlan();
    expect(plan.wetPinPolicy.primaryPin).toBe(
      "living-ink-and-wet-ink-runtime",
    );
    expect(plan.wetPinPolicy.supportingKernel).toBe(
      "studio-webgl-stable-fluid-core",
    );
    expect(plan.wetPinPolicy.crossEngineFallback).toBe(false);

    const pavel = studioFluidDemoEvaluationById(
      "pavel-webgl-fluid-simulation",
    );
    expect(pavel?.mayVendorSource).toBe(true);
    expect(pavel?.verdict).toBe("adopt-as-supporting-kernel");

    const inkwash = studioFluidDemoEvaluationById("johnowhitaker-inkwash");
    expect(inkwash?.mayVendorSource).toBe(false);
    expect(inkwash?.verdict).toBe("inspire-living-ink-only");

    const paint = studioFluidDemoEvaluationById("piellardj-paint-webgl");
    expect(paint?.verdict).toBe("reference-not-product");
  });
});
