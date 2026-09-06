/**
 * Studio Heal/Clone Panel
 * 복구 브러시(Healing brush) / 도장(Clone stamp) 컨트롤 — 켜면 메인 캔버스에서 Alt(Option)+클릭이
 * 소스 앵커 지정, 일반 드래그가 페인트 스트로크 처리로 바뀐다. 이 패널 자신은 클릭도 드래그도
 * 처리하지 않는 순수 컨트롤(모드 토글 + 반경/경도/불투명도 슬라이더 + 정렬 토글 + 소스 해제)이다 —
 * 실제 포인터 처리·스트로크 누적·비동기 굽기(bake)는 StudioPage 의 onStageDown/Move/Up 이 담당한다
 * (크롭·마술봉·픽셀 선택과 동일하게 "패널은 상태만 보여주고 캔버스 제스처는 상위가 처리").
 *
 * 완전히 controlled — 내부 비즈니스 상태 없음(StudioMagicWandPanel/StudioPerspectivePanel 과 동일
 * 관례). onPickMode 는 StudioPage 가 토글(같은 모드 재클릭 시 끄기)까지 책임진다 — 이 패널은
 * "그 모드를 골랐다"는 사실만 전달한다.
 */
import { Bandage, Crosshair, Loader2, Stamp } from "lucide-react";

import {
  HEAL_CLONE_HARDNESS_RANGE,
  HEAL_CLONE_MODES,
  HEAL_CLONE_OPACITY_RANGE,
  HEAL_CLONE_RADIUS_RANGE,
  type HealCloneMode,
} from "./studio-heal-clone";
import { PANEL_CHIP_CLASS, StudioSliderRow, StudioToggleChip } from "./studio-panel-ui";

import type { ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

const MODE_ICONS: Record<HealCloneMode, typeof Bandage> = {
  heal: Bandage,
  clone: Stamp,
};

export type StudioHealClonePanelProps = {
  /** 현재 무장된 모드, 꺼짐이면 null. */
  mode: HealCloneMode | null;
  radiusPx: number;
  hardness: number;
  opacity: number;
  aligned: boolean;
  /** 소스 앵커가 지정돼 있는지 — false 면 "Alt+클릭으로 지정" 안내를 보여준다. */
  hasSource: boolean;
  busy?: boolean;
  onPickMode: (mode: HealCloneMode) => void;
  onRadiusChange: (v: number) => void;
  onHardnessChange: (v: number) => void;
  onOpacityChange: (v: number) => void;
  onAlignedChange: (v: boolean) => void;
  onClearSource: () => void;
};

export function StudioHealClonePanel({
  mode,
  radiusPx,
  hardness,
  opacity,
  aligned,
  hasSource,
  busy = false,
  onPickMode,
  onRadiusChange,
  onHardnessChange,
  onOpacityChange,
  onAlignedChange,
  onClearSource,
}: StudioHealClonePanelProps): ReactElement {
  const statusText = busy
    ? "적용하는 중..."
    : !mode
      ? "복구 브러시 또는 도장을 켜면 이미지에서 픽셀을 복제할 수 있습니다."
      : !hasSource
        ? "Alt(Option)+클릭으로 복제할 위치(소스)를 먼저 지정하세요."
        : "이제 드래그해서 칠하세요. 칠한 결과는 손을 뗀 시점에 한 번에 반영됩니다(⌘Z로 되돌리기 가능). 알파(투명) 영역을 복제하면 그대로 투명하게 칠해집니다.";

  return (
    <div className="mt-2.5 space-y-2 rounded-xl border border-line bg-card/45 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">
          <Stamp size={12} aria-hidden />
          복구 브러시 / 도장
        </p>
        {busy && <Loader2 size={13} className="animate-spin text-accent" aria-hidden />}
      </div>

      <div className="flex gap-1.5">
        {HEAL_CLONE_MODES.map((m) => {
          const Icon = MODE_ICONS[m.id];
          return (
            <StudioToggleChip
              key={m.id}
              active={mode === m.id}
              disabled={busy}
              onClick={() => onPickMode(m.id)}
              title={busy ? "현재 스트로크를 반영한 뒤 모드를 바꿀 수 있습니다." : m.tip}
            >
              <span className="inline-flex items-center gap-1">
                <Icon className="size-3" aria-hidden />
                {m.label}
              </span>
            </StudioToggleChip>
          );
        })}
      </div>

      <StudioSliderRow
        label="반경"
        min={HEAL_CLONE_RADIUS_RANGE.min}
        max={HEAL_CLONE_RADIUS_RANGE.max}
        step={HEAL_CLONE_RADIUS_RANGE.step}
        value={radiusPx}
        disabled={busy}
        onChange={onRadiusChange}
        readout={`${radiusPx}px`}
      />

      <StudioSliderRow
        label="경도"
        min={HEAL_CLONE_HARDNESS_RANGE.min}
        max={HEAL_CLONE_HARDNESS_RANGE.max}
        step={HEAL_CLONE_HARDNESS_RANGE.step}
        value={hardness}
        disabled={busy}
        onChange={onHardnessChange}
        readout={`${Math.round(hardness * 100)}%`}
      />

      <StudioSliderRow
        label="불투명도"
        min={HEAL_CLONE_OPACITY_RANGE.min}
        max={HEAL_CLONE_OPACITY_RANGE.max}
        step={HEAL_CLONE_OPACITY_RANGE.step}
        value={opacity}
        disabled={busy}
        onChange={onOpacityChange}
        readout={`${Math.round(opacity * 100)}%`}
      />

      <StudioToggleChip
        active={aligned}
        disabled={busy}
        onClick={() => onAlignedChange(!aligned)}
        title={busy
          ? "현재 스트로크를 반영한 뒤 정렬 방식을 바꿀 수 있습니다."
          : "켜면 소스 오프셋이 스트로크가 끝나도 유지됩니다(새 Alt+클릭 전까지). 끄면 매 스트로크마다 소스 앵커 지점부터 다시 복제합니다."}
      >
        정렬(Aligned)
      </StudioToggleChip>

      {hasSource && (
        <button
          type="button"
          onClick={onClearSource}
          disabled={busy}
          title={busy ? "현재 스트로크를 반영한 뒤 소스를 해제할 수 있습니다." : "지정한 소스 앵커를 해제합니다."}
          className={cn(PANEL_CHIP_CLASS, "flex w-full items-center justify-center gap-1")}
        >
          <Crosshair className="size-3" aria-hidden />
          소스 해제
        </button>
      )}

      <p className="text-[0.72rem] leading-relaxed text-fg-3" role="status">
        {statusText}
      </p>
    </div>
  );
}
