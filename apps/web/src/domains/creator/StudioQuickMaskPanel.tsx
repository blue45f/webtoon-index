/**
 * Studio Quick Mask Panel — 포토샵식 퀵 마스크(Q) 컨트롤. 꺼져 있으면 진입 액션만 보여주고,
 * 켜져 있으면 브러시(칠하기=선택 추가/지우기=선택 제거) 파라미터 + 마스크 반전 + 틴트 표시
 * 색/불투명도 + "선택 영역으로 완료"/"취소"를 보여준다.
 *
 * 이 패널 자신은 캔버스를 전혀 만지지 않는 순수 컨트롤(StudioLayerMaskPanel과 동일 관례 —
 * "패널은 상태만 보여주고 캔버스 제스처는 상위(StudioPage)가 처리"). 퀵 마스크가 켜지면 실제
 * 포인터 처리·스트로크 누적·마스크 굽기(studio-quick-mask.ts의 applyMaskStrokeDabs)와
 * 진입/종료 변환(selectionToMask/maskToSelection)은 StudioPage가 담당한다.
 *
 * 완전히 controlled — 내부 비즈니스 상태 없음(StudioLayerMaskPanel의 controlled 스타일 미러).
 * onCommit="선택 영역으로 완료"(마스크→선택 변환 후 종료), onCancel="취소"(원래 선택 유지 종료),
 * onInvert=마스크 즉시 반전(studio-quick-mask.ts invertMask — 플래그가 아니라 즉시 굽기,
 * 레이어 마스크 반전과 동일한 이유).
 */
import { Blend, Brush, Check, Contrast, Eraser, Loader2, XCircle } from "lucide-react";

import { PANEL_CHIP_CLASS, StudioSliderRow, StudioSwatchChip, StudioToggleChip } from "./studio-panel-ui";
import {
  QUICK_MASK_BRUSH_HARDNESS_RANGE,
  QUICK_MASK_BRUSH_OPACITY_RANGE,
  QUICK_MASK_BRUSH_RADIUS_RANGE,
  QUICK_MASK_TINT_OPACITY_RANGE,
  QUICK_MASK_TINT_PRESETS,
  type QuickMaskBrushMode,
} from "./studio-quick-mask";

import type { ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

const BRUSH_MODES: { id: QuickMaskBrushMode; label: string; tip: string }[] = [
  { id: "paint", label: "칠하기", tip: "칠한 곳을 선택 영역에 추가합니다(틴트가 걷힙니다)." },
  { id: "erase", label: "지우기", tip: "칠한 곳을 선택 영역에서 뺍니다(틴트가 덮입니다)." },
];

const MODE_ICONS: Record<QuickMaskBrushMode, typeof Brush> = {
  paint: Brush,
  erase: Eraser,
};

export type StudioQuickMaskPanelProps = {
  /** 퀵 마스크 세션이 켜져 있는지 — 꺼져 있으면 진입 버튼만 보여준다. */
  active: boolean;
  brushMode: QuickMaskBrushMode;
  /** 브러시 반경(캔버스 표시 px) — 마스크 디바이스 px 환산은 상위 책임(레이어 마스크와 동일 관례). */
  radiusPx: number;
  /** 0..1 — 1=하드 엣지. */
  hardness: number;
  /** 0..1 — 스트로크 불투명도. */
  opacity: number;
  /** 틴트 표시 색(#rrggbb). */
  tintColor: string;
  /** 0..1 — 틴트 표시 불투명도. */
  tintOpacity: number;
  /** 변환/굽기 진행 중 — 다른 픽셀 도구와 동일 관례로 잠그지 않고 표시만. */
  busy?: boolean;
  onEnter: () => void;
  onCommit: () => void;
  onCancel: () => void;
  onBrushModeChange: (mode: QuickMaskBrushMode) => void;
  onRadiusChange: (v: number) => void;
  onHardnessChange: (v: number) => void;
  onOpacityChange: (v: number) => void;
  onInvert: () => void;
  onTintColorChange: (color: string) => void;
  onTintOpacityChange: (v: number) => void;
};

export function StudioQuickMaskPanel({
  active,
  brushMode,
  radiusPx,
  hardness,
  opacity,
  tintColor,
  tintOpacity,
  busy = false,
  onEnter,
  onCommit,
  onCancel,
  onBrushModeChange,
  onRadiusChange,
  onHardnessChange,
  onOpacityChange,
  onInvert,
  onTintColorChange,
  onTintOpacityChange,
}: StudioQuickMaskPanelProps): ReactElement {
  const statusText = busy
    ? "선택 영역을 변환하는 중..."
    : !active
      ? "켜면 현재 선택 영역이 색 틴트 마스크로 바뀌고, 브러시로 자유롭게 다듬을 수 있습니다(단축키 Q)."
      : brushMode === "paint"
        ? "이미지를 드래그해 칠하세요 — 칠한 곳이 선택 영역에 추가됩니다. \"선택 영역으로 완료\"를 누르면 다듬은 마스크가 선택 영역으로 돌아갑니다."
        : "이미지를 드래그해 지우세요 — 지운 곳이 선택 영역에서 빠집니다. \"선택 영역으로 완료\"를 누르면 다듬은 마스크가 선택 영역으로 돌아갑니다.";

  return (
    <div className="mt-2.5 space-y-2 rounded-xl border border-line bg-card/45 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">
          <Blend size={12} aria-hidden />
          퀵 마스크
        </p>
        {busy && <Loader2 size={13} className="animate-spin text-accent" aria-hidden />}
      </div>

      {!active ? (
        <button
          type="button"
          onClick={onEnter}
          title="현재 픽셀 선택 영역을 편집 가능한 틴트 마스크로 전환합니다(선택이 없으면 빈 마스크에서 시작)."
          className={cn(PANEL_CHIP_CLASS, "flex w-full items-center justify-center gap-1")}
        >
          <Blend className="size-3" aria-hidden />
          퀵 마스크 시작
        </button>
      ) : (
        <>
          <div className="flex gap-1.5">
            {BRUSH_MODES.map((m) => {
              const Icon = MODE_ICONS[m.id];
              return (
                <StudioToggleChip
                  key={m.id}
                  active={brushMode === m.id}
                  onClick={() => onBrushModeChange(m.id)}
                  title={m.tip}
                >
                  <span className="inline-flex items-center gap-1">
                    <Icon className="size-3" aria-hidden />
                    {m.label}
                  </span>
                </StudioToggleChip>
              );
            })}
            <button
              type="button"
              onClick={onInvert}
              title="마스크의 선택/비선택 영역을 뒤집습니다(즉시 적용)."
              className={cn(PANEL_CHIP_CLASS, "ml-auto flex items-center gap-1")}
            >
              <Contrast className="size-3" aria-hidden />
              반전
            </button>
          </div>

          <StudioSliderRow
            label="브러시 크기"
            min={QUICK_MASK_BRUSH_RADIUS_RANGE.min}
            max={QUICK_MASK_BRUSH_RADIUS_RANGE.max}
            step={QUICK_MASK_BRUSH_RADIUS_RANGE.step}
            value={radiusPx}
            onChange={onRadiusChange}
            readout={`${radiusPx}px`}
          />
          <StudioSliderRow
            label="경도"
            min={QUICK_MASK_BRUSH_HARDNESS_RANGE.min}
            max={QUICK_MASK_BRUSH_HARDNESS_RANGE.max}
            step={QUICK_MASK_BRUSH_HARDNESS_RANGE.step}
            value={hardness}
            onChange={onHardnessChange}
            readout={`${Math.round(hardness * 100)}%`}
          />
          <StudioSliderRow
            label="불투명도"
            min={QUICK_MASK_BRUSH_OPACITY_RANGE.min}
            max={QUICK_MASK_BRUSH_OPACITY_RANGE.max}
            step={QUICK_MASK_BRUSH_OPACITY_RANGE.step}
            value={opacity}
            onChange={onOpacityChange}
            readout={`${Math.round(opacity * 100)}%`}
          />

          <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">마스크 표시 색</p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_MASK_TINT_PRESETS.map((preset) => (
              <StudioSwatchChip
                key={preset.id}
                color={preset.color}
                label={preset.label}
                active={tintColor.toLowerCase() === preset.color.toLowerCase()}
                title={`마스크 틴트를 ${preset.label}으로 표시합니다(선택 결과에는 영향 없음).`}
                onClick={() => onTintColorChange(preset.color)}
              />
            ))}
          </div>
          <StudioSliderRow
            label="표시 불투명도"
            min={QUICK_MASK_TINT_OPACITY_RANGE.min}
            max={QUICK_MASK_TINT_OPACITY_RANGE.max}
            step={QUICK_MASK_TINT_OPACITY_RANGE.step}
            value={tintOpacity}
            onChange={onTintOpacityChange}
            readout={`${Math.round(tintOpacity * 100)}%`}
          />

          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={onCommit}
              title="다듬은 마스크를 픽셀 선택 영역으로 변환하고 퀵 마스크를 끝냅니다(소프트 엣지는 페더로 보존)."
              className={cn(
                PANEL_CHIP_CLASS,
                "flex flex-1 items-center justify-center gap-1 border-accent bg-accent-soft/50 text-fg"
              )}
            >
              <Check className="size-3" aria-hidden />
              선택 영역으로 완료
            </button>
            <button
              type="button"
              onClick={onCancel}
              title="마스크 편집을 버리고 원래 선택 영역으로 돌아갑니다."
              className={cn(PANEL_CHIP_CLASS, "flex items-center gap-1 text-fg-3 hover:text-fg")}
            >
              <XCircle className="size-3" aria-hidden />
              취소
            </button>
          </div>
        </>
      )}

      <p className="text-[0.72rem] leading-relaxed text-fg-3" role="status">
        {statusText}
      </p>
    </div>
  );
}
