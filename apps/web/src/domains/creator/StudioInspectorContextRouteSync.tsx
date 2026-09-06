import { useLayoutEffect, useRef } from "react";

import {
  resolveStudioInspectorContextRoute,
  type StudioInspectorContentMode,
  type StudioInspectorContextSnapshot,
} from "./studio-inspector-context-route";

import type { StudioInspectorLayout } from "./studio-inspector-layout";

export interface StudioInspectorContextRouteSyncProps {
  readonly contentMode: StudioInspectorContentMode;
  readonly layout: StudioInspectorLayout;
  readonly selectedType: string | null;
  readonly onChange: (layout: StudioInspectorLayout) => void;
}

/**
 * Keeps persisted inspector chrome from leaking a stale image-tool subtab into a new context.
 * A layout effect avoids one painted frame of the old Retouch/Mask tab after selection changes.
 */
export function StudioInspectorContextRouteSync({
  contentMode,
  layout,
  selectedType,
  onChange,
}: StudioInspectorContextRouteSyncProps) {
  const previousContextRef = useRef<StudioInspectorContextSnapshot | null>(null);

  useLayoutEffect(() => {
    const nextContext: StudioInspectorContextSnapshot = {
      contentMode,
      selectedType,
    };
    const nextLayout = resolveStudioInspectorContextRoute(
      layout,
      previousContextRef.current,
      nextContext,
    );
    previousContextRef.current = nextContext;
    if (nextLayout !== layout) onChange(nextLayout);
  }, [contentMode, layout, onChange, selectedType]);

  return null;
}
