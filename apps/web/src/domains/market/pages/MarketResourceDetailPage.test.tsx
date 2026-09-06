// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMarketResourceDetail } from "../hooks/use-market-resource-detail";
import { useMarketResources } from "../hooks/use-market-resources";

import { MarketResourceDetailPage } from "./MarketResourceDetailPage";

vi.mock("../hooks/use-market-resource-detail", () => ({
  useMarketResourceDetail: vi.fn(),
}));

vi.mock("../hooks/use-market-resources", () => ({
  useMarketResources: vi.fn(),
}));

vi.mock("../components/MarketResourceDetailArticle", () => ({
  MarketResourceDetailArticle: () => <article>상세 본문</article>,
}));

vi.mock("@/src/hooks/use-document-title", () => ({
  useDocumentTitle: vi.fn(),
  useJsonLd: vi.fn(),
  useMetaDescription: vi.fn(),
  usePageSocialMeta: vi.fn(),
}));

const useDetail = vi.mocked(useMarketResourceDetail);
const useResources = vi.mocked(useMarketResources);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MarketResourceDetailPage", () => {
  it("announces detail skeleton loading and hides its decorative placeholders", () => {
    useDetail.mockReturnValue({
      record: null,
      loading: true,
      notFound: false,
      error: null,
      staleSavedAt: null,
      reload: vi.fn(),
    });
    useResources.mockReturnValue({
      items: [],
      loading: false,
      loadingMore: false,
      error: null,
      loadMoreError: null,
      hasMore: false,
      stale: false,
      staleSavedAt: null,
      loadMore: vi.fn(),
      reload: vi.fn(),
    });

    const { container } = render(
      <MemoryRouter initialEntries={["/market/resource/test-id"]}>
        <Routes>
          <Route path="/market/resource/:id" element={<MarketResourceDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole("status").textContent).toContain("상세 정보를 불러오는 중");
    expect(container.querySelector("[aria-hidden='true'] .skeleton")).toBeTruthy();
  });
});
