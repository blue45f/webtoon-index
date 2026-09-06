// @vitest-environment jsdom

import {
  act,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getMarketSocialStoreCountForTests,
  resetMarketSocialStoresForTests,
  useMarketSocial,
} from "./use-market-social";

const RESOURCE_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  createComment: vi.fn(),
  deleteComment: vi.fn(),
  deleteReview: vi.fn(),
  getPage: vi.fn(),
  toggleCommentLike: vi.fn(),
  toggleReviewHelpful: vi.fn(),
  upsertReview: vi.fn(),
}));

vi.mock("@/src/infrastructure/creator-marketplace-social-client", () => ({
  createCreatorMarketplaceComment: mocks.createComment,
  deleteCreatorMarketplaceComment: mocks.deleteComment,
  deleteCreatorMarketplaceReview: mocks.deleteReview,
  getCreatorMarketplaceSocialPage: mocks.getPage,
  toggleCreatorMarketplaceCommentLike: mocks.toggleCommentLike,
  toggleCreatorMarketplaceReviewHelpful: mocks.toggleReviewHelpful,
  upsertCreatorMarketplaceReview: mocks.upsertReview,
}));

function page(commentCount = 0) {
  return {
    resourceId: RESOURCE_ID,
    publisherId: "publisher-1",
    packageId: "brush.ink.production",
    resourceVersion: "2.1.0",
    comments: [],
    reviews: [],
    stats: {
      average: 0,
      totalCount: 0,
      recommendPercentage: 0,
      distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
    },
    viewer: {
      authenticated: true,
      libraryMembership: "active",
      studioVerificationSupported: true,
      studioInstallVerified: true,
      canComment: true,
      canReview: true,
      reviewQualification: "studio",
      reviewRequirement: "none",
      myReviewId: null,
    },
    totalCommentCount: commentCount,
    generatedAt: "2026-09-04T00:00:00.000Z",
    truncated: { comments: false, reviews: false },
  } as const;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe("useMarketSocial", () => {
  beforeEach(() => {
    resetMarketSocialStoresForTests();
    vi.clearAllMocks();
    mocks.getPage.mockResolvedValue(page());
    mocks.createComment.mockResolvedValue(page(1));
  });

  afterEach(() => {
    resetMarketSocialStoresForTests();
  });

  it("deduplicates detail reads and publishes mutation results to every subscriber", async () => {
    const first = renderHook(() => useMarketSocial(RESOURCE_ID, "viewer-1"));
    const second = renderHook(() => useMarketSocial(RESOURCE_ID, "viewer-1"));

    await waitFor(() => {
      expect(first.result.current.status).toBe("ready");
      expect(second.result.current.status).toBe("ready");
    });
    expect(mocks.getPage).toHaveBeenCalledTimes(1);

    await act(async () => {
      await first.result.current.createComment({
        content: "패키지 전체에 이어지는 질문",
        parentId: null,
      });
    });

    expect(second.result.current.data?.totalCommentCount).toBe(1);
    expect(mocks.createComment).toHaveBeenCalledWith(
      RESOURCE_ID,
      {
        content: "패키지 전체에 이어지는 질문",
        parentId: null,
      },
      expect.any(AbortSignal),
    );

    first.unmount();
    second.unmount();
  });

  it("revalidates after returning focus from Studio", async () => {
    const hook = renderHook(() => useMarketSocial(RESOURCE_ID, "viewer-1"));
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));

    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(mocks.getPage).toHaveBeenCalledTimes(2));
    hook.unmount();
  });

  it("clears viewer-owned permissions and reactions before loading another account", async () => {
    const previousViewerPage = {
      ...page(),
      viewer: {
        ...page().viewer,
        myReviewId: "22222222-2222-4222-8222-222222222222",
      },
    } as const;
    const nextViewerRequest = deferred<ReturnType<typeof page>>();
    mocks.getPage
      .mockResolvedValueOnce(previousViewerPage)
      .mockReturnValueOnce(nextViewerRequest.promise);

    const hook = renderHook(
      ({ viewerKey }) => useMarketSocial(RESOURCE_ID, viewerKey),
      { initialProps: { viewerKey: "viewer-1" } },
    );
    await waitFor(() => {
      expect(hook.result.current.status).toBe("ready");
      expect(hook.result.current.data?.viewer.myReviewId).toBe(
        "22222222-2222-4222-8222-222222222222",
      );
    });

    hook.rerender({ viewerKey: "viewer-2" });
    await waitFor(() => {
      expect(hook.result.current.status).toBe("loading");
      expect(hook.result.current.data).toBeNull();
      expect(hook.result.current.pendingAction).toBeNull();
    });

    nextViewerRequest.resolve(page());
    await waitFor(() => {
      expect(hook.result.current.status).toBe("ready");
      expect(hook.result.current.data?.viewer.myReviewId).toBeNull();
    });
    hook.unmount();
  });

  it("bounds inactive resource stores without evicting an active subscriber", async () => {
    const active = renderHook(() => useMarketSocial(RESOURCE_ID, "viewer-1"));
    await waitFor(() => expect(active.result.current.status).toBe("ready"));

    for (let index = 0; index < 68; index += 1) {
      const resourceId = `resource-${String(index).padStart(3, "0")}`;
      const transient = renderHook(() => useMarketSocial(resourceId, "viewer-1"));
      await waitFor(() => expect(transient.result.current.status).toBe("ready"));
      transient.unmount();
    }

    expect(getMarketSocialStoreCountForTests()).toBeLessThanOrEqual(64);
    expect(active.result.current.status).toBe("ready");
    active.unmount();
  });
});
