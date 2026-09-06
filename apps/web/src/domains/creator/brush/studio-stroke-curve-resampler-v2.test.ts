import { describe, expect, it } from "vitest";

import {
  normalizeStudioCanonicalStrokeV2,
  replaceStudioCanonicalStrokePredictedSuffixV2,
  type StudioCanonicalStrokeSampleCandidateV2,
  type StudioCanonicalStrokeV2,
} from "../studio-canonical-stroke-v2";

import {
  planStudioStrokeCurveV2,
  type StudioStrokeCurvePlanV2,
  type StudioStrokeCurveStationV2,
} from "./studio-stroke-curve-resampler-v2";

function sample(
  sequence: number,
  x: number,
  y: number,
  timeMilliseconds: number,
  overrides: Partial<StudioCanonicalStrokeSampleCandidateV2> = {},
): StudioCanonicalStrokeSampleCandidateV2 {
  return {
    role: "authoritative",
    sequence,
    sourceTimeMilliseconds: 1_000 + timeMilliseconds,
    x,
    y,
    pressure: 0.2 + sequence * 0.01,
    tangentialPressure: -0.4 + sequence * 0.005,
    tiltX: -20 + sequence * 0.2,
    tiltY: 15 - sequence * 0.1,
    twist: 350,
    pointerId: 3,
    pointerType: "pen",
    button: -1,
    buttons: 1,
    flags: 4,
    ...overrides,
  };
}

function strokeFrom(
  samples: readonly StudioCanonicalStrokeSampleCandidateV2[],
): StudioCanonicalStrokeV2 {
  const result = normalizeStudioCanonicalStrokeV2({
    strokeId: "curve-v2",
    timeOriginMilliseconds: 1_000,
    samples,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

function plan(
  stroke: StudioCanonicalStrokeV2,
  overrides: Parameters<typeof planStudioStrokeCurveV2>[1] = { spacing: 2 },
): StudioStrokeCurvePlanV2 {
  const result = planStudioStrokeCurveV2(stroke, {
    curvatureStrength: 1.2,
    minimumSpacingRatio: 0.3,
    sealAuthoritativeTail: true,
    ...overrides,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

function stations(value: StudioStrokeCurvePlanV2): readonly StudioStrokeCurveStationV2[] {
  return [...value.settledStations, ...value.previewStations];
}

function pointSegmentDistance(
  point: StudioStrokeCurveStationV2,
  start: StudioStrokeCurveStationV2,
  end: StudioStrokeCurveStationV2,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared === 0
    ? 0
    : Math.min(
        1,
        Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
      );
  return Math.hypot(
    point.x - (start.x + dx * amount),
    point.y - (start.y + dy * amount),
  );
}

function maximumDistanceToPath(
  source: readonly StudioStrokeCurveStationV2[],
  target: readonly StudioStrokeCurveStationV2[],
): number {
  let maximum = 0;
  for (const point of source) {
    let minimum = Number.POSITIVE_INFINITY;
    for (let index = 1; index < target.length; index += 1) {
      minimum = Math.min(
        minimum,
        pointSegmentDistance(point, target[index - 1]!, target[index]!),
      );
    }
    maximum = Math.max(maximum, minimum);
  }
  return maximum;
}

function sampledCurve(hz: number): StudioCanonicalStrokeV2 {
  const durationMilliseconds = 1_000;
  const count = hz + 1;
  return strokeFrom(Array.from({ length: count }, (_, index) => {
    const progress = index / (count - 1);
    return sample(
      index,
      10 + progress * 120,
      50 + Math.sin(progress * Math.PI * 1.5) * 30,
      progress * durationMilliseconds,
      {
        pressure: 0.35 + Math.sin(progress * Math.PI) * 0.55,
        twist: (350 + progress * 20) % 360,
      },
    );
  }));
}

describe("Studio stroke curve resampler v2", () => {
  it("converges to the same geometry for 60, 120 and 240Hz source cadence", () => {
    const at60 = stations(plan(sampledCurve(60)));
    const at120 = stations(plan(sampledCurve(120)));
    const at240 = stations(plan(sampledCurve(240)));

    expect(maximumDistanceToPath(at60, at240)).toBeLessThan(0.18);
    expect(maximumDistanceToPath(at120, at240)).toBeLessThan(0.08);
    expect(Math.abs(at60.at(-1)!.x - at240.at(-1)!.x)).toBeLessThan(1e-9);
    expect(Math.abs(at60.at(-1)!.y - at240.at(-1)!.y)).toBeLessThan(1e-9);
  });

  it("keeps settled geometry prefix-identical while replacing a predicted tail", () => {
    const authoritative = [
      sample(1, 0, 0, 0),
      sample(2, 20, 10, 10),
      sample(3, 40, 12, 20),
      sample(4, 60, 24, 30),
    ];
    const firstStroke = strokeFrom([
      ...authoritative,
      sample(5, 76, 26, 40, { role: "predicted" }),
    ]);
    const first = plan(firstStroke, {
      spacing: 2,
      sealAuthoritativeTail: false,
    });
    const replacement = replaceStudioCanonicalStrokePredictedSuffixV2(firstStroke, [
      sample(5, 74, 40, 40, { role: "predicted" }),
      sample(6, 90, 48, 50, { role: "predicted" }),
    ]);
    if (!replacement.ok) throw new Error(replacement.reason);
    const second = plan(replacement.value, {
      spacing: 2,
      sealAuthoritativeTail: false,
    });

    expect(second.segments.slice(0, first.settledSegmentCount)).toEqual(
      first.segments.slice(0, first.settledSegmentCount),
    );
    expect(second.settledStations).toEqual(first.settledStations);
    expect(second.previewStations).not.toEqual(first.previewStations);
  });

  it("preserves sharp corners and keeps adjacent smooth-segment tangents continuous", () => {
    const corner = plan(strokeFrom([
      sample(1, 0, 0, 0),
      sample(2, 20, 0, 10),
      sample(3, 20, 20, 20),
      sample(4, 40, 20, 30),
    ]), {
      spacing: 1,
      cornerThresholdDegrees: 55,
    });
    expect(corner.segments[0]!.c2).toEqual(corner.segments[0]!.p2);
    expect(corner.segments[1]!.c1).toEqual(corner.segments[1]!.p1);
    expect(
      stations(corner).some(value => Math.hypot(value.x - 20, value.y) < 1e-9),
    ).toBe(true);

    const smooth = plan(strokeFrom([
      sample(1, 0, 0, 0),
      sample(2, 20, 6, 10),
      sample(3, 40, 16, 20),
      sample(4, 60, 30, 30),
    ]));
    const left = smooth.segments[0]!;
    const right = smooth.segments[1]!;
    const leftTangent = {
      x: left.p2.x - left.c2.x,
      y: left.p2.y - left.c2.y,
    };
    const rightTangent = {
      x: right.c1.x - right.p1.x,
      y: right.c1.y - right.p1.y,
    };
    const cosine = (
      leftTangent.x * rightTangent.x + leftTangent.y * rightTangent.y
    ) / (
      Math.hypot(leftTangent.x, leftTangent.y)
      * Math.hypot(rightTangent.x, rightTangent.y)
    );
    expect(cosine).toBeGreaterThan(0.999_999);
  });

  it("interpolates pressure, stylus channels, time and shortest-arc twist", () => {
    const curve = plan(strokeFrom([
      sample(1, 0, 0, 0, {
        pressure: 0,
        tangentialPressure: -1,
        tiltX: -40,
        tiltY: 20,
        twist: 350,
      }),
      sample(2, 10, 0, 10, {
        pressure: 1,
        tangentialPressure: 1,
        tiltX: 40,
        tiltY: -20,
        twist: 10,
        flags: 32,
      }),
    ]), {
      spacing: 5,
      curvatureStrength: 0,
    });
    const middle = stations(curve).find(value => Math.abs(value.x - 5) < 1e-6)!;

    expect(middle).toMatchObject({
      pressure: 0.5,
      tangentialPressure: 0,
      tiltX: 0,
      tiltY: 0,
      timeMilliseconds: 5,
      sourceTimeMilliseconds: 1_005,
      flags: 32,
    });
    expect(Math.min(middle.twist, Math.abs(middle.twist - 360))).toBeLessThan(1e-9);
  });

  it("fails closed before exceeding the station budget", () => {
    const result = planStudioStrokeCurveV2(strokeFrom([
      sample(1, 0, 0, 0),
      sample(2, 100, 0, 10),
    ]), {
      spacing: 0.1,
      maximumStations: 4,
      sealAuthoritativeTail: true,
    });

    expect(result).toEqual({ ok: false, reason: "budget-exceeded" });
  });
});
