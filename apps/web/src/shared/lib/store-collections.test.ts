// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginCollectionMerge,
  completeCollectionMerge,
} from "./collection-write-through";
import {
  claimGuestCollectionsForOwner,
  discardGuestCollectionRecovery,
  replayPendingCollectionWrites,
  useApp,
} from "./store";
import { useToastStore } from "./toast-store";

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function resetStore() {
  useApp.setState({
    ratings: {},
    reviews: {},
    reads: {},
    likedReviews: {},
    subscriptions: {},
    collections: [],
    collectionOutbox: [],
    userId: null,
    sessionToken: null,
    libraryOwnerId: null,
    libraryMergeOwnerId: null,
    authGeneration: 0,
    collectionRevision: 0,
  });
  useToastStore.setState({ toasts: [] });
}

describe("collection store write-through", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetStore();
  });

  it("uses one canonical UUID and sends create → set → rename → delete in FIFO order", async () => {
    const createGate = deferredResponse();
    const commands: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body)) as Record<string, unknown>;
      commands.push(command);
      if (command.action === "create") return createGate.promise;
      return response({ ok: true, ...command });
    });
    vi.stubGlobal("fetch", fetchMock);
    useApp.getState().setSessionIdentity("owner-1", "session-1");

    const id = useApp.getState().createCollection(" 컬렉션 ", "📚");
    useApp.getState().toggleInCollection(id, "title-1");
    useApp.getState().renameCollection(id, "이름 변경");
    useApp.getState().deleteCollection(id);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(commands[0]).toEqual({
      action: "create",
      id,
      name: "컬렉션",
      emoji: "📚",
    });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);

    createGate.resolve(response({ ok: true, id, created: true }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(commands).toEqual([
      { action: "create", id, name: "컬렉션", emoji: "📚" },
      { action: "set-item", id, titleId: "title-1", included: true },
      { action: "rename", id, name: "이름 변경" },
      { action: "delete", id },
    ]);
    expect(fetchMock.mock.calls.every(([, init]) =>
      new Headers(init?.headers).get("x-user-id") === "session-1"
    )).toBe(true);
    expect(fetchMock.mock.calls.every(([, init]) =>
      new Headers(init?.headers).get("x-toonspectrum-csrf") === "1"
    )).toBe(true);
    expect(useApp.getState().collections).toEqual([]);
  });

  it("keeps guest collections local and never calls the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const id = useApp.getState().createCollection("게스트", "📚");
    useApp.getState().toggleInCollection(id, "title-1");
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useApp.getState().collections[0]?.titleIds).toEqual(["title-1"]);
  });

  it("does not create an empty collection through direct store calls", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    useApp.getState().setSessionIdentity("owner-1", "session-1");

    expect(useApp.getState().createCollection("   ", "📚")).toBe("");
    expect(useApp.getState().collections).toEqual([]);
    expect(useApp.getState().collectionOutbox).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries a transient create once and preserves the local collection when offline", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    useApp.getState().setSessionIdentity("owner-1", "session-1");

    const id = useApp.getState().createCollection("오프라인", "📚");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(useApp.getState().collections.some((collection) => collection.id === id)).toBe(true);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain("대기열에 보관");
    expect(useApp.getState().collectionOutbox).toHaveLength(1);
  });

  it("persists a transient command and drains it after connectivity returns", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    useApp.getState().setSessionIdentity("owner-replay", "session-1");
    const id = useApp.getState().createCollection("재시도", "📚");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(useApp.getState().collectionOutbox).toHaveLength(1);

    const partialize = useApp.persist.getOptions().partialize;
    const persisted = partialize?.(useApp.getState()) as Record<string, unknown>;
    expect(persisted.collectionOutbox).toEqual(useApp.getState().collectionOutbox);

    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return response({ ok: true, ...command });
    });
    await replayPendingCollectionWrites({
      userId: "owner-replay",
      sessionToken: "session-1",
      generation: useApp.getState().authGeneration,
    });

    expect(useApp.getState().collectionOutbox).toEqual([]);
    expect(useApp.getState().collections[0]?.id).toBe(id);
  });

  it("rolls back only the failed collection when another lane has a newer edit", async () => {
    const firstGate = deferredResponse();
    const commands: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body)) as Record<string, unknown>;
      commands.push(command);
      return command.id === "collection-a"
        ? firstGate.promise
        : response({ ok: true, ...command });
    });
    vi.stubGlobal("fetch", fetchMock);
    useApp.getState().setSessionIdentity("owner-lanes", "session-1");
    useApp.setState({
      libraryOwnerId: "owner-lanes",
      collections: [
        { id: "collection-a", name: "A", emoji: "📚", titleIds: [], createdAt: "2026-01-01" },
        { id: "collection-b", name: "B", emoji: "📚", titleIds: [], createdAt: "2026-01-01" },
      ],
    });

    useApp.getState().renameCollection("collection-a", "A 실패");
    useApp.getState().renameCollection("collection-b", "B 성공");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    firstGate.resolve(response({ message: "invalid" }, 400));
    await vi.waitFor(() => expect(useApp.getState().collectionOutbox).toHaveLength(0));

    expect(commands.map((command) => command.id)).toEqual(
      expect.arrayContaining(["collection-a", "collection-b"])
    );
    expect(useApp.getState().collections.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "collection-a", name: "A" },
      { id: "collection-b", name: "B 성공" },
    ]);
  });

  it("keeps same-account FIFO ordering across a session token rotation", async () => {
    const createGate = deferredResponse();
    const headers: string[] = [];
    const commands: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body)) as Record<string, unknown>;
      commands.push(command);
      headers.push(new Headers(init?.headers).get("x-user-id") ?? "");
      return command.action === "create"
        ? createGate.promise
        : response({ ok: true, ...command });
    });
    vi.stubGlobal("fetch", fetchMock);
    useApp.getState().setSessionIdentity("owner-rotate", "session-old");
    const id = useApp.getState().createCollection("토큰", "📚");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    useApp.getState().setSessionIdentity("owner-rotate", "session-new");
    useApp.getState().renameCollection(id, "새 토큰");
    createGate.resolve(response({ ok: true, id, created: true }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(commands.map((command) => command.action)).toEqual(["create", "rename"]);
    expect(headers).toEqual(["session-old", "session-new"]);
  });

  it("retries an old-token 401 with the rotated token instead of deleting the outbox", async () => {
    const oldRequest = deferredResponse();
    const headers: string[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      headers.push(new Headers(init?.headers).get("x-user-id") ?? "");
      const command = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return headers.length === 1
        ? oldRequest.promise
        : response({ ok: true, ...command });
    });
    vi.stubGlobal("fetch", fetchMock);
    useApp.getState().setSessionIdentity("owner-auth-rotate", "session-old");
    useApp.setState({
      libraryOwnerId: "owner-auth-rotate",
      collections: [{
        id: "collection-auth-rotate",
        name: "이전 이름",
        emoji: "📚",
        titleIds: [],
        createdAt: "2026-07-20T00:00:00.000Z",
      }],
    });

    useApp.getState().renameCollection("collection-auth-rotate", "새 이름");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    useApp.getState().setSessionIdentity("owner-auth-rotate", "session-new");
    oldRequest.resolve(response({ message: "expired" }, 401));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(headers).toEqual(["session-old", "session-new"]);
    expect(useApp.getState().collectionOutbox).toEqual([]);
    expect(useApp.getState().collections[0]?.name).toBe("새 이름");
  });

  it("keeps another account's command durable without sending its captured token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    useApp.getState().setSessionIdentity("owner-a-deferred", "session-a");
    useApp.setState({
      libraryOwnerId: "owner-a-deferred",
      collections: [{
        id: "collection-a-deferred",
        name: "A 이름",
        emoji: "📚",
        titleIds: [],
        createdAt: "2026-07-20T00:00:00.000Z",
      }],
    });
    const fence = {
      userId: "owner-a-deferred",
      sessionToken: "session-a",
      generation: useApp.getState().authGeneration,
    };
    const merge = beginCollectionMerge(fence);

    useApp.getState().renameCollection("collection-a-deferred", "A 대기");
    useApp.getState().setSessionIdentity("owner-b-current", "session-b");
    completeCollectionMerge(merge, {});
    await replayPendingCollectionWrites(fence);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toEqual([]);
    expect(useApp.getState().collectionOutbox).toHaveLength(1);
    expect(useApp.getState().collectionOutbox[0]?.ownerId).toBe("owner-a-deferred");
  });

  it("removes a rejected optimistic create even when dependent commands were already queued", async () => {
    const commands: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      commands.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return response({ message: "invalid" }, 400);
    });
    vi.stubGlobal("fetch", fetchMock);
    useApp.getState().setSessionIdentity("owner-1", "session-1");

    const id = useApp.getState().createCollection("거절", "📚");
    useApp.getState().toggleInCollection(id, "title-1");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(commands.map((command) => command.action)).toEqual(["create", "set-item"]);
    expect(useApp.getState().collections.some((collection) => collection.id === id)).toBe(false);
  });

  it("fences late callbacks and clears the previous account projection on identity change", async () => {
    const gate = deferredResponse();
    const fetchMock = vi.fn(() => gate.promise);
    vi.stubGlobal("fetch", fetchMock);
    useApp.getState().setSessionIdentity("owner-a", "session-a");
    useApp.getState().createCollection("A 전용", "📚");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    useApp.getState().setSessionIdentity("owner-b", "session-b");
    expect(useApp.getState().collections).toEqual([]);
    gate.resolve(response({ message: "rejected" }, 400));
    await Promise.resolve();
    await Promise.resolve();

    expect(useApp.getState().userId).toBe("owner-b");
    expect(useApp.getState().collections).toEqual([]);
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("does not persist duplicate auth credentials in the local library snapshot", () => {
    useApp.getState().setSessionIdentity("owner-1", "secret-session-token");
    const partialize = useApp.persist.getOptions().partialize;
    const persisted = partialize?.(useApp.getState()) as Record<string, unknown>;

    expect(persisted).not.toHaveProperty("userId");
    expect(persisted).not.toHaveProperty("sessionToken");
    expect(persisted).not.toHaveProperty("authGeneration");
    expect(persisted).not.toHaveProperty("collectionRevision");
    expect(persisted).toHaveProperty("collectionOutbox");
    expect(persisted).toHaveProperty("libraryMergeOwnerId");
  });

  it("migrates an old persisted user ID into a non-secret ownership marker", () => {
    const merge = useApp.persist.getOptions().merge;
    const merged = merge?.({
      userId: "legacy-owner",
      sessionToken: "legacy-secret",
      collections: [{
        id: "seed-col-1",
        name: "이전 서재",
        emoji: "📚",
        titleIds: [],
        createdAt: "2026-07-20T00:00:00.000Z",
      }],
    }, useApp.getState()) as ReturnType<typeof useApp.getState>;

    expect(merged.userId).toBeNull();
    expect(merged.sessionToken).toBeNull();
    expect(merged.libraryOwnerId).toBe("legacy-owner");
    expect(merged.collections[0]?.id).toBe("seed-col-1");
  });

  it("upgrades legacy guest collection IDs to canonical UUIDs during hydration", () => {
    const merge = useApp.persist.getOptions().merge;
    const merged = merge?.({
      libraryOwnerId: null,
      collections: [{
        id: "legacy-local-id",
        name: "게스트 서재",
        emoji: "📚",
        titleIds: [],
        createdAt: "2026-07-20T00:00:00.000Z",
      }],
    }, useApp.getState()) as ReturnType<typeof useApp.getState>;

    expect(merged.collections[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    );
  });

  it("lowercases valid guest UUIDs and remaps their persisted outbox references", () => {
    const uppercaseId = "550E8400-E29B-41D4-A716-446655440000";
    const canonicalId = uppercaseId.toLowerCase();
    const merge = useApp.persist.getOptions().merge;
    const merged = merge?.({
      libraryOwnerId: null,
      libraryMergeOwnerId: "owner-a",
      collections: [{
        id: uppercaseId,
        name: "대문자 UUID",
        emoji: "📚",
        titleIds: [],
        createdAt: "2026-07-20T00:00:00.000Z",
      }],
      collectionOutbox: [{
        mutationId: "mutation-uppercase",
        ownerId: "owner-a",
        command: { action: "rename", id: uppercaseId, name: "변경" },
        rollback: { kind: "rename", previousName: "대문자 UUID", attemptedName: "변경" },
      }],
    }, useApp.getState()) as ReturnType<typeof useApp.getState>;

    expect(merged.collections[0]?.id).toBe(canonicalId);
    expect(merged.collectionOutbox[0]?.command.id).toBe(canonicalId);
  });

  it("does not merge a failed guest-claim projection into a different account", () => {
    useApp.setState({
      libraryOwnerId: null,
      libraryMergeOwnerId: "owner-a",
      collections: [{
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "A 병합 대기",
        emoji: "📚",
        titleIds: [],
        createdAt: "2026-07-20T00:00:00.000Z",
      }],
    });

    useApp.getState().setSessionIdentity("owner-b", "session-b");

    expect(useApp.getState().collections).toEqual([]);
    expect(useApp.getState().libraryMergeOwnerId).toBeNull();
  });

  it("rebuilds a claimed guest collection after an account switch", async () => {
    const commands: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body)) as Record<string, unknown>;
      commands.push(command);
      return response({ ok: true, ...command });
    }));
    const collectionId = "550e8400-e29b-41d4-a716-446655440000";
    useApp.setState({
      collections: [{
        id: collectionId,
        name: "복구할 게스트",
        emoji: "📚",
        titleIds: ["title-recovery"],
        createdAt: "2026-07-20T00:00:00.000Z",
      }],
    });
    const fence = { userId: "owner-recovery", sessionToken: "session-a", generation: 1 };
    claimGuestCollectionsForOwner(fence);

    expect(useApp.getState().collectionOutbox.map((entry) => entry.command.action))
      .toEqual(["create", "set-item"]);
    useApp.getState().setSessionIdentity("owner-b", "session-b");
    expect(useApp.getState().collections).toEqual([]);
    expect(useApp.getState().collectionOutbox).toHaveLength(2);
    discardGuestCollectionRecovery("owner-recovery", {});
    expect(useApp.getState().collectionOutbox).toHaveLength(2);

    useApp.getState().setSessionIdentity("owner-recovery", "session-a-new");
    await replayPendingCollectionWrites({
      userId: "owner-recovery",
      sessionToken: "session-a-new",
      generation: useApp.getState().authGeneration,
    });

    expect(commands).toEqual([
      { action: "create", id: collectionId, name: "복구할 게스트", emoji: "📚" },
      { action: "set-item", id: collectionId, titleId: "title-recovery", included: true },
    ]);
    expect(useApp.getState().collectionOutbox).toEqual([]);
  });

  it("remaps both the optimistic projection and durable outbox after guest merge", () => {
    const guestId = "550e8400-e29b-41d4-a716-446655440000";
    const serverId = "seed-col-existing";
    useApp.setState({
      userId: "owner-map",
      sessionToken: "session-map",
      libraryOwnerId: null,
      collections: [{
        id: guestId,
        name: "공유 이름",
        emoji: "📚",
        titleIds: [],
        createdAt: "2026-07-20T00:00:00.000Z",
      }],
      collectionOutbox: [{
        mutationId: "mutation-1",
        ownerId: "owner-map",
        command: { action: "rename", id: guestId, name: "병합 뒤 이름" },
        rollback: { kind: "rename", previousName: "공유 이름", attemptedName: "병합 뒤 이름" },
      }],
    });

    useApp.getState().hydrateFromServer({
      ratings: {},
      reads: {},
      subscriptions: {},
      reviews: {},
      likedReviews: {},
      collections: [
        {
          id: "server-existing-other",
          name: "기존 서버 컬렉션",
          emoji: "⭐",
          titleIds: [],
          createdAt: "2026-07-19T00:00:00.000Z",
        },
        {
          id: serverId,
          name: "공유 이름",
          emoji: "📚",
          titleIds: [],
          createdAt: "2026-07-20T00:00:00.000Z",
        },
      ],
      collectionIdMap: { [guestId]: serverId },
    }, {
      preserveCollections: true,
      ownerId: "owner-map",
      collectionIdMap: { [guestId]: serverId },
    });

    expect(useApp.getState().collections.map((collection) => collection.id)).toEqual([
      "server-existing-other",
      serverId,
    ]);
    expect(useApp.getState().collections[1]?.name).toBe("병합 뒤 이름");
    expect(useApp.getState().collectionOutbox[0]?.command.id).toBe(serverId);
  });

  it("holds an in-flight edit behind guest merge and reuses the remapped ID on retry", async () => {
    const guestId = "550e8400-e29b-41d4-a716-446655440000";
    const serverId = "server-collision-remap";
    const sentIds: string[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body)) as Record<string, unknown>;
      sentIds.push(String(command.id));
      if (sentIds.length === 1) throw new TypeError("temporary offline");
      return response({ ok: true, ...command });
    });
    vi.stubGlobal("fetch", fetchMock);
    useApp.getState().setSessionIdentity("owner-merge-barrier", "session-1");
    useApp.setState({
      collections: [{
        id: guestId,
        name: "병합 전",
        emoji: "📚",
        titleIds: [],
        createdAt: "2026-07-20T00:00:00.000Z",
      }],
    });
    const fence = {
      userId: "owner-merge-barrier",
      sessionToken: "session-1",
      generation: useApp.getState().authGeneration,
    };
    const merge = beginCollectionMerge(fence);

    useApp.getState().renameCollection(guestId, "병합 뒤");
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();

    useApp.getState().hydrateFromServer({
      ratings: {},
      reads: {},
      subscriptions: {},
      reviews: {},
      likedReviews: {},
      collections: [{
        id: serverId,
        name: "병합 전",
        emoji: "📚",
        titleIds: [],
        createdAt: "2026-07-20T00:00:00.000Z",
      }],
    }, {
      preserveCollections: true,
      ownerId: fence.userId,
      collectionIdMap: { [guestId]: serverId },
    });
    completeCollectionMerge(merge, { [guestId]: serverId });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(sentIds).toEqual([serverId, serverId]);
    expect(useApp.getState().collections[0]?.id).toBe(serverId);
    expect(useApp.getState().collectionOutbox).toEqual([]);
  });

  it("preserves a pending optimistic projection against an older server hydration", async () => {
    const gate = deferredResponse();
    vi.stubGlobal("fetch", vi.fn(() => gate.promise));
    useApp.getState().setSessionIdentity("owner-1", "session-1");
    const id = useApp.getState().createCollection("진행 중", "📚");
    const revision = useApp.getState().collectionRevision;

    useApp.getState().hydrateFromServer({
      ratings: {},
      reads: {},
      subscriptions: {},
      reviews: {},
      likedReviews: {},
      collections: [],
    }, {
      collectionRevision: revision,
      preserveCollections: true,
      ownerId: "owner-1",
    });

    expect(useApp.getState().collections.map((collection) => collection.id)).toEqual([id]);
    expect(useApp.getState().libraryOwnerId).toBe("owner-1");
    gate.resolve(response({ ok: true, id, created: true }));
    await vi.waitFor(() => expect(useApp.getState().collectionOutbox).toEqual([]));
  });

  it("keeps the local projection when an explicitly stale snapshot reaches hydration", () => {
    useApp.setState({
      userId: "owner-stale-get",
      sessionToken: "session-stale-get",
      libraryOwnerId: "owner-stale-get",
      collectionRevision: 3,
      collectionOutbox: [],
      collections: [{
        id: "edited-collection",
        name: "방금 저장한 이름",
        emoji: "📚",
        titleIds: [],
        createdAt: "2026-07-20T00:00:00.000Z",
      }],
    });

    useApp.getState().hydrateFromServer({
      ratings: {},
      reads: {},
      subscriptions: {},
      reviews: {},
      likedReviews: {},
      collections: [
        {
          id: "edited-collection",
          name: "느린 스냅샷 이름",
          emoji: "📚",
          titleIds: [],
          createdAt: "2026-07-20T00:00:00.000Z",
        },
        {
          id: "remote-new",
          name: "다른 기기 컬렉션",
          emoji: "⭐",
          titleIds: [],
          createdAt: "2026-07-20T00:00:00.000Z",
        },
      ],
    }, {
      ownerId: "owner-stale-get",
      collectionRevision: 2,
    });

    expect(useApp.getState().collections.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "edited-collection", name: "방금 저장한 이름" },
    ]);
  });
});
