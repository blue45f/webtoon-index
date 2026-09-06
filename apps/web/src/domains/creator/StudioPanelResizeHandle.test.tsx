// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioPanelResizeHandle } from "./StudioPanelResizeHandle";

afterEach(cleanup);

describe("StudioPanelResizeHandle", () => {
  it("passes accessible separator state and every resize input through", () => {
    const onPointerDown = vi.fn();
    const onKeyDown = vi.fn();
    const onDoubleClick = vi.fn();
    render(
      <StudioPanelResizeHandle
        dragging
        label="페이지 패널 너비 조절"
        handleProps={{
          role: "separator",
          "aria-orientation": "vertical",
          "aria-valuenow": 192,
          "aria-valuetext": "192픽셀",
          "aria-valuemin": 128,
          "aria-valuemax": 360,
          "aria-keyshortcuts": "ArrowLeft ArrowRight Home End Enter",
          tabIndex: 0,
          onPointerDown,
          onKeyDown,
          onDoubleClick,
        }}
      />,
    );

    const handle = screen.getByRole("separator", { name: "페이지 패널 너비 조절" });
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-valuenow")).toBe("192");
    expect(handle.getAttribute("aria-valuetext")).toBe("192픽셀");
    expect(handle.getAttribute("aria-valuemin")).toBe("128");
    expect(handle.getAttribute("aria-valuemax")).toBe("360");
    expect(handle.getAttribute("aria-keyshortcuts")).toContain("Enter");
    expect(handle.getAttribute("tabindex")).toBe("0");
    expect(handle.classList.contains("bg-accent/20")).toBe(true);
    expect(handle.classList.contains("touch-none")).toBe(true);
    expect(handle.classList.contains("lg:flex")).toBe(true);
    expect(handle.classList.contains("w-3")).toBe(true);
    expect(handle.className).toContain("before:w-6");
    expect(handle.className).toContain("before:inset-y-0");
    expect(handle.className).toContain("focus-visible:bg-accent/15");
    expect(handle.className).toContain("motion-reduce:transition-none");
    expect(handle.getAttribute("title")).toContain("더블클릭·더블탭·Enter");
    expect(handle.getAttribute("data-studio-panel-resizer")).toBe("true");
    expect(handle.getAttribute("data-dragging")).toBe("true");
    expect(handle.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText(/더블클릭·더블탭하면 기본 너비/)).toBeTruthy();

    fireEvent.pointerDown(handle, { pointerId: 7 });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.doubleClick(handle);
    expect(onPointerDown).toHaveBeenCalledOnce();
    expect(onKeyDown).toHaveBeenCalledOnce();
    expect(onDoubleClick).toHaveBeenCalledOnce();
  });

  it("keeps default, hover, focus, and drag affordances visually distinct", () => {
    render(
      <StudioPanelResizeHandle
        dragging={false}
        label="작업 패널 너비 조절"
        handleProps={{
          role: "separator",
          "aria-orientation": "vertical",
          "aria-valuenow": 320,
          "aria-valuetext": "320픽셀, 기본 너비",
          "aria-valuemin": 240,
          "aria-valuemax": 480,
          tabIndex: 0,
          onPointerDown: vi.fn(),
          onKeyDown: vi.fn(),
          onDoubleClick: vi.fn(),
        }}
      />,
    );

    const handle = screen.getByRole("separator", { name: "작업 패널 너비 조절" });
    const grip = handle.querySelector("[aria-hidden]");
    expect(handle.getAttribute("data-dragging")).toBe("false");
    expect(handle.classList.contains("w-3")).toBe(true);
    expect(handle.className).toContain("before:w-6");
    expect(handle.className).toContain("hover:bg-accent/10");
    expect(handle.className).toContain("focus-visible:bg-accent/15");
    expect(handle.className).toContain("active:bg-accent/15");
    expect(handle.classList.contains("bg-accent/20")).toBe(false);
    expect(grip?.className).toContain("w-2.5");
    expect(grip?.className).toContain("group-hover:bg-accent-soft");
    expect(grip?.className).toContain("group-focus-visible:bg-accent-soft");
  });
});
