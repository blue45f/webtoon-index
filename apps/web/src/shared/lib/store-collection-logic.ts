import { normalizeCollectionClientId } from "./collection-contract";
import {
  CollectionWriteThroughCoordinator,
  collectionAccountKey,
  collectionLaneKey,
  remapCollectionCommand,
  remapCollectionId,
  waitForCollectionMerge,
} from "./collection-write-through";
import { withCsrfProtection } from "./csrf";
import { useApp } from "./store";
import { toast } from "./toast-store";

import type {
  CollectionAuthFence,
  CollectionCommand,
  CollectionIdMap,
} from "./collection-write-through";
import type {
  Collection,
  CollectionOutboxEntry,
  CollectionRollback,
  CollectionHydrationFence,
} from "./store-types";

export class CollectionRequestError extends Error {
  constructor(
    message: string,
    public readonly transient: boolean,
    public readonly status: number | null = null,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "CollectionRequestError";
  }
}

export const collectionWriteThrough = new CollectionWriteThroughCoordinator();
export const scheduledCollectionMutations = new Set<string>();
const COLLECTION_REQUEST_TIMEOUT_MS = 15_000;

export function newClientCollectionId(): string {
  return globalThis.crypto.randomUUID();
}

export function currentCollectionAuthFence(): CollectionAuthFence | null {
  const { userId, sessionToken, authGeneration } = useApp.getState();
  return userId
    ? { userId, sessionToken, generation: authGeneration }
    : null;
}

export function isCollectionAuthFenceCurrent(fence: CollectionAuthFence): boolean {
  const state = useApp.getState();
  return (
    state.userId === fence.userId &&
    state.sessionToken === fence.sessionToken &&
    state.authGeneration === fence.generation
  );
}

export function isCollectionCommandResponse(
  command: CollectionCommand,
  payload: unknown
): boolean {
  if (!payload || typeof payload !== "object" || (payload as { ok?: unknown }).ok !== true) {
    return false;
  }
  const response = payload as Record<string, unknown>;
  if (response.id !== command.id) return false;
  if (command.action === "set-item") {
    return (
      response.titleId === command.titleId &&
      response.included === command.included
    );
  }
  return true;
}

export async function sendCollectionCommand(
  fence: CollectionAuthFence,
  command: CollectionCommand
): Promise<void> {
  let response: Response;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutRequest = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new CollectionRequestError(
          "컬렉션 서버 응답 시간이 초과되었습니다.",
          true
        ));
      }, COLLECTION_REQUEST_TIMEOUT_MS);
    });
    response = await Promise.race([
      fetch("/api/me/collection", withCsrfProtection({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(fence.sessionToken
            ? { "x-user-id": fence.sessionToken }
            : {}),
        },
        body: JSON.stringify(command),
        signal: controller.signal,
      })),
      timeoutRequest,
    ]);
  } catch (error) {
    if (error instanceof CollectionRequestError) throw error;
    throw new CollectionRequestError("컬렉션 서버에 연결하지 못했습니다.", true, null, {
      cause: error,
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  if (!response.ok) {
    const transient =
      response.status === 401 ||
      response.status === 403 ||
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500;
    throw new CollectionRequestError(
      `컬렉션 요청이 실패했습니다. (${response.status})`,
      transient,
      response.status
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new CollectionRequestError("컬렉션 서버 응답을 확인할 수 없습니다.", false, response.status, {
      cause: error,
    });
  }
  if (!isCollectionCommandResponse(command, payload)) {
    throw new CollectionRequestError("컬렉션 서버 응답의 작업 식별자가 일치하지 않습니다.", false, response.status);
  }
}

export function remapCollection(collection: Collection, idMap: CollectionIdMap): Collection {
  const id = remapCollectionId(collection.id, idMap);
  return id === collection.id ? collection : { ...collection, id };
}

export function remapOutboxEntry(
  entry: CollectionOutboxEntry,
  idMap: CollectionIdMap
): CollectionOutboxEntry {
  const command = remapCollectionCommand(entry.command, idMap);
  const rollback = entry.rollback.kind === "delete"
    ? {
        ...entry.rollback,
        collection: remapCollection(entry.rollback.collection, idMap),
      }
    : entry.rollback;
  return command === entry.command && rollback === entry.rollback
    ? entry
    : { ...entry, command, rollback };
}

export function applyCollectionRollback(
  collections: Collection[],
  command: CollectionCommand,
  rollback: CollectionRollback
): Collection[] {
  if (rollback.kind === "create") {
    return collections.some((collection) => collection.id === command.id)
      ? collections.filter((collection) => collection.id !== command.id)
      : collections;
  }

  if (rollback.kind === "rename") {
    const current = collections.find((collection) => collection.id === command.id);
    if (!current || current.name !== rollback.attemptedName) return collections;
    return collections.map((collection) =>
      collection.id === command.id
        ? { ...collection, name: rollback.previousName }
        : collection
    );
  }

  if (rollback.kind === "delete") {
    if (collections.some((collection) => collection.id === command.id)) return collections;
    const restored = [...collections];
    restored.splice(
      Math.min(Math.max(rollback.index, 0), restored.length),
      0,
      rollback.collection
    );
    return restored;
  }

  const current = collections.find((collection) => collection.id === command.id);
  if (!current) return collections;
  const currentlyIncluded = current.titleIds.includes(rollback.titleId);
  if (currentlyIncluded !== rollback.intendedIncluded) return collections;
  return collections.map((collection) => {
    if (collection.id !== command.id) return collection;
    return {
      ...collection,
      titleIds: rollback.previousIncluded
        ? [...collection.titleIds.filter((id) => id !== rollback.titleId), rollback.titleId]
        : collection.titleIds.filter((id) => id !== rollback.titleId),
    };
  });
}

export function applyOptimisticCollectionCommand(
  collections: Collection[],
  command: CollectionCommand
): Collection[] {
  if (command.action === "create") {
    if (collections.some((collection) => collection.id === command.id)) return collections;
    return [
      ...collections,
      {
        id: command.id,
        name: command.name,
        emoji: command.emoji,
        titleIds: [],
        createdAt: new Date().toISOString(),
      },
    ];
  }
  if (command.action === "rename") {
    return collections.map((collection) =>
      collection.id === command.id ? { ...collection, name: command.name } : collection
    );
  }
  if (command.action === "delete") {
    return collections.filter((collection) => collection.id !== command.id);
  }
  return collections.map((collection) => {
    if (collection.id !== command.id) return collection;
    return {
      ...collection,
      titleIds: command.included
        ? [...collection.titleIds.filter((titleId) => titleId !== command.titleId), command.titleId]
        : collection.titleIds.filter((titleId) => titleId !== command.titleId),
    };
  });
}

export function rebaseCollectionOutbox(
  serverCollections: Collection[],
  outbox: CollectionOutboxEntry[],
  ownerId: string
): Collection[] {
  return outbox
    .filter((entry) => entry.ownerId === ownerId)
    .reduce(
      (collections, entry) => applyOptimisticCollectionCommand(collections, entry.command),
      serverCollections
    );
}

export function currentCollectionFenceForOwner(
  ownerId: string
): CollectionAuthFence | null {
  const state = useApp.getState();
  return state.userId === ownerId
    ? {
        userId: ownerId,
        sessionToken: state.sessionToken,
        generation: state.authGeneration,
      }
    : null;
}

export function queueCollectionOutboxEntry(
  fence: CollectionAuthFence,
  entry: CollectionOutboxEntry
): void {
  if (scheduledCollectionMutations.has(entry.mutationId)) return;
  scheduledCollectionMutations.add(entry.mutationId);
  let resolvedEntry = entry;
  let mergeIdentityResolved = false;
  collectionWriteThrough.enqueue({
    accountKey: collectionAccountKey(fence),
    laneKey: collectionLaneKey(fence, entry.command.id),
    run: async () => {
      if (!mergeIdentityResolved) {
        let idMap: CollectionIdMap;
        try {
          idMap = await waitForCollectionMerge(entry.ownerId);
        } catch (error) {
          throw new CollectionRequestError(
            "게스트 컬렉션 병합이 끝나지 않아 변경을 보류했습니다.",
            true,
            null,
            { cause: error }
          );
        }
        resolvedEntry = remapOutboxEntry(entry, idMap);
        mergeIdentityResolved = true;
      }
      const activeFence = currentCollectionFenceForOwner(resolvedEntry.ownerId);
      if (!activeFence) {
        throw new CollectionRequestError(
          "해당 계정으로 다시 로그인할 때까지 컬렉션 변경을 보류합니다.",
          true
        );
      }
      await sendCollectionCommand(activeFence, resolvedEntry.command);
    },
    shouldRetry: (error) => error instanceof CollectionRequestError && error.transient,
    onSuccess: () => {
      scheduledCollectionMutations.delete(entry.mutationId);
      useApp.setState((state) => ({
        collectionOutbox: state.collectionOutbox.filter(
          (candidate) => candidate.mutationId !== entry.mutationId
        ),
      }));
    },
    onPermanentFailure: () => {
      scheduledCollectionMutations.delete(entry.mutationId);
      let rolledBack = false;
      useApp.setState((state) => {
        const collectionOutbox = state.collectionOutbox.filter(
          (candidate) => candidate.mutationId !== entry.mutationId
        );
        if (state.userId !== resolvedEntry.ownerId) return { collectionOutbox };
        const collections = applyCollectionRollback(
          state.collections,
          resolvedEntry.command,
          resolvedEntry.rollback
        );
        rolledBack = collections !== state.collections;
        return {
          collectionOutbox,
          ...(rolledBack
            ? {
                collections,
                collectionRevision: state.collectionRevision + 1,
              }
            : {}),
        };
      });
      if (useApp.getState().userId === resolvedEntry.ownerId) {
        toast(rolledBack
          ? "컬렉션 변경을 저장하지 못해 이전 상태로 되돌렸어요."
          : "컬렉션 변경을 저장하지 못했지만 더 최신인 로컬 상태는 유지했어요.");
      }
    },
    onTransientFailure: () => {
      scheduledCollectionMutations.delete(entry.mutationId);
      if (useApp.getState().userId === resolvedEntry.ownerId) {
        toast("컬렉션 변경을 이 기기의 동기화 대기열에 보관했어요. 연결이 복구되면 자동으로 다시 시도합니다.");
      }
    },
  });
}

export async function replayPendingCollectionWrites(
  fence: CollectionAuthFence
): Promise<void> {
  const entries = useApp.getState().collectionOutbox.filter(
    (entry) => entry.ownerId === fence.userId
  );
  for (const entry of entries) queueCollectionOutboxEntry(fence, entry);
  await collectionWriteThrough.waitForAccountIdle(collectionAccountKey(fence));
}

export function appendOutboxEntry(
  outbox: CollectionOutboxEntry[],
  entry: CollectionOutboxEntry
): CollectionOutboxEntry[] {
  return [...outbox, entry];
}

export function canonicalizeGuestCollections(collections: Collection[]): {
  collections: Collection[];
  idMap: CollectionIdMap;
} {
  const idMap: CollectionIdMap = {};
  for (const collection of collections) {
    const canonicalId = normalizeCollectionClientId(collection.id) ?? newClientCollectionId();
    if (canonicalId !== collection.id) idMap[collection.id] ??= canonicalId;
  }
  return {
    collections: Object.keys(idMap).length === 0
    ? collections
      : collections.map((collection) => remapCollection(collection, idMap)),
    idMap,
  };
}

export function migrateGuestCollectionIds(collections: Collection[]): Collection[] {
  return canonicalizeGuestCollections(collections).collections;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isPersistedCollection(value: unknown): value is Collection {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.emoji === "string" &&
    typeof value.createdAt === "string" &&
    Array.isArray(value.titleIds) &&
    value.titleIds.every((titleId) => typeof titleId === "string")
  );
}

export function isPersistedCollectionCommand(value: unknown): value is CollectionCommand {
  if (!isRecord(value) || typeof value.action !== "string" || typeof value.id !== "string") {
    return false;
  }
  if (value.action === "create") {
    return typeof value.name === "string" && typeof value.emoji === "string";
  }
  if (value.action === "rename") return typeof value.name === "string";
  if (value.action === "delete") return true;
  return (
    value.action === "set-item" &&
    typeof value.titleId === "string" &&
    typeof value.included === "boolean"
  );
}

export function isPersistedCollectionRollback(value: unknown): value is CollectionRollback {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "create") return true;
  if (value.kind === "rename") {
    return typeof value.previousName === "string" && typeof value.attemptedName === "string";
  }
  if (value.kind === "delete") {
    return (
      Number.isInteger(value.index) &&
      Number(value.index) >= 0 &&
      isPersistedCollection(value.collection)
    );
  }
  return (
    value.kind === "set-item" &&
    typeof value.titleId === "string" &&
    typeof value.previousIncluded === "boolean" &&
    typeof value.intendedIncluded === "boolean"
  );
}

export function sanitizeCollectionOutbox(value: unknown): CollectionOutboxEntry[] {
  if (!Array.isArray(value)) return [];
  const seenMutationIds = new Set<string>();
  return value.filter((entry): entry is CollectionOutboxEntry => {
    if (
      !isRecord(entry) ||
      typeof entry.mutationId !== "string" ||
      typeof entry.ownerId !== "string" ||
      !isPersistedCollectionCommand(entry.command) ||
      !isPersistedCollectionRollback(entry.rollback) ||
      (entry.recovery !== undefined && entry.recovery !== true)
    ) {
      return false;
    }
    const matchingRollback = (
      (entry.command.action === "create" && entry.rollback.kind === "create") ||
      (entry.command.action === "rename" && entry.rollback.kind === "rename") ||
      (entry.command.action === "delete" && entry.rollback.kind === "delete") ||
      (entry.command.action === "set-item" && entry.rollback.kind === "set-item")
    );
    if (!matchingRollback || seenMutationIds.has(entry.mutationId)) return false;
    seenMutationIds.add(entry.mutationId);
    return true;
  });
}

export function captureCollectionHydrationFence(): CollectionHydrationFence | null {
  const fence = currentCollectionAuthFence();
  if (!fence) return null;
  return {
    ...fence,
    collectionRevision: useApp.getState().collectionRevision,
    preserveCollections:
      collectionWriteThrough.hasPending(collectionAccountKey(fence)) ||
      useApp.getState().collectionOutbox.some((entry) => entry.ownerId === fence.userId),
  };
}
