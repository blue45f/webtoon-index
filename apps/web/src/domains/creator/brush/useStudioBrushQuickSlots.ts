import { useEffect, useRef, useState, type RefObject } from "react";

import {
  isStudioLocalDatabaseOwnershipBusyError,
  STUDIO_BRUSH_QUICK_SLOTS_OWNERSHIP_BUSY_HINT,
} from "../studio-local-database-ownership";
import {
  loadStudioBrushQuickSlotsSqliteRepository,
  type StudioBrushQuickSlotsSnapshot,
} from "../studio-page-editor-runtime-loaders";
import { studioBrushQuickSlotsDeviceProfile } from "../studio-page-shell-runtime";

import {
  emptyStudioBrushSlots,
  STUDIO_BRUSH_SLOT_COUNT,
  type StudioBrushSlotsState,
} from "./studio-brush-slots";

interface StudioBrushQuickSlotsMutationOptions {
  readonly successMessage?: string;
  readonly failureMessage: string;
}

interface UseStudioBrushQuickSlotsOptions {
  readonly announceRef: RefObject<(message: string) => void>;
  readonly editorMountedRef: RefObject<boolean>;
  readonly ownerScope: string | null;
  readonly reportError: (message: string) => void;
}

interface StudioBrushSlotsScope {
  readonly ownerScope: string;
  readonly deviceProfile: string;
}

interface StudioBrushSlotsProjection {
  readonly scopeKey: string;
  readonly state: StudioBrushSlotsState;
}

/**
 * Owns the durable quick-slot projection for one authenticated user/device scope.
 *
 * The controller keeps optimistic state, multi-tab conflict resolution, and OPFS ownership
 * handling behind one typed API. Editor commands provide only the slot reducer and user-facing
 * messages; they do not know about repository revisions, write serialization, or hydration races.
 */
export function useStudioBrushQuickSlots({
  announceRef,
  editorMountedRef,
  ownerScope,
  reportError,
}: UseStudioBrushQuickSlotsOptions) {
  const [deviceProfile] = useState(studioBrushQuickSlotsDeviceProfile);
  const scope: StudioBrushSlotsScope = {
    ownerScope: ownerScope ?? "guest",
    deviceProfile,
  };
  const scopeKey = JSON.stringify([scope.ownerScope, scope.deviceProfile]);
  const scopeRef = useRef({ key: scopeKey, scope });
  scopeRef.current = { key: scopeKey, scope };

  const [projection, setProjection] = useState<StudioBrushSlotsProjection>(() => ({
    scopeKey,
    state: emptyStudioBrushSlots(),
  }));
  const state = projection.scopeKey === scopeKey
    ? projection.state
    : emptyStudioBrushSlots();
  const projectionRef = useRef(projection);
  projectionRef.current = projection;

  const durableSnapshotRef = useRef<{
    scopeKey: string;
    snapshot: StudioBrushQuickSlotsSnapshot;
  } | null>(null);
  const hydrationGenerationRef = useRef(0);
  const mutationGenerationRef = useRef(0);
  const mutationTailRef = useRef<Promise<void>>(Promise.resolve());
  const dirtyGenerationsByScopeRef = useRef(new Map<string, number[]>());
  const ownershipBusyAnnouncedRef = useRef(false);

  useEffect(() => {
    let active = true;
    const generation = hydrationGenerationRef.current + 1;
    hydrationGenerationRef.current = generation;
    const mutationGeneration = mutationGenerationRef.current;
    const request = scopeRef.current;

    if (projectionRef.current.scopeKey !== request.key) {
      const emptyProjection = {
        scopeKey: request.key,
        state: emptyStudioBrushSlots(),
      };
      projectionRef.current = emptyProjection;
      setProjection(emptyProjection);
    }
    if (durableSnapshotRef.current?.scopeKey !== request.key) {
      durableSnapshotRef.current = null;
    }

    void loadStudioBrushQuickSlotsSqliteRepository()
      .then(({ getProductStudioBrushQuickSlotsSqliteRepository }) =>
        getProductStudioBrushQuickSlotsSqliteRepository().load(request.scope))
      .then((snapshot) => {
        if (
          !active
          || !editorMountedRef.current
          || hydrationGenerationRef.current !== generation
          || mutationGenerationRef.current !== mutationGeneration
          || scopeRef.current.key !== request.key
        ) {
          return;
        }
        durableSnapshotRef.current = { scopeKey: request.key, snapshot };
        const nextProjection = {
          scopeKey: request.key,
          state: { slots: snapshot.slots },
        };
        projectionRef.current = nextProjection;
        setProjection(nextProjection);
      })
      .catch((cause: unknown) => {
        if (
          !active
          || !editorMountedRef.current
          || hydrationGenerationRef.current !== generation
          || mutationGenerationRef.current !== mutationGeneration
          || scopeRef.current.key !== request.key
        ) {
          return;
        }
        // Two Studio tabs can contend for one origin OPFS SAH lock. The secondary tab keeps its
        // session projection and receives one non-blocking hint instead of a destructive banner.
        if (isStudioLocalDatabaseOwnershipBusyError(cause)) {
          if (!ownershipBusyAnnouncedRef.current) {
            ownershipBusyAnnouncedRef.current = true;
            announceRef.current(STUDIO_BRUSH_QUICK_SLOTS_OWNERSHIP_BUSY_HINT);
          }
          return;
        }
        reportError(
          cause instanceof Error
            ? `브러시 퀵 슬롯을 불러오지 못했어요: ${cause.message}`
            : "브러시 퀵 슬롯을 불러오지 못했어요. SQLite 저장소를 확인해주세요.",
        );
      });

    return () => {
      active = false;
    };
  }, [announceRef, editorMountedRef, reportError, scopeKey]);

  function commit(
    update: (current: StudioBrushSlotsState) => StudioBrushSlotsState,
    options: StudioBrushQuickSlotsMutationOptions,
  ): void {
    const request = scopeRef.current;
    const currentProjection = projectionRef.current;
    const currentState = currentProjection.scopeKey === request.key
      ? currentProjection.state
      : emptyStudioBrushSlots();
    const desiredState = update(currentState);
    const generation = mutationGenerationRef.current + 1;
    mutationGenerationRef.current = generation;
    const dirtyGenerations = dirtyGenerationsByScopeRef.current.get(request.key)
      ?? Array.from({ length: STUDIO_BRUSH_SLOT_COUNT }, () => 0);
    dirtyGenerationsByScopeRef.current.set(request.key, dirtyGenerations);

    for (let index = 0; index < STUDIO_BRUSH_SLOT_COUNT; index += 1) {
      if (
        JSON.stringify(currentState.slots[index] ?? null)
        !== JSON.stringify(desiredState.slots[index] ?? null)
      ) {
        dirtyGenerations[index] = generation;
      }
    }

    const optimisticProjection = { scopeKey: request.key, state: desiredState };
    projectionRef.current = optimisticProjection;
    setProjection(optimisticProjection);

    const persist = async (): Promise<void> => {
      const activeDirtySlots = dirtyGenerations.flatMap((marker, slotIndex) =>
        marker > 0 && marker <= generation ? [{ marker, slotIndex }] : []);
      if (activeDirtySlots.length === 0) {
        if (
          editorMountedRef.current
          && scopeRef.current.key === request.key
          && mutationGenerationRef.current === generation
          && options.successMessage
        ) {
          announceRef.current(options.successMessage);
        }
        return;
      }

      const repositoryModule = await loadStudioBrushQuickSlotsSqliteRepository();
      const repository = repositoryModule.getProductStudioBrushQuickSlotsSqliteRepository();
      const durable = durableSnapshotRef.current?.scopeKey === request.key
        ? durableSnapshotRef.current.snapshot
        : await repository.load(request.scope);
      const applyDirtySlots = (
        base: StudioBrushQuickSlotsSnapshot,
        entries: readonly { marker: number; slotIndex: number }[],
      ): StudioBrushSlotsState => {
        const slots = [...base.slots];
        for (const { slotIndex } of entries) {
          slots[slotIndex] = desiredState.slots[slotIndex] ?? null;
        }
        return { slots };
      };

      let saved: StudioBrushQuickSlotsSnapshot;
      let conflictResolved = false;
      try {
        saved = await repository.save(
          request.scope,
          applyDirtySlots(durable, activeDirtySlots),
          durable.revision,
        );
      } catch (cause) {
        if (
          !cause
          || typeof cause !== "object"
          || !("code" in cause)
          || cause.code !== "conflict"
        ) {
          throw cause;
        }
        const latest = await repository.load(request.scope);
        const retryDirtySlots = activeDirtySlots.filter(
          ({ marker, slotIndex }) => dirtyGenerations[slotIndex] === marker,
        );
        if (retryDirtySlots.length === 0) return;
        saved = await repository.save(
          request.scope,
          applyDirtySlots(latest, retryDirtySlots),
          latest.revision,
        );
        conflictResolved = true;
      }

      for (const { marker, slotIndex } of activeDirtySlots) {
        if (dirtyGenerations[slotIndex] === marker) dirtyGenerations[slotIndex] = 0;
      }
      if (dirtyGenerations.every((marker) => marker === 0)) {
        dirtyGenerationsByScopeRef.current.delete(request.key);
      }
      if (scopeRef.current.key !== request.key) return;
      durableSnapshotRef.current = { scopeKey: request.key, snapshot: saved };
      if (!editorMountedRef.current) return;

      if (conflictResolved) {
        announceRef.current("다른 탭의 브러시 슬롯 변경을 다시 불러와 안전하게 병합했어요.");
      }
      if (mutationGenerationRef.current === generation) {
        const nextProjection = {
          scopeKey: request.key,
          state: { slots: saved.slots },
        };
        projectionRef.current = nextProjection;
        setProjection(nextProjection);
        if (!conflictResolved && options.successMessage) {
          announceRef.current(options.successMessage);
        }
      }
    };

    const operation = mutationTailRef.current.then(persist, persist);
    mutationTailRef.current = operation.then(
      () => undefined,
      () => undefined,
    );
    void operation.catch((cause: unknown) => {
      if (!editorMountedRef.current || scopeRef.current.key !== request.key) return;
      if (isStudioLocalDatabaseOwnershipBusyError(cause)) {
        if (!ownershipBusyAnnouncedRef.current) {
          ownershipBusyAnnouncedRef.current = true;
          announceRef.current(STUDIO_BRUSH_QUICK_SLOTS_OWNERSHIP_BUSY_HINT);
        }
        return;
      }
      const message = cause && typeof cause === "object" && "code" in cause
        && cause.code === "conflict"
        ? "다른 탭에서 브러시 슬롯이 다시 변경되어 현재 슬롯은 안전하게 유지했지만 저장하지 못했어요. 다시 시도해주세요."
        : `${options.failureMessage} 현재 슬롯은 이 화면에만 유지되며 저장 완료로 처리하지 않았어요.`;
      reportError(message);
      announceRef.current(message);
    });
  }

  return { commitStudioBrushSlotsMutation: commit, brushSlotsState: state } as const;
}
