import { describe, expect, it } from "vitest";

import {
  buildDialogueSuggestPrompt,
  DIALOGUE_SUGGEST_MAX_PARSED,
  formatDialogueSuggestionLine,
  joinDialogueContextLines,
  parseDialogueSuggestResponse,
  type DialogueSuggestionCandidate,
} from "./studio-dialogue-suggest";

describe("buildDialogueSuggestPrompt", () => {
  it("trims the situation text into the user message and omits context when none is given", () => {
    const { system, user } = buildDialogueSuggestPrompt("  옛 친구를 알아보고 반가워하는 장면  ");
    expect(user).toBe("옛 친구를 알아보고 반가워하는 장면");
    expect(system).toContain("3~5개");
    expect(system).toContain("JSON");
    expect(system).not.toContain("이미 배치된 대사 흐름");
  });

  it("includes the existing dialogue context in the system prompt when given", () => {
    const { system } = buildDialogueSuggestPrompt("상황", "민수: 안녕!\n지영: 오랜만이야");
    expect(system).toContain("이미 배치된 대사 흐름");
    expect(system).toContain("민수: 안녕!\n지영: 오랜만이야");
  });

  it("omits the context section when existingContext is blank/whitespace-only", () => {
    const { system } = buildDialogueSuggestPrompt("상황", "   ");
    expect(system).not.toContain("이미 배치된 대사 흐름");
  });

  it("is deterministic for the same input", () => {
    const a = buildDialogueSuggestPrompt("같은 상황", "맥락");
    const b = buildDialogueSuggestPrompt("같은 상황", "맥락");
    expect(a).toEqual(b);
  });
});

describe("joinDialogueContextLines", () => {
  it("joins non-empty trimmed lines in order", () => {
    expect(joinDialogueContextLines(["  민수: 안녕  ", "지영: 오랜만이야", ""])).toBe("민수: 안녕\n지영: 오랜만이야");
  });

  it("returns an empty string when all lines are blank", () => {
    expect(joinDialogueContextLines(["", "   "])).toBe("");
    expect(joinDialogueContextLines([])).toBe("");
  });

  it("truncates from the front (oldest) when exceeding maxChars, keeping the most recent lines", () => {
    const lines = ["a".repeat(50), "b".repeat(50), "c".repeat(50)];
    const result = joinDialogueContextLines(lines, 110);
    expect(result).toBe(`${"b".repeat(50)}\n${"c".repeat(50)}`);
  });

  it("always keeps at least the most recent single line even if it alone exceeds maxChars", () => {
    const lines = ["short", "x".repeat(500)];
    const result = joinDialogueContextLines(lines, 10);
    expect(result).toBe("x".repeat(500));
  });
});

describe("parseDialogueSuggestResponse", () => {
  it("parses a well-formed JSON array response", () => {
    const raw = JSON.stringify([
      { speaker: "민수", text: "나 전학왔어.", kind: "speech" },
      { speaker: "", text: "(교실이 순간 조용해진다)", kind: "narration" },
    ]);
    const result = parseDialogueSuggestResponse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([
      { speaker: "민수", text: "나 전학왔어.", kind: "speech" },
      { speaker: "", text: "(교실이 순간 조용해진다)", kind: "narration" },
    ]);
  });

  it("extracts the JSON array even when wrapped in a markdown code fence with prose around it", () => {
    const raw = [
      "네, 이렇게 제안해볼게요:",
      "```json",
      JSON.stringify([{ speaker: "", text: "오랜만이야.", kind: "speech" }]),
      "```",
      "더 필요하면 말씀해주세요!",
    ].join("\n");
    const result = parseDialogueSuggestResponse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([{ speaker: "", text: "오랜만이야.", kind: "speech" }]);
  });

  it("returns ok:false when no JSON array is present", () => {
    const result = parseDialogueSuggestResponse("죄송하지만 이 요청은 처리할 수 없습니다.");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("찾을 수 없습니다");
  });

  it("returns ok:false for malformed JSON (unbalanced brackets content)", () => {
    const result = parseDialogueSuggestResponse('[{"text": "a"');
    expect(result.ok).toBe(false);
  });

  it("defaults kind to speech when missing/invalid, and coerces non-string speaker to empty", () => {
    const raw = JSON.stringify([{ speaker: 42, text: "안녕", kind: "unknown" }]);
    const result = parseDialogueSuggestResponse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([{ speaker: "", text: "안녕", kind: "speech" }]);
  });

  it("drops entries with an empty/missing text (hallucination guard)", () => {
    const raw = JSON.stringify([
      { speaker: "민수", text: "", kind: "speech" },
      { speaker: "", text: "유효한 대사", kind: "speech" },
      "not-an-object",
    ]);
    const result = parseDialogueSuggestResponse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([{ speaker: "", text: "유효한 대사", kind: "speech" }]);
  });

  it("returns ok:false when every entry is empty after filtering", () => {
    const raw = JSON.stringify([{ speaker: "", text: "", kind: "speech" }]);
    expect(parseDialogueSuggestResponse(raw).ok).toBe(false);
  });

  it("caps parsed candidates at DIALOGUE_SUGGEST_MAX_PARSED even if the model returns more", () => {
    const items = Array.from({ length: DIALOGUE_SUGGEST_MAX_PARSED + 5 }, (_, i) => ({
      speaker: "",
      text: `후보 ${i}`,
      kind: "speech",
    }));
    const result = parseDialogueSuggestResponse(JSON.stringify(items));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(DIALOGUE_SUGGEST_MAX_PARSED);
  });

  it("trims whitespace from speaker/text", () => {
    const raw = JSON.stringify([{ speaker: "  민수  ", text: "  안녕  ", kind: "speech" }]);
    const result = parseDialogueSuggestResponse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]).toEqual({ speaker: "민수", text: "안녕", kind: "speech" });
  });
});

describe("formatDialogueSuggestionLine", () => {
  it("wraps narration candidates in parentheses", () => {
    const candidate: DialogueSuggestionCandidate = { speaker: "", text: "잠시 정적이 흐른다", kind: "narration" };
    expect(formatDialogueSuggestionLine(candidate)).toBe("(잠시 정적이 흐른다)");
  });

  it("prefixes speech candidates with 'speaker: ' when a speaker is given", () => {
    const candidate: DialogueSuggestionCandidate = { speaker: "민수", text: "안녕!", kind: "speech" };
    expect(formatDialogueSuggestionLine(candidate)).toBe("민수: 안녕!");
  });

  it("returns just the text for speech candidates without a speaker", () => {
    const candidate: DialogueSuggestionCandidate = { speaker: "", text: "안녕!", kind: "speech" };
    expect(formatDialogueSuggestionLine(candidate)).toBe("안녕!");
  });
});
