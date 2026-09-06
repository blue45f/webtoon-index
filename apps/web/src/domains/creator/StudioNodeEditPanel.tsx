/**
 * Studio Node Edit Panel
 * 벡터 스트로크(프리핸드 펜) 노드 편집 인스펙터 — 모드 토글 + 이동/굵기/스무딩 하위 도구.
 *
 * 노드 편집은 크롭과 달리 파괴적 "적용"이 없다 — 핸들을 끄는 즉시 반영되고 제스처 1회당
 * patchEl 히스토리 1건으로 커밋되는 일반 드래그 상호작용이라 onApply/onCancel/로컬 상태가
 * 필요 없다. 상위(StudioPage)가 소유하는 fully-controlled 프레젠테이션 컴포넌트.
 */
import { Loader2, MousePointer2, Spline } from "lucide-react";

import { NODE_EDIT_TOOLS, type NodeEditTool } from "./studio-node-edit";
import {
  PANEL_CHIP_CLASS,
  PANEL_LABEL_ROW,
  PANEL_RANGE_CLASS,
  PANEL_READOUT_CLASS,
  StudioToggleChip,
} from "./studio-panel-ui";

import type { ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

export type StudioNodeEditPanelProps = {
  /** 노드 편집 모드 on/off. */
  active: boolean;
  /** 활성 하위 도구 — "move"(이동) | "width"(굵기) | "smooth"(스무딩). active=false 면 미사용. */
  tool: NodeEditTool;
  /** 현재 스트로크에서 뽑힌 핸들 개수(0 또는 1이면 편집할 점이 부족하다는 안내를 띄운다). */
  handleCount: number;
  /** 이 브러시에서 "굵기" 모드가 화면에 실제로 반영되는지 — false 면 칩을 비활성화. */
  widthModeSupported: boolean;
  /** "스무딩" 도구의 현재 강도(0..1) — 강도 슬라이더의 값이자, 다음 캔버스 드래그의 시작
   * 기준선이기도 하다(StudioPage 의 nodeSmoothStrength 상태를 그대로 반영). */
  smoothStrength: number;
  /** Paper 벡터 엔진의 일회성 경로 정리 작업 진행 상태. */
  refinementBusy?: boolean;
  /** 경로 정리를 적용할 수 없는 이유. */
  refinementUnavailableReason?: string | null;
  onToggle: () => void;
  onToolChange: (tool: NodeEditTool) => void;
  onSmoothStrengthChange: (strength: number) => void;
  /** Paper 벡터 엔진으로 현재 경로를 단순화하거나 부드럽게 정리한다. */
  onRefine?: (operation: "simplify" | "smooth") => void;
  /** 진행 중인 경로 정리 요청을 취소한다. */
  onCancelRefinement?: () => void;
  /** 현재 획이 부적합할 때 선택 도구로 전환해 다른 자유선 획을 고르게 한다. */
  onRequestSelectStroke?: () => void;
};

export function StudioNodeEditPanel({
  active,
  tool,
  handleCount,
  widthModeSupported,
  smoothStrength,
  refinementBusy = false,
  refinementUnavailableReason = null,
  onToggle,
  onToolChange,
  onSmoothStrengthChange,
  onRefine,
  onCancelRefinement,
  onRequestSelectStroke,
}: StudioNodeEditPanelProps): ReactElement {
  const refinementDisabled = refinementBusy || Boolean(refinementUnavailableReason);
  const refinementStatus = refinementBusy
    ? "경로를 정리하는 중..."
    : refinementUnavailableReason
      ?? "점을 줄여 경로를 가볍게 만들거나 곡선을 자연스럽게 다듬습니다.";

  return (
    <div className="mt-2.5 space-y-2 rounded-xl border border-line bg-card/45 p-2.5">
      {/* 헤더 + 모드 토글 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.72rem] font-semibold text-fg-3 uppercase tracking-wider">노드 편집</p>
        <StudioToggleChip
          active={active}
          onClick={onToggle}
          title={active ? "노드 편집을 끕니다." : "노드 편집을 켜고 선 위의 점을 조절합니다."}
        >
          <span className="inline-flex items-center gap-1">
            <Spline className="size-3" aria-hidden />
            {active ? "노드 편집 중" : "노드 편집 시작"}
          </span>
        </StudioToggleChip>
      </div>

      {active ? (
        <>
          {/* 하위 도구 — 이동 | 굵기(필압 굵기를 표현하지 않는 브러시면 비활성) | 스무딩 */}
          <div className="flex items-center justify-between gap-2 text-sm text-fg-2">
            도구
            <span className="flex flex-wrap items-center justify-end gap-1.5">
              {NODE_EDIT_TOOLS.map((t) => {
                const disabled = t.id === "width" && !widthModeSupported;
                return (
                  <span
                    key={t.id}
                    className={cn(disabled && "opacity-45")}
                  >
                    <StudioToggleChip
                      active={tool === t.id}
                      disabled={disabled}
                      onClick={() => onToolChange(t.id)}
                      title={t.tip}
                    >
                      {t.label}
                    </StudioToggleChip>
                  </span>
                );
              })}
            </span>
          </div>

          {tool === "smooth" && (
            <label className={PANEL_LABEL_ROW}>
              스무딩 강도
              <span className="flex items-center gap-1.5">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={smoothStrength}
                  onChange={(e) => onSmoothStrengthChange(Number(e.target.value))}
                  className={PANEL_RANGE_CLASS}
                  aria-label="스무딩 강도"
                />
                <span className={PANEL_READOUT_CLASS}>
                  {smoothStrength.toFixed(2)}
                </span>
              </span>
            </label>
          )}

          {!widthModeSupported && (
            <p className="text-[0.68rem] text-fg-3">
              이 브러시는 필압 굵기를 표현하지 않아 &apos;굵기&apos; 모드가 화면에 반영되지 않습니다.
              펜·G펜·마커 브러시에서 사용하세요.
            </p>
          )}

          {/* 사용법 힌트 — 편집할 점이 부족하면 대신 안내 */}
          {handleCount < 2 ? (
            <p role="status" className="text-[0.72rem] text-fg-3">
              편집할 점이 부족합니다.
            </p>
          ) : (
            <p className="text-[0.72rem] leading-relaxed text-fg-3" role="status">
              핸들을 끌어 선의 모양을 바꾸고, 굵기 모드에서는 위아래로 끌어 필압을 조절합니다. 편집은
              즉시 반영되며 ⌘Z로 되돌릴 수 있습니다.
            </p>
          )}
          {tool === "smooth" && handleCount >= 2 && (
            <p className="text-[0.68rem] text-fg-3">
              핸들을 고른 뒤 위로 끌면 더 부드럽게, 아래로 끌면 원본에 가깝게 다듬어집니다. 슬라이더는
              다음 드래그의 시작 강도를 정합니다.
            </p>
          )}
        </>
      ) : (
        <p className="text-[0.72rem] leading-relaxed text-fg-3">
          노드 편집을 시작하면 선 위에 조절 핸들이 나타납니다. 점을 옮기거나 굵기를 조절해 보세요.
        </p>
      )}

      {onRefine ? (
        <section
          aria-label="경로 정리"
          aria-busy={refinementBusy}
          className="space-y-2 border-t border-line/70 pt-2"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase tracking-wider text-fg-3">
              {refinementBusy ? <Loader2 className="size-3 animate-spin text-accent" aria-hidden /> : null}
              경로 정리
            </p>
            {refinementBusy && onCancelRefinement ? (
              <button
                type="button"
                onClick={onCancelRefinement}
                className={PANEL_CHIP_CLASS}
                aria-label="경로 정리 취소"
              >
                취소
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={refinementDisabled}
              onClick={() => onRefine("simplify")}
              className={PANEL_CHIP_CLASS}
              title={refinementUnavailableReason ?? "불필요한 점을 줄여 경로를 가볍게 만듭니다."}
            >
              단순화
            </button>
            <button
              type="button"
              disabled={refinementDisabled}
              onClick={() => onRefine("smooth")}
              className={PANEL_CHIP_CLASS}
              title={refinementUnavailableReason ?? "경로의 꺾임을 자연스러운 곡선으로 다듬습니다."}
            >
              부드럽게
            </button>
          </div>
          <p
            className="text-[0.7rem] leading-relaxed text-fg-3"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {refinementStatus}
          </p>
          {refinementUnavailableReason && onRequestSelectStroke && !refinementBusy ? (
            <button
              type="button"
              onClick={onRequestSelectStroke}
              className={cn(
                PANEL_CHIP_CLASS,
                "min-h-11 w-full justify-center gap-1.5 pointer-coarse:min-h-11",
              )}
              aria-label="선화 선택하기"
              aria-describedby="studio-node-refinement-selection-help"
            >
              <MousePointer2 className="size-3.5" aria-hidden />
              선화 선택하기
            </button>
          ) : null}
          {refinementUnavailableReason && onRequestSelectStroke && !refinementBusy ? (
            <p
              id="studio-node-refinement-selection-help"
              className="text-[0.65rem] leading-relaxed text-fg-3"
            >
              선택 도구로 전환합니다. Esc를 누르면 선택을 취소할 수 있어요.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
