/**
 * Structured-clone-only protocol for parsing one canonical OBJ package in a dedicated Worker.
 *
 * Do not add File, Blob, Map, Three.js instances, callbacks, or object URLs to this boundary.
 * Every object is exact-key validated in the receiving realm before any transferred buffer is
 * exposed to a parser or renderer.
 */

export const STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION = 1 as const;

export const STUDIO_BG3D_OBJ_WORKER_MAX_OBJ_BYTES = 32 * 1024 * 1024;
export const STUDIO_BG3D_OBJ_WORKER_MAX_MTL_BYTES = 16 * 1024 * 1024;
export const STUDIO_BG3D_OBJ_WORKER_MAX_MATERIAL_LIBRARIES = 64;
export const STUDIO_BG3D_OBJ_WORKER_MAX_RESOURCES = 256;
export const STUDIO_BG3D_OBJ_WORKER_MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
export const STUDIO_BG3D_OBJ_WORKER_MAX_VERTICES = 4_000_000;
export const STUDIO_BG3D_OBJ_WORKER_MAX_TRIANGLES = 2_000_000;
export const STUDIO_BG3D_OBJ_WORKER_MAX_NODES = 2_048;
export const STUDIO_BG3D_OBJ_WORKER_MAX_MESHES = 1_024;
export const STUDIO_BG3D_OBJ_WORKER_MAX_MATERIAL_SLOTS = 4_096;
export const STUDIO_BG3D_OBJ_WORKER_MAX_MATERIALS = 1_024;

const MAX_CANONICAL_PATH_LENGTH = 1_024;
const MAX_LABEL_LENGTH = 256;
const MAX_CANONICAL_SCALAR_MAGNITUDE = 1_000_000;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/iu;

export interface StudioBg3dObjWorkerBudgets {
  readonly maxObjBytes: typeof STUDIO_BG3D_OBJ_WORKER_MAX_OBJ_BYTES;
  readonly maxMtlBytes: typeof STUDIO_BG3D_OBJ_WORKER_MAX_MTL_BYTES;
  readonly maxMaterialLibraries: typeof STUDIO_BG3D_OBJ_WORKER_MAX_MATERIAL_LIBRARIES;
  readonly maxResources: typeof STUDIO_BG3D_OBJ_WORKER_MAX_RESOURCES;
  readonly maxOutputBytes: typeof STUDIO_BG3D_OBJ_WORKER_MAX_OUTPUT_BYTES;
  readonly maxVertices: typeof STUDIO_BG3D_OBJ_WORKER_MAX_VERTICES;
  readonly maxTriangles: typeof STUDIO_BG3D_OBJ_WORKER_MAX_TRIANGLES;
  readonly maxNodes: typeof STUDIO_BG3D_OBJ_WORKER_MAX_NODES;
  readonly maxMeshes: typeof STUDIO_BG3D_OBJ_WORKER_MAX_MESHES;
  readonly maxMaterialSlots: typeof STUDIO_BG3D_OBJ_WORKER_MAX_MATERIAL_SLOTS;
  readonly maxMaterials: typeof STUDIO_BG3D_OBJ_WORKER_MAX_MATERIALS;
}

export const STUDIO_BG3D_OBJ_WORKER_BUDGETS: StudioBg3dObjWorkerBudgets = Object.freeze({
  maxObjBytes: STUDIO_BG3D_OBJ_WORKER_MAX_OBJ_BYTES,
  maxMtlBytes: STUDIO_BG3D_OBJ_WORKER_MAX_MTL_BYTES,
  maxMaterialLibraries: STUDIO_BG3D_OBJ_WORKER_MAX_MATERIAL_LIBRARIES,
  maxResources: STUDIO_BG3D_OBJ_WORKER_MAX_RESOURCES,
  maxOutputBytes: STUDIO_BG3D_OBJ_WORKER_MAX_OUTPUT_BYTES,
  maxVertices: STUDIO_BG3D_OBJ_WORKER_MAX_VERTICES,
  maxTriangles: STUDIO_BG3D_OBJ_WORKER_MAX_TRIANGLES,
  maxNodes: STUDIO_BG3D_OBJ_WORKER_MAX_NODES,
  maxMeshes: STUDIO_BG3D_OBJ_WORKER_MAX_MESHES,
  maxMaterialSlots: STUDIO_BG3D_OBJ_WORKER_MAX_MATERIAL_SLOTS,
  maxMaterials: STUDIO_BG3D_OBJ_WORKER_MAX_MATERIALS,
});

export interface StudioBg3dObjWorkerMtlEntry {
  readonly path: string;
  readonly sourceByteLength: number;
  readonly bytes: ArrayBuffer;
}

export interface StudioBg3dObjWorkerParseRequest {
  readonly version: typeof STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION;
  readonly kind: "parse";
  readonly requestId: number;
  readonly generationId: number;
  readonly primaryPath: string;
  readonly sourceByteLength: number;
  readonly bytes: ArrayBuffer;
  /** Canonical-path sorted, unique material sources. */
  readonly materialLibraries: readonly StudioBg3dObjWorkerMtlEntry[];
  /** Canonical-path sorted, unique package catalog including primary, MTL, and texture paths. */
  readonly resourcePaths: readonly string[];
  readonly budgets: StudioBg3dObjWorkerBudgets;
}

export type StudioBg3dObjWorkerRequest = StudioBg3dObjWorkerParseRequest;

export type StudioBg3dObjWorkerProgressStage = "parsing" | "canonicalizing";

export type StudioBg3dObjWorkerRenderableKind = "mesh" | "line-segments" | "points";
export type StudioBg3dObjWorkerAttributeName = "position" | "normal" | "color" | "uv";

export interface StudioBg3dObjWorkerAttribute {
  readonly name: StudioBg3dObjWorkerAttributeName;
  readonly itemSize: 2 | 3;
  readonly count: number;
  readonly normalized: false;
  readonly arrayType: "float32";
  readonly buffer: ArrayBuffer;
}

export interface StudioBg3dObjWorkerGroup {
  readonly start: number;
  readonly count: number;
  /** Index into the owning renderable's materialSlots array. */
  readonly materialIndex: number;
}

export interface StudioBg3dObjWorkerMaterialSlot {
  readonly name: string;
  /** Index into the result's canonical materials array. */
  readonly canonicalMaterialIndex: number;
  readonly flatShading: boolean;
  readonly vertexColors: boolean;
}

export interface StudioBg3dObjWorkerRenderable {
  readonly kind: StudioBg3dObjWorkerRenderableKind;
  readonly name: string;
  readonly vertexCount: number;
  readonly attributes: readonly StudioBg3dObjWorkerAttribute[];
  readonly groups: readonly StudioBg3dObjWorkerGroup[];
  readonly materialSlots: readonly StudioBg3dObjWorkerMaterialSlot[];
}

export interface StudioBg3dObjWorkerNode {
  readonly name: string;
  /** Parent nodes must precede children, so the graph is acyclic by construction. */
  readonly parentIndex: number | null;
  readonly renderableIndex: number | null;
}

export type StudioBg3dObjWorkerTextureSlot =
  | "ambient"
  | "base-color"
  | "specular"
  | "emissive"
  | "normal"
  | "bump"
  | "displacement"
  | "alpha"
  | "reflection";

export interface StudioBg3dObjWorkerTextureBinding {
  readonly slot: StudioBg3dObjWorkerTextureSlot;
  readonly resourcePath: string;
  readonly offset: readonly [number, number];
  readonly repeat: readonly [number, number];
  readonly bumpScale: number;
  readonly displacementBias: number;
  readonly displacementScale: number;
}

export interface StudioBg3dObjWorkerMaterial {
  readonly name: string;
  readonly sourceMtlPath: string | null;
  readonly synthesized: boolean;
  readonly ambient: readonly [number, number, number];
  readonly diffuse: readonly [number, number, number];
  readonly specular: readonly [number, number, number];
  readonly emissive: readonly [number, number, number];
  readonly shininess: number;
  readonly opacity: number;
  /** Texture slots use canonical enum order and may not repeat. */
  readonly textures: readonly StudioBg3dObjWorkerTextureBinding[];
}

export interface StudioBg3dObjWorkerMetrics {
  readonly nodes: number;
  /** All mesh, line-segments, and points renderables count against this bound. */
  readonly meshes: number;
  readonly vertices: number;
  readonly triangles: number;
  readonly outputBytes: number;
  readonly materials: number;
  readonly materialSlots: number;
  readonly usedResources: number;
}

export interface StudioBg3dObjWorkerCanonicalResult {
  readonly primaryPath: string;
  readonly nodes: readonly StudioBg3dObjWorkerNode[];
  readonly renderables: readonly StudioBg3dObjWorkerRenderable[];
  readonly materials: readonly StudioBg3dObjWorkerMaterial[];
  /** Canonical-path sorted, unique transitive OBJ -> MTL -> texture closure. */
  readonly usedResourcePaths: readonly string[];
  readonly metrics: StudioBg3dObjWorkerMetrics;
}

export interface StudioBg3dObjWorkerProgressResponse {
  readonly version: typeof STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION;
  readonly kind: "progress";
  readonly requestId: number;
  readonly generationId: number;
  readonly stage: StudioBg3dObjWorkerProgressStage;
  readonly progress: number;
}

export interface StudioBg3dObjWorkerResultResponse {
  readonly version: typeof STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION;
  readonly kind: "result";
  readonly requestId: number;
  readonly generationId: number;
  readonly result: StudioBg3dObjWorkerCanonicalResult;
}

export type StudioBg3dObjWorkerFailureCode =
  | "geometry-memory-too-large"
  | "material-budget-exceeded"
  | "mesh-budget-exceeded"
  | "missing-resource"
  | "node-budget-exceeded"
  | "parse-failed"
  | "protocol"
  | "triangle-budget-exceeded"
  | "unsafe-resource-uri"
  | "vertex-budget-exceeded";

export interface StudioBg3dObjWorkerErrorResponse {
  readonly version: typeof STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION;
  readonly kind: "error";
  readonly requestId: number;
  readonly generationId: number;
  readonly code: StudioBg3dObjWorkerFailureCode;
}

export type StudioBg3dObjWorkerResponse =
  | StudioBg3dObjWorkerProgressResponse
  | StudioBg3dObjWorkerResultResponse
  | StudioBg3dObjWorkerErrorResponse;

const ATTRIBUTE_ORDER: readonly StudioBg3dObjWorkerAttributeName[] = [
  "position",
  "normal",
  "color",
  "uv",
];
const ATTRIBUTE_ITEM_SIZE: Readonly<Record<StudioBg3dObjWorkerAttributeName, 2 | 3>> = {
  position: 3,
  normal: 3,
  color: 3,
  uv: 2,
};
const TEXTURE_SLOT_ORDER: readonly StudioBg3dObjWorkerTextureSlot[] = [
  "ambient",
  "base-color",
  "specular",
  "emissive",
  "normal",
  "bump",
  "displacement",
  "alpha",
  "reflection",
];
const PROGRESS_STAGES = new Set<StudioBg3dObjWorkerProgressStage>(["parsing", "canonicalizing"]);
const FAILURE_CODES = new Set<StudioBg3dObjWorkerFailureCode>([
  "geometry-memory-too-large",
  "material-budget-exceeded",
  "mesh-budget-exceeded",
  "missing-resource",
  "node-budget-exceeded",
  "parse-failed",
  "protocol",
  "triangle-budget-exceeded",
  "unsafe-resource-uri",
  "vertex-budget-exceeded",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isBoundedFinite(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point <= 31 || point === 127;
  });
}

export function isCanonicalStudioBg3dObjResourcePath(value: unknown): value is string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_CANONICAL_PATH_LENGTH
    || value !== value.normalize("NFC")
    || value.startsWith("/")
    || value.startsWith("//")
    || value.includes("\\")
    || value.includes("?")
    || value.includes("#")
    || containsControlCharacter(value)
    || SCHEME_PATTERN.test(value)
  ) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function compareUtf8(left: string, right: string): number {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function isSortedUniqueCanonicalPaths(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > STUDIO_BG3D_OBJ_WORKER_MAX_RESOURCES) {
    return false;
  }
  let previous: string | null = null;
  const foldedPaths = new Set<string>();
  for (const candidate of value) {
    if (!isCanonicalStudioBg3dObjResourcePath(candidate)) return false;
    if (previous !== null && compareUtf8(previous, candidate) >= 0) return false;
    const folded = candidate.toLocaleLowerCase("en-US");
    if (foldedPaths.has(folded)) return false;
    foldedPaths.add(folded);
    previous = candidate;
  }
  return true;
}

function extensionOf(path: string): string {
  const segment = path.slice(path.lastIndexOf("/") + 1);
  const dot = segment.lastIndexOf(".");
  return dot > 0 ? segment.slice(dot + 1).toLowerCase() : "";
}

function isCanonicalLabel(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_LABEL_LENGTH
    && value === value.normalize("NFC")
    && value === value.trim()
    && !containsControlCharacter(value);
}

function isExactBudgets(value: unknown): value is StudioBg3dObjWorkerBudgets {
  return isRecord(value)
    && hasExactKeys(value, [
      "maxObjBytes",
      "maxMtlBytes",
      "maxMaterialLibraries",
      "maxResources",
      "maxOutputBytes",
      "maxVertices",
      "maxTriangles",
      "maxNodes",
      "maxMeshes",
      "maxMaterialSlots",
      "maxMaterials",
    ])
    && value.maxObjBytes === STUDIO_BG3D_OBJ_WORKER_MAX_OBJ_BYTES
    && value.maxMtlBytes === STUDIO_BG3D_OBJ_WORKER_MAX_MTL_BYTES
    && value.maxMaterialLibraries === STUDIO_BG3D_OBJ_WORKER_MAX_MATERIAL_LIBRARIES
    && value.maxResources === STUDIO_BG3D_OBJ_WORKER_MAX_RESOURCES
    && value.maxOutputBytes === STUDIO_BG3D_OBJ_WORKER_MAX_OUTPUT_BYTES
    && value.maxVertices === STUDIO_BG3D_OBJ_WORKER_MAX_VERTICES
    && value.maxTriangles === STUDIO_BG3D_OBJ_WORKER_MAX_TRIANGLES
    && value.maxNodes === STUDIO_BG3D_OBJ_WORKER_MAX_NODES
    && value.maxMeshes === STUDIO_BG3D_OBJ_WORKER_MAX_MESHES
    && value.maxMaterialSlots === STUDIO_BG3D_OBJ_WORKER_MAX_MATERIAL_SLOTS
    && value.maxMaterials === STUDIO_BG3D_OBJ_WORKER_MAX_MATERIALS;
}

function isMtlEntry(value: unknown): value is StudioBg3dObjWorkerMtlEntry {
  return isRecord(value)
    && hasExactKeys(value, ["path", "sourceByteLength", "bytes"])
    && isCanonicalStudioBg3dObjResourcePath(value.path)
    && extensionOf(value.path) === "mtl"
    && isPositiveSafeInteger(value.sourceByteLength)
    && value.bytes instanceof ArrayBuffer
    && value.bytes.byteLength === value.sourceByteLength;
}

export function isStudioBg3dObjWorkerRequest(value: unknown): value is StudioBg3dObjWorkerRequest {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "version",
      "kind",
      "requestId",
      "generationId",
      "primaryPath",
      "sourceByteLength",
      "bytes",
      "materialLibraries",
      "resourcePaths",
      "budgets",
    ])
    || value.version !== STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION
    || value.kind !== "parse"
    || !isPositiveSafeInteger(value.requestId)
    || !isPositiveSafeInteger(value.generationId)
    || !isCanonicalStudioBg3dObjResourcePath(value.primaryPath)
    || extensionOf(value.primaryPath) !== "obj"
    || !isPositiveSafeInteger(value.sourceByteLength)
    || value.sourceByteLength > STUDIO_BG3D_OBJ_WORKER_MAX_OBJ_BYTES
    || !(value.bytes instanceof ArrayBuffer)
    || value.bytes.byteLength !== value.sourceByteLength
    || !Array.isArray(value.materialLibraries)
    || value.materialLibraries.length > STUDIO_BG3D_OBJ_WORKER_MAX_MATERIAL_LIBRARIES
    || !isSortedUniqueCanonicalPaths(value.resourcePaths)
    || !isExactBudgets(value.budgets)
  ) return false;

  const resourcePaths = new Set(value.resourcePaths);
  if (!resourcePaths.has(value.primaryPath)) return false;
  const buffers = new Set<ArrayBuffer>([value.bytes]);
  let totalMtlBytes = 0;
  let previousPath: string | null = null;
  for (const entry of value.materialLibraries) {
    if (!isMtlEntry(entry)) return false;
    if (previousPath !== null && compareUtf8(previousPath, entry.path) >= 0) return false;
    if (!resourcePaths.has(entry.path) || buffers.has(entry.bytes)) return false;
    previousPath = entry.path;
    buffers.add(entry.bytes);
    totalMtlBytes += entry.sourceByteLength;
    if (!Number.isSafeInteger(totalMtlBytes) || totalMtlBytes > STUDIO_BG3D_OBJ_WORKER_MAX_MTL_BYTES) {
      return false;
    }
  }
  return true;
}

function isExactNumberTuple(value: unknown, length: 2 | 3, minimum: number, maximum: number): boolean {
  return Array.isArray(value)
    && value.length === length
    && value.every((candidate) => isBoundedFinite(candidate, minimum, maximum));
}

function isAttribute(
  value: unknown,
  vertexCount: number,
  buffers: Set<ArrayBuffer>,
): value is StudioBg3dObjWorkerAttribute {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["name", "itemSize", "count", "normalized", "arrayType", "buffer"])
    || !ATTRIBUTE_ORDER.includes(value.name as StudioBg3dObjWorkerAttributeName)
    || value.itemSize !== ATTRIBUTE_ITEM_SIZE[value.name as StudioBg3dObjWorkerAttributeName]
    || value.count !== vertexCount
    || value.normalized !== false
    || value.arrayType !== "float32"
    || !(value.buffer instanceof ArrayBuffer)
    || buffers.has(value.buffer)
    || value.buffer.byteLength !== vertexCount * (value.itemSize as number) * Float32Array.BYTES_PER_ELEMENT
  ) return false;
  const numbers = new Float32Array(value.buffer);
  for (let index = 0; index < numbers.length; index += 1) {
    if (!Number.isFinite(numbers[index])) return false;
  }
  buffers.add(value.buffer);
  return true;
}

function isTextureBinding(
  value: unknown,
  usedResourcePaths: ReadonlySet<string>,
): value is StudioBg3dObjWorkerTextureBinding {
  return isRecord(value)
    && hasExactKeys(value, [
      "slot",
      "resourcePath",
      "offset",
      "repeat",
      "bumpScale",
      "displacementBias",
      "displacementScale",
    ])
    && TEXTURE_SLOT_ORDER.includes(value.slot as StudioBg3dObjWorkerTextureSlot)
    && isCanonicalStudioBg3dObjResourcePath(value.resourcePath)
    && usedResourcePaths.has(value.resourcePath)
    && ["png", "jpg", "jpeg", "webp"].includes(extensionOf(value.resourcePath))
    && isExactNumberTuple(
      value.offset,
      2,
      -MAX_CANONICAL_SCALAR_MAGNITUDE,
      MAX_CANONICAL_SCALAR_MAGNITUDE,
    )
    && isExactNumberTuple(
      value.repeat,
      2,
      -MAX_CANONICAL_SCALAR_MAGNITUDE,
      MAX_CANONICAL_SCALAR_MAGNITUDE,
    )
    && isBoundedFinite(
      value.bumpScale,
      -MAX_CANONICAL_SCALAR_MAGNITUDE,
      MAX_CANONICAL_SCALAR_MAGNITUDE,
    )
    && isBoundedFinite(
      value.displacementBias,
      -MAX_CANONICAL_SCALAR_MAGNITUDE,
      MAX_CANONICAL_SCALAR_MAGNITUDE,
    )
    && isBoundedFinite(
      value.displacementScale,
      -MAX_CANONICAL_SCALAR_MAGNITUDE,
      MAX_CANONICAL_SCALAR_MAGNITUDE,
    );
}

function isMaterial(
  value: unknown,
  usedResourcePaths: ReadonlySet<string>,
): value is StudioBg3dObjWorkerMaterial {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "name",
      "sourceMtlPath",
      "synthesized",
      "ambient",
      "diffuse",
      "specular",
      "emissive",
      "shininess",
      "opacity",
      "textures",
    ])
    || !isCanonicalLabel(value.name)
    || (
      value.sourceMtlPath !== null
      && (
        !isCanonicalStudioBg3dObjResourcePath(value.sourceMtlPath)
        || extensionOf(value.sourceMtlPath) !== "mtl"
        || !usedResourcePaths.has(value.sourceMtlPath)
      )
    )
    || typeof value.synthesized !== "boolean"
    || (value.synthesized && value.sourceMtlPath !== null)
    || !isExactNumberTuple(value.ambient, 3, 0, 1)
    || !isExactNumberTuple(value.diffuse, 3, 0, 1)
    || !isExactNumberTuple(value.specular, 3, 0, 1)
    || !isExactNumberTuple(value.emissive, 3, 0, 1)
    || !isBoundedFinite(value.shininess, 0, 1_000)
    || !isBoundedFinite(value.opacity, 0, 1)
    || !Array.isArray(value.textures)
    || value.textures.length > TEXTURE_SLOT_ORDER.length
  ) return false;
  let previousOrder = -1;
  for (const texture of value.textures) {
    if (!isTextureBinding(texture, usedResourcePaths)) return false;
    const order = TEXTURE_SLOT_ORDER.indexOf(texture.slot);
    if (order <= previousOrder) return false;
    previousOrder = order;
  }
  return true;
}

interface RenderableValidationMetrics {
  readonly outputBytes: number;
  readonly triangles: number;
  readonly vertices: number;
  readonly materialSlots: number;
  readonly usedMaterialIndices: ReadonlySet<number>;
}

function validateRenderable(
  value: unknown,
  materials: readonly StudioBg3dObjWorkerMaterial[],
  buffers: Set<ArrayBuffer>,
): RenderableValidationMetrics | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "kind",
      "name",
      "vertexCount",
      "attributes",
      "groups",
      "materialSlots",
    ])
    || (value.kind !== "mesh" && value.kind !== "line-segments" && value.kind !== "points")
    || !isCanonicalLabel(value.name)
    || !isPositiveSafeInteger(value.vertexCount)
    || value.vertexCount > STUDIO_BG3D_OBJ_WORKER_MAX_VERTICES
    || !Array.isArray(value.attributes)
    || value.attributes.length < 1
    || value.attributes.length > ATTRIBUTE_ORDER.length
    || !Array.isArray(value.groups)
    || value.groups.length < 1
    || !Array.isArray(value.materialSlots)
    || value.materialSlots.length < 1
    || value.materialSlots.length > STUDIO_BG3D_OBJ_WORKER_MAX_MATERIAL_SLOTS
  ) return null;

  if (value.kind === "mesh" && value.vertexCount % 3 !== 0) return null;
  if (value.kind === "line-segments" && value.vertexCount % 2 !== 0) return null;

  let previousAttributeOrder = -1;
  let outputBytes = 0;
  let hasPosition = false;
  let hasColor = false;
  for (const attribute of value.attributes) {
    if (!isAttribute(attribute, value.vertexCount, buffers)) return null;
    const order = ATTRIBUTE_ORDER.indexOf(attribute.name);
    if (order <= previousAttributeOrder) return null;
    previousAttributeOrder = order;
    outputBytes += attribute.buffer.byteLength;
    if (!Number.isSafeInteger(outputBytes) || outputBytes > STUDIO_BG3D_OBJ_WORKER_MAX_OUTPUT_BYTES) {
      return null;
    }
    if (attribute.name === "position") hasPosition = true;
    if (attribute.name === "color") hasColor = true;
  }
  if (!hasPosition) return null;

  const usedMaterialIndices = new Set<number>();
  for (const slot of value.materialSlots) {
    if (
      !isRecord(slot)
      || !hasExactKeys(slot, ["name", "canonicalMaterialIndex", "flatShading", "vertexColors"])
      || !isCanonicalLabel(slot.name)
      || !isNonNegativeSafeInteger(slot.canonicalMaterialIndex)
      || slot.canonicalMaterialIndex >= materials.length
      || materials[slot.canonicalMaterialIndex]?.name !== slot.name
      || typeof slot.flatShading !== "boolean"
      || typeof slot.vertexColors !== "boolean"
      || slot.vertexColors !== hasColor
    ) return null;
    usedMaterialIndices.add(slot.canonicalMaterialIndex);
  }

  let nextStart = 0;
  for (const group of value.groups) {
    if (
      !isRecord(group)
      || !hasExactKeys(group, ["start", "count", "materialIndex"])
      || !isNonNegativeSafeInteger(group.start)
      || !isPositiveSafeInteger(group.count)
      || !isNonNegativeSafeInteger(group.materialIndex)
      || group.materialIndex >= value.materialSlots.length
      || group.start !== nextStart
      || group.start + group.count > value.vertexCount
      || (value.kind === "mesh" && (group.start % 3 !== 0 || group.count % 3 !== 0))
      || (value.kind === "line-segments" && (group.start % 2 !== 0 || group.count % 2 !== 0))
    ) return null;
    nextStart = group.start + group.count;
  }
  if (nextStart !== value.vertexCount) return null;

  return {
    outputBytes,
    triangles: value.kind === "mesh" ? value.vertexCount / 3 : 0,
    vertices: value.vertexCount,
    materialSlots: value.materialSlots.length,
    usedMaterialIndices,
  };
}

function isMetrics(
  value: unknown,
  expected: StudioBg3dObjWorkerMetrics,
): value is StudioBg3dObjWorkerMetrics {
  return isRecord(value)
    && hasExactKeys(value, [
      "nodes",
      "meshes",
      "vertices",
      "triangles",
      "outputBytes",
      "materials",
      "materialSlots",
      "usedResources",
    ])
    && value.nodes === expected.nodes
    && value.meshes === expected.meshes
    && value.vertices === expected.vertices
    && value.triangles === expected.triangles
    && value.outputBytes === expected.outputBytes
    && value.materials === expected.materials
    && value.materialSlots === expected.materialSlots
    && value.usedResources === expected.usedResources;
}

function isCanonicalResult(value: unknown): value is StudioBg3dObjWorkerCanonicalResult {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "primaryPath",
      "nodes",
      "renderables",
      "materials",
      "usedResourcePaths",
      "metrics",
    ])
    || !isCanonicalStudioBg3dObjResourcePath(value.primaryPath)
    || extensionOf(value.primaryPath) !== "obj"
    || !Array.isArray(value.nodes)
    || value.nodes.length < 1
    || value.nodes.length > STUDIO_BG3D_OBJ_WORKER_MAX_NODES
    || !Array.isArray(value.renderables)
    || value.renderables.length < 1
    || value.renderables.length > STUDIO_BG3D_OBJ_WORKER_MAX_MESHES
    || !Array.isArray(value.materials)
    || value.materials.length < 1
    || value.materials.length > STUDIO_BG3D_OBJ_WORKER_MAX_MATERIALS
    || !isSortedUniqueCanonicalPaths(value.usedResourcePaths)
    || !value.usedResourcePaths.includes(value.primaryPath)
  ) return false;

  const usedResourcePaths = new Set(value.usedResourcePaths);
  for (const material of value.materials) {
    if (!isMaterial(material, usedResourcePaths)) return false;
  }

  const buffers = new Set<ArrayBuffer>();
  const usedMaterials = new Set<number>();
  let vertices = 0;
  let triangles = 0;
  let outputBytes = 0;
  let materialSlots = 0;
  for (const renderable of value.renderables) {
    const measured = validateRenderable(renderable, value.materials, buffers);
    if (!measured) return false;
    vertices += measured.vertices;
    triangles += measured.triangles;
    outputBytes += measured.outputBytes;
    materialSlots += measured.materialSlots;
    for (const index of measured.usedMaterialIndices) usedMaterials.add(index);
    if (
      !Number.isSafeInteger(vertices)
      || vertices > STUDIO_BG3D_OBJ_WORKER_MAX_VERTICES
      || !Number.isSafeInteger(triangles)
      || triangles > STUDIO_BG3D_OBJ_WORKER_MAX_TRIANGLES
      || !Number.isSafeInteger(outputBytes)
      || outputBytes > STUDIO_BG3D_OBJ_WORKER_MAX_OUTPUT_BYTES
      || !Number.isSafeInteger(materialSlots)
      || materialSlots > STUDIO_BG3D_OBJ_WORKER_MAX_MATERIAL_SLOTS
    ) return false;
  }
  if (usedMaterials.size !== value.materials.length) return false;

  const referencedRenderables = new Set<number>();
  for (let index = 0; index < value.nodes.length; index += 1) {
    const node = value.nodes[index];
    if (
      !isRecord(node)
      || !hasExactKeys(node, ["name", "parentIndex", "renderableIndex"])
      || !isCanonicalLabel(node.name)
      || (
        node.parentIndex !== null
        && (!isNonNegativeSafeInteger(node.parentIndex) || node.parentIndex >= index)
      )
      || (
        node.renderableIndex !== null
        && (
          !isNonNegativeSafeInteger(node.renderableIndex)
          || node.renderableIndex >= value.renderables.length
          || referencedRenderables.has(node.renderableIndex)
        )
      )
    ) return false;
    if (node.renderableIndex !== null) referencedRenderables.add(node.renderableIndex);
  }
  if (referencedRenderables.size !== value.renderables.length) return false;

  return isMetrics(value.metrics, {
    nodes: value.nodes.length,
    meshes: value.renderables.length,
    vertices,
    triangles,
    outputBytes,
    materials: value.materials.length,
    materialSlots,
    usedResources: value.usedResourcePaths.length,
  });
}

function isResponseIdentity(value: Record<string, unknown>): boolean {
  return value.version === STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION
    && isPositiveSafeInteger(value.requestId)
    && isPositiveSafeInteger(value.generationId);
}

export function isStudioBg3dObjWorkerResponse(value: unknown): value is StudioBg3dObjWorkerResponse {
  if (!isRecord(value) || !isResponseIdentity(value)) return false;
  if (value.kind === "progress") {
    return hasExactKeys(value, ["version", "kind", "requestId", "generationId", "stage", "progress"])
      && PROGRESS_STAGES.has(value.stage as StudioBg3dObjWorkerProgressStage)
      && isBoundedFinite(value.progress, 0, 1);
  }
  if (value.kind === "error") {
    return hasExactKeys(value, ["version", "kind", "requestId", "generationId", "code"])
      && FAILURE_CODES.has(value.code as StudioBg3dObjWorkerFailureCode);
  }
  if (value.kind === "result") {
    return hasExactKeys(value, ["version", "kind", "requestId", "generationId", "result"])
      && isCanonicalResult(value.result);
  }
  return false;
}

/** Binds an otherwise valid response to the exact request and selected resource catalog. */
export function isStudioBg3dObjWorkerResponseForRequest(
  value: unknown,
  request: StudioBg3dObjWorkerRequest,
): value is StudioBg3dObjWorkerResponse {
  if (!isStudioBg3dObjWorkerRequest(request) || !isStudioBg3dObjWorkerResponse(value)) return false;
  if (value.requestId !== request.requestId || value.generationId !== request.generationId) return false;
  if (value.kind !== "result") return true;
  if (value.result.primaryPath !== request.primaryPath) return false;
  const catalog = new Set(request.resourcePaths);
  if (value.result.usedResourcePaths.some((path) => !catalog.has(path))) return false;
  const materialPaths = new Set(request.materialLibraries.map((entry) => entry.path));
  return value.result.materials.every((material) =>
    material.sourceMtlPath === null || materialPaths.has(material.sourceMtlPath));
}

/** Exact, duplicate-free transfer list for a validated parse request. */
export function studioBg3dObjWorkerRequestTransfers(
  request: StudioBg3dObjWorkerRequest,
): ArrayBuffer[] {
  if (!isStudioBg3dObjWorkerRequest(request)) {
    throw new TypeError("Invalid Studio OBJ Worker request");
  }
  return [request.bytes, ...request.materialLibraries.map((entry) => entry.bytes)];
}

/** Exact, duplicate-free transfer list for a validated result; progress/error responses transfer nothing. */
export function studioBg3dObjWorkerResponseTransfers(
  response: StudioBg3dObjWorkerResponse,
): ArrayBuffer[] {
  if (!isStudioBg3dObjWorkerResponse(response)) {
    throw new TypeError("Invalid Studio OBJ Worker response");
  }
  if (response.kind !== "result") return [];
  return response.result.renderables.flatMap((renderable) =>
    renderable.attributes.map((attribute) => attribute.buffer));
}
