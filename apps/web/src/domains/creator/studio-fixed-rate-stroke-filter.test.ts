import { describe, expect, it } from "vitest";

import {
  FIXED_RATE_STROKE_FILTER_TICK_MS,
  FIXED_RATE_STROKE_INTERPOLATION_MAX_MS,
  FIXED_RATE_STROKE_POSITION_QUANTUM,
  FIXED_RATE_STROKE_PRESSURE_STEPS,
  FIXED_RATE_STROKE_RELEASE_POSITION_EPSILON,
  FIXED_RATE_STROKE_RELEASE_PRESSURE_EPSILON,
  FIXED_RATE_STROKE_RELEASE_TILT_EPSILON,
  createFixedRateStrokeFilter,
  quantizeFixedRateStrokeSample,
  resolveFixedRateStrokeFilterParameters,
  transitionFixedRateStrokeFilter,
  type FixedRateStrokeFilteredSample,
  type FixedRateStrokeFilterState,
  type FixedRateStrokeRawSample,
} from "./studio-fixed-rate-stroke-filter";

function append(
  state: FixedRateStrokeFilterState,
  samples: readonly FixedRateStrokeRawSample[]
) {
  return transitionFixedRateStrokeFilter(state, { type: "append", samples });
}

function release(
  state: FixedRateStrokeFilterState,
  sample?: FixedRateStrokeRawSample
) {
  return transitionFixedRateStrokeFilter(state, { type: "release", sample });
}

function advance(state: FixedRateStrokeFilterState, timeStamp: number) {
  return transitionFixedRateStrokeFilter(state, { type: "advance", timeStamp });
}

function splitInto<T>(values: readonly T[], size: number): readonly (readonly T[])[] {
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    groups.push(values.slice(index, index + size));
  }
  return groups;
}

function runBatches(
  initial: FixedRateStrokeRawSample,
  batches: readonly (readonly FixedRateStrokeRawSample[])[],
  strength = 3.4
) {
  const started = createFixedRateStrokeFilter(initial, strength);
  let state = started.state;
  const emitted = [...started.emitted];
  for (const batch of batches) {
    const result = append(state, batch);
    state = result.state;
    emitted.push(...result.emitted);
  }
  const finished = release(state);
  emitted.push(...finished.emitted);
  return { state: finished.state, emitted, finished };
}

function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function fixturePoint(sample: FixedRateStrokeFilteredSample) {
  return {
    tick: sample.logicalTick,
    x: round(sample.x),
    y: round(sample.y),
    pressure: round(sample.pressure),
    tiltX: round(sample.tiltX),
    tiltY: round(sample.tiltY),
  };
}

function polylineLength(samples: readonly { readonly x: number; readonly y: number }[]): number {
  let length = 0;
  for (let index = 1; index < samples.length; index += 1) {
    length += Math.hypot(
      samples[index]!.x - samples[index - 1]!.x,
      samples[index]!.y - samples[index - 1]!.y
    );
  }
  return length;
}

function maximumPointDistance(
  left: readonly { readonly x: number; readonly y: number }[],
  right: readonly { readonly x: number; readonly y: number }[]
): number {
  expect(left).toHaveLength(right.length);
  let maximum = 0;
  for (let index = 0; index < left.length; index += 1) {
    maximum = Math.max(
      maximum,
      Math.hypot(
        left[index]!.x - right[index]!.x,
        left[index]!.y - right[index]!.y
      )
    );
  }
  return maximum;
}

function totalAbsoluteTurn(
  samples: readonly { readonly x: number; readonly y: number }[]
): number {
  let total = 0;
  for (let index = 1; index + 1 < samples.length; index += 1) {
    const ax = samples[index]!.x - samples[index - 1]!.x;
    const ay = samples[index]!.y - samples[index - 1]!.y;
    const bx = samples[index + 1]!.x - samples[index]!.x;
    const by = samples[index + 1]!.y - samples[index]!.y;
    const aLength = Math.hypot(ax, ay);
    const bLength = Math.hypot(bx, by);
    if (aLength <= Number.EPSILON || bLength <= Number.EPSILON) continue;
    const cosine = Math.min(1, Math.max(-1, (ax * bx + ay * by) / (aLength * bLength)));
    total += Math.acos(cosine);
  }
  return total;
}

function sampleTimes(
  durationMs: number,
  rateHz: number,
  cadencePattern: readonly number[] = [1]
): readonly number[] {
  const interval = 1_000 / rateHz;
  const times: number[] = [];
  let timeStamp = 0;
  let patternIndex = 0;
  while (timeStamp < durationMs) {
    timeStamp += interval * cadencePattern[patternIndex % cadencePattern.length]!;
    patternIndex += 1;
    times.push(Math.min(durationMs, timeStamp));
  }
  return times;
}

function runSampledPath(
  path: (timeStamp: number) => FixedRateStrokeRawSample,
  times: readonly number[],
  strength = 5
): readonly FixedRateStrokeFilteredSample[] {
  const durationMs = times.at(-1) ?? 0;
  const started = createFixedRateStrokeFilter(path(0), strength);
  let state = started.state;
  const emitted = [...started.emitted];
  for (const timeStamp of times) {
    const transition = append(state, [path(timeStamp)]);
    state = transition.state;
    emitted.push(...transition.emitted);
  }
  return emitted.filter((sample) => sample.timeStamp <= durationMs);
}

describe("fixed-rate stroke filter parameters", () => {
  it("maps strength 3.4 to the traced 40 response, 10 stages, and 0.6 alpha", () => {
    expect(resolveFixedRateStrokeFilterParameters(3.4)).toEqual({
      strength: 3.4,
      normalizedStrength: 0.33999999999999997,
      response: 40,
      stageCount: 10,
      alpha: 0.6,
    });
  });

  it("clamps strength, preserves the 20..80 stage response, and enforces the quality alpha floor", () => {
    expect(resolveFixedRateStrokeFilterParameters(-10)).toMatchObject({
      strength: 0,
      normalizedStrength: 0,
      response: 20,
      stageCount: 5,
      alpha: 0.8,
    });
    expect(resolveFixedRateStrokeFilterParameters(Number.NaN)).toEqual(
      resolveFixedRateStrokeFilterParameters(0)
    );
    expect(resolveFixedRateStrokeFilterParameters(99)).toMatchObject({
      strength: 10,
      normalizedStrength: 1,
      response: 80,
      stageCount: 20,
      alpha: 0.55,
    });
  });

  it("keeps the strength curve monotonic while capping its 90% response at 125ms", () => {
    const responseTimes = Array.from({ length: 11 }, (_, strength) => {
      const started = createFixedRateStrokeFilter({ x: 0, y: 0, timeStamp: 0 }, strength);
      let state = append(started.state, [{ x: 100, y: 0, timeStamp: 0.1 }]).state;
      let elapsedMs = 0;
      while (state.lastOutput.x < 90 && elapsedMs < 1_000) {
        elapsedMs += FIXED_RATE_STROKE_FILTER_TICK_MS;
        state = advance(state, elapsedMs).state;
      }
      return elapsedMs;
    });

    expect(responseTimes).toEqual([20, 30, 40, 55, 75, 85, 95, 105, 110, 120, 125]);
    expect(responseTimes.every((time, index) => (
      index === 0 || time >= responseTimes[index - 1]!
    ))).toBe(true);
    expect(responseTimes.at(-1)).toBeLessThanOrEqual(125);
  });

  it("uses the public cascade loop's ceiling for fractional stage counts", () => {
    const parameters = resolveFixedRateStrokeFilterParameters(0.43);
    expect(parameters.response).toBeCloseTo(22, 12);
    expect(parameters.response / 4).toBeCloseTo(5.5, 12);
    expect(parameters.stageCount).toBe(6);

    const nonTie = resolveFixedRateStrokeFilterParameters(0.265);
    expect(nonTie.response / 4).toBeCloseTo(5.25, 12);
    expect(nonTie.stageCount).toBe(6);
  });
});

describe("fixed-rate stroke input quantization", () => {
  it("quantizes position to 1/32, tilt to 1/16, and pressure to 1/1023", () => {
    const sample = quantizeFixedRateStrokeSample({
      x: 1.03,
      y: -1.04,
      pressure: 0.54321,
      tiltX: 12.34,
      tiltY: -7.78,
      timeStamp: 17.25,
    });
    expect(sample).toEqual({
      x: 1.03125,
      y: -1.03125,
      pressure: Math.round(0.54321 * FIXED_RATE_STROKE_PRESSURE_STEPS)
        / FIXED_RATE_STROKE_PRESSURE_STEPS,
      tiltX: 12.3125,
      tiltY: -7.75,
      timeStamp: 17.25,
    });
  });

  it("maps the 1/32 CSS pixel position grid into document space", () => {
    expect(quantizeFixedRateStrokeSample({
      x: 1.03,
      y: 1.03,
      positionScale: 2,
    })).toMatchObject({ x: 1.03125, y: 1.03125 });

    expect(quantizeFixedRateStrokeSample({
      x: 1.03,
      y: 1.03,
      positionScale: 0.25,
    })).toMatchObject({ x: 1, y: 1 });

    const legacy = quantizeFixedRateStrokeSample({ x: 1.03, y: -1.04 });
    expect(quantizeFixedRateStrokeSample({
      x: 1.03,
      y: -1.04,
      positionScale: 1,
    })).toEqual(legacy);
  });

  it("uses an absolute clamped scale and falls back to scale one for invalid values", () => {
    const legacy = quantizeFixedRateStrokeSample({ x: 1.03, y: -1.04 });
    for (const positionScale of [0, Number.NaN, Infinity, -Infinity]) {
      expect(quantizeFixedRateStrokeSample({
        x: 1.03,
        y: -1.04,
        positionScale,
      })).toEqual(legacy);
    }

    expect(quantizeFixedRateStrokeSample({
      x: 1.03,
      y: 1.03,
      positionScale: -2,
    })).toEqual(quantizeFixedRateStrokeSample({
      x: 1.03,
      y: 1.03,
      positionScale: 2,
    }));

    expect(quantizeFixedRateStrokeSample({
      x: 3.2,
      y: 3.2,
      positionScale: 0.001,
    })).toMatchObject({ x: 3.125, y: 3.125 });
    expect(quantizeFixedRateStrokeSample({
      x: 1 / 4_096,
      y: 1 / 4_096,
      positionScale: 100,
    })).toMatchObject({ x: 1 / 2_048, y: 1 / 2_048 });
  });

  it("clamps pressure and uses the previous finite channels for malformed samples", () => {
    const fallback = quantizeFixedRateStrokeSample({
      x: 7,
      y: 9,
      pressure: 0.75,
      tiltX: 3,
      tiltY: -4,
      timeStamp: 20,
    });
    expect(quantizeFixedRateStrokeSample({
      x: Number.NaN,
      y: Infinity,
      pressure: -5,
      tiltX: Number.NaN,
      tiltY: Infinity,
      timeStamp: Number.NaN,
    }, fallback)).toEqual({
      x: 7,
      y: 9,
      pressure: 0,
      tiltX: 3,
      tiltY: -4,
      timeStamp: 20,
    });
    expect(quantizeFixedRateStrokeSample({ x: 0, y: 0, pressure: 5 }).pressure).toBe(1);
  });

  it("preserves the public half-step rounding and 10-bit pressure boundary", () => {
    const halfStep = quantizeFixedRateStrokeSample({
      x: FIXED_RATE_STROKE_POSITION_QUANTUM / 2,
      y: -FIXED_RATE_STROKE_POSITION_QUANTUM / 2,
      pressure: 0.5,
    });
    expect(halfStep.x).toBe(FIXED_RATE_STROKE_POSITION_QUANTUM);
    expect(halfStep.y).toBe(0);
    expect(Object.is(halfStep.y, -0)).toBe(false);
    expect(halfStep.pressure).toBe(512 / FIXED_RATE_STROKE_PRESSURE_STEPS);

    const fallback = quantizeFixedRateStrokeSample({ x: 0, y: 0, pressure: 0.75 });
    expect(quantizeFixedRateStrokeSample({
      x: 1,
      y: 1,
      pressure: Number.NaN,
    }, fallback).pressure).toBe(fallback.pressure);
  });

  it("keeps a slow 240Hz micro-circle distinct and inside a sub-pixel arc-length budget", () => {
    const radius = 2;
    const source = Array.from({ length: 241 }, (_unused, index) => {
      const angle = (index / 240) * Math.PI * 2;
      return {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        timeStamp: (index * 1_000) / 240,
      };
    });
    const quantized = source.map((sample) => quantizeFixedRateStrokeSample(sample));
    const duplicateSteps = quantized.slice(1).filter((sample, index) => (
      sample.x === quantized[index]!.x && sample.y === quantized[index]!.y
    ));
    const maximumPositionError = source.reduce((maximum, sample, index) => Math.max(
      maximum,
      Math.hypot(
        sample.x - quantized[index]!.x,
        sample.y - quantized[index]!.y
      )
    ), 0);
    const arcLengthRatio = polylineLength(quantized) / polylineLength(source);

    expect(duplicateSteps).toHaveLength(0);
    expect(maximumPositionError)
      .toBeLessThanOrEqual(Math.SQRT2 * FIXED_RATE_STROKE_POSITION_QUANTUM / 2);
    // Quantizing an already sub-pixel 2px-radius curve may add a little grid travel, but it must
    // not recreate the former 1/16-grid staircase (about 1.11x and 40 collapsed source steps).
    expect(arcLengthRatio).toBeGreaterThanOrEqual(0.99);
    expect(arcLengthRatio).toBeLessThanOrEqual(1.04);
  });
});

describe("fixed logical clock and piecewise-linear input", () => {
  it("evaluates a 5ms grid from the raw segment that closes each tick", () => {
    const started = createFixedRateStrokeFilter({ x: 0, y: 0, timeStamp: 0 }, 3.4);
    const first = append(started.state, [
      { x: 4, y: 0, timeStamp: 4 },
      { x: 7, y: 0, timeStamp: 7 },
      { x: 12, y: 0, timeStamp: 12 },
    ]);
    expect(first.emitted.map((sample) => ({
      tick: sample.logicalTick,
      timeStamp: sample.timeStamp,
      sourceTimeStamp: sample.sourceTimeStamp,
    }))).toEqual([
      { tick: 1, timeStamp: 5, sourceTimeStamp: 7 },
      { tick: 2, timeStamp: 10, sourceTimeStamp: 12 },
    ]);

    const second = append(first.state, [{ x: 16, y: 0, timeStamp: 16 }]);
    expect(second.emitted).toHaveLength(1);
    expect(second.emitted[0]).toMatchObject({
      logicalTick: 3,
      timeStamp: 15,
      sourceTimeStamp: 16,
    });
  });

  it("anchors the fixed grid and reconstructs a sparse finite segment without drift", () => {
    const started = createFixedRateStrokeFilter({ x: 0, y: 0, timeStamp: 10.25 }, 3.4);
    const result = append(started.state, [{ x: 20, y: 0, timeStamp: 36 }]);
    expect(result.emitted.map(({ logicalTick, timeStamp, sourceTimeStamp }) => ({
      logicalTick,
      timeStamp,
      sourceTimeStamp,
    }))).toEqual([
      { logicalTick: 1, timeStamp: 15.25, sourceTimeStamp: 36 },
      { logicalTick: 2, timeStamp: 20.25, sourceTimeStamp: 36 },
      { logicalTick: 3, timeStamp: 25.25, sourceTimeStamp: 36 },
      { logicalTick: 4, timeStamp: 30.25, sourceTimeStamp: 36 },
      { logicalTick: 5, timeStamp: 35.25, sourceTimeStamp: 36 },
    ]);
    expect(result.emitted.every((sample, index, samples) => (
      index === 0 || sample.x > samples[index - 1]!.x
    ))).toBe(true);
    expect(result.state.nextLogicalTick).toBe(6);

    const evaluated = advance(result.state, 40.25);
    expect(evaluated.emitted.map(({ logicalTick, timeStamp }) => ({
      logicalTick,
      timeStamp,
    }))).toEqual([{ logicalTick: 6, timeStamp: 40.25 }]);
  });

  it("advances a stationary clock by holding the latest eligible raw sample", () => {
    const started = createFixedRateStrokeFilter({ x: 0, y: 0, timeStamp: 0 }, 3.4);
    const received = append(started.state, [{ x: 20, y: 5, timeStamp: 4 }]);
    expect(received.emitted).toEqual([]);

    const settled = advance(received.state, 15);
    expect(settled.emitted.map((sample) => ({
      tick: sample.logicalTick,
      timeStamp: sample.timeStamp,
      sourceTimeStamp: sample.sourceTimeStamp,
    }))).toEqual([
      { tick: 1, timeStamp: 5, sourceTimeStamp: 4 },
      { tick: 2, timeStamp: 10, sourceTimeStamp: 4 },
      { tick: 3, timeStamp: 15, sourceTimeStamp: 4 },
    ]);
    expect(advance(settled.state, 14).emitted).toEqual([]);
  });

  it("publishes reconstructed sparse motion before its held frame suffix", () => {
    const started = createFixedRateStrokeFilter({ x: 0, y: 0, timeStamp: 0 }, 3.4);
    const sparseMove = append(started.state, [{ x: 50, y: 0, timeStamp: 50 }]);
    expect(sparseMove.emitted.map(({ logicalTick }) => logicalTick))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(sparseMove.emitted.every(({ sourceTimeStamp }) => sourceTimeStamp === 50)).toBe(true);

    const frame66 = advance(sparseMove.state, 66);
    const frame83 = advance(frame66.state, 83);
    const oneShot = advance(sparseMove.state, 83);

    expect(frame66.emitted.map(({ logicalTick }) => logicalTick)).toEqual([11, 12, 13]);
    expect([...frame66.emitted, ...frame83.emitted]).toEqual(oneShot.emitted);
    expect(frame83.state).toEqual(oneShot.state);
  });

  it("keeps an emitted prefix immutable when a late coalesced sample follows a frame watermark", () => {
    const started = createFixedRateStrokeFilter({ x: 0, y: 0, timeStamp: 0 }, 3.4);
    const early = append(started.state, [{ x: 10, y: 0, timeStamp: 4 }]);
    const presented = advance(early.state, 15);
    const prefix = structuredClone(presented.emitted);

    const late = append(presented.state, [{ x: 20, y: 5, timeStamp: 8 }]);
    const next = advance(late.state, 20);

    expect(presented.emitted).toEqual(prefix);
    expect(late.emitted).toEqual([]);
    expect(next.emitted).toHaveLength(1);
    expect(next.emitted[0]).toMatchObject({ logicalTick: 4, timeStamp: 20 });
    expect(new Set([...prefix, ...next.emitted].map(({ logicalTick }) => logicalTick)).size)
      .toBe(prefix.length + next.emitted.length);
  });

  it("bounds long background catch-up after the held cascade settles", () => {
    const started = createFixedRateStrokeFilter({ x: 0, y: 0, timeStamp: 0 }, 10);
    const moved = append(started.state, [{ x: 100, y: 20, timeStamp: 1 }]);
    const resumed = advance(moved.state, 10 * 60 * 1_000);

    expect(resumed.emitted.length).toBeLessThan(4_096);
    expect(resumed.state.nextLogicalTick).toBe(120_001);
    expect(resumed.endpoint.x).toBeCloseTo(100, 10);
    expect(resumed.endpoint.y).toBeCloseTo(20, 10);
  });

  it("bounds reconstruction work for one sample after a suspended-tab clock gap", () => {
    const started = createFixedRateStrokeFilter({ x: 0, y: 0, timeStamp: 0 }, 10);
    const resumed = append(started.state, [{
      x: 100,
      y: 20,
      pressure: 0.8,
      timeStamp: 10 * 60 * 1_000,
    }]);

    expect(resumed.emitted.length)
      .toBeLessThanOrEqual(Math.ceil(
        FIXED_RATE_STROKE_INTERPOLATION_MAX_MS / FIXED_RATE_STROKE_FILTER_TICK_MS
      ) + 1);
    expect(resumed.state.nextLogicalTick).toBe(120_001);
    expect(resumed.emitted.at(-1)).toMatchObject({
      logicalTick: 120_000,
      timeStamp: 10 * 60 * 1_000,
      sourceTimeStamp: 10 * 60 * 1_000,
    });
  });

  it("cascades x, y, pressure, and both tilt channels through every stage", () => {
    const started = createFixedRateStrokeFilter({
      x: 0,
      y: 0,
      pressure: 0,
      tiltX: 0,
      tiltY: 0,
      timeStamp: 0,
    }, 3.4);
    const heldStep = append(started.state, [{
      x: 10,
      y: 20,
      pressure: 1,
      tiltX: 16,
      tiltY: -8,
      timeStamp: 6,
    }]);
    const evaluated = append(heldStep.state, [{
      x: 10,
      y: 20,
      pressure: 1,
      tiltX: 16,
      tiltY: -8,
      timeStamp: 11,
    }]);

    expect(evaluated.state.stages).toHaveLength(10);
    expect(evaluated.state.stages[0]).toMatchObject({
      x: 8,
      y: 16,
      pressure: 0.8,
      tiltX: 12.8,
      tiltY: -6.4,
    });
    expect(evaluated.state.stages[1]?.x).toBeCloseTo(6, 12);
    expect(evaluated.endpoint.x).toBeCloseTo(0.2620200959999999, 12);
    expect(evaluated.endpoint.y).toBeCloseTo(0.5240401919999998, 12);
    expect(evaluated.endpoint.pressure).toBeCloseTo(0.026202009599999992, 12);
    expect(evaluated.endpoint.tiltX).toBeCloseTo(0.4192321535999999, 12);
    expect(evaluated.endpoint.tiltY).toBeCloseTo(-0.20961607679999994, 12);
  });
});

describe("deterministic event batching", () => {
  const initial = { x: 2, y: -1, pressure: 0.4, timeStamp: 0 } as const;
  const samples = Array.from({ length: 35 }, (_, index) => {
    const timeStamp = (index + 1) * 3.75;
    return {
      x: index * 2.125,
      y: Math.sin(index / 4) * 9,
      pressure: 0.2 + (index % 7) / 10,
      tiltX: index / 3,
      tiltY: -index / 5,
      timeStamp,
    };
  });

  it("produces the same append-only output when a batch is split arbitrarily", () => {
    const oneBatch = runBatches(initial, [samples]);
    const split = runBatches(initial, [
      samples.slice(0, 2),
      samples.slice(2, 11),
      samples.slice(11, 12),
      samples.slice(12, 29),
      samples.slice(29),
    ]);
    expect(split.emitted).toEqual(oneBatch.emitted);
    expect(split.state).toEqual(oneBatch.state);
  });

  it("keeps the single-sample hot path identical to one multi-sample transition", () => {
    const started = createFixedRateStrokeFilter(initial, 3.4);
    const together = append(started.state, samples);
    let state = started.state;
    const emitted: FixedRateStrokeFilteredSample[] = [];

    for (const sample of samples) {
      const result = append(state, [sample]);
      state = result.state;
      emitted.push(...result.emitted);
    }

    expect(emitted).toEqual(together.emitted);
    expect(state).toEqual(together.state);
  });

  it("lets the last equal-timestamp sample win even when duplicates cross batches", () => {
    const duplicateSamples = [
      { x: 4, y: 0, timeStamp: 4 },
      { x: 8, y: 1, timeStamp: 10 },
      { x: 10, y: 3, timeStamp: 10 },
      { x: 11, y: 5, timeStamp: 11 },
      { x: 20, y: 8, timeStamp: 20 },
    ];
    const together = runBatches(initial, [duplicateSamples]);
    const split = runBatches(initial, [
      duplicateSamples.slice(0, 2),
      duplicateSamples.slice(2, 3),
      duplicateSamples.slice(3),
    ]);
    expect(split.emitted).toEqual(together.emitted);
    // The first t=10 sample closes that tick; the later equal-time sample cannot revise it.
    expect(split.emitted.find((sample) => sample.timeStamp === 10)?.sourceTimeStamp).toBe(10);
  });

  it("uses the closing sample on an exact tick and the last equal-time sample on the next tick", () => {
    const started = createFixedRateStrokeFilter({ x: 0, y: 0, timeStamp: 0 }, 3.4);
    const atFour = append(started.state, [{ x: 4, y: 0, timeStamp: 4 }]);
    const atBoundary = append(atFour.state, [
      { x: 8, y: 0, timeStamp: 10 },
      { x: 10, y: 0, timeStamp: 10 },
    ]);
    const nextTick = advance(atBoundary.state, 15);

    expect(atBoundary.emitted.find(({ timeStamp }) => timeStamp === 10)?.sourceTimeStamp).toBe(10);
    expect(nextTick.emitted.find(({ timeStamp }) => timeStamp === 15)?.sourceTimeStamp).toBe(10);
    expect(nextTick.state.heldSample.x).toBe(10);
  });

  it("does not mutate a previously emitted prefix or prior state", () => {
    const started = createFixedRateStrokeFilter(initial, 3.4);
    const first = append(started.state, samples.slice(0, 12));
    const prefix = [...started.emitted, ...first.emitted];
    const prefixSnapshot = structuredClone(prefix);
    const stateSnapshot = structuredClone(first.state);

    const second = append(first.state, samples.slice(12));
    release(second.state);
    expect(prefix).toEqual(prefixSnapshot);
    expect(first.state).toEqual(stateSnapshot);

    const oneBatch = runBatches(initial, [samples]);
    const finished = release(second.state);
    expect([...prefix, ...second.emitted, ...finished.emitted]).toEqual(oneBatch.emitted);
  });

  it("is invariant to 60, 120, and 240Hz delivery batches of one 240Hz raw stream", () => {
    const raw240Hz = Array.from({ length: 72 }, (_, index) => {
      const timeStamp = ((index + 1) * 1_000) / 240;
      return {
        x: timeStamp * 0.8,
        y: Math.sin(timeStamp / 21) * 15,
        pressure: 0.55 + Math.sin(timeStamp / 37) * 0.25,
        tiltX: Math.sin(timeStamp / 43) * 35,
        tiltY: Math.cos(timeStamp / 51) * 20,
        timeStamp,
      };
    });
    const at60Hz = runBatches(initial, splitInto(raw240Hz, 4));
    const at120Hz = runBatches(initial, splitInto(raw240Hz, 2));
    const at240Hz = runBatches(initial, splitInto(raw240Hz, 1));
    expect(at60Hz.emitted).toEqual(at120Hz.emitted);
    expect(at60Hz.emitted).toEqual(at240Hz.emitted);
    expect(at60Hz.state).toEqual(at240Hz.state);
  });
});

describe("fixed-rate path fidelity and latency budgets", () => {
  const irregularCadence = [0.45, 1.55, 0.7, 1.25, 1.05] as const;
  const fixtures = [
    {
      name: "slow circle",
      durationMs: 1_200,
      path: (timeStamp: number): FixedRateStrokeRawSample => {
        const angle = (timeStamp / 1_200) * Math.PI * 2;
        return {
          x: Math.cos(angle) * 30,
          y: Math.sin(angle) * 30,
          pressure: 0.4 + (timeStamp / 1_200) * 0.3,
          timeStamp,
        };
      },
      regularDistanceBudget: 0.03,
    },
    {
      name: "fast S-curve",
      durationMs: 180,
      path: (timeStamp: number): FixedRateStrokeRawSample => {
        const progress = timeStamp / 180;
        return {
          x: progress * 220,
          y: Math.sin(progress * Math.PI * 2) * 42,
          pressure: 0.55 + Math.sin(progress * Math.PI) * 0.2,
          timeStamp,
        };
      },
      regularDistanceBudget: 0.25,
    },
    {
      name: "acute turn",
      durationMs: 180,
      path: (timeStamp: number): FixedRateStrokeRawSample => {
        const progress = timeStamp / 180;
        return progress <= 0.5
          ? { x: progress * 160, y: 0, pressure: 0.5, timeStamp }
          : {
              x: 80 - (progress - 0.5) * 100,
              y: (progress - 0.5) * 140,
              pressure: 0.5,
              timeStamp,
            };
      },
      regularDistanceBudget: 0.15,
    },
  ] as const;

  for (const fixture of fixtures) {
    it(`preserves ${fixture.name} arc length and turn score at 120/240Hz and irregular cadence`, () => {
      const at120Hz = runSampledPath(
        fixture.path,
        sampleTimes(fixture.durationMs, 120)
      );
      const at240Hz = runSampledPath(
        fixture.path,
        sampleTimes(fixture.durationMs, 240)
      );
      const irregular240Hz = runSampledPath(
        fixture.path,
        sampleTimes(fixture.durationMs, 240, irregularCadence)
      );
      const relativeDifference = (left: number, right: number) => (
        Math.abs(left - right) / Math.max(left, right, Number.EPSILON)
      );

      expect(maximumPointDistance(at120Hz, at240Hz))
        .toBeLessThanOrEqual(fixture.regularDistanceBudget);
      expect(maximumPointDistance(at240Hz, irregular240Hz)).toBeLessThanOrEqual(0.08);
      expect(relativeDifference(polylineLength(at120Hz), polylineLength(at240Hz)))
        .toBeLessThanOrEqual(0.005);
      expect(relativeDifference(polylineLength(at240Hz), polylineLength(irregular240Hz)))
        .toBeLessThanOrEqual(0.002);
      expect(relativeDifference(totalAbsoluteTurn(at120Hz), totalAbsoluteTurn(at240Hz)))
        .toBeLessThanOrEqual(0.015);
      expect(relativeDifference(totalAbsoluteTurn(at240Hz), totalAbsoluteTurn(irregular240Hz)))
        .toBeLessThanOrEqual(0.015);
    });
  }

  it("keeps the strongest steady-state trail below an 82ms phase-delay budget", () => {
    const durationMs = 2_000;
    const path = (timeStamp: number): FixedRateStrokeRawSample => ({
      x: timeStamp,
      y: 0,
      pressure: 0.5,
      timeStamp,
    });
    const trails = [
      runSampledPath(path, sampleTimes(durationMs, 120), 10),
      runSampledPath(path, sampleTimes(durationMs, 240), 10),
      runSampledPath(path, sampleTimes(durationMs, 240, irregularCadence), 10),
    ].map((samples) => {
      const endpoint = samples.at(-1)!;
      return durationMs - endpoint.x;
    });

    expect(Math.max(...trails)).toBeLessThanOrEqual(82);
    expect(Math.max(...trails) - Math.min(...trails)).toBeLessThanOrEqual(0.05);
  });
});

describe("representative stroke fixtures", () => {
  it("locks the causal sine response across position, pressure, and tilt", () => {
    const initial = {
      x: 0,
      y: 0,
      pressure: 0.4,
      tiltX: 0,
      tiltY: -10,
      timeStamp: 0,
    };
    const sineSamples = Array.from({ length: 20 }, (_, index) => {
      const timeStamp = (index + 1) * 4;
      return {
        x: timeStamp * 1.25,
        y: Math.sin(timeStamp / 16) * 12,
        pressure: 0.4 + Math.sin(timeStamp / 20) * 0.2,
        tiltX: Math.sin(timeStamp / 30) * 20,
        tiltY: -Math.cos(timeStamp / 24) * 10,
        timeStamp,
      };
    });
    const result = runBatches(initial, [sineSamples]);
    const selectedTicks = new Set([0, 4, 8, 12, 16]);
    expect(result.emitted.filter((sample) => selectedTicks.has(sample.logicalTick)).map(fixturePoint))
      .toEqual([
        { tick: 0, x: 0, y: 0, pressure: 0.399804, tiltX: 0, tiltY: -10 },
        {
          tick: 4,
          x: 1.801892,
          y: 0.98414,
          pressure: 0.413434,
          tiltX: 0.93774,
          tiltY: -9.866067,
        },
        {
          tick: 8,
          x: 13.365356,
          y: 5.62917,
          pressure: 0.485332,
          tiltX: 6.45954,
          tiltY: -8.195426,
        },
        {
          tick: 12,
          x: 34.229754,
          y: 7.37685,
          pressure: 0.546356,
          tiltX: 13.966729,
          tiltY: -3.339274,
        },
        {
          tick: 16,
          x: 58.449406,
          y: 0.778795,
          pressure: 0.497424,
          tiltX: 17.220877,
          tiltY: 3.145907,
        },
      ]);
    expect(fixturePoint(result.finished.endpoint)).toEqual({
      tick: 34,
      x: 100,
      y: -11.5,
      pressure: 0.248289,
      tiltX: 9.125,
      tiltY: 9.8125,
    });
    expect(result.finished.releaseDrainTicks).toBe(18);
    expect(result.state.lastStagePositionDelta).toBe(0);
  });

  it("locks a sharp-turn response without allowing future samples to rewrite its prefix", () => {
    const initial = { x: 0, y: 0, pressure: 0.5, timeStamp: 0 };
    const turnSamples = Array.from({ length: 20 }, (_, index) => {
      const timeStamp = (index + 1) * 4;
      return timeStamp <= 40
        ? { x: timeStamp * 2, y: 0, pressure: 0.5, timeStamp }
        : { x: 80, y: (timeStamp - 40) * 2, pressure: 0.5, timeStamp };
    });
    const beforeTurn = append(
      createFixedRateStrokeFilter(initial, 3.4).state,
      turnSamples.slice(0, 10)
    );
    const beforeSnapshot = structuredClone(beforeTurn.emitted);
    const afterTurn = append(beforeTurn.state, turnSamples.slice(10));
    expect(beforeTurn.emitted).toEqual(beforeSnapshot);
    expect(beforeTurn.emitted.every((sample) => sample.y === 0)).toBe(true);

    const finished = release(afterTurn.state);
    const all = [
      createFixedRateStrokeFilter(initial, 3.4).emitted[0]!,
      ...beforeTurn.emitted,
      ...afterTurn.emitted,
      ...finished.emitted,
    ];
    const selectedTicks = new Set([8, 9, 12, 16]);
    expect(all.filter((sample) => selectedTicks.has(sample.logicalTick)).map(fixturePoint))
      .toEqual([
        {
          tick: 8,
          x: 21.38457,
          y: 0,
          pressure: 0.500489,
          tiltX: 0,
          tiltY: 0,
        },
        {
          tick: 9,
          x: 28.692516,
          y: 0.060466,
          pressure: 0.500489,
          tiltX: 0,
          tiltY: 0,
        },
        {
          tick: 12,
          x: 51.884579,
          y: 2.883027,
          pressure: 0.500489,
          tiltX: 0,
          tiltY: 0,
        },
        {
          tick: 16,
          x: 72.134479,
          y: 21.38457,
          pressure: 0.500489,
          tiltX: 0,
          tiltY: 0,
        },
      ]);
    expect(fixturePoint(finished.endpoint)).toEqual({
      tick: 31,
      x: 80,
      y: 80,
      pressure: 0.500489,
      tiltX: 0,
      tiltY: 0,
    });
    expect(finished.releaseDrainTicks).toBe(15);
    expect(finished.state.lastStagePositionDelta).toBe(0);
  });

  it("drains one held release endpoint and pins every channel to the exact final sample", () => {
    const started = createFixedRateStrokeFilter({
      x: 0,
      y: 0,
      pressure: 0.2,
      tiltX: 0,
      tiltY: 0,
      timeStamp: 0,
    }, 3.4);
    const moved = append(started.state, [{
      x: 100,
      y: 40,
      pressure: 0.8,
      tiltX: 20,
      tiltY: -12,
      timeStamp: 1,
    }]);
    const finished = release(moved.state, {
      x: 100,
      y: 40,
      pressure: 0.8,
      tiltX: 20,
      tiltY: -12,
      timeStamp: 6,
    });

    expect(finished.releaseDrainTicks).toBeGreaterThan(0);
    expect(finished.state.lastStagePositionDelta)
      .toBeLessThanOrEqual(FIXED_RATE_STROKE_RELEASE_POSITION_EPSILON);
    expect(finished.endpoint).toMatchObject({
      x: 100,
      y: 40,
      pressure: finished.state.heldSample.pressure,
      tiltX: 20,
      tiltY: -12,
      sourceTimeStamp: 6,
    });
    expect(finished.state.stages.every((stage) => (
      stage.x === finished.state.heldSample.x
      && stage.y === finished.state.heldSample.y
      && stage.pressure === finished.state.heldSample.pressure
      && stage.tiltX === finished.state.heldSample.tiltX
      && stage.tiltY === finished.state.heldSample.tiltY
    ))).toBe(true);
    expect(finished.emitted.slice(-finished.releaseDrainTicks).every((sample) => (
      sample.sourceTimeStamp === 6
    ))).toBe(true);
    expect({
      releaseDrainTicks: finished.releaseDrainTicks,
      lastStagePositionDelta: round(finished.state.lastStagePositionDelta),
      endpoint: fixturePoint(finished.endpoint),
    }).toEqual({
      releaseDrainTicks: 21,
      lastStagePositionDelta: 0,
      endpoint: {
        tick: 22,
        x: 100,
        y: 40,
        pressure: 0.799609,
        tiltX: 20,
        tiltY: -12,
      },
    });
  });

  it("continues draining a stationary pressure-only endpoint", () => {
    const started = createFixedRateStrokeFilter({
      x: 12,
      y: 24,
      pressure: 0,
      timeStamp: 0,
    }, 3.4);
    const moved = append(started.state, [{
      x: 12,
      y: 24,
      pressure: 1,
      timeStamp: 1,
    }]);
    const finished = release(moved.state, {
      x: 12,
      y: 24,
      pressure: 1,
      timeStamp: 6,
    });

    expect(finished.releaseDrainTicks).toBeGreaterThan(1);
    expect(finished.state.lastStagePositionDelta).toBe(0);
    expect(finished.state.lastStagePressureDelta)
      .toBeLessThanOrEqual(FIXED_RATE_STROKE_RELEASE_PRESSURE_EPSILON);
    expect(finished.endpoint.pressure).toBeGreaterThan(0.99);
  });

  it("continues draining a stationary tilt-only endpoint", () => {
    const started = createFixedRateStrokeFilter({
      x: 12,
      y: 24,
      tiltX: 0,
      tiltY: 0,
      timeStamp: 0,
    }, 3.4);
    const moved = append(started.state, [{
      x: 12,
      y: 24,
      tiltX: 30,
      tiltY: -20,
      timeStamp: 1,
    }]);
    const finished = release(moved.state, {
      x: 12,
      y: 24,
      tiltX: 30,
      tiltY: -20,
      timeStamp: 6,
    });

    expect(finished.releaseDrainTicks).toBeGreaterThan(1);
    expect(finished.state.lastStagePositionDelta).toBe(0);
    expect(finished.state.lastStageTiltDelta)
      .toBeLessThanOrEqual(FIXED_RATE_STROKE_RELEASE_TILT_EPSILON);
    expect(finished.endpoint.tiltX).toBeGreaterThan(29.9);
    expect(finished.endpoint.tiltY).toBeLessThan(-19.9);
  });

  it("closes an already settled tap without manufacturing extra ticks", () => {
    const started = createFixedRateStrokeFilter({ x: 3, y: 5, timeStamp: 12 }, 10);
    const finished = release(started.state);
    expect(finished.releaseDrainTicks).toBe(0);
    expect(finished.emitted).toEqual([]);
    expect(finished.endpoint).toBe(started.endpoint);
    expect(finished.state.closed).toBe(true);
  });

  it("makes every transition after release an idempotent no-op", () => {
    const started = createFixedRateStrokeFilter({ x: 0, y: 0, timeStamp: 0 }, 3.4);
    const finished = release(started.state);
    const afterClose = append(finished.state, [{ x: 100, y: 100, timeStamp: 100 }]);
    expect(afterClose.state).toBe(finished.state);
    expect(afterClose.emitted).toEqual([]);
    expect(afterClose.endpoint).toBe(finished.endpoint);
  });

  it("emits only fixed-grid timestamps, including synthetic release drain ticks", () => {
    const started = createFixedRateStrokeFilter({ x: 0, y: 0, timeStamp: 2.5 }, 3.4);
    const finished = release(append(started.state, [{
      x: 50,
      y: 25,
      timeStamp: 9,
    }]).state);
    expect(finished.emitted.every((sample) => (
      sample.timeStamp === 2.5 + sample.logicalTick * FIXED_RATE_STROKE_FILTER_TICK_MS
    ))).toBe(true);
  });
});
