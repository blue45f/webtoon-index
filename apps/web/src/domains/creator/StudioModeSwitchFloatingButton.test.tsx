// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioModeSwitchFloatingButton } from "./StudioModeSwitchFloatingButton";

afterEach(() => {
  cleanup();
});

describe("StudioModeSwitchFloatingButton", () => {
  it("renders Simple Mode button when currently in studio mode", () => {
    const onToggle = vi.fn();
    render(<StudioModeSwitchFloatingButton currentMode="studio" onToggleMode={onToggle} />);

    const btn = screen.getByRole("button", { name: "심플 모드로 전환" });
    expect(btn).not.toBeNull();
    expect(screen.getByText("심플 모드")).not.toBeNull();

    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders Studio Mode button when currently in simple mode", () => {
    const onToggle = vi.fn();
    render(<StudioModeSwitchFloatingButton currentMode="simple" onToggleMode={onToggle} />);

    const btn = screen.getByRole("button", { name: "스튜디오 모드로 전환" });
    expect(btn).not.toBeNull();
    expect(screen.getByText("스튜디오 모드")).not.toBeNull();

    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
