import { describe, expect, it } from "vitest";

import {
  decideStudioTeamCommentLiveResponse,
  mergeStudioTeamCommentMutationReceipt,
  mergeStudioTeamCommentReadReceipt,
} from "./studio-team-comment-frontier";

describe("studio team comment sequence frontiers", () => {
  it("coalesces a newer live target without dropping it or starting an unbounded retry loop", () => {
    expect(decideStudioTeamCommentLiveResponse({
      remoteSequence: BigInt(6),
      targetSequence: BigInt(7),
      currentReadSequence: BigInt(5),
      remoteUnread: true,
      staleResponseRetries: 0,
    })).toEqual({ status: "retry", staleResponseRetries: 1 });
    expect(decideStudioTeamCommentLiveResponse({
      remoteSequence: BigInt(6),
      targetSequence: BigInt(7),
      currentReadSequence: BigInt(5),
      remoteUnread: true,
      staleResponseRetries: 1,
    })).toEqual({ status: "defer", staleResponseRetries: 1 });
  });

  it("does not resurrect unread after an equal or newer read receipt wins the race", () => {
    expect(decideStudioTeamCommentLiveResponse({
      remoteSequence: BigInt(6),
      targetSequence: BigInt(6),
      currentReadSequence: BigInt(6),
      remoteUnread: true,
      staleResponseRetries: 0,
    })).toEqual({ status: "accept", staleResponseRetries: 0, remainsUnread: false });
    expect(decideStudioTeamCommentLiveResponse({
      remoteSequence: BigInt(7),
      targetSequence: BigInt(7),
      currentReadSequence: BigInt(6),
      remoteUnread: true,
      staleResponseRetries: 0,
    })).toEqual({ status: "accept", staleResponseRetries: 0, remainsUnread: true });
  });

  it("does not regress activity or clear unread state for an old idempotency replay", () => {
    const activity = new Map([["thread-1", BigInt(4)]]);
    const read = new Map([["thread-1", BigInt(1)]]);

    expect(mergeStudioTeamCommentMutationReceipt(
      activity,
      read,
      "thread-1",
      BigInt(1)
    )).toEqual({
      activitySequence: BigInt(4),
      readSequence: BigInt(1),
      stale: true,
      fullyRead: false,
    });
    expect(activity.get("thread-1")).toBe(BigInt(4));
    expect(read.get("thread-1")).toBe(BigInt(1));
  });

  it("advances both clocks for a current mutation receipt", () => {
    const activity = new Map([["thread-1", BigInt(4)]]);
    const read = new Map([["thread-1", BigInt(2)]]);

    expect(mergeStudioTeamCommentMutationReceipt(
      activity,
      read,
      "thread-1",
      BigInt(5)
    )).toEqual({
      activitySequence: BigInt(5),
      readSequence: BigInt(5),
      stale: false,
      fullyRead: true,
    });
  });

  it("keeps newer activity unread when an older mark-read response arrives late", () => {
    const activity = new Map([["thread-1", BigInt(5)]]);
    const read = new Map([["thread-1", BigInt(3)]]);

    expect(mergeStudioTeamCommentReadReceipt(
      activity,
      read,
      "thread-1",
      BigInt(4)
    )).toEqual({
      activitySequence: BigInt(5),
      readSequence: BigInt(4),
      stale: true,
      fullyRead: false,
    });
  });
});
