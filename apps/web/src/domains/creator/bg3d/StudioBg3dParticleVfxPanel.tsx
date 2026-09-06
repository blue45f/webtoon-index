import { Sparkles, Wind, Flame, CloudRain, Snowflake, Zap, Sun } from "lucide-react";
import { useState } from "react";

import {
  PARTICLE_VFX_PRESETS,
  type ParticleVfxPresetKind,
} from "../scene-3d/studio-3d-particle-system";

export interface StudioBg3dParticleVfxPanelProps {
  readonly onSelectPreset?: (preset: ParticleVfxPresetKind) => void;
  readonly disabled?: boolean;
}

export function StudioBg3dParticleVfxPanel({
  onSelectPreset,
  disabled = false,
}: StudioBg3dParticleVfxPanelProps) {
  const [selectedPreset, setSelectedPreset] = useState<ParticleVfxPresetKind>("sakura-petals");
  const [spawnIntensity, setSpawnIntensity] = useState(1.0);
  const [windForce, setWindForce] = useState(0.5);

  const presetsList: Array<{
    id: ParticleVfxPresetKind;
    icon: typeof Sparkles;
    label: string;
    sublabel: string;
    color: string;
  }> = [
    { id: "sakura-petals", icon: Wind, label: "벚꽃 잎날림", sublabel: "로맨스/청춘물", color: "#ffb7c5" },
    { id: "magic-stardust", icon: Sparkles, label: "마법 스타더스트", sublabel: "판타지/각성", color: "#70d6ff" },
    { id: "rain-splashes", icon: CloudRain, label: "비와 물보라", sublabel: "우천/클라이맥스", color: "#60a5fa" },
    { id: "snow-blizzard", icon: Snowflake, label: "눈보라", sublabel: "겨울/서스펜스", color: "#e2e8f0" },
    { id: "fire-embers", icon: Flame, label: "불꽃 파편", sublabel: "전투/화재씬", color: "#f97316" },
    { id: "action-speed-lines", icon: Zap, label: "3D 스피드 라인", sublabel: "타격/돌진", color: "#a855f7" },
    { id: "atmospheric-dust", icon: Sun, label: "공간 먼지/틴들", sublabel: "햇살/유적지", color: "#facc15" },
  ];

  const handleSelect = (presetId: ParticleVfxPresetKind) => {
    setSelectedPreset(presetId);
    onSelectPreset?.(presetId);
  };

  const currentCfg = PARTICLE_VFX_PRESETS[selectedPreset];

  return (
    <div className="flex flex-col gap-3 p-3 text-xs text-fg">
      <div>
        <span className="mb-1.5 block text-[0.7rem] font-semibold text-fg-2">
          웹툰 3D 파티클 & 대기 이펙트 프리셋
        </span>
        <div className="grid grid-cols-2 gap-1.5">
          {presetsList.map((item) => {
            const Icon = item.icon;
            const isSelected = selectedPreset === item.id;
            return (
              <button
                key={item.id}
                type="button"
                disabled={disabled}
                onClick={() => handleSelect(item.id)}
                className={`flex items-center gap-2 rounded-lg border p-2 text-left transition-all ${
                  isSelected
                    ? "border-accent bg-accent/15 text-accent shadow-sm"
                    : "border-line bg-card text-fg hover:bg-raised"
                }`}
              >
                <div
                  className="flex size-7 shrink-0 items-center justify-center rounded-md"
                  style={{ backgroundColor: `${item.color}25`, color: item.color }}
                >
                  <Icon className="size-4" />
                </div>
                <div className="flex flex-col overflow-hidden">
                  <span className="truncate text-[0.68rem] font-bold">{item.label}</span>
                  <span className="truncate text-[0.6rem] text-fg-3">{item.sublabel}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Preset Details & Realtime Tuning */}
      {currentCfg && (
        <div className="flex flex-col gap-2 rounded-lg border border-line/70 bg-card p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[0.68rem] font-bold text-fg">{currentCfg.name}</span>
            <span
              className="size-3 rounded-full border border-line"
              style={{ backgroundColor: currentCfg.baseColor }}
            />
          </div>
          <p className="text-[0.62rem] text-fg-3">{currentCfg.description}</p>

          <div className="mt-1 flex flex-col gap-2 border-t border-line/50 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-[0.68rem] text-fg-2">발생 밀도 (Density):</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.2"
                  max="2.5"
                  step="0.1"
                  value={spawnIntensity}
                  onChange={(e) => setSpawnIntensity(Number(e.target.value))}
                  className="h-1.5 w-24 cursor-pointer accent-accent"
                />
                <span className="w-8 text-right font-mono text-xs font-bold text-fg">
                  {Math.round(spawnIntensity * 100)}%
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[0.68rem] text-fg-2">바람 세기 (Wind):</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.0"
                  max="2.0"
                  step="0.1"
                  value={windForce}
                  onChange={(e) => setWindForce(Number(e.target.value))}
                  className="h-1.5 w-24 cursor-pointer accent-accent"
                />
                <span className="w-8 text-right font-mono text-xs font-bold text-fg">
                  {windForce.toFixed(1)}x
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
