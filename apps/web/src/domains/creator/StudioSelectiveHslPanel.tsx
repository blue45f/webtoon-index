/**
 * Studio Selective HSL Panel
 * 선택된 이미지의 선택 색상(HSL) 보정 인스펙터 — 원클릭 색감 프리셋 +
 * 8개 색 밴드(빨강~자홍) 스와치 선택 + 선택 밴드의 색조/채도/명도 슬라이더.
 * studio-selective-hsl 엔진의 SelectiveHsl를 props로 읽고 onPatch/onApplyPreset/onReset으로만 쓴다.
 * 어느 밴드를 편집 중인지(selectedBand)만 로컬 상태로 들고, 보정값 자체는 상위가 소유한다.
 * StudioPage에서 분리한 프레젠테이션 컴포넌트.
 */
import { RotateCcw } from "lucide-react";
import { useState } from "react";

import {
  HSL_BAND_CENTER,
  HSL_BANDS,
  isIdentitySelectiveHsl,
  SELECTIVE_HSL_PRESETS,
  SELECTIVE_HSL_RANGE,
  type BandAdjust,
  type HslBand,
  type SelectiveHsl,
} from "./studio-selective-hsl";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";


// 공용 라벨 + 슬라이더 한 줄. 우측 readout은 항상 같은 폭으로 정렬한다(-100..100 수용).
const LABEL_ROW = "flex items-center justify-between gap-2 text-xs text-fg-2";
const RANGE_CLASS = "w-24 accent-accent cursor-pointer";
const READOUT_CLASS = "w-8 text-right text-[10px] tabular-nums text-fg-3";
const CHIP_CLASS =
  "rounded-md border border-line bg-card px-2 py-0.5 text-[0.6rem] text-fg-2 transition-colors hover:bg-raised hover:text-fg";

// 8개 색 밴드 한글 라벨 — HSL_BANDS와 1:1(고정 순서).
const BAND_LABELS: Record<HslBand, string> = {
  red: "빨강",
  orange: "주황",
  yellow: "노랑",
  green: "초록",
  aqua: "아쿠아",
  blue: "파랑",
  purple: "보라",
  magenta: "자홍",
};

// 선택 밴드의 색조/채도/명도 슬라이더 정의 — 표시 순서·한글 라벨·BandAdjust 채널 키.
const BAND_SLIDERS: { key: keyof BandAdjust; label: string }[] = [
  { key: "hue", label: "색조" },
  { key: "sat", label: "채도" },
  { key: "lum", label: "명도" },
];

export function StudioSelectiveHslPanel({
  value,
  onPatch,
  onApplyPreset,
  onReset,
}: {
  value: SelectiveHsl;
  onPatch: (patch: Partial<SelectiveHsl>) => void;
  onApplyPreset: (v: SelectiveHsl) => void;
  onReset: () => void;
}): React.ReactElement {
  // 모든 밴드의 모든 채널이 0(보정 없음)이면 리셋 비활성 + "기본" 프리셋 칩을 활성으로 표시.
  const isIdentity = isIdentitySelectiveHsl(value);
  // 지금 슬라이더로 편집 중인 밴드 — 유일한 로컬 상태(보정값 자체는 상위 소유).
  const [selectedBand, setSelectedBand] = useState<HslBand>("red");
  const adjust = value[selectedBand];

  return (
    <div className="space-y-2">
      {/* 헤더 + 항등 복귀 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">선택 색상 (HSL)</p>
        <button
          type="button"
          onClick={onReset}
          disabled={isIdentity}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="선택 색상 보정을 제거하고 원본 색상으로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      {/* 원클릭 색감 프리셋 칩 — 절대값으로 덮어쓴다(누적 아님). */}
      <div className="flex flex-wrap gap-1.5">
        {SELECTIVE_HSL_PRESETS.map((preset) => {
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

      {/* 밴드 선택 — 각 밴드 중심 hue로 채운 스와치 8개. 클릭하면 아래 슬라이더가 그 밴드를 편집한다. */}
      <div className="flex flex-wrap gap-1.5">
        {HSL_BANDS.map((band) => {
          const selected = band === selectedBand;
          return (
            <button
              key={band}
              type="button"
              onClick={() => setSelectedBand(band)}
              title={BAND_LABELS[band]}
              aria-pressed={selected}
              className={cn(
                "size-6 rounded-md border transition-[border-color,box-shadow]",
                selected ? "border-fg ring-2 ring-accent/70" : "border-line hover:border-fg-3"
              )}
              style={{ background: `hsl(${HSL_BAND_CENTER[band]} 80% 50%)` }}
            />
          );
        })}
      </div>

      {/* 선택 밴드 라벨 + 색조/채도/명도 슬라이더 — 범위는 SELECTIVE_HSL_RANGE에서. */}
      <div className="space-y-1.5">
        <p className="text-[0.66rem] font-semibold text-fg-2">{BAND_LABELS[selectedBand]}</p>
        {BAND_SLIDERS.map(({ key, label }) => {
          const current = adjust[key];
          return (
            <label key={key} className={LABEL_ROW}>
              {label}
              <span className="flex items-center gap-1.5">
                <input
                  type="range"
                  min={SELECTIVE_HSL_RANGE.min}
                  max={SELECTIVE_HSL_RANGE.max}
                  step={SELECTIVE_HSL_RANGE.step}
                  value={current}
                  onChange={(e) =>
                    // 선택 밴드의 해당 채널만 바꾼 새 조정값을 불변으로 만들어 그 밴드 키만 패치한다.
                    onPatch({
                      [selectedBand]: { ...adjust, [key]: Number(e.target.value) } as BandAdjust,
                    } as Partial<SelectiveHsl>)
                  }
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
