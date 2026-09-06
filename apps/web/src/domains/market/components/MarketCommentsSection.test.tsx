// @vitest-environment jsdom

import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MarketCommentsSection } from "./MarketCommentsSection";

import { SessionContext } from "@/src/compat/auth-session-store";


const mocks = vi.hoisted(() => ({
  createComment: vi.fn().mockResolvedValue(undefined),
  deleteComment: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn().mockResolvedValue(undefined),
  toggleCommentLike: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../hooks/use-market-social", () => ({
  useMarketSocial: () => ({
    status: "ready",
    error: null,
    pendingAction: null,
    refresh: mocks.refresh,
    createComment: mocks.createComment,
    deleteComment: mocks.deleteComment,
    toggleCommentLike: mocks.toggleCommentLike,
    data: {
      resourceId: "11111111-1111-4111-8111-111111111111",
      comments: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          resourceId: "11111111-1111-4111-8111-111111111111",
          parentId: null,
          depth: 0,
          author: {
            id: "publisher-1",
            name: "배급 작가",
            avatar: null,
            badge: "publisher",
          },
          content: "브러시 크기는 10px 전후를 권장합니다.",
          deleted: false,
          likeCount: 3,
          likedByViewer: false,
          canDelete: false,
          createdAt: "2026-09-04T00:00:00.000Z",
        },
      ],
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
        studioInstallVerified: true,
        canComment: true,
        canReview: true,
        reviewRequirement: "none",
        myReviewId: null,
      },
      totalCommentCount: 1,
      generatedAt: "2026-09-04T00:00:00.000Z",
      truncated: { comments: false, reviews: false },
    },
  }),
}));

const session = {
  data: {
    user: {
      id: "viewer-1",
      name: "테스트 작가",
      email: null,
      image: null,
      role: "user",
    },
    token: null,
  },
  ready: true,
  status: "authenticated" as const,
  update: async () => ({ user: { id: "viewer-1" }, token: null }),
};

describe("MarketCommentsSection", () => {
  it("renders persisted comments and submits the account-authored payload", async () => {
    render(
      <SessionContext.Provider value={session}>
        <MarketCommentsSection
          resourceId="11111111-1111-4111-8111-111111111111"
          publisherId="publisher-1"
        />
      </SessionContext.Provider>,
    );

    expect(
      screen.getByRole("heading", { name: /Q&A 및 커뮤니티 피드백/i }),
    ).toBeDefined();
    expect(screen.getByText("브러시 크기는 10px 전후를 권장합니다.")).toBeDefined();
    expect(screen.getByText("배급자")).toBeDefined();

    const textarea = screen.getByPlaceholderText(/호환성, 적용 방법/i);
    fireEvent.change(textarea, {
      target: { value: "Studio 최신 버전에서도 같은 필압 곡선을 쓰나요?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "댓글 등록" }));

    await waitFor(() => {
      expect(mocks.createComment).toHaveBeenCalledWith({
        content: "Studio 최신 버전에서도 같은 필압 곡선을 쓰나요?",
        parentId: null,
      });
    });
  });
});
