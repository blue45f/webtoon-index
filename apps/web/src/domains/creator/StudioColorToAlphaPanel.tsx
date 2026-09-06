/**
 * Studio Color to Alpha Panel
 * 선택된 이미지의 색상 투명화(Color to Alpha) 인스펙터 — 원클릭 배경색 프리셋 +
 * 키 색상(스와치+스포이드) + 강도(strength) 슬라이더.
 * studio-color-to-alpha 엔진의 ColorToAlpha를 props로 읽고 onPatch/onApplyPreset/onReset으로만 쓴다.
 * StudioPage에서 분리한 순수 프레젠테이션 컴포넌트(상태 없음).
 */
import { Pipette, RotateCcw } from "lucide-react";

import {
  COLOR_TO_ALPHA_PRESETS,
  COLOR_TO_ALPHA_STRENGTH_RANGE,
  isIdentityColorToAlpha,
  type ColorToAlpha,
} from "./studio-color-to-alpha";
import { StudioSliderRow, StudioSwatchChip } from "./studio-panel-ui";

import { buttonClass } from "@/shared/components/ui/button-utils";

// EyeDropper는 일부 브라우저에만 있는 실험적 API — 타입 정의가 없어 좁은 형태만 선언한다.
// StudioColorPopover.tsx의 getEyeDropperCtor와 동일한 패턴을 이 패널 안에 독립적으로 둔다 —
// 화면의 실제 배경 픽셀을 정확히 뽑는 게 이 기능의 핵심이라 스와치만으론 부족하지만, 전역
// 캔버스 스포이드 도구(eyedropperActive/onStageDown)와는 무관하게 동작해야 하기 때문이다.
type EyeDropperResult = { sRGBHex: string };
type EyeDropperLike = { open: () => Promise<EyeDropperResult> };
type EyeDropperCtor = new () => EyeDropperLike;

function getEyeDropperCtor(): EyeDropperCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  return typeof ctor === "function" ? ctor : null;
}

export type StudioColorToAlphaPanelProps = {
  value: ColorToAlpha;
  onPatch: (patch: Partial<ColorToAlpha>) => void;
  onApplyPreset: (v: ColorToAlpha) => void;
  onReset: () => void;
};

export function StudioColorToAlphaPanel({
  value,
  onPatch,
  onApplyPreset,
  onReset,
}: StudioColorToAlphaPanelProps): React.ReactElement {
  // strength 0(투명화 없음)이면 리셋 비활성 + "없음" 프리셋 칩을 활성으로 표시.
  const isIdentity = isIdentityColorToAlpha(value);
  const eyeDropperCtor = getEyeDropperCtor();

  return (
    <div className="space-y-2">
      {/* 헤더 + 항등 복귀 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">
          색상 투명화 (Color to Alpha)
        </p>
        <button
          type="button"
          onClick={onReset}
          disabled={isIdentity}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="색상 투명화를 제거하고 원본으로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      {/* 원클릭 배경색 프리셋 칩 — 절대값으로 덮어쓴다(누적 아님). 스와치는 프리셋 키 색으로 칠한다. */}
      <div className="flex flex-wrap gap-1.5">
        {COLOR_TO_ALPHA_PRESETS.map((preset) => (
          <StudioSwatchChip
            key={preset.id}
            color={preset.value.keyColor}
            label={preset.label}
            active={preset.id === "none" && isIdentity}
            title={preset.tip}
            onClick={() => onApplyPreset(preset.value)}
          />
        ))}
      </div>

      {/* 키 색상 — input[type=color]는 빈 값 불가라 항상 #rrggbb를 들고 있다. 스포이드는
          화면의 실제 픽셀을 직접 샘플링(feature-detect, 지원 브라우저에서만 렌더). */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-fg-2">
          키 색상
          <input
            type="color"
            value={value.keyColor}
            onChange={(e) => onPatch({ keyColor: e.target.value })}
            className="h-7 w-7 cursor-pointer rounded border border-line bg-card"
          />
        </label>
        {eyeDropperCtor && (
          <button
            type="button"
            aria-label="스포이드로 키 색상 추출"
            title="스포이드로 화면에서 키 색상을 추출합니다."
            onClick={() => {
              const ed = new eyeDropperCtor();
              ed.open()
                .then((r) => onPatch({ keyColor: r.sRGBHex }))
                .catch(() => {});
            }}
            className="grid h-7 w-7 shrink-0 place-items-center rounded border border-line text-fg-2 hover:bg-raised hover:text-fg"
          >
            <Pipette className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      {/* 강도(strength) 슬라이더 — 범위는 COLOR_TO_ALPHA_STRENGTH_RANGE에서. 0이면 항등. */}
      <StudioSliderRow
        label="강도 (Strength)"
        min={COLOR_TO_ALPHA_STRENGTH_RANGE.min}
        max={COLOR_TO_ALPHA_STRENGTH_RANGE.max}
        step={COLOR_TO_ALPHA_STRENGTH_RANGE.step}
        value={value.strength}
        onChange={(n) => onPatch({ strength: n })}
        readout={`${value.strength}%`}
      />

      {/* 안내 문구 */}
      <p className="text-[0.72rem] leading-relaxed text-fg-3" role="status">
        키 색상과 정확히 같은 픽셀은 완전히 투명해지고, 비슷할수록 부분 투명해져 스캔 원고 가장자리의
        앤티앨리어싱이 자연스럽게 유지돼요. 흰 종이 배경을 지울 때 특히 유용합니다.
      </p>
    </div>
  );
}
