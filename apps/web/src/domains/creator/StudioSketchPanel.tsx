/**
 * Studio Sketch Panel
 * 선택된 이미지의 스케치/잉크(Sketch) 인스펙터 — 원클릭 잉크화 프리셋 +
 * 효과 종류(포토카피/크로스해치/스탬프/메조틴트) 선택 + 세기·디테일 슬라이더.
 * studio-sketch 엔진의 Sketch를 props로 읽고 onPatch/onApplyPreset/onReset으로만 쓴다.
 * StudioPage에서 분리한 순수 프레젠테이션 컴포넌트(상태 없음).
 */
import { RotateCcw } from "lucide-react";


import { StudioPanelChip, StudioSliderRow } from "./studio-panel-ui";
import {
  SKETCH_DETAIL_RANGE,
  SKETCH_PRESETS,
  SKETCH_STRENGTH_RANGE,
  SKETCH_TYPES,
  isIdentitySketch,
  type Sketch,
  type SketchType,
} from "./studio-sketch";

import { buttonClass } from "@/shared/components/ui/button-utils";

// 세기·디테일 슬라이더 정의 — 표시 순서·한글 라벨·범위(세기는 strength, 디테일은 detail).
const SKETCH_SLIDERS: {
  key: "strength" | "detail";
  label: string;
  range: { min: number; max: number; step: number };
}[] = [
  { key: "strength", label: "세기", range: SKETCH_STRENGTH_RANGE },
  { key: "detail", label: "디테일", range: SKETCH_DETAIL_RANGE },
];

export function StudioSketchPanel({
  value,
  onPatch,
  onApplyPreset,
  onReset,
}: {
  value: Sketch;
  onPatch: (patch: Partial<Sketch>) => void;
  onApplyPreset: (v: Sketch) => void;
  onReset: () => void;
}): React.ReactElement {
  // 항등(세기 0)이면 리셋 비활성 + 어떤 프리셋 칩도 활성으로 표시하지 않는다(빈 프리셋 없음).
  const isIdentity = isIdentitySketch(value);

  return (
    <div className="space-y-2">
      {/* 헤더 + 항등 복귀 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">스케치/잉크 (Sketch)</p>
        <button
          type="button"
          onClick={onReset}
          disabled={isIdentity}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="잉크 효과를 제거하고 원본으로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      {/* 원클릭 잉크화 프리셋 칩 — 절대값으로 덮어쓴다(누적 아님). 항등일 땐 활성 칩 없음. */}
      <div className="flex flex-wrap gap-1.5">
        {SKETCH_PRESETS.map((preset) => (
          <StudioPanelChip key={preset.id} onClick={() => onApplyPreset(preset.value)} title={preset.tip}>
            {preset.label}
          </StudioPanelChip>
        ))}
      </div>

      {/* 효과 종류 선택 — 현재 종류를 활성으로 강조, 누르면 type만 패치(세기·디테일 유지). */}
      <div className="flex flex-wrap gap-1.5">
        {SKETCH_TYPES.map((t) => (
          <StudioPanelChip
            key={t.id}
            active={t.id === value.type}
            onClick={() => onPatch({ type: t.id as SketchType })}
            title={`효과를 "${t.label}"로 바꿉니다.`}
          >
            {t.label}
          </StudioPanelChip>
        ))}
      </div>

      {/* 세기·디테일 슬라이더 — 범위는 SKETCH_STRENGTH_RANGE·SKETCH_DETAIL_RANGE에서. */}
      <div className="space-y-2">
        {SKETCH_SLIDERS.map(({ key, label, range }) => (
          <StudioSliderRow
            key={key}
            label={label}
            min={range.min}
            max={range.max}
            step={range.step}
            value={value[key]}
            onChange={(n) => onPatch({ [key]: n })}
          />
        ))}
      </div>
    </div>
  );
}
