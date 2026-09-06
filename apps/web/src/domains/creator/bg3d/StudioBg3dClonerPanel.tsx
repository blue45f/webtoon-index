import { Layers, RotateCw, Grid, Sparkles } from "lucide-react";
import { useState } from "react";

import {
  generateLinearCloner,
  generateRadialCloner,
  generateGridCloner,
  type ClonerType,
  type ClonerGenerationResult,
} from "../scene-3d/studio-3d-procedural-cloner";

export interface StudioBg3dClonerPanelProps {
  readonly onApplyCloner?: (result: ClonerGenerationResult) => void;
  readonly disabled?: boolean;
}

export function StudioBg3dClonerPanel({
  onApplyCloner,
  disabled = false,
}: StudioBg3dClonerPanelProps) {
  const [clonerType, setClonerType] = useState<ClonerType>("linear");

  // Linear Config
  const [linearCount, setLinearCount] = useState(5);
  const [spacingX, setSpacingX] = useState(1.5);
  const [spacingY, setSpacingY] = useState(0.0);
  const [spacingZ, setSpacingZ] = useState(0.0);
  const [rotStepY, setRotStepY] = useState(0);

  // Radial Config
  const [radialCount, setRadialCount] = useState(8);
  const [radialRadius, setRadialRadius] = useState(4.0);
  const [radialArc, setRadialArc] = useState(360);
  const [radialSpiralHeight, setRadialSpiralHeight] = useState(0.0);
  const [alignTangent, setAlignTangent] = useState(true);

  // Grid Config
  const [gridCountX, setGridCountX] = useState(3);
  const [gridCountY, setGridCountY] = useState(1);
  const [gridCountZ, setGridCountZ] = useState(3);
  const [gridSpacingX, setGridSpacingX] = useState(2.0);
  const [gridSpacingZ, setGridSpacingZ] = useState(2.0);

  const handleGenerate = () => {
    let result: ClonerGenerationResult;
    if (clonerType === "linear") {
      result = generateLinearCloner({
        count: linearCount,
        spacing: [spacingX, spacingY, spacingZ],
        rotationStep: [0, rotStepY, 0],
        scaleMultiplier: [1, 1, 1],
        noiseJitter: [0, 0, 0],
      });
    } else if (clonerType === "radial") {
      result = generateRadialCloner({
        count: radialCount,
        radius: radialRadius,
        arcDegrees: radialArc,
        axis: "y",
        alignToTangent: alignTangent,
        spiralHeight: radialSpiralHeight,
      });
    } else {
      result = generateGridCloner({
        countX: gridCountX,
        countY: gridCountY,
        countZ: gridCountZ,
        spacingX: gridSpacingX,
        spacingY: 1.0,
        spacingZ: gridSpacingZ,
        centerGrid: true,
        noiseJitter: [0, 0, 0],
      });
    }

    onApplyCloner?.(result);
  };

  return (
    <div className="flex flex-col gap-3 p-3 text-xs text-fg">
      {/* Cloner Mode Selector */}
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-card p-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setClonerType("linear")}
          className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-[0.7rem] font-bold transition-all ${
            clonerType === "linear"
              ? "border border-line bg-raised text-fg shadow-sm"
              : "text-fg-3 hover:text-fg"
          }`}
        >
          <Layers className="size-3.5 text-accent" />
          <span>선형 복제 (Linear)</span>
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => setClonerType("radial")}
          className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-[0.7rem] font-bold transition-all ${
            clonerType === "radial"
              ? "border border-line bg-raised text-fg shadow-sm"
              : "text-fg-3 hover:text-fg"
          }`}
        >
          <RotateCw className="size-3.5 text-accent" />
          <span>원형 복제 (Radial)</span>
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => setClonerType("grid")}
          className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-[0.7rem] font-bold transition-all ${
            clonerType === "grid"
              ? "border border-line bg-raised text-fg shadow-sm"
              : "text-fg-3 hover:text-fg"
          }`}
        >
          <Grid className="size-3.5 text-accent" />
          <span>격자 복제 (Grid)</span>
        </button>
      </div>

      {/* Linear Controls */}
      {clonerType === "linear" && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-line/70 bg-card p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[0.68rem] text-fg-2">복제 개수:</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="2"
                max="32"
                value={linearCount}
                onChange={(e) => setLinearCount(Number(e.target.value))}
                className="h-1.5 w-24 cursor-pointer accent-accent"
              />
              <span className="w-6 text-right font-mono text-xs font-bold text-fg">{linearCount}</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[0.68rem] text-fg-2">X / Z 간격:</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.1"
                value={spacingX}
                onChange={(e) => setSpacingX(Number(e.target.value))}
                className="w-14 rounded border border-line bg-raised px-1.5 py-0.5 text-right font-mono text-xs text-fg"
              />
              <input
                type="number"
                step="0.1"
                value={spacingZ}
                onChange={(e) => setSpacingZ(Number(e.target.value))}
                className="w-14 rounded border border-line bg-raised px-1.5 py-0.5 text-right font-mono text-xs text-fg"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[0.68rem] text-fg-2">Y 계단 간격:</span>
            <input
              type="number"
              step="0.1"
              value={spacingY}
              onChange={(e) => setSpacingY(Number(e.target.value))}
              className="w-16 rounded border border-line bg-raised px-1.5 py-0.5 text-right font-mono text-xs text-fg"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[0.68rem] text-fg-2">회전 스텝(°):</span>
            <input
              type="number"
              step="5"
              value={rotStepY}
              onChange={(e) => setRotStepY(Number(e.target.value))}
              className="w-16 rounded border border-line bg-raised px-1.5 py-0.5 text-right font-mono text-xs text-fg"
            />
          </div>
        </div>
      )}

      {/* Radial Controls */}
      {clonerType === "radial" && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-line/70 bg-card p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[0.68rem] text-fg-2">원주 개수:</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="3"
                max="32"
                value={radialCount}
                onChange={(e) => setRadialCount(Number(e.target.value))}
                className="h-1.5 w-24 cursor-pointer accent-accent"
              />
              <span className="w-6 text-right font-mono text-xs font-bold text-fg">{radialCount}</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[0.68rem] text-fg-2">반지름 / 각도(°):</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.5"
                value={radialRadius}
                onChange={(e) => setRadialRadius(Number(e.target.value))}
                className="w-14 rounded border border-line bg-raised px-1.5 py-0.5 text-right font-mono text-xs text-fg"
              />
              <input
                type="number"
                step="15"
                value={radialArc}
                onChange={(e) => setRadialArc(Number(e.target.value))}
                className="w-14 rounded border border-line bg-raised px-1.5 py-0.5 text-right font-mono text-xs text-fg"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[0.68rem] text-fg-2">나선 상승 높이:</span>
            <input
              type="number"
              step="0.5"
              value={radialSpiralHeight}
              onChange={(e) => setRadialSpiralHeight(Number(e.target.value))}
              className="w-16 rounded border border-line bg-raised px-1.5 py-0.5 text-right font-mono text-xs text-fg"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-[0.68rem] text-fg-2">
            <input
              type="checkbox"
              checked={alignTangent}
              onChange={(e) => setAlignTangent(e.target.checked)}
              className="size-3.5 rounded border-line accent-accent"
            />
            <span>원 중심/접선 방향으로 자동 회전 맞춤</span>
          </label>
        </div>
      )}

      {/* Grid Controls */}
      {clonerType === "grid" && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-line/70 bg-card p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[0.68rem] text-fg-2">X × Y × Z 격자수:</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="1"
                max="10"
                value={gridCountX}
                onChange={(e) => setGridCountX(Number(e.target.value))}
                className="w-10 rounded border border-line bg-raised px-1 py-0.5 text-center font-mono text-xs text-fg"
              />
              <span className="text-fg-3">×</span>
              <input
                type="number"
                min="1"
                max="10"
                value={gridCountY}
                onChange={(e) => setGridCountY(Number(e.target.value))}
                className="w-10 rounded border border-line bg-raised px-1 py-0.5 text-center font-mono text-xs text-fg"
              />
              <span className="text-fg-3">×</span>
              <input
                type="number"
                min="1"
                max="10"
                value={gridCountZ}
                onChange={(e) => setGridCountZ(Number(e.target.value))}
                className="w-10 rounded border border-line bg-raised px-1 py-0.5 text-center font-mono text-xs text-fg"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[0.68rem] text-fg-2">격자 간격 (X / Z):</span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                step="0.5"
                value={gridSpacingX}
                onChange={(e) => setGridSpacingX(Number(e.target.value))}
                className="w-12 rounded border border-line bg-raised px-1 py-0.5 text-center font-mono text-xs text-fg"
              />
              <input
                type="number"
                step="0.5"
                value={gridSpacingZ}
                onChange={(e) => setGridSpacingZ(Number(e.target.value))}
                className="w-12 rounded border border-line bg-raised px-1 py-0.5 text-center font-mono text-xs text-fg"
              />
            </div>
          </div>
        </div>
      )}

      {/* Action Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={handleGenerate}
        className="flex items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-[0.72rem] font-bold text-accent-fg shadow-sm transition-all hover:bg-accent/90 disabled:opacity-50"
      >
        <Sparkles className="size-3.5" />
        <span>3D 클로너 인스턴스 배열 생성</span>
      </button>
    </div>
  );
}
