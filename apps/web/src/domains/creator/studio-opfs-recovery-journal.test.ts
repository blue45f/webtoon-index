import { describe, expect, it, vi } from "vitest";

import {
  createStudioOpfsRecoveryJournal,
  decideStudioOpfsRecoveryBackend,
  describeStudioOpfsRecoveryJournalError,
  StudioOpfsRecoveryJournalError,
  type StudioOpfsRecoveryByteSource,
  type StudioOpfsRecoveryJournalAdapter,
  type StudioOpfsRecoveryJournalLimits,
  type StudioOpfsRecoveryWriterLease,
} from "./studio-opfs-recovery-journal";

type WriteFaultMode = "before" | "torn" | "after";

interface WriteFault {
  readonly call: number;
  readonly mode: WriteFaultMode;
}

class FakeOpfsAdapter implements StudioOpfsRecoveryJournalAdapter {
  readonly kind = "fake-opfs" as const;
  readonly files: Map<string, Uint8Array>;
  writeCalls = 0;
  quota: number | null = null;
  fault: WriteFault | null = null;

  constructor(snapshot: ReadonlyMap<string, Uint8Array> = new Map()) {
    this.files = new Map(
      [...snapshot].map(([path, bytes]) => [path, new Uint8Array(bytes)]),
    );
  }

  clone(): FakeOpfsAdapter {
    const clone = new FakeOpfsAdapter(this.files);
    clone.quota = this.quota;
    return clone;
  }

  armRelativeWriteFault(relativeCall: number, mode: WriteFaultMode): void {
    this.fault = { call: this.writeCalls + relativeCall, mode };
  }

  async read(path: string): Promise<Uint8Array | null> {
    const bytes = this.files.get(path);
    return bytes ? new Uint8Array(bytes) : null;
  }

  async writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
    this.writeCalls += 1;
    const fault = this.fault?.call === this.writeCalls ? this.fault : null;
    if (fault?.mode === "before") throw new Error("simulated crash before write");
    if (fault?.mode === "torn") {
      this.files.set(
        path,
        new Uint8Array(bytes.subarray(0, Math.max(1, Math.floor(bytes.byteLength / 2)))),
      );
      throw new Error("simulated torn write");
    }
    this.files.set(path, new Uint8Array(bytes));
    if (fault?.mode === "after") throw new Error("simulated crash after write");
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async list(prefix: string): Promise<readonly string[]> {
    return [...this.files.keys()]
      .filter((path) => path.startsWith(prefix))
      .sort((left, right) => left.localeCompare(right));
  }

  async size(path: string): Promise<number | null> {
    return this.files.get(path)?.byteLength ?? null;
  }

  async estimateQuota(): Promise<{ usage: number; quota: number } | null> {
    if (this.quota === null) return null;
    const usage = [...this.files.values()]
      .reduce((total, bytes) => total + bytes.byteLength, 0);
    return { usage, quota: this.quota };
  }

  async withExclusiveLock<T>(
    _name: string,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (signal?.aborted) {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }
    return operation();
  }

  corrupt(path: string, transform: (bytes: Uint8Array) => Uint8Array): void {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`Missing fake OPFS path: ${path}`);
    this.files.set(path, transform(new Uint8Array(bytes)));
  }
}

const TEST_LIMITS: StudioOpfsRecoveryJournalLimits = {
  maxChunkBytes: 4 * 1024,
  maxEntryBytes: 64 * 1024,
  maxEntries: 16,
  maxCheckpoints: 4,
  maxJournalBytes: 2 * 1024 * 1024,
  quotaReserveBytes: 0,
  maxEvictionsPerPass: 128,
  leaseTtlMs: 1_000,
};

const IDENTITY = {
  documentId: "document-1",
  documentVersion: 7,
  engineVersion: "studio-engine-19.4",
} as const;

function makeHarness(
  adapter = new FakeOpfsAdapter(),
  startTime = 10_000,
  limits: StudioOpfsRecoveryJournalLimits = TEST_LIMITS,
) {
  let now = startTime;
  let tokenSequence = 0;
  const journal = createStudioOpfsRecoveryJournal({
    adapter,
    identity: IDENTITY,
    limits,
    now: () => now,
    randomToken: () => `lease-token-${++tokenSequence}`,
  });
  return {
    adapter,
    journal,
    now: () => now,
    advance(milliseconds: number) {
      now += milliseconds;
    },
  };
}

function bytes(length: number, seed = 17): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(length);
  for (let index = 0; index < output.byteLength; index += 1) {
    output[index] = (seed + index * 29) & 0xff;
  }
  return output;
}

async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for await (const chunk of source) {
    chunks.push(chunk);
    byteLength += chunk.byteLength;
  }
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function acquire(
  harness: ReturnType<typeof makeHarness>,
  ownerId = "writer-a",
): Promise<StudioOpfsRecoveryWriterLease> {
  return harness.journal.acquireWriter({ ownerId });
}

async function appendBaseOperation(
  harness: ReturnType<typeof makeHarness>,
  writer: StudioOpfsRecoveryWriterLease,
  payload = bytes(6_000),
) {
  return harness.journal.appendOperation(writer, {
    id: "operation-1",
    pageId: "page-1",
    revision: 1,
    payload,
  });
}

function expectJournalError(
  code: InstanceType<typeof StudioOpfsRecoveryJournalError>["code"],
) {
  return expect.objectContaining({
    name: "StudioOpfsRecoveryJournalError",
    code,
  });
}

describe("decideStudioOpfsRecoveryBackend", () => {
  it("never treats memory/localStorage as a durable large-document journal", () => {
    expect(decideStudioOpfsRecoveryBackend({
      fileSystemKind: "opfs",
      originLockAvailable: true,
      existingRecoveryVaultCompatible: false,
    })).toEqual({
      mode: "opfs-journal",
      durable: true,
      reason: "native-opfs-and-origin-lock",
    });
    expect(decideStudioOpfsRecoveryBackend({
      fileSystemKind: "local-storage",
      originLockAvailable: true,
      existingRecoveryVaultCompatible: true,
    }).mode).toBe("existing-recovery-vault");
    expect(decideStudioOpfsRecoveryBackend({
      fileSystemKind: "memory",
      originLockAvailable: true,
      existingRecoveryVaultCompatible: false,
    })).toEqual({
      mode: "fail-closed",
      durable: false,
      reason: "opfs-unavailable-no-compatible-vault",
    });
    expect(decideStudioOpfsRecoveryBackend({
      fileSystemKind: "opfs",
      originLockAvailable: false,
      existingRecoveryVaultCompatible: true,
    }).reason).toBe("origin-lock-unavailable");
  });
});

describe("StudioOpfsRecoveryJournal streaming and recovery", () => {
  it("streams Blob and Uint8Array payloads into bounded immutable CRC32 chunks", async () => {
    const harness = makeHarness();
    const writer = await acquire(harness);
    const firstPayload = bytes(10_123);
    const first = await harness.journal.appendOperation(writer, {
      id: "operation-blob",
      pageId: "page-1",
      revision: 4,
      payload: new Blob([firstPayload]),
      createdAt: harness.now(),
    });
    const secondPayload = bytes(7_001, 91);
    const second = await harness.journal.appendOperation(writer, {
      id: "operation-bytes",
      pageId: "page-1",
      revision: 5,
      payload: secondPayload,
    });

    expect(first.chunks.map((chunk) => chunk.byteLength)).toEqual([4_096, 4_096, 1_931]);
    expect(second.chunks.map((chunk) => chunk.byteLength)).toEqual([4_096, 2_905]);

    const restarted = makeHarness(harness.adapter.clone(), harness.now()).journal;
    const scan = await restarted.scan();
    expect(scan).toMatchObject({
      generation: 2,
      lastSequence: 2,
      totalPayloadBytes: firstPayload.byteLength + secondPayload.byteLength,
      selectedSlot: "b",
    });
    expect(scan.entries.map((entry) => ({
      kind: entry.kind,
      sequence: entry.sequence,
      pageId: entry.pageId,
      revision: entry.revision,
      documentVersion: entry.documentVersion,
      engineVersion: entry.engineVersion,
    }))).toEqual([
      {
        kind: "operation",
        sequence: 1,
        pageId: "page-1",
        revision: 4,
        documentVersion: 7,
        engineVersion: "studio-engine-19.4",
      },
      {
        kind: "operation",
        sequence: 2,
        pageId: "page-1",
        revision: 5,
        documentVersion: 7,
        engineVersion: "studio-engine-19.4",
      },
    ]);
    await expect(collect(restarted.readPayload(scan.entries[0]!)))
      .resolves.toEqual(firstPayload);
    await expect(collect(restarted.readPayload(scan.entries[1]!)))
      .resolves.toEqual(secondPayload);
  });

  it("supports a one-shot AsyncIterable without materializing the complete payload", async () => {
    const harness = makeHarness();
    const writer = await acquire(harness);
    const pieces = [bytes(2_000), bytes(5_000, 3), bytes(19, 8)];
    const payload: StudioOpfsRecoveryByteSource = (async function* stream() {
      for (const piece of pieces) yield piece;
    })();
    const entry = await harness.journal.appendOperation(writer, {
      id: "operation-stream",
      pageId: "page-2",
      revision: 1,
      payload,
      byteLength: 7_019,
    });
    expect(entry.chunks.map((chunk) => chunk.byteLength)).toEqual([4_096, 2_923]);
    expect(await collect(harness.journal.readPayload(entry))).toEqual(
      await collect((async function* expected() {
        yield* pieces;
      })()),
    );
  });

  it("rejects a short or overlong one-shot stream before publishing a manifest", async () => {
    for (const actualLength of [3_000, 5_000]) {
      const harness = makeHarness();
      const writer = await acquire(harness);
      const payload = (async function* stream() {
        yield bytes(actualLength);
      })();
      await expect(harness.journal.appendOperation(writer, {
        id: "operation-stream",
        pageId: "page-1",
        revision: 1,
        payload,
        byteLength: 4_000,
      })).rejects.toEqual(expectJournalError("INVALID_ARGUMENT"));
      await expect(harness.journal.scan()).resolves.toMatchObject({
        generation: 0,
        entries: [],
      });
    }
  });
});

describe("StudioOpfsRecoveryJournal exhaustive commit crash matrix", () => {
  /**
   * A two-chunk append performs exactly five writes:
   * payload chunk 0, payload chunk 1, immutable descriptor, prepared manifest, committed head.
   */
  for (const mode of ["before", "torn", "after"] as const) {
    for (const writePoint of [1, 2, 3, 4, 5] as const) {
      it(`${mode} crash at append write ${writePoint}/5 never exposes a partial generation`, async () => {
        const baseline = makeHarness();
        const writer = await acquire(baseline);
        await appendBaseOperation(baseline, writer);

        const adapter = baseline.adapter.clone();
        const restarted = makeHarness(adapter, baseline.now());
        adapter.armRelativeWriteFault(writePoint, mode);
        await expect(restarted.journal.appendOperation(writer, {
          id: "operation-2",
          pageId: "page-1",
          revision: 2,
          payload: bytes(6_000, 71),
        })).rejects.toBeInstanceOf(StudioOpfsRecoveryJournalError);

        adapter.fault = null;
        const afterCrash = makeHarness(adapter.clone(), baseline.now()).journal;
        const scan = await afterCrash.scan();
        const headWasFullyWritten = mode === "after" && writePoint === 5;
        expect(scan.generation).toBe(headWasFullyWritten ? 2 : 1);
        expect(scan.entries.map((entry) => entry.id)).toEqual(
          headWasFullyWritten
            ? ["operation-1", "operation-2"]
            : ["operation-1"],
        );
      });
    }
  }

  it("retries on fresh immutable paths after a pre-head crash without replacing committed authority", async () => {
    const harness = makeHarness();
    const writer = await acquire(harness);
    await appendBaseOperation(harness, writer);
    const retryPayload = bytes(6_000, 71);

    harness.adapter.armRelativeWriteFault(5, "before");
    await expect(harness.journal.appendOperation(writer, {
      id: "operation-2",
      pageId: "page-1",
      revision: 2,
      payload: retryPayload,
    })).rejects.toEqual(expectJournalError("STORAGE_FAILED"));

    const committedBeforeRetry = await harness.journal.scan();
    expect(committedBeforeRetry).toMatchObject({
      generation: 1,
      lastSequence: 1,
    });
    expect(committedBeforeRetry.entries.map((entry) => entry.id)).toEqual([
      "operation-1",
    ]);
    const orphanPaths = [...harness.adapter.files.keys()]
      .filter((path) => path.includes("/op-000000000002-e1"))
      .sort((left, right) => left.localeCompare(right));
    expect(orphanPaths).toHaveLength(3);

    harness.advance(1);
    harness.adapter.fault = null;
    const retried = await harness.journal.appendOperation(writer, {
      id: "operation-2",
      pageId: "page-1",
      revision: 2,
      payload: retryPayload,
    });

    expect(retried).toMatchObject({ sequence: 2, writerEpoch: 1 });
    expect(retried.descriptorPath).toContain("/op-000000000002-e1-a1.meta");
    expect(retried.chunks.every((chunk) => chunk.path.includes("-e1-a1-c"))).toBe(true);
    expect(orphanPaths.every((path) => harness.adapter.files.has(path))).toBe(true);
    await expect(collect(harness.journal.readPayload(retried))).resolves.toEqual(retryPayload);

    const committedAfterRetry = await harness.journal.scan();
    expect(committedAfterRetry).toMatchObject({
      generation: 2,
      lastSequence: 2,
      selectedSlot: "b",
    });
    expect(committedAfterRetry.entries.map((entry) => entry.id)).toEqual([
      "operation-1",
      "operation-2",
    ]);
  });
});

describe("StudioOpfsRecoveryJournal integrity and version fences", () => {
  it("fails closed when a committed payload chunk is truncated", async () => {
    const harness = makeHarness();
    const writer = await acquire(harness);
    const entry = await appendBaseOperation(harness, writer);
    harness.adapter.corrupt(
      entry.chunks[0]!.path,
      (value) => value.subarray(0, value.byteLength - 1),
    );
    await expect(harness.journal.scan())
      .rejects.toEqual(expectJournalError("CORRUPT_ENTRY"));
  });

  it("fails closed when a committed descriptor is torn", async () => {
    const harness = makeHarness();
    const writer = await acquire(harness);
    const entry = await appendBaseOperation(harness, writer);
    harness.adapter.corrupt(
      entry.descriptorPath,
      (value) => value.subarray(0, Math.floor(value.byteLength / 2)),
    );
    await expect(harness.journal.scan())
      .rejects.toEqual(expectJournalError("CORRUPT_ENTRY"));
  });

  it("refuses to replay an intact manifest under another document/engine version", async () => {
    const harness = makeHarness();
    const writer = await acquire(harness);
    await appendBaseOperation(harness, writer);
    const incompatible = createStudioOpfsRecoveryJournal({
      adapter: harness.adapter,
      identity: {
        ...IDENTITY,
        engineVersion: "studio-engine-20.0",
      },
      limits: TEST_LIMITS,
    });
    await expect(incompatible.scan())
      .rejects.toEqual(expectJournalError("UNSUPPORTED_VERSION"));
  });

  it("selects the latest valid head deterministically when the inactive slot is torn", async () => {
    const harness = makeHarness();
    const writer = await acquire(harness);
    await appendBaseOperation(harness, writer);
    await harness.journal.appendOperation(writer, {
      id: "operation-2",
      pageId: "page-1",
      revision: 2,
      payload: bytes(100),
    });
    harness.adapter.corrupt(
      "recovery-journals/document-1/head-b.bin",
      (value) => value.subarray(0, Math.floor(value.byteLength / 2)),
    );
    const scan = await harness.journal.scan();
    expect(scan.generation).toBe(1);
    expect(scan.selectedSlot).toBe("a");
    expect(scan.ignoredSlots).toEqual(["b"]);
    expect(scan.entries.map((entry) => entry.id)).toEqual(["operation-1"]);
  });
});

describe("StudioOpfsRecoveryJournal writer fencing and abort", () => {
  it("keeps the writer id out of the user-facing message but not out of the diagnostics", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const harness = makeHarness();
      await acquire(harness, "autosave-06cb7b0c-1d1d-474b-8644-a88d56c5c463");

      const busy = await acquire(harness, "writer-b").then(
        () => null,
        (cause: unknown) => cause as StudioOpfsRecoveryJournalError,
      );

      expect(busy?.code).toBe("LEASE_BUSY");
      // 강등 배너는 error.message 를 그대로 읽는다 — 사람이 읽을 문장만 있어야 한다.
      expect(busy?.message).toBe("이 작품의 복구 저장소를 다른 탭이나 창이 사용하고 있어요.");
      expect(busy?.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/u);
      // 진단은 지워지지 않고 자리만 옮겼다 — 로그·버그리포트 쪽.
      expect(busy?.diagnostics).toContain("autosave-06cb7b0c-1d1d-474b-8644-a88d56c5c463");
      expect(describeStudioOpfsRecoveryJournalError(busy!)).toContain("[LEASE_BUSY]");
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("autosave-06cb7b0c-1d1d-474b-8644-a88d56c5c463"),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("increments the epoch after expiry and rejects every stale-writer mutation", async () => {
    const harness = makeHarness();
    const writerA = await acquire(harness, "writer-a");
    await expect(acquire(harness, "writer-b"))
      .rejects.toEqual(expectJournalError("LEASE_BUSY"));

    harness.advance(TEST_LIMITS.leaseTtlMs + 1);
    const writerB = await acquire(harness, "writer-b");
    expect(writerB.epoch).toBe(writerA.epoch + 1);
    await expect(harness.journal.appendOperation(writerA, {
      id: "stale-operation",
      pageId: "page-1",
      revision: 1,
      payload: bytes(10),
    })).rejects.toEqual(expectJournalError("LEASE_LOST"));
    await expect(harness.journal.appendOperation(writerB, {
      id: "current-operation",
      pageId: "page-1",
      revision: 1,
      payload: bytes(10),
    })).resolves.toMatchObject({ writerEpoch: writerB.epoch });
  });

  it("aborts between streamed chunks and leaves only unreachable immutable debris", async () => {
    const harness = makeHarness();
    const writer = await acquire(harness);
    const controller = new AbortController();
    const payload = (async function* stream() {
      yield bytes(4_096);
      controller.abort();
      yield bytes(4_096, 99);
    })();
    await expect(harness.journal.appendOperation(writer, {
      id: "aborted-operation",
      pageId: "page-1",
      revision: 1,
      payload,
      byteLength: 8_192,
    }, { signal: controller.signal })).rejects.toEqual(expectJournalError("ABORTED"));
    await expect(harness.journal.scan()).resolves.toMatchObject({
      generation: 0,
      entries: [],
    });
  });
});

describe("StudioOpfsRecoveryJournal compaction and quota eviction", () => {
  it("atomically replaces same-page history with a checkpoint and bounds obsolete cleanup", async () => {
    const harness = makeHarness();
    const writer = await acquire(harness);
    await harness.journal.appendOperation(writer, {
      id: "page-1-operation-1",
      pageId: "page-1",
      revision: 1,
      payload: bytes(100),
    });
    await harness.journal.appendOperation(writer, {
      id: "page-1-operation-2",
      pageId: "page-1",
      revision: 2,
      payload: bytes(100, 2),
    });
    await harness.journal.appendOperation(writer, {
      id: "page-2-operation-1",
      pageId: "page-2",
      revision: 1,
      payload: bytes(100, 3),
    });
    const checkpoint = await harness.journal.appendCheckpoint(writer, {
      id: "page-1-checkpoint",
      pageId: "page-1",
      revision: 2,
      payload: new Blob([bytes(2_000, 4)]),
      compactThroughSequence: 2,
    });

    const compacted = await harness.journal.scan();
    expect(checkpoint).toMatchObject({
      kind: "checkpoint",
      sequence: 4,
      compactThroughSequence: 2,
    });
    expect(compacted.entries.map((entry) => [entry.id, entry.sequence])).toEqual([
      ["page-2-operation-1", 3],
      ["page-1-checkpoint", 4],
    ]);

    const eviction = await harness.journal.evictObsolete(writer);
    expect(eviction.removedPaths.length).toBeGreaterThan(0);
    expect(eviction.removedPaths.length).toBeLessThanOrEqual(
      TEST_LIMITS.maxEvictionsPerPass,
    );
    expect(eviction.freedBytes).toBeGreaterThan(0);
    await expect(harness.journal.scan()).resolves.toMatchObject({
      generation: 4,
      lastSequence: 4,
    });
  });

  it("evicts deterministic orphan/old-generation files before failing quota closed", async () => {
    const harness = makeHarness();
    const writer = await acquire(harness);
    await appendBaseOperation(harness, writer, bytes(100));
    harness.adapter.files.set(
      "recovery-journals/document-1/000-orphan.bin",
      bytes(100_000),
    );
    const usage = [...harness.adapter.files.values()]
      .reduce((total, value) => total + value.byteLength, 0);
    harness.adapter.quota = usage + 60_000;

    await expect(harness.journal.appendOperation(writer, {
      id: "operation-after-eviction",
      pageId: "page-1",
      revision: 2,
      payload: bytes(1_000),
    })).resolves.toMatchObject({ sequence: 2 });
    expect(harness.adapter.files.has(
      "recovery-journals/document-1/000-orphan.bin",
    )).toBe(false);

    harness.adapter.quota = [...harness.adapter.files.values()]
      .reduce((total, value) => total + value.byteLength, 0) + 10;
    await expect(harness.journal.appendOperation(writer, {
      id: "operation-over-quota",
      pageId: "page-1",
      revision: 3,
      payload: bytes(1_000),
    })).rejects.toEqual(expectJournalError("QUOTA_EXCEEDED"));
    const scan = await harness.journal.scan();
    expect(scan.entries.map((entry) => entry.id)).toEqual([
      "operation-1",
      "operation-after-eviction",
    ]);
  });
});
