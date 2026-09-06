import { useLayoutEffect, useRef, useSyncExternalStore } from "react";

import {
  detachStudioBg3dRetainedOwnerRoute,
  publishStudioBg3dRetainedOwnerLease,
  studioBg3dRetainedOwnerSource,
  updateStudioBg3dRetainedOwnerLease,
  type StudioBg3dRetainedElement,
} from "./studio-bg3d-retained-owner";

export interface StudioBg3dRetainedOwnerRouteBridgeProps {
  readonly element: StudioBg3dRetainedElement | null;
  readonly open: boolean;
}

/**
 * Route-side publisher. Its cleanup is synchronous: it detaches authority and asks the already
 * published element to close before React removes RouteStage. The element itself remains rendered
 * by AppShell until cleanupPending returns false.
 */
export function StudioBg3dRetainedOwnerRouteBridge({
  element,
  open,
}: StudioBg3dRetainedOwnerRouteBridgeProps) {
  const generationRef = useRef(0);
  const elementRef = useRef(element);
  const openRef = useRef(open);
  elementRef.current = element;
  openRef.current = open;
  const ownerSnapshot = useSyncExternalStore(
    studioBg3dRetainedOwnerSource.subscribe,
    studioBg3dRetainedOwnerSource.getSnapshot,
    studioBg3dRetainedOwnerSource.getSnapshot,
  );

  useLayoutEffect(() => {
    if (generationRef.current !== 0) return;
    const generation = publishStudioBg3dRetainedOwnerLease({
      element: elementRef.current,
      logicalOpen: openRef.current,
    });
    if (generation === null) return;
    generationRef.current = generation;
  }, [ownerSnapshot]);

  useLayoutEffect(() => () => {
    const generation = generationRef.current;
    generationRef.current = 0;
    if (generation !== 0) detachStudioBg3dRetainedOwnerRoute(generation);
  }, []);

  useLayoutEffect(() => {
    updateStudioBg3dRetainedOwnerLease(generationRef.current, {
      element,
      logicalOpen: open,
    });
  }, [element, open]);

  return null;
}
