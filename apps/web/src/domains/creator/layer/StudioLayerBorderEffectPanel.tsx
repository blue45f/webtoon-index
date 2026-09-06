/**
 * Studio Layer Border Effect Panel
 * CSP 경계 효과(境界効果/fuchi) — 선택한 이미지 레이어의 비파괴 테두리 설정.
 *
 * 순수 프레젠테이션 컴포넌트(상태 없음): value를 읽고 onChange로 정규화된 절대값
 * 교체를 알린다. 픽셀 적용은 래스터 렌더 경로의
 * `render/studio-layer-border-effect-compositor.ts`가 정본이고, 이 패널은 문서의
 * `el.borderEffect` 레시피만 편집한다(핫패스 무접점 — 프레임당 React 렌더 없음).
 */

import {
  DEFAULT_STUDIO_LAYER_BORDER_EFFECT,
  normalizeStudioLayerBorderEffect,
  STUDIO_LAYER_BORDER_EFFECT_THICKNESS_RANGE,
  type StudioLayerBorderEffectSettings,
  type StudioLayerBorderEffectType,
} from "./studio-layer-border-effect";

import { cn } from "@/shared/lib/utils";

const LABEL_ROW = "flex items-center justify-between gap-2 text-xs text-fg-2";
const RANGE_CLASS = "w-24 accent-accent cursor-pointer";
const READOUT_CLASS = "w-8 text-right text-[10px] tabular-nums text-fg-3";
const TYPE_CHIP_CLASS =
  "rounded-md border border-line bg-card px-2 py-0.5 text-[0.6rem] text-fg-2 transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-50";

const BORDER_TYPE_OPTIONS: ReadonlyArray<{
  id: StudioLayerBorderEffectType;
  label: string;
  tip: string;
}> = [
  { id: "outer", label: "바깥", tip: "실루엣 바깥쪽에 테두리를 그립니다." },
  { id: "inner", label: "안쪽", tip: "실루엣 안쪽에 테두리를 그립니다." },
  { id: "center", label: "중앙", tip: "실루엣 경계를 중심으로 양쪽에 그립니다." },
];

// input[type=color]는 rgba() 문자열을 못 먹는다 — hex가 아니면 검정 폴백으로 보여준다.
function colorInputValue(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#000000";
}

export function StudioLayerBorderEffectPanel({
  value,
  disabled,
  onChange,
}: {
  /** 선택 이미지 레이어의 `el.borderEffect`(미설정이면 효과 없음). */
  value?: StudioLayerBorderEffectSettings;
  disabled?: boolean;
  /** 정규화된 절대값 교체 콜백 — patchEl 한 번이 undo 한 번이 된다. */
  onChange: (next: StudioLayerBorderEffectSettings) => void;
}): React.ReactElement {
  const current = normalizeStudioLayerBorderEffect(value);
  // 저장돼 있던 유효 굵기가 없으면 켤 때 기본 굵기부터 시작한다(0px 테두리는 항등이라 무의미).
  const effectiveThickness =
    current.thickness > 0 ? current.thickness : DEFAULT_STUDIO_LAYER_BORDER_EFFECT.thickness;

  const patch = (partial: Partial<StudioLayerBorderEffectSettings>): void => {
    onChange(
      normalizeStudioLayerBorderEffect({ ...current, thickness: effectiveThickness, ...partial }),
    );
  };
  const controlsDisabled = disabled || !current.enabled;

  return (
    <section
      role="group"
      aria-label="레이어 경계 효과"
      data-studio-layer-border-effect-panel
      className="shrink-0 space-y-2 rounded-xl border border-line bg-panel/40 p-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">
          경계 효과 (레이어 테두리)
        </p>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-fg-2">
          <input
            type="checkbox"
            aria-label="경계 효과 사용"
            className="accent-accent"
            checked={current.enabled}
            disabled={disabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          사용
        </label>
      </div>

      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="경계 효과 종류">
        {BORDER_TYPE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={current.type === option.id}
            title={option.tip}
            disabled={controlsDisabled}
            onClick={() => patch({ type: option.id })}
            className={cn(
              TYPE_CHIP_CLASS,
              current.type === option.id && "border-accent bg-raised text-fg",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <label className={LABEL_ROW}>
        <span>굵기</span>
        <span className="flex items-center gap-1.5">
          <input
            type="range"
            aria-label="경계 굵기"
            min={STUDIO_LAYER_BORDER_EFFECT_THICKNESS_RANGE.min}
            max={STUDIO_LAYER_BORDER_EFFECT_THICKNESS_RANGE.max}
            step={1}
            value={Math.round(effectiveThickness)}
            disabled={controlsDisabled}
            onChange={(e) => patch({ thickness: Number(e.target.value) })}
            className={RANGE_CLASS}
          />
          <span className={READOUT_CLASS}>{Math.round(effectiveThickness)}px</span>
        </span>
      </label>

      <div className={LABEL_ROW}>
        <span>색</span>
        <input
          type="color"
          aria-label="경계 색"
          value={colorInputValue(current.color)}
          disabled={controlsDisabled}
          onChange={(e) => patch({ color: e.target.value })}
          className="h-6 w-10 cursor-pointer rounded border border-line bg-card"
        />
      </div>

      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-fg-2">
        <input
          type="checkbox"
          aria-label="경계 부드럽게"
          className="accent-accent"
          checked={current.antiAliased !== false}
          disabled={controlsDisabled}
          onChange={(e) => patch({ antiAliased: e.target.checked })}
        />
        가장자리 부드럽게
      </label>
    </section>
  );
}
