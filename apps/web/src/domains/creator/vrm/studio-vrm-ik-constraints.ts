import * as THREE from "three";

import {
  STUDIO_VRM_IK_EFFECTORS,
  STUDIO_VRM_MAX_IK_CONSTRAINTS,
  type StudioVrmIkConstraint,
  type StudioVrmIkEffector,
  type StudioVrmVec3,
} from "./studio-vrm-scene-document";

import type { StudioVrmFullBodyIkResult } from "./studio-vrm-full-body-ik";
import type { StudioVrmPoseMirrorScope } from "./studio-vrm-pose-editing";
import type { StudioVrmUserIkResult } from "./studio-vrm-user-ik";

const MAX_SCENE_COORDINATE = 10_000;
const CONSTRAINT_KEYS = new Set(["effector", "enabled", "locked", "target", "pole"]);
const EFFECTOR_SET = new Set<string>(STUDIO_VRM_IK_EFFECTORS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEffector(value: unknown): value is StudioVrmIkEffector {
  return typeof value === "string" && EFFECTOR_SET.has(value);
}

function point(value: unknown): StudioVrmVec3 | null {
  if (
    !Array.isArray(value)
    || value.length !== 3
    || value.some((coordinate) => (
      typeof coordinate !== "number"
      || !Number.isFinite(coordinate)
      || Math.abs(coordinate) > MAX_SCENE_COORDINATE
    ))
  ) return null;
  return [
    Object.is(value[0], -0) ? 0 : value[0],
    Object.is(value[1], -0) ? 0 : value[1],
    Object.is(value[2], -0) ? 0 : value[2],
  ];
}

/** Strictly parses the exact persistent-IK DTO and returns canonical effector order. */
export function parseStudioVrmIkConstraints(
  value: unknown,
): readonly StudioVrmIkConstraint[] | null {
  if (!Array.isArray(value) || value.length > STUDIO_VRM_MAX_IK_CONSTRAINTS) return null;
  const constraints = new Map<StudioVrmIkEffector, StudioVrmIkConstraint>();
  for (const candidate of value) {
    if (!isRecord(candidate)) return null;
    const keys = Object.keys(candidate);
    if (
      keys.length !== CONSTRAINT_KEYS.size
      || keys.some((key) => !CONSTRAINT_KEYS.has(key))
      || !isEffector(candidate.effector)
      || constraints.has(candidate.effector)
      || typeof candidate.enabled !== "boolean"
      || typeof candidate.locked !== "boolean"
    ) return null;
    const target = point(candidate.target);
    const pole = candidate.pole === null ? null : point(candidate.pole);
    if (!target || (candidate.pole !== null && !pole)) return null;
    constraints.set(candidate.effector, {
      effector: candidate.effector,
      enabled: candidate.enabled,
      locked: candidate.locked,
      target,
      pole,
    });
  }
  return STUDIO_VRM_IK_EFFECTORS.flatMap((effector) => {
    const constraint = constraints.get(effector);
    return constraint ? [constraint] : [];
  });
}

export function cloneStudioVrmIkConstraints(
  value: readonly StudioVrmIkConstraint[],
): StudioVrmIkConstraint[] {
  return value.map((constraint) => ({
    effector: constraint.effector,
    enabled: constraint.enabled,
    locked: constraint.locked,
    target: [...constraint.target],
    pole: constraint.pole ? [...constraint.pole] : null,
  }));
}

/** Single-chain IK has no convergence flag; only a full-body solve must explicitly converge. */
export function canCommitStudioVrmIkResult(
  result: StudioVrmUserIkResult | StudioVrmFullBodyIkResult,
): boolean {
  return !("constraints" in result) || result.converged;
}

export function upsertStudioVrmIkConstraint(
  constraints: readonly StudioVrmIkConstraint[],
  next: StudioVrmIkConstraint,
): StudioVrmIkConstraint[] {
  const byEffector = new Map(constraints.map((constraint) => [constraint.effector, constraint]));
  byEffector.set(next.effector, next);
  return STUDIO_VRM_IK_EFFECTORS.flatMap((effector) => {
    const constraint = byEffector.get(effector);
    return constraint ? cloneStudioVrmIkConstraints([constraint]) : [];
  });
}

export function removeStudioVrmIkConstraint(
  constraints: readonly StudioVrmIkConstraint[],
  effector: StudioVrmIkEffector,
): StudioVrmIkConstraint[] {
  return cloneStudioVrmIkConstraints(
    constraints.filter((constraint) => constraint.effector !== effector),
  );
}

function mirroredEffector(effector: StudioVrmIkEffector): StudioVrmIkEffector {
  if (effector.startsWith("left")) return `right${effector.slice(4)}` as StudioVrmIkEffector;
  return `left${effector.slice(5)}` as StudioVrmIkEffector;
}

function belongsToScope(effector: StudioVrmIkEffector, scope: StudioVrmPoseMirrorScope): boolean {
  if (scope === "all") return true;
  if (scope === "arms") return effector.endsWith("Hand");
  if (scope === "legs") return effector.endsWith("Foot");
  return false;
}

/** Mirrors scoped targets and poles, exchanging left/right ownership without touching other pins. */
export function mirrorStudioVrmIkConstraints(
  constraints: readonly StudioVrmIkConstraint[],
  scope: StudioVrmPoseMirrorScope,
): StudioVrmIkConstraint[] {
  const mirrored = constraints.map((constraint) => {
    if (!belongsToScope(constraint.effector, scope)) return constraint;
    return {
      ...constraint,
      effector: mirroredEffector(constraint.effector),
      target: [-constraint.target[0], constraint.target[1], constraint.target[2]] as StudioVrmVec3,
      pole: constraint.pole
        ? [-constraint.pole[0], constraint.pole[1], constraint.pole[2]] as StudioVrmVec3
        : null,
    };
  });
  return STUDIO_VRM_IK_EFFECTORS.flatMap((effector) => {
    const constraint = mirrored.find((candidate) => candidate.effector === effector);
    return constraint ? cloneStudioVrmIkConstraints([constraint]) : [];
  });
}

function finitePoint(value: THREE.Vector3): StudioVrmVec3 | null {
  if (
    !Number.isFinite(value.x)
    || !Number.isFinite(value.y)
    || !Number.isFinite(value.z)
    || Math.abs(value.x) > MAX_SCENE_COORDINATE
    || Math.abs(value.y) > MAX_SCENE_COORDINATE
    || Math.abs(value.z) > MAX_SCENE_COORDINATE
  ) return null;
  return [
    Object.is(value.x, -0) ? 0 : value.x,
    Object.is(value.y, -0) ? 0 : value.y,
    Object.is(value.z, -0) ? 0 : value.z,
  ];
}

/** Converts a pointer/solver world point into the stable canvas-scene persistence coordinate. */
export function studioVrmWorldPointToSceneLocal(
  scene: THREE.Object3D,
  world: StudioVrmVec3 | THREE.Vector3,
): StudioVrmVec3 | null {
  scene.updateWorldMatrix(true, false);
  const determinant = scene.matrixWorld.determinant();
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  const vector = world instanceof THREE.Vector3
    ? world.clone()
    : new THREE.Vector3(world[0], world[1], world[2]);
  vector.applyMatrix4(scene.matrixWorld.clone().invert());
  return finitePoint(vector);
}

/** Resolves a persisted canvas-scene target/pole independently of avatar root/rotation/scale. */
export function studioVrmSceneLocalPointToWorld(
  scene: THREE.Object3D,
  local: StudioVrmVec3,
): StudioVrmVec3 | null {
  scene.updateWorldMatrix(true, false);
  return finitePoint(new THREE.Vector3(local[0], local[1], local[2]).applyMatrix4(scene.matrixWorld));
}

export function enabledStudioVrmIkTargetsWorld(
  scene: THREE.Object3D,
  constraints: readonly StudioVrmIkConstraint[],
): Partial<Record<StudioVrmIkEffector, StudioVrmVec3>> {
  const result: Partial<Record<StudioVrmIkEffector, StudioVrmVec3>> = {};
  for (const constraint of constraints) {
    if (!constraint.enabled) continue;
    const target = studioVrmSceneLocalPointToWorld(scene, constraint.target);
    if (target) result[constraint.effector] = target;
  }
  return result;
}

/** Pure render-safe projection used by the R3F handle bridge; world resolution happens in-frame. */
export function enabledStudioVrmIkTargetsSceneLocal(
  constraints: readonly StudioVrmIkConstraint[],
): Partial<Record<StudioVrmIkEffector, StudioVrmVec3>> {
  const result: Partial<Record<StudioVrmIkEffector, StudioVrmVec3>> = {};
  for (const constraint of constraints) {
    if (constraint.enabled) result[constraint.effector] = [...constraint.target];
  }
  return result;
}

/** Enabled pole controls are copied so the transient handle layer never mutates persisted DTOs. */
export function enabledStudioVrmIkPolesSceneLocal(
  constraints: readonly StudioVrmIkConstraint[],
): Partial<Record<StudioVrmIkEffector, StudioVrmVec3>> {
  const result: Partial<Record<StudioVrmIkEffector, StudioVrmVec3>> = {};
  for (const constraint of constraints) {
    if (constraint.enabled && constraint.pole) {
      result[constraint.effector] = [...constraint.pole];
    }
  }
  return result;
}
