import { createPortal } from "react-dom";

import { StudioQuickAccessDesktopSurface } from "./StudioQuickAccessDesktopSurface";
import { StudioQuickAccessMobileSurface } from "./StudioQuickAccessMobileSurface";
import { useStudioQuickAccessSurfaceLifecycle } from "./use-studio-quick-access-surface-lifecycle";

import type { StudioQuickAccessSurfaceProps } from "./studio-quick-access-surface-types";

export type { StudioQuickAccessSurfaceProps } from "./studio-quick-access-surface-types";

/**
 * Responsive owner for Quick Access.
 *
 * Desktop uses reusable floating-window chrome; mobile deliberately stays a bounded modal sheet so
 * a palette cannot cover both the canvas and thumb dock.
 */
export function StudioQuickAccessSurface(props: StudioQuickAccessSurfaceProps) {
  const {
    state,
    catalog,
    isMobile,
    onStateChange,
    onExecute,
    onClose,
  } = props;
  const { descriptionId, surfaceRef } = useStudioQuickAccessSurfaceLifecycle(
    isMobile,
    onClose,
  );

  if (typeof document === "undefined") return null;
  const leafProps = {
    state,
    catalog,
    onStateChange,
    onExecute,
    onClose,
    descriptionId,
    surfaceRef,
  };

  return createPortal(
    isMobile ? (
      <div
        data-studio-quick-access-portal="true"
        className="pointer-events-none fixed inset-0 z-[70]"
      >
        <StudioQuickAccessMobileSurface {...leafProps} />
      </div>
    ) : (
      <div data-studio-quick-access-portal="true" className="contents">
        <StudioQuickAccessDesktopSurface {...leafProps} />
      </div>
    ),
    document.body,
  );
}
