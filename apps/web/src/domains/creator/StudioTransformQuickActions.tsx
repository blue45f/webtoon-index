import { FlipHorizontal2, FlipVertical2, ScanSearch } from "lucide-react";

import { buttonClass } from "@/shared/components/ui/button-utils";

export interface StudioTransformQuickActionsProps {
  readonly disabled: boolean;
  readonly disabledReason: string | null;
  readonly onZoomToSelection?: () => void;
  readonly onFlipHorizontal?: () => void;
  readonly onFlipVertical?: () => void;
}

export function StudioTransformQuickActions({
  disabled,
  disabledReason,
  onZoomToSelection,
  onFlipHorizontal,
  onFlipVertical,
}: StudioTransformQuickActionsProps) {
  const className = "size-9 gap-0 px-0 pointer-coarse:size-11";
  return (
    <div className="flex items-end justify-end gap-1">
      {onZoomToSelection ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onZoomToSelection}
          title={disabledReason ?? "선택 영역으로 확대 (⇧F)"}
          aria-label="선택 영역으로 확대"
          data-inspector-control-id="selection.zoom"
          data-inspector-priority="advanced"
          className={buttonClass({ size: "sm", variant: "quiet", className })}
        >
          <ScanSearch size={14} aria-hidden />
        </button>
      ) : null}
      {onFlipHorizontal ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onFlipHorizontal}
          title={disabledReason ?? "좌우 반전 (⇧H)"}
          aria-label="선택 좌우 반전"
          data-inspector-control-id="selection.flip-horizontal"
          data-inspector-priority="advanced"
          className={buttonClass({ size: "sm", variant: "quiet", className })}
        >
          <FlipHorizontal2 size={14} aria-hidden />
        </button>
      ) : null}
      {onFlipVertical ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onFlipVertical}
          title={disabledReason ?? "상하 반전 (⇧V)"}
          aria-label="선택 상하 반전"
          data-inspector-control-id="selection.flip-vertical"
          data-inspector-priority="advanced"
          className={buttonClass({ size: "sm", variant: "quiet", className })}
        >
          <FlipVertical2 size={14} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
