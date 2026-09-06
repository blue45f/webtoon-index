import { createPortal } from "react-dom";

import {
  type StudioFloatingSurfaceDock,
  type StudioFloatingSurfaceLayout,
} from "./studio-floating-surface";
import { StudioFloatingSurface } from "./StudioFloatingSurface";
import { useStudioFloatingSurfaceLayout } from "./use-studio-floating-surface-layout";

import type { ReactElement, ReactNode } from "react";

export interface StudioDetachablePanelSlotProps {
  readonly detached: boolean;
  readonly surfaceId: string;
  readonly label: string;
  readonly defaultLayout: StudioFloatingSurfaceLayout;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly insetTop?: number;
  readonly allowedDockEdges?: readonly StudioFloatingSurfaceDock[];
}

/**
 * Keeps an existing panel mounted in its authored dock, or portals the exact same panel body into
 * the shared movable-window chrome. This avoids duplicate panel state and preserves the mobile
 * sheet implementation while desktop artists gain free placement, docking, locks and resize.
 */
export function StudioDetachablePanelSlot({
  detached,
  surfaceId,
  label,
  defaultLayout,
  onClose,
  children,
  minWidth = 300,
  minHeight = 320,
  maxWidth = 900,
  maxHeight = 1_100,
  insetTop = 76,
  allowedDockEdges = ["left", "right"],
}: StudioDetachablePanelSlotProps): ReactElement {
  const { layout, setLayout, authority, failure } = useStudioFloatingSurfaceLayout({
    surfaceId,
    defaultLayout,
    enabled: detached,
  });

  if (!detached || typeof document === "undefined") {
    return <>{children}</>;
  }

  return createPortal(
    <StudioFloatingSurface
      surfaceId={surfaceId}
      label={label}
      layout={layout}
      defaultLayout={defaultLayout}
      minWidth={minWidth}
      minHeight={minHeight}
      maxWidth={maxWidth}
      maxHeight={maxHeight}
      insetTop={insetTop}
      insetRight={12}
      insetBottom={12}
      insetLeft={12}
      snapDistance={12}
      allowedDockEdges={allowedDockEdges}
      onLayoutChange={setLayout}
      onClose={onClose}
      rootDataAttributes={{
        "data-studio-detachable-surface": surfaceId,
        "data-studio-floating-layout-authority": authority,
        "data-studio-floating-layout-failure": failure ?? undefined,
      }}
      className="border-line-strong"
      contentClassName="flex min-h-0 flex-1"
    >
      {children}
    </StudioFloatingSurface>,
    document.body,
  );
}
