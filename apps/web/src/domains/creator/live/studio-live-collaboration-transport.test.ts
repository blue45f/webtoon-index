import { describe, expect, it } from "vitest";

import {
  encodeStudioCrdtStateVector,
  encodeStudioCrdtSyncChunks,
  encodeStudioCrdtUpdate,
  STUDIO_CRDT_PROTOCOL_VERSION,
  type StudioCrdtSyncResponse,
  type StudioCrdtTransportMessage,
} from "./studio-crdt-protocol";
import {
  StudioBroadcastChannelTransport,
  type StudioBroadcastChannelLike,
  type StudioLiveTransportControlEvent,
} from "./studio-live-collaboration-transport";
import { encodeStudioLiveInkSamples } from "./studio-live-ink-codec";
import {
  createStudioLiveInkWireMessage,
  STUDIO_LIVE_INK_CAPABILITY,
  STUDIO_LIVE_INK_PROTOCOL_VERSION,
  STUDIO_LIVE_INK_SAMPLE_SCHEMA,
  type StudioLiveInkWireMessage,
} from "./studio-live-ink-protocol";

class FakeBroadcastChannel implements StudioBroadcastChannelLike {
  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
  closed = false;

  constructor(
    private readonly hub: FakeBroadcastHub,
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
    for (const listener of this.listeners) listener({ data: structuredClone(value) } as MessageEvent);
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }
}

class FakeBroadcastHub {
  readonly channels: FakeBroadcastChannel[] = [];

  create = (name: string): FakeBroadcastChannel => {
    const channel = new FakeBroadcastChannel(this, name);
    this.channels.push(channel);
    return channel;
  };

  publish(sender: FakeBroadcastChannel, value: unknown): void {
    for (const channel of this.channels) {
      if (channel !== sender && channel.name === sender.name && !channel.closed) {
        channel.receive(value);
      }
    }
  }
}

const stateVector = encodeStudioCrdtStateVector(new Uint8Array([0]));
const encodedUpdate = encodeStudioCrdtUpdate(new Uint8Array([1, 2, 3]));

function makeTransport(
  hub: FakeBroadcastHub,
  sessionId: string,
  workId = "work-1"
): StudioBroadcastChannelTransport {
  return new StudioBroadcastChannelTransport(
    "channel-1",
    hub.create,
    {
      workId,
      participant: { sessionId, displayName: sessionId, role: "editor" },
    },
    { syncTimeoutMs: 100 }
  );
}

describe("StudioBroadcastChannelTransport", () => {
  it("keeps typed comment invalidation on the optional server control plane", () => {
    const change: Extract<StudioLiveTransportControlEvent, { type: "comment-changed" }> = {
      type: "comment-changed",
      change: {
        version: 1,
        workId: "work-1",
        threadId: "thread-1",
        activitySequence: "42",
        kind: "replied",
      },
    };
    const local = makeTransport(new FakeBroadcastHub(), "alice");

    expect(change).toEqual({
      type: "comment-changed",
      change: expect.objectContaining({ workId: "work-1", threadId: "thread-1" }),
    });
    expect("subscribeControl" in local).toBe(false);
    local.close();
  });

  it("keeps durable messages off the ephemeral listener", async () => {
    const hub = new FakeBroadcastHub();
    const alice = makeTransport(hub, "alice");
    const bob = makeTransport(hub, "bob");
    await alice.connect();
    await bob.connect();
    const ephemeral: unknown[] = [];
    const durable: StudioCrdtTransportMessage[] = [];
    bob.subscribe((value) => ephemeral.push(value));
    bob.subscribeCrdt((message) => durable.push(message));

    await alice.publishCrdtUpdate({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-1",
      updateId: "11111111-1111-4111-8111-111111111111",
      clientSequence: 1,
      update: encodedUpdate,
    });

    expect(ephemeral).toEqual([]);
    expect(durable).toEqual([
      expect.objectContaining({
        type: "update",
        update: expect.objectContaining({
          updateId: "11111111-1111-4111-8111-111111111111",
          update: encodedUpdate,
        }),
      }),
    ]);
    alice.close();
    bob.close();
  });

  it("round-trips a targeted state-vector sync response", async () => {
    const hub = new FakeBroadcastHub();
    const alice = makeTransport(hub, "alice");
    const bob = makeTransport(hub, "bob");
    await alice.connect();
    await bob.connect();
    const chunks = encodeStudioCrdtSyncChunks(new Uint8Array([7, 8, 9]));
    const response: StudioCrdtSyncResponse = {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-1",
      requestId: "request-1",
      transferId: "22222222-2222-4222-8222-222222222222",
      chunks,
      chunkCount: chunks.length,
      totalBytes: 3,
      serverStateVector: stateVector,
      serverSequence: "0",
    };
    bob.subscribeCrdt((message) => {
      if (message.type === "sync-request") {
        bob.respondCrdtSync(response, message.senderSessionId);
      }
    });

    await expect(
      alice.requestCrdtSync({
        protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
        workId: "work-1",
        requestId: "request-1",
        stateVector,
      })
    ).resolves.toEqual(response);
    alice.close();
    bob.close();
  });

  it("deduplicates a retried updateId at both sender and receiver", async () => {
    const hub = new FakeBroadcastHub();
    const alice = makeTransport(hub, "alice");
    const bob = makeTransport(hub, "bob");
    await alice.connect();
    await bob.connect();
    const received: StudioCrdtTransportMessage[] = [];
    bob.subscribeCrdt((message) => received.push(message));
    const request = {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-1",
      updateId: "33333333-3333-4333-8333-333333333333",
      clientSequence: 1,
      update: encodedUpdate,
    } as const;

    await expect(alice.publishCrdtUpdate(request)).resolves.toEqual(
      expect.objectContaining({ duplicate: false })
    );
    await expect(alice.publishCrdtUpdate(request)).resolves.toEqual(
      expect.objectContaining({ duplicate: true })
    );
    expect(received).toHaveLength(1);
    alice.close();
    bob.close();
  });

  it("routes negotiated binary ink frames to the ink lane only", async () => {
    const hub = new FakeBroadcastHub();
    const alice = makeTransport(hub, "alice");
    const bob = makeTransport(hub, "bob");
    await alice.connect();
    await bob.connect();
    const ephemeral: unknown[] = [];
    const durable: StudioCrdtTransportMessage[] = [];
    const ink: unknown[] = [];
    bob.subscribe((value) => ephemeral.push(value));
    bob.subscribeCrdt((message) => durable.push(message));
    bob.subscribeInk((value) => ink.push(value));

    expect(alice.binaryLaneCapabilities).toContain(STUDIO_LIVE_INK_CAPABILITY);
    const wire = createStudioLiveInkWireMessage({
      workId: "work-1",
      senderSessionId: "alice",
      sentAt: Date.now(),
      message: {
        kind: "ink:chunk",
        strokeId: "stroke-1",
        chunkSequence: 1,
        firstSampleIndex: 0,
        sampleCount: 2,
        payload: encodeStudioLiveInkSamples([
          { x: 1, y: 2, pressure: 0.5 },
          { x: 3, y: 4, pressure: 0.75 },
        ]),
      },
    });
    expect(alice.sendInk(wire)).toBe(true);

    expect(ephemeral).toEqual([]);
    expect(durable).toEqual([]);
    expect(ink).toHaveLength(1);
    expect(ink[0]).toMatchObject({ wire: "studio-live-ink", senderSessionId: "alice" });
    alice.close();
    bob.close();
  });

  it("fails closed on both sides when the ink-v2 lane was not negotiated", async () => {
    const hub = new FakeBroadcastHub();
    const capable = makeTransport(hub, "alice");
    const legacy = new StudioBroadcastChannelTransport(
      "channel-1",
      hub.create,
      {
        workId: "work-1",
        participant: { sessionId: "bob", displayName: "bob", role: "editor" },
      },
      { syncTimeoutMs: 100, inkLane: false }
    );
    await capable.connect();
    await legacy.connect();
    const legacyInk: unknown[] = [];
    const legacyEphemeral: unknown[] = [];
    legacy.subscribeInk((value) => legacyInk.push(value));
    legacy.subscribe((value) => legacyEphemeral.push(value));

    const wire: StudioLiveInkWireMessage = createStudioLiveInkWireMessage({
      workId: "work-1",
      senderSessionId: "alice",
      sentAt: Date.now(),
      message: {
        kind: "ink:begin",
        protocolVersion: STUDIO_LIVE_INK_PROTOCOL_VERSION,
        strokeId: "stroke-1",
        pageId: "page-1",
        layerId: "layer-1",
        coordinateSpaceId: "space-1",
        coordinateSpaceRevision: 0,
        provider: { providerId: "p", providerVersion: "1", buildHash: "h" },
        brushPresetId: "brush",
        brushContractHash: "hash",
        seed: 1,
        mode: "pen",
        blendMode: "normal",
        color: "#000000",
        width: 4,
        opacity: 1,
        sampleSchema: STUDIO_LIVE_INK_SAMPLE_SCHEMA,
        startedAt: Date.now(),
      },
    });
    expect(legacy.binaryLaneCapabilities).toEqual([]);
    expect(legacy.sendInk(wire)).toBe(false);
    // A capable sender's frame is dropped by the lane-less peer, never re-routed to JSON.
    expect(capable.sendInk(wire)).toBe(true);
    expect(legacyInk).toEqual([]);
    expect(legacyEphemeral).toEqual([]);
    capable.close();
    legacy.close();
  });

  it("drops cross-work durable frames before they reach a subscriber", async () => {
    const hub = new FakeBroadcastHub();
    const alice = makeTransport(hub, "alice", "work-2");
    const bob = makeTransport(hub, "bob", "work-1");
    await alice.connect();
    await bob.connect();
    const received: StudioCrdtTransportMessage[] = [];
    bob.subscribeCrdt((message) => received.push(message));

    await alice.publishCrdtUpdate({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-2",
      updateId: "44444444-4444-4444-8444-444444444444",
      clientSequence: 1,
      update: encodedUpdate,
    });
    expect(received).toEqual([]);
    alice.close();
    bob.close();
  });
});
