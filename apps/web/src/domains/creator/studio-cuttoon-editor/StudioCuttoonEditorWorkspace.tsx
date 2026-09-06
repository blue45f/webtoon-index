/* Extracted render tree from StudioCuttoonEditor.
 * Session props are an `any` bag matching the original editor closure. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import { Suspense, useLayoutEffect, useState } from "react";
import { createStudioLeftToolRailRuntime } from "../editor-client/studio-left-tool-rail-client";
import { LazyStudioLeftToolRail, LazyStudioPageListPane } from "../studio-page-modal-lazy-boundaries";
import { cn } from "@/shared/lib/utils";
import { StudioCuttoonEditorCanvasColumn } from "./StudioCuttoonEditorCanvasColumn";
import { StudioCuttoonEditorInspectorColumn } from "./StudioCuttoonEditorInspectorColumn";
import { StudioCuttoonEditorPanels } from "./StudioCuttoonEditorPanels";
import { StudioCuttoonEditorSessionDialogs } from "./StudioCuttoonEditorSessionDialogs";
import type { StudioCuttoonEditorViewSession } from "./StudioCuttoonEditorViewSession";

export function StudioCuttoonEditorWorkspace(s: StudioCuttoonEditorViewSession) {
  const {
    activeSurfaceReviewLocked,
    admittedBg3dOpen,
    admittedMannequinPoserOpen,
    admittedCharacterShaperOpen,
    admittedPoserVrmOpen,
    advancedFillActive,
    advancedFillUnsupportedReason,
    appSettings,
    appSettingsOpen,
    canvasOnlyMode,
    collaborationDocumentLocked,
    collaborationLockMessage,
    commentPlacementActive,
    composeWorkAssetPreviewPage,
    cropRect,
    currentPageId,
    dismissActiveMobileSheet,
    dodgeBurnActive,
    drawMode,
    drawShape,
    eyedropperActive,
    frameAnimOpen,
    frameAnimTargetId,
    hybridDccOpen,
    isMobile,
    isRailToolVisible,
    leftResize,
    liquifyActive,
    master,
    masterEditMode,
    masterPanelOpen,
    metaEditPageId,
    mobileImmersive,
    mobileKeyboardInset,
    mobileSheet,
    modalMobileSheet,
    pageDnd,
    pages,
    pagesSheetRef,
    perspectiveRulerActive,
    pixelForceCircle,
    pixelSel,
    pixelTool,
    pixelToolTargetAvailable,
    quickShapeActive,
    railMoreOpen,
    rasterRetouchTargetAvailable,
    referencePanelOpen,
    selected,
    selectedImageMutationLocked,
    setAppSettingsInitialTab,
    setAppSettingsOpen,
    setCurrentPageId,
    setDrawShape,
    setEyedropperActive,
    setHybridDccOpen,
    setLeftPanelOpenWithOverride,
    setMannequinPoserOpen,
    setMasterPanelOpen,
    setMenu,
    setMetaEditPageId,
    setMobileSheet,
    setPerspectiveRulerActive,
    setPixelForceCircle,
    setPixelTool,
    setPoserVrmOpen,
    setCharacterShaperOpen,
    setQuickShapeActive,
    setRailMoreOpen,
    setReferencePanelOpen,
    setViewTool,
    smudgeActive,
    studioLeftToolRailHandlers,
    studioPageListPaneHandlers,
    tool,
    uiDensityMode,
    viewTool,
    viewTransformSuppressed,
    wetMixActive,
    presentationPanelsHidden,
    visibleLeftPanelOpen,
  } = s;
  const studioLeftToolRailInput = {
    activeSurfaceReviewLocked,
    pixelToolTargetAvailable,
    rasterRetouchTargetAvailable,
    advancedFillActive,
    advancedFillUnsupportedReason,
    appSettings,
    appSettingsOpen,
    canvasOnlyMode,
    commentPinArmed: commentPlacementActive,
    cropActive: cropRect !== null,
    drawMode,
    drawShape,
    eyedropperActive,
    frameAnimOpen,
    frameAnimTargetId,
    isRailToolVisible,
    liquifyActive,
    mobileImmersive,
    perspectiveRulerActive,
    pixelForceCircle,
    pixelSel,
    pixelTool,
    quickShapeActive,
    railMoreOpen,
    referencePanelOpen,
    mannequinPoserOpen: admittedMannequinPoserOpen,
    poserVrmOpen: admittedPoserVrmOpen,
    characterShaperOpen: admittedCharacterShaperOpen,
    bg3dOpen: admittedBg3dOpen,
    hybridDccOpen,
    selected,
    selectedImageMutationLocked,
    dodgeBurnActive,
    wetMixActive,
    smudgeActive,
    tool,
    uiDensityMode,
    viewTransformSuppressed,
    viewTool,
    setAppSettingsInitialTab,
    setAppSettingsOpen,
    setDrawShape,
    setEyedropperActive,
    setMenu,
    setPerspectiveRulerActive,
    setPixelForceCircle,
    setPixelTool,
    setQuickShapeActive,
    setRailMoreOpen,
    setReferencePanelOpen,
    setMannequinPoserOpen,
    setPoserVrmOpen,
    setCharacterShaperOpen,
    setHybridDccOpen,
    setViewTool,
    ...studioLeftToolRailHandlers,
  };
  const [studioLeftToolRailRuntime] = useState(() =>
    createStudioLeftToolRailRuntime(studioLeftToolRailInput)
  );
  useLayoutEffect(() => {
    studioLeftToolRailRuntime.update(studioLeftToolRailInput);
  }, [studioLeftToolRailInput, studioLeftToolRailRuntime]);

  return (
      <div
        id="studio-workspace"
        role="group"
        aria-label="편집 작업공간"
        tabIndex={-1}
        data-studio-mobile-canvas-workspace={isMobile ? "true" : undefined}
        className={cn(
          // Edge-dock workspace: the mobile dock overlays the scrollport instead of shrinking this
          // flex lane. StudioCanvasViewport owns the matching scroll-safe inset, so the final canvas
          // pixels remain reachable while the full dynamic viewport stays available for drawing.
          "flex min-h-0 flex-1 flex-col gap-0 pb-0 lg:flex-row lg:overflow-hidden",
          canvasOnlyMode && "overflow-hidden",
          mobileImmersive && "overflow-hidden"
        )}
      >
        {/* 모달 시트 전용 스크림. 브러시 설정(draw)은 캔버스를 계속 만질 수 있는 비모달이다. */}
        {isMobile && modalMobileSheet && (
          <div
            aria-hidden
            data-studio-modal-backdrop="true"
            onPointerDown={(event) => {
              // The scrim itself is not a focus target. Prevent the pointer's default focus move
              // from overriding the modal controller's launcher-focus restoration during unmount.
              event.preventDefault();
              dismissActiveMobileSheet();
            }}
            className="fixed inset-0 z-[59] bg-black/45 backdrop-blur-sm lg:hidden"
          />
        )}
        {/* 왼쪽: 페이지 목록 — 접히면 아이콘 엣지 레일 */}
        <Suspense
          fallback={(
            <div
              aria-hidden="true"
              data-studio-page-list-loading="true"
              className="hidden w-12 shrink-0 border-r border-line bg-panel lg:block"
            />
          )}
        >
          <LazyStudioPageListPane
            collaborationDocumentLocked={collaborationDocumentLocked}
            collaborationLockMessage={collaborationLockMessage}
            composeWorkAssetPreviewPage={composeWorkAssetPreviewPage}
            currentPageId={currentPageId}
            isMobile={isMobile}
            leftResize={leftResize}
            master={master}
            masterEditMode={masterEditMode}
            masterPanelOpen={masterPanelOpen}
            metaEditPageId={metaEditPageId}
            mobileKeyboardInset={mobileKeyboardInset}
            mobileSheet={mobileSheet}
            pageDnd={pageDnd}
            pages={pages}
            pagesSheetRef={pagesSheetRef}
            presentationPanelsHidden={presentationPanelsHidden}
            setCurrentPageId={setCurrentPageId}
            setLeftPanelOpen={setLeftPanelOpenWithOverride}
            setMasterPanelOpen={setMasterPanelOpen}
            setMetaEditPageId={setMetaEditPageId}
            setMobileSheet={setMobileSheet}
            visibleLeftPanelOpen={visibleLeftPanelOpen}
            stableHandlers={studioPageListPaneHandlers}
          />
        </Suspense>

        {/* Left vertical toolbar — desktop only; mobile uses bottom dock / horizontal belt */}
        <Suspense
          fallback={(
            <div
              aria-hidden="true"
              data-studio-left-tool-rail-loading="true"
              className="hidden w-12 shrink-0 border-r border-line bg-panel lg:block"
            />
          )}
        >
        <LazyStudioLeftToolRail client={studioLeftToolRailRuntime.client} />
        </Suspense>

        {/* 중앙: 캔버스 + 우측 인스펙터 — 데스크톱에서는 한 행으로 남은 높이를 공유한다. */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row">
          <StudioCuttoonEditorCanvasColumn {...s} />
          <StudioCuttoonEditorInspectorColumn {...s} />
        </div>
        <StudioCuttoonEditorPanels {...s} />
        <StudioCuttoonEditorSessionDialogs {...s} />
      </div>
  );
}
