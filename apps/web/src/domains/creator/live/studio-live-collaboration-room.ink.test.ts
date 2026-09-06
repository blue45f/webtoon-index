import { describe, expect, it } from "vitest";

import {
  createStudioLiveEnvelope,
  studioLocalLiveChannelName,
  type StudioLiveEnvelope,
  type StudioLiveParticipant,
} from "./studio-live-collaboration-protocol";
import {
  STUDIO_LIVE_INK_BACKPRESSURE_HIGH_QUEUED_CHUNKS,
  STUDIO_LIVE_INK_BACKPRESSURE_MID_QUEUED_CHUNKS,
  STUDIO_LIVE_INK_CHUNK_CADENCE_HIGH_MS,
  STUDIO_LIVE_INK_CHUNK_CADENCE_LOW_FAST_MS,
  STUDIO_LIVE_INK_CHUNK_CADENCE_LOW_MS,
  STUDIO_LIVE_INK_CHUNK_CADENCE_MID_MS,
  StudioLiveRoom,
  type StudioLiveInkRoomEvent,
  type StudioLiveRoomDependencies,
} from "./studio-live-collaboration-room";
import {
  createStudioMemoryLiveTransportFactory,
  StudioMemoryBroadcastHub,
  type StudioLiveTransport,
  type StudioLiveTransportContext,
  type StudioLiveTransportControlEvent,
} from "./studio-live-collaboration-transport";
import {
  decodeStudioLiveInkSamples,
  encodeStudioLiveInkSamples,
  hashStudioLiveInkPayloads,
} from "./studio-live-ink-codec";
import {
  createStudioLiveInkWireMessage,
  STUDIO_LIVE_INK_MAX_ACTIVE_STROKES,
  STUDIO_LIVE_INK_PROTOCOL_VERSION,
  STUDIO_LIVE_INK_SAMPLE_SCHEMA,
  type StudioLiveInkBegin,
  type StudioLiveInkChunk,
  type StudioLiveInkMessage,
  type StudioLiveInkPrediction,
  type StudioLiveInkWireMessage,
} from "./studio-live-ink-protocol";

const alice: StudioLiveParticipant = {
  sessionId: "session-alice",
  displayName: "서윤 탭",
  role: "owner",
};
const bob: StudioLiveParticipant = {
  sessionId: "session-bob",
  displayName: "민호 탭",
  role: "editor",
};
const viewer: StudioLiveParticipant = {
  sessionId: "session-viewer",
  displayName: "관전 탭",
  role: "viewer",
};

function payloadOf(count: number, base = 0): ArrayBuffer {
  return encodeStudioLiveInkSamples(
    Array.from({ length: count }, (_, index) => ({
      x: base + index,
      y: base + index * 2,
      pressure: 0.5,
      timeDeltaMs: 8,
    }))
  );
}

function beginInput(strokeId = "stroke-1", startedAt = 1_000_000): Omit<StudioLiveInkBegin, "kind"> {
  return {
    protocolVersion: STUDIO_LIVE_INK_PROTOCOL_VERSION,
    strokeId,
    pageId: "page-1",
    layerId: "layer-1",
    coordinateSpaceId: "space-a4",
    coordinateSpaceRevision: 1,
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
    startedAt,
  };
}

function chunkInput(
  strokeId: string,
  chunkSequence: number,
  firstSampleIndex: number,
  sampleCount = 4
): Omit<StudioLiveInkChunk, "kind"> {
  return {
    strokeId,
    chunkSequence,
    firstSampleIndex,
    sampleCount,
    payload: payloadOf(sampleCount, firstSampleIndex),
  };
}

function predictionInput(
  strokeId: string,
  predictionSequence: number,
  expiresAt: number
): Omit<StudioLiveInkPrediction, "kind"> {
  return {
    strokeId,
    predictionSequence,
    replacesFromSampleIndex: 0,
    expiresAt,
    sampleCount: 2,
    payload: payloadOf(2),
  };
}

function harness() {
  let now = 1_000_000;
  const hub = new StudioMemoryBroadcastHub();
  interface PendingTimeout {
    id: number;
    handler: () => void;
    delay: number;
  }
  const pendingTimeouts: PendingTimeout[] = [];
  let nextTimeoutId = 1;
  const baseDependencies: StudioLiveRoomDependencies = {
    transportFactory: createStudioMemoryLiveTransportFactory(hub),
    now: () => now,
    setInterval: () => 0,
    clearInterval: () => undefined,
    setTimeout: (handler, delay) => {
      const id = nextTimeoutId;
      nextTimeoutId += 1;
      pendingTimeouts.push({ id, handler, delay });
      return id;
    },
    clearTimeout: (handle) => {
      const index = pendingTimeouts.findIndex((entry) => entry.id === handle);
      if (index >= 0) pendingTimeouts.splice(index, 1);
    },
    cursorIntervalMs: 40,
  };
  return {
    hub,
    pendingTimeouts,
    now: () => now,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    runNextTimeout: () => {
      const next = pendingTimeouts.shift();
      next?.handler();
    },
    room: (
      participant: StudioLiveParticipant,
      dependencies: Partial<StudioLiveRoomDependencies> = {}
    ) =>
      new StudioLiveRoom({
        workId: "work-1",
        participant,
        dependencies: { ...baseDependencies, ...dependencies },
      }),
  };
}

function collectInk(room: StudioLiveRoom): StudioLiveInkRoomEvent[] {
  const events: StudioLiveInkRoomEvent[] = [];
  room.subscribeInk((event) => events.push(event));
  return events;
}

describe("StudioLiveRoom ink channel (V18)", () => {
  it("publishes a stroke lifecycle over the binary lane, separate from cursor events", async () => {
    const test = harness();
    const roomA = test.room(alice);
    const roomB = test.room(bob);
    await roomA.start();
    await roomB.start();
    const inkEvents = collectInk(roomB);
    const cursorEvents: string[] = [];
    roomB.subscribe((event) => cursorEvents.push(event.type));

    expect(roomA.publishInkBegin(beginInput("stroke-1", test.now()))).toBe(true);
    expect(roomA.publishInkChunk(chunkInput("stroke-1", 1, 0))).toBe(true);
    const sampleHash = hashStudioLiveInkPayloads([payloadOf(4, 0)]);
    expect(
      roomA.publishInkEnd({
        strokeId: "stroke-1",
        lastChunkSequence: 1,
        totalActualSamples: 4,
        sampleHash,
        crdtStrokeId: "crdt-stroke-1",
      })
    ).toBe(true);
    // The end frame waits for the next cadence tick behind the chunk it must not overtake.
    test.advance(STUDIO_LIVE_INK_CHUNK_CADENCE_LOW_FAST_MS);
    test.runNextTimeout();

    expect(inkEvents.map((event) => event.message.kind)).toEqual([
      "ink:begin",
      "ink:chunk",
      "ink:end",
    ]);
    expect(inkEvents[0]!.participant).toEqual(alice);
    const receivedChunk = inkEvents[1]!.message;
    if (receivedChunk.kind !== "ink:chunk") throw new Error("chunk expected");
    const decoded = decodeStudioLiveInkSamples(receivedChunk.payload);
    expect(decoded.samples).toHaveLength(4);
    expect(decoded.samples[0]).toMatchObject({ x: 0, y: 0, timeDeltaMs: 8 });
    expect(decoded.samples[0]!.pressure).toBeCloseTo(0.5, 4);
    const receivedEnd = inkEvents[2]!.message;
    if (receivedEnd.kind !== "ink:end") throw new Error("end expected");
    expect(receivedEnd.sampleHash).toBe(sampleHash);
    // Ink never leaks into the JSON room-event surface.
    expect(cursorEvents).not.toContain("transport-error");
    expect(cursorEvents.filter((type) => type === "cursor")).toHaveLength(0);
    roomA.close();
    roomB.close();
  });

  it("keeps cursor throttling untouched while the ink scheduler runs", async () => {
    const test = harness();
    const roomA = test.room(alice);
    const roomB = test.room(bob);
    await roomA.start();
    await roomB.start();
    const inkEvents = collectInk(roomB);

    const cursor = { x: 0.5, y: 0.5, pageId: "page-1", tool: "brush" };
    expect(roomA.publishCursor(cursor)).toBe(true);
    expect(roomA.publishInkBegin(beginInput("stroke-1", test.now()))).toBe(true);
    expect(roomA.publishInkChunk(chunkInput("stroke-1", 1, 0))).toBe(true);
    // Ink traffic must not consume or reset the 40ms cursor interval.
    expect(roomA.publishCursor(cursor)).toBe(false);
    test.advance(40);
    expect(roomA.publishCursor(cursor)).toBe(true);
    expect(inkEvents.map((event) => event.message.kind)).toEqual(["ink:begin", "ink:chunk"]);
    roomA.close();
    roomB.close();
  });

  it("walks backpressure low→mid→high, sheds predictions first and never drops actuals", async () => {
    const test = harness();
    const roomA = test.room(alice);
    const roomB = test.room(bob);
    await roomA.start();
    await roomB.start();
    const inkEvents = collectInk(roomB);

    expect(roomA.publishInkBegin(beginInput("stroke-1", test.now()))).toBe(true);
    expect(roomA.getInkBackpressure()).toMatchObject({
      level: "low",
      chunkCadenceMs: STUDIO_LIVE_INK_CHUNK_CADENCE_LOW_FAST_MS,
    });
    // First chunk flushes immediately; later chunks buffer because time is frozen.
    let sequence = 1;
    let sampleIndex = 0;
    const publishChunk = () => {
      expect(roomA.publishInkChunk(chunkInput("stroke-1", sequence, sampleIndex))).toBe(true);
      sequence += 1;
      sampleIndex += 4;
    };
    publishChunk();
    publishChunk();
    publishChunk();
    expect(roomA.getInkBackpressure()).toMatchObject({
      level: "low",
      queuedChunks: 2,
      chunkCadenceMs: STUDIO_LIVE_INK_CHUNK_CADENCE_LOW_MS,
    });
    // A queued prediction is legal below the high watermark.
    expect(
      roomA.publishInkPrediction(predictionInput("stroke-1", 1, test.now() + 500))
    ).toBe(true);
    while (roomA.getInkBackpressure().level !== "mid") publishChunk();
    expect(roomA.getInkBackpressure()).toMatchObject({
      level: "mid",
      chunkCadenceMs: STUDIO_LIVE_INK_CHUNK_CADENCE_MID_MS,
    });
    expect(roomA.getInkBackpressure().queuedChunks).toBeGreaterThanOrEqual(
      STUDIO_LIVE_INK_BACKPRESSURE_MID_QUEUED_CHUNKS
    );
    while (roomA.getInkBackpressure().level !== "high") publishChunk();
    const high = roomA.getInkBackpressure();
    expect(high.chunkCadenceMs).toBe(STUDIO_LIVE_INK_CHUNK_CADENCE_HIGH_MS);
    expect(high.queuedChunks).toBeGreaterThanOrEqual(
      STUDIO_LIVE_INK_BACKPRESSURE_HIGH_QUEUED_CHUNKS
    );
    // Entering high shed the queued prediction; new predictions are refused outright.
    expect(high.droppedPredictions).toBe(1);
    expect(
      roomA.publishInkPrediction(predictionInput("stroke-1", 2, test.now() + 500))
    ).toBe(false);
    expect(roomA.getInkBackpressure().droppedPredictions).toBe(2);

    const totalChunks = sequence - 1;
    expect(
      roomA.publishInkEnd({
        strokeId: "stroke-1",
        lastChunkSequence: totalChunks,
        totalActualSamples: sampleIndex,
        sampleHash: hashStudioLiveInkPayloads([]),
        crdtStrokeId: "crdt-stroke-1",
      })
    ).toBe(true);

    // Drain: every buffered actual arrives in order; the shed prediction never does.
    for (let guard = 0; guard < 200 && test.pendingTimeouts.length > 0; guard += 1) {
      test.advance(STUDIO_LIVE_INK_CHUNK_CADENCE_HIGH_MS);
      test.runNextTimeout();
    }
    expect(roomA.getInkBackpressure()).toMatchObject({
      level: "low",
      queuedMessages: 0,
      queuedBytes: 0,
    });
    const kinds = inkEvents.map((event) => event.message.kind);
    expect(kinds[0]).toBe("ink:begin");
    expect(kinds.at(-1)).toBe("ink:end");
    expect(kinds).not.toContain("ink:prediction");
    const receivedSequences = inkEvents
      .map((event) => event.message)
      .filter((message): message is StudioLiveInkChunk => message.kind === "ink:chunk")
      .map((message) => message.chunkSequence);
    expect(receivedSequences).toEqual(
      Array.from({ length: totalChunks }, (_, index) => index + 1)
    );
    roomA.close();
    roomB.close();
  });

  it("drops expired predictions at flush time without touching actuals", async () => {
    const test = harness();
    const roomA = test.room(alice);
    const roomB = test.room(bob);
    await roomA.start();
    await roomB.start();
    const inkEvents = collectInk(roomB);

    expect(roomA.publishInkBegin(beginInput("stroke-1", test.now()))).toBe(true);
    expect(roomA.publishInkChunk(chunkInput("stroke-1", 1, 0))).toBe(true);
    expect(
      roomA.publishInkPrediction(predictionInput("stroke-1", 1, test.now() + 10))
    ).toBe(true);
    expect(roomA.publishInkChunk(chunkInput("stroke-1", 2, 4))).toBe(true);
    // Let the prediction expire before its turn on the wire.
    test.advance(STUDIO_LIVE_INK_CHUNK_CADENCE_LOW_MS * 4);
    test.runNextTimeout();
    test.advance(STUDIO_LIVE_INK_CHUNK_CADENCE_LOW_MS);
    test.runNextTimeout();

    expect(inkEvents.map((event) => event.message.kind)).toEqual([
      "ink:begin",
      "ink:chunk",
      "ink:chunk",
    ]);
    expect(roomA.getInkBackpressure().droppedPredictions).toBe(1);
    roomA.close();
    roomB.close();
  });

  it("fails closed when the transport did not negotiate ink-v2 — sender side", async () => {
    const test = harness();
    const roomA = test.room(alice, {
      transportFactory: createStudioMemoryLiveTransportFactory(test.hub, { inkLane: false }),
    });
    const roomB = test.room(bob);
    await roomA.start();
    await roomB.start();
    const inkEvents = collectInk(roomB);

    expect(roomA.publishInkBegin(beginInput("stroke-1", test.now()))).toBe(false);
    expect(roomA.publishInkChunk(chunkInput("stroke-1", 1, 0))).toBe(false);
    expect(inkEvents).toEqual([]);
    // The V18 contract keeps the room cursor-only — presence and cursors still flow.
    expect(roomA.publishCursor({ x: 0.1, y: 0.2, pageId: "page-1", tool: "brush" })).toBe(true);
    expect(roomB.getCursors()).toHaveLength(1);
    roomA.close();
    roomB.close();
  });

  it("fails closed when the transport did not negotiate ink-v2 — receiver side", async () => {
    const test = harness();
    const roomA = test.room(alice);
    const roomB = test.room(bob, {
      transportFactory: createStudioMemoryLiveTransportFactory(test.hub, { inkLane: false }),
    });
    await roomA.start();
    await roomB.start();
    const inkEvents = collectInk(roomB);

    expect(roomA.publishInkBegin(beginInput("stroke-1", test.now()))).toBe(true);
    expect(roomA.publishInkChunk(chunkInput("stroke-1", 1, 0))).toBe(true);
    // No approximate re-rendering path: the lane-less peer receives nothing but cursors.
    expect(inkEvents).toEqual([]);
    expect(roomA.publishCursor({ x: 0.4, y: 0.6, pageId: "page-1", tool: "brush" })).toBe(true);
    expect(roomB.getCursors()).toHaveLength(1);
    roomA.close();
    roomB.close();
  });

  it("refuses viewers, unknown strokes and out-of-order lifecycles at the publisher", async () => {
    const test = harness();
    const roomA = test.room(alice);
    const roomV = test.room(viewer);
    await roomA.start();
    await roomV.start();

    expect(roomV.publishInkBegin(beginInput("stroke-viewer", test.now()))).toBe(false);
    expect(roomA.publishInkChunk(chunkInput("stroke-unbegun", 1, 0))).toBe(false);
    expect(roomA.publishInkBegin(beginInput("stroke-1", test.now()))).toBe(true);
    expect(roomA.publishInkBegin(beginInput("stroke-1", test.now()))).toBe(false);
    expect(roomA.publishInkChunk(chunkInput("stroke-1", 2, 0))).toBe(false);
    expect(roomA.publishInkChunk(chunkInput("stroke-1", 1, 0))).toBe(true);
    expect(
      roomA.publishInkEnd({
        strokeId: "stroke-1",
        lastChunkSequence: 9,
        totalActualSamples: 4,
        sampleHash: hashStudioLiveInkPayloads([]),
        crdtStrokeId: "crdt-1",
      })
    ).toBe(false);
    expect(roomA.publishInkCancel({ strokeId: "stroke-1", reason: "user" })).toBe(true);
    roomA.close();
    roomV.close();
  });

  it("drops inbound ink from senders without verified presence and replayed chunks", async () => {
    const test = harness();
    const roomB = test.room(bob);
    await roomB.start();
    const inkEvents = collectInk(roomB);
    const ghostChannel = test.hub.create(studioLocalLiveChannelName("work-1"));

    // A structurally valid frame from a session that never joined presence is refused.
    ghostChannel.postMessage(
      createStudioLiveInkWireMessage({
        workId: "work-1",
        senderSessionId: "session-ghost",
        sentAt: test.now(),
        message: { ...beginInput("stroke-ghost", test.now()), kind: "ink:begin" },
      })
    );
    expect(inkEvents).toEqual([]);

    // A presence-verified editor is accepted, but replayed chunk sequences fail closed.
    const roomA = test.room(alice);
    await roomA.start();
    expect(roomA.publishInkBegin(beginInput("stroke-1", test.now()))).toBe(true);
    expect(roomA.publishInkChunk(chunkInput("stroke-1", 1, 0))).toBe(true);
    const replay = createStudioLiveInkWireMessage({
      workId: "work-1",
      senderSessionId: alice.sessionId,
      sentAt: test.now(),
      message: { ...chunkInput("stroke-1", 1, 0), kind: "ink:chunk" },
    });
    ghostChannel.postMessage(replay);
    expect(
      inkEvents.map((event) => event.message.kind)
    ).toEqual(["ink:begin", "ink:chunk"]);
    roomA.close();
    roomB.close();
  });
});

/**
 * Raw socket-style transport double: presence envelopes are keyed by per-connection ids while
 * ink wire frames carry the author's canonical client-instance id. The identity bridge mirrors
 * the Socket.IO transport's single-active-connection rule — a connection canonicalizes only
 * while it is the sole live connection of its identity, and a tombstoned connection
 * canonicalizes only after the identity's last live connection has left.
 */
class FakeRawSocketTransport implements StudioLiveTransport {
  readonly mode = "server" as const;
  inkLane = true;
  readonly sentEnvelopes: StudioLiveEnvelope[] = [];
  readonly sentInk: StudioLiveInkWireMessage[] = [];
  private connected = false;
  private closed = false;
  private readonly listeners = new Set<(value: unknown) => void>();
  private readonly controlListeners = new Set<(event: StudioLiveTransportControlEvent) => void>();
  private readonly inkListeners = new Set<(value: unknown) => void>();
  private readonly connections = new Map<
    string,
    { clientInstanceId: string; active: boolean }
  >();

  constructor(private readonly context: StudioLiveTransportContext) {}

  get ready(): boolean {
    return this.connected && !this.closed;
  }

  get binaryLaneCapabilities(): readonly string[] {
    return this.ready && this.inkLane ? ["ink-v2"] : [];
  }

  joinPeer(connectionId: string, clientInstanceId: string): void {
    this.connections.set(connectionId, { clientInstanceId, active: true });
  }

  leavePeer(connectionId: string): void {
    const record = this.connections.get(connectionId);
    if (record) record.active = false;
  }

  canonicalSessionId(transportSessionId: string): string {
    if (transportSessionId === this.context.participant.sessionId) return transportSessionId;
    const record = this.connections.get(transportSessionId);
    if (!record) return transportSessionId;
    const active = this.activeConnectionsOf(record.clientInstanceId);
    if (record.active) {
      return active.length === 1 && active[0] === transportSessionId
        ? record.clientInstanceId
        : transportSessionId;
    }
    return active.length === 0 ? record.clientInstanceId : transportSessionId;
  }

  transportSessionId(canonicalSessionId: string): string | null {
    if (canonicalSessionId === this.context.participant.sessionId) return canonicalSessionId;
    if (this.connections.has(canonicalSessionId)) return canonicalSessionId;
    const active = this.activeConnectionsOf(canonicalSessionId);
    return active.length === 1 ? active[0]! : null;
  }

  connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }

  send(envelope: StudioLiveEnvelope): boolean {
    if (!this.ready) return false;
    this.sentEnvelopes.push(structuredClone(envelope));
    return true;
  }

  sendInk(message: StudioLiveInkWireMessage): boolean {
    if (!this.ready || !this.inkLane) return false;
    this.sentInk.push(structuredClone(message));
    return true;
  }

  subscribe(listener: (value: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeControl(listener: (event: StudioLiveTransportControlEvent) => void): () => void {
    this.controlListeners.add(listener);
    return () => this.controlListeners.delete(listener);
  }

  subscribeInk(listener: (value: unknown) => void): () => void {
    this.inkListeners.add(listener);
    return () => this.inkListeners.delete(listener);
  }

  receiveEnvelope(value: unknown): void {
    if (!this.ready) return;
    for (const listener of this.listeners) listener(structuredClone(value));
  }

  receiveControl(event: StudioLiveTransportControlEvent): void {
    if (this.closed) return;
    if (event.type === "status") {
      if (event.status.state === "revoked" || event.status.state === "disconnected") {
        this.connected = false;
      } else if (event.status.state === "ready") {
        this.connected = true;
      }
    }
    for (const listener of this.controlListeners) listener(structuredClone(event));
  }

  receiveInk(value: unknown): void {
    if (!this.ready || !this.inkLane) return;
    for (const listener of this.inkListeners) listener(structuredClone(value));
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
    this.controlListeners.clear();
    this.inkListeners.clear();
  }

  private activeConnectionsOf(clientInstanceId: string): string[] {
    const active: string[] = [];
    for (const [connectionId, record] of this.connections) {
      if (record.active && record.clientInstanceId === clientInstanceId) {
        active.push(connectionId);
      }
    }
    return active;
  }
}

function rawSocketRoom(
  test: ReturnType<typeof harness>,
  participant: StudioLiveParticipant
): { room: StudioLiveRoom; transport: () => FakeRawSocketTransport } {
  let transport: FakeRawSocketTransport | null = null;
  const room = test.room(participant, {
    transportFactory: (context) => {
      transport = new FakeRawSocketTransport(context);
      return transport;
    },
  });
  return {
    room,
    transport: () => {
      if (!transport) throw new Error("transport not created — start the room first");
      return transport;
    },
  };
}

function serverPresenceHello(
  transport: FakeRawSocketTransport,
  connectionId: string,
  role: StudioLiveParticipant["role"],
  sequence: number,
  sentAt: number
): void {
  transport.receiveEnvelope(
    createStudioLiveEnvelope({
      workId: "work-1",
      sender: { sessionId: connectionId, displayName: "재접속 편집자", role },
      sentAt,
      sequence,
      kind: "presence:hello",
      payload: { visibility: "active", pageId: null },
    })
  );
}

function serverPresenceLeave(
  transport: FakeRawSocketTransport,
  connectionId: string,
  role: StudioLiveParticipant["role"],
  sequence: number,
  sentAt: number
): void {
  transport.receiveEnvelope(
    createStudioLiveEnvelope({
      workId: "work-1",
      sender: { sessionId: connectionId, displayName: "재접속 편집자", role },
      sentAt,
      sequence,
      kind: "presence:leave",
      payload: {},
    })
  );
}

function inkWire(
  authorId: string,
  sentAt: number,
  message: StudioLiveInkMessage
): StudioLiveInkWireMessage {
  return createStudioLiveInkWireMessage({
    workId: "work-1",
    senderSessionId: authorId,
    sentAt,
    message,
  });
}

function drainInkTimers(test: ReturnType<typeof harness>): void {
  for (let guard = 0; guard < 50 && test.pendingTimeouts.length > 0; guard += 1) {
    test.advance(STUDIO_LIVE_INK_CHUNK_CADENCE_HIGH_MS);
    test.runNextTimeout();
  }
}

describe("StudioLiveRoom ink sender identity over raw socket transports", () => {
  it("tracks one author across two connections as one ink sender", async () => {
    const test = harness();
    const { room, transport } = rawSocketRoom(test, bob);
    await room.start();
    const t = transport();
    const inkEvents = collectInk(room);

    t.joinPeer("conn-a", "client-hana");
    serverPresenceHello(t, "conn-a", "editor", 1, test.now());
    t.receiveInk(
      inkWire("client-hana", test.now(), { ...beginInput("stroke-1", test.now()), kind: "ink:begin" })
    );
    t.receiveInk(inkWire("client-hana", test.now(), { ...chunkInput("stroke-1", 1, 0), kind: "ink:chunk" }));

    // Server-side connection replacement: the new connection joins before the old one leaves.
    t.joinPeer("conn-b", "client-hana");
    serverPresenceHello(t, "conn-b", "editor", 1, test.now());
    t.leavePeer("conn-a");
    serverPresenceLeave(t, "conn-a", "editor", 2, test.now());

    // The stroke continues over the new connection: same author, same lifecycle gate.
    t.receiveInk(inkWire("client-hana", test.now(), { ...chunkInput("stroke-1", 2, 4), kind: "ink:chunk" }));
    t.receiveInk(
      inkWire("client-hana", test.now(), {
        kind: "ink:end",
        strokeId: "stroke-1",
        lastChunkSequence: 2,
        totalActualSamples: 8,
        sampleHash: hashStudioLiveInkPayloads([payloadOf(4, 0), payloadOf(4, 4)]),
        crdtStrokeId: "crdt-stroke-1",
      })
    );

    expect(inkEvents.map((event) => event.message.kind)).toEqual([
      "ink:begin",
      "ink:chunk",
      "ink:chunk",
      "ink:end",
    ]);
    // Presence-to-ink attribution stays canonical: one author, never two per-connection senders.
    expect(new Set(inkEvents.map((event) => event.participant.sessionId))).toEqual(
      new Set(["client-hana"])
    );
    expect(room.getInkUnknownAuthorDropCount()).toBe(0);
    room.close();
  });

  it("fails closed on unknown, connection-stamped and ambiguous author claims", async () => {
    const test = harness();
    const { room, transport } = rawSocketRoom(test, bob);
    await room.start();
    const t = transport();
    const inkEvents = collectInk(room);

    t.joinPeer("conn-a", "client-hana");
    serverPresenceHello(t, "conn-a", "editor", 1, test.now());

    // A structurally valid frame from an identity presence never verified.
    t.receiveInk(
      inkWire("client-ghost", test.now(), { ...beginInput("stroke-ghost", test.now()), kind: "ink:begin" })
    );
    expect(inkEvents).toEqual([]);
    expect(room.getInkUnknownAuthorDropCount()).toBe(1);

    // A frame stamping the peer's transport connection id instead of its author identity.
    t.receiveInk(
      inkWire("conn-a", test.now(), { ...beginInput("stroke-conn", test.now()), kind: "ink:begin" })
    );
    expect(inkEvents).toEqual([]);
    expect(room.getInkUnknownAuthorDropCount()).toBe(2);

    // Two live connections share the identity: the claim is ambiguous and must not attach.
    t.joinPeer("conn-b", "client-hana");
    serverPresenceHello(t, "conn-b", "editor", 1, test.now());
    t.receiveInk(
      inkWire("client-hana", test.now(), {
        ...beginInput("stroke-ambiguous", test.now()),
        kind: "ink:begin",
      })
    );
    expect(inkEvents).toEqual([]);
    expect(room.getInkUnknownAuthorDropCount()).toBe(3);

    // Once the identity is unambiguous again, the same author resolves normally.
    t.leavePeer("conn-a");
    serverPresenceLeave(t, "conn-a", "editor", 2, test.now());
    t.receiveInk(
      inkWire("client-hana", test.now(), { ...beginInput("stroke-1", test.now()), kind: "ink:begin" })
    );
    expect(inkEvents.map((event) => event.message.kind)).toEqual(["ink:begin"]);
    expect(room.getInkUnknownAuthorDropCount()).toBe(3);
    room.close();
  });

  it("keeps the per-author active-stroke budget across a connection replacement", async () => {
    const test = harness();
    const { room, transport } = rawSocketRoom(test, bob);
    await room.start();
    const t = transport();
    const inkEvents = collectInk(room);

    t.joinPeer("conn-a", "client-hana");
    serverPresenceHello(t, "conn-a", "editor", 1, test.now());
    for (let index = 1; index <= STUDIO_LIVE_INK_MAX_ACTIVE_STROKES; index += 1) {
      t.receiveInk(
        inkWire("client-hana", test.now(), {
          ...beginInput(`stroke-${index}`, test.now()),
          kind: "ink:begin",
        })
      );
    }
    expect(inkEvents).toHaveLength(STUDIO_LIVE_INK_MAX_ACTIVE_STROKES);

    t.joinPeer("conn-b", "client-hana");
    serverPresenceHello(t, "conn-b", "editor", 1, test.now());
    t.leavePeer("conn-a");
    serverPresenceLeave(t, "conn-a", "editor", 2, test.now());

    // The active-stroke budget belongs to the author, not to the connection: a new connection
    // must not mint a fresh tracker with a fresh budget.
    t.receiveInk(
      inkWire("client-hana", test.now(), { ...beginInput("stroke-9", test.now()), kind: "ink:begin" })
    );
    expect(inkEvents).toHaveLength(STUDIO_LIVE_INK_MAX_ACTIVE_STROKES);

    // Settling one stroke frees exactly one slot in that same tracker.
    t.receiveInk(
      inkWire("client-hana", test.now(), { kind: "ink:cancel", strokeId: "stroke-1", reason: "user" })
    );
    t.receiveInk(
      inkWire("client-hana", test.now(), { ...beginInput("stroke-9", test.now()), kind: "ink:begin" })
    );
    expect(inkEvents.map((event) => event.message.kind).slice(-2)).toEqual([
      "ink:cancel",
      "ink:begin",
    ]);
    expect(inkEvents).toHaveLength(STUDIO_LIVE_INK_MAX_ACTIVE_STROKES + 2);
    expect(room.getInkUnknownAuthorDropCount()).toBe(0);
    room.close();
  });
});

describe("StudioLiveRoom ink reconnect semantics", () => {
  it("cancels active outbound strokes exactly once on reconnect instead of replaying", async () => {
    const test = harness();
    const { room, transport } = rawSocketRoom(test, alice);
    await room.start();
    const t = transport();

    expect(room.publishInkBegin(beginInput("stroke-1", test.now()))).toBe(true);
    expect(room.publishInkChunk(chunkInput("stroke-1", 1, 0))).toBe(true);
    // A second actual buffers behind the cadence and straddles the disconnect.
    expect(room.publishInkChunk(chunkInput("stroke-1", 2, 4))).toBe(true);
    expect(t.sentInk.map((frame) => frame.message.kind)).toEqual(["ink:begin", "ink:chunk"]);

    t.receiveControl({
      type: "status",
      status: { state: "disconnected", message: "network lost", recoverable: true },
    });
    expect(room.publishInkChunk(chunkInput("stroke-1", 3, 8))).toBe(false);

    test.advance(1_000);
    t.receiveControl({
      type: "status",
      status: { state: "ready", message: "reconnected", recoverable: true },
    });
    drainInkTimers(test);

    // The buffered mid-stroke chunk is discarded, never replayed; the stroke is cancelled.
    expect(t.sentInk.map((frame) => frame.message.kind)).toEqual([
      "ink:begin",
      "ink:chunk",
      "ink:cancel",
    ]);
    const cancel = t.sentInk.at(-1)!.message;
    if (cancel.kind !== "ink:cancel") throw new Error("cancel expected");
    expect(cancel).toMatchObject({ strokeId: "stroke-1", reason: "transport-error" });

    // A second ready tick must not cancel again.
    t.receiveControl({
      type: "status",
      status: { state: "ready", message: "reconnected again", recoverable: true },
    });
    drainInkTimers(test);
    expect(
      t.sentInk.filter((frame) => frame.message.kind === "ink:cancel")
    ).toHaveLength(1);

    // The settled id is banned for reuse; the author restarts under a fresh id only.
    expect(room.publishInkBegin(beginInput("stroke-1", test.now()))).toBe(false);
    expect(room.publishInkChunk(chunkInput("stroke-1", 3, 8))).toBe(false);
    expect(room.publishInkBegin(beginInput("stroke-2", test.now()))).toBe(true);
    drainInkTimers(test);
    expect(t.sentInk.at(-1)!.message).toMatchObject({ kind: "ink:begin", strokeId: "stroke-2" });
    room.close();
  });

  it("cancels every straddling stroke and leaves none dangling", async () => {
    const test = harness();
    const { room, transport } = rawSocketRoom(test, alice);
    await room.start();
    const t = transport();

    expect(room.publishInkBegin(beginInput("stroke-1", test.now()))).toBe(true);
    expect(room.publishInkBegin(beginInput("stroke-2", test.now()))).toBe(true);
    t.receiveControl({
      type: "status",
      status: { state: "disconnected", message: "network lost", recoverable: true },
    });
    test.advance(1_000);
    t.receiveControl({
      type: "status",
      status: { state: "ready", message: "reconnected", recoverable: true },
    });
    drainInkTimers(test);

    const cancelled = t.sentInk
      .map((frame) => frame.message)
      .filter((message): message is StudioLiveInkMessage & { kind: "ink:cancel" } =>
        message.kind === "ink:cancel"
      )
      .map((message) => message.strokeId)
      .sort();
    expect(cancelled).toEqual(["stroke-1", "stroke-2"]);
    room.close();
  });

  it("keeps a receiver that retained the author's presence consistent across a reconnect", async () => {
    const test = harness();
    const author = rawSocketRoom(test, alice);
    await author.room.start();
    const authorTransport = author.transport();

    expect(author.room.publishInkBegin(beginInput("stroke-1", test.now()))).toBe(true);
    expect(author.room.publishInkChunk(chunkInput("stroke-1", 1, 0))).toBe(true);
    expect(author.room.publishInkChunk(chunkInput("stroke-1", 2, 4))).toBe(true);
    authorTransport.receiveControl({
      type: "status",
      status: { state: "disconnected", message: "network lost", recoverable: true },
    });
    test.advance(1_000);
    authorTransport.receiveControl({
      type: "status",
      status: { state: "ready", message: "reconnected", recoverable: true },
    });
    drainInkTimers(test);
    expect(author.room.publishInkBegin(beginInput("stroke-2", test.now()))).toBe(true);
    drainInkTimers(test);

    // A receiver whose roster never dropped the author still holds the old lifecycle gate. The
    // cancel-then-fresh-id contract must replay cleanly there: no frame is refused, and the
    // author's old strokeId is never begun twice.
    const receiver = rawSocketRoom(test, bob);
    await receiver.room.start();
    const receiverTransport = receiver.transport();
    const received = collectInk(receiver.room);
    receiverTransport.joinPeer("conn-a", alice.sessionId);
    serverPresenceHello(receiverTransport, "conn-a", "editor", 1, test.now());
    for (const frame of authorTransport.sentInk) receiverTransport.receiveInk(frame);

    expect(received.map((event) => event.message.kind)).toEqual([
      "ink:begin",
      "ink:chunk",
      "ink:cancel",
      "ink:begin",
    ]);
    expect(received).toHaveLength(authorTransport.sentInk.length);
    expect(receiver.room.getInkUnknownAuthorDropCount()).toBe(0);
    expect(new Set(received.map((event) => event.participant.sessionId))).toEqual(
      new Set([alice.sessionId])
    );
    author.room.close();
    receiver.room.close();
  });
});
