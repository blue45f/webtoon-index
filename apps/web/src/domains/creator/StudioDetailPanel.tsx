/**
 * Studio Detail Panel
 * 선택된 이미지의 디테일/샤픈(Detail) 인스펙터 — 원클릭 디테일 프리셋 +
 * 도구 종류(하이패스/미디언/스마트 샤픈) 선택 + 세기·반경 슬라이더.
 * studio-detail 엔진의 Detail을 props로 읽고 onPatch/onApplyPreset/onReset으로만 쓴다.
 * StudioPage에서 분리한 순수 프레젠테이션 컴포넌트(상태 없음).
 */
import { RotateCcw } from "lucide-react";

import {
  DETAIL_AMOUNT_RANGE,
  DETAIL_PRESETS,
  DETAIL_RADIUS_RANGE,
  DETAIL_TYPES,
  isIdentityDetail,
  type Detail,
  type DetailType,
} from "./studio-detail";
import { StudioPanelChip, StudioSliderRow } from "./studio-panel-ui";

import { buttonClass } from "@/shared/components/ui/button-utils";


// 세기·반경 슬라이더 정의 — 표시 순서·한글 라벨·범위(세기는 amount, 반경은 radius).
const DETAIL_SLIDERS: {
  key: "amount" | "radius";
  label: string;
  range: { min: number; max: number; step: number };
}[] = [
  { key: "amount", label: "세기", range: DETAIL_AMOUNT_RANGE },
  { key: "radius", label: "반경", range: DETAIL_RADIUS_RANGE },
];

export function StudioDetailPanel({
  value,
  onPatch,
  onApplyPreset,
  onReset,
}: {
  value: Detail;
  onPatch: (patch: Partial<Detail>) => void;
  onApplyPreset: (v: Detail) => void;
  onReset: () => void;
}): React.ReactElement {
  // 항등(세기 0)이면 리셋 비활성 + 어떤 프리셋 칩도 활성으로 표시하지 않는다(빈 프리셋 없음).
  const isIdentity = isIdentityDetail(value);

  return (
    <div className="space-y-2">
      {/* 헤더 + 항등 복귀 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">디테일/샤픈 (Detail)</p>
        <button
          type="button"
          onClick={onReset}
          disabled={isIdentity}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="디테일 효과를 제거하고 원본으로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      {/* 원클릭 디테일 프리셋 칩 — 절대값으로 덮어쓴다(누적 아님). 항등일 땐 활성 칩 없음. */}
      <div className="flex flex-wrap gap-1.5">
        {DETAIL_PRESETS.map((preset) => (
          <StudioPanelChip key={preset.id} onClick={() => onApplyPreset(preset.value)} title={preset.tip}>
            {preset.label}
          </StudioPanelChip>
        ))}
      </div>

      {/* 도구 종류 선택 — 현재 종류를 활성으로 강조, 누르면 type만 패치(세기·반경 유지). */}
      <div className="flex flex-wrap gap-1.5">
        {DETAIL_TYPES.map((t) => (
          <StudioPanelChip
            key={t.id}
            active={t.id === value.type}
            onClick={() => onPatch({ type: t.id as DetailType })}
            title={`도구를 "${t.label}"로 바꿉니다.`}
          >
            {t.label}
          </StudioPanelChip>
        ))}
      </div>

      {/* 세기·반경 슬라이더 — 범위는 DETAIL_AMOUNT_RANGE·DETAIL_RADIUS_RANGE에서. */}
      <div className="space-y-2">
        {DETAIL_SLIDERS.map(({ key, label, range }) => (
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
