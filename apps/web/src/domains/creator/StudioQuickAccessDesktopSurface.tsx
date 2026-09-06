import { useState } from "react";

import {
  DEFAULT_STUDIO_QUICK_ACCESS_FLOATING_LAYOUT,
  loadStudioQuickAccessFloatingLayout,
  saveStudioQuickAccessFloatingLayout,
} from "./studio-quick-access-surface-layout";
import { StudioFloatingSurface } from "./StudioFloatingSurface";
import { StudioQuickAccessPalette } from "./StudioQuickAccessPalette";

import type { StudioFloatingSurfaceLayout } from "./studio-floating-surface";
import type { StudioQuickAccessSurfaceLeafProps } from "./studio-quick-access-surface-types";

/** Movable, resizable desktop presentation backed by the shared Studio window chrome. */
export function StudioQuickAccessDesktopSurface({
  state,
  catalog,
  descriptionId,
  surfaceRef,
  onStateChange,
  onExecute,
  onClose,
}: StudioQuickAccessSurfaceLeafProps) {
  const [layout, setLayout] = useState(loadStudioQuickAccessFloatingLayout);
  const commitLayout = (next: StudioFloatingSurfaceLayout): void => {
    setLayout(next);
    saveStudioQuickAccessFloatingLayout(next);
  };

  return (
    <StudioFloatingSurface
      ref={surfaceRef}
      surfaceId="quick-access"
      label="빠른 액세스 팔레트"
      descriptionId={descriptionId}
      layout={layout}
      defaultLayout={DEFAULT_STUDIO_QUICK_ACCESS_FLOATING_LAYOUT}
      minWidth={280}
      minHeight={320}
      maxWidth={560}
      maxHeight={900}
      snapDistance={8}
      insetTop={76}
      insetRight={12}
      insetBottom={12}
      insetLeft={12}
      onLayoutChange={commitLayout}
      onClose={onClose}
      rootDataAttributes={{
        "data-studio-quick-access-surface": "true",
        "data-studio-shortcut-boundary": "true",
        "data-mobile": "false",
      }}
      contentClassName="overflow-hidden"
    >
      <p id={descriptionId} className="sr-only">
        자주 쓰는 명령을 실행하거나 표시 방식과 명령 순서를 편집합니다.
      </p>
      <StudioQuickAccessPalette
        state={state}
        catalog={catalog}
        onStateChange={onStateChange}
        onExecute={onExecute}
        className="h-full min-h-0 rounded-none border-0 shadow-none"
      />
    </StudioFloatingSurface>
  );
}
