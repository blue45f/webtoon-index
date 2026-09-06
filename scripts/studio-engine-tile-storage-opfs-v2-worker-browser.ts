/**
 * Real Chromium Dedicated Worker boundary for the OPFS v2 shard backend.
 *
 * This module intentionally calls the production backend and storage worker. Its only adapter is
 * a transparent capability counter around native OPFS handles so the verifier can prove that
 * getDirectory/createSyncAccessHandle were used and that no fallback API was touched.
 */

import {
  STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
  STUDIO_ENGINE_TILE_ENCODING,
  studioEngineRgba16FloatTileDigest,
} from "../apps/web/src/domains/creator/render/studio-engine-tile-authority";
import {
  STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION,
  STUDIO_ENGINE_TILE_STORAGE_REQUEST_KIND,
  type StudioEngineTileStorageCommitAck,
  type StudioEngineTileStorageCommitRequest,
} from "../apps/web/src/domains/creator/render/studio-engine-tile-storage-bridge";
import {
  createStudioEngineTileStorageOpfsV2Backend,
  STUDIO_ENGINE_TILE_STORAGE_OPFS_V2_ROOT_NAME,
  StudioEngineTileStorageOpfsV2BackendError,
  type StudioEngineTileStorageOpfsV2DirectoryHandleLike,
  type StudioEngineTileStorageOpfsV2FileHandleLike,
  type StudioEngineTileStorageOpfsV2SyncAccessHandleLike,
} from "../apps/web/src/domains/creator/render/studio-engine-tile-storage-opfs-v2-backend";
import {
  StudioEngineTileStorageWorkerV2,
  type StudioEngineTileStorageWorkerV2FaultStage,
  type StudioEngineTileStorageWorkerV2Frontier,
  type StudioEngineTileStorageWorkerV2Lease,
  type StudioEngineTileStorageWorkerV2LeasePort,
  type StudioEngineTileStorageWorkerV2RecoveryResult,
} from "../apps/web/src/domains/creator/render/studio-engine-tile-storage-worker-v2";
import { studioTileDocDigest } from "../apps/web/src/domains/creator/render/studio-tiledoc-digest";
import {
  canonicalStudioCommandJson,
  studioCommandPayloadChecksum,
  type StudioCommandJsonValue,
} from "../apps/web/src/domains/creator/studio-command-journal";

const workerScope = self as DedicatedWorkerGlobalScope;
const encoder = new TextEncoder();
const DIRECT_SHARD_BYTES = BigInt(32);
const RECOVERY_SHARD_BYTES = BigInt(256);
const SESSION_EPOCH = 7;
const LEASE_EPOCH = 1;

interface NativeCounters {
  getDirectoryCalls: number;
  getDirectoryHandleCalls: number;
  getFileHandleCalls: number;
  createSyncAccessHandleCalls: number;
  createWritableCalls: number;
  indexedDbAccesses: number;
  memoryFallbackFactoryCalls: number;
}

interface ErrorEvidence {
  readonly name: string;
  readonly code: string | null;
  readonly message: string;
  readonly causeName: string | null;
}

interface WorkerCommand {
  readonly type:
    | "run-main"
    | "hold-lock"
    | "release-lock"
    | "probe-lock"
    | "begin-crash-after-wal"
    | "recover-crash"
    | "cleanup";
  readonly requestId: number;
  readonly runId: string;
  readonly documentId?: string;
}

interface WorkerResultMessage {
  readonly type:
    | "result"
    | "lock-held"
    | "lock-released"
    | "wal-flushed"
    | "failure";
  readonly requestId: number;
  readonly result?: unknown;
  readonly error?: ErrorEvidence;
}

class BrowserLeasePort implements StudioEngineTileStorageWorkerV2LeasePort {
  public acquire(
    input: Readonly<{
      documentId: string;
      ownerId: string;
      leaseEpoch: number;
      signal: AbortSignal;
    }>,
  ): StudioEngineTileStorageWorkerV2Lease {
    if (input.signal.aborted) throw input.signal.reason;
    return Object.freeze({
      documentId: input.documentId,
      ownerId: input.ownerId,
      leaseEpoch: input.leaseEpoch,
      token: `browser-lease:${input.documentId}:${input.leaseEpoch}`,
    });
  }

  public assert(
    _lease: StudioEngineTileStorageWorkerV2Lease,
    signal: AbortSignal,
  ): void {
    if (signal.aborted) throw signal.reason;
  }

  public release(): void {}
}

let heldLockBackend: Awaited<
  ReturnType<typeof createStudioEngineTileStorageOpfsV2Backend>
> | null = null;

function counters(): NativeCounters {
  return {
    getDirectoryCalls: 0,
    getDirectoryHandleCalls: 0,
    getFileHandleCalls: 0,
    createSyncAccessHandleCalls: 0,
    createWritableCalls: 0,
    indexedDbAccesses: 0,
    memoryFallbackFactoryCalls: 0,
  };
}

function errorEvidence(error: unknown): ErrorEvidence {
  const cause = (
    typeof error === "object"
    && error !== null
    && "cause" in error
  )
    ? (error as { readonly cause?: unknown }).cause
    : null;
  return {
    name: error instanceof Error ? error.name : typeof error,
    code: (
      typeof error === "object"
      && error !== null
      && "code" in error
      && typeof (error as { readonly code?: unknown }).code === "string"
    )
      ? (error as { readonly code: string }).code
      : null,
    message: error instanceof Error ? error.message : String(error),
    causeName: cause instanceof Error ? cause.name : null,
  };
}

function post(message: WorkerResultMessage): void {
  workerScope.postMessage(message);
}

function nativeHandleAdapter(
  handle: FileSystemSyncAccessHandle,
): StudioEngineTileStorageOpfsV2SyncAccessHandleLike {
  return {
    getSize: () => handle.getSize(),
    read: (buffer, options) => handle.read(buffer, options),
    write: (buffer, options) => handle.write(buffer, options),
    flush: () => handle.flush(),
    truncate: size => handle.truncate(size),
    close: () => handle.close(),
  };
}

function instrumentDirectory(
  directory: FileSystemDirectoryHandle,
  observed: NativeCounters,
): StudioEngineTileStorageOpfsV2DirectoryHandleLike {
  return {
    async getDirectoryHandle(name, options) {
      observed.getDirectoryHandleCalls += 1;
      return instrumentDirectory(
        await directory.getDirectoryHandle(name, options),
        observed,
      );
    },
    async getFileHandle(name, options) {
      observed.getFileHandleCalls += 1;
      const file = await directory.getFileHandle(name, options);
      const wrapped: StudioEngineTileStorageOpfsV2FileHandleLike & {
        createWritable?: (...args: Parameters<FileSystemFileHandle["createWritable"]>) =>
        ReturnType<FileSystemFileHandle["createWritable"]>;
      } = {
        async createSyncAccessHandle() {
          observed.createSyncAccessHandleCalls += 1;
          return nativeHandleAdapter(await file.createSyncAccessHandle());
        },
        createWritable(...args) {
          observed.createWritableCalls += 1;
          return file.createWritable(...args);
        },
      };
      return wrapped;
    },
    async removeEntry(name, options) {
      await directory.removeEntry(name, options);
    },
    async *keys() {
      for await (const name of directory.keys()) yield name;
    },
  };
}

function instrumentedWorkerScope(observed: NativeCounters): unknown {
  const target = {
    constructor: { name: "DedicatedWorkerGlobalScope" },
    navigator: {
      storage: {
        async getDirectory() {
          observed.getDirectoryCalls += 1;
          return instrumentDirectory(
            await navigator.storage.getDirectory(),
            observed,
          );
        },
      },
    },
  };
  return new Proxy(target, {
    get(value, property, receiver) {
      if (property === "indexedDB") observed.indexedDbAccesses += 1;
      return Reflect.get(value, property, receiver);
    },
  });
}

function unsupportedWorkerScope(observed: NativeCounters): unknown {
  const target = {
    constructor: { name: "DedicatedWorkerGlobalScope" },
    navigator: { storage: {} },
  };
  return new Proxy(target, {
    get(value, property, receiver) {
      if (property === "indexedDB") observed.indexedDbAccesses += 1;
      return Reflect.get(value, property, receiver);
    },
  });
}

async function createBackend(
  documentId: string,
  shardBytes: bigint,
  observed: NativeCounters,
) {
  return createStudioEngineTileStorageOpfsV2Backend({
    documentId,
    shardBytes,
    scope: instrumentedWorkerScope(observed),
  });
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "name" in error
    && (error as { readonly name?: unknown }).name === "NotFoundError"
  );
}

async function cleanupDocument(documentId: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const product = await root.getDirectoryHandle(
      STUDIO_ENGINE_TILE_STORAGE_OPFS_V2_ROOT_NAME,
    );
    await product.removeEntry(documentId, { recursive: true });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

function values(bytes: Uint8Array): number[] {
  return [...bytes];
}

function frontierEvidence(
  frontier: StudioEngineTileStorageWorkerV2Frontier,
) {
  return {
    durableRevision: frontier.durableRevision,
    documentRevision: frontier.documentRevision,
    commandSequence: frontier.commandSequence,
    transactionSequence: frontier.transactionSequence,
    journalByteLength: frontier.journalByteLength.toString(10),
    walByteLength: frontier.walByteLength.toString(10),
    markerByteLength: frontier.markerByteLength.toString(10),
  };
}

function recoveryEvidence(
  recovery: StudioEngineTileStorageWorkerV2RecoveryResult,
) {
  return {
    status: recovery.status,
    recoveredTransactions: recovery.recoveredTransactions,
    reason: recovery.status === "retry-required" ? recovery.reason : null,
    frontier: frontierEvidence(recovery.frontier),
  };
}

function ackEvidence(ack: StudioEngineTileStorageCommitAck) {
  return {
    kind: ack.kind,
    complete: ack.complete,
    disposition: ack.disposition,
    requestSequence: ack.requestSequence,
    transactionSequence: ack.transactionSequence,
    transactionIdentity: ack.transactionIdentity,
    durableRevision: ack.durableRevision,
    documentId: ack.documentId,
    documentRevision: ack.documentRevision,
    journalByteLength: ack.journal.byteLength,
    journalLogicalByteOffset: ack.journal.logicalByteOffset.toString(10),
    tileCount: ack.tiles.length,
    tileLogicalByteOffsets: ack.tiles.map(
      tile => tile.logicalByteOffset.toString(10),
    ),
  };
}

function json(value: unknown): StudioCommandJsonValue {
  return value as StudioCommandJsonValue;
}

function bytesChecksum(bytes: Uint8Array): string {
  return `bytes-v1:${studioTileDocDigest(bytes)}`;
}

function commitRequest(
  documentId: string,
  shardBytes: bigint,
): StudioEngineTileStorageCommitRequest {
  const requestSequence = 1;
  const transactionSequence = 1;
  const commandSequence = 1;
  const baseDocumentRevision = 0;
  const documentRevision = 1;
  const journalLogicalByteOffset = BigInt(0);
  const tileLogicalByteOffset = BigInt(5);
  const tileValues = new Uint16Array(8);
  tileValues.fill(0x3c00);
  const tileData = tileValues.buffer.slice(0);
  const tileDigest = studioEngineRgba16FloatTileDigest(tileData);
  const commandIdentity = "command:1";
  const layerId = "ink";
  const journalBody = {
    sequence: transactionSequence,
    documentId,
    commandIdentity,
    commandSequence,
    baseDocumentRevision,
    documentRevision,
    layerId,
    baseLayerRevision: 0,
    layerRevision: 1,
    deltas: [{
      index: 0,
      tileId: "tile:0",
      contentDigest: tileDigest,
    }],
  };
  const recordDigest = studioCommandPayloadChecksum(json(journalBody));
  const journalText = canonicalStudioCommandJson({
    ...journalBody,
    recordDigest,
  });
  const journalData = encoder.encode(journalText);
  const journalPayloadChecksum = bytesChecksum(journalData);
  const tile = {
    index: 0,
    tileId: "tile:0",
    column: 0,
    row: 0,
    layerId,
    layerIndex: 0,
    logicalTileIndex: BigInt(0),
    logicalByteOffset: tileLogicalByteOffset,
    shardIndex: tileLogicalByteOffset / shardBytes,
    shardByteOffset: tileLogicalByteOffset % shardBytes,
    baseTileRevision: 0,
    tileRevision: 1,
    byteLength: tileData.byteLength,
    contentDigest: tileDigest,
    payloadChecksum: tileDigest,
    data: tileData,
  };
  const identityChecksum = studioCommandPayloadChecksum({
    authorityVersion: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
    encoding: STUDIO_ENGINE_TILE_ENCODING,
    documentId,
    commandIdentity,
    commandSequence,
    baseDocumentRevision,
    documentRevision,
    layerId,
    baseLayerRevision: 0,
    layerRevision: 1,
    transactionSequence,
    journal: {
      logicalByteOffset: journalLogicalByteOffset.toString(10),
      byteLength: journalData.byteLength,
      recordDigest,
      payloadChecksum: journalPayloadChecksum,
    },
    tiles: [{
      index: 0,
      tileId: tile.tileId,
      layerId,
      logicalTileIndex: tile.logicalTileIndex.toString(10),
      logicalByteOffset: tile.logicalByteOffset.toString(10),
      shardIndex: tile.shardIndex.toString(10),
      shardByteOffset: tile.shardByteOffset.toString(10),
      tileRevision: tile.tileRevision,
      byteLength: tile.byteLength,
      contentDigest: tile.contentDigest,
    }],
  });
  return {
    kind: STUDIO_ENGINE_TILE_STORAGE_REQUEST_KIND,
    version: STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION,
    authorityVersion: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
    encoding: STUDIO_ENGINE_TILE_ENCODING,
    requestSequence,
    sessionEpoch: SESSION_EPOCH,
    transactionSequence,
    transactionIdentity: `studio-engine-storage-v2:${identityChecksum}`,
    expectedDurableRevision: 0,
    documentId,
    commandIdentity,
    commandSequence,
    baseDocumentRevision,
    documentRevision,
    writeCount: 2,
    totalPayloadBytes: BigInt(journalData.byteLength + tileData.byteLength),
    journal: {
      sequence: transactionSequence,
      logicalByteOffset: journalLogicalByteOffset,
      byteLength: journalData.byteLength,
      recordDigest,
      payloadChecksum: journalPayloadChecksum,
      data: journalData.buffer.slice(
        journalData.byteOffset,
        journalData.byteOffset + journalData.byteLength,
      ),
    },
    tiles: [tile],
  };
}

function createStorageWorker(
  documentId: string,
  backend: Awaited<ReturnType<typeof createBackend>>,
  faultInjector?: (
    point: Readonly<{
      stage: StudioEngineTileStorageWorkerV2FaultStage;
      transactionIdentity: string;
      tileIndex?: number;
    }>,
  ) => Promise<void> | void,
): StudioEngineTileStorageWorkerV2 {
  return new StudioEngineTileStorageWorkerV2({
    documentId,
    ownerId: "chromium-opfs-browser-worker",
    sessionEpoch: SESSION_EPOCH,
    leaseEpoch: LEASE_EPOCH,
    backend,
    leasePort: new BrowserLeasePort(),
    windowBytes: 128,
    faultInjector,
  });
}

async function directIoScenario(
  documentId: string,
  observed: NativeCounters,
) {
  await cleanupDocument(documentId);
  const first = await createBackend(
    documentId,
    DIRECT_SHARD_BYTES,
    observed,
  );
  await first.write(
    "document",
    BigInt(0),
    1,
    Uint8Array.of(1, 2, 3, 4, 5, 6),
    new AbortController().signal,
  );
  await first.write(
    "document",
    BigInt(2),
    3,
    Uint8Array.of(7, 8),
    new AbortController().signal,
  );
  await first.write(
    "wal",
    BigInt(0),
    2,
    Uint8Array.of(11, 12, 13, 14),
    new AbortController().signal,
  );
  await first.write(
    "markers",
    BigInt(1),
    1,
    Uint8Array.of(21, 22, 23),
    new AbortController().signal,
  );
  for (const file of ["document", "wal", "markers"] as const) {
    await first.flush(file, new AbortController().signal);
  }
  const initial = {
    documentLength: (
      await first.logicalByteLength(
        "document",
        new AbortController().signal,
      )
    ).toString(10),
    walLength: (
      await first.logicalByteLength("wal", new AbortController().signal)
    ).toString(10),
    markerLength: (
      await first.logicalByteLength("markers", new AbortController().signal)
    ).toString(10),
    documentShard0: values(await first.read(
      "document",
      BigInt(0),
      1,
      6,
      new AbortController().signal,
    )),
    documentShard1Hole: values(await first.read(
      "document",
      BigInt(1),
      0,
      Number(DIRECT_SHARD_BYTES),
      new AbortController().signal,
    )),
    documentShard2: values(await first.read(
      "document",
      BigInt(2),
      0,
      5,
      new AbortController().signal,
    )),
    wal: values(await first.read(
      "wal",
      BigInt(0),
      2,
      4,
      new AbortController().signal,
    )),
    markers: values(await first.read(
      "markers",
      BigInt(1),
      0,
      4,
      new AbortController().signal,
    )),
  };
  await first.truncate(
    "document",
    BigInt(35),
    new AbortController().signal,
  );
  await first.flush("document", new AbortController().signal);
  const truncatedHole = values(await first.read(
    "document",
    BigInt(1),
    0,
    3,
    new AbortController().signal,
  ));
  await first.close();

  const reopened = await createBackend(
    documentId,
    DIRECT_SHARD_BYTES,
    observed,
  );
  const afterReopen = {
    documentLength: (
      await reopened.logicalByteLength(
        "document",
        new AbortController().signal,
      )
    ).toString(10),
    walLength: (
      await reopened.logicalByteLength("wal", new AbortController().signal)
    ).toString(10),
    markerLength: (
      await reopened.logicalByteLength(
        "markers",
        new AbortController().signal,
      )
    ).toString(10),
    documentShard0: values(await reopened.read(
      "document",
      BigInt(0),
      1,
      6,
      new AbortController().signal,
    )),
    documentShard1: values(await reopened.read(
      "document",
      BigInt(1),
      0,
      3,
      new AbortController().signal,
    )),
    wal: values(await reopened.read(
      "wal",
      BigInt(0),
      2,
      4,
      new AbortController().signal,
    )),
    markers: values(await reopened.read(
      "markers",
      BigInt(1),
      0,
      4,
      new AbortController().signal,
    )),
  };
  await reopened.close();
  await cleanupDocument(documentId);
  return { initial, truncatedHole, afterReopen };
}

async function durableRecoveryScenario(
  documentId: string,
  observed: NativeCounters,
) {
  await cleanupDocument(documentId);
  const firstBackend = await createBackend(
    documentId,
    RECOVERY_SHARD_BYTES,
    observed,
  );
  const firstWorker = createStorageWorker(documentId, firstBackend);
  const initialOpen = await firstWorker.open(new AbortController().signal);
  const committed = await firstWorker.commit(
    commitRequest(documentId, RECOVERY_SHARD_BYTES),
    { signal: new AbortController().signal },
  );
  await firstWorker.dispose();

  const reopenedBackend = await createBackend(
    documentId,
    RECOVERY_SHARD_BYTES,
    observed,
  );
  const reopenedWorker = createStorageWorker(documentId, reopenedBackend);
  const reopened = await reopenedWorker.open(new AbortController().signal);
  const replay = await reopenedWorker.commit(
    commitRequest(documentId, RECOVERY_SHARD_BYTES),
    { signal: new AbortController().signal },
  );
  await reopenedWorker.dispose();
  await cleanupDocument(documentId);
  return {
    initialOpen: recoveryEvidence(initialOpen),
    committed: ackEvidence(committed),
    reopened: recoveryEvidence(reopened),
    replay: ackEvidence(replay),
  };
}

async function lifecycleScenario(
  documentId: string,
  observed: NativeCounters,
) {
  await cleanupDocument(documentId);
  const value = await createBackend(
    documentId,
    DIRECT_SHARD_BYTES,
    observed,
  );
  const abortedController = new AbortController();
  abortedController.abort(new Error("browser-boundary-abort"));
  const syncCallsBeforeAbort = observed.createSyncAccessHandleCalls;
  let abortError: unknown = null;
  try {
    await value.write(
      "wal",
      BigInt(0),
      0,
      Uint8Array.of(1),
      abortedController.signal,
    );
  } catch (error) {
    abortError = error;
  }
  const syncCallsAfterAbort = observed.createSyncAccessHandleCalls;
  await value.write(
    "document",
    BigInt(0),
    0,
    Uint8Array.of(9),
    new AbortController().signal,
  );
  const firstClose = value.close();
  const secondClose = value.close();
  const sameClosePromise = firstClose === secondClose;
  await Promise.all([firstClose, secondClose]);
  let disposedError: unknown = null;
  try {
    await value.read(
      "document",
      BigInt(0),
      0,
      1,
      new AbortController().signal,
    );
  } catch (error) {
    disposedError = error;
  }
  await cleanupDocument(documentId);
  return {
    abortError: errorEvidence(abortError),
    syncAccessHandleDeltaDuringPreAbort:
      syncCallsAfterAbort - syncCallsBeforeAbort,
    sameClosePromise,
    disposedError: errorEvidence(disposedError),
  };
}

async function unsupportedScenario() {
  const observed = counters();
  let unsupportedError: unknown = null;
  try {
    await createStudioEngineTileStorageOpfsV2Backend({
      documentId: "unsupported-browser-boundary",
      shardBytes: DIRECT_SHARD_BYTES,
      scope: unsupportedWorkerScope(observed),
    });
  } catch (error) {
    unsupportedError = error;
  }
  return {
    error: errorEvidence(unsupportedError),
    fallback: {
      createWritableCalls: observed.createWritableCalls,
      indexedDbAccesses: observed.indexedDbAccesses,
      memoryFallbackFactoryCalls: observed.memoryFallbackFactoryCalls,
    },
  };
}

async function runMain(runId: string) {
  const observed = counters();
  const directDocumentId = `${runId}-direct`;
  const recoveryDocumentId = `${runId}-recovery`;
  const lifecycleDocumentId = `${runId}-lifecycle`;
  const direct = await directIoScenario(directDocumentId, observed);
  const recovery = await durableRecoveryScenario(recoveryDocumentId, observed);
  const lifecycle = await lifecycleScenario(lifecycleDocumentId, observed);
  const unsupported = await unsupportedScenario();
  return {
    provider: {
      kind: "real-chromium-dedicated-worker-opfs-sync-access",
      rootName: STUDIO_ENGINE_TILE_STORAGE_OPFS_V2_ROOT_NAME,
      logicalFiles: ["document", "wal", "markers"],
    },
    capabilities: {
      navigatorStorageGetDirectory:
        typeof navigator.storage?.getDirectory === "function",
      fileSystemSyncAccessHandle:
        observed.createSyncAccessHandleCalls > 0,
      dedicatedWorker:
        Object.prototype.toString.call(workerScope)
          === "[object DedicatedWorkerGlobalScope]",
      userAgent: navigator.userAgent,
    },
    nativeCalls: observed,
    direct,
    recovery,
    lifecycle,
    unsupported,
  };
}

async function holdLock(
  requestId: number,
  documentId: string,
): Promise<void> {
  await cleanupDocument(documentId);
  const observed = counters();
  heldLockBackend = await createBackend(
    documentId,
    DIRECT_SHARD_BYTES,
    observed,
  );
  await heldLockBackend.write(
    "document",
    BigInt(0),
    0,
    Uint8Array.of(77),
    new AbortController().signal,
  );
  await heldLockBackend.flush("document", new AbortController().signal);
  post({
    type: "lock-held",
    requestId,
    result: { nativeCalls: observed },
  });
}

async function releaseLock(requestId: number): Promise<void> {
  await heldLockBackend?.close();
  heldLockBackend = null;
  post({ type: "lock-released", requestId, result: { released: true } });
}

async function probeLock(documentId: string) {
  const observed = counters();
  let value: Awaited<ReturnType<typeof createBackend>> | null = null;
  try {
    value = await createBackend(
      documentId,
      DIRECT_SHARD_BYTES,
      observed,
    );
    const logicalByteLength = await value.logicalByteLength(
      "document",
      new AbortController().signal,
    );
    const bytes = logicalByteLength > BigInt(0)
      ? await value.read(
        "document",
        BigInt(0),
        0,
        1,
        new AbortController().signal,
      )
      : new Uint8Array(0);
    return {
      acquired: true,
      logicalByteLength: logicalByteLength.toString(10),
      bytes: values(bytes),
      error: null,
      nativeCalls: observed,
    };
  } catch (error) {
    return {
      acquired: false,
      logicalByteLength: null,
      bytes: [],
      error: errorEvidence(error),
      nativeCalls: observed,
    };
  } finally {
    await value?.close().catch(() => undefined);
  }
}

async function beginCrashAfterWal(
  requestId: number,
  documentId: string,
): Promise<never> {
  await cleanupDocument(documentId);
  const observed = counters();
  const value = await createBackend(
    documentId,
    RECOVERY_SHARD_BYTES,
    observed,
  );
  const storage = createStorageWorker(
    documentId,
    value,
    async point => {
      if (point.stage !== "after-wal-flush") return;
      post({
        type: "wal-flushed",
        requestId,
        result: {
          stage: point.stage,
          transactionIdentity: point.transactionIdentity,
          nativeCalls: observed,
        },
      });
      await new Promise<never>(() => undefined);
    },
  );
  await storage.open(new AbortController().signal);
  await storage.commit(
    commitRequest(documentId, RECOVERY_SHARD_BYTES),
    { signal: new AbortController().signal },
  );
  throw new Error("The crash hold unexpectedly completed.");
}

async function recoverCrash(documentId: string) {
  const observed = counters();
  let recovered: StudioEngineTileStorageWorkerV2RecoveryResult | null = null;
  let attempts = 0;
  for (; attempts < 20; attempts += 1) {
    const value = await createBackend(
      documentId,
      RECOVERY_SHARD_BYTES,
      observed,
    );
    const storage = createStorageWorker(documentId, value);
    try {
      recovered = await storage.open(new AbortController().signal);
      await storage.dispose();
      break;
    } catch (error) {
      await storage.dispose();
      if (
        !(error instanceof StudioEngineTileStorageOpfsV2BackendError)
        || error.code !== "open-failed"
      ) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  if (!recovered) throw new Error("The terminated Worker lock was not released.");

  const finalBackend = await createBackend(
    documentId,
    RECOVERY_SHARD_BYTES,
    observed,
  );
  const finalWorker = createStorageWorker(documentId, finalBackend);
  const afterMarker = await finalWorker.open(new AbortController().signal);
  const replay = await finalWorker.commit(
    commitRequest(documentId, RECOVERY_SHARD_BYTES),
    { signal: new AbortController().signal },
  );
  await finalWorker.dispose();
  await cleanupDocument(documentId);
  return {
    attempts: attempts + 1,
    afterWorkerTermination: recoveryEvidence(recovered),
    afterCommitMarkerRestart: recoveryEvidence(afterMarker),
    replay: ackEvidence(replay),
    nativeCalls: observed,
    browserProcessCrash: {
      status: "not-automated",
      reason:
        "A full Chromium process kill would also destroy the verifier transport; "
        + "the safe automated boundary terminates the Dedicated Worker immediately "
        + "after the durable WAL flush and verifies marker completion on restart.",
    },
  };
}

workerScope.addEventListener("error", event => {
  post({
    type: "failure",
    requestId: -1,
    error: {
      name: "WorkerErrorEvent",
      code: null,
      message: event.message,
      causeName: null,
    },
  });
});

workerScope.addEventListener("messageerror", () => {
  post({
    type: "failure",
    requestId: -1,
    error: {
      name: "WorkerMessageError",
      code: null,
      message: "The Worker received a non-cloneable message.",
      causeName: null,
    },
  });
});

workerScope.addEventListener("securitypolicyviolation", event => {
  post({
    type: "failure",
    requestId: -1,
    error: {
      name: "SecurityPolicyViolationEvent",
      code: null,
      message: `${event.effectiveDirective}:${event.blockedURI}`,
      causeName: null,
    },
  });
});

workerScope.addEventListener("message", event => {
  const command = event.data as WorkerCommand;
  void (async () => {
    if (
      !command
      || typeof command !== "object"
      || !Number.isSafeInteger(command.requestId)
      || typeof command.runId !== "string"
    ) {
      throw new Error("Invalid OPFS v2 browser command.");
    }
    switch (command.type) {
      case "run-main":
        post({
          type: "result",
          requestId: command.requestId,
          result: await runMain(command.runId),
        });
        return;
      case "hold-lock":
        await holdLock(
          command.requestId,
          command.documentId ?? `${command.runId}-lock`,
        );
        return;
      case "release-lock":
        await releaseLock(command.requestId);
        return;
      case "probe-lock":
        post({
          type: "result",
          requestId: command.requestId,
          result: await probeLock(
            command.documentId ?? `${command.runId}-lock`,
          ),
        });
        return;
      case "begin-crash-after-wal":
        await beginCrashAfterWal(
          command.requestId,
          command.documentId ?? `${command.runId}-crash`,
        );
        return;
      case "recover-crash":
        post({
          type: "result",
          requestId: command.requestId,
          result: await recoverCrash(
            command.documentId ?? `${command.runId}-crash`,
          ),
        });
        return;
      case "cleanup":
        await cleanupDocument(
          command.documentId ?? `${command.runId}-lock`,
        );
        post({
          type: "result",
          requestId: command.requestId,
          result: { cleaned: true },
        });
        return;
    }
  })().catch(error => {
    post({
      type: "failure",
      requestId: command?.requestId ?? -1,
      error: errorEvidence(error),
    });
  });
});
