import { describe, expect, it } from "vitest";

import { selectStudioLivePresentedCursors } from "./studio-live-cursor-presentation";

import type {
  StudioLivePeer,
  StudioLivePeerCursor,
} from "./studio-live-collaboration-room";

function peer(
  sessionId: string,
  visibility: StudioLivePeer["visibility"] = "active"
): StudioLivePeer {
  return {
    sessionId,
    displayName: sessionId,
    role: "editor",
    visibility,
    pageId: "page-1",
    lastSeenAt: 100,
  };
}

function cursor(
  sessionId: string,
  options: { drawing?: boolean; updatedAt?: number; pageId?: string } = {}
): StudioLivePeerCursor {
  return {
    participant: {
      sessionId,
      displayName: sessionId,
      role: "editor",
    },
    cursor: {
      x: 0.5,
      y: 0.5,
      pageId: options.pageId ?? "page-1",
      tool: "brush",
      drawing: options.drawing ?? false,
    },
    updatedAt: options.updatedAt ?? 100,
  };
}

describe("selectStudioLivePresentedCursors", () => {
  it("keeps cursor chat, followed, drawing and active collaborators in that order", () => {
    const selected = selectStudioLivePresentedCursors({
      cursors: [
        cursor("idle", { updatedAt: 500 }),
        cursor("active", { updatedAt: 400 }),
        cursor("drawing", { drawing: true, updatedAt: 300 }),
        cursor("followed", { updatedAt: 200 }),
        cursor("cursor-chat", { updatedAt: 100 }),
        cursor("other-page", { pageId: "page-2" }),
      ],
      peers: [
        peer("idle", "idle"),
        peer("active"),
        peer("drawing", "idle"),
        peer("followed", "idle"),
        peer("cursor-chat", "idle"),
        peer("other-page"),
      ],
      pageId: "page-1",
      followingSessionId: "followed",
      pinnedSessionIds: new Set(["cursor-chat"]),
      qualityTier: "live",
    });

    expect(selected.map((entry) => entry.participant.sessionId)).toEqual([
      "cursor-chat",
      "followed",
      "drawing",
      "active",
      "idle",
    ]);
  });

  it("honors the local hide-cursors preference", () => {
    expect(
      selectStudioLivePresentedCursors({
        cursors: [cursor("followed")],
        peers: [peer("followed")],
        pageId: "page-1",
        followingSessionId: "followed",
        visible: false,
      })
    ).toEqual([]);
  });

  it("bounds constrained DOM rendering after applying activity priority", () => {
    const cursors = Array.from({ length: 32 }, (_, index) =>
      cursor(`peer-${index}`, { drawing: index === 31, updatedAt: index })
    );
    const peers = cursors.map((entry) => peer(entry.participant.sessionId));
    const selected = selectStudioLivePresentedCursors({
      cursors,
      peers,
      pageId: "page-1",
      qualityTier: "constrained",
    });

    expect(selected).toHaveLength(20);
    expect(selected[0]?.participant.sessionId).toBe("peer-31");
  });
});
