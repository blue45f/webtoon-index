/**
 * Dedicated Worker execution lanes for the BG3D SQLite/OPFS browser promotion benchmark.
 *
 * Product modules are dynamically imported only after ambient IndexedDB/localStorage probes are
 * installed. Every durable operation therefore exercises the same unsuffixed/default APIs shipped
 * to Studio, while any legacy fallback access becomes measured evidence instead of an assumption.
 */

const REPORT_SCHEMA_VERSION = 1;
const MODEL_READ_SAMPLE_COUNT = 100;
const OPTIONAL_100_MIB_READ_SAMPLE_COUNT = 5;
const TEMPLATE_OPERATION_SAMPLE_COUNT = 100;
const METADATA_OPERATION_SAMPLE_COUNT = 100;
const MIB = 1024 * 1024;
const BASE_EPOCH = 1_700_000_000_000;
const PRODUCT_LOCK_NAME = "toonspectrum-studio-bg3d-libraries-v12-write";

type JsonRecord = Record<string, unknown>;

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
    options?: { readonly create?: boolean },
  ): Promise<FileSystemDirectoryLike>;
  getFileHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<FileSystemFileLike>;
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

interface WorkerCommand {
  readonly id: string;
  readonly command:
    | "primary"
    | "crash-commit"
    | "recover-after-terminate"
    | "contention-hold"
    | "contention-write"
    | "verify-final";
  readonly payload?: JsonRecord;
}

interface LockRequestLike {
  <T>(
    name: string,
    options: { readonly mode: "exclusive" },
    callback: (lock: unknown) => Promise<T>,
  ): Promise<T>;
}

const fallbackProbe = {
  indexedDbAccessCount: 0,
  localStorageAccessCount: 0,
  indexedDbProbeInstalled: false,
  localStorageProbeInstalled: false,
};

const lockProbe = {
  instrumentationAvailable: false,
  requestCount: 0,
  waitsMs: [] as number[],
  holdMs: 0,
  closeInsideLock: null as (() => Promise<void>) | null,
};

function post(value: unknown): void {
  (globalThis as unknown as { postMessage(value: unknown): void }).postMessage(value);
}

function errorShape(error: unknown): JsonRecord {
  return error instanceof Error
    ? {
        name: error.name,
        message: error.message,
        stack: error.stack ?? null,
        cause: error.cause instanceof Error
          ? { name: error.cause.name, message: error.cause.message }
          : error.cause === undefined ? null : String(error.cause),
      }
    : { name: "NonError", message: String(error), stack: null, cause: null };
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function installFallbackProbes(): void {
  try {
    const originalIndexedDb = (globalThis as typeof globalThis & {
      indexedDB?: IDBFactory;
    }).indexedDB;
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      enumerable: true,
      get() {
        fallbackProbe.indexedDbAccessCount += 1;
        return originalIndexedDb;
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
          "BG3D benchmark forbids localStorage fallback",
          "SecurityError",
        );
      },
    });
    fallbackProbe.localStorageProbeInstalled = true;
  } catch {
    fallbackProbe.localStorageProbeInstalled = false;
  }
}

function installLockProbe(): void {
  const manager = (navigator as Navigator & {
    locks?: { request: LockRequestLike };
  }).locks;
  if (!manager || typeof manager.request !== "function") return;
  const original = manager.request.bind(manager) as LockRequestLike;
  const wrapped: LockRequestLike = async <T>(
    name: string,
    options: { readonly mode: "exclusive" },
    callback: (lock: unknown) => Promise<T>,
  ): Promise<T> => {
    if (name !== PRODUCT_LOCK_NAME) return original(name, options, callback);
    lockProbe.requestCount += 1;
    const requestedAt = performance.now();
    return original(name, options, async (lock) => {
      const waitMs = performance.now() - requestedAt;
      lockProbe.waitsMs.push(waitMs);
      post({ type: "progress", progress: "product-lock-acquired", waitMs: fixed(waitMs) });
      if (lockProbe.holdMs > 0) await delay(lockProbe.holdMs);
      const result = await callback(lock);
      await lockProbe.closeInsideLock?.();
      return result;
    });
  };
  try {
    Object.defineProperty(manager, "request", {
      configurable: true,
      value: wrapped,
    });
    lockProbe.instrumentationAvailable = true;
  } catch {
    lockProbe.instrumentationAvailable = false;
  }
}

installFallbackProbes();
installLockProbe();
post({ type: "ready" });

async function loadProductModules() {
  const [
    models,
    templates,
    metadata,
    scene,
    authority,
    localDatabase,
    runtime,
  ] = await Promise.all([
    import("../../../apps/web/src/domains/creator/bg3d/bg3d-model-library.ts"),
    import("../../../apps/web/src/domains/creator/bg3d/bg3d-template-library.test.ts"),
    import("../../../apps/web/src/domains/creator/bg3d/studio-bg3d-asset-metadata-store.ts"),
    import("../../../apps/web/src/domains/creator/bg3d/studio-bg3d-scene-document.test.ts"),
    import("../../../apps/web/src/domains/creator/bg3d/studio-bg3d-libraries-sqlite-opfs-authority.ts"),
    import("../../../apps/web/src/domains/creator/studio-local-database"),
    import("../../../apps/web/src/domains/creator/studio-local-database-runtime"),
  ]);
  return { models, templates, metadata, scene, authority, localDatabase, runtime };
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
}

function markerSeed(marker: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < marker.length; index += 1) {
    value ^= marker.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/** Builds an exact-size valid GLB 2.0 with a deterministic embedded BIN chunk. */
function deterministicGlb(totalBytes: number, marker: string): Uint8Array {
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 256 || totalBytes % 4 !== 0) {
    throw new RangeError("GLB target size must be a 4-byte aligned safe integer >= 256");
  }
  let binBytes = totalBytes - 256;
  let json = new Uint8Array();
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const encoded = new TextEncoder().encode(JSON.stringify({
      asset: { version: "2.0", generator: "ToonSpectrum BG3D OPFS benchmark" },
      scene: 0,
      scenes: [{}],
      buffers: [{ byteLength: binBytes }],
      bufferViews: [],
      extras: { marker },
    }));
    json = new Uint8Array(Math.ceil(encoded.byteLength / 4) * 4);
    json.fill(0x20);
    json.set(encoded);
    const nextBinBytes = totalBytes - 12 - 8 - json.byteLength - 8;
    if (nextBinBytes === binBytes) break;
    binBytes = nextBinBytes;
  }
  if (binBytes <= 0 || binBytes % 4 !== 0 || 28 + json.byteLength + binBytes !== totalBytes) {
    throw new Error("unable to construct an exact-size deterministic GLB");
  }
  const result = new Uint8Array(totalBytes);
  writeUint32(result, 0, 0x46546c67);
  writeUint32(result, 4, 2);
  writeUint32(result, 8, totalBytes);
  writeUint32(result, 12, json.byteLength);
  writeUint32(result, 16, 0x4e4f534a);
  result.set(json, 20);
  const binHeader = 20 + json.byteLength;
  writeUint32(result, binHeader, binBytes);
  writeUint32(result, binHeader + 4, 0x004e4942);
  const block = new Uint8Array(Math.min(64 * 1024, binBytes));
  let state = markerSeed(marker);
  for (let index = 0; index < block.byteLength; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    block[index] = state >>> 24;
  }
  for (let offset = binHeader + 8; offset < result.byteLength; offset += block.byteLength) {
    result.set(block.subarray(0, Math.min(block.byteLength, result.byteLength - offset)), offset);
  }
  return result;
}

async function sha256Bytes(bytes: Uint8Array): Promise<`sha256:${string}`> {
  const source = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    && bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer
    : Uint8Array.from(bytes).buffer;
  const digest = await crypto.subtle.digest("SHA-256", source);
  const hex = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return `sha256:${hex}`;
}

async function sha256Text(value: string): Promise<`sha256:${string}`> {
  return sha256Bytes(new TextEncoder().encode(value));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function thumbnailPng(): Uint8Array {
  const bytes = new Uint8Array(58);
  const view = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  view.setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, 320, false);
  view.setUint32(20, 180, false);
  bytes.set([8, 6, 0, 0, 0], 24);
  view.setUint32(33, 1, false);
  bytes.set([0x49, 0x44, 0x41, 0x54], 37);
  bytes[41] = 0;
  bytes.set([0x49, 0x45, 0x4e, 0x44], 50);
  const crc32 = (start: number, end: number): number => {
    let crc = 0xffff_ffff;
    for (let offset = start; offset < end; offset += 1) {
      crc ^= bytes[offset] ?? 0;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb8_8320 : 0);
      }
    }
    return (crc ^ 0xffff_ffff) >>> 0;
  };
  view.setUint32(29, crc32(12, 29), false);
  view.setUint32(42, crc32(37, 42), false);
  view.setUint32(54, crc32(50, 54), false);
  return bytes;
}

function dataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mime};base64,${btoa(binary)}`;
}

async function memorySnapshot(): Promise<JsonRecord> {
  const measuredPerformance = performance as BrowserMemoryPerformance;
  let userAgentSpecific: JsonRecord | null = null;
  if (typeof measuredPerformance.measureUserAgentSpecificMemory === "function") {
    try {
      const measured = await measuredPerformance.measureUserAgentSpecificMemory();
      userAgentSpecific = {
        bytes: measured.bytes,
        breakdownEntryCount: measured.breakdown?.length ?? null,
      };
    } catch {
      userAgentSpecific = null;
    }
  }
  return {
    performanceMemory: measuredPerformance.memory
      ? {
          usedJSHeapSizeBytes: measuredPerformance.memory.usedJSHeapSize,
          totalJSHeapSizeBytes: measuredPerformance.memory.totalJSHeapSize,
          jsHeapSizeLimitBytes: measuredPerformance.memory.jsHeapSizeLimit,
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
      entries.push({ path, kind: "file", bytes: (await (entry as FileSystemFileLike).getFile()).size });
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
  };
}

async function readOpfsFile(path: string): Promise<Uint8Array | null> {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  let directory = await navigator.storage.getDirectory() as unknown as FileSystemDirectoryLike;
  try {
    for (const segment of segments.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(segment);
    }
    const handle = await directory.getFileHandle(segments.at(-1)!);
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  } catch {
    return null;
  }
}

function fallbackReceipt(): JsonRecord {
  return {
    indexedDbAccessCount: fallbackProbe.indexedDbAccessCount,
    localStorageAccessCount: fallbackProbe.localStorageAccessCount,
    memoryDatabaseOpenCount: 0,
    memoryAssetStoreCount: 0,
    indexedDbProbeInstalled: fallbackProbe.indexedDbProbeInstalled,
    localStorageProbeInstalled: fallbackProbe.localStorageProbeInstalled,
  };
}

function lockReceipt(): JsonRecord {
  return {
    instrumentationAvailable: lockProbe.instrumentationAvailable,
    requestCount: lockProbe.requestCount,
    waitsMs: lockProbe.waitsMs.map((sample) => fixed(sample)),
    maxWaitMs: fixed(Math.max(0, ...lockProbe.waitsMs)),
    configuredHoldMs: lockProbe.holdMs,
  };
}

async function runPrimary(): Promise<JsonRecord> {
  const product = await loadProductModules();
  const capabilities = {
    secureContext: globalThis.isSecureContext,
    crossOriginIsolated: globalThis.crossOriginIsolated,
    navigatorStorageGetDirectory: typeof navigator.storage?.getDirectory === "function",
    syncAccessHandle:
      typeof globalThis.FileSystemFileHandle?.prototype?.createSyncAccessHandle === "function",
    webLocks: typeof (navigator as Navigator & { locks?: unknown }).locks === "object",
    cryptoSubtle: typeof crypto.subtle?.digest === "function",
  };
  if (
    !capabilities.navigatorStorageGetDirectory
    || !capabilities.syncAccessHandle
    || !capabilities.webLocks
  ) {
    return {
      status: "unsupported",
      pass: false,
      schemaVersion: REPORT_SCHEMA_VERSION,
      reason: "required OPFS SAH-pool or Web Locks capability is unavailable",
      support: { wasm: null, opfs: false, evidence: "pre-open capability gate" },
      capabilities,
      fallback: fallbackReceipt(),
    };
  }

  const storageBefore = await storageSnapshot();
  const memoryBefore = await memorySnapshot();
  const openStartedAt = performance.now();
  const database = await product.runtime.acquireStudioLocalDatabase();
  const coldOpenMs = performance.now() - openStartedAt;
  const support = {
    wasm: true,
    opfs: true,
    evidence: "actual acquireStudioLocalDatabase() OPFS SAH-pool open succeeded",
  };
  const manifestKeys = product.authority.STUDIO_BG3D_LIBRARY_MANIFEST_KEYS;
  const namespace = product.authority.STUDIO_BG3D_LIBRARIES_SQLITE_NAMESPACE;
  const initialManifests = await Promise.all([
    database.kvGet(namespace, manifestKeys.models),
    database.kvGet(namespace, manifestKeys.templates),
    database.kvGet(namespace, manifestKeys.metadata),
  ]);
  if (initialManifests.some((manifest) => manifest !== null)) {
    throw new Error("benchmark origin was not backed by a fresh BG3D V12 manifest set");
  }

  const deviceMemoryGiB = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null;
  const availableBytes = typeof storageBefore.availableBytes === "number"
    ? storageBefore.availableBytes
    : null;
  const run100MiB = deviceMemoryGiB !== null
    && deviceMemoryGiB >= 8
    && availableBytes !== null
    && availableBytes >= 768 * MIB;
  const specifications = [
    { id: "benchmark-model-1mib", marker: "bg3d-opfs-1mib-v1", bytes: 1 * MIB },
    { id: "benchmark-model-32mib", marker: "bg3d-opfs-32mib-v1", bytes: 32 * MIB },
    ...(run100MiB
      ? [{ id: "benchmark-model-100mib", marker: "bg3d-opfs-100mib-v1", bytes: 100 * MIB }]
      : []),
  ];
  const modelWrites: JsonRecord[] = [];
  for (const [index, specification] of specifications.entries()) {
    const source = deterministicGlb(specification.bytes, specification.marker);
    const expectedHash = await sha256Bytes(source);
    const file = new File([source.buffer], `${specification.id}.glb`, {
      type: product.localDatabase.STUDIO_SQLITE_DATABASE_FILENAME === "studio-local-v12.db"
        ? "model/gltf-binary"
        : "application/octet-stream",
    });
    const startedAt = performance.now();
    const saved = await product.models.saveUploadedBg3dModel(file, {
      profile: "desktop",
      idFactory: () => specification.id,
      now: BASE_EPOCH + index,
    });
    const elapsed = performance.now() - startedAt;
    const returned = new Uint8Array(await saved.blob.arrayBuffer());
    modelWrites.push({
      id: specification.id,
      marker: specification.marker,
      bytes: specification.bytes,
      expectedHash,
      storedHash: saved.contentHash,
      returnedBytes: returned.byteLength,
      exactBytes: equalBytes(source, returned),
      ms: fixed(elapsed),
    });
  }

  const firstModel = modelWrites[0];
  if (!firstModel || typeof firstModel.id !== "string") throw new Error("1 MiB model was not saved");
  const thumbnail = thumbnailPng();
  const thumbnailHash = await sha256Bytes(thumbnail);
  const thumbnailStartedAt = performance.now();
  await product.models.saveBg3dModelThumbnail(
    firstModel.id,
    dataUrl(thumbnail, "image/png"),
    { now: BASE_EPOCH + 50, captureRevision: (BASE_EPOCH + 50) * 1_024 },
  );
  const thumbnailWriteMs = performance.now() - thumbnailStartedAt;

  const metadataHashes: string[] = [];
  const metadataWriteSamples: number[] = [];
  for (let index = 0; index < METADATA_OPERATION_SAMPLE_COUNT; index += 1) {
    const hash = await sha256Text(`bg3d-browser-metadata-${String(index).padStart(3, "0")}`);
    metadataHashes.push(hash);
    const candidate = {
      version: 2 as const,
      contentHash: hash,
      name: `브라우저 메타데이터 ${String(index).padStart(3, "0")}`,
      format: "glb" as const,
      createdAt: BASE_EPOCH + 1_000 + index,
      updatedAt: BASE_EPOCH + 1_000 + index,
      byteSize: 1_024 + index,
      triangles: index,
      textures: index % 8,
      favorite: index % 7 === 0,
      collections: [],
      tags: [`browser-${index % 5}`],
      rights: {
        status: "owned" as const,
        commercialUse: true,
        teamShareAllowed: false,
      },
    };
    const startedAt = performance.now();
    await product.metadata.putStudioBg3dAssetMetadataAtomically([candidate]);
    metadataWriteSamples.push(performance.now() - startedAt);
  }

  const templateWriteSamples: number[] = [];
  const templateDocument = product.scene.createDefaultStudioBg3dSceneDocument();
  for (let index = 0; index < TEMPLATE_OPERATION_SAMPLE_COUNT; index += 1) {
    const startedAt = performance.now();
    await product.templates.saveBg3dTemplate({
      id: `browser-template-${String(index).padStart(3, "0")}`,
      name: `브라우저 템플릿 ${String(index).padStart(3, "0")}`,
      createdAt: BASE_EPOCH + 2_000 + index,
      document: templateDocument,
    });
    templateWriteSamples.push(performance.now() - startedAt);
  }

  await product.runtime.closeStudioLocalDatabaseRuntime();
  const reopenStartedAt = performance.now();
  const reopenedDatabase = await product.runtime.acquireStudioLocalDatabase();
  const reopenMs = performance.now() - reopenStartedAt;
  const rawModels = await reopenedDatabase.kvGet(namespace, manifestKeys.models);
  const rawTemplates = await reopenedDatabase.kvGet(namespace, manifestKeys.templates);
  const rawMetadata = await reopenedDatabase.kvGet(namespace, manifestKeys.metadata);
  const rawManifests = [rawModels, rawTemplates, rawMetadata];
  if (rawManifests.some((manifest) => manifest === null)) {
    throw new Error("normal close/reopen lost one or more BG3D manifests");
  }
  const canonicalManifests = rawManifests.every((manifest) => {
    if (manifest === null) return false;
    try {
      return JSON.stringify(JSON.parse(manifest)) === manifest;
    } catch {
      return false;
    }
  });
  const manifestContainsBase64 = rawManifests.some((manifest) =>
    /(?:;base64,|data:application|data:image)/iu.test(manifest ?? ""));

  const readReceipts: JsonRecord[] = [];
  for (const write of modelWrites) {
    const bytes = Number(write.bytes);
    const hash = String(write.expectedHash);
    const sampleCount = bytes === 100 * MIB
      ? OPTIONAL_100_MIB_READ_SAMPLE_COUNT
      : MODEL_READ_SAMPLE_COUNT;
    const samples: number[] = [];
    let mismatchCount = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      const startedAt = performance.now();
      const record = await product.models.getStoredBg3dModelByHash(hash);
      if (!record) {
        mismatchCount += 1;
        samples.push(performance.now() - startedAt);
        continue;
      }
      const hydrated = new Uint8Array(await record.blob.arrayBuffer());
      samples.push(performance.now() - startedAt);
      if (record.contentHash !== hash || hydrated.byteLength !== bytes) mismatchCount += 1;
      if (index === 0) {
        const source = deterministicGlb(bytes, String(write.marker));
        if (!equalBytes(source, hydrated) || await sha256Bytes(hydrated) !== hash) mismatchCount += 1;
      }
    }
    readReceipts.push({ id: write.id, bytes, hash, mismatchCount, distribution: distribution(samples) });
  }

  const metadataReadSamples: number[] = [];
  let metadataReadMismatchCount = 0;
  for (let index = 0; index < METADATA_OPERATION_SAMPLE_COUNT; index += 1) {
    const hash = metadataHashes[index] ?? "";
    const startedAt = performance.now();
    const candidate = await product.metadata.getStudioBg3dAssetMetadata(hash);
    metadataReadSamples.push(performance.now() - startedAt);
    if (candidate?.contentHash !== hash) metadataReadMismatchCount += 1;
  }

  const templateReadSamples: number[] = [];
  let templateReadMismatchCount = 0;
  for (let index = 0; index < TEMPLATE_OPERATION_SAMPLE_COUNT; index += 1) {
    const startedAt = performance.now();
    const entries = await product.templates.listBg3dTemplates();
    templateReadSamples.push(performance.now() - startedAt);
    if (entries.length !== TEMPLATE_OPERATION_SAMPLE_COUNT) templateReadMismatchCount += 1;
  }

  const cachedThumbnail = await product.models.getCachedBg3dModelThumbnail(firstModel.id);
  const thumbnailExact = cachedThumbnail === dataUrl(thumbnail, "image/png");
  const opfs = await inspectOpfs();
  const casIndexBytes = await readOpfsFile(
    `${product.authority.STUDIO_BG3D_LIBRARIES_OPFS_ROOT}/index.json`,
  );
  const casIndexText = casIndexBytes ? new TextDecoder().decode(casIndexBytes) : null;
  const casIndexContainsBase64 = /(?:;base64,|data:application|data:image)/iu.test(casIndexText ?? "");
  const physicalBlobReceipts: JsonRecord[] = [];
  for (const write of modelWrites) {
    const hash = String(write.expectedHash);
    const physical = await readOpfsFile(
      `${product.authority.STUDIO_BG3D_LIBRARIES_OPFS_ROOT}/blobs/${hash.slice(7)}.bin`,
    );
    physicalBlobReceipts.push({
      hash,
      expectedBytes: write.bytes,
      physicalBytes: physical?.byteLength ?? null,
      physicalHash: physical ? await sha256Bytes(physical) : null,
      exact: physical !== null
        && physical.byteLength === write.bytes
        && await sha256Bytes(physical) === hash,
    });
  }
  const physicalThumbnail = await readOpfsFile(
    `${product.authority.STUDIO_BG3D_LIBRARIES_OPFS_ROOT}/blobs/${thumbnailHash.slice(7)}.bin`,
  );
  physicalBlobReceipts.push({
    hash: thumbnailHash,
    expectedBytes: thumbnail.byteLength,
    physicalBytes: physicalThumbnail?.byteLength ?? null,
    physicalHash: physicalThumbnail ? await sha256Bytes(physicalThumbnail) : null,
    exact: physicalThumbnail !== null && equalBytes(physicalThumbnail, thumbnail),
  });

  const metadataList = await product.metadata.listStudioBg3dAssetMetadata();
  const templateList = await product.templates.listBg3dTemplates();
  const modelList = await product.models.listStoredBg3dModels();
  const storageAfter = await storageSnapshot();
  const memoryAfter = await memorySnapshot();
  await product.runtime.closeStudioLocalDatabaseRuntime();

  const fallback = fallbackReceipt();
  const pass =
    modelWrites.every((write) => write.expectedHash === write.storedHash
      && write.bytes === write.returnedBytes && write.exactBytes === true)
    && readReceipts.every((receipt) => receipt.mismatchCount === 0)
    && physicalBlobReceipts.every((receipt) => receipt.exact === true)
    && thumbnailExact
    && canonicalManifests
    && !manifestContainsBase64
    && !casIndexContainsBase64
    && metadataList.length === METADATA_OPERATION_SAMPLE_COUNT
    && templateList.length === TEMPLATE_OPERATION_SAMPLE_COUNT
    && modelList.length === modelWrites.length
    && metadataReadMismatchCount === 0
    && templateReadMismatchCount === 0
    && fallback.indexedDbAccessCount === 0
    && fallback.localStorageAccessCount === 0
    && fallback.memoryDatabaseOpenCount === 0
    && fallback.memoryAssetStoreCount === 0;

  return {
    status: pass ? "ok" : "error",
    pass,
    schemaVersion: REPORT_SCHEMA_VERSION,
    execution: "vite-production-build-chromium-dedicated-worker-opfs-sahpool",
    authority: {
      kind: "sqlite-opfs-sha256-cas",
      requestedVfs: "opfs",
      sqlitePackage: "@sqlite.org/sqlite-wasm 3.53.0-build1",
      sqliteOpfsDirectory: product.localDatabase.STUDIO_SQLITE_OPFS_DIRECTORY,
      sqliteFilename: product.localDatabase.STUDIO_SQLITE_DATABASE_FILENAME,
      casOpfsRoot: product.authority.STUDIO_BG3D_LIBRARIES_OPFS_ROOT,
      manifestNamespace: namespace,
      normalCloseCompletedBeforeReopen: true,
      coldOpenMs: fixed(coldOpenMs),
      reopenMs: fixed(reopenMs),
    },
    support,
    capabilities,
    browser: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGiB,
    },
    config: {
      modelReadSampleCount: MODEL_READ_SAMPLE_COUNT,
      optional100MiBReadSampleCount: OPTIONAL_100_MIB_READ_SAMPLE_COUNT,
      metadataOperationSampleCount: METADATA_OPERATION_SAMPLE_COUNT,
      templateOperationSampleCount: TEMPLATE_OPERATION_SAMPLE_COUNT,
      ran100MiB: run100MiB,
      skipped100MiBReason: run100MiB
        ? null
        : "deviceMemory/quota evidence did not prove a safe >=768 MiB headroom",
    },
    models: {
      writes: modelWrites,
      writeDistribution: distribution(modelWrites.map((write) => Number(write.ms))),
      reads: readReceipts,
      thumbnail: {
        modelId: firstModel.id,
        bytes: thumbnail.byteLength,
        hash: thumbnailHash,
        writeMs: fixed(thumbnailWriteMs),
        exactAfterReopen: thumbnailExact,
      },
      physicalCas: physicalBlobReceipts,
    },
    templates: {
      count: templateList.length,
      writeDistribution: distribution(templateWriteSamples),
      listDistribution: distribution(templateReadSamples),
      mismatchCount: templateReadMismatchCount,
    },
    metadata: {
      count: metadataList.length,
      writeDistribution: distribution(metadataWriteSamples),
      getDistribution: distribution(metadataReadSamples),
      mismatchCount: metadataReadMismatchCount,
    },
    manifests: {
      modelBytes: new TextEncoder().encode(rawModels ?? "").byteLength,
      templateBytes: new TextEncoder().encode(rawTemplates ?? "").byteLength,
      metadataBytes: new TextEncoder().encode(rawMetadata ?? "").byteLength,
      canonical: canonicalManifests,
      containsBase64OrDataUrl: manifestContainsBase64,
      casIndexContainsBase64OrDataUrl: casIndexContainsBase64,
    },
    fallback,
    locks: lockReceipt(),
    opfs,
    storage: { before: storageBefore, after: storageAfter },
    memory: { before: memoryBefore, after: memoryAfter },
    infeasibleDimensions: [
      "100 independent 32 MiB physical writes were not run: that would create >=3.2 GiB of intentional benchmark data; one real write plus 100 verified CAS reads was used.",
      "100 independent 100 MiB physical writes were not run: that would create >=10 GiB of intentional benchmark data.",
      "browser-process or OS power-loss injection is not equivalent to the Dedicated Worker terminate gate and remains unmeasured.",
      "memory values are null when Chromium does not expose the corresponding API; no estimate is substituted.",
    ],
  };
}

async function runCrashCommit(): Promise<JsonRecord> {
  const product = await loadProductModules();
  const bytes = deterministicGlb(1 * MIB, "bg3d-opfs-worker-terminate-v1");
  const expectedHash = await sha256Bytes(bytes);
  const startedAt = performance.now();
  const saved = await product.models.saveUploadedBg3dModel(
    new File([bytes.buffer], "benchmark-worker-terminate.glb", { type: "model/gltf-binary" }),
    {
      profile: "desktop",
      idFactory: () => "benchmark-model-worker-terminate",
      now: BASE_EPOCH + 9_000,
    },
  );
  await product.runtime.acquireStudioLocalDatabase();
  return {
    status: saved.contentHash === expectedHash ? "ready-for-terminate" : "error",
    pass: saved.contentHash === expectedHash,
    id: saved.id,
    bytes: bytes.byteLength,
    hash: expectedHash,
    commitMs: fixed(performance.now() - startedAt),
    databaseIntentionallyLeftOpen: true,
    fallback: fallbackReceipt(),
    locks: lockReceipt(),
  };
}

async function runRecovery(payload: JsonRecord): Promise<JsonRecord> {
  const expectedHash = String(payload.hash ?? "");
  const expectedBytes = Number(payload.bytes ?? 0);
  const product = await loadProductModules();
  const startedAt = performance.now();
  const recovered = await product.models.getStoredBg3dModelByHash(expectedHash);
  const hydrated = recovered
    ? new Uint8Array(await recovered.blob.arrayBuffer())
    : null;
  const digest = hydrated ? await sha256Bytes(hydrated) : null;
  const elapsed = performance.now() - startedAt;
  const pass = recovered !== null
    && recovered.contentHash === expectedHash
    && hydrated?.byteLength === expectedBytes
    && digest === expectedHash;
  await product.runtime.closeStudioLocalDatabaseRuntime();
  return {
    status: pass ? "ok" : "error",
    pass,
    reopenAndReadMs: fixed(elapsed),
    hash: digest,
    bytes: hydrated?.byteLength ?? null,
    exactHashAndBytes: pass,
    fallback: fallbackReceipt(),
    locks: lockReceipt(),
  };
}

async function runContention(payload: JsonRecord): Promise<JsonRecord> {
  const workerId = String(payload.workerId ?? "unknown");
  lockProbe.holdMs = Number(payload.holdMs ?? 0);
  const product = await loadProductModules();
  lockProbe.closeInsideLock = product.runtime.closeStudioLocalDatabaseRuntime;
  const hash = await sha256Text(`bg3d-browser-contention-${workerId}`);
  const candidate = {
    version: 2 as const,
    contentHash: hash,
    name: `경합 메타데이터 ${workerId}`,
    format: "glb" as const,
    createdAt: BASE_EPOCH + 10_000 + (workerId === "a" ? 1 : 2),
    updatedAt: BASE_EPOCH + 10_000 + (workerId === "a" ? 1 : 2),
    byteSize: 2_048,
    triangles: 0,
    textures: 0,
    favorite: false,
    collections: [],
    tags: ["contention"],
    rights: {
      status: "owned" as const,
      commercialUse: true,
      teamShareAllowed: false,
    },
  };
  const startedAt = performance.now();
  await product.metadata.putStudioBg3dAssetMetadataAtomically([candidate]);
  const elapsed = performance.now() - startedAt;
  return {
    status: "ok",
    pass: true,
    workerId,
    hash,
    elapsedMs: fixed(elapsed),
    closeCompletedInsideMeasuredProductLock: true,
    fallback: fallbackReceipt(),
    locks: lockReceipt(),
  };
}

async function runContentionHold(payload: JsonRecord): Promise<JsonRecord> {
  const holdMs = Number(payload.holdMs ?? 0);
  if (!Number.isFinite(holdMs) || holdMs < 0) throw new RangeError("invalid lock hold duration");
  lockProbe.holdMs = holdMs;
  const manager = (navigator as Navigator & {
    locks?: { request: LockRequestLike };
  }).locks;
  if (!manager || typeof manager.request !== "function") {
    return {
      status: "unsupported",
      pass: false,
      reason: "Web Locks is unavailable in this Dedicated Worker",
      fallback: fallbackReceipt(),
      locks: lockReceipt(),
    };
  }
  const startedAt = performance.now();
  await manager.request(PRODUCT_LOCK_NAME, { mode: "exclusive" }, async () => undefined);
  return {
    status: "ok",
    pass: true,
    role: "dedicated-worker-product-lock-holder",
    elapsedMs: fixed(performance.now() - startedAt),
    fallback: fallbackReceipt(),
    locks: lockReceipt(),
  };
}

async function runFinalVerification(payload: JsonRecord): Promise<JsonRecord> {
  const product = await loadProductModules();
  const expectedModelHashes = Array.isArray(payload.modelHashes)
    ? payload.modelHashes.map(String)
    : [];
  const expectedContentionHashes = Array.isArray(payload.contentionHashes)
    ? payload.contentionHashes.map(String)
    : [];
  const models = await product.models.listStoredBg3dModels();
  const templates = await product.templates.listBg3dTemplates();
  const metadata = await product.metadata.listStudioBg3dAssetMetadata();
  const modelHashes = models.map(({ contentHash }) => contentHash).sort();
  const metadataHashes = new Set(metadata.map(({ contentHash }) => contentHash));
  const database = await product.runtime.acquireStudioLocalDatabase();
  const namespace = product.authority.STUDIO_BG3D_LIBRARIES_SQLITE_NAMESPACE;
  const keys = product.authority.STUDIO_BG3D_LIBRARY_MANIFEST_KEYS;
  const manifests = await Promise.all([
    database.kvGet(namespace, keys.models),
    database.kvGet(namespace, keys.templates),
    database.kvGet(namespace, keys.metadata),
  ]);
  const noBase64 = manifests.every((manifest) =>
    manifest !== null && !/(?:;base64,|data:application|data:image)/iu.test(manifest));
  const expectedModelsPresent = expectedModelHashes.every((hash) => modelHashes.includes(hash));
  const contentionWritesPresent = expectedContentionHashes.every((hash) => metadataHashes.has(hash));
  const pass = expectedModelsPresent
    && contentionWritesPresent
    && templates.length === TEMPLATE_OPERATION_SAMPLE_COUNT
    && metadata.length === METADATA_OPERATION_SAMPLE_COUNT + expectedContentionHashes.length
    && noBase64;
  await product.runtime.closeStudioLocalDatabaseRuntime();
  return {
    status: pass ? "ok" : "error",
    pass,
    modelCount: models.length,
    templateCount: templates.length,
    metadataCount: metadata.length,
    expectedModelsPresent,
    contentionWritesPresent,
    manifestsContainNoBase64: noBase64,
    fallback: fallbackReceipt(),
    locks: lockReceipt(),
  };
}

async function execute(command: WorkerCommand): Promise<JsonRecord> {
  switch (command.command) {
    case "primary":
      return runPrimary();
    case "crash-commit":
      return runCrashCommit();
    case "recover-after-terminate":
      return runRecovery(command.payload ?? {});
    case "contention-hold":
      return runContentionHold(command.payload ?? {});
    case "contention-write":
      return runContention(command.payload ?? {});
    case "verify-final":
      return runFinalVerification(command.payload ?? {});
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
        locks: lockReceipt(),
      },
    }),
  );
});
