/**
 * 구도 제안(콘티→연출 조언) 응답 정규화 — 순수·결정적. fetch 없음.
 *
 * 시스템 프롬프트는 "한국어 불릿 3~5개" 텍스트를 요구하지만, 일부 모델은 지시를 어기고 JSON
 * 객체/배열을 그대로 반환한다. 그대로 UI에 노출하면 원시 JSON 덤프가 그대로 사용자에게 보이므로
 * (studio-ai-client.suggestSceneComposition이 기존에 content를 그대로 반환), 문자열 리프 값만 뽑아
 * 읽을 수 있는 불릿 텍스트로 되돌린다. 코드펜스·설명 문장이 섞여 있어도 첫 JSON 리터럴을 방어적으로
 * 찾아낸다(studio-dialogue-suggest.extractJsonArrayLiteral과 동일 발상).
 *
 * JSON이 아니거나 문자열을 하나도 못 뽑으면 **원문을 그대로 반환**한다 — 정규화 실패가 사용자에게
 * 도달할 내용을 잃지 않게(정직성 규약). 파싱 상한은 studio-dialogue-suggest의 MAX_PARSED와 같은
 * "앞에서부터만" 정책으로 UI 폭주를 막는다.
 */

export const STUDIO_AI_COMPOSITION_SUGGESTION_NORMALIZE_LIMITS = Object.freeze({
  /** 이 개수까지만 문자열 리프를 취한다(UI 과다 방어). */
  maxStrings: 12,
  /** 문자열 하나의 최대 길이(환각 폭주 절단). */
  maxStringLength: 400,
  /** 전체 출력 바이트 예산. */
  maxTotalLength: 2_000,
});

export function normalizeStudioAiCompositionSuggestion(raw: string): string {
  const literalStart = raw.search(/[{[]/);
  if (literalStart === -1) return raw;
  const openChar = raw[literalStart]!;
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let end = -1;
  for (let i = literalStart; i < raw.length; i += 1) {
    if (raw[i] === openChar) depth += 1;
    else if (raw[i] === closeChar) {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) return raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(literalStart, end));
  } catch {
    return raw;
  }
  const strings: string[] = [];
  let totalLength = 0;
  const visit = (value: unknown): void => {
    if (strings.length >= STUDIO_AI_COMPOSITION_SUGGESTION_NORMALIZE_LIMITS.maxStrings) return;
    if (typeof value === "string") {
      const text = value.trim().slice(0, STUDIO_AI_COMPOSITION_SUGGESTION_NORMALIZE_LIMITS.maxStringLength);
      if (
        text.length < 2 ||
        totalLength + text.length > STUDIO_AI_COMPOSITION_SUGGESTION_NORMALIZE_LIMITS.maxTotalLength
      ) {
        return;
      }
      strings.push(text);
      totalLength += text.length;
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (value && typeof value === "object") {
      for (const entry of Object.values(value)) visit(entry);
    }
  };
  visit(parsed);
  if (strings.length === 0) return raw;
  return strings.map((text) => `- ${text}`).join("\n");
}
