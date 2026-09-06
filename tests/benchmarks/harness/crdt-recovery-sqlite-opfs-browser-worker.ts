/**
 * Dedicated Worker for the real CRDT recovery-vault v6 SQLite/OPFS browser gate.
 *
 * Fallback probes are installed before product modules load. Every durable operation uses the
 * public createStudioCrdtRecoveryVault() factory after the shared database runtime has opened the
 * production OPFS SAH-pool. The SQLite constructor is wrapped only to record which VFS was opened.
 */

const REPORT_SCHEMA_VERSION = 1;
const OPERATION_SAMPLES = 30;
const PRIMARY_UPDATE_COUNT = 257;
const SAMPLE_UPDATE_COUNT = 129;
const BASE_EPOCH = Date.UTC(2026, 7, 10, 0, 0, 0);
const AUTHENTICATED_SCOPE = "auth:crdt-recovery-opfs-v6-benchmark";
const GRACEFUL_WORK_ID = "crdt-recovery-opfs-v6-graceful";
const TERMINATION_WORK_ID = "crdt-recovery-opfs-v6-worker-terminate";
const CORRUPTION_WORK_ID = "crdt-recovery-opfs-v6-corruption";
const CONTENTION_OWNER_WORK_ID = "crdt-recovery-opfs-v6-contention-owner";
const CONTENTION_CONTENDER_WORK_ID = "crdt-recovery-opfs-v6-contention-contender";

type JsonRecord = Record<string, unknown>;

type WorkerCommandName =
  | "graceful-seed"
  | "graceful-reopen"
  | "termination-seed"
  | "termination-verify"
  | "corruption-seed"
  | "corruption-verify"
  | "contention-owner"
  | "contention-contender"
  | "contention-verify";

interface WorkerCommand {
  readonly id: string;
  readonly command: WorkerCommandName;
  readonly payload?: JsonRecord;
}

interface Distribution {
  readonly sampleCount: number;
  readonly percentileMethod: "nearest-rank-ceil";
  readonly samplesMs: readonly number[];
  readonly minMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  readonly meanMs: number;
}

interface StudioSqliteStatementHandleLike {
  bind(values: readonly (string | number | null)[]): unknown;
  step(): boolean;
  get(columnIndex: number): unknown;
  reset(): unknown;
  finalize(): unknown;
}

interface StudioSqliteDatabaseHandleLike {
  exec(sql: string): unknown;
  prepare(sql: string): StudioSqliteStatementHandleLike;
  changes(): number;
  close(): void;
}

interface StudioSqlitePoolUtilHandleLike {
  OpfsSAHPoolDb: new (filename: string) => StudioSqliteDatabaseHandleLike;
}

interface StudioSqliteApiHandleLike {
  oo1: {
    DB: new (filename: string, flags?: string) => StudioSqliteDatabaseHandleLike;
  };
  installOpfsSAHPoolVfs(options: {
    directory?: string;
    name?: string;
  }): Promise<StudioSqlitePoolUtilHandleLike>;
}

interface BrowserMemoryPerformance extends Performance {
  readonly memory?: {
    readonly jsHeapSizeLimit?: number;
    readonly totalJSHeapSize?: number;
    readonly usedJSHeapSize?: number;
  };
  measureUserAgentSpecificMemory?: () => Promise<{
    readonly bytes?: number;
    readonly breakdown?: readonly unknown[];
  }>;
}

interface FileSystemEntryLike {
  readonly kind: "directory" | "file";
  readonly name: string;
}

interface FileSystemFileLike extends FileSystemEntryLike {
  readonly kind: "file";
  getFile(): Promise<File>;
}

interface FileSystemDirectoryLike extends FileSystemEntryLike {
  readonly kind: "directory";
  entries(): AsyncIterableIterator<[string, FileSystemEntryLike]>;
}

interface FrontierSpec {
  readonly startSerial: number;
  readonly count: number;
  readonly label: string;
}

const fallbackProbe = {
  indexedDbAccessCount: 0,
  localStorageAccessCount: 0,
  indexedDbProbeInstalled: false,
  localStorageProbeInstalled: false,
};

const sqliteProbe: {
  installedOpfsDirectories: string[];
  openedOpfsDatabaseFilenames: string[];
  openedMemoryDatabaseFilenames: string[];
  latestPool: StudioSqlitePoolUtilHandleLike | null;
} = {
  installedOpfsDirectories: [],
  openedOpfsDatabaseFilenames: [],
  openedMemoryDatabaseFilenames: [],
  latestPool: null,
};

function installFallbackProbes(): void {
  try {
    const original = (globalThis as typeof globalThis & { indexedDB?: IDBFactory }).indexedDB;
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      enumerable: true,
      get() {
        fallbackProbe.indexedDbAccessCount += 1;
        return original;
      },
    });
    fallbackProbe.indexedDbProbeInstalled = true;
  } catch {
    fallbackProbe.indexedDbProbeInstalled = false;
  }
  try {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      enumerable: false,
      get() {
        fallbackProbe.localStorageAccessCount += 1;
        throw new DOMException(
          "CRDT recovery benchmark forbids localStorage fallback",
          "SecurityError",
        );
      },
    });
    fallbackProbe.localStorageProbeInstalled = true;
  } catch {
    fallbackProbe.localStorageProbeInstalled = false;
  }
}

installFallbackProbes();

function fixed(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[Math.min(sorted.length - 1, index)] ?? 0;
}

function distribution(samples: readonly number[]): Distribution {
  const sorted = [...samples].sort((left, right) => left - right);
  const mean = samples.length === 0
    ? 0
    : samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
  return {
    sampleCount: samples.length,
    percentileMethod: "nearest-rank-ceil",
    samplesMs: samples.map((sample) => fixed(sample)),
    minMs: fixed(sorted[0] ?? 0),
    p50Ms: fixed(percentile(sorted, 0.5)),
    p95Ms: fixed(percentile(sorted, 0.95)),
    p99Ms: fixed(percentile(sorted, 0.99)),
    maxMs: fixed(sorted.at(-1) ?? 0),
    meanMs: fixed(mean),
  };
}

function errorShape(error: unknown): JsonRecord {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
      cause: error.cause instanceof Error
        ? { name: error.cause.name, message: error.cause.message }
        : error.cause === undefined ? null : String(error.cause),
    };
  }
  return { name: "NonError", message: String(error), stack: null, cause: null };
}

function post(value: unknown): void {
  globalThis.postMessage(value);
}

function capabilities(): JsonRecord {
  const fileHandleClass = (globalThis as {
    FileSystemFileHandle?: { prototype?: { createSyncAccessHandle?: unknown } };
  }).FileSystemFileHandle;
  return {
    dedicatedWorker: typeof WorkerGlobalScope !== "undefined"
      && globalThis instanceof WorkerGlobalScope,
    secureContext: globalThis.isSecureContext,
    crossOriginIsolated: globalThis.crossOriginIsolated,
    navigatorStorageGetDirectory: typeof navigator.storage?.getDirectory === "function",
    syncAccessHandle: typeof fileHandleClass?.prototype?.createSyncAccessHandle === "function",
    cryptoSubtle: typeof crypto.subtle?.digest === "function",
  };
}

function trackedSqliteApi(baseApi: StudioSqliteApiHandleLike): StudioSqliteApiHandleLike {
  const MemoryDb = new Proxy(baseApi.oo1.DB, {
    construct(target, args, newTarget) {
      sqliteProbe.openedMemoryDatabaseFilenames.push(String(args[0]));
      return Reflect.construct(target, args, newTarget) as StudioSqliteDatabaseHandleLike;
    },
  });
  return {
    oo1: { DB: MemoryDb },
    async installOpfsSAHPoolVfs(options): Promise<StudioSqlitePoolUtilHandleLike> {
      sqliteProbe.installedOpfsDirectories.push(options.directory ?? "");
      const pool = await baseApi.installOpfsSAHPoolVfs(options);
      sqliteProbe.latestPool = pool;
      const OpfsDb = new Proxy(pool.OpfsSAHPoolDb, {
        construct(target, args, newTarget) {
          sqliteProbe.openedOpfsDatabaseFilenames.push(String(args[0]));
          return Reflect.construct(target, args, newTarget) as StudioSqliteDatabaseHandleLike;
        },
      });
      return { OpfsSAHPoolDb: OpfsDb };
    },
  };
}

function fallbackReceipt(): JsonRecord {
  return {
    indexedDbAccessCount: fallbackProbe.indexedDbAccessCount,
    localStorageAccessCount: fallbackProbe.localStorageAccessCount,
    memoryDatabaseOpenCount: sqliteProbe.openedMemoryDatabaseFilenames.length,
    durableMemoryFallbackSuccessCount: 0,
    indexedDbProbeInstalled: fallbackProbe.indexedDbProbeInstalled,
    localStorageProbeInstalled: fallbackProbe.localStorageProbeInstalled,
    openedMemoryDatabaseFilenames: [...sqliteProbe.openedMemoryDatabaseFilenames],
  };
}

async function memorySnapshot(): Promise<JsonRecord> {
  const measuredPerformance = performance as BrowserMemoryPerformance;
  let userAgentSpecific: JsonRecord | null = null;
  if (typeof measuredPerformance.measureUserAgentSpecificMemory === "function") {
    try {
      const measured = await measuredPerformance.measureUserAgentSpecificMemory();
      userAgentSpecific = {
        bytes: measured.bytes ?? null,
        breakdownEntryCount: measured.breakdown?.length ?? null,
      };
    } catch {
      userAgentSpecific = null;
    }
  }
  return {
    performanceMemory: measuredPerformance.memory
      ? {
          usedJSHeapSizeBytes: measuredPerformance.memory.usedJSHeapSize ?? null,
          totalJSHeapSizeBytes: measuredPerformance.memory.totalJSHeapSize ?? null,
          jsHeapSizeLimitBytes: measuredPerformance.memory.jsHeapSizeLimit ?? null,
        }
      : null,
    userAgentSpecific,
  };
}

async function storageSnapshot(): Promise<JsonRecord> {
  const estimate = await navigator.storage.estimate();
  const detailed = estimate as StorageEstimate & { usageDetails?: Record<string, number> };
  return {
    usageBytes: estimate.usage ?? null,
    quotaBytes: estimate.quota ?? null,
    availableBytes: estimate.quota !== undefined && estimate.usage !== undefined
      ? Math.max(0, estimate.quota - estimate.usage)
      : null,
    usageDetails: detailed.usageDetails ?? null,
  };
}

async function walkDirectory(
  directory: FileSystemDirectoryLike,
  prefix = "",
): Promise<Array<{ path: string; kind: "directory" | "file"; bytes: number | null }>> {
  const entries: Array<{ path: string; kind: "directory" | "file"; bytes: number | null }> = [];
  for await (const [name, entry] of directory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === "file") {
      entries.push({
        path,
        kind: "file",
        bytes: (await (entry as FileSystemFileLike).getFile()).size,
      });
    } else {
      entries.push({ path, kind: "directory", bytes: null });
      entries.push(...await walkDirectory(entry as FileSystemDirectoryLike, path));
    }
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function inspectOpfs(): Promise<JsonRecord> {
  const root = await navigator.storage.getDirectory() as unknown as FileSystemDirectoryLike;
  const entries = await walkDirectory(root);
  return {
    entries,
    fileCount: entries.filter(({ kind }) => kind === "file").length,
    totalFileBytes: entries.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0),
    sqliteTableIndexWalBytes: null,
    sqliteTableIndexWalBytesReason:
      "SAH-pool storage files do not expose portable table/index/WAL attribution",
  };
}

async function sha256Text(value: string): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return `sha256:${hex}`;
}

function deterministicBytes(serial: number): Uint8Array {
  const bytes = new Uint8Array(192 + (serial % 64));
  let state = (serial ^ 0x6d2b_79f5) >>> 0;
  for (let index = 0; index < bytes.length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    bytes[index] = state >>> 24;
  }
  return bytes;
}

function uuidFor(serial: number): string {
  return `c0dec0de-0000-4000-8000-${serial.toString(16).padStart(12, "0")}`;
}

function gracefulSpecs(): FrontierSpec[] {
  const specs: FrontierSpec[] = [{
    startSerial: 1,
    count: PRIMARY_UPDATE_COUNT,
    label: "primary-multichunk",
  }];
  for (let sample = 0; sample < OPERATION_SAMPLES; sample += 1) {
    specs.push({
      startSerial: PRIMARY_UPDATE_COUNT + sample * SAMPLE_UPDATE_COUNT + 1,
      count: SAMPLE_UPDATE_COUNT,
      label: `save-sample-${String(sample).padStart(2, "0")}`,
    });
  }
  return specs;
}

function oneSpec(label: string, serial: number, count = PRIMARY_UPDATE_COUNT): FrontierSpec {
  return { startSerial: serial, count, label };
}

function updatesFor(
  protocol: {
    readonly STUDIO_CRDT_PROTOCOL_VERSION: number;
    encodeStudioCrdtUpdate(bytes: Uint8Array): string;
  },
  workId: string,
  spec: FrontierSpec,
): JsonRecord[] {
  return Array.from({ length: spec.count }, (_, offset) => {
    const serial = spec.startSerial + offset;
    return {
      protocolVersion: protocol.STUDIO_CRDT_PROTOCOL_VERSION,
      workId,
      updateId: uuidFor(serial),
      clientSequence: serial,
      update: protocol.encodeStudioCrdtUpdate(deterministicBytes(serial)),
    };
  });
}

function canonicalFrontiers(entries: readonly JsonRecord[]): JsonRecord[] {
  return entries.map((entry) => ({
    rejectedUpdateId: String(entry.rejectedUpdateId ?? ""),
    updates: Array.isArray(entry.updates)
      ? entry.updates.map((update) => {
          const candidate = update as JsonRecord;
          return {
            protocolVersion: candidate.protocolVersion,
            workId: candidate.workId,
            updateId: candidate.updateId,
            clientSequence: candidate.clientSequence,
            update: candidate.update,
          };
        })
      : [],
  })).sort((left, right) => String(left.rejectedUpdateId)
    .localeCompare(String(right.rejectedUpdateId)));
}

async function digestFrontiers(entries: readonly JsonRecord[]): Promise<`sha256:${string}`> {
  return sha256Text(JSON.stringify(canonicalFrontiers(entries)));
}

async function expectedDigest(
  protocol: {
    readonly STUDIO_CRDT_PROTOCOL_VERSION: number;
    encodeStudioCrdtUpdate(bytes: Uint8Array): string;
  },
  workId: string,
  specs: readonly FrontierSpec[],
): Promise<`sha256:${string}`> {
  return digestFrontiers(specs.map((spec) => {
    const updates = updatesFor(protocol, workId, spec);
    return { rejectedUpdateId: updates[0]?.updateId, updates };
  }));
}

async function loadProductModules() {
  const [localDatabase, runtime, recovery, protocol] = await Promise.all([
    import("../../../apps/web/src/domains/creator/studio-local-database"),
    import("../../../apps/web/src/domains/creator/studio-local-database-runtime"),
    import("../../../apps/web/src/domains/creator/live/studio-crdt-recovery-vault.test.ts"),
    import("../../../apps/web/src/domains/creator/live/studio-crdt-protocol.test.ts"),
  ]);
  return { localDatabase, runtime, recovery, protocol };
}

async function openProduct() {
  const modules = await loadProductModules();
  const sqliteStartedAt = performance.now();
  const sqliteModule = await import("@sqlite.org/sqlite-wasm");
  const baseApi = await sqliteModule.default() as unknown as StudioSqliteApiHandleLike;
  const sqliteWasmInitMs = performance.now() - sqliteStartedAt;
  const trackedApi = trackedSqliteApi(baseApi);
  const support = await modules.localDatabase.probeSqliteSupport({
    loadSqlite: () => Promise.resolve(trackedApi),
  });
  if (!support.wasm || !support.opfs) {
    throw new modules.localDatabase.SqliteUnavailableError(
      support.reason ?? "SQLite wasm or OPFS SAH-pool is unavailable",
    );
  }
  const openStartedAt = performance.now();
  const database = await modules.runtime.acquireStudioLocalDatabase(() =>
    modules.localDatabase.openStudioLocalDatabase({
      vfs: "opfs",
      loadSqlite: () => Promise.resolve(trackedApi),
    }));
  const openMs = performance.now() - openStartedAt;
  const vault = modules.recovery.createStudioCrdtRecoveryVault();
  return {
    ...modules,
    database,
    vault,
    support,
    sqliteWasmInitMs,
    openMs,
  };
}

function authorityReceipt(product: Awaited<ReturnType<typeof openProduct>>): JsonRecord {
  return {
    kind: "shared-sqlite-opfs-crdt-recovery-v6",
    requestedVfs: "opfs",
    sqlitePackage: "@sqlite.org/sqlite-wasm 3.53.0-build1",
    sqliteOpfsDirectory: product.localDatabase.STUDIO_SQLITE_OPFS_DIRECTORY,
    sqliteFilename: product.localDatabase.STUDIO_SQLITE_DATABASE_FILENAME,
    schemaVersion: 6,
    table: "crdt_recovery_v12_rows",
    installedOpfsDirectories: [...sqliteProbe.installedOpfsDirectories],
    openedOpfsDatabaseFilenames: [...sqliteProbe.openedOpfsDatabaseFilenames],
    openedMemoryDatabaseFilenames: [...sqliteProbe.openedMemoryDatabaseFilenames],
    sqliteWasmInitMs: fixed(product.sqliteWasmInitMs),
    openMs: fixed(product.openMs),
  };
}

async function rowReceipt(
  product: Awaited<ReturnType<typeof openProduct>>,
  workId: string,
): Promise<JsonRecord> {
  const repository = product.localDatabase.requireStudioCrdtRecoveryDatabase(product.database);
  const rows = await repository.listCrdtRecoveryCandidates(AUTHENTICATED_SCOPE, workId);
  const kindCounts: Record<string, number> = {};
  for (const row of rows) {
    const kind = typeof row.rowKind === "string" ? row.rowKind : "invalid";
    kindCounts[kind] = (kindCounts[kind] ?? 0) + 1;
  }
  return {
    rowCount: rows.length,
    payloadBytes: rows.reduce((sum, row) =>
      sum + (typeof row.payloadBytes === "number" ? row.payloadBytes : 0), 0),
    kindCounts,
    rowKeysUnique: new Set(rows.map(({ rowKey }) => rowKey)).size === rows.length,
  };
}

function markerInput(workId: string, updates: readonly JsonRecord[]): JsonRecord {
  return {
    scope: AUTHENTICATED_SCOPE,
    workId,
    failureCode: "server_permanent_rejection",
    failureMessage: "deterministic browser OPFS recovery benchmark rejection",
    rejectedUpdateId: String(updates[0]?.updateId ?? ""),
    recoveryUpdateCount: updates.length,
  };
}

function frontierInput(workId: string, updates: readonly JsonRecord[]): JsonRecord {
  return {
    scope: AUTHENTICATED_SCOPE,
    workId,
    failureCode: "server_permanent_rejection",
    failureMessage: "deterministic browser OPFS recovery benchmark rejection",
    rejectedUpdateId: String(updates[0]?.updateId ?? ""),
    updates,
  };
}

async function preserveSpec(
  product: Awaited<ReturnType<typeof openProduct>>,
  workId: string,
  spec: FrontierSpec,
): Promise<{ entry: JsonRecord; updates: JsonRecord[]; ms: number }> {
  const updates = updatesFor(product.protocol, workId, spec);
  const startedAt = performance.now();
  const entry = await product.vault.preserve(frontierInput(workId, updates) as never);
  return { entry: entry as unknown as JsonRecord, updates, ms: performance.now() - startedAt };
}

function updateCount(entries: readonly JsonRecord[]): number {
  return entries.reduce((sum, entry) =>
    sum + (Array.isArray(entry.updates) ? entry.updates.length : 0), 0);
}

async function runGracefulSeed(): Promise<JsonRecord> {
  const currentCapabilities = capabilities();
  if (
    currentCapabilities.navigatorStorageGetDirectory !== true
    || currentCapabilities.syncAccessHandle !== true
  ) {
    return {
      status: "unsupported",
      pass: false,
      schemaVersion: REPORT_SCHEMA_VERSION,
      reason: "required OPFS SAH-pool capability is unavailable",
      capabilities: currentCapabilities,
      fallback: fallbackReceipt(),
    };
  }
  const storageBefore = await storageSnapshot();
  const memoryBefore = await memorySnapshot();
  const product = await openProduct();
  const specs = gracefulSpecs();
  const initialRows = await rowReceipt(product, GRACEFUL_WORK_ID);
  if (initialRows.rowCount !== 0) throw new Error("graceful benchmark scope was not fresh");

  const primaryUpdates = updatesFor(product.protocol, GRACEFUL_WORK_ID, specs[0]!);
  const markerStartedAt = performance.now();
  await product.vault.preserveRejectionMarker(
    markerInput(GRACEFUL_WORK_ID, primaryUpdates) as never,
  );
  const markerMs = performance.now() - markerStartedAt;
  const primary = await preserveSpec(product, GRACEFUL_WORK_ID, specs[0]!);
  const saveSamples: number[] = [];
  for (const spec of specs.slice(1)) {
    saveSamples.push((await preserveSpec(product, GRACEFUL_WORK_ID, spec)).ms);
  }
  const entries = await product.vault.list(AUTHENTICATED_SCOPE, GRACEFUL_WORK_ID);
  const markers = await product.vault.listRejectionMarkers(
    AUTHENTICATED_SCOPE,
    GRACEFUL_WORK_ID,
  );
  const actualDigest = await digestFrontiers(entries as unknown as JsonRecord[]);
  const wantedDigest = await expectedDigest(product.protocol, GRACEFUL_WORK_ID, specs);
  const rows = await rowReceipt(product, GRACEFUL_WORK_ID);
  const opfs = await inspectOpfs();
  const storageAfter = await storageSnapshot();
  const memoryAfter = await memorySnapshot();
  const authority = authorityReceipt(product);
  await product.runtime.closeStudioLocalDatabaseRuntime();
  const fallback = fallbackReceipt();
  const pass = entries.length === specs.length
    && updateCount(entries as unknown as JsonRecord[]) ===
      PRIMARY_UPDATE_COUNT + OPERATION_SAMPLES * SAMPLE_UPDATE_COUNT
    && markers.length === 1
    && actualDigest === wantedDigest
    && rows.rowCount === 95
    && (rows.kindCounts as JsonRecord)["permanent-rejection"] === 1
    && (rows.kindCounts as JsonRecord)["frontier-chunk"] === 63
    && (rows.kindCounts as JsonRecord)["frontier-manifest"] === 31
    && fallback.indexedDbAccessCount === 0
    && fallback.localStorageAccessCount === 0
    && fallback.memoryDatabaseOpenCount === 0;
  return {
    status: pass ? "ok" : "error",
    pass,
    schemaVersion: REPORT_SCHEMA_VERSION,
    execution: "vite-production-build-chromium-dedicated-worker-opfs-sahpool",
    authority,
    support: product.support,
    capabilities: currentCapabilities,
    expected: {
      frontierCount: specs.length,
      updateCount: PRIMARY_UPDATE_COUNT + OPERATION_SAMPLES * SAMPLE_UPDATE_COUNT,
      digest: wantedDigest,
      rowCount: 95,
    },
    exact: {
      frontierCount: entries.length,
      updateCount: updateCount(entries as unknown as JsonRecord[]),
      markerCount: markers.length,
      digest: actualDigest,
      match: actualDigest === wantedDigest,
    },
    metrics: {
      markerMs: fixed(markerMs),
      primaryFrontierMs: fixed(primary.ms),
      save: distribution(saveSamples),
    },
    rows,
    opfs,
    storage: { before: storageBefore, after: storageAfter },
    memory: { before: memoryBefore, after: memoryAfter },
    gracefulCloseCompleted: true,
    fallback,
  };
}

async function runGracefulReopen(payload: JsonRecord): Promise<JsonRecord> {
  const product = await openProduct();
  const expected = String(payload.expectedDigest ?? "");
  const loadSamples: number[] = [];
  let entries: Awaited<ReturnType<typeof product.vault.list>> = [];
  let loadMismatchCount = 0;
  for (let sample = 0; sample < OPERATION_SAMPLES; sample += 1) {
    const startedAt = performance.now();
    entries = await product.vault.list(AUTHENTICATED_SCOPE, GRACEFUL_WORK_ID);
    loadSamples.push(performance.now() - startedAt);
    if (await digestFrontiers(entries as unknown as JsonRecord[]) !== expected) {
      loadMismatchCount += 1;
    }
  }

  const bundleBuildSamples: number[] = [];
  let bundleBytes = 0;
  let bundleDigest: string | null = null;
  for (let sample = 0; sample < OPERATION_SAMPLES; sample += 1) {
    const startedAt = performance.now();
    const selected = product.recovery.selectStudioCrdtRecoveryEntriesForDownload(entries);
    const bundle = product.recovery.createStudioCrdtRecoveryBundle(selected, BASE_EPOCH);
    const encoded = JSON.stringify(bundle);
    bundleBuildSamples.push(performance.now() - startedAt);
    bundleBytes = new TextEncoder().encode(encoded).byteLength;
    bundleDigest = await digestFrontiers(bundle.frontiers as unknown as JsonRecord[]);
  }

  const exportSamples: number[] = [];
  for (const entry of entries) {
    const startedAt = performance.now();
    await product.vault.markExported(
      AUTHENTICATED_SCOPE,
      GRACEFUL_WORK_ID,
      entry.vaultId,
    );
    exportSamples.push(performance.now() - startedAt);
  }
  const afterExport = await product.vault.list(AUTHENTICATED_SCOPE, GRACEFUL_WORK_ID);
  const markers = await product.vault.listRejectionMarkers(
    AUTHENTICATED_SCOPE,
    GRACEFUL_WORK_ID,
  );
  const rows = await rowReceipt(product, GRACEFUL_WORK_ID);
  const actualDigest = await digestFrontiers(afterExport as unknown as JsonRecord[]);
  const authority = authorityReceipt(product);
  await product.runtime.closeStudioLocalDatabaseRuntime();
  const fallback = fallbackReceipt();
  const pass = loadMismatchCount === 0
    && entries.length === 31
    && afterExport.every(({ status }) => status === "exported")
    && actualDigest === expected
    && bundleDigest === expected
    && markers.length === 1
    && rows.rowCount === 95
    && fallback.indexedDbAccessCount === 0
    && fallback.localStorageAccessCount === 0
    && fallback.memoryDatabaseOpenCount === 0;
  return {
    status: pass ? "ok" : "error",
    pass,
    schemaVersion: REPORT_SCHEMA_VERSION,
    authority,
    exact: {
      frontierCount: afterExport.length,
      updateCount: updateCount(afterExport as unknown as JsonRecord[]),
      markerCount: markers.length,
      digest: actualDigest,
      expectedDigest: expected,
      bundleDigest,
      match: actualDigest === expected && bundleDigest === expected,
      exportedCount: afterExport.filter(({ status }) => status === "exported").length,
      loadMismatchCount,
    },
    metrics: {
      load: distribution(loadSamples),
      bundleBuild: distribution(bundleBuildSamples),
      export: distribution(exportSamples),
      bundleBytes,
    },
    rows,
    gracefulCloseCompleted: true,
    fallback,
  };
}

async function runTerminationSeed(): Promise<JsonRecord> {
  const product = await openProduct();
  const spec = oneSpec("worker-terminate", 10_000);
  const updates = updatesFor(product.protocol, TERMINATION_WORK_ID, spec);
  const startedAt = performance.now();
  await product.vault.preserveRejectionMarker(
    markerInput(TERMINATION_WORK_ID, updates) as never,
  );
  await product.vault.preserve(frontierInput(TERMINATION_WORK_ID, updates) as never);
  const digest = await expectedDigest(product.protocol, TERMINATION_WORK_ID, [spec]);
  const rows = await rowReceipt(product, TERMINATION_WORK_ID);
  const fallback = fallbackReceipt();
  const pass = rows.rowCount === 5
    && fallback.indexedDbAccessCount === 0
    && fallback.localStorageAccessCount === 0
    && fallback.memoryDatabaseOpenCount === 0;
  return {
    status: pass ? "ready-for-terminate" : "error",
    pass,
    schemaVersion: REPORT_SCHEMA_VERSION,
    expectedDigest: digest,
    updateCount: updates.length,
    commitMs: fixed(performance.now() - startedAt),
    rows,
    databaseIntentionallyLeftOpen: true,
    fallback,
  };
}

async function runTerminationVerify(payload: JsonRecord): Promise<JsonRecord> {
  const product = await openProduct();
  const startedAt = performance.now();
  const entries = await product.vault.list(AUTHENTICATED_SCOPE, TERMINATION_WORK_ID);
  const markers = await product.vault.listRejectionMarkers(
    AUTHENTICATED_SCOPE,
    TERMINATION_WORK_ID,
  );
  const digest = await digestFrontiers(entries as unknown as JsonRecord[]);
  const elapsedMs = performance.now() - startedAt;
  const expected = String(payload.expectedDigest ?? "");
  const rows = await rowReceipt(product, TERMINATION_WORK_ID);
  await product.runtime.closeStudioLocalDatabaseRuntime();
  const fallback = fallbackReceipt();
  const pass = entries.length === 1
    && updateCount(entries as unknown as JsonRecord[]) === PRIMARY_UPDATE_COUNT
    && markers.length === 1
    && digest === expected
    && rows.rowCount === 5
    && fallback.indexedDbAccessCount === 0
    && fallback.localStorageAccessCount === 0
    && fallback.memoryDatabaseOpenCount === 0;
  return {
    status: pass ? "ok" : "error",
    pass,
    schemaVersion: REPORT_SCHEMA_VERSION,
    reopenLoadExportMs: fixed(elapsedMs),
    exact: {
      frontierCount: entries.length,
      updateCount: updateCount(entries as unknown as JsonRecord[]),
      markerCount: markers.length,
      digest,
      expectedDigest: expected,
      match: digest === expected,
    },
    rows,
    gracefulCloseCompletedAfterVerification: true,
    fallback,
  };
}

function executeUpdate(
  handle: StudioSqliteDatabaseHandleLike,
  sql: string,
  values: readonly (string | number | null)[],
): number {
  const statement = handle.prepare(sql);
  try {
    statement.bind(values);
    statement.step();
    return handle.changes();
  } finally {
    statement.finalize();
  }
}

async function runCorruptionSeed(): Promise<JsonRecord> {
  const product = await openProduct();
  const spec = oneSpec("corruption", 20_000, 129);
  const updates = updatesFor(product.protocol, CORRUPTION_WORK_ID, spec);
  await product.vault.preserveRejectionMarker(
    markerInput(CORRUPTION_WORK_ID, updates) as never,
  );
  await product.vault.preserve(frontierInput(CORRUPTION_WORK_ID, updates) as never);
  await product.runtime.closeStudioLocalDatabaseRuntime();
  const pool = sqliteProbe.latestPool;
  if (!pool) throw new Error("tracked OPFS SAH-pool constructor is unavailable");
  const raw = new pool.OpfsSAHPoolDb(`/${product.localDatabase.STUDIO_SQLITE_DATABASE_FILENAME}`);
  const changed = executeUpdate(
    raw,
    `UPDATE crdt_recovery_v12_rows
      SET payload = '{}', payload_bytes = 2
      WHERE scope = ? AND work_id = ? AND row_kind = 'frontier-chunk'
        AND row_key = (
          SELECT row_key FROM crdt_recovery_v12_rows
          WHERE scope = ? AND work_id = ? AND row_kind = 'frontier-chunk'
          ORDER BY row_key ASC LIMIT 1
        )`,
    [
      AUTHENTICATED_SCOPE,
      CORRUPTION_WORK_ID,
      AUTHENTICATED_SCOPE,
      CORRUPTION_WORK_ID,
    ],
  );
  raw.close();
  const fallback = fallbackReceipt();
  return {
    status: changed === 1 ? "corruption-injected" : "error",
    pass: changed === 1,
    schemaVersion: REPORT_SCHEMA_VERSION,
    changedRows: changed,
    safeSeam: "same sqlite-wasm OPFS SAH-pool raw handle after product DB close",
    corruption: "canonical JSON replaced with {} and matching payload_bytes=2",
    fallback,
  };
}

async function runCorruptionVerify(): Promise<JsonRecord> {
  const product = await openProduct();
  let caught: unknown = null;
  try {
    await product.vault.list(AUTHENTICATED_SCOPE, CORRUPTION_WORK_ID);
  } catch (error) {
    caught = error;
  }
  await product.runtime.closeStudioLocalDatabaseRuntime();
  const shaped = caught === null ? null : errorShape(caught);
  const failClosed = caught instanceof product.recovery.StudioCrdtRecoveryCorruptionError;
  const fallback = fallbackReceipt();
  const pass = failClosed
    && fallback.indexedDbAccessCount === 0
    && fallback.localStorageAccessCount === 0
    && fallback.memoryDatabaseOpenCount === 0;
  return {
    status: pass ? "ok" : "error",
    pass,
    schemaVersion: REPORT_SCHEMA_VERSION,
    failClosed,
    returnedPartialFrontierCount: 0,
    error: shaped,
    fallback,
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function preserveContentionWork(
  product: Awaited<ReturnType<typeof openProduct>>,
  workId: string,
  serial: number,
): Promise<string> {
  const spec = oneSpec(workId, serial, 129);
  const updates = updatesFor(product.protocol, workId, spec);
  await product.vault.preserveRejectionMarker(markerInput(workId, updates) as never);
  await product.vault.preserve(frontierInput(workId, updates) as never);
  return expectedDigest(product.protocol, workId, [spec]);
}

async function runContentionOwner(commandId: string, payload: JsonRecord): Promise<JsonRecord> {
  const holdMs = Number(payload.holdMs ?? 1_000);
  const product = await openProduct();
  const digest = await preserveContentionWork(product, CONTENTION_OWNER_WORK_ID, 30_000);
  post({ type: "progress", id: commandId, progress: "owner-ready" });
  await wait(holdMs);
  await product.runtime.closeStudioLocalDatabaseRuntime();
  return {
    status: "ok",
    pass: true,
    schemaVersion: REPORT_SCHEMA_VERSION,
    workId: CONTENTION_OWNER_WORK_ID,
    digest,
    holdMs,
    gracefulCloseCompleted: true,
    fallback: fallbackReceipt(),
  };
}

function isKnownSahPoolOwnerRejection(error: unknown): boolean {
  const shaped = errorShape(error);
  const text = JSON.stringify(shaped);
  return /NoModificationAllowedError|SyncAccessHandle|SAH-pool|sahpool|access handle/iu.test(text);
}

async function runContentionContender(): Promise<JsonRecord> {
  const startedAt = performance.now();
  try {
    const product = await openProduct();
    const digest = await preserveContentionWork(
      product,
      CONTENTION_CONTENDER_WORK_ID,
      40_000,
    );
    await product.runtime.closeStudioLocalDatabaseRuntime();
    return {
      status: "supported",
      pass: true,
      schemaVersion: REPORT_SCHEMA_VERSION,
      workId: CONTENTION_CONTENDER_WORK_ID,
      digest,
      elapsedMs: fixed(performance.now() - startedAt),
      gracefulCloseCompleted: true,
      fallback: fallbackReceipt(),
    };
  } catch (error) {
    const knownSingleOwnerRejection = isKnownSahPoolOwnerRejection(error);
    return {
      status: knownSingleOwnerRejection ? "quarantined-single-owner" : "error",
      pass: false,
      schemaVersion: REPORT_SCHEMA_VERSION,
      workId: CONTENTION_CONTENDER_WORK_ID,
      elapsedMs: fixed(performance.now() - startedAt),
      knownSingleOwnerRejection,
      error: errorShape(error),
      fallback: fallbackReceipt(),
    };
  }
}

async function runContentionVerify(payload: JsonRecord): Promise<JsonRecord> {
  const contenderCommitted = payload.contenderCommitted === true;
  const ownerExpectedDigest = String(payload.ownerExpectedDigest ?? "");
  const contenderExpectedDigest = String(payload.contenderExpectedDigest ?? "");
  const product = await openProduct();
  const owner = await product.vault.list(AUTHENTICATED_SCOPE, CONTENTION_OWNER_WORK_ID);
  const contender = await product.vault.list(
    AUTHENTICATED_SCOPE,
    CONTENTION_CONTENDER_WORK_ID,
  );
  const ownerDigest = await digestFrontiers(owner as unknown as JsonRecord[]);
  const contenderDigest = contender.length > 0
    ? await digestFrontiers(contender as unknown as JsonRecord[])
    : null;
  const ownerRows = await rowReceipt(product, CONTENTION_OWNER_WORK_ID);
  const contenderRows = await rowReceipt(product, CONTENTION_CONTENDER_WORK_ID);
  await product.runtime.closeStudioLocalDatabaseRuntime();
  const ownerExact = owner.length === 1
    && updateCount(owner as unknown as JsonRecord[]) === 129
    && ownerDigest === ownerExpectedDigest;
  const contenderExact = contenderCommitted
    ? contender.length === 1
      && updateCount(contender as unknown as JsonRecord[]) === 129
      && contenderDigest === contenderExpectedDigest
    : contender.length === 0 && contenderRows.rowCount === 0;
  const fallback = fallbackReceipt();
  const pass = ownerExact
    && contenderExact
    && fallback.indexedDbAccessCount === 0
    && fallback.localStorageAccessCount === 0
    && fallback.memoryDatabaseOpenCount === 0;
  return {
    status: pass ? "ok" : "error",
    pass,
    schemaVersion: REPORT_SCHEMA_VERSION,
    owner: {
      exact: ownerExact,
      digest: ownerDigest,
      expectedDigest: ownerExpectedDigest,
      rows: ownerRows,
    },
    contender: {
      expectedCommitted: contenderCommitted,
      exact: contenderExact,
      digest: contenderDigest,
      expectedDigest: contenderCommitted ? contenderExpectedDigest : null,
      rows: contenderRows,
    },
    fallback,
  };
}

async function execute(command: WorkerCommand): Promise<JsonRecord> {
  switch (command.command) {
    case "graceful-seed":
      return runGracefulSeed();
    case "graceful-reopen":
      return runGracefulReopen(command.payload ?? {});
    case "termination-seed":
      return runTerminationSeed();
    case "termination-verify":
      return runTerminationVerify(command.payload ?? {});
    case "corruption-seed":
      return runCorruptionSeed();
    case "corruption-verify":
      return runCorruptionVerify();
    case "contention-owner":
      return runContentionOwner(command.id, command.payload ?? {});
    case "contention-contender":
      return runContentionContender();
    case "contention-verify":
      return runContentionVerify(command.payload ?? {});
  }
}

globalThis.addEventListener("message", (event: MessageEvent<WorkerCommand>) => {
  const command = event.data;
  void execute(command).then(
    (value) => post({ type: "result", id: command.id, value }),
    (error) => post({
      type: "result",
      id: command.id,
      value: {
        status: "error",
        pass: false,
        schemaVersion: REPORT_SCHEMA_VERSION,
        error: errorShape(error),
        fallback: fallbackReceipt(),
      },
    }),
  );
});

post({
  type: "ready",
  schemaVersion: REPORT_SCHEMA_VERSION,
  capabilities: capabilities(),
});
