/** Implementation helpers for `StudioLiveSocketTransport`; not a public entry. */
import { parseStudioTeamCommentLiveEvent } from "../studio-team-comment-live-event";

import {
  STUDIO_LIVE_CHAT_TEXT_MAX_LENGTH,
  STUDIO_LIVE_ICE_CANDIDATE_MAX_LENGTH,
  STUDIO_LIVE_SDP_MID_MAX_LENGTH,
  STUDIO_LIVE_USERNAME_FRAGMENT_MAX_LENGTH,
  createStudioLiveEnvelope,
  studioLiveStringFitsByteContract,
  type StudioLiveMessageKind,
  type StudioLivePayloadMap,
  type StudioLiveScreenAccessPayload,
  type StudioLiveWebRtcIcePayload,
} from "./studio-live-collaboration-protocol";
import {
  parseScreenAnnouncement,
  parseScreenStop,
} from "./studio-live-socket-connect-error";
import {
  parseStudioLiveGesturePreviewSocketRelay,
} from "./studio-live-socket-connection-factory";
import {
  MAX_CANONICAL_SESSION_TOMBSTONES,
  MAX_PENDING_LOCK_DELTAS,
  MAX_PENDING_PRESENCE_CONNECTIONS,
  MAX_PENDING_SCREEN_CONNECTIONS,
  MAX_PENDING_VOICE_CONNECTIONS,
  type PendingLockDelta,
  type PendingPresenceDelta,
  type PendingScreenDelta,
  type PendingVoiceDelta,
} from "./studio-live-socket-transport-types";
import {
  isRecord,
  nullableString,
  parseParticipant,
  publicParticipant,
  safeSdpString,
  safeString,
  type ServerActiveScreenShare,
  type ServerParticipant,
} from "./studio-live-socket-wire";

import type { StudioLiveSocketTransportHost } from "./studio-live-socket-transport-host";

export function canonicalSessionId(this: StudioLiveSocketTransportHost, transportSessionId: string): string {
  if (transportSessionId === this.context.participant.sessionId) {
    return transportSessionId;
  }
  if (transportSessionId === this.selfConnectionId) {
    return this.context.participant.sessionId;
  }
  const participant = this.participants.get(transportSessionId);
  if (participant) {
    this.rememberCanonicalSession(
      participant.connectionId,
      participant.clientInstanceId,
    );
    const active = this.activeConnectionsByCanonicalSession.get(
      participant.clientInstanceId,
    );
    return active?.size === 1 && active.has(participant.connectionId)
      ? participant.clientInstanceId
      : transportSessionId;
  }
  const canonical =
    this.canonicalSessionByConnection.get(transportSessionId);
  if (!canonical) return transportSessionId;
  const active = this.activeConnectionsByCanonicalSession.get(canonical);
  // A tombstoned connection may be canonicalized only after the last active connection for
  // that identity has left. Otherwise an older tab's leave could remove a newer active tab.
  return active && active.size > 0 ? transportSessionId : canonical;
}

export function transportSessionId(this: StudioLiveSocketTransportHost, canonicalSessionId: string): string | null {
  if (canonicalSessionId === this.context.participant.sessionId) {
    return this.selfConnectionId;
  }
  if (this.participants.has(canonicalSessionId)) return canonicalSessionId;
  const active =
    this.activeConnectionsByCanonicalSession.get(canonicalSessionId);
  if (!active || active.size !== 1) return null;
  return active.values().next().value ?? null;
}

export function onPresenceSnapshot(this: StudioLiveSocketTransportHost, value: unknown) {
  if (!isRecord(value) || value.workId !== this.context.workId || !Array.isArray(value.participants)) {
    return;
  }
  const participants = value.participants.map(parseParticipant);
  if (participants.some((participant) => participant === null)) return;
  if (!this.ready || this.pendingInitialSnapshot) {
    for (const participant of participants as ServerParticipant[]) {
      const delta = { kind: "update" as const, participant };
      this.bufferPresenceDelta(delta);
      if (this.ready) this.stagePresenceDelta(delta);
    }
    return;
  }
  // Older gateway versions broadcast process-local snapshots. Treat them as additive heartbeats
  // so a rolling deployment cannot erase peers discovered through another adapter node.
  for (const participant of participants as ServerParticipant[]) {
    this.applyPresenceUpdate(participant);
  }
}

export function onPresenceUpdate(this: StudioLiveSocketTransportHost, value: unknown) {
  const participant = parseParticipant(value);
  if (!participant) return;
  if (!this.ready || this.pendingInitialSnapshot) {
    const delta = { kind: "update" as const, participant };
    this.bufferPresenceDelta(delta);
    if (this.ready) this.stagePresenceDelta(delta);
    return;
  }
  this.applyPresenceUpdate(participant);
}

export function onPresenceLeave(this: StudioLiveSocketTransportHost, value: unknown) {
  if (!isRecord(value) || !safeString(value.connectionId, 128)) return;
  if (!this.ready || this.pendingInitialSnapshot) {
    const delta = { kind: "leave" as const, connectionId: value.connectionId };
    this.bufferPresenceDelta(delta);
    if (this.ready) this.stagePresenceDelta(delta);
    return;
  }
  this.applyPresenceLeave(value.connectionId);
}

export function applyPresenceLeave(this: StudioLiveSocketTransportHost, connectionId: string): void {
  const participant = this.participants.get(connectionId);
  const voice = this.voiceMemberByConnection.get(connectionId);
  const pendingVoice = this.pendingVoiceByConnection.get(connectionId);
  if (participant) {
    this.rememberCanonicalSession(
      participant.connectionId,
      participant.clientInstanceId,
    );
  }
  this.unindexActiveParticipant(participant);
  this.participants.delete(connectionId);
  this.activeScreenShareByConnection.delete(connectionId);
  this.shareIdByConnection.delete(connectionId);
  this.voiceMemberByConnection.delete(connectionId);
  this.pendingVoiceByConnection.delete(connectionId);
  if (!participant || participant.connectionId === this.selfConnectionId) return;
  if (
    voice &&
    !(pendingVoice?.kind === "update" && pendingVoice.member.callId === voice.callId)
  ) {
    this.deliver(participant, "voice:leave", { callId: voice.callId });
  }
  this.deliver(participant, "presence:leave", {});
}

export function applyPresenceUpdate(this: StudioLiveSocketTransportHost, participant: ServerParticipant): void {
  const previous = this.participants.get(participant.connectionId);
  if (previous && Date.parse(previous.updatedAt) > Date.parse(participant.updatedAt)) return;
  this.setActiveParticipant(participant);
  if (participant.connectionId === this.selfConnectionId) return;
  this.deliver(participant, "presence:heartbeat", {
    visibility: participant.state === "active" ? "active" : "idle",
    pageId: participant.pageId,
    tool: participant.tool,
  });
  this.replayPendingVoiceForParticipant(participant);
}

export function bufferPresenceDelta(this: StudioLiveSocketTransportHost, delta: PendingPresenceDelta): void {
  if (this.closed || this.accessRevoked || !this.socket.connected || this.joinGeneration <= 0) {
    return;
  }
  const connectionId = delta.kind === "update"
    ? delta.participant.connectionId
    : delta.connectionId;
  const previous = this.pendingPresenceByConnection.get(connectionId);
  if (
    previous?.kind === "update" && delta.kind === "update" &&
    Date.parse(previous.participant.updatedAt) > Date.parse(delta.participant.updatedAt)
  ) {
    return;
  }
  this.pendingPresenceByConnection.delete(connectionId);
  this.pendingPresenceByConnection.set(connectionId, delta);
  if (this.pendingPresenceByConnection.size <= MAX_PENDING_PRESENCE_CONNECTIONS) return;
  const oldest = this.pendingPresenceByConnection.keys().next().value;
  if (typeof oldest === "string") this.pendingPresenceByConnection.delete(oldest);
}

export function bufferScreenDelta(this: StudioLiveSocketTransportHost, delta: PendingScreenDelta): void {
  if (this.closed || this.accessRevoked || !this.socket.connected || this.joinGeneration <= 0) {
    return;
  }
  const connectionId = delta.kind === "update"
    ? delta.share.connectionId
    : delta.connectionId;
  const previous = this.pendingScreenByConnection.get(connectionId);
  // A delayed stop for an older lifecycle cannot tombstone a newer announcement from the same
  // host while the join ACK is in flight.
  if (
    delta.kind === "stop" &&
    previous?.kind === "update" &&
    previous.share.shareId !== delta.shareId
  ) {
    return;
  }
  this.pendingScreenByConnection.delete(connectionId);
  this.pendingScreenByConnection.set(connectionId, delta);
  if (this.pendingScreenByConnection.size <= MAX_PENDING_SCREEN_CONNECTIONS) return;
  const oldest = this.pendingScreenByConnection.keys().next().value;
  if (typeof oldest === "string") this.pendingScreenByConnection.delete(oldest);
}

export function bufferVoiceDelta(this: StudioLiveSocketTransportHost, delta: PendingVoiceDelta): void {
  if (this.closed || this.accessRevoked || !this.socket.connected || this.joinGeneration <= 0) {
    return;
  }
  const connectionId = delta.kind === "update" ? delta.member.connectionId : delta.connectionId;
  this.pendingVoiceByConnection.delete(connectionId);
  this.pendingVoiceByConnection.set(connectionId, delta);
  if (this.pendingVoiceByConnection.size <= MAX_PENDING_VOICE_CONNECTIONS) return;
  const oldestEntry = this.pendingVoiceByConnection.entries().next().value;
  if (!oldestEntry) return;
  const [oldestConnectionId, oldestDelta] = oldestEntry;
  this.pendingVoiceByConnection.delete(oldestConnectionId);
  const current = this.voiceMemberByConnection.get(oldestConnectionId);
  if (
    oldestDelta.kind === "update" &&
    !this.participants.has(oldestConnectionId) &&
    current?.callId === oldestDelta.member.callId
  ) {
    this.voiceMemberByConnection.delete(oldestConnectionId);
  }
}

export function bufferLockDelta(this: StudioLiveSocketTransportHost, delta: PendingLockDelta): void {
  if (this.closed || this.accessRevoked || !this.socket.connected || this.joinGeneration <= 0) {
    return;
  }
  if (this.pendingLockDeltas.length >= MAX_PENDING_LOCK_DELTAS) {
    // Dropping an earlier fence transition would make the older join snapshot unsafe. Keep the
    // buffer bounded and request a fresh authoritative snapshot when this generation flushes.
    this.pendingLockDeltaOverflowed = true;
    return;
  }
  this.pendingLockDeltas.push(delta);
}

export function replayPendingVoiceForParticipant(this: StudioLiveSocketTransportHost, participant: ServerParticipant): void {
  const pending = this.pendingVoiceByConnection.get(participant.connectionId);
  if (!pending) return;
  if (pending.kind === "leave") {
    const current = this.voiceMemberByConnection.get(participant.connectionId);
    if (current?.callId === pending.callId) {
      this.voiceMemberByConnection.delete(participant.connectionId);
    }
    return;
  }
  this.pendingVoiceByConnection.delete(participant.connectionId);
  const current = this.voiceMemberByConnection.get(participant.connectionId);
  if (!current || current.callId !== pending.member.callId) return;
  if (participant.role === "viewer") {
    this.voiceMemberByConnection.delete(participant.connectionId);
    return;
  }
  this.deliver(participant, "voice:join", {
    callId: current.callId,
    muted: current.muted,
  });
}

export function stagePresenceDelta(this: StudioLiveSocketTransportHost, delta: PendingPresenceDelta): void {
  if (delta.kind === "leave") {
    this.unindexActiveParticipant(
      this.participants.get(delta.connectionId),
    );
    this.participants.delete(delta.connectionId);
    this.activeScreenShareByConnection.delete(delta.connectionId);
    this.shareIdByConnection.delete(delta.connectionId);
    return;
  }
  const previous = this.participants.get(delta.participant.connectionId);
  if (!previous || Date.parse(previous.updatedAt) <= Date.parse(delta.participant.updatedAt)) {
    this.setActiveParticipant(delta.participant);
  }
}

export function onCursor(this: StudioLiveSocketTransportHost, value: unknown) {
  if (!this.ready) return;
  if (
    !isRecord(value) ||
    !safeString(value.connectionId, 128) ||
    !nullableString(value.pageId, 160) ||
    typeof value.x !== "number" ||
    !Number.isFinite(value.x) ||
    value.x < 0 ||
    value.x > 1 ||
    typeof value.y !== "number" ||
    !Number.isFinite(value.y) ||
    value.y < 0 ||
    value.y > 1 ||
    (value.tool !== undefined && !nullableString(value.tool, 48))
  ) {
    return;
  }
  const participant = this.remoteParticipant(value.connectionId);
  if (!participant) return;
  this.deliver(participant, "cursor:update", {
    x: value.x,
    y: value.y,
    pageId: value.pageId,
    tool: value.tool === undefined ? participant.tool : value.tool,
    drawing: typeof value.drawing === "boolean" ? value.drawing : undefined,
    strokeColor: typeof value.strokeColor === "string" ? value.strokeColor : undefined,
    strokeWidth: typeof value.strokeWidth === "number" ? value.strokeWidth : undefined,
    strokeOpacity: typeof value.strokeOpacity === "number" ? value.strokeOpacity : undefined,
    points: Array.isArray(value.points) ? (value.points as number[]) : undefined,
  });
}

export function onGesturePreview(this: StudioLiveSocketTransportHost, value: unknown) {
  if (!this.ready) return;
  const relay = parseStudioLiveGesturePreviewSocketRelay(value);
  if (!relay) return;
  const participant = this.remoteParticipant(relay.connectionId);
  if (!participant) return;
  this.deliver(participant, "preview:gesture", relay.preview);
}

export function onSignal(this: StudioLiveSocketTransportHost, value: unknown) {
  if (!this.ready) return;
  if (
    !isRecord(value) ||
    !safeString(value.fromConnectionId, 128) ||
    !safeString(value.shareId, 160)
  ) {
    return;
  }
  const participant = this.remoteParticipant(value.fromConnectionId);
  const shareId = value.shareId;
  if (!participant) return;
  if (value.kind === "description" && isRecord(value.description)) {
    const type = value.description.type;
    const sdp = value.description.sdp;
    if ((type !== "offer" && type !== "answer") || !safeSdpString(sdp)) return;
    this.deliver(
      participant,
      "webrtc:description",
      { shareId, type, sdp },
      this.context.participant.sessionId
    );
    return;
  }
  if (value.kind === "candidate" && isRecord(value.candidate)) {
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
    ) {
      return;
    }
    const payload: StudioLiveWebRtcIcePayload = {
      shareId,
      candidate: candidate.candidate,
      sdpMid: typeof candidate.sdpMid === "string" ? candidate.sdpMid : null,
      sdpMLineIndex:
        typeof candidate.sdpMLineIndex === "number" ? candidate.sdpMLineIndex : null,
      usernameFragment:
        typeof candidate.usernameFragment === "string" ? candidate.usernameFragment : null,
    };
    this.deliver(participant, "webrtc:ice", payload, this.context.participant.sessionId);
    return;
  }
  if (value.kind === "bye") {
    this.deliver(
      participant,
      "screen:access",
      { shareId, decision: "ended" },
      this.context.participant.sessionId
    );
  }
}

export function onScreenAnnounce(this: StudioLiveSocketTransportHost, value: unknown) {
  const share = parseScreenAnnouncement(value);
  if (!share) return;
  if (!this.ready || this.pendingInitialSnapshot) {
    this.bufferScreenDelta({ kind: "update", share });
    return;
  }
  const participant = this.remoteParticipant(share.connectionId);
  if (!participant) return;
  this.activeScreenShareByConnection.set(share.connectionId, share);
  this.shareIdByConnection.set(share.connectionId, share.shareId);
  this.deliver(participant, "screen:announce", {
    shareId: share.shareId,
    label: share.label,
  });
}

export function onScreenRequest(this: StudioLiveSocketTransportHost, value: unknown) {
  if (!this.ready) return;
  const relay = this.screenRelay(value, false);
  if (!relay) return;
  this.shareIdByConnection.set(relay.participant.connectionId, relay.shareId);
  this.deliver(
    relay.participant,
    "screen:request",
    { shareId: relay.shareId },
    this.context.participant.sessionId
  );
}

export function onScreenAccess(this: StudioLiveSocketTransportHost, value: unknown) {
  if (!this.ready) return;
  const relay = this.screenRelay(value, false);
  if (!relay || !isRecord(value)) return;
  const decision = value.decision;
  if (decision !== "approved" && decision !== "rejected" && decision !== "ended") return;
  this.shareIdByConnection.set(relay.participant.connectionId, relay.shareId);
  const payload: StudioLiveScreenAccessPayload = { shareId: relay.shareId, decision };
  this.deliver(
    relay.participant,
    "screen:access",
    payload,
    this.context.participant.sessionId
  );
}

export function onScreenStop(this: StudioLiveSocketTransportHost, value: unknown) {
  const stopped = parseScreenStop(value);
  if (!stopped) return;
  if (!this.ready || this.pendingInitialSnapshot) {
    this.bufferScreenDelta({ kind: "stop", ...stopped });
    return;
  }
  const participant = this.remoteParticipant(stopped.connectionId);
  if (!participant) return;
  const active = this.activeScreenShareByConnection.get(stopped.connectionId);
  if (active && active.shareId !== stopped.shareId) return;
  this.deliver(participant, "screen:stop", { shareId: stopped.shareId });
  if (active?.shareId === stopped.shareId) {
    this.activeScreenShareByConnection.delete(stopped.connectionId);
  }
  if (this.shareIdByConnection.get(stopped.connectionId) === stopped.shareId) {
    this.shareIdByConnection.delete(stopped.connectionId);
  }
}

export function onChatMessage(this: StudioLiveSocketTransportHost, value: unknown) {
  if (!this.ready) return;
  if (
    !isRecord(value) ||
    !safeString(value.fromConnectionId, 128) ||
    !safeString(value.messageId, 160) ||
    !safeString(value.text, STUDIO_LIVE_CHAT_TEXT_MAX_LENGTH)
  ) {
    return;
  }
  const participant = this.remoteParticipant(value.fromConnectionId);
  if (!participant) return;
  this.deliver(participant, "chat:message", {
    messageId: value.messageId,
    text: value.text,
  });
}

export function onTeamCommentChanged(this: StudioLiveSocketTransportHost, value: unknown) {
  if (!this.ready || this.accessRevoked) return;
  const change = parseStudioTeamCommentLiveEvent(value, this.context.workId);
  if (!change) return;
  this.emitControl({ type: "comment-changed", change });
}

export function applyParticipants(this: StudioLiveSocketTransportHost, nextParticipants: ServerParticipant[]): void {
  const next = new Map(nextParticipants.map((participant) => [participant.connectionId, participant]));
  for (const previous of this.participants.values()) {
    if (previous.connectionId === this.selfConnectionId || next.has(previous.connectionId)) continue;
    this.unindexActiveParticipant(previous);
    const voice = this.voiceMemberByConnection.get(previous.connectionId);
    if (voice) this.deliver(previous, "voice:leave", { callId: voice.callId });
    this.deliver(previous, "presence:leave", {});
    this.activeScreenShareByConnection.delete(previous.connectionId);
    this.shareIdByConnection.delete(previous.connectionId);
    this.voiceMemberByConnection.delete(previous.connectionId);
    this.pendingVoiceByConnection.delete(previous.connectionId);
  }
  this.participants.clear();
  this.activeConnectionsByCanonicalSession.clear();
  for (const participant of next.values()) this.setActiveParticipant(participant);
  for (const participant of next.values()) {
    if (participant.connectionId === this.selfConnectionId) continue;
    this.deliver(participant, "presence:heartbeat", {
      visibility: participant.state === "active" ? "active" : "idle",
      pageId: participant.pageId,
      tool: participant.tool,
    });
    this.replayPendingVoiceForParticipant(participant);
  }
}

export function applyScreenShareSnapshot(this: StudioLiveSocketTransportHost, screenShares: ServerActiveScreenShare[]): void {
  const next = new Map<string, ServerActiveScreenShare>();
  for (const share of screenShares) {
    if (share.connectionId === this.selfConnectionId) continue;
    const participant = this.participants.get(share.connectionId);
    if (!participant?.sharingScreen) continue;
    next.set(share.connectionId, share);
  }

  for (const [connectionId, current] of this.activeScreenShareByConnection) {
    const incoming = next.get(connectionId);
    if (
      incoming?.shareId === current.shareId &&
      incoming.label === current.label
    ) {
      this.shareIdByConnection.set(connectionId, current.shareId);
      next.delete(connectionId);
      continue;
    }
    const participant = this.remoteParticipant(connectionId);
    if (participant) {
      this.deliver(participant, "screen:stop", { shareId: current.shareId });
    }
    this.activeScreenShareByConnection.delete(connectionId);
    if (this.shareIdByConnection.get(connectionId) === current.shareId) {
      this.shareIdByConnection.delete(connectionId);
    }
  }

  for (const share of next.values()) {
    const participant = this.remoteParticipant(share.connectionId);
    if (!participant) continue;
    this.activeScreenShareByConnection.set(share.connectionId, share);
    this.shareIdByConnection.set(share.connectionId, share.shareId);
    this.deliver(participant, "screen:announce", {
      shareId: share.shareId,
      label: share.label,
    });
  }
}

export function validTarget(this: StudioLiveSocketTransportHost, targetSessionId: string | null): string | null {
  if (
    !targetSessionId ||
    targetSessionId === this.selfConnectionId ||
    !this.participants.has(targetSessionId)
  ) {
    return null;
  }
  return targetSessionId;
}

export function remoteParticipant(this: StudioLiveSocketTransportHost, connectionId: string): ServerParticipant | null {
  if (connectionId === this.selfConnectionId) return null;
  return this.participants.get(connectionId) ?? null;
}

export function screenRelay(this: StudioLiveSocketTransportHost,
      value: unknown,
    requireLabel: boolean): { participant: ServerParticipant; shareId: string; label: string } | null {
  if (
    !isRecord(value) ||
    !safeString(value.fromConnectionId, 128) ||
    !safeString(value.shareId, 160) ||
    (requireLabel && !safeString(value.label, 80))
  ) {
    return null;
  }
  const participant = this.remoteParticipant(value.fromConnectionId);
  if (!participant) return null;
  return {
    participant,
    shareId: value.shareId,
    label: requireLabel && typeof value.label === "string" ? value.label : "작업 화면",
  };
}

export function deliver<K extends StudioLiveMessageKind>(this: StudioLiveSocketTransportHost,
      sender: ServerParticipant,
    kind: K,
    payload: StudioLivePayloadMap[K],
    targetSessionId: string | null = null): void {
  if (!this.ready || sender.connectionId === this.selfConnectionId) return;
  this.rememberCanonicalSession(sender.connectionId, sender.clientInstanceId);
  const previous = this.sequenceByConnection.get(sender.connectionId) ?? 0;
  if (previous >= Number.MAX_SAFE_INTEGER) return;
  const sequence = previous + 1;
  this.sequenceByConnection.set(sender.connectionId, sequence);
  try {
    const envelope = createStudioLiveEnvelope({
      workId: this.context.workId,
      sender: publicParticipant(sender),
      sentAt: this.now(),
      sequence,
      kind,
      targetSessionId,
      payload,
    });
    for (const listener of this.listeners) listener(envelope);
  } catch {
    this.emitStatus({
      state: "error",
      message: "팀 서버에서 받은 공동작업 신호를 안전하게 처리하지 못했습니다.",
      recoverable: true,
    });
  }
}

export function rememberCanonicalSession(this: StudioLiveSocketTransportHost,
      connectionId: string,
    canonicalSessionId: string): void {
  this.canonicalSessionByConnection.delete(connectionId);
  this.canonicalSessionByConnection.set(connectionId, canonicalSessionId);
  if (
    this.canonicalSessionByConnection.size <=
    MAX_CANONICAL_SESSION_TOMBSTONES
  ) {
    return;
  }
  const oldest = this.canonicalSessionByConnection.keys().next().value;
  if (typeof oldest === "string") {
    this.canonicalSessionByConnection.delete(oldest);
  }
}

export function setActiveParticipant(this: StudioLiveSocketTransportHost, participant: ServerParticipant): void {
  const previous = this.participants.get(participant.connectionId);
  if (
    previous &&
    previous.clientInstanceId !== participant.clientInstanceId
  ) {
    this.unindexActiveParticipant(previous);
  }
  this.participants.set(participant.connectionId, participant);
  this.rememberCanonicalSession(
    participant.connectionId,
    participant.clientInstanceId,
  );
  const active =
    this.activeConnectionsByCanonicalSession.get(
      participant.clientInstanceId,
    ) ?? new Set<string>();
  active.add(participant.connectionId);
  this.activeConnectionsByCanonicalSession.set(
    participant.clientInstanceId,
    active,
  );
}

export function unindexActiveParticipant(this: StudioLiveSocketTransportHost,
      participant: ServerParticipant | undefined): void {
  if (!participant) return;
  const active = this.activeConnectionsByCanonicalSession.get(
    participant.clientInstanceId,
  );
  if (!active) return;
  active.delete(participant.connectionId);
  if (active.size === 0) {
    this.activeConnectionsByCanonicalSession.delete(
      participant.clientInstanceId,
    );
  }
}
