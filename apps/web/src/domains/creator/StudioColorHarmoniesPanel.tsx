/**
 * StudioColorHarmoniesPanel.tsx
 *
 * Interactive Color Harmonies Panel benchmarking Adobe Color & Procreate.
 * Provides 6 harmony rules (Complementary, Analogous, Triadic, Split-Complementary, Tetradic, Monochromatic)
 * with real-time recalculation, continuous gradient preview ribbons, and one-click color selection.
 */

import { Check, Sparkles } from "lucide-react";
import { useState } from "react";

import {
  getAllHarmonies,
  type HarmonyMode,
} from "./studio-color-harmony-engine";

export interface StudioColorHarmoniesPanelProps {
  readonly value: string;
  readonly onSelectColor: (hex: string) => void;
  readonly onSaveAsPalette?: (name: string, colors: string[]) => void;
}

export function StudioColorHarmoniesPanel({
  value,
  onSelectColor,
  onSaveAsPalette,
}: StudioColorHarmoniesPanelProps) {
  const [activeMode, setActiveMode] = useState<HarmonyMode>("complementary");
  const [savedBadge, setSavedBadge] = useState<string | null>(null);

  const harmonies = getAllHarmonies(value);
  const selectedHarmony = harmonies.find((h) => h.mode === activeMode) ?? harmonies[0];

  const handleSavePalette = () => {
    if (!selectedHarmony) return;
    const name = `배색: ${selectedHarmony.label.split(" ")[0]} (${value})`;
    onSaveAsPalette?.(name, [...selectedHarmony.colors]);
    setSavedBadge("내 팔레트에 저장됨!");
    setTimeout(() => setSavedBadge(null), 1800);
  };

  return (
    <div className="flex flex-col gap-2.5">
      {/* Visual Harmony Ribbon Preview */}
      <div className="relative overflow-hidden rounded-lg border border-line/60 p-1 bg-raised/40 shadow-inner">
        <div
          className="h-2.5 w-full rounded-md shadow-inner transition-all duration-300"
          style={{
            background:
              selectedHarmony.colors.length > 1
                ? `linear-gradient(to right, ${selectedHarmony.colors.join(", ")})`
                : selectedHarmony.colors[0] ?? value,
          }}
        />
      </div>

      {/* Harmony Mode Pills (6 Rules) */}
      <div
        role="tablist"
        aria-label="색상 조화 규칙"
        className="grid grid-cols-3 gap-1 rounded-xl border border-line/70 bg-raised/50 p-1 backdrop-blur-sm"
      >
        {harmonies.map((h) => {
          const isActive = h.mode === activeMode;
          return (
            <button
              key={h.mode}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={h.label}
              onClick={() => setActiveMode(h.mode)}
              className={`rounded-lg px-1.5 py-1 text-[0.62rem] font-medium transition-all ${
                isActive
                  ? "bg-card text-accent font-semibold shadow-sm border border-accent/40 scale-[1.02]"
                  : "text-fg-3 hover:bg-card/60 hover:text-fg-1"
              }`}
            >
              {h.label.split(" ")[0]}
            </button>
          );
        })}
      </div>

      {/* Description & Angle guide */}
      <div className="flex items-center justify-between px-0.5">
        <p className="text-[0.65rem] leading-relaxed text-fg-3">
          {selectedHarmony.description}
        </p>
        <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[0.56rem] font-mono font-semibold text-accent">
          {selectedHarmony.colors.length}색 조화
        </span>
      </div>

      {/* Swatches Grid with Painter Chips */}
      <div className="flex flex-wrap items-center justify-center gap-2 pt-0.5" role="radiogroup" aria-label="조화 배색 목록">
        {selectedHarmony.colors.map((hex, idx) => {
          const isSelected = hex.toLowerCase() === value.toLowerCase();
          const isBase = idx === 0;
          return (
            <div key={`${hex}-${idx}`} className="flex flex-col items-center gap-1">
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={`조화 색상 ${hex} 선택`}
                onClick={() => onSelectColor(hex)}
                className={`group relative size-11 cursor-pointer rounded-xl border border-white/20 shadow-md transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg active:scale-95 ${
                  isSelected ? "ring-2 ring-accent ring-offset-2 ring-offset-panel" : ""
                }`}
                style={{ backgroundColor: hex }}
              >
                {/* Glossy top reflection */}
                <span
                  className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-xl opacity-30"
                  style={{
                    background: "linear-gradient(180deg, rgba(255,255,255,0.8) 0%, transparent 100%)",
                  }}
                />
                {isSelected && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <Check className="size-4 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]" />
                  </span>
                )}
                {isBase && !isSelected && (
                  <span className="absolute bottom-1 right-1 size-1.5 rounded-full bg-white shadow-[0_0_2px_rgba(0,0,0,0.8)]" />
                )}
              </button>
              <div className="flex flex-col items-center">
                <span className="font-mono text-[0.58rem] font-medium text-fg-2 tracking-tight">{hex}</span>
                <span className="text-[0.52rem] text-fg-3">{isBase ? "기본" : `조화 ${idx}`}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Save as Palette action */}
      {onSaveAsPalette && (
        <button
          type="button"
          aria-label="이 조화 배색을 내 팔레트로 저장"
          onClick={handleSavePalette}
          className="mt-1 flex items-center justify-center gap-1.5 rounded-xl border border-accent/40 bg-accent/10 px-3 py-1.5 text-[0.66rem] font-semibold text-accent transition-all hover:bg-accent/20 hover:border-accent/60 active:scale-[0.98] shadow-sm"
        >
          <Sparkles className="size-3" aria-hidden />
          {savedBadge ? "내 팔레트에 저장했어요!" : "이 조화 배색을 내 팔레트로 저장"}
        </button>
      )}
    </div>
  );
}
