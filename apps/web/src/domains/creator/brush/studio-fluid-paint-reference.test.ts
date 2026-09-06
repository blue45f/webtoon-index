import { describe, expect, it } from "vitest";

import {
  studioOilPaintBodyForBrush,
  studioOilTipProfileForBrush,
} from "../studio-fx-brush";

import {
  STUDIO_FLUID_PAINT_BRUSH,
  STUDIO_FLUID_PAINT_DISPLAY,
  STUDIO_FLUID_PAINT_SPLAT,
  STUDIO_FLUID_PAINT_STATION_SPACING_RATIO,
  studioFluidPaintClampVelocity,
  studioFluidPaintDistanceToSegment,
  studioFluidPaintFilteredSpeed,
  studioFluidPaintRgbToRyb,
  studioFluidPaintRybToRgb,
  studioFluidPaintSplatWeight,
  studioOilFamilyPlanFields,
} from "./studio-fluid-paint-reference";

describe("Fluid Paint (david.li/paint) reference", () => {
  it("keeps David Li brush.js and splat.frag numbers", () => {
    expect(STUDIO_FLUID_PAINT_BRUSH.splatsPerSegment).toBe(8);
    expect(STUDIO_FLUID_PAINT_BRUSH.verticesPerBristle).toBe(10);
    expect(STUDIO_FLUID_PAINT_BRUSH.bristleJitter).toBe(0.5);
    expect(STUDIO_FLUID_PAINT_BRUSH.damping).toBe(0.75);
    expect(STUDIO_FLUID_PAINT_BRUSH.constraintIterations).toBe(20);
    expect(STUDIO_FLUID_PAINT_SPLAT.maxSpeed).toBe(2);
    expect(STUDIO_FLUID_PAINT_DISPLAY.roughness).toBe(0.075);
    expect(STUDIO_FLUID_PAINT_STATION_SPACING_RATIO).toBeCloseTo(0.0085, 4);
  });

  it("converts subtractive RYB through the Gossett cube without collapsing to mud", () => {
    const red = studioFluidPaintRybToRgb(1, 0, 0);
    expect(red[0]).toBeGreaterThan(0.9);
    expect(red[1]).toBeLessThan(0.15);
    const yellow = studioFluidPaintRybToRgb(0, 0, 1);
    expect(yellow[0]).toBeGreaterThan(0.9);
    expect(yellow[1]).toBeGreaterThan(0.9);
    expect(yellow[2]).toBeLessThan(0.15);
    const blue = studioFluidPaintRybToRgb(0, 1, 0);
    expect(blue[2]).toBeGreaterThan(0.5);
    const mixed = studioFluidPaintRybToRgb(0.5, 0.5, 0);
    expect(mixed[0]).toBeGreaterThan(0.3);
    const [rr, ry, rb] = studioFluidPaintRgbToRyb(1, 0, 0);
    expect(rr).toBeGreaterThan(0.9);
    expect(ry).toBe(0);
    expect(rb).toBeGreaterThan(0.9);
  });

  it("clamps splat velocity and stamps a capsule, not a round bead", () => {
    const [vx, vy] = studioFluidPaintClampVelocity(6, 0);
    expect(Math.hypot(vx, vy)).toBeCloseTo(2, 5);
    const onLine = studioFluidPaintDistanceToSegment(0, 0, 10, 0, 5, 0);
    const offLine = studioFluidPaintDistanceToSegment(0, 0, 10, 0, 5, 3);
    expect(onLine).toBeCloseTo(0, 5);
    expect(offLine).toBeCloseTo(3, 5);
    expect(studioFluidPaintSplatWeight(0, 4)).toBe(1);
    expect(studioFluidPaintSplatWeight(4, 4)).toBe(0);
    expect(studioFluidPaintSplatWeight(2, 4)).toBeCloseTo(0.5, 5);
  });

  it("filters speed as the max of the last 15 samples", () => {
    const speeds = Array.from({ length: 20 }, (_, index) => index);
    expect(studioFluidPaintFilteredSpeed(speeds)).toBe(19);
    expect(studioFluidPaintFilteredSpeed([0.1, 0.4, 0.2])).toBe(0.4);
  });

  it("keeps the reference station pitch at one eighth of the oil default", () => {
    // 8 capsule splats per bristle segment (brush.js) against the 0.068 oil ribbon pitch. No
    // shipped brush selects this by id any more; a plan opts in through `stationSpacingRatio`.
    expect(STUDIO_FLUID_PAINT_STATION_SPACING_RATIO).toBeCloseTo(0.068 / 8, 12);
  });
});

describe("studioOilFamilyPlanFields", () => {
  it("carries the prefix-stable ladder with the rest of the oil plan fields", () => {
    // The fields travel together so a call site cannot take the paint body and forget the cap mode.
    // It was forgotten exactly once, at the committed Canvas renderer, which would have let a
    // capped stroke be previewed on the ladder and then redrawn on the legacy refit the moment the
    // live overlay handed off — the stroke visibly changing with nothing having been edited.
    for (const brush of ["oil", "acrylic", "oil--flat-ribbon", "oil--impasto-ribbon"]) {
      const fields = studioOilFamilyPlanFields(brush);
      expect(fields.capMode).toBe("prefix-stable-ladder-v2");
      expect(fields.paintBody).toBe(studioOilPaintBodyForBrush(brush));
      expect(fields.tipProfile).toBe(studioOilTipProfileForBrush(brush));
    }
  });
});
