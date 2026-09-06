import { describe, expect, it } from "vitest";

import {
  STUDIO_LIVE_FACILITATION_POLL_CLOSE_FALLBACK_TEXT,
  STUDIO_LIVE_FACILITATION_POLL_VOTE_FALLBACK_TEXT,
  STUDIO_LIVE_FACILITATION_TIMER_FALLBACK_TEXT,
  createStudioLiveFacilitationPollCloseMessage,
  createStudioLiveFacilitationPollOpenMessage,
  createStudioLiveFacilitationPollVoteMessage,
  createStudioLiveFacilitationReactionMessage,
  createStudioLiveFacilitationTimerMessage,
  isStudioLiveFacilitationControlMessageId,
  parseStudioLiveFacilitationControl,
  studioLiveFacilitationControlAccess,
} from "./studio-live-facilitation-control";

const RECEIVED_AT = 1_800_000_000_000;

describe("studio live facilitation controls", () => {
  it("round-trips bounded timer snapshots without relying on synchronized clocks", () => {
    const message = createStudioLiveFacilitationTimerMessage({
      timerId: "timer-1",
      commandId: "command-1",
      status: "running",
      remainingMs: 15 * 60_000,
    });

    expect(message.text).toBe(STUDIO_LIVE_FACILITATION_TIMER_FALLBACK_TEXT);
    expect(
      parseStudioLiveFacilitationControl({ ...message, receivedAt: RECEIVED_AT })
    ).toEqual({
      kind: "timer",
      timerId: "timer-1",
      commandId: "command-1",
      status: "running",
      remainingMs: 15 * 60_000,
    });
    expect(() =>
      createStudioLiveFacilitationTimerMessage({
        timerId: "timer-1",
        commandId: "command-2",
        status: "running",
        remainingMs: 6_000_000,
      })
    ).toThrow(/99분 59초/u);
  });

  it("round-trips a human-readable poll and rejects ambiguous or tampered options", () => {
    const message = createStudioLiveFacilitationPollOpenMessage({
      pollId: "poll-1",
      commandId: "command-1",
      question: "다음 컷의 조명 방향은?",
      options: ["왼쪽", "오른쪽", "정면"],
    });

    expect(message.text).toContain("📊 빠른 투표\n다음 컷의 조명 방향은?");
    expect(
      parseStudioLiveFacilitationControl({ ...message, receivedAt: RECEIVED_AT })
    ).toEqual({
      kind: "poll-open",
      pollId: "poll-1",
      commandId: "command-1",
      question: "다음 컷의 조명 방향은?",
      options: ["왼쪽", "오른쪽", "정면"],
    });
    expect(
      parseStudioLiveFacilitationControl({
        ...message,
        text: message.text.replace("2. 오른쪽", "3. 오른쪽"),
        receivedAt: RECEIVED_AT,
      })
    ).toBeNull();
    expect(() =>
      createStudioLiveFacilitationPollOpenMessage({
        pollId: "poll-2",
        commandId: "command-2",
        question: "중복 선택지",
        options: ["유지", " 유지 "],
      })
    ).toThrow(/서로 다른/u);
  });

  it("separates facilitator commands from audience vote and reaction controls", () => {
    const voteMessage = createStudioLiveFacilitationPollVoteMessage({
      pollId: "poll-1",
      commandId: "vote-1",
      optionIndex: 2,
    });
    const closeMessage = createStudioLiveFacilitationPollCloseMessage({
      pollId: "poll-1",
      commandId: "close-1",
    });
    const reactionMessage = createStudioLiveFacilitationReactionMessage({
      controlId: "reaction-1",
      reaction: "celebrate",
    });

    const vote = parseStudioLiveFacilitationControl({
      ...voteMessage,
      receivedAt: RECEIVED_AT,
    });
    const close = parseStudioLiveFacilitationControl({
      ...closeMessage,
      receivedAt: RECEIVED_AT,
    });
    const reaction = parseStudioLiveFacilitationControl({
      ...reactionMessage,
      receivedAt: RECEIVED_AT,
    });

    expect(voteMessage.text).toBe(STUDIO_LIVE_FACILITATION_POLL_VOTE_FALLBACK_TEXT);
    expect(closeMessage.text).toBe(STUDIO_LIVE_FACILITATION_POLL_CLOSE_FALLBACK_TEXT);
    expect(vote && studioLiveFacilitationControlAccess(vote)).toBe("participant");
    expect(reaction && studioLiveFacilitationControlAccess(reaction)).toBe("participant");
    expect(close && studioLiveFacilitationControlAccess(close)).toBe("facilitator");
    expect(reaction).toMatchObject({
      kind: "reaction",
      reaction: "celebrate",
      expiresAt: RECEIVED_AT + 5_000,
    });
  });

  it("reserves malformed facilitation ids so they can never downgrade into visible room chat", () => {
    const malformed = {
      messageId: "live-fac:poll-vote:poll-1:vote-1:9",
      text: STUDIO_LIVE_FACILITATION_POLL_VOTE_FALLBACK_TEXT,
      receivedAt: RECEIVED_AT,
    };
    expect(isStudioLiveFacilitationControlMessageId(malformed.messageId)).toBe(true);
    expect(parseStudioLiveFacilitationControl(malformed)).toBeNull();
  });
});
