import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  solveStudioVrmFullBodyIk,
  type StudioVrmFullBodyIkRequest,
} from "./studio-vrm-full-body-ik";
import { clampStudioVrmJointRotation } from "./studio-vrm-joint-limits";
import {
  EMPTY_STUDIO_VRM_POSE_TRANSLATIONS,
  normalizeStudioVrmPoseTranslations,
} from "./studio-vrm-pose-translations";
import { applyPoseToVrm } from "./studio-vrm-poser-utils";
import { solveStudioVrmUserIk } from "./studio-vrm-user-ik";

import type { StudioVrmUserIkRequest, StudioVrmUserIkSource } from "./studio-vrm-user-ik";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

interface Fixture {
  readonly source: StudioVrmUserIkSource;
  readonly vrm: VRM;
  readonly scene: THREE.Group;
  readonly nodes: Map<VRMHumanBoneName, THREE.Bone>;
}

function bone(
  nodes: Map<VRMHumanBoneName, THREE.Bone>,
  name: VRMHumanBoneName,
  position: readonly [number, number, number],
): THREE.Bone {
  const node = new THREE.Bone();
  node.name = name;
  node.position.set(...position);
  nodes.set(name, node);
  return node;
}

function createFixture(): Fixture {
  const scene = new THREE.Group();
  const nodes = new Map<VRMHumanBoneName, THREE.Bone>();
  const hips = bone(nodes, "hips", [0, 2, 0]);
  const spine = bone(nodes, "spine", [0, 0.65, 0]);
  const chest = bone(nodes, "chest", [0, 0.55, 0]);
  scene.add(hips);
  hips.add(spine);
  spine.add(chest);

  for (const side of ["left", "right"] as const) {
    const sign = side === "left" ? -1 : 1;
    const shoulder = bone(nodes, `${side}Shoulder`, [sign * 0.35, 0.25, 0]);
    const upperArm = bone(nodes, `${side}UpperArm`, [0, 0, 0]);
    const lowerArm = bone(nodes, `${side}LowerArm`, [sign * 0.65, 0, 0]);
    const hand = bone(nodes, `${side}Hand`, [sign * 0.55, 0, 0]);
    chest.add(shoulder);
    shoulder.add(upperArm);
    upperArm.add(lowerArm);
    lowerArm.add(hand);

    const upperLeg = bone(nodes, `${side}UpperLeg`, [sign * 0.25, -0.05, 0]);
    const lowerLeg = bone(nodes, `${side}LowerLeg`, [0, -0.85, 0]);
    const foot = bone(nodes, `${side}Foot`, [0, -0.8, 0.08]);
    hips.add(upperLeg);
    upperLeg.add(lowerLeg);
    lowerLeg.add(foot);
  }
  scene.updateMatrixWorld(true);
  const basePositions = new Map(
    [...nodes.entries()].map(([name, node]) => [name, node.position.clone()] as const),
  );
  const humanoid = {
    getNormalizedBoneNode(name: VRMHumanBoneName) {
      return nodes.get(name) ?? null;
    },
    resetNormalizedPose() {
      for (const [name, node] of nodes) {
        node.position.copy(basePositions.get(name)!);
        node.quaternion.identity();
      }
      scene.updateMatrixWorld(true);
    },
    update() {
      scene.updateMatrixWorld(true);
    },
  };
  const vrm = {
    scene,
    humanoid,
    update() {
      scene.updateMatrixWorld(true);
    },
  } as unknown as VRM;
  return {
    scene,
    nodes,
    vrm,
    source: vrm as StudioVrmUserIkSource,
  };
}

function request(fixture: Fixture): StudioVrmFullBodyIkRequest {
  const hand = fixture.nodes.get("rightHand")!.getWorldPosition(new THREE.Vector3());
  return {
    primary: {
      effector: "rightHand",
      targetWorld: hand.add(new THREE.Vector3(2.4, 0.55, 0.3)),
      poleWorld: new THREE.Vector3(0.8, 3, 1),
    },
    baseTranslations: EMPTY_STUDIO_VRM_POSE_TRANSLATIONS,
    jointProfile: "neutral",
    fullBodyIk: true,
    footPlant: { enabled: true, floorHeight: 0.3 },
    iterations: 8,
    tolerance: 0.002,
  };
}

function snapshot(fixture: Fixture) {
  return {
    scenePosition: fixture.scene.position.clone(),
    nodes: [...fixture.nodes.values()].map((node) => ({
      node,
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
    })),
  };
}

describe("Studio VRM deterministic full-body IK", () => {
  it("solves an active hand and both planted feet as three deterministic constraints", () => {
    const fixture = createFixture();
    const first = solveStudioVrmFullBodyIk(fixture.source, request(fixture));
    const repeated = solveStudioVrmFullBodyIk(fixture.source, request(fixture));

    expect(first).not.toBeNull();
    expect(repeated).toEqual(first);
    expect(first?.constraints.map((constraint) => constraint.effector)).toEqual([
      "leftFoot",
      "rightFoot",
      "rightHand",
    ]);
    expect(first?.constraints.filter((constraint) => constraint.locked)).toHaveLength(2);
    expect(first?.iterations).toBeGreaterThan(0);
    expect(first?.iterations).toBeLessThanOrEqual(8);
    expect(first?.translations.root[1]).toBe(0);
    expect(Math.hypot(...first!.translations.hips)).toBeLessThanOrEqual(2 + 1e-12);
    expect(Math.hypot(...first!.translations.spine)).toBeLessThanOrEqual(0.75 + 1e-12);
    expect([
      ...first!.translations.root,
      ...first!.translations.hips,
      ...first!.translations.spine,
      first!.yOffset,
      first!.maxResidual,
    ].every(Number.isFinite)).toBe(true);
    expect(
      Math.hypot(...first!.translations.root)
      + Math.hypot(...first!.translations.hips)
      + Math.hypot(...first!.translations.spine),
    ).toBeGreaterThan(0);
  });

  it("solves one primary plus three persistent locks from one immutable baseline", () => {
    const fixture = createFixture();
    const world = (boneName: VRMHumanBoneName) => fixture.nodes.get(boneName)!
      .getWorldPosition(new THREE.Vector3());
    const result = solveStudioVrmFullBodyIk(fixture.source, {
      primary: {
        effector: "rightHand",
        targetWorld: world("rightHand").add(new THREE.Vector3(0.15, 0.1, 0.05)),
      },
      lockedTargets: [
        {
          effector: "leftHand",
          targetWorld: world("leftHand"),
          poleWorld: new THREE.Vector3(-0.8, 3, 1),
        },
        { effector: "leftFoot", targetWorld: world("leftFoot") },
        { effector: "rightFoot", targetWorld: world("rightFoot") },
      ],
      fullBodyIk: true,
    });

    expect(result?.constraints.map((constraint) => constraint.effector)).toEqual([
      "leftFoot",
      "rightFoot",
      "leftHand",
      "rightHand",
    ]);
    expect(result?.constraints.filter((constraint) => constraint.locked)).toHaveLength(3);
  });

  it("uses two simultaneous leg chains when one planted foot is dragged", () => {
    const fixture = createFixture();
    const rightFoot = fixture.nodes.get("rightFoot")!.getWorldPosition(new THREE.Vector3());
    const result = solveStudioVrmFullBodyIk(fixture.source, {
      primary: {
        effector: "rightFoot",
        targetWorld: rightFoot.add(new THREE.Vector3(0.35, 0.7, 0.2)),
      },
      fullBodyIk: true,
      footPlant: { enabled: true, floorHeight: 0.25 },
    });

    expect(result?.constraints.map((constraint) => constraint.effector)).toEqual([
      "leftFoot",
      "rightFoot",
    ]);
    expect(result?.constraints.find((constraint) => constraint.effector === "leftFoot")?.locked)
      .toBe(true);
    expect(result?.constraints.find((constraint) => constraint.effector === "rightFoot")?.targetWorld[1])
      .toBe(0.25);
    expect(result?.requestedTargetWorld[1]).toBe(0.25);
  });

  it("runs one simultaneous chain pass when foot planting is enabled without torso translation", () => {
    const fixture = createFixture();
    const rightFoot = fixture.nodes.get("rightFoot")!.getWorldPosition(new THREE.Vector3());
    const result = solveStudioVrmFullBodyIk(fixture.source, {
      primary: { effector: "rightFoot", targetWorld: rightFoot },
      baseTranslations: EMPTY_STUDIO_VRM_POSE_TRANSLATIONS,
      fullBodyIk: false,
      footPlant: { enabled: true, floorHeight: rightFoot.y },
    });

    expect(result?.constraints).toHaveLength(2);
    expect(result?.iterations).toBe(1);
    expect(result?.translations).toEqual(EMPTY_STUDIO_VRM_POSE_TRANSLATIONS);
  });

  it("does not mistake cancelling shared errors for convergence before the spine pass", () => {
    const fixture = createFixture();
    const rightUpperArm = fixture.nodes.get("rightUpperArm")!
      .getWorldPosition(new THREE.Vector3());
    // Each planted foot contributes +0.06m of shared contact error (0.5m * 0.12), while the
    // hand starts 0.12m beyond its maximum reach in the opposite direction. Their mean is zero.
    const handTarget = rightUpperArm.clone().add(new THREE.Vector3(0, -1.32, 0));
    const solveRequest: StudioVrmFullBodyIkRequest = {
      primary: { effector: "rightHand", targetWorld: handTarget },
      baseTranslations: EMPTY_STUDIO_VRM_POSE_TRANSLATIONS,
      jointProfile: "neutral",
      fullBodyIk: true,
      footPlant: { enabled: true, floorHeight: 0.8 },
      iterations: 8,
      tolerance: 0.002,
    };
    const withoutTorso = solveStudioVrmFullBodyIk(fixture.source, {
      ...solveRequest,
      fullBodyIk: false,
    });
    const result = solveStudioVrmFullBodyIk(fixture.source, solveRequest);

    expect(withoutTorso).not.toBeNull();
    expect(result).not.toBeNull();
    expect(Math.hypot(...result!.translations.spine)).toBeGreaterThan(0.01);
    expect(result!.iterations).toBeGreaterThan(1);
    expect(result!.maxResidual).toBeLessThan(withoutTorso!.maxResidual);
  });

  it("preserves valid per-axis translation corners when full-body allocation is disabled", () => {
    const fixture = createFixture();
    const rightHand = fixture.nodes.get("rightHand")!.getWorldPosition(new THREE.Vector3());
    const baseTranslations = {
      version: 1 as const,
      root: [10, 0, -10] as const,
      hips: [2, -2, 2] as const,
      spine: [0.75, -0.75, 0.75] as const,
    };
    const result = solveStudioVrmFullBodyIk(fixture.source, {
      primary: { effector: "rightHand", targetWorld: rightHand },
      baseTranslations,
      fullBodyIk: false,
    });

    expect(result?.translations).toEqual(baseTranslations);
    expect(result?.translationLimited).toBe(false);
  });

  it("reports a root boundary clamp instead of presenting a truncated solve as unconstrained", () => {
    const fixture = createFixture();
    const rightHand = fixture.nodes.get("rightHand")!.getWorldPosition(new THREE.Vector3());
    const result = solveStudioVrmFullBodyIk(fixture.source, {
      primary: {
        effector: "rightHand",
        targetWorld: rightHand.add(new THREE.Vector3(100, 0, 100)),
      },
      baseTranslations: {
        version: 1,
        root: [10, 0, 10],
        hips: [0, 0, 0],
        spine: [0, 0, 0],
      },
      fullBodyIk: true,
    });

    expect(result?.translations.root).toEqual([10, 0, 10]);
    expect(result?.translationLimited).toBe(true);
    expect(result?.limited).toBe(true);
  });

  it("keeps every authored IK rotation inside the hard joint limits", () => {
    const fixture = createFixture();
    const result = solveStudioVrmFullBodyIk(fixture.source, request(fixture));
    expect(result).not.toBeNull();
    for (const constraint of result!.constraints) {
      const side = constraint.effector.startsWith("left") ? "left" : "right";
      const kind = constraint.effector.endsWith("Hand") ? "Arm" : "Leg";
      for (const segment of ["Upper", "Lower"] as const) {
        const name = `${side}${segment}${kind}` as VRMHumanBoneName;
        const rotation = result!.bones[name]?.rotation;
        expect(rotation).toBeDefined();
        expect(rotation).toEqual(clampStudioVrmJointRotation(name, rotation));
      }
    }
  });

  it("moves the target and world pole by the same allocated baseline influence", () => {
    const fixture = createFixture();
    const solveRequest = request(fixture);
    const calls: StudioVrmUserIkRequest[] = [];
    const result = solveStudioVrmFullBodyIk(fixture.source, solveRequest, {
      solveChain(source, chainRequest) {
        calls.push(chainRequest);
        return solveStudioVrmUserIk(source, chainRequest);
      },
    });
    const handCall = calls.find((call) => call.effector === "rightHand");

    expect(result).not.toBeNull();
    expect(handCall?.poleWorld).toBeDefined();
    const targetInfluence = solveRequest.primary.targetWorld.clone().sub(handCall!.targetWorld);
    const poleInfluence = solveRequest.primary.poleWorld!.clone().sub(handCall!.poleWorld!);
    expect(targetInfluence.length()).toBeGreaterThan(0);
    expect(targetInfluence.distanceTo(poleInfluence)).toBeLessThan(1e-10);
  });

  it("applies the saved translation contract to the same runtime pose without accumulating", () => {
    const fixture = createFixture();
    const initialHand = fixture.nodes.get("rightHand")!.getWorldPosition(new THREE.Vector3());
    const solveRequest = request(fixture);
    const target = solveRequest.primary.targetWorld;
    const result = solveStudioVrmFullBodyIk(fixture.source, solveRequest)!;

    expect(applyPoseToVrm(
      fixture.vrm,
      result.bones,
      result.yOffset,
      result.translations,
    )).toBe(true);
    const firstHand = fixture.nodes.get("rightHand")!.getWorldPosition(new THREE.Vector3());
    const firstLeftFoot = fixture.nodes.get("leftFoot")!.getWorldPosition(new THREE.Vector3());
    const firstRightFoot = fixture.nodes.get("rightFoot")!.getWorldPosition(new THREE.Vector3());
    expect(firstHand.distanceTo(target)).toBeLessThan(initialHand.distanceTo(target));
    expect(Math.abs(firstLeftFoot.y - 0.3)).toBeLessThan(0.35);
    expect(Math.abs(firstRightFoot.y - 0.3)).toBeLessThan(0.35);
    for (const constraint of result.constraints) {
      const actual = fixture.nodes.get(constraint.effector)!.getWorldPosition(new THREE.Vector3());
      const reported = new THREE.Vector3(...constraint.effectiveTargetWorld);
      const targetWorld = new THREE.Vector3(...constraint.targetWorld);
      expect(actual.distanceTo(reported)).toBeLessThan(1e-3);
      expect(constraint.residual).toBeCloseTo(actual.distanceTo(targetWorld), 5);
    }
    expect(result.maxResidual).toBeCloseTo(
      Math.max(...result.constraints.map((constraint) => constraint.residual)),
      5,
    );

    expect(applyPoseToVrm(
      fixture.vrm,
      result.bones,
      result.yOffset,
      result.translations,
    )).toBe(true);
    const repeatedHand = fixture.nodes.get("rightHand")!.getWorldPosition(new THREE.Vector3());
    expect(repeatedHand.distanceTo(firstHand)).toBeLessThan(1e-9);
  });

  it("never mutates the source graph while solving", () => {
    const fixture = createFixture();
    const before = snapshot(fixture);
    expect(solveStudioVrmFullBodyIk(fixture.source, request(fixture))).not.toBeNull();
    expect(fixture.scene.position.equals(before.scenePosition)).toBe(true);
    for (const entry of before.nodes) {
      expect(entry.node.position.equals(entry.position)).toBe(true);
      expect(Math.abs(entry.node.quaternion.dot(entry.quaternion))).toBeCloseTo(1, 12);
    }
  });

  it("fails closed on non-finite targets, malformed translations, and iteration abuse", () => {
    const fixture = createFixture();
    const valid = request(fixture);
    expect(solveStudioVrmFullBodyIk(fixture.source, {
      ...valid,
      primary: { ...valid.primary, targetWorld: new THREE.Vector3(Number.NaN, 0, 0) },
    })).toBeNull();
    expect(solveStudioVrmFullBodyIk(fixture.source, {
      ...valid,
      iterations: 100,
    })).toBeNull();
    expect(solveStudioVrmFullBodyIk(fixture.source, {
      ...valid,
      lockedTargets: [{
        effector: valid.primary.effector,
        targetWorld: valid.primary.targetWorld.clone(),
      }],
    })).toBeNull();
    expect(solveStudioVrmFullBodyIk(fixture.source, {
      ...valid,
      lockedTargets: [
        { effector: "leftHand", targetWorld: new THREE.Vector3() },
        { effector: "leftHand", targetWorld: new THREE.Vector3(1, 0, 0) },
      ],
    })).toBeNull();
    expect(solveStudioVrmFullBodyIk(fixture.source, {
      ...valid,
      lockedTargets: [{
        effector: "leftHand",
        targetWorld: new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0),
      }],
    })).toBeNull();
    expect(solveStudioVrmFullBodyIk(fixture.source, {
      ...valid,
      baseTranslations: {
        version: 1,
        root: [0, 0.1, 0],
        hips: [0, 0, 0],
        spine: [0, 0, 0],
      },
    })).toBeNull();
    expect(normalizeStudioVrmPoseTranslations({
      version: 1,
      root: [0, 0, 0],
      hips: [0, 0, 0],
      spine: [0, 0, 0],
      future: true,
    })).toBeNull();
  });
});
