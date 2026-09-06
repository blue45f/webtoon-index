import { createContext, useContext } from "react";

export interface StudioDocumentRuntimeLifecycle {
  readonly documentKey: string;
  readonly instanceId: string;
}

export const StudioDocumentRuntimeContext =
  createContext<StudioDocumentRuntimeLifecycle | null>(null);

export function useStudioDocumentRuntime(): StudioDocumentRuntimeLifecycle {
  const lifecycle = useContext(StudioDocumentRuntimeContext);
  if (lifecycle === null) {
    throw new Error(
      "useStudioDocumentRuntime must run inside StudioDocumentRuntimeBoundary.",
    );
  }
  return lifecycle;
}
