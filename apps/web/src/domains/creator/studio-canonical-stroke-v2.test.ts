import { describe, expect, it } from "vitest";

import {
  normalizeStudioCanonicalStrokeV2,
  replaceStudioCanonicalStrokePredictedSuffixV2,
  STUDIO_CANONICAL_STROKE_V2_BUDGETS,
  STUDIO_CANONICAL_STROKE_V2_SAMPLE_FLAGS,
  type StudioCanonicalStrokeSampleCandidateV2,
} from "./studio-canonical-stroke-v2";

function sample(
  role: StudioCanonicalStrokeSampleCandidateV2["role"],
  sequence: number,
  overrides: Partial<StudioCanonicalStrokeSampleCandidateV2> = {},
): StudioCanonicalStrokeSampleCandidateV2 {
  return {
    role,
    sequence,
    sourceTimeMilliseconds: 1_000 + sequence * 4,
    x: sequence * 2,
    y: sequence * 3,
    pressure: 0.55,
    tangentialPressure: 0.1,
    tiltX: 12,
    tiltY: -8,
    twist: 350,
    pointerId: 7,
    pointerType: "pen",
    button: -1,
    buttons: 1,
    flags:
      STUDIO_CANONICAL_STROKE_V2_SAMPLE_FLAGS.primary
      | STUDIO_CANONICAL_STROKE_V2_SAMPLE_FLAGS.rulerPerspective,
    ...overrides,
  };
}

function ready(samples: readonly StudioCanonicalStrokeSampleCandidateV2[]) {
  const result = normalizeStudioCanonicalStrokeV2({
    strokeId: "stroke-v2",
    timeOriginMilliseconds: 1_000,
    samples,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe("StudioCanonicalStrokeV2", () => {
  it("keeps raw, authoritative and predicted channels separate and fully specified", () => {
    const stroke = ready([
      sample("raw", 1),
      sample("authoritative", 1),
      sample("raw", 2, { sourceTimeMilliseconds: 1_003 }),
      sample("authoritative", 2, {
        pressure: 0.8,
        tangentialPressure: -0.25,
        tiltX: 30,
        tiltY: 18,
        altitudeAngle: Math.PI / 3,
        azimuthAngle: Math.PI * 1.75,
        twist: 10,
        contactWidth: 8,
        contactHeight: 4,
        button: 0,
        buttons: 3,
        flags: STUDIO_CANONICAL_STROKE_V2_SAMPLE_FLAGS.rulerSnapApplied,
      }),
      sample("predicted", 3, { sourceTimeMilliseconds: 1_020 }),
    ]);

    expect(stroke.streams.raw).toHaveLength(2);
    expect(stroke.streams.authoritative).toHaveLength(2);
    expect(stroke.streams.predicted).toHaveLength(1);
    expect(stroke.streams.authoritative[1]).toMatchObject({
      role: "authoritative",
      sequence: 2,
      timeMilliseconds: 8,
      pressure: 0.8,
      tangentialPressure: -0.25,
      tiltX: 30,
      tiltY: 18,
      altitudeAngle: Math.PI / 3,
      azimuthAngle: Math.PI * 1.75,
      twist: 10,
      contactWidth: 8,
      contactHeight: 4,
      pointerId: 7,
      pointerType: "pen",
      button: 0,
      buttons: 3,
      flags: STUDIO_CANONICAL_STROKE_V2_SAMPLE_FLAGS.rulerSnapApplied,
    });
    expect(Object.isFrozen(stroke)).toBe(true);
    expect(Object.isFrozen(stroke.streams.authoritative)).toBe(true);
    expect(Object.isFrozen(stroke.streams.authoritative[0])).toBe(true);
  });

  it("materializes neutral extended-channel defaults for older producers", () => {
    const stroke = ready([sample("authoritative", 1)]);

    expect(stroke.streams.authoritative[0]).toMatchObject({
      altitudeAngle: Math.PI / 2,
      azimuthAngle: 0,
      contactWidth: 1,
      contactHeight: 1,
    });
    expect("persistentDeviceId" in stroke.streams.authoritative[0]!).toBe(false);
  });

  it("removes exact duplicates and clamps a regressing browser clock monotonically", () => {
    const first = sample("authoritative", 1, { sourceTimeMilliseconds: 1_010 });
    const second = sample("authoritative", 2, { sourceTimeMilliseconds: 1_005 });
    const stroke = ready([first, { ...first }, second]);

    expect(stroke.streams.authoritative).toHaveLength(2);
    expect(stroke.streams.authoritative.map(value => value.timeMilliseconds)).toEqual([
      10,
      10,
    ]);
    expect(stroke.streams.authoritative[1]!.sourceTimeMilliseconds).toBe(1_005);
  });

  it("fails closed on reverse order, conflicting duplicates, invalid numbers and pointer drift", () => {
    const normalize = (
      samples: readonly StudioCanonicalStrokeSampleCandidateV2[],
    ) => normalizeStudioCanonicalStrokeV2({
      strokeId: "invalid",
      timeOriginMilliseconds: 1_000,
      samples,
    });

    expect(normalize([
      sample("authoritative", 2),
      sample("authoritative", 1),
    ])).toMatchObject({ ok: false, reason: "sample-order", sampleIndex: 1 });
    expect(normalize([
      sample("authoritative", 1),
      sample("authoritative", 1, { pressure: 0.9 }),
    ])).toMatchObject({
      ok: false,
      reason: "conflicting-duplicate",
      sampleIndex: 1,
    });
    expect(normalize([
      sample("authoritative", 1, { x: Number.NaN }),
    ])).toMatchObject({ ok: false, reason: "invalid-sample", sampleIndex: 0 });
    expect(normalize([
      sample("authoritative", 1),
      sample("authoritative", 2, { pointerId: 8 }),
    ])).toMatchObject({ ok: false, reason: "pointer-mismatch", sampleIndex: 1 });
    expect(normalize([
      sample("authoritative", 1, { altitudeAngle: Math.PI }),
    ])).toMatchObject({ ok: false, reason: "invalid-sample", sampleIndex: 0 });
    expect(normalize([
      sample("authoritative", 1, { azimuthAngle: -0.001 }),
    ])).toMatchObject({ ok: false, reason: "invalid-sample", sampleIndex: 0 });
    expect(normalize([
      sample("authoritative", 1, {
        contactWidth:
          STUDIO_CANONICAL_STROKE_V2_BUDGETS.maxContactDimension + 1,
      }),
    ])).toMatchObject({ ok: false, reason: "invalid-sample", sampleIndex: 0 });
  });

  it("replaces the transient prediction suffix without changing accepted source channels", () => {
    const source = ready([
      sample("raw", 1),
      sample("authoritative", 1),
      sample("authoritative", 2),
      sample("predicted", 3, { x: 20 }),
    ]);
    const replacement = replaceStudioCanonicalStrokePredictedSuffixV2(source, [
      sample("predicted", 3, { x: 30 }),
      sample("predicted", 4, { x: 40 }),
    ]);

    expect(replacement.ok).toBe(true);
    if (!replacement.ok) return;
    expect(replacement.value.streams.raw).toEqual(source.streams.raw);
    expect(replacement.value.streams.authoritative).toEqual(
      source.streams.authoritative,
    );
    expect(replacement.value.streams.predicted.map(value => value.x)).toEqual([
      30,
      40,
    ]);
    expect(
      replaceStudioCanonicalStrokePredictedSuffixV2(source, [
        sample("authoritative", 3),
      ]),
    ).toEqual({ ok: false, reason: "invalid-sample", sampleIndex: 0 });
  });

  it("enforces the predicted sample budget before a curve planner can allocate", () => {
    const predicted = Array.from(
      { length: STUDIO_CANONICAL_STROKE_V2_BUDGETS.maxPredictedSamples + 1 },
      (_, index) => sample("predicted", index + 2),
    );
    const result = normalizeStudioCanonicalStrokeV2({
      strokeId: "budget",
      timeOriginMilliseconds: 1_000,
      samples: [sample("authoritative", 1), ...predicted],
    });

    expect(result).toEqual({ ok: false, reason: "budget-exceeded" });
  });
});
