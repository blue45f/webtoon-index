import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  canCommitStudioVrmIkResult,
  enabledStudioVrmIkPolesSceneLocal,
  enabledStudioVrmIkTargetsWorld,
  mirrorStudioVrmIkConstraints,
  parseStudioVrmIkConstraints,
  studioVrmSceneLocalPointToWorld,
  studioVrmWorldPointToSceneLocal,
  upsertStudioVrmIkConstraint,
} from "./studio-vrm-ik-constraints";

import type { StudioVrmFullBodyIkResult } from "./studio-vrm-full-body-ik";
import type { StudioVrmIkConstraint } from "./studio-vrm-scene-document";
import type { StudioVrmUserIkResult } from "./studio-vrm-user-ik";

const leftHand: StudioVrmIkConstraint = {
  effector: "leftHand",
  enabled: true,
  locked: true,
  target: [-0.5, 1.25, 0.2],
  pole: [-0.8, 1.1, 0.35],
};

describe("studio-vrm-ik-constraints", () => {
  it("strictly parses exact unique constraints in canonical effector order", () => {
    expect(parseStudioVrmIkConstraints([
      { ...leftHand, effector: "rightFoot", pole: null },
      leftHand,
    ])?.map((constraint) => constraint.effector)).toEqual(["leftHand", "rightFoot"]);
    expect(parseStudioVrmIkConstraints([leftHand, leftHand])).toBeNull();
    expect(parseStudioVrmIkConstraints([{ ...leftHand, future: true }])).toBeNull();
    expect(parseStudioVrmIkConstraints([{ ...leftHand, target: [0, Number.NaN, 0] }])).toBeNull();
    expect(parseStudioVrmIkConstraints([{ ...leftHand, target: [10_001, 0, 0] }])).toBeNull();
  });

  it("keeps canvas-scene targets stable across avatar root, yaw, and body-scale edits", () => {
    const parent = new THREE.Group();
    parent.position.set(2, -1, 3);
    parent.rotation.set(0.1, -0.2, 0.05);
    const scene = new THREE.Group();
    scene.position.set(0.75, 1.1, -0.4);
    scene.rotation.y = Math.PI / 3;
    scene.scale.set(0.85, 1.25, 0.85);
    parent.add(scene);
    parent.updateMatrixWorld(true);

    const local = [-0.45, 1.3, 0.15] as const;
    const world = studioVrmSceneLocalPointToWorld(parent, local);
    expect(world).not.toBeNull();
    const roundTrip = studioVrmWorldPointToSceneLocal(parent, world!);
    expect(roundTrip).not.toBeNull();
    roundTrip?.forEach((coordinate, index) => expect(coordinate).toBeCloseTo(local[index]!, 10));

    scene.position.set(-1, 0.25, 2);
    scene.rotation.y = -Math.PI / 4;
    scene.scale.set(1.4, 0.7, 1.4);
    parent.updateMatrixWorld(true);
    const movedWorld = studioVrmSceneLocalPointToWorld(parent, local);
    movedWorld?.forEach((coordinate, index) => expect(coordinate).toBeCloseTo(world![index]!, 10));
    const movedRoundTrip = studioVrmWorldPointToSceneLocal(parent, movedWorld!);
    movedRoundTrip?.forEach((coordinate, index) => expect(coordinate).toBeCloseTo(local[index]!, 10));
  });

  it("requires convergence only for full-body IK commit candidates", () => {
    expect(canCommitStudioVrmIkResult({} as StudioVrmUserIkResult)).toBe(true);
    expect(canCommitStudioVrmIkResult({
      constraints: [],
      converged: true,
    } as unknown as StudioVrmFullBodyIkResult)).toBe(true);
    expect(canCommitStudioVrmIkResult({
      constraints: [],
      converged: false,
    } as unknown as StudioVrmFullBodyIkResult)).toBe(false);
  });

  it("mirrors only the requested limb scope and exchanges target/pole ownership", () => {
    const rightFoot: StudioVrmIkConstraint = {
      effector: "rightFoot",
      enabled: false,
      locked: false,
      target: [0.25, 0, -0.1],
      pole: [0.4, 0.5, -0.2],
    };
    expect(mirrorStudioVrmIkConstraints([leftHand, rightFoot], "arms")).toEqual([
      {
        ...leftHand,
        effector: "rightHand",
        target: [0.5, 1.25, 0.2],
        pole: [0.8, 1.1, 0.35],
      },
      rightFoot,
    ]);
    expect(mirrorStudioVrmIkConstraints([leftHand, rightFoot], "legs")).toEqual([
      leftHand,
      {
        ...rightFoot,
        effector: "leftFoot",
        target: [-0.25, 0, -0.1],
        pole: [-0.4, 0.5, -0.2],
      },
    ]);
  });

  it("updates a single pin and exposes enabled targets only", () => {
    const disabled = { ...leftHand, enabled: false };
    const updated = upsertStudioVrmIkConstraint([disabled], {
      ...leftHand,
      target: [-0.25, 1.4, 0.1],
    });
    expect(updated).toHaveLength(1);
    expect(updated[0]?.target).toEqual([-0.25, 1.4, 0.1]);

    const scene = new THREE.Group();
    scene.updateMatrixWorld(true);
    expect(enabledStudioVrmIkTargetsWorld(scene, [disabled])).toEqual({});
    expect(enabledStudioVrmIkTargetsWorld(scene, updated)).toEqual({
      leftHand: [-0.25, 1.4, 0.1],
    });
    expect(enabledStudioVrmIkPolesSceneLocal([disabled])).toEqual({});
    const poles = enabledStudioVrmIkPolesSceneLocal(updated);
    expect(poles).toEqual({ leftHand: leftHand.pole });
    expect(poles.leftHand).not.toBe(leftHand.pole);
  });
});
