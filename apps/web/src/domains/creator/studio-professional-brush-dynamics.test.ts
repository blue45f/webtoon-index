import { describe, expect, it } from "vitest";

import {
  evaluateStudioProfessionalBrushResponseCurve,
  parseStudioProfessionalBrushDynamicsPlan,
  resolveStudioProfessionalBrushDynamics,
  type StudioProfessionalBrushChannelName,
  type StudioProfessionalBrushDynamicsPlan,
  type StudioProfessionalBrushMapping,
} from "./studio-professional-brush-dynamics";

const identityCurve = {
  interpolation: "monotone-cubic",
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
} as const;

function mapping(
  source: StudioProfessionalBrushMapping["source"],
  outputMin: number,
  outputMax: number,
): StudioProfessionalBrushMapping {
  return {
    source,
    combine: "replace",
    outputMin,
    outputMax,
    curve: identityCurve,
  };
}

function makePlan(
  overrides: {
    readonly seed?: number;
    readonly channelMappings?: Partial<
      Readonly<Record<StudioProfessionalBrushChannelName, readonly StudioProfessionalBrushMapping[]>>
    >;
    readonly spacing?: number;
    readonly taper?: Partial<StudioProfessionalBrushDynamicsPlan["taper"]>;
    readonly stationary?: Partial<StudioProfessionalBrushDynamicsPlan["stationary"]>;
    readonly budgets?: Partial<StudioProfessionalBrushDynamicsPlan["budgets"]>;
  } = {},
): unknown {
  const channel = (
    base: number,
    min: number,
    max: number,
    name: StudioProfessionalBrushChannelName,
  ) => ({
    base,
    min,
    max,
    mappings: overrides.channelMappings?.[name] ?? [],
  });
  return {
    kind: "studio-professional-brush-dynamics",
    version: 1,
    planId: "clean-room-dynamics",
    revision: 1,
    seed: overrides.seed ?? 0x1234_5678,
    units: {
      size: "document-css-px",
      opacity: "unit-interval",
      flow: "unit-interval",
      spacing: "document-css-px",
      angle: "radians",
      roundness: "unit-interval",
      scatter: "document-css-px",
      textureDepth: "unit-interval",
    },
    clock: {
      timeUnit: "milliseconds",
      tickMilliseconds: 1,
    },
    budgets: {
      maxSamples: overrides.budgets?.maxSamples ?? 1_024,
      maxEvents: overrides.budgets?.maxEvents ?? 16_384,
      maxMappings: overrides.budgets?.maxMappings ?? 64,
      maxCurvePoints: overrides.budgets?.maxCurvePoints ?? 64,
      maxStationaryEventsPerGap:
        overrides.budgets?.maxStationaryEventsPerGap ?? 1_024,
    },
    velocity: {
      normalizationPixelsPerMillisecond: 1,
      smoothingTimeMilliseconds: 1,
      initialPixelsPerMillisecond: 0,
      maximumPixelsPerMillisecond: 100,
    },
    taper: {
      start: overrides.taper?.start ?? { mode: "stroke-percentage", value: 0 },
      end: overrides.taper?.end ?? { mode: "stroke-percentage", value: 0 },
      minimumSizeRatio: overrides.taper?.minimumSizeRatio ?? 0,
      minimumOpacityRatio: overrides.taper?.minimumOpacityRatio ?? 0,
      speedInfluence: overrides.taper?.speedInfluence ?? 0,
    },
    stationary: {
      mode: overrides.stationary?.mode ?? "disabled",
      intervalTicks: overrides.stationary?.intervalTicks ?? 2,
      movementEpsilonPixels: overrides.stationary?.movementEpsilonPixels ?? 0.01,
    },
    channels: {
      size: channel(10, 0.01, 512, "size"),
      opacity: channel(1, 0, 1, "opacity"),
      flow: channel(1, 0, 1, "flow"),
      spacing: channel(overrides.spacing ?? 10, 0.05, 512, "spacing"),
      angle: channel(0, -Math.PI * 2, Math.PI * 2, "angle"),
      roundness: channel(1, 0.01, 1, "roundness"),
      scatter: channel(0, 0, 512, "scatter"),
      textureDepth: channel(0, 0, 1, "textureDepth"),
    },
  };
}

function acceptedSample(
  sequence: number,
  timeTick: number,
  x: number,
  overrides: Partial<{
    y: number;
    pressure: number;
    tiltXDegrees: number;
    tiltYDegrees: number;
    tangentialPressure: number;
    twistDegrees: number;
  }> = {},
) {
  return {
    sequence,
    timeTick,
    x,
    y: overrides.y ?? 0,
    pressure: overrides.pressure ?? 0.5,
    tiltXDegrees: overrides.tiltXDegrees ?? 0,
    tiltYDegrees: overrides.tiltYDegrees ?? 0,
    tangentialPressure: overrides.tangentialPressure ?? 0,
    twistDegrees: overrides.twistDegrees ?? 0,
  };
}

function parsedPlan(input: unknown): StudioProfessionalBrushDynamicsPlan {
  const parsed = parseStudioProfessionalBrushDynamicsPlan(input);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.path);
  return parsed.plan;
}

describe("studio professional brush dynamics clean-room provider", () => {
  it("maps pressure, tilt, velocity, tangential pressure, twist, progress and random independently", () => {
    const plan = parsedPlan(makePlan({
      channelMappings: {
        size: [mapping("pressure", 1, 101)],
        opacity: [mapping("tilt", 0, 1)],
        flow: [mapping("velocity", 0, 1)],
        spacing: [mapping("tangential-pressure", 1, 11)],
        angle: [mapping("twist", 0, Math.PI * 2)],
        roundness: [mapping("progress", 0.01, 1)],
        scatter: [mapping("deterministic-random", 0, 100)],
        textureDepth: [mapping("pressure", 0, 1)],
      },
    }));
    const result = resolveStudioProfessionalBrushDynamics(plan, [
      acceptedSample(1, 0, 0, { pressure: 0, tangentialPressure: -1 }),
      acceptedSample(2, 10, 10, {
        pressure: 1,
        tiltXDegrees: 45,
        tangentialPressure: 1,
        twistDegrees: 180,
      }),
      acceptedSample(3, 20, 20, { pressure: 0.5 }),
    ]);

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    const middle = result.states[1]!;
    expect(middle.channels.size).toBe(101);
    expect(middle.sources.tilt).toBe(0.5);
    expect(middle.channels.opacity).toBe(0.5);
    expect(middle.sources.velocity).toBeGreaterThan(0.99);
    expect(middle.channels.flow).toBeGreaterThan(0.99);
    expect(middle.channels.spacing).toBe(11);
    expect(middle.channels.angle).toBe(Math.PI);
    expect(middle.channels.roundness).toBeCloseTo(0.505, 12);
    expect(middle.channels.textureDepth).toBe(1);
    expect(middle.channels.scatter).toBeGreaterThanOrEqual(0);
    expect(middle.channels.scatter).toBeLessThan(100);
  });

  it("uses a monotone cubic response without segment overshoot", () => {
    const curve = {
      interpolation: "monotone-cubic",
      points: [
        { x: 0, y: 0 },
        { x: 0.2, y: 0.72 },
        { x: 0.7, y: 0.8 },
        { x: 1, y: 1 },
      ],
    } as const;
    let previous = -1;
    for (let step = 0; step <= 1_000; step += 1) {
      const x = step / 1_000;
      const y = evaluateStudioProfessionalBrushResponseCurve(curve, x);
      expect(y).toBeGreaterThanOrEqual(previous);
      const segment = curve.points.findIndex((point) => point.x >= x);
      const rightIndex = Math.max(1, segment);
      expect(y).toBeGreaterThanOrEqual(curve.points[rightIndex - 1]!.y);
      expect(y).toBeLessThanOrEqual(curve.points[rightIndex]!.y);
      previous = y;
    }
  });

  it("applies closed start/end taper by percentage and preserves the middle body", () => {
    const plan = parsedPlan(makePlan({
      spacing: 100,
      taper: {
        start: { mode: "stroke-percentage", value: 0.25 },
        end: { mode: "stroke-percentage", value: 0.25 },
        minimumSizeRatio: 0.1,
        minimumOpacityRatio: 0.2,
        speedInfluence: 0.75,
      },
    }));
    const result = resolveStudioProfessionalBrushDynamics(plan, [
      acceptedSample(1, 0, 0),
      acceptedSample(2, 50, 50),
      acceptedSample(3, 100, 100),
    ]);

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.states[0]!.channels.size).toBe(1);
    expect(result.states[0]!.channels.opacity).toBe(0.2);
    expect(result.states[1]!.channels.size).toBe(10);
    expect(result.states[1]!.channels.opacity).toBe(1);
    expect(result.states[2]!.channels.size).toBe(1);
    expect(result.states[2]!.channels.opacity).toBe(0.2);
  });

  it("supports physical-length taper independently at each tip", () => {
    const plan = parsedPlan(makePlan({
      taper: {
        start: { mode: "length-pixels", value: 20 },
        end: { mode: "length-pixels", value: 10 },
        minimumSizeRatio: 0,
        minimumOpacityRatio: 0,
        speedInfluence: 0,
      },
    }));
    const result = resolveStudioProfessionalBrushDynamics(plan, [
      acceptedSample(1, 0, 0),
      acceptedSample(2, 10, 10),
      acceptedSample(3, 50, 50),
      acceptedSample(4, 95, 95),
      acceptedSample(5, 100, 100),
    ]);

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.states[1]!.channels.size).toBeCloseTo(5, 12);
    expect(result.states[2]!.channels.size).toBe(10);
    expect(result.states[3]!.channels.size).toBeCloseTo(5, 12);
  });

  it("emits fixed-clock stationary deposits during a pause without animation-frame time", () => {
    const plan = parsedPlan(makePlan({
      stationary: {
        mode: "continuous",
        intervalTicks: 2,
        movementEpsilonPixels: 0.01,
      },
    }));
    const result = resolveStudioProfessionalBrushDynamics(plan, [
      acceptedSample(1, 0, 12),
      acceptedSample(2, 10, 12),
    ]);

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.depositions.map((event) => event.timeTick)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(result.depositions.map((event) => event.cause)).toEqual([
      "initial",
      "stationary",
      "stationary",
      "stationary",
      "stationary",
      "stationary",
    ]);
    expect(result.depositions.every((event) => event.x === 12)).toBe(true);
  });

  it("replays bit-for-bit and changes random streams when the explicit seed changes", () => {
    const samples = [
      acceptedSample(10, 0, 0),
      acceptedSample(20, 20, 20),
      acceptedSample(30, 40, 40),
    ];
    const randomMapping = {
      channelMappings: {
        scatter: [mapping("deterministic-random", 0, 100)],
      },
    } as const;
    const firstPlan = parsedPlan(makePlan(randomMapping));
    const sameA = resolveStudioProfessionalBrushDynamics(firstPlan, samples);
    const sameB = resolveStudioProfessionalBrushDynamics(firstPlan, samples);
    const other = resolveStudioProfessionalBrushDynamics(
      parsedPlan(makePlan({ ...randomMapping, seed: 0x8765_4321 })),
      samples,
    );

    expect(sameA).toEqual(sameB);
    expect(JSON.stringify(sameA)).toBe(JSON.stringify(sameB));
    expect(sameA.status).toBe("resolved");
    expect(other.status).toBe("resolved");
    if (sameA.status !== "resolved" || other.status !== "resolved") return;
    expect(sameA.states.map((state) => state.channels.scatter)).not.toEqual(
      other.states.map((state) => state.channels.scatter),
    );
    expect(sameA.depositions.map((event) => event.randomUint32)).not.toEqual(
      other.depositions.map((event) => event.randomUint32),
    );
  });

  it("fails closed when sample or deposition budgets are exhausted", () => {
    const sampleLimited = parsedPlan(makePlan({ budgets: { maxSamples: 2 } }));
    expect(resolveStudioProfessionalBrushDynamics(sampleLimited, [
      acceptedSample(1, 0, 0),
      acceptedSample(2, 1, 1),
      acceptedSample(3, 2, 2),
    ])).toMatchObject({ status: "rejected", reason: "budget-exceeded" });

    const eventLimited = parsedPlan(makePlan({
      spacing: 0.05,
      budgets: { maxEvents: 3 },
    }));
    expect(resolveStudioProfessionalBrushDynamics(eventLimited, [
      acceptedSample(1, 0, 0),
      acceptedSample(2, 10, 10),
    ])).toMatchObject({ status: "rejected", reason: "budget-exceeded" });
  });

  it("rejects unknown fields and accessors without executing hostile getters", () => {
    const withUnknown = {
      ...(makePlan() as Record<string, unknown>),
      vendorExtension: true,
    };
    expect(parseStudioProfessionalBrushDynamicsPlan(withUnknown)).toEqual({
      ok: false,
      reason: "unknown-field",
      path: "$.vendorExtension",
    });

    let getterReads = 0;
    const hostile = makePlan() as Record<string, unknown>;
    Object.defineProperty(hostile, "seed", {
      enumerable: true,
      get() {
        getterReads += 1;
        return 1;
      },
    });
    expect(parseStudioProfessionalBrushDynamicsPlan(hostile)).toEqual({
      ok: false,
      reason: "not-plain-data",
      path: "$.seed",
    });
    expect(getterReads).toBe(0);
  });

  it("requires exact physical units for every output channel", () => {
    const missingUnits = makePlan() as Record<string, unknown>;
    delete missingUnits.units;
    expect(parseStudioProfessionalBrushDynamicsPlan(missingUnits)).toEqual({
      ok: false,
      reason: "invalid-field",
      path: "$.units",
    });

    const wrongAngle = makePlan() as Record<string, unknown>;
    wrongAngle.units = {
      ...(wrongAngle.units as Record<string, unknown>),
      angle: "degrees",
    };
    expect(parseStudioProfessionalBrushDynamicsPlan(wrongAngle)).toEqual({
      ok: false,
      reason: "invalid-field",
      path: "$.units",
    });
  });

  it("deep-freezes detached canonical plans and ignores later caller mutation", () => {
    const candidate = makePlan() as StudioProfessionalBrushDynamicsPlan;
    const parsed = parseStudioProfessionalBrushDynamicsPlan(candidate);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.isFrozen(parsed.plan)).toBe(true);
    expect(Object.isFrozen(parsed.plan.channels.size.mappings)).toBe(true);
    expect(parsed.plan).not.toBe(candidate);
  });

  it("cooperatively cancels bounded replay work", () => {
    const plan = parsedPlan(makePlan({ spacing: 0.1 }));
    let gates = 0;
    const result = resolveStudioProfessionalBrushDynamics(
      plan,
      [
        acceptedSample(1, 0, 0),
        acceptedSample(2, 100, 100),
      ],
      {
        shouldCancel: () => {
          gates += 1;
          return gates === 8;
        },
      },
    );

    expect(result.status).toBe("cancelled");
    if (result.status !== "cancelled") return;
    expect(result.emittedEvents).toBeGreaterThan(0);
    expect(result.emittedEvents).toBeLessThan(plan.budgets.maxEvents);
  });

  it("honors an already-aborted execution signal before doing replay work", () => {
    const controller = new AbortController();
    controller.abort("superseded");
    const result = resolveStudioProfessionalBrushDynamics(
      parsedPlan(makePlan()),
      [acceptedSample(1, 0, 0)],
      { signal: controller.signal },
    );

    expect(result).toEqual({
      status: "cancelled",
      processedSamples: 0,
      emittedEvents: 0,
    });
  });
});
