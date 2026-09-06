// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioPerspectivePanel, type StudioPerspectivePanelProps } from "./StudioPerspectivePanel";

function baseProps(
  overrides: Partial<StudioPerspectivePanelProps> = {}
): StudioPerspectivePanelProps {
  return {
    active: true,
    points: [{ id: "vp-1", x: 100, y: 200 }],
    onToggleActive: vi.fn(),
    onAddPoint: vi.fn(),
    onRemovePoint: vi.fn(),
    onMovePoint: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("StudioPerspectivePanel", () => {
  it("toggles horizon lock and commits eye-level Y", () => {
    const onToggleLockHorizon = vi.fn();
    const onCommitEyeLevelY = vi.fn();
    const onAlignToEyeLevel = vi.fn();
    render(
      <StudioPerspectivePanel
        {...baseProps({
          eyeLevelY: 240,
          lockHorizon: false,
          onToggleLockHorizon,
          onCommitEyeLevelY,
          onAlignToEyeLevel,
        })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "눈높이 잠금 켜기" }));
    expect(onToggleLockHorizon).toHaveBeenCalledWith(true);
    const eyeInput = screen.getByRole("textbox", { name: "눈높이 Y" });
    fireEvent.focus(eyeInput);
    fireEvent.change(eyeInput, { target: { value: "300" } });
    fireEvent.keyDown(eyeInput, { key: "Enter" });
    expect(onCommitEyeLevelY).toHaveBeenCalledWith(300);
    fireEvent.click(screen.getByRole("button", { name: "맞추기" }));
    expect(onAlignToEyeLevel).toHaveBeenCalledOnce();
  });

  it("previews valid coordinate text but commits it only once on Enter", () => {
    const onPreviewPoint = vi.fn();
    const onCommitPoint = vi.fn();
    render(
      <StudioPerspectivePanel
        {...baseProps({ onPreviewPoint, onCommitPoint, onMovePoint: undefined })}
      />
    );
    const input = screen.getByRole("textbox", { name: "소실점 1 X" });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "125" } });

    expect(onPreviewPoint).toHaveBeenLastCalledWith("vp-1", 125, 200);
    expect(onCommitPoint).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommitPoint).toHaveBeenCalledOnce();
    expect(onCommitPoint).toHaveBeenLastCalledWith("vp-1", 125, 200);

    fireEvent.blur(input);
    expect(onCommitPoint).toHaveBeenCalledOnce();
  });

  it("preserves a fractional document coordinate through a focus/blur no-op", () => {
    const onPreviewPoint = vi.fn();
    const onCommitPoint = vi.fn();
    render(
      <StudioPerspectivePanel
        {...baseProps({
          points: [{ id: "vp-1", x: 12.6, y: -4.25 }],
          onPreviewPoint,
          onCommitPoint,
          onMovePoint: undefined,
        })}
      />
    );
    const input = screen.getByRole("textbox", { name: "소실점 1 X" }) as HTMLInputElement;

    expect(input.value).toBe("12.6");
    expect(input.inputMode).toBe("decimal");
    fireEvent.focus(input);
    fireEvent.blur(input);

    expect(input.value).toBe("12.6");
    expect(onPreviewPoint).not.toHaveBeenCalled();
    expect(onCommitPoint).not.toHaveBeenCalled();
  });

  it("commits fractional text once on Enter and does not round or recommit it on blur", () => {
    const onPreviewPoint = vi.fn();
    const onCommitPoint = vi.fn();
    render(
      <StudioPerspectivePanel
        {...baseProps({ onPreviewPoint, onCommitPoint, onMovePoint: undefined })}
      />
    );
    const input = screen.getByRole("textbox", { name: "소실점 1 X" }) as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "125.75" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);

    expect(input.value).toBe("125.75");
    expect(onPreviewPoint).toHaveBeenLastCalledWith("vp-1", 125.75, 200);
    expect(onCommitPoint).toHaveBeenCalledOnce();
    expect(onCommitPoint).toHaveBeenLastCalledWith("vp-1", 125.75, 200);
  });

  it("commits a changed coordinate once on blur and keeps legacy callback compatibility", () => {
    const onMovePoint = vi.fn();
    render(<StudioPerspectivePanel {...baseProps({ onMovePoint })} />);
    const input = screen.getByRole("textbox", { name: "소실점 1 Y" });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "240" } });
    expect(onMovePoint).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(onMovePoint).toHaveBeenCalledOnce();
    expect(onMovePoint).toHaveBeenLastCalledWith("vp-1", 100, 240);
  });

  it("Escape restores the edit-start coordinate and its preview without committing", () => {
    const onPreviewPoint = vi.fn();
    const onCommitPoint = vi.fn();
    render(
      <StudioPerspectivePanel
        {...baseProps({ onPreviewPoint, onCommitPoint, onMovePoint: undefined })}
      />
    );
    const input = screen.getByRole("textbox", { name: "소실점 1 X" }) as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "220" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(input.value).toBe("100");
    expect(onPreviewPoint).toHaveBeenNthCalledWith(1, "vp-1", 220, 200);
    expect(onPreviewPoint).toHaveBeenNthCalledWith(2, "vp-1", 100, 200);
    expect(onCommitPoint).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(onCommitPoint).not.toHaveBeenCalled();
  });

  it("reverts an unfinished numeric token on blur without creating history", () => {
    const onPreviewPoint = vi.fn();
    const onCommitPoint = vi.fn();
    render(
      <StudioPerspectivePanel
        {...baseProps({ onPreviewPoint, onCommitPoint, onMovePoint: undefined })}
      />
    );
    const input = screen.getByRole("textbox", { name: "소실점 1 X" }) as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "-" } });
    fireEvent.blur(input);

    expect(input.value).toBe("100");
    expect(onPreviewPoint).toHaveBeenLastCalledWith("vp-1", 100, 200);
    expect(onCommitPoint).not.toHaveBeenCalled();
  });

  it("names its toggle unambiguously and disables every mutation control", () => {
    const onToggleActive = vi.fn();
    const onAddPoint = vi.fn();
    const onRemovePoint = vi.fn();
    const onMovePoint = vi.fn();
    render(
      <StudioPerspectivePanel
        {...baseProps({
          disabled: true,
          disabledReason: "검토 잠금",
          onToggleActive,
          onAddPoint,
          onRemovePoint,
          onMovePoint,
        })}
      />
    );

    const toggle = screen.getByRole("button", { name: "원근자 끄기" }) as HTMLButtonElement;
    const coordinate = screen.getByRole("textbox", { name: "소실점 1 X" }) as HTMLInputElement;
    const remove = screen.getByRole("button", { name: "소실점 1 삭제" }) as HTMLButtonElement;
    const add = screen.getByRole("button", { name: "소실점 추가" }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(coordinate.disabled).toBe(true);
    expect(remove.disabled).toBe(true);
    expect(add.disabled).toBe(true);
    expect(coordinate.className).toContain("pointer-coarse:min-h-11");
    expect(remove.className).toContain("pointer-coarse:size-11");
    expect(add.className).toContain("pointer-coarse:min-h-11");

    fireEvent.click(toggle);
    fireEvent.click(remove);
    fireEvent.click(add);
    fireEvent.change(coordinate, { target: { value: "150" } });
    expect(onToggleActive).not.toHaveBeenCalled();
    expect(onRemovePoint).not.toHaveBeenCalled();
    expect(onAddPoint).not.toHaveBeenCalled();
    expect(onMovePoint).not.toHaveBeenCalled();
  });
});
