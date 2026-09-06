import { describe, expect, it } from "vitest";

import {
  STUDIO_PREDICTOR_DEFAULTS,
  createStudioLowLatencyPredictor,
  evaluateStudioNoPrediction,
  evaluateStudioPredictor,
  resolveStudioPredictorOptions,
  studioPredictionErrorMetrics,
  studioSamplePathAt,
  type StudioPredictorSample,
} from "./studio-lowlatency-predictor";

const DT = 8;

/** Builds a 1D path along +x from a per-step speed profile in px/ms. */
function fromSpeeds(speeds: readonly number[]): StudioPredictorSample[] {
  const points: StudioPredictorSample[] = [{ x: 400, y: 300, timeStamp: 0 }];
  let x = 400;
  for (const [index, speed] of speeds.entries()) {
    x += speed * DT;
    points.push({ x, y: 300, timeStamp: (index + 1) * DT });
  }
  return points;
}

function straight(): StudioPredictorSample[] {
  return fromSpeeds(Array.from({ length: 39 }, () => 2));
}

function arc(): StudioPredictorSample[] {
  return Array.from({ length: 60 }, (_unused, index) => {
    const t = index * DT;
    return {
      x: 400 + 200 * Math.cos(0.004 * t),
      y: 400 + 200 * Math.sin(0.004 * t),
      timeStamp: t,
    };
  });
}

/** Decelerate into a hairpin, reverse, accelerate away — the realistic direction reversal. */
function cusp(): StudioPredictorSample[] {
  const speeds: number[] = [];
  for (let index = 0; index < 12; index += 1) speeds.push(2 - index * 0.15);
  for (let index = 0; index < 12; index += 1) speeds.push(-(index + 1) * 0.15);
  return fromSpeeds(speeds);
}

/** Instantaneous 180-degree flip at full speed — the worst case a digitiser can report. */
function hardReversal(): StudioPredictorSample[] {
  const speeds: number[] = [];
  for (let index = 0; index < 20; index += 1) speeds.push(2);
  for (let index = 0; index < 20; index += 1) speeds.push(-2);
  return fromSpeeds(speeds);
}

function zigzag(): StudioPredictorSample[] {
  const speeds: number[] = [];
  for (let cycle = 0; cycle < 6; cycle += 1) {
    for (let step = 0; step < 5; step += 1) speeds.push(cycle % 2 === 0 ? 2 : -2);
  }
  return fromSpeeds(speeds);
}

describe("studio low latency predictor", () => {
  it("reproduces constant-velocity motion exactly at every supported horizon", () => {
    for (const horizon of [4, 8, 16]) {
      const metrics = evaluateStudioPredictor(straight(), horizon);
      expect(metrics.count).toBeGreaterThan(30);
      expect(metrics.maxError).toBeCloseTo(0, 9);
      expect(metrics.maxOvershoot).toBeCloseTo(0, 9);
    }
  });

  it("beats the do-nothing baseline on smooth motion by more than an order of magnitude", () => {
    const predicted = evaluateStudioPredictor(arc(), 8);
    const baseline = evaluateStudioNoPrediction(arc(), 8);

    expect(baseline.meanError).toBeCloseTo(6.4, 1);
    expect(predicted.meanError).toBeLessThan(0.3);
    expect(predicted.meanError * 20).toBeLessThan(baseline.meanError);
    // Sub-pixel overshoot on a curve: the tail sits inside the true arc, never visibly ahead.
    expect(predicted.maxOvershoot).toBeLessThan(0.01);
  });

  it("stays better than doing nothing at every horizon the clamp allows", () => {
    for (const path of [straight(), arc(), cusp(), hardReversal(), zigzag()]) {
      for (const horizon of [8, 16]) {
        const predicted = evaluateStudioPredictor(path, horizon);
        const baseline = evaluateStudioNoPrediction(path, horizon);
        expect(predicted.count).toBe(baseline.count);
        expect(predicted.meanError).toBeLessThanOrEqual(baseline.meanError);
      }
    }
  });

  it("bounds overshoot at a realistic cusp to a fraction of the per-frame travel", () => {
    const metrics = evaluateStudioPredictor(cusp(), 8);
    // Pen speed entering the cusp is 2px/ms, so an unguarded frame of travel is 16px.
    expect(metrics.maxOvershoot).toBeLessThan(5);
    expect(metrics.meanOvershoot).toBeLessThan(0.5);
    expect(metrics.meanError).toBeLessThan(2);
  });

  it("keeps hard-reversal overshoot within the causal floor of one horizon of travel", () => {
    for (const horizon of [8, 16]) {
      const metrics = evaluateStudioPredictor(hardReversal(), horizon);
      // The apex sample itself is causally unpredictable: nothing in the history says the pen is
      // about to flip. The bound that matters is that the damage never exceeds 2x the horizon's
      // travel (predicted one horizon forward while truth moved one horizon back), and that it
      // happens on a vanishing fraction of samples.
      const horizonTravel = 2 * horizon;
      expect(metrics.maxOvershoot).toBeLessThanOrEqual(2 * horizonTravel);
      expect(metrics.overshootRate).toBeLessThan(0.06);
    }
  });

  it("collapses the prediction to the tip once the direction gate is armed", () => {
    const gated = createStudioLowLatencyPredictor({ directionTrustFloor: 0.2 });
    for (const point of hardReversal().slice(0, 22)) gated.push(point);

    // Sample 21 is the first post-flip sample; the heading cosine is -1.
    expect(gated.directionCosine()).toBeCloseTo(-1, 6);
    expect(gated.directionTrust()).toBe(0);
    const prediction = gated.predict(8);
    expect(prediction).not.toBeNull();
    expect(prediction?.x).toBeCloseTo(hardReversal()[21]?.x ?? 0, 9);
    expect(prediction?.trust).toBe(0);
  });

  it("reduces overshoot rate at slow smoothing, which is when the gate is worth its cost", () => {
    const cases: readonly { readonly path: StudioPredictorSample[]; readonly name: string }[] = [
      { path: arc(), name: "arc" },
      { path: cusp(), name: "cusp" },
      { path: zigzag(), name: "zigzag" },
    ];

    for (const { path, name } of cases) {
      const gateOff = evaluateStudioPredictor(path, 8, { smoothing: 0.25 });
      const gateOn = evaluateStudioPredictor(path, 8, {
        smoothing: 0.25,
        directionTrustFloor: 0.2,
      });
      expect(gateOn.overshootRate, name).toBeLessThan(gateOff.overshootRate);
      expect(gateOn.meanOvershoot, name).toBeLessThan(gateOff.meanOvershoot);
    }
  });

  it("documents that the gate buys nothing at the default smoothing", () => {
    // This is why STUDIO_PREDICTOR_DEFAULTS ships with the gate disabled. If a future tuning change
    // makes gating win here, this expectation flips and the default should be revisited.
    expect(STUDIO_PREDICTOR_DEFAULTS.directionTrustFloor).toBe(-1);
    const gateOff = evaluateStudioPredictor(zigzag(), 8);
    const gateOn = evaluateStudioPredictor(zigzag(), 8, { directionTrustFloor: 0.2 });

    expect(gateOn.maxOvershoot).toBe(gateOff.maxOvershoot);
    expect(gateOn.overshootRate).toBe(gateOff.overshootRate);
    expect(gateOn.meanError).toBeGreaterThan(gateOff.meanError);
  });

  it("clamps the lead when a driver glitch reports an enormous instantaneous velocity", () => {
    const predictor = createStudioLowLatencyPredictor();
    predictor.push({ x: 100, y: 50, timeStamp: 0 });
    predictor.push({ x: 116, y: 50, timeStamp: 8 });
    // 656px in 0.06ms: a plausible-looking but physically impossible digitiser report.
    predictor.push({ x: 772, y: 50, timeStamp: 8.06 });

    const prediction = predictor.predict(16);
    expect(prediction).not.toBeNull();
    expect(prediction?.clamped).toBe(true);
    const lead = Math.hypot((prediction?.x ?? 0) - 772, (prediction?.y ?? 0) - 50);
    expect(lead).toBeLessThanOrEqual(STUDIO_PREDICTOR_DEFAULTS.maxLeadPx + 1e-9);
  });

  it("predicts nothing once the pen has stopped moving", () => {
    const predictor = createStudioLowLatencyPredictor();
    predictor.push({ x: 100, y: 50, timeStamp: 0 });
    predictor.push({ x: 132, y: 50, timeStamp: 8 });
    predictor.push({ x: 132, y: 50, timeStamp: 16 });
    predictor.push({ x: 132, y: 50, timeStamp: 24 });

    const prediction = predictor.predict(16);
    expect(prediction).not.toBeNull();
    expect(Math.hypot((prediction?.x ?? 0) - 132, (prediction?.y ?? 0) - 50)).toBe(0);
  });

  it("refuses to predict before it has a velocity, and refuses a zero horizon", () => {
    const predictor = createStudioLowLatencyPredictor();
    expect(predictor.predict(8)).toBeNull();
    predictor.push({ x: 10, y: 10, timeStamp: 0 });
    expect(predictor.predict(8)).toBeNull();
    predictor.push({ x: 26, y: 10, timeStamp: 8 });
    expect(predictor.predict(8)).not.toBeNull();
    expect(predictor.predict(0)).toBeNull();
  });

  it("clamps a requested horizon to the measured operating bound", () => {
    const predictor = createStudioLowLatencyPredictor();
    predictor.push({ x: 0, y: 0, timeStamp: 0 });
    predictor.push({ x: 16, y: 0, timeStamp: 8 });

    expect(STUDIO_PREDICTOR_DEFAULTS.maxHorizonMs).toBe(16);
    expect(predictor.predict(1_000)?.horizonMs).toBe(16);
    // A non-finite horizon is a caller bug, not a request for the maximum: it resolves to 0 and
    // therefore to no prediction at all.
    expect(predictor.predict(Number.NaN)).toBeNull();
    expect(predictor.predict(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("survives degenerate, regressing, and non-finite sample channels", () => {
    const predictor = createStudioLowLatencyPredictor();
    predictor.push({ x: 0, y: 0, timeStamp: 0 });
    predictor.push({ x: 16, y: 0, timeStamp: 8 });
    const healthy = predictor.predict(8);

    predictor.push({ x: Number.NaN, y: 5, timeStamp: 16 });
    expect(predictor.predict(8)).toEqual(healthy);

    // Repeated timestamp: position advances, kinematics are left alone rather than exploding.
    predictor.push({ x: 32, y: 0, timeStamp: 8 });
    const afterDegenerate = predictor.predict(8);
    expect(afterDegenerate).not.toBeNull();
    expect(Number.isFinite(afterDegenerate?.x ?? Number.NaN)).toBe(true);
    expect(Number.isFinite(afterDegenerate?.y ?? Number.NaN)).toBe(true);
  });

  it("produces an identical tail for an identical sample sequence", () => {
    const path = zigzag();
    const runTail = () => {
      const predictor = createStudioLowLatencyPredictor();
      const tail: number[] = [];
      for (const point of path) {
        predictor.push(point);
        for (const predictedPoint of predictor.predictTail(16, 3)) {
          tail.push(predictedPoint.x, predictedPoint.y, predictedPoint.trust);
        }
      }
      return tail;
    };

    expect(runTail()).toEqual(runTail());
    expect(runTail().length).toBeGreaterThan(0);
  });

  it("emits an evenly spaced, nearest-first tail", () => {
    const predictor = createStudioLowLatencyPredictor();
    predictor.push({ x: 0, y: 0, timeStamp: 0 });
    predictor.push({ x: 16, y: 0, timeStamp: 8 });

    const tail = predictor.predictTail(16, 4);
    expect(tail).toHaveLength(4);
    expect(tail.map((point) => point.horizonMs)).toEqual([4, 8, 12, 16]);
    for (let index = 1; index < tail.length; index += 1) {
      expect(tail[index]?.x).toBeGreaterThan(tail[index - 1]?.x ?? 0);
    }
    expect(predictor.predictTail(16, 0)).toEqual([]);
    expect(predictor.predictTail(0, 4)).toEqual([]);
  });

  it("resets to a cold predictor", () => {
    const predictor = createStudioLowLatencyPredictor();
    predictor.push({ x: 0, y: 0, timeStamp: 0 });
    predictor.push({ x: 16, y: 0, timeStamp: 8 });
    expect(predictor.sampleCount).toBe(2);
    predictor.reset();
    expect(predictor.sampleCount).toBe(0);
    expect(predictor.predict(8)).toBeNull();
  });

  it("normalizes hostile options instead of trusting them", () => {
    const resolved = resolveStudioPredictorOptions({
      smoothing: 9,
      velocityGain: -3,
      accelerationTrust: Number.NaN,
      directionTrustFloor: 42,
      maxLeadPx: -1,
      maxHorizonMs: Number.POSITIVE_INFINITY,
      minSampleDeltaMs: -5,
    });

    expect(resolved.smoothing).toBe(1);
    expect(resolved.velocityGain).toBe(0);
    expect(resolved.accelerationTrust).toBe(STUDIO_PREDICTOR_DEFAULTS.accelerationTrust);
    expect(resolved.directionTrustFloor).toBe(0.999);
    expect(resolved.maxLeadPx).toBe(0);
    expect(resolved.maxHorizonMs).toBe(STUDIO_PREDICTOR_DEFAULTS.maxHorizonMs);
    expect(resolved.minSampleDeltaMs).toBe(0);
  });
});

describe("studio prediction error metrics", () => {
  it("scores a perfect prediction as zero on every channel", () => {
    const metrics = studioPredictionErrorMetrics([
      { predictedX: 10, predictedY: 0, actualX: 10, actualY: 0, originX: 0, originY: 0, horizonMs: 8, trust: 1 },
      { predictedX: 20, predictedY: 0, actualX: 20, actualY: 0, originX: 10, originY: 0, horizonMs: 8, trust: 1 },
    ]);

    expect(metrics).toMatchObject({
      count: 2,
      meanError: 0,
      maxError: 0,
      meanOvershoot: 0,
      maxOvershoot: 0,
      overshootRate: 0,
      maxLateral: 0,
    });
  });

  it("separates forward overshoot from lateral deviation", () => {
    const overshooting = studioPredictionErrorMetrics([
      { predictedX: 15, predictedY: 0, actualX: 10, actualY: 0, originX: 0, originY: 0, horizonMs: 8, trust: 1 },
    ]);
    const sideways = studioPredictionErrorMetrics([
      { predictedX: 10, predictedY: 0, actualX: 10, actualY: 5, originX: 0, originY: 0, horizonMs: 8, trust: 1 },
    ]);

    expect(overshooting.maxOvershoot).toBeCloseTo(5, 9);
    expect(overshooting.maxLateral).toBeCloseTo(0, 9);
    expect(sideways.maxOvershoot).toBeCloseTo(0, 9);
    expect(sideways.maxLateral).toBeCloseTo(5, 9);
  });

  it("reports an undershoot as negative overshoot rather than as a false artifact", () => {
    const metrics = studioPredictionErrorMetrics([
      { predictedX: 6, predictedY: 0, actualX: 10, actualY: 0, originX: 0, originY: 0, horizonMs: 8, trust: 1 },
    ]);

    expect(metrics.maxError).toBeCloseTo(4, 9);
    expect(metrics.maxOvershoot).toBeCloseTo(-4, 9);
    expect(metrics.overshootRate).toBe(0);
  });

  it("scores a collapsed prediction as pure error with no overshoot", () => {
    const metrics = studioPredictionErrorMetrics([
      { predictedX: 0, predictedY: 0, actualX: 10, actualY: 0, originX: 0, originY: 0, horizonMs: 8, trust: 0 },
    ]);

    expect(metrics.maxError).toBeCloseTo(10, 9);
    expect(metrics.maxOvershoot).toBe(0);
    expect(metrics.overshootRate).toBe(0);
  });

  it("uses nearest-rank percentiles over the observed values", () => {
    const metrics = studioPredictionErrorMetrics(
      [1, 2, 3, 4, 100].map((error) => ({
        predictedX: error,
        predictedY: 0,
        actualX: 0,
        actualY: 0,
        originX: -1,
        originY: 0,
        horizonMs: 8,
        trust: 1,
      }))
    );

    expect(metrics.count).toBe(5);
    expect(metrics.p50Error).toBe(3);
    expect(metrics.p95Error).toBe(100);
    expect(metrics.maxError).toBe(100);
    expect(metrics.meanError).toBe(22);
  });

  it("skips non-finite observations and returns zeros for an empty series", () => {
    expect(studioPredictionErrorMetrics([]).count).toBe(0);
    expect(studioPredictionErrorMetrics([
      { predictedX: Number.NaN, predictedY: 0, actualX: 0, actualY: 0, originX: 0, originY: 0, horizonMs: 8, trust: 1 },
    ]).count).toBe(0);
  });
});

describe("studio sample path interpolation", () => {
  it("interpolates linearly between bracketing samples and clamps at the ends", () => {
    const path: StudioPredictorSample[] = [
      { x: 0, y: 0, timeStamp: 0 },
      { x: 10, y: 20, timeStamp: 10 },
    ];

    expect(studioSamplePathAt(path, -5)).toEqual({ x: 0, y: 0 });
    expect(studioSamplePathAt(path, 5)).toEqual({ x: 5, y: 10 });
    expect(studioSamplePathAt(path, 99)).toEqual({ x: 10, y: 20 });
    expect(studioSamplePathAt([], 1)).toBeNull();
  });

  it("resolves a zero-width span to the later sample instead of dividing by zero", () => {
    const path: StudioPredictorSample[] = [
      { x: 0, y: 0, timeStamp: 0 },
      { x: 5, y: 5, timeStamp: 5 },
      { x: 9, y: 9, timeStamp: 5 },
      { x: 20, y: 20, timeStamp: 10 },
    ];

    expect(studioSamplePathAt(path, 5)).toEqual({ x: 5, y: 5 });
  });
});
