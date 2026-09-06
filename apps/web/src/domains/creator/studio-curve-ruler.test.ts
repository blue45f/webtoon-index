import { describe, expect, it } from "vitest";

import {
  beginStudioCurveSnapSession,
  canonicalizeStudioCurveRuler,
  derivativeStudioCubicBezier,
  evaluateStudioCubicBezier,
  evaluateStudioCurveParallelOffset,
  mirrorStudioCurveRulerHorizontally,
  mirrorStudioCurveSnapSessionHorizontally,
  projectPointOntoStudioCubicBezier,
  sampleStudioCurveParallelOffset,
  secondDerivativeStudioCubicBezier,
  snapStudioCurvePoint,
  type StudioCurveRuler,
} from "./studio-curve-ruler";

const lineRuler = (overrides: Partial<StudioCurveRuler> = {}): StudioCurveRuler => ({
  id: "curve-a",
  p0: { x: 0, y: 0 },
  p1: { x: 100 / 3, y: 0 },
  p2: { x: 200 / 3, y: 0 },
  p3: { x: 100, y: 0 },
  ...overrides,
});

describe("studio curve ruler cubic geometry", () => {
  it("evaluates endpoints, midpoint, first derivative and second derivative", () => {
    const curve = lineRuler();
    expect(evaluateStudioCubicBezier(curve, 0)).toEqual({ x: 0, y: 0 });
    expect(evaluateStudioCubicBezier(curve, 1)).toEqual({ x: 100, y: 0 });
    expect(evaluateStudioCubicBezier(curve, 0.5)?.x).toBeCloseTo(50, 10);
    expect(derivativeStudioCubicBezier(curve, 0.5)).toEqual({ x: 100, y: 0 });
    expect(secondDerivativeStudioCubicBezier(curve, 0.5)?.x).toBeCloseTo(0, 10);
    expect(secondDerivativeStudioCubicBezier(curve, 0.5)?.y).toBeCloseTo(0, 10);
  });

  it("clamps finite t and fails invalid geometry or parameters closed", () => {
    const curve = lineRuler();
    expect(evaluateStudioCubicBezier(curve, -2)).toEqual({ x: 0, y: 0 });
    expect(evaluateStudioCubicBezier(curve, 4)).toEqual({ x: 100, y: 0 });
    expect(evaluateStudioCubicBezier(curve, Number.NaN)).toBeNull();
    expect(derivativeStudioCubicBezier({ ...curve, p2: { x: Infinity, y: 0 } }, 0.5)).toBeNull();
  });

  it("canonicalizes and freezes safe rulers, rejecting collapsed and accessor-backed input", () => {
    const ruler = canonicalizeStudioCurveRuler(lineRuler());
    expect(ruler).toEqual(lineRuler());
    expect(Object.isFrozen(ruler)).toBe(true);
    expect(Object.isFrozen(ruler?.p1)).toBe(true);
    expect(canonicalizeStudioCurveRuler({
      id: "collapsed",
      p0: { x: 1, y: 1 },
      p1: { x: 1, y: 1 },
      p2: { x: 1, y: 1 },
      p3: { x: 1, y: 1 },
    })).toBeNull();

    let getterCalls = 0;
    const hostile = {
      id: "hostile",
      get p0() {
        getterCalls += 1;
        return { x: 0, y: 0 };
      },
      p1: { x: 1, y: 0 },
      p2: { x: 2, y: 0 },
      p3: { x: 3, y: 0 },
    };
    expect(canonicalizeStudioCurveRuler(hostile)).toBeNull();
    expect(getterCalls).toBe(0);
  });
});

describe("studio curve ruler nearest projection", () => {
  it("projects onto a straight cubic and preserves endpoint minima", () => {
    const middle = projectPointOntoStudioCubicBezier(lineRuler(), { x: 46, y: 17 });
    expect(middle?.point.x).toBeCloseTo(46, 7);
    expect(middle?.point.y).toBeCloseTo(0, 10);
    expect(middle?.distance).toBeCloseTo(17, 7);

    const before = projectPointOntoStudioCubicBezier(lineRuler(), { x: -20, y: 3 });
    expect(before?.t).toBe(0);
    expect(before?.point).toEqual({ x: 0, y: 0 });
    const after = projectPointOntoStudioCubicBezier(lineRuler(), { x: 130, y: -4 });
    expect(after?.t).toBe(1);
    expect(after?.point).toEqual({ x: 100, y: 0 });
  });

  it("uses sampled local minima plus Newton refinement on a strongly curved cubic", () => {
    const curve: StudioCurveRuler = {
      id: "arch",
      p0: { x: 0, y: 0 },
      p1: { x: 0, y: 180 },
      p2: { x: 200, y: 180 },
      p3: { x: 200, y: 0 },
    };
    const coarse = projectPointOntoStudioCubicBezier(curve, { x: 93, y: 103 }, {
      samples: 16,
      newtonIterations: 0,
    });
    const refined = projectPointOntoStudioCubicBezier(curve, { x: 93, y: 103 }, {
      samples: 16,
      newtonIterations: 12,
    });
    expect(refined).not.toBeNull();
    expect(refined!.distance).toBeLessThanOrEqual(coarse!.distance);
    const tangentDot = (refined!.point.x - 93) * refined!.tangent.x
      + (refined!.point.y - 103) * refined!.tangent.y;
    expect(Math.abs(tangentDot)).toBeLessThan(1e-5);
  });

  it("keeps all results finite near a cusp-like endpoint", () => {
    const cusp: StudioCurveRuler = {
      id: "cusp",
      p0: { x: 0, y: 0 },
      p1: { x: 0, y: 0 },
      p2: { x: 80, y: 100 },
      p3: { x: 140, y: 20 },
    };
    const projection = projectPointOntoStudioCubicBezier(cusp, { x: 2, y: 6 });
    expect(projection).not.toBeNull();
    expect([
      projection!.t,
      projection!.point.x,
      projection!.point.y,
      projection!.normal.x,
      projection!.normal.y,
      projection!.distance,
    ].every(Number.isFinite)).toBe(true);
  });

  it("rejects NaN targets and offsets outside the bounded geometry budget", () => {
    expect(projectPointOntoStudioCubicBezier(lineRuler(), { x: NaN, y: 0 })).toBeNull();
    expect(projectPointOntoStudioCubicBezier(lineRuler(), { x: 0, y: 0 }, {
      offset: Number.POSITIVE_INFINITY,
    })).toBeNull();
  });
});

describe("studio parallel curve and immutable snap session", () => {
  it("evaluates and samples a signed parallel offset", () => {
    expect(evaluateStudioCurveParallelOffset(lineRuler(), 0.5, 12)).toEqual({ x: 50, y: 12 });
    const sampled = sampleStudioCurveParallelOffset(lineRuler(), -8, 4);
    // The public safety floor deliberately raises underspecified sampling to 16 segments.
    expect(sampled).toHaveLength(17);
    expect(sampled[0]).toEqual({ x: 0, y: -8 });
    expect(sampled.at(-1)).toEqual({ x: 100, y: -8 });
  });

  it("captures a deep-frozen ruler and returns a new session for every point", () => {
    const mutable = lineRuler();
    const session = beginStudioCurveSnapSession(mutable, { x: 10, y: 15 }, {
      offsetMode: "through-start",
    });
    expect(session).not.toBeNull();
    expect(session!.offset).toBeCloseTo(15, 10);
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session!.ruler.p0)).toBe(true);

    (mutable.p0 as { x: number }).x = 9_999;
    const transition = snapStudioCurvePoint(session!, { x: 70, y: 40 });
    expect(transition).not.toBeNull();
    expect(transition!.point.x).toBeCloseTo(70, 7);
    expect(transition!.point.y).toBeCloseTo(15, 7);
    expect(transition!.session).not.toBe(session);
    expect(session!.lastT).toBeCloseTo(0.1, 6);
    expect(transition!.session.lastT).toBeCloseTo(0.7, 6);
  });

  it("supports on-curve and explicit fixed-offset sessions and rejects invalid samples", () => {
    const onCurve = beginStudioCurveSnapSession(lineRuler(), { x: 25, y: 20 });
    expect(onCurve?.offset).toBe(0);
    expect(snapStudioCurvePoint(onCurve!, { x: 30, y: 20 })?.point.y).toBeCloseTo(0, 10);

    const fixed = beginStudioCurveSnapSession(lineRuler(), { x: 25, y: 20 }, {
      offsetMode: "fixed",
      offset: -5,
    });
    expect(snapStudioCurvePoint(fixed!, { x: 30, y: 20 })?.point.y).toBeCloseTo(-5, 10);
    expect(snapStudioCurvePoint(fixed!, { x: Infinity, y: 0 })).toBeNull();
  });

  it("mirrors geometry and flips signed session offset to preserve the visible side", () => {
    const mirrored = mirrorStudioCurveRulerHorizontally(lineRuler(), 200);
    expect(mirrored).toEqual({
      id: "curve-a",
      p0: { x: 200, y: 0 },
      p1: { x: 200 - 100 / 3, y: 0 },
      p2: { x: 200 - 200 / 3, y: 0 },
      p3: { x: 100, y: 0 },
    });
    const roundTrip = mirrorStudioCurveRulerHorizontally(mirrored, 200);
    expect(roundTrip?.id).toBe("curve-a");
    expect(roundTrip?.p0.x).toBeCloseTo(0, 12);
    expect(roundTrip?.p1.x).toBeCloseTo(100 / 3, 12);
    expect(roundTrip?.p2.x).toBeCloseTo(200 / 3, 12);
    expect(roundTrip?.p3.x).toBeCloseTo(100, 12);

    const session = beginStudioCurveSnapSession(lineRuler(), { x: 20, y: 9 }, {
      offsetMode: "through-start",
    });
    const mirroredSession = mirrorStudioCurveSnapSessionHorizontally(session!, 200);
    expect(mirroredSession?.offset).toBeCloseTo(-9, 10);
    const snapped = snapStudioCurvePoint(mirroredSession!, { x: 180, y: 9 });
    expect(snapped?.point).toEqual({ x: 180, y: 9 });
  });
});
