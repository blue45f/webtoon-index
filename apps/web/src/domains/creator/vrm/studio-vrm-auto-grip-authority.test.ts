import { describe, expect, it } from "vitest";

import {
  createStudioVrmAuthoredFingerSnapshot,
  resolveStudioVrmFingerAuthority,
} from "./studio-vrm-auto-grip-authority";

import type { FingerRotationMap } from "./studio-vrm-poser-utils";
import type { AutoGripFingerOverrides } from "./studio-vrm-prop-rig";

describe("VRM 자동 그립 권한", () => {
  it("자연 포즈가 손가락 전체를 갖고 있어도 자동 그립이 활성 손의 최종 권위가 된다", () => {
    const authored: FingerRotationMap = {
      rightIndexProximal: [0.01, 0.02, 0.03],
      rightIndexIntermediate: [0.04, 0.05, 0.06],
      leftIndexIntermediate: [0.07, 0.08, -0.09],
    };
    const autoGrip: AutoGripFingerOverrides = {
      rightIndexProximal: [0, 0, 0.55],
      rightIndexIntermediate: [0, 0, 0.88],
    };

    expect(resolveStudioVrmFingerAuthority(authored, autoGrip)).toEqual({
      rightIndexProximal: [0, 0, 0.55],
      rightIndexIntermediate: [0, 0, 0.88],
      leftIndexIntermediate: [0.07, 0.08, -0.09],
    });
  });

  it("자동 그립을 끄면 파생값 없이 원래 저작 손가락 값이 정확히 복원된다", () => {
    const authored: FingerRotationMap = {
      rightThumbProximal: [0.1, 0.2, 0.3],
      rightLittleDistal: [0.4, 0.5, 0.6],
    };

    const resolved = resolveStudioVrmFingerAuthority(authored, {});
    expect(resolved).toEqual(authored);
    expect(resolved).not.toBe(authored);
  });

  it("휴대용 scene에는 파생 자동 그립이 아니라 유효한 저작값만 복제한다", () => {
    const authored: FingerRotationMap = {
      rightIndexIntermediate: [0.1, 0.2, 0.3],
      leftThumbDistal: [-0.2, -0.1, 0],
      rightRingDistal: [Number.NaN, 0, 0],
    };
    const derived: AutoGripFingerOverrides = {
      rightMiddleIntermediate: [0, 0, 0.9],
    };

    const visible = resolveStudioVrmFingerAuthority(authored, derived);
    const snapshot = createStudioVrmAuthoredFingerSnapshot(authored);

    expect(visible.rightMiddleIntermediate).toEqual([0, 0, 0.9]);
    expect(snapshot).toEqual({
      rightIndexIntermediate: [0.1, 0.2, 0.3],
      leftThumbDistal: [-0.2, -0.1, 0],
    });
    expect(snapshot.rightMiddleIntermediate).toBeUndefined();
    expect(snapshot.rightRingDistal).toBeUndefined();
  });
});
