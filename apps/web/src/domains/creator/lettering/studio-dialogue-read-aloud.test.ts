import { describe, expect, it, vi } from "vitest";

import {
  buildDialogueReadAloudQueue,
  choosePreferredDialogueVoice,
  createBrowserDialogueSpeechAdapter,
  createDialogueReadAloudController,
  listDialogueSpeechVoices,
  normalizeDialogueReadAloudRate,
  type DialogueReadAloudPlaybackState,
  type DialogueSpeechAdapter,
  type DialogueSpeechRequest,
  type DialogueSpeechVoice,
} from "./studio-dialogue-read-aloud";

import type { DialogueBatchItem } from "./studio-dialogue-batch";

const ITEM_BASE = {
  elType: "bubble",
  variant: "speech",
  hidden: false,
  locked: false,
} as const;

function item(
  id: string,
  pageId: string,
  pageIndex: number,
  text: string
): DialogueBatchItem {
  return { ...ITEM_BASE, id, pageId, pageIndex, text };
}

function voice(name: string, lang: string, options: Partial<DialogueSpeechVoice> = {}) {
  return { name, lang, voiceURI: `${name}-${lang}`, ...options };
}

function createAdapter(
  overrides: Partial<DialogueSpeechAdapter> = {}
): DialogueSpeechAdapter & { requests: DialogueSpeechRequest[]; calls: string[] } {
  const requests: DialogueSpeechRequest[] = [];
  const calls: string[] = [];
  return {
    supported: true,
    requests,
    calls,
    getVoices: () => [],
    speak: (request) => {
      calls.push(`speak:${request.text}`);
      requests.push(request);
      return true;
    },
    cancel: () => {
      calls.push("cancel");
      return true;
    },
    pause: () => {
      calls.push("pause");
      return true;
    },
    resume: () => {
      calls.push("resume");
      return true;
    },
    ...overrides,
  };
}

describe("dialogue read-aloud queue", () => {
  it("builds a page-ordered queue, excludes whitespace, uses drafts, and preserves input", () => {
    const source = [
      item("late", "page-2", 1, "  둘째 페이지  "),
      item("blank", "page-1", 0, " \n "),
      item("early", "page-1", 0, "원본"),
    ];
    const snapshot = structuredClone(source);

    const queue = buildDialogueReadAloudQueue(source, {
      early: "수정 중인 임시 대사",
      blank: "\t",
    });

    expect(queue).toEqual([
      {
        id: "early",
        pageId: "page-1",
        pageIndex: 0,
        text: "수정 중인 임시 대사",
      },
      {
        id: "late",
        pageId: "page-2",
        pageIndex: 1,
        text: "  둘째 페이지  ",
      },
    ]);
    expect(source).toEqual(snapshot);
    expect(queue[0]).not.toBe(source[2]);
  });

  it("normalizes invalid and out-of-range proofing rates", () => {
    expect(normalizeDialogueReadAloudRate(Number.NaN)).toBe(1);
    expect(normalizeDialogueReadAloudRate(0.1)).toBe(0.6);
    expect(normalizeDialogueReadAloudRate(1.234)).toBe(1.23);
    expect(normalizeDialogueReadAloudRate(9)).toBe(1.6);
  });
});

describe("dialogue voice preference", () => {
  const voices = [
    voice("System English", "en-US", { default: true }),
    voice("한국어 기본", "ko-KR"),
    voice("한국어 부산", "ko-KP"),
    voice("English UK", "en-GB"),
  ];

  it("honors an exact preferred name and language before fallbacks", () => {
    expect(
      choosePreferredDialogueVoice(voices, { name: "English UK", lang: "en-GB" }, "en-US")
    ).toBe(voices[3]);
  });

  it("falls back to exact Korean, then the active locale, then the default voice", () => {
    expect(choosePreferredDialogueVoice(voices, {}, "en-US")).toBe(voices[1]);
    expect(
      choosePreferredDialogueVoice(
        [voice("French", "fr-FR"), voice("English", "en-GB")],
        {},
        "en-AU"
      )?.name
    ).toBe("English");
    expect(
      choosePreferredDialogueVoice(
        [voice("French", "fr-FR"), voice("Default", "de-DE", { default: true })],
        {},
        "en-US"
      )?.name
    ).toBe("Default");
  });

  it("prefers a confirmed device-local voice over an earlier remote or unknown language match", () => {
    const candidates = [
      voice("온라인 한국어", "ko-KR", { localService: false }),
      voice("출처 불명 한국어", "ko-KR"),
      voice("기기 내 한국어", "ko-KR", { localService: true }),
    ];

    expect(choosePreferredDialogueVoice(candidates, { lang: "ko-KR" })?.name).toBe(
      "기기 내 한국어"
    );
  });

  it("contains voice-enumeration faults and exposes an unsupported adapter safely", () => {
    const broken = createAdapter({
      getVoices: () => {
        throw new Error("voice enumeration failed");
      },
    });

    expect(listDialogueSpeechVoices(broken)).toEqual([]);
    expect(createBrowserDialogueSpeechAdapter({}).supported).toBe(false);
  });
});

describe("dialogue read-aloud controller", () => {
  it("cancels first, reads sequentially, reports progress, and releases on completion", () => {
    const adapter = createAdapter();
    const states: DialogueReadAloudPlaybackState[] = [];
    const controller = createDialogueReadAloudController(adapter, (state) => states.push(state));
    const selectedVoice = voice("한국어", "ko-KR");

    expect(
      controller.play(
        [
          { id: "a", pageId: "p1", pageIndex: 0, text: "첫 대사" },
          { id: "b", pageId: "p2", pageIndex: 1, text: "둘째 대사" },
        ],
        { rate: 8, voice: selectedVoice }
      )
    ).toBe(true);
    expect(adapter.calls.slice(0, 2)).toEqual(["cancel", "speak:첫 대사"]);
    expect(adapter.requests[0]?.rate).toBe(1.6);
    expect(adapter.requests[0]?.voice).toBe(selectedVoice);
    expect(controller.getState()).toMatchObject({
      status: "playing",
      currentIndex: 0,
      total: 2,
      currentItemId: "a",
    });

    adapter.requests[0]?.onEnd();
    expect(adapter.calls.at(-1)).toBe("speak:둘째 대사");
    expect(controller.getState()).toMatchObject({ currentIndex: 1, currentItemId: "b" });

    adapter.requests[1]?.onEnd();
    expect(controller.getState()).toMatchObject({
      status: "completed",
      currentIndex: 1,
      total: 2,
      currentItemId: "b",
    });
    expect(states.map((state) => state.status)).toEqual(["playing", "playing", "completed"]);
  });

  it("pauses, resumes, stops, and ignores stale completion callbacks", () => {
    const adapter = createAdapter();
    const controller = createDialogueReadAloudController(adapter);
    controller.play([{ id: "a", pageId: "p1", pageIndex: 0, text: "대사" }]);
    const staleEnd = adapter.requests[0]?.onEnd;

    expect(controller.pause()).toBe(true);
    expect(controller.getState().status).toBe("paused");
    expect(controller.resume()).toBe(true);
    expect(controller.getState().status).toBe("playing");
    controller.stop();
    expect(controller.getState().status).toBe("stopped");
    const callCount = adapter.calls.length;
    staleEnd?.();
    expect(adapter.calls).toHaveLength(callCount);
  });

  it("releases an active queue silently and remains reusable after an effect replay", () => {
    const adapter = createAdapter();
    const states: DialogueReadAloudPlaybackState[] = [];
    const controller = createDialogueReadAloudController(adapter, (state) => states.push(state));
    controller.play([{ id: "a", pageId: "p1", pageIndex: 0, text: "첫 대사" }]);
    const staleEnd = adapter.requests[0]?.onEnd;
    const stateCount = states.length;

    controller.release();
    expect(states).toHaveLength(stateCount);
    staleEnd?.();
    expect(controller.getState().status).toBe("idle");
    expect(
      controller.play([{ id: "b", pageId: "p1", pageIndex: 0, text: "다시 재생" }])
    ).toBe(true);
    expect(controller.getState()).toMatchObject({ status: "playing", currentItemId: "b" });
  });

  it("never throws when adapters or state listeners fail", () => {
    const adapter = createAdapter({
      cancel: () => {
        throw new Error("cancel failed");
      },
      speak: () => {
        throw new Error("speak failed");
      },
      pause: () => {
        throw new Error("pause failed");
      },
      resume: () => {
        throw new Error("resume failed");
      },
    });
    const controller = createDialogueReadAloudController(adapter, () => {
      throw new Error("render failed");
    });

    expect(() =>
      controller.play([{ id: "a", pageId: "p1", pageIndex: 0, text: "대사" }])
    ).not.toThrow();
    expect(controller.getState().status).toBe("error");
    expect(() => controller.pause()).not.toThrow();
    expect(() => controller.resume()).not.toThrow();
    expect(() => controller.stop()).not.toThrow();
    expect(() => controller.dispose()).not.toThrow();
  });

  it("cancels before rejecting unsupported or empty queues", () => {
    const cancel = vi.fn(() => true);
    const adapter = createAdapter({ supported: false, cancel });
    const controller = createDialogueReadAloudController(adapter);

    expect(controller.play([])).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
    expect(controller.getState().status).toBe("unsupported");
  });
});
