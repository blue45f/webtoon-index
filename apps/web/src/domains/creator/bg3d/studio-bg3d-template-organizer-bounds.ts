import * as THREE from "three";

import type { StudioBg3dTemplateWorldBounds } from "./studio-bg3d-template-organizer-plans";

type StudioBg3dTemplateTransformTuple = readonly [number, number, number];

export interface StudioBg3dTemplateStaticModelTransform {
  readonly position: StudioBg3dTemplateTransformTuple;
  readonly rotation: StudioBg3dTemplateTransformTuple;
  readonly scale: StudioBg3dTemplateTransformTuple;
}

function finiteTuple(value: StudioBg3dTemplateTransformTuple): boolean {
  return value.length === 3 && value.every(Number.isFinite);
}

function readSourceLocalMatrix(object: THREE.Object3D): THREE.Matrix4 | null {
  const matrix = object.matrixAutoUpdate
    ? new THREE.Matrix4().compose(object.position, object.quaternion, object.scale)
    : object.matrix.clone();
  return matrix.elements.every(Number.isFinite) ? matrix : null;
}

function readSourceWorldMatrix(
  object: THREE.Object3D,
  parentWorldMatrix: THREE.Matrix4 | null,
): THREE.Matrix4 | null {
  // `updateWorldMatrix()` intentionally is not used here: the verified root is shared by every
  // instance, so an organizer measurement must remain a read-only operation on that cache entry.
  if (!object.matrixWorldAutoUpdate) {
    const matrixWorld = object.matrixWorld.clone();
    return matrixWorld.elements.every(Number.isFinite) ? matrixWorld : null;
  }
  const localMatrix = readSourceLocalMatrix(object);
  if (!localMatrix) return null;
  const matrixWorld = parentWorldMatrix
    ? parentWorldMatrix.clone().multiply(localMatrix)
    : localMatrix;
  return matrixWorld.elements.every(Number.isFinite) ? matrixWorld : null;
}

function expandBySourceGeometry(
  bounds: THREE.Box3,
  object: THREE.Object3D,
  sourceWorldMatrix: THREE.Matrix4,
  instanceMatrix: THREE.Matrix4,
): boolean {
  const renderable = object as THREE.Object3D & {
    readonly geometry?: THREE.BufferGeometry;
    readonly isInstancedMesh?: boolean;
  };
  const geometry = renderable.geometry;
  if (geometry === undefined) return true;
  if (!geometry.isBufferGeometry || renderable.isInstancedMesh === true) return false;
  const positions = geometry.getAttribute("position");
  if (!positions) return false;

  // This is the same transform order used by a rendered wrapper and by the static instance batch:
  // instance * source-world * vertex. Applying the instance matrix to a source *AABB* instead would
  // rotate an already axis-aligned box and make grounding visibly float for rotated source nodes.
  const worldMatrix = instanceMatrix.clone().multiply(sourceWorldMatrix);
  if (!worldMatrix.elements.every(Number.isFinite)) return false;
  const point = new THREE.Vector3();
  const mesh = object as THREE.Mesh;
  for (let index = 0; index < positions.count; index += 1) {
    if (mesh.isMesh) mesh.getVertexPosition(index, point);
    else point.fromBufferAttribute(positions, index);
    point.applyMatrix4(worldMatrix);
    if (!point.toArray().every(Number.isFinite)) return false;
    bounds.expandByPoint(point);
  }
  return true;
}

/**
 * Measures a static custom-model instance without requiring an individually rendered scene node.
 * GPU-batched models intentionally have no `primitiveObjectsRef` entry, but their verified cache
 * root and document transform still provide the same conservative world AABB used by a batch.
 */
export function readStudioBg3dTemplateStaticModelWorldBounds(
  sourceRoot: THREE.Object3D | null | undefined,
  transform: StudioBg3dTemplateStaticModelTransform,
): StudioBg3dTemplateWorldBounds | null {
  if (
    !sourceRoot?.isObject3D ||
    sourceRoot.parent !== null ||
    !finiteTuple(transform.position) ||
    !finiteTuple(transform.rotation) ||
    !finiteTuple(transform.scale) ||
    transform.scale.some((component) => component <= 0)
  ) return null;

  const instanceMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...transform.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...transform.rotation, "XYZ")),
    new THREE.Vector3(...transform.scale),
  );
  if (!instanceMatrix.elements.every(Number.isFinite)) return null;

  const bounds = new THREE.Box3();
  const visit = (
    object: THREE.Object3D,
    parentWorldMatrix: THREE.Matrix4 | null,
  ): boolean => {
    const sourceWorldMatrix = readSourceWorldMatrix(object, parentWorldMatrix);
    if (!sourceWorldMatrix) return false;
    if (!expandBySourceGeometry(bounds, object, sourceWorldMatrix, instanceMatrix)) return false;
    return object.children.every((child) => visit(child, sourceWorldMatrix));
  };
  if (!visit(sourceRoot, null) || bounds.isEmpty()) return null;
  const min = bounds.min.toArray() as [number, number, number];
  const max = bounds.max.toArray() as [number, number, number];
  if (!min.every(Number.isFinite) || !max.every(Number.isFinite)) return null;
  return Object.freeze({
    min: Object.freeze(min),
    max: Object.freeze(max),
  });
}
