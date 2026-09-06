import { describe, expect, it, vi } from "vitest";

import {
  attachStudioLocalDatabaseWorkerHost,
  type StudioLocalDatabaseWorkerScopeLike,
} from "./studio-local-database-worker-host";
import {
  STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION,
  type StudioLocalDatabaseWorkerRequest,
  type StudioLocalDatabaseWorkerResponse,
} from "./studio-local-database-worker-protocol";

import type { StudioLocalDatabaseWorkerDatabase } from "./studio-local-database-worker-database";

class FakeScope implements StudioLocalDatabaseWorkerScopeLike {
  readonly responses: StudioLocalDatabaseWorkerResponse[] = [];
  readonly responseAttempts: StudioLocalDatabaseWorkerResponse[] = [];
  readonly throwingPostAttempts = new Set<number>();
  private listener: ((event: { readonly data: unknown }) => void) | null = null;

  postMessage(message: StudioLocalDatabaseWorkerResponse): void {
    this.responseAttempts.push(message);
    if (this.throwingPostAttempts.has(this.responseAttempts.length)) {
      throw new DOMException("response channel rejected message", "DataCloneError");
    }
    this.responses.push(message);
  }

  addEventListener(
    _type: "message",
    listener: (event: { readonly data: unknown }) => void,
  ): void {
    this.listener = listener;
  }

  removeEventListener(
    _type: "message",
    listener: (event: { readonly data: unknown }) => void,
  ): void {
    if (this.listener === listener) this.listener = null;
  }

  send(request: StudioLocalDatabaseWorkerRequest): void {
    this.listener?.({ data: request });
  }
}

function request(
  requestId: number,
  payload:
    | { readonly kind: "initialize" }
    | {
        readonly kind: "call";
        readonly method: Extract<StudioLocalDatabaseWorkerRequest, { kind: "call" }>["method"];
        readonly args: readonly unknown[];
      }
    | { readonly kind: "close" },
): StudioLocalDatabaseWorkerRequest {
  return {
    version: STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION,
    requestId,
    ...payload,
  } as StudioLocalDatabaseWorkerRequest;
}

function structuralDatabase(
  methods: Record<string, unknown>,
): StudioLocalDatabaseWorkerDatabase {
  return new Proxy(methods, {
    get(target, property): unknown {
      return Reflect.get(target, property);
    },
  }) as unknown as StudioLocalDatabaseWorkerDatabase;
}

async function flushQueue(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

describe("Studio local database Worker host", () => {
  it("deduplicates lazy database initialization across queued requests", async () => {
    const scope = new FakeScope();
    const deferred: {
      resolve?: (database: StudioLocalDatabaseWorkerDatabase) => void;
    } = {};
    const opening = new Promise<StudioLocalDatabaseWorkerDatabase>((resolve) => {
      deferred.resolve = resolve;
    });
    const openDatabase = vi.fn(() => opening);
    const kvGet = vi.fn(async () => "hero-json");
    const close = vi.fn(async () => undefined);
    attachStudioLocalDatabaseWorkerHost(scope, { openDatabase });

    scope.send(request(1, { kind: "initialize" }));
    scope.send(request(2, { kind: "call", method: "kvGet", args: ["models", "hero"] }));
    await flushQueue();
    expect(openDatabase).toHaveBeenCalledTimes(1);
    expect(scope.responses).toHaveLength(0);

    deferred.resolve?.(structuralDatabase({ kvGet, close }));
    await flushQueue();

    expect(openDatabase).toHaveBeenCalledTimes(1);
    expect(kvGet).toHaveBeenCalledWith("models", "hero");
    expect(scope.responses).toMatchObject([
      { kind: "success", requestId: 1 },
      { kind: "success", requestId: 2, value: "hero-json" },
    ]);
  });

  it("reopens after SQLITE_CORRUPT even when native OPFS wipe is locked", async () => {
    const scope = new FakeScope();
    const close = vi.fn(async () => undefined);
    const recoveredGet = vi.fn(async () => "rebuilt");
    const openDatabase = vi.fn()
      .mockResolvedValueOnce(structuralDatabase({
        kvGet: vi.fn(async () => {
          throw new Error("SQLITE_CORRUPT: database disk image is malformed");
        }),
        close,
      }))
      .mockResolvedValueOnce(structuralDatabase({ kvGet: recoveredGet, close }));
    const lockedWipe = vi.spyOn(
      await import("./studio-local-database"),
      "wipeStudioSqliteOpfsDirectory",
    ).mockRejectedValue(
      new DOMException(
        "An attempt was made to modify an object where modifications are not allowed.",
        "NoModificationAllowedError",
      ),
    );
    attachStudioLocalDatabaseWorkerHost(scope, { openDatabase });

    scope.send(request(1, { kind: "call", method: "kvGet", args: ["autosave", "doc"] }));
    await vi.waitFor(() => expect(scope.responses).toHaveLength(1));
    lockedWipe.mockRestore();

    expect(close).toHaveBeenCalledOnce();
    expect(openDatabase).toHaveBeenCalledTimes(2);
    expect(recoveredGet).toHaveBeenCalledWith("autosave", "doc");
    expect(scope.responses[0]).toMatchObject({
      kind: "success",
      requestId: 1,
      value: "rebuilt",
    });
  });

  it("wipes and reopens once after SQLITE_CORRUPT so kvGet can continue", async () => {
    const scope = new FakeScope();
    const close = vi.fn(async () => undefined);
    const recoveredGet = vi.fn(async () => "rebuilt");
    const openDatabase = vi.fn()
      .mockResolvedValueOnce(structuralDatabase({
        kvGet: vi.fn(async () => {
          throw new Error("SQLITE_CORRUPT: database disk image is malformed");
        }),
        close,
      }))
      .mockResolvedValueOnce(structuralDatabase({ kvGet: recoveredGet, close }));
    attachStudioLocalDatabaseWorkerHost(scope, { openDatabase });

    scope.send(request(1, { kind: "call", method: "kvGet", args: ["autosave", "doc"] }));
    await vi.waitFor(() => expect(scope.responses).toHaveLength(1));

    expect(close).toHaveBeenCalledOnce();
    expect(openDatabase).toHaveBeenCalledTimes(2);
    expect(recoveredGet).toHaveBeenCalledWith("autosave", "doc");
    expect(scope.responses[0]).toMatchObject({
      kind: "success",
      requestId: 1,
      value: "rebuilt",
    });
  });

  it("serializes operations across async method boundaries", async () => {
    const scope = new FakeScope();
    const deferred: { resolve?: () => void } = {};
    const write = new Promise<void>((resolve) => {
      deferred.resolve = resolve;
    });
    const kvSet = vi.fn(() => write);
    const kvGet = vi.fn(async () => "committed");
    const close = vi.fn(async () => undefined);
    const openDatabase = vi.fn(async () => structuralDatabase({ kvSet, kvGet, close }));
    attachStudioLocalDatabaseWorkerHost(scope, { openDatabase });

    scope.send(request(1, { kind: "call", method: "kvSet", args: ["models", "hero", "v2"] }));
    scope.send(request(2, { kind: "call", method: "kvGet", args: ["models", "hero"] }));
    await flushQueue();

    expect(kvSet).toHaveBeenCalledTimes(1);
    expect(kvGet).not.toHaveBeenCalled();
    deferred.resolve?.();
    await flushQueue();

    expect(kvGet).toHaveBeenCalledTimes(1);
    expect(scope.responses.map((response) => response.requestId)).toEqual([1, 2]);
  });

  it("serializes a UI put submitted between CAS comparison and restore behind the RPC", async () => {
    const scope = new FakeScope();
    const events: string[] = [];
    const deferred: { resolve?: () => void } = {};
    const casTransaction = new Promise<void>((resolve) => {
      deferred.resolve = resolve;
    });
    const compareAndRestoreBrushLibraryRecords = vi.fn(async () => {
      // The real database method performs both phases synchronously inside BEGIN IMMEDIATE. This
      // pause models the narrowest possible comparison/restore window at the Worker RPC boundary.
      events.push("cas-compare");
      await casTransaction;
      events.push("cas-restore-and-commit");
      return { restoredIds: ["pack-brush"], conflictIds: [] };
    });
    const putBrushLibraryRecord = vi.fn(async () => {
      events.push("user-put");
    });
    const close = vi.fn(async () => undefined);
    attachStudioLocalDatabaseWorkerHost(scope, {
      openDatabase: async () => structuralDatabase({
        compareAndRestoreBrushLibraryRecords,
        putBrushLibraryRecord,
        close,
      }),
    });

    scope.send(request(1, {
      kind: "call",
      method: "compareAndRestoreBrushLibraryRecords",
      args: [[{
        id: "pack-brush",
        expected: { id: "pack-brush" },
        restore: null,
      }], []],
    }));
    scope.send(request(2, {
      kind: "call",
      method: "putBrushLibraryRecord",
      args: [{ id: "pack-brush", payload: "newer-user-edit" }],
    }));
    await flushQueue();

    expect(events).toEqual(["cas-compare"]);
    expect(putBrushLibraryRecord).not.toHaveBeenCalled();

    deferred.resolve?.();
    await vi.waitFor(() => expect(scope.responses).toHaveLength(2));

    expect(events).toEqual(["cas-compare", "cas-restore-and-commit", "user-put"]);
    expect(scope.responses.map((response) => response.requestId)).toEqual([1, 2]);
  });

  it("orders close after prior calls and fails closed for later calls", async () => {
    const scope = new FakeScope();
    const kvGet = vi.fn(async () => "hero-json");
    const close = vi.fn(async () => undefined);
    const openDatabase = vi.fn(async () => structuralDatabase({ kvGet, close }));
    attachStudioLocalDatabaseWorkerHost(scope, { openDatabase });

    scope.send(request(1, { kind: "call", method: "kvGet", args: ["models", "hero"] }));
    scope.send(request(2, { kind: "close" }));
    scope.send(request(3, { kind: "call", method: "kvGet", args: ["models", "hero"] }));
    await vi.waitFor(() => expect(scope.responses).toHaveLength(3));

    expect(close).toHaveBeenCalledTimes(1);
    expect(kvGet).toHaveBeenCalledTimes(1);
    expect(scope.responses).toMatchObject([
      { kind: "success", requestId: 1, value: "hero-json" },
      { kind: "success", requestId: 2 },
      {
        kind: "failure",
        requestId: 3,
        error: { details: { code: "worker-closed" } },
      },
    ]);
  });

  it("rejects replayed request IDs without executing a second mutation", async () => {
    const scope = new FakeScope();
    const kvSet = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const openDatabase = vi.fn(async () => structuralDatabase({ kvSet, close }));
    attachStudioLocalDatabaseWorkerHost(scope, { openDatabase });

    const mutation = request(1, {
      kind: "call",
      method: "kvSet",
      args: ["models", "hero", "v2"],
    });
    scope.send(mutation);
    scope.send(mutation);
    await vi.waitFor(() => expect(scope.responses).toHaveLength(2));

    expect(kvSet).toHaveBeenCalledTimes(1);
    expect(scope.responses[1]).toMatchObject({
      kind: "failure",
      requestId: 1,
      error: { details: { code: "worker-protocol" } },
    });
  });

  it("reports a committed mutation as outcome-unknown when its success response cannot post", async () => {
    const scope = new FakeScope();
    scope.throwingPostAttempts.add(1);
    const kvSet = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    attachStudioLocalDatabaseWorkerHost(scope, {
      openDatabase: async () => structuralDatabase({ kvSet, close }),
    });

    scope.send(request(1, {
      kind: "call",
      method: "kvSet",
      args: ["models", "hero", "v2"],
    }));
    await vi.waitFor(() => expect(scope.responseAttempts).toHaveLength(2));

    expect(kvSet).toHaveBeenCalledOnce();
    expect(scope.responseAttempts[0]).toMatchObject({ kind: "success", requestId: 1 });
    expect(scope.responses).toMatchObject([
      {
        kind: "failure",
        requestId: 1,
        error: {
          name: "StudioLocalDatabaseCommitOutcomeUnknownError",
          details: {
            code: "commit-outcome-unknown",
            method: "kvSet",
          },
        },
      },
    ]);
  });

  it("reports a read success-post failure as a protocol transport failure", async () => {
    const scope = new FakeScope();
    scope.throwingPostAttempts.add(1);
    const kvGet = vi.fn(async () => "hero-json");
    const close = vi.fn(async () => undefined);
    attachStudioLocalDatabaseWorkerHost(scope, {
      openDatabase: async () => structuralDatabase({ kvGet, close }),
    });

    scope.send(request(1, {
      kind: "call",
      method: "kvGet",
      args: ["models", "hero"],
    }));
    await vi.waitFor(() => expect(scope.responseAttempts).toHaveLength(2));

    expect(kvGet).toHaveBeenCalledOnce();
    expect(scope.responses).toMatchObject([
      {
        kind: "failure",
        requestId: 1,
        error: {
          name: "StudioLocalDatabaseWorkerProtocolError",
          details: { code: "worker-protocol" },
        },
      },
    ]);
    expect(scope.responses[0]).not.toMatchObject({
      error: { details: { code: "commit-outcome-unknown" } },
    });
  });

  it("swallows an unusable fallback channel and keeps the FIFO queue advancing", async () => {
    const scope = new FakeScope();
    scope.throwingPostAttempts.add(1);
    scope.throwingPostAttempts.add(2);
    const kvSet = vi.fn(async () => undefined);
    const kvGet = vi.fn(async () => "committed");
    const close = vi.fn(async () => undefined);
    attachStudioLocalDatabaseWorkerHost(scope, {
      openDatabase: async () => structuralDatabase({ kvSet, kvGet, close }),
    });

    scope.send(request(1, {
      kind: "call",
      method: "kvSet",
      args: ["models", "hero", "v2"],
    }));
    scope.send(request(2, {
      kind: "call",
      method: "kvGet",
      args: ["models", "hero"],
    }));
    await vi.waitFor(() => expect(scope.responseAttempts).toHaveLength(3));

    expect(kvSet).toHaveBeenCalledOnce();
    expect(kvGet).toHaveBeenCalledOnce();
    expect(scope.responses).toMatchObject([
      { kind: "success", requestId: 2, value: "committed" },
    ]);
  });
});
