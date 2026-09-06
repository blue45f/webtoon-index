import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioCrdtDocument } from "./studio-crdt-document";
import {
  STUDIO_CRDT_PROTOCOL_VERSION,
  decodeStudioCrdtStateVector,
  decodeStudioCrdtUpdate,
  encodeStudioCrdtStateVector,
  encodeStudioCrdtSyncChunks,
  encodeStudioCrdtUpdate,
  type StudioCrdtRemoteUpdate,
  type StudioCrdtSyncRequest,
  type StudioCrdtSyncResponse,
  type StudioCrdtTransportMessage,
  type StudioCrdtUpdateAck,
  type StudioCrdtUpdateRequest,
} from "./studio-crdt-protocol";
import {
  StudioCrdtRoomBinding,
  type StudioCrdtBindingStatus,
  type StudioCrdtRoomBindingOptions,
} from "./studio-crdt-room-binding";
import {
  createStudioLiveEnvelope,
  type StudioLiveEnvelope,
  type StudioLiveParticipant,
} from "./studio-live-collaboration-protocol";
import { encodeStudioLiveInkSamples } from "./studio-live-ink-codec";
import {
  createStudioLiveInkWireMessage,
  STUDIO_LIVE_INK_CAPABILITY,
  STUDIO_LIVE_INK_PROTOCOL_VERSION,
  STUDIO_LIVE_INK_SAMPLE_SCHEMA,
  type StudioLiveInkWireMessage,
} from "./studio-live-ink-protocol";
import {
  applyStudioLiveP2pOverlay,
  STUDIO_LIVE_P2P_CHANNEL_LABEL,
  STUDIO_LIVE_P2P_INK_MAX_BUFFERED_BYTES,
  type StudioLiveP2pRtcDataChannel,
  type StudioLiveP2pRtcPeerConnection,
} from "./studio-live-p2p-overlay-transport";

import type { StudioCrdtOutbox } from "./studio-crdt-outbox";
import type { StudioCrdtRecoveryVault } from "./studio-crdt-recovery-vault";
import type {
  StudioLiveCrdtRoomEvent,
  StudioLiveRoom,
  StudioLiveRoomEvent,
} from "./studio-live-collaboration-room";
import type {
  StudioLiveTransport,
  StudioLiveTransportControlEvent,
} from "./studio-live-collaboration-transport";

const NOW = Date.parse("2026-08-15T04:00:00.000Z");
const WORK_ID = "work-p2p";
const LOCAL: StudioLiveParticipant = {
  sessionId: "00000000-0000-4000-8000-000000000001", displayName: "작가", role: "owner",
};
const REMOTE: StudioLiveParticipant = {
  sessionId: "00000000-0000-4000-8000-000000000002", displayName: "어시스턴트", role: "editor",
};
const THIRD: StudioLiveParticipant = {
  sessionId: "00000000-0000-4000-8000-000000000003", displayName: "채색", role: "editor",
};
const documents: StudioCrdtDocument[] = [];
const bindings: StudioCrdtRoomBinding[] = [];
const transports: StudioLiveTransport[] = [];

afterEach(() => {
  for (const binding of bindings.splice(0)) binding.close();
  for (const transport of transports.splice(0)) transport.close();
  for (const document of documents.splice(0)) document.destroy();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function document(): StudioCrdtDocument {
  const value = new StudioCrdtDocument();
  documents.push(value);
  return value;
}

function stroke(target: StudioCrdtDocument, id: string, x = 10): void {
  target.addStroke({
    id, pageId: "page-1", layerId: "layer-1",
    payload: {
      version: 1, type: "draw", kind: "freehand", mode: "pen",
      points: [x, x, x + 1, x + 1], pressures: [0.4, 0.8],
      stroke: "#123456", strokeWidth: 6,
    },
  });
}

/** This suite never creates terminal failures; accessing a recovery write is itself a failure. */
const emptyRecoveryVault: StudioCrdtRecoveryVault = {
  list: async () => [],
  listRejectionMarkers: async () => [],
  preserve: async () => { throw new Error("unexpected recovery write"); },
  preserveRejectionMarker: async () => { throw new Error("unexpected rejection marker"); },
  markExported: async () => { throw new Error("unexpected recovery export"); },
};

class DurableOutbox implements StudioCrdtOutbox {
  readonly requests = new Map<string, StudioCrdtUpdateRequest>();
  getStatus() { return { state: "durable" as const, message: "durable test outbox" }; }
  async list(scope: string, workId: string): Promise<StudioCrdtUpdateRequest[]> {
    return [...this.requests.entries()]
      .filter(([key, request]) => key.startsWith(`${scope}:`) && request.workId === workId)
      .map(([, request]) => ({ ...request }));
  }
  async put(scope: string, request: StudioCrdtUpdateRequest): Promise<void> {
    this.requests.set(`${scope}:${request.updateId}`, { ...request });
  }
  async remove(scope: string, _workId: string, updateId: string): Promise<void> {
    this.requests.delete(`${scope}:${updateId}`);
  }
}

class DocumentRoom {
  readonly mode = "server" as const;
  readonly workId = WORK_ID;
  readonly participant = LOCAL;
  ready = true;
  sequence = 17;
  syncRequests = 0;
  nextSyncBarrier: Promise<void> | null = null;
  readonly publications: StudioCrdtUpdateRequest[] = [];
  readonly crdtListeners = new Set<(event: StudioLiveCrdtRoomEvent) => void>();
  readonly roomListeners = new Set<(event: StudioLiveRoomEvent) => void>();

  constructor(
    readonly peer: StudioCrdtDocument,
    readonly crdtFanout: "mesh" | "authoritative" = "mesh",
  ) {}

  subscribeCrdt(listener: (event: StudioLiveCrdtRoomEvent) => void): () => void {
    this.crdtListeners.add(listener);
    return () => this.crdtListeners.delete(listener);
  }
  subscribe(listener: (event: StudioLiveRoomEvent) => void): () => void {
    this.roomListeners.add(listener);
    return () => this.roomListeners.delete(listener);
  }
  async requestCrdtSync(request: StudioCrdtSyncRequest): Promise<StudioCrdtSyncResponse> {
    this.syncRequests += 1;
    const diff = this.peer.encodeStateAsUpdate(decodeStudioCrdtStateVector(request.stateVector));
    const chunks = encodeStudioCrdtSyncChunks(diff);
    // Capture before the barrier: a channel opening later cannot repair an older snapshot.
    const response: StudioCrdtSyncResponse = {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION, workId: WORK_ID,
      requestId: request.requestId, transferId: "11111111-1111-4111-8111-111111111111",
      chunks, chunkCount: chunks.length, totalBytes: diff.byteLength,
      serverStateVector: encodeStudioCrdtStateVector(this.peer.encodeStateVector()),
      serverSequence: String(this.sequence),
    };
    const barrier = this.nextSyncBarrier;
    this.nextSyncBarrier = null;
    if (barrier) await barrier;
    return response;
  }
  async publishCrdtUpdate(request: StudioCrdtUpdateRequest): Promise<StudioCrdtUpdateAck> {
    this.publications.push(request);
    this.peer.applyUpdate(decodeStudioCrdtUpdate(request.update));
    this.sequence += 1;
    return {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION, workId: WORK_ID,
      updateId: request.updateId, serverSequence: String(this.sequence),
      serverStateVector: encodeStudioCrdtStateVector(this.peer.encodeStateVector()), duplicate: false,
    };
  }
  respondCrdtSync(): boolean { return true; }
  remote(update: StudioCrdtRemoteUpdate): void {
    for (const listener of this.crdtListeners) {
      listener({ type: "update", update, senderSessionId: REMOTE.sessionId });
    }
  }
  connected(): void {
    for (const listener of this.roomListeners) {
      listener({ type: "transport-status", status: {
        state: "ready", message: "peer data channel ready", recoverable: true,
      } });
    }
  }
}

function bind(room: DocumentRoom, client: StudioCrdtDocument, options: Partial<StudioCrdtRoomBindingOptions> = {}) {
  const value = new StudioCrdtRoomBinding({
    document: client, room: room as unknown as StudioLiveRoom,
    recoveryVault: emptyRecoveryVault, ...options,
  });
  bindings.push(value);
  return value;
}

function remoteUpdate(target: DocumentRoom, peer: StudioCrdtDocument, id: number, sequence: string): void {
  target.remote({
    protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION, workId: WORK_ID,
    updateId: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    serverSequence: sequence, update: encodeStudioCrdtUpdate(peer.encodeStateAsUpdate()),
  });
}

describe("mesh document synchronization regressions", () => {
  it("applies each zero-sequence peer stroke immediately after a nonzero peer snapshot", async () => {
    const peer = document();
    const client = document();
    stroke(peer, "initial");
    const room = new DocumentRoom(peer);
    await bind(room, client, { canEdit: false }).start();
    expect(client.getStroke("initial")).not.toBeNull();
    for (const id of [2, 3]) {
      stroke(peer, `live-${id}`, id);
      remoteUpdate(room, peer, id, "0");
      // Synchronous, with no reload, timer, or background snapshot to hide a dropped update.
      expect(client.getStroke(`live-${id}`)).not.toBeNull();
    }
    expect(room.syncRequests).toBe(1);
  });

  it("does not compare independent peers' counters as a global ordering fence", async () => {
    const first = document();
    const second = document();
    const client = document();
    const room = new DocumentRoom(first);
    room.sequence = 400;
    await bind(room, client, { canEdit: false }).start();
    stroke(second, "second-peer-first-edit");
    remoteUpdate(room, second, 24, "1");
    expect(client.getStroke("second-peer-first-edit")).not.toBeNull();
    expect(room.syncRequests).toBe(1);
  });

  it("keeps stale-update protection on the real authoritative server path", async () => {
    const server = document();
    const stale = document();
    const client = document();
    const room = new DocumentRoom(server, "authoritative");
    await bind(room, client, { canEdit: false }).start();
    stroke(stale, "stale-replay");
    remoteUpdate(room, stale, 45, "0");
    expect(client.getStroke("stale-replay")).toBeNull();
  });

  it("retains the durable outbox and never records a mesh receipt as a server ACK", async () => {
    const peer = document();
    const client = document();
    const room = new DocumentRoom(peer);
    const outbox = new DurableOutbox();
    const statuses: StudioCrdtBindingStatus[] = [];
    const binding = bind(room, client, { outbox, outboxScope: "mesh-user", onStatus: (s) => statuses.push(s) });
    await binding.start();
    stroke(client, "recoverable-peer-edit");
    binding.flush();
    await vi.waitFor(() => expect(room.publications).toHaveLength(1));
    await binding.syncNow();
    expect(peer.getStroke("recoverable-peer-edit")).not.toBeNull();
    expect(outbox.requests.size).toBe(1);
    expect(statuses.at(-1)?.pendingCount).toBe(1);
    expect(statuses.every((s) => s.lastAckAt === null && s.lastAckServerSequence === null)).toBe(true);
    binding.flush();
    await Promise.resolve();
    expect(room.publications).toHaveLength(1);
  });

  it("never treats a peer snapshot as an authoritative REST save fence", async () => {
    const binding = bind(new DocumentRoom(document()), document());
    await binding.start();
    await expect(binding.flushAndWaitForAuthoritativeAck()).rejects.toThrow("서버 승인");
  });

  it("restarts sync after a peer opens during an in-flight snapshot", async () => {
    vi.useFakeTimers();
    const peer = document();
    const client = document();
    const room = new DocumentRoom(peer);
    let release!: () => void;
    room.nextSyncBarrier = new Promise<void>((resolve) => { release = resolve; });
    const binding = bind(room, client, { canEdit: false });
    const started = binding.start();
    expect(room.syncRequests).toBe(1);
    stroke(peer, "late-peer-edit");
    room.connected();
    release();
    await started;
    expect(client.getStroke("late-peer-edit")).toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    expect(room.syncRequests).toBe(2);
    expect(client.getStroke("late-peer-edit")).not.toBeNull();
  });

  it("replays an earlier local receipt when a new peer becomes reachable", async () => {
    const peer = document();
    const client = document();
    const room = new DocumentRoom(peer);
    const binding = bind(room, client);
    await binding.start();
    stroke(client, "earlier-local-only-edit");
    binding.flush();
    await vi.waitFor(() => expect(room.publications).toHaveLength(1));
    await binding.syncNow();
    room.connected();
    await vi.waitFor(() => expect(room.publications).toHaveLength(2));
    expect(room.publications[1]?.updateId).toBe(room.publications[0]?.updateId);
  });
});

/** In-memory RTC seam; real Yjs/protocol/binding logic remains in the tests above. */
class Channel implements StudioLiveP2pRtcDataChannel {
  readyState = "connecting";
  bufferedAmount = 0;
  ordered = true;
  maxRetransmits: number | null = null;
  maxPacketLifeTime: number | null = null;
  binaryType?: string;
  peer: Channel | null = null;
  onopen: StudioLiveP2pRtcDataChannel["onopen"] = null;
  onclose: StudioLiveP2pRtcDataChannel["onclose"] = null;
  onmessage: StudioLiveP2pRtcDataChannel["onmessage"] = null;
  constructor(readonly label: string, private readonly beforeSend: () => void) {}
  send(data: string | ArrayBuffer): void {
    if (this.readyState !== "open" || this.peer?.readyState !== "open") throw new Error("channel closed");
    this.beforeSend();
    this.peer.onmessage?.({ data: data instanceof ArrayBuffer ? data.slice(0) : data } as MessageEvent<unknown>);
  }
  close(): void {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.onclose?.(new Event("close"));
    const peer = this.peer;
    this.peer = null;
    peer?.close();
  }
  open(): void {
    if (this.readyState === "open") return;
    this.readyState = "open";
    this.onopen?.(new Event("open"));
  }
}

class Connection implements StudioLiveP2pRtcPeerConnection {
  connectionState = "new";
  readonly sctp = { maxMessageSize: 0 };
  onicecandidate: StudioLiveP2pRtcPeerConnection["onicecandidate"] = null;
  ondatachannel: StudioLiveP2pRtcPeerConnection["ondatachannel"] = null;
  onconnectionstatechange: (() => void) | null = null;
  local: RTCSessionDescriptionInit | null = null;
  remote: RTCSessionDescriptionInit | null = null;
  channel: Channel | null = null;
  constructor(readonly hub: RtcHub, readonly id: number) {}
  createDataChannel(label: string): Channel { return this.channel = this.hub.channel(label); }
  async createOffer(): Promise<RTCSessionDescriptionInit> { return { type: "offer", sdp: `offer-${this.id}` }; }
  async createAnswer(): Promise<RTCSessionDescriptionInit> { return { type: "answer", sdp: `answer-${this.id}` }; }
  async setLocalDescription(value: RTCSessionDescriptionInit): Promise<void> {
    this.local = value;
    this.hub.link(this);
  }
  async setRemoteDescription(value: RTCSessionDescriptionInit): Promise<void> {
    this.remote = value;
    this.hub.link(this);
  }
  async addIceCandidate(): Promise<void> { return; }
  close(): void {
    if (this.connectionState === "closed") return;
    this.connectionState = "closed";
    this.channel?.close();
    this.onconnectionstatechange?.();
  }
}

class RtcHub {
  readonly connections: Connection[] = [];
  readonly channels: Channel[] = [];
  failNextSend = false;
  constructor(readonly ordered = true, readonly maxRetransmits: number | null = null) {}
  create(): Connection {
    const value = new Connection(this, this.connections.length + 1);
    this.connections.push(value);
    return value;
  }
  channel(label: string): Channel {
    const value = new Channel(label, () => {
      if (!this.failNextSend) return;
      this.failNextSend = false;
      throw new Error("injected RTC send failure");
    });
    value.ordered = this.ordered;
    value.maxRetransmits = this.maxRetransmits;
    this.channels.push(value);
    return value;
  }
  link(connection: Connection): void {
    if (!connection.local || !connection.remote || connection.connectionState === "connected") return;
    const other = this.connections.find((value) => value !== connection && value.local && value.remote
      && value.local.sdp === connection.remote?.sdp && value.remote.sdp === connection.local?.sdp);
    if (!other) return;
    const offered = connection.channel ?? other.channel;
    if (!offered) throw new Error("missing offered channel");
    const answer = this.channel(STUDIO_LIVE_P2P_CHANNEL_LABEL);
    offered.peer = answer;
    answer.peer = offered;
    (connection.channel ? other : connection).ondatachannel?.({ channel: answer });
    connection.connectionState = "connected";
    other.connectionState = "connected";
    offered.open();
    answer.open();
  }
}

class SignalingBus {
  readonly primaries = new Map<string, Primary>();
  create(participant: StudioLiveParticipant, fanout: "mesh" | "authoritative"): Primary {
    const value = new Primary(this, participant.sessionId, fanout);
    this.primaries.set(participant.sessionId, value);
    return value;
  }
  deliver(sender: string, envelope: StudioLiveEnvelope): void {
    for (const [id, value] of this.primaries) {
      if (id === sender || (envelope.targetSessionId && envelope.targetSessionId !== id)) continue;
      value.emit(envelope);
    }
  }
}

class Primary implements StudioLiveTransport {
  readonly mode = "server" as const;
  ready = false;
  readonly binaryLaneCapabilities: readonly string[] = [];
  readonly sentInk: StudioLiveInkWireMessage[] = [];
  readonly listeners = new Set<(value: unknown) => void>();
  readonly publishCrdtUpdate = vi.fn(async (request: StudioCrdtUpdateRequest): Promise<StudioCrdtUpdateAck> => ({
    protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION, workId: WORK_ID,
    updateId: request.updateId, duplicate: false, serverSequence: "0", serverStateVector: null,
  }));
  readonly requestCrdtSync = vi.fn(async (_request: StudioCrdtSyncRequest): Promise<StudioCrdtSyncResponse | null> => null);
  constructor(readonly bus: SignalingBus, readonly id: string, readonly crdtFanout: "mesh" | "authoritative") {}
  async connect(): Promise<void> { this.ready = true; }
  send(envelope: StudioLiveEnvelope): boolean {
    if (!this.ready) return false;
    this.bus.deliver(this.id, envelope);
    return true;
  }
  sendInk(wire: StudioLiveInkWireMessage): boolean { this.sentInk.push(wire); return false; }
  subscribe(listener: (value: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  subscribeControl(): () => void { return () => undefined; }
  subscribeCrdt(): () => void { return () => undefined; }
  emit(value: unknown): void { for (const listener of this.listeners) listener(value); }
  close(): void { this.ready = false; this.listeners.clear(); }
}

function presence(sender: StudioLiveParticipant): StudioLiveEnvelope {
  return createStudioLiveEnvelope({
    workId: WORK_ID, sender, sentAt: NOW, sequence: 1, kind: "presence:heartbeat",
    payload: { visibility: "active", pageId: "page-1", tool: "pen" },
  });
}

async function microtasks(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

async function pair(options: { ordered?: boolean; maxRetransmits?: number | null; fanout?: "mesh" | "authoritative" } = {}) {
  const hub = new RtcHub(options.ordered ?? true, options.maxRetransmits ?? null);
  const bus = new SignalingBus();
  const fanout = options.fanout ?? "mesh";
  const make = (participant: StudioLiveParticipant) => {
    const primary = bus.create(participant, fanout);
    const transport = applyStudioLiveP2pOverlay(() => primary, {
      createPeerConnection: () => hub.create(), now: () => NOW,
    })({ workId: WORK_ID, roomName: "room-p2p", participant });
    transports.push(transport);
    return { primary, transport };
  };
  const a = make(LOCAL);
  const b = make(REMOTE);
  const controls: StudioLiveTransportControlEvent[] = [];
  a.transport.subscribeControl?.((event) => controls.push(event));
  expect(a.transport.binaryLaneCapabilities ?? []).not.toContain(STUDIO_LIVE_INK_CAPABILITY);
  await a.transport.connect();
  await b.transport.connect();
  a.primary.emit(presence(REMOTE));
  b.primary.emit(presence(LOCAL));
  await microtasks();
  return { hub, bus, a, b, controls, make };
}

function inkBegin(): StudioLiveInkWireMessage {
  return createStudioLiveInkWireMessage({
    workId: WORK_ID, senderSessionId: LOCAL.sessionId, sentAt: NOW,
    message: {
      kind: "ink:begin", protocolVersion: STUDIO_LIVE_INK_PROTOCOL_VERSION,
      strokeId: "peer-ink", pageId: "page-1", layerId: "layer-1",
      coordinateSpaceId: "space-1", coordinateSpaceRevision: 0,
      provider: { providerId: "vello-hybrid", providerVersion: "1.4.0", buildHash: "9f2c11ab" },
      brushPresetId: "brush-gpen", brushContractHash: "c0ffee42", seed: 7,
      mode: "pen", blendMode: "normal", color: "#112233", width: 8, opacity: 1,
      sampleSchema: STUDIO_LIVE_INK_SAMPLE_SCHEMA, startedAt: NOW,
    },
  });
}

function inkChunk(): StudioLiveInkWireMessage {
  return createStudioLiveInkWireMessage({
    workId: WORK_ID, senderSessionId: LOCAL.sessionId, sentAt: NOW,
    message: {
      kind: "ink:chunk", strokeId: "peer-ink", chunkSequence: 1, firstSampleIndex: 0, sampleCount: 2,
      payload: encodeStudioLiveInkSamples([{ x: 10, y: 20, pressure: 0.4 }, { x: 11, y: 21, pressure: 0.8 }]),
    },
  });
}

function request(): StudioCrdtUpdateRequest {
  return {
    protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION, workId: WORK_ID,
    updateId: "00000000-0000-4000-8000-000000000091", clientSequence: 1, update: "AAAA",
  };
}

function respondWithEmptySnapshot(transport: StudioLiveTransport): void {
  transport.subscribeCrdt?.((message) => {
    if (message.type !== "sync-request") return;
    transport.respondCrdtSync?.({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION, workId: WORK_ID,
      requestId: message.request.requestId, transferId: "00000000-0000-4000-8000-000000000092",
      chunks: ["AAA="], chunkCount: 1, totalBytes: 2, serverStateVector: "AA==", serverSequence: "0",
    }, message.senderSessionId);
  });
}

function syncRequest(): StudioCrdtSyncRequest {
  return {
    protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION, workId: WORK_ID,
    requestId: "00000000-0000-4000-8000-000000000093", stateVector: "AA==",
  };
}

describe("mesh transport synchronization regressions", () => {
  it("emits one ready notification when the actual peer data channel opens", async () => {
    const test = await pair();
    expect(test.controls.filter((event) => event.type === "status" && event.status.state === "ready")).toHaveLength(1);
  });

  it("negotiates and delivers byte-exact live ink without a primary ink lane", async () => {
    const { a, b } = await pair();
    const received: unknown[] = [];
    b.transport.subscribeInk?.((wire) => received.push(wire));
    expect(a.transport.binaryLaneCapabilities).toContain(STUDIO_LIVE_INK_CAPABILITY);
    expect(b.transport.binaryLaneCapabilities).toContain(STUDIO_LIVE_INK_CAPABILITY);
    const begin = inkBegin();
    const chunk = inkChunk();
    expect(a.transport.sendInk?.(begin)).toBe(true);
    expect(a.transport.sendInk?.(chunk)).toBe(true);
    expect(received).toEqual([begin, chunk]);
    expect(a.primary.sentInk).toEqual([]);
  });

  it.each([{ ordered: false }, { maxRetransmits: 1 }])("refuses actual ink on an unreliable channel: %j", async (options) => {
    const { a } = await pair(options);
    expect(a.transport.binaryLaneCapabilities ?? []).not.toContain(STUDIO_LIVE_INK_CAPABILITY);
    expect(a.transport.sendInk?.(inkBegin())).toBe(false);
    expect(a.primary.sentInk).toEqual([]);
  });

  it("fails closed under backpressure, resumes after recovery, and reports channel closure", async () => {
    const { hub, a, b } = await pair();
    const received: unknown[] = [];
    b.transport.subscribeInk?.((wire) => received.push(wire));
    for (const channel of hub.channels) channel.bufferedAmount = STUDIO_LIVE_P2P_INK_MAX_BUFFERED_BYTES;
    expect(a.transport.sendInk?.(inkBegin())).toBe(false);
    expect(received).toEqual([]);
    expect(a.primary.sentInk).toEqual([]);
    for (const channel of hub.channels) channel.bufferedAmount = 0;
    expect(a.transport.sendInk?.(inkBegin())).toBe(true);
    expect(received).toEqual([inkBegin()]);
    b.transport.close();
    expect(a.transport.sendInk?.(inkChunk())).toBe(false);
  });

  it("does not let a local receipt hide a failed RTC update or suppress its retry", async () => {
    const { hub, a, b } = await pair();
    const received: StudioCrdtTransportMessage[] = [];
    b.transport.subscribeCrdt?.((message) => received.push(message));
    hub.failNextSend = true;
    await expect(a.transport.publishCrdtUpdate?.(request())).rejects.toThrow();
    expect(a.primary.publishCrdtUpdate).toHaveBeenCalledOnce();
    expect(received).toEqual([]);
    await expect(a.transport.publishCrdtUpdate?.(request())).resolves.toMatchObject({ duplicate: false });
    expect(received.filter((message) => message.type === "update")).toHaveLength(1);
  });

  it("resends the same update ID when the set of reachable peers changes", async () => {
    const test = await pair();
    await test.a.transport.publishCrdtUpdate?.(request());
    const c = test.make(THIRD);
    const received: StudioCrdtTransportMessage[] = [];
    c.transport.subscribeCrdt?.((message) => received.push(message));
    await c.transport.connect();
    test.a.primary.emit(presence(THIRD));
    test.b.primary.emit(presence(THIRD));
    c.primary.emit(presence(LOCAL));
    c.primary.emit(presence(REMOTE));
    await microtasks();
    await test.a.transport.publishCrdtUpdate?.(request());
    expect(received.filter((message) => message.type === "update" && message.update.updateId === request().updateId)).toHaveLength(1);
  });

  it("uses an available peer snapshot without waiting for a stalled local channel", async () => {
    const { a, b } = await pair();
    a.primary.requestCrdtSync.mockImplementation(() => new Promise(() => undefined));
    respondWithEmptySnapshot(b.transport);
    let response: StudioCrdtSyncResponse | null = null;
    void a.transport.requestCrdtSync?.(syncRequest()).then((value) => { response = value; });
    await vi.waitFor(() => expect(response).not.toBeNull(), { timeout: 300, interval: 10 });
  });

  it("does not replace a failed authoritative snapshot with a peer save fence", async () => {
    const { a, b } = await pair({ fanout: "authoritative" });
    a.primary.requestCrdtSync.mockRejectedValue(new Error("authority offline"));
    respondWithEmptySnapshot(b.transport);
    await expect(a.transport.requestCrdtSync?.(syncRequest())).rejects.toThrow("authority offline");
  });
});
