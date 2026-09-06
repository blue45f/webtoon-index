/**
 * V12 E25 — Studio 로컬 SQL 데이터베이스(OPFS + SQLite WASM).
 *
 * localStorage 키-밸류 산탄 대신 V12 전용 SQLite 파일("studio-local-v12.db")을
 * opfs-sahpool VFS 위에 둔다. React 의존이 없는 순수 모듈이며,
 * `@sqlite.org/sqlite-wasm` 은 반드시 dynamic import 로만 로드한다
 * (check:studio-bundle 이 정적 eager 포함을 잡는다).
 *
 * OPFS 를 못 쓰는 환경에서는 조용히 인메모리로 다운그레이드하지 않고
 * {@link SqliteUnavailableError} 를 던진다 — 폴백 여부는 호출자가 결정한다.
 * `vfs: "memory"` 는 테스트/노드에서 스키마·쿼리 로직 검증용으로만 쓴다.
 *
 * OPFS 디렉터리 {@link STUDIO_SQLITE_OPFS_DIRECTORY} 는
 * studio-data-destruction.ts 의 파괴 인벤토리에 등록된다(드리프트 계약은
 * studio-data-destruction.test.ts).
 */

/** opfs-sahpool VFS 메타데이터+DB 파일이 사는 OPFS 루트 디렉터리. */
export const STUDIO_SQLITE_OPFS_DIRECTORY = "toonspectrum-studio-sqlite";

/**
 * Fallback SAH-pool directory when the primary root still has open SyncAccessHandles.
 * Native `removeEntry` cannot delete a locked sahpool tree (`NoModificationAllowedError`).
 */
export const STUDIO_SQLITE_OPFS_RECOVERY_DIRECTORY = "toonspectrum-studio-sqlite-r1";

/** VFS name used only with {@link STUDIO_SQLITE_OPFS_RECOVERY_DIRECTORY}. */
export const STUDIO_SQLITE_SAHPOOL_RECOVERY_VFS_NAME = "opfs-sahpool-r1";

/**
 * SAH pool 네임스페이스 안의 V12 전용 DB 파일명.
 *
 * LEGACY_DATA_MIGRATION=FALSE를 코드 수준에서 지키기 위해 이전
 * `/studio-local.db`를 재개방하지 않고 `/studio-local-v12.db`로 시작한다.
 */
export const STUDIO_SQLITE_DATABASE_FILENAME = "studio-local-v12.db";

export type StudioSqliteBindValue = string | number | null;

/**
 * sqlite-wasm oo1 API 중 이 모듈이 실제로 쓰는 표면만 구조적으로 고정한 핸들.
 * 실 모듈(Sqlite3Static)이 그대로 만족하며, 테스트는 이 표면만 스텁하면 된다.
 */
export interface StudioSqliteStatementHandle {
  bind(values: readonly StudioSqliteBindValue[]): unknown;
  step(): boolean;
  get(columnIndex: number): unknown;
  reset(): unknown;
  finalize(): unknown;
}

export interface StudioSqliteDatabaseHandle {
  exec(sql: string): unknown;
  prepare(sql: string): StudioSqliteStatementHandle;
  changes(): number;
  close(): void;
}

export interface StudioSqlitePoolUtilHandle {
  OpfsSAHPoolDb: new (filename: string) => StudioSqliteDatabaseHandle;
  wipeFiles?: () => Promise<void>;
  unlink?: (filename: string) => boolean;
}

export interface StudioSqliteApiHandle {
  oo1: { DB: new (filename: string, flags?: string) => StudioSqliteDatabaseHandle };
  installOpfsSAHPoolVfs(options: {
    directory?: string;
    name?: string;
    forceReinitIfPreviouslyFailed?: boolean;
  }): Promise<StudioSqlitePoolUtilHandle>;
}

/**
 * SQLite 를 열 수 없는 환경(모듈 로드 실패·OPFS 부재·VFS 설치 실패)을 알리는
 * 명시적 실패. 인메모리 다운그레이드 같은 조용한 폴백은 하지 않는다.
 */
export class SqliteUnavailableError extends Error {
  readonly reason: string;

  constructor(reason: string, options?: { cause?: unknown }) {
    super(`studio local sqlite unavailable: ${reason}`, options);
    this.name = "SqliteUnavailableError";
    this.reason = reason;
  }
}

/** The OPFS image itself is unusable. Distinct from a single corrupt JSON value in kv. */
export class StudioSqliteCorruptError extends Error {
  constructor(message = "studio local sqlite is corrupt", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StudioSqliteCorruptError";
  }
}

export function isStudioSqliteCorruption(error: unknown): boolean {
  if (error instanceof StudioSqliteCorruptError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /SQLITE_CORRUPT|database disk image is malformed|malformed database schema|SQLITE_NOTADB|file is not a database/iu.test(
    message,
  );
}

function errorName(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

export function isStudioOpfsModificationLocked(error: unknown): boolean {
  if (errorName(error) === "NoModificationAllowedError") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /NoModificationAllowedError|modifications are not allowed/iu.test(message);
}

function isStudioOpfsNotFound(error: unknown): boolean {
  return errorName(error) === "NotFoundError";
}

const STUDIO_SQLITE_OPFS_WIPE_TARGETS = Object.freeze([
  STUDIO_SQLITE_OPFS_DIRECTORY,
  STUDIO_SQLITE_OPFS_RECOVERY_DIRECTORY,
]);

/**
 * Best-effort native OPFS delete. Returns true when at least one directory was removed.
 * A locked SAH-pool tree (`NoModificationAllowedError`) is not fatal — callers must
 * reset through {@link StudioSqlitePoolUtilHandle.wipeFiles} or a sibling directory.
 */
export async function wipeStudioSqliteOpfsDirectory(): Promise<boolean> {
  const storage = (
    globalThis as {
      navigator?: { storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> } };
    }
  ).navigator?.storage;
  if (typeof storage?.getDirectory !== "function") return false;
  try {
    const root = await storage.getDirectory();
    let removed = false;
    for (const name of STUDIO_SQLITE_OPFS_WIPE_TARGETS) {
      try {
        await root.removeEntry(name, { recursive: true });
        removed = true;
      } catch (error) {
        if (isStudioOpfsNotFound(error) || isStudioOpfsModificationLocked(error)) continue;
        throw error;
      }
    }
    return removed;
  } catch (error) {
    if (isStudioOpfsNotFound(error) || isStudioOpfsModificationLocked(error)) return false;
    throw error;
  }
}

export interface StudioLocalDatabaseMigration {
  /** 이 마이그레이션 적용 후의 PRAGMA user_version 값(1부터 순차). */
  toVersion: number;
  statements: readonly string[];
}

/**
 * 스키마 마이그레이션 체인.
 * - v1: kv·tournament_winners·cost_samples(+조회 인덱스).
 * - v2: CommandBus 저널 영속(journal_entries)·two-slot 스냅샷(snapshots).
 * - v3: 무제한 브러시 라이브러리의 구조화 레코드·keyset 조회 인덱스.
 * - v4: 무제한 필터 프리셋 카탈로그의 구조화 레코드·검색/keyset 인덱스.
 * - v5: CRDT 미승인 update의 순서 보존 outbox와 ACK tombstone·retry metadata.
 * - v6: 영구 거절 표식과 chunked recovery frontier의 bounded row authority.
 *   기존 v1/v2 DB 는 재개방 시 러너가 최신 버전으로 자동 전진시킨다.
 */
export const STUDIO_LOCAL_DATABASE_MIGRATIONS: readonly StudioLocalDatabaseMigration[] =
  Object.freeze([
    {
      toVersion: 1,
      statements: Object.freeze([
        `CREATE TABLE IF NOT EXISTS kv (
          namespace TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (namespace, key)
        )`,
        `CREATE TABLE IF NOT EXISTS tournament_winners (
          bucket TEXT NOT NULL,
          device_hash TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          expected_warm_ms REAL NOT NULL,
          decided_at_sample INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (bucket, device_hash)
        )`,
        `CREATE TABLE IF NOT EXISTS cost_samples (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider_id TEXT NOT NULL,
          bucket TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('warm', 'cold')),
          ms REAL NOT NULL,
          recorded_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS cost_samples_provider_bucket
          ON cost_samples (provider_id, bucket)`,
      ]),
    },
    {
      toVersion: 2,
      statements: Object.freeze([
        `CREATE TABLE IF NOT EXISTS journal_entries (
          project_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          payload TEXT NOT NULL,
          crc32 INTEGER NOT NULL,
          PRIMARY KEY (project_id, seq)
        )`,
        `CREATE TABLE IF NOT EXISTS snapshots (
          project_id TEXT NOT NULL,
          slot INTEGER NOT NULL CHECK (slot IN (0, 1)),
          seq INTEGER NOT NULL,
          payload TEXT NOT NULL,
          crc32 INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (project_id, slot)
        )`,
      ]),
    },
    {
      toVersion: 3,
      statements: Object.freeze([
        `CREATE TABLE IF NOT EXISTS brush_library_records (
          id TEXT NOT NULL PRIMARY KEY,
          name TEXT NOT NULL,
          brush_id TEXT NOT NULL,
          category TEXT NOT NULL,
          search_text TEXT NOT NULL,
          payload TEXT NOT NULL,
          pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
          activity_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_used_at INTEGER,
          CHECK (last_used_at IS NULL OR last_used_at = activity_at),
          CHECK (last_used_at IS NOT NULL OR updated_at = activity_at)
        )`,
        `CREATE INDEX IF NOT EXISTS brush_library_keyset_order
          ON brush_library_records (
            pinned DESC, activity_at DESC, created_at DESC, id ASC
          )`,
        `CREATE INDEX IF NOT EXISTS brush_library_category_keyset
          ON brush_library_records (
            category, pinned DESC, activity_at DESC, created_at DESC, id ASC
          )`,
      ]),
    },
    {
      toVersion: 4,
      statements: Object.freeze([
        `CREATE TABLE IF NOT EXISTS filter_library_records (
          id TEXT NOT NULL PRIMARY KEY,
          name TEXT NOT NULL,
          package_id TEXT NOT NULL,
          entry_id TEXT NOT NULL,
          engine TEXT NOT NULL,
          category TEXT NOT NULL,
          search_text TEXT NOT NULL,
          payload TEXT NOT NULL,
          favorite INTEGER NOT NULL CHECK (favorite IN (0, 1)),
          sort_order INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS filter_library_keyset_order
          ON filter_library_records (
            favorite DESC, sort_order ASC, updated_at DESC, id ASC
          )`,
        `CREATE INDEX IF NOT EXISTS filter_library_engine_keyset
          ON filter_library_records (
            engine, favorite DESC, sort_order ASC, updated_at DESC, id ASC
          )`,
        `CREATE INDEX IF NOT EXISTS filter_library_category_keyset
          ON filter_library_records (
            category, favorite DESC, sort_order ASC, updated_at DESC, id ASC
          )`,
        `CREATE INDEX IF NOT EXISTS filter_library_package_entry
          ON filter_library_records (package_id, entry_id)`,
      ]),
    },
    {
      toVersion: 5,
      statements: Object.freeze([
        `CREATE TABLE IF NOT EXISTS crdt_outbox_v12_entries (
          scope TEXT NOT NULL,
          work_id TEXT NOT NULL,
          update_id TEXT NOT NULL,
          client_sequence INTEGER NOT NULL CHECK (client_sequence >= 0),
          request_payload TEXT NOT NULL,
          payload_bytes INTEGER NOT NULL CHECK (payload_bytes > 0),
          created_at INTEGER NOT NULL CHECK (created_at >= 0),
          updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          last_attempt_at INTEGER CHECK (last_attempt_at IS NULL OR last_attempt_at >= 0),
          next_retry_at INTEGER CHECK (next_retry_at IS NULL OR next_retry_at >= 0),
          last_error_code TEXT,
          last_error_message TEXT,
          CHECK (
            (attempt_count = 0 AND last_attempt_at IS NULL AND next_retry_at IS NULL
              AND last_error_code IS NULL AND last_error_message IS NULL)
            OR
            (attempt_count > 0 AND last_attempt_at IS NOT NULL AND next_retry_at IS NOT NULL
              AND last_error_code IS NOT NULL AND last_error_message IS NOT NULL)
          ),
          PRIMARY KEY (scope, work_id, update_id)
        ) STRICT`,
        `CREATE INDEX IF NOT EXISTS crdt_outbox_v12_order
          ON crdt_outbox_v12_entries (
            scope, work_id, client_sequence ASC, created_at ASC, update_id ASC
          )`,
        `CREATE TABLE IF NOT EXISTS crdt_outbox_v12_acknowledgements (
          scope TEXT NOT NULL,
          work_id TEXT NOT NULL,
          update_id TEXT NOT NULL,
          acknowledged_at INTEGER NOT NULL CHECK (acknowledged_at >= 0),
          PRIMARY KEY (scope, work_id, update_id)
        ) STRICT`,
        `CREATE INDEX IF NOT EXISTS crdt_outbox_v12_ack_time
          ON crdt_outbox_v12_acknowledgements (
            scope, work_id, acknowledged_at ASC, update_id ASC
          )`,
      ]),
    },
    {
      toVersion: 6,
      statements: Object.freeze([
        `CREATE TABLE IF NOT EXISTS crdt_recovery_v12_rows (
          scope TEXT NOT NULL,
          work_id TEXT NOT NULL,
          row_key TEXT NOT NULL,
          row_kind TEXT NOT NULL CHECK (row_kind IN (
            'permanent-rejection', 'frontier-manifest', 'frontier-chunk', 'legacy-frontier'
          )),
          payload TEXT NOT NULL,
          payload_bytes INTEGER NOT NULL CHECK (payload_bytes > 0),
          updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
          PRIMARY KEY (scope, work_id, row_key)
        ) STRICT`,
        `CREATE INDEX IF NOT EXISTS crdt_recovery_v12_scope_order
          ON crdt_recovery_v12_rows (scope, work_id, row_key ASC)`,
      ]),
    },
  ]);

function readUserVersion(handle: StudioSqliteDatabaseHandle): number {
  const statement = handle.prepare("PRAGMA user_version");
  try {
    if (!statement.step()) {
      throw new Error("PRAGMA user_version returned no row");
    }
    const value = statement.get(0);
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new Error(`PRAGMA user_version returned a non-integer: ${String(value)}`);
    }
    return value;
  } finally {
    statement.finalize();
  }
}

/**
 * PRAGMA user_version 기반 순차 마이그레이션 러너. 각 버전은 단일 트랜잭션으로
 * 적용되고, 중간 실패 시 그 버전 전체가 롤백된 뒤 에러가 전파된다.
 * 이미 적용된 버전은 건너뛰므로 재개방 시 idempotent 하다.
 */
export function runStudioLocalDatabaseMigrations(
  handle: StudioSqliteDatabaseHandle,
  migrations: readonly StudioLocalDatabaseMigration[] = STUDIO_LOCAL_DATABASE_MIGRATIONS,
): number {
  let version = readUserVersion(handle);
  for (const migration of migrations) {
    if (migration.toVersion <= version) continue;
    if (migration.toVersion !== version + 1) {
      throw new Error(
        `studio local database migration chain is broken: at v${version}, ` +
          `next migration targets v${migration.toVersion}`,
      );
    }
    handle.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of migration.statements) {
        handle.exec(statement);
      }
      handle.exec(`PRAGMA user_version = ${migration.toVersion}`);
      handle.exec("COMMIT");
    } catch (error) {
      try {
        handle.exec("ROLLBACK");
      } catch {
        // 트랜잭션이 이미 SQLite 쪽에서 자동 롤백된 경우 — 원 에러가 우선한다.
      }
      throw error;
    }
    version = migration.toVersion;
  }
  return version;
}

export type StudioCostSampleKind = "warm" | "cold";

export interface StudioTournamentWinnerRecord {
  bucket: string;
  deviceHash: string;
  providerId: string;
  expectedWarmMs: number;
  decidedAtSample: number;
  updatedAt: number;
}

export interface StudioCostSampleRecord {
  id: number;
  providerId: string;
  bucket: string;
  kind: StudioCostSampleKind;
  ms: number;
  recordedAt: number;
}

/**
 * 구조화 로드용 raw 토너먼트 우승 후보 행 — 이 계층은 타입을 단정하지 않는다.
 * 오염 행의 드롭 정책은 호출자 검증기(parsePersistedTournamentState)가
 * 소유한다(부분 필드 오염이 전체 로드를 못 깨뜨리게).
 */
export interface StudioTournamentWinnerCandidate {
  bucket: unknown;
  deviceHash: unknown;
  providerId: unknown;
  expectedWarmMs: unknown;
  decidedAtSample: unknown;
}

/** two-slot 스냅샷 슬롯 컬럼 값(0=A, 1=B) — 스키마 CHECK 와 동일한 도메인. */
export type StudioJournalSnapshotSlot = 0 | 1;

export interface StudioJournalEntryRecord {
  seq: number;
  /** 저장 계층이 해석하지 않는 직렬화된 저널 엔트리(JSON). */
  payload: string;
  /** 엔트리가 이미 지니고 있는 CRC32(기존 entryCrc 산출값의 사본). */
  crc32: number;
}

export interface StudioJournalSnapshotRecord {
  slot: StudioJournalSnapshotSlot;
  seq: number;
  /** 저장 계층이 해석하지 않는 직렬화된 스냅샷(JSON). */
  payload: string;
  /** 스냅샷이 이미 지니고 있는 CRC32(기존 snapshotCrc 산출값의 사본). */
  crc32: number;
  updatedAt: number;
}

/**
 * 브러시 본문은 안정적인 Studio JSON payload로 보존하고, 아래 열은 SQLite가
 * 전체 payload를 역직렬화하지 않고 검색·정렬·keyset 페이지를 수행할 수 있게
 * 중복 저장한다. 어댑터는 읽을 때 payload와 인덱스 열의 일치를 검증한다.
 */
export interface StudioBrushLibrarySqlRecord {
  id: string;
  name: string;
  brushId: string;
  category: string;
  searchText: string;
  payload: string;
  pinned: boolean;
  activityAt: number;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
}

export interface StudioBrushLibrarySqlCursor {
  pinned: boolean;
  activityAt: number;
  createdAt: number;
  id: string;
}

export interface StudioBrushLibrarySqlQuery {
  /** 페이지 크기이며 저장 상한이 아니다. */
  limit: number;
  /** NFKC·소문자 정규화가 끝난 substring 검색어. */
  search: string;
  /** null이면 모든 렌더 패밀리. */
  category: string | null;
  /** null이면 고정 여부 무관. */
  pinned: boolean | null;
  after: StudioBrushLibrarySqlCursor | null;
}

export interface StudioBrushLibrarySqlPage {
  records: StudioBrushLibrarySqlRecord[];
  hasMore: boolean;
  /** after와 무관한 현재 필터 전체 행 수. */
  totalCount: number;
}

export interface StudioDeletedBrushLibrarySqlRecord {
  record: StudioBrushLibrarySqlRecord;
  /** 삭제 직전 결정적 정렬에서의 0-based 위치. */
  index: number;
}

/**
 * A stale higher-level mutation may restore a row only while the durable value still equals the
 * exact candidate that mutation wrote. The SQLite implementation compares and restores every
 * safe candidate in one transaction while preserving conflicting user mutations.
 */
export interface StudioBrushLibrarySqlCompareAndRestoreEntry {
  readonly id: string;
  readonly expected: StudioBrushLibrarySqlRecord;
  readonly restore: StudioBrushLibrarySqlRecord | null;
}

/**
 * 필터 본문은 canonical Studio preset JSON으로 보존하고, 검색·정렬 열은
 * SQLite가 payload 역직렬화 없이 무제한 카탈로그를 탐색하도록 중복 저장한다.
 * repository는 읽을 때 payload와 모든 인덱스 열의 일치를 검증한다.
 */
export interface StudioFilterLibrarySqlRecord {
  id: string;
  name: string;
  packageId: string;
  entryId: string;
  engine: string;
  category: string;
  searchText: string;
  payload: string;
  favorite: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface StudioFilterLibrarySqlCursor {
  favorite: boolean;
  sortOrder: number;
  updatedAt: number;
  id: string;
}

export interface StudioFilterLibrarySqlQuery {
  /** 페이지 크기이며 저장 상한이 아니다. */
  limit: number;
  /** NFKC·소문자 정규화가 끝난 substring 검색어. */
  search: string;
  category: string | null;
  engine: string | null;
  favorite: boolean | null;
  after: StudioFilterLibrarySqlCursor | null;
}

export interface StudioFilterLibrarySqlPage {
  records: StudioFilterLibrarySqlRecord[];
  hasMore: boolean;
  /** after와 무관한 현재 필터 전체 행 수. */
  totalCount: number;
}

export interface StudioDeletedFilterLibrarySqlRecord {
  record: StudioFilterLibrarySqlRecord;
  /** 삭제 직전 결정적 정렬에서의 0-based 위치. */
  index: number;
}

export interface StudioFilterLibrarySqlCompareAndRestoreEntry {
  readonly id: string;
  readonly expected: StudioFilterLibrarySqlRecord;
  readonly restore: StudioFilterLibrarySqlRecord | null;
}

export interface StudioKeyValueSqlCompareAndRestoreEntry {
  readonly namespace: string;
  readonly key: string;
  readonly expected: string | null;
  readonly restore: string | null;
}

export interface StudioSqlCompareAndRestoreResult {
  /** Rows / sidecars that still matched the stale mutation and were restored. */
  readonly restoredIds: readonly string[];
  /** Stable row ids preserved as newer mutations, or a sidecar key that blocked the whole restore. */
  readonly conflictIds: readonly string[];
}

/**
 * V12 CRDT outbox에 쓰는 검증 완료 row. requestPayload는 상위 outbox가 만든
 * canonical StudioCrdtUpdateRequest JSON이며, 이 계층은 CRDT 스키마를 재해석하지 않는다.
 */
export interface StudioCrdtOutboxSqlRecord {
  scope: string;
  workId: string;
  updateId: string;
  clientSequence: number;
  requestPayload: string;
  payloadBytes: number;
  createdAt: number;
  updatedAt: number;
  attemptCount: number;
  lastAttemptAt: number | null;
  nextRetryAt: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}

export type StudioCrdtOutboxSqlInsertRecord = Omit<
  StudioCrdtOutboxSqlRecord,
  | "updatedAt"
  | "attemptCount"
  | "lastAttemptAt"
  | "nextRetryAt"
  | "lastErrorCode"
  | "lastErrorMessage"
>;

/**
 * 손상 검출을 outbox 도메인 검증기에 맡기기 위한 raw 후보. SQLite affinity나 외부
 * 비트로트가 타입을 바꾼 행을 저장 계층에서 정상 row로 단정하지 않는다.
 */
export type StudioCrdtOutboxSqlCandidate = {
  [Key in keyof StudioCrdtOutboxSqlRecord]: unknown;
} & { acknowledgedAt: unknown };

export interface StudioCrdtOutboxSqlLimits {
  maxEntries: number;
  maxBytes: number;
}

export type StudioCrdtOutboxSqlEnqueueResult =
  | "inserted"
  | "already-present"
  | "acknowledged";

export interface StudioCrdtOutboxSqlRetryMetadata {
  attemptCount: number;
  attemptedAt: number;
  nextRetryAt: number;
  errorCode: string;
  errorMessage: string;
}

/** Queue 한도를 넘겨 기존 행을 지우는 대신 write 자체를 명시적으로 거부한다. */
export class StudioCrdtOutboxSqlCapacityError extends Error {
  readonly entryCount: number;
  readonly totalBytes: number;

  constructor(entryCount: number, totalBytes: number) {
    super(
      `studio CRDT outbox capacity exceeded: ${entryCount} entries, ${totalBytes} bytes`,
    );
    this.name = "StudioCrdtOutboxSqlCapacityError";
    this.entryCount = entryCount;
    this.totalBytes = totalBytes;
  }
}

export type StudioCrdtRecoverySqlRowKind =
  | "permanent-rejection"
  | "frontier-manifest"
  | "frontier-chunk"
  | "legacy-frontier";

export interface StudioCrdtRecoverySqlRecord {
  scope: string;
  workId: string;
  rowKey: string;
  rowKind: StudioCrdtRecoverySqlRowKind;
  payload: string;
  payloadBytes: number;
}

/** Raw candidate: the recovery domain validates payload identity and canonical shape fail-closed. */
export type StudioCrdtRecoverySqlCandidate = {
  [Key in keyof StudioCrdtRecoverySqlRecord]: unknown;
} & { updatedAt: unknown };

export interface StudioCrdtRecoverySqlLimits {
  maxRows: number;
  maxBytes: number;
  maxRowBytes: number;
}

/** Recovery rows are never evicted to make room for a newer rejected frontier. */
export class StudioCrdtRecoverySqlCapacityError extends Error {
  readonly rowCount: number;
  readonly totalBytes: number;

  constructor(rowCount: number, totalBytes: number) {
    super(
      `studio CRDT recovery capacity exceeded: ${rowCount} rows, ${totalBytes} bytes`,
    );
    this.name = "StudioCrdtRecoverySqlCapacityError";
    this.rowCount = rowCount;
    this.totalBytes = totalBytes;
  }
}

/** 코디네이터가 토너먼트 영속 포트에 접합하는 최소 async KV 어댑터. */
export interface StudioAsyncKeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface StudioLocalDatabase {
  kvGet(namespace: string, key: string): Promise<string | null>;
  kvSet(namespace: string, key: string, value: string): Promise<void>;
  kvDelete(namespace: string, key: string): Promise<void>;
  putTournamentWinner(
    winner: Omit<StudioTournamentWinnerRecord, "updatedAt">,
  ): Promise<void>;
  getTournamentWinner(
    bucket: string,
    deviceHash: string,
  ): Promise<StudioTournamentWinnerRecord | null>;
  listTournamentWinners(): Promise<StudioTournamentWinnerRecord[]>;
  /** 검증 없는 raw 우승 후보 행 — 오염 행 드롭 정책은 호출자 검증기 몫. */
  listTournamentWinnerCandidates(): Promise<StudioTournamentWinnerCandidate[]>;
  /**
   * 우승 테이블 전체를 단일 트랜잭션으로 교체한다(upsert + 고아 삭제).
   * 중간 실패 시 전체가 롤백되어 이전 상태가 그대로 남는다.
   */
  replaceTournamentWinners(
    winners: readonly Omit<StudioTournamentWinnerRecord, "updatedAt">[],
  ): Promise<void>;
  /** provider 의 우승 기록 전부 삭제. 삭제된 행 수를 돌려준다. */
  evictTournamentProvider(providerId: string): Promise<number>;
  recordCostSample(
    providerId: string,
    bucket: string,
    kind: StudioCostSampleKind,
    ms: number,
  ): Promise<void>;
  listCostSamples(
    providerId: string,
    bucket: string,
    limit?: number,
  ): Promise<StudioCostSampleRecord[]>;
  /**
   * 프로젝트 저널에 엔트리 1개를 단일 트랜잭션으로 추가한다. 같은 seq 이상에
   * 남아 있던 잔여 꼬리(복구가 논리적으로 잘라낸 torn/부패 엔트리)는 같은
   * 트랜잭션 안에서 물리 삭제되므로, 재개 후 replay 가 두 seq 를 볼 수 없다.
   */
  appendJournalEntry(projectId: string, entry: StudioJournalEntryRecord): Promise<void>;
  /** 프로젝트의 저널 엔트리 전부(seq 오름차순). */
  listJournalEntries(projectId: string): Promise<StudioJournalEntryRecord[]>;
  /** 스냅샷이 덮은 seq 미만 엔트리 삭제(compaction). 삭제 행 수를 돌려준다. */
  deleteJournalEntriesBefore(projectId: string, seq: number): Promise<number>;
  /** (project, slot) 기준 upsert — two-slot A/B 교대는 호출자가 결정한다. */
  putJournalSnapshot(
    projectId: string,
    snapshot: Omit<StudioJournalSnapshotRecord, "updatedAt">,
  ): Promise<void>;
  /** 프로젝트의 스냅샷 슬롯 전부(slot 오름차순, 최대 2행). */
  listJournalSnapshots(projectId: string): Promise<StudioJournalSnapshotRecord[]>;
  asAsyncKeyValueStore(namespace: string): StudioAsyncKeyValueStore;
  close(): Promise<void>;
}

/**
 * 브러시 제품 lane이 요구하는 구조화 SQL 표면. 기존 테스트 double과 다른 저장
 * 소비자가 불필요하게 이 도메인 API를 구현하지 않도록 기본 DB 포트와 분리한다.
 */
export interface StudioBrushLibraryDatabase extends StudioLocalDatabase {
  queryBrushLibraryRecords(
    query: StudioBrushLibrarySqlQuery,
  ): Promise<StudioBrushLibrarySqlPage>;
  getBrushLibraryRecord(id: string): Promise<StudioBrushLibrarySqlRecord | null>;
  putBrushLibraryRecord(record: StudioBrushLibrarySqlRecord): Promise<void>;
  putBrushLibraryRecords(records: readonly StudioBrushLibrarySqlRecord[]): Promise<void>;
  compareAndRestoreBrushLibraryRecords(
    entries: readonly StudioBrushLibrarySqlCompareAndRestoreEntry[],
    sidecars?: readonly StudioKeyValueSqlCompareAndRestoreEntry[],
  ): Promise<StudioSqlCompareAndRestoreResult>;
  /** 레거시 최초 병합 전용 — 기존 SQL 행은 절대 덮어쓰지 않는다. */
  insertMissingBrushLibraryRecords(
    records: readonly StudioBrushLibrarySqlRecord[],
  ): Promise<number>;
  deleteBrushLibraryRecord(id: string): Promise<StudioDeletedBrushLibrarySqlRecord | null>;
  listBrushLibraryNames(): Promise<string[]>;
}

/** 필터 카탈로그 v4가 요구하는 구조화 SQL 표면. */
export interface StudioFilterLibraryDatabase extends StudioLocalDatabase {
  queryFilterLibraryRecords(
    query: StudioFilterLibrarySqlQuery,
  ): Promise<StudioFilterLibrarySqlPage>;
  getFilterLibraryRecord(id: string): Promise<StudioFilterLibrarySqlRecord | null>;
  putFilterLibraryRecord(record: StudioFilterLibrarySqlRecord): Promise<void>;
  putFilterLibraryRecords(records: readonly StudioFilterLibrarySqlRecord[]): Promise<void>;
  compareAndRestoreFilterLibraryRecords(
    entries: readonly StudioFilterLibrarySqlCompareAndRestoreEntry[],
  ): Promise<StudioSqlCompareAndRestoreResult>;
  /** 레거시 최초 병합 전용 — 기존 SQL 행은 절대 덮어쓰지 않는다. */
  insertMissingFilterLibraryRecords(
    records: readonly StudioFilterLibrarySqlRecord[],
  ): Promise<number>;
  deleteFilterLibraryRecord(
    id: string,
  ): Promise<StudioDeletedFilterLibrarySqlRecord | null>;
  /** 여러 id를 단일 트랜잭션으로 삭제한다. */
  deleteFilterLibraryRecords(ids: readonly string[]): Promise<number>;
}

/** CRDT outbox v5가 요구하는 구조화·트랜잭션 SQL 표면. */
export interface StudioCrdtOutboxDatabase extends StudioLocalDatabase {
  listCrdtOutboxCandidates(
    scope: string,
    workId: string,
  ): Promise<StudioCrdtOutboxSqlCandidate[]>;
  enqueueCrdtOutboxRecord(
    record: StudioCrdtOutboxSqlInsertRecord,
    limits: StudioCrdtOutboxSqlLimits,
  ): Promise<StudioCrdtOutboxSqlEnqueueResult>;
  acknowledgeCrdtOutboxRecord(
    scope: string,
    workId: string,
    updateId: string,
    acknowledgedAt: number,
  ): Promise<boolean>;
  recordCrdtOutboxRetry(
    scope: string,
    workId: string,
    updateId: string,
    metadata: StudioCrdtOutboxSqlRetryMetadata,
  ): Promise<boolean>;
}

/** CRDT recovery vault v6 structured, bounded SQL surface. */
export interface StudioCrdtRecoveryDatabase extends StudioLocalDatabase {
  listCrdtRecoveryCandidates(
    scope: string,
    workId: string,
  ): Promise<StudioCrdtRecoverySqlCandidate[]>;
  getCrdtRecoveryCandidate(
    scope: string,
    workId: string,
    rowKey: string,
  ): Promise<StudioCrdtRecoverySqlCandidate | null>;
  putCrdtRecoveryRecord(
    record: StudioCrdtRecoverySqlRecord,
    limits: StudioCrdtRecoverySqlLimits,
  ): Promise<void>;
}

const BRUSH_DATABASE_METHODS = Object.freeze([
  "queryBrushLibraryRecords",
  "getBrushLibraryRecord",
  "putBrushLibraryRecord",
  "putBrushLibraryRecords",
  "compareAndRestoreBrushLibraryRecords",
  "insertMissingBrushLibraryRecords",
  "deleteBrushLibraryRecord",
  "listBrushLibraryNames",
] as const);

/** 공유 DB 런타임에서 브러시 v3 표면을 fail-closed로 좁힌다. */
export function requireStudioBrushLibraryDatabase(
  database: StudioLocalDatabase,
): StudioBrushLibraryDatabase {
  const candidate = database as StudioLocalDatabase & Record<string, unknown>;
  const missing = BRUSH_DATABASE_METHODS.filter(
    (method) => typeof candidate[method] !== "function",
  );
  if (missing.length > 0) {
    throw new Error(
      `studio local database is missing brush-library v3 methods: ${missing.join(", ")}`,
    );
  }
  return database as StudioBrushLibraryDatabase;
}

const FILTER_DATABASE_METHODS = Object.freeze([
  "queryFilterLibraryRecords",
  "getFilterLibraryRecord",
  "putFilterLibraryRecord",
  "putFilterLibraryRecords",
  "compareAndRestoreFilterLibraryRecords",
  "insertMissingFilterLibraryRecords",
  "deleteFilterLibraryRecord",
  "deleteFilterLibraryRecords",
] as const);

/** 공유 DB 런타임에서 필터 카탈로그 v4 표면을 fail-closed로 좁힌다. */
export function requireStudioFilterLibraryDatabase(
  database: StudioLocalDatabase,
): StudioFilterLibraryDatabase {
  const candidate = database as StudioLocalDatabase & Record<string, unknown>;
  const missing = FILTER_DATABASE_METHODS.filter(
    (method) => typeof candidate[method] !== "function",
  );
  if (missing.length > 0) {
    throw new Error(
      `studio local database is missing filter-library v4 methods: ${missing.join(", ")}`,
    );
  }
  return database as StudioFilterLibraryDatabase;
}

const CRDT_OUTBOX_DATABASE_METHODS = Object.freeze([
  "listCrdtOutboxCandidates",
  "enqueueCrdtOutboxRecord",
  "acknowledgeCrdtOutboxRecord",
  "recordCrdtOutboxRetry",
] as const);

/** 공유 DB 런타임에서 CRDT outbox v5 표면을 fail-closed로 좁힌다. */
export function requireStudioCrdtOutboxDatabase(
  database: StudioLocalDatabase,
): StudioCrdtOutboxDatabase {
  const candidate = database as StudioLocalDatabase & Record<string, unknown>;
  const missing = CRDT_OUTBOX_DATABASE_METHODS.filter(
    (method) => typeof candidate[method] !== "function",
  );
  if (missing.length > 0) {
    throw new Error(
      `studio local database is missing CRDT-outbox v5 methods: ${missing.join(", ")}`,
    );
  }
  return database as StudioCrdtOutboxDatabase;
}

const CRDT_RECOVERY_DATABASE_METHODS = Object.freeze([
  "listCrdtRecoveryCandidates",
  "getCrdtRecoveryCandidate",
  "putCrdtRecoveryRecord",
] as const);

/** Shared runtime capability check; absence is a degraded durability failure, never a KV fallback. */
export function requireStudioCrdtRecoveryDatabase(
  database: StudioLocalDatabase,
): StudioCrdtRecoveryDatabase {
  const candidate = database as StudioLocalDatabase & Record<string, unknown>;
  const missing = CRDT_RECOVERY_DATABASE_METHODS.filter(
    (method) => typeof candidate[method] !== "function",
  );
  if (missing.length > 0) {
    throw new Error(
      `studio local database is missing CRDT-recovery v6 methods: ${missing.join(", ")}`,
    );
  }
  return database as StudioCrdtRecoveryDatabase;
}

export interface OpenStudioLocalDatabaseOptions {
  /**
   * "opfs"(기본, 브라우저 전용) 또는 "memory"(테스트/노드에서 스키마·쿼리
   * 검증용 ":memory:" DB).
   */
  vfs?: "opfs" | "memory";
  /**
   * 테스트 전용 wasm 메모리 VFS 파일명. 같은 sqlite API와 이름으로 다시 열면
   * close/reopen 영속 계약을 검증할 수 있다. OPFS 경로에는 적용되지 않는다.
   */
  memoryFilename?: string;
  /** 테스트 시임 — sqlite-wasm 로더 대체(실패 주입 포함). */
  loadSqlite?: () => Promise<StudioSqliteApiHandle>;
  /** updated_at/recorded_at 스탬프 클럭(기본 Date.now). */
  now?: () => number;
}

export interface StudioSqliteSupportProbe {
  wasm: boolean;
  opfs: boolean;
  reason?: string;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

const DEFAULT_COST_SAMPLE_LIMIT = 100;

const KV_GET_SQL = "SELECT value FROM kv WHERE namespace = ? AND key = ?";
const KV_SET_SQL = `INSERT INTO kv (namespace, key, value, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT (namespace, key)
  DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;
const KV_DELETE_SQL = "DELETE FROM kv WHERE namespace = ? AND key = ?";
const WINNER_PUT_SQL = `INSERT INTO tournament_winners
  (bucket, device_hash, provider_id, expected_warm_ms, decided_at_sample, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (bucket, device_hash)
  DO UPDATE SET
    provider_id = excluded.provider_id,
    expected_warm_ms = excluded.expected_warm_ms,
    decided_at_sample = excluded.decided_at_sample,
    updated_at = excluded.updated_at`;
const WINNER_COLUMNS =
  "bucket, device_hash, provider_id, expected_warm_ms, decided_at_sample, updated_at";
const WINNER_GET_SQL = `SELECT ${WINNER_COLUMNS} FROM tournament_winners
  WHERE bucket = ? AND device_hash = ?`;
const WINNER_LIST_SQL = `SELECT ${WINNER_COLUMNS} FROM tournament_winners
  ORDER BY bucket, device_hash`;
const WINNER_EVICT_SQL = "DELETE FROM tournament_winners WHERE provider_id = ?";
const WINNER_DELETE_ALL_SQL = "DELETE FROM tournament_winners";
const COST_SAMPLE_INSERT_SQL = `INSERT INTO cost_samples
  (provider_id, bucket, kind, ms, recorded_at) VALUES (?, ?, ?, ?, ?)`;
const COST_SAMPLE_LIST_SQL = `SELECT id, provider_id, bucket, kind, ms, recorded_at
  FROM cost_samples WHERE provider_id = ? AND bucket = ?
  ORDER BY recorded_at DESC, id DESC LIMIT ?`;
const JOURNAL_DELETE_TAIL_SQL =
  "DELETE FROM journal_entries WHERE project_id = ? AND seq >= ?";
const JOURNAL_INSERT_SQL = `INSERT INTO journal_entries
  (project_id, seq, payload, crc32) VALUES (?, ?, ?, ?)`;
const JOURNAL_LIST_SQL = `SELECT seq, payload, crc32 FROM journal_entries
  WHERE project_id = ? ORDER BY seq`;
const JOURNAL_COMPACT_SQL =
  "DELETE FROM journal_entries WHERE project_id = ? AND seq < ?";
const SNAPSHOT_PUT_SQL = `INSERT INTO snapshots
  (project_id, slot, seq, payload, crc32, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (project_id, slot)
  DO UPDATE SET
    seq = excluded.seq,
    payload = excluded.payload,
    crc32 = excluded.crc32,
    updated_at = excluded.updated_at`;
const SNAPSHOT_LIST_SQL = `SELECT slot, seq, payload, crc32, updated_at
  FROM snapshots WHERE project_id = ? ORDER BY slot`;
const BRUSH_RECORD_COLUMNS = `id, name, brush_id, category, search_text, payload,
  pinned, activity_at, created_at, updated_at, last_used_at`;
const BRUSH_RECORD_GET_SQL = `SELECT ${BRUSH_RECORD_COLUMNS}
  FROM brush_library_records WHERE id = ?`;
const BRUSH_RECORD_PUT_SQL = `INSERT INTO brush_library_records
  (id, name, brush_id, category, search_text, payload, pinned, activity_at,
    created_at, updated_at, last_used_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET
    name = excluded.name,
    brush_id = excluded.brush_id,
    category = excluded.category,
    search_text = excluded.search_text,
    payload = excluded.payload,
    pinned = excluded.pinned,
    activity_at = excluded.activity_at,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    last_used_at = excluded.last_used_at`;
const BRUSH_RECORD_INSERT_MISSING_SQL = `INSERT INTO brush_library_records
  (id, name, brush_id, category, search_text, payload, pinned, activity_at,
    created_at, updated_at, last_used_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO NOTHING`;
const BRUSH_RECORD_DELETE_SQL = "DELETE FROM brush_library_records WHERE id = ?";
const BRUSH_RECORD_NAMES_SQL = "SELECT name FROM brush_library_records ORDER BY name, id";
const BRUSH_RECORD_ORDER_SQL =
  "pinned DESC, activity_at DESC, created_at DESC, id ASC";
const FILTER_RECORD_COLUMNS = `id, name, package_id, entry_id, engine, category,
  search_text, payload, favorite, sort_order, created_at, updated_at`;
const FILTER_RECORD_GET_SQL = `SELECT ${FILTER_RECORD_COLUMNS}
  FROM filter_library_records WHERE id = ?`;
const FILTER_RECORD_PUT_SQL = `INSERT INTO filter_library_records
  (id, name, package_id, entry_id, engine, category, search_text, payload,
    favorite, sort_order, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET
    name = excluded.name,
    package_id = excluded.package_id,
    entry_id = excluded.entry_id,
    engine = excluded.engine,
    category = excluded.category,
    search_text = excluded.search_text,
    payload = excluded.payload,
    favorite = excluded.favorite,
    sort_order = excluded.sort_order,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at`;
const FILTER_RECORD_INSERT_MISSING_SQL = `INSERT INTO filter_library_records
  (id, name, package_id, entry_id, engine, category, search_text, payload,
    favorite, sort_order, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO NOTHING`;
const FILTER_RECORD_DELETE_SQL = "DELETE FROM filter_library_records WHERE id = ?";
const FILTER_RECORD_ORDER_SQL =
  "favorite DESC, sort_order ASC, updated_at DESC, id ASC";
const CRDT_OUTBOX_COLUMNS = `entry.scope, entry.work_id, entry.update_id,
  entry.client_sequence, entry.request_payload, entry.payload_bytes, entry.created_at,
  entry.updated_at, entry.attempt_count, entry.last_attempt_at, entry.next_retry_at,
  entry.last_error_code, entry.last_error_message`;
const CRDT_OUTBOX_LIST_SQL = `SELECT ${CRDT_OUTBOX_COLUMNS}, acknowledgement.acknowledged_at
  FROM crdt_outbox_v12_entries AS entry
  LEFT JOIN crdt_outbox_v12_acknowledgements AS acknowledgement
    ON acknowledgement.scope = entry.scope
      AND acknowledgement.work_id = entry.work_id
      AND acknowledgement.update_id = entry.update_id
  WHERE entry.scope = ? AND entry.work_id = ?
  ORDER BY entry.client_sequence ASC, entry.created_at ASC, entry.update_id ASC`;
const CRDT_OUTBOX_GET_SQL = `SELECT ${CRDT_OUTBOX_COLUMNS}
  FROM crdt_outbox_v12_entries AS entry
  WHERE entry.scope = ? AND entry.work_id = ? AND entry.update_id = ?`;
const CRDT_OUTBOX_ACK_GET_SQL = `SELECT acknowledged_at
  FROM crdt_outbox_v12_acknowledgements
  WHERE scope = ? AND work_id = ? AND update_id = ?`;
const CRDT_OUTBOX_USAGE_SQL = `SELECT COUNT(*), COALESCE(SUM(payload_bytes), 0)
  FROM crdt_outbox_v12_entries
  WHERE scope = ? AND work_id = ?`;
const CRDT_OUTBOX_INSERT_SQL = `INSERT INTO crdt_outbox_v12_entries
  (scope, work_id, update_id, client_sequence, request_payload, payload_bytes,
    created_at, updated_at, attempt_count, last_attempt_at, next_retry_at,
    last_error_code, last_error_message)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL)`;
const CRDT_OUTBOX_ACK_SQL = `INSERT INTO crdt_outbox_v12_acknowledgements
  (scope, work_id, update_id, acknowledged_at) VALUES (?, ?, ?, ?)
  ON CONFLICT (scope, work_id, update_id) DO UPDATE SET
    acknowledged_at = MIN(acknowledged_at, excluded.acknowledged_at)`;
const CRDT_OUTBOX_DELETE_SQL = `DELETE FROM crdt_outbox_v12_entries
  WHERE scope = ? AND work_id = ? AND update_id = ?`;
const CRDT_OUTBOX_RETRY_SQL = `UPDATE crdt_outbox_v12_entries SET
    attempt_count = ?, last_attempt_at = ?, next_retry_at = ?,
    last_error_code = ?, last_error_message = ?, updated_at = ?
  WHERE scope = ? AND work_id = ? AND update_id = ?
    AND attempt_count <= ?
    AND NOT EXISTS (
      SELECT 1 FROM crdt_outbox_v12_acknowledgements AS acknowledgement
      WHERE acknowledgement.scope = crdt_outbox_v12_entries.scope
        AND acknowledgement.work_id = crdt_outbox_v12_entries.work_id
        AND acknowledgement.update_id = crdt_outbox_v12_entries.update_id
    )`;
const CRDT_RECOVERY_COLUMNS =
  "scope, work_id, row_key, row_kind, payload, payload_bytes, updated_at";
const CRDT_RECOVERY_LIST_SQL = `SELECT ${CRDT_RECOVERY_COLUMNS}
  FROM crdt_recovery_v12_rows
  WHERE scope = ? AND work_id = ?
  ORDER BY row_key ASC`;
const CRDT_RECOVERY_GET_SQL = `SELECT ${CRDT_RECOVERY_COLUMNS}
  FROM crdt_recovery_v12_rows
  WHERE scope = ? AND work_id = ? AND row_key = ?`;
const CRDT_RECOVERY_USAGE_SQL = `SELECT COUNT(*), COALESCE(SUM(payload_bytes), 0)
  FROM crdt_recovery_v12_rows
  WHERE scope = ? AND work_id = ?`;
const CRDT_RECOVERY_PUT_SQL = `INSERT INTO crdt_recovery_v12_rows
  (scope, work_id, row_key, row_kind, payload, payload_bytes, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (scope, work_id, row_key) DO UPDATE SET
    row_kind = excluded.row_kind,
    payload = excluded.payload,
    payload_bytes = excluded.payload_bytes,
    updated_at = excluded.updated_at`;

function expectString(value: unknown, column: string): string {
  if (typeof value !== "string") {
    throw new Error(`studio local database: column ${column} is not TEXT`);
  }
  return value;
}

function expectNumber(value: unknown, column: string): number {
  if (typeof value !== "number") {
    throw new Error(`studio local database: column ${column} is not numeric`);
  }
  return value;
}

function rowToWinner(row: readonly unknown[]): StudioTournamentWinnerRecord {
  return {
    bucket: expectString(row[0], "bucket"),
    deviceHash: expectString(row[1], "device_hash"),
    providerId: expectString(row[2], "provider_id"),
    expectedWarmMs: expectNumber(row[3], "expected_warm_ms"),
    decidedAtSample: expectNumber(row[4], "decided_at_sample"),
    updatedAt: expectNumber(row[5], "updated_at"),
  };
}

function rowToWinnerCandidate(row: readonly unknown[]): StudioTournamentWinnerCandidate {
  return {
    bucket: row[0],
    deviceHash: row[1],
    providerId: row[2],
    expectedWarmMs: row[3],
    decidedAtSample: row[4],
  };
}

function rowToJournalEntry(row: readonly unknown[]): StudioJournalEntryRecord {
  return {
    seq: expectNumber(row[0], "seq"),
    payload: expectString(row[1], "payload"),
    crc32: expectNumber(row[2], "crc32"),
  };
}

function rowToJournalSnapshot(row: readonly unknown[]): StudioJournalSnapshotRecord {
  const slot = expectNumber(row[0], "slot");
  if (slot !== 0 && slot !== 1) {
    throw new Error(`studio local database: unexpected snapshot slot ${slot}`);
  }
  return {
    slot,
    seq: expectNumber(row[1], "seq"),
    payload: expectString(row[2], "payload"),
    crc32: expectNumber(row[3], "crc32"),
    updatedAt: expectNumber(row[4], "updated_at"),
  };
}

function rowToCostSample(row: readonly unknown[]): StudioCostSampleRecord {
  const kind = expectString(row[3], "kind");
  if (kind !== "warm" && kind !== "cold") {
    throw new Error(`studio local database: unexpected cost sample kind ${kind}`);
  }
  return {
    id: expectNumber(row[0], "id"),
    providerId: expectString(row[1], "provider_id"),
    bucket: expectString(row[2], "bucket"),
    kind,
    ms: expectNumber(row[4], "ms"),
    recordedAt: expectNumber(row[5], "recorded_at"),
  };
}

function expectNullableNumber(value: unknown, column: string): number | null {
  if (value === null) return null;
  return expectNumber(value, column);
}

function rowToBrushLibraryRecord(row: readonly unknown[]): StudioBrushLibrarySqlRecord {
  const pinned = expectNumber(row[6], "pinned");
  if (pinned !== 0 && pinned !== 1) {
    throw new Error(`studio local database: unexpected brush pinned value ${pinned}`);
  }
  return {
    id: expectString(row[0], "id"),
    name: expectString(row[1], "name"),
    brushId: expectString(row[2], "brush_id"),
    category: expectString(row[3], "category"),
    searchText: expectString(row[4], "search_text"),
    payload: expectString(row[5], "payload"),
    pinned: pinned === 1,
    activityAt: expectNumber(row[7], "activity_at"),
    createdAt: expectNumber(row[8], "created_at"),
    updatedAt: expectNumber(row[9], "updated_at"),
    lastUsedAt: expectNullableNumber(row[10], "last_used_at"),
  };
}

function rowToFilterLibraryRecord(row: readonly unknown[]): StudioFilterLibrarySqlRecord {
  const favorite = expectNumber(row[8], "favorite");
  if (favorite !== 0 && favorite !== 1) {
    throw new Error(`studio local database: unexpected filter favorite value ${favorite}`);
  }
  return {
    id: expectString(row[0], "id"),
    name: expectString(row[1], "name"),
    packageId: expectString(row[2], "package_id"),
    entryId: expectString(row[3], "entry_id"),
    engine: expectString(row[4], "engine"),
    category: expectString(row[5], "category"),
    searchText: expectString(row[6], "search_text"),
    payload: expectString(row[7], "payload"),
    favorite: favorite === 1,
    sortOrder: expectNumber(row[9], "sort_order"),
    createdAt: expectNumber(row[10], "created_at"),
    updatedAt: expectNumber(row[11], "updated_at"),
  };
}

function rowToCrdtOutboxCandidate(
  row: readonly unknown[],
): StudioCrdtOutboxSqlCandidate {
  return {
    scope: row[0],
    workId: row[1],
    updateId: row[2],
    clientSequence: row[3],
    requestPayload: row[4],
    payloadBytes: row[5],
    createdAt: row[6],
    updatedAt: row[7],
    attemptCount: row[8],
    lastAttemptAt: row[9],
    nextRetryAt: row[10],
    lastErrorCode: row[11],
    lastErrorMessage: row[12],
    acknowledgedAt: row[13],
  };
}

function rowToCrdtRecoveryCandidate(
  row: readonly unknown[],
): StudioCrdtRecoverySqlCandidate {
  return {
    scope: row[0],
    workId: row[1],
    rowKey: row[2],
    rowKind: row[3],
    payload: row[4],
    payloadBytes: row[5],
    updatedAt: row[6],
  };
}

function brushRecordBindValues(
  record: StudioBrushLibrarySqlRecord,
): readonly StudioSqliteBindValue[] {
  return [
    record.id,
    record.name,
    record.brushId,
    record.category,
    record.searchText,
    record.payload,
    record.pinned ? 1 : 0,
    record.activityAt,
    record.createdAt,
    record.updatedAt,
    record.lastUsedAt,
  ];
}

function filterRecordBindValues(
  record: StudioFilterLibrarySqlRecord,
): readonly StudioSqliteBindValue[] {
  return [
    record.id,
    record.name,
    record.packageId,
    record.entryId,
    record.engine,
    record.category,
    record.searchText,
    record.payload,
    record.favorite ? 1 : 0,
    record.sortOrder,
    record.createdAt,
    record.updatedAt,
  ];
}

function sameSqlBindValues(
  left: readonly StudioSqliteBindValue[],
  right: readonly StudioSqliteBindValue[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]));
}

function sameBrushLibraryRecord(
  left: StudioBrushLibrarySqlRecord,
  right: StudioBrushLibrarySqlRecord,
): boolean {
  return sameSqlBindValues(brushRecordBindValues(left), brushRecordBindValues(right));
}

function sameFilterLibraryRecord(
  left: StudioFilterLibrarySqlRecord,
  right: StudioFilterLibrarySqlRecord,
): boolean {
  return sameSqlBindValues(filterRecordBindValues(left), filterRecordBindValues(right));
}

function assertCompareAndRestoreRecordEntries<
  T extends { readonly id: string; readonly expected: { readonly id: string }; readonly restore: { readonly id: string } | null },
>(entries: readonly T[], kind: string): void {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (
      entry.id.length === 0
      || entry.expected.id !== entry.id
      || (entry.restore !== null && entry.restore.id !== entry.id)
      || ids.has(entry.id)
    ) {
      throw new Error(`studio local database: invalid ${kind} compare-and-restore entry`);
    }
    ids.add(entry.id);
  }
}

function assertCompareAndRestoreSidecars(
  sidecars: readonly StudioKeyValueSqlCompareAndRestoreEntry[],
): void {
  const keys = new Set<string>();
  for (const sidecar of sidecars) {
    const identity = `${sidecar.namespace}\u0000${sidecar.key}`;
    if (sidecar.namespace.length === 0 || sidecar.key.length === 0 || keys.has(identity)) {
      throw new Error("studio local database: invalid KV compare-and-restore entry");
    }
    keys.add(identity);
  }
}

class SqliteStudioLocalDatabase implements
  StudioBrushLibraryDatabase,
  StudioFilterLibraryDatabase,
  StudioCrdtOutboxDatabase,
  StudioCrdtRecoveryDatabase
{
  private readonly statements = new Map<string, StudioSqliteStatementHandle>();
  private closed = false;

  constructor(
    private readonly handle: StudioSqliteDatabaseHandle,
    private readonly now: () => number,
  ) {}

  private statement(sql: string): StudioSqliteStatementHandle {
    if (this.closed) {
      throw new Error("studio local database is closed");
    }
    let statement = this.statements.get(sql);
    if (statement === undefined) {
      statement = this.handle.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  private run(sql: string, params: readonly StudioSqliteBindValue[]): void {
    const statement = this.statement(sql);
    try {
      if (params.length > 0) statement.bind(params);
      while (statement.step()) {
        // 이 경로의 SQL 은 행을 돌려주지 않는다 — 완료까지 소진만 한다.
      }
    } catch (error) {
      throw wrapStudioSqliteStepError(error);
    } finally {
      try {
        statement.reset();
      } catch {
        // A corrupt image can fail reset; the wrapped step error is the authority.
      }
    }
  }

  /**
   * BEGIN IMMEDIATE 트랜잭션 안에서 여러 statement 를 실행한다.
   * 중간 실패 시 ROLLBACK 후 원 에러를 전파한다(마이그레이션 러너와 동일 규약).
   */
  private transaction(work: () => void): void {
    if (this.closed) {
      throw new Error("studio local database is closed");
    }
    this.handle.exec("BEGIN IMMEDIATE");
    try {
      work();
      this.handle.exec("COMMIT");
    } catch (error) {
      try {
        this.handle.exec("ROLLBACK");
      } catch {
        // 트랜잭션이 이미 SQLite 쪽에서 자동 롤백된 경우 — 원 에러가 우선한다.
      }
      throw error;
    }
  }

  private selectRows(
    sql: string,
    params: readonly StudioSqliteBindValue[],
    columnCount: number,
  ): unknown[][] {
    const statement = this.statement(sql);
    const rows: unknown[][] = [];
    try {
      if (params.length > 0) statement.bind(params);
      while (statement.step()) {
        const row: unknown[] = [];
        for (let index = 0; index < columnCount; index += 1) {
          row.push(statement.get(index));
        }
        rows.push(row);
      }
    } catch (error) {
      throw wrapStudioSqliteStepError(error);
    } finally {
      try {
        statement.reset();
      } catch {
        // Same as run(): keep the original step failure.
      }
    }
    return rows;
  }

  async kvGet(namespace: string, key: string): Promise<string | null> {
    const rows = this.selectRows(KV_GET_SQL, [namespace, key], 1);
    const first = rows[0];
    if (first === undefined) return null;
    return expectString(first[0], "value");
  }

  async kvSet(namespace: string, key: string, value: string): Promise<void> {
    this.run(KV_SET_SQL, [namespace, key, value, this.now()]);
  }

  async kvDelete(namespace: string, key: string): Promise<void> {
    this.run(KV_DELETE_SQL, [namespace, key]);
  }

  async putTournamentWinner(
    winner: Omit<StudioTournamentWinnerRecord, "updatedAt">,
  ): Promise<void> {
    this.run(WINNER_PUT_SQL, [
      winner.bucket,
      winner.deviceHash,
      winner.providerId,
      winner.expectedWarmMs,
      winner.decidedAtSample,
      this.now(),
    ]);
  }

  async getTournamentWinner(
    bucket: string,
    deviceHash: string,
  ): Promise<StudioTournamentWinnerRecord | null> {
    const rows = this.selectRows(WINNER_GET_SQL, [bucket, deviceHash], 6);
    const first = rows[0];
    if (first === undefined) return null;
    return rowToWinner(first);
  }

  async listTournamentWinners(): Promise<StudioTournamentWinnerRecord[]> {
    return this.selectRows(WINNER_LIST_SQL, [], 6).map(rowToWinner);
  }

  async listTournamentWinnerCandidates(): Promise<StudioTournamentWinnerCandidate[]> {
    return this.selectRows(WINNER_LIST_SQL, [], 6).map(rowToWinnerCandidate);
  }

  async replaceTournamentWinners(
    winners: readonly Omit<StudioTournamentWinnerRecord, "updatedAt">[],
  ): Promise<void> {
    const updatedAt = this.now();
    this.transaction(() => {
      // 전체 교체 = 새 집합의 upsert + 새 집합에 없는 고아 행 삭제. 두 단계를
      // 개별 SQL 로 흉내내는 대신 전삭제+재삽입으로 같은 결과를 원자적으로
      // 만든다(updated_at 은 어차피 매 save 마다 새로 스탬프된다).
      this.run(WINNER_DELETE_ALL_SQL, []);
      for (const winner of winners) {
        this.run(WINNER_PUT_SQL, [
          winner.bucket,
          winner.deviceHash,
          winner.providerId,
          winner.expectedWarmMs,
          winner.decidedAtSample,
          updatedAt,
        ]);
      }
    });
  }

  async evictTournamentProvider(providerId: string): Promise<number> {
    this.run(WINNER_EVICT_SQL, [providerId]);
    return this.handle.changes();
  }

  async recordCostSample(
    providerId: string,
    bucket: string,
    kind: StudioCostSampleKind,
    ms: number,
  ): Promise<void> {
    // kind 는 JS 에서 선검증하지 않는다 — 스키마의 CHECK 제약이 단일 진실이다.
    this.run(COST_SAMPLE_INSERT_SQL, [providerId, bucket, kind, ms, this.now()]);
  }

  async listCostSamples(
    providerId: string,
    bucket: string,
    limit: number = DEFAULT_COST_SAMPLE_LIMIT,
  ): Promise<StudioCostSampleRecord[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error(`studio local database: limit must be a positive integer, got ${limit}`);
    }
    return this.selectRows(COST_SAMPLE_LIST_SQL, [providerId, bucket, limit], 6).map(
      rowToCostSample,
    );
  }

  async appendJournalEntry(
    projectId: string,
    entry: StudioJournalEntryRecord,
  ): Promise<void> {
    this.transaction(() => {
      // 복구가 논리적으로 잘라낸 seq 이상의 잔여 꼬리를 물리 삭제한 뒤 새
      // 엔트리를 넣는다 — replay 가 같은 seq 의 부패본/재기록본을 동시에
      // 보는 일이 구조적으로 불가능해진다.
      this.run(JOURNAL_DELETE_TAIL_SQL, [projectId, entry.seq]);
      this.run(JOURNAL_INSERT_SQL, [projectId, entry.seq, entry.payload, entry.crc32]);
    });
  }

  async listJournalEntries(projectId: string): Promise<StudioJournalEntryRecord[]> {
    return this.selectRows(JOURNAL_LIST_SQL, [projectId], 3).map(rowToJournalEntry);
  }

  async deleteJournalEntriesBefore(projectId: string, seq: number): Promise<number> {
    this.run(JOURNAL_COMPACT_SQL, [projectId, seq]);
    return this.handle.changes();
  }

  async putJournalSnapshot(
    projectId: string,
    snapshot: Omit<StudioJournalSnapshotRecord, "updatedAt">,
  ): Promise<void> {
    this.run(SNAPSHOT_PUT_SQL, [
      projectId,
      snapshot.slot,
      snapshot.seq,
      snapshot.payload,
      snapshot.crc32,
      this.now(),
    ]);
  }

  async listJournalSnapshots(projectId: string): Promise<StudioJournalSnapshotRecord[]> {
    return this.selectRows(SNAPSHOT_LIST_SQL, [projectId], 5).map(rowToJournalSnapshot);
  }

  async queryBrushLibraryRecords(
    query: StudioBrushLibrarySqlQuery,
  ): Promise<StudioBrushLibrarySqlPage> {
    if (!Number.isSafeInteger(query.limit) || query.limit <= 0) {
      throw new Error(
        `studio local database: brush query limit must be a positive safe integer, got ${query.limit}`,
      );
    }
    const filters: string[] = [];
    const filterParams: StudioSqliteBindValue[] = [];
    if (query.category !== null) {
      filters.push("category = ?");
      filterParams.push(query.category);
    }
    if (query.pinned !== null) {
      filters.push("pinned = ?");
      filterParams.push(query.pinned ? 1 : 0);
    }
    if (query.search.length > 0) {
      filters.push("instr(search_text, ?) > 0");
      filterParams.push(query.search);
    }
    const filteredWhere = filters.length > 0 ? ` WHERE ${filters.join(" AND ")}` : "";
    const countRows = this.selectRows(
      `SELECT COUNT(*) FROM brush_library_records${filteredWhere}`,
      filterParams,
      1,
    );
    const totalCount = expectNumber(countRows[0]?.[0], "COUNT(*)");

    const pageFilters = [...filters];
    const pageParams = [...filterParams];
    if (query.after !== null) {
      const pinned = query.after.pinned ? 1 : 0;
      pageFilters.push(`(
        pinned < ?
        OR (pinned = ? AND activity_at < ?)
        OR (pinned = ? AND activity_at = ? AND created_at < ?)
        OR (pinned = ? AND activity_at = ? AND created_at = ? AND id > ?)
      )`);
      pageParams.push(
        pinned,
        pinned,
        query.after.activityAt,
        pinned,
        query.after.activityAt,
        query.after.createdAt,
        pinned,
        query.after.activityAt,
        query.after.createdAt,
        query.after.id,
      );
    }
    const pageWhere = pageFilters.length > 0 ? ` WHERE ${pageFilters.join(" AND ")}` : "";
    const rows = this.selectRows(
      `SELECT ${BRUSH_RECORD_COLUMNS} FROM brush_library_records${pageWhere}
        ORDER BY ${BRUSH_RECORD_ORDER_SQL} LIMIT ?`,
      [...pageParams, query.limit + 1],
      11,
    ).map(rowToBrushLibraryRecord);
    return {
      records: rows.slice(0, query.limit),
      hasMore: rows.length > query.limit,
      totalCount,
    };
  }

  async getBrushLibraryRecord(id: string): Promise<StudioBrushLibrarySqlRecord | null> {
    const row = this.selectRows(BRUSH_RECORD_GET_SQL, [id], 11)[0];
    return row === undefined ? null : rowToBrushLibraryRecord(row);
  }

  async putBrushLibraryRecord(record: StudioBrushLibrarySqlRecord): Promise<void> {
    this.run(BRUSH_RECORD_PUT_SQL, brushRecordBindValues(record));
  }

  async putBrushLibraryRecords(
    records: readonly StudioBrushLibrarySqlRecord[],
  ): Promise<void> {
    this.transaction(() => {
      for (const record of records) {
        this.run(BRUSH_RECORD_PUT_SQL, brushRecordBindValues(record));
      }
    });
  }

  async compareAndRestoreBrushLibraryRecords(
    entries: readonly StudioBrushLibrarySqlCompareAndRestoreEntry[],
    sidecars: readonly StudioKeyValueSqlCompareAndRestoreEntry[] = [],
  ): Promise<StudioSqlCompareAndRestoreResult> {
    assertCompareAndRestoreRecordEntries(entries, "brush-library");
    assertCompareAndRestoreSidecars(sidecars);
    const restoredIds: string[] = [];
    const conflictIds: string[] = [];
    this.transaction(() => {
      const sidecarsToRestore: StudioKeyValueSqlCompareAndRestoreEntry[] = [];
      for (const sidecar of sidecars) {
        const identity = `${sidecar.namespace}\u0000${sidecar.key}`;
        const row = this.selectRows(KV_GET_SQL, [sidecar.namespace, sidecar.key], 1)[0];
        const current = row === undefined ? null : expectString(row[0], "value");
        if (current === sidecar.restore) continue;
        if (current !== sidecar.expected) {
          // A newer package operation owns this sidecar. Do not restore any row from the stale
          // snapshot, even if an individual row still happens to equal its old install candidate.
          conflictIds.push(identity);
          return;
        }
        sidecarsToRestore.push(sidecar);
      }

      for (const entry of entries) {
        const row = this.selectRows(BRUSH_RECORD_GET_SQL, [entry.id], 11)[0];
        const current = row === undefined ? null : rowToBrushLibraryRecord(row);
        const alreadyRestored = current === null
          ? entry.restore === null
          : entry.restore !== null && sameBrushLibraryRecord(current, entry.restore);
        if (alreadyRestored) continue;
        if (current === null || !sameBrushLibraryRecord(current, entry.expected)) {
          conflictIds.push(entry.id);
          continue;
        }
        if (entry.restore === null) this.run(BRUSH_RECORD_DELETE_SQL, [entry.id]);
        else this.run(BRUSH_RECORD_PUT_SQL, brushRecordBindValues(entry.restore));
        restoredIds.push(entry.id);
      }
      for (const sidecar of sidecarsToRestore) {
        const identity = `${sidecar.namespace}\u0000${sidecar.key}`;
        if (sidecar.restore === null) {
          this.run(KV_DELETE_SQL, [sidecar.namespace, sidecar.key]);
        } else {
          this.run(KV_SET_SQL, [
            sidecar.namespace,
            sidecar.key,
            sidecar.restore,
            this.now(),
          ]);
        }
        restoredIds.push(identity);
      }
    });
    return { restoredIds, conflictIds };
  }

  async insertMissingBrushLibraryRecords(
    records: readonly StudioBrushLibrarySqlRecord[],
  ): Promise<number> {
    let inserted = 0;
    this.transaction(() => {
      for (const record of records) {
        this.run(BRUSH_RECORD_INSERT_MISSING_SQL, brushRecordBindValues(record));
        inserted += this.handle.changes();
      }
    });
    return inserted;
  }

  async deleteBrushLibraryRecord(
    id: string,
  ): Promise<StudioDeletedBrushLibrarySqlRecord | null> {
    let deleted: StudioDeletedBrushLibrarySqlRecord | null = null;
    this.transaction(() => {
      const row = this.selectRows(BRUSH_RECORD_GET_SQL, [id], 11)[0];
      if (row === undefined) return;
      const record = rowToBrushLibraryRecord(row);
      const pinned = record.pinned ? 1 : 0;
      const indexRows = this.selectRows(
        `SELECT COUNT(*) FROM brush_library_records WHERE
          pinned > ?
          OR (pinned = ? AND activity_at > ?)
          OR (pinned = ? AND activity_at = ? AND created_at > ?)
          OR (pinned = ? AND activity_at = ? AND created_at = ? AND id < ?)`,
        [
          pinned,
          pinned,
          record.activityAt,
          pinned,
          record.activityAt,
          record.createdAt,
          pinned,
          record.activityAt,
          record.createdAt,
          record.id,
        ],
        1,
      );
      const index = expectNumber(indexRows[0]?.[0], "COUNT(*)");
      this.run(BRUSH_RECORD_DELETE_SQL, [id]);
      deleted = { record, index };
    });
    return deleted;
  }

  async listBrushLibraryNames(): Promise<string[]> {
    return this.selectRows(BRUSH_RECORD_NAMES_SQL, [], 1).map((row) =>
      expectString(row[0], "name"),
    );
  }

  async queryFilterLibraryRecords(
    query: StudioFilterLibrarySqlQuery,
  ): Promise<StudioFilterLibrarySqlPage> {
    if (!Number.isSafeInteger(query.limit) || query.limit <= 0) {
      throw new Error(
        `studio local database: filter query limit must be a positive safe integer, got ${query.limit}`,
      );
    }
    const filters: string[] = [];
    const filterParams: StudioSqliteBindValue[] = [];
    if (query.category !== null) {
      filters.push("category = ?");
      filterParams.push(query.category);
    }
    if (query.engine !== null) {
      filters.push("engine = ?");
      filterParams.push(query.engine);
    }
    if (query.favorite !== null) {
      filters.push("favorite = ?");
      filterParams.push(query.favorite ? 1 : 0);
    }
    if (query.search.length > 0) {
      filters.push("instr(search_text, ?) > 0");
      filterParams.push(query.search);
    }
    const filteredWhere = filters.length > 0 ? ` WHERE ${filters.join(" AND ")}` : "";
    const countRows = this.selectRows(
      `SELECT COUNT(*) FROM filter_library_records${filteredWhere}`,
      filterParams,
      1,
    );
    const totalCount = expectNumber(countRows[0]?.[0], "COUNT(*)");

    const pageFilters = [...filters];
    const pageParams = [...filterParams];
    if (query.after !== null) {
      const favorite = query.after.favorite ? 1 : 0;
      pageFilters.push(`(
        favorite < ?
        OR (favorite = ? AND sort_order > ?)
        OR (favorite = ? AND sort_order = ? AND updated_at < ?)
        OR (favorite = ? AND sort_order = ? AND updated_at = ? AND id > ?)
      )`);
      pageParams.push(
        favorite,
        favorite,
        query.after.sortOrder,
        favorite,
        query.after.sortOrder,
        query.after.updatedAt,
        favorite,
        query.after.sortOrder,
        query.after.updatedAt,
        query.after.id,
      );
    }
    const pageWhere = pageFilters.length > 0 ? ` WHERE ${pageFilters.join(" AND ")}` : "";
    const rows = this.selectRows(
      `SELECT ${FILTER_RECORD_COLUMNS} FROM filter_library_records${pageWhere}
        ORDER BY ${FILTER_RECORD_ORDER_SQL} LIMIT ?`,
      [...pageParams, query.limit + 1],
      12,
    ).map(rowToFilterLibraryRecord);
    return {
      records: rows.slice(0, query.limit),
      hasMore: rows.length > query.limit,
      totalCount,
    };
  }

  async getFilterLibraryRecord(id: string): Promise<StudioFilterLibrarySqlRecord | null> {
    const row = this.selectRows(FILTER_RECORD_GET_SQL, [id], 12)[0];
    return row === undefined ? null : rowToFilterLibraryRecord(row);
  }

  async putFilterLibraryRecord(record: StudioFilterLibrarySqlRecord): Promise<void> {
    this.run(FILTER_RECORD_PUT_SQL, filterRecordBindValues(record));
  }

  async putFilterLibraryRecords(
    records: readonly StudioFilterLibrarySqlRecord[],
  ): Promise<void> {
    this.transaction(() => {
      for (const record of records) {
        this.run(FILTER_RECORD_PUT_SQL, filterRecordBindValues(record));
      }
    });
  }

  async compareAndRestoreFilterLibraryRecords(
    entries: readonly StudioFilterLibrarySqlCompareAndRestoreEntry[],
  ): Promise<StudioSqlCompareAndRestoreResult> {
    assertCompareAndRestoreRecordEntries(entries, "filter-library");
    const restoredIds: string[] = [];
    const conflictIds: string[] = [];
    this.transaction(() => {
      for (const entry of entries) {
        const row = this.selectRows(FILTER_RECORD_GET_SQL, [entry.id], 12)[0];
        const current = row === undefined ? null : rowToFilterLibraryRecord(row);
        const alreadyRestored = current === null
          ? entry.restore === null
          : entry.restore !== null && sameFilterLibraryRecord(current, entry.restore);
        if (alreadyRestored) continue;
        if (current === null || !sameFilterLibraryRecord(current, entry.expected)) {
          conflictIds.push(entry.id);
          continue;
        }
        if (entry.restore === null) this.run(FILTER_RECORD_DELETE_SQL, [entry.id]);
        else this.run(FILTER_RECORD_PUT_SQL, filterRecordBindValues(entry.restore));
        restoredIds.push(entry.id);
      }
    });
    return { restoredIds, conflictIds };
  }

  async insertMissingFilterLibraryRecords(
    records: readonly StudioFilterLibrarySqlRecord[],
  ): Promise<number> {
    let inserted = 0;
    this.transaction(() => {
      for (const record of records) {
        this.run(FILTER_RECORD_INSERT_MISSING_SQL, filterRecordBindValues(record));
        inserted += this.handle.changes();
      }
    });
    return inserted;
  }

  async deleteFilterLibraryRecord(
    id: string,
  ): Promise<StudioDeletedFilterLibrarySqlRecord | null> {
    let deleted: StudioDeletedFilterLibrarySqlRecord | null = null;
    this.transaction(() => {
      const row = this.selectRows(FILTER_RECORD_GET_SQL, [id], 12)[0];
      if (row === undefined) return;
      const record = rowToFilterLibraryRecord(row);
      const favorite = record.favorite ? 1 : 0;
      const indexRows = this.selectRows(
        `SELECT COUNT(*) FROM filter_library_records WHERE
          favorite > ?
          OR (favorite = ? AND sort_order < ?)
          OR (favorite = ? AND sort_order = ? AND updated_at > ?)
          OR (favorite = ? AND sort_order = ? AND updated_at = ? AND id < ?)`,
        [
          favorite,
          favorite,
          record.sortOrder,
          favorite,
          record.sortOrder,
          record.updatedAt,
          favorite,
          record.sortOrder,
          record.updatedAt,
          record.id,
        ],
        1,
      );
      const index = expectNumber(indexRows[0]?.[0], "COUNT(*)");
      this.run(FILTER_RECORD_DELETE_SQL, [id]);
      deleted = { record, index };
    });
    return deleted;
  }

  async deleteFilterLibraryRecords(ids: readonly string[]): Promise<number> {
    let deleted = 0;
    this.transaction(() => {
      for (const id of new Set(ids)) {
        this.run(FILTER_RECORD_DELETE_SQL, [id]);
        deleted += this.handle.changes();
      }
    });
    return deleted;
  }

  async listCrdtOutboxCandidates(
    scope: string,
    workId: string,
  ): Promise<StudioCrdtOutboxSqlCandidate[]> {
    return this.selectRows(CRDT_OUTBOX_LIST_SQL, [scope, workId], 14).map(
      rowToCrdtOutboxCandidate,
    );
  }

  async enqueueCrdtOutboxRecord(
    record: StudioCrdtOutboxSqlInsertRecord,
    limits: StudioCrdtOutboxSqlLimits,
  ): Promise<StudioCrdtOutboxSqlEnqueueResult> {
    if (!Number.isSafeInteger(limits.maxEntries) || limits.maxEntries <= 0) {
      throw new Error("studio CRDT outbox maxEntries must be a positive safe integer");
    }
    if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes <= 0) {
      throw new Error("studio CRDT outbox maxBytes must be a positive safe integer");
    }
    let result: StudioCrdtOutboxSqlEnqueueResult = "inserted";
    this.transaction(() => {
      const key = [record.scope, record.workId, record.updateId] as const;
      const acknowledgement = this.selectRows(CRDT_OUTBOX_ACK_GET_SQL, key, 1)[0];
      if (acknowledgement !== undefined) {
        const acknowledgedAt = expectNumber(
          acknowledgement[0],
          "crdt acknowledgement acknowledged_at",
        );
        if (!Number.isSafeInteger(acknowledgedAt) || acknowledgedAt < 0) {
          throw new Error("studio CRDT outbox acknowledgement timestamp is invalid");
        }
        result = "acknowledged";
        return;
      }
      const existing = this.selectRows(CRDT_OUTBOX_GET_SQL, key, 13)[0];
      if (existing !== undefined) {
        const existingRecord = rowToCrdtOutboxCandidate(existing);
        if (
          existingRecord.scope !== record.scope ||
          existingRecord.workId !== record.workId ||
          existingRecord.updateId !== record.updateId ||
          existingRecord.clientSequence !== record.clientSequence ||
          existingRecord.requestPayload !== record.requestPayload ||
          existingRecord.payloadBytes !== record.payloadBytes
        ) {
          throw new Error(
            "studio CRDT outbox update id conflicts with a different durable payload",
          );
        }
        result = "already-present";
        return;
      }
      const usage = this.selectRows(
        CRDT_OUTBOX_USAGE_SQL,
        [record.scope, record.workId],
        2,
      )[0];
      const entryCount = expectNumber(usage?.[0], "COUNT(*)") + 1;
      const totalBytes = expectNumber(usage?.[1], "SUM(payload_bytes)") + record.payloadBytes;
      if (entryCount > limits.maxEntries || totalBytes > limits.maxBytes) {
        throw new StudioCrdtOutboxSqlCapacityError(entryCount, totalBytes);
      }
      this.run(CRDT_OUTBOX_INSERT_SQL, [
        record.scope,
        record.workId,
        record.updateId,
        record.clientSequence,
        record.requestPayload,
        record.payloadBytes,
        record.createdAt,
        this.now(),
      ]);
    });
    return result;
  }

  async acknowledgeCrdtOutboxRecord(
    scope: string,
    workId: string,
    updateId: string,
    acknowledgedAt: number,
  ): Promise<boolean> {
    let removed = false;
    this.transaction(() => {
      this.run(CRDT_OUTBOX_ACK_SQL, [scope, workId, updateId, acknowledgedAt]);
      this.run(CRDT_OUTBOX_DELETE_SQL, [scope, workId, updateId]);
      removed = this.handle.changes() > 0;
    });
    return removed;
  }

  async recordCrdtOutboxRetry(
    scope: string,
    workId: string,
    updateId: string,
    metadata: StudioCrdtOutboxSqlRetryMetadata,
  ): Promise<boolean> {
    this.transaction(() => {
      this.run(CRDT_OUTBOX_RETRY_SQL, [
        metadata.attemptCount,
        metadata.attemptedAt,
        metadata.nextRetryAt,
        metadata.errorCode,
        metadata.errorMessage,
        this.now(),
        scope,
        workId,
        updateId,
        metadata.attemptCount,
      ]);
    });
    return this.handle.changes() > 0;
  }

  async listCrdtRecoveryCandidates(
    scope: string,
    workId: string,
  ): Promise<StudioCrdtRecoverySqlCandidate[]> {
    return this.selectRows(CRDT_RECOVERY_LIST_SQL, [scope, workId], 7).map(
      rowToCrdtRecoveryCandidate,
    );
  }

  async getCrdtRecoveryCandidate(
    scope: string,
    workId: string,
    rowKey: string,
  ): Promise<StudioCrdtRecoverySqlCandidate | null> {
    const row = this.selectRows(
      CRDT_RECOVERY_GET_SQL,
      [scope, workId, rowKey],
      7,
    )[0];
    return row === undefined ? null : rowToCrdtRecoveryCandidate(row);
  }

  async putCrdtRecoveryRecord(
    record: StudioCrdtRecoverySqlRecord,
    limits: StudioCrdtRecoverySqlLimits,
  ): Promise<void> {
    if (!Number.isSafeInteger(limits.maxRows) || limits.maxRows <= 0) {
      throw new Error("studio CRDT recovery maxRows must be a positive safe integer");
    }
    if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes <= 0) {
      throw new Error("studio CRDT recovery maxBytes must be a positive safe integer");
    }
    if (!Number.isSafeInteger(limits.maxRowBytes) || limits.maxRowBytes <= 0) {
      throw new Error("studio CRDT recovery maxRowBytes must be a positive safe integer");
    }
    if (!Number.isSafeInteger(record.payloadBytes) || record.payloadBytes <= 0) {
      throw new Error("studio CRDT recovery payloadBytes must be a positive safe integer");
    }
    if (record.payloadBytes > limits.maxRowBytes) {
      throw new StudioCrdtRecoverySqlCapacityError(1, record.payloadBytes);
    }

    this.transaction(() => {
      const key = [record.scope, record.workId, record.rowKey] as const;
      const existing = this.selectRows(CRDT_RECOVERY_GET_SQL, key, 7)[0];
      if (existing !== undefined && existing[3] !== record.rowKind) {
        throw new Error("studio CRDT recovery row key conflicts with a different row kind");
      }
      const usage = this.selectRows(
        CRDT_RECOVERY_USAGE_SQL,
        [record.scope, record.workId],
        2,
      )[0];
      const existingBytes = existing === undefined
        ? 0
        : expectNumber(existing[5], "crdt recovery payload_bytes");
      const rowCount = expectNumber(usage?.[0], "COUNT(*)") +
        (existing === undefined ? 1 : 0);
      const totalBytes = expectNumber(usage?.[1], "SUM(payload_bytes)") -
        existingBytes + record.payloadBytes;
      if (rowCount > limits.maxRows || totalBytes > limits.maxBytes) {
        throw new StudioCrdtRecoverySqlCapacityError(rowCount, totalBytes);
      }
      this.run(CRDT_RECOVERY_PUT_SQL, [
        record.scope,
        record.workId,
        record.rowKey,
        record.rowKind,
        record.payload,
        record.payloadBytes,
        this.now(),
      ]);
    });
  }

  asAsyncKeyValueStore(namespace: string): StudioAsyncKeyValueStore {
    return {
      get: (key) => this.kvGet(namespace, key),
      set: (key, value) => this.kvSet(namespace, key, value),
      delete: (key) => this.kvDelete(namespace, key),
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const statement of this.statements.values()) {
      try {
        statement.finalize();
      } catch {
        // finalize 는 사실상 소멸자 — 실패해도 나머지 정리와 close 를 계속한다.
      }
    }
    this.statements.clear();
    this.handle.close();
  }
}

async function loadSqliteApi(
  load?: () => Promise<StudioSqliteApiHandle>,
): Promise<StudioSqliteApiHandle> {
  try {
    if (load) return await load();
    const module = await import("@sqlite.org/sqlite-wasm");
    const sqlite3 = await module.default();
    return sqlite3 as unknown as StudioSqliteApiHandle;
  } catch (error) {
    throw new SqliteUnavailableError(
      `sqlite wasm module failed to load or initialize: ${describeError(error)}`,
      { cause: error },
    );
  }
}

type OpfsSupportCheck = { supported: true } | { supported: false; reason: string };

function detectOpfsSupport(): OpfsSupportCheck {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) {
    return {
      supported: false,
      reason: "navigator.storage.getDirectory is unavailable (no OPFS in this environment)",
    };
  }
  const fileHandleClass = (
    globalThis as {
      FileSystemFileHandle?: { prototype?: { createSyncAccessHandle?: unknown } };
    }
  ).FileSystemFileHandle;
  if (typeof fileHandleClass?.prototype?.createSyncAccessHandle !== "function") {
    return {
      supported: false,
      reason:
        "FileSystemFileHandle.createSyncAccessHandle is unavailable " +
        "(opfs-sahpool requires sync access handles)",
    };
  }
  return { supported: true };
}

async function installStudioSahPool(
  api: StudioSqliteApiHandle,
  directory: string,
  name?: string,
): Promise<StudioSqlitePoolUtilHandle> {
  return api.installOpfsSAHPoolVfs({
    directory,
    ...(name === undefined ? {} : { name }),
    forceReinitIfPreviouslyFailed: true,
  });
}

function openStudioSahPoolDatabase(
  pool: StudioSqlitePoolUtilHandle,
): StudioSqliteDatabaseHandle {
  return new pool.OpfsSAHPoolDb(`/${STUDIO_SQLITE_DATABASE_FILENAME}`);
}

let lastInstalledStudioSahPool: StudioSqlitePoolUtilHandle | undefined;

async function openOpfsDatabaseHandle(
  api: StudioSqliteApiHandle,
): Promise<{
  readonly handle: StudioSqliteDatabaseHandle;
  readonly pool: StudioSqlitePoolUtilHandle;
}> {
  const opfs = detectOpfsSupport();
  if (!opfs.supported) {
    throw new SqliteUnavailableError(opfs.reason);
  }
  try {
    try {
      const pool = await installStudioSahPool(api, STUDIO_SQLITE_OPFS_DIRECTORY);
      lastInstalledStudioSahPool = pool;
      return { handle: openStudioSahPoolDatabase(pool), pool };
    } catch (error) {
      if (!isStudioOpfsModificationLocked(error)) throw error;
      const pool = await installStudioSahPool(
        api,
        STUDIO_SQLITE_OPFS_RECOVERY_DIRECTORY,
        STUDIO_SQLITE_SAHPOOL_RECOVERY_VFS_NAME,
      );
      lastInstalledStudioSahPool = pool;
      return { handle: openStudioSahPoolDatabase(pool), pool };
    }
  } catch (error) {
    throw new SqliteUnavailableError(
      `opfs-sahpool vfs install or database open failed: ${describeError(error)}`,
      { cause: error },
    );
  }
}

function closeQuietly(handle: StudioSqliteDatabaseHandle): void {
  try {
    handle.close();
  } catch {
    // 개방 직후 마이그레이션 실패 정리 경로 — 원 에러가 우선한다.
  }
}

function wrapStudioSqliteStepError(error: unknown): unknown {
  if (!isStudioSqliteCorruption(error)) return error;
  return error instanceof StudioSqliteCorruptError
    ? error
    : new StudioSqliteCorruptError(describeError(error), { cause: error });
}

function assertStudioSqliteHealthy(handle: StudioSqliteDatabaseHandle): void {
  const statement = handle.prepare("PRAGMA quick_check");
  try {
    if (!statement.step()) {
      throw new StudioSqliteCorruptError("SQLITE_CORRUPT: quick_check returned no rows");
    }
    const result = String(statement.get(0) ?? "");
    if (result.toLowerCase() !== "ok") {
      throw new StudioSqliteCorruptError(`SQLITE_CORRUPT: ${result}`);
    }
  } catch (error) {
    throw wrapStudioSqliteStepError(error);
  } finally {
    try {
      statement.finalize();
    } catch {
      // The health check error is the authority.
    }
  }
}

interface OpenedStudioSqliteHandle {
  readonly handle: StudioSqliteDatabaseHandle;
  readonly pool?: StudioSqlitePoolUtilHandle;
}

function migrateAndCheck(
  handle: StudioSqliteDatabaseHandle,
  vfs: "opfs" | "memory",
): StudioSqliteDatabaseHandle {
  runStudioLocalDatabaseMigrations(handle);
  if (vfs === "opfs") assertStudioSqliteHealthy(handle);
  return handle;
}

async function openMigratedHandle(
  api: StudioSqliteApiHandle,
  vfs: "opfs" | "memory",
  memoryFilename: string | undefined,
): Promise<OpenedStudioSqliteHandle> {
  if (vfs === "memory") {
    const handle = new api.oo1.DB(memoryFilename ?? ":memory:", "c");
    try {
      return { handle: migrateAndCheck(handle, vfs) };
    } catch (error) {
      closeQuietly(handle);
      throw error;
    }
  }
  const opened = await openOpfsDatabaseHandle(api);
  try {
    return { handle: migrateAndCheck(opened.handle, vfs), pool: opened.pool };
  } catch (error) {
    closeQuietly(opened.handle);
    throw error;
  }
}

async function recoverCorruptStudioSqliteImage(
  api: StudioSqliteApiHandle,
  pool: StudioSqlitePoolUtilHandle | undefined,
): Promise<StudioSqliteDatabaseHandle> {
  if (pool && typeof pool.wipeFiles === "function") {
    try {
      await pool.wipeFiles();
      if (typeof pool.unlink === "function") {
        pool.unlink(`/${STUDIO_SQLITE_DATABASE_FILENAME}`);
      }
      const handle = openStudioSahPoolDatabase(pool);
      try {
        return migrateAndCheck(handle, "opfs");
      } catch (error) {
        closeQuietly(handle);
        throw error;
      }
    } catch {
      // The live pool could not reset in place; reopen may still use a sibling directory.
    }
  }
  await wipeStudioSqliteOpfsDirectory();
  return (await openMigratedHandle(api, "opfs", undefined)).handle;
}

/**
 * Studio 로컬 SQLite DB 를 열고 스키마를 최신 버전으로 마이그레이션한다.
 * OPFS/wasm 을 못 쓰면 {@link SqliteUnavailableError} 로 명시 실패한다.
 * A corrupt OPFS image is reset through the live SAH pool (not native removeEntry)
 * and reopened empty so autosave can keep working.
 */
export async function openStudioLocalDatabase(
  options: OpenStudioLocalDatabaseOptions = {},
): Promise<StudioLocalDatabase> {
  const vfs = options.vfs ?? "opfs";
  const api = await loadSqliteApi(options.loadSqlite);
  try {
    const opened = await openMigratedHandle(api, vfs, options.memoryFilename);
    return new SqliteStudioLocalDatabase(opened.handle, options.now ?? Date.now);
  } catch (error) {
    if (vfs !== "opfs" || !isStudioSqliteCorruption(error)) throw error;
    const recovered = await recoverCorruptStudioSqliteImage(
      api,
      lastInstalledStudioSahPool,
    );
    return new SqliteStudioLocalDatabase(recovered, options.now ?? Date.now);
  }
}

/** 환경 실측 프로브 — wasm 로드 가능 여부와 OPFS(sahpool) 지원 여부. */
export async function probeSqliteSupport(
  options: { loadSqlite?: () => Promise<StudioSqliteApiHandle> } = {},
): Promise<StudioSqliteSupportProbe> {
  const opfs = detectOpfsSupport();
  let wasm = false;
  let wasmReason: string | undefined;
  try {
    await loadSqliteApi(options.loadSqlite);
    wasm = true;
  } catch (error) {
    wasmReason =
      error instanceof SqliteUnavailableError ? error.reason : describeError(error);
  }
  const reasons: string[] = [];
  if (wasmReason !== undefined) reasons.push(`wasm: ${wasmReason}`);
  if (!opfs.supported) reasons.push(`opfs: ${opfs.reason}`);
  const probe: StudioSqliteSupportProbe = { wasm, opfs: opfs.supported };
  if (reasons.length > 0) probe.reason = reasons.join("; ");
  return probe;
}
