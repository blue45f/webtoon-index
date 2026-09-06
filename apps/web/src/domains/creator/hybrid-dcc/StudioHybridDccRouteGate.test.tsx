// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioHybridDccRouteGate } from "./StudioHybridDccRouteGate";

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({
    length: 1,
  } as DOMRectList);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
});

describe("StudioHybridDccRouteGate", () => {
  it("eagerly isolates the canvas and remains dismissible while DCC is pending", () => {
    const main = document.createElement("main");
    main.id = "main-content";
    main.tabIndex = -1;
    const canvasButton = document.createElement("button");
    canvasButton.textContent = "캔버스 도구";
    main.append(canvasButton);
    document.body.append(main);
    canvasButton.focus();
    const onClose = vi.fn();

    const view = render(
      <StudioHybridDccRouteGate
        detail="권한과 원고를 확인한 뒤 편집기를 엽니다."
        label="3D 작업 권한을 확인하는 중입니다."
        onClose={onClose}
        returnFocus={canvasButton}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "ToonSpectrum 전문 3D 제작" });
    const back = screen.getByRole("button", { name: "캔버스로 돌아가기" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(main.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(back);
    fireEvent.keyDown(back, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();

    view.unmount();
    expect(main.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(canvasButton);
    main.remove();
  });
});
