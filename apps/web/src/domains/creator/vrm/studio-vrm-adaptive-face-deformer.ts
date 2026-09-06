import * as THREE from "three";

import type {
  AvatarForgeSemanticFaceMorphId,
  AvatarForgeSemanticFaceMorphState,
} from "./studio-vrm-avatar-forge";
import type { VRM } from "@pixiv/three-vrm";

export type StudioVrmAdaptiveFaceMeshRole = "skin" | "eye" | "iris" | "ear";

export type StudioVrmAdaptiveFaceCapability = Readonly<{
  id: AvatarForgeSemanticFaceMorphId;
  meshCount: number;
  roles: readonly StudioVrmAdaptiveFaceMeshRole[];
}>;

export type StudioVrmAdaptiveFaceProfile = Readonly<{
  status: "ready" | "unavailable";
  capabilities: readonly StudioVrmAdaptiveFaceCapability[];
  meshCount: number;
  message: string;
}>;

type FaceMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;

type MeshBinding = Readonly<{
  mesh: FaceMesh;
  role: StudioVrmAdaptiveFaceMeshRole;
  basis: FaceBasis;
}>;

type FaceBasis = Readonly<{
  right: THREE.Vector3;
  up: THREE.Vector3;
  forward: THREE.Vector3;
  leftEye: THREE.Vector3;
  rightEye: THREE.Vector3;
  eyeMid: THREE.Vector3;
  nose: THREE.Vector3;
  mouth: THREE.Vector3;
  leftEar: THREE.Vector3;
  rightEar: THREE.Vector3;
  unit: number;
}>;

const FACE_CONTROL_IDS: readonly AvatarForgeSemanticFaceMorphId[] = Object.freeze([
  "eyeSize",
  "eyeSpacing",
  "eyeTilt",
  "irisSize",
  "noseHeight",
  "noseWidth",
  "mouthWidth",
  "lipFullness",
  "earSize",
]);

const SKIN_CONTROLS = new Set<AvatarForgeSemanticFaceMorphId>([
  "eyeSize",
  "eyeSpacing",
  "eyeTilt",
  "noseHeight",
  "noseWidth",
  "mouthWidth",
  "lipFullness",
  "earSize",
]);

function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function materialNames(mesh: FaceMesh): string[] {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials
    .map((material) => material?.name ?? "")
    .filter(Boolean);
}

function meshRole(mesh: FaceMesh): StudioVrmAdaptiveFaceMeshRole | null {
  const names = normalizeName([mesh.name, ...materialNames(mesh)].join(" "));
  if (/(hair|bang|fringe|brow|lash|cloth|dress|shirt|jacket|accessory|weapon)/u.test(names)) {
    return null;
  }
  if (/(iris|pupil|hitomi|doukou)/u.test(names)) return "iris";
  if (/(eye|eyeball|whiteeye|sclera)/u.test(names)) return "eye";
  if (/(ear|ears|mimi)/u.test(names)) return "ear";
  if (/(face|head|skin|body|avatar|base)/u.test(names)) return "skin";
  return null;
}

function isFaceMesh(object: THREE.Object3D): object is FaceMesh {
  const mesh = object as FaceMesh;
  const position = mesh.geometry?.getAttribute?.("position");
  return Boolean(mesh.isMesh && position && position.itemSize >= 3 && position.count >= 12);
}

function averageScale(object: THREE.Object3D): number {
  const scale = object.getWorldScale(new THREE.Vector3());
  return Math.max(1e-5, (Math.abs(scale.x) + Math.abs(scale.y) + Math.abs(scale.z)) / 3);
}

function transformDirectionToLocal(mesh: FaceMesh, direction: THREE.Vector3): THREE.Vector3 {
  const inverse = mesh.matrixWorld.clone().invert();
  return direction.clone().transformDirection(inverse).normalize();
}

function worldPointToLocal(mesh: FaceMesh, point: THREE.Vector3): THREE.Vector3 {
  return mesh.worldToLocal(point.clone());
}

function createWorldLandmarks(vrm: VRM): Readonly<{
  head: THREE.Object3D;
  leftEye: THREE.Vector3;
  rightEye: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  forward: THREE.Vector3;
  unit: number;
}> | null {
  const head = vrm.humanoid?.getNormalizedBoneNode?.("head")
    ?? vrm.humanoid?.getRawBoneNode?.("head")
    ?? null;
  if (!head) return null;
  vrm.scene.updateMatrixWorld(true);
  head.updateWorldMatrix(true, true);

  const headPosition = head.getWorldPosition(new THREE.Vector3());
  const headQuaternion = head.getWorldQuaternion(new THREE.Quaternion());
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(headQuaternion).normalize();
  const headRight = new THREE.Vector3(1, 0, 0).applyQuaternion(headQuaternion).normalize();
  const headForward = new THREE.Vector3(0, 0, 1).applyQuaternion(headQuaternion).normalize();
  const leftEyeNode = vrm.humanoid?.getNormalizedBoneNode?.("leftEye")
    ?? vrm.humanoid?.getRawBoneNode?.("leftEye")
    ?? null;
  const rightEyeNode = vrm.humanoid?.getNormalizedBoneNode?.("rightEye")
    ?? vrm.humanoid?.getRawBoneNode?.("rightEye")
    ?? null;

  const sceneHeight = Math.max(
    0.5,
    new THREE.Box3().setFromObject(vrm.scene).getSize(new THREE.Vector3()).y,
  );
  const fallbackUnit = sceneHeight * 0.034;
  const fallbackEyeMid = headPosition.clone()
    .addScaledVector(up, fallbackUnit * 1.08)
    .addScaledVector(headForward, fallbackUnit * 0.22);
  const leftEye = leftEyeNode
    ? leftEyeNode.getWorldPosition(new THREE.Vector3())
    : fallbackEyeMid.clone().addScaledVector(headRight, -fallbackUnit * 0.55);
  const rightEye = rightEyeNode
    ? rightEyeNode.getWorldPosition(new THREE.Vector3())
    : fallbackEyeMid.clone().addScaledVector(headRight, fallbackUnit * 0.55);
  const eyeVector = rightEye.clone().sub(leftEye);
  const unit = Math.max(fallbackUnit * 0.6, eyeVector.length());
  const right = eyeVector.lengthSq() > 1e-8 ? eyeVector.normalize() : headRight;
  const forward = right.clone().cross(up);
  if (forward.lengthSq() < 1e-8) forward.copy(headForward);
  else forward.normalize();
  if (forward.dot(headForward) < 0) forward.negate();

  return { head, leftEye, rightEye, right, up, forward, unit };
}

function basisFromBoundingBox(
  mesh: FaceMesh,
  role: StudioVrmAdaptiveFaceMeshRole,
  world: ReturnType<typeof createWorldLandmarks>,
): FaceBasis | null {
  const position = mesh.geometry.getAttribute("position");
  if (!position) return null;
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  if (!box) return null;
  const size = box.getSize(new THREE.Vector3());
  if (![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value >= 0)) return null;

  mesh.updateWorldMatrix(true, false);
  if (world) {
    const leftEye = worldPointToLocal(mesh, world.leftEye);
    const rightEye = worldPointToLocal(mesh, world.rightEye);
    const right = transformDirectionToLocal(mesh, world.right);
    const up = transformDirectionToLocal(mesh, world.up);
    const forward = transformDirectionToLocal(mesh, world.forward);
    const eyeMid = leftEye.clone().add(rightEye).multiplyScalar(0.5);
    const measuredUnit = leftEye.distanceTo(rightEye);
    const fallbackUnit = world.unit / averageScale(mesh);
    const unit = Math.max(1e-5, measuredUnit > 1e-5 ? measuredUnit : fallbackUnit);
    return {
      right,
      up,
      forward,
      leftEye,
      rightEye,
      eyeMid,
      nose: eyeMid.clone().addScaledVector(up, -0.52 * unit).addScaledVector(forward, 0.1 * unit),
      mouth: eyeMid.clone().addScaledVector(up, -1.08 * unit).addScaledVector(forward, 0.06 * unit),
      leftEar: eyeMid.clone().addScaledVector(right, -1.26 * unit).addScaledVector(up, -0.1 * unit),
      rightEar: eyeMid.clone().addScaledVector(right, 1.26 * unit).addScaledVector(up, -0.1 * unit),
      unit,
    };
  }

  if (role !== "skin" && role !== "eye" && role !== "iris" && role !== "ear") return null;
  const center = box.getCenter(new THREE.Vector3());
  const unit = Math.max(1e-5, size.x * 0.36);
  const right = new THREE.Vector3(1, 0, 0);
  const up = new THREE.Vector3(0, 1, 0);
  const forward = new THREE.Vector3(0, 0, 1);
  const eyeMid = center.clone().addScaledVector(up, size.y * 0.12).setZ(box.max.z);
  const leftEye = eyeMid.clone().addScaledVector(right, -unit * 0.5);
  const rightEye = eyeMid.clone().addScaledVector(right, unit * 0.5);
  return {
    right,
    up,
    forward,
    leftEye,
    rightEye,
    eyeMid,
    nose: eyeMid.clone().addScaledVector(up, -0.52 * unit),
    mouth: eyeMid.clone().addScaledVector(up, -1.08 * unit),
    leftEar: eyeMid.clone().addScaledVector(right, -1.26 * unit),
    rightEar: eyeMid.clone().addScaledVector(right, 1.26 * unit),
    unit,
  };
}

function discoverBindings(vrm: VRM | null | undefined): readonly MeshBinding[] {
  if (!vrm) return [];
  const world = createWorldLandmarks(vrm);
  const bindings: MeshBinding[] = [];
  vrm.scene.traverse((object) => {
    if (!isFaceMesh(object)) return;
    const role = meshRole(object);
    if (!role) return;
    const basis = basisFromBoundingBox(object, role, world);
    if (!basis) return;
    bindings.push(Object.freeze({ mesh: object, role, basis }));
  });
  return Object.freeze(bindings);
}

function supports(binding: MeshBinding, id: AvatarForgeSemanticFaceMorphId): boolean {
  if (binding.role === "skin") return SKIN_CONTROLS.has(id);
  if (binding.role === "eye") return id === "eyeSize" || id === "eyeSpacing" || id === "eyeTilt";
  if (binding.role === "iris") {
    return id === "irisSize" || id === "eyeSize" || id === "eyeSpacing" || id === "eyeTilt";
  }
  return id === "earSize";
}

export function inspectStudioVrmAdaptiveFaceProfile(
  vrm: VRM | null | undefined,
): StudioVrmAdaptiveFaceProfile {
  const bindings = discoverBindings(vrm);
  const capabilities = FACE_CONTROL_IDS.flatMap((id) => {
    const matching = bindings.filter((binding) => supports(binding, id));
    if (matching.length === 0) return [];
    return [Object.freeze({
      id,
      meshCount: matching.length,
      roles: Object.freeze([...new Set(matching.map((binding) => binding.role))]),
    })];
  });
  return Object.freeze({
    status: capabilities.length > 0 ? "ready" : "unavailable",
    capabilities: Object.freeze(capabilities),
    meshCount: bindings.length,
    message: capabilities.length > 0
      ? `머리 랜드마크와 얼굴 메시를 기준으로 적응형 조형 ${capabilities.length}종을 준비했습니다.`
      : "조형 가능한 얼굴 메시나 머리 랜드마크를 찾지 못했습니다.",
  });
}

function clampSemanticValue(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(1, Math.max(-1, numeric));
}

function smoothWeight(
  point: THREE.Vector3,
  center: THREE.Vector3,
  basis: FaceBasis,
  radiusRight: number,
  radiusUp: number,
  radiusForward: number,
): number {
  const relative = point.clone().sub(center);
  const x = relative.dot(basis.right) / Math.max(1e-5, radiusRight);
  const y = relative.dot(basis.up) / Math.max(1e-5, radiusUp);
  const z = relative.dot(basis.forward) / Math.max(1e-5, radiusForward);
  const distance = Math.sqrt(x * x + y * y + z * z);
  if (distance >= 1) return 0;
  const t = 1 - distance;
  return t * t * (3 - 2 * t);
}

function addScaled(target: THREE.Vector3, direction: THREE.Vector3, amount: number): void {
  if (amount !== 0) target.addScaledVector(direction, amount);
}

function eyeDelta(
  point: THREE.Vector3,
  center: THREE.Vector3,
  side: -1 | 1,
  basis: FaceBasis,
  state: AvatarForgeSemanticFaceMorphState,
  enabled: ReadonlySet<AvatarForgeSemanticFaceMorphId>,
): THREE.Vector3 {
  const unit = basis.unit;
  const delta = new THREE.Vector3();
  const weight = smoothWeight(point, center, basis, 0.78 * unit, 0.56 * unit, 0.5 * unit);
  if (weight <= 0) return delta;
  const relative = point.clone().sub(center);
  const x = relative.dot(basis.right);
  const y = relative.dot(basis.up);
  if (enabled.has("eyeSize")) {
    const value = clampSemanticValue(state.eyeSize);
    addScaled(delta, basis.right, x * 0.22 * value * weight);
    addScaled(delta, basis.up, y * 0.22 * value * weight);
    addScaled(delta, basis.forward, unit * 0.025 * value * weight);
  }
  if (enabled.has("eyeSpacing")) {
    addScaled(
      delta,
      basis.right,
      side * unit * 0.14 * clampSemanticValue(state.eyeSpacing) * weight,
    );
  }
  if (enabled.has("eyeTilt")) {
    const normalizedOuter = Math.max(-1, Math.min(1, (x / (0.72 * unit)) * side));
    addScaled(
      delta,
      basis.up,
      unit * 0.1 * normalizedOuter * clampSemanticValue(state.eyeTilt) * weight,
    );
  }
  if (enabled.has("irisSize")) {
    const value = clampSemanticValue(state.irisSize);
    addScaled(delta, basis.right, x * 0.32 * value * weight);
    addScaled(delta, basis.up, y * 0.32 * value * weight);
  }
  return delta;
}

function skinDelta(
  point: THREE.Vector3,
  basis: FaceBasis,
  state: AvatarForgeSemanticFaceMorphState,
  enabled: ReadonlySet<AvatarForgeSemanticFaceMorphId>,
): THREE.Vector3 {
  const unit = basis.unit;
  const delta = new THREE.Vector3();
  delta.add(eyeDelta(point, basis.leftEye, -1, basis, state, enabled));
  delta.add(eyeDelta(point, basis.rightEye, 1, basis, state, enabled));

  const noseWeight = smoothWeight(point, basis.nose, basis, 0.48 * unit, 0.62 * unit, 0.55 * unit);
  if (noseWeight > 0) {
    const relative = point.clone().sub(basis.nose);
    if (enabled.has("noseHeight")) {
      addScaled(delta, basis.up, unit * 0.14 * clampSemanticValue(state.noseHeight) * noseWeight);
    }
    if (enabled.has("noseWidth")) {
      addScaled(
        delta,
        basis.right,
        relative.dot(basis.right) * 0.25 * clampSemanticValue(state.noseWidth) * noseWeight,
      );
    }
  }

  const mouthWeight = smoothWeight(point, basis.mouth, basis, 0.82 * unit, 0.42 * unit, 0.48 * unit);
  if (mouthWeight > 0) {
    const relative = point.clone().sub(basis.mouth);
    if (enabled.has("mouthWidth")) {
      addScaled(
        delta,
        basis.right,
        relative.dot(basis.right) * 0.28 * clampSemanticValue(state.mouthWidth) * mouthWeight,
      );
    }
    if (enabled.has("lipFullness")) {
      const fullness = clampSemanticValue(state.lipFullness);
      addScaled(delta, basis.forward, unit * 0.09 * fullness * mouthWeight);
      addScaled(delta, basis.up, relative.dot(basis.up) * 0.16 * fullness * mouthWeight);
    }
  }

  if (enabled.has("earSize")) {
    for (const center of [basis.leftEar, basis.rightEar]) {
      const weight = smoothWeight(point, center, basis, 0.5 * unit, 0.86 * unit, 0.48 * unit);
      if (weight <= 0) continue;
      const relative = point.clone().sub(center);
      const value = clampSemanticValue(state.earSize);
      addScaled(delta, basis.right, relative.dot(basis.right) * 0.22 * value * weight);
      addScaled(delta, basis.up, relative.dot(basis.up) * 0.22 * value * weight);
      addScaled(delta, basis.forward, relative.dot(basis.forward) * 0.16 * value * weight);
    }
  }

  const maximum = unit * 0.22;
  if (delta.length() > maximum) delta.setLength(maximum);
  return delta;
}

function bindingEnabledControls(
  binding: MeshBinding,
  excluded: ReadonlySet<AvatarForgeSemanticFaceMorphId>,
): ReadonlySet<AvatarForgeSemanticFaceMorphId> {
  return new Set(FACE_CONTROL_IDS.filter((id) => !excluded.has(id) && supports(binding, id)));
}

function hasActiveValue(
  state: AvatarForgeSemanticFaceMorphState,
  ids: ReadonlySet<AvatarForgeSemanticFaceMorphId>,
): boolean {
  return [...ids].some((id) => Math.abs(clampSemanticValue(state[id])) > 1e-5);
}

function deformBinding(
  binding: MeshBinding,
  state: AvatarForgeSemanticFaceMorphState,
  excluded: ReadonlySet<AvatarForgeSemanticFaceMorphId>,
): (() => void) | null {
  const enabled = bindingEnabledControls(binding, excluded);
  if (!hasActiveValue(state, enabled)) return null;
  const originalGeometry = binding.mesh.geometry;
  const source = originalGeometry.getAttribute("position");
  if (!source) return null;

  const deformed = originalGeometry.clone();
  const positions = new Float32Array(source.count * 3);
  const point = new THREE.Vector3();
  for (let index = 0; index < source.count; index += 1) {
    point.set(source.getX(index), source.getY(index), source.getZ(index));
    const leftDistance = point.distanceTo(binding.basis.leftEye);
    const rightDistance = point.distanceTo(binding.basis.rightEye);
    const delta = binding.role === "skin" || binding.role === "ear"
      ? skinDelta(point, binding.basis, state, enabled)
      : eyeDelta(
          point,
          leftDistance <= rightDistance ? binding.basis.leftEye : binding.basis.rightEye,
          leftDistance <= rightDistance ? -1 : 1,
          binding.basis,
          state,
          enabled,
        );
    positions[index * 3] = point.x + delta.x;
    positions[index * 3 + 1] = point.y + delta.y;
    positions[index * 3 + 2] = point.z + delta.z;
  }
  deformed.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (deformed.getAttribute("normal")) deformed.computeVertexNormals();
  deformed.computeBoundingBox();
  deformed.computeBoundingSphere();
  binding.mesh.geometry = deformed;

  return () => {
    if (binding.mesh.geometry === deformed) binding.mesh.geometry = originalGeometry;
    deformed.dispose();
  };
}

/**
 * Applies bounded, smooth, reversible geometry-space corrections when a model does not expose a
 * dedicated native morph. Native semantic channels are passed through `excludedSemanticIds` and
 * therefore always win. The original geometry object is restored byte-for-byte on release.
 */
export function applyStudioVrmAdaptiveFaceMorphs(
  vrm: VRM | null | undefined,
  state: AvatarForgeSemanticFaceMorphState | null | undefined,
  excludedSemanticIds: ReadonlySet<AvatarForgeSemanticFaceMorphId> = new Set(),
): () => void {
  if (!vrm || !state) return () => undefined;
  const releases = discoverBindings(vrm)
    .map((binding) => deformBinding(binding, state, excludedSemanticIds))
    .filter((release): release is () => void => release !== null);
  return () => {
    for (let index = releases.length - 1; index >= 0; index -= 1) releases[index]();
  };
}
