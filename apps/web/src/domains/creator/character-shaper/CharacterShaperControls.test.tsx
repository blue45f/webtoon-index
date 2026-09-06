// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { pushCharacterShaperKeyLayer } from "./character-shaper-ui-model";
import { CharacterChipGroup, CharacterColorControl, CharacterRangeControl } from "./CharacterShaperControls";

afterEach(cleanup);

function renderRange(overrides: Partial<Parameters<typeof CharacterRangeControl>[0]> = {}) {
  const onCommit = vi.fn();
  const onPreview = vi.fn();
  render(
    <CharacterRangeControl
      label="눈 크기"
      value={0}
      min={-1}
      max={1}
      step={0.01}
      defaultValue={0}
      onCommit={onCommit}
      onPreview={onPreview}
      {...overrides}
    />,
  );
  const range = screen.getByRole("slider", { name: "눈 크기" }) as HTMLInputElement;
  const number = screen.getByLabelText("눈 크기 값 입력") as HTMLInputElement;
  return { onCommit, onPreview, range, number };
}

describe("CharacterRangeControl", () => {
  it("previews while dragging and commits only on pointer-up", () => {
    const { onCommit, onPreview, range } = renderRange();

    fireEvent.change(range, { target: { value: "0.4" } });
    fireEvent.change(range, { target: { value: "0.6" } });

    expect(onPreview).toHaveBeenCalledTimes(2);
    expect(onPreview).toHaveBeenLastCalledWith(0.6);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(range);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0.6);
  });

  it("commits on blur and skips a drag that lands back on the current value", () => {
    const { onCommit, range } = renderRange({ value: 0.2 });

    fireEvent.change(range, { target: { value: "0.5" } });
    fireEvent.change(range, { target: { value: "0.2" } });
    fireEvent.blur(range);

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("steps by ×10 with Shift and by ×0.1 with Alt, committing once on key-up", () => {
    const { onCommit, range } = renderRange({ value: 0, step: 0.01 });

    fireEvent.keyDown(range, { key: "ArrowRight", shiftKey: true });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.keyUp(range, { key: "ArrowRight", shiftKey: true });
    expect(onCommit).toHaveBeenCalledWith(0.1);

    onCommit.mockClear();
    fireEvent.keyDown(range, { key: "ArrowRight", altKey: true });
    fireEvent.keyUp(range, { key: "ArrowRight", altKey: true });
    expect(onCommit).toHaveBeenCalledWith(0.001);
  });

  it("clamps to the range bounds", () => {
    const { onCommit, range } = renderRange({ value: 0.99, step: 0.01 });

    fireEvent.keyDown(range, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyUp(range, { key: "ArrowRight" });

    expect(onCommit).toHaveBeenCalledWith(1);
  });

  it("accepts a comma decimal and a dot decimal from the number input on Enter", () => {
    const { onCommit, number } = renderRange({ value: 1, min: 0.5, max: 1.7, step: 0.01, defaultValue: 1 });

    fireEvent.change(number, { target: { value: "1,05" } });
    fireEvent.keyDown(number, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(1.05);

    onCommit.mockClear();
    fireEvent.change(number, { target: { value: "1.25" } });
    fireEvent.blur(number);
    expect(onCommit).toHaveBeenCalledWith(1.25);
  });

  it("ignores unparseable text and restores the live value", () => {
    const { onCommit, number } = renderRange({ value: 0.3, step: 0.01 });

    fireEvent.change(number, { target: { value: "여덟" } });
    fireEvent.blur(number);

    expect(onCommit).not.toHaveBeenCalled();
    expect(number.value).toBe("0.30");
  });

  it("shows the reset control only when the value differs from the default", () => {
    const { rerender } = render(
      <CharacterRangeControl label="턱 길이" value={1} min={0.8} max={1.2} step={0.01} defaultValue={1} onCommit={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /기본값/u })).toBeNull();

    const onCommit = vi.fn();
    rerender(
      <CharacterRangeControl label="턱 길이" value={1.1} min={0.8} max={1.2} step={0.01} defaultValue={1} onCommit={onCommit} />,
    );
    const reset = screen.getByRole("button", { name: /기본값/u });
    fireEvent.click(reset);
    expect(onCommit).toHaveBeenCalledWith(1);
  });

  it("keeps Escape for the unfinished edit instead of letting the shell close the dialog", () => {
    const shellLayer = vi.fn(() => true);
    const release = pushCharacterShaperKeyLayer(shellLayer, window);
    try {
      const { onCommit, onPreview, range } = renderRange({ value: 0.2 });

      fireEvent.change(range, { target: { value: "0.9" } });
      fireEvent.keyDown(window, { key: "Escape" });

      expect(shellLayer).not.toHaveBeenCalled();
      expect(onCommit).not.toHaveBeenCalled();
      expect(onPreview).toHaveBeenLastCalledWith(0.2);
      expect(range.value).toBe("0.2");

      fireEvent.keyDown(window, { key: "Escape" });
      expect(shellLayer).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
  });

  it("never commits while disabled", () => {
    const { onCommit, range } = renderRange({ disabled: true });
    fireEvent.change(range, { target: { value: "0.5" } });
    fireEvent.pointerUp(range);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("CharacterColorControl", () => {
  it("commits a hex typed with or without the hash", () => {
    const onCommit = vi.fn();
    render(<CharacterColorControl label="헤어 기본색" value="#1f1a1c" onCommit={onCommit} allowClear />);

    const hex = screen.getByLabelText("헤어 기본색 HEX 값");
    fireEvent.change(hex, { target: { value: "a16207" } });
    fireEvent.keyDown(hex, { key: "Enter" });

    expect(onCommit).toHaveBeenCalledWith("#a16207");
  });

  it("ignores an invalid hex and clears back to the model color", () => {
    const onCommit = vi.fn();
    render(<CharacterColorControl label="눈동자 색" value="#4a3328" onCommit={onCommit} allowClear />);

    const hex = screen.getByLabelText("눈동자 색 HEX 값");
    fireEvent.change(hex, { target: { value: "zzz" } });
    fireEvent.blur(hex);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "눈동자 색 모델 원본 색으로 되돌리기" }));
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("marks the active swatch with aria-pressed", () => {
    const onCommit = vi.fn();
    render(
      <CharacterColorControl
        label="헤어 기본색"
        value="#1f1a1c"
        onCommit={onCommit}
        swatches={[
          { color: "#1f1a1c", label: "잉크 블랙" },
          { color: "#a16207", label: "허니 블론드" },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "헤어 기본색 잉크 블랙" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "헤어 기본색 허니 블론드" }));
    expect(onCommit).toHaveBeenCalledWith("#a16207");
  });
});

describe("CharacterChipGroup", () => {
  it("marks a single selection with aria-pressed and reports the picked id", () => {
    const onSelect = vi.fn();
    render(
      <CharacterChipGroup
        label="앞머리"
        value="full"
        onSelect={onSelect}
        options={[
          { id: "full", label: "풀뱅" },
          { id: "split", label: "가르마" },
          { id: "none", label: "앞머리 없음", disabled: true },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "풀뱅" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "가르마" }).getAttribute("aria-pressed")).toBe("false");
    expect((screen.getByRole("button", { name: "앞머리 없음" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "가르마" }));
    expect(onSelect).toHaveBeenCalledWith("split");
  });
});
