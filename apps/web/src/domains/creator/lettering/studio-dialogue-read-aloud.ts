/**
 * Browser-native dialogue read-aloud proofing.
 *
 * The pure queue/voice/controller layer deliberately owns no React state, storage,
 * network request, analytics event, or logging. Raw dialogue exists only in the
 * ephemeral queue passed to the browser speech engine and is released on
 * completion, stop, error, or disposal.
 */

import type { DialogueBatchItem } from "./studio-dialogue-batch";

export const DIALOGUE_READ_ALOUD_RATE_MIN = 0.6;
export const DIALOGUE_READ_ALOUD_RATE_MAX = 1.6;
export const DIALOGUE_READ_ALOUD_RATE_DEFAULT = 1;

export type DialogueReadAloudQueueItem = Pick<
  DialogueBatchItem,
  "id" | "pageId" | "pageIndex" | "text"
>;

export type DialogueSpeechVoice = {
  name: string;
  lang: string;
  voiceURI?: string;
  default?: boolean;
  localService?: boolean;
};

export type DialogueSpeechRequest = {
  text: string;
  rate: number;
  voice: DialogueSpeechVoice | null;
  onEnd: () => void;
  onError: () => void;
};

/** Injectable browser capability boundary. Every method reports failure instead of throwing. */
export type DialogueSpeechAdapter = {
  readonly supported: boolean;
  getVoices: () => readonly DialogueSpeechVoice[];
  subscribeVoices?: (listener: () => void) => () => void;
  speak: (request: DialogueSpeechRequest) => boolean;
  cancel: () => boolean;
  pause: () => boolean;
  resume: () => boolean;
};

export type DialogueReadAloudStatus =
  | "unsupported"
  | "idle"
  | "playing"
  | "paused"
  | "completed"
  | "stopped"
  | "error";

/** Playback state intentionally contains identifiers and progress only, never raw dialogue. */
export type DialogueReadAloudPlaybackState = {
  status: DialogueReadAloudStatus;
  currentIndex: number;
  total: number;
  currentItemId: string | null;
  currentPageId: string | null;
  currentPageIndex: number | null;
};

export type DialogueReadAloudPlayOptions = {
  rate?: number;
  voice?: DialogueSpeechVoice | null;
};

export type DialogueReadAloudController = {
  play: (
    queue: readonly DialogueReadAloudQueueItem[],
    options?: DialogueReadAloudPlayOptions
  ) => boolean;
  pause: () => boolean;
  resume: () => boolean;
  stop: () => void;
  /** React effect 재실행에서도 재사용 가능하도록, 상태 알림 없이 현재 큐만 안전하게 해제한다. */
  release: () => void;
  dispose: () => void;
  getState: () => DialogueReadAloudPlaybackState;
};

/**
 * Builds a stable page-ordered proofing queue from the currently shown list.
 * Drafts are read ephemerally without mutating or committing the source items.
 */
export function buildDialogueReadAloudQueue(
  shownItems: readonly DialogueBatchItem[],
  drafts: Readonly<Record<string, string>> = {}
): DialogueReadAloudQueueItem[] {
  return shownItems
    .map((item, sourceIndex) => ({
      item,
      sourceIndex,
      text: drafts[item.id] ?? item.text,
    }))
    .filter(({ text }) => text.trim().length > 0)
    .sort((a, b) => a.item.pageIndex - b.item.pageIndex || a.sourceIndex - b.sourceIndex)
    .map(({ item, text }) => ({
      id: item.id,
      pageId: item.pageId,
      pageIndex: item.pageIndex,
      text,
    }));
}

/** Clamps a playback rate to the intentionally narrow proofing range. */
export function normalizeDialogueReadAloudRate(rate: number): number {
  if (!Number.isFinite(rate)) return DIALOGUE_READ_ALOUD_RATE_DEFAULT;
  const clamped = Math.min(
    DIALOGUE_READ_ALOUD_RATE_MAX,
    Math.max(DIALOGUE_READ_ALOUD_RATE_MIN, rate)
  );
  return Math.round(clamped * 100) / 100;
}

function sameLanguage(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function languageRoot(lang: string): string {
  return lang.trim().toLowerCase().split(/[-_]/, 1)[0] ?? "";
}

export type DialogueVoicePreference = {
  name?: string;
  lang?: string;
};

/** 브라우저가 기기 안에서 처리한다고 명시한 음성만 privacy-safe 기본값으로 본다. */
export function isConfirmedLocalDialogueVoice(voice: DialogueSpeechVoice): boolean {
  return voice.localService === true;
}

/**
 * Chooses a deterministic voice: exact preferred name+language, exact name,
 * exact language, Korean, current locale, default, then the first available.
 */
export function choosePreferredDialogueVoice(
  voices: readonly DialogueSpeechVoice[],
  preference: DialogueVoicePreference = {},
  locale = "ko-KR"
): DialogueSpeechVoice | null {
  if (voices.length === 0) return null;
  const { name, lang } = preference;
  // 같은 조건의 후보라면 확인된 기기 내 음성을 먼저 고른다. 원격/불명 음성을 완전히 허용할지는
  // 호출 UI가 명시적 동의를 받은 뒤 전달할 후보 목록으로 결정한다.
  const rankedVoices = voices
    .map((voice, index) => ({ voice, index }))
    .sort(
      (left, right) =>
        Number(isConfirmedLocalDialogueVoice(right.voice)) -
          Number(isConfirmedLocalDialogueVoice(left.voice)) ||
        left.index - right.index
    )
    .map(({ voice }) => voice);

  if (name && lang) {
    const exactPair = rankedVoices.find(
      (voice) => voice.name === name && sameLanguage(voice.lang, lang)
    );
    if (exactPair) return exactPair;
  }
  if (name) {
    const exactName = rankedVoices.find((voice) => voice.name === name);
    if (exactName) return exactName;
  }
  if (lang) {
    const exactLanguage = rankedVoices.find((voice) => sameLanguage(voice.lang, lang));
    if (exactLanguage) return exactLanguage;
  }

  const exactKorean = rankedVoices.find((voice) => sameLanguage(voice.lang, "ko-KR"));
  if (exactKorean) return exactKorean;
  const korean = rankedVoices.find((voice) => languageRoot(voice.lang) === "ko");
  if (korean) return korean;

  const exactLocale = rankedVoices.find((voice) => sameLanguage(voice.lang, locale));
  if (exactLocale) return exactLocale;
  const localeRoot = languageRoot(locale);
  const localeVoice = rankedVoices.find((voice) => languageRoot(voice.lang) === localeRoot);
  if (localeVoice) return localeVoice;

  return rankedVoices.find((voice) => voice.default) ?? rankedVoices[0] ?? null;
}

/** Stable select value without retaining any dialogue content. */
export function dialogueSpeechVoiceKey(voice: DialogueSpeechVoice): string {
  return `${voice.voiceURI || voice.name}\u0000${voice.lang}`;
}

/** Reads voices from an injected adapter defensively and returns a fresh list. */
export function listDialogueSpeechVoices(
  adapter: DialogueSpeechAdapter
): DialogueSpeechVoice[] {
  if (!adapter.supported) return [];
  try {
    return Array.from(adapter.getVoices());
  } catch {
    return [];
  }
}

type BrowserSpeechScope = {
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
};

const UNSUPPORTED_ADAPTER: DialogueSpeechAdapter = {
  supported: false,
  getVoices: () => [],
  speak: () => false,
  cancel: () => false,
  pause: () => false,
  resume: () => false,
};

/** Creates a no-throw adapter around the optional Web Speech API. */
export function createBrowserDialogueSpeechAdapter(
  injectedScope?: BrowserSpeechScope
): DialogueSpeechAdapter {
  const scope =
    injectedScope ?? (typeof window === "undefined" ? undefined : (window as BrowserSpeechScope));
  const synthesis = scope?.speechSynthesis;
  const Utterance = scope?.SpeechSynthesisUtterance;
  if (!synthesis || typeof Utterance !== "function") return UNSUPPORTED_ADAPTER;

  return {
    supported: true,
    getVoices: () => {
      try {
        return synthesis.getVoices();
      } catch {
        return [];
      }
    },
    subscribeVoices: (listener) => {
      try {
        synthesis.addEventListener("voiceschanged", listener);
        return () => {
          try {
            synthesis.removeEventListener("voiceschanged", listener);
          } catch {
            // Capability disappeared while unmounting; there is nothing left to release.
          }
        };
      } catch {
        return () => undefined;
      }
    },
    speak: (request) => {
      if (!request.text.trim()) return false;
      try {
        const utterance = new Utterance(request.text);
        utterance.rate = normalizeDialogueReadAloudRate(request.rate);
        utterance.lang = request.voice?.lang || "ko-KR";
        if (request.voice) utterance.voice = request.voice as SpeechSynthesisVoice;
        utterance.onend = request.onEnd;
        utterance.onerror = request.onError;
        synthesis.speak(utterance);
        return true;
      } catch {
        return false;
      }
    },
    cancel: () => {
      try {
        synthesis.cancel();
        return true;
      } catch {
        return false;
      }
    },
    pause: () => {
      try {
        synthesis.pause();
        return true;
      } catch {
        return false;
      }
    },
    resume: () => {
      try {
        synthesis.resume();
        return true;
      } catch {
        return false;
      }
    },
  };
}

function createEmptyPlaybackState(supported: boolean): DialogueReadAloudPlaybackState {
  return {
    status: supported ? "idle" : "unsupported",
    currentIndex: -1,
    total: 0,
    currentItemId: null,
    currentPageId: null,
    currentPageIndex: null,
  };
}

/**
 * Sequential queue controller. Adapter faults, stale completion callbacks, and
 * consumer state callbacks are contained so UI event handlers never throw.
 */
export function createDialogueReadAloudController(
  adapter: DialogueSpeechAdapter,
  onStateChange: (state: DialogueReadAloudPlaybackState) => void = () => undefined
): DialogueReadAloudController {
  let disposed = false;
  let runToken = 0;
  let queue: DialogueReadAloudQueueItem[] = [];
  let playOptions: Required<Pick<DialogueReadAloudPlayOptions, "rate">> & {
    voice: DialogueSpeechVoice | null;
  } = { rate: DIALOGUE_READ_ALOUD_RATE_DEFAULT, voice: null };
  let state = createEmptyPlaybackState(adapter.supported);

  const emit = (next: DialogueReadAloudPlaybackState) => {
    state = next;
    if (disposed) return;
    try {
      onStateChange(next);
    } catch {
      // Rendering callbacks are outside the speech engine's trust boundary.
    }
  };

  const safeAdapterCall = (call: () => boolean): boolean => {
    try {
      return call();
    } catch {
      return false;
    }
  };

  const fail = (token: number, index: number) => {
    if (disposed || token !== runToken) return;
    runToken += 1;
    safeAdapterCall(adapter.cancel);
    const total = queue.length;
    const item = queue[index];
    queue = [];
    emit({
      status: "error",
      currentIndex: index,
      total,
      currentItemId: item?.id ?? null,
      currentPageId: item?.pageId ?? null,
      currentPageIndex: item?.pageIndex ?? null,
    });
  };

  const speakAt = (token: number, index: number) => {
    if (disposed || token !== runToken) return;
    const item = queue[index];
    if (!item) {
      const total = queue.length;
      const previous = queue[total - 1];
      queue = [];
      emit({
        status: "completed",
        currentIndex: total - 1,
        total,
        currentItemId: previous?.id ?? null,
        currentPageId: previous?.pageId ?? null,
        currentPageIndex: previous?.pageIndex ?? null,
      });
      return;
    }

    emit({
      status: "playing",
      currentIndex: index,
      total: queue.length,
      currentItemId: item.id,
      currentPageId: item.pageId,
      currentPageIndex: item.pageIndex,
    });
    const started = safeAdapterCall(() =>
      adapter.speak({
        text: item.text,
        rate: playOptions.rate,
        voice: playOptions.voice,
        onEnd: () => speakAt(token, index + 1),
        onError: () => fail(token, index),
      })
    );
    if (!started) fail(token, index);
  };

  return {
    play: (nextQueue, options = {}) => {
      if (disposed) return false;
      runToken += 1;
      const token = runToken;
      // Browser engines commonly retain an old utterance; always clear it first.
      safeAdapterCall(adapter.cancel);
      queue = nextQueue
        .filter((item) => item.text.trim().length > 0)
        .map((item) => ({ ...item }));

      if (!adapter.supported) {
        queue = [];
        emit(createEmptyPlaybackState(false));
        return false;
      }
      if (queue.length === 0) {
        emit(createEmptyPlaybackState(true));
        return false;
      }

      playOptions = {
        rate: normalizeDialogueReadAloudRate(options.rate ?? DIALOGUE_READ_ALOUD_RATE_DEFAULT),
        voice: options.voice ?? null,
      };
      speakAt(token, 0);
      return state.status === "playing" || state.status === "completed";
    },
    pause: () => {
      if (disposed || state.status !== "playing") return false;
      if (!safeAdapterCall(adapter.pause)) return false;
      emit({ ...state, status: "paused" });
      return true;
    },
    resume: () => {
      if (disposed || state.status !== "paused") return false;
      if (!safeAdapterCall(adapter.resume)) return false;
      emit({ ...state, status: "playing" });
      return true;
    },
    stop: () => {
      if (disposed) return;
      runToken += 1;
      safeAdapterCall(adapter.cancel);
      queue = [];
      emit({ ...state, status: adapter.supported ? "stopped" : "unsupported" });
    },
    release: () => {
      if (disposed) return;
      runToken += 1;
      safeAdapterCall(adapter.cancel);
      queue = [];
      state = createEmptyPlaybackState(adapter.supported);
    },
    dispose: () => {
      if (disposed) return;
      runToken += 1;
      safeAdapterCall(adapter.cancel);
      queue = [];
      disposed = true;
    },
    getState: () => ({ ...state }),
  };
}
