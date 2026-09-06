// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreSync } from "./store-sync";

import { useApp } from "@/shared/lib/store";

const session = vi.hoisted(() => ({
  value: {
    data: {
      user: { id: "owner-store-sync" },
      token: "session-store-sync" as string | null,
    },
    status: "authenticated" as const,
  },
}));

vi.mock("@/src/compat/auth-session-store", () => ({
  useSession: () => session.value,
}));

vi.mock("@/shared/lib/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/lib/store")>();
  return { ...actual, useHydrated: () => true };
});

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
}

describe("StoreSync collection reconciliation", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    session.value.data.token = "session-store-sync";
    resetStore();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("retries a failed guest merge on reconnect before replaying remapped edits", async () => {
    const guestId = "550e8400-e29b-41d4-a716-446655440000";
    const serverId = "server-existing-collection";
    const secondMerge = deferredResponse();
    const collectionCommands: Array<Record<string, unknown>> = [];
    let mergeAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/me/merge") {
        mergeAttempts += 1;
        return mergeAttempts === 1
          ? response({ message: "offline" }, 503)
          : secondMerge.promise;
      }
      if (path === "/api/me/collection") {
        const command = JSON.parse(String(init?.body)) as Record<string, unknown>;
        collectionCommands.push(command);
        return response({ ok: true, ...command });
      }
      throw new Error(`unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    useApp.setState({
      collections: [{
        id: guestId,
        name: "게스트 이름",
        emoji: "📚",
        titleIds: [],
        createdAt: "2026-07-20T00:00:00.000Z",
      }],
    });

    render(<StoreSync />);
    await waitFor(() => expect(mergeAttempts).toBe(1));
    act(() => useApp.getState().renameCollection(guestId, "연결 복구 이름"));
    await waitFor(() => expect(useApp.getState().collectionOutbox).toHaveLength(2));
    expect(collectionCommands).toEqual([]);

    act(() => window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(mergeAttempts).toBe(2));
    secondMerge.resolve(response({
      ratings: {},
      reads: {},
      subscriptions: {},
      reviews: {},
      likedReviews: {},
      collections: [
        {
          id: "pre-existing-server-collection",
          name: "서버 기존",
          emoji: "⭐",
          titleIds: [],
          createdAt: "2026-07-19T00:00:00.000Z",
        },
        {
          id: serverId,
          name: "게스트 이름",
          emoji: "📚",
          titleIds: [],
          createdAt: "2026-07-20T00:00:00.000Z",
        },
      ],
      collectionIdMap: { [guestId]: serverId },
    }));

    await waitFor(() => expect(collectionCommands).toHaveLength(1));
    expect(collectionCommands[0]).toMatchObject({
      action: "rename",
      id: serverId,
      name: "연결 복구 이름",
    });
    expect(useApp.getState().collections.map((collection) => collection.id)).toEqual([
      "pre-existing-server-collection",
      serverId,
    ]);
    expect(useApp.getState().collections[1]).toMatchObject({
      id: serverId,
      name: "연결 복구 이름",
    });
    expect(useApp.getState().collectionOutbox).toEqual([]);
  });

  it("does not hydrate a merge response that resolves after cleanup", async () => {
    const guestId = "550e8400-e29b-41d4-a716-446655440001";
    const merge = deferredResponse();
    vi.stubGlobal("fetch", vi.fn(() => merge.promise));
    useApp.setState({
      collections: [{
        id: guestId,
        name: "로컬 유지",
        emoji: "📚",
        titleIds: [],
        createdAt: "2026-07-20T00:00:00.000Z",
      }],
    });

    const view = render(<StoreSync />);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    view.unmount();
    merge.resolve(response({
      ratings: {}, reads: {}, subscriptions: {}, reviews: {}, likedReviews: {}, collections: [],
      collectionIdMap: { [guestId]: "server-late" },
    }));
    await act(async () => { await Promise.resolve(); });

    expect(useApp.getState().libraryOwnerId).toBeNull();
    expect(useApp.getState().collections[0]?.id).toBe(guestId);
  });

  it("does not hydrate a merge body that resolves after cleanup", async () => {
    const guestId = "550e8400-e29b-41d4-a716-446655440008";
    let resolveJson!: (value: unknown) => void;
    const json = new Promise<unknown>((resolve) => {
      resolveJson = resolve;
    });
    const jsonMock = vi.fn(() => json);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: jsonMock,
    }) as unknown as Response));
    useApp.setState({
      collections: [{
        id: guestId,
        name: "본문 대기 중",
        emoji: "📚",
        titleIds: [],
        createdAt: "2026-07-20T00:00:00.000Z",
      }],
    });

    const view = render(<StoreSync />);
    await waitFor(() => expect(jsonMock).toHaveBeenCalledOnce());
    view.unmount();
    resolveJson({
      ratings: {}, reads: {}, subscriptions: {}, reviews: {}, likedReviews: {}, collections: [],
      collectionIdMap: { [guestId]: "server-late-body" },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useApp.getState().libraryOwnerId).toBeNull();
    expect(useApp.getState().collections[0]?.id).toBe(guestId);
  });

  it("coalesces an online event received while a failing merge is still running", async () => {
    const firstMerge = deferredResponse();
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(() => {
      attempts += 1;
      return attempts === 1
        ? firstMerge.promise
        : Promise.resolve(response({
            ratings: {},
            reads: {},
            subscriptions: {},
            reviews: {},
            likedReviews: {},
            collections: [],
            collectionIdMap: {},
          }));
    }));

    render(<StoreSync />);
    await waitFor(() => expect(attempts).toBe(1));
    act(() => window.dispatchEvent(new Event("online")));
    firstMerge.resolve(response({ message: "failed" }, 503));

    await waitFor(() => expect(attempts).toBe(2));
    await waitFor(() => expect(useApp.getState().libraryOwnerId).toBe("owner-store-sync"));
  });

  it("times out a hung merge and honors an online rerun request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    const view = render(<StoreSync />);
    await act(async () => { await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledOnce();
    act(() => window.dispatchEvent(new Event("online")));

    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it("times out a hung response body and honors an online rerun request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: () => new Promise<never>(() => {}),
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const view = render(<StoreSync />);
    await act(async () => { await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledOnce();
    act(() => window.dispatchEvent(new Event("online")));

    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it("rebuilds recovery-only guest collections through the merge graph", async () => {
    const guestId = "550e8400-e29b-41d4-a716-446655440009";
    const serverId = "server-recovered-collection";
    let mergeBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "/api/me/merge") {
        throw new Error(`unexpected request: ${String(input)}`);
      }
      mergeBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return response({
        ratings: {},
        reads: {},
        subscriptions: {},
        reviews: {},
        likedReviews: {},
        collections: [{
          id: serverId,
          name: "복구한 게스트",
          emoji: "📚",
          titleIds: ["title-recovery"],
          createdAt: "2026-07-20T00:00:00.000Z",
        }],
        collectionIdMap: { [guestId]: serverId },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    useApp.setState({
      collections: [],
      libraryOwnerId: null,
      libraryMergeOwnerId: null,
      collectionOutbox: [
        {
          mutationId: "recovery-create",
          ownerId: "owner-store-sync",
          command: {
            action: "create",
            id: guestId,
            name: "복구한 게스트",
            emoji: "📚",
          },
          rollback: { kind: "create" },
          recovery: true,
        },
        {
          mutationId: "recovery-item",
          ownerId: "owner-store-sync",
          command: {
            action: "set-item",
            id: guestId,
            titleId: "title-recovery",
            included: true,
          },
          rollback: {
            kind: "set-item",
            titleId: "title-recovery",
            previousIncluded: true,
            intendedIncluded: true,
          },
          recovery: true,
        },
      ],
    });

    render(<StoreSync />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await waitFor(() => expect(useApp.getState().collectionOutbox).toEqual([]));

    expect(mergeBody?.collections).toEqual([{
      id: guestId,
      name: "복구한 게스트",
      emoji: "📚",
      titleIds: ["title-recovery"],
      createdAt: expect.any(String),
    }]);
    expect(useApp.getState().collections).toEqual([expect.objectContaining({
      id: serverId,
      titleIds: ["title-recovery"],
    })]);
  });

  it("refetches after a stale account snapshot instead of reviving a completed delete", async () => {
    const snapshot = deferredResponse();
    let snapshotRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/me") {
        snapshotRequests += 1;
        if (snapshotRequests === 1) return snapshot.promise;
        return response({
          ratings: {},
          reads: {},
          subscriptions: {},
          reviews: {},
          likedReviews: {},
          collections: [{
            id: "remote-added",
            name: "서버 최신",
            emoji: "⭐",
            titleIds: [],
            createdAt: "2026-07-20T00:00:00.000Z",
          }],
        });
      }
      const command = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return response({ ok: true, ...command });
    });
    vi.stubGlobal("fetch", fetchMock);
    useApp.setState({
      libraryOwnerId: "owner-store-sync",
      collections: [{
        id: "existing-edit",
        name: "이전 이름",
        emoji: "📚",
        titleIds: [],
        createdAt: "2026-07-20T00:00:00.000Z",
      }],
    });

    render(<StoreSync />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    act(() => useApp.getState().deleteCollection("existing-edit"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(useApp.getState().collectionOutbox).toEqual([]));

    snapshot.resolve(response({
      ratings: {},
      reads: {},
      subscriptions: {},
      reviews: {},
      likedReviews: {},
      collections: [
        {
          id: "existing-edit",
          name: "삭제 전 이름",
          emoji: "📚",
          titleIds: [],
          createdAt: "2026-07-20T00:00:00.000Z",
        },
        {
          id: "remote-added",
          name: "서버 추가",
          emoji: "⭐",
          titleIds: [],
          createdAt: "2026-07-20T00:00:00.000Z",
        },
      ],
    }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(useApp.getState().collections.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "remote-added", name: "서버 최신" },
    ]);
  });

  it("hydrates with the HttpOnly cookie when no readable session token exists", async () => {
    session.value.data.token = null;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).has("x-user-id")).toBe(false);
      return response({
        ratings: {},
        reads: {},
        subscriptions: {},
        reviews: {},
        likedReviews: {},
        collections: [],
        collectionIdMap: {},
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StoreSync />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await waitFor(() => expect(useApp.getState().libraryOwnerId).toBe("owner-store-sync"));
    expect(useApp.getState().userId).toBe("owner-store-sync");
    expect(useApp.getState().sessionToken).toBeNull();
  });
});
