import { describe, expect, it } from "vitest";

import { snapStudioAdvancedRulerStrokePoint } from "./studio-advanced-ruler-snap";

import type {
  StudioAdvancedRuler,
  StudioAuthoredConcentricRuler,
  StudioAuthoredCurveRuler,
  StudioAuthoredParallelRuler,
  StudioAuthoredRadialRuler,
} from "./studio-advanced-ruler-document";

const base = {
  name: "자",
  enabled: true,
  visible: true,
  scope: { kind: "page", groupId: null },
} as const;

const parallel: StudioAuthoredParallelRuler = {
  ...base,
  id: "parallel-a",
  type: "parallel",
  angleDeg: 0,
  originX: 0,
  originY: 0,
  guideSpacing: 96,
};

const concentric: StudioAuthoredConcentricRuler = {
  ...base,
  id: "concentric-a",
  type: "concentric",
  centerX: 0,
  centerY: 0,
  guideSpacing: 96,
};

const radial: StudioAuthoredRadialRuler = {
  ...base,
  id: "radial-a",
  type: "radial",
  centerX: 0,
  centerY: 0,
};

const curve: StudioAuthoredCurveRuler = {
  ...base,
  id: "curve-a",
  type: "curve",
  snapMode: "on-curve",
  fixedOffset: 0,
  p0: { x: 0, y: 0 },
  p1: { x: 100, y: 0 },
  p2: { x: 200, y: 0 },
  p3: { x: 300, y: 0 },
};

describe("snapStudioAdvancedRulerStrokePoint", () => {
  it("snaps parallel strokes onto the start-point line and reuses the session", () => {
    const first = snapStudioAdvancedRulerStrokePoint(null, parallel, { x: 5, y: 30 }, { x: 40, y: 90 });
    expect(first!.point).toEqual({ x: 40, y: 30 });
    expect(first!.state.type).toBe("parallel");
    const second = snapStudioAdvancedRulerStrokePoint(first!.state, parallel, { x: 5, y: 30 }, { x: 80, y: 0 });
    expect(second!.point).toEqual({ x: 80, y: 30 });
    expect(second!.state.type === "parallel" && first!.state.type === "parallel"
      && second!.state.session === first!.state.session).toBe(true);
  });

  it("snaps concentric strokes onto the constant-radius circle", () => {
    const result = snapStudioAdvancedRulerStrokePoint(null, concentric, { x: 40, y: 0 }, { x: 0, y: 90 });
    expect(result!.point.x).toBeCloseTo(0, 10);
    expect(result!.point.y).toBeCloseTo(40, 10);
  });

  it("snaps radial strokes onto the ray and clamps at the center", () => {
    const forward = snapStudioAdvancedRulerStrokePoint(null, radial, { x: 10, y: 0 }, { x: 90, y: 12 });
    expect(forward!.point).toEqual({ x: 90, y: 0 });
    const behind = snapStudioAdvancedRulerStrokePoint(forward!.state, radial, { x: 10, y: 0 }, { x: -50, y: 12 });
    expect(behind!.point).toEqual({ x: 0, y: 0 });
  });

  it("fails closed for degenerate sessions instead of bending the stroke", () => {
    expect(snapStudioAdvancedRulerStrokePoint(null, concentric, { x: 0, y: 0 }, { x: 10, y: 10 }))
      .toBeNull();
    expect(snapStudioAdvancedRulerStrokePoint(null, radial, { x: 0, y: 0 }, { x: 10, y: 10 }))
      .toBeNull();
  });

  it("discards a stale session when the ruler id or kind changes mid-stroke", () => {
    const first = snapStudioAdvancedRulerStrokePoint(null, parallel, { x: 0, y: 10 }, { x: 10, y: 50 });
    const otherParallel: StudioAdvancedRuler = { ...parallel, id: "parallel-b", angleDeg: 90 };
    const switched = snapStudioAdvancedRulerStrokePoint(first!.state, otherParallel, { x: 0, y: 10 }, { x: 10, y: 50 });
    expect(switched!.point.x).toBeCloseTo(0, 10);
    expect(switched!.point.y).toBeCloseTo(50, 10);
    const crossKind = snapStudioAdvancedRulerStrokePoint(first!.state, radial, { x: 10, y: 0 }, { x: 50, y: 5 });
    expect(crossKind!.point).toEqual({ x: 50, y: 0 });
  });

  it("dispatches curve rulers through the existing curve engine", () => {
    const result = snapStudioAdvancedRulerStrokePoint(null, curve, { x: 0, y: 0 }, { x: 150, y: 40 });
    expect(result!.state.type).toBe("curve");
    expect(result!.point.y).toBeCloseTo(0, 6);
    expect(result!.point.x).toBeGreaterThan(0);
    expect(result!.point.x).toBeLessThan(300);
  });
});
