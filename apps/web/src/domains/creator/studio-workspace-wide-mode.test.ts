import { describe, expect, it } from "vitest";

import {
  resolveStudioWorkspaceWidePanelToggle,
} from "./studio-workspace-wide-mode";

describe("resolveStudioWorkspaceWidePanelToggle", () => {
  it("collapses when one or both panels are visible", () => {
    expect(
      resolveStudioWorkspaceWidePanelToggle({
        leftPanelOpen: true,
        rightPanelOpen: false,
        visibleLeftPanelOpen: true,
        visibleRightPanelOpen: false,
        presentationPanelsHidden: false,
      })
    ).toEqual({ leftPanelOpen: false, rightPanelOpen: false });
  });

  it("restores both panels when both are currently visually hidden", () => {
    expect(
      resolveStudioWorkspaceWidePanelToggle({
        leftPanelOpen: false,
        rightPanelOpen: false,
        visibleLeftPanelOpen: false,
        visibleRightPanelOpen: false,
        presentationPanelsHidden: false,
      })
    ).toEqual({ leftPanelOpen: true, rightPanelOpen: true });
  });

  it("keeps density/layout intent while presentation mode is hiding panels", () => {
    expect(
      resolveStudioWorkspaceWidePanelToggle({
        leftPanelOpen: false,
        rightPanelOpen: true,
        visibleLeftPanelOpen: false,
        visibleRightPanelOpen: false,
        presentationPanelsHidden: true,
      })
    ).toEqual({ leftPanelOpen: false, rightPanelOpen: true });
  });

  it("prioritizes visible panels over raw intent when density suppresses one rail", () => {
    expect(
      resolveStudioWorkspaceWidePanelToggle({
        leftPanelOpen: true,
        rightPanelOpen: true,
        visibleLeftPanelOpen: false,
        visibleRightPanelOpen: true,
        presentationPanelsHidden: false,
      })
    ).toEqual({ leftPanelOpen: false, rightPanelOpen: false });
  });
});
