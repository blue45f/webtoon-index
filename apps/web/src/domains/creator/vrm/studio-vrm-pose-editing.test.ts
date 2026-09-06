import { describe, expect, it } from "vitest";

import {
  clampStudioVrmJointDegrees,
  mirrorStudioVrmFingerRotations,
  mirrorStudioVrmPoseBones,
  resolveStudioVrmJointAxisRange,
  straightenStudioVrmUpperBody,
  studioVrmMirroredBoneName,
} from "./studio-vrm-pose-editing";

describe("studio-vrm-pose-editing", () => {
  it("mirrors side names without rewriting central bones", () => {
    expect(studioVrmMirroredBoneName("leftUpperArm")).toBe("rightUpperArm");
    expect(studioVrmMirroredBoneName("rightIndexDistal")).toBe("leftIndexDistal");
    expect(studioVrmMirroredBoneName("spine")).toBe("spine");
  });

  it("mirrors only the selected semantic region", () => {
    const mirrored = mirrorStudioVrmPoseBones(
      {
        leftUpperArm: { rotation: [0.1, 0.2, 0.3] },
        rightUpperArm: { direction: [0.4, -0.8, 0.2] },
        leftUpperLeg: { rotation: [0.5, 0.6, 0.7] },
        spine: { rotation: [0.2, 0.3, 0.4] },
      },
      "arms",
    );

    expect(mirrored.rightUpperArm).toEqual({ rotation: [0.1, -0.2, -0.3] });
    expect(mirrored.leftUpperArm).toEqual({ direction: [-0.4, -0.8, 0.2] });
    expect(mirrored.leftUpperLeg).toEqual({ rotation: [0.5, 0.6, 0.7] });
    expect(mirrored.spine).toEqual({ rotation: [0.2, 0.3, 0.4] });
  });

  it("clears the stale source side when a mirrored counterpart is absent", () => {
    const mirrored = mirrorStudioVrmPoseBones(
      { leftUpperArm: { rotation: [0.1, 0.2, 0.3] } },
      "arms",
    );
    expect(mirrored.leftUpperArm).toBeUndefined();
    expect(mirrored.rightUpperArm).toEqual({ rotation: [0.1, -0.2, -0.3] });
  });

  it("mirrors finger edits for arm scopes and preserves them for other scopes", () => {
    const fingers = { leftIndexProximal: [0.1, 0.2, 0.3] as const };
    expect(mirrorStudioVrmFingerRotations(fingers, "arms")).toEqual({
      rightIndexProximal: [0.1, -0.2, -0.3],
    });
    expect(mirrorStudioVrmFingerRotations(fingers, "legs")).toEqual(fingers);
  });

  it("straightens only existing torso and head edits", () => {
    const straightened = straightenStudioVrmUpperBody({
      spine: { direction: [0.2, 0.8, 0] },
      head: { rotation: [0.1, 0.2, 0.3] },
      leftUpperArm: { rotation: [0.4, 0.5, 0.6] },
    });
    expect(straightened.spine).toEqual({ rotation: [0, 0, 0] });
    expect(straightened.head).toEqual({ rotation: [0, 0, 0] });
    expect(straightened.leftUpperArm).toEqual({ rotation: [0.4, 0.5, 0.6] });
    expect(straightened.neck).toBeUndefined();
  });

  it("clamps finite edits to the reference profile and fails invalid values closed", () => {
    expect(clampStudioVrmJointDegrees("head", 1, 120)).toBe(85);
    expect(clampStudioVrmJointDegrees("head", 1, -120)).toBe(-85);
    expect(clampStudioVrmJointDegrees("head", 1, Number.NaN)).toBe(0);
    expect(clampStudioVrmJointDegrees("leftUpperArm", 99, 999)).toBe(180);
    expect(resolveStudioVrmJointAxisRange("leftUpperArm", 2)).toEqual({
      minDegrees: -170,
      maxDegrees: 170,
    });
  });
});
