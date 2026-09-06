/**
 * Studio Bubble Auto-Shrink Panel
 * 말풍선 "크기 고정" 컨트롤 — 켜면 텍스트가 넘칠 때 (기존 기본 동작인) 높이 자동 확장 대신
 * 폰트 크기를 studio-bubble-text-fit.ts의 이진 탐색으로 줄여 고정된 박스 안에 맞춘다
 * (Canva/Figma의 "autosize: shrink text on overflow"와 동일한 패턴).
 *
 * 상태 없는 순수 프레젠테이션 — 실제 폰트 크기 계산(fitBubbleFontSize)과 렌더 반영은
 * StudioPage.tsx가 담당하고, 이 패널은 계산된 결과(effectiveFontSize/overflow)를 그대로
 * 표시만 한다.
 */
import { PANEL_LABEL_ROW, StudioSliderRow } from "../studio-panel-ui";

import { BUBBLE_AUTO_SHRINK_MIN_FONT_RANGE } from "./studio-bubble-text-fit";

import type { ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

export type StudioBubbleAutoShrinkPanelProps = {
  /** selected.autoShrinkText — 켜져 있으면 높이 자동 확장 대신 폰트 축소 모드. */
  enabled: boolean;
  /** selected.autoShrinkMinFontSize ?? BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT — 축소 하한(px). */
  minFontSize: number;
  /** fitBubbleFontSize(...).fontSize — enabled가 false면 null(계산 자체를 하지 않는다). */
  effectiveFontSize: number | null;
  /** fitBubbleFontSize(...).overflow — minFontSize에서도 못 맞으면 true. */
  overflow: boolean;
  onToggleEnabled: (next: boolean) => void;
  onMinFontSizeChange: (next: number) => void;
};

export function StudioBubbleAutoShrinkPanel({
  enabled,
  minFontSize,
  effectiveFontSize,
  overflow,
  onToggleEnabled,
  onMinFontSizeChange,
}: StudioBubbleAutoShrinkPanelProps): ReactElement {
  return (
    <div className="mt-2.5 border-t border-line/40 pt-2.5 space-y-2.5">
      <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">텍스트 크기 고정</p>

      <label className={PANEL_LABEL_ROW}>
        크기 고정(넘치면 글자 축소)
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggleEnabled(e.target.checked)}
          className="size-4 accent-accent cursor-pointer"
        />
      </label>

      {enabled && (
        <>
          <StudioSliderRow
            label="최소 글자 크기"
            min={BUBBLE_AUTO_SHRINK_MIN_FONT_RANGE.min}
            max={BUBBLE_AUTO_SHRINK_MIN_FONT_RANGE.max}
            step={BUBBLE_AUTO_SHRINK_MIN_FONT_RANGE.step}
            value={minFontSize}
            onChange={onMinFontSizeChange}
            readout={`${minFontSize}px`}
          />

          <p
            className={cn("text-[0.7rem] leading-relaxed", overflow ? "text-bad" : "text-fg-3")}
            role="status"
          >
            {overflow
              ? `⚠️ 최소 크기(${minFontSize}px)에서도 텍스트가 넘쳐요 — 말풍선을 키우거나 대사를 줄여보세요.`
              : effectiveFontSize != null
                ? `지금 ${effectiveFontSize}px로 자동 축소되어 표시 중이에요.`
                : "말풍선 크기는 고정되고, 텍스트가 넘치면 글자 크기가 자동으로 줄어요."}
          </p>
        </>
      )}
    </div>
  );
}
