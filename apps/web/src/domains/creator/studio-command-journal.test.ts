import { describe, expect, it } from "vitest";

import {
  STUDIO_COMMAND_JOURNAL_GENESIS_CHECKSUM,
  StudioCommandJournal,
  StudioCommandJournalError,
  canonicalStudioCommandJson,
  createStudioCommandEnvelope,
  createStudioCommandJournal,
  replayStudioCommandJournal,
  restoreStudioCommandJournal,
  serializeStudioCommandJournal,
  studioCommandPayloadChecksum,
  type StudioCommandEnvelope,
  type StudioCommandJournalErrorCode,
  type StudioCommandJsonValue,
} from "./studio-command-journal";

function expectJournalError(
  action: () => unknown,
  code: StudioCommandJournalErrorCode,
): StudioCommandJournalError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(StudioCommandJournalError);
    expect((error as StudioCommandJournalError).code).toBe(code);
    return error as StudioCommandJournalError;
  }
  throw new Error(`Expected StudioCommandJournalError(${code})`);
}

function command(
  overrides: Partial<{
    id: string;
    actorId: string;
    lamport: number;
    transactionId: string | null;
    groupId: string;
    kind: string;
    payload: StudioCommandJsonValue;
    inverseKind: string;
    inversePayload: StudioCommandJsonValue;
    extensions: Readonly<Record<string, StudioCommandJsonValue>>;
  }> = {},
): StudioCommandEnvelope {
  return createStudioCommandEnvelope({
    id: overrides.id ?? "command:1",
    actorId: overrides.actorId ?? "actor:a",
    lamport: overrides.lamport ?? 1,
    transactionId: overrides.transactionId ?? null,
    groupId: overrides.groupId ?? "group:1",
    command: {
      kind: overrides.kind ?? "object.patch",
      payload: overrides.payload ?? { value: 1 },
    },
    inverse: {
      kind: overrides.inverseKind ?? "object.patch",
      payload: overrides.inversePayload ?? { value: 0 },
    },
    extensions: overrides.extensions,
  });
}

describe("studio command envelope and canonical checksums", () => {
  it("pins stable typed identity fields and hashes payloads independently of object key order", () => {
    const left = { z: [3, { y: true, x: null }], a: -0 };
    const right = { a: 0, z: [3, { x: null, y: true }] };

    expect(canonicalStudioCommandJson(left)).toBe(canonicalStudioCommandJson(right));
    expect(studioCommandPayloadChecksum(left)).toBe(studioCommandPayloadChecksum(right));

    const envelope = command({
      id: "command:stable",
      actorId: "actor:stable",
      lamport: 42,
      transactionId: "transaction:stable",
      groupId: "group:stable",
      payload: left,
      extensions: { futureRenderer: { version: 7, mode: "spectral" } },
    });

    expect(envelope).toMatchObject({
      version: 1,
      recordType: "command",
      id: "command:stable",
      actorId: "actor:stable",
      lamport: 42,
      transactionId: "transaction:stable",
      groupId: "group:stable",
    });
    expect(envelope.command.payloadChecksum).toBe(studioCommandPayloadChecksum(right));
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.command)).toBe(true);
    expect(Object.isFrozen(envelope.command.payload)).toBe(true);
    expect(Object.isFrozen(envelope.extensions.futureRenderer)).toBe(true);
  });

  it("rejects lossy, executable, cyclic, sparse, and oversized JSON without invoking getters", () => {
    let getterCalls = 0;
    const accessor = {};
    Object.defineProperty(accessor, "secret", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "not-readable";
      },
    });
    expectJournalError(
      () => studioCommandPayloadChecksum(accessor as StudioCommandJsonValue),
      "INVALID_JSON",
    );
    expect(getterCalls).toBe(0);

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expectJournalError(
      () => studioCommandPayloadChecksum(cyclic as StudioCommandJsonValue),
      "INVALID_JSON",
    );
    expectJournalError(
      () => studioCommandPayloadChecksum({ invalid: Number.NaN }),
      "INVALID_JSON",
    );

    const sparse = new Array(2) as StudioCommandJsonValue[];
    sparse[1] = 1;
    expectJournalError(() => studioCommandPayloadChecksum(sparse), "INVALID_JSON");

    const journal = createStudioCommandJournal({
      limits: { maxPayloadBytes: 128 },
    });
    expectJournalError(
      () => journal.appendCommand(command({ payload: { text: "x".repeat(256) } })),
      "PAYLOAD_TOO_LARGE",
    );
    expect(journal.length).toBe(0);
    expect(journal.headChecksum).toBe(STUDIO_COMMAND_JOURNAL_GENESIS_CHECKSUM);
  });
});

describe("append-only identity, idempotency, and Lamport invariants", () => {
  it("deduplicates exact retries and fails closed on conflicting IDs or clock regression", () => {
    const journal = createStudioCommandJournal();
    const firstEnvelope = command();
    const first = journal.appendCommand(firstEnvelope);

    expect(first.status).toBe("appended");
    const firstHead = journal.headChecksum;
    const retry = journal.appendCommand(firstEnvelope);
    expect(retry).toMatchObject({
      status: "duplicate",
      sequence: 1,
      compacted: false,
    });
    expect(journal.length).toBe(1);
    expect(journal.headChecksum).toBe(firstHead);

    expectJournalError(
      () => journal.appendCommand(command({
        id: firstEnvelope.id,
        payload: { value: 999 },
      })),
      "DUPLICATE_CONFLICT",
    );
    expectJournalError(
      () => journal.appendCommand(command({
        id: "command:clock-reuse",
        lamport: 1,
        groupId: "group:clock-reuse",
      })),
      "LAMPORT_REGRESSION",
    );
    expect(journal.length).toBe(1);
    expect(journal.records[0]).toBe(first.record);
    expect(Object.isFrozen(journal.records[0])).toBe(true);
  });

  it("orders each actor independently and enforces the configured actor bound", () => {
    const journal = createStudioCommandJournal({ limits: { maxActors: 2 } });
    journal.appendCommand(command({
      id: "a:1",
      actorId: "actor:a",
      lamport: 100,
      groupId: "a:g1",
    }));
    journal.appendCommand(command({
      id: "b:1",
      actorId: "actor:b",
      lamport: 1,
      groupId: "b:g1",
    }));

    expectJournalError(
      () => journal.appendCommand(command({
        id: "c:1",
        actorId: "actor:c",
        lamport: 1,
        groupId: "c:g1",
      })),
      "ACTOR_LIMIT_EXCEEDED",
    );
    expect(journal.length).toBe(2);
  });

  it("rejects a mutated envelope whose pinned payload checksum is stale", () => {
    const envelope = command();
    const poisoned = {
      ...envelope,
      command: {
        ...envelope.command,
        payload: { value: 2 },
      },
    };
    const journal = createStudioCommandJournal();
    expectJournalError(
      () => journal.appendCommand(poisoned),
      "CORRUPT_PAYLOAD",
    );
    expect(journal.length).toBe(0);
  });
});

describe("transactions and grouped inverse records", () => {
  it("stages a transaction, commits it as one replay batch, and makes retries idempotent", () => {
    const journal = createStudioCommandJournal();
    const beginInput = {
      id: "begin:1",
      actorId: "actor:a",
      lamport: 1,
      transactionId: "transaction:1",
      groupId: "group:transaction",
      extensions: { uiIntent: "drag" },
    } as const;
    journal.beginTransaction(beginInput);
    expect(journal.beginTransaction(beginInput).status).toBe("duplicate");

    journal.appendCommand(command({
      id: "command:tx:1",
      lamport: 2,
      transactionId: "transaction:1",
      groupId: "group:transaction",
      payload: { value: 1 },
      inversePayload: { value: 0 },
    }));
    journal.appendCommand(command({
      id: "command:tx:2",
      lamport: 3,
      transactionId: "transaction:1",
      groupId: "group:transaction",
      payload: { value: 2 },
      inversePayload: { value: 1 },
    }));

    expect(journal.activeTransactionId("actor:a")).toBe("transaction:1");
    expect(journal.canUndo("actor:a")).toBe(false);
    expect(journal.replayPlan().batches).toEqual([]);

    const commitInput = {
      id: "commit:1",
      actorId: "actor:a",
      lamport: 4,
      transactionId: "transaction:1",
      groupId: "group:transaction",
      extensions: { durable: true },
    } as const;
    journal.commitTransaction(commitInput);
    expect(journal.commitTransaction(commitInput).status).toBe("duplicate");

    const plan = replayStudioCommandJournal(journal);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]).toMatchObject({
      mode: "apply",
      actorId: "actor:a",
      groupId: "group:transaction",
      transactionId: "transaction:1",
      sequence: 4,
    });
    expect(plan.batches[0]?.operations.map((operation) => operation.sourceCommandId)).toEqual([
      "command:tx:1",
      "command:tx:2",
    ]);
    expect(journal.peekUndoGroup("actor:a")).toBe("group:transaction");
  });

  it("aborts staged commands append-only without exposing them to replay or undo", () => {
    const journal = createStudioCommandJournal();
    journal.beginTransaction({
      id: "begin:abort",
      actorId: "actor:a",
      lamport: 1,
      transactionId: "transaction:abort",
      groupId: "group:abort",
    });
    journal.appendCommand(command({
      id: "command:aborted",
      lamport: 2,
      transactionId: "transaction:abort",
      groupId: "group:abort",
    }));
    journal.abortTransaction({
      id: "abort:1",
      actorId: "actor:a",
      lamport: 3,
      transactionId: "transaction:abort",
      groupId: "group:abort",
    });

    expect(journal.records.map((record) => record.recordType)).toEqual([
      "transaction-begin",
      "command",
      "transaction-abort",
    ]);
    expect(journal.replayPlan().batches).toEqual([]);
    expect(journal.canUndo("actor:a")).toBe(false);
    expectJournalError(
      () => journal.undo({
        id: "undo:aborted",
        actorId: "actor:a",
        lamport: 4,
        groupId: "group:abort",
      }),
      "UNDO_EMPTY",
    );
  });

  it("fails closed on empty, mismatched, nested, and bypassed transaction paths", () => {
    const journal = createStudioCommandJournal();
    journal.beginTransaction({
      id: "begin:1",
      actorId: "actor:a",
      lamport: 1,
      transactionId: "transaction:1",
      groupId: "group:1",
    });
    const length = journal.length;

    expectJournalError(
      () => journal.commitTransaction({
        id: "commit:empty",
        actorId: "actor:a",
        lamport: 2,
        transactionId: "transaction:1",
        groupId: "group:1",
      }),
      "EMPTY_TRANSACTION",
    );
    expectJournalError(
      () => journal.beginTransaction({
        id: "begin:nested",
        actorId: "actor:a",
        lamport: 2,
        transactionId: "transaction:2",
        groupId: "group:2",
      }),
      "TRANSACTION_ALREADY_ACTIVE",
    );
    expectJournalError(
      () => journal.appendCommand(command({
        id: "command:bypass",
        lamport: 2,
        transactionId: null,
        groupId: "group:bypass",
      })),
      "TRANSACTION_MISMATCH",
    );
    expectJournalError(
      () => journal.appendCommand(command({
        id: "command:wrong-group",
        lamport: 2,
        transactionId: "transaction:1",
        groupId: "group:wrong",
      })),
      "TRANSACTION_MISMATCH",
    );
    expect(journal.length).toBe(length);

    journal.abortTransaction({
      id: "abort:empty",
      actorId: "actor:a",
      lamport: 2,
      transactionId: "transaction:1",
      groupId: "group:1",
    });
    expectJournalError(
      () => journal.beginTransaction({
        id: "begin:reused-transaction",
        actorId: "actor:a",
        lamport: 3,
        transactionId: "transaction:1",
        groupId: "group:new",
      }),
      "TRANSACTION_REUSED",
    );
  });

  it("undoes a group in inverse order and redoes it in original order", () => {
    const journal = createStudioCommandJournal();
    journal.appendCommand(command({
      id: "command:1",
      lamport: 1,
      groupId: "group:drag",
      kind: "value.set",
      payload: { value: 1 },
      inversePayload: { value: 0 },
    }));
    journal.appendCommand(command({
      id: "command:2",
      lamport: 2,
      groupId: "group:drag",
      kind: "value.set",
      payload: { value: 2 },
      inversePayload: { value: 1 },
    }));

    const undo = journal.undo({
      id: "undo:1",
      actorId: "actor:a",
      lamport: 3,
      groupId: "group:drag",
      extensions: { source: "keyboard" },
    });
    expect(undo.status).toBe("appended");
    if (undo.status !== "appended") throw new Error("Expected appended undo");
    expect(undo.record.operations.map((operation) => ({
      id: operation.sourceCommandId,
      payload: operation.payload,
    }))).toEqual([
      { id: "command:2", payload: { value: 1 } },
      { id: "command:1", payload: { value: 0 } },
    ]);
    expect(journal.undo({
      id: "undo:1",
      actorId: "actor:a",
      lamport: 3,
      groupId: "group:drag",
      extensions: { source: "keyboard" },
    }).status).toBe("duplicate");

    const redo = journal.redo({
      id: "redo:1",
      actorId: "actor:a",
      lamport: 4,
      groupId: "group:drag",
    });
    expect(redo.status).toBe("appended");
    if (redo.status !== "appended") throw new Error("Expected appended redo");
    expect(redo.record.operations.map((operation) => ({
      id: operation.sourceCommandId,
      payload: operation.payload,
    }))).toEqual([
      { id: "command:1", payload: { value: 1 } },
      { id: "command:2", payload: { value: 2 } },
    ]);
    expect(journal.peekUndoGroup("actor:a")).toBe("group:drag");
    expect(journal.peekRedoGroup("actor:a")).toBeNull();
    expectJournalError(
      () => journal.appendCommand(command({
        id: "command:after-redo",
        lamport: 5,
        groupId: "group:drag",
      })),
      "GROUP_REOPENED",
    );
  });

  it("prevents stale group targeting, group reopening, and redo after a divergent command", () => {
    const journal = createStudioCommandJournal();
    journal.appendCommand(command({ id: "command:1", groupId: "group:1", lamport: 1 }));
    journal.appendCommand(command({ id: "command:2", groupId: "group:2", lamport: 2 }));

    expectJournalError(
      () => journal.undo({
        id: "undo:wrong",
        actorId: "actor:a",
        lamport: 3,
        groupId: "group:1",
      }),
      "UNDO_GROUP_MISMATCH",
    );
    journal.undo({
      id: "undo:2",
      actorId: "actor:a",
      lamport: 3,
      groupId: "group:2",
    });
    journal.appendCommand(command({
      id: "command:divergent",
      groupId: "group:3",
      lamport: 4,
    }));

    expectJournalError(
      () => journal.redo({
        id: "redo:stale",
        actorId: "actor:a",
        lamport: 5,
        groupId: "group:2",
      }),
      "REDO_EMPTY",
    );
    expectJournalError(
      () => journal.appendCommand(command({
        id: "command:reopen",
        groupId: "group:1",
        lamport: 5,
      })),
      "GROUP_REOPENED",
    );
  });
});

describe("replay integrity and corruption detection", () => {
  it("produces deterministic head and replay checksums across serialization and restore", () => {
    const journal = createStudioCommandJournal();
    journal.appendCommand(command({ id: "command:1", lamport: 1, groupId: "group:1" }));
    journal.undo({
      id: "undo:1",
      actorId: "actor:a",
      lamport: 2,
      groupId: "group:1",
    });
    journal.redo({
      id: "redo:1",
      actorId: "actor:a",
      lamport: 3,
      groupId: "group:1",
    });
    const before = journal.replayPlan();

    const serialized = serializeStudioCommandJournal(journal);
    const restored = restoreStudioCommandJournal(serialized);
    const after = restored.replayPlan();

    expect(after).toEqual(before);
    expect(restored.serialize()).toBe(serialized);
    expect(after.batches.map((batch) => batch.mode)).toEqual(["apply", "undo", "redo"]);
    expect(after.headChecksum).toBe(journal.headChecksum);
    expect(after.replayChecksum).toBe(journal.replayChecksum);
  });

  it("detects payload, record, chain, manifest, and version corruption with typed errors", () => {
    const journal = createStudioCommandJournal();
    journal.appendCommand(command({ id: "command:1", lamport: 1, groupId: "group:1" }));
    journal.appendCommand(command({ id: "command:2", lamport: 2, groupId: "group:2" }));
    const source = JSON.parse(journal.serialize());

    const payloadCorruption = structuredClone(source);
    payloadCorruption.records[0].command.payload.value = 999;
    expectJournalError(
      () => restoreStudioCommandJournal(JSON.stringify(payloadCorruption)),
      "CORRUPT_PAYLOAD",
    );

    const recordCorruption = structuredClone(source);
    recordCorruption.records[0].extensions.unchecked = true;
    expectJournalError(
      () => restoreStudioCommandJournal(JSON.stringify(recordCorruption)),
      "CORRUPT_RECORD",
    );

    const chainCorruption = structuredClone(source);
    chainCorruption.records.reverse();
    expectJournalError(
      () => restoreStudioCommandJournal(JSON.stringify(chainCorruption)),
      "CORRUPT_CHAIN",
    );

    const manifestCorruption = structuredClone(source);
    manifestCorruption.extensions.future = "tampered";
    expectJournalError(
      () => restoreStudioCommandJournal(JSON.stringify(manifestCorruption)),
      "CORRUPT_SERIALIZATION",
    );

    const unsupported = structuredClone(source);
    unsupported.version = 999;
    expectJournalError(
      () => restoreStudioCommandJournal(JSON.stringify(unsupported)),
      "UNSUPPORTED_VERSION",
    );
  });

  it("restores an open transaction without replaying it and can commit it later", () => {
    const journal = createStudioCommandJournal();
    journal.beginTransaction({
      id: "begin:1",
      actorId: "actor:a",
      lamport: 1,
      transactionId: "transaction:1",
      groupId: "group:1",
    });
    journal.appendCommand(command({
      id: "command:1",
      lamport: 2,
      transactionId: "transaction:1",
      groupId: "group:1",
    }));

    const restored = StudioCommandJournal.restore(journal.serialize());
    expect(restored.activeTransactionId("actor:a")).toBe("transaction:1");
    expect(restored.replayPlan().batches).toEqual([]);
    restored.commitTransaction({
      id: "commit:1",
      actorId: "actor:a",
      lamport: 3,
      transactionId: "transaction:1",
      groupId: "group:1",
    });
    expect(restored.replayPlan().batches).toHaveLength(1);
  });
});

describe("bounded retention and compaction checkpoints", () => {
  it("stops at the record bound, compacts explicitly, and anchors subsequent records", () => {
    const journal = createStudioCommandJournal<{ documentVersion: number }>({
      limits: { maxRecords: 4 },
    });
    const envelopes = [1, 2, 3, 4].map((index) => command({
      id: `command:${index}`,
      lamport: index,
      groupId: `group:${index}`,
      payload: { value: index },
      inversePayload: { value: index - 1 },
    }));
    for (const envelope of envelopes) journal.appendCommand(envelope);

    const fullHead = journal.headChecksum;
    const fullReplay = journal.replayChecksum;
    expectJournalError(
      () => journal.appendCommand(command({
        id: "command:5",
        lamport: 5,
        groupId: "group:5",
      })),
      "JOURNAL_LIMIT_EXCEEDED",
    );
    expect(journal.length).toBe(4);

    const checkpoint = journal.compact({
      id: "checkpoint:1",
      state: { documentVersion: 4 },
      extensions: { futureCodec: { name: "zstd", level: 3 } },
    });
    expect(checkpoint.compactedHeadChecksum).toBe(fullHead);
    expect(checkpoint.replayChecksum).toBe(fullReplay);
    expect(journal.length).toBe(0);
    expect(journal.canUndo("actor:a")).toBe(false);
    expect(journal.replayChecksum).toBe(fullReplay);
    expect(journal.headChecksum).toBe(checkpoint.checkpointChecksum);

    const compactedRetry = journal.appendCommand(envelopes[0]!);
    expect(compactedRetry).toMatchObject({
      status: "duplicate",
      record: null,
      sequence: 1,
      compacted: true,
    });
    expectJournalError(
      () => journal.appendCommand(command({
        id: "command:old-new-id",
        lamport: 4,
        groupId: "group:old-new-id",
      })),
      "LAMPORT_REGRESSION",
    );

    const next = journal.appendCommand(command({
      id: "command:5",
      lamport: 5,
      groupId: "group:5",
      payload: { value: 5 },
      inversePayload: { value: 4 },
    }));
    expect(next.status).toBe("appended");
    if (next.status !== "appended") throw new Error("Expected appended command");
    expect(next.record.previousChecksum).toBe(checkpoint.checkpointChecksum);
    expect(next.record.sequence).toBe(5);

    const restored = restoreStudioCommandJournal<{ documentVersion: number }>(
      journal.serialize(),
    );
    expect(restored.checkpoint?.state).toEqual({ documentVersion: 4 });
    expect(restored.records).toHaveLength(1);
    expect(restored.replayPlan().batches).toHaveLength(1);
  });

  it("keeps idempotency evidence bounded and fails closed after evidence ages out", () => {
    const journal = createStudioCommandJournal({
      limits: { maxRecords: 4, maxIdempotencyKeys: 2 },
    });
    const envelopes = [1, 2, 3].map((index) => command({
      id: `command:${index}`,
      lamport: index,
      groupId: `group:${index}`,
    }));
    for (const envelope of envelopes) journal.appendCommand(envelope);
    const checkpoint = journal.compact({ id: "checkpoint:1", state: { version: 1 } });

    expect(checkpoint.idempotency.map((entry) => entry.id)).toEqual([
      "command:2",
      "command:3",
    ]);
    expect(journal.appendCommand(envelopes[1]!)).toMatchObject({
      status: "duplicate",
      compacted: true,
    });
    expectJournalError(
      () => journal.appendCommand(envelopes[0]!),
      "DUPLICATE_CONFLICT",
    );
    expectJournalError(
      () => journal.appendCommand(command({
        id: "command:1",
        actorId: "actor:other",
        lamport: 1,
        groupId: "other:group",
      })),
      "DUPLICATE_CONFLICT",
    );
    expect(journal.length).toBe(0);
  });

  it("reserves transaction closure capacity and rejects compaction while one is open", () => {
    const journal = createStudioCommandJournal({ limits: { maxRecords: 4 } });
    journal.appendCommand(command({
      id: "standalone:1",
      lamport: 1,
      groupId: "standalone:1",
    }));
    journal.beginTransaction({
      id: "begin:1",
      actorId: "actor:a",
      lamport: 2,
      transactionId: "transaction:1",
      groupId: "group:transaction",
    });
    journal.appendCommand(command({
      id: "command:transaction",
      lamport: 3,
      transactionId: "transaction:1",
      groupId: "group:transaction",
    }));

    expectJournalError(
      () => journal.appendCommand(command({
        id: "command:overflow",
        lamport: 4,
        transactionId: "transaction:1",
        groupId: "group:transaction",
      })),
      "JOURNAL_LIMIT_EXCEEDED",
    );
    expectJournalError(
      () => journal.compact({ id: "checkpoint:open", state: {} }),
      "INVALID_COMPACTION",
    );
    journal.abortTransaction({
      id: "abort:1",
      actorId: "actor:a",
      lamport: 4,
      transactionId: "transaction:1",
      groupId: "group:transaction",
    });
    expect(journal.length).toBe(4);
  });
});

describe("incremental append verification", () => {
  it("advances the verified frontier without rescanning retained history", () => {
    const journal = createStudioCommandJournal({
      limits: { maxRecords: 1_024 },
    });
    const before = journal.verificationStats;

    for (let index = 1; index <= 512; index += 1) {
      journal.appendCommand(command({
        id: `command:incremental:${index}`,
        lamport: index,
        groupId: `group:incremental:${index}`,
        payload: { index, x: index * 2 },
        inversePayload: { index, x: index * 2 - 1 },
      }));
    }

    const afterAppends = journal.verificationStats;
    expect(afterAppends.fullScanCount).toBe(before.fullScanCount);
    expect(afterAppends.incrementalRecordCount - before.incrementalRecordCount).toBe(512);
    expect(journal.length).toBe(512);

    const plan = journal.replayPlan();
    expect(plan.recordCount).toBe(512);
    expect(plan.batches).toHaveLength(512);
    expect(journal.verificationStats).toEqual({
      fullScanCount: before.fullScanCount + 1,
      incrementalRecordCount: before.incrementalRecordCount + 512,
    });
  });

  it("matches a full restore scan after a long coalesced group plus undo and redo", () => {
    const journal = createStudioCommandJournal({
      limits: { maxRecords: 512 },
    });
    for (let index = 1; index <= 256; index += 1) {
      journal.appendCommand(command({
        id: `command:stroke:${index}`,
        lamport: index,
        groupId: "group:stroke",
        payload: { point: [index, index + 0.5] },
        inversePayload: { point: [index - 1, index - 0.5] },
      }));
    }
    journal.undo({
      id: "undo:stroke",
      actorId: "actor:a",
      lamport: 257,
      groupId: "group:stroke",
    });
    journal.redo({
      id: "redo:stroke",
      actorId: "actor:a",
      lamport: 258,
      groupId: "group:stroke",
    });

    const incrementalPlan = journal.replayPlan();
    const restored = restoreStudioCommandJournal(journal.serialize());
    const fullyScannedPlan = restored.replayPlan();

    expect(fullyScannedPlan).toEqual(incrementalPlan);
    expect(restored.headChecksum).toBe(journal.headChecksum);
    expect(restored.replayChecksum).toBe(journal.replayChecksum);
    expect(journal.verificationStats.incrementalRecordCount).toBe(258);
  });
});

describe("forward-compatible extension metadata", () => {
  it("preserves unknown journal, record, and checkpoint extensions without prototype pollution", () => {
    const journalExtensions = JSON.parse(
      '{"futureJournal":{"revision":9},"__proto__":{"polluted":"no"}}',
    );
    const recordExtensions = JSON.parse(
      '{"plugin.example":{"opaque":[1,{"flag":true}]},"__proto__":{"record":"safe"}}',
    );
    const checkpointExtensions = JSON.parse(
      '{"futureCheckpoint":{"codec":"v7"},"__proto__":{"checkpoint":"safe"}}',
    );
    const journal = createStudioCommandJournal({
      extensions: journalExtensions,
    });
    journal.appendCommand(command({
      extensions: recordExtensions,
    }));
    journal.compact({
      id: "checkpoint:extensions",
      state: { state: "opaque" },
      extensions: checkpointExtensions,
    });

    const serialized = journal.serialize();
    const restored = restoreStudioCommandJournal(serialized);
    expect(restored.extensions).toEqual(journalExtensions);
    expect(restored.checkpoint?.extensions).toEqual(checkpointExtensions);
    expect(Object.hasOwn(restored.extensions, "__proto__")).toBe(true);
    expect(Object.hasOwn(restored.checkpoint!.extensions, "__proto__")).toBe(true);
    expect((Object.prototype as { polluted?: string }).polluted).toBeUndefined();

    const compactedRecord = restored.checkpoint?.idempotency.find(
      (entry) => entry.id === "command:1",
    );
    expect(compactedRecord?.recordType).toBe("command");
    expect(restored.serialize()).toBe(serialized);
  });

  it("preserves record extensions through an uncompacted restore", () => {
    const extensions = {
      "future.vendor": {
        wireVersion: 23,
        nested: ["unknown", { still: "opaque" }],
      },
    } as const;
    const journal = createStudioCommandJournal();
    journal.appendCommand(command({ extensions }));

    const restored = restoreStudioCommandJournal(journal.serialize());
    expect(restored.records[0]?.extensions).toEqual(extensions);
    expect(Object.isFrozen(restored.records[0]?.extensions)).toBe(true);
    expect(restored.serialize()).toBe(journal.serialize());
  });
});
