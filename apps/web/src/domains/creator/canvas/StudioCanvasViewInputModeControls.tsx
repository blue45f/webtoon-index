import { Lock, Mouse, Unlock } from "lucide-react";

import { localizeText } from "./studio-canvas-viewport-primitives";

import type { StudioAppSettings } from "../studio-app-settings";

import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

export function StudioViewInputModeControls({
  compact = false,
  wheelMode,
  zoomLocked,
  onToggleWheelMode,
  onToggleZoomLock,
}: {
  compact?: boolean;
  wheelMode: StudioAppSettings["mouse"]["wheel"];
  zoomLocked: boolean;
  onToggleWheelMode: () => void;
  onToggleZoomLock: () => void;
}) {
  const t = useT();
  const wheelScrollMode = wheelMode === "pan";
  const wheelLabel = wheelScrollMode
    ? localizeText(t, "휠: 캔버스 스크롤", "studio.canvas.wheelMode.pan")
    : wheelMode === "brush-size"
      ? localizeText(t, "휠: 브러시 크기", "studio.canvas.wheelMode.brushSize")
      : localizeText(t, "휠: 캔버스 확대·축소", "studio.canvas.wheelMode.zoom");
  const lockLabel = zoomLocked
    ? localizeText(t, "캔버스 배율 잠금 해제", "studio.canvas.zoomLock.unlock")
    : localizeText(t, "캔버스 배율 잠금", "studio.canvas.zoomLock.lock");

  return (
    <div
      role="group"
      aria-label={localizeText(t, "캔버스 보기 조작", "studio.canvas.viewInputControls")}
      className={cn(
        "inline-flex items-center gap-0.5",
        compact ? "" : "rounded-full border border-line/60 bg-card/45 p-0.5",
      )}
    >
      <button
        type="button"
        aria-pressed={wheelScrollMode}
        aria-label={wheelLabel}
        title={`${wheelLabel} · ${localizeText(t, "클릭해서 줌/스크롤 전환", "studio.canvas.wheelMode.toggleHint")}`}
        onClick={onToggleWheelMode}
        className={cn(
          "inline-flex min-h-7 items-center justify-center gap-1 rounded-full px-2 text-[0.65rem] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
          wheelScrollMode
            ? "bg-accent-soft text-accent"
            : "text-fg-2 hover:bg-raised hover:text-fg",
          compact && "size-7 px-0",
        )}
      >
        <Mouse className="size-3.5" aria-hidden />
        {!compact ? (
          <span>{wheelScrollMode
            ? localizeText(t, "스크롤", "studio.canvas.wheelMode.panShort")
            : localizeText(t, "줌", "studio.canvas.wheelMode.zoomShort")}</span>
        ) : null}
      </button>
      <button
        type="button"
        aria-pressed={zoomLocked}
        aria-label={lockLabel}
        title={lockLabel}
        onClick={onToggleZoomLock}
        className={cn(
          "grid size-7 place-items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
          zoomLocked
            ? "bg-warning-soft text-warning"
            : "text-fg-2 hover:bg-raised hover:text-fg",
        )}
      >
        {zoomLocked
          ? <Lock className="size-3.5" aria-hidden />
          : <Unlock className="size-3.5" aria-hidden />}
      </button>
    </div>
  );
}
