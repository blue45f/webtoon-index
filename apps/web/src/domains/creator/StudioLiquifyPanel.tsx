/**
 * Studio Liquify Panel
 * Push·Twirl·Pinch·Bloat 왜곡 브러시의 모드, 반경, 강도를 한곳에서 조절한다. 패널은 상태만
 * 표현하며 실제 포인터 수집·비동기 굽기는 상위 Studio 캔버스가 담당한다.
 */
import {
  Expand,
  Move,
  RotateCcw,
  RotateCw,
  Shrink,
  SlidersHorizontal,
  Undo2,
  Waves,
} from "lucide-react";
import { useId } from "react";

import {
  LIQUIFY_HARDNESS_RANGE,
  LIQUIFY_MIN_RADIUS_RANGE,
  LIQUIFY_RADIUS_RANGE,
  LIQUIFY_STABILIZER_RANGE,
  LIQUIFY_STRENGTH_RANGE,
  normalizeStudioLiquifyMode,
  type StudioLiquifyMode,
} from "./studio-liquify-contract";
import { StudioPanelChip, StudioSliderRow, StudioToggleChip } from "./studio-panel-ui";
import { studioRetouchToolHelp } from "./studio-retouch-help";
import { StudioRetouchQuickGuide } from "./StudioRetouchQuickGuide";

import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";

type LiquifyModePresentation = {
  mode: StudioLiquifyMode;
  label: string;
  action: string;
  description: string;
  icon: LucideIcon;
};

const LIQUIFY_MODE_PRESENTATIONS: readonly LiquifyModePresentation[] = [
  {
    mode: "push",
    label: "밀기",
    action: "밀어서 왜곡하기",
    description: "드래그한 방향으로 픽셀을 자연스럽게 밉니다.",
    icon: Move,
  },
  {
    mode: "twirl-clockwise",
    label: "시계 회전",
    action: "시계 방향 회전하기",
    description: "브러시 중심 둘레를 시계 방향으로 비틉니다.",
    icon: RotateCw,
  },
  {
    mode: "twirl-counterclockwise",
    label: "반시계 회전",
    action: "반시계 방향 회전하기",
    description: "브러시 중심 둘레를 반시계 방향으로 비틉니다.",
    icon: RotateCcw,
  },
  {
    mode: "pinch",
    label: "오므리기",
    action: "안쪽으로 오므리기",
    description: "픽셀을 브러시 중심으로 모아 형태를 좁힙니다.",
    icon: Shrink,
  },
  {
    mode: "bloat",
    label: "부풀리기",
    action: "바깥으로 부풀리기",
    description: "픽셀을 브러시 중심 밖으로 밀어 형태를 키웁니다.",
    icon: Expand,
  },
] as const;

export type StudioLiquifyPanelProps = {
  /** 현재 왜곡 브러시가 무장(켜짐) 상태인지. */
  active: boolean;
  /** 브러시 반경(캔버스 표시 px, LIQUIFY_RADIUS_RANGE). */
  radius: number;
  /** 왜곡 강도(%, LIQUIFY_STRENGTH_RANGE). */
  strength: number;
  /** 생략하면 기존 호환 동작인 Push. */
  mode?: StudioLiquifyMode;
  /** 스트로크 커밋(변위 필드 렌더) 진행 중. */
  busy?: boolean;
  /** 문서 잠금 등 상위 게이트 — 제공되면 패널 전체를 잠그고 복구 안내를 표시한다. */
  disabled?: boolean;
  onToggleActive: () => void;
  onRadiusChange: (value: number) => void;
  onStrengthChange: (value: number) => void;
  /** 제공될 때만 모드 선택기를 노출한다. 호출부가 연결되지 않은 무동작 UI는 렌더하지 않는다. */
  onModeChange?: (mode: StudioLiquifyMode) => void;
  /** 아래 고급 props는 연결된 항목만 점진적으로 노출한다. */
  hardness?: number;
  minimumRadius?: number;
  stabilizer?: number;
  pressureAffectsRadius?: boolean;
  pressureAffectsStrength?: boolean;
  onHardnessChange?: (value: number) => void;
  onMinimumRadiusChange?: (value: number) => void;
  onStabilizerChange?: (value: number) => void;
  onTogglePressureRadius?: () => void;
  onTogglePressureStrength?: () => void;
  /** 누적 displacement 세션이 준비된 호출부에서만 제공한다. */
  onReconstruct?: () => void;
  onSmooth?: () => void;
  onOpenTutorial?: () => void;
};

export function StudioLiquifyPanel({
  active,
  radius,
  strength,
  mode = "push",
  busy = false,
  disabled = false,
  onToggleActive,
  onRadiusChange,
  onStrengthChange,
  onModeChange,
  hardness = 50,
  minimumRadius = 20,
  stabilizer = 0,
  pressureAffectsRadius = false,
  pressureAffectsStrength = false,
  onHardnessChange,
  onMinimumRadiusChange,
  onStabilizerChange,
  onTogglePressureRadius,
  onTogglePressureStrength,
  onReconstruct,
  onSmooth,
  onOpenTutorial,
}: StudioLiquifyPanelProps): ReactElement {
  const titleId = useId();
  const help = studioRetouchToolHelp("liquify");
  const locked = busy || disabled;
  const safeMode = normalizeStudioLiquifyMode(mode);
  const current =
    LIQUIFY_MODE_PRESENTATIONS.find((presentation) => presentation.mode === safeMode) ??
    LIQUIFY_MODE_PRESENTATIONS[0]!;
  const CurrentIcon = current.icon;
  const hasAdvancedControls = Boolean(
    onHardnessChange
    || onMinimumRadiusChange
    || onStabilizerChange
    || onTogglePressureRadius
    || onTogglePressureStrength
    || onReconstruct
    || onSmooth
  );

  return (
    <section
      className="mt-2.5 space-y-2.5 rounded-xl border border-line bg-card/45 p-2.5"
      aria-labelledby={titleId}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3
            id={titleId}
            aria-label={`${help.actionName} · ${help.technicalName} · ${current.label}`}
            className="flex items-center gap-1.5 text-xs font-semibold tracking-tight text-fg-2"
          >
            <CurrentIcon size={13} aria-hidden />
            {help.actionName}
            <span className="text-[0.66rem] font-medium text-fg-3">
              {help.technicalName} · {current.label}
            </span>
          </h3>
          <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3 text-pretty">
            {help.summary} 현재 방식은 {current.description}
          </p>
        </div>
      </div>

      {onModeChange ? (
        <fieldset disabled={locked} className="min-w-0">
          <legend className="mb-1.5 text-[0.68rem] font-medium text-fg-3">왜곡 방식</legend>
          <div className="flex flex-wrap gap-1.5">
            {LIQUIFY_MODE_PRESENTATIONS.map((presentation) => {
              const ModeIcon = presentation.icon;
              return (
                <StudioPanelChip
                  key={presentation.mode}
                  active={safeMode === presentation.mode}
                  disabled={locked}
                  onClick={() => onModeChange(presentation.mode)}
                  title={presentation.description}
                >
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    <ModeIcon className="size-3" aria-hidden />
                    {presentation.label}
                  </span>
                </StudioPanelChip>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      <StudioToggleChip
        active={active}
        disabled={locked}
        onClick={onToggleActive}
        aria-label={`${current.action} ${active ? "끄기" : "켜기"}`}
        title={`${current.description} 결과는 손을 뗄 때 한 번에 반영됩니다.`}
      >
        <span className="inline-flex items-center gap-1">
          <CurrentIcon className="size-3" aria-hidden />
          {current.action}
        </span>
      </StudioToggleChip>

      <StudioSliderRow
        label="브러시 크기"
        min={LIQUIFY_RADIUS_RANGE.min}
        max={LIQUIFY_RADIUS_RANGE.max}
        step={LIQUIFY_RADIUS_RANGE.step}
        value={radius}
        onChange={onRadiusChange}
        disabled={locked}
        readout={`${radius}px`}
      />

      <StudioSliderRow
        label="변형 강도"
        min={LIQUIFY_STRENGTH_RANGE.min}
        max={LIQUIFY_STRENGTH_RANGE.max}
        step={LIQUIFY_STRENGTH_RANGE.step}
        value={strength}
        onChange={onStrengthChange}
        disabled={locked}
        readout={`${strength}%`}
      />

      {hasAdvancedControls ? (
        <details className="group border-t border-line/70 pt-1.5">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-1.5 text-[0.72rem] font-medium text-fg-2 outline-none transition-colors hover:bg-raised/70 focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-1.5">
              <SlidersHorizontal className="size-3.5" aria-hidden />
              세부 조절
            </span>
            <span className="text-[0.66rem] font-normal text-fg-3 group-open:hidden">경도 · 필압</span>
            <span className="hidden text-[0.66rem] font-normal text-fg-3 group-open:inline">접기</span>
          </summary>

          <fieldset disabled={locked} className="mt-1.5 space-y-2.5 px-1 pb-0.5">
            <legend className="sr-only">리퀴파이 세부 조절</legend>
            {onHardnessChange ? (
              <StudioSliderRow
                label="경도"
                min={LIQUIFY_HARDNESS_RANGE.min}
                max={LIQUIFY_HARDNESS_RANGE.max}
                step={LIQUIFY_HARDNESS_RANGE.step}
                value={hardness}
                onChange={onHardnessChange}
                disabled={locked}
                readout={`${hardness}%`}
              />
            ) : null}

            {onStabilizerChange ? (
              <StudioSliderRow
                label="안정화"
                min={LIQUIFY_STABILIZER_RANGE.min}
                max={LIQUIFY_STABILIZER_RANGE.max}
                step={LIQUIFY_STABILIZER_RANGE.step}
                value={stabilizer}
                onChange={onStabilizerChange}
                disabled={locked}
                readout={`${stabilizer}%`}
              />
            ) : null}

            {onTogglePressureRadius || onTogglePressureStrength ? (
              <div>
                <p className="mb-1.5 text-[0.68rem] font-medium text-fg-3">펜 필압</p>
                <div className="flex flex-wrap gap-1.5">
                  {onTogglePressureRadius ? (
                    <StudioToggleChip
                      active={pressureAffectsRadius}
                      disabled={locked}
                      onClick={onTogglePressureRadius}
                      aria-label={`필압으로 크기 조절 ${pressureAffectsRadius ? "끄기" : "켜기"}`}
                      title="펜을 세게 누를수록 브러시 반경이 커집니다."
                    >
                      크기
                    </StudioToggleChip>
                  ) : null}
                  {onTogglePressureStrength ? (
                    <StudioToggleChip
                      active={pressureAffectsStrength}
                      disabled={locked}
                      onClick={onTogglePressureStrength}
                      aria-label={`필압으로 강도 조절 ${pressureAffectsStrength ? "끄기" : "켜기"}`}
                      title="펜을 세게 누를수록 왜곡 강도가 커집니다."
                    >
                      늘림 강도
                    </StudioToggleChip>
                  ) : null}
                </div>
              </div>
            ) : null}

            {onMinimumRadiusChange ? (
              <StudioSliderRow
                label="최소 크기"
                min={LIQUIFY_MIN_RADIUS_RANGE.min}
                max={LIQUIFY_MIN_RADIUS_RANGE.max}
                step={LIQUIFY_MIN_RADIUS_RANGE.step}
                value={minimumRadius}
                onChange={onMinimumRadiusChange}
                disabled={locked || !pressureAffectsRadius}
                readout={`${minimumRadius}%`}
              />
            ) : null}

            {onReconstruct || onSmooth ? (
              <div>
                <p className="mb-1.5 text-[0.68rem] font-medium text-fg-3">변위 다듬기</p>
                <div className="flex flex-wrap gap-1.5">
                  {onReconstruct ? (
                    <StudioPanelChip
                      disabled={locked}
                      onClick={onReconstruct}
                      title="브러시가 닿은 누적 변위를 원래 형태 쪽으로 되돌립니다."
                    >
                      <Undo2 className="size-3" aria-hidden />
                      원형 복원
                    </StudioPanelChip>
                  ) : null}
                  {onSmooth ? (
                    <StudioPanelChip
                      disabled={locked}
                      onClick={onSmooth}
                      title="주변 변위 벡터를 평균내 울퉁불퉁한 왜곡을 부드럽게 합니다."
                    >
                      <Waves className="size-3" aria-hidden />
                      변위 매끄럽게
                    </StudioPanelChip>
                  ) : null}
                </div>
              </div>
            ) : null}
          </fieldset>
        </details>
      ) : null}

      <StudioRetouchQuickGuide
        toolId="liquify"
        active={active}
        busy={busy}
        disabled={disabled}
        onOpenTutorial={onOpenTutorial}
      />
    </section>
  );
}
