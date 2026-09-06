import { describe, expect, it } from "vitest";

import {
  STUDIO_VRM_HAND_POSE_TYPES,
  createStudioVrmFingerCurlPose,
  createStudioVrmHandPose,
  studioVrmHandPoseGlyphCurls,
  type StudioVrmHandPoseType,
} from "./studio-vrm-hand-poses";

const FINGERS = ["Index", "Middle", "Ring", "Little"] as const;
const DEGREES = 180 / Math.PI;

describe("natural normalized-VRM hand poses", () => {
  it.each(STUDIO_VRM_HAND_POSE_TYPES)("defines a complete, mirrored hand for %s", (type) => {
    const right = createStudioVrmHandPose("right", type);
    const left = createStudioVrmHandPose("left", type);
    expect(Object.keys(right)).toHaveLength(15);
    expect(Object.keys(left)).toHaveLength(15);
    for (const [bone, rotation] of Object.entries(right)) {
      expect(bone.startsWith("right")).toBe(true);
      expect(rotation.every(Number.isFinite)).toBe(true);
      const mirrored = left[bone.replace(/^right/, "left")];
      expect(mirrored[0]).toBeCloseTo(rotation[0], 10);
      expect(mirrored[1]).toBeCloseTo(-rotation[1], 10);
      expect(mirrored[2]).toBeCloseTo(-rotation[2], 10);
    }
    for (const finger of FINGERS) {
      const middle = right[`right${finger}Intermediate`];
      const distal = right[`right${finger}Distal`];
      expect(distal[2]).toBeLessThanOrEqual(middle[2]);
      expect(middle[1]).toBe(0);
      expect(distal[1]).toBe(0);
    }
  });

  it("replaces every thumb segment when switching away from a grip", () => {
    const hand = {
      ...createStudioVrmHandPose("right", "holding"),
      ...createStudioVrmHandPose("right", "relaxed"),
    };
    expect(hand).toEqual(createStudioVrmHandPose("right", "relaxed"));
    expect(hand.rightThumbMetacarpal).not.toEqual(createStudioVrmHandPose("right", "holding").rightThumbMetacarpal);
  });

  it("relaxes each finger by a different amount instead of producing a uniform claw", () => {
    const hand = createStudioVrmHandPose("right", "relaxed");
    const proximal = FINGERS.map((finger) => hand[`right${finger}Proximal`][2]);
    expect(new Set(proximal).size).toBe(4);
    expect(proximal).toEqual([...proximal].sort((a, b) => a - b));
  });

  it("does not emit body, wrist or opposite-hand edits", () => {
    for (const name of Object.keys(createStudioVrmHandPose("left", "fist"))) {
      expect(name).toMatch(/^left(Thumb|Index|Middle|Ring|Little)/);
    }
  });

  it("provides independent result arrays and rejects inherited pose keys", () => {
    const first = createStudioVrmHandPose("right", "fist");
    first.rightIndexProximal[2] = 999;
    expect(createStudioVrmHandPose("right", "fist").rightIndexProximal[2]).not.toBe(999);
    for (const type of ["unknown", "__proto__", "constructor"]) {
      expect(createStudioVrmHandPose("right", type as StudioVrmHandPoseType))
        .toEqual(createStudioVrmHandPose("right", "relaxed"));
    }
  });

  it("derives thumbnail curls from the actual joint rotations", () => {
    const folded = createStudioVrmHandPose("right", "fist");
    for (const type of STUDIO_VRM_HAND_POSE_TYPES) {
      const hand = createStudioVrmHandPose("right", type);
      const curls = studioVrmHandPoseGlyphCurls(type);
      expect(curls).toHaveLength(5);
      curls.forEach((curl) => {
        expect(curl).toBeGreaterThanOrEqual(0);
        expect(curl).toBeLessThanOrEqual(1);
      });
      FINGERS.forEach((finger, index) => {
        const names = ["Proximal", "Intermediate", "Distal"].map((segment) => `right${finger}${segment}`);
        const sum = names.reduce((total, name) => total + Math.max(0, hand[name][2]), 0);
        const maximum = names.reduce((total, name) => total + folded[name][2], 0);
        expect(curls[index + 1]).toBeCloseTo(Math.min(1, sum / maximum), 10);
      });
    }
  });
});

describe("coupled finger curl control", () => {
  it.each([0, 1, 20, 45, 60, 90, 1000])("keeps the slider readback and joint order at %s degrees", (input) => {
    const expected = Math.min(90, input);
    for (const side of ["left", "right"] as const) {
      const hand = createStudioVrmFingerCurlPose(side, input);
      expect(Object.keys(hand)).toHaveLength(15);
      const proximal = Math.abs(hand[`${side}IndexProximal`][2]) * DEGREES;
      const middle = Math.abs(hand[`${side}IndexIntermediate`][2]) * DEGREES;
      const distal = Math.abs(hand[`${side}IndexDistal`][2]) * DEGREES;
      expect(proximal).toBeCloseTo(expected);
      expect(middle).toBeGreaterThanOrEqual(proximal - 1e-10);
      expect(distal).toBeLessThanOrEqual(middle);
      expect(Math.abs(hand[`${side}ThumbProximal`][1]) * DEGREES / 0.6).toBeCloseTo(expected);
    }
  });

  it.each(["thumb", "index", "middle", "ring", "little"] as const)("updates only the requested %s", (finger) => {
    const patch = createStudioVrmFingerCurlPose("left", 30, finger);
    expect(Object.keys(patch)).toHaveLength(3);
    expect(Object.keys(patch).every((bone) => bone.toLowerCase().startsWith(`left${finger}`))).toBe(true);
  });

  it("ignores non-finite input instead of resetting the hand", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(createStudioVrmFingerCurlPose("right", value)).toEqual({});
    }
    expect(createStudioVrmFingerCurlPose("right", -40)).toEqual(createStudioVrmFingerCurlPose("right", 0));
  });
});
