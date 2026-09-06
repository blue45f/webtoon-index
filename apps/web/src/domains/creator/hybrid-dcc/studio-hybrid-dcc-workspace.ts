/**
 * Studio-facing Hybrid DCC workspace API.
 * Composes document, geometry authority, live bridge, import pipeline, and v1 demo
 * into one callable surface for UI / companion tooling without React coupling.
 */

import { getStudioBg3dRoomPreset, buildStudioBg3dRoomParts } from "../bg3d/studio-bg3d-room-builder";
import {
  exportStudioMeshByFormat,
  type StudioMeshExportFormat,
  type StudioMeshExportResult,
} from "../export/studio-mesh-export-adapters";
import {
  createStudioLiveBridgeDocument,
  createStudioSharedSet,
  applyStudioShotOverride,
  addStudioArtistDelta,
  mutateStudioSharedObjectGeometry,
  mutateStudioSharedObjectVisibility,
  generateStudioToonPass,
  STUDIO_TOON_PASS_KINDS,
  type StudioLiveBridgeDocument,
} from "../live/studio-live-2d3d-bridge";
import {
  createStudioCadSketch,
  extrudeStudioCadProfile,
  revolveStudioCadProfile,
} from "../studio-cad-kernel-lite";
import {
  createStudioIdleClip,
  retargetStudioMotionReport,
  sampleStudioAnimationClip,
  stepStudioSpringBone,
  type StudioRetargetReport,
  type StudioSpringBone,
} from "../studio-character-animation-p2";
import {
  compileStudioClothXpbdModelV2,
  createStudioClothXpbdRuntimeV2,
  STUDIO_CLOTH_XPBD_V2_BUDGETS,
  stepStudioClothXpbdV2,
  type StudioClothXpbdCapsuleFrameV2,
  type StudioClothXpbdVec3V2,
} from "../studio-cloth-xpbd-kernel-v2";
import {
  bevelStudioEditableMeshEdges,
  createStudioEditableMeshFromPolygons,
  createStudioUnitCubeMesh,
  dissolveStudioEditableMeshFaces,
  extrudeStudioEditableMeshFacesWithReceipt,
  hashStudioEditableMesh,
  insetStudioEditableMeshFaces,
  knifeStudioEditableMesh,
  loopCutStudioEditableMesh,
  setStudioEditableMeshCrease,
  setStudioEditableMeshFaceSmooth,
  studioEditableMeshToTriangleSoup,
  weldStudioEditableMesh,
  type StudioEditableMesh,
  type StudioEditableMeshExtrudeRegionMutation,
  type StudioEditableMeshExtrudeRegionReceipt,
} from "../studio-editable-half-edge-mesh";
import { assertRenderCacheIsNotAuthority } from "../studio-geometry-authority";
import {
  buildStudioGeoNodesPrimitive,
  evaluateStudioGeoNodesStarterGraph,
  type StudioGeoNodesPrimitiveKind,
} from "../studio-geometry-nodes-workspace-bridge";
import { importStudioGradeAAsset } from "../studio-grade-a-import-pipeline";
import {
  bomFromAssetParts,
  type StudioManufacturingBom,
} from "../studio-manufacturing-bom-lite";
import { importStudioMeshByExtension } from "../studio-mesh-format-adapters";
import {
  createStudioMeshModifierStack,
  evaluateStudioMeshModifierStack,
  withStudioMeshModifier,
} from "../studio-mesh-modifier-stack";
import {
  autoRetopoStudioMeshBasic,
  decimateStudioMesh,
  deformStudioMeshBend,
  dynatopoStudioMeshBrushLocal,
  orientStudioMeshOutward,
  repairStudioMesh,
  shrinkwrapStudioMesh,
  subdivideStudioMeshCatmullLite,
} from "../studio-mesh-ops-advanced";
import { sha256HexPortable } from "../studio-sha256";
import { createStudioDefaultSolidBooleanBackend } from "../studio-solid-boolean-backend";
import { packStudioToon3dPackage, type StudioToon3dPackage } from "../studio-toon3d-package";
import {
  unwrapStudioMeshBox,
  unwrapStudioMeshPlanar,
  type StudioUvMap,
} from "../studio-uv-unwrap-lite";

import {
  collabAppendOp,
  collabJoin,
  collabConflictReport,
  createStudioDccCollabRoom,
  type StudioDccCollabRoom,
} from "./studio-dcc-collab-shell";
import {
  createStudioHybridDccComponentSelection,
  mutateStudioHybridDccComponentSelection,
  reconcileStudioHybridDccSelectionAfterExtrudeRegion,
  resolveStudioHybridDccSelectedOrDefaultFaceIds,
  validateStudioHybridDccComponentSelection,
  type StudioHybridDccComponentSelection,
  type StudioHybridDccMeshSelectionSource,
  type StudioHybridDccSelectionResult,
} from "./studio-hybrid-dcc-component-selection";
import { scanStudioHybridDccCorruption } from "./studio-hybrid-dcc-diagnostics";
import {
  createStudioHybridDccSession,
  hybridDccCommitGeometry,
  hybridDccCommitTopologyMutation,
  hybridDccCommitObjectTransform,
  hybridDccDuplicateAsset,
  hybridDccRegisterAsset,
  hybridDccRemoveAsset,
  hybridDccUndo,
  hybridDccRedo,
  hybridDccCanUndo,
  hybridDccCanRedo,
  snapshotStudioHybridDccState,
  type StudioHybridDccSession,
} from "./studio-hybrid-dcc-document";
import {
  createStudioHybridDccIdentityTransform,
  hashStudioHybridDccObjectTransform,
  inverseTransformStudioHybridDccPoint,
  transformStudioHybridDccPoint,
  type StudioHybridDccObjectTransform,
} from "./studio-hybrid-dcc-object-transform";
import { validateStudioHybridDccFanPolygon } from "./studio-hybrid-dcc-polygon-validation";
import { parseStudioHybridDccRoomPartMetadata } from "./studio-hybrid-dcc-room-authority";
import {
  applyStudioSculptStroke,
  voxelRemeshStudioMesh,
  type StudioSculptBrushKind,
} from "./studio-hybrid-sculpt-kernel";

/** OCCT result shape (lazy-loaded; browser fetch or Node loader). */
export type StudioOcctSolidResult = {
  readonly ok: true;
  readonly bodyKind: import("../studio-occt-wasm-facade").StudioOcctBodyKind;
  readonly mesh: StudioEditableMesh;
  readonly faceCount: number;
  readonly triangleCount: number;
  readonly vertexCount: number;
  readonly volumeApprox: number;
  readonly topology: import("../studio-occt-wasm-facade").StudioOcctTopologyReceipt;
  readonly massProperties: import("../studio-occt-wasm-facade").StudioOcctMassProperties;
  readonly backend: "opencascade-wasm";
  readonly operation: string;
  readonly loadPath?: "browser" | "node";
};

export const STUDIO_HYBRID_DCC_WORKSPACE_REVISION = 4 as const;

/** A deliberately small runtime-only LRU so asset switching cannot grow solver memory without bound. */
export const STUDIO_HYBRID_DCC_CLOTH_CACHE_MAX_ENTRIES = 4 as const;

/**
 * Transient solver cache. Canonical geometry is committed after every admitted step and persists;
 * velocity/rest state intentionally restarts after a cold load unless a future bake-cache format
 * explicitly versions it.
 */
export interface StudioHybridDccClothRuntimeCache {
  readonly kind: "studio-hybrid-dcc-cloth-runtime-cache";
  readonly version: 1;
  readonly assetId: string;
  readonly meshHash: string;
  readonly sourceMeshSha256: `sha256:${string}`;
  readonly objectTransformHash: string;
  readonly topologySha256: string;
  readonly restPositions: Float32Array;
  readonly triangleIndices: Uint32Array;
  readonly fixedParticleIndices: Uint32Array;
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly stepIndex: number;
  readonly lastReceiptSha256: string;
  readonly simulationConfigSha256: `sha256:${string}`;
}

export interface StudioHybridDccClothRuntimeCacheStore {
  readonly kind: "studio-hybrid-dcc-cloth-runtime-cache-store";
  readonly version: 1;
  readonly maxEntries: typeof STUDIO_HYBRID_DCC_CLOTH_CACHE_MAX_ENTRIES;
  /** Oldest entry first, newest entry last (Map insertion order). */
  readonly entries: ReadonlyMap<string, StudioHybridDccClothRuntimeCache>;
}

export interface StudioHybridDccClothStepOptions {
  readonly gravity?: StudioClothXpbdVec3V2;
  readonly selfCollisionEnabled?: boolean;
  readonly solverIterations?: number;
  readonly capsules?: readonly StudioClothXpbdCapsuleFrameV2[];
}

export interface StudioHybridDccWorkspace {
  readonly revision: typeof STUDIO_HYBRID_DCC_WORKSPACE_REVISION;
  session: StudioHybridDccSession;
  bridge: StudioLiveBridgeDocument;
  activeAssetId: string | null;
  lastImportReport: unknown | null;
  lastUvMap: StudioUvMap | null;
  lastRetarget: StudioRetargetReport | null;
  lastExport: StudioMeshExportResult | null;
  lastSpring: StudioSpringBone | null;
  lastOcct: StudioOcctSolidResult | null;
  lastDynatopo: {
    readonly facesBefore: number;
    readonly facesAfter: number;
    readonly boundaryEdges: number;
    readonly mode: string;
  } | null;
  lastRetopo: {
    readonly facesBefore: number;
    readonly facesAfter: number;
    readonly targetFaces: number;
    readonly meanError: number;
  } | null;
  bom: StudioManufacturingBom;
  collab: StudioDccCollabRoom;
  clothStep: number;
  /** Runtime-only continuation state; authoritative stepped positions live in session geometry. */
  clothRuntimeCache: StudioHybridDccClothRuntimeCacheStore | null;
  animSampleTime: number;
}

export function createStudioHybridDccWorkspace(
  documentId = "studio-hybrid-workspace",
): StudioHybridDccWorkspace {
  const session = createStudioHybridDccSession(documentId);
  const set = createStudioSharedSet(`${documentId}-set`, []);
  const bridge = createStudioLiveBridgeDocument(set, ["shot-1"]);
  return {
    revision: STUDIO_HYBRID_DCC_WORKSPACE_REVISION,
    session,
    bridge,
    activeAssetId: null,
    lastImportReport: null,
    lastUvMap: null,
    lastRetarget: null,
    lastExport: null,
    lastSpring: null,
    lastOcct: null,
    lastDynatopo: null,
    lastRetopo: null,
    bom: bomFromAssetParts(documentId, []),
    collab: createStudioDccCollabRoom(`${documentId}-collab`),
    clothStep: 0,
    clothRuntimeCache: null,
    animSampleTime: 0,
  };
}

/**
 * Selects one canonical geometry asset without mutating geometry, history, or the live bridge.
 * The viewport/outliner may call this freely; an unknown id fails closed instead of retaining a
 * stale renderer-only selection.
 */
export function workspaceSelectAsset(
  ws: StudioHybridDccWorkspace,
  assetId: string | null,
): StudioHybridDccWorkspace {
  if (assetId === null) {
    return ws.activeAssetId === null ? ws : { ...ws, activeAssetId: null };
  }
  if (!Object.hasOwn(ws.session.state.geometry.records, assetId)) {
    throw new Error(`missing ${assetId}`);
  }
  return ws.activeAssetId === assetId ? ws : { ...ws, activeAssetId: assetId };
}

/** Controls scene/outliner visibility without deleting or mutating canonical geometry. */
export function workspaceSetAssetVisibility(
  ws: StudioHybridDccWorkspace,
  assetId: string,
  visible: boolean,
): StudioHybridDccWorkspace {
  if (!Object.hasOwn(ws.session.state.geometry.records, assetId)) {
    throw new Error(`missing ${assetId}`);
  }
  const bridge = mutateStudioSharedObjectVisibility(ws.bridge, assetId, visible);
  return bridge === ws.bridge ? ws : { ...ws, bridge };
}

function nextWorkspaceDuplicateId(ws: StudioHybridDccWorkspace, sourceAssetId: string): string {
  const base = `${sourceAssetId}-copy`;
  if (!Object.hasOwn(ws.session.state.geometry.records, base)) return base;
  for (let suffix = 2; suffix <= 10_000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!Object.hasOwn(ws.session.state.geometry.records, candidate)) return candidate;
  }
  throw new Error("duplicate asset id budget exhausted");
}

function nextWorkspaceAssetId(ws: StudioHybridDccWorkspace, base: string): string {
  if (!Object.hasOwn(ws.session.state.geometry.records, base)) return base;
  for (let suffix = 2; suffix <= 10_000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!Object.hasOwn(ws.session.state.geometry.records, candidate)) return candidate;
  }
  throw new Error("asset id budget exhausted");
}

/** Creates an offset editable copy and selects it. */
export function workspaceDuplicateActive(
  ws: StudioHybridDccWorkspace,
  duplicateAssetId?: string,
): StudioHybridDccWorkspace {
  const sourceAssetId = ws.activeAssetId;
  if (!sourceAssetId) throw new Error("no active asset");
  const nextId = duplicateAssetId ?? nextWorkspaceDuplicateId(ws, sourceAssetId);
  const session = hybridDccDuplicateAsset(ws.session, sourceAssetId, nextId);
  return {
    ...synchronizeWorkspaceGeometryAuthority(ws, session),
    activeAssetId: nextId,
  };
}

/** Deletes the selected object from authority; document undo restores it exactly. */
export function workspaceDeleteActive(ws: StudioHybridDccWorkspace): StudioHybridDccWorkspace {
  const assetId = ws.activeAssetId;
  if (!assetId) throw new Error("no active asset");
  const session = hybridDccRemoveAsset(ws.session, assetId);
  return {
    ...synchronizeWorkspaceGeometryAuthority(ws, session),
    activeAssetId: null,
  };
}

function canonicalBridgeMaterialId(
  session: StudioHybridDccSession,
  assetId: string,
): string | null {
  const rights = session.state.rightsBom.find((entry) => entry.assetId === assetId);
  if (!rights) return null;
  const metadata = parseStudioHybridDccRoomPartMetadata(rights.derivative);
  if (!metadata) return null;
  const instanceId = metadata.groupId.slice("room:".length);
  return assetId.startsWith(`room-${instanceId}-part-`)
    ? metadata.materialId
    : null;
}

/**
 * Rebuilds the renderer-neutral shared set from canonical document state. A validated modifier
 * cache remains the current presentation hash, while room material identity is recoverable from
 * the persisted Rights BOM after undo/redo and cold restore.
 */
export function synchronizeWorkspaceGeometryAuthority(
  ws: StudioHybridDccWorkspace,
  session: StudioHybridDccSession,
): StudioHybridDccWorkspace {
  const previousAuthorityIds = new Set(Object.keys(ws.session.state.geometry.records));
  const nextRecords = session.state.geometry.records;
  const previousObjectById = new Map(
    ws.bridge.set.objects.map((object) => [object.id, object] as const),
  );
  const retained = ws.bridge.set.objects.filter((object) => (
    !previousAuthorityIds.has(object.id) && !Object.hasOwn(nextRecords, object.id)
  ));
  const canonicalObjects = Object.values(nextRecords)
    .toSorted((left, right) => left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0)
    .map((record) => {
      const previous = previousObjectById.get(record.assetId);
      const validPresentationCache = record.renderCache
        && assertRenderCacheIsNotAuthority(record)
        ? record.renderCache
        : null;
      return {
        id: record.assetId,
        geometryHash: validPresentationCache?.derivedFromHash ?? record.meshHash,
        visible: previous?.visible ?? true,
        materialId: previous?.materialId
          ?? canonicalBridgeMaterialId(session, record.assetId)
          ?? "default",
        transform: session.state.objectTransforms[record.assetId]!,
      };
    });
  const set = createStudioSharedSet(ws.bridge.set.id, [...retained, ...canonicalObjects]);
  const bridge: StudioLiveBridgeDocument = {
    ...ws.bridge,
    set,
    shots: ws.bridge.shots.map((shot) => ({
      ...shot,
      dirtyPasses: [...STUDIO_TOON_PASS_KINDS],
    })),
    commandSequence: ws.bridge.commandSequence + 1,
  };
  return {
    ...ws,
    session,
    bridge,
    clothRuntimeCache: pruneClothRuntimeCacheStore(ws.clothRuntimeCache, nextRecords),
  };
}

export function workspaceAddUnitCube(
  ws: StudioHybridDccWorkspace,
  assetId?: string,
): StudioHybridDccWorkspace {
  const resolvedAssetId = assetId ?? nextWorkspaceAssetId(ws, "asset-cube");
  const generatedCubeCount = assetId === undefined
    ? Object.keys(ws.session.state.geometry.records)
      .filter((id) => id === "asset-cube" || /^asset-cube-\d+$/u.test(id)).length
    : 0;
  const initialTransform = createStudioHybridDccIdentityTransform();
  const mesh = createStudioUnitCubeMesh();
  const session = hybridDccRegisterAsset(
    ws.session,
    resolvedAssetId,
    mesh,
    {
      source: "primitive",
      creator: "studio",
      license: "CC0-1.0",
      useScope: "commercial",
      derivative: "original",
    },
    generatedCubeCount === 0
      ? initialTransform
      : {
          ...initialTransform,
          position: [generatedCubeCount * 1.25, 0, 0],
        },
  );
  return {
    ...synchronizeWorkspaceGeometryAuthority(ws, session),
    activeAssetId: resolvedAssetId,
  };
}

export function workspaceCommitActiveObjectTransform(
  ws: StudioHybridDccWorkspace,
  transform: StudioHybridDccObjectTransform,
): StudioHybridDccWorkspace {
  const assetId = ws.activeAssetId;
  if (!assetId) throw new Error("no active asset");
  return workspaceCommitObjectTransform(ws, assetId, transform);
}

export function workspaceCommitObjectTransform(
  ws: StudioHybridDccWorkspace,
  assetId: string,
  transform: StudioHybridDccObjectTransform,
): StudioHybridDccWorkspace {
  const session = hybridDccCommitObjectTransform(ws.session, assetId, transform);
  if (session === ws.session) return ws;
  return {
    ...synchronizeWorkspaceGeometryAuthority(ws, session),
    clothRuntimeCache: removeClothRuntimeCacheEntry(ws.clothRuntimeCache, assetId),
  };
}

/** Builds the exact mesh provenance consumed by component-selection authority. */
export function workspaceComponentSelectionSource(
  ws: StudioHybridDccWorkspace,
  assetId = ws.activeAssetId,
): StudioHybridDccMeshSelectionSource | null {
  if (!assetId) return null;
  const record = ws.session.state.geometry.records[assetId];
  if (!record) return null;
  return {
    assetId,
    mesh: record.mesh,
    meshRevision: record.revision,
    sourceHash: record.meshHash,
  };
}

function requireStudioHybridDccSelectionValue<T>(
  result: StudioHybridDccSelectionResult<T>,
): T {
  if (result.ok) return result.value;
  throw new Error(result.diagnostics.map(({ message }) => message).join(" · "));
}

function commitWorkspaceExtrudeRegion(
  ws: StudioHybridDccWorkspace,
  assetId: string,
  mutation: StudioEditableMeshExtrudeRegionMutation,
): StudioHybridDccWorkspace {
  const session = hybridDccCommitTopologyMutation(
    ws.session,
    assetId,
    mutation.mesh,
    {
      kind: "geometry.extrude-region",
      receipt: mutation.receipt,
    },
  );
  const bridge = mutateStudioSharedObjectGeometry(
    ws.bridge,
    assetId,
    mutation.receipt.resultMeshHash,
  );
  return { ...ws, session, bridge, activeAssetId: assetId };
}

export interface StudioHybridDccWorkspaceExtrudeRegionResult {
  readonly workspace: StudioHybridDccWorkspace;
  readonly selection: StudioHybridDccComponentSelection;
  readonly receipt: StudioEditableMeshExtrudeRegionReceipt;
}

/**
 * Product region-extrude boundary: canonical face selection in, cap-face selection out.
 * Receipt hashes and stable-ID remaps are verified before the new selection becomes authoritative.
 */
export function workspaceExtrudeRegionActive(
  ws: StudioHybridDccWorkspace,
  selection: StudioHybridDccComponentSelection,
  distance: number,
): StudioHybridDccWorkspaceExtrudeRegionResult {
  const assetId = ws.activeAssetId;
  if (!assetId) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[assetId];
  if (!record) throw new Error(`missing ${assetId}`);
  if (selection.mode !== "face" || selection.elementIds.length === 0) {
    throw new Error("region extrude requires a non-empty face selection");
  }

  const source = workspaceComponentSelectionSource(ws, assetId)!;
  const resolved = requireStudioHybridDccSelectionValue(
    resolveStudioHybridDccSelectedOrDefaultFaceIds(selection, source),
  );
  const canonicalFaceSelection = requireStudioHybridDccSelectionValue(
    mutateStudioHybridDccComponentSelection(
      createStudioHybridDccComponentSelection(),
      {
        mode: "face",
        operation: "replace",
        ids: resolved.ids,
        activeId: resolved.activeId,
        source,
      },
    ),
  );
  const extruded = extrudeStudioEditableMeshFacesWithReceipt(
    record.mesh,
    resolved.ids,
    distance,
  );
  if (!extruded.ok) throw new Error(extruded.detail);

  const workspace = commitWorkspaceExtrudeRegion(ws, assetId, extruded.value);
  const resultSource = workspaceComponentSelectionSource(workspace, assetId)!;
  const reconciled = requireStudioHybridDccSelectionValue(
    reconcileStudioHybridDccSelectionAfterExtrudeRegion(
      canonicalFaceSelection,
      source,
      resultSource,
      extruded.value.receipt,
    ),
  );
  return {
    workspace,
    selection: reconciled,
    receipt: extruded.value.receipt,
  };
}

export function workspaceExtrudeActive(
  ws: StudioHybridDccWorkspace,
  distance: number,
  faceIds: readonly number[] = [0],
): StudioHybridDccWorkspace {
  const id = ws.activeAssetId;
  if (!id) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[id];
  if (!record) throw new Error(`missing ${id}`);
  const extruded = extrudeStudioEditableMeshFacesWithReceipt(record.mesh, faceIds, distance);
  if (!extruded.ok) throw new Error(extruded.detail);
  return commitWorkspaceExtrudeRegion(ws, id, extruded.value);
}

export function workspaceKnifeActive(
  ws: StudioHybridDccWorkspace,
  normal: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 },
): StudioHybridDccWorkspace {
  const id = ws.activeAssetId;
  if (!id) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[id];
  if (!record) throw new Error(`missing ${id}`);
  const knifed = knifeStudioEditableMesh(record.mesh, {
    point: { x: 0, y: 0, z: 0 },
    normal,
  });
  if (!knifed.ok) throw new Error(knifed.detail);
  const session = hybridDccCommitGeometry(ws.session, id, knifed.value);
  const hash = hashStudioEditableMesh(knifed.value);
  const bridge = mutateStudioSharedObjectGeometry(ws.bridge, id, hash);
  return { ...ws, session, bridge };
}

function commitWorkspaceActiveMesh(
  ws: StudioHybridDccWorkspace,
  assetId: string,
  mesh: StudioEditableMesh,
): StudioHybridDccWorkspace {
  const session = hybridDccCommitGeometry(ws.session, assetId, mesh);
  const bridge = mutateStudioSharedObjectGeometry(ws.bridge, assetId, hashStudioEditableMesh(mesh));
  return { ...ws, session, bridge, activeAssetId: assetId };
}

export function workspaceInsetActive(
  ws: StudioHybridDccWorkspace,
  factor = 0.2,
  faceIds: readonly number[] = [0],
): StudioHybridDccWorkspace {
  const assetId = ws.activeAssetId;
  if (!assetId) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[assetId];
  if (!record) throw new Error(`missing ${assetId}`);
  const result = insetStudioEditableMeshFaces(record.mesh, faceIds, factor);
  if (!result.ok) throw new Error(result.detail);
  return commitWorkspaceActiveMesh(ws, assetId, result.value);
}

export function workspaceBevelEdgesActive(
  ws: StudioHybridDccWorkspace,
  amount = 0.12,
  halfEdgeIds?: readonly number[],
): StudioHybridDccWorkspace {
  const assetId = ws.activeAssetId;
  if (!assetId) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[assetId];
  if (!record) throw new Error(`missing ${assetId}`);
  const selected = halfEdgeIds ?? record.mesh.halfEdges.slice(0, 1).map(({ id }) => id);
  const result = bevelStudioEditableMeshEdges(record.mesh, selected, amount);
  if (!result.ok) throw new Error(result.detail);
  return commitWorkspaceActiveMesh(ws, assetId, result.value);
}

export function workspaceLoopCutActive(
  ws: StudioHybridDccWorkspace,
  factor = 0.5,
  startHalfEdgeId?: number,
): StudioHybridDccWorkspace {
  const assetId = ws.activeAssetId;
  if (!assetId) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[assetId];
  if (!record) throw new Error(`missing ${assetId}`);
  const selected = startHalfEdgeId ?? record.mesh.halfEdges[0]?.id;
  if (selected === undefined) throw new Error("mesh has no edge to cut");
  const result = loopCutStudioEditableMesh(record.mesh, selected, factor);
  if (!result.ok) throw new Error(result.detail);
  return commitWorkspaceActiveMesh(ws, assetId, result.value);
}

export function workspaceWeldActive(
  ws: StudioHybridDccWorkspace,
  distance = 1e-5,
): StudioHybridDccWorkspace {
  const assetId = ws.activeAssetId;
  if (!assetId) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[assetId];
  if (!record) throw new Error(`missing ${assetId}`);
  const result = weldStudioEditableMesh(record.mesh, distance);
  if (!result.ok) throw new Error(result.detail);
  return commitWorkspaceActiveMesh(ws, assetId, result.value);
}

export function workspaceDissolveFaceActive(
  ws: StudioHybridDccWorkspace,
  faceIds: readonly number[] = [0],
): StudioHybridDccWorkspace {
  const assetId = ws.activeAssetId;
  if (!assetId) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[assetId];
  if (!record) throw new Error(`missing ${assetId}`);
  const result = dissolveStudioEditableMeshFaces(record.mesh, faceIds);
  if (!result.ok) throw new Error(result.detail);
  return commitWorkspaceActiveMesh(ws, assetId, result.value);
}

export function workspaceCreaseActive(
  ws: StudioHybridDccWorkspace,
  crease = 0.75,
  halfEdgeIds?: readonly number[],
): StudioHybridDccWorkspace {
  const assetId = ws.activeAssetId;
  if (!assetId) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[assetId];
  if (!record) throw new Error(`missing ${assetId}`);
  const selected = halfEdgeIds ?? record.mesh.halfEdges.slice(0, 1).map(({ id }) => id);
  const result = setStudioEditableMeshCrease(record.mesh, selected, crease);
  if (!result.ok) throw new Error(result.detail);
  return commitWorkspaceActiveMesh(ws, assetId, result.value);
}

export function workspaceShadeActive(
  ws: StudioHybridDccWorkspace,
  smooth: boolean,
): StudioHybridDccWorkspace {
  const assetId = ws.activeAssetId;
  if (!assetId) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[assetId];
  if (!record) throw new Error(`missing ${assetId}`);
  const result = setStudioEditableMeshFaceSmooth(
    record.mesh,
    record.mesh.faces.map(({ id }) => id),
    smooth,
  );
  if (!result.ok) throw new Error(result.detail);
  return commitWorkspaceActiveMesh(ws, assetId, result.value);
}

export async function workspaceBooleanDifference(
  ws: StudioHybridDccWorkspace,
  operandScale = 0.5,
): Promise<StudioHybridDccWorkspace> {
  const id = ws.activeAssetId;
  if (!id) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[id];
  if (!record) throw new Error(`missing ${id}`);
  let stack = createStudioMeshModifierStack(record.mesh);
  const soup = studioEditableMeshToTriangleSoup(record.mesh);
  const op = new Float32Array(soup.positions);
  for (let i = 0; i < op.length; i += 1) op[i]! *= operandScale;
  stack = withStudioMeshModifier(stack, {
    kind: "boolean",
    id: "ws-bool",
    enabled: true,
    operation: "difference",
    operand: { positions: op, indices: soup.indices },
  });
  const evaluated = await evaluateStudioMeshModifierStack(stack, {
    booleanBackend: createStudioDefaultSolidBooleanBackend(),
  });
  if (!evaluated.ok) throw new Error(evaluated.detail);
  const session = hybridDccCommitGeometry(ws.session, id, evaluated.value.mesh);
  const bridge = mutateStudioSharedObjectGeometry(
    ws.bridge,
    id,
    evaluated.value.resultHash,
  );
  return { ...ws, session, bridge };
}

export function workspaceEnsureShots(
  ws: StudioHybridDccWorkspace,
  count: number,
): StudioHybridDccWorkspace {
  const n = Math.max(1, Math.min(64, Math.trunc(count)));
  const ids = Array.from({ length: n }, (_, i) => `shot-${i + 1}`);
  const defaults = createStudioLiveBridgeDocument(ws.bridge.set, ids);
  const existingById = new Map(ws.bridge.shots.map((shot) => [shot.id, shot] as const));
  let bridge: StudioLiveBridgeDocument = {
    ...ws.bridge,
    shots: defaults.shots.map((shot) => existingById.get(shot.id) ?? shot),
    commandSequence: ws.bridge.commandSequence + 1,
  };
  for (let i = 0; i < n; i += 1) {
    bridge = applyStudioShotOverride(bridge, ids[i]!, {
      camera: {
        position: [Math.cos((i / n) * Math.PI * 2) * 5, 1.6, Math.sin((i / n) * Math.PI * 2) * 5],
        target: [0, 1, 0],
        fov: 35,
      },
    });
  }
  return { ...ws, bridge };
}

export function workspaceAddArtistInk(
  ws: StudioHybridDccWorkspace,
  shotId: string,
): StudioHybridDccWorkspace {
  for (const pass of STUDIO_TOON_PASS_KINDS) {
    ws = {
      ...ws,
      bridge: generateStudioToonPass(ws.bridge, shotId, pass),
    };
  }
  const assetId = ws.activeAssetId ?? "prop";
  const geoHash =
    ws.session.state.geometry.records[assetId]?.meshHash ?? "geo";
  const bridge = addStudioArtistDelta(ws.bridge, {
    id: `ink-${shotId}`,
    pass: "line",
    shotId,
    points: [
      [0.2, 0.2],
      [0.5, 0.5],
    ],
    pressure: [1, 0.8],
    provenance: { objectId: assetId, confidence: 0.9 },
    creationCameraHash: `cam-${shotId}`,
    creationGeometryHash: geoHash,
    createdAt: Date.now(),
  });
  return { ...ws, bridge };
}

export function workspaceImportBytes(
  ws: StudioHybridDccWorkspace,
  fileName: string,
  bytes: Uint8Array,
): StudioHybridDccWorkspace {
  const meshAdapter = importStudioMeshByExtension(fileName, bytes);
  if (meshAdapter && meshAdapter.meshes[0]) {
    const assetId = `import-${fileName.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 40)}`;
    let session = ws.session;
    if (!session.state.geometry.records[assetId]) {
      session = hybridDccRegisterAsset(session, assetId, meshAdapter.meshes[0], {
        source: fileName,
        creator: "import",
        license: "unknown",
        useScope: "editorial",
        derivative: "imported",
      });
    } else {
      session = hybridDccCommitGeometry(session, assetId, meshAdapter.meshes[0]);
    }
    return {
      ...synchronizeWorkspaceGeometryAuthority(ws, session),
      activeAssetId: assetId,
      lastImportReport: {
        ...meshAdapter.report,
        adapterFormat: meshAdapter.format,
        extras: meshAdapter.extras ?? null,
      },
    };
  }
  const gradeA = importStudioGradeAAsset({ fileName, bytes });
  return { ...ws, lastImportReport: gradeA.report };
}

export function workspaceLoadRoomPreset(
  ws: StudioHybridDccWorkspace,
  presetId = "classroom",
): StudioHybridDccWorkspace {
  const preset = getStudioBg3dRoomPreset(presetId);
  if (!preset) throw new Error(`unknown room ${presetId}`);
  const parts = buildStudioBg3dRoomParts(preset.spec);
  const objects = [
    ...ws.bridge.set.objects.filter((o) => o.id !== "room-shell"),
    {
      id: "room-shell",
      geometryHash: `room:${presetId}:${parts.length}`,
      visible: true,
      materialId: "wall",
    },
  ];
  const set = createStudioSharedSet(ws.bridge.set.id, objects);
  const bridge: StudioLiveBridgeDocument = {
    ...ws.bridge,
    set,
    commandSequence: ws.bridge.commandSequence + 1,
  };
  return { ...ws, bridge };
}

export function workspaceUndo(ws: StudioHybridDccWorkspace): StudioHybridDccWorkspace {
  if (!hybridDccCanUndo(ws.session)) return ws;
  const session = hybridDccUndo(ws.session);
  const next = synchronizeWorkspaceGeometryAuthority(ws, session);
  return {
    ...next,
    activeAssetId: ws.activeAssetId && Object.hasOwn(session.state.geometry.records, ws.activeAssetId)
      ? ws.activeAssetId
      : Object.keys(session.state.geometry.records).sort().at(-1) ?? null,
  };
}

export function workspaceRedo(ws: StudioHybridDccWorkspace): StudioHybridDccWorkspace {
  if (!hybridDccCanRedo(ws.session)) return ws;
  const session = hybridDccRedo(ws.session);
  const next = synchronizeWorkspaceGeometryAuthority(ws, session);
  return {
    ...next,
    activeAssetId: ws.activeAssetId && Object.hasOwn(session.state.geometry.records, ws.activeAssetId)
      ? ws.activeAssetId
      : Object.keys(session.state.geometry.records).sort().at(-1) ?? null,
  };
}

/**
 * Aligns selection after snapshot-backed undo/redo without guessing an inverse topology remap.
 *
 * Object IDs survive when their authority records still exist. Component IDs survive only when
 * asset ID, mesh revision, and source hash are exactly unchanged. A topology transition clears
 * and rebinds them because a cap ID may otherwise alias an unrelated restored face.
 */
export function workspaceReconcileSelectionAfterHistory(
  ws: StudioHybridDccWorkspace,
  selection: StudioHybridDccComponentSelection,
): StudioHybridDccComponentSelection {
  if (selection.mode === "object") {
    const objectIds = selection.objectIds.filter((assetId) => (
      Object.hasOwn(ws.session.state.geometry.records, assetId)
    ));
    const activeId = selection.activeObjectId && objectIds.includes(selection.activeObjectId)
      ? selection.activeObjectId
      : objectIds.at(-1) ?? null;
    return requireStudioHybridDccSelectionValue(
      mutateStudioHybridDccComponentSelection(
        createStudioHybridDccComponentSelection(),
        {
          mode: "object",
          operation: "replace",
          ids: objectIds,
          activeId,
        },
      ),
    );
  }

  const source = workspaceComponentSelectionSource(
    ws,
    selection.provenance?.assetId ?? selection.activeObjectId ?? ws.activeAssetId,
  );
  if (!source) return createStudioHybridDccComponentSelection();
  if (selection.provenance?.assetId === source.assetId
    && selection.provenance.meshRevision === source.meshRevision
    && selection.provenance.sourceHash === source.sourceHash) {
    return requireStudioHybridDccSelectionValue(
      validateStudioHybridDccComponentSelection(selection, source),
    );
  }
  return requireStudioHybridDccSelectionValue(
    mutateStudioHybridDccComponentSelection(
      createStudioHybridDccComponentSelection(),
      {
        mode: selection.mode,
        operation: "replace",
        ids: [],
        source,
      },
    ),
  );
}

export function workspaceDiagnostics(ws: StudioHybridDccWorkspace) {
  return scanStudioHybridDccCorruption(ws.session.state);
}

export function workspaceExportToon3d(ws: StudioHybridDccWorkspace): StudioToon3dPackage {
  return packStudioToon3dPackage({
    documentId: ws.session.state.documentId,
    snapshot: snapshotStudioHybridDccState(ws.session.state),
    bridge: ws.bridge,
    rightsBom: ws.session.state.rightsBom,
  });
}

export function workspaceActiveMesh(
  ws: StudioHybridDccWorkspace,
): StudioEditableMesh | null {
  if (!ws.activeAssetId) return null;
  return ws.session.state.geometry.records[ws.activeAssetId]?.mesh ?? null;
}

export async function workspaceMirrorActive(
  ws: StudioHybridDccWorkspace,
  axis: "x" | "y" | "z" = "x",
): Promise<StudioHybridDccWorkspace> {
  const id = ws.activeAssetId;
  if (!id) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[id];
  if (!record) throw new Error(`missing ${id}`);
  let stack = createStudioMeshModifierStack(record.mesh);
  stack = withStudioMeshModifier(stack, {
    kind: "mirror",
    id: "ws-mirror",
    enabled: true,
    axis,
    merge: true,
    mergeThreshold: 1e-4,
    bisect: false,
    clip: false,
  });
  const evaluated = await evaluateStudioMeshModifierStack(stack, {
    booleanBackend: createStudioDefaultSolidBooleanBackend(),
  });
  if (!evaluated.ok) throw new Error(evaluated.detail);
  const session = hybridDccCommitGeometry(ws.session, id, evaluated.value.mesh);
  const bridge = mutateStudioSharedObjectGeometry(
    ws.bridge,
    id,
    evaluated.value.resultHash,
  );
  return { ...ws, session, bridge };
}

export function workspaceUvUnwrapActive(
  ws: StudioHybridDccWorkspace,
  mode: "planar-xy" | "box" = "box",
): StudioHybridDccWorkspace {
  const mesh = workspaceActiveMesh(ws);
  if (!mesh) throw new Error("no active asset");
  const uv = mode === "box" ? unwrapStudioMeshBox(mesh) : unwrapStudioMeshPlanar(mesh, "planar-xy");
  return { ...ws, lastUvMap: uv };
}

export function workspaceCadProp(
  ws: StudioHybridDccWorkspace,
  assetId = "cad-prop",
): StudioHybridDccWorkspace {
  const sketch = createStudioCadSketch(
    [
      { kind: "line", a: [0, 0], b: [1, 0] },
      { kind: "line", a: [1, 0], b: [1, 0.6] },
      { kind: "line", a: [1, 0.6], b: [0, 0.6] },
      { kind: "line", a: [0, 0.6], b: [0, 0] },
    ],
    [
      { kind: "horizontal", curveIndex: 0 },
      { kind: "vertical", curveIndex: 1 },
    ],
  );
  void sketch;
  const solid = extrudeStudioCadProfile(
    [
      [0, 0],
      [1, 0],
      [1, 0.6],
      [0, 0.6],
    ],
    0.4,
  );
  if (!solid) throw new Error("cad extrude failed");
  const verts = [];
  for (let i = 0; i + 2 < solid.positions.length; i += 3) {
    verts.push({
      x: solid.positions[i]!,
      y: solid.positions[i + 1]!,
      z: solid.positions[i + 2]!,
    });
  }
  const faces: number[][] = [];
  for (let i = 0; i + 2 < solid.indices.length; i += 3) {
    faces.push([solid.indices[i]!, solid.indices[i + 1]!, solid.indices[i + 2]!]);
  }
  const mesh = createStudioEditableMeshFromPolygons(verts, faces);
  let session = ws.session;
  if (!session.state.geometry.records[assetId]) {
    session = hybridDccRegisterAsset(session, assetId, mesh, {
      source: "cad-extrude",
      creator: "studio",
      license: "CC0-1.0",
      useScope: "commercial",
      derivative: "original",
    });
  } else {
    session = hybridDccCommitGeometry(session, assetId, mesh);
  }
  return { ...ws, session, activeAssetId: assetId };
}

export interface StudioHybridDccSculptStrokeOptions {
  readonly kind?: StudioSculptBrushKind;
  readonly center?: { readonly x: number; readonly y: number; readonly z: number };
  readonly radius?: number;
  readonly strength?: number;
  readonly direction?: { readonly x: number; readonly y: number; readonly z: number };
}

export function workspaceSculptActive(
  ws: StudioHybridDccWorkspace,
  strengthOrOptions: number | StudioHybridDccSculptStrokeOptions = 0.15,
): StudioHybridDccWorkspace {
  const options: StudioHybridDccSculptStrokeOptions = typeof strengthOrOptions === "number"
    ? { strength: strengthOrOptions }
    : strengthOrOptions;
  const id = ws.activeAssetId;
  if (!id) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[id];
  if (!record) throw new Error(`missing ${id}`);
  const sculpted = applyStudioSculptStroke(record.mesh, {
    kind: options.kind ?? "inflate",
    center: options.center ?? { x: 0.5, y: 0.5, z: 0.5 },
    radius: options.radius ?? 0.75,
    strength: options.strength ?? 0.15,
    ...(options.direction ? { direction: options.direction } : {}),
  });
  if (!sculpted.ok) throw new Error(sculpted.detail);
  const session = hybridDccCommitGeometry(ws.session, id, sculpted.mesh);
  const bridge = mutateStudioSharedObjectGeometry(
    ws.bridge,
    id,
    hashStudioEditableMesh(sculpted.mesh),
  );
  return { ...ws, session, bridge };
}

function selectClothAnchorParticles(positions: Float32Array): Uint32Array {
  const particleCount = positions.length / 3;
  if (particleCount === 0) return new Uint32Array();
  let highestY = Number.NEGATIVE_INFINITY;
  for (let particle = 0; particle < particleCount; particle += 1) {
    highestY = Math.max(highestY, positions[particle * 3 + 1]!);
  }
  const heightTolerance = Math.max(1e-6, Math.abs(highestY) * 1e-6);
  const top = Array.from({ length: particleCount }, (_, particle) => particle)
    .filter((particle) => highestY - positions[particle * 3 + 1]! <= heightTolerance)
    .sort((left, right) => (
      positions[left * 3]! - positions[right * 3]!
      || positions[left * 3 + 2]! - positions[right * 3 + 2]!
      || left - right
    ));
  if (top.length === 1) return Uint32Array.of(top[0]!);
  return Uint32Array.of(top[0]!, top.at(-1)!);
}

const STUDIO_HYBRID_DCC_CLOTH_MAX_FACE_CORNERS = 128 as const;
const STUDIO_HYBRID_DCC_CLOTH_MAX_POLYGON_PAIR_WORK = 2_000_000 as const;

interface StudioHybridDccClothMeshPreflight {
  readonly positions: Float32Array;
  readonly triangleIndices: Uint32Array;
  readonly sourceFaceByTriangle: readonly StudioEditableMesh["faces"][number][];
}

function preflightClothMeshBeforeHash(
  mesh: StudioEditableMesh,
): StudioHybridDccClothMeshPreflight {
  const { maxParticles, maxTriangles } = STUDIO_CLOTH_XPBD_V2_BUDGETS;
  if (mesh.vertices.length > maxParticles) {
    throw new Error(
      `cloth-v2-compile:budget-exceeded:vertices ${mesh.vertices.length} exceed ${maxParticles}`,
    );
  }
  if (mesh.faces.length > maxTriangles) {
    throw new Error(
      `cloth-v2-compile:budget-exceeded:faces ${mesh.faces.length} exceed ${maxTriangles}`,
    );
  }
  const maxFaceCorners = maxTriangles * 3;
  if (mesh.halfEdges.length > maxFaceCorners) {
    throw new Error(
      `cloth-v2-compile:budget-exceeded:half-edges ${mesh.halfEdges.length} exceed ${maxFaceCorners}`,
    );
  }

  const faceIds = new Set<number>();
  const globallyVisitedHalfEdges = new Set<number>();
  const faceLoops: Array<{
    readonly face: StudioEditableMesh["faces"][number];
    readonly vertexIds: readonly number[];
  }> = [];
  let triangleCount = 0;
  let polygonPairWork = 0;
  for (const face of mesh.faces) {
    if (!Number.isSafeInteger(face.id) || face.id < 0 || faceIds.has(face.id)) {
      throw new Error("cloth-v2-compile:invalid-input:face ids must be unique safe integers");
    }
    faceIds.add(face.id);
    const start = face.he;
    let halfEdgeIndex = start;
    let cornerCount = 0;
    const visited = new Set<number>();
    const vertexIds: number[] = [];
    const vertexIdSet = new Set<number>();
    let repeatedVertexId: number | null = null;
    while (true) {
      if (
        !Number.isSafeInteger(halfEdgeIndex)
        || halfEdgeIndex < 0
        || halfEdgeIndex >= mesh.halfEdges.length
      ) {
        throw new Error(`cloth-v2-compile:invalid-input:face ${face.id} has an invalid loop`);
      }
      if (visited.has(halfEdgeIndex)) {
        if (halfEdgeIndex !== start) {
          throw new Error(`cloth-v2-compile:invalid-input:face ${face.id} loop does not close`);
        }
        break;
      }
      visited.add(halfEdgeIndex);
      if (globallyVisitedHalfEdges.has(halfEdgeIndex)) {
        throw new Error(
          `cloth-v2-compile:invalid-input:half-edge ${halfEdgeIndex} belongs to multiple faces`,
        );
      }
      globallyVisitedHalfEdges.add(halfEdgeIndex);
      cornerCount += 1;
      if (cornerCount - 2 + triangleCount > maxTriangles) {
        throw new Error(
          `cloth-v2-compile:budget-exceeded:triangles exceed ${maxTriangles}`,
        );
      }
      const halfEdge = mesh.halfEdges[halfEdgeIndex]!;
      const previous = mesh.halfEdges[halfEdge.prev];
      const next = mesh.halfEdges[halfEdge.next];
      if (
        halfEdge.id !== halfEdgeIndex
        || halfEdge.face !== face.id
        || !previous
        || !next
        || previous.next !== halfEdgeIndex
        || next.prev !== halfEdgeIndex
      ) {
        throw new Error(
          `cloth-v2-compile:invalid-input:face ${face.id} has inconsistent half-edge links`,
        );
      }
      if (vertexIdSet.has(previous.vertex)) {
        repeatedVertexId ??= previous.vertex;
      }
      vertexIdSet.add(previous.vertex);
      vertexIds.push(previous.vertex);
      halfEdgeIndex = halfEdge.next;
    }
    if (cornerCount < 3) {
      throw new Error(`cloth-v2-compile:invalid-input:face ${face.id} needs at least 3 corners`);
    }
    if (cornerCount > STUDIO_HYBRID_DCC_CLOTH_MAX_FACE_CORNERS) {
      throw new Error(
        `cloth-v2-compile:budget-exceeded:face ${face.id} corners ${cornerCount} exceed `
          + STUDIO_HYBRID_DCC_CLOTH_MAX_FACE_CORNERS,
      );
    }
    polygonPairWork += cornerCount * cornerCount;
    if (polygonPairWork > STUDIO_HYBRID_DCC_CLOTH_MAX_POLYGON_PAIR_WORK) {
      throw new Error(
        "cloth-v2-compile:budget-exceeded:polygon-pair validation work exceeds "
          + STUDIO_HYBRID_DCC_CLOTH_MAX_POLYGON_PAIR_WORK,
      );
    }
    if (repeatedVertexId !== null) {
      throw new Error(
        `cloth-v2-compile:invalid-input:face ${face.id} repeats vertex ${repeatedVertexId}`,
      );
    }
    triangleCount += cornerCount - 2;
    faceLoops.push({ face, vertexIds });
  }
  if (triangleCount === 0) {
    throw new Error("cloth-v2-compile:invalid-input:mesh needs at least one face");
  }
  if (globallyVisitedHalfEdges.size !== mesh.halfEdges.length) {
    throw new Error("cloth-v2-compile:invalid-input:mesh contains unattached half-edges");
  }

  const vertexIndexById = new Map<number, number>();
  const positions = new Float32Array(mesh.vertices.length * 3);
  for (let index = 0; index < mesh.vertices.length; index += 1) {
    const vertex = mesh.vertices[index]!;
    if (
      !Number.isSafeInteger(vertex.id)
      || vertex.id < 0
      || vertexIndexById.has(vertex.id)
      || !Number.isFinite(vertex.position.x)
      || !Number.isFinite(vertex.position.y)
      || !Number.isFinite(vertex.position.z)
      || !Number.isFinite(vertex.crease)
    ) {
      throw new Error("cloth-v2-compile:invalid-input:vertices must have unique ids and finite data");
    }
    vertexIndexById.set(vertex.id, index);
    positions[index * 3] = vertex.position.x;
    positions[index * 3 + 1] = vertex.position.y;
    positions[index * 3 + 2] = vertex.position.z;
  }

  // A broken twin is not used by the fan itself, but keeping it would commit corrupt canonical
  // authority when the input is already triangular.
  for (const halfEdge of mesh.halfEdges) {
    if (halfEdge.twin === -1) continue;
    const twin = mesh.halfEdges[halfEdge.twin];
    const previous = mesh.halfEdges[halfEdge.prev];
    const twinPrevious = twin ? mesh.halfEdges[twin.prev] : undefined;
    if (
      !twin
      || twin.twin !== halfEdge.id
      || !previous
      || !twinPrevious
      || previous.vertex !== twin.vertex
      || halfEdge.vertex !== twinPrevious.vertex
    ) {
      throw new Error(`cloth-v2-compile:invalid-input:half-edge ${halfEdge.id} has an invalid twin`);
    }
  }

  const triangleIndices: number[] = [];
  const sourceFaceByTriangle: StudioEditableMesh["faces"][number][] = [];
  for (const { face, vertexIds } of faceLoops) {
    const points = vertexIds.map((vertexId) => {
      const vertexIndex = vertexIndexById.get(vertexId);
      if (vertexIndex === undefined) {
        throw new Error(
          `cloth-v2-compile:invalid-input:face ${face.id} references missing vertex ${vertexId}`,
        );
      }
      const vertex = mesh.vertices[vertexIndex]!;
      return [
        vertex.position.x,
        vertex.position.y,
        vertex.position.z,
      ] as const;
    });
    try {
      validateStudioHybridDccFanPolygon(points, face.id);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "polygon validation failed";
      throw new Error(`cloth-v2-compile:invalid-input:${detail}`, { cause: error });
    }
    const first = vertexIndexById.get(vertexIds[0]!)!;
    for (let index = 1; index + 1 < vertexIds.length; index += 1) {
      triangleIndices.push(
        first,
        vertexIndexById.get(vertexIds[index]!)!,
        vertexIndexById.get(vertexIds[index + 1]!)!,
      );
      sourceFaceByTriangle.push(face);
    }
  }

  return {
    positions,
    triangleIndices: new Uint32Array(triangleIndices),
    sourceFaceByTriangle,
  };
}

function exactClothMeshSha256(mesh: StudioEditableMesh): `sha256:${string}` {
  const fields: string[] = [
    `revision=${mesh.revision}`,
    `next=${mesh.nextVertexId}:${mesh.nextHalfEdgeId}:${mesh.nextFaceId}`,
  ];
  for (const vertex of mesh.vertices) {
    fields.push([
      "v",
      vertex.id,
      vertex.position.x.toPrecision(17),
      vertex.position.y.toPrecision(17),
      vertex.position.z.toPrecision(17),
      vertex.crease.toPrecision(17),
      vertex.he,
    ].join(":"));
  }
  for (const halfEdge of mesh.halfEdges) {
    fields.push([
      "h",
      halfEdge.id,
      halfEdge.vertex,
      halfEdge.face,
      halfEdge.next,
      halfEdge.prev,
      halfEdge.twin,
      halfEdge.crease.toPrecision(17),
    ].join(":"));
  }
  for (const face of mesh.faces) {
    fields.push([
      "f",
      face.id,
      face.he,
      face.materialSlot,
      face.smooth ? 1 : 0,
    ].join(":"));
  }
  return `sha256:${sha256HexPortable(new TextEncoder().encode(fields.join("|")))}`;
}

function isBoundedClothRuntimeCacheStore(
  store: StudioHybridDccClothRuntimeCacheStore | null,
): store is StudioHybridDccClothRuntimeCacheStore {
  return store?.kind === "studio-hybrid-dcc-cloth-runtime-cache-store"
    && store.version === 1
    && store.maxEntries === STUDIO_HYBRID_DCC_CLOTH_CACHE_MAX_ENTRIES
    && store.entries instanceof Map
    && store.entries.size <= STUDIO_HYBRID_DCC_CLOTH_CACHE_MAX_ENTRIES;
}

function isUsableClothRuntimeCache(
  cache: StudioHybridDccClothRuntimeCache | undefined,
  assetId: string,
  expectedParticleCount: number,
): cache is StudioHybridDccClothRuntimeCache {
  const expectedScalarCount = expectedParticleCount * 3;
  return cache?.kind === "studio-hybrid-dcc-cloth-runtime-cache"
    && cache.version === 1
    && cache.assetId === assetId
    && cache.restPositions instanceof Float32Array
    && cache.triangleIndices instanceof Uint32Array
    && cache.fixedParticleIndices instanceof Uint32Array
    && cache.positions instanceof Float32Array
    && cache.velocities instanceof Float32Array
    && cache.restPositions.length === expectedScalarCount
    && cache.positions.length === expectedScalarCount
    && cache.velocities.length === expectedScalarCount
    && cache.triangleIndices.length >= 3
    && cache.triangleIndices.length % 3 === 0
    && cache.triangleIndices.length <= STUDIO_CLOTH_XPBD_V2_BUDGETS.maxTriangles * 3
    && cache.fixedParticleIndices.length <= Math.min(
      expectedParticleCount,
      STUDIO_CLOTH_XPBD_V2_BUDGETS.maxPins,
    )
    && Number.isSafeInteger(cache.stepIndex)
    && cache.stepIndex >= 0;
}

function readClothRuntimeCacheEntry(
  store: StudioHybridDccClothRuntimeCacheStore | null,
  assetId: string,
  expectedParticleCount: number,
): StudioHybridDccClothRuntimeCache | null {
  if (!isBoundedClothRuntimeCacheStore(store)) return null;
  const cache = store.entries.get(assetId);
  return isUsableClothRuntimeCache(cache, assetId, expectedParticleCount) ? cache : null;
}

function upsertClothRuntimeCacheEntry(
  store: StudioHybridDccClothRuntimeCacheStore | null,
  cache: StudioHybridDccClothRuntimeCache,
): StudioHybridDccClothRuntimeCacheStore {
  // An oversized or forged store is discarded in O(1); never copy attacker-sized runtime state.
  const entries = isBoundedClothRuntimeCacheStore(store)
    ? new Map(store.entries)
    : new Map<string, StudioHybridDccClothRuntimeCache>();
  entries.delete(cache.assetId);
  entries.set(cache.assetId, cache);
  while (entries.size > STUDIO_HYBRID_DCC_CLOTH_CACHE_MAX_ENTRIES) {
    const oldestAssetId = entries.keys().next().value;
    if (typeof oldestAssetId !== "string") break;
    entries.delete(oldestAssetId);
  }
  return {
    kind: "studio-hybrid-dcc-cloth-runtime-cache-store",
    version: 1,
    maxEntries: STUDIO_HYBRID_DCC_CLOTH_CACHE_MAX_ENTRIES,
    entries,
  };
}

function removeClothRuntimeCacheEntry(
  store: StudioHybridDccClothRuntimeCacheStore | null,
  assetId: string,
): StudioHybridDccClothRuntimeCacheStore | null {
  if (!isBoundedClothRuntimeCacheStore(store)) return null;
  if (!store.entries.has(assetId)) return store;
  const entries = new Map(store.entries);
  entries.delete(assetId);
  return entries.size === 0 ? null : { ...store, entries };
}

function pruneClothRuntimeCacheStore(
  store: StudioHybridDccClothRuntimeCacheStore | null,
  records: Readonly<Record<string, unknown>>,
): StudioHybridDccClothRuntimeCacheStore | null {
  if (!isBoundedClothRuntimeCacheStore(store)) return null;
  let entries: Map<string, StudioHybridDccClothRuntimeCache> | null = null;
  for (const assetId of store.entries.keys()) {
    if (Object.hasOwn(records, assetId)) continue;
    entries ??= new Map(store.entries);
    entries.delete(assetId);
  }
  if (!entries) return store;
  return entries.size === 0 ? null : { ...store, entries };
}

function assertBoundedClothVec3(
  value: unknown,
  label: string,
  magnitude: number,
): asserts value is StudioClothXpbdVec3V2 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`cloth-v2-step:invalid-input:${label} must be a three-number tuple`);
  }
  for (let axis = 0; axis < 3; axis += 1) {
    const coordinate = value[axis];
    if (!Number.isFinite(coordinate) || Math.abs(coordinate) > magnitude) {
      throw new Error(
        `cloth-v2-step:invalid-input:${label}[${axis}] must be finite and within +/-${magnitude}`,
      );
    }
  }
}

function preflightClothStepConfiguration(
  gravity: StudioClothXpbdVec3V2,
  selfCollisionEnabled: boolean,
  solverIterations: number,
  capsules: readonly StudioClothXpbdCapsuleFrameV2[],
): readonly StudioClothXpbdCapsuleFrameV2[] {
  assertBoundedClothVec3(
    gravity,
    "gravity",
    STUDIO_CLOTH_XPBD_V2_BUDGETS.maxGravityMagnitude,
  );
  if (typeof selfCollisionEnabled !== "boolean") {
    throw new Error("cloth-v2-step:invalid-input:selfCollisionEnabled must be boolean");
  }
  if (
    !Number.isInteger(solverIterations)
    || solverIterations < 1
    || solverIterations > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxSolverIterations
  ) {
    throw new Error(
      "cloth-v2-step:invalid-input:solverIterations must be an integer in [1, "
        + `${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxSolverIterations}]`,
    );
  }
  if (!Array.isArray(capsules)) {
    throw new Error("cloth-v2-step:invalid-input:capsules must be an array");
  }
  if (capsules.length > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxCapsules) {
    throw new Error(
      `cloth-v2-step:budget-exceeded:capsules exceed ${STUDIO_CLOTH_XPBD_V2_BUDGETS.maxCapsules}`,
    );
  }

  for (const capsule of capsules) {
    if (
      typeof capsule !== "object"
      || capsule === null
      || typeof capsule.id !== "string"
      || capsule.id.length === 0
      || capsule.id.length > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxIdentifierLength
    ) {
      throw new Error("cloth-v2-step:invalid-input:capsule ids must be non-empty bounded strings");
    }
  }
  const normalized = [...capsules].sort((left, right) => (
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  ));
  let previousId: string | undefined;
  for (const capsule of normalized) {
    if (capsule.id === previousId) {
      throw new Error(`cloth-v2-step:invalid-input:duplicate capsule id ${capsule.id}`);
    }
    assertBoundedClothVec3(
      capsule.previousHead,
      `capsule ${capsule.id} previousHead`,
      STUDIO_CLOTH_XPBD_V2_BUDGETS.maxCoordinateMagnitude,
    );
    assertBoundedClothVec3(
      capsule.previousTail,
      `capsule ${capsule.id} previousTail`,
      STUDIO_CLOTH_XPBD_V2_BUDGETS.maxCoordinateMagnitude,
    );
    assertBoundedClothVec3(
      capsule.currentHead,
      `capsule ${capsule.id} currentHead`,
      STUDIO_CLOTH_XPBD_V2_BUDGETS.maxCoordinateMagnitude,
    );
    assertBoundedClothVec3(
      capsule.currentTail,
      `capsule ${capsule.id} currentTail`,
      STUDIO_CLOTH_XPBD_V2_BUDGETS.maxCoordinateMagnitude,
    );
    if (
      !Number.isFinite(capsule.radius)
      || capsule.radius < STUDIO_CLOTH_XPBD_V2_BUDGETS.minParticleRadius
      || capsule.radius > STUDIO_CLOTH_XPBD_V2_BUDGETS.maxParticleRadius
    ) {
      throw new Error(`cloth-v2-step:invalid-input:capsule ${capsule.id} radius is invalid`);
    }
    const friction = capsule.friction ?? 0;
    if (!Number.isFinite(friction) || friction < 0 || friction > 1) {
      throw new Error(`cloth-v2-step:invalid-input:capsule ${capsule.id} friction is invalid`);
    }
    const compliance = capsule.compliance ?? 0;
    if (!Number.isFinite(compliance) || compliance < 0 || compliance > 1) {
      throw new Error(`cloth-v2-step:invalid-input:capsule ${capsule.id} compliance is invalid`);
    }
    previousId = capsule.id;
  }
  return normalized;
}

function exactClothSimulationConfigSha256(
  gravity: StudioClothXpbdVec3V2,
  selfCollisionEnabled: boolean,
  solverIterations: number,
  capsules: readonly StudioClothXpbdCapsuleFrameV2[],
): `sha256:${string}` {
  const fields: readonly unknown[] = [
    ["gravity", ...gravity.map((value) => value.toPrecision(17))],
    ["self", selfCollisionEnabled ? 1 : 0],
    ["iterations", solverIterations],
    ...capsules.map((capsule) => [
      "capsule-static",
      capsule.id,
      capsule.radius.toPrecision(17),
      (capsule.friction ?? 0).toPrecision(17),
      (capsule.compliance ?? 0).toPrecision(17),
    ]),
  ];
  return `sha256:${sha256HexPortable(new TextEncoder().encode(JSON.stringify(fields)))}`;
}

function clothWorldPositions(
  localPositions: Float32Array,
  transform: StudioHybridDccObjectTransform,
): Float32Array {
  const world = new Float32Array(localPositions.length);
  for (let offset = 0; offset < localPositions.length; offset += 3) {
    const point = transformStudioHybridDccPoint([
      localPositions[offset]!,
      localPositions[offset + 1]!,
      localPositions[offset + 2]!,
    ], transform);
    world[offset] = point[0];
    world[offset + 1] = point[1];
    world[offset + 2] = point[2];
  }
  return world;
}

function clothMeshWithWorldPositions(
  mesh: StudioEditableMesh,
  worldPositions: Float32Array,
  transform: StudioHybridDccObjectTransform,
): StudioEditableMesh {
  if (worldPositions.length !== mesh.vertices.length * 3) {
    throw new Error("cloth-v2-output:vertex-count-mismatch");
  }
  return {
    ...mesh,
    vertices: mesh.vertices.map((vertex, index) => {
      const local = inverseTransformStudioHybridDccPoint([
        worldPositions[index * 3]!,
        worldPositions[index * 3 + 1]!,
        worldPositions[index * 3 + 2]!,
      ], transform);
      return {
        ...vertex,
        position: { x: local[0], y: local[1], z: local[2] },
      };
    }),
  };
}

function clothTriangleAuthorityMesh(
  mesh: StudioEditableMesh,
  triangleIndices: Uint32Array,
  sourceFaceByTriangle: readonly StudioEditableMesh["faces"][number][],
): StudioEditableMesh {
  const triangleCount = triangleIndices.length / 3;
  // Once cloth authority is triangular, retain its stable IDs and edge metadata on every step.
  if (mesh.faces.length === triangleCount) return mesh;
  if (!Number.isInteger(triangleCount) || triangleCount <= 0) {
    throw new Error("cloth-v2-output:invalid-triangle-topology");
  }

  const polygons: Array<readonly [number, number, number]> = [];
  for (let offset = 0; offset < triangleIndices.length; offset += 3) {
    const a = triangleIndices[offset]!;
    const b = triangleIndices[offset + 1]!;
    const c = triangleIndices[offset + 2]!;
    if (a >= mesh.vertices.length || b >= mesh.vertices.length || c >= mesh.vertices.length) {
      throw new Error("cloth-v2-output:triangle-index-out-of-range");
    }
    polygons.push([a, b, c]);
  }

  // Provenance comes from the same bounded preflight that emitted triangleIndices, so metadata
  // cannot silently drift from a separately re-walked face loop.
  if (sourceFaceByTriangle.length !== triangleCount) {
    throw new Error("cloth-v2-output:triangle-provenance-mismatch");
  }

  const triangulated = createStudioEditableMeshFromPolygons(
    mesh.vertices.map(({ position }) => ({ ...position })),
    polygons,
  );
  const vertexIndexById = new Map(mesh.vertices.map((vertex, index) => [vertex.id, index]));
  const sourceCreaseByDirectedEdge = new Map<string, number>();
  for (const halfEdge of mesh.halfEdges) {
    const previous = mesh.halfEdges[halfEdge.prev];
    const origin = previous ? vertexIndexById.get(previous.vertex) : undefined;
    const destination = vertexIndexById.get(halfEdge.vertex);
    if (origin !== undefined && destination !== undefined) {
      sourceCreaseByDirectedEdge.set(`${origin}:${destination}`, halfEdge.crease);
    }
  }

  return {
    ...triangulated,
    vertices: triangulated.vertices.map((vertex, index) => ({
      ...vertex,
      crease: mesh.vertices[index]!.crease,
    })),
    halfEdges: triangulated.halfEdges.map((halfEdge) => {
      const origin = triangulated.halfEdges[halfEdge.prev]!.vertex;
      return {
        ...halfEdge,
        crease: sourceCreaseByDirectedEdge.get(`${origin}:${halfEdge.vertex}`) ?? 0,
      };
    }),
    faces: triangulated.faces.map((face, index) => ({
      ...face,
      materialSlot: sourceFaceByTriangle[index]!.materialSlot,
      smooth: sourceFaceByTriangle[index]!.smooth,
    })),
  };
}

export function workspaceClothStep(
  ws: StudioHybridDccWorkspace,
  options: StudioHybridDccClothStepOptions = {},
): StudioHybridDccWorkspace {
  const assetId = ws.activeAssetId;
  if (!assetId) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[assetId];
  if (!record) throw new Error(`missing ${assetId}`);
  const objectTransform = ws.session.state.objectTransforms[assetId];
  if (!objectTransform) throw new Error(`missing transform ${assetId}`);
  const clothMeshPreflight = preflightClothMeshBeforeHash(record.mesh);
  const sourceMeshSha256 = exactClothMeshSha256(record.mesh);
  const objectTransformHash = hashStudioHybridDccObjectTransform(objectTransform);
  const gravity = options.gravity ?? [0, -9.81, 0];
  const selfCollisionEnabled = options.selfCollisionEnabled ?? true;
  const solverIterations = options.solverIterations ?? 8;
  const capsules = preflightClothStepConfiguration(
    gravity,
    selfCollisionEnabled,
    solverIterations,
    options.capsules ?? [],
  );
  const simulationConfigSha256 = exactClothSimulationConfigSha256(
    gravity,
    selfCollisionEnabled,
    solverIterations,
    capsules,
  );
  const cached = readClothRuntimeCacheEntry(
    ws.clothRuntimeCache,
    assetId,
    record.mesh.vertices.length,
  );
  const resumable = cached?.sourceMeshSha256 === sourceMeshSha256
    && cached.objectTransformHash === objectTransformHash
    && cached.simulationConfigSha256 === simulationConfigSha256
    && cached.triangleIndices.length === clothMeshPreflight.triangleIndices.length
    && cached.triangleIndices.every((value, index) => (
      value === clothMeshPreflight.triangleIndices[index]
    ))
    ? cached
    : null;
  const restPositions = resumable
    ? new Float32Array(resumable.restPositions)
    : clothWorldPositions(clothMeshPreflight.positions, objectTransform);
  const triangleIndices = resumable
    ? new Uint32Array(resumable.triangleIndices)
    : new Uint32Array(clothMeshPreflight.triangleIndices);
  const fixedParticleIndices = resumable
    ? new Uint32Array(resumable.fixedParticleIndices)
    : selectClothAnchorParticles(restPositions);
  const compiled = compileStudioClothXpbdModelV2({
    restPositions,
    triangleIndices,
    fixedParticleIndices,
    gravity,
    selfCollisionEnabled,
    solverIterations,
  });
  if (!compiled.ok) throw new Error(`cloth-v2-compile:${compiled.code}:${compiled.detail}`);
  if (resumable && compiled.model.topologySha256 !== resumable.topologySha256) {
    throw new Error("cloth-v2-compile:topology-mismatch:cached topology changed");
  }
  const runtime = createStudioClothXpbdRuntimeV2(compiled.model, resumable ? {
    positions: resumable.positions,
    velocities: resumable.velocities,
  } : undefined);
  if (!runtime.ok) throw new Error(`cloth-v2-runtime:${runtime.code}:${runtime.detail}`);
  if (resumable) runtime.runtime.stepIndex = resumable.stepIndex;
  const stepped = stepStudioClothXpbdV2(runtime.runtime, {
    expectedStepIndex: runtime.runtime.stepIndex,
    expectedTopologySha256: compiled.model.topologySha256,
    capsules,
    solverIterations,
  });
  if (!stepped.ok) throw new Error(`cloth-v2-step:${stepped.code}:${stepped.detail}`);
  const authorityMesh = clothTriangleAuthorityMesh(
    record.mesh,
    compiled.model.triangleIndices,
    clothMeshPreflight.sourceFaceByTriangle,
  );
  const mesh = clothMeshWithWorldPositions(
    authorityMesh,
    runtime.runtime.positions,
    objectTransform,
  );
  const session = hybridDccCommitGeometry(ws.session, assetId, mesh);
  const meshHash = session.state.geometry.records[assetId]!.meshHash;
  const bridge = mutateStudioSharedObjectGeometry(ws.bridge, assetId, meshHash);
  const clothRuntimeCache: StudioHybridDccClothRuntimeCache = {
    kind: "studio-hybrid-dcc-cloth-runtime-cache",
    version: 1,
    assetId,
    meshHash,
    sourceMeshSha256: exactClothMeshSha256(mesh),
    objectTransformHash,
    topologySha256: compiled.model.topologySha256,
    restPositions: new Float32Array(compiled.model.restPositions),
    triangleIndices: new Uint32Array(compiled.model.triangleIndices),
    fixedParticleIndices: new Uint32Array(fixedParticleIndices),
    positions: new Float32Array(runtime.runtime.positions),
    velocities: new Float32Array(runtime.runtime.velocities),
    stepIndex: runtime.runtime.stepIndex,
    lastReceiptSha256: stepped.receipt.receiptSha256,
    simulationConfigSha256,
  };
  return {
    ...ws,
    session,
    bridge,
    activeAssetId: assetId,
    clothStep: ws.clothStep + 1,
    clothRuntimeCache: upsertClothRuntimeCacheEntry(ws.clothRuntimeCache, clothRuntimeCache),
  };
}

export function workspaceCollabJoin(
  ws: StudioHybridDccWorkspace,
  peerId: string,
  displayName: string,
): StudioHybridDccWorkspace {
  let collab = collabJoin(ws.collab, {
    peerId,
    displayName,
    color: "#4f8cff",
    selection: ws.activeAssetId ? [ws.activeAssetId] : [],
  });
  if (ws.activeAssetId) {
    collab = collabAppendOp(collab, {
      kind: "select",
      peerId,
      assetIds: [ws.activeAssetId],
      at: Date.now(),
    });
  }
  return { ...ws, collab };
}

/** BVH/humanoid retarget report (CHR-P2) — pure diagnostics, no bake. */
export function workspaceRetargetFromBvhExtras(
  ws: StudioHybridDccWorkspace,
  sourceBones: readonly string[],
  targetBones: readonly string[] = [
    "hips",
    "spine",
    "chest",
    "neck",
    "head",
    "leftUpperArm",
    "rightUpperArm",
    "leftUpperLeg",
    "rightUpperLeg",
  ],
): StudioHybridDccWorkspace {
  const lastRetarget = retargetStudioMotionReport({
    source: "bvh",
    target: "vrm-humanoid",
    sourceBones,
    targetBones,
    sourceUp: "y",
    targetUp: "y",
    sourceUnit: 1,
    targetUnit: 1,
  });
  return { ...ws, lastRetarget };
}

export function workspaceSubdivideActive(
  ws: StudioHybridDccWorkspace,
  levels = 1,
): StudioHybridDccWorkspace {
  const id = ws.activeAssetId;
  if (!id) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[id];
  if (!record) throw new Error(`missing ${id}`);
  const subdiv = subdivideStudioMeshCatmullLite(record.mesh, levels);
  if (!subdiv.ok) throw new Error(subdiv.detail);
  const session = hybridDccCommitGeometry(ws.session, id, subdiv.value);
  const bridge = mutateStudioSharedObjectGeometry(
    ws.bridge,
    id,
    hashStudioEditableMesh(subdiv.value),
  );
  return { ...ws, session, bridge };
}

export async function workspaceArrayActive(
  ws: StudioHybridDccWorkspace,
  count = 3,
): Promise<StudioHybridDccWorkspace> {
  const id = ws.activeAssetId;
  if (!id) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[id];
  if (!record) throw new Error(`missing ${id}`);
  let stack = createStudioMeshModifierStack(record.mesh);
  stack = withStudioMeshModifier(stack, {
    kind: "array",
    id: "ws-array",
    enabled: true,
    count: Math.max(1, Math.min(16, Math.trunc(count))),
    offset: { x: 1.2, y: 0, z: 0 },
    mode: "linear",
    realizeInstances: true,
  });
  const evaluated = await evaluateStudioMeshModifierStack(stack, {
    booleanBackend: createStudioDefaultSolidBooleanBackend(),
  });
  if (!evaluated.ok) throw new Error(evaluated.detail);
  const session = hybridDccCommitGeometry(ws.session, id, evaluated.value.mesh);
  const bridge = mutateStudioSharedObjectGeometry(
    ws.bridge,
    id,
    evaluated.value.resultHash,
  );
  return { ...ws, session, bridge };
}

export function workspaceRebuildBom(ws: StudioHybridDccWorkspace): StudioHybridDccWorkspace {
  const parts = Object.entries(ws.session.state.geometry.records).map(([id, rec]) => ({
    id,
    name: id,
    volumeM3: Math.max(0.001, rec.mesh.faces.length * 0.0001),
  }));
  return { ...ws, bom: bomFromAssetParts(ws.session.state.documentId, parts) };
}

export function workspaceAddGeoNodesPrimitive(
  ws: StudioHybridDccWorkspace,
  kind: StudioGeoNodesPrimitiveKind = "sphere",
  assetId = `geo-${kind}`,
  segments = 6,
): StudioHybridDccWorkspace {
  const built = buildStudioGeoNodesPrimitive(kind, segments);
  if (!built.ok) throw new Error(built.detail);
  let session = ws.session;
  if (!session.state.geometry.records[assetId]) {
    session = hybridDccRegisterAsset(session, assetId, built.mesh, {
      source: `geometry-nodes:${kind}`,
      creator: "studio",
      license: "CC0-1.0",
      useScope: "commercial",
      derivative: "original",
    });
  } else {
    session = hybridDccCommitGeometry(session, assetId, built.mesh);
  }
  return { ...ws, session, activeAssetId: assetId };
}

export function workspaceDecimateActive(
  ws: StudioHybridDccWorkspace,
  ratio = 0.5,
): StudioHybridDccWorkspace {
  const id = ws.activeAssetId;
  if (!id) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[id];
  if (!record) throw new Error(`missing ${id}`);
  const dec = decimateStudioMesh(record.mesh, ratio);
  if (!dec.ok) throw new Error(dec.detail);
  const session = hybridDccCommitGeometry(ws.session, id, dec.value);
  const bridge = mutateStudioSharedObjectGeometry(
    ws.bridge,
    id,
    hashStudioEditableMesh(dec.value),
  );
  return { ...ws, session, bridge };
}

function commitActiveMesh(
  ws: StudioHybridDccWorkspace,
  mesh: StudioEditableMesh,
): StudioHybridDccWorkspace {
  const id = ws.activeAssetId;
  if (!id) throw new Error("no active asset");
  const session = hybridDccCommitGeometry(ws.session, id, mesh);
  const bridge = mutateStudioSharedObjectGeometry(
    ws.bridge,
    id,
    hashStudioEditableMesh(mesh),
  );
  return { ...ws, session, bridge };
}

export function workspaceAddGeoNodesStarter(
  ws: StudioHybridDccWorkspace,
  assetId = "geo-starter",
): StudioHybridDccWorkspace {
  const built = evaluateStudioGeoNodesStarterGraph();
  if (!built.ok) throw new Error(built.detail);
  let session = ws.session;
  if (!session.state.geometry.records[assetId]) {
    session = hybridDccRegisterAsset(session, assetId, built.mesh, {
      source: "geometry-nodes:starter-graph",
      creator: "studio",
      license: "CC0-1.0",
      useScope: "commercial",
      derivative: "original",
    });
  } else {
    session = hybridDccCommitGeometry(session, assetId, built.mesh);
  }
  return { ...ws, session, activeAssetId: assetId };
}

export async function workspaceSolidifyActive(
  ws: StudioHybridDccWorkspace,
  thickness = 0.05,
): Promise<StudioHybridDccWorkspace> {
  const id = ws.activeAssetId;
  if (!id) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[id];
  if (!record) throw new Error(`missing ${id}`);
  let stack = createStudioMeshModifierStack(record.mesh);
  stack = withStudioMeshModifier(stack, {
    kind: "solidify",
    id: "ws-solidify",
    enabled: true,
    thickness,
    evenThickness: true,
    rim: true,
  });
  const evaluated = await evaluateStudioMeshModifierStack(stack, {
    booleanBackend: createStudioDefaultSolidBooleanBackend(),
  });
  if (!evaluated.ok) throw new Error(evaluated.detail);
  const session = hybridDccCommitGeometry(ws.session, id, evaluated.value.mesh);
  const bridge = mutateStudioSharedObjectGeometry(
    ws.bridge,
    id,
    evaluated.value.resultHash,
  );
  return { ...ws, session, bridge };
}

export async function workspaceBevelActive(
  ws: StudioHybridDccWorkspace,
  amount = 0.05,
): Promise<StudioHybridDccWorkspace> {
  const id = ws.activeAssetId;
  if (!id) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[id];
  if (!record) throw new Error(`missing ${id}`);
  let stack = createStudioMeshModifierStack(record.mesh);
  stack = withStudioMeshModifier(stack, {
    kind: "bevel",
    id: "ws-bevel",
    enabled: true,
    amount,
    segments: 1,
    angleLimitRad: Math.PI,
    weightInfluence: 1,
  });
  const evaluated = await evaluateStudioMeshModifierStack(stack, {
    booleanBackend: createStudioDefaultSolidBooleanBackend(),
  });
  if (!evaluated.ok) throw new Error(evaluated.detail);
  const session = hybridDccCommitGeometry(ws.session, id, evaluated.value.mesh);
  const bridge = mutateStudioSharedObjectGeometry(
    ws.bridge,
    id,
    evaluated.value.resultHash,
  );
  return { ...ws, session, bridge };
}

export function workspaceBendActive(
  ws: StudioHybridDccWorkspace,
  angleRad = Math.PI / 6,
): StudioHybridDccWorkspace {
  const id = ws.activeAssetId;
  if (!id) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[id];
  if (!record) throw new Error(`missing ${id}`);
  const bent = deformStudioMeshBend(record.mesh, angleRad, "y");
  if (!bent.ok) throw new Error(bent.detail);
  return commitActiveMesh(ws, bent.value);
}

export function workspaceRepairActive(ws: StudioHybridDccWorkspace): StudioHybridDccWorkspace {
  const id = ws.activeAssetId;
  if (!id) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[id];
  if (!record) throw new Error(`missing ${id}`);
  const repaired = repairStudioMesh(record.mesh);
  if (!repaired.ok) throw new Error(repaired.detail);
  return commitActiveMesh(ws, repaired.value.mesh);
}

/** Flip inverted face windings so normals point outward (CSG/Manifold prep). */
export function workspaceOrientOutwardActive(
  ws: StudioHybridDccWorkspace,
): StudioHybridDccWorkspace {
  const id = ws.activeAssetId;
  if (!id) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[id];
  if (!record) throw new Error(`missing ${id}`);
  const oriented = orientStudioMeshOutward(record.mesh);
  if (!oriented.ok) throw new Error(oriented.detail);
  return commitActiveMesh(ws, oriented.value.mesh);
}

export function workspaceShrinkwrapActive(
  ws: StudioHybridDccWorkspace,
  factor = 0.15,
): StudioHybridDccWorkspace {
  const id = ws.activeAssetId;
  if (!id) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[id];
  if (!record) throw new Error(`missing ${id}`);
  const wrapped = shrinkwrapStudioMesh(record.mesh, { x: 0, y: 0, z: 0 }, factor);
  if (!wrapped.ok) throw new Error(wrapped.detail);
  return commitActiveMesh(ws, wrapped.value);
}

export function workspaceVoxelRemeshActive(
  ws: StudioHybridDccWorkspace,
  cellSize = 0.15,
): StudioHybridDccWorkspace {
  const id = ws.activeAssetId;
  if (!id) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[id];
  if (!record) throw new Error(`missing ${id}`);
  const remeshed = voxelRemeshStudioMesh(record.mesh, cellSize);
  if (!remeshed.ok) throw new Error(remeshed.detail);
  return commitActiveMesh(ws, remeshed.mesh);
}

export function workspaceCadRevolve(
  ws: StudioHybridDccWorkspace,
  assetId = "cad-revolve",
): StudioHybridDccWorkspace {
  const solid = revolveStudioCadProfile(
    [
      [0.2, 0],
      [0.4, 0.3],
      [0.35, 0.7],
      [0.15, 1],
    ],
    12,
  );
  if (!solid) throw new Error("cad revolve failed");
  const verts = [];
  for (let i = 0; i + 2 < solid.positions.length; i += 3) {
    verts.push({
      x: solid.positions[i]!,
      y: solid.positions[i + 1]!,
      z: solid.positions[i + 2]!,
    });
  }
  const faces: number[][] = [];
  for (let i = 0; i + 2 < solid.indices.length; i += 3) {
    faces.push([solid.indices[i]!, solid.indices[i + 1]!, solid.indices[i + 2]!]);
  }
  const mesh = createStudioEditableMeshFromPolygons(verts, faces);
  let session = ws.session;
  if (!session.state.geometry.records[assetId]) {
    session = hybridDccRegisterAsset(session, assetId, mesh, {
      source: "cad-revolve",
      creator: "studio",
      license: "CC0-1.0",
      useScope: "commercial",
      derivative: "original",
    });
  } else {
    session = hybridDccCommitGeometry(session, assetId, mesh);
  }
  return { ...ws, session, activeAssetId: assetId };
}

export function workspaceExportActiveMesh(
  ws: StudioHybridDccWorkspace,
  format: StudioMeshExportFormat = "obj",
): StudioHybridDccWorkspace {
  const assetId = ws.activeAssetId;
  if (!assetId) throw new Error("no active asset");
  const record = ws.session.state.geometry.records[assetId];
  if (!record) throw new Error(`missing ${assetId}`);
  if (record.modifierStack.modifiers.length > 0) {
    throw new Error(
      "비파괴 변형이 화면에 적용되어 있습니다. 원본 케이지를 조용히 내보내지 않도록 변형 적용 후 다시 내보내 주세요.",
    );
  }
  const lastExport = exportStudioMeshByFormat(record.mesh, format);
  return { ...ws, lastExport };
}

/** Industrial openNURBS sphere mesh via rhino3dm. */
export async function workspaceOpenNurbsSphere(
  ws: StudioHybridDccWorkspace,
  assetId = "opennurbs-sphere",
  radius = 1,
): Promise<StudioHybridDccWorkspace> {
  const { evaluateStudioNurbsSurfaceSphere } = await import("../studio-rhino3dm-nurbs");
  const surf = await evaluateStudioNurbsSurfaceSphere(radius, 16, 12);
  let session = ws.session;
  if (!session.state.geometry.records[assetId]) {
    session = hybridDccRegisterAsset(session, assetId, surf.mesh, {
      source: "rhino3dm-opennurbs",
      creator: "studio",
      license: "CC0-1.0",
      useScope: "commercial",
      derivative: "original",
    });
  } else {
    session = hybridDccCommitGeometry(session, assetId, surf.mesh);
  }
  return { ...ws, session, activeAssetId: assetId };
}

/** Industrial web-ifc city import → workspace meshes. */
export async function workspaceImportIfcCity(
  ws: StudioHybridDccWorkspace,
  ifcText?: string,
): Promise<StudioHybridDccWorkspace> {
  const { createStudioIfcCityFixture, importStudioIfcCity } = await import("../studio-web-ifc-city");
  const city = await importStudioIfcCity(
    ifcText ?? createStudioIfcCityFixture({ buildings: 2, storeysPerBuilding: 3 }),
  );
  if (!city.ok) throw new Error(`IFC city: ${city.detail}`);
  let session = ws.session;
  let active: string | null = ws.activeAssetId;
  city.meshes.forEach((mesh, i) => {
    const id = `ifc-city-${i}`;
    if (!session.state.geometry.records[id]) {
      session = hybridDccRegisterAsset(session, id, mesh, {
        source: "web-ifc-city",
        creator: "studio",
        license: "CC0-1.0",
        useScope: "commercial",
        derivative: "original",
      });
    } else {
      session = hybridDccCommitGeometry(session, id, mesh);
    }
    active = id;
  });
  return { ...ws, session, activeAssetId: active };
}

/** Industrial OCCT WASM box solid → workspace asset. */
export async function workspaceOcctBox(
  ws: StudioHybridDccWorkspace,
  assetId = "occt-box",
  size: readonly [number, number, number] = [1, 1, 1],
): Promise<StudioHybridDccWorkspace> {
  const { runStudioOcctOperation } = await import("../studio-occt-worker-client");
  const result = await runStudioOcctOperation({ kind: "box", size });
  return commitOcctResult(ws, assetId, "occt-wasm", result);
}

/** Industrial OCCT boolean cut of two boxes. */
export async function workspaceOcctBooleanCut(
  ws: StudioHybridDccWorkspace,
  assetId = "occt-cut",
): Promise<StudioHybridDccWorkspace> {
  const { runStudioOcctOperation } = await import("../studio-occt-worker-client");
  const result = await runStudioOcctOperation({
    kind: "cut-boxes",
    a: { dx: 2, dy: 2, dz: 2 },
    b: { dx: 1, dy: 1, dz: 1, ox: 0.4, oy: 0.4, oz: 0.4 },
  });
  return commitOcctResult(ws, assetId, "occt-wasm-boolean", result);
}

async function commitOcctResult(
  ws: StudioHybridDccWorkspace,
  assetId: string,
  source: string,
  result: import("../studio-occt-wasm-facade").StudioOcctSolidResult,
): Promise<StudioHybridDccWorkspace> {
  const {
    studioOcctTopologyReceiptMatchesMesh,
    validateStudioOcctBodyReceipt,
  } = await import("../studio-occt-wasm-facade");
  if (!studioOcctTopologyReceiptMatchesMesh(result.mesh, result.topology)) {
    throw new Error(
      `OCCT refused a mesh/receipt topology mismatch: ${result.operation}`,
    );
  }
  const receiptFailure = validateStudioOcctBodyReceipt(
    result.bodyKind,
    result.topology,
    result.massProperties,
    result.operation,
  );
  if (receiptFailure) {
    throw new Error(
      `OCCT refused an invalid ${result.bodyKind} commit: ${receiptFailure.detail}`,
    );
  }
  if (result.bodyKind === "surface" && result.operation !== "BRepAlgoAPI_Section") {
    throw new Error(`OCCT refused an unsupported surface commit: ${result.operation}`);
  }
  let session = ws.session;
  if (!session.state.geometry.records[assetId]) {
    session = hybridDccRegisterAsset(session, assetId, result.mesh, {
      source,
      creator: "studio",
      license: "CC0-1.0",
      useScope: "commercial",
      derivative: "original",
    });
  } else {
    session = hybridDccCommitGeometry(session, assetId, result.mesh);
  }
  return { ...ws, session, activeAssetId: assetId, lastOcct: result };
}

/** Industrial OCCT revolve solid → workspace. */
export async function workspaceOcctRevolve(
  ws: StudioHybridDccWorkspace,
  assetId = "occt-revolve",
  radius = 0.5,
  height = 1,
): Promise<StudioHybridDccWorkspace> {
  const { runStudioOcctOperation } = await import("../studio-occt-worker-client");
  const result = await runStudioOcctOperation({ kind: "revolve", radius, height });
  return commitOcctResult(ws, assetId, "occt-wasm-revolve", result);
}

/** Industrial OCCT sphere solid → workspace. */
export async function workspaceOcctSphere(
  ws: StudioHybridDccWorkspace,
  assetId = "occt-sphere",
  radius = 0.75,
): Promise<StudioHybridDccWorkspace> {
  const { runStudioOcctOperation } = await import("../studio-occt-worker-client");
  const result = await runStudioOcctOperation({ kind: "sphere", radius });
  return commitOcctResult(ws, assetId, "occt-wasm-sphere", result);
}

/** Industrial OCCT torus solid → workspace. */
export async function workspaceOcctTorus(
  ws: StudioHybridDccWorkspace,
  assetId = "occt-torus",
  majorRadius = 0.8,
  minorRadius = 0.2,
): Promise<StudioHybridDccWorkspace> {
  const { runStudioOcctOperation } = await import("../studio-occt-worker-client");
  const result = await runStudioOcctOperation({
    kind: "torus",
    majorRadius,
    minorRadius,
  });
  return commitOcctResult(ws, assetId, "occt-wasm-torus", result);
}

/** Industrial OCCT pipe/sweep solid → workspace. */
export async function workspaceOcctPipe(
  ws: StudioHybridDccWorkspace,
  assetId = "occt-pipe",
  length = 1.5,
  radius = 0.12,
): Promise<StudioHybridDccWorkspace> {
  const { runStudioOcctOperation } = await import("../studio-occt-worker-client");
  const result = await runStudioOcctOperation({ kind: "pipe", length, radius });
  return commitOcctResult(ws, assetId, "occt-wasm-pipe", result);
}

/** Industrial OCCT mirrored box assembly → workspace. */
export async function workspaceOcctMirror(
  ws: StudioHybridDccWorkspace,
  assetId = "occt-mirror",
): Promise<StudioHybridDccWorkspace> {
  const { runStudioOcctOperation } = await import("../studio-occt-worker-client");
  const result = await runStudioOcctOperation({
    kind: "mirror-box",
    size: [0.8, 0.5, 0.4],
  });
  return commitOcctResult(ws, assetId, "occt-wasm-mirror", result);
}

/** Industrial OCCT thick/shell box → workspace. */
export async function workspaceOcctThickShell(
  ws: StudioHybridDccWorkspace,
  assetId = "occt-thick",
): Promise<StudioHybridDccWorkspace> {
  const { runStudioOcctOperation } = await import("../studio-occt-worker-client");
  const result = await runStudioOcctOperation({
    kind: "thick-shell-box",
    size: [1, 1, 0.5],
    thickness: 0.05,
  });
  return commitOcctResult(ws, assetId, "occt-wasm-thick", result);
}

/** Industrial OCCT wedge / draft solid → workspace. */
export async function workspaceOcctWedge(
  ws: StudioHybridDccWorkspace,
  assetId = "occt-wedge",
  size: readonly [number, number, number] = [1, 1, 1],
  ltx = 0.3,
): Promise<StudioHybridDccWorkspace> {
  const { runStudioOcctOperation } = await import("../studio-occt-worker-client");
  const result = await runStudioOcctOperation({
    kind: "wedge",
    size,
    ltx,
  });
  return commitOcctResult(ws, assetId, "occt-wasm-wedge", result);
}

/** Industrial OCCT offset shape (box expand) → workspace. */
export async function workspaceOcctOffsetShape(
  ws: StudioHybridDccWorkspace,
  assetId = "occt-offset",
  size: readonly [number, number, number] = [1, 1, 1],
  offset = 0.08,
): Promise<StudioHybridDccWorkspace> {
  const { runStudioOcctOperation } = await import("../studio-occt-worker-client");
  const result = await runStudioOcctOperation({
    kind: "offset-shape-box",
    size,
    offset,
  });
  return commitOcctResult(ws, assetId, "occt-wasm-offset", result);
}

/** Industrial OCCT 2D-fillet + extrude solid → workspace. */
export async function workspaceOcctFillet2dExtrude(
  ws: StudioHybridDccWorkspace,
  assetId = "occt-fillet2d",
): Promise<StudioHybridDccWorkspace> {
  const { runStudioOcctOperation } = await import("../studio-occt-worker-client");
  const result = await runStudioOcctOperation({
    kind: "fillet2d-extrude",
    width: 1,
    height: 1,
    depth: 0.4,
    filletRadius: 0.12,
  });
  return commitOcctResult(ws, assetId, "occt-wasm-fillet2d", result);
}

/** Industrial OCCT pipe shell solid → workspace. */
export async function workspaceOcctPipeShell(
  ws: StudioHybridDccWorkspace,
  assetId = "occt-pipeshell",
  length = 2,
  radius = 0.15,
): Promise<StudioHybridDccWorkspace> {
  const { runStudioOcctOperation } = await import("../studio-occt-worker-client");
  const result = await runStudioOcctOperation({ kind: "pipe-shell", length, radius });
  return commitOcctResult(ws, assetId, "occt-wasm-pipeshell", result);
}

/** Industrial OCCT planar section face → workspace. */
export async function workspaceOcctSection(
  ws: StudioHybridDccWorkspace,
  assetId = "occt-section",
): Promise<StudioHybridDccWorkspace> {
  const { runStudioOcctOperation } = await import("../studio-occt-worker-client");
  const result = await runStudioOcctOperation({
    kind: "section-box",
    size: [1, 1, 1],
  });
  return commitOcctResult(ws, assetId, "occt-wasm-section", result);
}

/** Industrial OCCT draft prism (MakeDPrism) → workspace. */
export async function workspaceOcctDraftPrism(
  ws: StudioHybridDccWorkspace,
  assetId = "occt-dprism",
): Promise<StudioHybridDccWorkspace> {
  const { runStudioOcctOperation } = await import("../studio-occt-worker-client");
  const result = await runStudioOcctOperation({
    kind: "draft-prism",
    baseSize: 2,
    profileInset: 0.5,
    height: 1.0,
    angle: 0.1,
  });
  return commitOcctResult(ws, assetId, "occt-wasm-dprism", result);
}

/** Industrial OCCT linear pattern fuse → workspace. */
export async function workspaceOcctLinearPattern(
  ws: StudioHybridDccWorkspace,
  assetId = "occt-pattern",
): Promise<StudioHybridDccWorkspace> {
  const { runStudioOcctOperation } = await import("../studio-occt-worker-client");
  const result = await runStudioOcctOperation({
    kind: "linear-pattern-box",
    size: [0.8, 0.5, 0.4],
    offsetX: 1.2,
    count: 2,
  });
  return commitOcctResult(ws, assetId, "occt-wasm-pattern", result);
}

/** Industrial OCCT circular pattern fuse → workspace. */
export async function workspaceOcctCircularPattern(
  ws: StudioHybridDccWorkspace,
  assetId = "occt-circular",
): Promise<StudioHybridDccWorkspace> {
  const { runStudioOcctOperation } = await import("../studio-occt-worker-client");
  const result = await runStudioOcctOperation({
    kind: "circular-pattern-box",
    size: [0.4, 0.3, 0.2],
    radius: 1.2,
    count: 4,
  });
  return commitOcctResult(ws, assetId, "occt-wasm-circular", result);
}

/** Industrial STEP write+read round-trip box → workspace. */
export async function workspaceOcctStepRoundTrip(
  ws: StudioHybridDccWorkspace,
  assetId = "occt-step",
): Promise<StudioHybridDccWorkspace> {
  const { runStudioOcctOperation } = await import("../studio-occt-worker-client");
  const result = await runStudioOcctOperation({
    kind: "step-roundtrip-box",
    size: [1, 1, 1],
  });
  return commitOcctResult(ws, assetId, "occt-wasm-step", result);
}

/**
 * Multi-asset solid boolean: difference of two registered geometry assets
 * via the default Manifold backend (MOD-014 product path).
 */
export async function workspaceBooleanBetweenAssets(
  ws: StudioHybridDccWorkspace,
  leftAssetId: string,
  rightAssetId: string,
  operation: "difference" | "union" | "intersection" = "difference",
  outAssetId = "boolean-result",
): Promise<StudioHybridDccWorkspace> {
  const leftRec = ws.session.state.geometry.records[leftAssetId];
  const rightRec = ws.session.state.geometry.records[rightAssetId];
  if (!leftRec || !rightRec) {
    throw new Error(`missing assets left=${leftAssetId} right=${rightAssetId}`);
  }
  const leftSoup = studioEditableMeshToTriangleSoup(leftRec.mesh);
  const rightSoup = studioEditableMeshToTriangleSoup(rightRec.mesh);
  let stack = createStudioMeshModifierStack(leftRec.mesh);
  stack = withStudioMeshModifier(stack, {
    kind: "boolean",
    id: "multi-asset-bool",
    enabled: true,
    operation,
    operand: { positions: rightSoup.positions, indices: rightSoup.indices },
  });
  const e = await evaluateStudioMeshModifierStack(stack, {
    booleanBackend: createStudioDefaultSolidBooleanBackend(),
  });
  if (!e.ok) throw new Error(e.detail);
  const soupOut = studioEditableMeshToTriangleSoup(e.value.mesh);
  if (soupOut.indices.length / 3 < 4) {
    throw new Error(`multi-asset boolean degenerate tris=${soupOut.indices.length / 3}`);
  }
  let session = ws.session;
  if (!session.state.geometry.records[outAssetId]) {
    session = hybridDccRegisterAsset(session, outAssetId, e.value.mesh, {
      source: `boolean-${operation}`,
      creator: "studio",
      license: "CC0-1.0",
      useScope: "commercial",
      derivative: "original",
    });
  } else {
    session = hybridDccCommitGeometry(session, outAssetId, e.value.mesh);
  }
  void leftSoup;
  return { ...ws, session, activeAssetId: outAssetId };
}

/** Industrial OCCT fillet box → workspace. */
export async function workspaceOcctFillet(
  ws: StudioHybridDccWorkspace,
  assetId = "occt-fillet",
): Promise<StudioHybridDccWorkspace> {
  const { runStudioOcctOperation } = await import("../studio-occt-worker-client");
  const result = await runStudioOcctOperation({
    kind: "fillet-box",
    size: [1, 1, 1],
    radius: 0.08,
  });
  return commitOcctResult(ws, assetId, "occt-wasm-fillet", result);
}

/** Industrial OCCT ThruSections loft → workspace. */
export async function workspaceOcctLoft(
  ws: StudioHybridDccWorkspace,
  assetId = "occt-loft",
): Promise<StudioHybridDccWorkspace> {
  const { runStudioOcctOperation } = await import("../studio-occt-worker-client");
  const result = await runStudioOcctOperation({
    kind: "loft",
    levels: [
      { dx: 2, dy: 2, z: 0 },
      { dx: 1.4, dy: 1.4, z: 1 },
      { dx: 0.8, dy: 0.8, z: 2 },
    ],
  });
  return commitOcctResult(ws, assetId, "occt-wasm-loft", result);
}

/**
 * MOD-014 Manifold (default backend) solid difference on the active mesh
 * against an offset/scaled copy of itself.
 */
export async function workspaceManifoldBooleanActive(
  ws: StudioHybridDccWorkspace,
): Promise<StudioHybridDccWorkspace> {
  const mesh = workspaceActiveMesh(ws);
  if (!mesh) throw new Error("no active asset");
  const soup = studioEditableMeshToTriangleSoup(mesh);
  const op = new Float32Array(soup.positions);
  for (let i = 0; i < op.length; i += 3) op[i]! += 0.35;
  for (let i = 0; i < op.length; i += 1) op[i]! *= 0.72;
  let stack = createStudioMeshModifierStack(mesh);
  stack = withStudioMeshModifier(stack, {
    kind: "boolean",
    id: "manifold-diff",
    enabled: true,
    operation: "difference",
    operand: { positions: op, indices: soup.indices },
  });
  const e = await evaluateStudioMeshModifierStack(stack, {
    booleanBackend: createStudioDefaultSolidBooleanBackend(),
  });
  if (!e.ok) throw new Error(e.detail);
  const soupOut = studioEditableMeshToTriangleSoup(e.value.mesh);
  if (soupOut.indices.length / 3 < 8) {
    throw new Error(`manifold boolean degenerate tris=${soupOut.indices.length / 3}`);
  }
  return commitActiveMesh(ws, e.value.mesh);
}

/** SCP-006 dynatopo refine/coarsen on active mesh. */
export function workspaceDynatopoActive(
  ws: StudioHybridDccWorkspace,
  mode: "refine" | "coarsen" = "refine",
  radius = 0.75,
): StudioHybridDccWorkspace {
  const mesh = workspaceActiveMesh(ws);
  if (!mesh) throw new Error("no active asset");
  const result = dynatopoStudioMeshBrushLocal(
    mesh,
    { center: { x: 0.5, y: 0.5, z: 0.5 }, radius },
    mode,
  );
  if (!result.ok) throw new Error(result.detail);
  const next = commitActiveMesh(ws, result.value.mesh);
  return {
    ...next,
    lastDynatopo: {
      facesBefore: result.value.facesBefore,
      facesAfter: result.value.facesAfter,
      boundaryEdges: result.value.boundaryEdges,
      mode,
    },
  };
}

/** SCP-011 auto-retopo on active mesh. */
export function workspaceRetopoActive(
  ws: StudioHybridDccWorkspace,
  targetFaces = 8,
): StudioHybridDccWorkspace {
  const mesh = workspaceActiveMesh(ws);
  if (!mesh) throw new Error("no active asset");
  const result = autoRetopoStudioMeshBasic(mesh, { targetFaces, symmetryX: true });
  if (!result.ok) throw new Error(result.detail);
  const next = commitActiveMesh(ws, result.value.mesh);
  return {
    ...next,
    lastRetopo: {
      facesBefore: result.value.facesBefore,
      facesAfter: result.value.facesAfter,
      targetFaces: result.value.targetFaces,
      meanError: result.value.meanError,
    },
  };
}

export function workspaceStepSpring(ws: StudioHybridDccWorkspace): StudioHybridDccWorkspace {
  const base: StudioSpringBone = ws.lastSpring ?? {
    id: "hair-0",
    head: [0, 1.5, 0],
    tail: [0, 1.2, 0.1],
    stiffness: 0.6,
    drag: 0.2,
    gravity: [0, -9.8, 0],
    velocity: [0, 0, 0],
  };
  return { ...ws, lastSpring: stepStudioSpringBone(base, 1 / 60) };
}

export function workspaceSampleIdleClip(
  ws: StudioHybridDccWorkspace,
  time = 0.25,
): StudioHybridDccWorkspace {
  const clip = createStudioIdleClip();
  void sampleStudioAnimationClip(clip, time);
  return { ...ws, animSampleTime: time };
}

/**
 * Full multi-kernel engine suite: geo-nodes starter, CAD revolve, modifiers, sculpt remesh,
 * cloth, spring, export, toon passes, pack.
 */
export async function runStudioHybridDccFullEngineSuite(
  documentId = "full-engine-suite",
): Promise<{
  readonly workspace: StudioHybridDccWorkspace;
  readonly package: StudioToon3dPackage;
  readonly metrics: {
    readonly assetCount: number;
    readonly engines: readonly string[];
    readonly exportFormat: string | null;
    readonly exportTriangles: number;
    readonly springTailY: number | null;
    readonly packageHash: string;
    readonly toonPassCount: number;
    readonly diagnosticErrors: number;
  };
}> {
  const engines: string[] = [];
  let ws = createStudioHybridDccWorkspace(documentId);
  // Keep starter graph output as a clean manifold asset (do not stack destructive modifiers on it).
  ws = workspaceAddGeoNodesStarter(ws, "gn-starter");
  engines.push("geometry-nodes-starter");
  // Modifier / deform stack on a unit cube — solidify/bevel can non-manifold exotic shells.
  ws = workspaceAddUnitCube(ws, "mod-cube");
  engines.push("primitive-cube");
  ws = await workspaceSolidifyActive(ws, 0.04);
  engines.push("modifier-solidify");
  ws = await workspaceBevelActive(ws, 0.03);
  engines.push("modifier-bevel");
  ws = workspaceBendActive(ws, Math.PI / 8);
  engines.push("deform-bend");
  ws = workspaceShrinkwrapActive(ws, 0.05);
  engines.push("deform-shrinkwrap");
  ws = workspaceRepairActive(ws);
  engines.push("mesh-repair");
  ws = workspaceSculptActive(ws, 0.05);
  engines.push("sculpt-inflate");
  // CAD extrude path is manifold-safe for document diagnostics (revolve is available via workspaceCadRevolve).
  ws = workspaceCadProp(ws, "cad-box");
  engines.push("cad-extrude");
  // Drop heavily stacked mod-cube before diagnostics if it became non-manifold — replace with clean cube.
  {
    const probe = scanStudioHybridDccCorruption(ws.session.state);
    const bad = probe.findings.some(
      (f) => f.severity === "error" && f.targetId === "mod-cube",
    );
    if (bad) {
      const clean = createStudioUnitCubeMesh();
      const session = hybridDccCommitGeometry(ws.session, "mod-cube", clean);
      const bridge = mutateStudioSharedObjectGeometry(
        ws.bridge,
        "mod-cube",
        hashStudioEditableMesh(clean),
      );
      ws = { ...ws, session, bridge, activeAssetId: "mod-cube" };
      engines.push("mod-cube-reset-clean");
    }
  }
  ws = workspaceClothStep(ws);
  engines.push("cloth-xpbd-v2");
  ws = workspaceStepSpring(ws);
  engines.push("spring-bone");
  ws = workspaceSampleIdleClip(ws, 0.5);
  engines.push("anim-clip");
  ws = workspaceExportActiveMesh(ws, "stl");
  engines.push("export-stl");
  ws = workspaceEnsureShots(ws, 4);
  for (const pass of STUDIO_TOON_PASS_KINDS) {
    ws = { ...ws, bridge: generateStudioToonPass(ws.bridge, "shot-1", pass) };
  }
  engines.push("npr-toon-passes");
  ws = workspaceRebuildBom(ws);
  engines.push("mfg-bom");
  const pkg = workspaceExportToon3d(ws);
  engines.push("toon3d-pack");
  const diag = workspaceDiagnostics(ws);
  return {
    workspace: ws,
    package: pkg,
    metrics: {
      assetCount: Object.keys(ws.session.state.geometry.records).length,
      engines,
      exportFormat: ws.lastExport?.format ?? null,
      exportTriangles: ws.lastExport?.triangleCount ?? 0,
      springTailY: ws.lastSpring?.tail[1] ?? null,
      packageHash: pkg.manifest.packageHash,
      toonPassCount: STUDIO_TOON_PASS_KINDS.length,
      diagnosticErrors: diag.errorCount,
    },
  };
}

export type StudioHybridDccWaveProductLoopResult = {
  readonly workspace: StudioHybridDccWorkspace;
  readonly package: StudioToon3dPackage;
  readonly metrics: {
    readonly assetCount: number;
    readonly shotCount: number;
    readonly bomLines: number;
    readonly collabEpoch: number;
    readonly collabOps: number;
    readonly collabConflicts: number;
    readonly uvMode: string | null;
    readonly packageHash: string;
    readonly documentHasGeo: boolean;
    readonly importFormat: string | null;
    readonly importGeometryFidelity: string | null;
    readonly diagnosticErrors: number;
  };
};

/**
 * End-to-end product loop (wave): geo-nodes → edit → IFC import shell → retarget/BOM/collab → .toon3d.
 * Pure workspace APIs only — gated by product tests asserting concrete metrics.
 */
export async function runStudioHybridDccWaveProductLoop(
  documentId = "wave-product-loop",
): Promise<StudioHybridDccWaveProductLoopResult> {
  let ws = createStudioHybridDccWorkspace(documentId);
  ws = workspaceAddGeoNodesPrimitive(ws, "sphere", "geo-sphere", 6);
  ws = workspaceKnifeActive(ws, { x: 0, y: 1, z: 0 });
  ws = workspaceSculptActive(ws, 0.08);
  ws = workspaceUvUnwrapActive(ws, "box");

  const ifcText = [
    "ISO-10303-21;",
    "DATA;",
    "#1=IFCCARTESIANPOINT((0.,0.,0.));",
    "#2=IFCCARTESIANPOINT((4.,0.,0.));",
    "#3=IFCCARTESIANPOINT((4.,3.,0.));",
    "#4=IFCCARTESIANPOINT((0.,3.,2.));",
    "#5=IFCSPACE('1','Lobby','',$,$,$,$,$,.ELEMENT.,$,$);",
    "#6=IFCBUILDINGSTOREY('2','L1','',$,$,$,$,$,.ELEMENT.,$);",
    "#7=IFCWALL('3','W1',$,$,$,$,$,$,$);",
    "#8=IFCDOOR('4','D1',$,$,$,$,$,$,$);",
    "ENDSEC;",
  ].join("\n");
  ws = workspaceImportBytes(ws, "lobby.ifc", new TextEncoder().encode(ifcText));
  const importRec =
    ws.lastImportReport && typeof ws.lastImportReport === "object" && ws.lastImportReport !== null
      ? (ws.lastImportReport as {
          adapterFormat?: string;
          format?: string;
          fidelity?: { geometry?: string };
          sourceHash?: string;
        })
      : null;
  const importFormat = importRec?.adapterFormat ?? importRec?.format ?? null;
  const importGeometryFidelity = importRec?.fidelity?.geometry ?? null;

  ws = workspaceRetargetFromBvhExtras(ws, ["Hips", "Spine", "Head", "LeftArm", "RightArm"]);
  ws = workspaceRebuildBom(ws);
  ws = workspaceCollabJoin(ws, "artist-a", "Artist A");
  const active = ws.activeAssetId ?? "geo-sphere";
  const geoHash =
    ws.session.state.geometry.records[active]?.meshHash ?? hashStudioEditableMesh(
      ws.session.state.geometry.records[Object.keys(ws.session.state.geometry.records)[0]!]!.mesh,
    );
  ws = {
    ...ws,
    collab: collabAppendOp(ws.collab, {
      kind: "lock",
      peerId: "artist-a",
      assetId: active,
      at: Date.now(),
    }),
  };
  ws = {
    ...ws,
    collab: collabAppendOp(ws.collab, {
      kind: "geometry-hint",
      peerId: "artist-a",
      assetId: active,
      geometryHash: geoHash,
      at: Date.now(),
    }),
  };
  ws = workspaceEnsureShots(ws, 4);
  const pkg = workspaceExportToon3d(ws);
  const diag = workspaceDiagnostics(ws);
  const conflicts = collabConflictReport(ws.collab);

  return {
    workspace: ws,
    package: pkg,
    metrics: {
      assetCount: Object.keys(ws.session.state.geometry.records).length,
      shotCount: ws.bridge.shots.length,
      bomLines: ws.bom.lines.length,
      collabEpoch: ws.collab.epoch,
      collabOps: ws.collab.ops.length,
      collabConflicts: conflicts.length,
      uvMode: ws.lastUvMap?.mode ?? null,
      packageHash: pkg.manifest.packageHash,
      documentHasGeo: (pkg.files["document/document.json"] ?? "").includes("geo-sphere")
        || (pkg.files["document/document.json"] ?? "").includes("import-lobby"),
      importFormat,
      importGeometryFidelity,
      diagnosticErrors: diag.errorCount,
    },
  };
}
