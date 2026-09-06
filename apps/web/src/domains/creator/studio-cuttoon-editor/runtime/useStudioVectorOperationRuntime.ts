import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { StudioQualityWorkerClient } from "../../studio-quality-worker-client";

interface StudioPaperVectorRefinementClient {
  advanceEngineEpoch(): number;
  dispose(): void;
}

interface UseStudioVectorOperationRuntimeOptions {
  readonly activePageId: string;
  readonly announceRef: RefObject<(message: string) => void>;
  readonly masterEditMode: boolean;
  readonly pagesHistoryIndex: number;
}

/**
 * Owns the cancellation epochs and worker resources for asynchronous vector operations.
 *
 * Page, history-frontier, or master-surface changes invalidate every outstanding result before it
 * can acquire document authority. The host only receives stable operation handles and busy state.
 */
export function useStudioVectorOperationRuntime({
  activePageId,
  announceRef,
  masterEditMode,
  pagesHistoryIndex,
}: UseStudioVectorOperationRuntimeOptions) {
  const [pathBooleanBusy, setPathBooleanBusy] = useState(false);
  const pathBooleanRunIdRef = useRef(0);
  const pathBooleanActiveRef = useRef(false);
  const pathBooleanAbortRef = useRef<AbortController | null>(null);
  const pathBooleanClientRef = useRef<StudioQualityWorkerClient | null>(null);

  const [paperVectorRefinementBusy, setPaperVectorRefinementBusy] = useState(false);
  const paperVectorRefinementRunIdRef = useRef(0);
  const paperVectorRefinementActiveRef = useRef(false);
  const paperVectorRefinementAbortRef = useRef<AbortController | null>(null);
  const paperVectorRefinementRequestSequenceRef = useRef(0);
  const paperVectorRefinementEngineEpochRef = useRef(1);
  const paperVectorRefinementClientRef = useRef<StudioPaperVectorRefinementClient | null>(null);

  const invalidatePaperVectorRefinement = useCallback((announce: boolean): void => {
    const wasActive = paperVectorRefinementActiveRef.current;
    paperVectorRefinementRunIdRef.current += 1;
    paperVectorRefinementActiveRef.current = false;
    paperVectorRefinementAbortRef.current?.abort();
    paperVectorRefinementAbortRef.current = null;
    const client = paperVectorRefinementClientRef.current;
    paperVectorRefinementEngineEpochRef.current = client
      ? client.advanceEngineEpoch()
      : paperVectorRefinementEngineEpochRef.current + 1;
    setPaperVectorRefinementBusy(false);
    if (announce && wasActive) announceRef.current("경로 정리를 취소했어요.");
  }, [announceRef]);

  const cancelPaperVectorRefinement = useCallback((): void => {
    invalidatePaperVectorRefinement(true);
  }, [invalidatePaperVectorRefinement]);

  useEffect(() => {
    if (pathBooleanActiveRef.current) {
      pathBooleanRunIdRef.current += 1;
      pathBooleanActiveRef.current = false;
      pathBooleanAbortRef.current?.abort();
      pathBooleanAbortRef.current = null;
      setPathBooleanBusy(false);
    }
    if (paperVectorRefinementActiveRef.current) {
      invalidatePaperVectorRefinement(false);
    }
    // A history-array identity change is not itself an authority change. Autosave,
    // reconciliation, and collaboration admission may replace that outer array while the active
    // page/index/source objects remain authoritative. The frontier index is the cancellation key.
  }, [activePageId, invalidatePaperVectorRefinement, masterEditMode, pagesHistoryIndex]);

  useEffect(() => () => {
    pathBooleanRunIdRef.current += 1;
    pathBooleanActiveRef.current = false;
    pathBooleanAbortRef.current?.abort();
    pathBooleanAbortRef.current = null;
    pathBooleanClientRef.current?.dispose();
    pathBooleanClientRef.current = null;
    paperVectorRefinementRunIdRef.current += 1;
    paperVectorRefinementActiveRef.current = false;
    paperVectorRefinementAbortRef.current?.abort();
    paperVectorRefinementAbortRef.current = null;
    paperVectorRefinementClientRef.current?.dispose();
    paperVectorRefinementClientRef.current = null;
  }, []);

  return {
    cancelPaperVectorRefinement,
    paperVectorRefinementAbortRef,
    paperVectorRefinementActiveRef,
    paperVectorRefinementBusy,
    paperVectorRefinementClientRef,
    paperVectorRefinementEngineEpochRef,
    paperVectorRefinementRequestSequenceRef,
    paperVectorRefinementRunIdRef,
    pathBooleanAbortRef,
    pathBooleanActiveRef,
    pathBooleanBusy,
    pathBooleanClientRef,
    pathBooleanRunIdRef,
    setPaperVectorRefinementBusy,
    setPathBooleanBusy,
  } as const;
}
