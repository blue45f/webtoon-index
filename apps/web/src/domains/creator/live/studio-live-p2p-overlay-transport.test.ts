import { describe, expect, it, vi } from "vitest";

import { STUDIO_CRDT_PROTOCOL_VERSION } from "./studio-crdt-protocol";
import {
  STUDIO_LIVE_GESTURE_PREVIEW_ENVELOPE_MAX_BYTES,
  createStudioLiveEnvelope,
  studioLiveEnvelopeByteLength,
  type StudioLiveEnvelope,
  type StudioLiveMessageKind,
  type StudioLiveParticipant,
  type StudioLivePayloadMap,
} from "./studio-live-collaboration-protocol";
import {
  encodeStudioLiveInkSamples,
  hashStudioLiveInkPayloads,
} from "./studio-live-ink-codec";
import {
  createStudioLiveInkWireMessage,
  STUDIO_LIVE_INK_CAPABILITY,
  STUDIO_LIVE_INK_PROTOCOL_VERSION,
  STUDIO_LIVE_INK_SAMPLE_SCHEMA,
  type StudioLiveInkWireMessage,
} from "./studio-live-ink-protocol";
import {
  applyStudioLiveP2pOverlay,
  isStudioLiveP2pEphemeralKind,
  isStudioLiveP2pMeshShareId,
  STUDIO_LIVE_P2P_CHANNEL_LABEL,
  STUDIO_LIVE_P2P_INK_INBOUND_MAX_PACKETS,
  STUDIO_LIVE_P2P_MESH_SHARE_ID,
  STUDIO_LIVE_P2P_PREVIEW_MAX_BUFFERED_BYTES,
  type StudioLiveP2pRtcDataChannel,
  type StudioLiveP2pRtcPeerConnection,
} from "./studio-live-p2p-overlay-transport";
import { createStudioLiveSignalingServerTransportFactory } from "./studio-live-signaling-server-transport";

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
} from "./studio-live-collaboration-transport";
import type { StudioLiveGesturePreviewPayload } from "./studio-live-gesture-preview";

const NOW = Date.parse("2026-08-15T04:00:00.000Z");

const LOCAL: StudioLiveParticipant = {
  sessionId: "00000000-0000-4000-8000-000000000001",
  displayName: "작가",
  role: "owner",
};
const REMOTE: StudioLiveParticipant = {
  sessionId: "00000000-0000-4000-8000-000000000002",
  displayName: "어시스턴트",
  role: "editor",
};
const THIRD: StudioLiveParticipant = {
  sessionId: "00000000-0000-4000-8000-000000000003",
  displayName: "채색 보조",
  role: "editor",
};

function contextFor(participant: StudioLiveParticipant): StudioLiveTransportContext {
  return {
    workId: "work-p2p",
    roomName: "room-p2p",
    participant,
  };
}

function gesturePreview(gestureId = "gesture-p2p-1"): StudioLiveGesturePreviewPayload {
  return {
    version: 1,
    gestureId,
    pageId: "page-1",
    seq: 1,
    phase: "begin",
    operation: "erase",
    base: { documentGeneration: 1 },
    renderer: {
      kind: "freehand",
      mode: "eraser",
      stroke: "#000000",
      strokeWidth: 12,
    },
    samples: { startIndex: 0, points: [10, 20] },
  };
}

function envelope<K extends StudioLiveMessageKind>(input: {
  sender: StudioLiveParticipant;
  kind: K;
  payload: StudioLivePayloadMap[K];
  sequence?: number;
  targetSessionId?: string | null;
}): StudioLiveEnvelope<K> {
  return createStudioLiveEnvelope({
    workId: "work-p2p",
    sender: input.sender,
    sentAt: NOW,
    sequence: input.sequence ?? 1,
    kind: input.kind,
    targetSessionId: input.targetSessionId ?? null,
    payload: input.payload,
  });
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

class MemoryDataChannel implements StudioLiveP2pRtcDataChannel {
  readonly label: string;
  readyState = "connecting";
  bufferedAmount = 0;
  binaryType?: string;
  peer: MemoryDataChannel | null = null;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

  constructor(
    label: string,
    private readonly beforeSend: () => void,
  ) {
    this.label = label;
  }

  send(data: string | ArrayBuffer): void {
    if (this.readyState !== "open" || this.peer?.readyState !== "open") {
      throw new Error("data channel is not open");
    }
    this.beforeSend();
    const delivered = data instanceof ArrayBuffer ? data.slice(0) : data;
    this.peer.onmessage?.({ data: delivered } as MessageEvent<unknown>);
  }

  close(): void {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.onclose?.(new Event("close"));
    const peer = this.peer;
    this.peer = null;
    peer?.close();
  }

  markOpen(): void {
    if (this.readyState === "open") return;
    this.readyState = "open";
    this.onopen?.(new Event("open"));
  }
}

class MemoryPeerConnection implements StudioLiveP2pRtcPeerConnection {
  connectionState = "new";
  readonly sctp = { maxMessageSize: 0 };
  onicecandidate: StudioLiveP2pRtcPeerConnection["onicecandidate"] = null;
  ondatachannel: StudioLiveP2pRtcPeerConnection["ondatachannel"] = null;
  onconnectionstatechange: (() => void) | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localChannel: MemoryDataChannel | null = null;
  readonly id: string;

  constructor(
    private readonly hub: MemoryRtcHub,
    id: string,
  ) {
    this.id = id;
  }

  createDataChannel(label: string): StudioLiveP2pRtcDataChannel {
    const channel = this.hub.createChannel(label);
    this.localChannel = channel;
    return channel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: "offer", sdp: `offer-${this.id}` };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: "answer", sdp: `answer-${this.id}` };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description;
    this.hub.linkIfReady(this);
    this.onicecandidate?.({
      candidate: {
        candidate: `host-${this.id}`,
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: null,
      },
    });
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description;
    this.hub.linkIfReady(this);
  }

  async addIceCandidate(_candidate: RTCIceCandidateInit): Promise<void> {
    return;
  }

  close(): void {
    this.connectionState = "closed";
    this.localChannel?.close();
    this.onconnectionstatechange?.();
  }
}

class MemoryRtcHub {
  private nextId = 1;
  private readonly connections = new Set<MemoryPeerConnection>();
  private readonly channels = new Set<MemoryDataChannel>();
  private sendsBeforeFailure: number | null = null;
  private simulatedSendFailure = false;

  get didSimulateSendFailure(): boolean {
    return this.simulatedSendFailure;
  }

  createChannel(label: string): MemoryDataChannel {
    const channel = new MemoryDataChannel(label, () => this.beforeDataChannelSend());
    this.channels.add(channel);
    return channel;
  }

  setBufferedAmount(value: number): void {
    for (const channel of this.channels) channel.bufferedAmount = value;
  }

  setMaxMessageSize(value: number): void {
    for (const connection of this.connections) connection.sctp.maxMessageSize = value;
  }

  failOnNthSend(sendNumber: number): void {
    this.sendsBeforeFailure = sendNumber;
  }

  private beforeDataChannelSend(): void {
    if (this.sendsBeforeFailure === null) return;
    this.sendsBeforeFailure -= 1;
    if (this.sendsBeforeFailure > 0) return;
    this.sendsBeforeFailure = null;
    this.simulatedSendFailure = true;
    throw new Error("simulated data-channel send failure");
  }

  create(): StudioLiveP2pRtcPeerConnection {
    const connection = new MemoryPeerConnection(this, String(this.nextId++));
    this.connections.add(connection);
    return connection;
  }

  linkIfReady(connection: MemoryPeerConnection): void {
    if (!connection.localDescription || !connection.remoteDescription) return;
    for (const other of this.connections) {
      if (other === connection) continue;
      if (!other.localDescription || !other.remoteDescription) continue;
      if (
        other.localDescription.sdp !== connection.remoteDescription.sdp ||
        other.remoteDescription.sdp !== connection.localDescription.sdp
      ) {
        continue;
      }
      this.openPair(connection, other);
      return;
    }
  }

  private openPair(left: MemoryPeerConnection, right: MemoryPeerConnection): void {
    const offered = left.localChannel ?? right.localChannel;
    if (!offered) return;
    const answerer = this.createChannel(STUDIO_LIVE_P2P_CHANNEL_LABEL);
    offered.peer = answerer;
    answerer.peer = offered;
    const answerConnection = left.localChannel ? right : left;
    answerConnection.ondatachannel?.({ channel: answerer });
    offered.markOpen();
    answerer.markOpen();
    left.connectionState = "connected";
    right.connectionState = "connected";
  }
}

class SignalingBus {
  readonly primaries = new Map<string, FakePrimaryTransport>();

  create(
    participant: StudioLiveParticipant,
    crdtFanout: "authoritative" | "mesh" = "authoritative",
  ): FakePrimaryTransport {
    const primary = new FakePrimaryTransport(this, participant.sessionId, crdtFanout);
    this.primaries.set(participant.sessionId, primary);
    return primary;
  }

  deliver(fromSessionId: string, envelope: StudioLiveEnvelope): void {
    if (envelope.targetSessionId) {
      this.primaries.get(envelope.targetSessionId)?.emit(envelope);
      return;
    }
    for (const [sessionId, primary] of this.primaries) {
      if (sessionId === fromSessionId) continue;
      primary.emit(envelope);
    }
  }

  deliverInk(fromSessionId: string, wire: StudioLiveInkWireMessage): void {
    for (const [sessionId, primary] of this.primaries) {
      if (sessionId === fromSessionId) continue;
      primary.emitInk(wire);
    }
  }
}

class FakePrimaryTransport implements StudioLiveTransport {
  readonly mode = "server" as const;
  readonly sent: StudioLiveEnvelope[] = [];
  readonly sentInk: StudioLiveInkWireMessage[] = [];
  binaryLaneCapabilities: readonly string[] = [STUDIO_LIVE_INK_CAPABILITY];
  readonly acquireLock = vi.fn(async () => ({
    status: "timeout" as const,
    resource: "page:1",
    requestId: "request-1",
    message: "test",
  }));
  readonly publishCrdtUpdate = vi.fn(
    async (request: StudioCrdtUpdateRequest): Promise<StudioCrdtUpdateAck> => ({
      protocolVersion: request.protocolVersion,
      workId: request.workId,
      updateId: request.updateId,
      duplicate: false,
      serverSequence: "1",
      serverStateVector: null,
    }),
  );
  readonly requestCrdtSync = vi.fn(
    async (_request: StudioCrdtSyncRequest): Promise<StudioCrdtSyncResponse | null> => null,
  );
  private readonly listeners = new Set<(value: unknown) => void>();
  private readonly controlListeners = new Set<
    (event: StudioLiveTransportControlEvent) => void
  >();
  private readonly crdtListeners = new Set<(message: StudioCrdtTransportMessage) => void>();
  private readonly inkListeners = new Set<(value: unknown) => void>();
  ready = false;
  closed = false;

  constructor(
    private readonly bus: SignalingBus,
    readonly sessionId: string,
    readonly crdtFanout: "authoritative" | "mesh",
  ) {}

  async connect(): Promise<void> {
    this.ready = true;
  }

  send(envelope: StudioLiveEnvelope): boolean {
    if (!this.ready || this.closed) return false;
    this.sent.push(envelope);
    this.bus.deliver(this.sessionId, envelope);
    return true;
  }

  sendInk(message: StudioLiveInkWireMessage): boolean {
    if (!this.ready || this.closed) return false;
    this.sentInk.push(message);
    this.bus.deliverInk(this.sessionId, message);
    return true;
  }

  subscribeInk(listener: (value: unknown) => void): () => void {
    this.inkListeners.add(listener);
    return () => this.inkListeners.delete(listener);
  }

  emit(value: unknown): void {
    for (const listener of this.listeners) listener(value);
  }

  emitInk(value: unknown): void {
    for (const listener of this.inkListeners) listener(value);
  }

  subscribe(listener: (value: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeControl(listener: (event: StudioLiveTransportControlEvent) => void): () => void {
    this.controlListeners.add(listener);
    return () => this.controlListeners.delete(listener);
  }

  subscribeCrdt(listener: (message: StudioCrdtTransportMessage) => void): () => void {
    this.crdtListeners.add(listener);
    return () => this.crdtListeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.ready = false;
    this.listeners.clear();
  }
}

async function connectedMesh(options: {
  localBinaryLanes?: readonly string[];
  remoteBinaryLanes?: readonly string[];
} = {}): Promise<{
  hub: MemoryRtcHub;
  localPrimary: FakePrimaryTransport;
  remotePrimary: FakePrimaryTransport;
  local: StudioLiveTransport;
  remote: StudioLiveTransport;
  receivedRemote: StudioLiveEnvelope[];
}> {
  const hub = new MemoryRtcHub();
  const bus = new SignalingBus();
  const localPrimary = bus.create(LOCAL);
  const remotePrimary = bus.create(REMOTE);
  if (options.localBinaryLanes) localPrimary.binaryLaneCapabilities = options.localBinaryLanes;
  if (options.remoteBinaryLanes) remotePrimary.binaryLaneCapabilities = options.remoteBinaryLanes;
  const local = applyStudioLiveP2pOverlay(() => localPrimary, {
    createPeerConnection: () => hub.create(),
    now: () => NOW,
  })(contextFor(LOCAL));
  const remote = applyStudioLiveP2pOverlay(() => remotePrimary, {
    createPeerConnection: () => hub.create(),
    now: () => NOW,
  })(contextFor(REMOTE));
  const receivedRemote: StudioLiveEnvelope[] = [];
  remote.subscribe((value) => receivedRemote.push(value as StudioLiveEnvelope));
  await local.connect();
  await remote.connect();
  localPrimary.emit(
    envelope({
      sender: REMOTE,
      kind: "presence:heartbeat",
      payload: { visibility: "active", pageId: "page-1", tool: "pen" },
    }),
  );
  await flush();
  remotePrimary.emit(
    envelope({
      sender: LOCAL,
      kind: "presence:heartbeat",
      payload: { visibility: "active", pageId: "page-1", tool: "pen" },
      sequence: 2,
    }),
  );
  await flush();
  return { hub, localPrimary, remotePrimary, local, remote, receivedRemote };
}

async function connectedThreePeerMesh(): Promise<{
  hub: MemoryRtcHub;
  localPrimary: FakePrimaryTransport;
  local: StudioLiveTransport;
  receivedRemote: StudioLiveEnvelope[];
  receivedThird: StudioLiveEnvelope[];
}> {
  const hub = new MemoryRtcHub();
  const bus = new SignalingBus();
  const localPrimary = bus.create(LOCAL);
  const remotePrimary = bus.create(REMOTE);
  const thirdPrimary = bus.create(THIRD);
  const wrap = (primary: FakePrimaryTransport, participant: StudioLiveParticipant) =>
    applyStudioLiveP2pOverlay(() => primary, {
      createPeerConnection: () => hub.create(),
      now: () => NOW,
    })(contextFor(participant));
  const local = wrap(localPrimary, LOCAL);
  const remote = wrap(remotePrimary, REMOTE);
  const third = wrap(thirdPrimary, THIRD);
  const receivedRemote: StudioLiveEnvelope[] = [];
  const receivedThird: StudioLiveEnvelope[] = [];
  remote.subscribe((value) => receivedRemote.push(value as StudioLiveEnvelope));
  third.subscribe((value) => receivedThird.push(value as StudioLiveEnvelope));
  await local.connect();
  await remote.connect();
  await third.connect();

  const presence = (
    sender: StudioLiveParticipant,
    sequence: number,
  ) => envelope({
    sender,
    kind: "presence:heartbeat",
    payload: { visibility: "active", pageId: "page-1", tool: "pen" },
    sequence,
  });
  localPrimary.emit(presence(REMOTE, 1));
  localPrimary.emit(presence(THIRD, 1));
  remotePrimary.emit(presence(LOCAL, 2));
  remotePrimary.emit(presence(THIRD, 2));
  thirdPrimary.emit(presence(LOCAL, 3));
  thirdPrimary.emit(presence(REMOTE, 3));
  await flush();
  await flush();
  return { hub, localPrimary, local, receivedRemote, receivedThird };
}

describe("Studio live P2P overlay", () => {
  it("leaves local BroadcastChannel transports unwrapped", () => {
    const localTransport: StudioLiveTransport = {
      mode: "local",
      ready: true,
      connect: () => Promise.resolve(),
      send: () => false,
      subscribe: () => () => undefined,
      close: () => undefined,
    };
    const transport = applyStudioLiveP2pOverlay(() => localTransport)(contextFor(LOCAL));
    expect(transport).toBe(localTransport);
  });

  it("does not wrap a server transport when WebRTC is unavailable", () => {
    const primary: StudioLiveTransport = {
      mode: "server",
      ready: true,
      connect: () => Promise.resolve(),
      send: () => false,
      subscribe: () => () => undefined,
      close: () => undefined,
    };
    const transport = applyStudioLiveP2pOverlay(() => primary)(contextFor(LOCAL));
    expect(transport).toBe(primary);
  });

  it("classifies only ephemeral collaboration traffic as P2P-eligible", () => {
    expect(isStudioLiveP2pEphemeralKind("cursor:update")).toBe(true);
    expect(isStudioLiveP2pEphemeralKind("presence:heartbeat")).toBe(true);
    expect(isStudioLiveP2pEphemeralKind("chat:message")).toBe(true);
    expect(isStudioLiveP2pEphemeralKind("preview:gesture")).toBe(true);
    expect(isStudioLiveP2pEphemeralKind("presence:hello")).toBe(false);
    expect(isStudioLiveP2pEphemeralKind("lock:claim")).toBe(false);
    expect(isStudioLiveP2pMeshShareId(STUDIO_LIVE_P2P_MESH_SHARE_ID)).toBe(true);
    expect(isStudioLiveP2pMeshShareId("share-1")).toBe(false);
  });

  it("moves cursors and gesture previews onto the data channel", async () => {
    const { localPrimary, local, receivedRemote } = await connectedMesh();
    const cursor = envelope({
      sender: LOCAL,
      kind: "cursor:update",
      payload: { x: 0.2, y: 0.8, pageId: "page-1", tool: "g-pen" },
      sequence: 40,
    });

    expect(local.send(cursor)).toBe(true);
    const preview = envelope({
      sender: LOCAL,
      kind: "preview:gesture",
      payload: gesturePreview(),
      sequence: 41,
    });
    expect(local.send(preview)).toBe(true);
    expect(localPrimary.sent.some((item) => item.kind === "cursor:update")).toBe(false);
    expect(localPrimary.sent.some((item) => item.kind === "preview:gesture")).toBe(false);
    expect(localPrimary.sent.some((item) => item.kind === "webrtc:description")).toBe(true);
    expect(
      receivedRemote.some(
        (item) => item.kind === "cursor:update" && item.payload && "x" in item.payload,
      ),
    ).toBe(true);
    expect(
      receivedRemote.some(
        (item) => item.kind === "preview:gesture"
          && "gestureId" in item.payload
          && item.payload.gestureId === "gesture-p2p-1",
      ),
    ).toBe(true);
    expect(
      receivedRemote.some(
        (item) =>
          item.kind === "webrtc:description" &&
          isStudioLiveP2pMeshShareId(
            (item.payload as { shareId?: string }).shareId ?? "",
          ),
      ),
    ).toBe(false);
  });

  it("uses the signaling participant instead of spoofable data-channel profile fields", async () => {
    const { local, remote } = await connectedMesh();
    const receivedLocal: StudioLiveEnvelope[] = [];
    local.subscribe((value) => receivedLocal.push(value as StudioLiveEnvelope));
    const spoofed = envelope({
      sender: { ...REMOTE, displayName: "위조된 소유자", role: "owner" },
      kind: "preview:gesture",
      payload: gesturePreview("gesture-canonical-sender"),
      sequence: 41,
    });

    expect(remote.send(spoofed)).toBe(true);
    expect(receivedLocal.at(-1)).toEqual({
      ...spoofed,
      sender: REMOTE,
    });
  });

  it("preflights preview byte, buffer, and SCTP limits before mesh fanout", async () => {
    const { hub, localPrimary, local, receivedRemote } = await connectedMesh();
    const atBoundary = envelope({
      sender: LOCAL,
      kind: "preview:gesture",
      payload: gesturePreview("gesture-boundary"),
      sequence: 41,
    });
    const boundaryBytes = studioLiveEnvelopeByteLength(atBoundary)!;
    hub.setMaxMessageSize(boundaryBytes);
    hub.setBufferedAmount(STUDIO_LIVE_P2P_PREVIEW_MAX_BUFFERED_BYTES - boundaryBytes);

    expect(local.send(atBoundary)).toBe(true);
    expect(localPrimary.sent).not.toContainEqual(atBoundary);

    const overSctp = envelope({
      sender: LOCAL,
      kind: "preview:gesture",
      payload: gesturePreview("gesture-over-sctp"),
      sequence: 42,
    });
    hub.setBufferedAmount(0);
    hub.setMaxMessageSize(studioLiveEnvelopeByteLength(overSctp)! - 1);
    expect(local.send(overSctp)).toBe(true);
    expect(localPrimary.sent).toContainEqual(overSctp);

    const unlimitedSctp = envelope({
      sender: LOCAL,
      kind: "preview:gesture",
      payload: gesturePreview("gesture-unlimited-sctp"),
      sequence: 43,
    });
    hub.setMaxMessageSize(Number.POSITIVE_INFINITY);
    expect(local.send(unlimitedSctp)).toBe(true);
    expect(localPrimary.sent).not.toContainEqual(unlimitedSctp);

    const overBuffer = envelope({
      sender: LOCAL,
      kind: "preview:gesture",
      payload: gesturePreview("gesture-over-buffer"),
      sequence: 44,
    });
    const overBufferBytes = studioLiveEnvelopeByteLength(overBuffer)!;
    hub.setMaxMessageSize(0);
    hub.setBufferedAmount(
      STUDIO_LIVE_P2P_PREVIEW_MAX_BUFFERED_BYTES - overBufferBytes + 1,
    );
    expect(local.send(overBuffer)).toBe(true);
    expect(localPrimary.sent).toContainEqual(overBuffer);
    expect(
      receivedRemote.filter((item) => item.kind === "preview:gesture"),
    ).toEqual(expect.arrayContaining([atBoundary, overSctp, unlimitedSctp, overBuffer]));
  });

  it("rejects a preview above the protocol envelope cap without attempting primary", async () => {
    const { localPrimary, local } = await connectedMesh();
    const valid = envelope({
      sender: LOCAL,
      kind: "preview:gesture",
      payload: gesturePreview("gesture-invalid-oversize"),
      sequence: 45,
    });
    const oversized = {
      ...valid,
      payload: {
        ...valid.payload,
        extension: "x".repeat(STUDIO_LIVE_GESTURE_PREVIEW_ENVELOPE_MAX_BYTES),
      },
    } as unknown as StudioLiveEnvelope;
    expect(studioLiveEnvelopeByteLength(oversized)).toBeGreaterThan(
      STUDIO_LIVE_GESTURE_PREVIEW_ENVELOPE_MAX_BYTES,
    );
    const primarySendCount = localPrimary.sent.length;

    expect(local.send(oversized)).toBe(false);
    expect(localPrimary.sent).toHaveLength(primarySendCount);
  });

  it("falls back to the server while the mesh is incomplete", async () => {
    const bus = new SignalingBus();
    const primary = bus.create(LOCAL);
    const transport = applyStudioLiveP2pOverlay(() => primary, {
      createPeerConnection: () => {
        throw new Error("rtc disabled");
      },
      now: () => NOW,
    })(contextFor(LOCAL));
    await transport.connect();
    primary.emit(
      envelope({
        sender: REMOTE,
        kind: "presence:heartbeat",
        payload: { visibility: "active", pageId: null, tool: null },
      }),
    );
    const cursor = envelope({
      sender: LOCAL,
      kind: "cursor:update",
      payload: { x: 0.1, y: 0.2, pageId: null, tool: null },
      sequence: 3,
    });
    expect(transport.send(cursor)).toBe(true);
    expect(primary.sent).toContainEqual(cursor);
    const preview = envelope({
      sender: LOCAL,
      kind: "preview:gesture",
      payload: gesturePreview(),
      sequence: 4,
    });
    expect(transport.send(preview)).toBe(true);
    expect(primary.sent).toContainEqual(preview);
  });

  it("fails closed when an incomplete mesh has no authoritative preview primary", async () => {
    const bus = new SignalingBus();
    const primary = bus.create(LOCAL, "mesh");
    const transport = applyStudioLiveP2pOverlay(() => primary, {
      createPeerConnection: () => {
        throw new Error("rtc disabled");
      },
      now: () => NOW,
    })(contextFor(LOCAL));
    await transport.connect();
    primary.emit(envelope({
      sender: REMOTE,
      kind: "presence:heartbeat",
      payload: { visibility: "active", pageId: "page-1", tool: "pen" },
    }));
    const preview = envelope({
      sender: LOCAL,
      kind: "preview:gesture",
      payload: gesturePreview("gesture-no-primary"),
      sequence: 4,
    });

    expect(transport.send(preview)).toBe(false);
    expect(primary.sent).not.toContainEqual(preview);
  });

  it("uses only primary when one observed peer is missing from an otherwise open mesh", async () => {
    const { localPrimary, local, receivedRemote } = await connectedMesh();
    localPrimary.emit(envelope({
      sender: THIRD,
      kind: "presence:heartbeat",
      payload: { visibility: "active", pageId: "page-1", tool: "pen" },
      sequence: 3,
    }));
    await flush();
    const preview = envelope({
      sender: LOCAL,
      kind: "preview:gesture",
      payload: gesturePreview(),
      sequence: 42,
    });

    expect(local.send(preview)).toBe(true);
    expect(localPrimary.sent).toContainEqual(preview);
    expect(
      receivedRemote.filter((item) => item.kind === "preview:gesture"),
    ).toEqual([preview]);
  });

  it("falls back authoritatively when a channel closes after multi-peer preflight", async () => {
    const {
      hub,
      localPrimary,
      local,
      receivedRemote,
      receivedThird,
    } = await connectedThreePeerMesh();
    hub.failOnNthSend(2);
    const preview = envelope({
      sender: LOCAL,
      kind: "preview:gesture",
      payload: gesturePreview("gesture-send-race"),
      sequence: 46,
    });

    expect(local.send(preview)).toBe(true);
    expect(hub.didSimulateSendFailure).toBe(true);
    expect(localPrimary.sent).toContainEqual(preview);
    expect(receivedRemote.some((item) => item.kind === "preview:gesture")).toBe(true);
    expect(receivedThird.some((item) => item.kind === "preview:gesture")).toBe(true);
  });

  it("carries jam CRDT updates on the mesh when the primary has no Socket.IO authority", async () => {
    const hub = new MemoryRtcHub();
    const bus = new SignalingBus();
    const stripCrdt = (primary: FakePrimaryTransport): StudioLiveTransport => ({
      mode: primary.mode,
      crdtFanout: "none",
      get ready() {
        return primary.ready;
      },
      connect: () => primary.connect(),
      send: (envelope) => primary.send(envelope),
      subscribe: (listener) => primary.subscribe(listener),
      subscribeControl: (listener) => primary.subscribeControl(listener),
      close: () => primary.close(),
    });
    const localPrimary = bus.create(LOCAL);
    const remotePrimary = bus.create(REMOTE);
    const local = applyStudioLiveP2pOverlay(() => stripCrdt(localPrimary), {
      createPeerConnection: () => hub.create(),
      now: () => NOW,
    })(contextFor(LOCAL));
    const remote = applyStudioLiveP2pOverlay(() => stripCrdt(remotePrimary), {
      createPeerConnection: () => hub.create(),
      now: () => NOW,
    })(contextFor(REMOTE));
    const received: StudioCrdtTransportMessage[] = [];
    remote.subscribeCrdt?.((message) => received.push(message));
    await local.connect();
    await remote.connect();
    localPrimary.emit(
      envelope({
        sender: REMOTE,
        kind: "presence:heartbeat",
        payload: { visibility: "active", pageId: "page-1", tool: "pen" },
      }),
    );
    remotePrimary.emit(
      envelope({
        sender: LOCAL,
        kind: "presence:heartbeat",
        payload: { visibility: "active", pageId: "page-1", tool: "pen" },
        sequence: 2,
      }),
    );
    await flush();
    const ack = await local.publishCrdtUpdate?.({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-p2p",
      updateId: "00000000-0000-4000-8000-000000000042",
      clientSequence: 1,
      update: "AAAA",
    });
    expect(ack?.duplicate).toBe(false);
    expect(localPrimary.publishCrdtUpdate).not.toHaveBeenCalled();
    expect(received.some((message) =>
      message.type === "update" && message.update.updateId === "00000000-0000-4000-8000-000000000042"
    )).toBe(true);
  });

  it("keeps lock claims on the server and still publishes CRDT on the primary when the mesh is up", async () => {
    const { localPrimary, local } = await connectedMesh();
    await local.acquireLock?.({
      resource: "page:1",
      requestId: "00000000-0000-4000-8000-000000000031",
      leaseMs: 1_000,
    });
    await local.publishCrdtUpdate?.({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-p2p",
      updateId: "00000000-0000-4000-8000-000000000032",
      clientSequence: 1,
      update: "AAAA",
    });
    expect(localPrimary.acquireLock).toHaveBeenCalledOnce();
    expect(localPrimary.publishCrdtUpdate).toHaveBeenCalledOnce();
  });

  it("keeps same-origin jam CRDT on BroadcastChannel even after a P2P channel opens", async () => {
    const workId = `work-p2p-bc-${crypto.randomUUID()}`;
    const factory = applyStudioLiveP2pOverlay(
      createStudioLiveSignalingServerTransportFactory,
      {
        createPeerConnection: () => {
          throw new Error("rtc unused");
        },
        now: () => NOW,
      },
    );
    const local = factory({ workId, roomName: workId, participant: LOCAL });
    const remote = factory({ workId, roomName: workId, participant: REMOTE });
    const received: string[] = [];
    remote.subscribeCrdt?.((message) => {
      if (message.type === "update") received.push(message.update.updateId);
    });
    await local.connect();
    await remote.connect();
    const updateId = "00000000-0000-4000-8000-000000000036";
    await local.publishCrdtUpdate?.({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId,
      updateId,
      clientSequence: 1,
      update: "AAAA",
    });
    await vi.waitFor(() => expect(received).toContain(updateId));
    local.close();
    remote.close();
  });

  it("still delivers same-origin CRDT on BroadcastChannel after the mesh claims an open channel", async () => {
    const workId = `work-p2p-bc-open-${crypto.randomUUID()}`;
    const hub = new MemoryRtcHub();
    const factory = applyStudioLiveP2pOverlay(
      createStudioLiveSignalingServerTransportFactory,
      {
        createPeerConnection: () => hub.create(),
        now: () => NOW,
      },
    );
    const context = (participant: StudioLiveParticipant): StudioLiveTransportContext => ({
      workId,
      roomName: workId,
      participant,
    });
    const local = factory(context(LOCAL));
    const remote = factory(context(REMOTE));
    const received: string[] = [];
    remote.subscribeCrdt?.((message) => {
      if (message.type === "update") received.push(message.update.updateId);
    });
    await local.connect();
    await remote.connect();
    local.send(envelope({
      sender: LOCAL,
      kind: "presence:heartbeat",
      payload: { visibility: "active", pageId: "page-1", tool: "pen" },
    }));
    remote.send(envelope({
      sender: REMOTE,
      kind: "presence:heartbeat",
      payload: { visibility: "active", pageId: "page-1", tool: "pen" },
      sequence: 2,
    }));
    await flush();
    const updateId = "00000000-0000-4000-8000-000000000037";
    await local.publishCrdtUpdate?.({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId,
      updateId,
      clientSequence: 1,
      update: "AAAA",
    });
    await vi.waitFor(() => expect(received).toContain(updateId));
    local.close();
    remote.close();
  });

  it("falls back to the server CRDT host when no peer data channel is open", async () => {
    const bus = new SignalingBus();
    const hub = new MemoryRtcHub();
    const primary = bus.create(LOCAL);
    const transport = applyStudioLiveP2pOverlay(() => primary, {
      createPeerConnection: () => hub.create(),
      now: () => NOW,
    })(contextFor(LOCAL));
    await transport.connect();
    await transport.publishCrdtUpdate?.({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-p2p",
      updateId: "00000000-0000-4000-8000-000000000034",
      clientSequence: 1,
      update: "AAAA",
    });
    expect(primary.publishCrdtUpdate).toHaveBeenCalledOnce();
  });

  it("still uses the server for lock claims after the mesh is up", async () => {
    const { localPrimary, local } = await connectedMesh();
    const claim = envelope({
      sender: LOCAL,
      kind: "lock:claim",
      payload: {
        resource: "page:1",
        claimId: "claim-1",
        leaseUntil: NOW + 10_000,
      },
      sequence: 90,
    });
    expect(local.send(claim)).toBe(true);
    expect(localPrimary.sent.some((item) => item.kind === "lock:claim")).toBe(true);
  });
});

function inkPayload(count: number, base = 0): ArrayBuffer {
  return encodeStudioLiveInkSamples(
    Array.from({ length: count }, (_, index) => ({
      x: base + index,
      y: base + index * 2,
      pressure: 0.5,
    })),
  );
}

function inkBeginWire(
  sender: StudioLiveParticipant,
  strokeId = "stroke-1",
): StudioLiveInkWireMessage {
  return createStudioLiveInkWireMessage({
    workId: "work-p2p",
    senderSessionId: sender.sessionId,
    sentAt: NOW,
    message: {
      kind: "ink:begin",
      protocolVersion: STUDIO_LIVE_INK_PROTOCOL_VERSION,
      strokeId,
      pageId: "page-1",
      layerId: "layer-1",
      coordinateSpaceId: "space-1",
      coordinateSpaceRevision: 0,
      provider: {
        providerId: "vello-hybrid",
        providerVersion: "1.4.0",
        buildHash: "9f2c11ab",
      },
      brushPresetId: "brush-gpen",
      brushContractHash: "c0ffee42",
      seed: 7,
      mode: "pen",
      blendMode: "normal",
      color: "#112233",
      width: 8,
      opacity: 1,
      sampleSchema: STUDIO_LIVE_INK_SAMPLE_SCHEMA,
      startedAt: NOW,
    },
  });
}

function inkChunkWire(
  sender: StudioLiveParticipant,
  strokeId: string,
  chunkSequence: number,
  firstSampleIndex: number,
  sampleCount = 2,
): StudioLiveInkWireMessage {
  return createStudioLiveInkWireMessage({
    workId: "work-p2p",
    senderSessionId: sender.sessionId,
    sentAt: NOW,
    message: {
      kind: "ink:chunk",
      strokeId,
      chunkSequence,
      firstSampleIndex,
      sampleCount,
      payload: inkPayload(sampleCount, firstSampleIndex),
    },
  });
}

function inkPredictionWire(
  sender: StudioLiveParticipant,
  strokeId: string,
  predictionSequence: number,
): StudioLiveInkWireMessage {
  return createStudioLiveInkWireMessage({
    workId: "work-p2p",
    senderSessionId: sender.sessionId,
    sentAt: NOW,
    message: {
      kind: "ink:prediction",
      strokeId,
      predictionSequence,
      replacesFromSampleIndex: 0,
      expiresAt: NOW + 500,
      sampleCount: 2,
      payload: inkPayload(2),
    },
  });
}

function inkEndWire(
  sender: StudioLiveParticipant,
  strokeId: string,
  lastChunkSequence: number,
  totalActualSamples: number,
): StudioLiveInkWireMessage {
  return createStudioLiveInkWireMessage({
    workId: "work-p2p",
    senderSessionId: sender.sessionId,
    sentAt: NOW,
    message: {
      kind: "ink:end",
      strokeId,
      lastChunkSequence,
      totalActualSamples,
      sampleHash: hashStudioLiveInkPayloads([inkPayload(totalActualSamples)]),
      crdtStrokeId: `crdt-${strokeId}`,
    },
  });
}

function collectInk(transport: StudioLiveTransport): unknown[] {
  const received: unknown[] = [];
  transport.subscribeInk?.((value) => received.push(value));
  return received;
}

function inkKind(value: unknown): unknown {
  return ((value as { message?: { kind?: unknown } }).message ?? {}).kind;
}

describe("Studio live P2P overlay binary ink lane (V18)", () => {
  it("advertises exactly the primary's negotiated lanes and fails closed without them", async () => {
    const { localPrimary, local } = await connectedMesh();
    expect(local.binaryLaneCapabilities).toContain(STUDIO_LIVE_INK_CAPABILITY);

    localPrimary.binaryLaneCapabilities = [];
    expect(local.binaryLaneCapabilities).toEqual([]);
    expect(local.sendInk?.(inkChunkWire(LOCAL, "stroke-closed", 1, 0))).toBe(false);
    expect(localPrimary.sentInk).toEqual([]);
  });

  it("keeps every actual frame on the reliable primary lane even with an open mesh", async () => {
    const { localPrimary, local, remote } = await connectedMesh();
    const receivedInk = collectInk(remote);
    const begin = inkBeginWire(LOCAL);
    const chunk = inkChunkWire(LOCAL, "stroke-1", 1, 0);
    const end = inkEndWire(LOCAL, "stroke-1", 1, 2);

    expect(local.sendInk?.(begin)).toBe(true);
    expect(local.sendInk?.(chunk)).toBe(true);
    expect(local.sendInk?.(end)).toBe(true);

    // The reliable authority path carried all three actual frames…
    expect(localPrimary.sentInk).toEqual([begin, chunk, end]);
    // …and the remote saw each exactly once (no lossy mesh duplication of actuals).
    expect(receivedInk).toEqual([begin, chunk, end]);
  });

  it("hops droppable predictions over the mesh to peers that announced ink-v2", async () => {
    const { localPrimary, local, remote } = await connectedMesh();
    const receivedInk = collectInk(remote);
    const begin = inkBeginWire(LOCAL);
    const prediction = inkPredictionWire(LOCAL, "stroke-1", 1);

    expect(local.sendInk?.(begin)).toBe(true);
    expect(local.sendInk?.(prediction)).toBe(true);

    // The prediction never touched the primary relay.
    expect(localPrimary.sentInk.map((wire) => wire.message.kind)).toEqual(["ink:begin"]);
    expect(receivedInk.map(inkKind)).toEqual(["ink:begin", "ink:prediction"]);
    const meshPrediction = receivedInk[1] as {
      senderSessionId: string;
      message: { payload: ArrayBuffer };
    };
    expect(meshPrediction.senderSessionId).toBe(LOCAL.sessionId);
    // The binary sample block round-trips byte-exact through the {header JSON, payload} frame.
    expect([...new Uint8Array(meshPrediction.message.payload)]).toEqual([
      ...new Uint8Array((prediction.message as { payload: ArrayBuffer }).payload),
    ]);
  });

  it("falls back predictions to the reliable lane when a peer never announced ink-v2", async () => {
    const { localPrimary, local } = await connectedMesh({ remoteBinaryLanes: [] });
    const begin = inkBeginWire(LOCAL);
    const prediction = inkPredictionWire(LOCAL, "stroke-1", 1);

    expect(local.sendInk?.(begin)).toBe(true);
    expect(local.sendInk?.(prediction)).toBe(true);
    expect(localPrimary.sentInk.map((wire) => wire.message.kind)).toEqual([
      "ink:begin",
      "ink:prediction",
    ]);
  });

  it("drops mesh frames that spoof another session's identity", async () => {
    const { local, remote, remotePrimary } = await connectedMesh();
    const receivedInk = collectInk(local);
    const spoofed = inkPredictionWire(THIRD, "stroke-spoof", 1);

    // The frame rides the mesh (remote knows local's lanes), so the per-link identity gate runs.
    expect(remote.sendInk?.(spoofed)).toBe(true);
    expect(remotePrimary.sentInk).toEqual([]);
    expect(receivedInk).toEqual([]);
  });

  it("enforces the per-peer inbound packet budget on the mesh lane", async () => {
    const { local, remote } = await connectedMesh();
    const receivedInk = collectInk(local);

    for (
      let sequence = 1;
      sequence <= STUDIO_LIVE_P2P_INK_INBOUND_MAX_PACKETS + 20;
      sequence += 1
    ) {
      expect(remote.sendInk?.(inkPredictionWire(REMOTE, "stroke-budget", sequence))).toBe(true);
    }
    expect(receivedInk).toHaveLength(STUDIO_LIVE_P2P_INK_INBOUND_MAX_PACKETS);
  });
});
