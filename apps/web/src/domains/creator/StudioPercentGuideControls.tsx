import { useId, useState } from "react";

import { CANVAS_W } from "./studio-assets";
import {
  parseStudioGuidePercent,
  STUDIO_GUIDE_PERCENT_PRESETS,
  studioGuidePercentToPx,
} from "./studio-guide-percent";

import { cn } from "@/shared/lib/utils";

export interface StudioPercentGuideControlsProps {
  readonly canvasHeight: number;
  readonly disabled: boolean;
  readonly onAddGuide: (type: "v" | "h", position: number) => void;
}

/**
 * Photoshop-class numeric guide placement without changing Studio's persisted px guide model.
 * Native radios keep arrow-key navigation, while every pointer target remains at least 44px.
 */
export function StudioPercentGuideControls({
  canvasHeight,
  disabled,
  onAddGuide,
}: StudioPercentGuideControlsProps) {
  const helpId = useId();
  const [guideType, setGuideType] = useState<"v" | "h">("v");
  const [input, setInput] = useState("50");
  const parsedPercent = parseStudioGuidePercent(input);
  const dimension = guideType === "v" ? CANVAS_W : canvasHeight;
  const directPosition = studioGuidePercentToPx(input, dimension);

  function addGuide(type: "v" | "h", percent: string | number) {
    const targetDimension = type === "v" ? CANVAS_W : canvasHeight;
    const position = studioGuidePercentToPx(percent, targetDimension);
    if (position === null || disabled) return;
    onAddGuide(type, position);
  }

  return (
    <fieldset
      disabled={disabled}
      className="space-y-2 rounded-lg border border-line bg-card/30 p-2.5 disabled:opacity-50"
    >
      <legend className="px-1 text-[0.65rem] font-bold text-fg-2">
        퍼센트로 가이드 추가
      </legend>
      <p id={helpId} className="text-[0.62rem] leading-relaxed text-fg-3">
        세로 가이드는 캔버스 너비, 가로 가이드는 캔버스 높이를 기준으로 즉시 px 위치로
        변환합니다. 0보다 크고 100보다 작은 값을 입력하세요.
      </p>
      <div
        role="radiogroup"
        aria-label="퍼센트 가이드 방향"
        className="grid grid-cols-2 gap-1 rounded-md bg-panel/60 p-1"
      >
        {(["v", "h"] as const).map((type) => (
          <label
            key={type}
            className={cn(
              "relative grid min-h-11 cursor-pointer place-items-center rounded-md px-2 text-center text-[0.68rem] font-semibold transition-colors",
              guideType === type
                ? "bg-accent text-on-accent"
                : "text-fg-2 hover:bg-raised",
              disabled && "cursor-not-allowed",
            )}
          >
            <input
              type="radio"
              name={`${helpId}-direction`}
              value={type}
              checked={guideType === type}
              disabled={disabled}
              onChange={() => setGuideType(type)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-md peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
            />
            <span>
              {type === "v" ? "세로 · 너비 기준" : "가로 · 높이 기준"}
            </span>
          </label>
        ))}
      </div>
      <div
        role="group"
        aria-label={`${guideType === "v" ? "세로" : "가로"} 가이드 퍼센트 프리셋`}
        className="grid grid-cols-5 gap-1"
      >
        {STUDIO_GUIDE_PERCENT_PRESETS.map((percent) => (
          <button
            key={percent}
            type="button"
            aria-label={`${guideType === "v" ? "세로" : "가로"} 가이드 ${percent}% 추가`}
            disabled={disabled}
            onClick={() => addGuide(guideType, percent)}
            className="min-h-11 rounded-md border border-line bg-card px-1 text-[0.62rem] font-semibold tabular-nums text-fg-2 transition-colors hover:border-accent/50 hover:bg-raised hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {percent}%
          </button>
        ))}
      </div>
      <form
        className="flex items-end gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          addGuide(guideType, input);
        }}
      >
        <label className="min-w-0 flex-1 text-[0.62rem] font-semibold text-fg-2">
          직접 입력
          <span className="mt-1 flex min-h-11 items-center rounded-md border border-line bg-card px-2 focus-within:border-accent">
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={input}
              aria-describedby={helpId}
              aria-invalid={input.length > 0 && parsedPercent === null}
              disabled={disabled}
              onChange={(event) => setInput(event.currentTarget.value)}
              className="min-w-0 flex-1 bg-transparent text-sm tabular-nums text-fg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
            <span aria-hidden className="text-xs text-fg-3">%</span>
          </span>
        </label>
        <button
          type="submit"
          disabled={disabled || directPosition === null}
          className="min-h-11 shrink-0 rounded-md bg-accent px-3 text-[0.68rem] font-bold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          추가
        </button>
      </form>
      {input.length > 0 && parsedPercent === null ? (
        <p role="alert" className="text-[0.62rem] leading-relaxed text-bad">
          0보다 크고 100보다 작은 퍼센트를 입력해 주세요.
        </p>
      ) : directPosition !== null ? (
        <p role="status" className="text-[0.62rem] tabular-nums text-fg-3">
          {parsedPercent}% → {Math.round(directPosition)}px
        </p>
      ) : null}
    </fieldset>
  );
}
