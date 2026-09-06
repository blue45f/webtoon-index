import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import {
  createEmptyStudioAiProvenanceDocument,
  type StudioAiProvenanceDocument,
} from "../../ai/studio-ai-provenance";
import { useStudioSidecarDocuments } from "../../history/studio-page-sidecars-controller";
import {
  composeMasterRenderElements,
  createEmptyDocumentMaster,
  type DocumentMaster,
} from "../../studio-master-page";
import {
  createEmptyStudioPublicationAnalyticsSnapshot,
} from "../../studio-publication-analytics-loader";
import {
  areStudioReferenceBoardDocumentsEqual,
  createDefaultStudioReferenceBoardDocument,
  normalizeStudioReferenceBoardDocument,
  type StudioReferenceBoardDocument,
} from "../../studio-reference-board";
import {
  createEmptyStudioReleaseScheduleSnapshot,
} from "../../studio-release-schedule-loader";

import type { El } from "../../studio-element-model";
import type { StudioPageHistoryJournal } from "../../studio-page-editor-types";
import type {
  StudioPublicationAnalyticsDocument,
} from "../../studio-publication-analytics";
import type { StudioReleaseSchedule } from "../../studio-release-schedule";

interface UseStudioDocumentSidecarsRuntimeOptions {
  readonly advanceStudioRevisionProjectGeneration: () => void;
  readonly beforeRecordSidecar: () => void;
  readonly commitStudioHistoryJournal: (journal: StudioPageHistoryJournal) => void;
  readonly historyJournalRef: RefObject<StudioPageHistoryJournal>;
  readonly markStudioDocumentChanged: () => boolean;
}

/**
 * Owns persisted document-level state that is not part of the page snapshot array.
 * Page history remains independent, while each public setter still participates in the document
 * mutation gate so autosave and collaboration see one consistent revision stream.
 */
export function useStudioDocumentSidecarsRuntime({
  advanceStudioRevisionProjectGeneration,
  beforeRecordSidecar,
  commitStudioHistoryJournal,
  historyJournalRef,
  markStudioDocumentChanged,
}: UseStudioDocumentSidecarsRuntimeOptions) {
  const [master, setMasterState] = useState<DocumentMaster<El>>(
    () => createEmptyDocumentMaster<El>(),
  );
  function setMaster(next: Parameters<typeof setMasterState>[0]): void {
    if (!markStudioDocumentChanged()) return;
    setMasterState(next);
  }

  const {
    characterBible,
    hydrateStudioSidecarDocuments,
    restoreStudioSidecarDocument,
    setCharacterBible,
    setWriterRoom,
    writerRoom,
  } = useStudioSidecarDocuments({
    markStudioDocumentChanged,
    onBeforeRecordSidecar: beforeRecordSidecar,
    historyJournalRef,
    commitStudioHistoryJournal,
  });

  const [aiProvenance, setAiProvenanceState] = useState<StudioAiProvenanceDocument>(
    createEmptyStudioAiProvenanceDocument,
  );
  function setAiProvenance(
    next: Parameters<typeof setAiProvenanceState>[0],
  ): void {
    if (!markStudioDocumentChanged()) return;
    setAiProvenanceState(next);
  }
  function setAiProvenanceOperationState(
    next: Parameters<typeof setAiProvenanceState>[0],
  ): void {
    advanceStudioRevisionProjectGeneration();
    setAiProvenanceState(next);
  }

  const [releaseSchedule, setReleaseScheduleState] = useState<StudioReleaseSchedule>(
    createEmptyStudioReleaseScheduleSnapshot,
  );
  function setReleaseSchedule(
    next: Parameters<typeof setReleaseScheduleState>[0],
  ): void {
    if (!markStudioDocumentChanged()) return;
    setReleaseScheduleState(next);
  }

  const [publicationAnalytics, setPublicationAnalyticsState] =
    useState<StudioPublicationAnalyticsDocument>(createEmptyStudioPublicationAnalyticsSnapshot);
  function setPublicationAnalytics(
    next: Parameters<typeof setPublicationAnalyticsState>[0],
  ): void {
    if (!markStudioDocumentChanged()) return;
    setPublicationAnalyticsState(next);
  }

  const [referenceBoard, setReferenceBoardState] = useState<StudioReferenceBoardDocument>(
    createDefaultStudioReferenceBoardDocument,
  );
  const referenceBoardCommittedSnapshotRef = useRef<Readonly<{
    document: StudioReferenceBoardDocument;
    revision: number;
  }>>(Object.freeze({ document: referenceBoard, revision: 1 }));
  const referenceBoardLatestRequestedRef = useRef(referenceBoard);
  useLayoutEffect(() => {
    referenceBoardLatestRequestedRef.current = referenceBoard;
    const previous = referenceBoardCommittedSnapshotRef.current;
    if (previous.document === referenceBoard) return;
    referenceBoardCommittedSnapshotRef.current = Object.freeze({
      document: referenceBoard,
      revision: previous.revision >= Number.MAX_SAFE_INTEGER ? 1 : previous.revision + 1,
    });
  }, [referenceBoard]);

  function setReferenceBoard(next: StudioReferenceBoardDocument): boolean {
    const normalized = normalizeStudioReferenceBoardDocument(next);
    if (
      areStudioReferenceBoardDocumentsEqual(
        referenceBoardLatestRequestedRef.current,
        normalized,
      )
    ) return true;
    if (!markStudioDocumentChanged()) return false;
    referenceBoardLatestRequestedRef.current = normalized;
    setReferenceBoardState(normalized);
    return true;
  }

  const [masterEditMode, setMasterEditMode] = useState(false);
  const masterEditModeRef = useRef(masterEditMode);
  masterEditModeRef.current = masterEditMode;
  const [masterPanelOpen, setMasterPanelOpen] = useState(false);
  const masterRenderEls = useMemo(() => composeMasterRenderElements(master), [master]);
  const masterRenderElsRef = useRef(masterRenderEls);
  masterRenderElsRef.current = masterRenderEls;

  return {
    aiProvenance,
    characterBible,
    hydrateStudioSidecarDocuments,
    master,
    masterEditMode,
    masterEditModeRef,
    masterPanelOpen,
    masterRenderEls,
    masterRenderElsRef,
    publicationAnalytics,
    referenceBoard,
    referenceBoardCommittedSnapshotRef,
    referenceBoardLatestRequestedRef,
    releaseSchedule,
    restoreStudioSidecarDocument,
    setAiProvenance,
    setAiProvenanceOperationState,
    setAiProvenanceState,
    setCharacterBible,
    setMaster,
    setMasterEditMode,
    setMasterPanelOpen,
    setMasterState,
    setPublicationAnalytics,
    setPublicationAnalyticsState,
    setReferenceBoard,
    setReferenceBoardState,
    setReleaseSchedule,
    setReleaseScheduleState,
    setWriterRoom,
    writerRoom,
  } as const;
}
