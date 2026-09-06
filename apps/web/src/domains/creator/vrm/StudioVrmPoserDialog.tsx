/**
 * Studio VRM poser view slice extracted from `StudioVrmPoser.tsx` (behavior unchanged).
 * The caller passes one host object; this component destructures the original local names.
 */
import {
  ImagePlus,
  Loader2,
  UserRound,
  X,
} from "lucide-react";
import {
  createPortal as createDomPortal,
} from "react-dom";

import {
  PANEL_TABS,
} from "./studio-vrm-poser-catalogs";
import {
  cx,
} from "./studio-vrm-poser-helpers";
import {
  StudioVrmBroadcastPreviewOverlay,
} from "./StudioVrmBroadcastPreview";
import { StudioVrmPoserPanelBodyA } from "./StudioVrmPoserPanelBodyA";
import { StudioVrmPoserPanelBodyB } from "./StudioVrmPoserPanelBodyB";
import { StudioVrmPoserPanelBodyC } from "./StudioVrmPoserPanelBodyC";
import { StudioVrmPoserPanelBodyD } from "./StudioVrmPoserPanelBodyD";
import {
  CONTROL_BUTTON,
  ICON_BUTTON,
} from "./StudioVrmPoserTypes";
import { StudioVrmPoserViewport } from "./StudioVrmPoserViewport";
import {
  studioVrmProportionsRequireRuntime,
} from "./StudioVrmViewportUtils";

import type { StudioVrmPoserHost } from "./StudioVrmPoserHost";
import type {
  VRM,
} from "@pixiv/three-vrm";

export function StudioVrmPoserDialog({ h }: { h: StudioVrmPoserHost }) {
  const {
    onClose,
    dialogTitleId,
    dialogDescriptionId,
    dialogRef,
    closeButtonRef,
    status,
    vrm,
    activePanelTab,
    recentPreferencesRuntime,
    recentPreferencesSnapshot,
    broadcastPreviewReceipt,
    broadcastPreviewActive,
    broadcastExitButtonRef,
    isCapturing,
    isThumbnailCapturing,
    avatarForgeState,
    proportionRigStatus,
    proportionRigReceipt,
    transparentBackground,
    isSharingPose,
    idleAnimation,
    webcamActive,
    panelScrollRef,
    persistentIkReconciling,
    cancelPendingPoseShare,
    handlePanelTabChange,
    handleTabKeyDown,
    cancelActiveTexturePaintStroke,
    texturePaintModeSelected,
    texturePaintStrokeActive,
    finishBroadcastPreview,
    displayModelName,
    handleInsert,
  } = h;
  return createDomPortal(
    <div
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={dialogTitleId}
      aria-describedby={dialogDescriptionId}
      className="fixed inset-0 z-[80] isolate overflow-hidden overscroll-none bg-[oklch(0.08_0.01_70/0.86)] p-2 text-fg backdrop-blur-sm pointer-coarse:[&_button]:min-h-11 pointer-coarse:[&_button]:min-w-11 pointer-coarse:[&_input:not([type=range]):not([type=checkbox]):not([type=color])]:min-h-11 pointer-coarse:[&_input[type=range]]:h-11 pointer-coarse:[&_select]:min-h-11 pointer-coarse:[&_summary]:min-h-11 sm:p-4"
      data-studio-vrm-dialog="true"
      data-studio-vrm-recent-persistence={recentPreferencesSnapshot.state}
      data-studio-vrm-recent-authority={
        recentPreferencesSnapshot.state === "memory-only" ? "memory-only" : "sqlite-opfs"
      }
      role="dialog"
      tabIndex={-1}
      style={{
        // 노치/홈인디케이터 안전영역을 모달 바깥 패딩에 반영해 하단(웹캠/푸터)이 잘리지 않게 한다.
        paddingTop: "max(0.5rem, env(safe-area-inset-top))",
        paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
      }}
    >
      <div
        className={cx(
          "relative mx-auto flex h-full min-h-0 max-h-full flex-col overflow-hidden bg-panel",
          broadcastPreviewActive
            ? "max-w-none rounded-none border-0 shadow-none"
            : "max-w-[1480px] rounded-2xl border border-line shadow-[0_24px_80px_oklch(0.05_0.01_70/0.55)]",
        )}
      >
        <header
          hidden={broadcastPreviewActive}
          className={cx(
            "flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5",
            broadcastPreviewActive && "!hidden",
          )}
        >
          <div className="min-w-0">
            <p className="eyebrow flex items-center gap-1.5 text-accent">
              <UserRound size={14} aria-hidden />
              VRM 캐릭터 빌더
            </p>
            <h2 id={dialogTitleId} className="mt-1 truncate text-lg font-bold tracking-tight text-fg sm:text-xl">3D 캐릭터 만들기</h2>
            <p id={dialogDescriptionId} className="mt-1 line-clamp-1 text-xs text-fg-3">
              {displayModelName
                ? `${displayModelName} · ${transparentBackground ? "캐릭터만 투명 PNG로 패널에 추가" : "배경색 포함 PNG로 패널에 추가"}`
                : "내 VRM을 불러와 패널에 추가"}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="닫기"
            title={
              isCapturing
                ? "캡처가 끝난 뒤 닫을 수 있습니다."
                : texturePaintStrokeActive
                  ? "닫기 · 진행 중인 표면 페인트 작업은 취소됩니다. (Esc)"
                : "닫기 (Esc)"
            }
            className={ICON_BUTTON}
            disabled={isCapturing}
            onClick={() => {
              cancelActiveTexturePaintStroke();
              cancelPendingPoseShare();
              onClose();
            }}
          >
            <X size={17} aria-hidden />
          </button>
        </header>

        {!broadcastPreviewActive && recentPreferencesSnapshot.state === "memory-only" ? (
          <div
            className="flex shrink-0 items-center justify-between gap-3 border-b border-warn/30 bg-warn/10 px-4 py-2 text-[0.68rem] leading-relaxed text-warn sm:px-5"
            role="status"
            aria-live="polite"
            data-studio-vrm-recent-persistence-warning="memory-only"
          >
            <span>{recentPreferencesSnapshot.message}</span>
            <button
              type="button"
              className="shrink-0 rounded border border-warn/40 bg-card px-2.5 py-1 font-semibold hover:bg-raised"
              onClick={() => void recentPreferencesRuntime.retry()}
            >
              SQLite/OPFS 다시 연결
            </button>
          </div>
        ) : null}

        {/* 모바일: 뷰포트(상단)+컨트롤(하단) 두 행을 명시적으로 나눠 컨트롤 패널이 자체 스크롤되게 한다
            (행을 안 잡으면 패널이 모달 밖으로 흘러 하단의 웹캠/푸터가 잘림). 데스크톱(lg): 2단 컬럼. */}
        <div
          className={cx(
            "grid min-h-0 flex-1 grid-cols-1 lg:grid-rows-1",
            broadcastPreviewActive
              ? "grid-rows-1 lg:grid-cols-1"
              : texturePaintModeSelected
                ? "grid-rows-[minmax(0,2fr)_minmax(0,3fr)] sm:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_420px] 2xl:grid-cols-[minmax(0,1fr)_460px]"
                : "grid-rows-[minmax(0,36dvh)_minmax(0,1fr)] sm:grid-rows-[minmax(0,40dvh)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_420px] 2xl:grid-cols-[minmax(0,1fr)_460px]",
          )}
        >
          <StudioVrmPoserViewport h={h} />
          <aside
            aria-hidden={broadcastPreviewActive || undefined}
            hidden={broadcastPreviewActive}
            inert={broadcastPreviewActive ? true : undefined}
            className={cx(
              "flex min-h-0 flex-col border-t border-line bg-panel lg:border-l lg:border-t-0",
              broadcastPreviewActive && "!hidden",
            )}
          >
            <div role="tablist" aria-label="컨트롤 카테고리" className="grid shrink-0 grid-cols-5 gap-1 border-b border-line bg-panel/95 px-2 py-2 backdrop-blur sm:px-3">
              {PANEL_TABS.map((tab) => {
                const TabIcon = tab.icon;
                const isActive = activePanelTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    id={`vrm-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls="vrm-panel-body"
                    tabIndex={isActive ? 0 : -1}
                    title={tab.hint}
                    onKeyDown={handleTabKeyDown}
                    className={cx(
                      "group flex min-h-11 flex-col items-center gap-1 rounded-xl border px-1 py-1.5 text-[0.66rem] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                      isActive
                        ? "border-accent/55 bg-accent-soft text-accent shadow-[inset_0_-2px_0_0_var(--color-accent,oklch(0.72_0.16_45))]"
                        : "border-transparent text-fg-3 hover:bg-raised hover:text-fg"
                    )}
                    onClick={() => handlePanelTabChange(tab.id)}
                  >
                    <TabIcon size={17} aria-hidden className={isActive ? "" : "opacity-80 group-hover:opacity-100"} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
            <div ref={panelScrollRef} id="vrm-panel-body" role="tabpanel" aria-labelledby={`vrm-tab-${activePanelTab}`} className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-gutter:stable] sm:px-5">
              <StudioVrmPoserPanelBodyA h={h} />
              <StudioVrmPoserPanelBodyB h={h} />
              <StudioVrmPoserPanelBodyC h={h} />
              <StudioVrmPoserPanelBodyD h={h} />
            </div>
            <footer className="sticky bottom-0 z-20 flex shrink-0 items-center justify-between gap-2 border-t border-line bg-panel/95 px-4 py-3 backdrop-blur sm:px-5">
              <button
                type="button"
                className={cx(CONTROL_BUTTON, "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-45")}
                disabled={isCapturing}
                onClick={() => {
                  cancelActiveTexturePaintStroke();
                  cancelPendingPoseShare();
                  onClose();
                }}
              >
                닫기
              </button>
              <button
                type="button"
                className={cx(CONTROL_BUTTON, "min-w-36 border-accent/60 bg-accent text-on-accent hover:bg-accent/90")}
                disabled={
                  !vrm
                  || status === "loading"
                  || isCapturing
                  || isSharingPose
                  || isThumbnailCapturing
                  || webcamActive
                  || idleAnimation
                  || persistentIkReconciling
                  || texturePaintStrokeActive
                  || proportionRigStatus === "applying"
                  || proportionRigStatus === "reload-required"
                  || (
                    studioVrmProportionsRequireRuntime(avatarForgeState)
                    && (proportionRigStatus !== "ready" || !proportionRigReceipt)
                  )
                }
                onClick={handleInsert}
              >
                {isCapturing ? <Loader2 className="animate-spin" size={14} aria-hidden /> : <ImagePlus size={14} aria-hidden />}
                이 포즈로 추가
              </button>
            </footer>
          </aside>
        </div>
        {broadcastPreviewReceipt ? (
          <StudioVrmBroadcastPreviewOverlay
            receipt={broadcastPreviewReceipt}
            exitButtonRef={broadcastExitButtonRef}
            onExit={() => finishBroadcastPreview({ restoreFocus: true })}
          />
        ) : null}
      </div>
    </div>,
    document.body
  );
}
