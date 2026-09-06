import { useCallback, useRef, useState } from "react";

import {
  createStudioHistoryJournal,
  readStudioHistoryJournalRedoEntry,
  readStudioHistoryJournalUndoEntry,
  recordStudioHistoryJournalPagesSteps,
} from "../../studio-history-journal";

import type { StudioCharacterBible } from "../../studio-character-bible";
import type { StudioPageHistoryJournal } from "../../studio-page-editor-types";
import type { StudioWriterRoomDocument } from "../../studio-writer-room";

/** Orders snapshot and sidecar undo entries on one timeline without duplicating page payloads. */
export function useStudioUnifiedHistoryJournal() {
  const [historyJournal, setHistoryJournalState] = useState<StudioPageHistoryJournal>(() =>
    createStudioHistoryJournal()
  );
  const historyJournalRef = useRef(historyJournal);
  historyJournalRef.current = historyJournal;

  const commitStudioHistoryJournal = useCallback((next: StudioPageHistoryJournal): void => {
    historyJournalRef.current = next;
    setHistoryJournalState(next);
  }, []);
  const recordStudioHistoryJournalPages = useCallback((
    addedSteps: number,
    nextUndoDepth: number,
  ): void => {
    if (addedSteps <= 0) return;
    commitStudioHistoryJournal(
      recordStudioHistoryJournalPagesSteps(historyJournalRef.current, {
        addedSteps,
        nextUndoDepth,
      }),
    );
  }, [commitStudioHistoryJournal]);
  const resetStudioHistoryJournal = useCallback((): void => {
    commitStudioHistoryJournal(
      createStudioHistoryJournal<StudioCharacterBible, StudioWriterRoomDocument>(),
    );
  }, [commitStudioHistoryJournal]);

  return {
    commitStudioHistoryJournal,
    historyJournal,
    historyJournalRef,
    recordStudioHistoryJournalPages,
    resetStudioHistoryJournal,
    studioHistorySidecarRedoAvailable:
      readStudioHistoryJournalRedoEntry(historyJournal)?.kind === "sidecar",
    studioHistorySidecarUndoAvailable:
      readStudioHistoryJournalUndoEntry(historyJournal)?.kind === "sidecar",
  } as const;
}
