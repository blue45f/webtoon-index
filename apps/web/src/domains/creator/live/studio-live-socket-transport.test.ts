import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_CRDT_BINARY_WIRE_VERSION,
  STUDIO_LIVE_CRDT_BINARY_REMOTE_EVENT,
  STUDIO_LIVE_CRDT_BINARY_SYNC_EVENT,
  STUDIO_LIVE_CRDT_BINARY_UPDATE_EVENT,
  STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT,
} from "./studio-crdt-binary-wire";
import { StudioCrdtOperationError } from "./studio-crdt-operation-error";
import {
  encodeStudioCrdtStateVector,
  encodeStudioCrdtSyncChunks,
  encodeStudioCrdtUpdate,
  STUDIO_CRDT_PROTOCOL_VERSION,
  type StudioCrdtTransportMessage,
} from "./studio-crdt-protocol";
import {
  STUDIO_LIVE_ICE_CANDIDATE_MAX_LENGTH,
  STUDIO_LIVE_LOCK_MAX_LEASE_MS,
  STUDIO_LIVE_SDP_MAX_LENGTH,
  STUDIO_LIVE_SDP_MID_MAX_LENGTH,
  STUDIO_LIVE_USERNAME_FRAGMENT_MAX_LENGTH,
  createStudioLiveEnvelope,
  type StudioLiveEnvelope,
  type StudioLiveMessageKind,
  type StudioLiveParticipant,
  type StudioLivePayloadMap,
} from "./studio-live-collaboration-protocol";
import { StudioLiveRoom, type StudioLiveRoomEvent } from "./studio-live-collaboration-room";
import {
  decodeStudioLiveInkSamples,
  encodeStudioLiveInkSamples,
} from "./studio-live-ink-codec";
import {
  createStudioLiveInkWireMessage,
  STUDIO_LIVE_INK_CAPABILITY,
  type StudioLiveInkWireMessage,
} from "./studio-live-ink-protocol";
import {
  STUDIO_LIVE_GESTURE_PREVIEW_SOCKET_EVENT,
  STUDIO_LIVE_INK_SOCKET_EVENT,
  STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_BYTES,
  STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_PACKETS,
  STUDIO_LIVE_INK_SOCKET_INBOUND_WINDOW_MS,
  STUDIO_LIVE_SOCKET_RETRY_POLICY,
  StudioLiveSocketTransport,
  createStudioServerLiveTransportFactory,
  resolveStudioLiveSocketRuntimeEndpoint,
  type StudioLiveSocketLike,
} from "./studio-live-socket-transport";

import type {
  StudioLiveTransport,
  StudioLiveTransportContext,
  StudioLiveTransportControlEvent,
} from "./studio-live-collaboration-transport";

import {
  decodeStudioCrdtBinaryEnvelope,
  encodeStudioCrdtBinaryEnvelope,
  fragmentStudioCrdtBinarySyncEnvelope,
} from "@/shared/lib/studio-crdt-binary-envelope";

const NOW = 2_000_000;
const TOKEN = "signed-session-token-value";
const localParticipant: StudioLiveParticipant = {
  sessionId: "local-client-instance",
  displayName: "내 작업 · 이 탭",
  role: "owner",
};

function serverParticipant(
  connectionId: string,
  clientInstanceId: string,
  name: string,
  role: StudioLiveParticipant["role"] = "editor"
) {
  return {
    connectionId,
    clientInstanceId,
    name,
    role,
    capabilities: { view: true, comment: true, edit: true, manageMembers: role === "owner" },
    state: "active",
    pageId: null,
    tool: null,
    sharingScreen: false,
    joinedAt: new Date(NOW - 1_000).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
  };
}

const self = serverParticipant("connection-self", localParticipant.sessionId, "내 작업", "owner");
const remote = serverParticipant("connection-remote", "remote-client-instance", "어시스턴트");
const CRDT_WIRE_EPOCH = "00000000-0000-4000-8000-000000000101";

function joinSuccess(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: { self, participants: [self, remote], locks: [], ...overrides },
  };
}

function binaryJoinSuccess(
  selectionEpoch = CRDT_WIRE_EPOCH,
  overrides: Record<string, unknown> = {}
) {
  return joinSuccess({
    crdtWireFormats: ["binary-v1", "base64-v4"],
    crdtWireSelectionEpoch: selectionEpoch,
    ...overrides,
  });
}

function binarySelectionSuccess(selectionEpoch = CRDT_WIRE_EPOCH) {
  return {
    ok: true,
    data: {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
      workId: "work-1",
      format: "binary-v1",
      selectionEpoch,
      selected: true,
    },
  };
}

function revisionJoinSuccess(
  lockSnapshotRevision: string,
  overrides: Record<string, unknown> = {}
) {
  return joinSuccess({
    lockProtocolVersion: 2,
    lockRevisionVersion: 1,
    lockSnapshotRevision,
    ...overrides,
  });
}

function revisionLock(
  resourceId: string,
  leaseId: string,
  revision: string,
  owner = remote
) {
  return {
    resourceId,
    leaseId,
    ownerConnectionId: owner.connectionId,
    ownerName: owner.name,
    expiresAt: new Date(NOW + 15_000).toISOString(),
    revision,
  };
}

interface EmittedRecord {
  event: string;
  payload: unknown;
}

class FakeSocket implements StudioLiveSocketLike {
  connected = false;
  connectCalls = 0;
  auth: Record<string, unknown>;
  readonly emitted: EmittedRecord[] = [];
  readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  readonly heldAcks = new Map<string, Array<(value: unknown) => void>>();
  readonly ackResponses = new Map<string, unknown>();
  joinResponse: unknown = joinSuccess();
  holdEvents = new Set<string>();

  constructor(auth: { sessionToken: string }) {
    this.auth = { ...auth };
  }

  connect(): StudioLiveSocketLike {
    this.connectCalls += 1;
    this.connected = true;
    this.serverEmit("connect");
    return this;
  }

  disconnect(): StudioLiveSocketLike {
    const wasConnected = this.connected;
    this.connected = false;
    if (wasConnected) this.serverEmit("disconnect", "io client disconnect");
    return this;
  }

  emit(event: string, ...args: unknown[]): StudioLiveSocketLike {
    const callback = typeof args.at(-1) === "function" ? (args.at(-1) as (value: unknown) => void) : null;
    const payload = args[0];
    this.emitted.push({ event, payload });
    if (!callback) return this;
    if (this.holdEvents.has(event)) {
      const queue = this.heldAcks.get(event) ?? [];
      queue.push(callback);
      this.heldAcks.set(event, queue);
      return this;
    }
    callback(
      event === "studio:join"
        ? this.joinResponse
        : (this.ackResponses.get(event) ?? { ok: true, data: {} })
    );
    return this;
  }

  on(event: string, listener: (...args: unknown[]) => void): StudioLiveSocketLike {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: string, listener: (...args: unknown[]) => void): StudioLiveSocketLike {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  serverEmit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }

  reply(event: string, value: unknown): void {
    const callback = this.heldAcks.get(event)?.shift();
    if (!callback) throw new Error(`No held acknowledgement for ${event}`);
    callback(value);
  }

  serverDisconnect(reason = "transport close"): void {
    this.connected = false;
    this.serverEmit("disconnect", reason);
  }

  serverReconnect(): void {
    this.connected = true;
    this.serverEmit("connect");
  }
}

function context(): StudioLiveTransportContext {
  return { workId: "work-1", roomName: "unused-server-room", participant: localParticipant };
}

function commentChanged(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    workId: "work-1",
    threadId: "thread-1",
    activitySequence: "42",
    kind: "replied",
    ...overrides,
  };
}

function gesturePreview(
  gestureId = "gesture-socket-1"
) {
  return {
    version: 1,
    gestureId,
    pageId: "page-1",
    seq: 1,
    phase: "begin",
    operation: "erase",
    base: { documentGeneration: 12 },
    renderer: {
      kind: "freehand",
      mode: "eraser",
      stroke: "#112233",
      strokeWidth: 18,
      opacity: 0.75,
    },
    samples: {
      startIndex: 0,
      points: [12, 18, 20, 24],
      pressures: [0.5, 0.75],
    },
  } satisfies StudioLivePayloadMap["preview:gesture"];
}

function envelope<K extends StudioLiveMessageKind>(
  kind: K,
  payload: StudioLivePayloadMap[K],
  sequence: number,
  targetSessionId: string | null = null
): StudioLiveEnvelope<K> {
  return createStudioLiveEnvelope({
    workId: "work-1",
    sender: localParticipant,
    sentAt: NOW,
    sequence,
    kind,
    targetSessionId,
    payload,
  });
}

function activate(transport: StudioLiveSocketTransport): void {
  expect(
    transport.send(
      envelope("presence:hello", { visibility: "active", pageId: null }, 1)
    )
  ).toBe(true);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("StudioLiveSocketTransport", () => {
  it("keeps retries bounded while covering a configured free host cold start", () => {
    expect(STUDIO_LIVE_GESTURE_PREVIEW_SOCKET_EVENT).toBe(
      "studio:gesture:preview"
    );
    expect(STUDIO_LIVE_SOCKET_RETRY_POLICY).toEqual({
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 8_000,
      randomizationFactor: 0.25,
      timeout: 15_000,
    });
  });

  it("fails closed to local collaboration when runtime realtime configuration is absent", () => {
    expect(resolveStudioLiveSocketRuntimeEndpoint({})).toBeNull();
    expect(
      resolveStudioLiveSocketRuntimeEndpoint({
        locationOrigin: "https://preview-branch.vercel.app",
      }),
    ).toBeNull();
    expect(
      resolveStudioLiveSocketRuntimeEndpoint({
        locationOrigin: "http://127.0.0.1:5199",
        development: true,
      }),
    ).toBeNull();

    vi.stubEnv("VITE_STUDIO_LIVE_ORIGIN", "");
    vi.stubEnv("VITE_API_BASE", "");
    vi.stubEnv("VITE_STUDIO_LIVE_DEV_PROXY_ENABLED", "");
    const localTransport: StudioLiveTransport = {
      mode: "local",
      ready: true,
      connect: () => Promise.resolve(),
      send: () => false,
      subscribe: () => () => undefined,
      close: () => undefined,
    };
    const localFactory = vi.fn(() => localTransport);
    const factory = createStudioServerLiveTransportFactory(TOKEN, {
      createLocalTransport: localFactory,
    });

    expect(factory(context())).toBe(localTransport);
    expect(localFactory).toHaveBeenCalledOnce();
  });

  it("does not probe Socket.IO merely because a production HTTP API base exists", () => {
    vi.stubEnv("VITE_STUDIO_LIVE_ORIGIN", "");
    vi.stubEnv("VITE_API_BASE", "https://api.toonstudio.cloud/api");
    vi.stubEnv("VITE_STUDIO_LIVE_DEV_PROXY_ENABLED", "");
    const localTransport: StudioLiveTransport = {
      mode: "local",
      ready: true,
      connect: () => Promise.resolve(),
      send: () => false,
      subscribe: () => () => undefined,
      close: () => undefined,
    };
    const localFactory = vi.fn(() => localTransport);

    const transport = createStudioServerLiveTransportFactory(TOKEN, {
      createLocalTransport: localFactory,
    })(context());

    expect(transport).toBe(localTransport);
    expect(transport.mode).toBe("local");
    expect(localFactory).toHaveBeenCalledOnce();
  });

  it("does not treat the Cloudflare realtime origin as a Socket.IO host", () => {
    // Presence/comment/screen-share DO origin is purpose-routed separately; Engine.IO must not
    // open wss://…workers.dev/socket.io when only VITE_STUDIO_REALTIME_ORIGIN is set.
    vi.stubEnv("VITE_STUDIO_LIVE_ORIGIN", "");
    vi.stubEnv(
      "VITE_STUDIO_REALTIME_ORIGIN",
      "https://toonspectrum-realtime.toonstudio-realtime.workers.dev",
    );
    vi.stubEnv("VITE_STUDIO_REALTIME_PROVIDER_ID", "cloudflare-realtime-v1");
    vi.stubEnv("VITE_API_BASE", "");
    vi.stubEnv("VITE_STUDIO_LIVE_DEV_PROXY_ENABLED", "");

    const localTransport: StudioLiveTransport = {
      mode: "local",
      ready: true,
      connect: () => Promise.resolve(),
      send: () => false,
      subscribe: () => () => undefined,
      close: () => undefined,
    };
    const localFactory = vi.fn(() => localTransport);

    const transport = createStudioServerLiveTransportFactory(TOKEN, {
      createLocalTransport: localFactory,
    })(context());

    // Injected local factory still wins so tests can isolate Engine.IO.
    expect(transport).toBe(localTransport);
    expect(transport.mode).toBe("local");
    expect(localFactory).toHaveBeenCalledOnce();
  });

  it("uses a server-mode signaling shell when only Cloudflare realtime is configured", async () => {
    const { createStudioLiveSignalingServerTransport } = await import("./studio-live-signaling-server-transport"
    );
    const transport = createStudioLiveSignalingServerTransport();
    expect(transport.mode).toBe("server");
    expect(transport.publishCrdtUpdate).toBeUndefined();
    await transport.connect();
    expect(transport.ready).toBe(true);
    expect(transport.send({} as never)).toBe(false);

    const roomName = `work-jam-signaling-${crypto.randomUUID()}`;
    const workId = roomName;
    const alice = createStudioLiveSignalingServerTransport({
      workId,
      roomName,
      participant: {
        sessionId: "00000000-0000-4000-8000-0000000000a1",
        displayName: "익명 게스트",
        role: "editor",
      },
    });
    const bob = createStudioLiveSignalingServerTransport({
      workId,
      roomName,
      participant: {
        sessionId: "00000000-0000-4000-8000-0000000000b2",
        displayName: "익명 게스트",
        role: "editor",
      },
    });
    const received: string[] = [];
    bob.subscribeCrdt?.((message) => {
      if (message.type === "update") received.push(message.update.updateId);
    });
    await alice.connect();
    await bob.connect();
    const updateId = "00000000-0000-4000-8000-0000000000c3";
    await alice.publishCrdtUpdate?.({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId,
      updateId,
      clientSequence: 1,
      update: "AAAA",
    });
    await vi.waitFor(() => expect(received).toContain(updateId));
    alice.close();
    bob.close();
  });

  it("admits only an exact absolute realtime origin", () => {
    expect(
      resolveStudioLiveSocketRuntimeEndpoint({
        explicitOrigin: "https://realtime.toonstudio.cloud",
        locationOrigin: "https://www.toonstudio.cloud",
      }),
    ).toBe("https://realtime.toonstudio.cloud/studio-live");
    expect(
      resolveStudioLiveSocketRuntimeEndpoint({
        explicitOrigin: "/api",
        locationOrigin: "https://www.toonstudio.cloud",
      }),
    ).toBeNull();
    expect(
      resolveStudioLiveSocketRuntimeEndpoint({
        explicitOrigin: "https://realtime.toonstudio.cloud/api?probe=true",
        locationOrigin: "https://www.toonstudio.cloud",
      }),
    ).toBeNull();
  });

  it("keeps the Vite Socket.IO proxy behind an exact development opt-in", () => {
    expect(
      resolveStudioLiveSocketRuntimeEndpoint({
        locationOrigin: "http://127.0.0.1:5199",
        development: true,
        devProxyEnabled: true,
      }),
    ).toBe("/studio-live");
    expect(
      resolveStudioLiveSocketRuntimeEndpoint({
        locationOrigin: "https://www.toonstudio.cloud",
        devProxyEnabled: true,
      }),
    ).toBeNull();
  });

  it("returns the exact local transport even when optional purpose routing is configured", async () => {
    vi.stubEnv(
      "VITE_STUDIO_REALTIME_ORIGIN",
      "https://realtime.toonstudio.cloud",
    );
    vi.stubEnv(
      "VITE_STUDIO_REALTIME_PROVIDER_ID",
      "cloudflare-realtime-v1",
    );
    const connect = vi.fn(() => Promise.resolve());
    const close = vi.fn();
    const localTransport: StudioLiveTransport = {
      mode: "local",
      ready: true,
      connect,
      send: () => false,
      subscribe: () => () => undefined,
      close,
    };
    const localFactory = vi.fn(() => localTransport);
    const socketFactory = vi.fn(() => new FakeSocket({ sessionToken: TOKEN }));
    const factory = createStudioServerLiveTransportFactory(TOKEN, {
      socketEndpoint: null,
      createSocket: socketFactory,
      createLocalTransport: localFactory,
    });

    const transport = factory(context());
    expect(transport).toBe(localTransport);
    expect(transport.mode).toBe("local");
    expect(localFactory).toHaveBeenCalledWith(context());
    expect(socketFactory).not.toHaveBeenCalled();
    await transport.connect();
    expect(connect).toHaveBeenCalledOnce();
    transport.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it("uses a same-origin websocket auth handshake and stays unready until join ACL succeeds", async () => {
    const socket = new FakeSocket({ sessionToken: "placeholder" });
    socket.holdEvents.add("studio:join");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: (auth) => {
        socket.auth = { ...auth };
        return socket;
      },
      now: () => NOW,
    });
    const received: unknown[] = [];
    transport.subscribe((value) => received.push(value));

    const connecting = transport.connect();
    expect(transport.ready).toBe(false);
    expect(socket.auth).toEqual({ sessionToken: TOKEN });
    expect(socket.emitted[0]).toEqual({
      event: "studio:join",
      payload: { workId: "work-1", clientInstanceId: localParticipant.sessionId },
    });
    expect(JSON.stringify(socket.emitted)).not.toContain(TOKEN);

    socket.reply("studio:join", joinSuccess());
    await connecting;
    expect(transport.ready).toBe(true);
    expect(received).toEqual([]);

    activate(transport);
    expect(
      (received as StudioLiveEnvelope[]).map((value) => [value.kind, value.sender.sessionId])
    ).toEqual([["presence:heartbeat", remote.connectionId]]);
    expect(JSON.stringify(socket.emitted)).not.toContain(TOKEN);

    transport.close();
    expect(socket.auth).toEqual({});
    expect(
      (transport as unknown as { sessionToken: string | null }).sessionToken
    ).toBeNull();
  });

  it("fails targeted identity translation closed while a canonical client id is ambiguous", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:join");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const first = serverParticipant(
      "connection-shared-first",
      "shared-client-instance",
      "첫 번째 탭",
    );
    const second = serverParticipant(
      "connection-shared-second",
      "shared-client-instance",
      "두 번째 탭",
    );
    const connecting = transport.connect();
    socket.reply(
      "studio:join",
      joinSuccess({ participants: [self, first, second] }),
    );
    await connecting;

    expect(transport.canonicalSessionId(first.connectionId)).toBe(
      first.connectionId,
    );
    expect(transport.canonicalSessionId(second.connectionId)).toBe(
      second.connectionId,
    );
    expect(transport.transportSessionId("shared-client-instance")).toBeNull();

    socket.serverEmit("studio:presence:leave", {
      connectionId: first.connectionId,
      reason: "disconnect",
    });
    expect(transport.canonicalSessionId(second.connectionId)).toBe(
      "shared-client-instance",
    );
    expect(transport.transportSessionId("shared-client-instance")).toBe(
      second.connectionId,
    );

    socket.serverEmit("studio:presence:leave", {
      connectionId: first.connectionId,
      reason: "stale-disconnect",
    });
    expect(transport.canonicalSessionId(first.connectionId)).toBe(
      first.connectionId,
    );
    expect(transport.transportSessionId("shared-client-instance")).toBe(
      second.connectionId,
    );
    transport.close();
  });

  it("delivers a valid current-work team comment invalidation after the join ACL succeeds", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const controls: StudioLiveTransportControlEvent[] = [];
    transport.subscribeControl((event) => controls.push(event));
    await transport.connect();

    socket.serverEmit("studio:comment:changed", commentChanged());

    expect(controls.filter((event) => event.type === "comment-changed")).toEqual([{
      type: "comment-changed",
      change: commentChanged(),
    }]);
    transport.close();
  });

  it("ignores team comment invalidations before join and rejects malformed or cross-work payloads", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:join");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const controls: StudioLiveTransportControlEvent[] = [];
    transport.subscribeControl((event) => controls.push(event));

    const connecting = transport.connect();
    socket.serverEmit("studio:comment:changed", commentChanged({ activitySequence: "41" }));
    socket.reply("studio:join", joinSuccess());
    await connecting;
    socket.serverEmit("studio:comment:changed", commentChanged({ workId: "work-other" }));
    socket.serverEmit("studio:comment:changed", commentChanged({ activitySequence: "not-a-sequence" }));
    socket.serverEmit("studio:comment:changed", { ...commentChanged(), extra: true });

    expect(controls.filter((event) => event.type === "comment-changed")).toEqual([]);
    transport.close();
  });

  it("ignores late team comment invalidations after disconnect, access revocation, or close", async () => {
    const scenarios = [
      {
        finish: (socket: FakeSocket, transport: StudioLiveSocketTransport) => {
          socket.serverDisconnect();
          expect(transport.ready).toBe(false);
        },
      },
      {
        finish: (socket: FakeSocket, transport: StudioLiveSocketTransport) => {
          socket.serverEmit("studio:access:revoked", {
            workId: "work-1",
            message: "팀 권한이 회수되었습니다.",
          });
          expect(transport.ready).toBe(false);
        },
      },
      {
        finish: (_socket: FakeSocket, transport: StudioLiveSocketTransport) => {
          transport.close();
          expect(transport.ready).toBe(false);
        },
      },
    ];

    for (const { finish } of scenarios) {
      const socket = new FakeSocket({ sessionToken: TOKEN });
      const transport = new StudioLiveSocketTransport(context(), TOKEN, {
        createSocket: () => socket,
        now: () => NOW,
      });
      const controls: StudioLiveTransportControlEvent[] = [];
      transport.subscribeControl((event) => controls.push(event));
      await transport.connect();
      finish(socket, transport);
      controls.length = 0;

      socket.serverEmit("studio:comment:changed", commentChanged());

      expect(controls).toEqual([]);
      transport.close();
    }
  });

  it("removes only its exact team comment listener when closed", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const externalCommentListener = vi.fn();
    socket.on("studio:comment:changed", externalCommentListener);
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();

    expect(socket.listeners.get("studio:comment:changed")?.size).toBe(2);
    expect(socket.listeners.get("studio:cursor")?.size).toBe(1);
    transport.close();

    expect(socket.listeners.get("studio:comment:changed")).toEqual(
      new Set([externalCommentListener])
    );
    expect(socket.listeners.get("studio:cursor")?.size).toBe(0);
    socket.serverEmit("studio:comment:changed", commentChanged());
    expect(externalCommentListener).toHaveBeenCalledOnce();
  });

  it("replays active screen shares from the authoritative join snapshot", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const sharingRemote = { ...remote, sharingScreen: true };
    socket.joinResponse = joinSuccess({
      participants: [self, sharingRemote],
      screenShares: [
        {
          connectionId: sharingRemote.connectionId,
          shareId: "share-running",
          label: "콘티 화면",
        },
      ],
    });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));

    await transport.connect();
    activate(transport);

    expect(received).toEqual([
      expect.objectContaining({
        kind: "presence:heartbeat",
        sender: expect.objectContaining({ sessionId: sharingRemote.connectionId }),
      }),
      expect.objectContaining({
        kind: "screen:announce",
        sender: expect.objectContaining({ sessionId: sharingRemote.connectionId }),
        payload: { shareId: "share-running", label: "콘티 화면" },
      }),
    ]);
    transport.close();
  });

  it("overlays pre-flush screen deltas and fences stale lifecycle stops", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:join");
    const sharingRemote = { ...remote, sharingScreen: true };
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));

    const connecting = transport.connect();
    socket.serverEmit("studio:screen:announce", {
      fromConnectionId: sharingRemote.connectionId,
      fromName: sharingRemote.name,
      shareId: "share-new",
      label: "새 화면",
    });
    socket.serverEmit("studio:screen:stop", {
      fromConnectionId: sharingRemote.connectionId,
      fromName: sharingRemote.name,
      shareId: "share-old",
    });
    socket.reply("studio:join", joinSuccess({
      participants: [self, sharingRemote],
      screenShares: [
        {
          connectionId: sharingRemote.connectionId,
          shareId: "share-old",
          label: "이전 화면",
        },
      ],
    }));
    await connecting;
    activate(transport);

    expect(received).toContainEqual(
      expect.objectContaining({
        kind: "screen:announce",
        payload: { shareId: "share-new", label: "새 화면" },
      })
    );
    expect(
      received.some(
        (event) =>
          event.kind === "screen:announce" &&
          (event.payload as { shareId?: string }).shareId === "share-old"
      )
    ).toBe(false);
    transport.close();
  });

  it("applies a matching stop received after the ACK but before the room flushes", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const sharingRemote = { ...remote, sharingScreen: true };
    socket.joinResponse = joinSuccess({
      participants: [self, sharingRemote],
      screenShares: [
        {
          connectionId: sharingRemote.connectionId,
          shareId: "share-ending",
          label: "종료 중인 화면",
        },
      ],
    });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));

    await transport.connect();
    socket.serverEmit("studio:screen:stop", {
      fromConnectionId: sharingRemote.connectionId,
      fromName: sharingRemote.name,
      shareId: "share-ending",
    });
    activate(transport);

    expect(received.some((event) => event.kind === "screen:announce")).toBe(false);
    expect(received.some((event) => event.kind === "screen:stop")).toBe(false);
    transport.close();
  });

  it("reconciles a replaced active share across reconnect generations", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const sharingRemote = { ...remote, sharingScreen: true };
    socket.joinResponse = joinSuccess({
      participants: [self, sharingRemote],
      screenShares: [
        { connectionId: sharingRemote.connectionId, shareId: "share-old", label: "이전 화면" },
      ],
    });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));
    await transport.connect();
    activate(transport);
    received.length = 0;

    socket.serverDisconnect();
    socket.joinResponse = joinSuccess({
      participants: [self, sharingRemote],
      screenShares: [
        { connectionId: sharingRemote.connectionId, shareId: "share-new", label: "새 화면" },
      ],
    });
    socket.serverReconnect();
    await vi.waitFor(() => expect(transport.ready).toBe(true));

    expect(
      received
        .filter((event) => event.kind === "screen:stop" || event.kind === "screen:announce")
        .map((event) => [event.kind, (event.payload as { shareId: string }).shareId])
    ).toEqual([
      ["screen:stop", "share-old"],
      ["screen:announce", "share-new"],
    ]);
    transport.close();
  });

  it.each([
    {
      name: "an explicit access revocation",
      trigger: (socket: FakeSocket) => socket.serverEmit("studio:access:revoked", {
        workId: "work-1",
        message: "팀 권한이 회수되었습니다.",
      }),
    },
    {
      name: "an unauthenticated server failure",
      trigger: (socket: FakeSocket) => socket.serverEmit("studio:error", {
        ok: false,
        code: "unauthenticated",
        message: "로그인 세션이 만료되었습니다.",
      }),
    },
    {
      name: "a terminal reconnect rejection",
      trigger: (socket: FakeSocket) => {
        socket.serverDisconnect();
        socket.serverEmit(
          "connect_error",
          Object.assign(new Error("로그인 세션이 만료되었습니다."), {
            data: { code: "unauthenticated" },
          })
        );
      },
    },
  ])("scrubs in-memory credentials after $name", async ({ trigger }) => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();

    trigger(socket);

    expect(transport.ready).toBe(false);
    expect(socket.connected).toBe(false);
    expect(socket.auth).toEqual({});
    expect(
      (transport as unknown as { sessionToken: string | null }).sessionToken
    ).toBeNull();
    transport.close();
  });

  it("replays bounded pre-ACK presence deltas over the adapter snapshot", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:join");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));
    const departed = serverParticipant(
      "connection-departed",
      "departed-client-instance",
      "퇴장한 어시스턴트"
    );
    const departedAfterAck = serverParticipant(
      "connection-departed-after-ack",
      "departed-after-ack-client-instance",
      "ACK 뒤 퇴장한 어시스턴트"
    );

    const connecting = transport.connect();
    socket.serverEmit("studio:presence:update", {
      ...remote,
      state: "idle",
      pageId: "page-after-snapshot",
      updatedAt: new Date(NOW + 1).toISOString(),
    });
    socket.serverEmit("studio:presence:leave", {
      connectionId: departed.connectionId,
      reason: "disconnect",
    });
    socket.reply("studio:join", joinSuccess({
      participants: [self, remote, departed, departedAfterAck],
    }));
    await connecting;
    socket.serverEmit("studio:presence:update", {
      ...remote,
      state: "away",
      pageId: "page-after-ack",
      updatedAt: new Date(NOW + 2).toISOString(),
    });
    socket.serverEmit("studio:presence:leave", {
      connectionId: departedAfterAck.connectionId,
      reason: "disconnect",
    });
    activate(transport);

    expect(received).toEqual([
      expect.objectContaining({
        kind: "presence:heartbeat",
        sender: expect.objectContaining({ sessionId: remote.connectionId }),
        payload: expect.objectContaining({
          visibility: "idle",
          pageId: "page-after-ack",
        }),
      }),
    ]);
    transport.close();
  });

  it("replays exact lock releases received before and after the join ACK", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:join");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const controls: StudioLiveTransportControlEvent[] = [];
    transport.subscribeControl((event) => controls.push(event));
    const remoteLock = (resourceId: string, leaseId: string) => ({
      resourceId,
      leaseId,
      ownerConnectionId: remote.connectionId,
      ownerName: remote.name,
      expiresAt: new Date(NOW + 15_000).toISOString(),
    });
    const releasedBeforeAck = remoteLock("page:before-ack-release", "lease-released-before-ack");
    const releasedAfterAck = remoteLock("page:after-ack-release", "lease-released-after-ack");

    const connecting = transport.connect();
    socket.serverEmit("studio:lock:update", {
      action: "released",
      resourceId: releasedBeforeAck.resourceId,
      leaseId: releasedBeforeAck.leaseId,
    });
    socket.reply("studio:join", joinSuccess({
      locks: [releasedBeforeAck, releasedAfterAck],
    }));
    await connecting;
    socket.serverEmit("studio:lock:update", {
      action: "released",
      resourceId: releasedAfterAck.resourceId,
      leaseId: releasedAfterAck.leaseId,
    });
    activate(transport);

    const finalClaims = new Map<string, string>();
    for (const event of controls) {
      if (event.type !== "lock") continue;
      if (event.lock.action === "acquired") {
        finalClaims.set(event.lock.resource, event.lock.claimId);
      } else if (finalClaims.get(event.lock.resource) === event.lock.claimId) {
        finalClaims.delete(event.lock.resource);
      }
    }
    expect([...finalClaims.entries()]).toEqual([]);
    transport.close();
  });

  it("uses the revision snapshot floor and per-resource tombstone to reject stale resurrection", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = revisionJoinSuccess("10");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const controls: StudioLiveTransportControlEvent[] = [];
    transport.subscribeControl((event) => controls.push(event));
    await transport.connect();
    activate(transport);

    const resourceId = "page:revision-fence";
    const atSnapshotFloor = revisionLock(resourceId, "lease-at-floor", "10");
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      revision: "10",
      lock: atSnapshotFloor,
    });
    expect(controls.filter((event) => event.type === "lock")).toEqual([]);

    const current = revisionLock(resourceId, "lease-current-r12", "12");
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      revision: "12",
      lock: current,
    });
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      revision: "11",
      lock: revisionLock(resourceId, "lease-stale-r11", "11"),
    });
    socket.serverEmit("studio:lock:update", {
      action: "revoked",
      revision: "13",
      resourceId,
      leaseId: current.leaseId,
    });
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      revision: "12",
      lock: current,
    });

    expect(controls.filter((event) => event.type === "lock")).toEqual([
      {
        type: "lock",
        lock: expect.objectContaining({
          action: "acquired",
          resource: resourceId,
          claimId: current.leaseId,
        }),
      },
      {
        type: "lock",
        lock: {
          action: "released",
          resource: resourceId,
          claimId: current.leaseId,
        },
      },
    ]);
    expect(transport.ready).toBe(true);
    transport.close();
  });

  it("accepts out-of-order revisions when they belong to different resources", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = revisionJoinSuccess("10");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const controls: StudioLiveTransportControlEvent[] = [];
    transport.subscribeControl((event) => controls.push(event));
    await transport.connect();
    activate(transport);

    const first = revisionLock("page:resource-r12", "lease-resource-r12", "12");
    const second = revisionLock("page:resource-r11", "lease-resource-r11", "11");
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      revision: "12",
      lock: first,
    });
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      revision: "11",
      lock: second,
    });

    expect(
      controls
        .filter((event) => event.type === "lock" && event.lock.action === "acquired")
        .map((event) => event.type === "lock" ? event.lock.claimId : null)
    ).toEqual([first.leaseId, second.leaseId]);
    expect(transport.ready).toBe(true);
    transport.close();
  });

  it("reconciles out-of-order page and element locks across different owners", async () => {
    const secondRemote = serverParticipant(
      "connection-remote-second",
      "remote-client-instance-second",
      "콘티 어시스턴트"
    );
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = revisionJoinSuccess("10", {
      participants: [self, remote, secondRemote],
    });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const controls: StudioLiveTransportControlEvent[] = [];
    transport.subscribeControl((event) => controls.push(event));
    await transport.connect();
    activate(transport);

    const stalePage = revisionLock("page:hierarchy", "lease-page-r11", "11", secondRemote);
    const newerElement = revisionLock(
      "element:hierarchy:panel-1",
      "lease-element-r13",
      "13",
      remote
    );
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      revision: "11",
      lock: stalePage,
    });
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      revision: "13",
      lock: newerElement,
    });
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      revision: "11",
      lock: stalePage,
    });

    expect(controls.filter((event) => event.type === "lock")).toEqual([
      {
        type: "lock",
        lock: expect.objectContaining({
          action: "acquired",
          resource: stalePage.resourceId,
          claimId: stalePage.leaseId,
        }),
      },
      {
        type: "lock",
        lock: {
          action: "released",
          resource: stalePage.resourceId,
          claimId: stalePage.leaseId,
        },
      },
      {
        type: "lock",
        lock: expect.objectContaining({
          action: "acquired",
          resource: newerElement.resourceId,
          claimId: newerElement.leaseId,
        }),
      },
    ]);
    expect(transport.ready).toBe(true);
    transport.close();
  });

  it("resyncs when a newer conflicting destructive event cannot order an older acquire", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = revisionJoinSuccess("10");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const controls: StudioLiveTransportControlEvent[] = [];
    transport.subscribeControl((event) => controls.push(event));
    await transport.connect();
    activate(transport);

    socket.serverEmit("studio:lock:update", {
      action: "revoked",
      revision: "12",
      resourceId: "element:ambiguous-hierarchy:panel-1",
      leaseId: "lease-unseen-child-r12",
    });
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      revision: "11",
      lock: revisionLock(
        "page:ambiguous-hierarchy",
        "lease-ambiguous-page-r11",
        "11"
      ),
    });

    expect(controls.filter((event) => event.type === "lock")).toEqual([]);
    expect(transport.ready).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(socket.emitted.filter((event) => event.event === "studio:join")).toHaveLength(2);
    transport.close();
  });

  it("applies one destructive revision to every affected resource", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const first = revisionLock("page:batch-release-a", "lease-batch-a", "10");
    const second = revisionLock("page:batch-release-b", "lease-batch-b", "10");
    socket.joinResponse = revisionJoinSuccess("10", { locks: [first, second] });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const controls: StudioLiveTransportControlEvent[] = [];
    transport.subscribeControl((event) => controls.push(event));
    await transport.connect();
    activate(transport);
    controls.length = 0;

    for (const lock of [first, second]) {
      socket.serverEmit("studio:lock:update", {
        action: "revoked",
        revision: "11",
        resourceId: lock.resourceId,
        leaseId: lock.leaseId,
      });
    }

    expect(controls.filter((event) => event.type === "lock")).toEqual([
      {
        type: "lock",
        lock: { action: "released", resource: first.resourceId, claimId: first.leaseId },
      },
      {
        type: "lock",
        lock: { action: "released", resource: second.resourceId, claimId: second.leaseId },
      },
    ]);
    expect(transport.ready).toBe(true);
    transport.close();
  });

  it("allows multiple destructive fences for one resource at the same revision", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const initial = revisionLock("page:multi-fence-release", "lease-visible", "10");
    socket.joinResponse = revisionJoinSuccess("10", { locks: [initial] });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const controls: StudioLiveTransportControlEvent[] = [];
    transport.subscribeControl((event) => controls.push(event));
    await transport.connect();
    activate(transport);
    controls.length = 0;

    socket.serverEmit("studio:lock:update", {
      action: "released",
      revision: "11",
      resourceId: initial.resourceId,
      leaseId: initial.leaseId,
    });
    socket.serverEmit("studio:lock:update", {
      action: "revoked",
      revision: "11",
      resourceId: initial.resourceId,
      leaseId: "lease-hidden-same-revision",
    });
    const next = revisionLock(initial.resourceId, "lease-after-multi-fence", "12");
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      revision: "12",
      lock: next,
    });

    expect(transport.ready).toBe(true);
    expect(controls.filter((event) => event.type === "lock")).toEqual([
      {
        type: "lock",
        lock: {
          action: "released",
          resource: initial.resourceId,
          claimId: initial.leaseId,
        },
      },
      {
        type: "lock",
        lock: expect.objectContaining({
          action: "acquired",
          resource: next.resourceId,
          claimId: next.leaseId,
        }),
      },
    ]);
    transport.close();
  });

  it.each([
    ["missing", undefined],
    ["malformed", "01"],
  ])("resyncs a revision-v1 room after a %s lock revision", async (_label, revision) => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = revisionJoinSuccess("10");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();
    activate(transport);

    const lock = {
      ...revisionLock("page:invalid-revision", "lease-invalid-revision", "11"),
      ...(revision === undefined ? { revision: undefined } : { revision }),
    };
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      ...(revision === undefined ? {} : { revision }),
      lock,
    });

    expect(transport.ready).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(socket.emitted.filter((event) => event.event === "studio:join")).toHaveLength(2);
    transport.close();
  });

  it("chase-releases an in-flight acquisition ACK that arrives during revision resync", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = revisionJoinSuccess("10");
    socket.holdEvents.add("studio:lock:request");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();
    activate(transport);
    socket.holdEvents.add("studio:join");

    const resource = "page:resync-ack-before-snapshot";
    const requestId = "10101010-aaaa-4010-8010-101010101010";
    const acquisition = transport.acquireLock({ resource, requestId, leaseMs: 15_000 });
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      lock: revisionLock("page:unrelated-invalid-revision", "lease-invalid", "11"),
    });

    await expect(acquisition).resolves.toMatchObject({
      status: "revoked",
      requestId,
      code: "lock_resync",
    });
    const committed = revisionLock(
      resource,
      "10101010-bbbb-4010-8010-101010101010",
      "11",
      self
    );
    socket.reply("studio:lock:request", {
      ok: true,
      data: { decision: "acquired", requestId, lock: committed },
    });

    expect(socket.emitted.filter(({ event }) => event === "studio:lock:release")).toEqual([
      {
        event: "studio:lock:release",
        payload: {
          workId: "work-1",
          resourceId: resource,
          leaseId: committed.leaseId,
          requestId,
        },
      },
    ]);
    await vi.advanceTimersByTimeAsync(500);
    socket.reply("studio:join", revisionJoinSuccess("11"));
    expect(transport.ready).toBe(true);
    expect(
      (transport as unknown as {
        pendingLockAcquisitions: Map<string, unknown>;
        abandonedLockAcquisitions: Map<string, unknown>;
        deferredSelfLocks: Map<string, unknown>;
      })
    ).toMatchObject({
      pendingLockAcquisitions: new Map(),
      abandonedLockAcquisitions: new Map(),
      deferredSelfLocks: new Map(),
    });
    transport.close();
  });

  it("chase-releases a resynced self fence before its old acquisition ACK arrives", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = revisionJoinSuccess("10");
    socket.holdEvents.add("studio:lock:request");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();
    activate(transport);
    socket.holdEvents.add("studio:join");

    const resource = "page:resync-snapshot-before-ack";
    const requestId = "20202020-aaaa-4020-8020-202020202020";
    const acquisition = transport.acquireLock({ resource, requestId, leaseMs: 15_000 });
    const committed = revisionLock(
      resource,
      "20202020-bbbb-4020-8020-202020202020",
      "11",
      self
    );
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      lock: revisionLock("page:unrelated-invalid-snapshot", "lease-invalid", "11"),
    });
    await expect(acquisition).resolves.toMatchObject({
      status: "revoked",
      requestId,
      code: "lock_resync",
    });

    await vi.advanceTimersByTimeAsync(500);
    socket.reply("studio:join", revisionJoinSuccess("11", { locks: [committed] }));
    socket.reply("studio:lock:request", {
      ok: true,
      data: { decision: "acquired", requestId, lock: committed },
    });

    expect(socket.emitted.filter(({ event }) => event === "studio:lock:release")).toEqual([
      {
        event: "studio:lock:release",
        payload: {
          workId: "work-1",
          resourceId: resource,
          leaseId: committed.leaseId,
          requestId,
        },
      },
    ]);
    expect(transport.ready).toBe(true);
    expect(
      (transport as unknown as {
        pendingLockAcquisitions: Map<string, unknown>;
        abandonedLockAcquisitions: Map<string, unknown>;
        deferredSelfLocks: Map<string, unknown>;
      })
    ).toMatchObject({
      pendingLockAcquisitions: new Map(),
      abandonedLockAcquisitions: new Map(),
      deferredSelfLocks: new Map(),
    });
    transport.close();
  });

  it("keeps a resync-abandoned acquisition chaseable after its original ACK timeout", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = revisionJoinSuccess("10");
    socket.holdEvents.add("studio:lock:request");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
      lockAckTimeoutMs: 100,
    });
    await transport.connect();
    activate(transport);
    socket.holdEvents.add("studio:join");

    const resource = "page:resync-after-ack-timeout";
    const requestId = "30303030-aaaa-4030-8030-303030303030";
    const acquisition = transport.acquireLock({ resource, requestId, leaseMs: 15_000 });
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      lock: revisionLock("page:unrelated-timeout-resync", "lease-invalid", "11"),
    });
    await expect(acquisition).resolves.toMatchObject({
      status: "revoked",
      requestId,
      code: "lock_resync",
    });

    await vi.advanceTimersByTimeAsync(500);
    socket.reply("studio:join", revisionJoinSuccess("10"));
    await vi.advanceTimersByTimeAsync(100);
    const committed = revisionLock(
      resource,
      "30303030-bbbb-4030-8030-303030303030",
      "11",
      self
    );
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      requestId,
      revision: "11",
      lock: committed,
    });

    expect(socket.emitted.filter(({ event }) => event === "studio:lock:release")).toEqual([
      {
        event: "studio:lock:release",
        payload: {
          workId: "work-1",
          resourceId: resource,
          leaseId: committed.leaseId,
          requestId,
        },
      },
    ]);
    expect(transport.ready).toBe(true);
    expect(
      (transport as unknown as {
        pendingLockAcquisitions: Map<string, unknown>;
        abandonedLockAcquisitions: Map<string, unknown>;
        deferredSelfLocks: Map<string, unknown>;
      })
    ).toMatchObject({
      pendingLockAcquisitions: new Map(),
      abandonedLockAcquisitions: new Map(),
      deferredSelfLocks: new Map(),
    });
    transport.close();
  });

  it("advances the resource watermark only for a successful release ACK", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = revisionJoinSuccess("10");
    socket.holdEvents.add("studio:lock:request");
    socket.holdEvents.add("studio:lock:release");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const controls: StudioLiveTransportControlEvent[] = [];
    transport.subscribeControl((event) => controls.push(event));
    await transport.connect();
    activate(transport);

    const releasedResource = "page:release-ack-true";
    const releasedRequestId = "11111111-aaaa-4111-8111-111111111111";
    const acquired = transport.acquireLock({
      resource: releasedResource,
      requestId: releasedRequestId,
      leaseMs: 15_000,
    });
    const releasedLock = revisionLock(
      releasedResource,
      "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      "11",
      self
    );
    socket.reply("studio:lock:request", {
      ok: true,
      data: { decision: "acquired", requestId: releasedRequestId, lock: releasedLock },
    });
    await expect(acquired).resolves.toMatchObject({ status: "acquired" });

    const releaseRequestId = "22222222-aaaa-4222-8222-222222222222";
    const release = transport.releaseLock({
      resource: releasedResource,
      requestId: releaseRequestId,
      claimId: releasedLock.leaseId,
    });
    socket.reply("studio:lock:release", {
      ok: true,
      data: {
        requestId: releaseRequestId,
        resourceId: releasedResource,
        leaseId: releasedLock.leaseId,
        released: true,
        revision: "20",
      },
    });
    await expect(release).resolves.toMatchObject({ status: "released", released: true });
    controls.length = 0;
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      revision: "12",
      lock: revisionLock(releasedResource, "lease-stale-after-release", "12"),
    });
    expect(controls.filter((event) => event.type === "lock")).toEqual([]);

    const retainedResource = "page:release-ack-false";
    const retainedRequestId = "33333333-aaaa-4333-8333-333333333333";
    const retainedAcquisition = transport.acquireLock({
      resource: retainedResource,
      requestId: retainedRequestId,
      leaseMs: 15_000,
    });
    const retainedLock = revisionLock(
      retainedResource,
      "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
      "21",
      self
    );
    socket.reply("studio:lock:request", {
      ok: true,
      data: { decision: "acquired", requestId: retainedRequestId, lock: retainedLock },
    });
    await expect(retainedAcquisition).resolves.toMatchObject({ status: "acquired" });

    const absentReleaseRequestId = "44444444-aaaa-4444-8444-444444444444";
    const absentRelease = transport.releaseLock({
      resource: retainedResource,
      requestId: absentReleaseRequestId,
      claimId: retainedLock.leaseId,
    });
    socket.reply("studio:lock:release", {
      ok: true,
      data: {
        requestId: absentReleaseRequestId,
        resourceId: retainedResource,
        leaseId: retainedLock.leaseId,
        released: false,
        revision: "30",
      },
    });
    await expect(absentRelease).resolves.toMatchObject({ status: "released", released: false });
    controls.length = 0;
    const replacement = revisionLock(retainedResource, "lease-after-false-ack", "22");
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      revision: "22",
      lock: replacement,
    });
    expect(controls.filter((event) => event.type === "lock")).toEqual([
      {
        type: "lock",
        lock: expect.objectContaining({
          action: "acquired",
          resource: retainedResource,
          claimId: replacement.leaseId,
        }),
      },
    ]);
    expect(transport.ready).toBe(true);
    transport.close();
  });

  it.each([
    ["missing revision", { released: true }],
    ["mismatched scope", { released: true, revision: "12", resourceId: "page:wrong" }],
  ])("resyncs revision v1 after a successful release ACK with %s", async (_label, override) => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = revisionJoinSuccess("10");
    socket.holdEvents.add("studio:lock:request");
    socket.holdEvents.add("studio:lock:release");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();
    activate(transport);

    const resource = "page:invalid-release-ack";
    const acquireRequestId = "77777777-aaaa-4777-8777-777777777777";
    const acquisition = transport.acquireLock({
      resource,
      requestId: acquireRequestId,
      leaseMs: 15_000,
    });
    const lock = revisionLock(
      resource,
      "dddddddd-4444-4444-8444-dddddddddddd",
      "11",
      self
    );
    socket.reply("studio:lock:request", {
      ok: true,
      data: { decision: "acquired", requestId: acquireRequestId, lock },
    });
    await expect(acquisition).resolves.toMatchObject({ status: "acquired" });

    const releaseRequestId = "88888888-aaaa-4888-8888-888888888888";
    const release = transport.releaseLock({
      resource,
      requestId: releaseRequestId,
      claimId: lock.leaseId,
    });
    socket.reply("studio:lock:release", {
      ok: true,
      data: {
        requestId: releaseRequestId,
        resourceId: resource,
        leaseId: lock.leaseId,
        ...override,
      },
    });

    await expect(release).resolves.toMatchObject({ status: "denied" });
    expect(transport.ready).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(socket.emitted.filter((event) => event.event === "studio:join")).toHaveLength(2);
    transport.close();
  });

  it("never resolves a stale acquisition ACK as acquired", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = revisionJoinSuccess("10");
    socket.holdEvents.add("studio:lock:request");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const controls: StudioLiveTransportControlEvent[] = [];
    transport.subscribeControl((event) => controls.push(event));
    await transport.connect();
    activate(transport);

    const resource = "page:stale-acquisition-ack";
    socket.serverEmit("studio:lock:update", {
      action: "revoked",
      revision: "12",
      resourceId: resource,
      leaseId: "lease-already-revoked",
    });
    const requestId = "55555555-aaaa-4555-8555-555555555555";
    const acquisition = transport.acquireLock({ resource, requestId, leaseMs: 15_000 });
    socket.reply("studio:lock:request", {
      ok: true,
      data: {
        decision: "acquired",
        requestId,
        lock: revisionLock(
          resource,
          "cccccccc-3333-4333-8333-cccccccccccc",
          "11",
          self
        ),
      },
    });

    const result = await acquisition;
    expect(result.status).not.toBe("acquired");
    expect(
      controls.some(
        (event) =>
          event.type === "lock" &&
          event.lock.action === "acquired" &&
          event.lock.resource === resource
      )
    ).toBe(false);
    expect(transport.ready).toBe(true);
    transport.close();
  });

  it("uses a revisioned conflict ACK as an authoritative watermark", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = revisionJoinSuccess("10");
    socket.holdEvents.add("studio:lock:request");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const controls: StudioLiveTransportControlEvent[] = [];
    transport.subscribeControl((event) => controls.push(event));
    await transport.connect();
    activate(transport);

    const resource = "page:revisioned-conflict";
    const requestId = "66666666-aaaa-4666-8666-666666666666";
    const acquisition = transport.acquireLock({ resource, requestId, leaseMs: 15_000 });
    const conflict = revisionLock(resource, "lease-conflict-r20", "20");
    socket.reply("studio:lock:request", {
      ok: false,
      decision: "denied",
      requestId,
      code: "lock_conflict",
      message: "다른 팀원이 편집 중입니다.",
      lock: conflict,
    });

    await expect(acquisition).resolves.toMatchObject({
      status: "denied",
      code: "lock_conflict",
      lock: { resource, claimId: conflict.leaseId },
    });
    expect(controls.filter((event) => event.type === "lock")).toEqual([
      {
        type: "lock",
        lock: expect.objectContaining({
          action: "acquired",
          resource,
          claimId: conflict.leaseId,
        }),
      },
    ]);

    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      revision: "12",
      lock: revisionLock(resource, "lease-stale-after-conflict", "12"),
    });
    expect(controls.filter((event) => event.type === "lock")).toHaveLength(1);
    expect(transport.ready).toBe(true);
    transport.close();
  });

  it("rejects a reconnect snapshot whose revision regresses below committed live updates", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = revisionJoinSuccess("10");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();
    activate(transport);
    const current = revisionLock("page:reconnect-revision", "lease-r12", "12");
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      revision: "12",
      lock: current,
    });

    socket.holdEvents.add("studio:join");
    socket.serverDisconnect();
    socket.serverReconnect();
    socket.reply("studio:join", revisionJoinSuccess("11", {
      locks: [{ ...current, revision: "11" }],
    }));

    expect(transport.ready).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(socket.emitted.filter((event) => event.event === "studio:join")).toHaveLength(3);
    socket.reply("studio:join", revisionJoinSuccess("12", { locks: [current] }));
    expect(transport.ready).toBe(true);
    transport.close();
  });

  it("rejects a legacy downgrade even before the first revision-v1 snapshot flush", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = revisionJoinSuccess("10");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();

    socket.holdEvents.add("studio:join");
    socket.serverDisconnect();
    socket.serverReconnect();
    socket.reply("studio:join", joinSuccess());

    expect(transport.ready).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(socket.emitted.filter((event) => event.event === "studio:join")).toHaveLength(3);
    socket.reply("studio:join", revisionJoinSuccess("10"));
    expect(transport.ready).toBe(true);
    transport.close();
  });

  it("resyncs instead of letting an ambiguous acquired delta overwrite a newer snapshot fence", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:join");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const controls: StudioLiveTransportControlEvent[] = [];
    transport.subscribeControl((event) => controls.push(event));
    const stale = {
      resourceId: "page:ambiguous-fence",
      leaseId: "lease-stale-before-snapshot",
      ownerConnectionId: remote.connectionId,
      ownerName: remote.name,
      expiresAt: new Date(NOW + 15_000).toISOString(),
    };
    const current = { ...stale, leaseId: "lease-current-in-snapshot" };

    const connecting = transport.connect();
    socket.serverEmit("studio:lock:update", { action: "acquired", lock: stale });
    socket.reply("studio:join", joinSuccess({ locks: [current] }));
    await connecting;
    activate(transport);

    expect(transport.ready).toBe(false);
    expect(controls.filter((event) => event.type === "lock")).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    socket.reply("studio:join", joinSuccess({ locks: [current] }));

    expect(transport.ready).toBe(true);
    expect(controls.filter((event) => event.type === "lock")).toEqual([{
      type: "lock",
      lock: expect.objectContaining({
        action: "acquired",
        resource: current.resourceId,
        claimId: current.leaseId,
      }),
    }]);
    transport.close();
  });

  it("requests a fresh join snapshot instead of dropping an overflowing lock delta history", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:join");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const controls: StudioLiveTransportControlEvent[] = [];
    transport.subscribeControl((event) => controls.push(event));

    const connecting = transport.connect();
    for (let index = 0; index < 513; index += 1) {
      socket.serverEmit("studio:lock:update", {
        action: "acquired",
        lock: {
          resourceId: `page:overflow-${index}`,
          leaseId: `lease-overflow-${index}`,
          ownerConnectionId: remote.connectionId,
          ownerName: remote.name,
          expiresAt: new Date(NOW + 15_000).toISOString(),
        },
      });
    }
    socket.reply("studio:join", joinSuccess());
    await connecting;
    activate(transport);

    expect(transport.ready).toBe(false);
    expect(socket.emitted.filter((entry) => entry.event === "studio:join")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(socket.emitted.filter((entry) => entry.event === "studio:join")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.emitted.filter((entry) => entry.event === "studio:join")).toHaveLength(2);
    const freshLock = {
      resourceId: "page:fresh-after-overflow",
      leaseId: "lease-fresh-after-overflow",
      ownerConnectionId: remote.connectionId,
      ownerName: remote.name,
      expiresAt: new Date(NOW + 15_000).toISOString(),
    };
    socket.reply("studio:join", joinSuccess({ locks: [freshLock] }));

    expect(transport.ready).toBe(true);
    expect(controls.filter((event) => event.type === "lock")).toEqual([{
      type: "lock",
      lock: expect.objectContaining({
        action: "acquired",
        resource: freshLock.resourceId,
        claimId: freshLock.leaseId,
      }),
    }]);
    transport.close();
  });

  it("keeps reconnect status unready and retries an overflow resync after a recoverable failure", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const statuses: string[] = [];
    transport.subscribeControl((event) => {
      if (event.type === "status") statuses.push(event.status.state);
    });
    await transport.connect();
    activate(transport);
    socket.holdEvents.add("studio:join");
    socket.serverDisconnect();
    socket.serverReconnect();

    for (let index = 0; index < 513; index += 1) {
      socket.serverEmit("studio:lock:update", {
        action: "acquired",
        lock: {
          resourceId: `page:reconnect-overflow-${index}`,
          leaseId: `lease-reconnect-overflow-${index}`,
          ownerConnectionId: remote.connectionId,
          ownerName: remote.name,
          expiresAt: new Date(NOW + 15_000).toISOString(),
        },
      });
    }
    socket.reply("studio:join", joinSuccess());

    expect(transport.ready).toBe(false);
    expect(statuses.at(-1)).toBe("connecting");
    await vi.advanceTimersByTimeAsync(500);
    expect(socket.emitted.filter((entry) => entry.event === "studio:join")).toHaveLength(3);
    socket.reply("studio:join", {
      ok: false,
      code: "rate_limited",
      message: "잠시 후 다시 시도해 주세요.",
    });

    expect(transport.ready).toBe(false);
    expect(statuses.at(-1)).toBe("error");
    await vi.advanceTimersByTimeAsync(59_999);
    expect(socket.emitted.filter((entry) => entry.event === "studio:join")).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.emitted.filter((entry) => entry.event === "studio:join")).toHaveLength(4);
    socket.reply("studio:join", joinSuccess());

    expect(transport.ready).toBe(true);
    expect(statuses.at(-1)).toBe("ready");
    transport.close();
  });

  it("rejects an uncorrelated v2 self-lock broadcast without rejecting the join snapshot", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const trustedSnapshotLock = {
      resourceId: "page:trusted-self-snapshot",
      leaseId: "lease-trusted-self-snapshot",
      ownerConnectionId: self.connectionId,
      ownerName: self.name,
      expiresAt: new Date(NOW + 15_000).toISOString(),
    };
    socket.joinResponse = joinSuccess({
      lockProtocolVersion: 2,
      locks: [trustedSnapshotLock],
    });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const controls: StudioLiveTransportControlEvent[] = [];
    transport.subscribeControl((event) => controls.push(event));
    await transport.connect();
    activate(transport);
    expect(controls).toContainEqual({
      type: "lock",
      lock: expect.objectContaining({
        action: "acquired",
        resource: trustedSnapshotLock.resourceId,
        claimId: trustedSnapshotLock.leaseId,
      }),
    });
    controls.length = 0;
    const uncorrelatedLeaseId = "lease-uncorrelated-self-broadcast";

    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      lock: {
        resourceId: "page:uncorrelated-self-broadcast",
        leaseId: uncorrelatedLeaseId,
        ownerConnectionId: self.connectionId,
        ownerName: self.name,
        expiresAt: new Date(NOW + 15_000).toISOString(),
      },
    });

    expect(controls).toEqual([]);
    expect(transport.send(envelope("lock:release", {
      resource: "page:uncorrelated-self-broadcast",
      claimId: uncorrelatedLeaseId,
    }, 2))).toBe(false);
    transport.close();
  });

  it("rejects an uncorrelated legacy self-lock broadcast", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const controls: StudioLiveTransportControlEvent[] = [];
    transport.subscribeControl((event) => controls.push(event));
    await transport.connect();
    activate(transport);

    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      lock: {
        resourceId: "page:legacy-uncorrelated-self",
        leaseId: "lease-legacy-uncorrelated-self",
        ownerConnectionId: self.connectionId,
        ownerName: self.name,
        expiresAt: new Date(NOW + 15_000).toISOString(),
      },
    });

    expect(controls.filter((event) => event.type === "lock")).toEqual([]);
    transport.close();
  });

  it("does not allow a direct lock request before the initial snapshot is committed", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();

    await expect(transport.acquireLock({
      resource: "page:before-initial-snapshot",
      requestId: "00000000-0000-4000-8000-000000000090",
      leaseMs: 15_000,
    })).resolves.toMatchObject({
      status: "revoked",
      code: "not_ready",
    });
    expect(socket.emitted.filter((entry) => entry.event === "studio:lock:request")).toEqual([]);

    activate(transport);
    transport.close();
  });

  it("treats a rolling-deploy legacy presence snapshot as merge-only", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));
    await transport.connect();
    activate(transport);
    received.length = 0;

    socket.serverEmit("studio:presence:snapshot", {
      workId: "work-1",
      participants: [self],
    });
    socket.serverEmit("studio:cursor", {
      connectionId: remote.connectionId,
      pageId: "page-still-present",
      x: 0.25,
      y: 0.75,
    });

    expect(received).toEqual([
      expect.objectContaining({
        kind: "cursor:update",
        sender: expect.objectContaining({ sessionId: remote.connectionId }),
        payload: expect.objectContaining({ pageId: "page-still-present" }),
      }),
    ]);
    transport.close();
  });

  it("translates authoritative participants and every targeted screen/WebRTC event", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));
    await transport.connect();
    activate(transport);
    received.length = 0;

    socket.serverEmit("studio:screen:announce", {
      fromConnectionId: remote.connectionId,
      fromName: remote.name,
      shareId: "share-1",
      label: "작업 화면",
    });
    socket.serverEmit("studio:screen:request", {
      fromConnectionId: remote.connectionId,
      fromName: remote.name,
      shareId: "share-1",
    });
    socket.serverEmit("studio:screen:access", {
      fromConnectionId: remote.connectionId,
      fromName: remote.name,
      shareId: "share-1",
      decision: "approved",
    });
    socket.serverEmit("studio:signal", {
      signalId: "signal-1",
      fromConnectionId: remote.connectionId,
      fromName: remote.name,
      shareId: "share-description-direct",
      kind: "description",
      description: { type: "offer", sdp: "v=0\r\no=remote" },
    });
    socket.serverEmit("studio:signal", {
      signalId: "signal-2",
      fromConnectionId: remote.connectionId,
      fromName: remote.name,
      shareId: "share-candidate-direct",
      kind: "candidate",
      candidate: {
        candidate: "candidate:1",
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: null,
      },
    });
    socket.serverEmit("studio:signal", {
      signalId: "signal-3",
      fromConnectionId: remote.connectionId,
      fromName: remote.name,
      shareId: "share-bye-direct",
      kind: "bye",
    });
    socket.serverEmit("studio:screen:stop", {
      fromConnectionId: remote.connectionId,
      fromName: remote.name,
      shareId: "share-1",
    });

    expect(received.map((value) => value.kind)).toEqual([
      "screen:announce",
      "screen:request",
      "screen:access",
      "webrtc:description",
      "webrtc:ice",
      "screen:access",
      "screen:stop",
    ]);
    expect(received.slice(1, 6).every((value) => value.targetSessionId === localParticipant.sessionId)).toBe(
      true
    );
    expect(received.every((value) => value.sender.sessionId === remote.connectionId)).toBe(true);
    expect(received.some((value) => value.sender.sessionId === self.connectionId)).toBe(false);
    expect((received[3]?.payload as { shareId?: string }).shareId).toBe(
      "share-description-direct"
    );
    expect((received[4]?.payload as { shareId?: string }).shareId).toBe(
      "share-candidate-direct"
    );
    expect((received[5]?.payload as { shareId?: string }).shareId).toBe("share-bye-direct");

    expect(
      transport.send(
        envelope("screen:request", { shareId: "share-2" }, 2, remote.connectionId)
      )
    ).toBe(true);
    expect(
      transport.send(
        envelope(
          "screen:access",
          { shareId: "share-2", decision: "rejected" },
          3,
          remote.connectionId
        )
      )
    ).toBe(true);
    expect(
      transport.send(
        envelope(
          "webrtc:description",
          { shareId: "share-2", type: "offer", sdp: "v=0" },
          4,
          remote.connectionId
        )
      )
    ).toBe(true);
    expect(
      transport.send(
        envelope(
          "webrtc:ice",
          {
            shareId: "share-2",
            candidate: "candidate:outbound",
            sdpMid: "0",
            sdpMLineIndex: 0,
            usernameFragment: null,
          },
          5,
          remote.connectionId
        )
      )
    ).toBe(true);
    expect(transport.send(envelope("screen:stop", { shareId: "share-2" }, 6))).toBe(true);

    expect(socket.emitted.slice(-5).map((value) => value.event)).toEqual([
      "studio:screen:request",
      "studio:screen:access",
      "studio:signal",
      "studio:signal",
      "studio:screen:stop",
    ]);
    expect(socket.emitted.at(-3)?.payload).toEqual(
      expect.objectContaining({ shareId: "share-2", kind: "description" })
    );
    expect(socket.emitted.at(-2)?.payload).toEqual(
      expect.objectContaining({ shareId: "share-2", kind: "candidate" })
    );
    expect(JSON.stringify(socket.emitted)).not.toContain(TOKEN);
    transport.close();
  });

  it("preserves active-tool metadata through presence while keeping cursor payloads rollout-compatible", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));
    await transport.connect();
    activate(transport);
    received.length = 0;

    expect(
      transport.send(
        envelope(
          "presence:heartbeat",
          { visibility: "active", pageId: "page-1", tool: "pen" },
          2
        )
      )
    ).toBe(true);
    expect(socket.emitted.at(-1)).toEqual({
      event: "studio:presence",
      payload: { workId: "work-1", state: "active", pageId: "page-1", tool: "pen" },
    });

    expect(
      transport.send(
        envelope(
          "cursor:update",
          { x: 0.25, y: 0.75, pageId: "page-1", tool: "pen" },
          3
        )
      )
    ).toBe(true);
    expect(socket.emitted.at(-1)).toEqual({
      event: "studio:cursor",
      payload: {
        workId: "work-1",
        pageId: "page-1",
        x: 0.25,
        y: 0.75,
      },
    });

    socket.serverEmit("studio:presence:update", { ...remote, tool: "bubble" });
    received.length = 0;
    socket.serverEmit("studio:cursor", {
      connectionId: remote.connectionId,
      pageId: "page-1",
      x: 0.5,
      y: 0.6,
    });
    expect(received.at(-1)).toEqual(
      expect.objectContaining({
        kind: "cursor:update",
        payload: { x: 0.5, y: 0.6, pageId: "page-1", tool: "bubble" },
      })
    );

    transport.close();
  });

  it("round-trips strict gesture previews without rebuilding payloads and preserves canonical peer mapping", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));
    await transport.connect();
    activate(transport);
    received.length = 0;

    const outbound = envelope("preview:gesture", gesturePreview(), 2);
    expect(transport.send(outbound)).toBe(true);
    const outboundRecord = socket.emitted.at(-1);
    expect(outboundRecord).toEqual({
      event: "studio:gesture:preview",
      payload: {
        workId: "work-1",
        preview: outbound.payload,
      },
    });
    expect(
      (outboundRecord?.payload as { preview?: unknown } | undefined)?.preview
    ).toBe(outbound.payload);

    const inbound = gesturePreview("gesture-socket-remote");
    socket.serverEmit("studio:gesture:preview", {
      connectionId: remote.connectionId,
      preview: inbound,
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(
      expect.objectContaining({
        kind: "preview:gesture",
        sender: expect.objectContaining({ sessionId: remote.connectionId }),
        payload: inbound,
      })
    );
    expect(transport.canonicalSessionId(received[0]!.sender.sessionId)).toBe(
      remote.clientInstanceId
    );

    socket.serverEmit("studio:gesture:preview", {
      connectionId: remote.connectionId,
      preview: {
        ...inbound,
        renderer: { ...inbound.renderer, brush: "blob:untrusted-brush" },
      },
    });
    socket.serverEmit("studio:gesture:preview", {
      connectionId: remote.connectionId,
      preview: inbound,
      sentAt: new Date(NOW).toISOString(),
    });
    socket.serverEmit("studio:gesture:preview", {
      connectionId: "unknown-connection",
      preview: inbound,
    });
    socket.serverEmit("studio:gesture:preview", {
      connectionId: self.connectionId,
      preview: inbound,
    });
    expect(received).toHaveLength(1);

    transport.close();
    expect(socket.listeners.get("studio:gesture:preview")?.size).toBe(0);
  });

  it("drops a signal without shareId instead of attributing it to an earlier screen lifecycle", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));
    await transport.connect();
    activate(transport);
    received.length = 0;

    socket.serverEmit("studio:screen:announce", {
      fromConnectionId: remote.connectionId,
      fromName: remote.name,
      shareId: "stale-announced-share",
      label: "작업 화면",
    });
    received.length = 0;
    socket.serverEmit("studio:signal", {
      signalId: "missing-share-id",
      fromConnectionId: remote.connectionId,
      fromName: remote.name,
      kind: "description",
      description: { type: "offer", sdp: "v=0" },
    });
    socket.serverEmit("studio:signal", {
      signalId: "explicit-other-share",
      fromConnectionId: remote.connectionId,
      fromName: remote.name,
      shareId: "explicit-other-share",
      kind: "description",
      description: { type: "offer", sdp: "v=0" },
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(
      expect.objectContaining({
        kind: "webrtc:description",
        payload: expect.objectContaining({ shareId: "explicit-other-share" }),
      })
    );
    transport.close();
  });

  it("parses canonical SDP and ICE boundaries without relaxing control-character rules", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));
    await transport.connect();
    activate(transport);
    received.length = 0;

    const emitDescription = (shareId: string, sdp: string) =>
      socket.serverEmit("studio:signal", {
        signalId: `description-${shareId}`,
        fromConnectionId: remote.connectionId,
        fromName: remote.name,
        shareId,
        kind: "description",
        description: { type: "offer", sdp },
      });
    const emitCandidate = (
      shareId: string,
      candidate: string,
      sdpMid: string,
      usernameFragment: string
    ) =>
      socket.serverEmit("studio:signal", {
        signalId: `candidate-${shareId}`,
        fromConnectionId: remote.connectionId,
        fromName: remote.name,
        shareId,
        kind: "candidate",
        candidate: { candidate, sdpMid, sdpMLineIndex: 0, usernameFragment },
      });

    const boundarySdp = `v=0\r\n${"s".repeat(STUDIO_LIVE_SDP_MAX_LENGTH - 7)}`;
    const multibyteSdp = "가".repeat(STUDIO_LIVE_SDP_MAX_LENGTH / 3);
    const escapedSdp = `vv${"\r\n\\\"".repeat(6_143)}\r\n\\`;
    emitDescription("sdp-boundary", boundarySdp);
    emitDescription("sdp-overflow", `${boundarySdp}x`);
    emitDescription("sdp-multibyte-boundary", multibyteSdp);
    emitDescription("sdp-multibyte-overflow", `${multibyteSdp}가`);
    emitDescription("sdp-escaped-boundary", escapedSdp);
    emitDescription("sdp-escaped-overflow", `${escapedSdp}"`);
    emitDescription("sdp-tab", "v=0\tinvalid");
    emitDescription("sdp-c1", "v=0\u0085invalid");

    emitCandidate(
      "ice-boundary",
      "c".repeat(STUDIO_LIVE_ICE_CANDIDATE_MAX_LENGTH),
      "m".repeat(STUDIO_LIVE_SDP_MID_MAX_LENGTH),
      "u".repeat(STUDIO_LIVE_USERNAME_FRAGMENT_MAX_LENGTH)
    );
    emitCandidate(
      "ice-empty-optionals",
      "candidate:empty-optionals",
      "",
      ""
    );
    const multibyteCandidate = "🙂".repeat(STUDIO_LIVE_ICE_CANDIDATE_MAX_LENGTH / 4);
    const escapedCandidate = `cc${"\\\"".repeat(2_047)}\\`;
    emitCandidate("ice-multibyte-boundary", multibyteCandidate, "0", "user");
    emitCandidate("ice-multibyte-overflow", `${multibyteCandidate}🙂`, "0", "user");
    emitCandidate("ice-escaped-boundary", escapedCandidate, "0", "user");
    emitCandidate("ice-escaped-overflow", `${escapedCandidate}"`, "0", "user");
    emitCandidate(
      "ice-overflow",
      "c".repeat(STUDIO_LIVE_ICE_CANDIDATE_MAX_LENGTH + 1),
      "0",
      "user"
    );
    emitCandidate(
      "mid-overflow",
      "candidate:mid-overflow",
      "m".repeat(STUDIO_LIVE_SDP_MID_MAX_LENGTH + 1),
      "user"
    );
    emitCandidate(
      "username-overflow",
      "candidate:username-overflow",
      "0",
      "u".repeat(STUDIO_LIVE_USERNAME_FRAGMENT_MAX_LENGTH + 1)
    );
    emitCandidate("candidate-control", "candidate:\ninvalid", "0", "user");
    emitCandidate("mid-control", "candidate:mid-control", "mid\tinvalid", "user");
    emitCandidate("username-control", "candidate:user-control", "0", "user\u0085invalid");

    expect(
      received.map((value) => (value.payload as { shareId?: string }).shareId)
    ).toEqual([
      "sdp-boundary",
      "sdp-multibyte-boundary",
      "sdp-escaped-boundary",
      "ice-boundary",
      "ice-empty-optionals",
      "ice-multibyte-boundary",
      "ice-escaped-boundary",
    ]);
    transport.close();
  });

  it("commits server locks only after ACK and releases with the authoritative lease id", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:lock:request");
    socket.holdEvents.add("studio:lock:release");
    const factory = createStudioServerLiveTransportFactory(TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const room = new StudioLiveRoom({
      workId: "work-1",
      participant: localParticipant,
      dependencies: {
        transportFactory: factory,
        now: () => NOW,
        randomId: () => "11111111-1111-4111-8111-111111111111",
      },
    });
    await room.start();

    const acquisition = room.claimLockAsync("page:page-1");
    expect(room.getLocks()).toEqual([]);
    expect(socket.emitted.at(-1)).toEqual({
      event: "studio:lock:request",
      payload: {
        workId: "work-1",
        resourceId: "page:page-1",
        requestId: "11111111-1111-4111-8111-111111111111",
        leaseMs: 15_000,
      },
    });
    socket.reply("studio:lock:request", {
      ok: true,
      data: {
        decision: "acquired",
        requestId: "11111111-1111-4111-8111-111111111111",
        lock: {
          resourceId: "page:page-1",
          leaseId: "server-lease-1",
          ownerConnectionId: self.connectionId,
          ownerName: self.name,
          expiresAt: new Date(NOW + 15_000).toISOString(),
        },
      },
    });
    await expect(acquisition).resolves.toEqual({
      status: "acquired",
      resource: "page:page-1",
      requestId: "11111111-1111-4111-8111-111111111111",
      lock: expect.objectContaining({
        resource: "page:page-1",
        claimId: "server-lease-1",
        owner: localParticipant,
      }),
    });

    expect(room.getLocks()).toEqual([
      expect.objectContaining({
        resource: "page:page-1",
        claimId: "server-lease-1",
        owner: localParticipant,
      }),
    ]);
    expect(room.releaseLock("page:page-1")).toBe(true);
    expect(room.getLocks()).toHaveLength(1);
    expect(socket.emitted.at(-1)).toEqual({
      event: "studio:lock:release",
      payload: {
        workId: "work-1",
        resourceId: "page:page-1",
        leaseId: "server-lease-1",
      },
    });
    socket.reply("studio:lock:release", { ok: true, data: { released: true } });
    expect(room.getLocks()).toEqual([]);
    room.close();
  });

  it("uses a fresh request id for each renewal of the same observed fence", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({ lockProtocolVersion: 2 });
    socket.holdEvents.add("studio:lock:request");
    const requestIds = [
      "10101010-1010-4010-8010-101010101010",
      "20202020-2020-4020-8020-202020202020",
    ];
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
      randomId: () => requestIds.shift() ?? "30303030-3030-4030-8030-303030303030",
    });
    await transport.connect();
    activate(transport);
    const claimId = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

    expect(transport.send(envelope("lock:claim", {
      resource: "page:unique-renewal",
      claimId,
      leaseUntil: NOW + 15_000,
    }, 2))).toBe(true);
    expect(socket.emitted.at(-1)).toEqual({
      event: "studio:lock:request",
      payload: {
        workId: "work-1",
        resourceId: "page:unique-renewal",
        requestId: "10101010-1010-4010-8010-101010101010",
        protocolVersion: 2,
        renewLeaseId: claimId,
        leaseMs: 15_000,
      },
    });
    socket.reply("studio:lock:request", {
      ok: false,
      decision: "denied",
      requestId: "10101010-1010-4010-8010-101010101010",
      code: "lock_stale",
      message: "첫 갱신을 다시 시도합니다.",
    });

    expect(transport.send(envelope("lock:claim", {
      resource: "page:unique-renewal",
      claimId,
      leaseUntil: NOW + 15_000,
    }, 3))).toBe(true);
    expect(socket.emitted.at(-1)).toEqual({
      event: "studio:lock:request",
      payload: {
        workId: "work-1",
        resourceId: "page:unique-renewal",
        requestId: "20202020-2020-4020-8020-202020202020",
        protocolVersion: 2,
        renewLeaseId: claimId,
        leaseMs: 15_000,
      },
    });
    transport.close();
  });

  it("rejects a v2 acquisition ACK without correlation and chase-releases its fence", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({ lockProtocolVersion: 2 });
    socket.holdEvents.add("studio:lock:request");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();
    activate(transport);
    const requestId = "31313131-3131-4131-8131-313131313131";
    const acquisition = transport.acquireLock({
      resource: "page:missing-v2-correlation",
      requestId,
      leaseMs: 15_000,
    });
    socket.reply("studio:lock:request", {
      ok: true,
      data: {
        decision: "acquired",
        lock: {
          resourceId: "page:missing-v2-correlation",
          leaseId: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
          ownerConnectionId: self.connectionId,
          ownerName: self.name,
          expiresAt: new Date(NOW + 15_000).toISOString(),
        },
      },
    });

    await expect(acquisition).resolves.toMatchObject({
      status: "denied",
      requestId,
      code: "response_mismatch",
    });
    expect(socket.emitted.at(-1)).toEqual({
      event: "studio:lock:release",
      payload: {
        workId: "work-1",
        resourceId: "page:missing-v2-correlation",
        leaseId: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
        requestId,
      },
    });
    expect(transport.ready).toBe(true);
    transport.close();
  });

  it("legitimizes a deferred legacy fence when a retry succeeds with the same lease", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:lock:request");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
      lockAckTimeoutMs: 100,
    });
    await transport.connect();
    activate(transport);
    const firstRequestId = "41414141-4141-4141-8141-414141414141";
    const secondRequestId = "51515151-5151-4151-8151-515151515151";
    const resource = "page:legacy-same-fence";
    const first = transport.acquireLock({ resource, requestId: firstRequestId, leaseMs: 15_000 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(first).resolves.toMatchObject({ status: "timeout" });
    const second = transport.acquireLock({ resource, requestId: secondRequestId, leaseMs: 15_000 });
    const stableLock = {
      resourceId: resource,
      leaseId: "cccccccc-3333-4333-8333-cccccccccccc",
      ownerConnectionId: self.connectionId,
      ownerName: self.name,
      expiresAt: new Date(NOW + 15_000).toISOString(),
    };
    socket.reply("studio:lock:request", {
      ok: true,
      data: { decision: "acquired", requestId: firstRequestId, lock: stableLock },
    });
    socket.reply("studio:lock:request", {
      ok: true,
      data: { decision: "acquired", requestId: secondRequestId, lock: stableLock },
    });
    await expect(second).resolves.toMatchObject({
      status: "acquired",
      lock: { claimId: stableLock.leaseId },
    });
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      requestId: firstRequestId,
      lock: stableLock,
    });

    expect(socket.emitted.filter((entry) => entry.event === "studio:lock:release")).toEqual([]);
    transport.close();
  });

  it("refreshes an accepted legacy fence when its renewal ACK arrives after timeout", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:lock:request");
    const renewalRequestId = "52525252-5252-4252-8252-525252525252";
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
      randomId: () => renewalRequestId,
      lockAckTimeoutMs: 100,
    });
    const controls: StudioLiveTransportControlEvent[] = [];
    transport.subscribeControl((event) => controls.push(event));
    await transport.connect();
    activate(transport);
    const resource = "page:legacy-late-renewal";
    const initialRequestId = "42424242-4242-4242-8242-424242424242";
    const stableLeaseId = "abababab-3333-4333-8333-abababababab";
    const initial = transport.acquireLock({
      resource,
      requestId: initialRequestId,
      leaseMs: 15_000,
    });
    socket.reply("studio:lock:request", {
      ok: true,
      data: {
        decision: "acquired",
        requestId: initialRequestId,
        lock: {
          resourceId: resource,
          leaseId: stableLeaseId,
          ownerConnectionId: self.connectionId,
          ownerName: self.name,
          expiresAt: new Date(NOW + 15_000).toISOString(),
        },
      },
    });
    await expect(initial).resolves.toMatchObject({ status: "acquired" });
    controls.length = 0;

    expect(transport.send(envelope("lock:claim", {
      resource,
      claimId: stableLeaseId,
      leaseUntil: NOW + 20_000,
    }, 2))).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    const newerRenewal = transport.acquireLock({
      resource,
      requestId: "62626262-6262-4262-8262-626262626262",
      renewLeaseId: stableLeaseId,
      leaseMs: 15_000,
    });
    const refreshedLock = {
      resourceId: resource,
      leaseId: stableLeaseId,
      ownerConnectionId: self.connectionId,
      ownerName: self.name,
      expiresAt: new Date(NOW + 20_000).toISOString(),
    };
    socket.reply("studio:lock:request", {
      ok: true,
      data: {
        decision: "acquired",
        requestId: renewalRequestId,
        lock: refreshedLock,
      },
    });
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      requestId: renewalRequestId,
      lock: refreshedLock,
    });
    await vi.advanceTimersByTimeAsync(100);
    await expect(newerRenewal).resolves.toMatchObject({ status: "timeout" });

    expect(socket.emitted.filter((entry) => entry.event === "studio:lock:release")).toEqual([]);
    expect(controls).toContainEqual({
      type: "lock",
      lock: expect.objectContaining({
        action: "acquired",
        resource,
        claimId: stableLeaseId,
        leaseUntil: NOW + 20_000,
      }),
    });
    transport.close();
  });

  it("keeps a newer accepted legacy retry when the older request returns the same fence", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:lock:request");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
      lockAckTimeoutMs: 100,
    });
    await transport.connect();
    activate(transport);
    const resource = "page:legacy-inverse-retry";
    const firstRequestId = "43434343-4343-4343-8343-434343434343";
    const secondRequestId = "53535353-5353-4353-8353-535353535353";
    const stableLock = {
      resourceId: resource,
      leaseId: "bcbcbcbc-3434-4434-8434-bcbcbcbcbcbc",
      ownerConnectionId: self.connectionId,
      ownerName: self.name,
      expiresAt: new Date(NOW + 15_000).toISOString(),
    };
    const first = transport.acquireLock({ resource, requestId: firstRequestId, leaseMs: 15_000 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(first).resolves.toMatchObject({ status: "timeout" });
    const second = transport.acquireLock({ resource, requestId: secondRequestId, leaseMs: 15_000 });
    const acknowledgements = socket.heldAcks.get("studio:lock:request") ?? [];
    expect(acknowledgements).toHaveLength(2);
    acknowledgements[1]?.({
      ok: true,
      data: { decision: "acquired", requestId: secondRequestId, lock: stableLock },
    });
    await expect(second).resolves.toMatchObject({
      status: "acquired",
      lock: { claimId: stableLock.leaseId },
    });
    acknowledgements[0]?.({
      ok: true,
      data: { decision: "acquired", requestId: firstRequestId, lock: stableLock },
    });
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      requestId: firstRequestId,
      lock: stableLock,
    });

    expect(socket.emitted.filter((entry) => entry.event === "studio:lock:release")).toEqual([]);
    transport.close();
  });

  it("serializes a v2 reacquire behind the correlated release lifecycle", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({ lockProtocolVersion: 2 });
    socket.holdEvents.add("studio:lock:request");
    socket.holdEvents.add("studio:lock:release");
    const ids = [
      "11111111-1111-4111-8111-111111111121",
      "11111111-1111-4111-8111-111111111122",
      "11111111-1111-4111-8111-111111111123",
    ];
    const room = new StudioLiveRoom({
      workId: "work-1",
      participant: localParticipant,
      dependencies: {
        transportFactory: createStudioServerLiveTransportFactory(TOKEN, {
          createSocket: () => socket,
          now: () => NOW,
        }),
        now: () => NOW,
        randomId: () => ids.shift() ?? "11111111-1111-4111-8111-111111111199",
      },
    });
    await room.start();

    const first = room.claimLockAsync("page:serialized-release");
    expect(socket.emitted.at(-1)).toEqual({
      event: "studio:lock:request",
      payload: {
        workId: "work-1",
        resourceId: "page:serialized-release",
        requestId: "11111111-1111-4111-8111-111111111121",
        protocolVersion: 2,
        leaseMs: 15_000,
      },
    });
    socket.reply("studio:lock:request", {
      ok: true,
      data: {
        decision: "acquired",
        requestId: "11111111-1111-4111-8111-111111111121",
        lock: {
          resourceId: "page:serialized-release",
          leaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          ownerConnectionId: self.connectionId,
          ownerName: self.name,
          expiresAt: new Date(NOW + 15_000).toISOString(),
        },
      },
    });
    await first;

    const release = room.releaseLockAsync("page:serialized-release");
    const reacquire = room.claimLockAsync("page:serialized-release");
    expect(socket.emitted.filter((entry) => entry.event === "studio:lock:request")).toHaveLength(1);
    expect(socket.emitted.at(-1)).toEqual({
      event: "studio:lock:release",
      payload: {
        workId: "work-1",
        resourceId: "page:serialized-release",
        leaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        requestId: "11111111-1111-4111-8111-111111111122",
      },
    });
    socket.reply("studio:lock:release", {
      ok: true,
      data: {
        requestId: "11111111-1111-4111-8111-111111111122",
        resourceId: "page:serialized-release",
        leaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        released: true,
      },
    });
    await expect(release).resolves.toMatchObject({ status: "released", released: true });
    await vi.waitFor(() => {
      expect(socket.emitted.filter((entry) => entry.event === "studio:lock:request")).toHaveLength(2);
    });
    expect(socket.emitted.at(-1)).toEqual({
      event: "studio:lock:request",
      payload: {
        workId: "work-1",
        resourceId: "page:serialized-release",
        requestId: "11111111-1111-4111-8111-111111111123",
        protocolVersion: 2,
        leaseMs: 15_000,
      },
    });
    socket.reply("studio:lock:request", {
      ok: true,
      data: {
        decision: "acquired",
        requestId: "11111111-1111-4111-8111-111111111123",
        lock: {
          resourceId: "page:serialized-release",
          leaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
          ownerConnectionId: self.connectionId,
          ownerName: self.name,
          expiresAt: new Date(NOW + 15_000).toISOString(),
        },
      },
    });
    await expect(reacquire).resolves.toMatchObject({
      status: "acquired",
      lock: { claimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2" },
    });
    socket.serverEmit("studio:lock:update", {
      action: "released",
      requestId: "11111111-1111-4111-8111-111111111121",
      releaseRequestId: "11111111-1111-4111-8111-111111111122",
      resourceId: "page:serialized-release",
      leaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    });
    expect(room.getLocks()).toEqual([
      expect.objectContaining({ claimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2" }),
    ]);
    room.close();
  });

  it("times out a v2 release without letting a late old ACK remove the reacquired fence", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({ lockProtocolVersion: 2 });
    socket.holdEvents.add("studio:lock:request");
    socket.holdEvents.add("studio:lock:release");
    const ids = [
      "22222222-2222-4222-8222-222222222221",
      "22222222-2222-4222-8222-222222222222",
      "22222222-2222-4222-8222-222222222223",
    ];
    const room = new StudioLiveRoom({
      workId: "work-1",
      participant: localParticipant,
      dependencies: {
        transportFactory: createStudioServerLiveTransportFactory(TOKEN, {
          createSocket: () => socket,
          now: () => NOW,
          lockAckTimeoutMs: 100,
        }),
        now: () => NOW,
        randomId: () => ids.shift() ?? "22222222-2222-4222-8222-222222222299",
        lockAckTimeoutMs: 250,
      },
    });
    await room.start();
    const first = room.claimLockAsync("page:release-timeout");
    socket.reply("studio:lock:request", {
      ok: true,
      data: {
        decision: "acquired",
        requestId: "22222222-2222-4222-8222-222222222221",
        lock: {
          resourceId: "page:release-timeout",
          leaseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
          ownerConnectionId: self.connectionId,
          ownerName: self.name,
          expiresAt: new Date(NOW + 15_000).toISOString(),
        },
      },
    });
    await first;

    const release = room.releaseLockAsync("page:release-timeout");
    await vi.advanceTimersByTimeAsync(100);
    await expect(release).resolves.toMatchObject({ status: "timeout" });
    expect(room.getLocks()).toEqual([]);

    const reacquire = room.claimLockAsync("page:release-timeout");
    socket.reply("studio:lock:request", {
      ok: true,
      data: {
        decision: "acquired",
        requestId: "22222222-2222-4222-8222-222222222223",
        lock: {
          resourceId: "page:release-timeout",
          leaseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
          ownerConnectionId: self.connectionId,
          ownerName: self.name,
          expiresAt: new Date(NOW + 15_000).toISOString(),
        },
      },
    });
    await reacquire;
    socket.reply("studio:lock:release", {
      ok: true,
      data: {
        requestId: "22222222-2222-4222-8222-222222222222",
        resourceId: "page:release-timeout",
        leaseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        released: true,
      },
    });
    expect(room.getLocks()).toEqual([
      expect.objectContaining({ claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2" }),
    ]);
    room.close();
  });

  it("waits out a legacy lease before reacquiring and ignores the late old release", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:lock:request");
    socket.holdEvents.add("studio:lock:release");
    const ids = [
      "23232323-2323-4323-8323-232323232321",
      "23232323-2323-4323-8323-232323232322",
      "23232323-2323-4323-8323-232323232323",
    ];
    const room = new StudioLiveRoom({
      workId: "work-1",
      participant: localParticipant,
      dependencies: {
        transportFactory: createStudioServerLiveTransportFactory(TOKEN, {
          createSocket: () => socket,
          now: () => NOW,
          lockAckTimeoutMs: 100,
        }),
        now: () => NOW,
        randomId: () => ids.shift() ?? "23232323-2323-4323-8323-232323232399",
        heartbeatMs: 250,
        lockAckTimeoutMs: 250,
      },
    });
    await room.start();
    const resource = "page:legacy-release-timeout";
    const oldLeaseId = "bdbdbdbd-bdbd-4dbd-8dbd-bdbdbdbdbdb1";
    const initial = room.claimLockAsync(resource);
    socket.reply("studio:lock:request", {
      ok: true,
      data: {
        decision: "acquired",
        requestId: "23232323-2323-4323-8323-232323232321",
        lock: {
          resourceId: resource,
          leaseId: oldLeaseId,
          ownerConnectionId: self.connectionId,
          ownerName: self.name,
          expiresAt: new Date(NOW + 15_000).toISOString(),
        },
      },
    });
    await expect(initial).resolves.toMatchObject({ status: "acquired" });

    let releaseSettled = false;
    const release = room.releaseLockAsync(resource);
    void release.then(() => {
      releaseSettled = true;
    });
    const reacquire = room.claimLockAsync(resource);
    await vi.advanceTimersByTimeAsync(STUDIO_LIVE_LOCK_MAX_LEASE_MS + 249);
    expect(releaseSettled).toBe(false);
    expect(socket.emitted.filter((entry) => entry.event === "studio:lock:request")).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(release).resolves.toMatchObject({ status: "timeout" });
    await vi.waitFor(() => {
      expect(socket.emitted.filter((entry) => entry.event === "studio:lock:request")).toHaveLength(2);
    });
    const newLeaseId = "bdbdbdbd-bdbd-4dbd-8dbd-bdbdbdbdbdb2";
    socket.reply("studio:lock:request", {
      ok: true,
      data: {
        decision: "acquired",
        requestId: "23232323-2323-4323-8323-232323232323",
        lock: {
          resourceId: resource,
          leaseId: newLeaseId,
          ownerConnectionId: self.connectionId,
          ownerName: self.name,
          expiresAt: new Date(NOW + 15_000).toISOString(),
        },
      },
    });
    await expect(reacquire).resolves.toMatchObject({
      status: "acquired",
      lock: { claimId: newLeaseId },
    });

    socket.reply("studio:lock:release", { ok: true, data: { released: true } });
    socket.serverEmit("studio:lock:update", {
      action: "released",
      requestId: "23232323-2323-4323-8323-232323232321",
      resourceId: resource,
      leaseId: oldLeaseId,
    });
    expect(room.getLocks()).toEqual([
      expect.objectContaining({ resource, claimId: newLeaseId }),
    ]);
    room.close();
  });

  it("chase-releases a renewal fence that committed just before release", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({ lockProtocolVersion: 2 });
    socket.holdEvents.add("studio:lock:request");
    socket.holdEvents.add("studio:lock:release");
    const ids = [
      "33333333-3333-4333-8333-333333333331",
      "33333333-3333-4333-8333-333333333332",
    ];
    const renewalRequestId = "33333333-3333-4333-8333-333333333333";
    const room = new StudioLiveRoom({
      workId: "work-1",
      participant: localParticipant,
      dependencies: {
        transportFactory: createStudioServerLiveTransportFactory(TOKEN, {
          createSocket: () => socket,
          now: () => NOW,
          randomId: () => renewalRequestId,
        }),
        now: () => NOW,
        randomId: () => ids.shift() ?? "33333333-3333-4333-8333-333333333399",
        heartbeatMs: 250,
        lockLeaseMs: 5_000,
      },
    });
    await room.start();
    const first = room.claimLockAsync("page:renew-first");
    socket.reply("studio:lock:request", {
      ok: true,
      data: {
        decision: "acquired",
        requestId: "33333333-3333-4333-8333-333333333331",
        lock: {
          resourceId: "page:renew-first",
          leaseId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
          ownerConnectionId: self.connectionId,
          ownerName: self.name,
          expiresAt: new Date(NOW + 5_000).toISOString(),
        },
      },
    });
    await first;

    await vi.advanceTimersByTimeAsync(250);
    expect(socket.emitted.at(-1)).toEqual({
      event: "studio:lock:request",
      payload: {
        workId: "work-1",
        resourceId: "page:renew-first",
        requestId: renewalRequestId,
        protocolVersion: 2,
        renewLeaseId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
        leaseMs: 5_000,
      },
    });
    const release = room.releaseLockAsync("page:renew-first");
    socket.reply("studio:lock:request", {
      ok: true,
      data: {
        decision: "acquired",
        requestId: renewalRequestId,
        lock: {
          resourceId: "page:renew-first",
          leaseId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
          ownerConnectionId: self.connectionId,
          ownerName: self.name,
          expiresAt: new Date(NOW + 5_000).toISOString(),
        },
      },
    });
    expect(room.getLocks()).toEqual([
      expect.objectContaining({ claimId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1" }),
    ]);
    const releases = socket.emitted.filter((entry) => entry.event === "studio:lock:release");
    expect(releases).toEqual([
      {
        event: "studio:lock:release",
        payload: {
          workId: "work-1",
          resourceId: "page:renew-first",
          leaseId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
          requestId: "33333333-3333-4333-8333-333333333332",
        },
      },
      {
        event: "studio:lock:release",
        payload: {
          workId: "work-1",
          resourceId: "page:renew-first",
          leaseId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
          requestId: renewalRequestId,
        },
      },
    ]);
    socket.reply("studio:lock:release", {
      ok: true,
      data: {
        requestId: "33333333-3333-4333-8333-333333333332",
        resourceId: "page:renew-first",
        leaseId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
        released: false,
      },
    });
    await expect(release).resolves.toMatchObject({ status: "released", released: false });
    socket.reply("studio:lock:release", {
      ok: true,
      data: {
        requestId: renewalRequestId,
        resourceId: "page:renew-first",
        leaseId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
        released: true,
      },
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(
      socket.emitted.filter((entry) => entry.event === "studio:lock:request")
    ).toHaveLength(2);
    expect(room.getLocks()).toEqual([]);
    room.close();
  });

  it("settles a v2 release from its correlated broadcast before the ACK", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({ lockProtocolVersion: 2 });
    socket.holdEvents.add("studio:lock:request");
    socket.holdEvents.add("studio:lock:release");
    const ids = [
      "44444444-4444-4444-8444-444444444441",
      "44444444-4444-4444-8444-444444444442",
    ];
    const room = new StudioLiveRoom({
      workId: "work-1",
      participant: localParticipant,
      dependencies: {
        transportFactory: createStudioServerLiveTransportFactory(TOKEN, {
          createSocket: () => socket,
          now: () => NOW,
        }),
        now: () => NOW,
        randomId: () => ids.shift() ?? "44444444-4444-4444-8444-444444444499",
      },
    });
    await room.start();
    const first = room.claimLockAsync("page:broadcast-release");
    socket.reply("studio:lock:request", {
      ok: true,
      data: {
        decision: "acquired",
        requestId: "44444444-4444-4444-8444-444444444441",
        lock: {
          resourceId: "page:broadcast-release",
          leaseId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
          ownerConnectionId: self.connectionId,
          ownerName: self.name,
          expiresAt: new Date(NOW + 15_000).toISOString(),
        },
      },
    });
    await first;
    const release = room.releaseLockAsync("page:broadcast-release");
    socket.serverEmit("studio:lock:update", {
      action: "released",
      requestId: "44444444-4444-4444-8444-444444444441",
      releaseRequestId: "44444444-4444-4444-8444-444444444442",
      resourceId: "page:broadcast-release",
      leaseId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
    });
    await expect(release).resolves.toMatchObject({ status: "released", released: true });
    expect(room.getLocks()).toEqual([]);
    socket.reply("studio:lock:release", {
      ok: true,
      data: {
        requestId: "44444444-4444-4444-8444-444444444442",
        resourceId: "page:broadcast-release",
        leaseId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
        released: true,
      },
    });
    expect(room.getLocks()).toEqual([]);
    room.close();
  });

  it("keeps an active room connected when one lock operation is forbidden", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:lock:request");
    const statuses: StudioLiveRoomEvent[] = [];
    const room = new StudioLiveRoom({
      workId: "work-1",
      participant: { ...localParticipant, role: "viewer" },
      dependencies: {
        transportFactory: createStudioServerLiveTransportFactory(TOKEN, {
          createSocket: () => socket,
          now: () => NOW,
        }),
        now: () => NOW,
        randomId: () => "22222222-2222-4222-8222-222222222222",
      },
    });
    room.subscribe((event) => event.type === "transport-status" && statuses.push(event));
    await room.start();

    const acquisition = room.claimLockAsync("page:viewer-denied");
    socket.reply("studio:lock:request", {
      ok: false,
      decision: "denied",
      requestId: "22222222-2222-4222-8222-222222222222",
      code: "forbidden",
      message: "이 원고를 편집할 권한이 없습니다.",
    });

    await expect(acquisition).resolves.toEqual({
      status: "denied",
      resource: "page:viewer-denied",
      requestId: "22222222-2222-4222-8222-222222222222",
      code: "forbidden",
      message: "이 원고를 편집할 권한이 없습니다.",
    });

    expect(room.ready).toBe(true);
    expect(socket.connected).toBe(true);
    expect(room.getLocks()).toEqual([]);
    expect(statuses.at(-1)).toEqual(
      expect.objectContaining({
        status: {
          state: "error",
          message: "이 원고를 편집할 권한이 없습니다.",
          recoverable: true,
        },
      })
    );

    socket.serverEmit("studio:presence:update", {
      ...remote,
      state: "idle",
      pageId: "page-after-denial",
    });
    expect(room.getPeers()).toEqual([
      expect.objectContaining({
        sessionId: remote.connectionId,
        visibility: "idle",
        pageId: "page-after-denial",
      }),
    ]);
    room.close();
  });

  it("ignores a stale lock ACK from an earlier socket generation after reconnect", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:lock:request");
    const room = new StudioLiveRoom({
      workId: "work-1",
      participant: localParticipant,
      dependencies: {
        transportFactory: createStudioServerLiveTransportFactory(TOKEN, {
          createSocket: () => socket,
          now: () => NOW,
        }),
        now: () => NOW,
        randomId: () => "33333333-3333-4333-8333-333333333333",
      },
    });
    await room.start();
    const acquisition = room.claimLockAsync("page:stale");

    socket.serverDisconnect();
    await expect(acquisition).resolves.toEqual({
      status: "revoked",
      resource: "page:stale",
      requestId: "33333333-3333-4333-8333-333333333333",
      code: "disconnected",
      message: expect.any(String),
    });
    socket.serverReconnect();
    expect(room.ready).toBe(true);
    socket.reply("studio:lock:request", {
      ok: true,
      data: {
        decision: "acquired",
        requestId: "33333333-3333-4333-8333-333333333333",
        lock: {
          resourceId: "page:stale",
          leaseId: "stale-server-lease",
          ownerConnectionId: self.connectionId,
          ownerName: self.name,
          expiresAt: new Date(NOW + 15_000).toISOString(),
        },
      },
    });
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      requestId: "33333333-3333-4333-8333-333333333333",
      lock: {
        resourceId: "page:stale",
        leaseId: "stale-server-lease",
        ownerConnectionId: self.connectionId,
        ownerName: self.name,
        expiresAt: new Date(NOW + 15_000).toISOString(),
      },
    });

    expect(room.getLocks()).toEqual([]);
    room.close();
  });

  it("times out a pending lock and rolls back a late authoritative broadcast without ACK", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:lock:request");
    const room = new StudioLiveRoom({
      workId: "work-1",
      participant: localParticipant,
      dependencies: {
        transportFactory: createStudioServerLiveTransportFactory(TOKEN, {
          createSocket: () => socket,
          now: () => NOW,
          lockAckTimeoutMs: 100,
        }),
        now: () => NOW,
        randomId: () => "44444444-4444-4444-8444-444444444444",
        lockAckTimeoutMs: 250,
      },
    });
    await room.start();

    const acquisition = room.claimLockAsync("element:page-1:late");
    await vi.advanceTimersByTimeAsync(100);
    await expect(acquisition).resolves.toEqual({
      status: "timeout",
      resource: "element:page-1:late",
      requestId: "44444444-4444-4444-8444-444444444444",
      message: expect.any(String),
    });

    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      requestId: "44444444-4444-4444-8444-444444444444",
      lock: {
        resourceId: "element:page-1:late",
        leaseId: "late-server-lease",
        ownerConnectionId: self.connectionId,
        ownerName: self.name,
        expiresAt: new Date(NOW + 15_000).toISOString(),
      },
    });

    expect(room.getLocks()).toEqual([]);
    expect(socket.emitted.at(-1)).toEqual({
      event: "studio:lock:release",
      payload: {
        workId: "work-1",
        resourceId: "element:page-1:late",
        leaseId: "late-server-lease",
      },
    });
    room.close();
  });

  it("chase-releases an abandoned fence deferred behind a newer denied request", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({ lockProtocolVersion: 2 });
    socket.holdEvents.add("studio:lock:request");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
      lockAckTimeoutMs: 100,
    });
    await transport.connect();
    activate(transport);

    const firstRequestId = "45454545-4545-4545-8545-454545454545";
    const secondRequestId = "56565656-5656-4656-8656-565656565656";
    const resource = "page:deferred-abandoned";
    const first = transport.acquireLock({
      resource,
      requestId: firstRequestId,
      leaseMs: 15_000,
    });
    await vi.advanceTimersByTimeAsync(100);
    await expect(first).resolves.toMatchObject({ status: "timeout", requestId: firstRequestId });

    const second = transport.acquireLock({
      resource,
      requestId: secondRequestId,
      leaseMs: 15_000,
    });
    const lateLock = {
      resourceId: resource,
      leaseId: "abababab-abab-4bab-8bab-abababababab",
      ownerConnectionId: self.connectionId,
      ownerName: self.name,
      expiresAt: new Date(NOW + 15_000).toISOString(),
    };
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      requestId: firstRequestId,
      lock: lateLock,
    });
    socket.reply("studio:lock:request", {
      ok: true,
      data: { decision: "acquired", requestId: firstRequestId, lock: lateLock },
    });
    socket.reply("studio:lock:request", {
      ok: false,
      decision: "denied",
      requestId: secondRequestId,
      code: "lock_stale",
      message: "편집 잠금 임대가 이미 변경되었습니다.",
    });
    await expect(second).resolves.toMatchObject({
      status: "denied",
      requestId: secondRequestId,
      code: "lock_stale",
    });

    expect(socket.emitted.filter((entry) => entry.event === "studio:lock:release")).toEqual([
      {
        event: "studio:lock:release",
        payload: {
          workId: "work-1",
          resourceId: resource,
          leaseId: lateLock.leaseId,
          requestId: firstRequestId,
        },
      },
    ]);
    transport.close();
  });

  it("retains the newer abandonment when a deferred older fence is released", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({ lockProtocolVersion: 2 });
    socket.holdEvents.add("studio:lock:request");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
      lockAckTimeoutMs: 100,
    });
    await transport.connect();
    activate(transport);
    const firstRequestId = "61616161-6161-4161-8161-616161616161";
    const secondRequestId = "71717171-7171-4171-8171-717171717171";
    const resource = "page:two-abandoned-generations";
    const first = transport.acquireLock({ resource, requestId: firstRequestId, leaseMs: 15_000 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(first).resolves.toMatchObject({ status: "timeout" });

    const second = transport.acquireLock({ resource, requestId: secondRequestId, leaseMs: 15_000 });
    const firstLateLock = {
      resourceId: resource,
      leaseId: "dddddddd-4444-4444-8444-dddddddddddd",
      ownerConnectionId: self.connectionId,
      ownerName: self.name,
      expiresAt: new Date(NOW + 15_000).toISOString(),
    };
    socket.reply("studio:lock:request", {
      ok: true,
      data: { decision: "acquired", requestId: firstRequestId, lock: firstLateLock },
    });
    await vi.advanceTimersByTimeAsync(100);
    await expect(second).resolves.toMatchObject({ status: "timeout" });

    const secondLateLock = {
      ...firstLateLock,
      leaseId: "eeeeeeee-5555-4555-8555-eeeeeeeeeeee",
    };
    socket.reply("studio:lock:request", {
      ok: true,
      data: { decision: "acquired", requestId: secondRequestId, lock: secondLateLock },
    });

    expect(socket.emitted.filter((entry) => entry.event === "studio:lock:release")).toEqual([
      {
        event: "studio:lock:release",
        payload: {
          workId: "work-1",
          resourceId: resource,
          leaseId: firstLateLock.leaseId,
          requestId: firstRequestId,
        },
      },
      {
        event: "studio:lock:release",
        payload: {
          workId: "work-1",
          resourceId: resource,
          leaseId: secondLateLock.leaseId,
          requestId: secondRequestId,
        },
      },
    ]);
    transport.close();
  });

  it("rejects a mismatched v2 release ACK without disconnecting the room", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({ lockProtocolVersion: 2 });
    socket.holdEvents.add("studio:lock:request");
    socket.holdEvents.add("studio:lock:release");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();
    activate(transport);
    const acquireRequestId = "81818181-8181-4181-8181-818181818181";
    const resource = "page:release-response-mismatch";
    const acquisition = transport.acquireLock({
      resource,
      requestId: acquireRequestId,
      leaseMs: 15_000,
    });
    const lock = {
      resourceId: resource,
      leaseId: "ffffffff-6666-4666-8666-ffffffffffff",
      ownerConnectionId: self.connectionId,
      ownerName: self.name,
      expiresAt: new Date(NOW + 15_000).toISOString(),
    };
    socket.reply("studio:lock:request", {
      ok: true,
      data: { decision: "acquired", requestId: acquireRequestId, lock },
    });
    await acquisition;

    const releaseRequestId = "91919191-9191-4191-8191-919191919191";
    const release = transport.releaseLock({
      resource,
      requestId: releaseRequestId,
      claimId: lock.leaseId,
    });
    socket.reply("studio:lock:release", {
      ok: true,
      data: {
        requestId: "92929292-9292-4292-8292-929292929292",
        resourceId: resource,
        leaseId: lock.leaseId,
        released: true,
      },
    });

    await expect(release).resolves.toMatchObject({
      status: "denied",
      requestId: releaseRequestId,
      code: "response_mismatch",
    });
    expect(transport.ready).toBe(true);
    transport.close();
  });

  it("accepts a correlated authoritative broadcast before ACK without later timing out", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:lock:request");
    const room = new StudioLiveRoom({
      workId: "work-1",
      participant: localParticipant,
      dependencies: {
        transportFactory: createStudioServerLiveTransportFactory(TOKEN, {
          createSocket: () => socket,
          now: () => NOW,
          lockAckTimeoutMs: 100,
        }),
        now: () => NOW,
        randomId: () => "66666666-6666-4666-8666-666666666666",
        lockAckTimeoutMs: 250,
      },
    });
    await room.start();

    const acquisition = room.claimLockAsync("page:broadcast-first");
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      requestId: "66666666-6666-4666-8666-666666666666",
      lock: {
        resourceId: "page:broadcast-first",
        leaseId: "broadcast-first-lease",
        ownerConnectionId: self.connectionId,
        ownerName: self.name,
        expiresAt: new Date(NOW + 15_000).toISOString(),
      },
    });

    await expect(acquisition).resolves.toEqual({
      status: "acquired",
      resource: "page:broadcast-first",
      requestId: "66666666-6666-4666-8666-666666666666",
      lock: expect.objectContaining({ claimId: "broadcast-first-lease" }),
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(room.getLocks()).toEqual([
      expect.objectContaining({
        resource: "page:broadcast-first",
        claimId: "broadcast-first-lease",
      }),
    ]);
    expect(socket.emitted.filter((entry) => entry.event === "studio:lock:release")).toEqual([]);
    socket.serverEmit("studio:lock:update", {
      action: "revoked",
      resourceId: "page:broadcast-first",
      leaseId: "broadcast-first-lease",
      requestId: "66666666-6666-4666-8666-666666666666",
    });
    expect(room.getLocks()).toEqual([]);
    room.close();
  });

  it("preserves each request correlation when the same resource already has a pending request", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:lock:request");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();
    activate(transport);

    const first = transport.acquireLock({
      resource: "page:deduplicated",
      requestId: "77777777-7777-4777-8777-777777777777",
      leaseMs: 15_000,
    });
    await expect(
      transport.acquireLock({
        resource: "page:deduplicated",
        requestId: "88888888-8888-4888-8888-888888888888",
        leaseMs: 15_000,
      })
    ).resolves.toEqual({
      status: "denied",
      resource: "page:deduplicated",
      requestId: "88888888-8888-4888-8888-888888888888",
      code: "duplicate_resource_request",
      message: expect.any(String),
    });

    transport.close();
    await expect(first).resolves.toEqual({
      status: "revoked",
      resource: "page:deduplicated",
      requestId: "77777777-7777-4777-8777-777777777777",
      code: "connection_closed",
      message: expect.any(String),
    });
  });

  it("settles a pending lock as revoked when the room closes", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:lock:request");
    const room = new StudioLiveRoom({
      workId: "work-1",
      participant: localParticipant,
      dependencies: {
        transportFactory: createStudioServerLiveTransportFactory(TOKEN, {
          createSocket: () => socket,
          now: () => NOW,
        }),
        now: () => NOW,
        randomId: () => "55555555-5555-4555-8555-555555555555",
      },
    });
    await room.start();

    const acquisition = room.claimLockAsync("page:closing");
    room.close();

    await expect(acquisition).resolves.toEqual({
      status: "revoked",
      resource: "page:closing",
      requestId: "55555555-5555-4555-8555-555555555555",
      code: "connection_closed",
      message: expect.any(String),
    });
  });

  it("rejoins before becoming ready again and exposes disconnect/revocation recovery states", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const statuses: StudioLiveRoomEvent[] = [];
    const room = new StudioLiveRoom({
      workId: "work-1",
      participant: localParticipant,
      dependencies: {
        transportFactory: createStudioServerLiveTransportFactory(TOKEN, {
          createSocket: () => socket,
          now: () => NOW,
        }),
        now: () => NOW,
      },
    });
    room.subscribe((event) => event.type === "transport-status" && statuses.push(event));
    await room.start();
    expect(room.ready).toBe(true);

    socket.holdEvents.add("studio:join");
    socket.serverDisconnect();
    expect(room.ready).toBe(false);
    expect(statuses.at(-1)).toEqual(
      expect.objectContaining({
        type: "transport-status",
        status: expect.objectContaining({ state: "disconnected", recoverable: true }),
      })
    );

    socket.serverReconnect();
    expect(room.ready).toBe(false);
    socket.reply("studio:join", joinSuccess());
    expect(room.ready).toBe(true);
    expect(statuses.at(-1)).toEqual(
      expect.objectContaining({
        status: expect.objectContaining({ state: "ready" }),
      })
    );

    socket.serverEmit("studio:access:revoked", {
      workId: "work-1",
      message: "팀 권한이 회수되었습니다.",
    });
    expect(room.ready).toBe(false);
    expect(statuses.at(-1)).toEqual(
      expect.objectContaining({
        status: { state: "revoked", message: "팀 권한이 회수되었습니다.", recoverable: false },
      })
    );

    const postRevocationEvents: StudioLiveRoomEvent[] = [];
    room.subscribe((event) => postRevocationEvents.push(event));
    socket.serverEmit("studio:presence:update", {
      ...remote,
      state: "idle",
      pageId: "must-not-appear",
    });
    socket.serverEmit("studio:lock:update", {
      action: "acquired",
      lock: {
        resourceId: "page:must-not-appear",
        leaseId: "revoked-lease",
        ownerConnectionId: remote.connectionId,
        ownerName: remote.name,
        expiresAt: new Date(NOW + 15_000).toISOString(),
      },
    });
    socket.serverEmit("studio:screen:announce", {
      fromConnectionId: remote.connectionId,
      fromName: remote.name,
      shareId: "revoked-share",
      label: "작업 화면",
    });
    socket.serverEmit("studio:signal", {
      signalId: "revoked-signal",
      fromConnectionId: remote.connectionId,
      fromName: remote.name,
      shareId: "revoked-share",
      kind: "description",
      description: { type: "offer", sdp: "v=0" },
    });
    expect(room.getPeers()).toEqual([]);
    expect(room.getLocks()).toEqual([]);
    expect(postRevocationEvents).toEqual([]);
    room.close();
  });

  it("treats an authenticated reconnect rejection as terminal and never overwrites revoked", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const statuses: StudioLiveRoomEvent[] = [];
    const room = new StudioLiveRoom({
      workId: "work-1",
      participant: localParticipant,
      dependencies: {
        transportFactory: createStudioServerLiveTransportFactory(TOKEN, {
          createSocket: () => socket,
          now: () => NOW,
        }),
        now: () => NOW,
      },
    });
    room.subscribe((event) => event.type === "transport-status" && statuses.push(event));
    await room.start();

    socket.serverDisconnect();
    const joinCountBeforeRejection = socket.emitted.filter(
      (event) => event.event === "studio:join"
    ).length;
    const authError = Object.assign(new Error("로그인 세션이 만료되었습니다."), {
      data: { code: "unauthenticated" },
    });
    socket.serverEmit("connect_error", authError);

    expect(room.ready).toBe(false);
    expect(socket.connected).toBe(false);
    expect(statuses.at(-1)).toEqual(
      expect.objectContaining({
        status: {
          state: "revoked",
          message: "로그인 세션이 만료되었습니다.",
          recoverable: false,
        },
      })
    );
    expect(
      statuses.slice(-2).map((event) =>
        event.type === "transport-status" ? event.status.state : null
      )
    ).toEqual(["disconnected", "revoked"]);

    socket.serverReconnect();
    expect(room.ready).toBe(false);
    expect(
      socket.emitted.filter((event) => event.event === "studio:join")
    ).toHaveLength(joinCountBeforeRejection);
    room.close();
  });

  it("refreshes an expired admission ticket once in memory before reconnecting", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const refreshedTicket = "fresh-short-lived-admission-ticket";
    const refreshSocketCredential = vi.fn(async () => refreshedTicket);
    const room = new StudioLiveRoom({
      workId: "work-1",
      participant: localParticipant,
      dependencies: {
        transportFactory: createStudioServerLiveTransportFactory(TOKEN, {
          createSocket: () => socket,
          refreshSocketCredential,
          now: () => NOW,
        }),
        now: () => NOW,
      },
    });
    await room.start();
    const initialConnectCalls = socket.connectCalls;

    socket.serverDisconnect();
    socket.serverEmit(
      "connect_error",
      Object.assign(new Error("입장권이 만료되었습니다."), {
        data: { code: "unauthenticated" },
      }),
    );

    await vi.waitFor(() => expect(room.ready).toBe(true));
    expect(refreshSocketCredential).toHaveBeenCalledOnce();
    expect(socket.auth).toEqual({ sessionToken: refreshedTicket });
    expect(socket.connectCalls).toBe(initialConnectCalls + 1);
    room.close();
  });

  it("fails closed when a one-shot admission refresh cannot reauthenticate", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const refreshSocketCredential = vi.fn(async () => {
      throw new Error("cookie session unavailable");
    });
    const statuses: StudioLiveRoomEvent[] = [];
    const room = new StudioLiveRoom({
      workId: "work-1",
      participant: localParticipant,
      dependencies: {
        transportFactory: createStudioServerLiveTransportFactory(TOKEN, {
          createSocket: () => socket,
          refreshSocketCredential,
          now: () => NOW,
        }),
        now: () => NOW,
      },
    });
    room.subscribe((event) => event.type === "transport-status" && statuses.push(event));
    await room.start();

    socket.serverDisconnect();
    socket.serverEmit(
      "connect_error",
      Object.assign(new Error("입장권이 만료되었습니다."), {
        data: { code: "unauthenticated" },
      }),
    );

    await vi.waitFor(() => expect(socket.auth).toEqual({}));
    expect(refreshSocketCredential).toHaveBeenCalledOnce();
    expect(room.ready).toBe(false);
    expect(statuses.at(-1)).toEqual(expect.objectContaining({
      status: {
        state: "revoked",
        message: "입장권이 만료되었습니다.",
        recoverable: false,
      },
    }));
    room.close();
  });

  it("keeps an ordinary reconnect network error recoverable", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const statuses: StudioLiveRoomEvent[] = [];
    const room = new StudioLiveRoom({
      workId: "work-1",
      participant: localParticipant,
      dependencies: {
        transportFactory: createStudioServerLiveTransportFactory(TOKEN, {
          createSocket: () => socket,
          now: () => NOW,
        }),
        now: () => NOW,
      },
    });
    room.subscribe((event) => event.type === "transport-status" && statuses.push(event));
    await room.start();

    socket.serverDisconnect();
    socket.serverEmit("connect_error", new Error("temporary network failure"));
    expect(room.ready).toBe(false);
    expect(socket.auth).toEqual({ sessionToken: TOKEN });
    expect(statuses.at(-1)).toEqual(
      expect.objectContaining({
        status: {
          state: "error",
          message: "temporary network failure",
          recoverable: true,
        },
      })
    );

    socket.serverReconnect();
    expect(room.ready).toBe(true);
    expect(socket.auth).toEqual({ sessionToken: TOKEN });
    expect(statuses.at(-1)).toEqual(
      expect.objectContaining({ status: expect.objectContaining({ state: "ready" }) })
    );
    room.close();
  });

  it("fails closed on a denied initial join without leaking the handshake token", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = {
      ok: false,
      code: "forbidden",
      message: "이 작품의 실시간 작업실에 참여할 권한이 없습니다.",
    };
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });

    await expect(transport.connect()).rejects.toThrow("참여할 권한");
    expect(transport.ready).toBe(false);
    expect(socket.auth).toEqual({});
    expect(
      (transport as unknown as { sessionToken: string | null }).sessionToken
    ).toBeNull();
    expect(JSON.stringify(socket.emitted)).not.toContain(TOKEN);
    transport.close();
  });

  it("stays unready until the advertised binary wire selection ACK is correlated", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = binaryJoinSuccess();
    socket.holdEvents.add(STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT);
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });

    const connecting = transport.connect();
    expect(transport.ready).toBe(false);
    expect(socket.emitted.slice(0, 2)).toEqual([
      {
        event: "studio:join",
        payload: {
          workId: "work-1",
          clientInstanceId: localParticipant.sessionId,
        },
      },
      {
        event: STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT,
        payload: {
          protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
          wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
          workId: "work-1",
          format: "binary-v1",
          selectionEpoch: CRDT_WIRE_EPOCH,
        },
      },
    ]);

    socket.reply(
      STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT,
      binarySelectionSuccess()
    );
    await connecting;
    expect(transport.ready).toBe(true);
    transport.close();
  });

  it("uses binary envelopes for authoritative sync and publication after selection", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = binaryJoinSuccess();
    socket.ackResponses.set(
      STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT,
      binarySelectionSuccess()
    );
    const diff = Uint8Array.of(1, 2, 3, 4);
    const fragments = fragmentStudioCrdtBinarySyncEnvelope(
      encodeStudioCrdtBinaryEnvelope("sync-diff", diff)
    );
    const stateVectorBytes = Uint8Array.of(0);
    socket.ackResponses.set(STUDIO_LIVE_CRDT_BINARY_SYNC_EVENT, {
      ok: true,
      data: {
        protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
        wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
        workId: "work-1",
        requestId: "request-binary",
        transferId: "11111111-1111-4111-8111-111111111111",
        fragments,
        fragmentCount: fragments.length,
        wireBytes: fragments.reduce(
          (sum, fragment) => sum + fragment.byteLength,
          0
        ),
        totalBytes: diff.byteLength,
        serverStateVector: encodeStudioCrdtBinaryEnvelope(
          "state-vector",
          stateVectorBytes
        ),
        serverSequence: "12",
      },
    });
    const updateId = "22222222-2222-4222-8222-222222222222";
    socket.ackResponses.set(STUDIO_LIVE_CRDT_BINARY_UPDATE_EVENT, {
      ok: true,
      data: {
        protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
        wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
        workId: "work-1",
        updateId,
        serverSequence: "13",
        duplicate: false,
      },
    });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();

    await expect(transport.requestCrdtSync({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-1",
      requestId: "request-binary",
      stateVector: encodeStudioCrdtStateVector(stateVectorBytes),
    })).resolves.toEqual(expect.objectContaining({
      requestId: "request-binary",
      chunks: encodeStudioCrdtSyncChunks(diff),
      serverSequence: "12",
    }));
    const updateBytes = Uint8Array.of(9, 8, 7);
    await expect(transport.publishCrdtUpdate({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-1",
      updateId,
      clientSequence: 1,
      update: encodeStudioCrdtUpdate(updateBytes),
    })).resolves.toEqual({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-1",
      updateId,
      serverSequence: "13",
      serverStateVector: null,
      duplicate: false,
    });

    const binarySync = socket.emitted.find(
      ({ event }) => event === STUDIO_LIVE_CRDT_BINARY_SYNC_EVENT
    );
    const binaryUpdate = socket.emitted.find(
      ({ event }) => event === STUDIO_LIVE_CRDT_BINARY_UPDATE_EVENT
    );
    expect(
      decodeStudioCrdtBinaryEnvelope(
        (binarySync?.payload as { stateVector: Uint8Array }).stateVector,
        "state-vector"
      ).bytes
    ).toEqual(stateVectorBytes);
    expect(
      decodeStudioCrdtBinaryEnvelope(
        (binaryUpdate?.payload as { update: Uint8Array }).update,
        "update"
      ).bytes
    ).toEqual(updateBytes);
    expect(
      socket.emitted.some(
        ({ event }) => event === "studio:crdt:sync" || event === "studio:crdt:update"
      )
    ).toBe(false);
    transport.close();
  });

  it("deduplicates the same remote updateId across legacy and binary rollout events", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = binaryJoinSuccess();
    socket.ackResponses.set(
      STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT,
      binarySelectionSuccess()
    );
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const durable: StudioCrdtTransportMessage[] = [];
    transport.subscribeCrdt((message) => durable.push(message));
    await transport.connect();

    const raw = Uint8Array.of(5, 6, 7);
    const legacyFirst = {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-1",
      updateId: "33333333-3333-4333-8333-333333333333",
      serverSequence: "20",
      update: encodeStudioCrdtUpdate(raw),
    };
    const binaryFirst = {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
      workId: "work-1",
      updateId: "44444444-4444-4444-8444-444444444444",
      serverSequence: "21",
      update: encodeStudioCrdtBinaryEnvelope("update", raw),
    };
    socket.serverEmit("studio:crdt:update", legacyFirst);
    socket.serverEmit(STUDIO_LIVE_CRDT_BINARY_REMOTE_EVENT, {
      ...binaryFirst,
      updateId: legacyFirst.updateId,
      serverSequence: legacyFirst.serverSequence,
    });
    socket.serverEmit(STUDIO_LIVE_CRDT_BINARY_REMOTE_EVENT, binaryFirst);
    socket.serverEmit("studio:crdt:update", {
      ...legacyFirst,
      updateId: binaryFirst.updateId,
      serverSequence: binaryFirst.serverSequence,
    });

    expect(durable).toHaveLength(2);
    expect(durable.map((message) =>
      message.type === "update" ? message.update.updateId : null
    )).toEqual([legacyFirst.updateId, binaryFirst.updateId]);
    transport.close();
  });

  it("reconnects with a new join when the select epoch acknowledgement is stale", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = binaryJoinSuccess();
    socket.ackResponses.set(
      STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT,
      binarySelectionSuccess("00000000-0000-4000-8000-000000000999")
    );
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });

    const connecting = transport.connect();
    expect(transport.ready).toBe(false);
    socket.ackResponses.set(
      STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT,
      binarySelectionSuccess()
    );
    await vi.advanceTimersByTimeAsync(0);
    await connecting;

    expect(
      socket.emitted.filter(({ event }) => event === "studio:join")
    ).toHaveLength(2);
    expect(
      socket.emitted.filter(
        ({ event }) => event === STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT
      )
    ).toHaveLength(2);
    expect(transport.ready).toBe(true);
    transport.close();
  });

  it("reconnects instead of falling back when the select acknowledgement is lost", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = binaryJoinSuccess();
    socket.holdEvents.add(STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT);
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });

    const connecting = transport.connect();
    socket.holdEvents.delete(STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT);
    socket.ackResponses.set(
      STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT,
      binarySelectionSuccess()
    );
    await vi.advanceTimersByTimeAsync(8_000);
    await vi.advanceTimersByTimeAsync(1);
    await connecting;

    expect(
      socket.emitted.filter(({ event }) => event === "studio:join")
    ).toHaveLength(2);
    expect(transport.ready).toBe(true);
    // The expired callback belongs to the abandoned generation and must not change readiness.
    socket.reply(
      STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT,
      binarySelectionSuccess()
    );
    expect(transport.ready).toBe(true);
    transport.close();
  });

  it("fails closed and reconnects when a fragmented binary sync response is damaged", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = binaryJoinSuccess();
    socket.ackResponses.set(
      STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT,
      binarySelectionSuccess()
    );
    const diff = new Uint8Array(50_000);
    diff[0] = 1;
    diff[diff.length - 1] = 2;
    const fragments = fragmentStudioCrdtBinarySyncEnvelope(
      encodeStudioCrdtBinaryEnvelope("sync-diff", diff)
    );
    fragments.at(-1)![fragments.at(-1)!.length - 1] ^= 0xff;
    socket.ackResponses.set(STUDIO_LIVE_CRDT_BINARY_SYNC_EVENT, {
      ok: true,
      data: {
        protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
        wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
        workId: "work-1",
        requestId: "damaged-sync",
        transferId: "55555555-5555-4555-8555-555555555555",
        fragments,
        fragmentCount: fragments.length,
        wireBytes: fragments.reduce(
          (sum, fragment) => sum + fragment.byteLength,
          0
        ),
        totalBytes: diff.byteLength,
        serverStateVector: encodeStudioCrdtBinaryEnvelope(
          "state-vector",
          Uint8Array.of(0)
        ),
        serverSequence: "30",
      },
    });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();

    const failure = await transport.requestCrdtSync({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-1",
      requestId: "damaged-sync",
      stateVector: encodeStudioCrdtStateVector(Uint8Array.of(0)),
    }).then(
      () => null,
      (error: unknown) => error
    );
    expect(failure).toMatchObject({
      code: "connection_changed",
      disposition: "retryable",
      source: "connection",
    });
    expect(transport.ready).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(
      socket.emitted.filter(({ event }) => event === "studio:join")
    ).toHaveLength(2);
    expect(transport.ready).toBe(true);
    transport.close();
  });

  it("uses ACKed durable CRDT events outside the ephemeral signaling union", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const stateVector = encodeStudioCrdtStateVector(new Uint8Array([0]));
    const syncBytes = new Uint8Array([1, 2, 3, 4]);
    const chunks = encodeStudioCrdtSyncChunks(syncBytes);
    socket.ackResponses.set("studio:crdt:sync", {
      ok: true,
      data: {
        protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
        workId: "work-1",
        requestId: "request-1",
        transferId: "11111111-1111-4111-8111-111111111111",
        chunks,
        chunkCount: chunks.length,
        totalBytes: syncBytes.byteLength,
        serverStateVector: stateVector,
        serverSequence: "12",
      },
    });
    socket.ackResponses.set("studio:crdt:update", {
      ok: true,
      data: {
        protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
        workId: "work-1",
        updateId: "22222222-2222-4222-8222-222222222222",
        serverSequence: "13",
        serverStateVector: stateVector,
        duplicate: false,
      },
    });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const ephemeral: unknown[] = [];
    transport.subscribe((value) => ephemeral.push(value));
    await transport.connect();

    await expect(
      transport.requestCrdtSync({
        protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
        workId: "work-1",
        requestId: "request-1",
        stateVector,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        transferId: "11111111-1111-4111-8111-111111111111",
        chunks,
      })
    );
    await expect(
      transport.publishCrdtUpdate({
        protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
        workId: "work-1",
        updateId: "22222222-2222-4222-8222-222222222222",
        clientSequence: 1,
        update: encodeStudioCrdtUpdate(new Uint8Array([9, 8, 7])),
      })
    ).resolves.toEqual(
      expect.objectContaining({
        updateId: "22222222-2222-4222-8222-222222222222",
        serverSequence: "13",
      })
    );
    expect(
      socket.emitted.filter(
        ({ event }) => event === "studio:crdt:sync" || event === "studio:crdt:update"
      )
    ).toHaveLength(2);
    expect(ephemeral).toEqual([]);
    transport.close();
  });

  it.each([
    ["invalid_payload", "permanent"],
    ["forbidden", "permanent"],
    ["storage_corruption", "permanent"],
    ["rate_limited", "retryable"],
    ["internal_error", "retryable"],
  ] as const)(
    "preserves the %s CRDT ACK code with a %s retry disposition",
    async (code, disposition) => {
      const socket = new FakeSocket({ sessionToken: TOKEN });
      socket.ackResponses.set("studio:crdt:update", {
        ok: false,
        code,
        message: `server rejected: ${code}`,
      });
      const transport = new StudioLiveSocketTransport(context(), TOKEN, {
        createSocket: () => socket,
        now: () => NOW,
      });
      await transport.connect();

      const failure = await transport.publishCrdtUpdate({
        protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
        workId: "work-1",
        updateId: "99999999-9999-4999-8999-999999999999",
        clientSequence: 1,
        update: encodeStudioCrdtUpdate(new Uint8Array([9, 9, 9])),
      }).then(
        () => null,
        (error: unknown) => error
      );

      expect(failure).toBeInstanceOf(StudioCrdtOperationError);
      expect(failure).toMatchObject({
        code,
        disposition,
        source: "server-ack",
        message: `server rejected: ${code}`,
      });
      transport.close();
    }
  );

  it("preserves a permanent storage-corruption rejection on the CRDT sync path", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.ackResponses.set("studio:crdt:sync", {
      ok: false,
      code: "storage_corruption",
      message: "authoritative CRDT storage is corrupt",
    });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();

    const failure = await transport.requestCrdtSync({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-1",
      requestId: "storage-corruption-sync",
      stateVector: encodeStudioCrdtStateVector(new Uint8Array([0])),
    }).then(
      () => null,
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(StudioCrdtOperationError);
    expect(failure).toMatchObject({
      code: "storage_corruption",
      disposition: "permanent",
      source: "server-ack",
      message: "authoritative CRDT storage is corrupt",
    });
    transport.close();
  });

  it("rejects an in-flight durable update as permanent when access is revoked", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:crdt:update");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();
    const publication = transport.publishCrdtUpdate({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-1",
      updateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      clientSequence: 1,
      update: encodeStudioCrdtUpdate(new Uint8Array([1, 4, 1])),
    });

    socket.serverEmit("studio:access:revoked", {
      workId: "work-1",
      message: "editing access revoked",
    });
    const failure = await publication.then(
      () => null,
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(StudioCrdtOperationError);
    expect(failure).toMatchObject({
      code: "access_revoked",
      disposition: "permanent",
      source: "connection",
      message: "editing access revoked",
    });
    expect(transport.ready).toBe(false);
    transport.close();
  });

  it("coalesces an in-flight updateId retry and deduplicates remote broadcasts", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:crdt:update");
    const stateVector = encodeStudioCrdtStateVector(new Uint8Array([0]));
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const durable: StudioCrdtTransportMessage[] = [];
    transport.subscribeCrdt((message) => durable.push(message));
    await transport.connect();
    const request = {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-1",
      updateId: "33333333-3333-4333-8333-333333333333",
      clientSequence: 1,
      update: encodeStudioCrdtUpdate(new Uint8Array([5, 6, 7])),
    } as const;
    const first = transport.publishCrdtUpdate(request);
    const retry = transport.publishCrdtUpdate(request);
    expect(retry).toBe(first);
    expect(socket.emitted.filter(({ event }) => event === "studio:crdt:update")).toHaveLength(1);
    socket.reply("studio:crdt:update", {
      ok: true,
      data: {
        protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
        workId: "work-1",
        updateId: request.updateId,
        serverSequence: "21",
        serverStateVector: stateVector,
        duplicate: false,
      },
    });
    await expect(first).resolves.toEqual(expect.objectContaining({ serverSequence: "21" }));

    const remoteUpdate = {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-1",
      updateId: "44444444-4444-4444-8444-444444444444",
      serverSequence: "22",
      update: request.update,
    } as const;
    socket.serverEmit("studio:crdt:update", remoteUpdate);
    socket.serverEmit("studio:crdt:update", remoteUpdate);
    expect(durable).toEqual([
      expect.objectContaining({ type: "update", update: remoteUpdate }),
    ]);
    transport.close();
  });

  it("rejects a durable CRDT operation when its Socket.IO ACK never arrives", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:crdt:update");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();
    const request = {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-1",
      updateId: "66666666-6666-4666-8666-666666666666",
      clientSequence: 1,
      update: encodeStudioCrdtUpdate(new Uint8Array([5, 4, 3])),
    } as const;

    const publication = transport.publishCrdtUpdate(request);
    const rejected = expect(publication).rejects.toThrow("응답 시간이 초과");
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;

    // A very late ACK belongs to the expired operation and must not revive it or emit errors.
    socket.reply("studio:crdt:update", {
      ok: true,
      data: {
        protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
        workId: "work-1",
        updateId: request.updateId,
        serverSequence: "23",
        serverStateVector: encodeStudioCrdtStateVector(new Uint8Array([0])),
        duplicate: false,
      },
    });
    transport.close();
  });

  it("rejects a CRDT ACK whose durable operation id does not match the request", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const stateVector = encodeStudioCrdtStateVector(new Uint8Array([0]));
    socket.ackResponses.set("studio:crdt:update", {
      ok: true,
      data: {
        protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
        workId: "work-1",
        updateId: "88888888-8888-4888-8888-888888888888",
        serverSequence: "24",
        serverStateVector: stateVector,
        duplicate: false,
      },
    });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();

    await expect(
      transport.publishCrdtUpdate({
        protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
        workId: "work-1",
        updateId: "77777777-7777-4777-8777-777777777777",
        clientSequence: 1,
        update: encodeStudioCrdtUpdate(new Uint8Array([1, 2, 3])),
      })
    ).rejects.toThrow("식별자가 요청과 일치하지 않습니다");
    transport.close();
  });

  it("accepts a fresh state-vector sync after an authenticated reconnect", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const stateVector = encodeStudioCrdtStateVector(new Uint8Array([0]));
    const chunks = encodeStudioCrdtSyncChunks(new Uint8Array([0]));
    socket.ackResponses.set("studio:crdt:sync", {
      ok: true,
      data: {
        protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
        workId: "work-1",
        requestId: "reconnect-request",
        transferId: "55555555-5555-4555-8555-555555555555",
        chunks,
        chunkCount: chunks.length,
        totalBytes: 1,
        serverStateVector: stateVector,
        serverSequence: "0",
      },
    });
    const room = new StudioLiveRoom({
      workId: "work-1",
      participant: localParticipant,
      dependencies: {
        transportFactory: createStudioServerLiveTransportFactory(TOKEN, {
          createSocket: () => socket,
          now: () => NOW,
        }),
        now: () => NOW,
      },
    });
    await room.start();
    await room.requestCrdtSync({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-1",
      requestId: "reconnect-request",
      stateVector,
    });
    expect(socket.emitted.filter(({ event }) => event === "studio:crdt:sync")).toHaveLength(1);

    socket.serverDisconnect();
    socket.serverReconnect();
    await room.requestCrdtSync({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-1",
      requestId: "reconnect-request",
      stateVector,
    });
    expect(socket.emitted.filter(({ event }) => event === "studio:crdt:sync")).toHaveLength(2);
    room.close();
  });

  it("maps a dedicated voice room without mixing screen WebRTC identifiers", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({
      voiceMembers: [
        { connectionId: remote.connectionId, callId: "voice-main", muted: true },
      ],
    });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));
    await transport.connect();
    activate(transport);
    expect(received).toContainEqual(
      expect.objectContaining({
        kind: "voice:join",
        payload: { callId: "voice-main", muted: true },
      })
    );

    expect(
      transport.send(envelope("voice:join", { callId: "voice-main", muted: false }, 2))
    ).toBe(true);
    expect(socket.emitted.at(-1)).toEqual({
      event: "studio:voice:join",
      payload: { workId: "work-1", callId: "voice-main", muted: false },
    });
    socket.serverEmit("studio:voice:snapshot", {
      workId: "work-1",
      members: [
        { connectionId: self.connectionId, callId: "voice-main", muted: false },
        { connectionId: remote.connectionId, callId: "voice-main", muted: true },
      ],
    });
    expect(received.at(-1)).toEqual(
      expect.objectContaining({
        kind: "voice:join",
        sender: expect.objectContaining({ sessionId: remote.connectionId }),
        payload: { callId: "voice-main", muted: true },
      })
    );
    expect(
      transport.send(
        envelope(
          "voice:description",
          { callId: "voice-main", type: "offer", sdp: "v=0" },
          3,
          remote.connectionId
        )
      )
    ).toBe(true);
    expect(socket.emitted.at(-1)).toEqual({
      event: "studio:voice:signal",
      payload: {
        workId: "work-1",
        targetConnectionId: remote.connectionId,
        callId: "voice-main",
        kind: "description",
        description: { type: "offer", sdp: "v=0" },
      },
    });
    expect(
      transport.send(
        envelope(
          "voice:description",
          { callId: "share-screen", type: "offer", sdp: "v=0" },
          4,
          remote.connectionId
        )
      )
    ).toBe(false);

    socket.serverEmit("studio:voice:signal", {
      fromConnectionId: remote.connectionId,
      callId: "voice-main",
      kind: "description",
      description: { type: "answer", sdp: "v=0" },
    });
    expect(received.at(-1)).toEqual(
      expect.objectContaining({
        kind: "voice:description",
        payload: { callId: "voice-main", type: "answer", sdp: "v=0" },
      })
    );
    socket.serverEmit("studio:voice:signal", {
      fromConnectionId: remote.connectionId,
      callId: "share-screen",
      kind: "description",
      description: { type: "answer", sdp: "v=0" },
    });
    expect(received.at(-1)?.payload).toEqual({
      callId: "voice-main",
      type: "answer",
      sdp: "v=0",
    });
    transport.close();
  });

  it("holds voice offers and ICE until the correlated authoritative join ACK succeeds", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({
      voiceMembers: [
        { connectionId: remote.connectionId, callId: "voice-authoritative", muted: false },
      ],
    });
    socket.holdEvents.add("studio:voice:join");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();
    activate(transport);

    expect(transport.send(envelope("voice:join", {
      callId: "voice-authoritative",
      muted: false,
    }, 2))).toBe(true);
    socket.serverEmit("studio:voice:snapshot", {
      workId: "work-1",
      callId: "voice-authoritative",
      members: [
        { connectionId: self.connectionId, callId: "voice-authoritative", muted: false },
        { connectionId: remote.connectionId, callId: "voice-authoritative", muted: false },
      ],
    });
    expect(
      (transport as unknown as {
        voiceMemberByConnection: Map<string, unknown>;
      }).voiceMemberByConnection.has(self.connectionId)
    ).toBe(false);

    expect(transport.send(envelope(
      "voice:description",
      { callId: "voice-authoritative", type: "offer", sdp: "v=0\r\nold-offer" },
      3,
      remote.connectionId
    ))).toBe(true);
    expect(transport.send(envelope(
      "voice:ice",
      {
        callId: "voice-authoritative",
        candidate: "candidate:queued",
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: null,
      },
      4,
      remote.connectionId
    ))).toBe(true);
    expect(socket.emitted.filter(({ event }) => event === "studio:voice:signal")).toEqual([]);

    socket.reply("studio:voice:join", {
      ok: true,
      data: {
        members: [
          { connectionId: self.connectionId, callId: "voice-authoritative", muted: false },
          { connectionId: remote.connectionId, callId: "voice-authoritative", muted: false },
        ],
      },
    });
    expect(socket.emitted.filter(({ event }) => event === "studio:voice:signal")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          kind: "description",
          callId: "voice-authoritative",
        }),
      }),
      expect.objectContaining({
        payload: expect.objectContaining({
          kind: "candidate",
          callId: "voice-authoritative",
        }),
      }),
    ]);
    expect(
      (transport as unknown as {
        voiceMemberByConnection: Map<string, unknown>;
      }).voiceMemberByConnection.has(self.connectionId)
    ).toBe(true);
    transport.close();
  });

  it("coalesces pending mute changes and publishes only the latest state after join admission", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({
      voiceMembers: [
        { connectionId: remote.connectionId, callId: "voice-muted", muted: false },
      ],
    });
    socket.holdEvents.add("studio:voice:join");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();
    activate(transport);

    expect(transport.send(envelope("voice:join", {
      callId: "voice-muted",
      muted: false,
    }, 2))).toBe(true);
    expect(transport.send(envelope("voice:state", {
      callId: "voice-muted",
      muted: true,
    }, 3))).toBe(true);
    expect(socket.emitted.filter(({ event }) => event === "studio:voice:state")).toEqual([]);

    socket.reply("studio:voice:join", {
      ok: true,
      data: {
        members: [
          { connectionId: self.connectionId, callId: "voice-muted", muted: false },
          { connectionId: remote.connectionId, callId: "voice-muted", muted: false },
        ],
      },
    });
    expect(socket.emitted.filter(({ event }) => event === "studio:voice:state")).toEqual([
      {
        event: "studio:voice:state",
        payload: { workId: "work-1", callId: "voice-muted", muted: true },
      },
    ]);
    expect(
      (transport as unknown as {
        voiceMemberByConnection: Map<string, { muted: boolean }>;
      }).voiceMemberByConnection.get(self.connectionId)?.muted
    ).toBe(true);
    transport.close();
  });

  it("fails closed when a pending voice attempt exceeds its bounded signal queue", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({
      voiceMembers: [
        { connectionId: remote.connectionId, callId: "voice-overflow", muted: false },
      ],
    });
    socket.holdEvents.add("studio:voice:join");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const controls: StudioLiveTransportControlEvent[] = [];
    transport.subscribeControl((event) => controls.push(event));
    await transport.connect();
    activate(transport);
    expect(transport.send(envelope("voice:join", {
      callId: "voice-overflow",
      muted: false,
    }, 2))).toBe(true);

    for (let index = 0; index < 256; index += 1) {
      expect(transport.send(envelope(
        "voice:ice",
        {
          callId: "voice-overflow",
          candidate: `candidate:queued-${index}`,
          sdpMid: "0",
          sdpMLineIndex: 0,
          usernameFragment: null,
        },
        index + 3,
        remote.connectionId
      ))).toBe(true);
    }
    expect(transport.send(envelope(
      "voice:ice",
      {
        callId: "voice-overflow",
        candidate: "candidate:overflow",
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: null,
      },
      259,
      remote.connectionId
    ))).toBe(false);

    expect(controls).toContainEqual({
      type: "voice-removed",
      callId: "voice-overflow",
      reason: "rejected",
      message: "음성 연결 신호가 너무 많이 대기해 참가를 안전하게 취소했습니다. 다시 참가해 주세요.",
    });
    expect(socket.emitted.filter(({ event }) => event === "studio:voice:signal")).toEqual([]);
    socket.reply("studio:voice:join", { ok: true, data: { members: [] } });
    expect(socket.emitted.filter(({ event }) => event === "studio:voice:signal")).toEqual([]);
    transport.close();
  });

  it("times out an unacknowledged voice admission and never flushes its queued signals", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({
      voiceMembers: [
        { connectionId: remote.connectionId, callId: "voice-timeout", muted: false },
      ],
    });
    socket.holdEvents.add("studio:voice:join");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
      voiceJoinAckTimeoutMs: 250,
    });
    const controls: StudioLiveTransportControlEvent[] = [];
    transport.subscribeControl((event) => controls.push(event));
    await transport.connect();
    activate(transport);

    expect(transport.send(envelope("voice:join", {
      callId: "voice-timeout",
      muted: false,
    }, 2))).toBe(true);
    expect(transport.send(envelope(
      "voice:description",
      { callId: "voice-timeout", type: "offer", sdp: "v=0" },
      3,
      remote.connectionId
    ))).toBe(true);
    await vi.advanceTimersByTimeAsync(250);

    expect(controls).toContainEqual({
      type: "voice-removed",
      callId: "voice-timeout",
      reason: "rejected",
      message: "음성 작업실 참가 응답 시간이 초과되었습니다. 다시 참가해 주세요.",
    });
    expect(socket.emitted.filter(({ event }) => event === "studio:voice:signal")).toEqual([]);
    expect(
      (transport as unknown as { pendingVoiceAdmission: unknown }).pendingVoiceAdmission
    ).toBeNull();

    socket.reply("studio:voice:join", { ok: true, data: { members: [] } });
    expect(socket.emitted.filter(({ event }) => event === "studio:voice:signal")).toEqual([]);
    expect(socket.emitted.filter(
      ({ event, payload }) =>
        event === "studio:voice:leave" &&
        (payload as { callId?: string }).callId === "voice-timeout"
    ).length).toBeGreaterThanOrEqual(2);
    transport.close();
  });

  it("isolates voice admission queues across reconnect generations", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({
      voiceMembers: [
        { connectionId: remote.connectionId, callId: "voice-generation", muted: false },
      ],
    });
    socket.holdEvents.add("studio:voice:join");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();
    activate(transport);

    expect(transport.send(envelope("voice:join", {
      callId: "voice-generation",
      muted: false,
    }, 2))).toBe(true);
    expect(transport.send(envelope(
      "voice:description",
      { callId: "voice-generation", type: "offer", sdp: "v=0\r\nstale" },
      3,
      remote.connectionId
    ))).toBe(true);

    socket.serverDisconnect();
    socket.joinResponse = joinSuccess({
      voiceMembers: [
        { connectionId: self.connectionId, callId: "voice-generation", muted: false },
        { connectionId: remote.connectionId, callId: "voice-generation", muted: false },
      ],
    });
    socket.serverReconnect();
    expect(
      (transport as unknown as {
        voiceMemberByConnection: Map<string, unknown>;
      }).voiceMemberByConnection.has(self.connectionId)
    ).toBe(false);
    expect(transport.send(envelope("voice:join", {
      callId: "voice-generation",
      muted: false,
    }, 4))).toBe(true);
    expect(transport.send(envelope(
      "voice:description",
      { callId: "voice-generation", type: "offer", sdp: "v=0\r\nfresh" },
      5,
      remote.connectionId
    ))).toBe(true);

    socket.reply("studio:voice:join", { ok: true, data: { members: [] } });
    expect(socket.emitted.filter(({ event }) => event === "studio:voice:signal")).toEqual([]);
    socket.reply("studio:voice:join", {
      ok: true,
      data: {
        members: [
          { connectionId: self.connectionId, callId: "voice-generation", muted: false },
          { connectionId: remote.connectionId, callId: "voice-generation", muted: false },
        ],
      },
    });
    expect(socket.emitted.filter(({ event }) => event === "studio:voice:signal")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          description: { type: "offer", sdp: "v=0\r\nfresh" },
        }),
      }),
    ]);
    transport.close();
  });

  it("rolls back a capacity-rejected admission without publishing queued media signals", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({
      voiceMembers: [
        { connectionId: remote.connectionId, callId: "voice-full", muted: false },
      ],
    });
    socket.holdEvents.add("studio:voice:join");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const controls: StudioLiveTransportControlEvent[] = [];
    transport.subscribeControl((event) => controls.push(event));
    await transport.connect();
    activate(transport);

    expect(transport.send(envelope("voice:join", {
      callId: "voice-full",
      muted: false,
    }, 2))).toBe(true);
    expect(transport.send(envelope(
      "voice:description",
      { callId: "voice-full", type: "offer", sdp: "v=0" },
      3,
      remote.connectionId
    ))).toBe(true);
    socket.reply("studio:voice:join", {
      ok: false,
      code: "rate_limited",
      message: "음성 대화 정원은 최대 6명입니다.",
    });

    expect(controls).toContainEqual({
      type: "voice-removed",
      callId: "voice-full",
      reason: "rejected",
      message: "음성 대화 정원은 최대 6명입니다.",
    });
    expect(socket.emitted.filter(({ event }) => event === "studio:voice:signal")).toEqual([]);
    expect(
      (transport as unknown as {
        voiceMemberByConnection: Map<string, unknown>;
      }).voiceMemberByConnection.has(self.connectionId)
    ).toBe(false);
    transport.close();
  });

  it("reconciles a voice join that arrives while the room ACL acknowledgement is pending", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:join");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));
    const connecting = transport.connect();
    socket.serverEmit("studio:voice:join", {
      connectionId: remote.connectionId,
      callId: "voice-main",
      muted: false,
    });
    socket.reply("studio:join", joinSuccess({ voiceMembers: [] }));
    await connecting;
    activate(transport);
    expect(received).toContainEqual(
      expect.objectContaining({
        kind: "voice:join",
        sender: expect.objectContaining({ sessionId: remote.connectionId }),
        payload: { callId: "voice-main", muted: false },
      })
    );
    transport.close();
  });

  it("replays coalesced voice join and snapshot state exactly once when presence arrives later", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({ participants: [self], voiceMembers: [] });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));
    await transport.connect();
    activate(transport);

    socket.serverEmit("studio:voice:join", {
      connectionId: remote.connectionId,
      callId: "voice-late-presence",
      muted: true,
    });
    socket.serverEmit("studio:voice:snapshot", {
      workId: "work-1",
      callId: "voice-late-presence",
      members: [{
        connectionId: remote.connectionId,
        callId: "voice-late-presence",
        muted: false,
      }],
    });
    expect(received.filter(({ kind }) => kind === "voice:join")).toEqual([]);

    socket.serverEmit("studio:presence:update", {
      ...remote,
      updatedAt: new Date(NOW + 1).toISOString(),
    });
    socket.serverEmit("studio:presence:update", {
      ...remote,
      state: "idle",
      updatedAt: new Date(NOW + 2).toISOString(),
    });
    socket.serverEmit("studio:voice:snapshot", {
      workId: "work-1",
      callId: "voice-late-presence",
      members: [{
        connectionId: remote.connectionId,
        callId: "voice-late-presence",
        muted: false,
      }],
    });

    expect(received.filter(({ kind }) => kind === "voice:join")).toEqual([
      expect.objectContaining({
        sender: expect.objectContaining({ sessionId: remote.connectionId }),
        payload: { callId: "voice-late-presence", muted: false },
      }),
    ]);
    transport.close();
  });

  it("treats a voice state that races ahead of identity as the latest pending membership", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({ participants: [self], voiceMembers: [] });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));
    await transport.connect();
    activate(transport);

    socket.serverEmit("studio:voice:state", {
      connectionId: remote.connectionId,
      callId: "voice-state-first",
      muted: true,
    });
    expect(received.filter(({ kind }) => kind.startsWith("voice:"))).toEqual([]);

    socket.serverEmit("studio:presence:update", {
      ...remote,
      updatedAt: new Date(NOW + 1).toISOString(),
    });
    expect(received.filter(({ kind }) => kind === "voice:join")).toEqual([
      expect.objectContaining({
        payload: { callId: "voice-state-first", muted: true },
      }),
    ]);
    transport.close();
  });

  it("keeps a voice leave tombstone from being revived by a stale snapshot before presence", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({ participants: [self], voiceMembers: [] });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));
    await transport.connect();
    activate(transport);

    const member = {
      connectionId: remote.connectionId,
      callId: "voice-tombstone",
      muted: false,
    };
    socket.serverEmit("studio:voice:join", member);
    socket.serverEmit("studio:voice:leave", {
      connectionId: remote.connectionId,
      callId: "voice-tombstone",
    });
    socket.serverEmit("studio:voice:snapshot", {
      workId: "work-1",
      callId: "voice-tombstone",
      members: [member],
    });
    socket.serverEmit("studio:presence:update", {
      ...remote,
      updatedAt: new Date(NOW + 1).toISOString(),
    });
    socket.serverEmit("studio:presence:update", {
      ...remote,
      state: "idle",
      updatedAt: new Date(NOW + 2).toISOString(),
    });
    expect(received.filter(({ kind }) => kind.startsWith("voice:"))).toEqual([]);

    socket.serverEmit("studio:voice:join", { ...member, muted: true });
    expect(received.filter(({ kind }) => kind === "voice:join")).toEqual([
      expect.objectContaining({
        payload: { callId: "voice-tombstone", muted: true },
      }),
    ]);
    transport.close();
  });

  it("keeps a leave tombstone after presence so a later stale snapshot cannot revive it", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({ participants: [self], voiceMembers: [] });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));
    await transport.connect();
    activate(transport);
    const member = {
      connectionId: remote.connectionId,
      callId: "voice-late-stale-snapshot",
      muted: false,
    };

    socket.serverEmit("studio:voice:join", member);
    socket.serverEmit("studio:voice:leave", {
      connectionId: member.connectionId,
      callId: member.callId,
    });
    socket.serverEmit("studio:presence:update", {
      ...remote,
      updatedAt: new Date(NOW + 1).toISOString(),
    });
    socket.serverEmit("studio:voice:snapshot", {
      workId: "work-1",
      callId: member.callId,
      members: [member],
    });
    expect(received.filter(({ kind }) => kind.startsWith("voice:"))).toEqual([]);

    socket.serverEmit("studio:voice:join", { ...member, muted: true });
    expect(received.filter(({ kind }) => kind === "voice:join")).toEqual([
      expect.objectContaining({
        payload: { callId: member.callId, muted: true },
      }),
    ]);
    transport.close();
  });

  it("cleans up a late successful join acknowledgement after the user already left", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.holdEvents.add("studio:voice:join");
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();
    activate(transport);

    expect(transport.send(envelope("voice:join", {
      callId: "voice-late-ack",
      muted: false,
    }, 2))).toBe(true);
    expect(transport.send(envelope("voice:leave", { callId: "voice-late-ack" }, 3))).toBe(true);

    socket.serverEmit("studio:voice:snapshot", {
      workId: "work-1",
      callId: "voice-late-ack",
      members: [{
        connectionId: self.connectionId,
        callId: "voice-late-ack",
        muted: false,
      }],
    });
    socket.reply("studio:voice:join", { ok: true, data: { members: [] } });

    const leaveRequests = socket.emitted.filter(
      ({ event, payload }) =>
        event === "studio:voice:leave" &&
        (payload as { callId?: string }).callId === "voice-late-ack"
    );
    expect(leaveRequests.length).toBeGreaterThanOrEqual(2);
    expect(
      (transport as unknown as {
        voiceMemberByConnection: Map<string, unknown>;
      }).voiceMemberByConnection.has(self.connectionId)
    ).toBe(false);
    transport.close();
  });

  it("reconciles voice-before-presence and presence-before-voice orderings across reconnects", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({ participants: [self], voiceMembers: [] });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));
    await transport.connect();
    activate(transport);
    socket.holdEvents.add("studio:join");

    socket.serverDisconnect();
    socket.serverReconnect();
    socket.serverEmit("studio:voice:join", {
      connectionId: remote.connectionId,
      callId: "voice-reconnect",
      muted: false,
    });
    socket.reply("studio:join", joinSuccess({ participants: [self], voiceMembers: [] }));
    expect(received.filter(({ kind }) => kind === "voice:join")).toEqual([]);
    socket.serverEmit("studio:presence:update", {
      ...remote,
      updatedAt: new Date(NOW + 1).toISOString(),
    });
    expect(received.filter(({ kind }) => kind === "voice:join")).toHaveLength(1);

    socket.serverDisconnect();
    socket.serverReconnect();
    socket.serverEmit("studio:presence:update", {
      ...remote,
      state: "idle",
      updatedAt: new Date(NOW + 2).toISOString(),
    });
    socket.serverEmit("studio:voice:snapshot", {
      workId: "work-1",
      callId: "voice-reconnect",
      members: [{
        connectionId: remote.connectionId,
        callId: "voice-reconnect",
        muted: true,
      }],
    });
    socket.reply("studio:join", joinSuccess({ participants: [self], voiceMembers: [] }));

    expect(received.filter(({ kind }) => kind === "voice:join")).toEqual([
      expect.objectContaining({ payload: { callId: "voice-reconnect", muted: false } }),
      expect.objectContaining({ payload: { callId: "voice-reconnect", muted: true } }),
    ]);
    transport.close();
  });

  it("bounds unresolved voice identities and only replays entries retained in the pending window", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = joinSuccess({ participants: [self], voiceMembers: [] });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));
    await transport.connect();
    activate(transport);

    for (let index = 0; index <= 256; index += 1) {
      socket.serverEmit("studio:voice:join", {
        connectionId: `voice-pending-${index}`,
        callId: "voice-bounded",
        muted: false,
      });
    }
    expect(
      (transport as unknown as {
        pendingVoiceByConnection: Map<string, unknown>;
      }).pendingVoiceByConnection.size
    ).toBe(256);

    socket.serverEmit(
      "studio:presence:update",
      serverParticipant("voice-pending-0", "client-pending-0", "먼저 온 팀원")
    );
    expect(received.filter(({ kind }) => kind === "voice:join")).toEqual([]);
    socket.serverEmit(
      "studio:presence:update",
      serverParticipant("voice-pending-256", "client-pending-256", "마지막 팀원")
    );
    expect(received.filter(({ kind }) => kind === "voice:join")).toEqual([
      expect.objectContaining({
        sender: expect.objectContaining({ sessionId: "voice-pending-256" }),
        payload: { callId: "voice-bounded", muted: false },
      }),
    ]);
    transport.close();
  });

  it("maps session chat between the protocol envelope and the server chat events", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    const received: StudioLiveEnvelope[] = [];
    transport.subscribe((value) => received.push(value as StudioLiveEnvelope));
    await transport.connect();
    activate(transport);
    received.length = 0;

    expect(
      transport.send(
        envelope("chat:message", { messageId: "chat-1", text: "이 장면 톤 어때요?" }, 2)
      )
    ).toBe(true);
    expect(socket.emitted.at(-1)).toEqual({
      event: "studio:chat:send",
      payload: { workId: "work-1", messageId: "chat-1", text: "이 장면 톤 어때요?" },
    });

    socket.serverEmit("studio:chat:message", {
      fromConnectionId: remote.connectionId,
      fromName: remote.name,
      messageId: "chat-2",
      text: "좋아요. 대사만 조금 줄여요.",
      sentAt: new Date(NOW).toISOString(),
    });
    socket.serverEmit("studio:chat:message", {
      fromConnectionId: remote.connectionId,
      fromName: remote.name,
      messageId: "chat-control",
      text: "제어문자\u0007포함",
      sentAt: new Date(NOW).toISOString(),
    });
    socket.serverEmit("studio:chat:message", {
      fromConnectionId: "unknown-connection",
      fromName: "미지의 피어",
      messageId: "chat-unknown",
      text: "무시되어야 합니다",
      sentAt: new Date(NOW).toISOString(),
    });

    expect(received.map((value) => value.kind)).toEqual(["chat:message"]);
    expect(received[0]?.payload).toEqual({
      messageId: "chat-2",
      text: "좋아요. 대사만 조금 줄여요.",
    });
    expect(received[0]?.sender.sessionId).toBe(remote.connectionId);
    expect(received[0]?.targetSessionId).toBeNull();
    transport.close();
  });
});

describe("StudioLiveSocketTransport binary ink lane (V18)", () => {
  function binaryInkTransport(clock?: { value: number }) {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = binaryJoinSuccess();
    socket.ackResponses.set(
      STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT,
      binarySelectionSuccess()
    );
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => (clock ? clock.value : NOW),
    });
    return { socket, transport };
  }

  function inkChunkWire(
    senderSessionId: string,
    workId = "work-1"
  ): StudioLiveInkWireMessage {
    return createStudioLiveInkWireMessage({
      workId,
      senderSessionId,
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
  }

  it("advertises ink-v2 only once the binary wire selection is correlated", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    socket.joinResponse = binaryJoinSuccess();
    socket.holdEvents.add(STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT);
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });

    const connecting = transport.connect();
    // Joined but not yet binary-selected: the lane must not exist and sends fail closed.
    expect(transport.binaryLaneCapabilities).toEqual([]);
    expect(transport.sendInk(inkChunkWire(localParticipant.sessionId))).toBe(false);
    expect(
      socket.emitted.some((record) => record.event === STUDIO_LIVE_INK_SOCKET_EVENT)
    ).toBe(false);

    socket.reply(STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT, binarySelectionSuccess());
    await connecting;
    expect(transport.binaryLaneCapabilities).toContain(STUDIO_LIVE_INK_CAPABILITY);

    transport.close();
    expect(transport.binaryLaneCapabilities).toEqual([]);
  });

  it("fails closed on a legacy-wire connection in both directions", async () => {
    const socket = new FakeSocket({ sessionToken: TOKEN });
    const transport = new StudioLiveSocketTransport(context(), TOKEN, {
      createSocket: () => socket,
      now: () => NOW,
    });
    await transport.connect();
    expect(transport.ready).toBe(true);
    expect(transport.binaryLaneCapabilities).toEqual([]);
    const inkReceived: unknown[] = [];
    transport.subscribeInk((value) => inkReceived.push(value));

    expect(transport.sendInk(inkChunkWire(localParticipant.sessionId))).toBe(false);
    expect(
      socket.emitted.some((record) => record.event === STUDIO_LIVE_INK_SOCKET_EVENT)
    ).toBe(false);
    // A server-relayed frame is dropped — never re-routed to the JSON envelope listeners.
    socket.serverEmit(STUDIO_LIVE_INK_SOCKET_EVENT, inkChunkWire(remote.clientInstanceId));
    expect(inkReceived).toEqual([]);
    transport.close();
  });

  it("round-trips {header JSON, payload ArrayBuffer} frames on the ink event only", async () => {
    const { socket, transport } = binaryInkTransport();
    await transport.connect();
    const envelopes: unknown[] = [];
    const inkReceived: unknown[] = [];
    transport.subscribe((value) => envelopes.push(value));
    transport.subscribeInk((value) => inkReceived.push(value));

    const outbound = inkChunkWire(localParticipant.sessionId);
    expect(transport.sendInk(outbound)).toBe(true);
    const emitted = socket.emitted.filter(
      (record) => record.event === STUDIO_LIVE_INK_SOCKET_EVENT
    );
    expect(emitted).toHaveLength(1);
    // The frame rides the socket untouched: header JSON plus the native ArrayBuffer payload.
    expect(emitted[0]!.payload).toBe(outbound);
    const sentMessage = (emitted[0]!.payload as StudioLiveInkWireMessage).message;
    expect(sentMessage.kind).toBe("ink:chunk");
    expect(
      sentMessage.kind === "ink:chunk" && sentMessage.payload instanceof ArrayBuffer
    ).toBe(true);

    // Cross-work frames are refused before touching the socket.
    expect(transport.sendInk(inkChunkWire(localParticipant.sessionId, "work-2"))).toBe(false);

    const inbound = inkChunkWire(remote.clientInstanceId);
    socket.serverEmit(STUDIO_LIVE_INK_SOCKET_EVENT, inbound);
    expect(inkReceived).toEqual([inbound]);
    const received = inkReceived[0] as StudioLiveInkWireMessage;
    if (received.message.kind !== "ink:chunk") throw new Error("chunk expected");
    const decoded = decodeStudioLiveInkSamples(received.message.payload);
    expect(decoded.samples).toHaveLength(2);
    expect(decoded.samples[0]).toMatchObject({ x: 1, y: 2 });
    // Ink never leaks into the JSON envelope surface.
    expect(envelopes).toEqual([]);
    transport.close();
  });

  it("enforces per-sender inbound packet and byte windows", async () => {
    const clock = { value: NOW };
    const { socket, transport } = binaryInkTransport(clock);
    await transport.connect();
    const inkReceived: unknown[] = [];
    transport.subscribeInk((value) => inkReceived.push(value));

    const cancelFrame = (senderSessionId: string) => ({
      wire: "studio-live-ink",
      wireVersion: 1,
      workId: "work-1",
      senderSessionId,
      sentAt: clock.value,
      message: { kind: "ink:cancel", strokeId: "stroke-1", reason: "user" },
    });
    for (
      let index = 0;
      index < STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_PACKETS + 25;
      index += 1
    ) {
      socket.serverEmit(STUDIO_LIVE_INK_SOCKET_EVENT, cancelFrame("flooding-sender"));
    }
    expect(inkReceived).toHaveLength(STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_PACKETS);

    // The budget is per sender: an independent peer still has its own window.
    socket.serverEmit(STUDIO_LIVE_INK_SOCKET_EVENT, cancelFrame("polite-sender"));
    expect(inkReceived).toHaveLength(STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_PACKETS + 1);

    // The flooding sender recovers after its window elapses.
    clock.value += STUDIO_LIVE_INK_SOCKET_INBOUND_WINDOW_MS;
    socket.serverEmit(STUDIO_LIVE_INK_SOCKET_EVENT, cancelFrame("flooding-sender"));
    expect(inkReceived).toHaveLength(STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_PACKETS + 2);

    // Byte window: the second 3MB payload in one window busts the 4MB per-sender budget.
    const bulkFrame = (payloadBytes: number) => ({
      ...cancelFrame("bulky-sender"),
      message: {
        kind: "ink:chunk",
        strokeId: "stroke-1",
        chunkSequence: 1,
        firstSampleIndex: 0,
        sampleCount: 1,
        payload: new ArrayBuffer(payloadBytes),
      },
    });
    socket.serverEmit(STUDIO_LIVE_INK_SOCKET_EVENT, bulkFrame(3 * 1024 * 1024));
    socket.serverEmit(STUDIO_LIVE_INK_SOCKET_EVENT, bulkFrame(3 * 1024 * 1024));
    expect(inkReceived).toHaveLength(STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_PACKETS + 3);

    // A single frame above the byte budget is refused outright.
    socket.serverEmit(STUDIO_LIVE_INK_SOCKET_EVENT, {
      ...cancelFrame("oversized-sender"),
      message: bulkFrame(STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_BYTES + 1).message,
    });
    expect(inkReceived).toHaveLength(STUDIO_LIVE_INK_SOCKET_INBOUND_MAX_PACKETS + 3);
    transport.close();
  });
});
