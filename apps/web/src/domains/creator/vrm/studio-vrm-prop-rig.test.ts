import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { clampStudioVrmJointRotation } from "./studio-vrm-joint-limits";
import {
  DEFAULT_VRM_PROP_RIG_METRICS,
  PROP_RIG_FIT_MAX,
  createAutoGripFingerOverrides,
  createDefaultSecondaryRig,
  getPropFitStatus,
  inspectAutoGripReadiness,
  measureVrmPropRigMetrics,
  resolvePropAttachment,
  resolveSecondaryHandConstraint,
  usesVrmPropFaceSocket,
  resolveSecondaryPropTarget,
  sanitizeVrmPropRigMetrics,
  scaleVrmPropRigMetrics,
  type VrmPropMetricBone,
} from "./studio-vrm-prop-rig";
import {
  VRM_PROPS,
  createPropInstance,
  propDefById,
  type PropInstance,
  type Vec3,
} from "./studio-vrm-props";

import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

function createMeasuredVrm(options: { omitFingers?: boolean; noHumanoid?: boolean } = {}): VRM {
  const scene = new THREE.Group();
  const bones: Partial<Record<VrmPropMetricBone, THREE.Object3D>> = {};
  const add = (name: VrmPropMetricBone, position: Vec3) => {
    const node = new THREE.Object3D();
    node.name = name;
    node.position.set(...position);
    scene.add(node);
    bones[name] = node;
  };

  add("leftFoot", [0.12, 0, 0]);
  add("rightFoot", [-0.12, 0, 0]);
  add("hips", [0, 0.92, 0]);
  add("leftUpperLeg", [0.12, 0.92, 0]);
  add("rightUpperLeg", [-0.12, 0.92, 0]);
  add("neck", [0, 1.46, 0]);
  add("head", [0, 1.62, 0]);
  add("leftShoulder", [0.21, 1.43, 0]);
  add("rightShoulder", [-0.21, 1.43, 0]);
  add("leftLowerArm", [0.43, 1.2, 0]);
  add("rightLowerArm", [-0.43, 1.2, 0]);
  add("leftHand", [0.56, 1.2, 0]);
  add("rightHand", [-0.56, 1.2, 0]);
  if (!options.omitFingers) {
    // 양손에서 index/little의 X 순서를 반전해 실측 basis도 좌우 반사되게 한다.
    add("leftThumbMetacarpal", [0.535, 1.2, 0.025]);
    add("leftThumbProximal", [0.515, 1.2, 0.045]);
    add("leftThumbDistal", [0.505, 1.2, 0.065]);
    add("leftMiddleProximal", [0.56, 1.2, 0.08]);
    add("leftMiddleIntermediate", [0.56, 1.2, 0.12]);
    add("leftMiddleDistal", [0.56, 1.2, 0.15]);
    add("leftIndexProximal", [0.535, 1.2, 0.08]);
    add("leftIndexIntermediate", [0.535, 1.2, 0.115]);
    add("leftIndexDistal", [0.535, 1.2, 0.14]);
    add("leftRingProximal", [0.575, 1.2, 0.078]);
    add("leftRingIntermediate", [0.575, 1.2, 0.112]);
    add("leftRingDistal", [0.575, 1.2, 0.137]);
    add("leftLittleProximal", [0.585, 1.2, 0.08]);
    add("leftLittleIntermediate", [0.585, 1.2, 0.108]);
    add("leftLittleDistal", [0.585, 1.2, 0.13]);
    add("rightThumbMetacarpal", [-0.535, 1.2, 0.025]);
    add("rightThumbProximal", [-0.515, 1.2, 0.045]);
    add("rightThumbDistal", [-0.505, 1.2, 0.065]);
    add("rightMiddleProximal", [-0.56, 1.2, 0.08]);
    add("rightMiddleIntermediate", [-0.56, 1.2, 0.12]);
    add("rightMiddleDistal", [-0.56, 1.2, 0.15]);
    add("rightIndexProximal", [-0.535, 1.2, 0.08]);
    add("rightIndexIntermediate", [-0.535, 1.2, 0.115]);
    add("rightIndexDistal", [-0.535, 1.2, 0.14]);
    add("rightRingProximal", [-0.575, 1.2, 0.078]);
    add("rightRingIntermediate", [-0.575, 1.2, 0.112]);
    add("rightRingDistal", [-0.575, 1.2, 0.137]);
    add("rightLittleProximal", [-0.585, 1.2, 0.08]);
    add("rightLittleIntermediate", [-0.585, 1.2, 0.108]);
    add("rightLittleDistal", [-0.585, 1.2, 0.13]);
  }
  scene.updateMatrixWorld(true);

  return {
    scene,
    humanoid: options.noHumanoid
      ? undefined
      : {
          getNormalizedBoneNode: (name: VRMHumanBoneName) => bones[name as VrmPropMetricBone] ?? null,
        },
  } as unknown as VRM;
}

function expectVecClose(actual: Vec3, expected: Vec3, precision = 6) {
  expect(actual[0]).toBeCloseTo(expected[0], precision);
  expect(actual[1]).toBeCloseTo(expected[1], precision);
  expect(actual[2]).toBeCloseTo(expected[2], precision);
}

function createCompleteGripMetrics() {
  return measureVrmPropRigMetrics(createMeasuredVrm());
}

describe("VRM 소품 리그 실측", () => {
  it("손가락·머리·어깨·골반·키를 실측하고 손목이 아닌 손바닥 소켓을 만든다", () => {
    const metrics = measureVrmPropRigMetrics(createMeasuredVrm());

    expect(metrics.avatarHeight).toBeGreaterThan(1.6);
    expect(metrics.shoulder).toBeCloseTo(0.42, 5);
    expect(metrics.hip).toBeCloseTo(0.24, 5);
    expect(metrics.hand).toBeCloseTo(0.092, 3);
    expect(metrics.sources.hand).toBe("measured");
    expect(metrics.handSockets.leftHand.source).toBe("measured");
    expect(metrics.handSockets.rightHand.source).toBe("measured");
    expect(Math.hypot(...metrics.handSockets.leftHand.position)).toBeGreaterThan(0.03);
    expect(Math.hypot(...metrics.handSockets.rightHand.position)).toBeGreaterThan(0.03);
    // 얼굴 소켓: head 본의 시작점에서 실제 눈 높이와 얼굴 표면까지 유도한다.
    expect(metrics.faceSocket.source).not.toBe("fallback");
    expect(metrics.faceSocket.position[1] / metrics.head).toBeCloseTo(0.5, 6);
    expect(metrics.faceSocket.position[2] / metrics.head).toBeCloseTo(0.58, 6);
  });

  it("좌우 손의 palm basis가 반사되고 quaternion은 정규화된다", () => {
    const { handSockets } = measureVrmPropRigMetrics(createMeasuredVrm());
    const left = new THREE.Quaternion(...handSockets.leftHand.rotationQuaternion);
    const right = new THREE.Quaternion(...handSockets.rightHand.rotationQuaternion);
    const leftRight = new THREE.Vector3(1, 0, 0).applyQuaternion(left);
    const rightRight = new THREE.Vector3(1, 0, 0).applyQuaternion(right);

    expect(left.length()).toBeCloseTo(1, 6);
    expect(right.length()).toBeCloseTo(1, 6);
    expect(leftRight.x * rightRight.x).toBeLessThan(0);
  });

  it("손가락이 없으면 lower-arm 방향으로 palm socket을 유도한다", () => {
    const metrics = measureVrmPropRigMetrics(createMeasuredVrm({ omitFingers: true }));
    expect(metrics.handSockets.leftHand.source).toBe("derived");
    expect(metrics.handSockets.rightHand.source).toBe("derived");
    expect(Math.hypot(...metrics.handSockets.leftHand.position)).toBeGreaterThan(0.02);
  });

  it("humanoid가 없거나 외부 값이 NaN/극단값이면 안전한 기본값과 범위로 폴백한다", () => {
    const missing = measureVrmPropRigMetrics(createMeasuredVrm({ noHumanoid: true }));
    expect(missing.avatarHeight).toBe(DEFAULT_VRM_PROP_RIG_METRICS.avatarHeight);
    expect(missing.missingBones).toHaveLength(DEFAULT_VRM_PROP_RIG_METRICS.missingBones.length);

    const sanitized = sanitizeVrmPropRigMetrics({
      avatarHeight: Number.NaN,
      hand: 99,
      head: -4,
      handSockets: {
        leftHand: { position: [Number.NaN, 0, 0], rotationQuaternion: [0, 0, 0, 0] },
      },
    });
    expect(sanitized.avatarHeight).toBe(DEFAULT_VRM_PROP_RIG_METRICS.avatarHeight);
    expect(sanitized.hand).toBeLessThan(1);
    expect(sanitized.head).toBeGreaterThan(0);
    expect(sanitized.handSockets.leftHand.source).toBe("fallback");
  });

  it("체형의 높이·너비 변경을 자동 핏 실측값에 합성한다", () => {
    const scaled = scaleVrmPropRigMetrics(DEFAULT_VRM_PROP_RIG_METRICS, {
      height: 1.4,
      width: 0.8,
    });

    expect(scaled.avatarHeight).toBeCloseTo(DEFAULT_VRM_PROP_RIG_METRICS.avatarHeight * 1.4, 6);
    expect(scaled.shoulder).toBeCloseTo(DEFAULT_VRM_PROP_RIG_METRICS.shoulder * 0.8, 6);
    expect(scaled.eyeDistance).toBeCloseTo(DEFAULT_VRM_PROP_RIG_METRICS.eyeDistance * 0.8, 6);
    expect(scaled.hand).toBeCloseTo(
      DEFAULT_VRM_PROP_RIG_METRICS.hand * Math.sqrt(1.4 * 0.8),
      6
    );
    // hand/face socket은 본 로컬 좌표이므로 루트 스케일과 중복 적용하지 않는다.
    expect(scaled.handSockets).toEqual(DEFAULT_VRM_PROP_RIG_METRICS.handSockets);
    expect(scaled.faceSocket).toEqual(DEFAULT_VRM_PROP_RIG_METRICS.faceSocket);
  });
});

describe("얼굴 착용 소켓(선글라스)", () => {
  it("head 소품은 faceSocket 위치에 맞춘다", () => {
    const def = propDefById("sunglasses")!;
    const instance = createPropInstance("sunglasses", "sg-1")!;
    instance.bone = "head";
    instance.rig = {
      ...instance.rig!,
      deltaPosition: [0, 0, 0],
      deltaRotationDeg: [0, 0, 0],
      deltaScale: 1,
    };
    const metrics = measureVrmPropRigMetrics(createMeasuredVrm());
    const result = resolvePropAttachment(def, instance, metrics);
    expect(result.usesSmartRig).toBe(true);
    expect(result.socketSource).not.toBe("fallback");
    // 소켓 원점 ≈ faceSocket (delta 0)
    expectVecClose(result.socketPosition, metrics.faceSocket.position, 4);
    // 전방(+Z)이 충분해 얼굴 앞에 앉는다
    expect(result.position[2]).toBeGreaterThan(0.03);
  });
});

describe("머리 소품의 face/bone socket 의미 계약", () => {
  const FACE_WEAR_IDS = [
    "glasses",
    "sunglasses",
    "faceMask",
    "eyepatch",
    "goggles",
    "blender_cyber_visor",
    "blender_cyber_glasses",
    "blender_fox_mask",
  ] as const;
  const BONE_WEAR_IDS = [
    "cap",
    "beret",
    "crown",
    "ribbon",
    "surgicalCap",
    "headphones",
    "headband",
    "flowerCrown",
    "choker",
    "catEars",
    "elfEars",
    "horns",
    "halo",
    "beanie",
    "earmuffs",
    "hairpin",
    "blender_tactical_helmet",
    "blender_wizard_hat",
  ] as const;

  it("classifies every current head-category definition exhaustively", () => {
    const headIds = VRM_PROPS
      .filter((definition) => definition.category === "head")
      .map((definition) => definition.id)
      .sort();
    expect(headIds).toEqual([...FACE_WEAR_IDS, ...BONE_WEAR_IDS].sort());
    for (const id of FACE_WEAR_IDS) {
      const definition = propDefById(id)!;
      expect(definition.wearSocket, id).toBe("face");
      expect(usesVrmPropFaceSocket(definition, "head"), id).toBe(true);
      expect(usesVrmPropFaceSocket(definition, "neck"), `${id}/neck`).toBe(false);
    }
    for (const id of BONE_WEAR_IDS) {
      const definition = propDefById(id)!;
      expect(definition.wearSocket, id).toBe("bone");
      expect(usesVrmPropFaceSocket(definition, definition.defaultBone), id).toBe(false);
    }
  });

  it("keeps crown wear on its catalog head point and face wear on the derived face socket", () => {
    const metrics = measureVrmPropRigMetrics(createMeasuredVrm());
    const cap = resolvePropAttachment(propDefById("cap")!, createPropInstance("cap", "cap-socket")!, metrics);
    const glasses = resolvePropAttachment(
      propDefById("glasses")!,
      createPropInstance("glasses", "glasses-socket")!,
      metrics,
    );
    expect(cap.socketPosition).toEqual(propDefById("cap")!.defaultPosition);
    expect(glasses.socketPosition).toEqual(metrics.faceSocket.position);
    expect(metrics.faceSocket.position[1] / metrics.head).toBeCloseTo(0.5, 6);
    expect(metrics.faceSocket.position[2] / metrics.head).toBeCloseTo(0.58, 6);
  });
});

describe("스마트 anchor wrapper", () => {
  it("검의 geometry anchor를 실측 palm socket에 정확히 일치시킨다", () => {
    const def = propDefById("sword")!;
    const instance = createPropInstance("sword", "sword-1")!;
    instance.rig = {
      ...instance.rig!,
      deltaPosition: [0.01, -0.005, 0.002],
      deltaRotationDeg: [8, 12, -4],
      deltaScale: 1.1,
    };
    const result = resolvePropAttachment(def, instance, measureVrmPropRigMetrics(createMeasuredVrm()));
    const rotation = new THREE.Euler(
      THREE.MathUtils.degToRad(result.rotationDeg[0]),
      THREE.MathUtils.degToRad(result.rotationDeg[1]),
      THREE.MathUtils.degToRad(result.rotationDeg[2]),
      "XYZ"
    );
    const transformedAnchor = new THREE.Vector3(...result.anchor.position)
      .multiplyScalar(result.scale)
      .applyEuler(rotation)
      .add(new THREE.Vector3(...result.position));

    expect(result.usesSmartRig).toBe(true);
    expect(result.socketSource).toBe("measured");
    expect(Math.hypot(...result.socketPosition)).toBeGreaterThan(0.02);
    expectVecClose(
      [transformedAnchor.x, transformedAnchor.y, transformedAnchor.z],
      result.socketPosition,
      5
    );
  });

  it("rig가 있으면 legacy instance transform은 무시하고 def 기본값+delta만 사용한다", () => {
    const def = propDefById("mug")!;
    const instance = createPropInstance("mug", "mug-1")!;
    instance.position = [0.9, 0.9, 0.9];
    instance.rotationDeg = [170, 160, 150];
    instance.scale = 3.8;
    instance.rig = { ...instance.rig!, deltaPosition: [0.01, 0.02, 0.03], deltaRotationDeg: [1, 2, 3] };
    const result = resolvePropAttachment(def, instance, DEFAULT_VRM_PROP_RIG_METRICS);

    expect(result.socketPosition[0]).not.toBeCloseTo(0.9, 2);
    expect(result.scale).toBeLessThan(3.8);
  });

  it("rig가 없는 V1 인스턴스는 기존 절대 transform을 그대로 통과시킨다", () => {
    const def = propDefById("mug")!;
    const instance: PropInstance = { ...createPropInstance("mug", "legacy")!, rig: undefined };
    const result = resolvePropAttachment(def, instance, DEFAULT_VRM_PROP_RIG_METRICS);
    expect(result.usesSmartRig).toBe(false);
    expect(result.position).toEqual(instance.position);
    expect(result.rotationDeg).toEqual(instance.rotationDeg);
    expect(result.scale).toBe(instance.scale);
  });

  it("검은 legacy 회전은 보존하면서 palm socket 전용 기본 방향을 사용한다", () => {
    const def = propDefById("sword")!;
    const smart = createPropInstance("sword", "smart-sword")!;
    const legacy: PropInstance = { ...smart, uid: "legacy-sword", rig: undefined };

    const smartResult = resolvePropAttachment(def, smart, DEFAULT_VRM_PROP_RIG_METRICS);
    const legacyResult = resolvePropAttachment(def, legacy, DEFAULT_VRM_PROP_RIG_METRICS);

    expect(def.smartRotationDeg).toEqual([0, 0, 0]);
    expect(smartResult.rotationDeg[2]).toBeCloseTo(0, 6);
    expect(legacyResult.rotationDeg).toEqual([0, 0, -90]);
  });

  it("Wave 3 검·총·요술봉의 실제 -Z 끝점은 손가락 소켓 전방을 향한다", () => {
    const metrics = measureVrmPropRigMetrics(createMeasuredVrm());
    for (const id of [
      "blender_cyber_katana",
      "blender_medieval_greatsword",
      "blender_cyber_sniper_rifle",
      "blender_magic_wand_staff",
      "blender_scifi_laser_gun",
    ]) {
      const def = propDefById(id)!;
      const instance = createPropInstance(id, `direction-${id}`)!;
      const result = resolvePropAttachment(def, instance, metrics);
      const wrapperRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(result.rotationDeg[0]),
        THREE.MathUtils.degToRad(result.rotationDeg[1]),
        THREE.MathUtils.degToRad(result.rotationDeg[2]),
        "XYZ",
      ));
      const semanticForward = new THREE.Vector3(0, 0, -1).applyQuaternion(wrapperRotation);
      const socket = metrics.handSockets[instance.bone as "leftHand" | "rightHand"];
      const socketForward = new THREE.Vector3(0, 0, 1).applyQuaternion(
        new THREE.Quaternion(...socket.rotationQuaternion),
      );
      expect(semanticForward.dot(socketForward), id).toBeGreaterThan(0.999);
    }
  });

  it("오른손 프리셋을 왼손에 붙이면 delta와 회전이 좌우 미러된다", () => {
    const def = propDefById("sword")!;
    const instance = createPropInstance("sword", "left-sword")!;
    instance.bone = "leftHand";
    instance.rig = { ...instance.rig!, deltaPosition: [0.02, 0.01, 0], deltaRotationDeg: [5, 10, 20] };
    const result = resolvePropAttachment(def, instance, measureVrmPropRigMetrics(createMeasuredVrm()));
    expect(result.mirrored).toBe(true);
    // mirrored delta는 해당 손의 실측 socket X에서 음의 방향으로 더해진다.
    const socketX = measureVrmPropRigMetrics(createMeasuredVrm()).handSockets.leftHand.position[0];
    expect(result.socketPosition[0]).toBeCloseTo(socketX - 0.02, 6);
  });

  it("자동 fit을 프로필 범위와 전역 안전 범위로 클램프하고 UI 상태를 공유한다", () => {
    const base = propDefById("mug")!;
    const def = { ...base, fit: { ...base.fit, designReference: 0.001, minScale: 0.5, maxScale: 1.2 } };
    const instance = createPropInstance("mug", "fit")!;
    const status = getPropFitStatus(def, instance, DEFAULT_VRM_PROP_RIG_METRICS);
    const resolved = resolvePropAttachment(def, instance, DEFAULT_VRM_PROP_RIG_METRICS);
    expect(status.kind).toBe("clamped");
    expect(status.fitScale).toBe(1.2);
    expect(resolved.fit).toEqual(status);
    expect(resolved.scale).toBeLessThanOrEqual(PROP_RIG_FIT_MAX);
  });
});

describe("자동 손 그립과 양손 보조 target", () => {
  it("grip kind를 좌우 부호가 맞는 FingerRotationMap 호환 값으로 만든다", () => {
    const right = createPropInstance("sword", "right")!;
    const left = createPropInstance("book", "left")!;
    const overrides = createAutoGripFingerOverrides(
      [right, left],
      propDefById,
      createCompleteGripMetrics()
    );

    expect(overrides.rightIndexIntermediate[2]).toBeGreaterThan(0);
    expect(overrides.leftIndexIntermediate[2]).toBeLessThan(0);
    expect(overrides.rightThumbProximal[1]).toBeGreaterThan(0);
    expect(overrides.leftThumbProximal[1]).toBeLessThan(0);
  });

  it("secondary가 켜진 양손 소품은 같은 grip을 보조 손에도 적용한다", () => {
    const def = propDefById("sword")!;
    const item = createPropInstance("sword", "two-hand")!;
    item.rig = { ...item.rig!, secondary: createDefaultSecondaryRig(def, item.bone)! };
    const overrides = createAutoGripFingerOverrides(
      [item],
      propDefById,
      createCompleteGripMetrics()
    );
    expect(overrides.rightMiddleProximal).toBeDefined();
    expect(overrides.leftMiddleProximal).toBeDefined();

    const target = resolveSecondaryPropTarget(def, item);
    expect(target).toMatchObject({ enabled: true, bone: "leftHand", anchorId: "secondary", influence: 0.82 });
  });

  it("secondary influence를 보조 손가락 그립 강도에도 동일하게 적용한다", () => {
    const def = propDefById("sword")!;
    const item = createPropInstance("sword", "weighted-two-hand")!;
    item.rig = {
      ...item.rig!,
      secondary: { ...createDefaultSecondaryRig(def, item.bone)!, influence: 0.5 },
    };
    const metrics = createCompleteGripMetrics();
    const half = createAutoGripFingerOverrides([item], propDefById, metrics);
    item.rig = {
      ...item.rig,
      secondary: { ...item.rig.secondary!, influence: 1 },
    };
    const full = createAutoGripFingerOverrides([item], propDefById, metrics);

    expect(Math.abs(half.leftMiddleIntermediate[2])).toBeCloseTo(
      Math.abs(full.leftMiddleIntermediate[2]) * 0.5,
      6
    );

    item.rig = {
      ...item.rig,
      secondary: { ...item.rig.secondary!, influence: 0 },
    };
    const zero = createAutoGripFingerOverrides([item], propDefById, metrics);
    expect(zero.leftMiddleIntermediate).toBeUndefined();
    expect(zero.rightMiddleIntermediate).toBeDefined();
  });

  it("실제 소품 반경과 자동 배율이 커지면 손가락을 덜 감는다", () => {
    const normal = createPropInstance("mug", "normal-radius")!;
    const large = createPropInstance("mug", "large-radius")!;
    large.rig = { ...large.rig!, autoScale: false, deltaScale: 2 };

    const metrics = createCompleteGripMetrics();
    const normalGrip = createAutoGripFingerOverrides([normal], propDefById, metrics);
    const largeGrip = createAutoGripFingerOverrides([large], propDefById, metrics);

    expect(Math.abs(largeGrip.rightMiddleIntermediate[2])).toBeLessThan(
      Math.abs(normalGrip.rightMiddleIntermediate[2])
    );
  });

  it("저장되는 그립 맞춤값으로 관통과 뜸을 연속적으로 보정한다", () => {
    const relaxed = createPropInstance("sword", "relaxed-grip")!;
    const firm = createPropInstance("sword", "firm-grip")!;
    relaxed.rig = { ...relaxed.rig!, gripFit: 0.7 };
    firm.rig = { ...firm.rig!, gripFit: 1.3 };
    const metrics = createCompleteGripMetrics();

    const relaxedGrip = createAutoGripFingerOverrides([relaxed], propDefById, metrics);
    const firmGrip = createAutoGripFingerOverrides([firm], propDefById, metrics);

    expect(Math.abs(firmGrip.rightMiddleIntermediate[2])).toBeGreaterThan(
      Math.abs(relaxedGrip.rightMiddleIntermediate[2])
    );
    expect(Math.abs(firmGrip.rightThumbProximal[1])).toBeGreaterThan(
      Math.abs(relaxedGrip.rightThumbProximal[1])
    );
  });

  it("모델별 손가락 마디 길이를 실측해 짧은 손가락을 더 감고 긴 손가락은 이완한다", () => {
    const item = createPropInstance("sword", "anatomy-aware")!;
    const regularMetrics = createCompleteGripMetrics();
    const longLittleMetrics = {
      ...regularMetrics,
      boneWorldPositions: {
        ...regularMetrics.boneWorldPositions,
        rightLittleIntermediate: [-0.585, 1.2, 0.14] as Vec3,
        rightLittleDistal: [-0.585, 1.2, 0.205] as Vec3,
      },
    };

    const regular = createAutoGripFingerOverrides([item], propDefById, regularMetrics);
    const longLittle = createAutoGripFingerOverrides([item], propDefById, longLittleMetrics);

    expect(Math.abs(regular.rightLittleIntermediate[2])).toBeGreaterThan(
      Math.abs(longLittle.rightLittleIntermediate[2])
    );
  });

  it("UI가 실제 엔진과 같은 준비·불완전 리그·접촉 충돌 상태를 진단한다", () => {
    const first = createPropInstance("mug", "readiness-a")!;
    const second = createPropInstance("sword", "readiness-b")!;
    const metrics = createCompleteGripMetrics();

    expect(inspectAutoGripReadiness(first, [first], propDefById, metrics)).toEqual({
      kind: "ready",
      hand: "rightHand",
    });
    expect(
      inspectAutoGripReadiness(first, [first], propDefById, DEFAULT_VRM_PROP_RIG_METRICS)
    ).toMatchObject({ kind: "unavailable", reason: "incomplete-rig" });
    expect(inspectAutoGripReadiness(first, [first, second], propDefById, metrics)).toMatchObject({
      kind: "unavailable",
      reason: "contact-conflict",
    });

    second.rig = { ...second.rig!, autoFingerPose: false };
    expect(inspectAutoGripReadiness(first, [first, second], propDefById, metrics)).toEqual({
      kind: "ready",
      hand: "rightHand",
    });
  });

  it("PIP 중심으로 굽힘을 분배하고 DIP를 작게 결합해 갈고리 모양을 막는다", () => {
    const item = createPropInstance("sword", "distributed-curl")!;
    const grip = createAutoGripFingerOverrides(
      [item],
      propDefById,
      createCompleteGripMetrics()
    );
    const proximal = Math.abs(grip.rightMiddleProximal[2]);
    const intermediate = Math.abs(grip.rightMiddleIntermediate[2]);
    const distal = Math.abs(grip.rightMiddleDistal[2]);

    expect(intermediate).toBeGreaterThan(proximal);
    expect(proximal).toBeGreaterThan(distal);
    expect(distal / intermediate).toBeLessThanOrEqual(0.55);
  });

  it("pinch는 검지·중지를 접촉시키고 약지·소지는 이완한다", () => {
    const item = createPropInstance("pencil", "tripod-pinch")!;
    const grip = createAutoGripFingerOverrides(
      [item],
      propDefById,
      createCompleteGripMetrics()
    );

    expect(Math.abs(grip.rightIndexIntermediate[2])).toBeGreaterThan(
      Math.abs(grip.rightRingIntermediate[2])
    );
    expect(Math.abs(grip.rightMiddleIntermediate[2])).toBeGreaterThan(
      Math.abs(grip.rightLittleIntermediate[2])
    );
    expect(Math.abs(grip.rightIndexDistal[2])).toBeLessThan(
      Math.abs(grip.rightIndexIntermediate[2])
    );
  });

  it("프로필 반경이 아니라 선택된 접촉 anchor 반경으로 손가락 닫힘을 계산한다", () => {
    const base = propDefById("mug")!;
    const item = createPropInstance("mug", "contact-radius")!;
    const definitionWithRadius = (gripRadius: number) => ({
      ...base,
      anchors: base.anchors.map((candidate) => ({ ...candidate, gripRadius })),
      // 두 경우 프로필 반경은 같게 두어 anchor가 실제 접촉 권위인지 검증한다.
      grip: { ...base.grip!, radius: 0.08 },
    });
    const metrics = createCompleteGripMetrics();
    const thin = createAutoGripFingerOverrides(
      [item],
      () => definitionWithRadius(0.004),
      metrics
    );
    const thick = createAutoGripFingerOverrides(
      [item],
      () => definitionWithRadius(0.025),
      metrics
    );

    expect(Math.abs(thick.rightMiddleIntermediate[2])).toBeLessThan(
      Math.abs(thin.rightMiddleIntermediate[2])
    );
  });

  it("엄지 대립을 세 관절에 분배하고 좌우 방향과 모든 hard limit를 지킨다", () => {
    const right = createPropInstance("sword", "thumb-right")!;
    const left = createPropInstance("sword", "thumb-left")!;
    left.bone = "leftHand";
    const grip = createAutoGripFingerOverrides(
      [right, left],
      propDefById,
      createCompleteGripMetrics()
    );

    for (const segment of ["Metacarpal", "Proximal", "Distal"] as const) {
      const rightName = `rightThumb${segment}`;
      const leftName = `leftThumb${segment}`;
      expect(grip[rightName][1]).toBeCloseTo(-grip[leftName][1], 10);
      expect(grip[rightName][2]).toBeCloseTo(-grip[leftName][2], 10);
    }
    const authoredOpposition = THREE.MathUtils.degToRad(propDefById("sword")!.grip!.thumbOppositionDeg);
    const distributedY = ["Metacarpal", "Proximal", "Distal"].reduce(
      (sum, segment) => sum + Math.abs(grip[`rightThumb${segment}`][1]),
      0
    );
    expect(distributedY).toBeLessThan(authoredOpposition);
    for (const [boneName, rotation] of Object.entries(grip)) {
      expect(rotation).toEqual(clampStudioVrmJointRotation(boneName, rotation));
    }
  });

  it("빈·불완전 손가락 리그와 손상된 접촉 basis는 fail-closed한다", () => {
    const item = createPropInstance("mug", "incomplete-rig")!;
    const missingAllFingers = measureVrmPropRigMetrics(createMeasuredVrm({ omitFingers: true }));
    expect(createAutoGripFingerOverrides([item], propDefById, missingAllFingers)).toEqual({});
    expect(createAutoGripFingerOverrides(
      [item],
      propDefById,
      DEFAULT_VRM_PROP_RIG_METRICS
    )).toEqual({});

    const missingOneBone = createCompleteGripMetrics();
    delete missingOneBone.boneWorldPositions.rightIndexDistal;
    expect(createAutoGripFingerOverrides([item], propDefById, missingOneBone)).toEqual({});

    const base = propDefById("mug")!;
    const badBasis = {
      ...base,
      anchors: base.anchors.map((anchor) => ({
        ...anchor,
        forward: [0, 0, 0] as Vec3,
      })),
    };
    expect(createAutoGripFingerOverrides(
      [item],
      () => badBasis,
      createCompleteGripMetrics()
    )).toEqual({});

    const excessiveCurl = {
      ...base,
      grip: { ...base.grip!, fingerCurlDeg: 999 },
    };
    expect(createAutoGripFingerOverrides(
      [item],
      () => excessiveCurl,
      createCompleteGripMetrics()
    )).toEqual({});
    expect(createAutoGripFingerOverrides(
      [item],
      () => ({ ...base, anchors: [] }),
      createCompleteGripMetrics()
    )).toEqual({});
  });

  it("한 손에 유효한 접촉이 둘이면 배열 순서로 덮지 않고 해당 손을 fail-closed한다", () => {
    const first = createPropInstance("mug", "conflict-a")!;
    const second = createPropInstance("sword", "conflict-b")!;
    const metrics = createCompleteGripMetrics();

    expect(createAutoGripFingerOverrides([first, second], propDefById, metrics)).toEqual({});
    expect(createAutoGripFingerOverrides([second, first], propDefById, metrics)).toEqual({});
  });

  it("secondary anchor에서 손바닥 오프셋을 빼 손목 목표를 계산한다", () => {
    const def = propDefById("sword")!;
    const secondaryAnchor = def.anchors.find((candidate) => candidate.role === "secondary")!;
    const groupQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.35, 0.6));
    const socketQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, 0.25, 0.15));
    const handSocket = {
      position: [0.01, 0.04, -0.005] as Vec3,
      rotationQuaternion: [
        socketQuaternion.x,
        socketQuaternion.y,
        socketQuaternion.z,
        socketQuaternion.w,
      ] as const,
      rotationDeg: [0, 0, 0] as Vec3,
      source: "measured" as const,
    };
    const handScale = new THREE.Vector3(1.1, 0.9, 1.1);
    const result = resolveSecondaryHandConstraint(
      secondaryAnchor,
      [0.5, 1.1, -0.2],
      [groupQuaternion.x, groupQuaternion.y, groupQuaternion.z, groupQuaternion.w],
      1.25,
      handSocket,
      [handScale.x, handScale.y, handScale.z]
    )!;

    // Reconstruct the actual rendered T * R * S transform, not the retired
    // geometric-mean approximation that loses the hand's per-axis scale.
    const targetHandQuaternion = new THREE.Quaternion(...result.targetHandWorldQuaternion);
    const handWorldMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...result.wristWorldPosition),
      targetHandQuaternion,
      handScale
    );
    const reconstructedPalm = new THREE.Vector3(...handSocket.position).applyMatrix4(handWorldMatrix);
    const expectedAnchor = new THREE.Vector3(...secondaryAnchor.position).applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(0.5, 1.1, -0.2),
        groupQuaternion,
        new THREE.Vector3(1.25, 1.25, 1.25)
      )
    );

    expectVecClose(
      [reconstructedPalm.x, reconstructedPalm.y, reconstructedPalm.z],
      result.anchorWorldPosition,
      6
    );
    expectVecClose(
      result.anchorWorldPosition,
      [expectedAnchor.x, expectedAnchor.y, expectedAnchor.z],
      6
    );
    expect(
      new THREE.Vector3(...result.wristWorldPosition).distanceTo(
        new THREE.Vector3(...result.anchorWorldPosition)
      )
    ).toBeGreaterThan(0.02);
  });

  it("손상된 secondary world transform은 안전하게 거부한다", () => {
    const anchor = propDefById("book")!.anchors.find((candidate) => candidate.role === "secondary")!;
    expect(resolveSecondaryHandConstraint(
      anchor,
      [0, 0, 0],
      [0, 0, 0, 1],
      Number.NaN,
      DEFAULT_VRM_PROP_RIG_METRICS.handSockets.rightHand
    )).toBeNull();
  });

  it("autoFingerPose가 꺼졌거나 손 본이 아니면 override를 만들지 않는다", () => {
    const hand = createPropInstance("mug", "off")!;
    hand.rig = { ...hand.rig!, autoFingerPose: false };
    const head = createPropInstance("cap", "head")!;
    expect(createAutoGripFingerOverrides(
      [hand, head],
      propDefById,
      createCompleteGripMetrics()
    )).toEqual({});
  });
});
