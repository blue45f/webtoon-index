import { useMemo } from "react";

import {
  STUDIO_LIVE_VIEWPORT_PREFERENCES_STORAGE_KEY,
  getStudioLiveViewportPreferencesSnapshot,
  resetStudioLiveViewportPreferencesForTests,
  setStudioLiveCursorVisibility,
  useStudioLiveViewportPreferences,
} from "./studio-live-viewport-preferences";

export interface StudioLiveViewPreferences {
  readonly remoteCursorsVisible: boolean;
}

/** Compatibility alias retained for existing callers while one schema owns persistence. */
export const STUDIO_LIVE_VIEW_PREFERENCES_STORAGE_KEY =
  STUDIO_LIVE_VIEWPORT_PREFERENCES_STORAGE_KEY;

export function setStudioLiveRemoteCursorsVisible(visible: boolean): void {
  setStudioLiveCursorVisibility(visible ? "all" : "hidden");
}

export function toggleStudioLiveRemoteCursors(): void {
  const current = getStudioLiveViewportPreferencesSnapshot();
  setStudioLiveCursorVisibility(
    current.cursorVisibility === "hidden" ? "all" : "hidden",
  );
}

export function useStudioLiveViewPreferences(): StudioLiveViewPreferences {
  const preferences = useStudioLiveViewportPreferences();
  return useMemo(
    () => Object.freeze({
      remoteCursorsVisible: preferences.cursorVisibility !== "hidden",
    }),
    [preferences.cursorVisibility],
  );
}

export function isStudioLiveCursorVisibilityShortcut(
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
): boolean {
  return (
    event.key === "\\"
    && event.altKey
    && !event.shiftKey
    && (event.metaKey || event.ctrlKey)
  );
}

export function isStudioLiveShortcutTextTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]',
    ),
  );
}

/** Test isolation seam shared with the authoritative viewport preference store. */
export function resetStudioLiveViewPreferencesForTests(): void {
  resetStudioLiveViewportPreferencesForTests();
}
