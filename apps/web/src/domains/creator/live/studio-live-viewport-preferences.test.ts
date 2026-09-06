import { describe, expect, it } from "vitest";

import {
  selectStudioRemoteCursorsForViewport,
  type StudioLiveViewportPreferencesSnapshot,
} from "./studio-live-viewport-preferences";

import type { StudioLivePeerCursor } from "./studio-live-collaboration-room";

function cursor(
  sessionId: string,
  updatedAt: number,
  options: { drawing?: boolean; points?: readonly number[] } = {},
): StudioLivePeerCursor {
  return {
    participant: {
      sessionId,
      displayName: sessionId,
      role: "editor",
    },
    cursor: {
      x: 0.25,
      y: 0.5,
      pageId: "page-a",
      tool: "pen",
      drawing: options.drawing,
      points: options.points,
    },
    updatedAt,
  };
}

function preferences(
  overrides: Partial<StudioLiveViewportPreferencesSnapshot> = {},
): StudioLiveViewportPreferencesSnapshot {
  return {
    cursorVisibility: "all",
    showTrails: true,
    focusedSessionId: null,
    ...overrides,
  };
}

describe("selectStudioRemoteCursorsForViewport", () => {
  it("supports distraction-free hidden and followed-only modes", () => {
    const cursors = [cursor("peer-a", 100), cursor("peer-b", 200)];

    expect(
      selectStudioRemoteCursorsForViewport(
        cursors,
        preferences({ cursorVisibility: "hidden" }),
      ),
    ).toEqual([]);
    expect(
      selectStudioRemoteCursorsForViewport(
        cursors,
        preferences({
          cursorVisibility: "followed",
          focusedSessionId: "peer-b",
        }),
      ).map((entry) => entry.participant.sessionId),
    ).toEqual(["peer-b"]);
  });

  it("prioritizes the followed peer, active drawing, and freshness inside the render budget", () => {
    const cursors = [
      cursor("old-idle", 100),
      cursor("fresh-idle", 400),
      cursor("drawing", 200, { drawing: true }),
      cursor("followed", 50),
    ];

    expect(
      selectStudioRemoteCursorsForViewport(
        cursors,
        preferences({ focusedSessionId: "followed" }),
        3,
      ).map((entry) => entry.participant.sessionId),
    ).toEqual(["followed", "drawing", "fresh-idle"]);
  });

  it("removes trail points before rendering without mutating the room snapshot", () => {
    const source = cursor("peer-a", 100, { points: [0, 0, 10, 10] });
    const selected = selectStudioRemoteCursorsForViewport(
      [source],
      preferences({ showTrails: false }),
    );

    expect(selected).toHaveLength(1);
    expect(selected[0]?.cursor.points).toBeUndefined();
    expect(source.cursor.points).toEqual([0, 0, 10, 10]);
  });
});
