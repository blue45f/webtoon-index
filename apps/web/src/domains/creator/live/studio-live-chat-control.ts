export const STUDIO_LIVE_CURSOR_CHAT_MAX_LENGTH = 80;
export const STUDIO_LIVE_CURSOR_CHAT_VISIBLE_MS = 5_000;
export const STUDIO_LIVE_ATTENTION_VISIBLE_MS = 12_000;
export const STUDIO_LIVE_ATTENTION_CLOCK_SKEW_MS = 5_000;

/**
 * Human-readable fallback for a rolling deployment. Older clients render this as an ordinary
 * ephemeral room-chat line; v19 clients identify the metadata in messageId and show a follow CTA.
 */
export const STUDIO_LIVE_ATTENTION_FALLBACK_TEXT =
  "📍 현재 작업 위치로 초대했습니다. 참여자 메뉴에서 보낸 사람을 따라가세요.";

const CURSOR_CHAT_ID_PREFIX = "live-cursor-chat:";
const ATTENTION_ID_PREFIX = "live-attention:";
const CONTROL_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/u;

export type StudioLiveChatControl =
  | {
      kind: "cursor-chat";
      controlId: string;
      expiresAt: number;
      text: string;
    }
  | {
      kind: "attention";
      requestId: string;
      expiresAt: number;
    };

function canonicalControlId(value: string): string {
  const normalized = value.trim();
  if (!CONTROL_ID_PATTERN.test(normalized)) {
    throw new Error("유효한 실시간 협업 제어 식별자가 필요합니다.");
  }
  return normalized;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  }
  return false;
}

function canonicalBase36Integer(value: string): number | null {
  if (!/^[0-9a-z]+$/u.test(value)) return null;
  const parsed = Number.parseInt(value, 36);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed.toString(36) === value ? parsed : null;
}

export function createStudioLiveCursorChatMessageId(controlId: string): string {
  return `${CURSOR_CHAT_ID_PREFIX}${canonicalControlId(controlId)}`;
}

export function createStudioLiveAttentionMessageId(
  requestId: string,
  expiresAt: number
): string {
  if (!Number.isSafeInteger(expiresAt) || expiresAt < 0) {
    throw new Error("유효한 집중 요청 만료 시각이 필요합니다.");
  }
  return `${ATTENTION_ID_PREFIX}${canonicalControlId(requestId)}:${expiresAt.toString(36)}`;
}

export function parseStudioLiveChatControl(input: {
  messageId: string;
  text: string;
  receivedAt: number;
}): StudioLiveChatControl | null {
  const { messageId, receivedAt } = input;
  if (!Number.isFinite(receivedAt)) return null;

  if (messageId.startsWith(CURSOR_CHAT_ID_PREFIX)) {
    const controlId = messageId.slice(CURSOR_CHAT_ID_PREFIX.length);
    const text = input.text.trim();
    if (
      !CONTROL_ID_PATTERN.test(controlId) ||
      text.length === 0 ||
      text.length > STUDIO_LIVE_CURSOR_CHAT_MAX_LENGTH ||
      hasControlCharacter(text)
    ) {
      return null;
    }
    return {
      kind: "cursor-chat",
      controlId,
      expiresAt: receivedAt + STUDIO_LIVE_CURSOR_CHAT_VISIBLE_MS,
      text,
    };
  }

  if (!messageId.startsWith(ATTENTION_ID_PREFIX)) return null;
  if (input.text !== STUDIO_LIVE_ATTENTION_FALLBACK_TEXT) return null;
  const metadata = messageId.slice(ATTENTION_ID_PREFIX.length);
  const separatorIndex = metadata.lastIndexOf(":");
  if (separatorIndex <= 0) return null;
  const requestId = metadata.slice(0, separatorIndex);
  const expiresAt = canonicalBase36Integer(metadata.slice(separatorIndex + 1));
  if (!CONTROL_ID_PATTERN.test(requestId) || expiresAt === null) return null;
  if (
    expiresAt <= receivedAt ||
    expiresAt >
      receivedAt + STUDIO_LIVE_ATTENTION_VISIBLE_MS + STUDIO_LIVE_ATTENTION_CLOCK_SKEW_MS
  ) {
    return null;
  }
  return { kind: "attention", requestId, expiresAt };
}

export function isStudioLiveChatControlMessageId(messageId: string): boolean {
  return (
    messageId.startsWith(CURSOR_CHAT_ID_PREFIX) ||
    messageId.startsWith(ATTENTION_ID_PREFIX)
  );
}
