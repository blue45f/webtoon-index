import { useEffect, useRef } from "react";

import { StudioLayerLiftComposeWorkerClient } from "../../layer/studio-layer-lift-compose-worker-client";
import { createStudioLayerLiftLocalForegroundProvider } from "../../layer/studio-layer-lift-local-provider";
import { loadStudioLayerLiftMediaPipeInference } from "../../layer/studio-layer-lift-mediapipe-inference";
import { StudioLayerLiftOperationRegistry } from "../../layer/studio-layer-lift-operation-context";

import type { StudioLayerLiftReviewPreviewResource } from "../../layer/studio-layer-lift-review-preview";

/** Owns document-scoped foreground inference and composition resources. */
export function useStudioLayerLiftRuntime() {
  const studioLayerLiftRegistryRef = useRef<StudioLayerLiftOperationRegistry | null>(null);
  studioLayerLiftRegistryRef.current ??= new StudioLayerLiftOperationRegistry();

  const studioLayerLiftProviderRef = useRef<ReturnType<
    typeof createStudioLayerLiftLocalForegroundProvider
  > | null>(null);
  studioLayerLiftProviderRef.current ??= createStudioLayerLiftLocalForegroundProvider({
    loadInference: loadStudioLayerLiftMediaPipeInference,
  });

  const studioLayerLiftCompositorRef = useRef<StudioLayerLiftComposeWorkerClient | null>(null);
  studioLayerLiftCompositorRef.current ??= new StudioLayerLiftComposeWorkerClient();

  const studioLayerLiftAbortRef = useRef<AbortController | null>(null);
  const studioLayerLiftRunIdRef = useRef(0);
  const studioLayerLiftPreviewResourceRef = useRef<StudioLayerLiftReviewPreviewResource | null>(null);

  useEffect(() => {
    return () => {
      studioLayerLiftRunIdRef.current += 1;
      studioLayerLiftAbortRef.current?.abort();
      studioLayerLiftAbortRef.current = null;
      studioLayerLiftRegistryRef.current?.invalidate();
      studioLayerLiftRegistryRef.current = null;
      studioLayerLiftCompositorRef.current?.dispose();
      studioLayerLiftCompositorRef.current = null;
      studioLayerLiftProviderRef.current = null;
      studioLayerLiftPreviewResourceRef.current?.revoke();
      studioLayerLiftPreviewResourceRef.current = null;
    };
  }, []);

  return {
    studioLayerLiftAbortRef,
    studioLayerLiftCompositorRef,
    studioLayerLiftPreviewResourceRef,
    studioLayerLiftProviderRef,
    studioLayerLiftRegistryRef,
    studioLayerLiftRunIdRef,
  } as const;
}
