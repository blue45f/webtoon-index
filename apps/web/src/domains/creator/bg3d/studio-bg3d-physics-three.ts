import * as THREE from "three";

import {
  createStudioBg3dPhysicsDefaultCollider,
  normalizeStudioBg3dPhysicsWorld,
  type StudioBg3dCollider,
  type StudioBg3dPhysicsTransformSample,
  type StudioBg3dPhysicsWorld,
} from "./studio-bg3d-physics";
import {
  calculateStudioBg3dThreeWorldMatrix,
  decomposeStudioBg3dThreeLocalMatrix,
} from "./studio-bg3d-three-hierarchy";

import type {
  StudioBg3dSceneDocument,
  StudioBg3dVec3,
} from "./studio-bg3d-scene-document";

const MAX_WORLD_COORDINATE = 10_000;
const MIN_COLLIDER_HALF_EXTENT = 0.001;

/**
 * Marks the retained WebXR content root whose direct children still use canonical BG3D world
 * coordinates. Arbitrary groups stay ineligible so a document child cannot accidentally receive
 * a world-space physics sample as a local transform.
 */
export const STUDIO_BG3D_PHYSICS_PROJECTION_ROOT_USER_DATA_KEY =
  "studioBg3dPhysicsProjectionRoot";

export interface StudioBg3dPhysicsModelLocalBounds {
  readonly center: StudioBg3dVec3;
  readonly halfExtents: StudioBg3dVec3;
}

export interface StudioBg3dPhysicsThreeJob {
  readonly world: StudioBg3dPhysicsWorld;
  readonly initialPoses: readonly StudioBg3dPhysicsTransformSample[];
}

/**
 * Measures the same auto-fitted cache root that is cloned into the viewport. The result remains in
 * the authored node's local space, including a GLB scene root's own position/rotation/scale.
 */
export function measureStudioBg3dPhysicsModelLocalBounds(
  root: THREE.Object3D,
): StudioBg3dPhysicsModelLocalBounds | null {
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return null;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const values = [center.x, center.y, center.z, size.x, size.y, size.z];
  if (
    values.some((component) => !Number.isFinite(component)) ||
    Math.max(size.x, size.y, size.z) <= 0
  ) return null;
  const halfExtents = [size.x / 2, size.y / 2, size.z / 2] as StudioBg3dVec3;
  return Object.freeze({
    center: Object.freeze([center.x, center.y, center.z] as const),
    halfExtents: Object.freeze(halfExtents),
  });
}

function createStudioBg3dModelBoundsCollider(
  bounds: StudioBg3dPhysicsModelLocalBounds,
  effectiveScale: StudioBg3dVec3,
): StudioBg3dCollider | null {
  const halfExtents = bounds.halfExtents.map(
    (component, index) => Math.max(
      MIN_COLLIDER_HALF_EXTENT,
      component * effectiveScale[index],
    ),
  );
  const center = bounds.center.map(
    (component, index) => component * effectiveScale[index],
  );
  if (
    halfExtents.some((component) =>
      !Number.isFinite(component) || component < MIN_COLLIDER_HALF_EXTENT ||
      component > MAX_WORLD_COORDINATE
    ) ||
    center.some((component) =>
      !Number.isFinite(component) || Math.abs(component) > MAX_WORLD_COORDINATE
    )
  ) return null;
  return Object.freeze({
    kind: "box",
    halfExtents: Object.freeze(halfExtents) as readonly [number, number, number],
    center: Object.freeze(center) as StudioBg3dVec3,
  });
}

/**
 * Resolves collider dimensions and poses from the same hierarchy world matrix. This preserves
 * inherited scale for nested static colliders and rejects shear that a rigid Rapier body cannot
 * represent without silently diverging from the rendered scene.
 */
export function createStudioBg3dPhysicsThreeJob(
  document: StudioBg3dSceneDocument,
  localWorld: StudioBg3dPhysicsWorld,
  modelLocalBoundsByNodeId: ReadonlyMap<string, StudioBg3dPhysicsModelLocalBounds> = new Map(),
): StudioBg3dPhysicsThreeJob | null {
  const normalizedLocalWorld = normalizeStudioBg3dPhysicsWorld(localWorld, document);
  if (!normalizedLocalWorld) return null;
  const nodeById = new Map(document.nodes.map((node) => [node.id, node] as const));
  const hierarchyEntities = document.nodes.map((node) => ({
    id: node.id,
    parentId: node.parentId,
    position: node.transform.position,
    rotation: node.transform.rotation,
    scale: node.transform.scale,
  }));
  const bodies = normalizedLocalWorld.bodies.map((body) => {
    const node = nodeById.get(body.nodeId);
    if (!node) return null;
    const worldMatrix = calculateStudioBg3dThreeWorldMatrix(
      hierarchyEntities,
      body.nodeId,
    );
    if (!worldMatrix) return null;
    const decomposed = decomposeStudioBg3dThreeLocalMatrix(worldMatrix);
    if (!decomposed) return null;
    const effectiveScale: StudioBg3dVec3 = [
      Math.abs(decomposed.scale[0]),
      Math.abs(decomposed.scale[1]),
      Math.abs(decomposed.scale[2]),
    ];
    if (effectiveScale.some((component) => !Number.isFinite(component) || component <= 1e-8)) {
      return null;
    }
    const modelBounds = node.kind === "model"
      ? modelLocalBoundsByNodeId.get(node.id)
      : undefined;
    const collider = node.kind === "model"
      ? modelBounds
        ? createStudioBg3dModelBoundsCollider(modelBounds, effectiveScale)
        : null
      : createStudioBg3dPhysicsDefaultCollider(node, effectiveScale);
    if (!collider) return null;
    return {
      ...body,
      collider,
    };
  });
  if (bodies.some((body) => body === null)) return null;
  const world = normalizeStudioBg3dPhysicsWorld({
    ...normalizedLocalWorld,
    bodies,
  }, document);
  if (!world) return null;
  const initialPoses = createStudioBg3dPhysicsInitialPoses(document, world);
  if (!initialPoses) return null;
  return Object.freeze({ world, initialPoses });
}

/**
 * Builds immutable world-space poses in physics-body order. SceneDocument transforms are local to
 * their parent, whereas a rigid-body backend expects one world transform per body.
 */
export function createStudioBg3dPhysicsInitialPoses(
  document: Pick<StudioBg3dSceneDocument, "nodes">,
  world: StudioBg3dPhysicsWorld,
): readonly StudioBg3dPhysicsTransformSample[] | null {
  const normalizedWorld = normalizeStudioBg3dPhysicsWorld(world, document);
  if (!normalizedWorld) return null;
  const hierarchyEntities = document.nodes.map((node) => ({
    id: node.id,
    parentId: node.parentId,
    position: node.transform.position,
    rotation: node.transform.rotation,
    scale: node.transform.scale,
  }));
  const samples: StudioBg3dPhysicsTransformSample[] = [];
  for (const body of normalizedWorld.bodies) {
    const matrix = calculateStudioBg3dThreeWorldMatrix(hierarchyEntities, body.nodeId);
    if (!matrix) return null;
    const decomposed = decomposeStudioBg3dThreeLocalMatrix(matrix);
    if (!decomposed) return null;
    const rotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...decomposed.rotation, "XYZ"),
    );
    const [x, y, z] = decomposed.position;
    if (
      [x, y, z, rotation.x, rotation.y, rotation.z, rotation.w]
        .some((component) => !Number.isFinite(component)) ||
      Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > MAX_WORLD_COORDINATE ||
      rotation.lengthSq() < 1e-12
    ) return null;
    rotation.normalize();
    samples.push(Object.freeze({
      nodeId: body.nodeId,
      position: Object.freeze([x, y, z] as const),
      rotation: Object.freeze([rotation.x, rotation.y, rotation.z, rotation.w] as const),
    }));
  }
  return Object.freeze(samples);
}

/** Applies an already validated transient sample set without mutating canonical React state. */
export function projectStudioBg3dPhysicsSamples(
  samples: readonly StudioBg3dPhysicsTransformSample[],
  objects: ReadonlyMap<string, THREE.Object3D>,
): boolean {
  const seen = new Set<string>();
  for (const sample of samples) {
    if (seen.has(sample.nodeId)) return false;
    const object = objects.get(sample.nodeId);
    const parent = object?.parent;
    if (
      !object || !parent || (
        parent.type !== "Scene" &&
        parent.userData[STUDIO_BG3D_PHYSICS_PROJECTION_ROOT_USER_DATA_KEY] !== true
      )
    ) {
      // Dynamic bodies are document-root-only. Rejecting every unmarked parent prevents a
      // transient world transform from being interpreted as a local transform after reparenting.
      return false;
    }
    const [x, y, z] = sample.position;
    const [qx, qy, qz, qw] = sample.rotation;
    if (
      [x, y, z, qx, qy, qz, qw].some((component) => !Number.isFinite(component)) ||
      Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > MAX_WORLD_COORDINATE
    ) return false;
    const rotationLength = Math.hypot(qx, qy, qz, qw);
    if (!Number.isFinite(rotationLength) || rotationLength < 1e-8) return false;
    seen.add(sample.nodeId);
  }
  for (const sample of samples) {
    const object = objects.get(sample.nodeId)!;
    object.position.set(...sample.position);
    object.quaternion.set(...sample.rotation).normalize();
    object.updateMatrix();
    object.updateWorldMatrix(false, true);
  }
  return true;
}
