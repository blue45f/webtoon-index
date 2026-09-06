import { describe, expect, it } from "vitest";

import {
  buildPaletteSuggestPrompt,
  PALETTE_SUGGEST_MAX_COLORS,
  PALETTE_SUGGEST_MAX_PARSED,
  PALETTE_SUGGEST_MIN_COLORS,
  parsePaletteSuggestResponse,
} from "./studio-palette-suggest";

describe("buildPaletteSuggestPrompt", () => {
  it("trims the mood text into the user message and mentions the color count range", () => {
    const { system, user } = buildPaletteSuggestPrompt("  스릴러, 어둡고 차가운 느낌  ");
    expect(user).toBe("스릴러, 어둡고 차가운 느낌");
    expect(system).toContain(`${PALETTE_SUGGEST_MIN_COLORS}~${PALETTE_SUGGEST_MAX_COLORS}`);
    expect(system).toContain("JSON");
  });

  it("is deterministic for the same input", () => {
    const a = buildPaletteSuggestPrompt("청춘로맨스, 파스텔톤");
    const b = buildPaletteSuggestPrompt("청춘로맨스, 파스텔톤");
    expect(a).toEqual(b);
  });
});

describe("parsePaletteSuggestResponse", () => {
  it("parses a well-formed JSON object response", () => {
    const raw = JSON.stringify({
      name: "스릴러 - 어둡고 차가운",
      colors: [
        { hex: "#101820", role: "주조색" },
        { hex: "#2B3A42", role: "보조색" },
      ],
    });
    const result = parsePaletteSuggestResponse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      name: "스릴러 - 어둡고 차가운",
      colors: [
        { hex: "#101820", role: "주조색" },
        { hex: "#2b3a42", role: "보조색" }, // normalizeHexColor lowercases the value.
      ],
    });
  });

  it("extracts the JSON object even when wrapped in a markdown code fence with prose around it", () => {
    const raw = [
      "네, 이렇게 제안해볼게요:",
      "```json",
      JSON.stringify({ name: "차분한 청록", colors: [{ hex: "#204040", role: "주조색" }] }),
      "```",
      "더 필요하면 말씀해주세요!",
    ].join("\n");
    const result = parsePaletteSuggestResponse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ name: "차분한 청록", colors: [{ hex: "#204040", role: "주조색" }] });
  });

  it("returns ok:false when no JSON object is present", () => {
    const result = parsePaletteSuggestResponse("죄송하지만 이 요청은 처리할 수 없습니다.");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("찾을 수 없습니다");
  });

  it("returns ok:false for malformed JSON (unbalanced braces content)", () => {
    const result = parsePaletteSuggestResponse('{"name": "a", "colors": [');
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when colors is missing or empty", () => {
    expect(parsePaletteSuggestResponse(JSON.stringify({ name: "빈 팔레트" })).ok).toBe(false);
    expect(parsePaletteSuggestResponse(JSON.stringify({ name: "빈 팔레트", colors: [] })).ok).toBe(false);
  });

  it("drops color entries with invalid/malformed hex values (hallucination guard)", () => {
    const raw = JSON.stringify({
      name: "혼합",
      colors: [
        { hex: "#101820", role: "주조색" },
        { hex: "not-a-hex", role: "보조색" },
        { hex: "#zzzzzz", role: "포인트색" },
        "not-an-object",
      ],
    });
    const result = parsePaletteSuggestResponse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.colors).toEqual([{ hex: "#101820", role: "주조색" }]);
  });

  it("returns ok:false when every color entry is invalid after filtering", () => {
    const raw = JSON.stringify({ name: "전부 무효", colors: [{ hex: "invalid", role: "x" }] });
    expect(parsePaletteSuggestResponse(raw).ok).toBe(false);
  });

  it("expands #rgb shorthand hex via normalizeHexColor", () => {
    const raw = JSON.stringify({ name: "짧은 헥스", colors: [{ hex: "#f00", role: "포인트색" }] });
    const result = parsePaletteSuggestResponse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.colors).toEqual([{ hex: "#ff0000", role: "포인트색" }]);
  });

  it("defaults role to an empty string when missing/non-string", () => {
    const raw = JSON.stringify({ name: "x", colors: [{ hex: "#101820", role: 42 }] });
    const result = parsePaletteSuggestResponse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.colors).toEqual([{ hex: "#101820", role: "" }]);
  });

  it("defaults name to an empty string when missing/non-string", () => {
    const raw = JSON.stringify({ colors: [{ hex: "#101820", role: "주조색" }] });
    const result = parsePaletteSuggestResponse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.name).toBe("");
  });

  it("trims whitespace from name/role", () => {
    const raw = JSON.stringify({ name: "  이름  ", colors: [{ hex: "#101820", role: "  주조색  " }] });
    const result = parsePaletteSuggestResponse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.name).toBe("이름");
    expect(result.data.colors[0]?.role).toBe("주조색");
  });

  it("caps parsed colors at PALETTE_SUGGEST_MAX_PARSED even if the model returns more", () => {
    const colors = Array.from({ length: PALETTE_SUGGEST_MAX_PARSED + 5 }, (_, i) => ({
      hex: `#${(i % 16).toString(16).repeat(6)}`,
      role: `색 ${i}`,
    }));
    const result = parsePaletteSuggestResponse(JSON.stringify({ name: "많은 색", colors }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.colors).toHaveLength(PALETTE_SUGGEST_MAX_PARSED);
  });
});
