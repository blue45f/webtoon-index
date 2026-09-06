export interface StudioWorkspaceWideModeToggleInput {
  readonly leftPanelOpen: boolean;
  readonly rightPanelOpen: boolean;
  readonly visibleLeftPanelOpen: boolean;
  readonly visibleRightPanelOpen: boolean;
  readonly presentationPanelsHidden: boolean;
}

export interface StudioWorkspaceWideModeToggleOutput {
  readonly leftPanelOpen: boolean;
  readonly rightPanelOpen: boolean;
}

/**
 * Computes the "wide" side-rail toggle target while keeping the transition
 * deterministic under density-based visibility suppression.
 *
 * - If any panel is currently visible, collapse both for maximal canvas room.
 * - If no panel is visible, restore both to open.
 * - During presentation modes, avoid changing persisted panel intent.
 */
export function resolveStudioWorkspaceWidePanelToggle(
  input: StudioWorkspaceWideModeToggleInput
): StudioWorkspaceWideModeToggleOutput {
  if (input.presentationPanelsHidden) {
    return {
      leftPanelOpen: input.leftPanelOpen,
      rightPanelOpen: input.rightPanelOpen,
    };
  }

  const anyPanelVisible = input.visibleLeftPanelOpen || input.visibleRightPanelOpen;
  if (anyPanelVisible) {
    return {
      leftPanelOpen: false,
      rightPanelOpen: false,
    };
  }

  return {
    leftPanelOpen: true,
    rightPanelOpen: true,
  };
}
