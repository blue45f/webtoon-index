/**
 * Studio Blur Panel
 * 선택된 이미지의 흐림 갤러리(Blur) 인스펙터 — 원클릭 흐림 프리셋 +
 * 흐림 종류(가우시안/모션/스핀/줌) 선택 + 세기·반경·각도 슬라이더.
 * studio-blur 엔진의 BlurFx를 props로 읽고 onPatch/onApplyPreset/onReset으로만 쓴다.
 * StudioPage에서 분리한 순수 프레젠테이션 컴포넌트(상태 없음).
 */
import { RotateCcw } from "lucide-react";

import {
  BLURFX_ANGLE_RANGE,
  BLURFX_PRESETS,
  BLURFX_RADIUS_RANGE,
  BLURFX_STRENGTH_RANGE,
  BLURFX_TYPES,
  isIdentityBlurFx,
  type BlurFx,
  type BlurFxType,
} from "./studio-blur";
import { StudioPanelChip } from "./studio-panel-ui";

import { buttonClass } from "@/shared/components/ui/button-utils";


// 공용 라벨 + 슬라이더 한 줄. 우측 readout은 항상 같은 폭으로 정렬한다(세기 0..100·반경 1..40·각도 0..360 정수 수용).
// 각도 행은 label에 title(모션 전용 안내)을 달아야 해서 StudioSliderRow(공용)로 대체하지 않고 로컬 클래스를 유지한다.
const LABEL_ROW = "flex items-center justify-between gap-2 text-xs text-fg-2";
const RANGE_CLASS = "w-24 accent-accent cursor-pointer";
const READOUT_CLASS = "w-8 text-right text-[10px] tabular-nums text-fg-3";

// 세기·반경·각도 슬라이더 정의 — 표시 순서·한글 라벨·범위. 각도는 모션 전용임을 title로 안내한다.
const BLURFX_SLIDERS: {
  key: "strength" | "radius" | "angle";
  label: string;
  range: { min: number; max: number; step: number };
  title?: string;
}[] = [
  { key: "strength", label: "세기", range: BLURFX_STRENGTH_RANGE },
  { key: "radius", label: "반경", range: BLURFX_RADIUS_RANGE },
  { key: "angle", label: "각도", range: BLURFX_ANGLE_RANGE, title: "각도는 모션 종류에서만 적용됩니다." },
];

export function StudioBlurPanel({
  value,
  onPatch,
  onApplyPreset,
  onReset,
}: {
  value: BlurFx;
  onPatch: (patch: Partial<BlurFx>) => void;
  onApplyPreset: (v: BlurFx) => void;
  onReset: () => void;
}): React.ReactElement {
  // 항등(세기 0)이면 리셋 비활성 + 어떤 프리셋 칩도 활성으로 표시하지 않는다(빈 프리셋 없음).
  const isIdentity = isIdentityBlurFx(value);

  return (
    <div className="space-y-2">
      {/* 헤더 + 항등 복귀 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">블러 갤러리 (Blur)</p>
        <button
          type="button"
          onClick={onReset}
          disabled={isIdentity}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="흐림을 제거하고 원본으로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      {/* 원클릭 흐림 프리셋 칩 — 절대값으로 덮어쓴다(누적 아님). 항등일 땐 활성 칩 없음. */}
      <div className="flex flex-wrap gap-1.5">
        {BLURFX_PRESETS.map((preset) => (
          <StudioPanelChip key={preset.id} onClick={() => onApplyPreset(preset.value)} title={preset.tip}>
            {preset.label}
          </StudioPanelChip>
        ))}
      </div>

      {/* 흐림 종류 선택 — 현재 종류를 활성으로 강조, 누르면 type만 패치(세기·반경·각도 유지). */}
      <div className="flex flex-wrap gap-1.5">
        {BLURFX_TYPES.map((t) => (
          <StudioPanelChip
            key={t.id}
            active={t.id === value.type}
            onClick={() => onPatch({ type: t.id as BlurFxType })}
            title={`흐림을 "${t.label}"로 바꿉니다.`}
          >
            {t.label}
          </StudioPanelChip>
        ))}
      </div>

      {/* 세기·반경·각도 슬라이더 — 범위는 BLURFX_STRENGTH_RANGE·BLURFX_RADIUS_RANGE·BLURFX_ANGLE_RANGE에서. */}
      <div className="space-y-2">
        {BLURFX_SLIDERS.map(({ key, label, range, title }) => {
          const current = value[key];
          return (
            <label key={key} className={LABEL_ROW} title={title}>
              {label}
              <span className="flex items-center gap-1.5">
                <input
                  type="range"
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  value={current}
                  onChange={(e) => onPatch({ [key]: Number(e.target.value) })}
                  className={RANGE_CLASS}
                />
                <span className={READOUT_CLASS}>{current}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
