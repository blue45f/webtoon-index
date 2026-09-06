/** Implementation helpers for `StudioLiveSocketTransport`; not a public entry. */
import {
  STUDIO_LIVE_ICE_CANDIDATE_MAX_LENGTH,
  STUDIO_LIVE_SDP_MID_MAX_LENGTH,
  STUDIO_LIVE_USERNAME_FRAGMENT_MAX_LENGTH,
  studioLiveStringFitsByteContract,
  type StudioLiveVoiceIcePayload,
} from "./studio-live-collaboration-protocol";
import {
  MAX_PENDING_VOICE_SIGNALS,
  type PendingVoiceAdmission,
  type PendingVoiceSignal,
} from "./studio-live-socket-transport-types";
import {
  isRecord,
  nullableString,
  parseFailure,
  parseVoiceMember,
  safeIdentifier,
  safeSdpString,
  safeString,
  type ServerVoiceMember,
} from "./studio-live-socket-wire";

import type { StudioLiveSocketTransportHost } from "./studio-live-socket-transport-host";

export function onVoiceSnapshot(this: StudioLiveSocketTransportHost, value: unknown) {
  if (!isRecord(value) || value.workId !== this.context.workId) return;
  if (!Array.isArray(value.members)) return;
  if (value.callId !== undefined && !safeIdentifier(value.callId, 160)) return;
  const parsed = value.members.map(parseVoiceMember);
  if (parsed.some((member) => member === null)) return;
  if (!this.ready || this.pendingInitialSnapshot) {
    for (const member of parsed as ServerVoiceMember[]) {
      this.bufferVoiceDelta({ kind: "update", member });
    }
    return;
  }
  this.applyVoiceSnapshot(
    parsed as ServerVoiceMember[],
    typeof value.callId === "string" ? value.callId : undefined
  );
}

export function applyVoiceSnapshot(this: StudioLiveSocketTransportHost, members: ServerVoiceMember[], scopeCallId?: string): void {
  const next = new Map(members.map((member) => [member.connectionId, member]));
  for (const [connectionId, pending] of this.pendingVoiceByConnection) {
    if (pending.kind === "leave" && next.get(connectionId)?.callId === pending.callId) {
      next.delete(connectionId);
    }
  }
  const previousByConnection = new Map(this.voiceMemberByConnection);
  for (const previous of previousByConnection.values()) {
    const replacement = next.get(previous.connectionId);
    if (
      replacement?.callId === previous.callId ||
      (scopeCallId !== undefined && previous.callId !== scopeCallId)
    ) {
      continue;
    }
    if (previous.connectionId === this.selfConnectionId) {
      if (scopeCallId === undefined) this.voiceMemberByConnection.delete(previous.connectionId);
      continue;
    }
    const pending = this.pendingVoiceByConnection.get(previous.connectionId);
    const wasPending =
      pending?.kind === "update" && pending.member.callId === previous.callId;
    const participant = this.remoteParticipant(previous.connectionId);
    this.voiceMemberByConnection.delete(previous.connectionId);
    if (pending?.kind === "update" && pending.member.callId === previous.callId) {
      this.pendingVoiceByConnection.delete(previous.connectionId);
    }
    if (!replacement && !participant) {
      this.bufferVoiceDelta({
        kind: "leave",
        connectionId: previous.connectionId,
        callId: previous.callId,
      });
    } else if (participant && participant.role !== "viewer" && !wasPending) {
      this.deliver(participant, "voice:leave", { callId: previous.callId });
    }
  }
  for (const member of next.values()) {
    const previous = previousByConnection.get(member.connectionId);
    const pending = this.pendingVoiceByConnection.get(member.connectionId);
    const wasPending =
      pending?.kind === "update" && pending.member.callId === member.callId;
    if (member.connectionId === this.selfConnectionId) {
      if (this.pendingVoiceAdmission?.callId === member.callId) {
        // Gateways publish a self snapshot immediately before invoking the join ACK. The snapshot
        // is useful for peer discovery, but only the correlated ACK authorizes local signaling.
        continue;
      }
      const authorizedSelf = previousByConnection.get(member.connectionId);
      if (authorizedSelf?.callId !== member.callId) {
        if (this.desiredVoiceCallId !== member.callId) {
          this.bestEffortVoiceLeave(member.callId);
        }
        continue;
      }
      if (this.desiredVoiceCallId !== member.callId) {
        this.voiceMemberByConnection.delete(member.connectionId);
        this.socket.emit("studio:voice:leave", {
          workId: this.context.workId,
          callId: member.callId,
        });
        continue;
      }
      this.voiceMemberByConnection.set(member.connectionId, member);
      this.pendingVoiceByConnection.delete(member.connectionId);
      continue;
    }
    this.voiceMemberByConnection.set(member.connectionId, member);
    const participant = this.remoteParticipant(member.connectionId);
    if (!participant) {
      this.bufferVoiceDelta({ kind: "update", member });
      continue;
    }
    this.pendingVoiceByConnection.delete(member.connectionId);
    if (participant.role === "viewer") {
      this.voiceMemberByConnection.delete(member.connectionId);
      continue;
    }
    if (previous?.callId === member.callId && !wasPending) {
      if (previous.muted !== member.muted) {
        this.deliver(participant, "voice:state", {
          callId: member.callId,
          muted: member.muted,
        });
      }
      continue;
    }
    this.deliver(participant, "voice:join", { callId: member.callId, muted: member.muted });
  }
}

export function onVoiceJoin(this: StudioLiveSocketTransportHost, value: unknown) {
  const member = parseVoiceMember(value);
  if (!member) return;
  if (!this.ready || this.pendingInitialSnapshot) {
    this.bufferVoiceDelta({ kind: "update", member });
    return;
  }
  if (member.connectionId === this.selfConnectionId) {
    if (this.pendingVoiceAdmission?.callId === member.callId) return;
    const authorizedSelf = this.voiceMemberByConnection.get(member.connectionId);
    if (authorizedSelf?.callId !== member.callId) {
      if (this.desiredVoiceCallId !== member.callId) this.bestEffortVoiceLeave(member.callId);
      return;
    }
    if (this.desiredVoiceCallId !== member.callId) {
      this.voiceMemberByConnection.delete(member.connectionId);
      this.socket.emit("studio:voice:leave", {
        workId: this.context.workId,
        callId: member.callId,
      });
      return;
    }
    this.voiceMemberByConnection.set(member.connectionId, member);
    this.pendingVoiceByConnection.delete(member.connectionId);
    return;
  }
  const previous = this.voiceMemberByConnection.get(member.connectionId);
  const pending = this.pendingVoiceByConnection.get(member.connectionId);
  const participant = this.remoteParticipant(member.connectionId);
  this.voiceMemberByConnection.set(member.connectionId, member);
  if (!participant) {
    this.bufferVoiceDelta({ kind: "update", member });
    return;
  }
  this.pendingVoiceByConnection.delete(member.connectionId);
  if (participant.role === "viewer") {
    this.voiceMemberByConnection.delete(member.connectionId);
    return;
  }
  const wasPending =
    pending?.kind === "update" && pending.member.callId === member.callId;
  if (previous?.callId === member.callId && !wasPending) {
    if (previous.muted !== member.muted) {
      this.deliver(participant, "voice:state", {
        callId: member.callId,
        muted: member.muted,
      });
    }
    return;
  }
  if (previous && previous.callId !== member.callId) {
    const previousWasPending =
      pending?.kind === "update" && pending.member.callId === previous.callId;
    if (!previousWasPending) {
      this.deliver(participant, "voice:leave", { callId: previous.callId });
    }
  }
  this.deliver(participant, "voice:join", { callId: member.callId, muted: member.muted });
}

export function onVoiceState(this: StudioLiveSocketTransportHost, value: unknown) {
  const member = parseVoiceMember(value);
  if (!member) return;
  if (!this.ready || this.pendingInitialSnapshot) {
    this.bufferVoiceDelta({ kind: "update", member });
    return;
  }
  const current = this.voiceMemberByConnection.get(member.connectionId);
  const participant = this.remoteParticipant(member.connectionId);
  if (!current || current.callId !== member.callId) {
    if (member.connectionId === this.selfConnectionId) {
      if (this.pendingVoiceAdmission?.callId === member.callId) return;
      return;
    }
    this.voiceMemberByConnection.set(member.connectionId, member);
    if (!participant) {
      this.bufferVoiceDelta({ kind: "update", member });
      return;
    }
    if (participant.role === "viewer") {
      this.voiceMemberByConnection.delete(member.connectionId);
      return;
    }
    this.pendingVoiceByConnection.delete(member.connectionId);
    this.deliver(participant, "voice:join", {
      callId: member.callId,
      muted: member.muted,
    });
    return;
  }
  this.voiceMemberByConnection.set(member.connectionId, member);
  if (member.connectionId === this.selfConnectionId) return;
  if (!participant) {
    this.bufferVoiceDelta({ kind: "update", member });
    return;
  }
  const pending = this.pendingVoiceByConnection.get(member.connectionId);
  this.pendingVoiceByConnection.delete(member.connectionId);
  if (participant.role === "viewer") {
    this.voiceMemberByConnection.delete(member.connectionId);
    return;
  }
  if (pending?.kind === "update" && pending.member.callId === member.callId) {
    this.deliver(participant, "voice:join", { callId: member.callId, muted: member.muted });
    return;
  }
  if (current.muted !== member.muted) {
    this.deliver(participant, "voice:state", { callId: member.callId, muted: member.muted });
  }
}

export function onVoiceLeave(this: StudioLiveSocketTransportHost, value: unknown) {
  if (
    !isRecord(value) ||
    !safeIdentifier(value.connectionId, 128) ||
    !safeIdentifier(value.callId, 160)
  ) return;
  const pendingSelf = this.pendingVoiceAdmission;
  if (
    value.connectionId === this.selfConnectionId &&
    pendingSelf?.callId === value.callId
  ) {
    const serverReason = value.reason;
    const message = serverReason === "revoked"
      ? "작품 권한이 변경되어 음성 작업실에서 나갔습니다."
      : serverReason === "capacity"
        ? "음성 작업실 정원은 최대 6명입니다."
        : "서버에서 음성 작업실 참가 상태를 종료했습니다.";
    this.rejectPendingVoiceAdmission(
      pendingSelf,
      message,
      serverReason === "revoked" ? "revoked" : "rejected"
    );
    return;
  }
  const current = this.voiceMemberByConnection.get(value.connectionId);
  if (
    value.connectionId === this.selfConnectionId &&
    current?.callId === value.callId
  ) {
    this.voiceMemberByConnection.delete(value.connectionId);
    this.pendingVoiceByConnection.delete(value.connectionId);
    ++this.voiceIntentGeneration;
    if (this.desiredVoiceCallId === value.callId) this.desiredVoiceCallId = null;
    const serverReason = value.reason;
    const reason = serverReason === "revoked"
      ? "revoked"
      : serverReason === "capacity"
        ? "rejected"
        : "removed";
    const message = reason === "revoked"
      ? "작품 권한이 변경되어 음성 작업실에서 나갔습니다."
      : reason === "rejected"
        ? "음성 작업실 정원은 최대 6명입니다."
        : "서버에서 음성 작업실 참가 상태를 종료했습니다.";
    this.emitControl({ type: "voice-removed", callId: value.callId, reason, message });
    return;
  }
  if (!this.ready || this.pendingInitialSnapshot) {
    this.bufferVoiceDelta({
      kind: "leave",
      connectionId: value.connectionId,
      callId: value.callId,
    });
    return;
  }
  const participant = this.remoteParticipant(value.connectionId);
  if (current && current.callId !== value.callId) return;
  const pending = this.pendingVoiceByConnection.get(value.connectionId);
  const wasPending =
    pending?.kind === "update" && pending.member.callId === value.callId;
  if (current) this.voiceMemberByConnection.delete(value.connectionId);
  if (!participant) {
    this.bufferVoiceDelta({
      kind: "leave",
      connectionId: value.connectionId,
      callId: value.callId,
    });
    return;
  }
  if (
    (pending?.kind === "update" && pending.member.callId === value.callId) ||
    (pending?.kind === "leave" && pending.callId === value.callId)
  ) {
    this.pendingVoiceByConnection.delete(value.connectionId);
  }
  if (current && participant.role !== "viewer" && !wasPending) {
    this.deliver(participant, "voice:leave", { callId: value.callId });
  }
}

export function onVoiceSignal(this: StudioLiveSocketTransportHost, value: unknown) {
  if (
    !this.ready ||
    !isRecord(value) ||
    !safeIdentifier(value.fromConnectionId, 128) ||
    !safeIdentifier(value.callId, 160)
  ) return;
  const participant = this.remoteParticipant(value.fromConnectionId);
  const remoteVoice = this.voiceMemberByConnection.get(value.fromConnectionId);
  const selfVoice = this.selfConnectionId
    ? this.voiceMemberByConnection.get(this.selfConnectionId)
    : null;
  if (
    !participant ||
    participant.role === "viewer" ||
    !remoteVoice ||
    !selfVoice ||
    remoteVoice.callId !== value.callId ||
    selfVoice.callId !== value.callId
  ) return;
  if (value.kind === "description" && isRecord(value.description)) {
    const type = value.description.type;
    const sdp = value.description.sdp;
    if ((type !== "offer" && type !== "answer") || !safeSdpString(sdp)) return;
    this.deliver(
      participant,
      "voice:description",
      { callId: value.callId, type, sdp },
      this.context.participant.sessionId
    );
    return;
  }
  if (value.kind !== "candidate" || !isRecord(value.candidate)) return;
  const candidate = value.candidate;
  if (
    !safeString(candidate.candidate, STUDIO_LIVE_ICE_CANDIDATE_MAX_LENGTH) ||
    !studioLiveStringFitsByteContract(
      candidate.candidate,
      STUDIO_LIVE_ICE_CANDIDATE_MAX_LENGTH
    ) ||
    !nullableString(candidate.sdpMid ?? null, STUDIO_LIVE_SDP_MID_MAX_LENGTH, true) ||
    !(
      candidate.sdpMLineIndex == null ||
      (typeof candidate.sdpMLineIndex === "number" &&
        Number.isInteger(candidate.sdpMLineIndex) &&
        candidate.sdpMLineIndex >= 0 &&
        candidate.sdpMLineIndex <= 65_535)
    ) ||
    !nullableString(
      candidate.usernameFragment ?? null,
      STUDIO_LIVE_USERNAME_FRAGMENT_MAX_LENGTH,
      true
    )
  ) return;
  const payload: StudioLiveVoiceIcePayload = {
    callId: value.callId,
    candidate: candidate.candidate,
    sdpMid: typeof candidate.sdpMid === "string" ? candidate.sdpMid : null,
    sdpMLineIndex:
      typeof candidate.sdpMLineIndex === "number" ? candidate.sdpMLineIndex : null,
    usernameFragment:
      typeof candidate.usernameFragment === "string" ? candidate.usernameFragment : null,
  };
  this.deliver(participant, "voice:ice", payload, this.context.participant.sessionId);
}

export function isCurrentVoiceAdmission(this: StudioLiveSocketTransportHost, pending: PendingVoiceAdmission): boolean {
  return (
    this.pendingVoiceAdmission === pending &&
    !this.closed &&
    this.ready &&
    pending.joinGeneration === this.joinGeneration &&
    pending.selfConnectionId === this.selfConnectionId &&
    pending.intentGeneration === this.voiceIntentGeneration &&
    pending.callId === this.desiredVoiceCallId
  );
}

export function isAuthorizedVoiceAttempt(this: StudioLiveSocketTransportHost, pending: PendingVoiceAdmission): boolean {
  const selfVoice = this.voiceMemberByConnection.get(pending.selfConnectionId);
  return (
    !this.closed &&
    this.ready &&
    pending.joinGeneration === this.joinGeneration &&
    pending.selfConnectionId === this.selfConnectionId &&
    pending.intentGeneration === this.voiceIntentGeneration &&
    pending.callId === this.desiredVoiceCallId &&
    selfVoice?.callId === pending.callId
  );
}

export function queuePendingVoiceSignal(this: StudioLiveSocketTransportHost,
      pending: PendingVoiceAdmission,
    signal: PendingVoiceSignal): boolean {
  if (!this.isCurrentVoiceAdmission(pending)) return false;
  if (pending.signals.length >= MAX_PENDING_VOICE_SIGNALS) {
    this.rejectPendingVoiceAdmission(
      pending,
      "음성 연결 신호가 너무 많이 대기해 참가를 안전하게 취소했습니다. 다시 참가해 주세요."
    );
    return false;
  }
  pending.signals.push(signal);
  return true;
}

export function completePendingVoiceAdmission(this: StudioLiveSocketTransportHost,
      pending: PendingVoiceAdmission,
    value: unknown): void {
  if (!this.isCurrentVoiceAdmission(pending)) {
    this.cancelTimeout(pending.timeout);
    if (
      this.desiredVoiceCallId !== pending.callId &&
      this.voiceMemberByConnection.get(pending.selfConnectionId)?.callId !== pending.callId
    ) {
      this.bestEffortVoiceLeave(pending.callId);
    }
    return;
  }

  const failure = parseFailure(value);
  if (failure) {
    this.rejectPendingVoiceAdmission(pending, failure.message);
    this.handleFailure(failure, "operation");
    return;
  }
  if (!isRecord(value) || value.ok !== true || !isRecord(value.data)) {
    const message = "팀 서버의 음성 참가 응답을 확인하지 못했습니다.";
    this.rejectPendingVoiceAdmission(pending, message);
    this.emitStatus({ state: "error", message, recoverable: true });
    return;
  }
  let ackMembers: ServerVoiceMember[] | null = [];
  if (value.data.members !== undefined) {
    if (!Array.isArray(value.data.members)) {
      ackMembers = null;
    } else {
      const parsed = value.data.members.map(parseVoiceMember);
      ackMembers = parsed.some((member) => member === null)
        ? null
        : parsed as ServerVoiceMember[];
    }
  }
  if (!ackMembers) {
    const message = "팀 서버의 음성 참가자 목록이 올바르지 않습니다.";
    this.rejectPendingVoiceAdmission(pending, message);
    this.emitStatus({ state: "error", message, recoverable: true });
    return;
  }

  this.cancelTimeout(pending.timeout);
  this.pendingVoiceAdmission = null;
  this.voiceMemberByConnection.set(pending.selfConnectionId, {
    connectionId: pending.selfConnectionId,
    callId: pending.callId,
    muted: pending.muted,
  });
  if (ackMembers.length > 0) this.applyVoiceSnapshot(ackMembers, pending.callId);
  // The admission ACK can describe the mute bit supplied with the original join request while a
  // newer local toggle was queued. Keep the latest local intent, then publish it authoritatively.
  this.voiceMemberByConnection.set(pending.selfConnectionId, {
    connectionId: pending.selfConnectionId,
    callId: pending.callId,
    muted: pending.muted,
  });

  if (pending.muted !== pending.initialMuted) {
    this.emitWithAck(
      "studio:voice:state",
      {
        workId: this.context.workId,
        callId: pending.callId,
        muted: pending.muted,
      },
      undefined,
      (message) => this.rejectSelfVoice(pending.callId, message)
    );
  }
  if (!this.isAuthorizedVoiceAttempt(pending)) {
    pending.signals.length = 0;
    return;
  }
  const signals = pending.signals.splice(0);
  for (const signal of signals) {
    if (!this.isAuthorizedVoiceAttempt(pending)) break;
    const targetVoice = this.voiceMemberByConnection.get(signal.targetConnectionId);
    if (signal.callId !== pending.callId || targetVoice?.callId !== pending.callId) continue;
    this.emitWithAck("studio:voice:signal", signal.payload);
  }
}

export function rejectPendingVoiceAdmission(this: StudioLiveSocketTransportHost,
      pending: PendingVoiceAdmission,
    message: string,
    reason: "rejected" | "revoked" | "removed" = "rejected"): void {
  if (this.pendingVoiceAdmission !== pending) return;
  this.cancelTimeout(pending.timeout);
  this.pendingVoiceAdmission = null;
  pending.signals.length = 0;
  ++this.voiceIntentGeneration;
  if (this.desiredVoiceCallId === pending.callId) this.desiredVoiceCallId = null;
  if (this.voiceMemberByConnection.get(pending.selfConnectionId)?.callId === pending.callId) {
    this.voiceMemberByConnection.delete(pending.selfConnectionId);
  }
  this.emitControl({
    type: "voice-removed",
    callId: pending.callId,
    reason,
    message,
  });
  this.bestEffortVoiceLeave(pending.callId);
}

export function cancelPendingVoiceAdmission(this: StudioLiveSocketTransportHost, options: {
    emitRemoval: boolean;
    preserveIntent: boolean;
    sendLeave: boolean;
    reason?: "rejected" | "revoked" | "removed";
    message?: string;
  }): void {
  const pending = this.pendingVoiceAdmission;
  if (!pending) return;
  this.cancelTimeout(pending.timeout);
  this.pendingVoiceAdmission = null;
  pending.signals.length = 0;
  ++this.voiceIntentGeneration;
  if (!options.preserveIntent && this.desiredVoiceCallId === pending.callId) {
    this.desiredVoiceCallId = null;
  }
  if (this.voiceMemberByConnection.get(pending.selfConnectionId)?.callId === pending.callId) {
    this.voiceMemberByConnection.delete(pending.selfConnectionId);
  }
  if (options.emitRemoval) {
    this.emitControl({
      type: "voice-removed",
      callId: pending.callId,
      reason: options.reason ?? "removed",
      message: options.message ?? "음성 작업실 참가가 취소되었습니다.",
    });
  }
  if (options.sendLeave) this.bestEffortVoiceLeave(pending.callId);
}

export function terminateVoiceIntent(this: StudioLiveSocketTransportHost,
      reason: "rejected" | "revoked" | "removed",
    message: string): void {
  const pending = this.pendingVoiceAdmission;
  const selfConnectionId = this.selfConnectionId;
  const current = selfConnectionId
    ? this.voiceMemberByConnection.get(selfConnectionId)
    : null;
  const callId = pending?.callId ?? current?.callId ?? this.desiredVoiceCallId;
  if (pending) {
    this.cancelPendingVoiceAdmission({
      emitRemoval: false,
      preserveIntent: false,
      sendLeave: false,
    });
  } else {
    ++this.voiceIntentGeneration;
    this.desiredVoiceCallId = null;
  }
  if (selfConnectionId && current) this.voiceMemberByConnection.delete(selfConnectionId);
  if (!callId) return;
  this.emitControl({ type: "voice-removed", callId, reason, message });
  this.bestEffortVoiceLeave(callId);
}

export function bestEffortVoiceLeave(this: StudioLiveSocketTransportHost, callId: string): void {
  if (!this.socket.connected) return;
  this.socket.emit("studio:voice:leave", { workId: this.context.workId, callId });
}

export function rejectSelfVoice(this: StudioLiveSocketTransportHost, callId: string, message: string): void {
  const connectionId = this.selfConnectionId;
  if (!connectionId) return;
  const current = this.voiceMemberByConnection.get(connectionId);
  if (!current || current.callId !== callId) return;
  ++this.voiceIntentGeneration;
  if (this.desiredVoiceCallId === callId) this.desiredVoiceCallId = null;
  this.voiceMemberByConnection.delete(connectionId);
  this.emitControl({
    type: "voice-removed",
    callId,
    reason: "rejected",
    message,
  });
  // The server may have accepted a membership before a later ACK path failed. Best-effort leave
  // prevents an adapter-visible ghost while the local fail-safe immediately stops microphone use.
  this.socket.emit("studio:voice:leave", { workId: this.context.workId, callId });
}
