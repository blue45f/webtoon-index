// 작업 내역(히스토리) 패널 — 포토샵 히스토리처럼 단계 목록(최신 위, 현재 강조)을 보여주고
// 항목 클릭으로 그 시점으로 즉시 점프한다(실행취소/다시실행 반복과 동일한 인덱스 이동).
// 라벨·점프 계산은 studio-history-labels(순수), 인덱스 반영(setPagesHi)은 StudioPage(메인 루프)가 담당.
// 자체완결 플로팅 패널: 캔버스 컨테이너(relative) 우측 상단에 떠 있고 Esc 로 닫힌다.
import { History as HistoryIcon, Paintbrush, X } from "lucide-react";
import { useEffect, useRef } from "react";

import {
  buildHistoryTimeline,
  planHistoryJump,
  sliceHistoryForDisplay,
  type HistorySnapshot,
} from "./studio-history-labels";

import { cx } from "@/shared/lib/cx";

export type StudioHistoryPanelProps = {
  /** 히스토리 스냅샷 배열 — StudioPage 의 pagesHistory 를 그대로 받는다(불변). */
  history: readonly HistorySnapshot[];
  /** 현재 히스토리 인덱스(StudioPage 의 pagesHi). */
  currentIndex: number;
  /** 항목 클릭 → 해당 인덱스로 점프(setPagesHi 와 동일한 좌표계). */
  onJumpTo: (index: number) => void;
  onClose: () => void;
  /** 히스토리 브러시 소스 지정 콜백 — StudioPage 가 선택된 요소가 이미지일 때만 전달한다(그 외엔
   * undefined 로 넘겨 아래 붓 아이콘 열 자체를 숨긴다). */
  onDesignateBrushSource?: (index: number) => void;
  /** 지금 지정된 소스 행(하이라이트용) — onDesignateBrushSource 가 있을 때만 의미 있다. */
  brushSourceIndex?: number | null;
  /** index별 지정 가능 여부(studio-history-brush 의 computeHistoryBrushAvailability 결과를 그대로
   * 받는다) — 배열 인덱스가 entry.index 와 같은 좌표계. 없으면(undefined) 전부 지정 가능으로
   * 취급(disabled 없음). */
  brushSourceAvailability?: readonly boolean[];
};

export function StudioHistoryPanel({
  history,
  currentIndex,
  onJumpTo,
  onClose,
  onDesignateBrushSource,
  brushSourceIndex,
  brushSourceAvailability,
}: StudioHistoryPanelProps) {
  // 표시 목록: 라벨 타임라인(오래된→최신) → 표시 상한 창 → 최신이 위로 오게 뒤집기.
  const timeline = buildHistoryTimeline(history);
  const { visible, hiddenCount } = sliceHistoryForDisplay(timeline);
  const newestFirst = [...visible].reverse();

  // Esc 로 닫기 — 입력 필드 안의 Esc 는 각 필드의 몫이므로 제외(대사 패널과 동일 규약).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)) {
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 현재 단계 버튼 — 열릴 때 1회 포커스(키보드 사용자), 이후 ⌘Z 진행 중에는 훔치지 않는다.
  const currentItemRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    currentItemRef.current?.focus({ preventScroll: true });
  }, []);
  // undo/redo/점프로 현재 인덱스가 바뀌면 현재 항목이 보이게만 따라간다.
  useEffect(() => {
    currentItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentIndex]);

  const jump = (index: number) => {
    const plan = planHistoryJump(currentIndex, index, history.length);
    if (plan.direction === "none") return;
    onJumpTo(plan.targetIndex);
  };

  return (
    <section
      aria-label="작업 내역"
      className="absolute right-3 top-3 z-40 flex max-h-[calc(100%-5rem)] w-[min(17rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-xl border border-line bg-panel/95 shadow-xl backdrop-blur"
    >
      <div className="flex items-center justify-between gap-2 border-b border-line/60 px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs font-bold text-fg">
          <HistoryIcon size={13} className="shrink-0 text-fg-3" aria-hidden />
          작업 내역
          <span className="font-medium text-fg-3">{history.length}단계</span>
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="작업 내역 닫기"
          className="grid size-6 place-items-center rounded-lg border border-line text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <X size={13} />
        </button>
      </div>

      {/* 단계 목록 — 최신이 위. 현재 이후(다시실행 영역)는 흐리게 표시(포토샵 관례). */}
      <ol aria-label="작업 단계 목록 (최신 순)" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2.5 py-2">
        {newestFirst.map((entry) => {
          const isCurrent = entry.index === currentIndex;
          const isRedoSide = entry.index > currentIndex;
          return (
            <li key={entry.index} className="flex items-center gap-1">
              <button
                type="button"
                ref={isCurrent ? currentItemRef : undefined}
                onClick={() => jump(entry.index)}
                aria-current={isCurrent ? "step" : undefined}
                title={isCurrent ? "현재 시점" : "이 시점으로 이동"}
                className={cx(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-[0.72rem] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                  isCurrent
                    ? "border-accent/70 bg-accent-soft/40 font-semibold text-fg"
                    : isRedoSide
                      ? "border-line/60 bg-card/25 text-fg-3 opacity-70 hover:bg-raised hover:opacity-100"
                      : "border-line bg-card/45 text-fg-2 hover:bg-raised hover:text-fg"
                )}
              >
                <span className="w-6 shrink-0 text-right tabular-nums text-fg-3">{entry.ordinal}</span>
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {isCurrent && (
                  <span className="shrink-0 rounded-full border border-accent/40 bg-accent-soft/40 px-1.5 text-[0.72rem] font-medium text-accent">
                    현재
                  </span>
                )}
              </button>
              {onDesignateBrushSource && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDesignateBrushSource(entry.index);
                  }}
                  disabled={brushSourceAvailability ? !brushSourceAvailability[entry.index] : false}
                  aria-pressed={brushSourceIndex === entry.index}
                  title={
                    brushSourceAvailability && !brushSourceAvailability[entry.index]
                      ? "이 시점엔 같은 레이어가 없어 지정할 수 없어요."
                      : brushSourceIndex === entry.index
                        ? "히스토리 브러시 소스로 지정됨"
                        : "이 시점을 히스토리 브러시 소스로 지정"
                  }
                  className={cx(
                    "grid size-6 shrink-0 place-items-center rounded-lg border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                    brushSourceIndex === entry.index
                      ? "border-accent bg-accent text-on-accent"
                      : "border-line text-fg-3 hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-3"
                  )}
                >
                  <Paintbrush size={12} aria-hidden />
                </button>
              )}
            </li>
          );
        })}
        {hiddenCount > 0 && (
          <li className="px-2 py-1 text-[0.72rem] leading-snug text-fg-3">
            이전 단계 {hiddenCount}개는 표시 생략 — 더 되돌리려면 목록 맨 아래로 이동한 뒤 ⌘Z 를 이어서 누르세요.
          </li>
        )}
      </ol>

      <p className="border-t border-line/60 px-3 py-1.5 text-[0.72rem] leading-snug text-fg-3">
        항목을 누르면 그 시점으로 즉시 이동해요 · ⌘Z 실행취소 · ⇧⌘Z 다시실행
        {onDesignateBrushSource && " · 붓 아이콘으로 히스토리 브러시 소스 지정"}
      </p>
    </section>
  );
}
