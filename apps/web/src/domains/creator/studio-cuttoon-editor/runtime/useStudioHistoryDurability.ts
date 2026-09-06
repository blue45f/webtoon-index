import { useCallback, useEffect, useRef, useState } from "react";

import { createStudioPageHistoryCommandJournalClient } from "../../studio-page-shell-runtime";
import {
  STUDIO_PAGES_HISTORY_INITIAL_DURABILITY_STATUS,
  type StudioHistoryJournalTransitionInput,
  type StudioPagesHistoryCommandJournalDurabilityStatus,
} from "../../studio-pages-history-command-journal-client";

import type { PageState } from "../../studio-page-state";

/** Durable command-journal observer and best-effort recovery facade. */
export function useStudioHistoryDurability() {
  const [pagesHistoryDurabilityStatus, setPagesHistoryDurabilityStatus] =
    useState<StudioPagesHistoryCommandJournalDurabilityStatus>(
      STUDIO_PAGES_HISTORY_INITIAL_DURABILITY_STATUS,
    );
  const pagesHistoryCommandJournalRef = useRef<ReturnType<
    typeof createStudioPageHistoryCommandJournalClient
  > | null>(null);

  useEffect(() => {
    // Strict Mode can replay setup/cleanup without a render. Recreate a disposed client in setup.
    pagesHistoryCommandJournalRef.current ??=
      createStudioPageHistoryCommandJournalClient();
    const client = pagesHistoryCommandJournalRef.current;
    const stopObservingDurability = client?.observeDurabilityStatus(
      setPagesHistoryDurabilityStatus,
    );
    return () => {
      stopObservingDurability?.();
      client?.dispose();
      if (pagesHistoryCommandJournalRef.current === client) {
        pagesHistoryCommandJournalRef.current = null;
      }
    };
  }, []);

  function retryStudioHistoryDurability(): void {
    void pagesHistoryCommandJournalRef.current?.retryDurability().catch((cause: unknown) => {
      setPagesHistoryDurabilityStatus({
        state: "memory-only",
        durable: false,
        persistenceKind: "memory-only",
        retryable: true,
        cause,
      });
    });
  }
  /**
   * 메모이제이션이 아니라 **정체성 안정화**다. 이 훅은 React Compiler 가 컴파일하지 못한다 —
   * 위 effect 의 `??=` 에서 통째로 bail out 하므로(babel-plugin-react-compiler 1.0.0:
   * "Handle ??= operators in AssignmentExpression"), 훅이 소스 그대로 방출되고 이 함수 선언은
   * 렌더마다 새 클로저가 된다.
   *
   * StudioCuttoonEditorHost 의 CRDT frontier layout effect 가 이 값을 의존성에 담고 있어서,
   * 새 정체성이 곧 매 렌더 재실행을 뜻했다. 그 재실행은 전체 frontier 를 다시 조정하는데
   * reconcile 은 멱등하지 않아 변경이 없어도 `changed: true` 를 돌려주고, 그러면
   * setPagesHistoryState 가 또 렌더를 부른다 — 획 하나가 문서에 처음 기록되는 순간
   * (그전까지는 빈 frontier 조기 반환이 회로를 끊고 있었다) 이 고리가 닫히면서 React #185
   * "Maximum update depth exceeded" 로 에디터가 통째로 무너졌다. 프로덕션에서는 두 에러
   * 바운더리가 DEV 에서만 로그를 남겨 조용히 사라졌다.
   *
   * 본문이 닫고 있는 값은 렌더마다 안정적인 ref 하나뿐이라 빈 의존성 배열이 맞다.
   */
  const rebaseStudioHistoryJournal = useCallback((
    resultingPages: StudioHistoryJournalTransitionInput["nextPages"],
    resultingHistoryIndex: number,
    reason: string,
  ): void => {
    try {
      pagesHistoryCommandJournalRef.current?.rebase({
        pages: resultingPages,
        historyIndex: resultingHistoryIndex,
      });
    } catch (cause) {
      if (import.meta.env.DEV) {
        console.warn(`Studio command journal rebase failed (${reason}).`, cause);
      }
    }
  }, []);
  function recordStudioHistoryTransition(
    input: StudioHistoryJournalTransitionInput,
  ): void {
    try {
      pagesHistoryCommandJournalRef.current?.recordTransition(input);
    } catch (cause) {
      rebaseStudioHistoryJournal(
        input.nextPages,
        input.nextHistoryIndex,
        "transition recovery",
      );
      if (import.meta.env.DEV) {
        console.warn("Studio command journal transition was reset.", cause);
      }
    }
  }
  function recordStudioHistoryUndoRedo(
    action: "undo" | "redo",
    resultingPages: PageState[],
    resultingHistoryIndex: number,
  ): void {
    const target = { pages: resultingPages, historyIndex: resultingHistoryIndex };
    try {
      if (action === "undo") {
        pagesHistoryCommandJournalRef.current?.recordUndo(target);
      } else {
        pagesHistoryCommandJournalRef.current?.recordRedo(target);
      }
    } catch (cause) {
      rebaseStudioHistoryJournal(
        resultingPages,
        resultingHistoryIndex,
        `${action} recovery`,
      );
      if (import.meta.env.DEV) {
        console.warn(`Studio command journal ${action} was reset.`, cause);
      }
    }
  }

  return {
    pagesHistoryCommandJournalRef,
    pagesHistoryDurabilityStatus,
    rebaseStudioHistoryJournal,
    recordStudioHistoryTransition,
    recordStudioHistoryUndoRedo,
    retryStudioHistoryDurability,
  } as const;
}
