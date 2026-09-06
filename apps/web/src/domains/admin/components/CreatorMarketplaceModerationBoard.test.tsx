// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreatorMarketplaceModerationBoard } from "./CreatorMarketplaceModerationBoard";

import type {
  CreatorMarketplaceResourceModerationQueueItem,
  CreatorMarketplaceResourceModerationQueuePage,
} from "@/shared/lib/creator-marketplace-resource-contract";

const mocks = vi.hoisted(() => ({
  dismissOrphan: vi.fn(),
  listQueue: vi.fn(),
  moderate: vi.fn(),
}));

vi.mock("@/src/infrastructure/creator-marketplace-client", () => ({
  dismissOrphanedReport: mocks.dismissOrphan,
  listCreatorMarketplaceModerationQueue: mocks.listQueue,
  moderateCreatorMarketplaceResource: mocks.moderate,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function queueItem({
  hidden = false,
  delisted = false,
  resourceExists = true,
  reportId = "123e4567-e89b-42d3-a456-426614174000",
  resourceId = "223e4567-e89b-42d3-a456-426614174000",
  headId = resourceId,
  availabilityReason,
}: {
  hidden?: boolean;
  delisted?: boolean;
  resourceExists?: boolean;
  reportId?: string;
  resourceId?: string;
  headId?: string;
  availabilityReason?: "moderated" | "owner-delisted" | "publisher-unavailable";
} = {}): CreatorMarketplaceResourceModerationQueueItem {
  return {
    reportId,
    reason: "misleading",
    details: "설명은 무료 브러시지만 외부 결제를 유도합니다.",
    status: "open",
    resolutionNote: "",
    reporter: { id: "reporter-1", name: "신고 사용자" },
    reviewedBy: null,
    reviewedAt: null,
    createdAt: "2026-08-31T01:00:00.000Z",
    evidence: {
      schemaVersion: 1,
      resourceId,
      packageId: "original/brush/reported-ink",
      name: "신고된 잉크 브러시",
      kind: "brush",
      resourceVersion: "1.2.0",
      license: "toonspectrum-standard",
      manifestHash: "a".repeat(64),
      manifestByteSize: 2_048,
      releaseCreatedAt: "2026-08-30T01:00:00.000Z",
    },
    currentResource: resourceExists
      ? {
          id: resourceId,
          hidden,
          delistedAt: delisted ? "2026-08-31T02:00:00.000Z" : null,
        }
      : null,
    currentPackage: resourceExists
      ? {
          publisherId: "publisher-1",
          packageId: "original/brush/reported-ink",
          moderationTargetId: headId,
          moderation: hidden
            ? {
                state: "hidden",
                revision: 1,
                hiddenAt: "2026-08-31T02:00:00.000Z",
              }
            : { state: "active", revision: 0, hiddenAt: null },
          availability: hidden || delisted || availabilityReason
            ? {
                state: "unavailable",
                reason: hidden
                  ? "moderated"
                  : availabilityReason ?? "owner-delisted",
              }
            : { state: "available", currentHead: { id: headId } },
        }
      : null,
  };
}

function page(
  items: CreatorMarketplaceResourceModerationQueueItem[],
  options: { offset?: number; hasMore?: boolean; nextOffset?: number | null } = {},
): CreatorMarketplaceResourceModerationQueuePage {
  return {
    items,
    status: "open",
    limit: 10,
    offset: options.offset ?? 0,
    hasMore: options.hasMore ?? false,
    nextOffset: options.nextOffset ?? null,
  };
}

function renderBoard() {
  return render(
    <MemoryRouter>
      <CreatorMarketplaceModerationBoard />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(cleanup);

describe("CreatorMarketplaceModerationBoard", () => {
  it("shows loading/error/retry/empty states for the open no-store queue", async () => {
    const pending = deferred<CreatorMarketplaceResourceModerationQueuePage>();
    mocks.listQueue
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(page([]));
    renderBoard();

    expect(screen.getByRole("status", { name: "Creator Market 신고 목록 불러오는 중" }))
      .toBeTruthy();
    pending.reject(new Error("검수 API에 연결하지 못했습니다."));
    expect((await screen.findByRole("alert")).textContent)
      .toContain("검수 API에 연결하지 못했습니다.");

    fireEvent.click(screen.getByRole("button", { name: "목록 다시 불러오기" }));
    expect(await screen.findByText("검수 대기 중인 Creator Market 신고가 없습니다."))
      .toBeTruthy();
    expect(screen.getByText("이 표시는 현재 열린 신고 큐만 비어 있다는 뜻입니다."))
      .toBeTruthy();
    expect(mocks.listQueue).toHaveBeenNthCalledWith(
      2,
      { status: "open", limit: 10, offset: 0 },
      expect.any(AbortSignal),
    );
  });

  it("renders immutable evidence/current state and follows server pagination offsets", async () => {
    const firstItem = queueItem({ delisted: true });
    mocks.listQueue
      .mockResolvedValueOnce(page([firstItem], { hasMore: true, nextOffset: 10 }))
      .mockResolvedValueOnce(page([], { offset: 10 }));
    renderBoard();

    expect(await screen.findByRole("heading", { name: "신고된 잉크 브러시" }))
      .toBeTruthy();
    expect(screen.getByText("오해를 부르는 설명")).toBeTruthy();
    expect(screen.getByText("original/brush/reported-ink · v1.2.0")).toBeTruthy();
    expect(screen.getByText("a".repeat(64))).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
    expect(screen.getByText(/현재 상태 · 배급자 목록 내림/u)).toBeTruthy();
    expect(screen.getByText(/복원 액션으로 다시 게시되지 않습니다/u)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "현재 공개 상세 확인" })).toBeNull();
    expect(screen.getByText("1–1번째 열린 신고")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() => expect(mocks.listQueue).toHaveBeenNthCalledWith(
      2,
      { status: "open", limit: 10, offset: 10 },
      expect.any(AbortSignal),
    ));
    expect(await screen.findByText("표시 항목 없음")).toBeTruthy();
    expect((screen.getByRole("button", { name: "이전" }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it("requires a resolution note and removes reports only after a committed moderation result", async () => {
    const item = queueItem({ delisted: true });
    const pending = deferred<{
      moderated: true;
      action: "hide";
      hidden: boolean;
      delisted: boolean;
      reviewedReportCount: number;
    }>();
    mocks.listQueue.mockResolvedValue(page([item]));
    mocks.moderate.mockReturnValue(pending.promise);
    renderBoard();

    expect(await screen.findByText(item.evidence.name)).toBeTruthy();
    const hide = screen.getByRole("button", { name: "숨김" }) as HTMLButtonElement;
    const restore = screen.getByRole("button", { name: "숨김 해제" }) as HTMLButtonElement;
    const dismiss = screen.getByRole("button", { name: "신고 기각" }) as HTMLButtonElement;
    expect(hide.disabled).toBe(true);
    expect(restore.disabled).toBe(true);
    expect(dismiss.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("해결 메모 (필수)"), {
      target: { value: "  외부 결제 안내를 확인해 임시 숨김  " },
    });
    expect(hide.disabled).toBe(false);
    expect(restore.disabled).toBe(true);
    expect(dismiss.disabled).toBe(false);
    hide.focus();
    fireEvent.click(hide);
    hide.blur();

    expect(mocks.moderate).toHaveBeenCalledWith(item.currentResource?.id, {
      action: "hide",
      sourceReportId: item.reportId,
      note: "외부 결제 안내를 확인해 임시 숨김",
    });
    expect(screen.getByText(item.evidence.name)).toBeTruthy();

    pending.resolve({
      moderated: true,
      action: "hide",
      hidden: true,
      delisted: true,
      reviewedReportCount: 2,
    });
    await waitFor(() => expect(screen.queryByText(item.evidence.name)).toBeNull());
    expect(screen.getByRole("status").textContent)
      .toContain("연관된 열린 신고 2건 처리");
    expect(screen.getByRole("status").textContent)
      .toContain("배급자 목록 내림은 유지됩니다");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("status")));
  });

  it("carries queue provenance and removes every visible report for the moderated package", async () => {
    const current = queueItem({
      reportId: "123e4567-e89b-42d3-a456-426614174010",
      resourceId: "223e4567-e89b-42d3-a456-426614174010",
    });
    const historicalBase = queueItem({
      reportId: "123e4567-e89b-42d3-a456-426614174011",
      resourceId: "223e4567-e89b-42d3-a456-426614174011",
    });
    const historical: CreatorMarketplaceResourceModerationQueueItem = {
      ...historicalBase,
      evidence: {
        ...historicalBase.evidence,
        name: "신고된 잉크 브러시 이전 릴리스",
      },
      currentPackage: current.currentPackage,
    };
    const v3FallbackBase = queueItem({
      reportId: "123e4567-e89b-42d3-a456-426614174012",
      resourceId: "223e4567-e89b-42d3-a456-426614174012",
    });
    const v3Fallback: CreatorMarketplaceResourceModerationQueueItem = {
      ...v3FallbackBase,
      evidence: {
        ...v3FallbackBase.evidence,
        schemaVersion: 3,
        publisherId: "publisher-1",
        packageModerationRevision: 0,
        packageReportEpoch: 2,
        name: "v3 증거만 남은 이전 릴리스",
      },
      currentPackage: null,
    };
    mocks.listQueue.mockResolvedValue(page([historical, current, v3Fallback]));
    mocks.moderate.mockResolvedValue({
      moderated: true,
      action: "hide",
      hidden: true,
      delisted: false,
      reviewedReportCount: 2,
    });
    renderBoard();

    await screen.findByText(current.evidence.name);
    expect(screen.getByText(historical.evidence.name)).toBeTruthy();
    expect(screen.getByText(v3Fallback.evidence.name)).toBeTruthy();
    fireEvent.change(screen.getAllByLabelText("해결 메모 (필수)")[0], {
      target: { value: "패키지 전체 검수 완료" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "숨김" })[0]);

    await waitFor(() => {
      expect(screen.queryByText(current.evidence.name)).toBeNull();
      expect(screen.queryByText(historical.evidence.name)).toBeNull();
      expect(screen.queryByText(v3Fallback.evidence.name)).toBeNull();
    });
    expect(historical.currentResource?.id).not.toBe(current.currentPackage?.moderationTargetId);
    expect(mocks.moderate).toHaveBeenCalledWith(current.currentPackage?.moderationTargetId, {
      action: "hide",
      sourceReportId: historical.reportId,
      note: "패키지 전체 검수 완료",
    });
  });

  it.each([
    ["owner-delisted", "배급자 목록 내림"],
    ["publisher-unavailable", "배급자 사용 불가"],
  ] as const)(
    "reported historical release는 absolute head의 %s 가용성을 사용한다",
    async (availabilityReason, label) => {
      const historicalId = "223e4567-e89b-42d3-a456-426614174020";
      const headId = "223e4567-e89b-42d3-a456-426614174021";
      const item = queueItem({
        resourceId: historicalId,
        headId,
        availabilityReason,
      });
      mocks.listQueue.mockResolvedValue(page([item]));
      mocks.moderate.mockResolvedValue({
        moderated: true,
        action: "hide",
        hidden: true,
        delisted: availabilityReason === "owner-delisted",
        reviewedReportCount: 1,
      });
      renderBoard();

      expect(await screen.findByText(new RegExp(`현재 상태 · ${label}`, "u")))
        .toBeTruthy();
      expect(screen.queryByRole("link", { name: "현재 공개 상세 확인" })).toBeNull();
      fireEvent.change(screen.getByLabelText("해결 메모 (필수)"), {
        target: { value: "절대 head 상태 기준 검수" },
      });
      fireEvent.click(screen.getByRole("button", { name: "숨김" }));

      await waitFor(() => expect(mocks.moderate).toHaveBeenCalledWith(headId, {
        action: "hide",
        sourceReportId: item.reportId,
        note: "절대 head 상태 기준 검수",
      }));
    },
  );

  it("keeps the item and note after failure, then retries only on an explicit action", async () => {
    const item = queueItem({ hidden: true });
    mocks.listQueue.mockResolvedValue(page([item]));
    mocks.moderate
      .mockRejectedValueOnce(new Error("검수 저장소가 일시적으로 응답하지 않습니다."))
      .mockResolvedValueOnce({
        moderated: true,
        action: "restore",
        hidden: false,
        delisted: false,
        reviewedReportCount: 1,
      });
    renderBoard();

    await screen.findByText(item.evidence.name);
    const note = screen.getByLabelText("해결 메모 (필수)") as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: "오탐 확인 후 관리자 숨김 해제" } });
    const restore = screen.getByRole("button", { name: "숨김 해제" });
    restore.focus();
    fireEvent.click(restore);
    (restore as HTMLButtonElement).blur();

    expect((await screen.findByRole("alert")).textContent)
      .toContain("작성한 검수 메모는 유지되었습니다");
    expect(note.value).toBe("오탐 확인 후 관리자 숨김 해제");
    expect(screen.getByText(item.evidence.name)).toBeTruthy();
    expect(mocks.moderate).toHaveBeenCalledTimes(1);
    const retryRestore = screen.getByRole<HTMLButtonElement>("button", {
      name: "숨김 해제",
    });
    await waitFor(() => expect(document.activeElement).toBe(retryRestore));

    fireEvent.click(retryRestore);
    retryRestore.blur();
    await waitFor(() => expect(mocks.moderate).toHaveBeenCalledTimes(2));
    expect(mocks.moderate).toHaveBeenLastCalledWith(
      item.currentPackage?.moderationTargetId,
      {
      action: "restore",
      sourceReportId: item.reportId,
      note: "오탐 확인 후 관리자 숨김 해제",
      },
    );
    expect((await screen.findByRole("status")).textContent)
      .toContain("관리자 숨김 없이 공개 가능한 상태입니다");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("status")));
  });

  it("lets a keyboard-focused admin dismiss an orphan report without pretending to change a resource", async () => {
    const item = queueItem({ resourceExists: false });
    const pending = deferred<{
      dismissed: true;
      reportId: string;
      dismissedReportCount: number;
    }>();
    mocks.listQueue.mockResolvedValue(page([item]));
    mocks.dismissOrphan
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({
        dismissed: true,
        reportId: item.reportId,
        dismissedReportCount: 1,
      });
    renderBoard();

    await screen.findByText(item.evidence.name);
    expect(screen.getByText(/증거 확인 후 이 신고만 기각할 수 있습니다/u))
      .toBeTruthy();
    const note = screen.getByLabelText("해결 메모 (필수)") as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: "  보존 증거 확인 후 원본 없는 신고 종결  " } });
    expect((screen.getByRole("button", { name: "숨김" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect((screen.getByRole("button", { name: "숨김 해제" }) as HTMLButtonElement).disabled)
      .toBe(true);
    const dismiss = screen.getByRole("button", { name: "신고 기각" }) as HTMLButtonElement;
    expect(dismiss.disabled).toBe(false);
    dismiss.focus();
    expect(document.activeElement).toBe(dismiss);
    // A native button remains the keyboard activation authority; fireEvent.click models the
    // click event browsers synthesize for Enter/Space without adding a duplicate onKeyDown path.
    fireEvent.click(dismiss);

    expect(mocks.dismissOrphan).toHaveBeenCalledWith(
      item.reportId,
      "보존 증거 확인 후 원본 없는 신고 종결",
    );
    expect(screen.getByRole("button", { name: "신고 기각 중…" })).toBeTruthy();
    expect(screen.getByText(item.evidence.name)).toBeTruthy();

    note.focus();
    pending.reject(new Error("원본 없는 신고 종결에 실패했습니다."));
    expect((await screen.findByRole("alert")).textContent)
      .toContain("작성한 검수 메모는 유지되었습니다");
    expect(note.value).toBe("  보존 증거 확인 후 원본 없는 신고 종결  ");
    expect(screen.getByText(item.evidence.name)).toBeTruthy();
    expect(mocks.dismissOrphan).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement).toBe(note));

    fireEvent.click(screen.getByRole("button", { name: "신고 기각" }));
    await waitFor(() => expect(mocks.dismissOrphan).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(item.evidence.name)).toBeNull());
    expect(screen.getByRole("status").textContent)
      .toContain("원본 릴리스가 없어 신고 1건만 기각했습니다");
    expect(screen.getByRole("status").textContent)
      .toContain("리소스 공개 상태는 변경하지 않았습니다");
    expect(mocks.moderate).not.toHaveBeenCalled();
  });
});
