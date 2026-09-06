/**
 * Surface half of the main-menu host contract, as a pure mapping.
 *
 * Every callback in `StudioMainMenuSurfaceActions` is one straight delegation to
 * a handler the page already publishes for the tool rail, the project sheet or
 * the inspector. That is not page composition, so — exactly like
 * `studio-main-menu-editor-bindings.ts` — it lives out here instead of inside
 * the page's composition budget (`studio-main-menu-groups-boundary.test.ts`).
 *
 * The rule this file enforces by construction: a menu row may only open a
 * surface the product already opens somewhere else. If a name on the right has
 * no handler, the build fails here rather than shipping a dead menu item.
 *
 * Pure types + delegation only — no React, no browser, no page state.
 */

import type {
  StudioMainMenuSurfaceActions,
  StudioPixelSelectionToolId,
} from "./studio-main-menu-surface-contract";

/**
 * The handler names the page already exposes. Structural on purpose: the page
 * bundle carries far more than the menu may reach, and this interface names only
 * the doors §15.3 asks for.
 */
export interface StudioMainMenuSurfaceHandlerBundle {
  readonly activatePixelSelectionToolFromInspector: (
    tool: StudioPixelSelectionToolId,
  ) => unknown;
  readonly toggleStudioCommandBar: () => unknown;
  readonly openLayerPanelForBorderEffect: () => unknown;
  readonly enterQuickMask: () => unknown;
  readonly commitQuickMask: () => unknown;
  readonly toggleAnimationTimeline: () => unknown;
  readonly openFrameAnimationForSelected: () => unknown;
  readonly toggleOnionSkin: () => unknown;
  readonly openAnimaticTimeline: () => unknown;
  readonly openTeamPanel: () => unknown;
  readonly toggleDocumentComments: () => unknown;
  readonly openPageReview: () => unknown;
  readonly openCheckpointPanel: () => unknown;
  readonly openWriterRoom: () => unknown;
  readonly openStoryboardGrid: () => unknown;
  readonly openScrollPreview: () => unknown;
  readonly openContinuityCheck: () => unknown;
  readonly openProductionBible: () => unknown;
  readonly openQuickStart: () => unknown;
  readonly openPublishPackage: () => unknown;
  readonly openPublishPreflight: () => unknown;
  readonly openAssetRightsAudit: () => unknown;
  readonly openAutoActions: () => unknown;
  readonly openCanvasNavigatorRoute: () => unknown;
  readonly openCanvasSettingsRoute: () => unknown;
  readonly toggleCanvasGrid: () => unknown;
  readonly toggleEraseToIntersection: () => unknown;
  readonly openDialogueBatch: () => unknown;
  readonly openDialogueTranslate: () => unknown;
  readonly openLocalizationQa: () => unknown;
  readonly togglePixelArtMode: () => unknown;
  readonly insertDefaultStickyNote: () => unknown;
  readonly enableSilkSymmetry: () => unknown;
  readonly openSculptWorkbench: () => unknown;
  readonly startEphemeralWhiteboard: () => unknown;
  readonly openVrmPoserFromMenu: () => unknown;
  readonly openCharacterShaperFromMenu: () => unknown;
  readonly openBackground3dFromMenu: () => unknown;
  readonly openWebtoonAssistant?: () => unknown;
  readonly openAiSuperSuite?: () => unknown;
}

/** Names on the left are the menu contract; names on the right are the host's. */
export function bindStudioMainMenuSurfaceActions(
  actions: StudioMainMenuSurfaceHandlerBundle,
): StudioMainMenuSurfaceActions {
  return {
    activatePixelSelectionTool: actions.activatePixelSelectionToolFromInspector,
    toggleCommandBar: actions.toggleStudioCommandBar,
    openLayerPanel: actions.openLayerPanelForBorderEffect,
    enterQuickMask: actions.enterQuickMask,
    commitQuickMask: actions.commitQuickMask,
    toggleAnimationTimeline: actions.toggleAnimationTimeline,
    openFrameAnimation: actions.openFrameAnimationForSelected,
    toggleOnionSkin: actions.toggleOnionSkin,
    openAnimaticTimeline: actions.openAnimaticTimeline,
    openTeamPanel: actions.openTeamPanel,
    toggleDocumentComments: actions.toggleDocumentComments,
    openPageReview: actions.openPageReview,
    openCheckpoints: actions.openCheckpointPanel,
    openWriterRoom: actions.openWriterRoom,
    openStoryboardGrid: actions.openStoryboardGrid,
    openScrollPreview: actions.openScrollPreview,
    openContinuityCheck: actions.openContinuityCheck,
    openProductionBible: actions.openProductionBible,
    openQuickStart: actions.openQuickStart,
    openPublishPackage: actions.openPublishPackage,
    openPublishPreflight: actions.openPublishPreflight,
    openAssetRightsAudit: actions.openAssetRightsAudit,
    openAutoActions: actions.openAutoActions,
    openCanvasNavigator: actions.openCanvasNavigatorRoute,
    openCanvasSettings: actions.openCanvasSettingsRoute,
    toggleCanvasGrid: actions.toggleCanvasGrid,
    toggleVectorEraseToIntersection: actions.toggleEraseToIntersection,
    openDialogueBatch: actions.openDialogueBatch,
    openDialogueTranslate: actions.openDialogueTranslate,
    openLocalizationQa: actions.openLocalizationQa,
    togglePixelArtMode: actions.togglePixelArtMode,
    insertDefaultStickyNote: actions.insertDefaultStickyNote,
    enableSilkSymmetry: actions.enableSilkSymmetry,
    openSculptWorkbench: actions.openSculptWorkbench,
    startEphemeralWhiteboard: actions.startEphemeralWhiteboard,
    openVrmPoser: actions.openVrmPoserFromMenu,
    openCharacterShaper: actions.openCharacterShaperFromMenu,
    openBackground3d: actions.openBackground3dFromMenu,
    openWebtoonAssistant: actions.openWebtoonAssistant,
    openAiSuperSuite: actions.openAiSuperSuite,
  };
}
