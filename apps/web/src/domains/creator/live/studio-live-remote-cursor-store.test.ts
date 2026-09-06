import { describe, expect, it } from "vitest";

import {
  STUDIO_REMOTE_CURSOR_TTL_MS,
  StudioRemoteCursorOverlayStore,
  type StudioRemoteCursorEventSource,
  type StudioRemoteCursorStoreScheduler,
} from "./studio-live-remote-cursor-store";

import type { StudioLiveParticipant } from "./studio-live-collaboration-protocol";
import type {
  StudioLivePeerCursor,
  StudioLiveRoomEvent,
} from "./studio-live-collaboration-room";

function participant(sessionId: string): StudioLiveParticipant {
  return { sessionId, displayName: sessionId, role: "editor" };
}

function peerCursor(sessionId: string, updatedAt: number): StudioLivePeerCursor {
  return {
    participant: participant(sessionId),
    cursor: { x: 0.25, y: 0.5, pageId: "page-a", tool: "pen" },
    updatedAt,
  };
}

class CursorSource implements StudioRemoteCursorEventSource {
  readonly listeners = new Set<(event: StudioLiveRoomEvent) => void>();
  cursors: StudioLivePeerCursor[] = [];
  subscriptions = 0;
  unsubscriptions = 0;

  getCursors(): StudioLivePeerCursor[] {
    return [...this.cursors];
  }

  subscribe(listener: (event: StudioLiveRoomEvent) => void): () => void {
    this.subscriptions += 1;
    this.listeners.add(listener);
    return () => {
      this.unsubscriptions += 1;
      this.listeners.delete(listener);
    };
  }

  emit(event: StudioLiveRoomEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}

function manualScheduler(initialNow = 10_000) {
  let now = initialNow;
  let nextFrame = 1;
  let nextInterval = 1;
  const frames = new Map<number, () => void>();
  const intervals = new Map<number, () => void>();
  const scheduler: StudioRemoteCursorStoreScheduler = {
    now: () => now,
    requestFrame: (callback) => {
      const handle = nextFrame++;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      frames.delete(handle);
    },
    setInterval: (callback) => {
      const handle = nextInterval++;
      intervals.set(handle, callback);
      return handle;
    },
    clearInterval: (handle) => {
      intervals.delete(handle as number);
    },
  };
  return {
    scheduler,
    advance: (durationMs: number) => { now += durationMs; },
    flushFrames: () => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback();
    },
    runIntervals: () => {
      for (const callback of [...intervals.values()]) callback();
    },
    frameCount: () => frames.size,
  };
}

describe("StudioRemoteCursorOverlayStore", () => {
  it("shares one room subscription and coalesces cursor updates into one frame", () => {
    const source = new CursorSource();
    const clock = manualScheduler();
    source.cursors = [peerCursor("seeded", 9_900)];
    const store = new StudioRemoteCursorOverlayStore(source, clock.scheduler);
    const firstListener = () => undefined;
    const secondListener = () => undefined;
    const unsubscribeFirst = store.subscribe(firstListener);
    const unsubscribeSecond = store.subscribe(secondListener);

    expect(source.subscriptions).toBe(1);
    expect(store.getSnapshot().map((entry) => entry.participant.sessionId)).toEqual(["seeded"]);

    source.emit({
      type: "cursor",
      participant: participant("peer-a"),
      cursor: { x: 0.1, y: 0.2, pageId: "page-a", tool: "eraser", drawing: true },
    });
    source.emit({
      type: "cursor",
      participant: participant("peer-b"),
      cursor: { x: 0.3, y: 0.4, pageId: "page-a", tool: "pen", drawing: true },
    });
    expect(clock.frameCount()).toBe(1);
    expect(store.getSnapshot()).toHaveLength(1);

    clock.flushFrames();
    expect(store.getSnapshot().map((entry) => entry.participant.sessionId)).toEqual([
      "seeded",
      "peer-a",
      "peer-b",
    ]);

    unsubscribeFirst();
    expect(source.unsubscriptions).toBe(0);
    unsubscribeSecond();
    expect(source.unsubscriptions).toBe(1);
    expect(store.getSnapshot()).toEqual([]);
  });

  it("removes sentinels, departed peers, and expired cursor tails", () => {
    const source = new CursorSource();
    const clock = manualScheduler();
    const store = new StudioRemoteCursorOverlayStore(source, clock.scheduler);
    const unsubscribe = store.subscribe(() => undefined);

    for (const sessionId of ["peer-a", "peer-b"]) {
      source.emit({
        type: "cursor",
        participant: participant(sessionId),
        cursor: { x: 0.1, y: 0.2, pageId: "page-a", tool: "eraser", drawing: true },
      });
    }
    clock.flushFrames();
    source.emit({
      type: "presence",
      peers: [{
        ...participant("peer-a"),
        visibility: "active",
        pageId: "page-a",
        lastSeenAt: 10_000,
      }],
    });
    clock.flushFrames();
    expect(store.getSnapshot().map((entry) => entry.participant.sessionId)).toEqual(["peer-a"]);

    source.emit({
      type: "cursor",
      participant: participant("peer-a"),
      cursor: { x: 0, y: 0, pageId: null, tool: null },
    });
    clock.flushFrames();
    expect(store.getSnapshot()).toEqual([]);

    source.emit({
      type: "cursor",
      participant: participant("peer-c"),
      cursor: { x: 0.1, y: 0.2, pageId: "page-a", tool: "eraser", drawing: true },
    });
    clock.flushFrames();
    clock.advance(STUDIO_REMOTE_CURSOR_TTL_MS + 1);
    clock.runIntervals();
    clock.flushFrames();
    expect(store.getSnapshot()).toEqual([]);
    unsubscribe();
  });
});
