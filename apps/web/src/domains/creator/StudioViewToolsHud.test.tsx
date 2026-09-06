// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioViewToolsHud, type StudioViewToolsHudProps } from "./StudioViewToolsHud";

function props(overrides: Partial<StudioViewToolsHudProps> = {}): StudioViewToolsHudProps {
  return {
    mode: "zoom",
    magnification: 0.4,
    canZoomIn: true,
    canZoomOut: true,
    rotation: 0,
    flipped: false,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onFit: vi.fn(),
    onActual: vi.fn(),
    onRotateLeft: vi.fn(),
    onRotateRight: vi.fn(),
    onToggleFlip: vi.fn(),
    onReset: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("StudioViewToolsHud", () => {
  it("renders nothing without an active view tool", () => {
    expect(renderToStaticMarkup(<StudioViewToolsHud {...props({ mode: null })} />)).toBe("");
  });

  it("renders a touch-sized, labelled zoom toolbar with the current percentage", () => {
    const html = renderToStaticMarkup(<StudioViewToolsHud {...props()} />);

    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="캔버스 확대 및 축소 보기 도구"');
    expect(html).toContain('data-studio-view-tools-hud="zoom"');
    expect(html).toContain("확대/축소");
    expect(html).toContain("40%");
    expect(html).toContain('aria-label="캔버스 축소"');
    expect(html).toContain('aria-label="캔버스 확대"');
    expect(html).toContain('aria-label="캔버스 너비에 맞춤"');
    expect(html).toContain('aria-label="캔버스 실제 픽셀 100%"');
    expect(html).toContain('aria-label="캔버스 좌우 반전"');
    expect(html).toContain('aria-pressed="false"');
    expect(html.match(/size-11/g)?.length ?? 0).toBe(7);
    expect(html.match(/focus-visible:outline-accent/g)?.length ?? 0).toBe(7);
    expect(html.match(/data-studio-tool-hint-target="true"/g)?.length ?? 0).toBe(7);
    expect(html).not.toContain(" title=");
    expect(html).not.toContain("왼쪽으로 90도 회전");
  });

  it("keeps bounded zoom controls discoverable while blocking their commands", () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    render(
      <StudioViewToolsHud
        {...props({ canZoomIn: false, canZoomOut: false, onZoomIn, onZoomOut })}
      />
    );

    const zoomOut = screen.getByRole("button", { name: "캔버스 축소" });
    const zoomIn = screen.getByRole("button", { name: "캔버스 확대" });

    expect(zoomOut.getAttribute("aria-disabled")).toBe("true");
    expect(zoomIn.getAttribute("aria-disabled")).toBe("true");
    expect((zoomOut as HTMLButtonElement).disabled).toBe(false);
    expect((zoomIn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(zoomOut);
    fireEvent.click(zoomIn);
    expect(onZoomOut).not.toHaveBeenCalled();
    expect(onZoomIn).not.toHaveBeenCalled();
  });

  it("auto-focuses the first action and supports roving Arrow/Home/End navigation", async () => {
    render(<StudioViewToolsHud {...props()} />);
    const toolbar = screen.getByRole("toolbar");
    const buttons = within(toolbar).getAllByRole("button");

    await waitFor(() => expect(document.activeElement).toBe(buttons[0]));
    expect(buttons[0]?.getAttribute("tabindex")).toBe("0");
    expect(buttons[1]?.getAttribute("tabindex")).toBe("-1");

    fireEvent.keyDown(buttons[0], { key: "ArrowRight" });
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons[1]?.getAttribute("tabindex")).toBe("0");

    fireEvent.keyDown(buttons[1], { key: "End" });
    expect(document.activeElement).toBe(buttons.at(-1));

    fireEvent.keyDown(buttons.at(-1)!, { key: "Home" });
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("returns focus to the invoking rail trigger when Escape closes the HUD", async () => {
    const onClose = vi.fn();
    render(
      <>
        <button type="button" data-studio-view-tool-trigger="zoom">확대 도구 열기</button>
        <div tabIndex={-1} data-studio-canvas-viewport>캔버스</div>
        <StudioViewToolsHud {...props({ onClose })} />
      </>
    );
    const firstAction = screen.getByRole("button", { name: "캔버스 축소" });
    await waitFor(() => expect(document.activeElement).toBe(firstAction));

    fireEvent.keyDown(firstAction, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "확대 도구 열기" }));
  });

  it("renders rotation actions and exposes the flipped state as a pressed toggle", () => {
    const html = renderToStaticMarkup(
      <StudioViewToolsHud {...props({ mode: "rotate", rotation: 270, flipped: true })} />
    );

    expect(html).toContain('aria-label="캔버스 회전 보기 도구"');
    expect(html).toContain('data-studio-view-tools-hud="rotate"');
    expect(html).toContain("회전");
    expect(html).toContain("270°");
    expect(html).toContain('aria-label="캔버스 왼쪽으로 90도 회전"');
    expect(html).toContain('aria-label="캔버스 오른쪽으로 90도 회전"');
    expect(html).toContain('aria-label="캔버스 좌우 반전 해제"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="캔버스 보기 초기화"');
    expect(html).toContain('aria-label="보기 도구 닫기"');
    expect(html).not.toContain('aria-label="캔버스 확대"');
  });
});
