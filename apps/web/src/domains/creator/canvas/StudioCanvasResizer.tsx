/**
 * StudioCanvasResizer — friendly page size / magic-resize control.
 * PicsArt/Canva-class aspect cards + height slider + reflow strategy.
 * Presentation only; parent commits canvasH / element reflow.
 */
import {
  ArrowDownUp,
  Info,
  Maximize2,
  Minus,
  Plus,
  Scaling,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactElement } from "react";

import {
  MAGIC_RESIZE_PRESETS,
  MAGIC_RESIZE_STRATEGIES,
  presetCanvasSize,
  type MagicResizePreset,
  type MagicResizeStrategy,
} from "../studio-magic-resize";
import { STUDIO_EASE, STUDIO_FOCUS_RING } from "../studio-panel-ui";

import {
  adjustStudioCanvasHeight,
  clampStudioCanvasHeight,
  nearestStudioCanvasHeightPresetId,
  STUDIO_CANVAS_H_RANGE,
  STUDIO_CANVAS_H_STEP,
  STUDIO_CANVAS_HEIGHT_PRESETS,
  studioCanvasAspectLabel,
  studioCanvasAspectPreviewRect,
  studioCanvasSizeSummary,
} from "./studio-canvas-size";

import { cn } from "@/shared/lib/utils";

export type StudioCanvasResizeMode = "height-only" | "reflow";

export interface StudioCanvasResizerProps {
  canvasW: number;
  canvasH: number;
  strategy: MagicResizeStrategy;
  onStrategyChange: (next: MagicResizeStrategy) => void;
  /** Change height only (no element reflow). */
  onSetHeight: (height: number) => void;
  /** Magic-resize reflow to preset aspect. */
  onMagicResizePreset: (preset: MagicResizePreset) => void;
  disabled?: boolean;
  className?: string;
}

function AspectSilhouette({
  width,
  height,
  active,
}: {
  width: number;
  height: number;
  active?: boolean;
}): ReactElement {
  const box = 36;
  const r = studioCanvasAspectPreviewRect(width, height, box);
  return (
    <svg
      aria-hidden
      width={box}
      height={box}
      viewBox={`0 0 ${box} ${box}`}
      className="block"
    >
      <rect
        x={0.5}
        y={0.5}
        width={box - 1}
        height={box - 1}
        rx={6}
        fill={active ? "oklch(0.98 0.01 85 / 0.12)" : "oklch(0.2 0.01 66 / 0.55)"}
        stroke={active ? "oklch(0.98 0.01 85 / 0.28)" : "oklch(0.35 0.012 64 / 0.45)"}
        strokeWidth={0.8}
      />
      <rect
        x={r.x}
        y={r.y}
        width={r.w}
        height={r.h}
        rx={2.5}
        fill={active ? "currentColor" : "oklch(0.62 0.08 42 / 0.75)"}
        opacity={active ? 0.92 : 0.9}
      />
    </svg>
  );
}

const MODE_META: {
  id: StudioCanvasResizeMode;
  label: string;
  hint: string;
  Icon: LucideIcon;
}[] = [
  {
    id: "height-only",
    label: "높이만",
    hint: "캔버스 높이만 바꿉니다. 요소 위치는 그대로예요.",
    Icon: ArrowDownUp,
  },
  {
    id: "reflow",
    label: "내용 맞춤",
    hint: "규격에 맞춰 요소를 다시 배치합니다 (매직 리사이즈).",
    Icon: Scaling,
  },
];

export function StudioCanvasResizer({
  canvasW,
  canvasH,
  strategy,
  onStrategyChange,
  onSetHeight,
  onMagicResizePreset,
  disabled = false,
  className,
}: StudioCanvasResizerProps): ReactElement {
  const [mode, setMode] = useState<StudioCanvasResizeMode>("reflow");
  const summary = studioCanvasSizeSummary(canvasW, canvasH);
  const aspect = studioCanvasAspectLabel(canvasW, canvasH);
  const nearId = nearestStudioCanvasHeightPresetId(canvasH);

  function applyHeight(next: number) {
    if (disabled) return;
    onSetHeight(clampStudioCanvasHeight(next));
  }

  function applyPresetHeight(height: number) {
    if (disabled) return;
    if (mode === "height-only") {
      onSetHeight(clampStudioCanvasHeight(height));
      return;
    }
    // Find magic preset with same height (within 2px) or synthesize via height-only reflow by matching aspect
    const match = MAGIC_RESIZE_PRESETS.find((p) => {
      const size = presetCanvasSize(p, canvasW);
      return Math.abs(size.height - height) <= 2;
    });
    if (match) {
      onMagicResizePreset(match);
      return;
    }
    // Custom height: set height only (magic resize needs a full preset). Still helpful.
    onSetHeight(clampStudioCanvasHeight(height));
  }

  return (
    <div
      className={cn("grid gap-2.5", className)}
      data-studio-canvas-resizer="true"
      aria-disabled={disabled || undefined}
    >
      {/* Current size hero */}
      <div className="flex items-center gap-2.5 rounded-xl border border-line bg-card px-2.5 py-2">
        <div className="text-accent">
          <AspectSilhouette width={canvasW} height={canvasH} active />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[0.7rem] font-bold text-fg">지금 캔버스</p>
          <p className="truncate text-[0.72rem] tabular-nums font-semibold text-fg-2">{summary}</p>
          <p className="text-[0.58rem] text-fg-3">폭은 웹툰 기준 {canvasW}px 고정 · 높이로 비율을 바꿔요</p>
        </div>
        <Maximize2 size={14} className="shrink-0 text-fg-3" aria-hidden />
      </div>

      {/* Mode: height-only vs reflow */}
      <div className="grid grid-cols-2 gap-1" role="group" aria-label="리사이즈 방식">
        {MODE_META.map(({ id, label, hint, Icon }) => {
          const active = mode === id;
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              title={hint}
              aria-pressed={active}
              onClick={() => setMode(id)}
              className={cn(
                "flex items-center gap-1.5 rounded-xl border px-2 py-2 text-left",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
                active
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line bg-card text-fg-2 hover:bg-raised",
                disabled && "opacity-50"
              )}
            >
              <Icon size={14} aria-hidden />
              <span className="min-w-0">
                <span className="block text-[0.68rem] font-bold">{label}</span>
                <span className={cn("block text-[0.55rem] leading-snug", active ? "text-accent/80" : "text-fg-3")}>
                  {hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {mode === "reflow" ? (
        <div className="flex flex-wrap gap-1" role="group" aria-label="내용 맞춤 전략">
          {MAGIC_RESIZE_STRATEGIES.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={disabled}
              title={s.hint}
              aria-pressed={strategy === s.id}
              onClick={() => onStrategyChange(s.id)}
              className={cn(
                "min-h-8 rounded-full border px-2.5 text-[0.64rem] font-semibold",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
                strategy === s.id
                  ? "border-accent bg-accent text-on-accent"
                  : "border-line bg-card text-fg-3 hover:bg-raised",
                disabled && "opacity-50"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      ) : null}

      <div>
        <p className="mb-1 text-[0.64rem] font-semibold text-fg-2">빠른 규격</p>
        <div className="grid grid-cols-3 gap-1.5">
          {STUDIO_CANVAS_HEIGHT_PRESETS.map((preset) => {
            const active = nearId === preset.id || Math.abs(preset.height - canvasH) <= 2;
            return (
              <button
                key={preset.id}
                type="button"
                disabled={disabled}
                title={`${preset.hint} · ${canvasW}×${preset.height}`}
                aria-pressed={active}
                onClick={() => {
                  if (mode === "reflow") {
                    // Prefer magic presets when aspect matches a catalog entry
                    const magic = MAGIC_RESIZE_PRESETS.find((p) => {
                      const size = presetCanvasSize(p, canvasW);
                      return Math.abs(size.height - preset.height) <= 2;
                    });
                    if (magic) onMagicResizePreset(magic);
                    else applyPresetHeight(preset.height);
                  } else {
                    applyHeight(preset.height);
                  }
                }}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl border px-1.5 py-2",
                  STUDIO_EASE,
                  STUDIO_FOCUS_RING,
                  active
                    ? "border-accent bg-accent text-on-accent shadow-[0_2px_8px_oklch(0.72_0.185_42/0.22)]"
                    : "border-line bg-card text-fg hover:border-accent/40 hover:bg-raised",
                  disabled && "opacity-50"
                )}
              >
                <AspectSilhouette width={canvasW} height={preset.height} active={active} />
                <span className="text-[0.62rem] font-bold leading-tight">{preset.label}</span>
                <span
                  className={cn(
                    "text-[0.52rem] tabular-nums",
                    active ? "text-on-accent/80" : "text-fg-3"
                  )}
                >
                  {preset.aspectLabel}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Fine height control */}
      <div className="rounded-xl border border-line bg-card/80 p-2">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="text-[0.64rem] font-semibold text-fg-2">높이 미세 조절</p>
          <span className="text-[0.62rem] tabular-nums text-fg-3">{aspect}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={disabled}
            title={`−${STUDIO_CANVAS_H_STEP}px`}
            aria-label={`캔버스 높이 ${STUDIO_CANVAS_H_STEP} 줄이기`}
            onClick={() => applyHeight(adjustStudioCanvasHeight(canvasH, -STUDIO_CANVAS_H_STEP))}
            className={cn(
              "grid size-9 place-items-center rounded-lg border border-line bg-canvas text-fg-2 hover:bg-raised",
              STUDIO_FOCUS_RING,
              disabled && "opacity-50"
            )}
          >
            <Minus size={14} aria-hidden />
          </button>
          <input
            type="range"
            min={STUDIO_CANVAS_H_RANGE.min}
            max={STUDIO_CANVAS_H_RANGE.max}
            step={STUDIO_CANVAS_H_STEP}
            value={clampStudioCanvasHeight(canvasH)}
            disabled={disabled}
            onChange={(e) => applyHeight(Number(e.target.value))}
            className="studio-range min-w-0 flex-1"
            aria-label="캔버스 높이"
            aria-valuetext={`${canvasH}픽셀`}
          />
          <button
            type="button"
            disabled={disabled}
            title={`+${STUDIO_CANVAS_H_STEP}px`}
            aria-label={`캔버스 높이 ${STUDIO_CANVAS_H_STEP} 늘리기`}
            onClick={() => applyHeight(adjustStudioCanvasHeight(canvasH, STUDIO_CANVAS_H_STEP))}
            className={cn(
              "grid size-9 place-items-center rounded-lg border border-line bg-canvas text-fg-2 hover:bg-raised",
              STUDIO_FOCUS_RING,
              disabled && "opacity-50"
            )}
          >
            <Plus size={14} aria-hidden />
          </button>
          <label className="sr-only" htmlFor="studio-canvas-h-input">
            캔버스 높이 숫자
          </label>
          <input
            id="studio-canvas-h-input"
            type="number"
            min={STUDIO_CANVAS_H_RANGE.min}
            max={STUDIO_CANVAS_H_RANGE.max}
            inputMode="numeric"
            disabled={disabled}
            value={clampStudioCanvasHeight(canvasH)}
            onChange={(e) => applyHeight(Number(e.target.value) || canvasH)}
            className="h-9 w-16 rounded-lg border border-line bg-canvas px-1.5 text-center text-xs font-bold tabular-nums text-fg outline-none focus:border-accent"
          />
        </div>
        <p className="mt-1.5 flex items-start gap-1 text-[0.58rem] leading-snug text-fg-3">
          <Info size={11} className="mt-0.5 shrink-0" aria-hidden />
          {mode === "reflow"
            ? "빠른 규격은 내용 맞춤(재배치/축소)으로 적용됩니다. 슬라이더는 높이만 바꿉니다."
            : "높이만 바뀌고 그림 위치는 그대로입니다. 잘리면 스크롤해 확인하세요."}
        </p>
      </div>
    </div>
  );
}
