// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioCanvasContextMenu,
  type StudioCanvasContextMenuProps,
} from "./StudioCanvasContextMenu";

afterEach(cleanup);

function createProps(
  overrides: Partial<StudioCanvasContextMenuProps> = {}
): StudioCanvasContextMenuProps {
  return {
    open: true,
    x: 120,
    y: 240,
    hasElement: true,
    locked: false,
    onPreloadBackground3d: vi.fn(),
    onSaveAsEmeres: vi.fn(),
    onDuplicate: vi.fn(),
    onReorder: vi.fn(),
    onToggleLock: vi.fn(),
    onDelete: vi.fn(),
    onSelectPen: vi.fn(),
    onAddSpeechBubble: vi.fn(),
    onAddText: vi.fn(),
    onAddPage: vi.fn(),
    onEnableQuickShape: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe("StudioCanvasContextMenu", () => {
  it("renders nothing while closed", () => {
    const { container } = render(
      <StudioCanvasContextMenu {...createProps({ open: false })} />
    );

    expect(container.querySelector("[data-studio-canvas-context-menu]")).toBeNull();
  });

  it("runs element commands before closing the menu", () => {
    const order: string[] = [];
    const props = createProps({
      onDuplicate: vi.fn(() => order.push("duplicate")),
      onClose: vi.fn(() => order.push("close")),
    });

    render(<StudioCanvasContextMenu {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "복제하기 (⌘J)" }));

    expect(order).toEqual(["duplicate", "close"]);
  });

  it("does not generically close the menu when saving to Emeres", () => {
    const props = createProps();

    render(<StudioCanvasContextMenu {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "이메레스로 저장" }));

    expect(props.onSaveAsEmeres).toHaveBeenCalledOnce();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("preloads and opens the optional 3D editors through semantic callbacks", () => {
    const order: string[] = [];
    const props = createProps({
      onEditVrm: vi.fn(() => order.push("vrm")),
      onEditBackground3d: vi.fn(() => order.push("background")),
      onClose: vi.fn(() => order.push("close")),
    });

    render(<StudioCanvasContextMenu {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "3D 캐릭터 편집" }));
    expect(order).toEqual(["vrm", "close"]);

    order.length = 0;
    const backgroundButton = screen.getByRole("button", { name: "3D 배경 편집" });
    fireEvent.pointerEnter(backgroundButton);
    fireEvent.pointerDown(backgroundButton);
    fireEvent.focus(backgroundButton);
    fireEvent.click(backgroundButton);

    expect(props.onPreloadBackground3d).toHaveBeenCalledTimes(3);
    expect(order).toEqual(["background", "close"]);
  });

  it("preserves layer ordering directions and lock wording", () => {
    const props = createProps({ locked: true });

    render(<StudioCanvasContextMenu {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "맨 앞으로" }));
    fireEvent.click(screen.getByRole("button", { name: "한 단계 앞으로" }));
    fireEvent.click(screen.getByRole("button", { name: "한 단계 뒤로" }));
    fireEvent.click(screen.getByRole("button", { name: "맨 뒤로" }));
    fireEvent.click(screen.getByRole("button", { name: "잠금 해제" }));

    expect(props.onReorder).toHaveBeenNthCalledWith(1, "front");
    expect(props.onReorder).toHaveBeenNthCalledWith(2, "forward");
    expect(props.onReorder).toHaveBeenNthCalledWith(3, "backward");
    expect(props.onReorder).toHaveBeenNthCalledWith(4, "back");
    expect(props.onToggleLock).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledTimes(5);
  });

  it("routes blank-canvas commands without owning editor state", () => {
    const props = createProps({ hasElement: false });

    render(<StudioCanvasContextMenu {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "펜으로 그리기" }));
    fireEvent.click(screen.getByRole("button", { name: "말풍선 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "텍스트 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "새 페이지 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "스마트 도형 켜기" }));

    expect(props.onSelectPen).toHaveBeenCalledOnce();
    expect(props.onAddSpeechBubble).toHaveBeenCalledOnce();
    expect(props.onAddText).toHaveBeenCalledOnce();
    expect(props.onAddPage).toHaveBeenCalledOnce();
    expect(props.onEnableQuickShape).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledTimes(5);
  });

  it("positions the menu and stops the global outside-click bubble", () => {
    const parentClick = vi.fn();
    const { container } = render(<StudioCanvasContextMenu {...createProps()} />);
    document.body.addEventListener("click", parentClick);
    const menu = container.querySelector<HTMLElement>(
      "[data-studio-canvas-context-menu]"
    );

    expect(menu?.style.top).toBe("240px");
    expect(menu?.style.left).toBe("120px");
    if (!menu) throw new Error("context menu was not rendered");
    fireEvent.click(menu);
    expect(parentClick).not.toHaveBeenCalled();
    document.body.removeEventListener("click", parentClick);
  });
});
