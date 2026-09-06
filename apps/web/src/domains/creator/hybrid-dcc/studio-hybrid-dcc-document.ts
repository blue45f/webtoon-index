/**
 * Hybrid DCC document foundation (DOC P0 + Rights BOM P1).
 * Command transactions with undo/redo, dependency dirty, content-addressed assets,
 * OPFS journal checkpoint recovery that restores full geometry/document state, Rights BOM.
 */

import {
  canonicalStudioCommandJson,
  createStudioCommandEnvelope,
  createStudioCommandJournal,
  restoreStudioCommandJournal,
  serializeStudioCommandJournal,
  type StudioCommandJournal,
  type StudioCommandJsonValue,
} from "../studio-command-journal";
import {
  STUDIO_EDITABLE_MESH_LIMITS,
  deserializeStudioEditableMesh,
  hashStudioEditableMesh,
  isIssuedStudioEditableMeshExtrudeRegionReceipt,
  matchesStudioEditableMeshPersistedHash,
  serializeStudioEditableMesh,
  type StudioEditableMesh,
  type StudioEditableMeshExtrudeRegionReceipt,
  type StudioEditableMeshSnapshot,
} from "../studio-editable-half-edge-mesh";
import {
  applyStudioGeometryAuthorityModifierStack,
  commitStudioGeometryAuthorityMesh,
  createStudioGeometryAuthorityRegistry,
  registerStudioGeometryAuthority,
  setStudioGeometryAuthorityModifierStack,
  type StudioGeometryAuthorityRegistry,
} from "../studio-geometry-authority";
import {
  createStudioMeshModifierStack,
  deserializeStudioMeshModifierStack,
  hashStudioMeshModifierStack,
  serializeStudioMeshModifierStack,
  type StudioMeshModifier,
  type StudioMeshModifierStack,
  type StudioMeshModifierStackDto,
} from "../studio-mesh-modifier-stack";
import {
  createStudioOpfsRecoveryJournal,
  type StudioOpfsRecoveryJournal,
  type StudioOpfsRecoveryJournalAdapter,
  type StudioOpfsRecoveryWriterLease,
} from "../studio-opfs-recovery-journal";
import { sha256HexPortable } from "../studio-sha256";

import {
  createStudioHybridDccIdentityTransform,
  hashStudioHybridDccObjectTransform,
  normalizeStudioHybridDccObjectTransform,
  type StudioHybridDccObjectTransform,
} from "./studio-hybrid-dcc-object-transform";

export const STUDIO_HYBRID_DCC_DOCUMENT_VERSION = 3 as const;
export const STUDIO_HYBRID_DCC_PREVIOUS_DOCUMENT_VERSION = 2 as const;
export const STUDIO_HYBRID_DCC_LEGACY_DOCUMENT_VERSION = 1 as const;
export const STUDIO_HYBRID_DCC_DOCUMENT_FORMAT =
  "toonspectrum.hybrid-dcc-document" as const;
export const STUDIO_HYBRID_DCC_ENGINE_VERSION = "hybrid-dcc-engine-1" as const;

export interface StudioRightsBomRecord {
  readonly assetId: string;
  readonly source: string;
  readonly creator: string;
  readonly license: string;
  readonly useScope: string;
  readonly derivative: string;
  readonly contentHash?: `sha256:${string}`;
  /** Immutable lineage copied from Boolean cutters before their stack is baked away. */
  readonly provenance?: readonly StudioRightsBomProvenanceRecord[];
}

export interface StudioRightsBomProvenanceRecord {
  readonly role: "boolean-operand";
  readonly assetId: string;
  readonly modifierId: string;
  readonly operation: "union" | "difference" | "intersection";
  readonly source: string;
  readonly creator: string;
  readonly license: string;
  readonly useScope: string;
  readonly derivative: string;
  readonly contentHash?: `sha256:${string}`;
  readonly sourceMeshHash: string;
  readonly modifierStackHash: string;
  readonly evaluatedMeshHash: string;
  readonly objectTransformHash: string;
  readonly resolvedOperandHash: `sha256:${string}`;
}

export interface StudioHybridDccBooleanOperandEvaluationReceipt {
  readonly modifierId: string;
  readonly operation: "union" | "difference" | "intersection";
  readonly operandAssetId: string;
  readonly sourceMeshHash: string;
  readonly modifierStackHash: string;
  readonly evaluatedMeshHash: string;
  readonly objectTransformHash: string;
  readonly resolvedOperandHash: `sha256:${string}`;
}

/** Hash-bound result passed from async modifier evaluation into the synchronous commit boundary. */
export interface StudioHybridDccModifierStackEvaluationReceipt {
  readonly mesh: StudioEditableMesh;
  readonly sourceHash: string;
  readonly stackHash: string;
  readonly resultHash: string;
  readonly booleanOperands?: readonly StudioHybridDccBooleanOperandEvaluationReceipt[];
}

export interface StudioHybridDccDependencyEdge {
  readonly fromId: string;
  readonly toId: string;
  readonly kind: "geometry" | "shot-pass" | "material" | "pose";
}

export interface StudioHybridDccDocumentState {
  readonly format: typeof STUDIO_HYBRID_DCC_DOCUMENT_FORMAT;
  readonly version: typeof STUDIO_HYBRID_DCC_DOCUMENT_VERSION;
  readonly documentId: string;
  readonly geometry: StudioGeometryAuthorityRegistry;
  /** Object-local geometry is placed by these canonical, undoable authoring transforms. */
  readonly objectTransforms: Readonly<Record<string, StudioHybridDccObjectTransform>>;
  readonly rightsBom: readonly StudioRightsBomRecord[];
  readonly dependencies: readonly StudioHybridDccDependencyEdge[];
  readonly dirtyNodeIds: readonly string[];
  readonly milestoneLabel: string | null;
  readonly commandCount: number;
  readonly stateHash: string;
}

/** Serializable full-document snapshot (meshes as polygon soup). */
export interface StudioHybridDccPersistedSnapshot {
  readonly format: typeof STUDIO_HYBRID_DCC_DOCUMENT_FORMAT;
  readonly version: typeof STUDIO_HYBRID_DCC_DOCUMENT_VERSION;
  readonly documentId: string;
  readonly commandCount: number;
  readonly stateHash: string;
  readonly milestoneLabel: string | null;
  readonly dirtyNodeIds: readonly string[];
  readonly rightsBom: readonly StudioRightsBomRecord[];
  readonly dependencies: readonly StudioHybridDccDependencyEdge[];
  readonly objectTransforms: Readonly<Record<string, StudioHybridDccObjectTransform>>;
  readonly assets: readonly {
    readonly assetId: string;
    readonly meshHash: string;
    readonly revision: number;
    readonly mesh: StudioEditableMeshSnapshot;
    readonly modifierStack: StudioMeshModifierStackDto;
  }[];
}

interface StudioHybridDccLegacyPersistedAsset {
  readonly assetId: string;
  readonly meshHash: string;
  readonly revision: number;
  readonly mesh: StudioEditableMeshSnapshot;
}

interface StudioHybridDccLegacyPersistedSnapshotV2 {
  readonly format: typeof STUDIO_HYBRID_DCC_DOCUMENT_FORMAT;
  readonly version: typeof STUDIO_HYBRID_DCC_PREVIOUS_DOCUMENT_VERSION;
  readonly documentId: string;
  readonly commandCount: number;
  readonly stateHash: string;
  readonly milestoneLabel: string | null;
  readonly dirtyNodeIds: readonly string[];
  readonly rightsBom: readonly StudioRightsBomRecord[];
  readonly dependencies: readonly StudioHybridDccDependencyEdge[];
  readonly objectTransforms: Readonly<Record<string, StudioHybridDccObjectTransform>>;
  readonly assets: readonly StudioHybridDccLegacyPersistedAsset[];
}

interface StudioHybridDccLegacyPersistedSnapshotV1 {
  readonly format: typeof STUDIO_HYBRID_DCC_DOCUMENT_FORMAT;
  readonly version: typeof STUDIO_HYBRID_DCC_LEGACY_DOCUMENT_VERSION;
  readonly documentId: string;
  readonly commandCount: number;
  readonly stateHash: string;
  readonly milestoneLabel: string | null;
  readonly dirtyNodeIds: readonly string[];
  readonly rightsBom: readonly StudioRightsBomRecord[];
  readonly dependencies: readonly StudioHybridDccDependencyEdge[];
  readonly assets: readonly StudioHybridDccLegacyPersistedAsset[];
}

export type StudioHybridDccRestorableSnapshot =
  | StudioHybridDccPersistedSnapshot
  | StudioHybridDccLegacyPersistedSnapshotV2
  | StudioHybridDccLegacyPersistedSnapshotV1;

export interface StudioHybridDccSession {
  readonly state: StudioHybridDccDocumentState;
  readonly journal: StudioCommandJournal;
  /** Prior states for undo (most recent last). */
  readonly undoStack: readonly StudioHybridDccPersistedSnapshot[];
  /** States undone, available for redo. */
  readonly redoStack: readonly StudioHybridDccPersistedSnapshot[];
  /** Last group id for command-journal undo linkage. */
  readonly lastGroupId: string | null;
  readonly undoGroupStack: readonly string[];
  readonly redoGroupStack: readonly string[];
  readonly lamport: number;
}

function stateHash(parts: readonly string[]): string {
  return `sha256:${sha256HexPortable(new TextEncoder().encode(parts.join("|")))}`;
}

function computeStateHash(
  state: Omit<StudioHybridDccDocumentState, "stateHash">,
  meshFingerprints: readonly string[],
): string {
  return stateHash([
    state.documentId,
    String(state.version),
    String(state.commandCount),
    String(Object.keys(state.geometry.records).length),
    ...meshFingerprints,
    ...Object.keys(state.objectTransforms)
      .sort()
      .map((id) => `${id}:${hashStudioHybridDccObjectTransform(state.objectTransforms[id]!)}`),
    ...state.dirtyNodeIds,
    ...state.rightsBom
      .map((record) => canonicalStudioCommandJson(record))
      .sort(),
    ...state.dependencies
      .map((dependency) => canonicalStudioCommandJson(dependency))
      .sort(),
    state.milestoneLabel ?? "",
  ]);
}

function forkStudioCommandJournal(journal: StudioCommandJournal): StudioCommandJournal {
  return restoreStudioCommandJournal(serializeStudioCommandJournal(journal));
}

function contentHashForMeshHash(meshHash: string): `sha256:${string}` {
  return `sha256:${sha256HexPortable(new TextEncoder().encode(meshHash))}`;
}

function meshFingerprints(geometry: StudioGeometryAuthorityRegistry): string[] {
  return Object.keys(geometry.records)
    .sort()
    .map((id) => {
      const record = geometry.records[id]!;
      return `${id}:${record.meshHash}:${hashStudioMeshModifierStack(record.modifierStack)}`;
    });
}

function finalizeState(
  partial: Omit<StudioHybridDccDocumentState, "stateHash">,
): StudioHybridDccDocumentState {
  const assetIds = Object.keys(partial.geometry.records).sort();
  const transformIds = Object.keys(partial.objectTransforms).sort();
  if (assetIds.length !== transformIds.length
    || assetIds.some((assetId, index) => assetId !== transformIds[index])) {
    throw new Error("object transform registry must match geometry authority assets exactly");
  }
  return {
    ...partial,
    stateHash: computeStateHash(partial, meshFingerprints(partial.geometry)),
  };
}

export function snapshotStudioHybridDccState(
  state: StudioHybridDccDocumentState,
): StudioHybridDccPersistedSnapshot {
  const assets = Object.values(state.geometry.records)
    .map((record) => ({
      assetId: record.assetId,
      meshHash: record.meshHash,
      revision: record.revision,
      mesh: serializeStudioEditableMesh(record.mesh),
      modifierStack: serializeStudioMeshModifierStack(record.modifierStack),
    }))
    .sort((a, b) => a.assetId.localeCompare(b.assetId));
  return {
    format: STUDIO_HYBRID_DCC_DOCUMENT_FORMAT,
    version: STUDIO_HYBRID_DCC_DOCUMENT_VERSION,
    documentId: state.documentId,
    commandCount: state.commandCount,
    stateHash: state.stateHash,
    milestoneLabel: state.milestoneLabel,
    dirtyNodeIds: [...state.dirtyNodeIds],
    rightsBom: [...state.rightsBom],
    dependencies: [...state.dependencies],
    objectTransforms: Object.fromEntries(
      Object.keys(state.objectTransforms)
        .sort()
        .map((assetId) => [
          assetId,
          normalizeStudioHybridDccObjectTransform(state.objectTransforms[assetId]),
        ]),
    ),
    assets,
  };
}

export function restoreStudioHybridDccStateFromSnapshot(
  snapshot: StudioHybridDccRestorableSnapshot,
): StudioHybridDccDocumentState {
  if (snapshot.format !== STUDIO_HYBRID_DCC_DOCUMENT_FORMAT
    || (snapshot.version !== STUDIO_HYBRID_DCC_DOCUMENT_VERSION
      && snapshot.version !== STUDIO_HYBRID_DCC_PREVIOUS_DOCUMENT_VERSION
      && snapshot.version !== STUDIO_HYBRID_DCC_LEGACY_DOCUMENT_VERSION)) {
    throw new Error("unsupported Hybrid DCC document snapshot");
  }
  let geometry = createStudioGeometryAuthorityRegistry();
  for (const asset of snapshot.assets) {
    const mesh = deserializeStudioEditableMesh(asset.mesh);
    let modifierStack = createStudioMeshModifierStack(mesh);
    if (snapshot.version === STUDIO_HYBRID_DCC_DOCUMENT_VERSION) {
      if (!("modifierStack" in asset)) {
        throw new Error(`invalid modifier stack for ${asset.assetId}: v3 field is missing`);
      }
      const decoded = deserializeStudioMeshModifierStack(asset.modifierStack, mesh);
      if (!decoded.ok) {
        throw new Error(`invalid modifier stack for ${asset.assetId}: ${decoded.detail}`);
      }
      modifierStack = decoded.value;
    }
    const registered = registerStudioGeometryAuthority(geometry, asset.assetId, mesh, {
      modifierStack,
      recordRevision: asset.revision,
    });
    if (!registered.ok) throw new Error(registered.detail);
    geometry = registered.value;
    const current = geometry.records[asset.assetId]!;
    if (!matchesStudioEditableMeshPersistedHash(mesh, asset.meshHash)) {
      // Exact SHA-256 is current authority. A genuine legacy v2 fingerprint is migration-only.
      throw new Error(
        `mesh hash mismatch for ${asset.assetId}: ${current.meshHash} vs ${asset.meshHash}`,
      );
    }
  }
  const storedTransforms = snapshot.version !== STUDIO_HYBRID_DCC_LEGACY_DOCUMENT_VERSION
    ? snapshot.objectTransforms
    : {};
  const objectTransforms = Object.fromEntries(
    Object.keys(geometry.records).sort().map((assetId) => [
      assetId,
      snapshot.version !== STUDIO_HYBRID_DCC_LEGACY_DOCUMENT_VERSION
        ? normalizeStudioHybridDccObjectTransform(storedTransforms[assetId])
        : createStudioHybridDccIdentityTransform(),
    ]),
  );
  if (snapshot.version !== STUDIO_HYBRID_DCC_LEGACY_DOCUMENT_VERSION
    && Object.keys(storedTransforms).some((assetId) => !Object.hasOwn(geometry.records, assetId))) {
    throw new Error("object transform registry contains an unknown asset");
  }
  return finalizeState({
    format: STUDIO_HYBRID_DCC_DOCUMENT_FORMAT,
    version: STUDIO_HYBRID_DCC_DOCUMENT_VERSION,
    documentId: snapshot.documentId,
    geometry,
    objectTransforms,
    rightsBom: snapshot.rightsBom.map((record) => {
      const restored = geometry.records[record.assetId];
      return restored
        ? { ...record, contentHash: contentHashForMeshHash(restored.meshHash) }
        : record;
    }),
    dependencies: [...snapshot.dependencies],
    dirtyNodeIds: [...snapshot.dirtyNodeIds],
    milestoneLabel: snapshot.milestoneLabel,
    commandCount: snapshot.commandCount,
  });
}

export function createStudioHybridDccSession(
  documentId = "hybrid-dcc-doc",
): StudioHybridDccSession {
  const state = finalizeState({
    format: STUDIO_HYBRID_DCC_DOCUMENT_FORMAT,
    version: STUDIO_HYBRID_DCC_DOCUMENT_VERSION,
    documentId,
    geometry: createStudioGeometryAuthorityRegistry(),
    objectTransforms: {},
    rightsBom: [],
    dependencies: [],
    dirtyNodeIds: [],
    milestoneLabel: null,
    commandCount: 0,
  });
  return {
    state,
    journal: createStudioCommandJournal(),
    undoStack: [],
    redoStack: [],
    lastGroupId: null,
    undoGroupStack: [],
    redoGroupStack: [],
    lamport: 0,
  };
}

function appendCommand(
  session: StudioHybridDccSession,
  kind: string,
  payload: StudioCommandJsonValue,
  inversePayload: StudioCommandJsonValue,
  nextPartial: Omit<
    StudioHybridDccDocumentState,
    "stateHash" | "commandCount" | "format" | "version" | "documentId"
  > &
    Partial<Pick<StudioHybridDccDocumentState, "documentId">>,
): StudioHybridDccSession {
  const priorSnapshot = snapshotStudioHybridDccState(session.state);
  // Lamport/ids never decrease (journal uniqueness survives undo of document commandCount).
  const lamport = session.lamport + 1;
  const commandCount = session.state.commandCount + 1;
  const groupId = `group:${lamport}`;
  const envelope = createStudioCommandEnvelope({
    id: `cmd:${lamport}`,
    actorId: "local",
    lamport,
    transactionId: null,
    groupId,
    command: { kind, payload },
    inverse: { kind: `${kind}.undo`, payload: inversePayload },
  });
  // Finalize and validate the candidate state before touching any journal. Sessions can be used as
  // immutable async branch roots, so every successful branch owns a forked journal as well.
  const state = finalizeState({
    format: STUDIO_HYBRID_DCC_DOCUMENT_FORMAT,
    version: STUDIO_HYBRID_DCC_DOCUMENT_VERSION,
    documentId: nextPartial.documentId ?? session.state.documentId,
    geometry: nextPartial.geometry,
    objectTransforms: nextPartial.objectTransforms,
    rightsBom: nextPartial.rightsBom,
    dependencies: nextPartial.dependencies,
    dirtyNodeIds: nextPartial.dirtyNodeIds,
    milestoneLabel: nextPartial.milestoneLabel,
    commandCount,
  });
  const journal = forkStudioCommandJournal(session.journal);
  journal.appendCommand(envelope);

  return {
    state,
    journal,
    undoStack: [...session.undoStack, priorSnapshot],
    redoStack: [],
    lastGroupId: groupId,
    undoGroupStack: [...session.undoGroupStack, groupId],
    redoGroupStack: [],
    lamport,
  };
}

export function hybridDccRegisterAsset(
  session: StudioHybridDccSession,
  assetId: string,
  mesh: StudioEditableMesh,
  rights: Omit<StudioRightsBomRecord, "assetId" | "contentHash">,
  initialTransform: StudioHybridDccObjectTransform = createStudioHybridDccIdentityTransform(),
): StudioHybridDccSession {
  const reg = registerStudioGeometryAuthority(session.state.geometry, assetId, mesh);
  if (!reg.ok) throw new Error(reg.detail);
  const meshHash = hashStudioEditableMesh(mesh);
  const rightsBom: StudioRightsBomRecord[] = [
    ...session.state.rightsBom.filter((r) => r.assetId !== assetId),
    {
      assetId,
      ...rights,
      contentHash: contentHashForMeshHash(meshHash),
    },
  ];
  const dependencies = [
    ...session.state.dependencies,
    { fromId: assetId, toId: `shot:*`, kind: "geometry" as const },
  ];
  const objectTransforms = {
    ...session.state.objectTransforms,
    [assetId]: normalizeStudioHybridDccObjectTransform(initialTransform),
  };
  return appendCommand(
    session,
    "geometry.register",
    { assetId, meshHash },
    { assetId },
    {
      geometry: reg.value,
      objectTransforms,
      rightsBom,
      dependencies,
      dirtyNodeIds: [...new Set([...session.state.dirtyNodeIds, assetId])],
      milestoneLabel: session.state.milestoneLabel,
    },
  );
}

/** Register a set/room atomically: all assets preflight before one command and one undo frame. */
export function hybridDccRegisterAssets(
  session: StudioHybridDccSession,
  assets: readonly {
    readonly assetId: string;
    readonly mesh: StudioEditableMesh;
    readonly rights: Omit<StudioRightsBomRecord, "assetId" | "contentHash">;
    readonly initialTransform: StudioHybridDccObjectTransform;
  }[],
): StudioHybridDccSession {
  if (assets.length === 0) return session;
  if (assets.length > 256) throw new Error("asset registration batch exceeds 256 objects");
  const newBatchIds = new Set(
    assets
      .map(({ assetId }) => assetId)
      .filter((assetId) => !Object.hasOwn(session.state.geometry.records, assetId)),
  );
  if (Object.keys(session.state.geometry.records).length + newBatchIds.size > 256) {
    throw new Error("document asset budget exceeds 256 objects");
  }

  const batchIds = new Set<string>();
  let geometry = session.state.geometry;
  const prepared = assets.map((asset) => {
    if (batchIds.has(asset.assetId)) throw new Error(`duplicate batch asset ${asset.assetId}`);
    if (Object.hasOwn(session.state.geometry.records, asset.assetId)) {
      throw new Error(`asset ${asset.assetId} exists`);
    }
    batchIds.add(asset.assetId);
    const rights = {
      source: asset.rights.source,
      creator: asset.rights.creator,
      license: asset.rights.license,
      useScope: asset.rights.useScope,
      derivative: asset.rights.derivative,
    };
    for (const [field, value] of Object.entries(rights)) {
      if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
        throw new Error(`asset ${asset.assetId} rights.${field} is invalid`);
      }
    }
    const transform = normalizeStudioHybridDccObjectTransform(asset.initialTransform);
    const registered = registerStudioGeometryAuthority(geometry, asset.assetId, asset.mesh);
    if (!registered.ok) throw new Error(registered.detail);
    geometry = registered.value;
    const meshHash = hashStudioEditableMesh(asset.mesh);
    return { ...asset, rights, transform, meshHash };
  });

  const objectTransforms = { ...session.state.objectTransforms };
  const rightsBom: StudioRightsBomRecord[] = [...session.state.rightsBom];
  const dependencies: StudioHybridDccDependencyEdge[] = [...session.state.dependencies];
  for (const asset of prepared) {
    objectTransforms[asset.assetId] = asset.transform;
    rightsBom.push({
      assetId: asset.assetId,
      ...asset.rights,
      contentHash: contentHashForMeshHash(asset.meshHash),
    });
    dependencies.push({ fromId: asset.assetId, toId: "shot:*", kind: "geometry" });
  }

  const forwardPayload = JSON.parse(JSON.stringify({
    assets: prepared.map(({ assetId, meshHash }) => ({ assetId, meshHash })),
  })) as StudioCommandJsonValue;
  const inversePayload = {
    assetIds: prepared.map(({ assetId }) => assetId),
  } as StudioCommandJsonValue;
  return appendCommand(
    session,
    "geometry.register-batch",
    forwardPayload,
    inversePayload,
    {
      geometry,
      objectTransforms,
      rightsBom,
      dependencies,
      dirtyNodeIds: [...new Set([
        ...session.state.dirtyNodeIds,
        ...prepared.map(({ assetId }) => assetId),
      ])],
      milestoneLabel: session.state.milestoneLabel,
    },
  );
}

/** Duplicates one authority object as a single undoable document command. */
export function hybridDccDuplicateAsset(
  session: StudioHybridDccSession,
  sourceAssetId: string,
  duplicateAssetId: string,
  positionOffset: readonly [number, number, number] = [1, 0, 0],
): StudioHybridDccSession {
  const source = session.state.geometry.records[sourceAssetId];
  if (!source) throw new Error(`asset ${sourceAssetId} not found`);
  if (Object.hasOwn(session.state.geometry.records, duplicateAssetId)) {
    throw new Error(`asset ${duplicateAssetId} exists`);
  }
  if (positionOffset.length !== 3 || positionOffset.some((value) => !Number.isFinite(value))) {
    throw new Error("duplicate position offset must contain three finite values");
  }
  const registered = registerStudioGeometryAuthority(
    session.state.geometry,
    duplicateAssetId,
    source.mesh,
    { modifierStack: source.modifierStack },
  );
  if (!registered.ok) throw new Error(registered.detail);
  const sourceTransform = session.state.objectTransforms[sourceAssetId];
  if (!sourceTransform) throw new Error(`object transform ${sourceAssetId} not found`);
  const transform = normalizeStudioHybridDccObjectTransform({
    ...sourceTransform,
    position: [
      sourceTransform.position[0] + positionOffset[0],
      sourceTransform.position[1] + positionOffset[1],
      sourceTransform.position[2] + positionOffset[2],
    ],
  });
  const sourceRights = session.state.rightsBom.find((entry) => entry.assetId === sourceAssetId);
  const rightsBom: StudioRightsBomRecord[] = [
    ...session.state.rightsBom,
    {
      assetId: duplicateAssetId,
      source: sourceRights?.source ?? `duplicate:${sourceAssetId}`,
      creator: sourceRights?.creator ?? "studio",
      license: sourceRights?.license ?? "CC0-1.0",
      useScope: sourceRights?.useScope ?? "commercial",
      derivative: `duplicate-of:${sourceAssetId}`,
      contentHash: `sha256:${sha256HexPortable(new TextEncoder().encode(source.meshHash))}`,
    },
  ];
  const dependencies = [
    ...session.state.dependencies,
    { fromId: duplicateAssetId, toId: "shot:*", kind: "geometry" as const },
  ];
  return appendCommand(
    session,
    "geometry.duplicate",
    { sourceAssetId, duplicateAssetId, meshHash: source.meshHash },
    { assetId: duplicateAssetId },
    {
      geometry: registered.value,
      objectTransforms: {
        ...session.state.objectTransforms,
        [duplicateAssetId]: transform,
      },
      rightsBom,
      dependencies,
      dirtyNodeIds: [...new Set([
        ...session.state.dirtyNodeIds,
        duplicateAssetId,
        "shot:*",
      ])],
      milestoneLabel: session.state.milestoneLabel,
    },
  );
}

/** Removes an authority object as a reversible command; undo restores its full snapshot. */
export function hybridDccRemoveAsset(
  session: StudioHybridDccSession,
  assetId: string,
): StudioHybridDccSession {
  const record = session.state.geometry.records[assetId];
  if (!record) throw new Error(`asset ${assetId} not found`);
  const transform = session.state.objectTransforms[assetId];
  if (!transform) throw new Error(`object transform ${assetId} not found`);
  const records = Object.fromEntries(
    Object.entries(session.state.geometry.records).filter(([id]) => id !== assetId),
  );
  const objectTransforms = Object.fromEntries(
    Object.entries(session.state.objectTransforms).filter(([id]) => id !== assetId),
  );
  const dependents = session.state.dependencies
    .filter((dependency) => dependency.fromId === assetId)
    .map((dependency) => dependency.toId);
  const inversePayload = JSON.parse(JSON.stringify({
    assetId,
    meshHash: record.meshHash,
    mesh: serializeStudioEditableMesh(record.mesh),
    modifierStack: serializeStudioMeshModifierStack(record.modifierStack),
    transform,
    rights: session.state.rightsBom.find((entry) => entry.assetId === assetId) ?? null,
  })) as StudioCommandJsonValue;
  return appendCommand(
    session,
    "geometry.remove",
    { assetId, meshHash: record.meshHash },
    inversePayload,
    {
      geometry: { ...session.state.geometry, records },
      objectTransforms,
      rightsBom: session.state.rightsBom.filter((entry) => entry.assetId !== assetId),
      dependencies: session.state.dependencies.filter((dependency) => (
        dependency.fromId !== assetId && dependency.toId !== assetId
      )),
      dirtyNodeIds: [...new Set([
        ...session.state.dirtyNodeIds,
        assetId,
        ...dependents,
      ])],
      milestoneLabel: session.state.milestoneLabel,
    },
  );
}

function hybridDccCommitGeometryCommand(
  session: StudioHybridDccSession,
  assetId: string,
  mesh: StudioEditableMesh,
  command: {
    readonly kind: "geometry.commit" | "geometry.extrude-region";
    readonly receipt?: unknown;
  },
): StudioHybridDccSession {
  const prev = session.state.geometry.records[assetId];
  if (!prev) throw new Error(`asset ${assetId} not found`);
  const prevSnapshot = serializeStudioEditableMesh(prev.mesh);
  const reg = commitStudioGeometryAuthorityMesh(session.state.geometry, assetId, mesh);
  if (!reg.ok) throw new Error(reg.detail);
  const dependents = session.state.dependencies
    .filter((d) => d.fromId === assetId)
    .map((d) => d.toId);
  const dirtyNodeIds = [...new Set([...session.state.dirtyNodeIds, assetId, ...dependents])];
  const committedMeshHash = reg.value.records[assetId]!.meshHash;
  const rightsBom = session.state.rightsBom.map((record) => record.assetId === assetId
    ? { ...record, contentHash: contentHashForMeshHash(committedMeshHash) }
    : record);
  // Journal payloads must be plain JSON; mesh snapshots are stored as nested plain objects.
  const forwardPayload = JSON.parse(
    JSON.stringify({
      assetId,
      meshHash: hashStudioEditableMesh(mesh),
      mesh: serializeStudioEditableMesh(mesh),
      ...(command.receipt === undefined ? {} : { receipt: command.receipt }),
    }),
  ) as StudioCommandJsonValue;
  const inversePayload = JSON.parse(
    JSON.stringify({
      assetId,
      meshHash: prev.meshHash,
      mesh: prevSnapshot,
    }),
  ) as StudioCommandJsonValue;
  return appendCommand(
    session,
    command.kind,
    forwardPayload,
    inversePayload,
    {
      geometry: reg.value,
      objectTransforms: session.state.objectTransforms,
      rightsBom,
      dependencies: session.state.dependencies,
      dirtyNodeIds,
      milestoneLabel: session.state.milestoneLabel,
    },
  );
}

export function hybridDccCommitGeometry(
  session: StudioHybridDccSession,
  assetId: string,
  mesh: StudioEditableMesh,
): StudioHybridDccSession {
  return hybridDccCommitGeometryCommand(session, assetId, mesh, {
    kind: "geometry.commit",
  });
}

function isStudioTopologyId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isCanonicalStudioTopologyIdList(
  value: readonly number[],
  maximum: number,
  allowEmpty = true,
): boolean {
  if (!Array.isArray(value) || value.length > maximum || (!allowEmpty && value.length === 0)) {
    return false;
  }
  let previous = -1;
  for (const id of value) {
    if (!isStudioTopologyId(id) || id <= previous) return false;
    previous = id;
  }
  return true;
}

function equalStudioTopologyIdLists(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * Verifies the complete topology classification carried by a Region Extrude receipt.
 *
 * Hashes bind the source and result snapshots; this structural audit additionally prevents a
 * caller from journaling forged cap, boundary, side, region-count, or remap evidence for those
 * otherwise-valid snapshots.
 */
function assertStudioExtrudeRegionReceipt(
  source: StudioEditableMesh,
  result: StudioEditableMesh,
  receipt: StudioEditableMeshExtrudeRegionReceipt,
): void {
  if (!isCanonicalStudioTopologyIdList(
    receipt.sourceFaceIds,
    STUDIO_EDITABLE_MESH_LIMITS.maxSelection,
    false,
  ) || !isCanonicalStudioTopologyIdList(
    receipt.capFaceIds,
    STUDIO_EDITABLE_MESH_LIMITS.maxSelection,
    false,
  ) || receipt.sourceFaceIds.length !== receipt.capFaceIds.length) {
    throw new Error("topology mutation receipt has an invalid source-to-cap mapping");
  }
  if (!isCanonicalStudioTopologyIdList(
    receipt.sideFaceIds,
    STUDIO_EDITABLE_MESH_LIMITS.maxFaces,
  ) || !isCanonicalStudioTopologyIdList(
    receipt.boundaryHalfEdgeIds,
    STUDIO_EDITABLE_MESH_LIMITS.maxEdges,
  ) || receipt.sideFaceIds.length !== receipt.boundaryHalfEdgeIds.length) {
    throw new Error("topology mutation receipt has an invalid boundary-to-side mapping");
  }
  if (!Number.isSafeInteger(receipt.connectedRegionCount)
    || receipt.connectedRegionCount < 1
    || receipt.connectedRegionCount > receipt.sourceFaceIds.length) {
    throw new Error("topology mutation receipt has an invalid connected-region count");
  }

  const sourceFaceIds = [...source.faces].map(({ id }) => id).sort((a, b) => a - b);
  const sourceFaceSet = new Set(sourceFaceIds);
  const resultFaceIds = [...result.faces].map(({ id }) => id).sort((a, b) => a - b);
  const resultFaceSet = new Set(resultFaceIds);
  const selectedFaceSet = new Set(receipt.sourceFaceIds);
  if (receipt.sourceFaceIds.some((id) => !sourceFaceSet.has(id))
    || receipt.capFaceIds.some((id) => !resultFaceSet.has(id))
    || receipt.sideFaceIds.some((id) => !resultFaceSet.has(id))) {
    throw new Error("topology mutation receipt references a non-live face");
  }
  if (result.faces.length !== source.faces.length + receipt.sideFaceIds.length) {
    throw new Error("topology mutation receipt does not account for the result face count");
  }

  const fullEntries = receipt.faceRemap.entries;
  if (!Array.isArray(fullEntries)
    || fullEntries.length !== sourceFaceIds.length
    || fullEntries.length > STUDIO_EDITABLE_MESH_LIMITS.maxFaces) {
    throw new Error("topology mutation receipt does not cover every source face");
  }
  const fullTargets = new Set<number>();
  const fullFaceRemap = new Map<number, number>();
  for (let index = 0; index < fullEntries.length; index += 1) {
    const entry = fullEntries[index];
    const expectedSourceId = sourceFaceIds[index];
    if (!Array.isArray(entry)
      || entry.length !== 2
      || entry[0] !== expectedSourceId
      || !isStudioTopologyId(entry[1])
      || !resultFaceSet.has(entry[1])
      || fullTargets.has(entry[1])) {
      throw new Error("topology mutation receipt has a malformed full face remap");
    }
    fullTargets.add(entry[1]);
    fullFaceRemap.set(entry[0], entry[1]);
  }

  const selectedEntries = receipt.selectionRemap.face?.entries;
  if (receipt.selectionRemap.vertex !== undefined
    || receipt.selectionRemap.edge !== undefined
    || !Array.isArray(selectedEntries)
    || selectedEntries.length !== receipt.sourceFaceIds.length) {
    throw new Error("topology mutation receipt has a malformed selection remap");
  }
  for (let index = 0; index < selectedEntries.length; index += 1) {
    const entry = selectedEntries[index];
    const sourceFaceId = receipt.sourceFaceIds[index];
    const capFaceId = receipt.capFaceIds[index];
    if (!Array.isArray(entry)
      || entry.length !== 2
      || entry[0] !== sourceFaceId
      || entry[1] !== capFaceId
      || fullFaceRemap.get(sourceFaceId) !== capFaceId) {
      throw new Error("topology mutation receipt does not map selected faces to their caps");
    }
  }

  const sideFaceSet = new Set(receipt.sideFaceIds);
  if (receipt.capFaceIds.some((id) => sideFaceSet.has(id))) {
    throw new Error("topology mutation receipt aliases cap and side faces");
  }
  const classifiedResultIds = [...fullTargets, ...sideFaceSet].sort((a, b) => a - b);
  if (!equalStudioTopologyIdLists(classifiedResultIds, resultFaceIds)) {
    throw new Error("topology mutation receipt does not classify every result face");
  }

  const sourceHalfEdgeById = new Map(source.halfEdges.map((edge) => [edge.id, edge] as const));
  const computedBoundaryIds = source.halfEdges
    .filter((edge) => {
      if (!selectedFaceSet.has(edge.face)) return false;
      if (edge.twin < 0) return true;
      const twin = sourceHalfEdgeById.get(edge.twin);
      return twin === undefined || !selectedFaceSet.has(twin.face);
    })
    .map(({ id }) => id)
    .sort((a, b) => a - b);
  if (!equalStudioTopologyIdLists(computedBoundaryIds, receipt.boundaryHalfEdgeIds)) {
    throw new Error("topology mutation receipt does not identify the exact region boundary");
  }

  const selectedAdjacency = new Map<number, Set<number>>(
    receipt.sourceFaceIds.map((faceId) => [faceId, new Set<number>()]),
  );
  for (const edge of source.halfEdges) {
    if (!selectedFaceSet.has(edge.face) || edge.twin < 0) continue;
    const twinFaceId = sourceHalfEdgeById.get(edge.twin)?.face;
    if (twinFaceId !== undefined && selectedFaceSet.has(twinFaceId)) {
      selectedAdjacency.get(edge.face)?.add(twinFaceId);
    }
  }
  const pending = new Set(receipt.sourceFaceIds);
  let connectedRegionCount = 0;
  for (const seed of receipt.sourceFaceIds) {
    if (!pending.delete(seed)) continue;
    connectedRegionCount += 1;
    const stack = [seed];
    while (stack.length > 0) {
      const faceId = stack.pop()!;
      for (const adjacentFaceId of selectedAdjacency.get(faceId) ?? []) {
        if (pending.delete(adjacentFaceId)) stack.push(adjacentFaceId);
      }
    }
  }
  if (connectedRegionCount !== receipt.connectedRegionCount) {
    throw new Error("topology mutation receipt has an incorrect connected-region count");
  }
}

/**
 * Commits one topology mutation as a distinct, undoable document command.
 *
 * The receipt is command evidence only. Geometry authority remains the immutable editable-mesh
 * snapshot, so OPFS recovery and undo/redo do not depend on replaying procedural topology code.
 */
export function hybridDccCommitTopologyMutation(
  session: StudioHybridDccSession,
  assetId: string,
  mesh: StudioEditableMesh,
  input: {
    readonly kind: "geometry.extrude-region";
    readonly receipt: StudioEditableMeshExtrudeRegionReceipt;
  },
): StudioHybridDccSession {
  if (input.kind !== "geometry.extrude-region"
    || input.receipt.operation !== "extrude-region") {
    throw new Error("unsupported topology mutation receipt");
  }
  const previous = session.state.geometry.records[assetId];
  if (!previous) throw new Error(`asset ${assetId} not found`);
  if (input.receipt.sourceMeshHash !== previous.meshHash) {
    throw new Error("topology mutation receipt does not match the source mesh");
  }
  const resultMeshHash = hashStudioEditableMesh(mesh);
  if (input.receipt.resultMeshHash !== resultMeshHash) {
    throw new Error("topology mutation receipt does not match the result mesh");
  }
  if (!isIssuedStudioEditableMeshExtrudeRegionReceipt(input.receipt)) {
    throw new Error("topology mutation receipt was not issued by the geometry kernel");
  }
  assertStudioExtrudeRegionReceipt(previous.mesh, mesh, input.receipt);
  return hybridDccCommitGeometryCommand(session, assetId, mesh, input);
}

/** Replace one asset's non-destructive stack as one undoable canonical command. */
export function hybridDccSetModifierStack(
  session: StudioHybridDccSession,
  assetId: string,
  nextValue: StudioMeshModifierStack | readonly StudioMeshModifier[],
): StudioHybridDccSession {
  const previousRecord = session.state.geometry.records[assetId];
  if (!previousRecord) throw new Error(`asset ${assetId} not found`);
  const requested = Array.isArray(nextValue)
    ? createStudioMeshModifierStack(
        previousRecord.mesh,
        nextValue as readonly StudioMeshModifier[],
      )
    : nextValue as StudioMeshModifierStack;
  const previousHash = hashStudioMeshModifierStack(previousRecord.modifierStack);
  const nextHash = hashStudioMeshModifierStack(requested);
  if (previousHash === nextHash) return session;
  const updated = setStudioGeometryAuthorityModifierStack(
    session.state.geometry,
    assetId,
    requested,
  );
  if (!updated.ok) throw new Error(updated.detail);
  const stored = updated.value.records[assetId]!.modifierStack;
  const dependents = session.state.dependencies
    .filter((dependency) => dependency.fromId === assetId)
    .map((dependency) => dependency.toId);
  const payload = JSON.parse(JSON.stringify({
    assetId,
    stackHash: hashStudioMeshModifierStack(stored),
    modifierStack: serializeStudioMeshModifierStack(stored),
  })) as StudioCommandJsonValue;
  const inversePayload = JSON.parse(JSON.stringify({
    assetId,
    stackHash: previousHash,
    modifierStack: serializeStudioMeshModifierStack(previousRecord.modifierStack),
  })) as StudioCommandJsonValue;
  return appendCommand(
    session,
    "geometry.modifier-stack.set",
    payload,
    inversePayload,
    {
      geometry: updated.value,
      objectTransforms: session.state.objectTransforms,
      rightsBom: session.state.rightsBom,
      dependencies: session.state.dependencies,
      dirtyNodeIds: [...new Set([
        ...session.state.dirtyNodeIds,
        assetId,
        ...dependents,
      ])],
      milestoneLabel: session.state.milestoneLabel,
    },
  );
}

/**
 * Apply an evaluated result and clear its stack in one command. Undo restores both source and stack;
 * callers evaluate outside this boundary so async backends never leave a half-committed document.
 */
export function hybridDccApplyModifierStack(
  session: StudioHybridDccSession,
  assetId: string,
  evaluation: StudioHybridDccModifierStackEvaluationReceipt,
): StudioHybridDccSession {
  const previousRecord = session.state.geometry.records[assetId];
  if (!previousRecord) throw new Error(`asset ${assetId} not found`);
  const previousSourceHash = hashStudioEditableMesh(previousRecord.mesh);
  const previousStackHash = hashStudioMeshModifierStack(previousRecord.modifierStack);
  if (evaluation.sourceHash !== previousSourceHash) {
    throw new Error("stale modifier evaluation: sourceHash no longer matches authority");
  }
  if (evaluation.stackHash !== previousStackHash) {
    throw new Error("stale modifier evaluation: stackHash no longer matches authority");
  }
  const evaluatedResultHash = hashStudioEditableMesh(evaluation.mesh);
  if (evaluation.resultHash !== evaluatedResultHash) {
    throw new Error("invalid modifier evaluation: resultHash does not identify the supplied mesh");
  }

  const expectedBooleans = previousRecord.modifierStack.modifiers.filter((modifier) => (
    modifier.enabled && modifier.kind === "boolean" && modifier.operandAssetId !== undefined
  ));
  const operandReceipts = evaluation.booleanOperands ?? [];
  if (operandReceipts.length !== expectedBooleans.length) {
    throw new Error("modifier evaluation Boolean provenance is incomplete");
  }
  const seenModifierIds = new Set<string>();
  const directProvenance: StudioRightsBomProvenanceRecord[] = [];
  const inheritedProvenance: StudioRightsBomProvenanceRecord[] = [];
  for (const modifier of expectedBooleans) {
    if (modifier.kind !== "boolean" || !modifier.operandAssetId) continue;
    const receipt = operandReceipts.find(({ modifierId }) => modifierId === modifier.id);
    if (!receipt || seenModifierIds.has(receipt.modifierId)) {
      throw new Error(`modifier evaluation Boolean provenance is invalid for ${modifier.id}`);
    }
    seenModifierIds.add(receipt.modifierId);
    if (receipt.operation !== modifier.operation
      || receipt.operandAssetId !== modifier.operandAssetId) {
      throw new Error(`modifier evaluation Boolean provenance is stale for ${modifier.id}`);
    }
    const cutterRecord = session.state.geometry.records[receipt.operandAssetId];
    const cutterRights = session.state.rightsBom.find(
      (record) => record.assetId === receipt.operandAssetId,
    );
    const cutterTransform = session.state.objectTransforms[receipt.operandAssetId];
    if (!cutterRecord || !cutterRights || !cutterTransform) {
      throw new Error(`Boolean operand ${receipt.operandAssetId} is no longer available`);
    }
    if (receipt.sourceMeshHash !== cutterRecord.meshHash
      || receipt.modifierStackHash !== hashStudioMeshModifierStack(cutterRecord.modifierStack)
      || receipt.objectTransformHash !== hashStudioHybridDccObjectTransform(cutterTransform)) {
      throw new Error(`modifier evaluation Boolean operand is stale for ${modifier.id}`);
    }
    if (!/^(?:mesh:[0-9a-f]{8}|mesh:sha256:[0-9a-f]{64})$/u.test(receipt.evaluatedMeshHash)
      || !/^sha256:[0-9a-f]{64}$/u.test(receipt.resolvedOperandHash)) {
      throw new Error(`modifier evaluation Boolean hashes are invalid for ${modifier.id}`);
    }
    inheritedProvenance.push(...(cutterRights.provenance ?? []));
    directProvenance.push({
      role: "boolean-operand",
      assetId: receipt.operandAssetId,
      modifierId: receipt.modifierId,
      operation: receipt.operation,
      source: cutterRights.source,
      creator: cutterRights.creator,
      license: cutterRights.license,
      useScope: cutterRights.useScope,
      derivative: cutterRights.derivative,
      ...(cutterRights.contentHash ? { contentHash: cutterRights.contentHash } : {}),
      sourceMeshHash: receipt.sourceMeshHash,
      modifierStackHash: receipt.modifierStackHash,
      evaluatedMeshHash: receipt.evaluatedMeshHash,
      objectTransformHash: receipt.objectTransformHash,
      resolvedOperandHash: receipt.resolvedOperandHash,
    });
  }
  if (seenModifierIds.size !== operandReceipts.length) {
    throw new Error("modifier evaluation contains unexpected Boolean provenance");
  }

  const updated = applyStudioGeometryAuthorityModifierStack(
    session.state.geometry,
    assetId,
    evaluation.mesh,
  );
  if (!updated.ok) throw new Error(updated.detail);
  const appliedRecord = updated.value.records[assetId]!;
  const dependents = session.state.dependencies
    .filter((dependency) => dependency.fromId === assetId)
    .map((dependency) => dependency.toId);
  const previousRights = session.state.rightsBom.find((record) => record.assetId === assetId);
  if (!previousRights) throw new Error(`rights BOM record ${assetId} not found`);
  const provenanceByFingerprint = new Map<string, StudioRightsBomProvenanceRecord>();
  for (const provenance of [
    ...(previousRights.provenance ?? []),
    ...inheritedProvenance,
    ...directProvenance,
  ]) {
    provenanceByFingerprint.set(canonicalStudioCommandJson(provenance), provenance);
  }
  const provenance = [...provenanceByFingerprint.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, record]) => record);
  const rightsBom = session.state.rightsBom.map((record) => record.assetId === assetId
    ? {
        ...record,
        contentHash: contentHashForMeshHash(appliedRecord.meshHash),
        ...(provenance.length > 0 ? { provenance } : {}),
      }
    : record);
  const dependencyByFingerprint = new Map<string, StudioHybridDccDependencyEdge>();
  for (const dependency of [
    ...session.state.dependencies,
    ...directProvenance.map((record) => ({
      fromId: record.assetId,
      toId: assetId,
      kind: "geometry" as const,
    })),
  ]) {
    dependencyByFingerprint.set(canonicalStudioCommandJson(dependency), dependency);
  }
  const dependencies = [...dependencyByFingerprint.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, dependency]) => dependency);
  const payload = JSON.parse(JSON.stringify({
    assetId,
    sourceMeshHash: previousSourceHash,
    appliedStackHash: previousStackHash,
    meshHash: appliedRecord.meshHash,
    mesh: serializeStudioEditableMesh(evaluation.mesh),
    modifierStack: serializeStudioMeshModifierStack(appliedRecord.modifierStack),
    booleanOperands: directProvenance,
  })) as StudioCommandJsonValue;
  const inversePayload = JSON.parse(JSON.stringify({
    assetId,
    meshHash: previousRecord.meshHash,
    mesh: serializeStudioEditableMesh(previousRecord.mesh),
    modifierStack: serializeStudioMeshModifierStack(previousRecord.modifierStack),
    rights: previousRights,
  })) as StudioCommandJsonValue;
  return appendCommand(
    session,
    "geometry.modifier-stack.apply",
    payload,
    inversePayload,
    {
      geometry: updated.value,
      objectTransforms: session.state.objectTransforms,
      rightsBom,
      dependencies,
      dirtyNodeIds: [...new Set([
        ...session.state.dirtyNodeIds,
        assetId,
        ...dependents,
      ])],
      milestoneLabel: session.state.milestoneLabel,
    },
  );
}

/**
 * Commits one canonical object transform as a single undoable command. Geometry stays object-local;
 * renderer previews may move freely, but only pointer-up/numeric apply should call this boundary.
 */
export function hybridDccCommitObjectTransform(
  session: StudioHybridDccSession,
  assetId: string,
  nextValue: StudioHybridDccObjectTransform,
): StudioHybridDccSession {
  if (!Object.hasOwn(session.state.geometry.records, assetId)) {
    throw new Error(`asset ${assetId} not found`);
  }
  const previous = session.state.objectTransforms[assetId];
  if (!previous) throw new Error(`object transform ${assetId} not found`);
  const next = normalizeStudioHybridDccObjectTransform(nextValue);
  if (hashStudioHybridDccObjectTransform(previous) === hashStudioHybridDccObjectTransform(next)) {
    return session;
  }
  const dependents = session.state.dependencies
    .filter((dependency) => dependency.fromId === assetId)
    .map((dependency) => dependency.toId);
  const dirtyNodeIds = [...new Set([
    ...session.state.dirtyNodeIds,
    assetId,
    ...dependents,
  ])];
  const payload = JSON.parse(JSON.stringify({ assetId, transform: next })) as StudioCommandJsonValue;
  const inversePayload = JSON.parse(
    JSON.stringify({ assetId, transform: previous }),
  ) as StudioCommandJsonValue;
  return appendCommand(
    session,
    "object.transform",
    payload,
    inversePayload,
    {
      geometry: session.state.geometry,
      objectTransforms: { ...session.state.objectTransforms, [assetId]: next },
      rightsBom: session.state.rightsBom,
      dependencies: session.state.dependencies,
      dirtyNodeIds,
      milestoneLabel: session.state.milestoneLabel,
    },
  );
}

export function hybridDccClearDirty(
  session: StudioHybridDccSession,
  nodeIds: readonly string[],
): StudioHybridDccSession {
  const drop = new Set(nodeIds);
  const dirtyNodeIds = session.state.dirtyNodeIds.filter((id) => !drop.has(id));
  return appendCommand(
    session,
    "dirty.clear",
    { nodeIds: [...nodeIds] },
    { nodeIds: [...session.state.dirtyNodeIds] },
    {
      geometry: session.state.geometry,
      objectTransforms: session.state.objectTransforms,
      rightsBom: session.state.rightsBom,
      dependencies: session.state.dependencies,
      dirtyNodeIds,
      milestoneLabel: session.state.milestoneLabel,
    },
  );
}

export function hybridDccAutosaveCheckpoint(
  session: StudioHybridDccSession,
  label = "autosave",
): StudioHybridDccSession {
  return appendCommand(
    session,
    "milestone",
    { label },
    { label: session.state.milestoneLabel },
    {
      geometry: session.state.geometry,
      objectTransforms: session.state.objectTransforms,
      rightsBom: session.state.rightsBom,
      dependencies: session.state.dependencies,
      dirtyNodeIds: session.state.dirtyNodeIds,
      milestoneLabel: label,
    },
  );
}

/** Undo last command — restores prior geometry/document state (DOC-002). */
export function hybridDccUndo(session: StudioHybridDccSession): StudioHybridDccSession {
  if (session.undoStack.length === 0) {
    throw new Error("UNDO_EMPTY");
  }
  const prior = session.undoStack[session.undoStack.length - 1]!;
  const currentSnap = snapshotStudioHybridDccState(session.state);
  const groupId = session.undoGroupStack[session.undoGroupStack.length - 1];
  const lamport = session.lamport + 1;
  const journal = forkStudioCommandJournal(session.journal);
  if (groupId) {
    journal.undo({
      id: `undo:${lamport}`,
      actorId: "local",
      lamport,
      groupId,
    });
  }
  const state = restoreStudioHybridDccStateFromSnapshot(prior);
  return {
    state,
    journal,
    undoStack: session.undoStack.slice(0, -1),
    redoStack: [...session.redoStack, currentSnap],
    lastGroupId: session.undoGroupStack[session.undoGroupStack.length - 2] ?? null,
    undoGroupStack: session.undoGroupStack.slice(0, -1),
    redoGroupStack: groupId
      ? [...session.redoGroupStack, groupId]
      : session.redoGroupStack,
    lamport,
  };
}

/** Redo last undone command — reapplies geometry/document state. */
export function hybridDccRedo(session: StudioHybridDccSession): StudioHybridDccSession {
  if (session.redoStack.length === 0) {
    throw new Error("REDO_EMPTY");
  }
  const next = session.redoStack[session.redoStack.length - 1]!;
  const currentSnap = snapshotStudioHybridDccState(session.state);
  const groupId = session.redoGroupStack[session.redoGroupStack.length - 1];
  const lamport = session.lamport + 1;
  const journal = forkStudioCommandJournal(session.journal);
  if (groupId) {
    journal.redo({
      id: `redo:${lamport}`,
      actorId: "local",
      lamport,
      groupId,
    });
  }
  const state = restoreStudioHybridDccStateFromSnapshot(next);
  return {
    state,
    journal,
    undoStack: [...session.undoStack, currentSnap],
    redoStack: session.redoStack.slice(0, -1),
    lastGroupId: groupId ?? session.lastGroupId,
    undoGroupStack: groupId
      ? [...session.undoGroupStack, groupId]
      : session.undoGroupStack,
    redoGroupStack: session.redoGroupStack.slice(0, -1),
    lamport,
  };
}

export function hybridDccCanUndo(session: StudioHybridDccSession): boolean {
  return session.undoStack.length > 0;
}

export function hybridDccCanRedo(session: StudioHybridDccSession): boolean {
  return session.redoStack.length > 0;
}

/**
 * DOC-007 selective undo — only rewinds commands owned by actorId.
 * Local hybrid session uses actor "local"; multi-actor journal groups are filtered by prefix.
 */
export function hybridDccSelectiveUndo(
  session: StudioHybridDccSession,
  actorId: string,
): StudioHybridDccSession {
  if (actorId !== "local") {
    throw new Error(
      `SELECTIVE_UNDO_FOREIGN: cannot undo actor ${actorId} from local session`,
    );
  }
  if (!hybridDccCanUndo(session)) {
    throw new Error("UNDO_EMPTY");
  }
  return hybridDccUndo(session);
}

function encodeSnapshot(snapshot: StudioHybridDccPersistedSnapshot): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(snapshot));
}

function decodeSnapshot(
  bytes: Uint8Array,
): StudioHybridDccRestorableSnapshot {
  return JSON.parse(new TextDecoder().decode(bytes)) as StudioHybridDccRestorableSnapshot;
}

async function readEntryPayload(
  adapter: StudioOpfsRecoveryJournalAdapter,
  entry: {
    readonly chunks: readonly { readonly path: string; readonly byteLength: number }[];
  },
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (const ref of entry.chunks) {
    const part = await adapter.read(ref.path);
    if (!part) throw new Error(`missing OPFS chunk ${ref.path}`);
    chunks.push(part);
    total += part.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export interface StudioHybridDccOpfsPorts {
  readonly adapter: StudioOpfsRecoveryJournalAdapter;
  readonly journal: StudioOpfsRecoveryJournal;
}

/** Build real OPFS recovery journal ports (inject FakeOpfsAdapter in tests). */
export function createStudioHybridDccOpfsPorts(input: {
  readonly adapter: StudioOpfsRecoveryJournalAdapter;
  readonly documentId: string;
  readonly now?: () => number;
  readonly randomToken?: () => string;
}): StudioHybridDccOpfsPorts {
  const journal = createStudioOpfsRecoveryJournal({
    adapter: input.adapter,
    identity: {
      documentId: input.documentId,
      documentVersion: STUDIO_HYBRID_DCC_DOCUMENT_VERSION,
      engineVersion: STUDIO_HYBRID_DCC_ENGINE_VERSION,
    },
    now: input.now,
    randomToken: input.randomToken,
  });
  return { adapter: input.adapter, journal };
}

/**
 * Persist full document snapshot as OPFS checkpoint (DOC-004).
 * Payload is the complete geometry/document state — recovery reloads it.
 */
export async function hybridDccWriteOpfsCheckpoint(
  session: StudioHybridDccSession,
  ports: StudioHybridDccOpfsPorts,
  options: { readonly ownerId?: string; readonly pageId?: string } = {},
): Promise<{
  readonly sequence: number;
  readonly stateHash: string;
  readonly writer: StudioOpfsRecoveryWriterLease;
}> {
  const snapshot = snapshotStudioHybridDccState(session.state);
  const payload = encodeSnapshot(snapshot);
  const writer = await ports.journal.acquireWriter({
    ownerId: options.ownerId ?? "hybrid-dcc-writer",
  });
  try {
    const scan = await ports.journal.scan();
    const entry = await ports.journal.appendCheckpoint(writer, {
      id: `checkpoint-${session.state.commandCount}-${Date.now()}`,
      pageId: options.pageId ?? "hybrid-main",
      revision: session.state.commandCount,
      payload,
      compactThroughSequence: scan.lastSequence,
    });
    return {
      sequence: entry.sequence,
      stateHash: snapshot.stateHash,
      writer,
    };
  } finally {
    await ports.journal.releaseWriter(writer);
  }
}

/**
 * Simulate forced stop + recovery from OPFS journal (DOC-004).
 * Restores last committed checkpoint state with structural equality (mesh hashes).
 */
export async function hybridDccRecoverFromOpfs(
  ports: StudioHybridDccOpfsPorts,
): Promise<{
  readonly session: StudioHybridDccSession;
  readonly recoveredStateHash: string;
  readonly lastSequence: number;
  readonly checkpointFound: boolean;
  readonly assetIds: readonly string[];
}> {
  const scan = await ports.journal.scan();
  const checkpoints = scan.entries.filter((e) => e.kind === "checkpoint");
  if (checkpoints.length === 0) {
    const empty = createStudioHybridDccSession(ports.journal.identity.documentId);
    return {
      session: empty,
      recoveredStateHash: empty.state.stateHash,
      lastSequence: scan.lastSequence,
      checkpointFound: false,
      assetIds: [],
    };
  }
  const latest = checkpoints[checkpoints.length - 1]!;
  const payload = await readEntryPayload(ports.adapter, latest);
  const snapshot = decodeSnapshot(payload);
  const state = restoreStudioHybridDccStateFromSnapshot(snapshot);
  const session: StudioHybridDccSession = {
    state,
    journal: createStudioCommandJournal(),
    undoStack: [],
    redoStack: [],
    lastGroupId: null,
    undoGroupStack: [],
    redoGroupStack: [],
    lamport: state.commandCount,
  };
  return {
    session,
    recoveredStateHash: state.stateHash,
    lastSequence: latest.sequence,
    checkpointFound: true,
    assetIds: Object.keys(state.geometry.records).sort(),
  };
}

/**
 * DOC-004 recovery entry: requires real OPFS journal ports.
 * Writes a full-document checkpoint then restores into a fresh session
 * (geometry mesh hashes equal last committed state).
 */
export async function hybridDccRecoverFromJournal(
  session: StudioHybridDccSession,
  ports: StudioHybridDccOpfsPorts,
): Promise<{
  readonly recoveredStateHash: string;
  readonly lastSequence: number;
  readonly journalRestored: boolean;
  readonly checkpointFound: boolean;
  readonly session: StudioHybridDccSession;
  /** Structural equality: recovered mesh hashes match pre-crash session. */
  readonly meshHashesEqual: boolean;
}> {
  if (!ports?.adapter || !ports?.journal) {
    throw new Error(
      "hybridDccRecoverFromJournal requires StudioOpfsRecoveryJournal ports (adapter+journal)",
    );
  }
  const beforeHashes = Object.fromEntries(
    Object.entries(session.state.geometry.records).map(([id, r]) => [id, r.meshHash]),
  );
  const beforeStateHash = session.state.stateHash;
  await hybridDccWriteOpfsCheckpoint(session, ports);
  const recovered = await hybridDccRecoverFromOpfs(ports);
  const afterHashes = Object.fromEntries(
    Object.entries(recovered.session.state.geometry.records).map(([id, r]) => [
      id,
      r.meshHash,
    ]),
  );
  const meshHashesEqual =
    Object.keys(beforeHashes).length === Object.keys(afterHashes).length
    && Object.keys(beforeHashes).every((id) => beforeHashes[id] === afterHashes[id]);
  if (recovered.recoveredStateHash !== beforeStateHash || !meshHashesEqual) {
    throw new Error(
      `OPFS recovery mismatch: state ${beforeStateHash}→${recovered.recoveredStateHash} meshesEqual=${meshHashesEqual}`,
    );
  }
  return {
    recoveredStateHash: recovered.recoveredStateHash,
    lastSequence: recovered.lastSequence,
    journalRestored: true,
    checkpointFound: recovered.checkpointFound,
    session: recovered.session,
    meshHashesEqual,
  };
}

export function hybridDccContentAddressAsset(
  bytes: Uint8Array,
): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

/** Propagate dirty only to dependents of changed ids. */
export function hybridDccPropagateDirty(
  dependencies: readonly StudioHybridDccDependencyEdge[],
  changedIds: readonly string[],
): readonly string[] {
  const changed = new Set(changedIds);
  const dirty = new Set(changedIds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const edge of dependencies) {
      if (changed.has(edge.fromId) || dirty.has(edge.fromId)) {
        if (!dirty.has(edge.toId)) {
          dirty.add(edge.toId);
          grew = true;
        }
      }
    }
  }
  return [...dirty].sort();
}
