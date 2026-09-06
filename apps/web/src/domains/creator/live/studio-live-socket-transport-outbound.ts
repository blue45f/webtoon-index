/** Implementation helpers for `StudioLiveSocketTransport`; not a public entry. */
import {
  createStudioCrdtBinarySyncRequest,
  createStudioCrdtBinaryUpdateRequest,
  parseStudioCrdtBinarySyncResponse,
  parseStudioCrdtBinaryUpdateAck,
  STUDIO_CRDT_BINARY_WIRE_FORMAT,
  STUDIO_LIVE_CRDT_BINARY_SYNC_EVENT,
  STUDIO_LIVE_CRDT_BINARY_UPDATE_EVENT,
} from "./studio-crdt-binary-wire";
import {
  createStudioCrdtPermanentError,
} from "./studio-crdt-operation-error";
import {
  parseStudioCrdtSyncRequest,
  parseStudioCrdtSyncResponse,
  parseStudioCrdtUpdateAck,
  parseStudioCrdtUpdateRequest,
  type StudioCrdtSyncRequest,
  type StudioCrdtSyncResponse,
  type StudioCrdtUpdateAck,
  type StudioCrdtUpdateRequest,
} from "./studio-crdt-protocol";
import {
  STUDIO_LIVE_LOCK_MAX_LEASE_MS,
  STUDIO_LIVE_LOCK_PROTOCOL_VERSION,
  STUDIO_LIVE_RESOURCE_MAX_LENGTH,
  type StudioLiveEnvelope,
  type StudioLiveLockAcquireResult,
  type StudioLiveLockReleaseRequest,
  type StudioLiveLockReleaseResult,
  type StudioLiveLockRequest,
  type StudioLivePayloadMap,
} from "./studio-live-collaboration-protocol";
import {
  eventMessage,
} from "./studio-live-socket-connect-error";
import {
  STUDIO_LIVE_GESTURE_PREVIEW_SOCKET_EVENT,
  STUDIO_LIVE_INK_SOCKET_EVENT,
  type PendingLockAcquisition,
  type PendingLockRelease,
  type PendingVoiceAdmission,
} from "./studio-live-socket-transport-types";
import {
  safeIdentifier,
} from "./studio-live-socket-wire";

import type {
  StudioLiveInkWireMessage,
} from "./studio-live-ink-protocol";
import type { StudioLiveSocketTransportHost } from "./studio-live-socket-transport-host";

/**
 * Sends one pre-validated ink-v2 frame on the negotiated binary lane. Socket.IO carries the
 * {header JSON, payload ArrayBuffer} wire frame natively as binary attachments, so no
 * re-encoding happens here. Fails closed whenever the lane was not negotiated.
 */
export function sendInk(this: StudioLiveSocketTransportHost, message: StudioLiveInkWireMessage): boolean {
  if (
    !this.ready ||
    this.selectedCrdtWireFormat !== STUDIO_CRDT_BINARY_WIRE_FORMAT ||
    message.workId !== this.context.workId
  ) {
    return false;
  }
  try {
    this.socket.emit(STUDIO_LIVE_INK_SOCKET_EVENT, message);
    return true;
  } catch {
    return false;
  }
}

export function requestCrdtSync(this: StudioLiveSocketTransportHost, request: StudioCrdtSyncRequest): Promise<StudioCrdtSyncResponse | null> {
  const parsed = parseStudioCrdtSyncRequest(request, { expectedWorkId: this.context.workId });
  if (!parsed) {
    return Promise.reject(createStudioCrdtPermanentError(
      "invalid_payload",
      "CRDT 동기화 요청이 올바르지 않습니다.",
      "client-validation"
    ));
  }
  if (this.selectedCrdtWireFormat === STUDIO_CRDT_BINARY_WIRE_FORMAT) {
    try {
      return this.emitCrdtWithAck(
        STUDIO_LIVE_CRDT_BINARY_SYNC_EVENT,
        createStudioCrdtBinarySyncRequest(parsed),
        parseStudioCrdtBinarySyncResponse,
        "requestId",
        true
      );
    } catch {
      return Promise.reject(createStudioCrdtPermanentError(
        "invalid_payload",
        "CRDT 상태 벡터를 바이너리 전송 형식으로 구성하지 못했습니다.",
        "client-validation"
      ));
    }
  }
  return this.emitCrdtWithAck(
    "studio:crdt:sync",
    parsed,
    parseStudioCrdtSyncResponse,
    "requestId"
  );
}

export function publishCrdtUpdate(this: StudioLiveSocketTransportHost, request: StudioCrdtUpdateRequest): Promise<StudioCrdtUpdateAck> {
  const parsed = parseStudioCrdtUpdateRequest(request, { expectedWorkId: this.context.workId });
  if (!parsed) {
    return Promise.reject(createStudioCrdtPermanentError(
      "invalid_payload",
      "CRDT 업데이트가 올바르지 않습니다.",
      "client-validation"
    ));
  }
  const pending = this.pendingCrdtPublishes.get(parsed.updateId);
  if (pending) return pending;
  let operation: Promise<StudioCrdtUpdateAck>;
  if (this.selectedCrdtWireFormat === STUDIO_CRDT_BINARY_WIRE_FORMAT) {
    try {
      operation = this.emitCrdtWithAck(
        STUDIO_LIVE_CRDT_BINARY_UPDATE_EVENT,
        createStudioCrdtBinaryUpdateRequest(parsed),
        parseStudioCrdtBinaryUpdateAck,
        "updateId",
        true
      );
    } catch {
      return Promise.reject(createStudioCrdtPermanentError(
        "invalid_payload",
        "CRDT 업데이트를 바이너리 전송 형식으로 구성하지 못했습니다.",
        "client-validation"
      ));
    }
  } else {
    operation = this.emitCrdtWithAck(
      "studio:crdt:update",
      parsed,
      parseStudioCrdtUpdateAck,
      "updateId"
    );
  }
  this.pendingCrdtPublishes.set(parsed.updateId, operation);
  operation.then(
    (ack) => {
      this.pendingCrdtPublishes.delete(parsed.updateId);
      this.rememberCrdtUpdateId(ack.updateId);
    },
    () => this.pendingCrdtPublishes.delete(parsed.updateId)
  );
  return operation;
}

export function acquireLock(this: StudioLiveSocketTransportHost, request: StudioLiveLockRequest): Promise<StudioLiveLockAcquireResult> {
  if (
    !safeIdentifier(request.resource, STUDIO_LIVE_RESOURCE_MAX_LENGTH) ||
    !safeIdentifier(request.requestId, 160) ||
    (request.renewLeaseId !== undefined && !safeIdentifier(request.renewLeaseId, 80)) ||
    !Number.isInteger(request.leaseMs) ||
    request.leaseMs < 5_000 ||
    request.leaseMs > 30_000
  ) {
    return Promise.resolve({
      status: "denied",
      resource: request.resource,
      requestId: request.requestId,
      code: "invalid_request",
      message: "편집 잠금 요청이 올바르지 않습니다.",
    });
  }
  if (!this.ready || this.pendingInitialSnapshot || !this.selfConnectionId) {
    return Promise.resolve({
      status: "revoked",
      resource: request.resource,
      requestId: request.requestId,
      code: this.accessRevoked ? "access_revoked" : "not_ready",
      message: this.accessRevoked
        ? "팀 권한이 해제되어 편집 잠금을 요청할 수 없습니다."
        : "팀 공동작업 연결이 준비되지 않았습니다.",
    });
  }
  if (this.pendingLockReleases.has(request.resource)) {
    return Promise.resolve({
      status: "denied",
      resource: request.resource,
      requestId: request.requestId,
      code: "release_pending",
      message: "이 편집 영역의 이전 잠금을 해제하는 중입니다.",
    });
  }
  if (this.pendingLockReleaseByRequestId.has(request.requestId)) {
    return Promise.resolve({
      status: "denied",
      resource: request.resource,
      requestId: request.requestId,
      code: "duplicate_request_id",
      message: "같은 요청 식별자로 편집 잠금 해제가 이미 진행 중입니다.",
    });
  }
  this.pruneAbandonedLockAcquisitions();
  if (this.abandonedLockAcquisitions.has(request.requestId)) {
    return Promise.resolve({
      status: "denied",
      resource: request.resource,
      requestId: request.requestId,
      code: "duplicate_request_id",
      message: "응답이 지연된 이전 편집 잠금 요청 식별자는 다시 사용할 수 없습니다.",
    });
  }
  const duplicate = this.pendingLockAcquisitions.get(request.requestId);
  if (duplicate) {
    if (duplicate.request.resource === request.resource) return duplicate.promise;
    return Promise.resolve({
      status: "denied",
      resource: request.resource,
      requestId: request.requestId,
      code: "duplicate_request_id",
      message: "같은 편집 잠금 요청 식별자가 이미 사용 중입니다.",
    });
  }
  const pendingRequestId = this.pendingLockRequestByResource.get(request.resource);
  if (pendingRequestId) {
    const pending = this.pendingLockAcquisitions.get(pendingRequestId);
    if (pending) {
      return Promise.resolve({
        status: "denied",
        resource: request.resource,
        requestId: request.requestId,
        code: "duplicate_resource_request",
        message: "같은 편집 영역의 잠금 요청이 이미 진행 중입니다.",
      });
    }
    this.pendingLockRequestByResource.delete(request.resource);
  }

  let resolveResult!: (result: StudioLiveLockAcquireResult) => void;
  const promise = new Promise<StudioLiveLockAcquireResult>((resolve) => {
    resolveResult = resolve;
  });
  const pending: PendingLockAcquisition = {
    request: { ...request },
    joinGeneration: this.joinGeneration,
    selfConnectionId: this.selfConnectionId,
    promise,
    resolve: resolveResult,
    timeout: null,
  };
  this.pendingLockAcquisitions.set(request.requestId, pending);
  this.pendingLockRequestByResource.set(request.resource, request.requestId);
  pending.timeout = this.scheduleTimeout(() => {
    if (!this.removePendingLockAcquisition(pending)) return;
    const abandoned = this.rememberAbandonedLockAcquisition(pending);
    const deferred = this.deferredSelfLocks.get(request.resource);
    if (deferred) this.rollbackDeferredSelfLock(deferred, abandoned);
    pending.resolve({
      status: "timeout",
      resource: request.resource,
      requestId: request.requestId,
      message: "팀 서버의 편집 잠금 응답 시간이 초과되었습니다.",
    });
  }, this.lockAckTimeoutMs);

  try {
    this.socket.emit(
      "studio:lock:request",
      {
        workId: this.context.workId,
        resourceId: request.resource,
        requestId: request.requestId,
        ...(this.lockProtocolVersion >= STUDIO_LIVE_LOCK_PROTOCOL_VERSION
          ? {
              protocolVersion: STUDIO_LIVE_LOCK_PROTOCOL_VERSION,
              ...(request.renewLeaseId ? { renewLeaseId: request.renewLeaseId } : {}),
            }
          : {}),
        leaseMs: request.leaseMs,
      },
      (value: unknown) => this.completePendingLockAcquisition(pending, value)
    );
  } catch (error) {
    if (this.removePendingLockAcquisition(pending)) {
      pending.resolve({
        status: "denied",
        resource: request.resource,
        requestId: request.requestId,
        code: "transport_error",
        message: eventMessage(error, "편집 잠금 요청을 보내지 못했습니다."),
      });
    }
  }
  return promise;
}

export function releaseLock(this: StudioLiveSocketTransportHost, request: StudioLiveLockReleaseRequest): Promise<StudioLiveLockReleaseResult> {
  if (
    !safeIdentifier(request.resource, STUDIO_LIVE_RESOURCE_MAX_LENGTH) ||
    !safeIdentifier(request.requestId, 160) ||
    !safeIdentifier(request.claimId, 80)
  ) {
    return Promise.resolve({
      status: "denied",
      resource: request.resource,
      requestId: request.requestId,
      claimId: request.claimId,
      code: "invalid_request",
      message: "편집 잠금 해제 요청이 올바르지 않습니다.",
    });
  }
  if (!this.ready || this.pendingInitialSnapshot || !this.selfConnectionId) {
    return Promise.resolve({
      status: "revoked",
      resource: request.resource,
      requestId: request.requestId,
      claimId: request.claimId,
      code: this.accessRevoked ? "access_revoked" : "not_ready",
      message: this.accessRevoked
        ? "팀 권한이 해제되어 편집 잠금을 해제할 수 없습니다."
        : "팀 공동작업 연결이 준비되지 않았습니다.",
    });
  }
  const duplicateRequest = this.pendingLockReleaseByRequestId.get(request.requestId);
  if (duplicateRequest) {
    if (
      duplicateRequest.request.resource === request.resource &&
      duplicateRequest.request.claimId === request.claimId
    ) return duplicateRequest.promise;
    return Promise.resolve({
      status: "denied",
      resource: request.resource,
      requestId: request.requestId,
      claimId: request.claimId,
      code: "duplicate_request_id",
      message: "같은 편집 잠금 해제 요청 식별자가 이미 사용 중입니다.",
    });
  }
  const duplicate = this.pendingLockReleases.get(request.resource);
  if (duplicate) {
    if (
      duplicate.request.requestId === request.requestId &&
      duplicate.request.claimId === request.claimId
    ) return duplicate.promise;
    return Promise.resolve({
      status: "denied",
      resource: request.resource,
      requestId: request.requestId,
      claimId: request.claimId,
      code: "release_pending",
      message: "이 편집 영역의 다른 잠금 해제가 이미 진행 중입니다.",
    });
  }
  if (this.pendingLockAcquisitions.has(request.requestId)) {
    return Promise.resolve({
      status: "denied",
      resource: request.resource,
      requestId: request.requestId,
      claimId: request.claimId,
      code: "duplicate_request_id",
      message: "같은 요청 식별자로 편집 잠금 획득이 이미 진행 중입니다.",
    });
  }
  const current = this.locksByResource.get(request.resource);
  if (
    current &&
    (current.ownerConnectionId !== this.selfConnectionId || current.leaseId !== request.claimId)
  ) {
    return Promise.resolve({
      status: "denied",
      resource: request.resource,
      requestId: request.requestId,
      claimId: request.claimId,
      code: "stale_claim",
      message: "이미 변경된 편집 잠금은 이전 임대로 해제할 수 없습니다.",
    });
  }

  let resolveResult!: (result: StudioLiveLockReleaseResult) => void;
  const promise = new Promise<StudioLiveLockReleaseResult>((resolve) => {
    resolveResult = resolve;
  });
  const pending: PendingLockRelease = {
    request: { ...request },
    joinGeneration: this.joinGeneration,
    selfConnectionId: this.selfConnectionId,
    promise,
    resolve: resolveResult,
    timeout: null,
  };
  this.pendingLockReleases.set(request.resource, pending);
  this.pendingLockReleaseByRequestId.set(request.requestId, pending);
  this.abandonPendingLockAcquisitionForRelease(request.resource);
  const releaseTimeoutMs = this.lockProtocolVersion >= STUDIO_LIVE_LOCK_PROTOCOL_VERSION
    ? this.lockAckTimeoutMs
    : Math.max(this.lockAckTimeoutMs, STUDIO_LIVE_LOCK_MAX_LEASE_MS + 250);
  pending.timeout = this.scheduleTimeout(() => {
    if (!this.removePendingLockRelease(pending)) return;
    this.applyAuthoritativeRelease(request.resource, request.claimId);
    pending.resolve({
      status: "timeout",
      resource: request.resource,
      requestId: request.requestId,
      claimId: request.claimId,
      message: "팀 서버의 편집 잠금 해제 응답 시간이 초과되었습니다.",
    });
  }, releaseTimeoutMs);

  try {
    this.socket.emit(
      "studio:lock:release",
      {
        workId: this.context.workId,
        resourceId: request.resource,
        leaseId: request.claimId,
        ...(this.lockProtocolVersion >= STUDIO_LIVE_LOCK_PROTOCOL_VERSION
          ? { requestId: request.requestId }
          : {}),
      },
      (value: unknown) => this.completePendingLockRelease(pending, value)
    );
  } catch (error) {
    if (this.removePendingLockRelease(pending)) {
      this.applyAuthoritativeRelease(request.resource, request.claimId);
      pending.resolve({
        status: "denied",
        resource: request.resource,
        requestId: request.requestId,
        claimId: request.claimId,
        code: "transport_error",
        message: eventMessage(error, "편집 잠금 해제 요청을 보내지 못했습니다."),
      });
    }
  }
  return promise;
}

export function send(this: StudioLiveSocketTransportHost, envelope: StudioLiveEnvelope): boolean {
  if (!this.ready || envelope.workId !== this.context.workId) return false;
  try {
    switch (envelope.kind) {
      case "presence:hello":
      case "presence:heartbeat": {
        const payload = envelope.payload as StudioLivePayloadMap["presence:heartbeat"];
        this.emitWithAck("studio:presence", {
          workId: this.context.workId,
          state: payload.visibility,
          pageId: payload.pageId,
          tool: payload.tool ?? null,
        });
        this.flushInitialSnapshot();
        return true;
      }
      case "presence:leave":
        return true;
      case "cursor:update": {
        const payload = envelope.payload as StudioLivePayloadMap["cursor:update"];
        const cursorData: Record<string, unknown> = {
          workId: this.context.workId,
          pageId: payload.pageId,
          x: payload.x,
          y: payload.y,
        };
        if (payload.drawing !== undefined) {
          cursorData.drawing = payload.drawing;
          if (payload.tool !== undefined) cursorData.tool = payload.tool;
        }
        if (payload.strokeColor !== undefined) cursorData.strokeColor = payload.strokeColor;
        if (payload.strokeWidth !== undefined) cursorData.strokeWidth = payload.strokeWidth;
        if (payload.strokeOpacity !== undefined) cursorData.strokeOpacity = payload.strokeOpacity;
        if (payload.points !== undefined) cursorData.points = [...payload.points];
        this.emitWithAck("studio:cursor", cursorData);
        return true;
      }
      case "preview:gesture": {
        const payload = envelope.payload as StudioLivePayloadMap["preview:gesture"];
        this.emitWithAck(STUDIO_LIVE_GESTURE_PREVIEW_SOCKET_EVENT, {
          workId: this.context.workId,
          preview: payload,
        });
        return true;
      }
      case "lock:claim": {
        const payload = envelope.payload as StudioLivePayloadMap["lock:claim"];
        const leaseMs = Math.max(5_000, Math.min(30_000, payload.leaseUntil - envelope.sentAt));
        const requestId = this.randomId();
        void this.acquireLock({
          resource: payload.resource,
          requestId,
          renewLeaseId: payload.claimId,
          leaseMs,
        });
        return true;
      }
      case "lock:release": {
        const payload = envelope.payload as StudioLivePayloadMap["lock:release"];
        const current = this.locksByResource.get(payload.resource);
        if (!current || current.leaseId !== payload.claimId) return false;
        void this.releaseLock({
          resource: payload.resource,
          requestId: payload.claimId,
          claimId: payload.claimId,
        });
        return true;
      }
      case "screen:announce": {
        const payload = envelope.payload as StudioLivePayloadMap["screen:announce"];
        this.emitWithAck("studio:screen:announce", { workId: this.context.workId, ...payload });
        return true;
      }
      case "screen:request": {
        const payload = envelope.payload as StudioLivePayloadMap["screen:request"];
        const target = this.validTarget(envelope.targetSessionId);
        if (!target) return false;
        this.shareIdByConnection.set(target, payload.shareId);
        this.emitWithAck("studio:screen:request", {
          workId: this.context.workId,
          targetConnectionId: target,
          shareId: payload.shareId,
        });
        return true;
      }
      case "screen:access": {
        const payload = envelope.payload as StudioLivePayloadMap["screen:access"];
        const target = this.validTarget(envelope.targetSessionId);
        if (!target) return false;
        this.shareIdByConnection.set(target, payload.shareId);
        this.emitWithAck("studio:screen:access", {
          workId: this.context.workId,
          targetConnectionId: target,
          shareId: payload.shareId,
          decision: payload.decision,
        });
        return true;
      }
      case "webrtc:description": {
        const payload = envelope.payload as StudioLivePayloadMap["webrtc:description"];
        const target = this.validTarget(envelope.targetSessionId);
        if (!target) return false;
        this.emitWithAck("studio:signal", {
          workId: this.context.workId,
          targetConnectionId: target,
          shareId: payload.shareId,
          kind: "description",
          description: { type: payload.type, sdp: payload.sdp },
        });
        return true;
      }
      case "webrtc:ice": {
        const payload = envelope.payload as StudioLivePayloadMap["webrtc:ice"];
        const target = this.validTarget(envelope.targetSessionId);
        if (!target) return false;
        this.emitWithAck("studio:signal", {
          workId: this.context.workId,
          targetConnectionId: target,
          shareId: payload.shareId,
          kind: "candidate",
          candidate: {
            candidate: payload.candidate,
            sdpMid: payload.sdpMid,
            sdpMLineIndex: payload.sdpMLineIndex,
            usernameFragment: payload.usernameFragment,
          },
        });
        return true;
      }
      case "voice:join": {
        const payload = envelope.payload as StudioLivePayloadMap["voice:join"];
        this.cancelPendingVoiceAdmission({
          emitRemoval: false,
          preserveIntent: false,
          sendLeave: true,
        });
        const intentGeneration = ++this.voiceIntentGeneration;
        this.desiredVoiceCallId = payload.callId;
        const selfConnectionId = this.selfConnectionId;
        if (!selfConnectionId) return false;
        const pending: PendingVoiceAdmission = {
          callId: payload.callId,
          initialMuted: payload.muted,
          muted: payload.muted,
          intentGeneration,
          joinGeneration: this.joinGeneration,
          selfConnectionId,
          signals: [],
          timeout: null,
        };
        this.pendingVoiceAdmission = pending;
        pending.timeout = this.scheduleTimeout(() => {
          this.rejectPendingVoiceAdmission(
            pending,
            "음성 작업실 참가 응답 시간이 초과되었습니다. 다시 참가해 주세요."
          );
        }, this.voiceJoinAckTimeoutMs);
        this.socket.emit(
          "studio:voice:join",
          {
            workId: this.context.workId,
            callId: payload.callId,
            muted: payload.muted,
          },
          (value: unknown) => this.completePendingVoiceAdmission(pending, value)
        );
        return true;
      }
      case "voice:state": {
        const payload = envelope.payload as StudioLivePayloadMap["voice:state"];
        const pending = this.pendingVoiceAdmission;
        if (
          pending &&
          this.isCurrentVoiceAdmission(pending) &&
          pending.callId === payload.callId
        ) {
          pending.muted = payload.muted;
          return true;
        }
        const current = this.selfConnectionId
          ? this.voiceMemberByConnection.get(this.selfConnectionId)
          : null;
        if (!current || current.callId !== payload.callId) return false;
        this.voiceMemberByConnection.set(current.connectionId, { ...current, muted: payload.muted });
        this.emitWithAck(
          "studio:voice:state",
          {
            workId: this.context.workId,
            callId: payload.callId,
            muted: payload.muted,
          },
          undefined,
          (message) => this.rejectSelfVoice(payload.callId, message)
        );
        return true;
      }
      case "voice:leave": {
        const payload = envelope.payload as StudioLivePayloadMap["voice:leave"];
        const pending = this.pendingVoiceAdmission;
        if (pending && pending.callId === payload.callId) {
          this.cancelPendingVoiceAdmission({
            emitRemoval: false,
            preserveIntent: false,
            sendLeave: true,
          });
          return true;
        }
        const current = this.selfConnectionId
          ? this.voiceMemberByConnection.get(this.selfConnectionId)
          : null;
        if (!current || current.callId !== payload.callId) return false;
        ++this.voiceIntentGeneration;
        if (this.desiredVoiceCallId === payload.callId) this.desiredVoiceCallId = null;
        this.voiceMemberByConnection.delete(current.connectionId);
        this.emitWithAck("studio:voice:leave", {
          workId: this.context.workId,
          callId: payload.callId,
        });
        return true;
      }
      case "voice:description": {
        const payload = envelope.payload as StudioLivePayloadMap["voice:description"];
        const target = this.validTarget(envelope.targetSessionId);
        if (!target) return false;
        const targetVoice = this.voiceMemberByConnection.get(target);
        const pending = this.pendingVoiceAdmission;
        if (
          pending &&
          this.isCurrentVoiceAdmission(pending) &&
          pending.callId === payload.callId &&
          targetVoice?.callId === payload.callId
        ) {
          return this.queuePendingVoiceSignal(pending, {
            targetConnectionId: target,
            callId: payload.callId,
            payload: {
              workId: this.context.workId,
              targetConnectionId: target,
              callId: payload.callId,
              kind: "description",
              description: { type: payload.type, sdp: payload.sdp },
            },
          });
        }
        const selfVoice = this.selfConnectionId
          ? this.voiceMemberByConnection.get(this.selfConnectionId)
          : null;
        if (
          !selfVoice ||
          !targetVoice ||
          selfVoice.callId !== payload.callId ||
          targetVoice.callId !== payload.callId
        ) return false;
        this.emitWithAck("studio:voice:signal", {
          workId: this.context.workId,
          targetConnectionId: target,
          callId: payload.callId,
          kind: "description",
          description: { type: payload.type, sdp: payload.sdp },
        });
        return true;
      }
      case "voice:ice": {
        const payload = envelope.payload as StudioLivePayloadMap["voice:ice"];
        const target = this.validTarget(envelope.targetSessionId);
        if (!target) return false;
        const targetVoice = this.voiceMemberByConnection.get(target);
        const pending = this.pendingVoiceAdmission;
        if (
          pending &&
          this.isCurrentVoiceAdmission(pending) &&
          pending.callId === payload.callId &&
          targetVoice?.callId === payload.callId
        ) {
          return this.queuePendingVoiceSignal(pending, {
            targetConnectionId: target,
            callId: payload.callId,
            payload: {
              workId: this.context.workId,
              targetConnectionId: target,
              callId: payload.callId,
              kind: "candidate",
              candidate: {
                candidate: payload.candidate,
                sdpMid: payload.sdpMid,
                sdpMLineIndex: payload.sdpMLineIndex,
                usernameFragment: payload.usernameFragment,
              },
            },
          });
        }
        const selfVoice = this.selfConnectionId
          ? this.voiceMemberByConnection.get(this.selfConnectionId)
          : null;
        if (
          !selfVoice ||
          !targetVoice ||
          selfVoice.callId !== payload.callId ||
          targetVoice.callId !== payload.callId
        ) return false;
        this.emitWithAck("studio:voice:signal", {
          workId: this.context.workId,
          targetConnectionId: target,
          callId: payload.callId,
          kind: "candidate",
          candidate: {
            candidate: payload.candidate,
            sdpMid: payload.sdpMid,
            sdpMLineIndex: payload.sdpMLineIndex,
            usernameFragment: payload.usernameFragment,
          },
        });
        return true;
      }
      case "chat:message": {
        const payload = envelope.payload as StudioLivePayloadMap["chat:message"];
        this.emitWithAck("studio:chat:send", {
          workId: this.context.workId,
          messageId: payload.messageId,
          text: payload.text,
        });
        return true;
      }
      case "screen:stop": {
        const payload = envelope.payload as StudioLivePayloadMap["screen:stop"];
        this.emitWithAck("studio:screen:stop", {
          workId: this.context.workId,
          shareId: payload.shareId,
        });
        for (const [connectionId, shareId] of this.shareIdByConnection) {
          if (shareId === payload.shareId) this.shareIdByConnection.delete(connectionId);
        }
        return true;
      }
    }
  } catch {
    this.emitStatus({
      state: "error",
      message: "팀 서버에 공동작업 메시지를 보내지 못했습니다.",
      recoverable: true,
    });
    return false;
  }
}
