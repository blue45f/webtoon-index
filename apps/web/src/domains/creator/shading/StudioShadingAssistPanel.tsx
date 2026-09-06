/**
 * StudioShadingAssistPanel.tsx
 *
 * CLIP STUDIO PAINT Ver.2.0 Parity:
 * - Shading Assist (자동 음영 어시스트):
 *   - Allows artists to position a virtual 2D directional or point light source around webtoon lineart.
 *   - 8-direction virtual light compass (↖, ↑, ↗, ←, ☼, →, ↙, ↓, ↘) + custom angle slider.
 *   - Ambient lighting temperature presets (Warm Dawn, Neutral Day, Cool Moon, Sunset Golden).
 *   - Light intensity (0..100%) and shadow softness (0% hard cel to 100% soft gradient).
 *   - Rim light toggle.
 *   - Interactive visual 2-step cel shadow preview indicator.
 *   - Direct generation of a non-destructive Multiply cel-shade shadow layer.
 */

import {
  Check,
  Compass,
  Layers,
  Moon,
  Sun,
  Sunset,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  LIGHT_DIRECTION_ANGLES_DEG,
  StudioAiShadingAssistEngine,
  type AmbientLightingTemperature,
  type ComputedShadingParams,
  type LightDirectionPreset,
  type LightSourceConfig,
} from "../ai/studio-ai-shading-assist";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

export interface StudioShadingAssistPanelProps {
  readonly onApplyShading?: (params: ComputedShadingParams) => void;
  readonly onGenerateShadingLayer?: (params: ComputedShadingParams) => void;
  readonly className?: string;
}

const DIRECTION_PRESETS: readonly {
  id: LightDirectionPreset;
  label: string;
  compassDir: string;
}[] = Object.freeze([
  { id: "top-left", label: "좌상단", compassDir: "↖" },
  { id: "top", label: "상단 정면", compassDir: "↑" },
  { id: "top-right", label: "우상단", compassDir: "↗" },
  { id: "left", label: "좌측광", compassDir: "←" },
  { id: "backlight-rim", label: "역광/림", compassDir: "☼" },
  { id: "right", label: "우측광", compassDir: "→" },
  { id: "bottom-left", label: "좌하단", compassDir: "↙" },
  { id: "bottom", label: "하단 언더", compassDir: "↓" },
  { id: "bottom-right", label: "우하단", compassDir: "↘" },
]);

const AMBIENT_TEMPERATURES: readonly {
  id: AmbientLightingTemperature;
  label: string;
  icon: typeof Sun;
  desc: string;
}[] = Object.freeze([
  { id: "warm-dawn", label: "새벽 햇살", icon: Sun, desc: "따뜻한 보라빛 그림자" },
  { id: "neutral-day", label: "주간 자연광", icon: Sun, desc: "표준 그레이 블루 음영" },
  { id: "cool-moon", label: "야간 달빛", icon: Moon, desc: "차가운 네이비 블루 음영" },
  { id: "sunset-golden", label: "노을 석양", icon: Sunset, desc: "붉은 와인빛 그림자" },
]);

const engine = new StudioAiShadingAssistEngine();

export function StudioShadingAssistPanel({
  onApplyShading,
  onGenerateShadingLayer,
  className,
}: StudioShadingAssistPanelProps) {
  const [direction, setDirection] = useState<LightDirectionPreset>("top-left");
  const [intensity, setIntensity] = useState(75);
  const [softness, setSoftness] = useState(20);
  const [temperature, setTemperature] =
    useState<AmbientLightingTemperature>("neutral-day");
  const [enableRimLight, setEnableRimLight] = useState(true);
  const [appliedNotice, setAppliedNotice] = useState(false);

  const config: LightSourceConfig = useMemo(
    () => ({
      direction,
      intensityPercent: intensity,
      softnessPercent: softness,
      temperature,
      enableRimLight,
    }),
    [direction, intensity, softness, temperature, enableRimLight],
  );

  const computed = useMemo<ComputedShadingParams>(
    () => engine.compute(config),
    [config],
  );

  const handleApply = () => {
    if (onApplyShading) {
      onApplyShading(computed);
    }
    if (onGenerateShadingLayer) {
      onGenerateShadingLayer(computed);
    }
    setAppliedNotice(true);
    setTimeout(() => setAppliedNotice(false), 2000);
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 p-3 text-xs bg-slate-900/90 text-slate-100 rounded-lg border border-slate-800 shadow-xl",
        className,
      )}
      data-testid="studio-shading-assist-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200">
          <Sun size={15} className="text-amber-400" />
          <span>자동 음영 어시스트 (Shading Assist)</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-medium">
            CSP 2.0
          </span>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 leading-relaxed">
        선화와 채색 레이어 위에 광원 각도와 환경광을 지정하여 웹툰 셀 명암 레이어를
        자동으로 생성합니다.
      </p>

      {/* 8-Direction Compass Buttons */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            <Compass size={13} className="text-amber-400" />
            <span>광원 방향 (Light Source)</span>
          </span>
          <span className="font-semibold text-slate-200">
            {LIGHT_DIRECTION_ANGLES_DEG[direction]}°
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1 text-center font-bold">
          {DIRECTION_PRESETS.map((p) => {
            const isSelected = direction === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setDirection(p.id)}
                className={buttonClass({
                  size: "sm",
                  variant: isSelected ? "solid" : "outline",
                  className: cn(
                    "h-7 text-[10px] px-1 transition-all",
                    isSelected
                      ? "bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold shadow-md shadow-amber-500/20"
                      : "border-slate-700 text-slate-300 hover:bg-slate-800",
                  ),
                })}
              >
                <span className="mr-1">{p.compassDir}</span>
                <span>{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Ambient Temperature Modes */}
      <div className="flex flex-col gap-1.5 pt-1">
        <span className="text-[11px] text-slate-400">분위기 환경광 (Ambient Mood)</span>
        <div className="grid grid-cols-2 gap-1.5">
          {AMBIENT_TEMPERATURES.map((temp) => {
            const isSelected = temperature === temp.id;
            const Icon = temp.icon;
            return (
              <button
                key={temp.id}
                type="button"
                onClick={() => setTemperature(temp.id)}
                className={cn(
                  "flex flex-col items-start p-1.5 rounded border text-left transition-colors",
                  isSelected
                    ? "bg-amber-950/40 border-amber-500/60 text-slate-100"
                    : "bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-200",
                )}
              >
                <div className="flex items-center gap-1 font-semibold text-[11px] text-slate-200">
                  <Icon size={12} className="text-amber-400" />
                  <span>{temp.label}</span>
                </div>
                <span className="text-[9px] text-slate-500 mt-0.5">{temp.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sliders: Intensity & Softness */}
      <div className="flex flex-col gap-2 pt-1 border-t border-slate-800">
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">명암 농도 (Intensity)</span>
            <span className="font-semibold text-slate-200">{intensity}%</span>
          </div>
          <input
            type="range"
            min={10}
            max={100}
            value={intensity}
            onChange={(e) => setIntensity(Number(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
          />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">그라데이션 부드러움 (Softness)</span>
            <span className="font-semibold text-slate-200">
              {softness === 0 ? "하드 셀(Hard)" : `${softness}%`}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={softness}
            onChange={(e) => setSoftness(Number(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
          />
        </div>
      </div>

      {/* Rim Light Checkbox & Preview Colors */}
      <div className="flex items-center justify-between pt-1 border-t border-slate-800 text-[11px]">
        <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
          <input
            type="checkbox"
            checked={enableRimLight}
            onChange={(e) => setEnableRimLight(e.target.checked)}
            className="rounded accent-amber-400"
          />
          <span>외곽 림 라이트 (Rim Light) 포함</span>
        </label>
        <div className="flex items-center gap-1.5">
          <div
            className="size-3.5 rounded-full border border-white/20 shadow-sm"
            style={{ backgroundColor: computed.shadow1ColorHex }}
            title={`그림자 1단계: ${computed.shadow1ColorHex}`}
          />
          <div
            className="size-3.5 rounded-full border border-white/20 shadow-sm"
            style={{ backgroundColor: computed.shadow2ColorHex }}
            title={`그림자 2단계: ${computed.shadow2ColorHex}`}
          />
          {computed.rimLightColorHex && (
            <div
              className="size-3.5 rounded-full border border-white/20 shadow-sm"
              style={{ backgroundColor: computed.rimLightColorHex }}
              title={`림 라이트: ${computed.rimLightColorHex}`}
            />
          )}
        </div>
      </div>

      {/* Action Button: Generate Shading Layer */}
      <button
        type="button"
        onClick={handleApply}
        className={buttonClass({
          size: "sm",
          variant: "solid",
          className:
            "w-full h-8 mt-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold gap-1.5 transition-all shadow-md shadow-amber-500/20",
        })}
      >
        {appliedNotice ? (
          <>
            <Check size={14} />
            <span>음영 생성 완료!</span>
          </>
        ) : (
          <>
            <Layers size={14} />
            <span>음영 어시스트 레이어 생성 (CSP 2.0)</span>
          </>
        )}
      </button>
    </div>
  );
}
