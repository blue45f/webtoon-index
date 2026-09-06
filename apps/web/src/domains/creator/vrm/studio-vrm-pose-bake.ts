import * as THREE from "three";

import { STUDIO_HUMANOID_BONE_NAMES } from "../studio-humanoid-bones";

import type { PoseBoneMap, Vec3 } from "./studio-vrm-poser-utils";
import type { VRMHumanBoneName } from "@pixiv/three-vrm";

const QUATERNION_EPSILON = 1e-12;

/** The complete semantic VRM vocabulary, shared with portable pose materials. */
export const STUDIO_VRM_DIRECT_EDIT_BONES: readonly VRMHumanBoneName[] =
  STUDIO_HUMANOID_BONE_NAMES;

export interface StudioVrmRuntimePoseSource {
  humanoid?: {
    getNormalizedBoneNode(name: VRMHumanBoneName): THREE.Object3D | null;
  } | null;
  scene?: {
    position?: { y?: number };
  } | null;
}

export interface StudioVrmBakedRuntimePose {
  bones: PoseBoneMap;
  yOffset: number;
}

export function canonicalizeStudioVrmPoseAngle(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = ((value + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function finiteQuaternion(node: THREE.Object3D): THREE.Quaternion | null {
  const quaternion = node.quaternion;
  if (
    ![quaternion.x, quaternion.y, quaternion.z, quaternion.w].every(Number.isFinite)
    || quaternion.lengthSq() <= QUATERNION_EPSILON
  ) {
    return null;
  }
  return quaternion.clone().normalize();
}

/**
 * Converts the currently rendered normalized-bone quaternion into the rotation-only authored form.
 * This is the transaction boundary that prevents a direction-authored preset from snapping to zero
 * on its first slider, gizmo, or IK edit.
 */
export function bakeStudioVrmRuntimeBoneRotation(node: THREE.Object3D): Vec3 | null {
  const quaternion = finiteQuaternion(node);
  if (!quaternion) return null;
  const euler = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
  const rotation = [
    canonicalizeStudioVrmPoseAngle(euler.x),
    canonicalizeStudioVrmPoseAngle(euler.y),
    canonicalizeStudioVrmPoseAngle(euler.z),
  ] as const;
  return rotation.every(Number.isFinite) ? rotation : null;
}

export function bakeStudioVrmRuntimePose(
  source: StudioVrmRuntimePoseSource,
  bones: readonly VRMHumanBoneName[] = STUDIO_VRM_DIRECT_EDIT_BONES
): StudioVrmBakedRuntimePose | null {
  const humanoid = source.humanoid;
  if (!humanoid) return null;
  const baked: PoseBoneMap = {};
  const seen = new Set<VRMHumanBoneName>();
  for (const boneName of bones) {
    if (seen.has(boneName)) continue;
    seen.add(boneName);
    const node = humanoid.getNormalizedBoneNode(boneName);
    if (!node) continue;
    const rotation = bakeStudioVrmRuntimeBoneRotation(node);
    if (rotation) baked[boneName] = { rotation };
  }
  const sceneY = source.scene?.position?.y;
  return {
    bones: baked,
    yOffset: typeof sceneY === "number" && Number.isFinite(sceneY) ? sceneY : 0,
  };
}
