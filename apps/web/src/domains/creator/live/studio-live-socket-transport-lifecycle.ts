/** Implementation helpers for `StudioLiveSocketTransport`; not a public entry. */
import {
  createStudioCrdtBinarySelectionRequest,
  parseStudioCrdtBinarySelection,
  STUDIO_CRDT_BINARY_WIRE_FORMAT,
  STUDIO_CRDT_LEGACY_WIRE_FORMAT,
  STUDIO_LIVE_CRDT_BINARY_REMOTE_EVENT,
  STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT,
} from "./studio-crdt-binary-wire";
import {
  createStudioCrdtPermanentError,
  createStudioCrdtRetryableError,
} from "./studio-crdt-operation-error";
import {
  STUDIO_LIVE_LOCK_REVISION_VERSION,
} from "./studio-live-collaboration-protocol";
import {
  clearStudioLiveLockRevisionState,
  studioLiveLockDeltasRequireResync,
} from "./studio-live-lock-revision-ledger";
import {
  connectErrorCode,
  eventMessage,
  isNonRecoverable,
  isTerminalConnectErrorCode,
} from "./studio-live-socket-connect-error";
import {
  CONNECT_TIMEOUT_MS,
} from "./studio-live-socket-connection-factory";
import {
  CRDT_WIRE_SELECT_ACK_TIMEOUT_MS,
  JOIN_RATE_LIMIT_RETRY_MS,
  JOIN_RESYNC_RETRY_BASE_MS,
  JOIN_RESYNC_RETRY_MAX_MS,
  MAX_TOKEN_LENGTH,
  STUDIO_LIVE_GESTURE_PREVIEW_SOCKET_EVENT,
  STUDIO_LIVE_INK_SOCKET_EVENT,
} from "./studio-live-socket-transport-types";
import {
  isRecord,
  parseFailure,
  parseJoinAck,
  safeString,
  type ServerFailure,
  type ServerJoinSnapshot,
} from "./studio-live-socket-wire";

import type {
  StudioLiveTransportControlEvent,
  StudioLiveTransportStatus,
} from "./studio-live-collaboration-transport";
import type { StudioLiveSocketTransportHost } from "./studio-live-socket-transport-host";

export function connect(this: StudioLiveSocketTransportHost): Promise<void> {
  if (this.closed) return Promise.reject(new Error("이미 닫힌 팀 공동작업 연결입니다."));
  if (this.accessRevoked) {
    return Promise.reject(new Error("팀 권한이 해제되었습니다. 권한을 확인한 뒤 다시 연결해 주세요."));
  }
  if (this.ready) return Promise.resolve();
  if (this.connectPromise) return this.connectPromise;
  this.emitStatus({
    state: "connecting",
    message: "팀 서버에 연결하고 작품 권한을 확인하는 중입니다.",
    recoverable: true,
  });
  const promise = new Promise<void>((resolve, reject) => {
    this.resolveConnect = resolve;
    this.rejectConnect = reject;
  });
  this.connectPromise = promise;
  this.connectTimeout = this.scheduleTimeout(() => {
    this.failInitialConnect("팀 서버 연결 시간이 초과되었습니다. 다시 연결하거나 로컬 모드를 사용해 주세요.");
  }, CONNECT_TIMEOUT_MS);
  if (this.socket.connected) this.beginJoin();
  else this.socket.connect();
  return promise;
}

export function close(this: StudioLiveSocketTransportHost): void {
  if (this.closed) return;
  this.revokePendingLockReleases(
    "connection_closed",
    "팀 공동작업 연결이 종료되어 편집 잠금 해제 확인이 취소되었습니다."
  );
  this.revokePendingLockAcquisitions(
    "connection_closed",
    "팀 공동작업 연결이 종료되어 편집 잠금 요청이 취소되었습니다."
  );
  this.terminateVoiceIntent(
    "removed",
    "팀 공동작업 연결이 종료되어 음성 작업실에서 나갔습니다."
  );
  this.closed = true;
  ++this.joinGeneration;
  this.joined = false;
  this.selectedCrdtWireFormat = null;
  this.clearCrdtWireSelectionTimeout();
  this.clearCrdtReconnectTimeout();
  this.clearJoinRetry(true);
  this.clearConnectTimeout();
  this.rejectConnect?.(new Error("팀 공동작업 연결이 종료되었습니다."));
  this.clearConnectDeferred();
  this.socket.off("connect", this.onConnect);
  this.socket.off("connect_error", this.onConnectError);
  this.socket.off("disconnect", this.onDisconnect);
  this.socket.off("studio:error", this.onServerError);
  this.socket.off("studio:access:revoked", this.onAccessRevoked);
  this.socket.off("studio:presence:snapshot", this.onPresenceSnapshot);
  this.socket.off("studio:presence:update", this.onPresenceUpdate);
  this.socket.off("studio:presence:leave", this.onPresenceLeave);
  this.socket.off("studio:cursor", this.onCursor);
  this.socket.off(
    STUDIO_LIVE_GESTURE_PREVIEW_SOCKET_EVENT,
    this.onGesturePreview
  );
  this.socket.off("studio:lock:update", this.onLockUpdate);
  this.socket.off("studio:signal", this.onSignal);
  this.socket.off("studio:screen:announce", this.onScreenAnnounce);
  this.socket.off("studio:screen:request", this.onScreenRequest);
  this.socket.off("studio:screen:access", this.onScreenAccess);
  this.socket.off("studio:screen:stop", this.onScreenStop);
  this.socket.off("studio:voice:snapshot", this.onVoiceSnapshot);
  this.socket.off("studio:voice:join", this.onVoiceJoin);
  this.socket.off("studio:voice:state", this.onVoiceState);
  this.socket.off("studio:voice:leave", this.onVoiceLeave);
  this.socket.off("studio:voice:signal", this.onVoiceSignal);
  this.socket.off("studio:chat:message", this.onChatMessage);
  this.socket.off("studio:comment:changed", this.onTeamCommentChanged);
  this.socket.off("studio:crdt:sync", this.onCrdtSync);
  this.socket.off("studio:crdt:update", this.onCrdtUpdate);
  this.socket.off(STUDIO_LIVE_CRDT_BINARY_REMOTE_EVENT, this.onCrdtBinaryUpdate);
  this.socket.off(STUDIO_LIVE_INK_SOCKET_EVENT, this.onInk);
  this.rejectPendingCrdtOperations(createStudioCrdtRetryableError(
    "connection_closed",
    "팀 공동작업 연결이 종료되었습니다.",
    "connection"
  ));
  this.scrubCredentials();
  this.socket.disconnect();
  this.listeners.clear();
  this.controlListeners.clear();
  this.crdtListeners.clear();
  this.inkListeners.clear();
  this.inkInboundWindowBySender.clear();
  this.pendingCrdtPublishes.clear();
  this.seenCrdtUpdateIds.clear();
  this.participants.clear();
  this.canonicalSessionByConnection.clear();
  this.activeConnectionsByCanonicalSession.clear();
  this.sequenceByConnection.clear();
  this.activeScreenShareByConnection.clear();
  this.shareIdByConnection.clear();
  this.voiceMemberByConnection.clear();
  this.locksByResource.clear();
  clearStudioLiveLockRevisionState(this.lockRevisions);
  this.pendingInitialSnapshot = null;
  this.pendingPresenceByConnection.clear();
  this.pendingScreenByConnection.clear();
  this.pendingVoiceByConnection.clear();
  this.pendingLockDeltas.length = 0;
  this.pendingLockDeltaOverflowed = false;
  this.selfConnectionId = null;
}

export function onConnect(this: StudioLiveSocketTransportHost) {
  if (!this.closed && !this.accessRevoked) {
    this.credentialRefreshAttempted = false;
    this.clearCrdtReconnectTimeout();
    this.clearJoinRetry(true);
    this.beginJoin();
  }
}

export function onConnectError(this: StudioLiveSocketTransportHost, error: unknown) {
  const message = eventMessage(error, "팀 서버에 연결하지 못했습니다.");
  const code = connectErrorCode(error);
  if (
    code === "unauthenticated"
    && this.refreshSocketCredential
    && !this.credentialRefreshAttempted
  ) {
    this.credentialRefreshAttempted = true;
    this.refreshCredentialAfterAuthenticationError(message);
    return;
  }
  if (isTerminalConnectErrorCode(code)) {
    this.revokeFromConnectError(message);
    return;
  }
  if (!this.everJoined) {
    this.failInitialConnect(message);
    return;
  }
  this.joined = false;
  this.selectedCrdtWireFormat = null;
  this.clearCrdtWireSelectionTimeout();
  this.emitStatus({ state: "error", message, recoverable: true });
}

export function refreshCredentialAfterAuthenticationError(this: StudioLiveSocketTransportHost, fallbackMessage: string): void {
  if (
    this.credentialRefreshPromise
    || !this.refreshSocketCredential
    || this.closed
    || this.accessRevoked
  ) return;
  this.emitStatus({
    state: "connecting",
    message: "로그인 상태를 다시 확인하고 팀 서버에 재연결하는 중입니다.",
    recoverable: true,
  });
  this.credentialRefreshPromise = Promise.resolve()
    .then(() => this.refreshSocketCredential?.())
    .then((credential) => {
      if (this.closed || this.accessRevoked) return;
      if (!safeString(credential, MAX_TOKEN_LENGTH)) {
        throw new Error("실시간 팀 연결 정보가 올바르지 않습니다.");
      }
      this.sessionToken = credential;
      this.socket.auth = { sessionToken: credential };
      this.socket.connect();
    })
    .catch(() => {
      if (!this.closed && !this.accessRevoked) {
        this.revokeFromConnectError(fallbackMessage);
      }
    })
    .finally(() => {
      this.credentialRefreshPromise = null;
    });
}

export function revokeFromConnectError(this: StudioLiveSocketTransportHost, message: string): void {
  this.revokePendingLockReleases("access_revoked", message);
  this.revokePendingLockAcquisitions("access_revoked", message);
  this.terminateVoiceIntent("revoked", message);
  ++this.joinGeneration;
  this.accessRevoked = true;
  this.joined = false;
  this.selectedCrdtWireFormat = null;
  this.clearCrdtWireSelectionTimeout();
  this.clearCrdtReconnectTimeout();
  this.clearJoinRetry(true);
  this.pendingInitialSnapshot = null;
  this.pendingPresenceByConnection.clear();
  this.pendingScreenByConnection.clear();
  this.pendingVoiceByConnection.clear();
  this.pendingLockDeltas.length = 0;
  this.pendingLockDeltaOverflowed = false;
  clearStudioLiveLockRevisionState(this.lockRevisions);
  this.clearConnectTimeout();
  this.rejectConnect?.(new Error(message));
  this.clearConnectDeferred();
  this.rejectPendingCrdtOperations(createStudioCrdtPermanentError(
    "access_revoked",
    message,
    "connection"
  ));
  this.emitStatus({ state: "revoked", message, recoverable: false });
  this.scrubCredentials();
  this.socket.disconnect();
}

export function onDisconnect(this: StudioLiveSocketTransportHost, reason: unknown) {
  if (this.closed) return;
  this.revokePendingLockReleases(
    "disconnected",
    "팀 서버 연결이 끊겨 편집 잠금 해제 확인이 취소되었습니다."
  );
  this.revokePendingLockAcquisitions(
    "disconnected",
    "팀 서버 연결이 끊겨 편집 잠금 요청이 취소되었습니다."
  );
  // The room retains the user's desired call across a recoverable reconnect and republishes the
  // join after the next work-room ACK. Signals from the abandoned socket generation must not.
  this.cancelPendingVoiceAdmission({
    emitRemoval: false,
    preserveIntent: true,
    sendLeave: false,
  });
  this.joined = false;
  this.selectedCrdtWireFormat = null;
  this.clearCrdtWireSelectionTimeout();
  this.clearJoinRetry(true);
  this.selfConnectionId = null;
  this.pendingInitialSnapshot = null;
  this.pendingPresenceByConnection.clear();
  this.pendingScreenByConnection.clear();
  this.pendingVoiceByConnection.clear();
  this.pendingLockDeltas.length = 0;
  this.pendingLockDeltaOverflowed = false;
  this.voiceMemberByConnection.clear();
  this.rejectPendingCrdtOperations(createStudioCrdtRetryableError(
    "disconnected",
    "연결이 끊겨 CRDT 작업을 다시 시도해야 합니다.",
    "connection"
  ));
  this.pendingCrdtPublishes.clear();
  if (this.accessRevoked) return;
  this.emitStatus({
    state: "disconnected",
    message: `팀 서버 연결이 끊겼습니다${typeof reason === "string" ? ` (${reason})` : ""}. 자동으로 다시 연결합니다.`,
    recoverable: true,
  });
}

export function onServerError(this: StudioLiveSocketTransportHost, value: unknown) {
  const failure = parseFailure(value);
  if (!failure) return;
  this.handleFailure(failure);
}

export function onAccessRevoked(this: StudioLiveSocketTransportHost, value: unknown) {
  const message =
    isRecord(value) && typeof value.message === "string" && value.message.trim()
      ? value.message.slice(0, 500)
      : "팀 권한이 변경되어 실시간 작업실 연결이 종료되었습니다.";
  this.revokePendingLockReleases("access_revoked", message);
  this.revokePendingLockAcquisitions("access_revoked", message);
  this.terminateVoiceIntent("revoked", message);
  ++this.joinGeneration;
  this.accessRevoked = true;
  this.joined = false;
  this.selectedCrdtWireFormat = null;
  this.clearCrdtWireSelectionTimeout();
  this.clearCrdtReconnectTimeout();
  this.clearJoinRetry(true);
  this.pendingInitialSnapshot = null;
  this.pendingPresenceByConnection.clear();
  this.pendingScreenByConnection.clear();
  this.pendingVoiceByConnection.clear();
  this.pendingLockDeltas.length = 0;
  this.pendingLockDeltaOverflowed = false;
  clearStudioLiveLockRevisionState(this.lockRevisions);
  this.clearConnectTimeout();
  this.rejectConnect?.(new Error(message));
  this.clearConnectDeferred();
  this.rejectPendingCrdtOperations(createStudioCrdtPermanentError(
    "access_revoked",
    message,
    "connection"
  ));
  this.emitStatus({ state: "revoked", message, recoverable: false });
  this.scrubCredentials();
  this.socket.disconnect();
}

export function beginJoin(this: StudioLiveSocketTransportHost): void {
  if (this.closed || !this.socket.connected || !this.sessionToken) return;
  this.clearJoinRetry(false);
  const generation = ++this.joinGeneration;
  this.joined = false;
  this.selectedCrdtWireFormat = null;
  this.clearCrdtWireSelectionTimeout();
  this.pendingInitialSnapshot = null;
  this.pendingPresenceByConnection.clear();
  this.pendingScreenByConnection.clear();
  this.pendingVoiceByConnection.clear();
  this.pendingLockDeltas.length = 0;
  this.pendingLockDeltaOverflowed = false;
  this.inkInboundWindowBySender.clear();
  this.emitStatus({
    state: "connecting",
    message: "작품 팀 권한을 확인하고 있습니다.",
    recoverable: true,
  });
  this.socket.emit(
    "studio:join",
    { workId: this.context.workId, clientInstanceId: this.context.participant.sessionId },
    (value: unknown) => {
      if (this.closed || generation !== this.joinGeneration || !this.socket.connected) return;
      const response = parseJoinAck(value);
      if (!response) {
        this.failJoin("팀 서버의 참가 응답이 올바르지 않습니다.", true);
        return;
      }
      if ("ok" in response) {
        this.failJoin(response.message, !isNonRecoverable(response.code), response.code);
        return;
      }
      this.acceptJoin(response, generation);
    }
  );
}

export function acceptJoin(this: StudioLiveSocketTransportHost, snapshot: ServerJoinSnapshot, generation: number): void {
  const reconciledSnapshot = this.reconcilePendingPresence(snapshot);
  const wasJoined = this.everJoined;
  if (
    this.lockRevisions.maxCommittedLockRevision !== null &&
    (reconciledSnapshot.lockRevisionVersion !== STUDIO_LIVE_LOCK_REVISION_VERSION ||
      reconciledSnapshot.lockSnapshotRevision === null ||
      reconciledSnapshot.lockSnapshotRevision < this.lockRevisions.maxCommittedLockRevision)
  ) {
    this.joined = true;
    this.everJoined = true;
    this.restartJoinAfterUnsafeSnapshot();
    return;
  }
  if (
    reconciledSnapshot.lockRevisionVersion === STUDIO_LIVE_LOCK_REVISION_VERSION &&
    reconciledSnapshot.lockSnapshotRevision !== null &&
    (this.lockRevisions.maxCommittedLockRevision === null ||
      reconciledSnapshot.lockSnapshotRevision > this.lockRevisions.maxCommittedLockRevision)
  ) {
    // Persist capability observation at JOIN acceptance, not at the later first-heartbeat flush.
    // A disconnect in that staging window must never let the same client downgrade to a legacy
    // gateway that cannot preserve the already-observed monotonic revision contract.
    this.lockRevisions.maxCommittedLockRevision = reconciledSnapshot.lockSnapshotRevision;
  }
  this.lockProtocolVersion = reconciledSnapshot.lockProtocolVersion;
  this.lockRevisions.lockRevisionVersion = reconciledSnapshot.lockRevisionVersion;
  this.selfConnectionId = reconciledSnapshot.self.connectionId;
  this.rememberCanonicalSession(
    reconciledSnapshot.self.connectionId,
    this.context.participant.sessionId,
  );
  this.joined = true;
  this.pendingInitialSnapshot = reconciledSnapshot;
  // Stage the authoritative identity map immediately so an update arriving between join ACK and
  // the room's first heartbeat can still resolve lock owners and targeted connection ids.
  for (const participant of reconciledSnapshot.participants) {
    this.setActiveParticipant(participant);
  }
  if (reconciledSnapshot.crdtWireAdvertisement) {
    this.selectCrdtBinaryWire(
      reconciledSnapshot.crdtWireAdvertisement.selectionEpoch,
      generation,
      wasJoined
    );
    return;
  }
  this.selectedCrdtWireFormat = STUDIO_CRDT_LEGACY_WIRE_FORMAT;
  this.finishAcceptedJoin(wasJoined);
}

export function finishAcceptedJoin(this: StudioLiveSocketTransportHost, wasJoined: boolean): void {
  this.everJoined = true;
  // A reconnect snapshot must be committed before ready is observable. If its bounded delta
  // history is unsafe, flushInitialSnapshot starts a new generation and no stale ready event is
  // allowed to escape after that nested connecting transition.
  if (wasJoined && !this.flushInitialSnapshot()) return;
  this.clearConnectTimeout();
  this.resolveConnect?.();
  this.clearConnectDeferred();
  this.emitStatus({
    state: "ready",
    message: wasJoined ? "팀 서버에 다시 연결되었습니다." : "팀 서버 연결이 준비되었습니다.",
    recoverable: true,
  });
}

export function selectCrdtBinaryWire(this: StudioLiveSocketTransportHost,
      selectionEpoch: string,
    generation: number,
    wasJoined: boolean): void {
  this.clearCrdtWireSelectionTimeout();
  const payload = createStudioCrdtBinarySelectionRequest(
    this.context.workId,
    selectionEpoch
  );
  this.crdtWireSelectionTimeout = this.scheduleTimeout(() => {
    this.crdtWireSelectionTimeout = null;
    if (
      this.closed ||
      generation !== this.joinGeneration ||
      !this.socket.connected
    ) {
      return;
    }
    this.restartAfterCrdtWireFailure(
      "바이너리 공동 편집 채널 선택 응답이 없어 안전하게 다시 연결합니다."
    );
  }, CRDT_WIRE_SELECT_ACK_TIMEOUT_MS);
  this.socket.emit(STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT, payload, (value: unknown) => {
    if (
      this.closed ||
      generation !== this.joinGeneration ||
      !this.socket.connected
    ) {
      return;
    }
    this.clearCrdtWireSelectionTimeout();
    const failure = parseFailure(value);
    if (failure) {
      this.restartAfterCrdtWireFailure(failure.message);
      return;
    }
    const selected =
      isRecord(value) && value.ok === true
        ? parseStudioCrdtBinarySelection(value.data, {
            workId: this.context.workId,
            selectionEpoch,
          })
        : null;
    if (!selected) {
      this.restartAfterCrdtWireFailure(
        "바이너리 공동 편집 채널 선택 정보가 현재 연결과 일치하지 않아 다시 연결합니다."
      );
      return;
    }
    this.selectedCrdtWireFormat = STUDIO_CRDT_BINARY_WIRE_FORMAT;
    this.finishAcceptedJoin(wasJoined);
  });
}

export function reconcilePendingPresence(this: StudioLiveSocketTransportHost, snapshot: ServerJoinSnapshot): ServerJoinSnapshot {
  const participantsByConnection = new Map(
    snapshot.participants.map((participant) => [participant.connectionId, participant])
  );
  const departedConnectionIds = new Set<string>();
  for (const delta of this.pendingPresenceByConnection.values()) {
    if (delta.kind === "leave") {
      participantsByConnection.delete(delta.connectionId);
      departedConnectionIds.add(delta.connectionId);
      continue;
    }
    const previous = participantsByConnection.get(delta.participant.connectionId);
    if (!previous || Date.parse(previous.updatedAt) <= Date.parse(delta.participant.updatedAt)) {
      participantsByConnection.set(delta.participant.connectionId, delta.participant);
    }
  }
  const voiceMembersByConnection = new Map(
    snapshot.voiceMembers.map((member) => [member.connectionId, member])
  );
  for (const delta of this.pendingVoiceByConnection.values()) {
    if (delta.kind === "leave") {
      const current = voiceMembersByConnection.get(delta.connectionId);
      if (current?.callId === delta.callId) voiceMembersByConnection.delete(delta.connectionId);
      continue;
    }
    voiceMembersByConnection.set(delta.member.connectionId, delta.member);
  }
  const screenSharesByConnection = new Map(
    snapshot.screenShares.map((share) => [share.connectionId, share])
  );
  for (const delta of this.pendingScreenByConnection.values()) {
    if (delta.kind === "stop") {
      const current = screenSharesByConnection.get(delta.connectionId);
      if (current?.shareId === delta.shareId) {
        screenSharesByConnection.delete(delta.connectionId);
      }
      continue;
    }
    screenSharesByConnection.set(delta.share.connectionId, delta.share);
  }
  for (const connectionId of departedConnectionIds) {
    voiceMembersByConnection.delete(connectionId);
    screenSharesByConnection.delete(connectionId);
  }
  participantsByConnection.set(snapshot.self.connectionId, snapshot.self);
  for (const [connectionId] of screenSharesByConnection) {
    const participant = participantsByConnection.get(connectionId);
    if (!participant?.sharingScreen) screenSharesByConnection.delete(connectionId);
  }
  this.pendingPresenceByConnection.clear();
  this.pendingScreenByConnection.clear();
  this.pendingVoiceByConnection.clear();
  return {
    ...snapshot,
    participants: [...participantsByConnection.values()],
    voiceMembers: [...voiceMembersByConnection.values()],
    screenShares: [...screenSharesByConnection.values()],
  };
}

export function failJoin(this: StudioLiveSocketTransportHost, message: string, recoverable: boolean, code?: string): void {
  this.joined = false;
  this.selectedCrdtWireFormat = null;
  this.clearCrdtWireSelectionTimeout();
  this.pendingPresenceByConnection.clear();
  this.pendingScreenByConnection.clear();
  this.pendingVoiceByConnection.clear();
  this.pendingLockDeltas.length = 0;
  this.pendingLockDeltaOverflowed = false;
  const state: StudioLiveTransportStatus["state"] = recoverable ? "error" : "revoked";
  this.emitStatus({ state, message, recoverable } as StudioLiveTransportStatus);
  if (!this.everJoined) {
    this.failInitialConnect(message);
  }
  if (recoverable && this.everJoined) {
    this.scheduleJoinRetry(code === "rate_limited" ? JOIN_RATE_LIMIT_RETRY_MS : 0);
  }
  if (!recoverable || (code && isNonRecoverable(code))) {
    this.accessRevoked = true;
    this.clearCrdtReconnectTimeout();
    clearStudioLiveLockRevisionState(this.lockRevisions);
    this.scrubCredentials();
    this.socket.disconnect();
  }
}

export function failInitialConnect(this: StudioLiveSocketTransportHost, message: string): void {
  if (!this.connectPromise) return;
  this.clearConnectTimeout();
  this.rejectConnect?.(new Error(message));
  this.clearConnectDeferred();
}

export function handleFailure(this: StudioLiveSocketTransportHost, failure: ServerFailure, source: "socket" | "operation" = "socket"): void {
  // A work-level operation can be forbidden after a role downgrade without revoking view access
  // to the joined room. Only join/socket authentication and explicit access:revoked are terminal.
  const recoverable =
    failure.code !== "unauthenticated" &&
    !(source === "socket" && failure.code === "forbidden");
  this.emitStatus({
    state: recoverable ? "error" : "revoked",
    message: failure.message,
    recoverable,
  } as StudioLiveTransportStatus);
  if (!recoverable) {
    this.revokePendingLockReleases(failure.code, failure.message);
    this.revokePendingLockAcquisitions(failure.code, failure.message);
    this.terminateVoiceIntent("revoked", failure.message);
    ++this.joinGeneration;
    this.accessRevoked = true;
    this.joined = false;
    this.selectedCrdtWireFormat = null;
    this.clearCrdtWireSelectionTimeout();
    this.clearCrdtReconnectTimeout();
    this.clearJoinRetry(true);
    this.pendingInitialSnapshot = null;
    this.pendingPresenceByConnection.clear();
    this.pendingScreenByConnection.clear();
    this.pendingVoiceByConnection.clear();
    this.pendingLockDeltas.length = 0;
    this.pendingLockDeltaOverflowed = false;
    clearStudioLiveLockRevisionState(this.lockRevisions);
    this.scrubCredentials();
    this.socket.disconnect();
  }
}

export function scrubCredentials(this: StudioLiveSocketTransportHost): void {
  this.cancelPendingVoiceAdmission({
    emitRemoval: false,
    preserveIntent: false,
    sendLeave: false,
  });
  ++this.voiceIntentGeneration;
  this.desiredVoiceCallId = null;
  this.socket.auth = {};
  this.sessionToken = null;
}

export function flushInitialSnapshot(this: StudioLiveSocketTransportHost): boolean {
  const snapshot = this.pendingInitialSnapshot;
  if (!snapshot || !this.ready) return false;
  this.pendingInitialSnapshot = null;
  if (this.pendingLockDeltaOverflowed) {
    this.restartJoinAfterUnsafeSnapshot();
    return false;
  }
  const pendingLockDeltas = this.pendingLockDeltas.splice(0);
  const reconciled = this.reconcilePendingPresence(snapshot);
  const revisioned =
    reconciled.lockRevisionVersion === STUDIO_LIVE_LOCK_REVISION_VERSION;
  if (
    (revisioned && pendingLockDeltas.some((delta) => delta.revision === undefined)) ||
    (!revisioned &&
      studioLiveLockDeltasRequireResync(reconciled.locks, pendingLockDeltas))
  ) {
    this.restartJoinAfterUnsafeSnapshot();
    return false;
  }
  this.applyParticipants(reconciled.participants);
  this.applyScreenShareSnapshot(reconciled.screenShares);
  this.applyLockSnapshot(reconciled.locks, reconciled.lockSnapshotRevision);
  for (const delta of pendingLockDeltas) {
    if (!this.applyLockDelta(delta)) {
      this.restartJoinAfterUnsafeSnapshot();
      return false;
    }
  }
  this.applyVoiceSnapshot(reconciled.voiceMembers);
  this.clearJoinRetry(true);
  return true;
}

export function restartJoinAfterUnsafeSnapshot(this: StudioLiveSocketTransportHost): void {
  this.revokePendingLockReleases(
    "lock_resync",
    "최신 팀 상태를 다시 확인해야 해 진행 중인 편집 잠금 해제를 종료했습니다."
  );
  this.abandonPendingLockAcquisitionsForResync();
  ++this.joinGeneration;
  this.joined = false;
  this.selectedCrdtWireFormat = null;
  this.clearCrdtWireSelectionTimeout();
  this.pendingInitialSnapshot = null;
  this.pendingPresenceByConnection.clear();
  this.pendingScreenByConnection.clear();
  this.pendingVoiceByConnection.clear();
  this.pendingLockDeltas.length = 0;
  this.pendingLockDeltaOverflowed = false;
  this.emitStatus({
    state: "connecting",
    message: "편집 잠금 변경이 많아 최신 팀 상태를 다시 확인하고 있습니다.",
    recoverable: true,
  });
  this.scheduleJoinRetry();
}

export function scheduleJoinRetry(this: StudioLiveSocketTransportHost, minimumDelayMs = 0): void {
  if (
    this.joinRetryTimeout !== null ||
    this.closed ||
    this.accessRevoked ||
    !this.everJoined ||
    !this.socket.connected ||
    !this.sessionToken
  ) {
    return;
  }
  const delay = Math.max(
    minimumDelayMs,
    Math.min(
      JOIN_RESYNC_RETRY_MAX_MS,
      JOIN_RESYNC_RETRY_BASE_MS * 2 ** Math.min(this.joinRetryAttempt, 8)
    )
  );
  this.joinRetryAttempt += 1;
  const generation = this.joinGeneration;
  this.joinRetryTimeout = this.scheduleTimeout(() => {
    this.joinRetryTimeout = null;
    if (generation !== this.joinGeneration) return;
    this.beginJoin();
  }, delay);
}

export function clearJoinRetry(this: StudioLiveSocketTransportHost, resetAttempt: boolean): void {
  if (this.joinRetryTimeout !== null) this.cancelTimeout(this.joinRetryTimeout);
  this.joinRetryTimeout = null;
  if (resetAttempt) this.joinRetryAttempt = 0;
}

export function emitStatus(this: StudioLiveSocketTransportHost, status: StudioLiveTransportStatus): void {
  this.emitControl({ type: "status", status });
}

export function emitControl(this: StudioLiveSocketTransportHost, event: StudioLiveTransportControlEvent): void {
  for (const listener of this.controlListeners) {
    try {
      listener(event);
    } catch {
      // A broken UI subscriber cannot retain a socket or interrupt access-revocation cleanup.
    }
  }
}

export function clearConnectTimeout(this: StudioLiveSocketTransportHost): void {
  if (this.connectTimeout !== null) this.cancelTimeout(this.connectTimeout);
  this.connectTimeout = null;
}

export function clearConnectDeferred(this: StudioLiveSocketTransportHost): void {
  this.connectPromise = null;
  this.resolveConnect = null;
  this.rejectConnect = null;
}
