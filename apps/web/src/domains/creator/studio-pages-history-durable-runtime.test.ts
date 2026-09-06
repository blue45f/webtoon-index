import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SqliteUnavailableError } from "./studio-local-database";
import {
  StudioOpfsRecoveryJournalError,
  type StudioOpfsRecoveryAppendInput,
  type StudioOpfsRecoveryCheckpointInput,
  type StudioOpfsRecoveryEntry,
  type StudioOpfsRecoveryScan,
  type StudioOpfsRecoveryWriterLease,
} from "./studio-opfs-recovery-journal";
import {
  createStudioPagesHistoryCommandJournal,
  type StudioHistoryJournalNavigationTarget,
} from "./studio-pages-history-command-journal";
import {
  createDefaultStudioPagesHistoryDurableRuntime,
  createStudioPagesHistoryIndexedDbRecoveryVault,
  StudioPagesHistoryDurabilityUnavailableError,
  StudioPagesHistoryDurableRuntime,
} from "./studio-pages-history-durable-runtime";

const IDENTITY = {
  documentId: "history-test-document",
  documentVersion: 1,
  engineVersion: "studio-pages-history-command-journal-1",
} as const;

const EMPTY_SCAN: StudioOpfsRecoveryScan = Object.freeze({
  generation: 0,
  writerEpoch: 0,
  lastSequence: 0,
  totalPayloadBytes: 0,
  entries: Object.freeze([]),
  selectedSlot: null,
  ignoredSlots: Object.freeze([]),
});

function target(elementCount: number): StudioHistoryJournalNavigationTarget {
  return {
    historyIndex: elementCount,
    pages: [{
      id: "page-1",
      elements: Array.from({ length: elementCount }, (_, index) => ({
        id: `element-${index}`,
      })),
      canvasH: 2_000,
    }],
  };
}

function transition(previousCount: number, nextCount: number, coalesceKey?: string) {
  return {
    mutationKind: coalesceKey ? "transform.drag" : "elements.commit",
    previousPages: target(previousCount).pages,
    nextPages: target(nextCount).pages,
    previousHistoryIndex: previousCount,
    nextHistoryIndex: nextCount,
    ...(coalesceKey ? { coalesceKey } : {}),
  };
}

function publicEntry(
  kind: "operation" | "checkpoint",
  sequence: number,
  revision: number,
): StudioOpfsRecoveryEntry {
  return Object.freeze({
    kind,
    id: `${kind}-${revision}`,
    sequence,
    pageId: "page-history",
    revision,
    documentId: IDENTITY.documentId,
    documentVersion: IDENTITY.documentVersion,
    engineVersion: IDENTITY.engineVersion,
    writerEpoch: 1,
    createdAt: 1_000 + revision,
    byteLength: 10,
    chunks: Object.freeze([]),
    compactThroughSequence: kind === "checkpoint" ? sequence - 1 : null,
    descriptorPath: `descriptor-${sequence}`,
    descriptorCrc32: sequence,
  });
}

class FakeRecovery {
  readonly commands: StudioOpfsRecoveryAppendInput[] = [];
  readonly checkpoints: StudioOpfsRecoveryCheckpointInput[] = [];
  flushCount = 0;
  abortCount = 0;
  failNextCommand: Error | null = null;
  sequence = 0;

  async scanLatest(): Promise<StudioOpfsRecoveryScan> {
    return EMPTY_SCAN;
  }

  async acquireWriter(): Promise<StudioOpfsRecoveryWriterLease> {
    return Object.freeze({
      documentId: IDENTITY.documentId,
      ownerId: "writer-a",
      token: "token-a",
      epoch: 1,
      acquiredAt: 1_000,
      expiresAt: 31_000,
    });
  }

  async appendCommand(input: StudioOpfsRecoveryAppendInput): Promise<StudioOpfsRecoveryEntry> {
    this.commands.push(input);
    if (this.failNextCommand) {
      const failure = this.failNextCommand;
      this.failNextCommand = null;
      throw failure;
    }
    this.sequence += 1;
    return publicEntry("operation", this.sequence, input.revision);
  }

  async compact(input: StudioOpfsRecoveryCheckpointInput): Promise<StudioOpfsRecoveryEntry> {
    this.checkpoints.push(input);
    this.sequence += 1;
    return publicEntry("checkpoint", this.sequence, input.revision);
  }

  async flush(): Promise<void> {
    this.flushCount += 1;
  }

  async abort(): Promise<void> {
    this.abortCount += 1;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Studio pages history durable runtime", () => {
  it("uses explicit memory-only state without opening IndexedDB when SQLite and OPFS are unavailable", async () => {
    const indexedDB = new IDBFactory();
    const indexedDbOpen = vi.spyOn(indexedDB, "open");
    const onError = vi.fn();
    const onDurabilityStatus = vi.fn();
    const runtime = await createDefaultStudioPagesHistoryDurableRuntime(
      {
        initialTarget: target(0),
        openDatabase: () => Promise.reject(new SqliteUnavailableError("OPFS SAH pool unavailable")),
        onError,
        onDurabilityStatus,
      },
      {
        indexedDB,
        navigator: { storage: {} },
        crypto: {
          randomUUID: () => "11111111-1111-4111-8111-111111111111",
        },
      },
    );

    runtime.recordTransition(transition(0, 1));
    await runtime.flush();
    expect(runtime.replayPlan()).toMatchObject({
      recordCount: 1,
    });
    expect(runtime.persistenceKind).toBe("memory-only");
    expect(runtime.durabilityStatus()).toMatchObject({
      state: "memory-only",
      durable: false,
      retryable: true,
      cause: expect.any(StudioPagesHistoryDurabilityUnavailableError),
    });
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(
      StudioPagesHistoryDurabilityUnavailableError,
    );
    expect(onDurabilityStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: "memory-only", durable: false }),
    );
    expect(indexedDbOpen).not.toHaveBeenCalled();
    await runtime.close();
  });

  it("uses IndexedDB only when a caller passes the explicit legacy recovery vault", async () => {
    const indexedDB = new IDBFactory();
    const indexedDbOpen = vi.spyOn(indexedDB, "open");
    const vault = createStudioPagesHistoryIndexedDbRecoveryVault({
      identity: {
        documentId: "history-legacy-opt-in",
        documentVersion: 1,
        engineVersion: "studio-pages-history-command-journal-1",
      },
      indexedDB,
      randomToken: () => "legacy-opt-in-token",
    });
    const runtime = await createDefaultStudioPagesHistoryDurableRuntime(
      {
        initialTarget: target(0),
        preferSqlite: false,
        legacyRecoveryVault: vault,
      },
      {
        navigator: { storage: {} },
        crypto: {
          randomUUID: () => "22222222-2222-4222-8222-222222222222",
        },
      },
    );

    runtime.recordTransition(transition(0, 1));
    await runtime.flush();
    expect(runtime.durabilityStatus()).toMatchObject({
      state: "durable",
      persistenceKind: "legacy-indexeddb",
    });
    expect(indexedDbOpen).toHaveBeenCalled();
    await runtime.close();
  });

  it("keeps history synchronous while serializing one command stream to one backend", async () => {
    const recovery = new FakeRecovery();
    const commandJournal = createStudioPagesHistoryCommandJournal();
    const runtime = new StudioPagesHistoryDurableRuntime({
      commandJournal,
      recovery,
      initialScan: EMPTY_SCAN,
      pageId: "page-history",
      eventTarget: null,
    });

    runtime.recordTransition(transition(0, 1));
    runtime.recordTransition(transition(1, 2));
    expect(commandJournal.replayPlan().recordCount).toBe(2);
    await runtime.flush();

    expect(recovery.commands).toHaveLength(2);
    expect(recovery.checkpoints).toHaveLength(0);
    expect(recovery.commands.map(({ revision }) => revision)).toEqual([1, 2]);
    expect(recovery.flushCount).toBe(1);
  });

  it("debounces pointer-coalesced persistence without changing the in-memory undo group", async () => {
    vi.useFakeTimers();
    const recovery = new FakeRecovery();
    const commandJournal = createStudioPagesHistoryCommandJournal();
    const runtime = new StudioPagesHistoryDurableRuntime({
      commandJournal,
      recovery,
      initialScan: EMPTY_SCAN,
      pageId: "page-history",
      eventTarget: null,
    });

    for (let index = 0; index < 40; index += 1) {
      runtime.recordTransition(transition(index, index + 1, "transform:selected"));
    }
    expect(recovery.commands).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(350);
    await runtime.flush();

    expect(recovery.commands).toHaveLength(1);
    expect(commandJournal.replayPlan().recordCount).toBe(1);
  });

  it("writes rebase as a checkpoint and stops durable writes after one backend failure", async () => {
    const failure = new Error("selected OPFS write failed");
    const onError = vi.fn();
    const recovery = new FakeRecovery();
    const commandJournal = createStudioPagesHistoryCommandJournal();
    const onDurabilityStatus = vi.fn();
    const runtime = new StudioPagesHistoryDurableRuntime({
      commandJournal,
      recovery,
      initialScan: EMPTY_SCAN,
      pageId: "page-history",
      eventTarget: null,
      onError,
      onDurabilityStatus,
      persistenceKind: "native-opfs",
    });

    runtime.rebase(target(1));
    await runtime.flush();
    expect(recovery.checkpoints).toHaveLength(1);
    recovery.failNextCommand = failure;
    runtime.recordTransition(transition(1, 2));
    await runtime.flush();
    runtime.recordTransition(transition(2, 3));
    await runtime.flush();

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(onDurabilityStatus).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ state: "durable", persistenceKind: "native-opfs" }),
    );
    expect(onDurabilityStatus).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ state: "memory-only", cause: failure }),
    );
    expect(runtime.durabilityStatus()).toMatchObject({
      state: "memory-only",
      retryable: true,
      cause: failure,
    });
    expect(recovery.commands).toHaveLength(1);
    expect(commandJournal.replayPlan().recordCount).toBeGreaterThan(1);
  });

  it("does not treat a two-tab journal lease loss as a diagnostic crash", async () => {
    const onError = vi.fn();
    const recovery = new FakeRecovery();
    const commandJournal = createStudioPagesHistoryCommandJournal();
    const runtime = new StudioPagesHistoryDurableRuntime({
      commandJournal,
      recovery,
      initialScan: EMPTY_SCAN,
      pageId: "page-history",
      eventTarget: null,
      onError,
      persistenceKind: "native-opfs",
    });
    recovery.failNextCommand = new StudioOpfsRecoveryJournalError(
      "LEASE_LOST",
      "OPFS 복구 저널 writer lease가 만료되었거나 교체되었습니다.",
    );

    runtime.recordTransition(transition(0, 1));
    await runtime.flush();

    expect(onError).not.toHaveBeenCalled();
    expect(runtime.durabilityStatus()).toMatchObject({
      state: "memory-only",
      retryable: true,
    });
    await runtime.close();
  });
});

describe("Studio pages history IndexedDB compatible fallback", () => {
  it("preserves exact bytes, writer fencing, scan, and checkpoint compaction", async () => {
    const indexedDB = new IDBFactory();
    let now = 1_000;
    let token = 0;
    const vault = createStudioPagesHistoryIndexedDbRecoveryVault({
      identity: IDENTITY,
      indexedDB,
      now: () => now,
      randomToken: () => `token-${++token}`,
    });

    expect(vault.compatible).toBe(true);
    const writer = await vault.acquireWriter({ ownerId: "writer-a" });
    await vault.appendOperation(writer, {
      id: "command-1",
      pageId: "page-history",
      revision: 1,
      payload: new Uint8Array([1, 2, 3]),
    });
    const before = await vault.scan();
    expect(before).toMatchObject({
      generation: 1,
      lastSequence: 1,
      totalPayloadBytes: 3,
    });
    expect(before.entries).toHaveLength(1);

    await vault.compact(writer, {
      id: "checkpoint-2",
      pageId: "page-history",
      revision: 2,
      payload: new Uint8Array([9, 8]),
      compactThroughSequence: 1,
    });
    const after = await vault.scan();
    expect(after.entries).toEqual([
      expect.objectContaining({
        kind: "checkpoint",
        sequence: 2,
        revision: 2,
        byteLength: 2,
        descriptorCrc32: expect.any(Number),
      }),
    ]);

    const contender = createStudioPagesHistoryIndexedDbRecoveryVault({
      identity: IDENTITY,
      indexedDB,
      now: () => now,
      randomToken: () => "contender-token",
    });
    await expect(contender.acquireWriter({ ownerId: "writer-b" })).rejects.toMatchObject({
      code: "LEASE_BUSY",
    });
    await vault.releaseWriter(writer);
    now += 1;
    await expect(contender.acquireWriter({ ownerId: "writer-b" })).resolves.toMatchObject({
      ownerId: "writer-b",
      epoch: 2,
    });
  });

  it("is explicitly incompatible and fail-safe without IndexedDB", async () => {
    const vault = createStudioPagesHistoryIndexedDbRecoveryVault({
      identity: IDENTITY,
      indexedDB: null,
    });
    expect(vault.compatible).toBe(false);
    await expect(vault.scan()).rejects.toMatchObject({
      code: "OPFS_UNAVAILABLE",
    });
  });
});
