import * as THREE from "three";

import type {
  GarmentPart,
  GarmentShape,
  WardrobeBone,
} from "./studio-vrm-wardrobe";

export const STUDIO_VRM_SKINNED_GARMENT_VERSION = 1 as const;
export const STUDIO_VRM_SKINNED_GARMENT_VERTEX_BUDGET = 60_000;
export const STUDIO_VRM_SKINNED_GARMENT_TRIANGLE_BUDGET = 120_000;

export type StudioVrmGarmentSkinBone =
  | WardrobeBone
  | "chest"
  | "upperChest"
  | "neck"
  | "leftShoulder"
  | "leftHand"
  | "rightShoulder"
  | "rightHand";

export interface StudioVrmGarmentSkinInfluence {
  bone: StudioVrmGarmentSkinBone;
  weight: number;
}

export type StudioVrmSkinnedGarmentTemplateKind =
  | "upper-body-v1"
  | "merged-parts-v1"
  | null;

export type StudioVrmSkinnedGarmentUnavailableReason =
  | "empty"
  | "material-mismatch"
  | "missing-required-bone"
  | "invalid-bone-node"
  | "invalid-root-transform"
  | "invalid-bone-transform"
  | "upper-template-incomplete"
  | "upper-template-disconnected"
  | "non-finite-geometry"
  | "invalid-topology"
  | "invalid-skin-weights"
  | "vertex-budget"
  | "triangle-budget"
  | "bind-validation";

export interface StudioVrmSkinnedGarmentReceipt {
  kind: "studio-vrm-skinned-garment-receipt";
  version: typeof STUDIO_VRM_SKINNED_GARMENT_VERSION;
  mode: "skinned-shell-v1" | "unavailable";
  signature: string;
  vertexCount: number;
  triangleCount: number;
  boneCount: number;
  blendedVertexCount: number;
  indexed: boolean;
  templateKind: StudioVrmSkinnedGarmentTemplateKind;
  connectedComponentCount: number;
  continuousSleeveCount: number;
  usedBones: readonly StudioVrmGarmentSkinBone[];
  missingBones: readonly StudioVrmGarmentSkinBone[];
  unavailableReason: StudioVrmSkinnedGarmentUnavailableReason | null;
}

export interface StudioVrmSkinnedGarmentSurface {
  mesh: THREE.SkinnedMesh;
  receipt: StudioVrmSkinnedGarmentReceipt;
}

export type StudioVrmSkinnedGarmentBuildResult =
  | {
      readonly ok: true;
      readonly status: "ready";
      readonly surface: StudioVrmSkinnedGarmentSurface;
      readonly receipt: StudioVrmSkinnedGarmentReceipt;
    }
  | {
      readonly ok: false;
      readonly status: "unavailable";
      readonly surface: null;
      readonly receipt: StudioVrmSkinnedGarmentReceipt;
    };

interface StudioVrmSkinnedGarmentBuildInput {
  name: string;
  root: THREE.Object3D;
  parts: readonly GarmentPart[];
  materials: readonly THREE.Material[];
  resolveBone: (name: StudioVrmGarmentSkinBone) => THREE.Object3D | null;
  vertexBudget?: number;
  triangleBudget?: number;
}

interface ReceiptStats {
  vertexCount?: number;
  triangleCount?: number;
  boneCount?: number;
  blendedVertexCount?: number;
  indexed?: boolean;
  templateKind?: StudioVrmSkinnedGarmentTemplateKind;
  connectedComponentCount?: number;
  continuousSleeveCount?: number;
  usedBones?: readonly StudioVrmGarmentSkinBone[];
}

interface GeometryAssembly {
  positions: number[];
  normals: number[];
  uvs: number[];
  skinIndices: number[];
  skinWeights: number[];
  indices: number[];
  groups: Array<{ start: number; count: number; materialIndex: number }>;
  blendedVertexCount: number;
}

interface VertexRange {
  start: number;
  count: number;
}

interface UpperBodyTemplateParts {
  torso: number;
  leftUpper: number;
  leftLower: number;
  rightUpper: number;
  rightLower: number;
}

interface SleeveTopologyRange extends VertexRange {
  anchor: number;
}

interface UpperBodyTopologyMetadata {
  version: 1;
  torso: VertexRange;
  leftSleeve: SleeveTopologyRange;
  rightSleeve: SleeveTopologyRange;
}

const GARMENT_Y = new THREE.Vector3(0, 1, 0);
const GARMENT_Z = new THREE.Vector3(0, 0, 1);
const MATRIX_EPSILON = 1e-12;
const GEOMETRY_EPSILON = 1e-8;
const UPPER_SLEEVE_AXIAL_STEPS = 8;
const UPPER_SLEEVE_RADIAL_SEGMENTS = 32;

export const STUDIO_VRM_GARMENT_SKIN_BONES: readonly StudioVrmGarmentSkinBone[] = [
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "leftShoulder",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightShoulder",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
] as const;

const PREVIOUS_BONE: Partial<Record<StudioVrmGarmentSkinBone, StudioVrmGarmentSkinBone>> = {
  spine: "hips",
  chest: "spine",
  upperChest: "chest",
  neck: "upperChest",
  leftUpperArm: "leftShoulder",
  leftLowerArm: "leftUpperArm",
  rightUpperArm: "rightShoulder",
  rightLowerArm: "rightUpperArm",
  leftLowerLeg: "leftUpperLeg",
  rightLowerLeg: "rightUpperLeg",
};

const NEXT_BONE: Partial<Record<StudioVrmGarmentSkinBone, StudioVrmGarmentSkinBone>> = {
  spine: "chest",
  chest: "upperChest",
  upperChest: "neck",
  leftShoulder: "leftUpperArm",
  leftUpperArm: "leftLowerArm",
  leftLowerArm: "leftHand",
  rightShoulder: "rightUpperArm",
  rightUpperArm: "rightLowerArm",
  rightLowerArm: "rightHand",
  leftUpperLeg: "leftLowerLeg",
  leftLowerLeg: "leftFoot",
  rightUpperLeg: "rightLowerLeg",
  rightLowerLeg: "rightFoot",
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function round(value: number, places = 6): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function shapeAxialRange(shape: GarmentShape): readonly [number, number] | null {
  switch (shape.kind) {
    case "cylinder":
    case "box":
      return [-shape.h / 2, shape.h / 2];
    case "lathe": {
      let min = Infinity;
      let max = -Infinity;
      for (const point of shape.profile) {
        min = Math.min(min, point.y);
        max = Math.max(max, point.y);
      }
      return Number.isFinite(min) && max - min > GEOMETRY_EPSILON ? [min, max] : null;
    }
    case "sphere":
    case "torus":
      return null;
  }
}

function normalizeInfluences(
  influences: readonly StudioVrmGarmentSkinInfluence[],
  fallback: StudioVrmGarmentSkinBone,
): StudioVrmGarmentSkinInfluence[] {
  const merged = new Map<StudioVrmGarmentSkinBone, number>();
  for (const influence of influences) {
    if (!Number.isFinite(influence.weight) || influence.weight <= 1e-6) continue;
    merged.set(influence.bone, (merged.get(influence.bone) ?? 0) + influence.weight);
  }
  const ordered = [...merged]
    .sort((a, b) => b[1] - a[1] || STUDIO_VRM_GARMENT_SKIN_BONES.indexOf(a[0]) - STUDIO_VRM_GARMENT_SKIN_BONES.indexOf(b[0]))
    .slice(0, 4);
  const total = ordered.reduce((sum, entry) => sum + entry[1], 0);
  if (total <= GEOMETRY_EPSILON) return [{ bone: fallback, weight: 1 }];
  return ordered.map(([bone, weight]) => ({ bone, weight: weight / total }));
}

/**
 * 기존 절차형 파츠의 축 방향 위치를 관절 체인 웨이트로 바꾼다.
 * 파츠 자체는 결정론적으로 유지하면서 팔꿈치·무릎·몸통 경계가 한 본에서 뚝 끊기지 않게 한다.
 */
export function planStudioVrmGarmentSkinInfluences(
  part: GarmentPart,
  vertexLocalY: number,
  availableBones: ReadonlySet<StudioVrmGarmentSkinBone>,
  vertexLocalX = 0,
): StudioVrmGarmentSkinInfluence[] {
  const main = part.bone as StudioVrmGarmentSkinBone;
  const range = shapeAxialRange(part.shape);
  // A matching hem trim may be a torus, which has no axial range in the generic joint-chain
  // planner. Treat that trim as the skirt's bottom edge (t=0) so it follows the exact same
  // lower-body drape weights instead of remaining rigidly attached to the hips.
  const t = range
    ? clamp01((vertexLocalY - range[0]) / Math.max(GEOMETRY_EPSILON, range[1] - range[0]))
    : 0;
  const previous = PREVIOUS_BONE[main];
  const next = NEXT_BONE[main];
  const influences: StudioVrmGarmentSkinInfluence[] = [];

  if (part.skinMode === "lower-body-drape" && main === "hips") {
    const hasLeftLeg = availableBones.has("leftUpperLeg");
    const hasRightLeg = availableBones.has("rightUpperLeg");
    if (!hasLeftLeg && !hasRightLeg) return [{ bone: main, weight: 1 }];

    // 허리는 골반에 고정하고 밑단은 최대 72%까지 허벅지를 따라가게 한다. 좌우 경계는
    // 좁은 중앙 블렌드 구간을 둬 다리를 벌리거나 굽혀도 치마 전체가 한쪽으로 끌리지 않는다.
    const legWeight = 0.72 * (1 - smoothstep(0.42, 0.9, t));
    const leftBias = smoothstep(-0.06, 0.06, vertexLocalX);
    const rawLeft = hasLeftLeg ? leftBias : 0;
    const rawRight = hasRightLeg ? 1 - leftBias : 0;
    const legShareTotal = rawLeft + rawRight;
    influences.push({ bone: main, weight: 1 - legWeight });
    if (rawLeft > 0) {
      influences.push({ bone: "leftUpperLeg", weight: legWeight * rawLeft / legShareTotal });
    }
    if (rawRight > 0) {
      influences.push({ bone: "rightUpperLeg", weight: legWeight * rawRight / legShareTotal });
    }
    return normalizeInfluences(influences, main);
  }

  if (!range) return [{ bone: main, weight: 1 }];

  if (main === "spine") {
    const hipsWeight = previous && availableBones.has(previous)
      ? 1 - smoothstep(0.08, 0.42, t)
      : 0;
    const chestWeight = next && availableBones.has(next)
      ? smoothstep(0.62, 0.94, t)
      : 0;
    influences.push({ bone: main, weight: Math.max(0, 1 - hipsWeight - chestWeight) });
    if (previous) influences.push({ bone: previous, weight: hipsWeight });
    if (next) influences.push({ bone: next, weight: chestWeight });
    return normalizeInfluences(influences, main);
  }

  const previousWeight = previous && availableBones.has(previous)
    ? 1 - smoothstep(0.02, 0.28, t)
    : 0;
  const nextWeight = next && availableBones.has(next)
    ? smoothstep(0.68, 0.98, t)
    : 0;
  influences.push({ bone: main, weight: Math.max(0, 1 - previousWeight - nextWeight) });
  if (previous) influences.push({ bone: previous, weight: previousWeight });
  if (next) influences.push({ bone: next, weight: nextWeight });
  return normalizeInfluences(influences, main);
}

function boundedSegments(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value!)));
}

type GarmentLatheProfile = Extract<GarmentShape, { kind: "lathe" }>["profile"];

/** depth를 선언하지 않은 링은 정원 — 파츠 전체 squash가 그대로 그 높이의 단면을 정한다. */
const LATHE_RING_DEFAULT_DEPTH = 1;

interface EllipticalLatheRing {
  radius: number;
  y: number;
  /** radius × depth. 이 링의 z 반경. */
  zRadius: number;
  depth: number;
  /** 프로파일 접선 — 양 끝은 한쪽 차분, 중간은 중앙 차분. */
  dRadius: number;
  dY: number;
  dZRadius: number;
}

function resolveEllipticalLatheRings(profile: GarmentLatheProfile): EllipticalLatheRing[] {
  const last = profile.length - 1;
  // depth는 링에 붙은 값이고 정점은 언제나 링 위에 있으므로, "정점 y에서의 depth 보간"은
  // 그 링의 depth 그 자체다. 생략된 링을 이웃에서 끌어오면 계약(생략 = 정원)이 깨진다.
  const zRadii = profile.map((point) => point.radius * (point.depth ?? LATHE_RING_DEFAULT_DEPTH));
  return profile.map((point, index) => {
    const low = Math.max(0, index - 1);
    const high = Math.min(last, index + 1);
    return {
      radius: point.radius,
      y: point.y,
      zRadius: zRadii[index],
      depth: point.depth ?? LATHE_RING_DEFAULT_DEPTH,
      dRadius: profile[high].radius - profile[low].radius,
      dY: profile[high].y - profile[low].y,
      dZRadius: zRadii[high] - zRadii[low],
    };
  });
}

/**
 * depth 링이 섞인 프로파일을 타원 단면 표면으로 돌린다.
 *
 * LatheGeometry는 2D 윤곽을 그대로 회전시키므로 단면이 언제나 정원이고, 넓고 얕은 가슴과
 * 좁은 허리를 파츠 하나의 squash로는 같이 표현할 수 없다. 여기서는 링마다 z 반경을
 * radius × depth로 따로 잡는다. 법선은 z를 누른 뒤의 접선에서 다시 구한다 — 정원 법선을
 * 그대로 옮기면 눌린 앞뒤 면이 부풀어 보인다.
 *
 * 정점 순서·UV·인덱스 winding은 LatheGeometry와 같게 두어, depth가 모두 1이면 같은 표면이
 * 나오고 상체 template의 소매 접합(가장 가까운 몸통 정점 탐색)도 그대로 동작한다.
 */
function buildEllipticalLatheGeometry(
  profile: GarmentLatheProfile,
  segments: number,
): THREE.BufferGeometry {
  const rings = resolveEllipticalLatheRings(profile);
  const ringCount = rings.length;
  const lastRing = ringCount - 1;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const normal = new THREE.Vector3();
  // 각도 계산은 LatheGeometry와 같은 식으로 둔다 — depth가 모두 1인 프로파일이 회전체와
  // 비트 단위로 같은 정점을 내야 아이템이 depth를 붙이는 순간 형태가 흔들리지 않는다.
  const inverseSegments = 1 / segments;

  for (let segment = 0; segment <= segments; segment += 1) {
    const u = segment / segments;
    const phi = segment * inverseSegments * (Math.PI * 2);
    const sin = Math.sin(phi);
    const cos = Math.cos(phi);
    for (let index = 0; index < ringCount; index += 1) {
      const ring = rings[index];
      positions.push(ring.radius * sin, ring.y, ring.zRadius * cos);
      uvs.push(u, index / Math.max(1, lastRing));
      // 타원 표면의 법선 = (∂P/∂φ × ∂P/∂ring) / radius. radius로 나눈 형태라 반경 0인 링에서도
      // 살아 있고, depth가 모두 1이면 LatheGeometry의 (dY, -dRadius, 0) 회전 법선과 같아진다.
      normal.set(
        ring.depth * ring.dY * sin,
        -ring.depth * ring.dRadius * sin * sin - ring.dZRadius * cos * cos,
        ring.dY * cos,
      ).normalize();
      // 접선이 통째로 소멸한 링(중복 정점 등)만 반경 방향으로 되돌린다. 정원의 반경 방향이 아니라
      // **눌린 단면**의 바깥 방향이어야 한다 — (sin, 0, cos)로 되돌리면 이 함수가 없애려던
      // "부푼 원기둥" 음영이 바로 그 링에서 되살아난다.
      if (normal.lengthSq() < 0.5) normal.set(ring.depth * sin, 0, cos).normalize();
      normals.push(normal.x, normal.y, normal.z);
    }
  }

  for (let segment = 0; segment < segments; segment += 1) {
    for (let index = 0; index < lastRing; index += 1) {
      const base = index + segment * ringCount;
      const a = base;
      const b = base + ringCount;
      const c = base + ringCount + 1;
      const d = base + 1;
      indices.push(a, b, d, c, d, b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

export function buildStudioVrmGarmentGeometry(shape: GarmentShape): THREE.BufferGeometry {
  switch (shape.kind) {
    case "cylinder":
      return new THREE.CylinderGeometry(shape.rTop, shape.rBottom, shape.h, 40, 4, shape.open ?? false);
    case "lathe": {
      const segments = boundedSegments(shape.segments, 40, 40, 256);
      // 어떤 링도 depth를 선언하지 않으면 단면은 정원이라 회전체와 완전히 같다. 이때는 three
      // 구현을 그대로 써야 기존 아이템의 정점·영수증 서명이 한 비트도 움직이지 않는다.
      if (shape.profile.some((point) => point.depth !== undefined)) {
        return buildEllipticalLatheGeometry(shape.profile, segments);
      }
      return new THREE.LatheGeometry(
        shape.profile.map(({ radius, y }) => new THREE.Vector2(radius, y)),
        segments,
      );
    }
    case "box":
      return new THREE.BoxGeometry(shape.w, shape.h, shape.d, 2, 2, 2);
    case "sphere":
      return new THREE.SphereGeometry(shape.r, 30, 20);
    case "torus":
      return new THREE.TorusGeometry(shape.r, shape.tube, 14, 40, shape.arc ?? Math.PI * 2);
  }
}

function partMatrix(part: GarmentPart): THREE.Matrix4 {
  const source = part.shape.kind === "torus" ? GARMENT_Z : GARMENT_Y;
  const quaternion = new THREE.Quaternion();
  if (part.align) {
    const target = new THREE.Vector3(part.align[0], part.align[1], part.align[2]);
    if (target.lengthSq() > GEOMETRY_EPSILON) quaternion.setFromUnitVectors(source, target.normalize());
  }
  const scale = part.squash
    ? new THREE.Vector3(part.squash[0], part.squash[1], part.squash[2])
    : new THREE.Vector3(1, 1, 1);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(part.offset[0], part.offset[1], part.offset[2]),
    quaternion,
    scale,
  );
}

function receiptSignature(input: {
  name: string;
  parts: readonly GarmentPart[];
  usedBones: readonly StudioVrmGarmentSkinBone[];
  vertexCount: number;
  triangleCount: number;
  boneCount: number;
  templateKind: StudioVrmSkinnedGarmentTemplateKind;
}): string {
  const parts = input.parts.map((part) => ({
    bone: part.bone,
    skinMode: part.skinMode ?? null,
    shape: part.shape,
    offset: part.offset.map((value) => round(value)),
    align: part.align?.map((value) => round(value)) ?? null,
    squash: part.squash?.map((value) => round(value)) ?? null,
  }));
  return `vrm-garment-skin1:${fnv1a(JSON.stringify({
    name: input.name,
    parts,
    usedBones: input.usedBones,
    vertexCount: input.vertexCount,
    triangleCount: input.triangleCount,
    boneCount: input.boneCount,
    templateKind: input.templateKind,
  }))}`;
}

function unavailableReceipt(
  input: Pick<StudioVrmSkinnedGarmentBuildInput, "name" | "parts">,
  reason: StudioVrmSkinnedGarmentUnavailableReason,
  missingBones: readonly StudioVrmGarmentSkinBone[] = [],
  stats: ReceiptStats = {},
): StudioVrmSkinnedGarmentReceipt {
  const usedBones = [...(stats.usedBones ?? [])];
  const vertexCount = stats.vertexCount ?? 0;
  const triangleCount = stats.triangleCount ?? 0;
  const boneCount = stats.boneCount ?? 0;
  const templateKind = stats.templateKind ?? null;
  return {
    kind: "studio-vrm-skinned-garment-receipt",
    version: STUDIO_VRM_SKINNED_GARMENT_VERSION,
    mode: "unavailable",
    signature: receiptSignature({
      name: input.name,
      parts: input.parts,
      usedBones,
      vertexCount,
      triangleCount,
      boneCount,
      templateKind,
    }),
    vertexCount,
    triangleCount,
    boneCount,
    blendedVertexCount: stats.blendedVertexCount ?? 0,
    indexed: stats.indexed ?? false,
    templateKind,
    connectedComponentCount: stats.connectedComponentCount ?? 0,
    continuousSleeveCount: stats.continuousSleeveCount ?? 0,
    usedBones,
    missingBones: [...missingBones],
    unavailableReason: reason,
  };
}

function unavailableBuildResult(
  receipt: StudioVrmSkinnedGarmentReceipt,
): StudioVrmSkinnedGarmentBuildResult {
  return { ok: false, status: "unavailable", surface: null, receipt };
}

function isSkeletonBone(node: THREE.Object3D | null): node is THREE.Bone {
  return node instanceof THREE.Bone;
}

function belongsToRoot(node: THREE.Object3D, root: THREE.Object3D): boolean {
  let cursor: THREE.Object3D | null = node;
  while (cursor) {
    if (cursor === root) return true;
    cursor = cursor.parent;
  }
  return false;
}

function matrixIsFiniteAndInvertible(matrix: THREE.Matrix4): boolean {
  return matrix.elements.every(Number.isFinite)
    && Number.isFinite(matrix.determinant())
    && Math.abs(matrix.determinant()) > MATRIX_EPSILON;
}

function valuesAreFinite(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

function partValidationReason(part: GarmentPart): "non-finite-geometry" | "invalid-topology" | null {
  if (!valuesAreFinite(part.offset)
    || (part.align && !valuesAreFinite(part.align))
    || (part.squash && !valuesAreFinite(part.squash))) {
    return "non-finite-geometry";
  }
  if (part.squash?.some((value) => Math.abs(value) <= GEOMETRY_EPSILON)) return "invalid-topology";

  switch (part.shape.kind) {
    case "cylinder":
      if (![part.shape.rTop, part.shape.rBottom, part.shape.h].every(Number.isFinite)) return "non-finite-geometry";
      if (part.shape.h <= GEOMETRY_EPSILON
        || part.shape.rTop < 0
        || part.shape.rBottom < 0
        || Math.max(part.shape.rTop, part.shape.rBottom) <= GEOMETRY_EPSILON) return "invalid-topology";
      return null;
    case "lathe": {
      if (part.shape.segments !== undefined && !Number.isFinite(part.shape.segments)) return "non-finite-geometry";
      if (part.shape.profile.some((point) => !Number.isFinite(point.radius)
        || !Number.isFinite(point.y)
        || (point.depth !== undefined && !Number.isFinite(point.depth)))) {
        return "non-finite-geometry";
      }
      // 음수 depth는 단면을 뒤집어 winding이 반대인 면을 만든다 — 음수 radius와 같게 막는다.
      if (part.shape.profile.length < 2
        || part.shape.profile.some((point) => point.radius < 0 || (point.depth !== undefined && point.depth < 0))
        || Math.max(...part.shape.profile.map((point) => point.radius)) <= GEOMETRY_EPSILON
        || !shapeAxialRange(part.shape)) return "invalid-topology";
      return null;
    }
    case "box":
      if (![part.shape.w, part.shape.h, part.shape.d].every(Number.isFinite)) return "non-finite-geometry";
      return Math.min(part.shape.w, part.shape.h, part.shape.d) > GEOMETRY_EPSILON ? null : "invalid-topology";
    case "sphere":
      if (!Number.isFinite(part.shape.r)) return "non-finite-geometry";
      return part.shape.r > GEOMETRY_EPSILON ? null : "invalid-topology";
    case "torus":
      if (![part.shape.r, part.shape.tube, part.shape.arc ?? Math.PI * 2].every(Number.isFinite)) {
        return "non-finite-geometry";
      }
      return part.shape.r > GEOMETRY_EPSILON
        && part.shape.tube > GEOMETRY_EPSILON
        && (part.shape.arc ?? Math.PI * 2) > GEOMETRY_EPSILON
        ? null
        : "invalid-topology";
  }
}

function createAssembly(): GeometryAssembly {
  return {
    positions: [],
    normals: [],
    uvs: [],
    skinIndices: [],
    skinWeights: [],
    indices: [],
    groups: [],
    blendedVertexCount: 0,
  };
}

function appendSkinInfluences(
  assembly: GeometryAssembly,
  influences: readonly StudioVrmGarmentSkinInfluence[],
  fallbackBone: StudioVrmGarmentSkinBone,
  boneIndices: ReadonlyMap<StudioVrmGarmentSkinBone, number>,
): void {
  const fallbackIndex = boneIndices.get(fallbackBone);
  if (fallbackIndex === undefined) throw new Error(`Missing physical bone index for ${fallbackBone}`);
  const merged = new Map<number, number>();
  for (const influence of influences) {
    const physicalIndex = boneIndices.get(influence.bone) ?? fallbackIndex;
    if (!Number.isFinite(influence.weight) || influence.weight <= 1e-8) continue;
    merged.set(physicalIndex, (merged.get(physicalIndex) ?? 0) + influence.weight);
  }
  const ordered = [...merged]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 4);
  const total = ordered.reduce((sum, entry) => sum + entry[1], 0);
  const normalized = total > GEOMETRY_EPSILON
    ? ordered.map(([index, weight]) => [index, weight / total] as const)
    : [[fallbackIndex, 1] as const];

  if (normalized.length > 1) assembly.blendedVertexCount += 1;
  for (let slot = 0; slot < 4; slot += 1) {
    assembly.skinIndices.push(normalized[slot]?.[0] ?? 0);
    assembly.skinWeights.push(normalized[slot]?.[1] ?? 0);
  }
}

function partRootTransform(
  part: GarmentPart,
  bone: THREE.Bone,
  rootInverse: THREE.Matrix4,
): THREE.Matrix4 {
  return new THREE.Matrix4()
    .multiplyMatrices(rootInverse, bone.matrixWorld)
    .multiply(partMatrix(part));
}

function appendGenericPart(
  assembly: GeometryAssembly,
  part: GarmentPart,
  materialIndex: number,
  boneNodes: ReadonlyMap<StudioVrmGarmentSkinBone, THREE.Bone>,
  boneIndices: ReadonlyMap<StudioVrmGarmentSkinBone, number>,
  availableBones: ReadonlySet<StudioVrmGarmentSkinBone>,
  rootInverse: THREE.Matrix4,
): VertexRange | null {
  const mainBone = part.bone as StudioVrmGarmentSkinBone;
  const boneNode = boneNodes.get(mainBone);
  if (!boneNode) return null;
  const sourceGeometry = buildStudioVrmGarmentGeometry(part.shape);
  try {
    // Preserve analytic seam normals; UV duplicates are not separate cloth surfaces.
    if (!sourceGeometry.hasAttribute("normal")) sourceGeometry.computeVertexNormals();
    const sourcePosition = sourceGeometry.getAttribute("position");
    const sourceNormal = sourceGeometry.getAttribute("normal");
    const sourceUv = sourceGeometry.getAttribute("uv");
    if (!sourcePosition || !sourceNormal || sourcePosition.itemSize !== 3 || sourceNormal.itemSize !== 3) return null;

    const transform = partRootTransform(part, boneNode, rootInverse);
    if (!matrixIsFiniteAndInvertible(transform)) return null;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(transform);
    if (!normalMatrix.elements.every(Number.isFinite)) return null;

    const vertexStart = assembly.positions.length / 3;
    const transformedPosition = new THREE.Vector3();
    const transformedNormal = new THREE.Vector3();
    for (let localIndex = 0; localIndex < sourcePosition.count; localIndex += 1) {
      transformedPosition.fromBufferAttribute(sourcePosition, localIndex).applyMatrix4(transform);
      transformedNormal.fromBufferAttribute(sourceNormal, localIndex).applyMatrix3(normalMatrix).normalize();
      assembly.positions.push(transformedPosition.x, transformedPosition.y, transformedPosition.z);
      assembly.normals.push(transformedNormal.x, transformedNormal.y, transformedNormal.z);
      assembly.uvs.push(sourceUv?.getX(localIndex) ?? 0, sourceUv?.getY(localIndex) ?? 0);
      appendSkinInfluences(
        assembly,
        planStudioVrmGarmentSkinInfluences(
          part,
          sourcePosition.getY(localIndex),
          availableBones,
          sourcePosition.getX(localIndex),
        ),
        mainBone,
        boneIndices,
      );
    }

    const indexStart = assembly.indices.length;
    if (sourceGeometry.index) {
      for (let index = 0; index < sourceGeometry.index.count; index += 1) {
        assembly.indices.push(vertexStart + sourceGeometry.index.getX(index));
      }
    } else {
      if (sourcePosition.count % 3 !== 0) return null;
      for (let index = 0; index < sourcePosition.count; index += 1) {
        assembly.indices.push(vertexStart + index);
      }
    }
    assembly.groups.push({
      start: indexStart,
      count: assembly.indices.length - indexStart,
      materialIndex,
    });
    return { start: vertexStart, count: sourcePosition.count };
  } finally {
    sourceGeometry.dispose();
  }
}

function requestedUpperBodyTemplate(name: string): "shirt" | "blazer" | null {
  const tokens = name.split(":");
  if (tokens.length !== 3 || tokens[0] !== "wardrobe") return null;
  const itemId = tokens[2];
  return itemId === "shirt" || itemId === "blazer" ? itemId : null;
}

function findUpperBodyTemplateParts(parts: readonly GarmentPart[]): UpperBodyTemplateParts | null {
  const find = (bone: WardrobeBone, shape?: GarmentShape["kind"]) => parts.findIndex(
    (part) => part.bone === bone && (!shape || part.shape.kind === shape),
  );
  const template = {
    torso: parts.findIndex((part) => part.bone === "spine" && (part.shape.kind === "lathe" || part.shape.kind === "cylinder")),
    leftUpper: find("leftUpperArm", "cylinder"),
    leftLower: find("leftLowerArm", "cylinder"),
    rightUpper: find("rightUpperArm", "cylinder"),
    rightLower: find("rightLowerArm", "cylinder"),
  };
  return Object.values(template).every((index) => index >= 0) ? template : null;
}

function radialScale(part: GarmentPart): number {
  if (!part.squash) return 1;
  return (Math.abs(part.squash[0]) + Math.abs(part.squash[2])) / 2;
}

function nearestVertex(
  positions: readonly number[],
  range: VertexRange,
  target: THREE.Vector3,
): number {
  let nearest = range.start;
  let distanceSq = Infinity;
  for (let index = range.start; index < range.start + range.count; index += 1) {
    const dx = positions[index * 3]! - target.x;
    const dy = positions[index * 3 + 1]! - target.y;
    const dz = positions[index * 3 + 2]! - target.z;
    const candidateDistanceSq = dx * dx + dy * dy + dz * dz;
    if (candidateDistanceSq < distanceSq) {
      distanceSq = candidateDistanceSq;
      nearest = index;
    }
  }
  return nearest;
}

function initialRingNormal(tangent: THREE.Vector3): THREE.Vector3 {
  const candidates = [
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(1, 0, 0),
  ].sort((a, b) => Math.abs(a.dot(tangent)) - Math.abs(b.dot(tangent)));
  return candidates[0]!
    .addScaledVector(tangent, -candidates[0]!.dot(tangent))
    .normalize();
}

function appendContinuousSleeve(
  assembly: GeometryAssembly,
  torso: VertexRange,
  upperPart: GarmentPart & { shape: Extract<GarmentShape, { kind: "cylinder" }> },
  lowerPart: GarmentPart & { shape: Extract<GarmentShape, { kind: "cylinder" }> },
  upperMaterialIndex: number,
  lowerMaterialIndex: number,
  upperBoneName: "leftUpperArm" | "rightUpperArm",
  lowerBoneName: "leftLowerArm" | "rightLowerArm",
  handBoneName: "leftHand" | "rightHand",
  boneNodes: ReadonlyMap<StudioVrmGarmentSkinBone, THREE.Bone>,
  boneIndices: ReadonlyMap<StudioVrmGarmentSkinBone, number>,
  rootInverse: THREE.Matrix4,
): SleeveTopologyRange | null {
  const upperBone = boneNodes.get(upperBoneName);
  const lowerBone = boneNodes.get(lowerBoneName);
  if (!upperBone || !lowerBone) return null;
  const upperTransform = partRootTransform(upperPart, upperBone, rootInverse);
  const lowerTransform = partRootTransform(lowerPart, lowerBone, rootInverse);
  if (!matrixIsFiniteAndInvertible(upperTransform) || !matrixIsFiniteAndInvertible(lowerTransform)) return null;

  const upperHalf = upperPart.shape.h / 2;
  const lowerHalf = lowerPart.shape.h / 2;
  const shoulder = new THREE.Vector3(0, -upperHalf, 0).applyMatrix4(upperTransform);
  const upperEnd = new THREE.Vector3(0, upperHalf, 0).applyMatrix4(upperTransform);
  const lowerStart = new THREE.Vector3(0, -lowerHalf, 0).applyMatrix4(lowerTransform);
  const elbow = upperEnd.add(lowerStart).multiplyScalar(0.5);
  const wrist = new THREE.Vector3(0, lowerHalf, 0).applyMatrix4(lowerTransform);
  if (![shoulder, elbow, wrist].every((point) => valuesAreFinite(point.toArray()))) return null;
  if (shoulder.distanceToSquared(elbow) <= GEOMETRY_EPSILON
    || elbow.distanceToSquared(wrist) <= GEOMETRY_EPSILON) return null;

  const upperRadialScale = radialScale(upperPart);
  const lowerRadialScale = radialScale(lowerPart);
  const radii = [
    upperPart.shape.rBottom * upperRadialScale,
    (upperPart.shape.rTop * upperRadialScale + lowerPart.shape.rBottom * lowerRadialScale) / 2,
    lowerPart.shape.rTop * lowerRadialScale,
  ];
  if (!radii.every((radius) => Number.isFinite(radius) && radius > GEOMETRY_EPSILON)) return null;

  const centers: THREE.Vector3[] = [];
  const ringRadii: number[] = [];
  const ringInfluences: StudioVrmGarmentSkinInfluence[][] = [];
  for (let step = 0; step <= UPPER_SLEEVE_AXIAL_STEPS; step += 1) {
    const t = step / UPPER_SLEEVE_AXIAL_STEPS;
    const lowerWeight = smoothstep(0.42, 1, t);
    centers.push(shoulder.clone().lerp(elbow, t));
    ringRadii.push(THREE.MathUtils.lerp(radii[0]!, radii[1]!, t));
    ringInfluences.push([
      { bone: upperBoneName, weight: 1 - lowerWeight },
      { bone: lowerBoneName, weight: lowerWeight },
    ]);
  }
  for (let step = 1; step <= UPPER_SLEEVE_AXIAL_STEPS; step += 1) {
    const t = step / UPPER_SLEEVE_AXIAL_STEPS;
    const handWeight = boneIndices.has(handBoneName) ? smoothstep(0.62, 1, t) : 0;
    centers.push(elbow.clone().lerp(wrist, t));
    ringRadii.push(THREE.MathUtils.lerp(radii[1]!, radii[2]!, t));
    ringInfluences.push([
      { bone: lowerBoneName, weight: 1 - handWeight },
      { bone: handBoneName, weight: handWeight },
    ]);
  }

  const tangents = centers.map((center, index) => {
    const previous = centers[Math.max(0, index - 1)]!;
    const next = centers[Math.min(centers.length - 1, index + 1)]!;
    const tangent = next.clone().sub(previous);
    if (tangent.lengthSq() <= GEOMETRY_EPSILON) {
      return index > 0 ? center.clone().sub(previous).normalize() : next.clone().sub(center).normalize();
    }
    return tangent.normalize();
  });
  if (tangents.some((tangent) => !valuesAreFinite(tangent.toArray()) || tangent.lengthSq() <= GEOMETRY_EPSILON)) {
    return null;
  }

  const cumulativeDistances = [0];
  for (let index = 1; index < centers.length; index += 1) {
    cumulativeDistances.push(cumulativeDistances[index - 1]! + centers[index]!.distanceTo(centers[index - 1]!));
  }
  const totalDistance = cumulativeDistances.at(-1)!;
  if (!Number.isFinite(totalDistance) || totalDistance <= GEOMETRY_EPSILON) return null;

  const vertexStart = assembly.positions.length / 3;
  let frameNormal = initialRingNormal(tangents[0]!);
  let previousTangent = tangents[0]!.clone();
  const transported = new THREE.Quaternion();
  for (let ring = 0; ring < centers.length; ring += 1) {
    const tangent = tangents[ring]!;
    if (ring > 0) {
      transported.setFromUnitVectors(previousTangent, tangent);
      frameNormal.applyQuaternion(transported);
      frameNormal.addScaledVector(tangent, -frameNormal.dot(tangent));
      if (frameNormal.lengthSq() <= GEOMETRY_EPSILON) frameNormal = initialRingNormal(tangent);
      else frameNormal.normalize();
      previousTangent = tangent.clone();
    }
    const binormal = new THREE.Vector3().crossVectors(tangent, frameNormal).normalize();
    for (let radial = 0; radial <= UPPER_SLEEVE_RADIAL_SEGMENTS; radial += 1) {
      const u = radial / UPPER_SLEEVE_RADIAL_SEGMENTS;
      const angle = u * Math.PI * 2;
      const normal = frameNormal.clone().multiplyScalar(Math.cos(angle))
        .addScaledVector(binormal, Math.sin(angle))
        .normalize();
      const position = centers[ring]!.clone().addScaledVector(normal, ringRadii[ring]!);
      assembly.positions.push(position.x, position.y, position.z);
      assembly.normals.push(normal.x, normal.y, normal.z);
      assembly.uvs.push(u, cumulativeDistances[ring]! / totalDistance);
      appendSkinInfluences(assembly, ringInfluences[ring]!, upperBoneName, boneIndices);
    }
  }

  const ringStride = UPPER_SLEEVE_RADIAL_SEGMENTS + 1;
  const anchor = nearestVertex(assembly.positions, torso, shoulder);
  let groupStart = assembly.indices.length;
  for (let radial = 0; radial < UPPER_SLEEVE_RADIAL_SEGMENTS; radial += 1) {
    assembly.indices.push(anchor, vertexStart + radial + 1, vertexStart + radial);
  }
  for (let ring = 0; ring < UPPER_SLEEVE_AXIAL_STEPS; ring += 1) {
    const current = vertexStart + ring * ringStride;
    const next = current + ringStride;
    for (let radial = 0; radial < UPPER_SLEEVE_RADIAL_SEGMENTS; radial += 1) {
      assembly.indices.push(
        current + radial,
        next + radial + 1,
        next + radial,
        current + radial,
        current + radial + 1,
        next + radial + 1,
      );
    }
  }
  assembly.groups.push({
    start: groupStart,
    count: assembly.indices.length - groupStart,
    materialIndex: upperMaterialIndex,
  });

  groupStart = assembly.indices.length;
  for (let ring = UPPER_SLEEVE_AXIAL_STEPS; ring < centers.length - 1; ring += 1) {
    const current = vertexStart + ring * ringStride;
    const next = current + ringStride;
    for (let radial = 0; radial < UPPER_SLEEVE_RADIAL_SEGMENTS; radial += 1) {
      assembly.indices.push(
        current + radial,
        next + radial + 1,
        next + radial,
        current + radial,
        current + radial + 1,
        next + radial + 1,
      );
    }
  }
  assembly.groups.push({
    start: groupStart,
    count: assembly.indices.length - groupStart,
    materialIndex: lowerMaterialIndex,
  });

  return {
    start: vertexStart,
    count: centers.length * ringStride,
    anchor,
  };
}

class IndexUnionFind {
  private readonly parent: Int32Array;

  private readonly rank: Uint8Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    this.rank = new Uint8Array(size);
    for (let index = 0; index < size; index += 1) this.parent[index] = index;
  }

  find(value: number): number {
    let root = value;
    while (this.parent[root] !== root) root = this.parent[root]!;
    while (this.parent[value] !== value) {
      const next = this.parent[value]!;
      this.parent[value] = root;
      value = next;
    }
    return root;
  }

  union(left: number, right: number): void {
    let leftRoot = this.find(left);
    let rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    if (this.rank[leftRoot]! < this.rank[rightRoot]!) [leftRoot, rightRoot] = [rightRoot, leftRoot];
    this.parent[rightRoot] = leftRoot;
    if (this.rank[leftRoot] === this.rank[rightRoot]) this.rank[leftRoot] += 1;
  }
}

function topologyUnionFind(vertexCount: number, indices: readonly number[]): IndexUnionFind {
  const unionFind = new IndexUnionFind(vertexCount);
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index]!;
    const b = indices[index + 1]!;
    const c = indices[index + 2]!;
    unionFind.union(a, b);
    unionFind.union(b, c);
    unionFind.union(c, a);
  }
  return unionFind;
}

function connectedComponentCount(vertexCount: number, indices: readonly number[]): number {
  const unionFind = topologyUnionFind(vertexCount, indices);
  const referenced = new Set(indices);
  return new Set([...referenced].map((index) => unionFind.find(index))).size;
}

function upperBodyIsConnected(
  vertexCount: number,
  indices: readonly number[],
  topology: UpperBodyTopologyMetadata,
): boolean {
  const unionFind = topologyUnionFind(vertexCount, indices);
  const references = [
    topology.leftSleeve.anchor,
    topology.leftSleeve.start,
    topology.leftSleeve.start + topology.leftSleeve.count - 1,
    topology.rightSleeve.anchor,
    topology.rightSleeve.start,
    topology.rightSleeve.start + topology.rightSleeve.count - 1,
  ];
  const root = unionFind.find(references[0]!);
  return references.every((index) => unionFind.find(index) === root);
}

function validateAssembly(
  assembly: GeometryAssembly,
  boneCount: number,
): "non-finite-geometry" | "invalid-topology" | "invalid-skin-weights" | null {
  const vertexCount = assembly.positions.length / 3;
  if (!Number.isInteger(vertexCount)
    || vertexCount <= 0
    || assembly.normals.length !== vertexCount * 3
    || assembly.uvs.length !== vertexCount * 2
    || assembly.skinIndices.length !== vertexCount * 4
    || assembly.skinWeights.length !== vertexCount * 4) return "invalid-topology";
  if (assembly.indices.length === 0 || assembly.indices.length % 3 !== 0) return "invalid-topology";
  if (!valuesAreFinite(assembly.positions)
    || !valuesAreFinite(assembly.normals)
    || !valuesAreFinite(assembly.uvs)) return "non-finite-geometry";
  if (assembly.indices.some((index) => !Number.isInteger(index) || index < 0 || index >= vertexCount)) {
    return "invalid-topology";
  }
  if (assembly.groups.some((group) => !Number.isInteger(group.start)
    || !Number.isInteger(group.count)
    || group.start < 0
    || group.count <= 0
    || group.count % 3 !== 0
    || group.start + group.count > assembly.indices.length)) return "invalid-topology";

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    let total = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      const offset = vertex * 4 + slot;
      const index = assembly.skinIndices[offset]!;
      const weight = assembly.skinWeights[offset]!;
      if (!Number.isInteger(index) || index < 0 || index >= boneCount
        || !Number.isFinite(weight) || weight < 0 || weight > 1 + 1e-6) return "invalid-skin-weights";
      total += weight;
    }
    if (Math.abs(total - 1) > 1e-6) return "invalid-skin-weights";
  }
  return null;
}

function normalizedBudget(value: number | undefined, hardLimit: number): number {
  if (!Number.isFinite(value) || value === undefined) return hardLimit;
  return Math.min(hardLimit, Math.max(1, Math.trunc(value)));
}

function validateBindPose(mesh: THREE.SkinnedMesh): boolean {
  const position = mesh.geometry.getAttribute("position");
  const source = new THREE.Vector3();
  const deformed = new THREE.Vector3();
  mesh.skeleton.update();
  for (let index = 0; index < position.count; index += 1) {
    source.fromBufferAttribute(position, index);
    deformed.copy(source);
    mesh.applyBoneTransform(index, deformed);
    if (!valuesAreFinite(deformed.toArray())) return false;
    const tolerance = 2e-4 * (1 + source.length());
    if (deformed.distanceTo(source) > tolerance) return false;
  }
  return true;
}

/**
 * 절차형 파츠를 VRM raw skeleton의 단일 indexed SkinnedMesh로 변환한다.
 * 셔츠와 블레이저는 몸통 표면에 양 소매를 인덱스로 직접 연결하고, 나머지 아이템은
 * 각 파츠의 indexed surface를 한 draw object로 병합한다. 현재 포즈의 raw Bone world
 * matrix로 inverse bind를 만들기 때문에 장착 순간에는 정점이 정확히 제자리에 남는다.
 */
export function buildStudioVrmSkinnedGarment(
  input: StudioVrmSkinnedGarmentBuildInput,
): StudioVrmSkinnedGarmentBuildResult {
  if (input.parts.length === 0) {
    const receipt = unavailableReceipt(input, "empty");
    return unavailableBuildResult(receipt);
  }
  if (input.materials.length !== input.parts.length) {
    const receipt = unavailableReceipt(input, "material-mismatch");
    return unavailableBuildResult(receipt);
  }
  for (const part of input.parts) {
    const reason = partValidationReason(part);
    if (reason) {
      const receipt = unavailableReceipt(input, reason);
      return unavailableBuildResult(receipt);
    }
  }

  const upperBodyItem = requestedUpperBodyTemplate(input.name);
  const upperTemplateParts = upperBodyItem ? findUpperBodyTemplateParts(input.parts) : null;
  if (upperBodyItem && !upperTemplateParts) {
    const receipt = unavailableReceipt(input, "upper-template-incomplete");
    return unavailableBuildResult(receipt);
  }

  input.root.updateMatrixWorld(true);
  if (!matrixIsFiniteAndInvertible(input.root.matrixWorld)) {
    const receipt = unavailableReceipt(input, "invalid-root-transform");
    return unavailableBuildResult(receipt);
  }

  const requiredBones = [...new Set(input.parts.map((part) => part.bone as StudioVrmGarmentSkinBone))];
  const requiredNodes = new Map(requiredBones.map((bone) => [bone, input.resolveBone(bone)]));
  const missingBones = requiredBones.filter((bone) => !requiredNodes.get(bone));
  if (missingBones.length > 0) {
    const receipt = unavailableReceipt(input, "missing-required-bone", missingBones);
    return unavailableBuildResult(receipt);
  }
  const invalidBones = requiredBones.filter((bone) => {
    const node = requiredNodes.get(bone) ?? null;
    return !isSkeletonBone(node) || !belongsToRoot(node, input.root);
  });
  if (invalidBones.length > 0) {
    const receipt = unavailableReceipt(input, "invalid-bone-node", invalidBones);
    return unavailableBuildResult(receipt);
  }

  const candidateBones = new Set<StudioVrmGarmentSkinBone>(requiredBones);
  if (input.parts.some((part) => part.skinMode === "lower-body-drape")) {
    candidateBones.add("leftUpperLeg");
    candidateBones.add("rightUpperLeg");
  }
  for (const bone of requiredBones) {
    const previous = PREVIOUS_BONE[bone];
    const next = NEXT_BONE[bone];
    if (previous) candidateBones.add(previous);
    if (next) candidateBones.add(next);
  }
  const boneNodes = new Map<StudioVrmGarmentSkinBone, THREE.Bone>();
  for (const bone of STUDIO_VRM_GARMENT_SKIN_BONES) {
    if (!candidateBones.has(bone)) continue;
    const node = requiredNodes.get(bone) ?? input.resolveBone(bone);
    if (isSkeletonBone(node) && belongsToRoot(node, input.root)) boneNodes.set(bone, node);
  }
  const usedBones = STUDIO_VRM_GARMENT_SKIN_BONES.filter((bone) => boneNodes.has(bone));
  const uniqueBones: THREE.Bone[] = [];
  const physicalBoneIndices = new Map<THREE.Bone, number>();
  const boneIndices = new Map<StudioVrmGarmentSkinBone, number>();
  for (const boneName of usedBones) {
    const bone = boneNodes.get(boneName)!;
    let physicalIndex = physicalBoneIndices.get(bone);
    if (physicalIndex === undefined) {
      physicalIndex = uniqueBones.length;
      uniqueBones.push(bone);
      physicalBoneIndices.set(bone, physicalIndex);
    }
    boneIndices.set(boneName, physicalIndex);
  }
  const availableBones = new Set(usedBones);
  for (const bone of uniqueBones) bone.updateWorldMatrix(true, false);
  if (uniqueBones.some((bone) => !matrixIsFiniteAndInvertible(bone.matrixWorld))) {
    const receipt = unavailableReceipt(input, "invalid-bone-transform", [], {
      boneCount: uniqueBones.length,
      usedBones,
    });
    return unavailableBuildResult(receipt);
  }

  const rootInverse = input.root.matrixWorld.clone().invert();
  const assembly = createAssembly();
  let upperTopology: UpperBodyTopologyMetadata | null = null;
  try {
    if (upperTemplateParts) {
      const consumedSleeveParts = new Set([
        upperTemplateParts.leftUpper,
        upperTemplateParts.leftLower,
        upperTemplateParts.rightUpper,
        upperTemplateParts.rightLower,
      ]);
      let torsoRange: VertexRange | null = null;
      for (let partIndex = 0; partIndex < input.parts.length; partIndex += 1) {
        if (consumedSleeveParts.has(partIndex)) continue;
        const range = appendGenericPart(
          assembly,
          input.parts[partIndex]!,
          partIndex,
          boneNodes,
          boneIndices,
          availableBones,
          rootInverse,
        );
        if (!range) throw new Error("invalid-topology");
        if (partIndex === upperTemplateParts.torso) torsoRange = range;
      }
      if (!torsoRange) throw new Error("invalid-topology");

      const leftUpper = input.parts[upperTemplateParts.leftUpper]!;
      const leftLower = input.parts[upperTemplateParts.leftLower]!;
      const rightUpper = input.parts[upperTemplateParts.rightUpper]!;
      const rightLower = input.parts[upperTemplateParts.rightLower]!;
      if (leftUpper.shape.kind !== "cylinder"
        || leftLower.shape.kind !== "cylinder"
        || rightUpper.shape.kind !== "cylinder"
        || rightLower.shape.kind !== "cylinder") throw new Error("invalid-topology");

      const leftSleeve = appendContinuousSleeve(
        assembly,
        torsoRange,
        leftUpper as GarmentPart & { shape: Extract<GarmentShape, { kind: "cylinder" }> },
        leftLower as GarmentPart & { shape: Extract<GarmentShape, { kind: "cylinder" }> },
        upperTemplateParts.leftUpper,
        upperTemplateParts.leftLower,
        "leftUpperArm",
        "leftLowerArm",
        "leftHand",
        boneNodes,
        boneIndices,
        rootInverse,
      );
      const rightSleeve = appendContinuousSleeve(
        assembly,
        torsoRange,
        rightUpper as GarmentPart & { shape: Extract<GarmentShape, { kind: "cylinder" }> },
        rightLower as GarmentPart & { shape: Extract<GarmentShape, { kind: "cylinder" }> },
        upperTemplateParts.rightUpper,
        upperTemplateParts.rightLower,
        "rightUpperArm",
        "rightLowerArm",
        "rightHand",
        boneNodes,
        boneIndices,
        rootInverse,
      );
      if (!leftSleeve || !rightSleeve) throw new Error("invalid-topology");
      upperTopology = {
        version: 1,
        torso: torsoRange,
        leftSleeve,
        rightSleeve,
      };
    } else {
      for (let partIndex = 0; partIndex < input.parts.length; partIndex += 1) {
        const range = appendGenericPart(
          assembly,
          input.parts[partIndex]!,
          partIndex,
          boneNodes,
          boneIndices,
          availableBones,
          rootInverse,
        );
        if (!range) throw new Error("invalid-topology");
      }
    }
  } catch {
    const receipt = unavailableReceipt(input, "invalid-topology", [], {
      boneCount: uniqueBones.length,
      usedBones,
    });
    return unavailableBuildResult(receipt);
  }

  const vertexCount = assembly.positions.length / 3;
  const triangleCount = assembly.indices.length / 3;
  const templateKind: Exclude<StudioVrmSkinnedGarmentTemplateKind, null> = upperTopology
    ? "upper-body-v1"
    : "merged-parts-v1";
  const receiptStats: ReceiptStats = {
    vertexCount,
    triangleCount,
    boneCount: uniqueBones.length,
    blendedVertexCount: assembly.blendedVertexCount,
    indexed: true,
    templateKind,
    continuousSleeveCount: upperTopology ? 2 : 0,
    usedBones,
  };

  const vertexBudget = normalizedBudget(input.vertexBudget, STUDIO_VRM_SKINNED_GARMENT_VERTEX_BUDGET);
  if (vertexCount > vertexBudget) {
    const receipt = unavailableReceipt(input, "vertex-budget", [], receiptStats);
    return unavailableBuildResult(receipt);
  }
  const triangleBudget = normalizedBudget(input.triangleBudget, STUDIO_VRM_SKINNED_GARMENT_TRIANGLE_BUDGET);
  if (triangleCount > triangleBudget) {
    const receipt = unavailableReceipt(input, "triangle-budget", [], receiptStats);
    return unavailableBuildResult(receipt);
  }

  const assemblyFailure = validateAssembly(assembly, uniqueBones.length);
  if (assemblyFailure) {
    const receipt = unavailableReceipt(input, assemblyFailure, [], receiptStats);
    return unavailableBuildResult(receipt);
  }
  const componentCount = connectedComponentCount(vertexCount, assembly.indices);
  receiptStats.connectedComponentCount = componentCount;
  if (upperTopology && !upperBodyIsConnected(vertexCount, assembly.indices, upperTopology)) {
    const receipt = unavailableReceipt(input, "upper-template-disconnected", [], receiptStats);
    return unavailableBuildResult(receipt);
  }

  const positions = new Float32Array(assembly.positions);
  const normals = new Float32Array(assembly.normals);
  const uvs = new Float32Array(assembly.uvs);
  const skinIndices = new Uint16Array(assembly.skinIndices);
  const skinWeights = new Float32Array(assembly.skinWeights);
  if (![positions, normals, uvs, skinWeights].every((array) => Array.from(array).every(Number.isFinite))) {
    const receipt = unavailableReceipt(input, "non-finite-geometry", [], receiptStats);
    return unavailableBuildResult(receipt);
  }
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const total = skinWeights[vertex * 4]!
      + skinWeights[vertex * 4 + 1]!
      + skinWeights[vertex * 4 + 2]!
      + skinWeights[vertex * 4 + 3]!;
    if (Math.abs(total - 1) > 2e-6) {
      const receipt = unavailableReceipt(input, "invalid-skin-weights", [], receiptStats);
      return unavailableBuildResult(receipt);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  geometry.setIndex(assembly.indices);
  for (const group of assembly.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  if (upperTopology) geometry.userData.studioVrmUpperBodyTopology = upperTopology;

  const boneInverses = uniqueBones.map((bone) => bone.matrixWorld.clone().invert());
  if (boneInverses.some((inverse) => !matrixIsFiniteAndInvertible(inverse))) {
    geometry.dispose();
    const receipt = unavailableReceipt(input, "invalid-bone-transform", [], receiptStats);
    return unavailableBuildResult(receipt);
  }
  const skeleton = new THREE.Skeleton(uniqueBones, boneInverses);
  const mesh = new THREE.SkinnedMesh(geometry, [...input.materials]);
  mesh.name = input.name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.bindMode = THREE.AttachedBindMode;
  mesh.bind(skeleton, input.root.matrixWorld.clone());

  if (!validateBindPose(mesh)) {
    geometry.dispose();
    skeleton.dispose();
    const receipt = unavailableReceipt(input, "bind-validation", [], receiptStats);
    return unavailableBuildResult(receipt);
  }

  const receipt: StudioVrmSkinnedGarmentReceipt = {
    kind: "studio-vrm-skinned-garment-receipt",
    version: STUDIO_VRM_SKINNED_GARMENT_VERSION,
    mode: "skinned-shell-v1",
    signature: receiptSignature({
      name: input.name,
      parts: input.parts,
      usedBones,
      vertexCount,
      triangleCount,
      boneCount: uniqueBones.length,
      templateKind,
    }),
    vertexCount,
    triangleCount,
    boneCount: uniqueBones.length,
    blendedVertexCount: assembly.blendedVertexCount,
    indexed: true,
    templateKind,
    connectedComponentCount: componentCount,
    continuousSleeveCount: upperTopology ? 2 : 0,
    usedBones: [...usedBones],
    missingBones: [],
    unavailableReason: null,
  };
  mesh.userData.studioVrmSkinnedGarmentReceipt = receipt;
  mesh.userData.studioVrmGarmentMountRootUuid = input.root.uuid;
  return { ok: true, status: "ready", surface: { mesh, receipt }, receipt };
}

export function disposeStudioVrmSkinnedGarment(surface: StudioVrmSkinnedGarmentSurface): void {
  surface.mesh.geometry.dispose();
  surface.mesh.skeleton.dispose();
}
