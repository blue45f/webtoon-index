import {
  STUDIO_LARGE_DOCUMENT_DEFAULT_SHARD_BYTES,
  STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES,
} from "./studio-large-document-address-space";
import {
  createStudioOpfsSyncAccessStore,
  isStudioOpfsSyncAccessError,
  probeStudioOpfsSyncAccessCapability,
  type StudioOpfsSyncAccessStore,
} from "./studio-opfs-sync-access-store";
import {
  STUDIO_STORAGE_WORKER_MAX_JOURNAL_APPEND_BYTES,
  STUDIO_STORAGE_WORKER_MAX_JOURNAL_BYTES,
  STUDIO_STORAGE_WORKER_MAX_RANGE_BYTES,
  STUDIO_STORAGE_WORKER_MAX_SESSION_WRITE_BYTES,
  STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
  isStudioStorageWorkerRequest,
  studioStorageWorkerError,
  studioStorageWorkerLooseCorrelation,
  studioStorageWorkerResponseTransfers,
  type StudioStorageWorkerCommandRequest,
  type StudioStorageWorkerCommandResponse,
  type StudioStorageWorkerErrorCode,
  type StudioStorageWorkerRequest,
  type StudioStorageWorkerResponse,
  type StudioStorageWorkerSessionConfig,
  type StudioStorageWorkerSessionState,
} from "./studio-storage-worker-protocol";

export interface StudioStorageWorkerScope {
  readonly navigator?: {
    readonly storage?: {
      getDirectory(): Promise<unknown>;
    };
  };
  readonly document?: unknown;
  onmessage:
    | ((event: MessageEvent<unknown>) => void)
    | null;
  onerror?:
    | ((event: ErrorEvent) => boolean | void)
    | null;
  onunhandledrejection?:
    | ((event: PromiseRejectionEvent) => void)
    | null;
  postMessage(
    message: StudioStorageWorkerResponse,
    transfer: Transferable[],
  ): void;
}

export interface StudioStorageWorkerStoreFactoryInput {
  readonly documentId: string;
  readonly shardBytes: bigint;
  readonly role: "document" | "journal";
  readonly scope: unknown;
}

export type StudioStorageWorkerStoreFactory = (
  input: StudioStorageWorkerStoreFactoryInput,
) => Promise<StudioOpfsSyncAccessStore>;

export interface StudioStorageWorkerRuntimeOptions {
  readonly scope: StudioStorageWorkerScope;
  readonly createStore?: StudioStorageWorkerStoreFactory;
}

export interface StudioStorageWorkerRuntime {
  readonly poisoned: boolean;
  readonly activeSessionEpoch: number | null;
  /** Test/host shutdown hook. It always closes the active sync handle set. */
  dispose(): Promise<void>;
}

interface ActiveSession extends StudioStorageWorkerSessionState {
  readonly config: StudioStorageWorkerSessionConfig;
}

function maximum(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer
    && bytes.byteOffset === 0
    && bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }
  return Uint8Array.from(bytes).buffer;
}

function commandOperation(
  request: Exclude<
    StudioStorageWorkerCommandRequest,
    {
      readonly type:
        | "studio-storage/open"
        | "studio-storage/checkpoint-barrier";
    }
  >,
): StudioStorageWorkerCommandResponse["operation"] {
  switch (request.type) {
    case "studio-storage/write":
      return "write";
    case "studio-storage/append-journal":
      return "append-journal";
    case "studio-storage/flush":
      return "flush";
    case "studio-storage/truncate":
      return "truncate";
    case "studio-storage/close":
      return "close";
  }
}

function isCommandRequest(
  request: StudioStorageWorkerRequest,
): request is StudioStorageWorkerCommandRequest {
  return "commandSequence" in request;
}

class StudioStorageWorkerRuntimeImpl
implements StudioStorageWorkerRuntime {
  readonly #scope: StudioStorageWorkerScope;
  readonly #createStore: StudioStorageWorkerStoreFactory;

  #operationTail: Promise<void> = Promise.resolve();
  #documentStore: StudioOpfsSyncAccessStore | null = null;
  #journalStore: StudioOpfsSyncAccessStore | null = null;
  #session: ActiveSession | null = null;
  #lastRequestSequence = 0;
  #lastCommandSequence = 0;
  #lastSessionEpoch = 0;
  #poisoned = false;
  #disposed = false;

  public constructor(options: StudioStorageWorkerRuntimeOptions) {
    this.#scope = options.scope;
    this.#createStore = options.createStore ?? (async (input) => (
      createStudioOpfsSyncAccessStore({
        documentId: input.documentId,
        shardBytes: input.shardBytes,
        rootName: input.role === "document"
          ? "toonspectrum-studio-document-data"
          : "toonspectrum-studio-command-journal",
        scope: input.scope,
      })
    ));

    this.#scope.onmessage = (event) => {
      this.#operationTail = this.#operationTail
        .then(() => this.#dispatch(event.data))
        .catch((error: unknown) => this.#failClosed(null, error));
    };

    if ("onerror" in this.#scope) {
      this.#scope.onerror = () => {
        this.#operationTail = this.#operationTail
          .then(() => this.#failClosed(
            null,
            new Error("Storage Worker uncaught error"),
          ));
        return true;
      };
    }
    if ("onunhandledrejection" in this.#scope) {
      this.#scope.onunhandledrejection = (event) => {
        event.preventDefault();
        this.#operationTail = this.#operationTail
          .then(() => this.#failClosed(null, event.reason));
      };
    }

    this.#post({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/ready",
    });
  }

  public get poisoned(): boolean {
    return this.#poisoned;
  }

  public get activeSessionEpoch(): number | null {
    return this.#session?.sessionEpoch ?? null;
  }

  public async dispose(): Promise<void> {
    if (this.#disposed) {
      await this.#operationTail;
      return;
    }
    this.#disposed = true;
    this.#scope.onmessage = null;
    this.#operationTail = this.#operationTail.then(async () => {
      await this.#closeStoresBestEffort();
      this.#session = null;
    });
    await this.#operationTail;
  }

  #post(response: StudioStorageWorkerResponse): void {
    this.#scope.postMessage(
      response,
      studioStorageWorkerResponseTransfers(response),
    );
  }

  #postError(input: {
    readonly request?: StudioStorageWorkerRequest | null;
    readonly loose?: ReturnType<
      typeof studioStorageWorkerLooseCorrelation
    >;
    readonly code: StudioStorageWorkerErrorCode;
    readonly message: string;
    readonly recoverable: boolean;
  }): void {
    const request = input.request;
    const correlation = input.loose ?? (
      request
        ? studioStorageWorkerLooseCorrelation(request)
        : {
            requestSequence: 0,
            commandSequence: null,
            sessionEpoch: null,
          }
    );
    this.#post(studioStorageWorkerError({
      ...correlation,
      code: input.code,
      message: input.message,
      recoverable: input.recoverable,
    }));
  }

  async #dispatch(value: unknown): Promise<void> {
    if (this.#disposed) return;
    if (!isStudioStorageWorkerRequest(value)) {
      this.#postError({
        loose: studioStorageWorkerLooseCorrelation(value),
        code: "PROTOCOL",
        message: "Storage Worker 요청 형식 또는 바이트 예산이 올바르지 않습니다.",
        recoverable: true,
      });
      return;
    }
    const request = value;
    if (request.requestSequence <= this.#lastRequestSequence) {
      this.#postError({
        request,
        code: "OUT_OF_ORDER_REQUEST",
        message: "requestSequence는 이전 요청보다 커야 합니다.",
        recoverable: true,
      });
      return;
    }
    this.#lastRequestSequence = request.requestSequence;

    if (this.#poisoned) {
      this.#postError({
        request,
        code: "POISONED",
        message: "Storage Worker가 저장 오류 뒤 fail-closed 상태입니다.",
        recoverable: false,
      });
      return;
    }

    if (isCommandRequest(request)) {
      if (request.commandSequence <= this.#lastCommandSequence) {
        this.#postError({
          request,
          code: "OUT_OF_ORDER_COMMAND",
          message: "commandSequence는 이전 명령보다 커야 합니다.",
          recoverable: true,
        });
        return;
      }
      this.#lastCommandSequence = request.commandSequence;
    }

    if (request.type === "studio-storage/capability") {
      this.#handleCapability(request);
      return;
    }
    if (request.type === "studio-storage/open") {
      await this.#handleOpen(request);
      return;
    }

    const session = this.#validateSession(request);
    if (session === null) return;

    try {
      switch (request.type) {
        case "studio-storage/read":
          await this.#handleRead(request, session);
          return;
        case "studio-storage/write":
          await this.#handleWrite(request, session);
          return;
        case "studio-storage/append-journal":
          await this.#handleAppendJournal(request, session);
          return;
        case "studio-storage/flush":
          await this.#handleFlush(request, session);
          return;
        case "studio-storage/truncate":
          await this.#handleTruncate(request, session);
          return;
        case "studio-storage/checkpoint-barrier":
          await this.#handleCheckpoint(request, session);
          return;
        case "studio-storage/close":
          await this.#handleClose(request, session);
          return;
      }
    } catch (error) {
      await this.#failClosed(request, error);
    }
  }

  #handleCapability(
    request: Extract<
      StudioStorageWorkerRequest,
      { readonly type: "studio-storage/capability" }
    >,
  ): void {
    const capability = probeStudioOpfsSyncAccessCapability(this.#scope);
    this.#post({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/capability-result",
      requestSequence: request.requestSequence,
      candidateSupported: capability.supported,
      reason: capability.supported
        ? "available"
        : capability.reason,
      requiresOpenProbe: true,
      limits: {
        maxRangeBytes: STUDIO_STORAGE_WORKER_MAX_RANGE_BYTES,
        maxJournalAppendBytes:
          STUDIO_STORAGE_WORKER_MAX_JOURNAL_APPEND_BYTES,
        maxJournalBytes: STUDIO_STORAGE_WORKER_MAX_JOURNAL_BYTES,
        maxSessionWriteBytes:
          STUDIO_STORAGE_WORKER_MAX_SESSION_WRITE_BYTES,
        maxLogicalBytes: STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES,
        defaultShardBytes:
          STUDIO_LARGE_DOCUMENT_DEFAULT_SHARD_BYTES,
      },
    });
  }

  async #handleOpen(
    request: Extract<
      StudioStorageWorkerRequest,
      { readonly type: "studio-storage/open" }
    >,
  ): Promise<void> {
    if (
      this.#documentStore !== null
      || this.#journalStore !== null
      || this.#session !== null
    ) {
      this.#postError({
        request,
        code: "ALREADY_OPEN",
        message: "먼저 현재 Storage Worker 세션을 닫아야 합니다.",
        recoverable: true,
      });
      return;
    }
    if (request.session.sessionEpoch <= this.#lastSessionEpoch) {
      this.#postError({
        request,
        code: "STALE_EPOCH",
        message: "새 세션 epoch는 이전 세션보다 커야 합니다.",
        recoverable: true,
      });
      return;
    }

    let documentStore: StudioOpfsSyncAccessStore | null = null;
    let journalStore: StudioOpfsSyncAccessStore | null = null;
    try {
      documentStore = await this.#createStore({
        documentId: request.session.documentId,
        shardBytes: request.session.shardBytes,
        role: "document",
        scope: this.#scope,
      });
      journalStore = await this.#createStore({
        documentId: request.session.documentId,
        shardBytes: request.session.shardBytes,
        role: "journal",
        scope: this.#scope,
      });
      if (journalStore === documentStore) {
        throw new Error(
          "Document data and journal must use disjoint storage handles",
        );
      }
    } catch (error) {
      const openedStores = new Set([journalStore, documentStore]);
      for (const openedStore of openedStores) {
        if (!openedStore) continue;
        try {
          await openedStore.close();
        } catch {
          // Open failed before the session became authoritative.
        }
      }
      this.#postError({
        request,
        code: "CAPABILITY_UNAVAILABLE",
        message: isStudioOpfsSyncAccessError(error)
          ? error.message
          : "OPFS sync-access 저장소를 열 수 없습니다.",
        recoverable: false,
      });
      return;
    }

    this.#documentStore = documentStore;
    this.#journalStore = journalStore;
    this.#lastSessionEpoch = request.session.sessionEpoch;
    this.#session = {
      config: request.session,
      sessionEpoch: request.session.sessionEpoch,
      revision: request.session.revision,
      dataByteLength: request.session.dataByteLength,
      journalByteLength: request.session.journalByteLength,
      sessionWrittenBytes: BigInt(0),
    };
    this.#post({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/opened",
      requestSequence: request.requestSequence,
      commandSequence: request.commandSequence,
      documentId: request.session.documentId,
      ...this.#state(this.#session),
    });
  }

  #validateSession(
    request: Exclude<
      StudioStorageWorkerRequest,
      | { readonly type: "studio-storage/capability" }
      | { readonly type: "studio-storage/open" }
    >,
  ): ActiveSession | null {
    const session = this.#session;
    if (!session || !this.#documentStore || !this.#journalStore) {
      this.#postError({
        request,
        code: "NOT_OPEN",
        message: "Storage Worker 문서 세션이 열려 있지 않습니다.",
        recoverable: true,
      });
      return null;
    }
    if (request.sessionEpoch !== session.sessionEpoch) {
      this.#postError({
        request,
        code: "STALE_EPOCH",
        message: "요청의 세션 epoch가 현재 문서와 다릅니다.",
        recoverable: true,
      });
      return null;
    }
    if (request.expectedRevision !== session.revision) {
      this.#postError({
        request,
        code: "STALE_REVISION",
        message: "요청의 문서 revision이 현재 상태와 다릅니다.",
        recoverable: true,
      });
      return null;
    }
    return session;
  }

  #state(session: ActiveSession): StudioStorageWorkerSessionState {
    return {
      sessionEpoch: session.sessionEpoch,
      revision: session.revision,
      dataByteLength: session.dataByteLength,
      journalByteLength: session.journalByteLength,
      sessionWrittenBytes: session.sessionWrittenBytes,
    };
  }

  #replaceSession(
    session: ActiveSession,
    changes: Partial<
      Pick<
        ActiveSession,
        | "revision"
        | "dataByteLength"
        | "journalByteLength"
        | "sessionWrittenBytes"
      >
    >,
  ): ActiveSession {
    const next = { ...session, ...changes };
    this.#session = next;
    return next;
  }

  #checkWriteBudget(
    request: StudioStorageWorkerRequest,
    session: ActiveSession,
    globalByteOffset: bigint,
    byteLength: number,
    maximumBytes: bigint,
    label: "문서" | "저널",
  ): boolean {
    const end = globalByteOffset + BigInt(byteLength);
    if (end > maximumBytes) {
      this.#postError({
        request,
        code: "BUDGET_EXCEEDED",
        message: `쓰기 범위가 이 세션의 최대 ${label} 크기를 넘습니다.`,
        recoverable: true,
      });
      return false;
    }
    if (
      session.sessionWrittenBytes + BigInt(byteLength)
      > session.config.maxSessionWriteBytes
    ) {
      this.#postError({
        request,
        code: "BUDGET_EXCEEDED",
        message: "이 세션의 누적 쓰기 바이트 예산을 초과했습니다.",
        recoverable: true,
      });
      return false;
    }
    return true;
  }

  async #handleRead(
    request: Extract<
      StudioStorageWorkerRequest,
      { readonly type: "studio-storage/read" }
    >,
    session: ActiveSession,
  ): Promise<void> {
    const end = request.globalByteOffset + BigInt(request.byteLength);
    const readableByteLength = request.source === "document"
      ? session.dataByteLength
      : session.journalByteLength;
    if (end > readableByteLength) {
      this.#postError({
        request,
        code: "BUDGET_EXCEEDED",
        message: `읽기 범위가 현재 ${request.source} 크기를 넘습니다.`,
        recoverable: true,
      });
      return;
    }
    const store = request.source === "document"
      ? this.#documentStore
      : this.#journalStore;
    const bytes = await (store as StudioOpfsSyncAccessStore).read(
      request.globalByteOffset,
      request.byteLength,
    );
    if (bytes.byteLength !== request.byteLength) {
      throw new Error("Storage store returned a mismatched read length");
    }
    this.#post({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/read-result",
      requestSequence: request.requestSequence,
      sessionEpoch: session.sessionEpoch,
      revision: session.revision,
      source: request.source,
      globalByteOffset: request.globalByteOffset,
      data: exactArrayBuffer(bytes),
    });
  }

  async #handleWrite(
    request: Extract<
      StudioStorageWorkerRequest,
      { readonly type: "studio-storage/write" }
    >,
    session: ActiveSession,
  ): Promise<void> {
    if (
      !this.#checkWriteBudget(
        request,
        session,
        request.globalByteOffset,
        request.data.byteLength,
        session.config.maxDocumentBytes,
        "문서",
      )
    ) {
      return;
    }
    await (this.#documentStore as StudioOpfsSyncAccessStore).write(
      request.globalByteOffset,
      new Uint8Array(request.data),
    );
    const next = this.#replaceSession(session, {
      revision: session.revision + 1,
      dataByteLength: maximum(
        session.dataByteLength,
        request.globalByteOffset + BigInt(request.data.byteLength),
      ),
      sessionWrittenBytes:
        session.sessionWrittenBytes + BigInt(request.data.byteLength),
    });
    this.#postCommandResult(request, next);
  }

  async #handleAppendJournal(
    request: Extract<
      StudioStorageWorkerRequest,
      { readonly type: "studio-storage/append-journal" }
    >,
    session: ActiveSession,
  ): Promise<void> {
    if (
      !this.#checkWriteBudget(
        request,
        session,
        session.journalByteLength,
        request.data.byteLength,
        session.config.maxJournalBytes,
        "저널",
      )
    ) {
      return;
    }
    await (this.#journalStore as StudioOpfsSyncAccessStore).write(
      session.journalByteLength,
      new Uint8Array(request.data),
    );
    const journalByteLength =
      session.journalByteLength + BigInt(request.data.byteLength);
    const next = this.#replaceSession(session, {
      revision: session.revision + 1,
      journalByteLength,
      sessionWrittenBytes:
        session.sessionWrittenBytes + BigInt(request.data.byteLength),
    });
    this.#postCommandResult(request, next);
  }

  async #handleFlush(
    request: Extract<
      StudioStorageWorkerRequest,
      { readonly type: "studio-storage/flush" }
    >,
    session: ActiveSession,
  ): Promise<void> {
    // WAL durability order: journal must reach disk before document data.
    await (this.#journalStore as StudioOpfsSyncAccessStore).flush();
    await (this.#documentStore as StudioOpfsSyncAccessStore).flush();
    this.#postCommandResult(request, session);
  }

  async #handleTruncate(
    request: Extract<
      StudioStorageWorkerRequest,
      { readonly type: "studio-storage/truncate" }
    >,
    session: ActiveSession,
  ): Promise<void> {
    const maximumBytes = request.target === "document"
      ? session.config.maxDocumentBytes
      : session.config.maxJournalBytes;
    if (request.byteLength > maximumBytes) {
      this.#postError({
        request,
        code: "BUDGET_EXCEEDED",
        message: "truncate 크기가 이 세션의 최대 문서 크기를 넘습니다.",
        recoverable: true,
      });
      return;
    }
    const store = request.target === "document"
      ? this.#documentStore
      : this.#journalStore;
    await (store as StudioOpfsSyncAccessStore).truncate(
      request.byteLength,
    );
    const next = this.#replaceSession(session, {
      revision: session.revision + 1,
      ...(request.target === "document"
        ? { dataByteLength: request.byteLength }
        : { journalByteLength: request.byteLength }),
    });
    this.#postCommandResult(request, next);
  }

  async #handleCheckpoint(
    request: Extract<
      StudioStorageWorkerRequest,
      { readonly type: "studio-storage/checkpoint-barrier" }
    >,
    session: ActiveSession,
  ): Promise<void> {
    // A checkpoint is acknowledged only after WAL then document durability.
    await (this.#journalStore as StudioOpfsSyncAccessStore).flush();
    await (this.#documentStore as StudioOpfsSyncAccessStore).flush();
    this.#post({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/checkpointed",
      requestSequence: request.requestSequence,
      commandSequence: request.commandSequence,
      checkpointId: request.checkpointId,
      ...this.#state(session),
    });
  }

  async #handleClose(
    request: Extract<
      StudioStorageWorkerRequest,
      { readonly type: "studio-storage/close" }
    >,
    session: ActiveSession,
  ): Promise<void> {
    const journalStore = this.#journalStore as StudioOpfsSyncAccessStore;
    const documentStore = this.#documentStore as StudioOpfsSyncAccessStore;
    let firstError: unknown;
    try {
      await journalStore.flush();
    } catch (error) {
      firstError = error;
    }
    try {
      await documentStore.flush();
    } catch (error) {
      firstError ??= error;
    }
    try {
      await journalStore.close();
    } catch (error) {
      firstError ??= error;
    }
    try {
      await documentStore.close();
    } catch (error) {
      firstError ??= error;
    } finally {
      this.#journalStore = null;
      this.#documentStore = null;
      this.#session = null;
    }
    if (firstError) throw firstError;
    this.#postCommandResult(request, session);
  }

  #postCommandResult(
    request: Exclude<
      StudioStorageWorkerCommandRequest,
      {
        readonly type:
          | "studio-storage/open"
          | "studio-storage/checkpoint-barrier";
      }
    >,
    session: ActiveSession,
  ): void {
    this.#post({
      version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
      type: "studio-storage/command-result",
      requestSequence: request.requestSequence,
      commandSequence: request.commandSequence,
      operation: commandOperation(request),
      ...this.#state(session),
    });
  }

  async #failClosed(
    request: StudioStorageWorkerRequest | null,
    error: unknown,
  ): Promise<void> {
    if (!this.#poisoned) {
      this.#poisoned = true;
      await this.#closeStoresBestEffort();
      this.#session = null;
    }
    this.#postError({
      request,
      code: isStudioOpfsSyncAccessError(error)
        ? "STORAGE_FAILED"
        : "INTERNAL",
      message: isStudioOpfsSyncAccessError(error)
        ? error.message
        : "Storage Worker 내부 오류로 저장 경로를 안전하게 닫았습니다.",
      recoverable: false,
    });
  }

  async #closeStoresBestEffort(): Promise<void> {
    const stores = [this.#journalStore, this.#documentStore];
    this.#journalStore = null;
    this.#documentStore = null;
    for (const store of stores) {
      if (!store) continue;
      try {
        await store.close();
      } catch {
        // The Worker is already moving to fail-closed/disposed state.
      }
    }
  }
}

export function createStudioStorageWorkerRuntime(
  options: StudioStorageWorkerRuntimeOptions,
): StudioStorageWorkerRuntime {
  return new StudioStorageWorkerRuntimeImpl(options);
}

function isNativeDedicatedWorkerScope(
  value: unknown,
): value is StudioStorageWorkerScope {
  return typeof value === "object"
    && value !== null
    && Object.prototype.toString.call(value)
      === "[object DedicatedWorkerGlobalScope]"
    && "postMessage" in value
    && typeof (value as { readonly postMessage?: unknown }).postMessage
      === "function";
}

if (isNativeDedicatedWorkerScope(globalThis)) {
  createStudioStorageWorkerRuntime({ scope: globalThis });
}
