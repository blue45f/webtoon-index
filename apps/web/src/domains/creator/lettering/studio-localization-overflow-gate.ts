/**
 * Studio Localization Overflow Gate — 번역된 대사를 **적용하기 전에** 말풍선을 넘치는지 판정하고,
 * 넘친다면 어떤 순서로 손을 대야 하는지(에스컬레이션 사다리)를 처방한다.
 *
 * 왜 이 모듈이 필요한가
 * ---------------------
 * 번역 초안을 문서에 적용하는 경로(`applyTranslationDraft` → `applyDialogueTranslations` →
 * `switchDialogueLocale` → `commitPages`)에는 **맞춤 검사가 한 번도 없다**. 한국어 원문보다
 * 40% 긴 영어 문장이 그대로 커밋되고, 화면에서는 Konva.Text 가 높이를 넘는 줄을 **경고 없이
 * 버린다**(konva `_setTextData`: `if (fixedHeight && currentHeightPx + lineHeightPx > maxHeightPx)
 * break;`). 즉 지금은 "번역을 적용했더니 마지막 줄이 사라졌다"가 조용히 일어난다.
 *
 * 넘침 판정 자체는 이미 `studio-bubble-text-fit.ts`에 있다(`bubbleTextFitsInBox`). 다만 그 판정은
 * (1) 선택된 요소 하나에 대해, (2) `autoShrinkText`가 켜진 말풍선에서만, (3) 인스펙터 표시용으로만
 * 불린다(`bubbleAutoShrinkPreview`는 `!el.autoShrinkText`면 `null`을 돌려준다). 번역 적용 길목에는
 * 연결돼 있지 않다. 이 모듈은 **그 판정을 재사용해서** 번역 길목에 놓을 수 있는 형태로 감싼다.
 *
 * 이 모듈이 하지 않는 것 (중복 금지)
 * ----------------------------------
 *  · 워드랩·패딩·행간·안전 여유를 **다시 계산하지 않는다**. 전부 `studio-bubble-text-fit.ts`의
 *    공개 함수를 호출한다. 그 모듈의 헤더가 기록하듯, 경로마다 다른 기본값을 쓴 것이 "커밋하면
 *    대사가 사라진다" 결함의 뿌리였다. 여기서 상수 하나라도 베끼면 그 결함이 되돌아온다.
 *    - 맞는지 판정 + 줄 배열 획득 → `fitBubbleFontSize`(min=max로 고정한 1회 프로브)
 *    - 축소 탐색                  → `fitBubbleFontSize`
 *    - 상자 확대에 필요한 높이    → `fitBubbleBoxHeightToText`
 *    - 상자 안쪽 실치수           → `bubbleTextBoxWidth` / `bubbleTextBoxHeight`
 *    (`HEIGHT_SAFETY_MARGIN`은 그 모듈의 **비공개** 상수다. 이 모듈의 em 예산(§3)은 그 여유를
 *     반영하지 않은 **진단값**이고, 최종 판정은 언제나 위 함수들에 위임한다 — 진단값을 판정으로
 *     쓰지 말 것.)
 *  · 금칙·랙 균형 규칙표를 만들지 않는다. `studio-kinsoku-line-break.ts`의 `balanceRaggedLines`·
 *    `isKinsokuBreakAllowed`·`segmentGraphemes`를 그대로 부른다.
 *
 * 사다리 (순서가 계약이다)
 * ------------------------
 *   ① 다시 끊기(rebreak)  — 원문에서 딸려온 강제 줄바꿈(\n)을 풀어 상자 폭에 맞게 다시 흘린다.
 *                            글자를 하나도 건드리지 않는 가장 싼 수선이다.
 *   ② 폰트 축소(shrink)   — 저자가 정한 크기에서 하한까지 이진 탐색으로 줄인다. 그림에 영향이 없다.
 *   ③ 상자 확대(enlarge)  — 저자 폰트 크기를 지키고 말풍선 높이를 늘린다. 그림과 충돌할 수 있어
 *                            **호출부가 여유 공간(maxBoxHeight)을 명시해야만** 시도한다.
 *   ④ 사람에게(human)     — 위 셋으로 안 되면 사람이 문장을 줄이거나 컷을 다시 짜야 한다.
 *
 * ②를 ③보다 먼저 두는 이유: 축소는 패널 안에서 닫히지만 확대는 옆 칸·그림을 침범할 수 있어
 * 되돌리기가 비싸다. 그래서 "보이지 않게 해결되는 쪽"을 먼저 시도한다.
 *
 * **잘라내기(truncation)는 사다리에 없다.** 어떤 입력에서도 이 모듈은 문자를 버리라고 권하지
 * 않는다 — 대사가 조용히 사라지는 것이 애초에 이 게이트가 막으려는 결함이기 때문이다.
 * `LOCALIZATION_OVERFLOW_ACTIONS`가 가능한 권고의 전부이고, 마지막 칸은 사람이다.
 *
 * 예산은 **em 폭 × 행간**으로 잡는다 (§3)
 * ---------------------------------------
 * 글자 수로 예산을 잡으면 틀린다. 한글은 전각(≈1.0em)이고 라틴 소문자는 ≈0.5em이라 같은 글자 수가
 * 두 배 넘게 차이 난다 — 실제로 `studio-fit.ts` 헤더에 남은 2026-08 감사가 그 오류(charsPerLine =
 * usableWidth/(fontSize*0.62))로 상자를 1.6배 작게 잡아 22자를 잃은 사례다. 그래서 여기서는
 * 주입된 측정기로 잰 폭을 fontSize로 나눈 **em** 단위와, 행간을 곱한 **줄 슬롯** 수로만 셈한다.
 *
 * 전부 순수·결정적이며 브라우저 API에 의존하지 않는다. 폭 측정은 호출부가 `BubbleTextMeasurer`로
 * 주입한다(`studio-bubble-text-fit.ts`·`studio-kinsoku-line-break.ts`와 같은 관례). 입력은 절대
 * 변형하지 않는다.
 *
 * §1. 텍스트 확장률 자료(출처 표기 포함)
 * §2. 확장률 추정 — 공개(published)/파생(derived)/미공개(unpublished)를 정직하게 구분한다
 * §3. em 예산
 * §4. 에스컬레이션 사다리
 * §5. 판정 조립과 로케일 집계
 */

import {
  BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT,
  bubbleTextBoxHeight,
  bubbleTextBoxWidth,
  fitBubbleBoxHeightToText,
  fitBubbleFontSize,
  withBubbleLetterSpacing,
  wrapBubbleTextLines,
  type BubbleTextMeasurer,
} from "./studio-bubble-text-fit";
import {
  balanceRaggedLines,
  isKinsokuBreakAllowed,
  segmentGraphemes,
} from "./studio-kinsoku-line-break";

import type { VerticalBlockAlign } from "../studio-vertical-text";

// ── §1. 텍스트 확장률 자료 ────────────────────────────────────────────────────
//
// 아래 표들은 전부 **출처가 있는 것만** 담는다. 출처가 없는 값은 숫자를 지어내는 대신
// provenance "unpublished"로 남기고, 게이트는 예측 대신 **실측**으로 판정한다(§2 마지막 문단).

/**
 * 확장률 자료의 출처 등급.
 *  · `published`   — 1차 자료에 표로 인쇄된 값.
 *  · `derived`     — 공개된 다른 표에서 우리가 계산해 낸 값. 측정된 값이 아니다.
 *  · `unpublished` — 공개 표가 존재하지 않는 조합. 숫자를 만들지 않는다.
 */
export type LocalizationExpansionProvenance = "published" | "derived" | "unpublished";

/** 확장률 구간(%) — 100이 원문과 같은 폭, 200이 두 배. */
export interface LocalizationExpansionBand {
  readonly minPercent: number;
  readonly maxPercent: number;
}

/** 원문 길이 구간별 확장률 한 행. */
export interface LocalizationExpansionRow extends LocalizationExpansionBand {
  /** 이 행이 적용되는 원문 글자 수 상한(이하). 마지막 행은 Infinity. */
  readonly maxSourceChars: number;
  /**
   * 1차 자료의 인쇄값이 앞뒤 행과 단조롭지 않아 오타로 의심되면 true.
   * **값을 고쳐 담지 않는다** — 인쇄된 그대로 두고 대안만 병기한다.
   */
  readonly suspectedSourceTypo?: boolean;
  /** 앞뒤 행이 함의하는 단조 정합 대안. 기본 계산에는 쓰지 않는다(참고용). */
  readonly monotoneAlternative?: LocalizationExpansionBand;
}

/**
 * 영어 → 유럽어 확장률, **원문 길이별**.
 *
 * 출처: W3C Internationalization "Text size in translation"
 * (w3.org/International/articles/article-text-size). Microsoft 세계화 문서의
 * pseudolocalization 지침도 같은 성질(짧은 문자열일수록 확장률이 크다)을 말한다.
 *
 * 51–70자 행 주의: W3C 표에 인쇄된 값은 **151–170%**인데, 바로 위 31–50자 행(140–160%)과 아래
 * 71자 이상 행(130%) 사이에서 혼자 위로 튀어 단조성이 깨진다. 짧을수록 확장률이 크다는 표 전체의
 * 성질과 어긋나므로 **1차 자료의 오타로 의심**되지만, 임의로 고치면 우리가 자료를 위조하는 것이
 * 된다. 그래서 인쇄값을 그대로 담고 `suspectedSourceTypo`로 표시하며, 앞뒤 행이 함의하는
 * 131–140%는 `monotoneAlternative`에만 병기한다.
 */
export const W3C_EXPANSION_BY_SOURCE_LENGTH: readonly LocalizationExpansionRow[] = Object.freeze([
  Object.freeze({ maxSourceChars: 10, minPercent: 200, maxPercent: 300 }),
  Object.freeze({ maxSourceChars: 20, minPercent: 180, maxPercent: 200 }),
  Object.freeze({ maxSourceChars: 30, minPercent: 160, maxPercent: 180 }),
  Object.freeze({ maxSourceChars: 50, minPercent: 140, maxPercent: 160 }),
  Object.freeze({
    maxSourceChars: 70,
    minPercent: 151,
    maxPercent: 170,
    suspectedSourceTypo: true,
    monotoneAlternative: Object.freeze({ minPercent: 131, maxPercent: 140 }),
  }),
  Object.freeze({ maxSourceChars: Number.POSITIVE_INFINITY, minPercent: 130, maxPercent: 130 }),
]);

/**
 * 폭 정규화 언어별 비율 — **한국어/중국어 글자 하나를 영어 글자 2개 폭으로 환산**한 눈금 위의 값.
 *
 * 출처: W3C "Text size in translation"의 폭 정규화 표. 언어 간 **상대** 비율이며 영어 자신의
 * 기준값은 그 표에 없다. 따라서 이 값들만으로 "영어 → X" 확장률을 곧바로 얻을 수는 없다 —
 * 그렇게 쓰려면 반드시 파생임을 표시해야 한다(아래 DERIVED_* 참고).
 */
export const WIDTH_NORMALIZED_GLYPH_RATIO: Readonly<Record<string, number>> = Object.freeze({
  ko: 0.8,
  zh: 1.2,
  pt: 2.6,
  fr: 2.6,
  de: 2.8,
  it: 3.0,
});

/** W3C 길이별 표를 적용할 수 있는 대상 언어 — 위 폭 정규화 표가 실제로 이름을 대는 유럽어만. */
const W3C_TABLE_TARGET_LANGUAGES: ReadonlySet<string> = new Set(["de", "fr", "it", "pt"]);

/** 벤더 경험칙 한 행(원문 → 대상). */
export interface LocalizationVendorExpansionRule extends LocalizationExpansionBand {
  readonly from: string;
  readonly to: string;
}

/**
 * 업계 경험칙 — 길이별 표가 없는 조합에 쓴다.
 * 출처: W3C "Text size in translation" 및 Microsoft 세계화(pseudolocalization) 문서가 소개하는
 * 통상 수치. EN→DE +20~35%, EN→KO −10~15%, EN→JA −10~50%를 폭 비율(%)로 옮겼다.
 */
export const VENDOR_EXPANSION_RULES: readonly LocalizationVendorExpansionRule[] = Object.freeze([
  Object.freeze({ from: "en", to: "de", minPercent: 120, maxPercent: 135 }),
  Object.freeze({ from: "en", to: "ko", minPercent: 85, maxPercent: 90 }),
  Object.freeze({ from: "en", to: "ja", minPercent: 50, maxPercent: 90 }),
]);

/**
 * Microsoft pseudolocalization 기본 확장률(%) — UI를 미리 부풀려 보는 용도.
 * 출처: Microsoft 세계화 문서. 극단값은 200~400%로 소개된다(아래 상수).
 * 이 게이트의 판정에는 쓰지 않는다 — "최악을 미리 보기" 모드를 만들 호출부용 참고값이다.
 */
export const MICROSOFT_PSEUDOLOCALIZATION_EXPANSION_PERCENT = 140;
/** 같은 문서가 드는 극단 확장률(%) 범위. */
export const MICROSOFT_PSEUDOLOCALIZATION_EXTREMES: LocalizationExpansionBand = Object.freeze({
  minPercent: 200,
  maxPercent: 400,
});

/**
 * 한국어 → 영어 폭 확장률(%) — **파생값이지 공개값이 아니다.**
 *
 * KO→EN·JA→EN 방향의 확장률 표는 어디에도 공개돼 있지 않다(UNVERIFIED). 다만 위 폭 정규화 표를
 * 뒤집으면 KO→EN은 대략 +25% 폭으로 나온다. 그 계산 결과만 담고 provenance를 "derived"로 고정한다
 * — 측정된 값처럼 보이게 두면 나중에 누가 이걸 근거로 상자 치수를 확정한다.
 */
export const DERIVED_KO_TO_EN_EXPANSION_PERCENT = 125;

/**
 * 공개 표도 파생 근거도 없는 조합 — 숫자를 만들지 않는다.
 * JA→EN이 대표 사례다(웹툰/만화 현업에서 가장 흔한 방향인데도 공개 표가 없다).
 */
const UNPUBLISHED_PAIR_NOTE =
  "이 언어쌍의 확장률은 공개된 표가 없다(미공개). 예측 대신 실제 번역문 실측으로만 판정한다.";

// ── §2. 확장률 추정 ───────────────────────────────────────────────────────────

export interface LocalizationExpansionEstimate {
  readonly provenance: LocalizationExpansionProvenance;
  /** provenance가 "unpublished"면 null — 숫자를 만들지 않는다. */
  readonly band: LocalizationExpansionBand | null;
  /** 어떤 자료의 어느 행을 썼는지 한 줄 설명(한국어). */
  readonly basis: string;
  /** 쓴 행이 1차 자료 오타로 의심되는가. */
  readonly suspectedSourceTypo: boolean;
  /** 그 경우 앞뒤 행이 함의하는 대안(참고용, 계산에는 쓰지 않음). */
  readonly monotoneAlternative: LocalizationExpansionBand | null;
}

/** BCP-47 태그에서 기본 언어 서브태그만 뽑는다("ko-KR" → "ko"). */
function primarySubtag(locale: string | undefined): string | null {
  if (typeof locale !== "string") return null;
  const primary = locale.trim().split(/[-_]/)[0];
  if (!primary) return null;
  return primary.toLowerCase();
}

function w3cRowForLength(sourceChars: number): LocalizationExpansionRow {
  for (const row of W3C_EXPANSION_BY_SOURCE_LENGTH) {
    if (sourceChars <= row.maxSourceChars) return row;
  }
  // 마지막 행이 Infinity라 도달할 수 없지만, 표를 손대도 타입이 좁혀지도록 남겨 둔다.
  return W3C_EXPANSION_BY_SOURCE_LENGTH[W3C_EXPANSION_BY_SOURCE_LENGTH.length - 1]!;
}

/**
 * 원문 길이와 언어쌍으로 확장률 구간을 추정한다.
 *
 * 해석 순서
 *  ① KO→EN — 파생값(DERIVED_KO_TO_EN_EXPANSION_PERCENT). provenance "derived".
 *  ② EN→(de|fr|it|pt) — W3C 길이별 표. provenance "published".
 *  ③ 벤더 경험칙에 있는 쌍(en→de/ko/ja) — provenance "published"(문서에 인쇄된 경험칙).
 *  ④ 그 외 전부 — provenance "unpublished", band null.
 *
 * ②가 ③보다 앞서는 이유: 같은 EN→DE라도 길이별 표가 경험칙보다 해상도가 높다.
 *
 * 주의: 호출부가 `studio-dialogue-translate.ts`의 센티널 `"source"`를 그대로 넘기면 어떤 행에도
 * 걸리지 않아 "unpublished"가 된다. 실제 BCP-47 태그로 바꿔서 넘길 것.
 */
export function estimateLocalizationExpansion(input: {
  sourceText: string;
  sourceLocale?: string;
  targetLocale?: string;
}): LocalizationExpansionEstimate {
  const from = primarySubtag(input.sourceLocale);
  const to = primarySubtag(input.targetLocale);

  if (from === "ko" && to === "en") {
    return {
      provenance: "derived",
      band: { minPercent: DERIVED_KO_TO_EN_EXPANSION_PERCENT, maxPercent: DERIVED_KO_TO_EN_EXPANSION_PERCENT },
      basis: "W3C 폭 정규화 비율을 뒤집어 계산한 KO→EN 파생값(공개 표 아님)",
      suspectedSourceTypo: false,
      monotoneAlternative: null,
    };
  }

  if (from === "en" && to !== null && W3C_TABLE_TARGET_LANGUAGES.has(to)) {
    const row = w3cRowForLength([...input.sourceText].length);
    return {
      provenance: "published",
      band: { minPercent: row.minPercent, maxPercent: row.maxPercent },
      basis: `W3C "Text size in translation" 길이별 표(원문 ${row.maxSourceChars === Number.POSITIVE_INFINITY ? "71자 이상" : `${row.maxSourceChars}자 이하`})`,
      suspectedSourceTypo: row.suspectedSourceTypo === true,
      monotoneAlternative: row.monotoneAlternative ?? null,
    };
  }

  const vendor = VENDOR_EXPANSION_RULES.find((rule) => rule.from === from && rule.to === to);
  if (vendor) {
    return {
      provenance: "published",
      band: { minPercent: vendor.minPercent, maxPercent: vendor.maxPercent },
      basis: `업계 경험칙(${vendor.from.toUpperCase()}→${vendor.to.toUpperCase()})`,
      suspectedSourceTypo: false,
      monotoneAlternative: null,
    };
  }

  return {
    provenance: "unpublished",
    band: null,
    basis: UNPUBLISHED_PAIR_NOTE,
    suspectedSourceTypo: false,
    monotoneAlternative: null,
  };
}

// ── §3. em 예산 ───────────────────────────────────────────────────────────────

export interface LocalizationEmBudget {
  /** 한 줄(세로쓰기는 한 열)에 놓을 수 있는 폭, em 단위. */
  readonly emPerLine: number;
  /** 상자에 들어가는 줄(열) 수 — 소수 포함. 안전 여유는 반영하지 않은 **진단값**이다. */
  readonly lineSlots: number;
  /** emPerLine × lineSlots — 상자가 담을 수 있는 총 em. */
  readonly emCapacity: number;
  /** 문단별 실측 폭의 합 ÷ fontSize — 줄바꿈과 무관한 텍스트 고유 길이(em). */
  readonly emDemand: number;
  /**
   * emDemand / emCapacity. 1을 넘으면 **어떤 줄바꿈으로도** 이 상자에 담을 수 없다
   * (줄바꿈은 총 em을 줄이지 못하므로). 그래서 다시 끊기 단을 건너뛸지 판단하는 근거가 된다.
   */
  readonly fillRatio: number;
  /** 강제 줄바꿈(\n) 때문에 최소로 필요한 줄(열) 수. */
  readonly minimumLines: number;
}

/**
 * em 예산을 잰다 — **글자 수가 아니라 폭(em) × 행간**으로.
 *
 * 세로쓰기에서는 폭/높이의 역할이 뒤바뀐다(`studio-bubble-text-fit.fitsAtFontSize`가 그렇게
 * 판정한다): 한 열의 길이는 상자 **높이**로 제한되고, 열이 몇 개 들어가는지는 상자 **폭**이
 * 정한다. 그래서 여기서도 같은 방식으로 축을 바꾼다.
 *
 * 이 값들은 진단·설명용이다. "맞는가"의 최종 답은 언제나 §4가 `studio-bubble-text-fit.ts`에
 * 위임해서 얻는다(그쪽에는 여기서 복제하지 않는 안전 여유가 더 들어 있다).
 */
export function measureLocalizationEmBudget(
  input: {
    text: string;
    boxWidth: number;
    boxHeight: number;
    fontSize: number;
    fontFamily: string;
    fontStyle: string;
    lineHeight: number;
    letterSpacing?: number;
    vertical?: boolean;
  },
  measurer: BubbleTextMeasurer
): LocalizationEmBudget {
  const fontSize = Math.max(1, input.fontSize);
  const lineHeight = Math.max(0.01, input.lineHeight);
  const innerWidth = bubbleTextBoxWidth(input.boxWidth, fontSize);
  const innerHeight = bubbleTextBoxHeight(input.boxHeight, fontSize);
  const paragraphs = input.text.split("\n");

  const emPerLine = (input.vertical ? innerHeight : innerWidth) / fontSize;
  const lineSlots = (input.vertical ? innerWidth : innerHeight) / (fontSize * lineHeight);
  const emCapacity = emPerLine * lineSlots;

  let emDemand = 0;
  if (input.vertical) {
    // 세로쓰기 수요 — 글자가 세로로 쌓이므로 자소 하나가 대략 1em + 자간이다
    // (studio-bubble-text-fit의 세로 높이 탐색 상한이 쓰는 것과 같은 근사).
    const spacing = Math.abs(input.letterSpacing ?? 0);
    for (const paragraph of paragraphs) {
      emDemand += (segmentGraphemes(paragraph).length * (fontSize + spacing)) / fontSize;
    }
  } else {
    const spaced = withBubbleLetterSpacing(measurer, input.letterSpacing);
    for (const paragraph of paragraphs) {
      if (paragraph.length === 0) continue;
      emDemand += spaced.measureWidth(paragraph, fontSize, input.fontFamily, input.fontStyle) / fontSize;
    }
  }

  return {
    emPerLine,
    lineSlots,
    emCapacity,
    emDemand,
    fillRatio: emCapacity > 0 ? emDemand / emCapacity : Number.POSITIVE_INFINITY,
    minimumLines: paragraphs.length,
  };
}

// ── §4. 에스컬레이션 사다리 ───────────────────────────────────────────────────

/**
 * 가능한 권고의 **전부**. 잘라내기(truncate/clip)는 여기 없고 앞으로도 없다 —
 * 대사가 조용히 사라지는 것이 이 게이트가 막으려는 결함 그 자체다.
 */
export const LOCALIZATION_OVERFLOW_ACTIONS = Object.freeze([
  "fits",
  "rebreak",
  "shrink",
  "enlarge",
  "human",
] as const);

export type LocalizationOverflowAction = (typeof LOCALIZATION_OVERFLOW_ACTIONS)[number];

/** 심각도 순서 — 집계에서 "가장 나쁜 권고"를 고를 때 쓴다. */
export const LOCALIZATION_OVERFLOW_SEVERITY: Readonly<Record<LocalizationOverflowAction, number>> =
  Object.freeze({ fits: 0, rebreak: 1, shrink: 2, enlarge: 3, human: 4 });

export interface LocalizationOverflowRung {
  readonly action: LocalizationOverflowAction;
  /** 이 단을 시도할 수 있었는가(정책·입력이 허용했는가). */
  readonly applicable: boolean;
  /** 이 단으로 넘침이 해소됐는가. */
  readonly resolved: boolean;
  /** 시도하지 못했거나 실패한 이유(한국어). */
  readonly reason?: string;
  /** 이 단을 적용했을 때의 제안 값들. */
  readonly text?: string;
  readonly fontSize?: number;
  readonly boxHeight?: number;
  readonly lines?: readonly string[];
}

export interface LocalizationOverflowPolicy {
  /** 절대 축소 하한(px). 기본 BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT(10). */
  readonly minFontSize?: number;
  /**
   * 저자 폰트 크기 대비 축소 하한 비율. 기본 0.8.
   *
   * 출처 없음 — **하우스 기본값**이다. 한 말풍선만 크게 줄이면 같은 페이지의 다른 말풍선과
   * 글자 크기가 눈에 띄게 어긋나므로 상한을 두는데, 그 경계값을 정한 공개 자료는 찾지 못했다.
   * 호출부가 시리즈 규칙에 맞게 바꿔 쓰라고 옵션으로 열어 둔다.
   */
  readonly minFontScale?: number;
  /**
   * 말풍선을 키울 수 있는 전체 높이 상한(px). **주지 않으면 확대 단은 시도하지 않는다** —
   * 이 엔진은 칸 안의 그림이 어디 있는지 모르고, 모르는 채로 키우라고 권할 수는 없다.
   * (폭 확대는 다루지 않는다: 출하된 맞춤 엔진에 폭 해법이 없어 여기서 새로 만들면
   *  studio-bubble-text-fit의 단일 소스 계약이 깨진다.)
   */
  readonly maxBoxHeight?: number;
  /** 상속된 강제 줄바꿈을 다시 흘리는 것을 허용할지. 기본 true. */
  readonly allowReflow?: boolean;
}

export interface LocalizationOverflowInput {
  /** 적용 **전**의 번역 초안 문자열. */
  readonly text: string;
  /** 원문(선택) — 확장률 추정에만 쓴다. */
  readonly sourceText?: string;
  readonly sourceLocale?: string;
  readonly targetLocale?: string;
  /** 말풍선 전체 폭/높이(px, 패딩 포함) — el.width / el.height 그대로. */
  readonly boxWidth: number;
  readonly boxHeight: number;
  /** 저자가 지정한 폰트 크기(px). */
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly fontStyle?: string;
  /** 반드시 `resolveBubbleLineHeight()` 결과를 넘긴다. */
  readonly lineHeight: number;
  readonly letterSpacing?: number;
  readonly vertical?: boolean;
  readonly blockAlign?: VerticalBlockAlign;
}

export interface LocalizationOverflowVerdict {
  /** 최종 권고. */
  readonly action: LocalizationOverflowAction;
  /** 권고를 적용하면 상자에 들어가는가. action이 "human"이면 항상 false. */
  readonly fits: boolean;
  /** 사람이 봐야 하는가 — action === "human"과 같다(호출부 가독성용). */
  readonly requiresHumanReview: boolean;
  /** 권고대로 했을 때의 최종 문자열(다시 끊기를 적용했으면 다시 흘린 문자열). */
  readonly text: string;
  readonly fontSize: number;
  readonly boxHeight: number;
  /** 참고용 줄(열) 배열 — 실제 캔버스는 Konva 자체 워드랩으로 그린다. */
  readonly lines: readonly string[];
  /** 줄 수를 바꾸지 않고 실루엣만 고른 대안(가로쓰기 전용, 없으면 null). */
  readonly balancedLines: readonly string[] | null;
  /** 권고 줄 배열의 금칙 위반 수(행두/행말) — 조판 품질 참고값. */
  readonly kinsokuViolations: number;
  readonly ladder: readonly LocalizationOverflowRung[];
  readonly budget: LocalizationEmBudget;
  readonly expansion: LocalizationExpansionEstimate;
  /** 관측 확장률(%) — 원문이 주어졌을 때만. 없으면 null. */
  readonly observedExpansionPercent: number | null;
  /** 관측값이 추정 구간 상단을 넘었는가(추가·환각 의심 신호). 구간이 없으면 false. */
  readonly beyondPredictedBand: boolean;
  readonly notes: readonly string[];
}

const DEFAULT_MIN_FONT_SCALE = 0.8;

/**
 * "들어가긴 하지만 여유가 없다"고 경고할 em 채움률 문턱.
 * 출처 없음 — **하우스 기본값**이다. 이 값은 판정을 바꾸지 않고 `notes` 한 줄만 더한다.
 */
const TIGHT_FILL_RATIO_NOTICE = 0.95;

/**
 * 공백으로 이어 붙이면 안 되는 문자(한중일 표의문자·가나).
 * 한글은 **일부러 뺐다** — 한국어는 어절(공백) 단위로 끊기므로 줄바꿈 자리에 공백을 되살리는
 * 것이 맞다. `packages/studio-project-model/src/ir/balloon-text-layout.ts`의 CJK_CHAR_WRAP이
 * 같은 이유로 한글을 제외한다.
 */
const CJK_NO_SPACE_JOIN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;

/**
 * 원문에서 딸려온 강제 줄바꿈을 풀어 한 문단으로 다시 흘린다.
 *
 * 경계에 공백을 넣을지는 양쪽 글자로 정한다: 한쪽이라도 표의문자·가나면 붙이고(그 언어는 공백
 * 없이 끊긴다), 아니면 한 칸을 되살린다(한국어·라틴은 줄바꿈이 어절 경계였다).
 * **문자를 버리지 않는다** — 공백 아닌 글자는 전부 보존된다.
 */
export function reflowInheritedLineBreaks(text: string): string {
  const chunks = text
    .split("\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
  if (chunks.length === 0) return "";
  let out = chunks[0]!;
  for (let index = 1; index < chunks.length; index += 1) {
    const next = chunks[index]!;
    const left = out.slice(-1);
    const right = next.slice(0, 1);
    const glue = CJK_NO_SPACE_JOIN.test(left) || CJK_NO_SPACE_JOIN.test(right) ? "" : " ";
    out = `${out}${glue}${next}`;
  }
  return out;
}

interface ProbeResult {
  readonly fits: boolean;
  readonly lines: readonly string[];
}

/**
 * "이 문자열이 이 상자에 이 폰트 크기로 들어가는가"를 **출하된 맞춤 엔진에 그대로 물어본다**.
 *
 * `fitBubbleFontSize`에 min=max로 같은 크기를 주면 탐색 없이 그 크기의 판정과 줄(열) 배열을
 * 돌려준다(그 함수의 `maxFontSize <= minFontSize` 조기 반환 경로). 덕분에 안전 여유·패딩·
 * 세로쓰기 처리를 여기서 한 줄도 복제하지 않고 재사용할 수 있다.
 */
function probeFit(
  input: LocalizationOverflowInput,
  text: string,
  fontSize: number,
  boxHeight: number,
  measurer: BubbleTextMeasurer
): ProbeResult {
  const pinned = Math.max(1, fontSize);
  const result = fitBubbleFontSize(
    {
      text,
      boxWidth: input.boxWidth,
      boxHeight,
      maxFontSize: pinned,
      minFontSize: pinned,
      fontFamily: input.fontFamily,
      fontStyle: input.fontStyle,
      lineHeight: input.lineHeight,
      vertical: input.vertical,
      letterSpacing: input.letterSpacing,
      blockAlign: input.blockAlign,
    },
    measurer
  );
  return { fits: !result.overflow, lines: result.lines };
}

/** 가로쓰기 줄 배열의 금칙 위반(행두/행말) 수 — 줄 사이 경계만 본다. */
function countKinsokuViolations(lines: readonly string[]): number {
  let violations = 0;
  for (let index = 0; index + 1 < lines.length; index += 1) {
    const before = segmentGraphemes(lines[index] ?? "").at(-1);
    const after = segmentGraphemes(lines[index + 1] ?? "").at(0);
    if (!isKinsokuBreakAllowed(before, after)) violations += 1;
  }
  return violations;
}

/**
 * 줄 수를 유지한 채 실루엣만 고른 대안을 만든다(가로쓰기 전용).
 *
 * `balanceRaggedLines`는 줄 수 불변이 계약이므로 이 결과는 맞춤 판정을 **절대 바꾸지 않는다**
 * — 그래서 권고와 별도 필드로 내보내 호출부가 원할 때만 쓰게 한다. 웹툰 레터링 관례에서
 * 말풍선 텍스트 실루엣은 마름모/원형이어야 하고 모래시계형은 금기다.
 */
function balancedLinesFor(
  input: LocalizationOverflowInput,
  text: string,
  fontSize: number,
  measurer: BubbleTextMeasurer
): readonly string[] | null {
  if (input.vertical) return null;
  const spaced = withBubbleLetterSpacing(measurer, input.letterSpacing);
  const fontStyle = input.fontStyle ?? "bold";
  const maxWidth = bubbleTextBoxWidth(input.boxWidth, fontSize);
  return balanceRaggedLines(
    (width) => wrapBubbleTextLines(text || " ", width, fontSize, input.fontFamily, fontStyle, spaced),
    maxWidth
  );
}

// ── §5. 판정 조립과 로케일 집계 ───────────────────────────────────────────────

/**
 * 번역 초안 한 줄을 적용하기 전에 넘침을 판정하고 수선 순서를 처방한다.
 *
 * 반환값의 `action`은 ①다시 끊기 ②폰트 축소 ③상자 확대 ④사람 순으로 **처음 해결되는 단**이며,
 * 아무 단도 해결하지 못하면 "human"이다. 어떤 경우에도 문자를 버리라고 권하지 않는다.
 */
export function evaluateLocalizationOverflow(
  input: LocalizationOverflowInput,
  measurer: BubbleTextMeasurer,
  policy: LocalizationOverflowPolicy = {}
): LocalizationOverflowVerdict {
  const fontSize = Math.max(1, input.fontSize);
  const fontStyle = input.fontStyle ?? "bold";
  const allowReflow = policy.allowReflow !== false;
  const notes: string[] = [];
  const ladder: LocalizationOverflowRung[] = [];

  const budget = measureLocalizationEmBudget(
    {
      text: input.text,
      boxWidth: input.boxWidth,
      boxHeight: input.boxHeight,
      fontSize,
      fontFamily: input.fontFamily,
      fontStyle,
      lineHeight: input.lineHeight,
      letterSpacing: input.letterSpacing,
      vertical: input.vertical,
    },
    measurer
  );

  const expansion = estimateLocalizationExpansion({
    sourceText: input.sourceText ?? "",
    sourceLocale: input.sourceLocale,
    targetLocale: input.targetLocale,
  });
  if (expansion.provenance === "derived") {
    notes.push("확장률 추정은 공개 표가 아니라 파생값이다 — 상자 치수를 확정하는 근거로 쓰지 말 것.");
  }
  if (expansion.provenance === "unpublished") {
    notes.push(UNPUBLISHED_PAIR_NOTE);
  }
  if (expansion.suspectedSourceTypo) {
    notes.push("이 확장률 행은 1차 자료(W3C)에서 앞뒤 행과 단조롭지 않아 오타로 의심된다 — 인쇄값 그대로 쓰되 참고 대안을 함께 본다.");
  }

  let observedExpansionPercent: number | null = null;
  if (typeof input.sourceText === "string" && input.sourceText.length > 0) {
    const spaced = withBubbleLetterSpacing(measurer, input.letterSpacing);
    const sourceWidth = spaced.measureWidth(input.sourceText, fontSize, input.fontFamily, fontStyle);
    const targetWidth = spaced.measureWidth(input.text, fontSize, input.fontFamily, fontStyle);
    if (sourceWidth > 0) observedExpansionPercent = (targetWidth / sourceWidth) * 100;
  }
  const beyondPredictedBand =
    observedExpansionPercent !== null &&
    expansion.band !== null &&
    observedExpansionPercent > expansion.band.maxPercent;
  if (beyondPredictedBand) {
    notes.push("실측 확장률이 추정 구간 상단을 넘었다 — 원문에 없던 내용이 덧붙었는지도 함께 확인할 것.");
  }

  const finish = (
    action: LocalizationOverflowAction,
    fits: boolean,
    text: string,
    chosenFontSize: number,
    chosenBoxHeight: number,
    lines: readonly string[]
  ): LocalizationOverflowVerdict => ({
    action,
    fits,
    requiresHumanReview: action === "human",
    text,
    fontSize: chosenFontSize,
    boxHeight: chosenBoxHeight,
    lines,
    balancedLines: balancedLinesFor(input, text, chosenFontSize, measurer),
    kinsokuViolations: input.vertical ? 0 : countKinsokuViolations(lines),
    ladder,
    budget,
    expansion,
    observedExpansionPercent,
    beyondPredictedBand,
    notes,
  });

  // ── ① 그대로 맞는가 ────────────────────────────────────────────────────────
  const asIs = probeFit(input, input.text, fontSize, input.boxHeight, measurer);
  ladder.push({
    action: "fits",
    applicable: true,
    resolved: asIs.fits,
    text: input.text,
    fontSize,
    boxHeight: input.boxHeight,
    lines: asIs.lines,
    ...(asIs.fits ? {} : { reason: "저자가 지정한 크기·상자로는 넘친다." }),
  });
  if (asIs.fits) {
    if (budget.fillRatio > TIGHT_FILL_RATIO_NOTICE) {
      notes.push("여유가 거의 없다(em 예산 95% 초과) — 대사가 조금만 길어져도 넘친다.");
    }
    return finish("fits", true, input.text, fontSize, input.boxHeight, asIs.lines);
  }

  // ── ② 다시 끊기 ────────────────────────────────────────────────────────────
  const hasInheritedBreaks = input.text.includes("\n");
  const reflowed = hasInheritedBreaks ? reflowInheritedLineBreaks(input.text) : input.text;
  const reflowUsable = allowReflow && hasInheritedBreaks && reflowed !== input.text;
  if (!reflowUsable) {
    ladder.push({
      action: "rebreak",
      applicable: false,
      resolved: false,
      reason: !allowReflow
        ? "정책이 강제 줄바꿈 재배치를 금지했다."
        : "원문에서 딸려온 강제 줄바꿈이 없어 다시 끊을 여지가 없다.",
    });
  } else {
    // fillRatio > 1 이면 사실상 가망이 없지만, 그 값은 **상계 근사**다(줄바꿈이 공백 한 칸을
    // 흡수하므로 실제 소비 em은 수요보다 조금 작다). 근사로 단을 건너뛰지 않고 언제나 실제
    // 판정을 물어본다 — 진단값을 판정으로 쓰지 않는다는 이 모듈의 규칙 그대로다.
    const probe = probeFit(input, reflowed, fontSize, input.boxHeight, measurer);
    ladder.push({
      action: "rebreak",
      applicable: true,
      resolved: probe.fits,
      text: reflowed,
      fontSize,
      boxHeight: input.boxHeight,
      lines: probe.lines,
      ...(probe.fits ? {} : { reason: "다시 흘려도 여전히 넘친다." }),
    });
    if (probe.fits) {
      notes.push("원문에서 딸려온 강제 줄바꿈을 풀어 상자 폭에 맞게 다시 흘렸다 — 글자는 그대로다.");
      return finish("rebreak", true, reflowed, fontSize, input.boxHeight, probe.lines);
    }
  }

  // 아래 단들은 "다시 끊기"까지 반영한 최선의 문자열 위에서 계속한다.
  const candidate = reflowUsable ? reflowed : input.text;
  if (reflowUsable) {
    notes.push("아래 단들의 판정은 강제 줄바꿈을 푼 문자열 기준이다.");
  }

  // ── ③ 폰트 축소 ────────────────────────────────────────────────────────────
  const absoluteFloor = Math.max(1, policy.minFontSize ?? BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT);
  const scaleFloor = fontSize * (policy.minFontScale ?? DEFAULT_MIN_FONT_SCALE);
  const shrinkFloor = Math.max(absoluteFloor, scaleFloor);
  if (shrinkFloor >= fontSize) {
    ladder.push({
      action: "shrink",
      applicable: false,
      resolved: false,
      reason: `축소 하한(${Math.round(shrinkFloor * 10) / 10}px)이 저자 크기(${fontSize}px) 이상이라 줄일 여지가 없다.`,
    });
  } else {
    const shrunk = fitBubbleFontSize(
      {
        text: candidate,
        boxWidth: input.boxWidth,
        boxHeight: input.boxHeight,
        maxFontSize: fontSize,
        minFontSize: shrinkFloor,
        fontFamily: input.fontFamily,
        fontStyle: input.fontStyle,
        lineHeight: input.lineHeight,
        vertical: input.vertical,
        letterSpacing: input.letterSpacing,
        blockAlign: input.blockAlign,
      },
      measurer
    );
    ladder.push({
      action: "shrink",
      applicable: true,
      resolved: !shrunk.overflow,
      text: candidate,
      fontSize: shrunk.fontSize,
      boxHeight: input.boxHeight,
      lines: shrunk.lines,
      ...(shrunk.overflow
        ? { reason: `축소 하한(${Math.round(shrinkFloor * 10) / 10}px)까지 줄여도 넘친다.` }
        : {}),
    });
    if (!shrunk.overflow) {
      notes.push(`폰트를 ${fontSize}px → ${shrunk.fontSize}px로 줄이면 들어간다.`);
      return finish("shrink", true, candidate, shrunk.fontSize, input.boxHeight, shrunk.lines);
    }
  }

  // ── ④ 상자 확대 ────────────────────────────────────────────────────────────
  const requiredHeight = fitBubbleBoxHeightToText(
    {
      text: candidate,
      boxWidth: input.boxWidth,
      fontSize,
      fontFamily: input.fontFamily,
      fontStyle: input.fontStyle,
      lineHeight: input.lineHeight,
      letterSpacing: input.letterSpacing,
      vertical: input.vertical,
      blockAlign: input.blockAlign,
      minHeight: input.boxHeight,
    },
    measurer
  );
  const allowance = policy.maxBoxHeight;
  if (typeof allowance !== "number" || !Number.isFinite(allowance)) {
    ladder.push({
      action: "enlarge",
      applicable: false,
      resolved: false,
      boxHeight: requiredHeight,
      reason: `호출부가 확대 여유(maxBoxHeight)를 주지 않았다 — 저자 크기를 지키려면 높이 ${requiredHeight}px가 필요하다.`,
    });
  } else if (requiredHeight > allowance) {
    ladder.push({
      action: "enlarge",
      applicable: true,
      resolved: false,
      boxHeight: requiredHeight,
      reason: `필요한 높이 ${requiredHeight}px가 허용 여유 ${allowance}px를 넘는다.`,
    });
  } else {
    const probe = probeFit(input, candidate, fontSize, requiredHeight, measurer);
    ladder.push({
      action: "enlarge",
      applicable: true,
      resolved: probe.fits,
      text: candidate,
      fontSize,
      boxHeight: requiredHeight,
      lines: probe.lines,
      ...(probe.fits ? {} : { reason: "높이를 늘려도 판정이 통과하지 않는다(폭이 한 줄도 담지 못하는 입력)." }),
    });
    if (probe.fits) {
      notes.push(`말풍선 높이를 ${input.boxHeight}px → ${requiredHeight}px로 키우면 저자 폰트 크기를 지킬 수 있다.`);
      return finish("enlarge", true, candidate, fontSize, requiredHeight, probe.lines);
    }
  }

  // ── ⑤ 사람에게 ─────────────────────────────────────────────────────────────
  ladder.push({
    action: "human",
    applicable: true,
    resolved: false,
    text: candidate,
    fontSize,
    boxHeight: input.boxHeight,
    reason: "자동 수선이 모두 막혔다 — 문장을 줄이거나 칸/말풍선을 다시 짜야 한다. 자동 잘라내기는 하지 않는다.",
  });
  notes.push(
    `사람이 판단해야 한다. 자르지 말 것 — 저자 크기를 지키려면 높이 ${requiredHeight}px가 필요하고, em 수요/용량은 ${budget.emDemand.toFixed(1)}/${budget.emCapacity.toFixed(1)}이다.`
  );
  // 넘치는 상태 그대로의 줄 배열을 보여 준다(어디서 잘려 보이는지 사람이 눈으로 확인해야 하므로).
  const humanLines =
    candidate === input.text ? asIs.lines : probeFit(input, candidate, fontSize, input.boxHeight, measurer).lines;
  return finish("human", false, candidate, fontSize, input.boxHeight, humanLines);
}

export interface LocalizationOverflowSummary {
  readonly total: number;
  readonly counts: Readonly<Record<LocalizationOverflowAction, number>>;
  /** 가장 심각한 권고. 입력이 비면 "fits". */
  readonly worstAction: LocalizationOverflowAction;
  /** 사람이 봐야 하는 대사 수. */
  readonly humanReviewCount: number;
}

/** 에피소드·로케일 단위 집계 — 판정을 세기만 한다(정책 판단은 호출부 몫). */
export function summarizeLocalizationOverflow(
  verdicts: readonly LocalizationOverflowVerdict[]
): LocalizationOverflowSummary {
  const counts: Record<LocalizationOverflowAction, number> = {
    fits: 0,
    rebreak: 0,
    shrink: 0,
    enlarge: 0,
    human: 0,
  };
  let worstAction: LocalizationOverflowAction = "fits";
  for (const verdict of verdicts) {
    counts[verdict.action] += 1;
    if (LOCALIZATION_OVERFLOW_SEVERITY[verdict.action] > LOCALIZATION_OVERFLOW_SEVERITY[worstAction]) {
      worstAction = verdict.action;
    }
  }
  return { total: verdicts.length, counts, worstAction, humanReviewCount: counts.human };
}
