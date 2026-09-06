/**
 * Studio Localization QA — 세 엔진(문체 린터·넘침 게이트·MQM 채점기)을 회차 한 편에 물리는
 * 조립층.
 *
 * 세 엔진은 서로를 모른다. 그게 옳다 — 린터는 문자열만 보고, 넘침 게이트는 상자만 보고,
 * 채점기는 오류 목록만 본다. 그래서 **누군가는 세 결과를 같은 큐(cue) 위에서 합쳐야 하고**,
 * 그 자리가 여기다. 이 조립을 패널(.tsx) 안에 두면 테스트가 DOM을 거쳐야 하고, 엔진 안에 두면
 * 세 엔진이 서로를 import 하게 된다 — 둘 다 하지 않으려고 이 모듈이 존재한다.
 *
 * 규칙(하우스 관례 그대로):
 *  - 순수·결정적. Konva/DOM 의존 없음. 글자 폭 측정은 `BubbleTextMeasurer` 포트로 주입받는다.
 *  - 입력 배열·객체는 절대 변형하지 않는다.
 *  - 타이포그래피 기본값(폰트 크기·글꼴·행간·자간)은 **한 글자도 새로 정하지 않는다**.
 *    전부 `studio-bubble-text-fit.ts`의 리졸버를 부른다 — 그 단일 소스가 깨졌을 때 대사가
 *    조용히 사라진 것이 이 저장소의 실제 결함 이력이다(같은 파일 헤더 참조).
 *
 * 순서가 계약이다:
 *   ① 넘침 게이트를 먼저 돌린다 → 권고 조판 줄(`verdict.lines`)을 얻는다.
 *   ② 그 줄을 문체 린터에 `lines`로 넘긴다 → 레이아웃 3규칙(관사 뒤 줄바꿈·하이픈 앞 줄바꿈·
 *      실루엣)이 비로소 실행된다. 이 줄이 없으면 그 셋은 "미실행"으로 집계된다.
 *   ②' 용어집 규칙이 주어졌으면 큐마다 원문·번역문을 대고 충돌을 모은다(§2.5).
 *   ②'' 말풍선 글자·바탕 명도 대비를 큐마다 재다 — MQM 점수에는 넣지 않고 큐에만 싣는다.
 *   ③ 세 갈래를 MQM 오류 입력으로 바꿔 한 번에 채점한다 → 점수가 하나만 존재한다.
 *
 * §1. 입력 모델
 * §2. 타이포그래피 해석 — 전부 위임
 * §2.5 용어집 충돌 → MQM 오류
 * §3. 회차 실행
 * §4. 차원별 묶음(패널이 그대로 그린다)
 */

import { findStudioTranslationMemoryGlossaryConflicts } from "../studio-translation-glossary";

import { auditBubbleTextLegibility } from "./studio-bubble-legibility-contrast";
import {
  bubbleLetterSpacing,
  resolveBubbleFontFamily,
  resolveBubbleFontSize,
  resolveBubbleFontStyle,
  resolveBubbleLineHeight,
  type BubbleTextMeasurer,
  type BubbleWebtoonTheme,
} from "./studio-bubble-text-fit";
import { collectDialogueItems } from "./studio-dialogue-batch";
import {
  detectStudioMqmTruncationErrors,
  scoreStudioMqmErrors,
  studioMqmDenominator,
  STUDIO_MQM_DIMENSIONS,
  type StudioMqmDenominatorUnit,
  type StudioMqmError,
  type StudioMqmErrorInput,
  type StudioMqmDimensionRollup,
  type StudioMqmScoreResult,
  type StudioMqmSeverity,
  type StudioMqmTruncationObservation,
} from "./studio-localization-mqm";
import {
  evaluateLocalizationOverflow,
  summarizeLocalizationOverflow,
  type LocalizationOverflowInput,
  type LocalizationOverflowPolicy,
  type LocalizationOverflowSummary,
  type LocalizationOverflowVerdict,
} from "./studio-localization-overflow-gate";
import {
  lintStudioLocalizationStyle,
  studioLocalizationStyleFindingToMqmError,
  type StudioLocalizationStyleLintOptions,
  type StudioLocalizationStyleLintResult,
  type StudioLocalizationStyleUnit,
} from "./studio-localization-style-lint";


import type {
  BubbleLegibilityLevel,
  BubbleLegibilityReport,
} from "./studio-bubble-legibility-contrast";
import type { DialogueElementLike, DialoguePageLike } from "./studio-dialogue-batch";
import type {
  StudioTranslationMemoryGlossaryConflict,
  StudioTranslationMemoryGlossaryRule,
} from "../studio-translation-glossary";

// ── §1. 입력 모델 ─────────────────────────────────────────────────────────────

/**
 * `DialogueElementLike`가 선언하지 않는 조판 필드들. 실제 문서의 `BubbleEl`은 전부 갖고 있지만
 * 대사 목록화 타입은 최소 부분집합이라, 넘침 판정에 필요한 만큼만 여기서 넓힌다.
 * 전부 선택값이다 — 없으면 §2의 리졸버가 렌더와 같은 기본값을 준다.
 */
export interface StudioLocalizationQaElementTypography {
  readonly font?: string;
  readonly fontSize?: number;
  readonly fontStyle?: string;
  readonly lineHeight?: number;
  readonly vertical?: boolean;
  /** 대사 글자색 — `BubbleEl.textFill`. 없으면 명도 대비를 판정하지 않는다. */
  readonly textFill?: string;
  /** 말풍선 바탕색 — `BubbleEl.fill`. */
  readonly fill?: string;
  /**
   * 말풍선 그라데이션 채우기 — `BubbleEl.gradient`. 설정돼 있으면 `fill`(단색)보다 **우선**해
   * 렌더되므로, 있으면 대비 판정을 거부해야 한다(화면에 없는 색으로 재게 된다).
   */
  readonly gradient?: unknown;
}

type QaElement = DialogueElementLike & StudioLocalizationQaElementTypography;

/** 용어집 충돌 두 종류의 MQM 심각도. 둘 다 정책값이다 — §2.5. */
export interface StudioLocalizationQaGlossarySeverity {
  /** 같은 원문 용어에 서로 다른 대역어가 지정된 경우. */
  readonly ambiguousRule?: StudioMqmSeverity;
  /** 규칙이 지정한 대역어가 번역문에 없는 경우. */
  readonly missingTarget?: StudioMqmSeverity;
}

/** 큐 하나 — 발견을 되짚을 때 패널이 필요한 최소 정보. */
export interface StudioLocalizationQaCue {
  readonly id: string;
  readonly pageId: string;
  /** 0 기준 페이지 순번(표시할 땐 +1). */
  readonly pageIndex: number;
  /** 검사 대상 문자열(초안이 있으면 초안). */
  readonly text: string;
  /** 넘침 판정 — 상자 치수를 못 읽은 큐는 null. */
  readonly overflow: LocalizationOverflowVerdict | null;
  /**
   * 대사 글자 대 말풍선 바탕의 WCAG 명도 대비 판정. 요소를 못 찾은 큐만 null 이고, 색을 못 읽은
   * 큐는 null 이 아니라 `verdict: "indeterminate"` 다 — "안 쟀다"와 "재려 했지만 판정 불가"는
   * 다른 사실이고, 뒤엣것은 이유(`reason`)를 들고 온다.
   */
  readonly legibility: BubbleLegibilityReport | null;
}

export interface StudioLocalizationQaOptions {
  /** 대상 로케일 코드. 문체 규칙표는 영문 전용이라 이 값이 규칙 실행 여부를 가른다. */
  readonly targetLocale: string;
  /** 원문 로케일 — 확장률 추정에만 쓴다. */
  readonly sourceLocale?: string;
  /**
   * 적용 **전**의 번역 초안. 주면 이 맵의 문자열을 검사한다(적용 후가 아니라 적용 전에
   * 막는 것이 이 게이트의 존재 이유다). 없으면 문서에 지금 들어 있는 문자열을 검사한다.
   */
  readonly translations?: ReadonlyMap<string, string>;
  /** 큐별 원문 — 확장률 추정용. 초안 검사 중이면 요소의 현재 text 가 곧 원문이다. */
  readonly sourceTextFor?: (cueId: string) => string | undefined;
  /** 말풍선 테마 — 행간·자간 기본값을 고른다(문서 상태라 호출부가 안다). */
  readonly theme?: BubbleWebtoonTheme;
  /** 효과음으로 취급할 큐 id. 문서에 SFX 표시가 없으므로 호출부가 알려 줄 때만 SFX 규칙이 돈다. */
  readonly sfxCueIds?: ReadonlySet<string>;
  readonly styleOptions?: StudioLocalizationStyleLintOptions;
  readonly overflowPolicy?: LocalizationOverflowPolicy;
  /**
   * 용어집 규칙. 주면 큐마다 원문·번역문을 대고 충돌을 찾아 MQM Terminology 오류로 싣는다.
   *
   * **원문을 모르면 한 건도 돌지 않는다** — 이 판정은 "원문에 이 용어가 있는데 번역문에 규칙이
   * 지정한 대역어가 없다"는 형태라, `sourceTextFor`가 그 큐의 원문을 주지 않으면 전제가 없다.
   * 조용히 통과시키는 대신 `glossaryCheckedCueCount`로 몇 큐를 실제로 봤는지 보고한다.
   */
  readonly glossaryRules?: readonly StudioTranslationMemoryGlossaryRule[];
  /**
   * 용어집 충돌의 MQM 심각도 재정의. **MQM 은 이 값을 정해 주지 않는다**(§2.5 참조) —
   * 기본값은 이 저장소의 정책이고, 회차·벤더마다 다르게 잡고 싶으면 여기서 갈아 끼운다.
   */
  readonly glossarySeverity?: StudioLocalizationQaGlossarySeverity;
  /**
   * 채점 분모 단위. 기본 `"characters"` — 웹툰 대사는 문단이 아니고 한국어·일본어·중국어의
   * 공백 분절이 단어 수를 크게 왜곡한다. 임계값 99가 단어 분모로만 교정돼 있다는 사실은
   * 결과의 `score.denominator.thresholdCalibrated`가 그대로 들고 다닌다.
   */
  readonly denominatorUnit?: StudioMqmDenominatorUnit;
  /** 숨김·잠금 큐도 검사할지. 기본 false — 캔버스 편집과 같은 규약. */
  readonly includeHidden?: boolean;
  /** 명도 대비 준수 수준. 기본 "AA"(WCAG 1.4.3). */
  readonly legibilityLevel?: BubbleLegibilityLevel;
}

export interface StudioLocalizationQaReport {
  readonly basis: "studio-localization-qa";
  readonly targetLocale: string;
  /** 실제로 검사한 큐 수. */
  readonly checkedCueCount: number;
  /** 그중 상자 치수를 읽어 넘침까지 판정한 큐 수. */
  readonly overflowCheckedCount: number;
  /** 숨김·잠금이라 건너뛴 큐 수. */
  readonly skippedCueCount: number;
  /**
   * 그중 **원문까지 알아서** 용어집을 실제로 대 본 큐 수. 규칙이 없거나 원문을 모르면 0이다 —
   * 0인데 Terminology 오류가 없다는 것을 "용어집 통과"로 읽으면 안 되기 때문에 따로 센다.
   */
  readonly glossaryCheckedCueCount: number;
  /**
   * 그중 명도 대비를 **실제로 판정한**(pass/fail 이 난) 큐 수. 반투명·그라데이션·색 누락으로
   * `indeterminate` 가 난 큐는 세지 않는다 — 0 인데 실패가 없다는 것을 "대비 통과"로 읽으면 안 된다.
   */
  readonly legibilityCheckedCueCount: number;
  /** 그중 임계값을 밑돈 큐 수. */
  readonly legibilityFailCueCount: number;
  readonly cues: readonly StudioLocalizationQaCue[];
  readonly style: StudioLocalizationStyleLintResult;
  readonly overflow: LocalizationOverflowSummary;
  readonly score: StudioMqmScoreResult;
}

// ── §2. 타이포그래피 해석 — 전부 위임 ─────────────────────────────────────────

function positiveNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** 넘침 게이트 입력 — 기본값은 하나도 여기서 정하지 않고 리졸버에 묻는다. */
function overflowInputFor(
  el: QaElement,
  text: string,
  options: StudioLocalizationQaOptions,
): LocalizationOverflowInput | null {
  const boxWidth = positiveNumber(el.width);
  const boxHeight = positiveNumber(el.height);
  // 상자 치수가 없으면 넘침은 **판정하지 않는다**. 임의의 상자를 가정하고 "넘친다"고 말하는
  // 쪽이 훨씬 나쁘다 — 그 순간 이 보고서는 오탐 생성기가 된다.
  if (boxWidth === null || boxHeight === null) return null;

  const fontSize = resolveBubbleFontSize(el.fontSize);
  const sourceText = options.sourceTextFor?.(el.id);
  return {
    text,
    ...(sourceText === undefined ? {} : { sourceText }),
    ...(options.sourceLocale === undefined ? {} : { sourceLocale: options.sourceLocale }),
    targetLocale: options.targetLocale,
    boxWidth,
    boxHeight,
    fontSize,
    fontFamily: resolveBubbleFontFamily(el.font),
    fontStyle: resolveBubbleFontStyle(el.fontStyle),
    lineHeight: resolveBubbleLineHeight({
      lineHeight: el.lineHeight,
      vertical: el.vertical,
      theme: options.theme,
    }),
    letterSpacing: bubbleLetterSpacing(options.theme),
    ...(el.vertical === undefined ? {} : { vertical: el.vertical }),
  };
}

/**
 * 넘침 판정을 MQM 관측치로 옮긴다.
 *
 * `textLost`는 **일부러 싣지 않는다** — 이 게이트는 렌더 전에 예측하는 물건이고, 글자를 실제로
 * 버렸는지는 렌더가 끝나야 안다. 확인되지 않은 손실을 Critical(자동 Fail)로 올리면 회차가
 * 근거 없이 막힌다.
 */
function truncationObservation(
  cueId: string,
  pageIndex: number,
  verdict: LocalizationOverflowVerdict,
  authoredFontSize: number,
): StudioMqmTruncationObservation {
  const expansionRatio =
    verdict.observedExpansionPercent === null ? undefined : verdict.observedExpansionPercent / 100;
  return {
    cueId,
    page: pageIndex + 1,
    fits: verdict.fits,
    shrinkRatio: authoredFontSize > 0 ? verdict.fontSize / authoredFontSize : 1,
    ...(expansionRatio === undefined ? {} : { expansionRatio }),
  };
}

// ── §2.5 용어집 충돌 → MQM 오류 ─────────────────────────────────────────────

/**
 * 용어집 충돌의 기본 심각도. **MQM 명세는 이 값을 정해 주지 않는다** — 심각도는 회차·벤더가
 * 정하는 정책이라, 아래 둘은 이 저장소의 기본값일 뿐이고 `glossarySeverity` 로 갈아 끼운다.
 *
 * 규칙이 지정한 대역어가 번역문에 없는 것(`missing-target`)은 독자가 읽을 문장이 이미 규칙을
 * 어겼다는 뜻이라 `major`. 같은 원문 용어에 규칙이 서로 다른 대역어를 지정한 것
 * (`ambiguous-rule`)은 번역문이 아니라 **용어집 자체의 모순**이므로, 이 큐를 틀렸다고 단정할
 * 근거가 없어 `minor` 로 둔다.
 */
const DEFAULT_GLOSSARY_SEVERITY: Required<StudioLocalizationQaGlossarySeverity> = Object.freeze({
  ambiguousRule: "minor",
  missingTarget: "major",
});

/**
 * 충돌 하나를 MQM 오류 입력으로 옮긴다.
 *
 * 차원은 `terminology` 로 두되 **서브타입은 주지 않는다**. MQM 의 Terminology 는 서브타입 3개를
 * 선언하지만 이 저장소의 카탈로그는 그 이름을 아직 확인하지 못했다(`declaredSubtypeCount: 3`,
 * `subtypeCatalogComplete: false`). 확인되지 않은 이름을 지어내면 채점기가 그것을 사실로 싣는다.
 *
 * `expectedTargets` 는 문자열로 합쳐 넣는다 — `StudioMqmEvidence` 는 원시값만 담는다.
 */
function glossaryConflictToMqmError(
  conflict: StudioTranslationMemoryGlossaryConflict,
  cue: { readonly id: string; readonly pageIndex: number },
  severity: Required<StudioLocalizationQaGlossarySeverity>,
): StudioMqmErrorInput {
  return {
    id: `${cue.id}:glossary:${conflict.kind}:${conflict.sourceTerm}`,
    dimension: "terminology",
    severity: conflict.kind === "ambiguous-rule" ? severity.ambiguousRule : severity.missingTarget,
    cueId: cue.id,
    page: cue.pageIndex + 1,
    note: conflict.message,
    evidence: Object.freeze({
      ruleId: `glossary/${conflict.kind}`,
      sourceTerm: conflict.sourceTerm,
      expectedTargets: conflict.expectedTargets.join(" | "),
    }),
  };
}

// ── §3. 회차 실행 ─────────────────────────────────────────────────────────────

/**
 * 회차 한 편의 현지화 QA.
 *
 * 반환값의 `score`가 유일한 점수다 — 문체 발견과 넘침 판정이 **같은 채점기**를 통과하므로,
 * "린터는 통과인데 점수는 낙제" 같은 두 우주가 생기지 않는다.
 */
export function runStudioLocalizationQa(
  pages: readonly DialoguePageLike[],
  measurer: BubbleTextMeasurer,
  options: StudioLocalizationQaOptions,
): StudioLocalizationQaReport {
  const items = collectDialogueItems(pages);
  const elementById = new Map<string, QaElement>();
  for (const page of pages) {
    for (const el of page.elements) elementById.set(el.id, el as QaElement);
  }

  const cues: StudioLocalizationQaCue[] = [];
  const styleUnits: StudioLocalizationStyleUnit[] = [];
  const observations: StudioMqmTruncationObservation[] = [];
  const verdicts: LocalizationOverflowVerdict[] = [];
  const scoredTexts: string[] = [];
  const glossaryErrors: StudioMqmErrorInput[] = [];
  const glossarySeverity: Required<StudioLocalizationQaGlossarySeverity> = {
    ...DEFAULT_GLOSSARY_SEVERITY,
    ...options.glossarySeverity,
  };
  const glossaryRules = options.glossaryRules ?? [];
  let skippedCueCount = 0;
  let overflowCheckedCount = 0;
  let glossaryCheckedCueCount = 0;
  let legibilityCheckedCueCount = 0;
  let legibilityFailCueCount = 0;

  for (const item of items) {
    if (!options.includeHidden && (item.hidden || item.locked)) {
      skippedCueCount += 1;
      continue;
    }
    const text = options.translations?.get(item.id) ?? item.text;
    const el = elementById.get(item.id);

    // ① 넘침 먼저 — 권고 조판 줄이 ②의 레이아웃 규칙 입력이다.
    let verdict: LocalizationOverflowVerdict | null = null;
    if (el) {
      const input = overflowInputFor(el, text, options);
      if (input) {
        verdict = evaluateLocalizationOverflow(input, measurer, options.overflowPolicy ?? {});
        verdicts.push(verdict);
        observations.push(
          truncationObservation(item.id, item.pageIndex, verdict, resolveBubbleFontSize(el.fontSize)),
        );
        overflowCheckedCount += 1;
      }
    }

    // ② 문체 — 줄이 있으면 레이아웃 3규칙까지 실행된다.
    styleUnits.push({
      id: item.id,
      text,
      kind: options.sfxCueIds?.has(item.id) ? "sfx" : "dialogue",
      ...(verdict === null ? {} : { lines: verdict.lines }),
      targetLocale: options.targetLocale,
      page: item.pageIndex + 1,
    });

    // ②' 용어집 — 원문을 모르면 한 건도 돌지 않는다. 전제(원문)가 없는 판정을 "통과"로
    //     보이지 않으려고, 실제로 대 본 큐 수를 따로 센다.
    const sourceText = options.sourceTextFor?.(item.id);
    if (glossaryRules.length > 0 && sourceText !== undefined && sourceText !== "") {
      glossaryCheckedCueCount += 1;
      for (const conflict of findStudioTranslationMemoryGlossaryConflicts({
        sourceText,
        translation: text,
        sourceLocale: options.sourceLocale ?? "",
        targetLocale: options.targetLocale,
        rules: glossaryRules,
      })) {
        glossaryErrors.push(
          glossaryConflictToMqmError(conflict, { id: item.id, pageIndex: item.pageIndex }, glossarySeverity),
        );
      }
    }

    // ②'' 명도 대비 — 조판이 아니라 **읽힘**의 문제라 MQM 점수에는 넣지 않는다. MQM 은 번역
    //      품질 척도이고, 흰 말풍선의 연회색 대사는 번역이 틀린 것이 아니다. 큐에 판정만 싣는다.
    //
    //      말풍선의 `stroke` 는 **말풍선 테두리**이지 글자 외곽선이 아니므로 엔진에 넘기지
    //      않는다. 넘기면 테두리 있는 말풍선이 전부 "외곽선 있는 글자"로 오인돼 indeterminate
    //      가 되고, 검사기가 조용히 꺼진 것과 같아진다.
    let legibility: BubbleLegibilityReport | null = null;
    if (el) {
      legibility = auditBubbleTextLegibility({
        textColor: el.textFill,
        backdropColor: el.fill,
        backdropIsGradient: el.gradient !== undefined && el.gradient !== null,
        fontSizePx: resolveBubbleFontSize(el.fontSize),
        fontStyle: el.fontStyle,
        ...(options.legibilityLevel === undefined ? {} : { level: options.legibilityLevel }),
      });
      if (legibility.verdict !== "indeterminate") legibilityCheckedCueCount += 1;
      if (legibility.verdict === "fail") legibilityFailCueCount += 1;
    }

    scoredTexts.push(text);
    cues.push({
      id: item.id,
      pageId: item.pageId,
      pageIndex: item.pageIndex,
      text,
      overflow: verdict,
      legibility,
    });
  }

  const style = lintStudioLocalizationStyle(styleUnits, options.styleOptions);

  // ③ 두 갈래를 한 채점기에 넣는다.
  const errorInputs: StudioMqmErrorInput[] = [
    ...style.findings.map(studioLocalizationStyleFindingToMqmError),
    ...detectStudioMqmTruncationErrors(observations),
    ...glossaryErrors,
  ];
  const score = scoreStudioMqmErrors(
    errorInputs,
    studioMqmDenominator(scoredTexts, options.denominatorUnit ?? "characters"),
  );

  return Object.freeze({
    basis: "studio-localization-qa",
    targetLocale: options.targetLocale,
    checkedCueCount: cues.length,
    overflowCheckedCount,
    skippedCueCount,
    glossaryCheckedCueCount,
    legibilityCheckedCueCount,
    legibilityFailCueCount,
    cues: Object.freeze(cues),
    style,
    overflow: summarizeLocalizationOverflow(verdicts),
    score,
  });
}

// ── §4. 차원별 묶음 ───────────────────────────────────────────────────────────

export interface StudioLocalizationQaDimensionGroup {
  readonly rollup: StudioMqmDimensionRollup;
  readonly errors: readonly StudioMqmError[];
}

/**
 * 발견을 MQM 차원별로 묶는다. 순서는 `STUDIO_MQM_DIMENSIONS` 카탈로그 순서 — 심각도 순이 아니다.
 * 차원 순서가 고정이어야 같은 회차를 두 번 열었을 때 목록이 흔들리지 않는다.
 */
export function studioLocalizationQaGroups(
  report: StudioLocalizationQaReport,
): readonly StudioLocalizationQaDimensionGroup[] {
  const order = new Map(STUDIO_MQM_DIMENSIONS.map((dimension, index) => [dimension.id, index]));
  return report.score.byDimension
    .map((rollup) => ({
      rollup,
      errors: report.score.errors.filter((error) => error.dimension === rollup.dimension),
    }))
    .sort((left, right) => {
      const a = order.get(left.rollup.dimension) ?? Number.MAX_SAFE_INTEGER;
      const b = order.get(right.rollup.dimension) ?? Number.MAX_SAFE_INTEGER;
      return a - b;
    });
}

/** 큐 id → 큐. 발견에서 대사로 되짚을 때 패널이 쓴다. */
export function studioLocalizationQaCueIndex(
  report: StudioLocalizationQaReport,
): ReadonlyMap<string, StudioLocalizationQaCue> {
  return new Map(report.cues.map((cue) => [cue.id, cue]));
}
