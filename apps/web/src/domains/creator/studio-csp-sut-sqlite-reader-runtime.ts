/**
 * Browser/Worker SQLite decoder for CSP SUT/SUTG containers.
 *
 * `sqlite3_deserialize()` is the official sqlite-wasm byte-import API. The
 * source is copied into the WASM heap, attached with READONLY ownership, read
 * under strict cardinality/cell bounds, and released when the one-shot DB is
 * closed. No SQL statement in this module mutates the source database.
 */

import type { StudioCspSutSqliteWorkerErrorCode } from "./studio-csp-sut-sqlite-reader-protocol";
import type {
  CspSqliteReadContext,
  CspSqliteSnapshot,
  CspSqliteTableSnapshot,
  CspSqliteValue,
} from "../../../../../packages/studio-format-gateway/src/csp-sut";

type SqliteWasmValue = string | number | bigint | Uint8Array | null;
const SQLITE_HEADER = new TextEncoder().encode("SQLite format 3\0");

interface SqliteWasmDatabase {
  readonly pointer: number | undefined;
  exec(sql: string): unknown;
  selectValue(sql: string, bind?: unknown): SqliteWasmValue | undefined;
  selectObjects(sql: string, bind?: unknown): Array<Record<string, SqliteWasmValue>>;
  checkRc(resultCode: number): this;
  close(): void;
}

interface SqliteWasmApi {
  readonly capi: {
    readonly SQLITE_DESERIALIZE_FREEONCLOSE: number;
    readonly SQLITE_DESERIALIZE_READONLY: number;
    sqlite3_deserialize(
      database: number,
      schema: string,
      data: number,
      databaseBytes: number,
      bufferBytes: number,
      flags: number,
    ): number;
    sqlite3_js_db_export(database: number, schema?: string): Uint8Array;
  };
  readonly oo1: {
    readonly DB: new (filename?: string, flags?: string) => SqliteWasmDatabase;
  };
  readonly wasm: {
    allocFromTypedArray(bytes: Uint8Array): number;
    dealloc(pointer: number): void;
  };
}

export type StudioCspSqliteWasmLoader = () => Promise<SqliteWasmApi>;

export class StudioCspSutSqliteReaderError extends Error {
  constructor(
    message: string,
    readonly code: StudioCspSutSqliteWorkerErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioCspSutSqliteReaderError";
  }
}

export async function loadStudioCspSqliteWasm(): Promise<SqliteWasmApi> {
  try {
    const module = await import("@sqlite.org/sqlite-wasm");
    return await module.default() as unknown as SqliteWasmApi;
  } catch (cause) {
    throw new StudioCspSutSqliteReaderError(
      "브라우저 SQLite WASM 런타임을 초기화하지 못했습니다.",
      "sqlite-init",
      { cause },
    );
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new StudioCspSutSqliteReaderError("SUT/SUTG 읽기가 취소되었습니다.", "aborted");
  }
}

function boundedContext(context: CspSqliteReadContext): void {
  for (const [name, value] of Object.entries({
    maxTables: context.maxTables,
    maxColumnsPerTable: context.maxColumnsPerTable,
    maxRows: context.maxRows,
    maxBlobBytes: context.maxBlobBytes,
    maxTextCharacters: context.maxTextCharacters,
  })) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new StudioCspSutSqliteReaderError(`${name} 한도가 올바르지 않습니다.`, "bounds");
    }
  }
}

function validateSqliteByteEnvelope(bytes: Uint8Array): void {
  if (bytes.byteLength < 100) {
    throw new StudioCspSutSqliteReaderError("SQLite 원본 헤더가 잘렸습니다.", "deserialize");
  }
  for (let index = 0; index < SQLITE_HEADER.byteLength; index += 1) {
    if (bytes[index] !== SQLITE_HEADER[index]) {
      throw new StudioCspSutSqliteReaderError("SQLite 원본 시그니처가 없습니다.", "deserialize");
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const encodedPageSize = view.getUint16(16, false);
  const pageSize = encodedPageSize === 1 ? 65_536 : encodedPageSize;
  if (
    pageSize < 512
    || pageSize > 65_536
    || (pageSize & (pageSize - 1)) !== 0
    || bytes.byteLength % pageSize !== 0
  ) {
    throw new StudioCspSutSqliteReaderError("SQLite 원본 페이지 경계가 잘못되었습니다.", "deserialize");
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizedSqliteValue(
  value: SqliteWasmValue,
  table: string,
  column: string,
  context: CspSqliteReadContext,
): CspSqliteValue {
  if (value === null) return null;
  if (typeof value === "string") {
    if (value.length > context.maxTextCharacters) {
      throw new StudioCspSutSqliteReaderError(
        `${table}.${column} 텍스트가 ${context.maxTextCharacters}자 한도를 넘었습니다.`,
        "bounds",
      );
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new StudioCspSutSqliteReaderError(`${table}.${column} 숫자가 유한하지 않습니다.`, "query");
    }
    return value;
  }
  if (typeof value === "bigint") return value;
  if (value instanceof Uint8Array) {
    if (value.byteLength > context.maxBlobBytes) {
      throw new StudioCspSutSqliteReaderError(
        `${table}.${column} BLOB이 ${context.maxBlobBytes}바이트 한도를 넘었습니다.`,
        "bounds",
      );
    }
    return value.slice();
  }
  throw new StudioCspSutSqliteReaderError(`${table}.${column} SQLite 값 형식이 잘못되었습니다.`, "query");
}

interface TableColumn {
  readonly cid: number;
  readonly name: string;
  readonly primaryKeyOrder: number;
}

function tableColumns(
  database: SqliteWasmDatabase,
  tableName: string,
  context: CspSqliteReadContext,
): TableColumn[] {
  const rows = database.selectObjects(`PRAGMA table_xinfo(${quoteIdentifier(tableName)})`);
  if (rows.length === 0 || rows.length > context.maxColumnsPerTable) {
    throw new StudioCspSutSqliteReaderError(
      `${tableName} 열 수가 1..${context.maxColumnsPerTable} 범위를 벗어났습니다.`,
      "bounds",
    );
  }
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const name = row.name;
    const cid = row.cid;
    const pk = row.pk;
    if (
      typeof name !== "string"
      || name.length === 0
      || name.length > context.maxTextCharacters
      || seen.has(name)
      || typeof cid !== "number"
      || !Number.isSafeInteger(cid)
      || typeof pk !== "number"
      || !Number.isSafeInteger(pk)
    ) {
      throw new StudioCspSutSqliteReaderError(`${tableName} 열 메타데이터가 잘못되었습니다.`, "query");
    }
    seen.add(name);
    return { cid: cid ?? index, name, primaryKeyOrder: pk };
  }).sort((left, right) => left.cid - right.cid);
}

function orderExpression(columns: readonly TableColumn[]): string {
  const primaryKey = columns
    .filter((column) => column.primaryKeyOrder > 0)
    .sort((left, right) => left.primaryKeyOrder - right.primaryKeyOrder);
  if (primaryKey.length > 0) {
    return primaryKey.map((column) => quoteIdentifier(column.name)).join(", ");
  }
  // Ordinary SQLite tables always expose a hidden rowid unless declared
  // WITHOUT ROWID (which necessarily has a primary key handled above).
  return "_rowid_";
}

function readTable(
  database: SqliteWasmDatabase,
  tableName: string,
  context: CspSqliteReadContext,
  remainingRows: number,
): CspSqliteTableSnapshot {
  const columns = tableColumns(database, tableName, context);
  const projected = columns.map((column) => quoteIdentifier(column.name)).join(", ");
  const limit = remainingRows + 1;
  let rawRows: Array<Record<string, SqliteWasmValue>>;
  try {
    rawRows = database.selectObjects(
      `SELECT ${projected} FROM ${quoteIdentifier(tableName)} ORDER BY ${orderExpression(columns)} LIMIT ${limit}`,
    );
  } catch (cause) {
    throw new StudioCspSutSqliteReaderError(
      `${tableName} 테이블을 결정적 순서로 읽지 못했습니다.`,
      "query",
      { cause },
    );
  }
  if (rawRows.length > remainingRows) {
    throw new StudioCspSutSqliteReaderError(
      `전체 행 수가 ${context.maxRows}개 한도를 넘었습니다.`,
      "bounds",
    );
  }
  const rows = rawRows.map((raw, rowIndex) => {
    throwIfAborted(context.signal);
    const normalized: Record<string, CspSqliteValue> = {};
    for (const column of columns) {
      if (!(column.name in raw)) {
        throw new StudioCspSutSqliteReaderError(
          `${tableName}[${rowIndex}]에 ${column.name} 값이 없습니다.`,
          "query",
        );
      }
      normalized[column.name] = normalizedSqliteValue(
        raw[column.name] ?? null,
        tableName,
        column.name,
        context,
      );
    }
    return normalized;
  });
  return { name: tableName, columns: columns.map((column) => column.name), rows };
}

export interface ReadStudioCspSutSqliteSnapshotOptions {
  readonly loadSqlite?: StudioCspSqliteWasmLoader;
}

export async function readStudioCspSutSqliteSnapshot(
  sourceBytes: Uint8Array,
  context: CspSqliteReadContext,
  options: ReadStudioCspSutSqliteSnapshotOptions = {},
): Promise<CspSqliteSnapshot> {
  boundedContext(context);
  throwIfAborted(context.signal);
  if (sourceBytes.byteLength === 0) {
    throw new StudioCspSutSqliteReaderError("SQLite 원본이 비어 있습니다.", "deserialize");
  }
  const source = sourceBytes.slice();
  validateSqliteByteEnvelope(source);
  const sqlite3 = await (options.loadSqlite ?? loadStudioCspSqliteWasm)();
  throwIfAborted(context.signal);
  const database = new sqlite3.oo1.DB(":memory:", "c");
  let allocation = 0;
  let ownershipTransferred = false;
  try {
    const pointer = database.pointer;
    if (pointer === undefined || pointer === 0) {
      throw new StudioCspSutSqliteReaderError("SQLite 연결 포인터가 없습니다.", "sqlite-init");
    }
    allocation = sqlite3.wasm.allocFromTypedArray(source);
    const flags = sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE
      | sqlite3.capi.SQLITE_DESERIALIZE_READONLY;
    try {
      database.checkRc(sqlite3.capi.sqlite3_deserialize(
        pointer,
        "main",
        allocation,
        source.byteLength,
        source.byteLength,
        flags,
      ));
      ownershipTransferred = true;
      allocation = 0;
    } catch (cause) {
      throw new StudioCspSutSqliteReaderError(
        "SQLite 원본 바이트를 읽기 전용 데이터베이스로 열지 못했습니다.",
        "deserialize",
        { cause },
      );
    }
    // These are connection-local safety switches. READONLY above is the
    // authoritative source-mutation barrier. sqlite3_db_readonly() reports 0
    // for a deserialized in-memory schema in sqlite-wasm 3.53 even though an
    // UPDATE returns SQLITE_READONLY; that API is therefore not used as a
    // contradictory gate (fixed by the real-write/browser fixture test).
    database.exec("PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;");
    const tableRows = database.selectObjects(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name COLLATE BINARY
       LIMIT ${context.maxTables + 1}`,
    );
    if (tableRows.length > context.maxTables) {
      throw new StudioCspSutSqliteReaderError(
        `테이블 수가 ${context.maxTables}개 한도를 넘었습니다.`,
        "bounds",
      );
    }
    const tables: CspSqliteTableSnapshot[] = [];
    const seen = new Set<string>();
    let totalRows = 0;
    for (const row of tableRows) {
      throwIfAborted(context.signal);
      const tableName = row.name;
      if (
        typeof tableName !== "string"
        || tableName.length === 0
        || tableName.length > context.maxTextCharacters
        || seen.has(tableName)
      ) {
        throw new StudioCspSutSqliteReaderError("SQLite 테이블 이름이 잘못되었습니다.", "query");
      }
      seen.add(tableName);
      const table = readTable(database, tableName, context, context.maxRows - totalRows);
      totalRows += table.rows.length;
      tables.push(table);
    }
    const version = database.selectValue("SELECT sqlite_version()") ?? null;
    if (version !== null && typeof version !== "string") {
      throw new StudioCspSutSqliteReaderError("SQLite 버전 값이 문자열이 아닙니다.", "query");
    }
    return version === null ? { tables } : { tables, sqliteVersion: version };
  } catch (cause) {
    if (cause instanceof StudioCspSutSqliteReaderError) throw cause;
    throw new StudioCspSutSqliteReaderError(
      "SQLite snapshot을 안전하게 조회하지 못했습니다.",
      "query",
      { cause },
    );
  } finally {
    // sqlite3_deserialize(FREEONCLOSE) transfers the WASM allocation to the DB
    // only on success. Failed deserialize allocations remain ours to release.
    if (!ownershipTransferred && allocation !== 0) sqlite3.wasm.dealloc(allocation);
    database.close();
  }
}
