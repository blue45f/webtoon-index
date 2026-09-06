/**
 * Studio Bubble Legibility Contrast — 말풍선 **대사 글자와 말풍선 바탕의 명도 대비**를 WCAG 기준으로
 * 감사하는 순수 엔진.
 *
 * 왜 이 모듈이 필요한가
 * ---------------------
 * 이 저장소에는 대비 계산기가 이미 있다 — `studio-color-harmony-engine.ts`의
 * `calculateContrastRatio` / `auditContrast`. 그런데 그 둘을 쓰는 곳은 **색상 팝오버 하나뿐**이고,
 * 둘 다 "이 색을 흰 배경/검은 배경에 얹으면 몇 대 몇인가"만 답한다. 정작 독자가 실제로 읽는
 * 조합인 **BubbleEl.textFill 대 BubbleEl.fill**을 재는 코드는 한 줄도 없었다. 그래서 흰 말풍선에
 * 연회색 대사를 얹어도 아무 경고가 없다.
 *
 * 이 모듈은 그 빈자리만 채운다. 대비 계산 자체는 **다시 구현하지 않고** 위 엔진의
 * `calculateContrastRatio`를 그대로 호출한다(색 과학이 두 벌이 되면 두 값이 갈라진다).
 * 이 파일이 새로 맡는 일은 셋뿐이다:
 *   (1) 입력이 정말 "불투명 단색"인지 **먼저** 판별하고, 아니면 판정을 거부한다(§2)
 *   (2) 글자 크기·굵기로 WCAG 큰 글자 여부를 갈라 임계값을 고른다(§3)
 *   (3) 비율과 임계값을 비교해 pass / fail / indeterminate 를 낸다(§4)
 *
 * ⚠ 이 엔진의 적용 범위 — 불투명 단색 말풍선에 한정한다
 * ---------------------------------------------------
 * 대비비는 **두 개의 확정된 색** 사이에서만 정의된다. 다음 셋은 순수 함수가 원리적으로 판정할 수
 * 없으므로 전부 `indeterminate`로 돌려보낸다. "모르겠다"가 틀린 PASS 보다 항상 낫다.
 *  · **반투명 채우기** — `rgba(...)`, `#rrggbbaa`(alpha<ff), `transparent`. 실제 픽셀은 말풍선
 *    아래 깔린 그림과 알파 합성된 결과이고, 그 그림 픽셀은 이 함수의 입력에 없다.
 *  · **그라데이션·패턴·이미지 채우기** — 배경색이 글자 위치마다 다르다. 하나의 비율이 존재하지
 *    않는다(BubbleEl.gradient 가 설정되면 fill 단색은 렌더에 쓰이지도 않는다).
 *  · **말풍선 없이 그림 위에 얹힌 자유 텍스트** — 배경이 그림 픽셀이다. 이건 래스터를 샘플링해야
 *    답이 나오는 문제이지 순수 함수의 문제가 아니다.
 *
 * 가장 위험한 실패 모드(그리고 이 파일이 그것을 막는 방법)
 * -----------------------------------------------------
 * 재사용하는 계산기는 **헥스 전용**이고, 파싱에 실패하면 던지지 않고 조용히 `#000000`으로
 * 폴백한다(studio-color-harmony-engine.hexToRgb → normalizeHexColor 가 null 이면 "#000000").
 * 즉 `calculateContrastRatio("rgba(255,255,255,.9)", "#ffffff")`는 예외 없이 **21:1**을 돌려준다 —
 * 흰 바탕에 흰 글자인데 만점이다. 이 조용한 오답이 UI에 붙으면 "검사했고 통과했다"는 **거짓
 * 통과**가 되어, 검사기가 아예 없는 것보다 나쁘다.
 * 그래서 이 파일은 §2의 파서를 **먼저** 통과시키고, 불투명 단색으로 확정된 입력만 계산기에
 * 넘긴다. 모든 판정 함수의 기본값은 `indeterminate`다.
 *
 * 출처 (이 파일의 모든 수치는 아래 중 하나에서 온다. 인용할 수 없는 값은 그 자리에 UNVERIFIED 로
 * 표시했고, 표시된 값은 판정에 쓰지 않는다)
 * ---------------------------------------------------------------------------------------------
 *  [WCAG-143] W3C WCAG 2.2, SC 1.4.3 Contrast (Minimum), Level AA —
 *             일반 글자 4.5:1, 큰 글자(large scale) 3:1.
 *  [WCAG-146] W3C WCAG 2.2, SC 1.4.6 Contrast (Enhanced), Level AAA —
 *             일반 글자 7:1, 큰 글자 4.5:1.
 *  [WCAG-LG]  WCAG 2.2 Glossary, "large scale" — 최소 18 point, 굵은 글씨는 최소 14 point.
 *  [WCAG-CR]  WCAG 2.2 Glossary, "contrast ratio" — (L1+0.05)/(L2+0.05).
 *             구현은 studio-color-harmony-engine.calculateContrastRatio 를 그대로 쓴다.
 *  [CSS-U]    CSS Values and Units — 1pt = 1/72in, 1px = 1/96in ⇒ 1pt = 96/72 = 4/3 px.
 *             (WCAG 2 Understanding SC 1.4.3 도 같은 환산을 "1pt = 1.333px"로 적는다.)
 *             ⇒ 18pt = 24px, 14pt = 18.666…px. 이 파일은 반올림하지 않고 4/3 배율을 그대로 쓴다.
 *
 * §1. 입력·출력 계약
 * §2. 불투명 단색 파서 — 계산 이전의 관문
 * §3. WCAG 임계값 선택(큰 글자 판정)
 * §4. 판정
 */

import { calculateContrastRatio } from "../studio-color-harmony-engine";
import { isValidHexColor, normalizeHexColor } from "../studio-color-utils";

/* =====================================================================
 * §1. 입력·출력 계약
 * ===================================================================== */

/** 준수 수준. AA = SC 1.4.3, AAA = SC 1.4.6. 기본은 AA. */
export type BubbleLegibilityLevel = "AA" | "AAA";

export type BubbleLegibilityVerdict = "pass" | "fail" | "indeterminate";

/**
 * 판정을 거부한 이유. `verdict === "indeterminate"`일 때만 채워진다.
 * UI 문구는 이 코드에 매핑해서 붙인다 — 엔진은 사람이 읽을 문장을 만들지 않는다
 * (이 저장소의 다른 린터들과 같은 규약: 엔진은 코드, 표면은 문구).
 */
export type BubbleLegibilityIndeterminateReason =
  /** 글자색이 비었다(undefined/null/공백/문자열 아님). */
  | "text-color-missing"
  /** 글자색을 이 엔진이 파싱하지 못했다(named color, rgb(), hsl(), var() 등). */
  | "text-color-unparsed"
  /** 글자색이 반투명이다(alpha < 1). 실제 픽셀은 아래 그림과 합성된 값이다. */
  | "text-color-translucent"
  /** 글자 채우기가 단색이 아니다(그라데이션). */
  | "text-fill-not-solid"
  /** 배경(말풍선 채우기)이 비었다 — 그림 위 자유 텍스트가 여기에 해당한다. */
  | "backdrop-missing"
  /** 배경색을 이 엔진이 파싱하지 못했다. */
  | "backdrop-unparsed"
  /** 배경이 반투명이다. 아래 그림 픽셀이 비쳐 보이므로 배경색이 하나로 정해지지 않는다. */
  | "backdrop-translucent"
  /** 배경이 단색이 아니다(그라데이션/패턴/이미지). 위치마다 배경색이 다르다. */
  | "backdrop-not-solid"
  /** 글자에 외곽선이 있다. WCAG 2.2 에는 외곽선 글자를 다루는 성공 기준이 없다(§4 참고). */
  | "outlined-text"
  /** 글자 크기를 모른다 — 임계값(일반/큰 글자)을 고를 수 없다. */
  | "font-size-unknown"
  /** 비율이 임계값과 소수 둘째 자리까지 같아, 반올림 오차 안에서 어느 쪽인지 단정할 수 없다. */
  | "ratio-at-rounding-boundary";

export interface BubbleLegibilityInput {
  /** 글자색. BubbleEl.textFill / TextEl.fill. */
  readonly textColor?: string | null;
  /**
   * 글자 채우기가 그라데이션인가. TextEl 은 색(fill)과 별개로 `fillType: "gradient"` + `gradient`
   * 를 들고 있어서, 색만 보면 단색으로 보이지만 실제 렌더는 그라데이션이다 — 이 플래그가 없으면
   * 바로 그 조합이 거짓 통과가 된다.
   */
  readonly textIsGradient?: boolean;
  /** 배경색(말풍선 채우기). BubbleEl.fill. 말풍선이 없으면 넘기지 않는다 → indeterminate. */
  readonly backdropColor?: string | null;
  /**
   * 배경이 단색이 아닌가. BubbleEl.gradient 가 설정되면 fill(단색)보다 **우선**해서 렌더된다
   * (studio-element-model.BubbleEl.gradient 주석). 즉 fill 만 보고 판정하면 화면에 없는 색으로
   * 계산하게 된다. 패턴/이미지 채우기도 이 플래그로 넘긴다.
   */
  readonly backdropIsGradient?: boolean;
  /** 글자 외곽선 색. TextEl.stroke / BubbleEl 계열 SFX 외곽선. */
  readonly strokeColor?: string | null;
  /** 글자 외곽선 두께(px). 0 이하이거나 미설정이면 외곽선 없음으로 본다. */
  readonly strokeWidth?: number;
  /**
   * 글자 크기(px, 렌더에 실제로 쓰이는 값). BubbleEl.fontSize 는 선택 필드이고 미설정 시 기본 24
   * 가 적용되므로(studio-element-model 주석), **호출부가 기본값을 적용한 뒤** 넘겨야 한다.
   * 이 엔진은 기본값을 추측하지 않는다 — 크기를 잘못 짚으면 임계값이 4.5 대신 3 이 되어 거짓
   * 통과가 나온다.
   */
  readonly fontSizePx?: number;
  /** CSS 수치 굵기(400, 700 …). 있으면 fontStyle 보다 우선한다. */
  readonly fontWeight?: number;
  /** Konva 계열 문자열 스타일. BubbleEl.fontStyle / TextEl.fontStyle 을 그대로 넘긴다. */
  readonly fontStyle?: string;
  /** 준수 수준. 기본 "AA". */
  readonly level?: BubbleLegibilityLevel;
}

export interface BubbleLegibilityReport {
  readonly verdict: BubbleLegibilityVerdict;
  /** 대비비. 판정을 못 냈으면 null. 소수 둘째 자리까지(계산기 규약). */
  readonly ratio: number | null;
  /** 적용한 WCAG 임계값. 판정을 못 냈으면 null. */
  readonly threshold: number | null;
  readonly level: BubbleLegibilityLevel;
  /** 적용한 성공 기준 번호. AA → "1.4.3", AAA → "1.4.6". 판정을 못 냈으면 null. */
  readonly successCriterion: "1.4.3" | "1.4.6" | null;
  /** WCAG "large scale" 해당 여부. 크기를 모르면 null. */
  readonly textScale: "normal" | "large" | null;
  /** indeterminate 사유. pass/fail 이면 null. */
  readonly reason: BubbleLegibilityIndeterminateReason | null;
  /**
   * 외곽선이 있어 판정을 보류할 때만 채워지는 참고 수치(§4). 판정에는 쓰지 않는다 —
   * 사람이 눈으로 확인할 때 쓰라고 노출한다. 둘 중 하나라도 파싱 불가면 그 항목은 null.
   */
  readonly outlineRatios: {
    readonly textVsStroke: number | null;
    readonly strokeVsBackdrop: number | null;
  } | null;
}

/* =====================================================================
 * §2. 불투명 단색 파서 — 계산 이전의 관문
 *
 * 재사용하는 계산기는 헥스만 알고, 실패해도 던지지 않고 #000000 을 돌려준다(파일 머리말 참고).
 * 그래서 계산기에 넘기기 **전에** 여기서 확정한다. 통과하는 것은 딱 하나 — 알파가 완전 불투명인
 * 헥스 색이다.
 *
 *   #rgb / #rrggbb      → normalizeHexColor 가 그대로 받는다(studio-color-utils).
 *   #rgba / #rrggbbaa   → 알파 자리가 f / ff 일 때만 불투명으로 인정하고 알파를 떼어 넘긴다.
 *                         그 외 알파는 "translucent" — 아래 그림과 합성되므로 판정 불가.
 *   그 밖의 전부         → "unparsed". named color("white"), rgb()/rgba(), hsl(), color(),
 *                         var(--x), linear-gradient(...), "none" 이 여기로 온다. 이 엔진은
 *                         CSS 색 문법을 해석하지 않는다 — 반쯤 맞는 파서가 조용히 틀린 색을
 *                         만들어내는 것이 정확히 이 파일이 막으려는 실패다.
 * ===================================================================== */

/** §2 파서의 결과. `ok`면 헥스 색이 확정된 것이고, 아니면 그 이유가 들어 있다. */
type SolidColorParse =
  | { readonly ok: true; readonly hex: string }
  | { readonly ok: false; readonly kind: "missing" | "translucent" | "unparsed" };

/** 알파 자리가 완전 불투명(255)임을 뜻하는 16진 표기. #rgba 는 1자리, #rrggbbaa 는 2자리. */
const OPAQUE_ALPHA_SHORT = "f";
const OPAQUE_ALPHA_LONG = "ff";

/** #rgba(4자리) / #rrggbbaa(8자리) — 알파를 포함한 헥스 표기. */
const HEX_WITH_ALPHA_RE = /^#(?:[0-9a-f]{4}|[0-9a-f]{8})$/i;

/**
 * 문자열 하나를 "불투명 단색 헥스"로 확정하거나 거부한다.
 * 이 함수가 ok:true 를 준 값만 대비 계산기에 들어간다.
 */
function parseOpaqueSolidColor(raw: string | null | undefined): SolidColorParse {
  if (typeof raw !== "string") return { ok: false, kind: "missing" };
  const value = raw.trim();
  if (value.length === 0) return { ok: false, kind: "missing" };

  // 알파를 가진 헥스는 완전 불투명일 때만 통과시키고 알파를 떼어낸다.
  if (HEX_WITH_ALPHA_RE.test(value)) {
    const body = value.slice(1).toLowerCase();
    if (body.length === 4) {
      if (body.slice(3) !== OPAQUE_ALPHA_SHORT) return { ok: false, kind: "translucent" };
      const hex = normalizeHexColor(`#${body.slice(0, 3)}`);
      return hex === null ? { ok: false, kind: "unparsed" } : { ok: true, hex };
    }
    if (body.slice(6) !== OPAQUE_ALPHA_LONG) return { ok: false, kind: "translucent" };
    const hex = normalizeHexColor(`#${body.slice(0, 6)}`);
    return hex === null ? { ok: false, kind: "unparsed" } : { ok: true, hex };
  }

  if (!isValidHexColor(value)) {
    // rgba()/hsla()/transparent 는 "파싱 실패"보다 "반투명일 수 있음"으로 알리는 편이 호출부에
    // 훨씬 유용하다. 알파 값 자체는 해석하지 않는다 — 알파가 1이어도 배경 픽셀을 모르는 것은
    // 마찬가지이고, 여기서 rgba 를 반쯤 해석하기 시작하면 §2의 취지가 무너진다.
    const lowered = value.toLowerCase();
    if (
      lowered === "transparent" ||
      lowered.startsWith("rgba(") ||
      lowered.startsWith("hsla(")
    ) {
      return { ok: false, kind: "translucent" };
    }
    return { ok: false, kind: "unparsed" };
  }

  const hex = normalizeHexColor(value);
  return hex === null ? { ok: false, kind: "unparsed" } : { ok: true, hex };
}

/* =====================================================================
 * §3. WCAG 임계값 선택(큰 글자 판정)
 * ===================================================================== */

/** 1pt = 96/72 px. [CSS-U] */
const PT_TO_PX = 96 / 72;

/** large scale 하한 — 일반 굵기 18pt. [WCAG-LG] → 24px. */
const LARGE_TEXT_MIN_PX_REGULAR = 18 * PT_TO_PX;

/** large scale 하한 — 굵은 글씨 14pt. [WCAG-LG] → 18.666…px. */
const LARGE_TEXT_MIN_PX_BOLD = 14 * PT_TO_PX;

/**
 * "굵은 글씨"의 수치 경계. WCAG 2.2 는 "bold"라고만 쓰고 수치 굵기를 정의하지 **않는다** —
 * 이 700 경계는 CSS Fonts 의 `font-weight: bold` = 700 매핑을 따른 **이 저장소의 정책**이며,
 * WCAG 출처가 없는 값이다(UNVERIFIED against WCAG).
 * 방향은 안전한 쪽이다: 굵기를 모르면 굵지 않다고 보고 더 엄격한 임계값을 쓴다.
 */
const BOLD_MIN_WEIGHT = 700;

/** SC 1.4.3(AA) 임계값 — 일반 4.5, 큰 글자 3. [WCAG-143] */
const AA_THRESHOLD_NORMAL = 4.5;
const AA_THRESHOLD_LARGE = 3;

/** SC 1.4.6(AAA) 임계값 — 일반 7, 큰 글자 4.5. [WCAG-146] */
const AAA_THRESHOLD_NORMAL = 7;
const AAA_THRESHOLD_LARGE = 4.5;

/** fontWeight(수치) 우선, 없으면 fontStyle 문자열의 "bold" 토큰을 본다. 둘 다 없으면 보통 굵기. */
function isBoldText(input: BubbleLegibilityInput): boolean {
  if (typeof input.fontWeight === "number" && Number.isFinite(input.fontWeight)) {
    return input.fontWeight >= BOLD_MIN_WEIGHT;
  }
  if (typeof input.fontStyle === "string") {
    // "bold" / "bold italic" — Konva 의 fontStyle 표기(studio-element-model).
    return /\bbold\b/i.test(input.fontStyle);
  }
  return false;
}

/** WCAG large scale 여부. [WCAG-LG] + [CSS-U] */
export function isWcagLargeText(fontSizePx: number, bold: boolean): boolean {
  const floor = bold ? LARGE_TEXT_MIN_PX_BOLD : LARGE_TEXT_MIN_PX_REGULAR;
  return fontSizePx >= floor;
}

/** 수준 × 크기 → 임계값. [WCAG-143] [WCAG-146] */
export function wcagContrastThreshold(
  level: BubbleLegibilityLevel,
  scale: "normal" | "large",
): number {
  if (level === "AAA") return scale === "large" ? AAA_THRESHOLD_LARGE : AAA_THRESHOLD_NORMAL;
  return scale === "large" ? AA_THRESHOLD_LARGE : AA_THRESHOLD_NORMAL;
}

/* =====================================================================
 * §4. 판정
 * ===================================================================== */

function indeterminate(
  reason: BubbleLegibilityIndeterminateReason,
  level: BubbleLegibilityLevel,
  extra?: Partial<BubbleLegibilityReport>,
): BubbleLegibilityReport {
  return Object.freeze({
    verdict: "indeterminate" as const,
    ratio: null,
    threshold: null,
    level,
    successCriterion: null,
    textScale: null,
    reason,
    outlineRatios: null,
    ...extra,
  });
}

/** 파싱 실패 종류를 글자/배경 각각의 사유 코드로 옮긴다. */
function textReasonFor(kind: "missing" | "translucent" | "unparsed") {
  if (kind === "missing") return "text-color-missing" as const;
  if (kind === "translucent") return "text-color-translucent" as const;
  return "text-color-unparsed" as const;
}

function backdropReasonFor(kind: "missing" | "translucent" | "unparsed") {
  if (kind === "missing") return "backdrop-missing" as const;
  if (kind === "translucent") return "backdrop-translucent" as const;
  return "backdrop-unparsed" as const;
}

/** 계산기가 소수 둘째 자리로 반올림해 돌려주므로, 임계값과의 동치 비교도 그 자리에서 한다. */
const RATIO_EQUALITY_EPSILON = 1e-9;

/**
 * 말풍선 대사의 명도 대비를 감사한다.
 *
 * 기본값은 **언제나 indeterminate**다. pass/fail 은 아래를 전부 만족할 때만 나온다:
 *   · 글자색·배경색이 §2 파서를 통과한 불투명 단색이고
 *   · 어느 쪽도 그라데이션 플래그가 서 있지 않고
 *   · 글자에 외곽선이 없고
 *   · 글자 크기가 유한한 양수이고
 *   · 비율이 임계값과 반올림 경계에서 겹치지 않는다
 */
export function auditBubbleTextLegibility(
  input: BubbleLegibilityInput,
): BubbleLegibilityReport {
  const level: BubbleLegibilityLevel = input.level === "AAA" ? "AAA" : "AA";

  // ── 배경이 단색이 아니면 아예 계산할 대상이 없다. 그라데이션 플래그를 색보다 먼저 본다 —
  //    BubbleEl.gradient 는 fill 을 덮으므로, fill 이 아무리 멀쩡한 헥스여도 화면에는 없는 색이다.
  if (input.backdropIsGradient === true) return indeterminate("backdrop-not-solid", level);
  if (input.textIsGradient === true) return indeterminate("text-fill-not-solid", level);

  const text = parseOpaqueSolidColor(input.textColor);
  if (!text.ok) return indeterminate(textReasonFor(text.kind), level);

  const backdrop = parseOpaqueSolidColor(input.backdropColor);
  if (!backdrop.ok) return indeterminate(backdropReasonFor(backdrop.kind), level);

  // ── 외곽선이 있으면 판정하지 않는다.
  //    WCAG 2.2 에는 외곽선(할로)이 있는 글자의 대비를 정의하는 성공 기준이 **없다**. 글자 가장
  //    자리에서 독자가 실제로 마주하는 색은 배경이 아니라 외곽선이고, "글자 대 외곽선"과
  //    "외곽선 대 배경"을 어떻게 합성해 하나의 수치로 만들지에 대한 규범적 근거가 어디에도 없다.
  //    (min 을 쓰면 글자와 같은 색의 두꺼운 외곽선이 거짓 실패가 되고, max 를 쓰면 거짓 통과가
  //    난다.) 그래서 여기서는 두 성분 비율만 참고값으로 노출하고 판정은 사람에게 넘긴다 —
  //    이 합성 규칙은 UNVERIFIED 이며, 근거 없는 수치를 지어내느니 답하지 않는 쪽을 택한다.
  //    두께 판정은 **보수적으로** 한다: 외곽선 색이 있는데 두께가 미설정이면 외곽선이 있는 것으로
  //    본다(Konva 는 strokeWidth 를 생략해도 기본 두께로 그린다). 명시적으로 0 이하일 때만
  //    "외곽선 없음"이다.
  const strokeWidth = input.strokeWidth;
  const strokeWidthDisabled =
    typeof strokeWidth === "number" && (!Number.isFinite(strokeWidth) || strokeWidth <= 0);
  const stroke = parseOpaqueSolidColor(input.strokeColor);
  const hasStrokeColor = stroke.ok || stroke.kind !== "missing";
  if (hasStrokeColor && !strokeWidthDisabled) {
    return indeterminate("outlined-text", level, {
      outlineRatios: Object.freeze({
        textVsStroke: stroke.ok ? calculateContrastRatio(text.hex, stroke.hex) : null,
        strokeVsBackdrop: stroke.ok ? calculateContrastRatio(stroke.hex, backdrop.hex) : null,
      }),
    });
  }

  // ── 글자 크기를 모르면 임계값을 고를 수 없다. 추측하지 않는다: 24px 을 가정했다가 실제가
  //    12px 이면 임계값이 3 이 되어 거짓 통과가 나온다.
  const fontSizePx = input.fontSizePx;
  if (typeof fontSizePx !== "number" || !Number.isFinite(fontSizePx) || fontSizePx <= 0) {
    return indeterminate("font-size-unknown", level);
  }

  const scale = isWcagLargeText(fontSizePx, isBoldText(input)) ? "large" : "normal";
  const threshold = wcagContrastThreshold(level, scale);
  const ratio = calculateContrastRatio(text.hex, backdrop.hex);
  const successCriterion = level === "AAA" ? ("1.4.6" as const) : ("1.4.3" as const);

  // ── 반올림 경계. 계산기는 소수 둘째 자리로 반올림하므로 보고된 4.5 의 실제 값은
  //    [4.495, 4.505) 구간이며 임계값 4.5 의 양쪽에 걸친다. 보고값이 임계값과 정확히 같은
  //    그 한 경우에만 어느 쪽인지 단정할 수 없다(4.49 는 확실히 미달, 4.51 은 확실히 충족).
  //    거짓 통과를 만드느니 모른다고 답한다.
  if (Math.abs(ratio - threshold) < RATIO_EQUALITY_EPSILON) {
    return indeterminate("ratio-at-rounding-boundary", level, {
      ratio,
      threshold,
      successCriterion,
      textScale: scale,
    });
  }

  // WCAG 의 판정은 "임계값 이상"(>=)이지만, 동치인 경우는 바로 위 반올림 경계 분기가 이미
  // 가로챘으므로 여기 도달한 비율은 임계값과 같지 않다 — 따라서 > 와 >= 가 동일하다.
  return Object.freeze({
    verdict: ratio > threshold ? ("pass" as const) : ("fail" as const),
    ratio,
    threshold,
    level,
    successCriterion,
    textScale: scale,
    reason: null,
    outlineRatios: null,
  });
}
