import { afterEach, describe, expect, it, vi } from "vitest";

import { copyStudioText } from "./studio-workbench-clipboard";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** jsdom 없이 document/navigator 를 직접 세운다 — 폴백 경로까지 node env 에서 검증하기 위해. */
function stubNavigator(clipboard: unknown) {
  vi.stubGlobal("navigator", clipboard === undefined ? {} : { clipboard });
}

type FakeTextarea = {
  value: string;
  readOnly: boolean;
  style: Record<string, string>;
  setAttribute: (name: string, value: string) => void;
  focus: () => void;
  select: () => void;
  setSelectionRange: (start: number, end: number) => void;
  remove: () => void;
};

function stubDocument(options: {
  execCommand?: (command: string) => boolean;
  activeElement?: unknown;
}): { created: FakeTextarea[]; appended: number; removed: number } {
  const created: FakeTextarea[] = [];
  const counters = { appended: 0, removed: 0 };

  vi.stubGlobal("document", {
    activeElement: options.activeElement ?? null,
    body: {
      appendChild: () => {
        counters.appended += 1;
      },
    },
    createElement: () => {
      const el: FakeTextarea = {
        value: "",
        readOnly: false,
        style: {},
        setAttribute: () => undefined,
        focus: () => undefined,
        select: () => undefined,
        setSelectionRange: () => undefined,
        remove: () => {
          counters.removed += 1;
        },
      };
      created.push(el);
      return el;
    },
    execCommand: options.execCommand,
  });

  return {
    created,
    get appended() {
      return counters.appended;
    },
    get removed() {
      return counters.removed;
    },
  };
}

describe("copyStudioText — async clipboard path", () => {
  it("writes through navigator.clipboard and reports success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ writeText });

    await expect(copyStudioText("복사할 프롬프트")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("복사할 프롬프트");
  });

  it("awaits the write — a rejection must not escape as an unhandled rejection", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    stubNavigator({ writeText });
    stubDocument({ execCommand: () => false });

    await expect(copyStudioText("x")).resolves.toBe(false);
    expect(writeText).toHaveBeenCalledOnce();
  });

  it("copies an empty string successfully rather than short-circuiting", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ writeText });

    await expect(copyStudioText("")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("");
  });
});

describe("copyStudioText — insecure context falls back to execCommand", () => {
  it("uses the hidden textarea when navigator.clipboard is undefined", async () => {
    stubNavigator(undefined);
    const execCommand = vi.fn().mockReturnValue(true);
    const doc = stubDocument({ execCommand });

    await expect(copyStudioText("http 로 열린 스튜디오")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledExactlyOnceWith("copy");
    expect(doc.created[0]?.value).toBe("http 로 열린 스튜디오");
    expect(doc.created[0]?.readOnly).toBe(true);
  });

  it("falls back when the async clipboard rejects, and then succeeds", async () => {
    stubNavigator({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    const execCommand = vi.fn().mockReturnValue(true);
    stubDocument({ execCommand });

    await expect(copyStudioText("두 번째 시도")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledOnce();
  });

  it("reports false when execCommand reports failure", async () => {
    stubNavigator(undefined);
    stubDocument({ execCommand: () => false });

    await expect(copyStudioText("nope")).resolves.toBe(false);
  });

  it("reports false when execCommand throws", async () => {
    stubNavigator(undefined);
    stubDocument({
      execCommand: () => {
        throw new Error("boom");
      },
    });

    await expect(copyStudioText("nope")).resolves.toBe(false);
  });

  it("always removes the temporary textarea, even when the copy fails", async () => {
    stubNavigator(undefined);
    const doc = stubDocument({
      execCommand: () => {
        throw new Error("boom");
      },
    });

    await copyStudioText("nope");
    expect(doc.appended).toBe(1);
    expect(doc.removed).toBe(1);
  });

  it("restores focus to the element that had it, so a modal does not lose focus to body", async () => {
    stubNavigator(undefined);
    const focus = vi.fn();
    stubDocument({ execCommand: () => true, activeElement: { focus } });

    await expect(copyStudioText("복사")).resolves.toBe(true);
    expect(focus).toHaveBeenCalledOnce();
  });

  it("still reports success when restoring focus throws", async () => {
    stubNavigator(undefined);
    stubDocument({
      execCommand: () => true,
      activeElement: {
        focus: () => {
          throw new Error("detached");
        },
      },
    });

    await expect(copyStudioText("복사")).resolves.toBe(true);
  });

  it("treats a non-boolean execCommand result as failure", async () => {
    stubNavigator(undefined);
    stubDocument({ execCommand: () => "yes" as unknown as boolean });

    await expect(copyStudioText("nope")).resolves.toBe(false);
  });
});

describe("copyStudioText — absent DOM (SSR / vitest node env)", () => {
  it("returns false when neither navigator nor document exist", async () => {
    vi.stubGlobal("navigator", undefined);
    vi.stubGlobal("document", undefined);

    await expect(copyStudioText("SSR")).resolves.toBe(false);
  });

  it("returns false when document has no execCommand", async () => {
    stubNavigator(undefined);
    stubDocument({ execCommand: undefined });

    await expect(copyStudioText("no execCommand")).resolves.toBe(false);
  });

  it("returns false when document.body is missing", async () => {
    stubNavigator(undefined);
    vi.stubGlobal("document", { body: null, execCommand: () => true });

    await expect(copyStudioText("no body")).resolves.toBe(false);
  });

  it("returns false for a non-string argument instead of throwing", async () => {
    stubNavigator({ writeText: vi.fn().mockResolvedValue(undefined) });

    await expect(copyStudioText(undefined as unknown as string)).resolves.toBe(false);
    await expect(copyStudioText(null as unknown as string)).resolves.toBe(false);
    await expect(copyStudioText(42 as unknown as string)).resolves.toBe(false);
  });

  it("never rejects, whatever the environment does", async () => {
    vi.stubGlobal("navigator", {
      get clipboard(): never {
        throw new Error("access denied");
      },
    });
    vi.stubGlobal("document", undefined);

    await expect(copyStudioText("hostile")).resolves.toBe(false);
  });
});
