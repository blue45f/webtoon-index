/**
 * Dedicated Worker side of the real Chromium SQLite OPFS animatic benchmark.
 *
 * Only the product V12 database and product animatic persistence are used. There is no memory
 * VFS or localStorage fallback. Constructor tracking proves both database opens target exactly
 * `/studio-local-v12.db`.
 */

import {
  createStudioAnimaticSqlitePersistence,
  STUDIO_ANIMATIC_SQLITE_NAMESPACE,
} from "../../../apps/web/src/domains/creator/studio-animatic-sqlite-persistence";
import {
  exportStudioAnimaticDocument,
  importStudioAnimaticDocument,
  STUDIO_ANIMATIC_KIND,
  STUDIO_ANIMATIC_MAX_CAMERA_KEYFRAMES,
  STUDIO_ANIMATIC_MAX_CUES_PER_SEGMENT,
  STUDIO_ANIMATIC_MAX_EXPORT_BYTES,
  STUDIO_ANIMATIC_MAX_SEGMENTS,
  STUDIO_ANIMATIC_VERSION,
  studioAnimaticStorageKey,
  type StudioAnimaticDocument,
  type StudioAnimaticSegment,
} from "../../../apps/web/src/domains/creator/studio-animatic-timeline";
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
const SAVE_SAMPLE_COUNT = 120;
const LOAD_SAMPLE_COUNT = 120;
const WORK_SCOPE = "v12-opfs-animatic-maximum-document";
const CORRUPTION_SCOPE = "v12-opfs-animatic-corruption-probe";

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

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function makeCameraKeyframes(): StudioAnimaticSegment["cameraKeyframes"] {
  return Array.from({ length: STUDIO_ANIMATIC_MAX_CAMERA_KEYFRAMES }, (_, index) => {
    const progress = index / (STUDIO_ANIMATIC_MAX_CAMERA_KEYFRAMES - 1);
    return {
      at: progress,
      panXPercent: -100 + (progress * 200),
      panYPercent: 100 - (progress * 200),
      zoom: 0.25 + (progress * 3.75),
      easing: index % 2 === 0 ? "linear" as const : "ease-in-out" as const,
    };
  });
}

function cueCountForSegment(totalCueCount: number, segmentIndex: number): number {
  const base = Math.floor(totalCueCount / STUDIO_ANIMATIC_MAX_SEGMENTS);
  const remainder = totalCueCount % STUDIO_ANIMATIC_MAX_SEGMENTS;
  return Math.min(
    STUDIO_ANIMATIC_MAX_CUES_PER_SEGMENT,
    base + Number(segmentIndex < remainder),
  );
}

function makeMaximumDocument(totalCueCount: number): StudioAnimaticDocument {
  const cameraKeyframes = makeCameraKeyframes();
  const segments: StudioAnimaticSegment[] = Array.from(
    { length: STUDIO_ANIMATIC_MAX_SEGMENTS },
    (_, segmentIndex) => {
      const segmentNumber = String(segmentIndex).padStart(3, "0");
      const cueCount = cueCountForSegment(totalCueCount, segmentIndex);
      return {
        id: `segment-${segmentNumber}`,
        pageId: `page-${segmentNumber}`,
        cutId: `cut-${segmentNumber}`,
        label: `애니매틱 구간 ${segmentNumber} 편집 0000`,
        holdMs: 250,
        transition: { kind: "cut", durationMs: 0 },
        cameraKeyframes,
        cues: Array.from({ length: cueCount }, (_, cueIndex) => {
          const cueNumber = String(cueIndex).padStart(2, "0");
          return {
            id: `cue-${segmentNumber}-${cueNumber}`,
            kind: cueIndex % 2 === 0 ? "dialogue" as const : "sfx" as const,
            offsetMs: (cueIndex * 7) % 251,
            text: `의미 보존 cue ${segmentNumber}-${cueNumber}`,
            ...(cueIndex % 2 === 0 ? { speaker: `화자-${cueNumber}` } : {}),
          };
        }),
        sourceRect: {
          x: (segmentIndex % 10) * 10,
          y: (segmentIndex % 20) * 10,
          width: 720,
          height: 1_200,
          stripY: segmentIndex * 500,
        },
      };
    },
  );
  return {
    kind: STUDIO_ANIMATIC_KIND,
    version: STUDIO_ANIMATIC_VERSION,
    workScope: WORK_SCOPE,
    fps: 30,
    previewMode: "vertical-scroll",
    loop: false,
    segments,
  };
}

function maximumExportableDocument(): {
  document: StudioAnimaticDocument;
  json: string;
  bytes: number;
  cueCount: number;
  nextCueRejected: boolean;
  nextCueError: string | null;
} {
  const absoluteCueCap = STUDIO_ANIMATIC_MAX_SEGMENTS * STUDIO_ANIMATIC_MAX_CUES_PER_SEGMENT;
  let low = 0;
  let high = absoluteCueCap;
  let bestCueCount = 0;
  let best = exportStudioAnimaticDocument(makeMaximumDocument(0));
  if (!best.ok) throw new Error(`zero-cue maximum document is invalid: ${best.error}`);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = exportStudioAnimaticDocument(makeMaximumDocument(middle));
    if (candidate.ok) {
      bestCueCount = middle;
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  const document = makeMaximumDocument(bestCueCount);
  const next = bestCueCount < absoluteCueCap
    ? exportStudioAnimaticDocument(makeMaximumDocument(bestCueCount + 1))
    : null;
  return {
    document,
    json: best.json,
    bytes: best.bytes,
    cueCount: bestCueCount,
    nextCueRejected: next === null || !next.ok,
    nextCueError: next && !next.ok ? next.error : null,
  };
}

function editDocument(
  document: StudioAnimaticDocument,
  editIndex: number,
): StudioAnimaticDocument {
  const first = document.segments[0];
  if (!first) throw new Error("maximum animatic document unexpectedly has no first segment");
  return {
    ...document,
    loop: editIndex % 2 === 0,
    previewMode: editIndex % 3 === 0 ? "cuts" : "vertical-scroll",
    segments: [
      {
        ...first,
        label: `애니매틱 구간 000 편집 ${String(editIndex).padStart(4, "0")}`,
      },
      ...document.segments.slice(1),
    ],
  };
}

async function storageEstimate(): Promise<JsonRecord> {
  const estimate = await navigator.storage.estimate();
  const withDetails = estimate as StorageEstimate & { usageDetails?: Record<string, number> };
  return {
    usageBytes: estimate.usage ?? null,
    quotaBytes: estimate.quota ?? null,
    usageDetails: withDetails.usageDetails ?? null,
  };
}

async function memorySnapshot(): Promise<JsonRecord> {
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
    unavailableIsNull: browserPerformance.memory === undefined && userAgentSpecific === null,
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

  const sqliteInitStartedAt = performance.now();
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
      authority: "unavailable",
      reason: support.reason ?? "sqlite-wasm or OPFS SAH-pool support is unavailable",
      support,
      capabilities,
      securityPolicyViolations,
    });
    return;
  }

  const maximum = maximumExportableDocument();
  const cameraKeyframeCount = maximum.document.segments.reduce(
    (sum, segment) => sum + segment.cameraKeyframes.length,
    0,
  );
  const expectedCameraKeyframeCount =
    STUDIO_ANIMATIC_MAX_SEGMENTS * STUDIO_ANIMATIC_MAX_CAMERA_KEYFRAMES;
  const sourceRoundTrip = importStudioAnimaticDocument(maximum.json);
  if (!sourceRoundTrip.ok) {
    throw new Error(`maximum document failed its own import gate: ${sourceRoundTrip.error}`);
  }

  const storageBefore = await storageEstimate();
  const memoryBefore = await memorySnapshot();
  const opfsBefore = await inspectProductOpfsDirectory();
  let database: StudioLocalDatabase | null = null;

  try {
    const coldOpenStartedAt = performance.now();
    database = await openStudioLocalDatabase({ vfs: "opfs", loadSqlite });
    const coldOpenMs = performance.now() - coldOpenStartedAt;
    let persistence = createStudioAnimaticSqlitePersistence({
      acquireDatabase: () => Promise.resolve(database!),
    });
    const initialLoad = await persistence.load(WORK_SCOPE);
    if (initialLoad.status !== "empty" || initialLoad.document !== null) {
      throw new Error("fresh Chromium profile unexpectedly contained animatic V12 data");
    }

    const saveSamples: number[] = [];
    const uniqueEditLabels = new Set<string>();
    let latestDocument = maximum.document;
    let latestCanonicalJson = maximum.json;
    let latestCanonicalBytes = maximum.bytes;
    for (let index = 0; index < SAVE_SAMPLE_COUNT; index += 1) {
      latestDocument = editDocument(maximum.document, index);
      const firstLabel = latestDocument.segments[0]?.label;
      if (!firstLabel) throw new Error(`edit ${index} lost the first segment label`);
      uniqueEditLabels.add(firstLabel);
      const exported = exportStudioAnimaticDocument(latestDocument);
      if (!exported.ok) throw new Error(`edit ${index} failed export: ${exported.error}`);
      latestCanonicalJson = exported.json;
      latestCanonicalBytes = exported.bytes;
      const saveStartedAt = performance.now();
      const saveResult = await persistence.save(latestDocument);
      saveSamples.push(performance.now() - saveStartedAt);
      if (!saveResult.ok) throw new Error(`edit ${index} failed save: ${saveResult.error}`);
    }
    const latestCanonicalDigest = await sha256(latestCanonicalJson);
    const latestRoundTrip = importStudioAnimaticDocument(latestCanonicalJson);
    if (!latestRoundTrip.ok) {
      throw new Error(`final sequential edit failed import: ${latestRoundTrip.error}`);
    }
    const rawBeforeClose = await database.kvGet(
      STUDIO_ANIMATIC_SQLITE_NAMESPACE,
      studioAnimaticStorageKey(WORK_SCOPE),
    );
    const rawBeforeCloseDigest = rawBeforeClose === null ? null : await sha256(rawBeforeClose);
    const rawBeforeCloseExact = rawBeforeClose === latestCanonicalJson;

    const storageAfterSave = await storageEstimate();
    const memoryAfterSave = await memorySnapshot();
    const opfsAfterSave = await inspectProductOpfsDirectory();
    await database.close();
    database = null;
    const closeCompletedBeforeReopen = true;

    const reopenStartedAt = performance.now();
    database = await openStudioLocalDatabase({ vfs: "opfs", loadSqlite });
    const reopenMs = performance.now() - reopenStartedAt;
    persistence = createStudioAnimaticSqlitePersistence({
      acquireDatabase: () => Promise.resolve(database!),
    });
    const reopened = await persistence.load(WORK_SCOPE);
    if (reopened.status !== "ok" || reopened.document === null) {
      throw new Error(`reopened animatic did not load: ${reopened.error ?? reopened.status}`);
    }
    const reopenedExport = exportStudioAnimaticDocument(reopened.document);
    if (!reopenedExport.ok) {
      throw new Error(`reopened animatic did not export: ${reopenedExport.error}`);
    }
    const reopenedDigest = await sha256(reopenedExport.json);
    const loadSamples: number[] = [];
    let loadMismatchCount = 0;
    for (let index = 0; index < LOAD_SAMPLE_COUNT; index += 1) {
      const loadStartedAt = performance.now();
      const loaded = await persistence.load(WORK_SCOPE);
      loadSamples.push(performance.now() - loadStartedAt);
      if (loaded.status !== "ok" || loaded.document === null) {
        loadMismatchCount += 1;
        continue;
      }
      const exported = exportStudioAnimaticDocument(loaded.document);
      if (!exported.ok || exported.json !== latestCanonicalJson) loadMismatchCount += 1;
    }

    await database.kvSet(
      STUDIO_ANIMATIC_SQLITE_NAMESPACE,
      studioAnimaticStorageKey(CORRUPTION_SCOPE),
      "{corrupt-json",
    );
    const corruptionLoad = await persistence.load(CORRUPTION_SCOPE);
    const mainAfterCorruption = await persistence.load(WORK_SCOPE);
    const mainAfterCorruptionExport = mainAfterCorruption.document
      ? exportStudioAnimaticDocument(mainAfterCorruption.document)
      : null;
    const corruptionFailClosed =
      corruptionLoad.status === "invalid"
      && corruptionLoad.document === null
      && typeof corruptionLoad.error === "string"
      && mainAfterCorruption.status === "ok"
      && mainAfterCorruptionExport?.ok === true
      && mainAfterCorruptionExport.json === latestCanonicalJson;

    const storageFinal = await storageEstimate();
    const memoryFinal = await memorySnapshot();
    const opfsFinal = await inspectProductOpfsDirectory();
    const expectedFilename = `/${STUDIO_SQLITE_DATABASE_FILENAME}`;
    const nonV12DatabaseOpenCount = tracked.openedOpfsDatabaseFilenames.filter(
      (filename) => filename !== expectedFilename,
    ).length;
    const allChecksPassed =
      maximum.document.segments.length === STUDIO_ANIMATIC_MAX_SEGMENTS
      && cameraKeyframeCount === expectedCameraKeyframeCount
      && maximum.nextCueRejected
      && maximum.bytes <= STUDIO_ANIMATIC_MAX_EXPORT_BYTES
      && latestCanonicalBytes <= STUDIO_ANIMATIC_MAX_EXPORT_BYTES
      && uniqueEditLabels.size === SAVE_SAMPLE_COUNT
      && rawBeforeCloseExact
      && rawBeforeCloseDigest === latestCanonicalDigest
      && reopenedExport.json === latestCanonicalJson
      && reopenedExport.bytes === latestCanonicalBytes
      && reopenedDigest === latestCanonicalDigest
      && loadMismatchCount === 0
      && corruptionFailClosed
      && tracked.openedOpfsDatabaseFilenames.length === 2
      && nonV12DatabaseOpenCount === 0
      && tracked.openedMemoryDatabaseFilenames.length === 0
      && tracked.installedOpfsDirectories.length === 2
      && tracked.installedOpfsDirectories.every(
        (directory) => directory === STUDIO_SQLITE_OPFS_DIRECTORY,
      )
      && capabilities.localStorageApiPresent === false
      && opfsFinal.exists === true
      && Number(opfsFinal.fileCount) > 0
      && Number(opfsFinal.totalFileBytes) > 0;

    publish({
      status: allChecksPassed ? "ok" : "error",
      pass: allChecksPassed,
      schemaVersion: REPORT_SCHEMA_VERSION,
      execution: "vite-production-build-chromium-dedicated-worker-opfs-sahpool",
      authority: {
        kind: "sqlite-opfs-sahpool",
        requestedVfs: "opfs",
        productOpenExpression: 'openStudioLocalDatabase({ vfs: "opfs", loadSqlite })',
        productionPersistence: "createStudioAnimaticSqlitePersistence",
        namespace: STUDIO_ANIMATIC_SQLITE_NAMESPACE,
        sqlitePackage: "@sqlite.org/sqlite-wasm 3.53.0-build1",
        opfsDirectory: STUDIO_SQLITE_OPFS_DIRECTORY,
        logicalDatabaseFilename: STUDIO_SQLITE_DATABASE_FILENAME,
        expectedOpenFilename: expectedFilename,
        openedOpfsDatabaseFilenames: tracked.openedOpfsDatabaseFilenames,
        installedOpfsDirectories: tracked.installedOpfsDirectories,
        opfsDatabaseOpenCount: tracked.openedOpfsDatabaseFilenames.length,
        nonV12DatabaseOpenCount,
        oldDatabaseFilenameOpenCount: tracked.openedOpfsDatabaseFilenames.filter(
          (filename) => filename === "/studio-local.db",
        ).length,
        memoryDatabaseOpenCount: tracked.openedMemoryDatabaseFilenames.length,
        memoryDatabaseOpenFilenames: tracked.openedMemoryDatabaseFilenames,
        memoryVfsUsed: false,
        localStorageApiPresent: capabilities.localStorageApiPresent,
        localStorageFallbackUsed: false,
        closeCompletedBeforeReopen,
      },
      policy: {
        legacyDataMigration: false,
        discardExistingStudioData: true,
        oldLocalStorageRead: false,
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
        workScope: WORK_SCOPE,
        corruptionScope: CORRUPTION_SCOPE,
        segmentCount: maximum.document.segments.length,
        segmentCap: STUDIO_ANIMATIC_MAX_SEGMENTS,
        cameraKeyframesPerSegment: STUDIO_ANIMATIC_MAX_CAMERA_KEYFRAMES,
        cameraKeyframeCount,
        cueCount: maximum.cueCount,
        cueAbsoluteCap: STUDIO_ANIMATIC_MAX_SEGMENTS * STUDIO_ANIMATIC_MAX_CUES_PER_SEGMENT,
        maximumPracticalCueSearch: "binary-search-next-cue-fails-export-or-text-gate",
        nextCueRejected: maximum.nextCueRejected,
        nextCueError: maximum.nextCueError,
        maximumSourceExportBytes: maximum.bytes,
        finalEditExportBytes: latestCanonicalBytes,
        exportByteCap: STUDIO_ANIMATIC_MAX_EXPORT_BYTES,
        saveSampleCount: SAVE_SAMPLE_COUNT,
        loadSampleCount: LOAD_SAMPLE_COUNT,
        uniqueSequentialEditCount: uniqueEditLabels.size,
      },
      opening: {
        sqliteWasmInitMs: fixed(sqliteWasmInitMs),
        coldOpenMs: fixed(coldOpenMs),
        reopenMs: fixed(reopenMs),
      },
      saves: {
        successfulCount: saveSamples.length,
        distribution: distribution(saveSamples),
      },
      loads: {
        successfulCount: loadSamples.length - loadMismatchCount,
        mismatchCount: loadMismatchCount,
        distribution: distribution(loadSamples),
      },
      semanticIntegrity: {
        productValidationPath:
          "createStudioAnimaticSqlitePersistence -> export/importStudioAnimaticDocument",
        initialLoadStatus: initialLoad.status,
        sourceImportValidated: sourceRoundTrip.ok,
        canonicalBytes: latestCanonicalBytes,
        canonicalDigestSha256: latestCanonicalDigest,
        persistedBeforeCloseBytes: rawBeforeClose === null ? null : utf8Bytes(rawBeforeClose),
        persistedBeforeCloseDigestSha256: rawBeforeCloseDigest,
        persistedBeforeCloseExact: rawBeforeCloseExact,
        reopenedBytes: reopenedExport.bytes,
        reopenedDigestSha256: reopenedDigest,
        reopenedCanonicalBytesExact: reopenedExport.json === latestCanonicalJson,
        normalizedDocumentExact:
          JSON.stringify(reopened.document) === JSON.stringify(latestRoundTrip.document),
      },
      corruption: {
        separateScope: CORRUPTION_SCOPE,
        separateStorageKey: studioAnimaticStorageKey(CORRUPTION_SCOPE),
        status: corruptionLoad.status,
        documentIsNull: corruptionLoad.document === null,
        error: corruptionLoad.error ?? null,
        failClosed: corruptionFailClosed,
        mainDocumentIntact: mainAfterCorruptionExport?.ok === true
          && mainAfterCorruptionExport.json === latestCanonicalJson,
      },
      opfs: { before: opfsBefore, afterSave: opfsAfterSave, final: opfsFinal },
      storage: { before: storageBefore, afterSave: storageAfterSave, final: storageFinal },
      memory: { before: memoryBefore, afterSave: memoryAfterSave, final: memoryFinal },
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
