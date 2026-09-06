/**
 * Studio Glow Panel
 * 선택된 이미지의 글로우/블룸(Glow) 인스펙터 — 원클릭 빛 번짐 프리셋 +
 * 세기/번짐/임계 슬라이더 + 글로우 색(원색 또는 단색) 선택.
 * studio-glow 엔진의 Glow를 props로 읽고 onPatch/onApplyPreset/onReset으로만 쓴다.
 * StudioPage에서 분리한 순수 프레젠테이션 컴포넌트(상태 없음).
 */
import { RotateCcw } from "lucide-react";

import {
  GLOW_PRESETS,
  GLOW_SIZE_RANGE,
  GLOW_STRENGTH_RANGE,
  GLOW_THRESHOLD_RANGE,
  isIdentityGlow,
  type Glow,
} from "./studio-glow";
import { StudioPanelChip, StudioSliderRow, StudioToggleChip, PANEL_LABEL_ROW } from "./studio-panel-ui";

import { buttonClass } from "@/shared/components/ui/button-utils";


// color가 "auto"(원색)일 때 색 입력에 보여줄 폴백 — 단색으로 전환하면 흰색에서 시작.
const COLOR_FALLBACK = "#ffffff";

// 슬라이더 정의 — 표시 순서·한글 라벨·범위·readout 단위("%"는 0..100, "px"는 반경).
const GLOW_SLIDERS: { key: keyof Glow; label: string; range: { min: number; max: number; step: number }; unit: string }[] = [
  { key: "strength", label: "세기", range: GLOW_STRENGTH_RANGE, unit: "%" },
  { key: "size", label: "번짐", range: GLOW_SIZE_RANGE, unit: "px" },
  { key: "threshold", label: "임계", range: GLOW_THRESHOLD_RANGE, unit: "%" },
];

export function StudioGlowPanel({
  value,
  onPatch,
  onApplyPreset,
  onReset,
}: {
  value: Glow;
  onPatch: (patch: Partial<Glow>) => void;
  onApplyPreset: (v: Glow) => void;
  onReset: () => void;
}): React.ReactElement {
  // 항등(strength 0)이면 리셋 비활성 + "기본" 프리셋 칩을 활성으로 표시.
  const isIdentity = isIdentityGlow(value);
  // 색이 "auto"면 원색 모드 — 단색 입력을 숨기고 토글만 활성으로 둔다.
  const isAuto = value.color === "auto";

  return (
    <div className="space-y-2">
      {/* 헤더 + 항등 복귀 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">글로우/블룸 (Glow)</p>
        <button
          type="button"
          onClick={onReset}
          disabled={isIdentity}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="글로우를 제거하고 원본으로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      {/* 원클릭 빛 번짐 프리셋 칩 — 절대값으로 덮어쓴다(누적 아님). */}
      <div className="flex flex-wrap gap-1.5">
        {GLOW_PRESETS.map((preset) => (
          <StudioPanelChip
            key={preset.id}
            active={preset.id === "none" && isIdentity}
            onClick={() => onApplyPreset(preset.value)}
            title={preset.tip}
          >
            {preset.label}
          </StudioPanelChip>
        ))}
      </div>

      {/* 세기·번짐·임계 슬라이더 — 범위는 GLOW_*_RANGE에서. */}
      <div className="space-y-2">
        {GLOW_SLIDERS.map(({ key, label, range, unit }) => (
          <StudioSliderRow
            key={key}
            label={label}
            min={range.min}
            max={range.max}
            step={range.step}
            value={value[key] as number}
            onChange={(n) => onPatch({ [key]: n })}
            readout={
              <>
                {value[key]}
                {unit}
              </>
            }
          />
        ))}
      </div>

      {/* 글로우 색 — "원색(auto)" 토글, 끄면 단색 input[type=color]로 직접 지정. (range가 아니라 공용 SliderRow 미적용) */}
      <label className={PANEL_LABEL_ROW}>
        글로우 색
        <span className="flex items-center gap-1.5">
          <StudioToggleChip
            active={isAuto}
            onClick={() => onPatch({ color: isAuto ? COLOR_FALLBACK : "auto" })}
            title="켜면 밝은 영역의 원래 색으로, 끄면 지정한 단색으로 빛을 번지게 합니다."
          >
            원색(auto)
          </StudioToggleChip>
          {!isAuto && (
            <input
              type="color"
              value={isAuto ? COLOR_FALLBACK : value.color}
              onChange={(e) => onPatch({ color: e.target.value })}
              className="h-7 w-7 cursor-pointer rounded border border-line bg-card"
            />
          )}
        </span>
      </label>
    </div>
  );
}
