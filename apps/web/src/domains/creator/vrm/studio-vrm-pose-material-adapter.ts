import * as THREE from "three";

import {
  getStudioHumanoidBoneDescriptor,
  studioHumanoidBonesForScope,
  type StudioHumanoidBoneName,
  type StudioPoseScope,
} from "../studio-humanoid-bones";
import {
  createStudioPoseMaterialMergePlan,
  parseStudioPoseMaterial,
  STUDIO_POSE_MATERIAL_KIND,
  STUDIO_POSE_MATERIAL_VERSION,
  STUDIO_POSE_ROTATION_CONVENTION,
  type StudioPoseMaterial,
} from "../studio-pose-material";
import { blendStudioPoseMaterialMergePlan } from "../studio-pose-material-blend";

import { bakeStudioVrmRuntimeBoneRotation } from "./studio-vrm-pose-bake";

import type { FingerRotationMap, PoseBoneMap } from "./studio-vrm-poser-utils";
import type { VRMHumanBoneName, VRMPose } from "@pixiv/three-vrm";

export interface StudioVrmPoseMaterialRuntime {
  readonly humanoid?: {
    getNormalizedPose(): VRMPose;
    setNormalizedPose(pose: VRMPose): void;
    getNormalizedBoneNode(name: VRMHumanBoneName): THREE.Object3D | null;
  } | null;
}

export interface StudioVrmPoseMaterialCaptureOptions {
  readonly id: string;
  readonly name: string;
  readonly scope: StudioPoseScope;
  readonly description?: string;
  readonly tags?: readonly string[];
}

export interface StudioVrmPoseMaterialApplyOptions {
  readonly scope?: StudioPoseScope;
  readonly lockedBones?: readonly StudioHumanoidBoneName[];
  /** Strength in `[0, 1]` blending material rotations toward rest identity. Default `1`. */
  readonly strength?: number;
  readonly bones: PoseBoneMap;
  readonly fingerEdits: FingerRotationMap;
}

export interface StudioVrmPoseMaterialApplyResult {
  readonly materialId: string;
  readonly requestedScope: StudioPoseScope;
  readonly bones: PoseBoneMap;
  readonly fingerEdits: FingerRotationMap;
  readonly appliedBones: readonly StudioHumanoidBoneName[];
  readonly skippedLocked: readonly StudioHumanoidBoneName[];
  readonly skippedOutsideScope: readonly StudioHumanoidBoneName[];
  readonly skippedMissing: readonly StudioHumanoidBoneName[];
}

type RuntimeOperation = Readonly<{
  bone: StudioHumanoidBoneName;
  node: THREE.Object3D;
  rotation: [number, number, number, number];
}>;

function readOwnDataValue(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function copyFiniteTuple<const Length extends number>(
  raw: unknown,
  length: Length,
): number[] | null {
  if (!Array.isArray(raw) || raw.length !== length) return null;
  try {
    if (Object.getPrototypeOf(raw) !== Array.prototype) return null;
    const tuple: number[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
      if (
        !descriptor ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true ||
        typeof descriptor.value !== "number" ||
        !Number.isFinite(descriptor.value)
      ) {
        return null;
      }
      tuple.push(descriptor.value);
    }
    return tuple;
  } catch {
    return null;
  }
}

function readNormalizedRotation(
  pose: unknown,
  bone: StudioHumanoidBoneName,
): [number, number, number, number] | null {
  const transform = readOwnDataValue(pose, bone);
  const tuple = copyFiniteTuple(readOwnDataValue(transform, "rotation"), 4);
  return tuple ? [tuple[0]!, tuple[1]!, tuple[2]!, tuple[3]!] : null;
}

function findNormalizedBoneNode(
  runtime: StudioVrmPoseMaterialRuntime,
  bone: StudioHumanoidBoneName,
): THREE.Object3D | null {
  try {
    return runtime.humanoid?.getNormalizedBoneNode(bone) ?? null;
  } catch {
    return null;
  }
}

/** Captures only portable, rest-relative normalized rotations; position and model paths are ignored. */
export function captureStudioVrmPoseMaterial(
  runtime: StudioVrmPoseMaterialRuntime,
  options: StudioVrmPoseMaterialCaptureOptions,
): StudioPoseMaterial | null {
  const humanoid = runtime.humanoid;
  if (!humanoid) return null;

  let normalizedPose: VRMPose;
  try {
    normalizedPose = humanoid.getNormalizedPose();
  } catch {
    return null;
  }

  const bones = studioHumanoidBonesForScope(options.scope).flatMap((bone) => {
    if (!findNormalizedBoneNode(runtime, bone)) return [];
    const rotation = readNormalizedRotation(normalizedPose, bone);
    return rotation ? [{ bone, rotation }] : [];
  });
  if (bones.length === 0) return null;

  return parseStudioPoseMaterial({
    kind: STUDIO_POSE_MATERIAL_KIND,
    version: STUDIO_POSE_MATERIAL_VERSION,
    rotationConvention: STUDIO_POSE_ROTATION_CONVENTION,
    id: options.id,
    name: options.name,
    scope: options.scope,
    bones,
    metadata: {
      description: options.description ?? "",
      tags: Array.isArray(options.tags) ? options.tags.slice() : [],
    },
  });
}

function restoreNormalizedPose(
  humanoid: NonNullable<StudioVrmPoseMaterialRuntime["humanoid"]>,
  pose: VRMPose,
): void {
  try {
    humanoid.setNormalizedPose(pose);
  } catch {
    // The caller already treats the whole operation as failed. A second exception must not mask it.
  }
}

/**
 * Applies a strict merge plan to three-vrm, projects the visible normalized nodes back into the
 * existing Euler authoring state, and rolls the runtime back if any projection step fails.
 */
export function applyStudioVrmPoseMaterial(
  runtime: StudioVrmPoseMaterialRuntime,
  material: StudioPoseMaterial,
  options: StudioVrmPoseMaterialApplyOptions,
): StudioVrmPoseMaterialApplyResult | null {
  const humanoid = runtime.humanoid;
  if (!humanoid) return null;
  const basePlan = createStudioPoseMaterialMergePlan(material, {
    scope: options.scope ?? material.scope,
    lockedBones: options.lockedBones ?? [],
  });
  if (!basePlan) return null;
  const plan =
    options.strength === undefined
      ? basePlan
      : blendStudioPoseMaterialMergePlan(basePlan, options.strength);

  let currentPose: VRMPose;
  try {
    currentPose = humanoid.getNormalizedPose();
  } catch {
    return null;
  }

  const runtimeOperations: RuntimeOperation[] = [];
  const skippedMissing: StudioHumanoidBoneName[] = [];
  const rollbackPose: VRMPose = {};
  for (const operation of plan.operations) {
    const node = findNormalizedBoneNode(runtime, operation.bone);
    if (!node) {
      skippedMissing.push(operation.bone);
      continue;
    }
    const previousRotation = readNormalizedRotation(currentPose, operation.bone);
    if (!previousRotation) return null;
    rollbackPose[operation.bone] = { rotation: previousRotation };
    runtimeOperations.push({
      bone: operation.bone,
      node,
      rotation: [
        operation.rotation[0],
        operation.rotation[1],
        operation.rotation[2],
        operation.rotation[3],
      ],
    });
  }

  const nextBones: PoseBoneMap = { ...options.bones };
  const nextFingerEdits: FingerRotationMap = { ...options.fingerEdits };
  if (runtimeOperations.length === 0) {
    return Object.freeze({
      materialId: plan.materialId,
      requestedScope: plan.requestedScope,
      bones: nextBones,
      fingerEdits: nextFingerEdits,
      appliedBones: Object.freeze([]),
      skippedLocked: plan.skippedLocked,
      skippedOutsideScope: plan.skippedOutsideScope,
      skippedMissing: Object.freeze(skippedMissing),
    });
  }

  const applyPose: VRMPose = {};
  for (const operation of runtimeOperations) {
    // three-vrm mutates tuple-backed transforms in some versions; never pass frozen wire data.
    applyPose[operation.bone] = { rotation: [...operation.rotation] };
  }

  try {
    humanoid.setNormalizedPose(applyPose);
  } catch {
    restoreNormalizedPose(humanoid, rollbackPose);
    return null;
  }

  const projected = new Map<StudioHumanoidBoneName, readonly [number, number, number]>();
  for (const operation of runtimeOperations) {
    const rotation = bakeStudioVrmRuntimeBoneRotation(operation.node);
    if (!rotation) {
      restoreNormalizedPose(humanoid, rollbackPose);
      return null;
    }
    projected.set(operation.bone, rotation);
  }

  const appliedBones: StudioHumanoidBoneName[] = [];
  for (const operation of runtimeOperations) {
    const rotation = projected.get(operation.bone);
    if (!rotation) continue;
    if (getStudioHumanoidBoneDescriptor(operation.bone).region === "finger") {
      delete nextBones[operation.bone];
      nextFingerEdits[operation.bone] = rotation;
    } else {
      nextBones[operation.bone] = { rotation };
    }
    appliedBones.push(operation.bone);
  }

  return Object.freeze({
    materialId: plan.materialId,
    requestedScope: plan.requestedScope,
    bones: nextBones,
    fingerEdits: nextFingerEdits,
    appliedBones: Object.freeze(appliedBones),
    skippedLocked: plan.skippedLocked,
    skippedOutsideScope: plan.skippedOutsideScope,
    skippedMissing: Object.freeze(skippedMissing),
  });
}
