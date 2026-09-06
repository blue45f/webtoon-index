import { describe, expect, it } from "vitest";

import {
  createStudioPointerVelocityState,
  createStudioStrokeStabilizerBridge,
  createStudioStrokeStabilizerState,
  describeStudioStabilizerLatency,
  flushStudioStrokeStabilizerEndpoint,
  normalizeStudioStabilizerMode,
  sampleStudioPointerVelocity,
  STUDIO_ADAPTIVE_STABILIZER_BASE_LAG_BUDGET_PX,
  STUDIO_ADAPTIVE_STABILIZER_LAG_BUDGET_PER_STRENGTH_PX,
  STUDIO_POINTER_DEFAULT_SAMPLE_INTERVAL_MS,
  STUDIO_STABILIZER_MIN_TIME_CONSTANT_MS,
  STUDIO_STABILIZER_TIME_CONSTANT_PER_STRENGTH_MS,
  stabilizeStudioStrokeSample,
} from "./studio-stroke-stabilizer";

describe("studio stroke stabilizer", () => {
  it("describes zero-strength input as immediate in every mode", () => {
    for (const mode of ["standard", "adaptive", "precision"] as const) {
      expect(describeStudioStabilizerLatency(mode, 0)).toEqual({
        kind: "instant",
        label: "즉시",
        description: "입력 보정을 우회해 펜 위치를 바로 반영합니다.",
        estimatedMs: 0,
      });
    }
  });

  it("matches the fixed-rate standard filter's conservative 90% response", () => {
    expect(describeStudioStabilizerLatency("standard", 1)).toMatchObject({
      kind: "estimated",
      label: "약 30ms",
      estimatedMs: 30,
    });
    expect(describeStudioStabilizerLatency("standard", 2)).toMatchObject({
      label: "약 40ms",
      estimatedMs: 40,
    });
    expect(describeStudioStabilizerLatency("standard", 3)).toMatchObject({
      label: "약 55ms",
      estimatedMs: 55,
    });
    expect(describeStudioStabilizerLatency("standard", 10)).toMatchObject({
      label: "약 125ms",
      estimatedMs: 125,
    });
  });

  it("uses the same bounded latency class for G-pen, highlighter, and material-brush EMA paths", () => {
    const strength = 10;
    const timeConstantMs =
      STUDIO_STABILIZER_MIN_TIME_CONSTANT_MS
      + strength * STUDIO_STABILIZER_TIME_CONSTANT_PER_STRENGTH_MS;
    expect(timeConstantMs).toBe(56);
    // A first-order filter reaches 90% after ln(10) time constants. Keep the non-causal brush path
    // in the same professional-response class as the fixed-rate strength-10 ceiling (125ms).
    expect(timeConstantMs * Math.log(10)).toBeLessThan(130);

    let state = createStudioStrokeStabilizerState({ x: 0, y: 0, timeStamp: 0 });
    let outputX = 0;
    for (let timeStamp = 5; timeStamp <= 1_000; timeStamp += 5) {
      const result = stabilizeStudioStrokeSample(
        state,
        { x: timeStamp, y: 0, timeStamp },
        { strength, mode: "standard" }
      );
      state = result.state;
      outputX = result.point[0];
    }
    expect(1_000 - outputX).toBeCloseTo(timeConstantMs, 5);
  });

  it("uses honest categorical latency copy for adaptive and precision modes", () => {
    expect(describeStudioStabilizerLatency("adaptive", 6)).toMatchObject({
      kind: "variable",
      label: "가변 반응",
      estimatedMs: null,
    });
    expect(describeStudioStabilizerLatency("precision", 6)).toMatchObject({
      kind: "guided",
      label: "의도적 후행",
      estimatedMs: null,
    });
  });

  it("normalizes modes without accepting arbitrary persisted values", () => {
    expect(normalizeStudioStabilizerMode("standard")).toBe("standard");
    expect(normalizeStudioStabilizerMode("adaptive")).toBe("adaptive");
    expect(normalizeStudioStabilizerMode("precision")).toBe("precision");
    expect(normalizeStudioStabilizerMode("unknown")).toBe("adaptive");
  });

  it("creates a finite deterministic state from malformed input", () => {
    expect(createStudioStrokeStabilizerState({ x: Number.NaN, y: Infinity, timeStamp: -2 })).toEqual({
      rawX: 0,
      rawY: 0,
      outputX: 0,
      outputY: 0,
      timeStamp: 0,
      sampleIntervalMs: STUDIO_POINTER_DEFAULT_SAMPLE_INTERVAL_MS,
    });
  });

  it("measures pointer velocity in CSS pixels per millisecond", () => {
    const start = createStudioPointerVelocityState({ clientX: 10, clientY: 20, timeStamp: 100 });
    const result = sampleStudioPointerVelocity(start, { clientX: 22, clientY: 25, timeStamp: 110 });
    expect(result.distance).toBe(13);
    expect(result.elapsedMs).toBe(10);
    expect(result.speed).toBe(1.3);
    expect(result.state).toEqual({
      clientX: 22,
      clientY: 25,
      timeStamp: 110,
      sampleIntervalMs: 10,
    });
  });

  it("uses a safe cadence for one non-monotonic sample and re-anchors to its native clock", () => {
    const start = createStudioPointerVelocityState({ clientX: 0, clientY: 0, timeStamp: 30 });
    const result = sampleStudioPointerVelocity(start, {
      clientX: Number.NaN,
      clientY: Infinity,
      timeStamp: 20,
    });
    expect(result.distance).toBe(0);
    expect(result.elapsedMs).toBeCloseTo(STUDIO_POINTER_DEFAULT_SAMPLE_INTERVAL_MS, 10);
    expect(result.state.timeStamp).toBe(20);
    expect(Object.values(result.state).every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(result.speed)).toBe(true);
  });

  it("learns a valid hardware cadence without letting a synthetic clock outrun native input", () => {
    const initial = createStudioPointerVelocityState({
      clientX: 0,
      clientY: 0,
      timeStamp: 100,
    });
    const learned = sampleStudioPointerVelocity(initial, {
      clientX: 4,
      clientY: 0,
      timeStamp: 104,
    });
    const repeated = sampleStudioPointerVelocity(learned.state, {
      clientX: 8,
      clientY: 0,
      timeStamp: 104,
    });
    const regressed = sampleStudioPointerVelocity(repeated.state, {
      clientX: 12,
      clientY: 0,
      timeStamp: 90,
    });

    expect(learned.elapsedMs).toBe(4);
    expect(repeated.elapsedMs).toBe(4);
    expect(regressed.elapsedMs).toBe(4);
    expect([learned.speed, repeated.speed, regressed.speed]).toEqual([1, 1, 1]);
    expect([
      learned.state.timeStamp,
      repeated.state.timeStamp,
      regressed.state.timeStamp,
    ]).toEqual([104, 104, 90]);
  });

  it("recovers the very next native delta after a repeated timestamp", () => {
    const initial = createStudioPointerVelocityState({
      clientX: 0,
      clientY: 0,
      timeStamp: 100,
    });
    const learned = sampleStudioPointerVelocity(initial, {
      clientX: 4,
      clientY: 0,
      timeStamp: 104,
    });
    const repeated = sampleStudioPointerVelocity(learned.state, {
      clientX: 8,
      clientY: 0,
      timeStamp: 104,
    });
    const recovered = sampleStudioPointerVelocity(repeated.state, {
      clientX: 12,
      clientY: 0,
      timeStamp: 106,
    });

    expect(repeated.elapsedMs).toBe(4);
    expect(repeated.state.timeStamp).toBe(104);
    expect(recovered.elapsedMs).toBe(2);
    expect(recovered.speed).toBe(2);
    expect(recovered.state).toMatchObject({
      timeStamp: 106,
      sampleIntervalMs: 2,
    });
  });

  it("keeps standard mode compatible with the fixed live stabilizer", () => {
    const state = createStudioStrokeStabilizerState({ x: 0, y: 0, timeStamp: 0 });
    const result = stabilizeStudioStrokeSample(state, { x: 100, y: 0, timeStamp: 16 }, {
      strength: 6,
      mode: "standard",
    });
    expect(result.point[0]).toBeGreaterThan(0);
    expect(result.point[0]).toBeLessThan(100);
    expect(result.point[1]).toBe(0);
    expect(result.effectiveStrength).toBe(6);
  });

  it("keeps a moving standard EMA stroke stable across pointer sample rates", () => {
    const followRampFor = (sampleCount: number) => {
      const durationMs = 100;
      let state = createStudioStrokeStabilizerState({ x: 0, y: 0, timeStamp: 0 });
      let output = 0;
      for (let index = 1; index <= sampleCount; index++) {
        const progress = index / sampleCount;
        const result = stabilizeStudioStrokeSample(
          state,
          { x: 100 * progress, y: 0, timeStamp: durationMs * progress },
          { strength: 7, mode: "standard" }
        );
        state = result.state;
        output = result.point[0];
      }
      return output;
    };

    const at60Hz = followRampFor(6);
    expect(at60Hz).toBeCloseTo(followRampFor(12), 10);
    expect(at60Hz).toBeCloseTo(followRampFor(24), 10);
  });

  it("reduces lag for a fast adaptive sample and increases stability for a slow one", () => {
    const state = createStudioStrokeStabilizerState({ x: 0, y: 0, timeStamp: 0 });
    const slow = stabilizeStudioStrokeSample(state, { x: 1, y: 0, timeStamp: 16 }, {
      strength: 8,
      mode: "adaptive",
    });
    const fast = stabilizeStudioStrokeSample(state, { x: 64, y: 0, timeStamp: 16 }, {
      strength: 8,
      mode: "adaptive",
    });
    expect(slow.effectiveStrength).toBeGreaterThan(8);
    expect(fast.effectiveStrength).toBeLessThan(8);
    expect(fast.point[0] / 64).toBeGreaterThan(slow.point[0]);
  });

  it("bounds adaptive steady-state trail in CSS pixels at ordinary and fast drawing speeds", () => {
    const strength = 8;
    const lagBudget =
      STUDIO_ADAPTIVE_STABILIZER_BASE_LAG_BUDGET_PX
      + strength * STUDIO_ADAPTIVE_STABILIZER_LAG_BUDGET_PER_STRENGTH_PX;

    const followConstantVelocity = (speed: number) => {
      const stepMs = 5;
      let state = createStudioStrokeStabilizerState({ x: 0, y: 0, timeStamp: 0 });
      let outputX = 0;
      for (let timeStamp = stepMs; timeStamp <= 1_000; timeStamp += stepMs) {
        const result = stabilizeStudioStrokeSample(
          state,
          { x: speed * timeStamp, y: 0, timeStamp },
          { strength, mode: "adaptive", coordinateScale: 1 }
        );
        state = result.state;
        outputX = result.point[0];
      }
      return speed * 1_000 - outputX;
    };

    for (const speed of [0.25, 0.5, 1, 2]) {
      const lag = followConstantVelocity(speed);
      expect(lag, `${speed}px/ms adaptive trail`).toBeGreaterThanOrEqual(0);
      expect(lag, `${speed}px/ms adaptive trail`).toBeLessThanOrEqual(lagBudget + 0.05);
    }
  });

  it("normalizes adaptive speed and precision radius to CSS pixels across zoom levels", () => {
    const state = createStudioStrokeStabilizerState({ x: 0, y: 0, timeStamp: 0 });
    const adaptiveAt1x = stabilizeStudioStrokeSample(
      state,
      { x: 40, y: 0, timeStamp: 16 },
      { strength: 8, mode: "adaptive", coordinateScale: 1 }
    );
    const adaptiveAt2x = stabilizeStudioStrokeSample(
      state,
      { x: 20, y: 0, timeStamp: 16 },
      { strength: 8, mode: "adaptive", coordinateScale: 2 }
    );
    expect(adaptiveAt1x.effectiveStrength).toBeCloseTo(adaptiveAt2x.effectiveStrength, 10);
    expect(adaptiveAt1x.point[0]).toBeCloseTo(adaptiveAt2x.point[0] * 2, 10);

    const precisionAt1x = stabilizeStudioStrokeSample(
      state,
      { x: 40, y: 0, timeStamp: 16 },
      { strength: 8, mode: "precision", coordinateScale: 1 }
    );
    const precisionAt2x = stabilizeStudioStrokeSample(
      state,
      { x: 20, y: 0, timeStamp: 16 },
      { strength: 8, mode: "precision", coordinateScale: 2 }
    );
    expect(precisionAt1x.point[0]).toBeCloseTo(precisionAt2x.point[0] * 2, 10);
  });

  it("uses a virtual guide radius in precision mode", () => {
    const state = createStudioStrokeStabilizerState({ x: 10, y: 20, timeStamp: 0 });
    const inside = stabilizeStudioStrokeSample(state, { x: 12, y: 20, timeStamp: 16 }, {
      strength: 8,
      mode: "precision",
    });
    expect(inside.point).toEqual([10, 20]);

    const outside = stabilizeStudioStrokeSample(state, { x: 80, y: 20, timeStamp: 16 }, {
      strength: 8,
      mode: "precision",
    });
    expect(outside.point[0]).toBeGreaterThan(10);
    expect(outside.point[0]).toBeLessThan(80);
    expect(outside.point[1]).toBe(20);
  });

  it("updates raw timing even when precision output stays in its dead-zone", () => {
    const initial = createStudioStrokeStabilizerState({ x: 0, y: 0, timeStamp: 0 });
    const first = stabilizeStudioStrokeSample(initial, { x: 2, y: 1, timeStamp: 10 }, {
      strength: 10,
      mode: "precision",
    });
    expect(first.point).toEqual([0, 0]);
    expect(first.state.rawX).toBe(2);
    expect(first.state.rawY).toBe(1);
    expect(first.state.timeStamp).toBe(10);
  });

  it("keeps adaptive geometry monotonic while its timing baseline follows the native clock", () => {
    const initial = createStudioStrokeStabilizerState({ x: 0, y: 0, timeStamp: 100 });
    const learned = stabilizeStudioStrokeSample(
      initial,
      { x: 4, y: 0, timeStamp: 104 },
      { strength: 6, mode: "adaptive" }
    );
    const repeated = stabilizeStudioStrokeSample(
      learned.state,
      { x: 8, y: 0, timeStamp: 104 },
      { strength: 6, mode: "adaptive" }
    );
    const regressed = stabilizeStudioStrokeSample(
      repeated.state,
      { x: 12, y: 0, timeStamp: 80 },
      { strength: 6, mode: "adaptive" }
    );

    expect([
      learned.state.sampleIntervalMs,
      repeated.state.sampleIntervalMs,
      regressed.state.sampleIntervalMs,
    ]).toEqual([4, 4, 4]);
    expect([
      learned.state.timeStamp,
      repeated.state.timeStamp,
      regressed.state.timeStamp,
    ]).toEqual([104, 104, 80]);
    expect([learned.speed, repeated.speed, regressed.speed]).toEqual([1, 1, 1]);
    expect(regressed.point[0]).toBeGreaterThan(repeated.point[0]);
  });

  it("returns raw points when strength is zero in every mode", () => {
    for (const mode of ["standard", "adaptive", "precision"] as const) {
      const state = createStudioStrokeStabilizerState({ x: 1, y: 2, timeStamp: 0 });
      const result = stabilizeStudioStrokeSample(state, { x: 30, y: 40, timeStamp: 20 }, { strength: 0, mode });
      expect(result.point).toEqual([30, 40]);
    }
  });

  it("flushes a lagging live filter to the finite raw endpoint on pointer release", () => {
    const initial = createStudioStrokeStabilizerState({ x: 0, y: 0, timeStamp: 0 });
    const lagging = stabilizeStudioStrokeSample(
      initial,
      { x: 100, y: 35, timeStamp: 16 },
      { strength: 9, mode: "standard" }
    );
    expect(lagging.point[0]).toBeLessThan(100);

    const flushed = flushStudioStrokeStabilizerEndpoint(lagging.state);
    expect(flushed.point).toEqual([100, 35]);
    expect(flushed.state).toEqual({
      rawX: 100,
      rawY: 35,
      outputX: 100,
      outputY: 35,
      timeStamp: 16,
      sampleIntervalMs: 16,
    });
  });

  it("sanitizes malformed endpoint state without producing non-finite coordinates", () => {
    const flushed = flushStudioStrokeStabilizerEndpoint({
      rawX: Number.NaN,
      rawY: Infinity,
      outputX: 7,
      outputY: 9,
      timeStamp: -1,
      sampleIntervalMs: Number.NaN,
    });
    expect(flushed.point).toEqual([7, 9]);
    expect(Object.values(flushed.state).every(Number.isFinite)).toBe(true);
  });

  it("sanitizes malformed samples and remains deterministic", () => {
    const state = {
      rawX: Number.NaN,
      rawY: Infinity,
      outputX: 5,
      outputY: 7,
      timeStamp: Number.NaN,
      sampleIntervalMs: Number.NaN,
    };
    const input = { x: Number.NaN, y: Infinity, timeStamp: Number.NaN };
    const options = { strength: Number.POSITIVE_INFINITY, mode: "adaptive" as const };
    const first = stabilizeStudioStrokeSample(state, input, options);
    const second = stabilizeStudioStrokeSample(state, input, options);
    expect(first).toEqual(second);
    expect(Object.values(first.state).every(Number.isFinite)).toBe(true);
    expect(first.point.every(Number.isFinite)).toBe(true);
  });

  it("keeps lazy precision opt-in and preserves the exact first committed point", () => {
    const bridge = createStudioStrokeStabilizerBridge();
    const first = bridge.commit(
      { x: 17, y: 23, timeStamp: 10, pointerType: "pen", pointerId: 7 },
      {
        strength: 8,
        mode: "precision",
        useLazyPrecision: true,
      }
    );
    const insideRadius = bridge.commit(
      { x: 24, y: 23, timeStamp: 18, pointerType: "pen", pointerId: 7 },
      {
        strength: 8,
        mode: "precision",
        useLazyPrecision: true,
      }
    );

    expect(first).toMatchObject({
      accepted: true,
      provider: "lazy-brush",
      phase: "committed",
      point: [17, 23],
    });
    expect(insideRadius.point).toEqual([17, 23]);
  });

  it("does not let lazy precision previews mutate the next committed sample", () => {
    const options = {
      strength: 7,
      mode: "precision" as const,
      useLazyPrecision: true,
      lazyFriction: 0.35,
    };
    const withPrediction = createStudioStrokeStabilizerBridge();
    const control = createStudioStrokeStabilizerBridge();
    const initialSamples = [
      { x: 0, y: 0, timeStamp: 0, pointerType: "mouse" as const, pointerId: 1 },
      { x: 70, y: 8, timeStamp: 8, pointerType: "mouse" as const, pointerId: 1 },
    ];
    for (const sample of initialSamples) {
      withPrediction.commit(sample, options);
      control.commit(sample, options);
    }

    const beforePreview = withPrediction.flush();
    expect(beforePreview?.point).toEqual([70, 8]);
    // Rebuild both bridges after the endpoint assertion so their committed histories are equal.
    withPrediction.reset();
    control.reset();
    for (const sample of initialSamples) {
      withPrediction.commit(sample, options);
      control.commit(sample, options);
    }

    const preview = withPrediction.preview(
      { x: 190, y: 90, timeStamp: 12, pointerType: "mouse", pointerId: 1 },
      options
    );
    const secondPreview = withPrediction.preview(
      { x: -80, y: 160, timeStamp: 13, pointerType: "mouse", pointerId: 1 },
      options
    );
    const nextSample = {
      x: 105,
      y: 30,
      timeStamp: 16,
      pointerType: "mouse" as const,
      pointerId: 1,
    };
    const predictedNext = withPrediction.preview(nextSample, options);
    const actualAfterPredictions = withPrediction.commit(nextSample, options);
    const controlActual = control.commit(nextSample, options);

    expect(preview.phase).toBe("preview");
    expect(secondPreview.phase).toBe("preview");
    expect(predictedNext.point[0]).toBeCloseTo(controlActual.point[0], 12);
    expect(predictedNext.point[1]).toBeCloseTo(controlActual.point[1], 12);
    expect(actualAfterPredictions).toEqual(controlActual);
  });

  it("flushes lazy precision to the real pointer-up endpoint", () => {
    const bridge = createStudioStrokeStabilizerBridge();
    const options = {
      strength: 10,
      mode: "precision" as const,
      useLazyPrecision: true,
    };
    bridge.commit(
      { x: 0, y: 0, timeStamp: 0, pointerType: "mouse" },
      options
    );
    const lagging = bridge.commit(
      { x: 120, y: 45, timeStamp: 16, pointerType: "mouse" },
      options
    );
    expect(lagging.point).not.toEqual([120, 45]);

    expect(bridge.flush()).toMatchObject({
      accepted: true,
      provider: "lazy-brush",
      phase: "flushed",
      point: [120, 45],
      state: {
        rawX: 120,
        rawY: 45,
        outputX: 120,
        outputY: 45,
      },
    });
  });

  it("fails closed on malformed bridge samples without poisoning committed state", () => {
    const bridge = createStudioStrokeStabilizerBridge();
    const options = {
      strength: 6,
      mode: "precision" as const,
      useLazyPrecision: true,
    };
    bridge.commit(
      { x: 10, y: 20, timeStamp: 0, pointerType: "mouse" },
      options
    );
    const rejected = bridge.commit(
      { x: Number.NaN, y: Infinity, timeStamp: 4, pointerType: "mouse" },
      options
    );
    const afterRejectedPreview = bridge.preview(
      { x: 80, y: 20, timeStamp: 8, pointerType: "mouse" },
      options
    );

    expect(rejected).toMatchObject({
      accepted: false,
      point: [10, 20],
      state: {
        rawX: 10,
        rawY: 20,
        outputX: 10,
        outputY: 20,
      },
    });
    expect(afterRejectedPreview.accepted).toBe(true);
    expect(afterRejectedPreview.point.every(Number.isFinite)).toBe(true);
  });

  it("keeps the bridge on the legacy pure provider unless explicitly enabled", () => {
    const bridge = createStudioStrokeStabilizerBridge();
    bridge.commit(
      { x: 0, y: 0, timeStamp: 0, pointerType: "mouse" },
      { strength: 8, mode: "precision" }
    );
    const result = bridge.commit(
      { x: 80, y: 0, timeStamp: 16, pointerType: "mouse" },
      { strength: 8, mode: "precision" }
    );
    const pureState = createStudioStrokeStabilizerState({
      x: 0,
      y: 0,
      timeStamp: 0,
    });
    const pure = stabilizeStudioStrokeSample(
      pureState,
      { x: 80, y: 0, timeStamp: 16 },
      { strength: 8, mode: "precision" }
    );

    expect(result).toMatchObject({
      accepted: true,
      provider: "pure",
      phase: "committed",
      point: pure.point,
      state: pure.state,
    });
  });
});
