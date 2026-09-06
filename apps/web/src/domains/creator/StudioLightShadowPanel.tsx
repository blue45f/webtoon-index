/**
 * Studio 3D 광원 및 그림자 컨트롤러 UI 패널(Light & Shadow Gizmo Panel).
 *
 * 구체(Spherical) 방위각/고도각 슬라이더, 그림자 농도/퍼짐 조절, 무드 프리셋 칩을 제공하여
 * 3D 씬의 광원 방향·그림자 파라미터를 실시간으로 조작한다.
 */

import { Lightbulb, RotateCcw, Sun } from "lucide-react";
import { useState } from "react";

import {
  computeShadowConfigFromLight,
  STUDIO_MOOD_LIGHTING_PRESETS,
  type StudioLightDirection,
  type StudioShadowConfig,
} from "./studio-light-shadow-gizmo";
import {
  StudioPanelChip,
  StudioSectionHeader,
  StudioSliderRow,
} from "./studio-panel-ui";

import type { ReactElement } from "react";

import { buttonClass } from "@/shared/components/ui/button-utils";

export interface StudioLightShadowPanelProps {
  /** 현재 광원 방향(Azimuth + Elevation). */
  readonly lightDirection: StudioLightDirection;
  /** 광원 방향 변경 콜백. */
  readonly onLightDirectionChange: (dir: StudioLightDirection) => void;
  /** 현재 그림자 설정. */
  readonly shadowConfig: StudioShadowConfig;
  /** 그림자 설정 변경 콜백. */
  readonly onShadowConfigChange: (config: StudioShadowConfig) => void;
}

export function StudioLightShadowPanel({
  lightDirection,
  onLightDirectionChange,
  shadowConfig,
  onShadowConfigChange,
}: StudioLightShadowPanelProps): ReactElement {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handlePresetApply = (presetId: string) => {
    const preset = STUDIO_MOOD_LIGHTING_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const dir: StudioLightDirection = {
      azimuthDeg: preset.azimuthDeg,
      elevationDeg: preset.elevationDeg,
    };
    onLightDirectionChange(dir);
    onShadowConfigChange(
      computeShadowConfigFromLight(dir, preset.shadowOpacity, preset.shadowBlurPx),
    );
  };

  const handleReset = () => {
    const defaultDir: StudioLightDirection = { azimuthDeg: 30, elevationDeg: 60 };
    onLightDirectionChange(defaultDir);
    onShadowConfigChange(computeShadowConfigFromLight(defaultDir, 0.6, 4));
  };

  return (
    <div className="space-y-3">
      <StudioSectionHeader
        title="광원·그림자"
        description="방위각/고도각으로 광원 방향을 조절하고, 그림자 농도·퍼짐을 커스터마이징하세요."
        action={
          <button
            type="button"
            onClick={handleReset}
            className={buttonClass({ size: "sm", variant: "quiet", className: "gap-1" })}
            title="광원·그림자 초기화"
          >
            <RotateCcw size={13} aria-hidden /> 초기화
          </button>
        }
      />

      {/* 무드 프리셋 */}
      <div className="space-y-1">
        <span className="text-xs font-semibold text-fg-2">
          <Lightbulb size={12} className="mr-1 inline-block align-[-2px]" aria-hidden />
          무드 프리셋
        </span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="무드 광원 프리셋">
          {STUDIO_MOOD_LIGHTING_PRESETS.map((preset) => (
            <StudioPanelChip
              key={preset.id}
              onClick={() => handlePresetApply(preset.id)}
              title={preset.label}
            >
              {preset.label}
            </StudioPanelChip>
          ))}
        </div>
      </div>

      {/* 광원 방향 슬라이더 */}
      <div className="space-y-2">
        <span className="text-xs font-semibold text-fg-2">
          <Sun size={12} className="mr-1 inline-block align-[-2px]" aria-hidden />
          광원 방향
        </span>
        <StudioSliderRow
          label="방위각(Azimuth)"
          min={0}
          max={360}
          step={1}
          value={Math.round(lightDirection.azimuthDeg)}
          onChange={(v) =>
            onLightDirectionChange({ ...lightDirection, azimuthDeg: v })
          }
          readout={`${Math.round(lightDirection.azimuthDeg)}°`}
        />
        <StudioSliderRow
          label="고도각(Elevation)"
          min={-90}
          max={90}
          step={1}
          value={Math.round(lightDirection.elevationDeg)}
          onChange={(v) =>
            onLightDirectionChange({ ...lightDirection, elevationDeg: v })
          }
          readout={`${Math.round(lightDirection.elevationDeg)}°`}
        />
      </div>

      {/* 그림자 설정 */}
      <div className="space-y-2">
        <span className="text-xs font-semibold text-fg-2">그림자</span>
        <StudioSliderRow
          label="그림자 농도"
          min={0}
          max={100}
          step={1}
          value={Math.round(shadowConfig.opacity * 100)}
          onChange={(v) =>
            onShadowConfigChange({ ...shadowConfig, opacity: v / 100 })
          }
          readout={`${Math.round(shadowConfig.opacity * 100)}%`}
        />
        <StudioSliderRow
          label="퍼짐(Blur)"
          min={0}
          max={24}
          step={1}
          value={shadowConfig.blurPx}
          onChange={(v) => onShadowConfigChange({ ...shadowConfig, blurPx: v })}
          readout={`${shadowConfig.blurPx}px`}
        />
      </div>

      {/* 고급 설정 토글 */}
      <button
        type="button"
        onClick={() => setShowAdvanced((prev) => !prev)}
        className="text-[0.7rem] text-accent hover:underline"
      >
        {showAdvanced ? "▲ 고급 설정 접기" : "▼ 고급 설정 펼치기"}
      </button>
      {showAdvanced ? (
        <div className="space-y-2 pl-1">
          <StudioSliderRow
            label="그림자 X 오프셋"
            min={-20}
            max={20}
            step={0.5}
            value={Math.round(shadowConfig.shadowVectorX * 10) / 10}
            onChange={(v) =>
              onShadowConfigChange({ ...shadowConfig, shadowVectorX: v })
            }
            readout={shadowConfig.shadowVectorX.toFixed(1)}
          />
          <StudioSliderRow
            label="그림자 Y 오프셋"
            min={-20}
            max={20}
            step={0.5}
            value={Math.round(shadowConfig.shadowVectorY * 10) / 10}
            onChange={(v) =>
              onShadowConfigChange({ ...shadowConfig, shadowVectorY: v })
            }
            readout={shadowConfig.shadowVectorY.toFixed(1)}
          />
        </div>
      ) : null}
    </div>
  );
}
