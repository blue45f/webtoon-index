import { describe, expect, it } from "vitest";

import {
  STUDIO_VRM_CONTACT_DEFAULT_MAX_CORRECTION,
  normalizeStudioVrmFloorContactInput,
  solveStudioVrmFloorContact,
  type StudioVrmFloorContactInput,
} from "./studio-vrm-contact-solver";

function request(
  overrides: Partial<StudioVrmFloorContactInput> = {},
): StudioVrmFloorContactInput {
  return {
    floorHeight: 0,
    hipsWorld: [0, 1, 0],
    leftFoot: { positionWorld: [-0.2, 0.5, 0] },
    rightFoot: { positionWorld: [0.2, 0.5, 0] },
    ...overrides,
  };
}

describe("studio VRM floor contact solver", () => {
  it("leaves two airborne, unplanted feet attached to an unchanged hips pose", () => {
    const result = solveStudioVrmFloorContact(request());
    expect(result).toMatchObject({
      activeContactCount: 0,
      hipsTranslation: [0, 0, 0],
      correctedHipsWorld: [0, 1, 0],
      clamped: false,
    });
    expect(result?.leftFoot).toMatchObject({
      contact: false,
      targetWorld: [-0.2, 0.5, 0],
      residualIkTranslation: [0, 0, 0],
    });
  });

  it("raises the hips once for two equally penetrating feet and plants both on the plane", () => {
    const result = solveStudioVrmFloorContact(request({
      leftFoot: { positionWorld: [-0.2, -0.1, 0] },
      rightFoot: { positionWorld: [0.2, -0.1, 0] },
    }));
    expect(result?.hipsTranslation).toEqual([0, 0.1, 0]);
    expect(result?.correctedHipsWorld).toEqual([0, 1.1, 0]);
    expect(result?.activeContactCount).toBe(2);
    expect(result?.leftFoot.targetWorld).toEqual([-0.2, 0, 0]);
    expect(result?.rightFoot.targetWorld).toEqual([0.2, 0, 0]);
    expect(result?.leftFoot.residualIkTranslation).toEqual([0, 0, 0]);
    expect(result?.rightFoot.residualIkTranslation).toEqual([0, 0, 0]);
    expect(result?.leftFoot.penetrating).toBe(true);
  });

  it("uses the mean bilateral correction and exposes each remaining leg-IK residual", () => {
    const result = solveStudioVrmFloorContact(request({
      leftFoot: { positionWorld: [-0.2, -0.1, 0], planted: true },
      rightFoot: { positionWorld: [0.2, -0.3, 0], planted: true },
    }));
    expect(result?.hipsTranslation).toEqual([0, 0.2, 0]);
    expect(result?.leftFoot.residualIkTranslation[1]).toBeCloseTo(-0.1, 12);
    expect(result?.rightFoot.residualIkTranslation[1]).toBeCloseTo(0.1, 12);
  });

  it("honors independent left and right horizontal lock anchors", () => {
    const result = solveStudioVrmFloorContact(request({
      leftFoot: {
        positionWorld: [-0.2, 0.1, 0],
        locked: true,
        lockTargetWorld: [-0.4, 0, 0.2],
      },
      rightFoot: {
        positionWorld: [0.2, -0.1, 0],
        locked: true,
        lockTargetWorld: [0.4, 0, -0.2],
      },
    }));
    expect(result?.hipsTranslation[0]).toBeCloseTo(0, 12);
    expect(result?.hipsTranslation[1]).toBeCloseTo(0, 12);
    expect(result?.hipsTranslation[2]).toBeCloseTo(0, 12);
    expect(result?.leftFoot.targetWorld).toEqual([-0.4, 0, 0.2]);
    expect(result?.rightFoot.targetWorld).toEqual([0.4, 0, -0.2]);
    expect(result?.leftFoot.locked).toBe(true);
    expect(result?.rightFoot.locked).toBe(true);
  });

  it("moves fully toward one lock when the other foot has no active contact", () => {
    const result = solveStudioVrmFloorContact(request({
      leftFoot: {
        positionWorld: [-0.2, 0.2, 0],
        locked: true,
        lockTargetWorld: [-0.3, 0, 0.1],
      },
    }));
    expect(result?.hipsTranslation[0]).toBeCloseTo(-0.1, 12);
    expect(result?.hipsTranslation[1]).toBeCloseTo(-0.2, 12);
    expect(result?.hipsTranslation[2]).toBeCloseTo(0.1, 12);
    expect(result?.leftFoot.residualIkTranslation[0]).toBeCloseTo(0, 12);
    expect(result?.leftFoot.residualIkTranslation[1]).toBeCloseTo(0, 12);
    expect(result?.leftFoot.residualIkTranslation[2]).toBeCloseTo(0, 12);
    expect(result?.rightFoot.contact).toBe(false);
    expect(result?.rightFoot.movedWithHipsWorld[0]).toBeCloseTo(0.1, 12);
    expect(result?.rightFoot.movedWithHipsWorld[1]).toBeCloseTo(0.3, 12);
    expect(result?.rightFoot.movedWithHipsWorld[2]).toBeCloseTo(0.1, 12);
  });

  it("activates an unplanted foot only inside the configured contact tolerance", () => {
    const near = solveStudioVrmFloorContact(request({
      leftFoot: { positionWorld: [-0.2, 0.001, 0] },
      contactTolerance: 0.002,
    }));
    const far = solveStudioVrmFloorContact(request({
      leftFoot: { positionWorld: [-0.2, 0.003, 0] },
      contactTolerance: 0.002,
    }));
    expect(near?.leftFoot.contact).toBe(true);
    expect(far?.leftFoot.contact).toBe(false);
  });

  it("caps the global correction vector while preserving the exact foot target", () => {
    const result = solveStudioVrmFloorContact(request({
      leftFoot: {
        positionWorld: [-0.2, 1, 0],
        locked: true,
        lockTargetWorld: [3, 0, 4],
      },
      maxCorrection: 0.25,
    }));
    expect(result?.clamped).toBe(true);
    expect(Math.hypot(...result!.hipsTranslation)).toBeCloseTo(0.25, 12);
    expect(result?.leftFoot.targetWorld).toEqual([3, 0, 4]);
    expect(Math.hypot(...result!.leftFoot.residualIkTranslation)).toBeGreaterThan(1);
  });

  it("applies the documented default maximum correction", () => {
    const result = solveStudioVrmFloorContact(request({
      leftFoot: { positionWorld: [-0.2, -5, 0], planted: true },
      rightFoot: { positionWorld: [0.2, -5, 0], planted: true },
    }));
    expect(result?.hipsTranslation).toEqual([
      0,
      STUDIO_VRM_CONTACT_DEFAULT_MAX_CORRECTION,
      0,
    ]);
    expect(result?.clamped).toBe(true);
  });

  it("fails closed for non-finite, oversized, contradictory, or extended input", () => {
    const invalid: unknown[] = [
      null,
      { ...request(), extra: true },
      request({ floorHeight: Number.NaN }),
      request({ floorHeight: Number.POSITIVE_INFINITY }),
      request({ hipsWorld: [1_000_001, 1, 0] }),
      request({ maxCorrection: 0 }),
      request({ maxCorrection: 11 }),
      request({ contactTolerance: -1 }),
      request({ contactTolerance: 0.2 }),
      request({ leftFoot: { positionWorld: [-0.2, 0, 0], locked: true, planted: false } }),
      request({ leftFoot: { positionWorld: [-0.2, 0, 0], lockTargetWorld: [0, 0, 0] } }),
      request({ leftFoot: { positionWorld: [-0.2, 0, 0], planted: "yes" as never } }),
      request({ leftFoot: { positionWorld: [-0.2, Number.NaN, 0] } }),
    ];
    for (const value of invalid) {
      expect(normalizeStudioVrmFloorContactInput(value)).toBeNull();
      expect(solveStudioVrmFloorContact(value)).toBeNull();
    }
  });

  it("rejects zero-length and overlapping bilateral rig geometry", () => {
    expect(solveStudioVrmFloorContact(request({
      leftFoot: { positionWorld: [0, 1, 0] },
    }))).toBeNull();
    expect(solveStudioVrmFloorContact(request({
      leftFoot: { positionWorld: [0.2, 0.5, 0] },
    }))).toBeNull();
  });

  it("is deterministic, deeply freezes output tuples, and never mutates input", () => {
    const input = request({
      leftFoot: { positionWorld: [-0.2, -0.1, 0], planted: true },
      rightFoot: { positionWorld: [0.2, -0.3, 0], planted: true },
    });
    const before = JSON.stringify(input);
    const first = solveStudioVrmFloorContact(input);
    const second = solveStudioVrmFloorContact(input);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.hipsTranslation)).toBe(true);
    expect(Object.isFrozen(first?.leftFoot)).toBe(true);
    expect(Object.isFrozen(first?.leftFoot.residualIkTranslation)).toBe(true);
  });
});
