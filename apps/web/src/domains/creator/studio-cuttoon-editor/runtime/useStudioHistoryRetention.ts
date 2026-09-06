import { useCallback, useRef, useState, type RefObject } from "react";

import {
  createStudioHistoryRetentionUiState,
  observeStudioHistoryRetentionAppend,
} from "../../studio-history-retention-ui";

import type { StudioCrdtDocument } from "../../live/studio-crdt-document";
import type { PageState } from "../../studio-page-state";
import type { StudioPagesHistoryAppendResult } from "../../studio-pending-stroke-durability";

/** Tracks bounded-history evictions and exposes user-facing retention diagnostics. */
export function useStudioHistoryRetention(
  studioCrdtDocumentRef: RefObject<StudioCrdtDocument | null>,
) {
  const [studioHistoryRetention, setStudioHistoryRetention] = useState(
    createStudioHistoryRetentionUiState,
  );
  const studioHistoryRetentionRef = useRef(studioHistoryRetention);
  studioHistoryRetentionRef.current = studioHistoryRetention;

  const commitStudioHistoryRetention = useCallback((
    next: typeof studioHistoryRetention,
  ): void => {
    studioHistoryRetentionRef.current = next;
    setStudioHistoryRetention(next);
  }, []);
  const noteStudioHistoryRetention = useCallback((
    appended: StudioPagesHistoryAppendResult<PageState>,
  ): void => {
    commitStudioHistoryRetention(
      observeStudioHistoryRetentionAppend(
        studioHistoryRetentionRef.current,
        appended,
        { collaborating: Boolean(studioCrdtDocumentRef.current) },
      ),
    );
  }, [commitStudioHistoryRetention, studioCrdtDocumentRef]);
  const resetStudioHistoryRetention = useCallback((): void => {
    commitStudioHistoryRetention(createStudioHistoryRetentionUiState());
  }, [commitStudioHistoryRetention]);

  return {
    noteStudioHistoryRetention,
    resetStudioHistoryRetention,
    studioHistoryRetention,
  } as const;
}
