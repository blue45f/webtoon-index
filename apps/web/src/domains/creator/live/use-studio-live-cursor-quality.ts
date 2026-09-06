import { useCallback, useSyncExternalStore } from "react";

import {
  getStudioLiveCursorQualitySnapshot,
  subscribeStudioLiveCursorQuality,
  type StudioLiveCursorQualitySnapshot,
} from "./studio-live-cursor-quality";

export function useStudioLiveCursorQuality(
  workId: string | null,
): StudioLiveCursorQualitySnapshot | null {
  const subscribe = useCallback(
    (listener: () => void) => subscribeStudioLiveCursorQuality(workId, listener),
    [workId],
  );
  const getSnapshot = useCallback(
    () => getStudioLiveCursorQualitySnapshot(workId),
    [workId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
