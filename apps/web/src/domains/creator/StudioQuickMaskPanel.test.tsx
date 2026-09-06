// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  QUICK_MASK_BRUSH_HARDNESS_DEFAULT,
  QUICK_MASK_BRUSH_OPACITY_DEFAULT,
  QUICK_MASK_BRUSH_RADIUS_DEFAULT,
  QUICK_MASK_TINT_COLOR_DEFAULT,
  QUICK_MASK_TINT_OPACITY_DEFAULT,
} from "./studio-quick-mask";
import { StudioQuickMaskPanel, type StudioQuickMaskPanelProps } from "./StudioQuickMaskPanel";

afterEach(cleanup);

function props(overrides: Partial<StudioQuickMaskPanelProps> = {}): StudioQuickMaskPanelProps {
  return {
    active: true,
    brushMode: "paint",
    radiusPx: QUICK_MASK_BRUSH_RADIUS_DEFAULT,
    hardness: QUICK_MASK_BRUSH_HARDNESS_DEFAULT,
    opacity: QUICK_MASK_BRUSH_OPACITY_DEFAULT,
    tintColor: QUICK_MASK_TINT_COLOR_DEFAULT,
    tintOpacity: QUICK_MASK_TINT_OPACITY_DEFAULT,
    onEnter: vi.fn(),
    onCommit: vi.fn(),
    onCancel: vi.fn(),
    onBrushModeChange: vi.fn(),
    onRadiusChange: vi.fn(),
    onHardnessChange: vi.fn(),
    onOpacityChange: vi.fn(),
    onInvert: vi.fn(),
    onTintColorChange: vi.fn(),
    onTintOpacityChange: vi.fn(),
    ...overrides,
  };
}

describe("StudioQuickMaskPanel", () => {
  it("shows only the enter action while inactive and calls onEnter", () => {
    const onEnter = vi.fn();
    render(<StudioQuickMaskPanel {...props({ active: false, onEnter })} />);
    fireEvent.click(screen.getByRole("button", { name: /퀵 마스크 시작/ }));
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /선택 영역으로 완료/ })).toBeNull();
    expect(screen.queryByLabelText(/브러시 크기/)).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("단축키 Q");
  });

  it("toggles brush mode chips with aria-pressed state", () => {
    const onBrushModeChange = vi.fn();
    render(<StudioQuickMaskPanel {...props({ onBrushModeChange })} />);
    const paint = screen.getByRole("button", { name: /칠하기/ });
    const erase = screen.getByRole("button", { name: /지우기/ });
    expect(paint).toHaveProperty("ariaPressed", "true");
    expect(erase).toHaveProperty("ariaPressed", "false");
    fireEvent.click(erase);
    expect(onBrushModeChange).toHaveBeenCalledWith("erase");
  });

  it("forwards slider changes for radius, hardness, opacity and tint opacity", () => {
    const onRadiusChange = vi.fn();
    const onHardnessChange = vi.fn();
    const onOpacityChange = vi.fn();
    const onTintOpacityChange = vi.fn();
    render(
      <StudioQuickMaskPanel
        {...props({ onRadiusChange, onHardnessChange, onOpacityChange, onTintOpacityChange })}
      />
    );
    fireEvent.change(screen.getByLabelText(/브러시 크기/), { target: { value: "72" } });
    fireEvent.change(screen.getByLabelText(/^경도/), { target: { value: "0.4" } });
    fireEvent.change(screen.getByLabelText(/^불투명도/), { target: { value: "0.6" } });
    fireEvent.change(screen.getByLabelText(/표시 불투명도/), { target: { value: "0.35" } });
    expect(onRadiusChange).toHaveBeenCalledWith(72);
    expect(onHardnessChange).toHaveBeenCalledWith(0.4);
    expect(onOpacityChange).toHaveBeenCalledWith(0.6);
    expect(onTintOpacityChange).toHaveBeenCalledWith(0.35);
  });

  it("invokes invert and tint color preset callbacks", () => {
    const onInvert = vi.fn();
    const onTintColorChange = vi.fn();
    render(<StudioQuickMaskPanel {...props({ onInvert, onTintColorChange })} />);
    fireEvent.click(screen.getByRole("button", { name: /반전/ }));
    fireEvent.click(screen.getByRole("button", { name: /초록/ }));
    expect(onInvert).toHaveBeenCalledTimes(1);
    expect(onTintColorChange).toHaveBeenCalledWith("#22c55e");
  });

  it("commits and cancels the session from the footer actions", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<StudioQuickMaskPanel {...props({ onCommit, onCancel })} />);
    fireEvent.click(screen.getByRole("button", { name: /선택 영역으로 완료/ }));
    fireEvent.click(screen.getByRole("button", { name: /취소/ }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("surfaces mode-specific and busy status copy", () => {
    const { rerender } = render(<StudioQuickMaskPanel {...props({ brushMode: "erase" })} />);
    expect(screen.getByRole("status").textContent).toContain("선택 영역에서 빠집니다");
    rerender(<StudioQuickMaskPanel {...props({ busy: true })} />);
    expect(screen.getByRole("status").textContent).toContain("변환하는 중");
  });
});
