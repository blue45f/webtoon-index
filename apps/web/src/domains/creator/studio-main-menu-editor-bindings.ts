/**
 * Editor half of the main-menu host contract, as a pure mapping.
 *
 * `StudioMainMenuEditorActions` is 37 straight delegations to the page's stable
 * handler bundle: no browser globals, no refs, no state reads — only "this
 * contract name calls that handler name". That is not page composition, so it
 * does not belong in the page's composition budget
 * (`studio-main-menu-groups-boundary.test.ts`), and keeping it here is what left
 * Wave D room to wire Mask/Clipping without raising that budget.
 *
 * The UI half stays in the page on purpose: those callbacks touch input refs,
 * window handles and panel state, and the boundary test asserts they do.
 *
 * Pure types + delegation only — no React, no browser, no page state.
 */

import type { StudioFilterDraft, StudioFilterKind } from "./filter/studio-filter-menu";
import type { CvdMode } from "./studio-color-vision-model";
import type {
  StudioCanvasRotationDirection,
  StudioLayerReorder,
  StudioMainMenuEditorActions,
  StudioPastePlacement,
  StudioSaveMode,
} from "./studio-main-menu-contract";
import type { StudioUiDensityMode } from "./studio-ui-density";

/**
 * The handler names the page already exposes. Deliberately structural: the page
 * bundle carries more handlers than the menu needs (tool activation, announcements),
 * and this interface names only the ones the menu is allowed to reach.
 */
export interface StudioMainMenuEditorHandlerBundle {
  readonly handleCopyToClipboard: () => unknown;
  readonly handleSave: (mode: StudioSaveMode) => unknown;
  readonly handleExportProject: () => unknown;
  readonly handleExportProjectArchive: () => unknown;
  readonly undo: () => unknown;
  readonly redo: () => unknown;
  readonly cutSelectedElements: () => unknown;
  readonly copySelectedElements: () => unknown;
  readonly pasteStudioElementsFromClipboard: (placement: StudioPastePlacement) => unknown;
  readonly openImagePastePicker: () => unknown;
  readonly selectAllForEdit: () => unknown;
  readonly deselectForEdit: () => unknown;
  readonly invertSelectionForEdit: () => unknown;
  readonly clearSelectionForEdit: () => unknown;
  readonly duplicateSelected: () => unknown;
  readonly reorder: (placement: StudioLayerReorder) => unknown;
  readonly openSelectedLayerCrop: () => unknown;
  readonly toggleSelectedClippingMask: () => unknown;
  readonly addText: () => unknown;
  readonly addPage: () => unknown;
  readonly toggleHorizontalCanvasView: () => unknown;
  readonly rotateCanvasView: (direction: StudioCanvasRotationDirection) => unknown;
  readonly resetCanvasViewRotation: () => unknown;
  readonly fitCanvasToWidth: () => unknown;
  readonly setActualPixelView: () => unknown;
  readonly toggleFullscreen: () => unknown;
  readonly toggleCanvasRulers: () => unknown;
  readonly setColorBlindPreview: (mode: CvdMode) => unknown;
  readonly saveCurrentStudioView: () => unknown;
  readonly restoreSavedStudioView: () => unknown;
  readonly togglePerspectiveGuideView: () => unknown;
  readonly showAllLocallyHiddenLayers: () => unknown;
  readonly setStudioUiDensity: (mode: StudioUiDensityMode) => unknown;
  readonly enterCanvasOnlyMode: () => unknown;
  readonly openFeatureTutorial: (tutorialId?: string | null) => unknown;
  readonly openStudioFilter: (kind: StudioFilterKind, draft?: StudioFilterDraft) => unknown;
  readonly toggleAdvancedFill: () => unknown;
}

/** Names on the left are the menu contract; names on the right are the host's. */
export function bindStudioMainMenuEditorActions(
  actions: StudioMainMenuEditorHandlerBundle,
): StudioMainMenuEditorActions {
  return {
    copyImageToClipboard: actions.handleCopyToClipboard,
    save: actions.handleSave,
    exportProject: actions.handleExportProject,
    exportProjectArchive: actions.handleExportProjectArchive,
    undo: actions.undo,
    redo: actions.redo,
    cutSelectedElements: actions.cutSelectedElements,
    copySelectedElements: actions.copySelectedElements,
    pasteElements: actions.pasteStudioElementsFromClipboard,
    openImagePastePicker: actions.openImagePastePicker,
    selectAll: actions.selectAllForEdit,
    deselect: actions.deselectForEdit,
    invertSelection: actions.invertSelectionForEdit,
    clearSelection: actions.clearSelectionForEdit,
    duplicateSelected: actions.duplicateSelected,
    reorder: actions.reorder,
    openSelectedLayerCrop: actions.openSelectedLayerCrop,
    toggleClippingMask: actions.toggleSelectedClippingMask,
    addText: actions.addText,
    addPage: actions.addPage,
    toggleHorizontalCanvasView: actions.toggleHorizontalCanvasView,
    rotateCanvasView: actions.rotateCanvasView,
    resetCanvasViewRotation: actions.resetCanvasViewRotation,
    fitCanvasToWidth: actions.fitCanvasToWidth,
    setActualPixelView: actions.setActualPixelView,
    toggleFullscreen: actions.toggleFullscreen,
    toggleCanvasRulers: actions.toggleCanvasRulers,
    setColorVisionMode: actions.setColorBlindPreview,
    saveCurrentStudioView: actions.saveCurrentStudioView,
    restoreSavedStudioView: actions.restoreSavedStudioView,
    togglePerspectiveGuideView: actions.togglePerspectiveGuideView,
    showAllLocallyHiddenLayers: actions.showAllLocallyHiddenLayers,
    setStudioUiDensity: actions.setStudioUiDensity,
    enterCanvasOnlyMode: actions.enterCanvasOnlyMode,
    // The menu's tutorial row is the hub, not one tutorial — the host handler takes an id.
    openFeatureTutorial: () => actions.openFeatureTutorial(null),
    openStudioFilter: actions.openStudioFilter,
    toggleAdvancedFill: actions.toggleAdvancedFill,
  };
}
