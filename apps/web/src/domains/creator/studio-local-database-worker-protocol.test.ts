import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_LOCAL_DATABASE_WORKER_LOCK_NAME,
  StudioLocalDatabaseWorkerLockError,
  acquireStudioLocalDatabaseWorkerLock,
  type StudioLocalDatabaseWorkerLockManagerLike,
} from "./studio-local-database-worker-lock";
import {
  STUDIO_LOCAL_DATABASE_WORKER_METHODS,
  STUDIO_LOCAL_DATABASE_WORKER_MUTATION_METHODS,
  STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION,
  isStudioLocalDatabaseWorkerMutationMethod,
  isStudioLocalDatabaseWorkerRequest,
  isStudioLocalDatabaseWorkerResponse,
  serializeStudioLocalDatabaseWorkerError,
  studioLocalDatabaseWorkerRequestId,
} from "./studio-local-database-worker-protocol";

describe("Studio local database Worker protocol", () => {
  it("accepts only versioned allowlisted RPC methods", () => {
    expect(
      isStudioLocalDatabaseWorkerRequest({
        version: STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION,
        kind: "call",
        requestId: 1,
        method: "kvGet",
        args: ["library", "entry"],
      }),
    ).toBe(true);
    expect(
      isStudioLocalDatabaseWorkerRequest({
        version: STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION,
        kind: "call",
        requestId: 2,
        method: "asAsyncKeyValueStore",
        args: ["library"],
      }),
    ).toBe(false);
    expect(
      isStudioLocalDatabaseWorkerRequest({
        version: STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION,
        kind: "call",
        requestId: 3,
        method: "constructor",
        args: [],
      }),
    ).toBe(false);
  });

  it("accepts only exact own plain-data request envelopes", () => {
    const valid = {
      version: STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION,
      kind: "call",
      requestId: 4,
      method: "kvGet",
      args: ["library", "entry"],
    } as const;
    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, valid);
    expect(isStudioLocalDatabaseWorkerRequest(nullPrototype)).toBe(true);

    expect(isStudioLocalDatabaseWorkerRequest({ ...valid, unexpected: true })).toBe(false);
    expect(
      isStudioLocalDatabaseWorkerRequest({
        version: STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION,
        kind: "initialize",
        requestId: 5,
        method: "kvGet",
      }),
    ).toBe(false);

    const inherited = Object.create(valid) as Record<string, unknown>;
    expect(isStudioLocalDatabaseWorkerRequest(inherited)).toBe(false);
    expect(studioLocalDatabaseWorkerRequestId(inherited)).toBeNull();

    const throwingGetter = { ...valid } as Record<string, unknown>;
    Object.defineProperty(throwingGetter, "version", {
      enumerable: true,
      get(): never {
        throw new Error("getter must not execute");
      },
    });
    expect(() => isStudioLocalDatabaseWorkerRequest(throwingGetter)).not.toThrow();
    expect(isStudioLocalDatabaseWorkerRequest(throwingGetter)).toBe(false);
  });

  it("accepts only exact own plain-data response and error envelopes", () => {
    const error = {
      name: "StudioLocalDatabaseCommitOutcomeUnknownError",
      message: "response was lost",
      details: {
        code: "commit-outcome-unknown",
        method: "kvSet",
      },
    };
    const failure = {
      version: STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION,
      kind: "failure",
      requestId: 6,
      error,
    } as const;
    expect(isStudioLocalDatabaseWorkerResponse(failure)).toBe(true);
    expect(isStudioLocalDatabaseWorkerResponse({ ...failure, value: undefined })).toBe(false);
    expect(
      isStudioLocalDatabaseWorkerResponse({
        ...failure,
        error: { ...error, unexpected: true },
      }),
    ).toBe(false);
    expect(
      isStudioLocalDatabaseWorkerResponse({
        ...failure,
        error: { ...error, details: { ...error.details, unsafe: "value" } },
      }),
    ).toBe(false);

    const inherited = Object.create(failure) as Record<string, unknown>;
    expect(isStudioLocalDatabaseWorkerResponse(inherited)).toBe(false);

    const successWithGetter = {
      version: STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION,
      kind: "success",
      requestId: 7,
      value: undefined,
    } as Record<string, unknown>;
    Object.defineProperty(successWithGetter, "value", {
      enumerable: true,
      get(): never {
        throw new Error("getter must not execute");
      },
    });
    expect(() => isStudioLocalDatabaseWorkerResponse(successWithGetter)).not.toThrow();
    expect(isStudioLocalDatabaseWorkerResponse(successWithGetter)).toBe(false);
  });

  it("serializes typed primitive metadata and circular causes without cloning the source", () => {
    const error = new Error("OPFS open failed");
    error.name = "SqliteUnavailableError";
    Object.assign(error, {
      reason: "opfs-sahpool unavailable",
      code: "opfs-open-failed",
      unsafe: { secret: true },
    });
    Object.defineProperty(error, "cause", { value: error });

    const serialized = serializeStudioLocalDatabaseWorkerError(error);

    expect(serialized).toMatchObject({
      name: "SqliteUnavailableError",
      message: "OPFS open failed",
      details: {
        reason: "opfs-sahpool unavailable",
        code: "opfs-open-failed",
      },
      cause: { truncated: true },
    });
    expect(serialized.details).not.toHaveProperty("unsafe");
    expect(
      isStudioLocalDatabaseWorkerResponse({
        version: STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION,
        kind: "failure",
        requestId: 8,
        error: serialized,
      }),
    ).toBe(true);
  });

  it("classifies durable writes separately from reads", () => {
    expect(isStudioLocalDatabaseWorkerMutationMethod("kvSet")).toBe(true);
    expect(isStudioLocalDatabaseWorkerMutationMethod("putCrdtRecoveryRecord")).toBe(true);
    expect(isStudioLocalDatabaseWorkerMutationMethod("compareAndRestoreBrushLibraryRecords"))
      .toBe(true);
    expect(isStudioLocalDatabaseWorkerMutationMethod("compareAndRestoreFilterLibraryRecords"))
      .toBe(true);
    expect(isStudioLocalDatabaseWorkerMutationMethod("kvGet")).toBe(false);
    expect(isStudioLocalDatabaseWorkerMutationMethod("listJournalEntries")).toBe(false);
    expect(STUDIO_LOCAL_DATABASE_WORKER_METHODS).toHaveLength(39);
    expect(STUDIO_LOCAL_DATABASE_WORKER_MUTATION_METHODS).toHaveLength(24);
    expect(new Set(STUDIO_LOCAL_DATABASE_WORKER_MUTATION_METHODS).size).toBe(24);
  });
});

describe("Studio local database Worker ownership lock", () => {
  it("holds an exclusive ifAvailable origin lock until explicit release", async () => {
    let callbackFinished = false;
    const requestSpy = vi.fn();
    const manager: StudioLocalDatabaseWorkerLockManagerLike = {
      async request<T>(
        name: string,
        options: { readonly mode: "exclusive"; readonly ifAvailable: true },
        callback: (lock: unknown | null) => T | PromiseLike<T>,
      ): Promise<T> {
        requestSpy(name, options, callback);
        const result = await callback({ name: STUDIO_LOCAL_DATABASE_WORKER_LOCK_NAME });
        callbackFinished = true;
        return result;
      },
    };
    const lease = await acquireStudioLocalDatabaseWorkerLock(manager);

    expect(requestSpy).toHaveBeenCalledWith(
      STUDIO_LOCAL_DATABASE_WORKER_LOCK_NAME,
      { mode: "exclusive", ifAvailable: true },
      expect.any(Function),
    );
    expect(callbackFinished).toBe(false);

    await lease.release();
    expect(callbackFinished).toBe(true);
    await lease.release();
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  it("fails closed immediately when another page owns the database", async () => {
    const manager: StudioLocalDatabaseWorkerLockManagerLike = {
      async request<T>(
        _name: string,
        _options: { readonly mode: "exclusive"; readonly ifAvailable: true },
        callback: (lock: unknown | null) => T | PromiseLike<T>,
      ): Promise<T> {
        return await callback(null);
      },
    };

    await expect(acquireStudioLocalDatabaseWorkerLock(manager)).rejects.toMatchObject({
      name: "StudioLocalDatabaseWorkerLockError",
      code: "lock-unavailable",
    } satisfies Partial<StudioLocalDatabaseWorkerLockError>);
  });

  it("does not open without Web Locks", async () => {
    await expect(acquireStudioLocalDatabaseWorkerLock(null)).rejects.toMatchObject({
      code: "web-locks-unavailable",
    });
  });
});
