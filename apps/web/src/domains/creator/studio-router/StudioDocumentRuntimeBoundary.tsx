import {
  useEffect,
  useId,
  type ReactNode,
} from "react";

import {
  StudioDocumentRuntimeContext,
  type StudioDocumentRuntimeLifecycle,
} from "./studio-document-runtime-context";

export interface StudioDocumentRuntimeObserver {
  readonly mounted?: (lifecycle: StudioDocumentRuntimeLifecycle) => void;
  readonly unmounted?: (lifecycle: StudioDocumentRuntimeLifecycle) => void;
}

interface StudioDocumentRuntimeBoundaryProps {
  readonly children: ReactNode;
  readonly documentKey: string;
  /** Test/telemetry seam. The observer must not own document state. */
  readonly observer?: StudioDocumentRuntimeObserver;
}

function StudioDocumentRuntimeOwner({
  children,
  documentKey,
  observer,
}: StudioDocumentRuntimeBoundaryProps) {
  const instanceId = useId();
  const lifecycle = { documentKey, instanceId };

  useEffect(() => {
    const mountedLifecycle = { documentKey, instanceId };
    observer?.mounted?.(mountedLifecycle);
    return () => observer?.unmounted?.(mountedLifecycle);
  }, [documentKey, instanceId, observer]);

  return (
    <StudioDocumentRuntimeContext value={lifecycle}>
      {children}
    </StudioDocumentRuntimeContext>
  );
}

/**
 * A document identity boundary, deliberately independent from the visible Studio surface. Changing
 * canvas/comic/animation/DCC paths preserves children; changing this key tears down every document
 * owner below it before the next identity mounts.
 */
export function StudioDocumentRuntimeBoundary(
  props: StudioDocumentRuntimeBoundaryProps,
) {
  return <StudioDocumentRuntimeOwner key={props.documentKey} {...props} />;
}
