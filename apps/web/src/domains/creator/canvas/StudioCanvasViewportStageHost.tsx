import {
  Profiler,
  Suspense,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { Stage, Layer, Rect, Shape, Group } from "react-konva/lib/ReactKonvaCore";

import { drawLiveFreehandDraftToContext } from "../brush/studio-draw-rendering";
import { STUDIO_AUTOMATIC_RASTER_PUBLICATION_ENABLED } from "../render/studio-raster-publication-feature";
import { CANVAS_W } from "../studio-assets";
import { studioBackgroundGradientColorStops } from "../studio-background-gradient-color-stops";
import { vignetteCss } from "../studio-page-grade";
import { createStudioLiveTransformDraftStore } from "../studio-live-transform-draft-store";
import {
  STUDIO_KONVA_DOCUMENT_SHADOW_NAME,
} from "../studio-single-object-drag-layer";
import {
  StudioRasterCrdtSurface,
  StudioRemoteCursorOverlay,
  StudioTextEditOverlay,
  preloadStudioCommentThreadPopover,
} from "../studio-page-lazy-ui";
import { colorBlindFilterStyle } from "../StudioColorBlindPreview";

import { isStudioBrushCursorMode } from "./studio-canvas-cursor";
import {
  recordStudioRenderProfile,
  studioElementIdOf,
} from "./studio-canvas-shared-runtime";
import {
  STUDIO_STAGE_CLIPPED_STYLE,
  STUDIO_STAGE_DOCUMENT_STYLE,
} from "./studio-canvas-viewport-primitives";
import { StudioCanvasGuideUnderlay } from "./StudioCanvasGuideLayers";
import { renderStudioCanvasSelectionDecorations } from "./StudioCanvasSelectionDecorations";
import {
  StudioCanvasViewportDocumentLayer,
  type StudioCanvasViewportDocumentLayerProps,
} from "./StudioCanvasViewportDocumentLayer";
import {
  StudioCanvasViewportDomOverlays,
  type StudioCanvasViewportDomOverlaysProps,
} from "./StudioCanvasViewportDomOverlays";
import {
  StudioCanvasViewportToolLayers,
  type StudioCanvasViewportToolLayersProps,
} from "./StudioCanvasViewportToolLayers";

import type {
  StudioCanvasViewportInteraction,
} from "./studio-canvas-viewport-interaction";
import type {
  StudioCanvasViewportLiveSurfaces,
} from "./studio-canvas-viewport-live-surfaces";
import type {
  StudioCanvasViewportProps,
} from "./StudioCanvasViewportTypes";

import { cn } from "@/shared/lib/utils";

export function StudioCanvasViewportStageHost({
  viewport,
  live,
  interaction,
  bindZoomHost,
}: {
  viewport: StudioCanvasViewportProps;
  live: StudioCanvasViewportLiveSurfaces;
  interaction: StudioCanvasViewportInteraction;
  bindZoomHost: (node: HTMLDivElement | null) => void;
}) {
  const {
    activeGroupId,
    activePage,
    activeSurfaceReviewLocked,
    authorizedWorkAssetScopeId,
    bg,
    bgGrad,
    brush,
    canvasFlipH,
    canvasH,
    canvasInteractionBlocked,
    canvasRotation,
    collaborationDocumentUnavailable,
    colorBlindPreview,
    commentPinArmed,
    commentQuickReplyActive,
    drawMode,
    editing,
    effScale,
    elementById,
    followingStudioSessionId,
    elements,
    gridSize,
    groups,
    hardCanvasInteractionBlock,
    isExporting,
    isMobile,
    liveDraftDirectRef,
    liveDraftVisualRef,
    mainLayerRef,
    marqueeIds,
    masterEditMode,
    nodeRefsRef,
    pageGrade,
    pageGradeCss,
    selected,
    showGrid,
    showWebtoonGuides,
    sourceHydrationPending,
    stageRef,
    studioCanvasCommentPins,
    studioCommentPinReanchorDisabledReason,
    studioCommentPinReanchorableThreadIds,
    studioCrdtDocument,
    studioRasterAuthorizedAuthorityKey,
    studioRasterHandoffBaseKey,
    studioRasterHandoffBlocked,
    studioRasterHandoffGates,
    studioRasterOverlayElements,
    studioRasterVisibleDocumentRect,
    studioLiveRoomRef,
    tool,
    trRef,
    webGpuViewportSurface,
    webtoonGuides,
    stableHandlers,
  } = viewport;
  const {
    beginCanvasSelectionResize,
    cancelCanvasSelectionResize,
    cancelEditText,
    clearAdvancedFillTapGesture,
    commitCanvasSelectionResize,
    commitEditText,
    finalizeCanvasSelectionResize,
    hideBrushCursor,
    hideFilterMaskCursor,
    hideHealCloneCursors,
    hideHistoryBrushCursor,
    hideLayerMaskCursor,
    hideSmudgeCursor,
    onStageDown,
    onStageDragMove,
    onStageMove,
    onStageUp,
    openStudioCommentThreadPopover,
    reanchorStudioCommentPin,
    selectElementFromCanvas,
    setContextMenu,
    setError,
    setStudioRasterHandoffCandidate,
    setTool,
  } = stableHandlers;
  const {
    frameGraphOwnsDocumentPixels,
    paperGrainOpacity,
    paperGrainPatternImage,
    stageViewClip,
    stageViewLayout,
    studioLiveGesturePreviewTrailSuppressedSessionIds,
    velloHubAuthority,
  } = live;
  const {
    beginSingleObjectDragLayer,
    brushCursorStyle,
    cancelSingleObjectDragLayer,
    canvasCursorClassName,
    canvasSelectionEls,
    completeSelectionGroup,
    editingUseOverlay,
    enterGroupFromCanvasGesture,
    eraserPresetActive,
    finishSingleObjectDragLayer,
    groupResizeEnabled,
    hasCoarsePointer,
    multiSelectionBounds,
    narrowCanvasSelectionOnRelease,
    selectionLockState,
    selectionRotatable,
    singleDrawFreeScale,
  } = interaction;
  const liveTransformDraftScope = `${masterEditMode ? "master" : "page"}:${activePage.id}`;
  const [liveTransformDraftStore] = useState(() =>
    createStudioLiveTransformDraftStore()
  );
  // Select only the terminal handoff generation. Active exact frames keep returning null, so the
  // Stage host does not re-render with every pointer frame; the isolated draft node remains the
  // only hot subscriber. A handoff transition itself must wake this owner, even when the durable
  // `elements` render happened synchronously before renderer settlement.
  const liveTransformHandoffRevision = useSyncExternalStore(
    liveTransformDraftStore.subscribe,
    () => {
      const snapshot = liveTransformDraftStore.getSnapshot();
      return snapshot?.phase === "handoff" ? snapshot.revision : null;
    },
    () => null,
  );

  // Pointer-up retains the exact terminal draft until this authoritative render is committed.
  // useLayoutEffect releases the hidden source before paint, preventing both source flash and a
  // duplicate preview frame while React hands renderer authority back to the document Layer.
  useLayoutEffect(() => {
    liveTransformDraftStore.acknowledgeAuthoritative(
      liveTransformDraftScope,
      elements,
    );
  }, [
    elements,
    liveTransformDraftScope,
    liveTransformDraftStore,
    liveTransformHandoffRevision,
  ]);

  // A terminal draft belongs to exactly one page/master surface. The draft node also filters by
  // scope during render, while this layout cleanup restores the old hidden source before paint.
  useLayoutEffect(
    () => () => {
      liveTransformDraftStore.releaseScope(liveTransformDraftScope);
    },
    [liveTransformDraftScope, liveTransformDraftStore],
  );

  const documentLayerProps: StudioCanvasViewportDocumentLayerProps = {
    activeGroupId: viewport.activeGroupId,
    activePage: viewport.activePage,
    activeSurfaceReviewLocked: viewport.activeSurfaceReviewLocked,
    advancedFillArmed: viewport.advancedFillArmed,
    advancedFillPreview: viewport.advancedFillPreview,
    animTimeline: viewport.animTimeline,
    bubbleShapeArmed: viewport.bubbleShapeArmed,
    bubbleShapeDraft: viewport.bubbleShapeDraft,
    canonicalDryMediaHiddenElementId: live.canonicalDryMediaHiddenElementId,
    commitTextTransformEnd: viewport.stableHandlers.commitTextTransformEnd,
    cropArmed: viewport.cropArmed,
    dodgeBurnArmed: viewport.dodgeBurnArmed,
    drawingRef: viewport.drawingRef,
    effScale: viewport.effScale,
    endLiveResourceEdit: viewport.stableHandlers.endLiveResourceEdit,
    filterMaskPaintArmed: viewport.filterMaskPaintArmed,
    frameAnimOpen: viewport.frameAnimOpen,
    frameAnimTargetId: viewport.frameAnimTargetId,
    groupMovementBlockedIds: interaction.groupMovementBlockedIds,
    groups: viewport.groups,
    healCloneArmed: viewport.healCloneArmed,
    historyBrushArmed: viewport.historyBrushArmed,
    isCanvasGroupDragActive: viewport.stableHandlers.isCanvasGroupDragActive,
    isExporting: viewport.isExporting,
    layerMaskPaintArmed: viewport.layerMaskPaintArmed,
    liquifyArmed: viewport.liquifyArmed,
    localHiddenElementIds: viewport.localHiddenElementIds,
    marqueeIds: viewport.marqueeIds,
    masterEditMode: viewport.masterEditMode,
    masterRenderEls: viewport.masterRenderEls,
    nodeEditArmed: viewport.nodeEditArmed,
    nodeEditDraft: viewport.nodeEditDraft,
    nodeInteractionBegin: viewport.stableHandlers.nodeInteractionBegin,
    onionSkin: viewport.onionSkin,
    onHokusaiCanonicalImageReady: viewport.stableHandlers.onHokusaiCanonicalImageReady,
    onLivingInkCanonicalImageReady: viewport.stableHandlers.onLivingInkCanonicalImageReady,
    pagesHi: viewport.pagesHi,
    paperSurfaceForPreview: live.paperSurfaceForPreview,
    panelSplitArmed: viewport.panelSplitArmed,
    patchEl: interaction.patchEl,
    patchElementAfterDragRestore: interaction.patchElementAfterDragRestore,
    pixelToolArmed: viewport.pixelToolArmed,
    puppetWarpArmed: viewport.puppetWarpArmed,
    quickMaskArmed: viewport.quickMaskArmed,
    selectElementFromCanvas: viewport.stableHandlers.selectElementFromCanvas,
    selectedId: viewport.selectedId,
    selectionLockState: interaction.selectionLockState,
    setElementNodeRef: viewport.stableHandlers.setElementNodeRef,
    smudgeArmed: viewport.smudgeArmed,
    snapBoundFunc: viewport.stableHandlers.snapBoundFunc,
    startEditText: viewport.stableHandlers.startEditText,
    studioFilterPageComposite: viewport.studioFilterPageComposite,
    studioFilterPreview: viewport.studioFilterPreview,
    studioLiveGesturePreviewRenderPlan: live.studioLiveGesturePreviewRenderPlan,
    studioRasterHiddenOperationIds: viewport.studioRasterHiddenOperationIds,
    studioWorkAssetRenderPlaceholders: viewport.studioWorkAssetRenderPlaceholders,
    studioWorkAssetRenderProjection: viewport.studioWorkAssetRenderProjection,
    timelineOpen: viewport.timelineOpen,
    timelinePlayhead: viewport.timelinePlayhead,
    timelinePlaying: viewport.timelinePlaying,
    timelinePreviewFrame: viewport.timelinePreviewFrame,
    timelapseCapturing: viewport.timelapseCapturing,
    tool: viewport.tool,
    webtoonTheme: viewport.webtoonTheme,
    wetMixArmed: viewport.wetMixArmed,
  };
  const toolLayerProps: StudioCanvasViewportToolLayersProps = {
    activeSurfaceReviewLocked: viewport.activeSurfaceReviewLocked,
    advancedRulers: viewport.advancedRulers,
    appSettings: viewport.appSettings,
    beginSharedGutterDrag: viewport.stableHandlers.beginSharedGutterDrag,
    brush: viewport.brush,
    brushCursorRef: viewport.brushCursorRef,
    brushCursorStyle,
    stabilizer: viewport.stabilizer,
    canvasH: viewport.canvasH,
    bubbleShapeActiveHandleIndex: viewport.bubbleShapeActiveHandleIndex,
    bubbleShapeArmed: viewport.bubbleShapeArmed,
    bubbleShapeHandles: viewport.bubbleShapeHandles,
    cancelStudioDrawingAssistPreview: viewport.stableHandlers.cancelStudioDrawingAssistPreview,
    canvasInteractionBlocked: viewport.canvasInteractionBlocked,
    commitIsometricOrigin: viewport.stableHandlers.commitIsometricOrigin,
    commitSharedGutterDrag: viewport.stableHandlers.commitSharedGutterDrag,
    cropRect: viewport.cropRect,
    dodgeBurnArmed: viewport.dodgeBurnArmed,
    dodgeBurnRadius: viewport.dodgeBurnRadius,
    draftPreviewDynamicLayerRef: viewport.draftPreviewDynamicLayerRef,
    draftPreviewNormalLayerRef: viewport.draftPreviewNormalLayerRef,
    draftPreviewStore: viewport.draftPreviewStore,
    drawMode: viewport.drawMode,
    effScale: viewport.effScale,
    eraserPresetActive: interaction.eraserPresetActive,
    filterMaskCursorRef: viewport.filterMaskCursorRef,
    filterMaskDragPreview: viewport.filterMaskDragPreview,
    filterMaskPaintArmed: viewport.filterMaskPaintArmed,
    filterMaskPaintMode: viewport.filterMaskPaintMode,
    filterMaskRadius: viewport.filterMaskRadius,
    gpuCanvasShadowVisibleRef: viewport.gpuCanvasShadowVisibleRef,
    gpuLiveInkPinnedRef: viewport.gpuLiveInkPinnedRef,
    guides: viewport.guides,
    healCloneArmed: viewport.healCloneArmed,
    healCloneCursorRef: viewport.healCloneCursorRef,
    healCloneDragPreview: viewport.healCloneDragPreview,
    healCloneRadius: viewport.healCloneRadius,
    healCloneSourceAnchor: viewport.healCloneSourceAnchor,
    healCloneSourceCursorRef: viewport.healCloneSourceCursorRef,
    healCloneTool: viewport.healCloneTool,
    historyBrushArmed: viewport.historyBrushArmed,
    historyBrushCursorRef: viewport.historyBrushCursorRef,
    historyBrushDragPreview: viewport.historyBrushDragPreview,
    historyBrushRadius: viewport.historyBrushRadius,
    isExporting: viewport.isExporting,
    isometricAngleDeg: viewport.isometricAngleDeg,
    isometricCellSize: viewport.isometricCellSize,
    isometricGridActive: viewport.isometricGridActive,
    isometricOriginX: viewport.isometricOriginX,
    isometricOriginY: viewport.isometricOriginY,
    isPanning: viewport.isPanning,
    isSpacePressed: viewport.isSpacePressed,
    layerMaskCursorRef: viewport.layerMaskCursorRef,
    layerMaskDragPreview: viewport.layerMaskDragPreview,
    layerMaskPaintArmed: viewport.layerMaskPaintArmed,
    layerMaskPaintMode: viewport.layerMaskPaintMode,
    layerMaskRadius: viewport.layerMaskRadius,
    liquifyArmed: viewport.liquifyArmed,
    liquifyPreviewImageRef: viewport.liquifyPreviewImageRef,
    liquifyRadius: viewport.liquifyRadius,
    liveDraftDirectRef: viewport.liveDraftDirectRef,
    liveDraftLayerRef: viewport.liveDraftLayerRef,
    liveDraftVisualRef: viewport.liveDraftVisualRef,
    liveDynamicBrushOverlayRenderer: viewport.liveDynamicBrushOverlayRenderer,
    liveInkOverlayRendererRef: viewport.liveInkOverlayRendererRef,
    liveTransformDraftStore,
    liveTransformDraftScope,
    liveRetainedMediaOverlayRenderer: viewport.liveRetainedMediaOverlayRenderer,
    liveStampOverlayRenderer: viewport.liveStampOverlayRenderer,
    liveWetInkOverlayRenderer: viewport.liveWetInkOverlayRenderer,
    livingInkOverlayVisibleRef: viewport.livingInkOverlayVisibleRef,
    lowDensityEraserActive: interaction.lowDensityEraserActive,
    paperSurfaceForLiveTransform: live.paperSurfaceForPreview,
    marqueeRectNodeRef: viewport.marqueeRectNodeRef,
    masterEditMode: viewport.masterEditMode,
    moveVanishingPointById: viewport.stableHandlers.moveVanishingPointById,
    nodeEditActiveHandleIndex: viewport.nodeEditActiveHandleIndex,
    nodeEditArmed: viewport.nodeEditArmed,
    nodeEditDraft: viewport.nodeEditDraft,
    nodeEditHandles: viewport.nodeEditHandles,
    nodeEditTool: viewport.nodeEditTool,
    paintRetouchStrokeLineRef: viewport.paintRetouchStrokeLineRef,
    panelGutter: viewport.panelGutter,
    panelSplitPreview: viewport.panelSplitPreview,
    patchAdvancedRuler: viewport.stableHandlers.patchAdvancedRuler,
    perspectiveEyeLevelY: viewport.perspectiveEyeLevelY,
    perspectiveLockHorizon: viewport.perspectiveLockHorizon,
    perspectiveRulerActive: viewport.perspectiveRulerActive,
    pixelDragPreview: viewport.pixelDragPreview,
    pixelOverlayFrame: viewport.pixelOverlayFrame,
    pixelOverlaySel: viewport.pixelOverlaySel,
    polyLassoHover: viewport.polyLassoHover,
    polyLassoSession: viewport.polyLassoSession,
    previewAdvancedRuler: viewport.stableHandlers.previewAdvancedRuler,
    previewIsometricOrigin: viewport.stableHandlers.previewIsometricOrigin,
    previewPerspectiveEyeLevelY: viewport.stableHandlers.previewPerspectiveEyeLevelY,
    previewSharedGutterDrag: viewport.stableHandlers.previewSharedGutterDrag,
    previewVanishingPointById: viewport.stableHandlers.previewVanishingPointById,
    puppetWarpArmed: viewport.puppetWarpArmed,
    puppetWarpBusy: viewport.puppetWarpBusy,
    puppetWarpPins: viewport.puppetWarpPins,
    quickMaskArmed: viewport.quickMaskArmed,
    quickMaskBrushMode: viewport.quickMaskBrushMode,
    quickMaskDragPreview: viewport.quickMaskDragPreview,
    quickMaskRadius: viewport.quickMaskRadius,
    quickMaskTintCanvas: viewport.quickMaskTintCanvas,
    quickMaskTintColor: viewport.quickMaskTintColor,
    quickMaskTintOpacity: viewport.quickMaskTintOpacity,
    saving: viewport.saving,
    selected: viewport.selected,
    setPuppetWarpPins: viewport.setPuppetWarpPins,
    setSymmetryCenterX: viewport.setSymmetryCenterX,
    setSymmetryCenterY: viewport.setSymmetryCenterY,
    setUserGuides: viewport.setUserGuides,
    sharedGutters: viewport.sharedGutters,
    singleObjectDragLayerRef: interaction.singleObjectDragLayerRef,
    smartGuides: viewport.smartGuides,
    smudgeArmed: viewport.smudgeArmed,
    smudgeCursorRef: viewport.smudgeCursorRef,
    smudgeRadius: viewport.smudgeRadius,
    strokeGuideRef: viewport.strokeGuideRef,
    strokeWidth: viewport.strokeWidth,
    symmetryCenterX: viewport.symmetryCenterX,
    symmetryCenterY: viewport.symmetryCenterY,
    symmetryRadialCount: viewport.symmetryRadialCount,
    symmetryType: viewport.symmetryType,
    tipAngle: viewport.tipAngle,
    tipRoundness: viewport.tipRoundness,
    tool: viewport.tool,
    userGuides: viewport.userGuides,
    vanishingPoints: viewport.vanishingPoints,
    wetMixArmed: viewport.wetMixArmed,
    wetMixRadius: viewport.wetMixRadius,
    setPerspectiveEyeLevelY: viewport.stableHandlers.setPerspectiveEyeLevelY,
  };
  const domOverlayProps: StudioCanvasViewportDomOverlaysProps = {
    acceleratedSceneSelectedIds: live.acceleratedSceneSelectedIds,
    canonicalDryMediaCanvasVisible: live.canonicalDryMediaCanvasVisible,
    canonicalDryMediaCandidate: live.canonicalDryMediaCandidate,
    canonicalDryMediaLayoutKey: live.canonicalDryMediaLayoutKey,
    canvasFlipH: viewport.canvasFlipH,
    canvasH: viewport.canvasH,
    velloHubAuthority: live.velloHubAuthority,
    velloDocumentSurfaceEnabled: live.velloDocumentSurfaceEnabled,
    effScale: viewport.effScale,
    elements: live.velloDocumentElements,
    hokusaiLiveCanvasRef: live.hokusaiLiveCanvasRef,
    inkMeshLivePreviewRuntime: viewport.inkMeshLivePreviewRuntime,
    liveDynamicBrushOverlayRenderer: viewport.liveDynamicBrushOverlayRenderer,
    liveInkOverlayRenderer: viewport.liveInkOverlayRenderer,
    liveInkPredictionRenderer: viewport.liveInkPredictionRenderer,
    liveRetainedMediaOverlayRenderer: viewport.liveRetainedMediaOverlayRenderer,
    liveStampOverlayRenderer: viewport.liveStampOverlayRenderer,
    liveWetInkOverlayRenderer: viewport.liveWetInkOverlayRenderer,
    livingInkCanvasRef: live.livingInkCanvasRef,
    onWebGpuBackendChange: viewport.stableHandlers.onWebGpuBackendChange,
    onWebGpuDeviceLost: viewport.stableHandlers.onWebGpuDeviceLost,
    onWebGpuFrameInvalid: viewport.stableHandlers.onWebGpuFrameInvalid,
    onWebGpuFrameReady: viewport.stableHandlers.onWebGpuFrameReady,
    onWebGpuFrameRequest: viewport.stableHandlers.onWebGpuFrameRequest,
    pixiMountParent: live.pixiMountParent,
    pixiSceneDocumentTransform: live.pixiSceneDocumentTransform,
    velloSceneDocumentTransform: live.velloSceneDocumentTransform,
    velloSceneRevision: live.velloSceneRevision,
    velloSurfaceDpr: live.velloSurfaceDpr,
    readVelloHubPenDown: live.readVelloHubPenDown,
    setCanonicalDryMediaCanvasAuthority: live.setCanonicalDryMediaCanvasAuthority,
    setVelloHubAuthority: live.setVelloHubAuthority,
    setWebGpuCanvasHandle: viewport.stableHandlers.setWebGpuCanvasHandle,
    stageViewLayout: live.stageViewLayout,
    transientPenInkSurfaceEnabled: viewport.transientPenInkSurfaceEnabled,
    velloHubCapability: live.velloHubCapability,
    webGpuPreviewAuthorized: viewport.webGpuPreviewAuthorized,
    webGpuPreviewStrokes: viewport.webGpuPreviewStrokes,
    webGpuViewportSurface: viewport.webGpuViewportSurface,
  };

  return (
    <>
          {/* 페이지 색보정 미리보기: Stage에 CSS filter, 그 위에 비네트 오버레이(내보내기 때 픽셀로 합성) */}
          {/* 색맹 시뮬레이션은 이미 색보정된 결과 위에 적용되도록 pageGradeCss 뒤에 이어 붙인다(filter 리스트는 좌→우로 순차 적용). */}
          {/* Raster handoff colocation contract — the data-studio-post-processing-scope div below
              applies the page grade + colour-vision CSS filters to the Konva Stage AND the DOM
              raster surface alike, so handed-off pixels match the vector presentation exactly.
              This is what lets the postProcessing handoff gate stay open for those inputs; the
              invariant (surface + Stage share this filter ancestor, vignette stays outside) is
              pinned by studio-raster-handoff-authority.test.ts. */}
          <div
            ref={bindZoomHost}
            data-studio-canvas-cursor={canvasCursorClassName.replace("cursor-", "")}
            data-studio-brush-cursor-style={
              tool === "draw" && isStudioBrushCursorMode(drawMode)
                ? brushCursorStyle
                : undefined
            }
            data-studio-brush-cursor-brush={
              tool === "draw" && isStudioBrushCursorMode(drawMode)
                ? drawMode === "eraser" && !eraserPresetActive ? "eraser" : brush
                : undefined
            }
            data-studio-comment-placement-active={commentPinArmed ? "true" : undefined}
            data-studio-vello-hub-authority={velloHubAuthority.status}
            data-studio-vello-hub-backend={velloHubAuthority.backendId ?? undefined}
            data-studio-frame-graph-document={
              frameGraphOwnsDocumentPixels ? "vello-skia" : "konva-shadow"
            }
            className={cn(
              "relative rounded-sm shadow-[0_0_0_1px_oklch(0.3_0.012_64/0.55),0_18px_50px_oklch(0.08_0.01_70/0.45)]",
              canvasCursorClassName,
              hardCanvasInteractionBlock && "pointer-events-none select-none",
              (sourceHydrationPending || collaborationDocumentUnavailable) && "invisible absolute inset-0"
            )}
            style={{
              // 줌 호스트는 항상 문서 박스를 유지한다 — 스크롤 범위, 드롭 좌표, 줌 앵커,
              // WebGPU/라이브잉크 오버레이 좌표계가 전부 이 박스를 기준으로 한다.
              // 뷰포트 클립이 줄이는 것은 아래 Konva Stage 하나뿐이다.
              height: stageViewLayout.hostHeight,
              isolation: "isolate",
              width: stageViewLayout.hostWidth,
            }}
          >
          <div
            data-studio-post-processing-scope=""
            className="relative"
            style={{
              filter: [pageGradeCss, colorBlindFilterStyle(colorBlindPreview).filter].filter(Boolean).join(" ") || undefined,
              // 클립된 Stage 는 흐름에서 빠지므로(absolute) 이 래퍼에 문서 박스를 명시로 박는다.
              // 안 그러면 래퍼가 높이 0 으로 붕괴하고, inset-0 오버레이와 스크롤 범위가 함께 죽는다.
              height: stageViewLayout.hostHeight,
              width: stageViewLayout.hostWidth,
            }}
          >
          <Profiler id="studio:stage" onRender={recordStudioRenderProfile}>
          <Stage
            ref={stageRef}
            width={stageViewLayout.width}
            height={stageViewLayout.height}
            style={stageViewClip ? STUDIO_STAGE_CLIPPED_STYLE : STUDIO_STAGE_DOCUMENT_STYLE}
            scaleX={stageViewLayout.scaleX}
            scaleY={stageViewLayout.scaleY}
            x={stageViewLayout.x}
            y={stageViewLayout.y}
            rotation={stageViewLayout.rotation}
            onPointerDown={onStageDown}
            onPointerMove={onStageMove}
            onPointerUp={onStageUp}
            onPointerCancel={cancelSingleObjectDragLayer}
            onPointerLeave={() => {
              studioLiveRoomRef.current?.clearCursor();
              clearAdvancedFillTapGesture();
              hideBrushCursor();
              hideSmudgeCursor();
              hideHealCloneCursors();
              hideHistoryBrushCursor();
              hideLayerMaskCursor();
              hideFilterMaskCursor();
            }}
            onPointerOut={() => {
              studioLiveRoomRef.current?.clearCursor();
              clearAdvancedFillTapGesture();
              hideBrushCursor();
              hideSmudgeCursor();
              hideHealCloneCursors();
              hideHistoryBrushCursor();
              hideLayerMaskCursor();
              hideFilterMaskCursor();
            }}
            onClick={narrowCanvasSelectionOnRelease}
            onTap={narrowCanvasSelectionOnRelease}
            onDblClick={enterGroupFromCanvasGesture}
            onDblTap={enterGroupFromCanvasGesture}
            onMouseLeave={() => {
              studioLiveRoomRef.current?.clearCursor();
              clearAdvancedFillTapGesture();
              hideBrushCursor();
              hideSmudgeCursor();
              hideHealCloneCursors();
              hideHistoryBrushCursor();
              hideLayerMaskCursor();
              hideFilterMaskCursor();
            }}
            onDragStart={beginSingleObjectDragLayer}
            onDragMove={onStageDragMove}
            onDragEnd={finishSingleObjectDragLayer}
            onContextMenu={(e) => {
              e.evt.preventDefault();
              if (canvasInteractionBlocked || commentPinArmed) return;
              const stage = stageRef.current;
              if (!stage) return;
              const pointerPos = stage.getPointerPosition();
              let clickedElId: string | null = null;
              if (pointerPos) {
                const shape = stage.getIntersection(pointerPos);
                if (shape) {
                  const elId = studioElementIdOf(shape);
                  if (elId) {
                    clickedElId = elId;
                    setTool("select");
                    // 우클릭도 일반 클릭과 같은 그룹 단위 선택 계약을 사용한다. 자식 하나로
                    // selection state를 덮어쓰면 삭제·복제·정렬 메뉴가 그룹을 찢을 수 있다.
                    selectElementFromCanvas(elId);
                  }
                }
              }
              setContextMenu({
                visible: true,
                x: e.evt.clientX,
                y: e.evt.clientY,
                elId: clickedElId,
              });
            }}
          >
            {/* 배경 전용 레이어 — 지우개(destination-out)는 위 콘텐츠 레이어만 지우므로 배경은 보존된다.
                (다크 테마에서 지운 자리로 페이지가 비쳐 검정으로 보이던 문제 해결) */}
            <Layer listening={true}>
              <Rect
                name="bg"
                x={0}
                y={0}
                width={CANVAS_W}
                height={canvasH}
                fill={bgGrad ? undefined : bg}
                fillLinearGradientStartPoint={bgGrad ? { x: 0, y: 0 } : undefined}
                fillLinearGradientEndPoint={bgGrad ? { x: 0, y: canvasH } : undefined}
                fillLinearGradientColorStops={
                  bgGrad
                    ? (studioBackgroundGradientColorStops(bgGrad) as (string | number)[])
                    : undefined
                }
              />
              {/* Seamless paper grain — same height field as brush granulation, 128² tile + pattern repeat. */}
              {paperGrainPatternImage ? (
                <Rect
                  name="paper-grain"
                  x={0}
                  y={0}
                  width={CANVAS_W}
                  height={canvasH}
                  listening={false}
                  perfectDrawEnabled={false}
                  // Konva runtime accepts canvas tiles; React-Konva props narrow to HTMLImageElement.
                  fillPatternImage={paperGrainPatternImage as unknown as HTMLImageElement}
                  fillPatternRepeat="repeat"
                  fillPatternScaleX={1}
                  fillPatternScaleY={1}
                  opacity={paperGrainOpacity}
                  globalCompositeOperation="multiply"
                />
              ) : null}
            </Layer>
            <Layer ref={mainLayerRef}>
              <StudioCanvasGuideUnderlay
                canvasWidth={CANVAS_W}
                canvasHeight={canvasH}
                effScale={effScale}
                gridSize={gridSize}
                showGrid={showGrid}
                showWebtoonGuides={showWebtoonGuides}
                webtoonGuides={webtoonGuides}
              />
              <Group
                name={STUDIO_KONVA_DOCUMENT_SHADOW_NAME}
                opacity={frameGraphOwnsDocumentPixels ? 0 : 1}
              >
                <StudioCanvasViewportDocumentLayer {...documentLayerProps} />
              </Group>
              {renderStudioCanvasSelectionDecorations({
                activeGroupId,
                activeSurfaceReviewLocked,
                beginCanvasSelectionResize,
                cancelCanvasSelectionResize: finalizeCanvasSelectionResize,
                canvasSelectionResizeCancelSignal: viewport.canvasSelectionResizeCancelSignal,
                canvasH,
                canvasSelectionEls,
                commitCanvasSelectionResize,
                completeSelectionGroup,
                effScale,
                elements,
                groupResizeEnabled,
                groups,
                hasCoarsePointer,
                isExporting,
                isMobile,
                marqueeIds,
                multiSelectionBounds,
                selected,
                selectionLockState,
                selectionRotatable,
                singleDrawFreeScale,
                singleObjectDragLayerRef: interaction.singleObjectDragLayerRef,
                liveTransformDraftStore,
                liveTransformDraftScope,
                tool,
                trRef,
              })}
              {/* 지우개 다이렉트 라이브 초안: destination-out 으로 메인 레이어 콘텐츠를 직접 실시간 소거 */}
              {tool === "draw" && (
                <Shape
                  // This carrier is visible to Konva but paints only while the draw tool is active.
                  // The explicit promise keeps select-mode transform z-order preflight from
                  // classifying an empty draft carrier as authored artwork above the stroke.
                  studioLiveTransformZOrderExempt
                  sceneFunc={(context) => {
                    const el = liveDraftVisualRef.current;
                    if (!el || !liveDraftDirectRef.current || el.mode !== "eraser") return;
                    drawLiveFreehandDraftToContext(context, el);
                  }}
                  listening={false}
                  perfectDrawEnabled={false}
                />
              )}
            </Layer>
            <StudioCanvasViewportToolLayers {...toolLayerProps} />
          </Stage>
          </Profiler>
          {STUDIO_AUTOMATIC_RASTER_PUBLICATION_ENABLED && webGpuViewportSurface ? (
            <Suspense fallback={null}>
              <StudioRasterCrdtSurface
                className="z-[9]"
                document={studioCrdtDocument}
                workId={authorizedWorkAssetScopeId}
                surfaceId={`raster:${activePage.id}:ink`}
                viewport={webGpuViewportSurface}
                visibleDocumentRect={studioRasterVisibleDocumentRect}
                handoff={{
                  baseKey: studioRasterHandoffBaseKey,
                  pageId: activePage.id,
                  documentWidth: CANVAS_W,
                  documentHeight: canvasH,
                  elements: studioRasterOverlayElements,
                  gates: studioRasterHandoffGates,
                }}
                authorizedAuthorityKey={studioRasterAuthorizedAuthorityKey}
                hidden={studioRasterHandoffBlocked}
                onHandoffCandidateChange={setStudioRasterHandoffCandidate}
                onError={(message) => setError((current) => current ?? message)}
              />
            </Suspense>
          ) : null}
          <StudioCanvasViewportDomOverlays {...domOverlayProps} />
          </div>
          {/* 비네트는 CSS filter가 아니라 별도 오버레이 — 필터 래퍼(post-processing scope) 밖의
              후행 형제라, z-[9] 래스터 표면이 래퍼의 스태킹 컨텍스트(필터가 있을 때만 생김)를
              벗어나면 비네트 위로 올라와 픽셀이 어긋날 수 있다. 그래서 pageGrade.vignette 는
              래스터 핸드오프 postProcessing 게이트에서 유일하게 veto 를 유지한다(fail closed).
              이 오버레이를 래퍼 안으로 옮기면 계약 테스트가 게이트 재검토를 강제한다. */}
          {pageGrade.vignette > 0 && (
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: vignetteCss(pageGrade.vignette) }}
            />
          )}
          {!masterEditMode ? (
            <Suspense fallback={null}>
              <StudioRemoteCursorOverlay
                pageId={activePage.id}
                followingSessionId={followingStudioSessionId}
                canvasWidth={CANVAS_W}
                canvasHeight={canvasH}
                trailSuppressedSessionIds={studioLiveGesturePreviewTrailSuppressedSessionIds}
                hidden={isExporting || sourceHydrationPending || collaborationDocumentUnavailable}
                commentPins={studioCanvasCommentPins}
                flipX={canvasFlipH}
                rotation={canvasRotation}
                commentQuickReplyActive={commentQuickReplyActive}
                onCommentQuickReplyPreload={preloadStudioCommentThreadPopover}
                onCommentPinClick={openStudioCommentThreadPopover}
                onCommentPinReanchor={reanchorStudioCommentPin}
                commentPinReanchorableThreadIds={studioCommentPinReanchorableThreadIds}
                commentPinReanchorDisabledReason={studioCommentPinReanchorDisabledReason}
              />
            </Suspense>
          ) : null}
          {editingUseOverlay ? (
            <Suspense fallback={null}>
              <StudioTextEditOverlay
                key={editing!.id}
                elementId={editing!.id}
                elementById={elementById}
                nodeRefsRef={nodeRefsRef}
                effScale={effScale}
                stageOriginOffsetX={stageViewClip?.left ?? 0}
                stageOriginOffsetY={stageViewClip?.top ?? 0}
                onCommit={commitEditText}
                onCancel={cancelEditText}
              />
            </Suspense>
          ) : null}
          </div>
    </>
  );
}
