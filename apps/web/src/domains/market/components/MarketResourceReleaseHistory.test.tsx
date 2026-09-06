// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarketResourceReleaseHistory } from "./MarketResourceReleaseHistory";

import type {
  CreatorMarketplaceResourceHistoryItem,
  CreatorMarketplaceResourceHistoryPage,
} from "@/shared/lib/creator-marketplace-resource-contract";

const mocks = vi.hoisted(() => ({ getHistory: vi.fn() }));

vi.mock("@/src/infrastructure/creator-marketplace-client", () => ({
  getCreatorMarketplaceResourceHistory: mocks.getHistory,
}));

const SELECTED_ID = "123e4567-e89b-42d3-a456-426614174000";
const VISIBLE_ID = "223e4567-e89b-42d3-a456-426614174000";

function item(
  id: string,
  version: string,
  ordinal: number,
  selected = false,
): CreatorMarketplaceResourceHistoryItem {
  return {
    id,
    releaseOrdinal: ordinal,
    name: `릴리스 ${version}`,
    resourceVersion: version,
    minimumStudioVersion: "1.0.0",
    releaseNotes: ordinal % 2 === 0 ? "브러시 압력 개선" : undefined,
    manifestHash: "a".repeat(64),
    createdAt: "2026-08-30T00:00:00.000Z",
    selected,
  };
}

function page(options: {
  anchorId?: string;
  anchorListed?: boolean;
  items?: CreatorMarketplaceResourceHistoryItem[];
  nextCursor?: number | null;
} = {}): CreatorMarketplaceResourceHistoryPage {
  const anchorId = options.anchorId ?? SELECTED_ID;
  return {
    packageId: "community/brush/stable",
    anchor: {
      id: anchorId,
      resourceVersion: "2.0.0",
      listed: options.anchorListed ?? true,
    },
    items: options.items ?? [item(anchorId, "2.0.0", 2, true)],
    limit: 8,
    hasMore: options.nextCursor !== undefined && options.nextCursor !== null,
    nextCursor: options.nextCursor ?? null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function renderHistory(resourceId = SELECTED_ID) {
  return render(
    <MemoryRouter>
      <MarketResourceReleaseHistory resourceId={resourceId} />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("MarketResourceReleaseHistory", () => {
  it("shows loading, selected release notes, and only API-returned exact public links", async () => {
    mocks.getHistory.mockResolvedValue(page({
      items: [
        item(SELECTED_ID, "2.0.0", 2, true),
        item(VISIBLE_ID, "1.0.0", 1),
      ],
    }));
    renderHistory();

    expect(screen.getByRole("status").textContent).toContain("불러오는 중");
    const selected = await screen.findByText("선택한 릴리스");
    expect(selected).toBeTruthy();
    expect(screen.getByText("브러시 압력 개선")).toBeTruthy();
    expect(screen.getByText("릴리스 노트 없음")).toBeTruthy();
    expect(screen.getByRole("link", { name: "v2.0.0" }).getAttribute("href"))
      .toBe(`/market/resource/${SELECTED_ID}`);
    expect(screen.getByRole("link", { name: "v1.0.0" }).getAttribute("href"))
      .toBe(`/market/resource/${VISIBLE_ID}`);
  });

  it("explains a delisted anchor without exposing its id and handles an empty public history", async () => {
    mocks.getHistory.mockResolvedValue(page({
      anchorId: SELECTED_ID,
      anchorListed: false,
      items: [],
    }));
    renderHistory();

    expect(await screen.findByText(/선택한 v2\.0\.0 릴리스는 현재 목록에서 내려갔습니다/u))
      .toBeTruthy();
    expect(screen.getByText("현재 공개된 이전 릴리스가 없습니다.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.body.innerHTML).not.toContain(`/market/resource/${SELECTED_ID}`);
  });

  it("manually retries initial and load-more failures without dropping prior items", async () => {
    mocks.getHistory
      .mockRejectedValueOnce(new Error("history offline"))
      .mockResolvedValueOnce(page({ nextCursor: 1 }))
      .mockRejectedValueOnce(new Error("next page offline"))
      .mockResolvedValueOnce(page({
        items: [item(VISIBLE_ID, "1.0.0", 1)],
      }));
    renderHistory();

    expect((await screen.findByRole("alert")).textContent).toContain("history offline");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("link", { name: "v2.0.0" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "이전 릴리스 더 보기" }));
    expect((await screen.findByRole("alert")).textContent).toContain("next page offline");
    expect(screen.getByRole("link", { name: "v2.0.0" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    expect(await screen.findByRole("link", { name: "v1.0.0" })).toBeTruthy();
    expect(mocks.getHistory.mock.calls[3]?.[1]).toEqual({ limit: 8, cursor: 1 });
  });

  it("aborts and ignores a stale detail response after the resource id changes", async () => {
    const stale = deferred<CreatorMarketplaceResourceHistoryPage>();
    const currentId = "323e4567-e89b-42d3-a456-426614174000";
    mocks.getHistory
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(page({
        anchorId: currentId,
        items: [item(currentId, "3.0.0", 3, true)],
      }));
    const rendered = renderHistory(SELECTED_ID);
    const staleSignal = mocks.getHistory.mock.calls[0]?.[2] as AbortSignal;

    rendered.rerender(
      <MemoryRouter>
        <MarketResourceReleaseHistory resourceId={currentId} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("link", { name: "v3.0.0" })).toBeTruthy();
    expect(staleSignal.aborted).toBe(true);

    await act(async () => {
      stale.resolve(page());
      await stale.promise;
    });
    expect(screen.queryByRole("link", { name: "v2.0.0" })).toBeNull();
  });

  it("aborts and invalidates an in-flight load-more response when detail changes", async () => {
    const staleLoadMore = deferred<CreatorMarketplaceResourceHistoryPage>();
    const currentId = "423e4567-e89b-42d3-a456-426614174000";
    mocks.getHistory
      .mockResolvedValueOnce(page({ nextCursor: 1 }))
      .mockReturnValueOnce(staleLoadMore.promise)
      .mockResolvedValueOnce(page({
        anchorId: currentId,
        items: [item(currentId, "4.0.0", 4, true)],
      }));
    const rendered = renderHistory(SELECTED_ID);
    expect(await screen.findByRole("link", { name: "v2.0.0" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "이전 릴리스 더 보기" }));
    const staleSignal = mocks.getHistory.mock.calls[1]?.[2] as AbortSignal;

    rendered.rerender(
      <MemoryRouter>
        <MarketResourceReleaseHistory resourceId={currentId} />
      </MemoryRouter>,
    );
    expect(staleSignal.aborted).toBe(true);
    expect(await screen.findByRole("link", { name: "v4.0.0" })).toBeTruthy();

    await act(async () => {
      staleLoadMore.resolve(page({
        items: [item(VISIBLE_ID, "1.0.0", 1)],
      }));
      await staleLoadMore.promise;
    });
    expect(screen.queryByRole("link", { name: "v1.0.0" })).toBeNull();
    expect(screen.getByRole("link", { name: "v4.0.0" })).toBeTruthy();
  });

  it("aborts an in-flight load-more request when the detail unmounts", async () => {
    const staleLoadMore = deferred<CreatorMarketplaceResourceHistoryPage>();
    mocks.getHistory
      .mockResolvedValueOnce(page({ nextCursor: 1 }))
      .mockReturnValueOnce(staleLoadMore.promise);
    const rendered = renderHistory(SELECTED_ID);
    expect(await screen.findByRole("link", { name: "v2.0.0" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "이전 릴리스 더 보기" }));
    const staleSignal = mocks.getHistory.mock.calls[1]?.[2] as AbortSignal;

    rendered.unmount();
    expect(staleSignal.aborted).toBe(true);

    await act(async () => {
      staleLoadMore.resolve(page({
        items: [item(VISIBLE_ID, "1.0.0", 1)],
      }));
      await staleLoadMore.promise;
    });
  });
});
