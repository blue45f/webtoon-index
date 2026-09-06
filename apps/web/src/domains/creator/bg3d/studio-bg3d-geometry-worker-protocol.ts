export const STUDIO_BG3D_GEOMETRY_WORKER_PROTOCOL_VERSION = 1 as const;

export const STUDIO_BG3D_GEOMETRY_WORKER_MAX_INPUT_BYTES = 32 * 1024 * 1024;
export const STUDIO_BG3D_GEOMETRY_WORKER_MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
export const STUDIO_BG3D_GEOMETRY_WORKER_MAX_VERTICES = 4_000_000;
export const STUDIO_BG3D_GEOMETRY_WORKER_MAX_TRIANGLES = 2_000_000;
export const STUDIO_BG3D_GEOMETRY_WORKER_MAX_ATTRIBUTES = 4;

export type StudioBg3dGeometryWorkerFormat = "ply" | "stl";
export type StudioBg3dGeometryWorkerStage = "parsing" | "canonicalizing";
export type StudioBg3dCanonicalGeometryKind = "mesh" | "points";
export type StudioBg3dCanonicalGeometryAttributeName = "position" | "normal" | "color" | "uv";

export type StudioBg3dGeometryWorkerFailureCode =
  | "geometry-memory-too-large"
  | "parse-failed"
  | "triangle-budget-exceeded"
  | "vertex-budget-exceeded";

export interface StudioBg3dGeometryWorkerBudgets {
  readonly maxOutputBytes: number;
  readonly maxTriangles: number;
  readonly maxVertices: number;
}

export interface StudioBg3dGeometryWorkerParseRequest {
  readonly version: typeof STUDIO_BG3D_GEOMETRY_WORKER_PROTOCOL_VERSION;
  readonly kind: "parse";
  readonly requestId: number;
  readonly generationId: number;
  readonly format: StudioBg3dGeometryWorkerFormat;
  readonly sourceByteLength: number;
  readonly bytes: ArrayBuffer;
  readonly budgets: StudioBg3dGeometryWorkerBudgets;
}

export type StudioBg3dGeometryWorkerRequest = StudioBg3dGeometryWorkerParseRequest;

export interface StudioBg3dCanonicalGeometryAttribute {
  readonly name: StudioBg3dCanonicalGeometryAttributeName;
  readonly itemSize: 2 | 3;
  readonly count: number;
  readonly normalized: false;
  readonly arrayType: "float32";
  readonly buffer: ArrayBuffer;
}

export interface StudioBg3dCanonicalGeometryIndex {
  readonly count: number;
  readonly arrayType: "uint32";
  readonly buffer: ArrayBuffer;
}

export interface StudioBg3dCanonicalGeometryPayload {
  readonly format: StudioBg3dGeometryWorkerFormat;
  readonly kind: StudioBg3dCanonicalGeometryKind;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly byteLength: number;
  readonly attributes: readonly StudioBg3dCanonicalGeometryAttribute[];
  readonly index: StudioBg3dCanonicalGeometryIndex | null;
}

export interface StudioBg3dGeometryWorkerProgressResponse {
  readonly version: typeof STUDIO_BG3D_GEOMETRY_WORKER_PROTOCOL_VERSION;
  readonly kind: "progress";
  readonly requestId: number;
  readonly generationId: number;
  readonly stage: StudioBg3dGeometryWorkerStage;
  readonly progress: number;
}

export interface StudioBg3dGeometryWorkerResultResponse {
  readonly version: typeof STUDIO_BG3D_GEOMETRY_WORKER_PROTOCOL_VERSION;
  readonly kind: "result";
  readonly requestId: number;
  readonly generationId: number;
  readonly result: StudioBg3dCanonicalGeometryPayload;
}

export interface StudioBg3dGeometryWorkerErrorResponse {
  readonly version: typeof STUDIO_BG3D_GEOMETRY_WORKER_PROTOCOL_VERSION;
  readonly kind: "error";
  readonly requestId: number;
  readonly generationId: number;
  readonly code: StudioBg3dGeometryWorkerFailureCode;
}

export type StudioBg3dGeometryWorkerResponse =
  | StudioBg3dGeometryWorkerProgressResponse
  | StudioBg3dGeometryWorkerResultResponse
  | StudioBg3dGeometryWorkerErrorResponse;

const ATTRIBUTE_ORDER: readonly StudioBg3dCanonicalGeometryAttributeName[] = [
  "position",
  "normal",
  "color",
  "uv",
];
const ATTRIBUTE_ITEM_SIZES: Readonly<Record<StudioBg3dCanonicalGeometryAttributeName, 2 | 3>> = {
  position: 3,
  normal: 3,
  color: 3,
  uv: 2,
};
const FAILURE_CODES = new Set<StudioBg3dGeometryWorkerFailureCode>([
  "geometry-memory-too-large",
  "parse-failed",
  "triangle-budget-exceeded",
  "vertex-budget-exceeded",
]);
const STAGES = new Set<StudioBg3dGeometryWorkerStage>(["parsing", "canonicalizing"]);

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

function isFormat(value: unknown): value is StudioBg3dGeometryWorkerFormat {
  return value === "ply" || value === "stl";
}

function isExactBudgets(value: unknown): value is StudioBg3dGeometryWorkerBudgets {
  return isRecord(value)
    && hasExactKeys(value, ["maxOutputBytes", "maxTriangles", "maxVertices"])
    && value.maxOutputBytes === STUDIO_BG3D_GEOMETRY_WORKER_MAX_OUTPUT_BYTES
    && value.maxTriangles === STUDIO_BG3D_GEOMETRY_WORKER_MAX_TRIANGLES
    && value.maxVertices === STUDIO_BG3D_GEOMETRY_WORKER_MAX_VERTICES;
}

export function isStudioBg3dGeometryWorkerRequest(
  value: unknown,
): value is StudioBg3dGeometryWorkerRequest {
  return isRecord(value)
    && hasExactKeys(value, [
      "version",
      "kind",
      "requestId",
      "generationId",
      "format",
      "sourceByteLength",
      "bytes",
      "budgets",
    ])
    && value.version === STUDIO_BG3D_GEOMETRY_WORKER_PROTOCOL_VERSION
    && value.kind === "parse"
    && isPositiveSafeInteger(value.requestId)
    && isPositiveSafeInteger(value.generationId)
    && isFormat(value.format)
    && isPositiveSafeInteger(value.sourceByteLength)
    && value.sourceByteLength <= STUDIO_BG3D_GEOMETRY_WORKER_MAX_INPUT_BYTES
    && value.bytes instanceof ArrayBuffer
    && value.bytes.byteLength === value.sourceByteLength
    && isExactBudgets(value.budgets);
}

function isCanonicalAttributeShape(
  value: unknown,
  vertexCount: number,
): value is StudioBg3dCanonicalGeometryAttribute {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["name", "itemSize", "count", "normalized", "arrayType", "buffer"])
    || !ATTRIBUTE_ORDER.includes(value.name as StudioBg3dCanonicalGeometryAttributeName)
    || value.itemSize !== ATTRIBUTE_ITEM_SIZES[value.name as StudioBg3dCanonicalGeometryAttributeName]
    || value.count !== vertexCount
    || value.normalized !== false
    || value.arrayType !== "float32"
    || !(value.buffer instanceof ArrayBuffer)
  ) return false;
  return value.buffer.byteLength === vertexCount * (value.itemSize as number) * Float32Array.BYTES_PER_ELEMENT;
}

function isCanonicalIndexShape(
  value: unknown,
  triangleCount: number,
): value is StudioBg3dCanonicalGeometryIndex {
  return isRecord(value)
    && hasExactKeys(value, ["count", "arrayType", "buffer"])
    && isPositiveSafeInteger(value.count)
    && value.count === triangleCount * 3
    && value.arrayType === "uint32"
    && value.buffer instanceof ArrayBuffer
    && value.buffer.byteLength === value.count * Uint32Array.BYTES_PER_ELEMENT;
}

/**
 * Validates the immutable envelope and every transferred buffer length. Numeric payload contents
 * are intentionally rechecked separately in the receiving realm before Three.js sees them.
 */
export function isStudioBg3dCanonicalGeometryPayload(
  value: unknown,
  expectedFormat?: StudioBg3dGeometryWorkerFormat,
): value is StudioBg3dCanonicalGeometryPayload {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "format",
      "kind",
      "vertexCount",
      "triangleCount",
      "byteLength",
      "attributes",
      "index",
    ])
    || !isFormat(value.format)
    || (expectedFormat !== undefined && value.format !== expectedFormat)
    || (value.kind !== "mesh" && value.kind !== "points")
    || !isPositiveSafeInteger(value.vertexCount)
    || value.vertexCount > STUDIO_BG3D_GEOMETRY_WORKER_MAX_VERTICES
    || !isNonNegativeSafeInteger(value.triangleCount)
    || value.triangleCount > STUDIO_BG3D_GEOMETRY_WORKER_MAX_TRIANGLES
    || !isPositiveSafeInteger(value.byteLength)
    || value.byteLength > STUDIO_BG3D_GEOMETRY_WORKER_MAX_OUTPUT_BYTES
    || !Array.isArray(value.attributes)
    || value.attributes.length < 1
    || value.attributes.length > STUDIO_BG3D_GEOMETRY_WORKER_MAX_ATTRIBUTES
  ) return false;

  const names = new Set<string>();
  let previousOrder = -1;
  let measuredByteLength = 0;
  for (const attribute of value.attributes) {
    if (!isCanonicalAttributeShape(attribute, value.vertexCount)) return false;
    const order = ATTRIBUTE_ORDER.indexOf(attribute.name);
    if (order <= previousOrder || names.has(attribute.name)) return false;
    previousOrder = order;
    names.add(attribute.name);
    measuredByteLength += attribute.buffer.byteLength;
  }
  if (!names.has("position")) return false;

  if (value.kind === "points") {
    if (value.index !== null || value.triangleCount !== 0 || names.has("normal")) return false;
  } else if (value.index === null) {
    if (value.vertexCount % 3 !== 0 || value.triangleCount !== value.vertexCount / 3) return false;
  } else {
    if (!isCanonicalIndexShape(value.index, value.triangleCount)) return false;
    measuredByteLength += value.index.buffer.byteLength;
  }

  return measuredByteLength === value.byteLength
    && measuredByteLength <= STUDIO_BG3D_GEOMETRY_WORKER_MAX_OUTPUT_BYTES;
}

/** Main-realm hostile-output check. This is linear but allocation-free. */
export function hasValidStudioBg3dCanonicalGeometryNumbers(
  payload: StudioBg3dCanonicalGeometryPayload,
): boolean {
  const position = payload.attributes.find((attribute) => attribute.name === "position");
  if (!position) return false;
  for (const attribute of payload.attributes) {
    const values = new Float32Array(attribute.buffer);
    for (let index = 0; index < values.length; index += 1) {
      if (!Number.isFinite(values[index])) return false;
    }
  }
  if (payload.index) {
    const indices = new Uint32Array(payload.index.buffer);
    for (let index = 0; index < indices.length; index += 1) {
      if ((indices[index] ?? payload.vertexCount) >= payload.vertexCount) return false;
    }
  }
  return true;
}

function isWorkerIdentity(value: Record<string, unknown>): boolean {
  return value.version === STUDIO_BG3D_GEOMETRY_WORKER_PROTOCOL_VERSION
    && isPositiveSafeInteger(value.requestId)
    && isPositiveSafeInteger(value.generationId);
}

export function isStudioBg3dGeometryWorkerResponse(
  value: unknown,
): value is StudioBg3dGeometryWorkerResponse {
  if (!isRecord(value) || !isWorkerIdentity(value)) return false;
  if (value.kind === "progress") {
    return hasExactKeys(value, ["version", "kind", "requestId", "generationId", "stage", "progress"])
      && STAGES.has(value.stage as StudioBg3dGeometryWorkerStage)
      && typeof value.progress === "number"
      && Number.isFinite(value.progress)
      && value.progress >= 0
      && value.progress < 1;
  }
  if (value.kind === "error") {
    return hasExactKeys(value, ["version", "kind", "requestId", "generationId", "code"])
      && FAILURE_CODES.has(value.code as StudioBg3dGeometryWorkerFailureCode);
  }
  return value.kind === "result"
    && hasExactKeys(value, ["version", "kind", "requestId", "generationId", "result"])
    && isStudioBg3dCanonicalGeometryPayload(value.result);
}

export function studioBg3dGeometryWorkerRequestTransfers(
  request: StudioBg3dGeometryWorkerRequest,
): Transferable[] {
  return [request.bytes];
}

export function studioBg3dGeometryWorkerResponseTransfers(
  response: StudioBg3dGeometryWorkerResponse,
): Transferable[] {
  if (response.kind !== "result") return [];
  const transfers: Transferable[] = response.result.attributes.map((attribute) => attribute.buffer);
  if (response.result.index) transfers.push(response.result.index.buffer);
  return transfers;
}
