import { describe, expect, it } from "vitest";

import {
  STUDIO_LIVE_ATTENTION_FALLBACK_TEXT,
  STUDIO_LIVE_ATTENTION_VISIBLE_MS,
  STUDIO_LIVE_CURSOR_CHAT_MAX_LENGTH,
  createStudioLiveAttentionMessageId,
  createStudioLiveCursorChatMessageId,
  isStudioLiveChatControlMessageId,
  parseStudioLiveChatControl,
} from "./studio-live-chat-control";

describe("studio live chat controls", () => {
  it("parses a bounded ephemeral cursor-chat message", () => {
    const receivedAt = 1_780_000_000_000;
    const messageId = createStudioLiveCursorChatMessageId("cursor-1");

    expect(isStudioLiveChatControlMessageId(messageId)).toBe(true);
    expect(
      parseStudioLiveChatControl({
        messageId,
        text: "이 컷의 표정만 조금 더 크게요",
        receivedAt,
      })
    ).toEqual({
      kind: "cursor-chat",
      controlId: "cursor-1",
      expiresAt: receivedAt + 5_000,
      text: "이 컷의 표정만 조금 더 크게요",
    });
  });

  it("rejects malformed cursor chat without widening the room chat contract", () => {
    expect(() => createStudioLiveCursorChatMessageId("not:canonical")).toThrow();
    expect(
      parseStudioLiveChatControl({
        messageId: createStudioLiveCursorChatMessageId("cursor-2"),
        text: "가".repeat(STUDIO_LIVE_CURSOR_CHAT_MAX_LENGTH + 1),
        receivedAt: 100,
      })
    ).toBeNull();
  });

  it("encodes a readable attention fallback while enforcing a short expiry", () => {
    const receivedAt = 1_780_000_000_000;
    const expiresAt = receivedAt + STUDIO_LIVE_ATTENTION_VISIBLE_MS;
    const messageId = createStudioLiveAttentionMessageId("attention-1", expiresAt);

    expect(
      parseStudioLiveChatControl({
        messageId,
        text: STUDIO_LIVE_ATTENTION_FALLBACK_TEXT,
        receivedAt,
      })
    ).toEqual({
      kind: "attention",
      requestId: "attention-1",
      expiresAt,
    });
    expect(
      parseStudioLiveChatControl({
        messageId,
        text: STUDIO_LIVE_ATTENTION_FALLBACK_TEXT,
        receivedAt: expiresAt,
      })
    ).toBeNull();
    expect(
      parseStudioLiveChatControl({
        messageId,
        text: "spoofed",
        receivedAt,
      })
    ).toBeNull();
  });
});
