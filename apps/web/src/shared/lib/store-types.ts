import type {
  CollectionCommand,
  CollectionIdMap,
  CollectionAuthFence,
} from "./collection-write-through";
import type { ReadState, UserReview } from "./types";
import type { StoreApi, UseBoundStore } from "zustand";

export interface HydratePayload {
  ratings: Record<string, number>;
  reads: Record<string, ReadState>;
  subscriptions: Record<string, boolean>;
  reviews: Record<string, UserReview>;
  likedReviews: Record<string, boolean>;
  collections: Collection[];
  collectionIdMap?: CollectionIdMap;
}

export type RatingScale = "star" | "ten" | "hundred";

export interface Collection {
  id: string;
  name: string;
  emoji: string;
  titleIds: string[];
  createdAt: string;
}

export type CollectionRollback =
  | { kind: "create" }
  | { kind: "rename"; previousName: string; attemptedName: string }
  | { kind: "delete"; collection: Collection; index: number }
  | {
      kind: "set-item";
      titleId: string;
      previousIncluded: boolean;
      intendedIncluded: boolean;
    };

export interface CollectionOutboxEntry {
  mutationId: string;
  ownerId: string;
  command: CollectionCommand;
  rollback: CollectionRollback;
  recovery?: true;
}

export interface HydrateOptions {
  /** Collection revision captured before a server request started. */
  collectionRevision?: number;
  /** A request started while optimistic collection writes were still in flight. */
  preserveCollections?: boolean;
  /** Authenticated owner of a server snapshot. Omitted for an explicit local import. */
  ownerId?: string;
  /** Guest UUIDs remapped by the server because of an existing global ID collision. */
  collectionIdMap?: CollectionIdMap;
}

export interface AppState {
  ratings: Record<string, number>; // titleId -> 0.5~5
  reviews: Record<string, UserReview>; // titleId -> review
  reads: Record<string, ReadState>; // titleId -> 상태
  likedReviews: Record<string, boolean>; // reviewId -> liked
  subscriptions: Record<string, boolean>; // titleId -> 연재 알림 구독
  adultVerified: boolean; // 성인(만 19세+) — 생년월일 게이트로 설정(브라우저 저장)
  adultBirthdate: string | null; // 입력한 생년월일(ISO). 한번 입력하면 유지.
  ageGateOpen: boolean; // 연령 확인 모달 표시 여부
  collections: Collection[];
  collectionOutbox: CollectionOutboxEntry[]; // 계정별 서버 동기화 대기열(세션 토큰 미포함)
  recentlyViewed: string[]; // 최근 본 작품 titleId (최신순, 브라우저 저장)
  addRecentlyViewed: (titleId: string) => void;
  clearRecentlyViewed: () => void;
  recentSearches: string[]; // 최근 검색어(최신순, 브라우저 저장) — 검색 입력이 비었을 때 빠른 복귀
  addRecentSearch: (query: string) => void;
  removeRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;
  ratingScale: RatingScale;
  userId: string | null; // 로그인 사용자 (있으면 DB write-through)
  sessionToken: string | null; // 탭에 남은 레거시 헤더 토큰(null이면 HttpOnly 쿠키 인증)
  libraryOwnerId: string | null; // 서버 서재 snapshot 소유자(null이면 게스트 로컬 데이터)
  libraryMergeOwnerId: string | null; // 실패한 게스트 병합을 다른 계정으로 보내지 않는 durable claim
  authGeneration: number; // 계정 전환 뒤 늦은 응답이 새 계정 상태에 적용되지 않도록 하는 fence
  collectionRevision: number; // 낙관적 컬렉션 변경과 서버 hydrate의 순서를 비교하는 fence
  setSessionIdentity: (id: string | null, token: string | null) => void;
  hydrateFromServer: (data: HydratePayload, options?: HydrateOptions) => void;

  setRating: (titleId: string, rating: number) => void;
  clearRating: (titleId: string) => void;
  setRead: (titleId: string, state: ReadState | null) => void;
  upsertReview: (review: UserReview) => void;
  deleteReview: (titleId: string) => void;
  toggleLikeReview: (reviewId: string) => void;
  toggleSubscription: (titleId: string) => void;
  setAdultVerified: (v: boolean) => void;
  verifyAdultBirthdate: (iso: string) => boolean; // ≥19세면 true + 인증 저장
  openAgeGate: () => void;
  closeAgeGate: () => void;
  setRatingScale: (s: RatingScale) => void;

  createCollection: (name: string, emoji: string) => string;
  renameCollection: (id: string, name: string) => void;
  deleteCollection: (id: string) => void;
  toggleInCollection: (collectionId: string, titleId: string) => void;

  resetAll: () => void;
}

export interface AppStore extends UseBoundStore<StoreApi<AppState>> {
  persist: {
    hasHydrated: () => boolean;
    onFinishHydration: (cb: (state: AppState) => void) => () => void;
    onHydrate?: (cb: (state: AppState) => void) => () => void;
    getOptions: () => {
      partialize?: (state: AppState) => unknown;
      merge?: (persistedState: unknown, currentState: AppState) => AppState;
      [key: string]: unknown;
    };
    rehydrate: () => Promise<void> | void;
    clearStorage: () => void;
    setOptions: (options: unknown) => void;
  };
}

export interface CollectionHydrationFence extends CollectionAuthFence {
  collectionRevision: number;
  preserveCollections: boolean;
}
