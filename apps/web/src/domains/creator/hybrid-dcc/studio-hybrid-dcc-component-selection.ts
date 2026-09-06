/**
 * Hybrid DCC component-selection authority.
 *
 * Object selection is kept alongside single-object vertex/edge/face edit selection so a future
 * viewport can switch modes without treating Three.js ray hits as document authority. Component
 * IDs are stable IDs from the editable half-edge mesh. User-facing edge IDs are always the lower
 * of a half-edge/twin pair, making one undirected edge one selectable element.
 */

import {
  hashStudioEditableMesh,
  isIssuedStudioEditableMeshExtrudeRegionReceipt,
  STUDIO_EDITABLE_MESH_LIMITS,
  STUDIO_EDITABLE_MESH_REVISION,
  type StudioEditableFace,
  type StudioEditableMeshExtrudeRegionReceipt,
  type StudioEditableHalfEdge,
  type StudioEditableMesh,
} from "../studio-editable-half-edge-mesh";

export const STUDIO_HYBRID_DCC_COMPONENT_SELECTION_REVISION = 1 as const;
export const STUDIO_HYBRID_DCC_COMPONENT_SELECTION_SNAPSHOT_VERSION = 1 as const;
export const STUDIO_HYBRID_DCC_COMPONENT_SELECTION_FORMAT =
  "toonspectrum.hybrid-dcc.component-selection" as const;

export const STUDIO_HYBRID_DCC_COMPONENT_SELECTION_LIMITS = Object.freeze({
  maxSelectedObjects: 1_024,
  maxSelectedElements: STUDIO_EDITABLE_MESH_LIMITS.maxSelection,
  maxObjectIdLength: 160,
  maxSourceHashLength: 160,
  maxSnapshotCharacters: 2_000_000,
  maxDiagnosticIds: 128,
  maxFaceCorners: 4_096,
  maxTopologyWork: 1_500_000,
});

export type StudioHybridDccSelectionMode = "object" | "vertex" | "edge" | "face";
export type StudioHybridDccComponentMode = Exclude<StudioHybridDccSelectionMode, "object">;
export type StudioHybridDccSelectionOperation = "replace" | "add" | "toggle" | "subtract";

export interface StudioHybridDccSelectionProvenance {
  readonly assetId: string;
  readonly meshRevision: number;
  readonly sourceHash: string;
}

/**
 * Canonical selection state. Component edit mode is intentionally single-object: objectIds must
 * contain exactly provenance.assetId, while object mode supports a bounded multi-object set.
 */
export interface StudioHybridDccComponentSelection {
  readonly revision: typeof STUDIO_HYBRID_DCC_COMPONENT_SELECTION_REVISION;
  readonly mode: StudioHybridDccSelectionMode;
  readonly objectIds: readonly string[];
  readonly activeObjectId: string | null;
  readonly elementIds: readonly number[];
  readonly activeElementId: number | null;
  readonly provenance: StudioHybridDccSelectionProvenance | null;
}

export interface StudioHybridDccComponentSelectionSnapshot {
  readonly format: typeof STUDIO_HYBRID_DCC_COMPONENT_SELECTION_FORMAT;
  readonly version: typeof STUDIO_HYBRID_DCC_COMPONENT_SELECTION_SNAPSHOT_VERSION;
  readonly revision: typeof STUDIO_HYBRID_DCC_COMPONENT_SELECTION_REVISION;
  readonly mode: StudioHybridDccSelectionMode;
  readonly objectIds: readonly string[];
  readonly activeObjectId: string | null;
  readonly elementIds: readonly number[];
  readonly activeElementId: number | null;
  readonly provenance: StudioHybridDccSelectionProvenance | null;
}

export interface StudioHybridDccMeshSelectionSource {
  readonly assetId: string;
  readonly mesh: StudioEditableMesh;
  /** Geometry-authority record revision, not the editable-mesh schema revision. */
  readonly meshRevision: number;
  readonly sourceHash: string;
}

export type StudioHybridDccSelectionDiagnosticCode =
  | "active-element-not-selected"
  | "active-object-not-selected"
  | "asset-mismatch"
  | "component-object-cardinality"
  | "duplicate-stable-id"
  | "element-not-found"
  | "element-selection-in-object-mode"
  | "invalid-active-element-id"
  | "invalid-active-object-id"
  | "invalid-mesh"
  | "invalid-mode"
  | "invalid-object-id"
  | "invalid-operation"
  | "invalid-provenance"
  | "invalid-stable-id"
  | "malformed-snapshot"
  | "missing-active-element"
  | "missing-active-object"
  | "missing-provenance"
  | "non-canonical-edge-id"
  | "selection-budget-exceeded"
  | "snapshot-too-large"
  | "source-hash-mismatch"
  | "stale-mesh-revision"
  | "stale-source-hash"
  | "invalid-topology-receipt"
  | "topology-provenance-refreshed"
  | "topology-receipt-result-mismatch"
  | "topology-receipt-source-mismatch"
  | "topology-selection-pruned"
  | "topology-selection-remapped"
  | "unsorted-stable-ids"
  | "unsupported-format"
  | "unsupported-revision"
  | "unsupported-version";

export interface StudioHybridDccSelectionDiagnostic {
  readonly code: StudioHybridDccSelectionDiagnosticCode;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
  readonly elementIds?: readonly number[];
  readonly objectIds?: readonly string[];
}

export type StudioHybridDccSelectionResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly diagnostics: readonly StudioHybridDccSelectionDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly StudioHybridDccSelectionDiagnostic[];
    };

export interface StudioHybridDccObjectSelectionMutation {
  readonly mode: "object";
  readonly operation: StudioHybridDccSelectionOperation;
  readonly ids: readonly string[];
  readonly activeId?: string | null;
}

export interface StudioHybridDccElementSelectionMutation {
  readonly mode: StudioHybridDccComponentMode;
  readonly operation: StudioHybridDccSelectionOperation;
  /** Half-edge IDs are accepted in edge mode and canonicalized to undirected IDs. */
  readonly ids: readonly number[];
  readonly activeId?: number | null;
  readonly source: StudioHybridDccMeshSelectionSource;
}

export type StudioHybridDccSelectionMutation =
  | StudioHybridDccObjectSelectionMutation
  | StudioHybridDccElementSelectionMutation;

export interface StudioHybridDccTopologyIdRemap {
  /** Missing entries preserve the same stable ID; a null target explicitly deletes an ID. */
  readonly entries: readonly (readonly [number, number | null])[];
}

export interface StudioHybridDccTopologySelectionRemap {
  readonly vertex?: StudioHybridDccTopologyIdRemap;
  readonly edge?: StudioHybridDccTopologyIdRemap;
  readonly face?: StudioHybridDccTopologyIdRemap;
}

export interface StudioHybridDccResolvedElementIds {
  readonly ids: readonly number[];
  readonly activeId: number;
  readonly usedDefault: boolean;
}

export interface StudioHybridDccRayEdgeCandidate {
  /** Canonical undirected half-edge ID. */
  readonly id: number;
  /** Stable endpoint vertex IDs in ascending order. */
  readonly vertexIds: readonly [number, number];
}

export interface StudioHybridDccRayHitMapping {
  readonly faceIndex: number;
  readonly faceId: number;
  readonly triangleIndexWithinFace: number;
  /** Ordered polygon loop, before fan triangulation. */
  readonly faceVertexIds: readonly number[];
  /** Ordered fan-triangle vertices for this exact renderer faceIndex. */
  readonly triangleVertexIds: readonly [number, number, number];
  /** Stable vertex candidates for point-selection hit refinement. */
  readonly vertexCandidateIds: readonly number[];
  /** All boundary edges of the polygon, suitable for nearest-edge hit refinement. */
  readonly edgeCandidates: readonly StudioHybridDccRayEdgeCandidate[];
  readonly provenance: StudioHybridDccSelectionProvenance;
}

interface StudioHybridDccIndexedFace {
  readonly face: StudioEditableFace;
  readonly vertexIds: readonly number[];
  readonly edges: readonly StudioHybridDccRayEdgeCandidate[];
  readonly triangleStart: number;
  readonly triangleCount: number;
}

interface StudioHybridDccMeshSelectionIndex {
  readonly vertexIds: ReadonlySet<number>;
  readonly faceById: ReadonlyMap<number, StudioHybridDccIndexedFace>;
  readonly canonicalEdgeIds: ReadonlySet<number>;
  readonly canonicalEdgeByHalfEdgeId: ReadonlyMap<number, number>;
  readonly facesInRenderOrder: readonly StudioHybridDccIndexedFace[];
  readonly triangleCount: number;
}

const meshSelectionIndexCache = new WeakMap<
  StudioEditableMesh,
  StudioHybridDccSelectionResult<StudioHybridDccMeshSelectionIndex>
>();
// Editable meshes are immutable authority values: every topology commit publishes a new object.
// Cache the verified content hash alongside the already-cached topology index so repeated pointer
// selection stays O(1) after the first bounded verification instead of hashing a large mesh twice.
const meshSelectionSourceHashCache = new WeakMap<StudioEditableMesh, string>();

function diagnostic(
  code: StudioHybridDccSelectionDiagnosticCode,
  message: string,
  options: {
    readonly severity?: StudioHybridDccSelectionDiagnostic["severity"];
    readonly elementIds?: readonly number[];
    readonly objectIds?: readonly string[];
  } = {},
): StudioHybridDccSelectionDiagnostic {
  const max = STUDIO_HYBRID_DCC_COMPONENT_SELECTION_LIMITS.maxDiagnosticIds;
  return Object.freeze({
    code,
    severity: options.severity ?? "error",
    message,
    ...(options.elementIds
      ? { elementIds: Object.freeze([...options.elementIds].slice(0, max)) }
      : {}),
    ...(options.objectIds
      ? { objectIds: Object.freeze([...options.objectIds].slice(0, max)) }
      : {}),
  });
}

function success<T>(
  value: T,
  diagnostics: readonly StudioHybridDccSelectionDiagnostic[] = [],
): StudioHybridDccSelectionResult<T> {
  return { ok: true, value, diagnostics: Object.freeze([...diagnostics]) };
}

function failure<T>(
  ...diagnostics: readonly StudioHybridDccSelectionDiagnostic[]
): StudioHybridDccSelectionResult<T> {
  return { ok: false, diagnostics: Object.freeze([...diagnostics]) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).toSorted();
  const expected = [...keys].toSorted();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isSelectionMode(value: unknown): value is StudioHybridDccSelectionMode {
  return value === "object" || value === "vertex" || value === "edge" || value === "face";
}

function isSelectionOperation(value: unknown): value is StudioHybridDccSelectionOperation {
  return value === "replace" || value === "add" || value === "toggle" || value === "subtract";
}

function isStableId(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isObjectId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= STUDIO_HYBRID_DCC_COMPONENT_SELECTION_LIMITS.maxObjectIdLength
    && value.trim().length > 0
    && !hasControlCharacter(value);
}

function isSourceHash(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= STUDIO_HYBRID_DCC_COMPONENT_SELECTION_LIMITS.maxSourceHashLength
    && !hasControlCharacter(value);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isStrictlySortedNumbers(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}

function isStrictlySortedStrings(values: readonly string[]): boolean {
  return values.every((value, index) => (
    index === 0 || compareCodeUnits(values[index - 1]!, value) < 0
  ));
}

function sortedUniqueNumbers(values: Iterable<number>): readonly number[] {
  return Object.freeze([...new Set(values)].toSorted((left, right) => left - right));
}

function sortedUniqueStrings(values: Iterable<string>): readonly string[] {
  return Object.freeze([...new Set(values)].toSorted(compareCodeUnits));
}

function canonicalSelection(
  input: Omit<StudioHybridDccComponentSelection, "revision">,
): StudioHybridDccComponentSelection {
  return Object.freeze({
    revision: STUDIO_HYBRID_DCC_COMPONENT_SELECTION_REVISION,
    mode: input.mode,
    objectIds: Object.freeze([...input.objectIds]),
    activeObjectId: input.activeObjectId,
    elementIds: Object.freeze([...input.elementIds]),
    activeElementId: input.activeElementId,
    provenance: input.provenance ? Object.freeze({ ...input.provenance }) : null,
  });
}

export function createStudioHybridDccComponentSelection(): StudioHybridDccComponentSelection {
  return canonicalSelection({
    mode: "object",
    objectIds: [],
    activeObjectId: null,
    elementIds: [],
    activeElementId: null,
    provenance: null,
  });
}

function meshInvalid(detail: string): StudioHybridDccSelectionResult<never> {
  return failure(diagnostic("invalid-mesh", `Selection mesh is invalid: ${detail}`));
}

function buildStudioHybridDccMeshSelectionIndex(
  mesh: StudioEditableMesh,
): StudioHybridDccSelectionResult<StudioHybridDccMeshSelectionIndex> {
  const cached = meshSelectionIndexCache.get(mesh);
  if (cached) return cached;

  let result: StudioHybridDccSelectionResult<StudioHybridDccMeshSelectionIndex>;
  try {
    if (mesh.revision !== STUDIO_EDITABLE_MESH_REVISION) throw new Error("unsupported schema");
    if (mesh.vertices.length > STUDIO_EDITABLE_MESH_LIMITS.maxVertices
      || mesh.faces.length > STUDIO_EDITABLE_MESH_LIMITS.maxFaces
      || mesh.halfEdges.length > STUDIO_EDITABLE_MESH_LIMITS.maxEdges * 2
      || mesh.vertices.length + mesh.faces.length + mesh.halfEdges.length
        > STUDIO_HYBRID_DCC_COMPONENT_SELECTION_LIMITS.maxTopologyWork) {
      throw new Error("topology budget exceeded");
    }

    const vertexIds = new Set<number>();
    for (const vertex of mesh.vertices) {
      if (!isStableId(vertex.id) || vertexIds.has(vertex.id)) {
        throw new Error("vertex stable IDs must be unique non-negative safe integers");
      }
      if (!Number.isFinite(vertex.position.x)
        || !Number.isFinite(vertex.position.y)
        || !Number.isFinite(vertex.position.z)) {
        throw new Error(`vertex ${vertex.id} has a non-finite position`);
      }
      vertexIds.add(vertex.id);
    }

    const faceByStableId = new Map<number, StudioEditableFace>();
    for (const face of mesh.faces) {
      if (!isStableId(face.id) || faceByStableId.has(face.id)) {
        throw new Error("face stable IDs must be unique non-negative safe integers");
      }
      faceByStableId.set(face.id, face);
    }

    const halfEdgeById = new Map<number, StudioEditableHalfEdge>();
    mesh.halfEdges.forEach((halfEdge, index) => {
      // The current editable-mesh kernel dereferences links by array index. Keep that invariant
      // explicit here instead of accepting a mesh that other authoring operations cannot address.
      if (!isStableId(halfEdge.id) || halfEdge.id !== index || halfEdgeById.has(halfEdge.id)) {
        throw new Error("half-edge stable ID must equal its storage index");
      }
      halfEdgeById.set(halfEdge.id, halfEdge);
    });

    for (const halfEdge of mesh.halfEdges) {
      if (!vertexIds.has(halfEdge.vertex)
        || !isStableId(halfEdge.next)
        || !isStableId(halfEdge.prev)
        || !halfEdgeById.has(halfEdge.next)
        || !halfEdgeById.has(halfEdge.prev)
        || (halfEdge.face !== -1 && !faceByStableId.has(halfEdge.face))
        || (halfEdge.twin !== -1 && (!isStableId(halfEdge.twin) || !halfEdgeById.has(halfEdge.twin)))) {
        throw new Error(`half-edge ${halfEdge.id} has a missing link`);
      }
      const next = halfEdgeById.get(halfEdge.next)!;
      const previous = halfEdgeById.get(halfEdge.prev)!;
      if (next.prev !== halfEdge.id || previous.next !== halfEdge.id) {
        throw new Error(`half-edge ${halfEdge.id} has asymmetric next/previous links`);
      }
      if (halfEdge.twin >= 0) {
        const twin = halfEdgeById.get(halfEdge.twin)!;
        if (twin.twin !== halfEdge.id) {
          throw new Error(`half-edge ${halfEdge.id} has an asymmetric twin`);
        }
        const origin = previous.vertex;
        const twinOrigin = halfEdgeById.get(twin.prev)!.vertex;
        if (origin !== twin.vertex || halfEdge.vertex !== twinOrigin) {
          throw new Error(`half-edge ${halfEdge.id} twin endpoints do not reverse`);
        }
      }
    }

    for (const vertex of mesh.vertices) {
      if (vertex.he === -1) continue;
      const outgoing = halfEdgeById.get(vertex.he);
      if (!outgoing || halfEdgeById.get(outgoing.prev)!.vertex !== vertex.id) {
        throw new Error(`vertex ${vertex.id} has an invalid outgoing half-edge`);
      }
    }

    const canonicalEdgeByHalfEdgeId = new Map<number, number>();
    const canonicalEdgeIds = new Set<number>();
    for (const halfEdge of mesh.halfEdges) {
      const edgeId = halfEdge.twin < 0 ? halfEdge.id : Math.min(halfEdge.id, halfEdge.twin);
      canonicalEdgeByHalfEdgeId.set(halfEdge.id, edgeId);
      canonicalEdgeIds.add(edgeId);
    }

    const ownedHalfEdges = new Set<number>();
    const indexedFaces: StudioHybridDccIndexedFace[] = [];
    let triangleStart = 0;
    for (const face of mesh.faces) {
      if (!isStableId(face.he) || !halfEdgeById.has(face.he)) {
        throw new Error(`face ${face.id} has no boundary half-edge`);
      }
      const vertexLoop: number[] = [];
      const edgeLoop: StudioHybridDccRayEdgeCandidate[] = [];
      const seen = new Set<number>();
      const seenVertices = new Set<number>();
      let halfEdgeId = face.he;
      while (true) {
        if (seen.has(halfEdgeId)) {
          if (halfEdgeId !== face.he) throw new Error(`face ${face.id} loop self-intersects`);
          break;
        }
        if (seen.size >= STUDIO_HYBRID_DCC_COMPONENT_SELECTION_LIMITS.maxFaceCorners) {
          throw new Error(`face ${face.id} exceeds the corner budget`);
        }
        const halfEdge = halfEdgeById.get(halfEdgeId);
        if (!halfEdge || halfEdge.face !== face.id || ownedHalfEdges.has(halfEdge.id)) {
          throw new Error(`face ${face.id} does not exclusively own its loop`);
        }
        seen.add(halfEdge.id);
        ownedHalfEdges.add(halfEdge.id);
        const origin = halfEdgeById.get(halfEdge.prev)!.vertex;
        const destination = halfEdge.vertex;
        if (origin === destination || seenVertices.has(origin)) {
          throw new Error(`face ${face.id} repeats a vertex`);
        }
        seenVertices.add(origin);
        vertexLoop.push(origin);
        edgeLoop.push(Object.freeze({
          id: canonicalEdgeByHalfEdgeId.get(halfEdge.id)!,
          vertexIds: Object.freeze([
            Math.min(origin, destination),
            Math.max(origin, destination),
          ]) as readonly [number, number],
        }));
        halfEdgeId = halfEdge.next;
      }
      if (vertexLoop.length < 3) throw new Error(`face ${face.id} has fewer than three vertices`);
      const triangleCount = vertexLoop.length - 2;
      indexedFaces.push(Object.freeze({
        face,
        vertexIds: Object.freeze(vertexLoop),
        edges: Object.freeze(edgeLoop.toSorted((left, right) => left.id - right.id)),
        triangleStart,
        triangleCount,
      }));
      triangleStart += triangleCount;
      if (!Number.isSafeInteger(triangleStart)) throw new Error("triangle count overflow");
    }
    if (ownedHalfEdges.size !== mesh.halfEdges.length) {
      throw new Error("orphan or boundary-record half-edges are not supported by the current kernel");
    }

    let maxVertexId = -1;
    for (const vertexId of vertexIds) maxVertexId = Math.max(maxVertexId, vertexId);
    let maxFaceId = -1;
    for (const faceId of faceByStableId.keys()) maxFaceId = Math.max(maxFaceId, faceId);
    const maxHalfEdgeId = mesh.halfEdges.length - 1;
    if (!Number.isSafeInteger(mesh.nextVertexId) || mesh.nextVertexId <= maxVertexId
      || !Number.isSafeInteger(mesh.nextFaceId) || mesh.nextFaceId <= maxFaceId
      || !Number.isSafeInteger(mesh.nextHalfEdgeId) || mesh.nextHalfEdgeId <= maxHalfEdgeId) {
      throw new Error("stable-ID counters do not exceed live IDs");
    }

    const faceById = new Map(indexedFaces.map((indexed) => [indexed.face.id, indexed] as const));
    result = success(Object.freeze({
      vertexIds,
      faceById,
      canonicalEdgeIds,
      canonicalEdgeByHalfEdgeId,
      facesInRenderOrder: Object.freeze(indexedFaces),
      triangleCount: triangleStart,
    }));
  } catch (error) {
    result = meshInvalid(error instanceof Error ? error.message : "unknown topology failure");
  }
  meshSelectionIndexCache.set(mesh, result);
  return result;
}

function verifySource(
  source: StudioHybridDccMeshSelectionSource,
): StudioHybridDccSelectionResult<{
  readonly index: StudioHybridDccMeshSelectionIndex;
  readonly provenance: StudioHybridDccSelectionProvenance;
}> {
  if (!isObjectId(source.assetId)
    || !Number.isSafeInteger(source.meshRevision)
    || source.meshRevision < 1
    || !isSourceHash(source.sourceHash)) {
    return failure(diagnostic("invalid-provenance", "Mesh source provenance is malformed."));
  }
  const indexed = buildStudioHybridDccMeshSelectionIndex(source.mesh);
  if (!indexed.ok) return indexed;
  let actualHash: string;
  try {
    actualHash = meshSelectionSourceHashCache.get(source.mesh)
      ?? hashStudioEditableMesh(source.mesh);
    meshSelectionSourceHashCache.set(source.mesh, actualHash);
  } catch {
    return meshInvalid("source hash could not be computed");
  }
  if (actualHash !== source.sourceHash) {
    return failure(diagnostic(
      "source-hash-mismatch",
      "The supplied sourceHash does not identify the supplied editable mesh.",
    ));
  }
  return success({
    index: indexed.value,
    provenance: Object.freeze({
      assetId: source.assetId,
      meshRevision: source.meshRevision,
      sourceHash: source.sourceHash,
    }),
  });
}

function structuralDiagnostics(
  selection: StudioHybridDccComponentSelection,
): readonly StudioHybridDccSelectionDiagnostic[] {
  const diagnostics: StudioHybridDccSelectionDiagnostic[] = [];
  if (selection.revision !== STUDIO_HYBRID_DCC_COMPONENT_SELECTION_REVISION) {
    diagnostics.push(diagnostic("unsupported-revision", "Selection authority revision is unsupported."));
  }
  if (!isSelectionMode(selection.mode)) {
    diagnostics.push(diagnostic("invalid-mode", "Selection mode is invalid."));
  }
  if (selection.objectIds.length > STUDIO_HYBRID_DCC_COMPONENT_SELECTION_LIMITS.maxSelectedObjects
    || selection.elementIds.length
      > STUDIO_HYBRID_DCC_COMPONENT_SELECTION_LIMITS.maxSelectedElements) {
    diagnostics.push(diagnostic("selection-budget-exceeded", "Selection exceeds the soft limit."));
  }
  if (!selection.objectIds.every(isObjectId)) {
    diagnostics.push(diagnostic("invalid-object-id", "Object selection contains an invalid ID."));
  } else if (!isStrictlySortedStrings(selection.objectIds)) {
    diagnostics.push(diagnostic(
      new Set(selection.objectIds).size === selection.objectIds.length
        ? "unsorted-stable-ids"
        : "duplicate-stable-id",
      "Object IDs must be unique and sorted by code unit.",
      { objectIds: selection.objectIds },
    ));
  }
  if (!selection.elementIds.every(isStableId)) {
    diagnostics.push(diagnostic("invalid-stable-id", "Element selection contains an invalid stable ID."));
  } else if (!isStrictlySortedNumbers(selection.elementIds)) {
    diagnostics.push(diagnostic(
      new Set(selection.elementIds).size === selection.elementIds.length
        ? "unsorted-stable-ids"
        : "duplicate-stable-id",
      "Element stable IDs must be unique and ascending.",
      { elementIds: selection.elementIds },
    ));
  }
  if (selection.activeObjectId !== null && !isObjectId(selection.activeObjectId)) {
    diagnostics.push(diagnostic("invalid-active-object-id", "Active object ID is invalid."));
  } else if (selection.activeObjectId !== null
    && !selection.objectIds.includes(selection.activeObjectId)) {
    diagnostics.push(diagnostic("active-object-not-selected", "Active object must be selected."));
  } else if (selection.objectIds.length > 0 && selection.activeObjectId === null) {
    diagnostics.push(diagnostic("missing-active-object", "A non-empty object selection needs an active object."));
  }
  if (selection.activeElementId !== null && !isStableId(selection.activeElementId)) {
    diagnostics.push(diagnostic("invalid-active-element-id", "Active element ID is invalid."));
  } else if (selection.activeElementId !== null
    && !selection.elementIds.includes(selection.activeElementId)) {
    diagnostics.push(diagnostic("active-element-not-selected", "Active element must be selected."));
  } else if (selection.elementIds.length > 0 && selection.activeElementId === null) {
    diagnostics.push(diagnostic("missing-active-element", "A non-empty component selection needs an active element."));
  }

  if (selection.mode === "object") {
    if (selection.elementIds.length > 0 || selection.activeElementId !== null) {
      diagnostics.push(diagnostic(
        "element-selection-in-object-mode",
        "Object mode cannot retain component IDs.",
      ));
    }
    if (selection.provenance !== null) {
      diagnostics.push(diagnostic("invalid-provenance", "Object mode cannot retain mesh provenance."));
    }
  } else {
    if (!selection.provenance) {
      diagnostics.push(diagnostic("missing-provenance", "Component mode requires mesh provenance."));
    } else if (!isObjectId(selection.provenance.assetId)
      || !Number.isSafeInteger(selection.provenance.meshRevision)
      || selection.provenance.meshRevision < 1
      || !isSourceHash(selection.provenance.sourceHash)) {
      diagnostics.push(diagnostic("invalid-provenance", "Component selection provenance is malformed."));
    } else if (selection.objectIds.length !== 1
      || selection.activeObjectId !== selection.provenance.assetId
      || selection.objectIds[0] !== selection.provenance.assetId) {
      diagnostics.push(diagnostic(
        "component-object-cardinality",
        "Component mode must target exactly one active object matching provenance.",
      ));
    }
  }
  return Object.freeze(diagnostics);
}

export function validateStudioHybridDccComponentSelection(
  selection: StudioHybridDccComponentSelection,
  source?: StudioHybridDccMeshSelectionSource,
): StudioHybridDccSelectionResult<StudioHybridDccComponentSelection> {
  const structure = structuralDiagnostics(selection);
  if (structure.length > 0) return failure(...structure);
  if (!source) return success(selection);
  const verified = verifySource(source);
  if (!verified.ok) return verified;
  if (selection.mode === "object") return success(selection);

  const stale: StudioHybridDccSelectionDiagnostic[] = [];
  if (selection.provenance!.assetId !== source.assetId) {
    stale.push(diagnostic("asset-mismatch", "Selection belongs to another object."));
  }
  if (selection.provenance!.meshRevision !== source.meshRevision) {
    stale.push(diagnostic("stale-mesh-revision", "Selection mesh revision is stale."));
  }
  if (selection.provenance!.sourceHash !== source.sourceHash) {
    stale.push(diagnostic("stale-source-hash", "Selection source hash is stale."));
  }
  if (stale.length > 0) return failure(...stale);

  const index = verified.value.index;
  const liveIds = selection.mode === "vertex"
    ? index.vertexIds
    : selection.mode === "face"
      ? new Set(index.faceById.keys())
      : index.canonicalEdgeIds;
  const missing = selection.elementIds.filter((id) => !liveIds.has(id));
  if (missing.length > 0) {
    return failure(diagnostic(
      "element-not-found",
      "Selection contains stable IDs that are absent from the current mesh.",
      { elementIds: missing },
    ));
  }
  if (selection.mode === "edge") {
    const nonCanonical = selection.elementIds.filter((id) => (
      index.canonicalEdgeByHalfEdgeId.get(id) !== id
    ));
    if (nonCanonical.length > 0) {
      return failure(diagnostic(
        "non-canonical-edge-id",
        "Edge selection must use canonical undirected half-edge IDs.",
        { elementIds: nonCanonical },
      ));
    }
  }
  return success(selection);
}

function applyStringOperation(
  current: readonly string[],
  targets: readonly string[],
  operation: StudioHybridDccSelectionOperation,
): readonly string[] {
  if (operation === "replace") return sortedUniqueStrings(targets);
  const next = new Set(current);
  for (const target of targets) {
    if (operation === "add") next.add(target);
    if (operation === "subtract") next.delete(target);
    if (operation === "toggle") {
      if (next.has(target)) next.delete(target);
      else next.add(target);
    }
  }
  return sortedUniqueStrings(next);
}

function applyNumberOperation(
  current: readonly number[],
  targets: readonly number[],
  operation: StudioHybridDccSelectionOperation,
): readonly number[] {
  if (operation === "replace") return sortedUniqueNumbers(targets);
  const next = new Set(current);
  for (const target of targets) {
    if (operation === "add") next.add(target);
    if (operation === "subtract") next.delete(target);
    if (operation === "toggle") {
      if (next.has(target)) next.delete(target);
      else next.add(target);
    }
  }
  return sortedUniqueNumbers(next);
}

function automaticStringActive(
  next: readonly string[],
  targets: readonly string[],
  currentActive: string | null,
  operation: StudioHybridDccSelectionOperation,
): string | null {
  if (next.length === 0) return null;
  if (operation !== "subtract") {
    const selected = new Set(next);
    for (let index = targets.length - 1; index >= 0; index -= 1) {
      if (selected.has(targets[index]!)) return targets[index]!;
    }
  }
  if (currentActive && next.includes(currentActive)) return currentActive;
  return next.at(-1)!;
}

function automaticNumberActive(
  next: readonly number[],
  targets: readonly number[],
  currentActive: number | null,
  operation: StudioHybridDccSelectionOperation,
): number | null {
  if (next.length === 0) return null;
  if (operation !== "subtract") {
    const selected = new Set(next);
    for (let index = targets.length - 1; index >= 0; index -= 1) {
      if (selected.has(targets[index]!)) return targets[index]!;
    }
  }
  if (currentActive !== null && next.includes(currentActive)) return currentActive;
  return next.at(-1)!;
}

export function mutateStudioHybridDccComponentSelection(
  selection: StudioHybridDccComponentSelection,
  mutation: StudioHybridDccSelectionMutation,
): StudioHybridDccSelectionResult<StudioHybridDccComponentSelection> {
  const structure = validateStudioHybridDccComponentSelection(selection);
  if (!structure.ok) return structure;
  if (!isSelectionOperation(mutation.operation)) {
    return failure(diagnostic("invalid-operation", "Selection operation is invalid."));
  }

  if (mutation.mode === "object") {
    if (mutation.ids.length
      > STUDIO_HYBRID_DCC_COMPONENT_SELECTION_LIMITS.maxSelectedObjects) {
      return failure(diagnostic("selection-budget-exceeded", "Object selection is too large."));
    }
    const invalid = mutation.ids.filter((id) => !isObjectId(id));
    if (invalid.length > 0) {
      return failure(diagnostic(
        "invalid-object-id",
        "Object mutation contains an invalid ID.",
        { objectIds: invalid },
      ));
    }
    const currentObjects = selection.objectIds;
    const targets = sortedUniqueStrings(mutation.ids);
    const objectIds = applyStringOperation(currentObjects, targets, mutation.operation);
    let activeObjectId = automaticStringActive(
      objectIds,
      targets,
      selection.activeObjectId,
      mutation.operation,
    );
    if (mutation.activeId !== undefined) {
      if (mutation.activeId !== null && !objectIds.includes(mutation.activeId)) {
        return failure(diagnostic("active-object-not-selected", "Requested active object is not selected."));
      }
      activeObjectId = mutation.activeId;
    }
    if (objectIds.length > 0 && activeObjectId === null) {
      return failure(diagnostic("missing-active-object", "A non-empty object selection needs an active object."));
    }
    return success(canonicalSelection({
      mode: "object",
      objectIds,
      activeObjectId,
      elementIds: [],
      activeElementId: null,
      provenance: null,
    }));
  }

  const verified = verifySource(mutation.source);
  if (!verified.ok) return verified;
  if (selection.mode !== "object") {
    const current = validateStudioHybridDccComponentSelection(selection, mutation.source);
    if (!current.ok) return current;
  }
  if (mutation.ids.length
    > STUDIO_HYBRID_DCC_COMPONENT_SELECTION_LIMITS.maxSelectedElements) {
    return failure(diagnostic("selection-budget-exceeded", "Component selection is too large."));
  }
  if (!mutation.ids.every(isStableId)) {
    return failure(diagnostic("invalid-stable-id", "Mutation contains an invalid stable ID."));
  }

  const index = verified.value.index;
  const canonicalTargets: number[] = [];
  const missing: number[] = [];
  for (const id of mutation.ids) {
    if (mutation.mode === "vertex") {
      if (index.vertexIds.has(id)) canonicalTargets.push(id);
      else missing.push(id);
    } else if (mutation.mode === "face") {
      if (index.faceById.has(id)) canonicalTargets.push(id);
      else missing.push(id);
    } else {
      const canonical = index.canonicalEdgeByHalfEdgeId.get(id);
      if (canonical === undefined) missing.push(id);
      else canonicalTargets.push(canonical);
    }
  }
  if (missing.length > 0) {
    return failure(diagnostic(
      "element-not-found",
      "Mutation contains stable IDs absent from the mesh.",
      { elementIds: missing },
    ));
  }

  const targets = sortedUniqueNumbers(canonicalTargets);
  const currentIds = selection.mode === mutation.mode ? selection.elementIds : [];
  const elementIds = applyNumberOperation(currentIds, targets, mutation.operation);
  if (elementIds.length
    > STUDIO_HYBRID_DCC_COMPONENT_SELECTION_LIMITS.maxSelectedElements) {
    return failure(diagnostic("selection-budget-exceeded", "Component selection is too large."));
  }
  const priorActive = selection.mode === mutation.mode ? selection.activeElementId : null;
  let activeElementId = automaticNumberActive(
    elementIds,
    targets,
    priorActive,
    mutation.operation,
  );
  if (mutation.activeId !== undefined) {
    const requested = mutation.activeId === null || mutation.mode !== "edge"
      ? mutation.activeId
      : index.canonicalEdgeByHalfEdgeId.get(mutation.activeId);
    if (mutation.activeId !== null && requested === undefined) {
      return failure(diagnostic("element-not-found", "Requested active edge is absent from the mesh."));
    }
    if (requested !== null && !elementIds.includes(requested!)) {
      return failure(diagnostic("active-element-not-selected", "Requested active element is not selected."));
    }
    activeElementId = requested ?? null;
  }
  if (elementIds.length > 0 && activeElementId === null) {
    return failure(diagnostic("missing-active-element", "A non-empty component selection needs an active element."));
  }
  return success(canonicalSelection({
    mode: mutation.mode,
    objectIds: [mutation.source.assetId],
    activeObjectId: mutation.source.assetId,
    elementIds,
    activeElementId,
    provenance: verified.value.provenance,
  }));
}

function remapForMode(
  remap: StudioHybridDccTopologySelectionRemap | undefined,
  mode: StudioHybridDccComponentMode,
): StudioHybridDccTopologyIdRemap | undefined {
  return mode === "vertex" ? remap?.vertex : mode === "edge" ? remap?.edge : remap?.face;
}

function validateRemap(
  remap: StudioHybridDccTopologyIdRemap | undefined,
): StudioHybridDccSelectionResult<ReadonlyMap<number, number | null>> {
  if (!remap) return success(new Map());
  if (!Array.isArray(remap.entries)
    || remap.entries.length
      > STUDIO_HYBRID_DCC_COMPONENT_SELECTION_LIMITS.maxSelectedElements) {
    return failure(diagnostic("selection-budget-exceeded", "Topology ID remap is malformed or too large."));
  }
  const result = new Map<number, number | null>();
  for (const entry of remap.entries) {
    if (!Array.isArray(entry) || entry.length !== 2
      || !isStableId(entry[0]) || (entry[1] !== null && !isStableId(entry[1]))) {
      return failure(diagnostic("invalid-stable-id", "Topology ID remap contains an invalid entry."));
    }
    if (result.has(entry[0])) {
      return failure(diagnostic(
        "duplicate-stable-id",
        "Topology ID remap contains a duplicate source ID.",
        { elementIds: [entry[0]] },
      ));
    }
    result.set(entry[0], entry[1]);
  }
  return success(result);
}

/**
 * Explicit topology boundary. Stale provenance is expected here: live IDs survive, missing IDs are
 * pruned, and optional operation receipts may remap replaced IDs. No other API silently repairs a
 * stale selection.
 */
export function reconcileStudioHybridDccComponentSelection(
  selection: StudioHybridDccComponentSelection,
  source: StudioHybridDccMeshSelectionSource,
  remap?: StudioHybridDccTopologySelectionRemap,
): StudioHybridDccSelectionResult<StudioHybridDccComponentSelection> {
  const structure = validateStudioHybridDccComponentSelection(selection);
  if (!structure.ok) return structure;
  const verified = verifySource(source);
  if (!verified.ok) return verified;
  if (selection.mode === "object") return success(selection);
  if (selection.provenance!.assetId !== source.assetId) {
    return failure(diagnostic("asset-mismatch", "Topology reconciliation cannot cross object authority."));
  }

  const validatedRemap = validateRemap(remapForMode(remap, selection.mode));
  if (!validatedRemap.ok) return validatedRemap;
  const idRemap = validatedRemap.value;
  const index = verified.value.index;
  const live = selection.mode === "vertex"
    ? index.vertexIds
    : selection.mode === "face"
      ? new Set(index.faceById.keys())
      : index.canonicalEdgeIds;
  const canonicalize = (id: number): number | undefined => {
    if (selection.mode !== "edge") return id;
    return index.canonicalEdgeByHalfEdgeId.get(id);
  };

  const nextIds: number[] = [];
  const removed: number[] = [];
  const remapped: number[] = [];
  for (const oldId of selection.elementIds) {
    const mapped = idRemap.has(oldId) ? idRemap.get(oldId)! : oldId;
    if (mapped === null) {
      removed.push(oldId);
      continue;
    }
    const candidate = canonicalize(mapped);
    if (candidate === undefined || !live.has(candidate)) {
      removed.push(oldId);
      continue;
    }
    nextIds.push(candidate);
    if (candidate !== oldId) remapped.push(oldId);
  }
  const elementIds = sortedUniqueNumbers(nextIds);

  let activeElementId: number | null = null;
  if (selection.activeElementId !== null) {
    const mapped = idRemap.has(selection.activeElementId)
      ? idRemap.get(selection.activeElementId)!
      : selection.activeElementId;
    const candidate = mapped === null ? undefined : canonicalize(mapped);
    if (candidate !== undefined && elementIds.includes(candidate)) activeElementId = candidate;
  }
  if (activeElementId === null && elementIds.length > 0) activeElementId = elementIds.at(-1)!;

  const diagnostics: StudioHybridDccSelectionDiagnostic[] = [];
  if (selection.provenance!.meshRevision !== source.meshRevision
    || selection.provenance!.sourceHash !== source.sourceHash) {
    diagnostics.push(diagnostic(
      "topology-provenance-refreshed",
      "Selection provenance was refreshed at an explicit topology boundary.",
      { severity: "info" },
    ));
  }
  if (remapped.length > 0) {
    diagnostics.push(diagnostic(
      "topology-selection-remapped",
      `${remapped.length} selected stable ID(s) were remapped.`,
      { severity: "info", elementIds: remapped.toSorted((left, right) => left - right) },
    ));
  }
  if (removed.length > 0) {
    diagnostics.push(diagnostic(
      "topology-selection-pruned",
      `${removed.length} deleted stable ID(s) were removed from selection.`,
      { severity: "warning", elementIds: removed.toSorted((left, right) => left - right) },
    ));
  }
  return success(canonicalSelection({
    mode: selection.mode,
    objectIds: [source.assetId],
    activeObjectId: source.assetId,
    elementIds,
    activeElementId,
    provenance: verified.value.provenance,
  }), diagnostics);
}

/**
 * Receipt-bound region-extrude boundary.
 *
 * A topology receipt is command evidence, not selection authority. Bind both of its mesh hashes,
 * require the exact selected-face-to-cap mapping, and only then delegate to the generic stable-ID
 * reconciler. This prevents a stale/forged receipt from moving the active face onto unrelated
 * geometry even when the target ID happens to exist in the rebuilt mesh.
 */
export function reconcileStudioHybridDccSelectionAfterExtrudeRegion(
  selection: StudioHybridDccComponentSelection,
  source: StudioHybridDccMeshSelectionSource,
  resultSource: StudioHybridDccMeshSelectionSource,
  receipt: StudioEditableMeshExtrudeRegionReceipt,
): StudioHybridDccSelectionResult<StudioHybridDccComponentSelection> {
  if (!isIssuedStudioEditableMeshExtrudeRegionReceipt(receipt)) {
    return failure(diagnostic(
      "invalid-topology-receipt",
      "Region extrude receipt was not issued by the geometry kernel.",
    ));
  }
  const structure = validateStudioHybridDccComponentSelection(selection, source);
  if (!structure.ok) return structure;
  if (selection.mode !== "face" || selection.provenance === null) {
    return failure(diagnostic(
      "invalid-mode",
      "Region extrude selection reconciliation requires a canonical face selection.",
    ));
  }
  if (receipt.operation !== "extrude-region"
    || receipt.sourceFaceIds.length === 0
    || receipt.sourceFaceIds.length !== receipt.capFaceIds.length
    || receipt.sourceFaceIds.length !== selection.elementIds.length
    || receipt.sourceFaceIds.some((faceId, index) => faceId !== selection.elementIds[index])
    || receipt.sourceFaceIds.length
      > STUDIO_HYBRID_DCC_COMPONENT_SELECTION_LIMITS.maxSelectedElements
    || receipt.capFaceIds.length
      > STUDIO_HYBRID_DCC_COMPONENT_SELECTION_LIMITS.maxSelectedElements) {
    return failure(diagnostic(
      "invalid-topology-receipt",
      "Region extrude receipt has an invalid face mapping shape.",
    ));
  }
  if (selection.provenance.sourceHash !== receipt.sourceMeshHash) {
    return failure(diagnostic(
      "topology-receipt-source-mismatch",
      "Region extrude receipt does not identify the selected source mesh.",
    ));
  }
  if (resultSource.sourceHash !== receipt.resultMeshHash) {
    return failure(diagnostic(
      "topology-receipt-result-mismatch",
      "Region extrude receipt does not identify the current result mesh.",
    ));
  }
  if (resultSource.assetId !== source.assetId
    || resultSource.meshRevision !== source.meshRevision + 1) {
    return failure(diagnostic(
      "invalid-topology-receipt",
      "Region extrude result revision is not the direct successor of the selected mesh.",
    ));
  }

  const verifiedResult = verifySource(resultSource);
  if (!verifiedResult.ok) return verifiedResult;
  const sourceFaceIds = new Set(source.mesh.faces.map(({ id }) => id));
  const fullEntries = receipt.faceRemap.entries;
  if (fullEntries.length !== sourceFaceIds.size
    || fullEntries.length > STUDIO_EDITABLE_MESH_LIMITS.maxFaces) {
    return failure(diagnostic(
      "invalid-topology-receipt",
      "Region extrude receipt does not cover every source face exactly once.",
    ));
  }
  const fullFaceRemap = new Map<number, number | null>();
  const fullTargets = new Set<number>();
  for (const entry of fullEntries) {
    if (!Array.isArray(entry) || entry.length !== 2
      || !isStableId(entry[0]) || !sourceFaceIds.has(entry[0])
      || (entry[1] !== null && !isStableId(entry[1]))
      || (entry[1] !== null && !verifiedResult.value.index.faceById.has(entry[1]))
      || fullFaceRemap.has(entry[0])
      || (entry[1] !== null && fullTargets.has(entry[1]))) {
      return failure(diagnostic(
        "invalid-topology-receipt",
        "Region extrude receipt contains a non-unique or non-live full face remap.",
      ));
    }
    fullFaceRemap.set(entry[0], entry[1]);
    if (entry[1] !== null) fullTargets.add(entry[1]);
  }

  const faceEntries = receipt.selectionRemap.face?.entries;
  if (!faceEntries || faceEntries.length !== receipt.sourceFaceIds.length) {
    return failure(diagnostic(
      "invalid-topology-receipt",
      "Region extrude receipt is missing its face selection remap.",
    ));
  }
  const faceRemap = new Map<number, number | null>();
  for (const entry of faceEntries) {
    if (!Array.isArray(entry) || entry.length !== 2
      || !isStableId(entry[0]) || (entry[1] !== null && !isStableId(entry[1]))
      || faceRemap.has(entry[0])) {
      return failure(diagnostic(
        "invalid-topology-receipt",
        "Region extrude receipt contains a malformed face selection remap.",
      ));
    }
    faceRemap.set(entry[0], entry[1]);
  }
  for (let index = 0; index < receipt.sourceFaceIds.length; index += 1) {
    const sourceFaceId = receipt.sourceFaceIds[index]!;
    const capFaceId = receipt.capFaceIds[index]!;
    if (!isStableId(sourceFaceId)
      || !isStableId(capFaceId)
      || faceRemap.get(sourceFaceId) !== capFaceId
      || fullFaceRemap.get(sourceFaceId) !== capFaceId) {
      return failure(diagnostic(
        "invalid-topology-receipt",
        "Region extrude receipt does not map every source face to its cap face.",
      ));
    }
  }

  return reconcileStudioHybridDccComponentSelection(
    selection,
    resultSource,
    receipt.selectionRemap,
  );
}

export function snapshotStudioHybridDccComponentSelection(
  selection: StudioHybridDccComponentSelection,
): StudioHybridDccComponentSelectionSnapshot {
  const validated = validateStudioHybridDccComponentSelection(selection);
  if (!validated.ok) throw new Error(validated.diagnostics.map((item) => item.message).join(" "));
  return Object.freeze({
    format: STUDIO_HYBRID_DCC_COMPONENT_SELECTION_FORMAT,
    version: STUDIO_HYBRID_DCC_COMPONENT_SELECTION_SNAPSHOT_VERSION,
    revision: selection.revision,
    mode: selection.mode,
    objectIds: Object.freeze([...selection.objectIds]),
    activeObjectId: selection.activeObjectId,
    elementIds: Object.freeze([...selection.elementIds]),
    activeElementId: selection.activeElementId,
    provenance: selection.provenance ? Object.freeze({ ...selection.provenance }) : null,
  });
}

/** Canonical JSON property order comes from the versioned snapshot constructor above. */
export function encodeStudioHybridDccComponentSelectionSnapshot(
  selection: StudioHybridDccComponentSelection,
): string {
  return JSON.stringify(snapshotStudioHybridDccComponentSelection(selection));
}

function decodeSnapshotRecord(
  value: Record<string, unknown>,
): StudioHybridDccSelectionResult<StudioHybridDccComponentSelection> {
  if (!hasExactKeys(value, [
    "format",
    "version",
    "revision",
    "mode",
    "objectIds",
    "activeObjectId",
    "elementIds",
    "activeElementId",
    "provenance",
  ])) {
    return failure(diagnostic("malformed-snapshot", "Selection snapshot keys are malformed."));
  }
  if (value.format !== STUDIO_HYBRID_DCC_COMPONENT_SELECTION_FORMAT) {
    return failure(diagnostic("unsupported-format", "Selection snapshot format is unsupported."));
  }
  if (value.version !== STUDIO_HYBRID_DCC_COMPONENT_SELECTION_SNAPSHOT_VERSION) {
    return failure(diagnostic("unsupported-version", "Selection snapshot version is unsupported."));
  }
  if (value.revision !== STUDIO_HYBRID_DCC_COMPONENT_SELECTION_REVISION) {
    return failure(diagnostic("unsupported-revision", "Selection authority revision is unsupported."));
  }
  if (!isSelectionMode(value.mode)) {
    return failure(diagnostic("invalid-mode", "Selection snapshot mode is invalid."));
  }
  if (!Array.isArray(value.objectIds) || !Array.isArray(value.elementIds)) {
    return failure(diagnostic("malformed-snapshot", "Selection snapshot arrays are missing."));
  }
  if (value.objectIds.length
      > STUDIO_HYBRID_DCC_COMPONENT_SELECTION_LIMITS.maxSelectedObjects
    || value.elementIds.length
      > STUDIO_HYBRID_DCC_COMPONENT_SELECTION_LIMITS.maxSelectedElements) {
    return failure(diagnostic("selection-budget-exceeded", "Selection snapshot exceeds the soft limit."));
  }

  let provenance: StudioHybridDccSelectionProvenance | null = null;
  if (value.provenance !== null) {
    if (!isRecord(value.provenance)
      || !hasExactKeys(value.provenance, ["assetId", "meshRevision", "sourceHash"])
      || !isObjectId(value.provenance.assetId)
      || !Number.isSafeInteger(value.provenance.meshRevision)
      || typeof value.provenance.meshRevision !== "number"
      || value.provenance.meshRevision < 1
      || !isSourceHash(value.provenance.sourceHash)) {
      return failure(diagnostic("invalid-provenance", "Selection snapshot provenance is malformed."));
    }
    provenance = {
      assetId: value.provenance.assetId,
      meshRevision: value.provenance.meshRevision,
      sourceHash: value.provenance.sourceHash,
    };
  }
  const candidate = canonicalSelection({
    mode: value.mode,
    objectIds: value.objectIds as readonly string[],
    activeObjectId: value.activeObjectId as string | null,
    elementIds: value.elementIds as readonly number[],
    activeElementId: value.activeElementId as number | null,
    provenance,
  });
  const structure = validateStudioHybridDccComponentSelection(candidate);
  if (!structure.ok) return structure;
  return success(candidate);
}

/** Parses untrusted JSON/object data. Passing source enforces current provenance and live IDs. */
export function decodeStudioHybridDccComponentSelectionSnapshot(
  input: unknown,
  source?: StudioHybridDccMeshSelectionSource,
): StudioHybridDccSelectionResult<StudioHybridDccComponentSelection> {
  let value = input;
  if (typeof input === "string") {
    if (input.length
      > STUDIO_HYBRID_DCC_COMPONENT_SELECTION_LIMITS.maxSnapshotCharacters) {
      return failure(diagnostic("snapshot-too-large", "Selection snapshot text is too large."));
    }
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return failure(diagnostic("malformed-snapshot", "Selection snapshot is not valid JSON."));
    }
  }
  if (!isRecord(value)) {
    return failure(diagnostic("malformed-snapshot", "Selection snapshot must be an object."));
  }
  try {
    const decoded = decodeSnapshotRecord(value);
    if (!decoded.ok || !source) return decoded;
    return validateStudioHybridDccComponentSelection(decoded.value, source);
  } catch {
    // Direct plugin objects can contain throwing accessors/proxies; persisted JSON cannot. Keep
    // the public untrusted-data boundary fail-closed in either case.
    return failure(diagnostic("malformed-snapshot", "Selection snapshot could not be inspected safely."));
  }
}

function resolveSelectionOrDefault(
  selection: StudioHybridDccComponentSelection,
  source: StudioHybridDccMeshSelectionSource,
  mode: "face" | "edge",
): StudioHybridDccSelectionResult<StudioHybridDccResolvedElementIds> {
  const verified = verifySource(source);
  if (!verified.ok) return verified;
  if (selection.mode !== "object") {
    const current = validateStudioHybridDccComponentSelection(selection, source);
    if (!current.ok) return current;
  } else {
    const current = validateStudioHybridDccComponentSelection(selection);
    if (!current.ok) return current;
    if (selection.activeObjectId !== null && selection.activeObjectId !== source.assetId) {
      return failure(diagnostic(
        "asset-mismatch",
        "The requested component default belongs to another active object.",
      ));
    }
  }

  if (selection.mode === mode && selection.elementIds.length > 0) {
    return success(Object.freeze({
      ids: Object.freeze([...selection.elementIds]),
      activeId: selection.activeElementId!,
      usedDefault: false,
    }));
  }
  const candidates = mode === "face"
    ? verified.value.index.faceById.keys()
    : verified.value.index.canonicalEdgeIds.values();
  let fallback: number | undefined;
  for (const candidate of candidates) {
    if (fallback === undefined || candidate < fallback) fallback = candidate;
  }
  if (fallback === undefined) {
    return failure(diagnostic("element-not-found", `Mesh has no selectable ${mode}.`));
  }
  return success(Object.freeze({
    ids: Object.freeze([fallback]),
    activeId: fallback,
    usedDefault: true,
  }));
}

/** Selected face IDs, or the lowest stable face ID when another/empty mode needs a safe default. */
export function resolveStudioHybridDccSelectedOrDefaultFaceIds(
  selection: StudioHybridDccComponentSelection,
  source: StudioHybridDccMeshSelectionSource,
): StudioHybridDccSelectionResult<StudioHybridDccResolvedElementIds> {
  return resolveSelectionOrDefault(selection, source, "face");
}

/** Selected canonical undirected edge IDs, or the lowest live edge ID as a safe default. */
export function resolveStudioHybridDccSelectedOrDefaultUndirectedEdgeIds(
  selection: StudioHybridDccComponentSelection,
  source: StudioHybridDccMeshSelectionSource,
): StudioHybridDccSelectionResult<StudioHybridDccResolvedElementIds> {
  return resolveSelectionOrDefault(selection, source, "edge");
}

/** Converts a directed half-edge ID to the stable user-facing undirected edge ID. */
export function resolveStudioHybridDccUndirectedEdgeId(
  source: StudioHybridDccMeshSelectionSource,
  halfEdgeId: number,
): StudioHybridDccSelectionResult<number> {
  if (!isStableId(halfEdgeId)) {
    return failure(diagnostic("invalid-stable-id", "Half-edge ID is invalid."));
  }
  const verified = verifySource(source);
  if (!verified.ok) return verified;
  const edgeId = verified.value.index.canonicalEdgeByHalfEdgeId.get(halfEdgeId);
  if (edgeId === undefined) {
    return failure(diagnostic(
      "element-not-found",
      "Half-edge is absent from the current mesh.",
      { elementIds: [halfEdgeId] },
    ));
  }
  return success(edgeId);
}

/**
 * Maps R3F/Three.js faceIndex (fan-triangle index) back to editable stable IDs. The candidate lists
 * remain renderer-free; a viewport may choose the nearest vertex/edge in screen space afterward.
 */
export function mapStudioHybridDccRayFaceIndex(
  source: StudioHybridDccMeshSelectionSource,
  faceIndex: number,
): StudioHybridDccSelectionResult<StudioHybridDccRayHitMapping> {
  if (!Number.isSafeInteger(faceIndex) || faceIndex < 0) {
    return failure(diagnostic("invalid-stable-id", "Renderer faceIndex must be a non-negative integer."));
  }
  const verified = verifySource(source);
  if (!verified.ok) return verified;
  const index = verified.value.index;
  if (faceIndex >= index.triangleCount) {
    return failure(diagnostic("element-not-found", "Renderer faceIndex is outside the mesh triangle range."));
  }

  let low = 0;
  let high = index.facesInRenderOrder.length - 1;
  let hit: StudioHybridDccIndexedFace | undefined;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const candidate = index.facesInRenderOrder[middle]!;
    if (faceIndex < candidate.triangleStart) high = middle - 1;
    else if (faceIndex >= candidate.triangleStart + candidate.triangleCount) low = middle + 1;
    else {
      hit = candidate;
      break;
    }
  }
  if (!hit) {
    return failure(diagnostic("element-not-found", "Renderer faceIndex has no authority face mapping."));
  }
  const triangleIndexWithinFace = faceIndex - hit.triangleStart;
  const triangleVertexIds = Object.freeze([
    hit.vertexIds[0]!,
    hit.vertexIds[triangleIndexWithinFace + 1]!,
    hit.vertexIds[triangleIndexWithinFace + 2]!,
  ]) as readonly [number, number, number];
  return success(Object.freeze({
    faceIndex,
    faceId: hit.face.id,
    triangleIndexWithinFace,
    faceVertexIds: Object.freeze([...hit.vertexIds]),
    triangleVertexIds,
    vertexCandidateIds: sortedUniqueNumbers(triangleVertexIds),
    edgeCandidates: Object.freeze([...hit.edges]),
    provenance: verified.value.provenance,
  }));
}
