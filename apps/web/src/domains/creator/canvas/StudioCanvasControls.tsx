import { Minus, Plus } from "lucide-react";
import { memo } from "react";

import { STUDIO_VIEW_ACTION_HINTS } from "../studio-view-action-hints";
import { stepStudioViewZoom } from "../studio-view-controls";
import { StudioToolHintTarget } from "../StudioToolHint";

import { localizeText } from "./studio-canvas-viewport-primitives";
import { StudioViewInputModeControls } from "./StudioCanvasViewInputModeControls";

import type { StudioAppSettings } from "../studio-app-settings";

import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

export interface StudioCanvasControlsProps {
  canvasOnlyMode: boolean;
  wheelMode: StudioAppSettings["mouse"]["wheel"];
  zoomLocked: boolean;
  toggleWheelCanvasMode: () => void;
  setZoomLocked: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  zoomOutUnavailableReason?: string;
  viewTransformSuppressed: boolean;
  zoomOutAtLimit: boolean;
  setZoom: import("react").Dispatch<import("react").SetStateAction<number>>;
  viewBusyReason?: string;
  zoomLockedReason?: string;
  setActualPixelView: () => void;
  effScale: number;
  zoomInUnavailableReason?: string;
  zoomInAtLimit: boolean;
}

export const StudioCanvasControls = memo(function StudioCanvasControls({
  canvasOnlyMode,
  wheelMode,
  zoomLocked,
  toggleWheelCanvasMode,
  setZoomLocked,
  zoomOutUnavailableReason,
  viewTransformSuppressed,
  zoomOutAtLimit,
  setZoom,
  viewBusyReason,
  zoomLockedReason,
  setActualPixelView,
  effScale,
  zoomInUnavailableReason,
  zoomInAtLimit,
}: StudioCanvasControlsProps) {
  const t = useT();

  return (
    <div
      className={cn(
        "absolute bottom-3 left-3 z-30 hidden items-center gap-0.5 rounded-full border border-line bg-panel/95 p-0.5 shadow-lg backdrop-blur",
        canvasOnlyMode && "lg:flex"
      )}
    >
      <StudioViewInputModeControls
        compact
        wheelMode={wheelMode}
        zoomLocked={zoomLocked}
        onToggleWheelMode={toggleWheelCanvasMode}
        onToggleZoomLock={() => setZoomLocked((current) => !current)}
      />
      <StudioToolHintTarget
        hint={STUDIO_VIEW_ACTION_HINTS.zoomOut}
        unavailableReason={zoomOutUnavailableReason}
        preferredSide="top"
      >
        <button
          type="button"
          onClick={() => {
            if (!viewTransformSuppressed && !zoomLocked && !zoomOutAtLimit) {
              setZoom((current) => stepStudioViewZoom(current, -1));
            }
          }}
          aria-disabled={viewTransformSuppressed || zoomLocked || zoomOutAtLimit ? true : undefined}
          className={cn(
            "grid size-7 place-items-center rounded-full text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
            (viewTransformSuppressed || zoomLocked || zoomOutAtLimit) && "cursor-not-allowed opacity-40"
          )}
          aria-label={t("studio.shortcuts.row.view.zoomOut")}
        >
          <Minus className="size-3.5" aria-hidden />
        </button>
      </StudioToolHintTarget>
      <StudioToolHintTarget
        hint={STUDIO_VIEW_ACTION_HINTS.actualSize}
        unavailableReason={viewBusyReason ?? zoomLockedReason}
        preferredSide="top"
      >
        <button
          type="button"
          onClick={() => {
            if (!viewTransformSuppressed && !zoomLocked) setActualPixelView();
          }}
          aria-disabled={viewTransformSuppressed || zoomLocked ? true : undefined}
          className={cn(
            "min-h-7 min-w-[3.25rem] rounded-full px-1 text-center text-xs font-semibold tabular-nums text-fg transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
            (viewTransformSuppressed || zoomLocked) && "cursor-not-allowed opacity-40"
          )}
          aria-label={localizeText(t, "실제 픽셀 100% 보기", "studio.canvas.actualPixelAria")}
        >
          {Math.round(effScale * 100)}%
        </button>
      </StudioToolHintTarget>
      <StudioToolHintTarget
        hint={STUDIO_VIEW_ACTION_HINTS.zoomIn}
        unavailableReason={zoomInUnavailableReason}
        preferredSide="top"
      >
        <button
          type="button"
          onClick={() => {
            if (!viewTransformSuppressed && !zoomLocked && !zoomInAtLimit) {
              setZoom((current) => stepStudioViewZoom(current, 1));
            }
          }}
          aria-disabled={viewTransformSuppressed || zoomLocked || zoomInAtLimit ? true : undefined}
          className={cn(
            "grid size-7 place-items-center rounded-full text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
            (viewTransformSuppressed || zoomLocked || zoomInAtLimit) && "cursor-not-allowed opacity-40"
          )}
          aria-label={t("studio.shortcuts.row.view.zoomIn")}
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      </StudioToolHintTarget>
    </div>
  );
});
