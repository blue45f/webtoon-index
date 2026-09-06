import { describe, expect, it } from "vitest";

import {
  applyDialogueRubySpan,
  clearDialogueRubyRange,
  formatDialogueTextWithRubyPreview,
  type DialogueRubySpan,
} from "./studio-dialogue-ruby";

import type { DialoguePageLike } from "./studio-dialogue-batch";

function pagesWith(
  text: string,
  spans?: readonly DialogueRubySpan[]
): DialoguePageLike[] {
  return [
    {
      id: "page-1",
      elements: [
        {
          id: "bubble-1",
          type: "bubble",
          text,
          ...(spans ? { rubySpans: spans } : {}),
        },
      ],
    },
  ];
}

function rubySpansOf(pages: readonly DialoguePageLike[]): readonly DialogueRubySpan[] | undefined {
  const element = pages[0]?.elements[0] as
    | { rubySpans?: readonly DialogueRubySpan[] }
    | undefined;
  return element?.rubySpans;
}

describe("applyDialogueRubySpan", () => {
  it("attaches a ruby span on a valid text range and freezes the span", () => {
    const source = pagesWith("漢字テスト");
    const next = applyDialogueRubySpan(source, {
      pageId: "page-1",
      elementId: "bubble-1",
      text: "漢字テスト",
      start: 0,
      end: 2,
      ruby: "かんじ",
    });

    expect(next).not.toBe(source);
    const spans = rubySpansOf(next);
    expect(spans).toEqual([{ start: 0, end: 2, ruby: "かんじ" }]);
    expect(Object.isFrozen(spans?.[0])).toBe(true);
  });

  it("replaces overlapping spans and keeps non-overlapping ones", () => {
    const source = pagesWith("あいうえお", [
      { start: 0, end: 2, ruby: "old" },
      { start: 3, end: 5, ruby: "keep" },
    ]);
    const next = applyDialogueRubySpan(source, {
      pageId: "page-1",
      elementId: "bubble-1",
      text: "あいうえお",
      start: 1,
      end: 3,
      ruby: "new",
    });

    expect(rubySpansOf(next)).toEqual([
      { start: 1, end: 3, ruby: "new" },
      { start: 3, end: 5, ruby: "keep" },
    ]);
  });

  it("returns the same reference for empty/invalid ranges or empty readings", () => {
    const source = pagesWith("대사");
    expect(
      applyDialogueRubySpan(source, {
        pageId: "page-1",
        elementId: "bubble-1",
        text: "대사",
        start: 1,
        end: 1,
        ruby: "x",
      })
    ).toBe(source);
    expect(
      applyDialogueRubySpan(source, {
        pageId: "page-1",
        elementId: "bubble-1",
        text: "대사",
        start: 0,
        end: 1,
        ruby: "   ",
      })
    ).toBe(source);
  });

  it("skips locked elements unless includeLocked is set", () => {
    const locked: DialoguePageLike[] = [
      {
        id: "page-1",
        elements: [{ id: "bubble-1", type: "bubble", text: "漢字", locked: true }],
      },
    ];
    expect(
      applyDialogueRubySpan(locked, {
        pageId: "page-1",
        elementId: "bubble-1",
        text: "漢字",
        start: 0,
        end: 2,
        ruby: "かんじ",
      })
    ).toBe(locked);

    const unlocked = applyDialogueRubySpan(locked, {
      pageId: "page-1",
      elementId: "bubble-1",
      text: "漢字",
      start: 0,
      end: 2,
      ruby: "かんじ",
      includeLocked: true,
    });
    expect(rubySpansOf(unlocked)).toEqual([{ start: 0, end: 2, ruby: "かんじ" }]);
  });
});

describe("clearDialogueRubyRange", () => {
  it("removes spans that intersect the selected range", () => {
    const source = pagesWith("あいうえお", [
      { start: 0, end: 2, ruby: "a" },
      { start: 2, end: 4, ruby: "b" },
      { start: 4, end: 5, ruby: "c" },
    ]);
    const next = clearDialogueRubyRange(source, {
      pageId: "page-1",
      elementId: "bubble-1",
      text: "あいうえお",
      start: 1,
      end: 3,
    });
    expect(rubySpansOf(next)).toEqual([{ start: 4, end: 5, ruby: "c" }]);
  });

  it("clears remaining rubySpans to undefined when no spans remain", () => {
    const source = pagesWith("漢字", [{ start: 0, end: 2, ruby: "かんじ" }]);
    const next = clearDialogueRubyRange(source, {
      pageId: "page-1",
      elementId: "bubble-1",
      text: "漢字",
      start: 0,
      end: 2,
    });
    expect(rubySpansOf(next)).toBeUndefined();
  });
});

describe("formatDialogueTextWithRubyPreview", () => {
  it("formats 漢字(かんじ) style previews without mutating non-annotated ranges", () => {
    expect(
      formatDialogueTextWithRubyPreview("漢字テスト", [
        { start: 0, end: 2, ruby: "かんじ" },
      ])
    ).toBe("漢字(かんじ)テスト");
    expect(formatDialogueTextWithRubyPreview("plain", undefined)).toBe("plain");
    expect(formatDialogueTextWithRubyPreview("plain", [])).toBe("plain");
  });
});
