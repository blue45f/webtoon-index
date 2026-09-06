/**
 * Studio Dialogue Suggest — 대사/나레이션 제안(BYOK)의 프롬프트 구성/응답 파싱(순수 코어).
 *
 * 사용자가 짧은 장면 상황을 설명하면(선택적으로 캔버스에 이미 배치된 대사를 맥락으로 함께 실어),
 * 자연스러운 대사·나레이션 후보 여러 개를 받는다. 실제 fetch 오케스트레이션은
 * studio-ai-client.ts의 suggestDialogueLines(얇은 래퍼)가 담당한다 — 이 파일은 프롬프트 문자열
 * 조합과 응답 파싱만 한다(fetch 없음, 순수·결정적, studio-scenario-scenes.ts/
 * studio-dialogue-translate.ts와 동일한 역할 분담).
 *
 * 응답 파싱은 studio-dialogue-translate.ts의 "코드펜스·설명 문장이 섞여도 첫 JSON 리터럴만
 * 방어적으로 뽑아내는" 전략과 동일하다(최상위가 배열이라 대괄호 짝을 맞춰 찾는다). 이 파일 안에
 * extractJsonArrayLiteral을 독립적으로 복제해 둔다 — studio-scenario-scenes.ts가 중괄호용 사본을
 * 따로 갖고 있는 것과 같은 관례로, 공유 모듈로 추출하면 지금 각 파일이 서로를 몰라도 되는 낮은
 * 결합도가 깨진다(작은 순수 함수 하나를 위해 새 임포트 그래프 간선을 만들 이유가 없다).
 *
 * 각 후보는 studio-dialogue.parseDialogueScript가 그대로 소비하는 "이름: 대사"/"(지문)" 미니 문법
 * 한 줄로 형식화할 수 있다(formatDialogueSuggestionLine) — 새 스키마를 발명하지 않고 기존
 * "대사 한 번에"(parseDialogueScript → layoutDialogueBubbles) 파이프라인에 그대로 태운다
 * (studio-scenario-scenes.ts의 dialogue 필드와 동일한 설계 판단).
 */

export type DialogueSuggestionKind = "speech" | "narration";

export interface DialogueSuggestionCandidate {
  /** 화자 이름. 나레이션(kind="narration")이거나 화자를 특정할 수 없는 대사면 빈 문자열. */
  speaker: string;
  text: string;
  kind: DialogueSuggestionKind;
}

export const DIALOGUE_SUGGEST_MIN_CANDIDATES = 3;
export const DIALOGUE_SUGGEST_MAX_CANDIDATES = 5;

/** 파싱 후 상한 — 모델이 지시를 어기고 더 많이 반환해도 앞에서부터만 취한다(UI 과다 방어). */
export const DIALOGUE_SUGGEST_MAX_PARSED = 8;

/** 맥락으로 함께 보낼 기존 대사 문자열의 문자수 상한(토큰/과금 방어) — 넘으면 뒤(최근 대사)를 우선한다. */
export const DIALOGUE_SUGGEST_CONTEXT_MAX_CHARS = 1200;

const JSON_SHAPE_EXAMPLE =
  '[{"speaker":"민수","text":"나 전학왔어.","kind":"speech"},{"speaker":"","text":"(교실이 순간 조용해진다)","kind":"narration"}]';

/**
 * 프롬프트(system/user) 구성 — 순수·결정적. existingContext(캔버스에 이미 배치된 대사, 있으면)는
 * "지금까지의 대사 흐름"으로 시스템 프롬프트에 삽입해 톤·맥락 일관성을 유도한다(선택 사항 — 빈
 * 문자열이면 관련 문구 자체를 생략해 프롬프트를 불필요하게 늘리지 않는다).
 */
export function buildDialogueSuggestPrompt(
  situationText: string,
  existingContext = ""
): { system: string; user: string } {
  const systemLines = [
    "당신은 한국 웹툰 대사·나레이션 작가입니다. 사용자가 설명하는 장면 상황을 읽고, 그 장면에 어울리는 " +
      `자연스러운 대사·나레이션 후보를 ${DIALOGUE_SUGGEST_MIN_CANDIDATES}~${DIALOGUE_SUGGEST_MAX_CANDIDATES}개 제안하세요.`,
    "각 후보는 서로 독립적인 대안입니다(이어지는 대화 한 편이 아니라, 이 장면에 쓸 수 있는 서로 다른 " +
      "선택지). 후보 하나는 한 마디(대사 한 줄 또는 나레이션 한 문장)로 짧게 쓰세요.",
    "다른 설명이나 마크다운 코드블록 없이, 반드시 아래 예시와 동일한 구조의 JSON 배열 하나만 응답하세요.",
    JSON_SHAPE_EXAMPLE,
    'speaker: 화자 이름(있으면). 나레이션이거나 화자를 특정할 수 없는 대사면 빈 문자열("").',
    'kind: 등장인물의 대사는 "speech", 지문·나레이션은 "narration".',
  ];
  const trimmedContext = existingContext.trim();
  if (trimmedContext) {
    systemLines.push(
      `참고로 이 장면에 이미 배치된 대사 흐름은 다음과 같습니다(같은 톤과 맥락을 이어가세요):\n${trimmedContext}`
    );
  }
  return { system: systemLines.join("\n"), user: situationText.trim() };
}

/**
 * 기존 대사 목록(오래된→최신 순으로 들어온다고 가정)을 프롬프트 맥락 문자열로 접는다. 문자수 상한을
 * 넘으면 **앞(오래된 대사)부터** 잘라내 최근 대사가 우선 보존되게 한다 — 장면의 "지금 흐름"을 이어가는
 * 것이 목적이라 최신 대사가 더 중요하다.
 */
export function joinDialogueContextLines(lines: readonly string[], maxChars = DIALOGUE_SUGGEST_CONTEXT_MAX_CHARS): string {
  const nonEmpty = lines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (nonEmpty.length === 0) return "";
  let total = 0;
  const kept: string[] = [];
  for (let i = nonEmpty.length - 1; i >= 0; i--) {
    const line = nonEmpty[i];
    if (total + line.length > maxChars && kept.length > 0) break; // 최소 1줄은 항상 보존.
    kept.unshift(line);
    total += line.length;
  }
  return kept.join("\n");
}

/** raw 문자열에서 첫 `[` 로 시작해 짝이 맞는(중첩 대괄호를 세어가며 찾은) `]` 까지를 잘라낸다.
 *  코드펜스나 앞뒤 설명 문장이 섞여 있어도 배열 부분만 뽑아낸다. 짝이 맞는 `]` 를 찾지 못하면 null. */
function extractJsonArrayLiteral(raw: string): string | null {
  const start = raw.indexOf("[");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === "[") depth++;
    else if (raw[i] === "]") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * 모델 응답(자유 텍스트, 코드펜스·설명 섞여 있을 수 있음)에서 첫 JSON 배열을 뽑아
 * DialogueSuggestionCandidate[] 로 파싱한다. text 가 빈 문자열인 항목은 환각/무의미로 간주해
 * 건너뛴다. 파싱 자체 실패·유효 후보 0개는 ok:false.
 */
export function parseDialogueSuggestResponse(
  raw: string
): { ok: true; data: DialogueSuggestionCandidate[] } | { ok: false; error: string } {
  const jsonText = extractJsonArrayLiteral(raw);
  if (!jsonText) return { ok: false, error: "응답에서 대사 제안(JSON 배열)을 찾을 수 없습니다." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "대사 제안 응답을 해석하지 못했습니다(JSON 형식이 아닙니다)." };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: "대사 제안 응답 형식이 배열이 아닙니다." };

  const candidates: DialogueSuggestionCandidate[] = [];
  for (const entry of parsed.slice(0, DIALOGUE_SUGGEST_MAX_PARSED)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const text = typeof e.text === "string" ? e.text.trim() : "";
    if (!text) continue;
    const speaker = typeof e.speaker === "string" ? e.speaker.trim() : "";
    const kind: DialogueSuggestionKind = e.kind === "narration" ? "narration" : "speech";
    candidates.push({ speaker, text, kind });
  }
  if (candidates.length === 0) {
    return { ok: false, error: "대사 제안 응답에서 유효한 후보를 찾지 못했습니다." };
  }
  return { ok: true, data: candidates };
}

/**
 * 후보 1개를 studio-dialogue.parseDialogueScript 가 그대로 소비하는 미니 문법 한 줄로 형식화한다.
 * narration은 "(텍스트)"로 감싸고(NARRATION_RE가 줄 전체를 괄호로 감싼 형태만 보므로, 텍스트 내부에
 * 괄호가 더 있어도 안전), speech는 화자가 있으면 "이름: 대사", 없으면 대사만(파서가 직전과 반대쪽으로
 * 자동 배정).
 */
export function formatDialogueSuggestionLine(candidate: DialogueSuggestionCandidate): string {
  if (candidate.kind === "narration") return `(${candidate.text})`;
  return candidate.speaker ? `${candidate.speaker}: ${candidate.text}` : candidate.text;
}
