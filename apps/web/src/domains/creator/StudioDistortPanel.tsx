/**
 * Studio Distort Panel
 * 선택된 이미지의 기하 왜곡(Distort/Warp) 인스펙터 — 원클릭 왜곡 프리셋 +
 * 왜곡 종류(비틀기/물결/핀치/웨이브) 선택 + 세기(양극)·스케일 슬라이더.
 * studio-distort 엔진의 Distort를 props로 읽고 onPatch/onApplyPreset/onReset으로만 쓴다.
 * StudioPage에서 분리한 순수 프레젠테이션 컴포넌트(상태 없음).
 */
import { RotateCcw } from "lucide-react";

import {
  DISTORT_AMOUNT_RANGE,
  DISTORT_PRESETS,
  DISTORT_SCALE_RANGE,
  DISTORT_TYPES,
  isIdentityDistort,
  type Distort,
  type DistortType,
} from "./studio-distort";
import { StudioPanelChip, StudioSliderRow } from "./studio-panel-ui";

import { buttonClass } from "@/shared/components/ui/button-utils";


// 세기·스케일 슬라이더 정의 — 표시 순서·한글 라벨·범위(세기는 amount, 스케일은 scale).
// 세기는 양극(-100..100)이라 readout에 부호를 붙이고, 스케일은 단극(1..50)이라 값만 표시한다.
const DISTORT_SLIDERS: {
  key: "amount" | "scale";
  label: string;
  range: { min: number; max: number; step: number };
  signed: boolean;
}[] = [
  { key: "amount", label: "세기", range: DISTORT_AMOUNT_RANGE, signed: true },
  { key: "scale", label: "스케일", range: DISTORT_SCALE_RANGE, signed: false },
];

// 양극 세기 readout — 0/음수는 그대로, 양수만 "+"를 붙여 방향(부호)을 드러낸다.
function formatSigned(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

export function StudioDistortPanel({
  value,
  onPatch,
  onApplyPreset,
  onReset,
}: {
  value: Distort;
  onPatch: (patch: Partial<Distort>) => void;
  onApplyPreset: (v: Distort) => void;
  onReset: () => void;
}): React.ReactElement {
  // 항등(세기 0)이면 리셋 비활성 + 어떤 프리셋 칩도 활성으로 표시하지 않는다(빈 프리셋 없음).
  const isIdentity = isIdentityDistort(value);

  return (
    <div className="space-y-2">
      {/* 헤더 + 항등 복귀 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">왜곡 (Distort)</p>
        <button
          type="button"
          onClick={onReset}
          disabled={isIdentity}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="왜곡을 제거하고 원본으로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      {/* 원클릭 왜곡 프리셋 칩 — 절대값으로 덮어쓴다(누적 아님). 항등일 땐 활성 칩 없음. */}
      <div className="flex flex-wrap gap-1.5">
        {DISTORT_PRESETS.map((preset) => (
          <StudioPanelChip key={preset.id} onClick={() => onApplyPreset(preset.value)} title={preset.tip}>
            {preset.label}
          </StudioPanelChip>
        ))}
      </div>

      {/* 왜곡 종류 선택 — 현재 종류를 활성으로 강조, 누르면 type만 패치(세기·스케일 유지). */}
      <div className="flex flex-wrap gap-1.5">
        {DISTORT_TYPES.map((t) => (
          <StudioPanelChip
            key={t.id}
            active={t.id === value.type}
            onClick={() => onPatch({ type: t.id as DistortType })}
            title={`왜곡을 "${t.label}"로 바꿉니다.`}
          >
            {t.label}
          </StudioPanelChip>
        ))}
      </div>

      {/* 세기·스케일 슬라이더 — 범위는 DISTORT_AMOUNT_RANGE·DISTORT_SCALE_RANGE에서. 세기는 양극이라 부호 표시. */}
      <div className="space-y-2">
        {DISTORT_SLIDERS.map(({ key, label, range, signed }) => {
          const current = value[key];
          return (
            <StudioSliderRow
              key={key}
              label={label}
              min={range.min}
              max={range.max}
              step={range.step}
              value={current}
              onChange={(n) => onPatch({ [key]: n })}
              readout={signed ? formatSigned(current) : current}
            />
          );
        })}
      </div>
    </div>
  );
}
