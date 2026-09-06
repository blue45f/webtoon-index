/**
 * Studio Vibrance Panel
 * 선택된 이미지의 활기·채도(Vibrance/Saturation) 보정 인스펙터 — 원클릭 채도 프리셋 +
 * 활기/채도 슬라이더.
 * studio-vibrance 엔진의 Vibrance를 props로 읽고 onPatch/onApplyPreset/onReset으로만 쓴다.
 * StudioPage에서 분리한 순수 프레젠테이션 컴포넌트(상태 없음).
 */
import { RotateCcw } from "lucide-react";

import {
  isIdentityVibrance,
  VIBRANCE_PRESETS,
  VIBRANCE_RANGE,
  type Vibrance,
} from "./studio-vibrance";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";


// 공용 라벨 + 슬라이더 한 줄. 우측 readout은 항상 같은 폭으로 정렬한다(-100..100 수용).
const LABEL_ROW = "flex items-center justify-between gap-2 text-xs text-fg-2";
const RANGE_CLASS = "w-24 accent-accent cursor-pointer";
const READOUT_CLASS = "w-8 text-right text-[10px] tabular-nums text-fg-3";
const CHIP_CLASS =
  "rounded-md border border-line bg-card px-2 py-0.5 text-[0.6rem] text-fg-2 transition-colors hover:bg-raised hover:text-fg";

// 슬라이더 정의 — 표시 순서·한글 라벨. 둘 다 VIBRANCE_RANGE(-100..100, 정수 readout)를 쓴다.
const VIBRANCE_SLIDERS: { key: keyof Vibrance; label: string }[] = [
  { key: "vibrance", label: "생동감" },
  { key: "saturation", label: "채도" },
];

export function StudioVibrancePanel({
  value,
  onPatch,
  onApplyPreset,
  onReset,
}: {
  value: Vibrance;
  onPatch: (patch: Partial<Vibrance>) => void;
  onApplyPreset: (v: Vibrance) => void;
  onReset: () => void;
}): React.ReactElement {
  // 두 값 모두 0(보정 없음)이면 리셋 비활성 + "기본" 프리셋 칩을 활성으로 표시.
  const isIdentity = isIdentityVibrance(value);

  return (
    <div className="space-y-2">
      {/* 헤더 + 항등 복귀 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">생동감 (Vibrance)</p>
        <button
          type="button"
          onClick={onReset}
          disabled={isIdentity}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="생동감 보정을 제거하고 원본 채도로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      {/* 원클릭 채도 프리셋 칩 — 절대값으로 덮어쓴다(누적 아님). */}
      <div className="flex flex-wrap gap-1.5">
        {VIBRANCE_PRESETS.map((preset) => {
          const active = preset.id === "neutral" && isIdentity;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApplyPreset(preset.value)}
              title={preset.tip}
              className={cn(CHIP_CLASS, active && "border-accent bg-raised text-fg")}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* 활기·채도 슬라이더 — 범위는 VIBRANCE_RANGE에서, readout은 정수. */}
      <div className="space-y-2">
        {VIBRANCE_SLIDERS.map(({ key, label }) => {
          const current = value[key] ?? 0;
          return (
            <label key={key} className={LABEL_ROW}>
              {label}
              <span className="flex items-center gap-1.5">
                <input
                  type="range"
                  min={VIBRANCE_RANGE.min}
                  max={VIBRANCE_RANGE.max}
                  step={VIBRANCE_RANGE.step}
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
