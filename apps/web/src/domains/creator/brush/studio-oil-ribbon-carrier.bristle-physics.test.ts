import { describe, expect, it } from "vitest";

import { planOilBrushDabs } from "../studio-fx-brush";

import {
  planStudioOilRibbonCarrier,
  studioOilRibbonPathData,
  traceStudioOilRibbonPath,
} from "./studio-oil-ribbon-carrier";

const HORIZONTAL_STROKE = {
  points: [0, 60, 90, 60, 180, 60, 270, 60],
  pressures: [0.62, 0.7, 0.66, 0.6],
  baseWidth: 26,
  seed: 41,
} as const;

describe("studio oil ribbon carrier — bristle physics program (bristlePhysics)", () => {
  it("keeps every plan without the program byte-identical", () => {
    const dabs = planOilBrushDabs(HORIZONTAL_STROKE);
    const legacy = planStudioOilRibbonCarrier(dabs);

    expect(JSON.stringify(planStudioOilRibbonCarrier(dabs, {}))).toBe(
      JSON.stringify(legacy),
    );
    expect(
      JSON.stringify(
        planStudioOilRibbonCarrier(dabs, { bristlePhysics: { enabled: false } }),
      ),
    ).toBe(JSON.stringify(legacy));
  });

  it("re-drives only the bristle lanes: body and opacity stay byte-identical", () => {
    const dabs = planOilBrushDabs(HORIZONTAL_STROKE);
    const legacy = planStudioOilRibbonCarrier(dabs);
    const physics = planStudioOilRibbonCarrier(dabs, {
      bristlePhysics: { enabled: true, seed: 41 },
    });

    expect(physics.body).toEqual(legacy.body);
    expect(physics.bodyOpacity).toBe(legacy.bodyOpacity);
    expect(physics.sourceStationCount).toBe(legacy.sourceStationCount);
    expect("impastoReliefLanes" in physics).toBe(false);
    // The simulated tuft actually moves the lanes — otherwise the label lies.
    expect(JSON.stringify(physics.bristleLanes)).not.toBe(
      JSON.stringify(legacy.bristleLanes),
    );
    expect(physics.bristleLanes.length).toBeGreaterThan(0);
    for (const lane of physics.bristleLanes) {
      expect(lane.lineWidth).toBeGreaterThan(0);
      expect(lane.opacity).toBeGreaterThan(0);
      expect(lane.runs.length).toBeGreaterThan(0);
    }
    // Deterministic replan.
    expect(
      JSON.stringify(planStudioOilRibbonCarrier(dabs, {
        bristlePhysics: { enabled: true, seed: 41 },
      })),
    ).toBe(JSON.stringify(physics));
    // A different stroke seed lays out a different tuft.
    expect(
      JSON.stringify(planStudioOilRibbonCarrier(dabs, {
        bristlePhysics: { enabled: true, seed: 42 },
      }).bristleLanes),
    ).not.toBe(JSON.stringify(physics.bristleLanes));
  });

  it("keeps every physics lane inside the ribbon body silhouette", () => {
    const dabs = planOilBrushDabs(HORIZONTAL_STROKE);
    const plan = planStudioOilRibbonCarrier(dabs, {
      bristlePhysics: { enabled: true, seed: 41 },
    });
    const maxRadiusY = Math.max(...dabs.map(({ radiusY }) => radiusY));
    for (const lane of plan.bristleLanes) {
      for (const run of lane.runs) {
        for (let index = 1; index < run.points.length; index += 2) {
          // Offsets are clamped to ±0.92·radiusY; stations carry ≤0.6px jitter.
          expect(Math.abs(run.points[index]! - 60)).toBeLessThanOrEqual(maxRadiusY + 0.6);
        }
      }
    }
  });

  it("shares identical quantized lane coordinates between Canvas tracing and SVG", () => {
    const plan = planStudioOilRibbonCarrier(planOilBrushDabs(HORIZONTAL_STROKE), {
      bristlePhysics: { enabled: true, seed: 41 },
    });
    for (const lane of plan.bristleLanes) {
      for (const run of lane.runs) {
        const canvasCoordinates: number[] = [];
        traceStudioOilRibbonPath({
          moveTo: (x, y) => canvasCoordinates.push(x, y),
          lineTo: (x, y) => canvasCoordinates.push(x, y),
        }, run);
        const svgCoordinates = (
          studioOilRibbonPathData(run).match(/-?(?:\d+\.\d+|\d+)/gu) ?? []
        ).map(Number);
        expect(svgCoordinates).toEqual(canvasCoordinates);
      }
    }
  });

  it("plans a 2000-station physics stroke within 25ms of the legacy carrier", () => {
    // The budget is 2400 rather than 2048 because the capped spacing ladder lands the bed inside a
    // band below its limit instead of exactly on it. Sizing up keeps the measured bed at least as
    // large as the one this budget was calibrated against, rather than relaxing the assertion.
    const longDabs = planOilBrushDabs({
      points: [0, 0, 1200, 40, 2400, -30, 3600, 20],
      pressures: [0.5, 0.75, 0.6, 0.8],
      baseWidth: 24,
      seed: 7,
      maxDabs: 2400,
    });
    expect(longDabs.length).toBeGreaterThanOrEqual(2000);
    // Warm-up passes exclude first-call JIT from both measurements.
    planStudioOilRibbonCarrier(longDabs);
    planStudioOilRibbonCarrier(longDabs, { bristlePhysics: { enabled: true, seed: 7 } });

    let legacyBest = Number.POSITIVE_INFINITY;
    let physicsBest = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 3; run += 1) {
      const legacyStart = performance.now();
      planStudioOilRibbonCarrier(longDabs);
      legacyBest = Math.min(legacyBest, performance.now() - legacyStart);
      const physicsStart = performance.now();
      const plan = planStudioOilRibbonCarrier(longDabs, {
        bristlePhysics: { enabled: true, seed: 7 },
      });
      physicsBest = Math.min(physicsBest, performance.now() - physicsStart);
      expect(plan.bristleLanes.length).toBeGreaterThan(0);
    }
    expect(physicsBest - legacyBest).toBeLessThan(25);
  });
});
