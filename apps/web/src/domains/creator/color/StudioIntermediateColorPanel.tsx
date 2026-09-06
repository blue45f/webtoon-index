/**
 * StudioIntermediateColorPanel.tsx
 *
 * Clip Studio Paint Intermediate Color Palette (중간색 팔레트).
 * Computes an interactive 2D bilinear interpolation grid between
 * 4 user-selected corner colors (Highlight, Base, Shadow 1, Deep Shadow 2)
 * for seamless webtoon shading and midtone selection.
 */

import { Grid, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import {
  DEFAULT_INTERMEDIATE_CORNERS,
  generateIntermediateColorGrid,
  STUDIO_INTERMEDIATE_COLOR_PRESETS,
  type StudioIntermediateColorCorners,
  type StudioIntermediateGridSize,
} from "./studio-intermediate-color";

import { cn } from "@/shared/lib/utils";

export interface StudioIntermediateColorPanelProps {
  readonly activeColor?: string;
  readonly onSelectColor: (hex: string) => void;
  readonly className?: string;
}

export function StudioIntermediateColorPanel({
  activeColor = "#fcd5b5",
  onSelectColor,
  className,
}: StudioIntermediateColorPanelProps) {
  const [corners, setCorners] = useState<StudioIntermediateColorCorners>(DEFAULT_INTERMEDIATE_CORNERS);
  const [gridSize, setGridSize] = useState<StudioIntermediateGridSize>(6);
  const [hoveredCellColor, setHoveredCellColor] = useState<string | null>(null);

  const grid = useMemo(
    () => generateIntermediateColorGrid(corners, gridSize),
    [corners, gridSize],
  );

  const handleApplyPreset = (presetCorners: StudioIntermediateColorCorners) => {
    setCorners(presetCorners);
  };

  const handleUpdateCorner = (cornerKey: keyof StudioIntermediateColorCorners, color: string) => {
    setCorners((prev) => ({ ...prev, [cornerKey]: color }));
  };

  const handleSetCornerToActive = (cornerKey: keyof StudioIntermediateColorCorners) => {
    if (activeColor) {
      setCorners((prev) => ({ ...prev, [cornerKey]: activeColor }));
    }
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
          <Grid size={14} className="text-indigo-400 shrink-0" aria-hidden />
          <span className="font-semibold truncate">중간색 (Intermediate Color)</span>
          <span className="px-1 py-0.2 text-[10px] rounded font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shrink-0">
            CSP
          </span>
        </div>

        {/* Grid Size Selector */}
        <div className="flex items-center gap-1 shrink-0">
          {([4, 6, 8] as const).map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => setGridSize(size)}
              className={cn(
                "px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors",
                gridSize === size
                  ? "bg-indigo-600 text-white font-semibold"
                  : "bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700",
              )}
              title={`${size}x${size} 그리드`}
              aria-label={`${size}x${size} 그리드`}
            >
              {size}x{size}
            </button>
          ))}
        </div>
      </div>

      {/* Preset Chips */}
      <div className="flex items-center gap-1 my-2 overflow-x-auto no-scrollbar">
        <Sparkles size={12} className="text-amber-400 shrink-0" aria-hidden />
        {STUDIO_INTERMEDIATE_COLOR_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => handleApplyPreset(preset.corners)}
            className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 text-slate-300 whitespace-nowrap transition-colors"
          >
            {preset.name}
          </button>
        ))}
      </div>

      {/* 4 Corner Anchors Control Bar */}
      <div className="grid grid-cols-2 gap-2 mb-2 p-2 rounded-lg bg-slate-950/60 border border-line/30 text-[11px]">
        {/* Top-Left */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1">
            <label className="relative size-4 rounded cursor-pointer border border-white/40 overflow-hidden shrink-0">
              <input
                type="color"
                value={corners.c00}
                onChange={(e) => handleUpdateCorner("c00", e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer size-full"
                aria-label="좌상단 코너 색상"
              />
              <span className="block size-full" style={{ background: corners.c00 }} />
            </label>
            <span className="text-slate-400 text-[10px]">좌상 (C00)</span>
          </div>
          <button
            type="button"
            onClick={() => handleSetCornerToActive("c00")}
            className="text-[9px] text-indigo-300 hover:text-white px-1 py-0.2 rounded bg-indigo-500/10 hover:bg-indigo-500/20"
            title="현재 선택된 색으로 좌상단 코너 설정"
          >
            현재색
          </button>
        </div>

        {/* Top-Right */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1">
            <label className="relative size-4 rounded cursor-pointer border border-white/40 overflow-hidden shrink-0">
              <input
                type="color"
                value={corners.c10}
                onChange={(e) => handleUpdateCorner("c10", e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer size-full"
                aria-label="우상단 코너 색상"
              />
              <span className="block size-full" style={{ background: corners.c10 }} />
            </label>
            <span className="text-slate-400 text-[10px]">우상 (C10)</span>
          </div>
          <button
            type="button"
            onClick={() => handleSetCornerToActive("c10")}
            className="text-[9px] text-indigo-300 hover:text-white px-1 py-0.2 rounded bg-indigo-500/10 hover:bg-indigo-500/20"
            title="현재 선택된 색으로 우상단 코너 설정"
          >
            현재색
          </button>
        </div>

        {/* Bottom-Left */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1">
            <label className="relative size-4 rounded cursor-pointer border border-white/40 overflow-hidden shrink-0">
              <input
                type="color"
                value={corners.c01}
                onChange={(e) => handleUpdateCorner("c01", e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer size-full"
                aria-label="좌하단 코너 색상"
              />
              <span className="block size-full" style={{ background: corners.c01 }} />
            </label>
            <span className="text-slate-400 text-[10px]">좌하 (C01)</span>
          </div>
          <button
            type="button"
            onClick={() => handleSetCornerToActive("c01")}
            className="text-[9px] text-indigo-300 hover:text-white px-1 py-0.2 rounded bg-indigo-500/10 hover:bg-indigo-500/20"
            title="현재 선택된 색으로 좌하단 코너 설정"
          >
            현재색
          </button>
        </div>

        {/* Bottom-Right */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1">
            <label className="relative size-4 rounded cursor-pointer border border-white/40 overflow-hidden shrink-0">
              <input
                type="color"
                value={corners.c11}
                onChange={(e) => handleUpdateCorner("c11", e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer size-full"
                aria-label="우하단 코너 색상"
              />
              <span className="block size-full" style={{ background: corners.c11 }} />
            </label>
            <span className="text-slate-400 text-[10px]">우하 (C11)</span>
          </div>
          <button
            type="button"
            onClick={() => handleSetCornerToActive("c11")}
            className="text-[9px] text-indigo-300 hover:text-white px-1 py-0.2 rounded bg-indigo-500/10 hover:bg-indigo-500/20"
            title="현재 선택된 색으로 우하단 코너 설정"
          >
            현재색
          </button>
        </div>
      </div>

      {/* 2D Interpolated Swatch Grid */}
      <div
        className="grid gap-0.5 p-1 rounded-lg bg-slate-950 border border-line/50"
        style={{
          gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
        }}
      >
        {grid.map((row, rowIndex) =>
          row.map((cellHex, colIndex) => {
            const isMatch = activeColor.toLowerCase() === cellHex.toLowerCase();
            return (
              <button
                key={`${rowIndex}-${colIndex}`}
                type="button"
                onClick={() => onSelectColor(cellHex)}
                onPointerEnter={() => setHoveredCellColor(cellHex)}
                onPointerLeave={() => setHoveredCellColor(null)}
                aria-label={`${cellHex} 색상 선택`}
                title={cellHex}
                className={cn(
                  "aspect-square rounded-sm transition-transform hover:scale-110 relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                  isMatch ? "ring-2 ring-indigo-400 z-10" : "hover:z-10",
                )}
                style={{ background: cellHex }}
              />
            );
          }),
        )}
      </div>

      {/* Hover Info Readout */}
      <div className="flex items-center justify-between mt-2 pt-1 border-t border-line/40 text-[10px] text-slate-400 font-mono">
        <span>선택 색상: {hoveredCellColor ?? activeColor}</span>
        <span
          className="size-3 rounded border border-white/30"
          style={{ background: hoveredCellColor ?? activeColor }}
        />
      </div>
    </div>
  );
}
