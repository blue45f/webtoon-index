import * as THREE from "three";

export interface StudioBg3dThreeInstancePlacement {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
}

export type StudioBg3dThreeInstancingFailureCode =
  | "invalid-source"
  | "invalid-placements"
  | "unsupported-renderable"
  | "skinned-or-morphed"
  | "transparent-or-custom-material"
  | "empty-source";

export interface StudioBg3dThreeInstancingFailure {
  readonly ok: false;
  readonly code: StudioBg3dThreeInstancingFailureCode;
}

export interface StudioBg3dThreeInstancingSuccess {
  readonly ok: true;
  readonly root: THREE.Group;
  readonly meshes: readonly THREE.InstancedMesh[];
  readonly instanceIds: readonly string[];
  readonly sourceDrawCalls: number;
  readonly batchedDrawCalls: number;
  readonly avoidedDrawCalls: number;
  resolveInstanceId(instanceId: number | undefined): string | null;
  dispose(): void;
}

export type StudioBg3dThreeInstancingResult =
  | StudioBg3dThreeInstancingSuccess
  | StudioBg3dThreeInstancingFailure;

const MAX_BATCH_INSTANCES = 1_024;
const MAX_WORLD_COORDINATE = 10_000;
const MAX_SCALE = 1_000;
const MIN_SCALE = 0.001;
const MIN_SOURCE_MATRIX_DETERMINANT = 1e-12;
const SOURCE_MATRIX_EPSILON = 1e-7;

function failure(code: StudioBg3dThreeInstancingFailureCode): StudioBg3dThreeInstancingFailure {
  return Object.freeze({ ok: false, code });
}

function isVisibleInSourceHierarchy(object: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false;
    if (current === root) return true;
  }
  return false;
}

function materialSupported(material: THREE.Material): boolean {
  const custom = material as THREE.Material & {
    readonly isShaderMaterial?: boolean;
    readonly isRawShaderMaterial?: boolean;
  };
  return !material.transparent && !custom.isShaderMaterial && !custom.isRawShaderMaterial &&
    material.onBeforeCompile === THREE.Material.prototype.onBeforeCompile;
}

function validPlacement(placement: StudioBg3dThreeInstancePlacement): boolean {
  return Boolean(
    placement && typeof placement.id === "string" && placement.id && placement.id.length <= 80 &&
    Array.isArray(placement.position) && placement.position.length === 3 &&
    Array.isArray(placement.rotation) && placement.rotation.length === 3 &&
    Array.isArray(placement.scale) && placement.scale.length === 3 &&
    placement.position.every((value) =>
      Number.isFinite(value) && Math.abs(value) <= MAX_WORLD_COORDINATE
    ) &&
    placement.rotation.every((value) => Number.isFinite(value) && Math.abs(value) <= Math.PI) &&
    placement.scale.every((value) =>
      Number.isFinite(value) && value >= MIN_SCALE && value <= MAX_SCALE
    ),
  );
}

function sourceMatrixIsSupported(matrix: THREE.Matrix4): boolean {
  if (!matrix.elements.every((value) => Number.isFinite(value))) return false;
  const determinant = matrix.determinant();
  if (!Number.isFinite(determinant) || determinant <= MIN_SOURCE_MATRIX_DETERMINANT) return false;
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, rotation, scale);
  const recomposed = new THREE.Matrix4().compose(position, rotation, scale);
  return matrix.elements.every((value, index) => {
    const expected = recomposed.elements[index]!;
    return Math.abs(value - expected) <= SOURCE_MATRIX_EPSILON * Math.max(1, Math.abs(value));
  });
}

function renderPassCount(mesh: THREE.Mesh): number {
  const material = mesh.material;
  if (!Array.isArray(material)) return material.visible ? 1 : 0;
  const materials = material;
  return mesh.geometry.groups.reduce((count, group) => {
    const materialIndex = group.materialIndex ?? 0;
    return count + (materials[materialIndex]?.visible ? 1 : 0);
  }, 0);
}

/**
 * Builds one InstancedMesh per source mesh. Geometry/material/texture ownership stays with the
 * verified model cache; the result owns only its instance buffers and scene nodes.
 */
export function createStudioBg3dThreeStaticInstanceBatch(
  sourceRoot: THREE.Object3D,
  placements: readonly StudioBg3dThreeInstancePlacement[],
): StudioBg3dThreeInstancingResult {
  if (!sourceRoot?.isObject3D || sourceRoot.parent) return failure("invalid-source");
  if (
    !Array.isArray(placements) || placements.length < 2 ||
    placements.length > MAX_BATCH_INSTANCES || placements.some((placement) => !validPlacement(placement)) ||
    new Set(placements.map((placement) => placement.id)).size !== placements.length
  ) return failure("invalid-placements");

  sourceRoot.updateWorldMatrix(true, true);
  const sourceMeshes: THREE.Mesh[] = [];
  let unsupportedCode: StudioBg3dThreeInstancingFailureCode | null = null;
  sourceRoot.traverse((object) => {
    if (unsupportedCode || !isVisibleInSourceHierarchy(object, sourceRoot)) return;
    if (
      (object as THREE.Light).isLight || (object as THREE.Camera).isCamera ||
      (object as THREE.Line).isLine || (object as THREE.Points).isPoints ||
      (object as THREE.Sprite).isSprite || (object as THREE.LOD).isLOD
    ) {
      unsupportedCode = "unsupported-renderable";
      return;
    }
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (
      (mesh as THREE.SkinnedMesh).isSkinnedMesh ||
      Array.isArray(mesh.morphTargetInfluences) && mesh.morphTargetInfluences.length > 0 ||
      Object.values(mesh.geometry?.morphAttributes ?? {}).some((attributes) => attributes.length > 0)
    ) {
      unsupportedCode = "skinned-or-morphed";
      return;
    }
    if (
      (mesh as THREE.InstancedMesh).isInstancedMesh ||
      (mesh as THREE.Mesh & { readonly isBatchedMesh?: boolean }).isBatchedMesh ||
      mesh.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender ||
      mesh.onAfterRender !== THREE.Object3D.prototype.onAfterRender
    ) {
      unsupportedCode = "unsupported-renderable";
      return;
    }
    if (!(mesh.geometry instanceof THREE.BufferGeometry)) {
      unsupportedCode = "unsupported-renderable";
      return;
    }
    if (!sourceMatrixIsSupported(mesh.matrixWorld)) {
      unsupportedCode = "unsupported-renderable";
      return;
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!materials.length || materials.some((material) => !materialSupported(material))) {
      unsupportedCode = "transparent-or-custom-material";
      return;
    }
    sourceMeshes.push(mesh);
  });
  if (unsupportedCode) return failure(unsupportedCode);
  if (!sourceMeshes.length) return failure("empty-source");

  const root = new THREE.Group();
  root.name = "ToonSpectrumStaticInstanceBatch";
  const meshes: THREE.InstancedMesh[] = [];
  const placementMatrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (const sourceMesh of sourceMeshes) {
    const mesh = new THREE.InstancedMesh(
      sourceMesh.geometry,
      sourceMesh.material,
      placements.length,
    );
    mesh.name = sourceMesh.name ? `${sourceMesh.name}:instances` : "StaticMeshInstances";
    mesh.castShadow = sourceMesh.castShadow;
    mesh.receiveShadow = sourceMesh.receiveShadow;
    mesh.renderOrder = sourceMesh.renderOrder;
    mesh.layers.mask = sourceMesh.layers.mask;
    mesh.frustumCulled = sourceMesh.frustumCulled;
    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index]!;
      placementMatrix.compose(
        position.set(placement.position[0], placement.position[1], placement.position[2]),
        rotation.setFromEuler(new THREE.Euler(
          placement.rotation[0],
          placement.rotation[1],
          placement.rotation[2],
          "XYZ",
        )),
        scale.set(placement.scale[0], placement.scale[1], placement.scale[2]),
      );
      mesh.setMatrixAt(index, placementMatrix.clone().multiply(sourceMesh.matrixWorld));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    meshes.push(mesh);
    root.add(mesh);
  }
  root.matrixAutoUpdate = false;
  root.updateMatrix();
  const instanceIds = Object.freeze(placements.map((placement) => placement.id));
  let disposed = false;
  const batchedDrawCalls = sourceMeshes.reduce((total, mesh) => total + renderPassCount(mesh), 0);
  const sourceDrawCalls = batchedDrawCalls * placements.length;
  return Object.freeze({
    ok: true,
    root,
    meshes: Object.freeze(meshes),
    instanceIds,
    sourceDrawCalls,
    batchedDrawCalls,
    avoidedDrawCalls: sourceDrawCalls - batchedDrawCalls,
    resolveInstanceId(instanceId: number | undefined) {
      return Number.isSafeInteger(instanceId) && instanceId! >= 0
        ? instanceIds[instanceId!] ?? null
        : null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of meshes) mesh.dispose();
      root.clear();
    },
  });
}
