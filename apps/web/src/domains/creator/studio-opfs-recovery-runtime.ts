import {
  decideStudioOpfsRecoveryBackend,
  type StudioOpfsRecoveryAppendInput,
  type StudioOpfsRecoveryBackendDecision,
  type StudioOpfsRecoveryCheckpointInput,
  type StudioOpfsRecoveryEntry,
  type StudioOpfsRecoveryEvictionResult,
  type StudioOpfsRecoveryJournal,
  type StudioOpfsRecoveryMutationOptions,
  type StudioOpfsRecoveryScan,
  type StudioOpfsRecoveryWriterLease,
} from "./studio-opfs-recovery-journal";

const DEFAULT_MAX_PENDING_OPERATIONS = 32;
const MAX_PENDING_OPERATIONS = 256;

export type StudioOpfsRecoveryRuntimeErrorCode =
  | "ABORTED"
  | "BACKEND_UNAVAILABLE"
  | "INVALID_ARGUMENT"
  | "PENDING_LIMIT_EXCEEDED"
  | "WRITER_ALREADY_HELD"
  | "WRITER_REQUIRED"
  | "WRITER_TRANSITION";

export class StudioOpfsRecoveryRuntimeError extends Error {
  readonly code: StudioOpfsRecoveryRuntimeErrorCode;
  override readonly cause?: unknown;

  constructor(
    code: StudioOpfsRecoveryRuntimeErrorCode,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message);
    this.name = "StudioOpfsRecoveryRuntimeError";
    this.code = code;
    this.cause = options.cause;
  }
}

export interface StudioOpfsRecoveryCapabilitySnapshot {
  readonly fileSystemKind: "opfs" | "memory" | "local-storage" | "unavailable";
  readonly originLockAvailable: boolean;
}

export type StudioOpfsRecoveryJournalRuntimePort = Pick<
  StudioOpfsRecoveryJournal,
  | "scan"
  | "acquireWriter"
  | "renewWriter"
  | "releaseWriter"
  | "appendOperation"
  | "appendCheckpoint"
  | "evictObsolete"
>;

export interface StudioCompatibleRecoveryVaultCallbacks {
  /**
   * The caller must set this only when the vault preserves the exact operation/checkpoint bytes,
   * document/engine identity, revision ordering, writer fencing, and corruption semantics exposed
   * by the OPFS journal port.
   */
  readonly compatible: boolean;
  scan(options?: StudioOpfsRecoveryMutationOptions): Promise<StudioOpfsRecoveryScan>;
  acquireWriter(input: {
    readonly ownerId: string;
    readonly signal?: AbortSignal;
  }): Promise<StudioOpfsRecoveryWriterLease>;
  renewWriter(
    writer: StudioOpfsRecoveryWriterLease,
    options?: StudioOpfsRecoveryMutationOptions,
  ): Promise<StudioOpfsRecoveryWriterLease>;
  releaseWriter(
    writer: StudioOpfsRecoveryWriterLease,
    options?: StudioOpfsRecoveryMutationOptions,
  ): Promise<void>;
  appendOperation(
    writer: StudioOpfsRecoveryWriterLease,
    input: StudioOpfsRecoveryAppendInput,
    options?: StudioOpfsRecoveryMutationOptions,
  ): Promise<StudioOpfsRecoveryEntry>;
  appendCheckpoint(
    writer: StudioOpfsRecoveryWriterLease,
    input: StudioOpfsRecoveryCheckpointInput,
    options?: StudioOpfsRecoveryMutationOptions,
  ): Promise<StudioOpfsRecoveryEntry>;
  compact(
    writer: StudioOpfsRecoveryWriterLease,
    input: StudioOpfsRecoveryCheckpointInput,
    options?: StudioOpfsRecoveryMutationOptions,
  ): Promise<StudioOpfsRecoveryEntry>;
  cleanupQuota(
    writer: StudioOpfsRecoveryWriterLease,
    options?: StudioOpfsRecoveryMutationOptions,
  ): Promise<StudioOpfsRecoveryEvictionResult>;
  flush(options?: StudioOpfsRecoveryMutationOptions): Promise<void>;
}

export interface StudioOpfsRecoveryPageHideTarget {
  addEventListener(type: "pagehide", listener: (event: Event) => void): void;
  removeEventListener(type: "pagehide", listener: (event: Event) => void): void;
}

export interface StudioOpfsRecoveryRuntimeOptions {
  readonly probeCapabilities: (
    signal?: AbortSignal,
  ) =>
    | StudioOpfsRecoveryCapabilitySnapshot
    | Promise<StudioOpfsRecoveryCapabilitySnapshot>;
  readonly createOpfsJournal: (
    capabilities: StudioOpfsRecoveryCapabilitySnapshot,
    signal?: AbortSignal,
  ) =>
    | StudioOpfsRecoveryJournalRuntimePort
    | Promise<StudioOpfsRecoveryJournalRuntimePort>;
  readonly flushOpfsJournal?: (
    journal: StudioOpfsRecoveryJournalRuntimePort,
    options?: StudioOpfsRecoveryMutationOptions,
  ) => Promise<void>;
  readonly existingRecoveryVault?: StudioCompatibleRecoveryVaultCallbacks | null;
  readonly maxPendingOperations?: number;
  readonly signal?: AbortSignal;
}

export interface StudioOpfsRecoveryRuntimeWriterStatus {
  readonly ownerId: string;
  readonly epoch: number;
  readonly acquiredAt: number;
  readonly expiresAt: number;
}

export interface StudioOpfsRecoveryRuntimeStatus {
  readonly backend: StudioOpfsRecoveryBackendDecision["mode"];
  readonly durable: boolean;
  readonly reason: StudioOpfsRecoveryBackendDecision["reason"];
  readonly state: "ready" | "fail-closed" | "aborted";
  readonly writer: StudioOpfsRecoveryRuntimeWriterStatus | null;
  readonly writerTransitionPending: boolean;
  readonly pendingOperations: number;
  readonly abortReason: string | null;
}

interface OpfsBackend {
  readonly mode: "opfs-journal";
  readonly journal: StudioOpfsRecoveryJournalRuntimePort;
  readonly flush?: StudioOpfsRecoveryRuntimeOptions["flushOpfsJournal"];
}

interface VaultBackend {
  readonly mode: "existing-recovery-vault";
  readonly vault: StudioCompatibleRecoveryVaultCallbacks;
}

interface UnavailableBackend {
  readonly mode: "fail-closed";
}

type RuntimeBackend = OpfsBackend | VaultBackend | UnavailableBackend;

interface CombinedSignal {
  readonly signal: AbortSignal;
  dispose(): void;
}

function runtimeError(
  code: StudioOpfsRecoveryRuntimeErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new StudioOpfsRecoveryRuntimeError(code, message, { cause });
}

function throwIfSignalAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  runtimeError("ABORTED", "Studio 복구 런타임 작업이 중단되었습니다.", signal.reason);
}

function combineSignals(primary: AbortSignal, secondary?: AbortSignal): CombinedSignal {
  if (!secondary || secondary === primary) {
    return { signal: primary, dispose: () => undefined };
  }
  const controller = new AbortController();
  const forwardPrimary = () => controller.abort(primary.reason);
  const forwardSecondary = () => controller.abort(secondary.reason);
  if (primary.aborted) forwardPrimary();
  else if (secondary.aborted) forwardSecondary();
  else {
    primary.addEventListener("abort", forwardPrimary, { once: true });
    secondary.addEventListener("abort", forwardSecondary, { once: true });
  }
  return {
    signal: controller.signal,
    dispose() {
      primary.removeEventListener("abort", forwardPrimary);
      secondary.removeEventListener("abort", forwardSecondary);
    },
  };
}

function normalizeMaxPending(value: number | undefined): number {
  const resolved = value ?? DEFAULT_MAX_PENDING_OPERATIONS;
  if (
    !Number.isSafeInteger(resolved)
    || resolved < 1
    || resolved > MAX_PENDING_OPERATIONS
  ) {
    runtimeError(
      "INVALID_ARGUMENT",
      `maxPendingOperations는 1 이상 ${MAX_PENDING_OPERATIONS} 이하의 정수여야 합니다.`,
    );
  }
  return resolved;
}

function abortReasonMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message.length > 0) return reason.message;
  if (typeof reason === "string" && reason.length > 0) return reason;
  return "aborted";
}

function frozenWriterStatus(
  writer: StudioOpfsRecoveryWriterLease | null,
): StudioOpfsRecoveryRuntimeWriterStatus | null {
  if (!writer) return null;
  return Object.freeze({
    ownerId: writer.ownerId,
    epoch: writer.epoch,
    acquiredAt: writer.acquiredAt,
    expiresAt: writer.expiresAt,
  });
}

/**
 * One-document durable recovery coordinator.
 *
 * Backend selection is immutable. An OPFS selection never retries through the vault after a
 * factory, scan, append, corruption, quota, or lease failure. Likewise a vault selection never
 * probes or writes OPFS. This is the seam that prevents duplicated commands and divergent replay.
 */
export class StudioOpfsRecoveryRuntime {
  readonly #decision: StudioOpfsRecoveryBackendDecision;
  readonly #backend: RuntimeBackend;
  readonly #maxPendingOperations: number;
  readonly #abortController = new AbortController();
  readonly #pending = new Set<Promise<unknown>>();
  #writer: StudioOpfsRecoveryWriterLease | null = null;
  #writerTransitionPending = false;
  #abortReason: string | null = null;
  #abortPromise: Promise<void> | null = null;

  constructor(input: {
    readonly decision: StudioOpfsRecoveryBackendDecision;
    readonly backend: RuntimeBackend;
    readonly maxPendingOperations: number;
  }) {
    this.#decision = input.decision;
    this.#backend = input.backend;
    this.#maxPendingOperations = input.maxPendingOperations;
  }

  status(): StudioOpfsRecoveryRuntimeStatus {
    const state = this.#abortController.signal.aborted
      ? "aborted"
      : this.#backend.mode === "fail-closed"
        ? "fail-closed"
        : "ready";
    return Object.freeze({
      backend: this.#decision.mode,
      durable: this.#decision.durable,
      reason: this.#decision.reason,
      state,
      writer: frozenWriterStatus(this.#writer),
      writerTransitionPending: this.#writerTransitionPending,
      pendingOperations: this.#pending.size,
      abortReason: this.#abortReason,
    });
  }

  #assertReady(): Exclude<RuntimeBackend, UnavailableBackend> {
    if (this.#abortController.signal.aborted) {
      runtimeError(
        "ABORTED",
        "Studio 복구 런타임이 이미 중단되어 새 작업을 시작할 수 없습니다.",
        this.#abortController.signal.reason,
      );
    }
    if (this.#backend.mode === "fail-closed") {
      runtimeError(
        "BACKEND_UNAVAILABLE",
        `내구성 복구 백엔드를 선택하지 못했습니다: ${this.#decision.reason}`,
      );
    }
    return this.#backend;
  }

  #requireWriter(): StudioOpfsRecoveryWriterLease {
    const writer = this.#writer;
    if (!writer) {
      runtimeError(
        "WRITER_REQUIRED",
        "명령이나 checkpoint를 기록하려면 먼저 단일 writer lease를 획득해야 합니다.",
      );
    }
    return writer;
  }

  #track<T>(
    operation: (backend: Exclude<RuntimeBackend, UnavailableBackend>, signal: AbortSignal) =>
      Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const backend = this.#assertReady();
    throwIfSignalAborted(signal);
    if (this.#pending.size >= this.#maxPendingOperations) {
      runtimeError(
        "PENDING_LIMIT_EXCEEDED",
        "복구 저널의 대기 작업 한도에 도달했습니다. flush 후 다시 시도하세요.",
      );
    }
    const combined = combineSignals(this.#abortController.signal, signal);
    const tracked = Promise.resolve()
      .then(() => operation(backend, combined.signal))
      .catch((error: unknown) => {
        if (combined.signal.aborted) {
          runtimeError(
            "ABORTED",
            "Studio 복구 런타임 작업이 중단되었습니다.",
            error,
          );
        }
        throw error;
      })
      .finally(() => {
        combined.dispose();
        this.#pending.delete(tracked);
      });
    this.#pending.add(tracked);
    return tracked;
  }

  async scanLatest(
    options: StudioOpfsRecoveryMutationOptions = {},
  ): Promise<StudioOpfsRecoveryScan> {
    return this.#track((backend, signal) => (
      backend.mode === "opfs-journal"
        ? backend.journal.scan({ signal })
        : backend.vault.scan({ signal })
    ), options.signal);
  }

  async acquireWriter(input: {
    readonly ownerId: string;
    readonly signal?: AbortSignal;
  }): Promise<StudioOpfsRecoveryWriterLease> {
    this.#assertReady();
    if (this.#writer) {
      // The owner id is an `autosave-<uuid>` machine string — it belongs in the cause for logs
      // and bug reports, never in the sentence a banner might surface (same audience split the
      // journal's LEASE_BUSY message already follows).
      runtimeError(
        "WRITER_ALREADY_HELD",
        "이 탭이 이미 복구 저장소의 writer lease를 보유하고 있습니다.",
        { heldOwnerId: this.#writer.ownerId, requestedOwnerId: input.ownerId },
      );
    }
    if (this.#writerTransitionPending) {
      runtimeError("WRITER_TRANSITION", "다른 writer lease 전환 작업이 진행 중입니다.");
    }
    this.#writerTransitionPending = true;
    try {
      const writer = await this.#track((backend, signal) => (
        backend.mode === "opfs-journal"
          ? backend.journal.acquireWriter({ ownerId: input.ownerId, signal })
          : backend.vault.acquireWriter({ ownerId: input.ownerId, signal })
      ), input.signal);
      if (this.#abortController.signal.aborted) {
        runtimeError(
          "ABORTED",
          "writer lease 획득 중 Studio 복구 런타임이 중단되었습니다.",
        );
      }
      this.#writer = writer;
      return writer;
    } finally {
      this.#writerTransitionPending = false;
    }
  }

  async renewWriter(
    options: StudioOpfsRecoveryMutationOptions = {},
  ): Promise<StudioOpfsRecoveryWriterLease> {
    this.#assertReady();
    if (this.#writerTransitionPending) {
      runtimeError("WRITER_TRANSITION", "다른 writer lease 전환 작업이 진행 중입니다.");
    }
    const writer = this.#requireWriter();
    this.#writerTransitionPending = true;
    try {
      const renewed = await this.#track((backend, signal) => (
        backend.mode === "opfs-journal"
          ? backend.journal.renewWriter(writer, { signal })
          : backend.vault.renewWriter(writer, { signal })
      ), options.signal);
      if (this.#writer === writer) this.#writer = renewed;
      return renewed;
    } finally {
      this.#writerTransitionPending = false;
    }
  }

  async releaseWriter(options: StudioOpfsRecoveryMutationOptions = {}): Promise<void> {
    this.#assertReady();
    if (this.#writerTransitionPending) {
      runtimeError("WRITER_TRANSITION", "다른 writer lease 전환 작업이 진행 중입니다.");
    }
    const writer = this.#requireWriter();
    this.#writerTransitionPending = true;
    try {
      await this.flush(options);
      await this.#track((backend, signal) => (
        backend.mode === "opfs-journal"
          ? backend.journal.releaseWriter(writer, { signal })
          : backend.vault.releaseWriter(writer, { signal })
      ), options.signal);
      if (this.#writer === writer) this.#writer = null;
    } finally {
      this.#writerTransitionPending = false;
    }
  }

  async appendCommand(
    input: StudioOpfsRecoveryAppendInput,
    options: StudioOpfsRecoveryMutationOptions = {},
  ): Promise<StudioOpfsRecoveryEntry> {
    this.#assertReady();
    const writer = this.#requireWriter();
    return this.#track((backend, signal) => (
      backend.mode === "opfs-journal"
        ? backend.journal.appendOperation(writer, input, { signal })
        : backend.vault.appendOperation(writer, input, { signal })
    ), options.signal);
  }

  async appendCheckpoint(
    input: StudioOpfsRecoveryCheckpointInput,
    options: StudioOpfsRecoveryMutationOptions = {},
  ): Promise<StudioOpfsRecoveryEntry> {
    this.#assertReady();
    const writer = this.#requireWriter();
    return this.#track((backend, signal) => (
      backend.mode === "opfs-journal"
        ? backend.journal.appendCheckpoint(writer, input, { signal })
        : backend.vault.appendCheckpoint(writer, input, { signal })
    ), options.signal);
  }

  async compact(
    checkpoint: StudioOpfsRecoveryCheckpointInput,
    options: StudioOpfsRecoveryMutationOptions = {},
  ): Promise<StudioOpfsRecoveryEntry> {
    this.#assertReady();
    const writer = this.#requireWriter();
    return this.#track((backend, signal) => (
      backend.mode === "opfs-journal"
        ? backend.journal.appendCheckpoint(writer, checkpoint, { signal })
        : backend.vault.compact(writer, checkpoint, { signal })
    ), options.signal);
  }

  async cleanupQuota(
    options: StudioOpfsRecoveryMutationOptions = {},
  ): Promise<StudioOpfsRecoveryEvictionResult> {
    this.#assertReady();
    const writer = this.#requireWriter();
    return this.#track((backend, signal) => (
      backend.mode === "opfs-journal"
        ? backend.journal.evictObsolete(writer, { signal })
        : backend.vault.cleanupQuota(writer, { signal })
    ), options.signal);
  }

  async flush(options: StudioOpfsRecoveryMutationOptions = {}): Promise<void> {
    const backend = this.#assertReady();
    throwIfSignalAborted(options.signal);
    const combined = combineSignals(this.#abortController.signal, options.signal);
    try {
      const barrier = [...this.#pending];
      if (barrier.length > 0) {
        const settled = await Promise.allSettled(barrier);
        const failed = settled.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (failed) throw failed.reason;
      }
      throwIfSignalAborted(combined.signal);
      if (backend.mode === "opfs-journal") {
        await backend.flush?.(backend.journal, { signal: combined.signal });
      } else {
        await backend.vault.flush({ signal: combined.signal });
      }
      throwIfSignalAborted(combined.signal);
    } finally {
      combined.dispose();
    }
  }

  installPageHideFlush(
    target: StudioOpfsRecoveryPageHideTarget,
    onError: (error: unknown) => void = () => undefined,
  ): () => void {
    let installed = true;
    const listener = () => {
      void this.flush().catch(onError);
    };
    target.addEventListener("pagehide", listener);
    return () => {
      if (!installed) return;
      installed = false;
      target.removeEventListener("pagehide", listener);
    };
  }

  abort(reason: unknown = "runtime-abort"): Promise<void> {
    if (this.#abortPromise) return this.#abortPromise;
    const writer = this.#writer;
    this.#writer = null;
    this.#abortReason = abortReasonMessage(reason);
    this.#abortController.abort(reason);
    this.#abortPromise = (async () => {
      await Promise.allSettled([...this.#pending]);
      if (!writer || this.#backend.mode === "fail-closed") return;
      if (this.#backend.mode === "opfs-journal") {
        await this.#backend.journal.releaseWriter(writer);
      } else {
        await this.#backend.vault.releaseWriter(writer);
      }
    })();
    return this.#abortPromise;
  }
}

export async function createStudioOpfsRecoveryRuntime(
  options: StudioOpfsRecoveryRuntimeOptions,
): Promise<StudioOpfsRecoveryRuntime> {
  throwIfSignalAborted(options.signal);
  const capabilities = await options.probeCapabilities(options.signal);
  throwIfSignalAborted(options.signal);
  const vault = options.existingRecoveryVault ?? null;
  const decision = decideStudioOpfsRecoveryBackend({
    ...capabilities,
    existingRecoveryVaultCompatible: vault?.compatible === true,
  });
  const maxPendingOperations = normalizeMaxPending(options.maxPendingOperations);
  if (decision.mode === "opfs-journal") {
    const journal = await options.createOpfsJournal(capabilities, options.signal);
    throwIfSignalAborted(options.signal);
    return new StudioOpfsRecoveryRuntime({
      decision,
      backend: {
        mode: "opfs-journal",
        journal,
        ...(options.flushOpfsJournal ? { flush: options.flushOpfsJournal } : {}),
      },
      maxPendingOperations,
    });
  }
  if (decision.mode === "existing-recovery-vault" && vault) {
    return new StudioOpfsRecoveryRuntime({
      decision,
      backend: { mode: "existing-recovery-vault", vault },
      maxPendingOperations,
    });
  }
  return new StudioOpfsRecoveryRuntime({
    decision,
    backend: { mode: "fail-closed" },
    maxPendingOperations,
  });
}
