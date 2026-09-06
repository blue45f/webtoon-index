/**
 * Studio Dialogue Translate — 대사 다국어 번역(BYOK)의 순수 코어.
 *
 * studio-dialogue-batch.ts 의 목록화(collectDialogueItems/isDialogueElement)를 값 그대로
 * 재사용한다(재구현하지 않음). 이 파일이 새로 추가하는 것은 "번역 결과를 페이지별로 보관하고,
 * 활성 언어를 캔버스 텍스트에 반영하는" 계층뿐이다. 프롬프트 구성/응답 파싱은 순수(fetch 없음) —
 * 실제 네트워크 호출은 studio-ai-client.ts 의 얇은 래퍼(translateDialogueBatch)가 담당한다.
 *
 * 규칙(studio-dialogue-batch.ts 와 동일 규율):
 *  - Konva/DOM 의존 없음(전부 순수·결정적). 사용자 노출 문자열은 한글.
 *  - 입력 배열/객체는 절대 변형하지 않는다. 바뀐 페이지·요소만 새 객체로 만들고,
 *    바뀐 것이 하나도 없으면 입력 배열을 그대로(참조 동일) 돌려준다 — 호출부가
 *    `next !== pages` 로 불필요한 히스토리 커밋을 피할 수 있다.
 *
 * 번역 결과는 요소 필드가 아니라 페이지 사이드 저장소(dialogueI18n)에 둔다 — el.text 는 항상
 * "지금 화면에 보이는 언어"만 담고, 다른 언어 텍스트는 dialogueI18n 에만 존재한다. 그래서 캔버스
 * 렌더·SVG/PSD/PDF 내보내기 등 el.text 를 읽는 기존 코드는 전혀 수정 없이 "지금 활성 로케일"
 * 기준으로 그대로 동작한다(docs/studio-dialogue-translate-integration.md §2/§6 참고).
 */

import { isDialogueElement, type DialogueBatchItem, type DialoguePageLike } from "./studio-dialogue-batch";

// ── 로케일 ────────────────────────────────────────────────────────────────

/** 원문(번역 이전 원본 텍스트)을 가리키는 예약 로케일 키. 사용자에게 노출 시 "원문"으로 표시. */
export const SOURCE_LOCALE = "source";

export interface LocalePreset {
  code: string;
  label: string;
}

/** UI 드롭다운의 기본 제시 목록 — 자유 입력(커스텀 코드)도 항상 허용한다(select+직접입력 병행,
 *  studio-ai-client.ts 의 imageModel/textModel 자유 텍스트 입력과 동일 관례). */
export const DIALOGUE_LOCALE_PRESETS: LocalePreset[] = [
  { code: "en", label: "영어" },
  { code: "ja", label: "일본어" },
  { code: "zh-Hans", label: "중국어(간체)" },
  { code: "zh-Hant", label: "중국어(번체)" },
  { code: "es", label: "스페인어" },
  { code: "th", label: "태국어" },
  { code: "id", label: "인도네시아어" },
  { code: "fr", label: "프랑스어" },
];

/** 프리셋에 없는 코드(자유 입력)는 코드 자체를 라벨로 되돌린다. */
export function localeLabel(code: string): string {
  return DIALOGUE_LOCALE_PRESETS.find((p) => p.code === code)?.label ?? code;
}

// ── 데이터 모델 ───────────────────────────────────────────────────────────

/** elementId → localeCode(SOURCE_LOCALE 포함) → 텍스트. PageState.dialogueI18n 에 그대로 저장. */
export type DialogueLocaleMap = Record<string, Record<string, string>>;

/** studio-dialogue-batch.DialoguePageLike + 번역 저장소. StudioPage 의 PageState 가 구조적으로
 *  만족한다(dialogueI18n? 필드 하나만 추가하면 캐스팅 없이 대입 가능). */
export interface DialogueTranslatePageLike extends DialoguePageLike {
  dialogueI18n?: DialogueLocaleMap;
}

/** 생성 결과 1건 — 어느 페이지 소속인지 함께 들고 있어 applyDialogueTranslations 가 페이지를
 *  다시 찾아 순회하지 않아도 된다(collectDialogueItems 결과의 pageId 를 그대로 흘려보냄). */
export interface DialogueTranslationResultItem {
  id: string;
  pageId: string;
  text: string;
}

/** buildTranslationPrompt 가 실제로 필요로 하는 최소 필드만 — DialogueBatchItem 전체(픽셀 위치·
 *  잠금 상태 등 무관 필드 포함)를 요구하지 않아, 호출부(studio-ai-client.ts)가 얇은 {id,text}만
 *  넘길 때 불필요한 캐스팅이 없다(docs/studio-dialogue-translate-integration.md §3 의 구현 제안). */
export type DialogueTranslatableItem = Pick<DialogueBatchItem, "id" | "text">;

// ── 청크 분할(비용/지연 상한) ──────────────────────────────────────────────

export interface ChunkOptions {
  maxItems?: number;
  maxChars?: number;
}

/**
 * 대사 항목을 항목수/문자수 상한 중 먼저 닿는 기준으로 청크로 나눈다(순수·결정적).
 * 기본 maxItems=40, maxChars=6000 — 페이지 수백 개짜리 문서도 유한한 청크로 끊어 순차 요청한다.
 * 한 항목의 텍스트 자체가 maxChars 보다 길어도 항목을 더 쪼개지는 않는다(대사 하나를 문장 중간에서
 * 잘라 보낼 수는 없으므로 — 청크 경계는 항상 항목과 항목 "사이"에만 생긴다).
 * maxItems 는 최소 1로 방어한다 — 0 이하가 들어오면 "현재 청크가 이미 가득 찼다" 판정이 빈
 * 청크(current.length가 0인 상태)에서도 참이 되어, 매 항목마다 그 앞에 빈 배열 청크를 하나씩
 * 끼워 넣게 된다(예: maxItems:0 → `[[], [item1], [item2], ...]`). 이 빈 청크가 그대로
 * translateDialogueBatch 에 전달되면 "번역할 대사가 없습니다" 오류로 전체 생성이 즉시 실패한다.
 */
export function chunkDialogueItemsForTranslation(
  items: readonly DialogueBatchItem[],
  opts: ChunkOptions = {}
): DialogueBatchItem[][] {
  const maxItems = Math.max(1, opts.maxItems ?? 40);
  const maxChars = opts.maxChars ?? 6000;
  const chunks: DialogueBatchItem[][] = [];
  let current: DialogueBatchItem[] = [];
  let currentChars = 0;

  for (const item of items) {
    const overflowsItems = current.length >= maxItems;
    const overflowsChars = current.length > 0 && currentChars + item.text.length > maxChars;
    if (overflowsItems || overflowsChars) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(item);
    currentChars += item.text.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// ── 프롬프트 구성(순수 — fetch 없음, studio-ai-client.ts 가 호출) ─────────

/**
 * 시스템/유저 메시지 쌍을 만든다. 유저 메시지엔 각 항목을 `{"id":"...","text":"..."}` 형태의 JSON
 * 배열로 나열해 모델이 같은 id 로 응답하게 강제한다(파싱 안정성). glossary(용어집)는 "이름: 번역"
 * 자유 텍스트를 그대로 시스템 프롬프트에 삽입한다(별도 파싱 없음 — 사용자가 원하는 형식으로 적어도
 * 모델이 맥락으로 활용하게 둔다). 빈 glossary 는 관련 문구 자체를 생략한다.
 */
export function buildTranslationPrompt(
  items: readonly DialogueTranslatableItem[],
  targetLocaleLabel: string,
  glossary: string
): { system: string; user: string } {
  const systemLines = [
    "당신은 한국 웹툰 대사를 번역하는 전문 번역가입니다.",
    `아래 JSON 배열의 각 항목을 한국어에서 ${targetLocaleLabel}로 번역하세요.`,
    "각 항목의 id는 그대로 유지하고 text만 번역 결과로 바꾸세요.",
    '번역 외 다른 설명 없이 원본과 같은 구조의 JSON 배열만 응답하세요. 예: [{"id":"a1","text":"..."}]',
    "말풍선 안에서 자연스럽게 읽히는 구어체로 번역하고, 원문의 줄바꿈이 나타내는 의미 단위를 보존하세요.",
  ];
  const trimmedGlossary = glossary.trim();
  if (trimmedGlossary) {
    systemLines.push(`다음 용어집을 참고하세요(고유명사·말투 등 일관성 유지):\n${trimmedGlossary}`);
  }
  const user = JSON.stringify(items.map((it) => ({ id: it.id, text: it.text })));
  return { system: systemLines.join("\n"), user };
}

// ── 응답 파싱(순수 — 방어적) ────────────────────────────────────────────────

/**
 * raw 문자열에서 첫 `[` 로 시작해 그와 짝이 맞는(중첩 대괄호를 세어가며 찾은) `]` 까지를 잘라낸다.
 * 코드펜스(```json ... ```)나 앞뒤 설명 문장이 섞여 있어도 배열 부분만 뽑아낸다. 짝이 맞는 `]` 를
 * 찾지 못하면(배열 자체가 없거나 잘린 응답) null. 번역 텍스트 안에 대괄호 문자가 그대로(짝 없이)
 * 등장하는 극단적 경우는 오검출할 수 있으나, 그 경우도 이어지는 JSON.parse 가 실패해 ok:false 로
 * 안전하게 귀결된다(크래시 없음 — 정직성 규약).
 */
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
 * 모델 응답(자유 텍스트, 코드펜스·설명 섞여 있을 수 있음)에서 첫 JSON 배열만 뽑아 `{id,text}[]`로
 * 파싱한다. expectedIds 에 없는 id 는 무시(환각 방어), 파싱 자체가 실패하면 ok:false. **부분 성공은
 * 실패로 취급하지 않는다** — 일부 id 만 와도 그만큼만 반영하고 나머지는 "다음 생성에서 재시도
 * 가능"으로 안내한다(정직성 규약, studio-svg-export.ts 의 skipped 목록과 같은 태도).
 */
export function parseTranslationResponse(
  raw: string,
  expectedIds: readonly string[]
): { ok: true; translations: Map<string, string> } | { ok: false; error: string } {
  const jsonText = extractJsonArrayLiteral(raw);
  if (!jsonText) return { ok: false, error: "응답에서 번역 결과(JSON 배열)를 찾을 수 없습니다." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "번역 응답을 해석하지 못했습니다(JSON 형식이 아닙니다)." };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: "번역 응답 형식이 배열이 아닙니다." };

  const expected = new Set(expectedIds);
  const translations = new Map<string, string>();
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const id = (entry as Record<string, unknown>).id;
    const text = (entry as Record<string, unknown>).text;
    if (typeof id !== "string" || typeof text !== "string") continue;
    if (!expected.has(id)) continue; // 요청하지 않은 id 는 환각으로 간주해 무시.
    translations.set(id, text);
  }
  return { ok: true, translations };
}

// ── 병합·전환(순수, 입력 배열 불변 — studio-dialogue-batch.ts 와 동일 규율) ─

/**
 * 번역 결과를 페이지의 dialogueI18n 에 병합한다. 대상 요소에 dialogueI18n 엔트리가 아직 없으면
 * 이 요소의 **현재 el.text**(호출 시점 캔버스 텍스트, 즉 원문)를 SOURCE_LOCALE 로 함께 시딩한다
 * (그래야 나중에 "원문 보기"가 항상 가능 — 첫 번역 그 순간의 원문만 스냅샷하면 충분). el.text 자체는
 * 바꾸지 않는다(활성 로케일 전환은 별도 단계 — switchDialogueLocale). 변경 없는 페이지는 참조 유지.
 */
export function applyDialogueTranslations<P extends DialogueTranslatePageLike>(
  pages: readonly P[],
  results: readonly DialogueTranslationResultItem[],
  locale: string
): readonly P[] {
  if (results.length === 0) return pages;

  const textByPageEl = new Map<string, Map<string, string>>();
  for (const r of results) {
    let byEl = textByPageEl.get(r.pageId);
    if (!byEl) {
      byEl = new Map();
      textByPageEl.set(r.pageId, byEl);
    }
    byEl.set(r.id, r.text);
  }

  let changed = false;
  const next = pages.map((page): P => {
    const textById = textByPageEl.get(page.id);
    if (!textById || textById.size === 0) return page;

    let pageChanged = false;
    const dialogueI18n: DialogueLocaleMap = { ...(page.dialogueI18n ?? {}) };
    for (const el of page.elements) {
      const text = textById.get(el.id);
      if (text === undefined || !isDialogueElement(el)) continue;
      const existing = dialogueI18n[el.id];
      const alreadySeeded = existing?.[SOURCE_LOCALE] !== undefined;
      if (alreadySeeded && existing?.[locale] === text) continue; // 실질 변경 없음 — 참조 유지.
      dialogueI18n[el.id] = {
        ...existing,
        [SOURCE_LOCALE]: existing?.[SOURCE_LOCALE] ?? el.text, // 최초 1회만 원문 스냅샷.
        [locale]: text,
      };
      pageChanged = true;
    }
    if (!pageChanged) return page;
    changed = true;
    // dialogueI18n 은 DialogueTranslatePageLike 제약이 보장하는 필드만 덮어쓰므로, P 의 다른 필드는
    // 스프레드로 그대로 보존된다 — 제네릭 P 를 구체 타입으로 재구성했음을 여기서만 단언한다.
    return { ...page, dialogueI18n } as P;
  });
  return changed ? next : pages;
}

/**
 * 문서 전체에서 dialogueI18n[el.id]?.[locale] 이 있는 요소만 el.text 를 그 값으로 바꾼다.
 * **해당 로케일 번역이 없는 요소는 그대로 둔다**(부분 번역이 나머지를 빈 텍스트로 지우지 않음 —
 * 정직성 규약). locale===SOURCE_LOCALE 이면 원문으로 되돌리는 동작이 된다(대칭적으로 동일 함수).
 */
export function switchDialogueLocale<P extends DialogueTranslatePageLike>(
  pages: readonly P[],
  locale: string
): readonly P[] {
  let changed = false;
  const next = pages.map((page): P => {
    const dialogueI18n = page.dialogueI18n;
    if (!dialogueI18n) return page;

    let pageChanged = false;
    const elements = page.elements.map((el) => {
      if (!isDialogueElement(el)) return el;
      const text = dialogueI18n[el.id]?.[locale];
      if (text === undefined || el.text === text) return el;
      pageChanged = true;
      return { ...el, text };
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, elements } as P;
  });
  return changed ? next : pages;
}

// ── 통계(패널 배지용) ────────────────────────────────────────────────────────

/** 문서 전체에 하나라도 존재하는 로케일 코드 목록(SOURCE_LOCALE 제외, 등장 순서). */
export function dialogueLocalesForPages(pages: readonly DialogueTranslatePageLike[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const page of pages) {
    const map = page.dialogueI18n;
    if (!map) continue;
    for (const localeMap of Object.values(map)) {
      for (const code of Object.keys(localeMap)) {
        if (code === SOURCE_LOCALE || seen.has(code)) continue;
        seen.add(code);
        order.push(code);
      }
    }
  }
  return order;
}

/** 해당 로케일의 번역 커버리지 — { total: 전체 대사 요소 수, translated: 그중 번역 보유 수 }. */
export function dialogueTranslationCoverage(
  pages: readonly DialogueTranslatePageLike[],
  locale: string
): { total: number; translated: number } {
  let total = 0;
  let translated = 0;
  for (const page of pages) {
    const map = page.dialogueI18n;
    for (const el of page.elements) {
      if (!isDialogueElement(el)) continue;
      total += 1;
      if (map?.[el.id]?.[locale] !== undefined) translated += 1;
    }
  }
  return { total, translated };
}
