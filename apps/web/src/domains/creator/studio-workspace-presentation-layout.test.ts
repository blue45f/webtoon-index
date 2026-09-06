import { describe, expect, it } from "vitest";

import { resolveStudioWorkspacePanelLayoutVisibility } from "./studio-workspace-presentation-layout";

describe("studio workspace panel layout visibility", () => {
  it("hides both docks in canvas-only mode", () => {
    const layout = resolveStudioWorkspacePanelLayoutVisibility({
      isMobile: false,
      isFullscreen: false,
      maximized: false,
      mobileImmersive: false,
      canvasOnlyMode: true,
      uiDensityMode: "full",
      activeWorkspaceId: "lineart",
      leftPanelOpen: true,
      rightPanelOpen: true,
      forceLeftPanelOpen: false,
      forceRightPanelOpen: false,
    });
    expect(layout.presentationPanelsHidden).toBe(true);
    expect(layout.visibleLeftPanelOpen).toBe(false);
    expect(layout.visibleRightPanelOpen).toBe(false);
  });

  it("keeps focus-mode right panel available when forced", () => {
    const layout = resolveStudioWorkspacePanelLayoutVisibility({
      isMobile: false,
      isFullscreen: false,
      maximized: false,
      mobileImmersive: false,
      canvasOnlyMode: false,
      uiDensityMode: "full",
      activeWorkspaceId: "lineart",
      leftPanelOpen: true,
      rightPanelOpen: true,
      forceLeftPanelOpen: false,
      forceRightPanelOpen: true,
    });
    expect(layout.canvasWideWorkspaceDensityMode).toBe("focus");
    expect(layout.densityHidesLeftPanel).toBe(true);
    expect(layout.rightPanelDensityAllows).toBe(true);
    expect(layout.visibleRightPanelOpen).toBe(true);
  });

  it("keeps focus mode right panel hidden by UI density", () => {
    const layout = resolveStudioWorkspacePanelLayoutVisibility({
      isMobile: false,
      isFullscreen: false,
      maximized: false,
      mobileImmersive: false,
      canvasOnlyMode: false,
      uiDensityMode: "focus",
      activeWorkspaceId: "lineart",
      leftPanelOpen: true,
      rightPanelOpen: true,
      forceLeftPanelOpen: false,
      forceRightPanelOpen: false,
    });
    expect(layout.canvasWideWorkspaceDensityMode).toBe("focus");
    expect(layout.rightPanelDensityAllows).toBe(false);
    expect(layout.visibleRightPanelOpen).toBe(false);
  });

  it("keeps focus-mode left panel visible when user explicitly opens it", () => {
    const layout = resolveStudioWorkspacePanelLayoutVisibility({
      isMobile: false,
      isFullscreen: false,
      maximized: false,
      mobileImmersive: false,
      canvasOnlyMode: false,
      uiDensityMode: "full",
      activeWorkspaceId: "lineart",
      leftPanelOpen: true,
      rightPanelOpen: false,
      forceLeftPanelOpen: true,
      forceRightPanelOpen: false,
    });

    expect(layout.densityHidesLeftPanel).toBe(true);
    expect(layout.visibleLeftPanelOpen).toBe(true);
  });
});
