// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioCompanionNavigator } from "./StudioCompanionNavigator";

import { useI18n } from "@/shared/lib/i18n";

afterEach(cleanup);

beforeEach(() => {
  useI18n.getState().setLang("ko");
});

describe("StudioCompanionNavigator", () => {
  it("renders the normalized viewport and sends click/drag navigation", () => {
    const onNavigate = vi.fn();
    render(
      <StudioCompanionNavigator
        imageUrl="blob:preview"
        imageWidth={1_000}
        imageHeight={2_000}
        viewport={{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }}
        connected
        captureAllowed
        onNavigate={onNavigate}
      />
    );
    const navigator = screen.getByRole("button", { name: "전체 캔버스 미리보기에서 보이는 위치 이동" });
    Object.defineProperty(navigator, "getBoundingClientRect", {
      value: () => ({ left: 10, top: 20, width: 200, height: 400, right: 210, bottom: 420 }),
    });
    fireEvent.pointerDown(navigator, { pointerId: 7, clientX: 110, clientY: 120 });
    fireEvent.pointerMove(navigator, { pointerId: 7, clientX: 210, clientY: 420 });
    fireEvent(navigator, new Event("lostpointercapture", { bubbles: true }));
    fireEvent.pointerMove(navigator, { pointerId: 7, clientX: 40, clientY: 80 });
    fireEvent.pointerUp(navigator, { pointerId: 7 });

    expect(onNavigate).toHaveBeenNthCalledWith(1, { x: 0.5, y: 0.25 });
    expect(onNavigate).toHaveBeenNthCalledWith(2, { x: 1, y: 1 });
    expect(onNavigate).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("studio-companion-viewport-box").getAttribute("x")).toBe("100");
  });

  it("supports keyboard navigation and keeps the surface disabled without a frame", () => {
    const onNavigate = vi.fn();
    const view = render(
      <StudioCompanionNavigator
        imageUrl="blob:preview"
        imageWidth={720}
        imageHeight={1_080}
        viewport={{ x: 0.2, y: 0.3, width: 0.4, height: 0.2 }}
        connected
        captureAllowed
        onNavigate={onNavigate}
      />
    );
    const navigator = screen.getByRole("button", { name: "전체 캔버스 미리보기에서 보이는 위치 이동" });
    fireEvent.keyDown(navigator, { key: "ArrowRight" });
    fireEvent.keyDown(navigator, { key: "Home" });
    expect(onNavigate).toHaveBeenNthCalledWith(1, { x: 0.45, y: 0.4 });
    expect(onNavigate).toHaveBeenNthCalledWith(2, { x: 0.5, y: 0.5 });

    view.rerender(
      <StudioCompanionNavigator
        imageUrl={null}
        imageWidth={0}
        imageHeight={0}
        viewport={{ x: 0, y: 0, width: 1, height: 1 }}
        connected
        captureAllowed={false}
        onNavigate={onNavigate}
      />
    );
    expect((screen.getByRole("button", { name: "전체 캔버스 미리보기에서 보이는 위치 이동" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(screen.getByRole("status").textContent).toContain("획을 그리는 동안");
  });

  it("disables pointer and keyboard navigation while the primary is drawing", () => {
    const onNavigate = vi.fn();
    render(
      <StudioCompanionNavigator
        imageUrl="blob:preview"
        imageWidth={720}
        imageHeight={1_080}
        viewport={{ x: 0.2, y: 0.3, width: 0.4, height: 0.2 }}
        connected
        captureAllowed={false}
        onNavigate={onNavigate}
      />
    );
    const navigator = screen.getByRole("button", { name: "전체 캔버스 미리보기에서 보이는 위치 이동" });

    expect((navigator as HTMLButtonElement).disabled).toBe(true);
    fireEvent.pointerDown(navigator, { pointerId: 5, clientX: 100, clientY: 100 });
    fireEvent.keyDown(navigator, { key: "ArrowRight" });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("cancels a drag without navigating to the cancellation event coordinates", () => {
    const onNavigate = vi.fn();
    render(
      <StudioCompanionNavigator
        imageUrl="blob:preview"
        imageWidth={1_000}
        imageHeight={2_000}
        viewport={{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }}
        connected
        captureAllowed
        onNavigate={onNavigate}
      />
    );
    const navigator = screen.getByRole("button", { name: "전체 캔버스 미리보기에서 보이는 위치 이동" });
    Object.defineProperty(navigator, "getBoundingClientRect", {
      value: () => ({ left: 10, top: 20, width: 200, height: 400, right: 210, bottom: 420 }),
    });

    fireEvent.pointerDown(navigator, { pointerId: 9, clientX: 110, clientY: 220 });
    fireEvent.pointerCancel(navigator, { pointerId: 9, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(navigator, { pointerId: 9, clientX: 20, clientY: 40 });
    fireEvent.pointerUp(navigator, { pointerId: 9, clientX: 20, clientY: 40 });

    expect(onNavigate).toHaveBeenCalledOnce();
    expect(onNavigate).toHaveBeenLastCalledWith({ x: 0.5, y: 0.5 });
  });

  it("contains extreme canvas ratios and maps letterbox input onto canvas bounds", () => {
    const onNavigate = vi.fn();
    render(
      <StudioCompanionNavigator
        imageUrl="blob:tall-preview"
        imageWidth={800}
        imageHeight={8_000}
        viewport={{ x: 0.2, y: 0.3, width: 0.4, height: 0.2 }}
        connected
        captureAllowed
        layout="dedicated"
        onNavigate={onNavigate}
      />
    );
    const navigator = screen.getByRole("button", { name: "전체 캔버스 미리보기에서 보이는 위치 이동" });
    Object.defineProperty(navigator, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 300, height: 500, right: 300, bottom: 500 }),
    });

    fireEvent.pointerDown(navigator, { pointerId: 11, clientX: 10, clientY: 250 });
    fireEvent.pointerUp(navigator, { pointerId: 11, clientX: 290, clientY: 500 });

    expect(onNavigate).toHaveBeenNthCalledWith(1, { x: 0, y: 0.5 });
    expect(onNavigate).toHaveBeenNthCalledWith(2, { x: 1, y: 1 }, true);
    expect(navigator.className).toContain("100dvh");
    expect(screen.getByAltText("현재 페이지 전체 캔버스").className).toContain("object-contain");
    expect(navigator.getAttribute("aria-keyshortcuts")).toContain("ArrowLeft");
  });
});
