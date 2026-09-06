import { Loader2 } from "lucide-react";
import {
  cloneElement,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";

import {
  releaseStudioBg3dRetainedOwnerLease,
  reportStudioBg3dRetainedOwnerCleanup,
  type StudioBg3dRetainedElement,
  studioBg3dRetainedOwnerSource,
} from "./studio-bg3d-retained-owner";

export const BG3D_RETAINED_OWNER_STALE_RELEASE_MS = 250;

function Bg3DRetainedLoadingOverlay() {
  return (
    <div aria-live="polite" className="fixed inset-0 z-50 grid place-items-center bg-[oklch(0.08_0.01_70/0.72)] p-4 text-fg backdrop-blur-sm">
      <div className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-4 py-3 text-sm font-semibold shadow-xl">
        <Loader2 className="animate-spin text-accent" size={16} aria-hidden />
        <span>3D 배경 도구를 여는 중</span>
      </div>
    </div>
  );
}

interface HostedBg3dRetainedElementProps {
  readonly element: StudioBg3dRetainedElement;
  readonly generation: number;
  readonly logicalOpen: boolean;
  readonly onHostMounted: (generation: number) => void;
  readonly onHostUnmounted: (generation: number) => void;
  readonly onWebXrCleanupPendingChange: (generation: number, pending: boolean) => void;
}

function HostedBg3dRetainedElement({
  element,
  generation,
  logicalOpen,
  onHostMounted,
  onHostUnmounted,
  onWebXrCleanupPendingChange,
}: HostedBg3dRetainedElementProps) {
  useLayoutEffect(() => {
    onHostMounted(generation);
    return () => {
      onHostUnmounted(generation);
    };
  }, [generation, onHostMounted, onHostUnmounted]);

  return cloneElement(element, {
    open: logicalOpen,
    onWebXrCleanupPendingChange: (pending: boolean) => {
      onWebXrCleanupPendingChange(generation, pending);
    },
  });
}

/**
 * Lives in AppShell's chrome layer, outside RouteStage. This is the sole render site for the BG3D
 * editor, so a route teardown can retain the same R3F Canvas without constructing a second
 * renderer. Normal route changes still show nothing; only an in-flight cleanup lease remains.
 */
export function StudioBg3dRetainedOwnerHost() {
  const hostMountedGenerationRef = useRef(0);
  const staleReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStaleReleaseTimer = useCallback(() => {
    if (staleReleaseTimerRef.current === null) return;
    clearTimeout(staleReleaseTimerRef.current);
    staleReleaseTimerRef.current = null;
  }, []);

  const markHostMounted = useCallback(
    (generation: number) => {
      hostMountedGenerationRef.current = generation;
      clearStaleReleaseTimer();
    },
    [clearStaleReleaseTimer],
  );

  const markHostUnmounted = useCallback((generation: number) => {
    if (hostMountedGenerationRef.current === generation) {
      hostMountedGenerationRef.current = 0;
    }
  }, []);

  const lease = useSyncExternalStore(
    studioBg3dRetainedOwnerSource.subscribe,
    studioBg3dRetainedOwnerSource.getSnapshot,
    studioBg3dRetainedOwnerSource.getSnapshot,
  );

  useEffect(() => {
    clearStaleReleaseTimer();
    if (
      lease.element === null
      || lease.routeAttached
      || !lease.cleanupPending
      || lease.logicalOpen
      || hostMountedGenerationRef.current === lease.generation
    ) {
      return;
    }

    staleReleaseTimerRef.current = setTimeout(() => {
      const latestLease = studioBg3dRetainedOwnerSource.getSnapshot();
      if (
        latestLease.generation !== lease.generation
        || latestLease.routeAttached
        || latestLease.element === null
        || !latestLease.cleanupPending
        || hostMountedGenerationRef.current === latestLease.generation
      ) {
        return;
      }
      releaseStudioBg3dRetainedOwnerLease(latestLease.generation);
    }, BG3D_RETAINED_OWNER_STALE_RELEASE_MS);

    return clearStaleReleaseTimer;
  }, [lease, clearStaleReleaseTimer]);

  if (!lease.element) return null;
  return (
    <Suspense fallback={lease.logicalOpen ? <Bg3DRetainedLoadingOverlay /> : null}>
      <HostedBg3dRetainedElement
        element={lease.element}
        generation={lease.generation}
        logicalOpen={lease.logicalOpen}
        onHostMounted={markHostMounted}
        onHostUnmounted={markHostUnmounted}
        onWebXrCleanupPendingChange={(generation, pending) => {
          reportStudioBg3dRetainedOwnerCleanup(generation, pending);
        }}
      />
    </Suspense>
  );
}
