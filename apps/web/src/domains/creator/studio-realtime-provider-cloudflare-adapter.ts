import {
  REALTIME_PROTOCOL_VERSION,
  REALTIME_TICKET_PROTOCOL_PREFIX,
  REALTIME_WEBSOCKET_PROTOCOL,
  parseRealtimeServerMessage,
  type PresenceSnapshotEntry,
  type RealtimeChannel,
  type RealtimePayload,
  type ServerEventMessage,
  type ServerPresenceSnapshotMessage,
  type ServerReplayMessage,
  type ServerWelcomeMessage,
} from "../../../../../deploy/cloudflare-realtime/src/protocol";

import {
  STUDIO_REALTIME_PROVIDER_LIMITS,
  STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION,
  parseStudioRealtimeInboundEvent,
  type StudioRealtimeConnectionRequest,
  type StudioRealtimeInboundEvent,
  type StudioRealtimeOutboundEvent,
  type StudioRealtimeProviderHello,
  type StudioRealtimePublishAck,
  type StudioRealtimeWorkload,
} from "./studio-realtime-provider-protocol";
import {
  StudioRealtimeProviderFallbackRequiredError,
  type StudioRealtimeProviderAdapter,
  type StudioRealtimeProviderAdapterFactory,
  type StudioRealtimeProviderAdapterHandlers,
  type StudioRealtimeProviderDescriptor,
} from "./studio-realtime-provider-runtime";

const CONNECT_TIMEOUT_MS = 8_000;
const PUBLISH_TIMEOUT_MS = 8_000;
const HEARTBEAT_MS = 20_000;
const PONG_TIMEOUT_MS = 10_000;
const MAX_PROJECTED_EVENTS = 4_096;
const MAX_BUFFERED_NEGOTIATION_EVENTS = 4_096;
const MAX_PRESENCE_SNAPSHOT_ENTRIES =
  STUDIO_REALTIME_PROVIDER_LIMITS.maxPresenceParticipants;
const MAX_PEER_CONNECTIONS = 512;
const WEB_SOCKET_OPEN = 1;

export interface StudioCloudflareRealtimeWebSocketLike {
  readonly readyState: number;
  readonly protocol: string;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: Event | MessageEvent<unknown> | CloseEvent) => void,
  ): void;
  removeEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: Event | MessageEvent<unknown> | CloseEvent) => void,
  ): void;
}

export type StudioCloudflareRealtimeWebSocketFactory = (
  url: string,
  protocols: readonly string[],
) => StudioCloudflareRealtimeWebSocketLike;

export interface StudioCloudflareRealtimeAdapterFactoryOptions {
  readonly providerId: string;
  readonly realtimeOrigin: string;
  readonly createWebSocket?: StudioCloudflareRealtimeWebSocketFactory;
  readonly randomId?: () => string;
  readonly queueMicrotask?: (handler: () => void) => void;
  readonly setTimeout?: (handler: () => void, delay: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
  readonly setInterval?: (handler: () => void, delay: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
  readonly connectTimeoutMs?: number;
  readonly publishTimeoutMs?: number;
}

interface ProjectedEventRecord {
  wireSequence: number;
  readonly workload: StudioRealtimeWorkload;
  readonly localSequence: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly fingerprint: string;
}

interface ProjectionResult {
  readonly record: ProjectedEventRecord;
  readonly duplicate: boolean;
}

interface PendingPublish {
  readonly event: StudioRealtimeOutboundEvent;
  readonly wireClientSequence: number;
  readonly resolve: (ack: StudioRealtimePublishAck) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: unknown;
}

interface PresenceSnapshotAssembly {
  readonly snapshotId: string;
  readonly sequence: number;
  readonly generatedAtMs: number;
  nextPage: number;
  readonly entries: PresenceSnapshotEntry[];
}

interface ConnectHandshake {
  readonly request: StudioRealtimeConnectionRequest;
  readonly resolve: (hello: StudioRealtimeProviderHello) => void;
  readonly reject: (error: Error) => void;
  readonly signal: AbortSignal;
  readonly abort: () => void;
  readonly timeout: unknown;
  readonly completedReplay: Set<StudioRealtimeWorkload>;
  readonly resumeAfter: Map<StudioRealtimeWorkload, number>;
  readonly pendingWireEvents: Map<
    StudioRealtimeWorkload,
    Map<number, ServerEventMessage>
  >;
  readonly bufferedInbound: StudioRealtimeInboundEvent[];
  welcome: ServerWelcomeMessage | null;
  presenceSnapshot: PresenceSnapshotAssembly | null;
  presenceSnapshotComplete: boolean;
  settled: boolean;
}

function exactRealtimeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.origin !== value ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function resolveStudioCloudflareRealtimeOrigin(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed ? exactRealtimeOrigin(trimmed) : null;
}

export function studioCloudflareRealtimeRoomUrl(
  realtimeOrigin: string,
  workId: string,
  roomId: string,
): string {
  const origin = exactRealtimeOrigin(realtimeOrigin);
  if (!origin || !workId || !roomId) {
    throw new Error("Cloudflare 실시간 작업실 주소가 올바르지 않습니다.");
  }
  const url = new URL(origin);
  url.protocol = "wss:";
  url.pathname = `/v1/rooms/${encodeURIComponent(workId)}/${encodeURIComponent(
    roomId,
  )}`;
  return url.toString();
}

function defaultCreateWebSocket(
  url: string,
  protocols: readonly string[],
): StudioCloudflareRealtimeWebSocketLike {
  return new WebSocket(url, [...protocols]);
}

function defaultRandomId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("안전한 실시간 이벤트 식별자를 만들 수 없습니다.");
  }
  return globalThis.crypto.randomUUID();
}

function boundedTiming(value: number | undefined, fallback: number): number {
  return Math.min(
    30_000,
    Math.max(1_000, Math.trunc(Number.isFinite(value) ? value! : fallback)),
  );
}

function canonicalFingerprint(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalFingerprint).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalFingerprint(record[key])}`,
    )
    .join(",")}}`;
}

function sameSet<Value>(
  left: readonly Value[],
  right: readonly Value[],
): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function projectionLocalKey(
  workload: StudioRealtimeWorkload,
  localSequence: string,
  eventId: string,
): string {
  return `${workload}\u0000${localSequence}\u0000${eventId}`;
}

function projectionWireKey(
  workload: StudioRealtimeWorkload,
  wireSequence: number,
): string {
  return `${workload}\u0000${wireSequence}`;
}

class StudioCloudflareSequenceProjection {
  private readonly recordByWire = new Map<string, ProjectedEventRecord>();
  private readonly recordByLocal = new Map<string, ProjectedEventRecord>();
  private readonly latestByWorkload = new Map<
    StudioRealtimeWorkload,
    ProjectedEventRecord
  >();
  private readonly nextLocal = new Map<StudioRealtimeWorkload, bigint>();
  private readonly baselineWireByWorkload = new Map<
    StudioRealtimeWorkload,
    number
  >();

  projectEvent(
    event: ServerEventMessage,
    randomId: () => string,
  ): ProjectionResult {
    const fingerprint = canonicalFingerprint(event);
    const key = projectionWireKey(event.channel, event.sequence);
    const existing = this.recordByWire.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new Error("Cloudflare 실시간 재생 이벤트가 기존 순서와 다릅니다.");
      }
      return { record: existing, duplicate: true };
    }
    const record = this.createRecord(
      event.channel,
      event.sequence,
      fingerprint,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        event.idempotencyKey,
      )
        ? event.idempotencyKey
        : randomId(),
      randomId,
    );
    this.recordByWire.set(key, record);
    this.prune();
    return { record, duplicate: false };
  }

  projectSynthetic(
    workload: StudioRealtimeWorkload,
    wireSequence: number,
    fingerprint: string,
    randomId: () => string,
  ): ProjectedEventRecord {
    const record = this.createRecord(
      workload,
      wireSequence,
      fingerprint,
      randomId(),
      randomId,
    );
    this.prune();
    return record;
  }

  resumeAfter(
    request: StudioRealtimeConnectionRequest,
    workload: StudioRealtimeWorkload,
  ): number {
    const cursor = request.resume.find(
      (candidate) => candidate.workload === workload,
    );
    const baseline = this.baselineWireByWorkload.get(workload) ?? 0;
    if (!cursor) return baseline;
    const record = this.recordByLocal.get(
      projectionLocalKey(workload, cursor.serverSequence, cursor.eventId),
    );
    if (!record) {
      throw new Error("Cloudflare 실시간 재개 위치를 확인할 수 없습니다.");
    }
    return Math.max(record.wireSequence, baseline);
  }

  advanceWireFrontier(
    workload: StudioRealtimeWorkload,
    wireSequence: number,
  ): void {
    this.baselineWireByWorkload.set(
      workload,
      Math.max(
        this.baselineWireByWorkload.get(workload) ?? 0,
        wireSequence,
      ),
    );
    const latest = this.latestByWorkload.get(workload);
    if (latest && wireSequence > latest.wireSequence) {
      latest.wireSequence = wireSequence;
    }
  }

  fork(): StudioCloudflareSequenceProjection {
    const fork = new StudioCloudflareSequenceProjection();
    fork.replaceWith(this);
    return fork;
  }

  replaceWith(source: StudioCloudflareSequenceProjection): void {
    if (source === this) return;
    const clonedRecords = new Map<
      ProjectedEventRecord,
      ProjectedEventRecord
    >();
    const cloneRecord = (
      record: ProjectedEventRecord,
    ): ProjectedEventRecord => {
      const existing = clonedRecords.get(record);
      if (existing) return existing;
      const cloned = { ...record };
      clonedRecords.set(record, cloned);
      return cloned;
    };

    this.recordByWire.clear();
    for (const [key, record] of source.recordByWire) {
      this.recordByWire.set(key, cloneRecord(record));
    }
    this.recordByLocal.clear();
    for (const [key, record] of source.recordByLocal) {
      this.recordByLocal.set(key, cloneRecord(record));
    }
    this.latestByWorkload.clear();
    for (const [workload, record] of source.latestByWorkload) {
      this.latestByWorkload.set(workload, cloneRecord(record));
    }
    this.nextLocal.clear();
    for (const [workload, sequence] of source.nextLocal) {
      this.nextLocal.set(workload, sequence);
    }
    this.baselineWireByWorkload.clear();
    for (const [workload, sequence] of source.baselineWireByWorkload) {
      this.baselineWireByWorkload.set(workload, sequence);
    }
  }

  private createRecord(
    workload: StudioRealtimeWorkload,
    wireSequence: number,
    fingerprint: string,
    idempotencyKey: string,
    randomId: () => string,
  ): ProjectedEventRecord {
    const localSequence = this.nextLocal.get(workload) ?? BigInt(1);
    const record: ProjectedEventRecord = {
      wireSequence,
      workload,
      localSequence: localSequence.toString(),
      eventId: randomId(),
      idempotencyKey,
      fingerprint,
    };
    this.nextLocal.set(workload, localSequence + BigInt(1));
    this.recordByLocal.set(
      projectionLocalKey(workload, record.localSequence, record.eventId),
      record,
    );
    this.latestByWorkload.set(workload, record);
    return record;
  }

  private prune(): void {
    while (this.recordByWire.size > MAX_PROJECTED_EVENTS) {
      const oldestKey = this.recordByWire.keys().next().value;
      if (typeof oldestKey !== "string") break;
      const record = this.recordByWire.get(oldestKey);
      this.recordByWire.delete(oldestKey);
      if (
        record &&
        this.latestByWorkload.get(record.workload) !== record
      ) {
        this.recordByLocal.delete(
          projectionLocalKey(
            record.workload,
            record.localSequence,
            record.eventId,
          ),
        );
      }
    }
    while (this.recordByLocal.size > MAX_PROJECTED_EVENTS) {
      const oldestKey = this.recordByLocal.keys().next().value;
      if (typeof oldestKey !== "string") break;
      const record = this.recordByLocal.get(oldestKey);
      if (
        record &&
        this.latestByWorkload.get(record.workload) === record
      ) {
        this.recordByLocal.delete(oldestKey);
        this.recordByLocal.set(oldestKey, record);
        continue;
      }
      this.recordByLocal.delete(oldestKey);
    }
  }
}

function targetClientId(payload: RealtimePayload): string | null {
  return "targetClientId" in payload ? payload.targetClientId : null;
}

function inboundEvent(
  event: ServerEventMessage,
  projection: ProjectedEventRecord,
  scope: StudioRealtimeConnectionRequest["scope"],
): StudioRealtimeInboundEvent {
  const common = {
    version: STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION,
    scope,
    eventId: projection.eventId,
    idempotencyKey: projection.idempotencyKey,
    serverSequence: projection.localSequence,
    sentAt: new Date(event.serverAtMs).toISOString(),
    senderSessionId: event.clientId,
    targetSessionId: targetClientId(event.payload),
  } as const;
  switch (event.payload.kind) {
    case "presence.update":
      return {
        ...common,
        workload: "presence",
        kind: "presence.upsert",
        payload: {
          participant: {
            sessionId: event.clientId,
            displayName: event.payload.profile.displayName,
            role: event.payload.profile.role,
            state: event.payload.profile.state,
            pageId: event.payload.pageId,
            tool: event.payload.tool,
            updatedAt: new Date(event.serverAtMs).toISOString(),
          },
        },
      };
    case "presence.cursor":
      return {
        ...common,
        workload: "presence",
        kind: "presence.cursor",
        payload: {
          x: event.payload.x,
          y: event.payload.y,
          pageId: event.payload.pageId,
          tool: event.payload.tool,
          drawing: event.payload.drawing,
          ...(event.payload.strokeColor === undefined
            ? {}
            : { strokeColor: event.payload.strokeColor }),
          ...(event.payload.strokeWidth === undefined
            ? {}
            : { strokeWidth: event.payload.strokeWidth }),
          ...(event.payload.strokeOpacity === undefined
            ? {}
            : { strokeOpacity: event.payload.strokeOpacity }),
          ...(event.payload.points === undefined
            ? {}
            : { points: [...event.payload.points] }),
        },
      };
    case "presence.leave":
      return {
        ...common,
        workload: "presence",
        kind: "presence.remove",
        payload: { sessionId: event.clientId, reason: "left" },
      };
    case "comment.changed":
      return {
        ...common,
        workload: "comments",
        kind: "comments.changed",
        payload: {
          threadId: event.payload.threadId,
          activitySequence: event.payload.activitySequence,
          change: event.payload.change,
        },
      };
    case "signal.announce":
      return {
        ...common,
        workload: "screen-signaling",
        kind: "screen.announce",
        payload: {
          shareId: event.payload.shareId,
          label: event.payload.label,
        },
      };
    case "signal.request":
      return {
        ...common,
        workload: "screen-signaling",
        kind: "screen.request",
        payload: { shareId: event.payload.shareId },
      };
    case "signal.access":
      return {
        ...common,
        workload: "screen-signaling",
        kind: "screen.access",
        payload: {
          shareId: event.payload.shareId,
          decision: event.payload.decision,
        },
      };
    case "signal.offer":
    case "signal.answer":
      return {
        ...common,
        workload: "screen-signaling",
        kind: "screen.description",
        payload: {
          shareId: event.payload.sessionId,
          type: event.payload.kind === "signal.offer" ? "offer" : "answer",
          sdp: event.payload.sdp,
        },
      };
    case "signal.ice":
      return {
        ...common,
        workload: "screen-signaling",
        kind: "screen.ice",
        payload: {
          shareId: event.payload.sessionId,
          candidate: event.payload.candidate.candidate,
          sdpMid: event.payload.candidate.sdpMid,
          sdpMLineIndex: event.payload.candidate.sdpMLineIndex,
          usernameFragment: event.payload.candidate.usernameFragment,
        },
      };
    case "signal.stop":
      return {
        ...common,
        workload: "screen-signaling",
        kind: "screen.stop",
        payload: { shareId: event.payload.shareId },
      };
  }
}

function peerConnectionKey(
  shareId: string,
  leftSessionId: string,
  rightSessionId: string,
): string {
  const sessions = [leftSessionId, rightSessionId].sort();
  return `${shareId}\u0000${sessions[0]}\u0000${sessions[1]}`;
}

class StudioCloudflareRealtimeAdapter
implements StudioRealtimeProviderAdapter {
  readonly descriptor: StudioRealtimeProviderDescriptor;
  private readonly realtimeOrigin: string;
  private readonly committedProjection: StudioCloudflareSequenceProjection;
  private projection: StudioCloudflareSequenceProjection;
  private readonly createWebSocket: StudioCloudflareRealtimeWebSocketFactory;
  private readonly randomId: () => string;
  private readonly enqueueMicrotask: (handler: () => void) => void;
  private readonly scheduleTimeout: (handler: () => void, delay: number) => unknown;
  private readonly cancelTimeout: (handle: unknown) => void;
  private readonly scheduleInterval: (handler: () => void, delay: number) => unknown;
  private readonly cancelInterval: (handle: unknown) => void;
  private readonly connectTimeoutMs: number;
  private readonly publishTimeoutMs: number;
  private readonly pending = new Map<string, PendingPublish>();
  private readonly activeConnectionsByClient = new Map<string, Set<string>>();
  private readonly peerConnectionByPair = new Map<string, string>();
  private readonly activationBuffer: StudioRealtimeInboundEvent[] = [];
  private socket: StudioCloudflareRealtimeWebSocketLike | null = null;
  private request: StudioRealtimeConnectionRequest | null = null;
  private handlers: StudioRealtimeProviderAdapterHandlers | null = null;
  private welcome: ServerWelcomeMessage | null = null;
  private handshake: ConnectHandshake | null = null;
  private heartbeat: unknown = null;
  private pongDeadline: unknown = null;
  private activationPending = false;
  private wireClientSequence = 0;
  private closed = false;

  constructor(
    options: StudioCloudflareRealtimeAdapterFactoryOptions,
    projection: StudioCloudflareSequenceProjection,
  ) {
    this.descriptor = Object.freeze({
      providerId: options.providerId,
      kind: "custom",
      protocolVersion: STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION,
    });
    const realtimeOrigin = resolveStudioCloudflareRealtimeOrigin(
      options.realtimeOrigin,
    );
    if (!realtimeOrigin) {
      throw new Error("Cloudflare 실시간 origin이 올바르지 않습니다.");
    }
    this.realtimeOrigin = realtimeOrigin;
    this.committedProjection = projection;
    this.projection = projection;
    this.createWebSocket = options.createWebSocket ?? defaultCreateWebSocket;
    this.randomId = options.randomId ?? defaultRandomId;
    this.enqueueMicrotask =
      options.queueMicrotask ??
      ((handler) => globalThis.queueMicrotask(handler));
    this.scheduleTimeout =
      options.setTimeout ??
      ((handler, delay) => globalThis.setTimeout(handler, delay));
    this.cancelTimeout =
      options.clearTimeout ??
      ((handle) =>
        globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.scheduleInterval =
      options.setInterval ??
      ((handler, delay) => globalThis.setInterval(handler, delay));
    this.cancelInterval =
      options.clearInterval ??
      ((handle) =>
        globalThis.clearInterval(handle as ReturnType<typeof setInterval>));
    this.connectTimeoutMs = boundedTiming(
      options.connectTimeoutMs,
      CONNECT_TIMEOUT_MS,
    );
    this.publishTimeoutMs = boundedTiming(
      options.publishTimeoutMs,
      PUBLISH_TIMEOUT_MS,
    );
  }

  connect(
    request: StudioRealtimeConnectionRequest,
    ticket: string,
    handlers: StudioRealtimeProviderAdapterHandlers,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (this.closed || this.socket || signal.aborted) {
      return Promise.reject(
        new DOMException("The operation was aborted.", "AbortError"),
      );
    }
    this.projection = this.committedProjection.fork();
    this.request = request;
    this.handlers = handlers;
    const socket = this.createWebSocket(
      studioCloudflareRealtimeRoomUrl(
        this.realtimeOrigin,
        request.scope.workId,
        request.scope.roomId,
      ),
      [
        REALTIME_WEBSOCKET_PROTOCOL,
        `${REALTIME_TICKET_PROTOCOL_PREFIX}${ticket}`,
      ],
    );
    this.socket = socket;
    this.installSteadyListeners(socket);

    return new Promise<StudioRealtimeProviderHello>((resolve, reject) => {
      const abort = () => {
        this.failHandshake(
          new DOMException("The operation was aborted.", "AbortError"),
          1000,
          "aborted",
        );
      };
      const timeout = this.scheduleTimeout(() => {
        this.failHandshake(
          new Error("Cloudflare 실시간 연결 시간이 초과되었습니다."),
          4000,
          "connect-timeout",
        );
      }, this.connectTimeoutMs);
      this.handshake = {
        request,
        resolve,
        reject,
        signal,
        abort,
        timeout,
        completedReplay: new Set(),
        resumeAfter: new Map(),
        pendingWireEvents: new Map(
          request.requiredWorkloads.map((workload) => [
            workload,
            new Map<number, ServerEventMessage>(),
          ]),
        ),
        bufferedInbound: [],
        welcome: null,
        presenceSnapshot: null,
        presenceSnapshotComplete:
          !request.requiredWorkloads.includes("presence"),
        settled: false,
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }

  publish(
    event: StudioRealtimeOutboundEvent,
    signal: AbortSignal,
  ): Promise<unknown> {
    const socket = this.socket;
    const welcome = this.welcome;
    const request = this.request;
    if (
      this.closed ||
      signal.aborted ||
      !socket ||
      socket.readyState !== WEB_SOCKET_OPEN ||
      !welcome ||
      !request ||
      this.handshake
    ) {
      return Promise.reject(
        new DOMException("The operation was aborted.", "AbortError"),
      );
    }
    let payload: RealtimePayload;
    try {
      payload = this.outboundPayload(event);
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new Error("실시간 이벤트가 올바르지 않습니다."),
      );
    }
    if (this.pending.size > 0) {
      return Promise.reject(
        new Error("이전 실시간 이벤트의 발행 확인을 기다리고 있습니다."),
      );
    }
    const wireClientSequence = this.wireClientSequence + 1;
    return new Promise<StudioRealtimePublishAck>((resolve, reject) => {
      const abort = () => {
        this.completePending(
          event.idempotencyKey,
          new DOMException("The operation was aborted.", "AbortError"),
        );
        // The Worker may have committed the frame before the caller aborted,
        // so the client sequence can no longer be proven. Reconnect with a
        // fresh socket instead of guessing and poisoning later publishes.
        this.disconnect("network-lost", true);
      };
      const timeout = this.scheduleTimeout(() => {
        signal.removeEventListener("abort", abort);
        this.completePending(
          event.idempotencyKey,
          new Error("Cloudflare 실시간 발행 확인 시간이 초과되었습니다."),
        );
        this.disconnect("network-lost", true);
      }, this.publishTimeoutMs);
      this.pending.set(event.idempotencyKey, {
        event,
        wireClientSequence,
        resolve: (ack) => {
          signal.removeEventListener("abort", abort);
          resolve(ack);
        },
        reject: (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
        timeout,
      });
      signal.addEventListener("abort", abort, { once: true });
      try {
        this.sendRaw({
          version: REALTIME_PROTOCOL_VERSION,
          type: "publish",
          idempotencyKey: event.idempotencyKey,
          clientSequence: wireClientSequence,
          sentAtMs: Date.parse(event.sentAt),
          channel: event.workload,
          payload,
        });
      } catch (error) {
        this.completePending(
          event.idempotencyKey,
          error instanceof Error
            ? error
            : new Error("Cloudflare 실시간 이벤트를 보내지 못했습니다."),
        );
        this.disconnect("network-lost", true);
      }
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.handshake) {
      const handshake = this.handshake;
      this.handshake = null;
      handshake.settled = true;
      this.cancelTimeout(handshake.timeout);
      handshake.signal.removeEventListener("abort", handshake.abort);
      handshake.reject(
        new DOMException("The operation was aborted.", "AbortError"),
      );
    }
    this.stopHeartbeat();
    this.removeSteadyListeners();
    this.closeSocket(1000, "client-close");
    this.socket = null;
    this.request = null;
    this.handlers = null;
    this.welcome = null;
    this.activationPending = false;
    this.activationBuffer.length = 0;
    this.activeConnectionsByClient.clear();
    this.peerConnectionByPair.clear();
    for (const key of [...this.pending.keys()]) {
      this.completePending(
        key,
        new DOMException("The operation was aborted.", "AbortError"),
      );
    }
  }

  private readonly onOpen = () => {
    const socket = this.socket;
    if (!socket || socket.protocol === REALTIME_WEBSOCKET_PROTOCOL) return;
    this.failHandshake(
      new Error("Cloudflare 실시간 하위 프로토콜이 다릅니다."),
      1002,
      "protocol-mismatch",
    );
  };

  private readonly onSteadyMessage = (
    rawEvent: Event | MessageEvent<unknown>,
  ) => {
    const data = (rawEvent as MessageEvent<unknown>).data;
    if (typeof data !== "string") {
      this.failOrDisconnect("Cloudflare 실시간 이진 프레임은 허용되지 않습니다.");
      return;
    }
    const parsed = parseRealtimeServerMessage(data);
    if (!parsed.ok) {
      this.failOrDisconnect("Cloudflare 실시간 응답 계약이 올바르지 않습니다.");
      return;
    }
    const message = parsed.value;
    if (message.type === "pong") {
      this.clearPongDeadline();
      return;
    }
    if (message.type === "welcome") {
      this.handleWelcome(message);
      return;
    }
    const handshake = this.handshake;
    if (handshake && !handshake.welcome) {
      this.failHandshake(
        new Error("Cloudflare 실시간 welcome이 필요합니다."),
        1002,
        "welcome-required",
      );
      return;
    }
    if (message.type === "ack") {
      this.handleAck(message);
      return;
    }
    if (message.type === "error") {
      if (handshake && !message.idempotencyKey) {
        this.failHandshake(
          new Error("Cloudflare 실시간 재개가 거부되었습니다."),
          1008,
          message.code,
        );
        return;
      }
      if (message.idempotencyKey) {
        this.completePending(
          message.idempotencyKey,
          new Error("Cloudflare 실시간 발행이 거부되었습니다."),
        );
        if (message.code === "session-expired") {
          this.disconnect("ticket-expired", true);
        } else if (message.code === "scope-denied") {
          this.disconnect("access-revoked", false);
        }
        return;
      }
      if (!message.retryable) {
        this.disconnect(
          message.code === "session-expired"
            ? "ticket-expired"
            : message.code === "scope-denied"
              ? "access-revoked"
              : "protocol-error",
          message.code === "session-expired",
        );
      }
      return;
    }
    if (message.type === "presence-snapshot") {
      if (!handshake) {
        this.disconnect("protocol-error", false);
        return;
      }
      this.handlePresenceSnapshot(handshake, message);
      return;
    }
    if (message.type === "replay") {
      if (!handshake) {
        this.disconnect("protocol-error", false);
        return;
      }
      this.handleReplay(handshake, message);
      return;
    }
    if (handshake) {
      if (handshake.completedReplay.has(message.channel)) {
        try {
          const inbound = this.processWireEvent(message, false);
          if (inbound) handshake.bufferedInbound.push(inbound);
        } catch {
          this.failHandshake(
            new Error("Cloudflare 실시간 live 이벤트를 변환하지 못했습니다."),
            1002,
            "live-event-invalid",
          );
        }
      } else {
        this.bufferHandshakeWireEvent(handshake, message);
      }
      return;
    }
    try {
      this.processWireEvent(message);
    } catch {
      this.disconnect("protocol-error", false);
    }
  };

  private readonly onSteadyClose = (rawEvent: Event | CloseEvent) => {
    const closeEvent = rawEvent as CloseEvent;
    if (this.handshake) {
      this.failHandshake(
        new Error("Cloudflare 실시간 연결이 닫혔습니다."),
        closeEvent.code || 1000,
        "closed",
      );
      return;
    }
    this.disconnect(
      closeEvent.code === 4003 ? "ticket-expired" : "network-lost",
      true,
    );
  };

  private readonly onSteadyError = () => {
    if (this.handshake) {
      this.failHandshake(
        new Error("Cloudflare 실시간 연결에 실패했습니다."),
        1000,
        "network-error",
      );
      return;
    }
    this.disconnect("network-lost", true);
  };

  private handleWelcome(welcome: ServerWelcomeMessage): void {
    const handshake = this.handshake;
    if (!handshake || handshake.welcome) {
      this.failOrDisconnect("Cloudflare 실시간 welcome이 중복되었습니다.");
      return;
    }
    const request = handshake.request;
    if (
      welcome.workId !== request.scope.workId ||
      welcome.roomId !== request.scope.roomId ||
      welcome.clientId !== request.sessionId ||
      !sameSet(welcome.scopes, request.requiredWorkloads)
    ) {
      this.failHandshake(
        new Error("Cloudflare 실시간 입장 범위가 요청과 다릅니다."),
        1008,
        "scope-mismatch",
      );
      return;
    }
    handshake.welcome = welcome;
    this.welcome = welcome;
    for (const workload of request.requiredWorkloads) {
      if (workload === "presence") continue;
      let afterSequence: number;
      try {
        afterSequence = this.projection.resumeAfter(request, workload);
      } catch (error) {
        this.failHandshake(
          error instanceof Error
            ? error
            : new Error("Cloudflare 실시간 재개 위치가 올바르지 않습니다."),
          1008,
          "resume-invalid",
        );
        return;
      }
      const channelState = welcome.channelStates[workload];
      if (
        afterSequence < Math.max(0, channelState.replayFloorSequence - 1) ||
        afterSequence > channelState.currentSequence
      ) {
        // Unlike presence, comments and active screen-share state do not yet
        // have an authoritative provider snapshot. Silently skipping a replay
        // gap could lose user-visible state, so fail this optional route over
        // to the always-connected primary authority.
        this.failHandshake(
          new StudioRealtimeProviderFallbackRequiredError(
            this.descriptor.providerId,
          ),
          1008,
          "resume-gap",
        );
        return;
      }
      this.sendResume(workload, afterSequence);
    }
    if (!request.requiredWorkloads.includes("presence")) {
      this.maybeCompleteHandshake(handshake);
    }
  }

  private handlePresenceSnapshot(
    handshake: ConnectHandshake,
    message: ServerPresenceSnapshotMessage,
  ): void {
    if (
      !handshake.request.requiredWorkloads.includes("presence") ||
      handshake.presenceSnapshotComplete
    ) {
      this.failHandshake(
        new Error("Cloudflare presence snapshot 순서가 올바르지 않습니다."),
        1002,
        "snapshot-unexpected",
      );
      return;
    }
    const assembly = handshake.presenceSnapshot;
    if (
      message.sequence !==
      handshake.welcome?.channelStates.presence.currentSequence
    ) {
      this.failHandshake(
        new Error("Cloudflare presence snapshot 순서점이 welcome과 다릅니다."),
        1002,
        "snapshot-sequence-mismatch",
      );
      return;
    }
    if (!assembly) {
      if (message.page !== 0) {
        this.failHandshake(
          new Error("Cloudflare presence snapshot 첫 페이지가 없습니다."),
          1002,
          "snapshot-page-gap",
        );
        return;
      }
      handshake.presenceSnapshot = {
        snapshotId: message.snapshotId,
        sequence: message.sequence,
        generatedAtMs: message.generatedAtMs,
        nextPage: 1,
        entries: [...message.entries],
      };
    } else {
      if (
        message.snapshotId !== assembly.snapshotId ||
        message.sequence !== assembly.sequence ||
        message.generatedAtMs !== assembly.generatedAtMs ||
        message.page !== assembly.nextPage
      ) {
        this.failHandshake(
          new Error("Cloudflare presence snapshot 페이지가 연속적이지 않습니다."),
          1002,
          "snapshot-page-gap",
        );
        return;
      }
      assembly.nextPage += 1;
      assembly.entries.push(...message.entries);
    }
    const current = handshake.presenceSnapshot!;
    if (current.entries.length > MAX_PRESENCE_SNAPSHOT_ENTRIES) {
      this.failHandshake(
        new Error("Cloudflare presence snapshot 참가자가 너무 많습니다."),
        1009,
        "snapshot-too-large",
      );
      return;
    }
    if (!message.complete) return;
    try {
      handshake.bufferedInbound.push(
        ...this.projectPresenceSnapshot(handshake.request, current),
      );
    } catch {
      this.failHandshake(
        new Error("Cloudflare presence snapshot을 변환하지 못했습니다."),
        1002,
        "snapshot-invalid",
      );
      return;
    }
    handshake.presenceSnapshotComplete = true;
    this.sendResume("presence", current.sequence);
  }

  private handleReplay(
    handshake: ConnectHandshake,
    message: ServerReplayMessage,
  ): void {
    if (
      !handshake.request.requiredWorkloads.includes(message.channel) ||
      handshake.completedReplay.has(message.channel)
    ) {
      this.failHandshake(
        new Error("Cloudflare 실시간 재생 채널이 올바르지 않습니다."),
        1002,
        "replay-unexpected",
      );
      return;
    }
    const expectedAfter = handshake.resumeAfter.get(message.channel);
    if (
      expectedAfter === undefined ||
      message.fromSequence !== expectedAfter + 1 ||
      message.toSequence < expectedAfter ||
      message.currentSequence < message.toSequence ||
      (!message.complete && message.toSequence <= expectedAfter) ||
      (message.complete &&
        message.toSequence !== message.currentSequence)
    ) {
      this.failHandshake(
        new Error("Cloudflare 실시간 재생 시작점이 요청과 다릅니다."),
        1002,
        "replay-frontier-mismatch",
      );
      return;
    }
    for (const event of message.events) {
      if (
        event.channel !== message.channel ||
        event.sequence < message.fromSequence ||
        event.sequence > message.toSequence
      ) {
        this.failHandshake(
          new Error("Cloudflare 실시간 재생 이벤트 범위가 올바르지 않습니다."),
          1002,
          "replay-range-invalid",
        );
        return;
      }
      this.bufferHandshakeWireEvent(handshake, event);
    }
    if (!message.complete) {
      handshake.resumeAfter.set(message.channel, message.toSequence);
      this.sendResume(message.channel, message.toSequence);
      return;
    }
    const pending = handshake.pendingWireEvents.get(message.channel);
    if (!pending) {
      this.failHandshake(
        new Error("Cloudflare 실시간 재생 버퍼가 없습니다."),
        1002,
        "replay-buffer-missing",
      );
      return;
    }
    for (const event of [...pending.values()].sort(
      (left, right) => left.sequence - right.sequence,
    )) {
      try {
        const inbound = this.processWireEvent(event, false);
        if (inbound) handshake.bufferedInbound.push(inbound);
      } catch {
        this.failHandshake(
          new Error("Cloudflare 실시간 재생 이벤트를 변환하지 못했습니다."),
          1002,
          "replay-invalid",
        );
        return;
      }
    }
    pending.clear();
    this.projection.advanceWireFrontier(
      message.channel,
      message.toSequence,
    );
    handshake.completedReplay.add(message.channel);
    this.maybeCompleteHandshake(handshake);
  }

  private bufferHandshakeWireEvent(
    handshake: ConnectHandshake,
    event: ServerEventMessage,
  ): void {
    const pending = handshake.pendingWireEvents.get(event.channel);
    if (!pending || handshake.completedReplay.has(event.channel)) {
      this.failHandshake(
        new Error("Cloudflare 실시간 이벤트 채널이 요청과 다릅니다."),
        1002,
        "event-channel-invalid",
      );
      return;
    }
    const previous = pending.get(event.sequence);
    if (
      previous &&
      canonicalFingerprint(previous) !== canonicalFingerprint(event)
    ) {
      this.failHandshake(
        new Error("Cloudflare 실시간 이벤트 순서가 충돌했습니다."),
        1002,
        "event-sequence-conflict",
      );
      return;
    }
    pending.set(event.sequence, event);
    let buffered = 0;
    for (const events of handshake.pendingWireEvents.values()) {
      buffered += events.size;
    }
    if (buffered > MAX_BUFFERED_NEGOTIATION_EVENTS) {
      this.failHandshake(
        new StudioRealtimeProviderFallbackRequiredError(
          this.descriptor.providerId,
        ),
        1009,
        "replay-too-large",
      );
    }
  }

  private maybeCompleteHandshake(handshake: ConnectHandshake): void {
    if (
      this.handshake !== handshake ||
      !handshake.welcome ||
      !handshake.presenceSnapshotComplete ||
      handshake.completedReplay.size !==
        handshake.request.requiredWorkloads.length
    ) {
      return;
    }
    this.committedProjection.replaceWith(this.projection);
    this.projection = this.committedProjection;
    handshake.settled = true;
    this.handshake = null;
    this.cancelTimeout(handshake.timeout);
    handshake.signal.removeEventListener("abort", handshake.abort);
    this.activationPending = true;
    this.activationBuffer.push(...handshake.bufferedInbound);
    const hello: StudioRealtimeProviderHello = {
      version: STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION,
      providerId: this.descriptor.providerId,
      providerSessionId: handshake.welcome.connectionId,
      scope: handshake.request.scope,
      acceptedWorkloads: [...handshake.request.requiredWorkloads],
      capabilities: [...handshake.request.requiredCapabilities],
      resume: handshake.request.requiredWorkloads.map((workload) => {
        const cursor = handshake.request.resume.find(
          (candidate) => candidate.workload === workload,
        );
        return cursor
          ? {
              workload,
              status: "resumed" as const,
              serverSequence: cursor.serverSequence,
            }
          : {
              workload,
              status: "fresh" as const,
              serverSequence: "0",
            };
      }),
      limits: {
        maxEventBytes: STUDIO_REALTIME_PROVIDER_LIMITS.maxEventBytes,
        heartbeatMs: HEARTBEAT_MS,
      },
    };
    this.startHeartbeat();
    handshake.resolve(hello);
    this.enqueueMicrotask(() => this.flushActivationBuffer());
  }

  private projectPresenceSnapshot(
    request: StudioRealtimeConnectionRequest,
    snapshot: PresenceSnapshotAssembly,
  ): StudioRealtimeInboundEvent[] {
    const connections = new Map<string, Set<string>>();
    const participants = new Map<
      string,
      {
        sessionId: string;
        displayName: string;
        role: "owner" | "admin" | "editor" | "commenter" | "viewer";
        state: "active" | "idle" | "away";
        pageId: string | null;
        tool: string | null;
        updatedAt: string;
      }
    >();
    const generatedAt = new Date(snapshot.generatedAtMs).toISOString();
    for (const entry of snapshot.entries) {
      const active = connections.get(entry.clientId) ?? new Set<string>();
      active.add(entry.connectionId);
      connections.set(entry.clientId, active);
      if (entry.update) {
        participants.set(entry.clientId, {
          sessionId: entry.clientId,
          displayName: entry.update.profile.displayName,
          role: entry.update.profile.role,
          state: entry.update.profile.state,
          pageId: entry.update.pageId,
          tool: entry.update.tool,
          updatedAt: generatedAt,
        });
      }
    }
    const candidateProjection = this.projection.fork();
    const snapshotProjection = candidateProjection.projectSynthetic(
      "presence",
      snapshot.sequence,
      canonicalFingerprint(snapshot),
      this.randomId,
    );
    const result: StudioRealtimeInboundEvent[] = [
      {
        version: STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION,
        scope: request.scope,
        workload: "presence",
        kind: "presence.snapshot",
        eventId: snapshotProjection.eventId,
        idempotencyKey: snapshotProjection.idempotencyKey,
        serverSequence: snapshotProjection.localSequence,
        sentAt: generatedAt,
        senderSessionId: request.sessionId,
        targetSessionId: null,
        payload: { participants: [...participants.values()] },
      },
    ];
    for (const entry of snapshot.entries) {
      if (!entry.cursor) continue;
      const cursorProjection = candidateProjection.projectSynthetic(
        "presence",
        snapshot.sequence,
        canonicalFingerprint({
          snapshotId: snapshot.snapshotId,
          connectionId: entry.connectionId,
          cursor: entry.cursor,
        }),
        this.randomId,
      );
      result.push({
        version: STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION,
        scope: request.scope,
        workload: "presence",
        kind: "presence.cursor",
        eventId: cursorProjection.eventId,
        idempotencyKey: cursorProjection.idempotencyKey,
        serverSequence: cursorProjection.localSequence,
        sentAt: generatedAt,
        senderSessionId: entry.clientId,
        targetSessionId: null,
        payload: {
          x: entry.cursor.x,
          y: entry.cursor.y,
          pageId: entry.cursor.pageId,
          tool: entry.cursor.tool,
          drawing: entry.cursor.drawing,
          ...(entry.cursor.strokeColor === undefined
            ? {}
            : { strokeColor: entry.cursor.strokeColor }),
          ...(entry.cursor.strokeWidth === undefined
            ? {}
            : { strokeWidth: entry.cursor.strokeWidth }),
          ...(entry.cursor.strokeOpacity === undefined
            ? {}
            : { strokeOpacity: entry.cursor.strokeOpacity }),
        },
      });
    }
    const parsed = result.map((event) =>
      parseStudioRealtimeInboundEvent(event, request.scope),
    );
    if (parsed.some((event) => event === null)) {
      throw new Error(
        "Cloudflare presence snapshot이 Studio 계약과 다릅니다.",
      );
    }
    this.projection.replaceWith(candidateProjection);
    this.activeConnectionsByClient.clear();
    for (const [clientId, active] of connections) {
      this.activeConnectionsByClient.set(clientId, active);
    }
    return parsed as StudioRealtimeInboundEvent[];
  }

  private processWireEvent(
    event: ServerEventMessage,
    emit = true,
  ): StudioRealtimeInboundEvent | null {
    const request = this.request;
    if (!request || !request.requiredWorkloads.includes(event.channel)) {
      throw new Error("Cloudflare 실시간 이벤트 채널이 요청과 다릅니다.");
    }
    const target = targetClientId(event.payload);
    if (target && target !== request.sessionId) {
      if (event.clientId !== request.sessionId) {
        throw new Error("Cloudflare 실시간 대상 이벤트가 다른 세션을 가리킵니다.");
      }
      this.projection.advanceWireFrontier(event.channel, event.sequence);
      return null;
    }
    // The worker echoes accepted publishes to their sender. ACK is the local commit authority;
    // projecting the echo would duplicate local presence/screen state.
    if (event.clientId === request.sessionId) {
      this.projection.advanceWireFrontier(event.channel, event.sequence);
      return null;
    }
    const candidateProjection = this.projection.fork();
    const projection = candidateProjection.projectEvent(
      event,
      this.randomId,
    );
    if (projection.duplicate) return null;
    const inbound = inboundEvent(event, projection.record, request.scope);
    const parsed = parseStudioRealtimeInboundEvent(inbound, request.scope);
    if (!parsed) {
      // The Worker and product schemas are independently versioned. Skip a
      // worker-valid value that cannot enter Studio without consuming a local
      // sequence; the wire baseline prevents an endless replay loop.
      this.projection.advanceWireFrontier(event.channel, event.sequence);
      return null;
    }
    if (event.channel === "presence") {
      const active =
        this.activeConnectionsByClient.get(event.clientId) ??
        new Set<string>();
      if (event.payload.kind === "presence.leave") {
        active.delete(event.connectionId);
        if (active.size > 0) {
          this.activeConnectionsByClient.set(event.clientId, active);
          this.projection.advanceWireFrontier(event.channel, event.sequence);
          return null;
        }
        this.activeConnectionsByClient.delete(event.clientId);
      } else {
        active.add(event.connectionId);
        this.activeConnectionsByClient.set(event.clientId, active);
      }
    }
    if (!this.validateInboundPeerConnection(event, request.sessionId)) {
      this.projection.advanceWireFrontier(event.channel, event.sequence);
      return null;
    }
    this.projection.replaceWith(candidateProjection);
    if (emit) this.emitInbound(parsed);
    return parsed;
  }

  private outboundPayload(event: StudioRealtimeOutboundEvent): RealtimePayload {
    switch (event.kind) {
      case "presence.upsert":
        return {
          kind: "presence.update",
          pageId: event.payload.participant.pageId,
          profile: {
            displayName: event.payload.participant.displayName,
            role: event.payload.participant.role,
            state: event.payload.participant.state,
          },
          tool: event.payload.participant.tool,
        };
      case "presence.remove":
        return { kind: "presence.leave" };
      case "presence.cursor":
        return {
          kind: "presence.cursor",
          x: event.payload.x,
          y: event.payload.y,
          pageId: event.payload.pageId,
          tool: event.payload.tool,
          drawing: event.payload.drawing,
          ...(event.payload.strokeColor === undefined
            ? {}
            : { strokeColor: event.payload.strokeColor }),
          ...(event.payload.strokeWidth === undefined
            ? {}
            : { strokeWidth: event.payload.strokeWidth }),
          ...(event.payload.strokeOpacity === undefined
            ? {}
            : { strokeOpacity: event.payload.strokeOpacity }),
          ...(event.payload.points === undefined
            ? {}
            : { points: event.payload.points }),
        };
      case "comments.changed":
        return {
          kind: "comment.changed",
          threadId: event.payload.threadId,
          activitySequence: event.payload.activitySequence,
          change: event.payload.change,
        };
      case "screen.announce":
        return {
          kind: "signal.announce",
          shareId: event.payload.shareId,
          label: event.payload.label,
        };
      case "screen.request":
        if (!event.targetSessionId) {
          throw new Error("화면 요청 대상이 필요합니다.");
        }
        return {
          kind: "signal.request",
          shareId: event.payload.shareId,
          sessionId: event.payload.shareId,
          targetClientId: event.targetSessionId,
        };
      case "screen.access":
        if (!event.targetSessionId) {
          throw new Error("화면 접근 응답 대상이 필요합니다.");
        }
        return {
          kind: "signal.access",
          shareId: event.payload.shareId,
          sessionId: event.payload.shareId,
          targetClientId: event.targetSessionId,
          decision: event.payload.decision,
        };
      case "screen.description": {
        if (!event.targetSessionId) {
          throw new Error("화면 연결 설명 대상이 필요합니다.");
        }
        const key = peerConnectionKey(
          event.payload.shareId,
          event.senderSessionId,
          event.targetSessionId,
        );
        let peerConnectionId = this.peerConnectionByPair.get(key);
        if (event.payload.type === "offer") {
          peerConnectionId ??= event.eventId;
          this.rememberPeerConnection(key, peerConnectionId);
        }
        if (!peerConnectionId) {
          throw new Error("화면 연결 offer의 peer 식별자가 없습니다.");
        }
        return {
          kind:
            event.payload.type === "offer"
              ? "signal.offer"
              : "signal.answer",
          sessionId: event.payload.shareId,
          peerConnectionId,
          targetClientId: event.targetSessionId,
          sdp: event.payload.sdp,
        };
      }
      case "screen.ice": {
        if (!event.targetSessionId) {
          throw new Error("화면 ICE 대상이 필요합니다.");
        }
        const peerConnectionId = this.peerConnectionByPair.get(
          peerConnectionKey(
            event.payload.shareId,
            event.senderSessionId,
            event.targetSessionId,
          ),
        );
        if (!peerConnectionId) {
          throw new Error("화면 ICE의 peer 식별자가 없습니다.");
        }
        return {
          kind: "signal.ice",
          sessionId: event.payload.shareId,
          peerConnectionId,
          targetClientId: event.targetSessionId,
          candidate: {
            candidate: event.payload.candidate,
            sdpMid: event.payload.sdpMid,
            sdpMLineIndex: event.payload.sdpMLineIndex,
            usernameFragment: event.payload.usernameFragment,
          },
        };
      }
      case "screen.stop":
        this.clearPeerConnectionsForShare(event.payload.shareId);
        return { kind: "signal.stop", shareId: event.payload.shareId };
    }
  }

  private validateInboundPeerConnection(
    event: ServerEventMessage,
    localSessionId: string,
  ): boolean {
    const payload = event.payload;
    if (
      payload.kind !== "signal.offer" &&
      payload.kind !== "signal.answer" &&
      payload.kind !== "signal.ice" &&
      payload.kind !== "signal.stop"
    ) {
      return true;
    }
    if (payload.kind === "signal.stop") {
      this.clearPeerConnectionsForShare(payload.shareId);
      return true;
    }
    const key = peerConnectionKey(
      payload.sessionId,
      event.clientId,
      localSessionId,
    );
    const existing = this.peerConnectionByPair.get(key);
    if (payload.kind === "signal.offer") {
      // A reconnecting host starts a new WebRTC generation while the viewer's
      // provider socket may remain connected. The offer is the generation
      // boundary, so it atomically replaces the prior pair mapping.
      this.rememberPeerConnection(key, payload.peerConnectionId);
      return true;
    }
    // Delayed answer/ICE from the previous generation is expected around
    // asymmetric reconnects. Drop it without poisoning an otherwise healthy
    // provider route.
    return existing === payload.peerConnectionId;
  }

  private rememberPeerConnection(key: string, peerConnectionId: string): void {
    this.peerConnectionByPair.delete(key);
    this.peerConnectionByPair.set(key, peerConnectionId);
    while (this.peerConnectionByPair.size > MAX_PEER_CONNECTIONS) {
      const oldest = this.peerConnectionByPair.keys().next().value;
      if (typeof oldest !== "string") break;
      this.peerConnectionByPair.delete(oldest);
    }
  }

  private clearPeerConnectionsForShare(shareId: string): void {
    const prefix = `${shareId}\u0000`;
    for (const key of this.peerConnectionByPair.keys()) {
      if (key.startsWith(prefix)) this.peerConnectionByPair.delete(key);
    }
  }

  private handleAck(message: {
    readonly channel: RealtimeChannel;
    readonly idempotencyKey: string;
    readonly sequence: number;
    readonly duplicate: boolean;
  }): void {
    const pending = this.pending.get(message.idempotencyKey);
    if (!pending || !this.welcome || !this.request) return;
    if (pending.event.workload !== message.channel || message.sequence < 1) {
      this.disconnect("protocol-error", false);
      return;
    }
    this.cancelTimeout(pending.timeout);
    this.pending.delete(message.idempotencyKey);
    this.wireClientSequence = pending.wireClientSequence;
    pending.resolve({
      version: STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION,
      providerId: this.descriptor.providerId,
      providerSessionId: this.welcome.connectionId,
      scope: this.request.scope,
      workload: pending.event.workload,
      eventId: pending.event.eventId,
      idempotencyKey: pending.event.idempotencyKey,
      clientSequence: pending.event.clientSequence,
      serverSequence: String(message.sequence),
      duplicate: message.duplicate,
    });
  }

  private sendResume(
    channel: StudioRealtimeWorkload,
    afterSequence: number,
  ): void {
    try {
      this.handshake?.resumeAfter.set(channel, afterSequence);
      this.sendRaw({
        version: REALTIME_PROTOCOL_VERSION,
        type: "resume",
        channel,
        afterSequence,
      });
    } catch {
      this.failHandshake(
        new Error("Cloudflare 실시간 재개 요청을 보내지 못했습니다."),
        1000,
        "resume-send-failed",
      );
    }
  }

  private emitInbound(event: StudioRealtimeInboundEvent): void {
    if (this.activationPending) {
      this.activationBuffer.push(event);
      return;
    }
    try {
      this.handlers?.onEvent(event);
    } catch {
      // Runtime handlers own neither the socket nor its resume frontier.
    }
  }

  private flushActivationBuffer(): void {
    if (this.closed || !this.activationPending) return;
    this.activationPending = false;
    const events = this.activationBuffer.splice(0);
    for (const event of events) {
      try {
        this.handlers?.onEvent(event);
      } catch {
        // One consumer cannot prevent the remainder of a negotiated replay.
      }
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeat !== null) return;
    this.heartbeat = this.scheduleInterval(() => {
      if (this.socket?.readyState !== WEB_SOCKET_OPEN) return;
      if (this.pongDeadline !== null) {
        this.disconnect("network-lost", true);
        return;
      }
      try {
        this.sendRaw({ version: REALTIME_PROTOCOL_VERSION, type: "ping" });
        this.pongDeadline = this.scheduleTimeout(() => {
          this.pongDeadline = null;
          this.disconnect("network-lost", true);
        }, PONG_TIMEOUT_MS);
      } catch {
        this.disconnect("network-lost", true);
      }
    }, HEARTBEAT_MS);
  }

  private clearPongDeadline(): void {
    if (this.pongDeadline !== null) {
      this.cancelTimeout(this.pongDeadline);
    }
    this.pongDeadline = null;
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) this.cancelInterval(this.heartbeat);
    this.heartbeat = null;
    this.clearPongDeadline();
  }

  private installSteadyListeners(
    socket: StudioCloudflareRealtimeWebSocketLike,
  ): void {
    socket.addEventListener("open", this.onOpen);
    socket.addEventListener("message", this.onSteadyMessage);
    socket.addEventListener("close", this.onSteadyClose);
    socket.addEventListener("error", this.onSteadyError);
  }

  private removeSteadyListeners(): void {
    const socket = this.socket;
    if (!socket) return;
    socket.removeEventListener("open", this.onOpen);
    socket.removeEventListener("message", this.onSteadyMessage);
    socket.removeEventListener("close", this.onSteadyClose);
    socket.removeEventListener("error", this.onSteadyError);
  }

  private failOrDisconnect(message: string): void {
    if (this.handshake) {
      this.failHandshake(new Error(message), 1002, "protocol-error");
    } else {
      this.disconnect("protocol-error", false);
    }
  }

  private failHandshake(
    error: Error,
    closeCode: number,
    closeReason: string,
  ): void {
    const handshake = this.handshake;
    if (!handshake || handshake.settled) return;
    handshake.settled = true;
    this.handshake = null;
    this.cancelTimeout(handshake.timeout);
    handshake.signal.removeEventListener("abort", handshake.abort);
    this.removeSteadyListeners();
    this.closeSocket(closeCode, closeReason);
    this.socket = null;
    this.request = null;
    this.handlers = null;
    this.welcome = null;
    this.projection = this.committedProjection;
    handshake.reject(error);
  }

  private sendRaw(value: unknown): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WEB_SOCKET_OPEN) {
      throw new Error("Cloudflare 실시간 연결이 준비되지 않았습니다.");
    }
    socket.send(JSON.stringify(value));
  }

  private completePending(key: string, error: Error): void {
    const pending = this.pending.get(key);
    if (!pending) return;
    this.pending.delete(key);
    this.cancelTimeout(pending.timeout);
    pending.reject(error);
  }

  private disconnect(
    code:
      | "network-lost"
      | "provider-shutdown"
      | "ticket-expired"
      | "access-revoked"
      | "protocol-error",
    recoverable: boolean,
  ): void {
    if (this.closed) return;
    const handlers = this.handlers;
    this.stopHeartbeat();
    this.removeSteadyListeners();
    this.closeSocket(1000, "provider-disconnect");
    this.socket = null;
    this.request = null;
    this.handlers = null;
    this.welcome = null;
    this.activationPending = false;
    this.activationBuffer.length = 0;
    this.activeConnectionsByClient.clear();
    this.peerConnectionByPair.clear();
    for (const key of [...this.pending.keys()]) {
      this.completePending(
        key,
        new Error("Cloudflare 실시간 연결이 끊어졌습니다."),
      );
    }
    handlers?.onDisconnect({ code, recoverable });
  }

  private closeSocket(code: number, reason: string): void {
    try {
      this.socket?.close(code, reason);
    } catch {
      // Closing is best-effort and must never reflect provider details.
    }
  }
}

export function createStudioCloudflareRealtimeAdapterFactory(
  options: StudioCloudflareRealtimeAdapterFactoryOptions,
): StudioRealtimeProviderAdapterFactory {
  const projection = new StudioCloudflareSequenceProjection();
  const descriptor = Object.freeze({
    providerId: options.providerId,
    kind: "custom" as const,
    protocolVersion: STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION,
  });
  return Object.freeze({
    descriptor,
    create: () => new StudioCloudflareRealtimeAdapter(options, projection),
  });
}
