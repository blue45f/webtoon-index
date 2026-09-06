/** Dedicated Worker benchmark for the V12 mannequin and BG3D LT SQLite authorities. */

import {
  STUDIO_BG3D_LT_BUILT_IN_PRESETS,
  STUDIO_BG3D_LT_PRESET_MAX_BYTES,
  STUDIO_BG3D_LT_PRESET_MAX_COUNT,
  STUDIO_BG3D_LT_PRESET_MAX_DESCRIPTION_LENGTH,
  STUDIO_BG3D_LT_PRESET_MAX_NAME_LENGTH,
  STUDIO_BG3D_LT_PRESET_PAYLOAD_KIND,
  STUDIO_BG3D_LT_PRESET_PAYLOAD_VERSION,
  STUDIO_BG3D_LT_PRESET_VERSION,
  serializeStudioBg3dLtPresetPayload,
  type StudioBg3dLtPresetPayload,
} from "../../../apps/web/src/domains/creator/bg3d/studio-bg3d-lt-presets";
import {
  createStudioBg3dLtPresetSqliteRepository,
  createStudioMannequinStateSqliteRepository,
  parseCanonicalStudioBg3dLtPresetSqlitePayload,
  parseCanonicalStudioMannequinSqliteState,
  STUDIO_BG3D_LT_PRESET_SQLITE_KEY,
  STUDIO_BG3D_LT_PRESET_SQLITE_NAMESPACE,
  STUDIO_MANNEQUIN_STATE_SQLITE_KEY,
  STUDIO_MANNEQUIN_STATE_SQLITE_NAMESPACE,
} from "../../../apps/web/src/domains/creator/scene-3d/studio-mannequin-bg3d-preset-sqlite-repository";
import {
  STUDIO_MANNEQUIN_JOINT_IDS,
  STUDIO_MANNEQUIN_JOINT_LIMITS,
  STUDIO_MANNEQUIN_PARAM_RANGES,
  clampStudioMannequinJointRotation,
  type StudioMannequinJointId,
  type StudioMannequinVec3,
} from "../../../apps/web/src/domains/creator/scene-3d/studio-mannequin-model";
import {
  serializeStudioMannequinState,
  type StudioMannequinPersistentState,
} from "../../../apps/web/src/domains/creator/scene-3d/studio-mannequin-poses";
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

const REPORT_SCHEMA_VERSION = 1;
const SAVE_SAMPLE_COUNT = 100;
const LOAD_SAMPLE_COUNT = 100;
const BG3D_PRESET_ID_MAX_LENGTH = 80;

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

interface PerformanceMemoryLike {
  readonly jsHeapSizeLimit?: number;
  readonly totalJSHeapSize?: number;
  readonly usedJSHeapSize?: number;
}

interface SpecificMemoryResultLike {
  readonly bytes?: number;
  readonly breakdown?: readonly unknown[];
}

interface PerformanceWithMemory extends Performance {
  readonly memory?: PerformanceMemoryLike;
  measureUserAgentSpecificMemory?: () => Promise<SpecificMemoryResultLike>;
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

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function widestJointRotation(jointId: StudioMannequinJointId): StudioMannequinVec3 {
  const limit = STUDIO_MANNEQUIN_JOINT_LIMITS[jointId];
  const candidates: StudioMannequinVec3[] = [];
  for (const x of limit.x) {
    for (const y of limit.y) {
      for (const z of limit.z) {
        candidates.push(clampStudioMannequinJointRotation(jointId, [x, y, z]));
      }
    }
  }
  return candidates.reduce((winner, candidate) =>
    JSON.stringify(candidate).length > JSON.stringify(winner).length ? candidate : winner
  );
}

function maximumCanonicalMannequinState(): StudioMannequinPersistentState {
  const joints = {} as Partial<Record<StudioMannequinJointId, StudioMannequinVec3>>;
  for (const jointId of STUDIO_MANNEQUIN_JOINT_IDS) {
    joints[jointId] = widestJointRotation(jointId);
  }
  const raw = serializeStudioMannequinState({
    params: {
      heightCm: STUDIO_MANNEQUIN_PARAM_RANGES.heightCm[1],
      headCount: STUDIO_MANNEQUIN_PARAM_RANGES.headCount[1],
      shoulderWidth: STUDIO_MANNEQUIN_PARAM_RANGES.shoulderWidth[1],
      pelvisWidth: STUDIO_MANNEQUIN_PARAM_RANGES.pelvisWidth[1],
      armLength: STUDIO_MANNEQUIN_PARAM_RANGES.armLength[1],
      legLength: STUDIO_MANNEQUIN_PARAM_RANGES.legLength[1],
      build: STUDIO_MANNEQUIN_PARAM_RANGES.build[1],
    },
    pose: { joints, pelvisOffset: [2, 2, 2] },
  });
  return parseCanonicalStudioMannequinSqliteState(raw);
}

function padded(prefix: string, length: number, fill: string): string {
  if (prefix.length > length) throw new Error(`prefix exceeds ${length} characters`);
  return `${prefix}${fill.repeat(length - prefix.length)}`;
}

function maximumCanonicalBg3dLtPayload(): StudioBg3dLtPresetPayload {
  const template = STUDIO_BG3D_LT_BUILT_IN_PRESETS.at(-1);
  if (!template) throw new Error("BG3D LT built-in fixture is unavailable");
  const payload = {
    kind: STUDIO_BG3D_LT_PRESET_PAYLOAD_KIND,
    version: STUDIO_BG3D_LT_PRESET_PAYLOAD_VERSION,
    presets: Array.from({ length: STUDIO_BG3D_LT_PRESET_MAX_COUNT }, (_, index) => {
      const ordinal = String(index).padStart(2, "0");
      return {
        id: padded(`bench.${ordinal}.`, BG3D_PRESET_ID_MAX_LENGTH, "i"),
        version: STUDIO_BG3D_LT_PRESET_VERSION,
        name: padded(`Preset-${ordinal}-`, STUDIO_BG3D_LT_PRESET_MAX_NAME_LENGTH, "N"),
        description: padded(
          `Maximum-canonical-${ordinal}-`,
          STUDIO_BG3D_LT_PRESET_MAX_DESCRIPTION_LENGTH,
          "D",
        ),
        line: template.line,
        tone: template.tone,
      };
    }),
  } as const;
  const raw = serializeStudioBg3dLtPresetPayload(payload);
  if (!raw) {
    throw new Error("schema-maximum BG3D LT payload exceeded its canonical byte budget");
  }
  return parseCanonicalStudioBg3dLtPresetSqlitePayload(raw);
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
  return { tracked, support, initMs };
}

function openProductRuntime(tracked: ConstructorReceipt): Promise<StudioLocalDatabase> {
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

async function captureMemoryEvidence(): Promise<JsonRecord> {
  const measuredPerformance = performance as PerformanceWithMemory;
  const performanceMemory = measuredPerformance.memory
    ? {
        jsHeapSizeLimitBytes: measuredPerformance.memory.jsHeapSizeLimit ?? null,
        totalJSHeapSizeBytes: measuredPerformance.memory.totalJSHeapSize ?? null,
        usedJSHeapSizeBytes: measuredPerformance.memory.usedJSHeapSize ?? null,
      }
    : null;
  const specificApi = measuredPerformance.measureUserAgentSpecificMemory;
  if (typeof specificApi !== "function") {
    return {
      performanceMemoryApiExposed: performanceMemory !== null,
      performanceMemory,
      userAgentSpecificMemoryApiExposed: false,
      userAgentSpecificMemory: null,
      userAgentSpecificMemoryError: null,
    };
  }
  try {
    const result = await specificApi.call(measuredPerformance);
    return {
      performanceMemoryApiExposed: performanceMemory !== null,
      performanceMemory,
      userAgentSpecificMemoryApiExposed: true,
      userAgentSpecificMemory: {
        bytes: typeof result.bytes === "number" ? result.bytes : null,
        breakdownCount: Array.isArray(result.breakdown) ? result.breakdown.length : null,
      },
      userAgentSpecificMemoryError: null,
    };
  } catch (error) {
    return {
      performanceMemoryApiExposed: performanceMemory !== null,
      performanceMemory,
      userAgentSpecificMemoryApiExposed: true,
      userAgentSpecificMemory: null,
      userAgentSpecificMemoryError: errorShape(error),
    };
  }
}

function canonicalFixtures(): {
  readonly mannequin: StudioMannequinPersistentState;
  readonly mannequinRaw: string;
  readonly bg3d: StudioBg3dLtPresetPayload;
  readonly bg3dRaw: string;
} {
  const mannequin = maximumCanonicalMannequinState();
  const mannequinRaw = serializeStudioMannequinState(mannequin);
  const bg3d = maximumCanonicalBg3dLtPayload();
  const bg3dRaw = serializeStudioBg3dLtPresetPayload(bg3d);
  if (!bg3dRaw) throw new Error("canonical BG3D LT fixture did not serialize");
  return { mannequin, mannequinRaw, bg3d, bg3dRaw };
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

  const { tracked } = initialized;
  const fixtures = canonicalFixtures();
  const mannequinDigest = await sha256(fixtures.mannequinRaw);
  const bg3dDigest = await sha256(fixtures.bg3dRaw);
  const memoryBefore = await captureMemoryEvidence();
  let database: StudioLocalDatabase | null = null;
  try {
    const coldOpenStartedAt = performance.now();
    database = await openProductRuntime(tracked);
    const coldOpenMs = performance.now() - coldOpenStartedAt;
    let mannequinRepository = createStudioMannequinStateSqliteRepository();
    let bg3dRepository = createStudioBg3dLtPresetSqliteRepository();

    const mannequinSaveSamples: number[] = [];
    for (let index = 0; index < SAVE_SAMPLE_COUNT; index += 1) {
      const startedAt = performance.now();
      const saved = await mannequinRepository.save(fixtures.mannequin);
      mannequinSaveSamples.push(performance.now() - startedAt);
      if (serializeStudioMannequinState(saved) !== fixtures.mannequinRaw) {
        throw new Error(`mannequin save ${index} changed canonical semantics`);
      }
    }

    const bg3dSaveSamples: number[] = [];
    for (let index = 0; index < SAVE_SAMPLE_COUNT; index += 1) {
      const startedAt = performance.now();
      const saved = await bg3dRepository.save(fixtures.bg3d);
      bg3dSaveSamples.push(performance.now() - startedAt);
      if (serializeStudioBg3dLtPresetPayload(saved) !== fixtures.bg3dRaw) {
        throw new Error(`BG3D LT save ${index} changed canonical semantics`);
      }
    }

    const mannequinBeforeClose = await database.kvGet(
      STUDIO_MANNEQUIN_STATE_SQLITE_NAMESPACE,
      STUDIO_MANNEQUIN_STATE_SQLITE_KEY,
    );
    const bg3dBeforeClose = await database.kvGet(
      STUDIO_BG3D_LT_PRESET_SQLITE_NAMESPACE,
      STUDIO_BG3D_LT_PRESET_SQLITE_KEY,
    );

    await closeStudioLocalDatabaseRuntime();
    database = null;
    const reopenStartedAt = performance.now();
    database = await openProductRuntime(tracked);
    const reopenMs = performance.now() - reopenStartedAt;
    mannequinRepository = createStudioMannequinStateSqliteRepository();
    bg3dRepository = createStudioBg3dLtPresetSqliteRepository();

    const reopenedMannequin = await mannequinRepository.load();
    const reopenedBg3d = await bg3dRepository.load();
    const reopenedMannequinRaw = await database.kvGet(
      STUDIO_MANNEQUIN_STATE_SQLITE_NAMESPACE,
      STUDIO_MANNEQUIN_STATE_SQLITE_KEY,
    );
    const reopenedBg3dRaw = await database.kvGet(
      STUDIO_BG3D_LT_PRESET_SQLITE_NAMESPACE,
      STUDIO_BG3D_LT_PRESET_SQLITE_KEY,
    );

    const mannequinLoadSamples: number[] = [];
    let mannequinMismatchCount = 0;
    for (let index = 0; index < LOAD_SAMPLE_COUNT; index += 1) {
      const startedAt = performance.now();
      const loaded = await mannequinRepository.load();
      mannequinLoadSamples.push(performance.now() - startedAt);
      if (!loaded || serializeStudioMannequinState(loaded) !== fixtures.mannequinRaw) {
        mannequinMismatchCount += 1;
      }
    }

    const bg3dLoadSamples: number[] = [];
    let bg3dMismatchCount = 0;
    for (let index = 0; index < LOAD_SAMPLE_COUNT; index += 1) {
      const startedAt = performance.now();
      const loaded = await bg3dRepository.load();
      bg3dLoadSamples.push(performance.now() - startedAt);
      if (serializeStudioBg3dLtPresetPayload(loaded) !== fixtures.bg3dRaw) {
        bg3dMismatchCount += 1;
      }
    }

    const opfs = await inspectOpfs();
    const storage = await storageEstimate();
    const memoryAfter = await captureMemoryEvidence();
    const expectedFilename = `/${STUDIO_SQLITE_DATABASE_FILENAME}`;
    const mannequinSemanticExact =
      reopenedMannequin !== null
      && serializeStudioMannequinState(reopenedMannequin) === fixtures.mannequinRaw;
    const bg3dSemanticExact =
      serializeStudioBg3dLtPresetPayload(reopenedBg3d) === fixtures.bg3dRaw;
    const mannequinExact =
      mannequinBeforeClose === fixtures.mannequinRaw
      && reopenedMannequinRaw === fixtures.mannequinRaw
      && await sha256(reopenedMannequinRaw) === mannequinDigest
      && mannequinSemanticExact
      && mannequinMismatchCount === 0;
    const bg3dExact =
      bg3dBeforeClose === fixtures.bg3dRaw
      && reopenedBg3dRaw === fixtures.bg3dRaw
      && await sha256(reopenedBg3dRaw) === bg3dDigest
      && bg3dSemanticExact
      && bg3dMismatchCount === 0;
    const authorityPass =
      tracked.openedOpfsDatabaseFilenames.length === 2
      && tracked.openedOpfsDatabaseFilenames.every((name) => name === expectedFilename)
      && tracked.openedMemoryDatabaseFilenames.length === 0
      && tracked.installedOpfsDirectories.length === 2
      && tracked.installedOpfsDirectories.every(
        (directory) => directory === STUDIO_SQLITE_OPFS_DIRECTORY,
      )
      && browserCapabilities.localStorageApiPresent === false;
    const pass =
      mannequinExact
      && bg3dExact
      && authorityPass
      && mannequinSaveSamples.length === SAVE_SAMPLE_COUNT
      && mannequinLoadSamples.length === LOAD_SAMPLE_COUNT
      && bg3dSaveSamples.length === SAVE_SAMPLE_COUNT
      && bg3dLoadSamples.length === LOAD_SAMPLE_COUNT
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
        productRepositories: [
          "createStudioMannequinStateSqliteRepository",
          "createStudioBg3dLtPresetSqliteRepository",
        ],
        productFactoriesUseDefaultAcquire: true,
        runtimeAcquire: "acquireStudioLocalDatabase",
        requestedVfs: "opfs",
        namespaces: [
          STUDIO_MANNEQUIN_STATE_SQLITE_NAMESPACE,
          STUDIO_BG3D_LT_PRESET_SQLITE_NAMESPACE,
        ],
        keys: [STUDIO_MANNEQUIN_STATE_SQLITE_KEY, STUDIO_BG3D_LT_PRESET_SQLITE_KEY],
        opfsDirectory: STUDIO_SQLITE_OPFS_DIRECTORY,
        logicalDatabaseFilename: STUDIO_SQLITE_DATABASE_FILENAME,
        expectedOpenFilename: expectedFilename,
        openedOpfsDatabaseFilenames: tracked.openedOpfsDatabaseFilenames,
        installedOpfsDirectories: tracked.installedOpfsDirectories,
        memoryDatabaseOpenCount: tracked.openedMemoryDatabaseFilenames.length,
        openedMemoryDatabaseFilenames: tracked.openedMemoryDatabaseFilenames,
        localStorageApiPresent: browserCapabilities.localStorageApiPresent,
        localStorageReadCount: 0,
        localStorageWriteCount: 0,
        localStorageFallbackUsed: false,
        memoryFallbackUsed: false,
        closeCompletedBeforeReopen: true,
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
      mannequin: {
        namespace: STUDIO_MANNEQUIN_STATE_SQLITE_NAMESPACE,
        key: STUDIO_MANNEQUIN_STATE_SQLITE_KEY,
        maximumDefinition: "all-19-joints-all-7-body-params-and-3-axis-pelvis",
        jointCount: Object.keys(fixtures.mannequin.pose.joints).length,
        bodyParamCount: Object.keys(fixtures.mannequin.params).length,
        pelvisAxisCount: fixtures.mannequin.pose.pelvisOffset.length,
        canonicalBytes: utf8Bytes(fixtures.mannequinRaw),
        canonicalSha256: mannequinDigest,
        persistedBeforeCloseExact: mannequinBeforeClose === fixtures.mannequinRaw,
        reopenedCanonicalBytesExact: reopenedMannequinRaw === fixtures.mannequinRaw,
        reopenedSemanticExact: mannequinSemanticExact,
        reopenedSha256: await sha256(reopenedMannequinRaw),
        saves: {
          successfulCount: mannequinSaveSamples.length,
          distribution: distribution(mannequinSaveSamples),
        },
        loads: {
          successfulCount: mannequinLoadSamples.length - mannequinMismatchCount,
          mismatchCount: mannequinMismatchCount,
          distribution: distribution(mannequinLoadSamples),
        },
      },
      bg3dLt: {
        namespace: STUDIO_BG3D_LT_PRESET_SQLITE_NAMESPACE,
        key: STUDIO_BG3D_LT_PRESET_SQLITE_KEY,
        maximumDefinition:
          "32-presets-with-80-char-ids-60-char-names-and-240-char-descriptions",
        presetCount: fixtures.bg3d.presets.length,
        idLength: fixtures.bg3d.presets[0]?.id.length ?? 0,
        nameLength: fixtures.bg3d.presets[0]?.name.length ?? 0,
        descriptionLength: fixtures.bg3d.presets[0]?.description.length ?? 0,
        byteBudget: STUDIO_BG3D_LT_PRESET_MAX_BYTES,
        canonicalBytes: utf8Bytes(fixtures.bg3dRaw),
        canonicalSha256: bg3dDigest,
        persistedBeforeCloseExact: bg3dBeforeClose === fixtures.bg3dRaw,
        reopenedCanonicalBytesExact: reopenedBg3dRaw === fixtures.bg3dRaw,
        reopenedSemanticExact: bg3dSemanticExact,
        reopenedSha256: await sha256(reopenedBg3dRaw),
        saves: {
          successfulCount: bg3dSaveSamples.length,
          distribution: distribution(bg3dSaveSamples),
        },
        loads: {
          successfulCount: bg3dLoadSamples.length - bg3dMismatchCount,
          mismatchCount: bg3dMismatchCount,
          distribution: distribution(bg3dLoadSamples),
        },
      },
      memory: {
        before: memoryBefore,
        after: memoryAfter,
        unavailableApisRemainNull: true,
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
  const database = await openProductRuntime(initialized.tracked);
  const fixtures = canonicalFixtures();
  const mannequinRepository = createStudioMannequinStateSqliteRepository();
  const bg3dRepository = createStudioBg3dLtPresetSqliteRepository();
  await mannequinRepository.save(fixtures.mannequin);
  await bg3dRepository.save(fixtures.bg3d);
  const mannequinRaw = await database.kvGet(
    STUDIO_MANNEQUIN_STATE_SQLITE_NAMESPACE,
    STUDIO_MANNEQUIN_STATE_SQLITE_KEY,
  );
  const bg3dRaw = await database.kvGet(
    STUDIO_BG3D_LT_PRESET_SQLITE_NAMESPACE,
    STUDIO_BG3D_LT_PRESET_SQLITE_KEY,
  );
  publish("termination-ready", {
    phase: "termination-seed",
    status: "ready",
    pass: mannequinRaw === fixtures.mannequinRaw && bg3dRaw === fixtures.bg3dRaw,
    closeCalled: false,
    mannequin: {
      bytes: utf8Bytes(fixtures.mannequinRaw),
      sha256: await sha256(fixtures.mannequinRaw),
      persistedExact: mannequinRaw === fixtures.mannequinRaw,
    },
    bg3dLt: {
      bytes: utf8Bytes(fixtures.bg3dRaw),
      sha256: await sha256(fixtures.bg3dRaw),
      persistedExact: bg3dRaw === fixtures.bg3dRaw,
    },
    openedOpfsDatabaseFilenames: initialized.tracked.openedOpfsDatabaseFilenames,
    memoryDatabaseOpenCount: initialized.tracked.openedMemoryDatabaseFilenames.length,
    localStorageApiPresent: "localStorage" in globalThis,
  });
  // The page force-terminates this Worker after the committed receipts. No close is called here.
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
  const fixtures = canonicalFixtures();
  let database: StudioLocalDatabase | null = null;
  try {
    const startedAt = performance.now();
    database = await openProductRuntime(initialized.tracked);
    const reopenAfterTerminateMs = performance.now() - startedAt;
    const mannequinRepository = createStudioMannequinStateSqliteRepository();
    const bg3dRepository = createStudioBg3dLtPresetSqliteRepository();
    const mannequin = await mannequinRepository.load();
    const bg3d = await bg3dRepository.load();
    const mannequinRaw = await database.kvGet(
      STUDIO_MANNEQUIN_STATE_SQLITE_NAMESPACE,
      STUDIO_MANNEQUIN_STATE_SQLITE_KEY,
    );
    const bg3dRaw = await database.kvGet(
      STUDIO_BG3D_LT_PRESET_SQLITE_NAMESPACE,
      STUDIO_BG3D_LT_PRESET_SQLITE_KEY,
    );
    const mannequinSemantic =
      mannequin !== null && serializeStudioMannequinState(mannequin) === fixtures.mannequinRaw;
    const bg3dSemantic = serializeStudioBg3dLtPresetPayload(bg3d) === fixtures.bg3dRaw;
    const pass =
      mannequinRaw === fixtures.mannequinRaw
      && bg3dRaw === fixtures.bg3dRaw
      && mannequinSemantic
      && bg3dSemantic
      && initialized.tracked.openedMemoryDatabaseFilenames.length === 0;
    await closeStudioLocalDatabaseRuntime();
    database = null;
    publish("phase-result", {
      phase: "termination-verify",
      status: pass ? "ok" : "error",
      pass,
      reopenAfterTerminateMs: fixed(reopenAfterTerminateMs),
      reopenedCanonicalExact: pass,
      mannequin: {
        canonicalBytesExact: mannequinRaw === fixtures.mannequinRaw,
        semanticExact: mannequinSemantic,
        bytes: utf8Bytes(fixtures.mannequinRaw),
        expectedSha256: await sha256(fixtures.mannequinRaw),
        reopenedSha256: await sha256(mannequinRaw),
      },
      bg3dLt: {
        canonicalBytesExact: bg3dRaw === fixtures.bg3dRaw,
        semanticExact: bg3dSemantic,
        bytes: utf8Bytes(fixtures.bg3dRaw),
        expectedSha256: await sha256(fixtures.bg3dRaw),
        reopenedSha256: await sha256(bg3dRaw),
      },
      openedOpfsDatabaseFilenames: initialized.tracked.openedOpfsDatabaseFilenames,
      memoryDatabaseOpenCount: initialized.tracked.openedMemoryDatabaseFilenames.length,
      localStorageApiPresent: "localStorage" in globalThis,
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
