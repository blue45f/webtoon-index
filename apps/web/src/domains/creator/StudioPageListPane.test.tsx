// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resetStudioDestructiveActionLedger,
  setStudioDestructiveConfirmPresenter,
  type StudioDestructiveActionRequest,
} from "./studio-destructive-action-preview";
import { STUDIO_MOBILE_PAGES_SHEET_ID } from "./studio-mobile-sheet-snap";
import { createStudioUiPreferencesRepository } from "./studio-ui-preferences-sqlite";
import {
  StudioPageListPane,
  type StudioPageListPaneHandlers,
  type StudioPageListPaneProps,
} from "./StudioPageListPane";

import type { PageState } from "./studio-page-state";

/**
 * 파괴 승인은 이제 구조화된 요청을 거친다(네이티브 confirm 문자열이 아니다).
 * 테스트는 그 요청을 받아 적고 승인한다 — 문구가 아니라 계약을 검사한다.
 */
function captureApprovals(): readonly StudioDestructiveActionRequest[] {
  const seen: StudioDestructiveActionRequest[] = [];
  setStudioDestructiveConfirmPresenter((request) => {
    seen.push(request);
    return true;
  });
  return seen;
}

/** 승인이 비동기라 클릭 뒤 마이크로태스크를 흘려보낸다. */
async function settleApproval(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

vi.mock("./studio-page-lazy-ui", () => ({
  StudioPageThumbnail: ({ page, className }: { page: PageState; className?: string }) => (
    <div data-testid={`page-thumbnail-${page.id}`} data-class-name={className}>{page.id}</div>
  ),
}));

function createUiPreferencesHarness() {
  const values = new Map<string, string>();
  const repository = createStudioUiPreferencesRepository({
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
    delete: async (key) => { values.delete(key); },
  });
  return { values, acquire: async () => repository };
}

const PAGES: PageState[] = [
  {
    id: "page-1",
    name: "첫 장면",
    elements: [],
    bg: "#ffffff",
    bgGrad: null,
    canvasH: 2_000,
  },
  {
    id: "page-2",
    name: "두 번째",
    elements: [],
    bg: "#ffffff",
    bgGrad: null,
    canvasH: 2_000,
  },
  {
    id: "page-3",
    name: "세 번째",
    elements: [],
    bg: "#ffffff",
    bgGrad: null,
    canvasH: 2_000,
  },
];

function createHandlers(): StudioPageListPaneHandlers {
  return {
    addPage: vi.fn(),
    applyBgToAll: vi.fn(),
    applyGradeToAll: vi.fn(),
    clearPageFor: vi.fn(),
    commitPageMeta: vi.fn(),
    deletePage: vi.fn(),
    deletePagesBulk: vi.fn(),
    duplicatePage: vi.fn(),
    duplicatePageMirrored: vi.fn(),
    insertPageAfter: vi.fn(),
    insertPageBefore: vi.fn(),
    movePageDown: vi.fn(),
    movePagesBulk: vi.fn(),
    movePageToBottom: vi.fn(),
    movePageToTop: vi.fn(),
    movePageUp: vi.fn(),
  };
}

function createProps(
  overrides: Partial<StudioPageListPaneProps> = {},
): StudioPageListPaneProps {
  return {
    collaborationDocumentLocked: false,
    collaborationLockMessage: () => "협업 잠금",
    composeWorkAssetPreviewPage: (page) => page,
    currentPageId: "page-1",
    isMobile: false,
    leftResize: {
      width: 180,
      dragging: false,
      setWidth: vi.fn(),
      handleProps: {
        role: "separator",
        "aria-orientation": "vertical",
        "aria-valuenow": 180,
        "aria-valuetext": "180픽셀",
        "aria-valuemin": 128,
        "aria-valuemax": 360,
        tabIndex: 0,
        onPointerDown: vi.fn(),
        onKeyDown: vi.fn(),
        onDoubleClick: vi.fn(),
      },
    },
    master: { elements: [] },
    masterEditMode: false,
    masterPanelOpen: false,
    metaEditPageId: null,
    mobileKeyboardInset: 0,
    mobileSheet: null,
    pageDnd: {
      dragIndex: null,
      dropSlot: null,
      indicatorFor: () => null,
      itemProps: () => ({
        draggable: true,
        onDragStart: vi.fn(),
        onDragOver: vi.fn(),
        onDrop: vi.fn(),
        onDragEnd: vi.fn(),
      }),
    },
    pages: PAGES,
    pagesSheetRef: { current: null },
    presentationPanelsHidden: false,
    setCurrentPageId: vi.fn(() => true),
    setLeftPanelOpen: vi.fn(),
    setMasterPanelOpen: vi.fn(),
    setMetaEditPageId: vi.fn(),
    setMobileSheet: vi.fn(),
    visibleLeftPanelOpen: true,
    stableHandlers: createHandlers(),
    acquireUiPreferences: createUiPreferencesHarness().acquire,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  resetStudioDestructiveActionLedger();
});

describe("StudioPageListPane", () => {
  it("keeps selection and page CRUD routed through the caller-owned contracts", async () => {
    const props = createProps();
    const approvals = captureApprovals();
    render(<StudioPageListPane {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "두 번째 선택" }));
    expect(props.setCurrentPageId).toHaveBeenCalledWith("page-2");

    vi.mocked(props.setCurrentPageId).mockClear();
    const secondPage = within(screen.getAllByTestId("studio-page-item")[1]!);
    fireEvent.click(secondPage.getByRole("button", { name: "페이지 복제" }));
    fireEvent.click(secondPage.getByRole("button", { name: "미러 복제 (좌우 반전)" }));
    fireEvent.click(secondPage.getByRole("button", { name: "이 앞에 빈 페이지 삽입" }));
    fireEvent.click(secondPage.getByRole("button", { name: "이 뒤에 빈 페이지 삽입" }));
    fireEvent.click(secondPage.getByRole("button", { name: "이 페이지 내용 비우기" }));
    fireEvent.click(secondPage.getByRole("button", { name: "페이지 삭제" }));
    await settleApproval();

    expect(props.stableHandlers.duplicatePage).toHaveBeenCalledWith("page-2");
    expect(props.stableHandlers.duplicatePageMirrored).toHaveBeenCalledWith("page-2");
    expect(props.stableHandlers.insertPageBefore).toHaveBeenCalledWith("page-2");
    expect(props.stableHandlers.insertPageAfter).toHaveBeenCalledWith("page-2");
    expect(props.stableHandlers.clearPageFor).toHaveBeenCalledWith("page-2");
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      id: "studio.page.delete",
      title: "2페이지 삭제",
      reversibility: "undoable",
    });
    expect(props.stableHandlers.deletePage).toHaveBeenCalledWith("page-2");
    expect(props.setCurrentPageId).not.toHaveBeenCalled();
  });

  it("delegates ordered page moves and preserves the DnD card contract", () => {
    const onDragStart = vi.fn();
    const onDragOver = vi.fn();
    const onDrop = vi.fn();
    const onDragEnd = vi.fn();
    const itemProps = vi.fn((_index: number) => ({
      draggable: true,
      onDragStart,
      onDragOver,
      onDrop,
      onDragEnd,
    }));
    const indicatorFor = vi.fn((index: number) => (index === 1 ? "before" as const : null));
    const props = createProps({
      pageDnd: {
        dragIndex: 1,
        dropSlot: 1,
        itemProps,
        indicatorFor,
      },
    });
    render(<StudioPageListPane {...props} />);

    expect(itemProps.mock.calls.map(([index]) => index)).toEqual([0, 1, 2]);
    expect(indicatorFor.mock.calls.map(([index]) => index)).toEqual([0, 1, 2]);

    const items = screen.getAllByTestId("studio-page-item");
    const [firstPage, secondPage] = items;
    expect(firstPage?.getAttribute("draggable")).toBe("true");
    expect(secondPage?.classList.contains("opacity-50")).toBe(true);
    expect(
      Array.from(secondPage!.querySelectorAll('span[aria-hidden="true"]')).some((node) =>
        node.className.includes("h-[3px]"),
      ),
    ).toBe(true);

    fireEvent.dragStart(firstPage!);
    fireEvent.dragOver(firstPage!);
    fireEvent.drop(firstPage!);
    fireEvent.dragEnd(firstPage!);
    expect(onDragStart).toHaveBeenCalledOnce();
    expect(onDragOver).toHaveBeenCalledOnce();
    expect(onDrop).toHaveBeenCalledOnce();
    expect(onDragEnd).toHaveBeenCalledOnce();

    const thirdPage = items[2];
    fireEvent.click(within(firstPage!).getByRole("button", { name: "아래로 이동" }));
    fireEvent.click(within(firstPage!).getByRole("button", { name: "맨 아래로 이동" }));
    fireEvent.click(within(secondPage!).getByRole("button", { name: "위로 이동" }));
    fireEvent.click(within(secondPage!).getByRole("button", { name: "맨 위로 이동" }));
    fireEvent.click(within(thirdPage!).getByRole("button", { name: "위로 이동" }));
    fireEvent.click(within(thirdPage!).getByRole("button", { name: "맨 위로 이동" }));

    expect(props.stableHandlers.movePageDown).toHaveBeenCalledWith("page-1");
    expect(props.stableHandlers.movePageToBottom).toHaveBeenCalledWith("page-1");
    expect(props.stableHandlers.movePageUp).toHaveBeenCalledWith("page-2");
    expect(props.stableHandlers.movePageToTop).toHaveBeenCalledWith("page-2");
    expect(props.stableHandlers.movePageUp).toHaveBeenCalledWith("page-3");
    expect(props.stableHandlers.movePageToTop).toHaveBeenCalledWith("page-3");
    expect(within(firstPage!).getByRole<HTMLButtonElement>("button", { name: "위로 이동" }).disabled).toBe(true);
    expect(within(firstPage!).getByRole<HTMLButtonElement>("button", { name: "맨 위로 이동" }).disabled).toBe(true);
    expect(within(thirdPage!).getByRole<HTMLButtonElement>("button", { name: "아래로 이동" }).disabled).toBe(true);
    expect(within(thirdPage!).getByRole<HTMLButtonElement>("button", { name: "맨 아래로 이동" }).disabled).toBe(true);
  });

  it("preserves batch actions and inline page metadata commits", () => {
    const props = createProps({ metaEditPageId: "page-1" });
    render(<StudioPageListPane {...props} />);

    const addPage = screen.getByRole("button", { name: "새 페이지 추가" });
    expect(addPage.textContent).toContain("페이지 추가");
    fireEvent.click(addPage);
    fireEvent.click(screen.getByRole("button", { name: "그레이드 전체" }));
    fireEvent.click(screen.getByRole("button", { name: "배경 전체" }));
    expect(props.stableHandlers.addPage).toHaveBeenCalledOnce();
    expect(props.stableHandlers.applyGradeToAll).toHaveBeenCalledOnce();
    expect(props.stableHandlers.applyBgToAll).toHaveBeenCalledOnce();

    const name = screen.getByRole("textbox", { name: "페이지 이름" });
    fireEvent.change(name, { target: { value: "수정 이름" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(props.stableHandlers.commitPageMeta).toHaveBeenCalledWith("page-1", {
      name: "수정 이름",
    });
    expect(props.setMetaEditPageId).toHaveBeenCalledWith(null);

    const note = screen.getByRole("textbox", { name: "콘티 메모" });
    fireEvent.change(note, { target: { value: "카메라를 천천히 당긴다" } });
    fireEvent.blur(note);
    expect(props.stableHandlers.commitPageMeta).toHaveBeenCalledWith("page-1", {
      note: "카메라를 천천히 당긴다",
    });
  });

  it("adjusts and persists page preview density in SQLite for long EX-style projects", async () => {
    const preferences = createUiPreferencesHarness();
    const props = createProps({ acquireUiPreferences: preferences.acquire });
    const view = render(<StudioPageListPane {...props} />);
    await waitFor(() => {
      expect(
        document.querySelector("[data-studio-sheet-id='pages']")
          ?.getAttribute("data-studio-ui-preferences-authority"),
      ).toBe("sqlite-opfs");
    });
    const size = screen.getByRole<HTMLInputElement>("slider", {
      name: "페이지 미리보기 크기 조절",
    });

    expect(size.value).toBe("1");
    expect(size.getAttribute("aria-valuetext")).toBe("보통");
    expect(screen.getByTestId("page-thumbnail-page-1").getAttribute("data-class-name")).toBe(
      "h-24",
    );

    fireEvent.change(size, { target: { value: "0" } });
    expect(size.getAttribute("aria-valuetext")).toBe("작게");
    expect(screen.getByTestId("page-thumbnail-page-1").getAttribute("data-class-name")).toBe(
      "h-14",
    );
    await waitFor(() => expect(preferences.values.get("page-preview-size")).toBe("compact"));

    view.unmount();
    render(<StudioPageListPane {...props} />);
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLInputElement>("slider", { name: "페이지 미리보기 크기 조절" }).value,
      ).toBe("0");
    });
  });

  it("keeps preview changes in-session but discloses a non-durable preference authority", async () => {
    const props = createProps({
      acquireUiPreferences: async () => { throw new Error("OPFS unavailable"); },
    });
    render(<StudioPageListPane {...props} />);
    expect((await screen.findByRole("status")).textContent).toContain("이번 탭에서만 유지");
    expect(
      document.querySelector("[data-studio-sheet-id='pages']")
        ?.getAttribute("data-studio-ui-preferences-authority"),
    ).toBe("memory-only");
    fireEvent.change(screen.getByRole("slider", { name: "페이지 미리보기 크기 조절" }), {
      target: { value: "2" },
    });
    expect(
      screen.getByRole("slider", { name: "페이지 미리보기 크기 조절" })
        .getAttribute("aria-valuetext"),
    ).toBe("크게");
  });

  it("keeps the mobile sheet inert while closed and restores modal semantics when opened", async () => {
    const props = createProps({
      isMobile: true,
      mobileKeyboardInset: 24,
      mobileSheet: null,
    });
    const view = render(<StudioPageListPane {...props} />);
    let sheet = document.querySelector<HTMLElement>('[data-studio-sheet-id="pages"]');

    expect(sheet).not.toBeNull();
    expect(sheet?.id).toBe(STUDIO_MOBILE_PAGES_SHEET_ID);
    expect(sheet?.hasAttribute("inert")).toBe(true);
    expect(sheet?.getAttribute("aria-hidden")).toBe("true");
    expect(sheet?.getAttribute("aria-modal")).toBeNull();
    expect(sheet?.getAttribute("role")).toBeNull();
    expect(sheet?.getAttribute("aria-label")).toBeNull();
    expect(sheet?.getAttribute("tabindex")).toBeNull();
    expect(sheet?.style.bottom).toBe("24px");
    expect(screen.queryByRole("button", { name: "새 페이지 추가" })).toBeNull();

    view.rerender(<StudioPageListPane {...props} mobileSheet="pages" />);
    sheet = document.querySelector<HTMLElement>('[data-studio-sheet-id="pages"]');
    expect(sheet?.hasAttribute("inert")).toBe(false);
    expect(sheet?.getAttribute("aria-hidden")).toBeNull();
    expect(sheet?.getAttribute("aria-modal")).toBe("true");
    expect(sheet?.getAttribute("role")).toBe("dialog");
    expect(sheet?.getAttribute("aria-label")).toBe("페이지 목록");
    expect(sheet?.getAttribute("tabindex")).toBe("-1");
    expect(sheet?.getAttribute("data-popup-kind")).toBe("sheet");
    expect(sheet?.getAttribute("data-studio-sheet-snap")).toBe("medium");
    const addPage = within(sheet!).getByRole("button", { name: "새 페이지 추가" });
    fireEvent.click(addPage);
    expect(props.stableHandlers.addPage).toHaveBeenCalledOnce();

    fireEvent.click(await screen.findByRole("slider", { name: /페이지 시트 크기 조절/ }));
    expect(sheet?.getAttribute("data-studio-sheet-snap")).toBe("full");
  });

  it("uses arrow keys to resize one level, clamps at compact, and closes explicitly", async () => {
    const props = createProps({
      isMobile: true,
      mobileSheet: "pages",
    });
    render(<StudioPageListPane {...props} />);
    const handle = await screen.findByRole("slider", { name: /페이지 시트 크기 조절/ });
    const sheet = document.querySelector<HTMLElement>('[data-studio-sheet-id="pages"]');

    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(sheet?.getAttribute("data-studio-sheet-snap")).toBe("compact");
    expect(props.setMobileSheet).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(handle, { key: "ArrowDown" })).toBe(false);
    expect(props.setMobileSheet).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "페이지 시트 닫기" }));
    expect(props.setMobileSheet).toHaveBeenCalledWith(null);
  });

  it("multi-selects with meta/shift and routes bulk move/delete through stable handlers", async () => {
    const props = createProps();
    const approvals = captureApprovals();
    render(<StudioPageListPane {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "첫 장면 선택" }));
    expect(props.setCurrentPageId).toHaveBeenCalledWith("page-1");
    expect(screen.queryByTestId("studio-page-bulk-toolbar")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "두 번째 선택" }), { metaKey: true });
    expect(props.setCurrentPageId).toHaveBeenCalledWith("page-2");
    expect(screen.getByTestId("studio-page-bulk-toolbar")).toBeTruthy();
    expect(screen.getByText("2개 선택")).toBeTruthy();

    const items = screen.getAllByTestId("studio-page-item");
    expect(items[0]?.getAttribute("data-selected")).toBe("true");
    expect(items[1]?.getAttribute("data-selected")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "세 번째 선택" }), { shiftKey: true });
    expect(screen.getByText("3개 선택")).toBeTruthy();

    fireEvent.click(screen.getByTestId("studio-page-bulk-move-up"));
    fireEvent.click(screen.getByTestId("studio-page-bulk-move-down"));
    expect(props.stableHandlers.movePagesBulk).toHaveBeenNthCalledWith(
      1,
      ["page-1", "page-2", "page-3"],
      -1,
    );
    expect(props.stableHandlers.movePagesBulk).toHaveBeenNthCalledWith(
      2,
      ["page-1", "page-2", "page-3"],
      1,
    );

    fireEvent.click(screen.getByTestId("studio-page-bulk-delete"));
    await settleApproval();
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      id: "studio.page.delete-bulk",
      reversibility: "undoable",
      losses: [
        {
          label: "선택한 페이지",
          count: 3,
          note: "각 페이지의 요소가 함께 사라져요",
        },
      ],
    });
    expect(props.stableHandlers.deletePagesBulk).toHaveBeenCalledWith([
      "page-1",
      "page-2",
      "page-3",
    ]);
    // bulk delete clears multi-select toolbar
    expect(screen.queryByTestId("studio-page-bulk-toolbar")).toBeNull();
  });

  it("plain click collapses multi-select to a single page", () => {
    const props = createProps();
    render(<StudioPageListPane {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "첫 장면 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "두 번째 선택" }), { ctrlKey: true });
    expect(screen.getByTestId("studio-page-bulk-toolbar")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "세 번째 선택" }));
    expect(screen.queryByTestId("studio-page-bulk-toolbar")).toBeNull();
    expect(props.setCurrentPageId).toHaveBeenLastCalledWith("page-3");
    const items = screen.getAllByTestId("studio-page-item");
    expect(items[2]?.getAttribute("data-selected")).toBe("true");
    // Unselected rows omit the attribute or set it false depending on markup.
    expect(items[0]?.getAttribute("data-selected")).not.toBe("true");
  });
  it("keeps every page-row action at or above the 24px WCAG 2.2 target size", () => {
    // 감사 근거(docs/rewrite/ux-audit-v5.md §2.9): 데스크톱에서 페이지 행 아이콘 버튼 11개가
    // 18x18(맨 위로/아래로는 14x14)로 WCAG 2.2 AA 2.5.8을 어겼다. `페이지 삭제` 같은 파괴적
    // 명령이 가장 작았다. 모바일은 size-11(44px), 데스크톱은 lg:size-6(24px)이 최소 계약이다.
    const props = createProps();
    render(<StudioPageListPane {...props} />);

    const rowActionLabels = [
      "위로 이동",
      "아래로 이동",
      "맨 위로 이동",
      "맨 아래로 이동",
      "이 앞에 빈 페이지 삽입",
      "이 뒤에 빈 페이지 삽입",
      "페이지 복제",
      "미러 복제 (좌우 반전)",
      "이 페이지 내용 비우기",
      "페이지 삭제",
    ];

    const firstPage = screen.getAllByTestId("studio-page-item")[0];
    expect(firstPage).toBeTruthy();
    if (!firstPage) return;

    for (const label of rowActionLabels) {
      const button = within(firstPage).getByRole("button", { name: label });
      expect(button.className, label).toContain("size-11");
      expect(button.className, label).toContain("lg:size-6");
      expect(button.className, label).not.toContain("lg:size-auto");
      expect(button.className, label).not.toContain("lg:p-0.5");
    }

    const metaEdit = within(firstPage).getByRole("button", {
      name: /이름·콘티 메모 편집/u,
    });
    expect(metaEdit.className).toContain("lg:size-6");
    expect(metaEdit.className).not.toContain("lg:p-0.5");
  });
});
