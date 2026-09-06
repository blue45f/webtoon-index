import { describe, expect, it } from "vitest";

import {
  applyDialogueFormatPatch,
  convertTextElementsToBubbles,
  countConvertibleTextElements,
} from "./studio-dialogue-format";

import type { DialogueElementLike, DialoguePageLike } from "./studio-dialogue-batch";

type RichDialogueElement = DialogueElementLike & Record<string, unknown>;

function fixture(): DialoguePageLike[] {
  const elementsP1: RichDialogueElement[] = [
    { id: "frame", type: "frame", x: 0, y: 0, width: 700, height: 800 },
    {
      id: "t1",
      type: "text",
      text: "첫 대사",
      x: 40,
      y: 40,
      width: 200,
      fontSize: 22,
      fill: "#111111",
    },
    {
      id: "t2",
      type: "text",
      text: "둘째",
      x: 50,
      y: 200,
      width: 180,
      fontSize: 18,
      fill: "#222222",
      locked: true,
    },
    {
      id: "b1",
      type: "bubble",
      variant: "speech",
      text: "말풍선",
      x: 80,
      y: 320,
      width: 160,
      height: 90,
      fill: "#ffffff",
      textFill: "#000000",
      fontSize: 20,
    },
  ];
  const elementsP2: RichDialogueElement[] = [
    {
      id: "t3",
      type: "text",
      text: "다른 페이지",
      x: 20,
      y: 30,
      width: 220,
      fontSize: 16,
      fill: "#333333",
    },
  ];
  return [
    { id: "p1", elements: elementsP1 },
    { id: "p2", elements: elementsP2 },
  ];
}

describe("applyDialogueFormatPatch", () => {
  it("formats multi-selected text and bubbles in one document pass", () => {
    const source = fixture();
    const next = applyDialogueFormatPatch(source, {
      elementIds: ["t1", "b1", "t3", "missing"],
      patch: {
        fontSize: 28,
        fontStyle: "bold",
        textColor: "#aa0000",
        align: "center",
        vertical: true,
      },
    });

    expect(next).not.toBe(source);
    expect(next[0].elements.find((el) => el.id === "t1")).toMatchObject({
      fontSize: 28,
      fontStyle: "bold",
      fill: "#aa0000",
      align: "center",
      vertical: true,
    });
    expect(next[0].elements.find((el) => el.id === "b1")).toMatchObject({
      fontSize: 28,
      fontStyle: "bold",
      textFill: "#aa0000",
      align: "center",
      vertical: true,
    });
    expect(next[1].elements.find((el) => el.id === "t3")).toMatchObject({
      fontSize: 28,
      fill: "#aa0000",
    });
    // Unselected / non-dialogue keep identity
    expect(next[0].elements.find((el) => el.id === "frame")).toBe(
      source[0].elements.find((el) => el.id === "frame")
    );
  });

  it("skips locked dialogue and returns the same reference when nothing changes", () => {
    const source = fixture();
    const lockedOnly = applyDialogueFormatPatch(source, {
      elementIds: ["t2"],
      patch: { fontSize: 40 },
    });
    expect(lockedOnly).toBe(source);

    const empty = applyDialogueFormatPatch(source, {
      elementIds: [],
      patch: { fontSize: 40 },
    });
    expect(empty).toBe(source);

    const invalid = applyDialogueFormatPatch(source, {
      elementIds: ["t1"],
      patch: { fontSize: Number.NaN },
    });
    expect(invalid).toBe(source);
  });

  it("can include locked elements when requested", () => {
    const source = fixture();
    const next = applyDialogueFormatPatch(source, {
      elementIds: ["t2"],
      patch: { fontSize: 36 },
      includeLocked: true,
    });
    expect(next[0].elements.find((el) => el.id === "t2")).toMatchObject({ fontSize: 36 });
  });
});

describe("convertTextElementsToBubbles", () => {
  it("converts free text to bubbles, preserves content, and leaves bubbles alone", () => {
    const source = fixture();
    const next = convertTextElementsToBubbles(source, {
      elementIds: ["t1", "b1", "t3"],
      variant: "thought",
    });

    expect(next).not.toBe(source);
    const converted = next[0].elements.find((el) => el.id === "t1");
    expect(converted).toMatchObject({
      type: "bubble",
      variant: "thought",
      text: "첫 대사",
      x: 40,
      y: 40,
      fontSize: 22,
      textFill: "#111111",
      fill: "#ffffff",
    });
    expect(typeof converted?.height).toBe("number");
    expect((converted?.height as number) >= 64).toBe(true);
    // Existing bubble untouched by identity
    expect(next[0].elements.find((el) => el.id === "b1")).toBe(
      source[0].elements.find((el) => el.id === "b1")
    );
    expect(next[1].elements.find((el) => el.id === "t3")).toMatchObject({
      type: "bubble",
      variant: "thought",
      text: "다른 페이지",
    });
  });

  it("skips locked text and fails closed on duplicate replacement ids", () => {
    const source = fixture();
    expect(
      convertTextElementsToBubbles(source, { elementIds: ["t2"], variant: "speech" })
    ).toBe(source);

    const collision = convertTextElementsToBubbles(source, {
      elementIds: ["t1"],
      idMap: { t1: "b1" },
    });
    expect(collision).toBe(source);
  });

  it("countConvertibleTextElements reports only unlocked free text", () => {
    const source = fixture();
    expect(countConvertibleTextElements(source, ["t1", "t2", "b1", "t3"])).toBe(2);
    expect(countConvertibleTextElements(source, ["t1", "t2"], true)).toBe(2);
  });

  it("round-trips through JSON like a project save/reload without silent loss", () => {
    const source = fixture();
    const next = convertTextElementsToBubbles(source, {
      elementIds: ["t1"],
      variant: "speech",
    });
    const reloaded = JSON.parse(JSON.stringify(next)) as DialoguePageLike[];
    const bubble = reloaded[0].elements.find((el) => el.id === "t1");
    expect(bubble).toMatchObject({
      type: "bubble",
      variant: "speech",
      text: "첫 대사",
      textFill: "#111111",
    });
    expect(reloaded[0].elements.some((el) => el.id === "t1" && el.type === "text")).toBe(false);
  });
});
