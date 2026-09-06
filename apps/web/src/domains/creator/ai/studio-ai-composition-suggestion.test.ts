/**
 * normalizeStudioAiCompositionSuggestion — 모델이 "텍스트 불릿" 지시를 어기고 JSON을 반환해도
 * 원시 JSON이 UI에 그대로 노출되지 않게 하는 방어 정규화의 단위 테스트. fetch 없음(순수 함수).
 */
import { describe, expect, it } from "vitest";

import {
  normalizeStudioAiCompositionSuggestion,
  STUDIO_AI_COMPOSITION_SUGGESTION_NORMALIZE_LIMITS,
} from "./studio-ai-composition-suggestion";

describe("normalizeStudioAiCompositionSuggestion", () => {
  it("일반 텍스트 불릿 응답은 그대로 반환한다", () => {
    const raw = "- 롱샷: 인물 전신\n- 클로즈업: 표정 강조";
    expect(normalizeStudioAiCompositionSuggestion(raw)).toBe(raw);
  });

  it("JSON 객체를 문자열 리프 불릿으로 되돌린다", () => {
    const result = normalizeStudioAiCompositionSuggestion(
      JSON.stringify({
        shots: [{ camera: "롱샷", note: "인물 전신" }, { camera: "클로즈업", note: "표정 강조" }],
        reasoning: "속도감을 위해 컷을 분리했다.",
      })
    );
    expect(result).toBe("- 롱샷\n- 인물 전신\n- 클로즈업\n- 표정 강조\n- 속도감을 위해 컷을 분리했다.");
  });

  it("JSON 배열도 동일하게 처리한다", () => {
    const result = normalizeStudioAiCompositionSuggestion(
      JSON.stringify([{ text: "미디엄샷으로 시작" }, { text: "우측 배치" }])
    );
    expect(result).toBe("- 미디엄샷으로 시작\n- 우측 배치");
  });

  it("코드펜스·설명 문장에 섞여 있어도 첫 JSON 리터럴만 뽑아낸다", () => {
    const raw = '다음은 제안입니다:\n```json\n[{"text":"로우앵글"}, {"text":"빠른 편집"}]\n```\n참고하세요.';
    const result = normalizeStudioAiCompositionSuggestion(raw);
    expect(result).toBe("- 로우앵글\n- 빠른 편집");
  });

  it("빈 문자열·1자 문자는 건너뛴다", () => {
    const result = normalizeStudioAiCompositionSuggestion(JSON.stringify({ a: "", b: "x", c: "유효한 제안" }));
    expect(result).toBe("- 유효한 제안");
  });

  it("문자열을 하나도 못 뽑으면 원문을 보존한다", () => {
    const raw = '{"a":1,"b":true,"c":null}';
    expect(normalizeStudioAiCompositionSuggestion(raw)).toBe(raw);
  });

  it("깨진 JSON은 원문을 보존한다", () => {
    const raw = '{"text":"젖은 골목, 아직 안 끝남';
    expect(normalizeStudioAiCompositionSuggestion(raw)).toBe(raw);
  });

  it(`문자열 개수 상한(${STUDIO_AI_COMPOSITION_SUGGESTION_NORMALIZE_LIMITS.maxStrings})을 지킨다`, () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({ text: `제안 ${i}` }));
    const result = normalizeStudioAiCompositionSuggestion(JSON.stringify(entries));
    expect(result.split("\n")).toHaveLength(STUDIO_AI_COMPOSITION_SUGGESTION_NORMALIZE_LIMITS.maxStrings);
  });
});
