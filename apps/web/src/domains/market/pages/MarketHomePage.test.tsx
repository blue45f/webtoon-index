// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMarketResources } from "../hooks/use-market-resources";

import { MarketHomePage } from "./MarketHomePage";

import type { MarketResourcesPage } from "../hooks/use-market-resources";
import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

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
const cachedRecord = {
  id: "cached-resource",
  tags: ["캐시", "복구", "마켓"],
} as CreatorMarketplaceResourceRecord;

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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MarketHomePage", () => {
  it("announces recent-resource skeleton loading", () => {
    useResources.mockReturnValue(marketPage({ loading: true }));

    const { container } = render(
      <MemoryRouter>
        <MarketHomePage />
      </MemoryRouter>
    );

    expect(screen.getByRole("status").textContent).toContain("최근 공유된 마켓 리소스");
    expect(container.querySelector("ul[aria-busy='true']")).toBeTruthy();
    expect(container.querySelectorAll("li[aria-hidden='true']")).toHaveLength(8);
  });

  it("links the share CTA directly to the open Studio community share view", () => {
    useResources.mockReturnValue(marketPage());

    render(
      <MemoryRouter>
        <MarketHomePage />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("link", { name: "스튜디오에서 공유하기" }).getAttribute("href")
    ).toBe("/studio?assetMarket=community&communityView=share");
  });

  it("distinguishes every license text link without relying on color alone", () => {
    useResources.mockReturnValue(marketPage());

    render(
      <MemoryRouter>
        <MarketHomePage />
      </MemoryRouter>
    );

    const licenseLinks = screen.getAllByRole("link", { name: /사용권 전문 보기/ });
    expect(licenseLinks).toHaveLength(4);
    for (const link of licenseLinks) {
      expect(link.className.split(/\s+/u)).toContain("underline");
    }
  });

  it("keeps cached resource cards visible while clearly marking stale data", () => {
    const reload = vi.fn();
    useResources.mockReturnValue(marketPage({
      items: [cachedRecord],
      stale: true,
      staleSavedAt: "2026-08-30T07:00:00.000Z",
      reload,
    }));

    render(
      <MemoryRouter>
        <MarketHomePage />
      </MemoryRouter>
    );

    expect(screen.getByTestId("resource-cached-resource")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("저장된 사본을 보여드리고 있어요");
    expect(screen.getByRole("status").textContent).toContain("현재 공개 상태는 확인되지 않았어요");
    const retry = screen.getByRole("button", { name: "다시 시도" });
    expect(retry.className).toContain("pointer-coarse:min-h-11");
    fireEvent.click(retry);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("shows the fatal recovery state only when no cached cards are available", () => {
    useResources.mockReturnValue(marketPage({ error: "offline" }));

    render(
      <MemoryRouter>
        <MarketHomePage />
      </MemoryRouter>
    );

    expect(screen.queryByTestId("resource-cached-resource")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("최근 공유 리소스를 불러올 수 없어요");
  });
});
