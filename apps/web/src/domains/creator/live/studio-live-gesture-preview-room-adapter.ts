import {
  STUDIO_LIVE_GESTURE_PREVIEW_MAX_ACTIVE_GESTURES,
  STUDIO_LIVE_GESTURE_PREVIEW_MAX_SETTLING_GESTURES,
  StudioLiveGesturePreviewStore,
  studioLiveGesturePreviewKey,
  type StudioLiveGesturePreviewSnapshot,
  type StudioLiveGesturePreviewSnapshotEntry,
} from "./studio-live-gesture-preview-store";

import type {
  StudioLivePeer,
  StudioLiveRoom,
  StudioLiveRoomEvent,
} from "./studio-live-collaboration-room";
import type { StudioLiveGesturePreviewPayload } from "./studio-live-gesture-preview";

const EMPTY_PREVIEW_SNAPSHOT: StudioLiveGesturePreviewSnapshot = Object.freeze([]);
const EMPTY_PREVIEW_KEYS: readonly string[] = Object.freeze([]);

/** Active and settling previews are independently bounded by the reducer. */
export const STUDIO_LIVE_GESTURE_PREVIEW_MAX_ELIGIBLE_GESTURES =
  STUDIO_LIVE_GESTURE_PREVIEW_MAX_ACTIVE_GESTURES
  + STUDIO_LIVE_GESTURE_PREVIEW_MAX_SETTLING_GESTURES;

export interface StudioLiveGesturePreviewRoomSource {
  subscribe(listener: (event: StudioLiveRoomEvent) => void): () => void;
  getPeers(): StudioLivePeer[];
}

export interface StudioLiveGesturePreviewRoomAdapterOptions {
  readonly pageId?: string | null;
  readonly authoritativeElementIds?: Iterable<string>;
  readonly store?: StudioLiveGesturePreviewStore;
  readonly maxEligibleGestures?: number;
}

interface EligibleGesturePin {
  readonly key: string;
  readonly senderSessionId: string;
  readonly gestureId: string;
  readonly pageId: string;
}

function sameEntrySequence(
  left: StudioLiveGesturePreviewSnapshot,
  right: StudioLiveGesturePreviewSnapshot,
): boolean {
  return left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

function sameStringSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function boundedEligibleGestureLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return STUDIO_LIVE_GESTURE_PREVIEW_MAX_ELIGIBLE_GESTURES;
  return Math.max(
    1,
    Math.min(
      STUDIO_LIVE_GESTURE_PREVIEW_MAX_ELIGIBLE_GESTURES,
      Math.trunc(value ?? STUDIO_LIVE_GESTURE_PREVIEW_MAX_ELIGIBLE_GESTURES),
    ),
  );
}

/**
 * Bridges Room's authenticated ephemeral stream to the transport-neutral preview reducer.
 *
 * The adapter owns the render eligibility boundary. A reducer entry is visible only after its
 * exact sender/gesture key was pinned by an eligible `begin`; direct reducer writes, uncorrelated
 * suffixes, and cross-peer id collisions never leak into a React snapshot.
 */
export class StudioLiveGesturePreviewRoomAdapter {
  private readonly store: StudioLiveGesturePreviewStore;
  private readonly maxEligibleGestures: number;
  private readonly listeners = new Set<() => void>();
  private readonly pinsByKey = new Map<string, EligibleGesturePin>();
  private readonly ownerKeyByGestureId = new Map<string, string>();
  private storeUnsubscribe: (() => void) | null = null;
  private room: StudioLiveGesturePreviewRoomSource | null = null;
  private roomUnsubscribe: (() => void) | null = null;
  private roomGeneration = 0;
  private activePageId: string | null;
  private authoritativeElementIds: ReadonlySet<string>;
  private snapshot: StudioLiveGesturePreviewSnapshot = EMPTY_PREVIEW_SNAPSHOT;
  private eligiblePreviewKeys: readonly string[] = EMPTY_PREVIEW_KEYS;
  private disposed = false;

  constructor(options: StudioLiveGesturePreviewRoomAdapterOptions = {}) {
    this.activePageId = options.pageId ?? null;
    this.authoritativeElementIds = new Set(options.authoritativeElementIds ?? []);
    this.maxEligibleGestures = boundedEligibleGestureLimit(options.maxEligibleGestures);
    this.store = options.store ?? new StudioLiveGesturePreviewStore({
      pageId: this.activePageId,
    });
    this.store.setActivePage(this.activePageId);
    this.reconcileFromStore();
  }

  readonly getSnapshot = (): StudioLiveGesturePreviewSnapshot => this.snapshot;

  readonly getEligiblePreviewKeys = (): readonly string[] => this.eligiblePreviewKeys;

  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    this.ensureStoreSubscription();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size !== 0) return;
      this.storeUnsubscribe?.();
      this.storeUnsubscribe = null;
    };
  };

  setRoom(room: StudioLiveRoom | StudioLiveGesturePreviewRoomSource | null): void {
    if (this.disposed || this.room === room) return;

    const generation = ++this.roomGeneration;
    this.roomUnsubscribe?.();
    this.roomUnsubscribe = null;
    this.room = null;
    this.clearTransientState();

    if (!room) return;
    this.room = room;
    this.roomUnsubscribe = room.subscribe((event) => {
      if (
        this.disposed
        || this.room !== room
        || this.roomGeneration !== generation
      ) return;
      this.onRoomEvent(event);
    });
    this.retainPresentPeers(room.getPeers());
  }

  setActivePage(pageId: string | null): void {
    if (this.disposed || this.activePageId === pageId) return;
    this.activePageId = pageId;
    this.authoritativeElementIds = new Set();
    this.clearPins();
    this.store.setActivePage(pageId);
    this.reconcileFromStore();
  }

  /** Replaces the authoritative id set only when it belongs to the currently visible page. */
  setAuthoritativeElementIds(pageId: string | null, elementIds: Iterable<string>): boolean {
    if (this.disposed || pageId !== this.activePageId) return false;
    this.authoritativeElementIds = pageId === null
      ? new Set()
      : new Set(elementIds);
    return true;
  }

  /**
   * Completes the preview-to-retained-layer handoff only for a currently eligible, painted id.
   * Calling this before `begin`, for another page, or before the id enters the authoritative
   * snapshot cannot manufacture a reducer witness.
   */
  markAuthoritativeProjection(pageId: string, gestureId: string): boolean {
    if (
      this.disposed
      || pageId !== this.activePageId
      || !this.authoritativeElementIds.has(gestureId)
    ) return false;

    const ownerKey = this.ownerKeyByGestureId.get(gestureId);
    if (
      !ownerKey
      || !this.pinsByKey.has(ownerKey)
      || !this.eligiblePreviewKeys.includes(ownerKey)
    ) return false;

    const forwarded = this.store.markAuthoritativeProjection(pageId, gestureId);
    if (!forwarded) return false;
    this.removePin(ownerKey);
    this.reconcileFromStore();
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.roomGeneration += 1;
    this.roomUnsubscribe?.();
    this.roomUnsubscribe = null;
    this.room = null;
    this.clearTransientState();
    this.storeUnsubscribe?.();
    this.storeUnsubscribe = null;
    this.store.dispose();
    this.listeners.clear();
    this.disposed = true;
  }

  private onRoomEvent(event: StudioLiveRoomEvent): void {
    if (event.type === "gesture-preview") {
      this.applyGesturePreview(event.participant.sessionId, event.payload);
      return;
    }
    if (event.type === "presence") {
      this.retainPresentPeers(event.peers);
      return;
    }
    if (
      event.type === "transport-error"
      || (
        event.type === "transport-status"
        && event.status.state !== "ready"
      )
    ) {
      this.clearTransientState();
    }
  }

  private ensureStoreSubscription(): void {
    if (this.storeUnsubscribe || this.disposed) return;
    this.storeUnsubscribe = this.store.subscribe(() => this.reconcileFromStore());
  }

  private applyGesturePreview(
    senderSessionId: string,
    payload: StudioLiveGesturePreviewPayload,
  ): void {
    const key = studioLiveGesturePreviewKey(senderSessionId, payload.gestureId);
    if (payload.phase !== "begin") {
      if (!this.pinsByKey.has(key)) return;
      this.store.apply(senderSessionId, payload);
      this.reconcileFromStore();
      return;
    }

    const existingPin = this.pinsByKey.get(key);
    if (existingPin) {
      this.store.apply(senderSessionId, payload);
      this.reconcileFromStore();
      return;
    }
    if (
      this.activePageId === null
      || payload.pageId !== this.activePageId
      || this.authoritativeElementIds.has(payload.gestureId)
      || this.pinsByKey.size >= this.maxEligibleGestures
    ) return;

    const currentOwnerKey = this.ownerKeyByGestureId.get(payload.gestureId);
    if (currentOwnerKey && currentOwnerKey !== key) return;

    const pin: EligibleGesturePin = Object.freeze({
      key,
      senderSessionId,
      gestureId: payload.gestureId,
      pageId: payload.pageId,
    });
    this.pinsByKey.set(key, pin);
    this.ownerKeyByGestureId.set(payload.gestureId, key);
    this.store.apply(senderSessionId, payload);

    const storedEntry = this.store.getSnapshot().find((entry) => entry.key === key);
    if (!storedEntry || !this.entryMatchesPin(storedEntry, pin)) this.removePin(key);
    this.reconcileFromStore();
  }

  private retainPresentPeers(peers: readonly StudioLivePeer[]): void {
    const presentSenderIds = new Set(peers.map((peer) => peer.sessionId));
    this.store.retainPresentSenders(presentSenderIds);
    for (const [key, pin] of this.pinsByKey) {
      if (!presentSenderIds.has(pin.senderSessionId)) this.removePin(key);
    }
    this.reconcileFromStore();
  }

  private clearTransientState(): void {
    this.clearPins();
    this.store.clearForTransportLoss();
    this.reconcileFromStore();
  }

  private clearPins(): void {
    this.pinsByKey.clear();
    this.ownerKeyByGestureId.clear();
  }

  private removePin(key: string): void {
    const pin = this.pinsByKey.get(key);
    if (!pin) return;
    this.pinsByKey.delete(key);
    if (this.ownerKeyByGestureId.get(pin.gestureId) === key) {
      this.ownerKeyByGestureId.delete(pin.gestureId);
    }
  }

  private entryMatchesPin(
    entry: StudioLiveGesturePreviewSnapshotEntry,
    pin: EligibleGesturePin,
  ): boolean {
    return entry.key === pin.key
      && entry.senderSessionId === pin.senderSessionId
      && entry.gestureId === pin.gestureId
      && entry.pageId === pin.pageId
      && entry.pageId === this.activePageId;
  }

  private reconcileFromStore(): void {
    if (this.disposed) return;
    const storeSnapshot = this.store.getSnapshot();
    const entryByKey = new Map(storeSnapshot.map((entry) => [entry.key, entry]));
    for (const [key, pin] of this.pinsByKey) {
      const entry = entryByKey.get(key);
      if (!entry || !this.entryMatchesPin(entry, pin)) this.removePin(key);
    }

    const nextEntries = storeSnapshot.filter((entry) => {
      const pin = this.pinsByKey.get(entry.key);
      return Boolean(pin && this.entryMatchesPin(entry, pin));
    });
    const nextKeys = nextEntries.map((entry) => entry.key);
    const snapshotChanged = !sameEntrySequence(this.snapshot, nextEntries);
    const keysChanged = !sameStringSequence(this.eligiblePreviewKeys, nextKeys);
    if (!snapshotChanged && !keysChanged) return;

    if (snapshotChanged) {
      this.snapshot = nextEntries.length === 0
        ? EMPTY_PREVIEW_SNAPSHOT
        : Object.freeze(nextEntries);
    }
    if (keysChanged) {
      this.eligiblePreviewKeys = nextKeys.length === 0
        ? EMPTY_PREVIEW_KEYS
        : Object.freeze(nextKeys);
    }
    for (const listener of [...this.listeners]) listener();
  }
}
