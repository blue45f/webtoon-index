import { useEffect, useRef, useState } from "react";

import {
  createStudioProDrawPreferenceRuntime,
  type StudioProDrawPreferenceRuntime,
  type StudioProDrawPreferenceRuntimeOptions,
  type StudioProDrawRuntimeMutationResult,
} from "./studio-pro-draw-preferences-sqlite";
import {
  toggleFavoriteBrushId,
  type StudioProDrawPrefs,
} from "./studio-pro-draw-prefs";

export type StudioProDrawPrefsMutation = (
  latest: StudioProDrawPrefs,
) => StudioProDrawPrefs;

export type UseStudioProDrawPrefsDependencies = StudioProDrawPreferenceRuntimeOptions;

/**
 * Owns Pro Draw preferences over the shared Studio SQLite/OPFS authority.
 *
 * The synchronous return from `commitProDrawPrefsMutation` keeps pen/UI interactions immediate,
 * while its `persistence` Promise reports the real durable outcome. The hook never reads the
 * pre-V12 localStorage key. Revision conflicts are replayed over the newest SQLite snapshot by
 * the runtime and BroadcastChannel only acts as a cross-tab invalidation signal.
 */
export function useStudioProDrawPrefs(
  dependencies: UseStudioProDrawPrefsDependencies = {},
) {
  const runtimeRef = useRef<StudioProDrawPreferenceRuntime | null>(null);
  if (runtimeRef.current === null) {
    runtimeRef.current = createStudioProDrawPreferenceRuntime(dependencies);
  }
  const runtime = runtimeRef.current;
  const mountedRef = useRef(false);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState(runtime.getSnapshot());

  useEffect(() => {
    mountedRef.current = true;
    runtime.activate();
    const unsubscribe = runtime.subscribe(() => {
      setRuntimeSnapshot(runtime.getSnapshot());
    });
    setRuntimeSnapshot(runtime.getSnapshot());
    void runtime.hydrate();
    return () => {
      mountedRef.current = false;
      unsubscribe();
      runtime.deactivate();
    };
  }, [runtime]);

  function commitProDrawPrefsMutation(
    mutate: StudioProDrawPrefsMutation,
  ): StudioProDrawRuntimeMutationResult {
    return runtime.mutate(mutate);
  }

  function toggleProDrawFavorite(
    brushId: string,
    announce: (message: string) => void,
  ): void {
    const result = commitProDrawPrefsMutation(
      (latest) => toggleFavoriteBrushId(latest, brushId),
    );
    const favorite = result.prefs.favoriteBrushIds.includes(brushId);
    void result.persistence.then((persisted) => {
      if (!mountedRef.current) return;
      if (persisted) {
        announce(favorite ? "즐겨찾기 추가" : "즐겨찾기 해제");
        return;
      }
      announce(
        favorite
          ? "즐겨찾기는 현재 탭에 추가했지만 SQLite/OPFS에는 기록하지 못했어요."
          : "즐겨찾기는 현재 탭에서 해제했지만 SQLite/OPFS에는 기록하지 못했어요.",
      );
    });
  }

  return {
    proDrawPrefs: runtimeSnapshot.prefs,
    proDrawPrefsPersistenceState: runtimeSnapshot.state,
    proDrawPrefsDurable: runtimeSnapshot.durable,
    proDrawPrefsPersistenceMessage: runtimeSnapshot.message,
    commitProDrawPrefsMutation,
    toggleProDrawFavorite,
    retryProDrawPrefsPersistence: () => runtime.retry(),
  };
}
