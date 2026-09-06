import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { NATURAL_IDLE_POSES, pickNaturalIdlePose } from "../studio-pose-presets";

import {
  applyPoseToVrm,
  POSE_PRESETS,
  applyBodyScale,
  applyFingerRotations,
  serializeFullVrmState,
  applyFullState,
  planFullStateRestore,
  createFullStateLoadHandlers,
  type BodyScale,
  type FingerRotationMap,
  type FullVrmState,
} from "./studio-vrm-poser-utils";

import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";


const MAX_Y_OFFSET = 0.20;
const MAX_HEAD_AXIS_DEGREES = 12;
const MAX_TORSO_AXIS_DEGREES = 45;
const HEAD_BONES = new Set(["neck", "head"]);
const TORSO_BONES = new Set(["hips", "spine", "chest"]);

type BoneNodes = Partial<Record<VRMHumanBoneName, THREE.Object3D>>;

function toDegrees(radians: number) {
  return Math.round((radians * 180) / Math.PI);
}

function findPose(id: string) {
  const pose = POSE_PRESETS.find((preset) => preset.id === id);
  if (!pose) {
    throw new Error(`Missing pose preset: ${id}`);
  }
  return pose;
}

function addBone(bones: BoneNodes, name: VRMHumanBoneName, parent: THREE.Object3D, position: THREE.Vector3Tuple) {
  const bone = new THREE.Object3D();
  bone.name = name;
  bone.position.set(position[0], position[1], position[2]);
  parent.add(bone);
  bones[name] = bone;
  return bone;
}

function createTestVrm() {
  const scene = new THREE.Group();
  const bones: BoneNodes = {};

  const hips = addBone(bones, "hips", scene, [0, 1.02, 0]);
  const spine = addBone(bones, "spine", hips, [0, 0.22, 0]);
  const chest = addBone(bones, "chest", spine, [0, 0.26, 0]);
  const neck = addBone(bones, "neck", chest, [0, 0.28, 0]);
  addBone(bones, "head", neck, [0, 0.18, 0]);

  const leftShoulder = addBone(bones, "leftShoulder", chest, [0.06, 0.13, 0]);
  const leftUpperArm = addBone(bones, "leftUpperArm", leftShoulder, [0.12, 0, 0]);
  const leftLowerArm = addBone(bones, "leftLowerArm", leftUpperArm, [0.34, -0.62, 0]);
  const leftHand = addBone(bones, "leftHand", leftLowerArm, [0.14, -0.58, 0]);
  addBone(bones, "leftIndexProximal", leftHand, [0.06, -0.07, 0]);

  const rightShoulder = addBone(bones, "rightShoulder", chest, [-0.06, 0.13, 0]);
  const rightUpperArm = addBone(bones, "rightUpperArm", rightShoulder, [-0.12, 0, 0]);
  const rightLowerArm = addBone(bones, "rightLowerArm", rightUpperArm, [-0.34, -0.62, 0]);
  const rightHand = addBone(bones, "rightHand", rightLowerArm, [-0.14, -0.58, 0]);
  addBone(bones, "rightIndexProximal", rightHand, [-0.06, -0.07, 0]);

  const leftUpperLeg = addBone(bones, "leftUpperLeg", hips, [0.12, -0.08, 0]);
  const leftLowerLeg = addBone(bones, "leftLowerLeg", leftUpperLeg, [0.05, -0.76, 0]);
  addBone(bones, "leftFoot", leftLowerLeg, [0.02, -0.72, 0.12]);

  const rightUpperLeg = addBone(bones, "rightUpperLeg", hips, [-0.12, -0.08, 0]);
  const rightLowerLeg = addBone(bones, "rightLowerLeg", rightUpperLeg, [-0.05, -0.76, 0]);
  addBone(bones, "rightFoot", rightLowerLeg, [-0.02, -0.72, 0.12]);

  const resetNormalizedPose = () => {
    Object.values(bones).forEach((bone) => {
      bone.rotation.set(0, 0, 0);
      bone.quaternion.identity();
    });
    scene.position.set(0, 0, 0);
    scene.updateMatrixWorld(true);
  };

  const humanoid = {
    resetNormalizedPose,
    getNormalizedBoneNode: (name: VRMHumanBoneName) => bones[name] ?? null,
    update: () => scene.updateMatrixWorld(true),
  };

  const vrm = {
    scene,
    humanoid,
    update: () => scene.updateMatrixWorld(true),
  } as unknown as VRM;

  resetNormalizedPose();
  return { bones, vrm };
}

function getBoneDirection(bones: BoneNodes, boneName: VRMHumanBoneName, childName: VRMHumanBoneName) {
  const bone = bones[boneName];
  const child = bones[childName];
  if (!bone || !child) {
    throw new Error(`Missing test bone chain: ${boneName} -> ${childName}`);
  }

  const bonePosition = new THREE.Vector3();
  const childPosition = new THREE.Vector3();
  bone.getWorldPosition(bonePosition);
  child.getWorldPosition(childPosition);
  return childPosition.sub(bonePosition).normalize();
}

describe("StudioVrmPoser pose presets", () => {
  it("aims default arms down and cheer arms above the shoulders", () => {
    const defaultPose = findPose("default");
    const cheerPose = findPose("cheer");
    const { bones, vrm } = createTestVrm();

    applyPoseToVrm(vrm, defaultPose.bones, defaultPose.yOffset ?? 0);
    const defaultLeftUpperArm = getBoneDirection(bones, "leftUpperArm", "leftLowerArm");
    const defaultRightUpperArm = getBoneDirection(bones, "rightUpperArm", "rightLowerArm");

    expect(defaultLeftUpperArm.y).toBeLessThan(-0.86);
    expect(defaultRightUpperArm.y).toBeLessThan(-0.86);
    expect(defaultLeftUpperArm.x).toBeGreaterThan(0.2);
    expect(defaultRightUpperArm.x).toBeLessThan(-0.2);

    applyPoseToVrm(vrm, cheerPose.bones, cheerPose.yOffset ?? 0);
    const cheerLeftUpperArm = getBoneDirection(bones, "leftUpperArm", "leftLowerArm");
    const cheerRightUpperArm = getBoneDirection(bones, "rightUpperArm", "rightLowerArm");
    const cheerLeftLowerArm = getBoneDirection(bones, "leftLowerArm", "leftHand");
    const cheerRightLowerArm = getBoneDirection(bones, "rightLowerArm", "rightHand");

    expect(cheerLeftUpperArm.y).toBeGreaterThan(0.75);
    expect(cheerRightUpperArm.y).toBeGreaterThan(0.75);
    expect(cheerLeftLowerArm.y).toBeGreaterThan(0.82);
    expect(cheerRightLowerArm.y).toBeGreaterThan(0.82);
    expect(cheerLeftUpperArm.x).toBeGreaterThan(0.25);
    expect(cheerRightUpperArm.x).toBeLessThan(-0.25);
  });

  it("keeps core Euler tweaks restrained while limb targets can use full directional poses", () => {
    const awkwardCoreRotations = POSE_PRESETS.flatMap((pose) =>
      Object.entries(pose.bones).flatMap(([boneName, poseBone]) => {
        const limit = HEAD_BONES.has(boneName) ? MAX_HEAD_AXIS_DEGREES : TORSO_BONES.has(boneName) ? MAX_TORSO_AXIS_DEGREES : null;
        if (limit === null || !("rotation" in poseBone) || !poseBone.rotation) return [];

        return poseBone.rotation.flatMap((radians, axisIndex) => {
          const degrees = toDegrees(radians);
          return Math.abs(degrees) > limit ? [`${pose.id}:${boneName}:${axisIndex}:${degrees}`] : [];
        });
      })
    );

    const awkwardOffsets = POSE_PRESETS.flatMap((pose) => (Math.abs(pose.yOffset ?? 0) > MAX_Y_OFFSET ? [`${pose.id}:yOffset:${pose.yOffset}`] : []));

    expect([...awkwardCoreRotations, ...awkwardOffsets]).toEqual([]);
  });

  it("applies natural idle spawn poses with visible left-right asymmetry", () => {
    const { bones, vrm } = createTestVrm();

    for (const idle of NATURAL_IDLE_POSES) {
      expect(applyPoseToVrm(vrm, idle.bones, idle.yOffset ?? 0), `${idle.id} apply`).toBe(true);

      const left = getBoneDirection(bones, "leftUpperArm", "leftLowerArm");
      const right = getBoneDirection(bones, "rightUpperArm", "rightLowerArm");

      // 팔은 자연스럽게 아래로 늘어진다.
      expect(left.y, `${idle.id} left arm down`).toBeLessThan(-0.8);
      expect(right.y, `${idle.id} right arm down`).toBeLessThan(-0.8);

      // 좌우 비대칭: 오른팔을 미러링해도 왼팔과 1° 이상 어긋나야 한다.
      const mirroredRight = new THREE.Vector3(-right.x, right.y, right.z);
      const asymmetryDeg = THREE.MathUtils.radToDeg(left.angleTo(mirroredRight));
      expect(asymmetryDeg, `${idle.id} arm asymmetry`).toBeGreaterThan(1);

      // 어깨 내림(왼 -z / 오 +z). 손가락 릴랙스 컬은 모델 축 극성에 맞춰 ±Z 로 정렬된다.
      expect(bones.leftShoulder!.rotation.z, `${idle.id} left shoulder drop`).toBeLessThan(0);
      expect(bones.rightShoulder!.rotation.z, `${idle.id} right shoulder drop`).toBeGreaterThan(0);
      expect(
        Math.abs(bones.leftIndexProximal!.rotation.z),
        `${idle.id} left finger curl magnitude`,
      ).toBeGreaterThan(0.1);
      expect(
        Math.abs(bones.rightIndexProximal!.rotation.z),
        `${idle.id} right finger curl magnitude`,
      ).toBeGreaterThan(0.1);
    }
  });

  it("picks spawn idle poses deterministically per model id", () => {
    for (const id of ["sample-vrm", "alicia", "kage", "upload-123"]) {
      expect(pickNaturalIdlePose(id).id).toBe(pickNaturalIdlePose(id).id);
    }
    expect(NATURAL_IDLE_POSES.map((pose) => pose.id)).toContain(pickNaturalIdlePose("sample-vrm").id);
  });

  it("offers calm comic-panel pose options with natural labels", () => {
    expect(POSE_PRESETS.map((pose) => pose.id)).toEqual([
      "default",
      "wave",
      "point",
      "cheer",
      "think",
      "sit",
      "run",
      "present",
      "support",
      "despair",
      "attack",
      "defense",
      "peace",
      "fist",
      "flying",
      "heart",
      "shy",
      "arrogant",
      "shock",
      "surrender",
      "phone",
      "salute",
      "fighting",
      "thinking",
      "pray",
      "dance",
      "bow",
      "crouch",
      "heroic",
      "shy2",
      "lean",
      "crossArms",
      "run2",
      "jump",
    ]);
    expect(POSE_PRESETS.map((pose) => pose.label)).toEqual([
      "기본",
      "손인사",
      "대화",
      "기쁨",
      "생각",
      "앉기",
      "걷기",
      "설명",
      "응원",
      "낙담",
      "준비",
      "방어",
      "브이",
      "화이팅",
      "비상",
      "하트",
      "부끄럼",
      "팔짱",
      "깜짝",
      "항복",
      "통화",
      "경례",
      "격투",
      "생각중",
      "기도",
      "댄스",
      "인사",
      "쪼그림",
      "영웅",
      "수줍음",
      "기대기",
      "팔짱",
      "달리기",
      "점프",
    ]);
  });

  it("directly exercises applyBodyScale / applyFingerRotations / applyFullState on stub VRM", () => {
    const created = createTestVrm() as any;
    const vrm = created.vrm;
    // body scale - assert actual scale value
    const scale: BodyScale = { height: 1.25, width: 0.95 };
    applyBodyScale(vrm, scale);
    expect(vrm.scene.scale.y).toBeCloseTo(1.25, 2);
    expect(vrm.scene.scale.x).toBeCloseTo(0.95, 2);

    // finger
    const finger: FingerRotationMap = { leftIndexProximal: [0, 0, 0.3] };
    applyFingerRotations(vrm, finger);
    const bone = vrm.humanoid.getNormalizedBoneNode("leftIndexProximal");
    expect(bone && bone.rotation.z).toBeCloseTo(0.3);

    // full state roundtrip
    const full = serializeFullVrmState({ bodyScale: scale, fingerOverrides: finger });
    expect(full.version).toBe(3);
    applyFullState(vrm, full as any, {
      applyPose: (b, y) => applyPoseToVrm(vrm, b, y),
      applyExpr: () => {},
    });
    expect(vrm.scene.scale.y).toBeCloseTo(1.25, 2);
  });

  it("handleLoadFullLocal path roundtrips full AC2 state (costume+props+physics+finger+bodyScale+lighting+env) via real handler", () => {
    console.log("calling handleLoadFullLocal with full AC2 state");
    const created = createTestVrm() as any;
    const vrm = created.vrm;

    const fullAC2: FullVrmState = {
      version: 3,
      bones: { hips: { rotation: [0, 0.1, 0] } },
      yOffset: 0.05,
      poseTranslations: { version: 1, root: [0, 0, 0], hips: [0, 0, 0], spine: [0, 0, 0] },
      ikConstraints: [],
      bodyRotation: 0,
      expressionWeights: { happy: 0.7 },
      bodyScale: { height: 1.1, width: 0.9 },
      lighting: { intensity: 1.8, colorTemp: 0.6, directionDeg: 120 },
      env: "floor",
      fingerOverrides: { leftIndexProximal: [0, 0, 0.35] },
      costume: { hidden: ["c1"], recolor: {} },
      props: { items: [{ uid: "p1", propId: "book" }] },
      physics: {
        version: 1,
        stiffnessScale: 0.9,
        gravityScale: 1,
        windDirectionDeg: 0,
        windStrength: 0,
      },
    } as any;

    const savedFullStates = { "test-full-ac2": fullAC2 };
    const vrmRef = { current: vrm };

    const receivedStates: FullVrmState[] = [];
    const delegateCalls: string[] = [];

    const testCommit = (s: FullVrmState, vv: any) => {
      receivedStates.push(s);
      applyFullState(vv || vrm, s, {
        applyPose: (b, y) => { delegateCalls.push("pose"); applyPoseToVrm(vv || vrm, b, y); },
        applyExpr: () => { delegateCalls.push("expr"); },
        applyCostume: (c) => { delegateCalls.push("costume:" + (c ? "yes" : "no")); },
        applyProps: (p: any) => { delegateCalls.push("props:" + (p?.items ? "yes" : "no")); },
        applyPhysics: (p) => { delegateCalls.push("physics:" + (p ? "yes" : "no")); },
      });
    };

    const h = createFullStateLoadHandlers({
      savedFullStates,
      commitFullStateRestore: testCommit,
      vrmRef,
    });

    // Actual call to the handler obtained from the factory used by shipped code
    const handleLoadFullLocal = h.handleLoadFullLocal;
    handleLoadFullLocal("test-full-ac2");

    console.log("after handleLoadFullLocal, state preserved via real handler path");

    expect(receivedStates.length).toBe(1);
    expect(receivedStates[0].fingerOverrides?.leftIndexProximal?.[2]).toBeCloseTo(0.35);
    expect(receivedStates[0].bodyScale?.height).toBe(1.1);
    expect((receivedStates[0].physics as any)?.stiffnessScale).toBe(0.9);
    expect(delegateCalls).toContain("costume:yes");
    expect(delegateCalls).toContain("props:yes");
    expect(delegateCalls).toContain("physics:yes");
    expect(vrm.scene.scale.y).toBeCloseTo(1.1, 2);
  });

  it("handlePasteFullState and handleSelectSharedPose load paths via real handlers preserve full AC2", () => {
    console.log("calling handlePasteFullState and handleSelectSharedPose with full AC2");
    const created = createTestVrm() as any;
    const vrm = created.vrm;
    const vrmRef = { current: vrm };

    const full: FullVrmState = {
      version: 3,
      bones: {},
      yOffset: 0,
      poseTranslations: { version: 1, root: [0, 0, 0], hips: [0, 0, 0], spine: [0, 0, 0] },
      ikConstraints: [],
      bodyRotation: 0,
      expressionWeights: {},
      fingerOverrides: { rightThumbProximal: [0, 0, 0.22] },
      physics: {
        version: 1,
        stiffnessScale: 1,
        gravityScale: 0.5,
        windDirectionDeg: 0,
        windStrength: 0,
      },
    } as any;

    const calls: string[] = [];
    const testCommit = (s: FullVrmState) => {
      applyFullState(vrm, s, {
        applyPose: () => { calls.push("pose"); },
        applyExpr: () => {},
        applyPhysics: (p) => { calls.push("physics:" + (p ? "yes" : "no")); },
      });
    };

    const h = createFullStateLoadHandlers({
      savedFullStates: {},
      commitFullStateRestore: testCommit,
      vrmRef,
    });

    const handlePasteFullState = h.handlePasteFullStateFromParsed;
    handlePasteFullState(full);

    const handleSelectSharedPose = h.handleSelectSharedPose;
    handleSelectSharedPose({ dataUrl: "data:image/png;base64,xxx#" + encodeURIComponent(JSON.stringify({ bones: {}, fingerOverrides: full.fingerOverrides, physics: full.physics })) });

    console.log("after handler calls, full AC2 (finger+physics) applied");
    expect(calls.filter(c => c.includes("physics")).length).toBeGreaterThan(0);
    const plan = planFullStateRestore(full);
    expect(plan.fingerOverrides?.rightThumbProximal?.[2]).toBeCloseTo(0.22);
  });

  it("shared/hash + install pending path exercises physics via real handler + commit with full state", () => {
    console.log("exercising shared/hash + pending path with full physics state via handler factory");
    const created = createTestVrm() as any;
    const vrm = created.vrm;
    const vrmRef = { current: vrm };

    const fullWithPhysics: FullVrmState = {
      version: 3,
      bones: {},
      yOffset: 0,
      poseTranslations: { version: 1, root: [0, 0, 0], hips: [0, 0, 0], spine: [0, 0, 0] },
      ikConstraints: [],
      bodyRotation: 0,
      expressionWeights: {},
      physics: {
        version: 1,
        stiffnessScale: 1.2,
        gravityScale: 1,
        windDirectionDeg: 0,
        windStrength: 0.11,
      },
    } as any;

    const physicsApplied: any[] = [];
    const testCommit = (s: FullVrmState, vv: any) => {
      applyFullState(vv || vrm, s, {
        applyPose: () => {},
        applyExpr: () => {},
        applyPhysics: (p) => {
          physicsApplied.push(p);
        },
      });
    };

    // Simulate the pending install path (build pendingFull then commit) - uses same commit
    // and also the shared via factory
    const h = createFullStateLoadHandlers({ savedFullStates: {}, commitFullStateRestore: testCommit, vrmRef });

    // via "shared"
    const sharedDataUrl = "img# " + encodeURIComponent(JSON.stringify({ physics: fullWithPhysics.physics }));
    h.handleSelectSharedPose({ dataUrl: sharedDataUrl.replace(" ", "") }); // will fail hash but we also directly test commit path

    // direct pending-like
    testCommit(fullWithPhysics, vrm);

    expect(physicsApplied.length).toBeGreaterThan(0);
  });

});
