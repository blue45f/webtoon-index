import { useRef, useState } from "react";

import type { StudioCrdtDocument } from "../../live/studio-crdt-document";
import type {
  StudioCrdtAuthoritativeSaveBarrier,
  StudioCrdtSceneGraphRuntime,
} from "../../live/StudioLiveCollaborationProvider";
import type { PageState } from "../../studio-page-state";

/** Stable CRDT authority and scene-graph handles scoped to one editor document. */
export function useStudioCrdtRuntime() {
  const studioCrdtAuthoritativeSaveBarrierRef =
    useRef<StudioCrdtAuthoritativeSaveBarrier | null>(null);
  const [studioCrdtAuthoritativeBarrierGeneration, setStudioCrdtAuthoritativeBarrierGeneration] =
    useState(0);
  const studioCrdtDocumentRef = useRef<StudioCrdtDocument | null>(null);
  const studioCrdtSceneRuntimeRef = useRef<StudioCrdtSceneGraphRuntime | null>(null);
  const publishStudioCrdtSceneTransitionRef = useRef<(
    previousPages: readonly PageState[],
    nextPages: readonly PageState[],
    registerNewDraws?: boolean,
  ) => boolean>(() => false);
  const [studioCrdtDocument, setStudioCrdtDocument] =
    useState<StudioCrdtDocument | null>(null);
  const [studioCrdtReconciledDocument, setStudioCrdtReconciledDocument] =
    useState<StudioCrdtDocument | null>(null);

  return {
    publishStudioCrdtSceneTransitionRef,
    setStudioCrdtAuthoritativeBarrierGeneration,
    setStudioCrdtDocument,
    setStudioCrdtReconciledDocument,
    studioCrdtAuthoritativeBarrierGeneration,
    studioCrdtAuthoritativeSaveBarrierRef,
    studioCrdtDocument,
    studioCrdtDocumentRef,
    studioCrdtReconciledDocument,
    studioCrdtSceneRuntimeRef,
  } as const;
}
