/**
 * Studio Palette Suggest — AI 색상 팔레트 추천(BYOK)의 프롬프트 구성/응답 파싱(순수 코어).
 *
 * 사용자가 장르/무드를 짧게 설명하면(예: "스릴러, 어둡고 차가운 느낌" / "청춘로맨스, 파스텔톤"),
 * 그 장면에 어울리는 색상 팔레트(5~6색, 각 색의 용도 설명 포함)를 받는다. 실제 fetch 오케스트레이션은
 * studio-ai-client.ts의 suggestColorPalette(얇은 래퍼)가 담당한다 — 이 파일은 프롬프트 문자열 조합과
 * 응답 파싱만 한다(fetch 없음, 순수·결정적, studio-scenario-scenes.ts/studio-dialogue-suggest.ts와
 * 동일한 역할 분담).
 *
 * 응답은 대사 제안(배열)과 달리 팔레트 이름 + 색 목록을 함께 담아야 해서 최상위가 JSON **객체**다 —
 * studio-scenario-scenes.ts와 동일하게 중괄호 짝을 맞춰 찾는 전략을 쓴다(대괄호 버전인
 * studio-dialogue-suggest.extractJsonArrayLiteral과는 다른 이유). 이 파일 안에
 * extractJsonObjectLiteral을 독립적으로 복제해 둔다 — studio-scenario-scenes.ts가 이미 같은 함수를
 * 갖고 있지만, 작은 순수 함수 하나를 위해 공유 모듈로 추출해 새 임포트 그래프 간선을 만들 이유가 없다는
 * 기존 관례(studio-dialogue-suggest.ts 주석 참고)를 그대로 따른다.
 *
 * 색 값 검증은 새로 만들지 않고 studio-color-utils.normalizeHexColor를 그대로 재사용한다 — 이 모듈이
 * 반환하는 hex는 항상 studio-palette-library.StudioNamedPalette.colors와 같은 정규화된 소문자
 * #rrggbb 형식이라, 호출부가 결과를 바로 createPalette(name, colors)에 넘길 수 있다(새 타입을 만들지
 * 않는다 — 이 파일은 studio-palette-library.ts를 알지도, import하지도 않는다).
 */

import { normalizeHexColor } from "./studio-color-utils";

export interface PaletteSuggestionColor {
  /** 정규화된 소문자 #rrggbb(studio-color-utils.normalizeHexColor 통과분만). */
  hex: string;
  /** 이 색의 용도 설명(예: "주조색", "보조색", "포인트색", "강조색"). 모델이 비워 보내면 빈 문자열. */
  role: string;
}

export interface PaletteSuggestion {
  /** 팔레트 이름 제안(예: "스릴러 - 어둡고 차가운"). 비어 있으면 호출부가 저장 시 기본 이름으로 폴백한다
   *  (studio-palette-library.createPalette가 이미 하는 일 — 여기서 다시 기본값을 채우지 않는다). */
  name: string;
  colors: PaletteSuggestionColor[];
}

export const PALETTE_SUGGEST_MIN_COLORS = 5;
export const PALETTE_SUGGEST_MAX_COLORS = 6;

/** 파싱 후 상한 — 모델이 지시를 어기고 더 많이 반환해도 앞에서부터만 취한다(UI 과다 방어). */
export const PALETTE_SUGGEST_MAX_PARSED = 8;

const JSON_SHAPE_EXAMPLE =
  '{"name":"스릴러 - 어둡고 차가운","colors":[{"hex":"#101820","role":"주조색(배경·그림자)"},' +
  '{"hex":"#2b3a42","role":"보조색"},{"hex":"#4a5a5e","role":"보조색"},' +
  '{"hex":"#8fa3a8","role":"중간톤"},{"hex":"#c94f4f","role":"포인트색(긴장·경고)"}]}';

/**
 * 프롬프트(system/user) 구성 — 순수·결정적. moodText(장르/무드 설명)를 그대로 user 메시지로 보낸다
 * (studio-dialogue-suggest.buildDialogueSuggestPrompt와 동일하게, 프롬프트 조합과 fetch 오케스트레이션을
 * 분리해 독립적으로 테스트 가능하게 둔다).
 */
export function buildPaletteSuggestPrompt(moodText: string): { system: string; user: string } {
  const system = [
    "당신은 웹툰 장면에 어울리는 색상 팔레트를 제안하는 색채 디자이너입니다. 사용자가 설명하는 장르나 " +
      "무드를 읽고, 그 장면 연출에 어울리는 색상 팔레트를 제안하세요.",
    `팔레트는 정확히 ${PALETTE_SUGGEST_MIN_COLORS}~${PALETTE_SUGGEST_MAX_COLORS}개의 색으로 구성하세요.`,
    "다른 설명이나 마크다운 코드블록 없이, 반드시 아래 예시와 동일한 구조의 JSON 객체 하나만 응답하세요.",
    JSON_SHAPE_EXAMPLE,
    "name: 이 팔레트에 어울리는 짧은 한국어 이름(장르·무드를 요약).",
    "hex: #rrggbb 형식의 유효한 헥스 색상 코드.",
    'role: 이 색의 용도를 한국어로 간단히(예: "주조색", "보조색", "포인트색", "강조색" 등).',
  ].join("\n");
  return { system, user: moodText.trim() };
}

/** raw 문자열에서 첫 `{` 로 시작해 짝이 맞는(중첩 중괄호를 세어가며 찾은) `}` 까지를 잘라낸다.
 *  코드펜스나 앞뒤 설명 문장이 섞여 있어도 객체 부분만 뽑아낸다. 짝이 맞는 `}` 를 찾지 못하면 null. */
function extractJsonObjectLiteral(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * 모델 응답(자유 텍스트, 코드펜스·설명 섞여 있을 수 있음)에서 첫 JSON 객체를 뽑아 PaletteSuggestion으로
 * 파싱한다. hex가 normalizeHexColor를 통과하지 못하는 색 항목은 환각/오류로 간주해 건너뛴다. 파싱 자체
 * 실패·유효 색 0개는 ok:false.
 */
export function parsePaletteSuggestResponse(
  raw: string
): { ok: true; data: PaletteSuggestion } | { ok: false; error: string } {
  const jsonText = extractJsonObjectLiteral(raw);
  if (!jsonText) return { ok: false, error: "응답에서 팔레트 제안(JSON 객체)을 찾을 수 없습니다." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "팔레트 제안 응답을 해석하지 못했습니다(JSON 형식이 아닙니다)." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "팔레트 제안 응답 형식이 올바르지 않습니다(JSON 객체가 아닙니다)." };
  }

  const obj = parsed as Record<string, unknown>;
  const colorsRaw = obj.colors;
  if (!Array.isArray(colorsRaw) || colorsRaw.length === 0) {
    return { ok: false, error: "팔레트 제안 응답에 색상(colors) 목록이 없습니다." };
  }

  const colors: PaletteSuggestionColor[] = [];
  for (const entry of colorsRaw.slice(0, PALETTE_SUGGEST_MAX_PARSED)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const hex = typeof e.hex === "string" ? normalizeHexColor(e.hex) : null;
    if (!hex) continue; // 유효하지 않은 헥스 값은 조용히 건너뛴다(환각/오타 방어).
    const role = typeof e.role === "string" ? e.role.trim() : "";
    colors.push({ hex, role });
  }
  if (colors.length === 0) {
    return { ok: false, error: "팔레트 제안 응답에서 유효한 색을 찾지 못했습니다." };
  }

  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  return { ok: true, data: { name, colors } };
}
