import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  applyStudioVrmSemanticFaceMorphs,
  inspectStudioVrmSemanticFaceMorphProfile,
} from "./studio-vrm-semantic-face-morph";

import type { VRM } from "@pixiv/three-vrm";

function vrmWithMorphs(names: readonly string[], baselines?: readonly number[]): VRM {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.4, 18, 12), new THREE.MeshBasicMaterial());
  mesh.name = "FaceSkin";
  mesh.morphTargetDictionary = Object.fromEntries(names.map((name, index) => [name, index]));
  mesh.morphTargetInfluences = names.map((_, index) => baselines?.[index] ?? 0);
  scene.add(mesh);
  return { scene } as unknown as VRM;
}

function firstMorphMesh(vrm: VRM): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  vrm.scene.traverse((object) => {
    if (!found && (object as THREE.Mesh).isMesh) found = object as THREE.Mesh;
  });
  if (!found) throw new Error("missing morph mesh");
  return found;
}

describe("studio-vrm-semantic-face-morph", () => {
  it("admits exact semantic aliases while excluding expression morphs", () => {
    const vrm = vrmWithMorphs([
      "Face_EyeSizeBig",
      "face_eye_size_small",
      "Fcl_EYE_Blink",
      "Fcl_MTH_A",
      "Joy",
    ]);
    const profile = inspectStudioVrmSemanticFaceMorphProfile(vrm);
    const eyeSize = profile.controls.find((control) => control.id === "eyeSize");

    expect(profile.status).toBe("ready");
    expect(eyeSize).toMatchObject({
      id: "eyeSize",
      minimum: -1,
      maximum: 1,
      positiveTargetCount: 1,
      negativeTargetCount: 1,
      provider: "native-morph",
    });
    expect(profile.nativeTargetCount).toBe(2);
    expect(eyeSize?.targetNames).not.toContain("Fcl_EYE_Blink");
  });

  it("applies positive and negative native targets from an exact captured baseline", () => {
    const vrm = vrmWithMorphs(
      ["eyeSizeBig", "eyeSizeSmall", "noseWidthWide"],
      [0.2, 0.1, 0.25],
    );
    const mesh = firstMorphMesh(vrm);
    const releasePositive = applyStudioVrmSemanticFaceMorphs(vrm, {
      eyeSize: 0.5,
      noseWidth: 0.4,
    });

    expect(mesh.morphTargetInfluences?.[0]).toBeCloseTo(0.6);
    expect(mesh.morphTargetInfluences?.[1]).toBeCloseTo(0.1);
    expect(mesh.morphTargetInfluences?.[2]).toBeCloseTo(0.55);

    releasePositive();
    expect(mesh.morphTargetInfluences).toEqual([0.2, 0.1, 0.25]);

    const releaseNegative = applyStudioVrmSemanticFaceMorphs(vrm, { eyeSize: -0.75 });
    expect(mesh.morphTargetInfluences?.[0]).toBeCloseTo(0.2);
    expect(mesh.morphTargetInfluences?.[1]).toBeCloseTo(0.775);
    releaseNegative();
    expect(mesh.morphTargetInfluences).toEqual([0.2, 0.1, 0.25]);
  });

  it("reports one-sided native ranges without inventing the missing direction", () => {
    const positiveOnly = inspectStudioVrmSemanticFaceMorphProfile(
      vrmWithMorphs(["avatarMouthWidthWide"]),
    );
    expect(positiveOnly.controls.find((control) => control.id === "mouthWidth")).toMatchObject({
      provider: "native-morph",
      minimum: 0,
      maximum: 1,
    });

    const negativeOnly = inspectStudioVrmSemanticFaceMorphProfile(
      vrmWithMorphs(["blendshapeEarSizeSmall"]),
    );
    expect(negativeOnly.controls.find((control) => control.id === "earSize")).toMatchObject({
      provider: "native-morph",
      minimum: -1,
      maximum: 0,
    });
  });

  it("fills missing semantics with adaptive mesh controls while expressions stay unclaimed", () => {
    const profile = inspectStudioVrmSemanticFaceMorphProfile(
      vrmWithMorphs(["Blink", "Fcl_EYE_Joy", "Fcl_MTH_A", "Surprised"]),
    );
    expect(profile.status).toBe("ready");
    expect(profile.nativeTargetCount).toBe(0);
    expect(profile.adaptiveMeshCount).toBeGreaterThan(0);
    expect(profile.controls.some((control) => control.provider === "adaptive-mesh")).toBe(true);
    expect(profile.controls.flatMap((control) => control.targetNames)).not.toContain("Fcl_EYE_Joy");
  });

  it("lets an exact native channel win while adapting a different missing semantic", () => {
    const vrm = vrmWithMorphs(["eyeSizeBig"]);
    const mesh = firstMorphMesh(vrm);
    const originalGeometry = mesh.geometry;
    const release = applyStudioVrmSemanticFaceMorphs(vrm, {
      eyeSize: 0.6,
      mouthWidth: 0.5,
    });
    expect(mesh.morphTargetInfluences?.[0]).toBeCloseTo(0.6);
    expect(mesh.geometry).not.toBe(originalGeometry);
    release();
    expect(mesh.morphTargetInfluences?.[0]).toBe(0);
    expect(mesh.geometry).toBe(originalGeometry);
  });

  it("fails closed only when neither native nor adaptive geometry is available", () => {
    const profile = inspectStudioVrmSemanticFaceMorphProfile({
      scene: new THREE.Group(),
    } as unknown as VRM);
    expect(profile.status).toBe("unavailable");
    expect(profile.controls).toEqual([]);
    expect(profile.targetCount).toBe(0);
    expect(profile.adaptiveMeshCount).toBe(0);
  });
});
