import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SqliteUnavailableError,
  StudioCrdtOutboxSqlCapacityError,
  StudioCrdtRecoverySqlCapacityError,
} from "./studio-local-database";
import {
  StudioLocalDatabaseCommitOutcomeUnknownError,
  StudioLocalDatabaseWorkerClientError,
  StudioLocalDatabaseWorkerRemoteError,
  acquireStudioLocalDatabaseWorker,
  closeStudioLocalDatabaseWorker,
  createStudioLocalDatabaseWorkerProxy,
  type StudioLocalDatabaseWorkerLike,
} from "./studio-local-database-worker-client";
import {
  STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION,
  serializeStudioLocalDatabaseWorkerError,
  type StudioLocalDatabaseWorkerRequest,
  type StudioLocalDatabaseWorkerResponse,
} from "./studio-local-database-worker-protocol";

class FakeWorker implements StudioLocalDatabaseWorkerLike {
  onmessage: StudioLocalDatabaseWorkerLike["onmessage"] = null;
  onerror: StudioLocalDatabaseWorkerLike["onerror"] = null;
  onmessageerror: StudioLocalDatabaseWorkerLike["onmessageerror"] = null;
  readonly posted: StudioLocalDatabaseWorkerRequest[] = [];
  readonly terminate = vi.fn();
  autoRespond = false;

  postMessage(message: StudioLocalDatabaseWorkerRequest): void {
    this.posted.push(message);
    if (this.autoRespond) {
      queueMicrotask(() => this.succeed(message.requestId, undefined));
    }
  }

  succeed(requestId: number, value: unknown): void {
    this.emit({
      version: STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION,
      kind: "success",
      requestId,
      value,
    });
  }

  fail(requestId: number, error: unknown): void {
    this.emit({
      version: STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION,
      kind: "failure",
      requestId,
      error: serializeStudioLocalDatabaseWorkerError(error),
    });
  }

  emit(response: StudioLocalDatabaseWorkerResponse): void {
    this.onmessage?.({ data: response });
  }

  crash(message = "worker crashed"): void {
    this.onerror?.({ message, error: new Error(message), preventDefault: vi.fn() });
  }

  messageError(): void {
    this.onmessageerror?.({ data: null });
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(async () => {
  await closeStudioLocalDatabaseWorker();
});

describe("Studio local database Worker client", () => {
  it("is lazy, deduplicates initialization, and correlates concurrent requests", async () => {
    const worker = new FakeWorker();
    const factory = vi.fn(() => worker);
    const database = createStudioLocalDatabaseWorkerProxy({ workerFactory: factory });

    expect(factory).not.toHaveBeenCalled();
    const get = database.kvGet("models", "hero");
    const list = database.listJournalEntries("project-a");

    expect(factory).toHaveBeenCalledTimes(1);
    expect(worker.posted).toHaveLength(1);
    expect(worker.posted[0]).toMatchObject({ kind: "initialize", requestId: 1 });

    worker.succeed(1, undefined);
    await flushMicrotasks();
    expect(worker.posted.slice(1)).toMatchObject([
      { kind: "call", requestId: 2, method: "kvGet", args: ["models", "hero"] },
      { kind: "call", requestId: 3, method: "listJournalEntries", args: ["project-a"] },
    ]);

    worker.succeed(3, [{ seq: 1, payload: "{}", crc32: 42 }]);
    worker.succeed(2, "hero-json");
    await expect(get).resolves.toBe("hero-json");
    await expect(list).resolves.toEqual([{ seq: 1, payload: "{}", crc32: 42 }]);
  });

  it("reconstructs the synchronous KV adapter over the same RPC authority", async () => {
    const worker = new FakeWorker();
    const database = createStudioLocalDatabaseWorkerProxy({ workerFactory: () => worker });
    const store = database.asAsyncKeyValueStore("settings");
    const write = store.set("theme", "ink");
    worker.succeed(1, undefined);
    await flushMicrotasks();

    expect(worker.posted[1]).toMatchObject({
      kind: "call",
      method: "kvSet",
      args: ["settings", "theme", "ink"],
    });
    worker.succeed(2, undefined);
    await expect(write).resolves.toBeUndefined();
  });

  it("marks only in-flight mutations unknown when the Worker crashes", async () => {
    const worker = new FakeWorker();
    const database = createStudioLocalDatabaseWorkerProxy({ workerFactory: () => worker });
    const initialization = database.kvGet("probe", "ready");
    worker.succeed(1, undefined);
    await flushMicrotasks();
    worker.succeed(2, null);
    await initialization;

    const mutation = database.kvSet("models", "hero", "new-value");
    const read = database.kvGet("models", "hero");
    await flushMicrotasks();
    worker.crash();

    await expect(mutation).rejects.toMatchObject({
      name: "StudioLocalDatabaseCommitOutcomeUnknownError",
      code: "commit-outcome-unknown",
      method: "kvSet",
    } satisfies Partial<StudioLocalDatabaseCommitOutcomeUnknownError>);
    await expect(read).rejects.toBeInstanceOf(StudioLocalDatabaseWorkerClientError);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("also preserves mutation ambiguity on response deserialization failure", async () => {
    const worker = new FakeWorker();
    const database = createStudioLocalDatabaseWorkerProxy({ workerFactory: () => worker });
    const mutation = database.compareAndRestoreBrushLibraryRecords([], []);
    worker.succeed(1, undefined);
    await flushMicrotasks();
    worker.messageError();

    await expect(mutation).rejects.toMatchObject({
      name: "StudioLocalDatabaseCommitOutcomeUnknownError",
      method: "compareAndRestoreBrushLibraryRecords",
    });
  });

  it("times out an unresponsive mutation as unknown and terminates the session", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const database = createStudioLocalDatabaseWorkerProxy({
        workerFactory: () => worker,
        requestTimeoutMs: 25,
      });
      const mutation = database.kvSet("models", "hero", "v3");
      worker.succeed(1, undefined);
      await flushMicrotasks();

      await vi.advanceTimersByTimeAsync(25);

      await expect(mutation).rejects.toMatchObject({
        code: "commit-outcome-unknown",
        method: "kvSet",
      });
      expect(worker.terminate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a normal mutation failure response as definitive", async () => {
    const worker = new FakeWorker();
    const database = createStudioLocalDatabaseWorkerProxy({ workerFactory: () => worker });
    const mutation = database.kvDelete("models", "missing");
    worker.succeed(1, undefined);
    await flushMicrotasks();
    const remote = new Error("constraint failed");
    remote.name = "SqliteConstraintError";
    worker.fail(2, remote);

    await expect(mutation).rejects.toMatchObject({
      remoteName: "SqliteConstraintError",
      message: "constraint failed",
    } satisfies Partial<StudioLocalDatabaseWorkerRemoteError>);
    await expect(mutation).rejects.not.toBeInstanceOf(
      StudioLocalDatabaseCommitOutcomeUnknownError,
    );
  });

  it("rehydrates a committed mutation whose success response could not be posted", async () => {
    const worker = new FakeWorker();
    const database = createStudioLocalDatabaseWorkerProxy({ workerFactory: () => worker });
    const mutation = database.kvSet("models", "hero", "committed-value");
    worker.succeed(1, undefined);
    await flushMicrotasks();
    worker.fail(
      2,
      new StudioLocalDatabaseCommitOutcomeUnknownError(
        "kvSet",
        new Error("success-response-post-failed"),
      ),
    );

    await expect(mutation).rejects.toMatchObject({
      name: "StudioLocalDatabaseCommitOutcomeUnknownError",
      code: "commit-outcome-unknown",
      method: "kvSet",
    });
    await expect(mutation).rejects.toBeInstanceOf(
      StudioLocalDatabaseCommitOutcomeUnknownError,
    );
  });

  it("rehydrates the existing SQLite unavailable error contract", async () => {
    const worker = new FakeWorker();
    const database = createStudioLocalDatabaseWorkerProxy({ workerFactory: () => worker });
    const opening = database.kvGet("models", "hero");
    worker.fail(
      1,
      new SqliteUnavailableError("another page owns the OPFS Worker lock"),
    );

    await expect(opening).rejects.toBeInstanceOf(SqliteUnavailableError);
    await expect(opening).rejects.toMatchObject({
      reason: "another page owns the OPFS Worker lock",
    });
  });

  it("rehydrates both existing CRDT capacity error contracts", async () => {
    const worker = new FakeWorker();
    const database = createStudioLocalDatabaseWorkerProxy({ workerFactory: () => worker });
    const probe = database.kvGet("probe", "ready");
    worker.succeed(1, undefined);
    await flushMicrotasks();
    worker.succeed(2, null);
    await probe;

    const outbox = database.listCrdtOutboxCandidates("studio", "work-a");
    const recovery = database.listCrdtRecoveryCandidates("studio", "work-a");
    await flushMicrotasks();
    worker.fail(3, new StudioCrdtOutboxSqlCapacityError(101, 4_096));
    worker.fail(4, new StudioCrdtRecoverySqlCapacityError(51, 8_192));

    await expect(outbox).rejects.toBeInstanceOf(StudioCrdtOutboxSqlCapacityError);
    await expect(outbox).rejects.toMatchObject({ entryCount: 101, totalBytes: 4_096 });
    await expect(recovery).rejects.toBeInstanceOf(StudioCrdtRecoverySqlCapacityError);
    await expect(recovery).rejects.toMatchObject({ rowCount: 51, totalBytes: 8_192 });
  });

  it("closes a cold proxy without constructing a Worker and rejects later use", async () => {
    const factory = vi.fn(() => new FakeWorker());
    const database = createStudioLocalDatabaseWorkerProxy({ workerFactory: factory });

    await database.close();
    await database.close();

    expect(factory).not.toHaveBeenCalled();
    await expect(database.kvGet("models", "hero")).rejects.toMatchObject({
      code: "worker-closed",
    });
  });

  it("posts a call made during initialization before a following close", async () => {
    const worker = new FakeWorker();
    const database = createStudioLocalDatabaseWorkerProxy({ workerFactory: () => worker });
    const mutation = database.kvSet("models", "hero", "v4");
    const closing = database.close();

    expect(worker.posted).toMatchObject([{ kind: "initialize", requestId: 1 }]);
    worker.succeed(1, undefined);
    await flushMicrotasks();
    expect(worker.posted).toMatchObject([
      { kind: "initialize", requestId: 1 },
      { kind: "call", requestId: 2, method: "kvSet" },
    ]);

    worker.succeed(2, undefined);
    await expect(mutation).resolves.toBeUndefined();
    await flushMicrotasks();
    expect(worker.posted[2]).toMatchObject({ kind: "close", requestId: 3 });
    worker.succeed(3, undefined);
    await expect(closing).resolves.toBeUndefined();
  });

  it("waits for an already-ready write before posting close", async () => {
    const worker = new FakeWorker();
    const database = createStudioLocalDatabaseWorkerProxy({ workerFactory: () => worker });
    const ready = database.kvGet("probe", "ready");
    worker.succeed(1, undefined);
    await flushMicrotasks();
    worker.succeed(2, null);
    await ready;

    const mutation = database.kvSet("models", "hero", "v5");
    const closing = database.close();
    await flushMicrotasks();
    expect(worker.posted.at(-1)).toMatchObject({ kind: "call", method: "kvSet" });

    worker.succeed(3, undefined);
    await mutation;
    await flushMicrotasks();
    expect(worker.posted.at(-1)).toMatchObject({ kind: "close", requestId: 4 });
    worker.succeed(4, undefined);
    await closing;
  });

  it("reports page-singleton construction failure as an async rejection", async () => {
    let opening: Promise<unknown> | null = null;

    expect(() => {
      opening = acquireStudioLocalDatabaseWorker({
        workerFactory: () => {
          throw new Error("Worker constructor blocked");
        },
      });
    }).not.toThrow();
    await expect(opening).rejects.toMatchObject({
      code: "worker-construction-failed",
    });
  });

  it("provides one initialized page singleton and releases it through close", async () => {
    const worker = new FakeWorker();
    worker.autoRespond = true;
    const factory = vi.fn(() => worker);

    const first = acquireStudioLocalDatabaseWorker({ workerFactory: factory });
    const second = acquireStudioLocalDatabaseWorker({ workerFactory: factory });

    await expect(first).resolves.toBe(await second);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(worker.posted.filter((request) => request.kind === "initialize")).toHaveLength(1);

    await closeStudioLocalDatabaseWorker();
    expect(worker.posted.at(-1)).toMatchObject({ kind: "close" });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
