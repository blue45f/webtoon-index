import { describe, expect, it } from "vitest";

import {
  STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
  STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
  STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
} from "./brush/studio-ink-pressure-model";
import { planStudioGpuDabs } from "./render/studio-webgpu-dab-planner";
import { studioGpuPressureRadius } from "./render/studio-webgpu-stroke";
import {
  advanceStudioResidualInk,
  planStudioCausalInk,
  planStudioCausalInkDabs,
  selectStudioCausalInkSamples,
  shouldAppendStudioCausalInkSample,
  startStudioResidualInk,
  STUDIO_CAUSAL_INK_DEFAULT_PRESSURE,
} from "./studio-causal-ink";

function expectDabsClose(
  actual: readonly { x: number; y: number; pressure: number; radius: number }[],
  expected: readonly { x: number; y: number; pressure: number; radius: number }[]
): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((dab, index) => {
    expect(dab.x).toBeCloseTo(expected[index]!.x, 11);
    expect(dab.y).toBeCloseTo(expected[index]!.y, 11);
    expect(dab.pressure).toBeCloseTo(expected[index]!.pressure, 11);
    expect(dab.radius).toBeCloseTo(expected[index]!.radius, 11);
  });
}

describe("studio causal ink", () => {
  it("admits only meaningful V3 stationary pressure state through every input rate", () => {
    const common = {
      lastX: 9,
      lastY: 4,
      nextX: 9,
      nextY: 4,
      minDistance: 2,
    } as const;
    expect(shouldAppendStudioCausalInkSample({
      ...common,
      lastPressure: 1,
      nextPressure: 0,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
    })).toBe(true);
    expect(shouldAppendStudioCausalInkSample({
      ...common,
      lastPressure: 1,
      nextPressure: 1,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
    })).toBe(false);
    expect(shouldAppendStudioCausalInkSample({
      ...common,
      lastPressure: 1,
      nextPressure: 0,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
    })).toBe(false);
    expect(shouldAppendStudioCausalInkSample({
      ...common,
      lastPressure: 1,
      nextPressure: 1,
      nextX: 11,
    })).toBe(true);
  });

  it("consumes only the longest finite coordinate-pair prefix", () => {
    const samples = selectStudioCausalInkSamples({
      points: [0, 1, 4, 5, Number.NaN, 8, 20, 30, 99],
      pressures: [0.1, 0.2, 0.3, 0.4],
      minDistance: 0,
    });

    expect(samples).toEqual([
      { x: 0, y: 1, pressure: 0.1, sourceIndex: 0 },
      { x: 4, y: 5, pressure: 0.2, sourceIndex: 1 },
    ]);
    expect(selectStudioCausalInkSamples({
      points: [Number.POSITIVE_INFINITY, 0, 4, 5],
      minDistance: 0,
    })).toEqual([]);
    expect(selectStudioCausalInkSamples({
      points: [2, 3, 99],
      pressures: [0.7, 1],
      minDistance: 0,
    })).toEqual([{ x: 2, y: 3, pressure: 0.7, sourceIndex: 0 }]);
  });

  it("keeps the first sample and seals the final distinct endpoint below minDistance", () => {
    const samples = selectStudioCausalInkSamples({
      points: [0, 0, 1, 0, 2, 0, 6, 0, 7, 0],
      pressures: [0.1, 0.25, 0.5, 0.75, 0.9],
      minDistance: 5,
    });

    expect(samples).toEqual([
      { x: 0, y: 0, pressure: 0.1, sourceIndex: 0 },
      { x: 6, y: 0, pressure: 0.75, sourceIndex: 3 },
      { x: 7, y: 0, pressure: 0.9, sourceIndex: 4 },
    ]);
  });

  it("exposes an append-stable unsealed prefix for a replaceable pointer tail", () => {
    const before = selectStudioCausalInkSamples({
      points: [0, 0, 1, 0, 2, 0],
      pressures: [0.2, 0.4, 0.6],
      minDistance: 5,
      sealEndpoint: false,
    });
    const after = selectStudioCausalInkSamples({
      points: [0, 0, 1, 0, 2, 0, 6, 0],
      pressures: [0.2, 0.4, 0.6, 0.8],
      minDistance: 5,
      sealEndpoint: false,
    });

    expect(before).toEqual([{ x: 0, y: 0, pressure: 0.2, sourceIndex: 0 }]);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)).toEqual({ x: 6, y: 0, pressure: 0.8, sourceIndex: 3 });
  });

  it("preserves retained source-index pressure instead of progress-resampling it", () => {
    const samples = selectStudioCausalInkSamples({
      points: [0, 0, 1, 0, 2, 0, 10, 0, 20, 0],
      pressures: [0, 0.25, 0.5, 0.75, 1],
      minDistance: 3,
    });

    expect(samples.map(({ sourceIndex }) => sourceIndex)).toEqual([0, 3, 4]);
    expect(samples.map(({ pressure }) => pressure)).toEqual([0, 0.75, 1]);
  });

  it("sanitizes pressure at its source index and omits exact duplicate endpoints", () => {
    const samples = selectStudioCausalInkSamples({
      points: [0, 0, 0, 0, 4, 0, 4, 0],
      pressures: [-1, Number.NaN, 2, Number.POSITIVE_INFINITY],
      minDistance: 10,
    });

    expect(samples).toEqual([
      { x: 0, y: 0, pressure: 0, sourceIndex: 0 },
      {
        x: 4,
        y: 0,
        pressure: STUDIO_CAUSAL_INK_DEFAULT_PRESSURE,
        sourceIndex: 3,
      },
    ]);
  });

  it("uses full pressure for missing linear samples while preserving legacy half pressure", () => {
    const points = [0, 0, 10, 0];
    expect(selectStudioCausalInkSamples({
      points,
      pressures: [],
      minDistance: 0,
    }).map(({ pressure }) => pressure)).toEqual([0.5, 0.5]);
    expect(selectStudioCausalInkSamples({
      points,
      pressures: [],
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
      minDistance: 0,
    }).map(({ pressure }) => pressure)).toEqual([1, 1]);
  });

  it("plans the initial dab and pressure-linear segment dabs with the GPU spacing formula", () => {
    const samples = [
      { x: 0, y: 0, pressure: 0.25, sourceIndex: 0 },
      { x: 12, y: 0, pressure: 0.75, sourceIndex: 1 },
    ] as const;
    const size = 8;
    const startRadius = studioGpuPressureRadius(size, 0.25);
    const endRadius = studioGpuPressureRadius(size, 0.75);
    const spacing = Math.max(0.5, Math.min(startRadius, endRadius) * 0.45);
    const steps = Math.max(1, Math.ceil(12 / spacing));
    const plan = planStudioCausalInkDabs({ samples, size });

    expect(plan.complete).toBe(true);
    expect(plan.dabs).toHaveLength(1 + steps);
    expect(plan.dabs[0]).toEqual({
      x: 0,
      y: 0,
      pressure: 0.25,
      radius: startRadius,
    });
    for (let step = 1; step <= steps; step += 1) {
      const amount = step / steps;
      const pressure = 0.25 + (0.75 - 0.25) * amount;
      expect(plan.dabs[step]).toEqual({
        x: 12 * amount,
        y: 0,
        pressure,
        radius: studioGpuPressureRadius(size, pressure),
      });
    }
    expect(plan.dabs.at(-1)).toEqual({
      x: 12,
      y: 0,
      pressure: 0.75,
      radius: endRadius,
    });
  });

  it("emits one initial dab and no duplicate segment-start dabs across a polyline", () => {
    const samples = [
      { x: 0, y: 0, pressure: 0.5, sourceIndex: 0 },
      { x: 4, y: 0, pressure: 0.5, sourceIndex: 1 },
      { x: 4, y: 4, pressure: 1, sourceIndex: 2 },
    ] as const;
    const size = 10;
    const firstSteps = Math.ceil(4 / (studioGpuPressureRadius(size, 0.5) * 0.45));
    const secondSteps = Math.ceil(
      4 / (Math.min(
        studioGpuPressureRadius(size, 0.5),
        studioGpuPressureRadius(size, 1)
      ) * 0.45)
    );
    const plan = planStudioCausalInkDabs({ samples, size });

    expect(plan.dabs).toHaveLength(1 + firstSteps + secondSteps);
    expect(plan.dabs.filter(({ x, y }) => x === 4 && y === 0)).toHaveLength(1);
    expect(plan.dabs.at(-1)).toMatchObject({ x: 4, y: 4, pressure: 1 });
  });

  it("matches the current GPU planner's dab centers and radii exactly", () => {
    const samples = selectStudioCausalInkSamples({
      points: [0, 0, 1, 0, 7, 3, 12, -2],
      pressures: [0.2, 0.4, 0.75, 1],
      minDistance: 2,
    });
    const size = 9;
    const causal = planStudioCausalInkDabs({ samples, size });
    const gpu = planStudioGpuDabs([{
      id: "parity",
      points: samples.flatMap(({ x, y }) => [x, y]),
      pressures: samples.map(({ pressure }) => pressure),
      color: "#000000",
      size,
      opacity: 1,
      composite: "normal",
    }]);

    expect(causal.complete).toBe(true);
    expect(gpu.complete).toBe(true);
    expect(causal.dabs.map(({ x, y, radius }) => ({ x, y, radius }))).toEqual(
      gpu.dabs.map(({ x, y, radius }) => ({ x, y, radius }))
    );
  });

  it("shares the linear-full zero-to-selected-diameter contract with the GPU planner", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1;
    const samples = [
      { x: 0, y: 0, pressure: 0, sourceIndex: 0 },
      { x: 5, y: 0, pressure: 0.5, sourceIndex: 1 },
      { x: 10, y: 0, pressure: 1, sourceIndex: 2 },
    ] as const;
    const causal = planStudioCausalInkDabs({ samples, size: 10, pressureModel });
    const gpu = planStudioGpuDabs([{
      id: "linear-parity",
      points: samples.flatMap(({ x, y }) => [x, y]),
      pressures: samples.map(({ pressure }) => pressure),
      color: "#000000",
      size: 10,
      pressureModel,
    }]);

    expect(causal.dabs[0]?.radius).toBe(0);
    expect(causal.dabs.find(({ pressure }) => pressure === 0.5)?.radius).toBe(2.5);
    expect(causal.dabs.at(-1)?.radius).toBe(5);
    expect(causal.dabs.map(({ x, y, radius }) => ({ x, y, radius }))).toEqual(
      gpu.dabs.map(({ x, y, radius }) => ({ x, y, radius }))
    );
  });

  it("matches Magma's residual centers and does not force each source endpoint", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2;
    const samples = Array.from({ length: 13 }, (_, sourceIndex) => ({
      x: sourceIndex,
      y: 0,
      pressure: 1,
      sourceIndex,
    }));
    const subdivided = planStudioCausalInkDabs({ samples, size: 16, pressureModel });
    const singleSegment = planStudioCausalInkDabs({
      samples: [samples[0]!, samples.at(-1)!],
      size: 16,
      pressureModel,
    });

    expect(subdivided.complete).toBe(true);
    expect(subdivided.dabs.map(({ x }) => x)).toHaveLength(4);
    subdivided.dabs.forEach((dab, index) => {
      expect(dab.x).toBeCloseTo(index * 3.2, 12);
      expect(dab.y).toBe(0);
      expect(dab.radius).toBe(8);
    });
    expect(subdivided.dabs.at(-1)?.x).toBeCloseTo(9.6, 12);
    expect(subdivided.dabs.at(-1)?.x).not.toBe(12);
    expect(singleSegment.dabs).toEqual(subdivided.dabs);
  });

  it("keeps V3 residual dabs on the pointer polyline across coarse and subdivided corners", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3;
    const coarse = [
      { x: 0, y: 0, pressure: 1, sourceIndex: 0 },
      { x: 4, y: 0, pressure: 1, sourceIndex: 1 },
      { x: 4, y: 4, pressure: 1, sourceIndex: 2 },
      { x: 8, y: 4, pressure: 1, sourceIndex: 3 },
    ] as const;
    const subdivided = [
      { x: 0, y: 0, pressure: 1, sourceIndex: 0 },
      { x: 2, y: 0, pressure: 1, sourceIndex: 1 },
      { x: 4, y: 0, pressure: 1, sourceIndex: 2 },
      { x: 4, y: 2, pressure: 1, sourceIndex: 3 },
      { x: 4, y: 4, pressure: 1, sourceIndex: 4 },
      { x: 6, y: 4, pressure: 1, sourceIndex: 5 },
      { x: 8, y: 4, pressure: 1, sourceIndex: 6 },
    ] as const;
    const coarsePlan = planStudioCausalInkDabs({ samples: coarse, size: 16, pressureModel });
    const subdividedPlan = planStudioCausalInkDabs({
      samples: subdivided,
      size: 16,
      pressureModel,
    });
    const expectedCenters = [[0, 0], [3.2, 0], [4, 2.4], [5.6, 4]] as const;

    expect(coarsePlan.complete).toBe(true);
    expect(subdividedPlan.complete).toBe(true);
    expect(coarsePlan.dabs).toHaveLength(expectedCenters.length);
    coarsePlan.dabs.forEach((dab, index) => {
      expect(dab.x).toBeCloseTo(expectedCenters[index]![0], 12);
      expect(dab.y).toBeCloseTo(expectedCenters[index]![1], 12);
      expect(dab.radius).toBe(8);
    });
    expectDabsClose(subdividedPlan.dabs, coarsePlan.dabs);
  });

  it("carries V3 corner phase as immutable incremental suffixes", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3;
    const samples = [
      { x: 0, y: 0, pressure: 1, sourceIndex: 0 },
      { x: 4, y: 0, pressure: 1, sourceIndex: 1 },
      { x: 4, y: 4, pressure: 1, sourceIndex: 2 },
      { x: 8, y: 4, pressure: 1, sourceIndex: 3 },
    ] as const;
    const expectedPhases = [0.25, 0.5, 0.75] as const;
    const started = startStudioResidualInk(samples[0], 16, pressureModel);
    const incremental = [...started.dabs];
    let state = started.state;

    for (const [index, sample] of samples.slice(1).entries()) {
      const prefix = incremental.map((dab) => ({ ...dab }));
      const advanced = advanceStudioResidualInk(state, sample, 16, pressureModel);
      expect(advanced.complete).toBe(true);
      state = advanced.state;
      incremental.push(...advanced.dabs);
      expect(incremental.slice(0, prefix.length)).toEqual(prefix);
      expect(state.distanceRemainder).toBe(0);
      expect(state.spacingPhase).toBeCloseTo(expectedPhases[index]!, 12);
    }

    const full = planStudioCausalInkDabs({ samples, size: 16, pressureModel });
    expectDabsClose(incremental, full.dabs);
  });

  it("integrates V3 pressure phase independently of source sample density", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3;
    const coarse = [
      { x: 0, y: 0, pressure: 0.25, sourceIndex: 0 },
      { x: 20, y: 0, pressure: 1, sourceIndex: 1 },
    ] as const;
    const subdivided = Array.from({ length: 5 }, (_, sourceIndex) => ({
      x: sourceIndex * 5,
      y: 0,
      pressure: 0.25 + sourceIndex * 0.1875,
      sourceIndex,
    }));
    const coarsePlan = planStudioCausalInkDabs({ samples: coarse, size: 16, pressureModel });
    const subdividedPlan = planStudioCausalInkDabs({
      samples: subdivided,
      size: 16,
      pressureModel,
    });
    const firstPressure = 0.25 * Math.exp((3.2 * 0.75) / 20);
    const firstX = ((firstPressure - 0.25) * 20) / 0.75;

    expect(coarsePlan.complete).toBe(true);
    expect(subdividedPlan.complete).toBe(true);
    expect(coarsePlan.dabs[1]?.x).toBeCloseTo(firstX, 11);
    expect(coarsePlan.dabs[1]?.pressure).toBeCloseTo(firstPressure, 11);
    expectDabsClose(subdividedPlan.dabs, coarsePlan.dabs);
  });

  it("keeps V3 density invariant while pressure crosses both spacing clamps", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3;
    const coarse = [
      { x: 0, y: 0, pressure: 0, sourceIndex: 0 },
      { x: 40, y: 0, pressure: 1, sourceIndex: 1 },
    ] as const;
    const subdividedPressures = [0, 0.025, 0.2, 0.5, 0.75, 1] as const;
    const subdivided = subdividedPressures.map((pressure, sourceIndex) => ({
      x: pressure * 40,
      y: 0,
      pressure,
      sourceIndex,
    }));
    const coarsePlan = planStudioCausalInkDabs({ samples: coarse, size: 100, pressureModel });
    const subdividedPlan = planStudioCausalInkDabs({
      samples: subdivided,
      size: 100,
      pressureModel,
    });

    expect(coarsePlan.complete).toBe(true);
    expect(subdividedPlan.complete).toBe(true);
    expectDabsClose(subdividedPlan.dabs, coarsePlan.dabs);
  });

  it("preserves stationary V3 pressure state across live advance and sealed planning", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3;
    const samples = selectStudioCausalInkSamples({
      points: [0, 0, 9, 0, 9, 0, 10, 0],
      pressures: [1, 1, 0, 0],
      pressureModel,
      minDistance: 0,
    });
    expect(samples.map(({ sourceIndex }) => sourceIndex)).toEqual([0, 1, 2, 3]);

    const started = startStudioResidualInk(samples[0]!, 50, pressureModel);
    const incremental = [...started.dabs];
    let state = started.state;
    for (const sample of samples.slice(1)) {
      const advanced = advanceStudioResidualInk(state, sample, 50, pressureModel);
      expect(advanced.complete).toBe(true);
      state = advanced.state;
      incremental.push(...advanced.dabs);
    }
    const full = planStudioCausalInk({
      points: [0, 0, 9, 0, 9, 0, 10, 0],
      pressures: [1, 1, 0, 0],
      pressureModel,
      minDistance: 0,
      size: 50,
    });

    expect(incremental.map(({ x }) => x)).toEqual([0, 9.05, 9.55]);
    expect(incremental.slice(1).every(({ radius }) => radius === 0)).toBe(true);
    expectDabsClose(full.dabs, incremental);
  });

  it("produces the full residual plan as immutable incremental suffixes", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2;
    const samples = [
      { x: 0, y: 0, pressure: 1, sourceIndex: 0 },
      { x: 1, y: 0, pressure: 1, sourceIndex: 1 },
      { x: 4, y: 0, pressure: 0.75, sourceIndex: 2 },
      { x: 9, y: 2, pressure: 0.5, sourceIndex: 3 },
      { x: 12, y: 2, pressure: 1, sourceIndex: 4 },
    ] as const;
    const started = startStudioResidualInk(samples[0], 16, pressureModel);
    const incremental = [...started.dabs];
    const prefix = incremental.map((dab) => ({ ...dab }));
    let state = started.state;
    for (const sample of samples.slice(1)) {
      const advanced = advanceStudioResidualInk(state, sample, 16, pressureModel);
      expect(advanced.complete).toBe(true);
      state = advanced.state;
      incremental.push(...advanced.dabs);
      expect(incremental.slice(0, prefix.length)).toEqual(prefix);
    }
    const full = planStudioCausalInkDabs({ samples, size: 16, pressureModel });
    expect(incremental).toEqual(full.dabs);
  });

  it("omits a zero-pressure start and never stamps a stationary pressure-only sample", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2;
    const first = { x: 4, y: 6, pressure: 0, sourceIndex: 0 } as const;
    const started = startStudioResidualInk(first, 16, pressureModel);
    const stationary = advanceStudioResidualInk(
      started.state,
      { x: 4, y: 6, pressure: 1, sourceIndex: 1 },
      16,
      pressureModel
    );
    expect(started.dabs).toEqual([]);
    expect(stationary.dabs).toEqual([]);
    expect(stationary.state.distanceRemainder).toBe(0);
  });

  it("does not spend a carried remainder when stationary pressure narrows the spacing", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2;
    const started = startStudioResidualInk(
      { x: 0, y: 0, pressure: 1, sourceIndex: 0 },
      50,
      pressureModel
    );
    const moved = advanceStudioResidualInk(
      started.state,
      { x: 9, y: 0, pressure: 1, sourceIndex: 1 },
      50,
      pressureModel
    );
    const pressureOnly = advanceStudioResidualInk(
      moved.state,
      { x: 9, y: 0, pressure: 0, sourceIndex: 2 },
      50,
      pressureModel
    );

    expect(moved.dabs).toEqual([]);
    expect(moved.state.distanceRemainder).toBe(9);
    expect(pressureOnly.dabs).toEqual([]);
    expect(pressureOnly.state).toMatchObject({
      previousX: 9,
      previousY: 0,
      previousPressure: 0,
      lastDabX: 0,
      lastDabY: 0,
      distanceRemainder: 9,
    });
  });

  it("shares residual V2 centers and radii exactly with the GPU planner", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2;
    const samples = [
      { x: 0, y: 0, pressure: 1, sourceIndex: 0 },
      { x: 1, y: 0, pressure: 1, sourceIndex: 1 },
      { x: 5, y: 1, pressure: 0.6, sourceIndex: 2 },
      { x: 12, y: 2, pressure: 1, sourceIndex: 3 },
    ] as const;
    const causal = planStudioCausalInkDabs({ samples, size: 16, pressureModel });
    const gpu = planStudioGpuDabs([{
      id: "residual-parity",
      points: samples.flatMap(({ x, y }) => [x, y]),
      pressures: samples.map(({ pressure }) => pressure),
      color: "#000000",
      size: 16,
      pressureModel,
    }]);
    expect(causal.complete).toBe(true);
    expect(gpu.complete).toBe(true);
    expect(gpu.dabs.map(({ x, y, radius }) => ({ x, y, radius }))).toEqual(
      causal.dabs.map(({ x, y, radius }) => ({ x, y, radius }))
    );
  });

  it("combines sample selection and dab planning while failing closed at the dab cap", () => {
    const plan = planStudioCausalInk({
      points: [0, 0, 10, 0],
      pressures: [0.5, 0.5],
      minDistance: 0,
      size: 6,
      maximumDabs: 2,
    });

    expect(plan.samples.map(({ sourceIndex }) => sourceIndex)).toEqual([0, 1]);
    expect(plan.dabs).toHaveLength(2);
    expect(plan.complete).toBe(false);
  });

  it("plans one long V2 flick at the spacing floor without engine argument-count limits", () => {
    // size 5 at average pressure 0.5 hits the exact 0.5px spacing floor, so a single 40,000px
    // segment legally emits 80,000 chord dabs inside the 100k budget. The per-segment append
    // must copy by index: spreading that many dabs as call arguments throws RangeError on JSC
    // (~65k arguments) and V8 (~124k).
    const plan = planStudioCausalInkDabs({
      samples: [
        { x: 0, y: 0, pressure: 0.5, sourceIndex: 0 },
        { x: 40_000, y: 0, pressure: 0.5, sourceIndex: 1 },
      ],
      size: 5,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
    });

    expect(plan.complete).toBe(true);
    expect(plan.dabs).toHaveLength(80_001);
    // Determinism spot checks: initial dab plus an exact 0.5px chord walk toward the endpoint.
    expect(plan.dabs[0]).toMatchObject({ x: 0, y: 0, pressure: 0.5 });
    expect(plan.dabs[1]).toMatchObject({ x: 0.5, y: 0, pressure: 0.5 });
    expect(plan.dabs[40_000]).toMatchObject({ x: 20_000, y: 0, pressure: 0.5 });
    expect(plan.dabs.at(-1)).toMatchObject({ x: 40_000, y: 0, pressure: 0.5 });
    // The indexed append preserves the exact streaming walker output.
    const started = startStudioResidualInk(
      { x: 0, y: 0, pressure: 0.5, sourceIndex: 0 },
      5,
      STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2
    );
    const advanced = advanceStudioResidualInk(
      started.state,
      { x: 40_000, y: 0, pressure: 0.5, sourceIndex: 1 },
      5,
      STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
      100_000 - started.dabs.length
    );
    expect(advanced.complete).toBe(true);
    expect(plan.dabs).toEqual([...started.dabs, ...advanced.dabs]);
  });
});
