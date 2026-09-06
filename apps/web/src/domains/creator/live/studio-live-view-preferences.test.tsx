// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STUDIO_LIVE_VIEW_PREFERENCES_STORAGE_KEY,
  isStudioLiveCursorVisibilityShortcut,
  isStudioLiveShortcutTextTarget,
  resetStudioLiveViewPreferencesForTests,
  setStudioLiveRemoteCursorsVisible,
  toggleStudioLiveRemoteCursors,
  useStudioLiveViewPreferences,
} from "./studio-live-view-preferences";

beforeEach(() => {
  window.localStorage.clear();
  resetStudioLiveViewPreferencesForTests();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetStudioLiveViewPreferencesForTests();
});

describe("studio live view preferences", () => {
  it("persists the remote cursor visibility preference in the viewport schema", () => {
    const { result } = renderHook(() => useStudioLiveViewPreferences());
    expect(result.current.remoteCursorsVisible).toBe(true);

    act(() => setStudioLiveRemoteCursorsVisible(false));
    expect(result.current.remoteCursorsVisible).toBe(false);
    expect(JSON.parse(
      window.localStorage.getItem(STUDIO_LIVE_VIEW_PREFERENCES_STORAGE_KEY) ?? "{}",
    )).toEqual({ cursorVisibility: "hidden", showTrails: true });

    act(() => toggleStudioLiveRemoteCursors());
    expect(result.current.remoteCursorsVisible).toBe(true);
  });

  it("hydrates a previously hidden-cursor choice", () => {
    window.localStorage.setItem(
      STUDIO_LIVE_VIEW_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ cursorVisibility: "hidden", showTrails: true }),
    );
    resetStudioLiveViewPreferencesForTests();

    const { result } = renderHook(() => useStudioLiveViewPreferences());
    expect(result.current.remoteCursorsVisible).toBe(false);
  });

  it("matches the cross-platform cursor toggle shortcut without stealing text input", () => {
    expect(isStudioLiveCursorVisibilityShortcut({
      key: "\\",
      altKey: true,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    })).toBe(true);
    expect(isStudioLiveCursorVisibilityShortcut({
      key: "\\",
      altKey: true,
      ctrlKey: false,
      metaKey: true,
      shiftKey: false,
    })).toBe(true);
    expect(isStudioLiveCursorVisibilityShortcut({
      key: "\\",
      altKey: false,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    })).toBe(false);

    const input = document.createElement("input");
    const canvas = document.createElement("div");
    expect(isStudioLiveShortcutTextTarget(input)).toBe(true);
    expect(isStudioLiveShortcutTextTarget(canvas)).toBe(false);
  });
});
