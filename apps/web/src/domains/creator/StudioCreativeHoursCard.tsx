/**
 * Studio Creative Hours Card (창작 시간 및 생산성 통계 카드)
 *
 * CLIP STUDIO PAINT Ver.3.0 & Ver.4.1.0 Parity:
 * - "My Creative Hours" (내 창작 시간 및 정보 팔레트 연동):
 *   - Displays active work time, session duration, stroke count, and drawing pace.
 *   - Visual active vs. idle indicator.
 */

import { Clock, Flame, PauseCircle, PlayCircle, RotateCcw } from "lucide-react";

import {
  computeCreativeWorkStatistics,
  type CreativeWorkTimeTrackerState,
} from "./studio-creative-work-time-tracker";

export interface StudioCreativeHoursCardProps {
  readonly tracker: CreativeWorkTimeTrackerState;
  readonly onResetSession?: () => void;
  readonly className?: string;
}

export function StudioCreativeHoursCard({
  tracker,
  onResetSession,
  className = "",
}: StudioCreativeHoursCardProps) {
  const stats = computeCreativeWorkStatistics(tracker);

  return (
    <div
      data-studio-creative-hours-card
      className={`flex flex-col gap-2.5 rounded-xl border border-line bg-card p-3 text-xs text-fg shadow-sm ${className}`}
    >
      <div className="flex items-center justify-between border-b border-line/60 pb-2">
        <div className="flex items-center gap-1.5 font-semibold text-fg-2">
          <Clock className="size-4 text-accent" />
          <span>내 창작 시간 (Creative Hours)</span>
        </div>
        <span
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.62rem] font-semibold ${
            stats.isCurrentlyIdle
              ? "bg-warning/20 text-warning"
              : "bg-success/20 text-success"
          }`}
        >
          {stats.isCurrentlyIdle ? (
            <>
              <PauseCircle className="size-3" />
              <span>휴식 중</span>
            </>
          ) : (
            <>
              <PlayCircle className="size-3" />
              <span>작업 중</span>
            </>
          )}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[0.68rem]">
        <div className="rounded-lg bg-panel/60 p-2">
          <span className="text-fg-3">총 누적 시간</span>
          <div className="text-sm font-bold text-fg-2 mt-0.5">
            {stats.totalDurationFormatted}
          </div>
        </div>
        <div className="rounded-lg bg-panel/60 p-2">
          <span className="text-fg-3">이번 세션 시간</span>
          <div className="text-sm font-bold text-accent mt-0.5">
            {stats.sessionDurationFormatted}
          </div>
        </div>
        <div className="rounded-lg bg-panel/60 p-2">
          <span className="text-fg-3">총 획(스트로크) 수</span>
          <div className="text-sm font-bold text-fg-2 mt-0.5">
            {stats.strokeCount.toLocaleString()}회
          </div>
        </div>
        <div className="rounded-lg bg-panel/60 p-2">
          <div className="flex items-center gap-1 text-fg-3">
            <Flame className="size-3 text-orange-500" />
            <span>작업 페이스</span>
          </div>
          <div className="text-sm font-bold text-fg-2 mt-0.5">
            {stats.strokesPerMinute} 획/분
          </div>
        </div>
      </div>

      {onResetSession && (
        <div className="flex justify-end pt-1 border-t border-line/40">
          <button
            type="button"
            onClick={onResetSession}
            aria-label="세션 시간 초기화"
            className="flex items-center gap-1 rounded bg-raised px-2 py-1 text-[0.65rem] font-medium text-fg-2 hover:bg-accent-soft hover:text-accent"
          >
            <RotateCcw className="size-3" />
            <span>세션 리셋</span>
          </button>
        </div>
      )}
    </div>
  );
}
