// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CharacterColorControl, CharacterRangeControl } from "./CharacterShaperControls";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("precision edits interrupted by host lifecycle", () => {
  it("cancels a live range preview when disabled and cannot commit it after re-enable", () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const props = { label: "눈 크기", min: -1, max: 1, step: 0.01, defaultValue: 0, onPreview, onCommit };
    const view = render(<CharacterRangeControl {...props} value={0.2} />);
    const slider = screen.getByRole("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "0.8" } });
    view.rerender(<CharacterRangeControl {...props} value={0.8} disabled />);
    expect(onPreview).toHaveBeenLastCalledWith(0.2);
    view.rerender(<CharacterRangeControl {...props} value={0.2} />);
    fireEvent.pointerUp(slider);
    fireEvent.blur(slider);
    expect(slider.value).toBe("0.2");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("rolls back the host transaction only once when disabling is followed by unmount", () => {
    const onPreview = vi.fn();
    const onCancel = vi.fn();
    const onCommit = vi.fn();
    const props = { label: "눈 크기", value: 0.2, min: -1, max: 1, step: 0.01, defaultValue: 0, onPreview, onCancel, onCommit };
    const view = render(<CharacterRangeControl {...props} />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0.8" } });
    view.rerender(<CharacterRangeControl {...props} disabled />);
    view.unmount();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("cancels an unfinished range when the window loses focus", () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    render(<CharacterRangeControl label="눈 크기" value={0.2} min={-1} max={1} step={0.01} defaultValue={0} onPreview={onPreview} onCommit={onCommit} />);
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "0.8" } });
    act(() => { window.dispatchEvent(new Event("blur")); });
    fireEvent.pointerUp(slider);
    expect(onPreview).toHaveBeenLastCalledWith(0.2);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("cancels an unfinished range when the document becomes hidden", () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    render(<CharacterRangeControl label="눈 크기" value={0.2} min={-1} max={1} step={0.01} defaultValue={0} onPreview={onPreview} onCommit={onCommit} />);
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "0.8" } });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    fireEvent.pointerUp(slider);
    expect(onPreview).toHaveBeenLastCalledWith(0.2);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("restores the model's null colour when a colour preview becomes disabled", () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const props = { label: "눈동자", onPreview, onCommit, allowClear: true };
    const view = render(<CharacterColorControl {...props} value={null} />);
    const picker = screen.getByLabelText("눈동자 색 선택");
    fireEvent.change(picker, { target: { value: "#abcdef" } });
    view.rerender(<CharacterColorControl {...props} value="#abcdef" disabled />);
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole("button", { name: "눈동자 색 적용" })).toBeNull();
    view.rerender(<CharacterColorControl {...props} value={null} />);
    fireEvent.blur(picker);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText("모델 원본 색")).toBeTruthy();
  });

  it("does not commit a HEX draft on the composition-confirming Enter key", () => {
    const onCommit = vi.fn();
    render(<CharacterColorControl label="눈동자" value="#123456" onCommit={onCommit} />);
    const hex = screen.getByLabelText("눈동자 HEX 값");
    fireEvent.compositionStart(hex);
    fireEvent.change(hex, { target: { value: "ＡＢＣ" } });
    fireEvent.keyDown(hex, { key: "Enter", isComposing: true });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(hex);
    fireEvent.keyDown(hex, { key: "Enter" });
    fireEvent.blur(hex);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("#aabbcc");
  });

  it("does not cancel a range for a descendant's bubbling synthetic blur", () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    render(<>
      <CharacterRangeControl label="눈 크기" value={0.2} min={-1} max={1} step={0.01} defaultValue={0} onPreview={onPreview} onCommit={onCommit} />
      <button type="button">다른 컨트롤</button>
    </>);
    const slider = screen.getByRole("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "0.8" } });
    act(() => { screen.getByRole("button", { name: "다른 컨트롤" }).dispatchEvent(new Event("blur", { bubbles: true })); });
    expect(slider.value).toBe("0.8");
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0.8);
  });

  it("discards a numeric text draft when the window blurs without creating a commit", () => {
    const onCommit = vi.fn();
    render(<CharacterRangeControl label="눈 크기" value={0.2} min={-1} max={1} step={0.01} defaultValue={0} onCommit={onCommit} />);
    const input = screen.getByLabelText("눈 크기 값 입력") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0.95" } });
    act(() => { window.dispatchEvent(new Event("blur")); });
    fireEvent.blur(input);
    expect(input.value).toBe("0.20");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("rolls back once when window blur is followed by visibility loss and unmount", () => {
    const onPreview = vi.fn();
    const onCancel = vi.fn();
    const onCommit = vi.fn();
    const view = render(<CharacterRangeControl label="눈 크기" value={0.2} min={-1} max={1} step={0.01} defaultValue={0} onPreview={onPreview} onCancel={onCancel} onCommit={onCommit} />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0.8" } });
    act(() => { window.dispatchEvent(new Event("blur")); });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    view.unmount();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
