import { describe, expect, it } from "vitest";

import { buildStudioVrmPersistentIkSignature } from "./studio-vrm-persistent-ik-signature";
import { EMPTY_STUDIO_VRM_POSE_TRANSLATIONS } from "./studio-vrm-pose-translations";
import { NEUTRAL_STUDIO_VRM_PROPORTIONS } from "./studio-vrm-proportion-core";

function signature(overrides: Record<string, unknown> = {}) {
  return buildStudioVrmPersistentIkSignature({
    modelId: "model-a",
    bones: {
      rightHand: { rotation: [0, 0.2, 0] },
      leftHand: { rotation: [0, -0.2, 0] },
    },
    fingerEdits: {},
    yOffset: 0,
    translations: EMPTY_STUDIO_VRM_POSE_TRANSLATIONS,
    bodyRotation: 0,
    bodyScale: { height: 1, width: 1 },
    proportions: NEUTRAL_STUDIO_VRM_PROPORTIONS,
    constraints: [],
    lockedPoseBones: ["rightHand", "leftHand"],
    jointProfile: "neutral",
    fullBodyIk: true,
    footPlant: true,
    floorHeight: 0,
    ...overrides,
  });
}

describe("persistent IK semantic signature", () => {
  it("is stable across record and locked-bone insertion order", () => {
    expect(signature()).toBe(signature({
      bones: {
        leftHand: { rotation: [0, -0.2, 0] },
        rightHand: { rotation: [0, 0.2, 0] },
      },
      lockedPoseBones: ["leftHand", "rightHand"],
    }));
  });

  it("changes for pose, target, pole, and rig configuration edits", () => {
    const base = signature();
    expect(signature({ yOffset: 0.1 })).not.toBe(base);
    expect(signature({ lockedPoseBones: ["leftHand"] })).not.toBe(base);
    expect(signature({ jointProfile: "flexible" })).not.toBe(base);
    expect(signature({
      proportions: { ...NEUTRAL_STUDIO_VRM_PROPORTIONS, legLength: 1.1 },
    })).not.toBe(base);
    expect(signature({
      constraints: [{
        effector: "leftHand",
        enabled: true,
        locked: true,
        target: [1, 2, 3],
        pole: [0, 1, 0],
      }],
    })).not.toBe(base);
  });
});
