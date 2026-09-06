import {
  classifyStudioCrdtFailure,
  type StudioCrdtFailureClassification,
} from "./studio-crdt-operation-error";
import {
  createStudioCrdtOutbox,
  type StudioCrdtOutbox,
} from "./studio-crdt-outbox";
import {
  STUDIO_CRDT_ORIGIN_REMOTE,
  STUDIO_CRDT_ORIGIN_SYNC,
  STUDIO_CRDT_PROTOCOL_VERSION,
  decodeStudioCrdtStateVector,
  decodeStudioCrdtUpdate,
  encodeStudioCrdtStateVector,
  encodeStudioCrdtSyncChunks,
  encodeStudioCrdtUpdate,
  type StudioCrdtSyncRequest,
  type StudioCrdtUpdateAck,
  type StudioCrdtUpdateRequest,
} from "./studio-crdt-protocol";
import {
  createStudioCrdtRecoveryVault,
  type StudioCrdtPermanentRejectionMarker,
  type StudioCrdtRecoveryVault,
  type StudioCrdtRecoveryVaultEntry,
} from "./studio-crdt-recovery-vault";

import type {
  StudioCrdtBatchSubscription,
  StudioCrdtDocument,
} from "./studio-crdt-document";
import type {
  StudioLiveCrdtRoomEvent,
  StudioLiveRoom,
  StudioLiveRoomEvent,
} from "./studio-live-collaboration-room";

export type StudioCrdtBindingStatusPayload =
  | { state: "idle"; message: string }
  | { state: "syncing"; message: string }
  | { state: "ready"; message: string }
  | { state: "retrying"; message: string }
  | { state: "repairing"; message: string }
  | { state: "error"; message: string; durabilityAtRisk?: boolean }
  | {
      state: "recovery-required";
      message: string;
      code: string;
      updateId: string;
      recoveryUpdateCount: number;
      collaborativeEditsBlocked: true;
      retryable: false;
      recoveryVaultId?: string;
      recoveryExportAvailable: boolean;
      outboxCleanupAtRisk?: boolean;
    };

export interface StudioCrdtBindingTelemetry {
  /** Number of local Yjs update batches awaiting an authoritative acknowledgement or recovery. */
  pendingCount: number;
  /** Browser-durable recovery capability, independent from the authoritative server path. */
  persistenceDurability:
    | "checking"
    | "durable"
    | "degraded"
    | "unavailable"
    | "not-applicable";
  transportReady: boolean;
  /** Server mutation ACK only; BroadcastChannel and P2P receipts are never server ACKs. */
  lastAckAt: number | null;
  lastAckServerSequence: string | null;
}

export type StudioCrdtBindingStatus = StudioCrdtBindingStatusPayload &
  StudioCrdtBindingTelemetry;

export interface StudioCrdtRecoveryRequiredState {
  code: string;
  updateId: string;
  message: string;
  recoveryUpdateCount: number;
  outboxCleanupAtRisk: boolean;
  recoveryVaultId: string | null;
  recoveryExportAvailable: boolean;
}

export interface StudioCrdtAuthoritativeAckBarrierResult {
  /** PostgreSQL bigint decimal sequence observed by a sync started after the final pending drain. */
  serverSequence: string;
  acknowledgedAt: number | null;
}

export interface StudioCrdtRoomBindingOptions {
  document: StudioCrdtDocument;
  room: StudioLiveRoom;
  /** Viewers still receive the durable document, but never enqueue local mutations. */
  canEdit?: boolean;
  /** Stable authenticated-user scope for browser-durable unsent updates. */
  outboxScope?: string | null;
  outbox?: StudioCrdtOutbox;
  /** Durable non-retrying store for a server-rejected optimistic frontier. */
  recoveryVault?: StudioCrdtRecoveryVault;
  randomId?: () => string;
  onStatus?: (status: StudioCrdtBindingStatus) => void;
  /** Bounds a wedged SQLite/OPFS outbox call before the authoritative server fallback. */
  persistenceTimeoutMs?: number;
  setTimeout?: (handler: () => void, delay: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

interface PendingUpdate {
  request: StudioCrdtUpdateRequest;
  attempts: number;
  persistenceState: "pending" | "ready" | "failed";
  /** Resolves false on a surfaced durability failure; it never creates an unhandled rejection. */
  persisted: Promise<boolean>;
  /** Peer delivery happened, but no authoritative server ACK exists yet. */
  localBroadcasted?: boolean;
}

const EMPTY_UPDATE_BYTE_LENGTH = 2;
const RETRY_MIN_MS = 300;
const RETRY_MAX_MS = 5_000;
const BACKGROUND_SYNC_MS = 10_000;
const DEFAULT_PERSISTENCE_TIMEOUT_MS = 750;
const POSTGRES_BIGINT_MAX = BigInt("9223372036854775807");

function defaultRandomId(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("안전한 CRDT 업데이트 식별자를 만들 수 없습니다.");
  }
  return crypto.randomUUID();
}

function defaultSetTimeout(handler: () => void, delay: number): unknown {
  return globalThis.setTimeout(handler, delay);
}

function defaultClearTimeout(handle: unknown): void {
  globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

/**
 * Binds a Yjs document to the room's document channel, separate from ephemeral presence traffic.
 * Local mutations are merged for 40ms, acknowledged with stable update ids and retried in order;
 * state-vector sync repairs missed updates after reconnect before new edits continue publishing.
 */
export class StudioCrdtRoomBinding {
  private readonly document: StudioCrdtDocument;
  private readonly room: StudioLiveRoom;
  private readonly canEdit: boolean;
  private readonly outboxScope: string | null;
  private readonly outbox: StudioCrdtOutbox;
  private readonly recoveryVault: StudioCrdtRecoveryVault;
  private readonly randomId: () => string;
  private readonly onStatus?: (status: StudioCrdtBindingStatus) => void;
  private readonly persistenceTimeoutMs: number;
  private readonly scheduleTimeout: (handler: () => void, delay: number) => unknown;
  private readonly cancelTimeout: (handle: unknown) => void;
  private readonly pending = new Map<string, PendingUpdate>();
  private batchSubscription: StudioCrdtBatchSubscription | null = null;
  private unsubscribeCrdt: (() => void) | null = null;
  private unsubscribeRoom: (() => void) | null = null;
  private retryTimer: unknown = null;
  private syncRetryTimer: unknown = null;
  private backgroundSyncTimer: unknown = null;
  private drainPromise: Promise<void> | null = null;
  private syncPromise: Promise<void> | null = null;
  private resyncRequested = false;
  private activeSyncRequestId: string | null = null;
  private clientSequence = 0;
  private localServerSequence = 0;
  /**
   * Highest contiguous durable sequence proven to be present in this document. This is only
   * meaningful for the authenticated socket transport: BroadcastChannel/P2P peers each have
   * their own local counters and therefore cannot provide a room-wide ordering fence.
   */
  private authoritativeServerSequence: bigint | null = null;
  private durabilityWarning: string | null = null;
  private persistenceChecked = false;
  private lastAckAt: number | null = null;
  private lastAckServerSequence: string | null = null;
  private recoveryState: StudioCrdtRecoveryRequiredState | null = null;
  private recoveryTransition = false;
  private authoritativeSyncReady = false;
  private started = false;
  private closed = false;

  constructor(options: StudioCrdtRoomBindingOptions) {
    this.document = options.document;
    this.room = options.room;
    this.canEdit = options.canEdit ?? true;
    this.outboxScope = options.outboxScope?.trim() || null;
    this.outbox = options.outbox ?? createStudioCrdtOutbox();
    this.recoveryVault = options.recoveryVault ?? createStudioCrdtRecoveryVault();
    this.randomId = options.randomId ?? defaultRandomId;
    this.onStatus = options.onStatus;
    this.persistenceTimeoutMs = Math.max(
      100,
      Math.min(10_000, options.persistenceTimeoutMs ?? DEFAULT_PERSISTENCE_TIMEOUT_MS)
    );
    this.scheduleTimeout = options.setTimeout ?? defaultSetTimeout;
    this.cancelTimeout = options.clearTimeout ?? defaultClearTimeout;
  }

  async start(): Promise<void> {
    if (this.closed) throw new Error("이미 닫힌 CRDT 바인딩입니다.");
    if (this.started) return this.syncNow();
    if (!this.room.ready) throw new Error("실시간 작업실 연결이 준비되지 않았습니다.");
    this.started = true;
    this.authoritativeSyncReady = !this.hasAuthoritativeServer();
    if (this.canEdit && this.outboxScope) await this.restoreOutbox();
    if (this.closed) return;
    if (this.recoveryState) {
      this.emitRecoveryRequiredStatus();
      return;
    }
    this.unsubscribeCrdt = this.room.subscribeCrdt((event) => this.onCrdtEvent(event));
    this.unsubscribeRoom = this.room.subscribe((event) => this.onRoomEvent(event));
    if (this.canEdit) {
      this.batchSubscription = this.document.subscribeBatchedUpdates(({ update }) => {
        this.enqueueUpdate(update);
      });
    }
    await this.syncNow();
  }

  get recoveryRequired(): boolean {
    return this.recoveryState !== null;
  }

  getRecoveryRequiredState(): StudioCrdtRecoveryRequiredState | null {
    return this.recoveryState ? { ...this.recoveryState } : null;
  }

  syncNow(): Promise<void> {
    if (this.closed) return Promise.reject(new Error("이미 닫힌 CRDT 바인딩입니다."));
    if (this.recoveryState) {
      return Promise.reject(new Error(
        "서버 권위 원고를 다시 불러오기 전에는 CRDT 동기화를 재개할 수 없습니다."
      ));
    }
    if (this.syncPromise) return this.syncPromise;
    const run = this.synchronize().catch(async (error: unknown) => {
      const failure = classifyStudioCrdtFailure(error);
      if (failure.disposition === "permanent" && !this.closed && !this.recoveryState) {
        await this.enterRecoveryRequired(failure, null);
      }
      throw error;
    }).finally(() => {
      if (this.syncPromise === run) this.syncPromise = null;
      // A peer may open after this request was sent. Schedule the next snapshot only after
      // synchronize() finishes clearing its timers, so the ready notification cannot be lost.
      if (this.resyncRequested) {
        this.resyncRequested = false;
        this.scheduleSyncRetry();
      }
    });
    this.syncPromise = run;
    return run;
  }

  flush(): void {
    if (this.recoveryState) return;
    this.batchSubscription?.flush();
    void this.drainPending();
  }

  async flushAndWaitForAuthoritativeAck(
    timeoutMs = 2_000
  ): Promise<StudioCrdtAuthoritativeAckBarrierResult> {
    if (this.closed) throw new Error("이미 닫힌 CRDT 바인딩입니다.");
    if (!this.started) throw new Error("CRDT 바인딩이 아직 시작되지 않았습니다.");

    // Saving must include the final sub-frame stroke, not merely the updates that happened to
    // leave the 40 ms batch already. enqueueUpdate preserves the same stable IDs across retries.
    this.batchSubscription?.flush();
    const deadline = Date.now() + Math.max(100, Math.min(10_000, timeoutMs));

    while (true) {
      if (this.recoveryState) {
        throw new Error(this.recoveryState.message);
      }
      if (!this.hasAuthoritativeServer()) {
        throw new Error("로컬·P2P 협업 모드에서는 서버 승인 전 원고를 저장할 수 없습니다.");
      }
      if (!this.room.ready) {
        throw new Error("팀 서버 연결이 끊겨 미승인 변경을 저장할 수 없습니다.");
      }
      if (this.pending.size === 0) {
        // A background/reconnect sync may already be in flight when Save begins. Waiting for
        // that promise is necessary, but it is not a save fence: its state vector may have been
        // captured before the final local drain. Join it first, re-check pending work, and only
        // then initiate (or join) a sync whose request started after that drain.
        const preExistingSync = this.syncPromise;
        if (preExistingSync) {
          await this.completeBeforeDeadline(
            preExistingSync,
            deadline,
            "진행 중인 서버 원고 동기화를 기다리는 시간이 초과됐습니다."
          );
          continue;
        }
        await this.completeBeforeDeadline(
          this.syncNow(),
          deadline,
          "서버 원고의 최종 순번을 확인하는 시간이 초과됐습니다."
        );
        if (this.pending.size > 0) continue;
        const authoritativeServerSequence = this.authoritativeServerSequence;
        if (
          authoritativeServerSequence === null ||
          authoritativeServerSequence < BigInt(0) ||
          authoritativeServerSequence > POSTGRES_BIGINT_MAX
        ) {
          throw new Error("서버가 저장 경계에 필요한 CRDT 순번을 확인해 주지 않았습니다.");
        }
        return {
          serverSequence: authoritativeServerSequence.toString(),
          acknowledgedAt: this.lastAckAt,
        };
      }
      if (Date.now() >= deadline) {
        throw new Error("공동 편집 변경의 서버 승인을 기다리는 시간이 초과됐습니다.");
      }
      if (this.retryTimer !== null) {
        this.cancelTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      const drained = await this.settlesBeforeDeadline(this.drainPending(), deadline);
      if (!drained) {
        throw new Error("공동 편집 변경의 서버 승인을 기다리는 시간이 초과됐습니다.");
      }
      if (this.pending.size > 0 && !this.recoveryState) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) continue;
        await this.settlesBeforeDeadline(new Promise<void>((resolve) => {
          this.scheduleTimeout(resolve, Math.min(25, remaining));
        }), deadline);
      }
    }
  }

  async closeGracefully(timeoutMs = 750): Promise<void> {
    if (this.closed) return;
    this.batchSubscription?.flush();
    const deadline = Date.now() + Math.max(0, Math.min(2_000, timeoutMs));
    // The final sub-frame batch must reach SQLite/OPFS even when the socket is already offline.
    // A later binding's scoped outbox list is serialized behind this write, so a work switch
    // cannot overtake the pending commit and strand the user's final stroke.
    await this.persistPendingBeforeClose(deadline);
    while (
      this.pending.size > 0 &&
      this.hasAuthoritativeServer() &&
      this.room.ready &&
      Date.now() < deadline
    ) {
      if (this.retryTimer !== null) {
        this.cancelTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      const remainingBeforeDrain = deadline - Date.now();
      if (remainingBeforeDrain <= 0) break;
      const drainedBeforeDeadline = await this.settlesBeforeDeadline(
        this.drainPending(),
        deadline
      );
      if (!drainedBeforeDeadline) break;
      if (this.pending.size === 0) break;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise<void>((resolve) => {
        this.scheduleTimeout(resolve, Math.min(100, remaining));
      });
    }
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.batchSubscription?.flush();
    this.batchSubscription?.unsubscribe();
    this.batchSubscription = null;
    this.closed = true;
    this.resyncRequested = false;
    this.activeSyncRequestId = null;
    this.unsubscribeCrdt?.();
    this.unsubscribeCrdt = null;
    this.unsubscribeRoom?.();
    this.unsubscribeRoom = null;
    if (this.retryTimer !== null) this.cancelTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.syncRetryTimer !== null) this.cancelTimeout(this.syncRetryTimer);
    this.syncRetryTimer = null;
    if (this.backgroundSyncTimer !== null) this.cancelTimeout(this.backgroundSyncTimer);
    this.backgroundSyncTimer = null;
    this.pending.clear();
    this.authoritativeSyncReady = false;
    this.emitStatus({ state: "idle", message: "실시간 원고 동기화를 종료했습니다." });
  }

  private async synchronize(): Promise<void> {
    if (this.recoveryState) return;
    if (!this.room.ready) throw new Error("CRDT 동기화 채널이 준비되지 않았습니다.");
    this.emitStatus({ state: "syncing", message: "팀 원고의 누락된 획을 맞추는 중입니다." });
    const request: StudioCrdtSyncRequest = {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: this.room.workId,
      requestId: this.randomId(),
      stateVector: this.document.getStateVectorBase64(),
    };
    this.activeSyncRequestId = request.requestId;
    const response = await this.room.requestCrdtSync(request);
    if (this.closed || this.recoveryState) return;
    if (response) {
      this.document.applySyncResponse(response);
      this.advanceAuthoritativeSequenceAfterSync(response.serverSequence);
      if (this.hasAuthoritativeServer()) {
        // The authoritative response has been validated and applied. Only from this point may a
        // restored/local frontier publish; enqueueUpdate can start its drain synchronously.
        this.authoritativeSyncReady = true;
      }
      const serverVector = decodeStudioCrdtStateVector(response.serverStateVector);
      const localVector = this.document.encodeStateVector();
      // Pending operations already represent the client's unsent frontier. Adding a second
      // aggregate diff on reconnect would persist the same Yjs structs under a fresh updateId.
      if (this.canEdit && this.pending.size === 0 && !sameBytes(serverVector, localVector)) {
        const missingOnServer = this.document.encodeStateAsUpdate(serverVector);
        if (missingOnServer.byteLength > EMPTY_UPDATE_BYTE_LENGTH) this.enqueueUpdate(missingOnServer);
      }
    }
    if (this.hasAuthoritativeServer() && !response) {
      throw new Error("서버가 권위 CRDT 동기화 응답을 반환하지 않았습니다.");
    }
    if (this.syncRetryTimer !== null) this.cancelTimeout(this.syncRetryTimer);
    this.syncRetryTimer = null;
    if (this.backgroundSyncTimer !== null) this.cancelTimeout(this.backgroundSyncTimer);
    this.backgroundSyncTimer = null;
    this.scheduleBackgroundSync();
    this.emitStatus({ state: "ready", message: "팀 원고가 실시간으로 동기화됩니다." });
    await this.drainPending();
  }

  private enqueueUpdate(update: Uint8Array): void {
    if (this.closed || this.recoveryState || update.byteLength <= EMPTY_UPDATE_BYTE_LENGTH) return;
    let encoded: string;
    try {
      encoded = encodeStudioCrdtUpdate(update);
    } catch (error) {
      this.emitStatus({
        state: "error",
        message: messageFrom(error, "실시간 획 묶음이 전송 한도를 초과했습니다."),
      });
      return;
    }
    const updateId = this.randomId();
    const request: StudioCrdtUpdateRequest = {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: this.room.workId,
      updateId,
      clientSequence: ++this.clientSequence,
      update: encoded,
    };
    const pending: PendingUpdate = {
      request,
      attempts: 0,
      persistenceState: this.outboxScope ? "pending" : "ready",
      persisted: Promise.resolve(true),
    };
    this.pending.set(updateId, pending);
    this.emitStatus({
      state: this.room.ready ? "syncing" : "retrying",
      message: this.room.ready
        ? "새 원고 변경을 팀 서버에 보존하는 중입니다."
        : "서버가 다시 연결될 때까지 새 원고 변경을 복구 저장소에 보관합니다.",
    });
    if (this.outboxScope) this.beginPendingPersistence(pending);
    void this.drainPending();
  }

  private beginPendingPersistence(pending: PendingUpdate): Promise<boolean> {
    const scope = this.outboxScope;
    if (!scope) {
      pending.persistenceState = "ready";
      pending.persisted = Promise.resolve(true);
      return pending.persisted;
    }
    pending.persistenceState = "pending";
    const operation = Promise.resolve().then(() => this.outbox.put(scope, pending.request));
    const persisted = this.withPersistenceTimeout(operation).then(
      () => {
        if (pending.persisted === persisted) pending.persistenceState = "ready";
        this.persistenceChecked = true;
        this.captureOutboxStatus();
        if (!this.closed && !this.recoveryState) {
          this.emitStatus({
            state: this.room.ready ? "syncing" : "retrying",
            message: this.room.ready
              ? "로컬 복구 사본을 확인하고 팀 서버 승인을 기다립니다."
              : "서버 재연결까지 새 변경을 이 기기의 복구 저장소에 보관합니다.",
          });
        }
        return true;
      },
      (error: unknown) => {
        if (pending.persisted === persisted) pending.persistenceState = "failed";
        this.persistenceChecked = true;
        this.durabilityWarning = messageFrom(
          error,
          "오프라인 CRDT 보관함에 획을 저장하지 못했습니다."
        );
        if (!this.closed) {
          this.emitStatus({
            state: "error",
            message: messageFrom(error, "오프라인 CRDT 보관함에 획을 저장하지 못했습니다."),
            durabilityAtRisk: true,
          });
        }
        return false;
      }
    );
    pending.persisted = persisted;
    return persisted;
  }

  private withPersistenceTimeout(operation: Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeoutHandle: unknown = null;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle !== null) this.cancelTimeout(timeoutHandle);
        callback();
      };
      timeoutHandle = this.scheduleTimeout(
        () => finish(() => reject(new Error("오프라인 CRDT 보관함 응답 시간이 초과됐습니다."))),
        this.persistenceTimeoutMs
      );
      void operation.then(
        () => finish(resolve),
        (error: unknown) => finish(() => reject(error))
      );
    });
  }

  private ensurePendingPersistence(pending: PendingUpdate): Promise<boolean> {
    return pending.persistenceState === "failed"
      ? this.beginPendingPersistence(pending)
      : pending.persisted;
  }

  private async settlesBeforeDeadline(
    promise: Promise<unknown>,
    deadline: number
  ): Promise<boolean> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timeoutHandle: unknown = null;
      const finish = (completed: boolean) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle !== null) this.cancelTimeout(timeoutHandle);
        resolve(completed);
      };
      timeoutHandle = this.scheduleTimeout(() => finish(false), remaining);
      void promise.then(
        () => finish(true),
        () => finish(true)
      );
    });
  }

  private async completeBeforeDeadline<T>(
    promise: Promise<T>,
    deadline: number,
    timeoutMessage: string
  ): Promise<T> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(timeoutMessage);
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let timeoutHandle: unknown = null;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle !== null) this.cancelTimeout(timeoutHandle);
        callback();
      };
      timeoutHandle = this.scheduleTimeout(
        () => finish(() => reject(new Error(timeoutMessage))),
        remaining
      );
      void promise.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error))
      );
    });
  }

  private async persistPendingBeforeClose(deadline: number): Promise<void> {
    if (!this.outboxScope || this.pending.size === 0) return;
    for (let attempt = 0; attempt < 3 && Date.now() < deadline; attempt += 1) {
      const entries = [...this.pending.values()];
      const completed = await this.settlesBeforeDeadline(
        Promise.all(entries.map((pending) => this.ensurePendingPersistence(pending))),
        deadline
      );
      if (!completed) return;
      if (entries.every((pending) => pending.persistenceState === "ready")) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      const pause = new Promise<void>((resolve) => {
        this.scheduleTimeout(resolve, Math.min(50, remaining));
      });
      if (!(await this.settlesBeforeDeadline(pause, deadline))) return;
    }
  }

  private drainPending(): Promise<void> {
    if (this.closed || this.recoveryState || this.recoveryTransition || this.drainPromise) {
      return this.drainPromise ?? Promise.resolve();
    }
    const run = this.runDrain().finally(() => {
      if (this.drainPromise === run) this.drainPromise = null;
    });
    this.drainPromise = run;
    return run;
  }

  private async runDrain(): Promise<void> {
    if (this.recoveryState) return;
    if (this.hasAuthoritativeServer() && !this.authoritativeSyncReady) {
      for (const pending of this.pending.values()) {
        if (this.closed) return;
        await this.ensurePendingPersistence(pending);
      }
      return;
    }
    if (!this.room.ready) {
      for (const pending of this.pending.values()) {
        if (this.closed) return;
        const persisted = await this.ensurePendingPersistence(pending);
        if (!persisted) {
          pending.attempts += 1;
          this.scheduleRetry(pending.attempts);
          return;
        }
      }
      this.scheduleRetry();
      return;
    }
    for (const [updateId, pending] of this.pending) {
      if (this.closed) return;
      if (!this.hasAuthoritativeServer() && pending.localBroadcasted) continue;
      const persisted = await this.ensurePendingPersistence(pending);
      if (this.closed) return;
      if (!persisted) {
        // If the server is reachable it can still be the durable sink. We only remove the
        // same-page emergency copy after the authoritative ACK succeeds.
        this.emitStatus({
          state: "retrying",
          message: "로컬 보관함을 복구하는 동안 서버에 획을 직접 보존합니다.",
        });
      }
      try {
        const acknowledgement = await this.room.publishCrdtUpdate(pending.request);
        this.reconcileAuthoritativeAcknowledgement(acknowledgement);
        if (!this.hasAuthoritativeServer()) {
          // BroadcastChannel/P2P delivery is peer visibility, not durable authority. Keep the
          // exact request in both this backlog and the browser outbox for a future server ACK.
          pending.localBroadcasted = true;
          continue;
        }
        this.pending.delete(updateId);
        if (this.outboxScope) {
          void this.outbox
            .remove(this.outboxScope, pending.request.workId, updateId)
            .then(() => {
              this.captureOutboxStatus();
              if (!this.closed && !this.durabilityWarning) {
                this.emitStatus({
                  state: "ready",
                  message: "팀 원고와 로컬 복구 저장소가 동기화됩니다.",
                });
              }
            })
            .catch((error) => {
              this.emitStatus({
                state: "error",
                message: messageFrom(error, "전송 완료된 CRDT 보관 항목을 정리하지 못했습니다."),
              });
            });
        }
      } catch (error) {
        const classification = classifyStudioCrdtFailure(error);
        if (classification.disposition === "permanent") {
          await this.enterRecoveryRequired(classification, updateId);
          return;
        }
        pending.attempts += 1;
        await this.persistRetryMetadata(pending, classification);
        this.emitStatus({
          state: "retrying",
          message: messageFrom(error, "실시간 획 전송을 다시 시도합니다."),
        });
        this.scheduleRetry(pending.attempts);
        return;
      }
    }
    if (this.started && !this.closed) {
      if (!this.hasAuthoritativeServer() && this.pending.size > 0) {
        this.emitStatus({
          state: "retrying",
          message:
            "참여자에게 전달됐지만 팀 서버 승인은 아직 없습니다. 서버 재연결까지 이 기기의 복구 저장소에 보관합니다.",
        });
      } else {
        this.emitStatus({ state: "ready", message: "팀 원고가 실시간으로 동기화됩니다." });
      }
    }
  }

  private scheduleRetry(attempt = 1): void {
    if (this.closed || this.recoveryState || this.retryTimer !== null) return;
    const delay = this.retryDelay(attempt);
    this.retryTimer = this.scheduleTimeout(() => {
      this.retryTimer = null;
      void this.drainPending();
    }, delay);
  }

  private retryDelay(attempt: number): number {
    return Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** Math.min(5, attempt - 1));
  }

  private async persistRetryMetadata(
    pending: PendingUpdate,
    failure: StudioCrdtFailureClassification,
  ): Promise<void> {
    const scope = this.outboxScope;
    if (!scope || !this.outbox.recordRetry) return;
    const attemptedAt = Date.now();
    try {
      await this.withPersistenceTimeout(
        this.outbox.recordRetry(scope, pending.request.workId, pending.request.updateId, {
          attemptCount: pending.attempts,
          attemptedAt,
          nextRetryAt: attemptedAt + this.retryDelay(pending.attempts),
          errorCode: failure.code,
          errorMessage: failure.message,
        }),
      );
    } catch (error) {
      this.durabilityWarning = messageFrom(
        error,
        "CRDT 재시도 메타데이터를 로컬 SQLite 보관함에 기록하지 못했습니다.",
      );
      this.emitStatus({
        state: "error",
        message: this.durabilityWarning,
        durabilityAtRisk: true,
      });
    }
  }

  private scheduleSyncRetry(attempt = 1): void {
    if (this.closed || this.recoveryState || this.syncRetryTimer !== null) return;
    const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** Math.min(5, attempt - 1));
    this.syncRetryTimer = this.scheduleTimeout(() => {
      this.syncRetryTimer = null;
      if (this.closed) return;
      if (!this.room.ready) {
        this.scheduleSyncRetry(attempt + 1);
        return;
      }
      void this.syncNow().catch((error) => {
        this.emitStatus({
          state: "retrying",
          message: messageFrom(error, "재연결 후 원고를 다시 동기화하지 못했습니다."),
        });
        this.scheduleSyncRetry(attempt + 1);
      });
    }, delay);
  }

  private scheduleBackgroundSync(): void {
    if (this.closed || this.recoveryState || this.backgroundSyncTimer !== null) return;
    this.backgroundSyncTimer = this.scheduleTimeout(() => {
      this.backgroundSyncTimer = null;
      if (this.closed || !this.room.ready) return;
      void this.syncNow().catch((error) => {
        this.emitStatus({
          state: "retrying",
          message: messageFrom(error, "백그라운드 원고 수렴을 다시 시도합니다."),
        });
        this.scheduleSyncRetry();
      });
    }, BACKGROUND_SYNC_MS);
  }

  private onRoomEvent(event: StudioLiveRoomEvent): void {
    if (event.type !== "transport-status" || this.closed || this.recoveryState) return;
    if (
      this.hasAuthoritativeServer() &&
      (event.status.state === "connecting" ||
        event.status.state === "disconnected")
    ) {
      this.authoritativeSyncReady = false;
    }
    if (event.status.state !== "ready") return;
    if (!this.hasAuthoritativeServer()) {
      // A newly opened peer could not receive earlier local-only broadcasts.
      for (const pending of this.pending.values()) pending.localBroadcasted = false;
    }
    if (this.syncPromise) {
      this.resyncRequested = true;
      return;
    }
    void this.syncNow().catch((error) => {
      this.emitStatus({
        state: "retrying",
        message: messageFrom(error, "재연결 후 원고를 다시 동기화하지 못했습니다."),
      });
      this.scheduleSyncRetry();
    });
  }

  private onCrdtEvent(event: StudioLiveCrdtRoomEvent): void {
    if (this.closed || this.recoveryState) return;
    if (event.type === "update") {
      const sequenceState = this.classifyAuthoritativeSequence(event.update.serverSequence);
      if (sequenceState === "stale") return;
      try {
        this.document.applyUpdateBase64(event.update.update, STUDIO_CRDT_ORIGIN_REMOTE);
        if (sequenceState === "contiguous") {
          this.authoritativeServerSequence = BigInt(event.update.serverSequence);
        } else if (sequenceState === "gap") {
          this.requestAuthoritativeRepair(
            "실시간 전달 순서에 누락이 감지되어 서버 원고와 즉시 다시 맞춥니다."
          );
        }
      } catch (error) {
        this.emitStatus({
          state: "error",
          message: messageFrom(error, "팀원의 획 업데이트가 손상되어 적용하지 못했습니다."),
        });
      }
      return;
    }
    if (event.type === "sync-response") {
      // requestCrdtSync resolves this exact response. Socket transports may also emit it as a
      // notification, so applying here would process the same transfer twice.
      return;
    }
    if (event.type === "sync-request") {
      this.respondToPeerSync(event.request, event.senderSessionId);
      return;
    }
    if (event.type === "error") {
      this.emitStatus({ state: "retrying", message: event.message });
    }
  }

  /** Signaling can be server-backed while the document itself is peer-to-peer. Peer counters
   * are not a global ordering fence, and peer receipts do not prove durable server storage.
   * Undefined fanout preserves the legacy authoritative transport contract. */
  private hasAuthoritativeServer(): boolean {
    return this.room.mode === "server"
      && this.room.crdtFanout !== "mesh"
      && this.room.crdtFanout !== "none";
  }

  private classifyAuthoritativeSequence(
    sequence: string
  ): "untracked" | "stale" | "contiguous" | "gap" {
    if (!this.hasAuthoritativeServer() || this.authoritativeServerSequence === null) {
      return "untracked";
    }
    const candidate = BigInt(sequence);
    if (candidate <= this.authoritativeServerSequence) return "stale";
    return candidate === this.authoritativeServerSequence + BigInt(1)
      ? "contiguous"
      : "gap";
  }

  private advanceAuthoritativeSequenceAfterSync(sequence: string): void {
    if (!this.hasAuthoritativeServer()) return;
    const synchronized = BigInt(sequence);
    if (
      this.authoritativeServerSequence === null ||
      synchronized > this.authoritativeServerSequence
    ) {
      this.authoritativeServerSequence = synchronized;
    }
  }

  private reconcileAuthoritativeAcknowledgement(
    acknowledgement: StudioCrdtUpdateAck
  ): void {
    if (this.hasAuthoritativeServer()) {
      this.lastAckAt = Date.now();
      this.lastAckServerSequence = acknowledgement.serverSequence;
    }
    const sequenceState = this.classifyAuthoritativeSequence(
      acknowledgement.serverSequence
    );
    if (sequenceState === "contiguous") {
      // The acknowledged operation is already in the local Y.Doc because this client authored it.
      this.authoritativeServerSequence = BigInt(acknowledgement.serverSequence);
      return;
    }
    if (sequenceState === "gap") {
      // Another durable operation committed before this ACK but its realtime broadcast was lost.
      // Repair immediately instead of waiting for the periodic ten-second convergence pass.
      this.requestAuthoritativeRepair(
        "서버 승인 순번에서 누락된 팀 편집을 감지해 즉시 복구합니다."
      );
    }
  }

  private requestAuthoritativeRepair(message: string): void {
    if (this.closed || this.recoveryState || !this.hasAuthoritativeServer()) return;
    this.emitStatus({ state: "repairing", message });
    if (!this.room.ready || this.syncPromise) {
      this.scheduleSyncRetry();
      return;
    }
    void this.syncNow().catch((error) => {
      this.emitStatus({
        state: "retrying",
        message: messageFrom(error, "서버 원고의 누락된 편집을 복구하지 못했습니다."),
      });
      this.scheduleSyncRetry();
    });
  }

  private respondToPeerSync(request: StudioCrdtSyncRequest, senderSessionId: string): void {
    try {
      const diff = this.document.encodeStateAsUpdate(
        decodeStudioCrdtStateVector(request.stateVector)
      );
      const chunks = encodeStudioCrdtSyncChunks(diff);
      this.localServerSequence += 1;
      this.room.respondCrdtSync(
        {
          protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
          workId: this.room.workId,
          requestId: request.requestId,
          transferId: this.randomId(),
          chunks,
          chunkCount: chunks.length,
          totalBytes: diff.byteLength,
          serverStateVector: encodeStudioCrdtStateVector(this.document.encodeStateVector()),
          serverSequence: String(this.localServerSequence),
        },
        senderSessionId
      );
    } catch (error) {
      this.emitStatus({
        state: "error",
        message: messageFrom(error, "로컬 탭에 원고 상태를 전달하지 못했습니다."),
      });
    }
  }

  private async restoreOutbox(): Promise<void> {
    const scope = this.outboxScope;
    if (!scope) return;
    let recoveryEntries: StudioCrdtRecoveryVaultEntry[];
    let rejectionMarkers: StudioCrdtPermanentRejectionMarker[];
    try {
      recoveryEntries = await this.recoveryVault.list(scope, this.room.workId);
      rejectionMarkers = await this.recoveryVault.listRejectionMarkers(
        scope,
        this.room.workId
      );
    } catch (error) {
      if (this.closed) return;
      this.recoveryState = {
        code: "recovery_vault_unavailable",
        updateId: "recovery-vault-unavailable",
        message:
          "거부된 공동 편집 변경의 복구 저장소를 확인하지 못해 원고를 잠갔습니다. " +
          messageFrom(error, "복구 저장소를 다시 확인해 주세요."),
        recoveryUpdateCount: 0,
        outboxCleanupAtRisk: true,
        recoveryVaultId: null,
        recoveryExportAvailable: false,
      };
      this.emitRecoveryRequiredStatus();
      return;
    }
    const preservedUpdateIds = new Set(
      recoveryEntries.flatMap((entry) => entry.updates.map(({ updateId }) => updateId))
    );
    const orphanedMarkers = rejectionMarkers.filter(
      ({ rejectedUpdateId }) => !preservedUpdateIds.has(rejectedUpdateId)
    );
    if (orphanedMarkers.length > 0) {
      const newest = orphanedMarkers.at(-1)!;
      this.recoveryState = {
        code: newest.failureCode,
        updateId: newest.rejectedUpdateId,
        message:
          "이 기기에 영구 거절된 공동 편집 표식과 재전송 원본이 남아 있어 원고를 잠갔습니다. " +
          "복구 frontier 저장이 완료되지 않았으므로 서버 원고를 덮어쓰거나 재전송하지 마세요.",
        recoveryUpdateCount: orphanedMarkers.reduce(
          (sum, marker) => sum + marker.recoveryUpdateCount,
          0
        ),
        outboxCleanupAtRisk: true,
        recoveryVaultId: null,
        recoveryExportAvailable: false,
      };
      this.emitRecoveryRequiredStatus();
      return;
    }
    const pendingRecoveryEntries = recoveryEntries.filter(
      ({ status }) => status === "pending-export"
    );
    if (pendingRecoveryEntries.length > 0) {
      const newest = pendingRecoveryEntries.at(-1)!;
      this.recoveryState = {
        code: newest.failureCode,
        updateId: newest.rejectedUpdateId,
        message:
          "이 기기에 아직 내보내지 않은 공동 편집 복구 frontier가 있습니다. " +
          "복구 파일을 내보낸 뒤 서버 원고를 명시적으로 다시 열어 주세요.",
        recoveryUpdateCount: pendingRecoveryEntries.reduce(
          (sum, entry) => sum + entry.updates.length,
          0
        ),
        outboxCleanupAtRisk: false,
        recoveryVaultId: newest.vaultId,
        recoveryExportAvailable: true,
      };
      this.emitRecoveryRequiredStatus();
      return;
    }
    // Exported recovery entries remain as an audit/fork source. Their update ids must never return
    // to the resend queue even if an earlier outbox tombstone write was interrupted.
    const recoveryUpdateIds = new Set(
      recoveryEntries.flatMap((entry) => entry.updates.map(({ updateId }) => updateId))
    );
    let requests: StudioCrdtUpdateRequest[];
    try {
      const storedRequests = await this.outbox.list(scope, this.room.workId);
      const rejectedRecoveryCopies = storedRequests.filter(({ updateId }) =>
        recoveryUpdateIds.has(updateId)
      );
      requests = storedRequests.filter(({ updateId }) => !recoveryUpdateIds.has(updateId));
      // The recovery vault is the durable source for these rejected operations. Best-effort
      // tombstoning keeps an interrupted old outbox cleanup from accumulating resend rows, while
      // filtering above remains the fail-safe that prevents replay even if cleanup fails again.
      for (const request of rejectedRecoveryCopies) {
        this.outbox.removeEmergency?.(scope, request.workId, request.updateId);
      }
      await Promise.allSettled(rejectedRecoveryCopies.map((request) =>
        this.withPersistenceTimeout(
          this.outbox.remove(scope, request.workId, request.updateId)
        )
      ));
    } catch (error) {
      if (this.closed) return;
      this.persistenceChecked = true;
      this.durabilityWarning = messageFrom(
        error,
        "오프라인 CRDT 보관함을 불러오지 못했습니다."
      );
      this.recoveryState = {
        code: "outbox_unreadable",
        updateId: "outbox-unreadable",
        message:
          "미승인 공동 편집 보관함을 신뢰할 수 없어 원고를 잠갔습니다. " +
          this.durabilityWarning,
        recoveryUpdateCount: 0,
        outboxCleanupAtRisk: true,
        recoveryVaultId: null,
        recoveryExportAvailable: false,
      };
      this.emitRecoveryRequiredStatus();
      return;
    }
    this.persistenceChecked = true;
    this.captureOutboxStatus();
    if (this.durabilityWarning && !this.closed) {
      this.emitStatus({
        state: "error",
        message: this.durabilityWarning,
        durabilityAtRisk: true,
      });
    }
    if (this.closed) return;
    for (const request of requests) {
      if (this.pending.has(request.updateId)) continue;
      try {
        this.document.applyUpdate(decodeStudioCrdtUpdate(request.update), STUDIO_CRDT_ORIGIN_SYNC);
      } catch (error) {
        this.emitStatus({
          state: "error",
          message: messageFrom(error, "보관된 CRDT 업데이트가 손상되어 복원하지 못했습니다."),
        });
        continue;
      }
      this.clientSequence = Math.max(this.clientSequence, request.clientSequence);
      this.pending.set(request.updateId, {
        request,
        attempts: 0,
        persistenceState: "ready",
        persisted: Promise.resolve(true),
      });
    }
  }

  private async enterRecoveryRequired(
    failure: StudioCrdtFailureClassification,
    rejectedUpdateId: string | null
  ): Promise<void> {
    if (this.closed || this.recoveryState) return;

    // A permanent rejection can arrive while a newer local edit is still inside the 40 ms
    // document batch. Flush that batch while enqueueUpdate is still allowed so the complete
    // optimistic frontier receives stable update ids and starts durable outbox persistence before
    // the binding crosses the terminal boundary. recoveryTransition suppresses a new drain when
    // this terminal failure came from sync rather than an already-running publication.
    this.recoveryTransition = true;
    this.batchSubscription?.flush();

    // A rejected operation is already present in this optimistic local Y.Doc. Later queued Yjs
    // updates may depend on its client clock, so none of the unsent frontier can be published in
    // isolation. Preserve the entire frontier and require a fresh server-authoritative document
    // instance instead of pretending a merge-only state-vector sync can subtract the rejected op.
    const rejectedFrontier = [...this.pending.values()];
    const effectiveRejectedUpdateId =
      rejectedUpdateId ??
      rejectedFrontier[0]?.request.updateId ??
      `sync-${failure.code}-${this.randomId()}`;
    const message =
      `서버가 공동 편집 변경을 영구 거부했습니다. 원고를 서버 기준으로 다시 불러오기 전까지 ` +
      `공동 편집을 중지합니다. ${failure.message}`;
    this.recoveryState = {
      code: failure.code,
      updateId: effectiveRejectedUpdateId,
      message,
      recoveryUpdateCount: Math.max(1, rejectedFrontier.length),
      outboxCleanupAtRisk: false,
      recoveryVaultId: null,
      recoveryExportAvailable: false,
    };
    this.recoveryTransition = false;

    if (this.retryTimer !== null) this.cancelTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.syncRetryTimer !== null) this.cancelTimeout(this.syncRetryTimer);
    this.syncRetryTimer = null;
    if (this.backgroundSyncTimer !== null) this.cancelTimeout(this.backgroundSyncTimer);
    this.backgroundSyncTimer = null;

    // The sub-frame batch was synchronously flushed into rejectedFrontier before recoveryState was
    // set. unsubscribe() now only detaches the local update listener at the terminal boundary.
    this.batchSubscription?.unsubscribe();
    this.batchSubscription = null;
    this.emitRecoveryRequiredStatus();

    const scope = this.outboxScope;
    if (!scope || rejectedFrontier.length === 0) {
      this.recoveryState = {
        ...this.recoveryState,
        outboxCleanupAtRisk: true,
        message:
          `${message} 영구 복구 저장소 범위가 없어 이 탭을 닫기 전에 원고를 별도로 보존해야 합니다.`,
      };
      this.emitRecoveryRequiredStatus();
      return;
    }

    let rejectionMarkerPreserved = false;
    let rejectionMarkerError: unknown = null;
    try {
      await this.recoveryVault.preserveRejectionMarker({
        scope,
        workId: this.room.workId,
        failureCode: failure.code,
        failureMessage: failure.message,
        rejectedUpdateId: effectiveRejectedUpdateId,
        recoveryUpdateCount: rejectedFrontier.length,
      });
      rejectionMarkerPreserved = true;
    } catch (error) {
      // The vault implementation still keeps a same-page latch before surfacing this failure.
      // A successful full-frontier write below is also sufficient to lock future bindings.
      rejectionMarkerError = error;
    }

    let recoveryEntry: StudioCrdtRecoveryVaultEntry;
    try {
      recoveryEntry = await this.recoveryVault.preserve({
        scope,
        workId: this.room.workId,
        failureCode: failure.code,
        failureMessage: failure.message,
        rejectedUpdateId: effectiveRejectedUpdateId,
        updates: rejectedFrontier.map(({ request }) => request),
      });
    } catch (error) {
      if (this.closed || !this.recoveryState) return;
      // Do not remove the retry outbox when the independent recovery copy did not commit. The
      // current binding remains terminal, so these requests cannot be retried in this session.
      this.recoveryState = {
        ...this.recoveryState,
        outboxCleanupAtRisk: true,
        message:
          `${message} 거부된 변경을 영구 복구 저장소에 복사하지 못해 재전송 보관함을 그대로 유지합니다. ` +
          (rejectionMarkerPreserved
            ? "영구 거절 표식은 보존되어 다음 세션에서도 재전송이 차단됩니다. "
            : "이 페이지의 재전송은 차단했지만 영구 거절 표식도 저장하지 못했습니다. ") +
          messageFrom(error, messageFrom(rejectionMarkerError, "복구 저장소를 확인해 주세요.")),
      };
      this.emitRecoveryRequiredStatus();
      return;
    }

    if (this.closed || !this.recoveryState) return;
    this.recoveryState = {
      ...this.recoveryState,
      recoveryVaultId: recoveryEntry.vaultId,
      recoveryExportAvailable: true,
      message:
        `${message} 거부된 변경 ${recoveryEntry.updates.length}개를 별도 복구 저장소에 보존했습니다. ` +
        "복구 파일을 내보낸 뒤 서버 원고를 다시 열어 주세요.",
    };
    this.pending.clear();
    this.emitRecoveryRequiredStatus();

    for (const pending of rejectedFrontier) {
      this.outbox.removeEmergency?.(
        scope,
        pending.request.workId,
        pending.request.updateId
      );
    }
    const cleanupResults = await Promise.allSettled(rejectedFrontier.map(async (pending) => {
      // Let an already-started put settle before its tombstone/removal. The production serialized
      // outbox also guards a late put, while this ordering keeps simple adapters correct.
      await pending.persisted;
      await this.withPersistenceTimeout(this.outbox.remove(
        scope,
        pending.request.workId,
        pending.request.updateId
      ));
    }));
    const currentRecovery = this.recoveryState;
    if (
      this.closed ||
      !currentRecovery ||
      !cleanupResults.some((result) => result.status === "rejected")
    ) return;
    this.recoveryState = {
      ...currentRecovery,
      outboxCleanupAtRisk: true,
      message:
        `${message} 별도 복구 저장소에는 안전하게 보존했지만 재전송 보관함 정리를 완료하지 못했습니다. ` +
        "복구 파일을 내보낸 뒤 서버 원고를 다시 열어 주세요.",
    };
    this.emitRecoveryRequiredStatus();
  }

  private emitRecoveryRequiredStatus(): void {
    const recovery = this.recoveryState;
    if (!recovery) return;
    this.emitStatus({
      state: "recovery-required",
      message: recovery.message,
      code: recovery.code,
      updateId: recovery.updateId,
      recoveryUpdateCount: recovery.recoveryUpdateCount,
      collaborativeEditsBlocked: true,
      retryable: false,
      ...(recovery.recoveryVaultId ? { recoveryVaultId: recovery.recoveryVaultId } : {}),
      recoveryExportAvailable: recovery.recoveryExportAvailable,
      ...(recovery.outboxCleanupAtRisk ? { outboxCleanupAtRisk: true } : {}),
    });
  }

  private emitStatus(status: StudioCrdtBindingStatusPayload): void {
    const telemetry = this.bindingTelemetry();
    if (status.state === "ready" && this.durabilityWarning) {
      this.onStatus?.({
        state: "error",
        message: `실시간 서버 동기화는 유지되지만 로컬 복구 저장소가 저하되었습니다. ${this.durabilityWarning}`,
        durabilityAtRisk: true,
        ...telemetry,
      });
      return;
    }
    this.onStatus?.({ ...status, ...telemetry });
  }

  private bindingTelemetry(): StudioCrdtBindingTelemetry {
    return {
      pendingCount: this.pending.size,
      persistenceDurability: this.persistenceDurability(),
      transportReady: this.room.ready,
      lastAckAt: this.lastAckAt,
      lastAckServerSequence: this.lastAckServerSequence,
    };
  }

  private persistenceDurability(): StudioCrdtBindingTelemetry["persistenceDurability"] {
    if (!this.canEdit) return "not-applicable";
    if (!this.outboxScope || !this.outbox.getStatus) return "unavailable";
    if (!this.persistenceChecked) return "checking";
    if ([...this.pending.values()].some(({ persistenceState }) => persistenceState === "pending")) {
      return "checking";
    }
    if ([...this.pending.values()].some(({ persistenceState }) => persistenceState === "failed")) {
      return "degraded";
    }
    return this.outbox.getStatus().state === "durable" && !this.durabilityWarning
      ? "durable"
      : "degraded";
  }

  private captureOutboxStatus(): void {
    const status = this.outbox.getStatus?.();
    if (!status) return;
    this.durabilityWarning = status.state === "degraded" ? status.message : null;
  }
}
