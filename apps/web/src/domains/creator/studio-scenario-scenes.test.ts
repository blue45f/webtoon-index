import { describe, expect, it } from "vitest";

import {
  buildScenarioScenesPrompt,
  parseScenarioScenesResponse,
  SCENARIO_MAX_PARSED_SCENES,
} from "./studio-scenario-scenes";

describe("buildScenarioScenesPrompt", () => {
  it("trims the story text into the user message and asks for 3~8 scenes by default", () => {
    const { system, user } = buildScenarioScenesPrompt("  주인공이 학교 가는 길에 친구를 만난다  ");
    expect(user).toBe("주인공이 학교 가는 길에 친구를 만난다");
    expect(system).toContain("3~8개의 장면");
    expect(system).toContain("JSON");
    expect(system).toContain("beatType");
    expect(system).toContain("summary");
  });

  it("asks for an exact scene count when a valid hint (2~10) is given", () => {
    const { system } = buildScenarioScenesPrompt("스토리", 5);
    expect(system).toContain("정확히 5개의 장면");
    expect(system).not.toContain("3~8개");
  });

  it.each([1, 11, 0, -3, Number.NaN])("falls back to the default range instruction for an out-of-range hint (%s)", (hint) => {
    const { system } = buildScenarioScenesPrompt("스토리", hint);
    expect(system).toContain("3~8개의 장면");
  });

  it("is deterministic for the same input", () => {
    const a = buildScenarioScenesPrompt("같은 스토리", 4);
    const b = buildScenarioScenesPrompt("같은 스토리", 4);
    expect(a).toEqual(b);
  });

  it("adds a bounded character bible section and protects locked fields", () => {
    const { system, user } = buildScenarioScenesPrompt(
      "학교에서 재회한다",
      3,
      "캐릭터 1\n- 외형 [고정]: 은빛 단발"
    );
    expect(system).toContain("[고정]");
    expect(user).toContain("[캐릭터 바이블]");
    expect(user).toContain("은빛 단발");
    expect(user).toContain("[스토리 아이디어]\n학교에서 재회한다");
  });
});

describe("parseScenarioScenesResponse", () => {
  it("parses a well-formed JSON object response", () => {
    const raw = JSON.stringify({
      characterDescription: "단발머리 여고생, 교복 차림",
      scenes: [
        { imagePrompt: "아침 등굣길, 골목", dialogue: "민수: 안녕!\n지영: 오랜만이야" },
        { imagePrompt: "교실, 창가 자리", dialogue: "(수업 종이 울린다)" },
      ],
    });
    const result = parseScenarioScenesResponse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.characterDescription).toBe("단발머리 여고생, 교복 차림");
    expect(result.data.scenes).toHaveLength(2);
    expect(result.data.scenes[0]).toEqual({ imagePrompt: "아침 등굣길, 골목", dialogue: "민수: 안녕!\n지영: 오랜만이야" });
  });

  it("parses structured beat metadata and normalizes an unknown beat type", () => {
    const result = parseScenarioScenesResponse(
      JSON.stringify({
        characterDescription: "",
        scenes: [
          {
            beatType: "climax",
            summary: "주인공이 마침내 진실을 밝힌다",
            imagePrompt: "옥상, 폭우",
            dialogue: "주인공: 이제 끝이야.",
          },
          { beatType: "unsupported", summary: "다음 회차로 연결된다", imagePrompt: "", dialogue: "" },
        ],
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.scenes[0]).toMatchObject({ beatType: "climax", summary: "주인공이 마침내 진실을 밝힌다" });
    expect(result.data.scenes[1]).toEqual({
      beatType: "transition",
      summary: "다음 회차로 연결된다",
      imagePrompt: "",
      dialogue: "",
    });
  });

  it("normalizes structured continuity facts and drops malformed empty values", () => {
    const result = parseScenarioScenesResponse(
      JSON.stringify({
        characterDescription: "",
        scenes: [{
          summary: "교실에서 옥상으로 이동한다",
          imagePrompt: "옥상",
          dialogue: "윤슬: 찾았다.",
          continuity: {
            characterNames: [" 윤슬 ", "윤슬", null],
            location: " 옥상 ",
            time: "밤",
            costumes: { 윤슬: " 교복 ", 빈값: " " },
            props: { 열쇠: "윤슬 소유" },
            transitionExplanations: { location: "계단으로 이동", props: { 열쇠: "주웠다" } },
          },
        }],
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.scenes[0].continuity).toEqual({
      characterNames: ["윤슬"],
      location: "옥상",
      time: "밤",
      costumes: { 윤슬: "교복" },
      props: { 열쇠: "윤슬 소유" },
      transitionExplanations: { location: "계단으로 이동", props: { 열쇠: "주웠다" } },
    });
  });

  it("extracts the JSON object even when wrapped in a markdown code fence with prose around it", () => {
    const raw = [
      "네, 아래와 같이 나눠보았습니다:",
      "```json",
      JSON.stringify({ characterDescription: "", scenes: [{ imagePrompt: "배경1", dialogue: "" }] }),
      "```",
      "필요하면 더 말씀해주세요!",
    ].join("\n");
    const result = parseScenarioScenesResponse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.scenes).toEqual([{ imagePrompt: "배경1", dialogue: "" }]);
  });

  it("returns ok:false when no JSON object is present", () => {
    const result = parseScenarioScenesResponse("죄송하지만 이 요청은 처리할 수 없습니다.");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("찾을 수 없습니다");
  });

  it("returns ok:false for malformed JSON (unbalanced braces content)", () => {
    const result = parseScenarioScenesResponse('{"characterDescription": "a", "scenes": [}');
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when scenes is missing or empty", () => {
    expect(parseScenarioScenesResponse(JSON.stringify({ characterDescription: "a" })).ok).toBe(false);
    expect(parseScenarioScenesResponse(JSON.stringify({ characterDescription: "a", scenes: [] })).ok).toBe(false);
  });

  it("drops scene entries where both imagePrompt and dialogue are empty (hallucination guard)", () => {
    const raw = JSON.stringify({
      characterDescription: "",
      scenes: [
        { imagePrompt: "", dialogue: "" },
        { imagePrompt: "유효한 장면", dialogue: "" },
      ],
    });
    const result = parseScenarioScenesResponse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.scenes).toEqual([{ imagePrompt: "유효한 장면", dialogue: "" }]);
  });

  it("keeps a summary-only structural beat", () => {
    const result = parseScenarioScenesResponse(
      JSON.stringify({ characterDescription: "", scenes: [{ summary: "긴장감이 높아진다" }] })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.scenes).toEqual([{ summary: "긴장감이 높아진다", imagePrompt: "", dialogue: "" }]);
  });

  it("returns ok:false when every scene entry is empty after filtering", () => {
    const raw = JSON.stringify({ characterDescription: "", scenes: [{ imagePrompt: "", dialogue: "" }] });
    expect(parseScenarioScenesResponse(raw).ok).toBe(false);
  });

  it("tolerates non-string field types by coercing to empty string rather than throwing", () => {
    const raw = JSON.stringify({
      characterDescription: 42,
      scenes: [{ imagePrompt: null, dialogue: "민수: 안녕" }, "not-an-object"],
    });
    const result = parseScenarioScenesResponse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.characterDescription).toBe("");
    expect(result.data.scenes).toEqual([{ imagePrompt: "", dialogue: "민수: 안녕" }]);
  });

  it("caps parsed scenes at SCENARIO_MAX_PARSED_SCENES even if the model returns more", () => {
    const scenes = Array.from({ length: SCENARIO_MAX_PARSED_SCENES + 5 }, (_, i) => ({
      imagePrompt: `장면 ${i}`,
      dialogue: "",
    }));
    const raw = JSON.stringify({ characterDescription: "", scenes });
    const result = parseScenarioScenesResponse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.scenes).toHaveLength(SCENARIO_MAX_PARSED_SCENES);
  });

  it("trims whitespace from imagePrompt/dialogue/characterDescription", () => {
    const raw = JSON.stringify({
      characterDescription: "  외모 묘사  ",
      scenes: [{ imagePrompt: "  배경  ", dialogue: "  민수: 안녕  " }],
    });
    const result = parseScenarioScenesResponse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.characterDescription).toBe("외모 묘사");
    expect(result.data.scenes[0]).toEqual({ imagePrompt: "배경", dialogue: "민수: 안녕" });
  });
});
