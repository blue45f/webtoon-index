import {
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";

import {
  BRUSH_PRESSURE_CURVE_PRESETS,
  pressureCurvePresetId,
  pressureCurveValueForPreset,
  type BrushPressureCurvePresetId,
} from "./studio-brush";
import { StudioPressureCurveGlyph } from "./studio-creative-visuals";
import {
  studioPressureCurveExponentForPoint,
  studioPressureCurveHandlePoint,
  studioPressureCurveMap,
  studioPressureCurvePathD,
  studioPressureCurveSliderMeta,
} from "./studio-pressure-curve-graph";

import { cn } from "@/shared/lib/utils";

const CHART_W = 160;
const CHART_H = 88;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function pressurePercent(value: number): string {
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

export interface StudioPressureCurveEditorProps {
  readonly pressureCurve: number;
  readonly onPressureCurveChange: (value: number) => void;
  readonly density: "compact" | "touch";
}

export function StudioPressureCurveEditor({
  pressureCurve,
  onPressureCurveChange,
  density,
}: StudioPressureCurveEditorProps): ReactElement {
  const curveId = pressureCurvePresetId(pressureCurve);
  const pathD = studioPressureCurvePathD(pressureCurve, CHART_W, CHART_H, 28);
  const slider = studioPressureCurveSliderMeta(pressureCurve);
  const handle = studioPressureCurveHandlePoint(pressureCurve);
  const handleOutputMinimum = studioPressureCurveMap(handle.x, slider.max);
  const handleOutputMaximum = studioPressureCurveMap(handle.x, slider.min);
  const touch = density === "touch";
  const curvePointerIdRef = useRef<number | null>(null);

  const setCurveFromPointer = (event: ReactPointerEvent<SVGCircleElement>): void => {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (!(rect.height > 0)) return;
    const output = 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1);
    onPressureCurveChange(studioPressureCurveExponentForPoint(handle.x, output));
  };

  const onCurvePointerDown = (event: ReactPointerEvent<SVGCircleElement>): void => {
    if (event.button !== 0 && event.button !== -1) return;
    event.preventDefault();
    event.stopPropagation();
    curvePointerIdRef.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Embedded webviews can expose pointer capture methods that still throw.
    }
    setCurveFromPointer(event);
  };

  const onCurvePointerMove = (event: ReactPointerEvent<SVGCircleElement>): void => {
    if (curvePointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    setCurveFromPointer(event);
  };

  const finishCurvePointer = (event: ReactPointerEvent<SVGCircleElement>): void => {
    if (curvePointerIdRef.current !== event.pointerId) return;
    setCurveFromPointer(event);
    curvePointerIdRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Capture may already have been released by the browser.
    }
  };

  const cancelCurvePointer = (event: ReactPointerEvent<SVGCircleElement>): void => {
    if (curvePointerIdRef.current !== event.pointerId) return;
    curvePointerIdRef.current = null;
  };

  const onCurveKeyDown = (event: KeyboardEvent<SVGCircleElement>): void => {
    let nextExponent: number | null = null;
    // The direct handle represents output, not gamma: Up/Right increases visible output and
    // therefore lowers the exponent. Home/End retain standard slider min/max semantics.
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      nextExponent = slider.value + slider.step;
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      nextExponent = slider.value - slider.step;
    } else if (event.key === "Home") {
      nextExponent = slider.max;
    } else if (event.key === "End") {
      nextExponent = slider.min;
    }
    if (nextExponent === null) return;
    event.preventDefault();
    onPressureCurveChange(clamp(nextExponent, slider.min, slider.max));
  };

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[0.68rem] font-bold text-fg-2">필압 반응 곡선</p>
        <span className="tabular-nums text-[0.6rem] font-semibold text-fg-3">
          γ {slider.value.toFixed(2)}
        </span>
      </div>

      <svg
        aria-label="필압 곡선 직접 편집"
        width="100%"
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="mb-2 block h-auto max-h-28 w-full touch-none rounded-lg border border-line/50 bg-canvas/50"
        data-studio-pressure-curve-chart="true"
      >
        <path
          d={`M0 ${CHART_H} H${CHART_W} M0 0 V${CHART_H}`}
          fill="none"
          stroke="oklch(0.42 0.012 64 / 0.45)"
          strokeWidth={1}
        />
        <path
          d={`M0 ${CHART_H / 2} H${CHART_W} M${CHART_W / 2} 0 V${CHART_H}`}
          fill="none"
          stroke="oklch(0.42 0.012 64 / 0.25)"
          strokeWidth={0.75}
          strokeDasharray="3 3"
        />
        <path
          d={`M0 ${CHART_H} L${CHART_W} 0`}
          fill="none"
          stroke="oklch(0.57 0.012 76 / 0.35)"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
        <path
          d={pathD}
          fill="none"
          stroke="oklch(0.72 0.185 42)"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line
          x1={handle.x * CHART_W}
          y1={CHART_H}
          x2={handle.x * CHART_W}
          y2={(1 - handle.y) * CHART_H}
          stroke="oklch(0.72 0.185 42 / 0.32)"
          strokeWidth={0.8}
          strokeDasharray="2 2"
          pointerEvents="none"
        />
        <circle
          cx={handle.x * CHART_W}
          cy={(1 - handle.y) * CHART_H}
          r={touch ? 18 : 14}
          fill="transparent"
          stroke="transparent"
          role="slider"
          tabIndex={0}
          aria-label="필압 곡선 제어점"
          aria-orientation="vertical"
          aria-valuemin={Math.round(handleOutputMinimum * 100)}
          aria-valuemax={Math.round(handleOutputMaximum * 100)}
          aria-valuenow={Math.round(handle.y * 100)}
          aria-valuetext={`중간 필압 출력 ${pressurePercent(handle.y)} · 감마 ${slider.value.toFixed(2)}`}
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End"
          data-studio-pressure-curve-handle="true"
          className="cursor-ns-resize outline-none focus-visible:stroke-2 focus-visible:stroke-accent"
          onPointerDown={onCurvePointerDown}
          onPointerMove={onCurvePointerMove}
          onPointerUp={finishCurvePointer}
          onPointerCancel={cancelCurvePointer}
          onKeyDown={onCurveKeyDown}
        />
        <circle
          cx={handle.x * CHART_W}
          cy={(1 - handle.y) * CHART_H}
          r={4.5}
          fill="oklch(0.72 0.185 42)"
          stroke="oklch(0.98 0.01 80)"
          strokeWidth={1.5}
          pointerEvents="none"
          aria-hidden="true"
        />
      </svg>
      <p className="mb-2 text-[0.58rem] leading-relaxed text-fg-3">
        위로 올리면 약한 압력에 더 민감해지고, 아래로 내리면 더 단단해집니다. 방향키로도 조절할 수 있습니다.
      </p>

      <div
        className="mb-2 flex items-center gap-1"
        role="group"
        aria-label="필압 프리셋"
      >
        {BRUSH_PRESSURE_CURVE_PRESETS.map((preset) => {
          const active = curveId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              title={preset.label}
              aria-label={preset.label}
              aria-pressed={active}
              onClick={() =>
                onPressureCurveChange(
                  pressureCurveValueForPreset(preset.id as BrushPressureCurvePresetId)
                )
              }
              className={cn(
                "inline-flex flex-1 items-center justify-center gap-1 rounded-lg border text-[0.6rem] font-bold transition-colors",
                touch ? "h-11" : "h-8",
                active
                  ? "border-accent/55 bg-accent-soft text-accent"
                  : "border-line/70 bg-canvas/40 text-fg-3 hover:bg-raised hover:text-fg"
              )}
            >
              <StudioPressureCurveGlyph curve={preset.id} />
              <span className="hidden sm:inline">{preset.label}</span>
            </button>
          );
        })}
      </div>

      <label
        className={cn(
          "flex items-center gap-2 text-fg-3",
          touch ? "min-h-11" : ""
        )}
      >
        <span className="sr-only">필압 지수 연속 조절</span>
        <input
          type="range"
          min={slider.min}
          max={slider.max}
          step={slider.step}
          value={slider.value}
          onChange={(event) => onPressureCurveChange(Number(event.target.value))}
          aria-valuetext={`감마 ${slider.value.toFixed(2)}`}
          aria-label="필압 반응 강도"
          className={cn("w-full accent-accent", touch ? "h-10" : "h-8")}
        />
      </label>
    </>
  );
}
