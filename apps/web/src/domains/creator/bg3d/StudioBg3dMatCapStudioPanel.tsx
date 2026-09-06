import { useState } from "react";

import {
  STYLIZED_SHADER_PRESETS,
  type StylizedShaderKind,
  type StylizedShaderPreset,
} from "../scene-3d/studio-3d-matcap-shader-system";

export interface StudioBg3dMatCapStudioPanelProps {
  readonly onApplyShader?: (preset: StylizedShaderPreset) => void;
  readonly disabled?: boolean;
}

export function StudioBg3dMatCapStudioPanel({
  onApplyShader,
  disabled = false,
}: StudioBg3dMatCapStudioPanelProps) {
  const [activeCategory, setActiveCategory] = useState<"all" | "toon" | "clay" | "material" | "special">("all");
  const [selectedPresetId, setSelectedPresetId] = useState<StylizedShaderKind>("anime-cel-toon");

  const presetList = Object.values(STYLIZED_SHADER_PRESETS).filter(
    (p) => activeCategory === "all" || p.category === activeCategory
  );

  const selectedPreset = STYLIZED_SHADER_PRESETS[selectedPresetId];

  const handleSelect = (preset: StylizedShaderPreset) => {
    setSelectedPresetId(preset.id);
    onApplyShader?.(preset);
  };

  return (
    <div className="flex flex-col gap-3 p-3 text-xs text-fg">
      {/* Category Tabs */}
      <div className="grid grid-cols-4 gap-1 rounded-lg border border-line bg-card p-1">
        {[
          { id: "all" as const, label: "전체" },
          { id: "toon" as const, label: "툰·셀" },
          { id: "clay" as const, label: "클레이" },
          { id: "material" as const, label: "PBR·유리" },
        ].map((cat) => (
          <button
            key={cat.id}
            type="button"
            disabled={disabled}
            onClick={() => setActiveCategory(cat.id)}
            className={`rounded-md py-1 text-[0.65rem] font-bold transition-all ${
              activeCategory === cat.id
                ? "bg-raised text-fg shadow-sm border border-line"
                : "text-fg-3 hover:text-fg"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Preset Grid */}
      <div className="grid grid-cols-2 gap-1.5">
        {presetList.map((preset) => {
          const isSelected = selectedPresetId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              onClick={() => handleSelect(preset)}
              className={`flex flex-col gap-1 rounded-lg border p-2 text-left transition-all ${
                isSelected
                  ? "border-accent bg-accent/15 text-accent shadow-sm"
                  : "border-line bg-card text-fg hover:bg-raised"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="truncate text-[0.68rem] font-bold">{preset.name.split(" ")[0]}</span>
                <span
                  className="size-3 rounded-full border border-line"
                  style={{ backgroundColor: preset.baseColor }}
                />
              </div>
              <span className="truncate text-[0.6rem] text-fg-3">{preset.description}</span>
            </button>
          );
        })}
      </div>

      {/* Selected Shader Properties */}
      {selectedPreset && (
        <div className="flex flex-col gap-2 rounded-lg border border-line/70 bg-card p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[0.68rem] font-bold text-fg">{selectedPreset.name}</span>
            <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[0.6rem] font-semibold text-accent">
              {selectedPreset.category.toUpperCase()}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 border-t border-line/50 pt-2 text-[0.65rem]">
            <div className="flex items-center justify-between">
              <span className="text-fg-3">음영 단계:</span>
              <span className="font-mono font-bold text-fg">{selectedPreset.shadowSteps}단 Step</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-fg-3">림라이트:</span>
              <span className="font-mono font-bold text-fg">{selectedPreset.rimLightIntensity}x</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-fg-3">투과도 (Glass):</span>
              <span className="font-mono font-bold text-fg">
                {Math.round(selectedPreset.transmission * 100)}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-fg-3">금속도 / 거칠기:</span>
              <span className="font-mono font-bold text-fg">
                {selectedPreset.metalness} / {selectedPreset.roughness}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
