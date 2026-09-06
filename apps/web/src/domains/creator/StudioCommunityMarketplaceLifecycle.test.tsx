// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  StudioOwnedLifecycleBadge,
  StudioOwnedPackageHistory,
  StudioOwnedReleaseLifecycleActions,
} from "./StudioCommunityMarketplaceLifecycle";

import type {
  CreatorMarketplaceOwnedHistoryPage,
  CreatorMarketplaceOwnedRelease,
  CreatorMarketplaceResourceRecord,
} from "@/shared/lib/creator-marketplace-resource-contract";

const mocks = vi.hoisted(() => ({
  listHistory: vi.fn(),
  relist: vi.fn(),
}));

vi.mock("@/src/infrastructure/creator-marketplace-client", () => ({
  listCreatorMarketplaceOwnedHistory: mocks.listHistory,
  relistCreatorMarketplaceResource: mocks.relist,
}));

function resource(
  id: string,
  version: string,
  releaseNotes?: string,
): CreatorMarketplaceResourceRecord {
  return {
    id,
    schemaVersion: 1,
    packageId: "community/brush/stable",
    name: `브러시 ${version}`,
    description: "",
    releaseNotes,
    kind: "brush",
    resourceVersion: version,
    minimumStudioVersion: "1.0.0",
    tags: ["brush"],
    license: "cc0-1.0",
    attributionText: "",
    containsAi: false,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: ["canvas2d"] },
    entries: [],
    manifestHash: "a".repeat(64),
    manifestByteSize: 100,
    publisher: { id: "owner-1", name: "작가", avatar: null },
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    isOwner: true,
    access: "free",
  };
}

function release(options: {
  id?: string;
  version?: string;
  ordinal?: number;
  hidden?: boolean;
  delisted?: boolean;
  notes?: string;
} = {}): CreatorMarketplaceOwnedRelease {
  return {
    resource: resource(
      options.id ?? "123e4567-e89b-42d3-a456-426614174000",
      options.version ?? "2.0.0",
      options.notes,
    ),
    releaseOrdinal: options.ordinal ?? 2,
    hidden: options.hidden ?? false,
    delistedAt: options.delisted ? "2026-08-31T00:00:00.000Z" : null,
    packageModeration: options.hidden
      ? {
          state: "hidden",
          revision: 1,
          hiddenAt: "2026-08-31T00:00:00.000Z",
        }
      : { state: "active", revision: 0, hiddenAt: null },
  };
}

function historyPage(
  items: CreatorMarketplaceOwnedRelease[],
  nextCursor: number | null = null,
): CreatorMarketplaceOwnedHistoryPage {
  return {
    packageId: "community/brush/stable",
    items,
    limit: 8,
    hasMore: nextCursor !== null,
    nextCursor,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("Studio creator marketplace owned lifecycle", () => {
  it("labels listed, delisted, and moderated current heads honestly", () => {
    const { rerender } = render(<StudioOwnedLifecycleBadge release={release()} />);
    expect(screen.getByText("공개 중")).toBeTruthy();
    rerender(<StudioOwnedLifecycleBadge release={release({ delisted: true })} />);
    expect(screen.getByText("목록 내림")).toBeTruthy();
    rerender(<StudioOwnedLifecycleBadge release={release({ hidden: true })} />);
    expect(screen.getByText("관리자 숨김")).toBeTruthy();
  });

  it("keeps a hidden and already-delisted head withdrawn without offering relist", () => {
    render(
      <StudioOwnedReleaseLifecycleActions
        release={release({ hidden: true, delisted: true })}
        onDelist={vi.fn()}
        onRelisted={vi.fn()}
      />,
    );
    expect(screen.getByText(/관리자 숨김과 목록 내림 상태/u))
      .toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("allows only the two-step owner delist flow for a hidden but listed head", async () => {
    const onDelist = vi.fn().mockResolvedValue(true);
    render(
      <StudioOwnedReleaseLifecycleActions
        release={release({ hidden: true })}
        onDelist={onDelist}
        onRelisted={vi.fn()}
      />,
    );

    expect(screen.getByText(/관리자 숨김 중에도 이 head를 목록에서 내릴 수 있습니다/u))
      .toBeTruthy();
    expect(screen.queryByRole("button", { name: "다시 공개" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "목록에서 내리기" }));
    expect(onDelist).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "목록에서 내리기 확인" }));
    await waitFor(() => expect(onDelist).toHaveBeenCalledOnce());
  });

  it("uses two-step, single-flight relist and stays retryable after an error", async () => {
    const first = deferred<never>();
    const onRelisted = vi.fn();
    mocks.relist
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({
        relisted: true,
        changed: true,
        id: "123e4567-e89b-42d3-a456-426614174000",
        delistedAt: null,
      });
    render(
      <StudioOwnedReleaseLifecycleActions
        release={release({ delisted: true })}
        onDelist={vi.fn()}
        onRelisted={onRelisted}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "다시 공개" }));
    const confirm = screen.getByRole("button", { name: "다시 공개 확인" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mocks.relist).toHaveBeenCalledTimes(1);
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      first.reject(new Error("relist conflict"));
      await first.promise.catch(() => undefined);
    });
    expect(screen.getByRole("alert").textContent).toContain("relist conflict");
    fireEvent.click(screen.getByRole("button", { name: "다시 공개 확인" }));
    await waitFor(() => expect(onRelisted).toHaveBeenCalledOnce());
    expect(mocks.relist).toHaveBeenCalledTimes(2);
  });

  it("keeps delist mutation ordered behind explicit confirmation", async () => {
    const onDelist = vi.fn().mockResolvedValue(true);
    render(
      <StudioOwnedReleaseLifecycleActions
        release={release()}
        onDelist={onDelist}
        onRelisted={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "목록에서 내리기" }));
    expect(onDelist).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "목록에서 내리기 확인" }));
    await waitFor(() => expect(onDelist).toHaveBeenCalledOnce());
  });

  it("loads private history on demand, shows notes/status/ordinal, and retries load more without prior-release relist", async () => {
    const head = release({ notes: "현재 개선" });
    const previous = release({
      id: "223e4567-e89b-42d3-a456-426614174000",
      version: "1.0.0",
      ordinal: 1,
      delisted: true,
      notes: "첫 릴리스",
    });
    mocks.listHistory
      .mockResolvedValueOnce(historyPage([head], 1))
      .mockRejectedValueOnce(new Error("history next offline"))
      .mockResolvedValueOnce(historyPage([previous]));
    render(<StudioOwnedPackageHistory head={head} />);
    expect(mocks.listHistory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("내 릴리스 이력"));
    expect(await screen.findByText("현재 개선")).toBeTruthy();
    expect(screen.getByText("릴리스 #2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "이전 릴리스 더 보기" }));
    expect((await screen.findByRole("alert")).textContent).toContain("history next offline");
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    expect(await screen.findByText("첫 릴리스")).toBeTruthy();
    expect(screen.getByText("목록 내림")).toBeTruthy();
    expect(screen.getByText("릴리스 #1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /다시 공개/u })).toBeNull();
    expect(mocks.listHistory.mock.calls[2]?.[0]).toEqual({
      packageId: "community/brush/stable",
      limit: 8,
      cursor: 1,
    });
  });

  it("aborts and invalidates in-flight history load-more when details collapse", async () => {
    const head = release({ notes: "현재 릴리스" });
    const previous = release({
      id: "323e4567-e89b-42d3-a456-426614174000",
      version: "1.0.0",
      ordinal: 1,
      notes: "늦은 이전 릴리스",
    });
    const staleLoadMore = deferred<CreatorMarketplaceOwnedHistoryPage>();
    mocks.listHistory
      .mockResolvedValueOnce(historyPage([head], 1))
      .mockReturnValueOnce(staleLoadMore.promise);
    const { container } = render(<StudioOwnedPackageHistory head={head} />);

    fireEvent.click(screen.getByText("내 릴리스 이력"));
    expect(await screen.findByText("현재 릴리스")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "이전 릴리스 더 보기" }));
    const staleSignal = mocks.listHistory.mock.calls[1]?.[1] as AbortSignal;
    const details = container.querySelector("details");
    expect(details).toBeTruthy();
    if (!details) return;
    details.open = false;
    fireEvent(details, new Event("toggle", { bubbles: false }));
    expect(staleSignal.aborted).toBe(true);

    await act(async () => {
      staleLoadMore.resolve(historyPage([previous]));
      await staleLoadMore.promise;
    });
    expect(screen.queryByText("늦은 이전 릴리스")).toBeNull();
  });
});
