import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import {
  resolveStudioLiveSessionWorkId,
  shouldExpectStudioSharedDocument,
  shouldRequireStudioLiveServer,
} from "../../live/studio-live-jam-session";
import {
  isStudioEditorCollaborationLocked,
  isStudioSourceHydrationPending,
} from "../../studio-editor-scope";
import { StudioWorkAssetHydrator } from "../../studio-work-asset-hydrator";
import {
  resolveStudioWorkAssetHydrationScope,
  type StudioWorkAssetSceneReference,
} from "../../studio-work-asset-render-projection";

import type { StudioCrdtDocument } from "../../live/studio-crdt-document";
import type { StudioCrdtSceneGraphRuntime } from "../../live/StudioLiveCollaborationProvider";
import type { StudioDraftCollaborationReadiness } from "../../studio-draft-collaboration";
import type { StudioSharedDocument } from "../../studio-shared-document-client";


interface UseStudioCollaborationAccessRuntimeOptions {
  readonly draftCollaboration: StudioDraftCollaborationReadiness | null;
  readonly instantWorkId: string;
  readonly liveRoomQueryParam: string | null;
  readonly remixId: string | null;
  readonly sessionDisplayName: string | null;
  readonly setStudioWorkAssetLimitExceeded: Dispatch<SetStateAction<boolean>>;
  readonly setStudioWorkAssetReferences: Dispatch<SetStateAction<StudioWorkAssetSceneReference[]>>;
  readonly studioAuthUserId: string | null;
  readonly studioCrdtDocument: StudioCrdtDocument | null;
  readonly studioCrdtDocumentRef: RefObject<StudioCrdtDocument | null>;
  readonly studioCrdtReconciledDocument: StudioCrdtDocument | null;
  readonly studioCrdtSceneRuntimeRef: RefObject<StudioCrdtSceneGraphRuntime | null>;
  readonly studioWorkAssetHydrator: StudioWorkAssetHydrator;
  readonly workId: string | null;
}

/**
 * Projects server access, hydration, CRDT readiness, and live-session policy into one lock model.
 * Rendering and mutation execution consume this projection instead of re-deriving access rules.
 */
export function useStudioCollaborationAccessRuntime({
  draftCollaboration,
  instantWorkId,
  liveRoomQueryParam,
  remixId,
  sessionDisplayName,
  setStudioWorkAssetLimitExceeded,
  setStudioWorkAssetReferences,
  studioAuthUserId,
  studioCrdtDocument,
  studioCrdtDocumentRef,
  studioCrdtReconciledDocument,
  studioCrdtSceneRuntimeRef,
  studioWorkAssetHydrator,
  workId,
}: UseStudioCollaborationAccessRuntimeOptions) {
  const workAuthScopeKey = workId ? studioAuthUserId : null;
  const expectsSharedDocument = shouldExpectStudioSharedDocument({
    workAuthScopeKey,
    workId,
    remixId,
  });
  const [workHydrated, setWorkHydrated] = useState(!(workId || remixId));
  const [workHydrationFailed, setWorkHydrationFailed] = useState(false);
  const [workHydrationUnsupportedFormat, setWorkHydrationUnsupportedFormat] = useState(false);
  const [documentReloadRequired, setDocumentReloadRequired] = useState(false);
  const [studioLiveEditsDurablyProtected, setStudioLiveEditsDurablyProtected] = useState(false);
  const [sharedDocumentScope, setSharedDocumentScope] = useState<{
    authScopeKey: string;
    workId: string;
    value: StudioSharedDocument;
  } | null>(null);

  const sharedDocument =
    studioAuthUserId
    && workId
    && sharedDocumentScope?.authScopeKey === studioAuthUserId
    && sharedDocumentScope.workId === workId
      ? sharedDocumentScope.value
      : null;
  const sharedDocumentRef = useRef(sharedDocument);
  sharedDocumentRef.current = sharedDocument;

  const draftCollaborationWorkId = draftCollaboration?.status === "ready"
    ? draftCollaboration.room.provisionalWorkId
    : draftCollaboration?.identity.draftDocumentId;
  const effectiveWorkId = resolveStudioLiveSessionWorkId({
    workId,
    roomId: liveRoomQueryParam,
    draftWorkId: draftCollaborationWorkId,
    instantWorkId,
  });
  const studioLiveParticipant = useMemo(() => {
    if (sharedDocument?.status === "active" && sharedDocument.capabilities.view) {
      return {
        displayName: sessionDisplayName ?? "내 작업",
        role: sharedDocument.role,
      };
    }
    if (liveRoomQueryParam || expectsSharedDocument || !workId) {
      return {
        displayName: sessionDisplayName ?? (studioAuthUserId ? "게스트 작가" : "익명 게스트"),
        role: "editor" as const,
      };
    }
    return null;
  }, [
    expectsSharedDocument,
    liveRoomQueryParam,
    sessionDisplayName,
    sharedDocument,
    studioAuthUserId,
    workId,
  ]);

  const authorizedWorkAssetScopeId = resolveStudioWorkAssetHydrationScope({
    workId,
    authUserId: studioAuthUserId,
    remixId,
    documentStatus: expectsSharedDocument ? sharedDocument?.status : null,
    canView: Boolean(sharedDocument?.capabilities.view),
  });
  useLayoutEffect(() => {
    studioWorkAssetHydrator.setWorkId(authorizedWorkAssetScopeId);
    if (authorizedWorkAssetScopeId) return;
    studioWorkAssetHydrator.observe([]);
    setStudioWorkAssetReferences((current) => current.length === 0 ? current : []);
    setStudioWorkAssetLimitExceeded(false);
  }, [
    authorizedWorkAssetScopeId,
    setStudioWorkAssetLimitExceeded,
    setStudioWorkAssetReferences,
    studioWorkAssetHydrator,
  ]);

  const collaborationDocumentUnavailable =
    expectsSharedDocument
    && !sharedDocument
    && draftCollaboration?.status !== "provisioning";
  const collaborationReadOnly = Boolean(sharedDocument && sharedDocument.access !== "edit");
  const sourceHydrationPending = isStudioSourceHydrationPending(workId, remixId, workHydrated);
  const studioCrdtDocumentReady = Boolean(
    studioCrdtDocument
    && studioCrdtDocumentRef.current === studioCrdtDocument
    && studioCrdtSceneRuntimeRef.current
    && studioCrdtReconciledDocument === studioCrdtDocument,
  );
  const studioLiveJam = Boolean(liveRoomQueryParam || !workId);
  const requiresStudioLiveServer = shouldRequireStudioLiveServer({
    expectsSharedDocument,
    draftCollaborationReady: draftCollaboration?.status === "ready",
    liveJam: studioLiveJam,
  });
  const isRealtimeTeamSession = requiresStudioLiveServer;
  const collaborationOperationSyncRequired = Boolean(
    expectsSharedDocument
    && isRealtimeTeamSession
    && studioLiveParticipant
    && !collaborationReadOnly,
  );
  const studioCrdtOperationSyncReady = studioCrdtDocumentReady && (
    !collaborationOperationSyncRequired || studioLiveEditsDurablyProtected
  );
  const collaborationOperationSyncPending =
    collaborationOperationSyncRequired && !studioCrdtOperationSyncReady;
  const collaborationDocumentLocked = expectsSharedDocument && isStudioEditorCollaborationLocked({
    documentAccessLocked:
      documentReloadRequired
      || sourceHydrationPending
      || collaborationDocumentUnavailable
      || collaborationReadOnly,
    operationSyncRequired: collaborationOperationSyncRequired,
    operationSyncReady: studioCrdtOperationSyncReady,
  });

  return {
    authorizedWorkAssetScopeId,
    collaborationDocumentLocked,
    collaborationDocumentUnavailable,
    collaborationOperationSyncPending,
    collaborationOperationSyncRequired,
    collaborationReadOnly,
    documentReloadRequired,
    effectiveWorkId,
    expectsSharedDocument,
    isRealtimeTeamSession,
    requiresStudioLiveServer,
    setDocumentReloadRequired,
    setSharedDocumentScope,
    setStudioLiveEditsDurablyProtected,
    setWorkHydrated,
    setWorkHydrationFailed,
    setWorkHydrationUnsupportedFormat,
    sharedDocument,
    sharedDocumentRef,
    sourceHydrationPending,
    studioCrdtDocumentReady,
    studioCrdtOperationSyncReady,
    studioLiveEditsDurablyProtected,
    studioLiveJam,
    studioLiveParticipant,
    workAuthScopeKey,
    workHydrated,
    workHydrationFailed,
    workHydrationUnsupportedFormat,
  } as const;
}
