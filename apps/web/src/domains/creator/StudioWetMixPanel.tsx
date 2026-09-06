/**
 * Studio Wet Mix Panel
 * 혼색 브러시 컨트롤 — 켜면 메인 캔버스에서 선택된 이미지 위 드래그가 혼색 스트로크로 처리된다.
 * 현재 그리기 색을 칠하면서 지나간 자리의 바닥색을 붓에 머금어(묻힘율) 함께 섞어(혼색율) 얹는
 * CSP 색혼합 브러시 — 기존 스머지(밀기만)와 달리 새 안료를 얹을 수 있다.
 *
 * 이 패널 자신은 드래그도 픽셀 블렌드도 하지 않는 순수 컨트롤(무장 토글 + 크기·도포량·혼색율·
 * 묻힘율·경도 슬라이더)이다 — 실제 스트로크 수집·비동기 적용은 StudioPage 의
 * onStageDown/onStageMove/onStageUp/applyWetMixStroke 가 담당한다(문지르기·닷지/번과 동일하게
 * "패널은 상태만 보여주고 캔버스 제스처는 상위가 처리").
 *
 * 실시간 픽셀 미리보기는 없다 — 브러시 반경 커서만 드래그 중 표시되고, 실제 혼색은 드래그(한
 * 스트로크) 종료 시 한 번에 적용된다(smudge/dodge-burn 과 동일한 "제스처 1회 = 커밋 1회" 관례
 * → undo 1스텝).
 *
 * 완전히 controlled — 내부 비즈니스 상태 없음(StudioSmudgePanel/StudioDodgeBurnPanel 과 동일
 * 관례). busy/disabled 잠금은 StudioDodgeBurnPanel 의 locked 규약을 따른다.
 */
import { Droplets } from "lucide-react";
import { useId } from "react";

import {
  WET_MIX_HARDNESS_RANGE,
  WET_MIX_PICKUP_RANGE,
  WET_MIX_RADIUS_RANGE,
  WET_MIX_STRENGTH_RANGE,
  WET_MIX_WETNESS_RANGE,
} from "./brush/studio-wet-mix";
import { StudioSliderRow, StudioToggleChip } from "./studio-panel-ui";
import { studioRetouchToolHelp } from "./studio-retouch-help";
import { StudioRetouchQuickGuide } from "./StudioRetouchQuickGuide";

import type { ReactElement } from "react";

export type StudioWetMixPanelProps = {
  /** 혼색 브러시가 무장(켜짐) 상태인지. */
  active: boolean;
  /** 브러시 반경(캔버스 표시 px, WET_MIX_RADIUS_RANGE). */
  radius: number;
  /** 도포량(%, WET_MIX_STRENGTH_RANGE) — 한 번 지날 때 얹히는 안료의 양. */
  strength: number;
  /** 혼색율(%, WET_MIX_WETNESS_RANGE) — 바닥색이 섞이는 비율(0=현재 색만). */
  wetness: number;
  /** 묻힘율(%, WET_MIX_PICKUP_RANGE) — 붓이 바닥색을 새로 머금는 속도. */
  pickup: number;
  /** 경도(0..1, WET_MIX_HARDNESS_RANGE) — 1=하드 엣지, 0=최대 페더. */
  hardness: number;
  /** 현재 그리기 색(CSS 색 문자열) — 어떤 안료가 섞이는지 스와치로 보여준다. */
  paintColor: string;
  /** 스트로크 커밋(픽셀 재인코딩) 진행 중 — 컨트롤을 잠그고 스피너를 표시한다. */
  busy?: boolean;
  /** 대상 없음/잠금 등 상위 게이트 — 모든 컨트롤을 비활성화한다. */
  disabled?: boolean;
  onToggleActive: () => void;
  onRadiusChange: (value: number) => void;
  onStrengthChange: (value: number) => void;
  onWetnessChange: (value: number) => void;
  onPickupChange: (value: number) => void;
  onHardnessChange: (value: number) => void;
  onOpenTutorial?: () => void;
};

export function StudioWetMixPanel({
  active,
  radius,
  strength,
  wetness,
  pickup,
  hardness,
  paintColor,
  busy = false,
  disabled = false,
  onToggleActive,
  onRadiusChange,
  onStrengthChange,
  onWetnessChange,
  onPickupChange,
  onHardnessChange,
  onOpenTutorial,
}: StudioWetMixPanelProps): ReactElement {
  const titleId = useId();
  const help = studioRetouchToolHelp("wet-mix");
  const locked = disabled || busy;

  return (
    <section
      className="mt-2.5 space-y-2 rounded-xl border border-line bg-card/45 p-2.5"
      aria-labelledby={titleId}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3
            id={titleId}
            aria-label={`${help.actionName} · ${help.technicalName}`}
            className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-semibold tracking-tight text-fg-2"
          >
            <Droplets size={12} aria-hidden />
            {help.actionName}
            <span className="text-[0.66rem] font-medium text-fg-3">{help.technicalName}</span>
          </h3>
          <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3 text-pretty">
            {help.summary}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <span
            role="img"
            aria-label="현재 칠할 색"
            title="현재 그리기 색 — 이 색이 안료로 섞입니다."
            data-testid="wet-mix-paint-swatch"
            className="size-3.5 shrink-0 rounded-md border border-line/50 shadow-[inset_0_1px_0_oklch(0.97_0.01_85/0.25),0_1px_2px_oklch(0.1_0.01_70/0.25)] ring-1 ring-black/10"
            style={{ backgroundColor: paintColor }}
          />
        </span>
      </div>

      <StudioToggleChip
        active={active}
        disabled={locked}
        onClick={onToggleActive}
        aria-label={`${help.actionName} ${active ? "끄기" : "켜기"}`}
        title={`${help.summary} 결과는 손을 뗄 때 한 획으로 반영됩니다.`}
      >
        <span className="inline-flex items-center gap-1">
          <Droplets className="size-3" aria-hidden />
          {active ? "섞어 칠하기 끝내기" : "섞어 칠하기 시작"}
        </span>
      </StudioToggleChip>

      <StudioSliderRow
        label="브러시 크기"
        min={WET_MIX_RADIUS_RANGE.min}
        max={WET_MIX_RADIUS_RANGE.max}
        step={WET_MIX_RADIUS_RANGE.step}
        value={radius}
        disabled={locked}
        onChange={onRadiusChange}
        readout={`${radius}px`}
      />

      <StudioSliderRow
        label="칠하는 양"
        min={WET_MIX_STRENGTH_RANGE.min}
        max={WET_MIX_STRENGTH_RANGE.max}
        step={WET_MIX_STRENGTH_RANGE.step}
        value={strength}
        disabled={locked}
        onChange={onStrengthChange}
        readout={`${strength}%`}
      />

      <StudioSliderRow
        label="바닥색 섞기"
        min={WET_MIX_WETNESS_RANGE.min}
        max={WET_MIX_WETNESS_RANGE.max}
        step={WET_MIX_WETNESS_RANGE.step}
        value={wetness}
        disabled={locked}
        onChange={onWetnessChange}
        readout={`${wetness}%`}
      />

      <StudioSliderRow
        label="색 줍기"
        min={WET_MIX_PICKUP_RANGE.min}
        max={WET_MIX_PICKUP_RANGE.max}
        step={WET_MIX_PICKUP_RANGE.step}
        value={pickup}
        disabled={locked}
        onChange={onPickupChange}
        readout={`${pickup}%`}
      />

      <StudioSliderRow
        label="가장자리 단단함"
        min={WET_MIX_HARDNESS_RANGE.min}
        max={WET_MIX_HARDNESS_RANGE.max}
        step={WET_MIX_HARDNESS_RANGE.step}
        value={hardness}
        disabled={locked}
        onChange={onHardnessChange}
        readout={`${Math.round(hardness * 100)}%`}
      />

      <StudioRetouchQuickGuide
        toolId="wet-mix"
        active={active}
        busy={busy}
        disabled={disabled}
        onOpenTutorial={onOpenTutorial}
      />
    </section>
  );
}
