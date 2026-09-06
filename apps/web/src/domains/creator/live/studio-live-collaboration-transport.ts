import {
  createStudioCrdtLocalWireMessage,
  isStudioCrdtLocalWireCandidate,
  parseStudioCrdtLocalWireMessage,
  parseStudioCrdtSyncRequest,
  parseStudioCrdtSyncResponse,
  parseStudioCrdtUpdateRequest,
  STUDIO_CRDT_PROTOCOL_VERSION,
  type StudioCrdtSyncRequest,
  type StudioCrdtSyncResponse,
  type StudioCrdtTransportMessage,
  type StudioCrdtUpdateAck,
  type StudioCrdtUpdateRequest,
} from "./studio-crdt-protocol";
import {
  isStudioLiveInkWireCandidate,
  STUDIO_LIVE_INK_CAPABILITY,
  type StudioLiveInkWireMessage,
} from "./studio-live-ink-protocol";
import { isStudioLocalLiveTransportSupported } from "./studio-live-local-transport-support";

import type {
  StudioLiveEnvelope,
  StudioLiveLockAcquireResult,
  StudioLiveLockReleaseRequest,
  StudioLiveLockReleaseResult,
  StudioLiveParticipant,
  StudioLiveLockRequest,
} from "./studio-live-collaboration-protocol";
import type { StudioTeamCommentLiveEvent } from "../studio-team-comment-live-event";

export type StudioLiveTransportMode = "local" | "server";

/** Where live Yjs diffs are fanned out. Mesh is preferred to keep Socket.IO off the hot path. */
export type StudioLiveCrdtFanout = "authoritative" | "mesh" | "none";

export interface StudioLiveTransportContext {
  workId: string;
  roomName: string;
  participant: StudioLiveParticipant;
}

export type StudioLiveTransportStatus =
  | { state: "connecting"; message: string; recoverable: true }
  | { state: "ready"; message: string; recoverable: true }
  | { state: "disconnected"; message: string; recoverable: true }
  | { state: "error"; message: string; recoverable: true }
  | { state: "revoked"; message: string; recoverable: false };

export type StudioLiveAuthoritativeLockEvent =
  | {
      action: "acquired";
      resource: string;
      claimId: string;
      /** Present on the ACK path so Room can settle the matching pending request. */
      requestId?: string;
      owner: StudioLiveParticipant;
      leaseUntil: number;
    }
  | { action: "released"; resource: string; claimId: string };

export type StudioLiveTransportControlEvent =
  | { type: "status"; status: StudioLiveTransportStatus }
  | { type: "lock"; lock: StudioLiveAuthoritativeLockEvent }
  | { type: "comment-changed"; change: StudioTeamCommentLiveEvent }
  | {
      type: "voice-removed";
      callId: string;
      reason: "rejected" | "revoked" | "removed";
      message: string;
    };

/**
 * Transport-neutral ephemeral message surface. A server implementation must fail closed until its
 * authenticated socket has received a successful work-room ACL acknowledgement.
 */
export interface StudioLiveTransport {
  readonly mode: StudioLiveTransportMode;
  readonly ready: boolean;
  /**
   * `authoritative` keeps a Socket.IO/CRDT host as fallback. `mesh` is P2P-only.
   * `none` is signaling and must be wrapped by a mesh overlay.
   */
  readonly crdtFanout?: StudioLiveCrdtFanout;
  /**
   * Optional identity bridge for transports whose wire connection id differs from Studio's stable
   * client-instance session id. Hybrid transports use it before merging independently sequenced
   * provider and primary events.
   */
  canonicalSessionId?(transportSessionId: string): string;
  transportSessionId?(canonicalSessionId: string): string | null;
  connect(): Promise<void>;
  send(envelope: StudioLiveEnvelope): boolean;
  subscribe(listener: (value: unknown) => void): () => void;
  /** Optional server-only authoritative status/ACK seam; local transports need no control plane. */
  subscribeControl?(listener: (event: StudioLiveTransportControlEvent) => void): () => void;
  /** Correlated, server-confirmed lock acquisition. Local transports may omit this fast path. */
  acquireLock?(request: StudioLiveLockRequest): Promise<StudioLiveLockAcquireResult>;
  /** Correlated, fence-specific release. It settles only the lease named by `claimId`. */
  releaseLock?(request: StudioLiveLockReleaseRequest): Promise<StudioLiveLockReleaseResult>;
  /** Durable CRDT operations deliberately do not share the ephemeral signaling envelope. */
  requestCrdtSync?(request: StudioCrdtSyncRequest): Promise<StudioCrdtSyncResponse | null>;
  respondCrdtSync?(response: StudioCrdtSyncResponse, targetSessionId: string): boolean;
  publishCrdtUpdate?(request: StudioCrdtUpdateRequest): Promise<StudioCrdtUpdateAck>;
  subscribeCrdt?(listener: (message: StudioCrdtTransportMessage) => void): () => void;
  /**
   * Binary lane capabilities negotiated for the current connection (e.g. "ink-v2"). Publishers
   * must check the capability before offering binary traffic: a transport that does not advertise
   * a lane never carries or delivers its messages. This is the fail-closed V18 contract — a peer
   * without ink-v2 stays cursor-only, and there is no JSON re-encoding fallback.
   */
  readonly binaryLaneCapabilities?: readonly string[];
  /** Sends one pre-validated ink-v2 frame on the binary lane. Requires the "ink-v2" capability. */
  sendInk?(message: StudioLiveInkWireMessage): boolean;
  /** Delivers raw binary-lane candidates; subscribers must run the strict ink wire parser. */
  subscribeInk?(listener: (value: unknown) => void): () => void;
  close(): void;
}

export type StudioLiveTransportFactory = (
  context: StudioLiveTransportContext
) => StudioLiveTransport;

export interface StudioBroadcastChannelLike {
  postMessage(value: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  close(): void;
}

export type StudioBroadcastChannelFactory = (name: string) => StudioBroadcastChannelLike;

export interface StudioBroadcastCrdtDependencies {
  setTimeout?: (handler: () => void, delay: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  syncTimeoutMs?: number;
  /**
   * Compatibility/test seam: `false` removes the negotiated binary ink lane so the transport
   * behaves like a pre-V18 peer (cursor-only; ink frames are neither sent nor delivered).
   */
  inkLane?: boolean;
}

interface StudioBroadcastCrdtContext {
  workId: string;
  participant: StudioLiveParticipant;
}

interface PendingLocalSync {
  resolve: (response: StudioCrdtSyncResponse | null) => void;
  timeout: unknown;
}

const DEFAULT_LOCAL_CRDT_SYNC_TIMEOUT_MS = 750;
const MAX_SEEN_LOCAL_UPDATE_IDS = 2_048;
const STUDIO_LOCAL_BINARY_LANES: readonly string[] = Object.freeze([
  STUDIO_LIVE_INK_CAPABILITY,
]);

function defaultBroadcastChannelFactory(name: string): StudioBroadcastChannelLike {
  // isStudioLocalLiveTransportSupported() 는 `typeof BroadcastChannel === "function"` 만 본다.
  // 존재는 생성 가능성이 아니다 — 스토리지가 분할된 인앱 WebView 는 생성자를 노출한 채 `new`
  // 에서 SecurityError 를 던지므로, 그 게이트를 통과한 세션이 여기서 날 DOMException 으로
  // 깨졌다. 지원되지 않는 것으로 보고해 트랜스포트의 정상 경로를 타게 한다.
  try {
    return new BroadcastChannel(name);
  } catch (cause) {
    // createStudioLocalLiveTransport 가 지원되지 않을 때 던지는 것과 같은 모양으로 맞춘다.
    // 호출부는 이미 그 문장을 처리하고 있고, 여기서 raw DOMException 이 새면 처리하지 못한다.
    throw new Error("이 브라우저는 로컬 탭 공동작업 채널을 지원하지 않습니다.", { cause });
  }
}

// Re-exported for the existing call sites that already import it from here. Callers that only
// need the capability answer — notably StudioLiveCollaborationProvider's gating effect — must
// import it from the leaf module directly so they do not anchor this file eagerly.
export { isStudioLocalLiveTransportSupported };

/** Memory-only, same-origin tab transport. It never writes signaling data to localStorage. */
export class StudioBroadcastChannelTransport implements StudioLiveTransport {
  readonly mode = "local" as const;
  private readonly channel: StudioBroadcastChannelLike;
  private readonly listeners = new Set<(value: unknown) => void>();
  private readonly crdtListeners = new Set<(message: StudioCrdtTransportMessage) => void>();
  private readonly inkListeners = new Set<(value: unknown) => void>();
  private readonly crdtContext: StudioBroadcastCrdtContext | null;
  private readonly pendingSync = new Map<string, PendingLocalSync>();
  private readonly seenUpdateIds = new Set<string>();
  private readonly scheduleTimeout: (handler: () => void, delay: number) => unknown;
  private readonly cancelTimeout: (handle: unknown) => void;
  private readonly syncTimeoutMs: number;
  private readonly inkLaneEnabled: boolean;
  private closed = false;
  private connected = false;
  private readonly onMessage = (event: MessageEvent<unknown>) => {
    if (isStudioCrdtLocalWireCandidate(event.data)) {
      this.onCrdtMessage(event.data);
      return;
    }
    if (isStudioLiveInkWireCandidate(event.data)) {
      // Fail closed: without the negotiated lane an ink frame is dropped, never re-routed to the
      // JSON envelope listeners. A pre-V18 peer therefore stays cursor-only by construction.
      if (!this.inkLaneEnabled || !this.ready) return;
      for (const listener of this.inkListeners) listener(event.data);
      return;
    }
    for (const listener of this.listeners) listener(event.data);
  };

  constructor(
    roomName: string,
    createChannel: StudioBroadcastChannelFactory = defaultBroadcastChannelFactory,
    crdtContext: StudioBroadcastCrdtContext | null = null,
    dependencies: StudioBroadcastCrdtDependencies = {}
  ) {
    this.channel = createChannel(roomName);
    this.crdtContext = crdtContext;
    this.scheduleTimeout = dependencies.setTimeout ?? ((handler, delay) => globalThis.setTimeout(handler, delay));
    this.cancelTimeout =
      dependencies.clearTimeout ??
      ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.syncTimeoutMs = Math.min(
      5_000,
      Math.max(100, Math.trunc(dependencies.syncTimeoutMs ?? DEFAULT_LOCAL_CRDT_SYNC_TIMEOUT_MS))
    );
    this.inkLaneEnabled = dependencies.inkLane !== false;
    this.channel.addEventListener("message", this.onMessage);
  }

  get ready(): boolean {
    return this.connected && !this.closed;
  }

  /** Same-origin tabs run the same build, so the local lane set is negotiated statically. */
  get binaryLaneCapabilities(): readonly string[] {
    return this.inkLaneEnabled ? STUDIO_LOCAL_BINARY_LANES : [];
  }

  connect(): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error("이미 닫힌 로컬 공동작업 채널입니다."));
    }
    this.connected = true;
    return Promise.resolve();
  }

  send(envelope: StudioLiveEnvelope): boolean {
    if (!this.ready) return false;
    try {
      this.channel.postMessage(envelope);
      return true;
    } catch {
      return false;
    }
  }

  subscribe(listener: (value: unknown) => void): () => void {
    if (this.closed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Binary ink lane. Fails closed when the "ink-v2" capability was not negotiated. */
  sendInk(message: StudioLiveInkWireMessage): boolean {
    if (!this.ready || !this.inkLaneEnabled) return false;
    try {
      this.channel.postMessage(message);
      return true;
    } catch {
      return false;
    }
  }

  subscribeInk(listener: (value: unknown) => void): () => void {
    if (this.closed || !this.inkLaneEnabled) return () => undefined;
    this.inkListeners.add(listener);
    return () => this.inkListeners.delete(listener);
  }

  requestCrdtSync(request: StudioCrdtSyncRequest): Promise<StudioCrdtSyncResponse | null> {
    const context = this.crdtContext;
    if (!this.ready || !context) return Promise.reject(new Error("로컬 CRDT 채널이 준비되지 않았습니다."));
    const parsed = parseStudioCrdtSyncRequest(request, { expectedWorkId: context.workId });
    if (!parsed) return Promise.reject(new Error("CRDT 동기화 요청이 올바르지 않습니다."));
    const previous = this.pendingSync.get(parsed.requestId);
    if (previous) return Promise.reject(new Error("같은 CRDT 동기화 요청이 이미 진행 중입니다."));

    return new Promise((resolve, reject) => {
      const timeout = this.scheduleTimeout(() => {
        this.pendingSync.delete(parsed.requestId);
        resolve(null);
      }, this.syncTimeoutMs);
      this.pendingSync.set(parsed.requestId, { resolve, timeout });
      try {
        this.channel.postMessage(
          createStudioCrdtLocalWireMessage({
            workId: context.workId,
            senderSessionId: context.participant.sessionId,
            targetSessionId: null,
            kind: "sync-request",
            payload: parsed,
          })
        );
      } catch {
        this.cancelTimeout(timeout);
        this.pendingSync.delete(parsed.requestId);
        reject(new Error("로컬 CRDT 동기화 요청을 보내지 못했습니다."));
      }
    });
  }

  respondCrdtSync(response: StudioCrdtSyncResponse, targetSessionId: string): boolean {
    const context = this.crdtContext;
    if (!this.ready || !context || !targetSessionId) return false;
    const parsed = parseStudioCrdtSyncResponse(response, { expectedWorkId: context.workId });
    if (!parsed) return false;
    try {
      this.channel.postMessage(
        createStudioCrdtLocalWireMessage({
          workId: context.workId,
          senderSessionId: context.participant.sessionId,
          targetSessionId,
          kind: "sync-response",
          payload: parsed,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  publishCrdtUpdate(request: StudioCrdtUpdateRequest): Promise<StudioCrdtUpdateAck> {
    const context = this.crdtContext;
    if (!this.ready || !context) return Promise.reject(new Error("로컬 CRDT 채널이 준비되지 않았습니다."));
    const parsed = parseStudioCrdtUpdateRequest(request, { expectedWorkId: context.workId });
    if (!parsed) return Promise.reject(new Error("CRDT 업데이트가 올바르지 않습니다."));
    const duplicate = this.seenUpdateIds.has(parsed.updateId);
    if (!duplicate) {
      this.rememberUpdateId(parsed.updateId);
      try {
        this.channel.postMessage(
          createStudioCrdtLocalWireMessage({
            workId: context.workId,
            senderSessionId: context.participant.sessionId,
            targetSessionId: null,
            kind: "update",
            payload: {
              protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
              workId: context.workId,
              updateId: parsed.updateId,
              serverSequence: "0",
              update: parsed.update,
            },
          })
        );
      } catch {
        this.seenUpdateIds.delete(parsed.updateId);
        return Promise.reject(new Error("로컬 CRDT 업데이트를 보내지 못했습니다."));
      }
    }
    return Promise.resolve({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: context.workId,
      updateId: parsed.updateId,
      serverSequence: "0",
      serverStateVector: null,
      duplicate,
    });
  }

  subscribeCrdt(listener: (message: StudioCrdtTransportMessage) => void): () => void {
    if (this.closed) return () => undefined;
    this.crdtListeners.add(listener);
    return () => this.crdtListeners.delete(listener);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    this.crdtListeners.clear();
    this.inkListeners.clear();
    for (const pending of this.pendingSync.values()) {
      this.cancelTimeout(pending.timeout);
      pending.resolve(null);
    }
    this.pendingSync.clear();
    this.seenUpdateIds.clear();
    this.channel.removeEventListener("message", this.onMessage);
    this.channel.close();
  }

  private onCrdtMessage(value: unknown): void {
    const context = this.crdtContext;
    if (!this.ready || !context) return;
    const wire = parseStudioCrdtLocalWireMessage(value, {
      expectedWorkId: context.workId,
      selfSessionId: context.participant.sessionId,
    });
    if (!wire) return;
    if (wire.kind === "sync-response") {
      const pending = this.pendingSync.get(wire.payload.requestId);
      if (!pending) return;
      this.pendingSync.delete(wire.payload.requestId);
      this.cancelTimeout(pending.timeout);
      pending.resolve(wire.payload);
      return;
    }
    if (wire.kind === "sync-request") {
      this.emitCrdt({
        type: "sync-request",
        request: wire.payload,
        senderSessionId: wire.senderSessionId,
      });
      return;
    }
    if (this.seenUpdateIds.has(wire.payload.updateId)) return;
    this.rememberUpdateId(wire.payload.updateId);
    this.emitCrdt({
      type: "update",
      update: wire.payload,
      senderSessionId: wire.senderSessionId,
    });
  }

  private emitCrdt(message: StudioCrdtTransportMessage): void {
    for (const listener of this.crdtListeners) listener(message);
  }

  private rememberUpdateId(updateId: string): void {
    if (this.seenUpdateIds.has(updateId)) return;
    this.seenUpdateIds.add(updateId);
    if (this.seenUpdateIds.size <= MAX_SEEN_LOCAL_UPDATE_IDS) return;
    const oldest = this.seenUpdateIds.values().next().value;
    if (typeof oldest === "string") this.seenUpdateIds.delete(oldest);
  }
}

export const createStudioLocalLiveTransport: StudioLiveTransportFactory = ({
  roomName,
  workId,
  participant,
}) => {
  if (!isStudioLocalLiveTransportSupported()) {
    throw new Error("이 브라우저는 로컬 탭 공동작업 채널을 지원하지 않습니다.");
  }
  return new StudioBroadcastChannelTransport(roomName, defaultBroadcastChannelFactory, {
    workId,
    participant,
  });
};

class StudioMemoryBroadcastChannel implements StudioBroadcastChannelLike {
  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
  closed = false;

  constructor(
    private readonly hub: StudioMemoryBroadcastHub,
    readonly name: string
  ) {}

  postMessage(value: unknown): void {
    if (this.closed) throw new Error("closed");
    this.hub.publish(this, value);
  }

  addEventListener(
    _type: "message",
    listener: (event: MessageEvent<unknown>) => void
  ): void {
    this.listeners.add(listener);
  }

  removeEventListener(
    _type: "message",
    listener: (event: MessageEvent<unknown>) => void
  ): void {
    this.listeners.delete(listener);
  }

  receive(value: unknown): void {
    const event = { data: structuredClone(value) } as MessageEvent<unknown>;
    for (const listener of this.listeners) listener(event);
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }
}

/**
 * In-process BroadcastChannel stand-in used by StudioLiveRoom tests and same-process replicas.
 * Protocol, envelope validation and CRDT wire handling stay inside StudioBroadcastChannelTransport.
 */
export class StudioMemoryBroadcastHub {
  readonly channels: StudioMemoryBroadcastChannel[] = [];
  queued = false;
  private queue: Array<{ sender: StudioMemoryBroadcastChannel; value: unknown }> = [];

  create = (name: string): StudioBroadcastChannelLike => {
    const channel = new StudioMemoryBroadcastChannel(this, name);
    this.channels.push(channel);
    return channel;
  };

  publish(sender: StudioMemoryBroadcastChannel, value: unknown): void {
    if (this.queued) {
      this.queue.push({ sender, value: structuredClone(value) });
      return;
    }
    this.deliver(sender, value);
  }

  flush(): void {
    const queued = this.queue.splice(0);
    for (const item of queued) this.deliver(item.sender, item.value);
  }

  /** Delivers the queued fan-out in reverse post order (last writer first). */
  flushReversed(): void {
    const queued = this.queue.splice(0).reverse();
    for (const item of queued) this.deliver(item.sender, item.value);
  }

  private deliver(sender: StudioMemoryBroadcastChannel, value: unknown): void {
    for (const channel of this.channels) {
      if (channel === sender || channel.name !== sender.name || channel.closed) continue;
      channel.receive(value);
    }
  }
}

export function createStudioMemoryLiveTransportFactory(
  hub: StudioMemoryBroadcastHub,
  dependencies: StudioBroadcastCrdtDependencies = {}
): StudioLiveTransportFactory {
  return ({ roomName, workId, participant }) =>
    new StudioBroadcastChannelTransport(
      roomName,
      hub.create,
      { workId, participant },
      dependencies
    );
}
