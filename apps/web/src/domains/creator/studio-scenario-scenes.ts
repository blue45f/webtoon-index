/**
 * Studio Scenario Scenes — 시나리오 자동 생성(투닝/투툰/WeToon 벤치마크, docs/studio-competitor-features.md
 * §4 로드맵 참고)의 "장면 분할" 1단계 프롬프트 구성/응답 파싱.
 *
 * 스토리 아이디어 텍스트 하나를 여러 장면(컷)으로 나누는 Chat Completions 호출 1회의 프롬프트와
 * 응답 파싱만 담당한다(순수 — fetch 없음, studio-ai-client.generateScenarioScenes가 실제 호출을
 * 담당). 각 장면의 dialogue 필드는 **새 JSON 스키마를 발명하지 않고**, 기존 "대사 한 번에"(코미포식
 * 말풍선 일괄 삽입) 기능이 이미 파싱하는 미니 문법을 그대로 쓰도록 프롬프트에 명시한다 —
 * studio-dialogue.parseDialogueScript("이름: 대사" 줄 / "(지문)" 줄)가 그대로 이 문자열을 소비한다
 * (studio-scenario-layout.ts가 그 파서를 재사용해 말풍선을 배치 — 이중 구현 없음).
 *
 * 이미지 생성은 이 모듈의 책임이 아니다 — 각 장면의 imagePrompt는 그 장면의 배경/상황/구도 묘사일
 * 뿐이고, 실제 이미지 생성(순차 호출·캐릭터 일관성 유지)은 StudioPage.tsx 오케스트레이션이 담당한다.
 *
 * 응답 파싱은 studio-dialogue-translate.ts의 "코드펜스·설명 문장이 섞여도 JSON 리터럴만 방어적으로
 * 뽑아내는" 전략과 동일 발상이되, 이쪽 최상위는 배열이 아니라 객체({characterDescription, scenes})라
 * 대괄호 대신 중괄호 짝을 맞춰 찾는다.
 */

import { normalizeScenarioBeatType, type ScenarioBeatType } from "./studio-story-beats";

import type { StudioStoryBeat } from "./studio-continuity";

export type ScenarioContinuityMetadata = Omit<StudioStoryBeat, "sceneId">;

export interface ScenarioSceneDraft {
  /** 장면의 서사 역할. 레거시 제공자가 생략하면 layout 단계에서 transition으로 정규화한다. */
  beatType?: ScenarioBeatType;
  /** 이 장면에서 무엇이 일어나고 무엇이 달라지는지 설명하는 한 문장. */
  summary?: string;
  /** 이 장면의 배경·상황·구도 묘사(그림 생성용). 인물 외모 세부묘사는 반복하지 않는다 —
   *  그건 ScenarioScenesPlan.characterDescription 쪽 책임이다. 대사만 있고 배경 지시가 없는
   *  장면은 빈 문자열일 수 있다. */
  imagePrompt: string;
  /** studio-dialogue.parseDialogueScript 호환 미니 문법("이름: 대사" 줄 / "(지문)" 줄, 빈 줄 무시).
   *  대사가 없는 장면(지문 없는 순수 배경 컷)은 빈 문자열. */
  dialogue: string;
  /** 연속성 린트가 자유문장 추론 없이 비교할 수 있는 장면 사실. */
  continuity?: ScenarioContinuityMetadata;
}

export interface ScenarioScenesPlan {
  /** 등장인물 외모 공통 묘사(헤어스타일·의상·특징 등 한 문장) — 특정 인물이 없으면 빈 문자열.
   *  첫 장면 이미지 생성 프롬프트에 합쳐져 "기준 캐릭터"의 외모를 확립하는 데 쓰이고, 이후 장면은
   *  그 이미지를 참고로 캐릭터 일관성 생성(generateConsistentCharacterImage)을 탄다. */
  characterDescription: string;
  scenes: ScenarioSceneDraft[];
}

export const SCENARIO_SCENE_COUNT_MIN = 2;
export const SCENARIO_SCENE_COUNT_MAX = 10;

/** 파싱 후 상한 — 모델이 지시를 어기고 수십 개를 반환해도 과금/시간 폭주를 막는다(넘치면 앞에서부터만). */
export const SCENARIO_MAX_PARSED_SCENES = 12;

function isValidSceneCountHint(n: number | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= SCENARIO_SCENE_COUNT_MIN && n <= SCENARIO_SCENE_COUNT_MAX;
}

const JSON_SHAPE_EXAMPLE =
  '{"characterDescription":"단발머리 여고생, 교복 차림","scenes":[{"beatType":"setup","summary":"등굣길에 두 친구가 재회한다","imagePrompt":"아침 등굣길, 골목, 벚꽃","dialogue":"민수: 안녕!\\n(잠시 정적)","continuity":{"characterNames":["민수"],"location":"학교 앞","time":"아침","costumes":{"민수":"교복"},"props":{"우산":"민수가 들고 있음"},"transitionExplanations":{}}}]}';

/**
 * 장면 분할 프롬프트(system/user) — 순수·결정적. sceneCountHint가 유효 범위(2~10)면 "정확히 N개"로,
 * 아니면 스토리 길이에 맞게 3~8개 사이로 자연스럽게 나누라고 지시한다.
 */
export function buildScenarioScenesPrompt(
  storyText: string,
  sceneCountHint?: number,
  characterContext = ""
): { system: string; user: string } {
  const countInstruction = isValidSceneCountHint(sceneCountHint)
    ? `정확히 ${Math.round(sceneCountHint)}개의 장면으로 나누세요.`
    : "스토리 길이에 맞게 자연스럽게 3~8개의 장면으로 나누세요.";

  const normalizedCharacterContext = characterContext.trim().slice(0, 12_000);
  const system = [
    "당신은 한국 웹툰 시나리오 작가입니다. 사용자가 입력한 짧은 스토리 아이디어를 여러 개의 장면(컷)으로 나눕니다.",
    countInstruction,
    "다른 설명이나 마크다운 코드블록 없이, 반드시 아래 예시와 동일한 구조의 JSON 객체 하나만 응답하세요.",
    JSON_SHAPE_EXAMPLE,
    "characterDescription: 이야기에 등장하는 주요 인물의 외모(헤어스타일·의상·특징 등)를 한국어 한 문장으로. 특정 인물이 없으면 빈 문자열.",
    '각 장면의 beatType: "setup"(도입), "inciting"(사건 발생), "escalation"(고조), "turn"(전환), "climax"(절정), "resolution"(해결), "transition"(연결) 중 하나.',
    "각 장면의 summary: 이 장면에서 무엇이 일어나고 무엇이 달라지는지 한국어 한 문장으로.",
    "각 장면의 imagePrompt: 그 장면의 배경·상황·구도를 그림으로 그리기 위한 묘사(인물 외모 묘사는 반복하지 마세요 — 상황·배경 위주).",
    '각 장면의 dialogue: 그 장면 대사를 한 줄에 한 마디씩 "이름: 대사" 형식으로 적으세요(지문·내레이션은 "(지문)"처럼 괄호로 감싸세요). 대사가 없는 장면은 빈 문자열("")로 두세요.',
    "각 장면의 continuity: characterNames(등장인물 이름 배열), location(장소), time(시간대), costumes(캐릭터 이름→의상), props(소품 이름→상태·소유·위치)를 명시하세요.",
    "직전 장면과 장소·시간·의상·소품이 의도적으로 달라지면 continuity.transitionExplanations의 같은 필드(의상·소품은 같은 이름 키)에 변경 이유를 적으세요. 알 수 없는 값은 추측하지 말고 생략하세요.",
    ...(normalizedCharacterContext
      ? ["사용자 메시지의 캐릭터 바이블을 모든 장면에 일관되게 반영하고, [고정] 표시가 붙은 설정은 바꾸거나 모순되게 쓰지 마세요."]
      : []),
  ].join("\n");

  return {
    system,
    user: normalizedCharacterContext
      ? `[캐릭터 바이블]\n${normalizedCharacterContext}\n\n[스토리 아이디어]\n${storyText.trim()}`
      : storyText.trim(),
  };
}

function normalizedSceneText(value: unknown, maxLength = 240): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizedSceneList(value: unknown): string[] {
  const input = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,;\n]+/u)
      : [];
  const result: string[] = [];
  for (const item of input) {
    const text = normalizedSceneText(item, 80);
    if (text && !result.includes(text)) result.push(text);
    if (result.length >= 24) break;
  }
  return result;
}

function normalizedNamedSceneValues(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = normalizedSceneText(rawKey, 80);
    const text = normalizedSceneText(rawValue, 240);
    if (!key || !text || Object.hasOwn(result, key)) continue;
    result[key] = text;
    if (Object.keys(result).length >= 24) break;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Normalizes optional structured facts returned by an AI provider or restored from a draft. */
export function normalizeScenarioContinuity(value: unknown): ScenarioContinuityMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const characterNames = normalizedSceneList(record.characterNames);
  const location = normalizedSceneText(record.location);
  const time = normalizedSceneText(record.time);
  const costumes = normalizedNamedSceneValues(record.costumes);
  const props = normalizedNamedSceneValues(record.props);
  const transitionRecord =
    record.transitionExplanations && typeof record.transitionExplanations === "object" &&
    !Array.isArray(record.transitionExplanations)
      ? record.transitionExplanations as Record<string, unknown>
      : {};
  const transitionLocation = normalizedSceneText(transitionRecord.location);
  const transitionTime = normalizedSceneText(transitionRecord.time);
  const transitionCostumes = normalizedNamedSceneValues(transitionRecord.costumes);
  const transitionProps = normalizedNamedSceneValues(transitionRecord.props);
  const transitionExplanations =
    transitionLocation || transitionTime || transitionCostumes || transitionProps
      ? {
          ...(transitionLocation ? { location: transitionLocation } : {}),
          ...(transitionTime ? { time: transitionTime } : {}),
          ...(transitionCostumes ? { costumes: transitionCostumes } : {}),
          ...(transitionProps ? { props: transitionProps } : {}),
        }
      : undefined;
  const result: ScenarioContinuityMetadata = {
    ...(characterNames.length > 0 ? { characterNames } : {}),
    ...(location ? { location } : {}),
    ...(time ? { time } : {}),
    ...(costumes ? { costumes } : {}),
    ...(props ? { props } : {}),
    ...(transitionExplanations ? { transitionExplanations } : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

/** raw 문자열에서 첫 `{` 로 시작해 짝이 맞는(중첩 중괄호를 세어가며 찾은) `}` 까지를 잘라낸다.
 *  코드펜스(```json ... ```)나 앞뒤 설명 문장이 섞여 있어도 객체 부분만 뽑아낸다 — 짝이 맞는 `}` 를
 *  찾지 못하면(잘린 응답 등) null(studio-dialogue-translate.extractJsonArrayLiteral과 동일 전략,
 *  대괄호 대신 중괄호). */
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
 * 모델 응답(자유 텍스트, 코드펜스·설명 섞여 있을 수 있음)에서 첫 JSON 객체를 뽑아 ScenarioScenesPlan
 * 으로 파싱한다. 완전히 빈 장면(summary·imagePrompt·dialogue가 모두 빈 문자열)은 환각 방어로 건너뛴다.
 * 파싱 자체 실패·유효 장면 0개는 ok:false.
 */
export function parseScenarioScenesResponse(
  raw: string
): { ok: true; data: ScenarioScenesPlan } | { ok: false; error: string } {
  const jsonText = extractJsonObjectLiteral(raw);
  if (!jsonText) return { ok: false, error: "응답에서 장면 구성(JSON 객체)을 찾을 수 없습니다." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "장면 구성 응답을 해석하지 못했습니다(JSON 형식이 아닙니다)." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "장면 구성 응답 형식이 올바르지 않습니다(JSON 객체가 아닙니다)." };
  }

  const obj = parsed as Record<string, unknown>;
  const scenesRaw = obj.scenes;
  if (!Array.isArray(scenesRaw) || scenesRaw.length === 0) {
    return { ok: false, error: "장면 구성 응답에 장면(scenes) 목록이 없습니다." };
  }

  const scenes: ScenarioSceneDraft[] = [];
  for (const entry of scenesRaw.slice(0, SCENARIO_MAX_PARSED_SCENES)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const summary = typeof e.summary === "string" ? e.summary.trim().slice(0, 240) : "";
    const imagePrompt = typeof e.imagePrompt === "string" ? e.imagePrompt.trim() : "";
    const dialogue = typeof e.dialogue === "string" ? e.dialogue.trim() : "";
    const continuity = normalizeScenarioContinuity(e.continuity);
    if (!summary && !imagePrompt && !dialogue) continue; // 완전히 빈 장면은 환각으로 간주해 건너뛴다.
    scenes.push({
      ...(typeof e.beatType === "string" ? { beatType: normalizeScenarioBeatType(e.beatType) } : {}),
      ...(summary ? { summary } : {}),
      imagePrompt,
      dialogue,
      ...(continuity ? { continuity } : {}),
    });
  }
  if (scenes.length === 0) {
    return { ok: false, error: "장면 구성 응답에서 유효한 장면을 찾지 못했습니다." };
  }

  const characterDescription = typeof obj.characterDescription === "string" ? obj.characterDescription.trim() : "";
  return { ok: true, data: { characterDescription, scenes } };
}
