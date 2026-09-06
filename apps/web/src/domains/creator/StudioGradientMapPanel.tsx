/**
 * Studio Gradient Map Panel
 * 선택된 이미지의 그라디언트 맵(Gradient Map) 보정 인스펙터 — 색감 프리셋 + 스톱 색 편집.
 * studio-gradient-map 엔진의 GradientMap을 props로 읽고 onApplyPreset/onEditStopColor/onReset으로만 쓴다.
 * StudioPage에서 분리한 순수 프레젠테이션 컴포넌트(상태 없음).
 */
import { RotateCcw } from "lucide-react";

import {
  GRADIENT_MAP_PRESETS,
  isDefaultGradientMap,
  type GradientMap,
  type GradientStop,
} from "./studio-gradient-map";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";


// 프리셋 칩 — 미니 그라디언트를 배경에 깔고 라벨은 가독성을 위해 그림자를 얹는다.
const CHIP_CLASS =
  "relative overflow-hidden rounded-md border border-line px-2 py-1 text-[0.6rem] font-medium text-white transition-colors hover:border-line-strong [text-shadow:0_1px_2px_oklch(0_0_0/0.65)]";

/**
 * 색 스톱 배열 → CSS linear-gradient(to right, ...) 문자열.
 * 각 스톱을 "color pos%"로 직렬화한다(pos 0..1 → 0..100%). 순수·결정적.
 */
function gradientCss(stops: GradientStop[]): string {
  const parts = stops.map((s) => `${s.color} ${s.pos * 100}%`).join(", ");
  return `linear-gradient(to right, ${parts})`;
}

export function StudioGradientMapPanel({
  value,
  onApplyPreset,
  onEditStopColor,
  onReset,
}: {
  value: GradientMap;
  onApplyPreset: (m: GradientMap) => void;
  onEditStopColor: (index: number, color: string) => void;
  onReset: () => void;
}): React.ReactElement {
  // 흑→백 기본 매핑(=흑백)이면 리셋 비활성 + "흑백" 프리셋 칩을 활성으로 표시.
  const isDefault = isDefaultGradientMap(value);

  return (
    <div className="space-y-2">
      {/* 헤더 + 기본(흑백) 복귀 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">그라디언트 맵</p>
        <button
          type="button"
          onClick={onReset}
          disabled={isDefault}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="그라디언트 맵을 기본 흑백 매핑으로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      {/* 현재 매핑 라이브 프리뷰 — value.stops로 그린 가로 그라디언트 바. */}
      <div
        className="h-4 w-full rounded border border-line"
        style={{ backgroundImage: gradientCss(value.stops) }}
        aria-hidden="true"
      />

      {/* 색감 프리셋 칩 — 절대값으로 덮어쓴다(누적 아님). 각 칩 배경에 미니 그라디언트. */}
      <div className="grid grid-cols-2 gap-1.5">
        {GRADIENT_MAP_PRESETS.map((preset) => {
          // 흑백 프리셋만 항등 판정이 가능 — 기본 상태일 때 활성으로 강조한다.
          const active = preset.id === "mono" && isDefault;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApplyPreset(preset.map)}
              title={preset.tip}
              style={{ backgroundImage: gradientCss(preset.map.stops) }}
              className={cn(CHIP_CLASS, active && "border-accent ring-1 ring-accent")}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* 스톱별 색 편집 — 네이티브 컬러 피커 한 줄, 아래에 위치(pos%) 라벨. */}
      <div className="flex flex-wrap gap-2">
        {value.stops.map((stop, i) => (
          <label key={i} className="flex flex-col items-center gap-1">
            <input
              type="color"
              value={stop.color}
              onChange={(e) => onEditStopColor(i, e.target.value)}
              className="size-7 cursor-pointer rounded border border-line bg-card p-0"
              title={`스톱 ${i + 1} 색 (${Math.round(stop.pos * 100)}%)`}
            />
            <span className="text-[10px] tabular-nums text-fg-3">{Math.round(stop.pos * 100)}%</span>
          </label>
        ))}
      </div>
    </div>
  );
}
