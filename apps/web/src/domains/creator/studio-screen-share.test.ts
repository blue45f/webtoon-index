import { describe, expect, it, vi } from "vitest";

import {
  createStudioLiveEnvelope,
  type StudioLiveEnvelope,
  type StudioLiveMessageKind,
  type StudioLiveParticipant,
  type StudioLivePayloadMap,
} from "./live/studio-live-collaboration-protocol";
import {
  STUDIO_SCREEN_SHARE_MAX_VIEWERS,
  StudioScreenShareController,
  studioScreenShareErrorMessage,
  type StudioRemoteScreenShare,
  type StudioScreenShareRoom,
} from "./studio-screen-share";

import type {
  StudioLivePeer,
  StudioLiveRoomEvent,
  StudioLiveSignalEnvelope,
} from "./live/studio-live-collaboration-room";

const local: StudioLiveParticipant = {
  sessionId: "session-local",
  displayName: "내 작업 탭",
  role: "owner",
};
const remote: StudioLiveParticipant = {
  sessionId: "session-remote",
  displayName: "민호 작업 탭",
  role: "editor",
};

class FakeTrack {
  readonly label = "Sensitive Window Title";
  readyState: MediaStreamTrackState = "live";
  stopCalls = 0;
  private readonly listeners = new Set<() => void>();

  constructor(readonly kind: "video" | "audio" = "video") {}

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type !== "ended") return;
    this.listeners.add(
      typeof listener === "function" ? () => listener(new Event("ended")) : () => listener.handleEvent(new Event("ended"))
    );
  }

  removeEventListener(type: string): void {
    if (type === "ended") this.listeners.clear();
  }

  stop(): void {
    this.stopCalls += 1;
    this.readyState = "ended";
  }

  endFromBrowser(): void {
    this.readyState = "ended";
    for (const listener of Array.from(this.listeners)) listener();
  }
}

function fakeStream(tracks: FakeTrack[]): MediaStream {
  return {
    getTracks: () => tracks as unknown as MediaStreamTrack[],
    getVideoTracks: () => tracks.filter((track) => track.kind === "video") as unknown as MediaStreamTrack[],
  } as unknown as MediaStream;
}

class FakePeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  signalingState: RTCSignalingState = "stable";
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  readonly addedTracks: MediaStreamTrack[] = [];
  readonly addedIce: RTCIceCandidateInit[] = [];
  readonly offerOptions: Array<RTCOfferOptions | undefined> = [];
  restartIceCalls = 0;
  closed = false;

  createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit> {
    this.offerOptions.push(options);
    return Promise.resolve({
      type: "offer",
      sdp: `v=0\r\no=host-offer-${this.offerOptions.length}`,
    });
  }

  createAnswer(): Promise<RTCSessionDescriptionInit> {
    return Promise.resolve({ type: "answer", sdp: "v=0\r\no=viewer-answer" });
  }

  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description as RTCSessionDescription;
    this.signalingState = description.type === "offer" ? "have-local-offer" : "stable";
    return Promise.resolve();
  }

  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description as RTCSessionDescription;
    this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
    return Promise.resolve();
  }

  restartIce(): void {
    this.restartIceCalls += 1;
  }

  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.addedIce.push(candidate);
    return Promise.resolve();
  }

  addTrack(track: MediaStreamTrack): RTCRtpSender {
    this.addedTracks.push(track);
    return {} as RTCRtpSender;
  }

  close(): void {
    this.closed = true;
    this.connectionState = "closed";
    this.signalingState = "closed";
  }

  setConnectionState(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }

  emitTrack(stream: MediaStream, track: MediaStreamTrack): void {
    this.ontrack?.({ streams: [stream], track } as unknown as RTCTrackEvent);
  }

  emitIce(candidateValue = "candidate:1 1 UDP 1 127.0.0.1 5000 typ host"): void {
    const candidate = {
      toJSON: () => ({
        candidate: candidateValue,
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: null,
      }),
    } as RTCIceCandidate;
    this.onicecandidate?.({ candidate } as RTCPeerConnectionIceEvent);
  }
}

class FakeRoom implements StudioScreenShareRoom {
  readonly participant = local;
  readonly listeners = new Set<(event: StudioLiveRoomEvent) => void>();
  peers: StudioLivePeer[] = [];
  screenShares: StudioRemoteScreenShare[] = [];
  readonly announcements: Array<{ shareId: string; label: string }> = [];
  readonly requests: Array<{ target: string; shareId: string }> = [];
  readonly descriptions: Array<{
    target: string;
    shareId: string;
    type: "offer" | "answer";
    sdp: string;
  }> = [];
  readonly candidates: Array<{ target: string; shareId: string; candidate: string }> = [];
  readonly accesses: Array<{
    target: string;
    shareId: string;
    decision: "approved" | "rejected" | "ended";
  }> = [];
  readonly stops: string[] = [];
  sendResult = true;

  getPeers(): StudioLivePeer[] {
    return this.peers.map((peer) => ({ ...peer }));
  }

  getScreenShares(): StudioRemoteScreenShare[] {
    return this.screenShares.map((share) => ({
      ...share,
      host: { ...share.host },
    }));
  }

  subscribe(listener: (event: StudioLiveRoomEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  announceScreen(payload: { shareId: string; label: string }) {
    this.announcements.push(payload);
    return this.sendResult;
  }

  requestScreen(targetSessionId: string, payload: { shareId: string }) {
    this.requests.push({ target: targetSessionId, shareId: payload.shareId });
    return this.sendResult;
  }

  respondScreen(
    targetSessionId: string,
    payload: { shareId: string; decision: "approved" | "rejected" | "ended" }
  ) {
    this.accesses.push({ target: targetSessionId, ...payload });
    return this.sendResult;
  }

  sendWebRtcDescription(
    targetSessionId: string,
    payload: { shareId: string; type: "offer" | "answer"; sdp: string }
  ) {
    this.descriptions.push({ target: targetSessionId, ...payload });
    return this.sendResult;
  }

  sendWebRtcIce(
    targetSessionId: string,
    payload: { shareId: string; candidate: string }
  ) {
    this.candidates.push({ target: targetSessionId, shareId: payload.shareId, candidate: payload.candidate });
    return this.sendResult;
  }

  stopScreen(payload: { shareId: string }) {
    this.stops.push(payload.shareId);
    return this.sendResult;
  }

  emit(event: StudioLiveRoomEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function signal<K extends Extract<StudioLiveMessageKind, `screen:${string}` | `webrtc:${string}`>>(
  kind: K,
  payload: StudioLivePayloadMap[K],
  targetSessionId: string | null
): StudioLiveEnvelope<K> {
  return signalFrom(remote, kind, payload, targetSessionId);
}

function signalFrom<
  K extends Extract<StudioLiveMessageKind, `screen:${string}` | `webrtc:${string}`>,
>(
  sender: StudioLiveParticipant,
  kind: K,
  payload: StudioLivePayloadMap[K],
  targetSessionId: string | null
): StudioLiveEnvelope<K> {
  return createStudioLiveEnvelope({
    workId: "work-1",
    sender,
    sentAt: 1_000_000,
    sequence: 1,
    kind,
    targetSessionId,
    payload,
  });
}

function emitSignal(room: FakeRoom, envelope: StudioLiveSignalEnvelope) {
  room.emit({ type: "signal", envelope });
}

describe("StudioScreenShareController", () => {
  it("hydrates cached room shares immediately without starting capture or access", () => {
    const room = new FakeRoom();
    room.peers = [
      {
        ...remote,
        visibility: "active",
        pageId: "page-1",
        lastSeenAt: 1,
      },
    ];
    room.screenShares = [
      { host: remote, shareId: "share-cached", label: "콘티 화면" },
    ];
    const getDisplayMedia = vi.fn<() => Promise<MediaStream>>();

    const controller = new StudioScreenShareController(room, { getDisplayMedia });

    expect(controller.getState()).toMatchObject({
      localSharing: false,
      shares: [
        { host: remote, shareId: "share-cached", label: "콘티 화면" },
      ],
      watching: null,
      pendingRequests: [],
      viewers: [],
    });
    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(room.requests).toEqual([
      expect.objectContaining({
        target: remote.sessionId,
        shareId: expect.stringContaining("discovery"),
      }),
    ]);
    expect(room.requests.some((request) => request.shareId === "share-cached")).toBe(false);
    controller.close();
  });

  it("discovers shares that began before a viewer opened the team panel", async () => {
    const lateViewerRoom = new FakeRoom();
    lateViewerRoom.peers = [
      {
        ...remote,
        visibility: "active",
        pageId: "page-1",
        lastSeenAt: 1,
      },
    ];

    const lateViewerController = new StudioScreenShareController(lateViewerRoom);
    expect(lateViewerRoom.requests).toEqual([
      expect.objectContaining({
        target: remote.sessionId,
        shareId: expect.stringContaining("discovery"),
      }),
    ]);
    const discoveryId = lateViewerRoom.requests[0].shareId;

    const hostRoom = new FakeRoom();
    const hostController = new StudioScreenShareController(hostRoom, {
      getDisplayMedia: () => Promise.resolve(fakeStream([new FakeTrack()])),
      randomId: () => "share-already-running",
    });
    await hostController.startShare();
    emitSignal(
      hostRoom,
      signal("screen:request", { shareId: discoveryId }, local.sessionId)
    );

    expect(hostRoom.announcements).toEqual([
      { shareId: "share-already-running", label: "작업 화면" },
      { shareId: "share-already-running", label: "작업 화면" },
    ]);
    expect(hostController.getState().pendingRequests).toEqual([]);

    lateViewerController.close();
    hostController.close();
  });

  it("starts capture only through an explicit call, excludes audio and hides native source labels", async () => {
    const room = new FakeRoom();
    const track = new FakeTrack();
    const stream = fakeStream([track]);
    const getDisplayMedia = vi.fn(() => Promise.resolve(stream));
    const controller = new StudioScreenShareController(room, {
      getDisplayMedia,
      randomId: () => "share-1",
    });

    expect(getDisplayMedia).not.toHaveBeenCalled();
    await controller.startShare();

    expect(getDisplayMedia).toHaveBeenCalledWith({
      video: { frameRate: { ideal: 15, max: 30 } },
      audio: false,
    });
    expect(room.announcements).toEqual([{ shareId: "share-1", label: "작업 화면" }]);
    expect(JSON.stringify(room.announcements)).not.toContain(track.label);
    expect(controller.getState().localSharing).toBe(true);

    controller.close();
    expect(room.stops).toEqual(["share-1"]);
    expect(track.stopCalls).toBe(1);
  });

  it("stops every local track when the browser's native share control ends capture", async () => {
    const room = new FakeRoom();
    const track = new FakeTrack();
    const controller = new StudioScreenShareController(room, {
      getDisplayMedia: () => Promise.resolve(fakeStream([track])),
      randomId: () => "share-1",
    });
    await controller.startShare();

    track.endFromBrowser();
    expect(controller.getState().localSharing).toBe(false);
    expect(room.stops).toEqual(["share-1"]);
    expect(track.stopCalls).toBe(1);
    controller.close();
  });

  it("deduplicates concurrent capture calls and stops every late track after close", async () => {
    const room = new FakeRoom();
    const videoTrack = new FakeTrack();
    const audioTrack = new FakeTrack("audio");
    let resolveCapture!: (stream: MediaStream) => void;
    const getDisplayMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveCapture = resolve;
        })
    );
    const controller = new StudioScreenShareController(room, { getDisplayMedia });

    const first = controller.startShare();
    const second = controller.startShare();
    expect(first).toBe(second);
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);

    controller.close();
    resolveCapture(fakeStream([videoTrack, audioTrack]));
    await expect(first).rejects.toThrow("종료");
    await expect(second).rejects.toThrow("종료");
    expect(videoTrack.stopCalls).toBe(1);
    expect(audioTrack.stopCalls).toBe(1);
    expect(room.announcements).toEqual([]);
  });

  it("does not create or answer a peer for an unsolicited offer", async () => {
    const room = new FakeRoom();
    const createPeerConnection = vi.fn(() => new FakePeerConnection() as unknown as RTCPeerConnection);
    const controller = new StudioScreenShareController(room, { createPeerConnection });

    emitSignal(
      room,
      signal(
        "webrtc:description",
        { shareId: "share-1", type: "offer", sdp: "v=0" },
        local.sessionId
      )
    );
    await vi.waitFor(() => expect(createPeerConnection).not.toHaveBeenCalled());
    expect(room.descriptions).toEqual([]);
    controller.close();
  });

  it("requires explicit watch consent, answers only the selected host and exposes the remote stream", async () => {
    const room = new FakeRoom();
    const peer = new FakePeerConnection();
    const remoteTrack = new FakeTrack();
    const remoteStream = fakeStream([remoteTrack]);
    const controller = new StudioScreenShareController(room, {
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
    });
    emitSignal(
      room,
      signal("screen:announce", { shareId: "share-1", label: "작업 화면" }, null)
    );

    controller.watchShare(remote.sessionId, "share-1");
    expect(room.requests).toEqual([{ target: remote.sessionId, shareId: "share-1" }]);
    expect(controller.getState().watching?.status).toBe("requesting");

    emitSignal(
      room,
      signal(
        "webrtc:description",
        { shareId: "share-1", type: "offer", sdp: "v=0\r\no=offer" },
        local.sessionId
      )
    );
    await vi.waitFor(() => expect(room.descriptions).toHaveLength(1));
    expect(room.descriptions[0]).toEqual(
      expect.objectContaining({
        target: remote.sessionId,
        shareId: "share-1",
        type: "answer",
      })
    );
    expect(peer.remoteDescription?.type).toBe("offer");

    peer.emitTrack(remoteStream, remoteTrack as unknown as MediaStreamTrack);
    expect(controller.getState().watching).toEqual(
      expect.objectContaining({ status: "live", stream: remoteStream })
    );

    emitSignal(room, signal("screen:stop", { shareId: "share-1" }, null));
    expect(controller.getState().watching).toBeNull();
    expect(peer.closed).toBe(true);
    expect(remoteTrack.stopCalls).toBe(1);
    controller.close();
  });

  it("answers a refreshed host offer on the existing viewer peer without interrupting playback", async () => {
    const room = new FakeRoom();
    const peer = new FakePeerConnection();
    const createPeerConnection = vi.fn(() => peer as unknown as RTCPeerConnection);
    const remoteTrack = new FakeTrack();
    const remoteStream = fakeStream([remoteTrack]);
    const controller = new StudioScreenShareController(room, { createPeerConnection });
    emitSignal(
      room,
      signal("screen:announce", { shareId: "share-1", label: "작업 화면" }, null)
    );
    controller.watchShare(remote.sessionId, "share-1");

    emitSignal(
      room,
      signal(
        "webrtc:description",
        { shareId: "share-1", type: "offer", sdp: "v=0\r\no=initial-offer" },
        local.sessionId
      )
    );
    await vi.waitFor(() => expect(room.descriptions).toHaveLength(1));
    peer.emitTrack(remoteStream, remoteTrack as unknown as MediaStreamTrack);
    expect(controller.getState().watching).toEqual(
      expect.objectContaining({ status: "live", stream: remoteStream })
    );

    emitSignal(
      room,
      signal(
        "webrtc:description",
        { shareId: "share-1", type: "offer", sdp: "v=0\r\no=ice-restart-offer" },
        local.sessionId
      )
    );

    await vi.waitFor(() => expect(room.descriptions).toHaveLength(2));
    expect(createPeerConnection).toHaveBeenCalledTimes(1);
    expect(peer.closed).toBe(false);
    expect(remoteTrack.stopCalls).toBe(0);
    expect(controller.getState().watching).toEqual(
      expect.objectContaining({ status: "live", stream: remoteStream })
    );
    controller.close();
  });

  it("ends a pending watch cleanly when the host rejects it", () => {
    const room = new FakeRoom();
    const errors: string[] = [];
    const controller = new StudioScreenShareController(room);
    controller.subscribe((event) => {
      if (event.type === "error") errors.push(event.message);
    });
    emitSignal(
      room,
      signal("screen:announce", { shareId: "share-1", label: "작업 화면" }, null)
    );
    controller.watchShare(remote.sessionId, "share-1");

    emitSignal(
      room,
      signal(
        "screen:access",
        { shareId: "share-1", decision: "rejected" },
        local.sessionId
      )
    );
    expect(controller.getState().watching).toBeNull();
    expect(errors).toEqual([expect.stringContaining("거절")]);
    controller.close();
  });

  it("sends one targeted ended signal when a viewer cancels a pending watch", () => {
    const room = new FakeRoom();
    const controller = new StudioScreenShareController(room);
    emitSignal(
      room,
      signal("screen:announce", { shareId: "share-1", label: "작업 화면" }, null)
    );
    controller.watchShare(remote.sessionId, "share-1");

    controller.stopWatching();
    controller.stopWatching();

    expect(controller.getState().watching).toBeNull();
    expect(room.accesses).toEqual([
      { target: remote.sessionId, shareId: "share-1", decision: "ended" },
    ]);
    controller.close();
  });

  it("immediately and idempotently removes a cancelled host request or viewer slot", async () => {
    const room = new FakeRoom();
    const track = new FakeTrack();
    const peer = new FakePeerConnection();
    const controller = new StudioScreenShareController(room, {
      getDisplayMedia: () => Promise.resolve(fakeStream([track])),
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
      randomId: () => "share-1",
    });
    await controller.startShare();

    emitSignal(room, signal("screen:request", { shareId: "share-1" }, local.sessionId));
    expect(controller.getState().pendingRequests).toHaveLength(1);
    const ended = signal(
      "screen:access",
      { shareId: "share-1", decision: "ended" },
      local.sessionId
    );
    emitSignal(room, ended);
    emitSignal(room, ended);
    expect(controller.getState().pendingRequests).toEqual([]);

    emitSignal(room, signal("screen:request", { shareId: "share-1" }, local.sessionId));
    await controller.approveScreenRequest(remote.sessionId, "share-1");
    expect(controller.getState().viewers).toHaveLength(1);
    emitSignal(room, ended);
    emitSignal(room, ended);

    expect(peer.closed).toBe(true);
    expect(controller.getState().viewers).toEqual([]);
    controller.close();
  });

  it("queues viewer ICE that arrives before the approved host offer", async () => {
    const room = new FakeRoom();
    const peer = new FakePeerConnection();
    const controller = new StudioScreenShareController(room, {
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
    });
    emitSignal(
      room,
      signal("screen:announce", { shareId: "share-1", label: "작업 화면" }, null)
    );
    controller.watchShare(remote.sessionId, "share-1");

    emitSignal(
      room,
      signal(
        "webrtc:ice",
        {
          shareId: "share-1",
          candidate: "candidate:early",
          sdpMid: "0",
          sdpMLineIndex: 0,
          usernameFragment: null,
        },
        local.sessionId
      )
    );
    expect(peer.addedIce).toEqual([]);

    emitSignal(
      room,
      signal(
        "webrtc:description",
        { shareId: "share-1", type: "offer", sdp: "v=0\r\no=offer" },
        local.sessionId
      )
    );
    await vi.waitFor(() => expect(peer.addedIce).toEqual([expect.objectContaining({ candidate: "candidate:early" })]));
    controller.close();
  });

  it("lets the host reject without creating a peer and re-announces to a late peer", async () => {
    const room = new FakeRoom();
    const track = new FakeTrack();
    const createPeerConnection = vi.fn(() => new FakePeerConnection() as unknown as RTCPeerConnection);
    const controller = new StudioScreenShareController(room, {
      getDisplayMedia: () => Promise.resolve(fakeStream([track])),
      createPeerConnection,
      randomId: () => "share-1",
    });
    await controller.startShare();

    room.emit({
      type: "presence",
      peers: [{ ...remote, visibility: "active", pageId: null, lastSeenAt: 1_000_000 }],
    });
    expect(room.announcements).toHaveLength(2);

    emitSignal(room, signal("screen:request", { shareId: "share-1" }, local.sessionId));
    expect(controller.rejectScreenRequest(remote.sessionId, "share-1")).toBe(true);
    expect(room.accesses.at(-1)).toEqual({
      target: remote.sessionId,
      shareId: "share-1",
      decision: "rejected",
    });
    expect(createPeerConnection).not.toHaveBeenCalled();
    expect(controller.getState().pendingRequests).toEqual([]);
    controller.close();
  });

  it("re-announces the same active share after server reconnect without recapturing or opening a peer", async () => {
    const room = new FakeRoom();
    const track = new FakeTrack();
    const stream = fakeStream([track]);
    const getDisplayMedia = vi.fn(() => Promise.resolve(stream));
    const createPeerConnection = vi.fn(
      () => new FakePeerConnection() as unknown as RTCPeerConnection
    );
    const errors: string[] = [];
    const controller = new StudioScreenShareController(room, {
      getDisplayMedia,
      createPeerConnection,
      randomId: () => "share-reconnect",
    });
    controller.subscribe((event) => {
      if (event.type === "error") errors.push(event.message);
    });

    room.emit({
      type: "transport-status",
      status: { state: "ready", message: "초기 팀 연결", recoverable: true },
    });
    expect(room.announcements).toEqual([]);
    room.emit({
      type: "presence",
      peers: [{ ...remote, visibility: "active", pageId: null, lastSeenAt: 1_000_000 }],
    });
    await controller.startShare();
    expect(room.announcements).toEqual([
      { shareId: "share-reconnect", label: "작업 화면" },
    ]);

    room.emit({
      type: "transport-status",
      status: { state: "disconnected", message: "재연결 중", recoverable: true },
    });
    room.emit({
      type: "transport-status",
      status: { state: "ready", message: "팀 서버 재연결", recoverable: true },
    });

    await vi.waitFor(() =>
      expect(room.announcements).toEqual([
        { shareId: "share-reconnect", label: "작업 화면" },
        { shareId: "share-reconnect", label: "작업 화면" },
      ])
    );
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(createPeerConnection).not.toHaveBeenCalled();
    expect(controller.getState().localSharing).toBe(true);
    expect(track.stopCalls).toBe(0);

    room.sendResult = false;
    room.emit({
      type: "transport-status",
      status: { state: "ready", message: "팀 서버 재연결", recoverable: true },
    });
    await vi.waitFor(() =>
      expect(errors).toEqual([expect.stringContaining("다시 알리지 못했습니다")])
    );
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(createPeerConnection).not.toHaveBeenCalled();
    expect(controller.getState().localSharing).toBe(true);

    controller.close();
    expect(track.stopCalls).toBe(1);
  });

  it("drops a queued reconnect announcement when that share stops before dispatch completes", async () => {
    const room = new FakeRoom();
    const track = new FakeTrack();
    const controller = new StudioScreenShareController(room, {
      getDisplayMedia: () => Promise.resolve(fakeStream([track])),
      createPeerConnection: () => new FakePeerConnection() as unknown as RTCPeerConnection,
      randomId: () => "share-stopped-before-reannounce",
    });

    await controller.startShare();
    room.emit({
      type: "transport-status",
      status: { state: "ready", message: "팀 서버 재연결", recoverable: true },
    });
    controller.stopShare();
    await Promise.resolve();

    expect(room.announcements).toEqual([
      { shareId: "share-stopped-before-reannounce", label: "작업 화면" },
    ]);
    expect(controller.getState().localSharing).toBe(false);
    expect(track.stopCalls).toBe(1);
    controller.close();
  });

  it("waits for an individual host approval before creating tracks or an offer", async () => {
    const room = new FakeRoom();
    const track = new FakeTrack();
    const unexpectedAudioTrack = new FakeTrack("audio");
    const peer = new FakePeerConnection();
    const createPeerConnection = vi.fn(() => peer as unknown as RTCPeerConnection);
    const controller = new StudioScreenShareController(room, {
      getDisplayMedia: () => Promise.resolve(fakeStream([track, unexpectedAudioTrack])),
      createPeerConnection,
      randomId: () => "share-1",
    });
    await controller.startShare();
    expect(unexpectedAudioTrack.stopCalls).toBe(1);

    emitSignal(room, signal("screen:request", { shareId: "share-1" }, local.sessionId));
    expect(controller.getState().pendingRequests).toEqual([
      expect.objectContaining({ viewer: remote, shareId: "share-1" }),
    ]);
    expect(createPeerConnection).not.toHaveBeenCalled();
    expect(peer.addedTracks).toEqual([]);
    expect(room.descriptions).toEqual([]);

    await controller.approveScreenRequest(remote.sessionId, "share-1");
    await vi.waitFor(() => expect(room.descriptions).toHaveLength(1));
    expect(room.accesses[0]).toEqual({
      target: remote.sessionId,
      shareId: "share-1",
      decision: "approved",
    });
    expect(peer.addedTracks).toEqual([track]);
    expect(room.descriptions[0]).toEqual(
      expect.objectContaining({ target: remote.sessionId, type: "offer", shareId: "share-1" })
    );

    emitSignal(
      room,
      signal(
        "webrtc:ice",
        {
          shareId: "share-1",
          candidate: "candidate:remote",
          sdpMid: "0",
          sdpMLineIndex: 0,
          usernameFragment: null,
        },
        local.sessionId
      )
    );
    expect(peer.addedIce).toEqual([]);
    emitSignal(
      room,
      signal(
        "webrtc:description",
        { shareId: "share-1", type: "answer", sdp: "v=0\r\no=answer" },
        local.sessionId
      )
    );
    await vi.waitFor(() => expect(peer.addedIce).toHaveLength(1));
    expect(peer.remoteDescription?.type).toBe("answer");
    expect(controller.getState().viewers[0]?.status).toBe("connecting");
    peer.setConnectionState("connected");
    expect(controller.getState().viewers).toEqual([
      expect.objectContaining({ viewer: remote, shareId: "share-1", status: "live" }),
    ]);

    peer.emitIce();
    expect(room.candidates[0]).toEqual(
      expect.objectContaining({ target: remote.sessionId, shareId: "share-1" })
    );
    expect(controller.stopViewer(remote.sessionId, "share-1")).toBe(true);
    expect(room.accesses.at(-1)).toEqual({
      target: remote.sessionId,
      shareId: "share-1",
      decision: "ended",
    });
    expect(controller.getState().viewers).toEqual([]);
    expect(peer.closed).toBe(true);
    controller.close();
  });

  it("coalesces ICE policy refreshes and restarts the existing host peer after signaling stabilizes", async () => {
    const room = new FakeRoom();
    const track = new FakeTrack();
    const peer = new FakePeerConnection();
    const createPeerConnection = vi.fn(() => peer as unknown as RTCPeerConnection);
    const controller = new StudioScreenShareController(room, {
      getDisplayMedia: () => Promise.resolve(fakeStream([track])),
      createPeerConnection,
      randomId: () => "share-1",
    });
    await controller.startShare();
    emitSignal(room, signal("screen:request", { shareId: "share-1" }, local.sessionId));
    await controller.approveScreenRequest(remote.sessionId, "share-1");
    expect(room.descriptions).toHaveLength(1);
    expect(peer.signalingState).toBe("have-local-offer");

    expect(controller.refreshNetworkPolicy()).toBe(true);
    expect(controller.refreshNetworkPolicy()).toBe(true);
    await Promise.resolve();
    expect(peer.restartIceCalls).toBe(0);
    expect(room.descriptions).toHaveLength(1);

    emitSignal(
      room,
      signal(
        "webrtc:description",
        { shareId: "share-1", type: "answer", sdp: "v=0\r\no=initial-answer" },
        local.sessionId
      )
    );

    await vi.waitFor(() => expect(room.descriptions).toHaveLength(2));
    expect(createPeerConnection).toHaveBeenCalledTimes(1);
    expect(peer.restartIceCalls).toBe(1);
    expect(peer.offerOptions).toEqual([undefined, { iceRestart: true }]);
    expect(room.descriptions[1]).toEqual(
      expect.objectContaining({
        target: remote.sessionId,
        shareId: "share-1",
        type: "offer",
        sdp: "v=0\r\no=host-offer-2",
      })
    );
    expect(track.stopCalls).toBe(0);
    controller.close();
  });

  it("enforces the host peer cap before creating another RTCPeerConnection", async () => {
    const room = new FakeRoom();
    const track = new FakeTrack();
    const createPeerConnection = vi.fn(
      () => new FakePeerConnection() as unknown as RTCPeerConnection
    );
    const controller = new StudioScreenShareController(room, {
      getDisplayMedia: () => Promise.resolve(fakeStream([track])),
      createPeerConnection,
      randomId: () => "share-1",
    });
    await controller.startShare();

    const viewers = Array.from({ length: STUDIO_SCREEN_SHARE_MAX_VIEWERS + 1 }, (_, index) => ({
      sessionId: `viewer-${index}`,
      displayName: `시청자 ${index}`,
      role: "viewer" as const,
    }));
    for (const viewer of viewers) {
      emitSignal(
        room,
        signalFrom(
          viewer,
          "screen:request",
          { shareId: "share-1" },
          local.sessionId
        )
      );
    }
    for (const viewer of viewers.slice(0, STUDIO_SCREEN_SHARE_MAX_VIEWERS)) {
      await controller.approveScreenRequest(viewer.sessionId, "share-1");
    }

    await expect(
      controller.approveScreenRequest(viewers.at(-1)!.sessionId, "share-1")
    ).rejects.toThrow(`최대 ${STUDIO_SCREEN_SHARE_MAX_VIEWERS}명`);
    expect(createPeerConnection).toHaveBeenCalledTimes(STUDIO_SCREEN_SHARE_MAX_VIEWERS);
    expect(room.accesses.at(-1)?.decision).toBe("rejected");
    controller.close();
  });

  it("closes an approved viewer when more than 32 ICE candidates wait for its answer", async () => {
    const room = new FakeRoom();
    const track = new FakeTrack();
    const peer = new FakePeerConnection();
    const errors: string[] = [];
    const controller = new StudioScreenShareController(room, {
      getDisplayMedia: () => Promise.resolve(fakeStream([track])),
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
      randomId: () => "share-1",
    });
    controller.subscribe((event) => {
      if (event.type === "error") errors.push(event.message);
    });
    await controller.startShare();
    emitSignal(room, signal("screen:request", { shareId: "share-1" }, local.sessionId));
    await controller.approveScreenRequest(remote.sessionId, "share-1");

    for (let index = 0; index < 33; index += 1) {
      emitSignal(
        room,
        signal(
          "webrtc:ice",
          {
            shareId: "share-1",
            candidate: `candidate:queued-${index}`,
            sdpMid: "0",
            sdpMLineIndex: 0,
            usernameFragment: null,
          },
          local.sessionId
        )
      );
    }

    await vi.waitFor(() => expect(errors).toEqual([expect.stringContaining("너무 많이 대기")]));
    expect(peer.closed).toBe(true);
    expect(controller.getState().viewers).toEqual([]);
    expect(room.accesses.at(-1)).toEqual({
      target: remote.sessionId,
      shareId: "share-1",
      decision: "ended",
    });
    controller.close();
  });

  it("cancels a pending watch when pre-offer ICE exceeds the same hard cap", async () => {
    const room = new FakeRoom();
    const errors: string[] = [];
    const controller = new StudioScreenShareController(room);
    controller.subscribe((event) => {
      if (event.type === "error") errors.push(event.message);
    });
    emitSignal(
      room,
      signal("screen:announce", { shareId: "share-1", label: "작업 화면" }, null)
    );
    controller.watchShare(remote.sessionId, "share-1");

    for (let index = 0; index < 33; index += 1) {
      emitSignal(
        room,
        signal(
          "webrtc:ice",
          {
            shareId: "share-1",
            candidate: `candidate:early-${index}`,
            sdpMid: "0",
            sdpMLineIndex: 0,
            usernameFragment: null,
          },
          local.sessionId
        )
      );
    }

    await vi.waitFor(() => expect(errors).toEqual([expect.stringContaining("너무 많이 대기")]));
    expect(controller.getState().watching).toBeNull();
    expect(room.accesses.at(-1)).toEqual({
      target: remote.sessionId,
      shareId: "share-1",
      decision: "ended",
    });
    controller.close();
  });

  it("closes host-side viewer peers as soon as their room presence expires", async () => {
    const room = new FakeRoom();
    const track = new FakeTrack();
    const peer = new FakePeerConnection();
    const controller = new StudioScreenShareController(room, {
      getDisplayMedia: () => Promise.resolve(fakeStream([track])),
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
      randomId: () => "share-1",
    });
    await controller.startShare();
    emitSignal(room, signal("screen:request", { shareId: "share-1" }, local.sessionId));
    await controller.approveScreenRequest(remote.sessionId, "share-1");
    expect(controller.getState().viewers).toHaveLength(1);

    room.emit({ type: "presence", peers: [] });
    expect(peer.closed).toBe(true);
    expect(controller.getState().viewers).toEqual([]);
    controller.close();
  });

  it("removes unavailable shares and closes an active viewer peer when presence expires", async () => {
    const room = new FakeRoom();
    const peer = new FakePeerConnection();
    const controller = new StudioScreenShareController(room, {
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
    });
    emitSignal(
      room,
      signal("screen:announce", { shareId: "share-1", label: "작업 화면" }, null)
    );
    controller.watchShare(remote.sessionId, "share-1");
    emitSignal(
      room,
      signal(
        "webrtc:description",
        { shareId: "share-1", type: "offer", sdp: "v=0" },
        local.sessionId
      )
    );
    await vi.waitFor(() => expect(room.descriptions).toHaveLength(1));

    room.emit({ type: "presence", peers: [] });
    expect(controller.getState()).toEqual({
      localSharing: false,
      shares: [],
      watching: null,
      pendingRequests: [],
      viewers: [],
    });
    expect(peer.closed).toBe(true);
    controller.close();
  });

  it("maps browser capture failures to actionable Korean guidance", () => {
    expect(studioScreenShareErrorMessage(new DOMException("denied", "NotAllowedError"))).toContain(
      "권한"
    );
    expect(studioScreenShareErrorMessage(new DOMException("cancelled", "AbortError"))).toContain(
      "취소"
    );
    expect(studioScreenShareErrorMessage(new DOMException("missing", "NotFoundError"))).toContain(
      "찾지 못"
    );
    expect(studioScreenShareErrorMessage(new DOMException("activation", "InvalidStateError"))).toContain(
      "직접 눌러"
    );
    expect(studioScreenShareErrorMessage(new DOMException("os", "NotReadableError"))).toContain(
      "화면 기록 권한"
    );
  });
});
