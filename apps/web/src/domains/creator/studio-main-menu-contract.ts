/**
 * Host contract for the main-menu catalogue.
 *
 * Split out of `studio-main-menu-groups.ts` when the catalogue was regrouped to
 * V5 §15.3 (17 groups): the per-group item modules need these types, and keeping
 * them here is what stops `groups → items → groups` from becoming a cycle.
 *
 * Pure types only — no React, no browser, no page state.
 */

import type { StudioFilterDraft, StudioFilterKind } from "./filter/studio-filter-menu";
import type { CvdMode } from "./studio-color-vision-model";
import type { DrawMode, StudioMenu } from "./studio-editor-tool-model";
import type {
  StudioMainMenuSurfaceActions,
  StudioMainMenuSurfaceState,
} from "./studio-main-menu-surface-contract";
import type { StudioUiDensityMode } from "./studio-ui-density";
import type { StudioViewRotation } from "./studio-view-controls";

export type StudioSaveMode = "draft" | "published";
export type StudioPastePlacement = "cascade" | "in-place";
export type StudioLayerReorder = "front" | "forward" | "back" | "backward";
export type StudioCanvasRotationDirection = "left" | "right";
export type StudioAppSettingsTab = "general" | "other";

export interface StudioMainMenuEditAvailability {
  undoDisabled: boolean;
  redoDisabled: boolean;
  cutDisabled: boolean;
  copyDisabled: boolean;
  pasteDisabled: boolean;
  selectAllDisabled: boolean;
  deselectDisabled: boolean;
  invertSelectionDisabled: boolean;
  clearSelectionDisabled: boolean;
  duplicateDisabled: boolean;
  reorderDisabled: boolean;
  cropLayerDisabled: boolean;
}

export interface StudioMainMenuBuilderState extends StudioMainMenuSurfaceState {
  sharedNonOwnerSave: boolean;
  saving: boolean;
  collaborationDocumentLocked: boolean;
  hasWorkId: boolean;
  projectArchiveBusy: boolean;
  interchangeImportBusy: boolean;
  psdImportBusy: boolean;
  edit: StudioMainMenuEditAvailability;
  filterDisabled: boolean;
  filterUnavailableReason: string | null;
  viewTransformSuppressed: boolean;
  canvasFlipH: boolean;
  canvasRotation: StudioViewRotation;
  fullscreen: boolean;
  canvasRulersVisible: boolean;
  colorVisionMode: CvdMode;
  referencePanelOpen: boolean;
  pageSequenceOpen: boolean;
  hasSavedView: boolean;
  perspectiveRulerActive: boolean;
  hasLocallyHiddenLayers: boolean;
  quickAccessPaletteOpen: boolean;
  quickAccessPaletteLoading: boolean;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  visibleLeftPanelOpen?: boolean;
  visibleRightPanelOpen?: boolean;
  /** 현재 패널 접힘 상태를 '넓게 보기' 토글 상태로 해석할지에 대한 보조 플래그. */
  canvasWideMode?: boolean;
  presentationPanelsHidden?: boolean;
  lastFilterDraft: StudioFilterDraft | null;
  /** Selected layer already clips into the one below it (`clipBelow`). */
  clippingMaskActive: boolean;
  /** No single clippable element is selected, so the clipping toggle has no target. */
  clippingMaskDisabled: boolean;
  /** An image layer is selected, so its mask and adjustment panels have a target. */
  imageLayerSelected: boolean;
  /**
   * §15.3 Help ▸ Current Tool Help — the catalog command id of whatever owns the
   * canvas pointer right now (`studio-current-tool-help.ts` resolves it). `null`
   * when the host cannot tell; the help surface then says so instead of guessing.
   */
  activeToolCommandId: string | null;
}

export interface StudioMainMenuEditorActions {
  copyImageToClipboard: () => unknown;
  save: (mode: StudioSaveMode) => unknown;
  exportProject: () => unknown;
  exportProjectArchive: () => unknown;
  undo: () => unknown;
  redo: () => unknown;
  cutSelectedElements: () => unknown;
  copySelectedElements: () => unknown;
  pasteElements: (placement: StudioPastePlacement) => unknown;
  openImagePastePicker: () => unknown;
  selectAll: () => unknown;
  deselect: () => unknown;
  invertSelection: () => unknown;
  clearSelection: () => unknown;
  duplicateSelected: () => unknown;
  reorder: (placement: StudioLayerReorder) => unknown;
  openSelectedLayerCrop: () => unknown;
  /** Flips `clipBelow` on the selected layer — the inspector checkbox's command path. */
  toggleClippingMask: () => unknown;
  addText: () => unknown;
  addPage: () => unknown;
  toggleHorizontalCanvasView: () => unknown;
  rotateCanvasView: (direction: StudioCanvasRotationDirection) => unknown;
  resetCanvasViewRotation: () => unknown;
  fitCanvasToWidth: () => unknown;
  setActualPixelView: () => unknown;
  toggleFullscreen: () => unknown;
  toggleCanvasRulers: () => unknown;
  setColorVisionMode: (mode: CvdMode) => unknown;
  saveCurrentStudioView: () => unknown;
  restoreSavedStudioView: () => unknown;
  togglePerspectiveGuideView: () => unknown;
  showAllLocallyHiddenLayers: () => unknown;
  setStudioUiDensity: (mode: StudioUiDensityMode) => unknown;
  enterCanvasOnlyMode: () => unknown;
  openFeatureTutorial: () => unknown;
  openStudioFilter: (
    kind: StudioFilterKind,
    draft?: StudioFilterDraft,
  ) => unknown;
  toggleAdvancedFill: () => unknown;
}

export interface StudioMainMenuUiActions extends StudioMainMenuSurfaceActions {
  openExportDownload: () => unknown;
  requestProjectImport: () => unknown;
  requestInterchangeImport: () => unknown;
  requestPsdImport: () => unknown;
  openProjectTools: () => unknown;
  toggleHistoryPanel: () => unknown;
  openAppSettings: (tab?: StudioAppSettingsTab) => unknown;
  openStudioMenu: (menu: StudioMenu) => unknown;
  openAssetMenu: () => unknown;
  requestImageInsert: () => unknown;
  openMannequinPoser: () => unknown;
  openReferencePanel: () => unknown;
  stepZoom: (direction: -1 | 1) => unknown;
  toggleReferencePanel: () => unknown;
  togglePageSequence: () => unknown;
  openProductionInsights: () => unknown;
  collapseSidePanels: () => unknown;
  /**
   * Inverse of `collapseSidePanels`, for the surfaces that promise a way back. 창 ▸ 전체 레이아웃
   * only restored UI density, so from the super-simple state it measurably did nothing — the
   * panels the collapse had closed stayed closed and the artist read the menu item as broken.
   */
  expandSidePanels: () => unknown;
  openToolsCompanion: () => unknown;
  toggleQuickAccessPalette: () => unknown;
  toggleLeftPanel: () => unknown;
  toggleRightPanel: () => unknown;
  /** 왼쪽/오른쪽 도크를 함께 접고 펼쳐 캔버스 활용 폭을 극대화. */
  toggleCanvasWideMode?: () => unknown;
  openShortcuts: () => unknown;
  selectDrawMode: (mode: Extract<DrawMode, "pen" | "eraser">) => unknown;
  enableSmartShape: () => unknown;
  /** Free-transform / pixel-selection transform, whatever the selection turns out to be. */
  activateTransformTool: () => unknown;
  /** Inspector 보정 섹션 — where Levels and the tone curve actually live. */
  openImageAdjustments: () => unknown;
  /** Inspector 마스크 섹션. */
  openLayerMask: () => unknown;
  /** §15.3 Brush ▸ Preset Browser — the searchable built-in brush catalogue. */
  openBrushPresetBrowser: () => unknown;
  /** §15.3 Brush ▸ Brush Studio — the dynamics editor inside the inspector. */
  openBrushStudio: () => unknown;
  /** The saved "내 브러시" library, whose import control accepts ABR/MYB/KPP. */
  openBrushLibrary: () => unknown;
  /** §15.3 Brush ▸ Import — opens the ABR/MYB/KPP/JSON picker with no detour. */
  requestBrushPackImport: () => unknown;
  /** §15.3 Brush ▸ Natural Media — the hokusai natural-media engines section. */
  openNaturalMediaBrushes: () => unknown;
}

/** What every per-group item module receives. Read-only projection of the host. */
export interface StudioMainMenuItemContext {
  readonly state: StudioMainMenuBuilderState;
  readonly editor: StudioMainMenuEditorActions;
  readonly ui: StudioMainMenuUiActions;
}

export interface BuildStudioMainMenuGroupsInput {
  state: StudioMainMenuBuilderState;
  editor: StudioMainMenuEditorActions;
  ui: StudioMainMenuUiActions;
  t: (key: string) => string;
}
