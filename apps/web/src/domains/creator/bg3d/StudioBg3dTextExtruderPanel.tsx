import { Type, Sparkles } from "lucide-react";
import { useState } from "react";

import {
  SFX_ONOPATOPOEIA_PRESETS,
  plan3dTextExtrusion,
  type SfxStyleKind,
  type SfxPreset,
  type ExtrudedTextMeshSpec,
} from "../scene-3d/studio-3d-text-extruder";

export interface StudioBg3dTextExtruderPanelProps {
  readonly onApplyText?: (spec: ExtrudedTextMeshSpec) => void;
  readonly disabled?: boolean;
}

export function StudioBg3dTextExtruderPanel({
  onApplyText,
  disabled = false,
}: StudioBg3dTextExtruderPanelProps) {
  const [inputText, setInputText] = useState("쾅!!");
  const [selectedStyle, setSelectedStyle] = useState<SfxStyleKind>("manga-impact");
  const [extrudeDepth, setExtrudeDepth] = useState(0.4);
  const [bevelThickness, setBevelThickness] = useState(0.08);
  const [arcAngle, setArcAngle] = useState(15);
  const [letterSpacing, setLetterSpacing] = useState(0.1);

  const handleSelectPreset = (preset: SfxPreset) => {
    setInputText(preset.text);
    setSelectedStyle(preset.defaultStyle);
  };

  const handleGenerate = () => {
    const spec = plan3dTextExtrusion({
      text: inputText,
      fontStyle: selectedStyle,
      extrudeDepth,
      bevelThickness,
      bevelSegments: 2,
      arcAngleDegrees: arcAngle,
      letterSpacing,
      size: 1.0,
    });
    onApplyText?.(spec);
  };

  return (
    <div className="flex flex-col gap-3 p-3 text-xs text-fg">
      {/* SFX Quick Presets */}
      <div>
        <span className="mb-1.5 block text-[0.7rem] font-semibold text-fg-2">
          웹툰 액션/감정 효과음 프리셋 (원클릭)
        </span>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {SFX_ONOPATOPOEIA_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              onClick={() => handleSelectPreset(preset)}
              className={`flex flex-col items-center justify-center rounded-lg border p-1.5 transition-all ${
                inputText === preset.text
                  ? "border-accent bg-accent/15 text-accent shadow-sm"
                  : "border-line bg-card text-fg hover:bg-raised"
              }`}
            >
              <span className="text-xs font-black">{preset.text}</span>
              <span className="text-[0.6rem] text-fg-3">{preset.category}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Text Input & Custom Settings */}
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-card/60 p-2.5">
        <div className="flex items-center gap-2">
          <Type className="size-4 text-accent" />
          <input
            type="text"
            value={inputText}
            disabled={disabled}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="효과음 또는 3D 문구 입력..."
            className="flex-1 rounded-md border border-line bg-raised px-2 py-1 text-xs font-bold text-fg focus:border-accent focus:outline-none"
          />
        </div>

        {/* Style Selector */}
        <div>
          <span className="mb-1 block text-[0.68rem] text-fg-2">효과음 폰트 스타일:</span>
          <div className="grid grid-cols-3 gap-1">
            {[
              { id: "manga-impact", label: "타격 임팩트 (두꺼움)" },
              { id: "brush-speed", label: "속도 붓터치 (기울임)" },
              { id: "sharp-slashing", label: "검격 베기 (날카로움)" },
              { id: "comic-bubble", label: "동글 말풍선 (캐주얼)" },
              { id: "electric-spark", label: "전기 지직 (지그재그)" },
              { id: "blocky-heavy", label: "블록 묵직함 (초중량)" },
            ].map((style) => (
              <button
                key={style.id}
                type="button"
                disabled={disabled}
                onClick={() => setSelectedStyle(style.id as SfxStyleKind)}
                className={`rounded border p-1 text-center text-[0.62rem] font-semibold transition-all ${
                  selectedStyle === style.id
                    ? "border-accent bg-accent text-accent-fg"
                    : "border-line bg-card text-fg-2 hover:bg-raised"
                }`}
              >
                {style.label}
              </button>
            ))}
          </div>
        </div>

        {/* Sliders: Extrude Depth, Bevel, Letter Spacing & Arc Bending */}
        <div className="mt-1 flex flex-col gap-2 border-t border-line/50 pt-2">
          <div className="flex items-center justify-between">
            <span className="text-[0.68rem] text-fg-2">입체 두께 (Extrude):</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0.1"
                max="1.5"
                step="0.05"
                value={extrudeDepth}
                onChange={(e) => setExtrudeDepth(Number(e.target.value))}
                className="h-1.5 w-24 cursor-pointer accent-accent"
              />
              <span className="w-8 text-right font-mono text-xs font-bold text-fg">
                {extrudeDepth.toFixed(2)}m
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[0.68rem] text-fg-2">베벨 모따기 (Bevel):</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0.0"
                max="0.2"
                step="0.02"
                value={bevelThickness}
                onChange={(e) => setBevelThickness(Number(e.target.value))}
                className="h-1.5 w-24 cursor-pointer accent-accent"
              />
              <span className="w-8 text-right font-mono text-xs font-bold text-fg">
                {bevelThickness.toFixed(2)}m
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[0.68rem] text-fg-2">자간 간격 (Spacing):</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0.0"
                max="0.5"
                step="0.05"
                value={letterSpacing}
                onChange={(e) => setLetterSpacing(Number(e.target.value))}
                className="h-1.5 w-24 cursor-pointer accent-accent"
              />
              <span className="w-8 text-right font-mono text-xs font-bold text-fg">
                {letterSpacing.toFixed(2)}m
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[0.68rem] text-fg-2">곡선 휘어짐 (Arc):</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="-60"
                max="60"
                step="5"
                value={arcAngle}
                onChange={(e) => setArcAngle(Number(e.target.value))}
                className="h-1.5 w-24 cursor-pointer accent-accent"
              />
              <span className="w-8 text-right font-mono text-xs font-bold text-fg">
                {arcAngle}°
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Generate 3D Text */}
      <button
        type="button"
        disabled={disabled || !inputText.trim()}
        onClick={handleGenerate}
        className="flex items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-[0.72rem] font-bold text-accent-fg shadow-sm transition-all hover:bg-accent/90 disabled:opacity-50"
      >
        <Sparkles className="size-3.5" />
        <span>3D 텍스트 / 효과음 씬에 추가</span>
      </button>
    </div>
  );
}
