import { z } from "zod";

import { normalizeStudioAiProvenanceDocument } from "./ai/studio-ai-provenance";
import { acquireStudioLocalDatabase } from "./studio-local-database-runtime";

import type { StudioLocalDatabase } from "./studio-local-database";

export const STUDIO_CHECKPOINT_LIMIT = 10;
const STUDIO_CHECKPOINT_PREFIX = "toonspectrum-studio-checkpoints:v12";
const STUDIO_CHECKPOINT_DATABASE_NAME = "toonspectrum-studio-checkpoints";
const STUDIO_CHECKPOINT_DATABASE_VERSION = 1;
const STUDIO_CHECKPOINT_DATABASE_STORE = "documents";
const STUDIO_CHECKPOINT_DURABLE_FALLBACK_SUFFIX = ":durable-fallback:v12";
export const STUDIO_CHECKPOINT_SQLITE_NAMESPACE = "studio-named-checkpoints-v12";
const STUDIO_CHECKPOINT_SQLITE_INDEX_KEY = "__checkpoint-keys-v1";
let checkpointStorageSequence = 0;
const checkpointSqliteQueues = new Map<string, Promise<void>>();

export interface StudioCheckpointStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const StudioCheckpointSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(80),
  createdAt: z.string().min(1).max(80),
  payload: z.unknown(),
});

const StudioCheckpointFileSchema = z.object({
  version: z.literal(1),
  checkpoints: z.array(z.unknown()).max(100),
});

const StudioCheckpointSqliteFileSchema = z.object({
  version: z.literal(1),
  checkpoints: z.array(StudioCheckpointSchema).max(STUDIO_CHECKPOINT_LIMIT),
});

const StudioCheckpointSqliteIndexSchema = z.object({
  version: z.literal(1),
  keys: z.array(z.string().min(1).max(4_096)).max(10_000),
});

const StudioCheckpointIndexedDbFileSchema = StudioCheckpointFileSchema.extend({
  key: z.string().min(1).max(4_096),
  legacyImported: z.boolean().optional().default(false),
  appliedLegacyWriteId: z.string().min(1).max(120).nullable().optional().default(null),
  appliedFallbackId: z.string().min(1).max(120).nullable().optional().default(null),
});

const StudioCheckpointDurableFallbackFileSchema = StudioCheckpointFileSchema.extend({
  id: z.string().min(1).max(120),
  legacyImported: z.literal(true),
});

export type StudioCheckpoint = z.infer<typeof StudioCheckpointSchema>;

export interface StudioCheckpointInput {
  name: string;
  payload: unknown;
  now?: Date;
  idFactory?: () => string;
}

export function studioServerRestoreCheckpointName(revision: number, now = new Date()): string {
  if (!Number.isInteger(revision) || revision < 1 || revision > 2_147_483_647) {
    throw new RangeError("복원할 서버 revision이 올바르지 않습니다.");
  }
  const formatted = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(now);
  return `서버 r${revision} 복원 전 · ${formatted}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Redacts raw prompt fields in both newly written and legacy checkpoint payloads. */
function normalizeCheckpointPayload(value: unknown): unknown {
  if (!isRecord(value) || !Object.hasOwn(value, "aiProvenance")) return value;
  return {
    ...value,
    aiProvenance: normalizeStudioAiProvenanceDocument(value.aiProvenance),
  };
}

export function studioCheckpointKey(input: {
  userId?: string | null;
  workId?: string | null;
  remixId?: string | null;
}): string {
  const owner = encodeURIComponent(input.userId?.trim() || "guest");
  const documentId = input.workId
    ? `work:${encodeURIComponent(input.workId)}`
    : input.remixId
      ? `remix:${encodeURIComponent(input.remixId)}`
      : "new";
  return `${STUDIO_CHECKPOINT_PREFIX}:${owner}:${documentId}`;
}

function normalizeCheckpointList(value: unknown): StudioCheckpoint[] {
  // 초기 실험 빌드의 배열-only 형태도 읽어 v1 컨테이너로 자연스럽게 마이그레이션한다.
  const candidate = Array.isArray(value) ? { version: 1, checkpoints: value } : value;
  const parsed = StudioCheckpointFileSchema.safeParse(candidate);
  if (!parsed.success) return [];
  return parsed.data.checkpoints
    .flatMap((checkpoint) => {
      const result = StudioCheckpointSchema.safeParse(checkpoint);
      return result.success
        ? [{ ...result.data, payload: normalizeCheckpointPayload(result.data.payload) }]
        : [];
    })
    .filter((checkpoint) => Number.isFinite(Date.parse(checkpoint.createdAt)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, STUDIO_CHECKPOINT_LIMIT);
}

function mergeCheckpointLists(...lists: readonly StudioCheckpoint[][]): StudioCheckpoint[] {
  const checkpointIds = new Set<string>();
  const checkpoints = lists.flatMap((list) =>
    list.filter((checkpoint) => {
      if (checkpointIds.has(checkpoint.id)) return false;
      checkpointIds.add(checkpoint.id);
      return true;
    })
  );
  return normalizeCheckpointList({ version: 1, checkpoints });
}

function parseSqliteCheckpointList(raw: string | null): StudioCheckpoint[] {
  if (raw === null) return [];
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    throw new Error("SQLite 복구 지점 문서가 손상되어 안전하게 열 수 없습니다.");
  }
  const parsed = StudioCheckpointSqliteFileSchema.safeParse(candidate);
  if (!parsed.success || parsed.data.checkpoints.some(
    (checkpoint) => !Number.isFinite(Date.parse(checkpoint.createdAt))
  )) {
    throw new Error("SQLite 복구 지점 문서가 손상되어 안전하게 열 수 없습니다.");
  }
  return normalizeCheckpointList(parsed.data);
}

function serializeSqliteCheckpointList(checkpoints: readonly StudioCheckpoint[]): string {
  const file = StudioCheckpointSqliteFileSchema.parse({
    version: 1,
    checkpoints: checkpoints.slice(0, STUDIO_CHECKPOINT_LIMIT),
  });
  if (!isJsonCheckpointValue(file)) throw createDurableStorageError();
  try {
    return JSON.stringify(file);
  } catch {
    throw createDurableStorageError();
  }
}

async function withCheckpointSqliteQueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = checkpointSqliteQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  checkpointSqliteQueues.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (checkpointSqliteQueues.get(key) === tail) checkpointSqliteQueues.delete(key);
  }
}

function parseSqliteCheckpointKeys(raw: string | null): string[] {
  if (raw === null) return [];
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    throw new Error("SQLite 복구 지점 색인이 손상되어 안전하게 열 수 없습니다.");
  }
  const parsed = StudioCheckpointSqliteIndexSchema.safeParse(candidate);
  if (!parsed.success || new Set(parsed.data.keys).size !== parsed.data.keys.length) {
    throw new Error("SQLite 복구 지점 색인이 손상되어 안전하게 열 수 없습니다.");
  }
  return [...parsed.data.keys].sort((left, right) => left.localeCompare(right));
}

async function updateSqliteCheckpointIndex(
  database: StudioLocalDatabase,
  key: string,
  present: boolean
): Promise<void> {
  await withCheckpointSqliteQueue(`index:${STUDIO_CHECKPOINT_SQLITE_INDEX_KEY}`, async () => {
    const current = parseSqliteCheckpointKeys(
      await database.kvGet(
        STUDIO_CHECKPOINT_SQLITE_NAMESPACE,
        STUDIO_CHECKPOINT_SQLITE_INDEX_KEY
      )
    );
    const next = present
      ? [...new Set([...current, key])].sort((left, right) => left.localeCompare(right))
      : current.filter((candidate) => candidate !== key);
    if (next.length === 0) {
      await database.kvDelete(
        STUDIO_CHECKPOINT_SQLITE_NAMESPACE,
        STUDIO_CHECKPOINT_SQLITE_INDEX_KEY
      );
      return;
    }
    await database.kvSet(
      STUDIO_CHECKPOINT_SQLITE_NAMESPACE,
      STUDIO_CHECKPOINT_SQLITE_INDEX_KEY,
      JSON.stringify(StudioCheckpointSqliteIndexSchema.parse({ version: 1, keys: next }))
    );
  });
}

async function mutateSqliteCheckpointList(
  key: string,
  mutate: (checkpoints: StudioCheckpoint[]) => StudioCheckpoint[]
): Promise<StudioCheckpoint[]> {
  return withCheckpointSqliteQueue(key, async () => {
    const database = await acquireStudioLocalDatabase();
    const current = parseSqliteCheckpointList(
      await database.kvGet(STUDIO_CHECKPOINT_SQLITE_NAMESPACE, key)
    );
    const next = normalizeCheckpointList({ version: 1, checkpoints: mutate(current) });
    if (next.length === 0) {
      await database.kvDelete(STUDIO_CHECKPOINT_SQLITE_NAMESPACE, key);
    } else {
      await database.kvSet(
        STUDIO_CHECKPOINT_SQLITE_NAMESPACE,
        key,
        serializeSqliteCheckpointList(next)
      );
    }
    await updateSqliteCheckpointIndex(database, key, next.length > 0);
    return next;
  });
}

function createCheckpointRecord(input: StudioCheckpointInput): StudioCheckpoint {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new Error("복구 지점 이름을 입력해 주세요.");
  const idFactory = input.idFactory ?? (() => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`);
  return StudioCheckpointSchema.parse({
    id: idFactory(),
    name,
    createdAt: (input.now ?? new Date()).toISOString(),
    payload: normalizeCheckpointPayload(input.payload),
  });
}

export function listStudioCheckpoints(
  storage: Pick<StudioCheckpointStorage, "getItem">,
  key: string
): StudioCheckpoint[] {
  try {
    const raw = storage.getItem(key);
    return raw ? normalizeCheckpointList(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function writeCheckpointList(
  storage: Pick<StudioCheckpointStorage, "setItem" | "removeItem">,
  key: string,
  checkpoints: StudioCheckpoint[]
): void {
  try {
    if (checkpoints.length === 0) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(
      key,
      JSON.stringify({
        version: 1,
        storageWriteId: createStorageId(),
        checkpoints: checkpoints.slice(0, STUDIO_CHECKPOINT_LIMIT),
      })
    );
  } catch {
    throw new Error("브라우저 저장공간이 부족해 복구 지점을 저장하지 못했어요. 오래된 지점을 지우거나 JSON 백업을 이용해 주세요.");
  }
}

function createDurableStorageError(): Error {
  return new Error(
    "현재 편집본을 안전한 복구 지점에 저장하지 못했어요. 브라우저 저장공간을 확보하거나 JSON 백업 후 다시 시도해 주세요."
  );
}

function durableFallbackKey(key: string): string {
  return `${key}${STUDIO_CHECKPOINT_DURABLE_FALLBACK_SUFFIX}`;
}

interface DurableFallbackFile {
  id: string;
  legacyImported: true;
  checkpoints: StudioCheckpoint[];
}

function readDurableFallbackFile(
  storage: Pick<StudioCheckpointStorage, "getItem">,
  key: string
): DurableFallbackFile | null {
  try {
    const raw = storage.getItem(durableFallbackKey(key));
    if (!raw) return null;
    const parsed = StudioCheckpointDurableFallbackFileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return {
      ...parsed.data,
      checkpoints: normalizeCheckpointList(parsed.data),
    };
  } catch {
    return null;
  }
}

/** localStorage fallback must never silently erase Blob, undefined, or other structured-clone values. */
function isJsonCheckpointValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;

  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) return false;
  } else if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  if (Object.getOwnPropertySymbols(value).length > 0) return false;

  const keys = Object.keys(value);
  const ownNames = Object.getOwnPropertyNames(value);
  if (Array.isArray(value)) {
    if (keys.length !== value.length || ownNames.length !== value.length + 1) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (keys[index] !== String(index)) return false;
    }
  } else if (ownNames.length !== keys.length) {
    return false;
  }

  ancestors.add(value);
  const valid = keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(
      descriptor &&
      "value" in descriptor &&
      isJsonCheckpointValue(descriptor.value, ancestors)
    );
  });
  ancestors.delete(value);
  return valid;
}

function createStorageId(): string {
  checkpointStorageSequence += 1;
  return (
    globalThis.crypto?.randomUUID?.() ??
    `checkpoint-storage-${Date.now()}-${checkpointStorageSequence}`
  );
}

function writeDurableFallbackFile(
  storage: Pick<StudioCheckpointStorage, "setItem">,
  key: string,
  checkpoints: StudioCheckpoint[]
): void {
  const file = {
    version: 1 as const,
    id: createStorageId(),
    legacyImported: true as const,
    checkpoints: checkpoints.slice(0, STUDIO_CHECKPOINT_LIMIT),
  };
  if (!isJsonCheckpointValue(file)) throw createDurableStorageError();
  try {
    storage.setItem(durableFallbackKey(key), JSON.stringify(file));
  } catch {
    throw createDurableStorageError();
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(createDurableStorageError());
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(createDurableStorageError());
    transaction.onabort = () => reject(createDurableStorageError());
  });
}

function openCheckpointDatabase(): Promise<IDBDatabase> {
  const factory = globalThis.indexedDB;
  if (!factory) return Promise.reject(createDurableStorageError());

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(STUDIO_CHECKPOINT_DATABASE_NAME, STUDIO_CHECKPOINT_DATABASE_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STUDIO_CHECKPOINT_DATABASE_STORE)) {
        database.createObjectStore(STUDIO_CHECKPOINT_DATABASE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      resolve(request.result);
    };
    request.onerror = () => reject(createDurableStorageError());
    request.onblocked = () => {
      blocked = true;
      reject(createDurableStorageError());
    };
  });
}

async function withCheckpointDatabase<T>(callback: (database: IDBDatabase) => Promise<T>): Promise<T> {
  const database = await openCheckpointDatabase();
  try {
    return await callback(database);
  } catch {
    throw createDurableStorageError();
  } finally {
    database.close();
  }
}

interface IndexedDbCheckpointFile {
  checkpoints: StudioCheckpoint[];
  legacyImported: boolean;
  appliedLegacyWriteId: string | null;
  appliedFallbackId: string | null;
}

function normalizeIndexedDbCheckpointFile(value: unknown): IndexedDbCheckpointFile {
  const parsed = StudioCheckpointIndexedDbFileSchema.safeParse(value);
  if (!parsed.success) {
    return {
      checkpoints: [],
      legacyImported: false,
      appliedLegacyWriteId: null,
      appliedFallbackId: null,
    };
  }
  return {
    checkpoints: normalizeCheckpointList(parsed.data),
    legacyImported: parsed.data.legacyImported,
    appliedLegacyWriteId: parsed.data.appliedLegacyWriteId,
    appliedFallbackId: parsed.data.appliedFallbackId,
  };
}

interface LocalCheckpointSource {
  checkpoints: StudioCheckpoint[];
  writeId: string;
}

function legacyStorageWriteId(raw: string, parsed: unknown): string {
  if (
    isRecord(parsed) &&
    typeof parsed.storageWriteId === "string" &&
    parsed.storageWriteId.length > 0 &&
    parsed.storageWriteId.length <= 120
  ) {
    return `write:${parsed.storageWriteId}`;
  }
  let hash = 2_166_136_261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `legacy:${raw.length}:${(hash >>> 0).toString(16)}`;
}

function readLocalCheckpointSource(
  storage: Pick<StudioCheckpointStorage, "getItem">,
  key: string
): LocalCheckpointSource | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return {
      checkpoints: normalizeCheckpointList(parsed),
      writeId: legacyStorageWriteId(raw, parsed),
    };
  } catch {
    return null;
  }
}

async function mutateIndexedDbCheckpointList(
  storage: StudioCheckpointStorage,
  key: string,
  mutate: (checkpoints: StudioCheckpoint[]) => StudioCheckpoint[],
  writeWithoutPendingImport = true
): Promise<StudioCheckpoint[]> {
  const legacy = readLocalCheckpointSource(storage, key);
  const fallback = readDurableFallbackFile(storage, key);

  const next = await withCheckpointDatabase(async (database) => {
    const transaction = database.transaction(STUDIO_CHECKPOINT_DATABASE_STORE, "readwrite");
    const done = transactionDone(transaction);
    try {
      const store = transaction.objectStore(STUDIO_CHECKPOINT_DATABASE_STORE);
      const raw = await requestResult<unknown>(store.get(key));
      const stored = normalizeIndexedDbCheckpointFile(raw);
      const pendingFallback = fallback && fallback.id !== stored.appliedFallbackId ? fallback : null;
      const pendingLegacy = legacy && legacy.writeId !== stored.appliedLegacyWriteId ? legacy : null;
      const current = mergeCheckpointLists(
        pendingFallback?.checkpoints ?? [],
        pendingLegacy?.checkpoints ?? [],
        stored.checkpoints,
      );
      const normalizedNext = normalizeCheckpointList({ version: 1, checkpoints: mutate(current) });
      if (writeWithoutPendingImport || pendingLegacy || pendingFallback) {
        await requestResult(
          store.put({
            key,
            version: 1,
            legacyImported: true,
            appliedLegacyWriteId: pendingLegacy?.writeId ?? stored.appliedLegacyWriteId,
            appliedFallbackId: pendingFallback?.id ?? stored.appliedFallbackId,
            checkpoints: normalizedNext,
          })
        );
      }
      await done;
      return normalizedNext;
    } catch (error) {
      await done.catch(() => undefined);
      throw error;
    }
  });

  // The IndexedDB record marks both sources as imported, so cleanup failure cannot resurrect legacy data.
  try {
    storage.removeItem(key);
  } catch {
    // IndexedDB remains authoritative.
  }
  try {
    storage.removeItem(durableFallbackKey(key));
  } catch {
    // appliedFallbackId prevents replaying a stale fallback container.
  }
  return next;
}

function fallbackCheckpointList(
  storage: Pick<StudioCheckpointStorage, "getItem">,
  key: string
): StudioCheckpoint[] {
  return readDurableFallbackFile(storage, key)?.checkpoints ?? listStudioCheckpoints(storage, key);
}

/**
 * Product calls pass `undefined` and read the shared V12 SQLite/OPFS authority. Supplying a storage
 * adapter explicitly enters the legacy IndexedDB/localStorage compatibility seam; product boot
 * never discovers or imports that seam automatically.
 */
export async function listDurableStudioCheckpoints(
  storage: StudioCheckpointStorage | undefined,
  key: string
): Promise<StudioCheckpoint[]> {
  if (storage === undefined) {
    const database = await acquireStudioLocalDatabase();
    return parseSqliteCheckpointList(
      await database.kvGet(STUDIO_CHECKPOINT_SQLITE_NAMESPACE, key)
    );
  }
  try {
    return await mutateIndexedDbCheckpointList(storage, key, (checkpoints) => checkpoints, false);
  } catch {
    return fallbackCheckpointList(storage, key);
  }
}

/** Lazy recovery-center inventory for V12 SQLite checkpoints; it never scans legacy web storage. */
export async function listDurableStudioCheckpointKeys(): Promise<string[]> {
  const database = await acquireStudioLocalDatabase();
  return parseSqliteCheckpointKeys(
    await database.kvGet(
      STUDIO_CHECKPOINT_SQLITE_NAMESPACE,
      STUDIO_CHECKPOINT_SQLITE_INDEX_KEY
    )
  );
}

export async function countDurableStudioCheckpoints(): Promise<number> {
  const keys = await listDurableStudioCheckpointKeys();
  const lists = await Promise.all(keys.map((key) => listDurableStudioCheckpoints(undefined, key)));
  return lists.reduce((sum, checkpoints) => sum + checkpoints.length, 0);
}

/**
 * Product calls persist the complete JSON-safe project snapshot in SQLite before resolving. The
 * explicit legacy storage seam retains its old IndexedDB structured-clone behavior for tests and
 * opt-in recovery tools only.
 */
export async function createDurableStudioCheckpoint(
  storage: StudioCheckpointStorage | undefined,
  key: string,
  input: StudioCheckpointInput
): Promise<StudioCheckpoint[]> {
  const checkpoint = createCheckpointRecord(input);
  if (storage === undefined) {
    return mutateSqliteCheckpointList(key, (checkpoints) => [checkpoint, ...checkpoints]);
  }
  try {
    return await mutateIndexedDbCheckpointList(storage, key, (checkpoints) => [
      checkpoint,
      ...checkpoints,
    ]);
  } catch {
    const next = mergeCheckpointLists([checkpoint], fallbackCheckpointList(storage, key));
    writeDurableFallbackFile(storage, key, next);
    return next;
  }
}

export async function renameDurableStudioCheckpoint(
  storage: StudioCheckpointStorage | undefined,
  key: string,
  id: string,
  name: string
): Promise<StudioCheckpoint[]> {
  const normalizedName = name.trim().slice(0, 80);
  if (!normalizedName) throw new Error("복구 지점 이름을 입력해 주세요.");
  const rename = (checkpoints: StudioCheckpoint[]) =>
    checkpoints.map((checkpoint) =>
      checkpoint.id === id ? { ...checkpoint, name: normalizedName } : checkpoint
    );
  if (storage === undefined) return mutateSqliteCheckpointList(key, rename);
  try {
    return await mutateIndexedDbCheckpointList(storage, key, rename);
  } catch {
    const current = fallbackCheckpointList(storage, key);
    if (!current.some((checkpoint) => checkpoint.id === id)) throw createDurableStorageError();
    const next = rename(current);
    writeDurableFallbackFile(storage, key, next);
    return next;
  }
}

export async function deleteDurableStudioCheckpoint(
  storage: StudioCheckpointStorage | undefined,
  key: string,
  id: string
): Promise<StudioCheckpoint[]> {
  const remove = (checkpoints: StudioCheckpoint[]) =>
    checkpoints.filter((checkpoint) => checkpoint.id !== id);
  if (storage === undefined) return mutateSqliteCheckpointList(key, remove);
  try {
    return await mutateIndexedDbCheckpointList(storage, key, remove);
  } catch {
    const current = fallbackCheckpointList(storage, key);
    if (!current.some((checkpoint) => checkpoint.id === id)) throw createDurableStorageError();
    const next = remove(current);
    writeDurableFallbackFile(storage, key, next);
    return next;
  }
}

export function createStudioCheckpoint(
  storage: StudioCheckpointStorage,
  key: string,
  input: StudioCheckpointInput
): StudioCheckpoint[] {
  const checkpoint = createCheckpointRecord(input);
  // payload가 JSON으로 직렬화 불가능한 값(BigInt/순환 참조 등)이면 write 단계에서 명시적 오류가 난다.
  const next = [checkpoint, ...listStudioCheckpoints(storage, key)].slice(0, STUDIO_CHECKPOINT_LIMIT);
  writeCheckpointList(storage, key, next);
  return next;
}

export function renameStudioCheckpoint(
  storage: StudioCheckpointStorage,
  key: string,
  id: string,
  name: string
): StudioCheckpoint[] {
  const normalizedName = name.trim().slice(0, 80);
  if (!normalizedName) throw new Error("복구 지점 이름을 입력해 주세요.");
  const current = listStudioCheckpoints(storage, key);
  const next = current.map((checkpoint) =>
    checkpoint.id === id ? { ...checkpoint, name: normalizedName } : checkpoint
  );
  if (next.every((checkpoint, index) => checkpoint === current[index])) return current;
  writeCheckpointList(storage, key, next);
  return next;
}

export function deleteStudioCheckpoint(
  storage: StudioCheckpointStorage,
  key: string,
  id: string
): StudioCheckpoint[] {
  const current = listStudioCheckpoints(storage, key);
  const next = current.filter((checkpoint) => checkpoint.id !== id);
  if (next.length === current.length) return current;
  writeCheckpointList(storage, key, next);
  return next;
}
