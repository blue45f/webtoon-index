import {
  clampStudioMannequinJointRotation,
  isStudioMannequinJointId,
  type StudioMannequinJointId,
  type StudioMannequinVec3,
} from "./studio-mannequin-model";
import {
  normalizeStudioMannequinPose,
  type StudioMannequinPose,
} from "./studio-mannequin-poses";
import {
  solvePoseToMannequinJoints,
  type PoseLandmark,
} from "./studio-mannequin-webcam-tracking";

export interface StudioMannequinPhotoPoseLandmark {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
  readonly visibility?: number;
}

export interface StudioMannequinPhotoPoseInput {
  readonly landmarks?: Readonly<Record<string, StudioMannequinPhotoPoseLandmark>>;
  /** Validated MediaPipe Pose world landmarks from the shared VRM photo scanner. */
  readonly mediaPipeLandmarks?: readonly PoseLandmark[];
  readonly currentPose?: StudioMannequinPose;
  readonly mirrorMode?: boolean;
  readonly minimumVisibility?: number;
  readonly joints?: Readonly<Partial<Record<StudioMannequinJointId, StudioMannequinVec3>>>;
  readonly pelvisOffset?: StudioMannequinVec3;
}

export interface StudioMannequinPhotoPoseApplyPlan {
  readonly pose: StudioMannequinPose;
  readonly appliedJoints: readonly StudioMannequinJointId[];
  readonly skippedJoints: readonly string[];
}

/**
 * Calculates joint eulers from 2D/3D body landmarks or scanned joint rotators for 3D Mannequin.
 */
export function createStudioMannequinPhotoPoseApplyPlan(
  input: StudioMannequinPhotoPoseInput,
): StudioMannequinPhotoPoseApplyPlan {
  const currentPose = normalizeStudioMannequinPose(input.currentPose ?? {
    joints: {},
    pelvisOffset: [0, 0, 0],
  });
  const joints: Partial<Record<StudioMannequinJointId, StudioMannequinVec3>> = {
    ...currentPose.joints,
  };
  const appliedJoints: StudioMannequinJointId[] = [];
  const appliedJointSet = new Set<StudioMannequinJointId>();
  const skippedJoints: string[] = [];

  const applyJoint = (key: string, value: StudioMannequinVec3 | undefined): void => {
    if (!isStudioMannequinJointId(key) || !value) {
      skippedJoints.push(key);
      return;
    }
    const rotation = clampStudioMannequinJointRotation(key, value);
    joints[key] = rotation;
    if (!appliedJointSet.has(key)) {
      appliedJointSet.add(key);
      appliedJoints.push(key);
    }
  };

  if (input.mediaPipeLandmarks) {
    const minimumVisibility = input.minimumVisibility ?? 0.35;
    const validLandmarks = input.mediaPipeLandmarks.length === 33
      && input.mediaPipeLandmarks.every((landmark) =>
        Number.isFinite(landmark.x)
        && Number.isFinite(landmark.y)
        && Number.isFinite(landmark.z)
        && (landmark.visibility === undefined
          || (Number.isFinite(landmark.visibility)
            && landmark.visibility >= 0
            && landmark.visibility <= 1)))
      && Number.isFinite(minimumVisibility)
      && minimumVisibility >= 0
      && minimumVisibility <= 1;

    if (!validLandmarks) {
      skippedJoints.push("mediaPipeLandmarks");
    } else {
      const solved = solvePoseToMannequinJoints(input.mediaPipeLandmarks, {
        mirrorMode: input.mirrorMode ?? false,
        minVisibility: minimumVisibility,
      });
      for (const [key, value] of Object.entries(solved)) {
        applyJoint(key, value);
      }
    }
  }

  if (input.joints) {
    for (const [key, value] of Object.entries(input.joints)) {
      applyJoint(key, value);
    }
  }

  if (input.landmarks) {
    const lm = input.landmarks;
    const getLm = (name: string) => lm[name];

    const leftShoulder = getLm("leftShoulder") ?? getLm("11");
    const leftElbow = getLm("leftElbow") ?? getLm("13");
    const leftWrist = getLm("leftWrist") ?? getLm("15");

    if (leftShoulder && leftElbow) {
      const dx = leftElbow.x - leftShoulder.x;
      const dy = leftElbow.y - leftShoulder.y;
      const angleZ = Math.atan2(dy, dx);
      joints.leftUpperArm = clampStudioMannequinJointRotation("leftUpperArm", [
        0,
        0,
        Math.min(2.5, Math.max(-0.5, angleZ)),
      ]);
      appliedJoints.push("leftUpperArm");
    }

    if (leftElbow && leftWrist) {
      const dx = leftWrist.x - leftElbow.x;
      const dy = leftWrist.y - leftElbow.y;
      const flex = Math.min(0, -Math.abs(Math.atan2(dy, dx)));
      joints.leftLowerArm = clampStudioMannequinJointRotation("leftLowerArm", [flex, 0, 0]);
      appliedJoints.push("leftLowerArm");
    }

    const rightShoulder = getLm("rightShoulder") ?? getLm("12");
    const rightElbow = getLm("rightElbow") ?? getLm("14");
    const rightWrist = getLm("rightWrist") ?? getLm("16");

    if (rightShoulder && rightElbow) {
      const dx = rightElbow.x - rightShoulder.x;
      const dy = rightElbow.y - rightShoulder.y;
      const angleZ = Math.atan2(dy, -dx);
      joints.rightUpperArm = clampStudioMannequinJointRotation("rightUpperArm", [
        0,
        0,
        Math.max(-2.5, Math.min(0.5, -angleZ)),
      ]);
      appliedJoints.push("rightUpperArm");
    }

    if (rightElbow && rightWrist) {
      const dx = rightWrist.x - rightElbow.x;
      const dy = rightWrist.y - rightElbow.y;
      const flex = Math.min(0, -Math.abs(Math.atan2(dy, dx)));
      joints.rightLowerArm = clampStudioMannequinJointRotation("rightLowerArm", [flex, 0, 0]);
      appliedJoints.push("rightLowerArm");
    }
  }

  const pose = normalizeStudioMannequinPose({
    joints,
    pelvisOffset: input.pelvisOffset ?? currentPose.pelvisOffset,
  });

  return Object.freeze({
    pose,
    appliedJoints: Object.freeze(appliedJoints),
    skippedJoints: Object.freeze(skippedJoints),
  });
}
