/**
 * Converts the parametric BG3D room recipe into real Hybrid DCC authority assets.
 *
 * The room recipe remains the semantic source, but every floor/wall/furniture part receives a
 * stable editable mesh, canonical object transform, material identity, and rights record. This
 * closes the old `room-shell` placeholder path where a room existed only as an opaque bridge hash.
 */

import {
  buildStudioBg3dRoomParts,
  clampStudioBg3dRoomSpec,
  getStudioBg3dRoomPreset,
  type StudioBg3dRoomPart,
  type StudioBg3dRoomSpec,
} from "../bg3d/studio-bg3d-room-builder";
import {
  createStudioEditableMeshFromPolygons,
  createStudioUnitCubeMesh,
  type StudioEditableMesh,
  type StudioMeshVec3,
} from "../studio-editable-half-edge-mesh";

import {
  STUDIO_HYBRID_DCC_OBJECT_TRANSFORM_REVISION,
  type StudioHybridDccObjectTransform,
} from "./studio-hybrid-dcc-object-transform";

import type { StudioRightsBomRecord } from "./studio-hybrid-dcc-document";

export const STUDIO_HYBRID_DCC_ROOM_AUTHORITY_REVISION = 1 as const;
export const STUDIO_HYBRID_DCC_ROOM_PART_METADATA_REVISION = 1 as const;
const STUDIO_HYBRID_DCC_ROOM_PART_METADATA_PREFIX = "toonspectrum-room-part:";

export const STUDIO_HYBRID_DCC_ROOM_AUTHORITY_LIMITS = Object.freeze({
  maxParts: 256,
  cylinderSegments: 20,
  maxInstanceIdCodeUnits: 80,
});

export interface StudioHybridDccRoomAuthorityAsset {
  readonly assetId: string;
  readonly groupId: string;
  readonly label: string;
  readonly semanticKind: "floor" | "wall" | "furniture";
  readonly mesh: StudioEditableMesh;
  readonly transform: StudioHybridDccObjectTransform;
  readonly materialId: string;
  readonly color: `#${string}`;
  readonly rights: Omit<StudioRightsBomRecord, "assetId" | "contentHash">;
}

/**
 * Minimal renderer-neutral room identity persisted inside the canonical Rights BOM snapshot.
 * The live bridge may be rebuilt after undo/redo or cold restore without guessing colors or part
 * semantics from mutable preset code.
 */
export interface StudioHybridDccRoomPartMetadata {
  readonly revision: typeof STUDIO_HYBRID_DCC_ROOM_PART_METADATA_REVISION;
  readonly groupId: string;
  readonly label: string;
  readonly semanticKind: StudioHybridDccRoomAuthorityAsset["semanticKind"];
  readonly color: `#${string}`;
  readonly materialId: string;
}

export interface StudioHybridDccRoomAuthorityBuild {
  readonly revision: typeof STUDIO_HYBRID_DCC_ROOM_AUTHORITY_REVISION;
  readonly presetId: string | null;
  readonly instanceId: string;
  readonly groupId: string;
  readonly spec: StudioBg3dRoomSpec;
  readonly assets: readonly StudioHybridDccRoomAuthorityAsset[];
}

function safeInstanceId(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, STUDIO_HYBRID_DCC_ROOM_AUTHORITY_LIMITS.maxInstanceIdCodeUnits);
  if (!normalized) throw new Error("방 인스턴스 ID가 올바르지 않습니다.");
  return normalized;
}

function cylinderMesh(segments = STUDIO_HYBRID_DCC_ROOM_AUTHORITY_LIMITS.cylinderSegments) {
  const count = Math.max(8, Math.min(64, Math.trunc(segments)));
  const vertices: StudioMeshVec3[] = [];
  const bottom: number[] = [];
  const top: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = index / count * Math.PI * 2;
    const x = Math.cos(angle) * 0.3;
    const z = Math.sin(angle) * 0.3;
    bottom.push(vertices.length);
    vertices.push({ x, y: -0.5, z });
    top.push(vertices.length);
    vertices.push({ x, y: 0.5, z });
  }
  const faces: number[][] = [];
  faces.push([...bottom].reverse());
  faces.push([...top]);
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    faces.push([bottom[index]!, bottom[next]!, top[next]!, top[index]!]);
  }
  return createStudioEditableMeshFromPolygons(vertices, faces);
}

function coneMesh(segments = STUDIO_HYBRID_DCC_ROOM_AUTHORITY_LIMITS.cylinderSegments) {
  const count = Math.max(8, Math.min(64, Math.trunc(segments)));
  const vertices: StudioMeshVec3[] = [];
  const bottom: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = index / count * Math.PI * 2;
    const x = Math.cos(angle) * 0.3;
    const z = Math.sin(angle) * 0.3;
    bottom.push(vertices.length);
    vertices.push({ x, y: -0.5, z });
  }
  const apex = vertices.length;
  vertices.push({ x: 0, y: 0.5, z: 0 });
  const faces: number[][] = [];
  faces.push([...bottom].reverse());
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    faces.push([bottom[index]!, bottom[next]!, apex]);
  }
  return createStudioEditableMeshFromPolygons(vertices, faces);
}

function sphereMesh(segments = STUDIO_HYBRID_DCC_ROOM_AUTHORITY_LIMITS.cylinderSegments) {
  const count = Math.max(8, Math.min(64, Math.trunc(segments)));
  const rings = Math.max(4, Math.trunc(count / 2));
  const vertices: StudioMeshVec3[] = [];
  const ringIndex: number[][] = [];
  for (let ring = 1; ring < rings; ring += 1) {
    const phi = ring / rings * Math.PI;
    const y = Math.cos(phi) * 0.5;
    const radius = Math.sin(phi) * 0.5;
    const ringVertices: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const angle = index / count * Math.PI * 2;
      ringVertices.push(vertices.length);
      vertices.push({ x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius });
    }
    ringIndex.push(ringVertices);
  }
  const north = vertices.length;
  vertices.push({ x: 0, y: 0.5, z: 0 });
  const south = vertices.length;
  vertices.push({ x: 0, y: -0.5, z: 0 });
  const faces: number[][] = [];
  const first = ringIndex[0]!;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    faces.push([north, first[index]!, first[next]!]);
  }
  for (let r = 0; r < ringIndex.length - 1; r += 1) {
    const upper = ringIndex[r]!;
    const lower = ringIndex[r + 1]!;
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count;
      faces.push([lower[index]!, lower[next]!, upper[next]!, upper[index]!]);
    }
  }
  const last = ringIndex[ringIndex.length - 1]!;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    faces.push([south, last[next]!, last[index]!]);
  }
  return createStudioEditableMeshFromPolygons(vertices, faces);
}

function hemisphereMesh(segments = STUDIO_HYBRID_DCC_ROOM_AUTHORITY_LIMITS.cylinderSegments) {
  const count = Math.max(8, Math.min(64, Math.trunc(segments)));
  const rings = Math.max(3, Math.trunc(count / 4));
  const vertices: StudioMeshVec3[] = [];
  const ringIndex: number[][] = [];
  for (let ring = 1; ring <= rings; ring += 1) {
    const phi = ring / rings * (Math.PI / 2);
    const y = Math.cos(phi) * 0.5;
    const radius = Math.sin(phi) * 0.5;
    const ringVertices: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const angle = index / count * Math.PI * 2;
      ringVertices.push(vertices.length);
      vertices.push({ x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius });
    }
    ringIndex.push(ringVertices);
  }
  const north = vertices.length;
  vertices.push({ x: 0, y: 0.5, z: 0 });
  const faces: number[][] = [];
  const first = ringIndex[0]!;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    faces.push([north, first[index]!, first[next]!]);
  }
  for (let r = 0; r < ringIndex.length - 1; r += 1) {
    const upper = ringIndex[r]!;
    const lower = ringIndex[r + 1]!;
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count;
      faces.push([lower[index]!, lower[next]!, upper[next]!, upper[index]!]);
    }
  }
  const equator = ringIndex[ringIndex.length - 1]!;
  faces.push([...equator].reverse());
  return createStudioEditableMeshFromPolygons(vertices, faces);
}

function planeMesh() {
  const vertices: StudioMeshVec3[] = [
    { x: -0.5, y: 0, z: -0.5 },
    { x: 0.5, y: 0, z: -0.5 },
    { x: 0.5, y: 0, z: 0.5 },
    { x: -0.5, y: 0, z: 0.5 },
  ];
  return createStudioEditableMeshFromPolygons(vertices, [[0, 1, 2, 3]]);
}

function pyramidMesh() {
  const vertices: StudioMeshVec3[] = [
    { x: -0.35, y: -0.5, z: -0.35 },
    { x: 0.35, y: -0.5, z: -0.35 },
    { x: 0.35, y: -0.5, z: 0.35 },
    { x: -0.35, y: -0.5, z: 0.35 },
    { x: 0, y: 0.5, z: 0 },
  ];
  const faces: number[][] = [
    [0, 3, 2, 1],
    [0, 1, 4],
    [1, 2, 4],
    [2, 3, 4],
    [3, 0, 4],
  ];
  return createStudioEditableMeshFromPolygons(vertices, faces);
}

function triangularPrismMesh() {
  const vertices: StudioMeshVec3[] = [];
  const bottom: number[] = [];
  const top: number[] = [];
  for (let index = 0; index < 3; index += 1) {
    const angle = index / 3 * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * 0.4;
    const z = Math.sin(angle) * 0.4;
    bottom.push(vertices.length);
    vertices.push({ x, y: -0.5, z });
    top.push(vertices.length);
    vertices.push({ x, y: 0.5, z });
  }
  const faces: number[][] = [
    [...bottom].reverse(),
    [...top],
    [bottom[0]!, bottom[1]!, top[1]!, top[0]!],
    [bottom[1]!, bottom[2]!, top[2]!, top[1]!],
    [bottom[2]!, bottom[0]!, top[0]!, top[2]!],
  ];
  return createStudioEditableMeshFromPolygons(vertices, faces);
}

const CYLINDER_AUTHORITY_MESH = cylinderMesh();
const CONE_AUTHORITY_MESH = coneMesh();
const SPHERE_AUTHORITY_MESH = sphereMesh();
const HEMISPHERE_AUTHORITY_MESH = hemisphereMesh();
const PLANE_AUTHORITY_MESH = planeMesh();
const PYRAMID_AUTHORITY_MESH = pyramidMesh();
const TRIANGULAR_PRISM_AUTHORITY_MESH = triangularPrismMesh();

function meshForPart(part: StudioBg3dRoomPart): StudioEditableMesh {
  if (part.kind === "box") return createStudioUnitCubeMesh();
  if (part.kind === "cylinder") return CYLINDER_AUTHORITY_MESH;
  if (part.kind === "cone") return CONE_AUTHORITY_MESH;
  if (part.kind === "sphere") return SPHERE_AUTHORITY_MESH;
  if (part.kind === "hemisphere") return HEMISPHERE_AUTHORITY_MESH;
  if (part.kind === "plane") return PLANE_AUTHORITY_MESH;
  if (part.kind === "pyramid") return PYRAMID_AUTHORITY_MESH;
  if (part.kind === "triangularPrism") return TRIANGULAR_PRISM_AUTHORITY_MESH;
  throw new Error(`Hybrid DCC에서 아직 편집할 수 없는 방 파츠입니다: ${part.kind}`);
}

function semanticKind(part: StudioBg3dRoomPart): StudioHybridDccRoomAuthorityAsset["semanticKind"] {
  if (part.name === "바닥") return "floor";
  if (part.name.includes("벽체")) return "wall";
  return "furniture";
}

function materialId(color: string): string {
  return `room-color:${color.toLowerCase()}`;
}

function serializeRoomPartMetadata(
  metadata: StudioHybridDccRoomPartMetadata,
): string {
  return `${STUDIO_HYBRID_DCC_ROOM_PART_METADATA_PREFIX}${JSON.stringify({
    revision: metadata.revision,
    groupId: metadata.groupId,
    label: metadata.label,
    semanticKind: metadata.semanticKind,
    color: metadata.color,
    materialId: metadata.materialId,
  })}`;
}

/** Strictly decodes canonical room metadata; arbitrary derivative strings fail closed. */
export function parseStudioHybridDccRoomPartMetadata(
  value: string,
): StudioHybridDccRoomPartMetadata | null {
  if (!value.startsWith(STUDIO_HYBRID_DCC_ROOM_PART_METADATA_PREFIX)
    || value.length > 2_048) return null;
  try {
    const decoded: unknown = JSON.parse(value.slice(
      STUDIO_HYBRID_DCC_ROOM_PART_METADATA_PREFIX.length,
    ));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null;
    const record = decoded as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (JSON.stringify(keys) !== JSON.stringify([
      "color",
      "groupId",
      "label",
      "materialId",
      "revision",
      "semanticKind",
    ])) return null;
    if (record.revision !== STUDIO_HYBRID_DCC_ROOM_PART_METADATA_REVISION
      || typeof record.groupId !== "string"
      || !/^room:[A-Za-z0-9_-]{1,80}$/u.test(record.groupId)
      || typeof record.label !== "string"
      || record.label.length === 0
      || record.label.length > 160
      || (record.semanticKind !== "floor"
        && record.semanticKind !== "wall"
        && record.semanticKind !== "furniture")
      || typeof record.color !== "string"
      || !/^#[0-9a-f]{6}$/u.test(record.color)
      || record.materialId !== materialId(record.color)) {
      return null;
    }
    return {
      revision: STUDIO_HYBRID_DCC_ROOM_PART_METADATA_REVISION,
      groupId: record.groupId,
      label: record.label,
      semanticKind: record.semanticKind,
      color: record.color as `#${string}`,
      materialId: record.materialId,
    };
  } catch {
    return null;
  }
}

function buildFromSpec(
  rawSpec: Partial<StudioBg3dRoomSpec>,
  instanceIdValue: string,
  presetId: string | null,
): StudioHybridDccRoomAuthorityBuild {
  const instanceId = safeInstanceId(instanceIdValue);
  const groupId = `room:${instanceId}`;
  const spec = clampStudioBg3dRoomSpec(rawSpec);
  const parts = buildStudioBg3dRoomParts(spec);
  if (parts.length === 0 || parts.length > STUDIO_HYBRID_DCC_ROOM_AUTHORITY_LIMITS.maxParts) {
    throw new Error(`방 파츠 수가 안전 범위를 벗어났습니다: ${parts.length}`);
  }
  const assets = parts.map((part, index): StudioHybridDccRoomAuthorityAsset => {
    const color = part.color.toLowerCase() as `#${string}`;
    const assetId = `room-${instanceId}-part-${String(index + 1).padStart(3, "0")}`;
    const kind = semanticKind(part);
    const canonicalMaterialId = materialId(color);
    const metadata: StudioHybridDccRoomPartMetadata = {
      revision: STUDIO_HYBRID_DCC_ROOM_PART_METADATA_REVISION,
      groupId,
      label: part.name,
      semanticKind: kind,
      color,
      materialId: canonicalMaterialId,
    };
    return {
      assetId,
      groupId,
      label: part.name,
      semanticKind: kind,
      mesh: meshForPart(part),
      transform: {
        revision: STUDIO_HYBRID_DCC_OBJECT_TRANSFORM_REVISION,
        position: [...part.position],
        rotationEulerRad: [...part.rotation],
        scale: [...part.scale],
      },
      materialId: canonicalMaterialId,
      color,
      rights: {
        source: presetId ? `studio-room-preset:${presetId}` : "studio-room-recipe",
        creator: "ToonSpectrum Studio",
        license: "CC0-1.0",
        useScope: "commercial",
        derivative: serializeRoomPartMetadata(metadata),
      },
    };
  });
  return {
    revision: STUDIO_HYBRID_DCC_ROOM_AUTHORITY_REVISION,
    presetId,
    instanceId,
    groupId,
    spec,
    assets,
  };
}

export function buildStudioHybridDccRoomAuthority(
  spec: Partial<StudioBg3dRoomSpec>,
  instanceId: string,
): StudioHybridDccRoomAuthorityBuild {
  return buildFromSpec(spec, instanceId, null);
}

export function buildStudioHybridDccRoomPresetAuthority(
  presetId: string,
  instanceId = presetId,
): StudioHybridDccRoomAuthorityBuild {
  const preset = getStudioBg3dRoomPreset(presetId);
  if (!preset) throw new Error(`알 수 없는 방 프리셋입니다: ${presetId}`);
  return buildFromSpec(preset.spec, instanceId, preset.id);
}
