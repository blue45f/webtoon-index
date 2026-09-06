import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { STUDIO_COMMAND_CATALOG } from "./studio-command-catalog";
import {
  buildStudioMainMenuGroups,
  type StudioMainMenuBuilderState,
  type StudioMainMenuEditAvailability,
  type StudioMainMenuEditorActions,
  type StudioMainMenuUiActions,
} from "./studio-main-menu-groups";
import { createStudioMainMenuPresentation } from "./studio-main-menu-presentation";
import {
  listStudioPrimaryActionReachability,
  studioPrimaryActionsPresentInCommandCatalog,
  studioPrimaryActionsPresentInMenuInventory,
  STUDIO_PRIMARY_ACTION_IDS,
  STUDIO_PRIMARY_ACTION_SELECTORS,
} from "./studio-primary-action-reachability";

const AVAILABLE_EDIT_ACTIONS: StudioMainMenuEditAvailability = {
  undoDisabled: false,
  redoDisabled: false,
  cutDisabled: false,
  copyDisabled: false,
  pasteDisabled: false,
  selectAllDisabled: false,
  deselectDisabled: false,
  invertSelectionDisabled: false,
  clearSelectionDisabled: false,
  duplicateDisabled: false,
  reorderDisabled: false,
  cropLayerDisabled: false,
};

const BASE_STATE: StudioMainMenuBuilderState = {
  sharedNonOwnerSave: false,
  saving: false,
  collaborationDocumentLocked: false,
  hasWorkId: false,
  projectArchiveBusy: false,
  interchangeImportBusy: false,
  psdImportBusy: false,
  edit: AVAILABLE_EDIT_ACTIONS,
  filterDisabled: false,
  filterUnavailableReason: null,
  viewTransformSuppressed: false,
  canvasFlipH: false,
  canvasRotation: 0,
  fullscreen: false,
  canvasRulersVisible: true,
  colorVisionMode: "none",
  referencePanelOpen: false,
  pageSequenceOpen: false,
  hasSavedView: false,
  perspectiveRulerActive: false,
  hasLocallyHiddenLayers: false,
  quickAccessPaletteOpen: false,
  quickAccessPaletteLoading: false,
  leftPanelOpen: true,
  rightPanelOpen: true,
  lastFilterDraft: null,
  clippingMaskActive: false,
  clippingMaskDisabled: false,
  imageLayerSelected: true,
  activeToolCommandId: "tool.pen",
  pixelSelectionTool: null,
  quickMaskActive: false,
  animationTimelineOpen: false,
  onionSkinEnabled: false,
  documentCommentsOpen: false,
  canvasGridVisible: false,
  vectorEraseToIntersection: false,
  masterEditMode: false,
  pixelArtEnabled: false,
};

function createEditorActions(): StudioMainMenuEditorActions {
  return {
    copyImageToClipboard: vi.fn(),
    save: vi.fn(),
    exportProject: vi.fn(),
    exportProjectArchive: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    cutSelectedElements: vi.fn(),
    copySelectedElements: vi.fn(),
    pasteElements: vi.fn(),
    openImagePastePicker: vi.fn(),
    selectAll: vi.fn(),
    deselect: vi.fn(),
    invertSelection: vi.fn(),
    clearSelection: vi.fn(),
    duplicateSelected: vi.fn(),
    reorder: vi.fn(),
    openSelectedLayerCrop: vi.fn(),
    toggleClippingMask: vi.fn(),
    addText: vi.fn(),
    addPage: vi.fn(),
    toggleHorizontalCanvasView: vi.fn(),
    rotateCanvasView: vi.fn(),
    resetCanvasViewRotation: vi.fn(),
    fitCanvasToWidth: vi.fn(),
    setActualPixelView: vi.fn(),
    toggleFullscreen: vi.fn(),
    toggleCanvasRulers: vi.fn(),
    setColorVisionMode: vi.fn(),
    saveCurrentStudioView: vi.fn(),
    restoreSavedStudioView: vi.fn(),
    togglePerspectiveGuideView: vi.fn(),
    showAllLocallyHiddenLayers: vi.fn(),
    setStudioUiDensity: vi.fn(),
    enterCanvasOnlyMode: vi.fn(),
    openFeatureTutorial: vi.fn(),
    openStudioFilter: vi.fn(),
    toggleAdvancedFill: vi.fn(),
  };
}

function createUiActions(): StudioMainMenuUiActions {
  return {
    openExportDownload: vi.fn(),
    requestProjectImport: vi.fn(),
    requestInterchangeImport: vi.fn(),
    requestPsdImport: vi.fn(),
    openProjectTools: vi.fn(),
    toggleHistoryPanel: vi.fn(),
    openAppSettings: vi.fn(),
    openStudioMenu: vi.fn(),
    openAssetMenu: vi.fn(),
    requestImageInsert: vi.fn(),
    openMannequinPoser: vi.fn(),
    openVrmPoser: vi.fn(),
    openCharacterShaper: vi.fn(),
    openBackground3d: vi.fn(),
    openReferencePanel: vi.fn(),
    stepZoom: vi.fn(),
    toggleReferencePanel: vi.fn(),
    togglePageSequence: vi.fn(),
    openProductionInsights: vi.fn(),
    toggleAnimationTimeline: vi.fn(),
    openScrollPreview: vi.fn(),
    openStoryboardGrid: vi.fn(),
    collapseSidePanels: vi.fn(),
    expandSidePanels: vi.fn(),
    openToolsCompanion: vi.fn(),
    toggleQuickAccessPalette: vi.fn(),
    toggleLeftPanel: vi.fn(),
    toggleRightPanel: vi.fn(),
    openShortcuts: vi.fn(),
    selectDrawMode: vi.fn(),
    enableSmartShape: vi.fn(),
    activateTransformTool: vi.fn(),
    openImageAdjustments: vi.fn(),
    openLayerMask: vi.fn(),
    openBrushPresetBrowser: vi.fn(),
    openBrushStudio: vi.fn(),
    openBrushLibrary: vi.fn(),
    requestBrushPackImport: vi.fn(),
    openNaturalMediaBrushes: vi.fn(),
    activatePixelSelectionTool: vi.fn(),
    enterQuickMask: vi.fn(),
    commitQuickMask: vi.fn(),
    openFrameAnimation: vi.fn(),
    toggleOnionSkin: vi.fn(),
    openAnimaticTimeline: vi.fn(),
    openTeamPanel: vi.fn(),
    toggleDocumentComments: vi.fn(),
    openPageReview: vi.fn(),
    openCheckpoints: vi.fn(),
    openWriterRoom: vi.fn(),
    openContinuityCheck: vi.fn(),
    openProductionBible: vi.fn(),
    openQuickStart: vi.fn(),
    openPublishPackage: vi.fn(),
    openPublishPreflight: vi.fn(),
    openAssetRightsAudit: vi.fn(),
    openAutoActions: vi.fn(),
    openCanvasNavigator: vi.fn(),
    openCanvasSettings: vi.fn(),
    toggleCanvasGrid: vi.fn(),
    toggleVectorEraseToIntersection: vi.fn(),
    openDialogueBatch: vi.fn(),
    openDialogueTranslate: vi.fn(),
    openLocalizationQa: vi.fn(),
    togglePixelArtMode: vi.fn(),
    insertDefaultStickyNote: vi.fn(),
    enableSilkSymmetry: vi.fn(),
    openSculptWorkbench: vi.fn(),
    startEphemeralWhiteboard: vi.fn(),
  };
}

describe("studio primary action reachability", () => {
  it("keeps draw/undo/pages/export in the shipped catalog, menu groups, and chrome selectors", () => {
    const reachability = listStudioPrimaryActionReachability();
    expect(reachability.map((entry) => entry.action)).toEqual([...STUDIO_PRIMARY_ACTION_IDS]);
    expect(studioPrimaryActionsPresentInCommandCatalog()).toEqual(
      reachability.map((entry) => entry.commandId),
    );
    expect(studioPrimaryActionsPresentInMenuInventory()).toEqual(
      reachability.map((entry) => entry.menuItemId),
    );

    const catalogIds = new Set(STUDIO_COMMAND_CATALOG.map((entry) => entry.id));
    for (const entry of reachability) {
      expect(catalogIds.has(entry.commandId), entry.commandId).toBe(true);
    }

    const groups = buildStudioMainMenuGroups({
      state: BASE_STATE,
      editor: createEditorActions(),
      ui: createUiActions(),
      t: (key) => key,
    });
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((group) => group.items.length > 0)).toBe(true);
    const menuItemIds = new Set(groups.flatMap((group) => group.items.map((item) => `${group.id}/${item.id}`)));
    for (const entry of reachability) {
      expect(menuItemIds.has(entry.menuItemId), entry.menuItemId).toBe(true);
    }

    const presentation = createStudioMainMenuPresentation(groups);
    expect(presentation.presentedGroupIds).toContain("brush");
    expect(presentation.presentedGroupIds).toContain("file");
    expect(presentation.presentedGroupIds).toContain("edit");

    const chrome = [
      readFileSync(new URL("./StudioLeftToolRail.tsx", import.meta.url), "utf8"),
      readFileSync(new URL("./StudioMenubarContent.tsx", import.meta.url), "utf8"),
      readFileSync(new URL("./StudioMobileEditingDock.tsx", import.meta.url), "utf8"),
    ].join("\n");
    expect(chrome).toContain('data-studio-primary-action="draw"');
    expect(chrome).toContain('data-studio-primary-action="undo"');
    expect(chrome).toContain('data-studio-primary-action="pages"');
    expect(chrome).toContain('data-studio-primary-action="export"');
    expect(STUDIO_PRIMARY_ACTION_SELECTORS.draw).toContain('data-studio-primary-action="draw"');
  });
});
