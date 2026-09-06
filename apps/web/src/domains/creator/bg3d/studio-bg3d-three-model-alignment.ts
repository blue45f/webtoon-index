import * as THREE from "three";

import {
  centerAndGroundWorldBoundsPosition,
  type Bg3dMutableVec3,
  type Bg3dVec3,
} from "./studio-bg3d-object-ops";

/**
 * Measure a rendered Three.js subtree and resolve the parent-local position that centers its world
 * bounds on target X/Z while placing the lowest vertex on target Y. The object transform itself is
 * not changed; callers can publish the returned tuple through their normal state/history boundary.
 */
export function resolveStudioBg3dThreeCenterGroundLocalPosition(
  object: THREE.Object3D,
  target: Bg3dVec3 = [0, 0, 0]
): Bg3dMutableVec3 | null {
  object.updateWorldMatrix(true, true);
  // A one-shot editor command can afford precise vertex bounds. This also avoids inheriting stale
  // or overly broad cached geometry boxes from imported authoring tools.
  const bounds = new THREE.Box3().setFromObject(object, true);
  if (bounds.isEmpty()) return null;

  const worldPosition = object.getWorldPosition(new THREE.Vector3());
  const nextWorldPosition = centerAndGroundWorldBoundsPosition(
    [worldPosition.x, worldPosition.y, worldPosition.z],
    {
      min: [bounds.min.x, bounds.min.y, bounds.min.z],
      max: [bounds.max.x, bounds.max.y, bounds.max.z],
    },
    target
  );
  if (!nextWorldPosition) return null;

  object.parent?.updateWorldMatrix(true, false);
  const nextLocalPosition = new THREE.Vector3(...nextWorldPosition);
  if (object.parent) object.parent.worldToLocal(nextLocalPosition);
  const result: Bg3dMutableVec3 = [
    nextLocalPosition.x,
    nextLocalPosition.y,
    nextLocalPosition.z,
  ];
  return result.every(Number.isFinite) ? result : null;
}
