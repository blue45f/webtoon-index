import {
  MAX_COLLECTION_ID_LENGTH,
  normalizeCollectionEmoji,
  normalizeCollectionName,
} from "./collection-contract";
import { useApp } from "./store";
import {
  newClientCollectionId,
  rebaseCollectionOutbox,
} from "./store-collection-logic";

import type { CollectionAuthFence, CollectionIdMap } from "./collection-write-through";
import type { Collection } from "./store-types";

export function claimGuestCollectionsForOwner(fence: CollectionAuthFence): void {
  useApp.setState((state) => {
    const outbox = [...state.collectionOutbox];
    const hasCreate = new Set(
      outbox
        .filter((entry) => entry.ownerId === fence.userId && entry.command.action === "create")
        .map((entry) => entry.command.id)
    );
    const hasIncludedItem = new Set(
      outbox.flatMap((entry) =>
        entry.ownerId === fence.userId &&
        entry.command.action === "set-item" &&
        entry.command.included
          ? [`${entry.command.id}\u0000${entry.command.titleId}`]
          : []
      )
    );

    for (const collection of state.collections) {
      if (!hasCreate.has(collection.id)) {
        outbox.push({
          mutationId: newClientCollectionId(),
          ownerId: fence.userId,
          command: {
            action: "create",
            id: collection.id,
            name: normalizeCollectionName(collection.name),
            emoji: normalizeCollectionEmoji(collection.emoji),
          },
          rollback: { kind: "create" },
          recovery: true,
        });
        hasCreate.add(collection.id);
      }
      for (const rawTitleId of collection.titleIds) {
        const titleId = String(rawTitleId).trim().slice(0, MAX_COLLECTION_ID_LENGTH);
        const key = `${collection.id}\u0000${titleId}`;
        if (!titleId || hasIncludedItem.has(key)) continue;
        outbox.push({
          mutationId: newClientCollectionId(),
          ownerId: fence.userId,
          command: {
            action: "set-item",
            id: collection.id,
            titleId,
            included: true,
          },
          rollback: {
            kind: "set-item",
            titleId,
            previousIncluded: true,
            intendedIncluded: true,
          },
          recovery: true,
        });
        hasIncludedItem.add(key);
      }
    }

    return {
      libraryMergeOwnerId: fence.userId,
      collectionOutbox: outbox,
    };
  });
}

export function discardGuestCollectionRecovery(
  ownerId: string,
  mergedIdMap: CollectionIdMap
): void {
  const mergedClientIds = new Set(Object.keys(mergedIdMap));
  useApp.setState((state) => ({
    collectionOutbox: state.collectionOutbox.filter(
      (entry) =>
        entry.ownerId !== ownerId ||
        entry.recovery !== true ||
        !mergedClientIds.has(entry.command.id)
    ),
  }));
}

export function collectionMergeCollectionsForOwner(ownerId: string): Collection[] {
  const state = useApp.getState();
  return rebaseCollectionOutbox(state.collections, state.collectionOutbox, ownerId);
}
