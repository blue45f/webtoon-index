/**
 * Transfer-only boundary for the cheap-but-linear OBJ/MTL admission scan.
 *
 * The importer needs OBJ `mtllib` references before it can resolve companion files. Keeping that
 * discovery on the main thread meant decoding and scanning as much as 48 MiB immediately before
 * the dedicated OBJ parser repeated the work. This protocol moves only the discovery/admission
 * pass off-thread and returns ownership of the original buffers for the canonical parser Worker.
 */

export const STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION = 1 as const;

export const STUDIO_BG3D_OBJ_PREFLIGHT_MAX_OBJ_BYTES = 32 * 1024 * 1024;
export const STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MTL_BYTES = 16 * 1024 * 1024;
export const STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MATERIAL_LIBRARIES = 64;
export const STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MTL_REFERENCE_DIRECTIVES = 256;
export const STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MTL_DIRECTIVES = 65_536;
export const STUDIO_BG3D_OBJ_PREFLIGHT_MAX_VERTICES = 4_000_000;
export const STUDIO_BG3D_OBJ_PREFLIGHT_MAX_TRIANGLES = 2_000_000;
export const STUDIO_BG3D_OBJ_PREFLIGHT_MAX_NODES = 2_048;
export const STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MESH_PRIMITIVES = 2_048;
export const STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MATERIALS = 1_024;
export const STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MATERIAL_SLOTS = 4_096;

const MAX_PATH_LENGTH = 1_024;
const MAX_REFERENCE_LENGTH = 1_024;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/iu;

export interface StudioBg3dObjPreflightWorkerBudgets {
  readonly maxObjBytes: typeof STUDIO_BG3D_OBJ_PREFLIGHT_MAX_OBJ_BYTES;
  readonly maxMtlBytes: typeof STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MTL_BYTES;
  readonly maxMaterialLibraries: typeof STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MATERIAL_LIBRARIES;
  readonly maxMtlReferenceDirectives:
    typeof STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MTL_REFERENCE_DIRECTIVES;
  readonly maxMtlDirectives: typeof STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MTL_DIRECTIVES;
  readonly maxVertices: typeof STUDIO_BG3D_OBJ_PREFLIGHT_MAX_VERTICES;
  readonly maxTriangles: typeof STUDIO_BG3D_OBJ_PREFLIGHT_MAX_TRIANGLES;
  readonly maxNodes: typeof STUDIO_BG3D_OBJ_PREFLIGHT_MAX_NODES;
  readonly maxMeshPrimitives: typeof STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MESH_PRIMITIVES;
  readonly maxMaterials: typeof STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MATERIALS;
  readonly maxMaterialSlots: typeof STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MATERIAL_SLOTS;
}

export const STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_BUDGETS:
StudioBg3dObjPreflightWorkerBudgets = Object.freeze({
  maxObjBytes: STUDIO_BG3D_OBJ_PREFLIGHT_MAX_OBJ_BYTES,
  maxMtlBytes: STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MTL_BYTES,
  maxMaterialLibraries: STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MATERIAL_LIBRARIES,
  maxMtlReferenceDirectives: STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MTL_REFERENCE_DIRECTIVES,
  maxMtlDirectives: STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MTL_DIRECTIVES,
  maxVertices: STUDIO_BG3D_OBJ_PREFLIGHT_MAX_VERTICES,
  maxTriangles: STUDIO_BG3D_OBJ_PREFLIGHT_MAX_TRIANGLES,
  maxNodes: STUDIO_BG3D_OBJ_PREFLIGHT_MAX_NODES,
  maxMeshPrimitives: STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MESH_PRIMITIVES,
  maxMaterials: STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MATERIALS,
  maxMaterialSlots: STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MATERIAL_SLOTS,
});

export interface StudioBg3dObjPreflightWorkerMtlEntry {
  readonly path: string;
  readonly sourceByteLength: number;
  readonly bytes: ArrayBuffer;
}

export interface StudioBg3dObjPreflightWorkerObjRequest {
  readonly version: typeof STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION;
  readonly kind: "preflight-obj";
  readonly requestId: number;
  readonly generationId: number;
  readonly sourceByteLength: number;
  readonly bytes: ArrayBuffer;
  readonly budgets: StudioBg3dObjPreflightWorkerBudgets;
}

export interface StudioBg3dObjPreflightWorkerMtlRequest {
  readonly version: typeof STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION;
  readonly kind: "preflight-mtl";
  readonly requestId: number;
  readonly generationId: number;
  /** Canonical-path sorted, unique material libraries. */
  readonly materialLibraries: readonly StudioBg3dObjPreflightWorkerMtlEntry[];
  readonly budgets: StudioBg3dObjPreflightWorkerBudgets;
}

export type StudioBg3dObjPreflightWorkerRequest =
  | StudioBg3dObjPreflightWorkerObjRequest
  | StudioBg3dObjPreflightWorkerMtlRequest;

export interface StudioBg3dObjPreflightMetrics {
  readonly sourceVertices: number;
  readonly sourceAttributeRecords: number;
  readonly expandedVertices: number;
  readonly triangles: number;
  readonly objectNodes: number;
  readonly materialSections: number;
  readonly materialLibraryDirectives: number;
}

export interface StudioBg3dMtlPreflightMetrics {
  readonly directives: number;
  readonly materials: number;
  readonly textureSlots: number;
}

export interface StudioBg3dObjPreflightWorkerObjResult {
  readonly kind: "obj";
  readonly sourceByteLength: number;
  /** Ownership is returned so the importer can transfer the same allocation to the parser Worker. */
  readonly bytes: ArrayBuffer;
  readonly materialLibraryReferences: readonly string[];
  readonly metrics: StudioBg3dObjPreflightMetrics;
}

export interface StudioBg3dObjPreflightWorkerMtlResult {
  readonly kind: "mtl";
  /** Ownership is returned so the importer can transfer these allocations to the parser Worker. */
  readonly materialLibraries: readonly StudioBg3dObjPreflightWorkerMtlEntry[];
  readonly metrics: StudioBg3dMtlPreflightMetrics;
}

export type StudioBg3dObjPreflightWorkerResult =
  | StudioBg3dObjPreflightWorkerObjResult
  | StudioBg3dObjPreflightWorkerMtlResult;

export type StudioBg3dObjPreflightWorkerStage = "decoding" | "scanning";

export type StudioBg3dObjPreflightWorkerFailureCode =
  | "invalid-text"
  | "material-budget-exceeded"
  | "mesh-budget-exceeded"
  | "node-budget-exceeded"
  | "parse-failed"
  | "protocol"
  | "triangle-budget-exceeded"
  | "unsafe-resource-uri"
  | "vertex-budget-exceeded";

export interface StudioBg3dObjPreflightWorkerProgressResponse {
  readonly version: typeof STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION;
  readonly kind: "progress";
  readonly requestId: number;
  readonly generationId: number;
  readonly stage: StudioBg3dObjPreflightWorkerStage;
  readonly progress: number;
}

export interface StudioBg3dObjPreflightWorkerResultResponse {
  readonly version: typeof STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION;
  readonly kind: "result";
  readonly requestId: number;
  readonly generationId: number;
  readonly result: StudioBg3dObjPreflightWorkerResult;
}

export interface StudioBg3dObjPreflightWorkerErrorResponse {
  readonly version: typeof STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION;
  readonly kind: "error";
  readonly requestId: number;
  readonly generationId: number;
  readonly code: StudioBg3dObjPreflightWorkerFailureCode;
}

export type StudioBg3dObjPreflightWorkerResponse =
  | StudioBg3dObjPreflightWorkerProgressResponse
  | StudioBg3dObjPreflightWorkerResultResponse
  | StudioBg3dObjPreflightWorkerErrorResponse;

const FAILURE_CODES = new Set<StudioBg3dObjPreflightWorkerFailureCode>([
  "invalid-text",
  "material-budget-exceeded",
  "mesh-budget-exceeded",
  "node-budget-exceeded",
  "parse-failed",
  "protocol",
  "triangle-budget-exceeded",
  "unsafe-resource-uri",
  "vertex-budget-exceeded",
]);
const STAGES = new Set<StudioBg3dObjPreflightWorkerStage>(["decoding", "scanning"]);

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

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point <= 31 || point === 127;
  });
}

function compareUtf8(left: string, right: string): number {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const count = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < count; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function isCanonicalPackagePath(value: unknown): value is string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_PATH_LENGTH
    || value.normalize("NFC") !== value
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

function isMaterialReference(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_REFERENCE_LENGTH
    && !value.startsWith("//")
    && !containsControlCharacter(value)
    && !SCHEME_PATTERN.test(value);
}

function hasExactBudgets(value: unknown): value is StudioBg3dObjPreflightWorkerBudgets {
  return isRecord(value)
    && hasExactKeys(value, [
      "maxObjBytes",
      "maxMtlBytes",
      "maxMaterialLibraries",
      "maxMtlReferenceDirectives",
      "maxMtlDirectives",
      "maxVertices",
      "maxTriangles",
      "maxNodes",
      "maxMeshPrimitives",
      "maxMaterials",
      "maxMaterialSlots",
    ])
    && value.maxObjBytes === STUDIO_BG3D_OBJ_PREFLIGHT_MAX_OBJ_BYTES
    && value.maxMtlBytes === STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MTL_BYTES
    && value.maxMaterialLibraries === STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MATERIAL_LIBRARIES
    && value.maxMtlReferenceDirectives
      === STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MTL_REFERENCE_DIRECTIVES
    && value.maxMtlDirectives === STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MTL_DIRECTIVES
    && value.maxVertices === STUDIO_BG3D_OBJ_PREFLIGHT_MAX_VERTICES
    && value.maxTriangles === STUDIO_BG3D_OBJ_PREFLIGHT_MAX_TRIANGLES
    && value.maxNodes === STUDIO_BG3D_OBJ_PREFLIGHT_MAX_NODES
    && value.maxMeshPrimitives === STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MESH_PRIMITIVES
    && value.maxMaterials === STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MATERIALS
    && value.maxMaterialSlots === STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MATERIAL_SLOTS;
}

function isMtlEntry(value: unknown): value is StudioBg3dObjPreflightWorkerMtlEntry {
  return isRecord(value)
    && hasExactKeys(value, ["path", "sourceByteLength", "bytes"])
    && isCanonicalPackagePath(value.path)
    && isPositiveSafeInteger(value.sourceByteLength)
    && value.bytes instanceof ArrayBuffer
    && value.bytes.byteLength === value.sourceByteLength;
}

function isCanonicalMtlEntries(
  value: unknown,
  maximumBytes: number,
): value is readonly StudioBg3dObjPreflightWorkerMtlEntry[] {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.length > STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MATERIAL_LIBRARIES
  ) return false;
  let totalBytes = 0;
  let previousPath: string | null = null;
  const buffers = new Set<ArrayBuffer>();
  for (const entry of value) {
    if (!isMtlEntry(entry)) return false;
    if (previousPath !== null && compareUtf8(previousPath, entry.path) >= 0) return false;
    if (buffers.has(entry.bytes)) return false;
    buffers.add(entry.bytes);
    previousPath = entry.path;
    if (totalBytes > maximumBytes - entry.sourceByteLength) return false;
    totalBytes += entry.sourceByteLength;
  }
  return totalBytes <= maximumBytes;
}

function hasWorkerIdentity(value: Record<string, unknown>): boolean {
  return value.version === STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION
    && isPositiveSafeInteger(value.requestId)
    && isPositiveSafeInteger(value.generationId);
}

export function isStudioBg3dObjPreflightWorkerRequest(
  value: unknown,
): value is StudioBg3dObjPreflightWorkerRequest {
  if (!isRecord(value) || !hasWorkerIdentity(value) || !hasExactBudgets(value.budgets)) {
    return false;
  }
  if (value.kind === "preflight-obj") {
    return hasExactKeys(value, [
      "version",
      "kind",
      "requestId",
      "generationId",
      "sourceByteLength",
      "bytes",
      "budgets",
    ])
      && isPositiveSafeInteger(value.sourceByteLength)
      && value.sourceByteLength <= STUDIO_BG3D_OBJ_PREFLIGHT_MAX_OBJ_BYTES
      && value.bytes instanceof ArrayBuffer
      && value.bytes.byteLength === value.sourceByteLength;
  }
  return value.kind === "preflight-mtl"
    && hasExactKeys(value, [
      "version",
      "kind",
      "requestId",
      "generationId",
      "materialLibraries",
      "budgets",
    ])
    && isCanonicalMtlEntries(
      value.materialLibraries,
      STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MTL_BYTES,
    );
}

function isObjMetrics(value: unknown): value is StudioBg3dObjPreflightMetrics {
  return isRecord(value)
    && hasExactKeys(value, [
      "sourceVertices",
      "sourceAttributeRecords",
      "expandedVertices",
      "triangles",
      "objectNodes",
      "materialSections",
      "materialLibraryDirectives",
    ])
    && isNonNegativeSafeInteger(value.sourceVertices)
    && value.sourceVertices <= STUDIO_BG3D_OBJ_PREFLIGHT_MAX_VERTICES
    && isNonNegativeSafeInteger(value.sourceAttributeRecords)
    && value.sourceAttributeRecords <= STUDIO_BG3D_OBJ_PREFLIGHT_MAX_VERTICES
    && value.sourceVertices <= value.sourceAttributeRecords
    && isNonNegativeSafeInteger(value.expandedVertices)
    && value.expandedVertices <= STUDIO_BG3D_OBJ_PREFLIGHT_MAX_VERTICES
    && isNonNegativeSafeInteger(value.triangles)
    && value.triangles <= STUDIO_BG3D_OBJ_PREFLIGHT_MAX_TRIANGLES
    && isNonNegativeSafeInteger(value.objectNodes)
    && value.objectNodes <= STUDIO_BG3D_OBJ_PREFLIGHT_MAX_NODES
    && isNonNegativeSafeInteger(value.materialSections)
    && value.materialSections <= STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MESH_PRIMITIVES
    && isNonNegativeSafeInteger(value.materialLibraryDirectives)
    && value.materialLibraryDirectives
      <= STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MTL_REFERENCE_DIRECTIVES;
}

function isMtlMetrics(value: unknown): value is StudioBg3dMtlPreflightMetrics {
  return isRecord(value)
    && hasExactKeys(value, ["directives", "materials", "textureSlots"])
    && isNonNegativeSafeInteger(value.directives)
    && value.directives <= STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MTL_DIRECTIVES
    && isNonNegativeSafeInteger(value.materials)
    && value.materials <= STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MATERIALS
    && isNonNegativeSafeInteger(value.textureSlots)
    && value.textureSlots <= STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MATERIAL_SLOTS;
}

export function isStudioBg3dObjPreflightWorkerResult(
  value: unknown,
): value is StudioBg3dObjPreflightWorkerResult {
  if (!isRecord(value)) return false;
  if (value.kind === "obj") {
    if (
      !hasExactKeys(value, [
        "kind",
        "sourceByteLength",
        "bytes",
        "materialLibraryReferences",
        "metrics",
      ])
      || !isPositiveSafeInteger(value.sourceByteLength)
      || value.sourceByteLength > STUDIO_BG3D_OBJ_PREFLIGHT_MAX_OBJ_BYTES
      || !(value.bytes instanceof ArrayBuffer)
      || value.bytes.byteLength !== value.sourceByteLength
      || !Array.isArray(value.materialLibraryReferences)
      || value.materialLibraryReferences.length
        > STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MATERIAL_LIBRARIES
      || !isObjMetrics(value.metrics)
    ) return false;
    const references = new Set<string>();
    for (const reference of value.materialLibraryReferences) {
      if (!isMaterialReference(reference) || references.has(reference)) return false;
      references.add(reference);
    }
    return true;
  }
  return value.kind === "mtl"
    && hasExactKeys(value, ["kind", "materialLibraries", "metrics"])
    && isCanonicalMtlEntries(
      value.materialLibraries,
      STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MTL_BYTES,
    )
    && isMtlMetrics(value.metrics);
}

export function isStudioBg3dObjPreflightWorkerResponse(
  value: unknown,
): value is StudioBg3dObjPreflightWorkerResponse {
  if (!isRecord(value) || !hasWorkerIdentity(value)) return false;
  if (value.kind === "progress") {
    return hasExactKeys(value, [
      "version",
      "kind",
      "requestId",
      "generationId",
      "stage",
      "progress",
    ])
      && STAGES.has(value.stage as StudioBg3dObjPreflightWorkerStage)
      && typeof value.progress === "number"
      && Number.isFinite(value.progress)
      && value.progress >= 0
      && value.progress < 1;
  }
  if (value.kind === "error") {
    return hasExactKeys(value, [
      "version",
      "kind",
      "requestId",
      "generationId",
      "code",
    ])
      && FAILURE_CODES.has(value.code as StudioBg3dObjPreflightWorkerFailureCode);
  }
  return value.kind === "result"
    && hasExactKeys(value, [
      "version",
      "kind",
      "requestId",
      "generationId",
      "result",
    ])
    && isStudioBg3dObjPreflightWorkerResult(value.result);
}

export function studioBg3dObjPreflightWorkerRequestTransfers(
  request: StudioBg3dObjPreflightWorkerRequest,
): Transferable[] {
  return request.kind === "preflight-obj"
    ? [request.bytes]
    : request.materialLibraries.map((entry) => entry.bytes);
}

export function studioBg3dObjPreflightWorkerResponseTransfers(
  response: StudioBg3dObjPreflightWorkerResponse,
): Transferable[] {
  if (response.kind !== "result") return [];
  return response.result.kind === "obj"
    ? [response.result.bytes]
    : response.result.materialLibraries.map((entry) => entry.bytes);
}
