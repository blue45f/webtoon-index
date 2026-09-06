import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  buildStudioVrmGarmentGeometry,
  buildStudioVrmSkinnedGarment,
  disposeStudioVrmSkinnedGarment,
  planStudioVrmGarmentSkinInfluences,
  STUDIO_VRM_SKINNED_GARMENT_TRIANGLE_BUDGET,
  STUDIO_VRM_SKINNED_GARMENT_VERTEX_BUDGET,
  type StudioVrmGarmentSkinBone,
} from "./studio-vrm-skinned-garment";

import type { GarmentPart, GarmentShape } from "./studio-vrm-wardrobe";

function armRig() {
  const root = new THREE.Group();
  const upper = new THREE.Bone();
  const lower = new THREE.Bone();
  const hand = new THREE.Bone();
  upper.name = "leftUpperArm";
  lower.name = "leftLowerArm";
  hand.name = "leftHand";
  lower.position.x = 1;
  hand.position.x = 1;
  upper.add(lower);
  lower.add(hand);
  root.add(upper);
  root.updateMatrixWorld(true);
  const nodes = new Map<StudioVrmGarmentSkinBone, THREE.Object3D>([
    ["leftUpperArm", upper],
    ["leftLowerArm", lower],
    ["leftHand", hand],
  ]);
  return { root, upper, lower, hand, resolveBone: (name: StudioVrmGarmentSkinBone) => nodes.get(name) ?? null };
}

function upperBodyRig() {
  const root = new THREE.Group();
  const hips = new THREE.Bone();
  const spine = new THREE.Bone();
  const chest = new THREE.Bone();
  const leftUpper = new THREE.Bone();
  const leftLower = new THREE.Bone();
  const leftHand = new THREE.Bone();
  const rightUpper = new THREE.Bone();
  const rightLower = new THREE.Bone();
  const rightHand = new THREE.Bone();

  hips.name = "hips";
  spine.name = "spine";
  chest.name = "chest";
  leftUpper.name = "leftUpperArm";
  leftLower.name = "leftLowerArm";
  leftHand.name = "leftHand";
  rightUpper.name = "rightUpperArm";
  rightLower.name = "rightLowerArm";
  rightHand.name = "rightHand";

  spine.position.y = 0.8;
  chest.position.y = 0.55;
  leftUpper.position.set(0.48, 0.25, 0);
  leftLower.position.x = 0.65;
  leftHand.position.x = 0.55;
  rightUpper.position.set(-0.48, 0.25, 0);
  rightLower.position.x = -0.65;
  rightHand.position.x = -0.55;

  root.add(hips);
  hips.add(spine);
  spine.add(chest);
  chest.add(leftUpper, rightUpper);
  leftUpper.add(leftLower);
  leftLower.add(leftHand);
  rightUpper.add(rightLower);
  rightLower.add(rightHand);
  root.updateMatrixWorld(true);

  const nodes = new Map<StudioVrmGarmentSkinBone, THREE.Object3D>([
    ["hips", hips],
    ["spine", spine],
    ["chest", chest],
    ["leftUpperArm", leftUpper],
    ["leftLowerArm", leftLower],
    ["leftHand", leftHand],
    ["rightUpperArm", rightUpper],
    ["rightLowerArm", rightLower],
    ["rightHand", rightHand],
  ]);
  return { root, nodes, resolveBone: (name: StudioVrmGarmentSkinBone) => nodes.get(name) ?? null };
}

function lowerBodyRig() {
  const root = new THREE.Group();
  const hips = new THREE.Bone();
  const leftUpperLeg = new THREE.Bone();
  const rightUpperLeg = new THREE.Bone();
  hips.name = "hips";
  leftUpperLeg.name = "leftUpperLeg";
  rightUpperLeg.name = "rightUpperLeg";
  leftUpperLeg.position.set(0.2, -0.1, 0);
  rightUpperLeg.position.set(-0.2, -0.1, 0);
  root.add(hips);
  hips.add(leftUpperLeg, rightUpperLeg);
  root.updateMatrixWorld(true);
  const nodes = new Map<StudioVrmGarmentSkinBone, THREE.Object3D>([
    ["hips", hips],
    ["leftUpperLeg", leftUpperLeg],
    ["rightUpperLeg", rightUpperLeg],
  ]);
  return {
    root,
    resolveBone: (name: StudioVrmGarmentSkinBone) => nodes.get(name) ?? null,
  };
}

const UPPER_SLEEVE: GarmentPart = {
  bone: "leftUpperArm",
  shape: { kind: "cylinder", rTop: 0.16, rBottom: 0.14, h: 1, open: true },
  offset: [0.5, 0, 0],
  align: [1, 0, 0],
};

const UPPER_BODY_PARTS: readonly GarmentPart[] = [
  {
    bone: "spine",
    shape: {
      kind: "lathe",
      profile: [
        { radius: 0.4, y: -0.8 },
        { radius: 0.45, y: -0.25 },
        { radius: 0.5, y: 0.4 },
        { radius: 0.45, y: 0.8 },
      ],
      segments: 40,
    },
    offset: [0, 0, 0],
  },
  {
    bone: "leftUpperArm",
    shape: { kind: "cylinder", rTop: 0.15, rBottom: 0.17, h: 0.65, open: true },
    offset: [0.325, 0, 0],
    align: [1, 0, 0],
  },
  {
    bone: "leftLowerArm",
    shape: { kind: "cylinder", rTop: 0.12, rBottom: 0.15, h: 0.5, open: true },
    offset: [0.25, 0, 0],
    align: [1, 0, 0],
  },
  {
    bone: "rightUpperArm",
    shape: { kind: "cylinder", rTop: 0.15, rBottom: 0.17, h: 0.65, open: true },
    offset: [-0.325, 0, 0],
    align: [-1, 0, 0],
  },
  {
    bone: "rightLowerArm",
    shape: { kind: "cylinder", rTop: 0.12, rBottom: 0.15, h: 0.5, open: true },
    offset: [-0.25, 0, 0],
    align: [-1, 0, 0],
  },
] as const;

const DRAPED_SKIRT: GarmentPart = {
  bone: "hips",
  skinMode: "lower-body-drape",
  shape: {
    kind: "lathe",
    profile: [
      { radius: 0.55, y: -0.6 },
      { radius: 0.48, y: -0.2 },
      { radius: 0.36, y: 0.6 },
    ],
    segments: 40,
  },
  offset: [0, -0.5, 0],
};

const DRAPED_HEM: GarmentPart = {
  bone: "hips",
  skinMode: "lower-body-drape",
  shape: { kind: "torus", r: 0.55, tube: 0.02 },
  offset: [0, -1.1, 0],
};

function materials(count: number): THREE.MeshBasicMaterial[] {
  return Array.from({ length: count }, () => new THREE.MeshBasicMaterial());
}

function disposeMaterials(values: readonly THREE.Material[]): void {
  values.forEach((material) => material.dispose());
}

/** depth 실험용 몸통 프로파일. y가 모두 다르고 오름차순이라 링 순서가 프로파일 순서와 같다. */
const DEPTH_PROFILE: readonly { radius: number; y: number }[] = [
  { radius: 0.3, y: -0.4 },
  { radius: 0.26, y: -0.1 },
  { radius: 0.34, y: 0.25 },
  { radius: 0.28, y: 0.45 },
] as const;

function latheShape(
  profile: readonly { radius: number; y: number; depth?: number }[],
  segments?: number,
): GarmentShape {
  return { kind: "lathe", profile, segments };
}

function withDepths(depths: readonly number[]): { radius: number; y: number; depth: number }[] {
  return DEPTH_PROFILE.map((point, index) => ({ ...point, depth: depths[index] }));
}

/**
 * 같은 y를 공유하는 정점을 링으로 묶어 x·z 최대 반경을 잰다. segments가 4의 배수라
 * φ=0(=z축)과 φ=π/2(=x축) 정점이 정확히 축 위에 놓여 반경이 근사 없이 나온다.
 */
function latheRingExtents(geometry: THREE.BufferGeometry): { y: number; x: number; z: number }[] {
  const position = geometry.getAttribute("position");
  const byHeight = new Map<number, { y: number; x: number; z: number }>();
  for (let index = 0; index < position.count; index += 1) {
    const y = position.getY(index);
    const key = Math.round(y * 1e5);
    const ring = byHeight.get(key) ?? { y, x: 0, z: 0 };
    ring.x = Math.max(ring.x, Math.abs(position.getX(index)));
    ring.z = Math.max(ring.z, Math.abs(position.getZ(index)));
    byHeight.set(key, ring);
  }
  return [...byHeight.values()].sort((a, b) => a.y - b.y);
}

function expectNormalizedFiniteWeights(mesh: THREE.SkinnedMesh): void {
  const weights = mesh.geometry.getAttribute("skinWeight");
  for (let index = 0; index < weights.count; index += 1) {
    const values = [weights.getX(index), weights.getY(index), weights.getZ(index), weights.getW(index)];
    expect(values.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    expect(values.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 6);
  }
}

describe("Studio VRM skinned garment", () => {
  it("관절 끝으로 갈수록 다음 본의 웨이트를 부드럽게 섞는다", () => {
    const available = new Set<StudioVrmGarmentSkinBone>(["leftUpperArm", "leftLowerArm"]);
    expect(planStudioVrmGarmentSkinInfluences(UPPER_SLEEVE, -0.5, available)).toEqual([
      { bone: "leftUpperArm", weight: 1 },
    ]);

    const middle = planStudioVrmGarmentSkinInfluences(UPPER_SLEEVE, 0.25, available);
    expect(middle.map((entry) => entry.bone)).toEqual(["leftUpperArm", "leftLowerArm"]);
    expect(middle.reduce((sum, entry) => sum + entry.weight, 0)).toBeCloseTo(1, 8);
    expect(middle.every((entry) => entry.weight > 0)).toBe(true);

    expect(planStudioVrmGarmentSkinInfluences(UPPER_SLEEVE, 0.5, available)).toEqual([
      { bone: "leftLowerArm", weight: 1 },
    ]);
  });

  it("치마는 허리는 골반에 고정하고 밑단 좌우를 각 허벅지 본에 혼합한다", () => {
    const available = new Set<StudioVrmGarmentSkinBone>([
      "hips",
      "leftUpperLeg",
      "rightUpperLeg",
    ]);
    expect(planStudioVrmGarmentSkinInfluences(DRAPED_SKIRT, 0.6, available, 0.3)).toEqual([
      { bone: "hips", weight: 1 },
    ]);

    const leftHem = planStudioVrmGarmentSkinInfluences(DRAPED_SKIRT, -0.6, available, 0.3);
    const rightHem = planStudioVrmGarmentSkinInfluences(DRAPED_SKIRT, -0.6, available, -0.3);
    expect(leftHem).toEqual([
      { bone: "leftUpperLeg", weight: 0.72 },
      { bone: "hips", weight: 0.28 },
    ]);
    expect(rightHem).toEqual([
      { bone: "rightUpperLeg", weight: 0.72 },
      { bone: "hips", weight: 0.28 },
    ]);
    expect(planStudioVrmGarmentSkinInfluences(DRAPED_HEM, 0, available, 0.3)).toEqual([
      { bone: "leftUpperLeg", weight: 0.72 },
      { bone: "hips", weight: 0.28 },
    ]);

    const rig = lowerBodyRig();
    const itemMaterials = [
      new THREE.MeshStandardMaterial(),
      new THREE.MeshStandardMaterial(),
    ];
    const built = buildStudioVrmSkinnedGarment({
      name: "wardrobe:bottom:dress",
      root: rig.root,
      parts: [DRAPED_SKIRT, DRAPED_HEM],
      materials: itemMaterials,
      resolveBone: rig.resolveBone,
    });
    const surface = built.surface!;
    expect(surface.receipt).toEqual(expect.objectContaining({
      mode: "skinned-shell-v1",
      usedBones: ["hips", "leftUpperLeg", "rightUpperLeg"],
      boneCount: 3,
      unavailableReason: null,
    }));
    expect(surface.receipt.blendedVertexCount).toBeGreaterThan(0);
    expectNormalizedFiniteWeights(surface.mesh);

    const indices = surface.mesh.geometry.getAttribute("skinIndex");
    const weights = surface.mesh.geometry.getAttribute("skinWeight");
    const hasLegInfluence = (boneIndex: number) => Array.from(
      { length: indices.count },
      (_, vertex) => [
        [indices.getX(vertex), weights.getX(vertex)],
        [indices.getY(vertex), weights.getY(vertex)],
        [indices.getZ(vertex), weights.getZ(vertex)],
        [indices.getW(vertex), weights.getW(vertex)],
      ],
    ).some((slots) => slots.some(([index, weight]) => index === boneIndex && weight > 0.5));
    expect(hasLegInfluence(1)).toBe(true);
    expect(hasLegInfluence(2)).toBe(true);

    const hemGroup = surface.mesh.geometry.groups.find((group) => group.materialIndex === 1)!;
    const geometryIndex = surface.mesh.geometry.getIndex()!;
    const hemVertices = new Set<number>();
    for (let offset = hemGroup.start; offset < hemGroup.start + hemGroup.count; offset += 1) {
      hemVertices.add(geometryIndex.getX(offset));
    }
    expect(hemVertices.size).toBeGreaterThan(0);
    for (const vertex of hemVertices) {
      const slots = [
        [indices.getX(vertex), weights.getX(vertex)],
        [indices.getY(vertex), weights.getY(vertex)],
        [indices.getZ(vertex), weights.getZ(vertex)],
        [indices.getW(vertex), weights.getW(vertex)],
      ];
      const legWeight = slots.reduce(
        (total, [bone, weight]) => total + (bone === 1 || bone === 2 ? weight : 0),
        0,
      );
      expect(legWeight).toBeCloseTo(0.72, 5);
    }

    disposeStudioVrmSkinnedGarment(surface);
    disposeMaterials(itemMaterials);
  });

  it("일반 파츠도 indexed 단일 SkinnedMesh와 정규화된 웨이트로 합친다", () => {
    const rig = armRig();
    const material = new THREE.MeshStandardMaterial();
    const built = buildStudioVrmSkinnedGarment({
      name: "test-sleeve",
      root: rig.root,
      parts: [UPPER_SLEEVE],
      materials: [material],
      resolveBone: rig.resolveBone,
    });

    expect(built.surface).not.toBeNull();
    const surface = built.surface!;
    expect(surface.mesh.isSkinnedMesh).toBe(true);
    expect(surface.mesh.geometry.index).not.toBeNull();
    expect(surface.mesh.bindMode).toBe(THREE.AttachedBindMode);
    expect(surface.receipt).toEqual(expect.objectContaining({
      kind: "studio-vrm-skinned-garment-receipt",
      mode: "skinned-shell-v1",
      boneCount: 2,
      indexed: true,
      templateKind: "merged-parts-v1",
      unavailableReason: null,
    }));
    expect(surface.receipt.blendedVertexCount).toBeGreaterThan(0);
    expectNormalizedFiniteWeights(surface.mesh);

    disposeStudioVrmSkinnedGarment(surface);
    material.dispose();
  });

  it.each(["shirt", "blazer"] as const)("%s는 몸통과 양 소매가 하나로 연결된 indexed 상체 topology를 만든다", (itemId) => {
    const rig = upperBodyRig();
    const itemMaterials = materials(UPPER_BODY_PARTS.length);
    const built = buildStudioVrmSkinnedGarment({
      name: `wardrobe:${itemId === "shirt" ? "top" : "outer"}:${itemId}`,
      root: rig.root,
      parts: UPPER_BODY_PARTS,
      materials: itemMaterials,
      resolveBone: rig.resolveBone,
    });

    expect(built.surface).not.toBeNull();
    const surface = built.surface!;
    const index = surface.mesh.geometry.index!;
    const position = surface.mesh.geometry.getAttribute("position");
    const topology = surface.mesh.geometry.userData.studioVrmUpperBodyTopology as {
      torso: { start: number; count: number };
      leftSleeve: { start: number; count: number; anchor: number };
      rightSleeve: { start: number; count: number; anchor: number };
    };
    expect(index.count).toBe(surface.receipt.triangleCount * 3);
    expect(Array.from(index.array).every((value) => value >= 0 && value < position.count)).toBe(true);
    expect(topology.leftSleeve.anchor).toBeGreaterThanOrEqual(topology.torso.start);
    expect(topology.leftSleeve.anchor).toBeLessThan(topology.torso.start + topology.torso.count);
    expect(topology.rightSleeve.anchor).toBeGreaterThanOrEqual(topology.torso.start);
    expect(topology.rightSleeve.anchor).toBeLessThan(topology.torso.start + topology.torso.count);
    expect(surface.receipt).toEqual(expect.objectContaining({
      mode: "skinned-shell-v1",
      templateKind: "upper-body-v1",
      indexed: true,
      connectedComponentCount: 1,
      continuousSleeveCount: 2,
      unavailableReason: null,
    }));
    expectNormalizedFiniteWeights(surface.mesh);

    disposeStudioVrmSkinnedGarment(surface);
    disposeMaterials(itemMaterials);
  });

  it("현재 포즈와 변환된 root를 정확한 Attached bind pose로 사용한다", () => {
    const rig = armRig();
    rig.root.position.set(2, -1, 3);
    rig.root.rotation.set(0.2, -0.35, 0.1);
    rig.root.scale.set(1.2, 0.9, 1.1);
    rig.lower.rotation.z = 0.35;
    rig.root.updateMatrixWorld(true);
    const material = new THREE.MeshBasicMaterial();
    const built = buildStudioVrmSkinnedGarment({
      name: "current-pose-bind",
      root: rig.root,
      parts: [UPPER_SLEEVE],
      materials: [material],
      resolveBone: rig.resolveBone,
    });
    const surface = built.surface!;
    expect(surface.mesh.bindMode).toBe(THREE.AttachedBindMode);
    expect(surface.mesh.bindMatrix.equals(rig.root.matrixWorld)).toBe(true);

    const position = surface.mesh.geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 17) {
      const source = new THREE.Vector3().fromBufferAttribute(position, index);
      const deformed = surface.mesh.applyBoneTransform(index, source.clone());
      expect(deformed.distanceTo(source)).toBeLessThan(2e-4 * (1 + source.length()));
    }

    disposeStudioVrmSkinnedGarment(surface);
    material.dispose();
  });

  it("bind 이후 팔꿈치를 움직이면 혼합 웨이트 정점도 실제로 변형된다", () => {
    const rig = armRig();
    const material = new THREE.MeshBasicMaterial();
    const built = buildStudioVrmSkinnedGarment({
      name: "posed-sleeve",
      root: rig.root,
      parts: [UPPER_SLEEVE],
      materials: [material],
      resolveBone: rig.resolveBone,
    });
    const surface = built.surface!;
    const position = surface.mesh.geometry.getAttribute("position");
    const weights = surface.mesh.geometry.getAttribute("skinWeight");
    let candidate = -1;
    for (let index = 0; index < position.count; index += 1) {
      if (weights.getX(index) > 0.05 && weights.getY(index) > 0.05) {
        candidate = index;
        break;
      }
    }
    expect(candidate).toBeGreaterThanOrEqual(0);
    const before = surface.mesh.applyBoneTransform(
      candidate,
      new THREE.Vector3().fromBufferAttribute(position, candidate),
    ).clone();

    rig.lower.rotation.z = Math.PI / 2;
    rig.root.updateMatrixWorld(true);
    surface.mesh.skeleton.update();
    const after = surface.mesh.applyBoneTransform(
      candidate,
      new THREE.Vector3().fromBufferAttribute(position, candidate),
    );
    expect(after.distanceTo(before)).toBeGreaterThan(0.02);

    disposeStudioVrmSkinnedGarment(surface);
    material.dispose();
  });

  it("여러 semantic bone 이름이 같은 raw Bone이면 Skeleton identity를 하나로 합친다", () => {
    const root = new THREE.Group();
    const shared = new THREE.Bone();
    root.add(shared);
    root.updateMatrixWorld(true);
    const lowerPart: GarmentPart = { ...UPPER_SLEEVE, bone: "leftLowerArm" };
    const itemMaterials = materials(2);
    const built = buildStudioVrmSkinnedGarment({
      name: "aliased-raw-bone",
      root,
      parts: [UPPER_SLEEVE, lowerPart],
      materials: itemMaterials,
      resolveBone: (name) => name === "leftUpperArm" || name === "leftLowerArm" ? shared : null,
    });
    const surface = built.surface!;
    expect(surface.receipt.usedBones).toEqual(["leftUpperArm", "leftLowerArm"]);
    expect(surface.receipt.boneCount).toBe(1);
    expect(surface.mesh.skeleton.bones).toEqual([shared]);
    expect(Array.from(surface.mesh.geometry.getAttribute("skinIndex").array).every((index) => index === 0)).toBe(true);

    disposeStudioVrmSkinnedGarment(surface);
    disposeMaterials(itemMaterials);
  });

  it("필수 본·template·변환·geometry·예산 오류를 unavailable로 닫는다", () => {
    const rig = armRig();
    const material = new THREE.MeshBasicMaterial();
    const missing = buildStudioVrmSkinnedGarment({
      name: "missing",
      root: rig.root,
      parts: [{ ...UPPER_SLEEVE, bone: "rightUpperArm" }],
      materials: [material],
      resolveBone: rig.resolveBone,
    });
    expect(missing).toMatchObject({
      ok: false,
      status: "unavailable",
      surface: null,
      receipt: {
        mode: "unavailable",
        unavailableReason: "missing-required-bone",
        missingBones: ["rightUpperArm"],
      },
    });

    const budget = buildStudioVrmSkinnedGarment({
      name: "budget",
      root: rig.root,
      parts: [UPPER_SLEEVE],
      materials: [material],
      resolveBone: rig.resolveBone,
      vertexBudget: 128,
    });
    expect(budget.surface).toBeNull();
    expect(budget.receipt.unavailableReason).toBe("vertex-budget");
    expect(budget.receipt.vertexCount).toBeGreaterThan(128);

    const triangles = buildStudioVrmSkinnedGarment({
      name: "triangle-budget",
      root: rig.root,
      parts: [UPPER_SLEEVE],
      materials: [material],
      resolveBone: rig.resolveBone,
      triangleBudget: 1,
    });
    expect(triangles.surface).toBeNull();
    expect(triangles.receipt.unavailableReason).toBe("triangle-budget");

    const spoof = new THREE.Group() as THREE.Group & { isBone: boolean };
    spoof.isBone = true;
    rig.root.add(spoof);
    const invalid = buildStudioVrmSkinnedGarment({
      name: "invalid-bone",
      root: rig.root,
      parts: [UPPER_SLEEVE],
      materials: [material],
      resolveBone: (name) => name === "leftUpperArm" ? spoof : rig.resolveBone(name),
    });
    expect(invalid.surface).toBeNull();
    expect(invalid.receipt.unavailableReason).toBe("invalid-bone-node");

    const nonFinite = buildStudioVrmSkinnedGarment({
      name: "non-finite",
      root: rig.root,
      parts: [{ ...UPPER_SLEEVE, offset: [Number.NaN, 0, 0] }],
      materials: [material],
      resolveBone: rig.resolveBone,
    });
    expect(nonFinite.receipt.unavailableReason).toBe("non-finite-geometry");

    const incomplete = buildStudioVrmSkinnedGarment({
      name: "wardrobe:top:shirt",
      root: rig.root,
      parts: [UPPER_SLEEVE],
      materials: [material],
      resolveBone: rig.resolveBone,
    });
    expect(incomplete.receipt.unavailableReason).toBe("upper-template-incomplete");

    const singularRig = armRig();
    singularRig.root.scale.x = 0;
    const singular = buildStudioVrmSkinnedGarment({
      name: "singular-root",
      root: singularRig.root,
      parts: [UPPER_SLEEVE],
      materials: [material],
      resolveBone: singularRig.resolveBone,
    });
    expect(singular.receipt.unavailableReason).toBe("invalid-root-transform");
    material.dispose();
  });

  it("depth를 선언하지 않은 lathe는 LatheGeometry 경로를 그대로 쓴다", () => {
    const geometries = [undefined, 8, 4096].map((segments) => (
      buildStudioVrmGarmentGeometry(latheShape(DEPTH_PROFILE, segments))
    ));
    expect(geometries.every((geometry) => geometry instanceof THREE.LatheGeometry)).toBe(true);
    expect(geometries.map((geometry) => (geometry as THREE.LatheGeometry).parameters.segments))
      .toEqual([40, 40, 256]);
    geometries.forEach((geometry) => geometry.dispose());
  });

  it("모든 링이 depth 1이면 회전체와 같은 정원 단면이 나온다", () => {
    const revolved = buildStudioVrmGarmentGeometry(latheShape(DEPTH_PROFILE));
    const circular = buildStudioVrmGarmentGeometry(latheShape(withDepths([1, 1, 1, 1])));

    expect(circular).not.toBeInstanceOf(THREE.LatheGeometry);
    expect(Array.from(circular.getAttribute("position").array))
      .toEqual(Array.from(revolved.getAttribute("position").array));
    expect(Array.from(circular.getAttribute("uv").array))
      .toEqual(Array.from(revolved.getAttribute("uv").array));
    expect(Array.from(circular.getIndex()!.array)).toEqual(Array.from(revolved.getIndex()!.array));

    const rings = latheRingExtents(circular);
    expect(rings).toHaveLength(DEPTH_PROFILE.length);
    rings.forEach((ring, index) => {
      expect(ring.x).toBeCloseTo(DEPTH_PROFILE[index].radius, 6);
      expect(ring.z).toBeCloseTo(ring.x, 6);
    });

    revolved.dispose();
    circular.dispose();
  });

  it("depth 0.6 링은 z 폭이 x 폭의 0.6배가 되고 링마다 다른 depth는 높이마다 다른 비를 만든다", () => {
    const uniform = buildStudioVrmGarmentGeometry(latheShape(withDepths([0.6, 0.6, 0.6, 0.6])));
    for (const ring of latheRingExtents(uniform)) expect(ring.z / ring.x).toBeCloseTo(0.6, 5);

    const perRingDepths = [0.95, 0.55, 0.72, 0.4];
    const varied = buildStudioVrmGarmentGeometry(latheShape(withDepths(perRingDepths)));
    const rings = latheRingExtents(varied);
    expect(rings).toHaveLength(perRingDepths.length);
    rings.forEach((ring, index) => {
      expect(ring.x).toBeCloseTo(DEPTH_PROFILE[index].radius, 6);
      expect(ring.z / ring.x).toBeCloseTo(perRingDepths[index], 5);
    });
    expect(new Set(rings.map((ring) => Math.round((ring.z / ring.x) * 1e4))).size).toBe(rings.length);

    uniform.dispose();
    varied.dispose();
  });

  it("depth 표면은 유한한 위치·법선과 rings×segments에 맞는 유효 인덱스를 낸다", () => {
    const segments = 64;
    const profile = withDepths([0.9, 0.52, 0.68, 0.44]);
    const geometry = buildStudioVrmGarmentGeometry(latheShape(profile, segments));
    const position = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    const uvs = geometry.getAttribute("uv");
    const index = geometry.getIndex()!;

    expect(position.count).toBe((segments + 1) * profile.length);
    expect(normals.count).toBe(position.count);
    expect(uvs.count).toBe(position.count);
    expect(index.count / 3).toBe(segments * (profile.length - 1) * 2);
    expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
    expect(Array.from(normals.array).every(Number.isFinite)).toBe(true);
    expect(Array.from(uvs.array).every(Number.isFinite)).toBe(true);
    expect(Array.from(index.array).every((value) => (
      Number.isInteger(value) && value >= 0 && value < position.count
    ))).toBe(true);
    for (let vertex = 0; vertex < normals.count; vertex += 1) {
      expect(new THREE.Vector3().fromBufferAttribute(normals, vertex).length()).toBeCloseTo(1, 5);
    }

    geometry.dispose();
  });

  it("눌린 단면의 법선은 회전체 법선이 아니라 스케일 이후 접선에서 나온다", () => {
    const radius = 0.5;
    const depth = 0.6;
    const geometry = buildStudioVrmGarmentGeometry(latheShape([
      { radius, y: -0.5, depth },
      { radius, y: 0.5, depth },
    ]));
    const position = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    const actual = new THREE.Vector3();
    let obliqueChecks = 0;

    for (let vertex = 0; vertex < position.count; vertex += 1) {
      const x = position.getX(vertex);
      const z = position.getZ(vertex);
      // 타원 (x/r)² + (z/rd)² = 1 의 기울기 방향.
      const expected = new THREE.Vector3(x / (radius * radius), 0, z / (radius * depth) ** 2).normalize();
      actual.fromBufferAttribute(normals, vertex);
      expect(actual.dot(expected)).toBeCloseTo(1, 4);

      // 회전체 법선을 그대로 옮긴 구현이 낼 방향 — 축 위가 아닌 곳에서 실제와 갈라져야 한다.
      const unscaled = new THREE.Vector3(x / radius, 0, z / (radius * depth)).normalize();
      if (Math.abs(x) > 1e-3 && Math.abs(z) > 1e-3) {
        expect(actual.dot(unscaled)).toBeLessThan(0.999);
        obliqueChecks += 1;
      }
    }
    expect(obliqueChecks).toBeGreaterThan(0);

    geometry.dispose();
  });

  it("depth는 축 범위를 바꾸지 않아 스킨 웨이트 계획이 그대로다", () => {
    const available = new Set<StudioVrmGarmentSkinBone>(["hips", "leftUpperLeg", "rightUpperLeg"]);
    const shaped: GarmentPart = {
      ...DRAPED_SKIRT,
      shape: {
        kind: "lathe",
        profile: [
          { radius: 0.55, y: -0.6, depth: 0.7 },
          { radius: 0.48, y: -0.2, depth: 0.82 },
          { radius: 0.36, y: 0.6, depth: 0.95 },
        ],
        segments: 40,
      },
    };
    for (const y of [-0.6, -0.35, 0, 0.28, 0.6]) {
      expect(planStudioVrmGarmentSkinInfluences(shaped, y, available, 0.3))
        .toEqual(planStudioVrmGarmentSkinInfluences(DRAPED_SKIRT, y, available, 0.3));
    }
  });

  it("타원 몸통을 쓴 상체 template도 소매가 붙은 단일 연결 surface로 남는다", () => {
    const rig = upperBodyRig();
    const torso = UPPER_BODY_PARTS[0];
    const ellipticalTorso: GarmentPart = {
      ...torso,
      shape: {
        kind: "lathe",
        profile: [
          { radius: 0.4, y: -0.8, depth: 0.82 },
          { radius: 0.45, y: -0.25, depth: 0.66 },
          { radius: 0.5, y: 0.4, depth: 0.74 },
          { radius: 0.45, y: 0.8, depth: 0.9 },
        ],
        segments: 40,
      },
    };
    const parts = [ellipticalTorso, ...UPPER_BODY_PARTS.slice(1)];
    const itemMaterials = materials(parts.length);
    const built = buildStudioVrmSkinnedGarment({
      name: "wardrobe:top:shirt",
      root: rig.root,
      parts,
      materials: itemMaterials,
      resolveBone: rig.resolveBone,
    });

    const surface = built.surface!;
    expect(surface.receipt).toEqual(expect.objectContaining({
      mode: "skinned-shell-v1",
      templateKind: "upper-body-v1",
      connectedComponentCount: 1,
      continuousSleeveCount: 2,
      unavailableReason: null,
    }));
    const topology = surface.mesh.geometry.userData.studioVrmUpperBodyTopology as {
      torso: { start: number; count: number };
    };
    // 몸통 정점 수는 회전체와 같은 (segments + 1) × 링 수라 소매 anchor 탐색 범위가 그대로다.
    expect(topology.torso.count).toBe(41 * 4);
    expectNormalizedFiniteWeights(surface.mesh);

    disposeStudioVrmSkinnedGarment(surface);
    disposeMaterials(itemMaterials);
  });

  it("depth 파츠도 예산 안에서 닫히고 깨진 depth는 기존 사유로 막힌다", () => {
    const rig = lowerBodyRig();
    const material = new THREE.MeshStandardMaterial();
    const depthPart: GarmentPart = {
      ...DRAPED_SKIRT,
      shape: {
        kind: "lathe",
        profile: [
          { radius: 0.55, y: -0.6, depth: 0.7 },
          { radius: 0.48, y: -0.2, depth: 0.82 },
          { radius: 0.36, y: 0.6, depth: 0.95 },
        ],
        segments: 40,
      },
    };
    const built = buildStudioVrmSkinnedGarment({
      name: "wardrobe:bottom:dress",
      root: rig.root,
      parts: [depthPart],
      materials: [material],
      resolveBone: rig.resolveBone,
    });
    expect(built.ok).toBe(true);
    const surface = built.surface!;
    expect(surface.receipt.unavailableReason).toBeNull();
    expect(surface.receipt.vertexCount).toBeLessThanOrEqual(STUDIO_VRM_SKINNED_GARMENT_VERTEX_BUDGET);
    expect(surface.receipt.triangleCount).toBeLessThanOrEqual(STUDIO_VRM_SKINNED_GARMENT_TRIANGLE_BUDGET);
    expectNormalizedFiniteWeights(surface.mesh);
    const position = surface.mesh.geometry.getAttribute("position");
    expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
    expect(Array.from(surface.mesh.geometry.getAttribute("normal").array).every(Number.isFinite)).toBe(true);
    const hem = latheRingExtents(surface.mesh.geometry).at(0)!;
    expect(hem.z / hem.x).toBeCloseTo(0.7, 4);
    disposeStudioVrmSkinnedGarment(surface);

    const nonFinite = buildStudioVrmSkinnedGarment({
      name: "depth-non-finite",
      root: rig.root,
      parts: [{
        ...depthPart,
        shape: { kind: "lathe", profile: [{ radius: 0.5, y: -0.5, depth: Number.NaN }, { radius: 0.4, y: 0.5 }] },
      }],
      materials: [material],
      resolveBone: rig.resolveBone,
    });
    expect(nonFinite.receipt.unavailableReason).toBe("non-finite-geometry");

    const negative = buildStudioVrmSkinnedGarment({
      name: "depth-negative",
      root: rig.root,
      parts: [{
        ...depthPart,
        shape: { kind: "lathe", profile: [{ radius: 0.5, y: -0.5, depth: -0.4 }, { radius: 0.4, y: 0.5 }] },
      }],
      materials: [material],
      resolveBone: rig.resolveBone,
    });
    expect(negative.receipt.unavailableReason).toBe("invalid-topology");

    const budget = buildStudioVrmSkinnedGarment({
      name: "depth-budget",
      root: rig.root,
      parts: [depthPart],
      materials: [material],
      resolveBone: rig.resolveBone,
      vertexBudget: 64,
    });
    expect(budget.surface).toBeNull();
    expect(budget.receipt.unavailableReason).toBe("vertex-budget");
    expect(budget.receipt.vertexCount).toBeGreaterThan(64);

    material.dispose();
  });

  it("동일 입력의 surface 영수증 서명은 결정론적이다", () => {
    const make = () => {
      const rig = armRig();
      const material = new THREE.MeshBasicMaterial();
      const result = buildStudioVrmSkinnedGarment({
        name: "deterministic",
        root: rig.root,
        parts: [UPPER_SLEEVE],
        materials: [material],
        resolveBone: rig.resolveBone,
      });
      if (result.surface) disposeStudioVrmSkinnedGarment(result.surface);
      material.dispose();
      return result.receipt;
    };
    expect(make()).toEqual(make());
  });
});

// A UV seam duplicates positions intentionally; topology-only normal recomputation splits its
// lighting even though the authored analytic normals describe one continuous cloth surface.
describe("garment assembly preserves smooth authored normals", () => {
  it.each([false, true])("keeps both sides of the torso UV seam identical (elliptical=%s)", (elliptical) => {
    const rig = upperBodyRig();
    const segments = 40;
    const profile = [
      { radius: 0.25, y: -0.6, ...(elliptical ? { depth: 0.6 } : {}) },
      { radius: 0.29, y: -0.1, ...(elliptical ? { depth: 0.5 } : {}) },
      { radius: 0.34, y: 0.3, ...(elliptical ? { depth: 0.65 } : {}) },
    ];
    const part: GarmentPart = {
      bone: "spine", shape: { kind: "lathe", profile, segments },
      offset: [0, 0, 0], squash: [1.2, 1, 0.8],
    };
    const material = new THREE.MeshStandardMaterial();
    const built = buildStudioVrmSkinnedGarment({
      name: "wardrobe:top:tshirt", root: rig.root, parts: [part], materials: [material], resolveBone: rig.resolveBone,
    });
    expect(built.ok).toBe(true);
    if (!built.surface) throw new Error("fixture garment unavailable");
    const normal = built.surface.mesh.geometry.getAttribute("normal");
    for (let ring = 0; ring < profile.length; ring += 1) {
      const first = new THREE.Vector3().fromBufferAttribute(normal, ring);
      const last = new THREE.Vector3().fromBufferAttribute(normal, segments * profile.length + ring);
      expect(first.distanceTo(last)).toBeLessThan(1e-6);
    }
    disposeStudioVrmSkinnedGarment(built.surface);
  });
});
