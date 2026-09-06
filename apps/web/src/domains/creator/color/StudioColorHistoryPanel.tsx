/**
 * StudioColorHistoryPanel.tsx
 *
 * Clip Studio Paint Color History Palette (컬러 히스토리 팔레트).
 * Keeps a continuous, deduplicated log of every color selected and painted with
 * in the studio, allowing rapid one-click re-selection and manual registration.
 */

import { History, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  addColorToHistory,
  clearColorHistory,
  INITIAL_COLOR_HISTORY,
} from "./studio-color-history";

import { cn } from "@/shared/lib/utils";

export interface StudioColorHistoryPanelProps {
  readonly activeColor: string;
  readonly onSelectColor: (hex: string) => void;
  readonly initialHistory?: readonly string[];
  readonly className?: string;
}

export function StudioColorHistoryPanel({
  activeColor,
  onSelectColor,
  initialHistory = INITIAL_COLOR_HISTORY,
  className,
}: StudioColorHistoryPanelProps) {
  const [history, setHistory] = useState<readonly string[]>(initialHistory);
  const [hoveredHex, setHoveredHex] = useState<string | null>(null);

  const handleRegisterCurrent = () => {
    setHistory((prev) => addColorToHistory(prev, activeColor));
  };

  const handleClearHistory = () => {
    setHistory(clearColorHistory());
  };

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
          <History size={14} className="text-violet-400 shrink-0" aria-hidden />
          <span className="font-semibold truncate">컬러 히스토리 (Color History)</span>
          <span className="px-1 py-0.2 text-[10px] rounded font-medium bg-violet-500/20 text-violet-300 border border-violet-500/30 shrink-0">
            CSP
          </span>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleRegisterCurrent}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors border border-slate-700/60"
            title="현재 선택된 색상을 히스토리에 추가"
          >
            <Plus size={11} aria-hidden />
            <span>등록</span>
          </button>
          <button
            type="button"
            onClick={handleClearHistory}
            className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
            title="히스토리 전체 지우기"
            aria-label="히스토리 전체 지우기"
          >
            <Trash2 size={12} aria-hidden />
          </button>
        </div>
      </div>

      {/* History Swatches Grid */}
      <div className="mt-2 min-h-16">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-4 text-slate-500 text-[11px] gap-1">
            <span>기록된 색상이 없습니다.</span>
            <span className="text-[10px] text-slate-600">작업한 색상이 자동으로 저장됩니다.</span>
          </div>
        ) : (
          <div className="grid grid-cols-8 gap-1 p-1 rounded-lg bg-slate-950 border border-line/50">
            {history.map((colorHex, index) => {
              const isMatch = activeColor.toLowerCase() === colorHex.toLowerCase();
              return (
                <button
                  key={`${colorHex}-${index}`}
                  type="button"
                  onClick={() => onSelectColor(colorHex)}
                  onPointerEnter={() => setHoveredHex(colorHex)}
                  onPointerLeave={() => setHoveredHex(null)}
                  aria-label={`${colorHex} 색상 선택`}
                  title={colorHex}
                  className={cn(
                    "aspect-square rounded transition-transform hover:scale-110 relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400",
                    isMatch ? "ring-2 ring-violet-400 z-10 shadow-sm" : "hover:z-10",
                  )}
                  style={{ background: colorHex }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Info Readout */}
      <div className="flex items-center justify-between mt-2 pt-1 border-t border-line/40 text-[10px] text-slate-400 font-mono">
        <span>선택 색상: {hoveredHex ?? activeColor}</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-slate-500">({history.length}색 기록됨)</span>
          <span
            className="size-3 rounded border border-white/30"
            style={{ background: hoveredHex ?? activeColor }}
          />
        </div>
      </div>
    </div>
  );
}
