import { describe, expect, it } from "vitest";

import {
  Studio3DFootContactSolver,
  type CharacterRigPoseSnapshot,
} from "./studio-3d-foot-contact-lock";

describe("Studio3DFootContactSolver", () => {
  const solver = new Studio3DFootContactSolver({
    groundLevelY: 0.0,
    toleranceMeters: 0.005,
    autoLevelPelvis: true,
  });

  const createSamplePose = (leftAnkleY: number, rightAnkleY: number): CharacterRigPoseSnapshot => ({
    root: { x: 0, y: 0, z: 0 },
    pelvis: { x: 0, y: 0.95, z: 0 },
    leftLeg: {
      hip: { x: -0.15, y: 0.9, z: 0 },
      knee: { x: -0.15, y: 0.5, z: 0.05 },
      ankle: { x: -0.15, y: leftAnkleY, z: 0 },
      toe: { x: -0.15, y: leftAnkleY, z: 0.15 },
    },
    rightLeg: {
      hip: { x: 0.15, y: 0.9, z: 0 },
      knee: { x: 0.15, y: 0.5, z: 0.05 },
      ankle: { x: 0.15, y: rightAnkleY, z: 0 },
      toe: { x: 0.15, y: rightAnkleY, z: 0.15 },
    },
  });

  it("identifies grounded feet at ground level zero", () => {
    const pose = createSamplePose(0.0, 0.0);
    const res = solver.solve(pose);

    expect(res.groundingState.isLeftGrounded).toBe(true);
    expect(res.groundingState.isRightGrounded).toBe(true);
    expect(res.hasCollisionCorrection).toBe(false);
    expect(res.groundingState.leftPenetrationDepth).toBe(0);
    expect(res.groundingState.pelvisVerticalOffset).toBe(0);
  });

  it("detects ground penetration and lifts ankle and pelvis automatically", () => {
    // Left foot penetrates 5 cm (-0.05)
    const pose = createSamplePose(-0.05, 0.0);
    const res = solver.solve(pose);

    expect(res.hasCollisionCorrection).toBe(true);
    expect(res.groundingState.leftPenetrationDepth).toBeCloseTo(0.05, 2);
    expect(res.correctedPose.leftLeg.ankle.y).toBeGreaterThanOrEqual(0.0);
    expect(res.groundingState.pelvisVerticalOffset).toBeCloseTo(0.05, 2);
    expect(res.correctedPose.pelvis.y).toBeCloseTo(1.0, 2);
  });

  it("identifies jumping/floating character with both feet in the air", () => {
    const pose = createSamplePose(0.5, 0.45);
    const res = solver.solve(pose);

    expect(res.groundingState.isLeftGrounded).toBe(false);
    expect(res.groundingState.isRightGrounded).toBe(false);
    expect(res.hasCollisionCorrection).toBe(false);
    expect(res.groundingState.pelvisVerticalOffset).toBe(0);
  });

  it("calculates toe roll angle when heel is lifted in step motion", () => {
    const pose: CharacterRigPoseSnapshot = {
      root: { x: 0, y: 0, z: 0 },
      pelvis: { x: 0, y: 0.95, z: 0 },
      leftLeg: {
        hip: { x: -0.15, y: 0.9, z: 0 },
        knee: { x: -0.15, y: 0.5, z: 0.05 },
        ankle: { x: -0.15, y: 0.1, z: -0.05 }, // Heel lifted 10cm
        toe: { x: -0.15, y: 0.0, z: 0.1 }, // Toe grounded
      },
      rightLeg: {
        hip: { x: 0.15, y: 0.9, z: 0 },
        knee: { x: 0.15, y: 0.5, z: 0.05 },
        ankle: { x: 0.15, y: 0.0, z: 0 },
        toe: { x: 0.15, y: 0.0, z: 0.15 },
      },
    };

    const res = solver.solve(pose);
    expect(res.groundingState.leftToeAngleDeg).toBeGreaterThan(15);
  });

  it("solves Two-Bone IK law of cosines correctly", () => {
    const ik = solver.solveTwoBoneIK(0.45, 0.45, 0.6);
    expect(ik.upperAngleDeg).toBeGreaterThan(0);
    expect(ik.lowerAngleDeg).toBeGreaterThan(0);
    expect(ik.lowerAngleDeg).toBeLessThan(180);
  });
});
