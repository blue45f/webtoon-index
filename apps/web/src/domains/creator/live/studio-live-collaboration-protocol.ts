import { STUDIO_TEAM_ROLES, type StudioTeamRole } from "../studio-team-client";

import {
  STUDIO_LIVE_GESTURE_PREVIEW_KIND,
  STUDIO_LIVE_GESTURE_PREVIEW_MAX_BYTES,
  parseStudioLiveGesturePreviewPayload,
  type StudioLiveGesturePreviewPayload,
} from "./studio-live-gesture-preview";

/**
 * Ephemeral collaboration protocol shared by local BroadcastChannel and future server transports.
 *
 * The protocol deliberately carries no document content, API key, auth token, email, image or
 * captured video. WebRTC SDP/ICE are memory-only signaling records and are bounded separately.
 * Server transports must still authenticate the socket and authorize every work room; accepting a
 * structurally valid envelope is not an authorization decision.
 */
export const STUDIO_LIVE_PROTOCOL_VERSION = 1 as const;
/** Socket lock-control capability negotiated independently from the local envelope version. */
export const STUDIO_LIVE_LOCK_PROTOCOL_VERSION = 2 as const;
export const STUDIO_LIVE_LOCK_REVISION_VERSION = 1 as const;
export const STUDIO_LIVE_MESSAGE_MAX_BYTES = 64 * 1024;
/**
 * Gesture payloads own a strict 64 KiB cap. The envelope needs a small, separately bounded
 * allowance for work/session metadata so a valid maximum-size payload is not rejected merely by
 * transport framing. Every non-preview kind remains on `STUDIO_LIVE_MESSAGE_MAX_BYTES`.
 */
export const STUDIO_LIVE_GESTURE_PREVIEW_ENVELOPE_METADATA_MAX_BYTES = 4 * 1024;
export const STUDIO_LIVE_GESTURE_PREVIEW_ENVELOPE_MAX_BYTES =
  STUDIO_LIVE_GESTURE_PREVIEW_MAX_BYTES
  + STUDIO_LIVE_GESTURE_PREVIEW_ENVELOPE_METADATA_MAX_BYTES;
export const STUDIO_LIVE_MESSAGE_MAX_AGE_MS = 30_000;
export const STUDIO_LIVE_MESSAGE_FUTURE_SKEW_MS = 5_000;
export const STUDIO_LIVE_LOCK_MAX_LEASE_MS = 30_000;

const MAX_ID_LENGTH = 160;
export const STUDIO_LIVE_DISPLAY_NAME_MAX_LENGTH = 80;
const MAX_TOOL_LENGTH = 64;
export const STUDIO_LIVE_RESOURCE_MAX_LENGTH = 200;
const MAX_SHARE_LABEL_LENGTH = 80;
export const STUDIO_LIVE_SDP_MAX_LENGTH = 48 * 1024;
export const STUDIO_LIVE_ICE_CANDIDATE_MAX_LENGTH = 8 * 1024;
export const STUDIO_LIVE_SDP_MID_MAX_LENGTH = 256;
export const STUDIO_LIVE_USERNAME_FRAGMENT_MAX_LENGTH = 256;
export const STUDIO_LIVE_CHAT_TEXT_MAX_LENGTH = 500;

export interface StudioLiveParticipant {
  sessionId: string;
  displayName: string;
  role: StudioTeamRole;
}

export interface StudioLivePresencePayload {
  visibility: "active" | "idle";
  pageId: string | null;
  /** Optional for v1 local-envelope compatibility; server transports may publish active tool here. */
  tool?: string | null;
}

export interface StudioLiveCursorPayload {
  x: number;
  y: number;
  pageId: string | null;
  tool: string | null;
  drawing?: boolean;
  strokeColor?: string;
  strokeWidth?: number;
  strokeOpacity?: number;
  points?: readonly number[];
}

export interface StudioLiveLockClaimPayload {
  resource: string;
  claimId: string;
  leaseUntil: number;
}

export interface StudioLiveLockReleasePayload {
  resource: string;
  claimId: string;
}

/** Authoritative lease returned by either the local arbiter or the authenticated server. */
export interface StudioLiveLockLease {
  resource: string;
  claimId: string;
  owner: StudioLiveParticipant;
  leaseUntil: number;
}

/**
 * One correlated request for an authoritative lock. `requestId` is the client-generated UUID
 * echoed by the server ACK; it is deliberately distinct from the server-owned lease/claim id.
 */
export interface StudioLiveLockRequest {
  resource: string;
  requestId: string;
  /** Exact server lease observed by a heartbeat; omitted for a fresh acquisition lifecycle. */
  renewLeaseId?: string;
  leaseMs: number;
}

export type StudioLiveLockAcquireResult =
  | {
      status: "acquired";
      resource: string;
      requestId: string;
      lock: StudioLiveLockLease;
    }
  | {
      status: "denied";
      resource: string;
      requestId: string;
      code: string;
      message: string;
      lock?: StudioLiveLockLease;
    }
  | {
      status: "timeout";
      resource: string;
      requestId: string;
      message: string;
    }
  | {
      status: "revoked";
      resource: string;
      requestId: string;
      code: string;
      message: string;
    };

export interface StudioLiveLockReleaseRequest {
  resource: string;
  requestId: string;
  claimId: string;
}

export type StudioLiveLockReleaseResult =
  | {
      status: "released";
      resource: string;
      requestId: string;
      claimId: string;
      /** False means the exact fence was already absent; the release intent is still settled. */
      released: boolean;
    }
  | {
      status: "denied";
      resource: string;
      requestId: string;
      claimId: string;
      code: string;
      message: string;
    }
  | {
      status: "timeout";
      resource: string;
      requestId: string;
      claimId: string;
      message: string;
    }
  | {
      status: "revoked";
      resource: string;
      requestId: string;
      claimId: string;
      code: string;
      message: string;
    };

export interface StudioLiveScreenAnnouncePayload {
  shareId: string;
  label: string;
}

export interface StudioLiveScreenRequestPayload {
  shareId: string;
}

export interface StudioLiveScreenAccessPayload {
  shareId: string;
  decision: "approved" | "rejected" | "ended";
}

export interface StudioLiveWebRtcDescriptionPayload {
  shareId: string;
  type: "offer" | "answer";
  sdp: string;
}

export interface StudioLiveWebRtcIcePayload {
  shareId: string;
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment: string | null;
}

export interface StudioLiveScreenStopPayload {
  shareId: string;
}

/** One ephemeral audio huddle within a work room. Voice media itself never crosses this protocol. */
export interface StudioLiveVoiceJoinPayload {
  callId: string;
  muted: boolean;
}

export interface StudioLiveVoiceStatePayload {
  callId: string;
  muted: boolean;
}

export interface StudioLiveVoiceLeavePayload {
  callId: string;
}

export interface StudioLiveVoiceDescriptionPayload {
  callId: string;
  type: "offer" | "answer";
  sdp: string;
}

export interface StudioLiveVoiceIcePayload {
  callId: string;
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment: string | null;
}

/** Ephemeral session chat line. Never persisted to the document, the server DB or storage. */
export interface StudioLiveChatMessagePayload {
  messageId: string;
  text: string;
}

export interface StudioLivePayloadMap {
  "presence:hello": StudioLivePresencePayload;
  "presence:heartbeat": StudioLivePresencePayload;
  "presence:leave": Record<string, never>;
  "cursor:update": StudioLiveCursorPayload;
  "lock:claim": StudioLiveLockClaimPayload;
  "lock:release": StudioLiveLockReleasePayload;
  "screen:announce": StudioLiveScreenAnnouncePayload;
  "screen:request": StudioLiveScreenRequestPayload;
  "screen:access": StudioLiveScreenAccessPayload;
  "webrtc:description": StudioLiveWebRtcDescriptionPayload;
  "webrtc:ice": StudioLiveWebRtcIcePayload;
  "screen:stop": StudioLiveScreenStopPayload;
  "voice:join": StudioLiveVoiceJoinPayload;
  "voice:state": StudioLiveVoiceStatePayload;
  "voice:leave": StudioLiveVoiceLeavePayload;
  "voice:description": StudioLiveVoiceDescriptionPayload;
  "voice:ice": StudioLiveVoiceIcePayload;
  "chat:message": StudioLiveChatMessagePayload;
  "preview:gesture": StudioLiveGesturePreviewPayload;
}

export type StudioLiveMessageKind = keyof StudioLivePayloadMap;

export type StudioLiveEnvelope<K extends StudioLiveMessageKind = StudioLiveMessageKind> = {
  version: typeof STUDIO_LIVE_PROTOCOL_VERSION;
  workId: string;
  sender: StudioLiveParticipant;
  sentAt: number;
  sequence: number;
  kind: K;
  targetSessionId: string | null;
  payload: StudioLivePayloadMap[K];
};

export interface ParseStudioLiveEnvelopeOptions {
  expectedWorkId: string;
  selfSessionId?: string | null;
  now?: number;
}

export class StudioLiveProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioLiveProtocolError";
  }
}

const STUDIO_LIVE_TEXT_ENCODER = new TextEncoder();

export function studioLiveUtf8ByteLength(value: string): number {
  return STUDIO_LIVE_TEXT_ENCODER.encode(value).byteLength;
}

/** Byte length of JSON's escaped string body, excluding the two surrounding quote bytes. */
export function studioLiveJsonEscapedContentByteLength(value: string): number {
  const serialized = JSON.stringify(value);
  return STUDIO_LIVE_TEXT_ENCODER.encode(serialized).byteLength - 2;
}

export function studioLiveStringFitsByteContract(value: string, maximumBytes: number): boolean {
  return (
    studioLiveUtf8ByteLength(value) <= maximumBytes &&
    studioLiveJsonEscapedContentByteLength(value) <= maximumBytes
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const ownKeys = Object.keys(value);
  return ownKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function containsControlCharacter(value: string, allowSdpLineEndings = false): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (allowSdpLineEndings && (code === 10 || code === 13)) continue;
    if (code <= 31 || (code >= 127 && code <= 159)) return true;
  }
  return false;
}

function sanitizeDisplayNamePart(value: unknown): string {
  if (typeof value !== "string") return "";
  let sanitized = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    sanitized += codePoint <= 31 || (codePoint >= 127 && codePoint <= 159) ? " " : character;
  }
  return sanitized.replace(/\s+/gu, " ").trim();
}

function truncateWithoutSplittingSurrogate(value: string, maximumCodeUnits: number): string {
  let result = "";
  for (const character of value) {
    if (result.length + character.length > maximumCodeUnits) break;
    result += character;
  }
  return result.trim();
}

/** Safely adapts profile copy to the stricter ephemeral participant-name contract. */
export function studioLiveDisplayName(
  value: unknown,
  options: { suffix?: string; fallback?: string } = {}
): string {
  const suffix = truncateWithoutSplittingSurrogate(
    sanitizeDisplayNamePart(options.suffix),
    STUDIO_LIVE_DISPLAY_NAME_MAX_LENGTH
  );
  const separator = suffix ? " " : "";
  const maximumBaseLength =
    STUDIO_LIVE_DISPLAY_NAME_MAX_LENGTH - suffix.length - separator.length;
  const preferred = truncateWithoutSplittingSurrogate(
    sanitizeDisplayNamePart(value),
    maximumBaseLength
  );
  const fallback = truncateWithoutSplittingSurrogate(
    sanitizeDisplayNamePart(options.fallback) || "팀원",
    maximumBaseLength
  );
  const base = preferred || fallback;
  if (base) return `${base}${separator}${suffix}`;
  return suffix || "팀원";
}

function exactString(value: unknown, maximum: number, allowEmpty = false): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    !containsControlCharacter(value) &&
    (allowEmpty || (value.length > 0 && value.trim().length > 0))
  );
}

function exactIdentifier(value: unknown, maximum: number): value is string {
  return exactString(value, maximum) && value === value.trim();
}

function exactSdpString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= STUDIO_LIVE_SDP_MAX_LENGTH &&
    studioLiveStringFitsByteContract(value, STUDIO_LIVE_SDP_MAX_LENGTH) &&
    value.length > 0 &&
    value.trim().length > 0 &&
    !containsControlCharacter(value, true)
  );
}

function nullableId(value: unknown): value is string | null {
  return value === null || exactIdentifier(value, MAX_ID_LENGTH);
}

function isRole(value: unknown): value is StudioTeamRole {
  return (
    typeof value === "string" &&
    (STUDIO_TEAM_ROLES as readonly string[]).includes(value)
  );
}

function isParticipant(value: unknown): value is StudioLiveParticipant {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["sessionId", "displayName", "role"]) &&
    exactIdentifier(value.sessionId, MAX_ID_LENGTH) &&
    exactString(value.displayName, STUDIO_LIVE_DISPLAY_NAME_MAX_LENGTH) &&
    isRole(value.role)
  );
}

function isFiniteInteger(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isNormalizedRatio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isPresencePayload(value: unknown): value is StudioLivePresencePayload {
  return (
    isRecord(value) &&
    (hasExactKeys(value, ["visibility", "pageId"]) ||
      hasExactKeys(value, ["visibility", "pageId", "tool"])) &&
    (value.visibility === "active" || value.visibility === "idle") &&
    nullableId(value.pageId) &&
    (value.tool === undefined || value.tool === null || exactIdentifier(value.tool, MAX_TOOL_LENGTH))
  );
}

function isEmptyPayload(value: unknown): value is Record<string, never> {
  return isRecord(value) && hasExactKeys(value, []);
}

const CURSOR_ALLOWED_KEYS = new Set([
  "x",
  "y",
  "pageId",
  "tool",
  "drawing",
  "strokeColor",
  "strokeWidth",
  "strokeOpacity",
  "points",
]);

function isCursorPayload(value: unknown): value is StudioLiveCursorPayload {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (!keys.includes("x") || !keys.includes("y") || !keys.includes("pageId") || !keys.includes("tool")) return false;
  if (!keys.every((k) => CURSOR_ALLOWED_KEYS.has(k))) return false;
  if (!isNormalizedRatio(value.x) || !isNormalizedRatio(value.y)) return false;
  if (!nullableId(value.pageId)) return false;
  if (value.tool !== null && value.tool !== undefined && !exactIdentifier(value.tool, MAX_TOOL_LENGTH)) return false;
  if (value.drawing !== undefined && typeof value.drawing !== "boolean") return false;
  if (value.strokeColor !== undefined && (typeof value.strokeColor !== "string" || value.strokeColor.length > 64)) return false;
  if (value.strokeWidth !== undefined && (typeof value.strokeWidth !== "number" || !Number.isFinite(value.strokeWidth))) return false;
  if (value.strokeOpacity !== undefined && (typeof value.strokeOpacity !== "number" || !Number.isFinite(value.strokeOpacity))) return false;
  if (value.points !== undefined && (!Array.isArray(value.points) || value.points.length > 1024)) return false;
  return true;
}

/** Cheap hot-path validation used before cursor throttling; full envelope/byte validation follows on send. */
export function assertStudioLiveCursorPayload(
  value: unknown
): asserts value is StudioLiveCursorPayload {
  if (!isCursorPayload(value)) {
    throw new StudioLiveProtocolError("유효하지 않은 실시간 협업 메시지입니다.");
  }
}

/**
 * `clearCursor` publishes this sentinel so remotes drop the pointer immediately instead of
 * waiting for presence TTL. A live cursor always names a page or a tool.
 */
export function isStudioLiveCursorCleared(cursor: StudioLiveCursorPayload): boolean {
  return cursor.pageId === null && cursor.tool === null;
}

function isLockClaimPayload(
  value: unknown,
  sentAt: number
): value is StudioLiveLockClaimPayload {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["resource", "claimId", "leaseUntil"]) &&
    exactIdentifier(value.resource, STUDIO_LIVE_RESOURCE_MAX_LENGTH) &&
    exactIdentifier(value.claimId, MAX_ID_LENGTH) &&
    typeof value.leaseUntil === "number" &&
    Number.isSafeInteger(value.leaseUntil) &&
    value.leaseUntil > sentAt &&
    value.leaseUntil <= sentAt + STUDIO_LIVE_LOCK_MAX_LEASE_MS
  );
}

function isLockReleasePayload(value: unknown): value is StudioLiveLockReleasePayload {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["resource", "claimId"]) &&
    exactIdentifier(value.resource, STUDIO_LIVE_RESOURCE_MAX_LENGTH) &&
    exactIdentifier(value.claimId, MAX_ID_LENGTH)
  );
}

function isShareAnnouncePayload(value: unknown): value is StudioLiveScreenAnnouncePayload {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["shareId", "label"]) &&
    exactIdentifier(value.shareId, MAX_ID_LENGTH) &&
    exactIdentifier(value.label, MAX_SHARE_LABEL_LENGTH)
  );
}

function isShareRequestPayload(value: unknown): value is StudioLiveScreenRequestPayload {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["shareId"]) &&
    exactIdentifier(value.shareId, MAX_ID_LENGTH)
  );
}

function isScreenAccessPayload(value: unknown): value is StudioLiveScreenAccessPayload {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["shareId", "decision"]) &&
    exactIdentifier(value.shareId, MAX_ID_LENGTH) &&
    (value.decision === "approved" ||
      value.decision === "rejected" ||
      value.decision === "ended")
  );
}

function isDescriptionPayload(value: unknown): value is StudioLiveWebRtcDescriptionPayload {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["shareId", "type", "sdp"]) &&
    exactIdentifier(value.shareId, MAX_ID_LENGTH) &&
    (value.type === "offer" || value.type === "answer") &&
    exactSdpString(value.sdp)
  );
}

function isIcePayload(value: unknown): value is StudioLiveWebRtcIcePayload {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "shareId",
      "candidate",
      "sdpMid",
      "sdpMLineIndex",
      "usernameFragment",
    ]) &&
    exactIdentifier(value.shareId, MAX_ID_LENGTH) &&
    exactString(
      value.candidate,
      STUDIO_LIVE_ICE_CANDIDATE_MAX_LENGTH,
      true,
    ) &&
    studioLiveStringFitsByteContract(
      value.candidate,
      STUDIO_LIVE_ICE_CANDIDATE_MAX_LENGTH
    ) &&
    (value.sdpMid === null ||
      exactString(value.sdpMid, STUDIO_LIVE_SDP_MID_MAX_LENGTH, true)) &&
    (value.sdpMLineIndex === null ||
      isFiniteInteger(value.sdpMLineIndex, 0, 65_535)) &&
    (value.usernameFragment === null ||
      exactString(value.usernameFragment, STUDIO_LIVE_USERNAME_FRAGMENT_MAX_LENGTH, true))
  );
}

function isScreenStopPayload(value: unknown): value is StudioLiveScreenStopPayload {
  return isShareRequestPayload(value);
}

function isVoiceJoinPayload(value: unknown): value is StudioLiveVoiceJoinPayload {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["callId", "muted"]) &&
    exactIdentifier(value.callId, MAX_ID_LENGTH) &&
    typeof value.muted === "boolean"
  );
}

function isVoiceStatePayload(value: unknown): value is StudioLiveVoiceStatePayload {
  return isVoiceJoinPayload(value);
}

function isVoiceLeavePayload(value: unknown): value is StudioLiveVoiceLeavePayload {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["callId"]) &&
    exactIdentifier(value.callId, MAX_ID_LENGTH)
  );
}

function isVoiceDescriptionPayload(
  value: unknown
): value is StudioLiveVoiceDescriptionPayload {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["callId", "type", "sdp"]) &&
    exactIdentifier(value.callId, MAX_ID_LENGTH) &&
    (value.type === "offer" || value.type === "answer") &&
    exactSdpString(value.sdp)
  );
}

function isVoiceIcePayload(value: unknown): value is StudioLiveVoiceIcePayload {
  if (!isRecord(value)) return false;
  return (
    hasExactKeys(value, [
      "callId",
      "candidate",
      "sdpMid",
      "sdpMLineIndex",
      "usernameFragment",
    ]) &&
    exactIdentifier(value.callId, MAX_ID_LENGTH) &&
    exactString(value.candidate, STUDIO_LIVE_ICE_CANDIDATE_MAX_LENGTH) &&
    studioLiveStringFitsByteContract(
      value.candidate,
      STUDIO_LIVE_ICE_CANDIDATE_MAX_LENGTH
    ) &&
    (value.sdpMid === null ||
      exactString(value.sdpMid, STUDIO_LIVE_SDP_MID_MAX_LENGTH, true)) &&
    (value.sdpMLineIndex === null ||
      isFiniteInteger(value.sdpMLineIndex, 0, 65_535)) &&
    (value.usernameFragment === null ||
      exactString(value.usernameFragment, STUDIO_LIVE_USERNAME_FRAGMENT_MAX_LENGTH, true))
  );
}

function isChatMessagePayload(value: unknown): value is StudioLiveChatMessagePayload {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["messageId", "text"]) &&
    exactIdentifier(value.messageId, MAX_ID_LENGTH) &&
    exactString(value.text, STUDIO_LIVE_CHAT_TEXT_MAX_LENGTH)
  );
}

const MESSAGE_KINDS = new Set<StudioLiveMessageKind>([
  "presence:hello",
  "presence:heartbeat",
  "presence:leave",
  "cursor:update",
  "lock:claim",
  "lock:release",
  "screen:announce",
  "screen:request",
  "screen:access",
  "webrtc:description",
  "webrtc:ice",
  "screen:stop",
  "voice:join",
  "voice:state",
  "voice:leave",
  "voice:description",
  "voice:ice",
  "chat:message",
  STUDIO_LIVE_GESTURE_PREVIEW_KIND,
]);

function isKind(value: unknown): value is StudioLiveMessageKind {
  return typeof value === "string" && MESSAGE_KINDS.has(value as StudioLiveMessageKind);
}

function payloadMatchesKind(
  kind: StudioLiveMessageKind,
  payload: unknown,
  sentAt: number
): boolean {
  switch (kind) {
    case "presence:hello":
    case "presence:heartbeat":
      return isPresencePayload(payload);
    case "presence:leave":
      return isEmptyPayload(payload);
    case "cursor:update":
      return isCursorPayload(payload);
    case "lock:claim":
      return isLockClaimPayload(payload, sentAt);
    case "lock:release":
      return isLockReleasePayload(payload);
    case "screen:announce":
      return isShareAnnouncePayload(payload);
    case "screen:request":
      return isShareRequestPayload(payload);
    case "screen:access":
      return isScreenAccessPayload(payload);
    case "webrtc:description":
      return isDescriptionPayload(payload);
    case "webrtc:ice":
      return isIcePayload(payload);
    case "screen:stop":
      return isScreenStopPayload(payload);
    case "voice:join":
      return isVoiceJoinPayload(payload);
    case "voice:state":
      return isVoiceStatePayload(payload);
    case "voice:leave":
      return isVoiceLeavePayload(payload);
    case "voice:description":
      return isVoiceDescriptionPayload(payload);
    case "voice:ice":
      return isVoiceIcePayload(payload);
    case "chat:message":
      return isChatMessagePayload(payload);
    case "preview:gesture":
      return parseStudioLiveGesturePreviewPayload(payload) !== null;
  }
}

function targetMatchesKind(kind: StudioLiveMessageKind, targetSessionId: string | null): boolean {
  const targeted =
    kind === "screen:request" ||
    kind === "screen:access" ||
    kind === "webrtc:description" ||
    kind === "webrtc:ice" ||
    kind === "voice:description" ||
    kind === "voice:ice";
  return targeted ? targetSessionId !== null : targetSessionId === null;
}

export function studioLiveEnvelopeByteLength(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return null;
    return STUDIO_LIVE_TEXT_ENCODER.encode(serialized).byteLength;
  } catch {
    return null;
  }
}

/**
 * Strictly validates an untrusted transport message. Invalid/replayed/cross-work/untargeted data is
 * rejected before it can mutate presence, lock or WebRTC state.
 */
export function parseStudioLiveEnvelope(
  value: unknown,
  options: ParseStudioLiveEnvelopeOptions
): StudioLiveEnvelope | null {
  const bytes = studioLiveEnvelopeByteLength(value);
  if (bytes === null || !isRecord(value)) return null;
  const maximumBytes = value.kind === STUDIO_LIVE_GESTURE_PREVIEW_KIND
    ? STUDIO_LIVE_GESTURE_PREVIEW_ENVELOPE_MAX_BYTES
    : STUDIO_LIVE_MESSAGE_MAX_BYTES;
  if (bytes > maximumBytes) return null;
  if (
    !hasExactKeys(value, [
      "version",
      "workId",
      "sender",
      "sentAt",
      "sequence",
      "kind",
      "targetSessionId",
      "payload",
    ]) ||
    value.version !== STUDIO_LIVE_PROTOCOL_VERSION ||
    !exactIdentifier(value.workId, MAX_ID_LENGTH) ||
    value.workId !== options.expectedWorkId ||
    !isParticipant(value.sender) ||
    !isFiniteInteger(value.sentAt, 0, Number.MAX_SAFE_INTEGER) ||
    !isFiniteInteger(value.sequence, 1, Number.MAX_SAFE_INTEGER) ||
    !isKind(value.kind) ||
    !nullableId(value.targetSessionId)
  ) {
    return null;
  }

  const now = options.now ?? Date.now();
  if (
    value.sentAt < now - STUDIO_LIVE_MESSAGE_MAX_AGE_MS ||
    value.sentAt > now + STUDIO_LIVE_MESSAGE_FUTURE_SKEW_MS ||
    (options.selfSessionId != null && options.selfSessionId === value.sender.sessionId) ||
    (options.selfSessionId != null &&
      value.targetSessionId !== null &&
      value.targetSessionId !== options.selfSessionId) ||
    !targetMatchesKind(value.kind, value.targetSessionId) ||
    !payloadMatchesKind(value.kind, value.payload, value.sentAt)
  ) {
    return null;
  }

  return value as StudioLiveEnvelope;
}

export interface CreateStudioLiveEnvelopeInput<K extends StudioLiveMessageKind> {
  workId: string;
  sender: StudioLiveParticipant;
  sentAt: number;
  sequence: number;
  kind: K;
  targetSessionId?: string | null;
  payload: StudioLivePayloadMap[K];
}

export function createStudioLiveEnvelope<K extends StudioLiveMessageKind>(
  input: CreateStudioLiveEnvelopeInput<K>
): StudioLiveEnvelope<K> {
  const candidate: StudioLiveEnvelope<K> = {
    version: STUDIO_LIVE_PROTOCOL_VERSION,
    workId: input.workId,
    sender: input.sender,
    sentAt: input.sentAt,
    sequence: input.sequence,
    kind: input.kind,
    targetSessionId: input.targetSessionId ?? null,
    payload: input.payload,
  };
  const parsed = parseStudioLiveEnvelope(candidate, {
    expectedWorkId: input.workId,
    now: input.sentAt,
  });
  if (!parsed) throw new StudioLiveProtocolError("유효하지 않은 실시간 협업 메시지입니다.");
  return candidate;
}

/** Stable, non-secret room name. Work-id collision is still rejected by the envelope parser. */
export function studioLocalLiveChannelName(workId: string): string {
  if (!exactIdentifier(workId, MAX_ID_LENGTH)) {
    throw new StudioLiveProtocolError("유효한 작품 ID가 필요합니다.");
  }
  let hash = 2_166_136_261;
  for (const character of workId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `toonspectrum:studio-live:v${STUDIO_LIVE_PROTOCOL_VERSION}:${(hash >>> 0).toString(16)}`;
}
