import { describe, expect, it } from "vitest";

import {
  planStudioBg3dTransformSnap,
  STUDIO_BG3D_TRANSFORM_SNAP_HARD_MAX_CANDIDATES,
  type PlanStudioBg3dTransformSnapInput,
  type StudioBg3dTransformSnapCandidate,
} from "./studio-bg3d-transform-snap-planner";

const BASE: PlanStudioBg3dTransformSnapInput = {
  startWorldPosition: [1, 2, 3],
  proposedWorldPosition: [4, 6, 8],
  orientation: { space: "global" },
  constraint: { kind: "free" },
  snap: { enabled: false, modes: [] },
  candidates: [],
};

function vertex(
  id: string,
  pointWorld: readonly [number, number, number],
  screenDistancePx = 2,
): StudioBg3dTransformSnapCandidate {
  return { kind: "vertex", id, pointWorld, screenDistancePx };
}

function expectSuccess(input: PlanStudioBg3dTransformSnapInput) {
  const result = planStudioBg3dTransformSnap(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected success, received ${result.reason}`);
  return result;
}

describe("Studio BG3D transform constraint planner", () => {
  it("passes a free unsnapped translation through as one immutable plan", () => {
    const result = expectSuccess(BASE);

    expect(result).toMatchObject({
      positionWorld: [4, 6, 8],
      worldDelta: [3, 4, 5],
      snapBaseWorld: [4, 6, 8],
      constrainedPositionWorld: [4, 6, 8],
      coordinateSpace: "global",
      effectiveSnappingEnabled: false,
      evaluatedCandidates: 0,
      snap: {
        kind: "none",
        candidateId: null,
        distance: null,
        distanceSpace: "none",
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.positionWorld)).toBe(true);
    expect(Object.isFrozen(result.snap)).toBe(true);
  });

  it("supports global single-axis and plane constraints", () => {
    expect(expectSuccess({
      ...BASE,
      constraint: { kind: "axis", axis: "x" },
    }).positionWorld).toEqual([4, 2, 3]);

    expect(expectSuccess({
      ...BASE,
      constraint: { kind: "plane", excludedAxis: "y" },
    }).positionWorld).toEqual([4, 2, 8]);
  });

  it("projects onto a verified local axis instead of the world axis", () => {
    const result = expectSuccess({
      ...BASE,
      startWorldPosition: [0, 0, 0],
      proposedWorldPosition: [2, 3, 4],
      orientation: {
        space: "local",
        axes: {
          x: [0, 0, 1],
          y: [0, 1, 0],
          z: [-1, 0, 0],
        },
      },
      constraint: { kind: "axis", axis: "x" },
    });

    expect(result.positionWorld[0]).toBeCloseTo(0, 12);
    expect(result.positionWorld[1]).toBeCloseTo(0, 12);
    expect(result.positionWorld[2]).toBeCloseTo(4, 12);
    expect(result.coordinateSpace).toBe("local");
  });

  it("fails closed for non-unit, skewed, or left-handed local bases", () => {
    for (const axes of [
      { x: [2, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
      { x: [1, 0, 0], y: [1, 1, 0], z: [0, 0, 1] },
      { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, -1] },
    ] as const) {
      expect(planStudioBg3dTransformSnap({
        ...BASE,
        orientation: { space: "local", axes },
      })).toEqual({ ok: false, reason: "invalid-orientation" });
    }
  });
});

describe("Studio BG3D transform snap modes", () => {
  it("quantizes relative increments from the transform start", () => {
    const result = expectSuccess({
      ...BASE,
      startWorldPosition: [0.2, 0, 0],
      proposedWorldPosition: [0.73, 0, 0],
      snap: {
        enabled: true,
        modes: ["increment"],
        increment: { mode: "relative", step: 0.5 },
      },
    });

    expect(result.positionWorld[0]).toBeCloseTo(0.7, 12);
    expect(result.worldDelta[0]).toBeCloseTo(0.5, 12);
    expect(result.snap).toMatchObject({
      kind: "increment",
      targetWorld: [0.7, 0, 0],
      distanceSpace: "world",
    });
  });

  it("quantizes an offset snap base against an absolute grid origin", () => {
    const result = expectSuccess({
      ...BASE,
      startWorldPosition: [0.2, 0, 0],
      proposedWorldPosition: [0.73, 0, 0],
      snapBaseWorldPosition: [0.5, 0, 0],
      snap: {
        enabled: true,
        modes: ["increment"],
        increment: {
          mode: "absolute",
          step: [0.5, 1, 1],
          gridOriginWorld: [0.1, 0, 0],
        },
      },
    });

    expect(result.positionWorld[0]).toBeCloseTo(0.8, 12);
    expect(result.snapBaseWorld[0]).toBeCloseTo(1.1, 12);
    expect(result.snap.targetWorld?.[0]).toBeCloseTo(1.1, 12);
  });

  it("moves a custom selection base exactly onto a vertex in free mode", () => {
    const result = expectSuccess({
      ...BASE,
      startWorldPosition: [0, 0, 0],
      proposedWorldPosition: [4.8, 1.1, 0],
      snapBaseWorldPosition: [0, 1, 0],
      snap: { enabled: true, modes: ["vertex"] },
      candidates: [vertex("vertex-a", [5, 2, 0])],
    });

    expect(result.positionWorld).toEqual([5, 1, 0]);
    expect(result.snapBaseWorld).toEqual([5, 2, 0]);
    expect(result.worldDelta).toEqual([5, 1, 0]);
    expect(result.snap).toMatchObject({
      kind: "vertex",
      candidateId: "vertex-a",
      targetWorld: [5, 2, 0],
      constraintResidualWorld: 0,
      distance: 2,
      distanceSpace: "screen-px",
    });
  });

  it("normalizes and preserves surface metadata without applying rotation", () => {
    const result = expectSuccess({
      ...BASE,
      startWorldPosition: [0, 0, 0],
      proposedWorldPosition: [1, 2, 3],
      snap: { enabled: true, modes: ["surface"] },
      candidates: [{
        kind: "surface",
        id: "surface-a",
        pointWorld: [1, 2, 3],
        normalWorld: [0, 4, 0],
        screenDistancePx: 1,
      }],
    });

    expect(result.positionWorld).toEqual([1, 2, 3]);
    expect(result.snap.normalWorld).toEqual([0, 1, 0]);
  });

  it("projects a geometry target through the active axis and reports residual", () => {
    const result = expectSuccess({
      ...BASE,
      startWorldPosition: [0, 0, 0],
      proposedWorldPosition: [4.5, 0, 0],
      constraint: { kind: "axis", axis: "x" },
      snap: { enabled: true, modes: ["vertex"] },
      candidates: [vertex("off-axis", [5, 2, 3])],
    });

    expect(result.positionWorld).toEqual([5, 0, 0]);
    expect(result.snapBaseWorld).toEqual([5, 0, 0]);
    expect(result.snap.constraintResidualWorld).toBeCloseTo(Math.sqrt(13), 12);
  });

  it("uses cursor distance, kind, movement, and ID as deterministic tie breaks", () => {
    const candidates = [
      vertex("vertex-z", [8, 0, 0], 4),
      {
        kind: "surface" as const,
        id: "surface-close",
        pointWorld: [2, 0, 0] as const,
        normalWorld: [0, 1, 0] as const,
        screenDistancePx: 3,
      },
      vertex("vertex-a", [8, 0, 0], 4),
    ];
    const nearestSurface = expectSuccess({
      ...BASE,
      startWorldPosition: [0, 0, 0],
      proposedWorldPosition: [7, 0, 0],
      snap: { enabled: true, modes: ["vertex", "surface"] },
      candidates,
    });
    expect(nearestSurface.snap.candidateId).toBe("surface-close");

    const tied = [vertex("vertex-z", [8, 0, 0], 4), vertex("vertex-a", [8, 0, 0], 4)];
    for (const ordered of [tied, [...tied].reverse()]) {
      expect(expectSuccess({
        ...BASE,
        startWorldPosition: [0, 0, 0],
        proposedWorldPosition: [7, 0, 0],
        snap: { enabled: true, modes: ["vertex"] },
        candidates: ordered,
      }).snap.candidateId).toBe("vertex-a");
    }

    const sameDistanceDifferentKinds = [
      {
        kind: "surface" as const,
        id: "surface-a",
        pointWorld: [1, 0, 0] as const,
        normalWorld: [0, 1, 0] as const,
        screenDistancePx: 2,
      },
      vertex("vertex-b", [20, 0, 0], 2),
    ];
    expect(expectSuccess({
      ...BASE,
      startWorldPosition: [0, 0, 0],
      proposedWorldPosition: [1, 0, 0],
      snap: { enabled: true, modes: ["vertex", "surface"] },
      candidates: sameDistanceDifferentKinds,
    }).snap.candidateId).toBe("vertex-b");
  });

  it("ignores geometry outside the activation radius and falls back to increment", () => {
    const result = expectSuccess({
      ...BASE,
      startWorldPosition: [0, 0, 0],
      proposedWorldPosition: [0.6, 0, 0],
      snap: {
        enabled: true,
        modes: ["vertex", "increment"],
        increment: { mode: "relative", step: 1 },
        geometryActivationRadiusPx: 8,
      },
      candidates: [vertex("far", [100, 0, 0], 9)],
    });

    expect(result.positionWorld).toEqual([1, 0, 0]);
    expect(result.snap.kind).toBe("increment");
    expect(result.evaluatedCandidates).toBe(2);
  });

  it("supports temporary snap inversion and geometry suppression modifiers", () => {
    const candidate = vertex("target", [5, 0, 0]);
    expect(expectSuccess({
      ...BASE,
      startWorldPosition: [0, 0, 0],
      proposedWorldPosition: [1, 0, 0],
      snap: { enabled: false, modes: ["vertex"] },
      modifiers: { invertSnapping: true },
      candidates: [candidate],
    }).positionWorld).toEqual([5, 0, 0]);

    const invertedOff = expectSuccess({
      ...BASE,
      startWorldPosition: [0, 0, 0],
      proposedWorldPosition: [1, 0, 0],
      snap: { enabled: true, modes: ["vertex"] },
      modifiers: { invertSnapping: true },
      candidates: [candidate],
    });
    expect(invertedOff.positionWorld).toEqual([1, 0, 0]);
    expect(invertedOff.snap.kind).toBe("none");

    const geometrySuppressed = expectSuccess({
      ...BASE,
      startWorldPosition: [0, 0, 0],
      proposedWorldPosition: [0.6, 0, 0],
      snap: {
        enabled: true,
        modes: ["vertex", "increment"],
        increment: { mode: "relative", step: 1 },
      },
      modifiers: { suppressGeometrySnaps: true },
      candidates: [candidate],
    });
    expect(geometrySuppressed.positionWorld).toEqual([1, 0, 0]);
    expect(geometrySuppressed.snap.kind).toBe("increment");
  });
});

describe("Studio BG3D transform snap admission and budgets", () => {
  it("fails closed before partial ranking when candidate or evaluation budgets are exceeded", () => {
    const candidates = [vertex("a", [1, 0, 0]), vertex("b", [2, 0, 0])];

    expect(planStudioBg3dTransformSnap({
      ...BASE,
      snap: { enabled: true, modes: ["vertex"] },
      candidates,
      budgets: { maxCandidates: 1, maxEvaluations: 2 },
    })).toEqual({ ok: false, reason: "candidate-budget-exceeded" });

    expect(planStudioBg3dTransformSnap({
      ...BASE,
      snap: { enabled: true, modes: ["vertex"] },
      candidates,
      budgets: { maxCandidates: 2, maxEvaluations: 1 },
    })).toEqual({ ok: false, reason: "evaluation-budget-exceeded" });

    expect(planStudioBg3dTransformSnap({
      ...BASE,
      snap: { enabled: false, modes: ["vertex"] },
      candidates,
      budgets: { maxCandidates: 2, maxEvaluations: 0 },
    }).ok).toBe(true);
  });

  it("rejects malformed budgets, duplicate IDs, duplicate modes, and malformed inactive candidates", () => {
    expect(planStudioBg3dTransformSnap({
      ...BASE,
      budgets: {
        maxCandidates: STUDIO_BG3D_TRANSFORM_SNAP_HARD_MAX_CANDIDATES + 1,
        maxEvaluations: 1,
      },
    })).toEqual({ ok: false, reason: "invalid-input" });

    expect(planStudioBg3dTransformSnap({
      ...BASE,
      snap: { enabled: true, modes: ["vertex"] },
      candidates: [vertex("same", [1, 0, 0]), vertex("same", [2, 0, 0])],
    })).toEqual({ ok: false, reason: "duplicate-candidate-id" });

    expect(planStudioBg3dTransformSnap({
      ...BASE,
      snap: { enabled: true, modes: ["vertex", "vertex"] },
    })).toEqual({ ok: false, reason: "invalid-input" });

    expect(planStudioBg3dTransformSnap({
      ...BASE,
      snap: { enabled: false, modes: [] },
      candidates: [{
        kind: "surface",
        id: "bad-normal",
        pointWorld: [0, 0, 0],
        normalWorld: [0, 0, 0],
        screenDistancePx: 1,
      }],
    })).toEqual({ ok: false, reason: "invalid-input" });
  });

  it("rejects a snapped transform that leaves the canonical world budget", () => {
    expect(planStudioBg3dTransformSnap({
      ...BASE,
      startWorldPosition: [10_000, 0, 0],
      proposedWorldPosition: [10_000, 0, 0],
      snapBaseWorldPosition: [-10_000, 0, 0],
      snap: { enabled: true, modes: ["vertex"] },
      candidates: [vertex("far", [10_000, 0, 0])],
    })).toEqual({ ok: false, reason: "result-out-of-bounds" });
  });

  it("never mutates caller-owned vectors or candidate order", () => {
    const start: [number, number, number] = [0, 0, 0];
    const proposed: [number, number, number] = [0.6, 0.6, 0.6];
    const candidates = [vertex("b", [2, 0, 0]), vertex("a", [1, 0, 0])];
    const before = structuredClone({ start, proposed, candidates });

    expect(planStudioBg3dTransformSnap({
      ...BASE,
      startWorldPosition: start,
      proposedWorldPosition: proposed,
      snap: { enabled: true, modes: ["vertex"] },
      candidates,
    }).ok).toBe(true);

    expect({ start, proposed, candidates }).toEqual(before);
  });
});
