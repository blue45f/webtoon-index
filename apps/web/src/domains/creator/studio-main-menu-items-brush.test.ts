import { describe, expect, it, vi } from "vitest";

import { buildStudioBrushMenuItems } from "./studio-main-menu-items-brush";

import type {
  StudioMainMenuBuilderState,
  StudioMainMenuEditAvailability,
  StudioMainMenuEditorActions,
  StudioMainMenuUiActions,
} from "./studio-main-menu-contract";

const AVAILABLE_EDIT: StudioMainMenuEditAvailability = {
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
  edit: AVAILABLE_EDIT,
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

describe("buildStudioBrushMenuItems", () => {
  it("exposes pixel-art and silk rows that call the shipped host actions", () => {
    const ui = {
      togglePixelArtMode: vi.fn(),
      enableSilkSymmetry: vi.fn(),
      openBrushStudio: vi.fn(),
    } as unknown as StudioMainMenuUiActions;
    const editor = {} as StudioMainMenuEditorActions;
    const items = buildStudioBrushMenuItems({
      state: BASE_STATE,
      editor,
      ui,
    });

    const pixel = items.find((item) => item.id === "pixel-art");
    const silk = items.find((item) => item.id === "silk-flow");
    const studio = items.find((item) => item.id === "brush-studio");
    expect(pixel?.commandId).toBe("brush.pixel-art");
    expect(pixel?.label).toBe("픽셀 아트");
    expect(pixel?.selectionRole).toBe("checkbox");
    expect(silk?.commandId).toBe("brush.silk-flow");
    expect(studio?.commandId).toBe("brush.studio");

    pixel?.onSelect();
    silk?.onSelect();
    studio?.onSelect();
    expect(ui.togglePixelArtMode).toHaveBeenCalledTimes(1);
    expect(ui.enableSilkSymmetry).toHaveBeenCalledTimes(1);
    expect(ui.openBrushStudio).toHaveBeenCalledTimes(1);
  });

  it("checks the pixel-art row when the host has the mode on", () => {
    const items = buildStudioBrushMenuItems({
      state: { ...BASE_STATE, pixelArtEnabled: true },
      editor: {} as StudioMainMenuEditorActions,
      ui: { togglePixelArtMode: vi.fn() } as unknown as StudioMainMenuUiActions,
    });
    const pixel = items.find((item) => item.id === "pixel-art");
    expect(pixel?.checked).toBe(true);
    expect(pixel?.label).toBe("픽셀 아트 끄기");
  });
});
