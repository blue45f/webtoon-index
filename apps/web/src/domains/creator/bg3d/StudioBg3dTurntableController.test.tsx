// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";

import { StudioBg3dTurntableController } from "./StudioBg3dTurntableController";

describe("StudioBg3dTurntableController", () => {
  afterEach(() => {
    cleanup();
  });

  it("toggles rotation state on button click", () => {
    const handleToggle = vi.fn();
    render(<StudioBg3dTurntableController onToggleRotation={handleToggle} />);

    const btn = screen.getByText("턴테이블 회전");
    fireEvent.click(btn);

    expect(handleToggle).toHaveBeenCalledWith(true);
    expect(screen.getByText("턴테이블 정지")).toBeDefined();
  });

  it("handles direction toggle", () => {
    const handleSpeed = vi.fn();
    render(<StudioBg3dTurntableController onSpeedChange={handleSpeed} />);

    const dirBtn = screen.getByTitle("회전 방향 전환");
    fireEvent.click(dirBtn);

    expect(handleSpeed).toHaveBeenCalledWith(-2.0);
  });
});
