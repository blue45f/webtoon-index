/**
 * Studio Magic Wand Panel
 * 마술봉(자동 선택) 도구 컨트롤 — 켜면 메인 캔버스에서 이미지를 클릭할 때마다 studio-magic-wand
 * 의 색상 연결 스캔 결과가 기존 픽셀 선택(StudioSelectionToolsPanel 이 소유하는 pixelSel)에
 * 더해진다. 이 패널 자신은 클릭도 스캔도 하지 않는 순수 컨트롤(무장 토글 + 허용 오차 슬라이더)
 * 이다 — 실제 클릭 처리·비동기 스캔·선택 병합은 StudioPage 의 onStageDown/runMagicWandSelect 가
 * 담당한다(크롭·픽셀 선택 도구와 동일하게 "패널은 상태만 보여주고 캔버스 제스처는 상위가 처리").
 *
 * 결합 모드(합치기/빼기)·페더·반전·되돌리기·선택 해제·밝기/색조/삭제 적용은 모두 이미
 * StudioSelectionToolsPanel 이 제공한다(같은 pixelSel/pixelCombine 상태를 공유) — 마술봉이 만든
 * 선택도 결국 같은 PixelSelection 이므로 여기서 중복 컨트롤을 두지 않는다(의도적 설계).
 */
import { Loader2, Wand2 } from "lucide-react";

import { MAGIC_WAND_TOLERANCE_RANGE } from "./studio-magic-wand";
import { StudioSliderRow, StudioToggleChip } from "./studio-panel-ui";

import type { ReactElement } from "react";

export type StudioMagicWandPanelProps = {
  /** 마술봉이 무장(켜짐) 상태인지 — 켜지면 이미지 위 클릭이 자동 선택으로 처리된다. */
  active: boolean;
  /** 색 허용 오차(MAGIC_WAND_TOLERANCE_RANGE 범위, studio-flood-fill 의 tolerance 와 동일 단위). */
  tolerance: number;
  /** 스캔(비동기) 진행 중 — 진행 표시만 하고 컨트롤을 잠그지는 않는다(다른 픽셀 도구와 동일 관례). */
  busy?: boolean;
  onToggleActive: () => void;
  onToleranceChange: (value: number) => void;
};

export function StudioMagicWandPanel({
  active,
  tolerance,
  busy = false,
  onToggleActive,
  onToleranceChange,
}: StudioMagicWandPanelProps): ReactElement {
  return (
    <div className="mt-2.5 space-y-2 rounded-xl border border-line bg-card/45 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">
          <Wand2 size={12} aria-hidden />
          마술봉 자동 선택
        </p>
        {busy && <Loader2 size={13} className="animate-spin text-accent" aria-hidden />}
      </div>

      <StudioToggleChip
        active={active}
        onClick={onToggleActive}
        title="켜고 이미지를 클릭하면 비슷한 색으로 이어진 영역이 자동으로 선택됩니다."
      >
        <span className="inline-flex items-center gap-1">
          <Wand2 className="size-3" aria-hidden />
          마술봉으로 선택
        </span>
      </StudioToggleChip>

      <StudioSliderRow
        label="허용 오차"
        min={MAGIC_WAND_TOLERANCE_RANGE.min}
        max={MAGIC_WAND_TOLERANCE_RANGE.max}
        step={MAGIC_WAND_TOLERANCE_RANGE.step}
        value={tolerance}
        onChange={onToleranceChange}
        readout={String(tolerance)}
      />

      <p className="text-[0.72rem] leading-relaxed text-fg-3" role="status">
        {busy
          ? "선택 영역을 계산하는 중..."
          : active
            ? "이미지 위 지점을 클릭하면 그 지점과 이어진 비슷한 색 영역이 선택됩니다. 허용 오차가 클수록 더 넓게 선택돼요. 결합(합치기/빼기)은 위 픽셀 선택 패널의 설정을 그대로 따릅니다."
            : "켜고 이미지 위를 클릭하면 클릭한 지점과 이어진 비슷한 색 영역이 자동으로 선택됩니다."}
      </p>
    </div>
  );
}
