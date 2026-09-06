import * as THREE from "three";

import { resolveStudioBg3dHierarchy } from "./studio-bg3d-hierarchy";

export type StudioBg3dShadowVec3 = readonly [number, number, number];

export interface StudioBg3dShadowBounds {
  readonly min: StudioBg3dShadowVec3;
  readonly max: StudioBg3dShadowVec3;
}

export interface StudioBg3dShadowSceneEntity {
  readonly id: string;
  readonly parentId?: string | null;
  readonly position: StudioBg3dShadowVec3;
  readonly rotation: StudioBg3dShadowVec3;
  readonly scale: StudioBg3dShadowVec3;
  readonly visible?: boolean;
  /** Exact geometry/model bounds in the entity group's local coordinate system. */
  readonly localBounds: StudioBg3dShadowBounds | null;
}

export interface StudioBg3dCollectedShadowBounds {
  readonly bounds: StudioBg3dShadowBounds | null;
  readonly includedEntityCount: number;
  readonly rejectedEntityCount: number;
  /** True when hostile-but-finite world coordinates had to be admitted at the runtime limit. */
  readonly clamped: boolean;
}

export interface StudioBg3dDirectionalShadowFit {
  readonly position: StudioBg3dShadowVec3;
  readonly target: StudioBg3dShadowVec3;
  /** Orthogonal camera up vector; also handles vertical key/fill directions without lookAt warnings. */
  readonly cameraUp: StudioBg3dShadowVec3;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly near: number;
  readonly far: number;
  readonly bias: number;
  readonly normalBias: number;
  readonly mapSize: number;
  readonly worldUnitsPerTexel: number;
  readonly source: "scene" | "fallback";
  readonly clamped: boolean;
}

export const STUDIO_BG3D_SHADOW_DEFAULT_HALF_EXTENT = 20;
export const STUDIO_BG3D_SHADOW_DEFAULT_LIGHT_DISTANCE = 40;
export const STUDIO_BG3D_SHADOW_MAX_WORLD_COORDINATE = 10_000;
export const STUDIO_BG3D_SHADOW_MAX_HALF_EXTENT = 20_000;
export const STUDIO_BG3D_SHADOW_MAX_LIGHT_DISTANCE = 40_000;
export const STUDIO_BG3D_SHADOW_MAX_FAR = 80_000;

const STUDIO_BG3D_SHADOW_MIN_NEAR = 0.1;
const STUDIO_BG3D_SHADOW_MIN_MAP_SIZE = 128;
const STUDIO_BG3D_SHADOW_MAX_MAP_SIZE = 8_192;
const STUDIO_BG3D_SHADOW_MIN_XY_PADDING = 1;
const STUDIO_BG3D_SHADOW_MIN_DEPTH_PADDING = 2;
const STUDIO_BG3D_SHADOW_MODEL_DEFORMATION_MARGIN = 1.5;
const STUDIO_BG3D_SHADOW_DEFAULT_DIRECTION = Object.freeze([
  0.4,
  1,
  0.35,
] as const);

const modelLocalBoundsCache = new WeakMap<THREE.Object3D, StudioBg3dShadowBounds | null>();

function finiteVec3(value: StudioBg3dShadowVec3 | undefined): value is StudioBg3dShadowVec3 {
  return Boolean(
    Array.isArray(value) && value.length === 3 && value.every((component) => Number.isFinite(component)),
  );
}

function finiteBounds(bounds: StudioBg3dShadowBounds | null | undefined): bounds is StudioBg3dShadowBounds {
  return Boolean(
    bounds && finiteVec3(bounds.min) && finiteVec3(bounds.max) &&
    bounds.min[0] <= bounds.max[0] &&
    bounds.min[1] <= bounds.max[1] &&
    bounds.min[2] <= bounds.max[2],
  );
}

function freezeBounds(min: THREE.Vector3, max: THREE.Vector3): StudioBg3dShadowBounds | null {
  const values = [min.x, min.y, min.z, max.x, max.y, max.z];
  if (
    values.some((value) => !Number.isFinite(value)) ||
    min.x > max.x || min.y > max.y || min.z > max.z
  ) return null;
  return Object.freeze({
    min: Object.freeze([min.x, min.y, min.z] as const),
    max: Object.freeze([max.x, max.y, max.z] as const),
  });
}

function expandedBounds(
  bounds: StudioBg3dShadowBounds,
  factor: number,
): StudioBg3dShadowBounds {
  const safeFactor = Number.isFinite(factor) ? Math.max(1, factor) : 1;
  const center = new THREE.Vector3(
    bounds.min[0] / 2 + bounds.max[0] / 2,
    bounds.min[1] / 2 + bounds.max[1] / 2,
    bounds.min[2] / 2 + bounds.max[2] / 2,
  );
  const halfSize = new THREE.Vector3(
    (bounds.max[0] - bounds.min[0]) / 2,
    (bounds.max[1] - bounds.min[1]) / 2,
    (bounds.max[2] - bounds.min[2]) / 2,
  ).multiplyScalar(safeFactor);
  return freezeBounds(center.clone().sub(halfSize), center.clone().add(halfSize)) ?? bounds;
}

/** Reads the same cached primitive BufferGeometry bounds used by the viewport mesh. */
export function readStudioBg3dShadowGeometryLocalBounds(
  geometry: THREE.BufferGeometry | null | undefined,
): StudioBg3dShadowBounds | null {
  if (!geometry?.isBufferGeometry) return null;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const boundingBox = geometry.boundingBox;
  if (!boundingBox || boundingBox.isEmpty()) return null;
  return freezeBounds(boundingBox.min, boundingBox.max);
}

/**
 * Measures a verified model root once, including authored pivots and child transforms. A bounded
 * deformation margin covers skinned/animated vertices without forcing an every-frame scene walk.
 */
export function readStudioBg3dShadowModelLocalBounds(
  root: THREE.Object3D | null | undefined,
): StudioBg3dShadowBounds | null {
  if (!root?.isObject3D || root.parent) return null;
  if (modelLocalBoundsCache.has(root)) return modelLocalBoundsCache.get(root) ?? null;
  root.updateWorldMatrix(true, true);
  const measured = new THREE.Box3().setFromObject(root, true);
  const bounds = measured.isEmpty() ? null : freezeBounds(measured.min, measured.max);
  const conservative = bounds
    ? expandedBounds(bounds, STUDIO_BG3D_SHADOW_MODEL_DEFORMATION_MARGIN)
    : null;
  modelLocalBoundsCache.set(root, conservative);
  return conservative;
}

function localMatrix(entity: StudioBg3dShadowSceneEntity): THREE.Matrix4 | null {
  if (!finiteVec3(entity.position) || !finiteVec3(entity.rotation) || !finiteVec3(entity.scale)) {
    return null;
  }
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...entity.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...entity.rotation, "XYZ")),
    new THREE.Vector3(...entity.scale),
  );
  return matrix.elements.every(Number.isFinite) ? matrix : null;
}

function boundsCorners(bounds: StudioBg3dShadowBounds): readonly THREE.Vector3[] {
  const corners: THREE.Vector3[] = [];
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        corners.push(new THREE.Vector3(x, y, z));
      }
    }
  }
  return corners;
}

/**
 * Resolves the repaired document hierarchy once and transforms exact local geometry bounds into a
 * single admitted world AABB. This includes static instance candidates before they are GPU-batched.
 */
export function collectStudioBg3dShadowSceneBounds(
  entities: readonly StudioBg3dShadowSceneEntity[],
): StudioBg3dCollectedShadowBounds {
  const hierarchy = resolveStudioBg3dHierarchy(entities);
  const entityById = new Map(entities.map((entity) => [entity.id, entity] as const));
  const worldMin = new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const worldMax = new THREE.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  let includedEntityCount = 0;
  let rejectedEntityCount = 0;
  let clamped = false;

  const pending = hierarchy.roots.map((id) => ({
    id,
    parentWorld: new THREE.Matrix4(),
    ancestorsValid: true,
    ancestorsVisible: true,
  }));
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) break;
    const entity = entityById.get(entry.id);
    if (!entity) continue;
    const local = localMatrix(entity);
    const transformValid = entry.ancestorsValid && local !== null;
    const world = transformValid ? entry.parentWorld.clone().multiply(local) : null;
    const effectivelyVisible = entry.ancestorsVisible && entity.visible !== false;

    if (effectivelyVisible && entity.localBounds !== null) {
      if (!world || !finiteBounds(entity.localBounds)) {
        rejectedEntityCount += 1;
      } else {
        const admittedCorners: THREE.Vector3[] = [];
        let entityValid = true;
        for (const corner of boundsCorners(entity.localBounds)) {
          corner.applyMatrix4(world);
          if (![corner.x, corner.y, corner.z].every(Number.isFinite)) {
            entityValid = false;
            break;
          }
          for (const axis of ["x", "y", "z"] as const) {
            const admitted = THREE.MathUtils.clamp(
              corner[axis],
              -STUDIO_BG3D_SHADOW_MAX_WORLD_COORDINATE,
              STUDIO_BG3D_SHADOW_MAX_WORLD_COORDINATE,
            );
            if (admitted !== corner[axis]) clamped = true;
            corner[axis] = admitted;
          }
          admittedCorners.push(corner);
        }
        if (!entityValid) {
          rejectedEntityCount += 1;
        } else {
          for (const corner of admittedCorners) {
            worldMin.min(corner);
            worldMax.max(corner);
          }
          includedEntityCount += 1;
        }
      }
    }

    const children = hierarchy.childrenByParent.get(entity.id) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const childId = children[index];
      if (!childId) continue;
      pending.push({
        id: childId,
        parentWorld: world ?? entry.parentWorld,
        ancestorsValid: transformValid,
        ancestorsVisible: effectivelyVisible,
      });
    }
  }

  return Object.freeze({
    bounds: includedEntityCount > 0 ? freezeBounds(worldMin, worldMax) : null,
    includedEntityCount,
    rejectedEntityCount,
    clamped,
  });
}

function admittedMapSize(value: number): number {
  if (!Number.isFinite(value)) return 1_024;
  return Math.round(THREE.MathUtils.clamp(
    value,
    STUDIO_BG3D_SHADOW_MIN_MAP_SIZE,
    STUDIO_BG3D_SHADOW_MAX_MAP_SIZE,
  ));
}

function admittedFocus(value: StudioBg3dShadowVec3 | undefined): {
  readonly point: THREE.Vector3;
  readonly clamped: boolean;
} {
  if (value === undefined) return { point: new THREE.Vector3(), clamped: false };
  if (!finiteVec3(value)) return { point: new THREE.Vector3(), clamped: true };
  const point = new THREE.Vector3(...value);
  let clamped = false;
  for (const axis of ["x", "y", "z"] as const) {
    const admitted = THREE.MathUtils.clamp(
      point[axis],
      -STUDIO_BG3D_SHADOW_MAX_WORLD_COORDINATE,
      STUDIO_BG3D_SHADOW_MAX_WORLD_COORDINATE,
    );
    if (admitted !== point[axis]) clamped = true;
    point[axis] = admitted;
  }
  return { point, clamped };
}

function admittedDirection(value: StudioBg3dShadowVec3 | undefined): {
  readonly direction: THREE.Vector3;
  readonly clamped: boolean;
} {
  if (value === undefined) {
    return {
      direction: new THREE.Vector3(...STUDIO_BG3D_SHADOW_DEFAULT_DIRECTION).normalize(),
      clamped: false,
    };
  }
  const source = finiteVec3(value)
    ? new THREE.Vector3(...value)
    : new THREE.Vector3(...STUDIO_BG3D_SHADOW_DEFAULT_DIRECTION);
  if (source.lengthSq() <= 1e-12) {
    return {
      direction: new THREE.Vector3(...STUDIO_BG3D_SHADOW_DEFAULT_DIRECTION).normalize(),
      clamped: true,
    };
  }
  return { direction: source.normalize(), clamped: !finiteVec3(value) };
}

function admittedWorldBounds(bounds: StudioBg3dShadowBounds | null | undefined): {
  readonly bounds: StudioBg3dShadowBounds | null;
  readonly clamped: boolean;
} {
  if (!finiteBounds(bounds)) return { bounds: null, clamped: bounds !== null && bounds !== undefined };
  const min = new THREE.Vector3(...bounds.min);
  const max = new THREE.Vector3(...bounds.max);
  let clamped = false;
  for (const vector of [min, max]) {
    for (const axis of ["x", "y", "z"] as const) {
      const admitted = THREE.MathUtils.clamp(
        vector[axis],
        -STUDIO_BG3D_SHADOW_MAX_WORLD_COORDINATE,
        STUDIO_BG3D_SHADOW_MAX_WORLD_COORDINATE,
      );
      if (admitted !== vector[axis]) clamped = true;
      vector[axis] = admitted;
    }
  }
  return { bounds: freezeBounds(min, max), clamped };
}

function midpoint(minimum: number, maximum: number): number {
  return minimum / 2 + maximum / 2;
}

/**
 * Fits a directional-light orthographic camera to admitted scene/model bounds. The minimum 40 m
 * width preserves established small-scene texel density; only larger scenes expand. Absolute
 * light-space center snapping keeps the shadow projection stable under sub-texel object motion.
 */
export function fitStudioBg3dDirectionalShadowFrustum(input: {
  readonly bounds: StudioBg3dShadowBounds | null | undefined;
  readonly focus?: StudioBg3dShadowVec3;
  /** Unit vector from the lit subject toward the light (normalization is admission-safe). */
  readonly direction?: StudioBg3dShadowVec3;
  readonly mapSize: number;
  readonly groundY?: number;
  readonly boundsWereClamped?: boolean;
}): StudioBg3dDirectionalShadowFit {
  const mapSize = admittedMapSize(input.mapSize);
  const focusAdmission = admittedFocus(input.focus);
  const directionAdmission = admittedDirection(input.direction);
  const boundsAdmission = admittedWorldBounds(input.bounds);
  const sceneBounds = boundsAdmission.bounds;
  const source = sceneBounds ? "scene" : "fallback";
  let clamped = Boolean(input.boundsWereClamped) || boundsAdmission.clamped ||
    focusAdmission.clamped || directionAdmission.clamped || mapSize !== input.mapSize;

  const min = sceneBounds
    ? new THREE.Vector3(...sceneBounds.min).min(focusAdmission.point)
    : focusAdmission.point.clone();
  const max = sceneBounds
    ? new THREE.Vector3(...sceneBounds.max).max(focusAdmission.point)
    : focusAdmission.point.clone();
  const groundY = Number.isFinite(input.groundY)
    ? THREE.MathUtils.clamp(
        input.groundY!,
        -STUDIO_BG3D_SHADOW_MAX_WORLD_COORDINATE,
        STUDIO_BG3D_SHADOW_MAX_WORLD_COORDINATE,
      )
    : 0;
  if (!Number.isFinite(input.groundY ?? 0) || groundY !== (input.groundY ?? 0)) clamped = true;
  min.y = Math.min(min.y, groundY);
  max.y = Math.max(max.y, groundY);

  // Three's shadow camera looks down -Z. Use an explicitly orthogonal up vector so vertical light
  // directions never trigger the lookAt parallel-up degeneracy or unstable basis perturbations.
  const zAxis = directionAdmission.direction;
  const upSeed = Math.abs(zAxis.y) < 0.98
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);
  const xAxis = upSeed.clone().cross(zAxis).normalize();
  const yAxis = zAxis.clone().cross(xAxis).normalize();

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const corner of boundsCorners({
    min: [min.x, min.y, min.z],
    max: [max.x, max.y, max.z],
  })) {
    const x = corner.dot(xAxis);
    const y = corner.dot(yAxis);
    const z = corner.dot(zAxis);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
    if (zAxis.y > 1e-4 && corner.y > groundY) {
      const rawReceiverTravel = (corner.y - groundY) / zAxis.y;
      const receiverTravel = Math.min(
        STUDIO_BG3D_SHADOW_MAX_LIGHT_DISTANCE,
        rawReceiverTravel,
      );
      if (receiverTravel !== rawReceiverTravel) clamped = true;
      // A receiver hit travels exactly down -lightDirection, so its light-space X/Y is unchanged;
      // only the far depth plane needs to include the ground shadow footprint.
      minZ = Math.min(minZ, z - receiverTravel);
    }
  }

  const projectedCenterX = midpoint(minX, maxX);
  const projectedCenterY = midpoint(minY, maxY);
  const projectedCenterZ = midpoint(minZ, maxZ);
  const rawHalfExtent = Math.max((maxX - minX) / 2, (maxY - minY) / 2);
  const xyPadding = Math.max(
    STUDIO_BG3D_SHADOW_MIN_XY_PADDING,
    rawHalfExtent * 0.08,
  );
  let halfExtent = Math.max(
    STUDIO_BG3D_SHADOW_DEFAULT_HALF_EXTENT,
    rawHalfExtent + xyPadding,
  );
  if (halfExtent > STUDIO_BG3D_SHADOW_MAX_HALF_EXTENT) {
    halfExtent = STUDIO_BG3D_SHADOW_MAX_HALF_EXTENT;
    clamped = true;
  }

  let snappedCenterX: number;
  let snappedCenterY: number;
  let worldUnitsPerTexel: number;
  // Re-admit the padding after snapping. Three bounded iterations converge because halfExtent only
  // grows and each snap displacement is at most half a texel.
  for (let iteration = 0; iteration < 3; iteration += 1) {
    worldUnitsPerTexel = (halfExtent * 2) / mapSize;
    snappedCenterX = Math.round(projectedCenterX / worldUnitsPerTexel) * worldUnitsPerTexel;
    snappedCenterY = Math.round(projectedCenterY / worldUnitsPerTexel) * worldUnitsPerTexel;
    const required = Math.max(
      maxX - snappedCenterX,
      snappedCenterX - minX,
      maxY - snappedCenterY,
      snappedCenterY - minY,
    ) + xyPadding + worldUnitsPerTexel;
    if (required <= halfExtent) break;
    const admitted = Math.min(STUDIO_BG3D_SHADOW_MAX_HALF_EXTENT, required);
    if (admitted === halfExtent) {
      clamped = true;
      break;
    }
    halfExtent = admitted;
    if (required > admitted) clamped = true;
  }
  worldUnitsPerTexel = (halfExtent * 2) / mapSize;
  snappedCenterX = Math.round(projectedCenterX / worldUnitsPerTexel) * worldUnitsPerTexel;
  snappedCenterY = Math.round(projectedCenterY / worldUnitsPerTexel) * worldUnitsPerTexel;

  const target = xAxis.clone().multiplyScalar(snappedCenterX)
    .addScaledVector(yAxis, snappedCenterY)
    .addScaledVector(zAxis, projectedCenterZ);
  const rawHalfDepth = (maxZ - minZ) / 2;
  const depthPadding = Math.max(
    STUDIO_BG3D_SHADOW_MIN_DEPTH_PADDING,
    rawHalfDepth * 0.08,
    worldUnitsPerTexel * 4,
  );
  let lightDistance = Math.max(
    STUDIO_BG3D_SHADOW_DEFAULT_LIGHT_DISTANCE,
    rawHalfDepth + depthPadding + 1,
  );
  if (lightDistance > STUDIO_BG3D_SHADOW_MAX_LIGHT_DISTANCE) {
    lightDistance = STUDIO_BG3D_SHADOW_MAX_LIGHT_DISTANCE;
    clamped = true;
  }
  const near = Math.max(
    STUDIO_BG3D_SHADOW_MIN_NEAR,
    lightDistance - rawHalfDepth - depthPadding,
  );
  let far = Math.max(near + 1, lightDistance + rawHalfDepth + depthPadding);
  if (far > STUDIO_BG3D_SHADOW_MAX_FAR) {
    far = STUDIO_BG3D_SHADOW_MAX_FAR;
    clamped = true;
  }
  const position = target.clone().addScaledVector(zAxis, lightDistance);

  const values = [
    ...position.toArray(),
    ...target.toArray(),
    ...yAxis.toArray(),
    halfExtent,
    near,
    far,
    worldUnitsPerTexel,
  ];
  if (values.some((value) => !Number.isFinite(value)) || near >= far) {
    // The admission branches above should make this unreachable. Keep a final warning-free result
    // for future callers that bypass TypeScript with hostile persisted data.
    return Object.freeze({
      position: Object.freeze([0, STUDIO_BG3D_SHADOW_DEFAULT_LIGHT_DISTANCE, 0] as const),
      target: Object.freeze([0, 0, 0] as const),
      cameraUp: Object.freeze([0, 0, 1] as const),
      left: -STUDIO_BG3D_SHADOW_DEFAULT_HALF_EXTENT,
      right: STUDIO_BG3D_SHADOW_DEFAULT_HALF_EXTENT,
      top: STUDIO_BG3D_SHADOW_DEFAULT_HALF_EXTENT,
      bottom: -STUDIO_BG3D_SHADOW_DEFAULT_HALF_EXTENT,
      near: STUDIO_BG3D_SHADOW_MIN_NEAR,
      far: 80,
      bias: -0.0002,
      normalBias: 0.025,
      mapSize,
      worldUnitsPerTexel: (STUDIO_BG3D_SHADOW_DEFAULT_HALF_EXTENT * 2) / mapSize,
      source: "fallback",
      clamped: true,
    });
  }

  return Object.freeze({
    position: Object.freeze(position.toArray() as [number, number, number]),
    target: Object.freeze(target.toArray() as [number, number, number]),
    cameraUp: Object.freeze(yAxis.toArray() as [number, number, number]),
    left: -halfExtent,
    right: halfExtent,
    top: halfExtent,
    bottom: -halfExtent,
    near,
    far,
    bias: -0.0002,
    normalBias: Math.min(
      0.5,
      0.025 * (halfExtent / STUDIO_BG3D_SHADOW_DEFAULT_HALF_EXTENT),
    ),
    mapSize,
    worldUnitsPerTexel,
    source,
    clamped,
  });
}
