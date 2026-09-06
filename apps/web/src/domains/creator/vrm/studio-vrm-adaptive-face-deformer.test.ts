import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  applyStudioVrmAdaptiveFaceMorphs,
  inspectStudioVrmAdaptiveFaceProfile,
} from "./studio-vrm-adaptive-face-deformer";

import type { VRM } from "@pixiv/three-vrm";

function createAdaptiveVrm(options: { iris?: boolean } = {}): {
  vrm: VRM;
  face: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  iris: THREE.Mesh<THREE.BufferGeometry, THREE.Material> | null;
} {
  const scene = new THREE.Group();
  const head = new THREE.Group();
  head.name = "HeadBone";
  const leftEye = new THREE.Group();
  leftEye.name = "LeftEyeBone";
  leftEye.position.set(-0.1, 0.1, 0.18);
  const rightEye = new THREE.Group();
  rightEye.name = "RightEyeBone";
  rightEye.position.set(0.1, 0.1, 0.18);
  head.add(leftEye, rightEye);
  scene.add(head);

  const faceGeometry = new THREE.SphereGeometry(0.3, 20, 14);
  faceGeometry.scale(1, 1.18, 0.82);
  const face = new THREE.Mesh(faceGeometry, new THREE.MeshBasicMaterial());
  face.name = "FaceSkin";
  scene.add(face);

  let iris: THREE.Mesh<THREE.BufferGeometry, THREE.Material> | null = null;
  if (options.iris) {
    iris = new THREE.Mesh(new THREE.CircleGeometry(0.04, 16), new THREE.MeshBasicMaterial());
    iris.name = "LeftIris";
    iris.position.copy(leftEye.position);
    scene.add(iris);
  }

  const bones = new Map<string, THREE.Object3D>([
    ["head", head],
    ["leftEye", leftEye],
    ["rightEye", rightEye],
  ]);
  const vrm = {
    scene,
    humanoid: {
      getNormalizedBoneNode: (name: string) => bones.get(name) ?? null,
      getRawBoneNode: (name: string) => bones.get(name) ?? null,
    },
  } as unknown as VRM;
  return { vrm, face, iris };
}

function copyPositions(geometry: THREE.BufferGeometry): Float32Array {
  const position = geometry.getAttribute("position");
  const values = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    values[index * 3] = position.getX(index);
    values[index * 3 + 1] = position.getY(index);
    values[index * 3 + 2] = position.getZ(index);
  }
  return values;
}

function maximumDelta(left: Float32Array, right: Float32Array): number {
  let maximum = 0;
  for (let index = 0; index < left.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(left[index] - right[index]));
  }
  return maximum;
}

describe("studio-vrm-adaptive-face-deformer", () => {
  it("discovers bounded adaptive controls from a face mesh and humanoid landmarks", () => {
    const { vrm } = createAdaptiveVrm({ iris: true });
    const profile = inspectStudioVrmAdaptiveFaceProfile(vrm);

    expect(profile.status).toBe("ready");
    expect(profile.meshCount).toBeGreaterThanOrEqual(2);
    expect(profile.capabilities.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        "eyeSize",
        "eyeSpacing",
        "eyeTilt",
        "irisSize",
        "noseHeight",
        "noseWidth",
        "mouthWidth",
        "lipFullness",
        "earSize",
      ]),
    );
  });

  it("replaces geometry reversibly without mutating the source buffer", () => {
    const { vrm, face } = createAdaptiveVrm();
    const originalGeometry = face.geometry;
    const originalPositions = copyPositions(originalGeometry);

    const release = applyStudioVrmAdaptiveFaceMorphs(vrm, {
      eyeSize: 0.7,
      noseWidth: 0.55,
      mouthWidth: -0.35,
      lipFullness: 0.45,
    });

    expect(face.geometry).not.toBe(originalGeometry);
    const changedPositions = copyPositions(face.geometry);
    expect(maximumDelta(originalPositions, changedPositions)).toBeGreaterThan(0.001);
    expect(maximumDelta(originalPositions, changedPositions)).toBeLessThan(0.1);
    expect(copyPositions(originalGeometry)).toEqual(originalPositions);

    release();
    expect(face.geometry).toBe(originalGeometry);
    expect(copyPositions(face.geometry)).toEqual(originalPositions);
  });

  it("lets native semantic channels exclude the matching adaptive correction", () => {
    const { vrm, face } = createAdaptiveVrm();
    const originalGeometry = face.geometry;
    const release = applyStudioVrmAdaptiveFaceMorphs(
      vrm,
      { eyeSize: 1 },
      new Set(["eyeSize"]),
    );

    expect(face.geometry).toBe(originalGeometry);
    release();
    expect(face.geometry).toBe(originalGeometry);
  });

  it("scales a separately named iris mesh while preserving its original geometry", () => {
    const { vrm, iris } = createAdaptiveVrm({ iris: true });
    if (!iris) throw new Error("missing iris");
    const originalGeometry = iris.geometry;
    const before = copyPositions(originalGeometry);
    const release = applyStudioVrmAdaptiveFaceMorphs(vrm, { irisSize: 0.8 });

    expect(iris.geometry).not.toBe(originalGeometry);
    expect(maximumDelta(before, copyPositions(iris.geometry))).toBeGreaterThan(0.002);
    release();
    expect(iris.geometry).toBe(originalGeometry);
  });
});
