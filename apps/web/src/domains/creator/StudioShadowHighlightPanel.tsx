/**
 * Studio Shadow/Highlight Panel
 * 선택된 이미지의 섀도우/하이라이트(Shadow/Highlight) 보정 인스펙터 — 원클릭 명암 복구 프리셋 +
 * 섀도우/하이라이트 양·톤 범위, 미드톤 대비 슬라이더.
 * studio-shadow-highlight 엔진의 ShadowHighlight를 props로 읽고 onPatch/onApplyPreset/onReset으로만 쓴다.
 * StudioPage에서 분리한 순수 프레젠테이션 컴포넌트(상태 없음).
 */
import { RotateCcw } from "lucide-react";

import { StudioPanelChip, StudioSliderRow } from "./studio-panel-ui";
import {
  SHADOW_HIGHLIGHT_AMOUNT_RANGE,
  SHADOW_HIGHLIGHT_MIDTONE_RANGE,
  SHADOW_HIGHLIGHT_PRESETS,
  SHADOW_HIGHLIGHT_WIDTH_RANGE,
  isIdentityShadowHighlight,
  type ShadowHighlight,
} from "./studio-shadow-highlight";

import { buttonClass } from "@/shared/components/ui/button-utils";


// 슬라이더 정의 — 표시 순서·한글 라벨·범위. 키마다 범위가 달라(양 0..100, 폭 0..100,
// 대비 -50..50) 각 행이 자기 range를 들고 다닌다. readout은 모두 정수.
const SHADOW_HIGHLIGHT_SLIDERS: {
  key: keyof ShadowHighlight;
  label: string;
  range: { min: number; max: number; step: number };
}[] = [
  { key: "shadows", label: "섀도우", range: SHADOW_HIGHLIGHT_AMOUNT_RANGE },
  { key: "shadowsWidth", label: "섀도우 톤 범위", range: SHADOW_HIGHLIGHT_WIDTH_RANGE },
  { key: "highlights", label: "하이라이트", range: SHADOW_HIGHLIGHT_AMOUNT_RANGE },
  { key: "highlightsWidth", label: "하이라이트 톤 범위", range: SHADOW_HIGHLIGHT_WIDTH_RANGE },
  { key: "midtoneContrast", label: "미드톤 대비", range: SHADOW_HIGHLIGHT_MIDTONE_RANGE },
];

export function StudioShadowHighlightPanel({
  value,
  onPatch,
  onApplyPreset,
  onReset,
}: {
  value: ShadowHighlight;
  onPatch: (patch: Partial<ShadowHighlight>) => void;
  onApplyPreset: (v: ShadowHighlight) => void;
  onReset: () => void;
}): React.ReactElement {
  // 보정량·대비 모두 0(보정 없음)이면 리셋 비활성 + "기본" 프리셋 칩을 활성으로 표시.
  const isIdentity = isIdentityShadowHighlight(value);

  return (
    <div className="space-y-2">
      {/* 헤더 + 항등 복귀 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">
          섀도우/하이라이트 (Shadow/Highlight)
        </p>
        <button
          type="button"
          onClick={onReset}
          disabled={isIdentity}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="섀도우/하이라이트 보정을 제거하고 원본 명암으로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      {/* 원클릭 명암 복구 프리셋 칩 — 절대값으로 덮어쓴다(누적 아님). */}
      <div className="flex flex-wrap gap-1.5">
        {SHADOW_HIGHLIGHT_PRESETS.map((preset) => (
          <StudioPanelChip
            key={preset.id}
            active={preset.id === "neutral" && isIdentity}
            onClick={() => onApplyPreset(preset.value)}
            title={preset.tip}
          >
            {preset.label}
          </StudioPanelChip>
        ))}
      </div>

      {/* 섀도우/하이라이트 슬라이더 — 범위는 각 행의 range에서, readout은 정수. */}
      <div className="space-y-2">
        {SHADOW_HIGHLIGHT_SLIDERS.map(({ key, label, range }) => {
          const current = value[key] ?? 0;
          return (
            <StudioSliderRow
              key={key}
              label={label}
              min={range.min}
              max={range.max}
              step={range.step}
              value={current}
              onChange={(n) => onPatch({ [key]: n })}
              readout={current}
            />
          );
        })}
      </div>
    </div>
  );
}
