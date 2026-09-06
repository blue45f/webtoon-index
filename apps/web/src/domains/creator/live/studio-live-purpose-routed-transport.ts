import { createStudioCloudflareRealtimeAdapterFactory } from "../studio-realtime-provider-cloudflare-adapter";
import {
  STUDIO_REALTIME_CAPABILITIES,
  type StudioRealtimeInboundEvent,
  type StudioRealtimeOutboundEvent,
  type StudioRealtimeWorkload,
} from "../studio-realtime-provider-protocol";
import { createStudioRealtimeHttpTicketIssuer } from "../studio-realtime-ticket-client";
import {
  StudioRealtimeWorkloadCoordinator,
  type StudioRealtimeWorkloadStatus,
} from "../studio-realtime-workload-coordinator";
import { STUDIO_SCREEN_SHARE_DISCOVERY_ID } from "../studio-screen-share";

import {
  createStudioLiveEnvelope,
  parseStudioLiveEnvelope,
  type StudioLiveEnvelope,
  type StudioLiveLockAcquireResult,
  type StudioLiveMessageKind,
  type StudioLiveParticipant,
  type StudioLivePayloadMap,
} from "./studio-live-collaboration-protocol";

import type {
  StudioCrdtSyncRequest,
  StudioCrdtSyncResponse,
  StudioCrdtTransportMessage,
  StudioCrdtUpdateAck,
  StudioCrdtUpdateRequest,
} from "./studio-crdt-protocol";
import type {
  StudioLiveTransport,
  StudioLiveTransportContext,
  StudioLiveTransportControlEvent,
  StudioLiveTransportFactory,
} from "./studio-live-collaboration-transport";
import type { StudioLiveInkWireMessage } from "./studio-live-ink-protocol";

type StudioRealtimeCoordinatorPort = Pick<
  StudioRealtimeWorkloadCoordinator,
  "connect" | "dispose" | "isReady" | "publish" | "subscribe" | "subscribeStatus"
>;

export interface StudioPurposeRoutedLiveTransportFactoryOptions {
  readonly primaryFactory: StudioLiveTransportFactory;
  readonly createCoordinator: (
    context: StudioLiveTransportContext,
  ) => StudioRealtimeCoordinatorPort;
  readonly resolveRoomId?: (context: StudioLiveTransportContext) => string;
  readonly randomId?: () => string;
  readonly now?: () => number;
}

export interface StudioCloudflarePurposeRoutedFactoryOptions {
  readonly primaryFactory: StudioLiveTransportFactory;
  readonly realtimeOrigin: string;
  readonly providerId?: string;
  readonly roomId?: (context: StudioLiveTransportContext) => string;
}

const MAX_PENDING_PURPOSE_EVENTS = 128;
const MAX_RECENT_MERGED_FINGERPRINTS = 1_024;
const MERGED_DUPLICATE_TTL_MS = 12_000;

type StudioPurposeEventSource = "primary" | "provider";

type StudioLiveAnyEnvelope = {
  [Kind in StudioLiveMessageKind]: StudioLiveEnvelope<Kind>;
}[StudioLiveMessageKind];

interface RecentMergedFingerprint {
  readonly source: StudioPurposeEventSource;
  readonly observedAt: number;
}

function defaultRandomId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("안전한 실시간 이벤트 식별자를 만들 수 없습니다.");
  }
  return globalThis.crypto.randomUUID();
}

function workloadForLegacyKind(
  kind: StudioLiveMessageKind,
): StudioRealtimeWorkload | null {
  if (
    kind === "presence:hello" ||
    kind === "presence:heartbeat" ||
    kind === "presence:leave" ||
    kind === "cursor:update"
  ) {
    return "presence";
  }
  if (
    kind === "screen:announce" ||
    kind === "screen:request" ||
    kind === "screen:access" ||
    kind === "webrtc:description" ||
    kind === "webrtc:ice" ||
    kind === "screen:stop"
  ) {
    return "screen-signaling";
  }
  return null;
}

function fallbackParticipant(sessionId: string): StudioLiveParticipant {
  return {
    sessionId,
    displayName: "팀원",
    role: "viewer",
  };
}

function canonicalValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalValue(record[key])}`)
    .join(",")}}`;
}

function mergedFingerprint(envelope: StudioLiveAnyEnvelope): string {
  const canonical = canonicalValue({
    workId: envelope.workId,
    senderSessionId: envelope.sender.sessionId,
    targetSessionId: envelope.targetSessionId,
    kind: envelope.kind,
    payload: envelope.payload,
  });
  let first = 2_166_136_261;
  let second = 2_246_822_519;
  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index);
    first = Math.imul(first ^ code, 16_777_619);
    second = Math.imul(second ^ code, 3_266_489_917);
  }
  return `${canonical.length}:${(first >>> 0).toString(16)}:${(
    second >>> 0
  ).toString(16)}`;
}

/**
 * Keeps CRDT, locks, chat, and voice on the existing authority transport while independently
 * routing presence, comment invalidations, and screen signaling to purpose-specific providers.
 * A purpose route that is not ready falls back to the primary transport without shrinking the
 * feature surface.
 */
class StudioPurposeRoutedLiveTransport implements StudioLiveTransport {
  readonly mode: StudioLiveTransport["mode"];
  readonly crdtFanout?: StudioLiveTransport["crdtFanout"];
  private readonly context: StudioLiveTransportContext;
  private readonly roomId: string;
  private readonly primary: StudioLiveTransport;
  private readonly coordinator: StudioRealtimeCoordinatorPort;
  private readonly randomId: () => string;
  private readonly now: () => number;
  private readonly listeners = new Set<(value: unknown) => void>();
  private readonly controlListeners = new Set<
    (event: StudioLiveTransportControlEvent) => void
  >();
  private readonly participantBySession = new Map<string, StudioLiveParticipant>();
  private readonly primaryPresenceSessions = new Set<string>();
  private readonly providerPresenceSessions = new Set<string>();
  private readonly legacySequenceBySession = new Map<string, number>();
  private readonly recentMergedFingerprints = new Map<
    string,
    RecentMergedFingerprint
  >();
  private readonly outboundSequence = new Map<StudioRealtimeWorkload, bigint>();
  private readonly queues = new Map<
    StudioRealtimeWorkload,
    StudioLiveAnyEnvelope[]
  >();
  private readonly flushing = new Set<StudioRealtimeWorkload>();
  private readonly activeScreenAnnouncements = new Map<
    string,
    StudioLiveEnvelope<"screen:announce">
  >();
  private unsubscribePrimary: (() => void) | null = null;
  private unsubscribePrimaryControl: (() => void) | null = null;
  private unsubscribeCoordinator: (() => void) | null = null;
  private unsubscribeCoordinatorStatus: (() => void) | null = null;
  private lastPresence: StudioLiveEnvelope<
    "presence:hello" | "presence:heartbeat"
  > | null = null;
  private closed = false;

  constructor(
    context: StudioLiveTransportContext,
    primary: StudioLiveTransport,
    coordinator: StudioRealtimeCoordinatorPort,
    roomId: string,
    randomId: () => string,
    now: () => number,
  ) {
    this.context = context;
    this.roomId = roomId;
    this.primary = primary;
    this.coordinator = coordinator;
    this.mode = primary.mode;
    this.crdtFanout = primary.crdtFanout;
    this.randomId = randomId;
    this.now = now;
    this.participantBySession.set(
      context.participant.sessionId,
      context.participant,
    );
    for (const workload of [
      "presence",
      "comments",
      "screen-signaling",
    ] as const) {
      this.outboundSequence.set(workload, BigInt(1));
      this.queues.set(workload, []);
    }
    if (typeof primary.publishCrdtUpdate !== "function") {
      this.requestCrdtSync = undefined;
      this.respondCrdtSync = undefined;
      this.publishCrdtUpdate = undefined;
      this.subscribeCrdt = undefined;
    }
    if (
      typeof primary.sendInk !== "function" ||
      typeof primary.subscribeInk !== "function"
    ) {
      this.sendInk = undefined;
      this.subscribeInk = undefined;
    }
  }

  get ready(): boolean {
    return !this.closed && this.primary.ready;
  }

  /**
   * Binary lane negotiation is owned by the authority transport. The provider routing table
   * (presence / comments / screen-signaling) has no ink workload or capability in protocol v1,
   * so no lane is invented here — a primary without ink-v2 keeps this route cursor-only.
   */
  get binaryLaneCapabilities(): readonly string[] | undefined {
    return this.primary.binaryLaneCapabilities;
  }

  canonicalSessionId(transportSessionId: string): string {
    return this.toCanonicalSessionId(transportSessionId);
  }

  transportSessionId(canonicalSessionId: string): string | null {
    return this.participantBySession.has(canonicalSessionId) ||
      canonicalSessionId === this.context.participant.sessionId
      ? canonicalSessionId
      : null;
  }

  async connect(): Promise<void> {
    if (this.closed) {
      throw new Error("이미 닫힌 실시간 연결입니다.");
    }
    this.unsubscribePrimary = this.primary.subscribe((value) => {
      const envelope = parseStudioLiveEnvelope(value, {
        expectedWorkId: this.context.workId,
        now: this.now(),
      }) as StudioLiveAnyEnvelope | null;
      if (!envelope) {
        this.emitValue(value);
        return;
      }
      this.emitMergedEnvelope(
        this.canonicalizePrimaryEnvelope(envelope),
        "primary",
      );
    });
    this.unsubscribePrimaryControl =
      this.primary.subscribeControl?.((event) => {
        // Comment invalidations may arrive through both paths during a rolling migration. The
        // existing monotonic comment frontier safely deduplicates them, preserving old clients.
        this.emitControl(this.canonicalizePrimaryControl(event));
      }) ?? null;
    this.unsubscribeCoordinator = this.coordinator.subscribe((event) =>
      this.receivePurposeEvent(event),
    );
    this.unsubscribeCoordinatorStatus = this.coordinator.subscribeStatus(
      (update) => this.onPurposeStatus(update),
    );
    await this.primary.connect();
    void this.coordinator.connect().catch(() => undefined);
  }

  send(envelope: StudioLiveEnvelope): boolean {
    if (!this.ready) return false;
    const typedEnvelope = envelope as StudioLiveAnyEnvelope;
    // Gesture preview has no provider workload/capability in v1. Keep the bounded envelope on the
    // existing primary route instead of implicitly widening Cloudflare tickets or worker scope.
    if (typedEnvelope.kind === "preview:gesture") {
      return this.sendPrimary(typedEnvelope);
    }
    if (
      typedEnvelope.kind === "presence:hello" ||
      typedEnvelope.kind === "presence:heartbeat"
    ) {
      this.lastPresence = typedEnvelope;
    } else if (typedEnvelope.kind === "presence:leave") {
      this.lastPresence = null;
    } else if (typedEnvelope.kind === "screen:announce") {
      this.activeScreenAnnouncements.set(
        typedEnvelope.payload.shareId,
        typedEnvelope,
      );
    } else if (typedEnvelope.kind === "screen:stop") {
      this.activeScreenAnnouncements.delete(typedEnvelope.payload.shareId);
    }
    const workload = workloadForLegacyKind(typedEnvelope.kind);
    if (
      typedEnvelope.kind === "screen:request" &&
      typedEnvelope.payload.shareId === STUDIO_SCREEN_SHARE_DISCOVERY_ID
    ) {
      // Discovery is a Studio control request, not an authorized Durable
      // Object share session. Keep it on the primary transport so opening the
      // screen panel cannot revoke the optional provider route.
      return this.sendPrimary(typedEnvelope);
    }
    if (!workload || !this.coordinator.isReady(workload)) {
      return this.sendPrimary(typedEnvelope);
    }
    return this.enqueuePurpose(workload, typedEnvelope);
  }

  subscribe(listener: (value: unknown) => void): () => void {
    if (this.closed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeControl(
    listener: (event: StudioLiveTransportControlEvent) => void,
  ): () => void {
    if (this.closed) return () => undefined;
    this.controlListeners.add(listener);
    return () => this.controlListeners.delete(listener);
  }

  acquireLock = (request: Parameters<NonNullable<StudioLiveTransport["acquireLock"]>>[0]) => {
    const operation = this.primary.acquireLock;
    return operation
      ? operation
          .call(this.primary, request)
          .then((result) => this.canonicalizeLockAcquireResult(result))
      : Promise.reject(new Error("현재 연결은 서버 잠금을 지원하지 않습니다."));
  };

  releaseLock = (request: Parameters<NonNullable<StudioLiveTransport["releaseLock"]>>[0]) => {
    const operation = this.primary.releaseLock;
    return operation
      ? operation.call(this.primary, request)
      : Promise.reject(new Error("현재 연결은 서버 잠금 해제를 지원하지 않습니다."));
  };

  requestCrdtSync?(
    request: StudioCrdtSyncRequest,
  ): Promise<StudioCrdtSyncResponse | null> {
    const operation = this.primary.requestCrdtSync;
    return operation
      ? operation.call(this.primary, request)
      : Promise.reject(new Error("현재 연결은 CRDT 동기화를 지원하지 않습니다."));
  }

  respondCrdtSync?(
    response: StudioCrdtSyncResponse,
    targetSessionId: string,
  ): boolean {
    const primaryTarget = this.toPrimarySessionId(targetSessionId);
    if (!primaryTarget) return false;
    return (
      this.primary.respondCrdtSync?.call(
        this.primary,
        response,
        primaryTarget,
      ) ?? false
    );
  }

  publishCrdtUpdate?(
    request: StudioCrdtUpdateRequest,
  ): Promise<StudioCrdtUpdateAck> {
    const operation = this.primary.publishCrdtUpdate;
    return operation
      ? operation.call(this.primary, request)
      : Promise.reject(new Error("현재 연결은 CRDT 게시를 지원하지 않습니다."));
  }

  subscribeCrdt?(
    listener: (message: StudioCrdtTransportMessage) => void,
  ): () => void {
    return this.primary.subscribeCrdt?.call(this.primary, listener) ?? (() => undefined);
  }

  /**
   * Ink purpose route: the primary authority lane. Like gesture previews, ink deliberately does
   * not widen Cloudflare tickets or worker scope — routing quantized binary frames through the
   * JSON provider protocol would silently degrade the V18 exact-replication guarantee.
   */
  sendInk?(message: StudioLiveInkWireMessage): boolean {
    const operation = this.primary.sendInk;
    if (!this.ready || typeof operation !== "function") return false;
    return operation.call(this.primary, message);
  }

  subscribeInk?(listener: (value: unknown) => void): () => void {
    if (this.closed) return () => undefined;
    return this.primary.subscribeInk?.call(this.primary, listener) ?? (() => undefined);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribePrimary?.();
    this.unsubscribePrimary = null;
    this.unsubscribePrimaryControl?.();
    this.unsubscribePrimaryControl = null;
    this.unsubscribeCoordinator?.();
    this.unsubscribeCoordinator = null;
    this.unsubscribeCoordinatorStatus?.();
    this.unsubscribeCoordinatorStatus = null;
    this.listeners.clear();
    this.controlListeners.clear();
    this.queues.clear();
    this.flushing.clear();
    this.participantBySession.clear();
    this.primaryPresenceSessions.clear();
    this.providerPresenceSessions.clear();
    this.legacySequenceBySession.clear();
    this.recentMergedFingerprints.clear();
    this.primary.close();
    void this.coordinator.dispose();
  }

  private onPurposeStatus(update: StudioRealtimeWorkloadStatus): void {
    if (this.closed) return;
    if (update.status.state !== "ready") {
      this.flushFallback(update.workload);
      return;
    }
    if (update.workload === "presence" && this.lastPresence) {
      this.enqueuePurpose("presence", {
        ...this.lastPresence,
        sentAt: this.now(),
      } as StudioLiveAnyEnvelope);
    }
    if (update.workload === "screen-signaling") {
      for (const announcement of this.activeScreenAnnouncements.values()) {
        this.enqueuePurpose("screen-signaling", {
          ...announcement,
          sentAt: this.now(),
        } as StudioLiveAnyEnvelope);
      }
    }
    void this.flushPurpose(update.workload);
  }

  private enqueuePurpose(
    workload: StudioRealtimeWorkload,
    envelope: StudioLiveAnyEnvelope,
  ): boolean {
    const queue = this.queues.get(workload);
    if (!queue) return this.sendPrimary(envelope);
    if (
      workload === "presence" &&
      (envelope.kind === "presence:hello" ||
        envelope.kind === "presence:heartbeat" ||
        envelope.kind === "cursor:update")
    ) {
      const category =
        envelope.kind === "cursor:update" ? "cursor" : "presence";
      const replaceIndex = queue.findLastIndex((candidate) =>
        category === "cursor"
          ? candidate.kind === "cursor:update"
          : candidate.kind === "presence:hello" ||
            candidate.kind === "presence:heartbeat",
      );
      if (replaceIndex >= 0) queue[replaceIndex] = envelope;
      else queue.push(envelope);
    } else {
      if (queue.length >= MAX_PENDING_PURPOSE_EVENTS) {
        return this.sendPrimary(envelope);
      }
      queue.push(envelope);
    }
    void this.flushPurpose(workload);
    return true;
  }

  private async flushPurpose(
    workload: StudioRealtimeWorkload,
  ): Promise<void> {
    if (this.closed || this.flushing.has(workload)) return;
    this.flushing.add(workload);
    try {
      const queue = this.queues.get(workload);
      while (queue && queue.length > 0 && !this.closed) {
        const envelope = queue.shift()!;
        if (!this.coordinator.isReady(workload)) {
          this.sendPrimary(envelope);
          continue;
        }
        const sequence = this.outboundSequence.get(workload) ?? BigInt(1);
        let event: StudioRealtimeOutboundEvent;
        try {
          event = this.toPurposeOutbound(envelope, sequence.toString());
          await this.coordinator.publish(event);
          this.outboundSequence.set(workload, sequence + BigInt(1));
        } catch {
          this.sendPrimary(envelope);
        }
      }
    } finally {
      this.flushing.delete(workload);
    }
  }

  private flushFallback(workload: StudioRealtimeWorkload): void {
    const queue = this.queues.get(workload);
    if (!queue) return;
    for (const envelope of queue.splice(0)) this.sendPrimary(envelope);
  }

  private toPurposeOutbound(
    envelope: StudioLiveAnyEnvelope,
    clientSequence: string,
  ): StudioRealtimeOutboundEvent {
    const common = {
      version: 1 as const,
      scope: {
        workId: this.context.workId,
        roomId: this.roomId,
      },
      eventId: this.randomId(),
      idempotencyKey: this.randomId(),
      clientSequence,
      sentAt: new Date(envelope.sentAt).toISOString(),
      senderSessionId: envelope.sender.sessionId,
      targetSessionId: envelope.targetSessionId,
    };
    switch (envelope.kind) {
      case "presence:hello":
      case "presence:heartbeat":
        return {
          ...common,
          workload: "presence",
          kind: "presence.upsert",
          payload: {
            participant: {
              sessionId: envelope.sender.sessionId,
              displayName: envelope.sender.displayName,
              role: envelope.sender.role,
              state:
                envelope.payload.visibility === "active" ? "active" : "idle",
              pageId: envelope.payload.pageId,
              tool: envelope.payload.tool ?? null,
              updatedAt: new Date(envelope.sentAt).toISOString(),
            },
          },
        };
      case "presence:leave":
        return {
          ...common,
          workload: "presence",
          kind: "presence.remove",
          payload: { sessionId: envelope.sender.sessionId, reason: "left" },
        };
      case "cursor:update":
        return {
          ...common,
          workload: "presence",
          kind: "presence.cursor",
          payload: {
            x: envelope.payload.x,
            y: envelope.payload.y,
            pageId: envelope.payload.pageId,
            tool: envelope.payload.tool,
            drawing: envelope.payload.drawing ?? false,
            ...(envelope.payload.strokeColor === undefined
              ? {}
              : { strokeColor: envelope.payload.strokeColor }),
            ...(envelope.payload.strokeWidth === undefined
              ? {}
              : { strokeWidth: envelope.payload.strokeWidth }),
            ...(envelope.payload.strokeOpacity === undefined
              ? {}
              : { strokeOpacity: envelope.payload.strokeOpacity }),
            ...(envelope.payload.points === undefined
              ? {}
              : { points: [...envelope.payload.points] }),
          },
        };
      case "screen:announce":
        return {
          ...common,
          workload: "screen-signaling",
          kind: "screen.announce",
          payload: envelope.payload,
        };
      case "screen:request":
        return {
          ...common,
          workload: "screen-signaling",
          kind: "screen.request",
          payload: envelope.payload,
        };
      case "screen:access":
        return {
          ...common,
          workload: "screen-signaling",
          kind: "screen.access",
          payload: envelope.payload,
        };
      case "webrtc:description":
        return {
          ...common,
          workload: "screen-signaling",
          kind: "screen.description",
          payload: envelope.payload,
        };
      case "webrtc:ice":
        return {
          ...common,
          workload: "screen-signaling",
          kind: "screen.ice",
          payload: envelope.payload,
        };
      case "screen:stop":
        return {
          ...common,
          workload: "screen-signaling",
          kind: "screen.stop",
          payload: envelope.payload,
        };
      default:
        throw new Error("이 실시간 작업은 목적별 경로로 이동하지 않았습니다.");
    }
  }

  private receivePurposeEvent(event: StudioRealtimeInboundEvent): void {
    if (this.closed) return;
    if (
      event.targetSessionId !== null &&
      event.targetSessionId !== this.context.participant.sessionId
    ) {
      return;
    }
    if (event.kind === "comments.changed") {
      const change = {
        version: 1 as const,
        workId: this.context.workId,
        threadId: event.payload.threadId,
        activitySequence: event.payload.activitySequence,
        kind: event.payload.change,
      };
      this.emitControl({ type: "comment-changed", change });
      return;
    }
    if (event.kind === "presence.snapshot") {
      const nextProviderSessions = new Set(
        event.payload.participants.map((participant) => participant.sessionId),
      );
      for (const previousSessionId of this.providerPresenceSessions) {
        if (
          nextProviderSessions.has(previousSessionId) ||
          this.primaryPresenceSessions.has(previousSessionId)
        ) {
          continue;
        }
        this.emitLegacy(previousSessionId, "presence:leave", {}, null);
        this.participantBySession.delete(previousSessionId);
      }
      this.providerPresenceSessions.clear();
      for (const participant of event.payload.participants) {
        this.providerPresenceSessions.add(participant.sessionId);
        this.participantBySession.set(participant.sessionId, {
          sessionId: participant.sessionId,
          displayName: participant.displayName,
          role: participant.role,
        });
        this.emitLegacy(
          participant.sessionId,
          "presence:heartbeat",
          {
            visibility:
              participant.state === "active" ? "active" : "idle",
            pageId: participant.pageId,
            tool: participant.tool,
          },
          null,
        );
      }
      return;
    }
    if (event.kind === "presence.upsert") {
      const participant = event.payload.participant;
      this.providerPresenceSessions.add(participant.sessionId);
      this.participantBySession.set(participant.sessionId, {
        sessionId: participant.sessionId,
        displayName: participant.displayName,
        role: participant.role,
      });
      this.emitLegacy(
        participant.sessionId,
        "presence:heartbeat",
        {
          visibility: participant.state === "active" ? "active" : "idle",
          pageId: participant.pageId,
          tool: participant.tool,
        },
        null,
      );
      return;
    }
    if (event.kind === "presence.remove") {
      this.providerPresenceSessions.delete(event.payload.sessionId);
      if (this.primaryPresenceSessions.has(event.payload.sessionId)) return;
      this.emitLegacy(
        event.payload.sessionId,
        "presence:leave",
        {},
        null,
      );
      this.participantBySession.delete(event.payload.sessionId);
      return;
    }
    if (event.kind === "presence.cursor") {
      this.emitLegacy(
        event.senderSessionId,
        "cursor:update",
        event.payload,
        null,
      );
      return;
    }
    const legacyKind = {
      "screen.announce": "screen:announce",
      "screen.request": "screen:request",
      "screen.access": "screen:access",
      "screen.description": "webrtc:description",
      "screen.ice": "webrtc:ice",
      "screen.stop": "screen:stop",
    }[event.kind] as StudioLiveMessageKind;
    this.emitLegacy(
      event.senderSessionId,
      legacyKind,
      event.payload,
      event.targetSessionId,
    );
  }

  private emitLegacy<Kind extends StudioLiveMessageKind>(
    senderSessionId: string,
    kind: Kind,
    payload: StudioLivePayloadMap[Kind],
    targetSessionId: string | null,
  ): void {
    const sender =
      this.participantBySession.get(senderSessionId) ??
      fallbackParticipant(senderSessionId);
    const envelope = createStudioLiveEnvelope({
      workId: this.context.workId,
      sender,
      sentAt: this.now(),
      // The hybrid stream assigns one sequence across both transport paths below.
      sequence: 1,
      kind,
      targetSessionId,
      payload,
    });
    this.emitMergedEnvelope(envelope as StudioLiveAnyEnvelope, "provider");
  }

  private emitMergedEnvelope(
    envelope: StudioLiveAnyEnvelope,
    source: StudioPurposeEventSource,
  ): void {
    const senderSessionId = envelope.sender.sessionId;
    if (source === "primary") {
      if (
        envelope.kind === "presence:hello" ||
        envelope.kind === "presence:heartbeat"
      ) {
        this.primaryPresenceSessions.add(senderSessionId);
      } else if (envelope.kind === "presence:leave") {
        this.primaryPresenceSessions.delete(senderSessionId);
        if (this.providerPresenceSessions.has(senderSessionId)) return;
      }
    }
    const fingerprint = mergedFingerprint(envelope);
    const observedAt = this.now();
    const previousFingerprint = this.recentMergedFingerprints.get(fingerprint);
    if (
      previousFingerprint &&
      previousFingerprint.source !== source &&
      observedAt - previousFingerprint.observedAt >= 0 &&
      observedAt - previousFingerprint.observedAt <= MERGED_DUPLICATE_TTL_MS
    ) {
      // Consume exactly one cross-path pair. Keeping the opposite source here would suppress the
      // next legitimate heartbeat when provider and fallback cadence interleave.
      this.recentMergedFingerprints.delete(fingerprint);
      return;
    }
    this.rememberMergedFingerprint(fingerprint, { source, observedAt });

    const previousSequence =
      this.legacySequenceBySession.get(senderSessionId) ?? 0;
    if (previousSequence >= Number.MAX_SAFE_INTEGER) return;
    const sequence = previousSequence + 1;
    this.legacySequenceBySession.set(senderSessionId, sequence);
    this.participantBySession.set(senderSessionId, envelope.sender);
    try {
      const mergedEnvelope = createStudioLiveEnvelope({
        workId: this.context.workId,
        sender: envelope.sender,
        sentAt: envelope.sentAt,
        sequence,
        kind: envelope.kind,
        targetSessionId: envelope.targetSessionId,
        payload: envelope.payload,
      });
      this.emitValue(mergedEnvelope);
      if (envelope.kind === "presence:leave") {
        this.participantBySession.delete(senderSessionId);
      }
    } catch {
      // A malformed projection must not poison the independent fallback path.
    }
  }

  private rememberMergedFingerprint(
    fingerprint: string,
    record: RecentMergedFingerprint,
  ): void {
    for (const [candidate, previous] of this.recentMergedFingerprints) {
      if (record.observedAt - previous.observedAt > MERGED_DUPLICATE_TTL_MS) {
        this.recentMergedFingerprints.delete(candidate);
      } else {
        break;
      }
    }
    this.recentMergedFingerprints.delete(fingerprint);
    this.recentMergedFingerprints.set(fingerprint, record);
    while (
      this.recentMergedFingerprints.size > MAX_RECENT_MERGED_FINGERPRINTS
    ) {
      const oldest = this.recentMergedFingerprints.keys().next().value;
      if (typeof oldest !== "string") break;
      this.recentMergedFingerprints.delete(oldest);
    }
  }

  private canonicalizePrimaryEnvelope(
    envelope: StudioLiveAnyEnvelope,
  ): StudioLiveAnyEnvelope {
    return {
      ...envelope,
      sender: {
        ...envelope.sender,
        sessionId: this.toCanonicalSessionId(envelope.sender.sessionId),
      },
      targetSessionId:
        envelope.targetSessionId === null
          ? null
          : this.toCanonicalSessionId(envelope.targetSessionId),
    } as StudioLiveAnyEnvelope;
  }

  private canonicalizePrimaryControl(
    event: StudioLiveTransportControlEvent,
  ): StudioLiveTransportControlEvent {
    if (event.type !== "lock" || event.lock.action !== "acquired") return event;
    return {
      ...event,
      lock: {
        ...event.lock,
        owner: {
          ...event.lock.owner,
          sessionId: this.toCanonicalSessionId(event.lock.owner.sessionId),
        },
      },
    };
  }

  private canonicalizeLockAcquireResult(
    result: StudioLiveLockAcquireResult,
  ): StudioLiveLockAcquireResult {
    if (result.status === "acquired") {
      return {
        ...result,
        lock: {
          ...result.lock,
          owner: {
            ...result.lock.owner,
            sessionId: this.toCanonicalSessionId(
              result.lock.owner.sessionId,
            ),
          },
        },
      };
    }
    if (result.status === "denied" && result.lock) {
      return {
        ...result,
        lock: {
          ...result.lock,
          owner: {
            ...result.lock.owner,
            sessionId: this.toCanonicalSessionId(
              result.lock.owner.sessionId,
            ),
          },
        },
      };
    }
    return result;
  }

  private toCanonicalSessionId(sessionId: string): string {
    return (
      this.primary.canonicalSessionId?.call(this.primary, sessionId) ??
      sessionId
    );
  }

  private toPrimarySessionId(sessionId: string): string | null {
    const translate = this.primary.transportSessionId;
    return translate ? translate.call(this.primary, sessionId) : sessionId;
  }

  private sendPrimary(envelope: StudioLiveAnyEnvelope): boolean {
    if (envelope.targetSessionId === null) return this.primary.send(envelope);
    const targetSessionId = this.toPrimarySessionId(
      envelope.targetSessionId,
    );
    if (!targetSessionId) return false;
    return this.primary.send({
      ...envelope,
      targetSessionId,
    } as StudioLiveAnyEnvelope);
  }

  private emitValue(value: unknown): void {
    for (const listener of this.listeners) {
      try {
        listener(value);
      } catch {
        // A broken UI observer cannot interrupt transport fallback or other Studio subscribers.
      }
    }
  }

  private emitControl(event: StudioLiveTransportControlEvent): void {
    for (const listener of this.controlListeners) {
      try {
        listener(event);
      } catch {
        // Control observers do not own the primary/provider connection lifecycle.
      }
    }
  }
}

export function createStudioPurposeRoutedLiveTransportFactory(
  options: StudioPurposeRoutedLiveTransportFactoryOptions,
): StudioLiveTransportFactory {
  const randomId = options.randomId ?? defaultRandomId;
  const now = options.now ?? Date.now;
  return (context) =>
    new StudioPurposeRoutedLiveTransport(
      context,
      options.primaryFactory(context),
      options.createCoordinator(context),
      options.resolveRoomId?.(context) ?? context.workId,
      randomId,
      now,
    );
}

/**
 * Current production profile: one Cloudflare Durable Object connection owns all three ephemeral
 * workloads. The coordinator remains route-based so a deployment can split comments to Supabase
 * or move screen signaling independently without touching Studio room semantics.
 */
export function createStudioCloudflarePurposeRoutedLiveTransportFactory(
  options: StudioCloudflarePurposeRoutedFactoryOptions,
): StudioLiveTransportFactory {
  return createStudioPurposeRoutedLiveTransportFactory({
    primaryFactory: options.primaryFactory,
    resolveRoomId: (context) =>
      options.roomId?.(context) ?? context.workId,
    createCoordinator: (context) => {
      const providerId = options.providerId ?? "cloudflare-realtime-v1";
      return new StudioRealtimeWorkloadCoordinator({
        scope: {
          workId: context.workId,
          roomId: options.roomId?.(context) ?? context.workId,
        },
        clientInstanceId: context.participant.sessionId,
        sessionId: context.participant.sessionId,
        routes: [
          {
            routeId: "cloudflare-ephemeral",
            workloads: ["presence", "comments", "screen-signaling"],
            capabilities: [...STUDIO_REALTIME_CAPABILITIES],
            providers: [
              createStudioCloudflareRealtimeAdapterFactory({
                providerId,
                realtimeOrigin: options.realtimeOrigin,
              }),
            ],
          },
        ],
        ticketIssuer: createStudioRealtimeHttpTicketIssuer({}),
      });
    },
  });
}
