import { Clapperboard, Eraser, FlipHorizontal2, Grid3X3, Maximize2, Minimize2, MousePointer2, PaintBucket, Pencil, PenTool, Shapes, Sparkles, Square, Wind } from "lucide-react";
import { Fragment, Suspense, type Dispatch, type ReactNode, type SetStateAction } from "react";

import { studioDrawHudToolLabel, studioPressureCurveHudLabel, studioShapeFillHudLabel, studioShapeKindLabel, studioStabilizerHudLabel, studioSymmetryHudLabel } from "../brush/studio-draw-hud";
import { StudioHudPill, StudioStatusBar } from "../studio-chrome-ui";
import { elementLabel } from "../studio-element-label";
import { StudioLivePressureHudPill } from "../studio-page-lazy-ui";
import { pageDisplayName } from "../studio-page-meta";
import { studioUiDensityDescription, studioUiDensityLabel, type StudioUiDensityMode } from "../studio-ui-density";
import { STUDIO_VIEW_ACTION_HINTS } from "../studio-view-action-hints";
import { stepStudioViewZoom } from "../studio-view-controls";
import { StudioToolHintTarget } from "../StudioToolHint";

import { localizeText } from "./studio-canvas-viewport-primitives";
import { StudioViewInputModeControls } from "./StudioCanvasViewInputModeControls";

import type { StudioLivePressureStore } from "../live/StudioLiveInkHosts";
import type { StudioAppSettings } from "../studio-app-settings";
import type { DrawMode, DrawShapeKind, Tool } from "../studio-editor-tool-model";
import type { El } from "../studio-element-model";
import type { PageState } from "../studio-page-state";

import { cn } from "@/shared/lib/utils";

/**
 * Desktop stage HUD — the Sketchbook/Krita-style status bar floating over the canvas: view-input
 * controls, the zoom stepper, the page pill, and the live tool/brush metric pills.
 *
 * A plain factory rather than a component: every value it reads stays owned by the viewport, and
 * the HUD holds no state or effects of its own.
 */
export interface StudioCanvasStageHudContext {
  readonly activeCatalogBrushName: string;
  readonly activePage: PageState;
  readonly activePageIndex: number;
  readonly appSettings: StudioAppSettings;
  readonly brushOpacity: number;
  readonly canvasOnlyMode: boolean;
  readonly drawMode: DrawMode;
  readonly drawShape: DrawShapeKind;
  readonly enterCanvasOnlyMode: () => void;
  readonly eraserPresetActive: boolean;
  readonly fitCanvasToWidth: () => void;
  readonly isMobile: boolean;
  readonly liveDrawPressureStore: StudioLivePressureStore;
  readonly mobileImmersive: boolean;
  readonly pageSequenceOpen: boolean;
  readonly pressureCurve: number;
  readonly quickShapeActive: boolean;
  readonly scale: number;
  readonly selected: El | null;
  readonly setCanvasOnlyMode: Dispatch<SetStateAction<boolean>>;
  readonly setPageSequenceOpen: Dispatch<SetStateAction<boolean>>;
  readonly setStudioUiDensity: (mode: StudioUiDensityMode) => void;
  readonly setZoom: Dispatch<SetStateAction<number>>;
  readonly setZoomLocked: Dispatch<SetStateAction<boolean>>;
  readonly shapeFill: boolean;
  readonly stabilizer: number;
  readonly stabilizerMode: "standard" | "adaptive" | "precision";
  readonly strokeWidth: number;
  readonly symmetryType: "none" | "vertical" | "horizontal" | "radial" | "kaleidoscope" | "silk";
  readonly t: (key: string) => string;
  readonly toggleWheelCanvasMode: () => void;
  readonly tool: Tool;
  readonly uiDensityMode: "simple" | "full" | "focus";
  readonly viewBusyReason: string | undefined;
  readonly viewTransformSuppressed: boolean;
  readonly zoom: number;
  readonly zoomInAtLimit: boolean;
  readonly zoomInUnavailableReason: string | undefined;
  readonly zoomLocked: boolean;
  readonly zoomOutAtLimit: boolean;
  readonly zoomOutUnavailableReason: string | undefined;
}

export function renderStudioCanvasStageHud({
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
}: StudioCanvasStageHudContext): ReactNode {
  return (
    <Fragment>
    {/* Sketchbook/Krita/Concepts status — zoom HUD + tool metrics over canvas */}
    {!canvasOnlyMode && !isMobile ? (
      <StudioStatusBar
        className={cn(
          mobileImmersive && "bottom-[calc(5.5rem+env(safe-area-inset-bottom))]"
        )}
        style={
          tool === "draw"
            ? {
                bottom:
                  "calc(var(--studio-draw-options-height, 3.75rem) + max(0.75rem, env(safe-area-inset-bottom)) + 0.75rem)",
              }
            : undefined
        }
      >
        <StudioViewInputModeControls
          wheelMode={appSettings.mouse.wheel}
          zoomLocked={zoomLocked}
          onToggleWheelMode={toggleWheelCanvasMode}
          onToggleZoomLock={() => setZoomLocked((current) => !current)}
        />
        <StudioHudPill>
          <StudioToolHintTarget
            hint={STUDIO_VIEW_ACTION_HINTS.zoomOut}
            unavailableReason={zoomOutUnavailableReason}
            preferredSide="top"
          >
            <button
              type="button"
              className={cn(
                "grid size-7 place-items-center rounded text-fg-3 hover:bg-raised hover:text-fg",
                (viewTransformSuppressed || zoomLocked || zoomOutAtLimit) && "cursor-not-allowed opacity-40"
              )}
              aria-label="축소"
              aria-disabled={viewTransformSuppressed || zoomLocked || zoomOutAtLimit ? true : undefined}
              onClick={() => {
                if (!viewTransformSuppressed && !zoomLocked && !zoomOutAtLimit) {
                  setZoom((current) => stepStudioViewZoom(current, -1));
                }
              }}
            >
              −
            </button>
          </StudioToolHintTarget>
          <span className="min-w-[2.4rem] text-center tabular-nums text-fg">
            {Math.round(zoom * scale * 100)}%
          </span>
          <StudioToolHintTarget
            hint={STUDIO_VIEW_ACTION_HINTS.zoomIn}
            unavailableReason={zoomInUnavailableReason}
            preferredSide="top"
          >
            <button
              type="button"
              className={cn(
                "grid size-7 place-items-center rounded text-fg-3 hover:bg-raised hover:text-fg",
                (viewTransformSuppressed || zoomLocked || zoomInAtLimit) && "cursor-not-allowed opacity-40"
              )}
              aria-label="확대"
              aria-disabled={viewTransformSuppressed || zoomLocked || zoomInAtLimit ? true : undefined}
              onClick={() => {
                if (!viewTransformSuppressed && !zoomLocked && !zoomInAtLimit) {
                  setZoom((current) => stepStudioViewZoom(current, 1));
                }
              }}
            >
              +
            </button>
          </StudioToolHintTarget>
        </StudioHudPill>
        <StudioHudPill title={pageDisplayName(activePage, activePageIndex)} className="max-w-[7rem] truncate">
          <button
            type="button"
            aria-expanded={pageSequenceOpen}
            aria-label={`페이지 시퀀스 ${pageSequenceOpen ? "닫기" : "열기"} · ${pageDisplayName(activePage, activePageIndex)}`}
            onClick={() => setPageSequenceOpen((current) => !current)}
            className="inline-flex min-h-6 min-w-0 items-center gap-1 rounded-full px-1.5 text-fg transition-colors hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Clapperboard size={11} aria-hidden />
            <span className="truncate">{pageDisplayName(activePage, activePageIndex)}</span>
          </button>
        </StudioHudPill>
        <StudioHudPill
          title={studioDrawHudToolLabel(
            tool === "draw"
              ? drawMode === "eraser"
                ? {
                    mode: "eraser",
                    widthPx: strokeWidth,
                    ...(eraserPresetActive
                      ? {
                          brushName: activeCatalogBrushName,
                          opacity01: brushOpacity,
                        }
                      : {}),
                  }
                : drawMode === "shape"
                  ? { mode: "shape", shapeLabel: studioShapeKindLabel(drawShape) }
                  : drawMode === "pixel"
                    ? { mode: "pixel" }
                  : {
                      mode: "pen",
                      brushName: activeCatalogBrushName,
                      widthPx: strokeWidth,
                      opacity01: brushOpacity,
                    }
              : tool === "select"
                ? {
                    mode: "select",
                    selectionLabel: selected ? elementLabel(selected) : null,
                  }
                : { mode: "other", label: String(tool) }
          )}
          accent={tool === "draw"}
        >
          {tool === "draw" && drawMode === "eraser" ? (
            <Eraser size={12} strokeWidth={1.75} aria-hidden />
          ) : tool === "draw" && drawMode === "shape" ? (
            <Shapes size={12} strokeWidth={1.75} aria-hidden />
          ) : tool === "draw" && drawMode === "pixel" ? (
            <Grid3X3 size={12} strokeWidth={1.75} aria-hidden />
          ) : tool === "draw" ? (
            <Pencil size={12} strokeWidth={1.75} aria-hidden />
          ) : tool === "select" ? (
            <MousePointer2 size={12} strokeWidth={1.75} aria-hidden />
          ) : (
            <span className="tabular-nums">{String(tool)}</span>
          )}
          {tool === "draw" ? (
            <span className="tabular-nums">
              {drawMode === "shape"
                ? studioShapeKindLabel(drawShape)
                : drawMode === "pixel"
                  ? "1px"
                  : eraserPresetActive
                    ? `${activeCatalogBrushName} · ${strokeWidth}px · ${Math.round(brushOpacity * 100)}%`
                    : `${strokeWidth}px`}
            </span>
          ) : null}
        </StudioHudPill>
        {tool === "draw" && drawMode === "pen" ? (
          <StudioHudPill title={studioStabilizerHudLabel(stabilizer, stabilizerMode)}>
            <Wind size={12} strokeWidth={1.75} aria-hidden />
            <span className="tabular-nums">{stabilizer}</span>
          </StudioHudPill>
        ) : null}
        {tool === "draw" && drawMode === "pen" ? (
          <StudioHudPill title={studioPressureCurveHudLabel(pressureCurve)}>
            <PenTool size={12} strokeWidth={1.75} aria-hidden />
          </StudioHudPill>
        ) : null}
        {tool === "draw" && drawMode === "pen" ? (
          <Suspense fallback={null}>
            <StudioLivePressureHudPill store={liveDrawPressureStore} />
          </Suspense>
        ) : null}
        {tool === "draw" && drawMode === "shape" && studioShapeFillHudLabel(shapeFill, drawShape) ? (
          <StudioHudPill accent title={localizeText(t, "도형 채우기", "studio.canvas.shapeFill")}>
            <PaintBucket size={12} strokeWidth={1.75} aria-hidden />
          </StudioHudPill>
        ) : null}
        {tool === "draw" && drawMode !== "pixel" && symmetryType !== "none" ? (
          <StudioHudPill accent title={studioSymmetryHudLabel(symmetryType) ?? "대칭"}>
            <FlipHorizontal2 size={12} strokeWidth={1.75} aria-hidden />
          </StudioHudPill>
        ) : null}
        {tool === "draw" && quickShapeActive ? (
          <StudioHudPill accent title={t("studio.quickShape.title")}>
            <Sparkles size={12} strokeWidth={1.75} aria-hidden />
          </StudioHudPill>
        ) : null}
        <div
          className="flex items-center gap-px"
          role="group"
          aria-label={localizeText(t, "레이아웃 모드", "studio.canvas.layoutMode")}
        >
          {(
            [
              { mode: "focus" as const, Icon: Minimize2 },
              { mode: "simple" as const, Icon: Square },
              { mode: "full" as const, Icon: Maximize2 },
            ] as const
          ).map(({ mode, Icon }) => (
            <button
              key={mode}
              type="button"
              aria-pressed={uiDensityMode === mode}
              title={`${studioUiDensityLabel(mode)} — ${studioUiDensityDescription(mode)}`}
              aria-label={`${studioUiDensityLabel(mode)} — ${studioUiDensityDescription(mode)}`}
              onClick={() => setStudioUiDensity(mode)}
              className={cn(
                "grid size-6 place-items-center rounded-full transition-colors",
                uiDensityMode === mode
                  ? "bg-accent text-on-accent"
                  : "text-fg-3 hover:bg-raised hover:text-fg-2"
              )}
            >
              <Icon size={11} strokeWidth={1.75} aria-hidden />
            </button>
          ))}
        </div>
        <StudioToolHintTarget
          hint={STUDIO_VIEW_ACTION_HINTS.fitWidth}
          unavailableReason={viewBusyReason}
          preferredSide="top"
        >
          <button
            type="button"
            onClick={() => {
              if (!viewTransformSuppressed) fitCanvasToWidth();
            }}
            aria-disabled={viewTransformSuppressed ? true : undefined}
            className={cn(
              "min-h-7 rounded-full px-2 py-0.5 text-[0.58rem] font-bold text-fg-3 hover:bg-raised hover:text-fg",
              viewTransformSuppressed && "cursor-not-allowed opacity-40"
            )}
          >
            {localizeText(t, "맞춤", "studio.canvas.fit")}
          </button>
        </StudioToolHintTarget>
        <button
          type="button"
          onClick={() => {
            if (canvasOnlyMode) setCanvasOnlyMode(false);
            else enterCanvasOnlyMode();
          }}
          aria-label={canvasOnlyMode
            ? localizeText(t, "도구 보기", "studio.canvas.canvasOnlyModeShowTools")
            : localizeText(t, "` · 캔버스만 보기", "studio.canvas.canvasOnlyModeShowCanvasOnly")}
          className="min-h-6 min-w-6 rounded-full px-1.5 py-0.5 text-[0.58rem] font-bold text-fg-3 hover:bg-raised hover:text-fg"
          title={localizeText(t, "` — 캔버스만 / 도구 토글", "studio.canvas.canvasOnlyModeTitle")}
        >
          {canvasOnlyMode ? localizeText(t, "도구", "studio.canvas.canvasOnlyModeTool") : "`"}
        </button>
      </StudioStatusBar>
    ) : null}
    </Fragment>
  );
}
