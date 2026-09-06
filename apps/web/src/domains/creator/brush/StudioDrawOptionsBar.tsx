/**
 * StudioDrawOptionsBar — PicsArt / CSP-class commercial draw chrome.
 *
 * Primary strip: mode · active brush · library · size · opacity · color · sticky tools
 * Progressive disclosure: advanced (stabilizer / pressure / locks / slots)
 * Full brush library sheet (search · favorites · categories)
 */
import {
  ChevronDown,
  ChevronUp,
  Circle,
  Droplets,
  Eraser,
  FlipHorizontal2,
  Grid3X3,
  LayoutGrid,
  Lock,
  LockOpen,
  PaintBucket,
  Pencil,
  Pipette,
  RotateCcw,
  Scissors,
  Shapes,
  Sparkles,
  Star,
  Wand2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

import {
  BRUSH_PRESETS,
  STUDIO_BRUSH_OPACITY_CHIPS,
  STUDIO_BRUSH_SIZE_CHIPS,
  nearestStudioBrushOpacityChip,
  nearestStudioBrushSizeChip,
  resolveStudioBrushPresetOperation,
} from "../studio-brush";
import { studioBrushTrayItem } from "../studio-creative-ux";
import {
  StudioOpacityGlyph,
  StudioPostCorrectGlyph,
  StudioPressureCurveGlyph,
  StudioShapePickerStrip,
  StudioSizeChipGlyph,
  StudioStabilizerGlyph,
  StudioStabilizerModeGlyph,
  StudioSymmetryGlyph,
} from "../studio-creative-visuals";
import { STUDIO_EASE, STUDIO_FOCUS_RING } from "../studio-panel-ui";
import { studioToolHintFromLabel } from "../studio-tool-hints";
import {
  STUDIO_ERASE_TO_INTERSECTION_LABEL,
  STUDIO_ERASE_TO_INTERSECTION_TIP,
} from "../studio-vector-erase-to-intersection-apply";
import { StudioDualColorWell } from "../StudioDualColorWell";
import {
  StudioLivingInkControls,
  type StudioLivingInkControlsProps,
} from "../StudioLivingInkControls";
import { StudioToolHintTarget } from "../StudioToolHint";

import { STUDIO_BRUSH_SIZE_RANGE } from "./studio-draw-ux";
import { StudioBrushPresetIcon } from "./StudioBrushPresetIcon";
import { StudioBrushTray } from "./StudioBrushTray";

import type { StudioBrushSlot } from "./studio-brush-slots";
import type { StudioBrushTrayItem } from "../studio-creative-ux";

import { cn } from "@/shared/lib/utils";

export type StudioDrawModeUi = "pen" | "pixel" | "eraser" | "shape";
export type StudioSymmetryUi = "none" | "vertical" | "horizontal" | "radial" | "kaleidoscope" | "silk";
export type StudioStabilizerModeUi = "standard" | "adaptive" | "precision";
export type StudioPressureCurveUi = "soft" | "linear" | "firm";

export interface StudioDrawOptionsBarProps {
  drawMode: StudioDrawModeUi;
  /** Canonical renderer preset id. It must remain stable even for procedural catalogue brushes. */
  brushId: string;
  /** User-facing catalogue identity, which may differ from the canonical renderer preset id. */
  activeCatalogBrushId?: string;
  activeCatalogBrushName?: string;
  /** Combined core + procedural catalogue used by the quick tray and active-brush label. */
  brushCatalogItems?: readonly StudioBrushTrayItem[];
  strokeWidth: number;
  brushOpacity: number;
  stabilizer: number;
  stabilizerMode?: StudioStabilizerModeUi;
  postCorrection?: number;
  pressureCurveId?: StudioPressureCurveUi;
  /** 스탬프 계열 브러시(잉크붓·정밀에어·그레인연필·물맛붓)일 때만 non-null. */
  stampTuning?: { flow: number; hardness: number; minSize: number } | null;
  onStampTuningChange?: (tuning: { flow: number; hardness: number; minSize: number }) => void;
  color: string;
  secondaryColor?: string;
  recentSwatches?: readonly string[];
  brushSlots?: readonly (StudioBrushSlot | null)[];
  symmetryType?: StudioSymmetryUi;
  quickShapeActive: boolean;
  canvasFlipH?: boolean;
  onSelectBrush: (item: StudioBrushTrayItem) => void;
  onStrokeWidthChange: (n: number) => void;
  onOpacityChange: (n: number) => void;
  onStabilizerChange: (n: number) => void;
  onStabilizerModeChange?: (mode: StudioStabilizerModeUi) => void;
  onPostCorrectionChange?: (n: number) => void;
  onPressureCurveChange?: (id: StudioPressureCurveUi) => void;
  onColorChange: (hex: string) => void;
  onSecondaryColorChange?: (hex: string) => void;
  onSwapColors?: () => void;
  /** Canvas-native eyedropper. Kept beside the foreground/background well for one-hand access. */
  eyedropperActive?: boolean;
  onToggleEyedropper?: () => void;
  /** CSP vector eraser: click freehand ink and erase between nearest intersections. */
  eraseToIntersection?: boolean;
  onToggleEraseToIntersection?: () => void;
  onToggleQuickShape: () => void;
  onToggleCanvasFlipH?: () => void;
  onOpenBrushStudio?: () => void;
  onSetDrawMode?: (mode: StudioDrawModeUi) => void;
  onRecallBrushSlot?: (index: number) => void;
  onAssignBrushSlot?: (index: number) => void;
  onSymmetryTypeChange?: (type: StudioSymmetryUi) => void;
  sizeLocked?: boolean;
  opacityLocked?: boolean;
  onToggleSizeLock?: () => void;
  onToggleOpacityLock?: () => void;
  recentBrushIds?: readonly string[];
  favoriteBrushIds?: readonly string[];
  onToggleFavoriteBrush?: (brushId: string) => void;
  brushCatalogOpen?: boolean;
  onToggleBrushCatalog?: (trigger: HTMLButtonElement) => void;
  /** Canonical full-brush restore state owned by StudioPage. */
  brushDefaultRestore?: Readonly<{
    sourceName: string;
    modifiedCount: number;
    loading: boolean;
    available?: boolean;
    undoAvailable?: boolean;
  }> | null;
  /** Restores every feel-affecting field while preserving color and brush identity. */
  onRestoreBrushDefaults?: () => void;
  onCycleStabilizer?: () => void;
  shapeKind?: string;
  onShapeKindChange?: (kind: string) => void;
  shapeFill?: boolean;
  onShapeFillChange?: (filled: boolean) => void;
  shapeSlot?: ReactNode;
  livingInk?: StudioLivingInkControlsProps;
  /** Float above the canvas bottom edge instead of consuming a second top row. */
  docked?: boolean;
  /** Desktop workspace chrome that the fixed dock must not cover. */
  dockInsets?: Readonly<{ left: number; right: number }>;
  className?: string;
}

function SizePreview({
  size,
  color,
  opacity,
}: {
  size: number;
  color: string;
  opacity: number;
}): ReactElement {
  const d = Math.min(26, Math.max(4, size * 0.42));
  const halo = Math.min(30, d + 6);
  return (
    <span
      aria-hidden
      data-studio-size-preview="true"
      className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-line/80 bg-canvas/90 shadow-[inset_0_1px_0_oklch(0.97_0.01_85/0.06)]"
    >
      <span
        className="absolute rounded-full opacity-25 blur-[1.5px]"
        style={{ width: halo, height: halo, background: color }}
      />
      <span
        className="relative rounded-full shadow-[0_1px_3px_oklch(0.1_0.01_70/0.35)] ring-1 ring-black/15"
        style={{
          width: d,
          height: d,
          backgroundColor: color,
          opacity: Math.max(0.2, opacity),
        }}
      />
    </span>
  );
}

const iconBtn = cn(
  "grid size-8 shrink-0 place-items-center rounded-lg border",
  STUDIO_EASE,
  STUDIO_FOCUS_RING
);

const BRUSH_SIZE_HINT_VARIANT = {
  xs: "preset-xs",
  s: "preset-s",
  m: "preset-m",
  l: "preset-l",
  xl: "preset-xl",
  xxl: "preset-xxl",
} as const satisfies Record<(typeof STUDIO_BRUSH_SIZE_CHIPS)[number]["id"], string>;

const BRUSH_OPACITY_HINT_VARIANT = {
  o20: "preset-20",
  o40: "preset-40",
  o60: "preset-60",
  o80: "preset-80",
  o100: "preset-100",
} as const satisfies Record<(typeof STUDIO_BRUSH_OPACITY_CHIPS)[number]["id"], string>;

export function StudioDrawOptionsBar({
  drawMode,
  brushId,
  activeCatalogBrushId,
  activeCatalogBrushName,
  brushCatalogItems,
  strokeWidth,
  brushOpacity,
  stabilizer,
  stabilizerMode = "adaptive",
  postCorrection = 0,
  pressureCurveId = "linear",
  stampTuning = null,
  onStampTuningChange,
  color,
  secondaryColor = "#ffffff",
  recentSwatches = [],
  brushSlots = [],
  symmetryType = "none",
  quickShapeActive,
  canvasFlipH = false,
  onSelectBrush,
  onStrokeWidthChange,
  onOpacityChange,
  onStabilizerChange,
  onStabilizerModeChange,
  onPostCorrectionChange,
  onPressureCurveChange,
  onColorChange,
  onSecondaryColorChange,
  onSwapColors,
  eyedropperActive = false,
  onToggleEyedropper,
  eraseToIntersection = false,
  onToggleEraseToIntersection,
  onToggleQuickShape,
  onToggleCanvasFlipH,
  onOpenBrushStudio,
  onSetDrawMode,
  onRecallBrushSlot,
  onAssignBrushSlot,
  onSymmetryTypeChange,
  sizeLocked = false,
  opacityLocked = false,
  onToggleSizeLock,
  onToggleOpacityLock,
  recentBrushIds = [],
  favoriteBrushIds = [],
  onToggleFavoriteBrush,
  brushCatalogOpen = false,
  onToggleBrushCatalog,
  brushDefaultRestore = null,
  onRestoreBrushDefaults,
  onCycleStabilizer,
  shapeKind = "line",
  onShapeKindChange,
  shapeFill = false,
  onShapeFillChange,
  shapeSlot,
  livingInk,
  docked = false,
  dockInsets = { left: 56, right: 56 },
  className,
}: StudioDrawOptionsBarProps): ReactElement {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [canvasDockFrame, setCanvasDockFrame] = useState<Readonly<{ center: number; width: number }> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const brushMeta = BRUSH_PRESETS.find((preset) => preset.id === brushId);
  const catalogBrushId = activeCatalogBrushId ?? brushId;
  const catalogBrushItem =
    brushCatalogItems?.find((item) => item.id === catalogBrushId)
    ?? (brushMeta ? studioBrushTrayItem(brushMeta) : null);
  const catalogBrushName =
    activeCatalogBrushName ?? catalogBrushItem?.name ?? brushMeta?.name ?? catalogBrushId;
  const eraserPresetActive =
    drawMode === "eraser" && resolveStudioBrushPresetOperation(brushId) === "erase";
  const isFavorite = favoriteBrushIds.includes(catalogBrushId);
  const tipColor = drawMode === "eraser" ? "oklch(0.55 0.02 70)" : color;
  const pixelMode = drawMode === "pixel";
  const advancedAvailable = drawMode === "pen" || drawMode === "eraser";
  const strokeWidthLabel =
    drawMode === "eraser"
      ? "지우개 크기"
      : drawMode === "shape"
        ? "도형 선 굵기"
        : "브러시 크기";
  const opacityLabel =
    drawMode === "pixel"
      ? "픽셀 불투명도"
      : drawMode === "eraser"
        ? "지우기 강도"
        : drawMode === "shape"
          ? "도형 불투명도"
          : "브러시 불투명도";
  const legacyBrushPresetModified =
    Boolean(catalogBrushItem) &&
    ((!sizeLocked &&
      Math.abs(strokeWidth - (catalogBrushItem?.defaultWidth ?? strokeWidth)) > 0.01) ||
      (!opacityLocked &&
        Math.abs(brushOpacity - (catalogBrushItem?.defaultOpacity ?? brushOpacity)) > 0.001));
  const brushPresetModifiedCount =
    brushDefaultRestore?.modifiedCount ?? (legacyBrushPresetModified ? 1 : 0);
  const brushPresetModified = brushPresetModifiedCount > 0;
  const brushPresetResetSource = brushDefaultRestore?.sourceName ?? catalogBrushName;
  const brushPresetResetAvailable = brushDefaultRestore?.available ?? true;
  const brushPresetUndoAvailable = brushDefaultRestore?.undoAvailable ?? false;
  const brushPresetResetHintLabel = brushDefaultRestore?.loading
    ? "브러시 기본값 불러오는 중"
    : !brushPresetResetAvailable
      ? "브러시 기본값 기준 없음"
      : brushPresetUndoAvailable
        ? "브러시 기본값 복원 취소"
        : brushPresetModified
          ? "브러시 기본값으로 복원"
          : "브러시 기본값 다시 적용";
  const brushPresetResetDescription = brushDefaultRestore
    ? !brushPresetResetAvailable
      ? "이 브러시의 안전한 기본값 기준이 없습니다. 브러시 목록에서 다시 선택하면 기준을 새로 불러옵니다."
      : brushPresetUndoAvailable
        ? `방금 적용한 ${brushPresetResetSource} 기본값 복원을 한 단계 되돌립니다. 현재 색상과 브러시 선택은 유지됩니다.`
        : brushPresetModified
          ? `${brushPresetResetSource}의 브러시 설정 중 ${brushPresetModifiedCount}개가 기본값과 다릅니다. 현재 색상과 브러시 선택은 유지한 채 복원합니다.${
              sizeLocked ? ` 잠근 굵기 ${strokeWidth}px는 유지합니다.` : ""
            }${
              opacityLocked
                ? ` 잠근 불투명도 ${Math.round(brushOpacity * 100)}%는 유지합니다.`
                : ""
            }`
          : `${brushPresetResetSource}의 굵기·불투명도·필압·보정·촉 설정이 이미 기본값입니다. 현재 색상과 브러시 선택은 유지됩니다.`
    : catalogBrushItem
      ? `${catalogBrushName} 프리셋의 촉 반응을 다시 적용합니다. ${
          sizeLocked
            ? `굵기는 ${strokeWidth}px 잠금 상태를 유지합니다.`
            : `굵기는 권장값 ${catalogBrushItem.defaultWidth}px로 돌아갑니다.`
        } ${
          opacityLocked
            ? `불투명도는 ${Math.round(brushOpacity * 100)}% 잠금 상태를 유지합니다.`
            : `불투명도는 권장값 ${Math.round(catalogBrushItem.defaultOpacity * 100)}%로 돌아갑니다.`
        } 현재 색은 유지돼요.`
      : "";
  const safeDockLeft = Math.max(0, Math.round(dockInsets.left));
  const safeDockRight = Math.max(0, Math.round(dockInsets.right));

  function toggleBrushCatalog(trigger: HTMLButtonElement) {
    onToggleBrushCatalog?.(trigger);
  }

  useEffect(() => {
    if (!docked) return;
    const root = rootRef.current;
    if (!root || typeof document === "undefined") return;
    const dockRoot = root;
    const editor = dockRoot.closest<HTMLElement>('[data-studio-editor="true"]') ?? document.documentElement;
    function publishHeight() {
      const height = Math.ceil(dockRoot.getBoundingClientRect().height);
      if (height > 0) editor.style.setProperty("--studio-draw-options-height", `${height}px`);
    }
    publishHeight();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publishHeight);
    observer?.observe(dockRoot);
    return () => {
      observer?.disconnect();
      editor.style.removeProperty("--studio-draw-options-height");
    };
  }, [docked]);

  useEffect(() => {
    if (!docked) return;
    const root = rootRef.current;
    if (!root) return;
    const editor = root.closest<HTMLElement>('[data-studio-editor="true"]');
    const canvasViewport = editor?.querySelector<HTMLElement>('[data-studio-canvas-viewport]');
    if (!canvasViewport) return;
    const measuredCanvasViewport = canvasViewport;

    function measureCanvasFrame() {
      const rect = measuredCanvasViewport.getBoundingClientRect();
      const viewportWidth = Math.max(0, globalThis.innerWidth || document.documentElement.clientWidth);
      const screenWidth = Math.max(0, viewportWidth - 24);
      const minimumWidth = Math.min(320, screenWidth);
      const width = Math.min(Math.max(rect.width - 24, minimumWidth), screenWidth, 1536);
      const half = width / 2;
      const center = Math.min(Math.max(rect.left + rect.width / 2, 12 + half), viewportWidth - 12 - half);
      setCanvasDockFrame((current) =>
        current && Math.abs(current.center - center) < 0.5 && Math.abs(current.width - width) < 0.5
          ? current
          : { center, width }
      );
    }

    measureCanvasFrame();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measureCanvasFrame);
    observer?.observe(measuredCanvasViewport);
    globalThis.addEventListener("resize", measureCanvasFrame);
    return () => {
      observer?.disconnect();
      globalThis.removeEventListener("resize", measureCanvasFrame);
    };
  }, [docked]);

  return (
    <div
      ref={rootRef}
      data-studio-draw-options-dock={docked ? "true" : undefined}
      data-studio-draw-options-dock-left={docked ? safeDockLeft : undefined}
      data-studio-draw-options-dock-right={docked ? safeDockRight : undefined}
      className={cn(
        docked
          ? "pointer-events-none fixed bottom-3 left-1/2 z-[40] hidden w-[min(calc(100vw-7rem),96rem)] -translate-x-1/2 lg:block"
          : "relative z-[40] shrink-0",
        className
      )}
      style={
        docked
          ? {
              bottom: "max(0.75rem, env(safe-area-inset-bottom))",
              left: canvasDockFrame
                ? `${canvasDockFrame.center}px`
                : `clamp(10.75rem, calc(${safeDockLeft}px + (100vw - ${safeDockLeft + safeDockRight}px) / 2), calc(100vw - 10.75rem))`,
              width: canvasDockFrame
                ? `${canvasDockFrame.width}px`
                : `min(max(calc(100vw - ${safeDockLeft + safeDockRight + 24}px), 20rem), calc(100vw - 1.5rem), 96rem)`,
            }
          : undefined
      }
    >
      <div
        role="toolbar"
        aria-label={`그리기 옵션 · 현재 ${
          drawMode === "pen" || eraserPresetActive
            ? catalogBrushName
            : drawMode === "pixel"
              ? "픽셀 펜"
              : drawMode === "eraser"
                ? "지우개"
                : "도형"
        }`}
        data-studio-active-draw-mode={drawMode}
        data-studio-draw-options="true"
        data-studio-icon-first="true"
        className={cn(
          "pointer-events-auto flex min-h-[3.25rem] min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden border-b border-line px-2 py-1",
          "bg-panel/95 backdrop-blur-sm",
          docked && "rounded-lg border shadow-[0_18px_48px_oklch(0.06_0.01_70/0.62)]"
        )}
      >
        <div
          data-studio-draw-options-primary="true"
          data-studio-draw-options-scroll="visible"
          role="group"
          aria-label="핵심 그리기 도구: 모드, 브러시, 도형, 크기, 불투명도. 좌우로 스크롤할 수 있습니다."
          className={cn(
            "flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto overflow-y-hidden",
            "overscroll-x-contain [scrollbar-gutter:stable]"
          )}
        >
        {onSetDrawMode ? (
          <div
            className="studio-opt-cluster shrink-0"
            role="group"
            aria-label="그리기 모드"
            data-studio-core-draw-control="mode"
          >
            {(
              [
                { id: "pen" as const, label: "펜", Icon: Pencil },
                { id: "pixel" as const, label: "픽셀 펜", Icon: Grid3X3 },
                { id: "eraser" as const, label: "지우개", Icon: Eraser },
                { id: "shape" as const, label: "도형", Icon: Shapes },
              ] as const
            ).map(({ id, label, Icon }) => (
              <StudioToolHintTarget
                key={id}
                hint={studioToolHintFromLabel(
                  label,
                  id === "pen"
                    ? "현재 브러시와 필압·보정 설정으로 자유선을 그립니다. 하단 크기와 불투명도를 바꾸면 즉시 반영돼요."
                    : id === "pixel"
                      ? "격자에 맞춘 1px 하드 픽셀을 그대로 찍습니다. 필압·손떨림 보정·안티앨리어싱을 사용하지 않아 도트 작업에 적합해요."
                    : id === "eraser"
                      ? "현재 레이어의 획을 지웁니다. 펜과 같은 크기·불투명도 조절을 사용해 가장자리를 자연스럽게 다듬어요."
                      : "선·사각형·타원·화살표를 정확한 벡터 도형으로 그립니다. 채우기는 도형 선택 옆에서 켤 수 있어요.",
                  id === "pen" ? "B" : id === "pixel" ? "P" : id === "eraser" ? "E" : undefined,
                  id === "pen"
                    ? "ink"
                    : id === "pixel"
                      ? "pixel-ink"
                      : id === "eraser"
                        ? "erase"
                        : "shape"
                )}
              >
                <button
                  type="button"
                  aria-pressed={drawMode === id}
                  aria-label={label}
                  onClick={() => onSetDrawMode(id)}
                  data-studio-active-mode={drawMode === id ? id : undefined}
                  className={cn(
                    iconBtn,
                    "border-transparent",
                    drawMode === id && "flex h-8 w-auto min-w-8 gap-1.5 px-2",
                    drawMode === id
                      ? "bg-accent text-on-accent shadow-[0_1px_4px_oklch(0.72_0.185_42/0.25)]"
                      : "text-fg-2 hover:bg-raised hover:text-fg"
                  )}
                >
                  <Icon size={15} strokeWidth={1.75} aria-hidden />
                  {drawMode === id ? (
                    <span
                      aria-hidden
                      data-studio-active-mode-label="true"
                      className="whitespace-nowrap text-[0.66rem] font-extrabold"
                    >
                      {label}
                    </span>
                  ) : null}
                </button>
              </StudioToolHintTarget>
            ))}
          </div>
        ) : null}

        {pixelMode ? (
          <div
            data-studio-pixel-pencil-identity="true"
            role="status"
            aria-label="픽셀 펜, 1픽셀 고정, 무보정, 필압 없음, 안티앨리어싱 없음"
            data-studio-active-tool-summary="pixel"
            className="flex h-9 shrink-0 items-center gap-2 rounded-xl border border-accent/45 bg-accent-soft/35 px-2.5 text-accent shadow-[inset_0_1px_0_oklch(0.98_0.01_85/0.08)]"
          >
            <span className="grid size-6 place-items-center rounded-md bg-accent/12" aria-hidden>
              <Grid3X3 size={14} strokeWidth={2} />
            </span>
            <span className="leading-none">
              <strong className="block text-[0.68rem] font-extrabold tracking-tight">픽셀 펜</strong>
              <span className="mt-1 block text-[0.54rem] font-semibold tracking-wide text-fg-3">
                1 PX · HARD · RAW
              </span>
            </span>
          </div>
        ) : null}

        {/* Active brush pill + library (PicsArt-class) */}
        {drawMode === "pen" || eraserPresetActive ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <StudioToolHintTarget
              className="min-w-0"
              hint={studioToolHintFromLabel(
                `현재 브러시 · ${catalogBrushName}`,
                "기본 프리셋을 열어 촉감·용도별 브러시를 검색하고 바로 교체합니다. 현재 색과 불투명도는 그대로 유지돼요.",
                undefined,
                "brush-library"
              )}
            >
              <button
                type="button"
                onClick={(event) => toggleBrushCatalog(event.currentTarget)}
                aria-expanded={brushCatalogOpen}
                aria-haspopup="dialog"
                aria-label={`현재 도구 ${catalogBrushName}, ${strokeWidth}px, ${
                  eraserPresetActive ? "지우기 강도" : "불투명도"
                } ${Math.round(brushOpacity * 100)}%, ${
                  eraserPresetActive ? "지우개" : "브러시"
                } 선택 열기`}
                data-studio-brush-active-pill="true"
                data-studio-active-tool-summary={eraserPresetActive ? "eraser" : "pen"}
                data-studio-core-draw-control="brush"
                className={cn(
                  "flex h-10 max-w-[12rem] items-center gap-1.5 rounded-xl border px-2",
                  STUDIO_EASE,
                  STUDIO_FOCUS_RING,
                  brushCatalogOpen
                    ? "border-accent bg-accent text-on-accent shadow-[0_2px_8px_oklch(0.72_0.185_42/0.28)]"
                    : "border-line/80 bg-card text-fg hover:border-accent/40 hover:bg-raised"
                )}
              >
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-md",
                    brushCatalogOpen ? "bg-on-accent/15" : "bg-canvas/70"
                  )}
                  aria-hidden
                >
                  <StudioBrushPresetIcon brushId={brushId} size={13} strokeWidth={2} />
                </span>
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full ring-1 ring-black/15"
                  style={{ background: tipColor, opacity: brushOpacity }}
                />
                <span className="min-w-0 flex-1 text-left leading-none">
                  <span className="block truncate text-[0.67rem] font-extrabold text-current">
                    {catalogBrushName}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1 block truncate text-[0.54rem] font-semibold tabular-nums",
                      brushCatalogOpen ? "text-on-accent/75" : "text-fg-3"
                    )}
                  >
                    {strokeWidth}px · {Math.round(brushOpacity * 100)}%
                  </span>
                </span>
                <LayoutGrid size={12} className="shrink-0 opacity-80" aria-hidden />
              </button>
            </StudioToolHintTarget>
            {catalogBrushItem || brushDefaultRestore ? (
              <StudioToolHintTarget
                disabled={
                  brushDefaultRestore?.loading
                  || (brushDefaultRestore !== null && !brushPresetResetAvailable)
                }
                unavailableReason={
                  brushDefaultRestore?.loading
                    ? "브러시 기준값을 불러오는 중입니다. 잠시 뒤 다시 시도해 주세요."
                    : brushDefaultRestore !== null && !brushPresetResetAvailable
                      ? "브러시 목록에서 이 브러시를 다시 선택하면 안전한 기본값 기준을 새로 불러옵니다."
                      : undefined
                }
                hint={studioToolHintFromLabel(
                  brushPresetResetHintLabel,
                  brushPresetResetDescription,
                  undefined
                )}
              >
                <button
                  type="button"
                  disabled={
                    brushDefaultRestore?.loading
                    || (brushDefaultRestore !== null && !brushPresetResetAvailable)
                  }
                  onClick={() => {
                    if (onRestoreBrushDefaults) {
                      onRestoreBrushDefaults();
                    } else if (catalogBrushItem) {
                      onSelectBrush(catalogBrushItem);
                    }
                  }}
                  aria-label={
                    brushDefaultRestore?.loading
                      ? `${brushPresetResetSource} 기본값을 불러오는 중`
                      : !brushPresetResetAvailable
                        ? `${brushPresetResetSource} 기본값 없음, 브러시를 다시 선택하세요`
                        : brushPresetUndoAvailable
                          ? `${brushPresetResetSource} 기본값 복원 취소`
                          : brushPresetModified
                            ? `${brushPresetResetSource} 기본값으로 복원, 변경된 설정 ${brushPresetModifiedCount}개`
                            : `${brushPresetResetSource} 기본값 다시 적용`
                  }
                  data-studio-brush-preset-reset="true"
                  data-studio-brush-preset-modified={brushPresetModified ? "true" : "false"}
                  data-studio-brush-preset-modified-count={brushPresetModifiedCount}
                  data-studio-draw-primary-control="preset-reset"
                  className={cn(
                    "flex h-8 shrink-0 items-center gap-1 rounded-lg border px-2 text-[0.6rem] font-bold disabled:opacity-55",
                    brushDefaultRestore?.loading
                      ? "disabled:cursor-wait"
                      : "disabled:cursor-not-allowed",
                    STUDIO_EASE,
                    STUDIO_FOCUS_RING,
                    brushPresetModified
                      ? "border-accent/55 bg-accent-soft text-accent hover:border-accent"
                    : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg"
                  )}
                >
                  <RotateCcw
                    size={12}
                    className={cn(
                      "shrink-0",
                      brushDefaultRestore?.loading &&
                        "animate-spin motion-reduce:animate-none",
                    )}
                    aria-hidden
                  />
                  <span>
                    {brushDefaultRestore?.loading
                      ? "복원 중"
                      : !brushPresetResetAvailable
                        ? "기준 없음"
                        : brushPresetUndoAvailable
                          ? "되돌리기"
                          : "기본값"}
                  </span>
                  {brushPresetModified ? (
                    <span
                      aria-hidden
                      className="grid min-w-4 place-items-center rounded-full bg-accent/16 px-1 tabular-nums text-[0.55rem] text-accent"
                    >
                      {brushPresetModifiedCount}
                    </span>
                  ) : null}
                </button>
              </StudioToolHintTarget>
            ) : null}
            {onToggleFavoriteBrush ? (
              <StudioToolHintTarget
                hint={studioToolHintFromLabel(
                  isFavorite ? "브러시 즐겨찾기 해제" : "브러시 즐겨찾기",
                  isFavorite
                    ? "현재 브러시를 즐겨찾기 선반에서 제거합니다. 브러시 자체 설정과 최근 사용 기록은 유지돼요."
                    : "현재 브러시를 즐겨찾기 선반에 고정해 다음 작업에서도 빠르게 다시 꺼냅니다.",
                  undefined,
                  "brush-favorite",
                  isFavorite ? "remove" : "add"
                )}
              >
                <button
                  type="button"
                  data-studio-draw-secondary-action="favorite"
                  aria-pressed={isFavorite}
                  aria-label={isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
                  onClick={() => onToggleFavoriteBrush(catalogBrushId)}
                  className={cn(
                    iconBtn,
                    "size-8",
                    isFavorite
                      ? "border-accent/50 bg-accent-soft text-accent"
                      : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg"
                  )}
                >
                  <Star size={13} fill={isFavorite ? "currentColor" : "none"} aria-hidden />
                </button>
              </StudioToolHintTarget>
            ) : null}
          </div>
        ) : null}

        {/*
          Quick starter shelf stays on the primary strip so wash/air (and favorites)
          are one tap away — not buried under “세부 옵션”.
        */}
        {drawMode === "pen" ? (
          <StudioBrushTray
            activeBrushId={catalogBrushId}
            brushCatalogItems={brushCatalogItems}
            recentBrushIds={recentBrushIds}
            favoriteBrushIds={favoriteBrushIds}
            onSelect={onSelectBrush}
            onOpenLibrary={toggleBrushCatalog}
            libraryOpen={brushCatalogOpen}
            // Prefer tray width so starter wash/air chips stay clickable without outer scroll.
            className="min-w-[12.5rem] max-w-[min(26rem,48vw)] shrink-0"
            aria-label="기본 프리셋 빠른 선택 — 즐겨찾기, 최근 사용, 추천"
          />
        ) : null}

        {drawMode === "pen" && livingInk ? (
          <StudioLivingInkControls {...livingInk} />
        ) : null}

        {drawMode === "shape" && onShapeKindChange ? (
          <div
            className="flex min-w-0 max-w-[min(28rem,52vw)] shrink items-center gap-1"
            data-studio-core-draw-control="shape"
          >
            <StudioShapePickerStrip
              activeKind={shapeKind}
              onSelect={onShapeKindChange}
              filled={shapeFill}
              showLabels={false}
              className="min-w-0"
            />
            {onShapeFillChange ? (
              <StudioToolHintTarget
                disabled={shapeKind === "line" || shapeKind === "arrow"}
                unavailableReason={
                  shapeKind === "line" || shapeKind === "arrow"
                    ? "선과 화살표는 내부 영역이 없어요. 사각형·타원·다각형을 선택하면 채우기를 사용할 수 있어요."
                    : undefined
                }
                hint={studioToolHintFromLabel(
                  shapeFill ? "도형 채우기 끄기" : "도형 채우기",
                  shapeKind === "line" || shapeKind === "arrow"
                    ? "선과 화살표는 내부 영역이 없어 채울 수 없습니다. 사각형·타원·다각형을 선택하면 활성화돼요."
                    : shapeFill
                      ? "도형 내부를 비워 윤곽선만 그립니다."
                      : "새 도형의 내부를 현재 주 색으로 채웁니다. 윤곽선과 채움은 함께 유지돼요.",
                  undefined,
                  "shape-fill",
                  shapeFill ? "disable" : "enable"
                )}
              >
                <button
                  type="button"
                  aria-pressed={shapeFill}
                  disabled={shapeKind === "line" || shapeKind === "arrow"}
                  aria-label="도형 채우기"
                  onClick={() => onShapeFillChange(!shapeFill)}
                  className={cn(
                    iconBtn,
                    shapeFill && shapeKind !== "line" && shapeKind !== "arrow"
                      ? "border-accent/55 bg-accent-soft text-accent"
                      : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg",
                    (shapeKind === "line" || shapeKind === "arrow") && "cursor-not-allowed opacity-45"
                  )}
                >
                  <PaintBucket size={14} strokeWidth={1.75} aria-hidden />
                </button>
              </StudioToolHintTarget>
            ) : null}
          </div>
        ) : null}

        <span aria-hidden className="hidden h-5 w-px shrink-0 bg-line sm:block" />

        {!pixelMode ? (
          <>
            <span data-studio-draw-size-preview="true" className="contents">
              <SizePreview size={strokeWidth} color={tipColor} opacity={brushOpacity} />
            </span>

            <StudioToolHintTarget
              className="shrink-0"
              hint={studioToolHintFromLabel(
                strokeWidthLabel,
                `현재 ${strokeWidth}px입니다. 슬라이더나 [ · ] 단축키로 ${
                  drawMode === "shape" ? "새 도형의 윤곽선 굵기" : "획 굵기"
                }를 조절하며 왼쪽 원에서 실제 상대 크기를 확인할 수 있어요.`,
                "[  ]",
                "brush-size"
              )}
            >
              <label
                data-studio-draw-primary-control="size"
                data-studio-core-draw-control="size"
                className="flex shrink-0 items-center gap-1 text-fg-3"
              >
                <Circle size={12} strokeWidth={1.75} className="shrink-0 opacity-80" aria-hidden />
                <span className="sr-only">크기</span>
                <input
                  type="range"
                  min={STUDIO_BRUSH_SIZE_RANGE.min}
                  max={STUDIO_BRUSH_SIZE_RANGE.max}
                  value={strokeWidth}
                  onChange={(e) => onStrokeWidthChange(Number(e.target.value))}
                  className="studio-range w-16 sm:w-20"
                  aria-label={strokeWidthLabel}
                  aria-valuetext={`${strokeWidth}픽셀`}
                />
                <span className="w-9 tabular-nums text-[0.68rem] font-bold text-fg">
                  {strokeWidth}px
                </span>
              </label>
            </StudioToolHintTarget>
          </>
        ) : null}


        <StudioToolHintTarget
          className="shrink-0"
          hint={studioToolHintFromLabel(
            opacityLabel,
            pixelMode
              ? `현재 ${Math.round(brushOpacity * 100)}%입니다. 픽셀 모양은 1px로 유지되고 색 농도만 바뀝니다.`
              : `현재 ${Math.round(brushOpacity * 100)}%입니다. 낮추면 획 아래의 색이 비쳐 여러 번 덧칠할수록 농도가 자연스럽게 쌓여요.`,
            undefined,
            "opacity"
          )}
        >
          <label
            data-studio-draw-primary-control="opacity"
            data-studio-core-draw-control="opacity"
            className="flex shrink-0 items-center gap-1 text-fg-3"
          >
            <StudioOpacityGlyph opacity01={brushOpacity} />
            <span className="sr-only">불투명</span>
            <input
              type="range"
              min={5}
              max={100}
              step={1}
              value={Math.round(brushOpacity * 100)}
              onChange={(e) => onOpacityChange(Number(e.target.value) / 100)}
              className="studio-range w-14 sm:w-16"
            aria-label={opacityLabel}
            />
            <span className="w-9 tabular-nums text-[0.68rem] font-bold text-fg">
              {Math.round(brushOpacity * 100)}%
            </span>
          </label>
        </StudioToolHintTarget>

        </div>

        <div
          data-studio-draw-options-end="true"
          className={cn(
            "ml-auto flex shrink-0 items-center gap-1 border-l border-line/70 bg-panel/95 pl-1.5 backdrop-blur-sm",
            "shadow-[-10px_0_12px_-8px_oklch(0.12_0.02_70/0.55)]"
          )}
        >
          {drawMode !== "eraser" ? (
            <>
              <StudioDualColorWell
                primary={color}
                secondary={secondaryColor}
                recent={recentSwatches}
                onPrimaryChange={onColorChange}
                onSecondaryChange={onSecondaryColorChange}
                onSwap={onSwapColors}
                isTransparent={false}
                onTransparentToggle={
                  onSetDrawMode
                    ? () => onSetDrawMode("eraser")
                    : undefined
                }
              />
              {onToggleEyedropper ? (
                <StudioToolHintTarget
                  preferredSide="top"
                  hint={studioToolHintFromLabel(
                    "스포이드",
                    eyedropperActive
                      ? "캔버스를 탭해 색을 가져옵니다. 다시 누르면 종료하고, 그리는 중 Alt를 누르면 일시적으로만 사용할 수 있어요."
                      : "표시 결과나 레이어에서 색을 가져옵니다. I로 전환하고, 그리는 중에는 Alt를 누른 동안만 빠르게 사용할 수 있어요.",
                    "I",
                    "sample"
                  )}
                >
                  <button
                    type="button"
                    aria-label={eyedropperActive ? "스포이드 사용 중" : "스포이드"}
                    aria-keyshortcuts="I"
                    aria-pressed={Boolean(eyedropperActive)}
                    data-studio-eyedropper-trigger="true"
                    onClick={onToggleEyedropper}
                    className={cn(
                      iconBtn,
                      "size-8 pointer-coarse:size-11",
                      eyedropperActive
                        ? "border-accent/70 bg-accent-soft text-accent shadow-[0_0_0_1px_oklch(0.72_0.16_295/0.18)]"
                        : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg"
                    )}
                  >
                    <Pipette size={14} aria-hidden />
                  </button>
                </StudioToolHintTarget>
              ) : null}
            </>
          ) : onToggleEraseToIntersection ? (
            <StudioToolHintTarget
              preferredSide="top"
              hint={studioToolHintFromLabel(
                STUDIO_ERASE_TO_INTERSECTION_LABEL,
                eraseToIntersection
                  ? `${STUDIO_ERASE_TO_INTERSECTION_TIP} 다시 누르면 일반 지우개로 돌아갑니다.`
                  : STUDIO_ERASE_TO_INTERSECTION_TIP,
                undefined,
                "erase"
              )}
            >
              <button
                type="button"
                aria-label={STUDIO_ERASE_TO_INTERSECTION_LABEL}
                aria-pressed={eraseToIntersection}
                data-studio-erase-to-intersection="true"
                onClick={onToggleEraseToIntersection}
                className={cn(
                  iconBtn,
                  "size-8 pointer-coarse:size-11",
                  eraseToIntersection
                    ? "border-accent/70 bg-accent-soft text-accent shadow-[0_0_0_1px_oklch(0.72_0.16_295/0.18)]"
                    : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg"
                )}
              >
                <Scissors size={14} aria-hidden />
              </button>
            </StudioToolHintTarget>
          ) : null}

          {/* Explicit overflow: unlike a hidden horizontal scroll, this control is always pinned. */}
          {advancedAvailable ? <StudioToolHintTarget
            hint={studioToolHintFromLabel(
              advancedOpen ? "세부 그리기 옵션 접기" : "세부 그리기 옵션",
              advancedOpen
                ? "브러시 프리셋·보정·필압·대칭·빠른 슬롯 행을 접어 캔버스 공간을 되찾습니다."
                : "브러시 프리셋·손떨림 보정·필압 곡선·대칭·빠른 슬롯을 한 줄에서 정밀 조정합니다.",
              undefined,
              "draw-settings",
              advancedOpen ? "collapse" : "expand"
            )}
          >
            <button
              type="button"
              aria-expanded={advancedOpen}
              aria-controls="studio-draw-advanced"
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-label={advancedOpen ? "빠른 세부 옵션 접기" : "빠른 세부 옵션 펼치기"}
              data-studio-draw-advanced-toggle="true"
              className={cn(
                "flex h-8 min-w-8 items-center justify-center gap-1 rounded-lg border px-1.5",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
                advancedOpen
                  ? "border-accent/50 bg-accent-soft text-accent"
                  : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg"
              )}
            >
              {advancedOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
              <span
                aria-hidden
                data-studio-tool-property-label="true"
                className="hidden whitespace-nowrap text-[0.6rem] font-extrabold xl:inline"
              >
                세부 옵션
              </span>
            </button>
          </StudioToolHintTarget> : null}

          {onToggleCanvasFlipH ? (
            <StudioToolHintTarget
              hint={studioToolHintFromLabel(
                "캔버스 좌우 반전",
                canvasFlipH
                  ? "작업 캔버스를 원래 방향으로 되돌립니다. 데이터는 바뀌지 않아 비율과 실루엣을 점검할 때 안전해요."
                  : "캔버스를 거울처럼 좌우로 보여 비율·기울기 오류를 새 눈으로 확인합니다. 작품 데이터 자체는 뒤집히지 않아요.",
                undefined,
                "flip-view",
                canvasFlipH ? "restore" : "flip"
              )}
            >
              <button
                type="button"
                aria-pressed={canvasFlipH}
                onClick={onToggleCanvasFlipH}
                aria-label="캔버스 좌우 반전"
                className={cn(
                  iconBtn,
                  "size-7",
                  canvasFlipH
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg"
                )}
              >
                <FlipHorizontal2 size={13} strokeWidth={1.75} aria-hidden />
              </button>
            </StudioToolHintTarget>
          ) : null}

          {drawMode === "pen" && onOpenBrushStudio ? (
            <StudioToolHintTarget
              hint={studioToolHintFromLabel(
                "브러시 스튜디오",
                "현재 브러시의 필압 곡선·도장 간격·촉 회전·질감을 세밀하게 편집하고 재사용 프리셋으로 저장합니다.",
                undefined,
                "brush-studio"
              )}
            >
              <button
                type="button"
                onClick={onOpenBrushStudio}
                aria-label="브러시 고급 설정"
                className={cn(iconBtn, "size-7 border-line bg-card text-fg-2 hover:bg-raised")}
              >
                <Wand2 size={13} strokeWidth={1.75} aria-hidden />
              </button>
            </StudioToolHintTarget>
          ) : null}


          {drawMode === "pen" ? (
            <StudioToolHintTarget
              hint={studioToolHintFromLabel(
                quickShapeActive ? "스마트 도형 끄기" : "스마트 도형",
                quickShapeActive
                  ? "자유선 자동 정리를 끕니다. 이후 획은 브러시의 손맛 그대로 남아요."
                  : "선을 긋고 끝에서 잠시 멈추면 낙서를 직선·원·사각형처럼 매끈한 도형으로 자동 정리합니다.",
                undefined,
                "smart-shape",
                quickShapeActive ? "disable" : "enable"
              )}
            >
              <button
                type="button"
                aria-pressed={quickShapeActive}
                onClick={onToggleQuickShape}
                aria-label="스마트 도형"
                className={cn(
                  iconBtn,
                  "size-7",
                  quickShapeActive
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line bg-card text-fg-2 hover:bg-raised"
                )}
              >
                {quickShapeActive ? (
                  <Sparkles size={13} strokeWidth={1.75} aria-hidden />
                ) : (
                  <Shapes size={13} strokeWidth={1.75} aria-hidden />
                )}
              </button>
            </StudioToolHintTarget>
          ) : null}

          {shapeSlot}
        </div>
      </div>

      {/* Advanced row — stabilizer, pressure, slots (collapsed by default) */}
      {advancedOpen && advancedAvailable ? (
        <div
          id="studio-draw-advanced"
          data-studio-draw-advanced="true"
          className={cn(
            "pointer-events-auto flex flex-nowrap items-center gap-1.5 overflow-x-auto border-b border-line bg-canvas/95 px-2 py-1.5 [scrollbar-width:thin]",
            docked && "mt-1 rounded-lg border shadow-[0_14px_36px_oklch(0.06_0.01_70/0.52)]"
          )}
        >
          <div className="studio-opt-cluster shrink-0" role="group" aria-label="브러시 크기 프리셋">
            {STUDIO_BRUSH_SIZE_CHIPS.map((chip) => {
              const active = nearestStudioBrushSizeChip(strokeWidth) === chip.id;
              return (
                <StudioToolHintTarget
                  key={chip.id}
                  hint={studioToolHintFromLabel(
                    `브러시 크기 · ${chip.label}`,
                    `획 굵기를 정확히 ${chip.width}px로 설정합니다. 이후 새로 그리는 획부터 이 크기가 적용돼요.`,
                    undefined,
                    "brush-size",
                    BRUSH_SIZE_HINT_VARIANT[chip.id]
                  )}
                >
                  <button
                    type="button"
                    aria-label={`브러시 크기 ${chip.label} ${chip.width}픽셀`}
                    aria-pressed={active}
                    onClick={() => onStrokeWidthChange(chip.width)}
                    className={cn(
                      "grid size-7 place-items-center rounded-lg",
                      STUDIO_EASE,
                      STUDIO_FOCUS_RING,
                      active ? "bg-accent text-on-accent" : "text-fg-3 hover:bg-raised hover:text-fg"
                    )}
                  >
                    <StudioSizeChipGlyph widthPx={Math.min(chip.width, 40)} />
                  </button>
                </StudioToolHintTarget>
              );
            })}
            {onToggleSizeLock ? (
              <StudioToolHintTarget
                hint={studioToolHintFromLabel(
                  sizeLocked ? "브러시 크기 잠금 해제" : "브러시 크기 잠금",
                  sizeLocked
                    ? `잠금을 풀어 다음에 브러시 프리셋을 선택할 때 해당 프리셋의 기본 크기를 적용합니다. 현재 ${strokeWidth}px 값은 즉시 바뀌지 않아요.`
                    : `현재 ${strokeWidth}px을 고정해 다른 브러시 프리셋을 선택해도 그 프리셋의 기본 크기로 바뀌지 않게 합니다.`,
                  // ⇧S는 보기 리졸버가 `현재 보기 저장`으로 선점하므로 크기 잠금 화음은 ⇧⌥S다.
                  "⇧⌥S",
                  "brush-size",
                  sizeLocked ? "unlock" : "lock"
                )}
              >
                <button
                  type="button"
                  aria-pressed={sizeLocked}
                  aria-label={sizeLocked ? "브러시 크기 잠금 해제" : "브러시 크기 잠금"}
                  onClick={onToggleSizeLock}
                  className={cn(
                    iconBtn,
                    "size-7 border-transparent",
                    sizeLocked ? "bg-accent-soft text-accent" : "text-fg-3 hover:bg-raised"
                  )}
                >
                  {sizeLocked ? <Lock size={12} aria-hidden /> : <LockOpen size={12} aria-hidden />}
                </button>
              </StudioToolHintTarget>
            ) : null}
          </div>

          {drawMode === "pen" && stampTuning && onStampTuningChange ? (
            <div
              className="studio-opt-cluster shrink-0 items-center gap-2 px-1.5"
              role="group"
              aria-label="스탬프 브러시 세부 조절"
              data-studio-stamp-tuning="true"
            >
              {(
                [
                  { key: "flow", label: "흐름" },
                  { key: "hardness", label: "경도" },
                  { key: "minSize", label: "최소" },
                ] as const
              ).map((item) => (
                <label
                  key={item.key}
                  className="flex items-center gap-1 text-[0.62rem] font-semibold text-fg-3"
                >
                  <span className="shrink-0">{item.label}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(stampTuning[item.key] * 100)}
                    aria-label={`브러시 ${item.label} 조절`}
                    onChange={(event) =>
                      onStampTuningChange({
                        ...stampTuning,
                        [item.key]: Number(event.target.value) / 100,
                      })}
                    className="h-1 w-14 cursor-pointer accent-accent"
                  />
                  <span className="w-6 text-right tabular-nums text-fg-2">
                    {Math.round(stampTuning[item.key] * 100)}
                  </span>
                </label>
              ))}
            </div>
          ) : null}

          <div className="studio-opt-cluster shrink-0" role="group" aria-label="브러시 불투명도 프리셋">
            {STUDIO_BRUSH_OPACITY_CHIPS.map((chip) => {
              const active = nearestStudioBrushOpacityChip(brushOpacity) === chip.id;
              return (
                <StudioToolHintTarget
                  key={chip.id}
                  hint={studioToolHintFromLabel(
                    `브러시 불투명도 · ${chip.label}`,
                    `현재 브러시의 획 불투명도를 정확히 ${chip.label}로 설정합니다. 이후 새로 그리는 획부터 이 농도가 적용돼요.`,
                    undefined,
                    "opacity",
                    BRUSH_OPACITY_HINT_VARIANT[chip.id]
                  )}
                >
                  <button
                    type="button"
                    aria-label={`브러시 불투명도 ${chip.label}`}
                    aria-pressed={active}
                    onClick={() => onOpacityChange(chip.opacity)}
                    className={cn(
                      "min-w-7 rounded-lg px-1 py-1 text-[0.62rem] font-bold tabular-nums",
                      STUDIO_EASE,
                      STUDIO_FOCUS_RING,
                      active ? "bg-accent text-on-accent" : "text-fg-3 hover:bg-raised hover:text-fg"
                    )}
                  >
                    {Math.round(chip.opacity * 100)}
                  </button>
                </StudioToolHintTarget>
              );
            })}
            {onToggleOpacityLock ? (
              <StudioToolHintTarget
                hint={studioToolHintFromLabel(
                  opacityLocked ? "브러시 불투명도 잠금 해제" : "브러시 불투명도 잠금",
                  opacityLocked
                    ? `잠금을 풀어 다음에 브러시 프리셋을 선택할 때 해당 프리셋의 기본 불투명도를 적용합니다. 현재 ${Math.round(brushOpacity * 100)}% 값은 즉시 바뀌지 않아요.`
                    : `현재 ${Math.round(brushOpacity * 100)}%를 고정해 다른 브러시 프리셋을 선택해도 그 프리셋의 기본 불투명도로 바뀌지 않게 합니다.`,
                  undefined,
                  "opacity",
                  opacityLocked ? "unlock" : "lock"
                )}
              >
                <button
                  type="button"
                  aria-pressed={opacityLocked}
                  aria-label={
                    opacityLocked ? "브러시 불투명도 잠금 해제" : "브러시 불투명도 잠금"
                  }
                  onClick={onToggleOpacityLock}
                  className={cn(
                    iconBtn,
                    "size-7 border-transparent",
                    opacityLocked ? "bg-accent-soft text-accent" : "text-fg-3 hover:bg-raised"
                  )}
                >
                  <Droplets size={12} strokeWidth={1.75} aria-hidden />
                </button>
              </StudioToolHintTarget>
            ) : null}
          </div>

          {onSymmetryTypeChange ? (
            <div className="studio-opt-cluster shrink-0" role="group" aria-label="대칭 그리기">
              {(
                [
                  { id: "none" as const, label: "없음" },
                  { id: "vertical" as const, label: "세로" },
                  { id: "horizontal" as const, label: "가로" },
                  { id: "radial" as const, label: "방사" },
                  { id: "kaleidoscope" as const, label: "만화경" },
                  { id: "silk" as const, label: "실크" },
                ] as const
              ).map((item) => (
                <StudioToolHintTarget
                  key={item.id}
                  hint={studioToolHintFromLabel(
                    `대칭 · ${item.label}`,
                    item.id === "none"
                      ? "대칭 복제를 끄고 한 번의 펜 입력을 그대로 그립니다."
                      : item.id === "vertical"
                        ? "세로 중심축을 기준으로 좌우에 같은 획을 동시에 그려 얼굴·의상 정면을 빠르게 맞춥니다."
                        : item.id === "horizontal"
                          ? "가로 중심축을 기준으로 위아래에 같은 획을 동시에 그립니다."
                          : item.id === "radial"
                            ? "중심을 둘러싼 여러 방향으로 획을 복제해 장식·효과선을 만듭니다."
                            : item.id === "silk"
                            ? "여러 팔로 퍼지는 생성형 대칭 문양(Silk 스타일)을 만듭니다."
                            : "회전과 반사를 함께 반복해 만화경처럼 연속된 무늬를 만듭니다.",
                    undefined,
                    "symmetry",
                    `symmetry-${item.id}`
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={symmetryType === item.id}
                    aria-label={`대칭 ${item.label}`}
                    onClick={() => onSymmetryTypeChange(item.id)}
                    className={cn(
                      iconBtn,
                      "size-7 border-transparent",
                      symmetryType === item.id
                        ? "bg-accent text-on-accent"
                        : "text-fg-3 hover:bg-raised hover:text-fg"
                    )}
                  >
                    <StudioSymmetryGlyph mode={item.id} />
                  </button>
                </StudioToolHintTarget>
              ))}
            </div>
          ) : null}

          {drawMode === "pen" && onRecallBrushSlot ? (
            <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="최근 브러시 슬롯 1–6">
              {Array.from({ length: 6 }, (_, index) => {
                const slot = brushSlots[index] ?? null;
                const slotW = slot ? Math.min(10, Math.max(3, slot.strokeWidth * 0.45)) : 0;
                return (
                  <StudioToolHintTarget
                    key={index}
                    disabled={!slot && !onAssignBrushSlot}
                    unavailableReason={
                      !slot && !onAssignBrushSlot
                        ? "브러시 슬롯 저장 기능이 연결되지 않았어요. 저장 가능한 작업공간에서 현재 브러시를 슬롯에 먼저 등록하세요."
                        : undefined
                    }
                    hint={studioToolHintFromLabel(
                      `브러시 슬롯 ${index + 1}`,
                      slot
                        ? `${slot.brushId} · ${slot.strokeWidth}px · ${Math.round(slot.brushOpacity * 100)}% 설정을 한 번에 불러옵니다. Shift+클릭하면 현재 브러시로 덮어써요.`
                        : onAssignBrushSlot
                          ? "비어 있는 빠른 슬롯입니다. 클릭하면 현재 브러시·크기·불투명도를 저장해 다음에 한 번에 불러올 수 있어요."
                          : "비어 있는 빠른 슬롯입니다. 슬롯 저장 기능이 연결되면 현재 브러시 설정을 보관할 수 있어요.",
                      `${index + 1}`,
                      "brush-slot"
                    )}
                  >
                    <button
                      type="button"
                      disabled={!slot && !onAssignBrushSlot}
                      aria-label={`브러시 슬롯 ${index + 1}`}
                      onClick={(e) => {
                        if (e.shiftKey && onAssignBrushSlot) onAssignBrushSlot(index);
                        else if (slot) onRecallBrushSlot(index);
                        else if (onAssignBrushSlot) onAssignBrushSlot(index);
                      }}
                      className={cn(
                        "grid size-7 place-items-center rounded-lg border",
                        STUDIO_EASE,
                        STUDIO_FOCUS_RING,
                        slot
                          ? "border-line/80 bg-card text-fg-2 hover:border-accent/45 hover:bg-raised"
                          : "border-dashed border-line/60 text-fg-3 hover:bg-raised/70"
                      )}
                    >
                      {slot ? (
                        <span
                          aria-hidden
                          className="rounded-full ring-1 ring-black/20"
                          style={{
                            width: slotW,
                            height: slotW,
                            background: color,
                            opacity: slot.brushOpacity,
                          }}
                        />
                      ) : (
                        <span className="text-[0.55rem] font-bold tabular-nums text-fg-3">{index + 1}</span>
                      )}
                    </button>
                  </StudioToolHintTarget>
                );
              })}
            </div>
          ) : null}

          <StudioToolHintTarget
            className="shrink-0"
            hint={studioToolHintFromLabel(
              "손떨림 보정",
              `현재 강도 ${stabilizer}/10입니다. 값이 높을수록 입력을 더 오래 평균내 매끈한 선을 만들지만 펜을 따라오는 느낌은 느려질 수 있어요.`,
              "S",
              "stabilizer",
              `stabilizer-${stabilizerMode}`
            )}
          >
            <label className="flex shrink-0 items-center gap-1 text-fg-3">
              <StudioStabilizerGlyph />
              <span className="sr-only">보정</span>
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={stabilizer}
                onChange={(e) => onStabilizerChange(Number(e.target.value))}
                className="studio-range w-14"
                aria-label="손떨림 보정"
              />
              {onCycleStabilizer ? (
                <button
                  type="button"
                  aria-label={`보정 강도 ${stabilizer}`}
                  onClick={onCycleStabilizer}
                  className={cn(
                    "w-5 rounded tabular-nums text-[0.68rem] font-bold text-fg hover:bg-raised",
                    STUDIO_FOCUS_RING
                  )}
                >
                  {stabilizer}
                </button>
              ) : (
                <span className="w-4 tabular-nums text-[0.68rem] font-bold text-fg">{stabilizer}</span>
              )}
            </label>
          </StudioToolHintTarget>

          {onStabilizerModeChange ? (
            <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="보정 방식">
              {(
                [
                  { id: "standard" as const, label: "표준" },
                  { id: "adaptive" as const, label: "적응" },
                  { id: "precision" as const, label: "정밀" },
                ] as const
              ).map((item) => (
                <StudioToolHintTarget
                  key={item.id}
                  hint={studioToolHintFromLabel(
                    `보정 방식 · ${item.label}`,
                    item.id === "standard"
                      ? "입력 지연을 최소화하며 잔떨림을 고르게 줄입니다. 짧고 빠른 선화에 잘 맞아요."
                      : item.id === "adaptive"
                        ? "그리는 속도에 맞춰 보정량을 바꿉니다. 빠른 제스처와 느린 곡선을 함께 쓸 때 균형이 좋아요."
                        : "입력을 더 길게 분석해 긴 곡선과 깨끗한 윤곽을 정밀하게 다듬습니다.",
                    undefined,
                    "stabilizer",
                    `stabilizer-${item.id}`
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={stabilizerMode === item.id}
                    aria-label={`보정 방식 ${item.label}`}
                    onClick={() => onStabilizerModeChange(item.id)}
                    className={cn(
                      iconBtn,
                      "size-7 border-transparent",
                      stabilizerMode === item.id
                        ? "bg-raised text-fg ring-1 ring-accent/40"
                        : "text-fg-3 hover:bg-raised/70"
                    )}
                  >
                    <StudioStabilizerModeGlyph mode={item.id} />
                  </button>
                </StudioToolHintTarget>
              ))}
            </div>
          ) : null}

          {onPostCorrectionChange ? (
            <StudioToolHintTarget
              className="shrink-0"
              hint={studioToolHintFromLabel(
                "획 후처리 보정",
                `현재 강도 ${postCorrection}/10입니다. 펜을 뗀 뒤 완성된 획의 작은 꺾임과 불필요한 점을 정리하며 원본 제스처는 유지합니다.`,
                undefined,
                "stabilizer",
                "post-correction"
              )}
            >
              <label className="flex shrink-0 items-center gap-1 text-fg-3">
                <StudioPostCorrectGlyph />
                <span className="sr-only">후처리</span>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={postCorrection}
                  onChange={(e) => onPostCorrectionChange(Number(e.target.value))}
                  className="w-12 accent-accent"
                  aria-label="후처리 보정"
                />
                <span className="w-4 tabular-nums text-[0.68rem] font-bold text-fg-2">{postCorrection}</span>
              </label>
            </StudioToolHintTarget>
          ) : null}

          {onPressureCurveChange ? (
            <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="필압 반응">
              {(
                [
                  { id: "soft" as const, label: "민감" },
                  { id: "linear" as const, label: "기본" },
                  { id: "firm" as const, label: "단단" },
                ] as const
              ).map((item) => (
                <StudioToolHintTarget
                  key={item.id}
                  hint={studioToolHintFromLabel(
                    `필압 · ${item.label}`,
                    item.id === "soft"
                      ? "가벼운 압력에도 굵기와 농도가 빠르게 올라갑니다. 힘을 적게 주는 펜이나 부드러운 명암에 좋아요."
                      : item.id === "linear"
                        ? "펜 압력과 굵기·농도를 균일하게 대응시켜 예측 가능한 기본 반응을 만듭니다."
                        : "더 강하게 눌러야 굵기와 농도가 올라갑니다. 힘 있는 선과 세밀한 초입 제어에 좋아요.",
                    undefined,
                    "pressure",
                    `pressure-${item.id}`
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={pressureCurveId === item.id}
                    aria-label={`필압 ${item.label}`}
                    onClick={() => onPressureCurveChange(item.id)}
                    className={cn(
                      iconBtn,
                      "size-7 border-transparent",
                      pressureCurveId === item.id
                        ? "bg-raised text-fg ring-1 ring-accent/40"
                        : "text-fg-3 hover:bg-raised/70"
                    )}
                  >
                    <StudioPressureCurveGlyph curve={item.id} />
                  </button>
                </StudioToolHintTarget>
              ))}
            </div>
          ) : null}

          <p className="hidden shrink-0 text-[0.6rem] text-fg-3 sm:block">
            Shift+클릭 슬롯 저장 · S 보정 순환 · [ ] 크기
          </p>
        </div>
      ) : null}

    </div>
  );
}
