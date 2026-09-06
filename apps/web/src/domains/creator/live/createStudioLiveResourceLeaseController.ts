import {
  gateStudioCanvasMutation,
  type StudioCanvasMutationIntent,
} from "./studio-live-canvas-mutation-gate";
import {
  planStudioLiveHeldResourceReplace,
  selfHoldsStudioLiveLock,
  studioLiveMutationResources,
} from "./studio-live-mutation-guard";
import {
  releaseStudioLiveMutationLocks,
  replaceStudioLiveMutationLocks,
} from "./studio-live-mutation-lock-coordinator";

import type { StudioLiveRoom } from "./studio-live-collaboration-room";

interface MutableRef<T> {
  current: T;
}

interface PendingStudioLiveMutation {
  readonly room: StudioLiveRoom;
  readonly key: string;
  readonly promise: Promise<boolean>;
}

interface CreateStudioLiveResourceLeaseControllerOptions {
  readonly heldResourcesRef: MutableRef<string[]>;
  readonly mutationGenerationRef: MutableRef<number>;
  readonly pageId: string;
  readonly pendingMutationRef: MutableRef<PendingStudioLiveMutation | null>;
  readonly reportError: (message: string | null) => void;
  readonly roomRef: MutableRef<StudioLiveRoom | null>;
}

export interface StudioLiveResourceLeaseController {
  readonly begin: (
    elementIds?: readonly string[] | null,
    intent?: StudioCanvasMutationIntent,
  ) => boolean;
  readonly beginAsync: (
    elementIds?: readonly string[] | null,
    intent?: StudioCanvasMutationIntent,
  ) => Promise<boolean>;
  readonly end: () => void;
}

/**
 * Coordinates page/element mutation leases without exposing lock protocol details to canvas UI.
 * The controller preserves the synchronous local-preview path and the serialized authoritative
 * server-room path while keeping all held-resource bookkeeping in the live-session runtime.
 */
export function createStudioLiveResourceLeaseController({
  heldResourcesRef,
  mutationGenerationRef,
  pageId,
  pendingMutationRef,
  reportError,
  roomRef,
}: CreateStudioLiveResourceLeaseControllerOptions): StudioLiveResourceLeaseController {
  const resourcesFor = (elementIds?: readonly string[] | null): string[] =>
    studioLiveMutationResources({ pageId, elementIds });

  const preflight = (
    room: StudioLiveRoom,
    elementIds?: readonly string[] | null,
    intent: StudioCanvasMutationIntent = "transform",
  ): boolean => {
    const decision = gateStudioCanvasMutation({
      locks: room.getLocks(),
      pageId,
      elementIds,
      selfSessionId: room.participant.sessionId,
      intent,
      allowSelectWithoutLease: false,
    });
    if (decision.ok) return true;
    reportError(decision.reason);
    return false;
  };

  const beginAsync = async (
    elementIds?: readonly string[] | null,
    intent: StudioCanvasMutationIntent = "transform",
  ): Promise<boolean> => {
    const room = roomRef.current;
    if (!room) return true;
    if (!preflight(room, elementIds, intent)) return false;
    const resources = resourcesFor(elementIds);
    const key = JSON.stringify(resources);
    const pending = pendingMutationRef.current;
    if (pending) {
      if (pending.room === room && pending.key === key) return pending.promise;
      reportError("다른 편집 잠금을 확인하고 있어요. 확인이 끝난 뒤 다시 시도해 주세요.");
      return false;
    }

    const generation = ++mutationGenerationRef.current;
    const operation = replaceStudioLiveMutationLocks({
      room,
      previouslyHeld: heldResourcesRef.current,
      nextResources: resources,
    }).then((result) => {
      if (generation !== mutationGenerationRef.current) {
        if (result.ok) releaseStudioLiveMutationLocks(room, result.held);
        return false;
      }
      heldResourcesRef.current = [...result.held];
      if (!result.ok) {
        reportError(result.failure.message);
        return false;
      }
      reportError(null);
      return true;
    });
    const entry = { room, key, promise: operation };
    pendingMutationRef.current = entry;
    void operation.finally(() => {
      if (pendingMutationRef.current === entry) pendingMutationRef.current = null;
    });
    return operation;
  };

  const begin = (
    elementIds?: readonly string[] | null,
    intent: StudioCanvasMutationIntent = "drag",
  ): boolean => {
    const room = roomRef.current;
    if (!room) return true;
    if (!preflight(room, elementIds, intent)) return false;
    const resources = resourcesFor(elementIds);

    // Local preview rooms can arbitrate synchronously. Server rooms may start a gesture only when
    // the participant already owns every authoritative resource, otherwise acquisition is primed.
    if (room.mode !== "server") {
      const plan = planStudioLiveHeldResourceReplace(heldResourcesRef.current, resources);
      for (const resource of plan.toRelease) room.releaseLock(resource);
      for (const resource of plan.toClaim) {
        if (!room.claimLock(resource)) {
          releaseStudioLiveMutationLocks(room, plan.held);
          heldResourcesRef.current = [];
          return false;
        }
      }
      heldResourcesRef.current = [...plan.held];
      return true;
    }

    const locks = room.getLocks();
    if (
      resources.every((resource) =>
        selfHoldsStudioLiveLock(locks, resource, room.participant.sessionId))
    ) {
      const plan = planStudioLiveHeldResourceReplace(heldResourcesRef.current, resources);
      for (const resource of plan.toRelease) room.releaseLock(resource);
      heldResourcesRef.current = [...plan.held];
      return true;
    }

    const key = JSON.stringify(resources);
    const pending = pendingMutationRef.current;
    if (!pending || pending.room !== room || pending.key !== key) {
      void beginAsync(elementIds);
    }
    return true;
  };

  const end = (): void => {
    const room = roomRef.current;
    ++mutationGenerationRef.current;
    heldResourcesRef.current = [
      ...releaseStudioLiveMutationLocks(room, heldResourcesRef.current),
    ];
  };

  return { begin, beginAsync, end };
}
