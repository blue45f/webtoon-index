/**
 * Dedicated Worker half of the real SQLite OPFS SAH-pool filter-library benchmark.
 *
 * This uses the product `openStudioLocalDatabase({ vfs: "opfs" })` and
 * `createSqliteFilterLibraryRepository` paths. There is intentionally no memory or
 * localStorage fallback. The tracked constructors produce a receipt proving that both
 * product opens target only `/studio-local-v12.db`.
 */

import {
  createSqliteFilterLibraryRepository,
  normalizeStudioFilterLibraryPreset,
  studioFilterPresetToSqlRecord,
  type StudioFilterLibraryPreset,
} from "../../../apps/web/src/domains/creator/filter/studio-filter-library-sqlite-repository";
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

const REPORT_SCHEMA_VERSION = 1;
const PRESET_COUNT = 10_000;
const INSERT_BATCH_SIZE = 250;
const PAGE_SIZE = 257;
const LOOKUP_SAMPLE_COUNT = 200;
const QUERY_SAMPLE_COUNT = 60;
const BASE_EPOCH = 1_800_000_000_000;
const CATEGORIES = ["comic", "photo", "tone", "line", "color", "webtoon"] as const;

type JsonRecord = Record<string, unknown>;

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

interface BrowserMemoryPerformance extends Performance {
  readonly memory?: {
    readonly jsHeapSizeLimit: number;
    readonly totalJSHeapSize: number;
    readonly usedJSHeapSize: number;
  };
  measureUserAgentSpecificMemory?: () => Promise<{
    bytes: number;
    breakdown?: readonly unknown[];
  }>;
}

interface TimedSample {
  readonly index: number;
  readonly count: number;
  readonly ms: number;
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

interface SqliteConstructorReceipt {
  readonly api: StudioSqliteApiHandle;
  readonly installedOpfsDirectories: string[];
  readonly openedOpfsDatabaseFilenames: string[];
  readonly openedMemoryDatabaseFilenames: string[];
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

function makePreset(index: number): StudioFilterLibraryPreset {
  const number = String(index).padStart(5, "0");
  const category = CATEGORIES[index % CATEGORIES.length]!;
  const raw: StudioFilterLibraryPreset = {
    id: `opfs-filter-${number}`,
    packageId: `opfs-pack-${String(index % 400).padStart(3, "0")}`,
    entryId: `entry-${number}`,
    name: `${category} OPFS 작가 필터 ${number}`,
    engine: "vignette",
    values: {
      darkness: 1 + (index % 100),
      size: (index * 3) % 101,
      roundness: (index * 7) % 101,
      feather: (index * 11) % 101,
    },
    installedAt: BASE_EPOCH + index,
    updatedAt: BASE_EPOCH + (index * 2),
    category,
    favorite: index % 13 === 0,
    sortOrder: index % 1_000,
    packageVersion: "12.0.0",
    packageFingerprint: `opfs-fingerprint-${index % 400}`,
  };
  const normalized = normalizeStudioFilterLibraryPreset(raw);
  const secondPass = normalizeStudioFilterLibraryPreset(normalized);
  if (JSON.stringify(secondPass) !== JSON.stringify(normalized)) {
    throw new Error(`generated preset ${raw.id} is not normalization-idempotent`);
  }
  return normalized;
}

function comparePresets(
  left: StudioFilterLibraryPreset,
  right: StudioFilterLibraryPreset,
): number {
  if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
  if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
  return left.id.localeCompare(right.id);
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function storageEstimate(): Promise<JsonRecord> {
  const estimate = await navigator.storage.estimate();
  const withDetails = estimate as StorageEstimate & {
    usageDetails?: Record<string, number>;
  };
  return {
    usageBytes: estimate.usage ?? null,
    quotaBytes: estimate.quota ?? null,
    usageDetails: withDetails.usageDetails ?? null,
  };
}

async function browserMemoryEstimate(): Promise<JsonRecord> {
  const browserPerformance = performance as BrowserMemoryPerformance;
  let userAgentSpecific: JsonRecord | null = null;
  let userAgentSpecificError: JsonRecord | null = null;
  if (typeof browserPerformance.measureUserAgentSpecificMemory === "function") {
    try {
      const measured = await browserPerformance.measureUserAgentSpecificMemory();
      userAgentSpecific = {
        bytes: measured.bytes,
        breakdownEntryCount: measured.breakdown?.length ?? null,
      };
    } catch (error) {
      userAgentSpecificError = errorShape(error);
    }
  }
  return {
    performanceMemory: browserPerformance.memory
      ? {
          usedJSHeapSizeBytes: browserPerformance.memory.usedJSHeapSize,
          totalJSHeapSizeBytes: browserPerformance.memory.totalJSHeapSize,
          jsHeapSizeLimitBytes: browserPerformance.memory.jsHeapSizeLimit,
        }
      : null,
    userAgentSpecific,
    userAgentSpecificError,
  };
}

async function walkDirectory(
  directory: FileSystemDirectoryLike,
  prefix = "",
): Promise<Array<{ path: string; kind: "directory" | "file"; sizeBytes: number | null }>> {
  const rows: Array<{
    path: string;
    kind: "directory" | "file";
    sizeBytes: number | null;
  }> = [];
  for await (const [name, entry] of directory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === "file") {
      const file = await (entry as FileSystemFileEntryLike).getFile();
      rows.push({ path, kind: "file", sizeBytes: file.size });
    } else {
      rows.push({ path, kind: "directory", sizeBytes: null });
      rows.push(...await walkDirectory(entry as FileSystemDirectoryLike, path));
    }
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

async function inspectProductOpfsDirectory(): Promise<JsonRecord> {
  const root = await navigator.storage.getDirectory() as unknown as FileSystemDirectoryLike;
  let directory: FileSystemDirectoryLike;
  try {
    directory = await root.getDirectoryHandle(STUDIO_SQLITE_OPFS_DIRECTORY);
  } catch (error) {
    return {
      exists: false,
      error: errorShape(error),
      entries: [],
      fileCount: 0,
      totalFileBytes: 0,
    };
  }
  const entries = await walkDirectory(directory);
  return {
    exists: true,
    entries,
    fileCount: entries.filter((entry) => entry.kind === "file").length,
    totalFileBytes: entries.reduce(
      (sum, entry) => sum + (entry.kind === "file" ? entry.sizeBytes ?? 0 : 0),
      0,
    ),
  };
}

function missingAndUnexpected(
  expected: readonly string[],
  observed: readonly string[],
): { missing: string[]; unexpected: string[]; duplicateCount: number } {
  const expectedSet = new Set(expected);
  const observedSet = new Set(observed);
  return {
    missing: expected.filter((id) => !observedSet.has(id)),
    unexpected: observed.filter((id) => !expectedSet.has(id)),
    duplicateCount: observed.length - observedSet.size,
  };
}

function countExpected(
  presets: readonly StudioFilterLibraryPreset[],
  predicate: (preset: StudioFilterLibraryPreset) => boolean,
): number {
  return presets.reduce((count, preset) => count + Number(predicate(preset)), 0);
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
    dedicatedWorker: typeof WorkerGlobalScope !== "undefined"
      && globalThis instanceof WorkerGlobalScope,
    secureContext: globalThis.isSecureContext,
    crossOriginIsolated: globalThis.crossOriginIsolated,
    navigatorStorageGetDirectory: typeof navigator.storage?.getDirectory === "function",
    syncAccessHandle:
      typeof globalThis.FileSystemFileHandle?.prototype?.createSyncAccessHandle === "function",
    cryptoSubtle: typeof crypto.subtle?.digest === "function",
    localStorageApiPresent: "localStorage" in globalThis,
  };
  let sqliteApi: StudioSqliteApiHandle;
  try {
    const sqliteModule = await import("@sqlite.org/sqlite-wasm");
    sqliteApi = await sqliteModule.default() as unknown as StudioSqliteApiHandle;
  } catch (error) {
    publish({
      status: "unsupported",
      pass: false,
      schemaVersion: REPORT_SCHEMA_VERSION,
      authority: "unavailable",
      reason: `sqlite-wasm failed to initialize: ${errorShape(error).message}`,
      capabilities,
      error: errorShape(error),
      securityPolicyViolations,
    });
    return;
  }
  const tracked = trackedSqliteApi(sqliteApi);
  const loadSqlite = (): Promise<StudioSqliteApiHandle> => Promise.resolve(tracked.api);
  const support = await probeSqliteSupport({ loadSqlite });
  if (!support.wasm || !support.opfs) {
    publish({
      status: "unsupported",
      pass: false,
      schemaVersion: REPORT_SCHEMA_VERSION,
      authority: "unavailable",
      reason: support.reason ?? "sqlite-wasm or OPFS SAH-pool support is unavailable",
      support,
      capabilities,
      securityPolicyViolations,
    });
    return;
  }

  const source = Array.from({ length: PRESET_COUNT }, (_, index) => makePreset(index));
  if (source.length !== PRESET_COUNT || new Set(source.map((preset) => preset.id)).size !== PRESET_COUNT) {
    throw new Error("the browser corpus is not exactly 10,000 unique normalized presets");
  }
  const expectedOrderedIds = [...source].sort(comparePresets).map((preset) => preset.id);
  const expectedOrderDigestSha256 = await sha256(expectedOrderedIds.join("\n"));
  const sourcePayloadBytes = source.reduce(
    (sum, preset) => sum + new TextEncoder().encode(
      studioFilterPresetToSqlRecord(preset).payload,
    ).byteLength,
    0,
  );

  const storageBefore = await storageEstimate();
  const memoryBefore = await browserMemoryEstimate();
  const opfsBefore = await inspectProductOpfsDirectory();
  let database: StudioLocalDatabase | null = null;

  try {
    database = await openStudioLocalDatabase({ vfs: "opfs", loadSqlite });
    let repository = createSqliteFilterLibraryRepository(database);
    const initialPage = await repository.query({ limit: 1 });
    if (initialPage.items.length !== 0 || initialPage.totalCount !== 0) {
      throw new Error("benchmark origin was not backed by a fresh empty V12 OPFS database");
    }

    const insertSamples: TimedSample[] = [];
    const insertStartedAt = performance.now();
    let insertedCount = 0;
    for (let offset = 0; offset < source.length; offset += INSERT_BATCH_SIZE) {
      const batch = source.slice(offset, offset + INSERT_BATCH_SIZE);
      const startedAt = performance.now();
      const savedCount = await repository.putMany(batch);
      insertSamples.push({
        index: insertSamples.length,
        count: batch.length,
        ms: fixed(performance.now() - startedAt),
      });
      insertedCount += savedCount;
    }
    const insertTotalMs = fixed(performance.now() - insertStartedAt);
    if (insertedCount !== PRESET_COUNT) {
      throw new Error(`unexpected insert summary: saved=${insertedCount}`);
    }

    const opfsAfterInsert = await inspectProductOpfsDirectory();
    const storageAfterInsert = await storageEstimate();
    const memoryAfterInsert = await browserMemoryEstimate();

    await database.close();
    database = null;
    const closeCompletedBeforeReopen = true;

    const reopenStartedAt = performance.now();
    database = await openStudioLocalDatabase({ vfs: "opfs", loadSqlite });
    const reopenMs = fixed(performance.now() - reopenStartedAt);
    repository = createSqliteFilterLibraryRepository(database);
    const reopenProbe = await repository.getById("opfs-filter-09999");
    if (reopenProbe?.name !== "line OPFS 작가 필터 09999") {
      throw new Error("close/reopen did not recover the expected final preset from OPFS SQLite");
    }

    const pageSamples: number[] = [];
    const pageReceipts: JsonRecord[] = [];
    const observedIds: string[] = [];
    let cursor = null;
    let pageIndex = 0;
    let hasMore = true;
    let firstTotalCount: number | null = null;
    while (hasMore) {
      const startedAt = performance.now();
      const page = await repository.query({ cursor, limit: PAGE_SIZE });
      const elapsed = performance.now() - startedAt;
      pageSamples.push(elapsed);
      if (firstTotalCount === null) firstTotalCount = page.totalCount;
      const pageIds = page.items.map((preset) => preset.id);
      for (const preset of page.items) {
        const normalized = normalizeStudioFilterLibraryPreset(preset);
        if (JSON.stringify(normalized) !== JSON.stringify(preset)) {
          throw new Error(`product repository returned a non-canonical row: ${preset.id}`);
        }
      }
      observedIds.push(...pageIds);
      pageReceipts.push({
        index: pageIndex,
        itemCount: pageIds.length,
        firstId: pageIds[0] ?? null,
        lastId: pageIds.at(-1) ?? null,
        nextCursorDigestSha256: page.nextCursor === null
          ? null
          : await sha256(JSON.stringify(page.nextCursor)),
        totalCount: page.totalCount,
        ms: fixed(elapsed),
      });
      hasMore = page.hasMore;
      cursor = page.nextCursor;
      pageIndex += 1;
      if (hasMore && cursor === null) {
        throw new Error("keyset page reported hasMore without a cursor");
      }
      if (pageIndex > Math.ceil(PRESET_COUNT / PAGE_SIZE) + 1) {
        throw new Error("keyset pagination exceeded its deterministic page bound");
      }
    }
    const setDiff = missingAndUnexpected(expectedOrderedIds, observedIds);
    const observedOrderDigestSha256 = await sha256(observedIds.join("\n"));
    const orderMismatchCount = observedIds.reduce(
      (count, id, index) => count + Number(id !== expectedOrderedIds[index]),
      0,
    );

    const lookupSamples: number[] = [];
    let lookupMismatchCount = 0;
    for (let index = 0; index < LOOKUP_SAMPLE_COUNT; index += 1) {
      const targetIndex = (index * 97) % PRESET_COUNT;
      const id = `opfs-filter-${String(targetIndex).padStart(5, "0")}`;
      const startedAt = performance.now();
      const preset = await repository.getById(id);
      lookupSamples.push(performance.now() - startedAt);
      if (preset?.id !== id) lookupMismatchCount += 1;
    }

    const filterCases = [
      {
        id: "nfkc-search-comic",
        request: { search: "ＣＯＭＩＣ", limit: 64 },
        expectedCount: countExpected(source, (preset) => preset.category === "comic"),
      },
      {
        id: "category-comic",
        request: { category: "comic", limit: 64 },
        expectedCount: countExpected(source, (preset) => preset.category === "comic"),
      },
      {
        id: "favorite-only",
        request: { favorite: true, limit: 64 },
        expectedCount: countExpected(source, (preset) => preset.favorite),
      },
      {
        id: "category-engine-favorite",
        request: {
          category: "comic",
          engine: "vignette",
          favorite: true,
          limit: 64,
        },
        expectedCount: countExpected(
          source,
          (preset) => preset.category === "comic" && preset.favorite,
        ),
      },
    ] as const;
    const filterReceipts: JsonRecord[] = [];
    for (const filterCase of filterCases) {
      const samples: number[] = [];
      let observedTotalCount: number | null = null;
      let mismatchCount = 0;
      let firstPageDigestSha256: string | null = null;
      for (let index = 0; index < QUERY_SAMPLE_COUNT; index += 1) {
        const startedAt = performance.now();
        const page = await repository.query(filterCase.request);
        samples.push(performance.now() - startedAt);
        observedTotalCount = page.totalCount;
        if (page.totalCount !== filterCase.expectedCount) mismatchCount += 1;
        if (index === 0) {
          firstPageDigestSha256 = await sha256(
            page.items.map((preset) => preset.id).join("\n"),
          );
        }
      }
      filterReceipts.push({
        id: filterCase.id,
        request: filterCase.request,
        expectedCount: filterCase.expectedCount,
        observedTotalCount,
        mismatchCount,
        firstPageDigestSha256,
        distribution: distribution(samples),
      });
    }

    const storageFinal = await storageEstimate();
    const memoryFinal = await browserMemoryEstimate();
    const opfsFinal = await inspectProductOpfsDirectory();
    const expectedFilename = `/${STUDIO_SQLITE_DATABASE_FILENAME}`;
    const nonV12DatabaseOpenCount = tracked.openedOpfsDatabaseFilenames.filter(
      (filename) => filename !== expectedFilename,
    ).length;
    const allIntegrityChecksPassed =
      observedIds.length === PRESET_COUNT
      && firstTotalCount === PRESET_COUNT
      && setDiff.missing.length === 0
      && setDiff.unexpected.length === 0
      && setDiff.duplicateCount === 0
      && orderMismatchCount === 0
      && expectedOrderDigestSha256 === observedOrderDigestSha256
      && lookupMismatchCount === 0
      && filterReceipts.every((receipt) => receipt.mismatchCount === 0)
      && tracked.openedOpfsDatabaseFilenames.length === 2
      && nonV12DatabaseOpenCount === 0
      && tracked.openedMemoryDatabaseFilenames.length === 0
      && tracked.installedOpfsDirectories.length === 2
      && tracked.installedOpfsDirectories.every(
        (directory) => directory === STUDIO_SQLITE_OPFS_DIRECTORY,
      )
      && capabilities.localStorageApiPresent === false
      && opfsAfterInsert.exists === true
      && opfsFinal.exists === true
      && Number(opfsFinal.fileCount) > 0
      && Number(opfsFinal.totalFileBytes) > 0;

    publish({
      status: allIntegrityChecksPassed ? "ok" : "error",
      pass: allIntegrityChecksPassed,
      schemaVersion: REPORT_SCHEMA_VERSION,
      execution: "vite-production-build-chromium-dedicated-worker-opfs-sahpool",
      authority: {
        kind: "sqlite-opfs-sahpool",
        requestedVfs: "opfs",
        productOpenExpression: 'openStudioLocalDatabase({ vfs: "opfs", loadSqlite })',
        productRepository: "createSqliteFilterLibraryRepository",
        sqlitePackage: "@sqlite.org/sqlite-wasm 3.53.0-build1",
        opfsDirectory: STUDIO_SQLITE_OPFS_DIRECTORY,
        logicalDatabaseFilename: STUDIO_SQLITE_DATABASE_FILENAME,
        expectedOpenFilename: expectedFilename,
        openedOpfsDatabaseFilenames: tracked.openedOpfsDatabaseFilenames,
        installedOpfsDirectories: tracked.installedOpfsDirectories,
        opfsDatabaseOpenCount: tracked.openedOpfsDatabaseFilenames.length,
        nonV12DatabaseOpenCount,
        memoryDatabaseOpenCount: tracked.openedMemoryDatabaseFilenames.length,
        memoryDatabaseOpenFilenames: tracked.openedMemoryDatabaseFilenames,
        memoryVfsUsed: false,
        localStorageApiPresent: capabilities.localStorageApiPresent,
        localStorageFallbackUsed: false,
        closeCompletedBeforeReopen,
      },
      policy: {
        noFilterCatalogCap: true,
        legacyDataMigration: false,
        discardExistingStudioData: true,
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
        presetCount: PRESET_COUNT,
        insertBatchSize: INSERT_BATCH_SIZE,
        insertBatchCount: insertSamples.length,
        pageSize: PAGE_SIZE,
        lookupSampleCount: LOOKUP_SAMPLE_COUNT,
        querySampleCountPerCase: QUERY_SAMPLE_COUNT,
        sourcePayloadBytes,
      },
      insertion: {
        initialCount: initialPage.totalCount,
        insertedCount,
        totalMs: insertTotalMs,
        throughputPresetsPerSecond: fixed((insertedCount / insertTotalMs) * 1_000, 2),
        batchSamples: insertSamples,
        distribution: distribution(insertSamples.map((sample) => sample.ms)),
      },
      durability: {
        closedOnce: closeCompletedBeforeReopen,
        reopenMs,
        reopenProbeId: reopenProbe.id,
        reopenProbeName: reopenProbe.name,
      },
      keysetFullScan: {
        pageCount: pageIndex,
        observedCount: observedIds.length,
        uniqueCount: new Set(observedIds).size,
        expectedTotalCount: PRESET_COUNT,
        firstPageTotalCount: firstTotalCount,
        duplicateCount: setDiff.duplicateCount,
        missingCount: setDiff.missing.length,
        unexpectedCount: setDiff.unexpected.length,
        missingIds: setDiff.missing,
        unexpectedIds: setDiff.unexpected,
        orderMismatchCount,
        expectedOrderDigestSha256,
        observedOrderDigestSha256,
        pageReceipts,
        distribution: distribution(pageSamples),
      },
      structuredIntegrity: {
        productPayloadIndexValidationPath:
          "createSqliteFilterLibraryRepository.query -> sqlRecordToStudioFilterPreset",
        validatedCanonicalRowCount: observedIds.length,
        canonicalNormalizationMismatchCount: orderMismatchCount,
        lookupMismatchCount,
        allChecksPassed: allIntegrityChecksPassed,
      },
      idLookup: {
        mismatchCount: lookupMismatchCount,
        distribution: distribution(lookupSamples),
      },
      queries: filterReceipts,
      opfs: {
        before: opfsBefore,
        afterInsert: opfsAfterInsert,
        final: opfsFinal,
      },
      storage: {
        before: storageBefore,
        afterInsert: storageAfterInsert,
        final: storageFinal,
      },
      memory: {
        before: memoryBefore,
        afterInsert: memoryAfterInsert,
        final: memoryFinal,
      },
      securityPolicyViolations,
    });
  } finally {
    await database?.close().catch(() => undefined);
  }
}

run().catch((error) => {
  publish({
    status: error instanceof SqliteUnavailableError ? "unsupported" : "error",
    pass: false,
    schemaVersion: REPORT_SCHEMA_VERSION,
    authority: error instanceof SqliteUnavailableError ? "unavailable" : "sqlite-opfs-sahpool",
    reason: error instanceof SqliteUnavailableError ? error.reason : undefined,
    error: errorShape(error),
  });
});
