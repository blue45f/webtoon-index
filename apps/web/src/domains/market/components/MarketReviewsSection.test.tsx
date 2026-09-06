// @vitest-environment jsdom

import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MarketReviewsSection } from "./MarketReviewsSection";

import { SessionContext } from "@/src/compat/auth-session-store";


const mocks = vi.hoisted(() => ({
  deleteReview: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn().mockResolvedValue(undefined),
  saveReview: vi.fn().mockResolvedValue(undefined),
  toggleReviewHelpful: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../hooks/use-market-social", () => ({
  useMarketSocial: () => ({
    status: "ready",
    error: null,
    pendingAction: null,
    refresh: mocks.refresh,
    saveReview: mocks.saveReview,
    deleteReview: mocks.deleteReview,
    toggleReviewHelpful: mocks.toggleReviewHelpful,
    data: {
      resourceId: "11111111-1111-4111-8111-111111111111",
      publisherId: "publisher-1",
      packageId: "brush.ink.production",
      resourceVersion: "2.1.0",
      comments: [],
      reviews: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          resourceId: "11111111-1111-4111-8111-111111111111",
          author: {
            id: "artist-2",
            name: "연재 작가 K",
            avatar: null,
            badge: "studio-verified",
          },
          rating: 5,
          title: "실제 컷에서 바로 쓸 수 있었습니다",
          content: "설치 후 브러시 목록에 바로 나타났고 선화 지연도 없었습니다.",
          roleTag: "현역 웹툰 작가",
          tags: ["선화 최적"],
          qualification: "studio",
          sourceResourceVersion: "2.1.0",
          installedResourceVersion: "2.1.0",
          helpfulCount: 7,
          helpfulByViewer: false,
          isMine: false,
          canDelete: false,
          createdAt: "2026-09-04T00:00:00.000Z",
        },
      ],
      stats: {
        average: 5,
        totalCount: 1,
        recommendPercentage: 100,
        distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 1 },
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
      totalCommentCount: 0,
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

describe("MarketReviewsSection", () => {
  it("renders a Studio-confirmed review and saves a qualified evaluation", async () => {
    render(
      <SessionContext.Provider value={session}>
        <MarketReviewsSection resourceId="11111111-1111-4111-8111-111111111111" />
      </SessionContext.Provider>,
    );

    expect(
      screen.getByRole("heading", { name: /검증 평점 & 활용 리뷰/i }),
    ).toBeDefined();
    expect(screen.getAllByText(/Studio 설치 확인/).length).toBeGreaterThan(0);
    expect(screen.getByText("실제 컷에서 바로 쓸 수 있었습니다")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "리뷰 작성" }));
    fireEvent.change(screen.getByPlaceholderText(/선화 작업 시간이 확실히/i), {
      target: { value: "마감 작업에서 체감 성능이 좋았습니다" },
    });
    fireEvent.change(screen.getByPlaceholderText(/어떤 컷과 설정에서 사용했는지/i), {
      target: { value: "1200px 세로 컷에서 사용했고 빠른 스트로크에도 지연이 없었습니다." },
    });
    fireEvent.click(screen.getByRole("button", { name: "리뷰 등록" }));

    await waitFor(() => {
      expect(mocks.saveReview).toHaveBeenCalledWith({
        rating: 5,
        title: "마감 작업에서 체감 성능이 좋았습니다",
        content: "1200px 세로 컷에서 사용했고 빠른 스트로크에도 지연이 없었습니다.",
        roleTag: "현역 웹툰 작가",
        tags: [],
      });
    });
  });
});
