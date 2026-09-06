import { Link2, Unlink2 } from "lucide-react";

import type { StudioSelectionResizeAnchor } from "./studio-selection-transform-advanced";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

const RESIZE_ANCHOR_OPTIONS: readonly {
  readonly value: StudioSelectionResizeAnchor;
  readonly label: string;
}[] = [
  { value: "top-left", label: "↖ 왼쪽 위" },
  { value: "top-center", label: "↑ 위" },
  { value: "top-right", label: "↗ 오른쪽 위" },
  { value: "middle-left", label: "← 왼쪽" },
  { value: "center", label: "• 가운데" },
  { value: "middle-right", label: "→ 오른쪽" },
  { value: "bottom-left", label: "↙ 왼쪽 아래" },
  { value: "bottom-center", label: "↓ 아래" },
  { value: "bottom-right", label: "↘ 오른쪽 아래" },
];

export interface StudioTransformPrecisionControlsProps {
  readonly disabled: boolean;
  readonly interactionDisabledReason: string | null;
  readonly supportsWidth: boolean;
  readonly supportsHeight: boolean;
  readonly sizeDisabledReason?: string | null;
  readonly resizeAnchor: StudioSelectionResizeAnchor;
  readonly onResizeAnchorChange: (anchor: StudioSelectionResizeAnchor) => void;
  readonly showAspectLockControl: boolean;
  readonly aspectLocked: boolean;
  readonly multi: boolean;
  readonly supportsAspectLock: boolean;
  readonly onToggleAspectLock: () => void;
  readonly showStrokeWidthControl: boolean;
  readonly scaleStrokeWidth: boolean;
  readonly onToggleStrokeWidth: () => void;
}

export function StudioTransformPrecisionControls({
  disabled,
  interactionDisabledReason,
  supportsWidth,
  supportsHeight,
  sizeDisabledReason,
  resizeAnchor,
  onResizeAnchorChange,
  showAspectLockControl,
  aspectLocked,
  multi,
  supportsAspectLock,
  onToggleAspectLock,
  showStrokeWidthControl,
  scaleStrokeWidth,
  onToggleStrokeWidth,
}: StudioTransformPrecisionControlsProps) {
  return (
    <div className="mb-2 flex items-end gap-1.5">
      <label className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-xs font-bold tracking-tight text-fg-3">크기 기준점</span>
        <select
          value={resizeAnchor}
          disabled={disabled || (!supportsWidth && !supportsHeight)}
          title={
            interactionDisabledReason
            ?? ((!supportsWidth && !supportsHeight)
              ? sizeDisabledReason ?? "이 선택은 수치 크기 조절을 지원하지 않아요."
              : "W/H 입력 시 고정할 기준점")
          }
          aria-label="크기 조절 기준점"
          data-inspector-control-id="selection.resize-anchor"
          data-inspector-priority="advanced"
          onChange={(event) => onResizeAnchorChange(event.currentTarget.value as StudioSelectionResizeAnchor)}
          className="h-9 min-w-0 rounded-lg border border-line bg-card px-2 text-[0.75rem] font-semibold text-fg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 pointer-coarse:h-11"
        >
          {RESIZE_ANCHOR_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      {showAspectLockControl ? (
        <button
          type="button"
          aria-pressed={aspectLocked}
          aria-label={aspectLocked ? "가로세로 비율 잠금 해제" : "가로세로 비율 잠금"}
          disabled={disabled || multi || !supportsAspectLock}
          title={
            disabled
              ? interactionDisabledReason ?? "현재 편집 상태에서는 비율 잠금을 바꿀 수 없어요."
              : multi
                ? "여러 개 선택은 배치를 보존하도록 항상 같은 비율로 크기를 조절합니다."
                : supportsAspectLock
                  ? aspectLocked ? "가로세로 비율 잠금 해제" : "가로세로 비율 잠금"
                  : "이 요소는 가로세로 크기를 함께 저장하지 않아요."
          }
          data-inspector-control-id="selection.lock-aspect"
          data-inspector-priority="advanced"
          onClick={onToggleAspectLock}
          className={buttonClass({
            size: "sm",
            variant: "quiet",
            className: cn("size-9 gap-0 px-0 pointer-coarse:size-11", aspectLocked && "bg-accent-soft/60 text-accent"),
          })}
        >
          {aspectLocked ? <Link2 size={14} aria-hidden /> : <Unlink2 size={14} aria-hidden />}
        </button>
      ) : null}
      {showStrokeWidthControl ? (
        <button
          type="button"
          aria-pressed={scaleStrokeWidth}
          aria-label="선 굵기도 함께 확대"
          disabled={disabled}
          title={
            interactionDisabledReason
            ?? (scaleStrokeWidth ? "선 굵기를 크기와 함께 확대합니다" : "선 굵기는 유지하고 배치와 크기만 바꿉니다")
          }
          data-inspector-control-id="selection.scale-stroke-width"
          data-inspector-priority="advanced"
          onClick={onToggleStrokeWidth}
          className={buttonClass({
            size: "sm",
            variant: "quiet",
            className: cn("h-9 min-w-9 px-2 text-[0.6875rem] pointer-coarse:h-11", scaleStrokeWidth && "bg-accent-soft/60 text-accent"),
          })}
        >
          선 굵기
        </button>
      ) : null}
    </div>
  );
}
