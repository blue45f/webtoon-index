import {
  parseStudioCrdtWireAdvertisement,
  type StudioCrdtWireAdvertisement,
} from "./studio-crdt-binary-wire";
import {
  STUDIO_LIVE_LOCK_REVISION_VERSION,
  STUDIO_LIVE_SDP_MAX_LENGTH,
  studioLiveDisplayName,
  studioLiveStringFitsByteContract,
  type StudioLiveParticipant,
} from "./studio-live-collaboration-protocol";

import { studioLiveLockResourcesConflict } from "@/shared/lib/studio-live-lock-resource";

export type ServerRole = StudioLiveParticipant["role"];
export type StudioLiveLockRevision = bigint;

const POSTGRES_BIGINT_MAX = BigInt("9223372036854775807");
const ZERO_LOCK_REVISION = BigInt(0);
const POSTGRES_BIGINT_MAX_DECIMAL_DIGITS = 19;
const CANONICAL_UNSIGNED_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;

export interface ServerParticipant {
  connectionId: string;
  clientInstanceId: string;
  name: string;
  role: ServerRole;
  state: "active" | "idle" | "away";
  pageId: string | null;
  tool: string | null;
  sharingScreen: boolean;
  updatedAt: string;
}

export interface ServerLock {
  resourceId: string;
  leaseId: string;
  ownerConnectionId: string;
  ownerName: string;
  expiresAt: string;
  /** Null only when a legacy gateway omitted the additive lock-revision contract. */
  revision: StudioLiveLockRevision | null;
}

export interface ServerVoiceMember {
  connectionId: string;
  callId: string;
  muted: boolean;
}

export interface ServerActiveScreenShare {
  connectionId: string;
  shareId: string;
  label: string;
}

export interface ServerJoinSnapshot {
  /** Missing on v1 gateways; new clients retain their legacy wire behavior in that case. */
  lockProtocolVersion: number;
  /** Zero is the local legacy sentinel; revision-aware gateways advertise the exact v1 contract. */
  lockRevisionVersion: 0 | typeof STUDIO_LIVE_LOCK_REVISION_VERSION;
  /** Null only for a legacy snapshot that did not advertise lock revision support. */
  lockSnapshotRevision: StudioLiveLockRevision | null;
  /** Null while a legacy gateway completes a rolling deploy. */
  crdtWireAdvertisement: StudioCrdtWireAdvertisement | null;
  self: ServerParticipant;
  participants: ServerParticipant[];
  locks: ServerLock[];
  voiceMembers: ServerVoiceMember[];
  screenShares: ServerActiveScreenShare[];
}

export interface ServerFailure {
  ok: false;
  code: string;
  message: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasDisallowedControlCharacter(value: string, allowSdpLineEndings = false): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (allowSdpLineEndings && (codePoint === 10 || codePoint === 13)) continue;
    if (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159)) return true;
  }
  return false;
}

export function safeString(value: unknown, maximum: number, allowEmpty = false): value is string {
  if (typeof value !== "string" || value.length > maximum) return false;
  if (hasDisallowedControlCharacter(value)) return false;
  if (allowEmpty) return true;
  return value.trim().length > 0;
}

export function safeIdentifier(value: unknown, maximum: number): value is string {
  return safeString(value, maximum) && value === value.trim();
}

export function nullableString(
  value: unknown,
  maximum: number,
  allowEmpty = false
): value is string | null {
  return value === null || safeString(value, maximum, allowEmpty);
}

export function safeSdpString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= STUDIO_LIVE_SDP_MAX_LENGTH &&
    studioLiveStringFitsByteContract(value, STUDIO_LIVE_SDP_MAX_LENGTH) &&
    value.trim().length > 0 &&
    !hasDisallowedControlCharacter(value, true)
  );
}

export function isRole(value: unknown): value is ServerRole {
  return (
    value === "owner" ||
    value === "admin" ||
    value === "editor" ||
    value === "commenter" ||
    value === "viewer"
  );
}

/** Parses the canonical decimal wire representation of a non-negative PostgreSQL bigint. */
export function parseLockRevision(
  value: unknown,
  options: { allowZero?: boolean } = {}
): StudioLiveLockRevision | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > POSTGRES_BIGINT_MAX_DECIMAL_DIGITS ||
    !CANONICAL_UNSIGNED_DECIMAL_PATTERN.test(value)
  ) {
    return null;
  }
  const revision = BigInt(value);
  if (
    revision > POSTGRES_BIGINT_MAX ||
    (!options.allowZero && revision === ZERO_LOCK_REVISION)
  ) {
    return null;
  }
  return revision;
}

export function parseParticipant(value: unknown): ServerParticipant | null {
  if (
    !isRecord(value) ||
    !safeString(value.connectionId, 128) ||
    !safeString(value.clientInstanceId, 80) ||
    typeof value.name !== "string" ||
    !isRole(value.role) ||
    (value.state !== "active" && value.state !== "idle" && value.state !== "away") ||
    !nullableString(value.pageId, 160) ||
    !nullableString(value.tool, 48) ||
    typeof value.sharingScreen !== "boolean" ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt))
  ) {
    return null;
  }
  return {
    connectionId: value.connectionId,
    clientInstanceId: value.clientInstanceId,
    name: value.name,
    role: value.role,
    state: value.state,
    pageId: value.pageId,
    tool: value.tool,
    sharingScreen: value.sharingScreen,
    updatedAt: value.updatedAt,
  };
}

export function parseLock(
  value: unknown,
  options: { requireRevision?: boolean } = {}
): ServerLock | null {
  if (
    !isRecord(value) ||
    !safeString(value.resourceId, 200) ||
    !safeString(value.leaseId, 80) ||
    !safeString(value.ownerConnectionId, 128) ||
    typeof value.ownerName !== "string" ||
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.expiresAt))
  ) {
    return null;
  }
  const revision = value.revision === undefined ? null : parseLockRevision(value.revision);
  if ((value.revision !== undefined && revision === null) || (options.requireRevision && revision === null)) {
    return null;
  }
  return {
    resourceId: value.resourceId,
    leaseId: value.leaseId,
    ownerConnectionId: value.ownerConnectionId,
    ownerName: value.ownerName,
    expiresAt: value.expiresAt,
    revision,
  };
}

export function parseVoiceMember(value: unknown): ServerVoiceMember | null {
  if (
    !isRecord(value) ||
    !safeIdentifier(value.connectionId, 128) ||
    !safeIdentifier(value.callId, 160) ||
    typeof value.muted !== "boolean"
  ) {
    return null;
  }
  return {
    connectionId: value.connectionId,
    callId: value.callId,
    muted: value.muted,
  };
}

export function parseActiveScreenShare(value: unknown): ServerActiveScreenShare | null {
  if (
    !isRecord(value) ||
    !safeIdentifier(value.connectionId, 128) ||
    !safeIdentifier(value.shareId, 160) ||
    !safeIdentifier(value.label, 80)
  ) {
    return null;
  }
  return {
    connectionId: value.connectionId,
    shareId: value.shareId,
    label: value.label,
  };
}

export function parseFailure(value: unknown): ServerFailure | null {
  if (
    !isRecord(value) ||
    value.ok !== false ||
    !safeString(value.code, 80) ||
    !safeString(value.message, 500)
  ) {
    return null;
  }
  return { ok: false, code: value.code, message: value.message };
}

export function parseJoinAck(value: unknown): ServerJoinSnapshot | ServerFailure | null {
  const failure = parseFailure(value);
  if (failure) return failure;
  if (!isRecord(value) || value.ok !== true || !isRecord(value.data)) return null;
  const self = parseParticipant(value.data.self);
  const lockProtocolVersion = value.data.lockProtocolVersion === undefined
    ? 1
    : value.data.lockProtocolVersion;
  const hasLockRevisionVersion = value.data.lockRevisionVersion !== undefined;
  const hasLockSnapshotRevision = value.data.lockSnapshotRevision !== undefined;
  const revisionAware = hasLockRevisionVersion || hasLockSnapshotRevision;
  const lockRevisionVersion = revisionAware
    ? value.data.lockRevisionVersion
    : 0;
  const lockSnapshotRevision = revisionAware
    ? parseLockRevision(value.data.lockSnapshotRevision, { allowZero: true })
    : null;
  const crdtWireAdvertisement = parseStudioCrdtWireAdvertisement(value.data);
  if (
    !self ||
    typeof lockProtocolVersion !== "number" ||
    !Number.isInteger(lockProtocolVersion) ||
    lockProtocolVersion < 1 ||
    lockProtocolVersion > 100 ||
    (revisionAware &&
      (lockRevisionVersion !== STUDIO_LIVE_LOCK_REVISION_VERSION ||
        lockSnapshotRevision === null)) ||
    crdtWireAdvertisement === false ||
    !Array.isArray(value.data.participants) ||
    !Array.isArray(value.data.locks) ||
    (value.data.voiceMembers !== undefined && !Array.isArray(value.data.voiceMembers)) ||
    (value.data.screenShares !== undefined && !Array.isArray(value.data.screenShares))
  ) {
    return null;
  }
  const participants = value.data.participants.map(parseParticipant);
  const locks = value.data.locks.map((lock) =>
    parseLock(lock, { requireRevision: revisionAware })
  );
  const voiceMembers = Array.isArray(value.data.voiceMembers)
    ? value.data.voiceMembers.map(parseVoiceMember)
    : [];
  const screenShares = Array.isArray(value.data.screenShares)
    ? value.data.screenShares.map(parseActiveScreenShare)
    : [];
  if (
    participants.some((participant) => participant === null) ||
    locks.some((lock) => lock === null) ||
    voiceMembers.some((member) => member === null) ||
    screenShares.some((share) => share === null)
  ) {
    return null;
  }
  const parsedParticipants = participants as ServerParticipant[];
  const participantConnectionIds = new Set(
    parsedParticipants.map((participant) => participant.connectionId)
  );
  const parsedLocks = locks as ServerLock[];
  const lockResourceIds = new Set<string>();
  for (let leftIndex = 0; leftIndex < parsedLocks.length; leftIndex += 1) {
    const left = parsedLocks[leftIndex];
    if (!left) return null;
    if (
      !participantConnectionIds.has(left.ownerConnectionId) ||
      lockResourceIds.has(left.resourceId)
    ) {
      return null;
    }
    lockResourceIds.add(left.resourceId);
    for (let rightIndex = leftIndex + 1; rightIndex < parsedLocks.length; rightIndex += 1) {
      const right = parsedLocks[rightIndex];
      if (
        right &&
        left.ownerConnectionId !== right.ownerConnectionId &&
        studioLiveLockResourcesConflict(left.resourceId, right.resourceId)
      ) {
        return null;
      }
    }
  }
  if (
    revisionAware &&
    parsedLocks.some(
      (lock) => lock.revision === null || lock.revision > lockSnapshotRevision!
    )
  ) {
    return null;
  }
  return {
    lockProtocolVersion,
    lockRevisionVersion: revisionAware ? STUDIO_LIVE_LOCK_REVISION_VERSION : 0,
    lockSnapshotRevision,
    crdtWireAdvertisement,
    self,
    participants: parsedParticipants,
    locks: parsedLocks,
    voiceMembers: voiceMembers as ServerVoiceMember[],
    screenShares: screenShares as ServerActiveScreenShare[],
  };
}

export function publicParticipant(value: ServerParticipant): StudioLiveParticipant {
  return {
    sessionId: value.connectionId,
    displayName: studioLiveDisplayName(value.name, { fallback: "팀원" }),
    role: value.role,
  };
}
