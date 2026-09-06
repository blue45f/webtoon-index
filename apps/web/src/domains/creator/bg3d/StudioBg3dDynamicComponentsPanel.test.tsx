// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";

import { StudioBg3dDynamicComponentsPanel } from "./StudioBg3dDynamicComponentsPanel";

describe("StudioBg3dDynamicComponentsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders with default door component and toggles open/close", () => {
    const handleApply = vi.fn();
    render(<StudioBg3dDynamicComponentsPanel onApplyComponentTransform={handleApply} />);

    expect(screen.getByText("다이나믹 인터랙션 컴포넌트")).toBeDefined();
    expect(screen.getByText("단일 여닫이문 (Door Swing)")).toBeDefined();

    // The button's only text IS the label, so `getByText` matched the <button> and its <span>
    // both. Query the control by role instead — that is also the thing the user actually clicks.
    const toggleBtn = screen.getByRole("button", { name: /닫힘 \(Closed\)/ });
    fireEvent.click(toggleBtn);

    expect(handleApply).toHaveBeenCalledTimes(1);
    expect(handleApply.mock.calls[0][0].isOpen).toBe(true);
  });
});
