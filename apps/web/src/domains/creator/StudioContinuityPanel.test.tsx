// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioContinuityPanel } from "./StudioContinuityPanel";

import type { El } from "./studio-element-model";
import type { PageState } from "./studio-page-state";


// Own complete store operations before their first await, including reads that
// have not reached the lazy runtime import yet. Import snapshots and a sentinel
// read do not own another read's pending get() response.
const reviewOperations = vi.hoisted(() => ({ pending: new Set<Promise<unknown>>() }));
vi.mock("./quality-review-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./quality-review-store")>();
  function track<T>(operation: Promise<T>): Promise<T> {
    reviewOperations.pending.add(operation);
    // Use both handlers instead of an ignored finally() rejection chain.
    void operation.then(
      () => { reviewOperations.pending.delete(operation); },
      () => { reviewOperations.pending.delete(operation); }
    );
    return operation;
  }
  return {
    ...actual,
    loadStudioQualityReviewState: (key: string) => track(actual.loadStudioQualityReviewState(key)),
    saveStudioQualityReviewState: (key: string, serialized: string) =>
      track(actual.saveStudioQualityReviewState(key, serialized)),
  };
});
async function drainReviewOperations(): Promise<void> {
  while (reviewOperations.pending.size > 0) {
    await Promise.allSettled([...reviewOperations.pending]);
  }
}

const reviewDb = vi.hoisted(() => ({ rows: new Map<string, string>(), get: vi.fn(), set: vi.fn(), asAsyncKeyValueStore: vi.fn(), acquire: vi.fn() }));
vi.mock("./studio-local-database-runtime", () => ({ acquireStudioLocalDatabase: reviewDb.acquire }));
function resetReviewDatabase() {
  reviewDb.rows.clear();
  reviewDb.get.mockReset().mockImplementation(async (key: string) => reviewDb.rows.get(key) ?? null);
  reviewDb.set.mockReset().mockImplementation(async (key: string, value: string) => { reviewDb.rows.set(key, value); });
  reviewDb.asAsyncKeyValueStore.mockReset().mockReturnValue(reviewDb);
  reviewDb.acquire.mockReset().mockResolvedValue(reviewDb);
}

function page(
  elements: readonly El[],
  overrides: Partial<PageState> = {}
): PageState {
  return {
    id: "page-1",
    name: "1화",
    elements: [...elements],
    bg: "#ffffff",
    bgGrad: null,
    canvasH: 2_000,
    review: { status: "approved", locked: true },
    ...overrides,
  };
}

function frame(): Extract<El, { type: "frame" }> {
  return {
    id: "frame-1",
    type: "frame",
    x: 20,
    y: 20,
    width: 680,
    height: 500,
  };
}

beforeEach(() => {
  expect(reviewOperations.pending.size).toBe(0);
  resetReviewDatabase();
  localStorage.clear();
});

afterEach(async () => {
  cleanup();
  await act(async () => { await drainReviewOperations(); });
  expect(reviewOperations.pending.size).toBe(0);
  vi.clearAllMocks();
});

describe("StudioContinuityPanel quality center", () => {
  it("presents the integrated quality center and closes with Escape", async () => {
    const onClose = vi.fn();
    render(
      <StudioContinuityPanel
        open
        onClose={onClose}
        issues={[]}
        pages={[page([frame()])]}
        currentPageId="page-1"
      />
    );

    expect(screen.getByRole("dialog").getAttribute("data-studio-quality-inspection")).toBe("true");
    expect(screen.getByText("마감·품질 검사 센터")).not.toBeNull();
    expect(screen.getByText("최종 수동 확인")).not.toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("allows warning acknowledgement but never lets a blocking source failure be dismissed", async () => {
    const draftView = render(
      <StudioContinuityPanel
        open
        onClose={vi.fn()}
        issues={[]}
        documentKey="draft-warning"
        pages={[
          page([frame()], {
            review: { status: "draft", locked: false },
          }),
        ]}
        currentPageId="page-1"
      />
    );

    const [acknowledge] = await screen.findAllByRole("button", {
      name: "의도된 상태로 확인",
    });
    expect(acknowledge).toBeDefined();
    await waitFor(() => expect((acknowledge as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(acknowledge!);
    fireEvent.click(screen.getByRole("checkbox", { name: /확인됨/u }));
    expect(screen.getByRole("button", { name: "확인 취소" }).getAttribute("aria-pressed")).toBe("true");
    draftView.unmount();

    render(
      <StudioContinuityPanel
        open
        onClose={vi.fn()}
        issues={[]}
        documentKey="broken-image"
        pages={[
          page([
            {
              id: "image-1",
              type: "image",
              src: "",
              x: 20,
              y: 20,
              width: 300,
              height: 300,
              rotation: 0,
            },
          ]),
        ]}
        currentPageId="page-1"
      />
    );

    const title = await screen.findByText("이미지 원본 누락");
    const issueCard = title.closest("li");
    expect(issueCard).not.toBeNull();
    expect(
      within(issueCard!).queryByRole("button", { name: "의도된 상태로 확인" })
    ).toBeNull();
  });

  it("navigates to exact defects and connects the two existing finishing tools", async () => {
    const onSelectTarget = vi.fn();
    const onOpenScrollPreview = vi.fn();
    const onOpenPublishPreflight = vi.fn();
    render(
      <StudioContinuityPanel
        open
        onClose={vi.fn()}
        issues={[]}
        pages={[
          page([
            {
              id: "image-1",
              type: "image",
              src: "",
              x: 20,
              y: 20,
              width: 300,
              height: 300,
              rotation: 0,
            },
          ]),
        ]}
        currentPageId="page-1"
        onSelectTarget={onSelectTarget}
        onOpenScrollPreview={onOpenScrollPreview}
        onOpenPublishPreflight={onOpenPublishPreflight}
      />
    );

    const missingSource = (await screen.findByText("이미지 원본 누락")).closest("li");
    expect(missingSource).not.toBeNull();
    fireEvent.click(within(missingSource!).getByRole("button", { name: "위치로 이동" }));
    expect(onSelectTarget).toHaveBeenCalledWith({
      pageId: "page-1",
      elementId: "image-1",
    });

    fireEvent.click(screen.getByRole("button", { name: "세로 미리보기" }));
    fireEvent.click(screen.getByRole("button", { name: "게시 규격 사전검사" }));
    expect(onOpenScrollPreview).toHaveBeenCalledTimes(1);
    expect(onOpenPublishPreflight).toHaveBeenCalledTimes(1);
  });
});
