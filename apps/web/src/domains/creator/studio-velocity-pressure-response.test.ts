import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_VELOCITY_PRESSURE_CONFIG,
  STUDIO_VELOCITY_PRESSURE_RESPONSE_VERSION,
  advanceStudioVelocityPressure,
  createStudioVelocityPressureState,
  normalizeStudioVelocityPressureConfig,
  resolveStudioVelocityPressureSeries,
  type StudioVelocityPressurePointerSample,
} from "./studio-velocity-pressure-response";

const points = (
  distances: readonly number[],
  elapsedMs = 10,
  pointerType = "mouse"
): StudioVelocityPressurePointerSample[] => {
  let x = 0;
  let timeMs = 0;
  return [
    { x, y: 0, timeMs, pointerType },
    ...distances.map((distance) => {
      x += distance;
      timeMs += elapsedMs;
      return { x, y: 0, timeMs, pointerType };
    }),
  ];
};

describe("studio velocity pressure response", () => {
  it("creates a finite immutable versioned initial state", () => {
    const state = createStudioVelocityPressureState();
    expect(state).toEqual({
      version: STUDIO_VELOCITY_PRESSURE_RESPONSE_VERSION,
      sequence: 0,
      hasPosition: false,
      x: 0,
      y: 0,
      observedTimeMs: null,
      filteredVelocity: 0,
      filteredPressure: DEFAULT_STUDIO_VELOCITY_PRESSURE_CONFIG.nominalPressure,
    });
    expect(Object.isFrozen(state)).toBe(true);
  });

  it("normalizes malformed tuning into a bounded deterministic contract", () => {
    const normalized = normalizeStudioVelocityPressureConfig({
      nominalPressure: Number.NaN,
      velocitySensitivity: 50,
      velocityForMinimumPressure: -1,
      maximumVelocity: 0,
      velocitySmoothingMs: -10,
      minimumWidthRatio: Number.POSITIVE_INFINITY,
      pressureExponent: 99,
      penPolicy: "velocity-modulated",
      penVelocityBlend: -1,
      minimumElapsedMs: 5,
      maximumElapsedMs: 1,
      duplicateTimestampElapsedMs: 500,
      syntheticElapsedMs: 0,
      maximumDistancePx: -3,
    });

    expect(normalized).toEqual({
      ...DEFAULT_STUDIO_VELOCITY_PRESSURE_CONFIG,
      velocitySensitivity: 1,
      velocityForMinimumPressure:
        DEFAULT_STUDIO_VELOCITY_PRESSURE_CONFIG.velocityForMinimumPressure,
      maximumVelocity: DEFAULT_STUDIO_VELOCITY_PRESSURE_CONFIG.maximumVelocity,
      velocitySmoothingMs: 0,
      pressureExponent: 8,
      penPolicy: "velocity-modulated",
      penVelocityBlend: 0,
      minimumElapsedMs: 5,
      maximumElapsedMs: 5,
      duplicateTimestampElapsedMs: 5,
      syntheticElapsedMs: 5,
      maximumDistancePx:
        DEFAULT_STUDIO_VELOCITY_PRESSURE_CONFIG.maximumDistancePx,
    });
    expect(Object.isFrozen(normalized)).toBe(true);
  });

  it("uses nominal pressure for first mouse contact without looking ahead", () => {
    const prefix = resolveStudioVelocityPressureSeries([
      { x: 2, y: 3, timeMs: 10, pointerType: "mouse" },
    ]);
    const extended = resolveStudioVelocityPressureSeries([
      { x: 2, y: 3, timeMs: 10, pointerType: "mouse" },
      { x: 102, y: 3, timeMs: 11, pointerType: "mouse" },
    ]);

    expect(prefix.samples[0]).toEqual(extended.samples[0]);
    expect(prefix.samples[0]?.source).toBe("nominal");
    expect(prefix.samples[0]?.pressure).toBe(
      DEFAULT_STUDIO_VELOCITY_PRESSURE_CONFIG.nominalPressure
    );
    expect(prefix.samples[0]?.rawVelocity).toBe(0);
  });

  it("makes slow mouse/touch input thicker than fast input deterministically", () => {
    const config = { velocitySmoothingMs: 0 };
    const slowMouse = resolveStudioVelocityPressureSeries(
      points([1, 1], 16, "mouse"),
      config
    );
    const fastMouse = resolveStudioVelocityPressureSeries(
      points([24, 24], 8, "mouse"),
      config
    );
    const conventionalTouch = points([24, 24], 8, "touch").map((sample) => ({
      ...sample,
      pressure: 0.5,
    }));
    const fastTouch = resolveStudioVelocityPressureSeries(
      conventionalTouch,
      config
    );

    expect(slowMouse.samples.at(-1)!.pressure).toBeGreaterThan(
      fastMouse.samples.at(-1)!.pressure
    );
    expect(fastTouch.samples.map(({ pressure }) => pressure)).toEqual(
      fastMouse.samples.map(({ pressure }) => pressure)
    );
    expect(fastTouch.samples.slice(1).every(({ source }) => source === "velocity"))
      .toBe(true);
    expect(resolveStudioVelocityPressureSeries(conventionalTouch, config))
      .toEqual(fastTouch);
  });

  it("low-pass filters velocity causally and keeps it beneath the configured ceiling", () => {
    const result = resolveStudioVelocityPressureSeries(
      points([0, 1000, 0, 0], 1),
      {
        maximumVelocity: 3,
        velocityForMinimumPressure: 2,
        velocitySmoothingMs: 10,
      }
    );
    const samples = result.samples;

    expect(samples[2]!.rawVelocity).toBe(3);
    expect(samples[2]!.filteredVelocity).toBeGreaterThan(0);
    expect(samples[2]!.filteredVelocity).toBeLessThan(3);
    expect(samples[3]!.filteredVelocity).toBeLessThan(
      samples[2]!.filteredVelocity
    );
    expect(samples.every(({ filteredVelocity }) =>
      filteredVelocity >= 0 && filteredVelocity <= 3
    )).toBe(true);
  });

  it("eases the first simulated-pressure move from nominal instead of jumping to full width", () => {
    const first = advanceStudioVelocityPressure(
      null,
      { x: 0, y: 0, timeMs: 0, pointerType: "mouse" },
      {
        nominalPressure: 0.58,
        velocitySensitivity: 0.435,
        velocityForMinimumPressure: 1.35,
        velocitySmoothingMs: 12,
      }
    );
    const second = advanceStudioVelocityPressure(
      first.state,
      { x: 1, y: 0, timeMs: 5, pointerType: "mouse" },
      {
        nominalPressure: 0.58,
        velocitySensitivity: 0.435,
        velocityForMinimumPressure: 1.35,
        velocitySmoothingMs: 12,
      }
    );

    expect(first.sample.pressure).toBe(0.58);
    expect(second.sample.pressure).toBeGreaterThan(first.sample.pressure);
    expect(second.sample.pressure).toBeLessThanOrEqual(first.sample.pressure * 1.15);
    expect(second.state.filteredPressure).toBe(second.sample.pressure);
  });

  it("supports zero smoothing as a transparent instantaneous velocity response", () => {
    const result = resolveStudioVelocityPressureSeries(points([8, 2], 4), {
      velocitySmoothingMs: 0,
      maximumVelocity: 10,
    });
    expect(result.samples[1]!.rawVelocity).toBe(2);
    expect(result.samples[1]!.filteredVelocity).toBe(2);
    expect(result.samples[2]!.rawVelocity).toBe(0.5);
    expect(result.samples[2]!.filteredVelocity).toBe(0.5);
  });

  it("normalizes duplicate, regressed and missing timestamps without non-finite output", () => {
    const result = resolveStudioVelocityPressureSeries(
      [
        { x: 0, y: 0, timeMs: 100, pointerType: "mouse" },
        { x: 8, y: 0, timeMs: 100, pointerType: "mouse" },
        { x: 16, y: 0, timeMs: 90, pointerType: "mouse" },
        { x: 24, y: 0, timeMs: Number.NaN, pointerType: "mouse" },
        { x: 32, y: 0, timeMs: 120, pointerType: "mouse" },
      ],
      {
        duplicateTimestampElapsedMs: 2,
        syntheticElapsedMs: 8,
        velocitySmoothingMs: 0,
      }
    );

    expect(result.samples.map(({ timestampKind }) => timestampKind)).toEqual([
      "initial",
      "duplicate",
      "regressed",
      "synthetic",
      "observed",
    ]);
    expect(result.samples.map(({ elapsedMs }) => elapsedMs)).toEqual([
      0,
      2,
      2,
      8,
      30,
    ]);
    for (const sample of result.samples) {
      for (const value of [
        sample.x,
        sample.y,
        sample.distancePx,
        sample.elapsedMs,
        sample.rawVelocity,
        sample.filteredVelocity,
        sample.pressure,
        sample.widthRatio,
      ]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it("falls back to the previous position and bounds overflowing distance", () => {
    const source = [
      { x: 2, y: 4, timeMs: 0, pointerType: "mouse" },
      {
        x: Number.NaN,
        y: Number.POSITIVE_INFINITY,
        timeMs: 10,
        pointerType: "mouse",
      },
      { x: Number.MAX_VALUE, y: 4, timeMs: 20, pointerType: "mouse" },
    ];
    const snapshot = source.map((sample) => ({ ...sample }));
    const result = resolveStudioVelocityPressureSeries(source, {
      maximumDistancePx: 50,
      maximumVelocity: 4,
      velocitySmoothingMs: 0,
    });

    expect(result.samples[1]).toMatchObject({ x: 2, y: 4, distancePx: 0 });
    expect(result.samples[2]).toMatchObject({
      distancePx: 50,
      rawVelocity: 4,
    });
    expect(source).toEqual(snapshot);
  });

  it("gives valid pen pressure full precedence by default while still tracking velocity", () => {
    const result = resolveStudioVelocityPressureSeries([
      { x: 0, y: 0, timeMs: 0, pointerType: "pen", pressure: 0.2 },
      { x: 100, y: 0, timeMs: 1, pointerType: "pen", pressure: 0.2 },
      { x: 101, y: 0, timeMs: 101, pointerType: "pen", pressure: 0.8 },
    ], {
      velocitySmoothingMs: 0,
      minimumWidthRatio: 0,
    });

    expect(result.samples.map(({ source }) => source)).toEqual([
      "hardware",
      "hardware",
      "hardware",
    ]);
    expect(result.samples.map(({ pressure }) => pressure)).toEqual([0.2, 0.2, 0.8]);
    expect(result.samples[1]!.filteredVelocity).toBeGreaterThan(
      result.samples[2]!.filteredVelocity
    );
  });

  it("optionally composes speed with pen pressure multiplicatively without replacing it", () => {
    const samples = [
      { x: 0, y: 0, timeMs: 0, pointerType: "pen", pressure: 0 },
      { x: 16, y: 0, timeMs: 8, pointerType: "pen", pressure: 0 },
      { x: 32, y: 0, timeMs: 16, pointerType: "pen", pressure: 0.25 },
      { x: 48, y: 0, timeMs: 24, pointerType: "pen", pressure: 0.75 },
    ];
    const result = resolveStudioVelocityPressureSeries(samples, {
      penPolicy: "velocity-modulated",
      penVelocityBlend: 0.5,
      velocitySensitivity: 0.8,
      velocityForMinimumPressure: 1,
      velocitySmoothingMs: 0,
      minimumWidthRatio: 0,
    });

    expect(result.samples[0]).toMatchObject({
      source: "hardware",
      hardwarePressure: 0,
      pressure: 0,
    });
    expect(result.samples[1]).toMatchObject({
      source: "hardware-velocity",
      hardwarePressure: 0,
      pressure: 0,
    });
    expect(result.samples[2]!.pressure).toBeLessThan(0.25);
    expect(result.samples[3]!.pressure).toBeLessThan(0.75);
    expect(result.samples[3]!.pressure).toBeGreaterThan(
      result.samples[2]!.pressure
    );
  });

  it("recognizes force-capable touch but treats conventional touch 0.5 as simulated", () => {
    const result = resolveStudioVelocityPressureSeries([
      { x: 0, y: 0, timeMs: 0, pointerType: "touch", pressure: 0.5 },
      { x: 1, y: 0, timeMs: 10, pointerType: "TOUCH", pressure: 0.3 },
      { x: 2, y: 0, timeMs: 20, pointerType: "touch", pressure: 2 },
    ]);

    expect(result.samples[0]).toMatchObject({
      source: "nominal",
      hardwarePressure: null,
    });
    expect(result.samples[1]).toMatchObject({
      source: "hardware",
      hardwarePressure: 0.3,
    });
    expect(result.samples[2]).toMatchObject({
      source: "velocity",
      hardwarePressure: null,
    });
  });

  it("keeps minimum width independent from canonical pressure and sensitivity", () => {
    const fast = resolveStudioVelocityPressureSeries(points([100], 1), {
      velocitySmoothingMs: 0,
      velocitySensitivity: 1,
      velocityForMinimumPressure: 0.1,
      minimumWidthRatio: 0.3,
    }).samples.at(-1)!;
    const insensitive = resolveStudioVelocityPressureSeries(points([100], 1), {
      velocitySmoothingMs: 0,
      velocitySensitivity: 0,
      velocityForMinimumPressure: 0.1,
      minimumWidthRatio: 0.3,
    }).samples.at(-1)!;

    expect(fast.pressure).toBe(0);
    expect(fast.widthRatio).toBe(0.3);
    expect(insensitive.pressure).toBe(1);
    expect(insensitive.widthRatio).toBe(1);
  });

  it("applies the pressure exponent once after hardware/velocity composition", () => {
    const soft = resolveStudioVelocityPressureSeries([
      { x: 0, y: 0, timeMs: 0, pointerType: "pen", pressure: 0.25 },
    ], {
      pressureExponent: 0.5,
      minimumWidthRatio: 0,
    }).samples[0]!;
    const firm = resolveStudioVelocityPressureSeries([
      { x: 0, y: 0, timeMs: 0, pointerType: "pen", pressure: 0.25 },
    ], {
      pressureExponent: 2,
      minimumWidthRatio: 0,
    }).samples[0]!;

    expect(soft.pressure).toBe(0.5);
    expect(firm.pressure).toBe(0.0625);
    expect(soft.widthRatio).toBe(soft.pressure);
    expect(firm.widthRatio).toBe(firm.pressure);
  });

  it("has exact streaming/batch parity including final filter state", () => {
    const samples = [
      { x: 0, y: 0, timeMs: 0, pointerType: "mouse" },
      { x: 3, y: 4, timeMs: 8, pointerType: "mouse" },
      { x: 12, y: 4, timeMs: 16, pointerType: "mouse" },
      { x: 13, y: 7, timeMs: 32, pointerType: "mouse" },
    ] as const;
    const config = {
      velocitySmoothingMs: 9,
      velocitySensitivity: 0.77,
      minimumWidthRatio: 0.18,
    };
    let state = createStudioVelocityPressureState();
    const streamed = [];
    for (const sample of samples) {
      const transition = advanceStudioVelocityPressure(state, sample, config);
      state = transition.state;
      streamed.push(transition.sample);
    }
    const batched = resolveStudioVelocityPressureSeries(samples, config);

    expect(batched.samples).toEqual(streamed);
    expect(batched.state).toEqual(state);
    expect(Object.isFrozen(batched.state)).toBe(true);
    expect(Object.isFrozen(batched.samples)).toBe(true);
    expect(batched.samples.every(Object.isFrozen)).toBe(true);
  });

  it("clamps extreme native cadence and repairs malformed incoming state", () => {
    const malformedState = {
      version: STUDIO_VELOCITY_PRESSURE_RESPONSE_VERSION,
      sequence: Number.NaN,
      hasPosition: true,
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      observedTimeMs: Number.NaN,
      filteredVelocity: Number.POSITIVE_INFINITY,
      filteredPressure: Number.NaN,
    };
    const first = advanceStudioVelocityPressure(
      malformedState,
      { x: 5, y: 0, timeMs: 100, pointerType: "mouse" },
      {
        minimumElapsedMs: 2,
        maximumElapsedMs: 20,
        syntheticElapsedMs: 7,
        maximumVelocity: 4,
        velocitySmoothingMs: 0,
      }
    );
    const tinyDelta = advanceStudioVelocityPressure(
      first.state,
      { x: 9, y: 0, timeMs: 100.1, pointerType: "mouse" },
      {
        minimumElapsedMs: 2,
        maximumElapsedMs: 20,
        maximumVelocity: 4,
        velocitySmoothingMs: 0,
      }
    );
    const longPause = advanceStudioVelocityPressure(
      tinyDelta.state,
      { x: 13, y: 0, timeMs: 10_000, pointerType: "mouse" },
      {
        minimumElapsedMs: 2,
        maximumElapsedMs: 20,
        maximumVelocity: 4,
        velocitySmoothingMs: 0,
      }
    );

    expect(first.sample).toMatchObject({
      sequence: 1,
      distancePx: 5,
      elapsedMs: 7,
      timestampKind: "synthetic",
    });
    expect(tinyDelta.sample).toMatchObject({
      elapsedMs: 2,
      timestampKind: "observed",
      rawVelocity: 2,
    });
    expect(longPause.sample).toMatchObject({
      elapsedMs: 20,
      timestampKind: "observed",
      rawVelocity: 0.2,
    });
    expect(Object.values(longPause.state).every((value) =>
      typeof value !== "number" || Number.isFinite(value)
    )).toBe(true);
  });

  it("is prefix-stable when future samples are appended", () => {
    const prefix = points([2, 7, 3], 12);
    const first = resolveStudioVelocityPressureSeries(prefix);
    const extended = resolveStudioVelocityPressureSeries([
      ...prefix,
      { x: 1000, y: 500, timeMs: 49, pointerType: "mouse" },
    ]);

    expect(extended.samples.slice(0, first.samples.length)).toEqual(first.samples);
    expect(extended.state.sequence).toBe(first.state.sequence + 1);
  });
});
