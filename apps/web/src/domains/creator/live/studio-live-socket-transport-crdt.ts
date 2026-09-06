/** Implementation helpers for `StudioLiveSocketTransport`; not a public entry. */
import {
  parseStudioCrdtBinaryRemoteUpdate,
  STUDIO_CRDT_BINARY_WIRE_FORMAT,
  STUDIO_LIVE_CRDT_BINARY_SYNC_EVENT,
  STUDIO_LIVE_CRDT_BINARY_UPDATE_EVENT,
} from "./studio-crdt-binary-wire";
import {
  createStudioCrdtPermanentError,
  createStudioCrdtRetryableError,
  createStudioCrdtServerAckError,
  type StudioCrdtOperationError,
} from "./studio-crdt-operation-error";
import {
  parseStudioCrdtRemoteUpdate,
  parseStudioCrdtSyncResponse,
  type StudioCrdtTransportMessage,
} from "./studio-crdt-protocol";
import {
  isStudioLiveInkWireCandidate,
} from "./studio-live-ink-protocol";
import {
  CRDT_ACK_TIMEOUT_MS,
  MAX_SEEN_CRDT_UPDATE_IDS,
  STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_BYTES,
  STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_PACKETS,
  STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_SENDERS,
  STUDIO_LIVE_INK_SOCKET_INBOUND_WINDOW_MS,
  inkWirePayloadByteLength,
} from "./studio-live-socket-transport-types";
import {
  isRecord,
  parseFailure,
  safeIdentifier,
} from "./studio-live-socket-wire";

import type { StudioLiveSocketTransportHost } from "./studio-live-socket-transport-host";

export function onCrdtSync(this: StudioLiveSocketTransportHost, value: unknown) {
  if (!this.ready) return;
  const response = parseStudioCrdtSyncResponse(value, {
    expectedWorkId: this.context.workId,
  });
  if (!response) return;
  this.emitCrdt({ type: "sync-response", response, senderSessionId: null });
}

export function onCrdtUpdate(this: StudioLiveSocketTransportHost, value: unknown) {
  if (!this.ready) return;
  const update = parseStudioCrdtRemoteUpdate(value, {
    expectedWorkId: this.context.workId,
  });
  if (!update || this.seenCrdtUpdateIds.has(update.updateId)) return;
  this.emitCrdt({ type: "update", update, senderSessionId: null });
  this.rememberCrdtUpdateId(update.updateId);
}

export function onCrdtBinaryUpdate(this: StudioLiveSocketTransportHost, value: unknown) {
  if (
    !this.ready ||
    this.selectedCrdtWireFormat !== STUDIO_CRDT_BINARY_WIRE_FORMAT
  ) {
    return;
  }
  const update = parseStudioCrdtBinaryRemoteUpdate(value, {
    expectedWorkId: this.context.workId,
  });
  if (!update) {
    this.restartAfterCrdtWireFailure(
      "손상된 바이너리 공동 편집 업데이트를 감지해 안전하게 다시 연결합니다."
    );
    return;
  }
  if (this.seenCrdtUpdateIds.has(update.updateId)) return;
  this.emitCrdt({ type: "update", update, senderSessionId: null });
  this.rememberCrdtUpdateId(update.updateId);
}

export function onInk(this: StudioLiveSocketTransportHost, value: unknown) {
  // Fail closed: the binary lane exists only on a joined, binary-selected connection. A frame
  // arriving anywhere else is dropped — never re-routed to the JSON envelope listeners.
  if (!this.ready || this.selectedCrdtWireFormat !== STUDIO_CRDT_BINARY_WIRE_FORMAT) return;
  if (!isRecord(value) || !isStudioLiveInkWireCandidate(value)) return;
  if (!this.acceptInkInbound(value, this.now())) return;
  for (const listener of this.inkListeners) listener(value);
}

/** Per-sender byte/packet windows for the ink lane, mirroring the gesture-preview budget. */
export function acceptInkInbound(this: StudioLiveSocketTransportHost, value: Record<string, unknown>, receivedAt: number): boolean {
  const senderSessionId = value.senderSessionId;
  if (!safeIdentifier(senderSessionId, 160)) return false;
  const byteLength = inkWirePayloadByteLength(value);
  if (byteLength > STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_BYTES) return false;
  const current = this.inkInboundWindowBySender.get(senderSessionId);
  if (
    !current ||
    receivedAt < current.startedAt ||
    receivedAt - current.startedAt >= STUDIO_LIVE_INK_SOCKET_INBOUND_WINDOW_MS
  ) {
    if (
      !current &&
      this.inkInboundWindowBySender.size >= STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_SENDERS
    ) {
      for (const [candidateSender, candidate] of this.inkInboundWindowBySender) {
        if (receivedAt - candidate.startedAt < STUDIO_LIVE_INK_SOCKET_INBOUND_WINDOW_MS) {
          continue;
        }
        this.inkInboundWindowBySender.delete(candidateSender);
      }
      if (
        this.inkInboundWindowBySender.size >= STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_SENDERS
      ) {
        return false;
      }
    }
    this.inkInboundWindowBySender.set(senderSessionId, {
      startedAt: receivedAt,
      packetCount: 1,
      byteCount: byteLength,
    });
    return true;
  }
  if (
    current.packetCount >= STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_PACKETS ||
    current.byteCount + byteLength > STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_BYTES
  ) {
    return false;
  }
  this.inkInboundWindowBySender.set(senderSessionId, {
    startedAt: current.startedAt,
    packetCount: current.packetCount + 1,
    byteCount: current.byteCount + byteLength,
  });
  return true;
}

export function emitWithAck(this: StudioLiveSocketTransportHost,
      event: string,
    payload: Record<string, unknown>,
    onSuccess?: (data: unknown) => void,
    onFailure?: (message: string) => void): void {
  const generation = this.joinGeneration;
  const selfConnectionId = this.selfConnectionId;
  this.socket.emit(event, payload, (value: unknown) => {
    if (
      this.closed ||
      !this.ready ||
      generation !== this.joinGeneration ||
      selfConnectionId !== this.selfConnectionId
    ) {
      return;
    }
    const failure = parseFailure(value);
    if (failure) {
      onFailure?.(failure.message);
      this.handleFailure(failure, "operation");
      return;
    }
    if (!isRecord(value) || value.ok !== true) {
      const message = "팀 서버 응답을 확인하지 못했습니다.";
      onFailure?.(message);
      this.emitStatus({
        state: "error",
        message,
        recoverable: true,
      });
      return;
    }
    onSuccess?.(value.data);
  });
}

export function emitCrdtWithAck<T>(this: StudioLiveSocketTransportHost,
      event:
      | "studio:crdt:sync"
      | "studio:crdt:update"
      | typeof STUDIO_LIVE_CRDT_BINARY_SYNC_EVENT
      | typeof STUDIO_LIVE_CRDT_BINARY_UPDATE_EVENT,
    payload: unknown,
    parse: (value: unknown, options: { expectedWorkId: string }) => T | null,
    correlation: "requestId" | "updateId",
    failClosed = false): Promise<T> {
  if (!this.ready) {
    return Promise.reject(createStudioCrdtRetryableError(
      "disconnected",
      "팀 CRDT 연결이 준비되지 않았습니다.",
      "connection"
    ));
  }
  const generation = this.joinGeneration;
  const selfConnectionId = this.selfConnectionId;
  return new Promise<T>((resolve, reject) => {
    const operation = {
      reject,
      timeout: null as unknown,
    };
    this.pendingCrdtOperations.add(operation);
    operation.timeout = this.scheduleTimeout(() => {
      if (!this.pendingCrdtOperations.delete(operation)) return;
      const error = createStudioCrdtRetryableError(
        "timeout",
        "팀 서버의 CRDT 응답 시간이 초과되었습니다.",
        "timeout"
      );
      this.emitStatus({ state: "error", message: error.message, recoverable: true });
      reject(error);
    }, CRDT_ACK_TIMEOUT_MS);
    this.socket.emit(event, payload, (value: unknown) => {
      if (!this.pendingCrdtOperations.delete(operation)) return;
      this.cancelTimeout(operation.timeout);
      if (
        this.closed ||
        !this.ready ||
        generation !== this.joinGeneration ||
        selfConnectionId !== this.selfConnectionId
      ) {
        reject(createStudioCrdtRetryableError(
          "connection_changed",
          "연결이 변경되어 CRDT 작업을 다시 시도해야 합니다.",
          "connection"
        ));
        return;
      }
      const failure = parseFailure(value);
      if (failure) {
        this.handleFailure(failure, "operation");
        if (failClosed && failure.code === "not_joined") {
          this.restartAfterCrdtWireFailure(failure.message);
          reject(createStudioCrdtRetryableError(
            "connection_changed",
            failure.message,
            "connection"
          ));
          return;
        }
        reject(createStudioCrdtServerAckError(failure.code, failure.message));
        return;
      }
      if (!isRecord(value) || value.ok !== true) {
        const error = failClosed
          ? createStudioCrdtRetryableError(
              "connection_changed",
              "바이너리 CRDT 응답을 확인하지 못해 안전하게 다시 연결합니다.",
              "connection"
            )
          : createStudioCrdtPermanentError(
              "invalid_response",
              "팀 서버의 CRDT 응답을 확인하지 못했습니다.",
              "server-response"
            );
        this.emitStatus({ state: "error", message: error.message, recoverable: true });
        if (failClosed) this.restartAfterCrdtWireFailure(error.message);
        reject(error);
        return;
      }
      const parsed = parse(value.data, { expectedWorkId: this.context.workId });
      if (!parsed) {
        const error = failClosed
          ? createStudioCrdtRetryableError(
              "connection_changed",
              "바이너리 CRDT 응답이 손상되어 안전하게 다시 연결합니다.",
              "connection"
            )
          : createStudioCrdtPermanentError(
              "invalid_response",
              "팀 서버의 CRDT 응답 형식이 올바르지 않습니다.",
              "server-response"
            );
        this.emitStatus({ state: "error", message: error.message, recoverable: true });
        if (failClosed) this.restartAfterCrdtWireFailure(error.message);
        reject(error);
        return;
      }
      const responseMatchesRequest =
        isRecord(parsed) &&
        isRecord(payload) &&
        (parsed as Record<string, unknown>)[correlation] === payload[correlation];
      if (!responseMatchesRequest) {
        const error = failClosed
          ? createStudioCrdtRetryableError(
              "connection_changed",
              "바이너리 CRDT 응답 식별자가 일치하지 않아 안전하게 다시 연결합니다.",
              "connection"
            )
          : createStudioCrdtPermanentError(
              "response_mismatch",
              "팀 서버의 CRDT 응답 식별자가 요청과 일치하지 않습니다.",
              "server-response"
            );
        this.emitStatus({ state: "error", message: error.message, recoverable: true });
        if (failClosed) this.restartAfterCrdtWireFailure(error.message);
        reject(error);
        return;
      }
      resolve(parsed);
    });
  });
}

export function emitCrdt(this: StudioLiveSocketTransportHost, message: StudioCrdtTransportMessage): void {
  for (const listener of this.crdtListeners) {
    try {
      listener(message);
    } catch {
      // One document binding cannot interrupt socket cleanup or other CRDT subscribers.
    }
  }
}

export function rememberCrdtUpdateId(this: StudioLiveSocketTransportHost, updateId: string): void {
  if (this.seenCrdtUpdateIds.has(updateId)) return;
  this.seenCrdtUpdateIds.add(updateId);
  if (this.seenCrdtUpdateIds.size <= MAX_SEEN_CRDT_UPDATE_IDS) return;
  const oldest = this.seenCrdtUpdateIds.values().next().value;
  if (typeof oldest === "string") this.seenCrdtUpdateIds.delete(oldest);
}

export function restartAfterCrdtWireFailure(this: StudioLiveSocketTransportHost, message: string): void {
  if (this.closed || this.accessRevoked) return;
  this.clearCrdtWireSelectionTimeout();
  this.clearCrdtReconnectTimeout();
  ++this.joinGeneration;
  this.joined = false;
  this.selectedCrdtWireFormat = null;
  this.selfConnectionId = null;
  this.pendingInitialSnapshot = null;
  this.pendingPresenceByConnection.clear();
  this.pendingScreenByConnection.clear();
  this.pendingVoiceByConnection.clear();
  this.pendingLockDeltas.length = 0;
  this.pendingLockDeltaOverflowed = false;
  this.rejectPendingCrdtOperations(createStudioCrdtRetryableError(
    "connection_changed",
    message,
    "connection"
  ));
  this.pendingCrdtPublishes.clear();
  this.emitStatus({ state: "error", message, recoverable: true });
  if (this.socket.connected) this.socket.disconnect();
  this.crdtReconnectTimeout = this.scheduleTimeout(() => {
    this.crdtReconnectTimeout = null;
    if (this.closed || this.accessRevoked) return;
    if (this.socket.connected) this.beginJoin();
    else this.socket.connect();
  }, 0);
}

export function rejectPendingCrdtOperations(this: StudioLiveSocketTransportHost, error: StudioCrdtOperationError): void {
  for (const operation of this.pendingCrdtOperations) {
    this.cancelTimeout(operation.timeout);
    operation.reject(error);
  }
  this.pendingCrdtOperations.clear();
}

export function clearCrdtWireSelectionTimeout(this: StudioLiveSocketTransportHost): void {
  if (this.crdtWireSelectionTimeout !== null) {
    this.cancelTimeout(this.crdtWireSelectionTimeout);
  }
  this.crdtWireSelectionTimeout = null;
}

export function clearCrdtReconnectTimeout(this: StudioLiveSocketTransportHost): void {
  if (this.crdtReconnectTimeout !== null) {
    this.cancelTimeout(this.crdtReconnectTimeout);
  }
  this.crdtReconnectTimeout = null;
}
