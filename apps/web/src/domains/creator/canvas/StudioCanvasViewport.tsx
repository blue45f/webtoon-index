import { memo, useCallback } from "react";

import { CANVAS_W } from "../studio-assets";
import { StudioColorBlindFilterDefs } from "../StudioColorBlindPreview";

import { useStudioCanvasViewportInteraction } from "./studio-canvas-viewport-interaction";
import { useStudioCanvasViewportLiveSurfaces } from "./studio-canvas-viewport-live-surfaces";
import { localizeText } from "./studio-canvas-viewport-primitives";
import { renderStudioCanvasStageHud } from "./StudioCanvasStageHud";
import { StudioCanvasStatusRail } from "./StudioCanvasStatusRail";
import { renderStudioCanvasStickyBanners } from "./StudioCanvasStickyBanners";
import { StudioCanvasViewportHudOverlays } from "./StudioCanvasViewportHudOverlays";
import { StudioCanvasViewportStageHost } from "./StudioCanvasViewportStageHost";
import type {
  StudioCanvasViewportHandlers,
  StudioCanvasViewportProps,
  StudioHokusaiLiveOverlaySurfaceBinding,
  StudioLivingInkOverlaySurfaceBinding,
} from "./StudioCanvasViewportTypes";

import { cn } from "@/shared/lib/utils";

export {
  type StudioCanvasViewportHandlers,
  type StudioCanvasViewportProps,
  type StudioHokusaiLiveOverlaySurfaceBinding,
  type StudioLivingInkOverlaySurfaceBinding,
};

export const StudioCanvasViewport = memo(function StudioCanvasViewport({
  zoomHostRef,
  ...rest
}: StudioCanvasViewportProps) {
  const props: StudioCanvasViewportProps = { zoomHostRef, ...rest };
  const zoomHostNodeRef = zoomHostRef;
  const live = useStudioCanvasViewportLiveSurfaces(props);
  /**
   * Ref identity, not memoisation.
   *
   * This callback used to be written inline in the JSX below. It closes over `live`, which is a
   * fresh object every render, so the compiler could not hold it stable — React therefore
   * detached and re-attached the ref on every commit. The callback writes React state
   * (`setPixiMountParent`), and a detach passes `null` while the following attach passes the
   * node, so the two calls are never the identical-value bail-out: each commit scheduled two more
   * renders, which detached the ref again. Drawing a stroke re-renders this viewport per pointer
   * frame, so the loop reached React's nested-update limit within one stroke and error #185 took
   * the whole editor down through the app error boundary — silently in production, because both
   * boundaries only logged under import.meta.env.DEV.
   *
   * `setPixiMountParent` is a useState setter and `zoomHostNodeRef` is a ref, so both are stable
   * for the life of the component: with an empty dependency list this ref is attached once and
   * detached once, which is the contract a ref callback is supposed to have.
   */
  const { setPixiMountParent } = live;
  const bindZoomHost = useCallback((node: HTMLDivElement | null) => {
    zoomHostNodeRef.current = node;
    setPixiMountParent(node);
  }, [setPixiMountParent, zoomHostNodeRef]);
  const interaction = useStudioCanvasViewportInteraction(props);
  const {
    activeCatalogBrushName,
    activePage,
    activePageIndex,
    advancedFillActive,
    advancedFillBusy,
    advancedFillPreview,
    appSettings,
    autosaveDocumentLeadership,
    autosaveLiveJam,
    autosaveRestoreBlockedReason,
    brushOpacity,
    canvasFlipH,
    canvasOnlyMode,
    canvasRotation,
    closeViewToolWithFocus,
    collaborationDocumentUnavailable,
    commentPinArmed,
    drawMode,
    drawShape,
    effScale,
    followingStudioSessionId,
    hasAutosave,
    isMobile,
    isSpacePressed,
    liveDrawPressureStore,
    mobileImmersive,
    navigate,
    pageSequenceOpen,
    pages,
    pressureCurve,
    quickShapeActive,
    remixId,
    scale,
    selected,
    setCanvasOnlyMode,
    setFollowingStudioSessionId,
    setPageSequenceOpen,
    setSelectedId,
    setTeamPanelOpen,
    setTool,
    setZoom,
    setZoomLocked,
    shapeFill,
    sourceHydrationPending,
    stabilizer,
    stabilizerMode,
    strokeWidth,
    studioCrdtOperationSyncReady,
    symmetryType,
    tool,
    uiDensityMode,
    viewTool,
    viewTransformSuppressed,
    workHydrationFailed,
    workHydrationUnsupportedFormat,
    workId,
    wrapRef,
    zoom,
    zoomLocked,
    stableHandlers,
  } = props;
  const {
    alignSelected,
    applyAdvancedFillPreview,
    cancelAdvancedFillPreview,
    clearAutosave,
    dismissQuickStart,
    clearCanvasSelection,
    commitPages,
    downloadAutosaveBackup,
    duplicateSelected,
    enterCanvasOnlyMode,
    fitCanvasToWidth,
    flipSelected,
    groupSelectedElements,
    mergeSelectedBubbles,
    removeSelected,
    reorderSelectedElements,
    resetView,
    restoreAutosave,
    rotateCanvasView,
    setActualPixelView,
    setCurrentPageId,
    setStudioUiDensity,
    stopStudioCommentPlacementSession,
    toggleAdvancedFill,
    toggleHorizontalCanvasView,
    toggleSelectedElementsLocked,
    ungroupSelectedElements,
    zoomToSelection,
    onWrapDragLeave,
    onWrapDragOver,
    onWrapDrop,
    onWrapMouseDown,
    onWrapMouseMove,
    onWrapMouseUp,
  } = stableHandlers;
  const {
    activeCanvasGroupName,
    alignmentSelectionDisabledReason,
    canvasSelectionEls,
    completeSelectionGroup,
    eraserPresetActive,
    groupSelectionDisabledReason,
    selectionLockState,
    selectionMutationDisabledReason,
    showBubbleMerge,
    bubbleMergeReason,
    t,
    toggleWheelCanvasMode,
    viewportCursorClassName,
    viewBusyReason,
    zoomInAtLimit,
    zoomInUnavailableReason,
    zoomOutAtLimit,
    zoomOutUnavailableReason,
  } = interaction;

  return (
        <div
          className={cn(
            "relative min-h-0 min-w-0 flex-1 lg:min-w-[16rem]",
            "flex flex-col overflow-hidden",
            canvasOnlyMode && "overflow-hidden",
            mobileImmersive && "overflow-hidden"
          )}
          data-studio-logical-w={CANVAS_W}
        >
          <StudioCanvasStatusRail
            activeGroupName={activeCanvasGroupName}
            mobileImmersive={mobileImmersive}
            hasAutosave={hasAutosave}
            autosaveDocumentLeadership={autosaveDocumentLeadership}
            autosaveLiveJam={autosaveLiveJam}
            autosaveRestoreBlockedReason={autosaveRestoreBlockedReason}
            selectionCount={canvasSelectionEls.length}
            selectionGroupName={completeSelectionGroup?.name ?? null}
            selectionLockState={selectionLockState}
            groupSelectionDisabledReason={groupSelectionDisabledReason}
            lockSelectionDisabledReason={selectionMutationDisabledReason}
            layoutSelectionDisabledReason={selectionMutationDisabledReason}
            alignmentSelectionDisabledReason={alignmentSelectionDisabledReason}
            advancedFillBusy={advancedFillBusy}
            advancedFillPreviewMessage={advancedFillPreview?.message ?? null}
            advancedFillActive={advancedFillActive}
            onDownloadAutosaveBackup={downloadAutosaveBackup}
            onRestoreAutosave={restoreAutosave}
            onClearAutosave={clearAutosave}
            onGroupSelection={groupSelectedElements}
            onUngroupSelection={completeSelectionGroup ? ungroupSelectedElements : undefined}
            onToggleSelectionLock={toggleSelectedElementsLocked}
            onReorderSelection={reorderSelectedElements}
            onAlignSelection={alignSelected}
            onZoomToSelection={zoomToSelection}
            onFlipSelection={flipSelected}
            showBubbleMerge={showBubbleMerge}
            bubbleMergeDisabledReason={bubbleMergeReason}
            onMergeBubbles={mergeSelectedBubbles}
            onDuplicateSelection={duplicateSelected}
            onRemoveSelection={removeSelected}
            onClearSelection={clearCanvasSelection}
            onCancelAdvancedFillPreview={cancelAdvancedFillPreview}
            onApplyAdvancedFillPreview={applyAdvancedFillPreview}
            onCancelAdvancedFillCalculation={toggleAdvancedFill}
          />
          {/* 색맹 시뮬레이션용 숨김 SVG filter defs — filter id 는 문서 전역 참조라 위치 무관, 정적이라 무조건 마운트 */}
          <StudioColorBlindFilterDefs />
          {renderStudioCanvasStageHud({
            activeCatalogBrushName,
            activePage,
            activePageIndex,
            appSettings,
            brushOpacity,
            canvasOnlyMode,
            drawMode,
            drawShape,
            enterCanvasOnlyMode,
            eraserPresetActive,
            fitCanvasToWidth,
            isMobile,
            liveDrawPressureStore,
            mobileImmersive,
            pageSequenceOpen,
            pressureCurve,
            quickShapeActive,
            scale,
            selected,
            setCanvasOnlyMode,
            setPageSequenceOpen,
            setStudioUiDensity,
            setZoom,
            setZoomLocked,
            shapeFill,
            stabilizer,
            stabilizerMode,
            strokeWidth,
            symmetryType,
            t,
            toggleWheelCanvasMode,
            tool,
            uiDensityMode,
            viewBusyReason,
            viewTransformSuppressed,
            zoom,
            zoomInAtLimit,
            zoomInUnavailableReason,
            zoomLocked,
            zoomOutAtLimit,
            zoomOutUnavailableReason,
          })}
          {/* 고정높이 스크롤 뷰포트: 줌·긴 캔버스 시 내부 스크롤, 컨트롤은 바깥에 고정 */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- 마우스 핸들러는 클릭이 아니라 스페이스+드래그 패닝/에셋 드롭 전용이며 실제 상호작용은 내부 Konva Stage + document keydown(Space) 이 담당한다 */}
          <div
            ref={wrapRef}
            data-studio-canvas-viewport
            data-studio-viewport-cursor={viewportCursorClassName.replace("cursor-", "")}
            data-studio-draw-dock-safe-area={tool === "draw" && !canvasOnlyMode ? "true" : undefined}
            data-studio-mobile-dock-safe-area={isMobile ? "true" : undefined}
            // 스크롤 뷰포트를 키보드 포커스 가능하게 해 방향키 스크롤 허용(WCAG scrollable-region) — focusable 은 의도적.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            role="group"
            aria-label={localizeText(t, "작업 캔버스 — 포커스 후 방향키로 스크롤", "studio.canvas.canvasAriaLabel")}
            onMouseDown={onWrapMouseDown}
            onMouseMove={onWrapMouseMove}
            onMouseUp={onWrapMouseUp}
            onMouseLeave={onWrapMouseUp}
            onDragLeave={onWrapDragLeave}
            onDragOver={onWrapDragOver}
            onDrop={onWrapDrop}
            className={cn(
              // Canvas fills remaining viewport under thin menubar+toolbelt (~6.5rem).
              "relative min-h-0 flex-1 overflow-auto rounded-none border-0 outline-none",
              "group/asset-drop transition-shadow data-[studio-asset-drop-active=true]:shadow-[inset_0_0_0_2px_oklch(0.72_0.18_45/0.9)]",
              "bg-[oklch(0.145_0.008_70)]",
              "[background-image:linear-gradient(oklch(0.162_0.008_70)_1px,transparent_1px),linear-gradient(90deg,oklch(0.162_0.008_70)_1px,transparent_1px)]",
              "[background-size:24px_24px]",
              "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent focus-visible:shadow-[inset_0_0_0_1px_oklch(0.72_0.14_55/0.45)] lg:max-h-none",
              canvasOnlyMode && "min-h-0 flex-1 max-h-none overscroll-contain",
              mobileImmersive
                ? "min-h-0 flex-1 max-h-none rounded-xl overscroll-contain"
                : "max-h-[calc(100dvh-11rem)] min-h-[12rem] lg:max-h-none",
              viewportCursorClassName,
              (isSpacePressed || tool === "hand") && "select-none"
            )}
          >
          {renderStudioCanvasStickyBanners({
            activePage,
            canvasFlipH,
            canvasRotation,
            closeViewToolWithFocus,
            collaborationDocumentUnavailable,
            commentPinArmed,
            commitPages,
            dismissQuickStart,
            effScale,
            fitCanvasToWidth,
            followingStudioSessionId,
            navigate,
            pages,
            remixId,
            resetView,
            rotateCanvasView,
            setActualPixelView,
            setCurrentPageId,
            setFollowingStudioSessionId,
            setSelectedId,
            setTeamPanelOpen,
            setTool,
            setZoom,
            sourceHydrationPending,
            stopStudioCommentPlacementSession,
            studioCrdtOperationSyncReady,
            t,
            toggleHorizontalCanvasView,
            viewTool,
            workHydrationFailed,
            workHydrationUnsupportedFormat,
            workId,
            zoom,
          })}

          <StudioCanvasViewportStageHost
            viewport={props}
            live={live}
            interaction={interaction}
            bindZoomHost={bindZoomHost}
          />
          </div>
          <StudioCanvasViewportHudOverlays
            viewport={props}
            interaction={interaction}
          />
        </div>
  );
});
