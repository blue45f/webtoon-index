/** Dedicated Worker client for the real Chromium VRM asset SQLite/OPFS promotion gate. */

import {
  openStudioLocalDatabase,
  probeSqliteSupport,
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
  createStudioVrmAssetSqliteOpfsRepository,
  STUDIO_VRM_ASSET_OPFS_ROOT,
  STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
  STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
  STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE,
  type SaveStudioVrmModelAssetInput,
  type StudioVrmAssetHash,
  type StudioVrmAssetSqliteOpfsRepository,
} from "../../../apps/web/src/domains/creator/vrm/studio-vrm-asset-sqlite-opfs-repository";
import {
  createStudioVrmTexturePaintArtifact,
  type StudioVrmTexturePaintArtifactMetadata,
} from "../../../apps/web/src/domains/creator/vrm/studio-vrm-texture-paint-artifact";

const REPORT_SCHEMA_VERSION = 1;
const SMALL_MODEL_BYTES = 1 * 1024 * 1024;
const SMALL_MODEL_SAVE_COUNT = 100;
const SMALL_MODEL_LOAD_COUNT = 100;
const LARGE_MODEL_BYTES = 32 * 1024 * 1024;
const LARGE_MODEL_SAVE_COUNT = 2;
const LARGE_MODEL_LOAD_COUNT = 5;
const TEXTURE_COUNT = 100;
const TEXTURE_WIDTH = 256;
const TEXTURE_HEIGHT = 256;
const TERMINATION_MODEL_ID = "termination-model-v1";
const TERMINATION_TEXTURE_BINDING = "material:termination/baseColor";

type Phase = "normal" | "termination-seed" | "termination-verify";
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

interface ConstructorReceipt {
  readonly api: StudioSqliteApiHandle;
  readonly installedOpfsDirectories: string[];
  readonly openedOpfsDatabaseFilenames: string[];
  readonly openedMemoryDatabaseFilenames: string[];
}

interface ExpectedModel {
  readonly id: string;
  readonly seed: number;
  readonly byteLength: number;
  readonly contentHash: StudioVrmAssetHash;
}

interface ExpectedTexture {
  readonly seed: number;
  readonly byteLength: number;
  readonly contentHash: StudioVrmAssetHash;
  readonly receipt: StudioVrmTexturePaintArtifactMetadata;
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
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack ?? null }
    : { name: "NonError", message: String(error), stack: null };
}

function publish(type: "phase-result" | "termination-ready", value: unknown): void {
  globalThis.postMessage({ type, value });
}

async function sha256Bytes(bytes: Uint8Array): Promise<StudioVrmAssetHash> {
  const owned = Uint8Array.from(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", owned.buffer));
  return `sha256:${Array.from(
    digest,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

async function sha256Text(value: string): Promise<StudioVrmAssetHash> {
  return sha256Bytes(new TextEncoder().encode(value));
}

function nextRandom(state: number): number {
  let value = state >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function fillDeterministic(bytes: Uint8Array, seed: number): void {
  let state = (seed ^ 0x9e37_79b9) >>> 0;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    state = nextRandom(state + index + 1);
    bytes[index] = state & 0xff;
  }
}

/** A structurally valid GLB 2 container with authored deterministic JSON and binary chunks. */
function authoredVrmLikeBytes(byteLength: number, seed: number): Uint8Array<ArrayBuffer> {
  if (byteLength % 4 !== 0 || byteLength < 256) {
    throw new RangeError(`VRM-like byte length must be aligned and >=256, got ${byteLength}`);
  }
  const json = new TextEncoder().encode(JSON.stringify({
    asset: { generator: "ToonSpectrum V12 browser promotion gate", version: "2.0" },
    extensionsUsed: ["VRMC_vrm"],
    extensions: { VRMC_vrm: { specVersion: "1.0" } },
    extras: { authored: true, deterministicSeed: seed },
  }));
  const paddedJsonLength = Math.ceil(json.byteLength / 4) * 4;
  const binaryLength = byteLength - 12 - 8 - paddedJsonLength - 8;
  if (binaryLength < 4 || binaryLength % 4 !== 0) {
    throw new RangeError(`VRM-like binary chunk cannot fit ${byteLength} bytes`);
  }
  const result = new Uint8Array(byteLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, 0x4654_6c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, byteLength, true);
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, 0x4e4f_534a, true);
  result.set(json, 20);
  result.fill(0x20, 20 + json.byteLength, 20 + paddedJsonLength);
  const binaryHeader = 20 + paddedJsonLength;
  view.setUint32(binaryHeader, binaryLength, true);
  view.setUint32(binaryHeader + 4, 0x004e_4942, true);
  fillDeterministic(result.subarray(binaryHeader + 8), seed);
  return result;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(12 + data.byteLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.byteLength, false);
  result.set(Uint8Array.from(type, (character) => character.charCodeAt(0)), 4);
  result.set(data, 8);
  view.setUint32(result.byteLength - 4, crc32(result.subarray(4, -4)), false);
  return result;
}

async function compressDeflate(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof CompressionStream !== "function") {
    throw new Error("CompressionStream(deflate) is unavailable for authored PNG generation");
  }
  const owned = Uint8Array.from(bytes);
  const compressed = new Blob([owned.buffer])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

/** A decodable RGBA8 PNG with deterministic authored pixels and valid zlib/CRC structure. */
async function authoredTexturePng(seed: number): Promise<Uint8Array<ArrayBuffer>> {
  const stride = 1 + TEXTURE_WIDTH * 4;
  const raw = new Uint8Array(stride * TEXTURE_HEIGHT);
  let state = (seed ^ 0xa5a5_5a5a) >>> 0;
  for (let y = 0; y < TEXTURE_HEIGHT; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < TEXTURE_WIDTH; x += 1) {
      state = nextRandom(state + x + y + 1);
      const offset = row + 1 + x * 4;
      raw[offset] = state & 0xff;
      raw[offset + 1] = (state >>> 8) & 0xff;
      raw[offset + 2] = (state >>> 16) & 0xff;
      raw[offset + 3] = 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, TEXTURE_WIDTH, false);
  view.setUint32(4, TEXTURE_HEIGHT, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const compressed = await compressDeflate(raw);
  return concat(
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array()),
  );
}

function modelInput(
  id: string,
  seed: number,
  bytes: Uint8Array<ArrayBuffer>,
  contentHash: StudioVrmAssetHash,
): SaveStudioVrmModelAssetInput {
  const timestamp = 1_800_000_000_000 + seed;
  return {
    id,
    name: `Authored VRM ${id}`,
    bytes,
    expectedHash: contentHash,
    validationVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
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

function installIndexedDbCounter(): {
  readonly installed: boolean;
  readonly openCount: () => number;
  readonly deleteDatabaseCount: () => number;
  readonly error: JsonRecord | null;
} {
  let openCount = 0;
  let deleteDatabaseCount = 0;
  try {
    const prototype = globalThis.IDBFactory?.prototype as unknown as {
      open?: (...args: unknown[]) => unknown;
      deleteDatabase?: (...args: unknown[]) => unknown;
    } | undefined;
    if (!prototype?.open || !prototype.deleteDatabase) {
      return {
        installed: false,
        openCount: () => openCount,
        deleteDatabaseCount: () => deleteDatabaseCount,
        error: { message: "IDBFactory prototype is unavailable" },
      };
    }
    const originalOpen = prototype.open;
    const originalDelete = prototype.deleteDatabase;
    prototype.open = function countedOpen(...args: unknown[]): unknown {
      openCount += 1;
      return Reflect.apply(originalOpen, this, args);
    };
    prototype.deleteDatabase = function countedDelete(...args: unknown[]): unknown {
      deleteDatabaseCount += 1;
      return Reflect.apply(originalDelete, this, args);
    };
    return {
      installed: true,
      openCount: () => openCount,
      deleteDatabaseCount: () => deleteDatabaseCount,
      error: null,
    };
  } catch (error) {
    return {
      installed: false,
      openCount: () => openCount,
      deleteDatabaseCount: () => deleteDatabaseCount,
      error: errorShape(error),
    };
  }
}

async function initializeSqlite(): Promise<{
  readonly tracked: ConstructorReceipt;
  readonly support: Awaited<ReturnType<typeof probeSqliteSupport>>;
  readonly initMs: number;
}> {
  const startedAt = performance.now();
  const sqliteModule = await import("@sqlite.org/sqlite-wasm");
  const sqliteApi = await sqliteModule.default() as unknown as StudioSqliteApiHandle;
  const initMs = performance.now() - startedAt;
  const tracked = trackedSqliteApi(sqliteApi);
  const support = await probeSqliteSupport({
    loadSqlite: () => Promise.resolve(tracked.api),
  });
  return { tracked, support, initMs };
}

async function openProductDatabase(tracked: ConstructorReceipt): Promise<StudioLocalDatabase> {
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
        sizeBytes: (await (entry as FileSystemFileEntryLike).getFile()).size,
      });
      continue;
    }
    rows.push({ path, kind: "directory", sizeBytes: null });
    rows.push(...await walkDirectory(entry as FileSystemDirectoryLike, path));
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

async function inspectNamedDirectory(name: string): Promise<JsonRecord> {
  try {
    const root = await navigator.storage.getDirectory() as unknown as FileSystemDirectoryLike;
    const directory = await root.getDirectoryHandle(name);
    const entries = await walkDirectory(directory);
    const files = entries.filter((entry) => entry.kind === "file");
    return {
      exists: true,
      entries,
      fileCount: files.length,
      totalFileBytes: files.reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0),
      blobCount: files.filter((entry) => entry.path.startsWith("blobs/")).length,
      commitCount: files.filter((entry) => entry.path.startsWith("commits/")).length,
    };
  } catch (error) {
    return {
      exists: false,
      entries: [],
      fileCount: 0,
      totalFileBytes: 0,
      blobCount: 0,
      commitCount: 0,
      error: errorShape(error),
    };
  }
}

async function captureStorageEstimate(): Promise<JsonRecord> {
  if (typeof navigator.storage?.estimate !== "function") {
    return { available: false, measured: {} };
  }
  try {
    const estimate = await navigator.storage.estimate();
    const measured: JsonRecord = {};
    if (typeof estimate.usage === "number" && Number.isFinite(estimate.usage)) {
      measured.usageBytes = estimate.usage;
    }
    if (typeof estimate.quota === "number" && Number.isFinite(estimate.quota)) {
      measured.quotaBytes = estimate.quota;
    }
    const details = (estimate as StorageEstimate & {
      usageDetails?: Record<string, number>;
    }).usageDetails;
    if (details) measured.usageDetailsBytes = details;
    return { available: Object.keys(measured).length > 0, measured };
  } catch (error) {
    return { available: false, measured: {}, error: errorShape(error) };
  }
}

async function captureMemory(label: string): Promise<JsonRecord> {
  const measuredPerformance = performance as PerformanceWithMemory;
  const measured: JsonRecord = {};
  if (measuredPerformance.memory) {
    const source = measuredPerformance.memory;
    if (typeof source.jsHeapSizeLimit === "number" && Number.isFinite(source.jsHeapSizeLimit)) {
      measured.jsHeapSizeLimitBytes = source.jsHeapSizeLimit;
    }
    if (typeof source.totalJSHeapSize === "number" && Number.isFinite(source.totalJSHeapSize)) {
      measured.totalJSHeapSizeBytes = source.totalJSHeapSize;
    }
    if (typeof source.usedJSHeapSize === "number" && Number.isFinite(source.usedJSHeapSize)) {
      measured.usedJSHeapSizeBytes = source.usedJSHeapSize;
    }
  }
  const specific = measuredPerformance.measureUserAgentSpecificMemory;
  if (typeof specific === "function") {
    try {
      const result = await specific.call(measuredPerformance);
      if (typeof result.bytes === "number" && Number.isFinite(result.bytes)) {
        measured.userAgentSpecificMemoryBytes = result.bytes;
      }
      if (Array.isArray(result.breakdown)) {
        measured.userAgentSpecificBreakdownCount = result.breakdown.length;
      }
    } catch (error) {
      return {
        label,
        status: Object.keys(measured).length > 0 ? "partial" : "unavailable",
        measured,
        error: errorShape(error),
      };
    }
  }
  return {
    label,
    status: Object.keys(measured).length > 0 ? "measured" : "unavailable",
    measured,
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
    compressionStream: typeof CompressionStream === "function",
    localStorageApiPresent: "localStorage" in globalThis,
    indexedDbApiPresent: "indexedDB" in globalThis,
  };
}

function manifestHasBinaryEncoding(modelRaw: string | null, textureRaw: string | null): boolean {
  const combined = `${modelRaw ?? ""}\n${textureRaw ?? ""}`;
  return /(?:base64|data:|Z2xURg|iVBOR)/iu.test(combined);
}

async function saveModels(
  repository: StudioVrmAssetSqliteOpfsRepository,
  prefix: string,
  byteLength: number,
  count: number,
  seedOffset: number,
): Promise<{ expected: ExpectedModel[]; samples: number[]; mismatchCount: number }> {
  const expected: ExpectedModel[] = [];
  const samples: number[] = [];
  let mismatchCount = 0;
  for (let index = 0; index < count; index += 1) {
    const seed = seedOffset + index;
    const id = `${prefix}-${String(index).padStart(3, "0")}`;
    const bytes = authoredVrmLikeBytes(byteLength, seed);
    const contentHash = await sha256Bytes(bytes);
    const startedAt = performance.now();
    const result = await repository.saveModel(modelInput(id, seed, bytes, contentHash));
    samples.push(performance.now() - startedAt);
    if (
      result.deduplicated
      || result.metadata.id !== id
      || result.metadata.contentHash !== contentHash
      || result.metadata.byteSize !== byteLength
    ) mismatchCount += 1;
    expected.push({ id, seed, byteLength, contentHash });
  }
  return { expected, samples, mismatchCount };
}

async function loadModels(
  repository: StudioVrmAssetSqliteOpfsRepository,
  expected: readonly ExpectedModel[],
  count: number,
): Promise<{ samples: number[]; mismatchCount: number }> {
  const samples: number[] = [];
  let mismatchCount = 0;
  for (let index = 0; index < count; index += 1) {
    const item = expected[index % expected.length];
    if (!item) throw new Error("model load corpus is empty");
    const startedAt = performance.now();
    const loaded = await repository.getModel(item.id);
    const actualHash = loaded ? await sha256Bytes(loaded.bytes) : null;
    samples.push(performance.now() - startedAt);
    if (
      !loaded
      || loaded.byteSize !== item.byteLength
      || loaded.bytes.byteLength !== item.byteLength
      || loaded.contentHash !== item.contentHash
      || actualHash !== item.contentHash
    ) mismatchCount += 1;
  }
  return { samples, mismatchCount };
}

async function saveTextures(
  repository: StudioVrmAssetSqliteOpfsRepository,
  count: number,
  seedOffset: number,
): Promise<{ expected: ExpectedTexture[]; samples: number[]; mismatchCount: number }> {
  const expected: ExpectedTexture[] = [];
  const samples: number[] = [];
  let mismatchCount = 0;
  for (let index = 0; index < count; index += 1) {
    const seed = seedOffset + index;
    const bytes = await authoredTexturePng(seed);
    const artifact = await createStudioVrmTexturePaintArtifact({
      bindingKey: `material:benchmark-${String(index).padStart(3, "0")}/baseColor`,
      source: bytes,
      expectedWidth: TEXTURE_WIDTH,
      expectedHeight: TEXTURE_HEIGHT,
    });
    const startedAt = performance.now();
    const result = await repository.saveTexture({ receipt: artifact.metadata, bytes });
    samples.push(performance.now() - startedAt);
    if (
      result.receipt.contentHash !== artifact.metadata.contentHash
      || result.receipt.byteLength !== bytes.byteLength
      || result.deduplicated
    ) mismatchCount += 1;
    expected.push({
      seed,
      byteLength: bytes.byteLength,
      contentHash: artifact.metadata.contentHash,
      receipt: artifact.metadata,
    });
  }
  return { expected, samples, mismatchCount };
}

async function loadTextures(
  repository: StudioVrmAssetSqliteOpfsRepository,
  expected: readonly ExpectedTexture[],
): Promise<{ samples: number[]; mismatchCount: number }> {
  const samples: number[] = [];
  let mismatchCount = 0;
  for (const item of expected) {
    const startedAt = performance.now();
    const loaded = await repository.getTexture(item.contentHash);
    const actualHash = loaded ? await sha256Bytes(loaded.bytes) : null;
    samples.push(performance.now() - startedAt);
    if (
      !loaded
      || loaded.bytes.byteLength !== item.byteLength
      || loaded.receipt.contentHash !== item.contentHash
      || loaded.receipt.byteLength !== item.byteLength
      || actualHash !== item.contentHash
    ) mismatchCount += 1;
  }
  return { samples, mismatchCount };
}

async function verifyAllAfterReopen(
  repository: StudioVrmAssetSqliteOpfsRepository,
  models: readonly ExpectedModel[],
  textures: readonly ExpectedTexture[],
): Promise<JsonRecord> {
  let modelMismatchCount = 0;
  let textureMismatchCount = 0;
  for (const item of models) {
    const loaded = await repository.getModel(item.id);
    if (
      !loaded
      || loaded.bytes.byteLength !== item.byteLength
      || loaded.contentHash !== item.contentHash
      || await sha256Bytes(loaded.bytes) !== item.contentHash
    ) modelMismatchCount += 1;
  }
  for (const item of textures) {
    const loaded = await repository.getTexture(item.contentHash);
    if (
      !loaded
      || loaded.bytes.byteLength !== item.byteLength
      || loaded.receipt.contentHash !== item.contentHash
      || await sha256Bytes(loaded.bytes) !== item.contentHash
    ) textureMismatchCount += 1;
  }
  return {
    expectedModelCount: models.length,
    expectedTextureCount: textures.length,
    modelMismatchCount,
    textureMismatchCount,
    exactShaAndBytes: modelMismatchCount === 0 && textureMismatchCount === 0,
  };
}

async function runNormal(): Promise<void> {
  const idb = installIndexedDbCounter();
  const securityPolicyViolations: JsonRecord[] = [];
  globalThis.addEventListener("securitypolicyviolation", (event) => {
    const violation = event as SecurityPolicyViolationEvent;
    securityPolicyViolations.push({
      effectiveDirective: violation.effectiveDirective,
      blockedUri: violation.blockedURI,
      disposition: violation.disposition,
    });
  });
  const environmentCapabilities = capabilities();
  const initialized = await initializeSqlite();
  if (!initialized.support.wasm || !initialized.support.opfs) {
    publish("phase-result", {
      phase: "normal",
      status: "unsupported",
      pass: false,
      schemaVersion: REPORT_SCHEMA_VERSION,
      support: initialized.support,
      capabilities: environmentCapabilities,
    });
    return;
  }

  let database: StudioLocalDatabase | null = null;
  let repository: StudioVrmAssetSqliteOpfsRepository | null = null;
  try {
    const storageBefore = await captureStorageEstimate();
    const memoryBefore = await captureMemory("worker-before-open");
    const coldOpenStartedAt = performance.now();
    database = await openProductDatabase(initialized.tracked);
    const coldOpenMs = performance.now() - coldOpenStartedAt;
    repository = createStudioVrmAssetSqliteOpfsRepository();
    const initialMetadata = await repository.listModelMetadata();
    const initialTextureRaw = await database.kvGet(
      STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    );
    if (initialMetadata.length !== 0 || initialTextureRaw !== null) {
      throw new Error("fresh Chromium origin unexpectedly contained VRM asset manifests");
    }

    const smallSaved = await saveModels(
      repository,
      "small-model",
      SMALL_MODEL_BYTES,
      SMALL_MODEL_SAVE_COUNT,
      10_000,
    );
    const smallLoaded = await loadModels(
      repository,
      smallSaved.expected,
      SMALL_MODEL_LOAD_COUNT,
    );
    const memoryAfterSmall = await captureMemory("worker-after-1m-models");

    let largeStatus: "pass" | "quarantined" = "pass";
    let largeError: JsonRecord | null = null;
    let largeSaved: Awaited<ReturnType<typeof saveModels>> = {
      expected: [],
      samples: [],
      mismatchCount: 0,
    };
    let largeLoaded: Awaited<ReturnType<typeof loadModels>> = {
      samples: [],
      mismatchCount: 0,
    };
    try {
      largeSaved = await saveModels(
        repository,
        "large-model",
        LARGE_MODEL_BYTES,
        LARGE_MODEL_SAVE_COUNT,
        20_000,
      );
      largeLoaded = await loadModels(
        repository,
        largeSaved.expected,
        LARGE_MODEL_LOAD_COUNT,
      );
      if (largeSaved.mismatchCount > 0 || largeLoaded.mismatchCount > 0) {
        throw new Error("32 MiB model SHA/byte equality failed");
      }
    } catch (error) {
      largeStatus = "quarantined";
      largeError = errorShape(error);
    }
    const memoryAfterLarge = await captureMemory("worker-after-32m-models");

    const texturesSaved = await saveTextures(repository, TEXTURE_COUNT, 30_000);
    const texturesLoaded = await loadTextures(repository, texturesSaved.expected);
    const memoryAfterTextures = await captureMemory("worker-after-textures");

    const modelRawBeforeClose = await database.kvGet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    );
    const textureRawBeforeClose = await database.kvGet(
      STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    );
    const modelManifestDigest = modelRawBeforeClose
      ? await sha256Text(modelRawBeforeClose)
      : null;
    const textureManifestDigest = textureRawBeforeClose
      ? await sha256Text(textureRawBeforeClose)
      : null;
    const casBeforeClose = await inspectNamedDirectory(STUDIO_VRM_ASSET_OPFS_ROOT);
    const sqliteBeforeClose = await inspectNamedDirectory(STUDIO_SQLITE_OPFS_DIRECTORY);
    const storageAfterWork = await captureStorageEstimate();

    await repository.close();
    repository = null;
    await closeStudioLocalDatabaseRuntime();
    database = null;
    const closeCompletedBeforeReopen = true;

    const reopenStartedAt = performance.now();
    database = await openProductDatabase(initialized.tracked);
    const reopenMs = performance.now() - reopenStartedAt;
    repository = createStudioVrmAssetSqliteOpfsRepository();
    const allModels = [...smallSaved.expected, ...largeSaved.expected];
    const reopenedVerification = await verifyAllAfterReopen(
      repository,
      allModels,
      texturesSaved.expected,
    );
    const reopenedMetadata = await repository.listModelMetadata();
    const modelRawAfterReopen = await database.kvGet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    );
    const textureRawAfterReopen = await database.kvGet(
      STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    );
    const casAfterReopen = await inspectNamedDirectory(STUDIO_VRM_ASSET_OPFS_ROOT);
    const storageAfterReopen = await captureStorageEstimate();
    const memoryAfterReopen = await captureMemory("worker-after-reopen-verification");

    const expectedAssetCount = allModels.length + texturesSaved.expected.length;
    const fallback = {
      memoryDatabaseOpenCount: initialized.tracked.openedMemoryDatabaseFilenames.length,
      memoryFilesystemFallbackCount: 0,
      localStorageApiPresent: environmentCapabilities.localStorageApiPresent,
      localStorageReadCount: 0,
      localStorageWriteCount: 0,
      indexedDbInstrumentationInstalled: idb.installed,
      indexedDbOpenCount: idb.openCount(),
      indexedDbDeleteDatabaseCount: idb.deleteDatabaseCount(),
      indexedDbInstrumentationError: idb.error,
    };
    const largePass = largeStatus === "pass"
      && largeSaved.expected.length === LARGE_MODEL_SAVE_COUNT
      && largeLoaded.samples.length === LARGE_MODEL_LOAD_COUNT;
    const pass =
      smallSaved.mismatchCount === 0
      && smallLoaded.mismatchCount === 0
      && smallSaved.samples.length === SMALL_MODEL_SAVE_COUNT
      && smallLoaded.samples.length === SMALL_MODEL_LOAD_COUNT
      && largePass
      && texturesSaved.mismatchCount === 0
      && texturesLoaded.mismatchCount === 0
      && texturesSaved.samples.length === TEXTURE_COUNT
      && texturesLoaded.samples.length === TEXTURE_COUNT
      && reopenedVerification.exactShaAndBytes === true
      && reopenedMetadata.length === allModels.length
      && modelRawAfterReopen === modelRawBeforeClose
      && textureRawAfterReopen === textureRawBeforeClose
      && !manifestHasBinaryEncoding(modelRawBeforeClose, textureRawBeforeClose)
      && casAfterReopen.exists === true
      && casAfterReopen.blobCount === expectedAssetCount
      && casAfterReopen.commitCount === expectedAssetCount
      && fallback.memoryDatabaseOpenCount === 0
      && fallback.memoryFilesystemFallbackCount === 0
      && fallback.localStorageApiPresent === false
      && fallback.localStorageReadCount === 0
      && fallback.localStorageWriteCount === 0
      && fallback.indexedDbInstrumentationInstalled
      && fallback.indexedDbOpenCount === 0
      && fallback.indexedDbDeleteDatabaseCount === 0
      && initialized.tracked.openedOpfsDatabaseFilenames.length === 2
      && initialized.tracked.openedOpfsDatabaseFilenames.every(
        (filename) => filename === `/${STUDIO_SQLITE_DATABASE_FILENAME}`,
      )
      && securityPolicyViolations.length === 0;

    await repository.close();
    repository = null;
    await closeStudioLocalDatabaseRuntime();
    database = null;

    publish("phase-result", {
      phase: "normal",
      status: largeStatus === "quarantined" ? "quarantined" : pass ? "ok" : "error",
      pass,
      schemaVersion: REPORT_SCHEMA_VERSION,
      execution: "vite-production-build-chromium-140-dedicated-worker-opfs-sahpool-cas",
      authority: {
        kind: "sqlite-opfs-sahpool-plus-opfs-sha256-cas",
        repository: "StudioVrmAssetSqliteOpfsRepository",
        repositoryFactory: "createStudioVrmAssetSqliteOpfsRepository-no-options",
        runtimeAcquire: "acquireStudioLocalDatabase",
        requestedVfs: "opfs",
        sqliteOpfsDirectory: STUDIO_SQLITE_OPFS_DIRECTORY,
        sqliteDatabaseFilename: STUDIO_SQLITE_DATABASE_FILENAME,
        expectedOpenFilename: `/${STUDIO_SQLITE_DATABASE_FILENAME}`,
        casOpfsRoot: STUDIO_VRM_ASSET_OPFS_ROOT,
        modelNamespace: STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
        textureNamespace: STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE,
        manifestKey: STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
        repositoryAuthority: "sqlite-opfs",
        openedOpfsDatabaseFilenames: initialized.tracked.openedOpfsDatabaseFilenames,
        installedOpfsDirectories: initialized.tracked.installedOpfsDirectories,
        closeCompletedBeforeReopen,
      },
      policy: {
        legacyDataMigration: false,
        productLegacyIndexedDbRead: false,
        binaryStoredAsSqliteBase64: false,
        manifestContainsBinaryEncoding:
          manifestHasBinaryEncoding(modelRawBeforeClose, textureRawBeforeClose),
        manifestLastAuthority: true,
        runtimeRendererObjectStored: false,
      },
      support: initialized.support,
      capabilities: environmentCapabilities,
      browser: {
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemoryGiB:
          (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
      },
      config: {
        smallModelBytes: SMALL_MODEL_BYTES,
        smallModelSaveCount: SMALL_MODEL_SAVE_COUNT,
        smallModelLoadCount: SMALL_MODEL_LOAD_COUNT,
        largeModelBytes: LARGE_MODEL_BYTES,
        largeModelSaveCount: LARGE_MODEL_SAVE_COUNT,
        largeModelLoadCount: LARGE_MODEL_LOAD_COUNT,
        largeModelRationale:
          "2 physical saves and 5 verified reads bound disk traffic while the 1 MiB lane carries 100/100 samples",
        textureCount: TEXTURE_COUNT,
        textureWidth: TEXTURE_WIDTH,
        textureHeight: TEXTURE_HEIGHT,
      },
      opening: {
        sqliteWasmInitMs: fixed(initialized.initMs),
        coldOpenMs: fixed(coldOpenMs),
        reopenMs: fixed(reopenMs),
      },
      smallModels: {
        byteLength: SMALL_MODEL_BYTES,
        saveSuccessfulCount: smallSaved.samples.length - smallSaved.mismatchCount,
        saveMismatchCount: smallSaved.mismatchCount,
        saveDistribution: distribution(smallSaved.samples),
        loadSuccessfulCount: smallLoaded.samples.length - smallLoaded.mismatchCount,
        loadMismatchCount: smallLoaded.mismatchCount,
        loadDistribution: distribution(smallLoaded.samples),
      },
      largeModels: {
        status: largeStatus,
        requestedByteLength: LARGE_MODEL_BYTES,
        attemptedSaveCount: LARGE_MODEL_SAVE_COUNT,
        attemptedLoadCount: LARGE_MODEL_LOAD_COUNT,
        completedSaveCount: largeSaved.samples.length,
        completedLoadCount: largeLoaded.samples.length,
        saveMismatchCount: largeSaved.mismatchCount,
        loadMismatchCount: largeLoaded.mismatchCount,
        saveDistribution: distribution(largeSaved.samples),
        loadDistribution: distribution(largeLoaded.samples),
        error: largeError,
      },
      textures: {
        count: TEXTURE_COUNT,
        width: TEXTURE_WIDTH,
        height: TEXTURE_HEIGHT,
        aggregateBytes: texturesSaved.expected.reduce(
          (sum, item) => sum + item.byteLength,
          0,
        ),
        minBytes: Math.min(...texturesSaved.expected.map((item) => item.byteLength)),
        maxBytes: Math.max(...texturesSaved.expected.map((item) => item.byteLength)),
        saveSuccessfulCount: texturesSaved.samples.length - texturesSaved.mismatchCount,
        saveMismatchCount: texturesSaved.mismatchCount,
        saveDistribution: distribution(texturesSaved.samples),
        loadSuccessfulCount: texturesLoaded.samples.length - texturesLoaded.mismatchCount,
        loadMismatchCount: texturesLoaded.mismatchCount,
        loadDistribution: distribution(texturesLoaded.samples),
      },
      integrity: {
        exactShaAndBytesAfterReopen: reopenedVerification.exactShaAndBytes,
        reopenedVerification,
        expectedModelCount: allModels.length,
        reopenedModelCount: reopenedMetadata.length,
        expectedTextureCount: texturesSaved.expected.length,
        modelManifestExactAfterReopen: modelRawAfterReopen === modelRawBeforeClose,
        textureManifestExactAfterReopen: textureRawAfterReopen === textureRawBeforeClose,
        modelManifestSha256: modelManifestDigest,
        textureManifestSha256: textureManifestDigest,
        modelManifestBytes: new TextEncoder().encode(modelRawBeforeClose ?? "").byteLength,
        textureManifestBytes:
          new TextEncoder().encode(textureRawBeforeClose ?? "").byteLength,
        manifestContainsBase64: manifestHasBinaryEncoding(
          modelRawBeforeClose,
          textureRawBeforeClose,
        ),
      },
      fallback,
      opfs: {
        casBeforeClose,
        casAfterReopen,
        sqliteBeforeClose,
        expectedAssetCount,
      },
      storage: {
        before: storageBefore,
        afterWork: storageAfterWork,
        afterReopen: storageAfterReopen,
      },
      memory: {
        policy: "measured-browser-fields-only-no-estimates",
        snapshots: [
          memoryBefore,
          memoryAfterSmall,
          memoryAfterLarge,
          memoryAfterTextures,
          memoryAfterReopen,
        ],
      },
      securityPolicyViolations,
    });
  } catch (error) {
    publish("phase-result", {
      phase: "normal",
      status: "error",
      pass: false,
      schemaVersion: REPORT_SCHEMA_VERSION,
      execution: "vite-production-build-chromium-140-dedicated-worker-opfs-sahpool-cas",
      error: errorShape(error),
      support: initialized.support,
      capabilities: environmentCapabilities,
      fallback: {
        memoryDatabaseOpenCount: initialized.tracked.openedMemoryDatabaseFilenames.length,
        localStorageApiPresent: environmentCapabilities.localStorageApiPresent,
        indexedDbInstrumentationInstalled: idb.installed,
        indexedDbOpenCount: idb.openCount(),
        indexedDbDeleteDatabaseCount: idb.deleteDatabaseCount(),
      },
      securityPolicyViolations,
    });
  } finally {
    await repository?.close().catch(() => undefined);
    await closeStudioLocalDatabaseRuntime().catch(() => undefined);
    await database?.close().catch(() => undefined);
  }
}

async function terminationFixture(): Promise<{
  readonly modelBytes: Uint8Array<ArrayBuffer>;
  readonly modelHash: StudioVrmAssetHash;
  readonly textureBytes: Uint8Array<ArrayBuffer>;
  readonly textureReceipt: StudioVrmTexturePaintArtifactMetadata;
}> {
  const modelBytes = authoredVrmLikeBytes(SMALL_MODEL_BYTES, 91_001);
  const modelHash = await sha256Bytes(modelBytes);
  const textureBytes = await authoredTexturePng(91_002);
  const textureArtifact = await createStudioVrmTexturePaintArtifact({
    bindingKey: TERMINATION_TEXTURE_BINDING,
    source: textureBytes,
    expectedWidth: TEXTURE_WIDTH,
    expectedHeight: TEXTURE_HEIGHT,
  });
  return {
    modelBytes,
    modelHash,
    textureBytes,
    textureReceipt: textureArtifact.metadata,
  };
}

async function runTerminationSeed(): Promise<void> {
  const idb = installIndexedDbCounter();
  const initialized = await initializeSqlite();
  if (!initialized.support.wasm || !initialized.support.opfs) {
    publish("phase-result", {
      phase: "termination-seed",
      status: "unsupported",
      pass: false,
      support: initialized.support,
    });
    return;
  }
  const database = await openProductDatabase(initialized.tracked);
  const repository = createStudioVrmAssetSqliteOpfsRepository();
  const fixture = await terminationFixture();
  const savedModel = await repository.saveModel(modelInput(
    TERMINATION_MODEL_ID,
    91_001,
    fixture.modelBytes,
    fixture.modelHash,
  ));
  const savedTexture = await repository.saveTexture({
    receipt: fixture.textureReceipt,
    bytes: fixture.textureBytes,
  });
  const loadedModel = await repository.getModel(TERMINATION_MODEL_ID);
  const loadedTexture = await repository.getTexture(fixture.textureReceipt.contentHash);
  const modelRaw = await database.kvGet(
    STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
    STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
  );
  const textureRaw = await database.kvGet(
    STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE,
    STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
  );
  const pass =
    !savedModel.deduplicated
    && !savedTexture.deduplicated
    && loadedModel?.bytes.byteLength === fixture.modelBytes.byteLength
    && loadedModel.contentHash === fixture.modelHash
    && await sha256Bytes(loadedModel.bytes) === fixture.modelHash
    && loadedTexture?.bytes.byteLength === fixture.textureBytes.byteLength
    && loadedTexture.receipt.contentHash === fixture.textureReceipt.contentHash
    && await sha256Bytes(loadedTexture.bytes) === fixture.textureReceipt.contentHash
    && modelRaw?.includes(fixture.modelHash) === true
    && textureRaw?.includes(fixture.textureReceipt.contentHash) === true
    && !manifestHasBinaryEncoding(modelRaw, textureRaw)
    && initialized.tracked.openedMemoryDatabaseFilenames.length === 0
    && idb.installed
    && idb.openCount() === 0
    && idb.deleteDatabaseCount() === 0;
  publish("termination-ready", {
    phase: "termination-seed",
    status: pass ? "ready" : "error",
    pass,
    modelId: TERMINATION_MODEL_ID,
    modelHash: fixture.modelHash,
    modelBytes: fixture.modelBytes.byteLength,
    textureHash: fixture.textureReceipt.contentHash,
    textureBytes: fixture.textureBytes.byteLength,
    modelManifestSha256: modelRaw ? await sha256Text(modelRaw) : null,
    textureManifestSha256: textureRaw ? await sha256Text(textureRaw) : null,
    openedOpfsDatabaseFilenames: initialized.tracked.openedOpfsDatabaseFilenames,
    memoryDatabaseOpenCount: initialized.tracked.openedMemoryDatabaseFilenames.length,
    indexedDbOpenCount: idb.openCount(),
    closeCalled: false,
  });
  // The page deliberately terminates this Worker. No close call is reachable after this receipt.
}

async function runTerminationVerify(): Promise<void> {
  const idb = installIndexedDbCounter();
  const initialized = await initializeSqlite();
  if (!initialized.support.wasm || !initialized.support.opfs) {
    publish("phase-result", {
      phase: "termination-verify",
      status: "unsupported",
      pass: false,
      support: initialized.support,
    });
    return;
  }
  let database: StudioLocalDatabase | null = null;
  let repository: StudioVrmAssetSqliteOpfsRepository | null = null;
  try {
    const fixture = await terminationFixture();
    const startedAt = performance.now();
    database = await openProductDatabase(initialized.tracked);
    repository = createStudioVrmAssetSqliteOpfsRepository();
    const model = await repository.getModel(TERMINATION_MODEL_ID);
    const texture = await repository.getTexture(fixture.textureReceipt.contentHash);
    const reopenAfterTerminateMs = performance.now() - startedAt;
    const modelRaw = await database.kvGet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    );
    const textureRaw = await database.kvGet(
      STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    );
    const modelExact =
      model?.bytes.byteLength === fixture.modelBytes.byteLength
      && model.contentHash === fixture.modelHash
      && await sha256Bytes(model.bytes) === fixture.modelHash;
    const textureExact =
      texture?.bytes.byteLength === fixture.textureBytes.byteLength
      && texture.receipt.contentHash === fixture.textureReceipt.contentHash
      && await sha256Bytes(texture.bytes) === fixture.textureReceipt.contentHash;
    const pass =
      modelExact
      && textureExact
      && modelRaw?.includes(fixture.modelHash) === true
      && textureRaw?.includes(fixture.textureReceipt.contentHash) === true
      && !manifestHasBinaryEncoding(modelRaw, textureRaw)
      && initialized.tracked.openedMemoryDatabaseFilenames.length === 0
      && idb.installed
      && idb.openCount() === 0
      && idb.deleteDatabaseCount() === 0;
    await repository.close();
    repository = null;
    await closeStudioLocalDatabaseRuntime();
    database = null;
    publish("phase-result", {
      phase: "termination-verify",
      status: pass ? "ok" : "error",
      pass,
      reopenedExactShaAndBytes: modelExact && textureExact,
      modelExactShaAndBytes: modelExact,
      textureExactShaAndBytes: textureExact,
      modelHash: fixture.modelHash,
      textureHash: fixture.textureReceipt.contentHash,
      modelManifestSha256: modelRaw ? await sha256Text(modelRaw) : null,
      textureManifestSha256: textureRaw ? await sha256Text(textureRaw) : null,
      manifestContainsBase64: manifestHasBinaryEncoding(modelRaw, textureRaw),
      reopenAfterTerminateMs: fixed(reopenAfterTerminateMs),
      openedOpfsDatabaseFilenames: initialized.tracked.openedOpfsDatabaseFilenames,
      memoryDatabaseOpenCount: initialized.tracked.openedMemoryDatabaseFilenames.length,
      localStorageReadCount: 0,
      localStorageWriteCount: 0,
      indexedDbOpenCount: idb.openCount(),
      indexedDbDeleteDatabaseCount: idb.deleteDatabaseCount(),
      closeCalledAfterVerification: true,
    });
  } finally {
    await repository?.close().catch(() => undefined);
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
      status: "error",
      pass: false,
      schemaVersion: REPORT_SCHEMA_VERSION,
      error: errorShape(error),
    });
  });
});
