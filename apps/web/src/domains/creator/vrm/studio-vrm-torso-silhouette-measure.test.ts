import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { bodySilhouetteSignature, buildBodySilhouette } from "./studio-vrm-body-silhouette";
import {
  isStudioAuthoredAttachment,
  buildTorsoMeasureFrame,
  measureStudioVrmWardrobeMetrics,
  pickDominantSkinInfluence,
  projectTorsoSample,
  torsoVertexStride,
} from "./StudioVrmWardrobePropsProjection";

import type { BodySilhouetteSample } from "./studio-vrm-body-silhouette";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

const UPRIGHT_ANCHORS = {
  up: [0, 1, 0],
  hips: [0, -0.22, 0],
  neck: [0, 0.4, 0],
  leftUpperArm: [0.31, 0.26, 0],
  rightUpperArm: [-0.31, 0.26, 0],
} as const;

const REST_BONES: readonly (readonly [VRMHumanBoneName, THREE.Vector3Tuple])[] = [
  ["hips", [0, 1, 0]],
  ["spine", [0, 1.22, 0]],
  ["chest", [0, 1.35, 0]],
  ["neck", [0, 1.62, 0]],
  ["leftUpperArm", [0.31, 1.48, 0]],
  ["rightUpperArm", [-0.31, 1.48, 0]],
  ["leftLowerArm", [0.59, 1.29, 0]],
  ["rightLowerArm", [-0.59, 1.29, 0]],
  ["leftHand", [0.79, 1.13, 0]],
  ["rightHand", [-0.79, 1.13, 0]],
  ["leftUpperLeg", [0.14, 0.91, 0]],
  ["rightUpperLeg", [-0.14, 0.91, 0]],
  ["leftLowerLeg", [0.14, 0.48, 0]],
  ["rightLowerLeg", [-0.14, 0.48, 0]],
  ["leftFoot", [0.14, 0.08, 0.12]],
  ["rightFoot", [-0.14, 0.08, 0.12]],
];

const HALF_WIDTH_M = 0.2;
const HALF_DEPTH_M = 0.1;
const HEIGHT_STEPS = 24;
const ANGLE_STEPS = 24;

interface RestRig {
  vrm: VRM;
  scene: THREE.Group;
  bones: Map<VRMHumanBoneName, THREE.Bone>;
}

/** 본만 있는 rest 리그. 스킨 메시가 없으므로 실측은 실패해야 하고 골격 치수만 남아야 한다. */
function createRestRig(): RestRig {
  const scene = new THREE.Group();
  const bones = new Map<VRMHumanBoneName, THREE.Bone>();
  for (const [name, position] of REST_BONES) {
    const bone = new THREE.Bone();
    bone.name = `model_specific_${name}`;
    bone.position.set(...position);
    scene.add(bone);
    bones.set(name, bone);
  }
  scene.updateMatrixWorld(true);
  const vrm = {
    scene,
    humanoid: { getRawBoneNode: (name: VRMHumanBoneName) => bones.get(name) ?? null },
  } as unknown as VRM;
  return { vrm, scene, bones };
}

/**
 * 반폭 0.2 / 반깊이 0.1 인 타원 기둥을 hips~목 높이에 세우고 하나의 본에 100% 물린다.
 * 실측이 원통(반폭 = 반깊이)이 아니라 타원으로 나오는지 검증하는 재료다.
 */
function attachEllipticalTorsoMesh(rig: RestRig, dominant: THREE.Bone, skeletonBones: THREE.Bone[]): THREE.SkinnedMesh {
  const dominantIndex = skeletonBones.indexOf(dominant);
  if (dominantIndex < 0) throw new Error("dominant bone must be part of the skeleton");
  const positions: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  // hips(y=1)와 목(y=1.62) 사이에만 표면을 두어 t가 정확히 경계에 앉지 않게 한다.
  for (let step = 0; step < HEIGHT_STEPS; step += 1) {
    const y = 1.01 + (0.6 * step) / (HEIGHT_STEPS - 1);
    for (let angleStep = 0; angleStep < ANGLE_STEPS; angleStep += 1) {
      const angle = (Math.PI * 2 * angleStep) / ANGLE_STEPS;
      positions.push(HALF_WIDTH_M * Math.cos(angle), y, HALF_DEPTH_M * Math.sin(angle));
      skinIndices.push(dominantIndex, 0, 0, 0);
      skinWeights.push(1, 0, 0, 0);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));

  const skeleton = new THREE.Skeleton(skeletonBones);
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  rig.scene.add(mesh);
  rig.scene.updateMatrixWorld(true);
  mesh.bind(skeleton, new THREE.Matrix4());
  return mesh;
}

function requireBone(rig: RestRig, name: VRMHumanBoneName): THREE.Bone {
  const bone = rig.bones.get(name);
  if (!bone) throw new Error(`rest rig is missing ${name}`);
  return bone;
}

describe("torso measure frame", () => {
  it("builds a right-handed spine-local frame with left×up as anatomical forward", () => {
    const frame = buildTorsoMeasureFrame(UPRIGHT_ANCHORS);

    expect(frame).not.toBeNull();
    expect(frame?.up).toEqual([0, 1, 0]);
    expect(frame?.left).toEqual([1, 0, 0]);
    expect(frame?.forward).toEqual([0, 0, 1]);
    expect(frame?.hipsHeight).toBeCloseTo(-0.22, 10);
    expect(frame?.span).toBeCloseTo(0.62, 10);
  });

  it("normalises a non-unit up axis and removes the up component from a tilted shoulder line", () => {
    const frame = buildTorsoMeasureFrame({
      ...UPRIGHT_ANCHORS,
      up: [0, 5, 0],
      leftUpperArm: [0.3, 0.36, 0],
      rightUpperArm: [-0.3, 0.16, 0],
    });

    expect(frame?.up).toEqual([0, 1, 0]);
    expect(frame?.left).toEqual([1, 0, 0]);
    expect(frame?.forward).toEqual([0, 0, 1]);
  });

  it("refuses degenerate rigs instead of inventing an axis", () => {
    expect(buildTorsoMeasureFrame({ ...UPRIGHT_ANCHORS, up: [0, 0, 0] })).toBeNull();
    // 어깨선이 up과 평행하면 좌우 축이 남지 않는다.
    expect(buildTorsoMeasureFrame({
      ...UPRIGHT_ANCHORS,
      leftUpperArm: [0, 0.5, 0],
      rightUpperArm: [0, -0.1, 0],
    })).toBeNull();
    // hips↔목 높이차가 t 정규화의 분모로 쓸 수 없을 만큼 짧다.
    expect(buildTorsoMeasureFrame({ ...UPRIGHT_ANCHORS, neck: [0, -0.21, 0] })).toBeNull();
    expect(buildTorsoMeasureFrame({ ...UPRIGHT_ANCHORS, neck: [0, Number.NaN, 0] })).toBeNull();
  });
});

describe("torso sample projection", () => {
  const frame = buildTorsoMeasureFrame(UPRIGHT_ANCHORS);
  if (!frame) throw new Error("upright anchors must produce a frame");

  it("normalises height to 0 at the hips joint and 1 at the neck joint", () => {
    expect(projectTorsoSample(frame, 0, -0.22, 0)?.t).toBeCloseTo(0, 10);
    expect(projectTorsoSample(frame, 0, 0.09, 0)?.t).toBeCloseTo(0.5, 10);
    expect(projectTorsoSample(frame, 0, 0.4, 0)?.t).toBeCloseTo(1, 10);
  });

  it("splits the perpendicular components into left-right x and front-back z", () => {
    const sample = projectTorsoSample(frame, 0.18, 0.09, -0.07);

    expect(sample?.x).toBeCloseTo(0.18, 10);
    expect(sample?.z).toBeCloseTo(-0.07, 10);
  });

  it("keeps the same split when the frame is not axis aligned", () => {
    const rotated = buildTorsoMeasureFrame({
      up: [0, 0, 1],
      hips: [0, 0, -0.2],
      neck: [0, 0, 0.4],
      leftUpperArm: [0.3, 0, 0.3],
      rightUpperArm: [-0.3, 0, 0.3],
    });
    if (!rotated) throw new Error("rotated anchors must produce a frame");
    const sample = projectTorsoSample(rotated, 0.15, -0.05, 0.1);

    expect(rotated.forward).toEqual([0, -1, 0]);
    expect(sample?.t).toBeCloseTo(0.5, 10);
    expect(sample?.x).toBeCloseTo(0.15, 10);
    expect(sample?.z).toBeCloseTo(0.05, 10);
  });

  it("drops points outside the measured span and non-finite points", () => {
    expect(projectTorsoSample(frame, 0, -0.3, 0)).toBeNull();
    expect(projectTorsoSample(frame, 0, 0.55, 0)).toBeNull();
    expect(projectTorsoSample(frame, Number.NaN, 0.09, 0)).toBeNull();
    expect(projectTorsoSample(frame, 0, Number.POSITIVE_INFINITY, 0)).toBeNull();
  });
});

describe("dominant skin influence", () => {
  it("picks the heaviest of the four influences", () => {
    const influence = pickDominantSkinInfluence(
      new Uint16Array([3, 7, 2, 0]),
      new Float32Array([0.2, 0.5, 0.3, 0]),
    );

    expect(influence).toEqual({ boneIndex: 7, weight: 0.5 });
  });

  it("breaks ties toward the earlier slot so the same model always picks the same bone", () => {
    const first = pickDominantSkinInfluence(new Uint16Array([4, 9, 0, 0]), new Float32Array([0.5, 0.5, 0, 0]));
    const second = pickDominantSkinInfluence(new Uint16Array([4, 9, 0, 0]), new Float32Array([0.5, 0.5, 0, 0]));

    expect(first).toEqual({ boneIndex: 4, weight: 0.5 });
    expect(second).toEqual(first);
  });

  it("rejects vertices with no usable influence", () => {
    expect(pickDominantSkinInfluence(new Uint16Array([1, 2, 3, 4]), new Float32Array([0, 0, 0, 0]))).toBeNull();
    expect(pickDominantSkinInfluence(new Uint16Array(0), new Float32Array(0))).toBeNull();
    expect(pickDominantSkinInfluence([1, 2], [Number.NaN, Number.NaN])).toBeNull();
  });

  it("skips slots with an invalid bone index or a non-finite weight", () => {
    expect(pickDominantSkinInfluence([-1, 5, 0, 0], [0.9, 0.1, 0, 0])).toEqual({ boneIndex: 5, weight: 0.1 });
    expect(pickDominantSkinInfluence([8, 5, 0, 0], [Number.NaN, 0.4, 0, 0])).toEqual({ boneIndex: 5, weight: 0.4 });
  });

  it("reads only the four skinning slots even when the arrays are longer", () => {
    expect(pickDominantSkinInfluence([0, 0, 0, 0, 9], [0.1, 0.1, 0.1, 0.1, 0.9]))
      .toEqual({ boneIndex: 0, weight: 0.1 });
  });
});

describe("torso vertex stride", () => {
  it("walks every vertex while the mesh fits the budget", () => {
    expect(torsoVertexStride(5_000, 12_000)).toBe(1);
    expect(torsoVertexStride(12_000, 12_000)).toBe(1);
  });

  it("caps a 200k-vertex mesh at the budget with a stride that depends only on the counts", () => {
    expect(torsoVertexStride(200_000, 12_000)).toBe(17);
    expect(torsoVertexStride(200_000, 12_000)).toBe(torsoVertexStride(200_000, 12_000));
    expect(Math.ceil(200_000 / 17)).toBeLessThanOrEqual(12_000);
  });

  it("never returns a stride that would stall or skip the whole mesh", () => {
    expect(torsoVertexStride(0, 12_000)).toBe(1);
    expect(torsoVertexStride(-5, 12_000)).toBe(1);
    expect(torsoVertexStride(Number.NaN, 12_000)).toBe(1);
    expect(torsoVertexStride(100, 0)).toBe(100);
  });
});

describe("torso sample pipeline", () => {
  it("turns an elliptical surface into rings that keep the width/depth ratio", () => {
    const frame = buildTorsoMeasureFrame(UPRIGHT_ANCHORS);
    if (!frame) throw new Error("upright anchors must produce a frame");
    const samples: BodySilhouetteSample[] = [];
    for (let step = 0; step < HEIGHT_STEPS; step += 1) {
      const height = -0.21 + (0.6 * step) / (HEIGHT_STEPS - 1);
      for (let angleStep = 0; angleStep < ANGLE_STEPS; angleStep += 1) {
        const angle = (Math.PI * 2 * angleStep) / ANGLE_STEPS;
        const sample = projectTorsoSample(
          frame,
          HALF_WIDTH_M * Math.cos(angle),
          height,
          HALF_DEPTH_M * Math.sin(angle),
        );
        if (sample) samples.push(sample);
      }
    }
    const silhouette = buildBodySilhouette(samples);

    expect(silhouette?.source).toBe("measured");
    expect(silhouette?.sampleCount).toBe(HEIGHT_STEPS * ANGLE_STEPS);
    for (const ring of silhouette?.rings ?? []) {
      expect(ring.halfWidth).toBeGreaterThan(0.19);
      expect(ring.halfWidth).toBeLessThanOrEqual(HALF_WIDTH_M);
      expect(ring.halfWidth / ring.halfDepth).toBeCloseTo(HALF_WIDTH_M / HALF_DEPTH_M, 3);
      expect(ring.centerX).toBeCloseTo(0, 6);
      expect(ring.centerZ).toBeCloseTo(0, 6);
    }
  });
});

describe("measureStudioVrmWardrobeMetrics torso", () => {
  it("measures the skinned surface into spine-local rings", () => {
    const rig = createRestRig();
    const spine = requireBone(rig, "spine");
    attachEllipticalTorsoMesh(rig, spine, [requireBone(rig, "hips"), spine, requireBone(rig, "chest")]);

    const metrics = measureStudioVrmWardrobeMetrics(rig.vrm);
    const torso = metrics.torso;

    expect(torso).not.toBeNull();
    expect(torso?.source).toBe("measured");
    expect(torso?.sampleCount).toBe(HEIGHT_STEPS * ANGLE_STEPS);
    expect(torso?.rings.length).toBe(12);
    for (const ring of torso?.rings ?? []) {
      expect(ring.halfWidth).toBeGreaterThan(0.19);
      expect(ring.halfWidth / ring.halfDepth).toBeCloseTo(HALF_WIDTH_M / HALF_DEPTH_M, 3);
    }
    // 실측이 붙어도 골격 치수는 그대로여야 한다.
    expect(metrics.source).toBe("raw-rig");
    expect(metrics.shoulderW).toBeCloseTo(0.62, 6);
    expect(metrics.hipsToSpine).toBeCloseTo(0.22, 6);
    expect(metrics.spineToNeck).toBeCloseTo(0.4, 6);
  });

  it("produces the same rings for the same rig", () => {
    const build = () => {
      const rig = createRestRig();
      const spine = requireBone(rig, "spine");
      attachEllipticalTorsoMesh(rig, spine, [requireBone(rig, "hips"), spine, requireBone(rig, "chest")]);
      return measureStudioVrmWardrobeMetrics(rig.vrm).torso;
    };

    expect(bodySilhouetteSignature(build())).toBe(bodySilhouetteSignature(build()));
    expect(bodySilhouetteSignature(build())).not.toBe("none");
  });

  it("reports no torso when the rig has no skinned mesh, leaving the skeleton metrics untouched", () => {
    const metrics = measureStudioVrmWardrobeMetrics(createRestRig().vrm);

    expect(metrics.torso).toBeNull();
    expect(metrics.shoulderW).toBeCloseTo(0.62, 6);
    expect(metrics.hipW).toBeCloseTo(0.28, 6);
    expect(metrics.spineToNeck).toBeCloseTo(0.4, 6);
  });

  it("reports no torso when the skinned vertices belong to a non-torso bone", () => {
    const rig = createRestRig();
    const hair = new THREE.Bone();
    hair.name = "hair_tip";
    hair.position.set(0, 1.8, 0);
    rig.scene.add(hair);
    rig.scene.updateMatrixWorld(true);
    attachEllipticalTorsoMesh(rig, hair, [hair]);

    expect(measureStudioVrmWardrobeMetrics(rig.vrm).torso).toBeNull();
  });
});

describe("스튜디오가 입힌 옷은 몸이 아니다", () => {
  function named(name: string, parent?: THREE.Object3D): THREE.Object3D {
    const node = new THREE.Object3D();
    node.name = name;
    parent?.add(node);
    return node;
  }

  it("의상·소품 노드와 그 자손을 실측 대상에서 뺀다", () => {
    // 절차형 의상은 vrm.scene 안으로 포털되고 몸통 본에 스킨된다. 걸러 내지 않으면 "몸"이 아니라
    // 이미 입은 옷을 재게 되고, 다음 옷은 그 위에 또 여유분을 얹는다.
    for (const name of ["wardrobe:top:shirt", "wardrobe:outer:coat", "wardrobe:bottom:pleated", "wardrobe:shoes:boots", "prop:catEars"]) {
      const root = named(name);
      expect(isStudioAuthoredAttachment(root)).toBe(true);
      expect(isStudioAuthoredAttachment(named("Surface", root))).toBe(true);
      expect(isStudioAuthoredAttachment(named("deep", named("mid", root)))).toBe(true);
    }
  });

  it("모델 자신의 메시는 그대로 잰다", () => {
    for (const name of ["Body", "N00_000_00_HeadMesh", "Face", "", "wardrobe", "propeller", "my-wardrobe:top:shirt"]) {
      expect(isStudioAuthoredAttachment(named(name))).toBe(false);
    }
  });

  it("모델 자신의 메시가 의상 노드 밑에 없으면 조상 이름에 걸리지 않는다", () => {
    const scene = named("VRMRoot");
    const body = named("Body", scene);
    named("wardrobe:top:shirt", scene);
    expect(isStudioAuthoredAttachment(body)).toBe(false);
  });
});

/** Regression oracle: the renderer's vertex API, not the previous dominant-bone approximation. */
describe("wardrobe fit follows the rendered body", () => {
  function expectRenderedFit(rig: RestRig, mesh: THREE.SkinnedMesh) {
    rig.scene.updateMatrixWorld(true);
    const spine = requireBone(rig, "spine");
    const frame = buildTorsoMeasureFrame(UPRIGHT_ANCHORS);
    if (!frame) throw new Error("invalid fixture frame");
    const point = new THREE.Vector3();
    const samples: BodySilhouetteSample[] = [];
    for (let index = 0; index < mesh.geometry.getAttribute("position").count; index += 1) {
      mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld);
      spine.worldToLocal(point);
      const sample = projectTorsoSample(frame, point.x, point.y, point.z);
      if (sample) samples.push(sample);
    }
    const expected = buildBodySilhouette(samples);
    const measured = measureStudioVrmWardrobeMetrics(rig.vrm).torso;
    expect(expected).not.toBeNull();
    expect(measured?.sampleCount).toBe(expected?.sampleCount);
    for (const [index, ring] of (expected?.rings ?? []).entries()) {
      expect(measured?.rings[index].halfWidth, `width at ring ${index}`).toBeCloseTo(ring.halfWidth, 6);
      expect(measured?.rings[index].halfDepth, `depth at ring ${index}`).toBeCloseTo(ring.halfDepth, 6);
      expect(measured?.rings[index].centerX, `center at ring ${index}`).toBeCloseTo(ring.centerX, 6);
    }
  }
  it("uses secondary skin weights at blended joints", () => {
    const rig = createRestRig();
    const spine = requireBone(rig, "spine");
    const chest = requireBone(rig, "chest");
    const mesh = attachEllipticalTorsoMesh(rig, spine, [spine, chest]);
    const indices = mesh.geometry.getAttribute("skinIndex");
    const weights = mesh.geometry.getAttribute("skinWeight");
    for (let i = 0; i < indices.count; i += 1) {
      indices.setXYZW(i, 0, 1, 0, 0);
      weights.setXYZW(i, 0.55, 0.45, 0, 0);
    }
    chest.scale.set(1.6, 1, 1.4);
    expectRenderedFit(rig, mesh);
  });
  it.each([true, false])("fits active shape morphs (relative=%s) and restores zero influence", (relative) => {
    const rig = createRestRig();
    const spine = requireBone(rig, "spine");
    const mesh = attachEllipticalTorsoMesh(rig, spine, [spine]);
    const before = bodySilhouetteSignature(measureStudioVrmWardrobeMetrics(rig.vrm).torso);
    const base = mesh.geometry.getAttribute("position");
    const morph = new THREE.Float32BufferAttribute(new Float32Array(base.count * 3), 3);
    for (let i = 0; i < base.count; i += 1) {
      morph.setXYZ(i, base.getX(i) * (relative ? 0.4 : 1.4), relative ? 0 : base.getY(i), base.getZ(i) * (relative ? 0.6 : 1.6));
    }
    mesh.geometry.morphAttributes.position = [morph];
    mesh.geometry.morphTargetsRelative = relative;
    mesh.updateMorphTargets();
    mesh.morphTargetInfluences![0] = 0.65;
    expectRenderedFit(rig, mesh);
    mesh.morphTargetInfluences![0] = 0;
    expect(bodySilhouetteSignature(measureStudioVrmWardrobeMetrics(rig.vrm).torso)).toBe(before);
  });
  it("rejects invalid secondary bone indices instead of throwing or fabricating a fit", () => {
    const rig = createRestRig();
    const spine = requireBone(rig, "spine");
    const mesh = attachEllipticalTorsoMesh(rig, spine, [spine]);
    const indices = mesh.geometry.getAttribute("skinIndex");
    const weights = mesh.geometry.getAttribute("skinWeight");
    for (let i = 0; i < indices.count; i += 1) {
      indices.setXYZW(i, 0, 999, 0, 0);
      weights.setXYZW(i, 0.8, 0.2, 0, 0);
    }
    expect(() => measureStudioVrmWardrobeMetrics(rig.vrm)).not.toThrow();
    expect(measureStudioVrmWardrobeMetrics(rig.vrm).torso).toBeNull();
  });
});
