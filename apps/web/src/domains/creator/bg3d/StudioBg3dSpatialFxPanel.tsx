import { Sparkles, Zap, Volume2, Plus } from "lucide-react";
import { useState, useId } from "react";

import {
  Studio3DSpatialFxEngine,
  type SfxTextPreset,
  type SpatialSfxTypographyConfig,
  type SpatialSpeedLineConfig,
} from "../scene-3d/studio-3d-spatial-fx";

export interface StudioBg3dSpatialFxPanelProps {
  readonly onInsertSpeedLines?: (config: SpatialSpeedLineConfig) => void;
  readonly onInsertSfxTypography?: (config: SpatialSfxTypographyConfig) => void;
  readonly disabled?: boolean;
}

const SFX_PRESETS: readonly SfxTextPreset[] = [
  "쿵",
  "쾅",
  "촤아악",
  "번쩍",
  "스윽",
  "두근",
  "콰앙",
  "파지지직",
];

export function StudioBg3dSpatialFxPanel({
  onInsertSpeedLines,
  onInsertSfxTypography,
  disabled = false,
}: StudioBg3dSpatialFxPanelProps) {
  const engine = new Studio3DSpatialFxEngine();
  const idPrefix = useId();
  const [activeTab, setActiveTab] = useState<"sfx" | "speedlines">("sfx");

  // Speed lines state
  const [rayCount, setRayCount] = useState(32);
  const [innerRadius, setInnerRadius] = useState(1.5);
  const [outerRadius, setOuterRadius] = useState(6.0);
  const [lineColor, setLineColor] = useState("#000000");
  const [lineOpacity, setLineOpacity] = useState(0.9);

  // SFX state
  const [selectedPreset, setSelectedPreset] = useState<SfxTextPreset>("쾅");
  const [customText, setCustomText] = useState("");
  const [sfxScale, setSfxScale] = useState(1.5);
  const [sfxDepth, setSfxDepth] = useState(0.2);
  const [sfxFillColor, setSfxFillColor] = useState("#ffbe0b");
  const [sfxOutlineColor, setSfxOutlineColor] = useState("#3a0ca3");

  const handleApplySfxPreset = (preset: SfxTextPreset) => {
    setSelectedPreset(preset);
    const cfg = engine.createSfxPreset(preset);
    setSfxFillColor(cfg.fillColorHex);
    setSfxOutlineColor(cfg.outlineColorHex);
    setSfxDepth(cfg.extrusionDepth);
  };

  const handleInsertSfx = () => {
    const textToUse = customText.trim() || selectedPreset;
    onInsertSfxTypography?.({
      id: `sfx-${Date.now()}`,
      text: textToUse,
      position: [0, 1.5, 0],
      rotationDeg: [0, 0, 0],
      scale: sfxScale,
      extrusionDepth: sfxDepth,
      fillColorHex: sfxFillColor,
      outlineColorHex: sfxOutlineColor,
      outlineWidth: 2.5,
      motionBlurTrail: false,
    });
  };

  const handleInsertSpeedLines = () => {
    onInsertSpeedLines?.({
      center: [0, 1.5, 0],
      rayCount,
      innerRadius,
      outerRadius,
      lineThickness: 2.0,
      colorHex: lineColor,
      opacity: lineOpacity,
    });
  };

  const customTextId = `${idPrefix}-custom-text`;
  const sfxFillId = `${idPrefix}-sfx-fill`;
  const sfxOutlineId = `${idPrefix}-sfx-outline`;
  const sfxScaleId = `${idPrefix}-sfx-scale`;
  const sfxDepthId = `${idPrefix}-sfx-depth`;
  const rayCountId = `${idPrefix}-ray-count`;
  const innerRadiusId = `${idPrefix}-inner-radius`;
  const outerRadiusId = `${idPrefix}-outer-radius`;
  const lineColorId = `${idPrefix}-line-color`;
  const lineOpacityId = `${idPrefix}-line-opacity`;

  return (
    <div className="flex flex-col gap-3 p-3 text-xs text-fg">
      {/* Header Tabs */}
      <div className="flex rounded-lg border border-line bg-card p-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setActiveTab("sfx")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-colors ${
            activeTab === "sfx" ? "bg-raised text-fg shadow-sm" : "text-fg-3 hover:text-fg"
          }`}
        >
          <Volume2 className="h-3.5 w-3.5" />
          3D 입체 효과음 (SFX)
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setActiveTab("speedlines")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-colors ${
            activeTab === "speedlines" ? "bg-raised text-fg shadow-sm" : "text-fg-3 hover:text-fg"
          }`}
        >
          <Zap className="h-3.5 w-3.5" />
          3D 원근 집중선
        </button>
      </div>

      {activeTab === "sfx" ? (
        <div className="flex flex-col gap-3">
          <div>
            <span className="mb-1.5 block text-[0.7rem] font-semibold text-fg-2">
              웹툰 효과음 프리셋 선택
            </span>
            <div className="grid grid-cols-4 gap-1.5">
              {SFX_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={disabled}
                  onClick={() => handleApplySfxPreset(preset)}
                  className={`rounded-lg border px-2 py-1.5 text-center text-xs font-black transition-colors ${
                    selectedPreset === preset
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-line bg-card text-fg hover:border-line-strong hover:bg-raised"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor={customTextId} className="mb-1 block text-[0.7rem] font-semibold text-fg-2">
              직접 입력 (선택 사항)
            </label>
            <input
              id={customTextId}
              type="text"
              value={customText}
              disabled={disabled}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder={`기본값: ${selectedPreset}`}
              className="w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={sfxFillId} className="mb-1 block text-[0.7rem] font-medium text-fg-3">
                채우기 색상
              </label>
              <div className="flex items-center gap-2">
                <input
                  id={sfxFillId}
                  type="color"
                  value={sfxFillColor}
                  disabled={disabled}
                  onChange={(e) => setSfxFillColor(e.target.value)}
                  className="h-7 w-10 cursor-pointer rounded border border-line bg-card p-0.5"
                />
                <span className="text-[0.7rem] font-mono">{sfxFillColor}</span>
              </div>
            </div>
            <div>
              <label htmlFor={sfxOutlineId} className="mb-1 block text-[0.7rem] font-medium text-fg-3">
                외곽선 색상
              </label>
              <div className="flex items-center gap-2">
                <input
                  id={sfxOutlineId}
                  type="color"
                  value={sfxOutlineColor}
                  disabled={disabled}
                  onChange={(e) => setSfxOutlineColor(e.target.value)}
                  className="h-7 w-10 cursor-pointer rounded border border-line bg-card p-0.5"
                />
                <span className="text-[0.7rem] font-mono">{sfxOutlineColor}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label htmlFor={sfxScaleId} className="text-[0.7rem] font-medium text-fg-3">크기 (배율)</label>
                <span className="font-mono text-[0.7rem]">{sfxScale.toFixed(1)}x</span>
              </div>
              <input
                id={sfxScaleId}
                type="range"
                min={0.5}
                max={4.0}
                step={0.1}
                value={sfxScale}
                disabled={disabled}
                onChange={(e) => setSfxScale(Number(e.target.value))}
                className="accent-accent"
              />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label htmlFor={sfxDepthId} className="text-[0.7rem] font-medium text-fg-3">입체 두께</label>
                <span className="font-mono text-[0.7rem]">{sfxDepth.toFixed(2)}m</span>
              </div>
              <input
                id={sfxDepthId}
                type="range"
                min={0.02}
                max={1.0}
                step={0.02}
                value={sfxDepth}
                disabled={disabled}
                onChange={(e) => setSfxDepth(Number(e.target.value))}
                className="accent-accent"
              />
            </div>
          </div>

          <button
            type="button"
            disabled={disabled}
            onClick={handleInsertSfx}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-accent bg-accent px-3 py-2 text-xs font-bold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-45"
          >
            <Plus className="h-4 w-4" />
            3D 씬에 입체 효과음 추가
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label htmlFor={rayCountId} className="text-[0.7rem] font-medium text-fg-3">집중선 가닥 수</label>
              <span className="font-mono text-[0.7rem]">{rayCount}개</span>
            </div>
            <input
              id={rayCountId}
              type="range"
              min={8}
              max={96}
              step={4}
              value={rayCount}
              disabled={disabled}
              onChange={(e) => setRayCount(Number(e.target.value))}
              className="accent-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label htmlFor={innerRadiusId} className="text-[0.7rem] font-medium text-fg-3">내부 반경</label>
                <span className="font-mono text-[0.7rem]">{innerRadius.toFixed(1)}m</span>
              </div>
              <input
                id={innerRadiusId}
                type="range"
                min={0.2}
                max={5.0}
                step={0.2}
                value={innerRadius}
                disabled={disabled}
                onChange={(e) => setInnerRadius(Number(e.target.value))}
                className="accent-accent"
              />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label htmlFor={outerRadiusId} className="text-[0.7rem] font-medium text-fg-3">외부 반경</label>
                <span className="font-mono text-[0.7rem]">{outerRadius.toFixed(1)}m</span>
              </div>
              <input
                id={outerRadiusId}
                type="range"
                min={2.0}
                max={20.0}
                step={0.5}
                value={outerRadius}
                disabled={disabled}
                onChange={(e) => setOuterRadius(Number(e.target.value))}
                className="accent-accent"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={lineColorId} className="mb-1 block text-[0.7rem] font-medium text-fg-3">
                선 색상
              </label>
              <div className="flex items-center gap-2">
                <input
                  id={lineColorId}
                  type="color"
                  value={lineColor}
                  disabled={disabled}
                  onChange={(e) => setLineColor(e.target.value)}
                  className="h-7 w-10 cursor-pointer rounded border border-line bg-card p-0.5"
                />
                <span className="text-[0.7rem] font-mono">{lineColor}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label htmlFor={lineOpacityId} className="text-[0.7rem] font-medium text-fg-3">불투명도</label>
                <span className="font-mono text-[0.7rem]">{(lineOpacity * 100).toFixed(0)}%</span>
              </div>
              <input
                id={lineOpacityId}
                type="range"
                min={0.1}
                max={1.0}
                step={0.05}
                value={lineOpacity}
                disabled={disabled}
                onChange={(e) => setLineOpacity(Number(e.target.value))}
                className="accent-accent"
              />
            </div>
          </div>

          <button
            type="button"
            disabled={disabled}
            onClick={handleInsertSpeedLines}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-accent bg-accent px-3 py-2 text-xs font-bold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-45"
          >
            <Sparkles className="h-4 w-4" />
            3D 씬에 집중선 배치
          </button>
        </div>
      )}
    </div>
  );
}
