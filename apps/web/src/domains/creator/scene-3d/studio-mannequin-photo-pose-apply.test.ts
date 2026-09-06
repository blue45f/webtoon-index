import { describe, expect, it } from "vitest";

import { createStudioMannequinPhotoPoseApplyPlan } from "./studio-mannequin-photo-pose-apply";

import type { PoseLandmark } from "./studio-mannequin-webcam-tracking";

function mediaPipeBody(): PoseLandmark[] {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.95,
  }));
  Object.assign(landmarks[11]!, { x: 0.4, y: 0.25 });
  Object.assign(landmarks[12]!, { x: 0.6, y: 0.25 });
  Object.assign(landmarks[13]!, { x: 0.3, y: 0.45 });
  Object.assign(landmarks[14]!, { x: 0.7, y: 0.45 });
  Object.assign(landmarks[15]!, { x: 0.2, y: 0.65 });
  Object.assign(landmarks[16]!, { x: 0.8, y: 0.65 });
  Object.assign(landmarks[23]!, { x: 0.44, y: 0.55 });
  Object.assign(landmarks[24]!, { x: 0.56, y: 0.55 });
  Object.assign(landmarks[25]!, { x: 0.43, y: 0.75 });
  Object.assign(landmarks[26]!, { x: 0.57, y: 0.75 });
  Object.assign(landmarks[27]!, { x: 0.42, y: 0.95 });
  Object.assign(landmarks[28]!, { x: 0.58, y: 0.95 });
  Object.assign(landmarks[29]!, { x: 0.42, y: 0.98, z: 0.08 });
  Object.assign(landmarks[30]!, { x: 0.58, y: 0.98, z: 0.08 });
  return landmarks;
}

describe("createStudioMannequinPhotoPoseApplyPlan", () => {
  it("creates pose snapshot from joint eulers", () => {
    const plan = createStudioMannequinPhotoPoseApplyPlan({
      joints: {
        leftUpperArm: [0.1, 0, 0.4],
        rightUpperArm: [0.1, 0, -0.4],
      },
    });

    expect(plan.appliedJoints).toEqual(["leftUpperArm", "rightUpperArm"]);
    expect(plan.skippedJoints).toEqual([]);
    expect(plan.pose.joints.leftUpperArm).toBeDefined();
    expect(plan.pose.joints.rightUpperArm).toBeDefined();
  });

  it("calculates arm pose from 2D landmarks", () => {
    const plan = createStudioMannequinPhotoPoseApplyPlan({
      landmarks: {
        leftShoulder: { x: 0.4, y: 0.3 },
        leftElbow: { x: 0.6, y: 0.5 },
        leftWrist: { x: 0.7, y: 0.8 },
      },
    });

    expect(plan.appliedJoints).toContain("leftUpperArm");
    expect(plan.appliedJoints).toContain("leftLowerArm");
    expect(plan.pose.joints.leftUpperArm).toBeDefined();
  });

  it("routes validated MediaPipe world landmarks through the existing mannequin solver and preserves undetected edits", () => {
    const plan = createStudioMannequinPhotoPoseApplyPlan({
      currentPose: {
        joints: { head: [0.1, 0.2, 0.3] },
        pelvisOffset: [0.2, 0, 0],
      },
      mediaPipeLandmarks: mediaPipeBody(),
      mirrorMode: false,
      minimumVisibility: 0.35,
    });

    expect(plan.appliedJoints.length).toBeGreaterThanOrEqual(6);
    expect(plan.pose.joints.leftUpperArm).toBeDefined();
    expect(plan.pose.joints.rightUpperLeg).toBeDefined();
    expect(plan.pose.joints.head?.[0]).toBeCloseTo(0.1);
    expect(plan.pose.joints.head?.[1]).toBeCloseTo(0.2);
    expect(plan.pose.joints.head?.[2]).toBeCloseTo(0.3);
    expect(plan.pose.pelvisOffset).toEqual([0.2, 0, 0]);
  });

  it("fails closed for malformed MediaPipe landmark packets without replacing the current pose", () => {
    const currentPose = {
      joints: { head: [0.1, 0, 0] as const },
      pelvisOffset: [0, 0, 0] as const,
    };
    const plan = createStudioMannequinPhotoPoseApplyPlan({
      currentPose,
      mediaPipeLandmarks: mediaPipeBody().slice(0, 32),
    });

    expect(plan.appliedJoints).toEqual([]);
    expect(plan.skippedJoints).toContain("mediaPipeLandmarks");
    expect(plan.pose.joints.head?.[0]).toBeCloseTo(0.1);
    expect(plan.pose.pelvisOffset).toEqual(currentPose.pelvisOffset);
  });
});
