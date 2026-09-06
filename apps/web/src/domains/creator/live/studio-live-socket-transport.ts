import {
  resolveStudioCloudflareRealtimeOrigin,
} from "../studio-realtime-provider-cloudflare-adapter";

import {
  STUDIO_CRDT_BINARY_WIRE_FORMAT,
  STUDIO_LIVE_CRDT_BINARY_REMOTE_EVENT,
  type StudioCrdtWireFormat,
} from "./studio-crdt-binary-wire";
import {
  createStudioLocalLiveTransport,
  type StudioLiveTransport,
  type StudioLiveTransportContext,
  type StudioLiveTransportControlEvent,
  type StudioLiveTransportFactory,
} from "./studio-live-collaboration-transport";
import {
  createStudioLiveLockRevisionLedger,
} from "./studio-live-lock-revision-ledger";
import { applyStudioLiveP2pOverlay } from "./studio-live-p2p-overlay-transport";
import { createStudioLiveSignalingServerTransportFactory } from "./studio-live-signaling-server-transport";
import {
  applyStudioRealtimePurposeRouting,
  createSocketAtEndpoint,
  defaultClearTimeout,
  defaultCreateSocket,
  defaultRandomId,
  defaultSetTimeout,
  runtimeSocketEndpoint,
  type StudioLiveSocketLike,
} from "./studio-live-socket-connection-factory";
import * as crdt from "./studio-live-socket-transport-crdt";
import * as lifecycle from "./studio-live-socket-transport-lifecycle";
import * as lockApply from "./studio-live-socket-transport-lock-apply";
import * as lockPending from "./studio-live-socket-transport-lock-pending";
import * as outbound from "./studio-live-socket-transport-outbound";
import * as presence from "./studio-live-socket-transport-presence";
import {
  LOCK_ACK_TIMEOUT_MS,
  MAX_TOKEN_LENGTH,
  STUDIO_LIVE_GESTURE_PREVIEW_SOCKET_EVENT,
  STUDIO_LIVE_INK_SOCKET_EVENT,
  STUDIO_SOCKET_BINARY_LANES,
  STUDIO_SOCKET_NO_BINARY_LANES,
  VOICE_JOIN_ACK_TIMEOUT_MS,
  type AbandonedLockAcquisition,
  type DeferredSelfLock,
  type InkInboundWindow,
  type PendingLockAcquisition,
  type PendingLockDelta,
  type PendingLockRelease,
  type PendingPresenceDelta,
  type PendingScreenDelta,
  type PendingVoiceAdmission,
  type PendingVoiceDelta,
  type StudioLiveSocketTransportDependencies,
} from "./studio-live-socket-transport-types";
import * as voice from "./studio-live-socket-transport-voice";
import {
  safeString,
  type ServerActiveScreenShare,
  type ServerJoinSnapshot,
  type ServerLock,
  type ServerParticipant,
  type ServerVoiceMember,
} from "./studio-live-socket-wire";

import type {
  StudioCrdtTransportMessage,
  StudioCrdtUpdateAck,
} from "./studio-crdt-protocol";

export {
  STUDIO_LIVE_SOCKET_RETRY_POLICY,
  applyStudioRealtimePurposeRouting,
  resolveStudioLiveSocketRuntimeEndpoint,
  type StudioLiveSocketLike,
  type StudioLiveSocketRuntimeEnvironment,
  type StudioRealtimePurposeRoutingEnvironment,
} from "./studio-live-socket-connection-factory";

export {
  STUDIO_LIVE_GESTURE_PREVIEW_SOCKET_EVENT,
  STUDIO_LIVE_INK_SOCKET_EVENT,
  STUDIO_LIVE_INK_SOCKET_INBOUND_WINDOW_MS,
  STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_PACKETS,
  STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_BYTES,
  STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_SENDERS,
  type StudioLiveSocketTransportDependencies,
} from "./studio-live-socket-transport-types";

/**
 * Authenticated Socket.IO adapter. The session token exists only in the in-memory Socket.IO auth
 * handshake object and is never copied into protocol envelopes, payload logs or browser storage.
 */
export class StudioLiveSocketTransport implements StudioLiveTransport {
  readonly mode = "server" as const;
  readonly crdtFanout = "authoritative" as const;
  readonly context: StudioLiveTransportContext;
  readonly socket: StudioLiveSocketLike;
  readonly now: () => number;
  readonly randomId: () => string;
  readonly scheduleTimeout: (handler: () => void, delay: number) => unknown;
  readonly cancelTimeout: (handle: unknown) => void;
  readonly voiceJoinAckTimeoutMs: number;
  readonly lockAckTimeoutMs: number;
  readonly refreshSocketCredential?: () => Promise<string>;
  readonly listeners = new Set<(value: unknown) => void>();
  readonly controlListeners = new Set<(event: StudioLiveTransportControlEvent) => void>();
  readonly crdtListeners = new Set<(message: StudioCrdtTransportMessage) => void>();
  readonly inkListeners = new Set<(value: unknown) => void>();
  readonly inkInboundWindowBySender = new Map<string, InkInboundWindow>();
  readonly seenCrdtUpdateIds = new Set<string>();
  readonly pendingCrdtPublishes = new Map<string, Promise<StudioCrdtUpdateAck>>();
  readonly pendingCrdtOperations = new Set<{
    reject: (error: Error) => void;
    timeout: unknown;
  }>();
  readonly pendingLockAcquisitions = new Map<string, PendingLockAcquisition>();
  readonly pendingLockRequestByResource = new Map<string, string>();
  readonly pendingLockReleases = new Map<string, PendingLockRelease>();
  readonly pendingLockReleaseByRequestId = new Map<string, PendingLockRelease>();
  readonly deferredSelfLocks = new Map<string, DeferredSelfLock>();
  readonly abandonedLockAcquisitions = new Map<string, AbandonedLockAcquisition>();
  readonly abandonedLockRequestIdsByResource = new Map<string, Set<string>>();
  readonly participants = new Map<string, ServerParticipant>();
  /**
   * Socket connection ids are intentionally short-lived, while Studio room identity is the
   * authenticated client-instance id. Keep a bounded bridge (including recent leave tombstones)
   * so a hybrid provider can merge Socket.IO and purpose-provider events without rendering one
   * person twice or losing a final leave event after the participant map is pruned.
   */
  readonly canonicalSessionByConnection = new Map<string, string>();
  readonly activeConnectionsByCanonicalSession = new Map<
    string,
    Set<string>
  >();
  readonly sequenceByConnection = new Map<string, number>();
  readonly activeScreenShareByConnection = new Map<
    string,
    ServerActiveScreenShare
  >();
  readonly shareIdByConnection = new Map<string, string>();
  readonly voiceMemberByConnection = new Map<string, ServerVoiceMember>();
  readonly locksByResource = new Map<string, ServerLock>();
  readonly lockRevisions = createStudioLiveLockRevisionLedger();
  readonly pendingPresenceByConnection = new Map<string, PendingPresenceDelta>();
  readonly pendingScreenByConnection = new Map<string, PendingScreenDelta>();
  readonly pendingVoiceByConnection = new Map<string, PendingVoiceDelta>();
  readonly pendingLockDeltas: PendingLockDelta[] = [];
  pendingLockDeltaOverflowed = false;
  sessionToken: string | null;
  selfConnectionId: string | null = null;
  pendingInitialSnapshot: ServerJoinSnapshot | null = null;
  joined = false;
  closed = false;
  accessRevoked = false;
  everJoined = false;
  lockProtocolVersion = 1;
  joinGeneration = 0;
  voiceIntentGeneration = 0;
  desiredVoiceCallId: string | null = null;
  pendingVoiceAdmission: PendingVoiceAdmission | null = null;
  connectPromise: Promise<void> | null = null;
  resolveConnect: (() => void) | null = null;
  rejectConnect: ((error: Error) => void) | null = null;
  connectTimeout: unknown = null;
  joinRetryTimeout: unknown = null;
  joinRetryAttempt = 0;
  selectedCrdtWireFormat: StudioCrdtWireFormat | null = null;
  crdtWireSelectionTimeout: unknown = null;
  crdtReconnectTimeout: unknown = null;
  credentialRefreshAttempted = false;
  credentialRefreshPromise: Promise<void> | null = null;

  constructor(
    context: StudioLiveTransportContext,
    sessionToken: string,
    dependencies: StudioLiveSocketTransportDependencies = {}
  ) {
    if (!safeString(sessionToken, MAX_TOKEN_LENGTH)) {
      throw new Error("실시간 팀 연결에 사용할 로그인 세션이 없습니다.");
    }
    this.context = context;
    this.sessionToken = sessionToken;
    this.now = dependencies.now ?? Date.now;
    this.randomId = dependencies.randomId ?? defaultRandomId;
    this.scheduleTimeout = dependencies.setTimeout ?? defaultSetTimeout;
    this.cancelTimeout = dependencies.clearTimeout ?? defaultClearTimeout;
    this.refreshSocketCredential = dependencies.refreshSocketCredential;
    this.voiceJoinAckTimeoutMs = Math.min(
      30_000,
      Math.max(
        100,
        Math.trunc(dependencies.voiceJoinAckTimeoutMs ?? VOICE_JOIN_ACK_TIMEOUT_MS)
      )
    );
    this.lockAckTimeoutMs = Math.min(
      30_000,
      Math.max(100, Math.trunc(dependencies.lockAckTimeoutMs ?? LOCK_ACK_TIMEOUT_MS))
    );
    this.socket = (dependencies.createSocket ?? defaultCreateSocket)({ sessionToken });
    this.socket.on("connect", this.onConnect);
    this.socket.on("connect_error", this.onConnectError);
    this.socket.on("disconnect", this.onDisconnect);
    this.socket.on("studio:error", this.onServerError);
    this.socket.on("studio:access:revoked", this.onAccessRevoked);
    this.socket.on("studio:presence:snapshot", this.onPresenceSnapshot);
    this.socket.on("studio:presence:update", this.onPresenceUpdate);
    this.socket.on("studio:presence:leave", this.onPresenceLeave);
    this.socket.on("studio:cursor", this.onCursor);
    this.socket.on(
      STUDIO_LIVE_GESTURE_PREVIEW_SOCKET_EVENT,
      this.onGesturePreview
    );
    this.socket.on("studio:lock:update", this.onLockUpdate);
    this.socket.on("studio:signal", this.onSignal);
    this.socket.on("studio:screen:announce", this.onScreenAnnounce);
    this.socket.on("studio:screen:request", this.onScreenRequest);
    this.socket.on("studio:screen:access", this.onScreenAccess);
    this.socket.on("studio:screen:stop", this.onScreenStop);
    this.socket.on("studio:voice:snapshot", this.onVoiceSnapshot);
    this.socket.on("studio:voice:join", this.onVoiceJoin);
    this.socket.on("studio:voice:state", this.onVoiceState);
    this.socket.on("studio:voice:leave", this.onVoiceLeave);
    this.socket.on("studio:voice:signal", this.onVoiceSignal);
    this.socket.on("studio:chat:message", this.onChatMessage);
    this.socket.on("studio:comment:changed", this.onTeamCommentChanged);
    this.socket.on("studio:crdt:sync", this.onCrdtSync);
    this.socket.on("studio:crdt:update", this.onCrdtUpdate);
    this.socket.on(STUDIO_LIVE_CRDT_BINARY_REMOTE_EVENT, this.onCrdtBinaryUpdate);
    this.socket.on(STUDIO_LIVE_INK_SOCKET_EVENT, this.onInk);
  }

  get ready(): boolean {
    return (
      !this.closed &&
      this.joined &&
      this.selectedCrdtWireFormat !== null &&
      this.socket.connected
    );
  }

  /**
   * The ink lane piggybacks on the join-time binary wire negotiation: a connection that selected
   * the binary CRDT format has proven this Socket.IO path relays ArrayBuffer payloads end-to-end.
   * A legacy-wire or unjoined connection advertises nothing — the V18 fail-closed contract keeps
   * such peers cursor-only with no JSON re-encoding fallback.
   */
  get binaryLaneCapabilities(): readonly string[] {
    return this.ready && this.selectedCrdtWireFormat === STUDIO_CRDT_BINARY_WIRE_FORMAT
      ? STUDIO_SOCKET_BINARY_LANES
      : STUDIO_SOCKET_NO_BINARY_LANES;
  }

  subscribe(listener: (value: unknown) => void): () => void {
    if (this.closed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeControl(listener: (event: StudioLiveTransportControlEvent) => void): () => void {
    if (this.closed) return () => undefined;
    this.controlListeners.add(listener);
    return () => this.controlListeners.delete(listener);
  }

  subscribeCrdt(listener: (message: StudioCrdtTransportMessage) => void): () => void {
    if (this.closed) return () => undefined;
    this.crdtListeners.add(listener);
    return () => this.crdtListeners.delete(listener);
  }

  /** Delivers raw binary-lane candidates; subscribers must run the strict ink wire parser. */
  subscribeInk(listener: (value: unknown) => void): () => void {
    if (this.closed) return () => undefined;
    this.inkListeners.add(listener);
    return () => this.inkListeners.delete(listener);
  }

  readonly onConnect = (): void => {
    lifecycle.onConnect.call(this);
  };
  readonly onConnectError = (error: unknown): void => {
    lifecycle.onConnectError.call(this, error);
  };
  readonly onDisconnect = (reason: unknown): void => {
    lifecycle.onDisconnect.call(this, reason);
  };
  readonly onServerError = (value: unknown): void => {
    lifecycle.onServerError.call(this, value);
  };
  readonly onAccessRevoked = (value: unknown): void => {
    lifecycle.onAccessRevoked.call(this, value);
  };
  readonly onPresenceSnapshot = (value: unknown): void => {
    presence.onPresenceSnapshot.call(this, value);
  };
  readonly onPresenceUpdate = (value: unknown): void => {
    presence.onPresenceUpdate.call(this, value);
  };
  readonly onPresenceLeave = (value: unknown): void => {
    presence.onPresenceLeave.call(this, value);
  };
  readonly onCursor = (value: unknown): void => {
    presence.onCursor.call(this, value);
  };
  readonly onGesturePreview = (value: unknown): void => {
    presence.onGesturePreview.call(this, value);
  };
  readonly onSignal = (value: unknown): void => {
    presence.onSignal.call(this, value);
  };
  readonly onScreenAnnounce = (value: unknown): void => {
    presence.onScreenAnnounce.call(this, value);
  };
  readonly onScreenRequest = (value: unknown): void => {
    presence.onScreenRequest.call(this, value);
  };
  readonly onScreenAccess = (value: unknown): void => {
    presence.onScreenAccess.call(this, value);
  };
  readonly onScreenStop = (value: unknown): void => {
    presence.onScreenStop.call(this, value);
  };
  readonly onChatMessage = (value: unknown): void => {
    presence.onChatMessage.call(this, value);
  };
  readonly onTeamCommentChanged = (value: unknown): void => {
    presence.onTeamCommentChanged.call(this, value);
  };
  readonly onVoiceSnapshot = (value: unknown): void => {
    voice.onVoiceSnapshot.call(this, value);
  };
  readonly onVoiceJoin = (value: unknown): void => {
    voice.onVoiceJoin.call(this, value);
  };
  readonly onVoiceState = (value: unknown): void => {
    voice.onVoiceState.call(this, value);
  };
  readonly onVoiceLeave = (value: unknown): void => {
    voice.onVoiceLeave.call(this, value);
  };
  readonly onVoiceSignal = (value: unknown): void => {
    voice.onVoiceSignal.call(this, value);
  };
  readonly onLockUpdate = (value: unknown): void => {
    lockApply.onLockUpdate.call(this, value);
  };
  readonly onCrdtSync = (value: unknown): void => {
    crdt.onCrdtSync.call(this, value);
  };
  readonly onCrdtUpdate = (value: unknown): void => {
    crdt.onCrdtUpdate.call(this, value);
  };
  readonly onCrdtBinaryUpdate = (value: unknown): void => {
    crdt.onCrdtBinaryUpdate.call(this, value);
  };
  readonly onInk = (value: unknown): void => {
    crdt.onInk.call(this, value);
  };

  sendInk = outbound.sendInk;
  requestCrdtSync = outbound.requestCrdtSync;
  publishCrdtUpdate = outbound.publishCrdtUpdate;
  acquireLock = outbound.acquireLock;
  releaseLock = outbound.releaseLock;
  send = outbound.send;
  connect = lifecycle.connect;
  close = lifecycle.close;
  refreshCredentialAfterAuthenticationError = lifecycle.refreshCredentialAfterAuthenticationError;
  revokeFromConnectError = lifecycle.revokeFromConnectError;
  beginJoin = lifecycle.beginJoin;
  acceptJoin = lifecycle.acceptJoin;
  finishAcceptedJoin = lifecycle.finishAcceptedJoin;
  selectCrdtBinaryWire = lifecycle.selectCrdtBinaryWire;
  reconcilePendingPresence = lifecycle.reconcilePendingPresence;
  failJoin = lifecycle.failJoin;
  failInitialConnect = lifecycle.failInitialConnect;
  handleFailure = lifecycle.handleFailure;
  scrubCredentials = lifecycle.scrubCredentials;
  flushInitialSnapshot = lifecycle.flushInitialSnapshot;
  restartJoinAfterUnsafeSnapshot = lifecycle.restartJoinAfterUnsafeSnapshot;
  scheduleJoinRetry = lifecycle.scheduleJoinRetry;
  clearJoinRetry = lifecycle.clearJoinRetry;
  emitStatus = lifecycle.emitStatus;
  emitControl = lifecycle.emitControl;
  clearConnectTimeout = lifecycle.clearConnectTimeout;
  clearConnectDeferred = lifecycle.clearConnectDeferred;
  canonicalSessionId = presence.canonicalSessionId;
  transportSessionId = presence.transportSessionId;
  applyPresenceLeave = presence.applyPresenceLeave;
  applyPresenceUpdate = presence.applyPresenceUpdate;
  bufferPresenceDelta = presence.bufferPresenceDelta;
  bufferScreenDelta = presence.bufferScreenDelta;
  bufferVoiceDelta = presence.bufferVoiceDelta;
  bufferLockDelta = presence.bufferLockDelta;
  replayPendingVoiceForParticipant = presence.replayPendingVoiceForParticipant;
  stagePresenceDelta = presence.stagePresenceDelta;
  applyParticipants = presence.applyParticipants;
  applyScreenShareSnapshot = presence.applyScreenShareSnapshot;
  validTarget = presence.validTarget;
  remoteParticipant = presence.remoteParticipant;
  screenRelay = presence.screenRelay;
  deliver = presence.deliver;
  rememberCanonicalSession = presence.rememberCanonicalSession;
  setActiveParticipant = presence.setActiveParticipant;
  unindexActiveParticipant = presence.unindexActiveParticipant;
  applyVoiceSnapshot = voice.applyVoiceSnapshot;
  isCurrentVoiceAdmission = voice.isCurrentVoiceAdmission;
  isAuthorizedVoiceAttempt = voice.isAuthorizedVoiceAttempt;
  queuePendingVoiceSignal = voice.queuePendingVoiceSignal;
  completePendingVoiceAdmission = voice.completePendingVoiceAdmission;
  rejectPendingVoiceAdmission = voice.rejectPendingVoiceAdmission;
  cancelPendingVoiceAdmission = voice.cancelPendingVoiceAdmission;
  terminateVoiceIntent = voice.terminateVoiceIntent;
  bestEffortVoiceLeave = voice.bestEffortVoiceLeave;
  rejectSelfVoice = voice.rejectSelfVoice;
  applyLockDelta = lockApply.applyLockDelta;
  applyLockSnapshot = lockApply.applyLockSnapshot;
  applyAuthoritativeLock = lockApply.applyAuthoritativeLock;
  applyAuthoritativeRelease = lockApply.applyAuthoritativeRelease;
  completePendingLockAcquisition = lockPending.completePendingLockAcquisition;
  parseLockAcquisitionSuccess = lockPending.parseLockAcquisitionSuccess;
  lockAckRequestId = lockPending.lockAckRequestId;
  removePendingLockAcquisition = lockPending.removePendingLockAcquisition;
  rememberAbandonedLockAcquisition = lockPending.rememberAbandonedLockAcquisition;
  forgetAbandonedLockAcquisition = lockPending.forgetAbandonedLockAcquisition;
  pruneAbandonedLockAcquisitions = lockPending.pruneAbandonedLockAcquisitions;
  findAbandonedLockAcquisition = lockPending.findAbandonedLockAcquisition;
  abandonPendingLockAcquisitionForRelease = lockPending.abandonPendingLockAcquisitionForRelease;
  completePendingLockRelease = lockPending.completePendingLockRelease;
  removePendingLockRelease = lockPending.removePendingLockRelease;
  revokePendingLockReleases = lockPending.revokePendingLockReleases;
  revokePendingLockAcquisitions = lockPending.revokePendingLockAcquisitions;
  abandonPendingLockAcquisitionsForResync = lockPending.abandonPendingLockAcquisitionsForResync;
  rollbackAbandonedLock = lockPending.rollbackAbandonedLock;
  rollbackDeferredSelfLock = lockPending.rollbackDeferredSelfLock;
  settleDeferredSelfLock = lockPending.settleDeferredSelfLock;
  releaseLockFenceBestEffort = lockPending.releaseLockFenceBestEffort;
  acceptInkInbound = crdt.acceptInkInbound;
  emitWithAck = crdt.emitWithAck;
  emitCrdtWithAck = crdt.emitCrdtWithAck;
  emitCrdt = crdt.emitCrdt;
  rememberCrdtUpdateId = crdt.rememberCrdtUpdateId;
  restartAfterCrdtWireFailure = crdt.restartAfterCrdtWireFailure;
  rejectPendingCrdtOperations = crdt.rejectPendingCrdtOperations;
  clearCrdtWireSelectionTimeout = crdt.clearCrdtWireSelectionTimeout;
  clearCrdtReconnectTimeout = crdt.clearCrdtReconnectTimeout;
}

export function createStudioServerLiveTransportFactory(
  sessionToken: string,
  dependencies: StudioLiveSocketTransportDependencies = {}
): StudioLiveTransportFactory {
  const hasEndpointOverride = Object.prototype.hasOwnProperty.call(
    dependencies,
    "socketEndpoint",
  );
  const endpoint =
    hasEndpointOverride
      ? dependencies.socketEndpoint ?? null
      : dependencies.createSocket
        ? "/studio-live"
        : runtimeSocketEndpoint();
  const hasLocalTransportOverride = Object.prototype.hasOwnProperty.call(
    dependencies,
    "createLocalTransport",
  );
  const localTransportFactory =
    dependencies.createLocalTransport ?? createStudioLocalLiveTransport;
  const realtimeOrigin = resolveStudioCloudflareRealtimeOrigin(
    import.meta.env.VITE_STUDIO_REALTIME_ORIGIN,
  );
  const {
    socketEndpoint: _socketEndpoint,
    createLocalTransport: _createLocalTransport,
    ...transportDependencies
  } = dependencies;

  const primaryFactory: StudioLiveTransportFactory = endpoint
    ? (() => {
        const serverDependencies: StudioLiveSocketTransportDependencies = {
          ...transportDependencies,
          createSocket:
            dependencies.createSocket
            ?? ((auth) => createSocketAtEndpoint(endpoint, auth)),
        };
        return (context) =>
          new StudioLiveSocketTransport(
            context,
            sessionToken,
            serverDependencies,
          );
      })()
    : hasLocalTransportOverride
      ? localTransportFactory
      : realtimeOrigin
        ? createStudioLiveSignalingServerTransportFactory
        : localTransportFactory;

  return applyStudioLiveP2pOverlay(
    applyStudioRealtimePurposeRouting(primaryFactory, {
      realtimeOrigin: import.meta.env.VITE_STUDIO_REALTIME_ORIGIN,
      providerId: import.meta.env.VITE_STUDIO_REALTIME_PROVIDER_ID,
    }),
    {
      enabled: import.meta.env.VITE_STUDIO_LIVE_P2P_ENABLED !== "false",
    },
  );
}
