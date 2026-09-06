/**
 * StudioLayerTonePanel.tsx
 *
 * Clip Studio Paint Layer Properties: Tone (레이어 속성: 톤 / 스크린톤).
 * Converts the selected layer into high-fidelity manga screentones with configurable
 * line screen frequency (선수), dot pattern shapes (원/선/마름모/격자), angle, and density.
 */

import { Grid, Sparkles } from "lucide-react";

import {
  DEFAULT_HALFTONE,
  HALFTONE_ANGLE_RANGE,
  HALFTONE_DOT_RANGE,
  HALFTONE_STRENGTH_RANGE,
  isIdentityHalftone,
  normalizeHalftone,
  type Halftone,
  type HalftonePattern,
} from "../studio-halftone";

import { cn } from "@/shared/lib/utils";

const LABEL_ROW = "flex items-center justify-between gap-2 text-xs text-fg-2";
const RANGE_CLASS = "w-24 accent-accent cursor-pointer";
const READOUT_CLASS = "w-8 text-right text-[10px] tabular-nums text-fg-3";
const CHIP_CLASS =
  "rounded-md border border-line bg-card px-2 py-0.5 text-[0.6rem] text-fg-2 transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-50";

const PATTERN_OPTIONS: ReadonlyArray<{
  id: HalftonePattern;
  label: string;
  tip: string;
}> = [
  { id: "circle", label: "원형 (Circle)", tip: "표준 만화 원형 도트 망점" },
  { id: "line", label: "선형 (Line)", tip: "만화/신문 단방향 하프톤 라인" },
  { id: "diamond", label: "마름모 (Diamond)", tip: "다이아몬드 능형 망점" },
  { id: "cross", label: "격자 (Cross)", tip: "십자 크로스 해치 망점" },
];

const FREQUENCY_PRESETS: ReadonlyArray<{
  label: string;
  dotSize: number;
  tip: string;
}> = [
  { label: "85L (초미세)", dotSize: 2, tip: "고해상도 초미세 톤" },
  { label: "60L (만화 표준)", dotSize: 4, tip: "소년/순정 만화 인쇄 표준 톤" },
  { label: "42L (중간)", dotSize: 7, tip: "중간 입자 만화 스크린톤" },
  { label: "28L (굵은 도트)", dotSize: 10, tip: "레트로 팝아트 굵은 망점" },
];

export function StudioLayerTonePanel({
  value,
  disabled,
  onChange,
}: {
  readonly value?: Halftone;
  readonly disabled?: boolean;
  readonly onChange: (next: Halftone) => void;
}) {
  const current = normalizeHalftone(value);
  const isEnabled = !isIdentityHalftone(current);

  const patch = (partial: Partial<Halftone>): void => {
    const effectiveStrength =
      partial.strength !== undefined
        ? partial.strength
        : current.strength > 0
          ? current.strength
          : 85;
    onChange(normalizeHalftone({ ...current, ...partial, strength: effectiveStrength }));
  };

  const handleToggle = (): void => {
    if (isEnabled) {
      onChange(normalizeHalftone({ ...current, strength: 0 }));
    } else {
      onChange(
        normalizeHalftone({
          ...DEFAULT_HALFTONE,
          strength: 85,
          mode: "mono",
          dotSize: 4,
          angle: 45,
          pattern: "circle",
        }),
      );
    }
  };

  return (
    <div className="rounded-xl border border-line bg-panel/40 p-3 space-y-2 select-none text-xs">
      {/* Header & Toggle */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Grid size={14} className="text-amber-400 shrink-0" aria-hidden />
          <span className="font-semibold text-fg truncate">스크린톤 (Tone)</span>
          <span className="px-1 py-0.2 text-[10px] rounded font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
            CSP
          </span>
        </div>

        <button
          type="button"
          onClick={handleToggle}
          disabled={disabled}
          aria-pressed={isEnabled}
          className={cn(
            "rounded-md border px-2 py-0.5 text-[0.66rem] font-medium transition-colors",
            isEnabled
              ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
              : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg",
            disabled && "cursor-not-allowed opacity-50",
          )}
        >
          {isEnabled ? "톤 On" : "톤 Off"}
        </button>
      </div>

      {isEnabled && (
        <div className="space-y-2 pt-1 border-t border-line/40">
          {/* Quick Frequency Presets */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            <Sparkles size={11} className="text-amber-400 shrink-0" aria-hidden />
            {FREQUENCY_PRESETS.map((preset) => {
              const active = current.dotSize === preset.dotSize;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => patch({ dotSize: preset.dotSize })}
                  disabled={disabled}
                  title={preset.tip}
                  className={cn(
                    CHIP_CLASS,
                    active && "border-amber-500 bg-amber-500/20 text-amber-200 font-medium",
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          {/* Dot Pattern Shape */}
          <div className="space-y-1">
            <p className="text-[11px] text-fg-3">망점 형태 (Dot Pattern)</p>
            <div className="grid grid-cols-4 gap-1">
              {PATTERN_OPTIONS.map((opt) => {
                const active = (current.pattern ?? "circle") === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => patch({ pattern: opt.id })}
                    disabled={disabled}
                    title={opt.tip}
                    className={cn(
                      "rounded border px-1 py-1 text-[10px] text-center transition-colors truncate",
                      active
                        ? "border-amber-500 bg-amber-500/20 text-amber-200 font-medium"
                        : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg",
                    )}
                  >
                    {opt.label.split(" ")[0]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Line Frequency (dotSize) Slider */}
          <div className={LABEL_ROW}>
            <label htmlFor="tone-dot-size" className="text-[11px]">
              망점 크기 (선수 LPI)
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="tone-dot-size"
                type="range"
                min={HALFTONE_DOT_RANGE.min}
                max={HALFTONE_DOT_RANGE.max}
                step={HALFTONE_DOT_RANGE.step}
                value={current.dotSize}
                disabled={disabled}
                onChange={(e) => patch({ dotSize: Number(e.target.value) })}
                className={RANGE_CLASS}
                aria-label="망점 크기 조절"
              />
              <span className={READOUT_CLASS}>{current.dotSize}px</span>
            </div>
          </div>

          {/* Angle Slider */}
          <div className={LABEL_ROW}>
            <label htmlFor="tone-angle" className="text-[11px]">
              망점 각도 (Angle)
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="tone-angle"
                type="range"
                min={HALFTONE_ANGLE_RANGE.min}
                max={HALFTONE_ANGLE_RANGE.max}
                step={HALFTONE_ANGLE_RANGE.step}
                value={current.angle}
                disabled={disabled}
                onChange={(e) => patch({ angle: Number(e.target.value) })}
                className={RANGE_CLASS}
                aria-label="망점 각도 조절"
              />
              <span className={READOUT_CLASS}>{current.angle}°</span>
            </div>
          </div>

          {/* Density / Strength Slider */}
          <div className={LABEL_ROW}>
            <label htmlFor="tone-strength" className="text-[11px]">
              농도 (Strength)
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="tone-strength"
                type="range"
                min={HALFTONE_STRENGTH_RANGE.min}
                max={HALFTONE_STRENGTH_RANGE.max}
                step={HALFTONE_STRENGTH_RANGE.step}
                value={current.strength}
                disabled={disabled}
                onChange={(e) => patch({ strength: Number(e.target.value) })}
                className={RANGE_CLASS}
                aria-label="망점 농도 조절"
              />
              <span className={READOUT_CLASS}>{current.strength}%</span>
            </div>
          </div>

          {/* Mode Switch (Mono / CMYK) */}
          <div className="flex items-center justify-between pt-1 text-[11px]">
            <span className="text-fg-3">표현 방식</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => patch({ mode: "mono" })}
                disabled={disabled}
                className={cn(
                  "px-2 py-0.5 rounded text-[10px] transition-colors border",
                  current.mode === "mono"
                    ? "bg-amber-500/20 text-amber-200 border-amber-500/40 font-medium"
                    : "bg-card text-fg-3 border-line hover:bg-raised",
                )}
              >
                모노크롬 (흑백)
              </button>
              <button
                type="button"
                onClick={() => patch({ mode: "cmyk" })}
                disabled={disabled}
                className={cn(
                  "px-2 py-0.5 rounded text-[10px] transition-colors border",
                  current.mode === "cmyk"
                    ? "bg-amber-500/20 text-amber-200 border-amber-500/40 font-medium"
                    : "bg-card text-fg-3 border-line hover:bg-raised",
                )}
              >
                컬러 (CMYK)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
