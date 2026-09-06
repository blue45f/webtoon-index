import type { StudioAiSettings } from "./ai/studio-ai-client";
import type { StudioBg3dSceneDocument } from "./bg3d/studio-bg3d-scene-document";
import type {
  StudioBrushDefaultRestoreDirection,
  StudioBrushDefaultRestoreTransaction,
} from "./brush/studio-brush-default-restore";
import type {
  NormalizedStudioBrushDynamicsSettings,
  StudioBrushDynamicsPresetId,
} from "./brush/studio-brush-dynamics";
import type { StudioBrushEngineProgramSet } from "./brush/studio-brush-engine-program-set";
import type {
  DeletedBrushRecord,
  StudioBrushSnapshot,
  StudioSavedBrush,
} from "./brush/studio-brush-library";
import type { ProductBrushLibraryRepository } from "./brush/studio-brush-library-sqlite-repository";
import type { StudioDrawingPaletteLayout } from "./brush/studio-drawing-palettes";
import type { PaperGrainKind } from "./brush/studio-paper-texture";
import type { FilterMaskPaintMode } from "./filter/studio-filter-mask";
import type { StudioFilterKind } from "./filter/studio-filter-menu";
import type { LayerMaskPaintMode } from "./layer/studio-layer-mask";
import type { StudioLayerNavigatorItem } from "./layer/studio-layer-navigator";
import type { StudioLayerNavigatorAction } from "./layer/StudioLayerNavigator";
import type { BubbleShapeGeometry } from "./lettering/studio-bubble-custom-shape";
import type { ImageFilterFields } from "./render/studio-konva-filter-fields";
import type { StudioRasterToolId } from "./render/studio-raster-tool-availability";
import type { StudioAdvancedFillPreview } from "./studio-advanced-fill-preview";
import type { StudioAdvancedFillSettings } from "./studio-advanced-fill-settings";
import type {
  StudioAdvancedRuler,
  StudioAdvancedRulerDocument,
} from "./studio-advanced-ruler-document";
import type { BgPreset, TemplateSpec } from "./studio-assets";
import type { BrushPreset } from "./studio-brush";
import type { ColorRangeSample } from "./studio-color-range";
import type { CropAspectId, CropRect } from "./studio-crop";
import type {
  DodgeBurnMode,
  DodgeBurnRange,
  DodgeBurnSpongeMode,
} from "./studio-dodge-burn";
import type { DrawMode, DrawShapeKind, StudioMenu, Tool } from "./studio-editor-tool-model";
import type { StudioEffectFavoriteState, StudioEffectId } from "./studio-effect-favorites";
import type { El } from "./studio-element-model";
import type { StudioExtendedBlendModeId } from "./studio-extended-blend";
import type { StudioFigmaSelectionLayoutPatch } from "./studio-figma-selection-ux";
import type { HealCloneMode } from "./studio-heal-clone";
import type { StudioInspectorLayout } from "./studio-inspector-layout";
import type { StudioIsometricPrimitiveSpec } from "./studio-isometric-primitive-contract";
import type { LayerGroup } from "./studio-layers";
import type { StudioLiquifyMode } from "./studio-liquify-contract";
import type { MagicResizePreset, MagicResizeStrategy } from "./studio-magic-resize";
import type { StudioMobileSheetSnap } from "./studio-mobile-sheet-snap";
import type { NodeEditHandle, NodeEditTool } from "./studio-node-edit";
import type { PageGrade } from "./studio-page-grade";
import type { PageState } from "./studio-page-state";
import type { StudioPathBooleanOp } from "./studio-path-boolean";
import type { VanishingPoint } from "./studio-perspective-guide";
import type { PixelSelectionHistoryOperation } from "./studio-pixel-selection-history";
import type { PuppetPin } from "./studio-puppet-warp";
import type { QuickMaskBrushMode } from "./studio-quick-mask";
import type { StudioScrollViewportStore } from "./studio-scroll-viewport-store";
import type {
  PixelSelection,
  PolyLassoSession,
  SelPoint,
  SelectionAdjustPlan,
  SelectionContentTransform,
  SelectionOperationMode,
  SelectionToolKind,
} from "./studio-selection-tools";
import type { StudioViewRotation } from "./studio-view-controls";
import type { StudioHokusaiNaturalMediaReplaceHandler } from "./StudioHokusaiNaturalMediaInspectorMount";
import type { StudioMobileSheet } from "./StudioMobileEditingDock";
import type { StudioInspectorPixelSelectionToolId } from "./StudioRasterToolRecoveryPanel";
import type { Resizable } from "@/src/hooks/use-resizable";

export interface StudioInspectorAsideHandlers {
  activateCanvasTool: (tool: "select" | "draw", drawMode?: DrawMode) => void;
  activatePixelSelectionToolFromInspector: (
    kind: StudioInspectorPixelSelectionToolId,
  ) => void;
  addProceduralArtisticBrushRaster: (src: string, width: number, height: number, name: string, targetPageId: string, targetMasterEditMode: boolean) => boolean;
  replaceDrawWithHokusaiNaturalMedia: StudioHokusaiNaturalMediaReplaceHandler;
  addAdvancedRuler: (type: StudioAdvancedRuler["type"]) => void;
  addBubbleShapePointFromInspector: () => void;
  addFilterMask: (fill: FilterMaskPaintMode) => void;
  addLayerGroup: (seedElId?: string) => void;
  addLayerMask: (fill: LayerMaskPaintMode) => void;
  createLayerMaskFromSelection: (outside: boolean) => void;
  addVanishingPointHandler: () => void;
  alignSelected: (mode: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" | "distributeH" | "distributeV") => void;
  zoomToSelection: () => void;
  flipSelected: (axis: "horizontal" | "vertical") => void;
  applyFigmaSelectionLayoutPatch: (patch: StudioFigmaSelectionLayoutPatch) => void;
  announceDrawingShortcut: (message: string) => void;
  applyBgPreset: (p: BgPreset) => void;
  /** 엔진 조합 변경 — 브러시 스튜디오의 조합 탭이 호출한다. */
  onBrushEngineProgramsChange?: (next: StudioBrushEngineProgramSet | null) => void;
  applyBrushDefaultRestoreTransaction: (
    transaction: StudioBrushDefaultRestoreTransaction,
    direction: StudioBrushDefaultRestoreDirection,
  ) => void;
  /**
   * CSP식 서브 도구 팔레트가 코어 카탈로그 프리셋을 원자적으로 적용할 때 쓴다.
   * StudioPage의 `applyBuiltInBrushPreset`(카탈로그 선택 → 도구 전환까지 한 트랜잭션)을
   * 그대로 배선한다 — 미배선 시 팔레트는 렌더되지 않는다(반쪽 동작 금지).
   */
  applyBuiltInBrushPreset?: (preset: BrushPreset) => void;
  applyContentAwareFill: () => Promise<void>;
  extractPixelSelectionToLayer: (mode: "copy" | "cut") => Promise<void>;
  applyCropToSelectedImage: () => Promise<void>;
  applyDynamicsPreset: (id: StudioBrushDynamicsPresetId, settings: NormalizedStudioBrushDynamicsSettings) => void;
  applyMagicResizePreset: (preset: MagicResizePreset) => void;
  applyPageGrade: (grade: PageGrade) => void;
  applyPixelSelectionAdjust: (plan: SelectionAdjustPlan) => Promise<void>;
  applyPixelSelectionContentTransform: (transform: SelectionContentTransform) => Promise<void>;
  applyPuppetWarpToSelectedImage: () => Promise<void>;
  applySavedBrush: (saved: StudioSavedBrush) => void;
  assignElementToGroup: (elId: string, groupId: string | undefined) => void;
  changeDrawingPaletteLayout: (next: StudioDrawingPaletteLayout) => void;
  changeInspectorLayout: (next: StudioInspectorLayout) => void;
  clearHealCloneSource: () => void;
  clearPolyLassoDraft: () => void;
  commit: (nextElements: El[], extraPatch?: Partial<Omit<PageState, "id" | "elements">>, targetPageId?: string) => boolean;
  createEditableRasterCopyForInspector: (resumeToolId?: StudioRasterToolId) => Promise<void>;
  deleteFilterMask: () => void;
  deleteLayerMask: () => void;
  detachBubbleAnchor: () => void;
  disarmAllPixelTools: () => void;
  duplicateSelected: () => void;
  ensureRecentColorsLoaded: () => void;
  ensureWebtoonGuidesLoaded: () => void;
  fitBubbleToText: () => Promise<void>;
  fitSelectedToFrame: () => Promise<void>;
  handleLayerNavigatorAction: (action: StudioLayerNavigatorAction) => void;
  invertFilterMask: () => void;
  invertLayerMask: () => void;
  insertIsometricPrimitive: (spec: StudioIsometricPrimitiveSpec) => Promise<void>;
  insertIsometricSolid: () => void;
  patchAdvancedRuler: (id: string, patch: Partial<StudioAdvancedRuler>) => void;
  moveVanishingPointById: (id: string, x: number, y: number) => void;
  previewVanishingPointById: (id: string, x: number, y: number) => void;
  setPerspectiveEyeLevelY: (y: number) => void;
  previewPerspectiveEyeLevelY: (y: number) => void;
  setPerspectiveLockHorizon: (next: boolean) => void;
  alignPerspectiveToEyeLevel: () => void;
  previewIsometricOrigin: (x: number, y: number) => void;
  commitIsometricOrigin: (x: number, y: number) => void;
  onColorizeSelected: () => void;
  onMinimapClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMinimapKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  openBrushCatalog: (trigger: HTMLButtonElement) => void;
  openFeatureTutorial: (tutorialId?: string | null) => void;
  openImagePastePicker: () => void;
  openStudioLayerLift: () => void;
  openStudioFilter: (kind: StudioFilterKind) => void;
  patchEl: (id: string, patch: Partial<El>) => void;
  patchPageGrade: (patch: Partial<PageGrade>) => void;
  queueBrushDelete: (deleted: DeletedBrushRecord) => void;
  regenerateTemplate: (
    tpl: TemplateSpec,
    gutter: number,
    currentEls?: El[],
  ) => El[] | null;
  rememberColor: (c: string) => void;
  rememberEffectRecent: (effectId: StudioEffectId) => void;
  removeSelected: () => void;
  removeAdvancedRuler: (id: string) => void;
  removeBubbleShapePointFromInspector: () => void;
  removeVanishingPointHandler: (id: string) => void;
  reorder: (dir: "front" | "back" | "forward" | "backward") => void;
  resetIsometricOrigin: () => void;
  resetPageGrade: () => void;
  selectLayersFromNavigator: (ids: readonly string[]) => void;
  selectAdvancedRuler: (id: string | null) => void;
  setActiveAdvancedRuler: (id: string | null) => void;
  setBg: (newBg: string | ((prev: string) => string)) => void;
  setBgGrad: (newGrad: string[] | null | ((prev: string[] | null) => string[] | null)) => void;
  setCanvasH: (newH: number | ((prev: number) => number)) => void;
  setPaperGrainKind: (kind: PaperGrainKind) => void;
  setPaperGrainVisible: (visible: boolean) => void;
  applyPaperTintBackground: () => void;
  setDescription: (next: Parameters<import("react").Dispatch<import("react").SetStateAction<string>>>[0]) => void;
  setDrawingPaletteDragging: (dragging: boolean) => void;
  setIsometricAngleDegClamped: (next: number) => void;
  setIsometricCellSizeClamped: (next: number) => void;
  previewIsometricAngleDegClamped: (next: number) => void;
  previewIsometricCellSizeClamped: (next: number) => void;
  setPanelGutter: (next: Parameters<import("react").Dispatch<import("react").SetStateAction<number>>>[0]) => void;
  setTagsText: (next: Parameters<import("react").Dispatch<import("react").SetStateAction<string>>>[0]) => void;
  setTitle: (next: Parameters<import("react").Dispatch<import("react").SetStateAction<string>>>[0]) => void;
  setWebtoonTheme: (next: Parameters<import("react").Dispatch<import("react").SetStateAction<"classic" | "soft" | "vivid">>>[0]) => void;
  splitFrameSelected: (orientation: "horizontal" | "vertical") => void;
  stopTimeline: () => void;
  startEditText: (id: string) => void;
  toggleAdvancedFill: () => void;
  toggleBubbleAnchorPick: () => void;
  toggleLiquifyTool: () => void;
  toggleSmudgeTool: () => void;
  toggleDodgeBurnTool: () => void;
  toggleWetMixTool: () => void;
  toggleEffectFavorite: (effectId: StudioEffectId) => void;
  toggleIsometricGridActive: () => void;
  toggleFilterMaskEnabled: () => void;
  toggleLayerMaskEnabled: () => void;
  toggleLocalHidden: (id: string) => void;
  toggleLayerSolo: (id: string) => void;
  updateAdvancedFillSettings: (next: StudioAdvancedFillSettings) => void;
}

export interface StudioInspectorAsideProps {
  activeSavedBrushId: string | null;
  advancedRulers: StudioAdvancedRulerDocument;
  activeSurfaceReviewLocked: boolean;
  advancedFillActive: boolean;
  advancedFillBusy: boolean;
  advancedFillPreview: StudioAdvancedFillPreview | null;
  advancedFillReferenceLayerCount: number;
  advancedFillSettings: StudioAdvancedFillSettings;
  advancedFillStatus: string | null;
  advancedFillUnsupportedReason: string | null;
  advancedFillVisibleRasterCount: number;
  aiColorizeBusy: boolean;
  aiColorizeError: string | null;
  aiColorizePrompt: string;
  aiSettings: StudioAiSettings;
  bg: string;
  bgGrad: string[] | null;
  brush: string;
  brushDynamics: NormalizedStudioBrushDynamicsSettings;
  brushOpacity: number;
  bubbleAnchorPickActive: boolean;
  bubbleShapeArmed: boolean;
  bubbleShapeEditActive: boolean;
  bubbleShapeHandles: NodeEditHandle[];
  bubbleShapeSelectedPointIndex: number | null;
  canvasFlipH: boolean;
  canvasH: number;
  canvasRotation: StudioViewRotation;
  collaborationDocumentLocked: boolean;
  paperGrainKind: PaperGrainKind;
  paperGrainVisible: boolean;
  color: string;
  colorRangeFuzziness: number;
  colorRangePickActive: boolean;
  colorRangePreviewEnabled: boolean;
  colorRangeSamples: readonly ColorRangeSample[];
  quickMaskActive: boolean;
  quickMaskBrushMode: QuickMaskBrushMode;
  quickMaskHardness: number;
  quickMaskOpacity: number;
  quickMaskRadius: number;
  quickMaskTintColor: string;
  quickMaskTintOpacity: number;
  cropAspect: CropAspectId;
  cropBusy: boolean;
  cropRect: CropRect | null;
  currentBrushSnapshot: StudioBrushSnapshot;
  currentPageId: string;
  currentTemplate: TemplateSpec | null;
  description: string;
  drawMode: DrawMode;
  drawShape: DrawShapeKind;
  drawingPaletteCancelEpoch: number;
  drawingPaletteLayout: StudioDrawingPaletteLayout;
  effectFavoriteState: StudioEffectFavoriteState;
  effScale: number;
  elementById: Map<string, El>;
  elements: El[];
  eyedropperActive: boolean;
  filterClipboard: Partial<ImageFilterFields> | null;
  gridSize: number;
  groups: LayerGroup[];
  healCloneAligned: boolean;
  healCloneBusy: boolean;
  healCloneHardness: number;
  healCloneOpacity: number;
  healCloneRadius: number;
  healCloneSourceAnchor: SelPoint | null;
  healCloneTool: HealCloneMode | null;
  historyBrushActive: boolean;
  historyBrushBusy: boolean;
  historyBrushHardness: number;
  historyBrushOpacity: number;
  historyBrushRadius: number;
  historyBrushSourceSrc: string | null;
  historyPanelOpen: boolean;
  inspectorLayout: StudioInspectorLayout;
  isMobile: boolean;
  isometricAngleDeg: number;
  isometricCellSize: number;
  isometricGridActive: boolean;
  isometricOriginX: number;
  isometricOriginY: number;
  filterMaskBusy: boolean;
  filterMaskHardness: number;
  filterMaskPaintActive: boolean;
  filterMaskPaintMode: FilterMaskPaintMode;
  filterMaskRadius: number;
  filterMaskStrength: number;
  selectedImageHasActiveFilters: boolean;
  layerMaskBusy: boolean;
  layerMaskHardness: number;
  layerMaskPaintActive: boolean;
  layerMaskPaintMode: LayerMaskPaintMode;
  layerMaskRadius: number;
  layerMaskStrength: number;
  layerNavigatorItems: StudioLayerNavigatorItem[];
  localHiddenElementIds: ReadonlySet<string>;
  soloLayerId: string | null;
  liquifyActive: boolean;
  liquifyBusy: boolean;
  liquifyMode: StudioLiquifyMode;
  liquifyRadius: number;
  liquifyStrength: number;
  liveDraftShapeKind: DrawShapeKind | "freehand" | null | undefined;
  magicResizeStrategy: MagicResizeStrategy;
  marqueeIds: string[];
  masterEditMode: boolean;
  mobileKeyboardInset: number;
  mobileInspectorSnap: StudioMobileSheetSnap;
  mobileSheet: StudioMobileSheet;
  nodeEditHandles: NodeEditHandle[];
  nodeEditTool: NodeEditTool | null;
  nodeSmoothStrength: number;
  pageGrade: PageGrade;
  pageGradeActive: boolean;
  pageGradePanelOpen: boolean;
  panelGutter: number;
  panelSplitActive: boolean;
  panelSplitHint: string | null;
  panelSplitRatio: number;
  perspectiveRulerActive: boolean;
  perspectiveEyeLevelY: number | null;
  perspectiveLockHorizon: boolean;
  pixelBrushRadius: number;
  pixelBusy: boolean;
  pixelCombine: SelectionOperationMode;
  pixelForceCircle: boolean;
  pixelMagneticLasso: boolean;
  onTogglePixelMagneticLasso: () => void;
  pixelSel: PixelSelection | null;
  pixelSelectionCanRedo: boolean; pixelSelectionCanUndo: boolean;
  pixelTool: SelectionToolKind | "wand" | null;
  polyLassoSession: PolyLassoSession | null;
  postCorrection: number;
  preserveCorners: boolean;
  pressureCurve: number;
  pressureMinSize?: number;
  setPressureMinSize?: (value: number) => void;
  propsSheetRef: import("react").RefObject<HTMLElement | null>;
  puppetWarpActive: boolean;
  puppetWarpBusy: boolean;
  puppetWarpPins: PuppetPin[];
  quickShapeActive: boolean;
  recentColors: string[];
  rightResize: Resizable;
  savedBrushes: StudioSavedBrush[];
  /** Page-owned product authority shared with imports and the mobile projection. */
  openBrushLibraryRepository?: () => Promise<ProductBrushLibraryRepository>;
  saving: boolean;
  studioFilterPreparationBusy: boolean;
  studioLayerLiftDisabledReason: string | null;
  /**
   * Live canvas scroll offset. The minimap viewport box tracks the scroll at
   * frame rate, so it subscribes to this store instead of re-rendering the whole
   * aside from a `StudioPage` state value once per pan frame.
   */
  scrollViewportStore: StudioScrollViewportStore;
  selected: El | null;
  selectedBg3dEditSource: { readonly scene?: StudioBg3dSceneDocument; readonly legacyDataUrl?: string; } | null;
  selectedBubbleTailGeometry: BubbleShapeGeometry | null;
  selectedContentMutationLocked: boolean;
  selectedId: string | null;
  selectedRasterSource: string | null;
  selectedWorkAssetDestructiveEditReason: string | null;
  setSelectedId: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  autoColorScribbleCanvasArmed?: boolean;
  setAutoColorScribbleCanvasArmed?: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  autoColorCanvasSeedHit?: { x: number; y: number; nonce: number } | null;
  setAutoColorCanvasSeedHit?: import("react").Dispatch<
    import("react").SetStateAction<{ x: number; y: number; nonce: number } | null>
  >;
  autoColorCanvasSeedHits?: readonly { x: number; y: number; nonce: number }[] | null;
  setAutoColorCanvasSeedHits?: import("react").Dispatch<
    import("react").SetStateAction<readonly { x: number; y: number; nonce: number }[] | null>
  >;
  onAutoColorPlanImageSize?: (size: { width: number; height: number } | null) => void;
  setAdvancedFillPreview: import("react").Dispatch<import("react").SetStateAction<StudioAdvancedFillPreview | null>>;
  setAdvancedFillStatus: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  setAiColorizePrompt: import("react").Dispatch<import("react").SetStateAction<string>>;
  setBg3dInitialDataUrl: import("react").Dispatch<import("react").SetStateAction<string | undefined>>;
  setBg3dInitialElementId: import("react").Dispatch<import("react").SetStateAction<string | undefined>>;
  setBg3dInitialScene: import("react").Dispatch<import("react").SetStateAction<StudioBg3dSceneDocument | undefined>>;
  setBg3dOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setBrushDynamics: import("react").Dispatch<import("react").SetStateAction<NormalizedStudioBrushDynamicsSettings>>;
  setBrushOpacity: import("react").Dispatch<import("react").SetStateAction<number>>;
  setBubbleShapeEditActive: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setColor: import("react").Dispatch<import("react").SetStateAction<string>>;
  setCropAspect: import("react").Dispatch<import("react").SetStateAction<CropAspectId>>;
  setCropRect: import("react").Dispatch<import("react").SetStateAction<CropRect | null>>;
  setDrawShape: import("react").Dispatch<import("react").SetStateAction<DrawShapeKind>>;
  setEyedropperActive: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setFilterClipboard: import("react").Dispatch<import("react").SetStateAction<Partial<ImageFilterFields> | null>>;
  setGridSize: import("react").Dispatch<import("react").SetStateAction<number>>;
  setHealCloneAligned: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setHealCloneHardness: import("react").Dispatch<import("react").SetStateAction<number>>;
  setHealCloneOpacity: import("react").Dispatch<import("react").SetStateAction<number>>;
  setHealCloneRadius: import("react").Dispatch<import("react").SetStateAction<number>>;
  setHealCloneTool: import("react").Dispatch<import("react").SetStateAction<HealCloneMode | null>>;
  setHistoryBrushActive: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setHistoryBrushHardness: import("react").Dispatch<import("react").SetStateAction<number>>;
  setHistoryBrushOpacity: import("react").Dispatch<import("react").SetStateAction<number>>;
  setHistoryBrushRadius: import("react").Dispatch<import("react").SetStateAction<number>>;
  setHistoryBrushSourceIndex: import("react").Dispatch<import("react").SetStateAction<number | null>>;
  setHistoryBrushSourceSrc: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  setHistoryPanelOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setFilterMaskHardness: import("react").Dispatch<import("react").SetStateAction<number>>;
  setFilterMaskPaintActive: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setFilterMaskPaintMode: import("react").Dispatch<import("react").SetStateAction<FilterMaskPaintMode>>;
  setFilterMaskRadius: import("react").Dispatch<import("react").SetStateAction<number>>;
  setFilterMaskStrength: import("react").Dispatch<import("react").SetStateAction<number>>;
  setLayerMaskHardness: import("react").Dispatch<import("react").SetStateAction<number>>;
  setLayerMaskPaintActive: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setLayerMaskPaintMode: import("react").Dispatch<import("react").SetStateAction<LayerMaskPaintMode>>;
  setLayerMaskRadius: import("react").Dispatch<import("react").SetStateAction<number>>;
  setLayerMaskStrength: import("react").Dispatch<import("react").SetStateAction<number>>;
  setLiquifyRadius: import("react").Dispatch<import("react").SetStateAction<number>>;
  setLiquifyMode: import("react").Dispatch<import("react").SetStateAction<StudioLiquifyMode>>;
  setLiquifyStrength: import("react").Dispatch<import("react").SetStateAction<number>>;
  setMagicResizeStrategy: import("react").Dispatch<import("react").SetStateAction<MagicResizeStrategy>>;
  setMenu: import("react").Dispatch<import("react").SetStateAction<StudioMenu | null>>;
  setMobileInspectorSnap: import("react").Dispatch<import("react").SetStateAction<StudioMobileSheetSnap>>;
  setMobileSheet: import("react").Dispatch<import("react").SetStateAction<StudioMobileSheet>>;
  setNodeEditTool: import("react").Dispatch<import("react").SetStateAction<NodeEditTool | null>>;
  setNodeSmoothStrength: import("react").Dispatch<import("react").SetStateAction<number>>;
  setPageGradePanelOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setPanelSplitActive: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setPanelSplitHint: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  setPanelSplitRatio: import("react").Dispatch<import("react").SetStateAction<number>>;
  setPerspectiveRulerActive: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setPixelBrushRadius: import("react").Dispatch<import("react").SetStateAction<number>>;
  setPixelCombine: import("react").Dispatch<
    import("react").SetStateAction<SelectionOperationMode>
  >;
  setPixelForceCircle: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  commitPixelSelectionState: (update: PixelSelection | null | ((current: PixelSelection | null) => PixelSelection | null), operation: PixelSelectionHistoryOperation, coalesceKey?: string) => boolean;
  resetPixelSelectionState: (selection: PixelSelection | null) => void;
  undoPixelSelectionState: () => void;
  redoPixelSelectionState: () => void;
  runColorRangeApply: (opts?: { fuzziness?: number; coalesceKey?: string }) => Promise<void>;
  applyExtendedBlendMergeDown: () => Promise<void>;
  setExtendedBlendMode: import("react").Dispatch<import("react").SetStateAction<StudioExtendedBlendModeId>>;
  setExtendedBlendOpacity: import("react").Dispatch<import("react").SetStateAction<number>>;
  applyPathBooleanCombine: (op: StudioPathBooleanOp) => void;
  applyPaperVectorRefinement: (operation: "simplify" | "smooth") => void;
  cancelPaperVectorRefinement: () => void;
  enterQuickMask: () => void;
  commitQuickMask: () => void;
  exitQuickMask: () => void;
  invertQuickMask: () => void;
  onQuickMaskTintColorChange: (color: string) => void;
  onQuickMaskTintOpacityChange: (value: number) => void;
  setQuickMaskBrushMode: import("react").Dispatch<import("react").SetStateAction<QuickMaskBrushMode>>;
  setQuickMaskRadius: import("react").Dispatch<import("react").SetStateAction<number>>;
  setQuickMaskHardness: import("react").Dispatch<import("react").SetStateAction<number>>;
  setQuickMaskOpacity: import("react").Dispatch<import("react").SetStateAction<number>>;
  setColorRangeFuzziness: import("react").Dispatch<import("react").SetStateAction<number>>;
  setColorRangePickActive: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setColorRangePreviewEnabled: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setColorRangeSamples: import("react").Dispatch<import("react").SetStateAction<ColorRangeSample[]>>;
  setPixelTool: import("react").Dispatch<import("react").SetStateAction<SelectionToolKind | "wand" | null>>;
  setPoserInitialDataUrl: import("react").Dispatch<import("react").SetStateAction<string | undefined>>;
  setPoserInitialElementId: import("react").Dispatch<import("react").SetStateAction<string | undefined>>;
  setPoserVrmOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setPostCorrection: import("react").Dispatch<import("react").SetStateAction<number>>;
  setPreserveCorners: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setPressureCurve: import("react").Dispatch<import("react").SetStateAction<number>>;
  setPuppetWarpActive: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setPuppetWarpPins: import("react").Dispatch<import("react").SetStateAction<PuppetPin[]>>;
  setQuickShapeActive: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setRightPanelOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setSavedBrushes: import("react").Dispatch<import("react").SetStateAction<StudioSavedBrush[]>>;
  setShapeFill: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setSharedDocumentNotice: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  setShowAlignmentGuides: (visible: boolean) => void;
  setShowGrid: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setShowWebtoonGuides: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setSmudgeRadius: import("react").Dispatch<import("react").SetStateAction<number>>;
  setSmudgeStrength: import("react").Dispatch<import("react").SetStateAction<number>>;
  setDodgeBurnExposure: import("react").Dispatch<import("react").SetStateAction<number>>;
  setDodgeBurnHardness: import("react").Dispatch<import("react").SetStateAction<number>>;
  setDodgeBurnMode: import("react").Dispatch<import("react").SetStateAction<DodgeBurnMode>>;
  setDodgeBurnRadius: import("react").Dispatch<import("react").SetStateAction<number>>;
  setDodgeBurnRange: import("react").Dispatch<import("react").SetStateAction<DodgeBurnRange>>;
  setDodgeBurnSponge: import("react").Dispatch<import("react").SetStateAction<DodgeBurnSpongeMode>>;
  setWetMixHardness: import("react").Dispatch<import("react").SetStateAction<number>>;
  setWetMixPickup: import("react").Dispatch<import("react").SetStateAction<number>>;
  setWetMixRadius: import("react").Dispatch<import("react").SetStateAction<number>>;
  setWetMixStrength: import("react").Dispatch<import("react").SetStateAction<number>>;
  setWetMixWetness: import("react").Dispatch<import("react").SetStateAction<number>>;
  setSnapEnabled: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setStabilizer: import("react").Dispatch<import("react").SetStateAction<number>>;
  setStabilizerMode: import("react").Dispatch<import("react").SetStateAction<"standard" | "adaptive" | "precision">>;
  setStampTuning: import("react").Dispatch<import("react").SetStateAction<{ flow: number; hardness: number; minSize: number; } | null>>;
  setStrokeWidth: import("react").Dispatch<import("react").SetStateAction<number>>;
  setSymmetryCenterX: import("react").Dispatch<import("react").SetStateAction<number>>;
  setSymmetryCenterY: import("react").Dispatch<import("react").SetStateAction<number>>;
  setSymmetryRadialCount: import("react").Dispatch<import("react").SetStateAction<number>>;
  setSymmetryType: (value: "none" | "vertical" | "horizontal" | "radial" | "kaleidoscope" | "silk") => void;
  setTiltEnabled: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setTipAngle: import("react").Dispatch<import("react").SetStateAction<number>>;
  setTipRoundness: import("react").Dispatch<import("react").SetStateAction<number>>;
  setTool: import("react").Dispatch<import("react").SetStateAction<Tool>>;
  setUserGuides: import("react").Dispatch<import("react").SetStateAction<{ id: string; type: "v" | "h"; pos: number; }[]>>;
  setUseVelocityPressure: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setVelocitySensitivity: import("react").Dispatch<import("react").SetStateAction<number>>;
  setWandTolerance: import("react").Dispatch<import("react").SetStateAction<number>>;
  shapeFill: boolean;
  showAlignmentGuides: boolean;
  showGrid: boolean;
  showWebtoonGuides: boolean;
  smudgeActive: boolean;
  smudgeBusy: boolean;
  smudgeRadius: number;
  smudgeStrength: number;
  extendedBlendBusy: boolean;
  extendedBlendMode: StudioExtendedBlendModeId;
  extendedBlendOpacity: number;
  extendedBlendUnavailableReason: string | null;
  pathBooleanBusy: boolean;
  pathBooleanUnavailableReason: string | null;
  paperVectorRefinementBusy: boolean;
  paperVectorRefinementUnavailableReason: string | null;
  dodgeBurnActive: boolean;
  dodgeBurnBusy: boolean;
  dodgeBurnExposure: number;
  dodgeBurnHardness: number;
  dodgeBurnMode: DodgeBurnMode;
  dodgeBurnRadius: number;
  dodgeBurnRange: DodgeBurnRange;
  dodgeBurnSponge: DodgeBurnSpongeMode;
  wetMixActive: boolean;
  wetMixBusy: boolean;
  wetMixHardness: number;
  wetMixPickup: number;
  wetMixRadius: number;
  wetMixStrength: number;
  wetMixWetness: number;
  snapEnabled: boolean;
  stabilizer: number;
  stabilizerMode: "standard" | "adaptive" | "precision";
  stampTuning: { flow: number; hardness: number; minSize: number; } | null;
  strokeWidth: number;
  symmetryCenterX: number;
  symmetryCenterY: number;
  symmetryRadialCount: number;
  symmetryType: "none" | "vertical" | "horizontal" | "radial" | "kaleidoscope" | "silk";
  tagsText: string;
  timelinePlaying: boolean;
  tiltEnabled: boolean;
  tipAngle: number;
  tipRoundness: number;
  title: string;
  titleInputRef: import("react").RefObject<HTMLInputElement | null>;
  pendingSaveIntent: "draft" | "published" | null;
  onContinuePendingSave: () => void;
  onClearWorkMetadataError: () => void;
  tool: Tool;
  userGuides: { id: string; type: "v" | "h"; pos: number; }[];
  useVelocityPressure: boolean;
  vanishingPoints: VanishingPoint[];
  velocitySensitivity: number;
  visibleRightPanelOpen: boolean;
  wandTolerance: number;
  webtoonGuides: typeof import("./studio-webtoon-guides") | null;
  webtoonTheme: "classic" | "soft" | "vivid";
  stableHandlers: StudioInspectorAsideHandlers;
}
