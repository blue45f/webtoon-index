import {
  SqliteUnavailableError,
  StudioCrdtOutboxSqlCapacityError,
  StudioCrdtRecoverySqlCapacityError,
} from "./studio-local-database";
import { StudioLocalDatabaseCommitOutcomeUnknownError } from "./studio-local-database-commit-outcome";
import {
  STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION,
  isStudioLocalDatabaseWorkerMethod,
  isStudioLocalDatabaseWorkerMutationMethod,
  isStudioLocalDatabaseWorkerResponse,
  type StudioLocalDatabaseWorkerErrorDetail,
  type StudioLocalDatabaseWorkerMethod,
  type StudioLocalDatabaseWorkerRequest,
  type StudioLocalDatabaseWorkerResponse,
  type StudioLocalDatabaseWorkerSerializedError,
} from "./studio-local-database-worker-protocol";

import type { StudioLocalDatabaseWorkerDatabase } from "./studio-local-database-worker-database";

interface StudioLocalDatabaseWorkerMessageEvent {
  readonly data: unknown;
}

interface StudioLocalDatabaseWorkerErrorEvent {
  readonly error?: unknown;
  readonly message?: string;
  preventDefault?(): void;
}

export interface StudioLocalDatabaseWorkerLike {
  onmessage: ((event: StudioLocalDatabaseWorkerMessageEvent) => void) | null;
  onerror: ((event: StudioLocalDatabaseWorkerErrorEvent) => void) | null;
  onmessageerror: ((event: StudioLocalDatabaseWorkerMessageEvent) => void) | null;
  postMessage(message: StudioLocalDatabaseWorkerRequest): void;
  terminate(): void;
}

export type StudioLocalDatabaseWorkerFactory = () => StudioLocalDatabaseWorkerLike;

export interface StudioLocalDatabaseWorkerClientOptions {
  /** Deterministic test seam. Product code must use the default DedicatedWorker factory. */
  readonly workerFactory?: StudioLocalDatabaseWorkerFactory;
  /** Transport watchdog; timed-out mutations remain explicitly commit-outcome-unknown. */
  readonly requestTimeoutMs?: number;
}

export const STUDIO_LOCAL_DATABASE_WORKER_REQUEST_TIMEOUT_MS = 120_000;

export type StudioLocalDatabaseWorkerClientErrorCode =
  | "worker-closed"
  | "worker-construction-failed"
  | "worker-error"
  | "worker-message-error"
  | "worker-post-failed"
  | "worker-protocol"
  | "worker-request-timeout"
  | "request-id-exhausted";

export class StudioLocalDatabaseWorkerClientError extends Error {
  readonly code: StudioLocalDatabaseWorkerClientErrorCode;

  constructor(
    code: StudioLocalDatabaseWorkerClientErrorCode,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "StudioLocalDatabaseWorkerClientError";
    this.code = code;
  }
}

export {
  StudioLocalDatabaseCommitOutcomeUnknownError,
  isStudioLocalDatabaseCommitOutcomeUnknownError,
} from "./studio-local-database-commit-outcome";

export class StudioLocalDatabaseWorkerRemoteError extends Error {
  readonly remoteName: string;
  readonly details: Readonly<Record<string, StudioLocalDatabaseWorkerErrorDetail>>;
  readonly code: StudioLocalDatabaseWorkerErrorDetail | undefined;
  readonly reason: StudioLocalDatabaseWorkerErrorDetail | undefined;
  declare readonly cause: StudioLocalDatabaseWorkerRemoteError | undefined;

  constructor(serialized: StudioLocalDatabaseWorkerSerializedError) {
    super(serialized.message);
    this.name = "StudioLocalDatabaseWorkerRemoteError";
    this.remoteName = serialized.name;
    this.details = serialized.details ?? Object.freeze({});
    this.code = this.details.code;
    this.reason = this.details.reason;
    if (serialized.stack) {
      Object.defineProperty(this, "stack", {
        value: serialized.stack,
        configurable: true,
      });
    }
    if (serialized.cause) {
      Object.defineProperty(this, "cause", {
        value: new StudioLocalDatabaseWorkerRemoteError(serialized.cause),
        configurable: true,
      });
    }
  }
}

function errorDetailNumber(
  serialized: StudioLocalDatabaseWorkerSerializedError,
  key: "entryCount" | "rowCount" | "totalBytes",
): number | null {
  const value = serialized.details?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function applyRemoteErrorEnvelope<T extends Error>(
  error: T,
  serialized: StudioLocalDatabaseWorkerSerializedError,
  cause: Error | undefined,
): T {
  if (serialized.stack) {
    Object.defineProperty(error, "stack", {
      value: serialized.stack,
      configurable: true,
    });
  }
  if (cause) {
    Object.defineProperty(error, "cause", { value: cause, configurable: true });
  }
  return error;
}

function deserializeRemoteError(
  serialized: StudioLocalDatabaseWorkerSerializedError,
): Error {
  const cause = serialized.cause ? deserializeRemoteError(serialized.cause) : undefined;
  const commitMethod = serialized.details?.method;
  if (
    serialized.details?.code === "commit-outcome-unknown"
    && isStudioLocalDatabaseWorkerMethod(commitMethod)
  ) {
    return applyRemoteErrorEnvelope(
      new StudioLocalDatabaseCommitOutcomeUnknownError(
        commitMethod,
        cause ?? new Error(serialized.message),
      ),
      serialized,
      cause,
    );
  }
  if (serialized.name === "SqliteUnavailableError") {
    const reason = serialized.details?.reason;
    return applyRemoteErrorEnvelope(
      new SqliteUnavailableError(
        typeof reason === "string" ? reason : serialized.message,
        cause ? { cause } : undefined,
      ),
      serialized,
      cause,
    );
  }
  if (serialized.name === "StudioCrdtOutboxSqlCapacityError") {
    const entryCount = errorDetailNumber(serialized, "entryCount");
    const totalBytes = errorDetailNumber(serialized, "totalBytes");
    if (entryCount !== null && totalBytes !== null) {
      return applyRemoteErrorEnvelope(
        new StudioCrdtOutboxSqlCapacityError(entryCount, totalBytes),
        serialized,
        cause,
      );
    }
  }
  if (serialized.name === "StudioCrdtRecoverySqlCapacityError") {
    const rowCount = errorDetailNumber(serialized, "rowCount");
    const totalBytes = errorDetailNumber(serialized, "totalBytes");
    if (rowCount !== null && totalBytes !== null) {
      return applyRemoteErrorEnvelope(
        new StudioCrdtRecoverySqlCapacityError(rowCount, totalBytes),
        serialized,
        cause,
      );
    }
  }
  return new StudioLocalDatabaseWorkerRemoteError(serialized);
}

type SessionPhase = "cold" | "opening" | "ready" | "closing" | "closed" | "failed";

interface PendingRequest {
  readonly request: StudioLocalDatabaseWorkerRequest;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly timeoutId: ReturnType<typeof setTimeout>;
}

type MethodArguments<Method extends StudioLocalDatabaseWorkerMethod> =
  StudioLocalDatabaseWorkerDatabase[Method] extends (...args: infer Arguments) => Promise<unknown>
    ? Arguments
    : never;
type MethodReturn<Method extends StudioLocalDatabaseWorkerMethod> =
  StudioLocalDatabaseWorkerDatabase[Method] extends (...args: never[]) => infer Result
    ? Result
    : never;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown Worker failure";
}

function defaultWorkerFactory(): StudioLocalDatabaseWorkerLike {
  if (typeof Worker !== "function") {
    throw new StudioLocalDatabaseWorkerClientError(
      "worker-construction-failed",
      "DedicatedWorker is unavailable; Studio SQLite will not fall back to main-thread memory",
    );
  }
  return new Worker(new URL("./studio-local-database.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-studio-local-database",
  }) as unknown as StudioLocalDatabaseWorkerLike;
}

class StudioLocalDatabaseWorkerSession {
  private readonly workerFactory: StudioLocalDatabaseWorkerFactory;
  private readonly requestTimeoutMs: number;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly activeCalls = new Set<Promise<unknown>>();
  private worker: StudioLocalDatabaseWorkerLike | null = null;
  private phase: SessionPhase = "cold";
  private nextRequestId = 1;
  private initialization: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private terminalError: StudioLocalDatabaseWorkerClientError | null = null;

  constructor(options: StudioLocalDatabaseWorkerClientOptions) {
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
    const requestedTimeout = options.requestTimeoutMs
      ?? STUDIO_LOCAL_DATABASE_WORKER_REQUEST_TIMEOUT_MS;
    this.requestTimeoutMs = Number.isSafeInteger(requestedTimeout) && requestedTimeout > 0
      ? requestedTimeout
      : STUDIO_LOCAL_DATABASE_WORKER_REQUEST_TIMEOUT_MS;
  }

  private closedError(): StudioLocalDatabaseWorkerClientError {
    return new StudioLocalDatabaseWorkerClientError(
      "worker-closed",
      "Studio local database Worker is closed",
    );
  }

  private assertCanCall(): void {
    if (this.phase === "closing" || this.phase === "closed") throw this.closedError();
    if (this.phase === "failed") throw this.terminalError ?? this.closedError();
  }

  private ensureWorker(): StudioLocalDatabaseWorkerLike {
    if (this.worker) return this.worker;
    this.assertCanCall();
    try {
      const worker = this.workerFactory();
      worker.onmessage = this.onMessage;
      worker.onerror = this.onError;
      worker.onmessageerror = this.onMessageError;
      this.worker = worker;
      return worker;
    } catch (error) {
      const failure =
        error instanceof StudioLocalDatabaseWorkerClientError
          ? error
          : new StudioLocalDatabaseWorkerClientError(
              "worker-construction-failed",
              `Studio local database Worker construction failed: ${errorMessage(error)}`,
              { cause: error },
            );
      this.phase = "failed";
      this.terminalError = failure;
      throw failure;
    }
  }

  private allocateRequestId(): number {
    if (!Number.isSafeInteger(this.nextRequestId) || this.nextRequestId > Number.MAX_SAFE_INTEGER) {
      throw new StudioLocalDatabaseWorkerClientError(
        "request-id-exhausted",
        "Studio local database Worker exhausted its monotonic request ID space",
      );
    }
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }

  private send(
    payload:
      | { readonly kind: "initialize" }
      | {
          readonly kind: "call";
          readonly method: StudioLocalDatabaseWorkerMethod;
          readonly args: readonly unknown[];
        }
      | { readonly kind: "close" },
  ): Promise<unknown> {
    const worker = this.ensureWorker();
    const requestId = this.allocateRequestId();
    const request = {
      version: STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION,
      requestId,
      ...payload,
    } as StudioLocalDatabaseWorkerRequest;
    return new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (!this.pending.has(requestId)) return;
        this.failTerminal(
          new StudioLocalDatabaseWorkerClientError(
            "worker-request-timeout",
            `Studio local database Worker request ${requestId} did not settle within ${this.requestTimeoutMs}ms`,
          ),
        );
      }, this.requestTimeoutMs);
      this.pending.set(requestId, { request, resolve, reject, timeoutId });
      try {
        worker.postMessage(request);
      } catch (error) {
        const pending = this.pending.get(requestId);
        if (pending) clearTimeout(pending.timeoutId);
        this.pending.delete(requestId);
        reject(
          new StudioLocalDatabaseWorkerClientError(
            "worker-post-failed",
            `Studio local database Worker request was not delivered: ${errorMessage(error)}`,
            { cause: error },
          ),
        );
      }
    });
  }

  private cleanupWorker(): void {
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  }

  private failTerminal(error: StudioLocalDatabaseWorkerClientError): void {
    if (this.phase === "closed" || this.phase === "failed") return;
    this.phase = "failed";
    this.terminalError = error;
    this.cleanupWorker();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutId);
      if (
        pending.request.kind === "call" &&
        isStudioLocalDatabaseWorkerMutationMethod(pending.request.method)
      ) {
        pending.reject(
          new StudioLocalDatabaseCommitOutcomeUnknownError(pending.request.method, error),
        );
      } else {
        pending.reject(error);
      }
    }
    this.pending.clear();
  }

  private readonly onMessage = (event: StudioLocalDatabaseWorkerMessageEvent): void => {
    if (!isStudioLocalDatabaseWorkerResponse(event.data)) {
      this.failTerminal(
        new StudioLocalDatabaseWorkerClientError(
          "worker-protocol",
          "Studio local database Worker returned an invalid RPC response",
        ),
      );
      return;
    }
    const response: StudioLocalDatabaseWorkerResponse = event.data;
    const pending = this.pending.get(response.requestId);
    if (!pending) {
      this.failTerminal(
        new StudioLocalDatabaseWorkerClientError(
          "worker-protocol",
          `Studio local database Worker returned unknown request ID ${response.requestId}`,
        ),
      );
      return;
    }
    clearTimeout(pending.timeoutId);
    this.pending.delete(response.requestId);
    if (response.kind === "failure") {
      pending.reject(deserializeRemoteError(response.error));
    } else {
      pending.resolve(response.value);
    }
  };

  private readonly onError = (event: StudioLocalDatabaseWorkerErrorEvent): void => {
    event.preventDefault?.();
    const cause = event.error;
    this.failTerminal(
      new StudioLocalDatabaseWorkerClientError(
        "worker-error",
        `Studio local database Worker crashed: ${event.message ?? errorMessage(cause)}`,
        { cause },
      ),
    );
  };

  private readonly onMessageError = (): void => {
    this.failTerminal(
      new StudioLocalDatabaseWorkerClientError(
        "worker-message-error",
        "Studio local database Worker response could not be deserialized",
      ),
    );
  };

  initialize(): Promise<void> {
    this.assertCanCall();
    if (this.phase === "ready") return Promise.resolve();
    if (this.initialization) return this.initialization;
    this.phase = "opening";
    const initialization = this.send({ kind: "initialize" }).then(
      () => {
        if (this.phase === "opening") this.phase = "ready";
      },
      (error: unknown) => {
        if (this.phase === "opening") this.phase = "cold";
        throw error;
      },
    );
    this.initialization = initialization;
    void initialization.finally(() => {
      if (this.initialization === initialization) this.initialization = null;
    }).catch(() => {
      // The original initialization promise carries the rejection to every awaiting caller.
    });
    return initialization;
  }

  call<Method extends StudioLocalDatabaseWorkerMethod>(
    method: Method,
    ...args: MethodArguments<Method>
  ): MethodReturn<Method> {
    let initialization: Promise<void>;
    try {
      this.assertCanCall();
      initialization = this.initialize();
    } catch (error) {
      return Promise.reject(error) as MethodReturn<Method>;
    }
    // Register the call synchronously. close() then waits for every earlier invocation, including
    // calls still waiting on initialization, so its close envelope can never overtake a write.
    const result = initialization.then(() =>
      this.send({ kind: "call", method, args }));
    this.activeCalls.add(result);
    void result.finally(() => this.activeCalls.delete(result)).catch(() => {
      // The returned result remains the sole rejection authority for the caller.
    });
    return result as MethodReturn<Method>;
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    if (this.phase === "closed") return Promise.resolve();
    if (this.phase === "cold" && !this.worker) {
      this.phase = "closed";
      return Promise.resolve();
    }
    if (this.phase === "failed") {
      this.cleanupWorker();
      this.phase = "closed";
      return Promise.resolve();
    }

    this.phase = "closing";
    const priorCalls = [...this.activeCalls];
    const closing = Promise.allSettled(priorCalls).then(() =>
      this.send({ kind: "close" })).then(
      () => {
        this.cleanupWorker();
        this.phase = "closed";
      },
      (error: unknown) => {
        this.cleanupWorker();
        this.phase = "closed";
        throw error;
      },
    );
    this.closing = closing;
    return closing;
  }
}

interface StudioLocalDatabaseWorkerClientPair {
  readonly database: StudioLocalDatabaseWorkerDatabase;
  readonly session: StudioLocalDatabaseWorkerSession;
}

function createClientPair(
  options: StudioLocalDatabaseWorkerClientOptions,
): StudioLocalDatabaseWorkerClientPair {
  const session = new StudioLocalDatabaseWorkerSession(options);
  const database = {
    kvGet: (namespace, key) => session.call("kvGet", namespace, key),
    kvSet: (namespace, key, value) => session.call("kvSet", namespace, key, value),
    kvDelete: (namespace, key) => session.call("kvDelete", namespace, key),
    putTournamentWinner: (winner) => session.call("putTournamentWinner", winner),
    getTournamentWinner: (bucket, deviceHash) =>
      session.call("getTournamentWinner", bucket, deviceHash),
    listTournamentWinners: () => session.call("listTournamentWinners"),
    listTournamentWinnerCandidates: () =>
      session.call("listTournamentWinnerCandidates"),
    replaceTournamentWinners: (winners) =>
      session.call("replaceTournamentWinners", winners),
    evictTournamentProvider: (providerId) =>
      session.call("evictTournamentProvider", providerId),
    recordCostSample: (providerId, bucket, kind, ms) =>
      session.call("recordCostSample", providerId, bucket, kind, ms),
    listCostSamples: (providerId, bucket, limit) =>
      session.call("listCostSamples", providerId, bucket, limit),
    appendJournalEntry: (projectId, entry) =>
      session.call("appendJournalEntry", projectId, entry),
    listJournalEntries: (projectId) => session.call("listJournalEntries", projectId),
    deleteJournalEntriesBefore: (projectId, seq) =>
      session.call("deleteJournalEntriesBefore", projectId, seq),
    putJournalSnapshot: (projectId, snapshot) =>
      session.call("putJournalSnapshot", projectId, snapshot),
    listJournalSnapshots: (projectId) => session.call("listJournalSnapshots", projectId),
    asAsyncKeyValueStore: (namespace) => ({
      get: (key) => session.call("kvGet", namespace, key),
      set: (key, value) => session.call("kvSet", namespace, key, value),
      delete: (key) => session.call("kvDelete", namespace, key),
    }),
    queryBrushLibraryRecords: (query) =>
      session.call("queryBrushLibraryRecords", query),
    getBrushLibraryRecord: (id) => session.call("getBrushLibraryRecord", id),
    putBrushLibraryRecord: (record) => session.call("putBrushLibraryRecord", record),
    putBrushLibraryRecords: (records) =>
      session.call("putBrushLibraryRecords", records),
    compareAndRestoreBrushLibraryRecords: (entries, sidecars) =>
      session.call("compareAndRestoreBrushLibraryRecords", entries, sidecars),
    insertMissingBrushLibraryRecords: (records) =>
      session.call("insertMissingBrushLibraryRecords", records),
    deleteBrushLibraryRecord: (id) => session.call("deleteBrushLibraryRecord", id),
    listBrushLibraryNames: () => session.call("listBrushLibraryNames"),
    queryFilterLibraryRecords: (query) =>
      session.call("queryFilterLibraryRecords", query),
    getFilterLibraryRecord: (id) => session.call("getFilterLibraryRecord", id),
    putFilterLibraryRecord: (record) => session.call("putFilterLibraryRecord", record),
    putFilterLibraryRecords: (records) =>
      session.call("putFilterLibraryRecords", records),
    compareAndRestoreFilterLibraryRecords: (entries) =>
      session.call("compareAndRestoreFilterLibraryRecords", entries),
    insertMissingFilterLibraryRecords: (records) =>
      session.call("insertMissingFilterLibraryRecords", records),
    deleteFilterLibraryRecord: (id) => session.call("deleteFilterLibraryRecord", id),
    deleteFilterLibraryRecords: (ids) => session.call("deleteFilterLibraryRecords", ids),
    listCrdtOutboxCandidates: (scope, workId) =>
      session.call("listCrdtOutboxCandidates", scope, workId),
    enqueueCrdtOutboxRecord: (record, limits) =>
      session.call("enqueueCrdtOutboxRecord", record, limits),
    acknowledgeCrdtOutboxRecord: (scope, workId, updateId, acknowledgedAt) =>
      session.call(
        "acknowledgeCrdtOutboxRecord",
        scope,
        workId,
        updateId,
        acknowledgedAt,
      ),
    recordCrdtOutboxRetry: (scope, workId, updateId, metadata) =>
      session.call("recordCrdtOutboxRetry", scope, workId, updateId, metadata),
    listCrdtRecoveryCandidates: (scope, workId) =>
      session.call("listCrdtRecoveryCandidates", scope, workId),
    getCrdtRecoveryCandidate: (scope, workId, rowKey) =>
      session.call("getCrdtRecoveryCandidate", scope, workId, rowKey),
    putCrdtRecoveryRecord: (record, limits) =>
      session.call("putCrdtRecoveryRecord", record, limits),
    close: () => session.close(),
  } satisfies StudioLocalDatabaseWorkerDatabase;
  return Object.freeze({ database, session });
}

/** Low-level lazy proxy/test seam. Product runtime should use the page singleton below. */
export function createStudioLocalDatabaseWorkerProxy(
  options: StudioLocalDatabaseWorkerClientOptions = {},
): StudioLocalDatabaseWorkerDatabase {
  return createClientPair(options).database;
}

let sharedDatabase: Promise<StudioLocalDatabaseWorkerDatabase> | null = null;
let sharedClosing: Promise<void> | null = null;

/**
 * Opens one page-lifetime DedicatedWorker/OPFS authority. Concurrent callers share initialization;
 * the Worker then holds the origin-wide exclusive lock until closeStudioLocalDatabaseWorker().
 */
export function acquireStudioLocalDatabaseWorker(
  options: StudioLocalDatabaseWorkerClientOptions = {},
): Promise<StudioLocalDatabaseWorkerDatabase> {
  if (sharedDatabase) return sharedDatabase;
  if (sharedClosing) {
    return sharedClosing.then(() => acquireStudioLocalDatabaseWorker(options));
  }
  const pair = createClientPair(options);
  const opening = Promise.resolve()
    .then(() => pair.session.initialize())
    .then(() => pair.database);
  sharedDatabase = opening;
  void opening.catch(() => {
    if (sharedDatabase === opening) sharedDatabase = null;
    void pair.database.close().catch(() => {
      // The original initialization error is authoritative; failed-open cleanup is best effort.
    });
  });
  return opening;
}

/** Idempotent page/session shutdown seam. Product code normally keeps the Worker for app lifetime. */
export function closeStudioLocalDatabaseWorker(): Promise<void> {
  if (sharedClosing) return sharedClosing;
  const database = sharedDatabase;
  sharedDatabase = null;
  if (!database) return Promise.resolve();
  const closing = database.then(
    (opened) => opened.close(),
    () => undefined,
  ).finally(() => {
    if (sharedClosing === closing) sharedClosing = null;
  });
  sharedClosing = closing;
  return closing;
}
