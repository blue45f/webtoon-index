import {
  LayoutTemplate,
  Maximize2,
  MonitorSmartphone,
  MonitorUp,
  Minus,
  Minimize2,
  Plus,
  Ruler,
  RotateCcw,
} from "lucide-react";
import { memo, type ComponentProps } from "react";

import {
  StudioToolbarCluster,
  StudioToolbarDivider,
  studioChromeIconClass,
  STUDIO_ICON_SIZE,
  STUDIO_ICON_STROKE,
} from "./studio-chrome-ui";
import { STUDIO_VIEW_ZOOM_MAX, STUDIO_VIEW_ZOOM_MIN, stepStudioViewZoom } from "./studio-view-controls";
import { StudioToolHintTarget } from "./StudioToolHint";

import type { StudioToolHintSpec } from "./studio-tool-hints";

import { cn } from "@/shared/lib/utils";

function StudioToolBeltHintTarget(props: Omit<ComponentProps<typeof StudioToolHintTarget>, "preferredSide">) {
  return <StudioToolHintTarget preferredSide="bottom" {...props} />;
}

export interface StudioToolBeltCanvasControlsHintMap {
  zoomOut: StudioToolHintSpec;
  zoomIn: StudioToolHintSpec;
  actualSize: StudioToolHintSpec;
  fitWidth: StudioToolHintSpec;
  resetView: StudioToolHintSpec;
  workspaceFocus: StudioToolHintSpec;
  workspaceRestore: StudioToolHintSpec;
  maximizeWindow: StudioToolHintSpec;
  restoreWindow: StudioToolHintSpec;
  fullscreen: StudioToolHintSpec;
  exitFullscreen: StudioToolHintSpec;
  canvasOnly: StudioToolHintSpec;
}

export interface StudioToolBeltCanvasControlsProps {
  canvasOnlyMode: boolean;
  isFullscreen: boolean;
  maximized: boolean;
  presentationPanelsHidden: boolean;
  zoom: number;
  isWorkspaceWideMode: boolean;
  toolBtn: (active: boolean) => string;
  setZoom: import("react").Dispatch<import("react").SetStateAction<number>>;
  enterCanvasOnlyMode: () => void;
  onFitCanvasToWidth: () => void;
  resetView: () => void;
  setActualPixelView: () => void;
  toggleWorkspaceWideMode: () => void;
  toggleMaximize: () => void;
  toggleFullscreen: () => void;
  hints: StudioToolBeltCanvasControlsHintMap;
}

export const StudioToolBeltCanvasControls = memo(function StudioToolBeltCanvasControls(
  props: StudioToolBeltCanvasControlsProps,
) {
  const {
    canvasOnlyMode,
    isFullscreen,
    maximized,
    presentationPanelsHidden,
    zoom,
    isWorkspaceWideMode,
    toolBtn,
    setZoom,
    enterCanvasOnlyMode,
    onFitCanvasToWidth,
    resetView,
    setActualPixelView,
    toggleWorkspaceWideMode,
    toggleMaximize,
    toggleFullscreen,
    hints,
  } = props;

  const isZoomOutDisabled = zoom <= STUDIO_VIEW_ZOOM_MIN;
  const isZoomInDisabled = zoom >= STUDIO_VIEW_ZOOM_MAX;
  const studioToolIconClass = (iconProps?: Parameters<typeof studioChromeIconClass>[0]) =>
    studioChromeIconClass(iconProps ?? {});

  return (
    <StudioToolbarCluster label="화면·캔버스" className="ml-auto hidden lg:flex">
      <StudioToolBeltHintTarget
        hint={hints.zoomOut}
        disabled={isZoomOutDisabled}
        unavailableReason={isZoomOutDisabled ? "최소 축소 배율에 도달했습니다." : undefined}
      >
        <button
          type="button"
          onClick={() => setZoom((current) => stepStudioViewZoom(current, -1))}
          disabled={isZoomOutDisabled}
          className={cn(toolBtn(false), "h-8 px-1.5 disabled:opacity-40")}
          aria-label={hints.zoomOut.title}
        >
          <Minus
            size={STUDIO_ICON_SIZE.contextMenu}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioToolIconClass({
              disabled: isZoomOutDisabled,
            })}
          />
        </button>
      </StudioToolBeltHintTarget>
      <span className="w-9 text-center text-[0.62rem] font-bold tabular-nums text-fg-3">
        {Math.round(zoom * 100)}%
      </span>
      <StudioToolBeltHintTarget
        hint={hints.zoomIn}
        disabled={isZoomInDisabled}
        unavailableReason={isZoomInDisabled ? "최대 확대 배율에 도달했습니다." : undefined}
      >
        <button
          type="button"
          onClick={() => setZoom((current) => stepStudioViewZoom(current, 1))}
          disabled={isZoomInDisabled}
          className={cn(toolBtn(false), "h-8 px-1.5 disabled:opacity-40")}
          aria-label={hints.zoomIn.title}
        >
          <Plus
            size={STUDIO_ICON_SIZE.contextMenu}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioToolIconClass({
              disabled: isZoomInDisabled,
            })}
          />
        </button>
      </StudioToolBeltHintTarget>
      <StudioToolBeltHintTarget hint={hints.actualSize}>
        <button
          type="button"
          onClick={setActualPixelView}
          className={cn(toolBtn(false), "h-8 gap-1 px-1.5 text-[0.62rem] font-semibold")}
          aria-label={hints.actualSize.title}
        >
          <Ruler
            size={STUDIO_ICON_SIZE.contextMenu}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioToolIconClass()}
          />
          100%
        </button>
      </StudioToolBeltHintTarget>
      <StudioToolBeltHintTarget hint={hints.fitWidth}>
        <button
          type="button"
          onClick={onFitCanvasToWidth}
          className={cn(toolBtn(false), "h-8 gap-1 px-1.5 text-[0.62rem] font-semibold")}
          aria-label={hints.fitWidth.title}
        >
          <LayoutTemplate
            size={STUDIO_ICON_SIZE.contextMenu}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioToolIconClass()}
          />
          폭 맞춤
        </button>
      </StudioToolBeltHintTarget>
      <StudioToolBeltHintTarget hint={hints.resetView}>
        <button
          type="button"
          onClick={resetView}
          className={cn(toolBtn(false), "h-8 gap-1 px-1.5 text-[0.62rem] font-semibold")}
          aria-label={hints.resetView.title}
        >
          <RotateCcw
            size={STUDIO_ICON_SIZE.contextMenu}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioToolIconClass()}
          />
          리셋
        </button>
      </StudioToolBeltHintTarget>
      <StudioToolbarDivider />
      <StudioToolBeltHintTarget
        hint={isWorkspaceWideMode ? hints.workspaceRestore : hints.workspaceFocus}
        disabled={presentationPanelsHidden}
        unavailableReason={
          presentationPanelsHidden
            ? "전체화면·브라우저 맞춤에서는 작업 패널을 임시로 숨깁니다."
            : undefined
        }
      >
        <button
          type="button"
          onClick={toggleWorkspaceWideMode}
          disabled={presentationPanelsHidden}
          aria-pressed={isWorkspaceWideMode}
          className={cn(
            toolBtn(isWorkspaceWideMode),
            "h-8 gap-1 px-1.5 text-[0.62rem] font-semibold disabled:cursor-not-allowed disabled:opacity-45",
          )}
          aria-label={
            isWorkspaceWideMode
              ? hints.workspaceRestore.title
              : hints.workspaceFocus.title
          }
        >
          <Maximize2
            size={STUDIO_ICON_SIZE.contextMenu}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioToolIconClass({ active: isWorkspaceWideMode })}
          />
          <span>{isWorkspaceWideMode ? "패널 펼치기" : "패널 접기"}</span>
        </button>
      </StudioToolBeltHintTarget>
      <StudioToolBeltHintTarget
        hint={maximized ? hints.restoreWindow : hints.maximizeWindow}
      >
        <button
          type="button"
          onClick={toggleMaximize}
          aria-pressed={maximized}
          className={cn(toolBtn(maximized), "h-8 gap-1 px-1.5 text-[0.62rem] font-semibold")}
          aria-label={maximized ? hints.restoreWindow.title : hints.maximizeWindow.title}
        >
          {maximized ? (
            <>
              <Minimize2
                size={STUDIO_ICON_SIZE.contextMenu}
                strokeWidth={STUDIO_ICON_STROKE}
                aria-hidden
                className={studioToolIconClass({ active: maximized })}
              />
              창 복원
            </>
          ) : (
            <>
              <Maximize2
                size={STUDIO_ICON_SIZE.contextMenu}
                strokeWidth={STUDIO_ICON_STROKE}
                aria-hidden
                className={studioToolIconClass()}
              />
              창 맞춤
            </>
          )}
        </button>
      </StudioToolBeltHintTarget>
      <StudioToolBeltHintTarget
        hint={isFullscreen ? hints.exitFullscreen : hints.fullscreen}
      >
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-pressed={isFullscreen}
          className={cn(toolBtn(isFullscreen), "h-8 gap-1 px-1.5 text-[0.62rem] font-semibold")}
          aria-label={isFullscreen ? hints.exitFullscreen.title : hints.fullscreen.title}
        >
          {isFullscreen ? (
            <>
              <Minimize2
                size={STUDIO_ICON_SIZE.contextMenu}
                strokeWidth={STUDIO_ICON_STROKE}
                aria-hidden
                className={studioToolIconClass({ active: isFullscreen })}
              />
              전체 해제
            </>
          ) : (
            <>
              <MonitorSmartphone
                size={STUDIO_ICON_SIZE.contextMenu}
                strokeWidth={STUDIO_ICON_STROKE}
                aria-hidden
                className={studioToolIconClass()}
              />
              전체화면
            </>
          )}
        </button>
      </StudioToolBeltHintTarget>
      <StudioToolBeltHintTarget hint={hints.canvasOnly}>
        <button
          type="button"
          onClick={enterCanvasOnlyMode}
          aria-pressed={canvasOnlyMode}
          className={cn(toolBtn(canvasOnlyMode), "h-8 gap-1 px-1.5 text-[0.62rem] font-semibold")}
          aria-label={hints.canvasOnly.title}
        >
          <MonitorUp
            size={STUDIO_ICON_SIZE.contextMenu}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioToolIconClass({ active: canvasOnlyMode })}
          />
          캔버스 전용
        </button>
      </StudioToolBeltHintTarget>
    </StudioToolbarCluster>
  );
});
