import { describe, expect, it } from "vitest";

import {
  planStudioBg3dPushPull,
  studioBg3dPushPullAxes,
} from "./studio-bg3d-push-pull";

import type { BgPrimitive } from "../studio-background-3d-metadata";

function box(overrides: Partial<BgPrimitive> = {}): BgPrimitive {
  return {
    id: "box-1",
    kind: "box",
    position: [0, 0.5, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#fff",
    ...overrides,
  };
}

describe("studio-bg3d-push-pull", () => {
  it("moves only the selected positive face and pins the opposite face", () => {
    const result = planStudioBg3dPushPull(box(), {
      axis: "y",
      face: "positive",
      distance: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previousDimension).toBeCloseTo(1);
    expect(result.nextDimension).toBeCloseTo(2);
    expect(result.patch.scale).toEqual([1, 2, 1]);
    expect(result.patch.position).toEqual([0, 1, 0]);
    expect(result.patch.position[1] - result.patch.scale[1] / 2).toBeCloseTo(0);
  });

  it("moves a negative face in the negative local direction", () => {
    const result = planStudioBg3dPushPull(box(), {
      axis: "x",
      face: "negative",
      distance: 0.5,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch.scale).toEqual([1.5, 1, 1]);
    expect(result.patch.position).toEqual([-0.25, 0.5, 0]);
    expect(result.patch.position[0] + result.patch.scale[0] / 2).toBeCloseTo(0.5);
  });

  it("rotates the centre offset with the object local face normal", () => {
    const result = planStudioBg3dPushPull(
      box({ rotation: [0, Math.PI / 2, 0] }),
      { axis: "x", face: "positive", distance: 2 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch.position[0]).toBeCloseTo(0);
    expect(result.patch.position[1]).toBeCloseTo(0.5);
    expect(result.patch.position[2]).toBeCloseTo(-1);
  });

  it("shares the transform snap increment and keeps a minimum dimension", () => {
    const snapped = planStudioBg3dPushPull(box(), {
      axis: "z",
      face: "positive",
      distance: 0.62,
      snapStep: 0.25,
    });
    expect(snapped.ok && snapped.appliedDistance).toBeCloseTo(0.5);

    const clamped = planStudioBg3dPushPull(box(), {
      axis: "z",
      face: "positive",
      distance: -10,
      minimumDimension: 0.05,
    });
    expect(clamped.ok).toBe(true);
    if (!clamped.ok) return;
    expect(clamped.nextDimension).toBeCloseTo(0.05);
    expect(clamped.patch.scale[2]).toBeCloseTo(0.05);
  });

  it("fails closed for locked, unsupported, zero, and unbounded operations", () => {
    expect(planStudioBg3dPushPull(box({ locked: true }), {
      axis: "y",
      face: "positive",
      distance: 1,
    })).toMatchObject({ ok: false, reason: "locked" });

    expect(planStudioBg3dPushPull({ ...box(), kind: "sphere" }, {
      axis: "y",
      face: "positive",
      distance: 1,
    })).toMatchObject({ ok: false, reason: "unsupported-face" });

    expect(planStudioBg3dPushPull(box(), {
      axis: "y",
      face: "positive",
      distance: 0,
    })).toMatchObject({ ok: false, reason: "no-change" });

    expect(planStudioBg3dPushPull(box(), {
      axis: "y",
      face: "positive",
      distance: Number.POSITIVE_INFINITY,
    })).toMatchObject({ ok: false, reason: "invalid-distance" });
  });

  it("declares only topology-truthful primitive faces as available", () => {
    expect(studioBg3dPushPullAxes("box")).toEqual(["x", "y", "z"]);
    expect(studioBg3dPushPullAxes("cylinder")).toEqual(["y"]);
    expect(studioBg3dPushPullAxes("tube")).toEqual(["y"]);
    expect(studioBg3dPushPullAxes("sphere")).toEqual([]);
    expect(studioBg3dPushPullAxes("plane")).toEqual([]);
  });
});
