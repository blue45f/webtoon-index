import { X } from "lucide-react";


import {
  STUDIO_EASE,
  STUDIO_FOCUS_RING,
} from "./studio-panel-ui";
import { StudioQuickAccessPalette } from "./StudioQuickAccessPalette";

import type { StudioQuickAccessSurfaceLeafProps } from "./studio-quick-access-surface-types";
import type { PointerEvent as ReactPointerEvent } from "react";

import { cn } from "@/shared/lib/utils";

/** Bounded modal presentation retained for touch viewports. */
export function StudioQuickAccessMobileSurface({
  state,
  catalog,
  descriptionId,
  surfaceRef,
  onStateChange,
  onExecute,
  onClose,
}: StudioQuickAccessSurfaceLeafProps) {
  return (
    <>
      <button
        type="button"
        aria-label="빠른 액세스 닫기"
        className="pointer-events-auto absolute inset-0 cursor-default bg-black/45 backdrop-blur-[2px]"
        onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        aria-label="빠른 액세스 팔레트"
        aria-describedby={descriptionId}
        data-studio-quick-access-surface="true"
        data-studio-shortcut-boundary="true"
        data-mobile="true"
        tabIndex={-1}
        className={cn(
          "pointer-events-auto absolute min-h-0 text-fg",
          "inset-x-2 bottom-[calc(0.5rem+env(safe-area-inset-bottom))]",
          "h-[min(78dvh,44rem)] max-h-[calc(100dvh-4rem)] min-h-[14rem]",
        )}
      >
        <p id={descriptionId} className="sr-only">
          자주 쓰는 명령을 실행하거나 표시 방식과 명령 순서를 편집합니다.
        </p>
        <button
          type="button"
          aria-label="빠른 액세스 팔레트 닫기"
          title="빠른 액세스 닫기"
          className={cn(
            "absolute -top-11 right-0 z-10 inline-flex size-10 items-center justify-center rounded-lg border border-line bg-panel text-fg-2 shadow-lg hover:bg-raised hover:text-fg",
            "max-lg:size-11 pointer-coarse:size-11",
            STUDIO_EASE,
            STUDIO_FOCUS_RING,
          )}
          onClick={onClose}
        >
          <X size={17} aria-hidden />
        </button>
        <StudioQuickAccessPalette
          state={state}
          catalog={catalog}
          onStateChange={onStateChange}
          onExecute={onExecute}
          className="h-full min-h-0 shadow-2xl"
        />
      </div>
    </>
  );
}
