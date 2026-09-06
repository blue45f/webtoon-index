/**
 * Dedicated Worker for the real custom-font SQLite/OPFS production-browser gate.
 *
 * Product modules are imported only after ambient fallback probes are installed. Every save and
 * load goes through createStudioCustomFontSqliteOpfsRepository() with no repository options; the
 * only seam is the same tracked OPFS SQLite constructor used by the other V12 browser gates.
 */

declare const __CUSTOM_FONT_BENCHMARK_FIXTURES__: readonly FontFixtureDescriptor[];

const REPORT_SCHEMA_VERSION = 1;
const OPERATION_SAMPLES = 30;
const TERMINATION_FONT_ID = "forced-termination-committed-font";

type WorkerCommand =
  | "primary"
  | "reopen"
  | "reopen-sample"
  | "faults"
  | "termination-seed"
  | "termination-verify";

type JsonRecord = Record<string, unknown>;

interface FontFixtureDescriptor {
  readonly id: "cjk-medium" | "largest-ttc";
  readonly class: "cjk-5-30-mib" | "largest-ttc-under-128-mib";
  readonly url: string;
  readonly sourcePath: string;
  readonly fileName: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly contentHash: `sha256:${string}`;
  readonly format: "ttf" | "otf" | "ttc" | "woff" | "woff2";
  readonly mimeType: string;
  readonly licenseCaveat: string;
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
  oo1: { DB: new (filename: string, flags?: string) => StudioSqliteDatabaseHandleLike };
  installOpfsSAHPoolVfs(options: {
    directory?: string;
    name?: string;
  }): Promise<StudioSqlitePoolUtilHandleLike>;
}

interface ConstructorReceipt {
  readonly api: StudioSqliteApiHandleLike;
  readonly installedOpfsDirectories: string[];
  readonly openedOpfsDatabaseFilenames: string[];
  readonly openedMemoryDatabaseFilenames: string[];
}

interface FileSystemEntryLike {
  readonly kind: "directory" | "file";
  readonly name: string;
}

interface FileSystemFileLike extends FileSystemEntryLike {
  readonly kind: "file";
  getFile(): Promise<File>;
}

interface FileSystemWritableLike {
  write(data: ArrayBuffer): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemFileHandleLike extends FileSystemEntryLike {
  readonly kind: "file";
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableLike>;
}

interface FileSystemDirectoryLike extends FileSystemEntryLike {
  readonly kind: "directory";
  entries(): AsyncIterableIterator<[string, FileSystemEntryLike]>;
  getDirectoryHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<FileSystemDirectoryLike>;
  getFileHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<FileSystemFileHandleLike>;
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

const fallbackProbe = {
  indexedDbAccessCount: 0,
  localStorageAccessCount: 0,
  indexedDbProbeInstalled: false,
  localStorageProbeInstalled: false,
  indexedDbOriginallyPresent: "indexedDB" in globalThis,
  localStorageOriginallyPresent: "localStorage" in globalThis,
};

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
    const code = "code" in error ? String((error as Error & { code?: unknown }).code) : null;
    return {
      name: error.name,
      message: error.message,
      code,
      stack: error.stack ?? null,
      cause: error.cause instanceof Error
        ? { name: error.cause.name, message: error.cause.message }
        : error.cause === undefined ? null : String(error.cause),
    };
  }
  return { name: "NonError", message: String(error), code: null, stack: null, cause: null };
}

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
        throw new DOMException("custom-font benchmark forbids localStorage fallback", "SecurityError");
      },
    });
    fallbackProbe.localStorageProbeInstalled = true;
  } catch {
    fallbackProbe.localStorageProbeInstalled = false;
  }
}

installFallbackProbes();

function publish(
  type: "phase-result" | "termination-ready",
  value: unknown,
  fontPayloads: readonly Readonly<{
    family: string;
    fileName: string;
    format: string;
    bytes: ArrayBuffer;
  }>[] = [],
): void {
  const transfer = fontPayloads.map(({ bytes }) => bytes);
  globalThis.postMessage({ type, value, fontPayloads }, { transfer });
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const source = bytes.byteOffset === 0
    && bytes.byteLength === bytes.buffer.byteLength
    && bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer
    : Uint8Array.from(bytes).buffer;
  const digest = await crypto.subtle.digest("SHA-256", source);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function equalContentReceipt(
  actual: { readonly contentHash: string; readonly byteLength: number },
  fixture: FontFixtureDescriptor,
): boolean {
  return actual.contentHash === fixture.contentHash && actual.byteLength === fixture.byteLength;
}

async function fetchFixture(fixture: FontFixtureDescriptor): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(fixture.url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`font fixture fetch failed (${response.status}): ${fixture.url}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = await sha256Bytes(bytes);
  if (bytes.byteLength !== fixture.byteLength || digest !== fixture.sha256) {
    throw new Error(
      `font fixture receipt mismatch for ${fixture.id}: ${bytes.byteLength}/${digest}`,
    );
  }
  return bytes;
}

function trackedSqliteApi(sqliteApi: StudioSqliteApiHandleLike): ConstructorReceipt {
  const installedOpfsDirectories: string[] = [];
  const openedOpfsDatabaseFilenames: string[] = [];
  const openedMemoryDatabaseFilenames: string[] = [];
  const MemoryDb = new Proxy(sqliteApi.oo1.DB, {
    construct(target, args, newTarget) {
      openedMemoryDatabaseFilenames.push(String(args[0]));
      return Reflect.construct(target, args, newTarget) as StudioSqliteDatabaseHandleLike;
    },
  });
  const api: StudioSqliteApiHandleLike = {
    oo1: { DB: MemoryDb },
    async installOpfsSAHPoolVfs(options): Promise<StudioSqlitePoolUtilHandleLike> {
      installedOpfsDirectories.push(options.directory ?? "");
      const pool = await sqliteApi.installOpfsSAHPoolVfs(options);
      const OpfsDb = new Proxy(pool.OpfsSAHPoolDb, {
        construct(target, args, newTarget) {
          openedOpfsDatabaseFilenames.push(String(args[0]));
          return Reflect.construct(target, args, newTarget) as StudioSqliteDatabaseHandleLike;
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

async function loadProductModules() {
  const [
    localDatabase,
    localDatabaseRuntime,
    customFontRepository,
    customFonts,
    assetRepository,
  ] = await Promise.all([
    import("../../../apps/web/src/domains/creator/studio-local-database"),
    import("../../../apps/web/src/domains/creator/studio-local-database-runtime"),
    import("../../../apps/web/src/domains/creator/studio-custom-font-sqlite-opfs-repository"),
    import("../../../apps/web/src/domains/creator/studio-custom-fonts"),
    import("../../../apps/web/src/domains/creator/studio-asset-library-sqlite-opfs-repository"),
  ]);
  return {
    localDatabase,
    localDatabaseRuntime,
    customFontRepository,
    customFonts,
    assetRepository,
  };
}

async function openProduct() {
  const modules = await loadProductModules();
  const sqliteStartedAt = performance.now();
  const sqliteModule = await import("@sqlite.org/sqlite-wasm");
  const baseApi = await sqliteModule.default() as unknown as StudioSqliteApiHandleLike;
  const sqliteWasmInitMs = performance.now() - sqliteStartedAt;
  const tracked = trackedSqliteApi(baseApi);
  const support = await modules.localDatabase.probeSqliteSupport({
    loadSqlite: () => Promise.resolve(tracked.api),
  });
  if (!support.wasm || !support.opfs) {
    throw new modules.localDatabase.SqliteUnavailableError(
      support.reason ?? "SQLite wasm or OPFS SAH-pool is unavailable",
    );
  }
  const openStartedAt = performance.now();
  const database = await modules.localDatabaseRuntime.acquireStudioLocalDatabase(() =>
    modules.localDatabase.openStudioLocalDatabase({
      vfs: "opfs",
      loadSqlite: () => Promise.resolve(tracked.api),
    }));
  const openMs = performance.now() - openStartedAt;
  const repository = modules.customFontRepository.createStudioCustomFontSqliteOpfsRepository();
  const store = await modules.assetRepository.acquireProductStudioAssetCasStore();
  return {
    ...modules,
    database,
    repository,
    store,
    support,
    tracked,
    sqliteWasmInitMs,
    openMs,
  };
}

function capabilities(): JsonRecord {
  return {
    dedicatedWorker: typeof WorkerGlobalScope !== "undefined"
      && globalThis instanceof WorkerGlobalScope,
    secureContext: globalThis.isSecureContext,
    crossOriginIsolated: globalThis.crossOriginIsolated,
    navigatorStorageGetDirectory: typeof navigator.storage?.getDirectory === "function",
    syncAccessHandle:
      typeof globalThis.FileSystemFileHandle?.prototype?.createSyncAccessHandle === "function",
    cryptoSubtle: typeof crypto.subtle?.digest === "function",
    webLocks: typeof navigator.locks?.request === "function",
  };
}

async function captureMemory(): Promise<JsonRecord> {
  const measured = performance as BrowserMemoryPerformance;
  const performanceMemory = measured.memory
    ? {
        jsHeapSizeLimitBytes: measured.memory.jsHeapSizeLimit ?? null,
        totalJSHeapSizeBytes: measured.memory.totalJSHeapSize ?? null,
        usedJSHeapSizeBytes: measured.memory.usedJSHeapSize ?? null,
      }
    : null;
  const specific = measured.measureUserAgentSpecificMemory;
  if (typeof specific !== "function") {
    return {
      performanceMemory,
      performanceMemoryUnavailableReason: performanceMemory === null
        ? "performance.memory is not exposed in this Dedicated Worker"
        : null,
      userAgentSpecificMemory: null,
      userAgentSpecificMemoryUnavailableReason:
        "performance.measureUserAgentSpecificMemory is not exposed in this Dedicated Worker",
    };
  }
  try {
    const result = await specific.call(measured);
    return {
      performanceMemory,
      performanceMemoryUnavailableReason: performanceMemory === null
        ? "performance.memory is not exposed in this Dedicated Worker"
        : null,
      userAgentSpecificMemory: {
        bytes: typeof result.bytes === "number" ? result.bytes : null,
        breakdownCount: Array.isArray(result.breakdown) ? result.breakdown.length : null,
      },
      userAgentSpecificMemoryUnavailableReason: null,
    };
  } catch (error) {
    return {
      performanceMemory,
      performanceMemoryUnavailableReason: performanceMemory === null
        ? "performance.memory is not exposed in this Dedicated Worker"
        : null,
      userAgentSpecificMemory: null,
      userAgentSpecificMemoryUnavailableReason: error instanceof Error
        ? error.message
        : String(error),
    };
  }
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
      rows.push({
        path,
        kind: "file",
        sizeBytes: (await (entry as FileSystemFileLike).getFile()).size,
      });
    } else {
      rows.push({ path, kind: "directory", sizeBytes: null });
      rows.push(...await walkDirectory(entry as FileSystemDirectoryLike, path));
    }
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

async function inspectOpfsRoot(name: string): Promise<JsonRecord> {
  try {
    const root = await navigator.storage.getDirectory() as unknown as FileSystemDirectoryLike;
    const directory = await root.getDirectoryHandle(name);
    const entries = await walkDirectory(directory);
    return {
      root: name,
      exists: true,
      entries,
      fileCount: entries.filter(({ kind }) => kind === "file").length,
      totalFileBytes: entries.reduce(
        (sum, entry) => sum + (entry.kind === "file" ? entry.sizeBytes ?? 0 : 0),
        0,
      ),
    };
  } catch (error) {
    return { root: name, exists: false, entries: [], fileCount: 0, totalFileBytes: 0, error: errorShape(error) };
  }
}

function fallbackReceipt(tracked: ConstructorReceipt, storeKind: string): JsonRecord {
  const memoryDatabaseOpenCount = tracked.openedMemoryDatabaseFilenames.length;
  const memoryAssetStoreCount = storeKind === "memory" ? 1 : 0;
  return {
    indexedDbAccessCount: fallbackProbe.indexedDbAccessCount,
    localStorageAccessCount: fallbackProbe.localStorageAccessCount,
    memoryDatabaseOpenCount,
    memoryAssetStoreCount,
    indexedDbProbeInstalled: fallbackProbe.indexedDbProbeInstalled,
    localStorageProbeInstalled: fallbackProbe.localStorageProbeInstalled,
    indexedDbOriginallyPresent: fallbackProbe.indexedDbOriginallyPresent,
    localStorageOriginallyPresent: fallbackProbe.localStorageOriginallyPresent,
    totalFallbackCount:
      fallbackProbe.indexedDbAccessCount
      + fallbackProbe.localStorageAccessCount
      + memoryDatabaseOpenCount
      + memoryAssetStoreCount,
  };
}

async function verifyListedFont(
  fonts: readonly Readonly<{
    id: string;
    contentHash: string;
    byteLength: number;
    verifiedBytes: Uint8Array;
  }>[],
  id: string,
  fixture: FontFixtureDescriptor,
  explicitDigest = false,
): Promise<{ readonly exact: boolean; readonly digest: string | null }> {
  const font = fonts.find((candidate) => candidate.id === id);
  if (!font || !equalContentReceipt(font, fixture)
    || font.verifiedBytes.byteLength !== fixture.byteLength) {
    return { exact: false, digest: null };
  }
  const digest = explicitDigest ? await sha256Bytes(font.verifiedBytes) : null;
  return { exact: !explicitDigest || digest === fixture.sha256, digest };
}

async function benchmarkFixture(
  fixture: FontFixtureDescriptor,
  bytes: Uint8Array,
  baselineId: string,
  product: Awaited<ReturnType<typeof openProduct>>,
): Promise<JsonRecord> {
  const { repository, customFonts } = product;
  if (customFonts.sniffStudioFontFormat(bytes) !== fixture.format) {
    throw new Error(`product font sniffer disagrees with ${fixture.format} for ${fixture.id}`);
  }
  const coldSaveStartedAt = performance.now();
  const baseline = await repository.save({
    id: baselineId,
    fileName: fixture.fileName,
    bytes,
    contentHash: fixture.contentHash,
  });
  const coldSaveMs = performance.now() - coldSaveStartedAt;
  if (!equalContentReceipt(baseline, fixture)
    || await sha256Bytes(baseline.verifiedBytes) !== fixture.sha256) {
    throw new Error(`${fixture.id} baseline save changed bytes or SHA-256`);
  }

  const saveSamples: number[] = [];
  let saveMismatchCount = 0;
  for (let index = 0; index < OPERATION_SAMPLES; index += 1) {
    const id = `${fixture.id}-warm-${String(index).padStart(2, "0")}`;
    const startedAt = performance.now();
    const saved = await repository.save({
      id,
      fileName: fixture.fileName,
      bytes,
      contentHash: fixture.contentHash,
    });
    saveSamples.push(performance.now() - startedAt);
    if (!equalContentReceipt(saved, fixture)
      || saved.verifiedBytes.byteLength !== fixture.byteLength) {
      saveMismatchCount += 1;
    }
    await repository.delete(id);
  }

  const loadSamples: number[] = [];
  let loadMismatchCount = 0;
  for (let index = 0; index < OPERATION_SAMPLES; index += 1) {
    const startedAt = performance.now();
    const listed = await repository.list();
    loadSamples.push(performance.now() - startedAt);
    const verified = await verifyListedFont(listed, baselineId, fixture);
    if (listed.length !== 1 || !verified.exact) loadMismatchCount += 1;
  }
  const finalList = await repository.list();
  const explicit = await verifyListedFont(finalList, baselineId, fixture, true);
  return {
    fixture,
    baselineId,
    family: baseline.family,
    coldSaveMs: fixed(coldSaveMs),
    saveCycles: OPERATION_SAMPLES,
    loadCycles: OPERATION_SAMPLES,
    saveMismatchCount,
    loadMismatchCount,
    saveDistribution: distribution(saveSamples),
    loadDistribution: distribution(loadSamples),
    finalByteLength: baseline.byteLength,
    finalContentHash: baseline.contentHash,
    finalExplicitSha256: explicit.digest,
    exactAfterEveryRepositoryVerifiedLoad: loadMismatchCount === 0,
    exactExplicitShaAfterLoads: explicit.exact,
    repositoryInternalVerifySha256: true,
  };
}

async function runPrimary(): Promise<void> {
  const securityPolicyViolations: JsonRecord[] = [];
  globalThis.addEventListener("securitypolicyviolation", (event) => {
    const violation = event as SecurityPolicyViolationEvent;
    securityPolicyViolations.push({
      effectiveDirective: violation.effectiveDirective,
      blockedUri: violation.blockedURI,
      disposition: violation.disposition,
    });
  });
  const memoryBefore = await captureMemory();
  const fixtures = __CUSTOM_FONT_BENCHMARK_FIXTURES__;
  const medium = fixtures.find(({ id }) => id === "cjk-medium");
  const largest = fixtures.find(({ id }) => id === "largest-ttc");
  if (!medium || !largest) throw new Error("both custom-font benchmark fixture classes are required");
  const product = await openProduct();
  let closeCompleted = false;
  try {
    const initial = await product.repository.list();
    if (initial.length !== 0) throw new Error("benchmark browser context was not storage-clean");
    const mediumBytes = await fetchFixture(medium);
    const mediumEvidence = await benchmarkFixture(
      medium,
      mediumBytes,
      "cjk-medium-baseline",
      product,
    );
    await product.repository.delete("cjk-medium-baseline");

    const largestBytes = await fetchFixture(largest);
    const largestEvidence = await benchmarkFixture(
      largest,
      largestBytes,
      "largest-ttc-baseline",
      product,
    );

    const restoredMedium = await product.repository.save({
      id: "cjk-medium-baseline",
      fileName: medium.fileName,
      bytes: mediumBytes,
      contentHash: medium.contentHash,
    });
    const finalFonts = await product.repository.list();
    const mediumFinal = await verifyListedFont(
      finalFonts,
      "cjk-medium-baseline",
      medium,
      true,
    );
    const largestFinal = await verifyListedFont(
      finalFonts,
      "largest-ttc-baseline",
      largest,
      true,
    );
    const manifestRaw = await product.database.kvGet(
      product.customFontRepository.STUDIO_CUSTOM_FONT_SQLITE_NAMESPACE,
      product.customFontRepository.STUDIO_CUSTOM_FONT_SQLITE_MANIFEST_KEY,
    );
    const parsedManifest = product.customFontRepository.parseStudioCustomFontManifest(manifestRaw);
    const ownerRefs = await product.store.ownerRefs(
      product.customFontRepository.STUDIO_CUSTOM_FONT_CAS_OWNER,
    );
    const casEntries = await product.store.list();
    const sqliteOpfs = await inspectOpfsRoot(product.localDatabase.STUDIO_SQLITE_OPFS_DIRECTORY);
    const casOpfs = await inspectOpfsRoot(
      product.assetRepository.STUDIO_ASSET_LIBRARY_CAS_ROOT,
    );
    const storageEstimate = await navigator.storage.estimate();
    const memoryAfter = await captureMemory();
    const fallback = fallbackReceipt(product.tracked, product.store.kind);
    const manifestContainsBinaryEncoding = /(?:data:|base64|verifiedBytes|Uint8Array)/iu
      .test(manifestRaw ?? "");
    const pass =
      mediumFinal.exact
      && largestFinal.exact
      && finalFonts.length === 2
      && restoredMedium.contentHash === medium.contentHash
      && parsedManifest.entries.length === 2
      && parsedManifest.totalBytes === medium.byteLength + largest.byteLength
      && ownerRefs.length === 2
      && casEntries.length === 2
      && !manifestContainsBinaryEncoding
      && Number(fallback.totalFallbackCount) === 0
      && product.store.kind === "opfs"
      && securityPolicyViolations.length === 0;
    await product.localDatabaseRuntime.closeStudioLocalDatabaseRuntime();
    closeCompleted = true;
    publish("phase-result", {
      phase: "primary",
      status: pass ? "ok" : "error",
      pass,
      schemaVersion: REPORT_SCHEMA_VERSION,
      execution:
        "vite-production-build-chromium-module-dedicated-worker-real-sqlite-opfs-sahpool-product-cas",
      authority: {
        repository: "StudioCustomFontSqliteOpfsRepository",
        repositoryFactory: "createStudioCustomFontSqliteOpfsRepository-no-options",
        repositoryAuthority: product.repository.authority,
        runtimeAcquire: "acquireStudioLocalDatabase",
        requestedVfs: "opfs",
        sqliteOpfsDirectory: product.localDatabase.STUDIO_SQLITE_OPFS_DIRECTORY,
        sqliteDatabaseFilename: product.localDatabase.STUDIO_SQLITE_DATABASE_FILENAME,
        expectedOpenFilename: `/${product.localDatabase.STUDIO_SQLITE_DATABASE_FILENAME}`,
        openedOpfsDatabaseFilenames: product.tracked.openedOpfsDatabaseFilenames,
        installedOpfsDirectories: product.tracked.installedOpfsDirectories,
        openedMemoryDatabaseFilenames: product.tracked.openedMemoryDatabaseFilenames,
        casOpfsRoot: product.assetRepository.STUDIO_ASSET_LIBRARY_CAS_ROOT,
        casKind: product.store.kind,
        namespace: product.customFontRepository.STUDIO_CUSTOM_FONT_SQLITE_NAMESPACE,
        manifestKey: product.customFontRepository.STUDIO_CUSTOM_FONT_SQLITE_MANIFEST_KEY,
        owner: product.customFontRepository.STUDIO_CUSTOM_FONT_CAS_OWNER,
        webLockName: product.customFontRepository.STUDIO_CUSTOM_FONT_LOCK_NAME,
        normalCloseCompleted: true,
      },
      support: product.support,
      capabilities: capabilities(),
      browser: {
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        graphicsAdapter: null,
        graphicsAdapterReason: "No WebGPU rendering is used by this storage/FontFace benchmark",
      },
      opening: {
        sqliteWasmInitMs: fixed(product.sqliteWasmInitMs),
        coldOpenMs: fixed(product.openMs),
      },
      classes: {
        medium: mediumEvidence,
        largestTtc: largestEvidence,
      },
      finalLibrary: {
        count: finalFonts.length,
        totalBytes: parsedManifest.totalBytes,
        mediumExact: mediumFinal.exact,
        largestTtcExact: largestFinal.exact,
        mediumExplicitSha256: mediumFinal.digest,
        largestTtcExplicitSha256: largestFinal.digest,
        manifestBytes: new TextEncoder().encode(manifestRaw ?? "").byteLength,
        manifestCanonical: manifestRaw === JSON.stringify(parsedManifest),
        manifestContainsBinaryEncoding,
        ownerRefs,
        casEntries: casEntries.map(({ hash, bytes, storedBytes, codec, mime, path }) => ({
          hash,
          bytes,
          storedBytes,
          codec,
          mime,
          path,
        })),
      },
      operationCounts: {
        baselineSaves: 3,
        measuredSaves: OPERATION_SAMPLES * 2,
        measuredLoads: OPERATION_SAMPLES * 2,
        measuredDeletes: OPERATION_SAMPLES * 2 + 1,
      },
      fallback,
      memory: { before: memoryBefore, after: memoryAfter },
      storage: {
        usageBytes: storageEstimate.usage ?? null,
        quotaBytes: storageEstimate.quota ?? null,
      },
      opfs: { sqlite: sqliteOpfs, cas: casOpfs },
      securityPolicyViolations,
    });
  } finally {
    if (!closeCompleted) {
      await product.localDatabaseRuntime.closeStudioLocalDatabaseRuntime().catch(() => undefined);
    }
  }
}

async function runReopen(transferFontPayloads: boolean): Promise<void> {
  const memoryBefore = await captureMemory();
  const product = await openProduct();
  try {
    const listStartedAt = performance.now();
    const fonts = await product.repository.list();
    const listMs = performance.now() - listStartedAt;
    const receipts: JsonRecord[] = [];
    const payloads: Array<{
      family: string;
      fileName: string;
      format: string;
      bytes: ArrayBuffer;
    }> = [];
    for (const fixture of __CUSTOM_FONT_BENCHMARK_FIXTURES__) {
      const id = fixture.id === "cjk-medium" ? "cjk-medium-baseline" : "largest-ttc-baseline";
      const font = fonts.find((candidate) => candidate.id === id);
      const digest = font ? await sha256Bytes(font.verifiedBytes) : null;
      receipts.push({
        id,
        fixtureId: fixture.id,
        family: font?.family ?? null,
        byteLength: font?.byteLength ?? null,
        contentHash: font?.contentHash ?? null,
        explicitSha256: digest,
        exact:
          font !== undefined
          && font.byteLength === fixture.byteLength
          && font.contentHash === fixture.contentHash
          && digest === fixture.sha256,
      });
      if (font && transferFontPayloads) {
        payloads.push({
          family: font.family,
          fileName: font.fileName,
          format: font.format,
          bytes: Uint8Array.from(font.verifiedBytes).buffer,
        });
      }
    }
    const fallback = fallbackReceipt(product.tracked, product.store.kind);
    const memoryAfter = await captureMemory();
    const pass = fonts.length === 2
      && receipts.every(({ exact }) => exact === true)
      && (!transferFontPayloads || payloads.length === 2)
      && Number(fallback.totalFallbackCount) === 0;
    await product.localDatabaseRuntime.closeStudioLocalDatabaseRuntime();
    publish("phase-result", {
      phase: "reopen",
      status: pass ? "ok" : "error",
      pass,
      normalCloseReopenInFreshWorker: true,
      reopenDatabaseMs: fixed(product.openMs),
      verifiedListMs: fixed(listMs),
      recoveryLatencyMs: fixed(product.openMs + listMs),
      receipts,
      authority: {
        openedOpfsDatabaseFilenames: product.tracked.openedOpfsDatabaseFilenames,
        openedMemoryDatabaseFilenames: product.tracked.openedMemoryDatabaseFilenames,
        casKind: product.store.kind,
      },
      fallback,
      memory: { before: memoryBefore, after: memoryAfter },
      fontPayloadsTransferred: transferFontPayloads ? payloads.length : 0,
      closeCompleted: true,
    }, transferFontPayloads ? payloads : []);
  } finally {
    await product.localDatabaseRuntime.closeStudioLocalDatabaseRuntime().catch(() => undefined);
  }
}

async function expectCorrupt(task: () => Promise<unknown>): Promise<JsonRecord> {
  try {
    await task();
    return { pass: false, error: null, returnedPartialList: true };
  } catch (error) {
    const shaped = errorShape(error);
    return {
      pass: shaped.code === "corrupt",
      error: shaped,
      returnedPartialList: false,
    };
  }
}

async function writePhysicalCasPath(
  rootName: string,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const root = await navigator.storage.getDirectory() as unknown as FileSystemDirectoryLike;
  let directory = await root.getDirectoryHandle(rootName);
  const segments = path.split("/");
  const fileName = segments.pop();
  if (!fileName) throw new Error(`invalid CAS path: ${path}`);
  for (const segment of segments) directory = await directory.getDirectoryHandle(segment);
  const handle = await directory.getFileHandle(fileName);
  const writable = await handle.createWritable();
  await writable.write(Uint8Array.from(bytes).buffer);
  await writable.close();
}

async function runFaults(): Promise<void> {
  const medium = __CUSTOM_FONT_BENCHMARK_FIXTURES__.find(({ id }) => id === "cjk-medium");
  if (!medium) throw new Error("medium CJK font fixture is required for fault injection");
  const mediumBytes = await fetchFixture(medium);
  const product = await openProduct();
  try {
    const baseline = (await product.repository.list()).find(
      ({ id }) => id === "cjk-medium-baseline",
    );
    if (!baseline) throw new Error("medium CJK baseline is absent before fault injection");
    const hash = baseline.contentHash;
    const mime = medium.mimeType;

    const missingDeleted = await product.store.delete(hash);
    const missing = await expectCorrupt(() => product.repository.list());
    const missingRestore = await product.store.put(mediumBytes, { mime, codec: "identity" });
    const afterMissing = await product.repository.list();

    const stat = await product.store.stat(hash);
    if (!stat) throw new Error("restored CAS stat is absent before corruption test");
    const corrupted = Uint8Array.from(mediumBytes);
    corrupted[corrupted.length - 1] = (corrupted.at(-1) ?? 0) ^ 0xff;
    await writePhysicalCasPath(
      product.assetRepository.STUDIO_ASSET_LIBRARY_CAS_ROOT,
      stat.path,
      corrupted,
    );
    const corrupt = await expectCorrupt(() => product.repository.list());
    const corruptDeleted = await product.store.delete(hash);
    const corruptRestore = await product.store.put(mediumBytes, { mime, codec: "identity" });
    const afterCorrupt = await product.repository.list();

    const namespace = product.customFontRepository.STUDIO_CUSTOM_FONT_SQLITE_NAMESPACE;
    const manifestKey = product.customFontRepository.STUDIO_CUSTOM_FONT_SQLITE_MANIFEST_KEY;
    const originalManifest = await product.database.kvGet(namespace, manifestKey);
    if (!originalManifest) throw new Error("font manifest is absent before metadata fault");
    const tampered = JSON.parse(originalManifest) as {
      totalBytes: number;
      entries: Array<{ id: string; byteLength: number }>;
    };
    const target = tampered.entries.find(({ id }) => id === "cjk-medium-baseline");
    if (!target) throw new Error("medium manifest entry is absent before metadata fault");
    target.byteLength += 1;
    tampered.totalBytes += 1;
    await product.database.kvSet(namespace, manifestKey, JSON.stringify(tampered));
    const metadataMismatch = await expectCorrupt(() => product.repository.list());
    await product.database.kvSet(namespace, manifestKey, originalManifest);
    const afterMetadata = await product.repository.list();

    const recoveredMissing = await verifyListedFont(
      afterMissing,
      "cjk-medium-baseline",
      medium,
      true,
    );
    const recoveredCorrupt = await verifyListedFont(
      afterCorrupt,
      "cjk-medium-baseline",
      medium,
      true,
    );
    const recoveredMetadata = await verifyListedFont(
      afterMetadata,
      "cjk-medium-baseline",
      medium,
      true,
    );
    const fallback = fallbackReceipt(product.tracked, product.store.kind);
    const pass =
      missingDeleted
      && missing.pass === true
      && missingRestore.ref.hash === medium.contentHash
      && recoveredMissing.exact
      && corrupt.pass === true
      && corruptDeleted
      && corruptRestore.ref.hash === medium.contentHash
      && recoveredCorrupt.exact
      && metadataMismatch.pass === true
      && recoveredMetadata.exact
      && Number(fallback.totalFallbackCount) === 0;
    await product.localDatabaseRuntime.closeStudioLocalDatabaseRuntime();
    publish("phase-result", {
      phase: "faults",
      status: pass ? "ok" : "error",
      pass,
      missingCasObject: {
        deleted: missingDeleted,
        failClosed: missing,
        restoredHash: missingRestore.ref.hash,
        recoveryExact: recoveredMissing.exact,
      },
      corruptCasObject: {
        mutation: "same-length-final-byte-xor-ff-on-physical-opfs-blob",
        failClosed: corrupt,
        deletedBeforeRestore: corruptDeleted,
        restoredHash: corruptRestore.ref.hash,
        recoveryExact: recoveredCorrupt.exact,
      },
      metadataMismatch: {
        mutation: "canonical-manifest-byteLength-and-totalBytes-plus-one",
        failClosed: metadataMismatch,
        originalManifestRestored: true,
        recoveryExact: recoveredMetadata.exact,
      },
      partialListsReturned: 0,
      silentFallbacks: 0,
      fallback,
      closeCompleted: true,
    });
  } finally {
    await product.localDatabaseRuntime.closeStudioLocalDatabaseRuntime().catch(() => undefined);
  }
}

async function runTerminationSeed(): Promise<void> {
  const medium = __CUSTOM_FONT_BENCHMARK_FIXTURES__.find(({ id }) => id === "cjk-medium");
  if (!medium) throw new Error("medium CJK fixture is required for termination seed");
  const bytes = await fetchFixture(medium);
  const product = await openProduct();
  const saveStartedAt = performance.now();
  const saved = await product.repository.save({
    id: TERMINATION_FONT_ID,
    fileName: medium.fileName,
    bytes,
    contentHash: medium.contentHash,
  });
  const committedSaveMs = performance.now() - saveStartedAt;
  const manifest = await product.database.kvGet(
    product.customFontRepository.STUDIO_CUSTOM_FONT_SQLITE_NAMESPACE,
    product.customFontRepository.STUDIO_CUSTOM_FONT_SQLITE_MANIFEST_KEY,
  );
  const manifestCommitted = manifest?.includes(`"id":"${TERMINATION_FONT_ID}"`) === true;
  const pass = manifestCommitted
    && equalContentReceipt(saved, medium)
    && await sha256Bytes(saved.verifiedBytes) === medium.sha256
    && product.tracked.openedMemoryDatabaseFilenames.length === 0
    && product.store.kind === "opfs";
  publish("termination-ready", {
    phase: "termination-seed",
    status: pass ? "ready" : "error",
    pass,
    committedSaveMs: fixed(committedSaveMs),
    manifestCommitted,
    id: TERMINATION_FONT_ID,
    byteLength: saved.byteLength,
    contentHash: saved.contentHash,
    databaseIntentionallyLeftOpen: true,
    closeCalledBeforeReceipt: false,
    fallback: fallbackReceipt(product.tracked, product.store.kind),
  });
  // The page synchronously calls Worker.terminate() on this committed receipt. No close follows.
}

async function runTerminationVerify(): Promise<void> {
  const medium = __CUSTOM_FONT_BENCHMARK_FIXTURES__.find(({ id }) => id === "cjk-medium");
  if (!medium) throw new Error("medium CJK fixture is required for termination verification");
  const startedAt = performance.now();
  const product = await openProduct();
  const openMs = performance.now() - startedAt;
  try {
    const listStartedAt = performance.now();
    const fonts = await product.repository.list();
    const listMs = performance.now() - listStartedAt;
    const verified = await verifyListedFont(fonts, TERMINATION_FONT_ID, medium, true);
    const fallback = fallbackReceipt(product.tracked, product.store.kind);
    const pass = verified.exact && Number(fallback.totalFallbackCount) === 0;
    await product.localDatabaseRuntime.closeStudioLocalDatabaseRuntime();
    publish("phase-result", {
      phase: "termination-verify",
      status: pass ? "ok" : "error",
      pass,
      id: TERMINATION_FONT_ID,
      exactHashAndBytes: verified.exact,
      explicitSha256: verified.digest,
      reopenDatabaseMs: fixed(product.openMs),
      totalOpenFunctionMs: fixed(openMs),
      verifiedListMs: fixed(listMs),
      recoveryLatencyMs: fixed(product.openMs + listMs),
      fallback,
      closeCalledAfterVerification: true,
    });
  } finally {
    await product.localDatabaseRuntime.closeStudioLocalDatabaseRuntime().catch(() => undefined);
  }
}

globalThis.addEventListener("message", (event: MessageEvent<{ command?: WorkerCommand }>) => {
  const command = event.data?.command;
  const operation = command === "primary"
    ? runPrimary()
    : command === "reopen"
      ? runReopen(true)
      : command === "reopen-sample"
        ? runReopen(false)
      : command === "faults"
        ? runFaults()
        : command === "termination-seed"
          ? runTerminationSeed()
          : command === "termination-verify"
            ? runTerminationVerify()
            : Promise.reject(new Error(`unknown custom-font benchmark command: ${String(command)}`));
  void operation.catch((error) => {
    publish("phase-result", {
      phase: command ?? "unknown",
      status: "error",
      pass: false,
      error: errorShape(error),
    });
  });
});
