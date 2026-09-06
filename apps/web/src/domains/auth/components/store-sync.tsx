import { useEffect } from "react";

import type { CollectionMergeHandle } from "@/shared/lib/collection-write-through";
import type { HydratePayload } from "@/shared/lib/store";

import {
  beginCollectionMerge,
  clearCollectionMergeBarrier,
  completeCollectionMerge,
  failCollectionMerge,
} from "@/shared/lib/collection-write-through";
import { withCsrfProtection } from "@/shared/lib/csrf";
import {
  captureCollectionHydrationFence,
  claimGuestCollectionsForOwner,
  collectionMergeCollectionsForOwner,
  discardGuestCollectionRecovery,
  isCollectionAuthFenceCurrent,
  replayPendingCollectionWrites,
  useApp,
  useHydrated,
} from "@/shared/lib/store";
import { useSession } from "@/src/compat/auth-session-store";

// 세션 ↔ 스토어 동기화: 로그인 시 userId 설정 + DB 데이터 하이드레이션, 로그아웃 시 해제
export function StoreSync() {
  const { data: session, status } = useSession();
  const hydrated = useHydrated();
  const setSessionIdentity = useApp((s) => s.setSessionIdentity);
  const hydrate = useApp((s) => s.hydrateFromServer);
  const uid = session?.user?.id;
  const token = session?.token ?? null;

  useEffect(() => {
    // persist 복원 후에만 — 게스트 로컬 데이터가 스토어에 올라온 뒤 병합해야 손실이 없다.
    if (!hydrated) return;

    const controller = new AbortController();
    let activeMerge: CollectionMergeHandle | null = null;
    let running = false;
    let rerunRequested = false;
    let retryDelayMs = 1_000;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const syncRequestTimeoutMs = 15_000;

    type SyncJsonResult<T> =
      | { ok: true; response: Response; data: T }
      | { ok: false; response: Response; data: null };

    async function fetchSyncJson<T>(
      input: RequestInfo | URL,
      init: RequestInit
    ): Promise<SyncJsonResult<T>> {
      const attemptController = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let rejectOnCleanup: ((error: Error) => void) | undefined;
      const abortAttempt = () => {
        attemptController.abort();
        const error = new Error("컬렉션 동기화 요청이 중단되었습니다.");
        error.name = "AbortError";
        rejectOnCleanup?.(error);
      };
      controller.signal.addEventListener("abort", abortAttempt, { once: true });
      try {
        const timeoutRequest = new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            attemptController.abort();
            reject(new Error("컬렉션 동기화 서버 응답 시간이 초과되었습니다."));
          }, syncRequestTimeoutMs);
        });
        const cleanupRequest = new Promise<never>((_resolve, reject) => {
          rejectOnCleanup = reject;
          if (controller.signal.aborted) abortAttempt();
        });
        const request = (async (): Promise<SyncJsonResult<T>> => {
          const response = await fetch(input, withCsrfProtection({
            ...init,
            signal: attemptController.signal,
          }));
          if (!response.ok) return { ok: false, response, data: null };
          const data = await response.json() as T;
          return { ok: true, response, data };
        })();
        return await Promise.race([
          request,
          timeoutRequest,
          cleanupRequest,
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
        rejectOnCleanup = undefined;
        controller.signal.removeEventListener("abort", abortAttempt);
      }
    }

    const clearRetryTimer = () => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
    };

    const scheduleRetry = () => {
      if (controller.signal.aborted || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        requestRun();
      }, retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, 30_000);
    };

    const markSyncHealthy = () => {
      clearRetryTimer();
      retryDelayMs = 1_000;
    };

    const run = async () => {
      if (running) return;
      running = true;
      try {
        if (status === "authenticated" && uid) {
          const beforeIdentity = useApp.getState();
          const ownerHasRecovery = beforeIdentity.collectionOutbox.some(
            (entry) => entry.ownerId === uid && entry.recovery === true
          );
          const mergeGuestLibrary =
            ownerHasRecovery ||
            (beforeIdentity.libraryOwnerId === null &&
              (beforeIdentity.libraryMergeOwnerId === null ||
                beforeIdentity.libraryMergeOwnerId === uid));
          setSessionIdentity(uid, token);
          const initialFence = captureCollectionHydrationFence();
          if (!initialFence) return;

          if (mergeGuestLibrary) {
            // Install the barrier before the first await. Collection commands produced while login
            // merge is running cannot escape with a guest UUID that the server had to remap.
            const mergeHandle = beginCollectionMerge(initialFence);
            activeMerge = mergeHandle;
            // Turn the guest collection graph into an owner-scoped recovery outbox before the
            // request starts. If login merge never reaches the server and the user switches
            // accounts, the original create/item dependencies can still be rebuilt later.
            claimGuestCollectionsForOwner(initialFence);
            const local = useApp.getState();
            const mergeCollections = collectionMergeCollectionsForOwner(initialFence.userId);
            try {
              const result = await fetchSyncJson<HydratePayload>("/api/me/merge", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(initialFence.sessionToken
                    ? { "x-user-id": initialFence.sessionToken }
                    : {}),
                },
                body: JSON.stringify({
                  ratings: local.ratings,
                  reads: local.reads,
                  subscriptions: local.subscriptions,
                  reviews: local.reviews,
                  likedReviews: local.likedReviews,
                  collections: mergeCollections,
                }),
              });
              if (!result.ok) {
                throw new Error(`컬렉션 병합 요청 실패 (${result.response.status})`);
              }
              const data = result.data;
              if (controller.signal.aborted || !isCollectionAuthFenceCurrent(initialFence)) {
                throw new Error("세션이 변경되어 이전 컬렉션 병합 응답을 폐기했습니다.");
              }
              const collectionIdMap = data.collectionIdMap ?? {};
              discardGuestCollectionRecovery(initialFence.userId, collectionIdMap);
              hydrate(data, {
                collectionRevision: initialFence.collectionRevision,
                // Recovery commands represented in this merge response were removed above;
                // any genuinely newer edit is still in the owner outbox and is rebased by hydrate.
                preserveCollections: false,
                ownerId: initialFence.userId,
                collectionIdMap,
              });
              completeCollectionMerge(mergeHandle, collectionIdMap);
              if (activeMerge === mergeHandle) activeMerge = null;
              markSyncHealthy();

              const replayFence = captureCollectionHydrationFence();
              if (replayFence && replayFence.userId === initialFence.userId) {
                await replayPendingCollectionWrites(replayFence);
                if (useApp.getState().collectionOutbox.some(
                  (entry) => entry.ownerId === replayFence.userId
                )) {
                  scheduleRetry();
                }
              }
            } catch (error) {
              failCollectionMerge(mergeHandle, error);
              if (activeMerge === mergeHandle) activeMerge = null;
              if (!controller.signal.aborted) scheduleRetry();
            }
            return;
          }

          // Reloading an existing account first drains its durable local outbox, then requests a
          // fresh snapshot. If transport is still offline, hydration preserves that local projection.
          clearCollectionMergeBarrier(initialFence.userId);
          await replayPendingCollectionWrites(initialFence);
          if (!isCollectionAuthFenceCurrent(initialFence)) return;
          const hydrationFence = captureCollectionHydrationFence();
          if (!hydrationFence) return;
          try {
            const result = await fetchSyncJson<HydratePayload>("/api/me", {
              headers: hydrationFence.sessionToken
                ? { "x-user-id": hydrationFence.sessionToken }
                : undefined,
            });
            if (!result.ok) {
              scheduleRetry();
              return;
            }
            const data = result.data;
            if (!isCollectionAuthFenceCurrent(hydrationFence)) return;
            if (useApp.getState().collectionRevision !== hydrationFence.collectionRevision) {
              // A local command completed after this snapshot started. Applying the old response
              // could resurrect a deleted collection or overwrite an unrelated server edit, so
              // drain the lanes and fetch a new authoritative snapshot instead.
              rerunRequested = true;
              return;
            }
            hydrate(data, {
              collectionRevision: hydrationFence.collectionRevision,
              preserveCollections: hydrationFence.preserveCollections,
              ownerId: hydrationFence.userId,
            });
            markSyncHealthy();
            if (useApp.getState().collectionOutbox.some(
              (entry) => entry.ownerId === hydrationFence.userId
            )) {
              scheduleRetry();
            }
          } catch {
            // Offline snapshots remain usable; the next online event retries them.
            if (!controller.signal.aborted) scheduleRetry();
          }
        } else if (status === "unauthenticated") {
          setSessionIdentity(null, null);
        }
      } finally {
        running = false;
        if (rerunRequested && !controller.signal.aborted) {
          rerunRequested = false;
          clearRetryTimer();
          queueMicrotask(requestRun);
        }
      }
    };

    const requestRun = () => {
      if (controller.signal.aborted) return;
      if (running) {
        rerunRequested = true;
        return;
      }
      void run();
    };
    const handleOnline = () => {
      retryDelayMs = 1_000;
      clearRetryTimer();
      requestRun();
    };

    requestRun();
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
      clearRetryTimer();
      controller.abort();
      if (activeMerge) {
        failCollectionMerge(activeMerge, new Error("컬렉션 병합이 중단되었습니다."));
        activeMerge = null;
      }
    };
  }, [hydrated, status, uid, token, setSessionIdentity, hydrate]);

  return null;
}
