/* Extracted render tree from StudioCuttoonEditor.
 * Session props are an `any` bag matching the original editor closure. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import { Suspense } from "react";
import { StudioBrushHud } from "../brush/StudioBrushHud";
import { isStudioBrushCursorMode } from "../canvas/studio-canvas-cursor";
import { StudioCanvasViewport } from "../canvas/StudioCanvasViewport";
import { CANVAS_W } from "../studio-assets";
import { StudioCommentThreadPopover, StudioPointCommentComposer, StudioCanvasRulerBars } from "../studio-page-lazy-ui";
import { STUDIO_TRANSIENT_PEN_INK_SURFACE_ENABLED } from "../studio-page-shell-runtime";
import { StudioScrollViewportSubscriber } from "../StudioScrollViewportSubscriber";
import { StudioSelectionContextBar } from "../StudioSelectionContextBar";
import { cn } from "@/shared/lib/utils";
import type { StudioCuttoonEditorViewSession } from "./StudioCuttoonEditorViewSession";

export function StudioCuttoonEditorCanvasColumn(s: StudioCuttoonEditorViewSession) {
  const {
    activeCatalogBrush,
    activeDialogueLocale,
    activeGroupId,
    activePage,
    activePageIndex,
    activeServerAiProviderLabel,
    activeSurfaceReviewLocked,
    advancedFillActive,
    advancedFillArmed,
    advancedFillBusy,
    advancedFillPreview,
    advancedRulers,
    aiNoticeOpen,
    animTimeline,
    appSettings,
    appSettingsInitialTab,
    appSettingsOpen,
    appSettingsPersistenceState,
    authorizedWorkAssetScopeId,
    autosaveRestoreBlockedReason,
    bgGrad,
    brush,
    brushCursorRef,
    brushOpacity,
    bubbleShapeActiveHandleIndex,
    bubbleShapeArmed,
    bubbleShapeDraft,
    bubbleShapeHandles,
    cancelStudioPointCommentComposer,
    canvasFlipH,
    canvasGuides,
    canvasH,
    canvasInteractionBlocked,
    canvasOnlyMode,
    canvasRotation,
    changeStudioCommentThreadReplyDraft,
    changeStudioCommentThreadResolution,
    closeStudioCommentThreadPopover,
    collaborationDocumentLocked,
    collaborationDocumentUnavailable,
    collaborationLockMessage,
    color,
    colorBlindPreview,
    colorWheelOpen,
    commentPinArmed,
    cropArmed,
    cropRect,
    currentCanvasSelectionCount,
    dialogueBatchOpen,
    dialogueTranslateOpen,
    dodgeBurnArmed,
    dodgeBurnRadius,
    draftPreviewDynamicLayerRef,
    draftPreviewNormalLayerRef,
    draftPreviewStore,
    drawMode,
    drawShape,
    drawingRef,
    editing,
    effScale,
    elementById,
    elements,
    eyedropperActive,
    filterMaskCursorRef,
    filterMaskDragPreview,
    filterMaskPaintArmed,
    filterMaskPaintMode,
    filterMaskRadius,
    followingStudioSessionId,
    frameAnimEl,
    frameAnimOpen,
    frameAnimTargetId,
    gpuCanvasShadowVisibleRef,
    gpuLiveInkPinnedRef,
    gridSize,
    groups,
    guides,
    hardCanvasInteractionBlock,
    hasAutosave,
    healCloneArmed,
    healCloneCursorRef,
    healCloneDragPreview,
    healCloneRadius,
    healCloneSourceAnchor,
    healCloneSourceCursorRef,
    healCloneTool,
    historyBrushArmed,
    historyBrushCursorRef,
    historyBrushDragPreview,
    historyBrushRadius,
    historyBrushSourceIndex,
    historyPanelOpen,
    inkMeshLivePreviewRuntime,
    isExporting,
    isMobile,
    isPanning,
    isSpacePressed,
    isometricAngleDeg,
    isometricCellSize,
    isometricGridActive,
    isometricOriginX,
    isometricOriginY,
    layerMaskCursorRef,
    layerMaskDragPreview,
    layerMaskPaintArmed,
    layerMaskPaintMode,
    layerMaskRadius,
    liquifyArmed,
    liquifyPreviewImageRef,
    liquifyRadius,
    liveDraftDirectRef,
    liveDraftLayerRef,
    liveDraftVisualRef,
    liveDrawPressureStore,
    liveDynamicBrushOverlayRenderer,
    liveInkOverlayRenderer,
    liveInkOverlayRendererRef,
    liveInkPredictionRenderer,
    liveRetainedMediaOverlayRenderer,
    liveStampOverlayRenderer,
    liveWetInkOverlayRenderer,
    livingInkOverlayVisibleRef,
    localHiddenElementIds,
    mainLayerRef,
    marqueeIds,
    marqueeRectNodeRef,
    master,
    masterEditMode,
    masterPanelOpen,
    mobileImmersive,
    mobileKeyboardInset,
    navigate,
    navigateStudioCommentPinCluster,
    nodeEditActiveHandleIndex,
    nodeEditArmed,
    nodeEditDraft,
    nodeEditHandles,
    nodeEditTool,
    nodeRefsRef,
    onionSkin,
    openStudioCommentInbox,
    openStudioCommentThreadInReview,
    pageEditLocked,
    pageGrade,
    pageGradeCss,
    pageSequenceOpen,
    pages,
    pagesHi,
    pagesHistory,
    paintRetouchStrokeLineRef,
    panelGutter,
    panelSplitArmed,
    panelSplitPreview,
    perspectiveEyeLevelY,
    perspectiveLockHorizon,
    perspectiveRulerActive,
    pixelDragPreview,
    pixelOverlayFrame,
    pixelOverlaySel,
    pixelToolArmed,
    pointCommentComposer,
    polyLassoHover,
    polyLassoSession,
    pressureCurve,
    puppetWarpArmed,
    puppetWarpBusy,
    puppetWarpPins,
    quickMaskArmed,
    quickMaskBrushMode,
    quickMaskDragPreview,
    quickMaskRadius,
    quickMaskTintCanvas,
    quickMaskTintColor,
    quickMaskTintOpacity,
    quickShapeActive,
    saving,
    scale,
    scrollPos,
    scrollViewportStore,
    selected,
    selectedId,
    setAppSettingsInitialTab,
    setAppSettingsOpen,
    setBg3dOpen,
    setCanvasGuides,
    setCanvasOnlyMode,
    setContextMenu,
    setDialogueBatchOpen,
    setDialogueTranslateOpen,
    setError,
    setEyedropperActive,
    setFollowingStudioSessionId,
    setFrameAnimOpen,
    setFrameAnimTargetId,
    setHistoryPanelOpen,
    setLeftPanelOpenWithOverride,
    setMarqueeIds,
    setMasterEditMode,
    setMasterPanelOpen,
    setOnionSkin,
    setPageSequenceOpen,
    setPointCommentComposer,
    setPoserVrmOpen,
    setPuppetWarpPins,
    setQuickShapeActive,
    setQuickStartOpen,
    setSelectedId,
    setSharedDocumentNotice,
    setShortcutsOpen,
    setStudioRasterHandoffCandidate,
    setSymmetryCenterX,
    setSymmetryCenterY,
    setTeamPanelOpen,
    setTimelineFocusedTrackId,
    setTimelineOpen,
    setTimelinePlayhead,
    setTimelinePlaying,
    setTool,
    setTranslateDraft,
    setTranslateGlossary,
    setTranslateTargetLocale,
    setTutorialHubOpen,
    setUserGuides,
    setZoom,
    setZoomLocked,
    shapeFill,
    sharedGutters,
    shortcutsOpen,
    showGrid,
    showQuickStart,
    showRulers,
    showWebtoonGuides,
    smartGuides,
    smudgeArmed,
    smudgeCursorRef,
    smudgeRadius,
    sourceHydrationPending,
    stabilizer,
    stabilizerMode,
    stageRef,
    strokeGuideRef,
    strokeWidth,
    studioBrushR8GrainRenderElements,
    studioCanvasCommentPins,
    studioCanvasViewportHandlers,
    studioCanvasWorkAssetRenderProjection,
    studioCommentActor,
    studioCommentInteractionNotice,
    studioCommentPinReanchorDisabledReason,
    studioCommentPinReanchorableThreadIds,
    studioCommentSyncError,
    studioCommentThreadPopoverScreenProjectionHandlers,
    studioCommentThreadPopoverTarget,
    studioCommentThreadSession,
    studioCommentThreadSessionView,
    studioCrdtDocument,
    studioCrdtOperationSyncReady,
    studioFilterMaskMasterRenderElements,
    studioFilterPreview,
    studioFilterSession,
    studioLegacyCommentThreadIdSet,
    studioLiveJam,
    studioLiveRoomRef,
    studioOnCanvasSurfaceHandlers,
    studioPointCommentScreenProjectionHandlers,
    studioRasterAuthorizedAuthorityKey,
    studioRasterHandoffBlocked,
    studioRasterHandoffGates,
    studioRasterHiddenOperationIds,
    studioRasterOverlayElements,
    studioTeamCommentCapabilities,
    studioTeamCommentsSyncing,
    studioTeamCommentsWorkId,
    studioWorkAssetRenderPlaceholders,
    submitStudioCommentThreadReply,
    submitStudioPointComment,
    symmetryCenterX,
    symmetryCenterY,
    symmetryRadialCount,
    symmetryType,
    textAiConfigured,
    timelapseCapturing,
    timelineFocusedTrackId,
    timelineOpen,
    timelinePlayhead,
    timelinePlaying,
    timelinePreviewFrame,
    tipAngle,
    tipRoundness,
    title,
    tool,
    trRef,
    translateBusy,
    translateDraft,
    translateError,
    translateGlossary,
    translateProgress,
    translateTargetLocale,
    tutorialHubOpen,
    tutorialInitialId,
    uiDensityMode,
    userGuides,
    vanishingPoints,
    viewTool,
    viewTransformSuppressed,
    webGpuPreviewAuthorized,
    webGpuPreviewStrokes,
    webGpuViewportSurface,
    webtoonGuides,
    webtoonTheme,
    wetMixArmed,
    wetMixRadius,
    workHydrationFailed,
    workHydrationUnsupportedFormat,
    workId,
    workspaceControlSide,
    wrapRef,
    zoom,
    zoomHostRef,
    zoomLocked,
    autosaveDocumentLeadership,
    bg,
    drawingShortcutNoticeStore,
    remixId,
    studioLiveGesturePreviewAdapter,
    studioRasterHandoffBaseKey,
    studioRasterVisibleDocumentRect,
  } = s;
  return (
          <div
            id="studio-canvas-workspace"
            role="region"
            aria-label="캔버스 작업영역"
            tabIndex={-1}
            className={cn(
              "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
              showRulers && !canvasOnlyMode && "lg:pl-[22px] lg:pt-[22px]"
            )}
            data-studio-canvas-ruler-layout={
              showRulers && !canvasOnlyMode ? "inset-top-left" : "off"
            }
          >
          {showRulers && !canvasOnlyMode ? (
            <Suspense fallback={null}>
              {/* 룰러 눈금은 스크롤 오프셋을 프레임 단위로 따라가야 한다. 스토어를 구독해
                  이 서브트리만 다시 그리고, 페이지 커밋은 만들지 않는다. */}
              <StudioScrollViewportSubscriber
                store={scrollViewportStore}
                render={(viewport) => (
                  <StudioCanvasRulerBars
                    visible
                    scale={effScale}
                    scrollLeft={viewport.left}
                    scrollTop={viewport.top}
                    canvasWidth={CANVAS_W}
                    canvasHeight={canvasH}
                    guides={canvasGuides}
                    onAddGuide={(axis, pos) => {
                      setCanvasGuides((g) => ({
                        ...g,
                        [axis === "h" ? "horizontal" : "vertical"]: [
                          ...g[axis === "h" ? "horizontal" : "vertical"],
                          pos,
                        ],
                      }));
                    }}
                  />
                )}
              />
            </Suspense>
          ) : null}
          <StudioCanvasViewport
          liveDynamicBrushOverlayRenderer={liveDynamicBrushOverlayRenderer}
          liveWetInkOverlayRenderer={liveWetInkOverlayRenderer}
          inkMeshLivePreviewRuntime={inkMeshLivePreviewRuntime}
          liveInkPredictionRenderer={liveInkPredictionRenderer}
          liveRetainedMediaOverlayRenderer={liveRetainedMediaOverlayRenderer}
          liveStampOverlayRenderer={liveStampOverlayRenderer}
          bubbleShapeActiveHandleIndex={bubbleShapeActiveHandleIndex}
          draftPreviewStore={draftPreviewStore}
          liveDrawPressureStore={liveDrawPressureStore}
          liveInkOverlayRenderer={liveInkOverlayRenderer}
          nodeEditActiveHandleIndex={nodeEditActiveHandleIndex}
          activeDialogueLocale={activeDialogueLocale}
          activeCatalogBrushName={activeCatalogBrush.name}
          activePage={activePage}
          activePageIndex={activePageIndex}
          activeSurfaceReviewLocked={activeSurfaceReviewLocked}
          activeServerAiProviderLabel={activeServerAiProviderLabel}
          advancedFillActive={advancedFillActive}
          advancedFillArmed={advancedFillArmed}
          advancedFillBusy={advancedFillBusy}
          advancedFillPreview={advancedFillPreview}
          advancedRulers={advancedRulers}
          aiNoticeOpen={aiNoticeOpen}
          animTimeline={animTimeline}
          appSettings={appSettings}
          appSettingsInitialTab={appSettingsInitialTab}
          appSettingsOpen={appSettingsOpen}
          appSettingsPersistenceState={appSettingsPersistenceState}
          authorizedWorkAssetScopeId={authorizedWorkAssetScopeId}
          autosaveRestoreBlockedReason={autosaveRestoreBlockedReason}
          bg={bg}
          bgGrad={bgGrad}
          brush={brush}
          brushCursorRef={brushCursorRef}
          strokeGuideRef={strokeGuideRef}
          brushOpacity={brushOpacity}
          bubbleShapeArmed={bubbleShapeArmed}
          bubbleShapeDraft={bubbleShapeDraft}
          bubbleShapeHandles={bubbleShapeHandles}
          canvasFlipH={canvasFlipH}
          canvasRotation={canvasRotation}
          canvasH={canvasH}
          canvasOnlyMode={canvasOnlyMode}
          canvasInteractionBlocked={canvasInteractionBlocked}
          canvasScrollViewport={scrollPos}
          scrollViewportStore={scrollViewportStore}
          hardCanvasInteractionBlock={hardCanvasInteractionBlock}
          collaborationDocumentLocked={collaborationDocumentLocked}
          collaborationDocumentUnavailable={collaborationDocumentUnavailable}
          collaborationLockMessage={collaborationLockMessage}
          closeViewToolWithFocus={studioCanvasViewportHandlers.closeViewToolWithFocus}
          colorBlindPreview={colorBlindPreview}
          commentPinArmed={commentPinArmed}
          commentQuickReplyActive={
            studioCommentThreadSession.surface === "pin-quick-reply"
            && studioCommentThreadPopoverTarget !== null
          }
          cropArmed={cropArmed}
          cropRect={cropRect}
          dialogueBatchOpen={dialogueBatchOpen}
          dialogueTranslateOpen={dialogueTranslateOpen}
          drawingRef={drawingRef}
          drawingShortcutNoticeStore={drawingShortcutNoticeStore}
          drawMode={drawMode}
          drawShape={drawShape}
          editing={editing}
          eyedropperActive={eyedropperActive}
          effScale={effScale}
          elementById={elementById}
          elements={studioBrushR8GrainRenderElements}
          studioLiveGesturePreviewAuthoritativeElementIds={elements.map((element) => element.id)}
          studioFilterPageComposite={
            studioFilterSession?.target === "page-composite" &&
            studioFilterSession.pageId === activePage.id &&
            studioFilterSession.historyIndex === pagesHi &&
            !masterEditMode
              ? studioFilterSession.image
              : null
          }
          studioFilterPreview={studioFilterPreview}
          followingStudioSessionId={followingStudioSessionId}
          frameAnimEl={frameAnimEl}
          frameAnimOpen={frameAnimOpen}
          frameAnimTargetId={frameAnimTargetId}
          gpuCanvasShadowVisibleRef={gpuCanvasShadowVisibleRef}
          gpuLiveInkPinnedRef={gpuLiveInkPinnedRef}
          livingInkOverlayVisibleRef={livingInkOverlayVisibleRef}
          gridSize={gridSize}
          groups={groups}
          guides={guides}
          hasAutosave={hasAutosave}
          autosaveDocumentLeadership={autosaveDocumentLeadership}
          autosaveLiveJam={studioLiveJam}
          healCloneArmed={healCloneArmed}
          healCloneCursorRef={healCloneCursorRef}
          healCloneDragPreview={healCloneDragPreview}
          healCloneRadius={healCloneRadius}
          healCloneSourceAnchor={healCloneSourceAnchor}
          healCloneSourceCursorRef={healCloneSourceCursorRef}
          healCloneTool={healCloneTool}
          historyBrushArmed={historyBrushArmed}
          historyBrushCursorRef={historyBrushCursorRef}
          historyBrushDragPreview={historyBrushDragPreview}
          historyBrushRadius={historyBrushRadius}
          historyBrushSourceIndex={historyBrushSourceIndex}
          historyPanelOpen={historyPanelOpen}
          isExporting={isExporting}
          isMobile={isMobile}
          isometricAngleDeg={isometricAngleDeg}
          isometricCellSize={isometricCellSize}
          isometricGridActive={isometricGridActive}
          isometricOriginX={isometricOriginX}
          isometricOriginY={isometricOriginY}
          isPanning={isPanning}
          isSpacePressed={isSpacePressed}
          filterMaskCursorRef={filterMaskCursorRef}
          filterMaskDragPreview={filterMaskDragPreview}
          filterMaskPaintArmed={filterMaskPaintArmed}
          filterMaskPaintMode={filterMaskPaintMode}
          filterMaskRadius={filterMaskRadius}
          layerMaskCursorRef={layerMaskCursorRef}
          layerMaskDragPreview={layerMaskDragPreview}
          layerMaskPaintArmed={layerMaskPaintArmed}
          layerMaskPaintMode={layerMaskPaintMode}
          layerMaskRadius={layerMaskRadius}
          quickMaskArmed={quickMaskArmed}
          quickMaskBrushMode={quickMaskBrushMode}
          quickMaskDragPreview={quickMaskDragPreview}
          quickMaskRadius={quickMaskRadius}
          quickMaskTintCanvas={quickMaskTintCanvas}
          quickMaskTintColor={quickMaskTintColor}
          quickMaskTintOpacity={quickMaskTintOpacity}
          localHiddenElementIds={localHiddenElementIds}
          liveDraftDirectRef={liveDraftDirectRef}
          draftPreviewDynamicLayerRef={draftPreviewDynamicLayerRef}
          draftPreviewNormalLayerRef={draftPreviewNormalLayerRef}
          liveDraftLayerRef={liveDraftLayerRef}
          liveDraftVisualRef={liveDraftVisualRef}
          liveInkOverlayRendererRef={liveInkOverlayRendererRef}
          mainLayerRef={mainLayerRef}
          marqueeIds={marqueeIds}
          activeGroupId={activeGroupId}
          marqueeRectNodeRef={marqueeRectNodeRef}
          master={master}
          masterEditMode={masterEditMode}
          masterPanelOpen={masterPanelOpen}
          masterRenderEls={studioFilterMaskMasterRenderElements}
          mobileImmersive={mobileImmersive}
          mobileKeyboardInset={mobileKeyboardInset}
          navigate={navigate}
          nodeEditArmed={nodeEditArmed}
          nodeEditDraft={nodeEditDraft}
          nodeEditHandles={nodeEditHandles}
          nodeEditTool={nodeEditTool}
          nodeRefsRef={nodeRefsRef}
          onionSkin={onionSkin}
          pageGrade={pageGrade}
          pageGradeCss={pageGradeCss}
          pages={pages}
          pageSequenceOpen={pageSequenceOpen}
          pagesHi={pagesHi}
          pagesHistory={pagesHistory}
          panelGutter={panelGutter}
          panelSplitArmed={panelSplitArmed}
          panelSplitPreview={panelSplitPreview}
          perspectiveRulerActive={perspectiveRulerActive}
          pixelDragPreview={pixelDragPreview}
          pixelOverlayFrame={pixelOverlayFrame}
          pixelOverlaySel={pixelOverlaySel}
          pixelToolArmed={pixelToolArmed}
          polyLassoHover={polyLassoHover}
          polyLassoSession={polyLassoSession}
          pressureCurve={pressureCurve}
          puppetWarpArmed={puppetWarpArmed}
          puppetWarpBusy={puppetWarpBusy}
          puppetWarpPins={puppetWarpPins}
          quickShapeActive={quickShapeActive}
          remixId={remixId}
          saving={saving}
          scale={scale}
          selected={selected}
          selectedId={selectedId}
          setAppSettingsInitialTab={setAppSettingsInitialTab}
          setAppSettingsOpen={setAppSettingsOpen}
          setBg3dOpen={setBg3dOpen}
          setCanvasOnlyMode={setCanvasOnlyMode}
          setContextMenu={setContextMenu}
          setCurrentPageId={studioCanvasViewportHandlers.setCurrentPageId}
          setDialogueBatchOpen={setDialogueBatchOpen}
          setDialogueTranslateOpen={setDialogueTranslateOpen}
          setError={setError}
          setEyedropperActive={setEyedropperActive}
          setFollowingStudioSessionId={setFollowingStudioSessionId}
          setFrameAnimOpen={setFrameAnimOpen}
          setFrameAnimTargetId={setFrameAnimTargetId}
          setHistoryPanelOpen={setHistoryPanelOpen}
          setLeftPanelOpen={setLeftPanelOpenWithOverride}
          setMarqueeIds={setMarqueeIds}
          setMasterEditMode={setMasterEditMode}
          setMasterPanelOpen={setMasterPanelOpen}
          setOnionSkin={setOnionSkin}
          setPageSequenceOpen={setPageSequenceOpen}
          setPoserVrmOpen={setPoserVrmOpen}
          setPuppetWarpPins={setPuppetWarpPins}
          setQuickShapeActive={setQuickShapeActive}
          setQuickStartOpen={setQuickStartOpen}
          setRightPanelOpen={studioCanvasViewportHandlers.setRightPanelOpen}
          setSelectedId={setSelectedId}
          setSharedDocumentNotice={setSharedDocumentNotice}
          setShortcutsOpen={setShortcutsOpen}
          setStudioRasterHandoffCandidate={setStudioRasterHandoffCandidate}
          setSymmetryCenterX={setSymmetryCenterX}
          setSymmetryCenterY={setSymmetryCenterY}
          setTeamPanelOpen={setTeamPanelOpen}
          setTimelineFocusedTrackId={setTimelineFocusedTrackId}
          setTimelineOpen={setTimelineOpen}
          setTimelinePlayhead={setTimelinePlayhead}
          setTimelinePlaying={setTimelinePlaying}
          setTool={setTool}
          setTranslateDraft={setTranslateDraft}
          setTranslateGlossary={setTranslateGlossary}
          setTranslateTargetLocale={setTranslateTargetLocale}
          setTutorialHubOpen={setTutorialHubOpen}
          setUserGuides={setUserGuides}
          setZoom={setZoom}
          shapeFill={shapeFill}
          shortcutsOpen={shortcutsOpen}
          showGrid={showGrid}
          showQuickStart={showQuickStart}
          showWebtoonGuides={showWebtoonGuides}
          smartGuides={smartGuides}
          sharedGutters={sharedGutters}
          smudgeArmed={smudgeArmed}
          dodgeBurnArmed={dodgeBurnArmed}
          dodgeBurnRadius={dodgeBurnRadius}
          wetMixArmed={wetMixArmed}
          wetMixRadius={wetMixRadius}
          liquifyArmed={liquifyArmed}
          liquifyRadius={liquifyRadius}
          smudgeCursorRef={smudgeCursorRef}
          paintRetouchStrokeLineRef={paintRetouchStrokeLineRef}
          liquifyPreviewImageRef={liquifyPreviewImageRef}
          smudgeRadius={smudgeRadius}
          sourceHydrationPending={sourceHydrationPending}
          stabilizer={stabilizer}
          stabilizerMode={stabilizerMode}
          stageRef={stageRef}
          strokeWidth={strokeWidth}
          tipAngle={tipAngle}
          tipRoundness={tipRoundness}
          studioCanvasCommentPins={studioCanvasCommentPins}
          studioCommentPinReanchorableThreadIds={studioCommentPinReanchorableThreadIds}
          studioCommentPinReanchorDisabledReason={studioCommentPinReanchorDisabledReason}
          studioCrdtDocument={studioCrdtDocument}
          studioCrdtOperationSyncReady={studioCrdtOperationSyncReady}
          studioLiveGesturePreviewAdapter={studioLiveGesturePreviewAdapter}
          studioLiveRoomRef={studioLiveRoomRef}
          studioRasterAuthorizedAuthorityKey={studioRasterAuthorizedAuthorityKey}
          studioRasterHandoffBaseKey={studioRasterHandoffBaseKey}
          studioRasterHandoffBlocked={studioRasterHandoffBlocked}
          studioRasterHandoffGates={studioRasterHandoffGates}
          studioRasterHiddenOperationIds={studioRasterHiddenOperationIds}
          studioRasterOverlayElements={studioRasterOverlayElements}
          studioRasterVisibleDocumentRect={studioRasterVisibleDocumentRect}
          studioWorkAssetRenderPlaceholders={studioWorkAssetRenderPlaceholders}
          studioWorkAssetRenderProjection={studioCanvasWorkAssetRenderProjection}
          symmetryCenterX={symmetryCenterX}
          symmetryCenterY={symmetryCenterY}
          symmetryRadialCount={symmetryRadialCount}
          symmetryType={symmetryType}
          textAiConfigured={textAiConfigured}
          timelapseCapturing={timelapseCapturing}
          timelineFocusedTrackId={timelineFocusedTrackId}
          timelineOpen={timelineOpen}
          timelinePlayhead={timelinePlayhead}
          timelinePlaying={timelinePlaying}
          timelinePreviewFrame={timelinePreviewFrame}
          title={title}
          tool={tool}
          viewTool={viewTool}
          viewTransformSuppressed={viewTransformSuppressed}
          translateBusy={translateBusy}
          translateDraft={translateDraft}
          translateError={translateError}
          translateGlossary={translateGlossary}
          translateProgress={translateProgress}
          translateTargetLocale={translateTargetLocale}
          trRef={trRef}
          tutorialHubOpen={tutorialHubOpen}
          tutorialInitialId={tutorialInitialId}
          uiDensityMode={uiDensityMode}
          userGuides={userGuides}
          vanishingPoints={vanishingPoints}
          perspectiveEyeLevelY={perspectiveEyeLevelY}
          perspectiveLockHorizon={perspectiveLockHorizon}
          webGpuPreviewAuthorized={webGpuPreviewAuthorized}
          webGpuPreviewStrokes={webGpuPreviewStrokes}
          webGpuViewportSurface={webGpuViewportSurface}
          transientPenInkSurfaceEnabled={STUDIO_TRANSIENT_PEN_INK_SURFACE_ENABLED}
          webtoonGuides={webtoonGuides}
          webtoonTheme={webtoonTheme}
          workHydrationFailed={workHydrationFailed}
          workHydrationUnsupportedFormat={workHydrationUnsupportedFormat}
          workId={workId}
          wrapRef={wrapRef}
          zoom={zoom}
          zoomLocked={zoomLocked}
          setZoomLocked={setZoomLocked}
          zoomHostRef={zoomHostRef}
          stableHandlers={studioCanvasViewportHandlers}
        />

        <StudioBrushHud
          visible={
            tool === "draw"
            && isStudioBrushCursorMode(drawMode)
            && !canvasOnlyMode
            && !canvasInteractionBlocked
            && !isExporting
            && !colorWheelOpen
          }
          strokeWidth={strokeWidth}
          brushOpacity={brushOpacity}
          color={color}
          eraserActive={drawMode === "eraser"}
          handedness={workspaceControlSide === "left" ? "left" : "right"}
          canvasHostRef={wrapRef}
          stableHandlers={studioOnCanvasSurfaceHandlers}
        />
        <StudioSelectionContextBar
          visible={
            tool === "select"
            && currentCanvasSelectionCount > 0
            && !canvasOnlyMode
            && !canvasInteractionBlocked
            && !isExporting
          }
          selectionCount={currentCanvasSelectionCount}
          readOnly={activeSurfaceReviewLocked || pageEditLocked}
          canDelete={!activeSurfaceReviewLocked && !pageEditLocked}
          stableHandlers={studioOnCanvasSurfaceHandlers}
        />

        {pointCommentComposer ? (
          <Suspense fallback={null}>
            <StudioPointCommentComposer
              key={pointCommentComposer.commentId}
              anchor={pointCommentComposer.anchor}
              authorName={studioCommentActor.displayName}
              screenPoint={pointCommentComposer.screenPoint}
              getScreenPoint={studioPointCommentScreenProjectionHandlers.getScreenPoint}
              onCancel={cancelStudioPointCommentComposer}
              onOpenReview={() => {
                setPointCommentComposer(null);
                openStudioCommentInbox();
              }}
              onSubmit={submitStudioPointComment}
            />
          </Suspense>
        ) : null}

        {studioCommentThreadPopoverTarget
        && studioCommentThreadSession.surface === "pin-quick-reply"
        && studioCommentThreadSessionView.selectedThread ? (
          <Suspense fallback={null}>
            <StudioCommentThreadPopover
              key={studioCommentThreadPopoverTarget.pinKey}
              thread={studioCommentThreadSessionView.selectedThread}
              screenPoint={studioCommentThreadPopoverTarget.screenPoint}
              anchorElement={studioCommentThreadPopoverTarget.anchorElement}
              getScreenPoint={
                studioCommentThreadPopoverScreenProjectionHandlers.getScreenPoint
              }
              fallbackFocusTarget={wrapRef.current}
              unread={studioCommentThreadSessionView.selectedUnread}
              replyBody={studioCommentThreadSessionView.selectedDraft?.body ?? ""}
              submitting={studioCommentThreadSession.submittingMutationId !== null}
              syncing={studioTeamCommentsSyncing}
              syncError={studioCommentInteractionNotice ?? studioCommentSyncError}
              capabilities={{
                reply: studioTeamCommentsWorkId
                  ? studioTeamCommentCapabilities?.comment === true
                    && !studioLegacyCommentThreadIdSet.has(
                      studioCommentThreadSessionView.selectedThread.id
                    )
                  : !collaborationDocumentLocked,
                resolve: studioTeamCommentsWorkId
                  ? studioTeamCommentCapabilities?.resolve === true
                    && !studioLegacyCommentThreadIdSet.has(
                      studioCommentThreadSessionView.selectedThread.id
                    )
                  : !collaborationDocumentLocked,
              }}
              mutationDisabledReason={
                studioLegacyCommentThreadIdSet.has(
                  studioCommentThreadSessionView.selectedThread.id
                )
                  ? "이전 문서에 보관된 댓글이라 전체 검토함에서 읽기 전용으로 확인할 수 있어요."
                  : studioCommentThreadSessionView.replyBlockedReason === "draft-target-mismatch"
                    ? "다른 댓글에 작성 중인 답글이 있어요. 해당 핀에서 먼저 마무리해 주세요."
                    : undefined
              }
              clusterIndex={studioCommentThreadSessionView.selectedClusterIndex}
              clusterCount={studioCommentThreadSessionView.clusterThreads.length}
              unreadClusterCount={studioCommentThreadSessionView.unreadClusterCount}
              onNavigateCluster={navigateStudioCommentPinCluster}
              onReplyBodyChange={changeStudioCommentThreadReplyDraft}
              onSubmitReply={submitStudioCommentThreadReply}
              onResolveChange={changeStudioCommentThreadResolution}
              onOpenReview={openStudioCommentThreadInReview}
              onClose={closeStudioCommentThreadPopover}
            />
          </Suspense>
        ) : null}
          </div>
  );
}
