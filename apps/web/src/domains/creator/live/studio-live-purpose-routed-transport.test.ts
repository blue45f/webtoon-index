import { describe, expect, it, vi } from "vitest";

import { STUDIO_SCREEN_SHARE_DISCOVERY_ID } from "../studio-screen-share";

import {
  STUDIO_CRDT_PROTOCOL_VERSION,
  type StudioCrdtSyncRequest,
  type StudioCrdtSyncResponse,
  type StudioCrdtTransportMessage,
  type StudioCrdtUpdateAck,
  type StudioCrdtUpdateRequest,
} from "./studio-crdt-protocol";
import {
  createStudioLiveEnvelope,
  type StudioLiveEnvelope,
  type StudioLiveMessageKind,
  type StudioLiveParticipant,
  type StudioLivePayloadMap,
} from "./studio-live-collaboration-protocol";
import { encodeStudioLiveInkSamples } from "./studio-live-ink-codec";
import {
  createStudioLiveInkWireMessage,
  STUDIO_LIVE_INK_CAPABILITY,
  type StudioLiveInkWireMessage,
} from "./studio-live-ink-protocol";
import {
  createStudioPurposeRoutedLiveTransportFactory,
  type StudioPurposeRoutedLiveTransportFactoryOptions,
} from "./studio-live-purpose-routed-transport";
import {
  applyStudioRealtimePurposeRouting,
} from "./studio-live-socket-transport";

import type {
  StudioLiveTransport,
  StudioLiveTransportContext,
  StudioLiveTransportControlEvent,
  StudioLiveTransportFactory,
} from "./studio-live-collaboration-transport";
import type { StudioLiveGesturePreviewPayload } from "./studio-live-gesture-preview";
import type {
  StudioRealtimeInboundEvent,
  StudioRealtimeOutboundEvent,
  StudioRealtimePublishAck,
  StudioRealtimeWorkload,
} from "../studio-realtime-provider-protocol";
import type {
  StudioRealtimeWorkloadStatus,
} from "../studio-realtime-workload-coordinator";

const NOW = Date.parse("2026-07-31T05:00:00.000Z");
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
const CONTEXT: StudioLiveTransportContext = {
  workId: "work-1",
  roomName: "room-1",
  participant: LOCAL,
};

class FakePrimaryTransport implements StudioLiveTransport {
  readonly mode = "server" as const;
  readonly sent: StudioLiveEnvelope[] = [];
  readonly sentInk: StudioLiveInkWireMessage[] = [];
  readonly binaryLaneCapabilities?: readonly string[];
  readonly sendInk?: (message: StudioLiveInkWireMessage) => boolean;
  readonly subscribeInk?: (listener: (value: unknown) => void) => () => void;
  readonly acquireLock = vi.fn(async () => ({
    status: "timeout" as const,
    resource: "page:1",
    requestId: "request-1",
    message: "test",
  }));
  readonly releaseLock = vi.fn(async () => ({
    status: "released" as const,
    resource: "page:1",
    requestId: "request-1",
    claimId: "claim-1",
    released: true,
  }));
  readonly requestCrdtSync = vi.fn(
    async (_request: StudioCrdtSyncRequest): Promise<StudioCrdtSyncResponse | null> =>
      null,
  );
  readonly respondCrdtSync = vi.fn(
    (_response: StudioCrdtSyncResponse, _targetSessionId: string) => true,
  );
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
  private readonly listeners = new Set<(value: unknown) => void>();
  private readonly controlListeners = new Set<
    (event: StudioLiveTransportControlEvent) => void
  >();
  private readonly crdtListeners = new Set<
    (message: StudioCrdtTransportMessage) => void
  >();
  private readonly inkListeners = new Set<(value: unknown) => void>();
  ready = false;
  closed = false;

  constructor(inkLane = true) {
    if (!inkLane) return;
    this.binaryLaneCapabilities = [STUDIO_LIVE_INK_CAPABILITY];
    this.sendInk = (message: StudioLiveInkWireMessage) => {
      if (!this.ready || this.closed) return false;
      this.sentInk.push(message);
      return true;
    };
    this.subscribeInk = (listener: (value: unknown) => void) => {
      this.inkListeners.add(listener);
      return () => this.inkListeners.delete(listener);
    };
  }

  async connect(): Promise<void> {
    this.ready = true;
  }

  emitInk(value: unknown): void {
    for (const listener of this.inkListeners) listener(value);
  }

  send(envelope: StudioLiveEnvelope): boolean {
    if (!this.ready || this.closed) return false;
    this.sent.push(envelope);
    return true;
  }

  subscribe(listener: (value: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeControl(
    listener: (event: StudioLiveTransportControlEvent) => void,
  ): () => void {
    this.controlListeners.add(listener);
    return () => this.controlListeners.delete(listener);
  }

  subscribeCrdt(
    listener: (message: StudioCrdtTransportMessage) => void,
  ): () => void {
    this.crdtListeners.add(listener);
    return () => this.crdtListeners.delete(listener);
  }

  emit(value: unknown): void {
    for (const listener of this.listeners) listener(value);
  }

  emitControl(event: StudioLiveTransportControlEvent): void {
    for (const listener of this.controlListeners) listener(event);
  }

  close(): void {
    this.closed = true;
    this.ready = false;
  }
}

class FakeCoordinator {
  readonly published: StudioRealtimeOutboundEvent[] = [];
  readonly ready = new Set<StudioRealtimeWorkload>();
  private readonly eventListeners = new Set<
    (event: StudioRealtimeInboundEvent) => void
  >();
  private readonly statusListeners = new Set<
    (status: StudioRealtimeWorkloadStatus) => void
  >();
  failPublish = false;
  disposed = false;

  async connect(): Promise<readonly PromiseSettledResult<never>[]> {
    return [];
  }

  isReady(workload: StudioRealtimeWorkload): boolean {
    return this.ready.has(workload);
  }

  async publish(
    event: StudioRealtimeOutboundEvent,
  ): Promise<StudioRealtimePublishAck> {
    if (this.failPublish) throw new Error("provider down");
    this.published.push(event);
    return {
      version: 1,
      providerId: "test-provider",
      providerSessionId: "test-provider-session",
      scope: event.scope,
      workload: event.workload,
      eventId: event.eventId,
      idempotencyKey: event.idempotencyKey,
      clientSequence: event.clientSequence,
      serverSequence: event.clientSequence,
      duplicate: false,
    };
  }

  subscribe(
    listener: (event: StudioRealtimeInboundEvent) => void,
  ): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  subscribeStatus(
    listener: (status: StudioRealtimeWorkloadStatus) => void,
  ): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  setReady(workload: StudioRealtimeWorkload): void {
    this.ready.add(workload);
    const update: StudioRealtimeWorkloadStatus = {
      routeId: "test-route",
      workload,
      status: { state: "ready", providerId: "test-provider", attempt: 1 },
    };
    for (const listener of this.statusListeners) listener(update);
  }

  emit(event: StudioRealtimeInboundEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

function envelope<Kind extends StudioLiveMessageKind>(input: {
  readonly kind: Kind;
  readonly payload: StudioLivePayloadMap[Kind];
  readonly sender?: StudioLiveParticipant;
  readonly sequence?: number;
  readonly targetSessionId?: string | null;
}): StudioLiveEnvelope<Kind> {
  return createStudioLiveEnvelope({
    workId: CONTEXT.workId,
    sender: input.sender ?? LOCAL,
    sentAt: NOW,
    sequence: input.sequence ?? 1,
    kind: input.kind,
    targetSessionId: input.targetSessionId,
    payload: input.payload,
  });
}

function gesturePreview(): StudioLiveGesturePreviewPayload {
  return {
    version: 1,
    gestureId: "gesture-primary-1",
    pageId: "page-1",
    seq: 1,
    phase: "begin",
    operation: "draw",
    base: { documentGeneration: 1 },
    renderer: {
      kind: "freehand",
      mode: "pen",
      stroke: "#224466",
      strokeWidth: 6,
    },
    samples: { startIndex: 0, points: [4, 8] },
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function harness(
  overrides: Partial<StudioPurposeRoutedLiveTransportFactoryOptions> = {},
  primary = new FakePrimaryTransport(),
) {
  const coordinator = new FakeCoordinator();
  let id = 0;
  const factory = createStudioPurposeRoutedLiveTransportFactory({
    primaryFactory: () => primary,
    createCoordinator: () => coordinator,
    resolveRoomId: () => "ephemeral-room",
    randomId: () =>
      `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    now: () => NOW,
    ...overrides,
  });
  return { primary, coordinator, transport: factory(CONTEXT) };
}

describe("Studio purpose-routed live transport", () => {
  it("routes only presence and screen signaling while CRDT, locks, and chat stay primary", async () => {
    const { primary, coordinator, transport } = harness();
    await transport.connect();
    coordinator.setReady("presence");
    coordinator.setReady("comments");
    coordinator.setReady("screen-signaling");

    expect(
      transport.send(
        envelope({
          kind: "presence:heartbeat",
          payload: { visibility: "active", pageId: "page-1", tool: "pen" },
        }),
      ),
    ).toBe(true);
    expect(
      transport.send(
        envelope({
          kind: "screen:announce",
          payload: { shareId: "share-1", label: "작업 화면" },
          sequence: 2,
        }),
      ),
    ).toBe(true);
    const chat = envelope({
      kind: "chat:message",
      payload: {
        messageId: "00000000-0000-4000-8000-000000000020",
        text: "검토 부탁해요",
      },
      sequence: 3,
    });
    expect(transport.send(chat)).toBe(true);
    await flushPromises();

    expect(coordinator.published.map((event) => event.kind)).toEqual([
      "presence.upsert",
      "screen.announce",
    ]);
    expect(coordinator.published[0]?.scope).toEqual({
      workId: "work-1",
      roomId: "ephemeral-room",
    });
    expect(primary.sent).toEqual([chat]);

    const syncRequest = {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-1",
      requestId: "00000000-0000-4000-8000-000000000030",
      stateVector: "",
    };
    await transport.requestCrdtSync?.(syncRequest);
    await transport.acquireLock?.({
      resource: "page:1",
      requestId: "00000000-0000-4000-8000-000000000031",
      leaseMs: 1_000,
    });
    expect(primary.requestCrdtSync).toHaveBeenCalledOnce();
    expect(primary.acquireLock).toHaveBeenCalledOnce();
  });

  it("keeps gesture previews on primary without expanding provider workloads", async () => {
    const { primary, coordinator, transport } = harness();
    await transport.connect();
    coordinator.setReady("presence");
    coordinator.setReady("comments");
    coordinator.setReady("screen-signaling");
    const preview = envelope({
      kind: "preview:gesture",
      payload: gesturePreview(),
    });

    expect(transport.send(preview)).toBe(true);
    await flushPromises();

    expect(primary.sent).toEqual([preview]);
    expect(coordinator.published).toEqual([]);
  });

  it("falls back to the primary transport when a route is unavailable or publishing fails", async () => {
    const { primary, coordinator, transport } = harness();
    await transport.connect();
    const cursor = envelope({
      kind: "cursor:update",
      payload: {
        x: 0.1,
        y: 0.2,
        pageId: "page-1",
        tool: "g-pen",
        drawing: true,
        strokeColor: "#112233",
        strokeWidth: 7,
        strokeOpacity: 0.8,
        points: [1, 2, 3, 4],
      },
    });
    expect(transport.send(cursor)).toBe(true);
    expect(primary.sent).toEqual([cursor]);

    coordinator.setReady("screen-signaling");
    coordinator.failPublish = true;
    const announce = envelope({
      kind: "screen:announce",
      payload: { shareId: "share-2", label: "콘티" },
      sequence: 2,
    });
    expect(transport.send(announce)).toBe(true);
    await flushPromises();
    expect(primary.sent).toEqual([cursor, announce]);
  });

  it("keeps screen-share discovery on the primary authority transport", async () => {
    const { primary, coordinator, transport } = harness();
    await transport.connect();
    coordinator.setReady("screen-signaling");
    const discovery = envelope({
      sender: LOCAL,
      kind: "screen:request",
      targetSessionId: REMOTE.sessionId,
      payload: { shareId: STUDIO_SCREEN_SHARE_DISCOVERY_ID },
    });

    expect(transport.send(discovery)).toBe(true);
    await flushPromises();

    expect(primary.sent).toEqual([discovery]);
    expect(coordinator.published).toEqual([]);
  });

  it("maps provider presence, cursor, comment invalidation, and screen events back to Studio", async () => {
    const { primary, coordinator, transport } = harness();
    const received: StudioLiveEnvelope[] = [];
    const controls: StudioLiveTransportControlEvent[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));
    transport.subscribeControl?.((event) => controls.push(event));
    await transport.connect();
    coordinator.setReady("presence");
    coordinator.setReady("comments");
    coordinator.setReady("screen-signaling");

    coordinator.emit({
      version: 1,
      scope: { workId: "work-1", roomId: "ephemeral-room" },
      workload: "presence",
      kind: "presence.upsert",
      eventId: "00000000-0000-4000-8000-000000000041",
      idempotencyKey: "00000000-0000-4000-8000-000000000042",
      serverSequence: "1",
      sentAt: new Date(NOW).toISOString(),
      senderSessionId: REMOTE.sessionId,
      targetSessionId: null,
      payload: {
        participant: {
          ...REMOTE,
          state: "active",
          pageId: "page-1",
          tool: "pen",
          updatedAt: new Date(NOW).toISOString(),
        },
      },
    });
    coordinator.emit({
      version: 1,
      scope: { workId: "work-1", roomId: "ephemeral-room" },
      workload: "presence",
      kind: "presence.cursor",
      eventId: "00000000-0000-4000-8000-000000000043",
      idempotencyKey: "00000000-0000-4000-8000-000000000044",
      serverSequence: "2",
      sentAt: new Date(NOW).toISOString(),
      senderSessionId: REMOTE.sessionId,
      targetSessionId: null,
      payload: {
        x: 0.31,
        y: 0.42,
        pageId: "page-1",
        tool: "chalk",
        drawing: true,
        strokeColor: "#abcdef",
        strokeWidth: 12,
        strokeOpacity: 0.7,
        points: [1, 2, 3, 4],
      },
    });
    coordinator.emit({
      version: 1,
      scope: { workId: "work-1", roomId: "ephemeral-room" },
      workload: "comments",
      kind: "comments.changed",
      eventId: "00000000-0000-4000-8000-000000000045",
      idempotencyKey: "00000000-0000-4000-8000-000000000046",
      serverSequence: "1",
      sentAt: new Date(NOW).toISOString(),
      senderSessionId: REMOTE.sessionId,
      targetSessionId: null,
      payload: {
        threadId: "thread-1",
        activitySequence: "9",
        change: "replied",
      },
    });
    coordinator.emit({
      version: 1,
      scope: { workId: "work-1", roomId: "ephemeral-room" },
      workload: "screen-signaling",
      kind: "screen.request",
      eventId: "00000000-0000-4000-8000-000000000047",
      idempotencyKey: "00000000-0000-4000-8000-000000000048",
      serverSequence: "1",
      sentAt: new Date(NOW).toISOString(),
      senderSessionId: REMOTE.sessionId,
      targetSessionId: LOCAL.sessionId,
      payload: { shareId: "share-1" },
    });

    expect(received.map((event) => event.kind)).toEqual([
      "presence:heartbeat",
      "cursor:update",
      "screen:request",
    ]);
    expect(received[1]?.payload).toMatchObject({
      drawing: true,
      strokeColor: "#abcdef",
      strokeWidth: 12,
      strokeOpacity: 0.7,
      points: [1, 2, 3, 4],
    });
    expect(controls).toContainEqual({
      type: "comment-changed",
      change: {
        version: 1,
        workId: "work-1",
        threadId: "thread-1",
        activitySequence: "9",
        kind: "replied",
      },
    });

    const duplicatePrimaryPresence = envelope({
      sender: REMOTE,
      kind: "presence:heartbeat",
      payload: { visibility: "active", pageId: "page-1", tool: "pen" },
    });
    primary.emit(duplicatePrimaryPresence);
    expect(received).toHaveLength(3);
  });

  it("consumes one cross-path duplicate without suppressing later heartbeats", async () => {
    let clock = NOW;
    const { primary, coordinator, transport } = harness({
      now: () => clock,
    });
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));
    await transport.connect();
    coordinator.setReady("presence");
    const providerHeartbeat = (sequence: string, suffix: string) =>
      coordinator.emit({
        version: 1,
        scope: { workId: "work-1", roomId: "ephemeral-room" },
        workload: "presence",
        kind: "presence.upsert",
        eventId: `00000000-0000-4000-8000-0000000001${suffix}`,
        idempotencyKey: `00000000-0000-4000-8000-0000000002${suffix}`,
        serverSequence: sequence,
        sentAt: new Date(clock).toISOString(),
        senderSessionId: REMOTE.sessionId,
        targetSessionId: null,
        payload: {
          participant: {
            ...REMOTE,
            state: "active",
            pageId: "page-1",
            tool: "pen",
            updatedAt: new Date(clock).toISOString(),
          },
        },
      });
    const primaryHeartbeat = () =>
      primary.emit(
        envelope({
          sender: REMOTE,
          kind: "presence:heartbeat",
          payload: {
            visibility: "active",
            pageId: "page-1",
            tool: "pen",
          },
        }),
      );

    providerHeartbeat("1", "01");
    clock += 8;
    primaryHeartbeat();
    clock += 2;
    providerHeartbeat("2", "02");
    clock += 8;
    primaryHeartbeat();
    clock += 1;
    providerHeartbeat("3", "03");
    providerHeartbeat("4", "04");

    expect(received.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(received.every((event) => event.kind === "presence:heartbeat")).toBe(
      true,
    );
  });

  it("records visually deduplicated primary presence before provider removal", async () => {
    const { primary, coordinator, transport } = harness();
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));
    await transport.connect();
    coordinator.setReady("presence");
    coordinator.emit({
      version: 1,
      scope: { workId: "work-1", roomId: "ephemeral-room" },
      workload: "presence",
      kind: "presence.upsert",
      eventId: "00000000-0000-4000-8000-000000000131",
      idempotencyKey: "00000000-0000-4000-8000-000000000132",
      serverSequence: "1",
      sentAt: new Date(NOW).toISOString(),
      senderSessionId: REMOTE.sessionId,
      targetSessionId: null,
      payload: {
        participant: {
          ...REMOTE,
          state: "active",
          pageId: "page-1",
          tool: "pen",
          updatedAt: new Date(NOW).toISOString(),
        },
      },
    });
    primary.emit(
      envelope({
        sender: REMOTE,
        kind: "presence:heartbeat",
        payload: {
          visibility: "active",
          pageId: "page-1",
          tool: "pen",
        },
      }),
    );
    coordinator.emit({
      version: 1,
      scope: { workId: "work-1", roomId: "ephemeral-room" },
      workload: "presence",
      kind: "presence.remove",
      eventId: "00000000-0000-4000-8000-000000000133",
      idempotencyKey: "00000000-0000-4000-8000-000000000134",
      serverSequence: "2",
      sentAt: new Date(NOW).toISOString(),
      senderSessionId: REMOTE.sessionId,
      targetSessionId: null,
      payload: { sessionId: REMOTE.sessionId, reason: "left" },
    });
    expect(received.map((event) => event.kind)).toEqual([
      "presence:heartbeat",
    ]);

    primary.emit(
      envelope({
        sender: REMOTE,
        kind: "presence:leave",
        payload: {},
      }),
    );
    expect(received.map((event) => event.kind)).toEqual([
      "presence:heartbeat",
      "presence:leave",
    ]);
    expect(received.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("assigns one contiguous sequence across primary and provider message kinds", async () => {
    const { primary, coordinator, transport } = harness();
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));
    await transport.connect();
    coordinator.setReady("presence");
    coordinator.setReady("screen-signaling");

    primary.emit(
      envelope({
        sender: REMOTE,
        kind: "chat:message",
        payload: {
          messageId: "00000000-0000-4000-8000-000000000141",
          text: "확인 부탁해요",
        },
      }),
    );
    coordinator.emit({
      version: 1,
      scope: { workId: "work-1", roomId: "ephemeral-room" },
      workload: "presence",
      kind: "presence.upsert",
      eventId: "00000000-0000-4000-8000-000000000142",
      idempotencyKey: "00000000-0000-4000-8000-000000000143",
      serverSequence: "1",
      sentAt: new Date(NOW).toISOString(),
      senderSessionId: REMOTE.sessionId,
      targetSessionId: null,
      payload: {
        participant: {
          ...REMOTE,
          state: "active",
          pageId: "page-1",
          tool: "pen",
          updatedAt: new Date(NOW).toISOString(),
        },
      },
    });
    primary.emit(
      envelope({
        sender: REMOTE,
        kind: "voice:join",
        payload: { callId: "voice-room-1", muted: false },
      }),
    );
    coordinator.emit({
      version: 1,
      scope: { workId: "work-1", roomId: "ephemeral-room" },
      workload: "screen-signaling",
      kind: "screen.announce",
      eventId: "00000000-0000-4000-8000-000000000144",
      idempotencyKey: "00000000-0000-4000-8000-000000000145",
      serverSequence: "1",
      sentAt: new Date(NOW).toISOString(),
      senderSessionId: REMOTE.sessionId,
      targetSessionId: null,
      payload: { shareId: "share-sequence", label: "작업 화면" },
    });

    expect(received.map((event) => event.kind)).toEqual([
      "chat:message",
      "presence:heartbeat",
      "voice:join",
      "screen:announce",
    ]);
    expect(received.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
  });

  it("is default-off and accepts only an exact HTTPS worker origin and canonical provider id", () => {
    const primaryFactory: StudioLiveTransportFactory = () =>
      new FakePrimaryTransport();
    expect(
      applyStudioRealtimePurposeRouting(primaryFactory, {}),
    ).toBe(primaryFactory);
    expect(
      applyStudioRealtimePurposeRouting(primaryFactory, {
        realtimeOrigin: "http://worker.example.com",
      }),
    ).toBe(primaryFactory);
    expect(
      applyStudioRealtimePurposeRouting(primaryFactory, {
        realtimeOrigin: "https://worker.example.com/v1",
      }),
    ).toBe(primaryFactory);
    expect(
      applyStudioRealtimePurposeRouting(primaryFactory, {
        realtimeOrigin: "https://worker.example.com",
        providerId: "invalid provider",
      }),
    ).toBe(primaryFactory);

    const routed = applyStudioRealtimePurposeRouting(
      primaryFactory,
      {
        realtimeOrigin: "https://worker.example.com",
        providerId: "cloudflare-realtime-v1",
      },
    );
    expect(routed).not.toBe(primaryFactory);
    expect(routed(CONTEXT).mode).toBe("server");
  });

  it("keeps the binary ink lane on the primary authority route", async () => {
    const { primary, coordinator, transport } = harness();
    await transport.connect();
    coordinator.setReady("presence");
    coordinator.setReady("comments");
    coordinator.setReady("screen-signaling");

    expect(transport.binaryLaneCapabilities).toContain(STUDIO_LIVE_INK_CAPABILITY);
    const wire = createStudioLiveInkWireMessage({
      workId: CONTEXT.workId,
      senderSessionId: LOCAL.sessionId,
      sentAt: NOW,
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
    expect(transport.sendInk?.(wire)).toBe(true);
    await flushPromises();

    // Binary frames never widen the provider workloads — the coordinator saw nothing.
    expect(primary.sentInk).toEqual([wire]);
    expect(coordinator.published).toEqual([]);

    const receivedInk: unknown[] = [];
    transport.subscribeInk?.((value) => receivedInk.push(value));
    const inbound = { wire: "studio-live-ink", senderSessionId: REMOTE.sessionId };
    primary.emitInk(inbound);
    expect(receivedInk).toEqual([inbound]);
  });

  it("refuses ink sends while the route is not ready", async () => {
    const { primary, transport } = harness();
    const wire = createStudioLiveInkWireMessage({
      workId: CONTEXT.workId,
      senderSessionId: LOCAL.sessionId,
      sentAt: NOW,
      message: { kind: "ink:cancel", strokeId: "stroke-1", reason: "user" },
    });

    expect(transport.sendInk?.(wire)).toBe(false);
    expect(primary.sentInk).toEqual([]);
  });

  it("fails closed when the authority transport negotiated no ink lane", async () => {
    const { transport } = harness({}, new FakePrimaryTransport(false));
    await transport.connect();

    // The lane surface is masked outright so publishers cannot even attempt binary traffic.
    expect(transport.binaryLaneCapabilities).toBeUndefined();
    expect(transport.sendInk).toBeUndefined();
    expect(transport.subscribeInk).toBeUndefined();
  });
});
