import { normalizeStudioUiDensityMode, type StudioUiDensityMode } from "../studio-ui-density";

import type { StudioWorkspaceId } from "../studio-workspaces";

const STUDIO_CANVAS_WIDE_WORKSPACES = [
  "storyboard",
  "lineart",
  "coloring",
  "lettering",
  "pro-comic",
  "quick-sketch",
  "csp-migration",
  "pen-display",
  "mobile-draw",
  "photo-edit",
  "vector-design",
  "animation",
  "pose-3d",
] as const satisfies readonly StudioWorkspaceId[];

export function isStudioCanvasWideWorkspace(workspaceId: StudioWorkspaceId): boolean {
  return (STUDIO_CANVAS_WIDE_WORKSPACES as readonly string[]).includes(workspaceId);
}

export function resolveStudioCanvasWideDensityMode({
  isMobile,
  uiDensityMode,
  activeWorkspaceId,
}: {
  isMobile: boolean;
  uiDensityMode: StudioUiDensityMode;
  activeWorkspaceId: StudioWorkspaceId;
}): StudioUiDensityMode {
  if (isMobile) {
    return normalizeStudioUiDensityMode(uiDensityMode);
  }

  return isStudioCanvasWideWorkspace(activeWorkspaceId)
    ? "focus"
    : normalizeStudioUiDensityMode(uiDensityMode);
}
