/**
 * Studio Photo → Webtoon Preset Panel
 * 업로드한 사진을 원클릭으로 웹툰풍으로 바꾸는 프리셋 3종 — 칩을 누르면 onApplyPreset(preset)으로
 * 프리셋 전체를 넘긴다(부모가 studio-photo-webtoon-preset의 applyPhotoWebtoonPreset로 병합).
 * StudioLooksPanel과 동일하게 "현재 어떤 프리셋이 적용됐는지"를 추적하지 않는 무상태
 * 프레젠테이션 컴포넌트다 — 다중 객체 필드(vibrance/clarity/stylize/halftone/photoFilter)를
 * 깊은 비교로 "활성" 판정하는 것은 이 카탈로그 규모(3개)에 비해 과한 복잡도라 생략했다.
 */
import { RotateCcw } from "lucide-react";

import { StudioSwatchChip } from "./studio-panel-ui";
import { PHOTO_WEBTOON_PRESETS, type PhotoWebtoonPreset } from "./studio-photo-webtoon-preset";

import { buttonClass } from "@/shared/components/ui/button-utils";

export function StudioPhotoWebtoonPresetPanel({
  onApplyPreset,
  onReset,
}: {
  onApplyPreset: (preset: PhotoWebtoonPreset) => void;
  onReset: () => void;
}): React.ReactElement {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">
          사진→웹툰 필터 (Photo→Webtoon)
        </p>
        <button
          type="button"
          onClick={onReset}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="대비·포스터라이즈·흑백·생동감·명료도·포토 필터·하프톤을 지웁니다(생동감/명료도/포토 필터/하프톤/스타일라이즈 패널에서 직접 만진 값도 함께 지워집니다). 외곽선·글로우·그레인 등은 유지됩니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      <p className="text-[0.68rem] text-fg-3">
        사진 한 장을 원클릭으로 웹툰풍으로 바꿉니다. 외곽선·글로우·그레인 등 이 프리셋이 다루지 않는 보정은 그대로 유지되지만, 생동감·명료도·포토
        필터·하프톤·스타일라이즈·대비처럼 이 프리셋이 쓰는 값은 해당 전용 패널에서 손으로 맞춘 것이라도 덮어씁니다.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {PHOTO_WEBTOON_PRESETS.map((preset) => (
          <StudioSwatchChip
            key={preset.id}
            color={preset.swatch}
            label={preset.label}
            title={preset.tip}
            onClick={() => onApplyPreset(preset)}
          />
        ))}
      </div>
    </div>
  );
}
