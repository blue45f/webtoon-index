// 페이지 전체 색보정 패널 — 페이지 그레이드(밝기/대비/채도/색조/세피아/흑백/비네트)
// 슬라이더 + 무드 프리셋 칩. 표시 전용(로컬 상태 없음): 값은 grade로 받고 변경은 콜백으로 위임한다.
import { RotateCcw } from "lucide-react";

import {
  isDefaultPageGrade,
  PAGE_GRADE_PRESETS,
  PAGE_GRADE_RANGES,
  type PageGrade,
  type PageGradePreset,
} from "./studio-page-grade";

import { buttonClass } from "@/shared/components/ui/button-utils";

// 슬라이더 한 줄 메타 — 표시 순서/라벨/읽기값 포맷을 한곳에 고정한다.
type GradeRow = {
  key: keyof PageGrade;
  label: string;
  format: (value: number) => string;
};

// 0..1 비율(세피아/흑백/비네트)은 퍼센트로, 색조는 도(°)로, 나머지는 소수 둘째 자리로 읽는다.
const asPercent = (value: number): string => `${Math.round(value * 100)}%`;
const asDegrees = (value: number): string => `${value}°`;
const asScalar = (value: number): string => value.toFixed(2);

// 표시 순서 고정: 밝기 → 대비 → 채도 → 색조 → 세피아 → 흑백 → 비네트.
const GRADE_ROWS: GradeRow[] = [
  { key: "brightness", label: "밝기", format: asScalar },
  { key: "contrast", label: "대비", format: asScalar },
  { key: "saturation", label: "채도", format: asScalar },
  { key: "hue", label: "색조", format: asDegrees },
  { key: "sepia", label: "세피아", format: asPercent },
  { key: "grayscale", label: "흑백", format: asPercent },
  { key: "vignette", label: "비네트(주변 어둡게)", format: asPercent },
];

export function StudioPageGradePanel({
  grade,
  onPatch,
  onApplyPreset,
  onReset,
}: {
  grade: PageGrade;
  onPatch: (patch: Partial<PageGrade>) => void;
  onApplyPreset: (grade: PageGrade) => void;
  onReset: () => void;
}): React.ReactElement {
  const isDefault = isDefaultPageGrade(grade);

  return (
    <div className="space-y-3">
      {/* 헤더 + 초기화(기본값일 땐 비활성) */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">페이지 색보정 (전체 톤)</p>
        <button
          type="button"
          onClick={onReset}
          disabled={isDefault}
          title="페이지 색보정 초기화"
          className={buttonClass({ variant: "quiet", size: "sm", className: "h-7 gap-1 px-2 text-xs" })}
        >
          <RotateCcw className="size-3.5" aria-hidden />
          초기화
        </button>
      </div>

      {/* 무드 프리셋 칩 — 클릭 시 프리셋 grade 전체를 적용 */}
      <div className="flex flex-wrap gap-1.5">
        {PAGE_GRADE_PRESETS.map((preset: PageGradePreset) => (
          <button
            key={preset.id}
            type="button"
            title={preset.tip}
            onClick={() => onApplyPreset(preset.grade)}
            className="rounded text-xs px-2 py-1 bg-card border border-line text-fg-2 hover:bg-raised hover:text-fg transition-colors"
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* 각 그레이드 항목 슬라이더 — 범위는 PAGE_GRADE_RANGES, 변경은 onPatch로 위임 */}
      <div className="space-y-2">
        {GRADE_ROWS.map(({ key, label, format }) => {
          const range = PAGE_GRADE_RANGES[key];
          const value = grade[key];
          return (
            <label key={key} className="flex items-center justify-between gap-2 text-xs text-fg-2">
              {label}
              <span className="flex items-center gap-1.5">
                <input
                  type="range"
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  value={value}
                  onChange={(e) => onPatch({ [key]: Number(e.target.value) } as Partial<PageGrade>)}
                  className="w-24 accent-accent cursor-pointer"
                />
                <span className="w-9 text-right text-[10px] tabular-nums text-fg-3">{format(value)}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
