/**
 * Studio Gradient Engine Panel
 * 도형/텍스트 공용 그라데이션 인스펙터 — 프리셋 12종 스와치 + 종류(선형/방사) 토글 +
 * 각도 슬라이더(선형) + 멀티스톱(2~5) 색/위치 편집기 + 라이브 미리보기.
 * studio-gradient-engine의 순수 헬퍼로만 스펙을 만들어 onChange로 돌려주는
 * 상태 없는(fully-controlled) 프레젠테이션 컴포넌트. value=null이면 미적용 상태.
 */
import { Plus, RotateCcw, X } from "lucide-react";


import {
  DEFAULT_GRADIENT_SPEC,
  GRADIENT_ANGLE_RANGE,
  GRADIENT_ENGINE_PRESETS,
  GRADIENT_STOPS_MAX,
  GRADIENT_STOPS_MIN,
  GRADIENT_TYPES,
  addGradientStop,
  gradientSpecsEqual,
  gradientToCss,
  normalizeGradientSpec,
  removeGradientStop,
  setGradientAngle,
  setGradientType,
  updateGradientStop,
  type StudioGradientSpec,
} from "./studio-gradient-engine";
import {
  PANEL_LABEL_ROW,
  PANEL_RANGE_CLASS,
  PANEL_READOUT_CLASS,
  StudioPanelChip,
  StudioSliderRow,
  StudioToggleChip,
} from "./studio-panel-ui";

import type { ReactElement } from "react";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

export type StudioGradientEnginePanelProps = {
  /** 현재 요소의 그라데이션 스펙 — null이면 미적용(단색). */
  value: StudioGradientSpec | null;
  /** 스펙 변경/적용 콜백 — null은 해제(단색 복귀). */
  onChange: (spec: StudioGradientSpec | null) => void;
  /** 해제(단색으로) 버튼 노출 — 텍스트처럼 별도 토글이 담당하면 false. 기본 true. */
  allowClear?: boolean;
  /** 섹션 제목 — 기본 "그라데이션". */
  title?: string;
};

/** 프리셋 스와치 그리드 — 미적용/적용 상태 양쪽에서 재사용한다. */
function PresetGrid({
  current,
  onChange,
}: {
  current: StudioGradientSpec | null;
  onChange: (spec: StudioGradientSpec) => void;
}): ReactElement {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {GRADIENT_ENGINE_PRESETS.map((preset) => {
        const active = current != null && gradientSpecsEqual(current, preset.spec);
        return (
          <button
            key={preset.id}
            type="button"
            title={preset.tip}
            aria-pressed={active}
            onClick={() => onChange(normalizeGradientSpec(preset.spec))}
            className={cn(
              "group flex flex-col gap-1 rounded-lg border border-line bg-card p-1.5 text-left transition-colors hover:bg-raised",
              active && "border-accent bg-raised"
            )}
          >
            <span
              aria-hidden
              className="h-6 w-full rounded-md border border-line/60"
              style={{ background: gradientToCss(preset.spec) }}
            />
            <span className={cn("truncate text-[0.6rem] text-fg-2 group-hover:text-fg", active && "text-fg")}>
              {preset.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function StudioGradientEnginePanel({
  value,
  onChange,
  allowClear = true,
  title = "그라데이션",
}: StudioGradientEnginePanelProps): ReactElement {
  // 문서(localStorage)에서 온 값일 수 있으므로 항상 정규화해 다룬다 — 컨트롤이 안전한 값만 본다.
  const current = value == null ? null : normalizeGradientSpec(value);

  return (
    <div className="space-y-2">
      {/* 헤더 + 해제(단색 복귀) */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">{title}</p>
        {allowClear && (
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={current == null}
            className={buttonClass({ size: "sm", variant: "quiet" })}
            title="그라데이션을 제거하고 단색 채우기로 되돌립니다."
          >
            <RotateCcw className="size-3.5" />
            단색으로
          </button>
        )}
      </div>

      {current == null ? (
        <>
          {/* 미적용 — 프리셋에서 시작하거나 기본 스펙으로 직접 만들기 */}
          <p className="text-[0.66rem] text-fg-3">프리셋을 고르거나 직접 만들어 적용합니다.</p>
          <PresetGrid current={null} onChange={onChange} />
          <StudioPanelChip
            onClick={() => onChange(normalizeGradientSpec(DEFAULT_GRADIENT_SPEC))}
            title="기본 2색 선형 그라데이션에서 시작해 색·각도를 직접 편집합니다."
          >
            + 직접 만들기
          </StudioPanelChip>
        </>
      ) : (
        <>
          {/* 라이브 미리보기 — 캔버스와 동일 기하(CSS 각도 규약·farthest-corner) */}
          <div
            aria-hidden
            className="h-8 w-full rounded-lg border border-line/60"
            style={{ background: gradientToCss(current) }}
          />

          {/* 종류 — 선형(각도) / 방사(중심에서 퍼짐) */}
          <div className={PANEL_LABEL_ROW}>
            종류
            <span className="flex items-center gap-1.5">
              {GRADIENT_TYPES.map((t) => (
                <StudioToggleChip
                  key={t.id}
                  active={current.type === t.id}
                  onClick={() => onChange(setGradientType(current, t.id))}
                  title={t.id === "linear" ? "지정한 각도 방향으로 색이 흐릅니다." : "중심에서 바깥으로 색이 퍼집니다."}
                >
                  {t.label}
                </StudioToggleChip>
              ))}
            </span>
          </div>

          {/* 각도 — 선형 전용(0°=위, 90°=오른쪽, CSS와 동일) */}
          {current.type === "linear" && (
            <StudioSliderRow
              label="각도"
              min={GRADIENT_ANGLE_RANGE.min}
              max={GRADIENT_ANGLE_RANGE.max}
              step={GRADIENT_ANGLE_RANGE.step}
              value={Math.round(current.angleDeg)}
              onChange={(deg) => onChange(setGradientAngle(current, deg))}
              readout={`${Math.round(current.angleDeg)}°`}
            />
          )}

          {/* 색 단계(2~5) — 색상 + 위치(이웃 사이로 클램프되어 순서가 유지됨) + 삭제 */}
          <div className="space-y-1.5">
            {current.stops.map((stop, i) => (
              <div key={i} className={PANEL_LABEL_ROW}>
                <span className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={stop.color}
                    onChange={(e) => onChange(updateGradientStop(current, i, { color: e.target.value }))}
                    aria-label={`색 단계 ${i + 1} 색상`}
                    className="h-7 w-7 cursor-pointer rounded border border-line bg-card"
                  />
                  <span className="text-[10px] tabular-nums text-fg-3">{i + 1}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(stop.offset * 100)}
                    onChange={(e) => onChange(updateGradientStop(current, i, { offset: Number(e.target.value) / 100 }))}
                    aria-label={`색 단계 ${i + 1} 위치`}
                    className={PANEL_RANGE_CLASS}
                  />
                  <span className={PANEL_READOUT_CLASS}>{Math.round(stop.offset * 100)}%</span>
                  <button
                    type="button"
                    onClick={() => onChange(removeGradientStop(current, i))}
                    disabled={current.stops.length <= GRADIENT_STOPS_MIN}
                    aria-label={`색 단계 ${i + 1} 삭제`}
                    title={current.stops.length <= GRADIENT_STOPS_MIN ? "색 단계는 최소 2개가 필요합니다." : "이 색 단계를 삭제합니다."}
                    className="rounded-md border border-line bg-card p-1 text-fg-2 transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              </div>
            ))}
            <StudioPanelChip
              onClick={() => {
                if (current.stops.length < GRADIENT_STOPS_MAX) onChange(addGradientStop(current));
              }}
              title={
                current.stops.length < GRADIENT_STOPS_MAX
                  ? "가장 넓은 구간의 중앙에 중간색 단계를 추가합니다."
                  : "색 단계는 최대 5개까지입니다."
              }
            >
              <span className="inline-flex items-center gap-1">
                <Plus className="size-3" />색 추가 ({current.stops.length}/{GRADIENT_STOPS_MAX})
              </span>
            </StudioPanelChip>
          </div>

          {/* 프리셋 — 스펙 전체를 교체 적용(누적 아님) */}
          <PresetGrid current={current} onChange={onChange} />
        </>
      )}
    </div>
  );
}
