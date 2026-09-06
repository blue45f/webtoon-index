import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { STUDIO_HUMANOID_BONE_NAMES } from "../studio-humanoid-bones";

import { createAvatarForgeState } from "./studio-vrm-avatar-forge";
import {
  STUDIO_VRM_APPLIED_HUMANOID_BONES,
  applyPoseToVrm,
  stripFingerBones,
  applyPoserVisualState,
  applyFullState,
  planFullStateRestore,
  buildFullVrmStateFromSharedDataUrl,
  canRestoreFullVrmHistoryState,
  deserializeFullVrmState,
  normalizeVrmBodyRotation,
  serializeFullVrmState,
  buildVrmPoseDataUrlMetadata,
  createFullStateLoadHandlers,
  applyVrmMaterialFx,
  applyVrmCustomColors,
  classifyVrmCustomColorPart,
  classifyVrmCustomColorPartForMaterial,
  hasVrmMToonMaterial,
  isVrmMannequinPaintColor,
  isVrmNearBlackLitColor,
  repairVrmTexturedNearBlackLitFactors,
  scrubVrmMannequinColorCaches,
  STUDIO_VRM_MANNEQUIN_COLOR_HEX,
  DEFAULT_VRM_MATERIAL_FX,
  type PoseBoneMap,
  type FingerRotationMap,
  type BodyScale,
  type FullVrmState,
  type VrmMaterialFx,
} from "./studio-vrm-poser-utils";
import {
  DEFAULT_STUDIO_VRM_LIGHTING_TONE,
  STUDIO_VRM_LIGHTING_TONES,
} from "./studio-vrm-scene-document";

import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";


type BoneNodes = Partial<Record<VRMHumanBoneName, THREE.Object3D>>;

function addBone(bones: BoneNodes, name: VRMHumanBoneName, parent: THREE.Object3D, position: THREE.Vector3Tuple) {
  const bone = new THREE.Object3D();
  bone.name = name;
  bone.position.set(position[0], position[1], position[2]);
  parent.add(bone);
  bones[name] = bone;
  return bone;
}

function createMinimalVrm() {
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

  const humanoid = {
    resetNormalizedPose: () => {
      Object.values(bones).forEach((b) => {
        b.rotation.set(0, 0, 0);
        b.quaternion.identity();
      });
      scene.position.set(0, 0, 0);
      scene.updateMatrixWorld(true);
    },
    getNormalizedBoneNode: (name: VRMHumanBoneName) => bones[name] ?? null,
    update: () => scene.updateMatrixWorld(true),
  };

  const vrm = {
    scene,
    humanoid,
    update: () => scene.updateMatrixWorld(true),
  } as unknown as VRM;

  return { vrm, bones };
}

/** MToonMaterial의 구조적 형태를 흉내 낸 재질(패키지 미의존 — applyVrmMaterialFx와 같은 방식). */
type MToonLikeMaterial = THREE.MeshStandardMaterial & {
  isMToonMaterial: boolean;
  shadeColorFactor: THREE.Color;
  outlineColorFactor: THREE.Color;
  parametricRimColorFactor: THREE.Color;
  rimLightingMixFactor: number;
};

function createMToonLikeMaterial(): MToonLikeMaterial {
  const mat = new THREE.MeshStandardMaterial() as MToonLikeMaterial;
  mat.isMToonMaterial = true;
  mat.shadeColorFactor = new THREE.Color("#ffffff");
  mat.outlineColorFactor = new THREE.Color("#000000");
  mat.parametricRimColorFactor = new THREE.Color("#ffffff");
  mat.rimLightingMixFactor = 0;
  mat.emissiveIntensity = 0;
  return mat;
}

function addMesh(parent: THREE.Object3D, name: string, material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material);
  mesh.name = name;
  parent.add(mesh);
  return mesh;
}

describe("studio-vrm-poser-utils unified pipeline", () => {
  it("applies the complete shared 55-bone vocabulary including optional face and toe bones", () => {
    expect(STUDIO_VRM_APPLIED_HUMANOID_BONES).toEqual(STUDIO_HUMANOID_BONE_NAMES);
    const scene = new THREE.Group();
    const optionalBones = [
      "upperChest",
      "leftEye",
      "rightEye",
      "jaw",
      "leftToes",
      "rightToes",
    ] as const;
    const nodes = new Map<VRMHumanBoneName, THREE.Object3D>();
    for (const bone of optionalBones) {
      const node = new THREE.Object3D();
      scene.add(node);
      nodes.set(bone, node);
    }
    const vrm = {
      scene,
      humanoid: {
        resetNormalizedPose: () => nodes.forEach((node) => node.rotation.set(0, 0, 0)),
        getNormalizedBoneNode: (bone: VRMHumanBoneName) => nodes.get(bone) ?? null,
        update: () => undefined,
      },
      update: () => undefined,
    } as unknown as VRM;
    const pose = Object.fromEntries(
      optionalBones.map((bone, index) => [bone, { rotation: [0.01 * (index + 1), 0.02, -0.03] }]),
    ) as PoseBoneMap;

    expect(applyPoseToVrm(vrm, pose, 0)).toBe(true);
    for (const bone of optionalBones) {
      expect(nodes.get(bone)?.rotation.x).toBeCloseTo(pose[bone]!.rotation![0]);
    }
  });

  it("serializes a bounded body rotation and explicit model owner while rejecting unsafe values", () => {
    const serialized = serializeFullVrmState({
      modelId: "model-a",
      bodyRotation: Math.PI / 3,
    });
    expect(serialized.modelId).toBe("model-a");
    expect(serialized.bodyRotation).toBeCloseTo(Math.PI / 3);

    const transported = JSON.parse(JSON.stringify(serialized)) as FullVrmState;
    const restorePlan = planFullStateRestore(transported);
    expect(restorePlan.modelId).toBe("model-a");
    expect(restorePlan.bodyRotation).toBeCloseTo(Math.PI / 3);

    expect(serializeFullVrmState({ bodyRotation: Number.POSITIVE_INFINITY }).bodyRotation).toBe(0);
    expect(serializeFullVrmState({ bodyRotation: Math.PI * 4 }).bodyRotation).toBe(Math.PI);
    expect(serializeFullVrmState({ bodyRotation: -Math.PI * 4 }).bodyRotation).toBe(-Math.PI);
    expect(serializeFullVrmState({ modelId: "bad\u0000id" }).modelId).toBeUndefined();
    expect(serializeFullVrmState({ modelId: " model-a " }).modelId).toBeUndefined();
    expect(serializeFullVrmState({ modelId: "x".repeat(257) }).modelId).toBeUndefined();
    expect(normalizeVrmBodyRotation(Number.NaN)).toBe(0);
  });

  it("allows undo/redo only for an explicitly matching model owner", () => {
    const owned = serializeFullVrmState({ modelId: "model-a" });
    const legacy = serializeFullVrmState({});

    expect(canRestoreFullVrmHistoryState(owned, "model-a")).toBe(true);
    expect(canRestoreFullVrmHistoryState(owned, "model-b")).toBe(false);
    expect(canRestoreFullVrmHistoryState(legacy, "model-a")).toBe(false);
    expect(canRestoreFullVrmHistoryState(owned, "")).toBe(false);
  });

  it("round-trips exact lighting tones and defaults historical full-state payloads to morning", () => {
    for (const lightingTone of STUDIO_VRM_LIGHTING_TONES) {
      const state = serializeFullVrmState({ lightingTone });
      expect(state.lightingTone).toBe(lightingTone);
      expect(deserializeFullVrmState(JSON.parse(JSON.stringify(state)))?.lightingTone)
        .toBe(lightingTone);
      expect(planFullStateRestore(state).lightingTone).toBe(lightingTone);

      const metadata = buildVrmPoseDataUrlMetadata(state, "Lighting model");
      expect(metadata.lightingTone).toBe(lightingTone);
      expect(buildFullVrmStateFromSharedDataUrl(
        `data:image/png;base64,AA#${encodeURIComponent(JSON.stringify(metadata))}`,
      )?.lightingTone).toBe(lightingTone);
    }

    const current = serializeFullVrmState({ lightingTone: "night" });
    const historicalV3 = { ...current } as Record<string, unknown>;
    delete historicalV3.lightingTone;
    expect(deserializeFullVrmState(historicalV3)?.lightingTone)
      .toBe(DEFAULT_STUDIO_VRM_LIGHTING_TONE);
    expect(deserializeFullVrmState({
      version: 2,
      bones: {},
      yOffset: 0,
      bodyRotation: 0,
    })?.lightingTone).toBe(DEFAULT_STUDIO_VRM_LIGHTING_TONE);

    const metadata = buildVrmPoseDataUrlMetadata(current, "Pre-tone model");
    const historicalFragment = { ...metadata } as Record<string, unknown>;
    delete historicalFragment.lightingTone;
    expect(buildFullVrmStateFromSharedDataUrl(
      `data:image/png;base64,AA#${encodeURIComponent(JSON.stringify(historicalFragment))}`,
    )?.lightingTone).toBe(DEFAULT_STUDIO_VRM_LIGHTING_TONE);

    for (const lightingTone of ["day", "Morning", "", null, 1]) {
      expect(deserializeFullVrmState({ ...current, lightingTone })).toBeNull();
      expect(buildFullVrmStateFromSharedDataUrl(
        `data:image/png;base64,AA#${encodeURIComponent(JSON.stringify({
          ...metadata,
          lightingTone,
        }))}`,
      )).toBeNull();
    }
  });

  it("builds one canonical PNG metadata payload for share and re-edit", () => {
    const metadata = buildVrmPoseDataUrlMetadata({
      modelId: "model-a",
      bones: { hips: { rotation: [0, 0.1, 0] } },
      bodyRotation: Math.PI / 6,
      props: { version: 1, items: [] },
    }, "Model A");

    expect(metadata.tool).toBe("vrm-poser");
    expect(metadata.modelName).toBe("Model A");
    expect(metadata.modelId).toBe("model-a");
    expect(metadata.bodyRotation).toBeCloseTo(Math.PI / 6);
    expect(metadata.vrmProps).toEqual({ version: 1, items: [] });
    expect("props" in metadata).toBe(false);

    const restored = buildFullVrmStateFromSharedDataUrl(
      `data:image/png;base64,AA#${encodeURIComponent(JSON.stringify(metadata))}`,
    );
    expect(restored?.modelId).toBe("model-a");
    expect(restored?.bodyRotation).toBeCloseTo(Math.PI / 6);
    expect(planFullStateRestore(restored as FullVrmState).bodyRotation).toBeCloseTo(Math.PI / 6);
  });

  it("strictly promotes v2 full state and rejects non-canonical current IK/translation payloads", () => {
    const legacy = deserializeFullVrmState({
      version: 2,
      bones: {},
      yOffset: 0,
      bodyRotation: 0,
    });
    expect(legacy).toEqual(expect.objectContaining({
      version: 3,
      poseTranslations: {
        version: 1,
        root: [0, 0, 0],
        hips: [0, 0, 0],
        spine: [0, 0, 0],
      },
      ikConstraints: [],
    }));

    const current = serializeFullVrmState({
      bones: {},
      yOffset: 0,
      bodyRotation: 0,
      ikConstraints: [{
        effector: "leftHand",
        enabled: true,
        locked: true,
        target: [0.5, 1.2, -0.1],
        pole: [0.2, 0.9, 0.3],
      }],
    });
    expect(deserializeFullVrmState(JSON.parse(JSON.stringify(current)))).toEqual(current);
    expect(deserializeFullVrmState({ ...current, poseTranslations: undefined })).toBeNull();
    expect(deserializeFullVrmState({
      ...current,
      poseTranslations: { ...current.poseTranslations, root: [0, 0, Number.NaN] },
    })).toBeNull();
    expect(deserializeFullVrmState({
      version: 2,
      bones: {},
      yOffset: 0,
      bodyRotation: 0,
      poseTranslations: { version: 1, root: [0, 1, 0], hips: [0, 0, 0], spine: [0, 0, 0] },
    })).toBeNull();
    expect(deserializeFullVrmState({ ...current, futureField: true })).toBeNull();
  });

  it("rejects unsafe current runtime pose fields before shared data reaches Three.js", () => {
    const current = serializeFullVrmState({
      bones: { hips: { rotation: [0.1, 0.2, 0.3] } },
      yOffset: 0,
      bodyRotation: 0,
      expressionWeights: { happy: 0.5 },
      fingerOverrides: { leftIndexProximal: [0.1, 0.2, 0.3] },
      bodyScale: { height: 1, width: 1 },
      customColors: { hair: "#aabbcc" },
    });
    expect(deserializeFullVrmState({
      ...current,
      bones: { ...current.bones, arbitrarySceneNode: { rotation: [0, 0, 0] } },
    })).toBeNull();
    expect(deserializeFullVrmState({
      ...current,
      bones: { hips: { rotation: [0, Number.NaN, 0] } },
    })).toBeNull();
    expect(deserializeFullVrmState({
      ...current,
      fingerOverrides: { arbitraryFinger: [0, 0, 0] },
    })).toBeNull();
    expect(deserializeFullVrmState({
      ...current,
      bodyScale: { height: 99, width: 1 },
    })).toBeNull();
    expect(deserializeFullVrmState({
      ...current,
      expressionWeights: { happy: 2 },
    })).toBeNull();
    expect(deserializeFullVrmState({
      ...current,
      customColors: { constructor: "#ffffff" },
    })).toBeNull();
    expect(deserializeFullVrmState({ ...current, physics: {} })).toBeNull();
    expect(deserializeFullVrmState({
      ...current,
      physics: {
        version: 1,
        stiffnessScale: Number.NaN,
        gravityScale: 1,
        windDirectionDeg: 0,
        windStrength: 0,
      },
    })).toBeNull();
    expect(deserializeFullVrmState({
      ...current,
      physics: {
        version: 1,
        stiffnessScale: 1,
        gravityScale: 1,
        windDirectionDeg: 0,
        windStrength: 0,
        future: true,
      },
    })).toBeNull();
    expect(deserializeFullVrmState({
      ...current,
      physics: {
        version: 1,
        stiffnessScale: 1,
        gravityScale: 1,
        windDirectionDeg: 0,
        windStrength: 0.25,
      },
    })?.physics).toEqual({
      version: 1,
      stiffnessScale: 1,
      gravityScale: 1,
      windDirectionDeg: 0,
      windStrength: 0.25,
    });
  });

  it("requires every current shared-fragment base field instead of manufacturing defaults", () => {
    const current = buildVrmPoseDataUrlMetadata(serializeFullVrmState({}), "Model");
    for (const key of ["bones", "yOffset", "bodyRotation", "poseTranslations", "ikConstraints"] as const) {
      const malformed = { ...current } as Record<string, unknown>;
      delete malformed[key];
      expect(buildFullVrmStateFromSharedDataUrl(
        `data:image/png;base64,AA#${encodeURIComponent(JSON.stringify(malformed))}`,
      )).toBeNull();
    }

    const legacy = buildFullVrmStateFromSharedDataUrl(
      `data:image/png;base64,AA#${encodeURIComponent(JSON.stringify({ bones: {}, yOffset: 0 }))}`,
    );
    expect(legacy).toEqual(expect.objectContaining({
      version: 3,
      bodyRotation: 0,
      ikConstraints: [],
    }));
  });

  it("keeps explicit full-state load as an intentional cross-model transfer", () => {
    const saved = serializeFullVrmState({
      modelId: "source-model",
      bodyRotation: 0.4,
    });
    const committed: FullVrmState[] = [];
    const handlers = createFullStateLoadHandlers({
      savedFullStates: { saved },
      commitFullStateRestore: (state) => {
        committed.push(state);
      },
      vrmRef: { current: null },
    });

    expect(handlers.handleLoadFullLocal("saved")).toBe(true);
    expect(committed).toEqual([saved]);
  });

  it("does not report or decorate a full-state load whose rig restore was rejected", () => {
    const saved = serializeFullVrmState({
      modelId: "source-model",
      customColors: { Head: "#abcdef" },
    });
    const customColors: Record<string, string>[] = [];
    const handlers = createFullStateLoadHandlers({
      savedFullStates: { saved },
      commitFullStateRestore: () => false,
      vrmRef: { current: null },
      setCustomColors: (colors) => customColors.push(colors),
    });
    const metadata = buildVrmPoseDataUrlMetadata(saved, "Rejected pose");
    const sharedDataUrl = `data:image/png;base64,AA#${encodeURIComponent(JSON.stringify(metadata))}`;

    expect(handlers.handleLoadFullLocal("saved")).toBe(false);
    expect(handlers.handlePasteFullStateFromParsed(saved)).toBe(false);
    expect(handlers.handleSelectSharedPose({ dataUrl: sharedDataUrl })).toBe(false);
    expect(customColors).toEqual([]);
  });

  it("stripFingerBones removes finger entries", () => {
    const bones: PoseBoneMap = {
      hips: { rotation: [0, 0, 0] },
      leftIndexProximal: { rotation: [0, 0, 0.3] },
    };
    const stripped = stripFingerBones(bones);
    expect("hips" in stripped).toBe(true);
    expect("leftIndexProximal" in stripped).toBe(false);
  });

  it("applyPoserVisualState applies pose (stripped) then fingerEdits and bodyScale; finger survives different pose", () => {
    const { vrm } = createMinimalVrm();

    const pose1: PoseBoneMap = { hips: { rotation: [0, 0, 0] } };
    const finger: FingerRotationMap = { leftIndexProximal: [0, 0, 0.4] };
    const scale: BodyScale = { height: 1.2, width: 0.9 };

    applyPoserVisualState(vrm, { bones: pose1, fingerEdits: finger, bodyScale: scale });

    const fingerBone = vrm.humanoid!.getNormalizedBoneNode("leftIndexProximal");
    expect(fingerBone?.rotation.z).toBeCloseTo(0.4);

    expect(vrm.scene.scale.y).toBeCloseTo(1.2, 2);

    // switch to different pose
    const pose2: PoseBoneMap = { hips: { rotation: [0.1, 0, 0] } };
    applyPoserVisualState(vrm, { bones: pose2, fingerEdits: finger, bodyScale: scale });

    // finger should still be applied (survives)
    const fingerBone2 = vrm.humanoid!.getNormalizedBoneNode("leftIndexProximal");
    expect(fingerBone2?.rotation.z).toBeCloseTo(0.4);
  });

  it("applies root, hips, and spine translations without accumulating across previews", () => {
    const { vrm, bones } = createMinimalVrm();
    const translations = {
      version: 1 as const,
      root: [0.35, 0, -0.2] as const,
      hips: [0.1, -0.08, 0.03] as const,
      spine: [-0.04, 0.06, 0.02] as const,
    };

    expect(applyPoseToVrm(vrm, {}, 0.45, translations)).toBe(true);
    expect(vrm.scene.position.toArray()).toEqual([0.35, 0.45, -0.2]);
    expect(bones.hips?.position.toArray()).toEqual([
      expect.closeTo(0.1, 12),
      expect.closeTo(0.94, 12),
      expect.closeTo(0.03, 12),
    ]);
    expect(bones.spine?.position.toArray()).toEqual([
      expect.closeTo(-0.04, 12),
      expect.closeTo(0.28, 12),
      expect.closeTo(0.02, 12),
    ]);

    expect(applyPoseToVrm(vrm, {}, 0.45, translations)).toBe(true);
    expect(bones.hips?.position.toArray()).toEqual([
      expect.closeTo(0.1, 12),
      expect.closeTo(0.94, 12),
      expect.closeTo(0.03, 12),
    ]);
    expect(bones.spine?.position.toArray()).toEqual([
      expect.closeTo(-0.04, 12),
      expect.closeTo(0.28, 12),
      expect.closeTo(0.02, 12),
    ]);

    expect(applyPoseToVrm(vrm, {}, 0)).toBe(true);
    expect(vrm.scene.position.toArray()).toEqual([0, 0, 0]);
    expect(bones.hips?.position.toArray()).toEqual([0, 1.02, 0]);
    expect(bones.spine?.position.toArray()).toEqual([0, 0.22, 0]);
  });

  it("round-trips pose translations through full-state history and PNG metadata", () => {
    const state = serializeFullVrmState({
      poseTranslations: {
        version: 1,
        root: [0.2, 0, -0.1],
        hips: [0.05, -0.03, 0.02],
        spine: [-0.02, 0.04, 0.01],
      },
    });
    expect(planFullStateRestore(state).poseTranslations).toEqual(state.poseTranslations);
    const metadata = buildVrmPoseDataUrlMetadata(state, "Model");
    const restored = buildFullVrmStateFromSharedDataUrl(
      `data:image/png;base64,AA#${encodeURIComponent(JSON.stringify(metadata))}`,
    );
    expect(restored?.poseTranslations).toEqual(state.poseTranslations);
  });

  it("round-trips canonical Avatar Forge v4 proportions without changing the outer state version", () => {
    const avatarForge = createAvatarForgeState("wave-diva");
    avatarForge.proportions = {
      ...avatarForge.proportions,
      presetId: "sd-chibi-3",
      headBodyRatio: 2.4,
      legLength: 0.73,
      shoulderWidth: 1.08,
    };
    avatarForge.legacyHipWidth = 1.12;
    const state = serializeFullVrmState({ avatarForge });

    expect(state.version).toBe(3);
    expect(deserializeFullVrmState(JSON.parse(JSON.stringify(state)))?.avatarForge).toEqual(
      avatarForge,
    );
    expect(planFullStateRestore(state).avatarForge).toEqual(avatarForge);

    const metadata = buildVrmPoseDataUrlMetadata(state, "Forge v4");
    const restored = buildFullVrmStateFromSharedDataUrl(
      `data:image/png;base64,AA#${encodeURIComponent(JSON.stringify(metadata))}`,
    );
    expect(restored?.version).toBe(3);
    expect(restored?.avatarForge).toEqual(avatarForge);
  });

  it("applyFullState invokes costume/props/physics delegates when present", () => {
    const { vrm } = createMinimalVrm();

    const calls: string[] = [];
    const mockApplyers = {
      applyPose: () => { calls.push("pose"); },
      applyExpr: () => { calls.push("expr"); },
      applyCostume: (c: any) => { calls.push("costume:" + (c ? "yes" : "no")); },
      applyProps: (p: any) => { calls.push("props:" + (p?.items ? "yes" : "no")); },
      applyPhysics: (p: any) => { calls.push("physics:" + (p ? "yes" : "no")); },
      applyCustomColors: (colors: Record<string, string>) => { calls.push("colors:" + colors.face); },
    };

    const fullState = {
      version: 2,
      bones: {},
      costume: { hidden: ["foo"] },
      props: { items: [{ uid: "1" }] },
      physics: { stiffnessScale: 1 },
      customColors: { face: "#123456" },
    } as any;

    applyFullState(vrm, fullState, mockApplyers);

    expect(calls).toContain("costume:yes");
    expect(calls).toContain("props:yes");
    expect(calls).toContain("physics:yes");
    expect(calls).toContain("colors:#123456");
  });

  it("applyFullState sends an empty normalized prop collection when props are absent", () => {
    const { vrm } = createMinimalVrm();
    let received: unknown = null;
    applyFullState(vrm, { version: 2, bones: {}, yOffset: 0 }, {
      applyPose: () => undefined,
      applyExpr: () => undefined,
      applyProps: (props) => { received = props; },
    });
    expect(received).toEqual(expect.objectContaining({ items: [] }));
  });

  it("planFullStateRestore returns complete plan with stripped bones for maximal AC2 input", () => {
    const input: FullVrmState = {
      version: 3,
      modelId: "model-a",
      bones: {
        hips: { rotation: [0, 0, 0] },
        leftIndexProximal: { rotation: [0, 0, 0.3] },
      },
      yOffset: 0.1,
      ikConstraints: [],
      bodyRotation: Math.PI / 4,
      expressionWeights: { happy: 0.8 },
      bodyScale: { height: 1.2, width: 0.95 },
      lighting: { intensity: 1.5, colorTemp: 0.7, directionDeg: 45 },
      lightingTone: "studio",
      env: "floor",
      fingerOverrides: { leftIndexProximal: [0, 0, 0.3] },
      costume: { hidden: ["x"] },
      props: {
        version: 1,
        items: [{
          uid: "p1",
          propId: "book",
          bone: "leftHand",
          position: [0.02, 0.01, 0.04],
          rotationDeg: [60, 0, 0],
          scale: 1,
          color: "#7a3b3b",
        }],
      },
      sceneProps: {
        version: 1,
        active: ["cat"],
        attachments: { cat: { bone: "none", offsetX: 0.1, offsetY: 0, offsetZ: 0, rotX: 0, rotY: 0, rotZ: 0, scale: 1 } },
      },
      physics: { stiffnessScale: 1.1 },
      materialFx: { rimIntensity: 0.35 },
      avatarForge: { version: 1, presetId: "hero" },
      customColors: { face: "#123456", body: "#123456" },
    } as any;

    const plan = planFullStateRestore(input);
    expect("leftIndexProximal" in plan.strippedBones).toBe(false);
    expect("hips" in plan.strippedBones).toBe(true);
    expect(plan.yOffset).toBe(0.1);
    expect(plan.modelId).toBe("model-a");
    expect(plan.bodyRotation).toBeCloseTo(Math.PI / 4);
    expect(plan.expressionWeights.happy).toBe(0.8);
    expect(plan.bodyScale?.height).toBe(1.2);
    expect(plan.lighting?.intensity).toBe(1.5);
    expect(plan.lightingTone).toBe("studio");
    expect(plan.env).toBe("floor");
    expect(plan.fingerOverrides?.leftIndexProximal?.[2]).toBeCloseTo(0.3);
    expect((plan.costume as any)?.hidden).toContain("x");
    expect((plan.propsItems as any)?.[0]?.uid).toBe("p1");
    expect(plan.sceneProps.active).toEqual(["cat"]);
    expect((plan.physics as any)?.stiffnessScale).toBe(1.1);
    expect(plan.materialFx?.rimIntensity).toBe(0.35);
    expect(plan.avatarForge).toEqual({ version: 1, presetId: "hero" });
    expect(plan.customColors?.face).toBe("#123456");
  });

  it("normalizes corrupted props and clears stale props when the field is absent", () => {
    const corrupted = planFullStateRestore({
      version: 2,
      bones: {},
      yOffset: 0,
      props: {
        version: 1,
        items: [
          { propId: "ghost" },
          { uid: "valid", propId: "book", bone: "tail", position: [999, 0, 0] },
        ],
      },
    });
    expect(corrupted.propsItems).toHaveLength(1);
    expect(corrupted.propsItems[0]?.bone).toBe("leftHand");
    expect(corrupted.propsItems[0]?.position[0]).toBe(1);

    const absent = planFullStateRestore({ version: 2, bones: {}, yOffset: 0 });
    expect(absent.bodyRotation).toBe(0);
    expect(absent.propsItems).toEqual([]);
    expect(absent.sceneProps.active).toEqual([]);
  });

  it("restores wardrobe, material effects and avatar forge state from shared PNG metadata", () => {
    const metadata = {
      modelId: "model-shared",
      bones: { hips: { rotation: [0, 0, 0] } },
      yOffset: 0.04,
      bodyRotation: -Math.PI / 2,
      wardrobe: { version: 1, slots: { top: { itemId: "lab-coat" } } },
      sceneProps: {
        version: 1,
        active: ["cat"],
        attachments: { cat: { bone: "none", offsetX: 0, offsetY: 0, offsetZ: 0, rotX: 0, rotY: 0, rotZ: 0, scale: 1 } },
      },
      materialFx: { rimIntensity: 0.42 },
      avatarForge: { version: 1, presetId: "soft-hero" },
    };
    const state = buildFullVrmStateFromSharedDataUrl(
      `data:image/png;base64,AA#${encodeURIComponent(JSON.stringify(metadata))}`
    );

    expect(state?.wardrobe).toEqual(metadata.wardrobe);
    expect(state?.modelId).toBe("model-shared");
    expect(state?.bodyRotation).toBeCloseTo(-Math.PI / 2);
    expect(state?.sceneProps).toEqual(metadata.sceneProps);
    expect(state?.materialFx).toEqual(metadata.materialFx);
    expect(state?.avatarForge).toEqual(metadata.avatarForge);
  });
});

describe("VRM material fx (MToon shade/outline/rim/emissive)", () => {
  it("hasVrmMToonMaterial is false with no meshes or only non-MToon meshes, true once an MToon mesh exists", () => {
    const { vrm } = createMinimalVrm();
    expect(hasVrmMToonMaterial(vrm)).toBe(false);

    addMesh(vrm.scene, "Body", new THREE.MeshBasicMaterial());
    expect(hasVrmMToonMaterial(vrm)).toBe(false);

    addMesh(vrm.scene, "Tops", createMToonLikeMaterial());
    expect(hasVrmMToonMaterial(vrm)).toBe(true);
  });

  it("applyVrmMaterialFx sets shade/outline/rim/emissive uniforms on MToon materials only", () => {
    const { vrm } = createMinimalVrm();
    const mtoonMat = createMToonLikeMaterial();
    const standardMat = new THREE.MeshStandardMaterial();
    addMesh(vrm.scene, "Tops", mtoonMat);
    addMesh(vrm.scene, "Body", standardMat);

    const fx: VrmMaterialFx = {
      shadeColor: "#112233",
      outlineColor: "#445566",
      rimColor: "#778899",
      rimIntensity: 0.6,
      emissiveColor: "#ff00ff",
      emissiveIntensity: 0.4,
    };
    applyVrmMaterialFx(vrm, fx);

    expect(`#${mtoonMat.shadeColorFactor.getHexString()}`).toBe("#112233");
    expect(`#${mtoonMat.outlineColorFactor.getHexString()}`).toBe("#445566");
    expect(`#${mtoonMat.parametricRimColorFactor.getHexString()}`).toBe("#778899");
    expect(mtoonMat.rimLightingMixFactor).toBeCloseTo(0.6);
    expect(`#${mtoonMat.emissive.getHexString()}`).toBe("#ff00ff");
    expect(mtoonMat.emissiveIntensity).toBeCloseTo(0.4);

    // 표준 재질엔 isMToonMaterial 플래그가 없으므로 색 변경 없이 조용히 건너뛴다(에러 없음).
    expect(standardMat.emissive.getHexString()).toBe("000000");
  });

  it("applyVrmMaterialFx leaves emissive untouched on protected (face/eye) meshes but still applies shade/outline/rim", () => {
    const { vrm } = createMinimalVrm();
    const faceMat = createMToonLikeMaterial();
    addMesh(vrm.scene, "Face", faceMat);

    const fx: VrmMaterialFx = {
      ...DEFAULT_VRM_MATERIAL_FX,
      shadeColor: "#123456",
      emissiveColor: "#ff00ff",
      emissiveIntensity: 0.9,
    };
    applyVrmMaterialFx(vrm, fx);

    expect(`#${faceMat.shadeColorFactor.getHexString()}`).toBe("#123456");
    // 보호 카테고리(얼굴)는 발광색 변경에서 제외된다.
    expect(`#${faceMat.emissive.getHexString()}`).not.toBe("#ff00ff");
  });

  it("applyVrmMaterialFx is a no-op when every fx field is null/default", () => {
    const { vrm } = createMinimalVrm();
    const mat = createMToonLikeMaterial();
    addMesh(vrm.scene, "Tops", mat);

    expect(() => applyVrmMaterialFx(vrm, DEFAULT_VRM_MATERIAL_FX)).not.toThrow();
    expect(`#${mat.shadeColorFactor.getHexString()}`).toBe("#ffffff");
    expect(`#${mat.outlineColorFactor.getHexString()}`).toBe("#000000");
  });

  it("applyVrmCustomColors preserves native VRM material color when customColors is empty or #ffffff", () => {
    const { vrm } = createMinimalVrm();
    const hairMat = new THREE.MeshStandardMaterial({ color: new THREE.Color("#4a2e12") });
    addMesh(vrm.scene, "F00_Hair_00", hairMat);

    // Initial call with empty customColors should keep original native hair color (#4a2e12)
    applyVrmCustomColors(vrm, {});
    expect(`#${hairMat.color.getHexString()}`).toBe("#4a2e12");

    // Call with #ffffff should also preserve native hair color
    applyVrmCustomColors(vrm, { hair: "#ffffff" });
    expect(`#${hairMat.color.getHexString()}`).toBe("#4a2e12");
  });

  it("applyVrmCustomColors applies custom color and restores original native color on reset", () => {
    const { vrm } = createMinimalVrm();
    const topsMat = new THREE.MeshStandardMaterial({ color: new THREE.Color("#1a2b3c") });
    addMesh(vrm.scene, "Tops_Cloth", topsMat);

    // Apply custom color #ff0000
    applyVrmCustomColors(vrm, { tops: "#ff0000" });
    expect(`#${topsMat.color.getHexString()}`).toBe("#ff0000");

    // Resetting custom colors to empty or #ffffff restores original #1a2b3c
    applyVrmCustomColors(vrm, { tops: "#ffffff" });
    expect(`#${topsMat.color.getHexString()}`).toBe("#1a2b3c");
  });

  it("applyVrmCustomColors refuses near-black originals so textured clothes do not restore to pure black", () => {
    const { vrm } = createMinimalVrm();
    const topsMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#000000"),
      map: new THREE.Texture(),
    });
    addMesh(vrm.scene, "Tops_Cloth", topsMat);

    expect(isVrmNearBlackLitColor(topsMat.color)).toBe(true);

    applyVrmCustomColors(vrm, { tops: "#ff3366" });
    expect(`#${topsMat.color.getHexString()}`).toBe("#ff3366");

    // Reset must restore white lit factor, not the near-black poison that multiplies texture to black.
    applyVrmCustomColors(vrm, {});
    expect(`#${topsMat.color.getHexString()}`).toBe("#ffffff");
  });

  it("applyVrmCustomColors refuses mannequin clay as native original", () => {
    const { vrm } = createMinimalVrm();
    const topsMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(STUDIO_VRM_MANNEQUIN_COLOR_HEX),
    });
    addMesh(vrm.scene, "Tops_Jacket", topsMat);

    expect(isVrmMannequinPaintColor(topsMat.color)).toBe(true);

    applyVrmCustomColors(vrm, { tops: "#2244aa" });
    expect(`#${topsMat.color.getHexString()}`).toBe("#2244aa");

    applyVrmCustomColors(vrm, { tops: "#ffffff" });
    expect(`#${topsMat.color.getHexString()}`).toBe("#ffffff");
  });

  it("scrubVrmMannequinColorCaches drops clay/near-black cached originals", () => {
    const { vrm } = createMinimalVrm();
    const topsMat = new THREE.MeshStandardMaterial({ color: new THREE.Color("#abcdef") });
    addMesh(vrm.scene, "Tops_Cloth", topsMat);
    topsMat.userData.__vrmCustomColorOriginal = new THREE.Color("#000000");
    topsMat.userData.__vrmCustomColorApplied = true;
    topsMat.userData.__vrmMannequinActive = true;

    scrubVrmMannequinColorCaches(vrm);

    expect(topsMat.userData.__vrmMannequinActive).toBe(false);
    expect(topsMat.userData.__vrmCustomColorOriginal).toBeUndefined();
    expect(topsMat.userData.__vrmCustomColorApplied).toBe(false);
  });

  it("applyVrmCustomColors leaves materials alone while mannequin paint is active", () => {
    const { vrm } = createMinimalVrm();
    const topsMat = new THREE.MeshStandardMaterial({ color: new THREE.Color("#b7b2a8") });
    topsMat.userData.__vrmMannequinActive = true;
    addMesh(vrm.scene, "Tops_Cloth", topsMat);

    applyVrmCustomColors(vrm, { tops: "#ff0000" });
    expect(`#${topsMat.color.getHexString()}`).toBe("#b7b2a8");
  });

  it("classifies clothing materials on multi-material Body meshes by material name", () => {
    expect(classifyVrmCustomColorPart("Body")).toBe("body");
    expect(classifyVrmCustomColorPartForMaterial("Body", "F00_006_01_Tops_01_CLOTH")).toBe("tops");
    expect(classifyVrmCustomColorPartForMaterial("Body", "F00_008_01_Bottoms_01_CLOTH")).toBe("bottoms");
    expect(classifyVrmCustomColorPartForMaterial("Body", "Body_00_SKIN")).toBe("body");
    expect(classifyVrmCustomColorPartForMaterial("Body", "HairBack_00_HAIR")).toBe("hair");
    expect(classifyVrmCustomColorPart("Alicia_wear")).toBe("tops");
    expect(classifyVrmCustomColorPart("cloth")).toBe("tops");
    // "Hair_Top" must stay hair — a bare "top" substring cannot outrank the hair marker.
    expect(classifyVrmCustomColorPart("F00_Hair_Top")).toBe("hair");
    expect(classifyVrmCustomColorPart("Face_00")).toBe("face");
  });

  it("applyVrmCustomColors never repaints mannequin clay cached as an original", () => {
    const { vrm } = createMinimalVrm();
    const native = new THREE.Color("#c48a6a");
    const bodyMat = new THREE.MeshStandardMaterial({ color: native.clone() });
    addMesh(vrm.scene, "Body_Mesh", bodyMat);

    // Race we have to survive: mannequin painted clay gray, then a recolor pass cached that
    // gray as the material's "original".
    bodyMat.color.set(STUDIO_VRM_MANNEQUIN_COLOR_HEX);
    bodyMat.userData.__vrmCustomColorOriginal = new THREE.Color(STUDIO_VRM_MANNEQUIN_COLOR_HEX);
    bodyMat.userData.__vrmCustomColorApplied = true;

    // After a faithful restore to native albedo, clearing custom colors must not bring gray back.
    bodyMat.color.copy(native);
    applyVrmCustomColors(vrm, {});
    expect(`#${bodyMat.color.getHexString()}`).toBe("#c48a6a");
    expect(bodyMat.userData.__vrmCustomColorOriginal).toBeUndefined();
  });

  it("applyVrmCustomColors recolors only matching materials on a multi-material Body mesh", () => {
    const { vrm } = createMinimalVrm();
    const skin = new THREE.MeshStandardMaterial({
      name: "Body_00_SKIN",
      color: new THREE.Color("#ffccaa"),
    });
    const tops = new THREE.MeshStandardMaterial({
      name: "Tops_01_CLOTH",
      color: new THREE.Color("#ffffff"),
      map: new THREE.Texture(),
    });
    const bottoms = new THREE.MeshStandardMaterial({
      name: "Bottoms_01_CLOTH",
      color: new THREE.Color("#ffffff"),
      map: new THREE.Texture(),
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), [skin, tops, bottoms]);
    mesh.name = "Body";
    vrm.scene.add(mesh);

    applyVrmCustomColors(vrm, { tops: "#ff0000", bottoms: "#0000ff" });
    expect(`#${skin.color.getHexString()}`).toBe("#ffccaa");
    expect(`#${tops.color.getHexString()}`).toBe("#ff0000");
    expect(`#${bottoms.color.getHexString()}`).toBe("#0000ff");

    applyVrmCustomColors(vrm, {});
    expect(`#${tops.color.getHexString()}`).toBe("#ffffff");
    expect(`#${bottoms.color.getHexString()}`).toBe("#ffffff");
    expect(`#${skin.color.getHexString()}`).toBe("#ffccaa");
  });

  it("repairVrmTexturedNearBlackLitFactors restores white lit on textured clothes", () => {
    const { vrm } = createMinimalVrm();
    const tops = new THREE.MeshStandardMaterial({
      name: "Tops_01_CLOTH",
      color: new THREE.Color("#000000"),
      map: new THREE.Texture(),
    });
    addMesh(vrm.scene, "Body", tops);

    const fixed = repairVrmTexturedNearBlackLitFactors(vrm);
    expect(fixed).toBe(1);
    expect(`#${tops.color.getHexString()}`).toBe("#ffffff");
  });

  it("applyVrmCustomColors idle pass repairs textured near-black clothes on load", () => {
    const { vrm } = createMinimalVrm();
    const tops = new THREE.MeshStandardMaterial({
      name: "Tops_01_CLOTH",
      color: new THREE.Color("#000000"),
      map: new THREE.Texture(),
    });
    addMesh(vrm.scene, "Body", tops);

    applyVrmCustomColors(vrm, {});
    expect(`#${tops.color.getHexString()}`).toBe("#ffffff");
  });

  it("repairs an unrelated near-black slot while preserving an active custom color", () => {
    const { vrm } = createMinimalVrm();
    const tops = new THREE.MeshStandardMaterial({
      name: "Tops_01_CLOTH",
      color: new THREE.Color("#ffffff"),
      map: new THREE.Texture(),
    });
    const bottoms = new THREE.MeshStandardMaterial({
      name: "Bottoms_01_CLOTH",
      color: new THREE.Color("#000000"),
      map: new THREE.Texture(),
    });
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      [tops, bottoms],
    );
    mesh.name = "Body";
    vrm.scene.add(mesh);

    applyVrmCustomColors(vrm, { tops: "#ff3366" });

    expect(`#${tops.color.getHexString()}`).toBe("#ff3366");
    expect(tops.userData.__vrmCustomColorApplied).toBe(true);
    expect(`#${bottoms.color.getHexString()}`).toBe("#ffffff");
  });

  it("recolors a dark albedo texture and restores the native map on reset", () => {
    const { vrm } = createMinimalVrm();
    const nativePixels = new Uint8Array([
      0, 0, 0, 255,
      32, 32, 32, 255,
    ]);
    const nativeMap = new THREE.DataTexture(
      nativePixels,
      2,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    const bottoms = new THREE.MeshStandardMaterial({
      name: "Bottoms_01_CLOTH",
      color: new THREE.Color("#ffffff"),
      map: nativeMap,
    });
    addMesh(vrm.scene, "Body", bottoms);

    applyVrmCustomColors(vrm, { bottoms: "#22cc88" });

    expect(bottoms.map).not.toBe(nativeMap);
    expect(bottoms.map).toBeInstanceOf(THREE.DataTexture);
    expect(`#${bottoms.color.getHexString()}`).toBe("#ffffff");
    const generatedMap = bottoms.map as THREE.DataTexture;
    const generatedPixels = (generatedMap.image as { data: Uint8Array }).data;
    expect(generatedPixels[0]).toBeGreaterThan(0);
    expect(generatedPixels[1]).toBeGreaterThan(generatedPixels[0]!);
    expect(generatedPixels[2]).toBeGreaterThan(generatedPixels[0]!);
    expect(generatedPixels[3]).toBe(255);
    let disposed = false;
    generatedMap.addEventListener("dispose", () => {
      disposed = true;
    });

    applyVrmCustomColors(vrm, {});

    expect(bottoms.map).toBe(nativeMap);
    expect(`#${bottoms.color.getHexString()}`).toBe("#ffffff");
    expect(disposed).toBe(true);
  });
});
