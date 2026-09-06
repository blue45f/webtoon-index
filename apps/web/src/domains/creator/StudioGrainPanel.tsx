/**
 * Studio Grain Panel
 * 선택된 이미지의 그레인/텍스처(Grain) 오버레이 인스펙터 — 원클릭 질감 프리셋 +
 * 질감 종류(필름/종이/주사선/도트) 선택 + 세기·크기·크로마(film 전용) 슬라이더 +
 * 결정적 시드 재생성.
 * studio-grain 엔진의 Grain을 props로 읽고 onPatch/onApplyPreset/onReset으로만 쓴다.
 * StudioPage에서 분리한 순수 프레젠테이션 컴포넌트(상태 없음).
 */
import { RotateCcw } from "lucide-react";

import {
  GRAIN_AMOUNT_RANGE,
  GRAIN_CHROMA_RANGE,
  GRAIN_PRESETS,
  GRAIN_SIZE_RANGE,
  GRAIN_TYPES,
  isIdentityGrain,
  type Grain,
  type GrainType,
} from "./studio-grain";
import { PANEL_LABEL_ROW, PANEL_READOUT_CLASS, StudioPanelChip, StudioSliderRow } from "./studio-panel-ui";

import { buttonClass } from "@/shared/components/ui/button-utils";


// 세기·크기 슬라이더 정의 — 표시 순서·한글 라벨·범위(세기는 amount, 크기는 size).
const GRAIN_SLIDERS: { key: "amount" | "size"; label: string; range: { min: number; max: number; step: number } }[] = [
  { key: "amount", label: "세기", range: GRAIN_AMOUNT_RANGE },
  { key: "size", label: "크기", range: GRAIN_SIZE_RANGE },
];

// 시드 결정적 변환(선형 합동 생성기 1스텝) — Math.random 없이 같은 시드는 항상 같은 다음 값.
// %10000으로 음수가 나올 수 있어 +10000 후 다시 %10000으로 0..9999 양수로 고정한다.
function nextSeed(seed: number): number {
  return (((seed * 1103515245 + 12345) % 10000) + 10000) % 10000;
}

export function StudioGrainPanel({
  value,
  onPatch,
  onApplyPreset,
  onReset,
}: {
  value: Grain;
  onPatch: (patch: Partial<Grain>) => void;
  onApplyPreset: (v: Grain) => void;
  onReset: () => void;
}): React.ReactElement {
  // 항등(세기 0)이면 리셋 비활성 + 어떤 프리셋 칩도 활성으로 표시하지 않는다(빈 프리셋 없음).
  const isIdentity = isIdentityGrain(value);

  return (
    <div className="space-y-2">
      {/* 헤더 + 항등 복귀 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">그레인/텍스처 (Grain)</p>
        <button
          type="button"
          onClick={onReset}
          disabled={isIdentity}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="그레인/텍스처를 제거하고 원본으로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      {/* 원클릭 질감 프리셋 칩 — 절대값으로 덮어쓴다(누적 아님). 항등일 땐 활성 칩 없음. */}
      <div className="flex flex-wrap gap-1.5">
        {GRAIN_PRESETS.map((preset) => (
          <StudioPanelChip key={preset.id} onClick={() => onApplyPreset(preset.value)} title={preset.tip}>
            {preset.label}
          </StudioPanelChip>
        ))}
      </div>

      {/* 질감 종류 선택 — 현재 종류를 활성으로 강조, 누르면 type만 패치(세기·크기·시드 유지). */}
      <div className="flex flex-wrap gap-1.5">
        {GRAIN_TYPES.map((t) => (
          <StudioPanelChip
            key={t.id}
            active={t.id === value.type}
            onClick={() => onPatch({ type: t.id as GrainType })}
            title={`질감을 "${t.label}"로 바꿉니다.`}
          >
            {t.label}
          </StudioPanelChip>
        ))}
      </div>

      {/* 세기·크기 슬라이더 — 범위는 GRAIN_AMOUNT_RANGE·GRAIN_SIZE_RANGE에서. */}
      <div className="space-y-2">
        {GRAIN_SLIDERS.map(({ key, label, range }) => (
          <StudioSliderRow
            key={key}
            label={label}
            min={range.min}
            max={range.max}
            step={range.step}
            value={value[key]}
            onChange={(n) => onPatch({ [key]: n })}
          />
        ))}
        {/* 크로마(색 노이즈) — film 전용이라 다른 질감에서는 비활성. 0이면 기존 휘도 입자와 동일. */}
        <StudioSliderRow
          label="크로마"
          min={GRAIN_CHROMA_RANGE.min}
          max={GRAIN_CHROMA_RANGE.max}
          step={GRAIN_CHROMA_RANGE.step}
          value={value.chroma ?? 0}
          disabled={value.type !== "film"}
          onChange={(n) => onPatch({ chroma: n })}
        />
      </div>

      {/* 시드 — "새 시드"는 결정적으로 다음 시드를 뽑는다(Math.random 없음, 같은 시드=같은 노이즈). */}
      {/* 연결할 폼 컨트롤이 없는 헤딩+액션 행이므로 label 대신 div 사용(칩 버튼이 자체 접근명 보유). */}
      <div className={PANEL_LABEL_ROW}>
        시드(Seed)
        <span className="flex items-center gap-1.5">
          <StudioPanelChip
            onClick={() => onPatch({ seed: nextSeed(value.seed) })}
            title="노이즈 패턴을 결정적으로 다시 뽑습니다(같은 시드는 같은 무늬)."
          >
            새 시드
          </StudioPanelChip>
          <span className={PANEL_READOUT_CLASS}>{value.seed}</span>
        </span>
      </div>
    </div>
  );
}
