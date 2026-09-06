/**
 * Durable Hybrid DCC workspace persistence.
 *
 * The runtime workspace contains class instances, half-edge meshes, and typed arrays, so writing
 * it through JSON.stringify would silently lose authoring state. This boundary converts those
 * values to an explicit versioned DTO, verifies the complete payload with SHA-256 + CRC32, and
 * commits it through the existing two-slot OPFS recovery journal.
 */

import {
  buildStudioBg3dRoomParts,
  getStudioBg3dRoomPreset,
} from "../bg3d/studio-bg3d-room-builder";
import {
  STUDIO_LIVE_2D3D_BRIDGE_REVISION,
  STUDIO_TOON_PASS_KINDS,
  createStudioSharedSet,
  type StudioLiveBridgeDocument,
  type StudioSharedSetObject,
} from "../live/studio-live-2d3d-bridge";
import {
  canonicalStudioCommandJson,
  restoreStudioCommandJournal,
  serializeStudioCommandJournal,
  StudioCommandJournalError,
} from "../studio-command-journal";
import { calculateStudioCrc32 } from "../studio-crc32";
import {
  deserializeStudioEditableMesh,
  serializeStudioEditableMesh,
  type StudioEditableMeshSnapshot,
} from "../studio-editable-half-edge-mesh";
import { serializeStudioMeshModifierStack } from "../studio-mesh-modifier-stack";
import {
  createStudioOpfsRecoveryJournal,
  createStudioOpfsRecoveryJournalAdapter,
  StudioOpfsRecoveryJournalError,
  type StudioOpfsRecoveryJournal,
  type StudioOpfsRecoveryJournalAdapter,
  type StudioOpfsRecoveryJournalLimits,
  type StudioOpfsRecoveryLockManagerLike,
  type StudioOpfsRecoveryQuotaEstimatorLike,
  type StudioOpfsRecoveryWriterLease,
} from "../studio-opfs-recovery-journal";
import { sha256HexPortable } from "../studio-sha256";

import {
  STUDIO_HYBRID_DCC_DOCUMENT_VERSION,
  STUDIO_HYBRID_DCC_LEGACY_DOCUMENT_VERSION,
  STUDIO_HYBRID_DCC_PREVIOUS_DOCUMENT_VERSION,
  restoreStudioHybridDccStateFromSnapshot,
  snapshotStudioHybridDccState,
  type StudioHybridDccPersistedSnapshot,
  type StudioHybridDccRestorableSnapshot,
  type StudioHybridDccSession,
} from "./studio-hybrid-dcc-document";
import {
  hashStudioHybridDccObjectTransform,
  normalizeStudioHybridDccObjectTransform,
} from "./studio-hybrid-dcc-object-transform";
import {
  STUDIO_HYBRID_DCC_WORKSPACE_REVISION,
  type StudioHybridDccWorkspace,
  type StudioOcctSolidResult,
} from "./studio-hybrid-dcc-workspace";


import type { StudioRetargetReport, StudioSpringBone } from "../studio-character-animation-p2";
import type { StudioDccCollabRoom } from "./studio-dcc-collab-shell";
import type { StudioMeshExportResult } from "../export/studio-mesh-export-adapters";
import type { StudioManufacturingBom } from "../studio-manufacturing-bom-lite";
import type { StudioOpfsFileSystem } from "../studio-opfs-filesystem";
import type { StudioUvMap } from "../studio-uv-unwrap-lite";

export const STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_FORMAT =
  "toonspectrum.hybrid-dcc-workspace-persistence" as const;
export const STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_VERSION = 1 as const;
export const STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_ENGINE_VERSION =
  "hybrid-dcc-workspace-persistence-1" as const;
export const STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_ROOT = "dcc-workspaces" as const;
export const STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_PAGE = "workspace" as const;
export const STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_MAX_BYTES = 48 * 1024 * 1024;

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PRE_SLICE_MESH_HASH_PATTERN = /^mesh:[0-9a-f]{8}$/u;
const SAFE_GROUP_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/u;
const MAX_SCOPE_PART_LENGTH = 256;
const MAX_HISTORY_SNAPSHOTS = 2_048;
const MAX_BRIDGE_OBJECTS = 250_000;
const MAX_BRIDGE_SHOTS = 64;
const MAX_ARTIST_DELTAS = 100_000;
const FLOAT32_MAX = 3.402_823_466_385_288_6e38;

export interface StudioHybridDccWorkspacePersistenceScope {
  readonly userId: string;
  readonly workId: string;
}

export interface StudioHybridDccWorkspacePersistenceScopeIdentity {
  readonly scopeKey: `sha256:${string}`;
  readonly storageDocumentId: string;
}

export type StudioHybridDccWorkspacePersistenceErrorCode =
  | "ABORTED"
  | "CORRUPT_PAYLOAD"
  | "INTEGRITY_FAILED"
  | "INVALID_SCOPE"
  | "INVALID_WORKSPACE"
  | "LOCK_UNAVAILABLE"
  | "OPFS_UNAVAILABLE"
  | "PAYLOAD_TOO_LARGE"
  | "QUOTA_EXCEEDED"
  | "SCOPE_MISMATCH"
  | "STORAGE_FAILED"
  | "UNSUPPORTED_VERSION";

export class StudioHybridDccWorkspacePersistenceError extends Error {
  readonly code: StudioHybridDccWorkspacePersistenceErrorCode;
  override readonly cause?: unknown;

  constructor(
    code: StudioHybridDccWorkspacePersistenceErrorCode,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message);
    this.name = "StudioHybridDccWorkspacePersistenceError";
    this.code = code;
    this.cause = options.cause;
  }
}

interface PersistedHybridDccSessionV1 {
  readonly state: StudioHybridDccPersistedSnapshot;
  readonly commandJournal: string;
  readonly undoStack: readonly StudioHybridDccPersistedSnapshot[];
  readonly redoStack: readonly StudioHybridDccPersistedSnapshot[];
  readonly lastGroupId: string | null;
  readonly undoGroupStack: readonly string[];
  readonly redoGroupStack: readonly string[];
  readonly lamport: number;
}

interface PersistedUvMapV1 {
  readonly mode: StudioUvMap["mode"];
  readonly packed: boolean;
  readonly values: readonly number[];
}

interface PersistedOcctSolidResultV1
extends Omit<StudioOcctSolidResult, "mesh"> {
  readonly mesh: StudioEditableMeshSnapshot;
}

interface PersistedHybridDccAuxStateV1 {
  readonly activeAssetId: string | null;
  readonly lastImportReport: unknown | null;
  readonly lastUvMap: PersistedUvMapV1 | null;
  readonly lastRetarget: StudioRetargetReport | null;
  readonly lastExport: StudioMeshExportResult | null;
  readonly lastSpring: StudioSpringBone | null;
  readonly lastOcct: PersistedOcctSolidResultV1 | null;
  readonly lastDynatopo: StudioHybridDccWorkspace["lastDynatopo"];
  readonly lastRetopo: StudioHybridDccWorkspace["lastRetopo"];
  readonly bom: StudioManufacturingBom;
  readonly collab: StudioDccCollabRoom;
  readonly clothStep: number;
  readonly animSampleTime: number;
}

interface PersistedHybridDccWorkspaceV1 {
  readonly session: PersistedHybridDccSessionV1;
  readonly bridge: StudioLiveBridgeDocument;
  readonly aux: PersistedHybridDccAuxStateV1;
}

interface StudioHybridDccWorkspacePersistenceEnvelopeV1 {
  readonly format: typeof STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_FORMAT;
  readonly version: typeof STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_VERSION;
  readonly kind: "workspace" | "tombstone";
  readonly scopeKey: `sha256:${string}`;
  readonly savedAt: number;
  readonly workspaceRevision: typeof STUDIO_HYBRID_DCC_WORKSPACE_REVISION;
  readonly documentVersion:
    | typeof STUDIO_HYBRID_DCC_DOCUMENT_VERSION
    | typeof STUDIO_HYBRID_DCC_PREVIOUS_DOCUMENT_VERSION
    | typeof STUDIO_HYBRID_DCC_LEGACY_DOCUMENT_VERSION;
  readonly bridgeRevision: typeof STUDIO_LIVE_2D3D_BRIDGE_REVISION;
  readonly documentStateHash: string | null;
  readonly payloadByteLength: number;
  readonly payloadCrc32: number;
  readonly sourceHash: `sha256:${string}`;
  readonly payload: PersistedHybridDccWorkspaceV1 | { readonly cleared: true };
}

export interface StudioHybridDccWorkspacePersistenceReceipt {
  readonly scopeKey: `sha256:${string}`;
  readonly storageDocumentId: string;
  readonly sequence: number;
  readonly savedAt: number;
  readonly byteLength: number;
  readonly sourceHash: `sha256:${string}`;
  readonly documentStateHash: string | null;
}

export type StudioHybridDccWorkspacePersistenceLoadResult =
  | {
      readonly status: "empty";
      readonly scopeKey: `sha256:${string}`;
      readonly storageDocumentId: string;
      readonly lastSequence: number;
    }
  | {
      readonly status: "cleared";
      readonly scopeKey: `sha256:${string}`;
      readonly storageDocumentId: string;
      readonly lastSequence: number;
      readonly clearedAt: number;
    }
  | {
      readonly status: "restored";
      readonly scopeKey: `sha256:${string}`;
      readonly storageDocumentId: string;
      readonly lastSequence: number;
      readonly savedAt: number;
      readonly sourceHash: `sha256:${string}`;
      readonly documentStateHash: string;
      readonly workspace: StudioHybridDccWorkspace;
    };

export interface StudioHybridDccWorkspaceClearReceipt
extends StudioHybridDccWorkspacePersistenceReceipt {
  readonly physicalCleanupComplete: boolean;
  readonly removedPathCount: number;
}

export interface StudioHybridDccWorkspacePersistenceOptions {
  readonly adapter: StudioOpfsRecoveryJournalAdapter | null;
  readonly scope: StudioHybridDccWorkspacePersistenceScope;
  readonly ownerId?: string;
  readonly maxPayloadBytes?: number;
  readonly journalLimits?: Partial<StudioOpfsRecoveryJournalLimits>;
  readonly now?: () => number;
  readonly randomToken?: () => string;
}

export interface StudioHybridDccWorkspacePersistenceFileSystemOptions
extends Omit<StudioHybridDccWorkspacePersistenceOptions, "adapter"> {
  readonly fileSystem: StudioOpfsFileSystem;
  readonly lockManager: StudioOpfsRecoveryLockManagerLike | null;
  readonly quotaEstimator?: StudioOpfsRecoveryQuotaEstimatorLike | null;
}

function persistenceError(
  code: StudioHybridDccWorkspacePersistenceErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new StudioHybridDccWorkspacePersistenceError(code, message, { cause });
}

function mapPersistenceError(error: unknown): never {
  if (error instanceof StudioHybridDccWorkspacePersistenceError) throw error;
  if (error instanceof StudioOpfsRecoveryJournalError) {
    const mapped: StudioHybridDccWorkspacePersistenceErrorCode = (() => {
      switch (error.code) {
        case "ABORTED": return "ABORTED";
        case "ENTRY_TOO_LARGE":
        case "JOURNAL_LIMIT_EXCEEDED": return "PAYLOAD_TOO_LARGE";
        case "LOCK_UNAVAILABLE": return "LOCK_UNAVAILABLE";
        case "OPFS_UNAVAILABLE": return "OPFS_UNAVAILABLE";
        case "QUOTA_EXCEEDED": return "QUOTA_EXCEEDED";
        case "UNSUPPORTED_VERSION": return "UNSUPPORTED_VERSION";
        case "CORRUPT_ENTRY":
        case "CORRUPT_MANIFEST": return "CORRUPT_PAYLOAD";
        default: return "STORAGE_FAILED";
      }
    })();
    persistenceError(mapped, error.message, error);
  }
  persistenceError(
    "STORAGE_FAILED",
    "3D 작업 공간 저장소 작업에 실패했습니다. 기존 저장본은 그대로 유지됩니다.",
    error,
  );
}

function assertRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    persistenceError("CORRUPT_PAYLOAD", `${path}는 JSON 객체여야 합니다.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  const ownKeys = Object.keys(value);
  if (ownKeys.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    persistenceError("CORRUPT_PAYLOAD", `${path} 구조에 빠지거나 알 수 없는 필드가 있습니다.`);
  }
}

function assertArray(
  value: unknown,
  path: string,
  maximum: number,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    persistenceError("CORRUPT_PAYLOAD", `${path} 배열 길이가 올바르지 않습니다.`);
  }
  return value;
}

function assertFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    persistenceError("CORRUPT_PAYLOAD", `${path}는 유한한 숫자여야 합니다.`);
  }
  return value;
}

function assertSafeInteger(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    persistenceError("CORRUPT_PAYLOAD", `${path}는 ${minimum} 이상의 안전한 정수여야 합니다.`);
  }
  return value;
}

function assertString(
  value: unknown,
  path: string,
  maximum = 4096,
): string {
  if (typeof value !== "string" || value.length > maximum) {
    persistenceError("CORRUPT_PAYLOAD", `${path} 문자열이 올바르지 않습니다.`);
  }
  return value;
}

function normalizeScopePart(value: string, label: string): string {
  if (typeof value !== "string") {
    persistenceError("INVALID_SCOPE", `${label}이 문자열이 아닙니다.`);
  }
  const normalized = value.normalize("NFC").trim();
  if (
    normalized.length === 0
    || normalized.length > MAX_SCOPE_PART_LENGTH
    || [...normalized].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    persistenceError(
      "INVALID_SCOPE",
      `${label}은 제어 문자가 없는 1~${MAX_SCOPE_PART_LENGTH}자여야 합니다.`,
    );
  }
  return normalized;
}

/** Derives a privacy-preserving, path-safe OPFS identity from an exact user/work pair. */
export function resolveStudioHybridDccWorkspacePersistenceScope(
  scope: StudioHybridDccWorkspacePersistenceScope,
): StudioHybridDccWorkspacePersistenceScopeIdentity {
  const userId = normalizeScopePart(scope.userId, "userId");
  const workId = normalizeScopePart(scope.workId, "workId");
  const canonical = canonicalStudioCommandJson({ userId, workId }, 4 * 1024);
  const digest = sha256HexPortable(TEXT_ENCODER.encode(canonical));
  return Object.freeze({
    scopeKey: `sha256:${digest}`,
    storageDocumentId: `dccw-${digest.slice(0, 48)}`,
  });
}

function cloneJsonSafe<T>(value: T, path: string, maxBytes: number): T {
  try {
    return JSON.parse(canonicalStudioCommandJson(value, maxBytes)) as T;
  } catch (error) {
    if (error instanceof StudioCommandJournalError && error.code === "PAYLOAD_TOO_LARGE") {
      persistenceError(
        "PAYLOAD_TOO_LARGE",
        `${path}이 안전한 저장 용량 한도를 넘었습니다.`,
        error,
      );
    }
    persistenceError(
      "INVALID_WORKSPACE",
      `${path}에 JSON으로 안전하게 저장할 수 없는 값이 있습니다.`,
      error,
    );
  }
}

function encodeUvMap(value: StudioUvMap | null): PersistedUvMapV1 | null {
  if (!value) return null;
  return {
    mode: value.mode,
    packed: value.packed,
    values: Array.from(value.uvs),
  };
}

function decodeUvMap(value: unknown): StudioUvMap | null {
  if (value === null) return null;
  const record = assertRecord(value, "$.payload.aux.lastUvMap");
  assertExactKeys(record, ["mode", "packed", "values"], "$.payload.aux.lastUvMap");
  if (!(["planar-xy", "planar-xz", "planar-yz", "box"] as const).includes(
    record.mode as StudioUvMap["mode"],
  )) {
    persistenceError("CORRUPT_PAYLOAD", "저장된 UV 투영 방식이 올바르지 않습니다.");
  }
  if (typeof record.packed !== "boolean") {
    persistenceError("CORRUPT_PAYLOAD", "저장된 UV packed 값이 올바르지 않습니다.");
  }
  const values = assertArray(record.values, "$.payload.aux.lastUvMap.values", 2_000_000);
  if (values.length % 2 !== 0) {
    persistenceError("CORRUPT_PAYLOAD", "저장된 UV 좌표 수가 짝수가 아닙니다.");
  }
  const numeric = values.map((entry, index) => {
    const finite = assertFiniteNumber(entry, `$.payload.aux.lastUvMap.values[${index}]`);
    if (Math.abs(finite) > FLOAT32_MAX) {
      persistenceError("CORRUPT_PAYLOAD", "저장된 UV 값이 Float32 범위를 벗어났습니다.");
    }
    return finite;
  });
  return {
    mode: record.mode as StudioUvMap["mode"],
    packed: record.packed,
    uvs: new Float32Array(numeric),
  };
}

function encodeOcctResult(
  value: StudioOcctSolidResult | null,
): PersistedOcctSolidResultV1 | null {
  if (!value) return null;
  const { mesh, ...metadata } = value;
  return {
    ...metadata,
    mesh: serializeStudioEditableMesh(mesh),
  };
}

function decodeOcctResult(value: unknown): StudioOcctSolidResult | null {
  if (value === null) return null;
  const record = assertRecord(value, "$.payload.aux.lastOcct");
  const meshSnapshot = record.mesh as StudioEditableMeshSnapshot;
  let mesh;
  try {
    mesh = deserializeStudioEditableMesh(meshSnapshot);
  } catch (error) {
    persistenceError("CORRUPT_PAYLOAD", "저장된 OCCT 결과 메시가 손상되었습니다.", error);
  }
  if (
    record.ok !== true
    || (record.bodyKind !== "solid" && record.bodyKind !== "surface")
    || record.backend !== "opencascade-wasm"
  ) {
    persistenceError("CORRUPT_PAYLOAD", "저장된 OCCT 결과 헤더가 올바르지 않습니다.");
  }
  for (const key of ["faceCount", "triangleCount", "vertexCount"] as const) {
    assertSafeInteger(record[key], `$.payload.aux.lastOcct.${key}`);
  }
  assertFiniteNumber(record.volumeApprox, "$.payload.aux.lastOcct.volumeApprox");
  assertString(record.operation, "$.payload.aux.lastOcct.operation", 512);
  if (record.loadPath !== undefined && record.loadPath !== "browser" && record.loadPath !== "node") {
    persistenceError("CORRUPT_PAYLOAD", "저장된 OCCT 로드 경로가 올바르지 않습니다.");
  }
  return { ...(record as Omit<StudioOcctSolidResult, "mesh">), mesh };
}

function snapshotSession(session: StudioHybridDccSession): PersistedHybridDccSessionV1 {
  return {
    state: snapshotStudioHybridDccState(session.state),
    commandJournal: serializeStudioCommandJournal(session.journal),
    undoStack: [...session.undoStack],
    redoStack: [...session.redoStack],
    lastGroupId: session.lastGroupId,
    undoGroupStack: [...session.undoGroupStack],
    redoGroupStack: [...session.redoGroupStack],
    lamport: session.lamport,
  };
}

function snapshotWorkspace(
  workspace: StudioHybridDccWorkspace,
  maxBytes: number,
): PersistedHybridDccWorkspaceV1 {
  if (workspace.revision !== STUDIO_HYBRID_DCC_WORKSPACE_REVISION) {
    persistenceError("INVALID_WORKSPACE", "지원하지 않는 Hybrid DCC workspace revision입니다.");
  }
  const payload: PersistedHybridDccWorkspaceV1 = {
    session: snapshotSession(workspace.session),
    bridge: workspace.bridge,
    aux: {
      activeAssetId: workspace.activeAssetId,
      lastImportReport: workspace.lastImportReport,
      lastUvMap: encodeUvMap(workspace.lastUvMap),
      lastRetarget: workspace.lastRetarget,
      lastExport: workspace.lastExport,
      lastSpring: workspace.lastSpring,
      lastOcct: encodeOcctResult(workspace.lastOcct),
      lastDynatopo: workspace.lastDynatopo,
      lastRetopo: workspace.lastRetopo,
      bom: workspace.bom,
      collab: workspace.collab,
      clothStep: workspace.clothStep,
      animSampleTime: workspace.animSampleTime,
    },
  };
  return cloneJsonSafe(payload, "Hybrid DCC workspace", maxBytes);
}

function hashPreSliceModifierStack(
  meshHash: string,
  stack: Parameters<typeof serializeStudioMeshModifierStack>[0],
): string {
  const canonical = JSON.stringify({
    sourceHash: meshHash,
    ...serializeStudioMeshModifierStack(stack),
  });
  return `modifier-stack:sha256:${sha256HexPortable(TEXT_ENCODER.encode(canonical))}`;
}

/**
 * Reconstructs the v3 state hash exactly as 7b039bbc did, while retaining the persisted legacy
 * mesh hashes and Rights BOM. This is verification-only; successful callers immediately mint a
 * fresh exact-SHA snapshot through snapshotStudioHybridDccState.
 */
function hashPreSliceV3Snapshot(
  snapshot: StudioHybridDccPersistedSnapshot,
  state: ReturnType<typeof restoreStudioHybridDccStateFromSnapshot>,
): string {
  const assetById = new Map(snapshot.assets.map((asset) => [asset.assetId, asset] as const));
  const assetIds = Object.keys(state.geometry.records).sort();
  const meshFingerprints = assetIds.map((assetId) => {
    const asset = assetById.get(assetId);
    const record = state.geometry.records[assetId];
    if (!asset || !record) {
      persistenceError("CORRUPT_PAYLOAD", `legacy v3 geometry asset ${assetId}가 누락되었습니다.`);
    }
    return `${assetId}:${asset.meshHash}:${hashPreSliceModifierStack(
      asset.meshHash,
      record.modifierStack,
    )}`;
  });
  const parts = [
    state.documentId,
    String(state.version),
    String(state.commandCount),
    String(assetIds.length),
    ...meshFingerprints,
    ...Object.keys(state.objectTransforms)
      .sort()
      .map((assetId) => (
        `${assetId}:${hashStudioHybridDccObjectTransform(state.objectTransforms[assetId]!)}`
      )),
    ...snapshot.dirtyNodeIds,
    ...snapshot.rightsBom.map((record) => canonicalStudioCommandJson(record)).sort(),
    ...snapshot.dependencies.map((dependency) => canonicalStudioCommandJson(dependency)).sort(),
    snapshot.milestoneLabel ?? "",
  ];
  return `sha256:${sha256HexPortable(TEXT_ENCODER.encode(parts.join("|")))}`;
}

interface ValidatedPersistedSnapshot {
  readonly snapshot: StudioHybridDccPersistedSnapshot;
  readonly state: ReturnType<typeof restoreStudioHybridDccStateFromSnapshot>;
  readonly persistedStateHash: string;
  readonly legacyMeshHashByAssetId: ReadonlyMap<string, string>;
  readonly migratedPreSliceAuthority: boolean;
}

function validateSnapshot(
  value: unknown,
  expectedDocumentId: string | null,
  path: string,
): ValidatedPersistedSnapshot {
  const snapshot = value as StudioHybridDccRestorableSnapshot;
  let state;
  try {
    state = restoreStudioHybridDccStateFromSnapshot(snapshot);
  } catch (error) {
    persistenceError("CORRUPT_PAYLOAD", `${path} 문서 스냅샷을 복구할 수 없습니다.`, error);
  }
  if (typeof snapshot.stateHash !== "string" || !SHA256_PATTERN.test(snapshot.stateHash)) {
    persistenceError("CORRUPT_PAYLOAD", `${path} 문서 stateHash 형식이 올바르지 않습니다.`);
  }
  const legacyMeshHashByAssetId = new Map<string, string>();
  let migratedPreSliceAuthority = false;
  if (snapshot.version === STUDIO_HYBRID_DCC_DOCUMENT_VERSION) {
    for (const asset of snapshot.assets) {
      if (PRE_SLICE_MESH_HASH_PATTERN.test(asset.meshHash)) {
        legacyMeshHashByAssetId.set(asset.assetId, asset.meshHash);
      }
    }
    if (legacyMeshHashByAssetId.size > 0
      && legacyMeshHashByAssetId.size !== snapshot.assets.length) {
      persistenceError(
        "INTEGRITY_FAILED",
        `${path} legacy/exact mesh hash의 부분 이관 상태는 허용되지 않습니다.`,
      );
    }
    if (legacyMeshHashByAssetId.size > 0) {
      const preSliceHash = hashPreSliceV3Snapshot(snapshot, state);
      if (preSliceHash !== snapshot.stateHash) {
        persistenceError("INTEGRITY_FAILED", `${path} legacy v3 문서 stateHash가 일치하지 않습니다.`);
      }
      migratedPreSliceAuthority = true;
    } else if (state.stateHash !== snapshot.stateHash) {
      persistenceError("INTEGRITY_FAILED", `${path} 문서 stateHash가 일치하지 않습니다.`);
    }
  }
  if (expectedDocumentId !== null && state.documentId !== expectedDocumentId) {
    persistenceError("CORRUPT_PAYLOAD", `${path} 문서 ID가 현재 작업 문서와 다릅니다.`);
  }
  // The document restorer rebuilds runtime geometry records. Retain the persisted authority
  // revisions as well; they are not part of the content hash but are meaningful DCC evidence.
  const assetRevisions = new Map(snapshot.assets.map((asset) => [asset.assetId, asset.revision]));
  const records = Object.fromEntries(
    Object.entries(state.geometry.records).map(([assetId, record]) => [
      assetId,
      { ...record, revision: assetRevisions.get(assetId) ?? record.revision },
    ]),
  );
  return {
    snapshot: snapshotStudioHybridDccState({
      ...state,
      geometry: { ...state.geometry, records },
    }),
    state: {
      ...state,
      geometry: { ...state.geometry, records },
    },
    persistedStateHash: snapshot.stateHash,
    legacyMeshHashByAssetId,
    migratedPreSliceAuthority,
  };
}

function validateGroupId(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !SAFE_GROUP_ID.test(value)) {
    persistenceError("CORRUPT_PAYLOAD", `${path} 명령 그룹 ID가 올바르지 않습니다.`);
  }
  return value;
}

interface RestoredPersistedSession {
  readonly session: StudioHybridDccSession;
  readonly persistedStateHash: string;
  readonly currentLegacyMeshHashByAssetId: ReadonlyMap<string, string>;
  readonly migratedPreSliceAuthority: boolean;
}

function restoreSession(value: unknown): RestoredPersistedSession {
  const record = assertRecord(value, "$.payload.session");
  assertExactKeys(record, [
    "state",
    "commandJournal",
    "undoStack",
    "redoStack",
    "lastGroupId",
    "undoGroupStack",
    "redoGroupStack",
    "lamport",
  ], "$.payload.session");
  const current = validateSnapshot(record.state, null, "$.payload.session.state");
  const documentId = current.state.documentId;
  const undoValues = assertArray(
    record.undoStack,
    "$.payload.session.undoStack",
    MAX_HISTORY_SNAPSHOTS,
  );
  const redoValues = assertArray(
    record.redoStack,
    "$.payload.session.redoStack",
    MAX_HISTORY_SNAPSHOTS,
  );
  const validatedUndo = undoValues.map((snapshot, index) => (
    validateSnapshot(snapshot, documentId, `$.payload.session.undoStack[${index}]`)
  ));
  const validatedRedo = redoValues.map((snapshot, index) => (
    validateSnapshot(snapshot, documentId, `$.payload.session.redoStack[${index}]`)
  ));
  const undoStack = validatedUndo.map(({ snapshot }) => snapshot);
  const redoStack = validatedRedo.map(({ snapshot }) => snapshot);
  const undoGroupValues = assertArray(
    record.undoGroupStack,
    "$.payload.session.undoGroupStack",
    MAX_HISTORY_SNAPSHOTS,
  );
  const redoGroupValues = assertArray(
    record.redoGroupStack,
    "$.payload.session.redoGroupStack",
    MAX_HISTORY_SNAPSHOTS,
  );
  const undoGroupStack = undoGroupValues.map((id, index) => (
    validateGroupId(id, `$.payload.session.undoGroupStack[${index}]`) as string
  ));
  const redoGroupStack = redoGroupValues.map((id, index) => (
    validateGroupId(id, `$.payload.session.redoGroupStack[${index}]`) as string
  ));
  if (undoStack.length !== undoGroupStack.length || redoStack.length !== redoGroupStack.length) {
    persistenceError("CORRUPT_PAYLOAD", "undo/redo 스냅샷과 명령 그룹 수가 일치하지 않습니다.");
  }
  const commandJournal = assertString(
    record.commandJournal,
    "$.payload.session.commandJournal",
    STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_MAX_BYTES,
  );
  let journal;
  try {
    journal = restoreStudioCommandJournal(commandJournal);
  } catch (error) {
    persistenceError("CORRUPT_PAYLOAD", "저장된 3D 명령 저널 검증에 실패했습니다.", error);
  }
  const lamport = assertSafeInteger(record.lamport, "$.payload.session.lamport");
  if (lamport < current.state.commandCount) {
    persistenceError("CORRUPT_PAYLOAD", "저장된 Lamport 시계가 문서 명령 수보다 작습니다.");
  }
  return {
    session: {
      state: current.state,
      journal,
      undoStack,
      redoStack,
      lastGroupId: validateGroupId(record.lastGroupId, "$.payload.session.lastGroupId"),
      undoGroupStack,
      redoGroupStack,
      lamport,
    },
    persistedStateHash: current.persistedStateHash,
    currentLegacyMeshHashByAssetId: current.legacyMeshHashByAssetId,
    migratedPreSliceAuthority: current.migratedPreSliceAuthority
      || validatedUndo.some(({ migratedPreSliceAuthority }) => migratedPreSliceAuthority)
      || validatedRedo.some(({ migratedPreSliceAuthority }) => migratedPreSliceAuthority),
  };
}

function validateBridgeObject(value: unknown, path: string): StudioSharedSetObject {
  const record = assertRecord(value, path);
  const expectedKeys = record.transform === undefined
    ? ["id", "geometryHash", "visible", "materialId"]
    : ["id", "geometryHash", "visible", "materialId", "transform"];
  assertExactKeys(record, expectedKeys, path);
  const id = assertString(record.id, `${path}.id`, 160);
  const geometryHash = assertString(record.geometryHash, `${path}.geometryHash`, 512);
  const materialId = assertString(record.materialId, `${path}.materialId`, 160);
  if (!id || typeof record.visible !== "boolean") {
    persistenceError("CORRUPT_PAYLOAD", `${path} 공유 오브젝트가 올바르지 않습니다.`);
  }
  return {
    id,
    geometryHash,
    visible: record.visible,
    materialId,
    ...(record.transform === undefined
      ? {}
      : { transform: normalizeStudioHybridDccObjectTransform(record.transform) }),
  };
}

function restoreBridge(value: unknown): StudioLiveBridgeDocument {
  const record = assertRecord(value, "$.payload.bridge");
  assertExactKeys(
    record,
    ["revision", "set", "shots", "artistCorrections", "commandSequence"],
    "$.payload.bridge",
  );
  if (record.revision !== STUDIO_LIVE_2D3D_BRIDGE_REVISION) {
    persistenceError("UNSUPPORTED_VERSION", "지원하지 않는 2D↔3D bridge revision입니다.");
  }
  const setRecord = assertRecord(record.set, "$.payload.bridge.set");
  assertExactKeys(setRecord, ["id", "objects", "setHash"], "$.payload.bridge.set");
  const setId = assertString(setRecord.id, "$.payload.bridge.set.id", 160);
  const objectValues = assertArray(
    setRecord.objects,
    "$.payload.bridge.set.objects",
    MAX_BRIDGE_OBJECTS,
  );
  const objects = objectValues.map((object, index) => (
    validateBridgeObject(object, `$.payload.bridge.set.objects[${index}]`)
  ));
  if (new Set(objects.map((object) => object.id)).size !== objects.length) {
    persistenceError("CORRUPT_PAYLOAD", "2D↔3D bridge에 중복 오브젝트 ID가 있습니다.");
  }
  const set = createStudioSharedSet(setId, objects);
  if (set.setHash !== setRecord.setHash) {
    persistenceError("INTEGRITY_FAILED", "2D↔3D bridge setHash가 일치하지 않습니다.");
  }
  const shots = assertArray(record.shots, "$.payload.bridge.shots", MAX_BRIDGE_SHOTS);
  const shotIds = new Set<string>();
  const passKinds = new Set<string>(STUDIO_TOON_PASS_KINDS);
  for (let index = 0; index < shots.length; index += 1) {
    const shot = assertRecord(shots[index], `$.payload.bridge.shots[${index}]`);
    assertExactKeys(
      shot,
      ["id", "name", "overrides", "passHashes", "dirtyPasses"],
      `$.payload.bridge.shots[${index}]`,
    );
    const id = assertString(shot.id, `$.payload.bridge.shots[${index}].id`, 160);
    assertString(shot.name, `$.payload.bridge.shots[${index}].name`, 512);
    if (shotIds.has(id)) {
      persistenceError("CORRUPT_PAYLOAD", "2D↔3D bridge에 중복 shot ID가 있습니다.");
    }
    shotIds.add(id);
    assertRecord(shot.overrides, `$.payload.bridge.shots[${index}].overrides`);
    const hashes = assertRecord(shot.passHashes, `$.payload.bridge.shots[${index}].passHashes`);
    for (const [kind, hash] of Object.entries(hashes)) {
      if (!passKinds.has(kind) || typeof hash !== "string") {
        persistenceError("CORRUPT_PAYLOAD", "저장된 toon pass hash가 올바르지 않습니다.");
      }
    }
    const dirty = assertArray(
      shot.dirtyPasses,
      `$.payload.bridge.shots[${index}].dirtyPasses`,
      STUDIO_TOON_PASS_KINDS.length,
    );
    if (
      new Set(dirty).size !== dirty.length
      || dirty.some((kind) => typeof kind !== "string" || !passKinds.has(kind))
    ) {
      persistenceError("CORRUPT_PAYLOAD", "저장된 dirty toon pass 목록이 올바르지 않습니다.");
    }
  }
  const corrections = assertRecord(record.artistCorrections, "$.payload.bridge.artistCorrections");
  assertExactKeys(corrections, ["revision", "deltas"], "$.payload.bridge.artistCorrections");
  if (corrections.revision !== 1) {
    persistenceError("UNSUPPORTED_VERSION", "지원하지 않는 artist correction revision입니다.");
  }
  assertArray(corrections.deltas, "$.payload.bridge.artistCorrections.deltas", MAX_ARTIST_DELTAS);
  const commandSequence = assertSafeInteger(
    record.commandSequence,
    "$.payload.bridge.commandSequence",
  );
  return {
    revision: STUDIO_LIVE_2D3D_BRIDGE_REVISION,
    set,
    shots: shots as StudioLiveBridgeDocument["shots"],
    artistCorrections: corrections as unknown as StudioLiveBridgeDocument["artistCorrections"],
    commandSequence,
  };
}

function assertNullableJsonObject<T>(value: unknown, path: string): T | null {
  if (value === null) return null;
  assertRecord(value, path);
  return value as T;
}

interface RestoredPersistedWorkspace {
  readonly workspace: StudioHybridDccWorkspace;
  readonly persistedStateHash: string;
  readonly migratedPreSliceAuthority: boolean;
}

function isVerifiedPreSliceRoomBridgeObject(object: StudioSharedSetObject): boolean {
  if (object.id !== "room-shell"
    || object.materialId !== "wall"
    || object.visible !== true
    || object.transform !== undefined) {
    return false;
  }
  const match = /^room:([A-Za-z0-9][A-Za-z0-9._-]{0,79}):([1-9][0-9]{0,5})$/u.exec(
    object.geometryHash,
  );
  if (!match) return false;
  const partCount = Number(match[2]);
  if (!Number.isSafeInteger(partCount) || partCount <= 0 || partCount > MAX_BRIDGE_OBJECTS) {
    return false;
  }
  const preset = getStudioBg3dRoomPreset(match[1]);
  if (!preset) return false;
  try {
    return buildStudioBg3dRoomParts(preset.spec).length === partCount;
  } catch {
    return false;
  }
}

function migratePreSliceBridgeAuthority(
  bridge: StudioLiveBridgeDocument,
  session: StudioHybridDccSession,
  legacyMeshHashByAssetId: ReadonlyMap<string, string>,
): { readonly bridge: StudioLiveBridgeDocument; readonly migrated: boolean } {
  if (legacyMeshHashByAssetId.size === 0) return { bridge, migrated: false };
  let migrated = false;
  const objects = bridge.set.objects.map((object) => {
    const legacyHash = legacyMeshHashByAssetId.get(object.id);
    const authorityRecord = session.state.geometry.records[object.id];
    if (!legacyHash || !authorityRecord) {
      if (isVerifiedPreSliceRoomBridgeObject(object)) return object;
      persistenceError(
        "INTEGRITY_FAILED",
        `legacy bridge object ${object.id}가 문서 geometry authority와 연결되지 않습니다.`,
      );
    }
    if (object.geometryHash !== legacyHash) {
      // A pre-slice nonempty modifier stack stored its evaluated resultHash in the bridge while
      // keeping the source mesh canonical in the document. The preview mesh was intentionally not
      // persisted, so its legacy fingerprint cannot become authority here. Accept only the legacy
      // fingerprint shape as a disposable cache marker, reset it to exact source authority, and
      // let workspaceRefreshModifierPreviews materialize a fresh exact cache after cold load.
      const isDisposableModifierPreview = authorityRecord.modifierStack.modifiers.length > 0
        && PRE_SLICE_MESH_HASH_PATTERN.test(object.geometryHash);
      if (!isDisposableModifierPreview) {
        persistenceError(
          "INTEGRITY_FAILED",
          `legacy bridge object ${object.id}의 geometryHash가 검증된 mesh hash와 다릅니다.`,
        );
      }
    }
    migrated = true;
    return { ...object, geometryHash: authorityRecord.meshHash };
  });
  if (!migrated) return { bridge, migrated: false };
  return {
    bridge: {
      ...bridge,
      set: createStudioSharedSet(bridge.set.id, objects),
      shots: bridge.shots.map((shot) => ({
        ...shot,
        dirtyPasses: [...STUDIO_TOON_PASS_KINDS],
      })),
    },
    migrated: true,
  };
}

function restoreWorkspace(value: unknown): RestoredPersistedWorkspace {
  const record = assertRecord(value, "$.payload");
  assertExactKeys(record, ["session", "bridge", "aux"], "$.payload");
  const restoredSession = restoreSession(record.session);
  const session = restoredSession.session;
  const restoredBridge = restoreBridge(record.bridge);
  const bridgeMigration = migratePreSliceBridgeAuthority(
    restoredBridge,
    session,
    restoredSession.currentLegacyMeshHashByAssetId,
  );
  const bridge = bridgeMigration.bridge;
  const aux = assertRecord(record.aux, "$.payload.aux");
  assertExactKeys(aux, [
    "activeAssetId",
    "lastImportReport",
    "lastUvMap",
    "lastRetarget",
    "lastExport",
    "lastSpring",
    "lastOcct",
    "lastDynatopo",
    "lastRetopo",
    "bom",
    "collab",
    "clothStep",
    "animSampleTime",
  ], "$.payload.aux");
  const activeAssetId = aux.activeAssetId === null
    ? null
    : assertString(aux.activeAssetId, "$.payload.aux.activeAssetId", 160);
  if (activeAssetId !== null && !Object.hasOwn(session.state.geometry.records, activeAssetId)) {
    persistenceError("CORRUPT_PAYLOAD", "활성 3D 오브젝트가 문서 geometry authority에 없습니다.");
  }
  const clothStep = assertSafeInteger(aux.clothStep, "$.payload.aux.clothStep");
  const animSampleTime = assertFiniteNumber(aux.animSampleTime, "$.payload.aux.animSampleTime");
  if (animSampleTime < 0) {
    persistenceError("CORRUPT_PAYLOAD", "저장된 애니메이션 샘플 시간이 음수입니다.");
  }
  const bom = assertRecord(aux.bom, "$.payload.aux.bom") as unknown as StudioManufacturingBom;
  if (bom.revision !== 1 || bom.documentId !== session.state.documentId) {
    persistenceError("CORRUPT_PAYLOAD", "저장된 BOM이 현재 3D 문서와 일치하지 않습니다.");
  }
  assertArray(bom.materials, "$.payload.aux.bom.materials", 100_000);
  assertArray(bom.lines, "$.payload.aux.bom.lines", 250_000);
  const collab = assertRecord(
    aux.collab,
    "$.payload.aux.collab",
  ) as unknown as StudioDccCollabRoom;
  if (collab.revision !== 4 || !Array.isArray(collab.peers) || !Array.isArray(collab.ops)) {
    persistenceError("UNSUPPORTED_VERSION", "지원하지 않는 3D 협업 room revision입니다.");
  }
  assertSafeInteger(collab.epoch, "$.payload.aux.collab.epoch");
  assertRecord(collab.locks, "$.payload.aux.collab.locks");
  return {
    workspace: {
      revision: STUDIO_HYBRID_DCC_WORKSPACE_REVISION,
      session,
      bridge,
      activeAssetId,
      lastImportReport: aux.lastImportReport,
      lastUvMap: decodeUvMap(aux.lastUvMap),
      lastRetarget: assertNullableJsonObject<StudioRetargetReport>(
        aux.lastRetarget,
        "$.payload.aux.lastRetarget",
      ),
      lastExport: assertNullableJsonObject<StudioMeshExportResult>(
        aux.lastExport,
        "$.payload.aux.lastExport",
      ),
      lastSpring: assertNullableJsonObject<StudioSpringBone>(
        aux.lastSpring,
        "$.payload.aux.lastSpring",
      ),
      lastOcct: decodeOcctResult(aux.lastOcct),
      lastDynatopo: assertNullableJsonObject<StudioHybridDccWorkspace["lastDynatopo"]>(
        aux.lastDynatopo,
        "$.payload.aux.lastDynatopo",
      ),
      lastRetopo: assertNullableJsonObject<StudioHybridDccWorkspace["lastRetopo"]>(
        aux.lastRetopo,
        "$.payload.aux.lastRetopo",
      ),
      bom,
      collab,
      clothStep,
      // The canonical stepped mesh is persisted in the document. Velocity/rest continuation is an
      // explicitly transient solver cache and starts fresh after a cold restore.
      clothRuntimeCache: null,
      animSampleTime,
    },
    persistedStateHash: restoredSession.persistedStateHash,
    migratedPreSliceAuthority: restoredSession.migratedPreSliceAuthority
      || bridgeMigration.migrated,
  };
}

function maxPayloadBytes(value: number | undefined): number {
  const resolved = value ?? STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_MAX_BYTES;
  if (
    !Number.isSafeInteger(resolved)
    || resolved < 4 * 1024
    || resolved > STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_MAX_BYTES
  ) {
    persistenceError(
      "INVALID_WORKSPACE",
      `3D 작업 공간 저장 한도는 4KB~${STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_MAX_BYTES}바이트여야 합니다.`,
    );
  }
  return resolved;
}

function createEnvelope(input: {
  readonly kind: "workspace" | "tombstone";
  readonly scopeKey: `sha256:${string}`;
  readonly savedAt: number;
  readonly payload: PersistedHybridDccWorkspaceV1 | { readonly cleared: true };
  readonly documentStateHash: string | null;
  readonly maxBytes: number;
}): { readonly envelope: StudioHybridDccWorkspacePersistenceEnvelopeV1; readonly bytes: Uint8Array } {
  if (!Number.isSafeInteger(input.savedAt) || input.savedAt < 0) {
    persistenceError("INVALID_WORKSPACE", "저장 시각은 0 이상의 안전한 정수여야 합니다.");
  }
  let payloadJson: string;
  try {
    payloadJson = canonicalStudioCommandJson(input.payload, input.maxBytes);
  } catch (error) {
    persistenceError("PAYLOAD_TOO_LARGE", "3D 작업 공간이 안전한 저장 용량 한도를 넘었습니다.", error);
  }
  const payloadBytes = TEXT_ENCODER.encode(payloadJson);
  const sourceHash = `sha256:${sha256HexPortable(payloadBytes)}` as const;
  const envelope: StudioHybridDccWorkspacePersistenceEnvelopeV1 = {
    format: STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_FORMAT,
    version: STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_VERSION,
    kind: input.kind,
    scopeKey: input.scopeKey,
    savedAt: input.savedAt,
    workspaceRevision: STUDIO_HYBRID_DCC_WORKSPACE_REVISION,
    documentVersion: STUDIO_HYBRID_DCC_DOCUMENT_VERSION,
    bridgeRevision: STUDIO_LIVE_2D3D_BRIDGE_REVISION,
    documentStateHash: input.documentStateHash,
    payloadByteLength: payloadBytes.byteLength,
    payloadCrc32: calculateStudioCrc32(payloadBytes),
    sourceHash,
    payload: input.payload,
  };
  let envelopeJson: string;
  try {
    envelopeJson = canonicalStudioCommandJson(envelope, input.maxBytes);
  } catch (error) {
    persistenceError("PAYLOAD_TOO_LARGE", "3D 작업 공간 envelope가 저장 한도를 넘었습니다.", error);
  }
  const bytes = TEXT_ENCODER.encode(envelopeJson);
  if (bytes.byteLength > input.maxBytes) {
    persistenceError("PAYLOAD_TOO_LARGE", "3D 작업 공간 envelope가 저장 한도를 넘었습니다.");
  }
  return { envelope, bytes };
}

/** Pure codec used by save and deterministic offline verification. */
export function encodeStudioHybridDccWorkspacePersistenceEnvelope(input: {
  readonly workspace: StudioHybridDccWorkspace;
  readonly scope: StudioHybridDccWorkspacePersistenceScope;
  readonly savedAt?: number;
  readonly maxPayloadBytes?: number;
}): { readonly envelope: StudioHybridDccWorkspacePersistenceEnvelopeV1; readonly bytes: Uint8Array } {
  const maxBytes = maxPayloadBytes(input.maxPayloadBytes);
  const identity = resolveStudioHybridDccWorkspacePersistenceScope(input.scope);
  const payload = snapshotWorkspace(input.workspace, maxBytes);
  return createEnvelope({
    kind: "workspace",
    scopeKey: identity.scopeKey,
    savedAt: input.savedAt ?? Date.now(),
    payload,
    documentStateHash: input.workspace.session.state.stateHash,
    maxBytes,
  });
}

function decodeEnvelope(input: {
  readonly bytes: Uint8Array;
  readonly scopeKey: `sha256:${string}`;
  readonly maxBytes: number;
}): {
  readonly envelope: StudioHybridDccWorkspacePersistenceEnvelopeV1;
  readonly workspace: StudioHybridDccWorkspace | null;
} {
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > input.maxBytes) {
    persistenceError("PAYLOAD_TOO_LARGE", "저장된 3D 작업 공간 byte 길이가 허용 범위를 벗어났습니다.");
  }
  let text: string;
  let parsed: unknown;
  try {
    text = TEXT_DECODER.decode(input.bytes);
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    persistenceError("CORRUPT_PAYLOAD", "저장된 3D 작업 공간 JSON을 읽을 수 없습니다.", error);
  }
  let canonical: string;
  try {
    canonical = canonicalStudioCommandJson(parsed, input.maxBytes);
  } catch (error) {
    persistenceError("CORRUPT_PAYLOAD", "저장된 3D 작업 공간이 JSON-safe 계약을 위반했습니다.", error);
  }
  if (canonical !== text) {
    persistenceError("CORRUPT_PAYLOAD", "저장된 3D 작업 공간이 canonical JSON이 아닙니다.");
  }
  const record = assertRecord(parsed, "$");
  assertExactKeys(record, [
    "format",
    "version",
    "kind",
    "scopeKey",
    "savedAt",
    "workspaceRevision",
    "documentVersion",
    "bridgeRevision",
    "documentStateHash",
    "payloadByteLength",
    "payloadCrc32",
    "sourceHash",
    "payload",
  ], "$");
  if (record.format !== STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_FORMAT) {
    persistenceError("CORRUPT_PAYLOAD", "3D 작업 공간 저장 포맷이 올바르지 않습니다.");
  }
  if (record.version !== STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_VERSION) {
    persistenceError("UNSUPPORTED_VERSION", "지원하지 않는 3D 작업 공간 저장 버전입니다.");
  }
  if (record.scopeKey !== input.scopeKey) {
    persistenceError("SCOPE_MISMATCH", "다른 사용자 또는 작품의 3D 작업 공간은 열 수 없습니다.");
  }
  if (
    record.workspaceRevision !== STUDIO_HYBRID_DCC_WORKSPACE_REVISION
    || record.bridgeRevision !== STUDIO_LIVE_2D3D_BRIDGE_REVISION
  ) {
    persistenceError("UNSUPPORTED_VERSION", "3D 엔진 구성 버전이 현재 앱과 호환되지 않습니다.");
  }
  const documentVersion = assertSafeInteger(record.documentVersion, "$.documentVersion");
  if (documentVersion !== STUDIO_HYBRID_DCC_DOCUMENT_VERSION
    && documentVersion !== STUDIO_HYBRID_DCC_PREVIOUS_DOCUMENT_VERSION
    && documentVersion !== STUDIO_HYBRID_DCC_LEGACY_DOCUMENT_VERSION) {
    persistenceError("UNSUPPORTED_VERSION", "지원하지 않는 Hybrid DCC 문서 버전입니다.");
  }
  const savedAt = assertSafeInteger(record.savedAt, "$.savedAt");
  const payloadByteLength = assertSafeInteger(record.payloadByteLength, "$.payloadByteLength");
  const payloadCrc32 = assertSafeInteger(record.payloadCrc32, "$.payloadCrc32");
  if (payloadCrc32 > 0xffff_ffff) {
    persistenceError("CORRUPT_PAYLOAD", "3D 작업 공간 CRC32 범위가 올바르지 않습니다.");
  }
  if (typeof record.sourceHash !== "string" || !SHA256_PATTERN.test(record.sourceHash)) {
    persistenceError("CORRUPT_PAYLOAD", "3D 작업 공간 sourceHash 형식이 올바르지 않습니다.");
  }
  let payloadJson: string;
  try {
    payloadJson = canonicalStudioCommandJson(record.payload, input.maxBytes);
  } catch (error) {
    persistenceError("CORRUPT_PAYLOAD", "3D 작업 공간 payload가 JSON-safe 계약을 위반했습니다.", error);
  }
  const payloadBytes = TEXT_ENCODER.encode(payloadJson);
  if (
    payloadBytes.byteLength !== payloadByteLength
    || calculateStudioCrc32(payloadBytes) !== payloadCrc32
    || `sha256:${sha256HexPortable(payloadBytes)}` !== record.sourceHash
  ) {
    persistenceError("INTEGRITY_FAILED", "3D 작업 공간 payload checksum/sourceHash가 일치하지 않습니다.");
  }
  if (record.kind !== "workspace" && record.kind !== "tombstone") {
    persistenceError("CORRUPT_PAYLOAD", "3D 작업 공간 envelope 종류가 올바르지 않습니다.");
  }
  if (record.kind === "tombstone") {
    const tombstone = assertRecord(record.payload, "$.payload");
    assertExactKeys(tombstone, ["cleared"], "$.payload");
    if (tombstone.cleared !== true || record.documentStateHash !== null) {
      persistenceError("CORRUPT_PAYLOAD", "3D 작업 공간 삭제 표식이 손상되었습니다.");
    }
    return {
      envelope: record as unknown as StudioHybridDccWorkspacePersistenceEnvelopeV1,
      workspace: null,
    };
  }
  if (typeof record.documentStateHash !== "string" || !SHA256_PATTERN.test(record.documentStateHash)) {
    persistenceError("CORRUPT_PAYLOAD", "3D 문서 stateHash 형식이 올바르지 않습니다.");
  }
  const restored = restoreWorkspace(record.payload);
  const workspace = restored.workspace;
  const payloadRecord = assertRecord(record.payload, "$.payload");
  const sessionRecord = assertRecord(payloadRecord.session, "$.payload.session");
  const stateRecord = assertRecord(sessionRecord.state, "$.payload.session.state");
  if (stateRecord.version !== documentVersion) {
    persistenceError("CORRUPT_PAYLOAD", "envelope와 문서 스냅샷 버전이 일치하지 않습니다.");
  }
  const persistedStateHash = assertString(
    stateRecord.stateHash,
    "$.payload.session.state.stateHash",
    256,
  );
  if (persistedStateHash !== restored.persistedStateHash) {
    persistenceError("INTEGRITY_FAILED", "복구 전 3D 문서 stateHash 권위가 일치하지 않습니다.");
  }
  if (persistedStateHash !== record.documentStateHash) {
    persistenceError("INTEGRITY_FAILED", "복구한 3D 문서 stateHash가 envelope와 일치하지 않습니다.");
  }
  const migratedEnvelope = restored.migratedPreSliceAuthority
    && documentVersion === STUDIO_HYBRID_DCC_DOCUMENT_VERSION
    ? createEnvelope({
        kind: "workspace",
        scopeKey: input.scopeKey,
        savedAt,
        payload: snapshotWorkspace(workspace, input.maxBytes),
        documentStateHash: workspace.session.state.stateHash,
        maxBytes: input.maxBytes,
      }).envelope
    : null;
  return {
    envelope: migratedEnvelope ?? {
      ...(record as unknown as StudioHybridDccWorkspacePersistenceEnvelopeV1),
      savedAt,
      payloadByteLength,
      payloadCrc32,
    },
    workspace,
  };
}

/** Pure fail-closed decoder; it never substitutes an empty workspace for corrupt storage. */
export function decodeStudioHybridDccWorkspacePersistenceEnvelope(input: {
  readonly bytes: Uint8Array;
  readonly scope: StudioHybridDccWorkspacePersistenceScope;
  readonly maxPayloadBytes?: number;
}): {
  readonly kind: "workspace" | "tombstone";
  readonly savedAt: number;
  readonly sourceHash: `sha256:${string}`;
  readonly documentStateHash: string | null;
  readonly workspace: StudioHybridDccWorkspace | null;
} {
  const identity = resolveStudioHybridDccWorkspacePersistenceScope(input.scope);
  const decoded = decodeEnvelope({
    bytes: input.bytes,
    scopeKey: identity.scopeKey,
    maxBytes: maxPayloadBytes(input.maxPayloadBytes),
  });
  return {
    kind: decoded.envelope.kind,
    savedAt: decoded.envelope.savedAt,
    sourceHash: decoded.envelope.sourceHash,
    documentStateHash: decoded.envelope.documentStateHash,
    workspace: decoded.workspace,
  };
}

async function collectPayload(
  journal: StudioOpfsRecoveryJournal,
  entry: Parameters<StudioOpfsRecoveryJournal["readPayload"]>[0],
  maximum: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for await (const chunk of journal.readPayload(entry)) {
    byteLength += chunk.byteLength;
    if (byteLength > maximum) {
      persistenceError("PAYLOAD_TOO_LARGE", "저장된 3D 작업 공간이 현재 byte 한도를 넘었습니다.");
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export class StudioHybridDccWorkspacePersistence {
  readonly #journal: StudioOpfsRecoveryJournal;
  readonly #identity: StudioHybridDccWorkspacePersistenceScopeIdentity;
  readonly #scope: StudioHybridDccWorkspacePersistenceScope;
  readonly #ownerId: string;
  readonly #maxPayloadBytes: number;
  readonly #now: () => number;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(options: StudioHybridDccWorkspacePersistenceOptions) {
    if (!options.adapter) {
      persistenceError(
        "OPFS_UNAVAILABLE",
        "이 브라우저에는 안전한 OPFS 저장소가 없어 3D 작업 공간 영속화를 시작하지 않았습니다.",
      );
    }
    this.#identity = resolveStudioHybridDccWorkspacePersistenceScope(options.scope);
    this.#scope = Object.freeze({ ...options.scope });
    this.#ownerId = options.ownerId ?? "hybrid-dcc-workspace-writer";
    if (!SAFE_GROUP_ID.test(this.#ownerId)) {
      persistenceError("INVALID_SCOPE", "3D 작업 공간 writer ID가 올바르지 않습니다.");
    }
    this.#maxPayloadBytes = maxPayloadBytes(options.maxPayloadBytes);
    this.#now = options.now ?? (() => Date.now());
    try {
      this.#journal = createStudioOpfsRecoveryJournal({
        adapter: options.adapter,
        identity: {
          documentId: this.#identity.storageDocumentId,
          documentVersion: STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_VERSION,
          engineVersion: STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_ENGINE_VERSION,
        },
        rootPath: STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_ROOT,
        limits: {
          maxChunkBytes: Math.min(1024 * 1024, this.#maxPayloadBytes),
          maxEntryBytes: this.#maxPayloadBytes,
          // Entry descriptors/manifests also count against the journal budget.
          maxJournalBytes: Math.max(
            this.#maxPayloadBytes + 1024 * 1024,
            options.journalLimits?.maxJournalBytes ?? 0,
          ),
          ...options.journalLimits,
        },
        now: this.#now,
        randomToken: options.randomToken,
      });
    } catch (error) {
      mapPersistenceError(error);
    }
  }

  get scopeKey(): `sha256:${string}` {
    return this.#identity.scopeKey;
  }

  get storageDocumentId(): string {
    return this.#identity.storageDocumentId;
  }

  async #runWithWriter<T>(
    operation: (writer: StudioOpfsRecoveryWriterLease) => Promise<T>,
  ): Promise<T> {
    let writer: StudioOpfsRecoveryWriterLease;
    try {
      writer = await this.#journal.acquireWriter({ ownerId: this.#ownerId });
    } catch (error) {
      mapPersistenceError(error);
    }
    let operationError: unknown;
    try {
      return await operation(writer);
    } catch (error) {
      operationError = error;
      mapPersistenceError(error);
    } finally {
      try {
        await this.#journal.releaseWriter(writer);
      } catch (releaseError) {
        if (operationError === undefined) mapPersistenceError(releaseError);
      }
    }
    persistenceError("STORAGE_FAILED", "3D 작업 공간 writer가 결과 없이 종료되었습니다.");
  }

  #withWriter<T>(
    operation: (writer: StudioOpfsRecoveryWriterLease) => Promise<T>,
  ): Promise<T> {
    // A journal writer lease intentionally outlives the short Web Lock used to acquire it. Without
    // an instance-local mutation queue, overlapping save/clear calls from the same owner race for
    // that live lease and the newer mutation fails with LEASE_BUSY. Keep the complete lease
    // lifecycle FIFO, and normalize the tail after either success or failure so one storage error
    // cannot permanently block the in-memory mutation queue.
    const result = this.#mutationTail
      .catch(() => undefined)
      .then(() => this.#runWithWriter(operation));
    this.#mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async save(workspace: StudioHybridDccWorkspace): Promise<StudioHybridDccWorkspacePersistenceReceipt> {
    return this.#withWriter(async (writer) => {
      const scan = await this.#journal.scan();
      const savedAt = this.#now();
      const encoded = encodeStudioHybridDccWorkspacePersistenceEnvelope({
        workspace,
        scope: this.#scope,
        savedAt,
        maxPayloadBytes: this.#maxPayloadBytes,
      });
      const entry = await this.#journal.appendCheckpoint(writer, {
        id: `workspace-save-${scan.lastSequence + 1}`,
        pageId: STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_PAGE,
        revision: scan.lastSequence + 1,
        payload: encoded.bytes,
        compactThroughSequence: scan.lastSequence,
        createdAt: savedAt,
      });
      return Object.freeze({
        scopeKey: this.scopeKey,
        storageDocumentId: this.storageDocumentId,
        sequence: entry.sequence,
        savedAt,
        byteLength: encoded.bytes.byteLength,
        sourceHash: encoded.envelope.sourceHash,
        documentStateHash: encoded.envelope.documentStateHash,
      });
    });
  }

  async load(): Promise<StudioHybridDccWorkspacePersistenceLoadResult> {
    try {
      const scan = await this.#journal.scan();
      const latest = [...scan.entries]
        .reverse()
        .find((entry) => (
          entry.kind === "checkpoint"
          && entry.pageId === STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_PAGE
        ));
      if (!latest) {
        return Object.freeze({
          status: "empty",
          scopeKey: this.scopeKey,
          storageDocumentId: this.storageDocumentId,
          lastSequence: scan.lastSequence,
        });
      }
      const bytes = await collectPayload(this.#journal, latest, this.#maxPayloadBytes);
      const decoded = decodeEnvelope({
        bytes,
        scopeKey: this.scopeKey,
        maxBytes: this.#maxPayloadBytes,
      });
      if (decoded.envelope.kind === "tombstone") {
        return Object.freeze({
          status: "cleared",
          scopeKey: this.scopeKey,
          storageDocumentId: this.storageDocumentId,
          lastSequence: latest.sequence,
          clearedAt: decoded.envelope.savedAt,
        });
      }
      if (!decoded.workspace || decoded.envelope.documentStateHash === null) {
        persistenceError("CORRUPT_PAYLOAD", "3D 작업 공간 envelope에 복구 문서가 없습니다.");
      }
      return Object.freeze({
        status: "restored",
        scopeKey: this.scopeKey,
        storageDocumentId: this.storageDocumentId,
        lastSequence: latest.sequence,
        savedAt: decoded.envelope.savedAt,
        sourceHash: decoded.envelope.sourceHash,
        documentStateHash: decoded.envelope.documentStateHash,
        workspace: decoded.workspace,
      });
    } catch (error) {
      mapPersistenceError(error);
    }
  }

  async clear(): Promise<StudioHybridDccWorkspaceClearReceipt> {
    return this.#withWriter(async (writer) => {
      const scan = await this.#journal.scan();
      const savedAt = this.#now();
      const encoded = createEnvelope({
        kind: "tombstone",
        scopeKey: this.scopeKey,
        savedAt,
        payload: { cleared: true },
        documentStateHash: null,
        maxBytes: this.#maxPayloadBytes,
      });
      const entry = await this.#journal.appendCheckpoint(writer, {
        id: `workspace-clear-${scan.lastSequence + 1}`,
        pageId: STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_PAGE,
        revision: scan.lastSequence + 1,
        payload: encoded.bytes,
        compactThroughSequence: scan.lastSequence,
        createdAt: savedAt,
      });
      let removedPathCount = 0;
      let physicalCleanupComplete = false;
      try {
        const eviction = await this.#journal.evictObsolete(writer);
        removedPathCount = eviction.removedPaths.length;
        // Hitting the per-pass ceiling means more orphan files may remain; report conservatively.
        physicalCleanupComplete = removedPathCount < this.#journal.limits.maxEvictionsPerPass;
      } catch {
        // The tombstone is already the committed authority. Cleanup is best-effort and retryable.
      }
      return Object.freeze({
        scopeKey: this.scopeKey,
        storageDocumentId: this.storageDocumentId,
        sequence: entry.sequence,
        savedAt,
        byteLength: encoded.bytes.byteLength,
        sourceHash: encoded.envelope.sourceHash,
        documentStateHash: null,
        physicalCleanupComplete,
        removedPathCount,
      });
    });
  }
}

export function createStudioHybridDccWorkspacePersistence(
  options: StudioHybridDccWorkspacePersistenceOptions,
): StudioHybridDccWorkspacePersistence {
  return new StudioHybridDccWorkspacePersistence(options);
}

/**
 * Browser integration factory. Native OPFS and an origin-wide Web Lock are mandatory; memory and
 * localStorage fallbacks deliberately fail closed instead of pretending to be durable DCC storage.
 */
export function createStudioHybridDccWorkspacePersistenceFromFileSystem(
  options: StudioHybridDccWorkspacePersistenceFileSystemOptions,
): StudioHybridDccWorkspacePersistence {
  try {
    const adapter = createStudioOpfsRecoveryJournalAdapter({
      fileSystem: options.fileSystem,
      lockManager: options.lockManager,
      quotaEstimator: options.quotaEstimator,
    });
    return createStudioHybridDccWorkspacePersistence({
      adapter,
      scope: options.scope,
      ownerId: options.ownerId,
      maxPayloadBytes: options.maxPayloadBytes,
      journalLimits: options.journalLimits,
      now: options.now,
      randomToken: options.randomToken,
    });
  } catch (error) {
    mapPersistenceError(error);
  }
}
