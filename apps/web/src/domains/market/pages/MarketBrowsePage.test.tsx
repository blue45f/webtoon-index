// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMarketResources } from "../hooks/use-market-resources";

import { MarketBrowsePage } from "./MarketBrowsePage";

import type { MarketResourcesPage } from "../hooks/use-market-resources";

import { CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS } from "@/shared/lib/creator-marketplace-resource-contract";

vi.mock("../hooks/use-market-resources", () => ({
  useMarketResources: vi.fn(),
}));

vi.mock("../components/MarketResourceCard", () => ({
  MarketResourceCard: ({ record }: { record: { id: string } }) => (
    <div data-testid={`resource-${record.id}`} />
  ),
}));

vi.mock("@/src/hooks/use-document-title", () => ({
  useDocumentTitle: vi.fn(),
  useJsonLd: vi.fn(),
  useMetaDescription: vi.fn(),
  usePageSocialMeta: vi.fn(),
}));

const useResources = vi.mocked(useMarketResources);

function marketPage(overrides: Partial<MarketResourcesPage> = {}): MarketResourcesPage {
  return {
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
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="현재 검색 쿼리">{location.search}</output>;
}

function BackButton() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>뒤로</button>;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

beforeEach(() => {
  useResources.mockReturnValue(marketPage());
});

describe("MarketBrowsePage", () => {
  it("atomically clears the draft and URL without a pending debounce restoring filters", () => {
    vi.useFakeTimers();
    render(
      <MemoryRouter initialEntries={["/market/browse?q=seed&kind=brush"]}>
        <MarketBrowsePage />
        <LocationProbe />
      </MemoryRouter>
    );

    const search = screen.getByRole("searchbox", {
      name: "마켓 리소스 검색",
    }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "pending" } });
    fireEvent.click(screen.getByRole("button", { name: "조건 초기화" }));

    act(() => vi.advanceTimersByTime(350));
    expect(search.value).toBe("");
    expect(screen.getByLabelText("현재 검색 쿼리").textContent).toBe("");
  });

  it("syncs the draft from browser history and cancels the obsolete draft commit", () => {
    vi.useFakeTimers();
    render(
      <MemoryRouter
        initialEntries={["/market/browse?q=alpha", "/market/browse?q=alpha&kind=brush"]}
        initialIndex={1}
      >
        <MarketBrowsePage />
        <BackButton />
        <LocationProbe />
      </MemoryRouter>
    );

    const search = screen.getByRole("searchbox", {
      name: "마켓 리소스 검색",
    }) as HTMLInputElement;
    expect(search.value).toBe("alpha");
    fireEvent.change(search, { target: { value: "obsolete draft" } });
    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));

    act(() => vi.advanceTimersByTime(350));
    expect(search.value).toBe("alpha");
    expect(screen.getByLabelText("현재 검색 쿼리").textContent).toBe("?q=alpha");
  });

  it("keeps baseline and coarse-pointer controls reachable and hides the native cancel button", () => {
    render(
      <MemoryRouter initialEntries={["/market/browse?q=ink&kind=brush&license=cc0-1.0"]}>
        <MarketBrowsePage />
      </MemoryRouter>
    );

    const search = screen.getByRole("searchbox", { name: "마켓 리소스 검색" });
    expect(search.getAttribute("maxlength")).toBe(String(
      CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS
    ));
    expect(search.className).toContain("pointer-coarse:h-11");
    expect(search.className).toContain("[&::-webkit-search-cancel-button]:hidden");

    expect(screen.getByRole("button", { name: "검색어 지우기" }).className)
      .toContain("pointer-coarse:size-11");
    expect(screen.getByRole("button", { name: "브러시" }).className)
      .toContain("pointer-coarse:min-h-11");
    expect(screen.getByRole("button", { name: "브러시 필터 제거" }).className)
      .toContain("min-h-6");
    expect(screen.getByRole("button", { name: "검색: “ink” 필터 제거" }).className)
      .toContain("min-h-6");
    expect(screen.getByRole("button", { name: "검색: “ink” 필터 제거" }).className)
      .toContain("pointer-coarse:min-h-11");
    expect(screen.getByRole("button", { name: "조건 초기화" }).className)
      .toContain("pointer-coarse:min-h-11");
    expect(screen.getByText(/현재/).closest("p")?.textContent).toContain("현재 0개 표시");
  });

  it("uses relevance for search by default and keeps an explicit newest choice in the URL", () => {
    render(
      <MemoryRouter initialEntries={["/market/browse?q=ink"]}>
        <MarketBrowsePage />
        <LocationProbe />
      </MemoryRouter>
    );

    const sort = screen.getByRole("combobox", { name: "정렬 기준" }) as HTMLSelectElement;
    expect(sort.value).toBe("relevance");
    expect(useResources).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "ink", sort: "relevance" })
    );

    fireEvent.change(sort, { target: { value: "newest" } });

    expect(screen.getByLabelText("현재 검색 쿼리").textContent).toContain("sort=newest");
    expect(useResources).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "ink", sort: "newest" })
    );
  });

  it("pauses a relevance URL without a search term until the invalid condition is removed", () => {
    render(
      <MemoryRouter initialEntries={["/market/browse?sort=relevance"]}>
        <MarketBrowsePage />
      </MemoryRouter>
    );

    expect(useResources).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("alert").textContent).toContain(
      "관련도순 정렬에는 올바른 검색어가 필요"
    );
  });

  it("uses a human-readable fallback instead of exposing a publisher UUID", () => {
    const publisherId = "123e4567-e89b-42d3-a456-426614174210";
    render(
      <MemoryRouter initialEntries={[`/market/browse?publisher=${publisherId}`]}>
        <MarketBrowsePage />
      </MemoryRouter>
    );

    const publisherFilter = screen.getByRole("button", {
      name: "배급자: 선택한 배급자 필터 제거",
    });
    expect(publisherFilter.textContent).toContain("선택한 배급자");
    expect(publisherFilter.textContent).not.toContain(publisherId);
  });

  it("pauses malformed publisher queries until the user removes them without auto-navigation", () => {
    render(
      <MemoryRouter initialEntries={["/market/browse?publisher=not-a-uuid"]}>
        <MarketBrowsePage />
        <LocationProbe />
      </MemoryRouter>
    );

    expect(useResources).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("alert").textContent).toContain("배급자 식별자 형식");
    expect(screen.getByLabelText("현재 검색 쿼리").textContent)
      .toBe("?publisher=not-a-uuid");
    expect(
      screen.queryByRole("button", { name: /배급자: .* 필터 제거/u })
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "잘못된 조건 제거" }));
    expect(screen.getByLabelText("현재 검색 쿼리").textContent).toBe("");
    expect(useResources).toHaveBeenLastCalledWith(
      expect.objectContaining({ publisher: undefined })
    );
  });

  it("does not silently truncate an overlong URL search into different results", () => {
    const overlong = "q".repeat(
      CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS + 1
    );
    render(
      <MemoryRouter initialEntries={[`/market/browse?q=${overlong}`]}>
        <MarketBrowsePage />
      </MemoryRouter>
    );

    const search = screen.getByRole("searchbox", {
      name: "마켓 리소스 검색",
    }) as HTMLInputElement;
    expect(search.value).toBe(overlong);
    expect(search.getAttribute("aria-invalid")).toBe("true");
    expect(useResources).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("alert").textContent).toContain("자동으로 자르지 않았어요");
  });

  it("announces browse skeleton loading while keeping placeholders decorative", () => {
    useResources.mockReturnValue(marketPage({ loading: true }));

    const { container } = render(
      <MemoryRouter initialEntries={["/market/browse"]}>
        <MarketBrowsePage />
      </MemoryRouter>
    );

    expect(screen.getByRole("status").textContent).toContain("탐색 결과를 불러오는 중");
    expect(container.querySelector("ul[aria-busy='true']")).toBeTruthy();
    expect(container.querySelectorAll("li[aria-hidden='true']")).toHaveLength(12);
  });

  it("renders a visible load-more failure and retries from the same action", () => {
    const loadMore = vi.fn();
    useResources.mockReturnValue(marketPage({
      hasMore: true,
      loadMoreError: "추가 리소스를 불러오지 못했어요.",
      loadMore,
    }));

    render(
      <MemoryRouter initialEntries={["/market/browse"]}>
        <MarketBrowsePage />
      </MemoryRouter>
    );

    expect(screen.getByRole("alert").textContent).toContain("추가 리소스를 불러오지 못했어요.");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(loadMore).toHaveBeenCalledOnce();
  });
});
