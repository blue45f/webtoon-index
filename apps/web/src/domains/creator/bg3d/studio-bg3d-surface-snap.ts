/**
 * Pure surface-placement math for Studio's 3D background editor.
 *
 * R3F owns hit testing and supplies a world-space hit. This boundary validates selection identity,
 * excludes the complete selected subtree, and returns one local-position patch without mutating a
 * Three object, scene, matrix, or caller-owned array.
 */

import * as THREE from "three";

export type StudioBg3dSurfaceSnapVec3 = readonly [number, number, number];

export interface StudioBg3dSurfaceSnapBounds {
  readonly min: StudioBg3dSurfaceSnapVec3;
  readonly max: StudioBg3dSurfaceSnapVec3;
}

export interface ResolveStudioBg3dSurfaceSnapInput {
  /** The editor's complete selection; v1 intentionally admits exactly one object. */
  readonly selectedIds: readonly string[];
  readonly selectionId: string;
  /** Includes selectionId and every descendant that must be excluded from R3F hit ownership. */
  readonly selectionSubtreeIds: readonly string[];
  readonly locked: boolean;
  readonly localPosition: StudioBg3dSurfaceSnapVec3;
  /**
   * Preserved byte-for-byte in a successful result when `alignRotationToNormal` is false/omitted.
   * When alignment is requested, success.rotation is replaced by the normal orientation.
   */
  readonly rotation: StudioBg3dSurfaceSnapVec3;
  /** Axis-aligned bounds measured in world space after the object's rotation and scale. */
  readonly worldBounds: StudioBg3dSurfaceSnapBounds;
  /** World-space matrix of the selected object's parent. Omit for a scene root. */
  readonly parentWorldMatrix?: readonly number[];
  readonly hit: {
    /** Entity ancestry for the hit mesh, from leaf toward its scene root. */
    readonly targetPathIds: readonly string[];
    readonly point: StudioBg3dSurfaceSnapVec3;
    /** World-space surface normal. */
    readonly normal: StudioBg3dSurfaceSnapVec3;
  };
  /** Signed world-unit separation applied along the normalized hit normal. */
  readonly surfaceOffset?: number;
  /**
   * When true, success.rotation aligns local +Y with the hit normal (see
   * `resolveStudioBg3dSurfaceSnapOrientation`). Default false preserves v1 rotation bytes.
   */
  readonly alignRotationToNormal?: boolean;
}

export type StudioBg3dSurfaceSnapFailureReason =
  | "invalid-input"
  | "selection-count"
  | "selection-mismatch"
  | "locked"
  | "self-hit"
  | "invalid-bounds"
  | "invalid-hit"
  | "invalid-parent-transform"
  | "result-out-of-bounds";

export interface StudioBg3dSurfaceSnapSuccess {
  readonly ok: true;
  readonly localPosition: StudioBg3dSurfaceSnapVec3;
  readonly worldPosition: StudioBg3dSurfaceSnapVec3;
  readonly worldDelta: StudioBg3dSurfaceSnapVec3;
  readonly sourceBottomCenter: StudioBg3dSurfaceSnapVec3;
  readonly targetPoint: StudioBg3dSurfaceSnapVec3;
  readonly rotation: StudioBg3dSurfaceSnapVec3;
}

export interface StudioBg3dSurfaceSnapFailure {
  readonly ok: false;
  readonly reason: StudioBg3dSurfaceSnapFailureReason;
}

export type StudioBg3dSurfaceSnapResult =
  | StudioBg3dSurfaceSnapSuccess
  | StudioBg3dSurfaceSnapFailure;

export type StudioBg3dMultiSurfaceSnapPlanResult =
  | {
      readonly ok: true;
      readonly results: readonly StudioBg3dSurfaceSnapResult[];
    }
  | {
      readonly ok: false;
      readonly reason: StudioBg3dSurfaceSnapFailureReason | "empty-inputs";
      readonly results?: readonly StudioBg3dSurfaceSnapResult[];
    };

export const STUDIO_BG3D_SURFACE_SNAP_MAX_WORLD_COORDINATE = 10_000;
export const STUDIO_BG3D_SURFACE_SNAP_MAX_SUBTREE_IDS = 512;
export const STUDIO_BG3D_SURFACE_SNAP_MAX_MULTI_INPUTS = 64;

const MAX_DELTA = STUDIO_BG3D_SURFACE_SNAP_MAX_WORLD_COORDINATE * 2;
const MAX_MATRIX_COMPONENT = 100_000_000;
const MAX_ROTATION_COMPONENT = 1_000_000;
const MAX_SURFACE_OFFSET = 1_000;
const MIN_NORMAL_LENGTH = 1e-6;
const MIN_AFFINE_DETERMINANT = 1e-12;
const AFFINE_EPSILON = 1e-9;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;

function failure(reason: StudioBg3dSurfaceSnapFailureReason): StudioBg3dSurfaceSnapFailure {
  return Object.freeze({ ok: false, reason });
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function finiteVec3(
  value: unknown,
  maximumAbsoluteComponent: number,
): value is StudioBg3dSurfaceSnapVec3 {
  return Array.isArray(value) && value.length === 3 && value.every((component) => (
    finiteInRange(component, -maximumAbsoluteComponent, maximumAbsoluteComponent)
  ));
}

function validId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function readUniqueIds(value: unknown, allowEmpty: boolean): readonly string[] | null {
  if (
    !Array.isArray(value) ||
    value.length > STUDIO_BG3D_SURFACE_SNAP_MAX_SUBTREE_IDS ||
    (!allowEmpty && value.length === 0)
  ) return null;
  const ids = new Set<string>();
  for (const id of value) {
    if (!validId(id) || ids.has(id)) return null;
    ids.add(id);
  }
  return [...ids];
}

/** Resolves one canonical entity ancestry path (leaf first), rejecting cycles and missing links. */
export function collectStudioBg3dSurfaceTargetPathIds(
  targetId: string,
  parentById: ReadonlyMap<string, string | null>,
): readonly string[] | null {
  if (!validId(targetId) || !parentById.has(targetId)) return null;
  const path: string[] = [];
  const visited = new Set<string>();
  let current: string | null = targetId;
  while (current !== null) {
    if (!validId(current) || visited.has(current) || !parentById.has(current)) return null;
    visited.add(current);
    path.push(current);
    if (path.length > STUDIO_BG3D_SURFACE_SNAP_MAX_SUBTREE_IDS) return null;
    current = parentById.get(current) ?? null;
  }
  return Object.freeze(path);
}

/** Resolves the complete selected runtime subtree used by the self-hit exclusion policy. */
export function collectStudioBg3dSurfaceSelectionSubtreeIds(
  selectionId: string,
  childrenByParent: ReadonlyMap<string, readonly string[]>,
): readonly string[] | null {
  if (!validId(selectionId)) return null;
  const subtree: string[] = [];
  const visited = new Set<string>();
  const pending = [selectionId];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || !validId(current) || visited.has(current)) return null;
    visited.add(current);
    subtree.push(current);
    if (subtree.length > STUDIO_BG3D_SURFACE_SNAP_MAX_SUBTREE_IDS) return null;
    const children = childrenByParent.get(current) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (!validId(child)) return null;
      pending.push(child);
    }
  }
  return Object.freeze(subtree);
}

function readBounds(bounds: StudioBg3dSurfaceSnapBounds): {
  readonly min: StudioBg3dSurfaceSnapVec3;
  readonly max: StudioBg3dSurfaceSnapVec3;
  readonly bottomCenter: StudioBg3dSurfaceSnapVec3;
} | null {
  if (
    typeof bounds !== "object" || bounds === null ||
    !finiteVec3(bounds.min, STUDIO_BG3D_SURFACE_SNAP_MAX_WORLD_COORDINATE) ||
    !finiteVec3(bounds.max, STUDIO_BG3D_SURFACE_SNAP_MAX_WORLD_COORDINATE)
  ) return null;
  for (let index = 0; index < 3; index += 1) {
    if (bounds.min[index] > bounds.max[index]) return null;
  }
  return {
    min: bounds.min,
    max: bounds.max,
    bottomCenter: [
      (bounds.min[0] + bounds.max[0]) / 2,
      bounds.min[1],
      (bounds.min[2] + bounds.max[2]) / 2,
    ],
  };
}

function readParentWorldMatrix(value: unknown): {
  readonly world: THREE.Matrix4;
  readonly inverse: THREE.Matrix4;
} | null {
  if (value === undefined) {
    const identity = new THREE.Matrix4();
    return { world: identity, inverse: identity.clone() };
  }
  if (
    !Array.isArray(value) || value.length !== 16 ||
    !value.every((component) => finiteInRange(
      component,
      -MAX_MATRIX_COMPONENT,
      MAX_MATRIX_COMPONENT,
    ))
  ) return null;
  // Object3D.matrixWorld is affine. Reject projective matrices before applying Vector3.applyMatrix4.
  if (
    Math.abs(value[3]) > AFFINE_EPSILON ||
    Math.abs(value[7]) > AFFINE_EPSILON ||
    Math.abs(value[11]) > AFFINE_EPSILON ||
    Math.abs(value[15] - 1) > AFFINE_EPSILON
  ) return null;
  const world = new THREE.Matrix4().fromArray(value);
  const determinant = world.determinant();
  if (!Number.isFinite(determinant) || Math.abs(determinant) < MIN_AFFINE_DETERMINANT) return null;
  const inverse = world.clone().invert();
  if (!inverse.elements.every((component) => Number.isFinite(component))) return null;
  return { world, inverse };
}

function tuple(vector: THREE.Vector3): StudioBg3dSurfaceSnapVec3 {
  return Object.freeze([vector.x, vector.y, vector.z] as const);
}

/**
 * Pure Euler XYZ (radians) that aligns local +Y with the hit normal.
 *
 * Builds an orthonormal basis (X, Y=normal, Z) using `up` (default world +Y) to resolve roll, then
 * extracts XYZ Euler. Fails closed on zero-length normals or non-finite components.
 */
export function resolveStudioBg3dSurfaceSnapOrientation(
  normal: StudioBg3dSurfaceSnapVec3,
  options?: { readonly up?: StudioBg3dSurfaceSnapVec3 },
): StudioBg3dSurfaceSnapVec3 | null {
  if (!finiteVec3(normal, MAX_ROTATION_COMPONENT)) return null;
  const yAxis = new THREE.Vector3(normal[0], normal[1], normal[2]);
  const normalLength = yAxis.length();
  if (!Number.isFinite(normalLength) || normalLength < MIN_NORMAL_LENGTH) return null;
  yAxis.multiplyScalar(1 / normalLength);

  const upRaw = options?.up ?? ([0, 1, 0] as const);
  if (!finiteVec3(upRaw, MAX_ROTATION_COMPONENT)) return null;
  const up = new THREE.Vector3(upRaw[0], upRaw[1], upRaw[2]);
  const upLength = up.length();
  if (!Number.isFinite(upLength) || upLength < MIN_NORMAL_LENGTH) return null;
  up.multiplyScalar(1 / upLength);

  // Prefer X = normalize(up × Y). When the normal is parallel to up, use the shortest rotation
  // from local +Y → normal so a world-up hit stays near identity Euler (v1-friendly).
  const xAxis = new THREE.Vector3().crossVectors(up, yAxis);
  let euler: THREE.Euler;
  if (xAxis.lengthSq() < MIN_NORMAL_LENGTH * MIN_NORMAL_LENGTH) {
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      yAxis,
    );
    euler = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
  } else {
    xAxis.normalize();
    const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
    if (zAxis.lengthSq() < MIN_NORMAL_LENGTH * MIN_NORMAL_LENGTH) return null;
    zAxis.normalize();
    const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    euler = new THREE.Euler().setFromRotationMatrix(basis, "XYZ");
  }
  if (
    !Number.isFinite(euler.x) ||
    !Number.isFinite(euler.y) ||
    !Number.isFinite(euler.z)
  ) {
    return null;
  }
  return Object.freeze([euler.x, euler.y, euler.z] as const);
}

/**
 * Resolves one placement patch. By default preserves rotation and moves the measured world-bounds
 * bottom centre to hit.point + normalized(hit.normal) * surfaceOffset.
 *
 * When `alignRotationToNormal` is true, success.rotation is the pure orientation that maps local
 * +Y onto the hit normal; position math is otherwise unchanged.
 */
export function resolveStudioBg3dSurfaceSnap(
  input: ResolveStudioBg3dSurfaceSnapInput,
): StudioBg3dSurfaceSnapResult {
  if (typeof input !== "object" || input === null) return failure("invalid-input");
  const selectedIds = readUniqueIds(input.selectedIds, true);
  if (!selectedIds) return failure("invalid-input");
  if (selectedIds.length !== 1) return failure("selection-count");
  if (!validId(input.selectionId) || selectedIds[0] !== input.selectionId) {
    return failure("selection-mismatch");
  }
  if (typeof input.locked !== "boolean") return failure("invalid-input");
  if (input.locked) return failure("locked");
  if (
    input.alignRotationToNormal !== undefined &&
    typeof input.alignRotationToNormal !== "boolean"
  ) {
    return failure("invalid-input");
  }

  const subtreeIds = readUniqueIds(input.selectionSubtreeIds, false);
  const hitPathIds = readUniqueIds(input.hit?.targetPathIds, false);
  if (!subtreeIds || !subtreeIds.includes(input.selectionId) || !hitPathIds) {
    return failure("invalid-input");
  }
  const subtree = new Set(subtreeIds);
  if (hitPathIds.some((id) => subtree.has(id))) return failure("self-hit");

  if (
    !finiteVec3(input.localPosition, STUDIO_BG3D_SURFACE_SNAP_MAX_WORLD_COORDINATE) ||
    !finiteVec3(input.rotation, MAX_ROTATION_COMPONENT)
  ) return failure("invalid-input");
  const bounds = readBounds(input.worldBounds);
  if (!bounds) return failure("invalid-bounds");
  if (
    typeof input.hit !== "object" || input.hit === null ||
    !finiteVec3(input.hit.point, STUDIO_BG3D_SURFACE_SNAP_MAX_WORLD_COORDINATE) ||
    !finiteVec3(input.hit.normal, MAX_ROTATION_COMPONENT)
  ) return failure("invalid-hit");
  const normal = new THREE.Vector3(...input.hit.normal);
  const normalLength = normal.length();
  if (!Number.isFinite(normalLength) || normalLength < MIN_NORMAL_LENGTH) {
    return failure("invalid-hit");
  }
  normal.multiplyScalar(1 / normalLength);
  const surfaceOffset = input.surfaceOffset ?? 0;
  if (!finiteInRange(surfaceOffset, -MAX_SURFACE_OFFSET, MAX_SURFACE_OFFSET)) {
    return failure("invalid-hit");
  }

  const parent = readParentWorldMatrix(input.parentWorldMatrix);
  if (!parent) return failure("invalid-parent-transform");
  const currentWorldPosition = new THREE.Vector3(...input.localPosition).applyMatrix4(parent.world);
  if (!finiteVec3(
    currentWorldPosition.toArray(),
    STUDIO_BG3D_SURFACE_SNAP_MAX_WORLD_COORDINATE,
  )) return failure("result-out-of-bounds");

  const targetPoint = new THREE.Vector3(...input.hit.point).addScaledVector(normal, surfaceOffset);
  const sourceBottomCenter = new THREE.Vector3(...bounds.bottomCenter);
  const worldDelta = targetPoint.clone().sub(sourceBottomCenter);
  const nextWorldPosition = currentWorldPosition.clone().add(worldDelta);
  const nextLocalPosition = nextWorldPosition.clone().applyMatrix4(parent.inverse);
  if (
    !finiteVec3(targetPoint.toArray(), STUDIO_BG3D_SURFACE_SNAP_MAX_WORLD_COORDINATE) ||
    !finiteVec3(worldDelta.toArray(), MAX_DELTA) ||
    !finiteVec3(nextWorldPosition.toArray(), STUDIO_BG3D_SURFACE_SNAP_MAX_WORLD_COORDINATE) ||
    !finiteVec3(nextLocalPosition.toArray(), STUDIO_BG3D_SURFACE_SNAP_MAX_WORLD_COORDINATE)
  ) return failure("result-out-of-bounds");

  let rotation: StudioBg3dSurfaceSnapVec3 = Object.freeze(
    [...input.rotation] as [number, number, number],
  );
  if (input.alignRotationToNormal === true) {
    const oriented = resolveStudioBg3dSurfaceSnapOrientation(input.hit.normal);
    if (!oriented) return failure("invalid-hit");
    rotation = oriented;
  }

  return Object.freeze({
    ok: true,
    localPosition: tuple(nextLocalPosition),
    worldPosition: tuple(nextWorldPosition),
    worldDelta: tuple(worldDelta),
    sourceBottomCenter: tuple(sourceBottomCenter),
    targetPoint: tuple(targetPoint),
    rotation,
  });
}

/**
 * Plans independent surface snaps for multiple objects. Each input is resolved with the single-
 * selection contract; locked/self-hit siblings become individual `ok:false` results and do not
 * abort neighbors. The plan succeeds when at least one input succeeds. Empty or oversized input
 * lists fail closed without mutating caller arrays.
 */
export function planStudioBg3dMultiSurfaceSnap(
  inputs: readonly ResolveStudioBg3dSurfaceSnapInput[],
): StudioBg3dMultiSurfaceSnapPlanResult {
  if (!Array.isArray(inputs)) {
    return Object.freeze({ ok: false, reason: "invalid-input" as const });
  }
  if (inputs.length === 0) {
    return Object.freeze({ ok: false, reason: "empty-inputs" as const });
  }
  if (inputs.length > STUDIO_BG3D_SURFACE_SNAP_MAX_MULTI_INPUTS) {
    return Object.freeze({ ok: false, reason: "invalid-input" as const });
  }

  const results: StudioBg3dSurfaceSnapResult[] = [];
  let successCount = 0;
  for (const input of inputs) {
    if (typeof input !== "object" || input === null) {
      return Object.freeze({
        ok: false,
        reason: "invalid-input" as const,
        results: Object.freeze([...results]),
      });
    }
    const result = resolveStudioBg3dSurfaceSnap(input);
    results.push(result);
    if (result.ok) successCount += 1;
  }

  const frozenResults = Object.freeze(results.slice());
  if (successCount === 0) {
    return Object.freeze({
      ok: false,
      reason: frozenResults[0]?.ok === false
        ? frozenResults[0].reason
        : ("invalid-input" as const),
      results: frozenResults,
    });
  }
  return Object.freeze({ ok: true, results: frozenResults });
}
