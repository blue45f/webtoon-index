import { useSyncExternalStore } from "react";

import type { StudioLivePeerCursor } from "./studio-live-collaboration-room";

export type StudioLiveCursorVisibilityMode = "all" | "followed" | "hidden";

export interface StudioLiveViewportPreferencesSnapshot {
  readonly cursorVisibility: StudioLiveCursorVisibilityMode;
  readonly showTrails: boolean;
  /** Session selected by Studio's existing follow mode. This value is never persisted. */
  readonly focusedSessionId: string | null;
}

interface PersistedStudioLiveViewportPreferences {
  readonly cursorVisibility: StudioLiveCursorVisibilityMode;
  readonly showTrails: boolean;
}

export const STUDIO_LIVE_VIEWPORT_PREFERENCES_STORAGE_KEY =
  "toonspectrum:studio-live:viewport-preferences:v1";
/**
 * A room may retain up to 64 cursor states for reconnect/follow correctness, while the DOM overlay
 * renders only the most useful subset. Twelve simultaneous pointers remain readable and avoid an
 * unbounded SVG/name-label cost in large review sessions.
 */
export const STUDIO_REMOTE_CURSOR_RENDER_LIMIT = 12;

const DEFAULT_STUDIO_LIVE_VIEWPORT_PREFERENCES: StudioLiveViewportPreferencesSnapshot =
  Object.freeze({
    cursorVisibility: "all",
    showTrails: true,
    focusedSessionId: null,
  });
const EMPTY_STUDIO_LIVE_CURSOR_SELECTION: readonly StudioLivePeerCursor[] = Object.freeze([]);

let snapshot = DEFAULT_STUDIO_LIVE_VIEWPORT_PREFERENCES;
let hydrated = false;
let storageListenerAttached = false;
const listeners = new Set<() => void>();

function isCursorVisibilityMode(value: unknown): value is StudioLiveCursorVisibilityMode {
  return value === "all" || value === "followed" || value === "hidden";
}

function readPersistedPreferences(
  serialized: string | null,
): PersistedStudioLiveViewportPreferences | null {
  if (!serialized) return null;
  try {
    const value = JSON.parse(serialized) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (!isCursorVisibilityMode(value.cursorVisibility)) return null;
    if (typeof value.showTrails !== "boolean") return null;
    return {
      cursorVisibility: value.cursorVisibility,
      showTrails: value.showTrails,
    };
  } catch {
    return null;
  }
}

function preferenceSnapshotsEqual(
  left: StudioLiveViewportPreferencesSnapshot,
  right: StudioLiveViewportPreferencesSnapshot,
): boolean {
  return (
    left.cursorVisibility === right.cursorVisibility &&
    left.showTrails === right.showTrails &&
    left.focusedSessionId === right.focusedSessionId
  );
}

function emitChange(): void {
  for (const listener of [...listeners]) listener();
}

function commitSnapshot(
  next: StudioLiveViewportPreferencesSnapshot,
  options: { persist?: boolean } = {},
): void {
  if (preferenceSnapshotsEqual(snapshot, next)) return;
  snapshot = Object.freeze({ ...next });
  if (options.persist !== false && typeof window !== "undefined") {
    try {
      const persisted: PersistedStudioLiveViewportPreferences = {
        cursorVisibility: snapshot.cursorVisibility,
        showTrails: snapshot.showTrails,
      };
      window.localStorage.setItem(
        STUDIO_LIVE_VIEWPORT_PREFERENCES_STORAGE_KEY,
        JSON.stringify(persisted),
      );
    } catch {
      // Private browsing and embedded webviews may reject storage. The in-memory preference still
      // applies for the current Studio session.
    }
  }
  emitChange();
}

function onStorageChange(event: StorageEvent): void {
  if (event.key !== STUDIO_LIVE_VIEWPORT_PREFERENCES_STORAGE_KEY) return;
  const persisted = readPersistedPreferences(event.newValue);
  if (!persisted) return;
  commitSnapshot(
    {
      ...persisted,
      focusedSessionId: snapshot.focusedSessionId,
    },
    { persist: false },
  );
}

function hydratePreferences(): void {
  if (hydrated) return;
  hydrated = true;
  if (typeof window === "undefined") return;

  let persisted: PersistedStudioLiveViewportPreferences | null = null;
  try {
    persisted = readPersistedPreferences(
      window.localStorage.getItem(STUDIO_LIVE_VIEWPORT_PREFERENCES_STORAGE_KEY),
    );
  } catch {
    // Keep the safe defaults when storage cannot be read.
  }
  const reducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hydratedSnapshot: StudioLiveViewportPreferencesSnapshot = {
    cursorVisibility: persisted?.cursorVisibility ?? "all",
    showTrails: persisted?.showTrails ?? !reducedMotion,
    focusedSessionId: snapshot.focusedSessionId,
  };
  if (!preferenceSnapshotsEqual(snapshot, hydratedSnapshot)) {
    snapshot = Object.freeze(hydratedSnapshot);
  }
  if (!storageListenerAttached) {
    window.addEventListener("storage", onStorageChange);
    storageListenerAttached = true;
  }
}

function getSnapshot(): StudioLiveViewportPreferencesSnapshot {
  hydratePreferences();
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  hydratePreferences();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStudioLiveViewportPreferences(): StudioLiveViewportPreferencesSnapshot {
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => DEFAULT_STUDIO_LIVE_VIEWPORT_PREFERENCES,
  );
}

/** Imperative read for compatibility controls that toggle the authoritative store. */
export function getStudioLiveViewportPreferencesSnapshot(): StudioLiveViewportPreferencesSnapshot {
  return getSnapshot();
}

export function setStudioLiveCursorVisibility(
  cursorVisibility: StudioLiveCursorVisibilityMode,
): void {
  hydratePreferences();
  const resolvedVisibility =
    cursorVisibility === "followed" && !snapshot.focusedSessionId
      ? "all"
      : cursorVisibility;
  commitSnapshot({ ...snapshot, cursorVisibility: resolvedVisibility });
}

export function setStudioLiveCursorTrails(showTrails: boolean): void {
  hydratePreferences();
  commitSnapshot({ ...snapshot, showTrails });
}

/** Keeps the cursor preference store aligned with the editor-owned viewport follow state. */
export function setStudioLiveCursorFocus(sessionId: string | null): void {
  hydratePreferences();
  const focusedSessionId =
    typeof sessionId === "string" && sessionId.trim().length > 0 ? sessionId : null;
  commitSnapshot({
    ...snapshot,
    focusedSessionId,
    cursorVisibility:
      focusedSessionId === null && snapshot.cursorVisibility === "followed"
        ? "all"
        : snapshot.cursorVisibility,
  });
}

function finiteRenderLimit(value: number): number {
  if (!Number.isFinite(value)) return STUDIO_REMOTE_CURSOR_RENDER_LIMIT;
  return Math.max(1, Math.min(64, Math.trunc(value)));
}

/**
 * Pure hot-path selector used by the isolated cursor overlay. The followed peer and drawing
 * cursors win the render budget, then the freshest remaining pointers. Hiding trails removes the
 * expensive SVG polyline payload before React receives it.
 */
export function selectStudioRemoteCursorsForViewport(
  cursors: readonly StudioLivePeerCursor[],
  preferences: StudioLiveViewportPreferencesSnapshot,
  renderLimit = STUDIO_REMOTE_CURSOR_RENDER_LIMIT,
): readonly StudioLivePeerCursor[] {
  if (preferences.cursorVisibility === "hidden" || cursors.length === 0) {
    return EMPTY_STUDIO_LIVE_CURSOR_SELECTION;
  }

  const focusedSessionId = preferences.focusedSessionId;
  const candidates = preferences.cursorVisibility === "followed"
    ? focusedSessionId
      ? cursors.filter(
          (cursor) => cursor.participant.sessionId === focusedSessionId,
        )
      : []
    : [...cursors];
  if (candidates.length === 0) return EMPTY_STUDIO_LIVE_CURSOR_SELECTION;

  candidates.sort((left, right) => {
    const leftFocused = left.participant.sessionId === focusedSessionId ? 1 : 0;
    const rightFocused = right.participant.sessionId === focusedSessionId ? 1 : 0;
    if (leftFocused !== rightFocused) return rightFocused - leftFocused;
    const leftDrawing = left.cursor.drawing ? 1 : 0;
    const rightDrawing = right.cursor.drawing ? 1 : 0;
    if (leftDrawing !== rightDrawing) return rightDrawing - leftDrawing;
    if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
    return left.participant.sessionId.localeCompare(right.participant.sessionId);
  });

  const selected = candidates.slice(0, finiteRenderLimit(renderLimit));
  if (preferences.showTrails) return selected;
  return selected.map((entry) =>
    entry.cursor.points
      ? {
          ...entry,
          cursor: { ...entry.cursor, points: undefined },
        }
      : entry,
  );
}

/** Test isolation seam; callers clear localStorage before asking the next hook to rehydrate. */
export function resetStudioLiveViewportPreferencesForTests(): void {
  hydrated = false;
  snapshot = DEFAULT_STUDIO_LIVE_VIEWPORT_PREFERENCES;
  emitChange();
}
