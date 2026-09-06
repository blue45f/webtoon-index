/**
 * StudioApproximateColorPanel.tsx
 *
 * Clip Studio Paint Approximate Color Palette (근사색 팔레트).
 * Displays systematic variations around the active reference color by varying
 * Saturation, Value/Luminance, and Hue, enabling instant picking of subtle
 * highlights, midtones, and shadows without manual color wheel adjustments.
 */

import { SlidersHorizontal, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import {
  generateApproximateColorGrid,
  type ApproximateColorMode,
} from "./studio-approximate-color";

import { cn } from "@/shared/lib/utils";

export interface StudioApproximateColorPanelProps {
  readonly activeColor: string;
  readonly onSelectColor: (hex: string) => void;
  readonly className?: string;
}

const MODES: readonly { readonly id: ApproximateColorMode; readonly label: string }[] = [
  { id: "sat-val", label: "채도·명도 (S×V)" },
  { id: "hue-val", label: "색조·명도 (H×V)" },
  { id: "hue-sat", label: "색조·채도 (H×S)" },
  { id: "val-only", label: "명도 (V)" },
];

const DELTAS: readonly number[] = [3, 5, 8, 12];

export function StudioApproximateColorPanel({
  activeColor,
  onSelectColor,
  className,
}: StudioApproximateColorPanelProps) {
  const [mode, setMode] = useState<ApproximateColorMode>("sat-val");
  const [steps, setSteps] = useState<5 | 7>(5);
  const [deltaPercent, setDeltaPercent] = useState<number>(6);
  const [hoveredHex, setHoveredHex] = useState<string | null>(null);

  const grid = useMemo(
    () => generateApproximateColorGrid(activeColor, { mode, steps, deltaPercent }),
    [activeColor, mode, steps, deltaPercent],
  );

  const centerIndex = Math.floor(steps / 2);

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border border-line bg-panel/60 p-3 select-none text-slate-200 text-xs shadow-sm",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-line/60">
        <div className="flex items-center gap-1.5 min-w-0">
          <SlidersHorizontal size={14} className="text-emerald-400 shrink-0" aria-hidden />
          <span className="font-semibold truncate">근사색 (Approximate Color)</span>
          <span className="px-1 py-0.2 text-[10px] rounded font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">
            CSP
          </span>
        </div>

        {/* Steps Selector */}
        <div className="flex items-center gap-1 shrink-0">
          {([5, 7] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSteps(s)}
              className={cn(
                "px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors",
                steps === s
                  ? "bg-emerald-600 text-white font-semibold"
                  : "bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700",
              )}
              title={`${s}x${s} 그리드`}
              aria-label={`${s}x${s} 그리드`}
            >
              {s}x{s}
            </button>
          ))}
        </div>
      </div>

      {/* Mode & Delta Selectors */}
      <div className="flex items-center justify-between gap-1 my-2">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={cn(
                "px-2 py-0.5 rounded-full text-[10px] whitespace-nowrap transition-colors border",
                mode === m.id
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-medium"
                  : "bg-slate-800/80 hover:bg-slate-700 border-slate-700/60 text-slate-300",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Delta Step Selector */}
        <div className="flex items-center gap-0.5 shrink-0">
          <span className="text-[10px] text-slate-500 mr-0.5">±</span>
          {DELTAS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDeltaPercent(d)}
              className={cn(
                "px-1 py-0.2 rounded text-[10px] font-mono transition-colors",
                deltaPercent === d
                  ? "bg-emerald-600 text-white font-medium"
                  : "text-slate-400 hover:text-white",
              )}
            >
              {d}%
            </button>
          ))}
        </div>
      </div>

      {/* NxN Approximate Color Grid */}
      <div
        className="grid gap-0.5 p-1 rounded-lg bg-slate-950 border border-line/50"
        style={{
          gridTemplateColumns: `repeat(${steps}, minmax(0, 1fr))`,
        }}
      >
        {grid.map((row, rowIndex) =>
          row.map((cellHex, colIndex) => {
            const isCenter = rowIndex === centerIndex && colIndex === centerIndex;
            return (
              <button
                key={`${rowIndex}-${colIndex}`}
                type="button"
                onClick={() => onSelectColor(cellHex)}
                onPointerEnter={() => setHoveredHex(cellHex)}
                onPointerLeave={() => setHoveredHex(null)}
                aria-label={`${cellHex} 색상 선택`}
                title={`${cellHex}${isCenter ? " (현재 기준색)" : ""}`}
                className={cn(
                  "aspect-square rounded-sm transition-transform hover:scale-110 relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                  isCenter
                    ? "ring-2 ring-emerald-400 z-10 shadow-sm"
                    : "hover:z-10",
                )}
                style={{ background: cellHex }}
              >
                {isCenter && (
                  <span className="absolute inset-0 m-auto size-1.5 rounded-full bg-white shadow mix-blend-difference pointer-events-none" />
                )}
              </button>
            );
          }),
        )}
      </div>

      {/* Hover Info Readout */}
      <div className="flex items-center justify-between mt-2 pt-1 border-t border-line/40 text-[10px] text-slate-400 font-mono">
        <div className="flex items-center gap-1">
          <Sparkles size={11} className="text-emerald-400 shrink-0" aria-hidden />
          <span>선택 색상: {hoveredHex ?? activeColor}</span>
        </div>
        <span
          className="size-3 rounded border border-white/30"
          style={{ background: hoveredHex ?? activeColor }}
        />
      </div>
    </div>
  );
}
