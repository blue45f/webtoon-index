import type { StudioDrawingShortcutNoticeStore } from "../brush/studio-drawing-shortcut-notice-store";
import type { StudioInkMeshLivePreviewRuntime } from "../brush/studio-ink-mesh-live-preview-loader";
import type { FilterMaskPaintMode } from "../filter/studio-filter-mask";
import type { StudioFilterPreview } from "../filter/studio-filter-menu";
import type { LayerMaskPaintMode } from "../layer/studio-layer-mask";
import type { DialogueReplacePlan } from "../lettering/studio-dialogue-batch";
import type {
  StudioDialogueImportApplyResult,
  StudioDialogueImportMatchMode,
  StudioDialogueInterchangeDocument,
} from "../lettering/studio-dialogue-interchange";
import type { StudioCrdtDocument } from "../live/studio-crdt-document";
import type { StudioRasterOverlaySourceElement } from "../live/studio-crdt-raster-ui-bridge";
import type { StudioCanvasCommentPin } from "../live/studio-live-canvas-overlay-model";
import type { StudioLiveRoom } from "../live/studio-live-collaboration-room";
import type { StudioLiveDynamicBrushOverlayRenderer } from "../live/studio-live-dynamic-brush-overlay";
import type { StudioLiveGesturePreviewRoomAdapter } from "../live/studio-live-gesture-preview-room-adapter";
import type { StudioLiveInkOverlayRenderer, StudioLiveInkPredictionRenderer } from "../live/studio-live-ink-overlay";
import type { StudioLiveRetainedMediaOverlayRenderer } from "../live/studio-live-retained-media-overlay";
import type { StudioLiveStampOverlayRenderer } from "../live/studio-live-stamp-overlay";
import type { StudioLiveWetInkOverlayRenderer } from "../live/studio-live-wet-ink-overlay";
import type { StudioCommentPinClickPayload, StudioCommentPinReanchorPayload } from "../live/StudioLiveCanvasOverlay";
import type { StudioLivePressureStore } from "../live/StudioLiveInkHosts";
import type { StudioHokusaiLiveOverlayProjection } from "../render/studio-hokusai-live-brush-overlay";
import type { StudioRasterHandoffCandidate } from "../render/studio-raster-handoff-authority";
import type { StudioRasterVisibleDocumentRect } from "../render/studio-raster-visible-rect";
import type { StudioGpuBackend, StudioGpuFrameReceipt } from "../render/studio-webgpu-frame-contract";
import type { StudioGpuStroke } from "../render/studio-webgpu-stroke";
import type { StudioWebGpuViewportSurfacePlan } from "../render/studio-webgpu-viewport";
import type { StudioAdvancedFillPreview } from "../studio-advanced-fill-preview";
import type { StudioAdvancedRuler, StudioAdvancedRulerDocument } from "../studio-advanced-ruler-document";
import type { AnimationTimelineDoc } from "../studio-anim-tracks";
import type { StudioAppSettings, StudioAppSettingsTab } from "../studio-app-settings";
import type { BrushPreset } from "../studio-brush";
import type { CropRect } from "../studio-crop";
import type { StudioDraftPreviewStore } from "../studio-draft-preview-store";
import type { DrawMode, DrawShapeKind, StudioMenu, Tool } from "../studio-editor-tool-model";
import type { DrawEl, El, ImageEl } from "../studio-element-model";
import type { StudioTutorialTryAction } from "../studio-feature-tutorials";
import type { OnionSkinSettings } from "../studio-frame-animation";
import type { SharedGutterSegment } from "../studio-frame-folder";
import type { StudioGroupUniformResizeBounds } from "../studio-group-uniform-resize";
import type { HealCloneMode } from "../studio-heal-clone";
import type { LayerGroup } from "../studio-layers";
import type { StudioLivingInkOverlayProjection } from "../studio-living-ink-overlay";
import type { DocumentMaster } from "../studio-master-page";
import type { NodeEditHandle, NodeEditTool } from "../studio-node-edit";
import type { PageGrade } from "../studio-page-grade";
import type { PageState } from "../studio-page-state";
import type { PanelSplitPreview } from "../studio-panel-split";
import type { VanishingPoint } from "../studio-perspective-guide";
import type { PuppetPin } from "../studio-puppet-warp";
import type { QuickMaskBrushMode } from "../studio-quick-mask";
import type { StudioScrollViewport, StudioScrollViewportStore } from "../studio-scroll-viewport-store";
import type {
  PixelSelection,
  PolyLassoSession,
  SelectionDragState,
  SelectionFrame,
  SelPoint,
} from "../studio-selection-tools";
import type { SmartGuideOverlay } from "../studio-smart-guides";
import type { StudioUiDensityMode } from "../studio-ui-density";
import type { StudioViewRotation } from "../studio-view-controls";
import type { StudioWorkAssetRenderPlaceholder, StudioWorkAssetRenderProjection } from "../studio-work-asset-render-projection";
import type { CvdMode } from "../StudioColorBlindPreview";
import type { StudioDialogueTranslateSurface } from "../StudioDialogueTranslatePanel";
import type {
  StudioWebGpuCanvasHandle,
  StudioWebGpuSurfaceFrameRequest,
} from "../StudioWebGpuCanvas";
import type { StudioCanvasStatusRailProps } from "./StudioCanvasStatusRail";
import type Konva from "konva";

export interface StudioCanvasViewportHandlers {
  activateCanvasTool: (tool: "select" | "draw", drawMode?: DrawMode) => void;
  addPage: () => void;
  closeViewToolWithFocus: (options?: { preferCanvas?: boolean }) => void;
  beginCanvasSelectionResize: (
    sourceBounds: StudioGroupUniformResizeBounds
  ) => boolean;
  /** Request renderer-owned cancellation; this must not release the page/CRDT writer lease. */
  cancelCanvasSelectionResize: () => void;
  /** Commit-port finalizer, called only after renderer close/settlement acknowledges completion. */
  finalizeCanvasSelectionResize: () => void;
  commitCanvasSelectionResize: (
    targetBounds: StudioGroupUniformResizeBounds,
    rotationDeg: number
  ) => boolean;
  fitCanvasToWidth: () => void;
  onWebGpuFrameInvalid: () => void;
  onWebGpuFrameRequest: (request: StudioWebGpuSurfaceFrameRequest) => void;
  onWebGpuFrameReady: (receipt: StudioGpuFrameReceipt) => void;
  onWebGpuDeviceLost: () => void;
  onWebGpuBackendChange: (backend: StudioGpuBackend) => void;
  setWebGpuCanvasHandle: (handle: StudioWebGpuCanvasHandle | null) => void;
  setHokusaiLiveOverlaySurface: (
    surface: StudioHokusaiLiveOverlaySurfaceBinding | null
  ) => void;
  setLivingInkOverlaySurface: (
    surface: StudioLivingInkOverlaySurfaceBinding | null
  ) => void;
  onHokusaiCanonicalImageReady: (
    elementId: string,
    pngHash: `sha256:${string}`,
  ) => void;
  onLivingInkCanonicalImageReady: (
    elementId: string,
    pngHash: `sha256:${string}`,
    routeKey: string,
  ) => void;
  setElementNodeRef: (elId: string, node: Konva.Node | null) => void;
  isCanvasGroupDragActive: (elementId: string) => boolean;
  selectElementFromCanvas: (
    elementId: string,
    evt?: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
    forceGroupEnter?: boolean
  ) => void;
  commitTextTransformEnd: (elId: string, fontSize: number, e: Konva.KonvaEventObject<Event>, opts: { minFontSize: number; patchWidth?: boolean }) => void;
  acknowledgeAiNotice: () => void;
  alignSelected: (mode: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" | "distributeH" | "distributeV") => void;
  zoomToSelection: () => void;
  flipSelected: (axis: "horizontal" | "vertical") => void;
  applyAdvancedFillPreview: () => void;
  applyBuiltInBrushPreset: (preset: BrushPreset) => void;
  applyDialogueReplacePlan: (plan: DialogueReplacePlan) => void;
  importDialogueInterchange: (
    document: StudioDialogueInterchangeDocument,
    mode: StudioDialogueImportMatchMode
  ) => Promise<StudioDialogueImportApplyResult>;
  applyTranslationDraft: () => void;
  cancelAdvancedFillPreview: () => void;
  cancelAiNotice: () => void;
  captureAnimFrame: (elId: string) => Promise<void>;
  captureTimelineKeyframe: (trackId: string, frameIndex: number) => Promise<void>;
  clearAdvancedFillTapGesture: () => void;
  clearAutosave: () => void | Promise<void>;
  clearCanvasSelection: () => void;
  commitAppSettings: (next: StudioAppSettings) => void;
  retryAppSettingsPersistence: () => void;
  commitCoalesced: (nextElements: El[], key: string) => void;
  cancelEditText: () => void;
  commitEditText: (finalValue: string) => void;
  commitPages: (nextPages: PageState[], options?: { bypassReviewLock?: boolean; }) => boolean;
  designateHistoryBrushSource: (index: number) => void;
  dismissQuickStart: () => void;
  downloadAutosaveBackup: () => void;
  duplicateSelected: () => void;
  endLiveResourceEdit: () => void;
  enterCanvasOnlyMode: () => void;
  executeGenerateTranslations: () => Promise<void>;
  groupSelectedElements: () => void;
  ungroupSelectedElements: () => void;
  toggleSelectedElementsLocked: () => void;
  reorderSelectedElements: (direction: "front" | "back") => void;
  mergeSelectedBubbles: () => void;
  handleTutorialTry: (
    action: StudioTutorialTryAction,
    trigger: HTMLButtonElement,
  ) => void;
  openBrushCatalogFromHelp: (trigger: HTMLButtonElement) => void;
  hideBrushCursor: () => void;
  hideFilterMaskCursor: () => void;
  hideHealCloneCursors: () => void;
  hideHistoryBrushCursor: () => void;
  hideLayerMaskCursor: () => void;
  hideSmudgeCursor: () => void;
  jumpToHistoryIndex: (index: number) => void;
  moveVanishingPointById: (id: string, x: number, y: number) => void;
  previewVanishingPointById: (id: string, x: number, y: number) => void;
  setPerspectiveEyeLevelY: (y: number) => void;
  previewPerspectiveEyeLevelY: (y: number) => void;
  previewIsometricOrigin: (x: number, y: number) => void;
  commitIsometricOrigin: (x: number, y: number) => void;
  previewAdvancedRuler: (id: string, patch: Partial<StudioAdvancedRuler>) => void;
  patchAdvancedRuler: (id: string, patch: Partial<StudioAdvancedRuler>) => void;
  cancelStudioDrawingAssistPreview: () => void;
  nodeInteractionBegin: (elementId: string) => boolean;
  onStageDown: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onStageDragEnd: () => void;
  onStageDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onStageMove: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onStagePointerCancel: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onStageUp: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onWrapDragLeave: (e: React.DragEvent) => void;
  onWrapDragOver: (e: React.DragEvent) => void;
  onWrapDrop: (e: React.DragEvent) => Promise<void>;
  onWrapMouseDown: (e: React.MouseEvent) => void;
  onWrapMouseMove: (e: React.MouseEvent) => void;
  onWrapMouseUp: () => void;
  openFeatureTutorial: (tutorialId?: string | null) => void;
  openQuickComicWizard: () => void;
  openQuickStartMenu: (nextMenu: Extract<StudioMenu, "template" | "char" | "bubble">) => void;
  patchDialogueText: (pageId: string, elId: string, text: string) => void;
  patchEl: (id: string, patch: Partial<El>) => void;
  patchElCoalesced: (id: string, patch: Partial<El>, key: string) => void;
  patchTranslateDraft: (id: string, text: string) => void;
  removeSelected: () => void;
  restoreAutosave: () => Promise<void>;
  resetView: () => void;
  rotateCanvasView: (direction: "left" | "right") => void;
  selectDialogueElement: (pageId: string, elId: string) => void;
  openStudioCommentThreadPopover: (payload: StudioCommentPinClickPayload) => void;
  reanchorStudioCommentPin: (payload: StudioCommentPinReanchorPayload) => void;
  stopStudioCommentPlacementSession: () => void;
  setMaster: (next: Parameters<import("react").Dispatch<import("react").SetStateAction<DocumentMaster<El>>>>[0]) => void;
  setCurrentPageId: (value: import("react").SetStateAction<string>) => boolean;
  setRightPanelOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setStudioUiDensity: (mode: StudioUiDensityMode) => void;
  snapBoundFunc: (pos: { x: number; y: number; }) => { x: number; y: number; };
  startEditText: (id: string) => void;
  startFromExample: () => Promise<void>;
  setActualPixelView: () => void;
  switchToDialogueLocale: (locale: string) => void;
  toggleAdvancedFill: () => void;
  toggleHorizontalCanvasView: () => void;
  updateActivePage: (patch: Partial<Omit<PageState, "id">>) => void;
  beginSharedGutterDrag: (segment: SharedGutterSegment) => void;
  previewSharedGutterDrag: (segment: SharedGutterSegment, delta: number) => void;
  commitSharedGutterDrag: (segment: SharedGutterSegment, delta: number) => void;
  setContextMenu: import("react").Dispatch<import("react").SetStateAction<{ visible: boolean; x: number; y: number; elId: string | null; }>>;
  setError: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  setStudioRasterHandoffCandidate: import("react").Dispatch<import("react").SetStateAction<StudioRasterHandoffCandidate | null>>;
  setTool: import("react").Dispatch<import("react").SetStateAction<Tool>>;
}

export interface StudioHokusaiLiveOverlaySurfaceBinding {
  readonly canvas: HTMLCanvasElement;
  readonly projection: StudioHokusaiLiveOverlayProjection;
  /** Any change invalidates pixels composed against the previous viewport transform. */
  readonly surfaceKey: string;
}

export interface StudioLivingInkOverlaySurfaceBinding {
  readonly canvas: HTMLCanvasElement;
  readonly projection: StudioLivingInkOverlayProjection;
  /** Any page/viewport transform change invalidates pending ImageBitmap presentation. */
  readonly surfaceKey: string;
}

export interface StudioCanvasViewportProps {
  liveDynamicBrushOverlayRenderer: StudioLiveDynamicBrushOverlayRenderer;
  liveWetInkOverlayRenderer: StudioLiveWetInkOverlayRenderer;
  inkMeshLivePreviewRuntime: StudioInkMeshLivePreviewRuntime | null;
  liveInkPredictionRenderer: StudioLiveInkPredictionRenderer;
  liveRetainedMediaOverlayRenderer: StudioLiveRetainedMediaOverlayRenderer;
  liveStampOverlayRenderer: StudioLiveStampOverlayRenderer;
  bubbleShapeActiveHandleIndex: number | null;
  draftPreviewStore: StudioDraftPreviewStore;
  liveDrawPressureStore: StudioLivePressureStore;
  liveInkOverlayRenderer: StudioLiveInkOverlayRenderer;
  nodeEditActiveHandleIndex: number | null;
  activeCatalogBrushName: string;
  activeDialogueLocale: string;
  activePage: PageState;
  activePageIndex: number;
  activeSurfaceReviewLocked: boolean;
  activeServerAiProviderLabel: string;
  advancedFillActive: boolean;
  advancedFillArmed: boolean;
  advancedFillBusy: boolean;
  advancedFillPreview: StudioAdvancedFillPreview | null;
  advancedRulers: StudioAdvancedRulerDocument;
  aiNoticeOpen: boolean;
  animTimeline: AnimationTimelineDoc;
  appSettings: StudioAppSettings;
  appSettingsInitialTab: StudioAppSettingsTab;
  appSettingsOpen: boolean;
  appSettingsPersistenceState: "loading" | "saved" | "session-only";
  authorizedWorkAssetScopeId: string | null;
  autosaveRestoreBlockedReason: "legacy-unversioned" | "work-mismatch" | "revision-mismatch" | null;
  bg: string;
  bgGrad: string[] | null;
  brush: string;
  brushCursorRef: import("react").RefObject<import("konva/lib/Group").Group | null>;
  strokeGuideRef: import("react").RefObject<import("konva/lib/shapes/Line").Line | null>;
  brushOpacity: number;
  bubbleShapeArmed: boolean;
  bubbleShapeDraft: { elId: string; points: number[]; } | null;
  bubbleShapeHandles: NodeEditHandle[];
  canvasFlipH: boolean;
  canvasRotation: StudioViewRotation;
  canvasH: number;
  canvasOnlyMode: boolean;
  canvasInteractionBlocked: boolean;
  hardCanvasInteractionBlock: boolean;
  collaborationDocumentLocked: boolean;
  collaborationDocumentUnavailable: boolean;
  commentQuickReplyActive: boolean;
  collaborationLockMessage: () => string;
  closeViewToolWithFocus: (options?: { preferCanvas?: boolean }) => void;
  colorBlindPreview: CvdMode;
  commentPinArmed: boolean;
  cropArmed: boolean;
  cropRect: CropRect | null;
  dialogueBatchOpen: boolean;
  /** 닫힘(false) 또는 처음 보여 줄 화면 — 메뉴의 대사 번역/현지화 QA 두 진입점이 이 값으로 갈린다. */
  dialogueTranslateOpen: StudioDialogueTranslateSurface;
  drawingRef: import("react").RefObject<DrawEl | null>;
  drawingShortcutNoticeStore: StudioDrawingShortcutNoticeStore;
  drawMode: DrawMode;
  drawShape: DrawShapeKind;
  editing: { id: string; } | null;
  eyedropperActive: boolean;
  effScale: number;
  /** Settled scroll viewport of the canvas host. Frame-accurate values come from the store below. */
  canvasScrollViewport: StudioScrollViewport;
  /**
   * Live scroll viewport publisher. The clipped Stage has to follow the scroll offset every frame,
   * and the React snapshot above is deliberately deferred to gesture settle, so the Stage tracks
   * this store imperatively instead of re-rendering the editor once per pan frame.
   */
  scrollViewportStore: StudioScrollViewportStore;
  elementById: Map<string, El>;
  elements: El[];
  studioFilterPageComposite: (ImageEl & El) | null;
  studioFilterPreview: StudioFilterPreview | null;
  followingStudioSessionId: string | null;
  frameAnimEl: ImageEl | null;
  frameAnimOpen: boolean;
  frameAnimTargetId: string | null;
  gpuCanvasShadowVisibleRef: import("react").RefObject<boolean>;
  gpuLiveInkPinnedRef: import("react").RefObject<boolean>;
  livingInkOverlayVisibleRef: import("react").RefObject<boolean>;
  gridSize: number;
  groups: LayerGroup[];
  guides: { x: number[]; y: number[]; };
  hasAutosave: boolean;
  /** 이 탭이 문서 저장을 맡는지 — follower 면 복구 배너 대신 읽기 전용 고지를 띄운다. */
  autosaveDocumentLeadership: StudioCanvasStatusRailProps["autosaveDocumentLeadership"];
  autosaveLiveJam: StudioCanvasStatusRailProps["autosaveLiveJam"];
  healCloneArmed: boolean;
  healCloneCursorRef: import("react").RefObject<import("konva/lib/shapes/Circle").Circle | null>;
  healCloneDragPreview: { points: SelPoint[]; } | null;
  healCloneRadius: number;
  healCloneSourceAnchor: SelPoint | null;
  healCloneSourceCursorRef: import("react").RefObject<import("konva/lib/shapes/Circle").Circle | null>;
  healCloneTool: HealCloneMode | null;
  historyBrushArmed: boolean;
  historyBrushCursorRef: import("react").RefObject<import("konva/lib/shapes/Circle").Circle | null>;
  historyBrushDragPreview: { points: SelPoint[]; } | null;
  historyBrushRadius: number;
  historyBrushSourceIndex: number | null;
  historyPanelOpen: boolean;
  isExporting: boolean;
  isMobile: boolean;
  isometricAngleDeg: number;
  isometricCellSize: number;
  isometricGridActive: boolean;
  isometricOriginX: number;
  isometricOriginY: number;
  isPanning: boolean;
  isSpacePressed: boolean;
  filterMaskCursorRef: import("react").RefObject<import("konva/lib/shapes/Circle").Circle | null>;
  filterMaskDragPreview: { points: SelPoint[]; } | null;
  filterMaskPaintArmed: boolean;
  filterMaskPaintMode: FilterMaskPaintMode;
  filterMaskRadius: number;
  layerMaskCursorRef: import("react").RefObject<import("konva/lib/shapes/Circle").Circle | null>;
  layerMaskDragPreview: { points: SelPoint[]; } | null;
  layerMaskPaintArmed: boolean;
  layerMaskPaintMode: LayerMaskPaintMode;
  layerMaskRadius: number;
  quickMaskArmed: boolean;
  quickMaskBrushMode: QuickMaskBrushMode;
  quickMaskDragPreview: { points: SelPoint[]; } | null;
  quickMaskRadius: number;
  quickMaskTintCanvas: HTMLCanvasElement | null;
  quickMaskTintColor: string;
  quickMaskTintOpacity: number;
  /** "나만 숨기기" — 문서(CRDT)에 없는, 이 클라이언트에서만 켠 로컬 숨김 대상. */
  localHiddenElementIds: ReadonlySet<string>;
  liveDraftDirectRef: import("react").RefObject<boolean>;
  draftPreviewDynamicLayerRef: import("react").RefObject<import("konva/lib/Layer").Layer | null>;
  draftPreviewNormalLayerRef: import("react").RefObject<import("konva/lib/Layer").Layer | null>;
  liveDraftLayerRef: import("react").RefObject<import("konva/lib/Layer").Layer | null>;
  liveDraftVisualRef: import("react").RefObject<DrawEl | null>;
  liveInkOverlayRendererRef: import("react").RefObject<StudioLiveInkOverlayRenderer>;
  mainLayerRef: import("react").RefObject<import("konva/lib/Layer").Layer | null>;
  /** Bumped when Escape/pointer-cancel cancels an in-flight selection resize outside Konva. */
  canvasSelectionResizeCancelSignal: number;
  marqueeIds: string[];
  /** 그룹 진입(더블클릭) 편집 중인 그룹 id — 경계 오버레이 표시용. */
  activeGroupId: string | null;
  marqueeRectNodeRef: import("react").RefObject<import("konva/lib/shapes/Rect").Rect | null>;
  master: DocumentMaster<El>;
  masterEditMode: boolean;
  masterPanelOpen: boolean;
  masterRenderEls: El[];
  mobileImmersive: boolean;
  mobileKeyboardInset: number;
  navigate: import("react-router-dom").NavigateFunction;
  nodeEditArmed: boolean;
  nodeEditDraft: { elId: string; points: number[]; pressures: number[]; } | null;
  nodeEditHandles: NodeEditHandle[];
  nodeEditTool: NodeEditTool | null;
  nodeRefsRef: import("react").RefObject<Record<string, Konva.Node | null>>;
  onionSkin: OnionSkinSettings;
  pageGrade: PageGrade;
  pageGradeCss: string;
  pages: PageState[];
  pageSequenceOpen: boolean;
  pagesHi: number;
  pagesHistory: PageState[][];
  panelGutter: number;
  panelSplitArmed: boolean;
  panelSplitPreview: PanelSplitPreview | null;
  perspectiveRulerActive: boolean;
  pixelDragPreview: SelectionDragState | null;
  pixelOverlayFrame: SelectionFrame | null;
  pixelOverlaySel: PixelSelection | null;
  pixelToolArmed: boolean;
  polyLassoHover: SelPoint | null;
  polyLassoSession: PolyLassoSession | null;
  pressureCurve: number;
  puppetWarpArmed: boolean;
  puppetWarpBusy: boolean;
  puppetWarpPins: PuppetPin[];
  quickShapeActive: boolean;
  remixId: string | null;
  saving: boolean;
  scale: number;
  selected: El | null;
  selectedId: string | null;
  setAppSettingsInitialTab: import("react").Dispatch<import("react").SetStateAction<StudioAppSettingsTab>>;
  setAppSettingsOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setBg3dOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setCanvasOnlyMode: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setContextMenu: import("react").Dispatch<import("react").SetStateAction<{ visible: boolean; x: number; y: number; elId: string | null; }>>;
  setCurrentPageId: (value: import("react").SetStateAction<string>) => boolean;
  setDialogueBatchOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setDialogueTranslateOpen: import("react").Dispatch<import("react").SetStateAction<StudioDialogueTranslateSurface>>;
  setError: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  setEyedropperActive: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setFollowingStudioSessionId: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  setFrameAnimOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setFrameAnimTargetId: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  setHistoryPanelOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setLeftPanelOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setMarqueeIds: import("react").Dispatch<import("react").SetStateAction<string[]>>;
  setMasterEditMode: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setMasterPanelOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setOnionSkin: import("react").Dispatch<import("react").SetStateAction<OnionSkinSettings>>;
  setPageSequenceOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setPoserVrmOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setPuppetWarpPins: import("react").Dispatch<import("react").SetStateAction<PuppetPin[]>>;
  setQuickShapeActive: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setQuickStartOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setSelectedId: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  setSharedDocumentNotice: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  setShortcutsOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setStudioRasterHandoffCandidate: import("react").Dispatch<import("react").SetStateAction<StudioRasterHandoffCandidate | null>>;
  setSymmetryCenterX: import("react").Dispatch<import("react").SetStateAction<number>>;
  setSymmetryCenterY: import("react").Dispatch<import("react").SetStateAction<number>>;
  setTeamPanelOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setTimelineFocusedTrackId: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  setTimelineOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setTimelinePlayhead: import("react").Dispatch<import("react").SetStateAction<number>>;
  setTimelinePlaying: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setTool: import("react").Dispatch<import("react").SetStateAction<Tool>>;
  setTranslateDraft: import("react").Dispatch<import("react").SetStateAction<Map<string, string> | null>>;
  setTranslateGlossary: import("react").Dispatch<import("react").SetStateAction<string>>;
  setTranslateTargetLocale: import("react").Dispatch<import("react").SetStateAction<string>>;
  setTutorialHubOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setUserGuides: import("react").Dispatch<import("react").SetStateAction<{ id: string; type: "v" | "h"; pos: number; }[]>>;
  setZoom: import("react").Dispatch<import("react").SetStateAction<number>>;
  shapeFill: boolean;
  shortcutsOpen: boolean;
  showGrid: boolean;
  showQuickStart: boolean;
  showWebtoonGuides: boolean;
  smartGuides: SmartGuideOverlay;
  /** Axis-aligned abutting frame gutters (CSP co-edit handles). */
  sharedGutters: readonly SharedGutterSegment[];
  smudgeArmed: boolean;
  dodgeBurnArmed: boolean;
  dodgeBurnRadius: number;
  wetMixArmed: boolean;
  wetMixRadius: number;
  liquifyArmed: boolean;
  liquifyRadius: number;
  smudgeCursorRef: import("react").RefObject<import("konva/lib/shapes/Circle").Circle | null>;
  /** Live paint-retouch stroke trail (smudge / dodge-burn / wet-mix); mutated outside React. */
  paintRetouchStrokeLineRef: import("react").RefObject<import("konva/lib/shapes/Line").Line | null>;
  /**
   * Live liquify warp preview (downscaled canvas/ImageData). Mutated outside React during drag;
   * cleared on pointerup before the full-resolution bake commits.
   */
  liquifyPreviewImageRef: import("react").RefObject<import("konva/lib/shapes/Image").Image | null>;
  smudgeRadius: number;
  sourceHydrationPending: boolean;
  stabilizer: number;
  stabilizerMode: "standard" | "adaptive" | "precision";
  stageRef: import("react").RefObject<import("konva/lib/Stage").Stage | null>;
  strokeWidth: number;
  tipAngle: number;
  tipRoundness: number;
  studioCanvasCommentPins: StudioCanvasCommentPin[];
  studioCommentPinReanchorableThreadIds: ReadonlySet<string>;
  studioCommentPinReanchorDisabledReason?: string;
  studioCrdtDocument: StudioCrdtDocument | null;
  studioCrdtOperationSyncReady: boolean;
  studioLiveGesturePreviewAdapter: StudioLiveGesturePreviewRoomAdapter;
  studioLiveGesturePreviewAuthoritativeElementIds: ReadonlySet<string> | readonly string[];
  studioLiveRoomRef: import("react").RefObject<StudioLiveRoom | null>;
  studioRasterAuthorizedAuthorityKey: string | null;
  studioRasterHandoffBaseKey: string;
  studioRasterHandoffBlocked: boolean;
  studioRasterHandoffGates: { readonly exportActive: boolean; readonly masterEditActive: boolean; readonly editActive: boolean; readonly specialDraftActive: boolean; readonly postProcessingActive: boolean; };
  studioRasterHiddenOperationIds: ReadonlySet<string>;
  studioRasterOverlayElements: readonly StudioRasterOverlaySourceElement[];
  studioRasterVisibleDocumentRect: StudioRasterVisibleDocumentRect | null;
  studioWorkAssetRenderPlaceholders: StudioWorkAssetRenderPlaceholder[];
  studioWorkAssetRenderProjection: StudioWorkAssetRenderProjection<El>;
  symmetryCenterX: number;
  symmetryCenterY: number;
  symmetryRadialCount: number;
  symmetryType: "none" | "vertical" | "horizontal" | "radial" | "kaleidoscope" | "silk";
  textAiConfigured: boolean;
  timelapseCapturing: boolean;
  timelineFocusedTrackId: string | null;
  timelineOpen: boolean;
  timelinePlayhead: number;
  timelinePlaying: boolean;
  timelinePreviewFrame: number;
  title: string;
  tool: Tool;
  viewTool: "zoom" | "rotate" | null;
  viewTransformSuppressed: boolean;
  translateBusy: boolean;
  translateDraft: Map<string, string> | null;
  translateError: string | null;
  translateGlossary: string;
  translateProgress: { done: number; total: number; } | null;
  translateTargetLocale: string;
  trRef: import("react").RefObject<import("konva/lib/shapes/Transformer").Transformer | null>;
  tutorialHubOpen: boolean;
  tutorialInitialId: string | null;
  uiDensityMode: "simple" | "full" | "focus";
  userGuides: { id: string; type: "v" | "h"; pos: number; }[];
  vanishingPoints: VanishingPoint[];
  perspectiveEyeLevelY: number | null;
  perspectiveLockHorizon: boolean;
  webGpuPreviewAuthorized: boolean;
  webGpuPreviewStrokes: readonly StudioGpuStroke[];
  webGpuViewportSurface: StudioWebGpuViewportSurfacePlan | null;
  transientPenInkSurfaceEnabled: boolean;
  webtoonGuides: typeof import("../studio-webtoon-guides") | null;
  webtoonTheme: "classic" | "soft" | "vivid";
  workHydrationFailed: boolean;
  workHydrationUnsupportedFormat: boolean;
  workId: string | null;
  wrapRef: import("react").RefObject<HTMLDivElement | null>;
  zoom: number;
  zoomLocked: boolean;
  setZoomLocked: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  zoomHostRef: import("react").RefObject<HTMLDivElement | null>;
  stableHandlers: StudioCanvasViewportHandlers;
  setRightPanelOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
}
