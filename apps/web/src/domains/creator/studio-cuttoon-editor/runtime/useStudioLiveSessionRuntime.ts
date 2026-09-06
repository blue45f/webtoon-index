import { useRef, useState } from "react";

import { StudioLiveGesturePreviewRoomAdapter } from "../../live/studio-live-gesture-preview-room-adapter";

import type { StudioLiveRoom } from "../../live/studio-live-collaboration-room";
import type { StudioTeamCommentLiveEvent } from "../../studio-team-comment-live-event";

/**
 * Mutable transport-side state for one mounted Studio live session.
 *
 * React components consume commands and stable refs; high-frequency presence/gesture traffic does
 * not become component state and therefore cannot invalidate the editor tree on every packet.
 */
export function useStudioLiveSessionRuntime() {
  const studioLiveRoomRef = useRef<StudioLiveRoom | null>(null);
  const [studioLiveGesturePreviewAdapter] = useState(
    () => new StudioLiveGesturePreviewRoomAdapter(),
  );
  const studioLiveGesturePreviewLifecycleGenerationRef = useRef({ generation: 0 });
  const cancelStudioLiveGesturePreviewRef = useRef<() => void>(() => undefined);
  const studioLiveCommentEventHandlerRef = useRef<(
    change: StudioTeamCommentLiveEvent,
  ) => void>(() => undefined);
  const studioLiveCommentRoomUnsubscribeRef = useRef<(() => void) | null>(null);
  const studioLiveHeldResourcesRef = useRef<string[]>([]);
  const studioLiveMutationGenerationRef = useRef(0);
  const studioLivePendingMutationRef = useRef<{
    room: StudioLiveRoom;
    key: string;
    promise: Promise<boolean>;
  } | null>(null);

  return {
    cancelStudioLiveGesturePreviewRef,
    studioLiveCommentEventHandlerRef,
    studioLiveCommentRoomUnsubscribeRef,
    studioLiveGesturePreviewAdapter,
    studioLiveGesturePreviewLifecycleGenerationRef,
    studioLiveHeldResourcesRef,
    studioLiveMutationGenerationRef,
    studioLivePendingMutationRef,
    studioLiveRoomRef,
  } as const;
}
