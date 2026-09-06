import { resolveStudioCanvasWideDensityMode } from "./canvas/studio-canvas-wide-density";
import { studioUiDensityAllows } from "./studio-ui-density";

import type { StudioUiDensityMode } from "./studio-ui-density";
import type { StudioWorkspaceId } from "./studio-workspaces";

export interface StudioWorkspacePresentationLayout {
  readonly canvasWideWorkspaceDensityMode: StudioUiDensityMode;
  readonly densityHidesLeftPanel: boolean;
  readonly rightPanelDensityAllows: boolean;
  readonly densityHidesPageStrip: boolean;
  readonly densityShowsStatusRail: boolean;
  readonly forceLeftPanelOpen: boolean;
  readonly visibleLeftPanelOpen: boolean;
  readonly visibleRightPanelOpen: boolean;
  readonly presentationPanelsHidden: boolean;
}

export function resolveStudioWorkspacePanelLayoutVisibility(input: {
  readonly isMobile: boolean;
  readonly isFullscreen: boolean;
  readonly maximized: boolean;
  readonly mobileImmersive: boolean;
  readonly canvasOnlyMode: boolean;
  readonly uiDensityMode: StudioUiDensityMode;
  readonly activeWorkspaceId: StudioWorkspaceId;
  readonly leftPanelOpen: boolean;
  readonly rightPanelOpen: boolean;
  readonly forceLeftPanelOpen: boolean;
  readonly forceRightPanelOpen: boolean;
}): StudioWorkspacePresentationLayout {
  const presentationPanelsHidden = input.isFullscreen
    || input.maximized
    || input.mobileImmersive
    || input.canvasOnlyMode;
  const canvasWideWorkspaceDensityMode = resolveStudioCanvasWideDensityMode({
    isMobile: input.isMobile,
    uiDensityMode: input.uiDensityMode,
    activeWorkspaceId: input.activeWorkspaceId,
  });
  const densityHidesLeftPanel = !studioUiDensityAllows(
    canvasWideWorkspaceDensityMode,
    "left-panel",
  );
  const rightPanelDensityAllows =
    input.forceRightPanelOpen || studioUiDensityAllows(
      canvasWideWorkspaceDensityMode,
      "right-panel",
    );
  const densityHidesPageStrip = !studioUiDensityAllows(
    canvasWideWorkspaceDensityMode,
    "page-strip",
  );
  const densityShowsStatusRail = studioUiDensityAllows(
    canvasWideWorkspaceDensityMode,
    "status-rail",
  );
  const visibleLeftPanelOpen = input.leftPanelOpen
    && !presentationPanelsHidden
    && (input.forceLeftPanelOpen || (!densityHidesLeftPanel && !densityHidesPageStrip));
  const visibleRightPanelOpen = input.rightPanelOpen
    && !presentationPanelsHidden
    && rightPanelDensityAllows;

  return {
    presentationPanelsHidden,
    canvasWideWorkspaceDensityMode,
    densityHidesLeftPanel,
    forceLeftPanelOpen: input.forceLeftPanelOpen,
    rightPanelDensityAllows,
    densityHidesPageStrip,
    densityShowsStatusRail,
    visibleLeftPanelOpen,
    visibleRightPanelOpen,
  };
}
