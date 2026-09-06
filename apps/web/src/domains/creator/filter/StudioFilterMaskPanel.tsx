/**
 * Studio Filter Mask Panel — 필터 마스크(비파괴 필터 부분 적용) 컨트롤. 마스크가 없으면 추가
 * 액션(흰/검정)만 보여주고, 있으면 켬/끔·삭제·반전(즉시 굽기 액션 4종) + 브러시로 직접 그리기
 * (무장 토글 + 모드 + 크기/경도/강도 슬라이더)를 보여준다.
 *
 * StudioLayerMaskPanel과 동일 관례의 순수 컨트롤 — 패널은 상태만 보여주고, 브러시가 무장
 * (paintActive)되면 실제 포인터 처리·스트로크 누적·비동기 굽기(studio-layer-mask.ts의
 * bakeLayerMaskStroke 재사용 — 인코딩이 동일)는 상위(StudioPage)의 onStageDown/Move/Up이
 * 담당한다. 완전히 controlled — 내부 비즈니스 상태 없음.
 *
 * 레이어 마스크와의 차이(문구에 반영): 레이어 마스크는 "어디가 보이는가"(가시성 알파)를,
 * 필터 마스크는 "어디에 보정·필터가 걸리는가"(필터 체인 적용 범위)를 다룬다. 흰색=필터 적용,
 * 검정=원본 유지, 회색=선형 블렌드(studio-filter-mask.ts 헤더 참고). 활성 필터가 하나도 없으면
 * 마스크를 칠해도 화면 변화가 없으므로 hasActiveFilters=false일 때 안내 문구로 알려준다.
 *
 * 마스크 썸네일(maskThumbnailSrc)은 레이어 마스크와 동일한 알파 인코딩이라 검은 배경 위에
 * PNG를 그대로 얹으면 표준 마스크 썸네일로 읽힌다(별도 변환 코드 불필요).
 */
import { Blend, Contrast, Eye, EyeOff, Loader2, Plus, Trash2 } from "lucide-react";
import { useId } from "react";

import { PANEL_CHIP_CLASS, StudioSliderRow, StudioToggleChip } from "../studio-panel-ui";

import {
  FILTER_MASK_BRUSH_HARDNESS_RANGE,
  FILTER_MASK_BRUSH_RADIUS_RANGE,
  FILTER_MASK_BRUSH_STRENGTH_RANGE,
  type FilterMaskPaintMode,
} from "./studio-filter-mask";

import type { ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

const PAINT_MODES: { id: FilterMaskPaintMode; label: string; tip: string }[] = [
  { id: "reveal", label: "필터 적용", tip: "흰색으로 칠해 이 영역에 필터를 적용합니다." },
  { id: "conceal", label: "원본 유지", tip: "검정으로 칠해 이 영역을 원본 그대로 남깁니다." },
];

const MODE_ICONS: Record<FilterMaskPaintMode, typeof Eye> = {
  reveal: Eye,
  conceal: EyeOff,
};

export type StudioFilterMaskPanelProps = {
  /** el.filterMaskSrc 존재 여부(켜짐/꺼짐과 무관) — false면 "추가" 액션만 보여준다. */
  hasMask: boolean;
  /** 마스크가 있을 때 el.filterMaskEnabled 유효값(true=적용 중, false=일시 비활성화 — 데이터는 보존). */
  enabled: boolean;
  /** 이 요소에 활성 필터/보정이 하나라도 있는지 — 없으면 마스크 효과가 보이지 않음을 안내. */
  hasActiveFilters: boolean;
  /** 마스크 브러시가 무장(켜짐) 상태인지. */
  paintActive: boolean;
  paintMode: FilterMaskPaintMode;
  radiusPx: number;
  hardness: number;
  strength: number;
  /** 마스크 썸네일 미리보기용 — el.filterMaskSrc 그대로(없으면 null). */
  maskThumbnailSrc: string | null;
  /** 굽기(bake) 진행 중 — 활성 그리기 도구의 종료를 제외한 변경 액션은 잠근다. */
  busy?: boolean;
  onAddMask: (fill: FilterMaskPaintMode) => void;
  onDeleteMask: () => void;
  onToggleEnabled: () => void;
  onInvert: () => void;
  onTogglePaintActive: () => void;
  onPaintModeChange: (mode: FilterMaskPaintMode) => void;
  onRadiusChange: (v: number) => void;
  onHardnessChange: (v: number) => void;
  onStrengthChange: (v: number) => void;
};

export function StudioFilterMaskPanel({
  hasMask,
  enabled,
  hasActiveFilters,
  paintActive,
  paintMode,
  radiusPx,
  hardness,
  strength,
  maskThumbnailSrc,
  busy = false,
  onAddMask,
  onDeleteMask,
  onToggleEnabled,
  onInvert,
  onTogglePaintActive,
  onPaintModeChange,
  onRadiusChange,
  onHardnessChange,
  onStrengthChange,
}: StudioFilterMaskPanelProps): ReactElement {
  const statusId = useId();
  const statusText = busy
    ? paintActive
      ? "필터 마스크를 적용하는 중이에요. 새 작업은 잠겼지만 ‘그리기 종료’로 도구를 해제할 수 있습니다."
      : "필터 마스크를 적용하는 중이에요. 완료될 때까지 다른 마스크 변경은 잠시 기다려 주세요."
    : !hasMask
      ? "마스크를 추가하면 이 레이어의 필터·보정을 원하는 부분에만 비파괴로 적용할 수 있습니다(원본 이미지와 필터 설정은 바뀌지 않아요)."
      : !hasActiveFilters
        ? "활성 필터·보정이 없어 마스크 효과가 아직 보이지 않아요 — 보정을 켜면 칠한 범위에만 적용됩니다."
        : !enabled
          ? "필터 마스크가 꺼져 있어요(데이터는 남아있음) — 다시 켜면 이전 상태 그대로 필터가 부분 적용됩니다."
          : !paintActive
            ? "켜고 이미지를 드래그하면 필터 적용 범위를 직접 칠할 수 있습니다."
            : "이미지를 드래그해 칠하세요. 흰색(필터 적용)은 보정을 걸고 검정(원본 유지)은 원본을 남깁니다 — 손을 뗀 시점에 한 번에 반영됩니다(⌘Z로 되돌리기 가능).";

  return (
    <section
      aria-label="필터 마스크"
      aria-busy={busy}
      className="mt-2.5 space-y-2 rounded-xl border border-line bg-card/45 p-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">
          <Blend size={12} aria-hidden />
          필터 마스크
        </p>
        {busy && (
          <Loader2
            size={13}
            className="animate-spin text-accent motion-reduce:animate-none"
            aria-hidden
          />
        )}
      </div>

      {!hasMask ? (
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => onAddMask("reveal")}
            disabled={busy}
            aria-describedby={statusId}
            title="전체에 필터가 적용되는 흰 마스크를 추가합니다(기본 — 이후 검정으로 칠한 부분만 원본으로 남습니다)."
            className={cn(PANEL_CHIP_CLASS, "flex min-w-0 items-center justify-center gap-1")}
          >
            <Plus className="size-3" aria-hidden />
            마스크 추가
          </button>
          <button
            type="button"
            onClick={() => onAddMask("conceal")}
            disabled={busy}
            aria-describedby={statusId}
            title="전체가 원본으로 남는 검정 마스크를 추가합니다(이후 흰색으로 칠한 부분에만 필터가 적용됩니다)."
            className={cn(PANEL_CHIP_CLASS, "flex min-w-0 items-center justify-center gap-1")}
          >
            <EyeOff className="size-3" aria-hidden />
            원본으로 추가
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {maskThumbnailSrc && (
              <span className="grid size-8 shrink-0 place-items-center rounded border border-line bg-black">
                <img src={maskThumbnailSrc} alt="" className="size-full rounded object-cover" />
              </span>
            )}
            <StudioToggleChip
              active={enabled}
              onClick={onToggleEnabled}
              disabled={busy}
              aria-describedby={statusId}
              title={enabled ? "필터 마스크를 끕니다(데이터는 보존 — 잠깐 전체 적용을 보고 싶을 때)." : "필터 마스크를 다시 켭니다."}
            >
              {enabled ? "사용 중" : "꺼짐"}
            </StudioToggleChip>
            <button
              type="button"
              onClick={onInvert}
              disabled={busy}
              aria-describedby={statusId}
              title="필터 적용/원본 유지 영역을 뒤집습니다(즉시 적용, ⌘Z로 되돌리기 가능)."
              className={cn(PANEL_CHIP_CLASS, "flex items-center gap-1")}
            >
              <Contrast className="size-3" aria-hidden />
              반전
            </button>
            <button
              type="button"
              onClick={onDeleteMask}
              disabled={busy}
              aria-describedby={statusId}
              title="필터 마스크를 삭제합니다(필터가 다시 전체에 적용됩니다 — 원본 이미지는 영향 없음)."
              className={cn(PANEL_CHIP_CLASS, "ml-auto flex items-center gap-1 text-fg-3 hover:text-fg")}
            >
              <Trash2 className="size-3" aria-hidden />
              삭제
            </button>
          </div>

          <StudioToggleChip
            active={paintActive}
            disabled={busy && !paintActive}
            onClick={onTogglePaintActive}
            aria-label={paintActive ? "필터 마스크 그리기 종료" : "필터 마스크에 그리기"}
            aria-describedby={statusId}
            title={
              paintActive
                ? "필터 마스크 그리기 도구를 종료합니다."
                : "켜고 이미지를 드래그하면 필터 적용 범위를 직접 칠할 수 있습니다."
            }
          >
            <span className="inline-flex items-center gap-1">
              <Blend className="size-3" aria-hidden />
              {paintActive ? "그리기 종료" : "마스크에 그리기"}
            </span>
          </StudioToggleChip>

          <div className="flex gap-1.5">
            {PAINT_MODES.map((m) => {
              const Icon = MODE_ICONS[m.id];
              return (
                <StudioToggleChip
                  key={m.id}
                  active={paintMode === m.id}
                  disabled={busy}
                  onClick={() => onPaintModeChange(m.id)}
                  aria-describedby={statusId}
                  title={m.tip}
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
            label="브러시 크기"
            min={FILTER_MASK_BRUSH_RADIUS_RANGE.min}
            max={FILTER_MASK_BRUSH_RADIUS_RANGE.max}
            step={FILTER_MASK_BRUSH_RADIUS_RANGE.step}
            value={radiusPx}
            onChange={onRadiusChange}
            disabled={busy}
            readout={`${radiusPx}px`}
          />
          <StudioSliderRow
            label="경도"
            min={FILTER_MASK_BRUSH_HARDNESS_RANGE.min}
            max={FILTER_MASK_BRUSH_HARDNESS_RANGE.max}
            step={FILTER_MASK_BRUSH_HARDNESS_RANGE.step}
            value={hardness}
            onChange={onHardnessChange}
            disabled={busy}
            readout={`${Math.round(hardness * 100)}%`}
          />
          <StudioSliderRow
            label="강도"
            min={FILTER_MASK_BRUSH_STRENGTH_RANGE.min}
            max={FILTER_MASK_BRUSH_STRENGTH_RANGE.max}
            step={FILTER_MASK_BRUSH_STRENGTH_RANGE.step}
            value={strength}
            onChange={onStrengthChange}
            disabled={busy}
            readout={`${Math.round(strength * 100)}%`}
          />
        </>
      )}

      <p
        id={statusId}
        className="text-[0.72rem] leading-relaxed text-fg-3"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {statusText}
      </p>
    </section>
  );
}
