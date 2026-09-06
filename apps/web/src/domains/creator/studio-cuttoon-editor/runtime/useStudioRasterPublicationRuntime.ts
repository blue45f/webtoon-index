import { useLayoutEffect, useRef } from "react";

import { disposeStudioDynamicCoverageCommittedCache } from "../../studio-dynamic-brush-coverage-renderer";

/**
 * Serializes raster publications and owns their cancellation boundary.
 * The actor-local tail preserves Lamport ordering while unmount cleanup prevents cross-document
 * uploads or retained GPU coverage caches.
 */
export function useStudioRasterPublicationRuntime() {
  const studioRasterPublicationTailRef = useRef<Promise<void>>(Promise.resolve());
  const studioRasterPublicationControllersRef = useRef(new Set<AbortController>());
  const studioFilterMaskPublicationClockRef = useRef(0);
  const studioFilterMaskPublicationGenerationRef = useRef(new Map<string, number>());

  useLayoutEffect(() => () => {
    studioFilterMaskPublicationClockRef.current += 1;
    studioFilterMaskPublicationGenerationRef.current.clear();
    for (const controller of studioRasterPublicationControllersRef.current) {
      controller.abort(new DOMException("래스터 편집 세션이 종료되었습니다.", "AbortError"));
    }
    studioRasterPublicationControllersRef.current.clear();
    disposeStudioDynamicCoverageCommittedCache();
  }, []);

  return {
    studioFilterMaskPublicationClockRef,
    studioFilterMaskPublicationGenerationRef,
    studioRasterPublicationControllersRef,
    studioRasterPublicationTailRef,
  } as const;
}
