import { STUDIO_EDITABLE_MESH_LIMITS } from "../studio-editable-half-edge-mesh";

import {
  STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_ISSUE_IDS,
  STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_REPORT_ISSUES,
} from "./studio-hybrid-dcc-glb-export-diagnostic-limits";
import {
  STUDIO_HYBRID_DCC_PACKED_MESH_MAX_BYTES,
  hasValidStudioHybridDccPackedMeshChecksums,
  isStudioHybridDccPackedMeshPayloadEnvelope,
  studioHybridDccPackedMeshPayloadTransfers,
} from "./studio-hybrid-dcc-glb-export-packed-mesh";

import type {
  StudioHybridDccGlbExportMetrics,
  StudioHybridDccGlbExportReport,
  StudioHybridDccGlbIssue,
  StudioHybridDccGlbIssueCode,
} from "./studio-hybrid-dcc-glb-export";
import type { StudioHybridDccPackedMeshPayload } from "./studio-hybrid-dcc-glb-export-packed-mesh";

export const STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_PROTOCOL_VERSION = 2 as const;
export const STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_BATCH = 64;
export const STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_RESPONSE_BYTES = 100 * 1024 * 1024;
export const STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_INPUT_BYTES =
  STUDIO_HYBRID_DCC_PACKED_MESH_MAX_BYTES;
export const STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_TOTAL_VERTICES =
  STUDIO_EDITABLE_MESH_LIMITS.maxVertices;
export const STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_TOTAL_HALF_EDGES =
  STUDIO_EDITABLE_MESH_LIMITS.maxEdges * 2;
export const STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_TOTAL_FACES =
  STUDIO_EDITABLE_MESH_LIMITS.maxFaces;
export const STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_INPUT_TRANSPORT =
  "transferable-packed-soa-v1" as const;

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_MINIMUM_BYTES = 20;
const GLB_MIME_TYPE = "model/gltf-binary";
const EXPORT_FORMAT = "toonspectrum.hybrid-dcc-glb-export";
const EXPORT_REVISION = 1;
const EDITABLE_MESH_REVISION = 1;
const MAX_ISSUE_MESSAGE_LENGTH = 4_096;

const ISSUE_CODES = new Set<StudioHybridDccGlbIssueCode>([
  "invalid-input",
  "invalid-source-id",
  "invalid-source-revision",
  "invalid-source-hash",
  "source-hash-mismatch",
  "authority-not-editable-mesh",
  "mesh-revision-unsupported",
  "mesh-budget-exceeded",
  "empty-mesh",
  "duplicate-stable-id",
  "stable-id-invalid",
  "stable-id-counter-invalid",
  "position-non-finite",
  "position-float32-overflow",
  "crease-invalid",
  "crease-unsupported",
  "face-property-invalid",
  "vertex-half-edge-invalid",
  "half-edge-reference-invalid",
  "half-edge-link-mismatch",
  "half-edge-twin-mismatch",
  "half-edge-face-mismatch",
  "face-loop-open",
  "face-loop-incomplete",
  "face-loop-too-small",
  "face-corner-budget-exceeded",
  "face-loop-duplicate-vertex",
  "edge-zero-length",
  "edge-orientation-mismatch",
  "non-manifold-edge",
  "bow-tie-vertex",
  "isolated-vertex",
  "face-zero-area",
  "face-non-planar",
  "face-self-intersection",
  "face-degenerate-corner",
  "face-collinear-corner-omitted",
  "triangulation-failed",
  "normal-unresolved",
  "index-overflow",
  "material-slot-metadata-only",
  "diagnostic-overflow",
  "container-write-failed",
  "container-validation-failed",
]);

export interface StudioHybridDccGlbExportWorkerRequest {
  readonly version: typeof STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_PROTOCOL_VERSION;
  readonly kind: "export-batch";
  readonly requestId: number;
  readonly inputTransport: typeof STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_INPUT_TRANSPORT;
  readonly payloads: readonly StudioHybridDccPackedMeshPayload[];
  readonly maxResponseBytes: typeof STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_RESPONSE_BYTES;
}

export type StudioHybridDccGlbExportWorkerItemResult =
  | {
      readonly ok: true;
      readonly bytes: ArrayBuffer;
      readonly fileName: string;
      readonly mimeType: typeof GLB_MIME_TYPE;
      readonly metrics: StudioHybridDccGlbExportMetrics;
      readonly report: StudioHybridDccGlbExportReport & { readonly status: "exported" };
    }
  | {
      readonly ok: false;
      readonly report: StudioHybridDccGlbExportReport & { readonly status: "blocked" };
    };

export type StudioHybridDccGlbExportWorkerErrorCode =
  | "export-failed"
  | "protocol"
  | "response-budget-exceeded";

export type StudioHybridDccGlbExportWorkerResponse =
  | {
      readonly version: typeof STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_PROTOCOL_VERSION;
      readonly kind: "result";
      readonly requestId: number;
      readonly results: readonly StudioHybridDccGlbExportWorkerItemResult[];
      readonly totalByteLength: number;
    }
  | {
      readonly version: typeof STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_PROTOCOL_VERSION;
      readonly kind: "error";
      readonly requestId: number;
      readonly code: StudioHybridDccGlbExportWorkerErrorCode;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isSafeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function isBoundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function isWithinCumulativeInputBudget(
  payloads: readonly StudioHybridDccPackedMeshPayload[],
): boolean {
  let vertices = 0;
  let halfEdges = 0;
  let faces = 0;
  let bytes = 0;
  for (const payload of payloads) {
    if (
      payload.manifest.counts.vertices > STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_TOTAL_VERTICES - vertices
      || payload.manifest.counts.halfEdges > STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_TOTAL_HALF_EDGES - halfEdges
      || payload.manifest.counts.faces > STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_TOTAL_FACES - faces
      || payload.buffer.byteLength > STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_INPUT_BYTES - bytes
    ) return false;
    vertices += payload.manifest.counts.vertices;
    halfEdges += payload.manifest.counts.halfEdges;
    faces += payload.manifest.counts.faces;
    bytes += payload.buffer.byteLength;
  }
  return true;
}

export function isStudioHybridDccGlbExportWorkerRequest(
  value: unknown,
): value is StudioHybridDccGlbExportWorkerRequest {
  return isStudioHybridDccGlbExportWorkerRequestEnvelope(value)
    && value.payloads.every(hasValidStudioHybridDccPackedMeshChecksums);
}

export function isStudioHybridDccGlbExportWorkerRequestEnvelope(
  value: unknown,
): value is StudioHybridDccGlbExportWorkerRequest {
  return isRecord(value)
    && hasExactKeys(value, [
      "version",
      "kind",
      "requestId",
      "inputTransport",
      "payloads",
      "maxResponseBytes",
    ])
    && value.version === STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_PROTOCOL_VERSION
    && value.kind === "export-batch"
    && isSafeInteger(value.requestId, 1)
    && value.inputTransport === STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_INPUT_TRANSPORT
    && Array.isArray(value.payloads)
    && value.payloads.length >= 1
    && value.payloads.length <= STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_BATCH
    && value.payloads.every(isStudioHybridDccPackedMeshPayloadEnvelope)
    && isWithinCumulativeInputBudget(value.payloads)
    && value.maxResponseBytes === STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_RESPONSE_BYTES;
}

export function studioHybridDccGlbExportWorkerRequestTransfers(
  request: StudioHybridDccGlbExportWorkerRequest,
): Transferable[] {
  return studioHybridDccPackedMeshPayloadTransfers(request.payloads);
}

function isIssueIdList(value: unknown): value is readonly number[] {
  return Array.isArray(value)
    && value.length <= STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_ISSUE_IDS
    && value.every((entry) => isSafeInteger(entry));
}

function isIssue(value: unknown): value is StudioHybridDccGlbIssue {
  if (!isRecord(value)) return false;
  const optionalKeys = ["vertexIds", "halfEdgeIds", "faceIds"] as const;
  const requiredKeys = ["severity", "code", "message", "detail"] as const;
  if (
    !Object.keys(value).every((key) => [...requiredKeys, ...optionalKeys].includes(key as never))
    || !requiredKeys.every((key) => Object.hasOwn(value, key))
    || (value.severity !== "warning" && value.severity !== "loss" && value.severity !== "error")
    || !ISSUE_CODES.has(value.code as StudioHybridDccGlbIssueCode)
    || !isBoundedString(value.message, 1, MAX_ISSUE_MESSAGE_LENGTH)
    || value.detail !== value.message
  ) return false;
  return optionalKeys.every((key) => value[key] === undefined || isIssueIdList(value[key]));
}

function sameIssue(left: StudioHybridDccGlbIssue, right: StudioHybridDccGlbIssue): boolean {
  if (
    left.severity !== right.severity
    || left.code !== right.code
    || left.message !== right.message
    || left.detail !== right.detail
  ) return false;
  for (const key of ["vertexIds", "halfEdgeIds", "faceIds"] as const) {
    const leftIds = left[key];
    const rightIds = right[key];
    if (leftIds === undefined || rightIds === undefined) {
      if (leftIds !== rightIds) return false;
      continue;
    }
    if (leftIds.length !== rightIds.length || leftIds.some((id, index) => id !== rightIds[index])) {
      return false;
    }
  }
  return true;
}

function isIssueList(value: unknown, severity: StudioHybridDccGlbIssue["severity"]): value is readonly StudioHybridDccGlbIssue[] {
  return Array.isArray(value)
    && value.length <= STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_REPORT_ISSUES
    && value.every((entry) => isIssue(entry) && entry.severity === severity);
}

function isReport(value: unknown, expectedStatus: "blocked" | "exported"): value is StudioHybridDccGlbExportReport {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "format",
      "revision",
      "status",
      "source",
      "errors",
      "losses",
      "warnings",
      "issues",
    ])
    || value.format !== EXPORT_FORMAT
    || value.revision !== EXPORT_REVISION
    || value.status !== expectedStatus
    || !isRecord(value.source)
    || !hasExactKeys(value.source, [
      "authority",
      "assetId",
      "sourceRevision",
      "sourceHash",
      "meshSchemaRevision",
    ])
    || value.source.authority !== "editable-half-edge-mesh"
    || !isBoundedString(value.source.assetId, 0, 160)
    || !isSafeInteger(value.source.sourceRevision)
    || !isBoundedString(value.source.sourceHash, 0, 160)
    || value.source.meshSchemaRevision !== EDITABLE_MESH_REVISION
    || !isIssueList(value.errors, "error")
    || !isIssueList(value.losses, "loss")
    || !isIssueList(value.warnings, "warning")
    || !Array.isArray(value.issues)
    || value.issues.length > STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_REPORT_ISSUES
    || !value.issues.every(isIssue)
    || (expectedStatus === "exported" ? value.errors.length !== 0 : value.errors.length < 1)
  ) return false;
  const errors = value.errors as readonly StudioHybridDccGlbIssue[];
  const losses = value.losses as readonly StudioHybridDccGlbIssue[];
  const warnings = value.warnings as readonly StudioHybridDccGlbIssue[];
  const issues = value.issues as readonly StudioHybridDccGlbIssue[];
  const aggregate = [...errors, ...losses, ...warnings];
  return aggregate.length === issues.length
    && aggregate.every((entry, index) => sameIssue(entry, issues[index]!));
}

const METRIC_KEYS = [
  "sourceVertexCount",
  "sourceHalfEdgeCount",
  "sourceFaceCount",
  "outputVertexCount",
  "triangleCount",
  "vertices",
  "triangles",
  "positionByteLength",
  "normalByteLength",
  "indexByteLength",
  "binaryByteLength",
  "glbByteLength",
] as const;

function isMetrics(value: unknown, glbByteLength: number): value is StudioHybridDccGlbExportMetrics {
  if (
    !isRecord(value)
    || !hasExactKeys(value, METRIC_KEYS)
    || !METRIC_KEYS.every((key) => isSafeInteger(value[key]))
  ) return false;
  const metrics = value as unknown as StudioHybridDccGlbExportMetrics;
  return metrics.sourceVertexCount <= STUDIO_EDITABLE_MESH_LIMITS.maxVertices
    && metrics.sourceHalfEdgeCount <= STUDIO_EDITABLE_MESH_LIMITS.maxEdges * 2
    && metrics.sourceFaceCount <= STUDIO_EDITABLE_MESH_LIMITS.maxFaces
    && metrics.outputVertexCount === metrics.vertices
    && metrics.triangleCount === metrics.triangles
    && metrics.glbByteLength === glbByteLength
    && metrics.positionByteLength + metrics.normalByteLength + metrics.indexByteLength <= metrics.binaryByteLength
    && metrics.binaryByteLength <= metrics.glbByteLength;
}

function isSelfConsistentGlbBuffer(value: ArrayBuffer): boolean {
  if (
    value.byteLength < GLB_MINIMUM_BYTES
    || value.byteLength > STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_RESPONSE_BYTES
  ) return false;
  try {
    const view = new DataView(value);
    return view.getUint32(0, true) === GLB_MAGIC
      && view.getUint32(4, true) === GLB_VERSION
      && view.getUint32(8, true) === value.byteLength;
  } catch {
    return false;
  }
}

export function isStudioHybridDccGlbExportWorkerItemResult(
  value: unknown,
): value is StudioHybridDccGlbExportWorkerItemResult {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  if (!value.ok) {
    return hasExactKeys(value, ["ok", "report"])
      && isReport(value.report, "blocked");
  }
  return hasExactKeys(value, ["ok", "bytes", "fileName", "mimeType", "metrics", "report"])
    && value.bytes instanceof ArrayBuffer
    && isSelfConsistentGlbBuffer(value.bytes)
    && isBoundedString(value.fileName, 1, 255)
    && value.fileName.endsWith(".glb")
    && value.mimeType === GLB_MIME_TYPE
    && isMetrics(value.metrics, value.bytes.byteLength)
    && isReport(value.report, "exported");
}

export function isStudioHybridDccGlbExportWorkerResponse(
  value: unknown,
): value is StudioHybridDccGlbExportWorkerResponse {
  if (
    !isRecord(value)
    || value.version !== STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_PROTOCOL_VERSION
    || !isSafeInteger(value.requestId, 1)
  ) return false;
  if (value.kind === "error") {
    return hasExactKeys(value, ["version", "kind", "requestId", "code"])
      && (
        value.code === "export-failed"
        || value.code === "protocol"
        || value.code === "response-budget-exceeded"
      );
  }
  if (
    value.kind !== "result"
    || !hasExactKeys(value, ["version", "kind", "requestId", "results", "totalByteLength"])
    || !Array.isArray(value.results)
    || value.results.length < 1
    || value.results.length > STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_BATCH
    || !value.results.every(isStudioHybridDccGlbExportWorkerItemResult)
    || !isSafeInteger(value.totalByteLength)
    || value.totalByteLength > STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_RESPONSE_BYTES
  ) return false;
  const measured = value.results.reduce(
    (total, result) => total + (result.ok ? result.bytes.byteLength : 0),
    0,
  );
  return measured === value.totalByteLength;
}

export function studioHybridDccGlbExportWorkerResponseTransfers(
  response: StudioHybridDccGlbExportWorkerResponse,
): Transferable[] {
  if (response.kind !== "result") return [];
  return response.results.flatMap((result) => result.ok ? [result.bytes] : []);
}
