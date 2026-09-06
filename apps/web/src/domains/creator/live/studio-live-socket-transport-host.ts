import {
  STUDIO_LIVE_CRDT_BINARY_SYNC_EVENT,
  STUDIO_LIVE_CRDT_BINARY_UPDATE_EVENT,
  type StudioCrdtWireFormat,
} from "./studio-crdt-binary-wire";

import type {
  StudioCrdtOperationError,
} from "./studio-crdt-operation-error";
import type {
  StudioCrdtSyncRequest,
  StudioCrdtSyncResponse,
  StudioCrdtTransportMessage,
  StudioCrdtUpdateAck,
  StudioCrdtUpdateRequest,
} from "./studio-crdt-protocol";
import type {
  StudioLiveEnvelope,
  StudioLiveLockAcquireResult,
  StudioLiveLockReleaseRequest,
  StudioLiveLockReleaseResult,
  StudioLiveLockRequest,
  StudioLiveMessageKind,
  StudioLivePayloadMap,
} from "./studio-live-collaboration-protocol";
import type {
  StudioLiveTransportContext,
  StudioLiveTransportControlEvent,
  StudioLiveTransportStatus,
} from "./studio-live-collaboration-transport";
import type {
  StudioLiveInkWireMessage,
} from "./studio-live-ink-protocol";
import type { StudioLiveLockRevisionLedger } from "./studio-live-lock-revision-ledger";
import type {
  StudioLiveSocketLike,
} from "./studio-live-socket-connection-factory";
import type {
  AbandonedLockAcquisition,
  DeferredSelfLock,
  InkInboundWindow,
  PendingLockAcquisition,
  PendingLockDelta,
  PendingLockRelease,
  PendingPresenceDelta,
  PendingScreenDelta,
  PendingVoiceAdmission,
  PendingVoiceDelta,
  PendingVoiceSignal,
} from "./studio-live-socket-transport-types";
import type {
  ServerFailure,
  ServerActiveScreenShare,
  ServerJoinSnapshot,
  ServerLock,
  StudioLiveLockRevision,
  ServerParticipant,
  ServerVoiceMember,
} from "./studio-live-socket-wire";

export interface StudioLiveSocketTransportHost {
  readonly mode: "server";
  readonly crdtFanout: "authoritative";
  readonly context: StudioLiveTransportContext;
  readonly socket: StudioLiveSocketLike;
  readonly now: () => number;
  readonly randomId: () => string;
  readonly scheduleTimeout: (handler: () => void, delay: number) => unknown;
  readonly cancelTimeout: (handle: unknown) => void;
  readonly voiceJoinAckTimeoutMs: number;
  readonly lockAckTimeoutMs: number;
  readonly refreshSocketCredential?: () => Promise<string>;
  readonly listeners: Set<(value: unknown) => void>;
  readonly controlListeners: Set<(event: StudioLiveTransportControlEvent) => void>;
  readonly crdtListeners: Set<(message: StudioCrdtTransportMessage) => void>;
  readonly inkListeners: Set<(value: unknown) => void>;
  readonly inkInboundWindowBySender: Map<string, InkInboundWindow>;
  readonly seenCrdtUpdateIds: Set<string>;
  readonly pendingCrdtPublishes: Map<string, Promise<StudioCrdtUpdateAck>>;
  readonly pendingCrdtOperations: Set<{
    reject: (error: Error) => void;
    timeout: unknown;
  }>;
  readonly pendingLockAcquisitions: Map<string, PendingLockAcquisition>;
  readonly pendingLockRequestByResource: Map<string, string>;
  readonly pendingLockReleases: Map<string, PendingLockRelease>;
  readonly pendingLockReleaseByRequestId: Map<string, PendingLockRelease>;
  readonly deferredSelfLocks: Map<string, DeferredSelfLock>;
  readonly abandonedLockAcquisitions: Map<string, AbandonedLockAcquisition>;
  readonly abandonedLockRequestIdsByResource: Map<string, Set<string>>;
  readonly participants: Map<string, ServerParticipant>;
  readonly canonicalSessionByConnection: Map<string, string>;
  readonly activeConnectionsByCanonicalSession: Map<string, Set<string>>;
  readonly sequenceByConnection: Map<string, number>;
  readonly activeScreenShareByConnection: Map<string, ServerActiveScreenShare>;
  readonly shareIdByConnection: Map<string, string>;
  readonly voiceMemberByConnection: Map<string, ServerVoiceMember>;
  readonly locksByResource: Map<string, ServerLock>;
  readonly lockRevisions: StudioLiveLockRevisionLedger;
  readonly pendingPresenceByConnection: Map<string, PendingPresenceDelta>;
  readonly pendingScreenByConnection: Map<string, PendingScreenDelta>;
  readonly pendingVoiceByConnection: Map<string, PendingVoiceDelta>;
  readonly pendingLockDeltas: PendingLockDelta[];
  pendingLockDeltaOverflowed: boolean;
  sessionToken: string | null;
  selfConnectionId: string | null;
  pendingInitialSnapshot: ServerJoinSnapshot | null;
  joined: boolean;
  closed: boolean;
  accessRevoked: boolean;
  everJoined: boolean;
  lockProtocolVersion: number;
  joinGeneration: number;
  voiceIntentGeneration: number;
  desiredVoiceCallId: string | null;
  pendingVoiceAdmission: PendingVoiceAdmission | null;
  connectPromise: Promise<void> | null;
  resolveConnect: (() => void) | null;
  rejectConnect: ((error: Error) => void) | null;
  connectTimeout: unknown;
  joinRetryTimeout: unknown;
  joinRetryAttempt: number;
  selectedCrdtWireFormat: StudioCrdtWireFormat | null;
  crdtWireSelectionTimeout: unknown;
  crdtReconnectTimeout: unknown;
  credentialRefreshAttempted: boolean;
  credentialRefreshPromise: Promise<void> | null;

  readonly ready: boolean;
  readonly binaryLaneCapabilities: readonly string[];
  canonicalSessionId(transportSessionId: string): string;
  transportSessionId(canonicalSessionId: string): string | null;
  connect(): Promise<void>;
  subscribe(listener: (value: unknown) => void): () => void;
  subscribeControl(listener: (event: StudioLiveTransportControlEvent) => void): () => void;
  subscribeCrdt(listener: (message: StudioCrdtTransportMessage) => void): () => void;
  sendInk(message: StudioLiveInkWireMessage): boolean;
  subscribeInk(listener: (value: unknown) => void): () => void;
  requestCrdtSync(request: StudioCrdtSyncRequest): Promise<StudioCrdtSyncResponse | null>;
  publishCrdtUpdate(request: StudioCrdtUpdateRequest): Promise<StudioCrdtUpdateAck>;
  acquireLock(request: StudioLiveLockRequest): Promise<StudioLiveLockAcquireResult>;
  releaseLock(request: StudioLiveLockReleaseRequest): Promise<StudioLiveLockReleaseResult>;
  send(envelope: StudioLiveEnvelope): boolean;
  close(): void;
  onConnect(): void;
  onConnectError(error: unknown): void;
  refreshCredentialAfterAuthenticationError(fallbackMessage: string): void;
  revokeFromConnectError(message: string): void;
  onDisconnect(reason: unknown): void;
  onServerError(value: unknown): void;
  onAccessRevoked(value: unknown): void;
  onPresenceSnapshot(value: unknown): void;
  onPresenceUpdate(value: unknown): void;
  onPresenceLeave(value: unknown): void;
  applyPresenceLeave(connectionId: string): void;
  applyPresenceUpdate(participant: ServerParticipant): void;
  bufferPresenceDelta(delta: PendingPresenceDelta): void;
  bufferScreenDelta(delta: PendingScreenDelta): void;
  bufferVoiceDelta(delta: PendingVoiceDelta): void;
  bufferLockDelta(delta: PendingLockDelta): void;
  replayPendingVoiceForParticipant(participant: ServerParticipant): void;
  stagePresenceDelta(delta: PendingPresenceDelta): void;
  onCursor(value: unknown): void;
  onGesturePreview(value: unknown): void;
  onLockUpdate(value: unknown): void;
  applyLockDelta(delta: PendingLockDelta): boolean;
  onSignal(value: unknown): void;
  onScreenAnnounce(value: unknown): void;
  onScreenRequest(value: unknown): void;
  onScreenAccess(value: unknown): void;
  onScreenStop(value: unknown): void;
  onVoiceSnapshot(value: unknown): void;
  applyVoiceSnapshot(members: ServerVoiceMember[], scopeCallId?: string): void;
  onVoiceJoin(value: unknown): void;
  onVoiceState(value: unknown): void;
  onVoiceLeave(value: unknown): void;
  onVoiceSignal(value: unknown): void;
  onChatMessage(value: unknown): void;
  onTeamCommentChanged(value: unknown): void;
  onCrdtSync(value: unknown): void;
  onCrdtUpdate(value: unknown): void;
  onCrdtBinaryUpdate(value: unknown): void;
  onInk(value: unknown): void;
  acceptInkInbound(value: Record<string, unknown>, receivedAt: number): boolean;
  beginJoin(): void;
  acceptJoin(snapshot: ServerJoinSnapshot, generation: number): void;
  finishAcceptedJoin(wasJoined: boolean): void;
  selectCrdtBinaryWire(selectionEpoch: string, generation: number, wasJoined: boolean): void;
  reconcilePendingPresence(snapshot: ServerJoinSnapshot): ServerJoinSnapshot;
  failJoin(message: string, recoverable: boolean, code?: string): void;
  failInitialConnect(message: string): void;
  handleFailure(failure: ServerFailure, source?: "socket" | "operation"): void;
  scrubCredentials(): void;
  flushInitialSnapshot(): boolean;
  restartJoinAfterUnsafeSnapshot(): void;
  scheduleJoinRetry(minimumDelayMs?: number): void;
  clearJoinRetry(resetAttempt: boolean): void;
  applyParticipants(nextParticipants: ServerParticipant[]): void;
  applyScreenShareSnapshot(screenShares: ServerActiveScreenShare[]): void;
  applyLockSnapshot(locks: ServerLock[], snapshotRevision: StudioLiveLockRevision | null): void;
  applyAuthoritativeLock(lock: ServerLock, requestId?: string, allowNewSelfFence?: boolean): void;
  applyAuthoritativeRelease(resource: string, claimId: string): void;
  validTarget(targetSessionId: string | null): string | null;
  remoteParticipant(connectionId: string): ServerParticipant | null;
  screenRelay(value: unknown, requireLabel: boolean): { participant: ServerParticipant; shareId: string; label: string } | null;
  deliver<K extends StudioLiveMessageKind>(sender: ServerParticipant, kind: K, payload: StudioLivePayloadMap[K], targetSessionId?: string | null): void;
  rememberCanonicalSession(connectionId: string, canonicalSessionId: string): void;
  setActiveParticipant(participant: ServerParticipant): void;
  unindexActiveParticipant(participant: ServerParticipant | undefined): void;
  isCurrentVoiceAdmission(pending: PendingVoiceAdmission): boolean;
  isAuthorizedVoiceAttempt(pending: PendingVoiceAdmission): boolean;
  queuePendingVoiceSignal(pending: PendingVoiceAdmission, signal: PendingVoiceSignal): boolean;
  completePendingVoiceAdmission(pending: PendingVoiceAdmission, value: unknown): void;
  rejectPendingVoiceAdmission(pending: PendingVoiceAdmission, message: string, reason?: "rejected" | "revoked" | "removed"): void;
  cancelPendingVoiceAdmission(options: {
    emitRemoval: boolean;
    preserveIntent: boolean;
    sendLeave: boolean;
    reason?: "rejected" | "revoked" | "removed";
    message?: string;
  }): void;
  terminateVoiceIntent(reason: "rejected" | "revoked" | "removed", message: string): void;
  bestEffortVoiceLeave(callId: string): void;
  completePendingLockAcquisition(pending: PendingLockAcquisition, value: unknown): void;
  parseLockAcquisitionSuccess(pending: PendingLockAcquisition, value: unknown, ignoreRequestId?: boolean, requireRevision?: boolean): ServerLock | null;
  lockAckRequestId(value: unknown): string | null;
  removePendingLockAcquisition(pending: PendingLockAcquisition): boolean;
  rememberAbandonedLockAcquisition(pending: PendingLockAcquisition): AbandonedLockAcquisition;
  forgetAbandonedLockAcquisition(requestId: string): void;
  pruneAbandonedLockAcquisitions(): void;
  findAbandonedLockAcquisition(resource: string, requestId: string | undefined, matchesKnownLease: boolean): AbandonedLockAcquisition | null;
  abandonPendingLockAcquisitionForRelease(resource: string): void;
  completePendingLockRelease(pending: PendingLockRelease, value: unknown): void;
  removePendingLockRelease(pending: PendingLockRelease): boolean;
  revokePendingLockReleases(code: string, message: string): void;
  revokePendingLockAcquisitions(code: string, message: string): void;
  abandonPendingLockAcquisitionsForResync(): void;
  rollbackAbandonedLock(abandoned: AbandonedLockAcquisition, lock: ServerLock): void;
  rollbackDeferredSelfLock(deferred: DeferredSelfLock, fallback?: AbandonedLockAcquisition | null): void;
  settleDeferredSelfLock(resource: string, acceptedLock?: ServerLock | null): void;
  releaseLockFenceBestEffort(lock: ServerLock, requestId: string): void;
  emitWithAck(event: string, payload: Record<string, unknown>, onSuccess?: (data: unknown) => void, onFailure?: (message: string) => void): void;
  rejectSelfVoice(callId: string, message: string): void;
  emitCrdtWithAck<T>(
    event:
      | "studio:crdt:sync"
      | "studio:crdt:update"
      | typeof STUDIO_LIVE_CRDT_BINARY_SYNC_EVENT
      | typeof STUDIO_LIVE_CRDT_BINARY_UPDATE_EVENT,
    payload: unknown,
    parse: (value: unknown, options: { expectedWorkId: string }) => T | null,
    correlation: "requestId" | "updateId",
    failClosed?: boolean,
  ): Promise<T>;
  emitCrdt(message: StudioCrdtTransportMessage): void;
  rememberCrdtUpdateId(updateId: string): void;
  restartAfterCrdtWireFailure(message: string): void;
  rejectPendingCrdtOperations(error: StudioCrdtOperationError): void;
  clearCrdtWireSelectionTimeout(): void;
  clearCrdtReconnectTimeout(): void;
  emitStatus(status: StudioLiveTransportStatus): void;
  emitControl(event: StudioLiveTransportControlEvent): void;
  clearConnectTimeout(): void;
  clearConnectDeferred(): void;
}
