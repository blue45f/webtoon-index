export const STUDIO_LIVE_FACILITATION_TIMER_MAX_MS = 5_999_000;
export const STUDIO_LIVE_FACILITATION_TIMER_MIN_MS = 1_000;
export const STUDIO_LIVE_FACILITATION_REACTION_VISIBLE_MS = 5_000;
export const STUDIO_LIVE_FACILITATION_POLL_QUESTION_MAX_LENGTH = 120;
export const STUDIO_LIVE_FACILITATION_POLL_OPTION_MAX_LENGTH = 48;
export const STUDIO_LIVE_FACILITATION_POLL_OPTION_MIN_COUNT = 2;
export const STUDIO_LIVE_FACILITATION_POLL_OPTION_MAX_COUNT = 6;

export const STUDIO_LIVE_FACILITATION_REACTIONS = [
  "like",
  "love",
  "celebrate",
  "agree",
  "laugh",
  "wow",
] as const;

export type StudioLiveFacilitationReactionKind =
  (typeof STUDIO_LIVE_FACILITATION_REACTIONS)[number];

export type StudioLiveFacilitationTimerStatus = "running" | "paused" | "stopped";

export type StudioLiveFacilitationControl =
  | {
      kind: "timer";
      timerId: string;
      commandId: string;
      status: StudioLiveFacilitationTimerStatus;
      remainingMs: number;
    }
  | {
      kind: "poll-open";
      pollId: string;
      commandId: string;
      question: string;
      options: readonly string[];
    }
  | {
      kind: "poll-vote";
      pollId: string;
      commandId: string;
      optionIndex: number;
    }
  | {
      kind: "poll-close";
      pollId: string;
      commandId: string;
    }
  | {
      kind: "reaction";
      controlId: string;
      reaction: StudioLiveFacilitationReactionKind;
      expiresAt: number;
    };

export type StudioLiveFacilitationControlAccess = "facilitator" | "participant";

export const STUDIO_LIVE_FACILITATION_TIMER_FALLBACK_TEXT =
  "⏱ 공동작업 타이머가 업데이트되었습니다.";
export const STUDIO_LIVE_FACILITATION_POLL_CLOSE_FALLBACK_TEXT =
  "📊 빠른 투표가 종료되었습니다.";
export const STUDIO_LIVE_FACILITATION_POLL_VOTE_FALLBACK_TEXT =
  "📊 빠른 투표에 응답했습니다.";

const FACILITATION_ID_PREFIX = "live-fac:";
const TIMER_ID_PREFIX = `${FACILITATION_ID_PREFIX}timer:`;
const POLL_OPEN_ID_PREFIX = `${FACILITATION_ID_PREFIX}poll-open:`;
const POLL_VOTE_ID_PREFIX = `${FACILITATION_ID_PREFIX}poll-vote:`;
const POLL_CLOSE_ID_PREFIX = `${FACILITATION_ID_PREFIX}poll-close:`;
const REACTION_ID_PREFIX = `${FACILITATION_ID_PREFIX}reaction:`;
const CONTROL_ID_PATTERN = /^[A-Za-z0-9._-]{1,48}$/u;
const POLL_HEADER = "📊 빠른 투표";

const TIMER_STATUS_TO_TOKEN: Readonly<Record<StudioLiveFacilitationTimerStatus, string>> = {
  running: "r",
  paused: "p",
  stopped: "s",
};

const TIMER_TOKEN_TO_STATUS: Readonly<Record<string, StudioLiveFacilitationTimerStatus>> = {
  r: "running",
  p: "paused",
  s: "stopped",
};

export const STUDIO_LIVE_FACILITATION_REACTION_EMOJI: Readonly<
  Record<StudioLiveFacilitationReactionKind, string>
> = {
  like: "👍",
  love: "❤️",
  celebrate: "🎉",
  agree: "✅",
  laugh: "😂",
  wow: "😮",
};

function canonicalControlId(value: string): string {
  const normalized = value.trim();
  if (!CONTROL_ID_PATTERN.test(normalized)) {
    throw new Error("유효한 퍼실리테이션 제어 식별자가 필요합니다.");
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

function canonicalText(value: string, maximumLength: number, label: string): string {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!normalized || normalized.length > maximumLength || hasControlCharacter(normalized)) {
    throw new Error(`${label}이(가) 올바르지 않습니다.`);
  }
  return normalized;
}

function canonicalBase36Integer(value: string): number | null {
  if (!/^[0-9a-z]+$/u.test(value)) return null;
  const parsed = Number.parseInt(value, 36);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed.toString(36) === value ? parsed : null;
}

function canonicalTimerRemaining(
  status: StudioLiveFacilitationTimerStatus,
  remainingMs: number
): number {
  if (!Number.isFinite(remainingMs)) {
    throw new Error("유효한 타이머 잔여 시간이 필요합니다.");
  }
  const normalized = Math.trunc(remainingMs);
  if (status === "stopped") {
    if (normalized !== 0) throw new Error("종료된 타이머 잔여 시간은 0이어야 합니다.");
    return 0;
  }
  if (
    normalized < STUDIO_LIVE_FACILITATION_TIMER_MIN_MS ||
    normalized > STUDIO_LIVE_FACILITATION_TIMER_MAX_MS
  ) {
    throw new Error("타이머 시간은 1초에서 99분 59초 사이여야 합니다.");
  }
  return normalized;
}

function canonicalPoll(question: string, options: readonly string[]) {
  const normalizedQuestion = canonicalText(
    question,
    STUDIO_LIVE_FACILITATION_POLL_QUESTION_MAX_LENGTH,
    "투표 질문"
  );
  if (
    options.length < STUDIO_LIVE_FACILITATION_POLL_OPTION_MIN_COUNT ||
    options.length > STUDIO_LIVE_FACILITATION_POLL_OPTION_MAX_COUNT
  ) {
    throw new Error("투표 선택지는 2개에서 6개까지 필요합니다.");
  }
  const normalizedOptions = options.map((option) =>
    canonicalText(option, STUDIO_LIVE_FACILITATION_POLL_OPTION_MAX_LENGTH, "투표 선택지")
  );
  const unique = new Set(normalizedOptions.map((option) => option.toLocaleLowerCase("ko-KR")));
  if (unique.size !== normalizedOptions.length) {
    throw new Error("서로 다른 투표 선택지가 필요합니다.");
  }
  return { question: normalizedQuestion, options: normalizedOptions } as const;
}

function splitControlId(messageId: string, prefix: string, segmentCount: number): string[] | null {
  if (!messageId.startsWith(prefix)) return null;
  const segments = messageId.slice(prefix.length).split(":");
  if (segments.length !== segmentCount || segments.some((segment) => segment.length === 0)) {
    return null;
  }
  return segments;
}

function reactionFallbackText(reaction: StudioLiveFacilitationReactionKind): string {
  return `${STUDIO_LIVE_FACILITATION_REACTION_EMOJI[reaction]} 빠른 리액션`;
}

export function createStudioLiveFacilitationTimerMessage(input: {
  timerId: string;
  commandId: string;
  status: StudioLiveFacilitationTimerStatus;
  remainingMs: number;
}): { messageId: string; text: string } {
  const timerId = canonicalControlId(input.timerId);
  const commandId = canonicalControlId(input.commandId);
  const remainingMs = canonicalTimerRemaining(input.status, input.remainingMs);
  return {
    messageId: `${TIMER_ID_PREFIX}${timerId}:${commandId}:${TIMER_STATUS_TO_TOKEN[input.status]}:${remainingMs.toString(36)}`,
    text: STUDIO_LIVE_FACILITATION_TIMER_FALLBACK_TEXT,
  };
}

export function createStudioLiveFacilitationPollOpenMessage(input: {
  pollId: string;
  commandId: string;
  question: string;
  options: readonly string[];
}): { messageId: string; text: string } {
  const pollId = canonicalControlId(input.pollId);
  const commandId = canonicalControlId(input.commandId);
  const poll = canonicalPoll(input.question, input.options);
  return {
    messageId: `${POLL_OPEN_ID_PREFIX}${pollId}:${commandId}`,
    text: [
      POLL_HEADER,
      poll.question,
      ...poll.options.map((option, index) => `${index + 1}. ${option}`),
    ].join("\n"),
  };
}

export function createStudioLiveFacilitationPollVoteMessage(input: {
  pollId: string;
  commandId: string;
  optionIndex: number;
}): { messageId: string; text: string } {
  const pollId = canonicalControlId(input.pollId);
  const commandId = canonicalControlId(input.commandId);
  if (!Number.isInteger(input.optionIndex) || input.optionIndex < 0 || input.optionIndex >= 6) {
    throw new Error("유효한 투표 선택지 번호가 필요합니다.");
  }
  return {
    messageId: `${POLL_VOTE_ID_PREFIX}${pollId}:${commandId}:${input.optionIndex.toString(36)}`,
    text: STUDIO_LIVE_FACILITATION_POLL_VOTE_FALLBACK_TEXT,
  };
}

export function createStudioLiveFacilitationPollCloseMessage(input: {
  pollId: string;
  commandId: string;
}): { messageId: string; text: string } {
  const pollId = canonicalControlId(input.pollId);
  const commandId = canonicalControlId(input.commandId);
  return {
    messageId: `${POLL_CLOSE_ID_PREFIX}${pollId}:${commandId}`,
    text: STUDIO_LIVE_FACILITATION_POLL_CLOSE_FALLBACK_TEXT,
  };
}

export function createStudioLiveFacilitationReactionMessage(input: {
  controlId: string;
  reaction: StudioLiveFacilitationReactionKind;
}): { messageId: string; text: string } {
  const controlId = canonicalControlId(input.controlId);
  if (!STUDIO_LIVE_FACILITATION_REACTIONS.includes(input.reaction)) {
    throw new Error("지원하는 빠른 리액션이 필요합니다.");
  }
  return {
    messageId: `${REACTION_ID_PREFIX}${controlId}:${input.reaction}`,
    text: reactionFallbackText(input.reaction),
  };
}

export function parseStudioLiveFacilitationControl(input: {
  messageId: string;
  text: string;
  receivedAt: number;
}): StudioLiveFacilitationControl | null {
  if (!Number.isFinite(input.receivedAt)) return null;

  const timerSegments = splitControlId(input.messageId, TIMER_ID_PREFIX, 4);
  if (timerSegments) {
    const [timerId, commandId, statusToken, remainingToken] = timerSegments;
    const status = TIMER_TOKEN_TO_STATUS[statusToken ?? ""];
    const remainingMs = canonicalBase36Integer(remainingToken ?? "");
    if (
      !CONTROL_ID_PATTERN.test(timerId ?? "") ||
      !CONTROL_ID_PATTERN.test(commandId ?? "") ||
      !status ||
      remainingMs === null ||
      input.text !== STUDIO_LIVE_FACILITATION_TIMER_FALLBACK_TEXT
    ) {
      return null;
    }
    try {
      return {
        kind: "timer",
        timerId: timerId!,
        commandId: commandId!,
        status,
        remainingMs: canonicalTimerRemaining(status, remainingMs),
      };
    } catch {
      return null;
    }
  }

  const pollOpenSegments = splitControlId(input.messageId, POLL_OPEN_ID_PREFIX, 2);
  if (pollOpenSegments) {
    const [pollId, commandId] = pollOpenSegments;
    if (!CONTROL_ID_PATTERN.test(pollId ?? "") || !CONTROL_ID_PATTERN.test(commandId ?? "")) {
      return null;
    }
    const lines = input.text.split("\n");
    if (
      lines[0] !== POLL_HEADER ||
      lines.length < STUDIO_LIVE_FACILITATION_POLL_OPTION_MIN_COUNT + 2 ||
      lines.length > STUDIO_LIVE_FACILITATION_POLL_OPTION_MAX_COUNT + 2
    ) {
      return null;
    }
    const question = lines[1] ?? "";
    const options = lines.slice(2).map((line, index) => {
      const prefix = `${index + 1}. `;
      return line.startsWith(prefix) ? line.slice(prefix.length) : "";
    });
    try {
      const poll = canonicalPoll(question, options);
      const expectedText = [
        POLL_HEADER,
        poll.question,
        ...poll.options.map((option, index) => `${index + 1}. ${option}`),
      ].join("\n");
      if (expectedText !== input.text) return null;
      return {
        kind: "poll-open",
        pollId: pollId!,
        commandId: commandId!,
        question: poll.question,
        options: poll.options,
      };
    } catch {
      return null;
    }
  }

  const pollVoteSegments = splitControlId(input.messageId, POLL_VOTE_ID_PREFIX, 3);
  if (pollVoteSegments) {
    const [pollId, commandId, optionToken] = pollVoteSegments;
    const optionIndex = canonicalBase36Integer(optionToken ?? "");
    if (
      !CONTROL_ID_PATTERN.test(pollId ?? "") ||
      !CONTROL_ID_PATTERN.test(commandId ?? "") ||
      optionIndex === null ||
      optionIndex >= STUDIO_LIVE_FACILITATION_POLL_OPTION_MAX_COUNT ||
      input.text !== STUDIO_LIVE_FACILITATION_POLL_VOTE_FALLBACK_TEXT
    ) {
      return null;
    }
    return {
      kind: "poll-vote",
      pollId: pollId!,
      commandId: commandId!,
      optionIndex,
    };
  }

  const pollCloseSegments = splitControlId(input.messageId, POLL_CLOSE_ID_PREFIX, 2);
  if (pollCloseSegments) {
    const [pollId, commandId] = pollCloseSegments;
    if (
      !CONTROL_ID_PATTERN.test(pollId ?? "") ||
      !CONTROL_ID_PATTERN.test(commandId ?? "") ||
      input.text !== STUDIO_LIVE_FACILITATION_POLL_CLOSE_FALLBACK_TEXT
    ) {
      return null;
    }
    return { kind: "poll-close", pollId: pollId!, commandId: commandId! };
  }

  const reactionSegments = splitControlId(input.messageId, REACTION_ID_PREFIX, 2);
  if (reactionSegments) {
    const [controlId, reactionToken] = reactionSegments;
    const reaction = STUDIO_LIVE_FACILITATION_REACTIONS.find(
      (candidate) => candidate === reactionToken
    );
    if (
      !CONTROL_ID_PATTERN.test(controlId ?? "") ||
      !reaction ||
      input.text !== reactionFallbackText(reaction)
    ) {
      return null;
    }
    return {
      kind: "reaction",
      controlId: controlId!,
      reaction,
      expiresAt: input.receivedAt + STUDIO_LIVE_FACILITATION_REACTION_VISIBLE_MS,
    };
  }

  return null;
}

export function isStudioLiveFacilitationControlMessageId(messageId: string): boolean {
  return messageId.startsWith(FACILITATION_ID_PREFIX);
}

export function studioLiveFacilitationControlAccess(
  control: StudioLiveFacilitationControl
): StudioLiveFacilitationControlAccess {
  return control.kind === "poll-vote" || control.kind === "reaction"
    ? "participant"
    : "facilitator";
}
