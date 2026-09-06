// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarketComparePage } from "./MarketComparePage";

import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

import { CREATOR_MARKETPLACE_STARTER_RECORDS } from "@/shared/lib/creator-marketplace-starter-catalog";

const comparison = vi.hoisted(() => ({
  items: [] as readonly CreatorMarketplaceResourceRecord[],
  removeCompare: vi.fn(),
  clearCompare: vi.fn(),
}));

vi.mock("../hooks/use-market-compare", () => ({
  MARKET_COMPARE_MAX_ITEMS: 4,
  useMarketCompare: () => ({
    compareItems: comparison.items,
    compareCount: comparison.items.length,
    removeCompare: comparison.removeCompare,
    clearCompare: comparison.clearCompare,
  }),
}));

vi.mock("../components/MarketNavHeader", () => ({
  MarketNavHeader: () => <nav aria-label="마켓 주요 내비게이션" />,
}));

vi.mock("@/src/hooks/use-document-title", () => ({
  useDocumentTitle: vi.fn(),
  useMetaDescription: vi.fn(),
}));

beforeEach(() => {
  comparison.items = CREATOR_MARKETPLACE_STARTER_RECORDS.slice(0, 2);
  vi.clearAllMocks();
});

afterEach(cleanup);

function renderPage() {
  return render(<MemoryRouter><MarketComparePage /></MemoryRouter>);
}

describe("MarketComparePage", () => {
  it("uses native buttons to move the named comparison viewport in both directions", () => {
    renderPage();
    const viewport = screen.getByRole("region", { name: "에셋 manifest 비교표" });
    const previous = screen.getByRole("button", { name: "이전 열 보기" });
    const next = screen.getByRole("button", { name: "다음 열 보기" });

    expect(viewport.getAttribute("tabindex")).toBeNull();
    expect(previous.tagName).toBe("BUTTON");
    expect(next.tagName).toBe("BUTTON");
    expect(previous.getAttribute("aria-controls")).toBe(viewport.id);
    expect(next.getAttribute("aria-controls")).toBe(viewport.id);
    expect(screen.getByRole("table")).toBeTruthy();

    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 600 });
    viewport.scrollLeft = 0;
    fireEvent.click(next);
    expect(viewport.scrollLeft).toBe(480);
    fireEvent.click(previous);
    expect(viewport.scrollLeft).toBe(0);
  });

  it("keeps the empty state free of scroll controls for a missing table", () => {
    comparison.items = [];
    renderPage();

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: "다음 열 보기" })).toBeNull();
    expect(screen.getByRole("link", { name: "에셋 탐색" }).getAttribute("href"))
      .toBe("/market/browse");
  });
});
