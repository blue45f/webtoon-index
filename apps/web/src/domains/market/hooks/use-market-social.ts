import {
  useCallback,
  useEffect,
  useSyncExternalStore,
} from "react";

import type {
  CreateCreatorMarketplaceSocialComment,
  CreatorMarketplaceSocialPage,
  UpsertCreatorMarketplaceSocialReview,
} from "@/shared/lib/creator-marketplace-social-contract";

import {
  createCreatorMarketplaceComment,
  deleteCreatorMarketplaceComment,
  deleteCreatorMarketplaceReview,
  getCreatorMarketplaceSocialPage,
  toggleCreatorMarketplaceCommentLike,
  toggleCreatorMarketplaceReviewHelpful,
  upsertCreatorMarketplaceReview,
} from "@/src/infrastructure/creator-marketplace-social-client";

export type MarketSocialLoadStatus = "idle" | "loading" | "ready" | "error";

export interface MarketSocialSnapshot {
  readonly status: MarketSocialLoadStatus;
  readonly data: CreatorMarketplaceSocialPage | null;
  readonly error: string | null;
  readonly pendingAction: string | null;
}

interface MarketSocialStore {
  readonly resourceId: string;
  readonly listeners: Set<() => void>;
  snapshot: MarketSocialSnapshot;
  request: Promise<void> | null;
  controller: AbortController | null;
  mutationController: AbortController | null;
  viewerKey: string | null;
  browserCleanup: (() => void) | null;
  lastTouchedAt: number;
}

interface MarketSocialBroadcastMessage {
  readonly source: "toonspectrum-market-social";
  readonly resourceId: string;
  readonly publisherId: string;
  readonly packageId: string;
}

const stores = new Map<string, MarketSocialStore>();
const MAX_MARKET_SOCIAL_STORES = 64;
const CHANNEL_NAME = "toonspectrum:market-social:v1";
let broadcastChannel: BroadcastChannel | null | undefined;

function createStore(resourceId: string): MarketSocialStore {
  return {
    resourceId,
    listeners: new Set(),
    snapshot: {
      status: "idle",
      data: null,
      error: null,
      pendingAction: null,
    },
    request: null,
    controller: null,
    mutationController: null,
    viewerKey: null,
    browserCleanup: null,
    lastTouchedAt: Date.now(),
  };
}

function touchStore(store: MarketSocialStore): void {
  store.lastTouchedAt = Date.now();
}

function disposeStore(store: MarketSocialStore): void {
  store.controller?.abort();
  store.mutationController?.abort();
  store.browserCleanup?.();
  stores.delete(store.resourceId);
}

function pruneInactiveStores(preserve?: MarketSocialStore): void {
  if (stores.size <= MAX_MARKET_SOCIAL_STORES) return;
  const candidates = [...stores.values()]
    .filter((store) =>
      store !== preserve
      && store.listeners.size === 0
      && !store.request
      && !store.snapshot.pendingAction
      && !store.mutationController
    )
    .sort((left, right) => left.lastTouchedAt - right.lastTouchedAt);
  while (stores.size > MAX_MARKET_SOCIAL_STORES) {
    const candidate = candidates.shift();
    if (!candidate) break;
    disposeStore(candidate);
  }
}

function getStore(resourceId: string): MarketSocialStore {
  const existing = stores.get(resourceId);
  if (existing) {
    touchStore(existing);
    return existing;
  }
  const created = createStore(resourceId);
  stores.set(resourceId, created);
  pruneInactiveStores(created);
  return created;
}

function publish(
  store: MarketSocialStore,
  patch: Partial<MarketSocialSnapshot>,
): void {
  store.snapshot = { ...store.snapshot, ...patch };
  touchStore(store);
  for (const listener of store.listeners) listener();
}

function setStoreViewerKey(
  store: MarketSocialStore,
  viewerKey: string,
): boolean {
  const changed = store.viewerKey !== viewerKey;
  if (!changed) {
    touchStore(store);
    return false;
  }

  store.viewerKey = viewerKey;
  store.controller?.abort();
  store.mutationController?.abort();
  store.mutationController = null;
  publish(store, {
    status: "idle",
    data: null,
    error: null,
    pendingAction: null,
  });
  return true;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function loadStore(
  store: MarketSocialStore,
  force = false,
): Promise<void> {
  if (store.request && !force) return store.request;
  if (force) store.controller?.abort();

  const controller = new AbortController();
  store.controller = controller;
  publish(store, { status: "loading", error: null });

  const request = getCreatorMarketplaceSocialPage(
    store.resourceId,
    controller.signal,
  )
    .then((data) => {
      if (controller.signal.aborted) return;
      publish(store, { status: "ready", data, error: null });
    })
    .catch((error: unknown) => {
      if (controller.signal.aborted) return;
      publish(store, {
        status: "error",
        error: errorMessage(
          error,
          "마켓 댓글과 리뷰를 불러오지 못했습니다.",
        ),
      });
    })
    .finally(() => {
      if (store.request === request) store.request = null;
      if (store.controller === controller) store.controller = null;
      pruneInactiveStores();
    });
  store.request = request;
  return request;
}

function isBroadcastMessage(value: unknown): value is MarketSocialBroadcastMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MarketSocialBroadcastMessage>;
  return candidate.source === "toonspectrum-market-social"
    && typeof candidate.resourceId === "string"
    && typeof candidate.publisherId === "string"
    && typeof candidate.packageId === "string";
}

function channel(): BroadcastChannel | null {
  if (broadcastChannel !== undefined) return broadcastChannel;
  if (typeof BroadcastChannel === "undefined") {
    broadcastChannel = null;
    return null;
  }
  // 존재는 생성 가능성이 아니다. 스토리지가 분할된 인앱 WebView 는 생성자를 노출한 채 `new` 에서
  // SecurityError 를 던지고, 그 throw 가 channel() 밖으로 새어 소셜 구독 경로를 통째로 깬다.
  try {
    broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    broadcastChannel = null;
    return null;
  }
  broadcastChannel.addEventListener("message", (event) => {
    if (!isBroadcastMessage(event.data)) return;
    for (const store of stores.values()) {
      const data = store.snapshot.data;
      const samePackage = data
        && data.publisherId === event.data.publisherId
        && data.packageId === event.data.packageId;
      if (store.resourceId === event.data.resourceId || samePackage) {
        void loadStore(store, true);
      }
    }
  });
  return broadcastChannel;
}

function announceChange(
  currentStore: MarketSocialStore,
  data: CreatorMarketplaceSocialPage,
): void {
  for (const store of stores.values()) {
    if (store === currentStore) continue;
    const candidate = store.snapshot.data;
    if (
      candidate?.publisherId === data.publisherId
      && candidate.packageId === data.packageId
    ) {
      void loadStore(store, true);
    }
  }
  channel()?.postMessage({
    source: "toonspectrum-market-social",
    resourceId: data.resourceId,
    publisherId: data.publisherId,
    packageId: data.packageId,
  } satisfies MarketSocialBroadcastMessage);
}

function attachBrowserRefresh(store: MarketSocialStore): void {
  if (store.browserCleanup || typeof window === "undefined") return;
  const refresh = () => void loadStore(store, true);
  const onVisibility = () => {
    if (document.visibilityState === "visible") refresh();
  };
  window.addEventListener("focus", refresh);
  window.addEventListener("pageshow", refresh);
  document.addEventListener("visibilitychange", onVisibility);
  channel();
  store.browserCleanup = () => {
    window.removeEventListener("focus", refresh);
    window.removeEventListener("pageshow", refresh);
    document.removeEventListener("visibilitychange", onVisibility);
    store.browserCleanup = null;
  };
}

function subscribe(store: MarketSocialStore, listener: () => void): () => void {
  if (store.listeners.size === 0) attachBrowserRefresh(store);
  store.listeners.add(listener);
  touchStore(store);
  return () => {
    store.listeners.delete(listener);
    if (store.listeners.size === 0) store.browserCleanup?.();
    touchStore(store);
    pruneInactiveStores();
  };
}

async function mutateStore(
  store: MarketSocialStore,
  action: string,
  mutation: (signal: AbortSignal) => Promise<CreatorMarketplaceSocialPage>,
): Promise<void> {
  if (store.snapshot.pendingAction) {
    throw new Error("다른 마켓 작업이 진행 중입니다.");
  }
  const controller = new AbortController();
  store.mutationController = controller;
  publish(store, { pendingAction: action, error: null });
  try {
    const data = await mutation(controller.signal);
    if (controller.signal.aborted) return;
    publish(store, { status: "ready", data, error: null });
    announceChange(store, data);
  } catch (error) {
    if (controller.signal.aborted) return;
    publish(store, {
      error: errorMessage(error, "마켓 작업을 완료하지 못했습니다."),
    });
    throw error;
  } finally {
    if (store.mutationController === controller) {
      store.mutationController = null;
    }
    if (store.snapshot.pendingAction === action) {
      publish(store, { pendingAction: null });
    }
    pruneInactiveStores();
  }
}

export interface UseMarketSocialResult extends MarketSocialSnapshot {
  readonly refresh: () => Promise<void>;
  readonly createComment: (
    input: CreateCreatorMarketplaceSocialComment,
  ) => Promise<void>;
  readonly deleteComment: (commentId: string) => Promise<void>;
  readonly toggleCommentLike: (commentId: string) => Promise<void>;
  readonly saveReview: (
    input: UpsertCreatorMarketplaceSocialReview,
  ) => Promise<void>;
  readonly deleteReview: () => Promise<void>;
  readonly toggleReviewHelpful: (reviewId: string) => Promise<void>;
  readonly isPending: (actionPrefix?: string) => boolean;
}

/**
 * Both social sections on a detail page subscribe to one resource store. Reads are deduplicated,
 * package siblings are invalidated together, and focus/BroadcastChannel revalidation keeps tabs
 * aligned after returning from Studio or writing in another browser tab.
 */
export function useMarketSocial(
  resourceId: string,
  viewerKey: string | null | undefined,
): UseMarketSocialResult {
  const normalizedViewerKey = viewerKey?.trim() || "guest";
  const store = getStore(resourceId);
  const snapshot = useSyncExternalStore(
    (listener) => subscribe(store, listener),
    () => store.snapshot,
    () => store.snapshot,
  );

  useEffect(() => {
    const viewerChanged = setStoreViewerKey(store, normalizedViewerKey);
    void loadStore(store, viewerChanged);
  }, [normalizedViewerKey, store]);

  const refresh = useCallback(() => loadStore(store, true), [store]);
  const createComment = useCallback(
    (input: CreateCreatorMarketplaceSocialComment) => mutateStore(
      store,
      "comment:create",
      (signal) => createCreatorMarketplaceComment(resourceId, input, signal),
    ),
    [resourceId, store],
  );
  const deleteComment = useCallback(
    (commentId: string) => mutateStore(
      store,
      `comment:${commentId}:delete`,
      (signal) => deleteCreatorMarketplaceComment(
        resourceId,
        commentId,
        signal,
      ),
    ),
    [resourceId, store],
  );
  const toggleCommentLike = useCallback(
    (commentId: string) => mutateStore(
      store,
      `comment:${commentId}:like`,
      (signal) => toggleCreatorMarketplaceCommentLike(
        resourceId,
        commentId,
        signal,
      ),
    ),
    [resourceId, store],
  );
  const saveReview = useCallback(
    (input: UpsertCreatorMarketplaceSocialReview) => mutateStore(
      store,
      "review:save",
      (signal) => upsertCreatorMarketplaceReview(resourceId, input, signal),
    ),
    [resourceId, store],
  );
  const deleteReview = useCallback(
    () => mutateStore(
      store,
      "review:delete",
      (signal) => deleteCreatorMarketplaceReview(resourceId, signal),
    ),
    [resourceId, store],
  );
  const toggleReviewHelpful = useCallback(
    (reviewId: string) => mutateStore(
      store,
      `review:${reviewId}:helpful`,
      (signal) => toggleCreatorMarketplaceReviewHelpful(
        resourceId,
        reviewId,
        signal,
      ),
    ),
    [resourceId, store],
  );
  const isPending = useCallback(
    (actionPrefix?: string) => Boolean(
      snapshot.pendingAction
      && (!actionPrefix || snapshot.pendingAction.startsWith(actionPrefix)),
    ),
    [snapshot.pendingAction],
  );

  return {
    ...snapshot,
    refresh,
    createComment,
    deleteComment,
    toggleCommentLike,
    saveReview,
    deleteReview,
    toggleReviewHelpful,
    isPending,
  };
}

export function getMarketSocialStoreCountForTests(): number {
  return stores.size;
}

export function resetMarketSocialStoresForTests(): void {
  for (const store of [...stores.values()]) disposeStore(store);
  stores.clear();
  broadcastChannel?.close();
  broadcastChannel = undefined;
}
