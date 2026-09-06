import {
  describeStudioHistoryBudgetEviction,
  STUDIO_PAGES_HISTORY_RETAINED_BYTES_BUDGET,
} from "./studio-history-retention-budget";

import type { StudioPagesHistoryAppendResult } from "./studio-pending-stroke-durability";

export type StudioHistoryRetentionNotice = Readonly<{
  /** 새 예산 퇴출마다 증가한다. React live-region을 그 이벤트에만 다시 마운트하는 키다. */
  id: number;
  message: string;
}>;

export type StudioHistoryRetentionUiState = Readonly<{
  /** 가장 최근 append 영수증의 계량값. CRDT rebase 뒤에는 다음 append까지 last-measured다. */
  lastMeasuredRetainedBytes: number;
  lastMeasuredBudgetBytes: number;
  lastMeasuredEntryBytes: number;
  /** 현재 문서 세션에서 바이트 예산 때문에 퇴출한 단계의 진단 누계. */
  totalBudgetEvictedSteps: number;
  /** 마지막 퇴출 시점에 한 번만 만든 고정 문장. 일반 append는 이 live-region을 바꾸지 않는다. */
  notice: StudioHistoryRetentionNotice | null;
}>;

export function createStudioHistoryRetentionUiState(): StudioHistoryRetentionUiState {
  return {
    lastMeasuredRetainedBytes: 0,
    lastMeasuredBudgetBytes: STUDIO_PAGES_HISTORY_RETAINED_BYTES_BUDGET,
    lastMeasuredEntryBytes: 0,
    totalBudgetEvictedSteps: 0,
    notice: null,
  };
}

/**
 * append 영수증을 UI 진단 상태로 투영한다. 측정값은 매 append 갱신하지만, 사용자 안내 문장은
 * 실제 바이트 예산 퇴출 이벤트에서만 새로 만든다. 그래서 첫 퇴출 뒤의 평범한 붓질이
 * `role="status"`를 계속 갱신해 스크린리더에 같은 경고를 반복하지 않는다.
 */
export function observeStudioHistoryRetentionAppend<Page>(
  previous: StudioHistoryRetentionUiState,
  appended: Pick<
    StudioPagesHistoryAppendResult<Page>,
    | "historyIndex"
    | "retainedBytes"
    | "budgetBytes"
    | "appendedEntryBytes"
    | "evictedCount"
    | "evictedForBudget"
  >,
  options: Readonly<{ collaborating: boolean }>
): StudioHistoryRetentionUiState {
  const budgetEvictedSteps = appended.evictedForBudget
    ? Math.max(0, appended.evictedCount)
    : 0;
  const notice = budgetEvictedSteps > 0
    ? {
        id: (previous.notice?.id ?? 0) + 1,
        message: describeStudioHistoryBudgetEviction({
          evictedSteps: budgetEvictedSteps,
          budgetBytes: appended.budgetBytes,
          entryBytes: appended.appendedEntryBytes,
          // append 직후 실제 undo 가능 깊이. 배열 길이가 아니라 historyIndex가 권위다.
          retainedSteps: Math.max(0, appended.historyIndex),
          collaborating: options.collaborating,
        }),
      }
    : previous.notice;

  return {
    lastMeasuredRetainedBytes: appended.retainedBytes,
    lastMeasuredBudgetBytes: appended.budgetBytes,
    lastMeasuredEntryBytes: appended.appendedEntryBytes,
    totalBudgetEvictedSteps: previous.totalBudgetEvictedSteps + budgetEvictedSteps,
    notice,
  };
}
