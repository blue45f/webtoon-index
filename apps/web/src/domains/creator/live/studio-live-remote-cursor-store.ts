import { useMemo, useSyncExternalStore } from "react";

import { isStudioLiveCursorCleared } from "./studio-live-collaboration-protocol";
import {
  selectStudioRemoteCursorsForViewport,
  useStudioLiveViewportPreferences,
} from "./studio-live-viewport-preferences";

import type {
  StudioLivePeerCursor,
  StudioLiveRoom,
  StudioLiveRoomEvent,
} from "./studio-live-collaboration-room";

export const STUDIO_REMOTE_CURSOR_TTL_MS = 3_000;
export const STUDIO_REMOTE_CURSOR_LIMIT = 64;

const EMPTY_STUDIO_REMOTE_CURSOR_SNAPSHOT: readonly StudioLivePeerCursor[] = Object.freeze([]);

export interface StudioRemoteCursorEventSource {
  readonly ready?: boolean;
  getCursors(): StudioLivePeerCursor[];
  subscribe(listener: (event: StudioLiveRoomEvent) => void): () => void;
}

export interface StudioRemoteCursorStoreScheduler {
  now(): number;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}

const DEFAULT_STUDIO_REMOTE_CURSOR_SCHEDULER: StudioRemoteCursorStoreScheduler = {
  now: () => Date.now(),
  requestFrame: (callback) => globalThis.requestAnimationFrame(callback),
  cancelFrame: (handle) => globalThis.cancelAnimationFrame(handle),
  setInterval: (callback, delayMs) => globalThis.setInterval(callback, delayMs),
  clearInterval: (handle) => {
    globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>);
  },
};

/**
 * Room-owned cursor snapshot used by the isolated DOM cursor overlay.
 * It retains rAF coalescing, TTL, peer limits, and late-mount hydration without rerendering the
 * Studio editor owner.
 */
export class StudioRemoteCursorOverlayStore {
  private readonly cursors = new Map<string, StudioLivePeerCursor>();
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly StudioLivePeerCursor[] = EMPTY_STUDIO_REMOTE_CURSOR_SNAPSHOT;
  private unsubscribeRoom: (() => void) | null = null;
  private pruneTimer: unknown = null;
  private frameHandle: number | null = null;
  private renderPending = false;

  constructor(
    private readonly source: StudioRemoteCursorEventSource,
    private readonly scheduler: StudioRemoteCursorStoreScheduler =
      DEFAULT_STUDIO_REMOTE_CURSOR_SCHEDULER,
  ) {}

  readonly getSnapshot = (): readonly StudioLivePeerCursor[] => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  };

  private start(): void {
    this.cursors.clear();
    const initial = this.source.getCursors()
      .sort((left, right) => left.updatedAt - right.updatedAt)
      .slice(-STUDIO_REMOTE_CURSOR_LIMIT);
    for (const cursor of initial) {
      if (this.scheduler.now() - cursor.updatedAt <= STUDIO_REMOTE_CURSOR_TTL_MS) {
        this.cursors.set(cursor.participant.sessionId, cursor);
      }
    }
    this.commitSnapshot();
    this.unsubscribeRoom = this.source.subscribe(this.handleRoomEvent);
    this.pruneTimer = this.scheduler.setInterval(
      () => this.scheduleFlush(false),
      1_000,
    );
  }

  private stop(): void {
    this.unsubscribeRoom?.();
    this.unsubscribeRoom = null;
    if (this.pruneTimer !== null) this.scheduler.clearInterval(this.pruneTimer);
    this.pruneTimer = null;
    if (this.frameHandle !== null) this.scheduler.cancelFrame(this.frameHandle);
    this.frameHandle = null;
    this.renderPending = false;
    this.cursors.clear();
    this.snapshot = EMPTY_STUDIO_REMOTE_CURSOR_SNAPSHOT;
  }

  private readonly handleRoomEvent = (event: StudioLiveRoomEvent): void => {
    if (event.type === "cursor") {
      const sessionId = event.participant.sessionId;
      if (isStudioLiveCursorCleared(event.cursor)) {
        if (this.cursors.delete(sessionId)) this.scheduleFlush();
        return;
      }
      if (!this.cursors.has(sessionId) && this.cursors.size >= STUDIO_REMOTE_CURSOR_LIMIT) {
        let oldest: [string, StudioLivePeerCursor] | null = null;
        for (const entry of this.cursors) {
          if (!oldest || entry[1].updatedAt < oldest[1].updatedAt) oldest = entry;
        }
        if (oldest) this.cursors.delete(oldest[0]);
      }
      this.cursors.set(sessionId, {
        participant: event.participant,
        cursor: event.cursor,
        updatedAt: this.scheduler.now(),
      });
      this.scheduleFlush();
      return;
    }
    if (event.type === "presence") {
      const activeSessions = new Set(event.peers.map((peer) => peer.sessionId));
      let changed = false;
      for (const sessionId of this.cursors.keys()) {
        if (activeSessions.has(sessionId)) continue;
        this.cursors.delete(sessionId);
        changed = true;
      }
      if (changed) this.scheduleFlush();
      return;
    }
    if (
      event.type === "transport-status" &&
      event.status.state !== "ready" &&
      !(event.status.state === "error" && this.source.ready === true)
    ) {
      if (this.cursors.size > 0) {
        this.cursors.clear();
        this.scheduleFlush();
      }
    }
  };

  private scheduleFlush(renderChanged = true): void {
    if (renderChanged) this.renderPending = true;
    if (this.frameHandle !== null) return;
    this.frameHandle = this.scheduler.requestFrame(this.flush);
  }

  private readonly flush = (): void => {
    this.frameHandle = null;
    const expired = this.pruneExpired();
    if (this.renderPending || expired) this.commitSnapshot();
    this.renderPending = false;
  };

  private pruneExpired(): boolean {
    const now = this.scheduler.now();
    let changed = false;
    for (const [sessionId, cursor] of this.cursors) {
      if (now - cursor.updatedAt <= STUDIO_REMOTE_CURSOR_TTL_MS) continue;
      this.cursors.delete(sessionId);
      changed = true;
    }
    return changed;
  }

  private commitSnapshot(): void {
    this.snapshot = Array.from(this.cursors.values());
    for (const listener of [...this.listeners]) listener();
  }
}

const storesByRoom = new WeakMap<StudioLiveRoom, StudioRemoteCursorOverlayStore>();
const EMPTY_STUDIO_REMOTE_CURSOR_STORE = {
  getSnapshot: () => EMPTY_STUDIO_REMOTE_CURSOR_SNAPSHOT,
  subscribe: () => () => undefined,
};

function storeForRoom(room: StudioLiveRoom | null) {
  if (!room) return EMPTY_STUDIO_REMOTE_CURSOR_STORE;
  const existing = storesByRoom.get(room);
  if (existing) return existing;
  const created = new StudioRemoteCursorOverlayStore(room);
  storesByRoom.set(room, created);
  return created;
}

export function useStudioRemoteCursors(
  room: StudioLiveRoom | null,
): readonly StudioLivePeerCursor[] {
  const store = storeForRoom(room);
  const cursors = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const preferences = useStudioLiveViewportPreferences();
  return useMemo(
    () => selectStudioRemoteCursorsForViewport(cursors, preferences),
    [cursors, preferences],
  );
}
