import { StudioLocalDatabaseCommitOutcomeUnknownError } from "./studio-local-database-commit-outcome";
import {
  STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION,
  isStudioLocalDatabaseWorkerMutationMethod,
  isStudioLocalDatabaseWorkerRequest,
  serializeStudioLocalDatabaseWorkerError,
  studioLocalDatabaseWorkerRequestId,
  type StudioLocalDatabaseWorkerRequest,
  type StudioLocalDatabaseWorkerResponse,
} from "./studio-local-database-worker-protocol";

import type { StudioLocalDatabaseWorkerDatabase } from "./studio-local-database-worker-database";

interface StudioLocalDatabaseWorkerMessageEvent {
  readonly data: unknown;
}

export interface StudioLocalDatabaseWorkerScopeLike {
  postMessage(message: StudioLocalDatabaseWorkerResponse): void;
  addEventListener(
    type: "message",
    listener: (event: StudioLocalDatabaseWorkerMessageEvent) => void,
  ): void;
  removeEventListener?(
    type: "message",
    listener: (event: StudioLocalDatabaseWorkerMessageEvent) => void,
  ): void;
}

export interface StudioLocalDatabaseWorkerHostOptions {
  /** Actual Worker passes a lazy dynamic-import OPFS opener; tests inject a structural double. */
  readonly openDatabase: () => Promise<StudioLocalDatabaseWorkerDatabase>;
}

export interface StudioLocalDatabaseWorkerHost {
  dispose(): void;
}

class StudioLocalDatabaseWorkerProtocolError extends Error {
  readonly code = "worker-protocol";

  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "StudioLocalDatabaseWorkerProtocolError";
  }
}

class StudioLocalDatabaseWorkerClosedError extends Error {
  readonly code = "worker-closed";

  constructor() {
    super("Studio local database Worker is closed");
    this.name = "StudioLocalDatabaseWorkerClosedError";
  }
}

function success(
  requestId: number,
  value: unknown,
): StudioLocalDatabaseWorkerResponse {
  return {
    version: STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION,
    kind: "success",
    requestId,
    value,
  };
}

function failure(
  requestId: number,
  error: unknown,
): StudioLocalDatabaseWorkerResponse {
  return {
    version: STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION,
    kind: "failure",
    requestId,
    error: serializeStudioLocalDatabaseWorkerError(error),
  };
}

/**
 * Attaches a serialized SQLite RPC dispatcher to one DedicatedWorker scope. Message delivery is
 * FIFO, but async handlers can otherwise interleave after await; the explicit tail keeps every
 * transaction and close ordered against initialization and prior calls.
 */
export function attachStudioLocalDatabaseWorkerHost(
  scope: StudioLocalDatabaseWorkerScopeLike,
  options: StudioLocalDatabaseWorkerHostOptions,
): StudioLocalDatabaseWorkerHost {
  let databasePromise: Promise<StudioLocalDatabaseWorkerDatabase> | null = null;
  let operationTail: Promise<void> = Promise.resolve();
  let lastRequestId = 0;
  let closed = false;
  let disposed = false;

  const acquireDatabase = (): Promise<StudioLocalDatabaseWorkerDatabase> => {
    if (closed || disposed) return Promise.reject(new StudioLocalDatabaseWorkerClosedError());
    if (databasePromise) return databasePromise;
    const opening = Promise.resolve().then(options.openDatabase);
    databasePromise = opening;
    void opening.catch(() => {
      if (databasePromise === opening) databasePromise = null;
    });
    return opening;
  };

  const postFailureBestEffort = (requestId: number, error: unknown): void => {
    try {
      scope.postMessage(failure(requestId, error));
    } catch {
      // The page-side watchdog owns terminal cleanup when no response can cross the channel.
    }
  };

  const postSuccessOrTransportFailure = (
    request: StudioLocalDatabaseWorkerRequest,
    value: unknown,
  ): void => {
    try {
      scope.postMessage(success(request.requestId, value));
    } catch (cause) {
      const responseError =
        request.kind === "call" &&
        isStudioLocalDatabaseWorkerMutationMethod(request.method)
          ? new StudioLocalDatabaseCommitOutcomeUnknownError(request.method, cause)
          : new StudioLocalDatabaseWorkerProtocolError(
              "Studio local database Worker success response could not be posted",
              { cause },
            );
      postFailureBestEffort(request.requestId, responseError);
    }
  };

  const execute = async (request: StudioLocalDatabaseWorkerRequest): Promise<void> => {
    try {
      if (request.requestId <= lastRequestId) {
        throw new StudioLocalDatabaseWorkerProtocolError(
          "Studio local database Worker request IDs must increase monotonically",
        );
      }
      lastRequestId = request.requestId;

      if (request.kind === "close") {
        if (!closed) {
          closed = true;
          const database = databasePromise;
          databasePromise = null;
          if (database) await (await database).close();
        }
        postSuccessOrTransportFailure(request, undefined);
        return;
      }
      if (closed || disposed) throw new StudioLocalDatabaseWorkerClosedError();

      const database = await acquireDatabase();
      if (request.kind === "initialize") {
        postSuccessOrTransportFailure(request, undefined);
        return;
      }

      const candidate: unknown = Reflect.get(database, request.method);
      if (typeof candidate !== "function") {
        throw new StudioLocalDatabaseWorkerProtocolError(
          `Studio local database does not implement RPC method ${request.method}`,
        );
      }
      const method = candidate as (...args: readonly unknown[]) => Promise<unknown>;
      try {
        const value = await Reflect.apply(method, database, request.args);
        postSuccessOrTransportFailure(request, value);
      } catch (error) {
        const { isStudioSqliteCorruption, wipeStudioSqliteOpfsDirectory } = await import("./studio-local-database"
        );
        if (!isStudioSqliteCorruption(error) || request.kind !== "call") throw error;
        try {
          await database.close();
        } catch {
          // The corrupt handle is discarded either way.
        }
        databasePromise = null;
        try {
          await wipeStudioSqliteOpfsDirectory();
        } catch {
          // Locked SAH files stay until reopen resets them through the live pool.
        }
        const recovered = await acquireDatabase();
        const recoveredMethod = Reflect.get(recovered, request.method);
        if (typeof recoveredMethod !== "function") throw error;
        const value = await Reflect.apply(
          recoveredMethod as (...args: readonly unknown[]) => Promise<unknown>,
          recovered,
          request.args,
        );
        postSuccessOrTransportFailure(request, value);
      }
    } catch (error) {
      postFailureBestEffort(request.requestId, error);
    }
  };

  const onMessage = (event: StudioLocalDatabaseWorkerMessageEvent): void => {
    if (disposed) return;
    const requestId = studioLocalDatabaseWorkerRequestId(event.data);
    if (!isStudioLocalDatabaseWorkerRequest(event.data)) {
      if (requestId !== null) {
        postFailureBestEffort(
          requestId,
          new StudioLocalDatabaseWorkerProtocolError(
            "Studio local database Worker received an invalid RPC request",
          ),
        );
      }
      return;
    }
    const run = () => execute(event.data as StudioLocalDatabaseWorkerRequest);
    operationTail = operationTail.then(run, run);
  };

  scope.addEventListener("message", onMessage);
  return Object.freeze({
    dispose(): void {
      if (disposed) return;
      disposed = true;
      closed = true;
      scope.removeEventListener?.("message", onMessage);
      const database = databasePromise;
      databasePromise = null;
      if (database) {
        operationTail = operationTail.then(
          async () => {
            try {
              await (await database).close();
            } catch {
              // A terminating realm cannot report teardown failure; DB close remains best effort.
            }
          },
          async () => {
            try {
              await (await database).close();
            } catch {
              // Same cleanup path after an unexpected prior queue rejection.
            }
          },
        );
      }
    },
  });
}
