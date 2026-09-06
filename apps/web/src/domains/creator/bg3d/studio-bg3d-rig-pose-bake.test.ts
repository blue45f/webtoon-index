import { describe, expect, it } from "vitest";

import {
  bakeStudioBg3dRigPoseLayer,
  createStudioBg3dRigPoseBakeCommitPatch,
  createStudioBg3dRigPoseBakeHistoryTransition,
  type StudioBg3dRigPoseBakeSample,
} from "./studio-bg3d-rig-pose-bake";

const IDENTITY = [0, 0, 0, 1] as const;

describe("static rig pose bake", () => {
  it("computes inverse(base) * output in the non-commutative quaternion order", () => {
    const halfSqrt = Math.SQRT1_2;
    const result = bakeStudioBg3dRigPoseLayer([{
      jointKey: "skin-0:joint-0",
      baseRotation: [halfSqrt, 0, 0, halfSqrt],
      outputRotation: [0, halfSqrt, 0, halfSqrt],
    }]);

    expect(result).not.toBeNull();
    expect(result!.joints[0]!.rotationOffset).toEqual([
      -0.5,
      0.5,
      -0.5,
      0.5,
    ]);
  });

  it("captures the live pre-bake timestamp without changing playback for atomic undo", () => {
    const animation = {
      clipIndex: 0,
      playing: true,
      loop: "repeat" as const,
      timeScale: 1,
      weight: 1,
      timeSeconds: 0,
    };
    const transition = createStudioBg3dRigPoseBakeHistoryTransition(animation, {
      pose: { enabled: true, weight: 1, joints: [] },
      sampledTimeSeconds: 7.5,
    });

    expect(transition?.beforeAnimation).toEqual({
      ...animation,
      playing: true,
      timeSeconds: 7.5,
    });
    expect(transition?.patch.animation).toEqual({
      ...animation,
      playing: false,
      timeSeconds: 7.5,
    });
    expect(animation).toEqual({
      clipIndex: 0,
      playing: true,
      loop: "repeat",
      timeScale: 1,
      weight: 1,
      timeSeconds: 0,
    });
  });

  it("supports static models while rejecting an invalid sampled history timestamp", () => {
    expect(createStudioBg3dRigPoseBakeHistoryTransition(undefined, {
      pose: { enabled: true, weight: 1, joints: [] },
      sampledTimeSeconds: 2,
    })).toMatchObject({ beforeAnimation: undefined, patch: { animation: undefined } });
    expect(createStudioBg3dRigPoseBakeHistoryTransition(undefined, {
      pose: { enabled: true, weight: 1, joints: [] },
      sampledTimeSeconds: Number.NaN,
    })).toBeNull();
  });

  it("preserves a paused authored loop timestamp in undo while baking its rendered sample", () => {
    const paused = {
      clipIndex: 0,
      playing: false,
      loop: "repeat" as const,
      timeScale: 1,
      weight: 1,
      timeSeconds: 3,
    };
    const transition = createStudioBg3dRigPoseBakeHistoryTransition(paused, {
      pose: { enabled: true, weight: 1, joints: [] },
      sampledTimeSeconds: 1,
    });

    expect(transition?.beforeAnimation).toBe(paused);
    expect(transition?.beforeAnimation?.timeSeconds).toBe(3);
    expect(transition?.patch.animation).toMatchObject({
      playing: false,
      loop: "repeat",
      timeSeconds: 1,
    });
  });

  it("canonicalizes q/-q equivalence, including deterministic w=0 half-turns", () => {
    const positive = bakeStudioBg3dRigPoseLayer([{
      jointKey: "joint",
      baseRotation: IDENTITY,
      outputRotation: [0, 2, 0, 0],
    }]);
    const negative = bakeStudioBg3dRigPoseLayer([{
      jointKey: "joint",
      baseRotation: [0, 0, 0, -1],
      outputRotation: [0, -2, 0, 0],
    }]);

    expect(positive).toEqual(negative);
    expect(positive?.joints[0]?.rotationOffset).toEqual([0, 1, 0, 0]);
    expect(Object.is(positive?.joints[0]?.rotationOffset[3], -0)).toBe(false);
  });

  it("omits identity-epsilon offsets while preserving retained input order", () => {
    const result = bakeStudioBg3dRigPoseLayer([
      { jointKey: "identity", baseRotation: IDENTITY, outputRotation: [0, 0, 0, -2] },
      { jointKey: "tiny", baseRotation: IDENTITY, outputRotation: [5e-9, 0, 0, 1] },
      { jointKey: "second", baseRotation: IDENTITY, outputRotation: [0, 0.2, 0, 1] },
      { jointKey: "third", baseRotation: IDENTITY, outputRotation: [0, 0, 0.3, 1] },
    ]);

    expect(result?.joints.map(({ jointKey }) => jointKey)).toEqual(["second", "third"]);
  });

  it("fails closed for blank, duplicate, non-finite, and zero quaternions", () => {
    const valid = { jointKey: "joint", baseRotation: IDENTITY, outputRotation: [0.1, 0, 0, 1] } as const;
    const invalidCases: readonly unknown[][] = [
      [{ ...valid, jointKey: "   " }],
      [valid, { ...valid, jointKey: " joint " }],
      [{ ...valid, baseRotation: [0, 0, 0, 0] }],
      [{ ...valid, outputRotation: [0, Number.NaN, 0, 1] }],
      [{ ...valid, outputRotation: [0, 0, Number.POSITIVE_INFINITY, 1] }],
    ];

    for (const samples of invalidCases) {
      expect(bakeStudioBg3dRigPoseLayer(samples as readonly StudioBg3dRigPoseBakeSample[])).toBeNull();
    }
  });

  it("fails closed instead of truncating 257 retained joint offsets", () => {
    const samples = Array.from({ length: 257 }, (_, index) => ({
      jointKey: `joint-${index}`,
      baseRotation: IDENTITY,
      outputRotation: [0.1, 0, 0, 1] as const,
    }));

    expect(bakeStudioBg3dRigPoseLayer(samples)).toBeNull();
  });

  it("does not mutate inputs and deeply freezes the complete pose layer", () => {
    const sample = {
      jointKey: "joint",
      baseRotation: [0, 0, 0, 2] as [number, number, number, number],
      outputRotation: [0.25, 0, 0, 1] as [number, number, number, number],
    };
    const samples = [sample];
    const snapshot = structuredClone(samples);

    const result = bakeStudioBg3dRigPoseLayer(samples);

    expect(samples).toEqual(snapshot);
    expect(result).toEqual({
      enabled: true,
      weight: 1,
      joints: [{
        jointKey: "joint",
        rotationOffset: [
          0.24253562503633297,
          0,
          0,
          0.9701425001453319,
        ],
      }],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.joints)).toBe(true);
    expect(Object.isFrozen(result?.joints[0])).toBe(true);
    expect(Object.isFrozen(result?.joints[0]?.rotationOffset)).toBe(true);
  });

  it("creates one atomic patch that pauses animation at the rendered sample and clears constraints", () => {
    const pose = bakeStudioBg3dRigPoseLayer([{
      jointKey: "joint",
      baseRotation: IDENTITY,
      outputRotation: [0.25, 0, 0, 1],
    }])!;
    const patch = createStudioBg3dRigPoseBakeCommitPatch({
      clipIndex: 2,
      playing: true,
      loop: "ping-pong",
      timeScale: 1.25,
      weight: 0.8,
      timeSeconds: 3,
    }, { pose, sampledTimeSeconds: 7.5 });
    const model = {
      id: "model",
      materialOverride: { opacity: 0.75 },
      morph: { enabled: true, weight: 0.5, targets: [] },
      constraints: { enabled: true, aims: [], twoBoneIks: [] },
      ...patch,
    };

    expect(patch).toEqual({
      animation: {
        clipIndex: 2,
        playing: false,
        loop: "ping-pong",
        timeScale: 1.25,
        weight: 0.8,
        timeSeconds: 7.5,
      },
      pose,
      constraints: undefined,
    });
    expect(model.materialOverride).toEqual({ opacity: 0.75 });
    expect(model.morph).toEqual({ enabled: true, weight: 0.5, targets: [] });
    expect(Object.isFrozen(patch)).toBe(true);
  });

  it("supports static models and fails closed on invalid sample time or noncanonical pose", () => {
    const pose = bakeStudioBg3dRigPoseLayer([{
      jointKey: "joint",
      baseRotation: IDENTITY,
      outputRotation: [0, 0.25, 0, 1],
    }])!;
    expect(createStudioBg3dRigPoseBakeCommitPatch(undefined, {
      pose,
      sampledTimeSeconds: 0,
    })).toMatchObject({ animation: undefined, pose, constraints: undefined });
    expect(createStudioBg3dRigPoseBakeCommitPatch(undefined, {
      pose,
      sampledTimeSeconds: Number.NaN,
    })).toBeNull();
    expect(createStudioBg3dRigPoseBakeCommitPatch(undefined, {
      pose: { ...pose, weight: 0.5 },
      sampledTimeSeconds: 1,
    })).toBeNull();
  });
});
