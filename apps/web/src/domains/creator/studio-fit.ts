/**
 * Studio Fit — 요소를 패널에 채우거나 말풍선을 텍스트에 맞추는 순수 기하 헬퍼.
 *
 * 웹툰 작업에서 잦은 두 동작의 수동 리사이즈를 한 번에 끝낸다.
 * - 패널 채우기: 캐릭터/배경 이미지를 컷(프레임)에 꽉 채우거나(cover) 안에 맞춘다(contain).
 * - 말풍선 맞춤: 대사 길이에 맞춰 말풍선 높이를 자동 산정한다.
 *
 * 전부 순수·결정적. DOM/Konva 의존 없음 — StudioPage가 결과 박스로 patchEl 한다.
 * (말풍선 높이만 예외적으로 글자 폭을 알아야 해서 studio-bubble-text-fit 의 측정기 포트를 쓴다.
 *  기본 측정기는 오프스크린 캔버스이고, 캔버스가 없는 환경에서는 알아서 근사로 폴백한다.)
 */

import {
  BUBBLE_LINE_HEIGHT_FALLBACK,
  BUBBLE_FONT_FAMILY_DEFAULT,
  BUBBLE_FONT_STYLE_DEFAULT,
  createCanvasBubbleTextMeasurer,
  fitBubbleBoxHeightToText,
  type BubbleTextMeasurer,
} from "./lettering/studio-bubble-text-fit";

export interface FitBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Sized {
  width: number;
  height: number;
}

/**
 * 요소를 프레임에 "꽉 채우기"(cover) — 비율을 유지한 채 프레임을 덮는다(넘치는 부분은
 * 패널 클립이 가린다). 중앙 정렬한 박스를 돌려준다.
 */
export function coverFitInFrame(el: Sized, frame: FitBox): FitBox {
  if (el.width <= 0 || el.height <= 0) return { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
  const ratio = Math.max(frame.width / el.width, frame.height / el.height);
  const w = Math.round(el.width * ratio);
  const h = Math.round(el.height * ratio);
  return {
    x: Math.round(frame.x + (frame.width - w) / 2),
    y: Math.round(frame.y + (frame.height - h) / 2),
    width: w,
    height: h,
  };
}

/**
 * 요소를 프레임 "안에 맞추기"(contain) — 비율을 유지하며 잘리지 않게 안에 들어간다. 여백(padding) 가능.
 */
export function containFitInFrame(el: Sized, frame: FitBox, padding = 0): FitBox {
  const fw = Math.max(1, frame.width - padding * 2);
  const fh = Math.max(1, frame.height - padding * 2);
  if (el.width <= 0 || el.height <= 0) return { x: frame.x + padding, y: frame.y + padding, width: fw, height: fh };
  const ratio = Math.min(fw / el.width, fh / el.height);
  const w = Math.round(el.width * ratio);
  const h = Math.round(el.height * ratio);
  return {
    x: Math.round(frame.x + (frame.width - w) / 2),
    y: Math.round(frame.y + (frame.height - h) / 2),
    width: w,
    height: h,
  };
}

export interface EstimateBubbleHeightOptions {
  fontFamily?: string;
  fontStyle?: string;
  letterSpacing?: number;
  vertical?: boolean;
  /** 테스트/결정적 계산용 주입. 미지정 시 오프스크린 캔버스 실측. */
  measurer?: BubbleTextMeasurer;
}

/**
 * 말풍선 텍스트가 들어갈 **말풍선 전체 높이**(패딩 포함) 추정.
 *
 * 2026-08 감사 전에는 `charsPerLine = usableWidth / (fontSize * 0.62)` 라는 글자 수 추정이었다.
 * 0.62는 라틴 문자의 평균 폭 비율인데 한글 완성형은 전각(≈1.0em)이라 **한 줄에 1.6배 많이
 * 들어간다고 계산**했고, 그래서 "높이를 텍스트에 맞춤" 버튼이 상자를 오히려 줄여 글자를 더
 * 잘라먹었다(측정: 클릭 전 8자 소실 → 클릭 후 22자 소실, 265px → 210px). 지금은 글자 수 추정
 * 대신 실측 측정기로 실제 줄바꿈을 재고, 패딩·행간·글꼴 두께 기본값은 전부
 * studio-bubble-text-fit 의 단일 소스를 쓴다(렌더가 쓰는 값과 정확히 같다).
 *
 * `lineHeight`를 생략하면 테마를 모를 때의 안전값(BUBBLE_LINE_HEIGHT_FALLBACK = 최댓값)을 쓴다 —
 * 과소평가는 글자를 잃고 과대평가는 상자만 넉넉해지므로, 모를 때는 큰 쪽이 옳다. 실제 렌더
 * 테마를 아는 호출부(StudioPage)는 resolveBubbleLineHeight() 결과를 넘겨 정확히 맞춘다.
 */
export function estimateBubbleHeight(
  text: string,
  width: number,
  fontSize: number,
  lineHeight: number = BUBBLE_LINE_HEIGHT_FALLBACK,
  options: EstimateBubbleHeightOptions = {}
): number {
  return fitBubbleBoxHeightToText(
    {
      text,
      boxWidth: width,
      fontSize,
      fontFamily: options.fontFamily ?? BUBBLE_FONT_FAMILY_DEFAULT,
      fontStyle: options.fontStyle ?? BUBBLE_FONT_STYLE_DEFAULT,
      lineHeight,
      letterSpacing: options.letterSpacing,
      vertical: options.vertical,
    },
    options.measurer ?? createCanvasBubbleTextMeasurer()
  );
}
