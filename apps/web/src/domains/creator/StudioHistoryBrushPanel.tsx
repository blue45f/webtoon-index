/**
 * Studio History Brush Panel
 * 히스토리 브러시(Photoshop History Brush 대응) 컨트롤 — 켜면 메인 캔버스에서 선택된 이미지 위
 * 드래그가 "지정한 히스토리 시점의 픽셀로 그 부분만 되돌리는" 스트로크로 처리된다. 이 패널 자신은
 * 드래그도 픽셀 복원도 하지 않는 순수 컨트롤(무장 토글 + 반경/경도/불투명도 슬라이더 + 소스 상태
 * 표시 + 소스 해제)이다 — 실제 포인터 처리·스트로크 누적·비동기 굽기는 StudioPage 의
 * onStageDown/Move/Up 이 담당한다(heal-clone/smudge 와 동일하게 "패널은 상태만 보여주고 캔버스
 * 제스처는 상위가 처리").
 *
 * heal-clone 과의 핵심 차이: 소스를 "캔버스에서 Alt+클릭"으로 지정하지 않는다 — 소스는 항상
 * "작업 내역(History) 패널에서 시점 하나를 고르고 그 행의 붓 아이콘을 누르는" 별도 제스처로
 * 지정된다(StudioHistoryPanel.tsx 쪽에 추가되는 지정 버튼, 이 패널이 아니다). 그래서 이 패널에는
 * heal-clone 의 "Alt+클릭으로 지정하세요" 안내 대신 "작업 내역 패널에서 지정하세요" 안내와, 그
 * 패널을 곧장 열 수 있는 지름길 버튼(onOpenHistoryPanel, 선택적)이 있다.
 *
 * 완전히 controlled — 내부 비즈니스 상태 없음(StudioSmudgePanel/StudioHealClonePanel 과 동일 관례).
 */
import { History as HistoryIcon, Loader2, Paintbrush, Undo2 } from "lucide-react";

import {
  HISTORY_BRUSH_HARDNESS_RANGE,
  HISTORY_BRUSH_OPACITY_RANGE,
  HISTORY_BRUSH_RADIUS_RANGE,
} from "./studio-history-brush";
import { PANEL_CHIP_CLASS, StudioSliderRow, StudioToggleChip } from "./studio-panel-ui";

import type { ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

export type StudioHistoryBrushPanelProps = {
  /** 히스토리 브러시가 무장(켜짐) 상태인지. */
  active: boolean;
  radiusPx: number;
  hardness: number;
  opacity: number;
  /** 작업 내역 패널에서 소스 시점을 지정해 뒀는지 — false 면 "먼저 지정하세요" 안내를 보여준다. */
  hasSource: boolean;
  /** 스트로크 커밋(픽셀 재인코딩) 진행 중. */
  busy?: boolean;
  onToggleActive: () => void;
  onRadiusChange: (v: number) => void;
  onHardnessChange: (v: number) => void;
  onOpacityChange: (v: number) => void;
  /** 지정한 소스를 해제(hasSource 일 때만 렌더). */
  onClearSource: () => void;
  /** 작업 내역 패널이 닫혀 있을 때 곧장 열게 하는 지름길 — 없으면 버튼 자체를 렌더하지 않는다
   * (StudioPage 가 historyPanelOpen 상태를 이미 갖고 있으므로 열려 있을 땐 넘기지 않아도 된다). */
  onOpenHistoryPanel?: () => void;
};

export function StudioHistoryBrushPanel({
  active,
  radiusPx,
  hardness,
  opacity,
  hasSource,
  busy = false,
  onToggleActive,
  onRadiusChange,
  onHardnessChange,
  onOpacityChange,
  onClearSource,
  onOpenHistoryPanel,
}: StudioHistoryBrushPanelProps): ReactElement {
  const statusText = busy
    ? "적용하는 중..."
    : !active
      ? "켜면 작업 내역의 특정 시점 픽셀을 브러시로 부분 복원할 수 있습니다."
      : !hasSource
        ? "먼저 작업 내역 패널에서 되돌릴 시점을 고르고 그 행의 붓 아이콘을 눌러 소스로 지정하세요."
        : "이제 드래그해서 칠하면 지정한 시점의 픽셀로 그 부분만 되돌아갑니다(⌘Z로 되돌리기 가능).";

  return (
    <div className="mt-2.5 space-y-2 rounded-xl border border-line bg-card/45 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">
          <Paintbrush size={12} aria-hidden />
          히스토리 브러시
        </p>
        {busy && <Loader2 size={13} className="animate-spin text-accent" aria-hidden />}
      </div>

      <StudioToggleChip
        active={active}
        disabled={busy}
        onClick={onToggleActive}
        title={busy
          ? "현재 복원 스트로크를 반영한 뒤 모드를 바꿀 수 있습니다."
          : "켜고 이미지를 드래그하면 지정한 작업 내역 시점의 픽셀로 그 부분만 되돌아갑니다."}
      >
        <span className="inline-flex items-center gap-1">
          <Paintbrush className="size-3" aria-hidden />
          히스토리 브러시로 복원
        </span>
      </StudioToggleChip>

      <StudioSliderRow
        label="반경"
        min={HISTORY_BRUSH_RADIUS_RANGE.min}
        max={HISTORY_BRUSH_RADIUS_RANGE.max}
        step={HISTORY_BRUSH_RADIUS_RANGE.step}
        value={radiusPx}
        disabled={busy}
        onChange={onRadiusChange}
        readout={`${radiusPx}px`}
      />

      <StudioSliderRow
        label="경도"
        min={HISTORY_BRUSH_HARDNESS_RANGE.min}
        max={HISTORY_BRUSH_HARDNESS_RANGE.max}
        step={HISTORY_BRUSH_HARDNESS_RANGE.step}
        value={hardness}
        disabled={busy}
        onChange={onHardnessChange}
        readout={`${Math.round(hardness * 100)}%`}
      />

      <StudioSliderRow
        label="불투명도"
        min={HISTORY_BRUSH_OPACITY_RANGE.min}
        max={HISTORY_BRUSH_OPACITY_RANGE.max}
        step={HISTORY_BRUSH_OPACITY_RANGE.step}
        value={opacity}
        disabled={busy}
        onChange={onOpacityChange}
        readout={`${Math.round(opacity * 100)}%`}
      />

      {hasSource ? (
        <button
          type="button"
          onClick={onClearSource}
          disabled={busy}
          title={busy ? "현재 복원 스트로크를 반영한 뒤 소스를 해제할 수 있습니다." : "지정한 히스토리 소스를 해제합니다."}
          className={cn(PANEL_CHIP_CLASS, "flex w-full items-center justify-center gap-1")}
        >
          <Undo2 className="size-3" aria-hidden />
          소스 해제
        </button>
      ) : (
        onOpenHistoryPanel && (
          <button
            type="button"
            onClick={onOpenHistoryPanel}
            disabled={busy}
            title={busy ? "현재 복원 스트로크를 반영한 뒤 작업 내역을 열 수 있습니다." : "작업 내역 패널을 열어 되돌릴 시점을 고릅니다."}
            className={cn(PANEL_CHIP_CLASS, "flex w-full items-center justify-center gap-1")}
          >
            <HistoryIcon className="size-3" aria-hidden />
            작업 내역에서 소스 지정하기
          </button>
        )
      )}

      <p className="text-[0.72rem] leading-relaxed text-fg-3" role="status">
        {statusText}
      </p>
    </div>
  );
}
