import { STUDIO_LIVE_INK_CAPABILITY } from "./studio-live-ink-protocol";

import type {
  StudioLiveLockAcquireResult,
  StudioLiveLockReleaseRequest,
  StudioLiveLockReleaseResult,
  StudioLiveLockRequest,
} from "./studio-live-collaboration-protocol";
import type { StudioLiveTransportFactory } from "./studio-live-collaboration-transport";
import type { StudioLiveSocketLike } from "./studio-live-socket-connection-factory";
import type {
  ServerActiveScreenShare,
  ServerLock,
  ServerParticipant,
  ServerVoiceMember,
  StudioLiveLockRevision,
} from "./studio-live-socket-wire";

export const STUDIO_LIVE_GESTURE_PREVIEW_SOCKET_EVENT =
  "studio:gesture:preview" as const;
export const STUDIO_LIVE_INK_SOCKET_EVENT = "studio:ink" as const;
export const STUDIO_LIVE_INK_SOCKET_INBOUND_WINDOW_MS = 3_000;
export const STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_PACKETS = 480;
export const STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_BYTES = 4 * 1024 * 1024;
export const STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_SENDERS = 64;

export const CRDT_ACK_TIMEOUT_MS = 10_000;
export const CRDT_WIRE_SELECT_ACK_TIMEOUT_MS = 8_000;
export const LOCK_ACK_TIMEOUT_MS = 10_000;
export const VOICE_JOIN_ACK_TIMEOUT_MS = 10_000;
export const MAX_TOKEN_LENGTH = 8_192;
export const MAX_SEEN_CRDT_UPDATE_IDS = 4_096;
export const MAX_PENDING_PRESENCE_CONNECTIONS = 2_048;
export const MAX_PENDING_SCREEN_CONNECTIONS = 256;
export const MAX_PENDING_VOICE_CONNECTIONS = 256;
export const MAX_PENDING_LOCK_DELTAS = 512;
export const MAX_PENDING_VOICE_SIGNALS = 256;
export const MAX_ABANDONED_LOCK_ACQUISITIONS = 512;
export const MAX_CANONICAL_SESSION_TOMBSTONES = 2_048;
export const ABANDONED_LOCK_ACQUISITION_TTL_MS = 90_000;
export const JOIN_RESYNC_RETRY_BASE_MS = 500;
export const JOIN_RESYNC_RETRY_MAX_MS = 10_000;
export const JOIN_RATE_LIMIT_RETRY_MS = 60_000;

export type PendingPresenceDelta =
  | { kind: "update"; participant: ServerParticipant }
  | { kind: "leave"; connectionId: string };

export type PendingVoiceDelta =
  | { kind: "update"; member: ServerVoiceMember }
  | { kind: "leave"; connectionId: string; callId: string };

export type PendingScreenDelta =
  | { kind: "update"; share: ServerActiveScreenShare }
  | { kind: "stop"; connectionId: string; shareId: string };

export type PendingLockDelta =
  | {
      kind: "acquired";
      lock: ServerLock;
      requestId?: string;
      revision?: StudioLiveLockRevision;
    }
  | {
      kind: "release";
      action: "released" | "expired" | "revoked";
      resourceId: string;
      leaseId: string;
      releaseRequestId: string | null;
      revision?: StudioLiveLockRevision;
    };

export const STUDIO_SOCKET_BINARY_LANES: readonly string[] = Object.freeze([
  STUDIO_LIVE_INK_CAPABILITY,
]);
export const STUDIO_SOCKET_NO_BINARY_LANES: readonly string[] = Object.freeze([]);

export interface InkInboundWindow {
  startedAt: number;
  packetCount: number;
  byteCount: number;
}

export function inkWirePayloadByteLength(value: Record<string, unknown>): number {
  const message = value.message;
  if (!message || typeof message !== "object") return 0;
  const payload = (message as Record<string, unknown>).payload;
  return payload instanceof ArrayBuffer ? payload.byteLength : 0;
}

export interface PendingVoiceSignal {
  targetConnectionId: string;
  callId: string;
  payload: Record<string, unknown>;
}

export interface PendingVoiceAdmission {
  callId: string;
  initialMuted: boolean;
  muted: boolean;
  intentGeneration: number;
  joinGeneration: number;
  selfConnectionId: string;
  signals: PendingVoiceSignal[];
  timeout: unknown;
}

export interface PendingLockAcquisition {
  request: StudioLiveLockRequest;
  joinGeneration: number;
  selfConnectionId: string;
  promise: Promise<StudioLiveLockAcquireResult>;
  resolve: (result: StudioLiveLockAcquireResult) => void;
  timeout: unknown;
}

export interface AbandonedLockAcquisition {
  requestId: string;
  resource: string;
  joinGeneration: number;
  selfConnectionId: string;
  discardAt: number;
}

export interface DeferredSelfLock {
  lock: ServerLock;
  abandonedRequestId: string | null;
}

export interface PendingLockRelease {
  request: StudioLiveLockReleaseRequest;
  joinGeneration: number;
  selfConnectionId: string;
  promise: Promise<StudioLiveLockReleaseResult>;
  resolve: (result: StudioLiveLockReleaseResult) => void;
  timeout: unknown;
}

export interface StudioLiveSocketTransportDependencies {
  createSocket?: (auth: { sessionToken: string }) => StudioLiveSocketLike;
  refreshSocketCredential?: () => Promise<string>;
  socketEndpoint?: string | null;
  createLocalTransport?: StudioLiveTransportFactory;
  now?: () => number;
  randomId?: () => string;
  setTimeout?: (handler: () => void, delay: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  voiceJoinAckTimeoutMs?: number;
  lockAckTimeoutMs?: number;
}
