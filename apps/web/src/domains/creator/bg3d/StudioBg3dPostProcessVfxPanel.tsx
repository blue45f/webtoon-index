import { Aperture, Sparkles, Sun, Palette } from "lucide-react";
import React, { useState } from "react";

import {
  COLOR_GRADING_PRESETS,
  DEFAULT_POSTPROCESS_CONFIG,
  type PostProcessVfxPipelineConfig,
  type ColorGradingPresetId,
} from "../scene-3d/studio-3d-postprocess-vfx-pipeline";

export interface StudioBg3dPostProcessVfxPanelProps {
  readonly onApplyPostProcessConfig?: (config: PostProcessVfxPipelineConfig) => void;
}

export function StudioBg3dPostProcessVfxPanel({
  onApplyPostProcessConfig,
}: StudioBg3dPostProcessVfxPanelProps): React.JSX.Element {
  const [config, setConfig] = useState<PostProcessVfxPipelineConfig>(DEFAULT_POSTPROCESS_CONFIG);

  const handleLutSelect = (lutId: ColorGradingPresetId) => {
    const next = { ...config, colorGrading: lutId };
    setConfig(next);
    onApplyPostProcessConfig?.(next);
  };

  const handleToggleDof = () => {
    const next = { ...config, dof: { ...config.dof, enabled: !config.dof.enabled } };
    setConfig(next);
    onApplyPostProcessConfig?.(next);
  };

  const handleToggleBloom = () => {
    const next = { ...config, bloom: { ...config.bloom, enabled: !config.bloom.enabled } };
    setConfig(next);
    onApplyPostProcessConfig?.(next);
  };

  return (
    <div className="flex flex-col gap-3 p-3 text-xs text-fg">
      <div className="flex items-center justify-between border-b border-line pb-2">
        <div className="flex items-center gap-1.5 font-bold text-fg">
          <Aperture className="size-4 text-accent" />
          <span>렌즈 VFX & 시네마틱 후가공 (PostFX)</span>
        </div>
        <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[0.68rem] text-accent font-semibold">
          LUT: {config.colorGrading}
        </span>
      </div>

      {/* Color Grading Presets */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[0.68rem] font-medium text-fg-3">컬러 그레이딩 무드 (Color LUT)</span>
        <div className="grid grid-cols-2 gap-1.5">
          {COLOR_GRADING_PRESETS.map((lut) => (
            <button
              key={lut.id}
              type="button"
              onClick={() => handleLutSelect(lut.id)}
              className={`flex flex-col items-start rounded-lg border p-2 text-left transition-all ${
                config.colorGrading === lut.id
                  ? "border-accent bg-accent/10 font-bold text-accent shadow-sm"
                  : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
              }`}
            >
              <div className="flex items-center gap-1">
                <Palette className="size-3 text-accent" />
                <span className="text-[0.72rem] leading-tight">{lut.name}</span>
              </div>
              <span className="mt-0.5 text-[0.62rem] text-fg-3 line-clamp-1">{lut.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Depth of Field (DoF Bokeh) Section */}
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-card p-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-bold text-fg">
            <Aperture className="size-3.5 text-accent" />
            <span className="text-[0.7rem]">카메라 피사계 심도 (DoF Bokeh)</span>
          </div>
          <button
            type="button"
            onClick={handleToggleDof}
            className={`rounded px-2 py-0.5 font-mono text-[0.65rem] font-bold transition-all ${
              config.dof.enabled
                ? "bg-accent text-accent-fg"
                : "border border-line bg-raised text-fg-2 hover:text-fg"
            }`}
          >
            {config.dof.enabled ? "활성화 ON" : "비활성 OFF"}
          </button>
        </div>

        {config.dof.enabled && (
          <div className="flex flex-col gap-1.5 pt-1 border-t border-line/60">
            <div className="flex items-center justify-between">
              <span className="text-[0.68rem] text-fg-2">초점 거리 (Focus Dist):</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.5"
                  max="20"
                  step="0.5"
                  value={config.dof.focusDistance}
                  onChange={(e) => {
                    const next = {
                      ...config,
                      dof: { ...config.dof, focusDistance: parseFloat(e.target.value) },
                    };
                    setConfig(next);
                    onApplyPostProcessConfig?.(next);
                  }}
                  className="h-1.5 w-24 cursor-pointer accent-accent"
                />
                <span className="w-10 text-right font-mono text-xs font-bold text-fg">
                  {config.dof.focusDistance}m
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[0.68rem] text-fg-2">조리개 수치 (Aperture):</span>
              <div className="flex items-center gap-1">
                {[1.4, 2.8, 4.0, 8.0].map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      const next = { ...config, dof: { ...config.dof, fStop: f } };
                      setConfig(next);
                      onApplyPostProcessConfig?.(next);
                    }}
                    className={`rounded px-1.5 py-0.5 font-mono text-[0.65rem] font-bold ${
                      config.dof.fStop === f
                        ? "bg-accent text-accent-fg"
                        : "border border-line bg-raised text-fg-2 hover:text-fg"
                    }`}
                  >
                    f/{f}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bloom Glow Section */}
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-card p-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-bold text-fg">
            <Sun className="size-3.5 text-accent" />
            <span className="text-[0.7rem]">발광 블룸 글로우 (Bloom Glow)</span>
          </div>
          <button
            type="button"
            onClick={handleToggleBloom}
            className={`rounded px-2 py-0.5 font-mono text-[0.65rem] font-bold transition-all ${
              config.bloom.enabled
                ? "bg-accent text-accent-fg"
                : "border border-line bg-raised text-fg-2 hover:text-fg"
            }`}
          >
            {config.bloom.enabled ? "활성화 ON" : "비활성 OFF"}
          </button>
        </div>

        {config.bloom.enabled && (
          <div className="flex items-center justify-between pt-1 border-t border-line/60">
            <span className="text-[0.68rem] text-fg-2">글로우 강도:</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0.2"
                max="3.0"
                step="0.1"
                value={config.bloom.intensity}
                onChange={(e) => {
                  const next = {
                    ...config,
                    bloom: { ...config.bloom, intensity: parseFloat(e.target.value) },
                  };
                  setConfig(next);
                  onApplyPostProcessConfig?.(next);
                }}
                className="h-1.5 w-24 cursor-pointer accent-accent"
              />
              <span className="w-8 text-right font-mono text-xs font-bold text-fg">
                {config.bloom.intensity}x
              </span>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onApplyPostProcessConfig?.(config)}
        className="flex items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-[0.72rem] font-bold text-accent-fg shadow-sm transition-all hover:bg-accent/90"
      >
        <Sparkles className="size-3.5" />
        <span>3D 뷰포트에 렌즈 PostFX 적용</span>
      </button>
    </div>
  );
}
