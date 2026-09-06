/**
 * Studio Text Effect Panel
 * 효과음(SFX)/대사 텍스트 연출 원클릭 프리셋 칩 — 외곽선/그림자/그라디언트 스타일을
 * 한 번에 텍스트에 입힌다. StudioPage에서 분리한 순수 프레젠테이션 컴포넌트(상태 없음).
 * 칩을 누르면 reset 후 프리셋을 덮어써 절대값으로 적용한다(누적 아님).
 */
import { RotateCcw, Type } from "lucide-react";

import { TEXT_FX_PRESETS, textFxResetPatch, type TextFxPatch } from "./studio-text-effects";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";


// 칩 기본 스타일 — StudioImageFilterPanel과 동일한 하우스 칩.
const CHIP_CLASS =
  "rounded-md border border-line bg-card px-2 py-0.5 text-[0.6rem] text-fg-2 transition-colors hover:bg-raised hover:text-fg";

/**
 * 칩 라벨에 입힐 인라인 스타일 — 효과를 살짝 미리보기한다(순수 함수, 결정적).
 * - 그라디언트 프리셋: 시작/끝 색으로 글자 자체를 그라디언트 처리.
 * - 그 외: stroke/그림자가 있으면 옅은 text-shadow로 입체감만 힌트.
 * 색 값이 없으면 칩 기본 텍스트 색을 그대로 쓰도록 빈 스타일을 반환한다.
 */
function chipLabelStyle(patch: TextFxPatch): React.CSSProperties {
  const style: React.CSSProperties = {};

  if (patch.fillType === "gradient" && patch.gradientColorStart && patch.gradientColorEnd) {
    // 가로/세로 방향에 맞춰 글자를 그라디언트로 칠한다(배경을 글자 모양으로 클립).
    const angle = patch.gradientDirection === "horizontal" ? "to right" : "to bottom";
    style.backgroundImage = `linear-gradient(${angle}, ${patch.gradientColorStart}, ${patch.gradientColorEnd})`;
    style.backgroundClip = "text";
    style.WebkitBackgroundClip = "text";
    style.color = "transparent";
    style.fontWeight = 700;
    return style;
  }

  // 단색 글자색이 지정되면 그대로 반영(흰 글자는 가독성 위해 옅은 외곽 그림자 추가).
  if (patch.fill) style.color = patch.fill;

  // 외곽선/그림자가 있는 프리셋은 옅은 그림자로 입체감만 힌트(과하지 않게).
  const shadows: string[] = [];
  if (patch.strokeWidth && patch.stroke) {
    shadows.push(`0 0 1px ${patch.stroke}`);
  }
  if (patch.shadowColor && (patch.shadowBlur || patch.shadowOffsetX || patch.shadowOffsetY)) {
    shadows.push(`0 1px 2px ${patch.shadowColor}`);
  }
  if (shadows.length > 0) style.textShadow = shadows.join(", ");
  if (patch.fontStyle?.includes("bold")) style.fontWeight = 700;

  return style;
}

export function StudioTextEffectPanel({
  onApply,
}: {
  onApply: (patch: TextFxPatch) => void;
}): React.ReactElement {
  return (
    <div className="space-y-2">
      {/* 헤더 + 기본(효과 제거) */}
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">
          <Type className="size-3.5" />
          텍스트 연출 프리셋
        </p>
        <button
          type="button"
          onClick={() => onApply(textFxResetPatch())}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="모든 텍스트 효과를 제거하고 원본 스타일로 되돌립니다."
          // 고급 조판 디스클로저 안에서만 보이므로 advanced. 선언이 없으면 밀도 감사가
          // unclassified-control 로 잡는다(그게 이 속성이 있는 이유다).
          data-inspector-control-id="typography.fx.reset"
          data-inspector-priority="advanced"
        >
          <RotateCcw className="size-3.5" />
          기본
        </button>
      </div>

      {/* 프리셋 칩 — reset 후 적용해 절대값으로 덮어쓴다(누적 아님). */}
      <div className="flex flex-wrap gap-1.5">
        {TEXT_FX_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onApply({ ...textFxResetPatch(), ...preset.patch })}
            title={preset.tip}
            data-inspector-control-id={`typography.fx.preset.${preset.id}`}
            data-inspector-priority="advanced"
            // 그라디언트 프리셋 칩은 라벨이 transparent라 살짝 굵게 보이도록 폰트 가중치를 준다.
            className={cn(CHIP_CLASS, preset.patch.fillType === "gradient" && "font-semibold")}
          >
            <span style={chipLabelStyle(preset.patch)}>{preset.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
