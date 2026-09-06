import { useEffect, useRef, useState } from "react";

import {
  createEmptyStudioCommentsDocument,
  type StudioCommentsDocument,
} from "../../studio-comments";
import { StudioTeamCommentOperationScopeRegistry } from "../../studio-team-comment-operation-scope";

import type { StudioCommentPinReanchorPayload } from "../../live/StudioLiveCanvasOverlay";
import type { StudioTeamCommentCapabilities } from "../../studio-team-comment-client";
import type { StudioTeamCommentRefreshSession } from "../../studio-team-comment-refresh-session";

interface UseStudioCommentDocumentsRuntimeOptions {
  readonly markStudioDocumentChanged: () => boolean;
}

/** Owns local/team comment documents and all in-flight collaboration registries. */
export function useStudioCommentDocumentsRuntime({
  markStudioDocumentChanged,
}: UseStudioCommentDocumentsRuntimeOptions) {
  const [studioComments, setStudioCommentsState] = useState<StudioCommentsDocument>(
    createEmptyStudioCommentsDocument,
  );
  const [studioTeamComments, setStudioTeamCommentsState] = useState<StudioCommentsDocument>(
    createEmptyStudioCommentsDocument,
  );
  const [studioTeamCommentCapabilities, setStudioTeamCommentCapabilities] =
    useState<StudioTeamCommentCapabilities | null>(null);
  const [studioCommentSyncError, setStudioCommentSyncError] = useState<string | null>(null);
  const [studioCommentInteractionNotice, setStudioCommentInteractionNotice] =
    useState<string | null>(null);
  const [studioTeamCommentsSyncing, setStudioTeamCommentsSyncing] = useState(false);
  const [studioTeamUnreadCommentIds, setStudioTeamUnreadCommentIds] = useState<string[]>([]);

  const studioTeamCommentCapabilitiesRef = useRef(studioTeamCommentCapabilities);
  studioTeamCommentCapabilitiesRef.current = studioTeamCommentCapabilities;
  const studioTeamUnreadCommentIdsRef = useRef(studioTeamUnreadCommentIds);
  studioTeamUnreadCommentIdsRef.current = studioTeamUnreadCommentIds;
  const studioTeamCommentsLoadGenerationRef = useRef(0);
  const studioTeamCommentRefreshSessionRef = useRef<StudioTeamCommentRefreshSession | null>(null);
  const studioTeamCommentsScopeRef = useRef<string | null>(null);
  const studioTeamCommentActivitySequenceRef = useRef<Map<string, bigint>>(new Map());
  const studioTeamCommentReadSequenceRef = useRef<Map<string, bigint>>(new Map());
  const studioTeamCommentOperationScopeRegistryRef = useRef(
    new StudioTeamCommentOperationScopeRegistry(),
  );
  const studioTeamCommentMutationFlightRef = useRef(new Map<
    string,
    { signature: string; promise: Promise<boolean> }
  >());
  const studioTeamCommentReadFlightRef = useRef(new Map<string, Promise<boolean>>());
  const studioTeamCommentReanchorFlightRef = useRef(new Map<string, Promise<boolean>>());
  const studioTeamCommentReanchorQueueRef = useRef(
    new Map<string, StudioCommentPinReanchorPayload>(),
  );
  const studioTeamCommentLiveTargetSequenceRef = useRef(new Map<string, bigint>());
  const studioTeamCommentLiveRefreshFlightRef = useRef(new Map<string, Promise<void>>());

  useEffect(() => () => {
    studioTeamCommentOperationScopeRegistryRef.current.abortAll();
    studioTeamCommentMutationFlightRef.current.clear();
    studioTeamCommentReadFlightRef.current.clear();
    studioTeamCommentReanchorFlightRef.current.clear();
    studioTeamCommentReanchorQueueRef.current.clear();
    studioTeamCommentLiveTargetSequenceRef.current.clear();
    studioTeamCommentLiveRefreshFlightRef.current.clear();
  }, []);

  function setStudioComments(
    next: Parameters<typeof setStudioCommentsState>[0],
  ): boolean {
    if (!markStudioDocumentChanged()) return false;
    setStudioCommentsState(next);
    return true;
  }

  return {
    setStudioCommentInteractionNotice,
    setStudioComments,
    setStudioCommentsState,
    setStudioCommentSyncError,
    setStudioTeamCommentCapabilities,
    setStudioTeamCommentsState,
    setStudioTeamCommentsSyncing,
    setStudioTeamUnreadCommentIds,
    studioCommentInteractionNotice,
    studioComments,
    studioCommentSyncError,
    studioTeamCommentActivitySequenceRef,
    studioTeamCommentCapabilities,
    studioTeamCommentCapabilitiesRef,
    studioTeamCommentLiveRefreshFlightRef,
    studioTeamCommentLiveTargetSequenceRef,
    studioTeamCommentMutationFlightRef,
    studioTeamCommentOperationScopeRegistryRef,
    studioTeamCommentReadFlightRef,
    studioTeamCommentReadSequenceRef,
    studioTeamCommentReanchorFlightRef,
    studioTeamCommentReanchorQueueRef,
    studioTeamCommentRefreshSessionRef,
    studioTeamComments,
    studioTeamCommentsLoadGenerationRef,
    studioTeamCommentsScopeRef,
    studioTeamCommentsSyncing,
    studioTeamUnreadCommentIds,
    studioTeamUnreadCommentIdsRef,
  } as const;
}
