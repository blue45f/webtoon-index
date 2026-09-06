import { describe, expect, it } from "vitest";

import {
  isNewerStudioTeamCommentLiveEvent,
  parseStudioTeamCommentLiveEvent,
} from "./studio-team-comment-live-event";

const VALID_EVENT = {
  version: 1,
  workId: "work-1",
  threadId: "thread-1",
  activitySequence: "42",
  kind: "replied",
} as const;

describe("Studio team-comment live invalidation", () => {
  it("accepts one bounded event for the joined work", () => {
    expect(parseStudioTeamCommentLiveEvent(VALID_EVENT, "work-1")).toEqual(VALID_EVENT);
  });

  it.each([
    [{ ...VALID_EVENT, version: 2 }],
    [{ ...VALID_EVENT, workId: "work-2" }],
    [{ ...VALID_EVENT, threadId: " thread-1" }],
    [{ ...VALID_EVENT, activitySequence: "0" }],
    [{ ...VALID_EVENT, activitySequence: "01" }],
    [{ ...VALID_EVENT, activitySequence: "9223372036854775808" }],
    [{ ...VALID_EVENT, kind: "deleted" }],
    [{ ...VALID_EVENT, extra: true }],
  ])("rejects malformed, cross-room, or forward-incompatible payloads", (value) => {
    expect(parseStudioTeamCommentLiveEvent(value, "work-1")).toBeNull();
  });

  it("drops duplicate and reordered activity while accepting a newer delta", () => {
    const event = parseStudioTeamCommentLiveEvent(VALID_EVENT, "work-1");
    expect(event).not.toBeNull();
    expect(isNewerStudioTeamCommentLiveEvent(event!, "41")).toBe(true);
    expect(isNewerStudioTeamCommentLiveEvent(event!, "42")).toBe(false);
    expect(isNewerStudioTeamCommentLiveEvent(event!, "43")).toBe(false);
  });

  it("fails open to a bounded refresh when the local frontier is absent or corrupt", () => {
    const event = parseStudioTeamCommentLiveEvent(VALID_EVENT, "work-1")!;
    expect(isNewerStudioTeamCommentLiveEvent(event, null)).toBe(true);
    expect(isNewerStudioTeamCommentLiveEvent(event, "not-a-sequence")).toBe(true);
  });
});
