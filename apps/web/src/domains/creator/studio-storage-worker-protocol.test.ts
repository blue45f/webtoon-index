import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  StudioOpfsSyncAccessError,
  createStudioOpfsMemorySyncAccessStore,
  type StudioOpfsSyncAccessStore,
} from "./studio-opfs-sync-access-store";
import {
  STUDIO_STORAGE_WORKER_MAX_JOURNAL_APPEND_BYTES,
  STUDIO_STORAGE_WORKER_MAX_RANGE_BYTES,
  STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
  isStudioStorageWorkerRequest,
  isStudioStorageWorkerResponse,
  studioStorageWorkerError,
  studioStorageWorkerRequestTransfers,
  studioStorageWorkerResponseTransfers,
  type StudioStorageWorkerOpenRequest,
  type StudioStorageWorkerRequest,
  type StudioStorageWorkerResponse,
  type StudioStorageWorkerSessionConfig,
} from "./studio-storage-worker-protocol";
import {
  createStudioStorageWorkerRuntime,
  type StudioStorageWorkerScope,
} from "./studio-storage.worker";

function session(
  overrides: Partial<StudioStorageWorkerSessionConfig> = {},
): StudioStorageWorkerSessionConfig {
  return {
    sessionEpoch: 1,
    documentId: "doc-1",
    shardBytes: BigInt(8),
    dataByteLength: BigInt(0),
    journalByteLength: BigInt(0),
    revision: 0,
    maxDocumentBytes: BigInt(1_024),
    maxJournalBytes: BigInt(1_024),
    maxSessionWriteBytes: BigInt(128),
    ...overrides,
  };
}

function openRequest(
  overrides: Partial<StudioStorageWorkerOpenRequest> = {},
): StudioStorageWorkerOpenRequest {
  return {
    version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
    type: "studio-storage/open",
    requestSequence: 1,
    commandSequence: 1,
    session: session(),
    ...overrides,
  };
}

class FakeWorkerScope implements StudioStorageWorkerScope {
  public readonly [Symbol.toStringTag] = "DedicatedWorkerGlobalScope";
  public readonly navigator = {
    storage: {
      getDirectory: async () => ({}),
    },
  };
  public onmessage:
    | ((event: MessageEvent<unknown>) => void)
    | null = null;
  public onerror:
    | ((event: ErrorEvent) => boolean | void)
    | null = null;
  public onunhandledrejection:
    | ((event: PromiseRejectionEvent) => void)
    | null = null;
  public readonly delivered: StudioStorageWorkerResponse[] = [];
  public readonly transfers: Transferable[][] = [];

  public postMessage(
    message: StudioStorageWorkerResponse,
    transfer: Transferable[],
  ): void {
    this.transfers.push([...transfer]);
    this.delivered.push(structuredClone(message, { transfer }));
  }

  public emit(request: StudioStorageWorkerRequest): void {
    const data = structuredClone(request, {
      transfer: studioStorageWorkerRequestTransfers(request),
    });
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }

  public response(type: StudioStorageWorkerResponse["type"]) {
    return this.delivered.findLast((message) => message.type === type);
  }
}

async function waitForDelivered(
  scope: FakeWorkerScope,
  count: number,
): Promise<void> {
  await vi.waitFor(() => {
    expect(scope.delivered.length).toBeGreaterThanOrEqual(count);
  });
}

function delegatedStore(
  base: StudioOpfsSyncAccessStore,
  overrides: Partial<
    Pick<
      StudioOpfsSyncAccessStore,
      "read" | "write" | "flush" | "truncate" | "close"
    >
  > = {},
): StudioOpfsSyncAccessStore {
  return {
    kind: base.kind,
    documentId: base.documentId,
    shardBytes: base.shardBytes,
    read: overrides.read ?? ((offset, length) => base.read(offset, length)),
    write: overrides.write ?? ((offset, bytes) => base.write(offset, bytes)),
    flush: overrides.flush ?? (() => base.flush()),
    truncate:
      overrides.truncate ?? ((byteLength) => base.truncate(byteLength)),
    close: overrides.close ?? (() => base.close()),
  };
}

describe("studio-storage-worker-protocol · clone and budgets", () => {
  it("accepts a versioned BigInt open envelope and rejects extra keys", () => {
    const request = openRequest();
    expect(isStudioStorageWorkerRequest(request)).toBe(true);
    expect(isStudioStorageWorkerRequest(
      structuredClone(request),
    )).toBe(true);
    expect(isStudioStorageWorkerRequest({
      ...request,
      unversionedExtra: true,
    })).toBe(false);
    expect(isStudioStorageWorkerRequest({
      ...request,
      session: { ...request.session, sessionEpoch: 0 },
    })).toBe(false);
  });

  it("enforces hard range and journal byte budgets at the wire boundary", () => {
    const write = {
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/write",
      requestSequence: 2,
      commandSequence: 2,
      sessionEpoch: 1,
      expectedRevision: 0,
      globalByteOffset: BigInt(0),
      data: new ArrayBuffer(4),
    } as const;
    expect(isStudioStorageWorkerRequest(write)).toBe(true);
    expect(isStudioStorageWorkerRequest({
      ...write,
      data: new ArrayBuffer(STUDIO_STORAGE_WORKER_MAX_RANGE_BYTES + 1),
    })).toBe(false);
    expect(isStudioStorageWorkerRequest({
      ...write,
      data: new SharedArrayBuffer(4),
    })).toBe(false);
    expect(isStudioStorageWorkerRequest({
      ...write,
      globalByteOffset: BigInt(-1),
    })).toBe(false);

    const append = {
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/append-journal",
      requestSequence: 3,
      commandSequence: 3,
      sessionEpoch: 1,
      expectedRevision: 0,
      data: new ArrayBuffer(
        STUDIO_STORAGE_WORKER_MAX_JOURNAL_APPEND_BYTES + 1,
      ),
    } as const;
    expect(isStudioStorageWorkerRequest(append)).toBe(false);
  });

  it("declares ownership transfers in both protocol directions", () => {
    const request = {
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/write",
      requestSequence: 2,
      commandSequence: 2,
      sessionEpoch: 1,
      expectedRevision: 0,
      globalByteOffset: BigInt(0),
      data: new ArrayBuffer(4),
    } as const;
    expect(studioStorageWorkerRequestTransfers(request)).toEqual([
      request.data,
    ]);

    const response = {
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/read-result",
      requestSequence: 3,
      sessionEpoch: 1,
      revision: 0,
      source: "document",
      globalByteOffset: BigInt(0),
      data: new ArrayBuffer(4),
    } as const;
    expect(studioStorageWorkerResponseTransfers(response)).toEqual([
      response.data,
    ]);
    const received = structuredClone(response, {
      transfer: studioStorageWorkerResponseTransfers(response),
    });
    expect(response.data.byteLength).toBe(0);
    expect(received.data.byteLength).toBe(4);
  });

  it("uses an explicit bounded error envelope", () => {
    const error = studioStorageWorkerError({
      requestSequence: 7,
      commandSequence: 4,
      sessionEpoch: 2,
      code: "STALE_REVISION",
      message: "r".repeat(2_000),
      recoverable: true,
    });
    expect(isStudioStorageWorkerResponse(error)).toBe(true);
    expect(error.error.message.length).toBe(1_024);
    expect(isStudioStorageWorkerResponse({
      ...error,
      error: { ...error.error, code: "UNKNOWN" },
    })).toBe(false);
  });
});

describe("studio-storage.worker · ordered state machine", () => {
  it("advertises capability, opens a session, writes, and transfers reads", async () => {
    const scope = new FakeWorkerScope();
    const documentStore = createStudioOpfsMemorySyncAccessStore({
      documentId: "doc-1",
      shardBytes: BigInt(8),
    });
    const journalStore = createStudioOpfsMemorySyncAccessStore({
      documentId: "doc-1-journal",
      shardBytes: BigInt(8),
    });
    const runtime = createStudioStorageWorkerRuntime({
      scope,
      createStore: async (input) => (
        input.role === "document" ? documentStore : journalStore
      ),
    });
    expect(scope.delivered[0]).toEqual({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/ready",
    });

    scope.emit({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/capability",
      requestSequence: 1,
    });
    scope.emit(openRequest({
      requestSequence: 2,
      commandSequence: 1,
    }));
    const writeBuffer = Uint8Array.from([4, 5, 6, 7]).buffer;
    scope.emit({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/write",
      requestSequence: 3,
      commandSequence: 2,
      sessionEpoch: 1,
      expectedRevision: 0,
      globalByteOffset: BigInt(0),
      data: writeBuffer,
    });
    expect(writeBuffer.byteLength).toBe(0);
    scope.emit({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/read",
      requestSequence: 4,
      sessionEpoch: 1,
      expectedRevision: 1,
      source: "document",
      globalByteOffset: BigInt(0),
      byteLength: 4,
    });

    await waitForDelivered(scope, 5);
    expect(scope.response("studio-storage/capability-result")).toMatchObject({
      candidateSupported: true,
      requiresOpenProbe: true,
    });
    expect(scope.response("studio-storage/opened")).toMatchObject({
      sessionEpoch: 1,
      revision: 0,
    });
    expect(scope.response("studio-storage/command-result")).toMatchObject({
      operation: "write",
      revision: 1,
      dataByteLength: BigInt(4),
      journalByteLength: BigInt(0),
      sessionWrittenBytes: BigInt(4),
    });
    const read = scope.response("studio-storage/read-result");
    expect(read?.type).toBe("studio-storage/read-result");
    if (read?.type === "studio-storage/read-result") {
      expect([...new Uint8Array(read.data)]).toEqual([4, 5, 6, 7]);
    }
    expect(scope.transfers.at(-1)?.length).toBe(1);
    await runtime.dispose();
  });

  it("keeps document bytes and journal bytes in disjoint stores and read namespaces", async () => {
    const scope = new FakeWorkerScope();
    const documentStore = createStudioOpfsMemorySyncAccessStore({
      documentId: "separate-document",
      shardBytes: BigInt(8),
    });
    const journalStore = createStudioOpfsMemorySyncAccessStore({
      documentId: "separate-journal",
      shardBytes: BigInt(8),
    });
    const runtime = createStudioStorageWorkerRuntime({
      scope,
      createStore: async (input) => (
        input.role === "document" ? documentStore : journalStore
      ),
    });
    scope.emit(openRequest());
    scope.emit({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/write",
      requestSequence: 2,
      commandSequence: 2,
      sessionEpoch: 1,
      expectedRevision: 0,
      globalByteOffset: BigInt(0),
      data: Uint8Array.from([1, 2]).buffer,
    });
    scope.emit({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/append-journal",
      requestSequence: 3,
      commandSequence: 3,
      sessionEpoch: 1,
      expectedRevision: 1,
      data: Uint8Array.from([9, 8]).buffer,
    });
    scope.emit({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/read",
      requestSequence: 4,
      sessionEpoch: 1,
      expectedRevision: 2,
      source: "document",
      globalByteOffset: BigInt(0),
      byteLength: 2,
    });
    scope.emit({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/read",
      requestSequence: 5,
      sessionEpoch: 1,
      expectedRevision: 2,
      source: "journal",
      globalByteOffset: BigInt(0),
      byteLength: 2,
    });

    await waitForDelivered(scope, 6);
    expect(documentStore.snapshot().get("shard-0.bin")).toEqual(
      Uint8Array.from([1, 2]),
    );
    expect(journalStore.snapshot().get("shard-0.bin")).toEqual(
      Uint8Array.from([9, 8]),
    );
    const reads = scope.delivered.filter(
      (message) => message.type === "studio-storage/read-result",
    );
    expect(reads).toHaveLength(2);
    expect(reads.map((message) => {
      if (message.type !== "studio-storage/read-result") return null;
      return {
        source: message.source,
        bytes: [...new Uint8Array(message.data)],
      };
    })).toEqual([
      { source: "document", bytes: [1, 2] },
      { source: "journal", bytes: [9, 8] },
    ]);
    await runtime.dispose();
  });

  it("rejects a factory that aliases document and journal to one store", async () => {
    const scope = new FakeWorkerScope();
    const base = createStudioOpfsMemorySyncAccessStore({
      shardBytes: BigInt(8),
    });
    let closeCalls = 0;
    const aliased = delegatedStore(base, {
      async close() {
        closeCalls += 1;
        await base.close();
      },
    });
    const runtime = createStudioStorageWorkerRuntime({
      scope,
      createStore: async () => aliased,
    });
    scope.emit(openRequest());

    await waitForDelivered(scope, 2);
    expect(scope.delivered.at(-1)).toMatchObject({
      type: "studio-storage/error",
      error: { code: "CAPABILITY_UNAVAILABLE" },
    });
    expect(closeCalls).toBe(1);
    expect(runtime.activeSessionEpoch).toBeNull();
    await runtime.dispose();
  });

  it("rejects replayed request/command sequences and stale session authority", async () => {
    const scope = new FakeWorkerScope();
    const documentStore = createStudioOpfsMemorySyncAccessStore({
      shardBytes: BigInt(8),
    });
    const journalStore = createStudioOpfsMemorySyncAccessStore({
      documentId: "memory-journal",
      shardBytes: BigInt(8),
    });
    const runtime = createStudioStorageWorkerRuntime({
      scope,
      createStore: async (input) => (
        input.role === "document" ? documentStore : journalStore
      ),
    });
    scope.emit(openRequest());
    scope.emit({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/flush",
      requestSequence: 1,
      commandSequence: 2,
      sessionEpoch: 1,
      expectedRevision: 0,
    });
    scope.emit({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/flush",
      requestSequence: 2,
      commandSequence: 1,
      sessionEpoch: 1,
      expectedRevision: 0,
    });
    scope.emit({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/read",
      requestSequence: 3,
      sessionEpoch: 2,
      expectedRevision: 0,
      source: "document",
      globalByteOffset: BigInt(0),
      byteLength: 1,
    });
    scope.emit({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/read",
      requestSequence: 4,
      sessionEpoch: 1,
      expectedRevision: 99,
      source: "document",
      globalByteOffset: BigInt(0),
      byteLength: 1,
    });

    await waitForDelivered(scope, 6);
    const errors = scope.delivered.filter(
      (message) => message.type === "studio-storage/error",
    );
    expect(errors.map((message) => (
      message.type === "studio-storage/error"
        ? message.error.code
        : null
    ))).toEqual([
      "OUT_OF_ORDER_REQUEST",
      "OUT_OF_ORDER_COMMAND",
      "STALE_EPOCH",
      "STALE_REVISION",
    ]);
    expect(documentStore.counts.flush).toBe(0);
    expect(journalStore.counts.flush).toBe(0);
    await runtime.dispose();
  });

  it("serializes a checkpoint barrier after an in-flight mutation", async () => {
    const scope = new FakeWorkerScope();
    const documentBase = createStudioOpfsMemorySyncAccessStore({
      documentId: "checkpoint-document",
      shardBytes: BigInt(8),
    });
    const journalBase = createStudioOpfsMemorySyncAccessStore({
      documentId: "checkpoint-journal",
      shardBytes: BigInt(8),
    });
    let releaseWrite: (() => void) | undefined;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const events: string[] = [];
    const documentStore = delegatedStore(documentBase, {
      async flush() {
        events.push("document:flush");
        await documentBase.flush();
      },
    });
    const journalStore = delegatedStore(journalBase, {
      async write(offset, bytes) {
        events.push("write:start");
        await writeGate;
        await journalBase.write(offset, bytes);
        events.push("write:end");
      },
      async flush() {
        events.push("journal:flush");
        await journalBase.flush();
      },
    });
    const runtime = createStudioStorageWorkerRuntime({
      scope,
      createStore: async (input) => (
        input.role === "document" ? documentStore : journalStore
      ),
    });
    scope.emit(openRequest());
    scope.emit({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/append-journal",
      requestSequence: 2,
      commandSequence: 2,
      sessionEpoch: 1,
      expectedRevision: 0,
      data: Uint8Array.from([8, 9]).buffer,
    });
    scope.emit({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/checkpoint-barrier",
      requestSequence: 3,
      commandSequence: 3,
      sessionEpoch: 1,
      expectedRevision: 1,
      checkpointId: "checkpoint-1",
    });

    await vi.waitFor(() => {
      expect(events).toEqual(["write:start"]);
    });
    expect(scope.response("studio-storage/checkpointed")).toBeUndefined();
    releaseWrite?.();
    await waitForDelivered(scope, 4);
    expect(events).toEqual([
      "write:start",
      "write:end",
      "journal:flush",
      "document:flush",
    ]);
    expect(scope.response("studio-storage/checkpointed")).toMatchObject({
      checkpointId: "checkpoint-1",
      revision: 1,
      dataByteLength: BigInt(0),
      journalByteLength: BigInt(2),
    });
    await runtime.dispose();
  });

  it("enforces per-document and cumulative session write budgets", async () => {
    const scope = new FakeWorkerScope();
    const documentStore = createStudioOpfsMemorySyncAccessStore({
      shardBytes: BigInt(8),
    });
    const journalStore = createStudioOpfsMemorySyncAccessStore({
      documentId: "budget-journal",
      shardBytes: BigInt(8),
    });
    const runtime = createStudioStorageWorkerRuntime({
      scope,
      createStore: async (input) => (
        input.role === "document" ? documentStore : journalStore
      ),
    });
    scope.emit(openRequest({
      session: session({
        maxDocumentBytes: BigInt(6),
        maxSessionWriteBytes: BigInt(4),
      }),
    }));
    scope.emit({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/write",
      requestSequence: 2,
      commandSequence: 2,
      sessionEpoch: 1,
      expectedRevision: 0,
      globalByteOffset: BigInt(5),
      data: Uint8Array.from([1, 2]).buffer,
    });
    scope.emit({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/write",
      requestSequence: 3,
      commandSequence: 3,
      sessionEpoch: 1,
      expectedRevision: 0,
      globalByteOffset: BigInt(0),
      data: Uint8Array.from([1, 2, 3, 4]).buffer,
    });
    scope.emit({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/write",
      requestSequence: 4,
      commandSequence: 4,
      sessionEpoch: 1,
      expectedRevision: 1,
      globalByteOffset: BigInt(4),
      data: Uint8Array.from([5]).buffer,
    });

    await waitForDelivered(scope, 5);
    const errors = scope.delivered.filter(
      (message) => message.type === "studio-storage/error",
    );
    expect(errors).toHaveLength(2);
    expect(errors.every((message) => (
      message.type === "studio-storage/error"
      && message.error.code === "BUDGET_EXCEEDED"
    ))).toBe(true);
    expect(documentStore.counts.write).toBe(1);
    expect(journalStore.counts.write).toBe(0);
    await runtime.dispose();
  });

  it("truncates, flushes on close, and rejects a reused epoch", async () => {
    const scope = new FakeWorkerScope();
    const stores: StudioOpfsSyncAccessStore[] = [];
    const runtime = createStudioStorageWorkerRuntime({
      scope,
      createStore: async (input) => {
        const store = createStudioOpfsMemorySyncAccessStore({
          documentId: input.documentId,
          shardBytes: input.shardBytes,
        });
        stores.push(store);
        return store;
      },
    });
    scope.emit(openRequest({
      session: session({
        dataByteLength: BigInt(8),
        journalByteLength: BigInt(8),
      }),
    }));
    scope.emit({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/truncate",
      requestSequence: 2,
      commandSequence: 2,
      sessionEpoch: 1,
      expectedRevision: 0,
      target: "document",
      byteLength: BigInt(3),
    });
    scope.emit({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/close",
      requestSequence: 3,
      commandSequence: 3,
      sessionEpoch: 1,
      expectedRevision: 1,
    });
    scope.emit(openRequest({
      requestSequence: 4,
      commandSequence: 4,
      session: session({ sessionEpoch: 1 }),
    }));

    await waitForDelivered(scope, 5);
    expect(scope.delivered).toContainEqual(expect.objectContaining({
      type: "studio-storage/command-result",
      operation: "truncate",
      dataByteLength: BigInt(3),
      journalByteLength: BigInt(8),
      revision: 1,
    }));
    expect(scope.delivered).toContainEqual(expect.objectContaining({
      type: "studio-storage/command-result",
      operation: "close",
    }));
    expect(scope.delivered.at(-1)).toMatchObject({
      type: "studio-storage/error",
      error: { code: "STALE_EPOCH" },
    });
    expect(
      (stores[0] as ReturnType<
        typeof createStudioOpfsMemorySyncAccessStore
      >).counts.close,
    ).toBeGreaterThan(0);
    await runtime.dispose();
  });

  it("closes every handle and remains fail-closed after an uncaught store error", async () => {
    const scope = new FakeWorkerScope();
    const documentBase = createStudioOpfsMemorySyncAccessStore({
      shardBytes: BigInt(8),
    });
    const journalBase = createStudioOpfsMemorySyncAccessStore({
      documentId: "failure-journal",
      shardBytes: BigInt(8),
    });
    let closeCalls = 0;
    const documentStore = delegatedStore(documentBase, {
      async write() {
        throw new StudioOpfsSyncAccessError(
          "WRITE_FAILED",
          "injected OPFS failure",
        );
      },
      async close() {
        closeCalls += 1;
        await documentBase.close();
      },
    });
    const journalStore = delegatedStore(journalBase, {
      async close() {
        closeCalls += 1;
        await journalBase.close();
      },
    });
    const runtime = createStudioStorageWorkerRuntime({
      scope,
      createStore: async (input) => (
        input.role === "document" ? documentStore : journalStore
      ),
    });
    scope.emit(openRequest());
    scope.emit({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/write",
      requestSequence: 2,
      commandSequence: 2,
      sessionEpoch: 1,
      expectedRevision: 0,
      globalByteOffset: BigInt(0),
      data: Uint8Array.from([1]).buffer,
    });
    scope.emit({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/capability",
      requestSequence: 3,
    });

    await waitForDelivered(scope, 4);
    expect(closeCalls).toBe(2);
    expect(runtime.poisoned).toBe(true);
    const errors = scope.delivered.filter(
      (message) => message.type === "studio-storage/error",
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({
      error: { code: "STORAGE_FAILED", recoverable: false },
    });
    expect(errors[1]).toMatchObject({
      error: { code: "POISONED", recoverable: false },
    });
    await runtime.dispose();
  });
});

describe("studio-storage.worker · source boundary", () => {
  it("binds only to the sync-access store and contains no createWritable fallback", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./studio-storage.worker.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("createStudioOpfsSyncAccessStore");
    expect(source).not.toContain("createWritable");
    expect(source).not.toContain("localStorage");
  });
});
