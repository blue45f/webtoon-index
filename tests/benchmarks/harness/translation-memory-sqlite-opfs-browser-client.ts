/** Dedicated Worker half of the real Chromium translation-memory SQLite OPFS probe. */

import {
  openStudioLocalDatabase,
  probeSqliteSupport,
  SqliteUnavailableError,
  STUDIO_SQLITE_DATABASE_FILENAME,
  STUDIO_SQLITE_OPFS_DIRECTORY,
  type StudioLocalDatabase,
  type StudioSqliteApiHandle,
  type StudioSqliteDatabaseHandle,
  type StudioSqlitePoolUtilHandle,
} from "../../../apps/web/src/domains/creator/studio-local-database";
import {
  createStudioTranslationMemoryEntry,
  exportStudioTranslationMemory,
  queryStudioTranslationMemory,
  STUDIO_TRANSLATION_MEMORY_STORAGE_KEY,
  upsertStudioTranslationMemoryEntry,
  type StudioTranslationMemoryEntry,
} from "../../../apps/web/src/domains/creator/studio-translation-memory";
import {
  createStudioTranslationMemorySqlitePersistence,
  STUDIO_TRANSLATION_MEMORY_SQLITE_KEY,
  STUDIO_TRANSLATION_MEMORY_SQLITE_NAMESPACE,
} from "../../../apps/web/src/domains/creator/studio-translation-memory-sqlite-persistence";

const REPORT_SCHEMA_VERSION = 1;
const ENTRY_COUNT = 512;
const SAVE_SAMPLE_COUNT = 30;
const LOAD_SAMPLE_COUNT = 50;
const TARGET_SOURCE = "오늘도 정말 반가워, 민수야!";
const TARGET_TRANSLATION_PREFIX = "It is so good to see you again, Minsu!";

type JsonRecord = Record<string, unknown>;

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

interface SqliteConstructorReceipt {
  readonly api: StudioSqliteApiHandle;
  readonly installedOpfsDirectories: string[];
  readonly openedOpfsDatabaseFilenames: string[];
  readonly openedMemoryDatabaseFilenames: string[];
}

interface FileSystemDirectoryEntryLike {
  readonly kind: "directory" | "file";
  readonly name: string;
}

interface FileSystemFileEntryLike extends FileSystemDirectoryEntryLike {
  readonly kind: "file";
  getFile(): Promise<File>;
}

interface FileSystemDirectoryLike extends FileSystemDirectoryEntryLike {
  readonly kind: "directory";
  entries(): AsyncIterableIterator<[string, FileSystemDirectoryEntryLike]>;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FileSystemDirectoryLike>;
}

function fixed(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[Math.min(sorted.length - 1, rank)] ?? 0;
}

function distribution(samples: readonly number[]): Distribution {
  const sorted = [...samples].sort((left, right) => left - right);
  const mean = samples.length === 0
    ? 0
    : samples.reduce((sum, value) => sum + value, 0) / samples.length;
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
      ...(error instanceof SqliteUnavailableError ? { reason: error.reason } : {}),
    };
  }
  return { name: "NonError", message: String(error), stack: null };
}

function publish(value: unknown): void {
  (globalThis as unknown as { postMessage(value: unknown): void }).postMessage({
    type: "benchmark-result",
    value,
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function createEntry(index: number, editIndex: number | null = null): StudioTranslationMemoryEntry {
  const isTarget = index === 0;
  const number = String(index).padStart(4, "0");
  const result = createStudioTranslationMemoryEntry({
    workScope: "v12-opfs-translation-memory",
    sourceText: isTarget ? TARGET_SOURCE : `에피소드 대사 ${number}: 장면의 감정을 유지해 주세요.`,
    speaker: isTarget ? "유나" : `화자-${index % 17}`,
    sourceLocale: "ko-KR",
    targetLocale: "en-US",
    sourceRevision: isTarget ? "target-r1" : `revision-${number}`,
    translation: isTarget
      ? `${TARGET_TRANSLATION_PREFIX}${editIndex === null ? "" : ` edit-${editIndex}`}`
      : `Episode line ${number}: preserve the emotion of this scene.`,
    status: "approved",
    now: 1_000 + index + (editIndex ?? 0) * 10_000,
  });
  if (!result.ok) throw new Error(result.error);
  return result.entry;
}

function createCorpus(): readonly StudioTranslationMemoryEntry[] {
  return Array.from({ length: ENTRY_COUNT }, (_, index) => createEntry(index));
}

function editTarget(
  entries: readonly StudioTranslationMemoryEntry[],
  editIndex: number,
): readonly StudioTranslationMemoryEntry[] {
  const previous = entries.find((entry) => entry.sourceText === TARGET_SOURCE);
  if (!previous) throw new Error("target entry disappeared before sequential edit");
  const edited = {
    ...createEntry(0, editIndex),
    createdAt: previous.createdAt,
  };
  return upsertStudioTranslationMemoryEntry(entries, edited);
}

function trackedSqliteApi(sqliteApi: StudioSqliteApiHandle): SqliteConstructorReceipt {
  const installedOpfsDirectories: string[] = [];
  const openedOpfsDatabaseFilenames: string[] = [];
  const openedMemoryDatabaseFilenames: string[] = [];
  const MemoryDb = new Proxy(sqliteApi.oo1.DB, {
    construct(target, args, newTarget) {
      openedMemoryDatabaseFilenames.push(String(args[0]));
      return Reflect.construct(target, args, newTarget) as StudioSqliteDatabaseHandle;
    },
  });
  const api: StudioSqliteApiHandle = {
    oo1: { DB: MemoryDb },
    async installOpfsSAHPoolVfs(options): Promise<StudioSqlitePoolUtilHandle> {
      installedOpfsDirectories.push(options.directory ?? "");
      const pool = await sqliteApi.installOpfsSAHPoolVfs(options);
      const OpfsDb = new Proxy(pool.OpfsSAHPoolDb, {
        construct(target, args, newTarget) {
          openedOpfsDatabaseFilenames.push(String(args[0]));
          return Reflect.construct(target, args, newTarget) as StudioSqliteDatabaseHandle;
        },
      });
      return { OpfsSAHPoolDb: OpfsDb };
    },
  };
  return {
    api,
    installedOpfsDirectories,
    openedOpfsDatabaseFilenames,
    openedMemoryDatabaseFilenames,
  };
}

async function walkDirectory(
  directory: FileSystemDirectoryLike,
  prefix = "",
): Promise<Array<{ path: string; kind: string; sizeBytes: number | null }>> {
  const rows: Array<{ path: string; kind: string; sizeBytes: number | null }> = [];
  for await (const [name, entry] of directory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === "file") {
      rows.push({
        path,
        kind: entry.kind,
        sizeBytes: (await (entry as FileSystemFileEntryLike).getFile()).size,
      });
      continue;
    }
    rows.push({ path, kind: entry.kind, sizeBytes: null });
    rows.push(...await walkDirectory(entry as FileSystemDirectoryLike, path));
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

async function inspectOpfsDirectory(): Promise<JsonRecord> {
  const root = await navigator.storage.getDirectory() as unknown as FileSystemDirectoryLike;
  try {
    const directory = await root.getDirectoryHandle(STUDIO_SQLITE_OPFS_DIRECTORY);
    const entries = await walkDirectory(directory);
    return {
      exists: true,
      entries,
      fileCount: entries.filter((entry) => entry.kind === "file").length,
      totalFileBytes: entries.reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0),
    };
  } catch (error) {
    return { exists: false, entries: [], fileCount: 0, totalFileBytes: 0, error: errorShape(error) };
  }
}

async function run(): Promise<void> {
  const securityPolicyViolations: JsonRecord[] = [];
  globalThis.addEventListener("securitypolicyviolation", (event) => {
    const violation = event as SecurityPolicyViolationEvent;
    securityPolicyViolations.push({
      effectiveDirective: violation.effectiveDirective,
      blockedUri: violation.blockedURI,
      disposition: violation.disposition,
    });
  });
  const capabilities = {
    dedicatedWorker:
      typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope,
    secureContext: globalThis.isSecureContext,
    crossOriginIsolated: globalThis.crossOriginIsolated,
    navigatorStorageGetDirectory: typeof navigator.storage?.getDirectory === "function",
    syncAccessHandle:
      typeof globalThis.FileSystemFileHandle?.prototype?.createSyncAccessHandle === "function",
    cryptoSubtle: typeof crypto.subtle?.digest === "function",
    localStorageApiPresent: "localStorage" in globalThis,
  };

  let sqliteApi: StudioSqliteApiHandle;
  const sqliteInitStartedAt = performance.now();
  try {
    const sqliteModule = await import("@sqlite.org/sqlite-wasm");
    sqliteApi = await sqliteModule.default() as unknown as StudioSqliteApiHandle;
  } catch (error) {
    publish({
      status: "unsupported",
      pass: false,
      schemaVersion: REPORT_SCHEMA_VERSION,
      reason: `sqlite-wasm failed to initialize: ${String(error)}`,
      capabilities,
      error: errorShape(error),
      securityPolicyViolations,
    });
    return;
  }
  const sqliteWasmInitMs = performance.now() - sqliteInitStartedAt;
  const tracked = trackedSqliteApi(sqliteApi);
  const loadSqlite = (): Promise<StudioSqliteApiHandle> => Promise.resolve(tracked.api);
  const support = await probeSqliteSupport({ loadSqlite });
  if (!support.wasm || !support.opfs) {
    publish({
      status: "unsupported",
      pass: false,
      schemaVersion: REPORT_SCHEMA_VERSION,
      reason: support.reason ?? "SQLite OPFS SAH-pool is unavailable",
      support,
      capabilities,
      securityPolicyViolations,
    });
    return;
  }

  let database: StudioLocalDatabase | null = null;
  try {
    const coldOpenStartedAt = performance.now();
    database = await openStudioLocalDatabase({ vfs: "opfs", loadSqlite });
    const coldOpenMs = performance.now() - coldOpenStartedAt;
    let persistence = createStudioTranslationMemorySqlitePersistence({
      acquireDatabase: () => Promise.resolve(database!),
    });
    const initial = await persistence.load();
    if (initial.status !== "empty" || initial.entries.length !== 0) {
      throw new Error("fresh Chromium profile unexpectedly contained translation-memory data");
    }

    let latestEntries = createCorpus();
    const saveSamples: number[] = [];
    for (let index = 0; index < SAVE_SAMPLE_COUNT; index += 1) {
      latestEntries = editTarget(latestEntries, index);
      const startedAt = performance.now();
      const saved = await persistence.save(latestEntries);
      saveSamples.push(performance.now() - startedAt);
      if (!saved.ok) throw new Error(saved.error ?? `save ${index} failed`);
    }
    const latestExport = exportStudioTranslationMemory(latestEntries);
    if (!latestExport.ok) throw new Error(latestExport.error);
    const expectedDigest = await sha256(latestExport.json);
    const rawBeforeClose = await database.kvGet(
      STUDIO_TRANSLATION_MEMORY_SQLITE_NAMESPACE,
      STUDIO_TRANSLATION_MEMORY_SQLITE_KEY,
    );
    const rawBeforeCloseDigest = rawBeforeClose === null ? null : await sha256(rawBeforeClose);
    const opfsAfterSave = await inspectOpfsDirectory();

    await database.close();
    database = null;
    const closeCompletedBeforeReopen = true;

    const reopenStartedAt = performance.now();
    database = await openStudioLocalDatabase({ vfs: "opfs", loadSqlite });
    const reopenMs = performance.now() - reopenStartedAt;
    persistence = createStudioTranslationMemorySqlitePersistence({
      acquireDatabase: () => Promise.resolve(database!),
    });
    const reopened = await persistence.load();
    if (reopened.status !== "ok") {
      throw new Error(reopened.error ?? `reopen returned ${reopened.status}`);
    }
    const reopenedExport = exportStudioTranslationMemory(reopened.entries);
    if (!reopenedExport.ok) throw new Error(reopenedExport.error);
    const reopenedDigest = await sha256(reopenedExport.json);

    const loadSamples: number[] = [];
    let loadMismatchCount = 0;
    for (let index = 0; index < LOAD_SAMPLE_COUNT; index += 1) {
      const startedAt = performance.now();
      const loaded = await persistence.load();
      loadSamples.push(performance.now() - startedAt);
      const exported = exportStudioTranslationMemory(loaded.entries);
      if (loaded.status !== "ok" || !exported.ok || exported.json !== latestExport.json) {
        loadMismatchCount += 1;
      }
    }

    const exact = queryStudioTranslationMemory(reopened.entries, {
      workScope: "v12-opfs-translation-memory",
      sourceText: TARGET_SOURCE,
      speaker: "유나",
      sourceLocale: "ko-KR",
      targetLocale: "en-US",
      sourceRevision: "target-r1",
    });
    const fuzzy = queryStudioTranslationMemory(reopened.entries, {
      workScope: "v12-opfs-translation-memory",
      sourceText: "오늘도 정말 반가워 민수야!",
      speaker: "유나",
      sourceLocale: "ko-KR",
      targetLocale: "en-US",
      sourceRevision: "target-r2",
    });
    const isolated = queryStudioTranslationMemory(reopened.entries, {
      workScope: "v12-opfs-translation-memory",
      sourceText: TARGET_SOURCE,
      speaker: "유나",
      sourceLocale: "ko-KR",
      targetLocale: "ja-JP",
      sourceRevision: "target-r1",
    });
    const rawAfterReopen = await database.kvGet(
      STUDIO_TRANSLATION_MEMORY_SQLITE_NAMESPACE,
      STUDIO_TRANSLATION_MEMORY_SQLITE_KEY,
    );
    const legacyKeyProbe = await database.kvGet(
      STUDIO_TRANSLATION_MEMORY_SQLITE_NAMESPACE,
      STUDIO_TRANSLATION_MEMORY_STORAGE_KEY,
    );
    const legacyNamespaceProbe = await database.kvGet(
      "studio-translation-memory",
      STUDIO_TRANSLATION_MEMORY_SQLITE_KEY,
    );
    const opfsFinal = await inspectOpfsDirectory();

    const opened = tracked.openedOpfsDatabaseFilenames;
    const exactTranslation = exact.exact?.entry.translation ?? null;
    const expectedTranslation = `${TARGET_TRANSLATION_PREFIX} edit-${SAVE_SAMPLE_COUNT - 1}`;
    const pass =
      reopened.entries.length === ENTRY_COUNT
      && reopenedExport.json === latestExport.json
      && expectedDigest === reopenedDigest
      && rawBeforeClose === latestExport.json
      && rawAfterReopen === latestExport.json
      && rawBeforeCloseDigest === expectedDigest
      && loadMismatchCount === 0
      && exact.exact?.reusable === true
      && exactTranslation === expectedTranslation
      && fuzzy.exact === null
      && fuzzy.fuzzy[0]?.entry.translation === expectedTranslation
      && fuzzy.fuzzy[0]?.autoApply === false
      && isolated.exact === null
      && isolated.fuzzy.length === 0
      && legacyKeyProbe === null
      && legacyNamespaceProbe === null
      && opened.length === 2
      && opened.every((filename) => filename === `/${STUDIO_SQLITE_DATABASE_FILENAME}`)
      && tracked.openedMemoryDatabaseFilenames.length === 0
      && capabilities.localStorageApiPresent === false
      && securityPolicyViolations.length === 0;

    publish({
      status: pass ? "ok" : "fail",
      pass,
      schemaVersion: REPORT_SCHEMA_VERSION,
      execution: "vite-production-build-chromium-dedicated-worker-opfs-sahpool",
      authority: {
        kind: "sqlite-opfs-sahpool",
        requestedVfs: "opfs",
        productPersistence: "createStudioTranslationMemorySqlitePersistence",
        namespace: STUDIO_TRANSLATION_MEMORY_SQLITE_NAMESPACE,
        key: STUDIO_TRANSLATION_MEMORY_SQLITE_KEY,
        opfsDirectory: STUDIO_SQLITE_OPFS_DIRECTORY,
        logicalDatabaseFilename: STUDIO_SQLITE_DATABASE_FILENAME,
        expectedOpenFilename: `/${STUDIO_SQLITE_DATABASE_FILENAME}`,
        openedOpfsDatabaseFilenames: opened,
        installedOpfsDirectories: tracked.installedOpfsDirectories,
        opfsDatabaseOpenCount: opened.length,
        nonV12DatabaseOpenCount: opened.filter(
          (filename) => filename !== `/${STUDIO_SQLITE_DATABASE_FILENAME}`,
        ).length,
        memoryDatabaseOpenCount: tracked.openedMemoryDatabaseFilenames.length,
        memoryDatabaseOpenFilenames: tracked.openedMemoryDatabaseFilenames,
        memoryVfsUsed: tracked.openedMemoryDatabaseFilenames.length > 0,
        localStorageApiPresent: capabilities.localStorageApiPresent,
        localStorageFallbackUsed: false,
        closeCompletedBeforeReopen,
      },
      policy: {
        legacyDataMigration: false,
        discardExistingStudioData: true,
        oldLocalStorageRead: false,
        legacyKeyProbeEmpty: legacyKeyProbe === null,
        legacyNamespaceProbeEmpty: legacyNamespaceProbe === null,
      },
      support,
      capabilities,
      browser: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemoryGiB:
          (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
      },
      config: {
        entryCount: ENTRY_COUNT,
        saveSampleCount: SAVE_SAMPLE_COUNT,
        loadSampleCount: LOAD_SAMPLE_COUNT,
        canonicalBytes: new TextEncoder().encode(latestExport.json).byteLength,
      },
      opening: {
        sqliteWasmInitMs: fixed(sqliteWasmInitMs),
        coldOpenMs: fixed(coldOpenMs),
        reopenMs: fixed(reopenMs),
      },
      saves: {
        successfulCount: SAVE_SAMPLE_COUNT,
        distribution: distribution(saveSamples),
      },
      loads: {
        successfulCount: LOAD_SAMPLE_COUNT,
        mismatchCount: loadMismatchCount,
        distribution: distribution(loadSamples),
      },
      integrity: {
        expectedEntryCount: ENTRY_COUNT,
        reopenedEntryCount: reopened.entries.length,
        noEntryLoss: reopened.entries.length === ENTRY_COUNT,
        canonicalJsonExact: reopenedExport.json === latestExport.json,
        rawBeforeCloseExact: rawBeforeClose === latestExport.json,
        rawAfterReopenExact: rawAfterReopen === latestExport.json,
        expectedSha256: expectedDigest,
        rawBeforeCloseSha256: rawBeforeCloseDigest,
        reopenedSha256: reopenedDigest,
      },
      search: {
        exactFound: exact.exact !== null,
        exactReusable: exact.exact?.reusable ?? false,
        exactTranslation,
        expectedTranslation,
        fuzzyFound: fuzzy.fuzzy.length > 0,
        fuzzyScore: fuzzy.fuzzy[0]?.score ?? null,
        fuzzyAutoApply: fuzzy.fuzzy[0]?.autoApply ?? null,
        localeIsolationExactCount: isolated.exact === null ? 0 : 1,
        localeIsolationFuzzyCount: isolated.fuzzy.length,
      },
      opfs: { afterSave: opfsAfterSave, final: opfsFinal },
      securityPolicyViolations,
    });
  } catch (error) {
    publish({
      status: "error",
      pass: false,
      schemaVersion: REPORT_SCHEMA_VERSION,
      execution: "vite-production-build-chromium-dedicated-worker-opfs-sahpool",
      error: errorShape(error),
      support,
      capabilities,
      authority: {
        namespace: STUDIO_TRANSLATION_MEMORY_SQLITE_NAMESPACE,
        logicalDatabaseFilename: STUDIO_SQLITE_DATABASE_FILENAME,
        openedOpfsDatabaseFilenames: tracked.openedOpfsDatabaseFilenames,
        openedMemoryDatabaseFilenames: tracked.openedMemoryDatabaseFilenames,
      },
      securityPolicyViolations,
    });
  } finally {
    await database?.close().catch(() => undefined);
  }
}

void run();
