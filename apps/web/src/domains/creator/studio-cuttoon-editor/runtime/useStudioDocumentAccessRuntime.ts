import { useState, type Dispatch, type RefObject, type SetStateAction } from "react";

import {
  createEmptyStudioAiImageReferenceDocument,
  type StudioAiImageReferenceDocument,
} from "../../ai/studio-ai-image-reference-roles";
import { studioAutosaveKey } from "../../studio-autosave";
import { studioCheckpointKey } from "../../studio-checkpoint-loader";
import { StudioWorkAssetHydrator } from "../../studio-work-asset-hydrator";

import { useStudioCollaborationAccessRuntime } from "./useStudioCollaborationAccessRuntime";
import { useStudioDraftCollaborationRuntime } from "./useStudioDraftCollaborationRuntime";
import { useStudioLayerLiftRuntime } from "./useStudioLayerLiftRuntime";
import { useStudioMutationAuthorityRuntime } from "./useStudioMutationAuthorityRuntime";

import type { StudioCrdtDocument } from "../../live/studio-crdt-document";
import type { StudioCrdtSceneGraphRuntime } from "../../live/StudioLiveCollaborationProvider";
import type { StudioWorkAssetSceneReference } from "../../studio-work-asset-render-projection";

interface UseStudioDocumentAccessRuntimeOptions {
  readonly announce: (message: string) => void;
  readonly getProjectSnapshot: () => unknown;
  readonly instantWorkId: string;
  readonly liveRoomQueryParam: string | null;
  readonly remixId: string | null;
  readonly reportError: (message: string) => void;
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
 * Composes document-scoped application services for the editor host.
 *
 * Each child hook owns one reason to change: draft-room provisioning, access projection, mutation
 * authority, or layer-lift resources. This seam keeps the host's public bindings stable while the
 * implementations remain independently testable and replaceable.
 */
export function useStudioDocumentAccessRuntime({
  announce,
  getProjectSnapshot,
  instantWorkId,
  liveRoomQueryParam,
  remixId,
  reportError,
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
}: UseStudioDocumentAccessRuntimeOptions) {
  const autosaveKey = studioAutosaveKey({ userId: studioAuthUserId, workId, remixId });
  const checkpointKey = studioCheckpointKey({ userId: studioAuthUserId, workId, remixId });
  const [scenarioImageReferenceDocument, setScenarioImageReferenceDocument] =
    useState<StudioAiImageReferenceDocument>(createEmptyStudioAiImageReferenceDocument);

  const draftRuntime = useStudioDraftCollaborationRuntime({
    announce,
    autosaveKey,
    getProjectSnapshot,
    liveRoomQueryParam,
    reportError,
    studioAuthUserId,
    workId,
  });
  const collaborationRuntime = useStudioCollaborationAccessRuntime({
    draftCollaboration: draftRuntime.draftCollaboration,
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
  });
  const mutationRuntime = useStudioMutationAuthorityRuntime({
    collaborationDocumentLocked: collaborationRuntime.collaborationDocumentLocked,
    remixId,
    reportError,
    studioAuthUserId,
    workId,
  });
  const layerLiftRuntime = useStudioLayerLiftRuntime();

  return {
    ...collaborationRuntime,
    ...draftRuntime,
    ...layerLiftRuntime,
    ...mutationRuntime,
    autosaveKey,
    checkpointKey,
    loggedIn: Boolean(studioAuthUserId),
    scenarioImageReferenceDocument,
    setScenarioImageReferenceDocument,
  } as const;
}
