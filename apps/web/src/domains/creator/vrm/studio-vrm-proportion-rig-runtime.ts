/**
 * Avatar Forge v4 proportion runtime.
 *
 * `studio-vrm-proportion-core` intentionally stops at engine-neutral targets. This module owns the
 * narrow Three.js integration boundary: it captures one raw humanoid generation, translates the
 * logical humanoid-parent targets back into each node's real local parent space, and runs the
 * normalized-rig/spring/pose lifecycle in a deterministic order.
 *
 * The runtime never stretches a bone with a non-uniform scale. Length edits are absolute joint
 * translations from the captured rest hierarchy; head/hand/foot edits multiply an already-uniform
 * local rest scale by one scalar. Non-humanoid intermediary parents are supported as long as their
 * transforms are finite and uniformly scaled.
 */

import * as THREE from "three";

import {
  STUDIO_HUMANOID_BONE_NAMES,
  getStudioHumanoidBoneDescriptor,
  type StudioHumanoidBoneName,
} from "../studio-humanoid-bones";

import {
  NEUTRAL_STUDIO_VRM_PROPORTIONS,
  STUDIO_VRM_PROPORTION_PRESETS,
  STUDIO_VRM_REQUIRED_HUMANOID_BONES,
  STUDIO_VRM_UNIFORM_SCALE_SUBTREE_ROOTS,
  resolveVrmProportionBoneTargets,
  resolveVrmProportionPlan,
  sanitizeStudioVrmProportions,
  validateStudioVrmProportionPlan,
  type StudioVrmBoneHierarchySnapshot,
  type StudioVrmProportionBoneTarget,
  type StudioVrmProportionMetrics,
  type StudioVrmProportions,
  type StudioVrmVec3,
} from "./studio-vrm-proportion-core";

export const STUDIO_VRM_PROPORTION_RIG_RUNTIME_VERSION = 1 as const;

export type StudioVrmProportionModelGeneration = string | number;

/**
 * A deliberately small adapter around `VRMHumanoid` and the currently authored pose.
 *
 * `rebuildNormalizedRig` must use a distinct fresh `VRMHumanoid` source built from rawHumanBones;
 * self-copy is not a supported contract. The adapter also owns normalized-root attachment: save the
 * old normalized root's parent/sibling position, copy from the fresh source, remove the old root,
 * and attach the replacement root at that position. The authored-pose callback is required so a
 * normalized rebuild can never silently erase the pose.
 */
export type StudioVrmProportionRigAdapter = {
  /** Model/VRM scene root used as the logical parent frame of hips. */
  readonly root: THREE.Object3D;
  /** Must change before a replacement model becomes externally addressable. */
  readonly getModelGeneration: () => StudioVrmProportionModelGeneration;
  readonly getRawBoneNode: (name: StudioHumanoidBoneName) => THREE.Object3D | null;
  /**
   * Must temporarily make `root` identity TRS, explicitly reset raw and normalized pose, call
   * humanoid.update(), and update matrices. Root translation/yaw/bodyScale must be restored by
   * reapplyAuthoredPose.
   */
  readonly resetNormalizedPoseAndSyncRawRest: () => boolean | void;
  readonly rebuildNormalizedRig: () => boolean | void;
  /** Must call nodeConstraintManager.setInitState(); omission means the VRM has no manager. */
  readonly setNodeConstraintInitState?: () => boolean | void;
  /** Must call springBoneManager.setInitState(); `reset()` is not an equivalent substitute. */
  readonly setSpringBoneInitState?: () => boolean | void;
  /**
   * Rescales spring-bone collider shapes and spring-joint hit radii to the body's new size,
   * absolute from their authored rest so repeated applies cannot accumulate. `setInitState()`
   * recaptures joint rest only -- it never touches collider geometry -- so without this a collider
   * keeps the size it was authored at while the body around it grows, and hair passes straight
   * through the torso it was meant to ride on.
   *
   * `scaledSubtreeRoots` are the bone nodes this runtime gives a uniform scale to. Everything
   * beneath one of them is carried whole by the scene graph; everything else only sees its joints
   * move apart by `uniformScale`. The set is passed rather than inferred because the two cases are
   * a matter of **membership**, not of magnitude -- `overallHeight` 1.25 with `headBodyRatio` 0.8
   * leaves `head` at exactly 1, and reading that 1 as "not a scaled bone" would stretch the skull
   * capsules 25% around a head that never grew.
   */
  readonly syncSpringBoneColliderShapes?: (
    uniformScale: number,
    scaledSubtreeRoots: ReadonlySet<THREE.Object3D>,
  ) => boolean | void;
  readonly reapplyAuthoredPose: () => boolean | void;
};

export type StudioVrmProportionRigRuntimeOptions = {
  /** Head joint to crown distance, expressed in the root's local unit. */
  readonly headLength: number;
  /** Optional provenance retained so UI/capture layers can distinguish measured and estimated data. */
  readonly headMeasurement?: StudioVrmProportionHeadMeasurementProvenance;
};

export type StudioVrmProportionHeadMeasurementProvenance = {
  readonly version: string | number;
  readonly source: string;
  readonly reliable: boolean;
};

export type StudioVrmProportionRigStage =
  | "reset-normalized-pose-and-sync-raw-rest"
  | "write-raw-proportion-targets"
  | "rebuild-normalized-rig"
  | "set-node-constraint-init-state"
  | "node-constraint-state-unavailable"
  | "set-spring-bone-init-state"
  | "spring-bone-state-unavailable"
  | "sync-spring-bone-colliders"
  | "spring-bone-colliders-unavailable"
  | "reapply-authored-pose";

export type StudioVrmProportionRigOperation = "apply" | "restore" | "dispose";

export type StudioVrmProportionRigWorldPosition = {
  readonly boneName: StudioHumanoidBoneName;
  /** Root-local position after proportion writes and before the authored pose is reapplied. */
  readonly position: StudioVrmVec3;
};

export type StudioVrmProportionRigReceipt = {
  readonly ok: true;
  readonly runtimeVersion: typeof STUDIO_VRM_PROPORTION_RIG_RUNTIME_VERSION;
  readonly operation: StudioVrmProportionRigOperation;
  readonly modelGeneration: StudioVrmProportionModelGeneration;
  /** Monotonic within one runtime, including failed attempts. */
  readonly applyGeneration: number;
  /** Sanitized user-authored/persisted values. */
  readonly authoredProportions: StudioVrmProportions;
  /** Values resolved against this model's measured rest hierarchy. */
  readonly runtimeProportions: StudioVrmProportions;
  readonly presetResolution: StudioVrmProportionRigPresetResolution | null;
  readonly headMeasurement: StudioVrmProportionHeadMeasurementProvenance | null;
  readonly targets: readonly StudioVrmProportionBoneTarget[];
  readonly worldPositions: readonly StudioVrmProportionRigWorldPosition[];
  readonly metrics: StudioVrmProportionMetrics;
  readonly stages: readonly StudioVrmProportionRigStage[];
};

export type StudioVrmProportionRigPresetResolution = {
  readonly presetId: string;
  readonly targetHeadUnits: number;
  readonly authoredHeadBodyRatio: number;
  readonly runtimeHeadBodyRatio: number;
  /** Actual value derived from the written root-local joint positions and measured head length. */
  readonly achievedHeadUnits: number;
  /** True when the model-specific ratio had to stop at the authored safety limits. */
  readonly clamped: boolean;
};

export type StudioVrmProportionRigFailureCode =
  | "disposed"
  | "invalid-proportion-plan"
  | "lifecycle-failed"
  | "lifecycle-recovery-failed"
  | "stale-model-generation";

export type StudioVrmProportionRigRecovery = "not-needed" | "restored" | "reload-required";

export type StudioVrmProportionRigFailure = {
  readonly ok: false;
  readonly runtimeVersion: typeof STUDIO_VRM_PROPORTION_RIG_RUNTIME_VERSION;
  readonly operation: StudioVrmProportionRigOperation;
  readonly code: StudioVrmProportionRigFailureCode;
  readonly modelGeneration: StudioVrmProportionModelGeneration;
  readonly observedModelGeneration: StudioVrmProportionModelGeneration | null;
  readonly applyGeneration: number;
  readonly recovery: StudioVrmProportionRigRecovery;
  readonly message: string;
};

export type StudioVrmProportionRigApplyResult =
  | StudioVrmProportionRigReceipt
  | StudioVrmProportionRigFailure;

export type StudioVrmProportionRigCreateFailureCode =
  | "duplicate-bone-node"
  | "disconnected-bone"
  | "invalid-adapter"
  | "invalid-head-length"
  | "invalid-hierarchy"
  | "invalid-model-generation"
  | "missing-required-bone"
  | "unsafe-transform";

export type StudioVrmProportionRigCreateFailure = {
  readonly ok: false;
  readonly code: StudioVrmProportionRigCreateFailureCode;
  readonly boneName?: StudioHumanoidBoneName;
  readonly message: string;
};

export type StudioVrmProportionRigRuntime = {
  readonly runtimeVersion: typeof STUDIO_VRM_PROPORTION_RIG_RUNTIME_VERSION;
  readonly modelGeneration: StudioVrmProportionModelGeneration;
  readonly snapshot: StudioVrmBoneHierarchySnapshot;
  readonly disposed: boolean;
  readonly apply: (proportions: unknown) => StudioVrmProportionRigApplyResult;
  readonly restore: () => StudioVrmProportionRigApplyResult;
  readonly dispose: () => StudioVrmProportionRigApplyResult;
};

export type StudioVrmProportionRigCreateResult =
  | {
      readonly ok: true;
      readonly runtime: StudioVrmProportionRigRuntime;
    }
  | StudioVrmProportionRigCreateFailure;

type CapturedBone = {
  readonly name: StudioHumanoidBoneName;
  readonly node: THREE.Object3D;
  readonly semanticParentName: StudioHumanoidBoneName | null;
  readonly semanticFrame: THREE.Object3D;
  readonly immediateParent: THREE.Object3D;
  readonly restLocalPosition: THREE.Vector3;
  readonly restLocalScale: THREE.Vector3;
  readonly restLogicalOffset: StudioVrmVec3;
  /** False when no other humanoid bone sits beneath this one, which is what licenses a non-uniform sculpt scale. */
  readonly carriesHumanoidDescendant: boolean;
};

type OwnedTransform = {
  readonly node: THREE.Object3D;
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  readonly scale: THREE.Vector3;
};

// glTF stores node transforms as float32. Values authored as an exact uniform scale can therefore
// arrive one or two ULPs apart (for example 1 / 1.00000012 / 1). Keep materially non-uniform
// hierarchies fail-closed, while admitting that serialization noise. Non-neutral writes below
// collapse the admitted noise back to one scalar so the proportion runtime never amplifies it.
const SCALE_EPSILON = 1e-6;
const TRANSFORM_EPSILON = 1e-12;
const QUATERNION_UNIT_EPSILON = 1e-6;
const PRESET_RATIO_EPSILON = 1e-9;

function freezeVec3(x: number, y: number, z: number): StudioVrmVec3 {
  return Object.freeze([x, y, z]) as StudioVrmVec3;
}

function freezeProportions(proportions: StudioVrmProportions): StudioVrmProportions {
  return Object.freeze({ ...proportions });
}

function freezeTarget(target: StudioVrmProportionBoneTarget): StudioVrmProportionBoneTarget {
  return Object.freeze({
    boneName: target.boneName,
    position: freezeVec3(target.position[0], target.position[1], target.position[2]),
    scale: target.scale,
  });
}

function freezeMetrics(metrics: StudioVrmProportionMetrics): StudioVrmProportionMetrics {
  return Object.freeze({ ...metrics });
}

function freezeHeadMeasurementProvenance(
  value: StudioVrmProportionHeadMeasurementProvenance | undefined
): StudioVrmProportionHeadMeasurementProvenance | null {
  if (!value) return null;
  const validVersion =
    (typeof value.version === "number" && Number.isFinite(value.version)) ||
    (typeof value.version === "string" && value.version.trim().length > 0);
  if (!validVersion || typeof value.source !== "string" || value.source.trim().length === 0) {
    return null;
  }
  return Object.freeze({
    version: value.version,
    source: value.source,
    reliable: value.reliable === true,
  });
}

function createFailure(
  code: StudioVrmProportionRigCreateFailureCode,
  message: string,
  boneName?: StudioHumanoidBoneName
): StudioVrmProportionRigCreateFailure {
  return Object.freeze({
    ok: false,
    code,
    ...(boneName ? { boneName } : {}),
    message,
  });
}

function isObject3D(value: unknown): value is THREE.Object3D {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly isObject3D?: unknown }).isObject3D === true
  );
}

function isValidGeneration(value: unknown): value is StudioVrmProportionModelGeneration {
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && value.trim().length > 0;
}

function allFinite(values: readonly number[]) {
  return values.every(Number.isFinite);
}

function isUniformPositiveScale(scale: THREE.Vector3) {
  if (!allFinite(scale.toArray()) || scale.x <= 0 || scale.y <= 0 || scale.z <= 0) return false;
  const magnitude = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
  const spread = Math.max(scale.x, scale.y, scale.z) - Math.min(scale.x, scale.y, scale.z);
  return spread <= SCALE_EPSILON * magnitude;
}

function isUnitQuaternion(quaternion: THREE.Quaternion) {
  if (!allFinite(quaternion.toArray())) return false;
  return Math.abs(quaternion.lengthSq() - 1) <= QUATERNION_UNIT_EPSILON;
}

function isFiniteInvertibleMatrix(matrix: THREE.Matrix4) {
  const determinant = matrix.determinant();
  return (
    allFinite(matrix.elements) &&
    Number.isFinite(determinant) &&
    Math.abs(determinant) > TRANSFORM_EPSILON
  );
}

function hasAutoUpdatedInvertibleLocalMatrix(node: THREE.Object3D) {
  if (node.matrixAutoUpdate !== true || node.matrixWorldAutoUpdate !== true) return false;
  return isFiniteInvertibleMatrix(
    new THREE.Matrix4().compose(node.position, node.quaternion, node.scale)
  );
}

function hasSafeTransform(node: THREE.Object3D) {
  return (
    allFinite(node.position.toArray()) &&
    isUnitQuaternion(node.quaternion) &&
    isUniformPositiveScale(node.scale) &&
    hasAutoUpdatedInvertibleLocalMatrix(node)
  );
}

/**
 * True when a non-uniform scale on `node` cannot reach anything rotatable below it.
 *
 * Humanoid membership is not the test -- a head with no eye or jaw bones can still carry an
 * accessory or spring hierarchy, and a rotation in there would inherit the shear. What makes the
 * sculpt safe is that every immediate child cancels the non-uniform part **without rotating**, which
 * is exactly what the generated avatar's inverse-scale `HairRoot` pivot does. A node with no children at all passes
 * vacuously.
 */
function containsNonUniformScale(node: THREE.Object3D) {
  if (isUniformPositiveScale(node.scale)) return true;
  return node.children.every((child) => {
    // The cancelling child must not rotate. `S . R . S^-1` is orthogonal only when `R` commutes with
    // `S`, so a rotation that mixes differently scaled axes still hands shear to everything below.
    if (!isUnitQuaternion(child.quaternion)) return false;
    if (Math.abs(child.quaternion.w) < 1 - QUATERNION_UNIT_EPSILON) return false;
    return isUniformPositiveScale(
      new THREE.Vector3(
        node.scale.x * child.scale.x,
        node.scale.y * child.scale.y,
        node.scale.z * child.scale.z,
      ),
    );
  });
}

/**
 * A leaf bone -- one with no humanoid bone beneath it -- may carry a non-uniform rest scale. That
 * is the sculpting convention (`studio-vrm-humanoid-rig.ts`): shape lives on leaves so no rotated
 * child inherits shear. Everything else must still be finite, positive and invertible.
 */
function hasSafeLeafTransform(node: THREE.Object3D) {
  return (
    allFinite(node.position.toArray()) &&
    isUnitQuaternion(node.quaternion) &&
    allFinite(node.scale.toArray()) &&
    node.scale.x > 0 &&
    node.scale.y > 0 &&
    node.scale.z > 0 &&
    hasAutoUpdatedInvertibleLocalMatrix(node)
  );
}

function hasSafeRootTransform(node: THREE.Object3D) {
  return (
    allFinite(node.position.toArray()) &&
    isUnitQuaternion(node.quaternion) &&
    allFinite(node.scale.toArray()) &&
    node.scale.x > 0 &&
    node.scale.y > 0 &&
    node.scale.z > 0 &&
    hasAutoUpdatedInvertibleLocalMatrix(node)
  );
}

function expectedPresentParent(
  name: StudioHumanoidBoneName,
  present: ReadonlySet<StudioHumanoidBoneName>
): StudioHumanoidBoneName | null {
  let parent = getStudioHumanoidBoneDescriptor(name).parent;
  while (parent && !present.has(parent)) {
    parent = getStudioHumanoidBoneDescriptor(parent).parent;
  }
  return parent;
}

function actualHumanoidParent(
  node: THREE.Object3D,
  root: THREE.Object3D,
  nameByNode: ReadonlyMap<THREE.Object3D, StudioHumanoidBoneName>
): { readonly connected: boolean; readonly parent: StudioHumanoidBoneName | null } {
  let cursor: THREE.Object3D | null = node.parent;
  while (cursor) {
    if (cursor === root) return { connected: true, parent: null };
    const humanoidName = nameByNode.get(cursor);
    if (humanoidName) return { connected: true, parent: humanoidName };
    cursor = cursor.parent;
  }
  return { connected: false, parent: null };
}

function rootChain(node: THREE.Object3D, root: THREE.Object3D) {
  const chain: THREE.Object3D[] = [];
  let cursor: THREE.Object3D | null = node;
  while (cursor) {
    chain.push(cursor);
    if (cursor === root) return chain;
    cursor = cursor.parent;
  }
  return null;
}

function readGeneration(adapter: StudioVrmProportionRigAdapter) {
  try {
    const value = adapter.getModelGeneration();
    return isValidGeneration(value)
      ? ({ ok: true, value } as const)
      : ({ ok: false, value: null } as const);
  } catch {
    return { ok: false, value: null } as const;
  }
}

function captureRawNodes(adapter: StudioVrmProportionRigAdapter) {
  const nodes = new Map<StudioHumanoidBoneName, THREE.Object3D>();
  const namesByNode = new Map<THREE.Object3D, StudioHumanoidBoneName>();

  for (const name of STUDIO_HUMANOID_BONE_NAMES) {
    let node: THREE.Object3D | null;
    try {
      node = adapter.getRawBoneNode(name);
    } catch {
      return createFailure("invalid-adapter", `Raw humanoid accessor failed for ${name}.`, name);
    }
    if (node === null) continue;
    if (!isObject3D(node)) {
      return createFailure("invalid-adapter", `Raw humanoid node ${name} is not a Three.js Object3D.`, name);
    }
    if (namesByNode.has(node)) {
      return createFailure(
        "duplicate-bone-node",
        `Raw humanoid node ${name} aliases ${namesByNode.get(node)}.`,
        name
      );
    }
    nodes.set(name, node);
    namesByNode.set(node, name);
  }

  return { ok: true, nodes, namesByNode } as const;
}

function captureHierarchy(
  adapter: StudioVrmProportionRigAdapter,
  headLength: number
):
  | {
      readonly ok: true;
      readonly captures: readonly CapturedBone[];
      readonly snapshot: StudioVrmBoneHierarchySnapshot;
    }
  | StudioVrmProportionRigCreateFailure {
  const rawNodes = captureRawNodes(adapter);
  if (!rawNodes.ok) return rawNodes;
  const { namesByNode, nodes } = rawNodes;
  const present = new Set(nodes.keys());

  for (const required of STUDIO_VRM_REQUIRED_HUMANOID_BONES) {
    if (!nodes.has(required)) {
      return createFailure("missing-required-bone", `Required VRM bone ${required} is missing.`, required);
    }
  }

  // A bone that carries no other humanoid bone beneath it may hold a non-uniform rest scale.
  // Sculpting rigs put shape on leaves exactly so nothing rotated can inherit shear, and this
  // runtime only ever multiplies that rest scale by a uniform factor. Requiring uniformity here
  // rejected every generated character whose face proportions differ from 1 -- 18 of the 21
  // shipped presets -- so the body sliders were unusable on them.
  const carryingFrames = new Set<THREE.Object3D>();
  for (const node of nodes.values()) {
    const chain = rootChain(node, adapter.root);
    if (!chain) continue;
    for (const frame of chain) {
      if (frame !== node) carryingFrames.add(frame);
    }
  }

  const checkedFrames = new Set<THREE.Object3D>();
  for (const [name, node] of nodes) {
    const chain = rootChain(node, adapter.root);
    if (!chain) {
      return createFailure("disconnected-bone", `Raw humanoid bone ${name} is outside the model root.`, name);
    }
    for (const frame of chain) {
      if (checkedFrames.has(frame)) continue;
      checkedFrames.add(frame);
      const safe =
        frame === adapter.root
          ? hasSafeRootTransform(frame)
          : carryingFrames.has(frame)
            ? hasSafeTransform(frame)
            : hasSafeLeafTransform(frame) && containsNonUniformScale(frame);
      if (!safe) {
        return createFailure(
          "unsafe-transform",
          `The root-to-${name} hierarchy contains a non-finite, non-positive, or non-uniform transform.`,
          name
        );
      }
    }

    const actual = actualHumanoidParent(node, adapter.root, namesByNode);
    if (!actual.connected) {
      return createFailure("disconnected-bone", `Raw humanoid bone ${name} has no path to the model root.`, name);
    }
    const expected = expectedPresentParent(name, present);
    if (actual.parent !== expected) {
      return createFailure(
        "invalid-hierarchy",
        `Raw humanoid bone ${name} has logical parent ${String(actual.parent)}, expected ${String(expected)}.`,
        name
      );
    }
  }

  adapter.root.updateMatrixWorld(true);
  const captures: CapturedBone[] = [];
  for (const name of STUDIO_HUMANOID_BONE_NAMES) {
    const node = nodes.get(name);
    if (!node) continue;
    const semanticParentName = expectedPresentParent(name, present);
    const semanticFrame = semanticParentName ? nodes.get(semanticParentName) : adapter.root;
    const immediateParent = node.parent;
    if (!semanticFrame || !immediateParent) {
      return createFailure("invalid-hierarchy", `Raw humanoid bone ${name} has no usable parent frame.`, name);
    }
    const logicalOffset = semanticFrame.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
    if (!allFinite(logicalOffset.toArray())) {
      return createFailure("unsafe-transform", `Raw humanoid rest offset ${name} is not finite.`, name);
    }
    captures.push({
      name,
      node,
      semanticParentName,
      semanticFrame,
      immediateParent,
      restLocalPosition: node.position.clone(),
      restLocalScale: node.scale.clone(),
      restLogicalOffset: freezeVec3(logicalOffset.x, logicalOffset.y, logicalOffset.z),
      carriesHumanoidDescendant: carryingFrames.has(node),
    });
  }

  const bones = Object.freeze(
    captures.map((capture) =>
      Object.freeze({
        name: capture.name,
        parent: capture.semanticParentName,
        restOffset: capture.restLogicalOffset,
      })
    )
  );
  const snapshot: StudioVrmBoneHierarchySnapshot = Object.freeze({ headLength, bones });
  return { ok: true, captures: Object.freeze(captures), snapshot };
}

function captureOwnedTransforms(
  root: THREE.Object3D,
  captures: readonly CapturedBone[]
): readonly OwnedTransform[] {
  return [root, ...captures.map(({ node }) => node)].map((node) => ({
    node,
    position: node.position.clone(),
    quaternion: node.quaternion.clone(),
    scale: node.scale.clone(),
  }));
}

function restoreOwnedTransforms(root: THREE.Object3D, transforms: readonly OwnedTransform[]) {
  for (const transform of transforms) {
    transform.node.position.copy(transform.position);
    transform.node.quaternion.copy(transform.quaternion);
    transform.node.scale.copy(transform.scale);
    transform.node.updateMatrix();
  }
  root.updateMatrixWorld(true);
}

function isExactRestTarget(capture: CapturedBone, target: StudioVrmProportionBoneTarget) {
  return (
    target.scale === 1 &&
    target.position[0] === capture.restLogicalOffset[0] &&
    target.position[1] === capture.restLogicalOffset[1] &&
    target.position[2] === capture.restLogicalOffset[2]
  );
}

function writeTargets(
  root: THREE.Object3D,
  captures: readonly CapturedBone[],
  targets: ReadonlyMap<StudioHumanoidBoneName, StudioVrmProportionBoneTarget>
) {
  const restoreExactRest = captures.every((capture) => {
    const target = targets.get(capture.name);
    return target ? isExactRestTarget(capture, target) : false;
  });
  for (const capture of captures) {
    const target = targets.get(capture.name);
    if (!target) return false;

    if (restoreExactRest) {
      // Exact cached local assignment is what makes neutral/dispose bit-for-bit reversible even
      // when a non-humanoid intermediary frame exists.
      capture.node.position.copy(capture.restLocalPosition);
      capture.node.scale.copy(capture.restLocalScale);
    } else {
      // A rest scale that is uniform within tolerance is float32 container noise, so collapse it
      // to its mean -- that is what keeps repeated applies from accumulating drift and keeps every
      // carrying frame exactly orthogonal. A rest scale that is genuinely non-uniform is a
      // deliberate sculpt on a leaf, and averaging it away would flatten the face the moment any
      // body slider moved. Either way the factor this runtime introduces stays uniform.
      if (isUniformPositiveScale(capture.restLocalScale)) {
        const restUniformScale =
          (capture.restLocalScale.x + capture.restLocalScale.y + capture.restLocalScale.z) / 3;
        capture.node.scale.setScalar(restUniformScale * target.scale);
      } else {
        capture.node.scale.set(
          capture.restLocalScale.x * target.scale,
          capture.restLocalScale.y * target.scale,
          capture.restLocalScale.z * target.scale,
        );
      }

      if (capture.immediateParent === capture.semanticFrame) {
        capture.node.position.set(target.position[0], target.position[1], target.position[2]);
      } else {
        root.updateMatrixWorld(true);
        const desiredWorld = new THREE.Vector3(...target.position).applyMatrix4(
          capture.semanticFrame.matrixWorld
        );
        if (!isFiniteInvertibleMatrix(capture.immediateParent.matrixWorld)) return false;
        const actualParentInverse = capture.immediateParent.matrixWorld.clone().invert();
        capture.node.position.copy(desiredWorld.applyMatrix4(actualParentInverse));
      }
    }
    const scaleStaysSafe = capture.carriesHumanoidDescendant
      ? isUniformPositiveScale(capture.node.scale)
      : allFinite(capture.node.scale.toArray()) &&
        capture.node.scale.x > 0 &&
        capture.node.scale.y > 0 &&
        capture.node.scale.z > 0 &&
        containsNonUniformScale(capture.node);
    if (!allFinite(capture.node.position.toArray()) || !scaleStaysSafe) {
      return false;
    }
    capture.node.updateMatrix();
    root.updateMatrixWorld(true);
  }
  return true;
}

function captureWorldPositions(
  root: THREE.Object3D,
  captures: readonly CapturedBone[]
): readonly StudioVrmProportionRigWorldPosition[] {
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  return Object.freeze(
    captures.map(({ name, node }) => {
      const position = node.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInverse);
      return Object.freeze({
        boneName: name,
        position: freezeVec3(position.x, position.y, position.z),
      });
    })
  );
}

function invokeLifecycle(callback: () => boolean | void) {
  try {
    return callback() !== false;
  } catch {
    return false;
  }
}

function distanceBetweenPositions(a: StudioVrmVec3, b: StudioVrmVec3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Derives the receipt from the transforms that were actually written, not an axis-only model. */
function resolveActualProportionMetrics(
  worldPositions: readonly StudioVrmProportionRigWorldPosition[],
  targets: ReadonlyMap<StudioHumanoidBoneName, StudioVrmProportionBoneTarget>,
  snapshot: StudioVrmBoneHierarchySnapshot
): StudioVrmProportionMetrics {
  const positions = new Map(
    worldPositions.map((entry) => [entry.boneName, entry.position] as const)
  );
  const head = positions.get("head");
  const hips = positions.get("hips");
  const foot = positions.get("leftFoot") ?? positions.get("rightFoot");
  const shoulder = positions.get("leftShoulder") ?? positions.get("leftUpperArm");
  const otherShoulder = positions.get("rightShoulder") ?? positions.get("rightUpperArm");
  const upperArm = positions.get("leftUpperArm");
  const upperLeg = positions.get("leftUpperLeg") ?? positions.get("rightUpperLeg");
  const hand = positions.get("leftHand");
  const headLength = snapshot.headLength * (targets.get("head")?.scale ?? 1);
  const totalHeight = (head?.[1] ?? 0) + headLength;

  return {
    totalHeight,
    headLength,
    headUnits: headLength > 0 ? totalHeight / headLength : 0,
    footHeight: foot?.[1] ?? 0,
    hipsHeight: hips?.[1] ?? 0,
    legLength: upperLeg && foot ? distanceBetweenPositions(upperLeg, foot) : 0,
    armLength: upperArm && hand ? distanceBetweenPositions(upperArm, hand) : 0,
    shoulderSpan:
      shoulder && otherShoulder ? distanceBetweenPositions(shoulder, otherShoulder) : 0,
  };
}

function resolveRuntimePreset(authored: StudioVrmProportions) {
  return authored.presetId
    ? STUDIO_VRM_PROPORTION_PRESETS.find((candidate) => candidate.id === authored.presetId) ?? null
    : null;
}

function resolveModelSpecificPresetProportions(
  authored: StudioVrmProportions,
  targetHeadUnits: number,
  actualHeadJointY: number,
  snapshot: StudioVrmBoneHierarchySnapshot
) {
  const denominator =
    snapshot.headLength * authored.overallHeight * Math.max(TRANSFORM_EPSILON, targetHeadUnits - 1);
  const requestedHeadBodyRatio = actualHeadJointY / denominator;
  const safeRequestedRatio = Number.isFinite(requestedHeadBodyRatio)
    ? requestedHeadBodyRatio
    : authored.headBodyRatio;
  const runtime = freezeProportions(
    sanitizeStudioVrmProportions({ ...authored, headBodyRatio: safeRequestedRatio })
  );
  return {
    runtime,
    clamped:
      !Number.isFinite(requestedHeadBodyRatio) ||
      Math.abs(runtime.headBodyRatio - requestedHeadBodyRatio) > PRESET_RATIO_EPSILON,
  } as const;
}

function resolveSafeTargets(
  proportions: StudioVrmProportions,
  snapshot: StudioVrmBoneHierarchySnapshot,
  expectedCount: number
):
  | { readonly ok: true; readonly targets: readonly StudioVrmProportionBoneTarget[] }
  | { readonly ok: false; readonly message: string } {
  const plan = resolveVrmProportionPlan(proportions, snapshot);
  const issues = validateStudioVrmProportionPlan(plan, snapshot);
  const rawTargets = resolveVrmProportionBoneTargets(proportions, snapshot);
  if (issues.length > 0 || rawTargets.length !== expectedCount) {
    return {
      ok: false,
      message: issues[0]?.message ?? "The resolved target set does not match the captured rig.",
    };
  }
  const targets = Object.freeze(rawTargets.map(freezeTarget));
  if (
    targets.some(
      (target) =>
        !Number.isFinite(target.scale) || target.scale <= 0 || !allFinite(target.position)
    )
  ) {
    return { ok: false, message: "The resolved proportion targets contain an unsafe transform." };
  }
  return { ok: true, targets };
}

function adapterContractIsValid(adapter: StudioVrmProportionRigAdapter) {
  return (
    isObject3D(adapter?.root) &&
    typeof adapter.getModelGeneration === "function" &&
    typeof adapter.getRawBoneNode === "function" &&
    typeof adapter.resetNormalizedPoseAndSyncRawRest === "function" &&
    typeof adapter.rebuildNormalizedRig === "function" &&
    (adapter.setNodeConstraintInitState === undefined ||
      typeof adapter.setNodeConstraintInitState === "function") &&
    (adapter.setSpringBoneInitState === undefined ||
      typeof adapter.setSpringBoneInitState === "function") &&
    (adapter.syncSpringBoneColliderShapes === undefined ||
      typeof adapter.syncSpringBoneColliderShapes === "function") &&
    typeof adapter.reapplyAuthoredPose === "function"
  );
}

/**
 * Captures one model generation. Creation validates the complete essential contract before any
 * mutation, so unsupported or malformed rigs fail closed with a typed result.
 */
export function createStudioVrmProportionRigRuntime(
  adapter: StudioVrmProportionRigAdapter,
  options: StudioVrmProportionRigRuntimeOptions
): StudioVrmProportionRigCreateResult {
  if (!adapterContractIsValid(adapter)) {
    return createFailure("invalid-adapter", "The proportion-rig adapter contract is incomplete.");
  }
  if (!Number.isFinite(options?.headLength) || options.headLength <= 0) {
    return createFailure("invalid-head-length", "Head length must be a finite positive number.");
  }
  const initialGeneration = readGeneration(adapter);
  if (!initialGeneration.ok) {
    return createFailure("invalid-model-generation", "The model generation is not a finite number or non-empty string.");
  }
  const hierarchy = captureHierarchy(adapter, options.headLength);
  if (!hierarchy.ok) return hierarchy;
  const { captures, snapshot } = hierarchy;
  const headMeasurement = freezeHeadMeasurementProvenance(options.headMeasurement);

  let applyGeneration = 0;
  let disposed = false;
  // The uniform body scale that goes with `committedTargets`, so recovery can restore collider
  // geometry to the same size the committed skeleton was built at.
  let committedUniformScale = NEUTRAL_STUDIO_VRM_PROPORTIONS.overallHeight;
  let committedTargets = new Map(
    resolveVrmProportionBoneTargets(NEUTRAL_STUDIO_VRM_PROPORTIONS, snapshot).map((target) => [
      target.boneName,
      freezeTarget(target),
    ])
  );

  const makeFailure = (
    operation: StudioVrmProportionRigOperation,
    code: StudioVrmProportionRigFailureCode,
    message: string,
    observed: StudioVrmProportionModelGeneration | null,
    recovery: StudioVrmProportionRigRecovery = "not-needed"
  ): StudioVrmProportionRigFailure =>
    Object.freeze({
      ok: false,
      runtimeVersion: STUDIO_VRM_PROPORTION_RIG_RUNTIME_VERSION,
      operation,
      code,
      modelGeneration: initialGeneration.value,
      observedModelGeneration: observed,
      applyGeneration,
      recovery,
      message,
    });

  const currentGeneration = () => {
    const observed = readGeneration(adapter);
    return {
      current: observed.ok && Object.is(observed.value, initialGeneration.value),
      observed: observed.ok ? observed.value : null,
    } as const;
  };

  const runConstraintInit = () =>
    adapter.setNodeConstraintInitState
      ? invokeLifecycle(adapter.setNodeConstraintInitState)
      : true;
  const runSpringInit = () =>
    adapter.setSpringBoneInitState ? invokeLifecycle(adapter.setSpringBoneInitState) : true;
  // Membership, resolved once from the captured raw bone nodes: which subtrees the runtime scales
  // never depends on the proportions, only on which bones exist.
  const scaledSubtreeRoots: ReadonlySet<THREE.Object3D> = new Set(
    captures
      .filter((capture) => STUDIO_VRM_UNIFORM_SCALE_SUBTREE_ROOTS.includes(capture.name))
      .map((capture) => capture.node),
  );
  const runColliderSync = (uniformScale: number) =>
    adapter.syncSpringBoneColliderShapes
      ? invokeLifecycle(() => adapter.syncSpringBoneColliderShapes?.(uniformScale, scaledSubtreeRoots))
      : true;

  /**
   * Restores the last committed proportions, rebuilds every derived runtime, and reapplies pose.
   * The exact pre-attempt raw TRS is retained as a final fallback, but a failed recovery is marked
   * reload-required because raw and normalized ownership can no longer be proven coherent.
   */
  const recoverCommittedLifecycle = (fallback: readonly OwnedTransform[]) => {
    const current = currentGeneration();
    if (!current.current) {
      restoreOwnedTransforms(adapter.root, fallback);
      return false;
    }
    const recovered =
      invokeLifecycle(adapter.resetNormalizedPoseAndSyncRawRest) &&
      currentGeneration().current &&
      writeTargets(adapter.root, captures, committedTargets) &&
      currentGeneration().current &&
      invokeLifecycle(adapter.rebuildNormalizedRig) &&
      currentGeneration().current &&
      runConstraintInit() &&
      currentGeneration().current &&
      runColliderSync(committedUniformScale) &&
      currentGeneration().current &&
      runSpringInit() &&
      currentGeneration().current &&
      invokeLifecycle(adapter.reapplyAuthoredPose) &&
      currentGeneration().current;
    if (!recovered) restoreOwnedTransforms(adapter.root, fallback);
    return recovered;
  };

  const applyInternal = (
    proportions: unknown,
    operation: StudioVrmProportionRigOperation
  ): StudioVrmProportionRigApplyResult => {
    applyGeneration += 1;
    if (disposed) {
      return makeFailure(operation, "disposed", "The proportion-rig runtime is already disposed.", null);
    }
    const atStart = currentGeneration();
    if (!atStart.current) {
      return makeFailure(
        operation,
        "stale-model-generation",
        "The captured model generation is no longer current.",
        atStart.observed
      );
    }

    const authoredProportions = freezeProportions(sanitizeStudioVrmProportions(proportions));
    const runtimePreset = resolveRuntimePreset(authoredProportions);
    let runtimeProportions = authoredProportions;
    const provisionalTargets = resolveSafeTargets(runtimeProportions, snapshot, captures.length);
    if (!provisionalTargets.ok) {
      return makeFailure(
        operation,
        "invalid-proportion-plan",
        provisionalTargets.message,
        atStart.observed
      );
    }
    let targets = provisionalTargets.targets;

    const rollback = captureOwnedTransforms(adapter.root, captures);
    const stages: StudioVrmProportionRigStage[] = [];
    const failLifecycle = (stage: StudioVrmProportionRigStage, message: string) => {
      const recovered = recoverCommittedLifecycle(rollback);
      return makeFailure(
        operation,
        recovered ? "lifecycle-failed" : "lifecycle-recovery-failed",
        `${stage}: ${message}`,
        currentGeneration().observed,
        recovered ? "restored" : "reload-required"
      );
    };
    const failStale = (message: string, observed: StudioVrmProportionModelGeneration | null) => {
      restoreOwnedTransforms(adapter.root, rollback);
      return makeFailure(operation, "stale-model-generation", message, observed);
    };

    if (!invokeLifecycle(adapter.resetNormalizedPoseAndSyncRawRest)) {
      return failLifecycle(
        "reset-normalized-pose-and-sync-raw-rest",
        "The normalized pose could not be reset and synchronized to raw rest."
      );
    }
    stages.push("reset-normalized-pose-and-sync-raw-rest");
    const afterReset = currentGeneration();
    if (!afterReset.current) {
      return failStale(
        "The model was replaced while synchronizing its raw rest pose.",
        afterReset.observed
      );
    }

    let targetByBone = new Map(targets.map((target) => [target.boneName, target]));
    if (!writeTargets(adapter.root, captures, targetByBone)) {
      return failLifecycle("write-raw-proportion-targets", "A target could not be written safely.");
    }
    stages.push("write-raw-proportion-targets");
    const provisionalWorldPositions = captureWorldPositions(adapter.root, captures);
    const afterProvisionalWrite = currentGeneration();
    if (!afterProvisionalWrite.current) {
      return failStale(
        "The model was replaced while writing raw proportion targets.",
        afterProvisionalWrite.observed
      );
    }

    let presetClamped = false;
    if (runtimePreset) {
      const actualHeadJointY = provisionalWorldPositions.find(
        (entry) => entry.boneName === "head"
      )?.position[1];
      if (typeof actualHeadJointY !== "number" || !Number.isFinite(actualHeadJointY)) {
        return failLifecycle(
          "write-raw-proportion-targets",
          "The model-specific head joint position could not be measured."
        );
      }
      const modelResolved = resolveModelSpecificPresetProportions(
        authoredProportions,
        runtimePreset.targetHeadUnits,
        actualHeadJointY,
        snapshot
      );
      runtimeProportions = modelResolved.runtime;
      presetClamped = modelResolved.clamped;
      const modelTargets = resolveSafeTargets(runtimeProportions, snapshot, captures.length);
      if (!modelTargets.ok) {
        return failLifecycle("write-raw-proportion-targets", modelTargets.message);
      }
      targets = modelTargets.targets;
      targetByBone = new Map(targets.map((target) => [target.boneName, target]));
      if (!writeTargets(adapter.root, captures, targetByBone)) {
        return failLifecycle(
          "write-raw-proportion-targets",
          "The model-specific preset targets could not be written safely."
        );
      }
    }

    const worldPositions = captureWorldPositions(adapter.root, captures);
    const afterWrite = currentGeneration();
    if (!afterWrite.current) {
      return failStale(
        "The model was replaced while resolving model-specific proportion targets.",
        afterWrite.observed
      );
    }
    const metrics = freezeMetrics(
      resolveActualProportionMetrics(worldPositions, targetByBone, snapshot)
    );
    const presetResolution: StudioVrmProportionRigPresetResolution | null = runtimePreset
      ? Object.freeze({
          presetId: runtimePreset.id,
          targetHeadUnits: runtimePreset.targetHeadUnits,
          authoredHeadBodyRatio: authoredProportions.headBodyRatio,
          runtimeHeadBodyRatio: runtimeProportions.headBodyRatio,
          achievedHeadUnits: metrics.headUnits,
          clamped: presetClamped,
        })
      : null;

    if (!invokeLifecycle(adapter.rebuildNormalizedRig)) {
      return failLifecycle("rebuild-normalized-rig", "The normalized humanoid could not be rebuilt.");
    }
    stages.push("rebuild-normalized-rig");
    const afterRebuild = currentGeneration();
    if (!afterRebuild.current) {
      return failStale(
        "The model was replaced while rebuilding its normalized humanoid.",
        afterRebuild.observed
      );
    }

    if (adapter.setNodeConstraintInitState) {
      if (!invokeLifecycle(adapter.setNodeConstraintInitState)) {
        return failLifecycle(
          "set-node-constraint-init-state",
          "The node-constraint initial state could not be captured."
        );
      }
      stages.push("set-node-constraint-init-state");
    } else {
      stages.push("node-constraint-state-unavailable");
    }
    const afterConstraint = currentGeneration();
    if (!afterConstraint.current) {
      return failStale(
        "The model was replaced while initializing node constraints.",
        afterConstraint.observed
      );
    }

    // Colliders first: `setInitState()` recaptures joint rest against whatever collider geometry
    // is current, so a collider resized afterwards would be inconsistent with the captured rest.
    if (adapter.syncSpringBoneColliderShapes) {
      if (!runColliderSync(runtimeProportions.overallHeight)) {
        return failLifecycle(
          "sync-spring-bone-colliders",
          "The spring-bone collider shapes could not be resized."
        );
      }
      stages.push("sync-spring-bone-colliders");
    } else {
      stages.push("spring-bone-colliders-unavailable");
    }

    if (adapter.setSpringBoneInitState) {
      if (!invokeLifecycle(adapter.setSpringBoneInitState)) {
        return failLifecycle(
          "set-spring-bone-init-state",
          "The spring-bone initial state could not be captured."
        );
      }
      stages.push("set-spring-bone-init-state");
    } else {
      stages.push("spring-bone-state-unavailable");
    }
    const afterSpring = currentGeneration();
    if (!afterSpring.current) {
      return failStale(
        "The model was replaced while initializing spring bones.",
        afterSpring.observed
      );
    }

    if (!invokeLifecycle(adapter.reapplyAuthoredPose)) {
      return failLifecycle("reapply-authored-pose", "The authored pose could not be reapplied.");
    }
    stages.push("reapply-authored-pose");
    const afterPose = currentGeneration();
    if (!afterPose.current) {
      return failStale(
        "The model was replaced while reapplying the authored pose.",
        afterPose.observed
      );
    }

    committedTargets = targetByBone;
    committedUniformScale = runtimeProportions.overallHeight;
    adapter.root.updateMatrixWorld(true);
    return Object.freeze({
      ok: true,
      runtimeVersion: STUDIO_VRM_PROPORTION_RIG_RUNTIME_VERSION,
      operation,
      modelGeneration: initialGeneration.value,
      applyGeneration,
      authoredProportions,
      runtimeProportions,
      presetResolution,
      headMeasurement,
      targets,
      worldPositions,
      metrics,
      stages: Object.freeze(stages),
    });
  };

  const runtime: StudioVrmProportionRigRuntime = {
    runtimeVersion: STUDIO_VRM_PROPORTION_RIG_RUNTIME_VERSION,
    modelGeneration: initialGeneration.value,
    snapshot,
    get disposed() {
      return disposed;
    },
    apply: (proportions) => applyInternal(proportions, "apply"),
    restore: () => applyInternal(NEUTRAL_STUDIO_VRM_PROPORTIONS, "restore"),
    dispose: () => {
      const result = applyInternal(NEUTRAL_STUDIO_VRM_PROPORTIONS, "dispose");
      if (result.ok) disposed = true;
      return result;
    },
  };

  return Object.freeze({ ok: true, runtime: Object.freeze(runtime) });
}
