import { describe, expect, it } from "vitest";

import {
  createStudioStrokeOneEuroV1State,
  filterStudioStrokeOneEuroV1,
  flushStudioStrokeOneEuroV1Endpoint,
  type StudioStrokeOneEuroV1Options,
  type StudioStrokeOneEuroV1State,
} from "./studio-stroke-one-euro-v1";

const BASE_OPTIONS: StudioStrokeOneEuroV1Options = {
  minCutoffHz: 1.25,
  beta: 0.012,
  derivativeCutoffHz: 1,
  coordinateScale: 1,
};

function runSamples(
  values: readonly { readonly x: number; readonly y: number; readonly timeStamp: number }[],
  options: StudioStrokeOneEuroV1Options = BASE_OPTIONS,
): StudioStrokeOneEuroV1State {
  let state = createStudioStrokeOneEuroV1State(values[0] ?? {
    x: 0,
    y: 0,
    timeStamp: 0,
  });
  for (const sample of values.slice(1)) {
    state = filterStudioStrokeOneEuroV1(state, sample, options).state;
  }
  return state;
}

describe("studio stroke One Euro v1", () => {
  it("snaps the first sample and remains deterministic", () => {
    const samples = [
      { x: 12, y: 18, timeStamp: 10 },
      { x: 14, y: 20, timeStamp: 18 },
      { x: 30, y: 25, timeStamp: 26 },
      { x: 35, y: 29, timeStamp: 34 },
    ] as const;

    const first = createStudioStrokeOneEuroV1State(samples[0]);
    expect(first.outputX).toBe(12);
    expect(first.outputY).toBe(18);
    expect(runSamples(samples)).toEqual(runSamples(samples));
  });

  it("suppresses stationary high-frequency pointer jitter", () => {
    const samples = Array.from({ length: 121 }, (_, index) => ({
      x: index === 0 ? 0 : index % 2 === 0 ? 1 : -1,
      y: index === 0 ? 0 : index % 4 < 2 ? 0.75 : -0.75,
      timeStamp: index * (1_000 / 120),
    }));
    const state = runSamples(samples, {
      minCutoffHz: 0.8,
      beta: 0,
      derivativeCutoffHz: 1,
    });

    expect(Math.abs(state.outputX)).toBeLessThan(0.2);
    expect(Math.abs(state.outputY)).toBeLessThan(0.2);
  });

  it("uses beta to reduce lag during fast movement", () => {
    const start = createStudioStrokeOneEuroV1State({ x: 0, y: 0, timeStamp: 0 });
    const slow = filterStudioStrokeOneEuroV1(
      start,
      { x: 100, y: 0, timeStamp: 8 },
      { ...BASE_OPTIONS, beta: 0 },
    );
    const adaptive = filterStudioStrokeOneEuroV1(
      start,
      { x: 100, y: 0, timeStamp: 8 },
      { ...BASE_OPTIONS, beta: 0.05 },
    );

    expect(adaptive.cutoffHz).toBeGreaterThan(slow.cutoffHz);
    expect(adaptive.point[0]).toBeGreaterThan(slow.point[0]);
    expect(100 - adaptive.point[0]).toBeLessThan(100 - slow.point[0]);
  });

  it("keeps a constant-speed ramp similar across 60Hz and 120Hz delivery", () => {
    const ramp = (hz: number) => Array.from({ length: Math.round(hz / 2) + 1 }, (_, index) => {
      const timeStamp = index * (1_000 / hz);
      return {
        x: timeStamp * 0.4,
        y: timeStamp * 0.12,
        timeStamp,
      };
    });
    const sixty = runSamples(ramp(60));
    const oneTwenty = runSamples(ramp(120));

    expect(Math.abs(sixty.outputX - oneTwenty.outputX)).toBeLessThan(2);
    expect(Math.abs(sixty.outputY - oneTwenty.outputY)).toBeLessThan(1);
  });

  it("measures velocity in CSS pixels so zoomed input can follow fast movement sooner", () => {
    const start = createStudioStrokeOneEuroV1State({ x: 0, y: 0, timeStamp: 0 });
    const normal = filterStudioStrokeOneEuroV1(
      start,
      { x: 24, y: 0, timeStamp: 8 },
      { ...BASE_OPTIONS, coordinateScale: 1 },
    );
    const zoomed = filterStudioStrokeOneEuroV1(
      start,
      { x: 24, y: 0, timeStamp: 8 },
      { ...BASE_OPTIONS, coordinateScale: 2 },
    );

    expect(zoomed.speedCssPixelsPerSecond).toBeCloseTo(
      normal.speedCssPixelsPerSecond * 2,
    );
    expect(zoomed.cutoffHz).toBeGreaterThan(normal.cutoffHz);
    expect(zoomed.point[0]).toBeGreaterThan(normal.point[0]);
  });

  it("recovers after repeated and regressing browser timestamps without non-finite output", () => {
    let state = createStudioStrokeOneEuroV1State({ x: 0, y: 0, timeStamp: 100 });
    state = filterStudioStrokeOneEuroV1(
      state,
      { x: 10, y: 4, timeStamp: 100 },
      BASE_OPTIONS,
    ).state;
    state = filterStudioStrokeOneEuroV1(
      state,
      { x: 20, y: 8, timeStamp: 96 },
      BASE_OPTIONS,
    ).state;
    state = filterStudioStrokeOneEuroV1(
      state,
      { x: 30, y: 12, timeStamp: 108 },
      BASE_OPTIONS,
    ).state;

    expect(Number.isFinite(state.outputX)).toBe(true);
    expect(Number.isFinite(state.outputY)).toBe(true);
    expect(state.timeStamp).toBe(108);
    expect(state.sampleIntervalMs).toBe(12);
  });

  it("flushes exactly to the last raw pointer endpoint", () => {
    const state = runSamples([
      { x: 0, y: 0, timeStamp: 0 },
      { x: 80, y: 30, timeStamp: 8 },
    ]);
    expect(state.outputX).not.toBe(80);
    const flushed = flushStudioStrokeOneEuroV1Endpoint(state);

    expect(flushed.point).toEqual([80, 30]);
    expect(flushed.state.outputX).toBe(80);
    expect(flushed.state.outputY).toBe(30);
    expect(flushed.speedCssPixelsPerSecond).toBe(0);
  });

  it("normalizes hostile numeric options and sample values", () => {
    const start = createStudioStrokeOneEuroV1State({
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      timeStamp: -10,
    });
    const result = filterStudioStrokeOneEuroV1(
      start,
      {
        x: Number.POSITIVE_INFINITY,
        y: Number.NaN,
        timeStamp: Number.NaN,
      },
      {
        minCutoffHz: Number.NaN,
        beta: Number.POSITIVE_INFINITY,
        derivativeCutoffHz: -100,
        coordinateScale: Number.NaN,
      },
    );

    expect(result.point).toEqual([0, 0]);
    expect(Number.isFinite(result.cutoffHz)).toBe(true);
    expect(Number.isFinite(result.speedCssPixelsPerSecond)).toBe(true);
  });
});
