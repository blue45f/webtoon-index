import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import {
  Ack,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";

import { CreatorService } from "./creator.service";
import { StudioCrdtService } from "./studio-crdt.service";
import {
  replyStudioLiveAck as reply,
  studioLiveFailure as failure,
} from "./studio-live-ack";
import { StudioLiveAdapterCleanupService } from "./studio-live-adapter-cleanup.service";
import { StudioLiveCleanupNotificationDispatcher } from "./studio-live-cleanup-notification-dispatcher";
import { StudioLiveCrdtQuotaLimiter } from "./studio-live-crdt-quota";
import {
  STUDIO_LIVE_FEATURE_POLICY,
  type StudioLiveFeaturePolicy,
} from "./studio-live-feature-policy";
import {
  STUDIO_LIVE_ACCESS_RECHECK_MS,
  STUDIO_LIVE_MAX_HTTP_BUFFER_SIZE,
  STUDIO_LIVE_NAMESPACE,
  isStudioLiveOriginAllowed,
  studioLiveAllowRequest,
  studioLiveRoom,
  type RateLimitBucket,
  type StudioLiveCandidateRelayAuthorization,
  type StudioLiveCrdtBinarySelectionState,
  type StudioLiveCrdtBinarySyncWireResult,
  type StudioLiveParticipantAuthorizationRecheck,
  type StudioLiveParticipantInternal,
  type StudioLiveVoiceMemberInternal,
} from "./studio-live-gateway-constants";
import * as studioLiveCrdtHandlers from "./studio-live-gateway-handlers-crdt";
import * as studioLiveLockScreenHandlers from "./studio-live-gateway-handlers-lock-screen";
import * as studioLiveVoiceHandlers from "./studio-live-gateway-handlers-voice";
import {
  asStudioLiveGatewayHost,
  type StudioLiveGatewayHost,
} from "./studio-live-gateway-host";
import {
  attachStudioLiveGatewayRuntime,
  type StudioLiveGatewayRuntime,
} from "./studio-live-gateway-runtime";
import { StudioLiveInterServerRelayTransport } from "./studio-live-inter-server-relay-transport";
import { StudioLiveJoinTransitionSequencer } from "./studio-live-join-transition-sequencer";
import {
  STUDIO_LIVE_LOCK_REPOSITORY,
  type StudioLiveLockRepository,
} from "./studio-live-lock.repository";
import { StudioLiveRoomTransitionCoordinator } from "./studio-live-room-transition-coordinator";
import { StudioLiveSocketAuthService } from "./studio-live-socket-auth.service";
import {
  STUDIO_LIVE_CRDT_BINARY_SYNC_EVENT,
  STUDIO_LIVE_CRDT_BINARY_UPDATE_EVENT,
  STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT,
  STUDIO_LIVE_GESTURE_PREVIEW_SOCKET_EVENT,
  StudioLiveJoinSchema,
} from "./studio-live.protocol";

import type {
  StudioLiveAck,
  StudioLiveAckCallback,
  StudioLiveChatInput,
  StudioLiveCrdtBinarySelection,
  StudioLiveCrdtBinarySelectInput,
  StudioLiveCrdtBinarySyncInput,
  StudioLiveCrdtBinaryUpdateAck,
  StudioLiveCrdtBinaryUpdateInput,
  StudioLiveCrdtSyncInput,
  StudioLiveCrdtSyncResult,
  StudioLiveCrdtUpdateAck,
  StudioLiveCrdtUpdateInput,
  StudioLiveCursorInput,
  StudioLiveGesturePreviewInput,
  StudioLiveJoinInput,
  StudioLiveJoinResult,
  StudioLiveLockAcquiredDecision,
  StudioLiveLockReleaseDecision,
  StudioLiveLockReleaseInput,
  StudioLiveLockRequestInput,
  StudioLiveNamespace,
  StudioLiveParticipant,
  StudioLivePresenceInput,
  StudioLiveScreenAccessInput,
  StudioLiveScreenAnnounceInput,
  StudioLiveScreenRequestInput,
  StudioLiveScreenStateInput,
  StudioLiveScreenStopInput,
  StudioLiveSignalInput,
  StudioLiveSocket,
  StudioLiveVoiceJoinInput,
  StudioLiveVoiceLeaveInput,
  StudioLiveVoiceMember,
  StudioLiveVoiceSignalInput,
  StudioLiveVoiceStateInput,
} from "./studio-live.protocol";
import type { StudioTeamCommentLiveEvent } from "../../../../web/src/shared/lib/studio-team-comment-live-event";
import type { Namespace } from "socket.io";

export {
  STUDIO_LIVE_SESSION_AUTHENTICATOR,
  STUDIO_LIVE_SESSION_REVALIDATOR,
  STUDIO_LIVE_GESTURE_PREVIEW_SOCKET_EVENT,
  StudioLiveChatSchema,
  StudioLiveCrdtSyncSchema,
  StudioLiveCrdtUpdateSchema,
  StudioLiveCursorSchema,
  StudioLiveGesturePreviewSchema,
  StudioLiveJoinSchema,
  StudioLiveLockReleaseSchema,
  StudioLiveLockRequestIdSchema,
  StudioLiveLockRequestSchema,
  StudioLivePresenceSchema,
  StudioLiveScreenAccessSchema,
  StudioLiveScreenAnnounceSchema,
  StudioLiveScreenRequestSchema,
  StudioLiveScreenStateSchema,
  StudioLiveScreenStopSchema,
  StudioLiveSignalSchema,
  StudioLiveVoiceJoinSchema,
  StudioLiveVoiceLeaveSchema,
  StudioLiveVoiceSignalSchema,
  StudioLiveVoiceStateSchema,
  studioLiveSessionAuthenticatorProvider,
  studioLiveSessionRevalidatorProvider,
} from "./studio-live.protocol";

export type {
  StudioLiveAck,
  StudioLiveAuthPrincipal,
  StudioLiveCrdtRemoteUpdate,
  StudioLiveCrdtSyncResult,
  StudioLiveCrdtUpdateAck,
  StudioLiveLock,
  StudioLiveLockAcquiredDecision,
  StudioLiveLockRequestAck,
  StudioLiveLockUpdate,
  StudioLiveParticipant,
  StudioLiveSessionAuthenticator,
  StudioLiveSessionRevalidator,
  StudioLiveVoiceMember,
} from "./studio-live.protocol";

export { STUDIO_LIVE_RELAY_RPC_TIMEOUT_MS } from "./studio-live-inter-server-relay-transport";

export {
  STUDIO_LIVE_ADAPTER_DISCOVERY_TIMEOUT_MS,
  STUDIO_LIVE_VOICE_MAX_PARTICIPANTS,
  STUDIO_LIVE_ROOM_MAX_PARTICIPANTS,
  STUDIO_LIVE_MAX_CONNECTIONS_PER_USER,
  isStudioLiveOriginAllowed,
  studioLiveAllowRequest,
} from "./studio-live-gateway-constants";

export interface StudioLiveGateway extends StudioLiveGatewayRuntime {}

@Injectable()
@WebSocketGateway({
  namespace: STUDIO_LIVE_NAMESPACE,
  path: "/socket.io",
  transports: ["websocket"],
  maxHttpBufferSize: STUDIO_LIVE_MAX_HTTP_BUFFER_SIZE,
  perMessageDeflate: false,
  cors: {
    credentials: false,
    methods: ["GET", "POST"],
    origin(origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void) {
      callback(null, isStudioLiveOriginAllowed(origin));
    },
  },
  // Socket.IO CORS only controls browser HTTP responses. The WebSocket upgrade itself needs an
  // explicit admission check or a hostile Origin can still connect with websocket-only transport.
  allowRequest: studioLiveAllowRequest,
})
export class StudioLiveGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  server!: Namespace;

  private readonly logger = new Logger(StudioLiveGateway.name);
  private readonly participantsBySocket = new Map<string, StudioLiveParticipantInternal>();
  private readonly socketIdsByWork = new Map<string, Set<string>>();
  private readonly lockCleanupByConnectionWork = new Map<string, Promise<void>>();
  private readonly lockOperationTailByResource = new Map<string, Promise<void>>();
  /**
   * Keyed by the server-verified principal, never by a Socket.IO connection id and never by the
   * client-supplied clientInstanceId. One account therefore spends one budget per action across
   * tabs, parallel sockets, and reconnects — matching StudioLiveCrdtQuotaLimiter.
   */
  private readonly rateLimits = new Map<string, Map<string, RateLimitBucket>>();
  private lastRateLimitPruneAt: number | null = null;
  private readonly connectionIdsByUser = new Map<string, Set<string>>();
  private readonly userIdByConnection = new Map<string, string>();
  private readonly crdtQuotaLimiter = new StudioLiveCrdtQuotaLimiter();
  private readonly crdtBinarySelectionBySocket = new Map<
    string,
    StudioLiveCrdtBinarySelectionState
  >();
  private readonly participantAuthorizationRechecks = new Map<
    string,
    StudioLiveParticipantAuthorizationRecheck
  >();
  private readonly candidateRelayAuthorizations = new Map<
    string,
    StudioLiveCandidateRelayAuthorization
  >();
  private readonly voiceMembershipBySocket = new Map<string, StudioLiveVoiceMemberInternal>();
  private readonly deliveredInterServerVoiceSignals = new Map<string, number>();
  private accessRecheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(CreatorService)
    private readonly creatorService: CreatorService,
    @Inject(StudioLiveAdapterCleanupService)
    private readonly adapterCleanup: StudioLiveAdapterCleanupService,
    @Inject(StudioLiveCleanupNotificationDispatcher)
    private readonly cleanupNotifications: StudioLiveCleanupNotificationDispatcher,
    @Inject(StudioLiveInterServerRelayTransport)
    private readonly interServerRelayTransport: StudioLiveInterServerRelayTransport,
    @Inject(StudioLiveSocketAuthService)
    private readonly socketAuthentication: StudioLiveSocketAuthService,
    @Inject(StudioLiveJoinTransitionSequencer)
    private readonly joinTransitions: StudioLiveJoinTransitionSequencer,
    @Inject(StudioLiveRoomTransitionCoordinator)
    private readonly roomTransitions: StudioLiveRoomTransitionCoordinator,
    @Inject(STUDIO_LIVE_FEATURE_POLICY)
    private readonly liveFeatures: StudioLiveFeaturePolicy,
    @Inject(StudioCrdtService)
    private readonly studioCrdtService: StudioCrdtService,
    @Inject(STUDIO_LIVE_LOCK_REPOSITORY)
    private readonly studioLiveLockRepository: StudioLiveLockRepository
  ) {}

  afterInit(server: Namespace): void {
    this.interServerRelayTransport.bind(
      server as StudioLiveNamespace,
      (request) => this.receiveInterServerRelay(request)
    );
    // Namespace middleware completes authentication before Socket.IO emits `connection`, so a
    // valid client cannot race an async handleConnection hook with its first studio:join event.
    server.use((socket, next) => {
      void this.socketAuthentication.authenticate(socket as StudioLiveSocket)
        .then((authenticated) => {
          if (authenticated) {
            next();
            return;
          }
          const error = new Error("로그인 세션을 확인할 수 없습니다.") as Error & {
            data?: { code: string };
          };
          error.data = { code: "unauthenticated" };
          next(error);
        })
        .catch(() => {
          const error = new Error("로그인 세션을 확인할 수 없습니다.") as Error & {
            data?: { code: string };
          };
          error.data = { code: "unauthenticated" };
          next(error);
        });
    });
    if (this.accessRecheckTimer) clearInterval(this.accessRecheckTimer);
    this.accessRecheckTimer = setInterval(() => {
      void this.revalidateAllParticipants();
      void this.purgeExpiredLocks();
    }, STUDIO_LIVE_ACCESS_RECHECK_MS);
    this.accessRecheckTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.accessRecheckTimer) clearInterval(this.accessRecheckTimer);
    this.accessRecheckTimer = null;
    this.participantsBySocket.clear();
    this.socketIdsByWork.clear();
    this.lockCleanupByConnectionWork.clear();
    this.lockOperationTailByResource.clear();
    this.rateLimits.clear();
    this.lastRateLimitPruneAt = null;
    this.connectionIdsByUser.clear();
    this.userIdByConnection.clear();
    this.crdtQuotaLimiter.clear();
    this.crdtBinarySelectionBySocket.clear();
    this.joinTransitions.clearAll();
    this.participantAuthorizationRechecks.clear();
    this.candidateRelayAuthorizations.clear();
    this.socketAuthentication.clearAll();
    this.voiceMembershipBySocket.clear();
    this.deliveredInterServerVoiceSignals.clear();
  }

  /** Emits one tiny invalidation through the configured Socket.IO adapter-backed work room. */
  publishTeamCommentChanged(change: StudioTeamCommentLiveEvent): boolean {
    if (!this.server) return false;
    this.server
      .to(studioLiveRoom(change.workId))
      .emit("studio:comment:changed", change);
    return true;
  }

  async handleConnection(client: StudioLiveSocket): Promise<void> {
    // Runtime connections have already passed the namespace middleware. The fallback keeps direct
    // gateway tests and non-standard adapters fail-closed without weakening the runtime ordering.
    const principal = this.socketAuthentication.principal(client);
    if (principal && principal.expiresAt > Date.now()) return;
    this.socketAuthentication.clear(client);
    if (!(await this.socketAuthentication.authenticate(client))) {
      client.emit("studio:error", failure("unauthenticated", "로그인 세션을 확인할 수 없습니다."));
      client.disconnect(true);
    }
  }

  handleDisconnect(client: StudioLiveSocket): void {
    this.clearCrdtBinarySelectionBestEffort(client.id, client);
    this.socketAuthentication.clear(client);
    this.joinTransitions.invalidate(client.id);
    this.participantAuthorizationRechecks.delete(client.id);
    this.deleteCandidateRelayAuthorizationsForSocket(client.id);
    this.removeParticipant(client.id, "disconnect");
    this.clearSocketIdentityClaims(client);
    // Only the connection slot is released. The identity's rate-limit buckets deliberately survive
    // the socket so reconnecting cannot buy a fresh budget.
    this.releaseUserConnection(client.id);
  }

  @SubscribeMessage("studio:join")
  async join(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLiveJoinInput,
    @Ack() ack?: StudioLiveAckCallback<StudioLiveJoinResult>
  ) {
    const parsed = StudioLiveJoinSchema.safeParse(body);
    if (!parsed.success) {
      return reply(ack, failure("invalid_payload", "실시간 작업실 참가 정보가 올바르지 않습니다."));
    }
    // Charge the valid request before session/ACL I/O so a connected client cannot bypass the
    // admission limit while still forcing repeated database-backed session validation.
    if (!this.consumeRateLimit(client, "join", 12, 60_000)) {
      return reply(ack, failure("rate_limited", "작업실 참가 요청이 너무 많습니다."));
    }
    return this.joinTransitions.runLatest(client.id, (transitionSequence) =>
      this.performJoin(client, parsed.data, transitionSequence, ack)
    );
  }

  @SubscribeMessage("studio:presence")
  async updatePresence(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLivePresenceInput,
    @Ack() ack?: StudioLiveAckCallback<{ participant: StudioLiveParticipant }>
  ) {
    return this.boundHandler(studioLiveCrdtHandlers.updatePresence, client, body, ack);
  }

  @SubscribeMessage("studio:cursor")
  async updateCursor(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLiveCursorInput,
    @Ack() ack?: StudioLiveAckCallback<{ accepted: true }>
  ) {
    return this.boundHandler(studioLiveCrdtHandlers.updateCursor, client, body, ack);
  }

  @SubscribeMessage(STUDIO_LIVE_GESTURE_PREVIEW_SOCKET_EVENT)
  async relayGesturePreview(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLiveGesturePreviewInput,
    @Ack() ack?: StudioLiveAckCallback<{ accepted: true }>
  ) {
    return this.boundHandler(studioLiveCrdtHandlers.relayGesturePreview, client, body, ack);
  }

  @SubscribeMessage(STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT)
  async selectCrdtBinaryWire(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLiveCrdtBinarySelectInput,
    @Ack() ack?: StudioLiveAckCallback<StudioLiveCrdtBinarySelection>
  ) {
    return this.boundHandler(studioLiveCrdtHandlers.selectCrdtBinaryWire, client, body, ack);
  }

  @SubscribeMessage(STUDIO_LIVE_CRDT_BINARY_SYNC_EVENT)
  async syncCrdtDocumentBinary(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLiveCrdtBinarySyncInput,
    @Ack() ack?: StudioLiveAckCallback<StudioLiveCrdtBinarySyncWireResult>
  ) {
    return this.boundHandler(studioLiveCrdtHandlers.syncCrdtDocumentBinary, client, body, ack);
  }

  @SubscribeMessage(STUDIO_LIVE_CRDT_BINARY_UPDATE_EVENT)
  async applyCrdtUpdateBinary(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLiveCrdtBinaryUpdateInput,
    @Ack() ack?: StudioLiveAckCallback<StudioLiveCrdtBinaryUpdateAck>
  ) {
    return this.boundHandler(studioLiveCrdtHandlers.applyCrdtUpdateBinary, client, body, ack);
  }

  @SubscribeMessage("studio:crdt:sync")
  async syncCrdtDocument(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLiveCrdtSyncInput,
    @Ack() ack?: StudioLiveAckCallback<StudioLiveCrdtSyncResult>
  ) {
    return this.boundHandler(studioLiveCrdtHandlers.syncCrdtDocument, client, body, ack);
  }

  @SubscribeMessage("studio:crdt:update")
  async applyCrdtUpdate(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLiveCrdtUpdateInput,
    @Ack() ack?: StudioLiveAckCallback<StudioLiveCrdtUpdateAck>
  ) {
    return this.boundHandler(studioLiveCrdtHandlers.applyCrdtUpdate, client, body, ack);
  }

  @SubscribeMessage("studio:lock:request")
  async requestLock(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLiveLockRequestInput,
    @Ack() ack?: StudioLiveAckCallback<StudioLiveLockAcquiredDecision>
  ) {
    return this.boundHandler(studioLiveLockScreenHandlers.requestLock, client, body, ack);
  }

  @SubscribeMessage("studio:lock:release")
  async releaseLock(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLiveLockReleaseInput,
    @Ack() ack?: StudioLiveAckCallback<StudioLiveLockReleaseDecision>
  ) {
    return this.boundHandler(studioLiveLockScreenHandlers.releaseLock, client, body, ack);
  }

  @SubscribeMessage("studio:screen:set")
  async setScreenSharing(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLiveScreenStateInput,
    @Ack() ack?: StudioLiveAckCallback<{ participant: StudioLiveParticipant }>
  ) {
    return this.boundHandler(studioLiveLockScreenHandlers.setScreenSharing, client, body, ack);
  }

  @SubscribeMessage("studio:screen:announce")
  async announceScreenShare(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLiveScreenAnnounceInput,
    @Ack() ack?: StudioLiveAckCallback<{ delivered: true }>
  ) {
    return this.boundHandler(studioLiveLockScreenHandlers.announceScreenShare, client, body, ack);
  }

  @SubscribeMessage("studio:screen:request")
  async requestScreenAccess(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLiveScreenRequestInput,
    @Ack() ack?: StudioLiveAckCallback<{ delivered: true }>
  ) {
    return this.boundHandler(studioLiveLockScreenHandlers.requestScreenAccess, client, body, ack);
  }

  @SubscribeMessage("studio:screen:access")
  async relayScreenAccess(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLiveScreenAccessInput,
    @Ack() ack?: StudioLiveAckCallback<{ delivered: true }>
  ) {
    return this.boundHandler(studioLiveLockScreenHandlers.relayScreenAccess, client, body, ack);
  }

  @SubscribeMessage("studio:screen:stop")
  async stopScreenShare(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLiveScreenStopInput,
    @Ack() ack?: StudioLiveAckCallback<{ delivered: true }>
  ) {
    return this.boundHandler(studioLiveLockScreenHandlers.stopScreenShare, client, body, ack);
  }

  @SubscribeMessage("studio:voice:join")
  async joinVoice(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLiveVoiceJoinInput,
    @Ack() ack?: StudioLiveAckCallback<{ members: StudioLiveVoiceMember[] }>
  ) {
    return this.boundHandler(studioLiveVoiceHandlers.joinVoice, client, body, ack);
  }

  @SubscribeMessage("studio:voice:state")
  async updateVoiceState(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLiveVoiceStateInput,
    @Ack() ack?: StudioLiveAckCallback<{ member: StudioLiveVoiceMember }>
  ) {
    return this.boundHandler(studioLiveVoiceHandlers.updateVoiceState, client, body, ack);
  }

  @SubscribeMessage("studio:voice:leave")
  async leaveVoice(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLiveVoiceLeaveInput,
    @Ack() ack?: StudioLiveAckCallback<{ left: true }>
  ) {
    return this.boundHandler(studioLiveVoiceHandlers.leaveVoice, client, body, ack);
  }

  @SubscribeMessage("studio:chat:send")
  async sendChatMessage(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLiveChatInput,
    @Ack() ack?: StudioLiveAckCallback<{ delivered: true; sentAt: string }>
  ) {
    return this.boundHandler(studioLiveVoiceHandlers.sendChatMessage, client, body, ack);
  }

  @SubscribeMessage("studio:voice:signal")
  async relayVoiceSignal(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLiveVoiceSignalInput,
    @Ack() ack?: StudioLiveAckCallback<{ delivered: true; signalId: string }>
  ) {
    return this.boundHandler(studioLiveVoiceHandlers.relayVoiceSignal, client, body, ack);
  }

  @SubscribeMessage("studio:signal")
  async relaySignal(
    @ConnectedSocket() client: StudioLiveSocket,
    @MessageBody() body: StudioLiveSignalInput,
    @Ack() ack?: StudioLiveAckCallback<{ delivered: true; signalId: string }>
  ) {
    return this.boundHandler(studioLiveVoiceHandlers.relaySignal, client, body, ack);
  }

  private boundHandler<TArgs extends unknown[], TResult>(
    handler: (this: StudioLiveGatewayHost, ...args: TArgs) => TResult,
    ...args: TArgs
  ): TResult {
    return handler.call(asStudioLiveGatewayHost(this), ...args);
  }
}

attachStudioLiveGatewayRuntime(StudioLiveGateway);
