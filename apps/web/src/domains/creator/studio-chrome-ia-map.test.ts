import { describe, expect, it, vi } from "vitest";

import { DEFAULT_STUDIO_RAIL_TOOL_ORDER } from "./studio-app-settings";
import {
  auditStudioChromeMenubarAgainstIa,
  resolveStudioChromeInspectorPropertySurface,
  STUDIO_CHROME_DEFAULT_RAIL_TOOL_ORDER,
  STUDIO_CHROME_FILE_CORE_ACTION_IDS,
  STUDIO_CHROME_FILE_MENU_ITEM_ORDER,
  STUDIO_CHROME_MENUBAR_GROUP_LABELS,
  STUDIO_CHROME_MENUBAR_GROUP_ORDER,
  STUDIO_CHROME_RAIL_TOOL_GROUPS,
  STUDIO_CHROME_REGION_ORDER,
  studioChromeEditCommandOrderIncludesCore,
  studioChromeMenubarGroupIds,
  studioChromeRailCatalogMatchesIaGroups,
  studioChromeRailGroupLabel,
  studioChromeRegionIds,
} from "./studio-chrome-ia-map";
import {
  buildStudioMainMenuGroups,
  type StudioMainMenuBuilderState,
  type StudioMainMenuEditAvailability,
  type StudioMainMenuEditorActions,
  type StudioMainMenuUiActions,
} from "./studio-main-menu-groups";

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

function buildLiveMenuGroups() {
  const editor = {
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
  } satisfies StudioMainMenuEditorActions;

  const ui = {
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
  } satisfies StudioMainMenuUiActions;

  return buildStudioMainMenuGroups({
    state: BASE_STATE,
    editor,
    ui,
    t: (key) => key,
  });
}

describe("studio chrome IA map", () => {
  it("exposes CSP/PPT-style region order: menubar, left tools, canvas, right properties", () => {
    expect(studioChromeRegionIds()).toEqual([
      "menubar",
      "left-tool-rail",
      "canvas",
      "right-inspector",
      "status-quick-actions",
    ]);
    expect(STUDIO_CHROME_REGION_ORDER[0]).toBe("menubar");
    expect(STUDIO_CHROME_REGION_ORDER[1]).toBe("left-tool-rail");
    expect(STUDIO_CHROME_REGION_ORDER[3]).toBe("right-inspector");
  });

  it("keeps familiar menubar group labels and file/edit/view/tool vocabulary", () => {
    expect(studioChromeMenubarGroupIds()).toEqual([...STUDIO_CHROME_MENUBAR_GROUP_ORDER]);
    expect(STUDIO_CHROME_MENUBAR_GROUP_LABELS.file).toBe("파일");
    expect(STUDIO_CHROME_MENUBAR_GROUP_LABELS.edit).toBe("편집");
    expect(STUDIO_CHROME_MENUBAR_GROUP_LABELS.view).toBe("보기");
    // §15.3 renamed the group id to `brush`; the Korean copy stays "그리기".
    expect(STUDIO_CHROME_MENUBAR_GROUP_LABELS.brush).toBe("그리기");
    expect(STUDIO_CHROME_MENUBAR_GROUP_LABELS.layer).toBe("레이어");
    expect(STUDIO_CHROME_MENUBAR_GROUP_LABELS.select).toBe("선택");
    expect(STUDIO_CHROME_FILE_CORE_ACTION_IDS).toEqual(
      expect.arrayContaining(["save-draft", "import-json", "export"]),
    );
  });

  it("resolves rail group divider captions from the IA map", () => {
    expect(studioChromeRailGroupLabel("draw")).toBe("그리기");
    expect(studioChromeRailGroupLabel("paint-retouch")).toBe("채색·보정");
    expect(studioChromeRailGroupLabel("selection")).toBe("선택 범위");
    expect(studioChromeRailGroupLabel("unknown-group")).toBeUndefined();
    for (const group of STUDIO_CHROME_RAIL_TOOL_GROUPS) {
      expect(studioChromeRailGroupLabel(group.id)).toBe(group.labelKo);
    }
  });

  it("aligns default rail order with IA groups and the live catalog", () => {
    const match = studioChromeRailCatalogMatchesIaGroups();
    expect(match.missingFromGroups, String(match.missingFromGroups)).toEqual([]);
    expect(match.extraInGroups, String(match.extraInGroups)).toEqual([]);
    expect(match.ok).toBe(true);
    expect(match.orderMatchesDefault).toBe(true);
    expect(DEFAULT_STUDIO_RAIL_TOOL_ORDER).toEqual([...STUDIO_CHROME_DEFAULT_RAIL_TOOL_ORDER]);
    const pen = DEFAULT_STUDIO_RAIL_TOOL_ORDER.indexOf("pen");
    const select = DEFAULT_STUDIO_RAIL_TOOL_ORDER.indexOf("select");
    const transform = DEFAULT_STUDIO_RAIL_TOOL_ORDER.indexOf("transform");
    const vrm = DEFAULT_STUDIO_RAIL_TOOL_ORDER.indexOf("vrm3d");
    expect(select).toBeLessThan(pen);
    expect(pen).toBeLessThan(transform);
    expect(transform).toBeLessThan(vrm);
  });

  it("audits live buildStudioMainMenuGroups against the IA map (real entry point)", () => {
    const groups = buildLiveMenuGroups();
    const audit = auditStudioChromeMenubarAgainstIa(groups);
    expect(audit.groupOrderOk, "group order").toBe(true);
    expect(audit.missingFileCore, String(audit.missingFileCore)).toEqual([]);
    expect(audit.missingEditCore, String(audit.missingEditCore)).toEqual([]);
    expect(audit.missingLayerCore, String(audit.missingLayerCore)).toEqual([]);
    expect(audit.missingSelectCore, String(audit.missingSelectCore)).toEqual([]);
    expect(
      audit.fileOrderOk,
      `file order ${groups.find((g) => g.id === "file")?.items.map((i) => i.id).join(",")}`,
    ).toBe(true);
    expect(audit.ok).toBe(true);
    expect(groups.find((g) => g.id === "file")?.items.map((i) => i.id)).toEqual([
      ...STUDIO_CHROME_FILE_MENU_ITEM_ORDER,
    ]);
    expect(studioChromeEditCommandOrderIncludesCore()).toBe(true);
  });

  it("resolves context property surfaces for pen/brush and selection without hunting menus", () => {
    const pen = resolveStudioChromeInspectorPropertySurface({ kind: "drawing", drawMode: "pen" });
    expect(pen.primarySection).toBe("properties");
    expect(pen.testId).toBe("studio-inspector-context-drawing");
    expect(pen.requiredControlLabels).toEqual(expect.arrayContaining(["펜", "그리기 도구 설정"]));

    const pixel = resolveStudioChromeInspectorPropertySurface({ kind: "drawing", drawMode: "pixel" });
    expect(pixel.requiredControlLabels).toEqual(expect.arrayContaining(["픽셀 펜"]));

    const text = resolveStudioChromeInspectorPropertySurface({
      kind: "selection",
      selectedType: "text",
    });
    expect(text.testId).toBe("studio-inspector-context-selection");
    expect(text.requiredControlLabels).toEqual(expect.arrayContaining(["불투명도"]));

    const stroke = resolveStudioChromeInspectorPropertySurface({
      kind: "selection",
      selectedType: "draw",
    });
    expect(stroke.requiredControlLabels).toEqual(expect.arrayContaining(["선 두께", "불투명도"]));
  });
});
