import {
  StudioCrdtOutboxSqlCapacityError,
  requireStudioCrdtOutboxDatabase,
} from "../studio-local-database";
import { acquireStudioLocalDatabase } from "../studio-local-database-runtime";

import {
  parsePersistedStudioCrdtUpdateRequest,
  type StudioCrdtUpdateRequest,
} from "./studio-crdt-protocol";

import type {
  StudioCrdtOutboxDatabase,
  StudioCrdtOutboxSqlCandidate,
  StudioLocalDatabase,
} from "../studio-local-database";

const LEGACY_DATABASE_NAME = "toonspectrum-studio-crdt-outbox";
const LEGACY_DATABASE_VERSION = 1;
const LEGACY_STORE_NAME = "pending-updates";
const LEGACY_SCOPE_WORK_INDEX = "scope-work";
const DEFAULT_OPERATION_TIMEOUT_MS = 1_500;
const CIRCUIT_BREAKER_COOLDOWN_MS = 5_000;
export const STUDIO_CRDT_OUTBOX_MAX_ENTRIES_PER_WORK = 65_536;
export const STUDIO_CRDT_OUTBOX_MAX_BYTES_PER_WORK = 256 * 1024 * 1024;
export const STUDIO_CRDT_OUTBOX_MAX_REQUEST_BYTES = 96 * 1024;
const MAX_SCOPE_LENGTH = 256;
const MAX_RETRY_ERROR_CODE_LENGTH = 160;
const MAX_RETRY_ERROR_MESSAGE_LENGTH = 2_048;
const TEXT_ENCODER = new TextEncoder();
const memoryRows = new Map<string, StoredStudioCrdtUpdate>();
const memoryUsage = new Map<string, { entries: number; bytes: number }>();
const operationTails = new Map<string, Promise<void>>();
const unhealthyUntil = new Map<string, number>();
const emergencyAcknowledgedUpdates = new Set<string>();
const emergencyActivePuts = new Map<string, number>();

interface StoredStudioCrdtUpdate {
  kind?: "update";
  key: string;
  scope: string;
  workId: string;
  updateId: string;
  clientSequence: number;
  request: StudioCrdtUpdateRequest;
  createdAt: number;
  payloadBytes?: number;
  /** Same-page only; the durable provider is authoritative regardless of this advisory flag. */
  durable?: boolean;
}

interface StoredStudioCrdtTombstone {
  kind: "tombstone";
  key: string;
  scope: string;
  workId: string;
  updateId: string;
  createdAt: number;
}

type StoredStudioCrdtRow = StoredStudioCrdtUpdate | StoredStudioCrdtTombstone;

interface StudioCrdtOutboxPersistenceAdapter {
  list(scope: string, workId: string): Promise<unknown[]>;
  put(row: StoredStudioCrdtRow): Promise<void>;
  delete(keys: readonly string[]): Promise<void>;
}

export interface StudioCrdtOutboxStatus {
  state: "durable" | "degraded";
  message: string;
}

export interface StudioCrdtOutbox {
  list(scope: string, workId: string): Promise<StudioCrdtUpdateRequest[]>;
  /** Same-tab emergency path used when the durable provider is unavailable or wedged. */
  listEmergency?(scope: string, workId: string): StudioCrdtUpdateRequest[];
  putEmergency?(scope: string, request: StudioCrdtUpdateRequest): void;
  put(scope: string, request: StudioCrdtUpdateRequest): Promise<void>;
  removeEmergency?(scope: string, workId: string, updateId: string): void;
  remove(scope: string, workId: string, updateId: string): Promise<void>;
  /** Persists retry diagnostics without changing queue order or publication identity. */
  recordRetry?(
    scope: string,
    workId: string,
    updateId: string,
    metadata: StudioCrdtOutboxRetryMetadata,
  ): Promise<void>;
  /** Lets the binding keep a persistent, user-visible durability warning after a fallback. */
  getStatus?(): StudioCrdtOutboxStatus;
}

export interface StudioCrdtOutboxRetryMetadata {
  attemptCount: number;
  attemptedAt: number;
  nextRetryAt: number;
  errorCode: string;
  errorMessage: string;
}

interface SerializedDelegateState {
  acknowledgedUpdates: Set<string>;
  activePuts: Map<string, number>;
}

const serializedDelegateStates = new WeakMap<StudioCrdtOutbox, SerializedDelegateState>();

function serializedDelegateState(delegate: StudioCrdtOutbox): SerializedDelegateState {
  const existing = serializedDelegateStates.get(delegate);
  if (existing) return existing;
  const created: SerializedDelegateState = {
    acknowledgedUpdates: new Set(),
    activePuts: new Map(),
  };
  serializedDelegateStates.set(delegate, created);
  return created;
}

export class StudioCrdtOutboxUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StudioCrdtOutboxUnavailableError";
  }
}

/** Durable rows could exist but could not be enumerated, so an emergency subset is insufficient. */
export class StudioCrdtOutboxReadUnavailableError extends StudioCrdtOutboxUnavailableError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StudioCrdtOutboxReadUnavailableError";
  }
}

export class StudioCrdtOutboxTimeoutError extends StudioCrdtOutboxUnavailableError {
  constructor() {
    super("CRDT outbox 작업 시간이 초과됐습니다.");
    this.name = "StudioCrdtOutboxTimeoutError";
  }
}

/** A scoped row exists but cannot be trusted; falling back to an empty snapshot would lose work. */
export class StudioCrdtOutboxCorruptionError extends Error {
  constructor() {
    super("CRDT outbox에 손상된 미승인 변경이 있어 원고를 안전하게 열 수 없습니다.");
    this.name = "StudioCrdtOutboxCorruptionError";
  }
}

/** Queue limit is explicit backpressure; no existing or incoming message is silently evicted. */
export class StudioCrdtOutboxCapacityError extends Error {
  readonly entryCount: number;
  readonly totalBytes: number;

  constructor(entryCount: number, totalBytes: number) {
    super(
      `CRDT outbox 한도를 초과했습니다(${entryCount}개, ${totalBytes}바이트). ` +
        "기존 변경은 삭제하지 않았습니다.",
    );
    this.name = "StudioCrdtOutboxCapacityError";
    this.entryCount = entryCount;
    this.totalBytes = totalBytes;
  }
}

function assertScope(scope: string): void {
  if (typeof scope !== "string") {
    throw new Error("CRDT outbox scope가 문자열이 아닙니다.");
  }
  const hasControlCharacter = [...scope].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (
    scope.length === 0 ||
    scope.length > MAX_SCOPE_LENGTH ||
    hasControlCharacter
  ) {
    throw new Error("CRDT outbox scope가 비어 있거나 허용 길이·문자 범위를 벗어났습니다.");
  }
}

function serializeRequest(request: StudioCrdtUpdateRequest): {
  payload: string;
  payloadBytes: number;
} {
  const parsed = parsePersistedStudioCrdtUpdateRequest(request, {
    expectedWorkId: request.workId,
  });
  if (parsed === null) throw new StudioCrdtOutboxCorruptionError();
  const payload = JSON.stringify(parsed);
  const payloadBytes = TEXT_ENCODER.encode(payload).byteLength;
  if (payloadBytes <= 0 || payloadBytes > STUDIO_CRDT_OUTBOX_MAX_REQUEST_BYTES) {
    throw new StudioCrdtOutboxCapacityError(1, payloadBytes);
  }
  return { payload, payloadBytes };
}

function assertRetryMetadata(metadata: StudioCrdtOutboxRetryMetadata): void {
  if (
    !Number.isSafeInteger(metadata.attemptCount) ||
    metadata.attemptCount <= 0 ||
    !Number.isSafeInteger(metadata.attemptedAt) ||
    metadata.attemptedAt < 0 ||
    !Number.isSafeInteger(metadata.nextRetryAt) ||
    metadata.nextRetryAt < metadata.attemptedAt ||
    metadata.errorCode.length === 0 ||
    metadata.errorCode.length > MAX_RETRY_ERROR_CODE_LENGTH ||
    metadata.errorMessage.length === 0 ||
    metadata.errorMessage.length > MAX_RETRY_ERROR_MESSAGE_LENGTH
  ) {
    throw new Error("CRDT outbox retry metadata가 허용 범위를 벗어났습니다.");
  }
}

function isSqliteCorruption(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /SQLITE_CORRUPT|database disk image is malformed|malformed database schema/iu.test(
    message,
  );
}

function outboxKey(scope: string, workId: string, updateId: string): string {
  return JSON.stringify([scope, workId, updateId]);
}

function scopeWorkKey(scope: string, workId: string): string {
  return JSON.stringify([scope, workId]);
}

function removeMemoryRow(key: string): void {
  const row = memoryRows.get(key);
  if (!row) return;
  memoryRows.delete(key);
  const usageKey = scopeWorkKey(row.scope, row.workId);
  const current = memoryUsage.get(usageKey);
  if (!current) return;
  const next = {
    entries: Math.max(0, current.entries - 1),
    bytes: Math.max(0, current.bytes - (row.payloadBytes ?? serializeRequest(row.request).payloadBytes)),
  };
  if (next.entries === 0) memoryUsage.delete(usageKey);
  else memoryUsage.set(usageKey, next);
}

function putMemoryRow(scope: string, request: StudioCrdtUpdateRequest): void {
  assertScope(scope);
  const key = outboxKey(scope, request.workId, request.updateId);
  if (emergencyAcknowledgedUpdates.has(key)) return;
  const { payloadBytes } = serializeRequest(request);
  const existing = memoryRows.get(key);
  const usageKey = scopeWorkKey(scope, request.workId);
  const usage = memoryUsage.get(usageKey) ?? { entries: 0, bytes: 0 };
  const entryCount = usage.entries + (existing ? 0 : 1);
  const totalBytes = usage.bytes - (existing?.payloadBytes ?? 0) + payloadBytes;
  if (
    entryCount > STUDIO_CRDT_OUTBOX_MAX_ENTRIES_PER_WORK ||
    totalBytes > STUDIO_CRDT_OUTBOX_MAX_BYTES_PER_WORK
  ) {
    throw new StudioCrdtOutboxCapacityError(entryCount, totalBytes);
  }
  memoryRows.set(key, {
    kind: "update",
    key,
    scope,
    workId: request.workId,
    updateId: request.updateId,
    clientSequence: request.clientSequence,
    request: { ...request },
    createdAt: existing?.createdAt ?? Date.now(),
    payloadBytes,
    durable: existing?.durable ?? false,
  });
  memoryUsage.set(usageKey, { entries: entryCount, bytes: totalBytes });
}

function isCircuitOpen(key: string): boolean {
  const until = unhealthyUntil.get(key) ?? 0;
  if (until > Date.now()) return true;
  if (until > 0) unhealthyUntil.delete(key);
  return false;
}

function openCircuit(key: string): void {
  unhealthyUntil.set(key, Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS);
}

function filterAcknowledged(
  acknowledgedUpdates: ReadonlySet<string>,
  scope: string,
  workId: string,
  requests: readonly StudioCrdtUpdateRequest[]
): StudioCrdtUpdateRequest[] {
  return requests.filter(
    (request) => !acknowledgedUpdates.has(outboxKey(scope, workId, request.updateId))
  );
}

function scopedMemoryRows(scope: string, workId: string): StoredStudioCrdtUpdate[] {
  return [...memoryRows.values()].filter(
    (row) => row.scope === scope && row.workId === workId
  );
}

function serializeOutboxOperation<T>(
  scope: string,
  workId: string,
  operation: () => Promise<T>,
  timeoutMs: number,
  scheduleTimeout: (handler: () => void, delay: number) => unknown,
  cancelTimeout: (handle: unknown) => void,
  allowWhileCircuitOpen = false
): Promise<T> {
  const key = scopeWorkKey(scope, workId);
  const previous = operationTails.get(key) ?? Promise.resolve();
  const result = previous.then(() => {
    if (!allowWhileCircuitOpen && isCircuitOpen(key)) {
      throw new StudioCrdtOutboxUnavailableError("CRDT outbox가 복구 대기 중입니다.");
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let timeoutHandle: unknown = null;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle !== null) cancelTimeout(timeoutHandle);
        callback();
      };
      timeoutHandle = scheduleTimeout(
        () => finish(() => {
          openCircuit(key);
          reject(new StudioCrdtOutboxTimeoutError());
        }),
        timeoutMs
      );
      void Promise.resolve().then(operation).then(
        (value) => finish(() => {
          unhealthyUntil.delete(key);
          resolve(value);
        }),
        (error: unknown) => finish(() => {
          openCircuit(key);
          reject(error);
        })
      );
    });
  });
  const tail = result.then(
    () => undefined,
    () => undefined
  );
  operationTails.set(key, tail);
  void tail.then(() => {
    if (operationTails.get(key) === tail) operationTails.delete(key);
  });
  return result;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 요청이 실패했습니다."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB 작업이 취소되었습니다."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB 작업이 실패했습니다."));
  });
}

let databasePromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (databasePromise) return databasePromise;
  const factory = globalThis.indexedDB;
  if (!factory) return Promise.resolve(null);
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(LEGACY_DATABASE_NAME, LEGACY_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(LEGACY_STORE_NAME)
        ? request.transaction?.objectStore(LEGACY_STORE_NAME)
        : database.createObjectStore(LEGACY_STORE_NAME, { keyPath: "key" });
      if (store && !store.indexNames.contains(LEGACY_SCOPE_WORK_INDEX)) {
        store.createIndex(LEGACY_SCOPE_WORK_INDEX, ["scope", "workId"], { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("CRDT outbox를 열지 못했습니다."));
    request.onblocked = () => reject(new Error("CRDT outbox 업그레이드가 다른 탭에 의해 차단됐습니다."));
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

function isStoredUpdate(value: unknown): value is StoredStudioCrdtUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<StoredStudioCrdtUpdate>;
  if (!(
    (row.kind === undefined || row.kind === "update") &&
    typeof row.key === "string" &&
    typeof row.scope === "string" &&
    typeof row.workId === "string" &&
    typeof row.updateId === "string" &&
    typeof row.clientSequence === "number" &&
    Number.isSafeInteger(row.clientSequence) &&
    typeof row.createdAt === "number" &&
    Number.isFinite(row.createdAt)
  )) return false;
  const parsed = parsePersistedStudioCrdtUpdateRequest(row.request, {
    expectedWorkId: row.workId,
  });
  return (
    parsed !== null &&
    parsed.updateId === row.updateId &&
    parsed.clientSequence === row.clientSequence &&
    row.key === outboxKey(row.scope, row.workId, row.updateId)
  );
}

function isStoredTombstone(value: unknown): value is StoredStudioCrdtTombstone {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<StoredStudioCrdtTombstone>;
  return (
    row.kind === "tombstone" &&
    typeof row.key === "string" &&
    typeof row.scope === "string" &&
    typeof row.workId === "string" &&
    typeof row.updateId === "string" &&
    typeof row.createdAt === "number" &&
    Number.isFinite(row.createdAt) &&
    row.key === outboxKey(row.scope, row.workId, row.updateId)
  );
}

function requestsFromStoredRows(
  rows: Iterable<StoredStudioCrdtUpdate>,
  workId: string
): StudioCrdtUpdateRequest[] {
  return [...rows]
    .sort(
      (left, right) =>
        left.clientSequence - right.clientSequence ||
        left.createdAt - right.createdAt ||
        left.updateId.localeCompare(right.updateId)
    )
    .map((row) => parsePersistedStudioCrdtUpdateRequest(row.request, {
      expectedWorkId: workId,
    }))
    .filter((request): request is StudioCrdtUpdateRequest => request !== null);
}

/**
 * 명시적 legacy import/test seam. 제품 부팅 경로는 이 클래스를 생성하거나 이전 IDB를
 * 자동으로 읽지 않는다(LEGACY_DATA_MIGRATION=FALSE).
 */
export class LegacyIndexedDbStudioCrdtOutbox implements StudioCrdtOutbox {
  private status: StudioCrdtOutboxStatus = {
    state: "durable",
    message: "오프라인 CRDT 보관함이 정상입니다.",
  };

  constructor(private readonly persistence?: StudioCrdtOutboxPersistenceAdapter) {}

  getStatus(): StudioCrdtOutboxStatus {
    return { ...this.status };
  }

  private markDurable(): void {
    this.status = { state: "durable", message: "오프라인 CRDT 보관함이 정상입니다." };
  }

  private markDegraded(error: unknown): void {
    this.status = {
      state: "degraded",
      message:
        error instanceof Error && error.message.trim()
          ? error.message
          : "오프라인 CRDT 보관함을 사용할 수 없어 같은 탭의 긴급 사본을 사용합니다.",
    };
  }

  private refreshMemoryDurability(scope: string, workId: string): void {
    if (scopedMemoryRows(scope, workId).some((row) => row.durable !== true)) {
      this.markDegraded(
        new StudioCrdtOutboxUnavailableError(
          "일부 오프라인 변경은 아직 같은 탭의 긴급 사본에만 보관되어 있습니다."
        )
      );
    } else {
      this.markDurable();
    }
  }

  listEmergency(scope: string, workId: string): StudioCrdtUpdateRequest[] {
    return filterAcknowledged(
      emergencyAcknowledgedUpdates,
      scope,
      workId,
      requestsFromStoredRows(scopedMemoryRows(scope, workId), workId)
    );
  }

  putEmergency(scope: string, request: StudioCrdtUpdateRequest): void {
    putMemoryRow(scope, request);
  }

  removeEmergency(scope: string, workId: string, updateId: string): void {
    const key = outboxKey(scope, workId, updateId);
    emergencyAcknowledgedUpdates.add(key);
    removeMemoryRow(key);
  }

  async list(scope: string, workId: string): Promise<StudioCrdtUpdateRequest[]> {
    let storedRows: unknown[];
    try {
      storedRows = await this.listStoredRows(scope, workId);
      if (storedRows.some((row) => !isStoredUpdate(row) && !isStoredTombstone(row))) {
        throw new StudioCrdtOutboxCorruptionError();
      }
      this.refreshMemoryDurability(scope, workId);
    } catch (error) {
      if (error instanceof StudioCrdtOutboxCorruptionError) throw error;
      this.markDegraded(error);
      return this.listEmergency(scope, workId);
    }
    // Legacy seam only: keep a same-page copy until ACK so explicit imports/tests preserve the
    // historical replacement-binding and failed-transaction behaviour.
    const mergedRows = new Map<string, StoredStudioCrdtUpdate>();
    const tombstoneKeys = new Set(
      storedRows.filter(isStoredTombstone).map((row) => row.key)
    );
    for (const row of storedRows) {
      if (isStoredUpdate(row) && !tombstoneKeys.has(row.key)) mergedRows.set(row.key, row);
    }
    const staleTombstoneKeys = [...tombstoneKeys].filter(
      (key) => !emergencyActivePuts.has(key)
    );
    if (staleTombstoneKeys.length > 0) {
      try {
        await this.deleteStoredRows(staleTombstoneKeys);
        for (const key of staleTombstoneKeys) emergencyAcknowledgedUpdates.delete(key);
      } catch (error) {
        this.markDegraded(error);
      }
    }
    for (const row of scopedMemoryRows(scope, workId)) mergedRows.set(row.key, row);
    return filterAcknowledged(
      emergencyAcknowledgedUpdates,
      scope,
      workId,
      requestsFromStoredRows(mergedRows.values(), workId)
    );
  }

  async put(scope: string, request: StudioCrdtUpdateRequest): Promise<void> {
    this.putEmergency(scope, request);
    const key = outboxKey(scope, request.workId, request.updateId);
    const row = memoryRows.get(key);
    if (!row) throw new Error("CRDT outbox 긴급 사본을 만들지 못했습니다.");
    let persisted = false;
    this.beginPersistentPut(key);
    try {
      await this.putStoredRow(row);
      persisted = true;

      const current = memoryRows.get(key);
      if (current) memoryRows.set(key, { ...current, durable: true });

      // An authoritative ACK may have arrived after this operation started but before a wedged
      // transaction completed. Queue a durable tombstone after the late put so it cannot reappear.
      if (emergencyAcknowledgedUpdates.has(key)) {
        await this.writeTombstone(scope, request.workId, request.updateId);
      }
      this.refreshMemoryDurability(scope, request.workId);
    } catch (error) {
      this.markDegraded(error);
      throw error;
    } finally {
      this.endPersistentPut(key);
      if (persisted && emergencyAcknowledgedUpdates.has(key) && !emergencyActivePuts.has(key)) {
        try {
          await this.deleteStoredRows([key]);
          emergencyAcknowledgedUpdates.delete(key);
        } catch (error) {
          // Keeping the tombstone is safe and prevents resurrection; a later read can retry.
          this.markDegraded(error);
        }
      }
    }
  }

  async remove(scope: string, workId: string, updateId: string): Promise<void> {
    this.removeEmergency(scope, workId, updateId);
    try {
      await this.writeTombstone(scope, workId, updateId);
      if (!emergencyActivePuts.has(outboxKey(scope, workId, updateId))) {
        await this.deleteStoredRows([outboxKey(scope, workId, updateId)]);
        emergencyAcknowledgedUpdates.delete(outboxKey(scope, workId, updateId));
      }
      this.refreshMemoryDurability(scope, workId);
    } catch (error) {
      this.markDegraded(error);
      if (
        error instanceof StudioCrdtOutboxUnavailableError &&
        !emergencyActivePuts.has(outboxKey(scope, workId, updateId))
      ) {
        emergencyAcknowledgedUpdates.delete(outboxKey(scope, workId, updateId));
        return;
      }
      throw error;
    }
  }

  private async writeTombstone(
    scope: string,
    workId: string,
    updateId: string
  ): Promise<void> {
    const tombstone: StoredStudioCrdtTombstone = {
      kind: "tombstone",
      key: outboxKey(scope, workId, updateId),
      scope,
      workId,
      updateId,
      createdAt: Date.now(),
    };
    await this.putStoredRow(tombstone);
  }

  private beginPersistentPut(key: string): void {
    emergencyActivePuts.set(key, (emergencyActivePuts.get(key) ?? 0) + 1);
  }

  private endPersistentPut(key: string): void {
    const remaining = (emergencyActivePuts.get(key) ?? 1) - 1;
    if (remaining <= 0) emergencyActivePuts.delete(key);
    else emergencyActivePuts.set(key, remaining);
  }

  private async deleteStoredRows(keys: readonly string[]): Promise<void> {
    if (this.persistence) return this.persistence.delete(keys);
    const database = await this.requiredDatabase();
    const transaction = database.transaction(LEGACY_STORE_NAME, "readwrite");
    const store = transaction.objectStore(LEGACY_STORE_NAME);
    for (const key of keys) store.delete(key);
    await transactionDone(transaction);
  }

  private async listStoredRows(scope: string, workId: string): Promise<unknown[]> {
    if (this.persistence) return this.persistence.list(scope, workId);
    const database = await this.requiredDatabase();
    const transaction = database.transaction(LEGACY_STORE_NAME, "readonly");
    const rows = await requestResult(
      transaction
        .objectStore(LEGACY_STORE_NAME)
        .index(LEGACY_SCOPE_WORK_INDEX)
        .getAll([scope, workId])
    ) as unknown[];
    await transactionDone(transaction);
    return rows;
  }

  private async putStoredRow(row: StoredStudioCrdtRow): Promise<void> {
    if (this.persistence) return this.persistence.put(row);
    const database = await this.requiredDatabase();
    const transaction = database.transaction(LEGACY_STORE_NAME, "readwrite");
    transaction.objectStore(LEGACY_STORE_NAME).put(row);
    await transactionDone(transaction);
  }

  private async requiredDatabase(): Promise<IDBDatabase> {
    const database = await openDatabase();
    if (database) return database;
    throw new StudioCrdtOutboxUnavailableError(
      "이 브라우저에서는 IndexedDB를 사용할 수 없어 같은 탭의 긴급 사본만 유지합니다."
    );
  }

}

function candidateToStoredUpdate(
  candidate: StudioCrdtOutboxSqlCandidate,
  expectedScope: string,
  expectedWorkId: string,
): StoredStudioCrdtUpdate | null {
  if (
    candidate.scope !== expectedScope ||
    candidate.workId !== expectedWorkId ||
    typeof candidate.updateId !== "string" ||
    typeof candidate.clientSequence !== "number" ||
    !Number.isSafeInteger(candidate.clientSequence) ||
    candidate.clientSequence < 0 ||
    typeof candidate.requestPayload !== "string" ||
    typeof candidate.payloadBytes !== "number" ||
    !Number.isSafeInteger(candidate.payloadBytes) ||
    candidate.payloadBytes <= 0 ||
    candidate.payloadBytes > STUDIO_CRDT_OUTBOX_MAX_REQUEST_BYTES ||
    typeof candidate.createdAt !== "number" ||
    !Number.isSafeInteger(candidate.createdAt) ||
    candidate.createdAt < 0 ||
    typeof candidate.updatedAt !== "number" ||
    !Number.isSafeInteger(candidate.updatedAt) ||
    candidate.updatedAt < 0 ||
    typeof candidate.attemptCount !== "number" ||
    !Number.isSafeInteger(candidate.attemptCount) ||
    candidate.attemptCount < 0
  ) {
    return null;
  }
  if (TEXT_ENCODER.encode(candidate.requestPayload).byteLength !== candidate.payloadBytes) {
    return null;
  }
  const noRetry = candidate.attemptCount === 0;
  if (
    noRetry !==
      (candidate.lastAttemptAt === null &&
        candidate.nextRetryAt === null &&
        candidate.lastErrorCode === null &&
        candidate.lastErrorMessage === null)
  ) {
    return null;
  }
  if (!noRetry) {
    if (
      typeof candidate.lastAttemptAt !== "number" ||
      !Number.isSafeInteger(candidate.lastAttemptAt) ||
      candidate.lastAttemptAt < 0 ||
      typeof candidate.nextRetryAt !== "number" ||
      !Number.isSafeInteger(candidate.nextRetryAt) ||
      candidate.nextRetryAt < candidate.lastAttemptAt ||
      typeof candidate.lastErrorCode !== "string" ||
      candidate.lastErrorCode.length === 0 ||
      candidate.lastErrorCode.length > MAX_RETRY_ERROR_CODE_LENGTH ||
      typeof candidate.lastErrorMessage !== "string" ||
      candidate.lastErrorMessage.length === 0 ||
      candidate.lastErrorMessage.length > MAX_RETRY_ERROR_MESSAGE_LENGTH
    ) {
      return null;
    }
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(candidate.requestPayload);
  } catch {
    return null;
  }
  const request = parsePersistedStudioCrdtUpdateRequest(decoded, {
    expectedWorkId,
  });
  if (
    request === null ||
    request.updateId !== candidate.updateId ||
    request.clientSequence !== candidate.clientSequence ||
    JSON.stringify(request) !== candidate.requestPayload
  ) {
    return null;
  }
  return {
    kind: "update",
    key: outboxKey(expectedScope, expectedWorkId, candidate.updateId),
    scope: expectedScope,
    workId: expectedWorkId,
    updateId: candidate.updateId,
    clientSequence: candidate.clientSequence,
    request,
    createdAt: candidate.createdAt,
    payloadBytes: candidate.payloadBytes,
    durable: true,
  };
}

export interface SqliteStudioCrdtOutboxOptions {
  acquireDatabase?: () => Promise<StudioLocalDatabase>;
  now?: () => number;
  limits?: Partial<{
    maxEntries: number;
    maxBytes: number;
  }>;
}

/**
 * V12 product authority. Pending messages, ACK tombstones and retry diagnostics live in the
 * shared SQLite/OPFS database; the old standalone IndexedDB is never opened from this class.
 */
export class SqliteStudioCrdtOutbox implements StudioCrdtOutbox {
  private readonly acquireDatabase: () => Promise<StudioLocalDatabase>;
  private readonly now: () => number;
  private readonly limits: { maxEntries: number; maxBytes: number };
  private databasePromise: Promise<StudioCrdtOutboxDatabase> | null = null;
  private status: StudioCrdtOutboxStatus = {
    state: "durable",
    message: "SQLite/OPFS CRDT 보관함이 정상입니다.",
  };

  constructor(options: SqliteStudioCrdtOutboxOptions = {}) {
    this.acquireDatabase = options.acquireDatabase ?? acquireStudioLocalDatabase;
    this.now = options.now ?? Date.now;
    const maxEntries = options.limits?.maxEntries ?? STUDIO_CRDT_OUTBOX_MAX_ENTRIES_PER_WORK;
    const maxBytes = options.limits?.maxBytes ?? STUDIO_CRDT_OUTBOX_MAX_BYTES_PER_WORK;
    if (
      !Number.isSafeInteger(maxEntries) ||
      maxEntries <= 0 ||
      maxEntries > STUDIO_CRDT_OUTBOX_MAX_ENTRIES_PER_WORK ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes <= 0 ||
      maxBytes > STUDIO_CRDT_OUTBOX_MAX_BYTES_PER_WORK
    ) {
      throw new Error("CRDT outbox limits는 V12 상한 안의 양의 정수여야 합니다.");
    }
    this.limits = { maxEntries, maxBytes };
  }

  getStatus(): StudioCrdtOutboxStatus {
    return { ...this.status };
  }

  listEmergency(scope: string, workId: string): StudioCrdtUpdateRequest[] {
    return filterAcknowledged(
      emergencyAcknowledgedUpdates,
      scope,
      workId,
      requestsFromStoredRows(scopedMemoryRows(scope, workId), workId),
    );
  }

  putEmergency(scope: string, request: StudioCrdtUpdateRequest): void {
    putMemoryRow(scope, request);
  }

  removeEmergency(scope: string, workId: string, updateId: string): void {
    const key = outboxKey(scope, workId, updateId);
    emergencyAcknowledgedUpdates.add(key);
    removeMemoryRow(key);
  }

  async list(scope: string, workId: string): Promise<StudioCrdtUpdateRequest[]> {
    assertScope(scope);
    let candidates: StudioCrdtOutboxSqlCandidate[];
    try {
      candidates = await (await this.database()).listCrdtOutboxCandidates(scope, workId);
    } catch (error) {
      this.markDegraded(error);
      if (isSqliteCorruption(error)) throw new StudioCrdtOutboxCorruptionError();
      throw new StudioCrdtOutboxReadUnavailableError(
        "SQLite/OPFS CRDT 보관함 전체를 읽지 못해 긴급 사본만으로 원고를 열 수 없습니다.",
        { cause: error },
      );
    }
    const durableRows: StoredStudioCrdtUpdate[] = [];
    for (const candidate of candidates) {
      if (candidate.acknowledgedAt !== null) {
        if (
          typeof candidate.acknowledgedAt !== "number" ||
          !Number.isSafeInteger(candidate.acknowledgedAt) ||
          candidate.acknowledgedAt < 0
        ) {
          throw new StudioCrdtOutboxCorruptionError();
        }
        continue;
      }
      const row = candidateToStoredUpdate(candidate, scope, workId);
      if (row === null) throw new StudioCrdtOutboxCorruptionError();
      durableRows.push(row);
    }
    const merged = new Map<string, StoredStudioCrdtUpdate>();
    for (const row of durableRows) {
      merged.set(row.key, row);
    }
    for (const row of scopedMemoryRows(scope, workId)) merged.set(row.key, row);
    this.refreshMemoryDurability(scope, workId);
    return filterAcknowledged(
      emergencyAcknowledgedUpdates,
      scope,
      workId,
      requestsFromStoredRows(merged.values(), workId),
    );
  }

  async put(scope: string, request: StudioCrdtUpdateRequest): Promise<void> {
    assertScope(scope);
    this.putEmergency(scope, request);
    const key = outboxKey(scope, request.workId, request.updateId);
    if (emergencyAcknowledgedUpdates.has(key)) return;
    const row = memoryRows.get(key);
    if (!row) throw new Error("CRDT outbox 긴급 사본을 만들지 못했습니다.");
    const serialized = serializeRequest(row.request);
    try {
      const result = await (await this.database()).enqueueCrdtOutboxRecord(
        {
          scope,
          workId: row.workId,
          updateId: row.updateId,
          clientSequence: row.clientSequence,
          requestPayload: serialized.payload,
          payloadBytes: serialized.payloadBytes,
          createdAt: row.createdAt,
        },
        this.limits,
      );
      if (result === "acknowledged") {
        emergencyAcknowledgedUpdates.add(key);
        removeMemoryRow(key);
      } else {
        const current = memoryRows.get(key);
        if (current) memoryRows.set(key, { ...current, durable: true });
      }
      this.refreshMemoryDurability(scope, request.workId);
    } catch (error) {
      this.markDegraded(error);
      if (error instanceof StudioCrdtOutboxSqlCapacityError) {
        throw new StudioCrdtOutboxCapacityError(error.entryCount, error.totalBytes);
      }
      throw error;
    }
  }

  async remove(scope: string, workId: string, updateId: string): Promise<void> {
    assertScope(scope);
    this.removeEmergency(scope, workId, updateId);
    try {
      await (await this.database()).acknowledgeCrdtOutboxRecord(
        scope,
        workId,
        updateId,
        this.now(),
      );
      this.markDurable();
    } catch (error) {
      this.markDegraded(error);
      throw error;
    }
  }

  async recordRetry(
    scope: string,
    workId: string,
    updateId: string,
    metadata: StudioCrdtOutboxRetryMetadata,
  ): Promise<void> {
    assertScope(scope);
    assertRetryMetadata(metadata);
    try {
      await (await this.database()).recordCrdtOutboxRetry(
        scope,
        workId,
        updateId,
        metadata,
      );
      this.markDurable();
    } catch (error) {
      this.markDegraded(error);
      throw error;
    }
  }

  private database(): Promise<StudioCrdtOutboxDatabase> {
    this.databasePromise ??= Promise.resolve()
      .then(() => this.acquireDatabase())
      .then(requireStudioCrdtOutboxDatabase);
    return this.databasePromise;
  }

  private markDurable(): void {
    this.status = {
      state: "durable",
      message: "SQLite/OPFS CRDT 보관함이 정상입니다.",
    };
  }

  private markDegraded(error: unknown): void {
    this.status = {
      state: "degraded",
      message:
        error instanceof Error && error.message.trim()
          ? error.message
          : "SQLite/OPFS CRDT 보관함을 사용할 수 없어 같은 탭 사본만 남았습니다.",
    };
  }

  private refreshMemoryDurability(scope: string, workId: string): void {
    if (scopedMemoryRows(scope, workId).some((row) => row.durable !== true)) {
      this.markDegraded(
        new StudioCrdtOutboxUnavailableError(
          "일부 공동 편집 변경은 아직 같은 탭의 긴급 사본에만 보관되어 있습니다.",
        ),
      );
    } else {
      this.markDurable();
    }
  }
}

/**
 * Serializes operations for the same authenticated user + work across binding instances. A newly
 * mounted editor therefore cannot list the outbox before the previous editor's final put settles.
 */
export class SerializedStudioCrdtOutbox implements StudioCrdtOutbox {
  private readonly timeoutMs: number;
  private readonly scheduleTimeout: (handler: () => void, delay: number) => unknown;
  private readonly cancelTimeout: (handle: unknown) => void;
  private readonly delegateState: SerializedDelegateState;
  private status: StudioCrdtOutboxStatus = {
    state: "durable",
    message: "오프라인 CRDT 보관함이 정상입니다.",
  };

  constructor(
    private readonly delegate: StudioCrdtOutbox,
    options: {
      timeoutMs?: number;
      setTimeout?: (handler: () => void, delay: number) => unknown;
      clearTimeout?: (handle: unknown) => void;
    } = {}
  ) {
    this.delegateState = serializedDelegateState(delegate);
    this.timeoutMs = Math.max(100, Math.min(10_000, options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS));
    this.scheduleTimeout = options.setTimeout ?? ((handler, delay) => globalThis.setTimeout(handler, delay));
    this.cancelTimeout = options.clearTimeout ?? ((handle) => {
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
    });
  }

  getStatus(): StudioCrdtOutboxStatus {
    const delegated = this.delegate.getStatus?.();
    if (delegated?.state === "degraded") return delegated;
    return { ...this.status };
  }

  private markDurable(): void {
    this.status = { state: "durable", message: "오프라인 CRDT 보관함이 정상입니다." };
  }

  private markDegraded(error: unknown): void {
    this.status = {
      state: "degraded",
      message:
        error instanceof Error && error.message.trim()
          ? error.message
          : "오프라인 CRDT 보관함 대신 같은 탭의 긴급 사본을 사용합니다.",
    };
  }

  list(scope: string, workId: string): Promise<StudioCrdtUpdateRequest[]> {
    // A write/remove timeout opens the per-work circuit, but a replacement binding must still
    // inspect the durable namespace before it exposes a document. Returning only the same-page
    // emergency snapshot here can omit older durable rows (or hide a malformed scoped row) and
    // let Studio save a stale frontier. Reads therefore probe through the circuit exactly like ACK
    // cleanup. The serialized timeout below still bounds a wedged database.
    return serializeOutboxOperation(
      scope,
      workId,
      () => this.delegate.list(scope, workId),
      this.timeoutMs,
      this.scheduleTimeout,
      this.cancelTimeout,
      true
    ).then(
      (requests) => {
        if (this.delegate.getStatus?.().state !== "degraded") this.markDurable();
        return filterAcknowledged(
          this.delegateState.acknowledgedUpdates,
          scope,
          workId,
          requests
        );
      },
      (error: unknown) => {
        if (
          error instanceof StudioCrdtOutboxCorruptionError ||
          error instanceof StudioCrdtOutboxTimeoutError ||
          error instanceof StudioCrdtOutboxReadUnavailableError
        ) {
          // A timed-out durable read is an unknown snapshot, not evidence that the emergency copy
          // is complete. Propagate it so restoreOutbox enters its terminal fail-closed boundary.
          throw error;
        }
        this.markDegraded(error);
        const emergency = this.delegate.listEmergency?.(scope, workId) ?? [];
        return filterAcknowledged(
          this.delegateState.acknowledgedUpdates,
          scope,
          workId,
          emergency
        );
      }
    );
  }

  listEmergency(scope: string, workId: string): StudioCrdtUpdateRequest[] {
    return filterAcknowledged(
      this.delegateState.acknowledgedUpdates,
      scope,
      workId,
      this.delegate.listEmergency?.(scope, workId) ?? []
    );
  }

  put(scope: string, request: StudioCrdtUpdateRequest): Promise<void> {
    this.delegate.putEmergency?.(scope, request);
    if (isCircuitOpen(scopeWorkKey(scope, request.workId))) {
      const error = new StudioCrdtOutboxUnavailableError("CRDT outbox가 복구 대기 중입니다.");
      this.markDegraded(error);
      return Promise.reject(error);
    }
    return serializeOutboxOperation(
      scope,
      request.workId,
      () => this.runDelegatePut(scope, request),
      this.timeoutMs,
      this.scheduleTimeout,
      this.cancelTimeout
    ).then(
      () => this.markDurable(),
      (error: unknown) => {
        this.markDegraded(error);
        throw error;
      }
    );
  }

  remove(scope: string, workId: string, updateId: string): Promise<void> {
    const key = outboxKey(scope, workId, updateId);
    this.delegateState.acknowledgedUpdates.add(key);
    this.delegate.removeEmergency?.(scope, workId, updateId);
    // ACK cleanup must probe through an open circuit. Otherwise a timed-out put can finish later
    // and leave a durable row that a replacement editor replays forever.
    return serializeOutboxOperation(
      scope,
      workId,
      () => this.runDelegateRemove(scope, workId, updateId, key),
      this.timeoutMs,
      this.scheduleTimeout,
      this.cancelTimeout,
      true
    ).then(
      () => {
        if (!this.delegateState.activePuts.has(key)) {
          this.delegateState.acknowledgedUpdates.delete(key);
        }
        this.markDurable();
      },
      (error: unknown) => {
        this.markDegraded(error);
        throw error;
      }
    );
  }

  recordRetry(
    scope: string,
    workId: string,
    updateId: string,
    metadata: StudioCrdtOutboxRetryMetadata,
  ): Promise<void> {
    if (!this.delegate.recordRetry) return Promise.resolve();
    return serializeOutboxOperation(
      scope,
      workId,
      () => this.delegate.recordRetry!(scope, workId, updateId, metadata),
      this.timeoutMs,
      this.scheduleTimeout,
      this.cancelTimeout,
      true,
    ).then(
      () => this.markDurable(),
      (error: unknown) => {
        this.markDegraded(error);
        throw error;
      },
    );
  }

  private runDelegatePut(
    scope: string,
    request: StudioCrdtUpdateRequest
  ): Promise<void> {
    const key = outboxKey(scope, request.workId, request.updateId);
    this.delegateState.activePuts.set(
      key,
      (this.delegateState.activePuts.get(key) ?? 0) + 1
    );
    const operation = Promise.resolve().then(() => this.delegate.put(scope, request));
    void operation.then(
      () => this.finishDelegatePut(scope, request, key),
      () => this.finishDelegatePut(scope, request, key)
    );
    return operation;
  }

  private runDelegateRemove(
    scope: string,
    workId: string,
    updateId: string,
    key: string
  ): Promise<void> {
    const operation = Promise.resolve().then(
      () => this.delegate.remove(scope, workId, updateId)
    );
    void operation.then(
      () => {
        if (!this.delegateState.activePuts.has(key)) {
          this.delegateState.acknowledgedUpdates.delete(key);
        }
      },
      () => undefined
    );
    return operation;
  }

  private finishDelegatePut(
    scope: string,
    request: StudioCrdtUpdateRequest,
    key: string
  ): void {
    const remaining = (this.delegateState.activePuts.get(key) ?? 1) - 1;
    if (remaining <= 0) this.delegateState.activePuts.delete(key);
    else this.delegateState.activePuts.set(key, remaining);
    if (remaining > 0 || !this.delegateState.acknowledgedUpdates.has(key)) return;

    // The public remove may have completed after the serialized wrapper timed out while the
    // underlying put was still running. Re-run cleanup after that late put settles.
    void Promise.resolve()
      .then(() => this.delegate.remove(scope, request.workId, request.updateId))
      .then(
        () => this.delegateState.acknowledgedUpdates.delete(key),
        (error: unknown) => this.markDegraded(error)
      );
  }
}

export function createStudioCrdtOutbox(
  options: SqliteStudioCrdtOutboxOptions = {},
): StudioCrdtOutbox {
  return new SerializedStudioCrdtOutbox(new SqliteStudioCrdtOutbox(options));
}
