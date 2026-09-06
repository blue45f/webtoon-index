import { Grid, SunMedium, Sparkles } from "lucide-react";
import React, { useState } from "react";

import {
  SCREENTONE_PRESETS,
  calculateKelvinRgb,
  type ScreentoneShaderConfig,
  type ScreentonePreset,
} from "../scene-3d/studio-3d-halftone-screentone-shader";

export interface StudioBg3dHalftoneScreentonePanelProps {
  readonly onApplyScreentoneConfig?: (config: ScreentoneShaderConfig) => void;
}

export function StudioBg3dHalftoneScreentonePanel({
  onApplyScreentoneConfig,
}: StudioBg3dHalftoneScreentonePanelProps): React.JSX.Element {
  const [selectedPresetId, setSelectedPresetId] = useState<string>("shonen-manga-dots");
  const [config, setConfig] = useState<ScreentoneShaderConfig>({
    pattern: "manga-dot-grid",
    frequencyLpi: 60,
    angleDegrees: 45,
    dotSizeMax: 0.85,
    threshold: 0.5,
    sharpness: 1.0,
    colorTemperatureKelvin: 6500,
    toneColor: "#111115",
    paperColor: "#ffffff",
  });

  const handleSelectPreset = (preset: ScreentonePreset) => {
    setSelectedPresetId(preset.id);
    const next: ScreentoneShaderConfig = {
      ...config,
      pattern: preset.pattern,
      frequencyLpi: preset.frequencyLpi,
      angleDegrees: preset.angleDegrees,
      dotSizeMax: preset.dotSizeMax,
      threshold: preset.threshold,
      colorTemperatureKelvin: preset.kelvin,
    };
    setConfig(next);
    onApplyScreentoneConfig?.(next);
  };

  const handleKelvinChange = (kelvin: number) => {
    const next = { ...config, colorTemperatureKelvin: kelvin };
    setConfig(next);
    onApplyScreentoneConfig?.(next);
  };

  const kelvinRgb = calculateKelvinRgb(config.colorTemperatureKelvin);
  const rgbColorString = `rgb(${Math.round(kelvinRgb[0] * 255)}, ${Math.round(kelvinRgb[1] * 255)}, ${Math.round(kelvinRgb[2] * 255)})`;

  return (
    <div className="flex flex-col gap-3 p-3 text-xs text-fg">
      <div className="flex items-center justify-between border-b border-line pb-2">
        <div className="flex items-center gap-1.5 font-bold text-fg">
          <Grid className="size-4 text-accent" />
          <span>3D 스크린톤 & 망점 셰이더</span>
        </div>
        <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[0.68rem] text-accent font-semibold">
          {config.frequencyLpi}선 / {config.angleDegrees}°
        </span>
      </div>

      {/* Preset List */}
      <div className="grid grid-cols-2 gap-1.5">
        {SCREENTONE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => handleSelectPreset(preset)}
            className={`flex flex-col items-start rounded-lg border p-2 text-left transition-all ${
              selectedPresetId === preset.id
                ? "border-accent bg-accent/10 font-bold text-accent shadow-sm"
                : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
            }`}
          >
            <span className="text-[0.72rem] leading-tight">{preset.name}</span>
            <span className="mt-0.5 text-[0.62rem] text-fg-3 line-clamp-1">{preset.description}</span>
          </button>
        ))}
      </div>

      {/* Kelvin Color Temperature Control */}
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-card p-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-bold text-fg">
            <SunMedium className="size-3.5 text-accent" />
            <span className="text-[0.7rem]">조명 색온도 (Color Temperature)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div
              className="size-3 rounded-full border border-line shadow-xs"
              style={{ backgroundColor: rgbColorString }}
            />
            <span className="font-mono text-xs font-bold text-fg">{config.colorTemperatureKelvin}K</span>
          </div>
        </div>

        <input
          type="range"
          min="1800"
          max="9500"
          step="100"
          value={config.colorTemperatureKelvin}
          onChange={(e) => handleKelvinChange(parseInt(e.target.value, 10))}
          className="h-1.5 w-full cursor-pointer accent-accent"
        />
        <div className="flex justify-between text-[0.62rem] text-fg-3">
          <span>촛불 (1800K)</span>
          <span>노을 (3200K)</span>
          <span>정오 태양 (5500K)</span>
          <span>푸른 달빛 (8500K)</span>
        </div>
      </div>

      {/* Manual Fine Tuning */}
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-card p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[0.68rem] text-fg-2">망점 선수 (LPI Density):</span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="20"
              max="85"
              step="5"
              value={config.frequencyLpi}
              onChange={(e) => {
                const next = { ...config, frequencyLpi: parseInt(e.target.value, 10) };
                setConfig(next);
                onApplyScreentoneConfig?.(next);
              }}
              className="h-1.5 w-24 cursor-pointer accent-accent"
            />
            <span className="w-8 text-right font-mono text-xs font-bold text-fg">{config.frequencyLpi}L</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[0.68rem] text-fg-2">스크린톤 각도:</span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="0"
              max="90"
              step="15"
              value={config.angleDegrees}
              onChange={(e) => {
                const next = { ...config, angleDegrees: parseInt(e.target.value, 10) };
                setConfig(next);
                onApplyScreentoneConfig?.(next);
              }}
              className="h-1.5 w-24 cursor-pointer accent-accent"
            />
            <span className="w-8 text-right font-mono text-xs font-bold text-fg">{config.angleDegrees}°</span>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onApplyScreentoneConfig?.(config)}
        className="flex items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-[0.72rem] font-bold text-accent-fg shadow-sm transition-all hover:bg-accent/90"
      >
        <Sparkles className="size-3.5" />
        <span>3D 장면에 스크린톤 셰이더 적용</span>
      </button>
    </div>
  );
}
