import { describe, expect, it } from "vitest";

import {
  STUDIO_VRM_FINGER_BONE_PREFIX,
  STUDIO_VRM_FINGER_LABELS,
  STUDIO_VRM_FINGER_NAMES,
  readStudioVrmFingerCurlDegrees,
} from "./studio-vrm-finger-curl";

const RAD_30 = (30 * Math.PI) / 180;

describe("studio vrm finger curl contract", () => {
  it("names every finger once and labels all of them", () => {
    expect(new Set(STUDIO_VRM_FINGER_NAMES).size).toBe(STUDIO_VRM_FINGER_NAMES.length);
    for (const finger of STUDIO_VRM_FINGER_NAMES) {
      expect(STUDIO_VRM_FINGER_LABELS[finger]).toBeTruthy();
    }
    expect(Object.keys(STUDIO_VRM_FINGER_BONE_PREFIX)).toEqual(["index", "middle", "ring", "little"]);
  });

  it("reads zero when nothing has been edited", () => {
    for (const finger of STUDIO_VRM_FINGER_NAMES) {
      expect(readStudioVrmFingerCurlDegrees({}, "left", finger)).toBe(0);
      expect(readStudioVrmFingerCurlDegrees({}, "right", finger)).toBe(0);
    }
  });

  it("reads each finger from its own bone, not from the index finger's", () => {
    const edits = {
      leftIndexProximal: [0, 0, -RAD_30],
      leftMiddleProximal: [0, 0, -RAD_30 * 2],
      leftRingProximal: [0, 0, 0],
      leftLittleProximal: [0, 0, -RAD_30 / 3],
    };
    expect(readStudioVrmFingerCurlDegrees(edits, "left", "index")).toBe(30);
    expect(readStudioVrmFingerCurlDegrees(edits, "left", "middle")).toBe(60);
    expect(readStudioVrmFingerCurlDegrees(edits, "left", "ring")).toBe(0);
    expect(readStudioVrmFingerCurlDegrees(edits, "left", "little")).toBe(10);
  });

  it("keeps the two hands apart", () => {
    const edits = { rightIndexProximal: [0, 0, RAD_30] };
    expect(readStudioVrmFingerCurlDegrees(edits, "right", "index")).toBe(30);
    expect(readStudioVrmFingerCurlDegrees(edits, "left", "index")).toBe(0);
  });

  it("undoes the thumb's own yaw ratio so the slider shows the angle that was set", () => {
    // 런타임은 엄지 근위 마디에 [0, sign*rad*0.6, sign*rad*0.5] 를 쓴다.
    const edits = { leftThumbProximal: [0, -RAD_30 * 0.6, -RAD_30 * 0.5] };
    expect(readStudioVrmFingerCurlDegrees(edits, "left", "thumb")).toBe(30);
  });

  it("reports the magnitude regardless of which way the hand bends", () => {
    expect(readStudioVrmFingerCurlDegrees({ leftIndexProximal: [0, 0, -RAD_30] }, "left", "index")).toBe(30);
    expect(readStudioVrmFingerCurlDegrees({ rightIndexProximal: [0, 0, RAD_30] }, "right", "index")).toBe(30);
  });

  it("survives a broken edit entry instead of showing NaN", () => {
    const broken = {
      leftIndexProximal: [0, 0, Number.NaN],
      leftMiddleProximal: [],
      leftRingProximal: undefined,
    };
    expect(readStudioVrmFingerCurlDegrees(broken, "left", "index")).toBe(0);
    expect(readStudioVrmFingerCurlDegrees(broken, "left", "middle")).toBe(0);
    expect(readStudioVrmFingerCurlDegrees(broken, "left", "ring")).toBe(0);
  });
});
