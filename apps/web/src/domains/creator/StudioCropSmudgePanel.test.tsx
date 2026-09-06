// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StudioCropPanel } from "./StudioCropPanel";
import { StudioSmudgePanel } from "./StudioSmudgePanel";

describe("StudioCropPanel busy contract", () => {
  it("makes every crop mutation control honestly unavailable while applying", () => {
    const onToggle = vi.fn();
    const onAspectChange = vi.fn();
    const onReset = vi.fn();
    const onApply = vi.fn();
    const onCancel = vi.fn();

    render(
      <StudioCropPanel
        active
        aspect="free"
        busy
        canApply
        onToggle={onToggle}
        onAspectChange={onAspectChange}
        onReset={onReset}
        onApply={onApply}
        onCancel={onCancel}
      />
    );

    const controls = [
      screen.getByRole("button", { name: "크롭 중" }),
      screen.getByRole("button", { name: "자유" }),
      screen.getByRole("button", { name: "적용 중..." }),
      screen.getByRole("button", { name: "초기화" }),
      screen.getByRole("button", { name: "취소" }),
    ];
    for (const control of controls) {
      expect(control.hasAttribute("disabled")).toBe(true);
      fireEvent.click(control);
    }

    expect(onToggle).not.toHaveBeenCalled();
    expect(onAspectChange).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("StudioSmudgePanel busy contract", () => {
  it("matches the page mutation guard while a stroke is being committed", () => {
    const onToggleActive = vi.fn();
    const onRadiusChange = vi.fn();
    const onStrengthChange = vi.fn();

    render(
      <StudioSmudgePanel
        active
        radius={24}
        strength={50}
        busy
        onToggleActive={onToggleActive}
        onRadiusChange={onRadiusChange}
        onStrengthChange={onStrengthChange}
      />
    );

    expect(
      screen.getByRole("button", { name: "색 밀어 섞기 끄기" }).hasAttribute("disabled")
    ).toBe(true);
    for (const slider of screen.getAllByRole("slider")) {
      expect(slider.hasAttribute("disabled")).toBe(true);
      fireEvent.change(slider, { target: { value: "40" } });
    }
    fireEvent.click(screen.getByRole("button", { name: "색 밀어 섞기 끄기" }));

    expect(onToggleActive).not.toHaveBeenCalled();
    expect(onRadiusChange).not.toHaveBeenCalled();
    expect(onStrengthChange).not.toHaveBeenCalled();
  });
});
