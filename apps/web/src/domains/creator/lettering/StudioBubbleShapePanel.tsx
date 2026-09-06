/**
 * Studio Bubble Shape Panel
 * 말풍선 "커스텀 모양(폴리곤 점 편집)" 인스펙터 — 전환 버튼 + 편집 모드 토글 + 되돌리기.
 *
 * StudioNodeEditPanel 과 동일한 관례를 따르는 fully-controlled 프레젠테이션 컴포넌트다:
 * 파괴적 "적용" 단계가 없다(전환은 즉시 patchEl 커밋 1건, 점 드래그도 제스처당 1건) — 상위
 * (StudioPage)가 상태를 전부 소유한다. 3가지 표시 상태:
 *   1) hasCustomShape=false        → "커스텀 모양으로 전환" 버튼만 노출.
 *   2) hasCustomShape=true,  !active → 편집 시작 토글 + 되돌리기 버튼.
 *   3) hasCustomShape=true,  active  → 편집 중 안내(핸들 개수) + 편집 종료 토글 + 되돌리기.
 */
import {
  CircleMinus,
  CirclePlus,
  FlipHorizontal2,
  FlipVertical2,
  FoldHorizontal,
  FoldVertical,
  Shapes,
  StretchHorizontal,
  StretchVertical,
  Undo2,
} from "lucide-react";

import { StudioToggleChip } from "../studio-panel-ui";

import type { BubbleQuickTransformAction } from "./studio-bubble-quick-transform";
import type { ReactElement } from "react";

export type StudioBubbleShapePanelProps = {
  /** double 변형처럼 현재 커스텀 폴리곤 전환을 제공하지 않는 모양. 퀵 변형은 그대로 노출한다. */
  canCustomize?: boolean;
  /** 이 말풍선이 이미 커스텀 폴리곤 모양으로 전환돼 있는지. */
  hasCustomShape: boolean;
  /** 점 편집 모드 on/off — hasCustomShape=false 면 의미 없음(전환 전에는 편집할 점이 없다). */
  active: boolean;
  /** 현재 폴리곤의 점 개수(편집 중 핸들 개수와 동일) — 안내 문구에만 쓰인다. */
  pointCount: number;
  /** 현재 선택한 폴리곤 점. null이면 추가는 가장 긴 선분을 사용한다. */
  selectedPointIndex: number | null;
  /** "커스텀 모양으로 전환" — 현재 테마/꼬리 설정 기준 윤곽을 폴리곤으로 샘플링해 저장. */
  onConvert: () => void;
  /** 점 편집 모드 토글. */
  onToggleEdit: () => void;
  /** customShapePoints 를 지우고 원래 variant 렌더링(둥근사각형/별/하트 등)으로 되돌린다. */
  onRevert: () => void;
  /** 선택 점 다음 선분(미선택 시 가장 긴 선분) 중점에 점을 추가한다. */
  onAddPoint: () => void;
  /** 현재 선택 점을 삭제한다. 최소 3점 보호는 상위 코어가 다시 검증한다. */
  onRemovePoint: () => void;
  pointActionsDisabled?: boolean;
  /** 현재 말풍선에 중심 기준 크기/반전 변형을 한 번 적용한다. */
  onQuickTransform: (action: BubbleQuickTransformAction) => void;
  /** 잠금/권한 상태에서 변형 버튼만 비활성화한다. */
  quickTransformDisabled?: boolean;
  /** 자동 부착 꼬리처럼 반전을 즉시 다시 계산할 상태에서는 반전 두 개만 막는다. */
  quickTransformFlipDisabled?: boolean;
  /** 크기 한계·대칭 외곽선처럼 action별 no-op이 되는 이유. */
  quickTransformUnavailableReasons?: Partial<Record<BubbleQuickTransformAction, string | null>>;
};

const QUICK_TRANSFORMS: ReadonlyArray<{
  action: BubbleQuickTransformAction;
  label: string;
  title: string;
  icon: typeof StretchHorizontal;
}> = [
  { action: "widen", label: "가로 넓히기", title: "말풍선 가로 넓히기 (12%)", icon: StretchHorizontal },
  { action: "narrow", label: "가로 좁히기", title: "말풍선 가로 좁히기 (12%)", icon: FoldHorizontal },
  { action: "heighten", label: "세로 높이기", title: "말풍선 세로 높이기 (12%)", icon: StretchVertical },
  { action: "shorten", label: "세로 낮추기", title: "말풍선 세로 낮추기 (12%)", icon: FoldVertical },
  { action: "flip-horizontal", label: "좌우 반전", title: "말풍선 외곽선과 꼬리를 좌우 반전", icon: FlipHorizontal2 },
  { action: "flip-vertical", label: "상하 반전", title: "말풍선 외곽선과 꼬리를 상하 반전", icon: FlipVertical2 },
];

export function StudioBubbleShapePanel({
  canCustomize = true,
  hasCustomShape,
  active,
  pointCount,
  selectedPointIndex,
  onConvert,
  onToggleEdit,
  onRevert,
  onAddPoint,
  onRemovePoint,
  pointActionsDisabled = false,
  onQuickTransform,
  quickTransformDisabled = false,
  quickTransformFlipDisabled = false,
  quickTransformUnavailableReasons = {},
}: StudioBubbleShapePanelProps): ReactElement {
  const quickTransformStatusMessages = Array.from(
    new Set([
      ...Object.values(quickTransformUnavailableReasons).filter(
        (reason): reason is string => typeof reason === "string" && reason.length > 0
      ),
      ...(quickTransformFlipDisabled
        ? ["꼬리 자동 부착 상태입니다. 좌우·상하 반전은 해제 후 사용할 수 있습니다."]
        : []),
    ])
  );
  return (
    <div className="mt-2.5 space-y-2 rounded-xl border border-line bg-card/45 p-2.5">
      <section aria-label="말풍선 빠른 변형" className="space-y-1.5">
        <p className="text-[0.72rem] font-semibold text-fg-3 uppercase tracking-wider">빠른 변형</p>
        <div className="grid grid-cols-2 gap-1.5">
          {QUICK_TRANSFORMS.map(({ action, icon: Icon, label, title }) => {
            const flipAction = action === "flip-horizontal" || action === "flip-vertical";
            const unavailableReason =
              quickTransformUnavailableReasons[action] ??
              (quickTransformFlipDisabled && flipAction
                ? "꼬리 자동 부착 상태입니다. 좌우·상하 반전은 해제 후 사용할 수 있습니다."
                : null);
            const disabled = quickTransformDisabled || unavailableReason !== null;
            const accessibleTitle = unavailableReason ? `${title} — ${unavailableReason}` : title;
            return (
            <button
              key={action}
              type="button"
              aria-label={accessibleTitle}
              className="touch-manipulation inline-flex min-h-11 items-center justify-start gap-2 rounded-lg border border-line bg-raised/65 px-2.5 py-1.5 text-left text-[0.68rem] font-semibold text-fg-2 transition-[background-color,border-color,color,transform] hover:border-accent/45 hover:bg-accent/12 hover:text-fg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
              disabled={disabled}
              onClick={() => onQuickTransform(action)}
              title={accessibleTitle}
            >
              <Icon className="size-4 shrink-0 text-accent" aria-hidden />
              <span>{label}</span>
            </button>
            );
          })}
        </div>
        {quickTransformStatusMessages.length > 0 && (
          <p role="status" className="text-[0.66rem] leading-relaxed text-fg-3">
            {quickTransformStatusMessages.join(" · ")}
          </p>
        )}
      </section>

      {canCustomize && (
        <>
          <div className="flex items-center justify-between gap-2 border-t border-line/50 pt-2">
        <p className="text-[0.72rem] font-semibold text-fg-3 uppercase tracking-wider">커스텀 모양</p>
        {hasCustomShape && (
          <button
            type="button"
            onClick={onRevert}
            title="기본 모양(테마·꼬리 설정 기반)으로 되돌립니다."
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.68rem] font-medium text-fg-3 hover:bg-raised hover:text-fg"
          >
            <Undo2 className="size-3" aria-hidden />
            되돌리기
          </button>
        )}
      </div>

      {!hasCustomShape ? (
        <>
          <p className="text-[0.72rem] leading-relaxed text-fg-3">
            말풍선 외곽선을 촘촘한 점 배열로 바꿔 자유롭게 모양을 조각할 수 있습니다. 전환하면 현재
            테두리 둥글기·꼬리 위치를 그대로 반영한 윤곽에서 시작하며, 별·하트 등 특수 모양은 조각의
            출발점이 되지 않고 둥근사각형(+꼬리) 윤곽으로 대체됩니다.
          </p>
          <button
            type="button"
            onClick={onConvert}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-raised px-3 py-1.5 text-[0.72rem] font-semibold text-fg transition-colors hover:bg-accent hover:text-on-accent"
          >
            <Shapes className="size-3.5" aria-hidden />
            커스텀 모양으로 전환
          </button>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-fg-2">점 편집</span>
            <StudioToggleChip
              active={active}
              onClick={onToggleEdit}
              title={active ? "점 편집을 끕니다." : "점 편집을 켜고 폴리곤 위의 점을 조절합니다."}
            >
              {active ? "편집 중" : "편집 시작"}
            </StudioToggleChip>
          </div>

          {active ? (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  aria-label={
                    selectedPointIndex === null
                      ? "가장 긴 외곽선 선분에 점 추가"
                      : `선택한 ${selectedPointIndex + 1}번 점 다음 선분에 점 추가`
                  }
                  className="inline-flex min-h-11 touch-manipulation items-center justify-center gap-1.5 rounded-lg border border-line bg-raised px-2 text-[0.7rem] font-semibold text-fg-2 transition-colors hover:border-accent/45 hover:bg-accent/12 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={pointActionsDisabled || pointCount < 3}
                  onClick={onAddPoint}
                  title={
                    selectedPointIndex === null
                      ? "가장 긴 선분의 중점에 새 점을 추가합니다."
                      : "선택한 점과 다음 점 사이의 중점에 새 점을 추가합니다."
                  }
                >
                  <CirclePlus className="size-4" aria-hidden />
                  점 추가
                </button>
                <button
                  type="button"
                  aria-label={
                    selectedPointIndex === null
                      ? "삭제할 외곽선 점을 먼저 선택"
                      : `선택한 ${selectedPointIndex + 1}번 외곽선 점 삭제`
                  }
                  className="inline-flex min-h-11 touch-manipulation items-center justify-center gap-1.5 rounded-lg border border-line bg-raised px-2 text-[0.7rem] font-semibold text-fg-2 transition-colors hover:border-bad/45 hover:bg-bad/10 hover:text-bad disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={pointActionsDisabled || selectedPointIndex === null || pointCount <= 3}
                  onClick={onRemovePoint}
                  title={
                    pointCount <= 3
                      ? "말풍선 외곽선에는 최소 3개의 점이 필요합니다."
                      : selectedPointIndex === null
                        ? "캔버스에서 삭제할 점을 먼저 선택하세요."
                        : `선택한 ${selectedPointIndex + 1}번 점을 삭제합니다.`
                  }
                >
                  <CircleMinus className="size-4" aria-hidden />
                  선택 점 삭제
                </button>
              </div>
              <p role="status" className="text-[0.68rem] leading-relaxed text-fg-3">
                {selectedPointIndex === null
                  ? `선택된 점 없음 · 점 추가는 가장 긴 선분의 중점을 사용합니다. 현재 ${pointCount}개`
                  : `${selectedPointIndex + 1}번 점 선택됨 · 점 추가는 다음 선분의 중점을 사용합니다. 현재 ${pointCount}개`}
              </p>
              {pointCount < 3 ? (
                <p className="text-[0.72rem] text-fg-3">편집할 점이 부족합니다.</p>
              ) : (
                <p className="text-[0.72rem] leading-relaxed text-fg-3">
                  점을 끌어 외곽선을 바꿉니다. 키보드에서는 Shift+외곽선 클릭으로 추가하고,
                  Alt+점 클릭 또는 점 선택 후 Delete로 삭제할 수 있습니다.
                </p>
              )}
            </>
          ) : (
            <p className="text-[0.72rem] leading-relaxed text-fg-3">
              편집을 시작하면 폴리곤 위에 조절 핸들 {pointCount}개가 나타납니다.
            </p>
          )}
        </>
      )}
        </>
      )}
    </div>
  );
}
