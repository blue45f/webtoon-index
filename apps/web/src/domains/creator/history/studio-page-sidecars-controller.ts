import { useRef, useState, type MutableRefObject } from "react";

import {
  normalizeStudioCharacterBible,
  type StudioCharacterBible,
} from "../studio-character-bible";
import {
  recordStudioHistoryJournalSidecarEdit,
  type StudioHistoryJournal,
  type StudioHistoryJournalSidecarEntry,
} from "../studio-history-journal";
import {
  createEmptyStudioWriterRoomDocument,
  type StudioWriterRoomDocument,
} from "../studio-writer-room";

export type StudioPageHistoryJournal = StudioHistoryJournal<StudioCharacterBible, StudioWriterRoomDocument>;
export type StudioPageHistorySidecarEntry = StudioHistoryJournalSidecarEntry<StudioCharacterBible, StudioWriterRoomDocument>;

export interface UseStudioSidecarDocumentsOptions {
  readonly markStudioDocumentChanged: () => boolean;
  readonly onBeforeRecordSidecar?: () => void;
  readonly historyJournalRef: MutableRefObject<StudioPageHistoryJournal>;
  readonly commitStudioHistoryJournal: (journal: StudioPageHistoryJournal) => void;
}

export function useStudioSidecarDocuments({
  markStudioDocumentChanged,
  onBeforeRecordSidecar,
  historyJournalRef,
  commitStudioHistoryJournal,
}: UseStudioSidecarDocumentsOptions) {
  const [characterBible, setCharacterBibleState] = useState<StudioCharacterBible>(() =>
    normalizeStudioCharacterBible(undefined),
  );
  const characterBibleRef = useRef(characterBible);
  characterBibleRef.current = characterBible;

  const [writerRoom, setWriterRoomState] = useState<StudioWriterRoomDocument>(() =>
    createEmptyStudioWriterRoomDocument(),
  );
  const writerRoomRef = useRef(writerRoom);
  writerRoomRef.current = writerRoom;

  function recordStudioSidecarHistoryEntry(entry: StudioPageHistorySidecarEntry): void {
    onBeforeRecordSidecar?.();
    commitStudioHistoryJournal(
      recordStudioHistoryJournalSidecarEdit(historyJournalRef.current, entry),
    );
  }

  const setCharacterBible = (next: Parameters<typeof setCharacterBibleState>[0]) => {
    if (!markStudioDocumentChanged()) return;
    const before = characterBibleRef.current;
    const after = typeof next === "function" ? next(before) : next;
    if (after === before) return;
    characterBibleRef.current = after;
    recordStudioSidecarHistoryEntry({
      kind: "sidecar",
      target: "characterBible",
      before,
      after,
      at: Date.now(),
    });
    setCharacterBibleState(after);
  };

  const setWriterRoom = (next: Parameters<typeof setWriterRoomState>[0]) => {
    if (!markStudioDocumentChanged()) return;
    const before = writerRoomRef.current;
    const after = typeof next === "function" ? next(before) : next;
    if (after === before) return;
    writerRoomRef.current = after;
    recordStudioSidecarHistoryEntry({
      kind: "sidecar",
      target: "writerRoom",
      before,
      after,
      at: Date.now(),
    });
    setWriterRoomState(after);
  };

  function restoreStudioSidecarDocument(
    entry: StudioPageHistorySidecarEntry,
    direction: "undo" | "redo",
  ): boolean {
    if (!markStudioDocumentChanged()) return false;
    if (entry.target === "characterBible") {
      const value = direction === "undo" ? entry.before : entry.after;
      characterBibleRef.current = value;
      setCharacterBibleState(value);
    } else {
      const value = direction === "undo" ? entry.before : entry.after;
      writerRoomRef.current = value;
      setWriterRoomState(value);
    }
    return true;
  }

  function hydrateStudioSidecarDocuments(input: {
    readonly characterBible: StudioCharacterBible;
    readonly writerRoom: StudioWriterRoomDocument;
  }): void {
    if (!markStudioDocumentChanged()) return;
    characterBibleRef.current = input.characterBible;
    writerRoomRef.current = input.writerRoom;
    setCharacterBibleState(input.characterBible);
    setWriterRoomState(input.writerRoom);
  }

  return {
    characterBible,
    characterBibleRef,
    writerRoom,
    writerRoomRef,
    setCharacterBible,
    setWriterRoom,
    setCharacterBibleState,
    setWriterRoomState,
    recordStudioSidecarHistoryEntry,
    restoreStudioSidecarDocument,
    hydrateStudioSidecarDocuments,
  };
}
