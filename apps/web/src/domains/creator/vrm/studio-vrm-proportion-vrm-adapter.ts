import { VRMHumanoid, type VRM } from "@pixiv/three-vrm";
import * as THREE from "three";

import type { StudioHumanoidBoneName } from "../studio-humanoid-bones";
import type {
  StudioVrmProportionModelGeneration,
  StudioVrmProportionRigAdapter,
} from "./studio-vrm-proportion-rig-runtime";

export const STUDIO_VRM_PROPORTION_HEAD_MEASUREMENT_VERSION = 1 as const;

export type StudioVrmProportionHeadMeasurementSource =
  | "eye-landmarks"
  | "mesh-bounds-estimate"
  | "bone-bounds-estimate";

export type StudioVrmProportionHeadMeasurementReceipt = {
  readonly version: typeof STUDIO_VRM_PROPORTION_HEAD_MEASUREMENT_VERSION;
  /** Head joint to inferred crown distance, in model-root local units. */
  readonly value: number;
  readonly modelHeight: number;
  readonly source: StudioVrmProportionHeadMeasurementSource;
  /** True only when a plausible, symmetric pair of VRM eye landmarks was available. */
  readonly reliable: boolean;
};

export type StudioVrmProportionVrmAdapterInput = {
  readonly vrm: VRM;
  readonly getCurrentModelGeneration: () => StudioVrmProportionModelGeneration;
  /** Must restore pose/root translation, authored yaw and legacy scene scale. */
  readonly reapplyAuthoredPose: () => boolean | void;
};

function moveChildToIndex(parent: THREE.Object3D, child: THREE.Object3D, index: number) {
  const currentIndex = parent.children.indexOf(child);
  if (currentIndex < 0) return false;
  parent.children.splice(currentIndex, 1);
  parent.children.splice(Math.min(Math.max(0, index), parent.children.length), 0, child);
  return true;
}

/**
 * Rebuilds three-vrm's normalized humanoid and replaces the loader-attached normalized root.
 * `VRMHumanoid.copy()` creates a new root but does not attach it, so copying without this explicit
 * root swap leaves consumers pointing at a detached rig.
 */
export function rebuildStudioVrmNormalizedHumanoid(vrm: VRM): boolean {
  const humanoid = vrm.humanoid;
  const previousRoot = humanoid?.normalizedHumanBonesRoot ?? null;
  const parent = previousRoot?.parent ?? null;
  if (!humanoid || !previousRoot || !parent) return false;
  const previousIndex = parent.children.indexOf(previousRoot);
  if (previousIndex < 0) return false;

  try {
    const source = new VRMHumanoid(humanoid.rawHumanBones, {
      autoUpdateHumanBones: humanoid.autoUpdateHumanBones,
    });
    humanoid.copy(source);
    const replacementRoot = humanoid.normalizedHumanBonesRoot;
    if (replacementRoot === previousRoot) return false;

    parent.remove(previousRoot);
    parent.add(replacementRoot);
    if (!moveChildToIndex(parent, replacementRoot, previousIndex)) return false;
    replacementRoot.updateMatrixWorld(true);
    vrm.scene.updateMatrixWorld(true);
    return replacementRoot.parent === parent && previousRoot.parent === null;
  } catch {
    // If copy succeeded before a later attachment operation failed, keep the currently owned root
    // attached so the caller's transactional recovery can safely rebuild once more.
    try {
      const currentRoot = humanoid.normalizedHumanBonesRoot;
      if (currentRoot !== previousRoot && previousRoot.parent === parent) {
        parent.remove(previousRoot);
      }
      if (currentRoot.parent !== parent) parent.add(currentRoot);
      moveChildToIndex(parent, currentRoot, previousIndex);
      vrm.scene.updateMatrixWorld(true);
    } catch {
      // The runtime turns a false return into reload-required if its recovery also fails.
    }
    return false;
  }
}

function rootLocalBounds(root: THREE.Object3D): THREE.Box3 | null {
  root.updateMatrixWorld(true);
  const worldBounds = new THREE.Box3().setFromObject(root);
  if (worldBounds.isEmpty()) return null;
  const inverse = root.matrixWorld.clone().invert();
  const localBounds = new THREE.Box3();
  for (const x of [worldBounds.min.x, worldBounds.max.x]) {
    for (const y of [worldBounds.min.y, worldBounds.max.y]) {
      for (const z of [worldBounds.min.z, worldBounds.max.z]) {
        localBounds.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(inverse));
      }
    }
  }
  return localBounds.isEmpty() ? null : localBounds;
}

function rootLocalBonePoint(root: THREE.Object3D, bone: THREE.Object3D | null) {
  if (!bone) return null;
  return root.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
}

/**
 * Measures head-joint-to-crown length in model-root local units before authored pose/scale.
 *
 * VRM does not carry a canonical crown landmark, so the receipt preserves whether the value came
 * from a plausible eye pair or a coarser whole-model fallback. Consumers must not label fallback
 * values as exact model measurements.
 */
export function measureStudioVrmProportionHeadLength(
  vrm: VRM,
): StudioVrmProportionHeadMeasurementReceipt | null {
  const humanoid = vrm.humanoid;
  if (!humanoid) return null;
  const root = vrm.scene;
  root.updateMatrixWorld(true);
  const head = rootLocalBonePoint(root, humanoid.getRawBoneNode("head"));
  if (!head) return null;

  const leftEye = rootLocalBonePoint(root, humanoid.getRawBoneNode("leftEye"));
  const rightEye = rootLocalBonePoint(root, humanoid.getRawBoneNode("rightEye"));
  const eyeCenter = leftEye && rightEye
    ? leftEye.clone().add(rightEye).multiplyScalar(0.5)
    : leftEye ?? rightEye;

  const bounds = rootLocalBounds(root);
  let modelHeight = bounds?.getSize(new THREE.Vector3()).y ?? 0;
  let fallbackSource: StudioVrmProportionHeadMeasurementSource = "mesh-bounds-estimate";
  if (!(modelHeight > 0) || !Number.isFinite(modelHeight)) {
    const points: THREE.Vector3[] = [];
    for (const bone of Object.values(humanoid.rawHumanBones)) {
      const point = rootLocalBonePoint(root, bone?.node ?? null);
      if (point) points.push(point);
    }
    if (points.length > 1) {
      const boneBounds = new THREE.Box3().setFromPoints(points);
      modelHeight = boneBounds.getSize(new THREE.Vector3()).y;
      fallbackSource = "bone-bounds-estimate";
    }
  }
  if (!(modelHeight > 0) || !Number.isFinite(modelHeight)) return null;

  const eyeOffset = eyeCenter ? Math.abs(eyeCenter.y - head.y) : 0;
  const eyeEstimate = eyeOffset * 2.15;
  const fallback = modelHeight / 8;
  const hasPlausibleEyePair = Boolean(
    leftEye &&
      rightEye &&
      Math.abs(leftEye.y - rightEye.y) <= modelHeight / 40 &&
      leftEye.distanceTo(rightEye) >= modelHeight / 100 &&
      leftEye.distanceTo(rightEye) <= modelHeight / 3 &&
      eyeOffset > modelHeight / 20 &&
      eyeOffset < modelHeight / 3,
  );
  const estimated = hasPlausibleEyePair ? eyeEstimate : fallback;
  return Object.freeze({
    version: STUDIO_VRM_PROPORTION_HEAD_MEASUREMENT_VERSION,
    value: THREE.MathUtils.clamp(estimated, modelHeight / 14, modelHeight / 2.5),
    modelHeight,
    source: hasPlausibleEyePair ? "eye-landmarks" : fallbackSource,
    reliable: hasPlausibleEyePair,
  });
}

/** 자식 관절이 그 축을 아예 뻗지 않은 것으로 볼 허용 오차. 관절 간격은 cm 단위다. */
const CHILD_REACH_EPSILON = 1e-6;

/**
 * A collider's authored geometry, captured once so every resize is absolute from rest. Rescaling
 * the live values in place would compound across slider moves.
 */
type CapturedColliderShape = {
  readonly collider: THREE.Object3D;
  readonly shape: {
    offset?: THREE.Vector3;
    tail?: THREE.Vector3;
    radius?: number;
  };
  readonly offset: THREE.Vector3 | null;
  readonly tail: THREE.Vector3 | null;
  readonly radius: number | null;
  /** The collider node's scale relative to the VRM root at rest, so inherited scaling divides out. */
  readonly restRootScale: number;
  /**
   * The humanoid bones parented directly to this collider's frame, and how far they reach along
   * each axis at rest. Their motion is the only thing that changes inside this frame, so it is
   * what an offset on an unscaled frame has to follow.
   */
  readonly childBones: readonly THREE.Object3D[];
  readonly restChildReach: THREE.Vector3;
};

/**
 * A spring joint's authored hit radius, captured from rest for the same reason the collider shapes
 * are: `hitRadius` is compared against world distances, so it has to be re-derived, not compounded.
 */
type CapturedJointRadius = {
  readonly settings: { hitRadius: number };
  readonly bone: THREE.Object3D;
  readonly hitRadius: number;
  /** The joint bone's scale relative to the VRM root at rest. */
  readonly restRootScale: number;
};

type CapturedSpringGeometry = {
  readonly colliders: readonly CapturedColliderShape[];
  readonly joints: readonly CapturedJointRadius[];
};

/**
 * A node's scale relative to `root`, never world.
 *
 * The lifecycle neutralizes the scene root before this runs and restores the authored TRS
 * afterwards, so a world-space reading would count the removal of an authored root scale as a
 * collider-local change -- a root scale of 2 would derive `inherited = 0.5` on a neutral apply,
 * double every local offset, and then double it again in world once the root came back.
 */
function rootRelativeScaleOf(root: THREE.Object3D, node: THREE.Object3D): number {
  root.updateWorldMatrix(true, false);
  node.updateWorldMatrix(true, false);
  const relative = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(node.matrixWorld);
  const scale = new THREE.Vector3();
  relative.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  const average = (Math.abs(scale.x) + Math.abs(scale.y) + Math.abs(scale.z)) / 3;
  return Number.isFinite(average) && average > 0 ? average : 1;
}

/** Per-axis sum of |local position| over `nodes` -- how far this frame's joints reach on each axis. */
function childReach(nodes: readonly THREE.Object3D[]): THREE.Vector3 {
  const reach = new THREE.Vector3();
  for (const node of nodes) {
    reach.x += Math.abs(node.position.x);
    reach.y += Math.abs(node.position.y);
    reach.z += Math.abs(node.position.z);
  }
  return reach;
}

/** Whether `node` sits beneath one of `roots`. A root does not contain itself here -- no collider is a bone. */
function isInsideAny(node: THREE.Object3D, roots: ReadonlySet<THREE.Object3D>): boolean {
  if (roots.size === 0) return false;
  for (let cursor = node.parent; cursor; cursor = cursor.parent) {
    if (roots.has(cursor)) return true;
  }
  return false;
}

/**
 * Captures every spring-bone collider shape and every spring joint's hit radius at rest.
 *
 * `VRMSpringBoneManager.colliders` is a derived getter over the joints' collider groups, so the
 * set is read here and the individual shapes are held by reference.
 */
function captureSpringBoneGeometry(vrm: VRM): CapturedSpringGeometry {
  const manager = vrm.springBoneManager;
  const colliders = manager?.colliders ?? [];
  const springJoints = [...(manager?.joints ?? [])];
  if (colliders.length > 0 || springJoints.length > 0) vrm.scene.updateMatrixWorld(true);
  const humanoid = vrm.humanoid;
  const boneNodes = new Set<THREE.Object3D>();
  if (humanoid) {
    for (const bone of humanoid.humanBones ? Object.keys(humanoid.humanBones) : []) {
      const node = humanoid.getRawBoneNode(bone as Parameters<typeof humanoid.getRawBoneNode>[0]);
      if (node) boneNodes.add(node);
    }
  }
  const captured: CapturedColliderShape[] = [];
  for (const collider of colliders) {
    const shape = (collider as unknown as { shape?: CapturedColliderShape["shape"] }).shape;
    if (!shape) continue;
    // three-vrm parents each collider to its bone node with an identity transform, so the shape's
    // local frame is that bone's frame and the bone's own children are expressed in it directly.
    const childBones = (collider.parent?.children ?? []).filter((child) => boneNodes.has(child));
    captured.push({
      collider,
      shape,
      offset: shape.offset ? shape.offset.clone() : null,
      tail: shape.tail ? shape.tail.clone() : null,
      radius: typeof shape.radius === "number" ? shape.radius : null,
      restRootScale: rootRelativeScaleOf(vrm.scene, collider),
      childBones,
      restChildReach: childReach(childBones),
    });
  }
  const joints: CapturedJointRadius[] = [];
  for (const joint of springJoints) {
    joints.push({
      settings: joint.settings,
      bone: joint.bone,
      hitRadius: joint.settings.hitRadius,
      restRootScale: rootRelativeScaleOf(vrm.scene, joint.bone),
    });
  }
  return { colliders: captured, joints };
}

/**
 * Resizes spring geometry for a body whose joint spacing changed by `uniformScale`.
 *
 * `uniformScale` is the runtime's headline body factor. It gates the call -- a non-finite or
 * non-positive value means the caller has nothing coherent to sync against -- but it is no longer
 * the magnitude anything is multiplied by: the two cases below read the scene graph and the joints
 * themselves, which is the only way per-axis girth invariance survives.
 *
 * three-vrm splits a capsule into two halves that scale by different rules, and the split is not
 * the one the shape's own fields suggest. `VRMSpringBoneColliderShapeCapsule.calculateCollision`
 * takes the capsule origin from `colliderMatrix` (which is `matrixWorld` with `offset` applied
 * through its linear part) and the axis from `(tail - offset)` through that same linear part -- so
 * **the scene graph already scales both**. But `this.radius` and the joint's `settings.hitRadius`
 * enter the distance test as **raw scalars**, never touched by any matrix. A collider under a node
 * the runtime scaled therefore grows its envelope in length only, and stays as thin as it was
 * authored while the mesh around it thickens.
 *
 * So there are two cases, split by **which subtree the collider hangs in** -- `scaledSubtreeRoots`
 * names the bones the runtime gives a uniform scale to, and membership is asked of the scene graph.
 *
 * **A collider inside a scaled subtree** -- the generated skull capsules sit under `HairRoot` below
 * `head`, and `head` absorbs `headBodyRatio` as well as `overallHeight`. Its geometry is already
 * carried whole by the scene graph, so the local `offset`/`tail` must be left alone (multiplying
 * them too made the skull 2.56x at `overallHeight` 1.6 while the hair around it grew 1.6x). Its
 * radius, being raw, is the one thing the graph does not carry, so it is re-derived as
 * `rest x inherited`. Both halves then agree.
 *
 * **A collider outside every scaled subtree** -- the torso capsule on `spine` -- is the opposite.
 * The graph carried nothing, so its geometry has to pick up the joint spacing itself. Its radius
 * must *not* move: the proportion model moves joints apart, it does not make the body thicker.
 * Torso vertices weighted to `hips`/`spine` keep their exact cross-section at every height, so
 * scaling the radius would have made the capsule 60% wider than the torso it rides on.
 *
 * Girth invariance binds the geometry too, and only a **capsule** has geometry to move here. Its
 * `offset` and `tail` are the two ends of a span, so they have to track the joints the span reaches
 * across. A sphere or a plane carries no span at all -- its `offset` is a position on the surface,
 * fixed in the bone's frame the way the skin around it is -- so it is left exactly as authored.
 * That split is the only one the file actually states; whether a *coordinate* is a span or a
 * position is authoring intent that VRM has no place for (see the `torsoLength` thread).
 *
 * For a capsule the span is resolved per axis, from the bone's own child joints -- inside an
 * unscaled frame they are the only thing that moves. Each axis is scaled by how far those children
 * reach on it now against at rest, and an axis they never spanned does not move at all. A single
 * scalar cannot express that: multiplying the whole vector by `overallHeight` dragged geometry off
 * the surface it was authored against (`z = 0.10` slid to 0.16 at height 1.6, though torso depth
 * never changed), because no joint under `spine` has a `z` component to justify it.
 *
 * The generated torso capsule comes out the same either way: its offset and tail are pure `y`, and
 * `spine`'s children (`head` and both upper arms) reach 1.6x further in `y` at `overallHeight` 1.6
 * -- the same 1.6 the scalar gave. Reading the joints rather than the scalar is also what keeps
 * `headBodyRatio` alone from moving it: that slider resizes `head` without moving it.
 *
 * Membership, not magnitude, is what separates them. Reading the inherited factor and calling 1
 * "unscaled" gets the skull wrong whenever two edits cancel: `overallHeight` 1.25 with
 * `headBodyRatio` 0.8 leaves `head` at exactly 1, and the capsule would then be stretched 25%
 * around a head that never grew (local offset 0.0691 -> 0.0864, span x1.25), with an abrupt jump
 * on either side of the coincidence.
 *
 * Joint hit radii follow the same reasoning as collider radii: raw scalars compared against world
 * distances, so each one is re-derived from its own bone's inherited scale. Hair bones under a
 * scaled `head` get thicker along with the strands they model; every other joint reads 1 and is
 * left untouched.
 *
 * Every write is absolute from rest, so dragging a slider out and back lands on the authored
 * values again. That is why the radius is re-derived on both branches: `inherited` is 1 on the
 * unscaled branch, which restores the authored radius rather than leaving a stale one behind.
 */
function resizeSpringBoneGeometry(
  root: THREE.Object3D,
  captured: CapturedSpringGeometry,
  uniformScale: number,
  scaledSubtreeRoots: ReadonlySet<THREE.Object3D>,
): boolean {
  if (!Number.isFinite(uniformScale) || uniformScale <= 0) return false;
  for (const entry of captured.colliders) {
    const inherited = rootRelativeScaleOf(root, entry.collider) / entry.restRootScale;
    if (!Number.isFinite(inherited) || inherited <= 0) return false;

    // Unconditional, and from rest -- not inside the branch below. A slider dragged out and back
    // has to land on the authored radius again, and `inherited` is exactly 1 when it does. Writing
    // this only on the scaled branch left a skull that had once been at `headBodyRatio` 2.5 stuck
    // at 2.5x radius after the slider returned to neutral.
    if (entry.radius !== null) entry.shape.radius = entry.radius * inherited;

    if (isInsideAny(entry.collider, scaledSubtreeRoots)) continue;

    // A shape with no `tail` is a sphere or a plane: an authored position, not a span. Nothing
    // here can tell whether its offset was meant to reach across the joints that moved, so it is
    // left alone -- moving it would only detach it from the surface it was placed on.
    if (!entry.tail) continue;

    const reach = childReach(entry.childBones);
    const spread = (now: number, rest: number): number => {
      if (rest <= CHILD_REACH_EPSILON) return 1;
      const ratio = now / rest;
      return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    };
    const spreadX = spread(reach.x, entry.restChildReach.x);
    const spreadY = spread(reach.y, entry.restChildReach.y);
    const spreadZ = spread(reach.z, entry.restChildReach.z);

    if (entry.offset) {
      entry.shape.offset?.set(
        entry.offset.x * spreadX,
        entry.offset.y * spreadY,
        entry.offset.z * spreadZ,
      );
    }
    entry.shape.tail?.set(
      entry.tail.x * spreadX,
      entry.tail.y * spreadY,
      entry.tail.z * spreadZ,
    );
  }
  for (const entry of captured.joints) {
    const inherited = rootRelativeScaleOf(root, entry.bone) / entry.restRootScale;
    if (!Number.isFinite(inherited) || inherited <= 0) return false;
    entry.settings.hitRadius = entry.hitRadius * inherited;
  }
  return true;
}

/** Creates the concrete three-vrm lifecycle adapter used by Poser and shared BG3D. */
export function createStudioVrmProportionVrmAdapter(
  input: StudioVrmProportionVrmAdapterInput,
): StudioVrmProportionRigAdapter {
  const { vrm } = input;
  const nodeConstraintManager = vrm.nodeConstraintManager;
  const springBoneManager = vrm.springBoneManager;
  const capturedSpringGeometry = captureSpringBoneGeometry(vrm);
  const resetNormalizedPoseAndSyncRawRest = () => {
    const humanoid = vrm.humanoid;
    if (!humanoid) return false;
    // three-vrm derives normalized offsets from raw world positions. Authored root translation,
    // rotation and legacy non-uniform scene scale must not be baked into the rebuilt rest rig.
    vrm.scene.position.set(0, 0, 0);
    vrm.scene.quaternion.identity();
    vrm.scene.scale.set(1, 1, 1);
    vrm.scene.updateMatrixWorld(true);
    // `VRMHumanoid.update()` intentionally does nothing when autoUpdateHumanBones is false. Reset
    // raw explicitly so a directly-authored raw pose can never be frozen into the rebuilt rest rig.
    humanoid.resetRawPose();
    humanoid.resetNormalizedPose();
    humanoid.update();
    vrm.scene.updateMatrixWorld(true);
    return true;
  };

  return {
    root: vrm.scene,
    getModelGeneration: input.getCurrentModelGeneration,
    getRawBoneNode: (name: StudioHumanoidBoneName) =>
      vrm.humanoid?.getRawBoneNode(name) ?? null,
    resetNormalizedPoseAndSyncRawRest,
    rebuildNormalizedRig: () => rebuildStudioVrmNormalizedHumanoid(vrm),
    ...(nodeConstraintManager
      ? { setNodeConstraintInitState: () => {
          nodeConstraintManager.setInitState();
          return true;
        } }
      : {}),
    ...(springBoneManager
      ? {
          setSpringBoneInitState: () => {
            springBoneManager.setInitState();
            return true;
          },
          syncSpringBoneColliderShapes: (
            uniformScale: number,
            scaledSubtreeRoots: ReadonlySet<THREE.Object3D>,
          ) =>
            resizeSpringBoneGeometry(
              vrm.scene,
              capturedSpringGeometry,
              uniformScale,
              scaledSubtreeRoots,
            ),
        }
      : {}),
    reapplyAuthoredPose: input.reapplyAuthoredPose,
  };
}
