import { describe, expect, it, vi } from "vitest";

import {
  REALTIME_PROTOCOL_VERSION,
  REALTIME_TICKET_PROTOCOL_PREFIX,
  REALTIME_WEBSOCKET_PROTOCOL,
  type RealtimeChannel,
  type ServerEventMessage,
} from "../../../../../deploy/cloudflare-realtime/src/protocol";

import {
  createStudioCloudflareRealtimeAdapterFactory,
  studioCloudflareRealtimeRoomUrl,
  type StudioCloudflareRealtimeWebSocketLike,
} from "./studio-realtime-provider-cloudflare-adapter";
import { StudioRealtimeProviderSession } from "./studio-realtime-provider-runtime";

import type {
  StudioRealtimeCapability,
  StudioRealtimeConnectionRequest,
  StudioRealtimeInboundEvent,
  StudioRealtimeOutboundEvent,
  StudioRealtimeWorkload,
} from "./studio-realtime-provider-protocol";

class FakeWebSocket implements StudioCloudflareRealtimeWebSocketLike {
  readyState = 0;
  protocol = "";
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Set<(event: never) => void>>();

  send(data: string): void {
    if (this.readyState !== 1) throw new Error("not open");
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close", { code, reason });
  }

  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: never) => void,
  ): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: never) => void,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  open(protocol: string = REALTIME_WEBSOCKET_PROTOCOL): void {
    this.readyState = 1;
    this.protocol = protocol;
    this.emit("open", {});
  }

  receive(value: unknown): void {
    this.emit("message", { data: JSON.stringify(value) });
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event as never);
    }
  }
}

const scope = { workId: "work-1", roomId: "room-1" } as const;
const LOCAL_SESSION = "00000000-0000-4000-8000-000000000001";
const REMOTE_SESSION = "00000000-0000-4000-8000-000000000002";
const SECOND_VIEWER = "00000000-0000-4000-8000-000000000003";
const SHARE_ID = "00000000-0000-4000-8000-000000000010";

const capabilitiesByWorkload = {
  presence: [
    "presence.snapshot-v1",
    "presence.members-v1",
    "presence.cursor-v1",
    "presence.resume-v1",
  ],
  comments: [
    "comments.invalidation-v1",
    "comments.resume-v1",
  ],
  "screen-signaling": [
    "screen-signaling.session-v1",
    "screen-signaling.webrtc-v1",
    "screen-signaling.resume-v1",
  ],
} as const satisfies Record<
  StudioRealtimeWorkload,
  readonly StudioRealtimeCapability[]
>;

function request(
  workloads: readonly StudioRealtimeWorkload[] = ["presence"],
  resume: StudioRealtimeConnectionRequest["resume"] = [],
): StudioRealtimeConnectionRequest {
  return {
    version: 1,
    clientInstanceId: LOCAL_SESSION,
    sessionId: LOCAL_SESSION,
    scope,
    requiredWorkloads: [...workloads],
    requiredCapabilities: workloads.flatMap(
      (workload) => capabilitiesByWorkload[workload],
    ),
    resume,
  };
}

function welcome(
  scopes: readonly RealtimeChannel[],
  sequences: Partial<Record<RealtimeChannel, number>> = {},
  connectionId = "connection-1",
) {
  const state = (channel: RealtimeChannel) => ({
    currentSequence: sequences[channel] ?? 0,
    replayFloorSequence: 1,
  });
  return {
    version: REALTIME_PROTOCOL_VERSION,
    type: "welcome",
    workId: scope.workId,
    roomId: scope.roomId,
    connectionId,
    actorId: "actor-1",
    clientId: LOCAL_SESSION,
    scopes,
    channelStates: {
      presence: state("presence"),
      comments: state("comments"),
      "screen-signaling": state("screen-signaling"),
    },
    sessionExpiresAtMs: 1_900_000_000_000,
  } as const;
}

function presenceSnapshot(
  sequence = 0,
  entries: readonly {
    connectionId: string;
    actorId: string;
    clientId: string;
    update: {
      kind: "presence.update";
      pageId: string | null;
      profile: {
        displayName: string;
        role: "owner" | "admin" | "editor" | "commenter" | "viewer";
        state: "active" | "idle" | "away";
      };
      tool: string | null;
    } | null;
    cursor: null;
  }[] = [],
) {
  return {
    version: REALTIME_PROTOCOL_VERSION,
    type: "presence-snapshot",
    channel: "presence",
    sequence,
    snapshotId: `snapshot-${sequence}`,
    page: 0,
    complete: true,
    generatedAtMs: Date.parse("2026-07-31T00:00:00.000Z"),
    entries,
  } as const;
}

function replay(
  channel: RealtimeChannel,
  currentSequence: number,
  afterSequence: number,
  events: readonly ServerEventMessage[] = [],
) {
  return {
    version: REALTIME_PROTOCOL_VERSION,
    type: "replay",
    channel,
    fromSequence: afterSequence + 1,
    toSequence: currentSequence,
    currentSequence,
    complete: true,
    events,
  } as const;
}

function serverEvent(
  input: Pick<ServerEventMessage, "channel" | "payload"> & {
    sequence: number;
    clientId?: string;
    connectionId?: string;
    actorId?: string;
  },
): ServerEventMessage {
  return {
    version: REALTIME_PROTOCOL_VERSION,
    type: "event",
    sequence: input.sequence,
    idempotencyKey: `worker-event-${input.channel}-${input.sequence}`,
    actorId: input.actorId ?? "actor-2",
    clientId: input.clientId ?? REMOTE_SESSION,
    connectionId: input.connectionId ?? "connection-2",
    channel: input.channel,
    serverAtMs: Date.parse("2026-07-31T00:00:01.000Z"),
    payload: input.payload,
  };
}

async function finishPresenceHandshake(
  socket: FakeWebSocket,
  sequence = 0,
  entries: Parameters<typeof presenceSnapshot>[1] = [],
): Promise<void> {
  socket.receive(presenceSnapshot(sequence, entries));
  socket.receive(replay("presence", sequence, sequence));
  await Promise.resolve();
}

function upsertEvent(): StudioRealtimeOutboundEvent {
  return {
    version: 1,
    scope,
    workload: "presence",
    kind: "presence.upsert",
    eventId: "00000000-0000-4000-8000-000000000101",
    idempotencyKey: "00000000-0000-4000-8000-000000000102",
    clientSequence: "1",
    sentAt: "2026-07-31T00:00:00.000Z",
    senderSessionId: LOCAL_SESSION,
    targetSessionId: null,
    payload: {
      participant: {
        sessionId: LOCAL_SESSION,
        displayName: "작가 1",
        role: "editor",
        state: "active",
        pageId: "page-1",
        tool: "g-pen",
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
    },
  };
}

describe("Cloudflare realtime provider adapter", () => {
  it("waits for presence snapshot and replay, then maps publish/ack/live events", async () => {
    const socket = new FakeWebSocket();
    const createWebSocket = vi.fn(() => socket);
    const factory = createStudioCloudflareRealtimeAdapterFactory({
      providerId: "cloudflare-realtime",
      realtimeOrigin: "https://realtime.toonstudio.cloud",
      createWebSocket,
    });
    const adapter = await factory.create();
    const events: StudioRealtimeInboundEvent[] = [];
    const connecting = adapter.connect(
      request(),
      "opaque-ticket-123456789012345678901234567890",
      {
        onEvent: (event) => events.push(event as StudioRealtimeInboundEvent),
        onDisconnect: vi.fn(),
      },
      new AbortController().signal,
    );
    socket.open();
    socket.receive(welcome(["presence"]));
    let settled = false;
    void connecting.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await finishPresenceHandshake(socket);
    await expect(connecting).resolves.toMatchObject({
      providerId: "cloudflare-realtime",
      providerSessionId: "connection-1",
    });
    await Promise.resolve();

    expect(createWebSocket).toHaveBeenCalledWith(
      "wss://realtime.toonstudio.cloud/v1/rooms/work-1/room-1",
      [
        REALTIME_WEBSOCKET_PROTOCOL,
        `${REALTIME_TICKET_PROTOCOL_PREFIX}opaque-ticket-123456789012345678901234567890`,
      ],
    );
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      version: REALTIME_PROTOCOL_VERSION,
      type: "resume",
      channel: "presence",
      afterSequence: 0,
    });
    expect(events[0]).toMatchObject({
      workload: "presence",
      kind: "presence.snapshot",
      serverSequence: "1",
    });

    const publish = adapter.publish(
      upsertEvent(),
      new AbortController().signal,
    );
    const wirePublish = JSON.parse(socket.sent[1]!) as Record<string, unknown>;
    expect(wirePublish).toMatchObject({
      type: "publish",
      channel: "presence",
      clientSequence: 1,
      payload: { kind: "presence.update", pageId: "page-1" },
    });
    socket.receive({
      version: REALTIME_PROTOCOL_VERSION,
      type: "ack",
      channel: "presence",
      idempotencyKey: upsertEvent().idempotencyKey,
      sequence: 7,
      duplicate: false,
    });
    await expect(publish).resolves.toMatchObject({
      workload: "presence",
      serverSequence: "7",
    });
    socket.receive(
      serverEvent({
        channel: "presence",
        sequence: 8,
        payload: {
          kind: "presence.update",
          pageId: "page-1",
          profile: {
            displayName: "어시스턴트",
            role: "editor",
            state: "active",
          },
          tool: "chalk",
        },
      }),
    );
    expect(events.at(-1)).toMatchObject({
      kind: "presence.upsert",
      payload: {
        participant: {
          sessionId: REMOTE_SESSION,
          displayName: "어시스턴트",
        },
      },
    });
    adapter.close();
  });

  it("skips a worker-valid product-invalid event without consuming a local sequence", async () => {
    const socket = new FakeWebSocket();
    const events: StudioRealtimeInboundEvent[] = [];
    const disconnected = vi.fn();
    const adapter = await createStudioCloudflareRealtimeAdapterFactory({
      providerId: "cloudflare-realtime",
      realtimeOrigin: "https://realtime.toonstudio.cloud",
      createWebSocket: () => socket,
    }).create();
    const connecting = adapter.connect(
      request(["presence"]),
      "ticket-schema-skew-123456789012345678901234567890",
      {
        onEvent: (event) =>
          events.push(event as StudioRealtimeInboundEvent),
        onDisconnect: disconnected,
      },
      new AbortController().signal,
    );
    socket.open();
    socket.receive(welcome(["presence"]));
    await finishPresenceHandshake(socket);
    await connecting;
    await Promise.resolve();

    socket.receive(
      serverEvent({
        channel: "presence",
        sequence: 1,
        payload: {
          kind: "presence.cursor",
          x: 0.25,
          y: 0.5,
          pageId: "page-1",
          tool: "pen",
          drawing: false,
          points: [2_000_000, 0],
        },
      }),
    );
    expect(disconnected).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(1);
    socket.receive(
      serverEvent({
        channel: "presence",
        sequence: 2,
        payload: {
          kind: "presence.update",
          pageId: "page-1",
          profile: {
            displayName: "어시스턴트",
            role: "editor",
            state: "active",
          },
          tool: "g-pen",
        },
      }),
    );

    expect(events.map((event) => event.kind)).toEqual([
      "presence.snapshot",
      "presence.upsert",
    ]);
    expect(events.map((event) => event.serverSequence)).toEqual(["1", "2"]);
    adapter.close();
  });

  it("rejects an invalid presence snapshot envelope before a valid fresh retry", async () => {
    const sockets: FakeWebSocket[] = [];
    const factory = createStudioCloudflareRealtimeAdapterFactory({
      providerId: "cloudflare-realtime",
      realtimeOrigin: "https://realtime.toonstudio.cloud",
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const invalidAdapter = await factory.create();
    const invalidConnect = invalidAdapter.connect(
      request(["presence"]),
      "ticket-invalid-snapshot-123456789012345678901234567890",
      { onEvent: vi.fn(), onDisconnect: vi.fn() },
      new AbortController().signal,
    );
    sockets[0]!.open();
    sockets[0]!.receive(welcome(["presence"]));
    sockets[0]!.receive(
      presenceSnapshot(0, [
        {
          connectionId: "connection-invalid-snapshot",
          actorId: "actor-invalid-snapshot",
          clientId: REMOTE_SESSION,
          update: {
            kind: "presence.update",
            pageId: "page-1",
            profile: {
              displayName: "어시스턴트",
              role: "editor",
              state: "active",
            },
            tool: "   ",
          },
          cursor: null,
        },
      ]),
    );
    await expect(invalidConnect).rejects.toThrow(
      "Cloudflare 실시간 응답 계약이 올바르지 않습니다.",
    );

    const events: StudioRealtimeInboundEvent[] = [];
    const validAdapter = await factory.create();
    const validConnect = validAdapter.connect(
      request(["presence"]),
      "ticket-valid-snapshot-123456789012345678901234567890",
      {
        onEvent: (event) =>
          events.push(event as StudioRealtimeInboundEvent),
        onDisconnect: vi.fn(),
      },
      new AbortController().signal,
    );
    sockets[1]!.open();
    sockets[1]!.receive(welcome(["presence"]));
    await finishPresenceHandshake(sockets[1]!);
    await validConnect;
    await Promise.resolve();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "presence.snapshot",
      serverSequence: "1",
    });
    validAdapter.close();
  });

  it("keeps identical worker sequence numbers independent across all three channels", async () => {
    const socket = new FakeWebSocket();
    const factory = createStudioCloudflareRealtimeAdapterFactory({
      providerId: "cloudflare-realtime",
      realtimeOrigin: "https://realtime.toonstudio.cloud",
      createWebSocket: () => socket,
    });
    const adapter = await factory.create();
    const events: StudioRealtimeInboundEvent[] = [];
    const connecting = adapter.connect(
      request(["presence", "comments", "screen-signaling"]),
      "ticket-all-channels-123456789012345678901234567890",
      {
        onEvent: (event) => events.push(event as StudioRealtimeInboundEvent),
        onDisconnect: vi.fn(),
      },
      new AbortController().signal,
    );
    socket.open();
    socket.receive(
      welcome(
        ["presence", "comments", "screen-signaling"],
        { presence: 1, comments: 1, "screen-signaling": 1 },
      ),
    );
    socket.receive(
      replay("comments", 1, 0, [
        serverEvent({
          channel: "comments",
          sequence: 1,
          payload: {
            kind: "comment.changed",
            threadId: "thread-1",
            activitySequence: "1",
            change: "created",
          },
        }),
      ]),
    );
    socket.receive(
      replay("screen-signaling", 1, 0, [
        serverEvent({
          channel: "screen-signaling",
          sequence: 1,
          payload: {
            kind: "signal.announce",
            shareId: SHARE_ID,
            label: "작업 화면",
          },
        }),
      ]),
    );
    socket.receive(presenceSnapshot(1));
    socket.receive(replay("presence", 1, 1));
    await connecting;
    await Promise.resolve();

    expect(
      events
        .map((event) => [event.workload, event.serverSequence])
        .sort(([left], [right]) => left!.localeCompare(right!)),
    ).toEqual([
      ["comments", "1"],
      ["presence", "1"],
      ["screen-signaling", "1"],
    ]);
    expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "resume", channel: "comments" }),
        expect.objectContaining({ type: "resume", channel: "screen-signaling" }),
        expect.objectContaining({ type: "resume", channel: "presence" }),
      ]),
    );
    adapter.close();
  });

  it("buffers synchronous replay until ProviderSession installs the active adapter", async () => {
    const socket = new FakeWebSocket();
    const provider = createStudioCloudflareRealtimeAdapterFactory({
      providerId: "cloudflare-realtime",
      realtimeOrigin: "https://realtime.toonstudio.cloud",
      createWebSocket: () => socket,
    });
    const session = new StudioRealtimeProviderSession({
      scope,
      clientInstanceId: LOCAL_SESSION,
      sessionId: LOCAL_SESSION,
      requiredWorkloads: ["presence"],
      requiredCapabilities: [...capabilitiesByWorkload.presence],
      providers: [provider],
      ticketIssuer: {
        issue: async () => ({
          version: 1,
          providerId: "cloudflare-realtime",
          scope,
          workloads: ["presence"],
          capabilities: [...capabilitiesByWorkload.presence],
          issuedAt: "2026-07-31T00:00:00.000Z",
          expiresAt: "2026-07-31T00:02:00.000Z",
          ticket: "runtime-ticket-123456789012345678901234567890",
        }),
      },
      now: () => Date.parse("2026-07-31T00:00:30.000Z"),
    });
    const events: StudioRealtimeInboundEvent[] = [];
    session.subscribe((event) => events.push(event));
    const connecting = session.connect();
    await vi.waitFor(() => {
      expect(socket.listeners.get("open")?.size).toBe(1);
    });
    socket.open();
    socket.receive(welcome(["presence"], { presence: 1 }));
    const send = socket.send.bind(socket);
    vi.spyOn(socket, "send").mockImplementation((data) => {
      send(data);
      const frame = JSON.parse(data) as {
        type?: string;
        channel?: string;
      };
      if (frame.type !== "resume" || frame.channel !== "presence") return;
      socket.receive(
        replay("presence", 1, 1),
      );
      socket.receive(
        serverEvent({
          channel: "presence",
          sequence: 2,
          payload: { kind: "presence.leave" },
        }),
      );
    });
    socket.receive(presenceSnapshot(1));
    await connecting;
    await Promise.resolve();

    expect(events.map((event) => event.kind)).toEqual([
      "presence.snapshot",
      "presence.remove",
    ]);
    expect(events.map((event) => event.serverSequence)).toEqual(["1", "2"]);
    await session.dispose();
  });

  it("rejects a regressed replay without corrupting a workload-local cursor", async () => {
    const sockets: FakeWebSocket[] = [];
    const factory = createStudioCloudflareRealtimeAdapterFactory({
      providerId: "cloudflare-realtime",
      realtimeOrigin: "https://realtime.toonstudio.cloud",
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const first = await factory.create();
    const received: StudioRealtimeInboundEvent[] = [];
    const firstConnect = first.connect(
      request(["comments"]),
      "ticket-first-123456789012345678901234567890",
      {
        onEvent: (event) =>
          received.push(event as StudioRealtimeInboundEvent),
        onDisconnect: vi.fn(),
      },
      new AbortController().signal,
    );
    sockets[0]!.open();
    sockets[0]!.receive(welcome(["comments"], { comments: 9 }));
    sockets[0]!.receive(
      replay("comments", 9, 0, [
        serverEvent({
          channel: "comments",
          sequence: 9,
          payload: {
            kind: "comment.changed",
            threadId: "thread-9",
            activitySequence: "9",
            change: "replied",
          },
        }),
      ]),
    );
    await firstConnect;
    await Promise.resolve();
    const cursor = received[0]!;
    first.close();

    const second = await factory.create();
    const secondConnect = second.connect(
      request(["comments"], [
        {
          workload: "comments",
          serverSequence: cursor.serverSequence,
          eventId: cursor.eventId,
        },
      ]),
      "ticket-second-123456789012345678901234567890",
      { onEvent: vi.fn(), onDisconnect: vi.fn() },
      new AbortController().signal,
    );
    sockets[1]!.open();
    sockets[1]!.receive(
      welcome(["comments"], { comments: 9 }, "connection-3"),
    );
    expect(JSON.parse(sockets[1]!.sent[0]!)).toEqual({
      version: REALTIME_PROTOCOL_VERSION,
      type: "resume",
      channel: "comments",
      afterSequence: 9,
    });
    sockets[1]!.receive({
      version: REALTIME_PROTOCOL_VERSION,
      type: "replay",
      channel: "comments",
      fromSequence: 10,
      toSequence: 0,
      currentSequence: 0,
      complete: true,
      events: [],
    });
    await expect(secondConnect).rejects.toThrow(
      "재생 시작점이 요청과 다릅니다",
    );
    second.close();

    const third = await factory.create();
    const thirdConnect = third.connect(
      request(["comments"], [
        {
          workload: "comments",
          serverSequence: cursor.serverSequence,
          eventId: cursor.eventId,
        },
      ]),
      "ticket-third-123456789012345678901234567890",
      { onEvent: vi.fn(), onDisconnect: vi.fn() },
      new AbortController().signal,
    );
    sockets[2]!.open();
    sockets[2]!.receive(
      welcome(["comments"], { comments: 9 }, "connection-4"),
    );
    expect(JSON.parse(sockets[2]!.sent[0]!)).toMatchObject({
      type: "resume",
      channel: "comments",
      afterSequence: 9,
    });
    sockets[2]!.receive(replay("comments", 9, 9));
    await thirdConnect;
    third.close();
  });

  it("rolls back projected sequences when a multi-channel handshake fails", async () => {
    const sockets: FakeWebSocket[] = [];
    const factory = createStudioCloudflareRealtimeAdapterFactory({
      providerId: "cloudflare-realtime",
      realtimeOrigin: "https://realtime.toonstudio.cloud",
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const failedAdapter = await factory.create();
    const failedConnect = failedAdapter.connect(
      request(["presence", "comments"]),
      "ticket-failed-123456789012345678901234567890",
      { onEvent: vi.fn(), onDisconnect: vi.fn() },
      new AbortController().signal,
    );
    sockets[0]!.open();
    sockets[0]!.receive(welcome(["presence", "comments"]));
    sockets[0]!.receive(presenceSnapshot());
    sockets[0]!.receive({
      ...replay("comments", 0, 0),
      fromSequence: 2,
    });
    await expect(failedConnect).rejects.toThrow(
      "재생 시작점이 요청과 다릅니다",
    );

    const recoveredEvents: StudioRealtimeInboundEvent[] = [];
    const recoveredAdapter = await factory.create();
    const recoveredConnect = recoveredAdapter.connect(
      request(["presence"]),
      "ticket-recovered-123456789012345678901234567890",
      {
        onEvent: (event) =>
          recoveredEvents.push(event as StudioRealtimeInboundEvent),
        onDisconnect: vi.fn(),
      },
      new AbortController().signal,
    );
    sockets[1]!.open();
    sockets[1]!.receive(welcome(["presence"]));
    await finishPresenceHandshake(sockets[1]!);
    await recoveredConnect;
    await Promise.resolve();

    expect(recoveredEvents).toHaveLength(1);
    expect(recoveredEvents[0]).toMatchObject({
      kind: "presence.snapshot",
      serverSequence: "1",
    });
    recoveredAdapter.close();
  });

  it("fails a retained cursor outside the Worker replay window over to primary", async () => {
    const sockets: FakeWebSocket[] = [];
    const factory = createStudioCloudflareRealtimeAdapterFactory({
      providerId: "cloudflare-realtime",
      realtimeOrigin: "https://realtime.toonstudio.cloud",
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const firstEvents: StudioRealtimeInboundEvent[] = [];
    const firstAdapter = await factory.create();
    const firstConnect = firstAdapter.connect(
      request(["comments"]),
      "ticket-gap-first-123456789012345678901234567890",
      {
        onEvent: (event) =>
          firstEvents.push(event as StudioRealtimeInboundEvent),
        onDisconnect: vi.fn(),
      },
      new AbortController().signal,
    );
    sockets[0]!.open();
    sockets[0]!.receive(welcome(["comments"], { comments: 9 }));
    sockets[0]!.receive(
      replay("comments", 9, 0, [
        serverEvent({
          channel: "comments",
          sequence: 9,
          payload: {
            kind: "comment.changed",
            threadId: "thread-before-gap",
            activitySequence: "9",
            change: "replied",
          },
        }),
      ]),
    );
    await firstConnect;
    await Promise.resolve();
    const cursor = firstEvents[0]!;
    firstAdapter.close();

    const recoveredAdapter = await factory.create();
    const recoveredConnect = recoveredAdapter.connect(
      request(["comments"], [
        {
          workload: "comments",
          serverSequence: cursor.serverSequence,
          eventId: cursor.eventId,
        },
      ]),
      "ticket-gap-second-123456789012345678901234567890",
      { onEvent: vi.fn(), onDisconnect: vi.fn() },
      new AbortController().signal,
    );
    sockets[1]!.open();
    const gapWelcome = welcome(
      ["comments"],
      { comments: 20 },
      "connection-after-gap",
    );
    sockets[1]!.receive({
      ...gapWelcome,
      channelStates: {
        ...gapWelcome.channelStates,
        comments: {
          currentSequence: 20,
          replayFloorSequence: 15,
        },
      },
    });
    await expect(recoveredConnect).rejects.toThrow(
      "기본 협업 경로를 사용",
    );
    expect(sockets[1]!.sent).toEqual([]);
    recoveredAdapter.close();
  });

  it("fails a fresh non-snapshot workload with pruned history over to primary", async () => {
    const socket = new FakeWebSocket();
    const adapter = await createStudioCloudflareRealtimeAdapterFactory({
      providerId: "cloudflare-realtime",
      realtimeOrigin: "https://realtime.toonstudio.cloud",
      createWebSocket: () => socket,
    }).create();
    const connecting = adapter.connect(
      request(["comments"]),
      "ticket-fresh-gap-123456789012345678901234567890",
      { onEvent: vi.fn(), onDisconnect: vi.fn() },
      new AbortController().signal,
    );
    socket.open();
    const prunedWelcome = welcome(
      ["comments"],
      { comments: 20 },
      "connection-fresh-gap",
    );
    socket.receive({
      ...prunedWelcome,
      channelStates: {
        ...prunedWelcome.channelStates,
        comments: {
          currentSequence: 20,
          replayFloorSequence: 15,
        },
      },
    });

    await expect(connecting).rejects.toThrow("기본 협업 경로를 사용");
    expect(socket.sent).toEqual([]);
    adapter.close();
  });

  it("falls back once when a valid replay exceeds the bounded negotiation buffer", async () => {
    const socket = new FakeWebSocket();
    const adapter = await createStudioCloudflareRealtimeAdapterFactory({
      providerId: "cloudflare-realtime",
      realtimeOrigin: "https://realtime.toonstudio.cloud",
      createWebSocket: () => socket,
    }).create();
    const connecting = adapter.connect(
      request(["comments"]),
      "ticket-large-replay-123456789012345678901234567890",
      { onEvent: vi.fn(), onDisconnect: vi.fn() },
      new AbortController().signal,
    );
    socket.open();
    socket.receive(welcome(["comments"], { comments: 5_000 }));

    let afterSequence = 0;
    for (let page = 0; page < 33; page += 1) {
      const eventCount = page === 32 ? 1 : 128;
      const events = Array.from({ length: eventCount }, (_, index) => {
        const sequence = afterSequence + index + 1;
        return serverEvent({
          channel: "comments",
          sequence,
          payload: {
            kind: "comment.changed",
            threadId: `thread-${sequence}`,
            activitySequence: String(sequence),
            change: "created",
          },
        });
      });
      socket.receive({
        version: REALTIME_PROTOCOL_VERSION,
        type: "replay",
        channel: "comments",
        fromSequence: afterSequence + 1,
        toSequence: afterSequence + eventCount,
        currentSequence: 5_000,
        complete: false,
        events,
      });
      afterSequence += eventCount;
    }

    await expect(connecting).rejects.toThrow("기본 협업 경로를 사용");
    expect(socket.readyState).toBe(3);
    adapter.close();
  });

  it("keeps one peerConnectionId across offer/ICE and isolates two viewers", async () => {
    const socket = new FakeWebSocket();
    const factory = createStudioCloudflareRealtimeAdapterFactory({
      providerId: "cloudflare-realtime",
      realtimeOrigin: "https://realtime.toonstudio.cloud",
      createWebSocket: () => socket,
    });
    const adapter = await factory.create();
    const connecting = adapter.connect(
      request(["screen-signaling"]),
      "ticket-screen-123456789012345678901234567890",
      { onEvent: vi.fn(), onDisconnect: vi.fn() },
      new AbortController().signal,
    );
    socket.open();
    socket.receive(welcome(["screen-signaling"]));
    socket.receive(replay("screen-signaling", 0, 0));
    await connecting;

    const publishAndAck = async (event: StudioRealtimeOutboundEvent) => {
      const pending = adapter.publish(event, new AbortController().signal);
      const frame = JSON.parse(socket.sent.at(-1)!) as {
        channel: RealtimeChannel;
        idempotencyKey: string;
        payload: Record<string, unknown>;
      };
      socket.receive({
        version: REALTIME_PROTOCOL_VERSION,
        type: "ack",
        channel: frame.channel,
        idempotencyKey: frame.idempotencyKey,
        sequence: Number(event.clientSequence),
        duplicate: false,
      });
      await pending;
      return frame.payload;
    };
    const offerA = await publishAndAck({
      version: 1,
      scope,
      workload: "screen-signaling",
      kind: "screen.description",
      eventId: "00000000-0000-4000-8000-000000000201",
      idempotencyKey: "00000000-0000-4000-8000-000000000202",
      clientSequence: "1",
      sentAt: "2026-07-31T00:00:00.000Z",
      senderSessionId: LOCAL_SESSION,
      targetSessionId: REMOTE_SESSION,
      payload: { shareId: SHARE_ID, type: "offer", sdp: "offer-a" },
    });
    const iceA = await publishAndAck({
      version: 1,
      scope,
      workload: "screen-signaling",
      kind: "screen.ice",
      eventId: "00000000-0000-4000-8000-000000000203",
      idempotencyKey: "00000000-0000-4000-8000-000000000204",
      clientSequence: "2",
      sentAt: "2026-07-31T00:00:00.000Z",
      senderSessionId: LOCAL_SESSION,
      targetSessionId: REMOTE_SESSION,
      payload: {
        shareId: SHARE_ID,
        candidate: "candidate-a",
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: null,
      },
    });
    const offerB = await publishAndAck({
      version: 1,
      scope,
      workload: "screen-signaling",
      kind: "screen.description",
      eventId: "00000000-0000-4000-8000-000000000205",
      idempotencyKey: "00000000-0000-4000-8000-000000000206",
      clientSequence: "3",
      sentAt: "2026-07-31T00:00:00.000Z",
      senderSessionId: LOCAL_SESSION,
      targetSessionId: SECOND_VIEWER,
      payload: { shareId: SHARE_ID, type: "offer", sdp: "offer-b" },
    });
    expect(iceA.peerConnectionId).toBe(offerA.peerConnectionId);
    expect(offerB.peerConnectionId).not.toBe(offerA.peerConnectionId);
    adapter.close();
  });

  it("rotates an inbound WebRTC generation and drops delayed old ICE", async () => {
    const socket = new FakeWebSocket();
    const events: StudioRealtimeInboundEvent[] = [];
    const adapter = await createStudioCloudflareRealtimeAdapterFactory({
      providerId: "cloudflare-realtime",
      realtimeOrigin: "https://realtime.toonstudio.cloud",
      createWebSocket: () => socket,
    }).create();
    const connecting = adapter.connect(
      request(["screen-signaling"]),
      "ticket-screen-rotation-123456789012345678901234567890",
      {
        onEvent: (event) =>
          events.push(event as StudioRealtimeInboundEvent),
        onDisconnect: vi.fn(),
      },
      new AbortController().signal,
    );
    socket.open();
    socket.receive(welcome(["screen-signaling"]));
    socket.receive(replay("screen-signaling", 0, 0));
    await connecting;

    const description = (
      sequence: number,
      peerConnectionId: string,
      sdp: string,
    ) =>
      serverEvent({
        channel: "screen-signaling",
        sequence,
        payload: {
          kind: "signal.offer",
          sessionId: SHARE_ID,
          peerConnectionId,
          targetClientId: LOCAL_SESSION,
          sdp,
        },
      });
    const ice = (
      sequence: number,
      peerConnectionId: string,
      candidate: string,
    ) =>
      serverEvent({
        channel: "screen-signaling",
        sequence,
        payload: {
          kind: "signal.ice",
          sessionId: SHARE_ID,
          peerConnectionId,
          targetClientId: LOCAL_SESSION,
          candidate: {
            candidate,
            sdpMid: "0",
            sdpMLineIndex: 0,
            usernameFragment: null,
          },
        },
      });

    socket.receive(description(1, "peer-old", "offer-old"));
    socket.receive(ice(2, "peer-old", "candidate-old"));
    socket.receive(description(3, "peer-new", "offer-new"));
    socket.receive(ice(4, "peer-old", "candidate-delayed-old"));
    socket.receive(ice(5, "peer-new", "candidate-new"));

    expect(events.map((event) => event.kind)).toEqual([
      "screen.description",
      "screen.ice",
      "screen.description",
      "screen.ice",
    ]);
    expect(events.map((event) => event.serverSequence)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    expect(events.at(-1)?.payload).toMatchObject({
      candidate: "candidate-new",
    });
    adapter.close();
  });

  it("keeps healthy workloads connected after a message-scoped screen conflict", async () => {
    const socket = new FakeWebSocket();
    const disconnected = vi.fn();
    const adapter = await createStudioCloudflareRealtimeAdapterFactory({
      providerId: "cloudflare-realtime",
      realtimeOrigin: "https://realtime.toonstudio.cloud",
      createWebSocket: () => socket,
    }).create();
    const connecting = adapter.connect(
      request(["presence", "comments", "screen-signaling"]),
      "ticket-screen-conflict-123456789012345678901234567890",
      { onEvent: vi.fn(), onDisconnect: disconnected },
      new AbortController().signal,
    );
    socket.open();
    socket.receive(
      welcome(["presence", "comments", "screen-signaling"]),
    );
    socket.receive(replay("comments", 0, 0));
    socket.receive(replay("screen-signaling", 0, 0));
    await finishPresenceHandshake(socket);
    await connecting;

    const requestEvent: StudioRealtimeOutboundEvent = {
      version: 1,
      scope,
      workload: "screen-signaling",
      kind: "screen.request",
      eventId: "00000000-0000-4000-8000-000000000221",
      idempotencyKey: "00000000-0000-4000-8000-000000000222",
      clientSequence: "1",
      sentAt: "2026-07-31T00:00:00.000Z",
      senderSessionId: LOCAL_SESSION,
      targetSessionId: REMOTE_SESSION,
      payload: { shareId: SHARE_ID },
    };
    const rejected = adapter.publish(
      requestEvent,
      new AbortController().signal,
    );
    expect(JSON.parse(socket.sent.at(-1)!).clientSequence).toBe(1);
    socket.receive({
      version: REALTIME_PROTOCOL_VERSION,
      type: "error",
      code: "signaling-state-conflict",
      retryable: false,
      channel: "screen-signaling",
      idempotencyKey: requestEvent.idempotencyKey,
      currentSequence: 0,
      replayFloorSequence: 1,
    });
    await expect(rejected).rejects.toThrow("발행이 거부");
    expect(disconnected).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(1);

    const accepted = adapter.publish(
      upsertEvent(),
      new AbortController().signal,
    );
    expect(JSON.parse(socket.sent.at(-1)!).clientSequence).toBe(1);
    socket.receive({
      version: REALTIME_PROTOCOL_VERSION,
      type: "ack",
      channel: "presence",
      idempotencyKey: upsertEvent().idempotencyKey,
      sequence: 1,
      duplicate: false,
    });
    await expect(accepted).resolves.toMatchObject({
      workload: "presence",
      serverSequence: "1",
    });
    adapter.close();
  });

  it("disconnects a half-open provider after a missing pong and publish timeout", async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeWebSocket();
      const disconnected = vi.fn();
      const factory = createStudioCloudflareRealtimeAdapterFactory({
        providerId: "cloudflare-realtime",
        realtimeOrigin: "https://realtime.toonstudio.cloud",
        createWebSocket: () => socket,
        connectTimeoutMs: 1_000,
        publishTimeoutMs: 1_000,
      });
      const adapter = await factory.create();
      const connecting = adapter.connect(
        request(),
        "ticket-timeout-123456789012345678901234567890",
        { onEvent: vi.fn(), onDisconnect: disconnected },
        new AbortController().signal,
      );
      socket.open();
      socket.receive(welcome(["presence"]));
      await finishPresenceHandshake(socket);
      await connecting;
      const pending = adapter.publish(
        upsertEvent(),
        new AbortController().signal,
      );
      const rejection = expect(pending).rejects.toThrow(
        "발행 확인 시간이 초과",
      );
      await vi.advanceTimersByTimeAsync(1_000);
      await rejection;
      expect(disconnected).toHaveBeenCalledWith({
        code: "network-lost",
        recoverable: true,
      });
      adapter.close();

      const heartbeatSocket = new FakeWebSocket();
      const heartbeatDisconnected = vi.fn();
      const heartbeatAdapter = await createStudioCloudflareRealtimeAdapterFactory({
        providerId: "cloudflare-realtime",
        realtimeOrigin: "https://realtime.toonstudio.cloud",
        createWebSocket: () => heartbeatSocket,
      }).create();
      const heartbeatConnect = heartbeatAdapter.connect(
        request(),
        "ticket-heartbeat-123456789012345678901234567890",
        { onEvent: vi.fn(), onDisconnect: heartbeatDisconnected },
        new AbortController().signal,
      );
      heartbeatSocket.open();
      heartbeatSocket.receive(welcome(["presence"]));
      await finishPresenceHandshake(heartbeatSocket);
      await heartbeatConnect;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(
        heartbeatSocket.sent.some(
          (frame) => JSON.parse(frame).type === "ping",
        ),
      ).toBe(true);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(heartbeatDisconnected).toHaveBeenCalledWith({
        code: "network-lost",
        recoverable: true,
      });
      heartbeatAdapter.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects malformed origins and an unnegotiated WebSocket protocol", async () => {
    expect(() =>
      studioCloudflareRealtimeRoomUrl(
        "https://user:secret@realtime.toonstudio.cloud",
        "work-1",
        "room-1",
      ),
    ).toThrow();
    expect(() =>
      studioCloudflareRealtimeRoomUrl(
        "http://realtime.toonstudio.cloud",
        "work-1",
        "room-1",
      ),
    ).toThrow();

    const socket = new FakeWebSocket();
    const adapter = await createStudioCloudflareRealtimeAdapterFactory({
      providerId: "cloudflare-realtime",
      realtimeOrigin: "https://realtime.toonstudio.cloud",
      createWebSocket: () => socket,
    }).create();
    const connecting = adapter.connect(
      request(),
      "ticket-protocol-123456789012345678901234567890",
      { onEvent: vi.fn(), onDisconnect: vi.fn() },
      new AbortController().signal,
    );
    socket.open("");
    await expect(connecting).rejects.toThrow(
      "Cloudflare 실시간 하위 프로토콜이 다릅니다.",
    );
    expect(socket.readyState).toBe(3);
    adapter.close();
  });
});
