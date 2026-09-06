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
  STUDIO_LIVE_GESTURE_PREVIEW_ENVELOPE_MAX_BYTES,
  createStudioLiveEnvelope,
  parseStudioLiveEnvelope,
  studioLiveUtf8ByteLength,
  type StudioLiveEnvelope,
  type StudioLiveMessageKind,
  type StudioLiveParticipant,
  type StudioLiveWebRtcDescriptionPayload,
  type StudioLiveWebRtcIcePayload,
} from "./studio-live-collaboration-protocol";
import {
  isStudioLiveInkWireCandidate,
  STUDIO_LIVE_INK_CAPABILITY,
  type StudioLiveInkWireMessage,
} from "./studio-live-ink-protocol";
import { bindStudioLiveP2pChannelLifecycle } from "./studio-live-p2p-channel-lifecycle";

import type {
  StudioLiveTransport,
  StudioLiveTransportContext,
  StudioLiveTransportControlEvent,
  StudioLiveTransportFactory,
} from "./studio-live-collaboration-transport";

/**
 * Reserved screen-signal share id for the STUN-only data-channel mesh. Media screen shares never
 * use this id, and the room swallows these envelopes so a mesh offer cannot start playback.
 */
export const STUDIO_LIVE_P2P_MESH_SHARE_ID = "p2p-mesh-v1";
export const STUDIO_LIVE_P2P_CHANNEL_LABEL = "studio-live-p2p";
/** Full-mesh ICE above this size is more expensive than a single server fanout. */
export const STUDIO_LIVE_P2P_MAX_PEERS = 8;
/** Keeps at most a few maximum-size preview packets queued per peer before using primary relay. */
export const STUDIO_LIVE_P2P_PREVIEW_MAX_BUFFERED_BYTES = 256 * 1024;
/** JSON control message announcing this peer's negotiated binary lanes (e.g. "ink-v2"). */
export const STUDIO_LIVE_P2P_CAPS_WIRE = "studio-live-p2p-caps";
/** Bounds queued ink so the publisher can retry or cancel instead of silently dropping actuals. */
export const STUDIO_LIVE_P2P_INK_MAX_BUFFERED_BYTES = 256 * 1024;
/** Per-peer inbound budget for mesh ink frames, mirroring the socket lane's windows. */
export const STUDIO_LIVE_P2P_INK_INBOUND_WINDOW_MS = 3_000;
export const STUDIO_LIVE_P2P_INK_INBOUND_MAX_PACKETS = 480;
export const STUDIO_LIVE_P2P_INK_INBOUND_MAX_BYTES = 4 * 1024 * 1024;

const STUDIO_LIVE_P2P_MAX_ADVERTISED_LANES = 8;
const STUDIO_LIVE_P2P_MAX_LANE_NAME_LENGTH = 64;
const STUDIO_LIVE_P2P_NO_BINARY_LANES: readonly string[] = Object.freeze([]);
const STUDIO_LIVE_P2P_RELIABLE_INK_LANES: readonly string[] = Object.freeze([STUDIO_LIVE_INK_CAPABILITY]);

const STUDIO_LIVE_P2P_EPHEMERAL_KINDS = new Set<StudioLiveMessageKind>([
  "presence:heartbeat",
  "cursor:update",
  "chat:message",
  "preview:gesture",
]);

const STUDIO_LIVE_P2P_STUN_URLS = ["stun:stun.l.google.com:19302"] as const;

export function isStudioLiveP2pMeshShareId(shareId: string): boolean {
  return shareId === STUDIO_LIVE_P2P_MESH_SHARE_ID;
}

export function isStudioLiveP2pEphemeralKind(kind: StudioLiveMessageKind): boolean {
  return STUDIO_LIVE_P2P_EPHEMERAL_KINDS.has(kind);
}

export interface StudioLiveP2pRtcIceCandidate {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface StudioLiveP2pRtcDataChannel {
  readonly label: string;
  readonly readyState: string;
  readonly bufferedAmount: number;
  readonly ordered?: boolean;
  readonly maxRetransmits?: number | null;
  readonly maxPacketLifeTime?: number | null;
  /** Real RTCDataChannels are switched to "arraybuffer" so mesh ink frames avoid Blob hops. */
  binaryType?: string;
  send(data: string | ArrayBuffer): void;
  close(): void;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
}

export interface StudioLiveP2pRtcPeerConnection {
  readonly connectionState: string;
  readonly sctp?: { readonly maxMessageSize?: number } | null;
  onicecandidate: ((event: { candidate: StudioLiveP2pRtcIceCandidate | null }) => void) | null;
  ondatachannel: ((event: { channel: StudioLiveP2pRtcDataChannel }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  createDataChannel(label: string): StudioLiveP2pRtcDataChannel;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  createAnswer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
  close(): void;
}

export type StudioLiveP2pPeerConnectionFactory = () => StudioLiveP2pRtcPeerConnection;

export interface StudioLiveP2pOverlayOptions {
  readonly enabled?: boolean;
  readonly createPeerConnection?: StudioLiveP2pPeerConnectionFactory;
  readonly now?: () => number;
  readonly maxPeers?: number;
}

function firstNonNullCrdtSyncResponse(
  primary: Promise<StudioCrdtSyncResponse | null>,
  mesh: Promise<StudioCrdtSyncResponse | null>,
): Promise<StudioCrdtSyncResponse | null> {
  return new Promise((resolve) => {
    let remaining = 2;
    const settle = (response: StudioCrdtSyncResponse | null): void => {
      if (response) resolve(response);
      if (--remaining === 0) resolve(null);
    };
    // An absent same-profile BroadcastChannel must not delay an available remote peer.
    void primary.then(settle, () => settle(null));
    void mesh.then(settle, () => settle(null));
  });
}

function defaultCreatePeerConnection(): StudioLiveP2pRtcPeerConnection | null {
  if (typeof RTCPeerConnection !== "function") return null;
  return new RTCPeerConnection({
    iceServers: [{ urls: [...STUDIO_LIVE_P2P_STUN_URLS] }],
    bundlePolicy: "max-bundle",
  }) as unknown as StudioLiveP2pRtcPeerConnection;
}

function shouldOfferMesh(selfSessionId: string, peerSessionId: string): boolean {
  return selfSessionId < peerSessionId;
}

function isMeshSignal(
  envelope: StudioLiveEnvelope,
): envelope is StudioLiveEnvelope<"webrtc:description" | "webrtc:ice"> {
  if (envelope.kind !== "webrtc:description" && envelope.kind !== "webrtc:ice") return false;
  return isStudioLiveP2pMeshShareId(
    (envelope.payload as StudioLiveWebRtcDescriptionPayload | StudioLiveWebRtcIcePayload).shareId,
  );
}

interface StudioLiveP2pInkInboundWindow {
  startedAt: number;
  packetCount: number;
  byteCount: number;
}

interface StudioLiveP2pPeerLink {
  readonly sessionId: string;
  participant: StudioLiveParticipant;
  connection: StudioLiveP2pRtcPeerConnection;
  channel: StudioLiveP2pRtcDataChannel | null;
  remoteDescriptionSet: boolean;
  pendingIce: RTCIceCandidateInit[];
  /** Binary lanes this peer announced over its channel; empty until a caps message arrives. */
  peerBinaryLanes: readonly string[];
  /** True once our own lane announcement reached this peer's channel. */
  announcedBinaryLanes: boolean;
  inkInboundWindow: StudioLiveP2pInkInboundWindow | null;
  closed: boolean;
}

type StudioLiveP2pEphemeralSendResult = "sent" | "fallback" | "rejected";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStudioLiveP2pCapsMessage(value: unknown): readonly string[] | null {
  if (!isPlainRecord(value) || value.wire !== STUDIO_LIVE_P2P_CAPS_WIRE) return null;
  const lanes = value.binaryLanes;
  if (!Array.isArray(lanes) || lanes.length > STUDIO_LIVE_P2P_MAX_ADVERTISED_LANES) return null;
  const parsed: string[] = [];
  for (const lane of lanes) {
    if (
      typeof lane !== "string"
      || lane.length === 0
      || lane.length > STUDIO_LIVE_P2P_MAX_LANE_NAME_LENGTH
    ) return null;
    parsed.push(lane);
  }
  return Object.freeze(parsed);
}

/**
 * Binary mesh frame for one ink wire message: u32(LE) header byte length, the UTF-8 JSON header
 * ({header JSON} = the wire frame minus its ArrayBuffer), then the raw sample payload bytes.
 * Control frames (begin/end/cancel) carry zero payload bytes.
 */
function encodeStudioLiveP2pInkFrame(wire: StudioLiveInkWireMessage): ArrayBuffer | null {
  try {
    const message = wire.message;
    const payload =
      message.kind === "ink:chunk" || message.kind === "ink:prediction"
        ? message.payload
        : null;
    const headerBytes = new TextEncoder().encode(
      JSON.stringify({
        ...wire,
        message: payload ? { ...message, payload: undefined } : message,
      }),
    );
    const frame = new Uint8Array(4 + headerBytes.byteLength + (payload?.byteLength ?? 0));
    new DataView(frame.buffer).setUint32(0, headerBytes.byteLength, true);
    frame.set(headerBytes, 4);
    if (payload) frame.set(new Uint8Array(payload), 4 + headerBytes.byteLength);
    return frame.buffer;
  } catch {
    return null;
  }
}

/** Reconstructs one raw ink-lane candidate; the strict wire parser still runs downstream. */
function decodeStudioLiveP2pInkFrame(data: ArrayBuffer): Record<string, unknown> | null {
  if (data.byteLength < 4) return null;
  const headerLength = new DataView(data).getUint32(0, true);
  if (headerLength === 0 || 4 + headerLength > data.byteLength) return null;
  let header: unknown;
  try {
    header = JSON.parse(
      new TextDecoder().decode(new Uint8Array(data, 4, headerLength)),
    ) as unknown;
  } catch {
    return null;
  }
  if (!isPlainRecord(header) || !isStudioLiveInkWireCandidate(header)) return null;
  const message = header.message;
  if (!isPlainRecord(message)) return null;
  if (message.kind === "ink:chunk" || message.kind === "ink:prediction") {
    message.payload = data.slice(4 + headerLength);
  } else if (data.byteLength !== 4 + headerLength) {
    return null;
  }
  return header;
}

/**
 * STUN-only data-channel mesh on top of the room's signaling transport.
 * Cursor, presence heartbeat, chat, and gesture previews hop peer-to-peer once every known peer
 * has an open channel. Join, locks, and ICE signaling stay on the primary transport. CRDT stays
 * on the primary when it can persist updates; otherwise the mesh carries jam Yjs diffs.
 * Authoritative ink actuals retain their server lane. Signaling-only rooms negotiate an ordered,
 * fully reliable RTC lane for exact actual samples; failure remains visible to the publisher.
 */
class StudioLiveP2pOverlayTransport implements StudioLiveTransport {
  readonly mode: StudioLiveTransport["mode"];
  readonly crdtFanout: NonNullable<StudioLiveTransport["crdtFanout"]>;
  readonly canonicalSessionId?: StudioLiveTransport["canonicalSessionId"];
  readonly transportSessionId?: StudioLiveTransport["transportSessionId"];
  private readonly context: StudioLiveTransportContext;
  private readonly primary: StudioLiveTransport;
  private readonly createPeerConnection: StudioLiveP2pPeerConnectionFactory;
  private readonly now: () => number;
  private readonly maxPeers: number;
  private readonly knownPeerSessionIds = new Set<string>();
  private readonly peers = new Map<string, StudioLiveP2pPeerLink>();
  private readonly listeners = new Set<(value: unknown) => void>();
  private readonly inkListeners = new Set<(value: unknown) => void>();
  private readonly controlListeners = new Set<(event: StudioLiveTransportControlEvent) => void>();
  private readonly meshReadyChannels = new WeakSet<StudioLiveP2pRtcDataChannel>();
  private readonly crdtListeners = new Set<(message: StudioCrdtTransportMessage) => void>();
  private readonly pendingCrdtSync = new Map<string, {
    resolve: (response: StudioCrdtSyncResponse | null) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private readonly seenCrdtUpdateIds = new Set<string>();
  private readonly deliveredCrdtGeneration = new Map<string, number>();
  private meshGeneration = 0;
  private unsubscribePrimary: (() => void) | null = null;
  private signalSequence = 1;
  private closed = false;

  constructor(
    context: StudioLiveTransportContext,
    primary: StudioLiveTransport,
    createPeerConnection: StudioLiveP2pPeerConnectionFactory,
    now: () => number,
    maxPeers: number,
  ) {
    this.context = context;
    this.primary = primary;
    this.mode = primary.mode;
    this.crdtFanout = primary.crdtFanout === "authoritative" ? "authoritative" : "mesh";
    this.createPeerConnection = createPeerConnection;
    this.now = now;
    this.maxPeers = maxPeers;
    this.canonicalSessionId = primary.canonicalSessionId?.bind(primary);
    this.transportSessionId = primary.transportSessionId?.bind(primary);
  }

  get ready(): boolean {
    return this.primary.ready;
  }

  /** Server-backed lanes retain their negotiated capabilities. Peer-only rooms negotiate
   * exact ink independently, and only on ordered, fully reliable RTC data channels. */
  get binaryLaneCapabilities(): readonly string[] {
    if (!this.usesPeerInkLane()) {
      return this.primary.binaryLaneCapabilities ?? STUDIO_LIVE_P2P_NO_BINARY_LANES;
    }
    return this.ready && [...this.peers.values()].some((peer) =>
      this.isReliableMeshLink(peer) && peer.announcedBinaryLanes
      && peer.peerBinaryLanes.includes(STUDIO_LIVE_INK_CAPABILITY)
    ) ? STUDIO_LIVE_P2P_RELIABLE_INK_LANES : STUDIO_LIVE_P2P_NO_BINARY_LANES;
  }

  async connect(): Promise<void> {
    if (this.closed) return;
    this.unsubscribePrimary ??= this.primary.subscribe((value) => {
      this.handlePrimaryInbound(value);
    });
    await this.primary.connect();
  }

  send(envelope: StudioLiveEnvelope): boolean {
    if (this.closed) return false;
    if (isStudioLiveP2pEphemeralKind(envelope.kind)) {
      const result = this.sendEphemeral(envelope);
      if (result === "sent") return true;
      if (result === "rejected") return false;
      if (
        envelope.kind === "preview:gesture"
        && this.primary.crdtFanout !== "authoritative"
      ) return false;
    }
    return this.primary.send(envelope);
  }

  subscribe(listener: (value: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeControl(listener: (event: StudioLiveTransportControlEvent) => void): () => void {
    if (this.closed) return () => undefined;
    this.controlListeners.add(listener);
    const unsubscribe = this.primary.subscribeControl?.(listener);
    return () => {
      this.controlListeners.delete(listener);
      unsubscribe?.();
    };
  }

  acquireLock?(
    request: Parameters<NonNullable<StudioLiveTransport["acquireLock"]>>[0],
  ): ReturnType<NonNullable<StudioLiveTransport["acquireLock"]>> {
    if (!this.primary.acquireLock) {
      return Promise.resolve({
        status: "timeout",
        resource: request.resource,
        requestId: request.requestId,
        message: "권위 있는 편집 잠금 경로가 없습니다.",
      });
    }
    return this.primary.acquireLock(request);
  }

  releaseLock?(
    request: Parameters<NonNullable<StudioLiveTransport["releaseLock"]>>[0],
  ): ReturnType<NonNullable<StudioLiveTransport["releaseLock"]>> {
    if (!this.primary.releaseLock) {
      return Promise.resolve({
        status: "denied",
        resource: request.resource,
        requestId: request.requestId,
        claimId: request.claimId,
        code: "transport_error",
        message: "권위 있는 편집 잠금 경로가 없습니다.",
      });
    }
    return this.primary.releaseLock(request);
  }

  requestCrdtSync(request: StudioCrdtSyncRequest): Promise<StudioCrdtSyncResponse | null> {
    // A peer snapshot can repair a peer room, never certify a server save boundary.
    if (this.primary.crdtFanout === "authoritative") {
      return this.primary.requestCrdtSync?.(request) ?? Promise.resolve(null);
    }
    const primary = this.primary.requestCrdtSync
      ? this.primary.requestCrdtSync(request)
      : null;
    const mesh = this.openPeerChannelCount() > 0 ? this.requestMeshCrdtSync(request) : null;
    if (primary && mesh) return firstNonNullCrdtSyncResponse(primary, mesh);
    return primary ?? mesh ?? Promise.resolve(null);
  }

  respondCrdtSync(response: StudioCrdtSyncResponse, targetSessionId: string): boolean {
    if (this.openPeerChannelCount() > 0) {
      const parsed = parseStudioCrdtSyncResponse(response, {
        expectedWorkId: this.context.workId,
      });
      if (parsed && targetSessionId && this.sendMeshCrdtWire({
        workId: this.context.workId,
        senderSessionId: this.context.participant.sessionId,
        targetSessionId,
        kind: "sync-response",
        payload: parsed,
      })) {
        return true;
      }
    }
    if (this.primary.respondCrdtSync) {
      return this.primary.respondCrdtSync(response, targetSessionId);
    }
    const parsed = parseStudioCrdtSyncResponse(response, {
      expectedWorkId: this.context.workId,
    });
    if (!parsed || !targetSessionId) return false;
    return this.sendMeshCrdtWire({
      workId: this.context.workId,
      senderSessionId: this.context.participant.sessionId,
      targetSessionId,
      kind: "sync-response",
      payload: parsed,
    });
  }

  publishCrdtUpdate(request: StudioCrdtUpdateRequest): Promise<StudioCrdtUpdateAck> {
    // Retain BroadcastChannel for same-profile tabs, but never let its successful receipt hide
    // a failed cross-browser mesh transmission in a room without document authority.
    if (this.primary.publishCrdtUpdate) {
      const primary = this.primary.publishCrdtUpdate(request);
      if (this.openPeerChannelCount() > 0) {
        const mesh = this.publishMeshCrdtUpdate(request);
        if (this.primary.crdtFanout !== "authoritative") {
          return Promise.all([primary, mesh]).then(([acknowledgement]) => acknowledgement);
        }
        void mesh.catch(() => undefined);
      }
      return primary;
    }
    return this.publishMeshCrdtUpdate(request);
  }

  subscribeCrdt(listener: (message: StudioCrdtTransportMessage) => void): () => void {
    if (this.closed) return () => undefined;
    this.crdtListeners.add(listener);
    const unsubscribePrimary = this.primary.subscribeCrdt?.(listener);
    return () => {
      this.crdtListeners.delete(listener);
      unsubscribePrimary?.();
    };
  }

  /**
   * Actual samples on an authoritative connection keep their reliable primary lane. A
   * signaling-only room uses separately negotiated, ordered RTC with unlimited retransmission.
   * Every peer must be capable and writable; congestion/closure returns false to preserve the
   * publisher's retry/cancel contract. Final CRDT strokes remain separate from transient ink.
   */
  sendInk(message: StudioLiveInkWireMessage): boolean {
    if (this.closed) return false;
    if (this.usesPeerInkLane()) {
      if (!this.ready || !this.binaryLaneCapabilities.includes(STUDIO_LIVE_INK_CAPABILITY)) return false;
      if ([...this.peers.values()].some((peer) => !this.isReliableMeshLink(peer))) return false;
      return this.sendMeshInkFrame(message);
    }
    const sendPrimary = this.primary.sendInk;
    if (typeof sendPrimary !== "function" || !this.inkLaneNegotiated()) return false;
    if (message.message.kind === "ink:prediction" && this.sendMeshInkFrame(message)) {
      return true;
    }
    return sendPrimary.call(this.primary, message);
  }

  /** Delivers raw ink-lane candidates from primary and mesh; subscribers run the strict parser. */
  subscribeInk(listener: (value: unknown) => void): () => void {
    if (this.closed) return () => undefined;
    this.inkListeners.add(listener);
    const unsubscribePrimary = this.primary.subscribeInk?.(listener);
    return () => {
      this.inkListeners.delete(listener);
      unsubscribePrimary?.();
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribePrimary?.();
    this.unsubscribePrimary = null;
    for (const pending of this.pendingCrdtSync.values()) {
      clearTimeout(pending.timeout);
      pending.resolve(null);
    }
    this.pendingCrdtSync.clear();
    this.seenCrdtUpdateIds.clear();
    this.deliveredCrdtGeneration.clear();
    this.crdtListeners.clear();
    this.inkListeners.clear();
    this.controlListeners.clear();
    for (const sessionId of [...this.peers.keys()]) this.teardownPeer(sessionId);
    this.knownPeerSessionIds.clear();
    this.listeners.clear();
    this.primary.close();
  }

  private requestMeshCrdtSync(
    request: StudioCrdtSyncRequest,
  ): Promise<StudioCrdtSyncResponse | null> {
    const parsed = parseStudioCrdtSyncRequest(request, {
      expectedWorkId: this.context.workId,
    });
    if (!parsed) {
      return Promise.reject(new Error("CRDT 동기화 요청이 올바르지 않습니다."));
    }
    if (this.pendingCrdtSync.has(parsed.requestId)) {
      return Promise.reject(new Error("같은 CRDT 동기화 요청이 이미 진행 중입니다."));
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingCrdtSync.delete(parsed.requestId);
        resolve(null);
      }, 2_000);
      this.pendingCrdtSync.set(parsed.requestId, { resolve, timeout });
      const sent = this.sendMeshCrdtWire({
        workId: this.context.workId,
        senderSessionId: this.context.participant.sessionId,
        targetSessionId: null,
        kind: "sync-request",
        payload: parsed,
      });
      if (sent) return;
      clearTimeout(timeout);
      this.pendingCrdtSync.delete(parsed.requestId);
      resolve(null);
    });
  }

  private publishMeshCrdtUpdate(
    request: StudioCrdtUpdateRequest,
  ): Promise<StudioCrdtUpdateAck> {
    const parsed = parseStudioCrdtUpdateRequest(request, {
      expectedWorkId: this.context.workId,
    });
    if (!parsed) {
      return Promise.reject(new Error("CRDT 업데이트가 올바르지 않습니다."));
    }
    if (this.closed || this.peers.size === 0
      || this.peers.size !== this.knownPeerSessionIds.size
      || this.openPeerChannelCount() !== this.peers.size) {
      return Promise.reject(new Error("P2P 원고 전송 채널이 준비되지 않았습니다."));
    }
    const duplicate = this.deliveredCrdtGeneration.get(parsed.updateId) === this.meshGeneration;
    if (!duplicate) {
      const delivered = this.sendMeshCrdtWire({
        workId: this.context.workId,
        senderSessionId: this.context.participant.sessionId,
        targetSessionId: null,
        kind: "update",
        payload: {
          protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
          workId: this.context.workId,
          updateId: parsed.updateId,
          serverSequence: "0",
          update: parsed.update,
        },
      });
      if (!delivered) {
        return Promise.reject(new Error("일부 P2P 참여자에게 원고를 전송하지 못해 다시 시도합니다."));
      }
      this.rememberMeshCrdtUpdateId(parsed.updateId);
      // Receiving an ID or delivering it to a previous set of peers is not proof that a new
      // channel received it. Only successful fanout in the current generation suppresses retry.
      this.deliveredCrdtGeneration.set(parsed.updateId, this.meshGeneration);
      if (this.deliveredCrdtGeneration.size > 2_048) {
        const oldest = this.deliveredCrdtGeneration.keys().next().value;
        if (typeof oldest === "string") this.deliveredCrdtGeneration.delete(oldest);
      }
    }
    return Promise.resolve({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: this.context.workId,
      updateId: parsed.updateId,
      serverSequence: "0",
      serverStateVector: null,
      duplicate,
    });
  }

  private sendMeshCrdtWire(
    message: Parameters<typeof createStudioCrdtLocalWireMessage>[0],
  ): boolean {
    if (this.closed || this.peers.size === 0) return false;
    let delivered = 0;
    const serialized = JSON.stringify(createStudioCrdtLocalWireMessage(message));
    const target = message.targetSessionId;
    if (message.kind === "update" && !target
      && this.peers.size !== this.knownPeerSessionIds.size) return false;
    let expected = 0;
    for (const peer of this.peers.values()) {
      if (target && peer.sessionId !== target) continue;
      expected += 1;
      if (this.sendSerializedToPeer(peer, serialized)) delivered += 1;
    }
    return delivered > 0 && (message.kind !== "update" || delivered === expected);
  }

  private receiveMeshCrdt(value: unknown): boolean {
    if (!isStudioCrdtLocalWireCandidate(value)) return false;
    const wire = parseStudioCrdtLocalWireMessage(value, {
      expectedWorkId: this.context.workId,
      selfSessionId: this.context.participant.sessionId,
    });
    if (!wire) return true;
    if (wire.kind === "sync-response") {
      const pending = this.pendingCrdtSync.get(wire.payload.requestId);
      if (!pending) return true;
      this.pendingCrdtSync.delete(wire.payload.requestId);
      clearTimeout(pending.timeout);
      pending.resolve(wire.payload);
      return true;
    }
    if (wire.kind === "sync-request") {
      this.emitMeshCrdt({
        type: "sync-request",
        request: wire.payload,
        senderSessionId: wire.senderSessionId,
      });
      return true;
    }
    if (this.seenCrdtUpdateIds.has(wire.payload.updateId)) return true;
    this.rememberMeshCrdtUpdateId(wire.payload.updateId);
    this.emitMeshCrdt({
      type: "update",
      update: wire.payload,
      senderSessionId: wire.senderSessionId,
    });
    return true;
  }

  private emitMeshCrdt(message: StudioCrdtTransportMessage): void {
    for (const listener of this.crdtListeners) listener(message);
  }

  private rememberMeshCrdtUpdateId(updateId: string): void {
    if (this.seenCrdtUpdateIds.has(updateId)) return;
    this.seenCrdtUpdateIds.add(updateId);
    if (this.seenCrdtUpdateIds.size <= 2_048) return;
    const oldest = this.seenCrdtUpdateIds.values().next().value;
    if (typeof oldest === "string") this.seenCrdtUpdateIds.delete(oldest);
  }

  private openPeerChannelCount(): number {
    let open = 0;
    for (const peer of this.peers.values()) {
      if (!peer.closed && peer.channel?.readyState === "open") open += 1;
    }
    return open;
  }

  private sendEphemeral(envelope: StudioLiveEnvelope): StudioLiveP2pEphemeralSendResult {
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(envelope);
    } catch {
      return "rejected";
    }
    if (serialized === undefined) return "rejected";
    const serializedBytes = studioLiveUtf8ByteLength(serialized);
    const isPreview = envelope.kind === "preview:gesture";
    if (
      isPreview
      && serializedBytes > STUDIO_LIVE_GESTURE_PREVIEW_ENVELOPE_MAX_BYTES
    ) return "rejected";

    const targetSessionId = envelope.targetSessionId;
    if (targetSessionId) {
      const peer = this.peers.get(targetSessionId);
      if (!peer || !this.peerCanSendSerialized(peer, serializedBytes, isPreview)) {
        return "fallback";
      }
      return this.sendSerializedToPeer(peer, serialized) ? "sent" : "fallback";
    }
    // A peer that exceeded the mesh cap or whose channel failed is still known through presence.
    // Fall back before a partial fanout so every room member sees the same ephemeral packet.
    if (
      this.knownPeerSessionIds.size === 0
      || this.peers.size !== this.knownPeerSessionIds.size
      || [...this.peers.values()].some(
        (peer) => peer.closed || peer.channel?.readyState !== "open",
      )
    ) return "fallback";
    if (
      isPreview
      && [...this.peers.values()].some(
        (peer) => !this.peerCanSendSerialized(peer, serializedBytes, true),
      )
    ) return "fallback";

    let delivered = 0;
    for (const peer of this.peers.values()) {
      if (this.sendSerializedToPeer(peer, serialized)) delivered += 1;
      // A channel can still close between preflight and send. The authoritative primary may
      // duplicate an already-delivered packet, which the preview store handles idempotently; it
      // is preferable to silently omitting the remaining peers.
      else return "fallback";
    }
    return delivered > 0 ? "sent" : "fallback";
  }

  private peerCanSendSerialized(
    peer: StudioLiveP2pPeerLink,
    serializedBytes: number,
    enforcePreviewLimits: boolean,
  ): boolean {
    const channel = peer.channel;
    if (peer.closed || channel?.readyState !== "open") return false;
    if (!enforcePreviewLimits) return true;
    return this.channelCanCarry(
      peer,
      serializedBytes,
      STUDIO_LIVE_P2P_PREVIEW_MAX_BUFFERED_BYTES,
    );
  }

  private channelCanCarry(
    peer: StudioLiveP2pPeerLink,
    messageBytes: number,
    maxBufferedBytes: number,
  ): boolean {
    const channel = peer.channel;
    if (peer.closed || channel?.readyState !== "open") return false;
    if (
      !Number.isFinite(channel.bufferedAmount)
      || channel.bufferedAmount < 0
      || channel.bufferedAmount + messageBytes > maxBufferedBytes
    ) return false;
    const maxMessageSize = peer.connection.sctp?.maxMessageSize;
    return maxMessageSize === undefined
      || maxMessageSize === 0
      || maxMessageSize === Number.POSITIVE_INFINITY
      || (Number.isFinite(maxMessageSize)
        && maxMessageSize > 0
        && messageBytes <= maxMessageSize);
  }

  private sendSerializedToPeer(peer: StudioLiveP2pPeerLink, serialized: string): boolean {
    if (peer.closed || peer.channel?.readyState !== "open") return false;
    try {
      peer.channel.send(serialized);
      return true;
    } catch {
      return false;
    }
  }

  private sendBinaryToPeer(peer: StudioLiveP2pPeerLink, frame: ArrayBuffer): boolean {
    if (peer.closed || peer.channel?.readyState !== "open") return false;
    try {
      peer.channel.send(frame);
      return true;
    } catch {
      return false;
    }
  }

  private usesPeerInkLane(): boolean {
    return this.primary.crdtFanout === "mesh" || this.primary.crdtFanout === "none";
  }

  private isReliableMeshLink(peer: StudioLiveP2pPeerLink): boolean {
    const channel = peer.channel;
    return !peer.closed && channel?.readyState === "open" && channel.ordered === true
      && channel.maxRetransmits === null && channel.maxPacketLifeTime === null;
  }

  /** True only when the primary negotiated the ink-v2 binary lane for this connection. */
  private inkLaneNegotiated(): boolean {
    return (
      typeof this.primary.sendInk === "function"
      && (this.primary.binaryLaneCapabilities?.includes(STUDIO_LIVE_INK_CAPABILITY) ?? false)
    );
  }

  /**
   * Exact binary fanout, selected by the caller for reliable peer actuals or droppable predictions.
   * Every known peer must have an open channel, announce ink-v2 and accept the complete frame.
   * Partial failure is returned to the caller, never reported as successful room-wide delivery.
   */
  private sendMeshInkFrame(wire: StudioLiveInkWireMessage): boolean {
    if (
      this.knownPeerSessionIds.size === 0
      || this.peers.size !== this.knownPeerSessionIds.size
    ) return false;
    const frame = encodeStudioLiveP2pInkFrame(wire);
    if (!frame) return false;
    const peers = [...this.peers.values()];
    if (
      peers.some(
        (peer) =>
          !peer.peerBinaryLanes.includes(STUDIO_LIVE_INK_CAPABILITY)
          || !this.channelCanCarry(
            peer,
            frame.byteLength,
            STUDIO_LIVE_P2P_INK_MAX_BUFFERED_BYTES,
          ),
      )
    ) return false;
    for (const peer of peers) {
      if (!this.sendBinaryToPeer(peer, frame)) return false;
    }
    return true;
  }

  /** Announces negotiated binary lanes so the peer can gate its mesh ink fanout per peer. */
  private announceMeshBinaryLanes(link: StudioLiveP2pPeerLink): void {
    if (link.closed || link.announcedBinaryLanes) return;
    const lanes = this.usesPeerInkLane()
      ? (this.isReliableMeshLink(link) ? STUDIO_LIVE_P2P_RELIABLE_INK_LANES : STUDIO_LIVE_P2P_NO_BINARY_LANES)
      : this.primary.binaryLaneCapabilities ?? STUDIO_LIVE_P2P_NO_BINARY_LANES;
    if (lanes.length === 0) return;
    // Set before send: a synchronous adapter can answer during send, otherwise recursing forever.
    link.announcedBinaryLanes = true;
    if (!this.sendSerializedToPeer(
      link,
      JSON.stringify({ wire: STUDIO_LIVE_P2P_CAPS_WIRE, binaryLanes: [...lanes] }),
    )) link.announcedBinaryLanes = false;
  }

  private receiveMeshInk(link: StudioLiveP2pPeerLink, data: ArrayBuffer): void {
    // Fail closed without a locally negotiated lane. Never approximate exact ink with JSON.
    if (this.usesPeerInkLane()) {
      if (!this.ready || !this.isReliableMeshLink(link) || !link.announcedBinaryLanes
        || !link.peerBinaryLanes.includes(STUDIO_LIVE_INK_CAPABILITY)) return;
    } else if (!this.inkLaneNegotiated()) return;
    if (!this.acceptMeshInkInbound(link, data.byteLength)) return;
    const candidate = decodeStudioLiveP2pInkFrame(data);
    // The frame must claim the sending link's verified presence identity — no mesh relaying.
    if (!candidate || candidate.senderSessionId !== link.sessionId) return;
    for (const listener of this.inkListeners) listener(candidate);
  }

  private acceptMeshInkInbound(link: StudioLiveP2pPeerLink, byteLength: number): boolean {
    if (byteLength > STUDIO_LIVE_P2P_INK_INBOUND_MAX_BYTES) return false;
    const now = this.now();
    const window = link.inkInboundWindow;
    if (
      !window
      || now < window.startedAt
      || now - window.startedAt >= STUDIO_LIVE_P2P_INK_INBOUND_WINDOW_MS
    ) {
      link.inkInboundWindow = { startedAt: now, packetCount: 1, byteCount: byteLength };
      return true;
    }
    if (
      window.packetCount >= STUDIO_LIVE_P2P_INK_INBOUND_MAX_PACKETS
      || window.byteCount + byteLength > STUDIO_LIVE_P2P_INK_INBOUND_MAX_BYTES
    ) return false;
    window.packetCount += 1;
    window.byteCount += byteLength;
    return true;
  }

  private handlePrimaryInbound(value: unknown): void {
    if (this.closed) return;
    const envelope = parseStudioLiveEnvelope(value, {
      expectedWorkId: this.context.workId,
      selfSessionId: this.context.participant.sessionId,
      now: this.now(),
    });
    if (envelope && isMeshSignal(envelope)) {
      void this.handleMeshSignal(envelope);
      return;
    }
    if (envelope) this.observePresence(envelope);
    this.emit(value);
  }

  private observePresence(envelope: StudioLiveEnvelope): void {
    const sessionId = envelope.sender.sessionId;
    if (sessionId === this.context.participant.sessionId) return;
    if (envelope.kind === "presence:leave") {
      this.knownPeerSessionIds.delete(sessionId);
      this.teardownPeer(sessionId);
      return;
    }
    if (envelope.kind === "presence:hello" || envelope.kind === "presence:heartbeat") {
      this.knownPeerSessionIds.add(sessionId);
      this.ensurePeer(envelope.sender);
    }
  }

  private ensurePeer(participant: StudioLiveParticipant): void {
    if (this.closed) return;
    const sessionId = participant.sessionId;
    if (sessionId === this.context.participant.sessionId) return;
    const existing = this.peers.get(sessionId);
    if (existing && !existing.closed) {
      existing.participant = participant;
      return;
    }
    if (!existing && this.peers.size >= this.maxPeers) return;

    let connection: StudioLiveP2pRtcPeerConnection;
    try {
      connection = this.createPeerConnection();
    } catch {
      return;
    }
    const link: StudioLiveP2pPeerLink = {
      sessionId,
      participant,
      connection,
      channel: null,
      remoteDescriptionSet: false,
      pendingIce: [],
      peerBinaryLanes: STUDIO_LIVE_P2P_NO_BINARY_LANES,
      announcedBinaryLanes: false,
      inkInboundWindow: null,
      closed: false,
    };
    this.peers.set(sessionId, link);
    connection.onicecandidate = (event) => {
      const candidate = event.candidate;
      if (link.closed || !candidate?.candidate) return;
      this.sendMeshIce(sessionId, candidate);
    };
    connection.ondatachannel = (event) => {
      if (link.closed) return;
      this.bindChannel(link, event.channel);
    };
    connection.onconnectionstatechange = () => {
      if (link.closed) return;
      const state = connection.connectionState;
      if (state === "failed" || state === "closed") {
        this.teardownPeer(sessionId);
      }
    };
    if (!shouldOfferMesh(this.context.participant.sessionId, sessionId)) return;
    try {
      this.bindChannel(link, connection.createDataChannel(STUDIO_LIVE_P2P_CHANNEL_LABEL));
    } catch {
      this.teardownPeer(sessionId);
      return;
    }
    void this.sendMeshOffer(link);
  }

  private async sendMeshOffer(link: StudioLiveP2pPeerLink): Promise<void> {
    try {
      const offer = await link.connection.createOffer();
      if (link.closed || this.closed) return;
      await link.connection.setLocalDescription(offer);
      if (link.closed || this.closed) return;
      if (typeof offer.sdp !== "string" || offer.sdp.length === 0) return;
      this.sendMeshDescription(link.sessionId, "offer", offer.sdp);
    } catch {
      // A rejected offer from a retired connection must not close a newer link for the peer.
      if (this.peers.get(link.sessionId) === link) this.teardownPeer(link.sessionId);
    }
  }

  private async handleMeshSignal(
    envelope: StudioLiveEnvelope<"webrtc:description" | "webrtc:ice">,
  ): Promise<void> {
    this.ensurePeer(envelope.sender);
    const link = this.peers.get(envelope.sender.sessionId);
    if (!link || link.closed) return;
    try {
      if (envelope.kind === "webrtc:description") {
        const payload = envelope.payload as StudioLiveWebRtcDescriptionPayload;
        await link.connection.setRemoteDescription({
          type: payload.type,
          sdp: payload.sdp,
        });
        if (link.closed || this.closed) return;
        link.remoteDescriptionSet = true;
        await this.flushPendingIce(link);
        if (payload.type === "offer") {
          const answer = await link.connection.createAnswer();
          if (link.closed || this.closed) return;
          await link.connection.setLocalDescription(answer);
          if (link.closed || this.closed || typeof answer.sdp !== "string") return;
          this.sendMeshDescription(link.sessionId, "answer", answer.sdp);
        }
        return;
      }
      const ice = envelope.payload as StudioLiveWebRtcIcePayload;
      const candidate: RTCIceCandidateInit = {
        candidate: ice.candidate,
        sdpMid: ice.sdpMid,
        sdpMLineIndex: ice.sdpMLineIndex,
        usernameFragment: ice.usernameFragment,
      };
      if (!link.remoteDescriptionSet) {
        if (link.pendingIce.length < 32) link.pendingIce.push(candidate);
        return;
      }
      await link.connection.addIceCandidate(candidate);
    } catch {
      // ICE/SDP can race a close or a stale candidate. Keep the mesh opportunistic.
    }
  }

  private bindChannel(
    link: StudioLiveP2pPeerLink,
    channel: StudioLiveP2pRtcDataChannel,
  ): void {
    bindStudioLiveP2pChannelLifecycle({
      link,
      channel,
      isActive: () => !this.closed && this.peers.get(link.sessionId) === link,
      resetNegotiation: () => {
        link.announcedBinaryLanes = false;
        link.peerBinaryLanes = STUDIO_LIVE_P2P_NO_BINARY_LANES;
        link.inkInboundWindow = null;
      },
      onOpen: () => {
        this.announceMeshBinaryLanes(link);
        this.notifyMeshReady(link, channel);
      },
      onMessage: (value) => this.handleChannelMessage(link, value),
      onClosed: () => this.teardownPeer(link.sessionId),
    });
  }

  private notifyMeshReady(link: StudioLiveP2pPeerLink, channel: StudioLiveP2pRtcDataChannel): void {
    if (this.meshReadyChannels.has(channel)) return;
    this.meshReadyChannels.add(channel);
    this.meshGeneration += 1;
    if (!this.usesPeerInkLane()) return;
    queueMicrotask(() => {
      if (this.closed || link.closed || link.channel !== channel || channel.readyState !== "open") return;
      const event: StudioLiveTransportControlEvent = { type: "status", status: {
        state: "ready", message: "P2P 데이터 채널이 연결되어 누락된 원고를 다시 맞춥니다.", recoverable: true,
      } };
      for (const listener of this.controlListeners) {
        try {
          listener(event);
        } catch {
          // An observer must not break peer delivery.
        }
      }
    });
  }

  private handleChannelMessage(link: StudioLiveP2pPeerLink, data: unknown): void {
    if (this.closed || link.closed || this.peers.get(link.sessionId) !== link) return;
    if (data instanceof ArrayBuffer) {
      this.receiveMeshInk(link, data);
      return;
    }
    if (typeof data !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data) as unknown;
    } catch {
      return;
    }
    const peerLanes = parseStudioLiveP2pCapsMessage(parsed);
    if (peerLanes) {
      link.peerBinaryLanes = peerLanes;
      // Announcements can race the channel opening (the offerer's greeting may fire while the
      // answerer is still connecting). Answer a peer's caps so the exchange always converges.
      this.announceMeshBinaryLanes(link);
      return;
    }
    if (this.receiveMeshCrdt(parsed)) return;
    const envelope = parseStudioLiveEnvelope(parsed, {
      expectedWorkId: this.context.workId,
      selfSessionId: this.context.participant.sessionId,
      now: this.now(),
    });
    if (
      !envelope
      || envelope.sender.sessionId !== link.sessionId
      || !isStudioLiveP2pEphemeralKind(envelope.kind)
    ) return;
    this.emit({
      ...envelope,
      sender: { ...link.participant },
    });
  }

  private sendMeshDescription(
    targetSessionId: string,
    type: "offer" | "answer",
    sdp: string,
  ): void {
    this.sendSignal(
      targetSessionId,
      "webrtc:description",
      {
        shareId: STUDIO_LIVE_P2P_MESH_SHARE_ID,
        type,
        sdp,
      },
    );
  }

  private sendMeshIce(
    targetSessionId: string,
    candidate: StudioLiveP2pRtcIceCandidate,
  ): void {
    this.sendSignal(
      targetSessionId,
      "webrtc:ice",
      {
        shareId: STUDIO_LIVE_P2P_MESH_SHARE_ID,
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid ?? null,
        sdpMLineIndex: candidate.sdpMLineIndex ?? null,
        usernameFragment: candidate.usernameFragment ?? null,
      },
    );
  }

  private sendSignal<K extends "webrtc:description" | "webrtc:ice">(
    targetSessionId: string,
    kind: K,
    payload: K extends "webrtc:description"
      ? StudioLiveWebRtcDescriptionPayload
      : StudioLiveWebRtcIcePayload,
  ): void {
    if (this.closed) return;
    try {
      if (kind === "webrtc:description") {
        const envelope = createStudioLiveEnvelope({
          workId: this.context.workId,
          sender: this.context.participant,
          sentAt: this.now(),
          sequence: this.signalSequence++,
          kind: "webrtc:description",
          targetSessionId,
          payload: payload as StudioLiveWebRtcDescriptionPayload,
        });
        this.primary.send(envelope);
      } else {
        const envelope = createStudioLiveEnvelope({
          workId: this.context.workId,
          sender: this.context.participant,
          sentAt: this.now(),
          sequence: this.signalSequence++,
          kind: "webrtc:ice",
          targetSessionId,
          payload: payload as StudioLiveWebRtcIcePayload,
        });
        this.primary.send(envelope);
      }
    } catch {
      // Invalid SDP/ICE is dropped; the next presence tick can retry the mesh.
    }
  }

  private async flushPendingIce(link: StudioLiveP2pPeerLink): Promise<void> {
    const queued = link.pendingIce.splice(0, link.pendingIce.length);
    for (const candidate of queued) {
      if (link.closed) return;
      try {
        await link.connection.addIceCandidate(candidate);
      } catch {
        // Stale candidate after an ICE restart is ignored.
      }
    }
  }

  private teardownPeer(sessionId: string): void {
    const link = this.peers.get(sessionId);
    if (!link) return;
    link.closed = true;
    this.peers.delete(sessionId);
    try {
      link.channel?.close();
    } catch {
      // Channel may already be closing.
    }
    try {
      link.connection.close();
    } catch {
      // Peer connection may already be closed.
    }
  }

  private emit(value: unknown): void {
    for (const listener of this.listeners) {
      try {
        listener(value);
      } catch {
        // Room observers do not own the mesh lifecycle.
      }
    }
  }

}

/**
 * Wraps a server live factory with an opportunistic P2P overlay. Local BroadcastChannel rooms
 * are already same-origin P2P and are left untouched. Missing WebRTC is a no-op wrap.
 */
export function applyStudioLiveP2pOverlay(
  primaryFactory: StudioLiveTransportFactory,
  options: StudioLiveP2pOverlayOptions = {},
): StudioLiveTransportFactory {
  if (options.enabled === false) return primaryFactory;
  return (context) => {
    const primary = primaryFactory(context);
    if (primary.mode !== "server") return primary;
    const createPeerConnection =
      options.createPeerConnection ??
      (() => {
        const connection = defaultCreatePeerConnection();
        if (!connection) {
          throw new Error("WebRTC is unavailable");
        }
        return connection;
      });
    if (!options.createPeerConnection && typeof RTCPeerConnection !== "function") {
      return primary;
    }
    return new StudioLiveP2pOverlayTransport(
      context,
      primary,
      createPeerConnection,
      options.now ?? Date.now,
      options.maxPeers ?? STUDIO_LIVE_P2P_MAX_PEERS,
    );
  };
}
