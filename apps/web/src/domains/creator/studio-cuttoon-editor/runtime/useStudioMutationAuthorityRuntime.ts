import { useCallback, useLayoutEffect, useRef } from "react";

import {
  isStudioEditorMutationContinuationAllowed,
  type StudioEditorMutationTicket,
} from "../../studio-editor-scope";

import type { StudioProjectDocumentSessionProvenance } from "../../studio-project-document-session";

interface UseStudioMutationAuthorityRuntimeOptions {
  readonly collaborationDocumentLocked: boolean;
  readonly remixId: string | null;
  readonly reportError: (message: string) => void;
  readonly studioAuthUserId: string | null;
  readonly workId: string | null;
}

/**
 * Serializes document mutation authority across async work, saves, auth changes, and unmount.
 * Callers receive opaque tickets and commands rather than duplicating generation comparisons.
 */
export function useStudioMutationAuthorityRuntime({
  collaborationDocumentLocked,
  remixId,
  reportError,
  studioAuthUserId,
  workId,
}: UseStudioMutationAuthorityRuntimeOptions) {
  const collaborationAccessRef = useRef({
    authScopeKey: studioAuthUserId,
    workId,
    locked: collaborationDocumentLocked,
    accessGeneration: 0,
    documentGeneration: 0,
  });
  const previousAccess = collaborationAccessRef.current;
  if (
    previousAccess.authScopeKey !== studioAuthUserId
    || previousAccess.workId !== workId
    || previousAccess.locked !== collaborationDocumentLocked
  ) {
    collaborationAccessRef.current = {
      authScopeKey: studioAuthUserId,
      workId,
      locked: collaborationDocumentLocked,
      accessGeneration: previousAccess.accessGeneration + 1,
      documentGeneration: previousAccess.documentGeneration,
    };
  }

  const currentStudioDocumentScopeRef = useRef({ authScopeKey: studioAuthUserId, workId });
  currentStudioDocumentScopeRef.current = { authScopeKey: studioAuthUserId, workId };
  const editorMountedRef = useRef(true);
  const documentSaveInFlightRef = useRef(false);
  const studioRevisionProjectGenerationRef = useRef(0);
  const studioProjectDocumentSessionRef =
    useRef<StudioProjectDocumentSessionProvenance | null>(null);
  const studioProjectDocumentSessionScopeKey = JSON.stringify([
    studioAuthUserId,
    workId,
    remixId,
  ]);
  const studioProjectDocumentSessionScopeRef = useRef(studioProjectDocumentSessionScopeKey);
  const sharedDocumentSaveAbortRef = useRef<AbortController | null>(null);
  const sharedDocumentRestoreAbortRef = useRef<AbortController | null>(null);
  const ownerDetailAbortRef = useRef<AbortController | null>(null);
  const documentRevalidateAbortRef = useRef<AbortController | null>(null);
  const serverRevisionAbortRef = useRef<AbortController | null>(null);
  const previousMutationScopeRef = useRef(JSON.stringify([studioAuthUserId, workId]));

  const captureStudioMutationTicket = useCallback((): StudioEditorMutationTicket => {
    const current = collaborationAccessRef.current;
    return {
      authScopeKey: current.authScopeKey,
      workId: current.workId,
      accessGeneration: current.accessGeneration,
      documentGeneration: current.documentGeneration,
    };
  }, []);

  const canApplyStudioMutation = useCallback((
    ticket: StudioEditorMutationTicket,
    options: { allowDuringSave?: boolean } = {},
  ): boolean => {
    const current = collaborationAccessRef.current;
    const allowed =
      (options.allowDuringSave === true || !documentSaveInFlightRef.current)
      && isStudioEditorMutationContinuationAllowed(ticket, {
        ...current,
        mounted: editorMountedRef.current,
        aborted: false,
      });
    if (
      !allowed
      && editorMountedRef.current
      && !current.locked
      && ticket.authScopeKey === current.authScopeKey
      && ticket.workId === current.workId
      && ticket.accessGeneration === current.accessGeneration
      && ticket.documentGeneration !== current.documentGeneration
    ) {
      reportError(
        "작업 중 원고가 변경되어 오래된 비동기 결과를 적용하지 않았어요. 다시 실행해 주세요.",
      );
    }
    return allowed;
  }, [reportError]);

  const lockStudioMutationsNow = useCallback((): void => {
    const current = collaborationAccessRef.current;
    if (current.locked) return;
    collaborationAccessRef.current = {
      ...current,
      locked: true,
      accessGeneration: current.accessGeneration + 1,
    };
  }, []);

  const advanceStudioRevisionProjectGeneration = useCallback((): void => {
    studioRevisionProjectGenerationRef.current += 1;
  }, []);

  const tryMarkStudioDocumentChangedQuietly = useCallback((): boolean => {
    if (documentSaveInFlightRef.current) return false;
    advanceStudioRevisionProjectGeneration();
    const current = collaborationAccessRef.current;
    collaborationAccessRef.current = {
      ...current,
      documentGeneration: current.documentGeneration + 1,
    };
    return true;
  }, [advanceStudioRevisionProjectGeneration]);

  const markStudioDocumentChanged = useCallback((): boolean => {
    if (!tryMarkStudioDocumentChangedQuietly()) {
      if (editorMountedRef.current) {
        reportError("저장 중에는 원고를 변경할 수 없어요. 저장이 끝난 뒤 다시 시도해 주세요.");
      }
      return false;
    }
    return true;
  }, [reportError, tryMarkStudioDocumentChangedQuietly]);

  useLayoutEffect(() => {
    editorMountedRef.current = true;
    return () => {
      editorMountedRef.current = false;
      documentSaveInFlightRef.current = false;
      const current = collaborationAccessRef.current;
      if (!current.locked) {
        collaborationAccessRef.current = {
          ...current,
          locked: true,
          accessGeneration: current.accessGeneration + 1,
        };
      }
      sharedDocumentSaveAbortRef.current?.abort();
      sharedDocumentSaveAbortRef.current = null;
      sharedDocumentRestoreAbortRef.current?.abort();
      sharedDocumentRestoreAbortRef.current = null;
      ownerDetailAbortRef.current?.abort();
      ownerDetailAbortRef.current = null;
      documentRevalidateAbortRef.current?.abort();
      documentRevalidateAbortRef.current = null;
      serverRevisionAbortRef.current?.abort();
      serverRevisionAbortRef.current = null;
    };
  }, []);

  return {
    advanceStudioRevisionProjectGeneration,
    canApplyStudioMutation,
    captureStudioMutationTicket,
    collaborationAccessRef,
    currentStudioDocumentScopeRef,
    documentRevalidateAbortRef,
    documentSaveInFlightRef,
    editorMountedRef,
    lockStudioMutationsNow,
    markStudioDocumentChanged,
    ownerDetailAbortRef,
    previousMutationScopeRef,
    serverRevisionAbortRef,
    sharedDocumentRestoreAbortRef,
    sharedDocumentSaveAbortRef,
    studioProjectDocumentSessionRef,
    studioProjectDocumentSessionScopeKey,
    studioProjectDocumentSessionScopeRef,
    studioRevisionProjectGenerationRef,
    tryMarkStudioDocumentChangedQuietly,
  } as const;
}
