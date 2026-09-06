/**
 * Studio Photo Filter Panel
 * 선택된 이미지의 포토 필터(Photo Filter) 보정 인스펙터 — 원클릭 색조 프리셋 +
 * 필터 색 + 농도(density) 슬라이더 + 광도 유지(preserveLuminosity) 체크박스.
 * studio-photo-filter 엔진의 PhotoFilter를 props로 읽고 onPatch/onApplyPreset/onReset으로만 쓴다.
 * StudioPage에서 분리한 순수 프레젠테이션 컴포넌트(상태 없음).
 */
import { RotateCcw } from "lucide-react";


import { StudioSliderRow, StudioSwatchChip } from "./studio-panel-ui";
import {
  isIdentityPhotoFilter,
  PHOTO_FILTER_DENSITY_RANGE,
  PHOTO_FILTER_PRESETS,
  type PhotoFilter,
} from "./studio-photo-filter";

import { buttonClass } from "@/shared/components/ui/button-utils";

export function StudioPhotoFilterPanel({
  value,
  onPatch,
  onApplyPreset,
  onReset,
}: {
  value: PhotoFilter;
  onPatch: (patch: Partial<PhotoFilter>) => void;
  onApplyPreset: (v: PhotoFilter) => void;
  onReset: () => void;
}): React.ReactElement {
  // 농도 0(보정 없음)이면 리셋 비활성 + "없음" 프리셋 칩을 활성으로 표시.
  const isIdentity = isIdentityPhotoFilter(value);

  return (
    <div className="space-y-2">
      {/* 헤더 + 항등 복귀 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">포토 필터 (Photo Filter)</p>
        <button
          type="button"
          onClick={onReset}
          disabled={isIdentity}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="포토 필터를 제거하고 색조 없는 원본으로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      {/* 원클릭 색조 프리셋 칩 — 절대값으로 덮어쓴다(누적 아님). 스와치는 프리셋 색으로 칠한다. */}
      <div className="flex flex-wrap gap-1.5">
        {PHOTO_FILTER_PRESETS.map((preset) => (
          <StudioSwatchChip
            key={preset.id}
            color={preset.value.color}
            label={preset.label}
            active={preset.id === "none" && isIdentity}
            title={preset.tip}
            onClick={() => onApplyPreset(preset.value)}
          />
        ))}
      </div>

      {/* 필터 색 — input[type=color]는 빈 값 불가라 항상 #rrggbb를 들고 있다. */}
      <label className="flex items-center gap-2 text-xs text-fg-2">
        필터 색
        <input
          type="color"
          value={value.color}
          onChange={(e) => onPatch({ color: e.target.value })}
          className="h-7 w-7 cursor-pointer rounded border border-line bg-card"
        />
      </label>

      {/* 농도(density) 슬라이더 — 범위는 PHOTO_FILTER_DENSITY_RANGE에서. 0이면 항등. */}
      <StudioSliderRow
        label="농도 (Density)"
        min={PHOTO_FILTER_DENSITY_RANGE.min}
        max={PHOTO_FILTER_DENSITY_RANGE.max}
        step={PHOTO_FILTER_DENSITY_RANGE.step}
        value={value.density}
        onChange={(n) => onPatch({ density: n })}
        readout={`${value.density}%`}
      />

      {/* 광도 유지 — 켜면 색조 적용 후 픽셀 밝기를 원본 휘도로 되돌린다. */}
      <label className="flex items-center gap-1.5 text-xs text-fg-2 cursor-pointer">
        <input
          type="checkbox"
          checked={value.preserveLuminosity}
          onChange={(e) => onPatch({ preserveLuminosity: e.target.checked })}
          className="size-3.5 accent-accent cursor-pointer"
        />
        광도 유지 (Preserve Luminosity)
      </label>
    </div>
  );
}
