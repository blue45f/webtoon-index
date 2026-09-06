/**
 * Studio Dodge/Burn Panel
 * 닷지·번·스펀지 브러시 컨트롤 — 켜면 메인 캔버스에서 선택된 이미지 위 드래그가 톤/채도 보정
 * 스트로크로 처리된다. 이 패널 자신은 드래그도 픽셀 보정도 하지 않는 순수 컨트롤(무장 토글 +
 * 모드/톤 범위/스펀지 방향 선택 + 크기·경도·노출 슬라이더)이다 — 실제 스트로크 수집·비동기
 * 적용은 StudioPage 의 onStageDown/onStageMove/onStageUp/applyDodgeBurnStroke 가 담당한다
 * (문지르기·복구 브러시와 동일하게 "패널은 상태만 보여주고 캔버스 제스처는 상위가 처리").
 *
 * 실시간 픽셀 미리보기는 없다 — 브러시 반경 커서만 드래그 중 표시되고, 실제 보정은 드래그(한
 * 스트로크) 종료 시 한 번에 적용된다(smudge 와 동일한 "제스처 1회 = 커밋 1회" 관례 → undo 1스텝).
 *
 * 완전히 controlled — 내부 비즈니스 상태 없음(StudioSmudgePanel/StudioHealClonePanel 과 동일
 * 관례). 톤 범위 칩은 닷지/번 모드에서만, 스펀지 방향 칩은 스펀지 모드에서만 노출된다.
 */
import { Contrast } from "lucide-react";
import { useId } from "react";

import {
  DODGE_BURN_EXPOSURE_RANGE,
  DODGE_BURN_HARDNESS_RANGE,
  DODGE_BURN_MODES,
  DODGE_BURN_RADIUS_RANGE,
  DODGE_BURN_RANGES,
  DODGE_BURN_SPONGE_MODES,
  type DodgeBurnMode,
  type DodgeBurnRange,
  type DodgeBurnSpongeMode,
} from "./studio-dodge-burn";
import { StudioSliderRow, StudioToggleChip } from "./studio-panel-ui";
import { studioRetouchToolHelp } from "./studio-retouch-help";
import { StudioRetouchQuickGuide } from "./StudioRetouchQuickGuide";

import type { ReactElement } from "react";

const DODGE_BURN_ACTION_LABELS: Readonly<Record<DodgeBurnMode, string>> = {
  dodge: "밝게 · 닷지",
  burn: "어둡게 · 번",
  sponge: "채도 · 스펀지",
};

export type StudioDodgeBurnPanelProps = {
  /** 닷지/번 브러시가 무장(켜짐) 상태인지. */
  active: boolean;
  /** 현재 모드 — 닷지(밝게)/번(어둡게)/스펀지(채도). */
  mode: DodgeBurnMode;
  /** 닷지/번의 톤 범위(스펀지 모드에선 숨김). */
  range: DodgeBurnRange;
  /** 스펀지 하위 동작(닷지/번 모드에선 숨김). */
  sponge: DodgeBurnSpongeMode;
  /** 브러시 반경(캔버스 표시 px, DODGE_BURN_RADIUS_RANGE). */
  radiusPx: number;
  /** 경도(0..1, DODGE_BURN_HARDNESS_RANGE) — 1=하드 엣지, 0=최대 페더. */
  hardness: number;
  /** 노출(%, DODGE_BURN_EXPOSURE_RANGE). */
  exposure: number;
  /** 스트로크 커밋(픽셀 재인코딩) 진행 중 — 컨트롤을 잠그고 스피너를 표시한다. */
  busy?: boolean;
  /** 대상 없음/잠금 등 상위 게이트 — 모든 컨트롤을 비활성화한다. */
  disabled?: boolean;
  onToggleActive: () => void;
  onModeChange: (mode: DodgeBurnMode) => void;
  onRangeChange: (range: DodgeBurnRange) => void;
  onSpongeChange: (sponge: DodgeBurnSpongeMode) => void;
  onRadiusChange: (value: number) => void;
  onHardnessChange: (value: number) => void;
  onExposureChange: (value: number) => void;
  onOpenTutorial?: () => void;
};

export function StudioDodgeBurnPanel({
  active,
  mode,
  range,
  sponge,
  radiusPx,
  hardness,
  exposure,
  busy = false,
  disabled = false,
  onToggleActive,
  onModeChange,
  onRangeChange,
  onSpongeChange,
  onRadiusChange,
  onHardnessChange,
  onExposureChange,
  onOpenTutorial,
}: StudioDodgeBurnPanelProps): ReactElement {
  const titleId = useId();
  const help = studioRetouchToolHelp("dodge-burn");
  const locked = disabled || busy;

  return (
    <section
      className="mt-2.5 space-y-2 rounded-xl border border-line bg-card/45 p-2.5"
      aria-labelledby={titleId}
    >
      <div className="min-w-0">
        <h3
          id={titleId}
          aria-label={`${help.actionName} · ${help.technicalName}`}
          className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-semibold tracking-tight text-fg-2"
        >
          <Contrast size={12} aria-hidden />
          {help.actionName}
          <span className="text-[0.66rem] font-medium text-fg-3">{help.technicalName}</span>
        </h3>
        <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3 text-pretty">
          {help.summary}
        </p>
      </div>

      <StudioToggleChip
        active={active}
        disabled={locked}
        onClick={onToggleActive}
        aria-label={`${help.actionName} ${active ? "끄기" : "켜기"}`}
        title={`${help.summary} 결과는 손을 뗄 때 한 획으로 반영됩니다.`}
      >
        <span className="inline-flex items-center gap-1">
          <Contrast className="size-3" aria-hidden />
          {active ? "밝기·채도 보정 끝내기" : "밝기·채도 보정 시작"}
        </span>
      </StudioToggleChip>

      <div className="flex flex-wrap gap-1.5">
        {DODGE_BURN_MODES.map((m) => (
          <StudioToggleChip
            key={m.id}
            active={mode === m.id}
            disabled={locked}
            onClick={() => onModeChange(m.id)}
            title={m.tip}
          >
            {DODGE_BURN_ACTION_LABELS[m.id]}
          </StudioToggleChip>
        ))}
      </div>

      {mode === "sponge" ? (
        <div className="flex flex-wrap gap-1.5">
          {DODGE_BURN_SPONGE_MODES.map((m) => (
            <StudioToggleChip
              key={m.id}
              active={sponge === m.id}
              disabled={locked}
              onClick={() => onSpongeChange(m.id)}
              title={m.tip}
            >
              {m.label}
            </StudioToggleChip>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {DODGE_BURN_RANGES.map((r) => (
            <StudioToggleChip
              key={r.id}
              active={range === r.id}
              disabled={locked}
              onClick={() => onRangeChange(r.id)}
              title={r.tip}
            >
              {r.label}
            </StudioToggleChip>
          ))}
        </div>
      )}

      <StudioSliderRow
        label="브러시 크기"
        min={DODGE_BURN_RADIUS_RANGE.min}
        max={DODGE_BURN_RADIUS_RANGE.max}
        step={DODGE_BURN_RADIUS_RANGE.step}
        value={radiusPx}
        disabled={locked}
        onChange={onRadiusChange}
        readout={`${radiusPx}px`}
      />

      <StudioSliderRow
        label="가장자리 단단함"
        min={DODGE_BURN_HARDNESS_RANGE.min}
        max={DODGE_BURN_HARDNESS_RANGE.max}
        step={DODGE_BURN_HARDNESS_RANGE.step}
        value={hardness}
        disabled={locked}
        onChange={onHardnessChange}
        readout={`${Math.round(hardness * 100)}%`}
      />

      <StudioSliderRow
        label="효과 강도 · 노출"
        min={DODGE_BURN_EXPOSURE_RANGE.min}
        max={DODGE_BURN_EXPOSURE_RANGE.max}
        step={DODGE_BURN_EXPOSURE_RANGE.step}
        value={exposure}
        disabled={locked}
        onChange={onExposureChange}
        readout={`${exposure}%`}
      />

      <StudioRetouchQuickGuide
        toolId="dodge-burn"
        active={active}
        busy={busy}
        disabled={disabled}
        onOpenTutorial={onOpenTutorial}
      />
    </section>
  );
}
