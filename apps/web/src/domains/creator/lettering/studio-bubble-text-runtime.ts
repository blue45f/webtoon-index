import { layoutVerticalText, verticalBlockAlign, verticalTextItemGeometry } from "../studio-vertical-text";

import {
  BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT,
  createCanvasBubbleTextMeasurer,
  fitBubbleFontSize,
} from "./studio-bubble-text-fit";

import type { BubbleEl } from "../studio-element-model";
import type {
  VerticalBlockAlign,
  VerticalTextItem,
  VerticalTextLayout,
  VerticalTextLayoutInput,
} from "../studio-vertical-text";

export type { VerticalBlockAlign, VerticalTextItem, VerticalTextLayout };
// 렌더러(Konva/SVG)가 같은 지오메트리 규약을 공유하도록 코어의 순수 헬퍼를 그대로 다시 내보낸다.
export { verticalBlockAlign, verticalTextItemGeometry };

// 말풍선 자동 축소(studio-bubble-text-fit) 실측 캔버스 측정기 — 모듈 스코프에 1회만 생성한다
// (내부 공유 <canvas>를 감싸는 얇은 래퍼라 element/렌더별로 새로 만들 이유가 없다).
export const BUBBLE_TEXT_MEASURER = createCanvasBubbleTextMeasurer();

/**
 * 세로쓰기 레이아웃 — 공유 캔버스 측정기를 묶은 렌더 경로용 얇은 래퍼.
 * 코어는 studio-vertical-text.ts(순수·DOM 무의존)에 있고, 여기서는 측정기만 주입한다.
 */
export function verticalTextLayout(input: VerticalTextLayoutInput): VerticalTextLayout {
  return layoutVerticalText(input, BUBBLE_TEXT_MEASURER);
}

/**
 * 레거시 세로쓰기 근사 — 가로 문자열을 전치해 가로 렌더러에 먹인다(열 우→좌, 빈 칸은 전각 공백).
 *
 * @deprecated 새 코드는 `verticalTextLayout`(studio-vertical-text.ts 코어)을 쓴다. 이 함수는
 * 아직 이 근사에 묶여 있는 렌더 경로(StudioKonvaBubbleNode / SVG 내보내기의 말풍선 텍스트)가
 * 캔버스·내보내기 사이에서 **서로 같은 결과**를 내도록 유지하는 호환 셈법이다 — 그 두 곳이 새
 * 코어로 넘어가는 순간 함께 삭제한다.
 */
export function formatVerticalText(text: string): string {
  const lines = text.split("\n");
  const maxLen = Math.max(...lines.map((line) => line.length));
  const resultLines: string[] = [];
  for (let charIdx = 0; charIdx < maxLen; charIdx++) {
    const rowChars: string[] = [];
    for (let lineIdx = lines.length - 1; lineIdx >= 0; lineIdx--) {
      const char = lines[lineIdx]?.[charIdx] ?? "　";
      rowChars.push(char);
    }
    resultLines.push(rowChars.join("  "));
  }
  return resultLines.join("\n");
}

// 말풍선 "크기 고정" 미리보기 — 인스펙터가 StudioBubbleAutoShrinkPanel에 넘길 계산된 폰트 크기/
// 오버플로 여부. autoShrinkText가 꺼져 있으면 계산 자체를 하지 않는다(null).
//
// lineHeight를 인자로 받는 이유: webtoonTheme(컴포넌트 useState)에 접근할 수 없는 공유 모듈이므로
// 실제 렌더가 쓰는 bubbleLineHeight와 정확히 같은 값을 호출부가 계산해 넘겨야 한다.
export function bubbleAutoShrinkPreview(
  el: BubbleEl,
  lineHeight: number
): { fontSize: number; overflow: boolean } | null {
  if (!el.autoShrinkText) return null;
  return fitBubbleFontSize(
    {
      text: el.vertical ? formatVerticalText(el.text) : el.text,
      boxWidth: el.width,
      boxHeight: el.height,
      maxFontSize: el.fontSize ?? 24,
      minFontSize: el.autoShrinkMinFontSize ?? BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT,
      fontFamily: el.font ?? "Pretendard, sans-serif",
      fontStyle: el.fontStyle ?? "bold",
      lineHeight,
    },
    BUBBLE_TEXT_MEASURER
  );
}
