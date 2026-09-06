import {
  requireStudioCrdtRecoveryDatabase,
  type StudioCrdtRecoveryDatabase,
  type StudioCrdtRecoverySqlCandidate,
  type StudioCrdtRecoverySqlRowKind,
  type StudioLocalDatabase,
} from "../studio-local-database";
import { acquireStudioLocalDatabase } from "../studio-local-database-runtime";

import {
  parsePersistedStudioCrdtUpdateRequest,
  parseStudioCrdtUpdateRequest,
  type StudioCrdtUpdateRequest,
} from "./studio-crdt-protocol";

const LEGACY_MAX_FRONTIER_UPDATES = 4_096;
const RECOVERY_CHUNK_MAX_UPDATES = 128;
const RECOVERY_CHUNK_MAX_JSON_CHARS = 2 * 1024 * 1024;
export const STUDIO_CRDT_RECOVERY_MAX_ROWS_PER_WORK = 100_000;
export const STUDIO_CRDT_RECOVERY_MAX_BYTES_PER_WORK = 512 * 1024 * 1024;
export const STUDIO_CRDT_RECOVERY_MAX_ROW_BYTES = 3 * 1024 * 1024;

export const STUDIO_CRDT_RECOVERY_BUNDLE_VERSION = 1 as const;

export type StudioCrdtRecoveryVaultStatus = "pending-export" | "exported";

export interface StudioCrdtRecoveryVaultEntry {
  vaultId: string;
  scope: string;
  workId: string;
  status: StudioCrdtRecoveryVaultStatus;
  failureCode: string;
  failureMessage: string;
  rejectedUpdateId: string;
  updates: StudioCrdtUpdateRequest[];
  createdAt: number;
  exportedAt: number | null;
}

export interface PreserveStudioCrdtRecoveryFrontierInput {
  scope: string;
  workId: string;
  failureCode: string;
  failureMessage: string;
  rejectedUpdateId: string;
  updates: readonly StudioCrdtUpdateRequest[];
}

/**
 * Small fail-closed guard written before the complete rejected frontier. It contains no document
 * bytes; its only job is to prevent an existing resend outbox from becoming publishable again
 * when the larger recovery-vault transaction fails.
 */
export interface StudioCrdtPermanentRejectionMarker {
  scope: string;
  workId: string;
  failureCode: string;
  failureMessage: string;
  rejectedUpdateId: string;
  recoveryUpdateCount: number;
  createdAt: number;
}

export interface PreserveStudioCrdtRejectionMarkerInput {
  scope: string;
  workId: string;
  failureCode: string;
  failureMessage: string;
  rejectedUpdateId: string;
  recoveryUpdateCount: number;
}

export interface StudioCrdtRejectionMarkerEphemeralLatch {
  /** Same-page lock only. This method never claims browser-durable success. */
  preserve(marker: StudioCrdtPermanentRejectionMarker): void;
  list(scope: string, workId: string): unknown[];
}

export class StudioCrdtRecoveryDurabilityError extends Error {
  readonly durability = "degraded" as const;

  constructor(operation: string, cause: unknown) {
    super(`CRDT 복구 영속성이 저하되었습니다 (${operation}).`, { cause });
    this.name = "StudioCrdtRecoveryDurabilityError";
  }
}

export class StudioCrdtRecoveryCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioCrdtRecoveryCorruptionError";
  }
}

export interface StudioCrdtRecoveryVault {
  preserveRejectionMarker(
    input: PreserveStudioCrdtRejectionMarkerInput
  ): Promise<StudioCrdtPermanentRejectionMarker>;
  listRejectionMarkers(
    scope: string,
    workId: string
  ): Promise<StudioCrdtPermanentRejectionMarker[]>;
  preserve(input: PreserveStudioCrdtRecoveryFrontierInput): Promise<StudioCrdtRecoveryVaultEntry>;
  list(scope: string, workId: string): Promise<StudioCrdtRecoveryVaultEntry[]>;
  markExported(scope: string, workId: string, vaultId: string): Promise<void>;
}

interface StoredStudioCrdtRecoveryVaultEntry extends StudioCrdtRecoveryVaultEntry {
  key: string;
}

interface StoredStudioCrdtPermanentRejectionMarker
  extends StudioCrdtPermanentRejectionMarker {
  kind: "permanent-rejection";
  key: string;
}

interface StoredStudioCrdtRecoveryManifest {
  kind: "frontier-manifest";
  key: string;
  vaultId: string;
  scope: string;
  workId: string;
  status: StudioCrdtRecoveryVaultStatus;
  failureCode: string;
  failureMessage: string;
  rejectedUpdateId: string;
  chunkCount: number;
  updateCount: number;
  createdAt: number;
  exportedAt: number | null;
}

interface StoredStudioCrdtRecoveryChunk {
  kind: "frontier-chunk";
  key: string;
  vaultId: string;
  scope: string;
  workId: string;
  chunkIndex: number;
  updates: StudioCrdtUpdateRequest[];
}

type StoredStudioCrdtRecoveryRow =
  | StoredStudioCrdtRecoveryVaultEntry
  | StoredStudioCrdtPermanentRejectionMarker
  | StoredStudioCrdtRecoveryManifest
  | StoredStudioCrdtRecoveryChunk;

export interface StudioCrdtRecoveryVaultPersistence {
  list(scope: string, workId: string): Promise<unknown[]>;
  get(scope: string, workId: string, key: string): Promise<unknown | null>;
  put(entry: StoredStudioCrdtRecoveryRow): Promise<void>;
}

export interface StudioCrdtRecoveryBundle {
  format: "toonspectrum-crdt-recovery";
  version: typeof STUDIO_CRDT_RECOVERY_BUNDLE_VERSION;
  workId: string;
  exportedAt: string;
  frontiers: Array<{
    vaultId: string;
    failureCode: string;
    failureMessage: string;
    rejectedUpdateId: string;
    createdAt: string;
    updates: StudioCrdtUpdateRequest[];
  }>;
}

function safeString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function vaultKey(scope: string, workId: string, vaultId: string): string {
  return JSON.stringify([scope, workId, vaultId]);
}

function recoveryChunkKey(
  scope: string,
  workId: string,
  vaultId: string,
  chunkIndex: number
): string {
  return JSON.stringify([scope, workId, vaultId, "chunk", chunkIndex]);
}

function rejectionMarkerKey(scope: string, workId: string, rejectedUpdateId: string): string {
  return JSON.stringify(["permanent-rejection", scope, workId, rejectedUpdateId]);
}

function isStoredEntry(value: unknown): value is StoredStudioCrdtRecoveryVaultEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<StoredStudioCrdtRecoveryVaultEntry>;
  if (!(
    safeString(entry.vaultId, 128) &&
    safeString(entry.scope, 256) &&
    safeString(entry.workId, 128) &&
    (entry.status === "pending-export" || entry.status === "exported") &&
    safeString(entry.failureCode, 80) &&
    safeString(entry.failureMessage, 1_000) &&
    safeString(entry.rejectedUpdateId, 128) &&
    Number.isFinite(entry.createdAt) &&
    (entry.exportedAt === null || Number.isFinite(entry.exportedAt)) &&
    Array.isArray(entry.updates) &&
    entry.updates.length > 0 &&
    entry.updates.length <= LEGACY_MAX_FRONTIER_UPDATES &&
    typeof entry.key === "string" &&
    entry.key === vaultKey(entry.scope, entry.workId, entry.vaultId)
  )) return false;

  return entry.updates.every((candidate) =>
    parsePersistedStudioCrdtUpdateRequest(candidate, {
      expectedWorkId: entry.workId,
    }) !== null
  );
}

function isStoredManifest(value: unknown): value is StoredStudioCrdtRecoveryManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value as Partial<StoredStudioCrdtRecoveryManifest>;
  return (
    manifest.kind === "frontier-manifest" &&
    safeString(manifest.vaultId, 128) &&
    safeString(manifest.scope, 256) &&
    safeString(manifest.workId, 128) &&
    (manifest.status === "pending-export" || manifest.status === "exported") &&
    safeString(manifest.failureCode, 80) &&
    safeString(manifest.failureMessage, 1_000) &&
    safeString(manifest.rejectedUpdateId, 128) &&
    Number.isSafeInteger(manifest.chunkCount) &&
    (manifest.chunkCount ?? 0) > 0 &&
    Number.isSafeInteger(manifest.updateCount) &&
    (manifest.updateCount ?? 0) > 0 &&
    Number.isFinite(manifest.createdAt) &&
    (manifest.exportedAt === null || Number.isFinite(manifest.exportedAt)) &&
    manifest.key === vaultKey(manifest.scope, manifest.workId, manifest.vaultId)
  );
}

function isStoredChunk(value: unknown): value is StoredStudioCrdtRecoveryChunk {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const chunk = value as Partial<StoredStudioCrdtRecoveryChunk>;
  if (!(
    chunk.kind === "frontier-chunk" &&
    safeString(chunk.vaultId, 128) &&
    safeString(chunk.scope, 256) &&
    safeString(chunk.workId, 128) &&
    typeof chunk.chunkIndex === "number" &&
    Number.isSafeInteger(chunk.chunkIndex) &&
    chunk.chunkIndex >= 0 &&
    Array.isArray(chunk.updates) &&
    chunk.updates.length > 0 &&
    chunk.updates.length <= RECOVERY_CHUNK_MAX_UPDATES &&
    chunk.key === recoveryChunkKey(
      chunk.scope,
      chunk.workId,
      chunk.vaultId,
      chunk.chunkIndex
    )
  )) return false;
  return chunk.updates.every((candidate) =>
    parsePersistedStudioCrdtUpdateRequest(candidate, {
      expectedWorkId: chunk.workId,
    }) !== null
  );
}

function isStoredRejectionMarker(
  value: unknown
): value is StoredStudioCrdtPermanentRejectionMarker {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const marker = value as Partial<StoredStudioCrdtPermanentRejectionMarker>;
  return (
    marker.kind === "permanent-rejection" &&
    safeString(marker.scope, 256) &&
    safeString(marker.workId, 128) &&
    safeString(marker.failureCode, 80) &&
    safeString(marker.failureMessage, 1_000) &&
    safeString(marker.rejectedUpdateId, 128) &&
    Number.isSafeInteger(marker.recoveryUpdateCount) &&
    (marker.recoveryUpdateCount ?? 0) > 0 &&
    Number.isFinite(marker.createdAt) &&
    marker.key === rejectionMarkerKey(
      marker.scope,
      marker.workId,
      marker.rejectedUpdateId
    )
  );
}

function isKnownStoredRow(value: unknown): value is StoredStudioCrdtRecoveryRow {
  return isStoredEntry(value) || isStoredRejectionMarker(value) ||
    isStoredManifest(value) || isStoredChunk(value);
}

function chunkRecoveryRequests(
  updates: readonly StudioCrdtUpdateRequest[]
): StudioCrdtUpdateRequest[][] {
  const chunks: StudioCrdtUpdateRequest[][] = [];
  let current: StudioCrdtUpdateRequest[] = [];
  let currentCharacters = 2;
  for (const request of updates) {
    const requestCharacters = JSON.stringify(request).length + (current.length > 0 ? 1 : 0);
    if (
      current.length > 0 &&
      (current.length >= RECOVERY_CHUNK_MAX_UPDATES ||
        currentCharacters + requestCharacters > RECOVERY_CHUNK_MAX_JSON_CHARS)
    ) {
      chunks.push(current);
      current = [];
      currentCharacters = 2;
    }
    current.push(request);
    currentCharacters += requestCharacters;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function publicRejectionMarker(
  marker: StoredStudioCrdtPermanentRejectionMarker
): StudioCrdtPermanentRejectionMarker {
  return {
    scope: marker.scope,
    workId: marker.workId,
    failureCode: marker.failureCode,
    failureMessage: marker.failureMessage,
    rejectedUpdateId: marker.rejectedUpdateId,
    recoveryUpdateCount: marker.recoveryUpdateCount,
    createdAt: marker.createdAt,
  };
}

const samePageRejectionMarkers = new Map<
  string,
  StoredStudioCrdtPermanentRejectionMarker
>();

class SamePageStudioCrdtRejectionMarkerLatch
implements StudioCrdtRejectionMarkerEphemeralLatch {
  preserve(marker: StudioCrdtPermanentRejectionMarker): void {
    const stored: StoredStudioCrdtPermanentRejectionMarker = {
      ...marker,
      kind: "permanent-rejection",
      key: rejectionMarkerKey(marker.scope, marker.workId, marker.rejectedUpdateId),
    };
    samePageRejectionMarkers.set(stored.key, stored);
  }

  list(scope: string, workId: string): unknown[] {
    return [...samePageRejectionMarkers.values()].filter(
      (marker) => marker.scope === scope && marker.workId === workId
    );
  }
}

function publicEntry(entry: StoredStudioCrdtRecoveryVaultEntry): StudioCrdtRecoveryVaultEntry {
  return {
    vaultId: entry.vaultId,
    scope: entry.scope,
    workId: entry.workId,
    status: entry.status,
    failureCode: entry.failureCode,
    failureMessage: entry.failureMessage,
    rejectedUpdateId: entry.rejectedUpdateId,
    updates: entry.updates.map((request) => {
      const parsed = parsePersistedStudioCrdtUpdateRequest(request, {
        expectedWorkId: entry.workId,
      });
      if (!parsed) throw new Error("CRDT 복구 frontier 업데이트가 손상되었습니다.");
      return parsed;
    }),
    createdAt: entry.createdAt,
    exportedAt: entry.exportedAt,
  };
}

function recoverySqlRowKind(row: StoredStudioCrdtRecoveryRow): StudioCrdtRecoverySqlRowKind {
  if (isStoredEntry(row)) return "legacy-frontier";
  return row.kind;
}

function parseRecoverySqlCandidate(
  candidate: StudioCrdtRecoverySqlCandidate,
  scope: string,
  workId: string,
): StoredStudioCrdtRecoveryRow {
  if (
    candidate.scope !== scope ||
    candidate.workId !== workId ||
    !safeString(candidate.rowKey, 8_192) ||
    !safeString(candidate.payload, STUDIO_CRDT_RECOVERY_MAX_ROW_BYTES) ||
    !Number.isSafeInteger(candidate.payloadBytes) ||
    (candidate.payloadBytes as number) <= 0 ||
    !Number.isSafeInteger(candidate.updatedAt) ||
    (candidate.updatedAt as number) < 0 ||
    new TextEncoder().encode(candidate.payload as string).byteLength !== candidate.payloadBytes
  ) {
    throw new StudioCrdtRecoveryCorruptionError(
      "CRDT SQLite 복구 행의 구조 또는 byte count가 손상되었습니다.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.payload as string);
  } catch {
    throw new StudioCrdtRecoveryCorruptionError(
      "CRDT SQLite 복구 행의 JSON이 손상되었습니다.",
    );
  }
  if (
    !isKnownStoredRow(parsed) ||
    parsed.scope !== scope ||
    parsed.workId !== workId ||
    parsed.key !== candidate.rowKey ||
    recoverySqlRowKind(parsed) !== candidate.rowKind
  ) {
    throw new StudioCrdtRecoveryCorruptionError(
      "CRDT SQLite 복구 행의 identity 또는 payload가 손상되었습니다.",
    );
  }
  return parsed;
}

async function acquireRecoveryDatabase(
  acquireDatabase: () => Promise<StudioLocalDatabase>,
  operation: string,
): Promise<StudioCrdtRecoveryDatabase> {
  try {
    return requireStudioCrdtRecoveryDatabase(await acquireDatabase());
  } catch (error) {
    throw new StudioCrdtRecoveryDurabilityError(operation, error);
  }
}

export function createStudioCrdtRecoverySqlitePersistence(
  acquireDatabase: () => Promise<StudioLocalDatabase> = acquireStudioLocalDatabase
): StudioCrdtRecoveryVaultPersistence {
  return {
    async list(scope, workId) {
      const database = await acquireRecoveryDatabase(acquireDatabase, "scoped list");
      let candidates: StudioCrdtRecoverySqlCandidate[];
      try {
        candidates = await database.listCrdtRecoveryCandidates(scope, workId);
      } catch (error) {
        throw new StudioCrdtRecoveryDurabilityError("scoped list", error);
      }
      return candidates.map((candidate) => parseRecoverySqlCandidate(candidate, scope, workId));
    },
    async get(scope, workId, key) {
      const database = await acquireRecoveryDatabase(acquireDatabase, "row read");
      let candidate: StudioCrdtRecoverySqlCandidate | null;
      try {
        candidate = await database.getCrdtRecoveryCandidate(scope, workId, key);
      } catch (error) {
        throw new StudioCrdtRecoveryDurabilityError("row read", error);
      }
      return candidate === null ? null : parseRecoverySqlCandidate(candidate, scope, workId);
    },
    async put(entry) {
      const payload = JSON.stringify(entry);
      const payloadBytes = new TextEncoder().encode(payload).byteLength;
      const database = await acquireRecoveryDatabase(acquireDatabase, "row commit");
      try {
        await database.putCrdtRecoveryRecord({
          scope: entry.scope,
          workId: entry.workId,
          rowKey: entry.key,
          rowKind: recoverySqlRowKind(entry),
          payload,
          payloadBytes,
        }, {
          maxRows: STUDIO_CRDT_RECOVERY_MAX_ROWS_PER_WORK,
          maxBytes: STUDIO_CRDT_RECOVERY_MAX_BYTES_PER_WORK,
          maxRowBytes: STUDIO_CRDT_RECOVERY_MAX_ROW_BYTES,
        });
      } catch (error) {
        throw new StudioCrdtRecoveryDurabilityError("row commit", error);
      }
    },
  };
}

function randomVaultId(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("안전한 CRDT 복구 저장소 식별자를 만들 수 없습니다.");
  }
  return crypto.randomUUID();
}

/**
 * Durable, non-retrying storage for optimistic Yjs frontiers rejected by the authoritative server.
 * Entries remain separate from the resend outbox so opening the work cannot silently replay them.
 */
export class PersistentStudioCrdtRecoveryVault implements StudioCrdtRecoveryVault {
  constructor(
    private readonly persistence: StudioCrdtRecoveryVaultPersistence =
      createStudioCrdtRecoverySqlitePersistence(),
    private readonly now: () => number = Date.now,
    private readonly randomId: () => string = randomVaultId,
    private readonly markerLatch: StudioCrdtRejectionMarkerEphemeralLatch =
      new SamePageStudioCrdtRejectionMarkerLatch()
  ) {}

  async preserveRejectionMarker(
    input: PreserveStudioCrdtRejectionMarkerInput
  ): Promise<StudioCrdtPermanentRejectionMarker> {
    const scope = input.scope.trim();
    const workId = input.workId.trim();
    if (!(
      scope && workId &&
      safeString(input.failureCode, 80) &&
      safeString(input.failureMessage, 1_000) &&
      safeString(input.rejectedUpdateId, 128) &&
      Number.isSafeInteger(input.recoveryUpdateCount) &&
      input.recoveryUpdateCount > 0
    )) {
      throw new Error("보존할 CRDT 영구 거절 표식이 잘못되었습니다.");
    }
    const marker: StudioCrdtPermanentRejectionMarker = {
      scope,
      workId,
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
      rejectedUpdateId: input.rejectedUpdateId,
      recoveryUpdateCount: input.recoveryUpdateCount,
      createdAt: this.now(),
    };
    // Lock this page before the asynchronous durable write. The latch is never returned as
    // durable success: a failed SQLite commit still rejects and drives degraded product status.
    this.markerLatch.preserve(marker);
    const stored: StoredStudioCrdtPermanentRejectionMarker = {
      ...marker,
      kind: "permanent-rejection",
      key: rejectionMarkerKey(scope, workId, input.rejectedUpdateId),
    };
    await this.persistence.put(stored);
    return { ...marker };
  }

  async listRejectionMarkers(
    scope: string,
    workId: string
  ): Promise<StudioCrdtPermanentRejectionMarker[]> {
    const rows = [
      ...(await this.persistence.list(scope, workId)),
      ...this.markerLatch.list(scope, workId),
    ];
    if (rows.some((row) => !isKnownStoredRow(row))) {
      throw new Error("CRDT 복구 저장소의 영구 거절 표식이 손상되었습니다.");
    }
    const markers = new Map<string, StoredStudioCrdtPermanentRejectionMarker>();
    for (const row of rows) {
      if (isStoredRejectionMarker(row)) markers.set(row.key, row);
    }
    return [...markers.values()]
      .sort((left, right) =>
        left.createdAt - right.createdAt ||
        left.rejectedUpdateId.localeCompare(right.rejectedUpdateId)
      )
      .map(publicRejectionMarker);
  }

  async preserve(
    input: PreserveStudioCrdtRecoveryFrontierInput
  ): Promise<StudioCrdtRecoveryVaultEntry> {
    const scope = input.scope.trim();
    const workId = input.workId.trim();
    if (!scope || !workId || input.updates.length === 0) {
      throw new Error("보존할 CRDT 복구 frontier가 없습니다.");
    }
    const updates = input.updates.map((request) => {
      const parsed = parseStudioCrdtUpdateRequest(request, { expectedWorkId: workId });
      if (!parsed) throw new Error("CRDT 복구 frontier에 잘못된 업데이트가 있습니다.");
      return parsed;
    });
    const existing = (await this.list(scope, workId)).find((entry) =>
      entry.updates.some(({ updateId }) => updateId === input.rejectedUpdateId)
    );
    if (existing) return existing;

    const vaultId = this.randomId();
    const createdAt = this.now();
    const chunks = chunkRecoveryRequests(updates);
    for (const [chunkIndex, chunkUpdates] of chunks.entries()) {
      await this.persistence.put({
        kind: "frontier-chunk",
        key: recoveryChunkKey(scope, workId, vaultId, chunkIndex),
        vaultId,
        scope,
        workId,
        chunkIndex,
        updates: chunkUpdates,
      });
    }
    // The manifest commits last. A crash during chunk writes therefore cannot expose a partial
    // frontier as exportable; the permanent-rejection marker keeps the resend outbox locked.
    const stored: StoredStudioCrdtRecoveryManifest = {
      kind: "frontier-manifest",
      key: vaultKey(scope, workId, vaultId),
      vaultId,
      scope,
      workId,
      status: "pending-export",
      failureCode: input.failureCode.slice(0, 80),
      failureMessage: input.failureMessage.slice(0, 1_000),
      rejectedUpdateId: input.rejectedUpdateId,
      chunkCount: chunks.length,
      updateCount: updates.length,
      createdAt,
      exportedAt: null,
    };
    await this.persistence.put(stored);
    return {
      vaultId,
      scope,
      workId,
      status: "pending-export",
      failureCode: stored.failureCode,
      failureMessage: stored.failureMessage,
      rejectedUpdateId: stored.rejectedUpdateId,
      updates: updates.map((request) => ({ ...request })),
      createdAt,
      exportedAt: null,
    };
  }

  async list(scope: string, workId: string): Promise<StudioCrdtRecoveryVaultEntry[]> {
    const rows = await this.persistence.list(scope, workId);
    if (rows.some((row) => !isKnownStoredRow(row))) {
      // Silently dropping a damaged recovery record could make its matching resend row eligible
      // again. Treat any scoped corruption as a terminal read failure so the binding fails closed.
      throw new Error("CRDT 복구 저장소에 손상된 frontier가 있어 원고를 안전하게 열 수 없습니다.");
    }
    const entries = rows.filter(isStoredEntry).map(publicEntry);
    const manifests = rows.filter(isStoredManifest);
    const manifestVaultIds = new Set(manifests.map(({ vaultId }) => vaultId));
    if (rows.filter(isStoredChunk).some(({ vaultId }) => !manifestVaultIds.has(vaultId))) {
      throw new Error("CRDT 복구 frontier manifest가 누락되어 원고를 안전하게 열 수 없습니다.");
    }
    const chunksByVault = new Map<string, StoredStudioCrdtRecoveryChunk[]>();
    for (const chunk of rows.filter(isStoredChunk)) {
      const existing = chunksByVault.get(chunk.vaultId) ?? [];
      existing.push(chunk);
      chunksByVault.set(chunk.vaultId, existing);
    }
    for (const manifest of manifests) {
      const chunks = (chunksByVault.get(manifest.vaultId) ?? []).sort(
        (left, right) => left.chunkIndex - right.chunkIndex
      );
      if (
        chunks.length !== manifest.chunkCount ||
        chunks.some((chunk, index) => chunk.chunkIndex !== index) ||
        chunks.reduce((sum, chunk) => sum + chunk.updates.length, 0) !== manifest.updateCount
      ) {
        throw new Error("CRDT 복구 frontier 조각이 누락되어 원고를 안전하게 열 수 없습니다.");
      }
      entries.push({
        vaultId: manifest.vaultId,
        scope: manifest.scope,
        workId: manifest.workId,
        status: manifest.status,
        failureCode: manifest.failureCode,
        failureMessage: manifest.failureMessage,
        rejectedUpdateId: manifest.rejectedUpdateId,
        updates: chunks.flatMap((chunk) => chunk.updates.map((request) => {
          const parsed = parsePersistedStudioCrdtUpdateRequest(request, {
            expectedWorkId: manifest.workId,
          });
          if (!parsed) throw new Error("CRDT 복구 frontier 업데이트가 손상되었습니다.");
          return parsed;
        })),
        createdAt: manifest.createdAt,
        exportedAt: manifest.exportedAt,
      });
    }
    return entries.sort((left, right) =>
      left.createdAt - right.createdAt || left.vaultId.localeCompare(right.vaultId)
    );
  }

  async markExported(scope: string, workId: string, vaultId: string): Promise<void> {
    const key = vaultKey(scope, workId, vaultId);
    const value = await this.persistence.get(scope, workId, key);
    if (
      !(isStoredEntry(value) || isStoredManifest(value)) ||
      value.scope !== scope ||
      value.workId !== workId
    ) {
      throw new Error("내보낼 CRDT 복구 frontier를 찾지 못했습니다.");
    }
    if (value.status === "exported") return;
    await this.persistence.put({
      ...value,
      status: "exported",
      exportedAt: this.now(),
    });
  }
}

export function createStudioCrdtRecoveryVault(): StudioCrdtRecoveryVault {
  return new PersistentStudioCrdtRecoveryVault();
}

export function createStudioCrdtRecoveryBundle(
  entries: readonly StudioCrdtRecoveryVaultEntry[],
  exportedAt = Date.now()
): StudioCrdtRecoveryBundle {
  if (entries.length === 0) throw new Error("내보낼 CRDT 복구 frontier가 없습니다.");
  const workId = entries[0]?.workId ?? "";
  if (!workId || entries.some((entry) => entry.workId !== workId)) {
    throw new Error("서로 다른 작품의 CRDT 복구 frontier는 한 파일로 내보낼 수 없습니다.");
  }
  return {
    format: "toonspectrum-crdt-recovery",
    version: STUDIO_CRDT_RECOVERY_BUNDLE_VERSION,
    workId,
    exportedAt: new Date(exportedAt).toISOString(),
    frontiers: entries.map((entry) => ({
      vaultId: entry.vaultId,
      failureCode: entry.failureCode,
      failureMessage: entry.failureMessage,
      rejectedUpdateId: entry.rejectedUpdateId,
      createdAt: new Date(entry.createdAt).toISOString(),
      updates: entry.updates.map((request) => ({ ...request })),
    })),
  };
}

export function studioCrdtRecoveryBundleFileName(workId: string, now = Date.now()): string {
  const date = new Date(now).toISOString().replaceAll(":", "-").replace(".000Z", "Z");
  const safeWorkId = workId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 64) || "work";
  return `toonspectrum-${safeWorkId}-crdt-recovery-${date}.json`;
}

/**
 * Always export the complete work-scoped recovery archive. Updating each IndexedDB manifest's
 * status is not atomic with the browser download; if one status write fails, selecting only the
 * remaining pending rows on retry could produce a partial archive and then allow a destructive
 * reload. A browser download is also not proof that the user still has the earlier file.
 */
export function selectStudioCrdtRecoveryEntriesForDownload(
  entries: readonly StudioCrdtRecoveryVaultEntry[]
): StudioCrdtRecoveryVaultEntry[] {
  return entries.map((entry) => ({
    ...entry,
    updates: entry.updates.map((request) => ({ ...request })),
  }));
}

export async function downloadStudioCrdtRecoveryBundle(options: {
  vault: StudioCrdtRecoveryVault;
  scope: string;
  workId: string;
}): Promise<{ fileName: string; frontierCount: number; updateCount: number }> {
  const entries = selectStudioCrdtRecoveryEntriesForDownload(
    await options.vault.list(options.scope, options.workId)
  );
  const bundle = createStudioCrdtRecoveryBundle(entries);
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("이 환경에서는 CRDT 복구 파일을 내려받을 수 없습니다.");
  }
  const fileName = studioCrdtRecoveryBundleFileName(options.workId);
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json;charset=utf-8",
  }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = "noopener";
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
  await Promise.all(entries.map((entry) =>
    options.vault.markExported(options.scope, options.workId, entry.vaultId)
  ));
  return {
    fileName,
    frontierCount: entries.length,
    updateCount: entries.reduce((sum, entry) => sum + entry.updates.length, 0),
  };
}
