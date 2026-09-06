import { describe, expect, it, vi } from "vitest";

import { STUDIO_LIVE_GESTURE_PREVIEW_VERSION } from "./studio-live-gesture-preview";
import {
  StudioLiveGesturePreviewRoomAdapter,
  type StudioLiveGesturePreviewRoomSource,
} from "./studio-live-gesture-preview-room-adapter";
import {
  StudioLiveGesturePreviewStore,
  type StudioLiveGesturePreviewStoreScheduler,
} from "./studio-live-gesture-preview-store";

import type { StudioLiveParticipant } from "./studio-live-collaboration-protocol";
import type {
  StudioLivePeer,
  StudioLiveRoomEvent,
} from "./studio-live-collaboration-room";
import type {
  StudioLiveGesturePreviewPayload,
  StudioLiveGesturePreviewSamples,
} from "./studio-live-gesture-preview";

function participant(sessionId: string): StudioLiveParticipant {
  return { sessionId, displayName: sessionId, role: "editor" };
}

function peer(sessionId: string): StudioLivePeer {
  return {
    ...participant(sessionId),
    visibility: "active",
    pageId: "page-a",
    lastSeenAt: 1,
  };
}

function samples(
  startIndex: number,
  points: readonly number[],
): StudioLiveGesturePreviewSamples {
  const count = points.length / 2;
  return {
    startIndex,
    points,
    pressures: Array<number>(count).fill(0.5),
    sampleTimeOffsets: Array.from(
      { length: count },
      (_, index) => (startIndex + index) * 8,
    ),
  };
}

function begin(
  gestureId: string,
  pageId = "page-a",
): StudioLiveGesturePreviewPayload {
  return {
    version: STUDIO_LIVE_GESTURE_PREVIEW_VERSION,
    gestureId,
    pageId,
    seq: 1,
    phase: "begin",
    operation: "draw",
    base: { documentGeneration: 1 },
    renderer: {
      kind: "freehand",
      mode: "pen",
      stroke: "#111111",
      strokeWidth: 4,
    },
    samples: samples(0, [0, 0, 10, 10]),
  };
}

function append(gestureId: string, seq = 2): StudioLiveGesturePreviewPayload {
  return {
    version: STUDIO_LIVE_GESTURE_PREVIEW_VERSION,
    gestureId,
    pageId: "page-a",
    seq,
    phase: "append",
    operation: "draw",
    samples: samples(2, [20, 20]),
  };
}

function terminal(
  gestureId: string,
  seq: number,
  phase: "end" | "cancel",
): StudioLiveGesturePreviewPayload {
  return {
    version: STUDIO_LIVE_GESTURE_PREVIEW_VERSION,
    gestureId,
    pageId: "page-a",
    seq,
    phase,
    operation: "draw",
  };
}

class FakeRoom implements StudioLiveGesturePreviewRoomSource {
  private readonly listeners = new Set<(event: StudioLiveRoomEvent) => void>();

  constructor(private peers: StudioLivePeer[]) {}

  subscribe(listener: (event: StudioLiveRoomEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getPeers(): StudioLivePeer[] {
    return [...this.peers];
  }

  emit(event: StudioLiveRoomEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  emitPreview(senderSessionId: string, payload: StudioLiveGesturePreviewPayload): void {
    this.emit({
      type: "gesture-preview",
      participant: participant(senderSessionId),
      payload,
    });
  }

  setPeers(peers: StudioLivePeer[]): void {
    this.peers = peers;
    this.emit({ type: "presence", peers: [...peers] });
  }
}

describe("StudioLiveGesturePreviewRoomAdapter", () => {
  it("keeps construction side-effect free and leases the prune timer to subscribers", () => {
    const intervals = new Set<object>();
    const scheduler: StudioLiveGesturePreviewStoreScheduler = {
      now: () => 1,
      setInterval: () => {
        const handle = {};
        intervals.add(handle);
        return handle;
      },
      clearInterval: (handle) => {
        intervals.delete(handle as object);
      },
    };
    const store = new StudioLiveGesturePreviewStore({ scheduler });
    const adapter = new StudioLiveGesturePreviewRoomAdapter({ store });

    // React StrictMode may discard a state initializer result before effects subscribe to it.
    expect(intervals.size).toBe(0);
    const firstUnsubscribe = adapter.subscribe(() => undefined);
    const secondUnsubscribe = adapter.subscribe(() => undefined);
    expect(intervals.size).toBe(1);
    firstUnsubscribe();
    expect(intervals.size).toBe(1);
    secondUnsubscribe();
    expect(intervals.size).toBe(0);

    const replayUnsubscribe = adapter.subscribe(() => undefined);
    expect(intervals.size).toBe(1);
    replayUnsubscribe();
    adapter.dispose();
    expect(intervals.size).toBe(0);
  });

  it("rotates rooms atomically and ignores events from the detached room", () => {
    const firstRoom = new FakeRoom([peer("sender-a")]);
    const secondRoom = new FakeRoom([peer("sender-b")]);
    const adapter = new StudioLiveGesturePreviewRoomAdapter({ pageId: "page-a" });

    adapter.setRoom(firstRoom);
    firstRoom.emitPreview("sender-a", begin("gesture-a"));
    expect(adapter.getSnapshot().map((entry) => entry.gestureId)).toEqual(["gesture-a"]);

    adapter.setRoom(secondRoom);
    expect(adapter.getSnapshot()).toEqual([]);
    expect(adapter.getEligiblePreviewKeys()).toEqual([]);

    firstRoom.emitPreview("sender-a", begin("detached"));
    expect(adapter.getSnapshot()).toEqual([]);

    secondRoom.emitPreview("sender-b", begin("gesture-b"));
    expect(adapter.getSnapshot().map((entry) => entry.gestureId)).toEqual(["gesture-b"]);
    adapter.dispose();
  });

  it("drops an existing authoritative id and rejects stale-page authoritative snapshots", () => {
    const room = new FakeRoom([peer("sender-a")]);
    const adapter = new StudioLiveGesturePreviewRoomAdapter({ pageId: "page-a" });
    adapter.setRoom(room);

    expect(adapter.setAuthoritativeElementIds("page-b", ["existing"])).toBe(false);
    expect(adapter.setAuthoritativeElementIds("page-a", ["existing"])).toBe(true);
    room.emitPreview("sender-a", begin("existing"));
    expect(adapter.getSnapshot()).toEqual([]);
    expect(adapter.markAuthoritativeProjection("page-a", "existing")).toBe(false);

    adapter.setAuthoritativeElementIds("page-a", []);
    room.emitPreview("sender-a", begin("new-id"));
    expect(adapter.getSnapshot()).toHaveLength(1);
    adapter.dispose();
  });

  it("pins one owner per gesture id and accepts suffixes only for the exact pinned key", () => {
    const room = new FakeRoom([peer("sender-a"), peer("sender-b")]);
    const adapter = new StudioLiveGesturePreviewRoomAdapter({ pageId: "page-a" });
    adapter.setRoom(room);

    room.emitPreview("sender-b", append("suffix-without-begin"));
    expect(adapter.getSnapshot()).toEqual([]);

    room.emitPreview("sender-a", begin("shared-id"));
    const ownerKey = adapter.getEligiblePreviewKeys()[0];
    room.emitPreview("sender-b", begin("shared-id"));
    room.emitPreview("sender-b", append("shared-id"));
    expect(adapter.getEligiblePreviewKeys()).toEqual([ownerKey]);
    expect(adapter.getSnapshot()[0]).toMatchObject({
      senderSessionId: "sender-a",
      seq: 1,
    });

    room.emitPreview("sender-a", append("shared-id"));
    expect(adapter.getSnapshot()[0]).toMatchObject({ seq: 2, sampleCount: 3 });
    room.emitPreview("sender-a", terminal("shared-id", 3, "cancel"));
    expect(adapter.getSnapshot()).toEqual([]);

    room.emitPreview("sender-b", begin("shared-id"));
    expect(adapter.getSnapshot()[0]).toMatchObject({ senderSessionId: "sender-b" });
    adapter.dispose();
  });

  it("clears page, presence, transport, null-room, and dispose boundaries", () => {
    const room = new FakeRoom([peer("sender-a")]);
    const adapter = new StudioLiveGesturePreviewRoomAdapter({ pageId: "page-a" });
    const listener = vi.fn();
    adapter.subscribe(listener);
    adapter.setRoom(room);

    room.emitPreview("sender-a", begin("page-clear"));
    adapter.setActivePage("page-b");
    expect(adapter.getSnapshot()).toEqual([]);
    room.emitPreview("sender-a", begin("wrong-page"));
    expect(adapter.getSnapshot()).toEqual([]);

    adapter.setActivePage("page-a");
    room.emitPreview("sender-a", begin("presence-clear"));
    room.setPeers([]);
    expect(adapter.getSnapshot()).toEqual([]);

    room.setPeers([peer("sender-a")]);
    room.emitPreview("sender-a", begin("transport-clear"));
    room.emit({
      type: "transport-status",
      status: { state: "disconnected", message: "offline", recoverable: true },
    });
    expect(adapter.getSnapshot()).toEqual([]);

    room.emitPreview("sender-a", begin("room-clear"));
    adapter.setRoom(null);
    expect(adapter.getSnapshot()).toEqual([]);
    const callCountBeforeDispose = listener.mock.calls.length;
    adapter.dispose();
    room.emitPreview("sender-a", begin("after-dispose"));
    expect(listener).toHaveBeenCalledTimes(callCountBeforeDispose);
  });

  it("publishes immutable, eligibility-consistent external-store snapshots", () => {
    const room = new FakeRoom([peer("sender-a")]);
    const adapter = new StudioLiveGesturePreviewRoomAdapter({ pageId: "page-a" });
    const observed: Array<{
      snapshot: ReturnType<typeof adapter.getSnapshot>;
      keys: ReturnType<typeof adapter.getEligiblePreviewKeys>;
    }> = [];
    adapter.subscribe(() => {
      observed.push({
        snapshot: adapter.getSnapshot(),
        keys: adapter.getEligiblePreviewKeys(),
      });
    });
    adapter.setRoom(room);

    room.emitPreview("sender-a", begin("gesture-a"));
    const beginKeys = adapter.getEligiblePreviewKeys();
    room.emitPreview("sender-a", append("gesture-a"));
    expect(adapter.getEligiblePreviewKeys()).toBe(beginKeys);
    room.emitPreview("sender-a", terminal("gesture-a", 3, "cancel"));

    expect(Object.isFrozen(beginKeys)).toBe(true);
    expect(observed.length).toBeGreaterThanOrEqual(3);
    for (const state of observed) {
      expect(Object.isFrozen(state.snapshot)).toBe(true);
      expect(Object.isFrozen(state.keys)).toBe(true);
      expect(state.snapshot.map((entry) => entry.key)).toEqual(state.keys);
    }
    adapter.dispose();
  });

  it("keeps an ended preview until the correlated authoritative layer receipt", () => {
    const room = new FakeRoom([peer("sender-a")]);
    const adapter = new StudioLiveGesturePreviewRoomAdapter({ pageId: "page-a" });
    adapter.setRoom(room);

    room.emitPreview("sender-a", begin("handoff"));
    room.emitPreview("sender-a", terminal("handoff", 2, "end"));
    expect(adapter.getSnapshot()[0]).toMatchObject({
      gestureId: "handoff",
      lastPhase: "end",
    });

    expect(adapter.markAuthoritativeProjection("page-a", "handoff")).toBe(false);
    adapter.setAuthoritativeElementIds("page-a", ["handoff"]);
    expect(adapter.markAuthoritativeProjection("page-a", "handoff")).toBe(true);
    expect(adapter.getSnapshot()).toEqual([]);
    expect(adapter.getEligiblePreviewKeys()).toEqual([]);
    expect(adapter.markAuthoritativeProjection("page-a", "handoff")).toBe(false);

    room.emitPreview("sender-a", terminal("handoff", 2, "end"));
    expect(adapter.getSnapshot()).toEqual([]);
    adapter.dispose();
  });
});
