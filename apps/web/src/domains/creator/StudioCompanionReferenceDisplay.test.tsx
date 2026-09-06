// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioCompanionReferenceDisplay,
  type StudioCompanionReferencePreviewMetadata,
} from "./StudioCompanionReferenceDisplay";

import type {
  StudioCompanionReferenceControl,
  StudioCompanionReferenceProjection,
} from "./studio-companion-reference-projection";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function projection(
  overrides: Partial<StudioCompanionReferenceProjection> = {}
): StudioCompanionReferenceProjection {
  return {
    generation: 2,
    revision: 9,
    referenceRevision: 5,
    itemCount: 4,
    resolvedItemCount: 4,
    canPickColor: true,
    ...overrides,
  };
}

function preview(
  overrides: Partial<StudioCompanionReferencePreviewMetadata> = {}
): StudioCompanionReferencePreviewMetadata {
  return {
    url: "blob:reference-composite",
    generation: 2,
    revision: 9,
    referenceRevision: 5,
    sequence: 3,
    width: 100,
    height: 200,
    ...overrides,
  };
}

function renderDisplay(input: {
  projection?: StudioCompanionReferenceProjection | null;
  preview?: StudioCompanionReferencePreviewMetadata | null;
  connectionStatus?: "connected" | "reconnecting" | "disconnected";
  onControl?: (control: StudioCompanionReferenceControl) => void;
} = {}) {
  const onControl = input.onControl ?? vi.fn<(control: StudioCompanionReferenceControl) => void>();
  const view = render(
    <StudioCompanionReferenceDisplay
      projection={input.projection === undefined ? projection() : input.projection}
      preview={input.preview === undefined ? preview() : input.preview}
      connectionStatus={input.connectionStatus ?? "connected"}
      onControl={onControl}
    />
  );
  return { ...view, onControl };
}

function setViewportBounds(viewport: HTMLElement, width = 300, height = 300) {
  Object.defineProperty(viewport, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    }),
  });
}

describe("StudioCompanionReferenceDisplay", () => {
  it("renders explicit loading, empty, partial, unavailable, reconnecting, and disconnected states", () => {
    const { rerender } = render(
      <StudioCompanionReferenceDisplay
        projection={null}
        preview={null}
        connectionStatus="connected"
        onControl={vi.fn()}
      />
    );
    expect(screen.getAllByText("레퍼런스 미리보기를 준비하고 있어요").length).toBeGreaterThan(0);

    rerender(
      <StudioCompanionReferenceDisplay
        projection={projection({ itemCount: 0, resolvedItemCount: 0, canPickColor: false })}
        preview={null}
        connectionStatus="connected"
        onControl={vi.fn()}
      />
    );
    expect(screen.getAllByText("레퍼런스가 아직 없습니다").length).toBeGreaterThan(0);

    rerender(
      <StudioCompanionReferenceDisplay
        projection={projection({ resolvedItemCount: 2 })}
        preview={preview()}
        connectionStatus="connected"
        onControl={vi.fn()}
      />
    );
    expect(screen.getByRole("status").textContent).toContain("일부 레퍼런스만 표시 중 · 2/4");

    rerender(
      <StudioCompanionReferenceDisplay
        projection={projection({ resolvedItemCount: 0, canPickColor: false })}
        preview={null}
        connectionStatus="connected"
        onControl={vi.fn()}
      />
    );
    expect(screen.getAllByText("표시할 수 있는 레퍼런스가 없습니다").length).toBeGreaterThan(0);

    rerender(
      <StudioCompanionReferenceDisplay
        projection={projection()}
        preview={preview()}
        connectionStatus="reconnecting"
        onControl={vi.fn()}
      />
    );
    expect(screen.getAllByText("기본 스튜디오에 다시 연결하는 중").length).toBeGreaterThan(0);

    rerender(
      <StudioCompanionReferenceDisplay
        projection={projection()}
        preview={preview()}
        connectionStatus="disconnected"
        onControl={vi.fn()}
      />
    );
    expect(screen.getAllByText("기본 스튜디오 연결이 끊겼습니다").length).toBeGreaterThan(0);
  });

  it("keeps the picker disabled without a current frame or color capability", () => {
    const { rerender } = render(
      <StudioCompanionReferenceDisplay
        projection={projection()}
        preview={null}
        connectionStatus="connected"
        onControl={vi.fn()}
      />
    );
    expect((screen.getByRole("button", { name: "스포이드" }) as HTMLButtonElement).disabled).toBe(true);

    rerender(
      <StudioCompanionReferenceDisplay
        projection={projection({ canPickColor: false })}
        preview={preview()}
        connectionStatus="connected"
        onControl={vi.fn()}
      />
    );
    expect((screen.getByRole("button", { name: "스포이드" }) as HTMLButtonElement).disabled).toBe(true);

    rerender(
      <StudioCompanionReferenceDisplay
        projection={projection()}
        preview={preview({ referenceRevision: 4 })}
        connectionStatus="connected"
        onControl={vi.fn()}
      />
    );
    expect((screen.getByRole("button", { name: "스포이드" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends exact demand, click-pick, Enter-pick, and release controls", () => {
    const onControl = vi.fn();
    const view = renderDisplay({ onControl });
    expect(onControl).toHaveBeenNthCalledWith(1, {
      kind: "reference-preview-demand",
      active: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "스포이드" }));
    const viewport = screen.getByRole("button", { name: "합성된 레퍼런스 보드" });
    setViewportBounds(viewport);
    fireEvent.click(viewport, { button: 0, clientX: 150, clientY: 75 });
    expect(onControl).toHaveBeenNthCalledWith(2, {
      kind: "reference-pick-color",
      point: { x: 0.5, y: 0.25 },
      referenceRevision: 5,
      sequence: 1,
    });

    fireEvent.keyDown(viewport, { key: "Enter" });
    expect(onControl).toHaveBeenNthCalledWith(3, {
      kind: "reference-pick-color",
      point: { x: 0.5, y: 0.5 },
      referenceRevision: 5,
      sequence: 2,
    });

    view.unmount();
    expect(onControl).toHaveBeenNthCalledWith(4, {
      kind: "reference-preview-demand",
      active: false,
    });
  });

  it("reissues demand after reconnect and releases it on disconnect or pagehide", () => {
    const onControl = vi.fn();
    const view = render(
      <StudioCompanionReferenceDisplay
        projection={projection()}
        preview={preview()}
        connectionStatus="disconnected"
        onControl={onControl}
      />
    );
    expect(onControl).not.toHaveBeenCalled();

    view.rerender(
      <StudioCompanionReferenceDisplay
        projection={projection()}
        preview={preview()}
        connectionStatus="connected"
        onControl={onControl}
      />
    );
    expect(onControl).toHaveBeenLastCalledWith({
      kind: "reference-preview-demand",
      active: true,
    });

    view.rerender(
      <StudioCompanionReferenceDisplay
        projection={projection()}
        preview={preview()}
        connectionStatus="reconnecting"
        onControl={onControl}
      />
    );
    expect(onControl).toHaveBeenLastCalledWith({
      kind: "reference-preview-demand",
      active: false,
    });

    view.rerender(
      <StudioCompanionReferenceDisplay
        projection={projection()}
        preview={preview()}
        connectionStatus="connected"
        onControl={onControl}
      />
    );
    window.dispatchEvent(new Event("pagehide"));
    expect(onControl).toHaveBeenLastCalledWith({
      kind: "reference-preview-demand",
      active: false,
    });
    window.dispatchEvent(new Event("pageshow"));
    expect(onControl).toHaveBeenLastCalledWith({
      kind: "reference-preview-demand",
      active: true,
    });

    view.rerender(
      <StudioCompanionReferenceDisplay
        projection={projection({ generation: 3 })}
        preview={preview({ generation: 3 })}
        connectionStatus="connected"
        onControl={onControl}
      />
    );
    expect(onControl).toHaveBeenLastCalledWith({
      kind: "reference-preview-demand",
      active: true,
    });

    const replacementControl = vi.fn();
    view.rerender(
      <StudioCompanionReferenceDisplay
        projection={projection({ generation: 3 })}
        preview={preview({ generation: 3 })}
        connectionStatus="connected"
        connectionEpoch={1}
        onControl={replacementControl}
      />
    );
    expect(replacementControl).toHaveBeenCalledWith({
      kind: "reference-preview-demand",
      active: true,
    });
  });

  it("rejects clicks in the letterbox and never floods controls during local panning", () => {
    const { onControl } = renderDisplay();
    fireEvent.click(screen.getByRole("button", { name: "스포이드" }));
    const viewport = screen.getByRole("button", { name: "합성된 레퍼런스 보드" });
    setViewportBounds(viewport);

    // A 1:2 image in a 1:1 viewport occupies x=75..225; x=30 is letterbox.
    fireEvent.click(viewport, { button: 0, clientX: 30, clientY: 150 });
    expect(onControl).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toContain("이미지 안쪽");

    fireEvent.pointerDown(viewport, { button: 1, pointerId: 12, clientX: 140, clientY: 140 });
    fireEvent.pointerMove(viewport, { pointerId: 12, clientX: 150, clientY: 145 });
    fireEvent.pointerMove(viewport, { pointerId: 12, clientX: 170, clientY: 160 });
    fireEvent.pointerUp(viewport, { button: 1, pointerId: 12, clientX: 170, clientY: 160 });
    expect(onControl).toHaveBeenCalledTimes(1);
  });

  it("lets touch users pan with one finger when the picker is off", () => {
    const { container } = renderDisplay();
    const viewport = screen.getByRole("button", { name: "합성된 레퍼런스 보드" });
    fireEvent.pointerDown(viewport, {
      button: 0,
      pointerId: 21,
      pointerType: "touch",
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 21,
      pointerType: "touch",
      clientX: 124,
      clientY: 112,
    });
    fireEvent.pointerUp(viewport, {
      button: 0,
      pointerId: 21,
      pointerType: "touch",
      clientX: 124,
      clientY: 112,
    });

    expect(container.querySelector("img")?.style.transform)
      .toContain("translate3d(24px, 12px, 0)");
    expect(screen.getByRole("status").textContent).toContain("위치를 옮겼습니다");
  });

  it("pinch-zooms around the moving centroid and transitions to one-finger pan", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    const { container } = renderDisplay();
    const viewport = screen.getByRole("button", { name: "합성된 레퍼런스 보드" });
    setViewportBounds(viewport);
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.assign(viewport, {
      setPointerCapture,
      releasePointerCapture,
      hasPointerCapture: () => true,
    });

    fireEvent.pointerDown(viewport, {
      button: 0,
      pointerId: 41,
      pointerType: "touch",
      clientX: 50,
      clientY: 100,
    });
    fireEvent.pointerDown(viewport, {
      button: 0,
      pointerId: 42,
      pointerType: "touch",
      clientX: 150,
      clientY: 100,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 41,
      pointerType: "touch",
      clientX: 75,
      clientY: 100,
    });
    const moveAccepted = fireEvent.pointerMove(viewport, {
      pointerId: 42,
      pointerType: "touch",
      clientX: 225,
      clientY: 100,
    });

    expect(moveAccepted).toBe(false);
    expect(container.querySelector("img")?.style.transform)
      .toBe("translate3d(75px, 25px, 0) scale(1.5)");
    expect(screen.getByRole("status").textContent).not.toContain("두 손가락 중심을 유지했습니다");

    fireEvent.pointerUp(viewport, {
      button: 0,
      pointerId: 42,
      pointerType: "touch",
      clientX: 225,
      clientY: 100,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 41,
      pointerType: "touch",
      clientX: 95,
      clientY: 110,
    });
    fireEvent.pointerUp(viewport, {
      button: 0,
      pointerId: 41,
      pointerType: "touch",
      clientX: 95,
      clientY: 110,
    });

    expect(container.querySelector("img")?.style.transform)
      .toBe("translate3d(95px, 35px, 0) scale(1.5)");
    expect(screen.getByRole("status").textContent).toContain("핀치 확대를 마쳤습니다");
    expect(setPointerCapture).toHaveBeenCalledTimes(2);
    expect(releasePointerCapture).toHaveBeenCalledWith(42);
    expect(releasePointerCapture).toHaveBeenCalledWith(41);
  });

  it("blocks picker sampling during pinch and safely ignores a third or zero-distance pointer", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    const { container, onControl } = renderDisplay();
    const viewport = screen.getByRole("button", { name: "합성된 레퍼런스 보드" });
    setViewportBounds(viewport);
    fireEvent.click(screen.getByRole("button", { name: "스포이드" }));

    for (const pointerId of [51, 52] as const) {
      fireEvent.pointerDown(viewport, {
        button: 0,
        pointerId,
        pointerType: "touch",
        clientX: 100,
        clientY: 100,
      });
    }
    fireEvent.pointerDown(viewport, {
      button: 0,
      pointerId: 53,
      pointerType: "touch",
      clientX: 250,
      clientY: 250,
    });
    expect(container.querySelector("img")?.style.transform).not.toContain("NaN");

    fireEvent.pointerMove(viewport, {
      pointerId: 52,
      pointerType: "touch",
      clientX: 200,
      clientY: 100,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 52,
      pointerType: "touch",
      clientX: 250,
      clientY: 100,
    });
    expect(container.querySelector("img")?.style.transform).toContain("scale(1.5)");

    fireEvent.pointerUp(viewport, {
      pointerId: 52,
      pointerType: "touch",
      clientX: 250,
      clientY: 100,
    });
    fireEvent.pointerUp(viewport, {
      pointerId: 51,
      pointerType: "touch",
      clientX: 100,
      clientY: 100,
    });
    fireEvent.click(viewport, { button: 0, clientX: 150, clientY: 150 });

    expect(onControl).toHaveBeenCalledTimes(1);
    expect(onControl).toHaveBeenCalledWith({
      kind: "reference-preview-demand",
      active: true,
    });
    expect(screen.getByRole("button", { name: "스포이드" }).getAttribute("aria-pressed"))
      .toBe("true");

    fireEvent.pointerDown(viewport, {
      button: 0,
      pointerId: 54,
      pointerType: "touch",
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerDown(viewport, {
      button: 0,
      pointerId: 55,
      pointerType: "touch",
      clientX: 101,
      clientY: 100,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 55,
      pointerType: "touch",
      clientX: 1_000,
      clientY: 100,
    });
    expect(container.querySelector("img")?.style.transform).toContain("scale(8)");
    fireEvent.pointerMove(viewport, {
      pointerId: 55,
      pointerType: "touch",
      clientX: 100.1,
      clientY: 100,
    });
    expect(container.querySelector("img")?.style.transform).toContain("scale(0.25)");
  });

  it("cleans up pinch capture on cancel, lost capture, preview replacement and disconnect", () => {
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 91;
    }));
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
    const view = renderDisplay();
    const viewport = screen.getByRole("button", { name: "합성된 레퍼런스 보드" });
    setViewportBounds(viewport);
    const releasePointerCapture = vi.fn();
    Object.assign(viewport, {
      setPointerCapture: vi.fn(),
      releasePointerCapture,
      hasPointerCapture: () => true,
    });

    fireEvent.pointerDown(viewport, {
      button: 0,
      pointerId: 61,
      pointerType: "touch",
      clientX: 75,
      clientY: 100,
    });
    fireEvent.pointerDown(viewport, {
      button: 0,
      pointerId: 62,
      pointerType: "touch",
      clientX: 175,
      clientY: 100,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 62,
      pointerType: "touch",
      clientX: 225,
      clientY: 100,
    });
    expect(frame).not.toBeNull();

    view.rerender(
      <StudioCompanionReferenceDisplay
        projection={projection({ revision: 10, referenceRevision: 6 })}
        preview={preview({
          url: "blob:replacement-reference",
          revision: 10,
          referenceRevision: 6,
          sequence: 4,
        })}
        connectionStatus="connected"
        onControl={vi.fn()}
      />
    );
    expect(cancelAnimationFrame).toHaveBeenCalledWith(91);
    expect(releasePointerCapture).toHaveBeenCalledWith(61);
    expect(releasePointerCapture).toHaveBeenCalledWith(62);
    expect(view.container.querySelector("img")?.style.transform)
      .toBe("translate3d(0px, 0px, 0) scale(1)");

    const replacementViewport = screen.getByRole("button", { name: "합성된 레퍼런스 보드" });
    setViewportBounds(replacementViewport);
    fireEvent.pointerDown(replacementViewport, {
      button: 0,
      pointerId: 63,
      pointerType: "touch",
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerCancel(replacementViewport, {
      pointerId: 63,
      pointerType: "touch",
      clientX: 100,
      clientY: 100,
    });
    fireEvent.lostPointerCapture(replacementViewport, {
      pointerId: 63,
      pointerType: "touch",
    });
    fireEvent.pointerDown(replacementViewport, {
      button: 0,
      pointerId: 65,
      pointerType: "touch",
      clientX: 100,
      clientY: 100,
    });
    fireEvent.lostPointerCapture(replacementViewport, {
      pointerId: 65,
      pointerType: "touch",
    });
    fireEvent.pointerMove(replacementViewport, {
      pointerId: 65,
      pointerType: "touch",
      clientX: 200,
      clientY: 200,
    });

    view.rerender(
      <StudioCompanionReferenceDisplay
        projection={projection({ revision: 10, referenceRevision: 6 })}
        preview={preview({
          url: "blob:replacement-reference",
          revision: 10,
          referenceRevision: 6,
          sequence: 4,
        })}
        connectionStatus="disconnected"
        onControl={vi.fn()}
      />
    );
    fireEvent.pointerDown(replacementViewport, {
      button: 0,
      pointerId: 64,
      pointerType: "touch",
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(replacementViewport, {
      pointerId: 64,
      pointerType: "touch",
      clientX: 150,
      clientY: 150,
    });
    expect(view.container.querySelector("img")?.style.transform)
      .toBe("translate3d(0px, 0px, 0) scale(1)");
  });

  it("keeps the image point below the pointer anchored while wheel-zooming", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    const onControl = vi.fn();
    const { container } = renderDisplay({ onControl });
    const viewport = screen.getByRole("button", { name: "합성된 레퍼런스 보드" });
    setViewportBounds(viewport);
    const wheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 200,
      clientY: 100,
      deltaY: -100,
      deltaMode: 0,
    });

    fireEvent(viewport, wheel);

    expect(wheel.defaultPrevented).toBe(true);
    expect(container.querySelector("img")?.style.transform)
      .toBe("translate3d(-12.5px, 12.5px, 0) scale(1.25)");
    expect(screen.getByRole("status").textContent)
      .not.toContain("포인터 위치를 유지했습니다");

    fireEvent.click(screen.getByRole("button", { name: "스포이드" }));
    fireEvent.click(viewport, { button: 0, clientX: 200, clientY: 100 });
    const pick = onControl.mock.calls.at(-1)?.[0];
    expect(pick?.kind).toBe("reference-pick-color");
    if (pick?.kind !== "reference-pick-color") throw new Error("pick missing");
    expect(pick.point.x).toBeCloseTo(5 / 6, 6);
    expect(pick.point.y).toBeCloseTo(1 / 3, 6);
  });

  it("allows page scrolling while the reference surface is empty or disconnected", () => {
    const view = renderDisplay({ connectionStatus: "disconnected" });
    const viewport = screen.getByRole("button", { name: "합성된 레퍼런스 보드" });
    setViewportBounds(viewport);

    expect((viewport as HTMLButtonElement).style.touchAction).toBe("pan-y");

    const touchDown = new Event("pointerdown", { bubbles: true, cancelable: true });
    Object.defineProperties(touchDown, {
      pointerType: { value: "touch" },
      pointerId: { value: 71 },
      button: { value: 0 },
      clientX: { value: 100 },
      clientY: { value: 100 },
    });
    fireEvent(viewport, touchDown);
    expect(touchDown.defaultPrevented).toBe(false);

    const wheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 100,
      deltaY: 40,
    });
    fireEvent(viewport, wheel);
    expect(wheel.defaultPrevented).toBe(false);

    const nativeGesture = new Event("gesturestart", { bubbles: true, cancelable: true });
    fireEvent(viewport, nativeGesture);
    expect(nativeGesture.defaultPrevented).toBe(false);

    view.rerender(
      <StudioCompanionReferenceDisplay
        projection={projection({ itemCount: 0, resolvedItemCount: 0, canPickColor: false })}
        preview={null}
        connectionStatus="connected"
        onControl={vi.fn()}
      />
    );
    expect((screen.getByRole("button", {
      name: "합성된 레퍼런스 보드",
    }) as HTMLButtonElement).style.touchAction).toBe("pan-y");
  });

  it("coalesces dense trackpad wheel input into one animation-frame commit", () => {
    let frame: FrameRequestCallback | null = null;
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 7;
    });
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { container } = renderDisplay();
    const viewport = screen.getByRole("button", { name: "합성된 레퍼런스 보드" });
    setViewportBounds(viewport);

    fireEvent.wheel(viewport, { clientX: 200, clientY: 100, deltaY: -20 });
    fireEvent.wheel(viewport, { clientX: 200, clientY: 100, deltaY: -20 });
    fireEvent.wheel(viewport, { clientX: 200, clientY: 100, deltaY: -20 });
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    expect(container.querySelector("img")?.style.transform)
      .toBe("translate3d(0px, 0px, 0) scale(1)");

    act(() => frame?.(16));
    expect(container.querySelector("img")?.style.transform).not.toContain("scale(1)");
  });

  it("handles Ctrl/Cmd wheel locally and keeps zoom inside the 25%–800% limits", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    const { container } = renderDisplay();
    const viewport = screen.getByRole("button", { name: "합성된 레퍼런스 보드" });
    setViewportBounds(viewport);
    const ctrlWheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 150,
      clientY: 150,
      deltaY: -100,
      ctrlKey: true,
    });
    fireEvent(viewport, ctrlWheel);
    expect(ctrlWheel.defaultPrevented).toBe(true);
    expect(container.querySelector("img")?.style.transform).toContain("scale(1.25)");

    const metaWheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 150,
      clientY: 150,
      deltaY: 100,
      metaKey: true,
    });
    fireEvent(viewport, metaWheel);
    expect(metaWheel.defaultPrevented).toBe(true);
    expect(container.querySelector("img")?.style.transform).toContain("scale(1)");

    for (let index = 0; index < 40; index += 1) {
      fireEvent.wheel(viewport, { clientX: 150, clientY: 150, deltaY: -100 });
    }
    expect(container.querySelector("img")?.style.transform).toContain("scale(8)");
    expect((screen.getByRole("button", { name: "확대" }) as HTMLButtonElement).disabled).toBe(true);

    for (let index = 0; index < 80; index += 1) {
      fireEvent.wheel(viewport, { clientX: 150, clientY: 150, deltaY: 100 });
    }
    expect(container.querySelector("img")?.style.transform).toContain("scale(0.25)");
    expect((screen.getByRole("button", { name: "축소" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("announces continuous wheel zoom only once after the interaction becomes idle", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", undefined);
    renderDisplay();
    const viewport = screen.getByRole("button", { name: "합성된 레퍼런스 보드" });
    setViewportBounds(viewport);

    fireEvent.wheel(viewport, { clientX: 150, clientY: 150, deltaY: -40 });
    fireEvent.wheel(viewport, { clientX: 150, clientY: 150, deltaY: -40 });
    expect(screen.getByRole("status").textContent).not.toContain("포인터 위치를 유지했습니다");

    act(() => vi.advanceTimersByTime(149));
    expect(screen.getByRole("status").textContent).not.toContain("포인터 위치를 유지했습니다");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status").textContent).toContain("포인터 위치를 유지했습니다");
  });

  it("toggles fit and original 100% on double click without stealing picker or touch gestures", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    const { container, onControl } = renderDisplay();
    const viewport = screen.getByRole("button", { name: "합성된 레퍼런스 보드" });
    setViewportBounds(viewport, 400, 400);

    fireEvent.doubleClick(viewport, { button: 0, clientX: 200, clientY: 200 });
    expect(screen.getByRole("button", { name: "원본 100% 크기" }).textContent).toBe("100%");
    expect(container.querySelector("img")?.style.transform).toContain("scale(0.5)");
    fireEvent.doubleClick(viewport, { button: 0, clientX: 200, clientY: 200 });
    expect(screen.getByRole("button", { name: "원본 100% 크기" }).textContent).toBe("맞춤");
    expect(container.querySelector("img")?.style.transform).toContain("scale(1)");

    fireEvent.click(screen.getByRole("button", { name: "스포이드" }));
    fireEvent.click(viewport, { button: 0, detail: 1, clientX: 200, clientY: 200 });
    fireEvent.click(viewport, { button: 0, detail: 2, clientX: 200, clientY: 200 });
    fireEvent.doubleClick(viewport, { button: 0, clientX: 200, clientY: 200 });
    expect(screen.getByRole("button", { name: "원본 100% 크기" }).textContent).toBe("맞춤");
    expect(onControl).toHaveBeenCalledTimes(2);
    expect(onControl).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: "reference-pick-color",
      sequence: 1,
    }));

    fireEvent.click(screen.getByRole("button", { name: "스포이드" }));
    fireEvent.pointerDown(viewport, {
      button: 0,
      pointerId: 31,
      pointerType: "touch",
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerUp(viewport, {
      button: 0,
      pointerId: 31,
      pointerType: "touch",
      clientX: 200,
      clientY: 200,
    });
    fireEvent.doubleClick(viewport, { button: 0, clientX: 200, clientY: 200 });
    expect(screen.getByRole("button", { name: "원본 100% 크기" }).textContent).toBe("맞춤");
  });

  it("continues to reject letterbox and outside picks after an anchored zoom", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    const { onControl } = renderDisplay();
    fireEvent.click(screen.getByRole("button", { name: "스포이드" }));
    const viewport = screen.getByRole("button", { name: "합성된 레퍼런스 보드" });
    setViewportBounds(viewport);
    fireEvent.wheel(viewport, { clientX: 200, clientY: 100, deltaY: -100 });
    fireEvent.click(viewport, { button: 0, clientX: 10, clientY: 150 });
    fireEvent.click(viewport, { button: 0, clientX: 330, clientY: 150 });

    expect(onControl).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toContain("이미지 안쪽");
  });

  it("hides stale, non-blob, empty, and generation-mismatched previews", () => {
    const view = renderDisplay({ preview: preview({ generation: 1 }) });
    expect(view.container.querySelector("img")).toBeNull();

    view.rerender(
      <StudioCompanionReferenceDisplay
        projection={projection({ itemCount: 0, resolvedItemCount: 0, canPickColor: false })}
        preview={preview()}
        connectionStatus="connected"
        onControl={vi.fn()}
      />
    );
    expect(view.container.querySelector("img")).toBeNull();

    view.rerender(
      <StudioCompanionReferenceDisplay
        projection={projection()}
        preview={preview({ url: "https://example.com/reference.webp" })}
        connectionStatus="connected"
        onControl={vi.fn()}
      />
    );
    expect(view.container.querySelector("img")).toBeNull();
  });

  it("supports fit, zoom, eyedropper, Escape, Space-pan, and center-pick shortcuts", () => {
    const { onControl } = renderDisplay();
    const viewport = screen.getByRole("button", { name: "합성된 레퍼런스 보드" });
    setViewportBounds(viewport, 400, 400);

    fireEvent.keyDown(viewport, { key: "i", code: "KeyI" });
    expect(screen.getByRole("button", { name: "스포이드" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(viewport, { key: "Enter" });
    expect(onControl).toHaveBeenLastCalledWith({
      kind: "reference-pick-color",
      point: { x: 0.5, y: 0.5 },
      referenceRevision: 5,
      sequence: 1,
    });

    fireEvent.keyDown(viewport, { key: "+", code: "Equal" });
    expect(screen.getByRole("status").textContent).toContain("확대율");
    fireEvent.keyDown(viewport, { key: "0", code: "Digit0" });
    expect(screen.getByRole("button", { name: "원본 100% 크기" }).textContent).toBe("맞춤");

    fireEvent.keyDown(viewport, { key: " ", code: "Space" });
    expect(viewport.className).toContain("cursor-grab");
    fireEvent.keyUp(viewport, { key: " ", code: "Space" });
    fireEvent.keyDown(viewport, { key: "Escape", code: "Escape" });
    expect(screen.getByRole("button", { name: "스포이드" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("uses 44px touch targets, accessible labels, and only aggregate reference copy", () => {
    const view = render(
      <StudioCompanionReferenceDisplay
        projection={projection({ itemCount: 7, resolvedItemCount: 6 })}
        preview={preview()}
        connectionStatus="connected"
        latestColorResult={null}
        onControl={vi.fn()}
      />
    );
    const { container } = view;

    expect(screen.queryByLabelText(/최근 선택 색상/u)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "스포이드" }));
    const viewport = screen.getByRole("button", { name: "합성된 레퍼런스 보드" });
    setViewportBounds(viewport);
    fireEvent.click(viewport, { button: 0, clientX: 150, clientY: 150 });
    view.rerender(
      <StudioCompanionReferenceDisplay
        projection={projection({ itemCount: 7, resolvedItemCount: 6 })}
        preview={preview()}
        connectionStatus="connected"
        latestColorResult={{
          color: "#32A6D8",
          generation: 2,
          revision: 9,
          referenceRevision: 5,
          sequence: 1,
        }}
        onControl={vi.fn()}
      />
    );

    const toolbar = screen.getByRole("toolbar", { name: "레퍼런스 보기 도구" });
    expect(toolbar).toBeTruthy();
    expect(screen.getByRole("button", { name: "합성된 레퍼런스 보드" }).getAttribute("aria-keyshortcuts"))
      .toBe("0 + - I Escape Enter Space");
    expect(screen.getByText(/두 손가락 확대 · 한 손가락 이동/u).className)
      .toContain("pointer:coarse");
    expect((screen.getByRole("button", {
      name: "합성된 레퍼런스 보드",
    }) as HTMLButtonElement).style.touchAction).toBe("none");
    for (const button of within(toolbar).getAllByRole("button")) {
      expect(button.className).toContain("min-h-11");
      expect(button.className).toContain("min-w-11");
      expect(button.getAttribute("aria-label")).toBeTruthy();
    }
    const liveStatus = container.querySelector('p[role="status"]');
    expect(liveStatus?.getAttribute("aria-live")).toBe("polite");
    expect(liveStatus?.getAttribute("aria-atomic")).toBe("true");
    expect(liveStatus?.textContent).toContain("6/7");
    expect(liveStatus?.textContent).toContain("선택한 색 #32A6D8");
    expect(screen.getByLabelText("최근 선택 색상 #32A6D8")).toBeTruthy();
    expect(container.textContent).not.toMatch(/item[-_ ]?id|filename|source url|asset[-_ ]?id/iu);
    expect(container.textContent).not.toContain("blob:reference-composite");
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("합성된 레퍼런스 보드 미리보기");
  });
});
