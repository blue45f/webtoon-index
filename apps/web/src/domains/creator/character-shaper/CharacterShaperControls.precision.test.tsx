// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CharacterColorControl, CharacterRangeControl } from "./CharacterShaperControls";

import type { ComponentProps } from "react";

afterEach(cleanup);

function range(overrides: Partial<ComponentProps<typeof CharacterRangeControl>> = {}) {
  const onCommit = vi.fn();
  const onPreview = vi.fn();
  const view = render(<CharacterRangeControl label="눈 크기" value={0.2} min={-1} max={1}
    step={0.01} defaultValue={0} onCommit={onCommit} onPreview={onPreview} {...overrides} />);
  return { ...view, onCommit, onPreview, slider: screen.getByRole("slider", { name: "눈 크기" }),
    number: screen.getByLabelText("눈 크기 값 입력") as HTMLInputElement };
}

describe("character precision interaction regressions", () => {
  it("commits exactly once when preview updates the controlled prop", () => {
    const onCommit = vi.fn();
    function Controlled() {
      const [value, setValue] = useState(0.2);
      return <CharacterRangeControl label="눈 크기" value={value} min={-1} max={1} step={0.01}
        defaultValue={0} onPreview={setValue} onCommit={onCommit} />;
    }
    render(<Controlled />);
    const slider = screen.getByRole("slider", { name: "눈 크기" });
    fireEvent.change(slider, { target: { value: "0.8" } });
    fireEvent.pointerUp(slider);
    fireEvent.lostPointerCapture(slider);
    fireEvent.blur(slider);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0.8);
  });

  it("restores the pre-drag value on pointer cancellation even after a live prop update", () => {
    const onCommit = vi.fn();
    function Controlled() {
      const [value, setValue] = useState(0.2);
      return <CharacterRangeControl label="눈 크기" value={value} min={-1} max={1} step={0.01}
        defaultValue={0} onPreview={setValue} onCommit={onCommit} />;
    }
    render(<Controlled />);
    const slider = screen.getByRole("slider", { name: "눈 크기" }) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "0.8" } });
    fireEvent.pointerCancel(slider);
    fireEvent.lostPointerCapture(slider);
    fireEvent.blur(slider);
    expect(slider.value).toBe("0.2");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not lose the final change when events are batched", () => {
    const { slider, onCommit } = range();
    act(() => {
      fireEvent.change(slider, { target: { value: "0.5" } });
      fireEvent.change(slider, { target: { value: "0.7" } });
      fireEvent.pointerUp(slider);
      fireEvent.blur(slider);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0.7);
  });

  it("shows fine values and a reset even below half the usual step", () => {
    const { number } = range({ value: 0.001, defaultValue: 0 });
    expect(number.value).toBe("0.001");
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toBe("0.001");
    expect(screen.getByRole("button", { name: /기본값/u })).toBeTruthy();
  });

  it("retains sub-step values in the native slider instead of rounding them away", () => {
    const { slider, onCommit, number } = range({ value: 0 });
    fireEvent.keyDown(slider, { key: "ArrowRight", altKey: true });
    expect((slider as HTMLInputElement).value).toBe("0.001");
    expect(number.value).toBe("0.001");
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0.001);
  });

  it("does not finish an arrow edit on a modifier key-up", () => {
    const { slider, onCommit } = range();
    fireEvent.keyDown(slider, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyUp(slider, { key: "Shift" });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0.3);
  });

  it("provides buttons with fine and coarse modifiers", () => {
    const { onCommit } = range();
    fireEvent.click(screen.getByRole("button", { name: "눈 크기 늘리기" }), { altKey: true });
    expect(onCommit).toHaveBeenCalledWith(0.201);
    fireEvent.click(screen.getByRole("button", { name: "눈 크기 줄이기" }), { shiftKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(0.1);
  });

  it("nudges the typed draft rather than discarding it", () => {
    const { number, onCommit } = range();
    fireEvent.change(number, { target: { value: "0,7" } });
    fireEvent.click(screen.getByRole("button", { name: "눈 크기 늘리기" }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0.71);
  });

  it("preserves an authored off-grid default", () => {
    const { onCommit } = range({ value: 0.2, defaultValue: 0.155 });
    fireEvent.click(screen.getByRole("button", { name: /기본값/u }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0.155);
  });

  it("rejects malformed grouping with an accessible error", () => {
    const { number, onCommit } = range();
    fireEvent.change(number, { target: { value: "1,2,3" } });
    fireEvent.keyDown(number, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(number.value).toBe("0.20");
    expect(number.getAttribute("aria-invalid")).toBe("true");
    const errorId = number.getAttribute("aria-describedby");
    expect(errorId).toBeTruthy();
    expect(document.getElementById(errorId!)?.textContent).toContain("숫자 형식");
  });

  it("does not commit during Korean IME composition", () => {
    const { number, onCommit } = range();
    fireEvent.compositionStart(number);
    fireEvent.change(number, { target: { value: "０．５" } });
    fireEvent.keyDown(number, { key: "Enter", isComposing: true });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(number);
    fireEvent.keyDown(number, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0.5);
  });

  it("rolls back unfinished previews when the control is unmounted", () => {
    const { slider, onPreview, onCommit, unmount } = range();
    fireEvent.change(slider, { target: { value: "0.8" } });
    unmount();
    expect(onPreview).toHaveBeenLastCalledWith(0.2);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("uses the host rollback when supplied", () => {
    const onCancel = vi.fn();
    const { slider, onPreview } = range({ onCancel });
    fireEvent.change(slider, { target: { value: "0.8" } });
    fireEvent.pointerCancel(slider);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it("never previews or commits a disabled range", () => {
    const { slider, onPreview, onCommit } = range({ disabled: true });
    fireEvent.change(slider, { target: { value: "0.8" } });
    fireEvent.pointerUp(slider);
    expect(onPreview).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("character colour transactions", () => {
  function color(overrides: Partial<ComponentProps<typeof CharacterColorControl>> = {}) {
    const onCommit = vi.fn();
    render(<CharacterColorControl label="눈동자" value="#123456" onCommit={onCommit} allowClear {...overrides} />);
    return { onCommit, picker: screen.getByLabelText("눈동자 색 선택"), hex: screen.getByLabelText("눈동자 HEX 값") };
  }

  it("makes continuous picker input one explicit commit", () => {
    const { picker, onCommit } = color();
    for (const value of ["#222222", "#333333", "#444444"]) fireEvent.change(picker, { target: { value } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "눈동자 색 적용" }));
    fireEvent.blur(picker);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("#444444");
  });

  it("cancels without producing a history entry", () => {
    const { picker, onCommit } = color();
    fireEvent.change(picker, { target: { value: "#444444" } });
    fireEvent.click(screen.getByRole("button", { name: "눈동자 색 변경 취소" }));
    fireEvent.blur(picker);
    expect(onCommit).not.toHaveBeenCalled();
    expect((picker as HTMLInputElement).value).toBe("#123456");
  });

  it("does not commit when focus moves from picker to HEX inside the same control", () => {
    const { picker, hex, onCommit } = color();
    fireEvent.change(picker, { target: { value: "#444444" } });
    fireEvent.blur(picker, { relatedTarget: hex });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(hex);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("#444444");
  });

  it("does not create no-op history entries for the selected swatch", () => {
    const { onCommit } = color({ swatches: [{ color: "#123456", label: "현재 색" }] });
    fireEvent.click(screen.getByRole("button", { name: "눈동자 현재 색" }));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("restores a null original colour after live preview cancellation", () => {
    const onCommit = vi.fn();
    function Controlled() {
      const [value, setValue] = useState<string | null>(null);
      return <CharacterColorControl label="눈동자" value={value} onPreview={setValue} onCommit={onCommit} allowClear />;
    }
    render(<Controlled />);
    fireEvent.change(screen.getByLabelText("눈동자 색 선택"), { target: { value: "#444444" } });
    fireEvent.click(screen.getByRole("button", { name: "눈동자 색 변경 취소" }));
    expect(screen.getByText("모델 원본 색")).toBeTruthy();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("rejects invalid colours and blocks disabled edits", () => {
    const { hex, onCommit } = color({ disabled: true });
    fireEvent.change(hex, { target: { value: "abcdef" } });
    fireEvent.keyDown(hex, { key: "Enter" });
    fireEvent.blur(hex);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
