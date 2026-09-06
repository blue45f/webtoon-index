import { describe, expect, it } from "vitest";

import {
  studioCommentActorsRepresentSamePerson,
  studioCommentThreadAssignedToActor,
  studioCommentThreadMentionsActor,
} from "./studio-comment-inbox-filter";

import type { StudioCommentActor, StudioCommentThread } from "./studio-comments";

const NOW = "2026-09-05T00:00:00.000Z";
const CURRENT: StudioCommentActor = { id: "actor-current", displayName: "희준" };

function thread(overrides: Partial<StudioCommentThread> = {}): StudioCommentThread {
  return {
    id: "thread-1",
    author: { id: "reviewer", displayName: "검수자" },
    body: "말풍선 위치를 확인해 주세요.",
    mentions: [],
    createdAt: NOW,
    updatedAt: NOW,
    anchor: { type: "page", pageId: "page-1" },
    replies: [],
    resolved: false,
    ...overrides,
  };
}

describe("Studio comment smart inbox", () => {
  it("keeps account IDs authoritative", () => {
    expect(studioCommentActorsRepresentSamePerson(
      CURRENT,
      { id: "actor-current", displayName: "변경된 이름" }
    )).toBe(true);
    expect(studioCommentActorsRepresentSamePerson(CURRENT, { displayName: "희준" })).toBe(false);
  });

  it("normalizes display-name-only legacy actors", () => {
    expect(studioCommentActorsRepresentSamePerson(
      { displayName: "  ＨＥＥＪＵＮ  " },
      { displayName: "heejun" }
    )).toBe(true);
  });

  it("matches assigned threads", () => {
    expect(studioCommentThreadAssignedToActor(thread({ assignee: CURRENT }), CURRENT)).toBe(true);
    expect(studioCommentThreadAssignedToActor(thread(), CURRENT)).toBe(false);
  });

  it("matches mentions in the opening message and replies", () => {
    expect(studioCommentThreadMentionsActor(thread({ mentions: [CURRENT] }), CURRENT)).toBe(true);
    expect(studioCommentThreadMentionsActor(thread({
      replies: [{
        id: "reply-1",
        author: { id: "reviewer", displayName: "검수자" },
        body: "수정 확인 부탁드립니다.",
        mentions: [CURRENT],
        createdAt: NOW,
        updatedAt: NOW,
      }],
    }), CURRENT)).toBe(true);
  });

  it("rejects unrelated mentions", () => {
    expect(studioCommentThreadMentionsActor(thread({
      mentions: [{ id: "someone-else", displayName: "다른 사용자" }],
    }), CURRENT)).toBe(false);
  });
});
