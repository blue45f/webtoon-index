import { describe, expect, it } from "vitest";

import { STUDIO_PAGES_HISTORY_RETAINED_BYTES_BUDGET } from "./studio-history-retention-budget";
import {
  createStudioHistoryRetentionUiState,
  observeStudioHistoryRetentionAppend,
} from "./studio-history-retention-ui";

describe("studio history retention UI state", () => {
  it("starts without a stale document notice", () => {
    expect(createStudioHistoryRetentionUiState()).toEqual({
      lastMeasuredRetainedBytes: 0,
      lastMeasuredBudgetBytes: STUDIO_PAGES_HISTORY_RETAINED_BYTES_BUDGET,
      lastMeasuredEntryBytes: 0,
      totalBudgetEvictedSteps: 0,
      notice: null,
    });
  });

  it("updates diagnostics without changing the live notice on an ordinary append", () => {
    const afterEviction = observeStudioHistoryRetentionAppend(
      createStudioHistoryRetentionUiState(),
      {
        historyIndex: 7,
        retainedBytes: 190,
        budgetBytes: 192,
        appendedEntryBytes: 12,
        evictedCount: 2,
        evictedForBudget: true,
      },
      { collaborating: false }
    );
    const afterOrdinaryAppend = observeStudioHistoryRetentionAppend(
      afterEviction,
      {
        historyIndex: 8,
        retainedBytes: 191,
        budgetBytes: 192,
        appendedEntryBytes: 1,
        evictedCount: 0,
        evictedForBudget: false,
      },
      { collaborating: false }
    );

    expect(afterOrdinaryAppend).toMatchObject({
      lastMeasuredRetainedBytes: 191,
      lastMeasuredBudgetBytes: 192,
      lastMeasuredEntryBytes: 1,
      totalBudgetEvictedSteps: 2,
    });
    expect(afterOrdinaryAppend.notice).toBe(afterEviction.notice);
  });

  it("announces each budget eviction once using its own count and authoritative undo depth", () => {
    const first = observeStudioHistoryRetentionAppend(
      createStudioHistoryRetentionUiState(),
      {
        historyIndex: 7,
        retainedBytes: 190 * 1024 * 1024,
        budgetBytes: 192 * 1024 * 1024,
        appendedEntryBytes: 24 * 1024 * 1024,
        evictedCount: 3,
        evictedForBudget: true,
      },
      { collaborating: true }
    );
    const second = observeStudioHistoryRetentionAppend(
      first,
      {
        historyIndex: 6,
        retainedBytes: 188 * 1024 * 1024,
        budgetBytes: 192 * 1024 * 1024,
        appendedEntryBytes: 30 * 1024 * 1024,
        evictedCount: 2,
        evictedForBudget: true,
      },
      { collaborating: true }
    );

    expect(first.notice).toMatchObject({ id: 1 });
    expect(first.notice?.message).toContain("오래된 3단계");
    expect(first.notice?.message).toContain("현재 7단계");
    expect(second.notice).toMatchObject({ id: 2 });
    expect(second.notice?.message).toContain("오래된 2단계");
    expect(second.notice?.message).toContain("현재 6단계");
    expect(second.totalBudgetEvictedSteps).toBe(5);
  });

  it("resets every document-scoped diagnostic on hard hydration", () => {
    const populated = observeStudioHistoryRetentionAppend(
      createStudioHistoryRetentionUiState(),
      {
        historyIndex: 4,
        retainedBytes: 90,
        budgetBytes: 100,
        appendedEntryBytes: 25,
        evictedCount: 1,
        evictedForBudget: true,
      },
      { collaborating: false }
    );

    expect(populated.notice).not.toBeNull();
    expect(createStudioHistoryRetentionUiState()).toEqual({
      lastMeasuredRetainedBytes: 0,
      lastMeasuredBudgetBytes: STUDIO_PAGES_HISTORY_RETAINED_BYTES_BUDGET,
      lastMeasuredEntryBytes: 0,
      totalBudgetEvictedSteps: 0,
      notice: null,
    });
  });
});
