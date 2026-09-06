import { describe, expect, it } from "vitest";

import {
  mergeDialogueWithNext,
  splitDialogueElement,
  transferDialogueElement,
} from "./studio-dialogue-structure";

import type { DialoguePageLike } from "./studio-dialogue-batch";

function pages(): DialoguePageLike[] {
  return [
    {
      id: "p1",
      elements: [
        { id: "frame", type: "frame", x: 0, y: 0, width: 700, height: 800 },
        { id: "a", type: "bubble", text: "첫 문장 둘째 문장", x: 40, y: 40, width: 200, height: 100 },
        { id: "b", type: "text", text: "다음 대사", x: 50, y: 200, width: 180 },
      ],
    },
    {
      id: "p2",
      elements: [
        { id: "c", type: "bubble", text: "도착", x: 30, y: 80, width: 180, height: 90 },
      ],
      canvasH: 600,
    } as DialoguePageLike,
  ];
}

describe("studio dialogue structure", () => {
  it("splits the current draft at the caret, preserves styling, and offsets the second block", () => {
    const source = pages();
    const next = splitDialogueElement(source, {
      pageId: "p1",
      elementId: "a",
      text: "첫 문장\n둘째 문장",
      offset: 4,
      newElementId: "a-split",
    });

    expect(next).not.toBe(source);
    expect(next[1]).toBe(source[1]);
    expect(next[0].elements.map((element) => element.id)).toEqual([
      "frame",
      "a",
      "a-split",
      "b",
    ]);
    expect(next[0].elements[1]).toMatchObject({ text: "첫 문장", x: 40, y: 40, width: 200 });
    expect(next[0].elements[2]).toMatchObject({
      id: "a-split",
      text: "\n둘째 문장",
      x: 58,
      y: 158,
      width: 200,
    });
  });

  it("rejects empty halves, duplicate IDs, missing targets, and locked dialogue", () => {
    const source = pages();
    expect(splitDialogueElement(source, {
      pageId: "p1",
      elementId: "a",
      text: "첫 문장",
      offset: 0,
      newElementId: "new",
    })).toBe(source);
    expect(splitDialogueElement(source, {
      pageId: "p1",
      elementId: "a",
      text: "첫 문장",
      offset: 2,
      newElementId: "b",
    })).toBe(source);

    const locked = [{ ...source[0], elements: source[0].elements.map((element) =>
      element.id === "a" ? { ...element, locked: true } : element
    ) }, source[1]];
    expect(splitDialogueElement(locked, {
      pageId: "p1",
      elementId: "a",
      text: "첫 문장",
      offset: 2,
      newElementId: "new",
    })).toBe(locked);
  });

  it("merges the next dialogue in visual reading order and removes only that block", () => {
    const source = pages();
    const next = mergeDialogueWithNext(source, "p1", "a", "수정 중인 첫 대사");

    expect(next).not.toBe(source);
    expect(next[1]).toBe(source[1]);
    expect(next[0].elements.map((element) => element.id)).toEqual(["frame", "a"]);
    expect(next[0].elements.find((element) => element.id === "a")?.text).toBe(
      "수정 중인 첫 대사\n다음 대사",
    );
    expect(mergeDialogueWithNext(source, "p1", "b")).toBe(source);
  });

  it("moves dialogue across pages, clears foreign groups, and places it after target dialogue", () => {
    const source = pages();
    const grouped = source.map((page) => page.id === "p1" ? {
      ...page,
      elements: page.elements.map((element) => element.id === "a"
        ? { ...element, groupId: "source-group" }
        : element),
    } : page);
    const next = transferDialogueElement(grouped, {
      sourcePageId: "p1",
      targetPageId: "p2",
      elementId: "a",
      mode: "move",
    });

    expect(next[0].elements.some((element) => element.id === "a")).toBe(false);
    expect(next[1].elements.at(-1)).toMatchObject({
      id: "a",
      groupId: undefined,
      x: 40,
      y: 190,
    });
  });

  it("copies with a fresh ID without mutating the source and fails closed on unsafe requests", () => {
    const source = pages();
    const copied = transferDialogueElement(source, {
      sourcePageId: "p1",
      targetPageId: "p2",
      elementId: "a",
      mode: "copy",
      newElementId: "a-copy",
      text: "복사 직전 수정본",
    });

    expect(copied[0]).toBe(source[0]);
    expect(copied[0].elements.some((element) => element.id === "a")).toBe(true);
    expect(copied[1].elements.at(-1)?.id).toBe("a-copy");
    expect(copied[1].elements.at(-1)?.text).toBe("복사 직전 수정본");
    expect(transferDialogueElement(source, {
      sourcePageId: "p1",
      targetPageId: "p2",
      elementId: "a",
      mode: "copy",
      newElementId: "c",
    })).toBe(source);
    expect(transferDialogueElement(source, {
      sourcePageId: "p1",
      targetPageId: "p1",
      elementId: "a",
      mode: "move",
    })).toBe(source);
  });
});
