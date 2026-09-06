/**
 * Studio Text Path Panel
 * 곡선 텍스트(Path) 인스펙터 — 모양 프리셋 칩 + 경로 모양 셀렉터 + 휘어짐(curve) 슬라이더.
 * studio-text-path 엔진의 TextPathConfig를 props로 읽고 onPatch/onApplyPreset/onReset으로만 쓴다.
 * StudioPage에서 분리한 순수 프레젠테이션 컴포넌트(상태 없음).
 */
import { RotateCcw } from "lucide-react";

import {
  isFlatTextPath,
  TEXT_PATH_CURVE_RANGE,
  TEXT_PATH_PRESETS,
  TEXT_PATH_SHAPES,
  type TextPathConfig,
  type TextPathShape,
} from "./studio-text-path";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";


// 프리셋 칩 — StudioLevelsPanel/StudioCurvePanel과 동일 idiom(활성 시 accent 보더 + raised 배경).
const CHIP_CLASS =
  "rounded-md border border-line bg-card px-2 py-0.5 text-[0.6rem] text-fg-2 transition-colors hover:bg-raised hover:text-fg";

// 모양 셀렉터 버튼 — 칩과 같은 톤이지만 한 줄에 고르게 늘어서도록 살짝 넓힌다.
const SHAPE_BTN_CLASS =
  "rounded-md border border-line bg-card px-2 py-1 text-[0.6rem] text-fg-2 transition-colors hover:bg-raised hover:text-fg";

// 슬라이더 한 줄 — StudioLevelsPanel과 동일(라벨 좌측, 우측 슬라이더+readout 고정폭).
const LABEL_ROW = "flex items-center justify-between gap-2 text-xs text-fg-2";
const RANGE_CLASS = "w-24 accent-accent cursor-pointer disabled:cursor-not-allowed disabled:opacity-40";
const READOUT_CLASS = "w-8 text-right text-[10px] tabular-nums text-fg-3";

// 모양이 "없음"이면 휘어짐이 의미가 없어 잠근다 — 잠긴 이유는 컨트롤이 직접 말해야 한다.
const CURVE_LOCKED_REASON = "모양이 \"없음\"이면 휘어짐을 조절할 수 없습니다. 다른 모양을 먼저 고르세요.";

export function StudioTextPathPanel({
  value,
  onPatch,
  onApplyPreset,
  onReset,
}: {
  value: TextPathConfig;
  onPatch: (patch: Partial<TextPathConfig>) => void;
  onApplyPreset: (v: TextPathConfig) => void;
  onReset: () => void;
}): React.ReactElement {
  // 직선(휨 없음)이면 리셋 비활성 + "직선" 프리셋 칩을 활성으로 표시.
  const flat = isFlatTextPath(value);
  // none 모양은 휘어짐 자체가 의미 없으므로 curve 슬라이더를 잠근다.
  const flatShape: TextPathShape = "none";
  const curveDisabled = value.shape === flatShape;

  return (
    <div className="space-y-2">
      {/* 헤더 + 직선 복귀 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">곡선 텍스트 (Path)</p>
        <button
          type="button"
          onClick={onReset}
          disabled={flat}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="경로 효과를 제거하고 직선 텍스트로 되돌립니다."
          // 고급 조판 디스클로저 안에서만 보이므로 advanced. 비활성일 때도 title 이 이유를
          // 말하므로 밀도 감사의 disabled-without-reason 을 통과한다.
          data-inspector-control-id="typography.path.reset"
          data-inspector-priority="advanced"
        >
          <RotateCcw className="size-3.5" />
          직선으로
        </button>
      </div>

      {/* 모양 프리셋 칩 — 모양+휘어짐을 절대값으로 한 번에 덮어쓴다(누적 아님). "직선"은 평탄일 때 활성. */}
      <div className="flex flex-wrap gap-1.5">
        {TEXT_PATH_PRESETS.map((preset) => {
          const active = isFlatTextPath(preset.value) && flat;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApplyPreset(preset.value)}
              title={preset.tip}
              data-inspector-control-id={`typography.path.preset.${preset.id}`}
              data-inspector-priority="advanced"
              className={cn(CHIP_CLASS, active && "border-accent bg-raised text-fg")}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* 경로 모양 셀렉터 — 현재 모양만 강조. curve는 그대로 두고 shape만 패치한다. */}
      <div className="flex flex-wrap gap-1.5">
        {TEXT_PATH_SHAPES.map((s) => {
          const active = s.id === value.shape;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onPatch({ shape: s.id })}
              data-inspector-control-id={`typography.path.shape.${s.id}`}
              data-inspector-priority="advanced"
              className={cn(SHAPE_BTN_CLASS, active && "border-accent bg-raised text-fg")}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* 휘어짐 강도 — 0(평탄)..100(최대 휨). 직선(none)이면 잠근다. */}
      <label className={LABEL_ROW}>
        휘어짐
        <span className="flex items-center gap-1.5">
          <input
            type="range"
            min={TEXT_PATH_CURVE_RANGE.min}
            max={TEXT_PATH_CURVE_RANGE.max}
            step={TEXT_PATH_CURVE_RANGE.step}
            value={value.curve}
            disabled={curveDisabled}
            // 잠긴 이유를 슬라이더 자신이 말한다 — 회색 상자는 사유 없이 두지 않는다
            // (밀도 감사 `disabled-without-reason`).
            title={curveDisabled ? CURVE_LOCKED_REASON : undefined}
            onChange={(e) => onPatch({ curve: Number(e.target.value) })}
            data-inspector-control-id="typography.path.curve"
            data-inspector-priority="advanced"
            className={RANGE_CLASS}
          />
          <span className={READOUT_CLASS}>{value.curve}%</span>
        </span>
      </label>
    </div>
  );
}
