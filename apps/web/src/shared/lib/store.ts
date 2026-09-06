import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import {
  normalizeCollectionEmoji,
  normalizeCollectionName,
} from "./collection-contract";
import { addRecentSearch, removeRecentSearch } from "./recent-searches";
import { apiPost } from "./store-api-post";
import {
  canonicalizeGuestCollections,
  currentCollectionAuthFence,
  migrateGuestCollectionIds,
  newClientCollectionId,
  queueCollectionOutboxEntry,
  rebaseCollectionOutbox,
  remapCollection,
  remapOutboxEntry,
  sanitizeCollectionOutbox,
  appendOutboxEntry,
} from "./store-collection-logic";

import type { AppState, Collection, AppStore, CollectionOutboxEntry  } from "./store-types";

// Re-export public APIs to maintain backward compatibility
export * from "./store-types";
export * from "./store-collection-api";
export * from "./store-hooks";
export {
  isCollectionAuthFenceCurrent,
  replayPendingCollectionWrites,
  captureCollectionHydrationFence,
} from "./store-collection-logic";

const seedCollections: Collection[] = [];

export const useApp = (create<AppState>()(
  persist(
    (set, get) => ({
      ratings: {},
      reviews: {},
      reads: {},
      likedReviews: {},
      subscriptions: {},
      adultVerified: false,
      adultBirthdate: null,
      ageGateOpen: false,
      collections: seedCollections,
      collectionOutbox: [],
      recentlyViewed: [],
      recentSearches: [],
      ratingScale: "star",
      userId: null,
      sessionToken: null,
      libraryOwnerId: null,
      libraryMergeOwnerId: null,
      authGeneration: 0,
      collectionRevision: 0,

      setSessionIdentity: (userId, sessionToken) =>
        set((state) => {
          if (state.userId === userId && state.sessionToken === sessionToken) return state;
          const claimedLibraryOwner = state.libraryOwnerId ?? state.libraryMergeOwnerId;
          const ownerChanged =
            (state.userId !== null && state.userId !== userId) ||
            (claimedLibraryOwner !== null && claimedLibraryOwner !== userId);
          return {
            userId,
            sessionToken,
            authGeneration: state.authGeneration + 1,
            ...(ownerChanged
              ? {
                  ratings: {},
                  reviews: {},
                  reads: {},
                  likedReviews: {},
                  subscriptions: {},
                  collections: [],
                  libraryOwnerId: null,
                  libraryMergeOwnerId: null,
                  collectionRevision: state.collectionRevision + 1,
                }
              : {}),
          };
        }),
      // 서버를 진실원천으로 교체(replace). 게스트 데이터는 로그인 시 /api/me/merge 가 먼저 서버로
      // 병합하므로 여기서 덮어써도 손실이 없고, 다른 기기에서의 삭제·변경도 정확히 반영된다.
      hydrateFromServer: (d, options) =>
        set((state) => {
          const idMap = options?.collectionIdMap ?? d.collectionIdMap ?? {};
          const collectionOutbox = options?.ownerId
            ? state.collectionOutbox.map((entry) =>
                entry.ownerId === options.ownerId
                  ? remapOutboxEntry(entry, idMap)
                  : entry
              )
            : state.collectionOutbox;
          const ownerOutbox = options?.ownerId
            ? collectionOutbox.filter((entry) => entry.ownerId === options.ownerId)
            : [];
          const revisionChanged =
            options?.collectionRevision !== undefined &&
            options.collectionRevision !== state.collectionRevision;
          const collections = options?.ownerId
            ? ownerOutbox.length > 0
              ? rebaseCollectionOutbox(d.collections, collectionOutbox, options.ownerId)
              : options.preserveCollections === true || revisionChanged
                ? state.collections.map((collection) => remapCollection(collection, idMap))
                : d.collections
            : migrateGuestCollectionIds(d.collections);
          return {
            ratings: d.ratings,
            reads: d.reads,
            subscriptions: d.subscriptions,
            reviews: d.reviews,
            likedReviews: d.likedReviews,
            ...(options?.ownerId
              ? { libraryOwnerId: options.ownerId, libraryMergeOwnerId: null }
              : {}),
            // Rebase optimistic commands over the authoritative snapshot. Preserving the entire
            // local array would hide pre-existing server collections during a guest merge.
            collections,
            collectionOutbox,
          };
        }),

      setRating: (titleId, rating) => {
        set((s) => ({ ratings: { ...s.ratings, [titleId]: rating } }));
        if (get().userId) apiPost("/api/me/rating", { titleId, value: rating });
      },
      clearRating: (titleId) => {
        set((s) => {
          const next = { ...s.ratings };
          delete next[titleId];
          return { ratings: next };
        });
        if (get().userId) apiPost("/api/me/rating", { titleId, value: null });
      },
      setRead: (titleId, state) => {
        set((s) => {
          const next = { ...s.reads };
          if (state === null) delete next[titleId];
          else next[titleId] = state;
          return { reads: next };
        });
        if (get().userId) apiPost("/api/me/read", { titleId, state });
      },
      upsertReview: (review) => {
        set((s) => ({
          reviews: { ...s.reviews, [review.titleId]: review },
          ratings: { ...s.ratings, [review.titleId]: review.rating },
        }));
        if (get().userId)
          apiPost("/api/me/review", {
            titleId: review.titleId,
            rating: review.rating,
            text: review.text,
            tags: review.tags,
            spoiler: review.spoiler,
          });
      },
      deleteReview: (titleId) => {
        set((s) => {
          const next = { ...s.reviews };
          delete next[titleId];
          return { reviews: next };
        });
        if (get().userId) apiPost("/api/me/review", { titleId }, "DELETE");
      },
      toggleLikeReview: (reviewId) => {
        set((s) => ({
          likedReviews: { ...s.likedReviews, [reviewId]: !s.likedReviews[reviewId] },
        }));
        if (get().userId) apiPost("/api/me/review-like", { reviewId });
      },
      toggleSubscription: (titleId) => {
        set((s) => ({
          subscriptions: { ...s.subscriptions, [titleId]: !s.subscriptions[titleId] },
        }));
        if (get().userId) apiPost("/api/me/subscription", { titleId });
      },
      setAdultVerified: (adultVerified) => set({ adultVerified }),
      openAgeGate: () => set({ ageGateOpen: true }),
      closeAgeGate: () => set({ ageGateOpen: false }),
      // 스팀식 자가 연령 확인 — 생년월일로 만 나이 계산, ≥19세면 인증(브라우저 persist). 신원확인 아님.
      verifyAdultBirthdate: (iso) => {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return false;
        const now = new Date();
        let age = now.getFullYear() - d.getFullYear();
        const m = now.getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
        const ok = age >= 19;
        set((s) => ({ adultBirthdate: iso, adultVerified: ok, ageGateOpen: ok ? false : s.ageGateOpen }));
        return ok;
      },
      setRatingScale: (ratingScale) => set({ ratingScale }),

      createCollection: (name, emoji) => {
        const cleanName = normalizeCollectionName(name);
        if (!cleanName) return "";
        const id = newClientCollectionId();
        const cleanEmoji = normalizeCollectionEmoji(emoji);
        const fence = currentCollectionAuthFence();
        const outboxEntry: CollectionOutboxEntry | null = fence
          ? {
              mutationId: newClientCollectionId(),
              ownerId: fence.userId,
              command: { action: "create", id, name: cleanName, emoji: cleanEmoji },
              rollback: { kind: "create" },
            }
          : null;
        const revision = get().collectionRevision + 1;
        set((s) => ({
          collections: [
            ...s.collections,
            {
              id,
              name: cleanName,
              emoji: cleanEmoji,
              titleIds: [],
              createdAt: new Date().toISOString(),
            },
          ],
          collectionRevision: revision,
          ...(outboxEntry
            ? { collectionOutbox: appendOutboxEntry(s.collectionOutbox, outboxEntry) }
            : {}),
        }));
        if (fence && outboxEntry) queueCollectionOutboxEntry(fence, outboxEntry);
        return id;
      },
      addRecentlyViewed: (titleId) => {
        if (!titleId) return;
        set((s) => ({ recentlyViewed: [titleId, ...s.recentlyViewed.filter((id) => id !== titleId)].slice(0, 24) }));
      },
      clearRecentlyViewed: () => set({ recentlyViewed: [] }),
      // 최근 검색어 — 순수 헬퍼로 정규화·중복 제거·상한을 적용(부수효과 없음, 단위 테스트 가능).
      addRecentSearch: (query) =>
        set((s) => ({ recentSearches: addRecentSearch(s.recentSearches, query) })),
      removeRecentSearch: (query) =>
        set((s) => ({ recentSearches: removeRecentSearch(s.recentSearches, query) })),
      clearRecentSearches: () => set({ recentSearches: [] }),
      renameCollection: (id, name) => {
        const clean = normalizeCollectionName(name);
        const previous = get().collections.find((collection) => collection.id === id);
        if (!clean || !previous) return;
        if (previous.name === clean) return;
        const fence = currentCollectionAuthFence();
        const outboxEntry: CollectionOutboxEntry | null = fence
          ? {
              mutationId: newClientCollectionId(),
              ownerId: fence.userId,
              command: { action: "rename", id, name: clean },
              rollback: {
                kind: "rename",
                previousName: previous.name,
                attemptedName: clean,
              },
            }
          : null;
        const revision = get().collectionRevision + 1;
        set((s) => ({
          collections: s.collections.map((c) => (c.id === id ? { ...c, name: clean } : c)),
          collectionRevision: revision,
          ...(outboxEntry
            ? { collectionOutbox: appendOutboxEntry(s.collectionOutbox, outboxEntry) }
            : {}),
        }));
        if (fence && outboxEntry) queueCollectionOutboxEntry(fence, outboxEntry);
      },
      deleteCollection: (id) => {
        const index = get().collections.findIndex((collection) => collection.id === id);
        if (index < 0) return;
        const deleted = get().collections[index];
        if (!deleted) return;
        const fence = currentCollectionAuthFence();
        const outboxEntry: CollectionOutboxEntry | null = fence
          ? {
              mutationId: newClientCollectionId(),
              ownerId: fence.userId,
              command: { action: "delete", id },
              rollback: { kind: "delete", collection: deleted, index },
            }
          : null;
        const revision = get().collectionRevision + 1;
        set((s) => ({
          collections: s.collections.filter((c) => c.id !== id),
          collectionRevision: revision,
          ...(outboxEntry
            ? { collectionOutbox: appendOutboxEntry(s.collectionOutbox, outboxEntry) }
            : {}),
        }));
        if (fence && outboxEntry) queueCollectionOutboxEntry(fence, outboxEntry);
      },
      toggleInCollection: (collectionId, titleId) => {
        const previous = get().collections.find((collection) => collection.id === collectionId);
        if (!previous) return;
        const included = !previous.titleIds.includes(titleId);
        const fence = currentCollectionAuthFence();
        const outboxEntry: CollectionOutboxEntry | null = fence
          ? {
              mutationId: newClientCollectionId(),
              ownerId: fence.userId,
              command: {
                action: "set-item",
                id: collectionId,
                titleId,
                included,
              },
              rollback: {
                kind: "set-item",
                titleId,
                previousIncluded: !included,
                intendedIncluded: included,
              },
            }
          : null;
        const revision = get().collectionRevision + 1;
        set((s) => ({
          collections: s.collections.map((c) => {
            if (c.id !== collectionId) return c;
            return {
              ...c,
              titleIds: included
                ? [...c.titleIds.filter((t) => t !== titleId), titleId]
                : c.titleIds.filter((t) => t !== titleId),
            };
          }),
          collectionRevision: revision,
          ...(outboxEntry
            ? { collectionOutbox: appendOutboxEntry(s.collectionOutbox, outboxEntry) }
            : {}),
        }));
        if (fence && outboxEntry) queueCollectionOutboxEntry(fence, outboxEntry);
      },

      resetAll: () =>
        set({
          ratings: {},
          reviews: {},
          reads: {},
          likedReviews: {},
          subscriptions: {},
          collections: seedCollections,
          collectionOutbox: [],
          collectionRevision: get().collectionRevision + 1,
          recentlyViewed: [],
          recentSearches: [],
        }),
    }),
    {
      name: "toonspectrum-store",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({
        ratings: state.ratings,
        reviews: state.reviews,
        reads: state.reads,
        likedReviews: state.likedReviews,
        subscriptions: state.subscriptions,
        adultVerified: state.adultVerified,
        adultBirthdate: state.adultBirthdate,
        libraryOwnerId: state.libraryOwnerId,
        libraryMergeOwnerId: state.libraryMergeOwnerId,
        collections: state.collections,
        collectionOutbox: state.collectionOutbox,
        recentlyViewed: state.recentlyViewed,
        recentSearches: state.recentSearches,
        ratingScale: state.ratingScale,
      }),
      // Older v1 snapshots included auth fields because partialize was absent. Merge only the
      // intended local-library data so a stale token can never be revived from this second store.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<AppState>;
        const libraryOwnerId =
          saved.libraryOwnerId ??
          (typeof saved.userId === "string" ? saved.userId : current.libraryOwnerId);
        const savedCollections = saved.collections ?? current.collections;
        const canonicalGuest = libraryOwnerId === null
          ? canonicalizeGuestCollections(savedCollections)
          : { collections: savedCollections, idMap: {} };
        const savedOutbox = sanitizeCollectionOutbox(saved.collectionOutbox).map((entry) =>
          remapOutboxEntry(entry, canonicalGuest.idMap)
        );
        return {
          ...current,
          ratings: saved.ratings ?? current.ratings,
          reviews: saved.reviews ?? current.reviews,
          reads: saved.reads ?? current.reads,
          likedReviews: saved.likedReviews ?? current.likedReviews,
          subscriptions: saved.subscriptions ?? current.subscriptions,
          adultVerified: saved.adultVerified ?? current.adultVerified,
          adultBirthdate: saved.adultBirthdate ?? current.adultBirthdate,
          libraryOwnerId,
          libraryMergeOwnerId:
            typeof saved.libraryMergeOwnerId === "string"
              ? saved.libraryMergeOwnerId
              : null,
          collections: canonicalGuest.collections,
          collectionOutbox: savedOutbox,
          recentlyViewed: saved.recentlyViewed ?? current.recentlyViewed,
          recentSearches: saved.recentSearches ?? current.recentSearches,
          ratingScale: saved.ratingScale ?? current.ratingScale,
          userId: null,
          sessionToken: null,
          authGeneration: 0,
          collectionRevision: 0,
        };
      },
    }
  )
)) as unknown as AppStore;
