import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_CONCENTRIC_RULER,
  DEFAULT_STUDIO_PARALLEL_RULER,
  DEFAULT_STUDIO_RADIAL_RULER,
  STUDIO_GUIDE_RULER_DEFAULT_SPACING,
  STUDIO_GUIDE_RULER_MAX_SPACING,
  STUDIO_GUIDE_RULER_MIN_SPACING,
  beginStudioConcentricSnapSession,
  beginStudioParallelSnapSession,
  beginStudioRadialSnapSession,
  canonicalizeStudioConcentricRuler,
  canonicalizeStudioParallelRuler,
  canonicalizeStudioRadialRuler,
  createStudioConcentricGuideRadii,
  createStudioParallelGuideSegments,
  createStudioRadialGuideSegments,
  mirrorStudioConcentricRulerHorizontally,
  mirrorStudioParallelRulerHorizontally,
  mirrorStudioRadialRulerHorizontally,
  normalizeStudioParallelAngleDeg,
  snapStudioConcentricPoint,
  snapStudioParallelPoint,
  snapStudioRadialPoint,
} from "./studio-advanced-ruler-guide-snap";

describe("canonicalization", () => {
  it("recovers defaults from hostile input without invoking accessors", () => {
    let getterCalls = 0;
    const hostile = {
      get angleDeg() {
        getterCalls += 1;
        return 45;
      },
    };
    expect(canonicalizeStudioParallelRuler(hostile)).toEqual(DEFAULT_STUDIO_PARALLEL_RULER);
    expect(canonicalizeStudioConcentricRuler(null)).toEqual(DEFAULT_STUDIO_CONCENTRIC_RULER);
    expect(canonicalizeStudioRadialRuler([1, 2])).toEqual(DEFAULT_STUDIO_RADIAL_RULER);
    expect(getterCalls).toBe(0);
  });

  it("wraps angles and clamps spacing and coordinates", () => {
    expect(canonicalizeStudioParallelRuler({
      id: "p",
      angleDeg: 225,
      originX: Number.POSITIVE_INFINITY,
      originY: -20_000_000,
      guideSpacing: 4,
    })).toEqual({
      id: "p",
      angleDeg: 45,
      originX: 0,
      originY: -10_000_000,
      guideSpacing: STUDIO_GUIDE_RULER_MIN_SPACING,
    });
    expect(canonicalizeStudioConcentricRuler({
      id: "c",
      centerX: 12,
      centerY: Number.NaN,
      guideSpacing: 9_999,
    })).toEqual({
      id: "c",
      centerX: 12,
      centerY: 0,
      guideSpacing: STUDIO_GUIDE_RULER_MAX_SPACING,
    });
    expect(canonicalizeStudioRadialRuler({ id: "bad\u0000id", centerX: 3, centerY: 4 }))
      .toEqual({ id: "radial-ruler", centerX: 3, centerY: 4 });
  });

  it("normalizes negative angles into [0, 180)", () => {
    expect(normalizeStudioParallelAngleDeg(-45)).toBe(135);
    expect(normalizeStudioParallelAngleDeg(180)).toBe(0);
    expect(normalizeStudioParallelAngleDeg(359)).toBe(179);
    expect(normalizeStudioParallelAngleDeg(0)).toBe(0);
  });
});

describe("parallel snapping", () => {
  it("projects orthogonally onto the line through the stroke start", () => {
    const session = beginStudioParallelSnapSession(
      { id: "p", angleDeg: 0, originX: 500, originY: 500, guideSpacing: 96 },
      { x: 10, y: 40 }
    );
    expect(session).not.toBeNull();
    const transition = snapStudioParallelPoint(session!, { x: 120, y: 90 });
    expect(transition!.point).toEqual({ x: 120, y: 40 });
  });

  it("respects a diagonal ruler angle", () => {
    const session = beginStudioParallelSnapSession(
      { id: "p", angleDeg: 45, originX: 0, originY: 0, guideSpacing: 96 },
      { x: 0, y: 0 }
    );
    const transition = snapStudioParallelPoint(session!, { x: 10, y: 0 });
    expect(transition!.point.x).toBeCloseTo(5, 10);
    expect(transition!.point.y).toBeCloseTo(5, 10);
  });

  it("returns an immutable session and rejects non-finite samples", () => {
    const session = beginStudioParallelSnapSession(
      { id: "p", angleDeg: 90, originX: 0, originY: 0, guideSpacing: 96 },
      { x: 3, y: 4 }
    );
    expect(Object.isFrozen(session)).toBe(true);
    expect(snapStudioParallelPoint(session!, { x: Number.NaN, y: 0 })).toBeNull();
    expect(beginStudioParallelSnapSession({ id: "p" }, { x: Number.POSITIVE_INFINITY, y: 0 }))
      .toBeNull();
    const transition = snapStudioParallelPoint(session!, { x: 40, y: 7 });
    expect(transition!.point.x).toBeCloseTo(3, 10);
    expect(transition!.point.y).toBeCloseTo(7, 10);
    expect(transition!.session).toBe(session);
  });
});

describe("concentric snapping", () => {
  const ruler = { id: "c", centerX: 100, centerY: 100, guideSpacing: 96 };

  it("keeps every sample on the circle through the stroke start", () => {
    const session = beginStudioConcentricSnapSession(ruler, { x: 130, y: 100 });
    expect(session!.radius).toBe(30);
    const transition = snapStudioConcentricPoint(session!, { x: 100, y: 350 });
    expect(transition!.point.x).toBeCloseTo(100, 10);
    expect(transition!.point.y).toBeCloseTo(130, 10);
  });

  it("reuses the previous angle when a sample lands exactly on the center", () => {
    const session = beginStudioConcentricSnapSession(ruler, { x: 130, y: 100 });
    const transition = snapStudioConcentricPoint(session!, { x: 100, y: 100 });
    expect(transition!.point.x).toBeCloseTo(130, 10);
    expect(transition!.point.y).toBeCloseTo(100, 10);
    const moved = snapStudioConcentricPoint(transition!.session, { x: 100, y: 60 });
    expect(moved!.point.y).toBeCloseTo(70, 10);
    const centered = snapStudioConcentricPoint(moved!.session, { x: 100, y: 100 });
    expect(centered!.point.x).toBeCloseTo(100, 10);
    expect(centered!.point.y).toBeCloseTo(70, 10);
  });

  it("fails closed when the stroke starts on the center", () => {
    expect(beginStudioConcentricSnapSession(ruler, { x: 100, y: 100 })).toBeNull();
    expect(beginStudioConcentricSnapSession(ruler, { x: Number.NaN, y: 0 })).toBeNull();
  });
});

describe("radial snapping", () => {
  const ruler = { id: "r", centerX: 50, centerY: 50 };

  it("projects onto the ray from the center through the stroke start", () => {
    const session = beginStudioRadialSnapSession(ruler, { x: 80, y: 50 });
    expect(session!.direction).toEqual({ x: 1, y: 0 });
    const transition = snapStudioRadialPoint(session!, { x: 200, y: 90 });
    expect(transition!.point).toEqual({ x: 200, y: 50 });
    expect(transition!.session).toBe(session);
  });

  it("clamps samples so they never cross to the opposite side of the center", () => {
    const session = beginStudioRadialSnapSession(ruler, { x: 80, y: 50 });
    const behind = snapStudioRadialPoint(session!, { x: -300, y: 44 });
    expect(behind!.point).toEqual({ x: 50, y: 50 });
  });

  it("fails closed when the stroke starts on the center", () => {
    expect(beginStudioRadialSnapSession(ruler, { x: 50, y: 50 })).toBeNull();
    expect(beginStudioRadialSnapSession(ruler, { x: 0, y: Number.NaN })).toBeNull();
  });
});

describe("display guides", () => {
  it("builds parallel guide lines centered on the origin with alternating offsets", () => {
    const segments = createStudioParallelGuideSegments(
      { id: "p", angleDeg: 0, originX: 100, originY: 200, guideSpacing: 100 },
      { halfLength: 250, maxLinesPerSide: 4 }
    );
    expect(segments).toHaveLength(5);
    expect(segments[0]).toEqual({ x1: -150, y1: 200, x2: 350, y2: 200 });
    expect(segments[1]!.y1).toBeCloseTo(100, 10);
    expect(segments[2]!.y1).toBeCloseTo(300, 10);
    expect(segments[3]!.y1).toBeCloseTo(0, 10);
    expect(segments[4]!.y1).toBeCloseTo(400, 10);
  });

  it("builds bounded concentric radii at spacing multiples", () => {
    expect(createStudioConcentricGuideRadii(
      { id: "c", centerX: 0, centerY: 0, guideSpacing: 120 },
      { maxRadius: 400, maxCircles: 8 }
    )).toEqual([120, 240, 360]);
    expect(createStudioConcentricGuideRadii({ id: "c" }).length).toBeGreaterThan(0);
  });

  it("builds evenly spaced radial rays from the center", () => {
    const segments = createStudioRadialGuideSegments(
      { id: "r", centerX: 10, centerY: 20 },
      { length: 100, rayCount: 4 }
    );
    expect(segments).toHaveLength(4);
    expect(segments[0]).toEqual({ x1: 10, y1: 20, x2: 110, y2: 20 });
    expect(segments[1]!.x2).toBeCloseTo(10, 10);
    expect(segments[1]!.y2).toBeCloseTo(120, 10);
  });
});

describe("mirroring", () => {
  it("mirrors the parallel family and keeps display density", () => {
    expect(mirrorStudioParallelRulerHorizontally(
      { id: "p", angleDeg: 45, originX: 100, originY: 30, guideSpacing: 64 },
      800
    )).toEqual({ id: "p", angleDeg: 135, originX: 700, originY: 30, guideSpacing: 64 });
    expect(mirrorStudioParallelRulerHorizontally(
      { id: "p", angleDeg: 0, originX: 0, originY: 0, guideSpacing: STUDIO_GUIDE_RULER_DEFAULT_SPACING },
      800
    )!.angleDeg).toBe(0);
    expect(mirrorStudioParallelRulerHorizontally({ id: "p" }, Number.NaN)).toBeNull();
  });

  it("mirrors circle and ray centers", () => {
    expect(mirrorStudioConcentricRulerHorizontally(
      { id: "c", centerX: 120, centerY: 44, guideSpacing: 96 },
      800
    )).toEqual({ id: "c", centerX: 680, centerY: 44, guideSpacing: 96 });
    expect(mirrorStudioRadialRulerHorizontally({ id: "r", centerX: 120, centerY: 44 }, 800))
      .toEqual({ id: "r", centerX: 680, centerY: 44 });
    expect(mirrorStudioRadialRulerHorizontally({ id: "r" }, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
