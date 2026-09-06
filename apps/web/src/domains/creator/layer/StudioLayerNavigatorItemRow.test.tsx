// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { studioLayerNavigatorItemStatusLabel } from "./studio-layer-navigator-row-ui";
import {
  StudioLayerNavigatorItemRow,
  type LayerNavigatorRowHandlers,
  type StudioLayerNavigatorItemRowProps,
} from "./StudioLayerNavigatorItemRow";

import type { StudioLayerNavigatorItem } from "./studio-layer-navigator";

const ITEM: StudioLayerNavigatorItem = {
  id: "line-art",
  type: "image",
  label: "주인공 원화",
  zIndex: 4,
  role: "color",
  color: "blue",
  fillReference: true,
  alphaLocked: true,
  masked: true,
  maskEnabled: false,
  aiGenerated: true,
  clipBelow: true,
  animated: true,
};

function rowHandlers(
  overrides: Partial<LayerNavigatorRowHandlers> = {}
): LayerNavigatorRowHandlers {
  return {
    onRowFocus: vi.fn(),
    onRowKeyDown: vi.fn(),
    onRowClick: vi.fn(),
    onRowDoubleClick: vi.fn(),
    onToggleItemHidden: vi.fn(),
    onToggleItemLocked: vi.fn(),
    onSetItemOpacity: vi.fn(),
    onPreviewItemOpacity: vi.fn(),
    onOpenItemActionMenu: vi.fn(),
    registerRowRef: vi.fn(),
    ...overrides,
  };
}

function rowProps(
  overrides: Partial<StudioLayerNavigatorItemRowProps> = {}
): StudioLayerNavigatorItemRowProps {
  return {
    item: ITEM,
    rowKey: "item:line-art",
    level: 2,
    kind: "image",
    groupName: "주인공",
    effectivelyHidden: false,
    locallyHidden: false,
    effectivelyLocked: false,
    statusLabel: "채우기 참조, 알파 락, 마스크 꺼짐, AI 작업, 아래 클리핑, 애니메이션",
    selected: false,
    current: false,
    selectionCount: 0,
    tabStop: false,
    renameInput: null,
    mobileMultiSelect: false,
    readOnly: false,
    hiddenByGroup: false,
    lockedByGroup: false,
    actionOpen: false,
    actionPopoverId: "layer-actions",
    stableHandlers: rowHandlers(),
    ...overrides,
  };
}

function renderRow(props: StudioLayerNavigatorItemRowProps) {
  return render(
    <ul role="tree">
      <StudioLayerNavigatorItemRow {...props} />
    </ul>
  );
}

afterEach(cleanup);

describe("StudioLayerNavigatorItemRow", () => {
  it("renders a live ownership badge and blocks peer-held controls", () => {
    renderRow(
      rowProps({
        liveOwnership: {
          kind: "peer",
          resource: "element:page-1:line-art",
          ownerSessionId: "peer-1",
          ownerDisplayName: "민수",
          ownerColor: "#4f8cff",
          statusLabel: "민수 · 편집 중",
          blocksLocalEdit: true,
        },
      })
    );

    const treeItem = screen.getByRole("treeitem");
    expect(treeItem.getAttribute("data-studio-live-ownership")).toBe("peer");
    expect(treeItem.getAttribute("data-studio-live-ownership-blocked")).toBe(
      "true"
    );
    expect(treeItem.getAttribute("aria-label") ?? "").toMatch(/민수 · 편집 중/);

    const badge = document.querySelector(
      '[data-studio-live-ownership-badge="peer"]'
    );
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute("title")).toBe("민수 · 편집 중");
    expect(badge?.textContent).toContain("민");

    const lockButton = screen.getByRole("button", {
      name: /민수 · 편집 중|다른 참가자가 편집 중/,
    });
    expect((lockButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders selected, read-only, group/local-hidden, metadata, mask, and rename state", () => {
    const statusLabel = studioLayerNavigatorItemStatusLabel({
      item: ITEM,
      kind: "image",
      group: null,
      effectivelyHidden: true,
      effectivelyLocked: true,
    });
    expect(statusLabel).toBe(
      "숨김, 잠김, 채우기 참조, 알파 락, 마스크 꺼짐, AI 작업, 아래 클리핑, 애니메이션"
    );

    renderRow(
      rowProps({
        effectivelyHidden: true,
        locallyHidden: true,
        effectivelyLocked: true,
        statusLabel,
        selected: true,
        current: true,
        selectionCount: 1,
        tabStop: true,
        mobileMultiSelect: true,
        readOnly: true,
        hiddenByGroup: true,
        actionOpen: true,
        renameInput: (
          <input aria-label="레이어 이름 편집" defaultValue="새 이름" />
        ),
      })
    );

    const treeItem = screen.getByRole("treeitem", {
      name: /주인공 원화, 현재 작업 레이어, 래스터, 그룹 주인공, 역할 채색, 색 라벨 파랑, 숨김, 잠김.+마스크 꺼짐.+나만 숨김/,
    });
    expect(treeItem.getAttribute("aria-selected")).toBe("true");
    expect(treeItem.getAttribute("aria-current")).toBe("true");
    expect(treeItem.getAttribute("aria-level")).toBe("2");
    expect(treeItem.tabIndex).toBe(0);
    expect(treeItem.dataset.studioLayerSelected).toBe("true");
    expect(treeItem.dataset.studioLayerSelectionState).toBe("current");
    expect(treeItem.dataset.studioLayerLocalHidden).toBe("true");
    expect(treeItem.title).toBe("");
    expect(treeItem.className).toContain("content-visibility:auto");
    expect(treeItem.className).toContain("border-accent/75");
    expect(treeItem.className).toContain("focus-visible:outline-cool");
    expect(screen.getByLabelText("색 라벨 파랑").className).toContain("bg-cool");
    const kindBadge = treeItem.querySelector(
      '[data-studio-layer-kind-badge="raster"]'
    );
    expect(kindBadge?.textContent).toBe("래스터");
    const statusStrip = treeItem.querySelector(
      '[data-studio-layer-status-strip="true"]'
    );
    expect(statusStrip?.getAttribute("aria-label")).toContain(
      "아래 레이어에 클리핑"
    );
    expect(
      statusStrip?.querySelector('[data-studio-layer-status="clipping"]')
    ).not.toBeNull();
    expect(
      statusStrip?.querySelector('[data-studio-layer-status-overflow="3"]')
    ).not.toBeNull();
    expect(
      treeItem.querySelector('[data-studio-layer-selection-marker="current"]')
    ).not.toBeNull();

    const renameInput = screen.getByRole("textbox", {
      name: "레이어 이름 편집",
    }) as HTMLInputElement;
    expect(renameInput.value).toBe("새 이름");

    const visibility = screen.getByRole("button", {
      name: "주인공 원화, 그룹에서 숨김",
    }) as HTMLButtonElement;
    expect(visibility.disabled).toBe(true);
    expect(visibility.title).toBe(
      "상위 그룹이 숨겨져 있어 그룹을 먼저 표시해야 해요"
    );

    const action = screen.getByRole("button", {
      name: "주인공 원화 레이어 작업",
    });
    expect(action.getAttribute("aria-expanded")).toBe("true");
    expect(action.getAttribute("aria-controls")).toBe("layer-actions");
  });

  it("shows a per-row check for multi-selection while keeping focus visually independent", () => {
    renderRow(rowProps({
      selected: true,
      current: false,
      selectionCount: 3,
      effectivelyHidden: true,
      effectivelyLocked: true,
      statusLabel: "숨김, 잠김",
      tabStop: true,
    }));

    const treeItem = screen.getByRole("treeitem", {
      name: /주인공 원화, 다중 선택됨, 래스터.+숨김, 잠김/,
    });
    expect(treeItem.getAttribute("aria-selected")).toBe("true");
    expect(treeItem.hasAttribute("aria-current")).toBe(false);
    expect(treeItem.dataset.studioLayerSelectionState).toBe("selected");
    expect(treeItem.className).toContain("border-accent/50");
    expect(treeItem.className).toContain("focus-visible:outline-cool");
    expect(
      treeItem.querySelector('[data-studio-layer-selection-marker="selected"]')
    ).not.toBeNull();
    expect(treeItem.textContent).toContain("주인공 원화");
    expect(treeItem.innerHTML).not.toContain("opacity-55");
  });

  it("keeps vector and explicit 3D kind badges visible even inside a named group", () => {
    const vector = renderRow(
      rowProps({
        item: { ...ITEM, id: "ink", type: "draw", label: "벡터 선화" },
        rowKey: "item:ink",
        kind: "draw",
        groupName: "주인공 폴더",
      })
    );
    const vectorRow = screen.getByRole("treeitem", { name: /벡터 선화/ });
    expect(
      vectorRow.querySelector('[data-studio-layer-kind-badge="vector"]')
        ?.textContent
    ).toBe("벡터");
    expect(vectorRow.textContent).toContain("주인공 폴더");
    vector.unmount();

    renderRow(
      rowProps({
        item: {
          ...ITEM,
          id: "bg3d",
          type: "image",
          semanticKind: "three-d",
          label: "교실 3D",
        },
        rowKey: "item:bg3d",
        kind: "image",
        groupName: "배경 폴더",
      })
    );
    const threeDRow = screen.getByRole("treeitem", { name: /교실 3D/ });
    expect(
      threeDRow.querySelector('[data-studio-layer-kind-badge="three-d"]')
        ?.textContent
    ).toBe("3D");
    expect(threeDRow.textContent).toContain("배경 폴더");
  });

  it("dispatches visibility and action controls exactly once without selecting the row", () => {
    const onRowClick = vi.fn();
    const onToggleItemHidden = vi.fn();
    const onOpenItemActionMenu = vi.fn();
    const onAncestorClick = vi.fn();
    const handlers = rowHandlers({
      onRowClick,
      onToggleItemHidden,
      onOpenItemActionMenu,
    });

    document.body.addEventListener("click", onAncestorClick);
    try {
      renderRow(rowProps({ stableHandlers: handlers }));

      fireEvent.click(
        screen.getByRole("button", { name: "주인공 원화 숨김" })
      );
      expect(onToggleItemHidden).toHaveBeenCalledOnce();
      expect(onToggleItemHidden).toHaveBeenCalledWith("line-art", true);
      expect(onRowClick).not.toHaveBeenCalled();
      expect(onAncestorClick).not.toHaveBeenCalled();

      fireEvent.click(
        screen.getByRole("button", { name: "주인공 원화 레이어 작업" })
      );
      expect(onOpenItemActionMenu).toHaveBeenCalledOnce();
      expect(onOpenItemActionMenu).toHaveBeenCalledWith(
        expect.anything(),
        "line-art"
      );
      expect(onRowClick).not.toHaveBeenCalled();
      expect(onAncestorClick).not.toHaveBeenCalled();
    } finally {
      document.body.removeEventListener("click", onAncestorClick);
    }
  });

  it("keeps ordinary row focus, keyboard, click, and double-click delegated", () => {
    const onRowFocus = vi.fn();
    const onRowKeyDown = vi.fn();
    const onRowClick = vi.fn();
    const onRowDoubleClick = vi.fn();
    const handlers = rowHandlers({
      onRowFocus,
      onRowKeyDown,
      onRowClick,
      onRowDoubleClick,
    });
    renderRow(rowProps({ stableHandlers: handlers, tabStop: true }));
    const treeItem = screen.getByRole("treeitem");

    fireEvent.focus(treeItem);
    fireEvent.keyDown(treeItem, { key: "Enter" });
    fireEvent.click(treeItem);
    fireEvent.doubleClick(treeItem);

    expect(onRowFocus).toHaveBeenCalledOnce();
    expect(onRowFocus).toHaveBeenCalledWith("item:line-art");
    expect(onRowKeyDown).toHaveBeenCalledOnce();
    expect(onRowKeyDown).toHaveBeenCalledWith(
      expect.anything(),
      "item:line-art"
    );
    expect(onRowClick).toHaveBeenCalledOnce();
    expect(onRowClick).toHaveBeenCalledWith(expect.anything(), "line-art");
    expect(onRowDoubleClick).toHaveBeenCalledOnce();
    expect(onRowDoubleClick).toHaveBeenCalledWith(
      expect.anything(),
      "line-art",
      "주인공 원화"
    );
  });

  it("advertises every supported row navigation, selection, rename, menu, and grouping shortcut", () => {
    renderRow(rowProps({ tabStop: true }));

    expect(screen.getByRole("treeitem").getAttribute("aria-keyshortcuts")).toBe(
      "ArrowUp ArrowDown ArrowLeft ArrowRight Home End Enter Space F2 Shift+F10 Control+A Meta+A Control+G Meta+G Shift+Control+G Shift+Meta+G"
    );
  });

  it("puts 표시·잠금·불투명도 in the row itself, not behind the … popover", () => {
    const onToggleItemHidden = vi.fn();
    const onToggleItemLocked = vi.fn();
    const onSetItemOpacity = vi.fn();
    renderRow(
      rowProps({
        item: { ...ITEM, opacity: 0.6 },
        stableHandlers: rowHandlers({
          onToggleItemHidden,
          onToggleItemLocked,
          onSetItemOpacity,
        }),
      })
    );

    const row = screen.getByRole("treeitem");
    const inline = row.querySelectorAll("[data-studio-layer-row-action]");
    expect([...inline].map((node) => node.getAttribute("data-studio-layer-row-action")))
      .toEqual(["visibility", "lock", "opacity", "menu"]);

    fireEvent.click(screen.getByRole("button", { name: "주인공 원화 숨김" }));
    expect(onToggleItemHidden).toHaveBeenCalledWith("line-art", true);

    fireEvent.click(
      row.querySelector<HTMLButtonElement>('[data-studio-layer-row-action="lock"]')!
    );
    expect(onToggleItemLocked).toHaveBeenCalledWith("line-art", true);

    const opacity = screen.getByRole("slider", { name: "주인공 원화 불투명도" });
    expect(opacity.getAttribute("aria-valuenow")).toBe("60");
    expect(opacity.getAttribute("aria-valuetext")).toBe("60%");
    fireEvent.keyDown(opacity, { key: "ArrowRight" });
    // The preview is immediate; the document write lands once the gesture settles.
    expect(opacity.getAttribute("aria-valuenow")).toBe("61");
    fireEvent.blur(opacity);
    expect(onSetItemOpacity).toHaveBeenCalledWith("line-art", 0.61);
  });

  it("keeps one opacity gesture at one document write while aria-valuenow tracks every step", () => {
    // 측정된 결함(D7): 100 → 87 드래그 한 번이 히스토리 13칸을 먹었다. 스크러버는 제스처 중
    // 프리뷰만 하고, 포인터를 떼거나 키 입력이 멎을 때 한 번만 문서에 쓴다.
    const onSetItemOpacity = vi.fn();
    renderRow(
      rowProps({
        item: { ...ITEM, opacity: 1 },
        stableHandlers: rowHandlers({ onSetItemOpacity }),
      })
    );

    const opacity = screen.getByRole("slider", { name: "주인공 원화 불투명도" });
    const trail: (string | null)[] = [];
    for (let press = 0; press < 8; press += 1) {
      fireEvent.keyDown(opacity, { key: "ArrowLeft" });
      trail.push(opacity.getAttribute("aria-valuenow"));
    }

    expect(trail).toEqual(["99", "98", "97", "96", "95", "94", "93", "92"]);
    expect(opacity.getAttribute("aria-valuetext")).toBe("92%");
    expect(onSetItemOpacity).not.toHaveBeenCalled();

    fireEvent.blur(opacity);
    expect(onSetItemOpacity).toHaveBeenCalledTimes(1);
    expect(onSetItemOpacity).toHaveBeenCalledWith("line-art", 0.92);

    // A trailing blur after the gesture already settled must not write the same edit twice.
    fireEvent.blur(opacity);
    expect(onSetItemOpacity).toHaveBeenCalledTimes(1);
  });

  it("previews every scrub step to the document so the canvas moves before release", () => {
    // 측정된 잔여 갭(D7): 드래그 중에는 행 숫자와 aria-valuenow 만 바뀌고 캔버스 픽셀은
    // pointerup 까지 얼어 있었다. 이제 표본마다 `onPreviewItemOpacity` 가 나가고, 에디터가
    // 같은 키로 합쳐 undo 는 여전히 한 번이다(합치기는 StudioPage 쪽 계약).
    const onSetItemOpacity = vi.fn();
    const onPreviewItemOpacity = vi.fn();
    renderRow(
      rowProps({
        item: { ...ITEM, opacity: 1 },
        stableHandlers: rowHandlers({ onSetItemOpacity, onPreviewItemOpacity }),
      })
    );

    const opacity = screen.getByRole("slider", { name: "주인공 원화 불투명도" });
    for (let press = 0; press < 4; press += 1) {
      fireEvent.keyDown(opacity, { key: "ArrowLeft" });
    }

    expect(onPreviewItemOpacity.mock.calls).toEqual([
      ["line-art", 0.99],
      ["line-art", 0.98],
      ["line-art", 0.97],
      ["line-art", 0.96],
    ]);
    // 프리뷰는 문서를 이미 움직였지만 히스토리는 아직 확정되지 않았다.
    expect(onSetItemOpacity).not.toHaveBeenCalled();

    fireEvent.blur(opacity);
    // 확정 표본은 값이 프리뷰와 같아도 반드시 나가야 한다 — 이게 합치기 체인을 끊어
    // 다음 제스처가 이번 제스처의 undo 항목에 빨려 들어가지 않게 한다.
    expect(onSetItemOpacity).toHaveBeenCalledTimes(1);
    expect(onSetItemOpacity).toHaveBeenCalledWith("line-art", 0.96);
  });

  it("commits a pointer scrub once, on release", () => {
    const onSetItemOpacity = vi.fn();
    renderRow(
      rowProps({
        item: { ...ITEM, opacity: 1 },
        stableHandlers: rowHandlers({ onSetItemOpacity }),
      })
    );

    const opacity = screen.getByRole("slider", { name: "주인공 원화 불투명도" });
    opacity.setPointerCapture = vi.fn();
    opacity.releasePointerCapture = vi.fn();
    opacity.hasPointerCapture = vi.fn(() => true);

    fireEvent.pointerDown(opacity, { pointerId: 7, button: 0, clientX: 200 });
    for (const clientX of [191, 182, 173, 161]) {
      fireEvent.pointerMove(opacity, { pointerId: 7, clientX });
    }
    expect(opacity.getAttribute("aria-valuenow")).toBe("87");
    expect(onSetItemOpacity).not.toHaveBeenCalled();

    fireEvent.pointerUp(opacity, { pointerId: 7 });
    expect(onSetItemOpacity).toHaveBeenCalledTimes(1);
    expect(onSetItemOpacity).toHaveBeenCalledWith("line-art", 0.87);
  });

  it("keeps the row's own tab stop — inline actions never add per-layer tab stops", () => {
    renderRow(rowProps({ item: { ...ITEM, opacity: 1 }, tabStop: true }));
    const row = screen.getByRole("treeitem");
    expect(row.tabIndex).toBe(0);
    for (const control of row.querySelectorAll("[data-layer-row-control]")) {
      expect((control as HTMLElement).tabIndex).toBe(-1);
    }
  });

  it("blocks 잠금/불투명도 when the parent group owns the lock or the page is read-only", () => {
    renderRow(rowProps({ lockedByGroup: true, effectivelyLocked: true }));
    const row = screen.getByRole("treeitem");
    const lock = row.querySelector<HTMLButtonElement>('[data-studio-layer-row-action="lock"]');
    expect(lock?.disabled).toBe(true);
    expect(lock?.getAttribute("aria-label")).toBe("주인공 원화, 그룹에서 잠김");
    expect(
      screen.getByRole("slider", { name: "주인공 원화 불투명도" }).getAttribute("aria-disabled")
    ).toBe("true");
  });
});
