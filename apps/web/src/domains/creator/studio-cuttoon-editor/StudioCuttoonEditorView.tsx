/* Extracted render tree from StudioCuttoonEditor.
 * Session props are an `any` bag matching the original editor closure. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import { Maximize2 } from "lucide-react";
import { StudioLiveCollaborationProvider } from "../live/StudioLiveCollaborationProvider";
import { STUDIO_ICON_SIZE, STUDIO_ICON_STROKE, studioChromeIconClass } from "../studio-chrome-ui";
import { StudioHelpCenterHost } from "../StudioHelpCenterHost";
import { StudioToolHintPreferencesProvider } from "../StudioToolHint";
import { StudioWorkspaceNavigator } from "../StudioWorkspaceNavigator";
import { Container } from "@/shared/components/container";
import { cn } from "@/shared/lib/utils";
import { StudioCuttoonEditorChrome } from "./StudioCuttoonEditorChrome";
import { StudioCuttoonEditorContextMenu } from "./StudioCuttoonEditorContextMenu";
import { StudioCuttoonEditorDialogs } from "./StudioCuttoonEditorDialogs";
import { StudioCuttoonEditorHosts } from "./StudioCuttoonEditorHosts";
import { StudioCuttoonEditorWorkspace } from "./StudioCuttoonEditorWorkspace";
import type { StudioCuttoonEditorViewSession } from "./StudioCuttoonEditorViewSession";

export type { StudioCuttoonEditorViewSession };

export function StudioCuttoonEditorView(s: StudioCuttoonEditorViewSession) {
  const {
    activePage,
    appSettings,
    canvasOnlyMode,
    effectiveWorkId,
    handleStudioCrdtAuthoritativeSaveBarrierChange,
    handleStudioCrdtDocumentChange,
    handleStudioLiveEditSafetyChange,
    handleStudioLiveRoomChange,
    isFullscreen,
    isMobile,
    maximized,
    mobileImmersive,
    pagesHi,
    pagesHistory,
    requiresStudioLiveServer,
    setCanvasOnlyMode,
    studioAuthUserId,
    studioHistoryRetention,
    studioLiveParticipant,
    studioLiveTransportFactory,
    studioRootRef,
    tool,
    uiDensityMode,
    watermarkPreferenceSnapshot,
  } = s;
  return (
    <StudioLiveCollaborationProvider
      workId={effectiveWorkId}
      participant={studioLiveParticipant}
      currentPageId={activePage.id}
      currentTool={tool}
      outboxScope={studioAuthUserId}
      transportFactory={studioLiveTransportFactory}
      serverRequired={Boolean(studioLiveParticipant && requiresStudioLiveServer)}
      onRoomChange={handleStudioLiveRoomChange}
      onCrdtDocumentChange={handleStudioCrdtDocumentChange}
      onEditSafetyChange={handleStudioLiveEditSafetyChange}
      onAuthoritativeSaveBarrierChange={handleStudioCrdtAuthoritativeSaveBarrierChange}
    >
    <StudioToolHintPreferencesProvider
      mode={appSettings.general.toolHintMode}
      touchHoldDelayMs={appSettings.touch.toolHintHoldMs}
      reduceMotion={appSettings.other.reduceMotion}
    >
    <div
      id="studio-app-shell"
      ref={studioRootRef}
      data-studio-mobile-immersive={mobileImmersive ? "true" : "false"}
      data-studio-ui-density={uiDensityMode}
      data-studio-reduce-motion={appSettings.other.reduceMotion ? "true" : "false"}
      data-studio-device-kind={isMobile ? "mobile" : "desktop"}
      data-studio-editor="true"
      data-studio-app-shell="true"
      data-studio-watermark-persistence={watermarkPreferenceSnapshot.state}
      data-studio-history-entry-count={pagesHistory.length}
      data-studio-history-undo-depth={pagesHi}
      data-studio-history-last-measured-retained-bytes={
        studioHistoryRetention.lastMeasuredRetainedBytes
      }
      data-studio-history-last-measured-budget-bytes={
        studioHistoryRetention.lastMeasuredBudgetBytes
      }
      data-studio-history-last-measured-entry-bytes={
        studioHistoryRetention.lastMeasuredEntryBytes
      }
      data-studio-history-budget-evicted-steps={
        studioHistoryRetention.totalBudgetEvictedSteps
      }
      className={cn(
        // Default draw-app shell: fill the viewport without site chrome padding.
        "flex min-h-0 flex-col bg-canvas text-fg",
        // 전체화면도 평소와 같은 "뷰포트 높이 고정 + 내부만 스크롤" 셸을 쓴다. 예전에는
        // min-h-screen + overflow-y-auto 였는데, 높이 상한이 없어 콘텐츠가 넘치면 셸 자체가
        // 스크롤되면서 상단 메뉴바가 화면 밖으로 밀려났다(전체화면에서 메뉴 사라짐 버그).
        !maximized && !canvasOnlyMode && !mobileImmersive &&
          "h-[100dvh] max-h-[100dvh] overflow-hidden",
        isFullscreen && "bg-canvas",
        maximized && !isMobile && !mobileImmersive &&
          "fixed inset-0 z-[60] overflow-y-auto bg-canvas",
        canvasOnlyMode && !isMobile &&
          "fixed inset-0 z-[70] h-[100dvh] overflow-hidden overscroll-none bg-canvas",
        mobileImmersive &&
          "fixed inset-0 z-[75] h-[100dvh] overflow-hidden overscroll-none bg-canvas"
      )}
      style={
        mobileImmersive
          ? {
              paddingTop: "env(safe-area-inset-top)",
              paddingLeft: "env(safe-area-inset-left)",
              paddingRight: "env(safe-area-inset-right)",
            }
          : undefined
      }
    >
      <StudioWorkspaceNavigator />
      <StudioCuttoonEditorHosts {...s} />
      <StudioCuttoonEditorDialogs {...s} />
      <Container
        size="wide"
        className={cn(
          // Canvas-max draw-app shell: full-bleed, no marketing padding or max-width cap.
          "flex min-h-0 flex-1 flex-col !max-w-none !px-0 py-0",
          (isFullscreen || maximized) && "min-h-0"
        )}
      >
        <StudioCuttoonEditorChrome {...s} />
        <StudioCuttoonEditorWorkspace {...s} />
        <StudioCuttoonEditorContextMenu {...s} />
      </Container>
    {canvasOnlyMode ? (
      <div className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-[45] flex justify-center px-3">
        <button
          type="button"
          onClick={() => setCanvasOnlyMode(false)}
          className="pointer-events-auto inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-panel/95 px-3 text-xs font-semibold text-fg shadow-lg backdrop-blur transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          title="일반 편집 화면으로 복원 (Esc)"
        >
          <Maximize2
            size={STUDIO_ICON_SIZE.context}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioChromeIconClass({ tone: "accent" })}
          />
          도구막대 복원
          <kbd className="rounded border border-line bg-card px-1.5 py-0.5 text-[0.65rem] font-medium text-fg-3">Esc</kbd>
        </button>
      </div>
    ) : null}
    {/*
      §15.3 Help 그룹의 다섯 표면(현재 도구·용어 사전·진단·복구·라이선스·버그
      리포트) 호스트. 자기 상태만 들고 채널로 요청을 받으므로 prop 이 없고, 열기
      전에는 아무것도 렌더하지 않는다. 캔버스만 모드에서도 살아 있어야 해서
      Container 밖 최상단에 둔다.
    */}
    <StudioHelpCenterHost />
    </div>
    </StudioToolHintPreferencesProvider>
    </StudioLiveCollaborationProvider>

  );
}
