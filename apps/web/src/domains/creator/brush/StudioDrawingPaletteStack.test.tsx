// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  requestStudioInspectorFocus,
  resetStudioInspectorFocusForTest,
  studioInspectorFocusTokenFor,
  type StudioInspectorFocusTarget,
} from "../studio-inspector-focus";
import { StudioInspectorSection } from "../StudioInspectorSection";

import {
  DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT,
  moveStudioDrawingPalette,
  resizeStudioDrawingPalettes,
  type StudioDrawingPaletteLayout,
} from "./studio-drawing-palettes";
import { StudioDrawingPaletteStack } from "./StudioDrawingPaletteStack";

afterEach(() => {
  cleanup();
  resetStudioInspectorFocusForTest();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Harness({
  initial = DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT,
  onDraggingChange,
  onLayoutChange,
  cancelEpoch,
  defaultPresentation,
  presentation,
}: {
  initial?: StudioDrawingPaletteLayout;
  onDraggingChange?: (dragging: boolean) => void;
  onLayoutChange?: (layout: StudioDrawingPaletteLayout) => void;
  cancelEpoch?: number;
  defaultPresentation?: "full" | "icon-popup";
  presentation?: "full" | "icon-popup";
}) {
  const [layout, setLayout] = useState(initial);
  return (
    <StudioDrawingPaletteStack
      layout={layout}
      subTools={<button type="button">G펜 선택</button>}
      toolProperties={<button type="button">필압 설정</button>}
      onLayoutChange={(nextLayout) => {
        onLayoutChange?.(nextLayout);
        setLayout(nextLayout);
      }}
      onDraggingChange={onDraggingChange}
      cancelEpoch={cancelEpoch}
      defaultPresentation={defaultPresentation}
      presentation={presentation}
    />
  );
}

function splitter(): HTMLElement {
  return screen.getByRole("separator", {
    name: /서브 도구와 도구 속성 크기 조절/,
  });
}

describe("StudioDrawingPaletteStack", () => {
  it("renders ordered, independently scrollable palettes with mobile-safe headers", () => {
    const { container } = render(<Harness />);
    const stack = container.querySelector(
      '[data-studio-drawing-palette-stack="true"]',
    );
    const palettes = Array.from(
      container.querySelectorAll<HTMLElement>("[data-studio-drawing-palette]"),
    );

    expect(stack).not.toBeNull();
    expect(palettes.map((palette) => palette.dataset.studioDrawingPalette)).toEqual([
      "sub-tools",
      "tool-properties",
    ]);
    for (const palette of palettes) {
      const scroll = palette.querySelector(
        '[data-studio-drawing-palette-scroll="true"]',
      );
      expect(scroll?.className).toContain("lg:overflow-y-auto");
      expect(scroll?.classList.contains("overflow-y-auto")).toBe(false);
      expect(scroll?.classList.contains("lg:overflow-y-auto")).toBe(true);
    }
    expect(
      screen.getByRole("button", { name: "서브 도구 접기" }).className,
    ).toContain("size-11");
    expect(
      screen.getByRole("button", { name: "도구 속성 접기" }).className,
    ).toContain("lg:size-8");
    expect(screen.getByText("G펜 선택")).toBeTruthy();
    expect(screen.getByText("필압 설정")).toBeTruthy();
  });

  it("keeps mobile Work focused on tool properties without changing the desktop workspace layout", () => {
    const onLayoutChange = vi.fn();
    const { container } = render(
      <StudioDrawingPaletteStack
        layout={DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT}
        mobileHeaderAction={<button type="button">브러시 목록</button>}
        mobilePrimaryPaletteId="tool-properties"
        subTools={<button type="button">G펜 선택</button>}
        toolProperties={<button type="button">필압 설정</button>}
        onLayoutChange={onLayoutChange}
      />,
    );

    const subTools = container.querySelector<HTMLElement>(
      '[data-studio-drawing-palette="sub-tools"]',
    );
    const properties = container.querySelector<HTMLElement>(
      '[data-studio-drawing-palette="tool-properties"]',
    );

    expect(subTools?.className).toContain("hidden");
    expect(subTools?.className).toContain("lg:flex");
    expect(properties?.className).not.toContain("hidden");
    expect(properties?.querySelector("header")?.className).toContain("sticky");
    expect(properties?.querySelector("header")?.className).toContain("lg:static");
    expect(screen.queryByText("G펜 선택")).toBeNull();
    expect(screen.getByText("필압 설정")).toBeTruthy();
    expect(screen.getByRole("button", { name: "브러시 목록" })).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "도구 속성 접기" })
        .parentElement?.className,
    ).toContain("hidden");
    expect(onLayoutChange).not.toHaveBeenCalled();
  });

  it("collapses each palette independently and restores focus to its header", () => {
    render(<Harness />);
    const subToolAction = screen.getByRole("button", { name: "G펜 선택" });
    subToolAction.focus();
    expect(document.activeElement).toBe(subToolAction);

    fireEvent.click(screen.getByRole("button", { name: "서브 도구 접기" }));

    const expand = screen.getByRole("button", { name: "서브 도구 펼치기" });
    expect(screen.queryByRole("button", { name: "G펜 선택" })).toBeNull();
    expect(document.activeElement).toBe(expand);
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    const controlledContentId = expand.getAttribute("aria-controls");
    expect(controlledContentId).not.toBeNull();
    const collapsedContent = document.getElementById(controlledContentId!);
    expect(collapsedContent).not.toBeNull();
    expect(collapsedContent?.hidden).toBe(true);
    expect(collapsedContent?.childElementCount).toBe(0);
    expect(screen.queryByRole("separator")).toBeNull();

    fireEvent.click(expand);
    expect(screen.getByRole("button", { name: "G펜 선택" })).toBeTruthy();
    expect(document.getElementById(controlledContentId!)?.hidden).toBe(false);
  });

  it("reorders palettes with explicit keyboard-accessible header actions", () => {
    const { container } = render(<Harness />);
    const subTools = container.querySelector<HTMLElement>(
      '[data-studio-drawing-palette="sub-tools"]',
    );
    expect(
      within(subTools!).getByRole<HTMLButtonElement>("button", {
        name: "서브 도구 위로 이동",
      }).disabled,
    ).toBe(true);

    fireEvent.click(
      within(subTools!).getByRole("button", { name: "서브 도구 아래로 이동" }),
    );

    const reordered = Array.from(
      container.querySelectorAll<HTMLElement>("[data-studio-drawing-palette]"),
    );
    expect(reordered.map((palette) => palette.dataset.studioDrawingPalette)).toEqual([
      "tool-properties",
      "sub-tools",
    ]);
    expect(
      screen.getByRole("separator", {
        name: /도구 속성과 서브 도구 크기 조절/,
      }),
    ).toBeTruthy();
  });

  it("groups durable position and height locks in one palette-options menu", () => {
    const onLayoutChange = vi.fn();
    const { container } = render(
      <Harness onLayoutChange={onLayoutChange} />,
    );
    const optionsTrigger = screen.getByRole("button", {
      name: "서브 도구 팔레트 옵션",
    });
    expect(optionsTrigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(optionsTrigger);

    const menu = screen.getByRole("menu", {
      name: "서브 도구 팔레트 옵션",
    });
    expect(optionsTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(optionsTrigger.getAttribute("aria-controls")).toBe(menu.id);
    const positionLock = within(menu).getByRole("menuitemcheckbox", {
      name: /위치 잠금/,
    });
    const heightLock = within(menu).getByRole("menuitemcheckbox", {
      name: /높이 잠금/,
    });
    expect(positionLock.getAttribute("aria-checked")).toBe("false");
    expect(heightLock.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(positionLock);

    const subTools = container.querySelector<HTMLElement>(
      '[data-studio-drawing-palette="sub-tools"]',
    )!;
    const toolProperties = container.querySelector<HTMLElement>(
      '[data-studio-drawing-palette="tool-properties"]',
    )!;
    expect(subTools.dataset.positionLocked).toBe("true");
    expect(
      within(subTools).getByRole<HTMLButtonElement>("button", {
        name: "서브 도구 아래로 이동",
      }).disabled,
    ).toBe(true);
    expect(
      within(toolProperties).getByRole<HTMLButtonElement>("button", {
        name: "도구 속성 위로 이동",
      }).disabled,
    ).toBe(true);

    fireEvent.click(
      within(
        screen.getByRole("menu", {
          name: "서브 도구 팔레트 옵션",
        }),
      ).getByRole("menuitemcheckbox", { name: /높이 잠금/ }),
    );

    const lockedSplitter = splitter();
    expect(lockedSplitter.getAttribute("aria-disabled")).toBe("true");
    expect(lockedSplitter.getAttribute("tabindex")).toBe("-1");
    expect(lockedSplitter.dataset.heightLocked).toBe("true");
    fireEvent.keyDown(lockedSplitter, { key: "ArrowDown" });
    expect(splitter().getAttribute("aria-valuenow")).toBe("36");
    expect(onLayoutChange).toHaveBeenCalledTimes(2);

    fireEvent.pointerDown(document.body);
    expect(
      screen.queryByRole("menu", { name: "서브 도구 팔레트 옵션" }),
    ).toBeNull();
    expect(optionsTrigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("switches presentation through palette options without crowding the header", () => {
    const { container } = render(<Harness />);
    const subTools = container.querySelector<HTMLElement>(
      '[data-studio-drawing-palette="sub-tools"]',
    )!;
    const headerControls = within(subTools).getByRole("group", {
      name: "서브 도구 팔레트 배치",
    });
    expect(
      within(headerControls)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "서브 도구 위로 이동",
      "서브 도구 아래로 이동",
      "서브 도구 팔레트 옵션",
      "서브 도구 접기",
    ]);

    fireEvent.click(
      within(subTools).getByRole("button", {
        name: "서브 도구 팔레트 옵션",
      }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "아이콘 팝업으로 보기" }),
    );

    expect(
      container.querySelector<HTMLElement>(
        '[data-studio-drawing-palette-stack="true"]',
      )?.dataset.studioDrawingPalettePresentation,
    ).toBe("icon-popup");
    expect(
      screen.getByRole("button", { name: "서브 도구 팝업 열기" }).className,
    ).toContain("size-11");
    expect(
      screen.getByRole("button", { name: "도구 속성 팝업 열기" }).className,
    ).toContain("size-11");
    expect(
      screen.getByRole("button", { name: "서브 도구 팝업 열기" }).className,
    ).toContain("lg:w-full");
    expect(screen.getByText("펜·지우개·도형을 고릅니다")).toBeTruthy();
    expect(screen.getByText("크기·농도·필압을 조절합니다")).toBeTruthy();
  });

  it("opens only one icon palette popup and dismisses outside or by Escape with focus return", () => {
    render(<Harness defaultPresentation="icon-popup" />);
    const subToolsTrigger = screen.getByRole("button", {
      name: "서브 도구 팝업 열기",
    });
    const controlledPopupId = subToolsTrigger.getAttribute("aria-controls");
    expect(subToolsTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(controlledPopupId).not.toBeNull();

    fireEvent.click(subToolsTrigger);

    const subToolsDialog = screen.getByRole("dialog", {
      name: "서브 도구 팝업",
    });
    expect(subToolsTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(subToolsDialog.id).toBe(controlledPopupId);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "G펜 선택" })).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "도구 속성 팝업 열기" }),
    );

    expect(
      screen.queryByRole("dialog", { name: "서브 도구 팝업" }),
    ).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "도구 속성 팝업" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "G펜 선택" })).toBeNull();
    expect(screen.getByRole("button", { name: "필압 설정" })).toBeTruthy();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();

    const reopenedTrigger = screen.getByRole("button", {
      name: "서브 도구 팝업 열기",
    });
    fireEvent.click(reopenedTrigger);
    const bodyAction = screen.getByRole("button", { name: "G펜 선택" });
    bodyAction.focus();
    expect(document.activeElement).toBe(bodyAction);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(reopenedTrigger);
    expect(reopenedTrigger.getAttribute("aria-expanded")).toBe("false");
  });

  it.each<StudioInspectorFocusTarget>([
    "tool.brush-studio",
    "tool.brush-engines",
    "brush.saved-library",
  ])("opens the tool-properties popup before honoring the %s deep link", (target) => {
    render(<Harness defaultPresentation="icon-popup" />);

    expect(
      screen.queryByRole("dialog", { name: "도구 속성 팝업" }),
    ).toBeNull();

    act(() => {
      requestStudioInspectorFocus(target);
    });

    expect(
      screen.getByRole("dialog", { name: "도구 속성 팝업" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "필압 설정" })).toBeTruthy();
  });

  it.each([
    ["palette.sub-tools", "서브 도구 팝업", "G펜 선택"],
    ["palette.tool-properties", "도구 속성 팝업", "필압 설정"],
  ] as const)("opens and consumes the generic %s palette request", (
    target,
    dialogName,
    bodyAction,
  ) => {
    render(<Harness defaultPresentation="icon-popup" />);

    act(() => {
      requestStudioInspectorFocus(target);
    });

    expect(screen.getByRole("dialog", { name: dialogName })).toBeTruthy();
    expect(screen.getByRole("button", { name: bodyAction })).toBeTruthy();
    expect(studioInspectorFocusTokenFor(target)).toBe(0);
  });

  it("does not trap dismissal when a nested target is unavailable", () => {
    render(<Harness defaultPresentation="icon-popup" />);

    act(() => {
      requestStudioInspectorFocus("tool.brush-studio");
    });
    expect(
      screen.getByRole("dialog", { name: "도구 속성 팝업" }),
    ).toBeTruthy();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("mounts, opens, focuses and consumes a nested brush-section deep link", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollIntoView",
    );
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });

    function DeepLinkHarness() {
      const [layout, setLayout] = useState<StudioDrawingPaletteLayout>(
        DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT,
      );
      return (
        <StudioDrawingPaletteStack
          layout={layout}
          defaultPresentation="icon-popup"
          subTools={<span>서브 도구</span>}
          toolProperties={(
            <StudioInspectorSection sectionId="tool.brush-studio">
              <button type="button">브러시 간격</button>
            </StudioInspectorSection>
          )}
          onLayoutChange={setLayout}
        />
      );
    }

    try {
      render(<DeepLinkHarness />);

      act(() => {
        requestStudioInspectorFocus("tool.brush-studio");
      });

      const sectionHeader = await screen.findByRole("button", {
        name: "브러시 스튜디오",
      });
      await waitFor(() => {
        expect(
          screen.getByRole("dialog", { name: "도구 속성 팝업" }),
        ).toBeTruthy();
        expect(sectionHeader.getAttribute("aria-expanded")).toBe("true");
        expect(document.activeElement).toBe(sectionHeader);
        expect(studioInspectorFocusTokenFor("tool.brush-studio")).toBe(0);
      });
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(
          Element.prototype,
          "scrollIntoView",
          originalScrollIntoView,
        );
      } else {
        Reflect.deleteProperty(Element.prototype, "scrollIntoView");
      }
    }
    expect(Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView"))
      .toEqual(originalScrollIntoView);
  });

  it("expands collapsed tool properties before a nested inspector deep link runs", () => {
    render(
      <Harness
        initial={{
          ...DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT,
          collapsed: {
            ...DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT.collapsed,
            "tool-properties": true,
          },
        }}
      />,
    );

    expect(screen.queryByRole("button", { name: "필압 설정" })).toBeNull();

    act(() => {
      requestStudioInspectorFocus("tool.brush-studio");
    });

    expect(screen.getByRole("button", { name: "필압 설정" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "도구 속성 접기" }).getAttribute(
        "aria-expanded",
      ),
    ).toBe("true");
  });

  it("follows a responsive owner's changed default presentation without retaining an old popup", () => {
    const { container, rerender } = render(
      <Harness defaultPresentation="icon-popup" />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "서브 도구 팝업 열기" }),
    );
    expect(screen.getByRole("dialog", { name: "서브 도구 팝업" })).toBeTruthy();

    rerender(<Harness defaultPresentation="full" />);

    expect(
      container.querySelector<HTMLElement>(
        '[data-studio-drawing-palette-stack="true"]',
      )?.dataset.studioDrawingPalettePresentation,
    ).toBe("full");
    expect(screen.queryByRole("dialog", { name: "서브 도구 팝업" })).toBeNull();
    expect(screen.getByRole("button", { name: "G펜 선택" })).toBeTruthy();

    rerender(<Harness defaultPresentation="icon-popup" />);

    expect(
      container.querySelector<HTMLElement>(
        '[data-studio-drawing-palette-stack="true"]',
      )?.dataset.studioDrawingPalettePresentation,
    ).toBe("icon-popup");
  });

  it("dismisses an open popup when a controlled owner switches to full presentation", () => {
    const { rerender } = render(<Harness presentation="icon-popup" />);

    fireEvent.click(
      screen.getByRole("button", { name: "서브 도구 팝업 열기" }),
    );
    expect(screen.getByRole("dialog", { name: "서브 도구 팝업" })).toBeTruthy();

    rerender(<Harness presentation="full" />);

    expect(screen.queryByRole("dialog", { name: "서브 도구 팝업" })).toBeNull();
    expect(screen.getByRole("button", { name: "G펜 선택" })).toBeTruthy();
  });

  it("supports precise separator keyboard resizing and default restoration", () => {
    render(<Harness />);
    const handle = splitter();
    expect(handle.getAttribute("aria-orientation")).toBe("horizontal");
    expect(handle.getAttribute("aria-valuenow")).toBe("36");
    expect(handle.className).toContain("before:h-6");

    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(splitter().getAttribute("aria-valuenow")).toBe("38");

    fireEvent.keyDown(splitter(), { key: "ArrowDown", shiftKey: true });
    expect(splitter().getAttribute("aria-valuenow")).toBe("46");

    fireEvent.keyDown(splitter(), { key: "Home" });
    expect(splitter().getAttribute("aria-valuenow")).toBe("20");

    fireEvent.keyDown(splitter(), { key: "End" });
    expect(splitter().getAttribute("aria-valuenow")).toBe("80");

    fireEvent.keyDown(splitter(), { key: "Enter" });
    expect(splitter().getAttribute("aria-valuenow")).toBe("36");
  });

  it("previews rAF moves locally, then commits the pointerup sample exactly once", () => {
    const onDraggingChange = vi.fn();
    const onLayoutChange = vi.fn();
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    const { container } = render(
      <Harness
        onDraggingChange={onDraggingChange}
        onLayoutChange={onLayoutChange}
      />,
    );
    const root = container.querySelector<HTMLElement>(
      '[data-studio-drawing-palette-stack="true"]',
    )!;
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      bottom: 1000,
      height: 1000,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(splitter(), {
      button: 0,
      clientX: 20,
      clientY: 300,
      isPrimary: true,
      pointerId: 7,
      pointerType: "pen",
    });
    fireEvent.pointerMove(window, {
      clientX: 20,
      clientY: 340,
      pointerId: 7,
      pointerType: "pen",
    });
    expect(frames.size).toBe(1);
    const [previewFrameId, previewFrame] = [...frames.entries()][0]!;
    frames.delete(previewFrameId);
    previewFrame(16);
    expect(onLayoutChange).not.toHaveBeenCalled();
    expect(
      container
        .querySelector<HTMLElement>(
          '[data-studio-drawing-palette="sub-tools"]',
        )!
        .style.getPropertyValue("--studio-drawing-palette-size"),
    ).toBe("40%");
    expect(splitter().getAttribute("aria-valuenow")).toBe("40");
    expect(splitter().getAttribute("aria-valuetext")).toBe(
      "서브 도구 40%, 도구 속성 60%",
    );

    // The release coordinate supersedes the last painted frame without another parent render.
    fireEvent.pointerUp(window, {
      clientX: 20,
      clientY: 400,
      pointerId: 7,
      pointerType: "pen",
    });

    expect(splitter().getAttribute("aria-valuenow")).toBe("46");
    expect(frames.size).toBe(0);
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    expect(onLayoutChange.mock.calls[0]?.[0].sizes["sub-tools"]).toBe(46);
    expect(onDraggingChange.mock.calls).toEqual([[true], [false]]);
  });

  it("does not commit a drag whose released size rounds to the controlled integer", () => {
    const onLayoutChange = vi.fn();
    const { container } = render(
      <Harness onLayoutChange={onLayoutChange} />,
    );
    const root = container.querySelector<HTMLElement>(
      '[data-studio-drawing-palette-stack="true"]',
    )!;
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      bottom: 1000,
      height: 1000,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(splitter(), {
      button: 0,
      clientX: 20,
      clientY: 300,
      isPrimary: true,
      pointerId: 8,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(window, {
      clientX: 20,
      clientY: 304,
      pointerId: 8,
      pointerType: "mouse",
    });

    expect(onLayoutChange).not.toHaveBeenCalled();
    expect(splitter().getAttribute("aria-valuenow")).toBe("36");
  });

  it("cancels queued drag work on cancelEpoch changes without a stale commit", () => {
    const onDraggingChange = vi.fn();
    const onLayoutChange = vi.fn();
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    const { container, rerender } = render(
      <Harness
        cancelEpoch={0}
        onDraggingChange={onDraggingChange}
        onLayoutChange={onLayoutChange}
      />,
    );
    const root = container.querySelector<HTMLElement>(
      '[data-studio-drawing-palette-stack="true"]',
    )!;
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      bottom: 1000,
      height: 1000,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(splitter(), {
      button: 0,
      clientX: 20,
      clientY: 300,
      isPrimary: true,
      pointerId: 9,
      pointerType: "pen",
    });
    fireEvent.pointerMove(window, {
      clientX: 20,
      clientY: 500,
      pointerId: 9,
      pointerType: "pen",
    });
    const [paintFrameId, paintFrame] = [...frames.entries()][0]!;
    frames.delete(paintFrameId);
    paintFrame(16);
    fireEvent.pointerMove(window, {
      clientX: 20,
      clientY: 600,
      pointerId: 9,
      pointerType: "pen",
    });
    const staleFrame = [...frames.values()][0]!;
    expect(
      container
        .querySelector<HTMLElement>(
          '[data-studio-drawing-palette="sub-tools"]',
        )!
        .style.getPropertyValue("--studio-drawing-palette-size"),
    ).toBe("56%");
    expect(splitter().getAttribute("aria-valuenow")).toBe("56");

    rerender(
      <Harness
        cancelEpoch={1}
        onDraggingChange={onDraggingChange}
        onLayoutChange={onLayoutChange}
      />,
    );

    expect(frames.size).toBe(0);
    expect(
      container
        .querySelector<HTMLElement>(
          '[data-studio-drawing-palette="sub-tools"]',
        )!
        .style.getPropertyValue("--studio-drawing-palette-size"),
    ).toBe("36%");
    expect(root.dataset.studioDrawingPaletteDragging).toBe("false");
    expect(splitter().getAttribute("aria-valuenow")).toBe("36");
    expect(splitter().getAttribute("aria-valuetext")).toBe(
      "서브 도구 36%, 도구 속성 64%",
    );
    expect(onLayoutChange).not.toHaveBeenCalled();
    expect(onDraggingChange.mock.calls).toEqual([[true], [false]]);

    staleFrame(32);
    fireEvent.pointerUp(window, {
      clientX: 20,
      clientY: 700,
      pointerId: 9,
      pointerType: "pen",
    });
    expect(onLayoutChange).not.toHaveBeenCalled();
  });

  it("restores the latest controlled layout when layout and cancelEpoch change together", () => {
    const onDraggingChange = vi.fn();
    const onLayoutChange = vi.fn();
    const nextLayout = moveStudioDrawingPalette(
      resizeStudioDrawingPalettes(
        DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT,
        "sub-tools",
        68,
      ),
      "sub-tools",
      "down",
    );
    const sharedProps = {
      subTools: <button type="button">G펜 선택</button>,
      toolProperties: <button type="button">필압 설정</button>,
      onDraggingChange,
      onLayoutChange,
    };
    const { container, rerender } = render(
      <StudioDrawingPaletteStack
        {...sharedProps}
        cancelEpoch={0}
        layout={DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT}
      />,
    );
    const root = container.querySelector<HTMLElement>(
      '[data-studio-drawing-palette-stack="true"]',
    )!;
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      bottom: 1000,
      height: 1000,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(splitter(), {
      button: 0,
      clientX: 20,
      clientY: 300,
      isPrimary: true,
      pointerId: 13,
      pointerType: "pen",
    });
    fireEvent.pointerMove(window, {
      clientX: 20,
      clientY: 500,
      pointerId: 13,
      pointerType: "pen",
    });

    rerender(
      <StudioDrawingPaletteStack
        {...sharedProps}
        cancelEpoch={1}
        layout={nextLayout}
      />,
    );

    expect(
      container
        .querySelector<HTMLElement>(
          '[data-studio-drawing-palette="sub-tools"]',
        )!
        .style.getPropertyValue("--studio-drawing-palette-size"),
    ).toBe("68%");
    const restoredSplitter = screen.getByRole("separator", {
      name: /도구 속성과 서브 도구 크기 조절/,
    });
    expect(restoredSplitter.getAttribute("aria-valuenow")).toBe("32");
    expect(restoredSplitter.getAttribute("aria-valuetext")).toBe(
      "도구 속성 32%, 서브 도구 68%",
    );
    expect(root.dataset.studioDrawingPaletteDragging).toBe("false");
    expect(onLayoutChange).not.toHaveBeenCalled();
    expect(onDraggingChange.mock.calls).toEqual([[true], [false]]);

    fireEvent.pointerUp(window, {
      clientX: 20,
      clientY: 700,
      pointerId: 13,
      pointerType: "pen",
    });
    expect(onLayoutChange).not.toHaveBeenCalled();
  });

  it("cancels queued drag work on unmount and closes the dragging bracket once", () => {
    const onDraggingChange = vi.fn();
    const onLayoutChange = vi.fn();
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    const { unmount } = render(
      <Harness
        onDraggingChange={onDraggingChange}
        onLayoutChange={onLayoutChange}
      />,
    );

    fireEvent.pointerDown(splitter(), {
      button: 0,
      clientX: 20,
      clientY: 300,
      isPrimary: true,
      pointerId: 10,
      pointerType: "pen",
    });
    fireEvent.pointerMove(window, {
      clientX: 20,
      clientY: 600,
      pointerId: 10,
      pointerType: "pen",
    });
    const staleFrame = [...frames.values()][0]!;
    unmount();

    expect(frames.size).toBe(0);
    expect(onLayoutChange).not.toHaveBeenCalled();
    expect(onDraggingChange.mock.calls).toEqual([[true], [false]]);
    staleFrame(32);
    fireEvent.pointerUp(window, {
      clientX: 20,
      clientY: 700,
      pointerId: 10,
      pointerType: "pen",
    });
    expect(onLayoutChange).not.toHaveBeenCalled();
  });

  it("resets the split with mouse double click and touch double tap", () => {
    const initial = resizeStudioDrawingPalettes(
      DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT,
      "sub-tools",
      58,
    );
    render(<Harness initial={initial} />);
    expect(splitter().getAttribute("aria-valuenow")).toBe("58");

    fireEvent.doubleClick(splitter());
    expect(splitter().getAttribute("aria-valuenow")).toBe("36");

    fireEvent.keyDown(splitter(), { key: "ArrowDown", shiftKey: true });
    expect(splitter().getAttribute("aria-valuenow")).toBe("44");
    for (const pointerId of [11, 12]) {
      fireEvent.pointerDown(splitter(), {
        button: 0,
        clientX: 30,
        clientY: 240,
        isPrimary: true,
        pointerId,
        pointerType: "touch",
      });
      fireEvent.pointerUp(window, {
        clientX: 30,
        clientY: 240,
        pointerId,
        pointerType: "touch",
      });
    }
    expect(splitter().getAttribute("aria-valuenow")).toBe("36");
  });
});
