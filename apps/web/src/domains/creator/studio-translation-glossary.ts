/**
 * Studio Translation Glossary — 용어집 규칙의 파싱과 충돌 판정만 담는 순수 엔진.
 *
 * 왜 이 모듈이 따로 있어야 하는가
 * ------------------------------
 * 이 코드는 원래 `studio-translation-memory.ts` 안에 있었다. 그 파일은 순수 엔진이 아니다 —
 * `StudioTranslationMemoryStorage = Pick<Storage, …>` 라는 **브라우저 타입**을 들고 있고,
 * `studioTranslationMemoryBrowserStorage()`가 `globalThis.localStorage`를 만진다. 즉 저장소가
 * 같은 모듈에 붙어 있다.
 *
 * 그래서 `lettering/` 아래의 순수 엔진(현지화 QA 조립층)이 용어집 판정을 쓰려고 하면 저장소까지
 * 딸려 들어온다. 하우스 관례(측정·저장은 호출부가 주입한다)를 어기는 의존이고, 테스트에서
 * `localStorage` 없는 환경을 만들어 주어야 하는 이유도 없다. **판정은 순수하고, 저장은 아니다** —
 * 이 파일은 그 경계를 파일 경계로 만든 것이다.
 *
 * 이동은 순수 이동이다. 이름·시그니처·동작을 바꾸지 않았고,
 * `studio-translation-memory.ts`가 전부 같은 이름으로 다시 내보내므로 기존 호출부는 한 글자도
 * 고치지 않는다. 단 하나의 예외가 §5에 주석으로 표시된 대소문자 중복 제거 결함 수정이다.
 *
 * 이 모듈이 하지 않는 것
 * ---------------------
 *  · 저장·직렬화·만료. 전부 `studio-translation-memory.ts`가 한다.
 *  · 로케일 폴백. §2 참조 — 정확 일치만 한다. 이건 결함이 아니라 **한계**이고, 그 한계를
 *    테스트가 못으로 박아 두었다.
 *
 * §1. 정규화 — NFKC + 공백 접기
 * §2. 로케일 대조 — 정확 일치만
 * §3. 규칙 모델과 상한
 * §4. 용어집 텍스트 파싱
 * §5. 충돌 판정
 */

// ── §1. 정규화 ────────────────────────────────────────────────────────────────

function normalizeNfkc(value: string): string {
  try {
    return value.normalize("NFKC");
  } catch {
    return value;
  }
}

/** Compatibility-normalizes and collapses every whitespace run to one ASCII space. */
export function normalizeStudioTranslationMemoryText(value: string): string {
  return normalizeNfkc(value).replace(/\s+/gu, " ").trim();
}

export function normalizeCaseInsensitive(value: string): string {
  return normalizeStudioTranslationMemoryText(value).toLowerCase();
}

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function normalizeStoredText(value: string): string {
  return normalizeNfkc(value).trim();
}

export function normalizeLocale(value: string): string {
  return normalizeStudioTranslationMemoryText(value);
}

export function normalizeLocaleKey(value: string): string {
  return normalizeLocale(value).toLowerCase();
}

// ── §2. 로케일 대조 ───────────────────────────────────────────────────────────

/**
 * 규칙의 로케일과 실제 로케일이 맞는지.
 *
 * **정확 문자열 일치다. BCP-47 폴백이 아니다** — `"ko"` 규칙은 `"ko-KR"` 큐에 붙지 않고,
 * `"en"` 규칙은 `"en-US"`에 붙지 않는다. 규칙에 로케일이 없으면(=undefined) 모든 로케일에 붙는다.
 *
 * 폴백을 넣지 않은 이유: 태그 접두 일치는 `"ko"`⊃`"ko-KR"`처럼 맞는 경우와 `"zh"`⊃`"zh-Hant"`
 * (번체/간체는 서로 다른 용어집이다)처럼 **틀리는** 경우가 섞여 있다. 규칙 하나가 조용히 잘못된
 * 회차에 적용되는 쪽이, 안 붙어서 보이지 않는 쪽보다 나쁘다. 폴백이 필요하면 그건 이 함수가 아니라
 * 로케일 해석 계층에서 명시적으로 결정할 문제다.
 */
export function localeMatches(
  ruleLocale: string | undefined,
  actualLocale: string,
): boolean {
  return (
    !ruleLocale || normalizeLocaleKey(ruleLocale) === normalizeLocaleKey(actualLocale)
  );
}

// ── §3. 규칙 모델과 상한 ──────────────────────────────────────────────────────

/**
 * 방어적 상한. 세 값 모두 `studio-translation-memory.ts`에서 그대로 옮겨 온 것이고, 외부 규격이
 * 아니라 이 저장소가 정한 값이다 — **출처 UNVERIFIED**. 근거는 "한 회차 용어집이 이보다 커지면
 * 사람이 관리할 수 없다"는 운영 판단뿐이며, 바꾸고 싶으면 근거를 새로 대면 된다.
 */
export const STUDIO_TRANSLATION_MEMORY_MAX_GLOSSARY_RULES = 160;
export const STUDIO_TRANSLATION_MEMORY_MAX_GLOSSARY_TERM_CHARS = 240;
/** 로케일 태그 길이 상한. 위와 같은 이유로 **UNVERIFIED** (BCP-47 은 길이를 이렇게 제한하지 않는다). */
export const STUDIO_TRANSLATION_MEMORY_MAX_LOCALE_CHARS = 48;

export type StudioTranslationMemoryConflictKind = "ambiguous-rule" | "missing-target";

export interface StudioTranslationMemoryGlossaryRule {
  readonly sourceTerm: string;
  readonly targetTerm: string;
  readonly sourceLocale?: string;
  readonly targetLocale?: string;
  readonly caseSensitive?: boolean;
}

export interface StudioTranslationMemoryGlossaryConflict {
  readonly kind: StudioTranslationMemoryConflictKind;
  readonly sourceTerm: string;
  readonly expectedTargets: readonly string[];
  readonly message: string;
}

export function normalizeGlossaryRule(
  rule: StudioTranslationMemoryGlossaryRule,
): StudioTranslationMemoryGlossaryRule | null {
  const sourceTerm = normalizeStoredText(rule.sourceTerm);
  const targetTerm = normalizeStoredText(rule.targetTerm);
  if (
    sourceTerm.length === 0
    || targetTerm.length === 0
    || sourceTerm.length > STUDIO_TRANSLATION_MEMORY_MAX_GLOSSARY_TERM_CHARS
    || targetTerm.length > STUDIO_TRANSLATION_MEMORY_MAX_GLOSSARY_TERM_CHARS
  ) {
    return null;
  }
  const sourceLocale = rule.sourceLocale
    ? normalizeLocale(rule.sourceLocale).slice(
        0,
        STUDIO_TRANSLATION_MEMORY_MAX_LOCALE_CHARS
      )
    : undefined;
  const targetLocale = rule.targetLocale
    ? normalizeLocale(rule.targetLocale).slice(
        0,
        STUDIO_TRANSLATION_MEMORY_MAX_LOCALE_CHARS
      )
    : undefined;
  return {
    sourceTerm,
    targetTerm,
    sourceLocale: sourceLocale || undefined,
    targetLocale: targetLocale || undefined,
    caseSensitive: rule.caseSensitive === true,
  };
}

/**
 * 규칙이 문자열을 대조할 때 쓰는 정규화. 규칙마다 다르다(`caseSensitive`) — 그래서 **대조에 쓰는
 * 정규화와 중복 제거에 쓰는 정규화가 같아야 한다**. §5의 결함이 정확히 그 둘이 어긋난 것이었다.
 */
function normalizeForRule(rule: StudioTranslationMemoryGlossaryRule, value: string): string {
  return rule.caseSensitive
    ? normalizeStudioTranslationMemoryText(value)
    : normalizeCaseInsensitive(value);
}

// ── §4. 용어집 텍스트 파싱 ────────────────────────────────────────────────────

/** Parses bounded `source: target`, `source = target` or `source => target` glossary lines. */
export function parseStudioTranslationMemoryGlossaryText(
  glossary: string
): StudioTranslationMemoryGlossaryRule[] {
  const rules: StudioTranslationMemoryGlossaryRule[] = [];
  const seen = new Set<string>();
  for (const line of normalizeNfkc(glossary).split(/\r?\n/u)) {
    if (rules.length >= STUDIO_TRANSLATION_MEMORY_MAX_GLOSSARY_RULES) break;
    const match = line.match(/^\s*(.+?)\s*(?:=>|:|=)\s*(.+?)\s*$/u);
    if (!match) continue;
    const rule = normalizeGlossaryRule({
      sourceTerm: match[1],
      targetTerm: match[2],
    });
    if (!rule) continue;
    const key = JSON.stringify([
      normalizeCaseInsensitive(rule.sourceTerm),
      normalizeCaseInsensitive(rule.targetTerm),
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(rule);
  }
  return rules;
}

// ── §5. 충돌 판정 ─────────────────────────────────────────────────────────────

/**
 * 원문·번역문 한 쌍을 용어집에 대고 본다.
 *
 * 대조는 **부분 문자열 포함**이다(`String.prototype.includes`). 단어 경계가 없다 —
 * 영문 `"art"` 규칙은 `"heart"`에 걸리고, 짧은 한국어 용어일수록 더 잘 걸린다. 한국어·일본어·중국어는
 * 공백으로 단어를 나누지 않으므로 단어 경계 자체가 정의되지 않고, 형태소 분석기를 이 순수 모듈에
 * 넣을 수는 없다. 그래서 이 한계는 **없애지 않고 드러낸다** — 호출부는 발견에 이 대조 방식을
 * 증거로 함께 실어야 한다(`lettering/studio-localization-qa.ts` 참조).
 */
export function findStudioTranslationMemoryGlossaryConflicts(input: {
  readonly sourceText: string;
  readonly translation: string;
  readonly sourceLocale: string;
  readonly targetLocale: string;
  readonly rules: readonly StudioTranslationMemoryGlossaryRule[];
}): StudioTranslationMemoryGlossaryConflict[] {
  const applicable = input.rules
    .slice(0, STUDIO_TRANSLATION_MEMORY_MAX_GLOSSARY_RULES)
    .map(normalizeGlossaryRule)
    .filter((rule): rule is StudioTranslationMemoryGlossaryRule => rule !== null)
    .filter(
      (rule) =>
        localeMatches(rule.sourceLocale, input.sourceLocale)
        && localeMatches(rule.targetLocale, input.targetLocale)
    )
    .filter((rule) =>
      normalizeForRule(rule, input.sourceText).includes(
        normalizeForRule(rule, rule.sourceTerm)
      )
    );

  const bySource = new Map<
    string,
    {
      readonly displaySource: string;
      readonly rules: StudioTranslationMemoryGlossaryRule[];
    }
  >();
  for (const rule of applicable) {
    const key = normalizeForRule(rule, rule.sourceTerm);
    const existing = bySource.get(key);
    if (existing) existing.rules.push(rule);
    else bySource.set(key, { displaySource: rule.sourceTerm, rules: [rule] });
  }

  const conflicts: StudioTranslationMemoryGlossaryConflict[] = [];
  for (const [, group] of [...bySource].sort(([left], [right]) =>
    compareCodeUnits(left, right)
  )) {
    // 중복 제거 키는 **그 규칙 자신의 정규화**로 잡는다. 예전에는 무조건 소문자로 접었기 때문에
    // `caseSensitive` 규칙 두 개가 "Bar"/"bar" 처럼 대소문자만 다른 번역을 지정해도 하나로 합쳐져
    // 모호성이 영영 보고되지 않았다(그 규칙들은 정작 대조는 대소문자를 구별해서 한다).
    const expectedTargets = [
      ...new Map(
        group.rules.map((rule) => [
          normalizeForRule(rule, rule.targetTerm),
          rule.targetTerm,
        ])
      ).values(),
    ].sort(compareCodeUnits);
    if (expectedTargets.length > 1) {
      conflicts.push({
        kind: "ambiguous-rule",
        sourceTerm: group.displaySource,
        expectedTargets,
        message: `“${group.displaySource}”에 서로 다른 용어집 번역이 지정되어 있습니다.`,
      });
      continue;
    }
    const firstRule = group.rules[0];
    const translation = normalizeForRule(firstRule, input.translation);
    const expected = normalizeForRule(firstRule, expectedTargets[0]);
    if (!translation.includes(expected)) {
      conflicts.push({
        kind: "missing-target",
        sourceTerm: group.displaySource,
        expectedTargets,
        message: `“${group.displaySource}”은(는) “${expectedTargets[0]}” 규칙과 일치하지 않습니다.`,
      });
    }
  }
  return conflicts;
}
