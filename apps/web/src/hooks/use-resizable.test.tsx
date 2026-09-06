// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useResizable, type ResizableOptions } from "./use-resizable";

function Harness(props: ResizableOptions) {
  const resize = useResizable(props);
  return (
    <div>
      <button type="button" aria-label="패널 너비" {...resize.handleProps} />
      <output data-testid="width">{resize.width}</output>
      <output data-testid="dragging">{String(resize.dragging)}</output>
    </div>
  );
}

afterEach(cleanup);

describe("useResizable", () => {
  it("coalesces pointer input and cleans a cancelled drag before later moves", () => {
    render(<Harness initial={200} min={120} max={360} edge="right" />);
    const handle = screen.getByRole("separator", { name: "패널 너비" });

    fireEvent.pointerDown(handle, {
      pointerId: 7,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      clientX: 100,
    });
    expect(screen.getByTestId("dragging").textContent).toBe("true");
    expect(document.activeElement).toBe(handle);
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 150 });
    fireEvent.pointerCancel(window, { pointerId: 7, clientX: 150 });
    expect(screen.getByTestId("dragging").textContent).toBe("false");
    expect(screen.getByTestId("width").textContent).toBe("250");
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 240 });
    expect(screen.getByTestId("width").textContent).toBe("250");
  });

  it("uses the panel edge for keyboard direction and exposes pixel value text", () => {
    render(<Harness initial={240} min={200} max={300} edge="left" step={20} />);
    const handle = screen.getByRole("separator", { name: "패널 너비" });

    expect(handle.getAttribute("aria-valuenow")).toBe("240");
    expect(handle.getAttribute("aria-valuetext")).toBe("240픽셀, 기본 너비");
    expect(handle.getAttribute("aria-keyshortcuts")).toContain("Enter");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(screen.getByTestId("width").textContent).toBe("260");
    expect(handle.getAttribute("aria-valuenow")).toBe("260");
    expect(handle.getAttribute("aria-valuetext")).toBe("260픽셀");
    fireEvent.keyDown(handle, { key: "Home" });
    expect(screen.getByTestId("width").textContent).toBe("200");
    fireEvent.keyDown(handle, { key: "End" });
    expect(screen.getByTestId("width").textContent).toBe("300");
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(screen.getByTestId("width").textContent).toBe("240");
    expect(handle.getAttribute("aria-valuetext")).toBe("240픽셀, 기본 너비");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.doubleClick(handle);
    expect(screen.getByTestId("width").textContent).toBe("240");
  });

  it("restores the bounded default after a deliberate touch double-tap", () => {
    render(<Harness initial={200} min={120} max={360} edge="right" step={20} />);
    const handle = screen.getByRole("separator", { name: "패널 너비" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(screen.getByTestId("width").textContent).toBe("220");

    fireEvent.pointerDown(handle, {
      pointerId: 11,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: 150,
      clientY: 40,
    });
    fireEvent.pointerUp(window, {
      pointerId: 11,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: 150,
      clientY: 40,
    });
    expect(screen.getByTestId("width").textContent).toBe("220");

    fireEvent.pointerDown(handle, {
      pointerId: 12,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: 154,
      clientY: 42,
    });
    fireEvent.pointerUp(window, {
      pointerId: 12,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: 154,
      clientY: 42,
    });

    expect(screen.getByTestId("width").textContent).toBe("200");
    expect(handle.getAttribute("aria-valuetext")).toBe("200픽셀, 기본 너비");
  });

  it("uses the pointerup endpoint and never records a quick drag as a tap", () => {
    render(<Harness initial={200} min={120} max={360} edge="right" step={20} />);
    const handle = screen.getByRole("separator", { name: "패널 너비" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(screen.getByTestId("width").textContent).toBe("220");

    // Browsers may coalesce a short, fast drag into pointerup without a final pointermove.
    fireEvent.pointerDown(handle, {
      pointerId: 31,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: 100,
      clientY: 40,
    });
    fireEvent.pointerUp(window, {
      pointerId: 31,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: 140,
      clientY: 40,
    });
    expect(screen.getByTestId("width").textContent).toBe("260");

    // This single tap must not combine with the preceding drag and reset the width.
    fireEvent.pointerDown(handle, {
      pointerId: 32,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: 102,
      clientY: 40,
    });
    fireEvent.pointerUp(window, {
      pointerId: 32,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: 102,
      clientY: 40,
    });
    expect(screen.getByTestId("width").textContent).toBe("260");
  });

  it("ignores secondary touch and non-primary pointer buttons", () => {
    render(<Harness initial={200} min={120} max={360} edge="right" />);
    const handle = screen.getByRole("separator", { name: "패널 너비" });

    fireEvent.pointerDown(handle, {
      pointerId: 21,
      pointerType: "touch",
      isPrimary: false,
      button: 0,
      clientX: 100,
    });
    fireEvent.pointerMove(window, { pointerId: 21, clientX: 180 });
    expect(screen.getByTestId("dragging").textContent).toBe("false");
    expect(screen.getByTestId("width").textContent).toBe("200");

    fireEvent.pointerDown(handle, {
      pointerId: 22,
      pointerType: "mouse",
      isPrimary: true,
      button: 2,
      clientX: 100,
    });
    fireEvent.pointerMove(window, { pointerId: 22, clientX: 180 });
    expect(screen.getByTestId("dragging").textContent).toBe("false");
    expect(screen.getByTestId("width").textContent).toBe("200");
  });

  it("clamps an out-of-range default before exposing separator values", () => {
    render(<Harness initial={500} min={120} max={360} edge="right" />);
    const handle = screen.getByRole("separator", { name: "패널 너비" });

    expect(screen.getByTestId("width").textContent).toBe("360");
    expect(handle.getAttribute("aria-valuenow")).toBe("360");
    expect(handle.getAttribute("aria-valuetext")).toBe("360픽셀, 기본 너비");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(screen.getByTestId("width").textContent).toBe("360");
  });
});
