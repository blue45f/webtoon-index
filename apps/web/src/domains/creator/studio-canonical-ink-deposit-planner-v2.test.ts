import { describe, expect, it } from "vitest";

import {
  planStudioStrokeCurveV2,
  type StudioStrokeCurvePlanV2,
} from "./brush/studio-stroke-curve-resampler-v2";
import {
  planStudioCanonicalInkDepositsV2,
  STUDIO_CANONICAL_INK_DEPOSIT_PLAN_V2_VERSION,
  type StudioCanonicalInkDepositPlanV2,
  type StudioCanonicalInkRecipeV2,
} from "./studio-canonical-ink-deposit-planner-v2";
import {
  normalizeStudioCanonicalStrokeV2,
  replaceStudioCanonicalStrokePredictedSuffixV2,
  type StudioCanonicalStrokeSampleCandidateV2,
  type StudioCanonicalStrokeV2,
} from "./studio-canonical-stroke-v2";

function sample(
  sequence: number,
  x: number,
  y: number,
  overrides: Partial<StudioCanonicalStrokeSampleCandidateV2> = {},
): StudioCanonicalStrokeSampleCandidateV2 {
  return {
    role: "authoritative",
    sequence,
    sourceTimeMilliseconds: 1_000 + sequence * 10,
    x,
    y,
    pressure: 0.5,
    tangentialPressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerId: 5,
    pointerType: "pen",
    button: -1,
    buttons: 1,
    flags: 0,
    ...overrides,
  };
}

function strokeFrom(
  samples: readonly StudioCanonicalStrokeSampleCandidateV2[],
): StudioCanonicalStrokeV2 {
  const result = normalizeStudioCanonicalStrokeV2({
    strokeId: "ink-deposit-v2",
    timeOriginMilliseconds: 1_000,
    samples,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

function curveFrom(
  stroke: StudioCanonicalStrokeV2,
  sealAuthoritativeTail = true,
): StudioStrokeCurvePlanV2 {
  const result = planStudioStrokeCurveV2(stroke, {
    spacing: 0.5,
    curvatureStrength: 1,
    minimumSpacingRatio: 0.3,
    cornerThresholdDegrees: 55,
    sealAuthoritativeTail,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

function response(minimum: number, maximum: number, exponent = 1) {
  return { minimum, maximum, exponent };
}

function recipe(
  overrides: Partial<StudioCanonicalInkRecipeV2> = {},
): StudioCanonicalInkRecipeV2 {
  return {
    version: STUDIO_CANONICAL_INK_DEPOSIT_PLAN_V2_VERSION,
    brushId: "g-pen-v2",
    size: 10,
    opacity: 0.8,
    flow: 0.5,
    spacingRatio: 0.2,
    minimumSpacing: 0.25,
    roundness: 0.4,
    angleOffsetRadians: 0,
    pressure: {
      size: response(0, 1),
      opacity: response(0.25, 1),
      flow: response(0.5, 1),
    },
    composite: {
      porterDuff: "source-over",
      blendMode: "normal",
    },
    ...overrides,
  };
}

function deposits(
  curve: StudioStrokeCurvePlanV2,
  value = recipe(),
  maximumDeposits?: number,
): StudioCanonicalInkDepositPlanV2 {
  const result = planStudioCanonicalInkDepositsV2(curve, value, {
    maximumDeposits,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe("canonical analytic ink deposit planner v2", () => {
  it("maps pressure into size, opacity and flow with tangent-oriented ellipse metadata", () => {
    const plan = deposits(curveFrom(strokeFrom([
      sample(1, 0, 0, { pressure: 0 }),
      sample(2, 20, 20, { pressure: 1 }),
    ])));
    const middle = plan.settledDeposits.reduce((nearest, deposit) =>
      Math.abs(deposit.x - 10) < Math.abs(nearest.x - 10)
        ? deposit
        : nearest);

    expect(middle.pressure).toBeCloseTo(0.5, 1);
    expect(middle.diameter).toBeCloseTo(10 * middle.pressure, 10);
    expect(middle.radiusY / middle.radiusX).toBeCloseTo(0.4, 8);
    expect(middle.opacity).toBeCloseTo(
      0.8 * (0.25 + 0.75 * middle.pressure),
      10,
    );
    expect(middle.flow).toBeCloseTo(
      0.5 * (0.5 + 0.5 * middle.pressure),
      10,
    );
    expect(middle.sourceAlpha).toBeCloseTo(middle.opacity * middle.flow, 10);
    expect(middle.angleRadians).toBeCloseTo(Math.PI / 4, 2);
    expect(middle.composite).toEqual({
      porterDuff: "source-over",
      blendMode: "normal",
    });
  });

  it("keeps settled deposits prefix-identical when authoritative geometry appends", () => {
    const prefixSamples = [
      sample(1, 0, 0),
      sample(2, 15, 4),
      sample(3, 30, 12),
      sample(4, 45, 18),
    ];
    const prefix = deposits(curveFrom(strokeFrom(prefixSamples), false));
    const appended = deposits(curveFrom(strokeFrom([
      ...prefixSamples,
      sample(5, 60, 30),
    ]), false));

    expect(appended.settledDeposits.slice(0, prefix.settledDeposits.length)).toEqual(
      prefix.settledDeposits,
    );
    expect(appended.settledDeposits.length).toBeGreaterThan(
      prefix.settledDeposits.length,
    );
  });

  it("isolates prediction changes to the preview deposit suffix", () => {
    const authoritative = [
      sample(1, 0, 0),
      sample(2, 20, 4),
      sample(3, 40, 8),
      sample(4, 60, 12),
    ];
    const firstStroke = strokeFrom([
      ...authoritative,
      sample(5, 76, 16, { role: "predicted" }),
    ]);
    const first = deposits(curveFrom(firstStroke, false));
    const replacement = replaceStudioCanonicalStrokePredictedSuffixV2(firstStroke, [
      sample(5, 72, 34, { role: "predicted" }),
      sample(6, 88, 46, { role: "predicted" }),
    ]);
    if (!replacement.ok) throw new Error(replacement.reason);
    const second = deposits(curveFrom(replacement.value, false));

    expect(second.settledDeposits).toEqual(first.settledDeposits);
    expect(second.previewDeposits).not.toEqual(first.previewDeposits);
    expect(second.previewDeposits.every(deposit => deposit.source === "preview")).toBe(
      true,
    );
  });

  it("emits a finite tap and zero-pressure deposit without opening an infinite spacing loop", () => {
    const tap = deposits(curveFrom(strokeFrom([
      sample(1, 12, 18, { pressure: 0 }),
    ])), recipe({
      pressure: {
        size: response(0, 1),
        opacity: response(0, 1),
        flow: response(0, 1),
      },
    }));

    expect(tap.settledDeposits).toHaveLength(1);
    expect(tap.previewDeposits).toHaveLength(0);
    expect(tap.settledDeposits[0]).toMatchObject({
      x: 12,
      y: 18,
      pressure: 0,
      diameter: 0,
      radiusX: 0,
      radiusY: 0,
      opacity: 0,
      flow: 0,
      sourceAlpha: 0,
    });
    expect(tap.nextDepositDistance).toBe(0.25);
  });

  it("rotates the ellipse through a preserved sharp corner and carries eraser composite metadata", () => {
    const plan = deposits(curveFrom(strokeFrom([
      sample(1, 0, 0),
      sample(2, 20, 0),
      sample(3, 20, 20),
      sample(4, 20, 40),
    ])), recipe({
      composite: {
        porterDuff: "destination-out",
        blendMode: "normal",
      },
    }));
    const horizontal = plan.settledDeposits.find(
      deposit => deposit.x < 18 && Math.abs(deposit.y) < 0.1,
    )!;
    const vertical = plan.settledDeposits.find(
      deposit => deposit.y > 22 && Math.abs(deposit.x - 20) < 0.1,
    )!;

    expect(Math.abs(horizontal.angleRadians)).toBeLessThan(0.05);
    expect(vertical.angleRadians).toBeCloseTo(Math.PI / 2, 1);
    expect(plan.settledDeposits.every(
      deposit => deposit.composite.porterDuff === "destination-out",
    )).toBe(true);
  });

  it("is byte-structurally deterministic for the same curve and recipe", () => {
    const curve = curveFrom(strokeFrom([
      sample(1, 0, 0, { pressure: 0.2 }),
      sample(2, 20, 8, { pressure: 0.6 }),
      sample(3, 40, 4, { pressure: 0.9 }),
    ]));
    const first = deposits(curve);
    const second = deposits(structuredClone(curve), structuredClone(recipe()));

    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.settledDeposits)).toBe(true);
    expect(Object.isFrozen(first.settledDeposits[0])).toBe(true);
  });

  it("fails closed on invalid recipe/curve numbers and a deposit budget overflow", () => {
    const curve = curveFrom(strokeFrom([
      sample(1, 0, 0),
      sample(2, 100, 0),
    ]));
    expect(planStudioCanonicalInkDepositsV2(curve, {
      ...recipe(),
      size: Number.NaN,
    })).toEqual({ ok: false, reason: "invalid-recipe" });

    const invalidCurve = structuredClone(curve);
    (invalidCurve.settledStations[0] as { x: number }).x = Number.NaN;
    expect(planStudioCanonicalInkDepositsV2(invalidCurve, recipe())).toEqual({
      ok: false,
      reason: "invalid-curve",
    });

    expect(planStudioCanonicalInkDepositsV2(curve, recipe({
      size: 1,
      spacingRatio: 0.01,
      minimumSpacing: 0.01,
    }), {
      maximumDeposits: 4,
    })).toEqual({ ok: false, reason: "budget-exceeded" });
  });
});
