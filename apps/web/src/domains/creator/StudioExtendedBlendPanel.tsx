/**
 * Studio Extended Blend Panel
 * 확장 블렌드 병합 컨트롤 — Canvas globalCompositeOperation 에 없는 포토샵 전용 10모드
 * (선형 닷지/선형 번/비비드·선형·핀 라이트/하드 믹스/어두운·밝은 색상/빼기/나누기)를
 * "아래 레이어와 병합" 베이크로 적용한다. Canvas 2D 는 backdrop 픽셀 접근이 없어 라이브
 * 블렌드가 불가능하므로 이 패널의 적용은 항상 파괴적 병합(되돌리기 1스텝)이다.
 *
 * 완전히 controlled — 내부 비즈니스 상태 없음(StudioHealClonePanel/StudioMagicWandPanel 과
 * 동일 관례). 모드/불투명도 상태와 실제 래스터라이즈·blendExtended 실행·커밋은 StudioPage 가
 * 담당한다(기존 레이어 병합 파이프라인과 동일한 busy 가드·라이브 잠금 사용). 이 패널은
 * 무장(armed) 도구가 아니라 캔버스 제스처를 바꾸지 않는다 — disarm 연동 불필요.
 */
import { Blend, Layers2, Loader2 } from "lucide-react";

import {
  EXTENDED_BLEND_MODES,
  EXTENDED_BLEND_OPACITY_RANGE,
  type StudioExtendedBlendModeId,
} from "./studio-extended-blend";
import { PANEL_CHIP_CLASS, StudioSliderRow, StudioToggleChip } from "./studio-panel-ui";

import type { ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

export type StudioExtendedBlendPanelProps = {
  /** 현재 선택된 확장 블렌드 모드. */
  mode: StudioExtendedBlendModeId;
  /** 블렌드 불투명도(0..1, 포토샵 레이어 불투명도와 동일 의미). */
  opacity: number;
  /** 병합 베이크 진행 중 — 모든 컨트롤을 잠근다(레이어 병합과 동일 관례). */
  busy?: boolean;
  /**
   * 적용 불가 사유 — 있으면 병합 버튼을 잠그고 사유를 보여준다
   * (이미지 요소 + 바로 아래 이미지 요소가 필요).
   */
  unavailableReason?: string | null;
  /** 선택 모드/불투명도로 미리 계산한 미리보기 썸네일(data URL) — 없으면 숨김. */
  previewDataUrl?: string | null;
  onModeChange: (mode: StudioExtendedBlendModeId) => void;
  onOpacityChange: (value: number) => void;
  /** "아래 레이어와 병합" — 실제 베이크·커밋은 StudioPage 가 수행. */
  onApply: () => void;
};

export function StudioExtendedBlendPanel({
  mode,
  opacity,
  busy = false,
  unavailableReason = null,
  previewDataUrl = null,
  onModeChange,
  onOpacityChange,
  onApply,
}: StudioExtendedBlendPanelProps): ReactElement {
  const applyDisabled = busy || Boolean(unavailableReason);
  const statusText = busy
    ? "병합하는 중..."
    : unavailableReason
      ?? "선택한 이미지 레이어를 바로 아래 이미지 레이어에 확장 블렌드로 구워 합칩니다(⌘Z로 한 번에 되돌리기). 캔버스 특성상 이 모드들은 실시간 미리보기 대신 병합으로만 적용됩니다.";

  return (
    <div className="mt-2.5 space-y-2 rounded-xl border border-line bg-card/45 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">
          <Blend size={12} aria-hidden />
          확장 블렌드 병합
        </p>
        {busy && <Loader2 size={13} className="animate-spin text-accent" aria-hidden />}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {EXTENDED_BLEND_MODES.map((entry) => (
          <StudioToggleChip
            key={entry.id}
            active={mode === entry.id}
            disabled={busy}
            onClick={() => onModeChange(entry.id)}
            title={busy ? "병합이 끝난 뒤 모드를 바꿀 수 있습니다." : entry.tip}
          >
            {entry.label}
          </StudioToggleChip>
        ))}
      </div>

      <StudioSliderRow
        label="불투명도"
        min={EXTENDED_BLEND_OPACITY_RANGE.min}
        max={EXTENDED_BLEND_OPACITY_RANGE.max}
        step={EXTENDED_BLEND_OPACITY_RANGE.step}
        value={opacity}
        disabled={busy}
        onChange={onOpacityChange}
        readout={`${Math.round(opacity * 100)}%`}
      />

      {previewDataUrl && (
        <img
          src={previewDataUrl}
          alt="확장 블렌드 미리보기"
          className="h-16 w-full rounded-lg border border-line bg-raised object-contain"
        />
      )}

      <button
        type="button"
        onClick={onApply}
        disabled={applyDisabled}
        title={
          unavailableReason
            ?? "선택한 이미지와 바로 아래 이미지를 확장 블렌드로 합쳐 하나의 이미지로 만듭니다."
        }
        className={cn(
          PANEL_CHIP_CLASS,
          "flex w-full items-center justify-center gap-1",
          !applyDisabled && "border-accent/60 bg-accent-soft/40 text-fg"
        )}
      >
        {busy
          ? <Loader2 className="size-3 animate-spin" aria-hidden />
          : <Layers2 className="size-3" aria-hidden />}
        아래 레이어와 병합
      </button>

      <p className="text-[0.72rem] leading-relaxed text-fg-3" role="status">
        {statusText}
      </p>
    </div>
  );
}
