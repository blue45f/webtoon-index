/**
 * Studio Ink Wash Panel
 *
 * 선택 이미지(사진·AI 소스·3D 캡처 포함)를 비파괴 수묵/수채 재질로 바꾸는 인스펙터.
 * 실제 픽셀 엔진은 studio-ink-wash에 있고, 이 컴포넌트는 값 표시와 변경 위임만 맡는다.
 */
import { RefreshCw, RotateCcw } from "lucide-react";

import {
  INK_WASH_EDGE_BLEED_RANGE,
  INK_WASH_GRANULATION_RANGE,
  INK_WASH_PAPER_RANGE,
  INK_WASH_PRESETS,
  INK_WASH_SPREAD_RANGE,
  INK_WASH_STRENGTH_RANGE,
  isIdentityInkWash,
  type InkWash,
} from "./brush/studio-ink-wash";
import { PANEL_LABEL_ROW, PANEL_READOUT_CLASS, StudioPanelChip, StudioSliderRow } from "./studio-panel-ui";

import { buttonClass } from "@/shared/components/ui/button-utils";

const INK_WASH_SLIDERS: Array<{
  key: "strength" | "spread" | "edgeBleed" | "granulation" | "paper";
  label: string;
  range: { min: number; max: number; step: number };
  unit: string;
}> = [
  { key: "strength", label: "세기", range: INK_WASH_STRENGTH_RANGE, unit: "%" },
  { key: "spread", label: "번짐 범위", range: INK_WASH_SPREAD_RANGE, unit: "px" },
  { key: "edgeBleed", label: "젖은 가장자리", range: INK_WASH_EDGE_BLEED_RANGE, unit: "%" },
  { key: "granulation", label: "안료 과립", range: INK_WASH_GRANULATION_RANGE, unit: "%" },
  { key: "paper", label: "한지 결", range: INK_WASH_PAPER_RANGE, unit: "%" },
];

/** Math.random 없이 재질 무늬만 결정적으로 바꾸는 한 단계 LCG. */
function nextSeed(seed: number): number {
  return (((seed * 1103515245 + 12345) % 10000) + 10000) % 10000;
}

export function StudioInkWashPanel({
  value,
  onPatch,
  onApplyPreset,
  onReset,
}: {
  value: InkWash;
  onPatch: (patch: Partial<InkWash>) => void;
  onApplyPreset: (value: InkWash) => void;
  onReset: () => void;
}): React.ReactElement {
  const isIdentity = isIdentityInkWash(value);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold uppercase tracking-wider text-fg-3">수묵/번짐 재질 (Ink Wash)</p>
        <button
          type="button"
          onClick={onReset}
          disabled={isIdentity}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="수묵·번짐·종이결 재질을 제거하고 원본으로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      <p className="text-[0.68rem] leading-relaxed text-fg-3">
        원본을 바꾸지 않고 먹의 농담, 젖은 번짐, 한지 섬유와 안료 과립을 합성합니다. 사진·AI 소스·3D 배경 캡처에도 같은 결과로 적용돼요.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {INK_WASH_PRESETS.map((preset) => (
          <StudioPanelChip
            key={preset.id}
            active={preset.id === "none" && isIdentity}
            onClick={() => onApplyPreset(preset.value)}
            title={preset.tip}
          >
            {preset.label}
          </StudioPanelChip>
        ))}
      </div>

      <div className="space-y-2">
        {INK_WASH_SLIDERS.map(({ key, label, range, unit }) => (
          <StudioSliderRow
            key={key}
            label={label}
            min={range.min}
            max={range.max}
            step={range.step}
            value={value[key]}
            onChange={(next) => onPatch({ [key]: next })}
            readout={`${value[key]}${unit}`}
          />
        ))}
      </div>

      <label className={PANEL_LABEL_ROW}>
        먹색
        <span className="flex items-center gap-1.5">
          <input
            type="color"
            value={value.inkColor}
            onChange={(event) => onPatch({ inkColor: event.target.value })}
            aria-label="수묵 안료색"
            className="size-7 cursor-pointer rounded border border-line bg-card"
          />
          <code className="w-[4.8rem] text-right text-[0.68rem] uppercase tabular-nums text-fg-3">{value.inkColor}</code>
        </span>
      </label>

      <div className={PANEL_LABEL_ROW}>
        <span>재질 시드</span>
        <span className="flex items-center gap-1.5">
          <StudioPanelChip
            onClick={() => onPatch({ seed: nextSeed(value.seed) })}
            title="안료 과립과 한지 무늬를 결정적으로 다시 뽑습니다. 같은 시드는 언제나 같은 결과입니다."
          >
            <RefreshCw className="size-3" aria-hidden /> 새 무늬
          </StudioPanelChip>
          <span className={PANEL_READOUT_CLASS}>{value.seed}</span>
        </span>
      </div>
    </div>
  );
}
