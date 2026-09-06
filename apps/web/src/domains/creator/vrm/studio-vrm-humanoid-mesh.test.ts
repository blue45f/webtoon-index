import { describe, expect, it } from "vitest";

import {
  AVATAR_FORGE_HAIR_STYLE_OPTIONS,
  AVATAR_FORGE_PRESETS,
  buildAvatarForgeHairParts,
  createAvatarForgeState,
  sanitizeAvatarForgeState,
  type AvatarForgeState,
} from "./studio-vrm-avatar-forge";
import { classifyMeshName } from "./studio-vrm-costume";
import { STUDIO_VRM_EXPORT_EXPRESSION_PRESETS } from "./studio-vrm-export-vrm-extension";
import { STUDIO_VRM_HAIR_ANCHOR_JOINT } from "./studio-vrm-hair-rig";
import {
  buildStudioVrmHumanoidMesh,
  STUDIO_VRM_HUMANOID_MORPH_TARGET_NAMES,
  studioVrmHeadSurfaceDepth,
  studioVrmTorsoSectionHeights,
  type StudioVrmHumanoidMeshPart,
} from "./studio-vrm-humanoid-mesh";
import {
  buildStudioVrmRig,
  STUDIO_VRM_RIG_PARENTS,
  studioVrmRigInverseBindMatrices,
  studioVrmRigStandingHeight,
  type StudioVrmRigBone,
} from "./studio-vrm-humanoid-rig";

const NEUTRAL = createAvatarForgeState();
/**
 * 조형 상태의 기본 헤어는 `none` 이다 — 오버레이가 "원본 머리를 그대로 둔다"는 뜻으로 쓰는
 * 값이라 그대로 두는 게 맞다. 생성 캐릭터에 머리가 붙는지 보려면 프리셋 상태를 써야 한다.
 */
const HAIRED = createAvatarForgeState("romance-long");

function numbers(source: ArrayLike<number> | undefined): number[] {
  return source === undefined ? [] : Array.from(source);
}

function allPrimitives(parts: readonly StudioVrmHumanoidMeshPart[]) {
  return parts.flatMap((part) => part.primitives);
}

describe("studio VRM humanoid rig", () => {
  it("parents every bone into an anatomical chain, with parents ahead of children", () => {
    const rig = buildStudioVrmRig({ proportions: NEUTRAL.proportions, face: NEUTRAL.face });
    const seen = new Set<StudioVrmRigBone>();
    for (const bone of rig.bones) {
      const parent = STUDIO_VRM_RIG_PARENTS[bone];
      if (parent !== null) {
        expect(seen.has(parent), `${bone} 의 부모 ${parent} 가 뒤에 온다`).toBe(true);
      }
      seen.add(bone);
    }
    // 평면 계층(전부 hips 직속)이면 무릎을 굽혀도 발이 따라오지 않는다 — 회귀 방지.
    expect(STUDIO_VRM_RIG_PARENTS.leftFoot).toBe("leftLowerLeg");
    expect(STUDIO_VRM_RIG_PARENTS.leftHand).toBe("leftLowerArm");
    expect(STUDIO_VRM_RIG_PARENTS.head).toBe("spine");
  });

  it("keeps world rest equal to the accumulated local chain", () => {
    const rig = buildStudioVrmRig({ proportions: NEUTRAL.proportions, face: NEUTRAL.face });
    for (const bone of rig.bones) {
      const parent = STUDIO_VRM_RIG_PARENTS[bone];
      const base = parent === null ? [0, 0, 0] : rig.worldRest[parent];
      const local = rig.localTranslation[bone];
      for (let axis = 0; axis < 3; axis += 1) {
        expect(rig.worldRest[bone][axis]).toBeCloseTo(base[axis] + local[axis], 10);
      }
    }
  });

  it("puts the character's left on +X and the face on +Z, as VRM 1.0 requires", () => {
    const rig = buildStudioVrmRig({ proportions: NEUTRAL.proportions, face: NEUTRAL.face });
    expect(rig.worldRest.leftUpperArm[0]).toBeGreaterThan(0);
    expect(rig.worldRest.rightUpperArm[0]).toBeLessThan(0);
    expect(rig.worldRest.leftUpperLeg[0]).toBeGreaterThan(0);
    expect(rig.worldRest.rightUpperLeg[0]).toBeLessThan(0);
  });

  it("writes inverse bind matrices as the pure inverse translation of the rest pose", () => {
    const rig = buildStudioVrmRig({ proportions: NEUTRAL.proportions, face: NEUTRAL.face });
    const matrices = studioVrmRigInverseBindMatrices(rig);
    expect(matrices).toHaveLength(rig.bones.length * 16);
    rig.bones.forEach((bone, index) => {
      const block = matrices.slice(index * 16, index * 16 + 16);
      expect(block.slice(0, 12)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
      expect(block.slice(12)).toEqual([
        -rig.worldRest[bone][0],
        -rig.worldRest[bone][1],
        -rig.worldRest[bone][2],
        1,
      ]);
    });
  });

  it("keeps the soles on the ground whatever the leg length, and scales height with overallHeight", () => {
    for (const legLength of [0.6, 1, 1.5]) {
      const rig = buildStudioVrmRig({
        proportions: { ...NEUTRAL.proportions, legLength },
      });
      expect(rig.worldRest.leftFoot[1]).toBeGreaterThan(0);
      expect(rig.worldRest.leftFoot[1]).toBeCloseTo(0.09, 2);
    }
    const short = studioVrmRigStandingHeight(buildStudioVrmRig({
      proportions: { ...NEUTRAL.proportions, overallHeight: 0.8 },
    }));
    const tall = studioVrmRigStandingHeight(buildStudioVrmRig({
      proportions: { ...NEUTRAL.proportions, overallHeight: 1.3 },
    }));
    expect(tall).toBeGreaterThan(short * 1.5);
  });

  it("reports a height scale that leg length cannot contaminate", () => {
    // 골반은 다리를 늘려도 발바닥이 지면에 남도록 보정된다. 그 높이로 배율을 유추하면
    // legLength 1.55 에서 1.50 이 나와 몸통·팔다리·의상이 50% 부푼다.
    for (const legLength of [0.55, 1, 1.55]) {
      const rig = buildStudioVrmRig({ proportions: { ...NEUTRAL.proportions, legLength } });
      expect(rig.heightScale, `legLength ${legLength}`).toBeCloseTo(1, 10);
      expect(rig.worldRest.hips[1] / 0.95).not.toBeCloseTo(legLength === 1 ? 0 : 1, 2);
    }
    for (const overallHeight of [0.8, 1.3]) {
      const rig = buildStudioVrmRig({ proportions: { ...NEUTRAL.proportions, overallHeight } });
      expect(rig.heightScale).toBeCloseTo(overallHeight, 10);
    }
  });

  it("keeps any scale a bone with children carries strictly uniform, so nothing inherits a shear", () => {
    // 전단은 **비균등** 스케일 아래에서 자식이 회전할 때 생긴다. 그래서 규약은 두 갈래다:
    // 비균등 조형 스케일(얼굴 비율)은 말단에만, 자식을 이고 있는 본은 균등만.
    const rig = buildStudioVrmRig({
      proportions: { ...NEUTRAL.proportions, handScale: 1.4, footScale: 0.7 },
      face: { ...NEUTRAL.face, headWidth: 1.3, headHeight: 0.8 },
    });
    const parents = new Set(
      rig.bones.map((bone) => STUDIO_VRM_RIG_PARENTS[bone]).filter((bone) => bone !== null),
    );
    let nonUniformLeaves = 0;
    for (const bone of Object.keys(rig.nodeScale) as StudioVrmRigBone[]) {
      const scale = rig.nodeScale[bone];
      if (!scale) continue;
      const uniformScale = scale[0] === scale[1] && scale[1] === scale[2];
      if (parents.has(bone)) {
        expect(uniformScale, `${bone} 은 자식을 이고 있는데 스케일이 비균등이다`).toBe(true);
      } else if (!uniformScale) {
        nonUniformLeaves += 1;
      }
    }
    // 얼굴 조형이 실제로 비균등으로 실려 있어야 이 테스트가 의미가 있다.
    expect(nonUniformLeaves).toBeGreaterThan(0);
  });

  it("flattens fingers along the palm normal, not across the palm", () => {
    // 고리 기저를 손바닥 법선이 아니라 이웃 방향에서 세우면 손가락이 좌우로 좁아진다 —
    // 너클 간격은 서로 닿도록 잡아 두었는데 그만큼 틈이 벌어지고, 단면도 세로로 선 모양이 된다.
    const rig = buildStudioVrmRig({ proportions: NEUTRAL.proportions, face: NEUTRAL.face });
    const mesh = buildStudioVrmHumanoidMesh(NEUTRAL);
    const body = mesh.parts.find((part) => part.nodeName === "Body");
    if (!body) throw new Error("expected a body part");
    const primitive = body.primitives[0];
    const joints = primitive.joints ?? [];
    const weights = primitive.weights ?? [];
    const extentsOf = (bone: StudioVrmRigBone) => {
      const index = rig.jointIndex[bone];
      let minY = Infinity;
      let maxY = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let vertex = 0; vertex < primitive.positions.length / 3; vertex += 1) {
        let weight = 0;
        for (let slot = 0; slot < 4; slot += 1) {
          if ((joints[vertex * 4 + slot] ?? -1) === index) weight += weights[vertex * 4 + slot] ?? 0;
        }
        if (weight < 0.4) continue;
        minY = Math.min(minY, primitive.positions[vertex * 3 + 1]);
        maxY = Math.max(maxY, primitive.positions[vertex * 3 + 1]);
        minZ = Math.min(minZ, primitive.positions[vertex * 3 + 2]);
        maxZ = Math.max(maxZ, primitive.positions[vertex * 3 + 2]);
      }
      return { height: maxY - minY, width: maxZ - minZ, minZ, maxZ };
    };

    const middle = extentsOf("leftMiddleIntermediate");
    expect(middle.height).toBeGreaterThan(0);
    // 손가락은 위아래로 납작하다 — 손바닥 법선 방향이 좁고, 손바닥을 가로지르는 방향이 넓다.
    expect(middle.height / middle.width, "손가락이 손바닥을 가로질러 눌렸다").toBeLessThan(1);

    // 그리고 이웃 손가락이 서로 닿을 만큼 붙어 있다.
    const index = extentsOf("leftIndexIntermediate");
    expect(index.minZ - middle.maxZ, "이웃 손가락 사이가 벌어졌다").toBeLessThan(0.005);
  });

  it("gives every finger its own UV lane so painting one does not paint the rest", () => {
    // Body 는 머티리얼이 하나뿐이라 UV 가 겹치면 표면 페인팅이 같은 텍셀을 공유한다. 손가락이
    // 없던 시절의 사각형 하나를 다섯 손가락이 그대로 나눠 쓰면, 검지에 칠한 획이 중지·약지·
    // 새끼·엄지에 그대로 복제된다.
    const rig = buildStudioVrmRig({ proportions: NEUTRAL.proportions, face: NEUTRAL.face });
    const mesh = buildStudioVrmHumanoidMesh(NEUTRAL);
    const body = mesh.parts.find((part) => part.nodeName === "Body");
    if (!body) throw new Error("expected a body part");
    const primitive = body.primitives[0];
    const joints = numbers(primitive.joints as readonly number[] | undefined);
    const weights = numbers(primitive.weights);
    const uvs = numbers(primitive.uvs);
    expect(uvs.length).toBeGreaterThan(0);

    const uSpan = (bones: readonly StudioVrmRigBone[]) => {
      const indices = new Set(bones.map((bone) => rig.jointIndex[bone]));
      let min = Infinity;
      let max = -Infinity;
      for (let vertex = 0; vertex * 3 < primitive.positions.length; vertex += 1) {
        let weight = 0;
        for (let slot = 0; slot < 4; slot += 1) {
          if (indices.has(joints[vertex * 4 + slot] ?? -1)) weight += weights[vertex * 4 + slot] ?? 0;
        }
        // 손가락 마디에만 온전히 실린 정점만 본다 — 너클 혼합 고리는 손바닥과 공유한다.
        if (weight < 0.999) continue;
        min = Math.min(min, uvs[vertex * 2]);
        max = Math.max(max, uvs[vertex * 2]);
      }
      return { min, max };
    };

    const lanes = (["left", "right"] as const).flatMap((prefix) =>
      (
        [
          [`${prefix}IndexProximal`, `${prefix}IndexIntermediate`, `${prefix}IndexDistal`],
          [`${prefix}MiddleProximal`, `${prefix}MiddleIntermediate`, `${prefix}MiddleDistal`],
          [`${prefix}RingProximal`, `${prefix}RingIntermediate`, `${prefix}RingDistal`],
          [`${prefix}LittleProximal`, `${prefix}LittleIntermediate`, `${prefix}LittleDistal`],
          [`${prefix}ThumbMetacarpal`, `${prefix}ThumbProximal`, `${prefix}ThumbDistal`],
        ] as unknown as readonly (readonly StudioVrmRigBone[])[]
      ).map((bones) => ({ name: bones[0], span: uSpan(bones) })),
    );
    expect(lanes).toHaveLength(10);

    for (const lane of lanes) {
      expect(Number.isFinite(lane.span.min), `${lane.name} 에 실린 정점이 없다`).toBe(true);
      expect(lane.span.max, `${lane.name} 레인이 비어 있다`).toBeGreaterThan(lane.span.min);
    }
    // 열 개 레인이 서로 겹치지 않아야 한다.
    for (let a = 0; a < lanes.length; a += 1) {
      for (let b = a + 1; b < lanes.length; b += 1) {
        const overlap =
          Math.min(lanes[a].span.max, lanes[b].span.max) -
          Math.max(lanes[a].span.min, lanes[b].span.min);
        expect(overlap, `${lanes[a].name} 과 ${lanes[b].name} 의 UV 가 겹친다`).toBeLessThanOrEqual(0);
      }
    }
    // 그리고 다른 파트의 사각형을 침범하면 안 된다 — 손가락 블록은 v 0.41~0.69 이다.
    for (let vertex = 0; vertex * 3 < primitive.positions.length; vertex += 1) {
      const u = uvs[vertex * 2];
      const v = uvs[vertex * 2 + 1];
      expect(u, "UV 가 0~1 밖으로 나갔다").toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("places finger joints under the hand and lets the hand scale carry them", () => {
    // 손 노드에는 균등 `handScale` 이 붙어 있고 손가락은 그 자식이다. 월드 rest 누적이 조상
    // 스케일을 반영하지 않으면 IBM(이동만 담는다)이 가리키는 위치와 씬 그래프가 놓는 위치가
    // 어긋나 손가락이 통째로 날아간다.
    const neutral = buildStudioVrmRig({ proportions: NEUTRAL.proportions, face: NEUTRAL.face });
    const scaled = buildStudioVrmRig({
      proportions: { ...NEUTRAL.proportions, handScale: 1.5 },
      face: NEUTRAL.face,
    });
    for (const prefix of ["left", "right"] as const) {
      const hand = `${prefix}Hand` as StudioVrmRigBone;
      const tip = `${prefix}MiddleDistal` as StudioVrmRigBone;
      expect(STUDIO_VRM_RIG_PARENTS[`${prefix}MiddleProximal` as StudioVrmRigBone]).toBe(hand);
      const neutralReach = Math.abs(neutral.worldRest[tip][0] - neutral.worldRest[hand][0]);
      const scaledReach = Math.abs(scaled.worldRest[tip][0] - scaled.worldRest[hand][0]);
      expect(neutralReach).toBeGreaterThan(0);
      expect(scaledReach / neutralReach, `${prefix} 손가락이 손 스케일을 따라가지 않았다`).toBeCloseTo(
        1.5,
        9,
      );
    }
  });
});

describe("studio VRM humanoid mesh", () => {
  const mesh = buildStudioVrmHumanoidMesh(NEUTRAL);

  it("emits consistent, in-range vertex attributes for every primitive", () => {
    const jointCount = mesh.rig.bones.length;
    for (const primitive of allPrimitives(mesh.parts)) {
      const positions = numbers(primitive.positions);
      const count = positions.length / 3;
      expect(count).toBeGreaterThan(0);
      expect(numbers(primitive.normals)).toHaveLength(count * 3);
      expect(numbers(primitive.uvs)).toHaveLength(count * 2);
      expect(numbers(primitive.joints as readonly number[])).toHaveLength(count * 4);
      expect(numbers(primitive.weights)).toHaveLength(count * 4);

      for (const joint of numbers(primitive.joints as readonly number[])) {
        expect(joint).toBeGreaterThanOrEqual(0);
        expect(joint).toBeLessThan(jointCount);
      }
      for (const index of numbers(primitive.indices as readonly number[])) {
        expect(index).toBeLessThan(count);
      }
    }
  });

  it("normalises skin weights and keeps normals unit length", () => {
    for (const primitive of allPrimitives(mesh.parts)) {
      const weights = numbers(primitive.weights);
      for (let vertex = 0; vertex * 4 < weights.length; vertex += 1) {
        const sum = weights.slice(vertex * 4, vertex * 4 + 4).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1, 5);
      }
      const normals = numbers(primitive.normals);
      for (let vertex = 0; vertex * 3 < normals.length; vertex += 1) {
        const [x, y, z] = normals.slice(vertex * 3, vertex * 3 + 3);
        expect(Math.hypot(x, y, z)).toBeCloseTo(1, 4);
      }
    }
  });

  it("stands on the ground plane and reaches the expected height", () => {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const primitive of allPrimitives(mesh.parts)) {
      const positions = numbers(primitive.positions);
      for (let index = 1; index < positions.length; index += 3) {
        minY = Math.min(minY, positions[index]);
        maxY = Math.max(maxY, positions[index]);
      }
    }
    expect(minY).toBeGreaterThanOrEqual(mesh.rig.groundY - 1e-6);
    expect(minY).toBeLessThan(0.01);
    expect(maxY).toBeGreaterThan(1.4);
    expect(maxY).toBeLessThan(1.9);
  });

  it("keeps body width independent of leg length", () => {
    const widthOf = (legLength: number) => {
      const built = buildStudioVrmHumanoidMesh({
        ...NEUTRAL,
        proportions: { ...NEUTRAL.proportions, legLength },
      });
      const positions = numbers(built.parts[0].primitives[0].positions);
      let maxX = 0;
      for (let index = 0; index < positions.length; index += 3) {
        maxX = Math.max(maxX, Math.abs(positions[index]));
      }
      return maxX;
    };
    // 팔 끝까지의 폭은 팔 길이가 정한다 — 다리 길이가 바꾸면 안 된다.
    expect(widthOf(1.55)).toBeCloseTo(widthOf(1), 6);
    expect(widthOf(0.55)).toBeCloseTo(widthOf(1), 6);
  });

  it("keeps scaled feet standing on the ground plane", () => {
    const posedSoleFor = (footScale: number) => {
      const built = buildStudioVrmHumanoidMesh({
        ...NEUTRAL,
        proportions: { ...NEUTRAL.proportions, footScale },
      });
      const ankleY = built.rig.worldRest.leftFoot[1];
      const scale = built.rig.nodeScale.leftFoot?.[1] ?? 1;
      let lowest = Infinity;
      for (const part of built.parts) {
        if (part.nodeName !== "Body" && part.nodeName !== "Shoes") continue;
        for (const primitive of part.primitives) {
          const positions = numbers(primitive.positions);
          for (let index = 1; index < positions.length; index += 3) {
            lowest = Math.min(lowest, positions[index]);
          }
        }
      }
      // 발 노드의 균등 스케일은 발목을 원점으로 걸린다 — 그 변환을 거친 뒤의 밑창 높이.
      return { posed: ankleY + (lowest - ankleY) * scale, ground: built.rig.groundY };
    };

    for (const footScale of [0.6, 1, 1.6]) {
      const { posed, ground } = posedSoleFor(footScale);
      expect(posed, `footScale ${footScale}`).toBeCloseTo(ground, 6);
    }
  });

  it("carries the forge hair shine into the exported hair material", () => {
    const glossy = buildStudioVrmHumanoidMesh({
      ...HAIRED,
      hair: { ...HAIRED.hair, shine: 0.9 },
    }).materials.find((material) => material.name === "Hair");
    const matte = buildStudioVrmHumanoidMesh({
      ...HAIRED,
      hair: { ...HAIRED.hair, shine: 0.05 },
    }).materials.find((material) => material.name === "Hair");
    expect(glossy?.roughnessFactor).toBeLessThan(matte?.roughnessFactor ?? 0);
  });

  it("names parts and materials so the wardrobe and hair systems classify them", () => {
    const byNode = new Map(buildStudioVrmHumanoidMesh(HAIRED).parts.map((part) => [part.nodeName, part]));
    expect([...byNode.keys()]).toEqual(
      expect.arrayContaining(["Body", "Face", "Hair", "Tops", "Bottoms", "Shoes"]),
    );
    // 피부·얼굴·머리는 의상 토글에서 보호돼야 하고, 옷은 슬롯으로 잡혀야 한다.
    expect(classifyMeshName("Body_Skin").protected).not.toBeNull();
    expect(classifyMeshName("Hair").protected).toBe("hair");
    expect(classifyMeshName("Tops").slot).toBe("tops");
    expect(classifyMeshName("Bottoms").slot).toBe("bottoms");
    expect(classifyMeshName("Shoes").slot).toBe("shoes");
    for (const material of mesh.materials.filter((m) => m.name?.startsWith("Face_"))) {
      expect(classifyMeshName(material.name).protected).not.toBeNull();
    }
  });

  it("gives every face primitive the same morph targets, named after VRM expression presets", () => {
    const face = mesh.parts[mesh.facePartIndex];
    expect(face.nodeName).toBe("Face");
    for (const primitive of face.primitives) {
      const targets = primitive.targets ?? [];
      expect(targets.map((target) => target.name)).toEqual([
        ...STUDIO_VRM_HUMANOID_MORPH_TARGET_NAMES,
      ]);
      const vertexCount = numbers(primitive.positions).length / 3;
      for (const target of targets) {
        expect(numbers(target.positions)).toHaveLength(vertexCount * 3);
      }
    }
    for (const name of STUDIO_VRM_HUMANOID_MORPH_TARGET_NAMES) {
      expect(STUDIO_VRM_EXPORT_EXPRESSION_PRESETS).toContain(name);
    }
    // 표정을 담지 않는 파트에 타깃이 섞이면 glTF 의 메시별 타깃 수 규칙이 깨진다.
    for (const part of mesh.parts.filter((candidate) => candidate.nodeName !== "Face")) {
      for (const primitive of part.primitives) expect(primitive.targets).toBeUndefined();
    }
  });

  it("moves the eyes for blink and the mouth for aa, and leaves brows alone on blink", () => {
    const face = mesh.parts[mesh.facePartIndex];
    const magnitude = (materialName: string, target: string) => {
      const index = mesh.materials.findIndex((material) => material.name === materialName);
      const primitive = face.primitives.find((candidate) => candidate.material === index);
      const found = primitive?.targets?.find((candidate) => candidate.name === target);
      return numbers(found?.positions).reduce((total, value) => total + Math.abs(value), 0);
    };
    expect(magnitude("Face_EyeWhite", "blink")).toBeGreaterThan(0);
    expect(magnitude("Face_Iris", "blink")).toBeGreaterThan(0);
    expect(magnitude("Face_Mouth", "blink")).toBe(0);
    expect(magnitude("Face_Mouth", "aa")).toBeGreaterThan(0);
    expect(magnitude("Face_EyeWhite", "aa")).toBe(0);
    // blinkLeft 는 blink 의 절반만 움직인다(한쪽 눈).
    expect(magnitude("Face_EyeWhite", "blinkLeft")).toBeCloseTo(
      magnitude("Face_EyeWhite", "blink") / 2,
      4,
    );
  });

  it("is deterministic and responds to the forge parameters", () => {
    const again = buildStudioVrmHumanoidMesh(createAvatarForgeState());
    expect(numbers(again.parts[0].primitives[0].positions)).toEqual(
      numbers(mesh.parts[0].primitives[0].positions),
    );

    const tall: AvatarForgeState = {
      ...NEUTRAL,
      proportions: { ...NEUTRAL.proportions, legLength: 1.4 },
    };
    expect(numbers(buildStudioVrmHumanoidMesh(tall).parts[0].primitives[0].positions)).not.toEqual(
      numbers(mesh.parts[0].primitives[0].positions),
    );
  });

  it("drops the hair part when the style is none, and keeps it for every shipped preset", () => {
    // 기본 상태가 곧 style "none" 이다.
    expect(NEUTRAL.hair.style).toBe("none");
    expect(mesh.parts.some((part) => part.nodeName === "Hair")).toBe(false);

    for (const preset of AVATAR_FORGE_PRESETS) {
      const built = buildStudioVrmHumanoidMesh(preset.state);
      expect(built.parts.some((part) => part.nodeName === "Hair"), preset.id).toBe(true);
    }
  });

  it("keeps hair on the skull instead of burying it or floating it above the crown", () => {
    const haired = buildStudioVrmHumanoidMesh(HAIRED);
    const hairPart = haired.parts.find((part) => part.nodeName === "Hair");
    if (!hairPart) throw new Error("expected hair");
    const head = haired.rig.head;
    const positions = numbers(hairPart.primitives[0].positions);
    let maxY = -Infinity;
    for (let index = 1; index < positions.length; index += 3) maxY = Math.max(maxY, positions[index]);
    // 정수리 위로 솟지 않는다(가닥 뿌리 앵커링). 두께만큼의 여유는 둔다.
    expect(maxY).toBeLessThan(head.center[1] + head.radiusY * 1.35);
    expect(maxY).toBeGreaterThan(head.center[1] + head.radiusY * 0.6);
  });

  it("stacks the torso cross-sections strictly upwards for every body proportion", () => {
    // 목 단면을 머리 관절 기준 고정 오프셋으로 잡던 시절, 머리·어깨 관절 간격이
    // `0.1088·neckLength − 0.0188·torsoLength` 배(키 기준)라서 목을 짧게 잡으면 목 밑동이
    // 어깨 위 단면보다 아래로 내려갔다(중립 1.315 < 1.34, 몸통 1.35·목 0.3 은 1.358 < 1.466).
    // 단면이 역행하면 로프트가 되접혀 목 밑동에 아래를 보는 깔때기가 생긴다.
    const limits = { torsoLength: [0.7, 1, 1.35], neckLength: [0.3, 1, 1.8], overallHeight: [0.55, 1, 1.6] };
    for (const torsoLength of limits.torsoLength) {
      for (const neckLength of limits.neckLength) {
        for (const overallHeight of limits.overallHeight) {
          const rig = buildStudioVrmRig({
            proportions: { ...NEUTRAL.proportions, torsoLength, neckLength, overallHeight },
            face: NEUTRAL.face,
          });
          const heights = studioVrmTorsoSectionHeights(rig);
          const label = `torso ${torsoLength} · neck ${neckLength} · height ${overallHeight}`;
          for (let index = 1; index < heights.length; index += 1) {
            expect(heights[index], `${label} @ ${index}`).toBeGreaterThan(heights[index - 1]);
          }
          // 위로 밀린 목 상단은 두개골 안에 묻혀야 한다. 정수리를 뚫으면 실루엣에 나온다.
          expect(heights[heights.length - 1], label).toBeLessThan(
            rig.head.center[1] + rig.head.radiusY,
          );
        }
      }
    }
  });

  it("lays every facial feature on the sculpted skull instead of floating it in front", () => {
    // 이목구비를 변형 **전** 타원체에 투영하면 턱(최대 42% 수축)과 애니메 평면(13% 압축)만큼
    // 살갗에서 떠 버린다 — 기본 조형에서 입 1.82cm, 눈 1.32cm 가 공중에 있었다.
    // 피처마다 앞뒤 순서를 정하는 outset(최대 0.05·radiusX)만큼만 앞에 있어야 한다.
    for (const face of [
      NEUTRAL.face,
      { ...NEUTRAL.face, chinLength: 1.25, cheekVolume: 0 },
      { ...NEUTRAL.face, chinLength: 0.8, cheekVolume: 1 },
    ]) {
      const state: AvatarForgeState = { ...NEUTRAL, face };
      const built = buildStudioVrmHumanoidMesh(state);
      const head = built.rig.head;
      const budget = head.radiusX * 0.05 + 1e-9;
      let worst = 0;
      for (const primitive of built.parts[built.facePartIndex].primitives) {
        const positions = numbers(primitive.positions);
        for (let index = 0; index < positions.length; index += 3) {
          const gap = positions[index + 2]
            - head.center[2]
            - studioVrmHeadSurfaceDepth(
              built.rig,
              state,
              positions[index] - head.center[0],
              positions[index + 1] - head.center[1],
            );
          expect(gap, `chin ${face.chinLength} cheek ${face.cheekVolume}`).toBeGreaterThan(0);
          worst = Math.max(worst, gap);
        }
      }
      expect(worst).toBeLessThanOrEqual(budget);
      // 실제로 띄우기는 한다 — 0 으로 눌러 z-fighting 을 만들지 않았는지 확인한다.
      expect(worst).toBeGreaterThan(head.radiusX * 0.02);
    }
  });

  it("keeps every shipped hairstyle's cap outside the skull instead of inside it", () => {
    // 캡 스케일은 두개골 반경의 배수(volume × 스타일 계수)로 들어온다. 그대로 쓰면 두께가
    // 아니라 포함 여부가 바뀌어, 21개 프리셋 중 5개는 캡이 통째로 두개골 안에 들어가
    // 정수리가 민머리로 보였고(pixie-sport 0.826배), 배수가 정확히 1인 9개는 표면과
    // 완전히 겹쳐 z-fighting 이 났다.
    let thinnest = Infinity;
    for (const preset of AVATAR_FORGE_PRESETS) {
      if (!buildAvatarForgeHairParts(preset.state).some((part) => part.role === "cap")) continue;
      const built = buildStudioVrmHumanoidMesh(preset.state);
      const hair = built.parts.find((part) => part.nodeName === "Hair");
      if (!hair) throw new Error(`expected hair for ${preset.id}`);
      const head = built.rig.head;
      // 캡은 두상 정수리를 덮으므로, 정수리 바로 위 정점이 반드시 두개골 밖에 있어야 한다.
      let crown = -Infinity;
      for (const primitive of hair.primitives) {
        const positions = numbers(primitive.positions);
        for (let index = 0; index < positions.length; index += 3) {
          const horizontal = Math.hypot(
            (positions[index] - head.center[0]) / head.radiusX,
            (positions[index + 2] - head.center[2]) / head.radiusZ,
          );
          if (horizontal > 0.2) continue;
          crown = Math.max(crown, (positions[index + 1] - head.center[1]) / head.radiusY);
        }
      }
      // 최소 껍질 두께(2.5%)만큼은 두개골 정수리 위로 올라와 있어야 겹치지 않는다.
      expect(crown, preset.id).toBeGreaterThan(1.025);
      thinnest = Math.min(thinnest, crown);
    }
    // 껍질이지 풍선이 아니다 — 가장 얇은 캡도 두개골의 1.2배를 넘지 않는다.
    expect(thinnest).toBeLessThan(1.2);
  });

  it("rigs every hanging hair part, not just the tapered strands", () => {
    // 처음에는 `tapered-capsule` 만 체인에 실었다. 그런데 롱헤어의 큰 뒷머리 시트는
    // `ellipsoid` 고(hime-noble 은 머리 관절 아래 0.43m 로 어느 가닥보다 깊다), 땋은 머리
    // 본체는 `sphere` 세그먼트 열이라, 정작 가장 크게 매달린 부분이 `head` 100% 로 남아
    // 고개를 돌릴 때 강체로 휩쓸렸다 — 이 리그가 없애려던 바로 그 동작이다.
    for (const preset of AVATAR_FORGE_PRESETS) {
      const built = buildStudioVrmHumanoidMesh(preset.state);
      const hairPart = built.parts.find((part) => part.nodeName === "Hair");
      if (!hairPart) continue;
      const headJoint = built.rig.jointIndex.head;
      const headY = built.rig.worldRest.head[1];
      const hanging = 0.12 * built.rig.heightScale;

      let headOnly = 0;
      for (const primitive of hairPart.primitives) {
        const positions = numbers(primitive.positions);
        const joints = numbers(primitive.joints);
        const weights = numbers(primitive.weights);
        for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
          if (headY - positions[vertex * 3 + 1] < hanging) continue;
          let headWeight = 0;
          for (let slot = 0; slot < 4; slot += 1) {
            if (joints[vertex * 4 + slot] === headJoint) headWeight += weights[vertex * 4 + slot];
          }
          if (headWeight > 0.99) headOnly += 1;
        }
      }
      expect(headOnly, `${preset.id}: 매달린 정점이 head 에만 묶여 있다`).toBe(0);
    }
  });

  it("leaves the skull cap and crown-mounted buns off the spring rig", () => {
    // 정수리에 얹힌 번은 흔들릴 이유가 없다 — 흔들리면 두피에서 떠 보인다.
    // (실측: 번은 머리 관절보다 위(−0.10m), 뒷머리 시트는 0.14~0.43m 아래.)
    for (const presetId of ["elegant-bun", "sakura-bun", "action-pony"]) {
      const state = createAvatarForgeState(presetId);
      const built = buildStudioVrmHumanoidMesh(state);
      const bindings = built.hairRig?.bindings;
      if (!bindings) throw new Error(`${presetId}: expected a hair rig`);
      const rig = built.rig;
      const scaleY = rig.head.radiusY / 0.46;

      // 흔들리지 않는 파츠도 바인딩은 갖는다 — 고정 앵커에 묶여야 역스케일 피벗 아래에
      // 모이고 머리 조형 스케일이 두 번 걸리지 않는다. "흔들리지 않는다"는
      // **앵커에 강체로 묶인다**는 뜻이다.
      const isAnchored = (partId: string): boolean => {
        const binding = bindings.get(partId);
        return binding?.kind === "rigid" && binding.jointOffset === STUDIO_VRM_HAIR_ANCHOR_JOINT;
      };

      for (const part of buildAvatarForgeHairParts(state)) {
        // 두피 껍질은 머리 그 자체다 — 절대 흔들리면 안 된다.
        if (part.role === "cap") {
          expect(isAnchored(part.id), `${presetId}: cap 이 스프링에 실렸다`).toBe(true);
          continue;
        }
        if (part.primitive === "tapered-capsule") continue;
        // 파츠 아래 끝이 머리 관절 위에 있으면 매달린 것이 아니다.
        const bottom =
          rig.head.center[1] + (part.position[1] - 0.18) * scaleY - Math.abs(part.scale[1]) * scaleY;
        if (bottom < rig.worldRest.head[1]) continue;
        expect(
          isAnchored(part.id),
          `${presetId}: ${part.id} 는 관절 위에 있는데 스프링에 실렸다`,
        ).toBe(true);
      }
    }
  });

  it("keeps spring parameters inside the exporter's valid ranges for every hairstyle", () => {
    // 익스포터는 `dragForce` 를 0~1 로, `stiffness`/`gravityPower`/`hitRadius` 를 음수 아님으로
    // 검증하고 벗어나면 throw 한다. 흔들림 세기를 체인 길이에서 뽑으므로, 길이 극단에서도
    // 식이 범위를 벗어나지 않는지 잠근다.
    const base = createAvatarForgeState();
    for (const style of AVATAR_FORGE_HAIR_STYLE_OPTIONS) {
      for (const extreme of [
        { headBodyRatio: 3.6, overallHeight: 0.55 },
        { headBodyRatio: 0.5, overallHeight: 1.6 },
      ]) {
        const state = sanitizeAvatarForgeState({
          ...base,
          proportions: { ...base.proportions, ...extreme },
          hair: { ...base.hair, style: style.id },
        });
        const hairRig = buildStudioVrmHumanoidMesh(state).hairRig;
        if (!hairRig) continue;
        const label = `${style.id} @ ${JSON.stringify(extreme)}`;
        for (const chain of hairRig.chains) {
          expect(chain.dragForce, label).toBeGreaterThanOrEqual(0);
          expect(chain.dragForce, label).toBeLessThanOrEqual(1);
          expect(chain.stiffness, label).toBeGreaterThanOrEqual(0);
          expect(chain.gravityPower, label).toBeGreaterThanOrEqual(0);
        }
        for (const joint of hairRig.joints) {
          expect(joint.hitRadius, `${label}: ${joint.name}`).toBeGreaterThan(0);
          expect(joint.worldRest.every(Number.isFinite), `${label}: ${joint.name}`).toBe(true);
          expect(
            joint.localTranslation.every(Number.isFinite),
            `${label}: ${joint.name}`,
          ).toBe(true);
        }
      }
    }
  });

  it("scales the hair with the head so a big-headed character is not swallowed by it", () => {
    // 두상 메시는 `head` 조인트에 묶여 런타임에 `T·S·T⁻¹` 로 커진다. 헤어는 전단을 피하려고
    // 역스케일 피벗 아래에 있어 그 스케일을 받지 않으므로, 저작 단계에서 미리 반영해야 한다.
    // 반영하지 않았을 때 두신비 2.5 에서 체인 묶임 정점의 67~100% 가 커진 두개골 속에
    // 파묻혔다(`elegant-bun` 100%).
    for (const preset of AVATAR_FORGE_PRESETS.slice(0, 8)) {
      const counts = [1, 2.5].map((headBodyRatio) => {
        const state = sanitizeAvatarForgeState({
          ...preset.state,
          proportions: { ...preset.state.proportions, headBodyRatio },
        });
        const built = buildStudioVrmHumanoidMesh(state);
        const hairPart = built.parts.find((part) => part.nodeName === "Hair");
        if (!hairPart) return null;
        const rig = built.rig;
        const scale = rig.nodeScale.head ?? [1, 1, 1];
        const joint = rig.worldRest.head;
        // 스케일이 적용된 두개골 타원체
        const center = [0, 1, 2].map(
          (axis) => joint[axis] + (rig.head.center[axis] - joint[axis]) * scale[axis],
        );
        const radii = [
          rig.head.radiusX * scale[0],
          rig.head.radiusY * scale[1],
          rig.head.radiusZ * scale[2],
        ];
        let inside = 0;
        let total = 0;
        for (const primitive of hairPart.primitives) {
          const positions = numbers(primitive.positions);
          for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
            total += 1;
            const normalized = Math.hypot(
              (positions[vertex * 3] - center[0]) / radii[0],
              (positions[vertex * 3 + 1] - center[1]) / radii[1],
              (positions[vertex * 3 + 2] - center[2]) / radii[2],
            );
            if (normalized < 1) inside += 1;
          }
        }
        return { inside, total };
      });
      if (counts[0] === null || counts[1] === null) continue;
      // 두개골 대비 헤어의 상대 배치가 두신비에 **불변**이어야 한다 = 함께 커진 것이다.
      expect(counts[1].total, preset.id).toBe(counts[0].total);
      expect(counts[1].inside, preset.id).toBe(counts[0].inside);
    }
  });

  it("bakes head shaping after the part rotation, exactly as the head node would", () => {
    // 파츠 스케일에 미리 곱해 넣으면 `R·S` 가 되는데, 두상 노드가 적용하던 변형은 `S·R` 이다.
    // 비가환이라 회전이 붙은 파츠(옆으로 쓸어넘긴 앞머리 등)에서 어긋난다 — 배포 프리셋에서
    // 0.2~1.9mm, 얼굴 비율 극단에서 4.7mm. 저작이 끝난 정점에 한 번에 얹어야 정확하다.
    for (const [presetId, face, headBodyRatio] of [
      ["pixie-sport", null, 1],
      ["wolf-rebel", null, 1],
      ["hime-noble", { headWidth: 1.6, headHeight: 0.6, headDepth: 1 }, 2.5],
      ["hime-noble", { headWidth: 0.6, headHeight: 1.6, headDepth: 1 }, 2.5],
    ] as const) {
      const preset = createAvatarForgeState(presetId);
      const shaped = sanitizeAvatarForgeState({
        ...preset,
        face: face ? { ...preset.face, ...face } : preset.face,
        proportions: { ...preset.proportions, headBodyRatio },
      });
      // 머리 스케일이 정확히 1 이 되도록 중립화한 기준 상태.
      const neutral = sanitizeAvatarForgeState({
        ...shaped,
        face: { ...shaped.face, headWidth: 1, headHeight: 1, headDepth: 1 },
        proportions: { ...shaped.proportions, headBodyRatio: 1 },
      });

      const actual = buildStudioVrmHumanoidMesh(shaped);
      const reference = buildStudioVrmHumanoidMesh(neutral);
      const scale = actual.rig.nodeScale.head ?? [1, 1, 1];
      const joint = actual.rig.worldRest.head;
      const actualHair = actual.parts.find((part) => part.nodeName === "Hair");
      const referenceHair = reference.parts.find((part) => part.nodeName === "Hair");
      if (!actualHair || !referenceHair) throw new Error(`${presetId}: expected hair`);

      const label = `${presetId} ${JSON.stringify(face)} @ ${headBodyRatio}`;
      for (let index = 0; index < actualHair.primitives.length; index += 1) {
        const got = numbers(actualHair.primitives[index].positions);
        const base = numbers(referenceHair.primitives[index].positions);
        expect(got.length, label).toBe(base.length);
        for (let offset = 0; offset < got.length; offset += 3) {
          for (let axis = 0; axis < 3; axis += 1) {
            const expected =
              joint[axis] + (base[offset + axis] - joint[axis]) * scale[axis];
            expect(got[offset + axis], `${label} @ ${offset / 3}`).toBeCloseTo(expected, 9);
          }
        }
      }
    }
  });

  it("derives collision radii from the chain's radial plane, not an unrelated axis", () => {
    // 체인은 가닥·덩어리·구슬 모두 로컬 Y 가 축이라 굵기는 X·Z 평면에서 정해진다.
    // 평균을 쓰면 가장 두꺼워진 축을 못 감싸고(깊이를 키우면 Z 가 뚫린다), 세 축 전체의
    // 최대를 쓰면 무관한 축이 새어 든다(높이만 키워도 반경이 커져 두피에서 밀려난다).
    // 기준은 머리 스케일이 정확히 1 인 상태여야 한다 — 배포 프리셋은 대부분 얼굴 비율이
    // 1 이 아니라 이미 한 번 shaping 을 거친다.
    const preset = createAvatarForgeState("hime-noble");
    const base = sanitizeAvatarForgeState({
      ...preset,
      face: { ...preset.face, headWidth: 1, headHeight: 1, headDepth: 1 },
      proportions: { ...preset.proportions, headBodyRatio: 1 },
    });
    const neutral = buildStudioVrmHumanoidMesh(base).hairRig;
    if (!neutral) throw new Error("expected a hair rig");

    for (const face of [
      { headWidth: 0.6, headHeight: 0.6, headDepth: 1.6 },
      { headWidth: 1.6, headHeight: 1.6, headDepth: 0.6 },
      // 높이만 키운 경우 — 가로 단면은 그대로이므로 반경도 그대로여야 한다.
      { headWidth: 1, headHeight: 1.6, headDepth: 1 },
    ]) {
      const state = sanitizeAvatarForgeState({ ...base, face: { ...base.face, ...face } });
      const built = buildStudioVrmHumanoidMesh(state);
      const shaped = built.hairRig;
      if (!shaped) throw new Error("expected a hair rig");
      const scale = built.rig.nodeScale.head ?? [1, 1, 1];
      const radial = Math.max(scale[0], scale[2]);

      expect(shaped.joints.length).toBe(neutral.joints.length);
      for (let index = 0; index < shaped.joints.length; index += 1) {
        const ratio = shaped.joints[index].hitRadius / neutral.joints[index].hitRadius;
        expect(ratio, `${JSON.stringify(face)} @ ${shaped.joints[index].name}`).toBeCloseTo(
          radial,
          9,
        );
      }
    }
  });

  it("retunes the springs from the shaped chain length, not the pre-scale one", () => {
    // 흔들림 세기는 체인 길이에서 뽑는다. 두신비를 키우면 같은 가닥이 실제로 길어지는데
    // (0.175m → 0.630m) 스케일 이전 길이로 굳혀 두면 60cm 머리카락이 17cm 용 튜닝
    // (거의 강체)으로 남는다.
    const base = createAvatarForgeState("natural-short");
    const longest = (headBodyRatio: number) => {
      const state = sanitizeAvatarForgeState({
        ...base,
        proportions: { ...base.proportions, headBodyRatio },
      });
      const hairRig = buildStudioVrmHumanoidMesh(state).hairRig;
      if (!hairRig) throw new Error("expected a hair rig");
      let best = hairRig.chains[0];
      let bestLength = 0;
      for (const chain of hairRig.chains) {
        let length = 0;
        for (let index = 1; index < chain.joints.length; index += 1) {
          const from = chain.joints[index - 1].worldRest;
          const to = chain.joints[index].worldRest;
          length += Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
        }
        if (length > bestLength) {
          bestLength = length;
          best = chain;
        }
      }
      return { chain: best, length: bestLength };
    };

    const small = longest(1);
    const big = longest(3.6);
    // 같은 가닥이 3.6배 길어진다.
    expect(big.length / small.length).toBeCloseTo(3.6, 1);
    // 짧을 때는 뻣뻣하고, 길어지면 느슨해져야 한다.
    expect(small.chain.stiffness).toBeGreaterThan(big.chain.stiffness);
    expect(small.chain.dragForce).toBeGreaterThan(big.chain.dragForce);
    expect(big.chain.gravityPower).toBeGreaterThan(small.chain.gravityPower);
  });

  it("never binds hair to a chain's first joint, which the spring runtime rotates", () => {
    // VRM 스프링에서 체인의 첫 항목은 "움직이지 않는 루트"가 아니다 — three-vrm 은
    // (본, 자식) 쌍마다 조인트를 만들어 첫 본의 회전도 시뮬레이션한다. 거기에 부착 링을
    // 실으면 링이 축을 중심으로 함께 돌아 두피에서 어긋난다(natural-short 60 정점).
    // 땋은 머리 프리셋을 반드시 포함한다 — 매듭은 blend 가 아니라 rigid 경로로 묶이므로
    // `hairChainSkin` 의 앵커 리다이렉트를 우회한다.
    for (const preset of [
      ...AVATAR_FORGE_PRESETS.slice(0, 6),
      ...AVATAR_FORGE_PRESETS.filter((entry) => entry.id.includes("braid")),
    ]) {
      const built = buildStudioVrmHumanoidMesh(preset.state);
      const hairPart = built.parts.find((part) => part.nodeName === "Hair");
      const hairRig = built.hairRig;
      if (!hairPart || !hairRig) continue;
      const jointBase = built.rig.bones.length;
      const chainRoots = new Set(hairRig.chains.map((chain) => jointBase + chain.jointOffset));

      let onChainRoot = 0;
      for (const primitive of hairPart.primitives) {
        const joints = numbers(primitive.joints);
        const weights = numbers(primitive.weights);
        for (let slot = 0; slot < joints.length; slot += 1) {
          if (weights[slot] > 0 && chainRoots.has(joints[slot])) onChainRoot += 1;
        }
      }
      expect(onChainRoot, `${preset.id}: 시뮬레이션되는 체인 첫 조인트에 정점이 실렸다`).toBe(0);
    }
  });

  it("anchors ponytail attachment spheres instead of turning them into blob chains", () => {
    // 낙차만 보고 분류하면 부착부가 걸린다 — `tailHeight 0` · `volume 1.45` 에서
    // `pony-root` 의 낙차가 0.063m 로 문턱 0.06m 를 겨우 넘겨, 매듭이 시트처럼 늘어졌다.
    const base = createAvatarForgeState("action-pony");
    for (const hair of [{}, { tailHeight: 0, volume: 1.45 }, { tailHeight: 0, volume: 1.5 }]) {
      const state = sanitizeAvatarForgeState({ ...base, hair: { ...base.hair, ...hair } });
      const hairRig = buildStudioVrmHumanoidMesh(state).hairRig;
      if (!hairRig) throw new Error("expected a hair rig");
      for (const part of buildAvatarForgeHairParts(state)) {
        if (!part.id.endsWith("-root") && !part.id.endsWith("-tie")) continue;
        const binding = hairRig.bindings.get(part.id);
        expect(binding?.kind, `${JSON.stringify(hair)}: ${part.id}`).toBe("rigid");
      }
    }
  });
});
