/**
 * StudioLineWidthAdjustmentPanel.tsx
 *
 * Clip Studio Paint Correct Line Width Tool (선폭 수정 패널).
 * Provides interactive thickening, narrowing, scaling, and pressure adjustment
 * for vector and freehand drawn strokes in ToonSpectrum.
 */

import { Check, Edit3, Sparkles } from "lucide-react";
import { useState } from "react";

import {
  calculateAdjustedStrokeWidth,
  LINE_WIDTH_PRESETS,
  type LineWidthAction,
  type LineWidthAdjustmentOptions,
} from "./studio-line-width-adjust";

import { cn } from "@/shared/lib/utils";

export interface StudioLineWidthAdjustmentPanelProps {
  readonly currentWidth?: number;
  readonly onApply: (options: LineWidthAdjustmentOptions) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

const ACTION_TABS: readonly { id: LineWidthAction; label: string }[] = [
  { id: "thicken", label: "굵게 (+)" },
  { id: "narrow", label: "가늘게 (-)" },
  { id: "scale", label: "배율 (×)" },
  { id: "fix", label: "고정 (=)" },
];

export function StudioLineWidthAdjustmentPanel({
  currentWidth = 4,
  onApply,
  disabled = false,
  className,
}: StudioLineWidthAdjustmentPanelProps) {
  const [action, setAction] = useState<LineWidthAction>("thicken");
  const [value, setValue] = useState<number>(2);
  const [scalePressures, setScalePressures] = useState<boolean>(true);

  const previewWidth = calculateAdjustedStrokeWidth(currentWidth, {
    action,
    value,
    scalePressures,
  });

  const handleApplyPreset = (presetOptions: LineWidthAdjustmentOptions) => {
    setAction(presetOptions.action);
    setValue(presetOptions.value);
  };

  const handleExecute = () => {
    onApply({ action, value, scalePressures });
  };

  return (
    <div
      className={cn(
        "rounded-xl border border-line bg-panel/40 p-3 select-none text-xs space-y-2 text-slate-200 shadow-sm",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-line/60">
        <div className="flex items-center gap-1.5 min-w-0">
          <Edit3 size={14} className="text-cyan-400 shrink-0" aria-hidden />
          <span className="font-semibold truncate">선폭 수정 (Line Width)</span>
          <span className="px-1 py-0.2 text-[10px] rounded font-medium bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shrink-0">
            CSP
          </span>
        </div>
        <span className="text-[10px] text-slate-400 font-mono">
          {currentWidth}px → {previewWidth}px
        </span>
      </div>

      {/* Preset Chips */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
        <Sparkles size={11} className="text-cyan-400 shrink-0" aria-hidden />
        {LINE_WIDTH_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => handleApplyPreset(preset.options)}
            disabled={disabled}
            className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 text-slate-300 whitespace-nowrap transition-colors disabled:opacity-50"
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Action Mode Tabs */}
      <div className="grid grid-cols-4 gap-1 p-0.5 rounded-lg bg-slate-950 border border-line/50">
        {ACTION_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setAction(tab.id)}
            disabled={disabled}
            className={cn(
              "py-1 rounded text-[10px] text-center font-medium transition-colors",
              action === tab.id
                ? "bg-cyan-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Value Slider & Controls */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px] text-slate-300">
          <span>{action === "scale" ? "배율" : "변화 폭"}</span>
          <span className="font-mono text-cyan-300">
            {action === "scale" ? `${value}x` : `${value}px`}
          </span>
        </div>
        <input
          type="range"
          min={action === "scale" ? 0.2 : 0.5}
          max={action === "scale" ? 3.0 : 30}
          step={action === "scale" ? 0.1 : 0.5}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(Number(e.target.value))}
          aria-label="선폭 조절 값"
          className="w-full accent-cyan-400 cursor-pointer"
        />
      </div>

      {/* Stylus Pressure Scaling Checkbox */}
      <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-300 pt-0.5">
        <input
          type="checkbox"
          checked={scalePressures}
          disabled={disabled}
          onChange={(e) => setScalePressures(e.target.checked)}
          className="rounded border-line bg-slate-900 text-cyan-500 focus:ring-cyan-400 size-3.5 cursor-pointer"
        />
        <span>필압 다이내믹스 함께 스케일</span>
      </label>

      {/* Apply Button */}
      <button
        type="button"
        onClick={handleExecute}
        disabled={disabled}
        className="w-full py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 active:scale-[0.98] text-white font-medium text-xs transition-transform flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Check size={13} aria-hidden />
        <span>선택한 선에 선폭 적용</span>
      </button>
    </div>
  );
}
