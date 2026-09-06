import { MoreHorizontal } from "lucide-react";
import { useState, type ReactNode, type RefObject } from "react";

import {
  STUDIO_EASE,
  STUDIO_FOCUS_RING,
  STUDIO_TOUCH_TARGET,
} from "../studio-panel-ui";
import { StudioFloatingSurface } from "../StudioFloatingSurface";

import {
  DEFAULT_STUDIO_DRAWING_PALETTE_FLOATING_LAYOUTS,
  loadStudioDrawingPaletteFloatingLayout,
  saveStudioDrawingPaletteFloatingLayout,
} from "./studio-drawing-palette-floating-layout";

import type { StudioFloatingSurfaceLayout } from "../studio-floating-surface";
import type { StudioDrawingPaletteId } from "./studio-drawing-palettes";

import { cn } from "@/shared/lib/utils";

export interface StudioDrawingPaletteFloatingSurfaceProps {
  readonly id: StudioDrawingPaletteId;
  readonly popupId: string;
  readonly label: string;
  readonly surfaceRef: RefObject<HTMLDivElement | null>;
  readonly optionsOpen: boolean;
  readonly optionsId: string;
  readonly options: ReactNode;
  readonly children: ReactNode;
  readonly onToggleOptions: () => void;
  readonly onClose: () => void;
}

/** Shared movable window presentation for detached Sub Tool and Tool Property palettes. */
export function StudioDrawingPaletteFloatingSurface({
  id,
  popupId,
  label,
  surfaceRef,
  optionsOpen,
  optionsId,
  options,
  children,
  onToggleOptions,
  onClose,
}: StudioDrawingPaletteFloatingSurfaceProps) {
  const [layout, setLayout] = useState(() =>
    loadStudioDrawingPaletteFloatingLayout(id)
  );
  const commitLayout = (next: StudioFloatingSurfaceLayout): void => {
    setLayout(next);
    saveStudioDrawingPaletteFloatingLayout(id, next);
  };

  return (
    <StudioFloatingSurface
      ref={surfaceRef}
      id={popupId}
      surfaceId={`drawing-palette:${id}`}
      label={`${label} 팝업`}
      layout={layout}
      defaultLayout={DEFAULT_STUDIO_DRAWING_PALETTE_FLOATING_LAYOUTS[id]}
      minWidth={280}
      minHeight={280}
      maxWidth={640}
      maxHeight={900}
      snapDistance={10}
      insetTop={76}
      insetRight={12}
      insetBottom={12}
      insetLeft={12}
      onLayoutChange={commitLayout}
      onClose={onClose}
      headerActions={(
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={optionsOpen}
          aria-controls={optionsId}
          onClick={onToggleOptions}
          aria-label={`${label} 팔레트 옵션`}
          title="위치·높이·창 배치 옵션"
          className={cn(
            "grid size-10 place-items-center text-fg-2 hover:bg-card hover:text-fg",
            optionsOpen && "bg-accent-soft text-accent",
            STUDIO_TOUCH_TARGET,
            STUDIO_EASE,
            STUDIO_FOCUS_RING,
          )}
        >
          <MoreHorizontal size={17} aria-hidden />
        </button>
      )}
      rootDataAttributes={{
        "data-studio-drawing-palette-overlay": "palette",
        "data-studio-drawing-palette-overlay-id": id,
      }}
      className="border-line-strong"
      contentClassName="flex min-h-0 flex-col"
    >
      {optionsOpen ? (
        <div
          id={optionsId}
          role="menu"
          aria-label={`${label} 팔레트 옵션`}
          className="shrink-0 border-b border-line bg-card/55"
        >
          {options}
        </div>
      ) : null}
      <div
        data-studio-drawing-palette-popup-content="true"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 [scrollbar-gutter:stable]"
      >
        {children}
      </div>
    </StudioFloatingSurface>
  );
}
