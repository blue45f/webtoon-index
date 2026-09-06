/**
 * Studio Bubble Text Fit — 말풍선 **타이포그래피 단일 소스**이자 두 자동 맞춤 엔진.
 *
 * 말풍선에는 대사가 상자를 넘칠 때의 대응이 둘 있다.
 *  · 기본 모드: 상자 **높이**를 늘려 다 들어오게 한다 → `fitBubbleBoxHeightToText`
 *  · "크기 고정"(autoShrinkText): 높이 대신 **폰트 크기**를 이진 탐색으로 줄인다
 *    → `fitBubbleFontSize` (Canva/Figma의 "autosize: shrink text on overflow"와 같은 패턴)
 * 둘은 **같은 판정**(`bubbleTextFitsInBox`)을 공유한다 — 서로 다른 여유/패딩을 가정하면 한쪽이
 * "맞다"고 한 상자를 다른 쪽이 "넘친다"고 보는 모순이 생긴다.
 *
 * 그리고 이 모듈은 렌더·측정·맞춤 세 경로가 공유하는 기본값(행간·글꼴 두께·자간·패딩)의 유일한
 * 소스다. 이 값들이 경로마다 달랐던 것이 "커밋하면 대사가 조용히 사라진다" 결함의 뿌리였다
 * (아래 "말풍선 타이포그래피 기본값 단일 소스" 절 참고).
 *
 * 전부 순수·결정적 — 텍스트 폭 측정은 호출부가 주입하는 BubbleTextMeasurer 포트로 분리했다
 * (studio-pdf-contact-sheet.ts의 ctx.measureText 기반 이진 탐색과 동일한 관례: 코어 알고리즘은
 * Canvas/Konva 런타임과 무관하고, 테스트는 글자 수 기반 가짜 측정기를 주입해 결정적으로 검증
 * 한다). 실제 화면에서는 createCanvasBubbleTextMeasurer()가 만드는 실제 2D 컨텍스트 측정기를 쓴다.
 *
 * 패딩 계산(bubbleHorizontalPadding/bubbleVerticalPadding)은 폰트 크기의 0.6/0.48/0.64배(최소
 * 12/8/10px) 공식이며, 렌더(StudioKonvaBubbleNode)·커밋 측정(StudioPage.commitEditText)·인라인
 * 편집(StudioTextEditOverlay)·높이 맞춤(studio-fit)이 전부 여기를 호출한다 — 두 곳이 다른 공식을
 * 쓰면 "탐색이 가정한 여유 폭"과 "실제 렌더 여유 폭"이 어긋나 잘못된 크기를 고른다.
 *
 * 단조성 가정(왜 이진 탐색이 유효한가): fontSize가 작아질수록 (1) hPad/vPad는 `max(고정 하한,
 * fontSize*비율)` 형태라 단조 비증가하므로 사용 가능 폭/높이는 단조 비감소하고, (2) 같은 폭에서
 * 그리디 워드랩이 필요로 하는 줄 수는 글자 폭이 좁아질수록 단조 비증가하지 않는다(같거나 준다).
 * 두 효과 모두 "작을수록 더 잘 맞는다" 방향이라 표준 경계 이진 탐색이 유효하다. 그리디 워드랩의
 * 아주 병적인 입력(예: 특정 폭에서만 우연히 한 단어가 걸치는 경우)에서 아주 드물게 이 가정이
 * 깨질 수 있으나, 기존 studio-pdf-contact-sheet.ts의 fitLabelToWidth도 동일한 가정을 이미 쓰고
 * 있고 실사용 범위에서 문제된 적이 없다.
 *
 * 세로쓰기(`vertical: true`): 판정만 studio-vertical-text.ts의 `layoutVerticalText`로 갈아끼운다.
 * 세로쓰기에서 줄바꿈을 결정하는 축은 **세로축(열 길이 ≤ 상자 높이)**이고, 넘칠지 말지는 그렇게
 * 만들어진 **열 수 × 열 간격이 상자 폭 안에 들어오는가**로 판정된다 — 가로쓰기와 폭/높이의
 * 역할이 정확히 뒤바뀐다. 이진 탐색의 단조성 가정은 그대로 성립한다(폰트가 작아질수록 열 길이도
 * 열 간격도 함께 줄어 열 수는 늘지 않고 블록 폭은 단조 비증가). `vertical`이 없으면 기존 경로가
 * 한 글자도 바뀌지 않는다(하위호환).
 */

import { layoutVerticalText, type VerticalBlockAlign } from "../studio-vertical-text";

export interface BubbleTextMeasurer {
  /** text를 (fontPx, fontFamily, fontStyle)로 그렸을 때의 렌더 폭(px). 자간은 포함하지 않는다 —
   *  자간이 필요한 호출부는 `withBubbleLetterSpacing()`으로 감싸서 Konva 와 같은 규약으로 얹는다. */
  measureWidth(text: string, fontPx: number, fontFamily: string, fontStyle: string): number;
}

/** 자동 축소 하한 기본값 — 패널 슬라이더/렌더 통합이 공유한다. */
export const BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT = 10;

// ── 말풍선 타이포그래피 기본값 단일 소스 ─────────────────────────────────────
//
// 2026-08 브라우저 감사에서 "커밋하면 대사가 조용히 잘린다"가 측정됐다. 원인은 **같은 말풍선의
// 줄높이·글꼴 두께 기본값이 경로마다 달랐던 것**이다:
//   · 렌더(StudioKonvaBubbleNode)            → lineHeight 1.25/1.35/1.4, fontStyle "bold"
//   · 커밋 측정(StudioPage.commitEditText)   → lineHeight 1.1,            fontStyle 미지정(normal)
//   · 높이 맞춤(studio-fit.estimateBubbleHeight) → lineHeight 1.2
// 1.1로 잰 블록 높이는 실제(1.35 bold)보다 ~13% 낮게 나와 상자가 작게 잡혔고, Konva.Text 는
// height 가 고정이면 남는 줄을 **경고 없이 버린다**(konva/lib/shapes/Text.js `_setTextData`:
// `if (fixedHeight && currentHeightPx + lineHeightPx > maxHeightPx) break;`). 그래서 대사가 사라졌다.
//
// 아래 상수/리졸버가 그 기본값들의 유일한 소스다. 렌더·측정·맞춤 세 경로 모두 여기만 본다.

export type BubbleWebtoonTheme = "classic" | "soft" | "vivid";

export const BUBBLE_FONT_SIZE_DEFAULT = 24;
export const BUBBLE_FONT_FAMILY_DEFAULT = "Pretendard, sans-serif";
/** 말풍선 기본 글꼴 두께 — 렌더가 `el.fontStyle ?? "bold"`이므로 측정도 반드시 bold 로 재야 한다. */
export const BUBBLE_FONT_STYLE_DEFAULT = "bold";

/** 테마·세로쓰기 조합별 기본 행간(배수). 렌더가 쓰는 값 그대로다. */
export const BUBBLE_LINE_HEIGHT_DEFAULTS = {
  vertical: 1.4,
  classic: 1.25,
  soft: 1.35,
  vivid: 1.2,
} as const;

/**
 * 테마를 모르는 호출부(예: 자동 콘티 조판)가 쓸 안전한 기본 행간 — 위 표의 **최댓값**이다.
 * 과소평가는 글자를 잃지만 과대평가는 상자만 조금 넉넉해질 뿐이라, 모를 때는 큰 쪽이 옳다.
 */
export const BUBBLE_LINE_HEIGHT_FALLBACK = Math.max(
  BUBBLE_LINE_HEIGHT_DEFAULTS.vertical,
  BUBBLE_LINE_HEIGHT_DEFAULTS.classic,
  BUBBLE_LINE_HEIGHT_DEFAULTS.soft,
  BUBBLE_LINE_HEIGHT_DEFAULTS.vivid
);

/** 말풍선 실효 행간 — `el.lineHeight` 우선, 없으면 (세로쓰기 → 테마) 순으로 기본값을 고른다. */
export function resolveBubbleLineHeight(input: {
  lineHeight?: number;
  vertical?: boolean;
  theme?: BubbleWebtoonTheme;
}): number {
  const explicit = input.lineHeight;
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) return explicit;
  if (input.vertical) return BUBBLE_LINE_HEIGHT_DEFAULTS.vertical;
  if (!input.theme) return BUBBLE_LINE_HEIGHT_FALLBACK;
  return BUBBLE_LINE_HEIGHT_DEFAULTS[input.theme];
}

export function resolveBubbleFontSize(fontSize?: number): number {
  return typeof fontSize === "number" && Number.isFinite(fontSize) && fontSize > 0
    ? fontSize
    : BUBBLE_FONT_SIZE_DEFAULT;
}

export function resolveBubbleFontFamily(font?: string): string {
  return font ?? BUBBLE_FONT_FAMILY_DEFAULT;
}

export function resolveBubbleFontStyle(fontStyle?: string): string {
  return fontStyle ?? BUBBLE_FONT_STYLE_DEFAULT;
}

/** 말풍선 자간(px) — 테마에서만 결정된다(요소 필드 없음). 렌더/측정이 공유한다. */
export function bubbleLetterSpacing(theme?: BubbleWebtoonTheme): number {
  return theme === "vivid" ? 0 : 0.3;
}

/** 자동 축소 하한 슬라이더 범위 — 패널 UI가 공유한다. */
export const BUBBLE_AUTO_SHRINK_MIN_FONT_RANGE = { min: 8, max: 24, step: 1 } as const;

/** 이진 탐색 폰트 크기 그리드 간격(px) — 0.5 단위면 표시값이 매끈하다. */
const FONT_SEARCH_STEP = 0.5;

/** 높이 예산에 곱하는 안전 여유 — 근사 워드랩(캔버스 measureText 기반)이 실제 Konva Text 내부
 *  워드랩과 완전히 같은 줄바꿈 지점을 고르지 못할 수 있어(§docstring 단조성 가정 참고), 넘치는
 *  쪽보다 살짝 이르게 줄이는 쪽이 안전하다는 판단으로 6%를 비워둔다. */
const HEIGHT_SAFETY_MARGIN = 0.94;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 말풍선 좌우 패딩(px) — StudioPage.tsx bHPad와 동일 공식(그대로 옮김). */
export function bubbleHorizontalPadding(fontSize: number): number {
  return Math.max(12, Math.round(fontSize * 0.6));
}

/** 말풍선 상/하 패딩(px) — StudioPage.tsx bVPadTop/bVPadBot과 동일 공식(그대로 옮김). */
export function bubbleVerticalPadding(fontSize: number): { top: number; bottom: number } {
  return {
    top: Math.max(8, Math.round(fontSize * 0.48)),
    bottom: Math.max(10, Math.round(fontSize * 0.64)),
  };
}

/** 상/하 패딩 합(px) — "말풍선 전체 높이 ↔ 텍스트 상자 높이" 변환의 단일 소스. */
export function bubbleVerticalPaddingTotal(fontSize: number): number {
  const pad = bubbleVerticalPadding(fontSize);
  return pad.top + pad.bottom;
}

/** 말풍선 전체 폭 → Konva Text 의 width. 렌더·측정·오버레이가 모두 이 함수만 쓴다. */
export function bubbleTextBoxWidth(boxWidth: number, fontSize: number): number {
  return Math.max(8, boxWidth - bubbleHorizontalPadding(fontSize) * 2);
}

/** 말풍선 전체 높이 → Konva Text 의 height. */
export function bubbleTextBoxHeight(boxHeight: number, fontSize: number): number {
  return Math.max(8, boxHeight - bubbleVerticalPaddingTotal(fontSize));
}

/**
 * 자간을 얹은 측정기 래퍼 — Konva.Text `_getTextWidth`와 **같은 규약**이다
 * (`ctx.measureText(t).width + (글자수 - 1) × letterSpacing`). 말풍선은 vivid 외 테마에서
 * 0.3px 자간을 쓰는데, 이걸 빼고 재면 줄당 3px 안팎을 과소평가해 줄 수가 한 줄 모자라게
 * 잡힐 수 있다(= 커밋 후 마지막 줄이 사라진다). letterSpacing 이 0/미지정이면 원본을 그대로
 * 돌려줘 기존 경로는 한 글자도 달라지지 않는다.
 */
export function withBubbleLetterSpacing(
  measurer: BubbleTextMeasurer,
  letterSpacing: number | undefined
): BubbleTextMeasurer {
  if (!letterSpacing) return measurer;
  return {
    measureWidth(text, fontPx, fontFamily, fontStyle) {
      const length = [...text].length;
      const base = measurer.measureWidth(text, fontPx, fontFamily, fontStyle);
      return length > 0 ? base + (length - 1) * letterSpacing : base;
    },
  };
}

// ── 줄바꿈(그리디 워드랩 + 긴 단어 강제 분할) ────────────────────────────────

/**
 * 공백 없이 maxWidth를 넘는 단어를 글자 단위로 강제 분할한다(한글은 글자=완성형 음절이라 이
 * 단위 분할이 시각적으로 자연스럽다 — 자모 분리 입력 등 예외적 인코딩은 다루지 않는다).
 * 반환 배열의 마지막 요소는 "아직 줄이 안 찬 나머지"이므로 호출부가 다음 단어를 이어 붙일 수 있다.
 */
function hardBreakWord(
  word: string,
  maxWidth: number,
  fontPx: number,
  fontFamily: string,
  fontStyle: string,
  measurer: BubbleTextMeasurer
): string[] {
  const out: string[] = [];
  let current = "";
  for (const ch of word) {
    const candidate = current + ch;
    if (current.length > 0 && measurer.measureWidth(candidate, fontPx, fontFamily, fontStyle) > maxWidth) {
      out.push(current);
      current = ch;
    } else {
      current = candidate;
    }
  }
  out.push(current);
  return out;
}

/**
 * 텍스트를 maxWidth 안에 들어오는 줄 배열로 그리디 워드랩한다. 명시적 줄바꿈(\n)은 항상 존중하고,
 * 각 문단 안에서는 공백 단위로 그리디하게 채우다 넘치면 새 줄로 넘긴다. 공백 없이 긴 단어(URL,
 * 의성어 연타 등)는 hardBreakWord로 강제 분할한다. 빈 문단(연속 줄바꿈)은 빈 줄로 보존한다.
 */
export function wrapBubbleTextLines(
  text: string,
  maxWidth: number,
  fontPx: number,
  fontFamily: string,
  fontStyle: string,
  measurer: BubbleTextMeasurer
): string[] {
  const safeMaxWidth = Math.max(1, maxWidth);
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of paragraph.split(" ")) {
      if (word.length === 0) continue; // 연속 공백은 한 칸으로 합쳐진다(Konva 기본 동작과 동일 근사).
      const candidate = current.length === 0 ? word : `${current} ${word}`;
      if (measurer.measureWidth(candidate, fontPx, fontFamily, fontStyle) <= safeMaxWidth) {
        current = candidate;
        continue;
      }
      // 후보가 넘친다 — 현재 줄을 먼저 확정.
      if (current.length > 0) lines.push(current);
      // 단어 하나만으로도 넘치면 글자 단위 강제 분할.
      if (measurer.measureWidth(word, fontPx, fontFamily, fontStyle) > safeMaxWidth) {
        const broken = hardBreakWord(word, safeMaxWidth, fontPx, fontFamily, fontStyle, measurer);
        lines.push(...broken.slice(0, -1));
        current = broken[broken.length - 1] ?? "";
      } else {
        current = word;
      }
    }
    lines.push(current);
  }
  return lines;
}

// ── 폰트 크기 이진 탐색 ──────────────────────────────────────────────────────

export interface BubbleFontFitInput {
  text: string;
  /** 말풍선 전체 폭(px, 패딩 포함) — el.width 그대로. */
  boxWidth: number;
  /** 말풍선 전체 높이(px, 패딩 포함) — el.height 그대로. */
  boxHeight: number;
  /** 탐색 상한(사용자가 지정한 "기준" 폰트 크기) — 텍스트가 짧으면 그대로 반환된다. */
  maxFontSize: number;
  /** 탐색 하한. 미지정 시 BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT(10). */
  minFontSize?: number;
  fontFamily: string;
  fontStyle?: string;
  /**
   * 행간 배수 — **필수**(선택값이 아니다). 반드시 `resolveBubbleLineHeight()` 결과를 넘긴다
   * (이 모듈이 그 기본값의 유일한 소스다 — 위 "말풍선 타이포그래피 기본값 단일 소스" 참고).
   * 이 모듈은 고정 기본값을 두지 않는다: 예전 호출부들이 각자 `?? 1.1`, `?? 1.2`로 조용히
   * 폴백했고, 둘 다 실제로 가능한 어떤 테마/세로 조합(1.2~1.4)보다도 작아 텍스트 블록 높이를
   * 항상 과소평가했다(최대 ~27% 오차) — 커밋 시 대사가 잘리고, "크기 고정"에서는 폰트를
   * 충분히 줄이지 못하는 회귀로 이어졌다.
   */
  lineHeight: number;
  /**
   * 세로쓰기 조판으로 판정할지 여부. 미설정/false면 이 모듈의 기존 가로쓰기 경로가 그대로
   * 쓰인다(하위호환 — 한 글자도 달라지지 않는다). true면 studio-vertical-text.ts의
   * `layoutVerticalText`가 세로축으로 열을 끊고, 그 결과 블록 폭이 상자 폭에 맞는지로 판정한다.
   * 이때 `text`에는 **원문 그대로** 넘겨야 한다(레거시 `formatVerticalText` 전치 문자열이 아니라).
   */
  vertical?: boolean;
  /**
   * 자간(px). 세로쓰기에서는 글자 사이 **세로** 간격, 가로쓰기에서는 Konva.Text 와 같은 규약의
   * 가로 간격(`(글자수-1) × letterSpacing`)으로 줄바꿈 측정에 반영된다. 미지정/0이면 예전과
   * 동일하게 무시된다(하위호환).
   */
  letterSpacing?: number;
  /** 세로쓰기 전용 — 열 안 정렬(가로쓰기 align의 세로축 대응). 판정 결과에는 영향이 없다. */
  blockAlign?: VerticalBlockAlign;
}

export interface BubbleFontFitResult {
  /** 선택된 폰트 크기(px) — [minFontSize, maxFontSize] 안, FONT_SEARCH_STEP 그리드에 스냅. */
  fontSize: number;
  /**
   * 참고/디버그용 — 가로쓰기는 워드랩 줄 배열(실제 캔버스 렌더는 Konva Text 자체 워드랩에
   * 맡기므로 약간 다를 수 있다), 세로쓰기는 **열 배열**(오른쪽 열부터, 각 열의 글자를 이어붙인 것).
   */
  lines: string[];
  /** minFontSize에서도 못 맞으면 true — 호출부가 경고 표시를 보여줄 수 있다. */
  overflow: boolean;
}

/** fontSize 하나가 박스 안에 들어가는지 판정 — 패딩은 그 fontSize 자체 기준(모듈 상단 docstring). */
function fitsAtFontSize(
  input: Pick<
    BubbleFontFitInput,
    | "text"
    | "boxWidth"
    | "boxHeight"
    | "fontFamily"
    | "fontStyle"
    | "lineHeight"
    | "vertical"
    | "letterSpacing"
    | "blockAlign"
  >,
  fontSize: number,
  measurer: BubbleTextMeasurer
): { ok: boolean; lines: string[] } {
  const fontStyle = resolveBubbleFontStyle(input.fontStyle);
  const lineHeight = input.lineHeight;
  const availW = bubbleTextBoxWidth(input.boxWidth, fontSize);
  const availH = bubbleTextBoxHeight(input.boxHeight, fontSize) * HEIGHT_SAFETY_MARGIN;
  if (input.vertical) {
    // 세로쓰기 — 열은 세로축(availH)으로 끊고, 그렇게 나온 블록 폭이 availW 안이면 맞는 것이다.
    const layout = layoutVerticalText(
      {
        text: input.text || " ",
        fontSize,
        lineHeight,
        letterSpacing: input.letterSpacing,
        fontFamily: input.fontFamily,
        fontStyle,
        maxColumnLength: availH,
        blockAlign: input.blockAlign,
      },
      measurer
    );
    const columns = layout.columns.map((column) => column.items.map((item) => item.text.split("\n").join("")).join(""));
    return { ok: !layout.overflow && layout.width <= availW, lines: columns };
  }
  const lines = wrapBubbleTextLines(
    input.text || " ",
    availW,
    fontSize,
    input.fontFamily,
    fontStyle,
    withBubbleLetterSpacing(measurer, input.letterSpacing)
  );
  const blockHeight = lines.length * fontSize * lineHeight;
  return { ok: blockHeight <= availH, lines };
}

/**
 * "이 폰트 크기로 이 상자에 대사가 다 들어가는가" — 자동 축소 탐색이 쓰는 판정을 그대로 공개한다.
 * 높이 자동 확장(fitBubbleBoxHeightToText)이 **같은 판정**을 쓰게 해서, 두 기능이 서로 다른
 * 기준으로 상자를 잡는 일이 구조적으로 불가능하게 만든다.
 */
export function bubbleTextFitsInBox(
  input: Pick<
    BubbleFontFitInput,
    | "text"
    | "boxWidth"
    | "boxHeight"
    | "fontFamily"
    | "fontStyle"
    | "lineHeight"
    | "vertical"
    | "letterSpacing"
    | "blockAlign"
  >,
  fontSize: number,
  measurer: BubbleTextMeasurer = createCanvasBubbleTextMeasurer()
): boolean {
  return fitsAtFontSize(input, fontSize, measurer).ok;
}

/**
 * 고정된 (boxWidth, boxHeight) 안에 text가 들어가는 가장 큰 폰트 크기를 이진 탐색으로 찾는다.
 * maxFontSize에서 이미 맞으면 탐색 없이 그대로 반환한다. minFontSize에서도 못 맞으면 minFontSize를
 * 돌려주며 overflow:true로 표시한다(그 이상 줄이지 않는다 — Canva/Figma와 동일하게 하한을 존중).
 */
export function fitBubbleFontSize(
  input: BubbleFontFitInput,
  measurer: BubbleTextMeasurer = createCanvasBubbleTextMeasurer()
): BubbleFontFitResult {
  const minFontSize = Math.max(1, input.minFontSize ?? BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT);
  const maxFontSize = Math.max(minFontSize, input.maxFontSize);

  const atMax = fitsAtFontSize(input, maxFontSize, measurer);
  if (atMax.ok || maxFontSize <= minFontSize) {
    return { fontSize: round1(maxFontSize), lines: atMax.lines, overflow: !atMax.ok };
  }

  // 내림차순 그리드: sizes[0]≈maxFontSize 다음 스텝, sizes[last]=minFontSize.
  const sizes: number[] = [];
  for (let s = maxFontSize - FONT_SEARCH_STEP; s > minFontSize; s -= FONT_SEARCH_STEP) sizes.push(round1(s));
  sizes.push(round1(minFontSize));

  const atMin = fitsAtFontSize(input, sizes[sizes.length - 1]!, measurer);
  if (!atMin.ok) {
    return { fontSize: sizes[sizes.length - 1]!, lines: atMin.lines, overflow: true };
  }

  // "처음으로 맞는(ok===true) 지점"을 찾는 표준 경계 이진 탐색 — sizes는 내림차순이라 인덱스가
  // 커질수록(폰트가 작아질수록) ok가 될 가능성이 단조 증가한다(모듈 docstring의 단조성 가정).
  let lo = 0;
  let hi = sizes.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fitsAtFontSize(input, sizes[mid]!, measurer).ok) hi = mid;
    else lo = mid + 1;
  }
  const chosen = sizes[lo]!;
  return { fontSize: chosen, lines: fitsAtFontSize(input, chosen, measurer).lines, overflow: false };
}

// ── 높이 자동 확장(기본 모드) ────────────────────────────────────────────────

export interface BubbleTextBlockInput {
  text: string;
  /** 말풍선 **전체** 폭(px, 패딩 포함) — el.width 그대로. */
  boxWidth: number;
  fontSize: number;
  fontFamily: string;
  fontStyle?: string;
  /** 반드시 resolveBubbleLineHeight() 결과를 넘긴다(경로별 기본값 불일치가 이 결함의 원인이었다). */
  lineHeight: number;
  letterSpacing?: number;
}

export interface BubbleTextBlockMeasurement {
  /** 그리디 워드랩 결과 줄 배열(Konva.Text 내부 워드랩의 근사 — 모듈 상단 docstring 참고). */
  lines: string[];
  /** 줄 수 × fontSize × lineHeight — Konva.Text 가 쓰는 블록 높이 공식 그대로. */
  blockHeight: number;
  /** 이 폰트 크기에서의 Konva.Text width. */
  textBoxWidth: number;
}

/** 가로쓰기 말풍선 텍스트 블록의 줄 수/높이 측정 — 렌더가 쓸 값과 같은 공식. */
export function measureBubbleTextBlock(
  input: BubbleTextBlockInput,
  measurer: BubbleTextMeasurer = createCanvasBubbleTextMeasurer()
): BubbleTextBlockMeasurement {
  const textBoxWidth = bubbleTextBoxWidth(input.boxWidth, input.fontSize);
  const lines = wrapBubbleTextLines(
    input.text || " ",
    textBoxWidth,
    input.fontSize,
    input.fontFamily,
    resolveBubbleFontStyle(input.fontStyle),
    withBubbleLetterSpacing(measurer, input.letterSpacing)
  );
  return {
    lines,
    blockHeight: lines.length * input.fontSize * input.lineHeight,
    textBoxWidth,
  };
}

export interface BubbleBoxHeightFitInput extends BubbleTextBlockInput {
  /** 세로쓰기 말풍선이면 true — 높이를 늘리면 열이 길어져 열 수(=블록 폭)가 줄어든다. */
  vertical?: boolean;
  blockAlign?: VerticalBlockAlign;
  /** 결과의 하한(px). 보통 el.height 를 넘겨 "수동으로 키운 크기는 보존"한다. */
  minHeight?: number;
}

/** 세로쓰기 높이 탐색 상한 — 열 하나에 전체 대사가 다 들어가고도 남는 길이. */
function verticalHeightSearchCeiling(input: BubbleBoxHeightFitInput): number {
  const glyphs = [...input.text].length + 1;
  return (
    glyphs * (input.fontSize + Math.abs(input.letterSpacing ?? 0))
    + bubbleVerticalPaddingTotal(input.fontSize)
  );
}

/**
 * 대사가 **한 글자도 잘리지 않는** 말풍선 전체 높이(px, 패딩 포함)를 돌려준다.
 *
 * 판정은 자동 축소(fitBubbleFontSize)와 **완전히 같은** `bubbleTextFitsInBox`를 쓴다 — 두 기능이
 * 서로 다른 여유(HEIGHT_SAFETY_MARGIN)나 다른 패딩을 가정하면 한쪽이 "맞다"고 한 상자를 다른
 * 쪽이 "넘친다"고 보는 모순이 생긴다. 가로쓰기는 줄 수에서 곧바로 닫힌 해가 나오고, 세로쓰기는
 * 높이↑ → 열 길이↑ → 열 수↓ → 블록 폭↓ 이 단조라 이진 탐색으로 최소 높이를 찾는다.
 */
export function fitBubbleBoxHeightToText(
  input: BubbleBoxHeightFitInput,
  measurer: BubbleTextMeasurer = createCanvasBubbleTextMeasurer()
): number {
  const padding = bubbleVerticalPaddingTotal(input.fontSize);
  const floor = Math.max(
    input.minHeight ?? 0,
    Math.ceil(input.fontSize * input.lineHeight / HEIGHT_SAFETY_MARGIN) + padding
  );
  if (!input.vertical) {
    const { blockHeight } = measureBubbleTextBlock(input, measurer);
    return Math.max(floor, Math.ceil(blockHeight / HEIGHT_SAFETY_MARGIN) + padding);
  }
  const fits = (boxHeight: number) =>
    bubbleTextFitsInBox({ ...input, boxHeight }, input.fontSize, measurer);
  let hi = Math.max(floor, Math.ceil(verticalHeightSearchCeiling(input)));
  if (!fits(hi)) return hi; // 폭이 한 열도 못 담는 병적 입력 — 더 키워도 소용없다.
  let lo = floor;
  if (fits(lo)) return lo;
  // [lo, hi] 경계 이진 탐색 — lo는 안 맞고 hi는 맞는다는 불변식을 유지한다.
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

// ── 실제 런타임 측정기(Canvas 2D) ────────────────────────────────────────────

let sharedMeasureCanvas: HTMLCanvasElement | null = null;
let sharedMeasureCtx: CanvasRenderingContext2D | null = null;

/**
 * 실제 화면용 측정기 — 재사용 가능한 오프스크린 <canvas> 하나로 ctx.measureText를 호출한다
 * (Konva.Text 내부도 결국 캔버스 measureText로 귀결되므로 여기 결과와 실제 렌더 폭은 사실상
 * 일치한다 — letterSpacing은 반영하지 않는다). SSR/캔버스 미지원 환경(document 없음)에서는
 * "글자당 fontPx*0.55px" 근사로 방어적으로 폴백한다.
 */
export function createCanvasBubbleTextMeasurer(): BubbleTextMeasurer {
  return {
    measureWidth(text, fontPx, fontFamily, fontStyle) {
      if (typeof document === "undefined") return text.length * fontPx * 0.55;
      if (!sharedMeasureCanvas) {
        sharedMeasureCanvas = document.createElement("canvas");
        sharedMeasureCtx = sharedMeasureCanvas.getContext("2d");
      }
      const ctx = sharedMeasureCtx;
      if (!ctx) return text.length * fontPx * 0.55;
      ctx.font = `${fontStyle} ${fontPx}px ${fontFamily}`;
      return ctx.measureText(text).width;
    },
  };
}
