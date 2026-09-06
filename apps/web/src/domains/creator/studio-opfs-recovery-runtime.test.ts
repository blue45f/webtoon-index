import { describe, expect, it, vi } from "vitest";

import {
  StudioOpfsRecoveryJournalError,
  type StudioOpfsRecoveryAppendInput,
  type StudioOpfsRecoveryCheckpointInput,
  type StudioOpfsRecoveryEntry,
  type StudioOpfsRecoveryEvictionResult,
  type StudioOpfsRecoveryMutationOptions,
  type StudioOpfsRecoveryScan,
  type StudioOpfsRecoveryWriterLease,
} from "./studio-opfs-recovery-journal";
import {
  createStudioOpfsRecoveryRuntime,
  StudioOpfsRecoveryRuntimeError,
  type StudioCompatibleRecoveryVaultCallbacks,
  type StudioOpfsRecoveryJournalRuntimePort,
  type StudioOpfsRecoveryPageHideTarget,
} from "./studio-opfs-recovery-runtime";

const EMPTY_SCAN: StudioOpfsRecoveryScan = Object.freeze({
  generation: 0,
  writerEpoch: 0,
  lastSequence: 0,
  totalPayloadBytes: 0,
  entries: Object.freeze([]),
  selectedSlot: null,
  ignoredSlots: Object.freeze([]),
});

function lease(ownerId = "writer-a", epoch = 1): StudioOpfsRecoveryWriterLease {
  return Object.freeze({
    documentId: "document-1",
    ownerId,
    token: `token-${epoch}`,
    epoch,
    acquiredAt: 1_000,
    expiresAt: 31_000,
  });
}

function entry(
  kind: "operation" | "checkpoint",
  sequence: number,
): StudioOpfsRecoveryEntry {
  return Object.freeze({
    kind,
    id: `${kind}-${sequence}`,
    sequence,
    pageId: "page-1",
    revision: sequence,
    documentId: "document-1",
    documentVersion: 1,
    engineVersion: "engine-1",
    writerEpoch: 1,
    createdAt: 1_000 + sequence,
    byteLength: 3,
    chunks: Object.freeze([]),
    compactThroughSequence: kind === "checkpoint" ? sequence - 1 : null,
    descriptorPath: `${kind}-${sequence}.meta`,
    descriptorCrc32: sequence,
  });
}

function operationInput(id = "command-1"): StudioOpfsRecoveryAppendInput {
  return {
    id,
    pageId: "page-1",
    revision: 1,
    payload: new Uint8Array([1, 2, 3]),
  };
}

function checkpointInput(id = "checkpoint-1"): StudioOpfsRecoveryCheckpointInput {
  return {
    ...operationInput(id),
    compactThroughSequence: 0,
  };
}

interface FakeBackendCounters {
  scan: number;
  acquire: number;
  renew: number;
  release: number;
  appendOperation: number;
  appendCheckpoint: number;
  compact: number;
  cleanup: number;
  flush: number;
}

function counters(): FakeBackendCounters {
  return {
    scan: 0,
    acquire: 0,
    renew: 0,
    release: 0,
    appendOperation: 0,
    appendCheckpoint: 0,
    compact: 0,
    cleanup: 0,
    flush: 0,
  };
}

function createJournalFake(input: {
  readonly counts?: FakeBackendCounters;
  readonly scan?: () => Promise<StudioOpfsRecoveryScan>;
  readonly append?: (
    writer: StudioOpfsRecoveryWriterLease,
    input: StudioOpfsRecoveryAppendInput,
    options?: StudioOpfsRecoveryMutationOptions,
  ) => Promise<StudioOpfsRecoveryEntry>;
} = {}): {
  readonly port: StudioOpfsRecoveryJournalRuntimePort;
  readonly counts: FakeBackendCounters;
} {
  const counts = input.counts ?? counters();
  let epoch = 0;
  return {
    counts,
    port: {
      async scan() {
        counts.scan += 1;
        return input.scan ? input.scan() : EMPTY_SCAN;
      },
      async acquireWriter({ ownerId, signal }) {
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");
        counts.acquire += 1;
        epoch += 1;
        return lease(ownerId, epoch);
      },
      async renewWriter(writer) {
        counts.renew += 1;
        return Object.freeze({
          ...writer,
          acquiredAt: writer.acquiredAt + 1,
          expiresAt: writer.expiresAt + 1,
        });
      },
      async releaseWriter() {
        counts.release += 1;
      },
      async appendOperation(writer, value, options) {
        counts.appendOperation += 1;
        if (input.append) return input.append(writer, value, options);
        return entry("operation", counts.appendOperation);
      },
      async appendCheckpoint() {
        counts.appendCheckpoint += 1;
        return entry("checkpoint", counts.appendCheckpoint);
      },
      async evictObsolete() {
        counts.cleanup += 1;
        return Object.freeze({
          removedPaths: Object.freeze(["orphan.bin"]),
          freedBytes: 64,
        });
      },
    },
  };
}

function createVaultFake(
  compatible = true,
  input: {
    readonly counts?: FakeBackendCounters;
    readonly scan?: () => Promise<StudioOpfsRecoveryScan>;
  } = {},
): {
  readonly vault: StudioCompatibleRecoveryVaultCallbacks;
  readonly counts: FakeBackendCounters;
} {
  const counts = input.counts ?? counters();
  let epoch = 20;
  return {
    counts,
    vault: {
      compatible,
      async scan() {
        counts.scan += 1;
        return input.scan ? input.scan() : EMPTY_SCAN;
      },
      async acquireWriter({ ownerId, signal }) {
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");
        counts.acquire += 1;
        epoch += 1;
        return lease(ownerId, epoch);
      },
      async renewWriter(writer) {
        counts.renew += 1;
        return Object.freeze({
          ...writer,
          acquiredAt: writer.acquiredAt + 10,
          expiresAt: writer.expiresAt + 10,
        });
      },
      async releaseWriter() {
        counts.release += 1;
      },
      async appendOperation() {
        counts.appendOperation += 1;
        return entry("operation", counts.appendOperation);
      },
      async appendCheckpoint() {
        counts.appendCheckpoint += 1;
        return entry("checkpoint", counts.appendCheckpoint);
      },
      async compact() {
        counts.compact += 1;
        return entry("checkpoint", 100 + counts.compact);
      },
      async cleanupQuota(): Promise<StudioOpfsRecoveryEvictionResult> {
        counts.cleanup += 1;
        return Object.freeze({
          removedPaths: Object.freeze(["vault-orphan"]),
          freedBytes: 32,
        });
      },
      async flush() {
        counts.flush += 1;
      },
    },
  };
}

class FakePageHideTarget implements StudioOpfsRecoveryPageHideTarget {
  listener: ((event: Event) => void) | null = null;
  addCount = 0;
  removeCount = 0;

  addEventListener(_type: "pagehide", listener: (event: Event) => void): void {
    this.addCount += 1;
    this.listener = listener;
  }

  removeEventListener(_type: "pagehide", listener: (event: Event) => void): void {
    this.removeCount += 1;
    if (this.listener === listener) this.listener = null;
  }

  dispatch(): void {
    this.listener?.(new Event("pagehide"));
  }
}

function expectRuntimeError(code: InstanceType<typeof StudioOpfsRecoveryRuntimeError>["code"]) {
  return expect.objectContaining({
    name: "StudioOpfsRecoveryRuntimeError",
    code,
  });
}

describe("StudioOpfsRecoveryRuntime immutable backend selection", () => {
  it("prefers OPFS and never calls a compatible vault", async () => {
    const journal = createJournalFake();
    const fallback = createVaultFake();
    const factory = vi.fn(async () => journal.port);
    const flushOpfs = vi.fn(async () => undefined);
    const runtime = await createStudioOpfsRecoveryRuntime({
      probeCapabilities: () => ({
        fileSystemKind: "opfs",
        originLockAvailable: true,
      }),
      createOpfsJournal: factory,
      flushOpfsJournal: flushOpfs,
      existingRecoveryVault: fallback.vault,
    });

    expect(runtime.status()).toMatchObject({
      backend: "opfs-journal",
      durable: true,
      state: "ready",
      writer: null,
    });
    await runtime.scanLatest();
    await runtime.acquireWriter({ ownerId: "writer-a" });
    await runtime.appendCommand(operationInput());
    await runtime.appendCheckpoint(checkpointInput());
    await runtime.compact(checkpointInput("compact-1"));
    await runtime.cleanupQuota();
    await runtime.flush();
    await runtime.releaseWriter();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(journal.counts).toMatchObject({
      scan: 1,
      acquire: 1,
      appendOperation: 1,
      appendCheckpoint: 2,
      cleanup: 1,
      release: 1,
    });
    expect(flushOpfs).toHaveBeenCalledTimes(2);
    expect(fallback.counts).toEqual(counters());
  });

  it("uses only an explicitly compatible vault when OPFS is unavailable", async () => {
    const journal = createJournalFake();
    const fallback = createVaultFake(true);
    const factory = vi.fn(async () => journal.port);
    const runtime = await createStudioOpfsRecoveryRuntime({
      probeCapabilities: () => ({
        fileSystemKind: "unavailable",
        originLockAvailable: false,
      }),
      createOpfsJournal: factory,
      existingRecoveryVault: fallback.vault,
    });

    expect(runtime.status()).toMatchObject({
      backend: "existing-recovery-vault",
      durable: true,
      state: "ready",
    });
    await runtime.scanLatest();
    await runtime.acquireWriter({ ownerId: "vault-writer" });
    await runtime.appendCommand(operationInput());
    await runtime.appendCheckpoint(checkpointInput());
    await runtime.compact(checkpointInput("compact-vault"));
    await runtime.cleanupQuota();
    await runtime.flush();
    await runtime.releaseWriter();

    expect(factory).not.toHaveBeenCalled();
    expect(journal.counts).toEqual(counters());
    expect(fallback.counts).toMatchObject({
      scan: 1,
      acquire: 1,
      appendOperation: 1,
      appendCheckpoint: 1,
      compact: 1,
      cleanup: 1,
      flush: 2,
      release: 1,
    });
  });

  it("fails closed without constructing or calling either backend", async () => {
    const journal = createJournalFake();
    const fallback = createVaultFake(false);
    const factory = vi.fn(async () => journal.port);
    const runtime = await createStudioOpfsRecoveryRuntime({
      probeCapabilities: () => ({
        fileSystemKind: "memory",
        originLockAvailable: true,
      }),
      createOpfsJournal: factory,
      existingRecoveryVault: fallback.vault,
    });

    expect(runtime.status()).toMatchObject({
      backend: "fail-closed",
      durable: false,
      state: "fail-closed",
      reason: "opfs-unavailable-no-compatible-vault",
    });
    await expect(runtime.scanLatest()).rejects.toEqual(
      expectRuntimeError("BACKEND_UNAVAILABLE"),
    );
    await expect(runtime.acquireWriter({ ownerId: "writer-a" })).rejects.toEqual(
      expectRuntimeError("BACKEND_UNAVAILABLE"),
    );
    expect(factory).not.toHaveBeenCalled();
    expect(journal.counts).toEqual(counters());
    expect(fallback.counts).toEqual(counters());
  });

  it("does not fail over to the vault when OPFS lacks an origin-wide lock", async () => {
    const fallback = createVaultFake(true);
    const factory = vi.fn(async () => createJournalFake().port);
    const runtime = await createStudioOpfsRecoveryRuntime({
      probeCapabilities: () => ({
        fileSystemKind: "opfs",
        originLockAvailable: false,
      }),
      createOpfsJournal: factory,
      existingRecoveryVault: fallback.vault,
    });
    expect(runtime.status()).toMatchObject({
      backend: "fail-closed",
      reason: "origin-lock-unavailable",
    });
    expect(factory).not.toHaveBeenCalled();
    expect(fallback.counts).toEqual(counters());
  });

  it("never falls back after the selected OPFS factory fails", async () => {
    const fallback = createVaultFake(true);
    const failure = new Error("OPFS journal construction failed");
    await expect(createStudioOpfsRecoveryRuntime({
      probeCapabilities: () => ({
        fileSystemKind: "opfs",
        originLockAvailable: true,
      }),
      createOpfsJournal: async () => {
        throw failure;
      },
      existingRecoveryVault: fallback.vault,
    })).rejects.toBe(failure);
    expect(fallback.counts).toEqual(counters());
  });
});

describe("StudioOpfsRecoveryRuntime recovery, writer, and failure semantics", () => {
  it("passes a corruption failure through and never scans the other backend", async () => {
    const corruption = new StudioOpfsRecoveryJournalError(
      "CORRUPT_MANIFEST",
      "corrupt",
    );
    const journal = createJournalFake({
      scan: async () => {
        throw corruption;
      },
    });
    const fallback = createVaultFake(true);
    const runtime = await createStudioOpfsRecoveryRuntime({
      probeCapabilities: () => ({
        fileSystemKind: "opfs",
        originLockAvailable: true,
      }),
      createOpfsJournal: () => journal.port,
      existingRecoveryVault: fallback.vault,
    });
    await expect(runtime.scanLatest()).rejects.toBe(corruption);
    expect(journal.counts.scan).toBe(1);
    expect(fallback.counts.scan).toBe(0);
  });

  it("owns one writer lease, reports it without its token, and permits reacquire after release", async () => {
    const journal = createJournalFake();
    const runtime = await createStudioOpfsRecoveryRuntime({
      probeCapabilities: () => ({
        fileSystemKind: "opfs",
        originLockAvailable: true,
      }),
      createOpfsJournal: () => journal.port,
    });
    await expect(runtime.appendCommand(operationInput())).rejects.toEqual(
      expectRuntimeError("WRITER_REQUIRED"),
    );
    const first = await runtime.acquireWriter({ ownerId: "writer-a" });
    expect(runtime.status().writer).toEqual({
      ownerId: "writer-a",
      epoch: first.epoch,
      acquiredAt: first.acquiredAt,
      expiresAt: first.expiresAt,
    });
    expect(runtime.status().writer).not.toHaveProperty("token");
    await expect(runtime.acquireWriter({ ownerId: "writer-b" })).rejects.toEqual(
      expectRuntimeError("WRITER_ALREADY_HELD"),
    );
    const renewed = await runtime.renewWriter();
    expect(runtime.status().writer?.expiresAt).toBe(renewed.expiresAt);
    await runtime.releaseWriter();
    expect(runtime.status().writer).toBeNull();
    await runtime.acquireWriter({ ownerId: "writer-b" });
    expect(journal.counts.acquire).toBe(2);
  });

  it("routes quota cleanup errors through OPFS without invoking the vault", async () => {
    const quotaError = new StudioOpfsRecoveryJournalError(
      "QUOTA_EXCEEDED",
      "quota",
    );
    const journal = createJournalFake();
    journal.port.evictObsolete = async () => {
      journal.counts.cleanup += 1;
      throw quotaError;
    };
    const fallback = createVaultFake(true);
    const runtime = await createStudioOpfsRecoveryRuntime({
      probeCapabilities: () => ({
        fileSystemKind: "opfs",
        originLockAvailable: true,
      }),
      createOpfsJournal: () => journal.port,
      existingRecoveryVault: fallback.vault,
    });
    await runtime.acquireWriter({ ownerId: "writer-a" });
    await expect(runtime.cleanupQuota()).rejects.toBe(quotaError);
    expect(fallback.counts.cleanup).toBe(0);
  });

  it("aborts an in-flight command, releases only the chosen writer, and rejects future work", async () => {
    let rejectAppend: ((error: unknown) => void) | null = null;
    const journal = createJournalFake({
      append: (_writer, _input, options) => new Promise((_resolve, reject) => {
        rejectAppend = reject;
        options?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      }),
    });
    const fallback = createVaultFake(true);
    const runtime = await createStudioOpfsRecoveryRuntime({
      probeCapabilities: () => ({
        fileSystemKind: "opfs",
        originLockAvailable: true,
      }),
      createOpfsJournal: () => journal.port,
      existingRecoveryVault: fallback.vault,
    });
    await runtime.acquireWriter({ ownerId: "writer-a" });
    const pending = runtime.appendCommand(operationInput());
    await vi.waitFor(() => expect(rejectAppend).toBeTypeOf("function"));
    await runtime.abort("document closed");
    await expect(pending).rejects.toEqual(expectRuntimeError("ABORTED"));
    expect(runtime.status()).toMatchObject({
      state: "aborted",
      writer: null,
      abortReason: "document closed",
      pendingOperations: 0,
    });
    expect(journal.counts.release).toBe(1);
    expect(fallback.counts.release).toBe(0);
    await expect(runtime.scanLatest()).rejects.toEqual(expectRuntimeError("ABORTED"));
  });
});

describe("StudioOpfsRecoveryRuntime pagehide flush", () => {
  it("flushes only the selected backend and removes the hook idempotently", async () => {
    const journal = createJournalFake();
    const fallback = createVaultFake(true);
    const flushOpfs = vi.fn(async () => undefined);
    const runtime = await createStudioOpfsRecoveryRuntime({
      probeCapabilities: () => ({
        fileSystemKind: "opfs",
        originLockAvailable: true,
      }),
      createOpfsJournal: () => journal.port,
      flushOpfsJournal: flushOpfs,
      existingRecoveryVault: fallback.vault,
    });
    const target = new FakePageHideTarget();
    const onError = vi.fn();
    const remove = runtime.installPageHideFlush(target, onError);
    target.dispatch();
    await vi.waitFor(() => expect(flushOpfs).toHaveBeenCalledTimes(1));
    expect(fallback.counts.flush).toBe(0);
    expect(onError).not.toHaveBeenCalled();
    remove();
    remove();
    expect(target.removeCount).toBe(1);
    target.dispatch();
    expect(flushOpfs).toHaveBeenCalledTimes(1);
  });

  it("waits for a command already in flight before the pagehide backend flush", async () => {
    const deferred: {
      resolve: ((value: StudioOpfsRecoveryEntry) => void) | null;
    } = { resolve: null };
    const order: string[] = [];
    const journal = createJournalFake({
      append: () => new Promise((resolve) => {
        deferred.resolve = (value) => {
          order.push("append");
          resolve(value);
        };
      }),
    });
    const runtime = await createStudioOpfsRecoveryRuntime({
      probeCapabilities: () => ({
        fileSystemKind: "opfs",
        originLockAvailable: true,
      }),
      createOpfsJournal: () => journal.port,
      flushOpfsJournal: async () => {
        order.push("flush");
      },
    });
    await runtime.acquireWriter({ ownerId: "writer-a" });
    const pending = runtime.appendCommand(operationInput());
    await vi.waitFor(() => expect(deferred.resolve).toBeTypeOf("function"));
    const target = new FakePageHideTarget();
    const onError = vi.fn();
    runtime.installPageHideFlush(target, onError);
    target.dispatch();
    await Promise.resolve();
    expect(order).toEqual([]);
    deferred.resolve?.(entry("operation", 1));
    await pending;
    await vi.waitFor(() => expect(order).toEqual(["append", "flush"]));
    expect(onError).not.toHaveBeenCalled();
  });
});
