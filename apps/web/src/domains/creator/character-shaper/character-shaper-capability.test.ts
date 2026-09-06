import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  CHARACTER_SEMANTIC_MORPH_LABELS,
  createCharacterCapabilityProfile,
  EMPTY_CHARACTER_CAPABILITY_PROFILE,
  evaluateCharacterSlotEntry,
} from "./character-shaper-capability";
import { findCharacterSlotEntry } from "./character-shaper-catalog";

import type { CharacterCapabilityProfile } from "./character-shaper-contract";
import type { VRM } from "@pixiv/three-vrm";

type MorphMesh = THREE.Mesh & { morphTargetDictionary?: Record<string, number>; morphTargetInfluences?: number[] };

function morphMesh(name: string, targets: readonly string[]): MorphMesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()) as MorphMesh;
  mesh.name = name;
  mesh.morphTargetDictionary = Object.fromEntries(targets.map((target, index) => [target, index]));
  mesh.morphTargetInfluences = targets.map(() => 0);
  return mesh;
}

function namedMesh(meshName: string, materialName: string): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial();
  material.name = materialName;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  mesh.name = meshName;
  return mesh;
}

function fakeVrm(options: {
  morphTargets?: readonly string[];
  expressions?: readonly string[];
  humanoid?: boolean;
  materials?: readonly [string, string][];
}): VRM {
  const scene = new THREE.Group();
  if (options.morphTargets) scene.add(morphMesh("Face", options.morphTargets));
  for (const [meshName, materialName] of options.materials ?? []) scene.add(namedMesh(meshName, materialName));
  const hips = new THREE.Object3D();
  const humanoid = options.humanoid
    ? { humanBones: { hips: { node: hips } }, getRawBoneNode: (name: string) => (name === "hips" ? hips : null), getNormalizedBoneNode: () => null }
    : undefined;
  const expressionManager = options.expressions
    ? { expressionMap: Object.fromEntries(options.expressions.map((name) => [name, { expressionName: name }])) }
    : undefined;
  return { scene, humanoid, expressionManager } as unknown as VRM;
}

const READY_INPUT = {
  status: "ready" as const,
  modelId: "sample",
  modelName: "샘플",
  wardrobeMetricsReady: true,
  originalHairMeshCount: 3,
  surfacePaintReady: true,
};

function profileWith(overrides: Partial<CharacterCapabilityProfile>): CharacterCapabilityProfile {
  return {
    ...EMPTY_CHARACTER_CAPABILITY_PROFILE,
    status: "ready",
    humanoid: true,
    propsReady: true,
    wardrobeMetricsReady: true,
    irisTintable: true,
    originalHairMeshCount: 1,
    expressions: ["happy", "aa", "ou", "blink"],
    semanticMorphs: {
      eyeSize: "native-morph",
      eyeSpacing: "adaptive-mesh",
      eyeTilt: "adaptive-mesh",
      irisSize: "native-morph",
      noseHeight: "adaptive-mesh",
      noseWidth: "adaptive-mesh",
      mouthWidth: "adaptive-mesh",
      lipFullness: "adaptive-mesh",
      earSize: "adaptive-mesh",
    },
    ...overrides,
  };
}

describe("createCharacterCapabilityProfile", () => {
  it("starts empty with every semantic morph unknown", () => {
    expect(EMPTY_CHARACTER_CAPABILITY_PROFILE.status).toBe("empty");
    expect(Object.values(EMPTY_CHARACTER_CAPABILITY_PROFILE.semanticMorphs)).toEqual(new Array(9).fill(null));
    expect(EMPTY_CHARACTER_CAPABILITY_PROFILE.expressions).toEqual([]);
    expect(Object.isFrozen(EMPTY_CHARACTER_CAPABILITY_PROFILE)).toBe(true);
    for (const label of Object.values(CHARACTER_SEMANTIC_MORPH_LABELS)) expect(label).toMatch(/[가-힣]/u);
  });

  it("keeps the status and model identity when no VRM is loaded", () => {
    const profile = createCharacterCapabilityProfile({ ...READY_INPUT, vrm: null, status: "loading" });
    expect(profile.status).toBe("loading");
    expect(profile.modelId).toBe("sample");
    expect(profile.modelName).toBe("샘플");
    expect(profile.humanoid).toBe(false);
    expect(profile.propsReady).toBe(false);
    expect(profile.irisTintable).toBe(false);
    expect(profile.wardrobeMetricsReady).toBe(false);
    expect(profile.originalHairMeshCount).toBe(3);
    expect(profile.surfacePaintReady).toBe(true);
  });

  it("inspects shape keys, expressions, costume meshes, humanoid bones and iris materials", () => {
    const vrm = fakeVrm({
      morphTargets: ["eyeSizeBig", "irisBig", "noseHigh", "blink_l"],
      expressions: ["happy", "aa", "blink"],
      humanoid: true,
      materials: [["Body", "Tops_01_CLOTH"], ["Body", "Shoes_01"], ["Face", "EyeIris_00_EYE"]],
    });
    const profile = createCharacterCapabilityProfile({ ...READY_INPUT, vrm });
    expect(profile.status).toBe("ready");
    // Exact shape keys win; the adaptive-mesh deformer fills the rest from the "Face" mesh.
    expect(profile.semanticMorphs.eyeSize).toBe("native-morph");
    expect(profile.semanticMorphs.irisSize).toBe("native-morph");
    expect(profile.semanticMorphs.noseHeight).toBe("native-morph");
    expect(profile.semanticMorphs.eyeSpacing).toBe("adaptive-mesh");
    for (const id of ["eyeSpacing", "eyeTilt", "noseWidth", "mouthWidth", "lipFullness", "earSize"] as const) {
      expect(profile.semanticMorphs[id], id).not.toBe("native-morph");
    }
    expect(profile.expressions).toEqual(["aa", "blink", "happy"]);
    expect([...profile.costumeSlots].sort()).toEqual(["shoes", "tops"]);
    expect(profile.humanoid).toBe(true);
    expect(profile.propsReady).toBe(true);
    expect(profile.irisTintable).toBe(true);
    expect(profile.wardrobeMetricsReady).toBe(true);
    expect(profile.originalHairMeshCount).toBe(3);
    expect(Object.isFrozen(profile)).toBe(true);
  });

  it("reports a model without humanoid bones, expressions or iris meshes honestly", () => {
    const profile = createCharacterCapabilityProfile({ ...READY_INPUT, vrm: fakeVrm({}), originalHairMeshCount: Number.NaN });
    expect(profile.humanoid).toBe(false);
    expect(profile.propsReady).toBe(false);
    expect(profile.expressions).toEqual([]);
    expect(profile.costumeSlots).toEqual([]);
    expect(profile.irisTintable).toBe(false);
    expect(Object.values(profile.semanticMorphs).every((provider) => provider === null)).toBe(true);
    expect(profile.originalHairMeshCount).toBe(0);
  });
});

describe("evaluateCharacterSlotEntry", () => {
  const eyes = findCharacterSlotEntry("eyes:romance-sparkle")!;
  const mouth = findCharacterSlotEntry("mouth:natural-smile")!;
  const iris = findCharacterSlotEntry("irises:blue")!;
  const hairOriginal = findCharacterSlotEntry("hair:original")!;
  const pose = findCharacterSlotEntry("pose:xp_run")!;
  const shirt = findCharacterSlotEntry("top:shirt")!;
  const glasses = findCharacterSlotEntry("accessory:glasses")!;
  const grin = findCharacterSlotEntry("expression:xf_grin")!;

  it("is unavailable while no model is ready, with a status-specific reason", () => {
    expect(evaluateCharacterSlotEntry(eyes, EMPTY_CHARACTER_CAPABILITY_PROFILE)).toEqual({ status: "unavailable", reason: "모델을 먼저 불러와 주세요.", missing: [] });
    expect(evaluateCharacterSlotEntry(eyes, profileWith({ status: "loading" })).reason).toBe("모델을 불러오는 중입니다.");
    expect(evaluateCharacterSlotEntry(eyes, profileWith({ status: "error" })).reason).toBe("모델을 불러오지 못했습니다.");
  });

  it("is partial when only some semantic morph ids exist and unavailable when none do", () => {
    const partial = evaluateCharacterSlotEntry(eyes, profileWith({ semanticMorphs: { ...profileWith({}).semanticMorphs, eyeSpacing: null, eyeTilt: null } }));
    expect(partial.status).toBe("partial");
    expect(partial.missing).toEqual(["eyeSpacing", "eyeTilt"]);
    expect(partial.reason).toBe("눈 간격·눈꼬리 조절은 이 모델에서 지원되지 않아 나머지만 적용됩니다.");

    const none = evaluateCharacterSlotEntry(eyes, profileWith({ semanticMorphs: EMPTY_CHARACTER_CAPABILITY_PROFILE.semanticMorphs }));
    expect(none.status).toBe("unavailable");
    expect(none.missing).toEqual(["eyeSize", "eyeSpacing", "eyeTilt"]);
    expect(none.reason).toBe("이 모델에는 눈 크기·눈 간격·눈꼬리 shape key와 적응형 얼굴 메시가 없어 적용할 수 없습니다.");
  });

  it("keeps a mouth entry partial when only its floor expression is missing", () => {
    const noHappy = evaluateCharacterSlotEntry(mouth, profileWith({ expressions: ["aa"] }));
    expect(noHappy.status).toBe("partial");
    expect(noHappy.missing).toEqual(["happy"]);
    expect(noHappy.reason).toContain("happy");
    const noExpressions = evaluateCharacterSlotEntry(mouth, profileWith({ expressions: [] }));
    expect(noExpressions.status).toBe("partial");
    expect(noExpressions.reason).toBe("happy 표정이 없어 입모양 morph만 적용됩니다.");
    const nothing = evaluateCharacterSlotEntry(mouth, profileWith({ expressions: [], semanticMorphs: EMPTY_CHARACTER_CAPABILITY_PROFILE.semanticMorphs }));
    expect(nothing.status).toBe("unavailable");
  });

  it("explains iris tint, original hair, humanoid, wardrobe and prop requirements in Korean", () => {
    expect(evaluateCharacterSlotEntry(iris, profileWith({ irisTintable: false }))).toEqual({
      status: "unavailable",
      reason: "이 모델에서 눈동자 메시를 찾지 못해 색을 입힐 수 없습니다.",
      missing: [],
    });
    expect(evaluateCharacterSlotEntry(hairOriginal, profileWith({ originalHairMeshCount: 0 })).reason).toBe("이 모델에서 원본 헤어 메시를 찾지 못했습니다.");
    expect(evaluateCharacterSlotEntry(pose, profileWith({ humanoid: false })).reason).toBe("humanoid 본이 없는 모델에는 포즈를 적용할 수 없습니다.");
    expect(evaluateCharacterSlotEntry(shirt, profileWith({ wardrobeMetricsReady: false })).reason).toBe("골격 치수를 아직 재지 못해 의상을 입힐 수 없습니다.");
    expect(evaluateCharacterSlotEntry(glasses, profileWith({ propsReady: false })).reason).toBe("소품을 붙일 humanoid 본을 찾지 못했습니다.");
    expect(evaluateCharacterSlotEntry(glasses, profileWith({})).status).toBe("available");
  });

  it("marks expression presets partial or unavailable by the names the model lacks", () => {
    const partial = evaluateCharacterSlotEntry(grin, profileWith({ expressions: ["happy"] }));
    expect(partial.status).toBe("partial");
    expect(partial.missing).toEqual(["blink", "aa"]);
    expect(partial.reason).toBe("blink·aa 표정이 없어 일부만 적용됩니다.");
    const none = evaluateCharacterSlotEntry(grin, profileWith({ expressions: ["sad"] }));
    expect(none.status).toBe("unavailable");
    expect(none.reason).toBe("이 모델에 happy·blink·aa 표정이 없어 적용할 수 없습니다.");
    expect(evaluateCharacterSlotEntry(grin, profileWith({ expressions: [] })).reason).toBe("이 모델에는 표정(expression) 데이터가 없습니다.");
    expect(evaluateCharacterSlotEntry(findCharacterSlotEntry("expression:xf_neutral")!, profileWith({ expressions: [] })).status).toBe("available");
  });
});
