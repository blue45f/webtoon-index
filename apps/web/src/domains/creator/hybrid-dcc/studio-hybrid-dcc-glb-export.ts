/**
 * Deterministic GLB 2.0 export for the Hybrid DCC authoring mesh.
 *
 * The editable half-edge mesh is the only geometry authority accepted here. Three.js and its
 * BufferGeometry are intentionally absent: a render cache must never become an authoring source.
 * Polygon faces are validated and ear-clipped in stable-ID order, then encoded as a self-contained
 * GLB with POSITION, NORMAL, and uint32 indices. ToonSpectrum stable IDs and provenance survive in
 * glTF `extras`, so an imported derivative can be related back to its authoring revision.
 */

import {
  hashStudioEditableMesh,
  STUDIO_EDITABLE_MESH_LIMITS,
  STUDIO_EDITABLE_MESH_REVISION,
} from "../studio-editable-half-edge-mesh";
import {
  STUDIO_VRM_EXPORT_BIN_CHUNK_TYPE,
  STUDIO_VRM_EXPORT_GLB_MAGIC,
  STUDIO_VRM_EXPORT_GLB_VERSION,
  STUDIO_VRM_EXPORT_JSON_CHUNK_TYPE,
  STUDIO_VRM_EXPORT_MIME_TYPE,
  writeStudioVrmExportGlb,
} from "../vrm/studio-vrm-export-glb-container";

import {
  STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_ISSUE_IDS,
  STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_REPORT_ISSUES,
} from "./studio-hybrid-dcc-glb-export-diagnostic-limits";

import type {
  StudioEditableFace,
  StudioEditableHalfEdge,
  StudioEditableMesh,
  StudioEditableVertex,
  StudioMeshVec3,
} from "../studio-editable-half-edge-mesh";
import type { StudioGeometryAuthorityRecord } from "../studio-geometry-authority";

export const STUDIO_HYBRID_DCC_GLB_EXPORT_REVISION = 1 as const;
export const STUDIO_HYBRID_DCC_GLB_EXPORT_FORMAT =
  "toonspectrum.hybrid-dcc-glb-export" as const;
export const STUDIO_HYBRID_DCC_GLB_EXPORT_GENERATOR =
  "ToonSpectrum Hybrid DCC deterministic editable-mesh exporter/1" as const;
export const STUDIO_HYBRID_DCC_GLB_MIME_TYPE = STUDIO_VRM_EXPORT_MIME_TYPE;
/** Bounds the synchronous deterministic n-gon checks before this path moves to a Worker. */
export const STUDIO_HYBRID_DCC_GLB_MAX_FACE_CORNERS = 256;

const GLTF_COMPONENT_FLOAT = 5126;
const GLTF_COMPONENT_UNSIGNED_INT = 5125;
const GLTF_ARRAY_BUFFER = 34962;
const GLTF_ELEMENT_ARRAY_BUFFER = 34963;
const GLTF_TRIANGLES = 4;
const PLANAR_EPSILON = 1e-6;
const GEOMETRY_EPSILON = 1e-12;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export type StudioHybridDccGlbIssueSeverity = "warning" | "loss" | "error";

export type StudioHybridDccGlbIssueCode =
  | "invalid-input"
  | "invalid-source-id"
  | "invalid-source-revision"
  | "invalid-source-hash"
  | "source-hash-mismatch"
  | "authority-not-editable-mesh"
  | "modifier-stack-unapplied"
  | "mesh-revision-unsupported"
  | "mesh-budget-exceeded"
  | "empty-mesh"
  | "duplicate-stable-id"
  | "stable-id-invalid"
  | "stable-id-counter-invalid"
  | "position-non-finite"
  | "position-float32-overflow"
  | "crease-invalid"
  | "crease-unsupported"
  | "face-property-invalid"
  | "vertex-half-edge-invalid"
  | "half-edge-reference-invalid"
  | "half-edge-link-mismatch"
  | "half-edge-twin-mismatch"
  | "half-edge-face-mismatch"
  | "face-loop-open"
  | "face-loop-incomplete"
  | "face-loop-too-small"
  | "face-corner-budget-exceeded"
  | "face-loop-duplicate-vertex"
  | "edge-zero-length"
  | "edge-orientation-mismatch"
  | "non-manifold-edge"
  | "bow-tie-vertex"
  | "isolated-vertex"
  | "face-zero-area"
  | "face-non-planar"
  | "face-self-intersection"
  | "face-degenerate-corner"
  | "face-collinear-corner-omitted"
  | "triangulation-failed"
  | "normal-unresolved"
  | "index-overflow"
  | "material-slot-metadata-only"
  | "diagnostic-overflow"
  | "container-write-failed"
  | "container-validation-failed";

export interface StudioHybridDccGlbIssue {
  readonly severity: StudioHybridDccGlbIssueSeverity;
  readonly code: StudioHybridDccGlbIssueCode;
  readonly message: string;
  /** Compatibility alias for handoff/preflight surfaces that render diagnostic detail. */
  readonly detail: string;
  readonly vertexIds?: readonly number[];
  readonly halfEdgeIds?: readonly number[];
  readonly faceIds?: readonly number[];
}

export interface StudioHybridDccGlbExportSource {
  readonly authority: "editable-half-edge-mesh";
  readonly assetId: string;
  readonly sourceRevision: number;
  readonly sourceHash: string;
  readonly meshSchemaRevision: typeof STUDIO_EDITABLE_MESH_REVISION;
}

export interface StudioHybridDccGlbExportReport {
  readonly format: typeof STUDIO_HYBRID_DCC_GLB_EXPORT_FORMAT;
  readonly revision: typeof STUDIO_HYBRID_DCC_GLB_EXPORT_REVISION;
  readonly status: "exported" | "blocked";
  readonly source: StudioHybridDccGlbExportSource;
  readonly errors: readonly StudioHybridDccGlbIssue[];
  readonly losses: readonly StudioHybridDccGlbIssue[];
  readonly warnings: readonly StudioHybridDccGlbIssue[];
  /** Stable aggregate in severity order: errors, losses, warnings. */
  readonly issues: readonly StudioHybridDccGlbIssue[];
}

export interface StudioHybridDccGlbExportMetrics {
  readonly sourceVertexCount: number;
  readonly sourceHalfEdgeCount: number;
  readonly sourceFaceCount: number;
  readonly outputVertexCount: number;
  readonly triangleCount: number;
  /** Compact handoff aliases. */
  readonly vertices: number;
  readonly triangles: number;
  readonly positionByteLength: number;
  readonly normalByteLength: number;
  readonly indexByteLength: number;
  readonly binaryByteLength: number;
  readonly glbByteLength: number;
}

export interface StudioHybridDccMeshGlbExportInput {
  readonly assetId: string;
  readonly mesh: StudioEditableMesh;
  /** Workspace geometry-authority revision, not the mesh schema revision. */
  readonly sourceRevision: number;
  /** Must be the current `hashStudioEditableMesh(mesh)` value. */
  readonly sourceHash: string;
}

export type StudioHybridDccMeshGlbExportResult =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array<ArrayBuffer>;
      readonly fileName: string;
      readonly mimeType: typeof STUDIO_HYBRID_DCC_GLB_MIME_TYPE;
      readonly metrics: StudioHybridDccGlbExportMetrics;
      readonly report: StudioHybridDccGlbExportReport & { readonly status: "exported" };
    }
  | {
      readonly ok: false;
      readonly report: StudioHybridDccGlbExportReport & { readonly status: "blocked" };
    };

interface Vec2 {
  readonly x: number;
  readonly y: number;
}

interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

interface ValidatedFace {
  readonly face: StudioEditableFace;
  readonly halfEdgeIds: readonly number[];
  readonly vertexIds: readonly number[];
  readonly triangulationVertexIds: readonly number[];
  readonly triangles: readonly (readonly [number, number, number])[];
  readonly rawNormal: StudioMeshVec3;
  readonly normal: StudioMeshVec3;
}

interface EdgeUse {
  readonly key: string;
  readonly a: number;
  readonly b: number;
  readonly halfEdges: readonly StudioEditableHalfEdge[];
}

interface ValidatedMesh {
  readonly vertices: readonly StudioEditableVertex[];
  readonly vertexById: ReadonlyMap<number, StudioEditableVertex>;
  readonly halfEdgeById: ReadonlyMap<number, StudioEditableHalfEdge>;
  readonly faceById: ReadonlyMap<number, StudioEditableFace>;
  readonly faces: readonly ValidatedFace[];
  readonly edgeUses: readonly EdgeUse[];
  readonly boundaryEdgeCount: number;
  readonly warnings: readonly StudioHybridDccGlbIssue[];
  readonly warningCount: number;
  readonly losses: readonly StudioHybridDccGlbIssue[];
}

interface BuiltGeometry {
  readonly positions: readonly number[];
  readonly normals: readonly number[];
  readonly indices: readonly number[];
  readonly outputSourceVertexIds: readonly number[];
  readonly outputSourceNormalFaceIds: readonly (number | null)[];
  readonly triangleSourceFaceIds: readonly number[];
}

type InternalResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issue: StudioHybridDccGlbIssue };

function issue(
  severity: StudioHybridDccGlbIssueSeverity,
  code: StudioHybridDccGlbIssueCode,
  message: string,
  ids: Pick<StudioHybridDccGlbIssue, "vertexIds" | "halfEdgeIds" | "faceIds"> = {},
): StudioHybridDccGlbIssue {
  const boundedIds: {
    vertexIds?: readonly number[];
    halfEdgeIds?: readonly number[];
    faceIds?: readonly number[];
  } = {};
  const truncation: string[] = [];
  for (const key of ["vertexIds", "halfEdgeIds", "faceIds"] as const) {
    const values = ids[key];
    if (values === undefined) continue;
    const retained = values.slice(0, STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_ISSUE_IDS);
    boundedIds[key] = retained;
    if (retained.length < values.length) {
      truncation.push(
        `${key} total=${values.length} retained=${retained.length} omitted=${values.length - retained.length}`,
      );
    }
  }
  const boundedMessage = truncation.length > 0
    ? `${message} [diagnostic IDs bounded: ${truncation.join("; ")}]`
    : message;
  return { severity, code, message: boundedMessage, detail: boundedMessage, ...boundedIds };
}

interface BoundedDiagnostics {
  readonly errors: readonly StudioHybridDccGlbIssue[];
  readonly losses: readonly StudioHybridDccGlbIssue[];
  readonly warnings: readonly StudioHybridDccGlbIssue[];
  readonly issues: readonly StudioHybridDccGlbIssue[];
}

function boundedDiagnostics(
  errors: readonly StudioHybridDccGlbIssue[],
  losses: readonly StudioHybridDccGlbIssue[],
  warnings: readonly StudioHybridDccGlbIssue[],
  totals: {
    readonly errors?: number;
    readonly losses?: number;
    readonly warnings?: number;
  } = {},
): BoundedDiagnostics {
  const totalErrors = Math.max(errors.length, totals.errors ?? errors.length);
  const totalLosses = Math.max(losses.length, totals.losses ?? losses.length);
  const totalWarnings = Math.max(warnings.length, totals.warnings ?? warnings.length);
  const total = totalErrors + totalLosses + totalWarnings;
  if (
    total <= STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_REPORT_ISSUES
    && errors.length === totalErrors
    && losses.length === totalLosses
    && warnings.length === totalWarnings
  ) {
    return { errors, losses, warnings, issues: [...errors, ...losses, ...warnings] };
  }

  let remaining = STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_REPORT_ISSUES - 1;
  const boundedErrors = errors.slice(0, remaining);
  remaining -= boundedErrors.length;
  const boundedLosses = losses.slice(0, remaining);
  remaining -= boundedLosses.length;
  const boundedWarnings = warnings.slice(0, remaining);
  const omittedErrors = totalErrors - boundedErrors.length;
  const omittedLosses = totalLosses - boundedLosses.length;
  const omittedWarnings = totalWarnings - boundedWarnings.length;
  const retained = boundedErrors.length + boundedLosses.length + boundedWarnings.length;
  const summarySeverity: StudioHybridDccGlbIssueSeverity = omittedErrors > 0
    ? "error"
    : omittedLosses > 0
      ? "loss"
      : "warning";
  const summary = issue(
    summarySeverity,
    "diagnostic-overflow",
    `Export diagnostics bounded: total=${total} retained=${retained} omitted=${total - retained} `
      + `(errors=${omittedErrors}, losses=${omittedLosses}, warnings=${omittedWarnings})`,
  );
  if (summarySeverity === "error") boundedErrors.push(summary);
  else if (summarySeverity === "loss") boundedLosses.push(summary);
  else boundedWarnings.push(summary);
  return {
    errors: boundedErrors,
    losses: boundedLosses,
    warnings: boundedWarnings,
    issues: [...boundedErrors, ...boundedLosses, ...boundedWarnings],
  };
}

function pass<T>(value: T): InternalResult<T> {
  return { ok: true, value };
}

function stop<T>(entry: StudioHybridDccGlbIssue): InternalResult<T> {
  return { ok: false, issue: entry };
}

function reportSource(input: Partial<StudioHybridDccMeshGlbExportInput>): StudioHybridDccGlbExportSource {
  return {
    authority: "editable-half-edge-mesh",
    assetId: typeof input.assetId === "string" ? input.assetId : "",
    sourceRevision: Number.isSafeInteger(input.sourceRevision) ? input.sourceRevision! : 0,
    sourceHash: typeof input.sourceHash === "string" ? input.sourceHash : "",
    meshSchemaRevision: STUDIO_EDITABLE_MESH_REVISION,
  };
}

function blockedReport(
  input: Partial<StudioHybridDccMeshGlbExportInput>,
  error: StudioHybridDccGlbIssue,
  losses: readonly StudioHybridDccGlbIssue[] = [],
  warnings: readonly StudioHybridDccGlbIssue[] = [],
  warningCount: number = warnings.length,
): StudioHybridDccMeshGlbExportResult {
  const diagnostics = boundedDiagnostics([error], losses, warnings, { warnings: warningCount });
  return {
    ok: false,
    report: {
      format: STUDIO_HYBRID_DCC_GLB_EXPORT_FORMAT,
      revision: STUDIO_HYBRID_DCC_GLB_EXPORT_REVISION,
      status: "blocked",
      source: reportSource(input),
      ...diagnostics,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeStableId(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function maximumNumber(values: Iterable<number>): number {
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of values) maximum = Math.max(maximum, value);
  return maximum;
}

function minimumNumber(values: Iterable<number>): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const value of values) minimum = Math.min(minimum, value);
  return minimum;
}

function finiteVec3(value: StudioMeshVec3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function sub(a: StudioMeshVec3, b: StudioMeshVec3): StudioMeshVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: StudioMeshVec3, b: StudioMeshVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length3(value: StudioMeshVec3): number {
  return Math.hypot(value.x, value.y, value.z);
}

function normalized(value: StudioMeshVec3): StudioMeshVec3 | null {
  const magnitude = length3(value);
  if (!Number.isFinite(magnitude) || magnitude <= GEOMETRY_EPSILON) return null;
  return { x: value.x / magnitude, y: value.y / magnitude, z: value.z / magnitude };
}

function newellNormal(points: readonly StudioMeshVec3[]): StudioMeshVec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    x += (current.y - next.y) * (current.z + next.z);
    y += (current.z - next.z) * (current.x + next.x);
    z += (current.x - next.x) * (current.y + next.y);
  }
  return { x, y, z };
}

function dominantProjection(normal: StudioMeshVec3, point: StudioMeshVec3): Vec2 {
  const ax = Math.abs(normal.x);
  const ay = Math.abs(normal.y);
  const az = Math.abs(normal.z);
  if (ax >= ay && ax >= az) return { x: point.y, y: point.z };
  if (ay >= ax && ay >= az) return { x: point.z, y: point.x };
  return { x: point.x, y: point.y };
}

function orient2d(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function signedArea2d(points: readonly Vec2[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
}

function onSegment(a: Vec2, b: Vec2, point: Vec2, epsilon: number): boolean {
  return (
    Math.abs(orient2d(a, b, point)) <= epsilon &&
    point.x >= Math.min(a.x, b.x) - epsilon &&
    point.x <= Math.max(a.x, b.x) + epsilon &&
    point.y >= Math.min(a.y, b.y) - epsilon &&
    point.y <= Math.max(a.y, b.y) + epsilon
  );
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2, epsilon: number): boolean {
  const abC = orient2d(a, b, c);
  const abD = orient2d(a, b, d);
  const cdA = orient2d(c, d, a);
  const cdB = orient2d(c, d, b);
  if (
    ((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon)) &&
    ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))
  ) {
    return true;
  }
  return (
    onSegment(a, b, c, epsilon) ||
    onSegment(a, b, d, epsilon) ||
    onSegment(c, d, a, epsilon) ||
    onSegment(c, d, b, epsilon)
  );
}

function polygonSelfIntersects(points: readonly Vec2[], epsilon: number): boolean {
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (
        first === second ||
        firstNext === second ||
        secondNext === first
      ) {
        continue;
      }
      if (
        segmentsIntersect(
          points[first]!,
          points[firstNext]!,
          points[second]!,
          points[secondNext]!,
          epsilon,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function rotateTogether<T>(values: readonly T[], offset: number): readonly T[] {
  return [...values.slice(offset), ...values.slice(0, offset)];
}

function canonicalLoopStart(vertexIds: readonly number[], halfEdgeIds: readonly number[]): number {
  let best = 0;
  for (let index = 1; index < vertexIds.length; index += 1) {
    if (
      vertexIds[index]! < vertexIds[best]! ||
      (vertexIds[index] === vertexIds[best] && halfEdgeIds[index]! < halfEdgeIds[best]!)
    ) {
      best = index;
    }
  }
  return best;
}

function pointInsideTriangle(
  point: Vec2,
  a: Vec2,
  b: Vec2,
  c: Vec2,
  winding: 1 | -1,
  epsilon: number,
): boolean {
  return (
    orient2d(a, b, point) * winding >= -epsilon &&
    orient2d(b, c, point) * winding >= -epsilon &&
    orient2d(c, a, point) * winding >= -epsilon
  );
}

function triangulateSimplePolygon(
  faceId: number,
  vertexIds: readonly number[],
  points: readonly Vec2[],
  epsilon: number,
): InternalResult<readonly (readonly [number, number, number])[]> {
  const winding: 1 | -1 = signedArea2d(points) >= 0 ? 1 : -1;
  const remaining = vertexIds.map((_, index) => index);
  const triangles: Array<readonly [number, number, number]> = [];
  let guard = 0;
  while (remaining.length > 3) {
    let earIndex = -1;
    for (let cursor = 0; cursor < remaining.length; cursor += 1) {
      const previousIndex = remaining[(cursor + remaining.length - 1) % remaining.length]!;
      const currentIndex = remaining[cursor]!;
      const nextIndex = remaining[(cursor + 1) % remaining.length]!;
      const a = points[previousIndex]!;
      const b = points[currentIndex]!;
      const c = points[nextIndex]!;
      if (orient2d(a, b, c) * winding <= epsilon) continue;
      let containsOther = false;
      for (const candidateIndex of remaining) {
        if (
          candidateIndex === previousIndex ||
          candidateIndex === currentIndex ||
          candidateIndex === nextIndex
        ) {
          continue;
        }
        if (pointInsideTriangle(points[candidateIndex]!, a, b, c, winding, epsilon)) {
          containsOther = true;
          break;
        }
      }
      if (!containsOther) {
        earIndex = cursor;
        triangles.push([
          vertexIds[previousIndex]!,
          vertexIds[currentIndex]!,
          vertexIds[nextIndex]!,
        ]);
        break;
      }
    }
    if (earIndex < 0) {
      return stop(
        issue("error", "triangulation-failed", `Face ${faceId} has no deterministic ear`, {
          faceIds: [faceId],
          vertexIds,
        }),
      );
    }
    remaining.splice(earIndex, 1);
    guard += 1;
    if (guard > vertexIds.length) {
      return stop(
        issue("error", "triangulation-failed", `Face ${faceId} exceeded triangulation guard`, {
          faceIds: [faceId],
        }),
      );
    }
  }
  triangles.push([
    vertexIds[remaining[0]!]!,
    vertexIds[remaining[1]!]!,
    vertexIds[remaining[2]!]!,
  ]);
  return pass(triangles);
}

function faceProjectionScale(points: readonly Vec2[]): number {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return Math.max(Math.hypot(maxX - minX, maxY - minY), 1);
}

function prepareFace(
  face: StudioEditableFace,
  halfEdgeIdsInput: readonly number[],
  vertexIdsInput: readonly number[],
  vertexById: ReadonlyMap<number, StudioEditableVertex>,
): InternalResult<{ readonly face: ValidatedFace; readonly warnings: readonly StudioHybridDccGlbIssue[] }> {
  const start = canonicalLoopStart(vertexIdsInput, halfEdgeIdsInput);
  const halfEdgeIds = rotateTogether(halfEdgeIdsInput, start);
  const vertexIds = rotateTogether(vertexIdsInput, start);
  const points3d = vertexIds.map((id) => vertexById.get(id)!.position);
  const rawNormal = newellNormal(points3d);
  const normal = normalized(rawNormal);
  let extent = 1;
  for (const point of points3d) {
    extent = Math.max(extent, length3(sub(point, points3d[0]!)));
  }
  if (!normal || length3(rawNormal) <= Math.max(STUDIO_EDITABLE_MESH_LIMITS.areaEpsilon, extent * extent * GEOMETRY_EPSILON)) {
    return stop(
      issue("error", "face-zero-area", `Face ${face.id} has zero or unstable area`, {
        faceIds: [face.id],
        vertexIds,
      }),
    );
  }
  const planeOrigin = points3d[0]!;
  for (const point of points3d) {
    if (Math.abs(dot(sub(point, planeOrigin), normal)) > PLANAR_EPSILON * extent) {
      return stop(
        issue("error", "face-non-planar", `Face ${face.id} is outside the planar export tolerance`, {
          faceIds: [face.id],
          vertexIds,
        }),
      );
    }
  }

  const projected = points3d.map((point) => dominantProjection(normal, point));
  const projectionScale = faceProjectionScale(projected);
  const epsilon = GEOMETRY_EPSILON * projectionScale * projectionScale;
  const retained = vertexIds.map((_, index) => index);
  const omitted: number[] = [];
  let changed = true;
  while (changed && retained.length > 3) {
    changed = false;
    for (let cursor = 0; cursor < retained.length; cursor += 1) {
      const previousIndex = retained[(cursor + retained.length - 1) % retained.length]!;
      const currentIndex = retained[cursor]!;
      const nextIndex = retained[(cursor + 1) % retained.length]!;
      const previous = projected[previousIndex]!;
      const current = projected[currentIndex]!;
      const next = projected[nextIndex]!;
      if (Math.abs(orient2d(previous, current, next)) > epsilon) continue;
      const incoming = { x: current.x - previous.x, y: current.y - previous.y };
      const outgoing = { x: next.x - current.x, y: next.y - current.y };
      if (incoming.x * outgoing.x + incoming.y * outgoing.y <= 0) {
        return stop(
          issue("error", "face-degenerate-corner", `Face ${face.id} backtracks at vertex ${vertexIds[currentIndex]}`, {
            faceIds: [face.id],
            vertexIds: [vertexIds[currentIndex]!],
          }),
        );
      }
      omitted.push(vertexIds[currentIndex]!);
      retained.splice(cursor, 1);
      changed = true;
      break;
    }
  }
  if (retained.length < 3) {
    return stop(
      issue("error", "face-zero-area", `Face ${face.id} collapses during triangulation`, {
        faceIds: [face.id],
      }),
    );
  }
  const triangulationVertexIds = retained.map((index) => vertexIds[index]!);
  const triangulationPoints = retained.map((index) => projected[index]!);
  if (Math.abs(signedArea2d(triangulationPoints)) <= epsilon) {
    return stop(
      issue("error", "face-zero-area", `Face ${face.id} has zero projected area`, {
        faceIds: [face.id],
      }),
    );
  }
  if (polygonSelfIntersects(triangulationPoints, epsilon)) {
    return stop(
      issue("error", "face-self-intersection", `Face ${face.id} self-intersects`, {
        faceIds: [face.id],
        vertexIds: triangulationVertexIds,
      }),
    );
  }
  const triangulated = triangulateSimplePolygon(
    face.id,
    triangulationVertexIds,
    triangulationPoints,
    epsilon,
  );
  if (!triangulated.ok) return triangulated;
  const warnings = omitted.length > 0
    ? [
        issue(
          "warning",
          "face-collinear-corner-omitted",
          `Face ${face.id} omitted ${omitted.length} collinear corner(s) from triangles`,
          { faceIds: [face.id], vertexIds: [...omitted].sort((a, b) => a - b) },
        ),
      ]
    : [];
  return pass({
    face: {
      face,
      halfEdgeIds,
      vertexIds,
      triangulationVertexIds,
      triangles: triangulated.value,
      rawNormal,
      normal,
    },
    warnings,
  });
}

function validateMesh(mesh: StudioEditableMesh): InternalResult<ValidatedMesh> {
  if (!isRecord(mesh) || !Array.isArray(mesh.vertices) || !Array.isArray(mesh.halfEdges) || !Array.isArray(mesh.faces)) {
    return stop(issue("error", "invalid-input", "Editable mesh arrays are required"));
  }
  if (mesh.revision !== STUDIO_EDITABLE_MESH_REVISION) {
    return stop(issue("error", "mesh-revision-unsupported", "Editable mesh schema revision is unsupported"));
  }
  if (
    mesh.vertices.length > STUDIO_EDITABLE_MESH_LIMITS.maxVertices ||
    mesh.faces.length > STUDIO_EDITABLE_MESH_LIMITS.maxFaces ||
    mesh.halfEdges.length > STUDIO_EDITABLE_MESH_LIMITS.maxEdges * 2
  ) {
    return stop(issue("error", "mesh-budget-exceeded", "Editable mesh exceeds the authoring export budget"));
  }
  if (mesh.vertices.length === 0 || mesh.faces.length === 0 || mesh.halfEdges.length === 0) {
    return stop(issue("error", "empty-mesh", "A GLB export requires at least one polygon face"));
  }

  const vertexById = new Map<number, StudioEditableVertex>();
  for (const vertex of mesh.vertices) {
    if (!safeStableId(vertex.id)) {
      return stop(issue("error", "stable-id-invalid", "Every vertex needs a non-negative stable integer ID"));
    }
    if (vertexById.has(vertex.id)) {
      return stop(issue("error", "duplicate-stable-id", `Duplicate vertex ID ${vertex.id}`, { vertexIds: [vertex.id] }));
    }
    if (!finiteVec3(vertex.position)) {
      return stop(issue("error", "position-non-finite", `Vertex ${vertex.id} has a non-finite position`, { vertexIds: [vertex.id] }));
    }
    if (!Number.isFinite(vertex.crease) || vertex.crease < 0 || vertex.crease > 1) {
      return stop(issue("error", "crease-invalid", `Vertex ${vertex.id} has an invalid crease`, { vertexIds: [vertex.id] }));
    }
    if (vertex.crease !== 0) {
      return stop(issue("error", "crease-unsupported", `Vertex ${vertex.id} crease cannot be represented faithfully`, { vertexIds: [vertex.id] }));
    }
    if (!Number.isSafeInteger(vertex.he) || vertex.he < -1) {
      return stop(issue("error", "vertex-half-edge-invalid", `Vertex ${vertex.id} has an invalid outgoing half-edge`, { vertexIds: [vertex.id] }));
    }
    vertexById.set(vertex.id, vertex);
  }

  const halfEdgeById = new Map<number, StudioEditableHalfEdge>();
  for (const halfEdge of mesh.halfEdges) {
    if (!safeStableId(halfEdge.id)) {
      return stop(issue("error", "stable-id-invalid", "Every half-edge needs a non-negative stable integer ID"));
    }
    if (halfEdgeById.has(halfEdge.id)) {
      return stop(issue("error", "duplicate-stable-id", `Duplicate half-edge ID ${halfEdge.id}`, { halfEdgeIds: [halfEdge.id] }));
    }
    if (
      !Number.isSafeInteger(halfEdge.vertex) ||
      !Number.isSafeInteger(halfEdge.face) ||
      !Number.isSafeInteger(halfEdge.next) ||
      !Number.isSafeInteger(halfEdge.prev) ||
      !Number.isSafeInteger(halfEdge.twin)
    ) {
      return stop(issue("error", "half-edge-reference-invalid", `Half-edge ${halfEdge.id} has a non-integer reference`, { halfEdgeIds: [halfEdge.id] }));
    }
    if (!Number.isFinite(halfEdge.crease) || halfEdge.crease < 0 || halfEdge.crease > 1) {
      return stop(issue("error", "crease-invalid", `Half-edge ${halfEdge.id} has an invalid crease`, { halfEdgeIds: [halfEdge.id] }));
    }
    if (halfEdge.crease !== 0) {
      return stop(issue("error", "crease-unsupported", `Half-edge ${halfEdge.id} crease cannot be represented faithfully`, { halfEdgeIds: [halfEdge.id] }));
    }
    halfEdgeById.set(halfEdge.id, halfEdge);
  }

  const faceById = new Map<number, StudioEditableFace>();
  for (const face of mesh.faces) {
    if (!safeStableId(face.id)) {
      return stop(issue("error", "stable-id-invalid", "Every face needs a non-negative stable integer ID"));
    }
    if (faceById.has(face.id)) {
      return stop(issue("error", "duplicate-stable-id", `Duplicate face ID ${face.id}`, { faceIds: [face.id] }));
    }
    if (
      !safeStableId(face.he) ||
      !Number.isSafeInteger(face.materialSlot) ||
      face.materialSlot < 0 ||
      typeof face.smooth !== "boolean"
    ) {
      return stop(issue("error", "face-property-invalid", `Face ${face.id} has invalid properties`, { faceIds: [face.id] }));
    }
    faceById.set(face.id, face);
  }

  const maxVertexId = maximumNumber(vertexById.keys());
  const maxHalfEdgeId = maximumNumber(halfEdgeById.keys());
  const maxFaceId = maximumNumber(faceById.keys());
  if (
    !Number.isSafeInteger(mesh.nextVertexId) || mesh.nextVertexId <= maxVertexId ||
    !Number.isSafeInteger(mesh.nextHalfEdgeId) || mesh.nextHalfEdgeId <= maxHalfEdgeId ||
    !Number.isSafeInteger(mesh.nextFaceId) || mesh.nextFaceId <= maxFaceId
  ) {
    return stop(issue("error", "stable-id-counter-invalid", "Stable-ID generation counters must exceed all live IDs"));
  }

  const originByHalfEdgeId = new Map<number, number>();
  for (const halfEdge of [...halfEdgeById.values()].sort((a, b) => a.id - b.id)) {
    const previous = halfEdgeById.get(halfEdge.prev);
    const next = halfEdgeById.get(halfEdge.next);
    if (!vertexById.has(halfEdge.vertex) || !previous || !next || (halfEdge.twin >= 0 && !halfEdgeById.has(halfEdge.twin))) {
      return stop(issue("error", "half-edge-reference-invalid", `Half-edge ${halfEdge.id} references a missing element`, { halfEdgeIds: [halfEdge.id] }));
    }
    if (next.prev !== halfEdge.id || previous.next !== halfEdge.id) {
      return stop(issue("error", "half-edge-link-mismatch", `Half-edge ${halfEdge.id} next/prev links are not reciprocal`, { halfEdgeIds: [halfEdge.id, halfEdge.next, halfEdge.prev] }));
    }
    if (halfEdge.face < -1 || (halfEdge.face >= 0 && !faceById.has(halfEdge.face))) {
      return stop(issue("error", "half-edge-face-mismatch", `Half-edge ${halfEdge.id} references a missing face`, { halfEdgeIds: [halfEdge.id] }));
    }
    originByHalfEdgeId.set(halfEdge.id, previous.vertex);
  }

  const incidentOutgoing = new Map<number, number[]>();
  for (const halfEdge of halfEdgeById.values()) {
    const origin = originByHalfEdgeId.get(halfEdge.id)!;
    const list = incidentOutgoing.get(origin) ?? [];
    list.push(halfEdge.id);
    incidentOutgoing.set(origin, list);
    if (origin === halfEdge.vertex) {
      return stop(issue("error", "edge-zero-length", `Half-edge ${halfEdge.id} starts and ends at vertex ${origin}`, { vertexIds: [origin], halfEdgeIds: [halfEdge.id] }));
    }
    const originPosition = vertexById.get(origin)!.position;
    const destinationPosition = vertexById.get(halfEdge.vertex)!.position;
    if (length3(sub(destinationPosition, originPosition)) <= GEOMETRY_EPSILON) {
      return stop(issue("error", "edge-zero-length", `Half-edge ${halfEdge.id} has coincident endpoint positions`, { vertexIds: [origin, halfEdge.vertex], halfEdgeIds: [halfEdge.id] }));
    }
  }
  for (const vertex of [...vertexById.values()].sort((a, b) => a.id - b.id)) {
    const outgoing = incidentOutgoing.get(vertex.id) ?? [];
    if (outgoing.length === 0) {
      return stop(issue("error", "isolated-vertex", `Vertex ${vertex.id} is not part of any polygon`, { vertexIds: [vertex.id] }));
    }
    const selected = halfEdgeById.get(vertex.he);
    if (!selected || originByHalfEdgeId.get(selected.id) !== vertex.id) {
      return stop(issue("error", "vertex-half-edge-invalid", `Vertex ${vertex.id} outgoing half-edge is inconsistent`, { vertexIds: [vertex.id], halfEdgeIds: vertex.he >= 0 ? [vertex.he] : [] }));
    }
  }

  const rawFaceLoops: Array<{
    readonly face: StudioEditableFace;
    readonly halfEdgeIds: readonly number[];
    readonly vertexIds: readonly number[];
  }> = [];
  const ownedHalfEdgeIdsByFace = new Map<number, number[]>();
  for (const halfEdge of halfEdgeById.values()) {
    if (halfEdge.face < 0) continue;
    const owned = ownedHalfEdgeIdsByFace.get(halfEdge.face) ?? [];
    owned.push(halfEdge.id);
    ownedHalfEdgeIdsByFace.set(halfEdge.face, owned);
  }
  for (const owned of ownedHalfEdgeIdsByFace.values()) owned.sort((a, b) => a - b);
  for (const face of [...faceById.values()].sort((a, b) => a.id - b.id)) {
    if (!halfEdgeById.has(face.he)) {
      return stop(issue("error", "half-edge-reference-invalid", `Face ${face.id} starts at a missing half-edge`, { faceIds: [face.id], halfEdgeIds: [face.he] }));
    }
    const halfEdgeIds: number[] = [];
    const vertexIds: number[] = [];
    const visited = new Set<number>();
    let current = face.he;
    for (let guard = 0; guard <= halfEdgeById.size; guard += 1) {
      if (current === face.he && halfEdgeIds.length > 0) break;
      if (visited.has(current)) {
        return stop(issue("error", "face-loop-open", `Face ${face.id} enters a cycle that does not return to its start`, { faceIds: [face.id], halfEdgeIds }));
      }
      const halfEdge = halfEdgeById.get(current);
      if (!halfEdge) {
        return stop(issue("error", "half-edge-reference-invalid", `Face ${face.id} traverses a missing half-edge`, { faceIds: [face.id], halfEdgeIds: [current] }));
      }
      if (halfEdge.face !== face.id) {
        return stop(issue("error", "half-edge-face-mismatch", `Face ${face.id} traverses half-edge ${current} owned by another face`, { faceIds: [face.id], halfEdgeIds: [current] }));
      }
      visited.add(current);
      halfEdgeIds.push(current);
      vertexIds.push(originByHalfEdgeId.get(current)!);
      current = halfEdge.next;
    }
    if (current !== face.he) {
      return stop(issue("error", "face-loop-open", `Face ${face.id} did not close within the topology guard`, { faceIds: [face.id], halfEdgeIds }));
    }
    if (halfEdgeIds.length < 3) {
      return stop(issue("error", "face-loop-too-small", `Face ${face.id} has fewer than three edges`, { faceIds: [face.id], halfEdgeIds }));
    }
    if (halfEdgeIds.length > STUDIO_HYBRID_DCC_GLB_MAX_FACE_CORNERS) {
      return stop(issue(
        "error",
        "face-corner-budget-exceeded",
        `Face ${face.id} exceeds the ${STUDIO_HYBRID_DCC_GLB_MAX_FACE_CORNERS}-corner synchronous export budget`,
        { faceIds: [face.id] },
      ));
    }
    if (new Set(vertexIds).size !== vertexIds.length) {
      return stop(issue("error", "face-loop-duplicate-vertex", `Face ${face.id} repeats a stable vertex`, { faceIds: [face.id], vertexIds }));
    }
    const owned = ownedHalfEdgeIdsByFace.get(face.id) ?? [];
    const traversed = [...halfEdgeIds].sort((a, b) => a - b);
    if (owned.length !== traversed.length || owned.some((id, index) => id !== traversed[index])) {
      return stop(issue("error", "face-loop-incomplete", `Face ${face.id} does not own exactly one closed loop`, { faceIds: [face.id], halfEdgeIds: owned }));
    }
    rawFaceLoops.push({ face, halfEdgeIds, vertexIds });
  }

  const edgeGroups = new Map<string, StudioEditableHalfEdge[]>();
  for (const halfEdge of halfEdgeById.values()) {
    const origin = originByHalfEdgeId.get(halfEdge.id)!;
    const a = Math.min(origin, halfEdge.vertex);
    const b = Math.max(origin, halfEdge.vertex);
    const key = `${a}|${b}`;
    const group = edgeGroups.get(key) ?? [];
    group.push(halfEdge);
    edgeGroups.set(key, group);
  }
  const edgeUses: EdgeUse[] = [];
  let boundaryEdgeCount = 0;
  for (const [key, unsorted] of [...edgeGroups.entries()].sort(([left], [right]) => compareCodeUnits(left, right))) {
    const halfEdges = [...unsorted].sort((a, b) => a.id - b.id);
    const [aText, bText] = key.split("|");
    const a = Number(aText);
    const b = Number(bText);
    if (halfEdges.length > 2) {
      return stop(issue("error", "non-manifold-edge", `Edge ${key} is used by ${halfEdges.length} half-edges`, { vertexIds: [a, b], halfEdgeIds: halfEdges.map((entry) => entry.id) }));
    }
    if (halfEdges.length === 1) {
      if (halfEdges[0]!.twin !== -1) {
        return stop(issue("error", "half-edge-twin-mismatch", `Boundary half-edge ${halfEdges[0]!.id} has an unreachable twin`, { halfEdgeIds: [halfEdges[0]!.id] }));
      }
      boundaryEdgeCount += 1;
    } else {
      const first = halfEdges[0]!;
      const second = halfEdges[1]!;
      const firstOrigin = originByHalfEdgeId.get(first.id)!;
      const secondOrigin = originByHalfEdgeId.get(second.id)!;
      if (
        first.twin !== second.id ||
        second.twin !== first.id ||
        firstOrigin !== second.vertex ||
        secondOrigin !== first.vertex
      ) {
        return stop(issue("error", "edge-orientation-mismatch", `Edge ${key} does not have one reciprocal, oppositely oriented pair`, { vertexIds: [a, b], halfEdgeIds: [first.id, second.id] }));
      }
    }
    edgeUses.push({ key, a, b, halfEdges });
  }

  const incidentFaces = new Map<number, Set<number>>();
  for (const loop of rawFaceLoops) {
    for (const vertexId of loop.vertexIds) {
      const faces = incidentFaces.get(vertexId) ?? new Set<number>();
      faces.add(loop.face.id);
      incidentFaces.set(vertexId, faces);
    }
  }
  const faceNeighborsAtVertex = new Map<number, Map<number, Set<number>>>();
  for (const edgeUse of edgeUses) {
    const faceIds = [...new Set(edgeUse.halfEdges.map((entry) => entry.face).filter((id) => id >= 0))];
    if (faceIds.length !== 2) continue;
    for (const vertexId of [edgeUse.a, edgeUse.b]) {
      const byFace = faceNeighborsAtVertex.get(vertexId) ?? new Map<number, Set<number>>();
      const firstNeighbors = byFace.get(faceIds[0]!) ?? new Set<number>();
      const secondNeighbors = byFace.get(faceIds[1]!) ?? new Set<number>();
      firstNeighbors.add(faceIds[1]!);
      secondNeighbors.add(faceIds[0]!);
      byFace.set(faceIds[0]!, firstNeighbors);
      byFace.set(faceIds[1]!, secondNeighbors);
      faceNeighborsAtVertex.set(vertexId, byFace);
    }
  }
  for (const [vertexId, faces] of [...incidentFaces.entries()].sort(([a], [b]) => a - b)) {
    if (faces.size <= 1) continue;
    const sortedFaces = [...faces].sort((a, b) => a - b);
    const seen = new Set<number>([sortedFaces[0]!]);
    const queue = [sortedFaces[0]!];
    const neighbors = faceNeighborsAtVertex.get(vertexId) ?? new Map<number, Set<number>>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighbor of [...(neighbors.get(current) ?? [])].sort((a, b) => a - b)) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    if (seen.size !== faces.size) {
      return stop(issue("error", "bow-tie-vertex", `Vertex ${vertexId} has disconnected face fans`, { vertexIds: [vertexId], faceIds: sortedFaces }));
    }
  }

  const warnings: StudioHybridDccGlbIssue[] = [];
  let warningCount = 0;
  const validatedFaces: ValidatedFace[] = [];
  for (const loop of rawFaceLoops) {
    const prepared = prepareFace(loop.face, loop.halfEdgeIds, loop.vertexIds, vertexById);
    if (!prepared.ok) return prepared;
    validatedFaces.push(prepared.value.face);
    warningCount += prepared.value.warnings.length;
    const remainingWarningSlots = STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_REPORT_ISSUES - warnings.length;
    if (remainingWarningSlots > 0) {
      warnings.push(...prepared.value.warnings.slice(0, remainingWarningSlots));
    }
  }
  const materialFaces = validatedFaces
    .filter(({ face }) => face.materialSlot !== 0)
    .map(({ face }) => face.id);
  const losses = materialFaces.length > 0
    ? [
        issue(
          "loss",
          "material-slot-metadata-only",
          "Material slots are preserved in extras but no glTF material payload is authored",
          { faceIds: materialFaces },
        ),
      ]
    : [];
  return pass({
    vertices: [...vertexById.values()].sort((a, b) => a.id - b.id),
    vertexById,
    halfEdgeById,
    faceById,
    faces: validatedFaces,
    edgeUses,
    boundaryEdgeCount,
    warnings,
    warningCount,
    losses,
  });
}

function buildSmoothGroups(mesh: ValidatedMesh): InternalResult<{
  readonly groupByCorner: ReadonlyMap<string, number>;
  readonly normalByGroup: ReadonlyMap<string, StudioMeshVec3>;
}> {
  const smoothFacesByVertex = new Map<number, Set<number>>();
  for (const face of mesh.faces) {
    if (!face.face.smooth) continue;
    for (const vertexId of face.triangulationVertexIds) {
      const faces = smoothFacesByVertex.get(vertexId) ?? new Set<number>();
      faces.add(face.face.id);
      smoothFacesByVertex.set(vertexId, faces);
    }
  }
  const neighbors = new Map<string, Set<number>>();
  for (const edge of mesh.edgeUses) {
    const faceIds = [...new Set(edge.halfEdges.map((halfEdge) => halfEdge.face).filter((id) => id >= 0))];
    if (faceIds.length !== 2) continue;
    const first = mesh.faceById.get(faceIds[0]!)!;
    const second = mesh.faceById.get(faceIds[1]!)!;
    if (!first.smooth || !second.smooth) continue;
    for (const vertexId of [edge.a, edge.b]) {
      const firstKey = `${vertexId}:${first.id}`;
      const secondKey = `${vertexId}:${second.id}`;
      const firstSet = neighbors.get(firstKey) ?? new Set<number>();
      const secondSet = neighbors.get(secondKey) ?? new Set<number>();
      firstSet.add(second.id);
      secondSet.add(first.id);
      neighbors.set(firstKey, firstSet);
      neighbors.set(secondKey, secondSet);
    }
  }

  const faceDataById = new Map(mesh.faces.map((entry) => [entry.face.id, entry] as const));
  const groupByCorner = new Map<string, number>();
  const normalByGroup = new Map<string, StudioMeshVec3>();
  for (const [vertexId, faceSet] of [...smoothFacesByVertex.entries()].sort(([a], [b]) => a - b)) {
    const remaining = new Set(faceSet);
    while (remaining.size > 0) {
      const seed = minimumNumber(remaining);
      const component: number[] = [];
      const queue = [seed];
      remaining.delete(seed);
      while (queue.length > 0) {
        const current = queue.shift()!;
        component.push(current);
        for (const adjacent of [...(neighbors.get(`${vertexId}:${current}`) ?? [])].sort((a, b) => a - b)) {
          if (remaining.delete(adjacent)) queue.push(adjacent);
        }
      }
      component.sort((a, b) => a - b);
      const groupId = component[0]!;
      const sum: MutableVec3 = { x: 0, y: 0, z: 0 };
      for (const faceId of component) {
        const normal = faceDataById.get(faceId)!.rawNormal;
        sum.x += normal.x;
        sum.y += normal.y;
        sum.z += normal.z;
        groupByCorner.set(`${vertexId}:${faceId}`, groupId);
      }
      const normal = normalized(sum);
      if (!normal) {
        return stop(issue("error", "normal-unresolved", `Smooth normal cancels at vertex ${vertexId}`, { vertexIds: [vertexId], faceIds: component }));
      }
      normalByGroup.set(`${vertexId}:${groupId}`, normal);
    }
  }
  return pass({ groupByCorner, normalByGroup });
}

function buildGeometry(mesh: ValidatedMesh): InternalResult<BuiltGeometry> {
  const groups = buildSmoothGroups(mesh);
  if (!groups.ok) return groups;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const outputSourceVertexIds: number[] = [];
  const outputSourceNormalFaceIds: Array<number | null> = [];
  const triangleSourceFaceIds: number[] = [];
  const outputIndexByKey = new Map<string, number>();

  for (const faceData of mesh.faces) {
    for (const triangle of faceData.triangles) {
      triangleSourceFaceIds.push(faceData.face.id);
      for (const sourceVertexId of triangle) {
        const groupId = faceData.face.smooth
          ? groups.value.groupByCorner.get(`${sourceVertexId}:${faceData.face.id}`)
          : undefined;
        if (faceData.face.smooth && groupId === undefined) {
          return stop(issue("error", "normal-unresolved", `No smoothing group for vertex ${sourceVertexId}`, { vertexIds: [sourceVertexId], faceIds: [faceData.face.id] }));
        }
        const key = faceData.face.smooth
          ? `smooth:${sourceVertexId}:${groupId}`
          : `flat:${faceData.face.id}:${sourceVertexId}`;
        let outputIndex = outputIndexByKey.get(key);
        if (outputIndex === undefined) {
          outputIndex = outputSourceVertexIds.length;
          if (outputIndex > 0xffff_ffff) {
            return stop(issue("error", "index-overflow", "Output requires indices wider than uint32"));
          }
          const position = mesh.vertexById.get(sourceVertexId)!.position;
          const normal = faceData.face.smooth
            ? groups.value.normalByGroup.get(`${sourceVertexId}:${groupId}`)!
            : faceData.normal;
          positions.push(position.x, position.y, position.z);
          normals.push(normal.x, normal.y, normal.z);
          outputSourceVertexIds.push(sourceVertexId);
          outputSourceNormalFaceIds.push(faceData.face.smooth ? null : faceData.face.id);
          outputIndexByKey.set(key, outputIndex);
        }
        indices.push(outputIndex);
      }
    }
  }
  if (indices.length === 0 || positions.length === 0) {
    return stop(issue("error", "empty-mesh", "Triangulation emitted no geometry"));
  }
  return pass({
    positions,
    normals,
    indices,
    outputSourceVertexIds,
    outputSourceNormalFaceIds,
    triangleSourceFaceIds,
  });
}

function alignFour(value: number): number {
  return (value + 3) & ~3;
}

function canonicalFloat32(value: number): number | null {
  const result = Math.fround(value);
  if (!Number.isFinite(result)) return null;
  return Object.is(result, -0) ? 0 : result;
}

function encodeBinary(geometry: BuiltGeometry): InternalResult<{
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly positions: readonly number[];
  readonly normals: readonly number[];
  readonly boundsMin: readonly [number, number, number];
  readonly boundsMax: readonly [number, number, number];
  readonly positionOffset: number;
  readonly positionByteLength: number;
  readonly normalOffset: number;
  readonly normalByteLength: number;
  readonly indexOffset: number;
  readonly indexByteLength: number;
}> {
  const outputPositions: number[] = [];
  const outputNormals: number[] = [];
  const min: [number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: [number, number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let index = 0; index < geometry.positions.length; index += 1) {
    const value = canonicalFloat32(geometry.positions[index]!);
    if (value === null) {
      return stop(issue("error", "position-float32-overflow", "A source position cannot be represented as float32"));
    }
    outputPositions.push(value);
    const axis = index % 3;
    min[axis] = Math.min(min[axis], value);
    max[axis] = Math.max(max[axis], value);
  }
  for (const source of geometry.normals) {
    const value = canonicalFloat32(source);
    if (value === null) {
      return stop(issue("error", "normal-unresolved", "A generated normal cannot be represented as float32"));
    }
    outputNormals.push(value);
  }
  const positionByteLength = outputPositions.length * Float32Array.BYTES_PER_ELEMENT;
  const normalOffset = alignFour(positionByteLength);
  const normalByteLength = outputNormals.length * Float32Array.BYTES_PER_ELEMENT;
  const indexOffset = alignFour(normalOffset + normalByteLength);
  const indexByteLength = geometry.indices.length * Uint32Array.BYTES_PER_ELEMENT;
  const totalByteLength = alignFour(indexOffset + indexByteLength);
  const bytes = new Uint8Array(totalByteLength);
  const view = new DataView(bytes.buffer);
  outputPositions.forEach((value, index) => {
    view.setFloat32(index * 4, value, true);
  });
  outputNormals.forEach((value, index) => {
    view.setFloat32(normalOffset + index * 4, value, true);
  });
  geometry.indices.forEach((value, index) => {
    view.setUint32(indexOffset + index * 4, value, true);
  });
  return pass({
    bytes,
    positions: outputPositions,
    normals: outputNormals,
    boundsMin: min,
    boundsMax: max,
    positionOffset: 0,
    positionByteLength,
    normalOffset,
    normalByteLength,
    indexOffset,
    indexByteLength,
  });
}

function fileNameForAsset(assetId: string): string {
  let sanitized = "";
  for (const character of assetId.normalize("NFC")) {
    sanitized += character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character)
      ? "-"
      : character;
  }
  const base = sanitized
    .replace(/[. ]+$/g, "")
    .slice(0, 120)
    .replace(/\.glb$/i, "");
  return `${base || "studio-editable-mesh"}.glb`;
}

function containerIssue(bytes: Uint8Array, expectedBinaryByteLength: number): StudioHybridDccGlbIssue | null {
  if (bytes.byteLength < 28 || bytes.byteLength % 4 !== 0) {
    return issue("error", "container-validation-failed", "GLB size is not a complete four-byte-aligned container");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== STUDIO_VRM_EXPORT_GLB_MAGIC ||
    view.getUint32(4, true) !== STUDIO_VRM_EXPORT_GLB_VERSION ||
    view.getUint32(8, true) !== bytes.byteLength
  ) {
    return issue("error", "container-validation-failed", "GLB header does not match the 2.0 container contract");
  }
  const jsonByteLength = view.getUint32(12, true);
  if (
    jsonByteLength % 4 !== 0 ||
    view.getUint32(16, true) !== STUDIO_VRM_EXPORT_JSON_CHUNK_TYPE
  ) {
    return issue("error", "container-validation-failed", "GLB JSON chunk is missing or misaligned");
  }
  const binChunkOffset = 20 + jsonByteLength;
  if (binChunkOffset % 4 !== 0 || binChunkOffset + 8 > bytes.byteLength) {
    return issue("error", "container-validation-failed", "GLB BIN chunk header is missing or misaligned");
  }
  const paddedBinaryByteLength = view.getUint32(binChunkOffset, true);
  if (
    paddedBinaryByteLength % 4 !== 0 ||
    paddedBinaryByteLength < expectedBinaryByteLength ||
    paddedBinaryByteLength - expectedBinaryByteLength > 3 ||
    view.getUint32(binChunkOffset + 4, true) !== STUDIO_VRM_EXPORT_BIN_CHUNK_TYPE ||
    binChunkOffset + 8 + paddedBinaryByteLength !== bytes.byteLength
  ) {
    return issue("error", "container-validation-failed", "GLB BIN chunk bounds or alignment are invalid");
  }
  return null;
}

type EncodedBinary = Extract<ReturnType<typeof encodeBinary>, { readonly ok: true }>["value"];

function buildGltfJson(
  input: StudioHybridDccMeshGlbExportInput,
  mesh: ValidatedMesh,
  geometry: BuiltGeometry,
  binary: EncodedBinary,
): Record<string, unknown> {
  const source = {
    authority: "editable-half-edge-mesh",
    assetId: input.assetId,
    sourceHash: input.sourceHash,
    sourceRevision: input.sourceRevision,
    meshSchemaRevision: input.mesh.revision,
  } as const;
  const faceTopology = mesh.faces.map((entry) => ({
    faceId: entry.face.id,
    halfEdgeIds: entry.halfEdgeIds,
    materialSlot: entry.face.materialSlot,
    smooth: entry.face.smooth,
    vertexIds: entry.vertexIds,
  }));
  const outputVertexCount = geometry.outputSourceVertexIds.length;
  return {
    asset: {
      version: "2.0",
      generator: STUDIO_HYBRID_DCC_GLB_EXPORT_GENERATOR,
      extras: { toonSpectrum: { provenance: source } },
    },
    scene: 0,
    scenes: [{ name: input.assetId, nodes: [0] }],
    nodes: [{
      name: input.assetId,
      mesh: 0,
      extras: { toonSpectrum: { sourceAssetId: input.assetId, sourceRevision: input.sourceRevision } },
    }],
    meshes: [{
      name: input.assetId,
      extras: { toonSpectrum: { provenance: source, sourceFaceTopology: faceTopology } },
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1 },
        indices: 2,
        mode: GLTF_TRIANGLES,
        extras: {
          toonSpectrum: {
            outputSourceNormalFaceIds: geometry.outputSourceNormalFaceIds,
            outputSourceVertexIds: geometry.outputSourceVertexIds,
            sourceFaceIdsByTriangle: geometry.triangleSourceFaceIds,
          },
        },
      }],
    }],
    buffers: [{ byteLength: binary.bytes.byteLength }],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: binary.positionOffset,
        byteLength: binary.positionByteLength,
        target: GLTF_ARRAY_BUFFER,
      },
      {
        buffer: 0,
        byteOffset: binary.normalOffset,
        byteLength: binary.normalByteLength,
        target: GLTF_ARRAY_BUFFER,
      },
      {
        buffer: 0,
        byteOffset: binary.indexOffset,
        byteLength: binary.indexByteLength,
        target: GLTF_ELEMENT_ARRAY_BUFFER,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: GLTF_COMPONENT_FLOAT,
        count: outputVertexCount,
        type: "VEC3",
        min: binary.boundsMin,
        max: binary.boundsMax,
      },
      {
        bufferView: 1,
        byteOffset: 0,
        componentType: GLTF_COMPONENT_FLOAT,
        count: outputVertexCount,
        type: "VEC3",
      },
      {
        bufferView: 2,
        byteOffset: 0,
        componentType: GLTF_COMPONENT_UNSIGNED_INT,
        count: geometry.indices.length,
        type: "SCALAR",
        min: [minimumNumber(geometry.indices)],
        max: [maximumNumber(geometry.indices)],
      },
    ],
    extras: {
      toonSpectrum: {
        provenance: source,
        sourceCounts: {
          vertices: input.mesh.vertices.length,
          halfEdges: input.mesh.halfEdges.length,
          faces: input.mesh.faces.length,
        },
        topology: {
          boundaryEdges: mesh.boundaryEdgeCount,
          triangles: geometry.indices.length / 3,
        },
      },
    },
  };
}

/**
 * Export an authoring half-edge mesh to a deterministic, self-contained GLB 2.0 byte snapshot.
 * Invalid or unsupported topology never yields partial bytes.
 */
export function exportStudioHybridDccMeshGlb(
  input: StudioHybridDccMeshGlbExportInput,
): StudioHybridDccMeshGlbExportResult {
  const partial = isRecord(input) ? input as Partial<StudioHybridDccMeshGlbExportInput> : {};
  if (!isRecord(input)) {
    return blockedReport(partial, issue("error", "invalid-input", "GLB export input is required"));
  }
  if (typeof input.assetId !== "string" || input.assetId.length === 0 || input.assetId.length > 160) {
    return blockedReport(partial, issue("error", "invalid-source-id", "assetId must contain 1-160 characters"));
  }
  if (!Number.isSafeInteger(input.sourceRevision) || input.sourceRevision <= 0) {
    return blockedReport(partial, issue("error", "invalid-source-revision", "sourceRevision must be a positive safe integer"));
  }
  if (typeof input.sourceHash !== "string" || input.sourceHash.length === 0 || input.sourceHash.length > 160) {
    return blockedReport(partial, issue("error", "invalid-source-hash", "sourceHash must contain 1-160 characters"));
  }

  try {
    const validated = validateMesh(input.mesh);
    if (!validated.ok) return blockedReport(input, validated.issue);
    const actualHash = hashStudioEditableMesh(input.mesh);
    if (actualHash !== input.sourceHash) {
      return blockedReport(
        input,
        issue("error", "source-hash-mismatch", "sourceHash does not identify the supplied authoring mesh"),
        validated.value.losses,
        validated.value.warnings,
        validated.value.warningCount,
      );
    }
    const geometry = buildGeometry(validated.value);
    if (!geometry.ok) {
      return blockedReport(
        input,
        geometry.issue,
        validated.value.losses,
        validated.value.warnings,
        validated.value.warningCount,
      );
    }
    const binary = encodeBinary(geometry.value);
    if (!binary.ok) {
      return blockedReport(
        input,
        binary.issue,
        validated.value.losses,
        validated.value.warnings,
        validated.value.warningCount,
      );
    }
    const json = buildGltfJson(input, validated.value, geometry.value, binary.value);
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = writeStudioVrmExportGlb({ json, binary: binary.value.bytes });
    } catch (error) {
      const writerCode = isRecord(error) && typeof error.code === "string" ? error.code : "unknown";
      return blockedReport(
        input,
        issue("error", "container-write-failed", `GLB container writer rejected the export (${writerCode})`),
        validated.value.losses,
        validated.value.warnings,
        validated.value.warningCount,
      );
    }
    const invalidContainer = containerIssue(bytes, binary.value.bytes.byteLength);
    if (invalidContainer) {
      return blockedReport(
        input,
        invalidContainer,
        validated.value.losses,
        validated.value.warnings,
        validated.value.warningCount,
      );
    }
    const metrics: StudioHybridDccGlbExportMetrics = {
      sourceVertexCount: input.mesh.vertices.length,
      sourceHalfEdgeCount: input.mesh.halfEdges.length,
      sourceFaceCount: input.mesh.faces.length,
      outputVertexCount: geometry.value.outputSourceVertexIds.length,
      triangleCount: geometry.value.indices.length / 3,
      vertices: geometry.value.outputSourceVertexIds.length,
      triangles: geometry.value.indices.length / 3,
      positionByteLength: binary.value.positionByteLength,
      normalByteLength: binary.value.normalByteLength,
      indexByteLength: binary.value.indexByteLength,
      binaryByteLength: binary.value.bytes.byteLength,
      glbByteLength: bytes.byteLength,
    };
    const diagnostics = boundedDiagnostics([], validated.value.losses, validated.value.warnings, {
      warnings: validated.value.warningCount,
    });
    return {
      ok: true,
      bytes,
      fileName: fileNameForAsset(input.assetId),
      mimeType: STUDIO_HYBRID_DCC_GLB_MIME_TYPE,
      metrics,
      report: {
        format: STUDIO_HYBRID_DCC_GLB_EXPORT_FORMAT,
        revision: STUDIO_HYBRID_DCC_GLB_EXPORT_REVISION,
        status: "exported",
        source: reportSource(input),
        ...diagnostics,
      },
    };
  } catch {
    return blockedReport(
      input,
      issue("error", "invalid-input", "Editable mesh export failed before a complete GLB could be produced"),
    );
  }
}

/**
 * Synchronous authority convenience. Non-empty modifier stacks fail closed because this API cannot
 * evaluate asynchronous Boolean backends; callers must apply the stack or use the BG3D handoff.
 */
export function exportStudioHybridDccAuthorityRecordGlb(
  record: Pick<
    StudioGeometryAuthorityRecord,
    "assetId" | "kernel" | "mesh" | "meshHash" | "modifierStack" | "revision"
  >,
): StudioHybridDccMeshGlbExportResult {
  if (record.kernel !== "half-edge") {
    const input = {
      assetId: record.assetId,
      mesh: record.mesh,
      sourceRevision: record.revision,
      sourceHash: record.meshHash,
    };
    return blockedReport(
      input,
      issue("error", "authority-not-editable-mesh", "Only the editable half-edge authority can be exported"),
    );
  }
  if (record.modifierStack.modifiers.length > 0) {
    const input = {
      assetId: record.assetId,
      mesh: record.mesh,
      sourceRevision: record.revision,
      sourceHash: record.meshHash,
    };
    return blockedReport(
      input,
      issue(
        "error",
        "modifier-stack-unapplied",
        "Non-empty modifier stacks require evaluation or explicit application before synchronous export",
      ),
    );
  }
  return exportStudioHybridDccMeshGlb({
    assetId: record.assetId,
    mesh: record.mesh,
    sourceRevision: record.revision,
    sourceHash: record.meshHash,
  });
}
