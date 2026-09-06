import * as THREE from "three";

import { bakeStudioVrmRuntimePose } from "./studio-vrm-pose-bake";
import {
  EMPTY_STUDIO_VRM_POSE_TRANSLATIONS,
  normalizeStudioVrmPoseTranslations,
  STUDIO_VRM_HIPS_TRANSLATION_LIMIT,
  STUDIO_VRM_ROOT_TRANSLATION_LIMIT,
  STUDIO_VRM_SPINE_TRANSLATION_LIMIT,
} from "./studio-vrm-pose-translations";
import {
  normalizeStudioVrmRigProfile,
  type StudioVrmRigProfileInput,
} from "./studio-vrm-rig-profile";
import {
  STUDIO_VRM_USER_IK_CHAINS,
  solveStudioVrmUserIk,
} from "./studio-vrm-user-ik";

import type { PoseBoneMap, Vec3 } from "./studio-vrm-poser-utils";
import type { StudioVrmPoseTranslations } from "./studio-vrm-scene-document";
import type {
  StudioVrmUserIkEffector,
  StudioVrmUserIkResult,
  StudioVrmUserIkSource,
} from "./studio-vrm-user-ik";

const EFFECTOR_ORDER: readonly StudioVrmUserIkEffector[] = Object.freeze([
  "leftFoot",
  "rightFoot",
  "leftHand",
  "rightHand",
]);
const MIN_ITERATIONS = 2;
const DEFAULT_ITERATIONS = 8;
const MAX_ITERATIONS = 16;
const DEFAULT_TOLERANCE = 0.002;
const MAX_TOLERANCE = 0.05;
const MAX_TARGET_COORDINATE = 10_000;
const MAX_ROOT_CORRECTION = 2;
const MAX_HIPS_CORRECTION = 1.25;
const MAX_SPINE_CORRECTION = 0.75;
const MAX_ITERATION_STEP = 0.25;
const LENGTH_EPSILON = 1e-8;

export interface StudioVrmFullBodyIkPrimaryTarget {
  readonly effector: StudioVrmUserIkEffector;
  readonly targetWorld: THREE.Vector3;
  readonly poleWorld?: THREE.Vector3;
}

export interface StudioVrmFullBodyIkFootPlant {
  readonly enabled: boolean;
  readonly floorHeight: number;
}

export interface StudioVrmFullBodyIkLockedTarget {
  readonly effector: StudioVrmUserIkEffector;
  readonly targetWorld: THREE.Vector3;
  readonly poleWorld?: THREE.Vector3;
}

export interface StudioVrmFullBodyIkRequest {
  readonly primary: StudioVrmFullBodyIkPrimaryTarget;
  readonly baseTranslations?: StudioVrmPoseTranslations;
  readonly jointProfile?: StudioVrmRigProfileInput;
  /** Enables bounded root/hips/spine translation allocation before the chain passes. */
  readonly fullBodyIk: boolean;
  /** When enabled, both feet become simultaneous constraints; the dragged foot keeps its X/Z. */
  readonly footPlant?: StudioVrmFullBodyIkFootPlant;
  /** Other enabled locked pins solved from the same immutable baseline as the primary drag. */
  readonly lockedTargets?: readonly StudioVrmFullBodyIkLockedTarget[];
  readonly iterations?: number;
  readonly tolerance?: number;
}

export interface StudioVrmFullBodyIkConstraintResult {
  readonly effector: StudioVrmUserIkEffector;
  readonly targetWorld: Vec3;
  readonly effectiveTargetWorld: Vec3;
  /** Residual from the post-damping, post-hard-limit end-effector position. */
  readonly residual: number;
  readonly locked: boolean;
  readonly reachable: boolean;
  readonly clamped: boolean;
  readonly limited: boolean;
}

export interface StudioVrmFullBodyIkResult {
  readonly effector: StudioVrmUserIkEffector;
  readonly bones: PoseBoneMap;
  readonly yOffset: number;
  readonly translations: StudioVrmPoseTranslations;
  readonly requestedTargetWorld: Vec3;
  readonly effectiveTargetWorld: Vec3;
  readonly constraints: readonly StudioVrmFullBodyIkConstraintResult[];
  /** Includes the final simultaneous analytic chain pass, so a valid result is always at least 1. */
  readonly iterations: number;
  /** The largest post-limit end-effector residual is within the requested tolerance. */
  readonly converged: boolean;
  /** Largest post-damping, post-hard-limit end-effector residual. */
  readonly maxResidual: number;
  readonly clamped: boolean;
  readonly limited: boolean;
  readonly translationLimited: boolean;
}

export interface StudioVrmFullBodyIkDependencies {
  readonly solveChain: typeof solveStudioVrmUserIk;
}

const DEFAULT_DEPENDENCIES: StudioVrmFullBodyIkDependencies = Object.freeze({
  solveChain: solveStudioVrmUserIk,
});

interface Constraint {
  readonly effector: StudioVrmUserIkEffector;
  readonly target: THREE.Vector3;
  readonly pole?: THREE.Vector3;
  readonly locked: boolean;
  readonly start: THREE.Vector3;
  readonly end: THREE.Vector3;
  readonly maximumReach: number;
  readonly minimumReach: number;
}

function isFiniteVector(value: THREE.Vector3 | null | undefined): value is THREE.Vector3 {
  return Boolean(value)
    && Number.isFinite(value!.x)
    && Number.isFinite(value!.y)
    && Number.isFinite(value!.z)
    && Math.abs(value!.x) <= MAX_TARGET_COORDINATE
    && Math.abs(value!.y) <= MAX_TARGET_COORDINATE
    && Math.abs(value!.z) <= MAX_TARGET_COORDINATE;
}

function tuple(value: THREE.Vector3): Vec3 {
  return Object.freeze([
    Object.is(value.x, -0) ? 0 : value.x,
    Object.is(value.y, -0) ? 0 : value.y,
    Object.is(value.z, -0) ? 0 : value.z,
  ]) as Vec3;
}

function worldPosition(node: THREE.Object3D | null): THREE.Vector3 | null {
  if (!node) return null;
  const value = node.getWorldPosition(new THREE.Vector3());
  return isFiniteVector(value) ? value : null;
}

function clampVectorLength(value: THREE.Vector3, maximum: number): boolean {
  const length = value.length();
  if (!Number.isFinite(length)) return true;
  if (length <= maximum) return false;
  value.multiplyScalar(maximum / length);
  return true;
}

function clampIterationStep(value: THREE.Vector3): THREE.Vector3 {
  clampVectorLength(value, MAX_ITERATION_STEP);
  return value;
}

function clampVectorComponents(value: THREE.Vector3, maximum: number): boolean {
  const x = THREE.MathUtils.clamp(value.x, -maximum, maximum);
  const y = THREE.MathUtils.clamp(value.y, -maximum, maximum);
  const z = THREE.MathUtils.clamp(value.z, -maximum, maximum);
  const changed = x !== value.x || y !== value.y || z !== value.z;
  value.set(x, y, z);
  return changed;
}

function outsideReachResidual(constraint: Constraint, influence: THREE.Vector3): THREE.Vector3 {
  const fromMovedStart = constraint.target.clone().sub(constraint.start).sub(influence);
  const distance = fromMovedStart.length();
  if (!Number.isFinite(distance) || distance <= LENGTH_EPSILON) return new THREE.Vector3();
  if (distance > constraint.maximumReach) {
    return fromMovedStart.multiplyScalar((distance - constraint.maximumReach) / distance);
  }
  if (distance < constraint.minimumReach) {
    return fromMovedStart.multiplyScalar((distance - constraint.minimumReach) / distance);
  }
  return new THREE.Vector3();
}

function mean(vectors: readonly THREE.Vector3[]): THREE.Vector3 {
  const result = new THREE.Vector3();
  if (vectors.length === 0) return result;
  for (const vector of vectors) result.add(vector);
  return result.multiplyScalar(1 / vectors.length);
}

function createConstraint(
  source: StudioVrmUserIkSource,
  effector: StudioVrmUserIkEffector,
  target: THREE.Vector3,
  pole: THREE.Vector3 | undefined,
  locked: boolean,
): Constraint | null {
  const chain = STUDIO_VRM_USER_IK_CHAINS[effector];
  const upper = source.humanoid.getNormalizedBoneNode(chain.upper);
  const lower = source.humanoid.getNormalizedBoneNode(chain.lower);
  const end = source.humanoid.getNormalizedBoneNode(chain.end);
  const startWorld = worldPosition(upper);
  const middleWorld = worldPosition(lower);
  const endWorld = worldPosition(end);
  if (!startWorld || !middleWorld || !endWorld) return null;
  const upperLength = startWorld.distanceTo(middleWorld);
  const lowerLength = middleWorld.distanceTo(endWorld);
  if (
    !Number.isFinite(upperLength)
    || !Number.isFinite(lowerLength)
    || upperLength <= LENGTH_EPSILON
    || lowerLength <= LENGTH_EPSILON
  ) return null;
  return {
    effector,
    target: target.clone(),
    pole: pole?.clone(),
    locked,
    start: startWorld,
    end: endWorld,
    maximumReach: Math.max(LENGTH_EPSILON, upperLength + lowerLength - 1e-7),
    minimumReach: Math.max(0, Math.abs(upperLength - lowerLength) + 1e-7),
  };
}

function buildConstraints(
  source: StudioVrmUserIkSource,
  request: StudioVrmFullBodyIkRequest,
): Constraint[] | null {
  const requested = new Map<StudioVrmUserIkEffector, {
    target: THREE.Vector3;
    pole?: THREE.Vector3;
    locked: boolean;
  }>();
  for (const lockedTarget of request.lockedTargets ?? []) {
    if (requested.has(lockedTarget.effector)) return null;
    requested.set(lockedTarget.effector, {
      target: lockedTarget.targetWorld.clone(),
      pole: lockedTarget.poleWorld?.clone(),
      locked: true,
    });
  }
  const plant = request.footPlant;
  if (plant?.enabled) {
    if (!Number.isFinite(plant.floorHeight) || plant.floorHeight < -10 || plant.floorHeight > 10) {
      return null;
    }
    for (const effector of ["leftFoot", "rightFoot"] as const) {
      const node = source.humanoid.getNormalizedBoneNode(effector);
      const position = worldPosition(node);
      if (!position) return null;
      if (!requested.has(effector)) requested.set(effector, {
        target: new THREE.Vector3(position.x, plant.floorHeight, position.z),
        locked: true,
      });
    }
  }
  const primaryTarget = request.primary.targetWorld.clone();
  if (plant?.enabled && request.primary.effector.endsWith("Foot")) {
    primaryTarget.y = plant.floorHeight;
  }
  requested.set(request.primary.effector, {
    target: primaryTarget,
    pole: request.primary.poleWorld?.clone(),
    locked: false,
  });

  const constraints: Constraint[] = [];
  for (const effector of EFFECTOR_ORDER) {
    const entry = requested.get(effector);
    if (!entry) continue;
    const constraint = createConstraint(
      source,
      effector,
      entry.target,
      entry.pole,
      entry.locked,
    );
    if (!constraint) return null;
    constraints.push(constraint);
  }
  return constraints;
}

function localVectorToWorld(root: THREE.Object3D, value: THREE.Vector3): THREE.Vector3 | null {
  const origin = new THREE.Vector3(0, 0, 0).applyMatrix4(root.matrixWorld);
  const endpoint = value.clone().applyMatrix4(root.matrixWorld);
  const result = endpoint.sub(origin);
  return isFiniteVector(result) ? result : null;
}

function worldVectorToLocal(root: THREE.Object3D, value: THREE.Vector3): THREE.Vector3 | null {
  const inverse = root.matrixWorld.clone().invert();
  const origin = new THREE.Vector3(0, 0, 0).applyMatrix4(inverse);
  const endpoint = value.clone().applyMatrix4(inverse);
  const result = endpoint.sub(origin);
  return isFiniteVector(result) ? result : null;
}

function parentLocalVectorToWorld(root: THREE.Object3D, value: THREE.Vector3): THREE.Vector3 | null {
  const parent = root.parent;
  if (!parent) return isFiniteVector(value) ? value.clone() : null;
  return localVectorToWorld(parent, value);
}

function worldVectorToParentLocal(root: THREE.Object3D, value: THREE.Vector3): THREE.Vector3 | null {
  const parent = root.parent;
  if (!parent) return isFiniteVector(value) ? value.clone() : null;
  return worldVectorToLocal(parent, value);
}

function influenceFor(
  constraint: Constraint,
  root: THREE.Vector3,
  hips: THREE.Vector3,
  spine: THREE.Vector3,
): THREE.Vector3 {
  const influence = root.clone().add(hips);
  if (STUDIO_VRM_USER_IK_CHAINS[constraint.effector].kind === "hand") influence.add(spine);
  return influence;
}

function maxConstraintResidual(
  constraints: readonly Constraint[],
  root: THREE.Vector3,
  hips: THREE.Vector3,
  spine: THREE.Vector3,
): number {
  let maximum = 0;
  for (const constraint of constraints) {
    maximum = Math.max(
      maximum,
      outsideReachResidual(constraint, influenceFor(constraint, root, hips, spine)).length(),
    );
  }
  return maximum;
}

/**
 * Deterministic bounded multi-chain solve for one active hand/foot plus both planted feet.
 *
 * Each fixed iteration distributes common reach error into root and hips, then distributes the
 * remaining upper-body error into spine. The final pass analytically solves every distinct
 * two-bone chain from the same immutable baseline and merges only its owned upper/lower rotations.
 * No Three object is mutated; callers may preview the returned pose and commit it once on release.
 */
export function solveStudioVrmFullBodyIk(
  source: StudioVrmUserIkSource,
  request: StudioVrmFullBodyIkRequest,
  dependencies: StudioVrmFullBodyIkDependencies = DEFAULT_DEPENDENCIES,
): StudioVrmFullBodyIkResult | null {
  const profile = request.jointProfile === undefined
    ? normalizeStudioVrmRigProfile("neutral")
    : normalizeStudioVrmRigProfile(request.jointProfile);
  const baseTranslations = normalizeStudioVrmPoseTranslations(
    request.baseTranslations ?? EMPTY_STUDIO_VRM_POSE_TRANSLATIONS,
  );
  const iterations = request.iterations ?? DEFAULT_ITERATIONS;
  const tolerance = request.tolerance ?? DEFAULT_TOLERANCE;
  if (
    !profile
    || !baseTranslations
    || !isFiniteVector(request.primary.targetWorld)
    || (request.primary.poleWorld !== undefined && !isFiniteVector(request.primary.poleWorld))
    || typeof request.fullBodyIk !== "boolean"
    || !Number.isInteger(iterations)
    || iterations < MIN_ITERATIONS
    || iterations > MAX_ITERATIONS
    || !Number.isFinite(tolerance)
    || tolerance <= 0
    || tolerance > MAX_TOLERANCE
  ) return null;
  const lockedTargets = request.lockedTargets ?? [];
  if (
    lockedTargets.length > EFFECTOR_ORDER.length - 1
    || new Set(lockedTargets.map((constraint) => constraint.effector)).size !== lockedTargets.length
    || lockedTargets.some((constraint) => (
      constraint.effector === request.primary.effector
      || !EFFECTOR_ORDER.includes(constraint.effector)
      || !isFiniteVector(constraint.targetWorld)
      || (constraint.poleWorld !== undefined && !isFiniteVector(constraint.poleWorld))
    ))
  ) return null;

  try {
    source.scene.updateMatrixWorld(true);
    const baked = bakeStudioVrmRuntimePose(source);
    if (!baked || !Number.isFinite(baked.yOffset)) return null;
    const constraints = buildConstraints(source, request);
    if (!constraints || constraints.length === 0 || constraints.length > EFFECTOR_ORDER.length) {
      return null;
    }

    const rootWorld = new THREE.Vector3();
    const hipsWorld = new THREE.Vector3();
    const spineWorld = new THREE.Vector3();
    let translationLimited = false;
    let iterationsUsed = 1;

    if (request.fullBodyIk) {
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        iterationsUsed = iteration + 1;
        const commonErrors = constraints.map((constraint) => {
          const influence = influenceFor(constraint, rootWorld, hipsWorld, spineWorld);
          const outside = outsideReachResidual(constraint, influence);
          if (!constraint.locked) return outside;
          // A small contact term shares floor/lock correction with the torso even while a leg can
          // still reach. This converges smoothly without making the root chase either foot alone.
          const contact = constraint.target.clone().sub(constraint.end).sub(influence)
            .multiplyScalar(0.12);
          return outside.add(contact);
        });
        const common = mean(commonErrors);
        // The mean is only the shared root/hips step direction. Opposing foot-contact and hand
        // errors can cancel to zero even though an individual hand still needs a spine pass.
        if (common.length() > tolerance) {
          const rootStep = clampIterationStep(common.clone().multiplyScalar(0.2));
          const hipsStep = clampIterationStep(common.clone().multiplyScalar(
            0.55 * profile.hipsWeight,
          ));
          rootWorld.add(rootStep);
          hipsWorld.add(hipsStep);
          translationLimited = clampVectorLength(rootWorld, MAX_ROOT_CORRECTION)
            || translationLimited;
          translationLimited = clampVectorLength(hipsWorld, MAX_HIPS_CORRECTION)
            || translationLimited;
        }

        const handErrors = constraints
          .filter((constraint) => STUDIO_VRM_USER_IK_CHAINS[constraint.effector].kind === "hand")
          .map((constraint) => outsideReachResidual(
            constraint,
            influenceFor(constraint, rootWorld, hipsWorld, spineWorld),
          ));
        if (handErrors.length > 0) {
          const handError = mean(handErrors);
          if (handError.length() > tolerance) {
            const spineStep = clampIterationStep(handError.multiplyScalar(
              0.85 * profile.spineWeight,
            ));
            spineWorld.add(spineStep);
            translationLimited = clampVectorLength(spineWorld, MAX_SPINE_CORRECTION)
              || translationLimited;
          }
        }
        // Only individual residuals decide convergence; averaged step vectors are never a
        // termination criterion because they can cancel geometrically.
        if (maxConstraintResidual(constraints, rootWorld, hipsWorld, spineWorld) <= tolerance) {
          break;
        }
      }
    }

    const rootLocalDelta = worldVectorToParentLocal(source.scene, rootWorld);
    const hipsLocalDelta = worldVectorToLocal(source.scene, hipsWorld);
    const spineLocalDelta = worldVectorToLocal(source.scene, spineWorld);
    if (!rootLocalDelta || !hipsLocalDelta || !spineLocalDelta) return null;

    const nextRoot = new THREE.Vector3(...baseTranslations.root).add(
      new THREE.Vector3(rootLocalDelta.x, 0, rootLocalDelta.z),
    );
    const nextHips = new THREE.Vector3(...baseTranslations.hips).add(hipsLocalDelta);
    const nextSpine = new THREE.Vector3(...baseTranslations.spine).add(spineLocalDelta);
    // The scene-document contract bounds authored translations per axis. Preserve every valid
    // corner value (for example [2, 2, 2]) instead of silently shrinking it with a radial clamp.
    translationLimited = clampVectorComponents(
      nextHips,
      STUDIO_VRM_HIPS_TRANSLATION_LIMIT,
    ) || translationLimited;
    translationLimited = clampVectorComponents(
      nextSpine,
      STUDIO_VRM_SPINE_TRANSLATION_LIMIT,
    )
      || translationLimited;
    const unclampedRootX = nextRoot.x;
    const unclampedRootZ = nextRoot.z;
    nextRoot.x = THREE.MathUtils.clamp(
      nextRoot.x,
      -STUDIO_VRM_ROOT_TRANSLATION_LIMIT,
      STUDIO_VRM_ROOT_TRANSLATION_LIMIT,
    );
    nextRoot.y = 0;
    nextRoot.z = THREE.MathUtils.clamp(
      nextRoot.z,
      -STUDIO_VRM_ROOT_TRANSLATION_LIMIT,
      STUDIO_VRM_ROOT_TRANSLATION_LIMIT,
    );
    if (
      Math.abs(nextRoot.x - unclampedRootX) > LENGTH_EPSILON
      || Math.abs(nextRoot.z - unclampedRootZ) > LENGTH_EPSILON
    ) {
      translationLimited = true;
    }

    // Recompute the actual bounded incremental influence so reported endpoints and chain targets
    // stay exact when a canonical translation cap was reached.
    const yOffset = THREE.MathUtils.clamp(
      baked.yOffset + rootLocalDelta.y,
      -STUDIO_VRM_ROOT_TRANSLATION_LIMIT,
      STUDIO_VRM_ROOT_TRANSLATION_LIMIT,
    );
    if (Math.abs(yOffset - (baked.yOffset + rootLocalDelta.y)) > LENGTH_EPSILON) {
      translationLimited = true;
    }
    const actualRootLocalDelta = nextRoot.clone().sub(new THREE.Vector3(...baseTranslations.root));
    actualRootLocalDelta.y = yOffset - baked.yOffset;
    const actualHipsLocalDelta = nextHips.clone().sub(new THREE.Vector3(...baseTranslations.hips));
    const actualSpineLocalDelta = nextSpine.clone().sub(new THREE.Vector3(...baseTranslations.spine));
    const actualRootWorld = parentLocalVectorToWorld(source.scene, actualRootLocalDelta);
    const actualHipsWorld = localVectorToWorld(source.scene, actualHipsLocalDelta);
    const actualSpineWorld = localVectorToWorld(source.scene, actualSpineLocalDelta);
    if (!actualRootWorld || !actualHipsWorld || !actualSpineWorld) return null;

    const translations: StudioVrmPoseTranslations = Object.freeze({
      version: 1,
      root: tuple(nextRoot),
      hips: tuple(nextHips),
      spine: tuple(nextSpine),
    });
    let bones: PoseBoneMap = { ...baked.bones };
    const constraintResults: StudioVrmFullBodyIkConstraintResult[] = [];
    let primaryResult: StudioVrmUserIkResult | null = null;
    for (const constraint of constraints) {
      const influence = influenceFor(
        constraint,
        actualRootWorld,
        actualHipsWorld,
        actualSpineWorld,
      );
      const adjustedTarget = constraint.target.clone().sub(influence);
      const solved = dependencies.solveChain(source, {
        effector: constraint.effector,
        targetWorld: adjustedTarget,
        // Target and pole share the same world-coordinate contract. The chain is solved against the
        // untranslated baseline graph, so both points must remove the allocated body influence.
        poleWorld: constraint.pole?.clone().sub(influence),
        jointProfile: profile,
        fullBodyIk: false,
        footPlant: false,
      });
      if (!solved) return null;
      const chain = STUDIO_VRM_USER_IK_CHAINS[constraint.effector];
      bones = {
        ...bones,
        [chain.upper]: solved.bones[chain.upper],
        [chain.lower]: solved.bones[chain.lower],
      };
      const effectiveTarget = new THREE.Vector3(...solved.effectiveTargetWorld).add(influence);
      const residual = effectiveTarget.distanceTo(constraint.target);
      if (!Number.isFinite(residual)) return null;
      constraintResults.push(Object.freeze({
        effector: constraint.effector,
        targetWorld: tuple(constraint.target),
        effectiveTargetWorld: tuple(effectiveTarget),
        residual,
        locked: constraint.locked,
        reachable: solved.reachable,
        clamped: solved.clamped,
        limited: solved.limited,
      }));
      if (constraint.effector === request.primary.effector) primaryResult = solved;
    }
    if (!primaryResult) return null;
    const primaryConstraint = constraintResults.find(
      (constraint) => constraint.effector === request.primary.effector,
    );
    if (!primaryConstraint) return null;
    const maxResidual = constraintResults.reduce(
      (maximum, constraint) => Math.max(maximum, constraint.residual),
      0,
    );
    return Object.freeze({
      effector: request.primary.effector,
      bones,
      yOffset,
      translations,
      requestedTargetWorld: primaryConstraint.targetWorld,
      effectiveTargetWorld: primaryConstraint.effectiveTargetWorld,
      constraints: Object.freeze(constraintResults),
      iterations: iterationsUsed,
      converged: maxResidual <= tolerance,
      maxResidual,
      clamped: translationLimited || constraintResults.some((constraint) => constraint.clamped),
      limited: translationLimited || constraintResults.some((constraint) => constraint.limited),
      translationLimited,
    });
  } catch {
    return null;
  }
}
