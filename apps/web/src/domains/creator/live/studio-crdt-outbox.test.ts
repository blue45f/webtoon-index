import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LegacyIndexedDbStudioCrdtOutbox,
  SerializedStudioCrdtOutbox,
  StudioCrdtOutboxCorruptionError,
  StudioCrdtOutboxTimeoutError,
  type StudioCrdtOutbox,
} from "./studio-crdt-outbox";
import {
  STUDIO_CRDT_PROTOCOL_VERSION,
  encodeStudioCrdtUpdate,
  type StudioCrdtUpdateRequest,
} from "./studio-crdt-protocol";

function request(workId: string, updateId: string): StudioCrdtUpdateRequest {
  return {
    protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
    workId,
    updateId,
    clientSequence: 1,
    update: encodeStudioCrdtUpdate(new Uint8Array([0, 0])),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Studio CRDT durable outbox", () => {
  it("retains a same-page emergency copy when IndexedDB is unavailable", async () => {
    const outbox = new SerializedStudioCrdtOutbox(new LegacyIndexedDbStudioCrdtOutbox());
    const scope = "memory-user-a";
    const workId = "memory-work-a";
    const pending = request(workId, "11111111-1111-4111-8111-111111111111");

    await expect(outbox.put(scope, pending)).rejects.toThrow("IndexedDB");
    await expect(outbox.list(scope, workId)).resolves.toEqual([pending]);
    expect(outbox.getStatus()).toMatchObject({ state: "degraded" });

    await outbox.remove(scope, workId, pending.updateId);
    expect(outbox.listEmergency(scope, workId)).toEqual([]);
  });

  it("makes a replacement binding list wait for the previous binding's final put", async () => {
    const stored = new Map<string, StudioCrdtUpdateRequest>();
    let signalPutStarted: () => void = () => undefined;
    const putStarted = new Promise<void>((resolve) => {
      signalPutStarted = resolve;
    });
    let releasePut: () => void = () => undefined;
    const putGate = new Promise<void>((resolve) => {
      releasePut = resolve;
    });
    let listCalls = 0;
    const delegate: StudioCrdtOutbox = {
      async list(_scope, workId) {
        listCalls += 1;
        return [...stored.values()].filter((value) => value.workId === workId);
      },
      async put(_scope, value) {
        signalPutStarted();
        await putGate;
        stored.set(value.updateId, value);
      },
      async remove(_scope, _workId, updateId) {
        stored.delete(updateId);
      },
    };
    const previous = new SerializedStudioCrdtOutbox(delegate);
    const replacement = new SerializedStudioCrdtOutbox(delegate);
    const pending = request("barrier-work-a", "22222222-2222-4222-8222-222222222222");

    const writing = previous.put("barrier-user-a", pending);
    await putStarted;
    const listing = replacement.list("barrier-user-a", pending.workId);
    await Promise.resolve();

    expect(listCalls).toBe(0);
    releasePut();
    await writing;
    await expect(listing).resolves.toEqual([pending]);
    expect(listCalls).toBe(1);
  });

  it("releases the scoped queue and probes durable rows when a put never settles", async () => {
    let listCalls = 0;
    const delegate: StudioCrdtOutbox = {
      async list() {
        listCalls += 1;
        return [];
      },
      put: () => new Promise<void>(() => undefined),
      async remove() {
        return undefined;
      },
    };
    const previous = new SerializedStudioCrdtOutbox(delegate, { timeoutMs: 100 });
    const replacement = new SerializedStudioCrdtOutbox(delegate, { timeoutMs: 100 });
    const pending = request("timeout-work-a", "33333333-3333-4333-8333-333333333333");

    const writing = previous.put("timeout-user-a", pending);
    const listing = replacement.list("timeout-user-a", pending.workId);

    await expect(writing).rejects.toThrow("시간이 초과");
    await expect(listing).resolves.toEqual([]);
    expect(replacement.getStatus()).toMatchObject({ state: "durable" });
    expect(listCalls).toBe(1);
  });

  it("does not omit an older durable row while the scoped write circuit is open", async () => {
    const durable = request(
      "circuit-read-work-a",
      "12121212-1212-4212-8212-121212121212"
    );
    let listCalls = 0;
    const delegate: StudioCrdtOutbox = {
      async list() {
        listCalls += 1;
        return [durable];
      },
      listEmergency: () => [],
      put: () => new Promise<void>(() => undefined),
      async remove() {
        return undefined;
      },
    };
    const previous = new SerializedStudioCrdtOutbox(delegate, { timeoutMs: 100 });
    const replacement = new SerializedStudioCrdtOutbox(delegate, { timeoutMs: 100 });
    const inFlight = request(
      durable.workId,
      "13131313-1313-4313-8313-131313131313"
    );

    await expect(previous.put("circuit-read-user-a", inFlight)).rejects.toBeInstanceOf(
      StudioCrdtOutboxTimeoutError
    );

    await expect(replacement.list("circuit-read-user-a", durable.workId)).resolves.toEqual([
      durable,
    ]);
    expect(listCalls).toBe(1);
  });

  it("still detects a malformed durable row while the scoped write circuit is open", async () => {
    const scope = "circuit-corrupt-user-a";
    const workId = "circuit-corrupt-work-a";
    let listCalls = 0;
    const delegate: StudioCrdtOutbox = {
      async list() {
        listCalls += 1;
        throw new StudioCrdtOutboxCorruptionError();
      },
      listEmergency: () => [],
      put: () => new Promise<void>(() => undefined),
      async remove() {
        return undefined;
      },
    };
    const previous = new SerializedStudioCrdtOutbox(delegate, { timeoutMs: 100 });
    const replacement = new SerializedStudioCrdtOutbox(delegate, { timeoutMs: 100 });

    await expect(previous.put(
      scope,
      request(workId, "14141414-1414-4414-8414-141414141414")
    )).rejects.toBeInstanceOf(StudioCrdtOutboxTimeoutError);

    await expect(replacement.list(scope, workId)).rejects.toBeInstanceOf(
      StudioCrdtOutboxCorruptionError
    );
    expect(listCalls).toBe(1);
  });

  it("does not let a late put resurrect an update after its authoritative ACK", async () => {
    const startedAt = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(startedAt);
    const stored = new Map<string, StudioCrdtUpdateRequest>();
    let signalPutStarted: () => void = () => undefined;
    const putStarted = new Promise<void>((resolve) => {
      signalPutStarted = resolve;
    });
    let signalPutCompleted: () => void = () => undefined;
    const putCompleted = new Promise<void>((resolve) => {
      signalPutCompleted = resolve;
    });
    let releasePut: () => void = () => undefined;
    const putGate = new Promise<void>((resolve) => {
      releasePut = resolve;
    });
    const delegate: StudioCrdtOutbox = {
      async list() {
        return [...stored.values()];
      },
      async put(_scope, value) {
        signalPutStarted();
        await putGate;
        stored.set(value.updateId, value);
        signalPutCompleted();
      },
      async remove(_scope, _workId, updateId) {
        stored.delete(updateId);
      },
    };
    const outbox = new SerializedStudioCrdtOutbox(delegate, { timeoutMs: 100 });
    const replacement = new SerializedStudioCrdtOutbox(delegate, { timeoutMs: 100 });
    const pending = request("late-work-a", "66666666-6666-4666-8666-666666666666");

    const writing = outbox.put("late-user-a", pending);
    await putStarted;
    const removing = outbox.remove("late-user-a", pending.workId, pending.updateId);

    await expect(writing).rejects.toThrow("시간이 초과");
    await expect(removing).resolves.toBeUndefined();
    clock.mockReturnValue(startedAt + 5 * 60_000 + 1);
    releasePut();

    await putCompleted;
    await vi.waitFor(() => expect(stored.has(pending.updateId)).toBe(false));
    await expect(replacement.list("late-user-a", pending.workId)).resolves.toEqual([]);
  });

  it("releases a replacement list when ACK cleanup itself never settles", async () => {
    let listCalls = 0;
    const delegate: StudioCrdtOutbox = {
      async list() {
        listCalls += 1;
        return [];
      },
      async put() {
        return undefined;
      },
      remove: () => new Promise<void>(() => undefined),
    };
    const previous = new SerializedStudioCrdtOutbox(delegate, { timeoutMs: 100 });
    const replacement = new SerializedStudioCrdtOutbox(delegate, { timeoutMs: 100 });
    const pending = request("remove-timeout-work-a", "77777777-7777-4777-8777-777777777777");

    const removing = previous.remove("remove-timeout-user-a", pending.workId, pending.updateId);
    const listing = replacement.list("remove-timeout-user-a", pending.workId);

    await expect(removing).rejects.toThrow("시간이 초과");
    await expect(listing).resolves.toEqual([]);
    expect(listCalls).toBe(1);
  });

  it("clears the shared ACK marker when a timed-out remove succeeds late", async () => {
    const startedAt = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(startedAt);
    const pending = request(
      "late-remove-work-a",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    );
    const stored = new Map([[pending.updateId, pending]]);
    let releaseRemove: () => void = () => undefined;
    const removeGate = new Promise<void>((resolve) => {
      releaseRemove = resolve;
    });
    let signalRemoveCompleted: () => void = () => undefined;
    const removeCompleted = new Promise<void>((resolve) => {
      signalRemoveCompleted = resolve;
    });
    const delegate: StudioCrdtOutbox = {
      async list() {
        return [...stored.values()];
      },
      async put(_scope, value) {
        stored.set(value.updateId, value);
      },
      async remove(_scope, _workId, updateId) {
        await removeGate;
        stored.delete(updateId);
        signalRemoveCompleted();
      },
    };
    const previous = new SerializedStudioCrdtOutbox(delegate, { timeoutMs: 100 });
    const replacement = new SerializedStudioCrdtOutbox(delegate, { timeoutMs: 100 });

    const removing = previous.remove("late-remove-user-a", pending.workId, pending.updateId);
    await expect(removing).rejects.toThrow("시간이 초과");
    releaseRemove();
    await removeCompleted;
    await Promise.resolve();

    stored.set(pending.updateId, pending);
    clock.mockReturnValue(startedAt + 5_001);
    await expect(replacement.list("late-remove-user-a", pending.workId)).resolves.toEqual([
      pending,
    ]);
  });

  it("returns an empty memory fallback and exposes degraded health on permanent reads", async () => {
    const delegate: StudioCrdtOutbox = {
      async list() {
        throw new Error("permanent IndexedDB read failure");
      },
      listEmergency: () => [],
      async put() {
        return undefined;
      },
      async remove() {
        return undefined;
      },
    };
    const outbox = new SerializedStudioCrdtOutbox(delegate, { timeoutMs: 100 });

    await expect(outbox.list("read-failure-user-a", "read-failure-work-a")).resolves.toEqual([]);
    expect(outbox.getStatus()).toEqual({
      state: "degraded",
      message: "permanent IndexedDB read failure",
    });
  });

  it("fails closed when a scoped IndexedDB row is invalid instead of dropping an unapproved edit", async () => {
    const scope = "corrupt-row-user-a";
    const workId = "corrupt-row-work-a";
    const persistence = {
      async list() {
        return [{
          kind: "update",
          key: JSON.stringify([scope, workId, "corrupt-update"]),
          scope,
          workId,
          updateId: "corrupt-update",
          clientSequence: 1,
          createdAt: 1,
          request: { invalid: true },
        }];
      },
      async put() {
        return undefined;
      },
      async delete() {
        return undefined;
      },
    };
    const direct = new LegacyIndexedDbStudioCrdtOutbox(persistence);
    const serialized = new SerializedStudioCrdtOutbox(direct);

    await expect(serialized.list(scope, workId)).rejects.toBeInstanceOf(
      StudioCrdtOutboxCorruptionError
    );
  });

  it("fails closed when an IndexedDB list never settles", async () => {
    const pending = request("emergency-work-a", "44444444-4444-4444-8444-444444444444");
    const delegate: StudioCrdtOutbox = {
      list: () => new Promise<StudioCrdtUpdateRequest[]>(() => undefined),
      listEmergency: () => [pending],
      async put() {
        return undefined;
      },
      async remove() {
        return undefined;
      },
    };
    const outbox = new SerializedStudioCrdtOutbox(delegate, { timeoutMs: 100 });

    await expect(outbox.list("emergency-user-a", pending.workId)).rejects.toBeInstanceOf(
      StudioCrdtOutboxTimeoutError
    );
  });

  it("shares ACK tombstones across replacement IndexedDB delegate instances", async () => {
    const scope = "replacement-instance-user-a";
    const pending = request(
      "replacement-instance-work-a",
      "99999999-9999-4999-8999-999999999999"
    );
    const previous = new LegacyIndexedDbStudioCrdtOutbox();
    const replacement = new LegacyIndexedDbStudioCrdtOutbox();

    previous.putEmergency(scope, pending);
    replacement.removeEmergency(scope, pending.workId, pending.updateId);
    previous.putEmergency(scope, pending);

    expect(replacement.listEmergency(scope, pending.workId)).toEqual([]);
    await replacement.remove(scope, pending.workId, pending.updateId);
  });

  it("opens a circuit after one timeout instead of charging every queued put a timeout", async () => {
    vi.useFakeTimers();
    const emergency = new Map<string, StudioCrdtUpdateRequest>();
    let delegatePutCalls = 0;
    const delegate: StudioCrdtOutbox = {
      async list() {
        throw new Error("The open circuit must use the emergency snapshot.");
      },
      listEmergency: () => [...emergency.values()],
      putEmergency: (_scope, value) => {
        emergency.set(value.updateId, value);
      },
      put: () => {
        delegatePutCalls += 1;
        return new Promise<void>(() => undefined);
      },
      removeEmergency: (_scope, _workId, updateId) => {
        emergency.delete(updateId);
      },
      async remove() {
        return undefined;
      },
    };
    const outbox = new SerializedStudioCrdtOutbox(delegate, { timeoutMs: 100 });
    const writes = Array.from({ length: 20 }, (_, index) => {
      const suffix = String(index + 10).padStart(12, "0");
      return outbox.put(
        "circuit-user-a",
        request("circuit-work-a", `55555555-5555-4555-8555-${suffix}`)
      );
    });
    const settlements = Promise.allSettled(writes);

    await vi.advanceTimersByTimeAsync(100);
    const results = await settlements;

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(delegatePutCalls).toBe(1);
    await expect(outbox.list("circuit-user-a", "circuit-work-a")).resolves.toHaveLength(20);
  });

  it("preserves more than the former row and emergency caps without silent eviction", async () => {
    const delegate = new LegacyIndexedDbStudioCrdtOutbox();
    const scope = "uncapped-user-a";
    const workId = "uncapped-work-a";
    const count = 8_193;

    for (let index = 0; index < count; index += 1) {
      delegate.putEmergency(
        scope,
        request(workId, `88888888-8888-4888-8888-${String(index).padStart(12, "0")}`)
      );
    }

    const replacement = new LegacyIndexedDbStudioCrdtOutbox();
    expect(replacement.listEmergency(scope, workId)).toHaveLength(count);
    await Promise.all(
      Array.from({ length: count }, (_, index) =>
        delegate.remove(
          scope,
          workId,
          `88888888-8888-4888-8888-${String(index).padStart(12, "0")}`
        )
      )
    );
  });

  it("prevents a late durable put from reviving an ACK across different delegate instances", async () => {
    const scope = "durable-replacement-user-a";
    const pending = request(
      "durable-replacement-work-a",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    );
    const rows = new Map<string, unknown>();
    let signalDelayedPut: () => void = () => undefined;
    const delayedPut = new Promise<void>((resolve) => {
      signalDelayedPut = resolve;
    });
    let releaseDelayedPut: () => void = () => undefined;
    const delayedPutGate = new Promise<void>((resolve) => {
      releaseDelayedPut = resolve;
    });
    let signalDelayedPutCompleted: () => void = () => undefined;
    const delayedPutCompleted = new Promise<void>((resolve) => {
      signalDelayedPutCompleted = resolve;
    });
    let shouldDelayUpdate = true;
    const persistence = {
      async list(expectedScope: string, expectedWorkId: string): Promise<unknown[]> {
        return [...rows.values()].filter((value) => {
          const row = value as { scope?: unknown; workId?: unknown };
          return row.scope === expectedScope && row.workId === expectedWorkId;
        });
      },
      async put(value: unknown): Promise<void> {
        const row = value as {
          key: string;
          kind?: string;
          updateId: string;
        };
        if (
          shouldDelayUpdate &&
          row.kind === "update" &&
          row.updateId === pending.updateId
        ) {
          shouldDelayUpdate = false;
          signalDelayedPut();
          await delayedPutGate;
        }
        rows.set(row.key, value);
        if (row.kind === "update" && row.updateId === pending.updateId) {
          signalDelayedPutCompleted();
        }
      },
      async delete(keys: readonly string[]): Promise<void> {
        for (const key of keys) rows.delete(key);
      },
    };
    const previousDelegate = new LegacyIndexedDbStudioCrdtOutbox(persistence);
    const replacementDelegate = new LegacyIndexedDbStudioCrdtOutbox(persistence);
    const previous = new SerializedStudioCrdtOutbox(previousDelegate, { timeoutMs: 100 });
    const replacement = new SerializedStudioCrdtOutbox(replacementDelegate, { timeoutMs: 100 });

    const writing = previous.put(scope, pending);
    await delayedPut;
    await expect(writing).rejects.toThrow("시간이 초과");
    await replacement.remove(scope, pending.workId, pending.updateId);
    expect([...rows.values()][0]).toMatchObject({ kind: "tombstone" });

    releaseDelayedPut();
    await delayedPutCompleted;
    await vi.waitFor(() => expect(rows.size).toBe(0));
    await expect(replacement.list(scope, pending.workId)).resolves.toEqual([]);
  });
});
