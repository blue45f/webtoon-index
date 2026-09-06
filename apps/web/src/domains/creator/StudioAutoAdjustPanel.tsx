/**
 * Studio Auto Adjust Panel
 * 선택된 이미지의 자동 보정(Auto) 인스펙터 — 원클릭 모드 프리셋 + 강도(strength) 슬라이더.
 * studio-auto-adjust 엔진의 AutoAdjust를 props로 읽고 onPatch/onApplyPreset/onReset으로만 쓴다.
 * StudioPage에서 분리한 순수 프레젠테이션 컴포넌트(상태 없음).
 */
import { RotateCcw } from "lucide-react";

import {
  AUTO_ADJUST_PRESETS,
  AUTO_STRENGTH_RANGE,
  isIdentityAutoAdjust,
  type AutoAdjust,
} from "./studio-auto-adjust";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";


// 공용 라벨 + 슬라이더 한 줄. 우측 readout은 항상 같은 폭으로 정렬한다(100% 수용).
const LABEL_ROW = "flex items-center justify-between gap-2 text-xs text-fg-2";
const RANGE_CLASS = "w-24 accent-accent cursor-pointer";
const READOUT_CLASS = "w-8 text-right text-[10px] tabular-nums text-fg-3";
const CHIP_CLASS =
  "rounded-md border border-line bg-card px-2 py-0.5 text-[0.6rem] text-fg-2 transition-colors hover:bg-raised hover:text-fg";

export function StudioAutoAdjustPanel({
  value,
  onPatch,
  onApplyPreset,
  onReset,
}: {
  value: AutoAdjust;
  onPatch: (patch: Partial<AutoAdjust>) => void;
  onApplyPreset: (v: AutoAdjust) => void;
  onReset: () => void;
}): React.ReactElement {
  // 항등(보정 없음)이면 리셋 비활성 + "기본" 프리셋 칩을 활성으로 표시.
  const isIdentity = isIdentityAutoAdjust(value);

  return (
    <div className="space-y-2">
      {/* 헤더 + 항등 복귀 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">자동 보정 (Auto)</p>
        <button
          type="button"
          onClick={onReset}
          disabled={isIdentity}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="자동 보정을 제거하고 원본 톤으로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      {/* 모드 프리셋 칩 — 모드+강도를 절대값으로 덮어쓴다(누적 아님). */}
      <div className="flex flex-wrap gap-1.5">
        {AUTO_ADJUST_PRESETS.map((preset) => {
          const active = preset.id === "none" && isIdentity;
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

      {/* 강도 슬라이더 — 프리셋이 고른 모드를 원본과 어느 비율로 블렌드할지(0..100%). */}
      <label className={LABEL_ROW}>
        강도
        <span className="flex items-center gap-1.5">
          <input
            type="range"
            min={AUTO_STRENGTH_RANGE.min}
            max={AUTO_STRENGTH_RANGE.max}
            step={AUTO_STRENGTH_RANGE.step}
            value={value.strength}
            onChange={(e) => onPatch({ strength: Number(e.target.value) })}
            className={RANGE_CLASS}
          />
          <span className={READOUT_CLASS}>{value.strength}%</span>
        </span>
      </label>

      {/* 사용법 힌트 — 프리셋으로 모드를 고른 뒤 강도로 세기 조절. */}
      <p className="text-[10px] leading-snug text-fg-3">프리셋을 누른 뒤 강도로 세기를 조절하세요.</p>
    </div>
  );
}
