/** Dedicated Worker product-path probe for Production Bible SQLite/OPFS persistence. */

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
  acquireStudioLocalDatabase,
  closeStudioLocalDatabaseRuntime,
} from "../../../apps/web/src/domains/creator/studio-local-database-runtime";
import {
  addStudioProductionBibleEntry,
  createEmptyStudioProductionBible,
  serializeStudioProductionBible,
  studioProductionBibleLegacyStorageKey,
  studioProductionBibleStorageKey,
  type StudioProductionBible,
} from "../../../apps/web/src/domains/creator/studio-production-bible";
import {
  createStudioProductionBibleSqlitePersistence,
  STUDIO_PRODUCTION_BIBLE_SQLITE_NAMESPACE,
} from "../../../apps/web/src/domains/creator/studio-production-bible-sqlite-persistence";

const REPORT_SCHEMA_VERSION = 1;
const SAVE_SAMPLE_COUNT = 60;
const LOAD_SAMPLE_COUNT = 60;
const MAIN_SCOPE = { userId: "artist-main", workId: "episode-main" } as const;
const TERMINATION_SCOPE = { userId: "artist-crash", workId: "episode-crash" } as const;

type Phase = "normal" | "termination-seed" | "termination-verify";
type JsonRecord = Record<string, unknown>;

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
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FileSystemDirectoryLike>;
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

interface ConstructorReceipt {
  readonly api: StudioSqliteApiHandle;
  readonly installedOpfsDirectories: string[];
  readonly openedOpfsDatabaseFilenames: string[];
  readonly openedMemoryDatabaseFilenames: string[];
}

function fixed(value: number): number {
  return Number(value.toFixed(4));
}

function percentile(sorted: readonly number[], quantile: number): number {
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[Math.min(sorted.length - 1, index)] ?? 0;
}

function distribution(samples: readonly number[]): Distribution {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    sampleCount: samples.length,
    percentileMethod: "nearest-rank-ceil",
    samplesMs: samples.map(fixed),
    minMs: fixed(sorted[0] ?? 0),
    p50Ms: fixed(percentile(sorted, 0.5)),
    p95Ms: fixed(percentile(sorted, 0.95)),
    p99Ms: fixed(percentile(sorted, 0.99)),
    maxMs: fixed(sorted.at(-1) ?? 0),
    meanMs: fixed(
      samples.length === 0
        ? 0
        : samples.reduce((sum, sample) => sum + sample, 0) / samples.length,
    ),
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

function publish(type: "phase-result" | "termination-ready", value: unknown): void {
  globalThis.postMessage({ type, value });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function fixture(label: string): StudioProductionBible {
  let bible = createEmptyStudioProductionBible();
  bible = addStudioProductionBibleEntry(bible, {
    id: "location-rooftop",
    kind: "location",
    name: "학교 옥상",
    aliases: ["옥상"],
    description: "낡은 철망과 물탱크가 있는 반복 장소",
    visualKeywords: ["역광", "철망"],
    colors: ["남색", "주황"],
    timeOfDay: "해질녘",
    referenceAssetIds: ["asset-rooftop"],
  });
  bible = addStudioProductionBibleEntry(bible, {
    id: "prop-key",
    kind: "prop",
    name: "은색 열쇠",
    linkedCharacterIds: ["character-yun"],
    referenceAssetIds: ["asset-key"],
  });
  return addStudioProductionBibleEntry(bible, {
    id: "scene-reunion",
    kind: "scene",
    name: label,
    description: "윤이 잃어버린 열쇠를 돌려받는다.",
    linkedCharacterIds: ["character-yun"],
    linkedLocationIds: ["location-rooftop"],
    linkedPropIds: ["prop-key"],
  });
}

function trackedSqliteApi(sqliteApi: StudioSqliteApiHandle): ConstructorReceipt {
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

async function initializeSqlite(): Promise<{
  readonly baseApi: StudioSqliteApiHandle;
  readonly tracked: ConstructorReceipt;
  readonly support: Awaited<ReturnType<typeof probeSqliteSupport>>;
  readonly initMs: number;
}> {
  const startedAt = performance.now();
  const sqliteModule = await import("@sqlite.org/sqlite-wasm");
  const baseApi = await sqliteModule.default() as unknown as StudioSqliteApiHandle;
  const initMs = performance.now() - startedAt;
  const tracked = trackedSqliteApi(baseApi);
  const support = await probeSqliteSupport({
    loadSqlite: () => Promise.resolve(tracked.api),
  });
  return { baseApi, tracked, support, initMs };
}

async function seedProductRuntime(
  tracked: ConstructorReceipt,
): Promise<StudioLocalDatabase> {
  return acquireStudioLocalDatabase(() => openStudioLocalDatabase({
    vfs: "opfs",
    loadSqlite: () => Promise.resolve(tracked.api),
  }));
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

async function inspectOpfs(): Promise<JsonRecord> {
  const root = await navigator.storage.getDirectory() as unknown as FileSystemDirectoryLike;
  const directory = await root.getDirectoryHandle(STUDIO_SQLITE_OPFS_DIRECTORY);
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

async function storageEstimate(): Promise<JsonRecord> {
  const estimate = await navigator.storage.estimate();
  const detailed = estimate as StorageEstimate & { usageDetails?: Record<string, number> };
  return {
    usageBytes: estimate.usage ?? null,
    quotaBytes: estimate.quota ?? null,
    usageDetails: detailed.usageDetails ?? null,
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
    localStorageApiPresent: "localStorage" in globalThis,
  };
}

async function runNormal(): Promise<void> {
  const securityPolicyViolations: JsonRecord[] = [];
  globalThis.addEventListener("securitypolicyviolation", (event) => {
    const violation = event as SecurityPolicyViolationEvent;
    securityPolicyViolations.push({
      effectiveDirective: violation.effectiveDirective,
      blockedUri: violation.blockedURI,
      disposition: violation.disposition,
    });
  });
  const browserCapabilities = capabilities();
  let initialized: Awaited<ReturnType<typeof initializeSqlite>>;
  try {
    initialized = await initializeSqlite();
  } catch (error) {
    publish("phase-result", {
      phase: "normal",
      status: "unsupported",
      pass: false,
      reason: `sqlite-wasm initialization failed: ${String(error)}`,
      error: errorShape(error),
      capabilities: browserCapabilities,
    });
    return;
  }
  if (!initialized.support.wasm || !initialized.support.opfs) {
    publish("phase-result", {
      phase: "normal",
      status: "unsupported",
      pass: false,
      reason: initialized.support.reason ?? "OPFS SAH-pool unavailable",
      support: initialized.support,
      capabilities: browserCapabilities,
    });
    return;
  }

  const { baseApi, tracked } = initialized;
  let database: StudioLocalDatabase | null = null;
  try {
    const coldOpenStartedAt = performance.now();
    database = await seedProductRuntime(tracked);
    const coldOpenMs = performance.now() - coldOpenStartedAt;
    let persistence = createStudioProductionBibleSqlitePersistence();
    const mainKey = studioProductionBibleStorageKey(MAIN_SCOPE);
    const initial = await persistence.load(mainKey);

    const saveSamples: number[] = [];
    let latestBible = fixture("옥상 재회 0000");
    let latestCanonical = serializeStudioProductionBible(latestBible);
    for (let index = 0; index < SAVE_SAMPLE_COUNT; index += 1) {
      latestBible = fixture(`옥상 재회 ${String(index).padStart(4, "0")}`);
      latestCanonical = serializeStudioProductionBible(latestBible);
      const startedAt = performance.now();
      const result = await persistence.save(mainKey, latestBible);
      saveSamples.push(performance.now() - startedAt);
      if (result.backend !== "sqlite" || !result.persisted) {
        throw new Error(`product save ${index} did not persist to SQLite`);
      }
    }
    const canonicalDigest = await sha256(latestCanonical);
    const rawBeforeClose = await database.kvGet(
      STUDIO_PRODUCTION_BIBLE_SQLITE_NAMESPACE,
      mainKey,
    );

    const ownerIsolatedKey = studioProductionBibleStorageKey({
      userId: "artist-other",
      workId: MAIN_SCOPE.workId,
    });
    const workIsolatedKey = studioProductionBibleStorageKey({
      userId: MAIN_SCOPE.userId,
      workId: "episode-other",
    });
    const ownerBible = fixture("다른 작가 문서");
    const workBible = fixture("다른 작품 문서");
    await persistence.save(ownerIsolatedKey, ownerBible);
    await persistence.save(workIsolatedKey, workBible);

    const legacyScope = { userId: "legacy-artist", workId: "legacy-episode" } as const;
    const legacyKey = studioProductionBibleLegacyStorageKey(legacyScope);
    const v12LegacyTargetKey = studioProductionBibleStorageKey(legacyScope);
    const legacyPoison = serializeStudioProductionBible(fixture("읽으면 실패하는 레거시 문서"));
    await database.kvSet(
      STUDIO_PRODUCTION_BIBLE_SQLITE_NAMESPACE,
      legacyKey,
      legacyPoison,
    );
    const legacyTargetLoad = await persistence.load(v12LegacyTargetKey);

    const corruptKey = studioProductionBibleStorageKey({ workId: "corrupt-json" });
    const nonCanonicalKey = studioProductionBibleStorageKey({ workId: "pretty-json" });
    await database.kvSet(
      STUDIO_PRODUCTION_BIBLE_SQLITE_NAMESPACE,
      corruptKey,
      "{corrupt-json",
    );
    await database.kvSet(
      STUDIO_PRODUCTION_BIBLE_SQLITE_NAMESPACE,
      nonCanonicalKey,
      serializeStudioProductionBible(fixture("pretty"), true),
    );
    const corruptLoad = await persistence.load(corruptKey);
    const nonCanonicalLoad = await persistence.load(nonCanonicalKey);

    const quotaPersistence = createStudioProductionBibleSqlitePersistence({
      acquireDatabase: async () => {
        throw new DOMException("injected browser quota boundary", "QuotaExceededError");
      },
    });
    const quotaKey = studioProductionBibleStorageKey({ workId: "quota-fault" });
    const quotaLoad = await quotaPersistence.load(quotaKey);
    const quotaSave = await quotaPersistence.save(quotaKey, fixture("quota fault"));

    const installFailureApi: StudioSqliteApiHandle = {
      oo1: baseApi.oo1,
      installOpfsSAHPoolVfs: async () => {
        throw new Error("injected SAH-pool installation failure");
      },
    };
    const sahPersistence = createStudioProductionBibleSqlitePersistence({
      acquireDatabase: () => openStudioLocalDatabase({
        vfs: "opfs",
        loadSqlite: () => Promise.resolve(installFailureApi),
      }),
    });
    const sahKey = studioProductionBibleStorageKey({ workId: "sah-fault" });
    const sahLoad = await sahPersistence.load(sahKey);
    const sahSave = await sahPersistence.save(sahKey, fixture("sah fault"));

    await closeStudioLocalDatabaseRuntime();
    database = null;
    const reopenStartedAt = performance.now();
    database = await seedProductRuntime(tracked);
    const reopenMs = performance.now() - reopenStartedAt;
    persistence = createStudioProductionBibleSqlitePersistence();
    const reopened = await persistence.load(mainKey);
    const reopenedRaw = await database.kvGet(
      STUDIO_PRODUCTION_BIBLE_SQLITE_NAMESPACE,
      mainKey,
    );
    const reopenedOwner = await persistence.load(ownerIsolatedKey);
    const reopenedWork = await persistence.load(workIsolatedKey);
    const reopenedLegacyTarget = await persistence.load(v12LegacyTargetKey);
    const reopenedLegacyRaw = await database.kvGet(
      STUDIO_PRODUCTION_BIBLE_SQLITE_NAMESPACE,
      legacyKey,
    );

    const loadSamples: number[] = [];
    let loadMismatchCount = 0;
    for (let index = 0; index < LOAD_SAMPLE_COUNT; index += 1) {
      const startedAt = performance.now();
      const loaded = await persistence.load(mainKey);
      loadSamples.push(performance.now() - startedAt);
      if (
        loaded.backend !== "sqlite"
        || !loaded.persisted
        || serializeStudioProductionBible(loaded.bible) !== latestCanonical
      ) {
        loadMismatchCount += 1;
      }
    }

    const opfs = await inspectOpfs();
    const storage = await storageEstimate();
    const expectedFilename = `/${STUDIO_SQLITE_DATABASE_FILENAME}`;
    const isolationPass =
      serializeStudioProductionBible(reopenedOwner.bible)
        === serializeStudioProductionBible(ownerBible)
      && serializeStudioProductionBible(reopenedWork.bible)
        === serializeStudioProductionBible(workBible)
      && serializeStudioProductionBible(reopenedOwner.bible)
        !== serializeStudioProductionBible(reopenedWork.bible);
    const legacyIgnored =
      legacyTargetLoad.backend === "sqlite"
      && !legacyTargetLoad.persisted
      && legacyTargetLoad.bible.entries.length === 0
      && reopenedLegacyTarget.backend === "sqlite"
      && !reopenedLegacyTarget.persisted
      && reopenedLegacyTarget.bible.entries.length === 0
      && reopenedLegacyRaw === legacyPoison;
    const strictPass =
      corruptLoad.backend === "unavailable"
      && corruptLoad.bible.entries.length === 0
      && nonCanonicalLoad.backend === "unavailable"
      && nonCanonicalLoad.bible.entries.length === 0;
    const faultPass =
      quotaLoad.backend === "unavailable"
      && quotaSave.backend === "memory"
      && !quotaSave.persisted
      && sahLoad.backend === "unavailable"
      && sahSave.backend === "memory"
      && !sahSave.persisted;
    const canonicalPass =
      initial.backend === "sqlite"
      && !initial.persisted
      && rawBeforeClose === latestCanonical
      && reopened.backend === "sqlite"
      && reopened.persisted
      && serializeStudioProductionBible(reopened.bible) === latestCanonical
      && reopenedRaw === latestCanonical
      && await sha256(reopenedRaw) === canonicalDigest
      && loadMismatchCount === 0;
    const authorityPass =
      tracked.openedOpfsDatabaseFilenames.length === 2
      && tracked.openedOpfsDatabaseFilenames.every((name) => name === expectedFilename)
      && tracked.openedMemoryDatabaseFilenames.length === 0
      && tracked.installedOpfsDirectories.length === 2
      && tracked.installedOpfsDirectories.every(
        (directory) => directory === STUDIO_SQLITE_OPFS_DIRECTORY,
      );
    const pass =
      canonicalPass
      && isolationPass
      && legacyIgnored
      && strictPass
      && faultPass
      && authorityPass
      && Number(opfs.fileCount) > 0
      && Number(opfs.totalFileBytes) > 0
      && securityPolicyViolations.length === 0;

    publish("phase-result", {
      phase: "normal",
      status: pass ? "ok" : "error",
      pass,
      schemaVersion: REPORT_SCHEMA_VERSION,
      execution: "vite-production-build-chromium-dedicated-worker-opfs-sahpool",
      authority: {
        kind: "sqlite-opfs-sahpool",
        productPersistence: "createStudioProductionBibleSqlitePersistence",
        productFactoryUsesDefaultAcquire: true,
        runtimeAcquire: "acquireStudioLocalDatabase",
        requestedVfs: "opfs",
        namespace: STUDIO_PRODUCTION_BIBLE_SQLITE_NAMESPACE,
        opfsDirectory: STUDIO_SQLITE_OPFS_DIRECTORY,
        logicalDatabaseFilename: STUDIO_SQLITE_DATABASE_FILENAME,
        expectedOpenFilename: expectedFilename,
        openedOpfsDatabaseFilenames: tracked.openedOpfsDatabaseFilenames,
        installedOpfsDirectories: tracked.installedOpfsDirectories,
        memoryDatabaseOpenCount: tracked.openedMemoryDatabaseFilenames.length,
        localStorageApiPresent: browserCapabilities.localStorageApiPresent,
        localStorageFallbackUsed: false,
        closeCompletedBeforeReopen: true,
      },
      policy: {
        legacyDataMigration: false,
        discardExistingStudioData: true,
        legacyStorageKey: legacyKey,
        v12StorageKey: v12LegacyTargetKey,
        legacyKeyReadByProduct: false,
        legacyPayloadRemainedUntouched: reopenedLegacyRaw === legacyPoison,
      },
      support: initialized.support,
      capabilities: browserCapabilities,
      browser: {
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
      },
      opening: {
        sqliteWasmInitMs: fixed(initialized.initMs),
        coldOpenMs: fixed(coldOpenMs),
        reopenMs: fixed(reopenMs),
      },
      saves: { successfulCount: saveSamples.length, distribution: distribution(saveSamples) },
      loads: {
        successfulCount: loadSamples.length - loadMismatchCount,
        mismatchCount: loadMismatchCount,
        distribution: distribution(loadSamples),
      },
      canonical: {
        bytes: new TextEncoder().encode(latestCanonical).byteLength,
        digestSha256: canonicalDigest,
        persistedBeforeCloseExact: rawBeforeClose === latestCanonical,
        reopenedExact: reopenedRaw === latestCanonical,
        strictRoundTrip: canonicalPass,
      },
      isolation: {
        ownerKey: ownerIsolatedKey,
        workKey: workIsolatedKey,
        mainKey,
        pass: isolationPass,
      },
      corruption: {
        corruptBackend: corruptLoad.backend,
        nonCanonicalBackend: nonCanonicalLoad.backend,
        failClosed: strictPass,
      },
      faults: {
        quota: {
          injection: "synthetic-acquireDatabase-QuotaExceededError",
          loadBackend: quotaLoad.backend,
          saveBackend: quotaSave.backend,
          silentFallback: false,
          actualBrowserQuotaEnforcement: "quarantined-no-portable-quota-control",
        },
        sahInstall: {
          injection: "openStudioLocalDatabase-installOpfsSAHPoolVfs-throws",
          loadBackend: sahLoad.backend,
          saveBackend: sahSave.backend,
          silentFallback: false,
          errorSurfaced: sahLoad.warning?.includes("SAH-pool") === true,
        },
      },
      opfs,
      storage,
      securityPolicyViolations,
    });
  } finally {
    await closeStudioLocalDatabaseRuntime().catch(() => undefined);
    await database?.close().catch(() => undefined);
  }
}

async function runTerminationSeed(): Promise<void> {
  const initialized = await initializeSqlite();
  if (!initialized.support.wasm || !initialized.support.opfs) {
    publish("phase-result", {
      phase: "termination-seed",
      status: "unsupported",
      pass: false,
      reason: initialized.support.reason ?? "OPFS SAH-pool unavailable",
    });
    return;
  }
  const database = await seedProductRuntime(initialized.tracked);
  const persistence = createStudioProductionBibleSqlitePersistence();
  const key = studioProductionBibleStorageKey(TERMINATION_SCOPE);
  const bible = fixture("강제 종료 직전 문서");
  const canonical = serializeStudioProductionBible(bible);
  const saved = await persistence.save(key, bible);
  const raw = await database.kvGet(STUDIO_PRODUCTION_BIBLE_SQLITE_NAMESPACE, key);
  publish("termination-ready", {
    phase: "termination-seed",
    status: "ready",
    pass: saved.backend === "sqlite" && saved.persisted && raw === canonical,
    key,
    canonical,
    digestSha256: await sha256(canonical),
    openedOpfsDatabaseFilenames: initialized.tracked.openedOpfsDatabaseFilenames,
    closeCalled: false,
  });
  // The page deliberately terminates this Worker. No close call is reachable after this receipt.
}

async function runTerminationVerify(): Promise<void> {
  const initialized = await initializeSqlite();
  if (!initialized.support.wasm || !initialized.support.opfs) {
    publish("phase-result", {
      phase: "termination-verify",
      status: "unsupported",
      pass: false,
      reason: initialized.support.reason ?? "OPFS SAH-pool unavailable",
    });
    return;
  }
  let database: StudioLocalDatabase | null = null;
  try {
    const startedAt = performance.now();
    database = await seedProductRuntime(initialized.tracked);
    const reopenAfterTerminateMs = performance.now() - startedAt;
    const persistence = createStudioProductionBibleSqlitePersistence();
    const key = studioProductionBibleStorageKey(TERMINATION_SCOPE);
    const loaded = await persistence.load(key);
    const canonical = serializeStudioProductionBible(fixture("강제 종료 직전 문서"));
    const raw = await database.kvGet(STUDIO_PRODUCTION_BIBLE_SQLITE_NAMESPACE, key);
    const pass =
      loaded.backend === "sqlite"
      && loaded.persisted
      && serializeStudioProductionBible(loaded.bible) === canonical
      && raw === canonical;
    await closeStudioLocalDatabaseRuntime();
    database = null;
    publish("phase-result", {
      phase: "termination-verify",
      status: pass ? "ok" : "error",
      pass,
      key,
      reopenedCanonicalExact: raw === canonical,
      digestSha256: await sha256(canonical),
      reopenAfterTerminateMs: fixed(reopenAfterTerminateMs),
      openedOpfsDatabaseFilenames: initialized.tracked.openedOpfsDatabaseFilenames,
      closeCalledAfterVerification: true,
    });
  } finally {
    await closeStudioLocalDatabaseRuntime().catch(() => undefined);
    await database?.close().catch(() => undefined);
  }
}

globalThis.addEventListener("message", (event: MessageEvent<{ phase?: Phase }>) => {
  const phase = event.data?.phase;
  const operation = phase === "normal"
    ? runNormal()
    : phase === "termination-seed"
      ? runTerminationSeed()
      : phase === "termination-verify"
        ? runTerminationVerify()
        : Promise.reject(new Error(`unknown benchmark phase: ${String(phase)}`));
  void operation.catch((error) => {
    publish("phase-result", {
      phase: phase ?? "unknown",
      status: error instanceof SqliteUnavailableError ? "unsupported" : "error",
      pass: false,
      reason: error instanceof SqliteUnavailableError ? error.reason : undefined,
      error: errorShape(error),
    });
  });
});
