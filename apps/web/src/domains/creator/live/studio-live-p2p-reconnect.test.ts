import { afterEach, describe, expect, it } from "vitest";

import {
  createStudioCrdtLocalWireMessage,
  STUDIO_CRDT_PROTOCOL_VERSION,
  type StudioCrdtTransportMessage,
} from "./studio-crdt-protocol";
import {
  createStudioLiveEnvelope,
  type StudioLiveParticipant,
} from "./studio-live-collaboration-protocol";
import { STUDIO_LIVE_INK_CAPABILITY } from "./studio-live-ink-protocol";
import {
  applyStudioLiveP2pOverlay,
  STUDIO_LIVE_P2P_CAPS_WIRE,
  STUDIO_LIVE_P2P_CHANNEL_LABEL,
  type StudioLiveP2pRtcDataChannel,
  type StudioLiveP2pRtcPeerConnection,
} from "./studio-live-p2p-overlay-transport";

import type { StudioLiveTransport } from "./studio-live-collaboration-transport";

const NOW = Date.parse("2026-09-05T07:00:00.000Z");
const WORK_ID = "work-channel-reconnect";
const first: StudioLiveParticipant = {
  sessionId: "00000000-0000-4000-8000-000000000001", displayName: "First", role: "editor",
};
const second: StudioLiveParticipant = {
  sessionId: "00000000-0000-4000-8000-000000000002", displayName: "Second", role: "editor",
};
const activeTransports: StudioLiveTransport[] = [];

afterEach(() => {
  for (const transport of activeTransports.splice(0)) transport.close();
});

class Channel implements StudioLiveP2pRtcDataChannel {
  readonly label = STUDIO_LIVE_P2P_CHANNEL_LABEL;
  readonly ordered = true;
  readonly maxRetransmits = null;
  readonly maxPacketLifeTime = null;
  readonly bufferedAmount = 0;
  readyState = "connecting";
  binaryType?: string;
  onopen: StudioLiveP2pRtcDataChannel["onopen"] = null;
  onclose: StudioLiveP2pRtcDataChannel["onclose"] = null;
  onmessage: StudioLiveP2pRtcDataChannel["onmessage"] = null;
  readonly sent: Array<string | ArrayBuffer> = [];

  send(data: string | ArrayBuffer): void {
    if (this.readyState !== "open") throw new Error("closed RTC channel");
    this.sent.push(data);
  }
  close(): void {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.onclose?.(new Event("close"));
  }
  open(): void {
    this.readyState = "open";
    this.onopen?.(new Event("open"));
    this.receive(JSON.stringify({ wire: STUDIO_LIVE_P2P_CAPS_WIRE, binaryLanes: [STUDIO_LIVE_INK_CAPABILITY] }));
  }
  receive(data: string): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}

class Connection implements StudioLiveP2pRtcPeerConnection {
  connectionState = "new";
  readonly channel = new Channel();
  readonly sctp = { maxMessageSize: 0 };
  closed = false;
  offer: Promise<RTCSessionDescriptionInit> | null = null;
  onicecandidate: StudioLiveP2pRtcPeerConnection["onicecandidate"] = null;
  ondatachannel: StudioLiveP2pRtcPeerConnection["ondatachannel"] = null;
  onconnectionstatechange: (() => void) | null = null;

  createDataChannel(): Channel { return this.channel; }
  createOffer(): Promise<RTCSessionDescriptionInit> {
    return this.offer ?? Promise.resolve({ type: "offer", sdp: "test-offer" });
  }
  async createAnswer(): Promise<RTCSessionDescriptionInit> { return { type: "answer", sdp: "test-answer" }; }
  async setLocalDescription(): Promise<void> { return; }
  async setRemoteDescription(): Promise<void> { return; }
  async addIceCandidate(): Promise<void> { return; }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.connectionState = "closed";
    this.channel.close();
    this.onconnectionstatechange?.();
  }
  receiveChannel(channel = this.channel): Channel {
    this.ondatachannel?.({ channel });
    channel.open();
    return channel;
  }
}

async function fixture(options: { offerer?: boolean; firstOffer?: Promise<RTCSessionDescriptionInit> } = {}) {
  const self = options.offerer ? first : second;
  const peer = options.offerer ? second : first;
  const listeners = new Set<(value: unknown) => void>();
  const connections: Connection[] = [];
  const primary: StudioLiveTransport = {
    mode: "server", crdtFanout: "mesh", ready: true,
    connect: async () => undefined,
    send: () => true,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => listeners.clear(),
  };
  const transport = applyStudioLiveP2pOverlay(() => primary, {
    now: () => NOW,
    createPeerConnection: () => {
      const connection = new Connection();
      if (connections.length === 0) connection.offer = options.firstOffer ?? null;
      connections.push(connection);
      return connection;
    },
  })({ workId: WORK_ID, roomName: WORK_ID, participant: self });
  activeTransports.push(transport);
  await transport.connect();
  const announce = () => {
    const envelope = createStudioLiveEnvelope({
      workId: WORK_ID, sender: peer, sentAt: NOW, sequence: 1,
      kind: "presence:heartbeat", payload: { visibility: "active", pageId: "page-1", tool: "pen" },
    });
    for (const listener of listeners) listener(envelope);
  };
  announce();
  return { transport, primary, connections, peer, announce };
}

function documentFrame(peer: StudioLiveParticipant): string {
  return JSON.stringify(createStudioCrdtLocalWireMessage({
    workId: WORK_ID, senderSessionId: peer.sessionId, targetSessionId: null, kind: "update",
    payload: {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION, workId: WORK_ID,
      updateId: "00000000-0000-4000-8000-000000000096", serverSequence: "0", update: "AAAA",
    },
  }));
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe("P2P channel reconnect integration", () => {
  it("recreates the peer after channel-only closure and receives fresh document updates", async () => {
    const test = await fixture();
    const firstConnection = test.connections[0]!;
    const old = firstConnection.receiveChannel();
    expect(test.transport.binaryLaneCapabilities).toContain(STUDIO_LIVE_INK_CAPABILITY);
    old.close();
    expect(test.primary.ready).toBe(true);
    expect(firstConnection.closed).toBe(true);
    expect(test.transport.binaryLaneCapabilities).toEqual([]);
    test.announce();
    expect(test.connections).toHaveLength(2);
    const fresh = test.connections[1]!.receiveChannel();
    const received: StudioCrdtTransportMessage[] = [];
    test.transport.subscribeCrdt?.((message) => received.push(message));
    fresh.receive(documentFrame(test.peer));
    expect(test.transport.binaryLaneCapabilities).toContain(STUDIO_LIVE_INK_CAPABILITY);
    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe("update");
  });

  it("ignores a document message already queued when its channel closes", async () => {
    const test = await fixture();
    const channel = test.connections[0]!.receiveChannel();
    const queuedMessage = channel.onmessage!;
    const received: StudioCrdtTransportMessage[] = [];
    test.transport.subscribeCrdt?.((message) => received.push(message));
    channel.close();
    queuedMessage({ data: documentFrame(test.peer) } as MessageEvent<unknown>);
    expect(received).toEqual([]);
  });

  it("rejects replaced-channel messages without closing the current peer", async () => {
    const test = await fixture();
    const connection = test.connections[0]!;
    const previous = connection.receiveChannel();
    const queuedMessage = previous.onmessage!;
    const queuedClose = previous.onclose!;
    const current = connection.receiveChannel(new Channel());
    const received: StudioCrdtTransportMessage[] = [];
    test.transport.subscribeCrdt?.((message) => received.push(message));
    queuedClose(new Event("close"));
    queuedMessage({ data: documentFrame(test.peer) } as MessageEvent<unknown>);
    expect(connection.closed).toBe(false);
    expect(received).toEqual([]);
    current.receive(documentFrame(test.peer));
    expect(received).toHaveLength(1);
  });

  it("does not let a retired offer rejection tear down its replacement", async () => {
    let rejectOffer!: (error: Error) => void;
    const firstOffer = new Promise<RTCSessionDescriptionInit>((_resolve, reject) => { rejectOffer = reject; });
    const test = await fixture({ offerer: true, firstOffer });
    test.connections[0]!.channel.close();
    test.announce();
    expect(test.connections).toHaveLength(2);
    rejectOffer(new Error("old offer failed after reconnect"));
    await flushMicrotasks();
    expect(test.connections[1]!.closed).toBe(false);
  });
});
