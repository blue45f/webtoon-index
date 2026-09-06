// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioLineWidthAdjustmentPanel } from "./StudioLineWidthAdjustmentPanel";

describe("StudioLineWidthAdjustmentPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders with header, CSP badge, and action tabs", () => {
    render(<StudioLineWidthAdjustmentPanel onApply={vi.fn()} />);

    expect(screen.getByText("선폭 수정 (Line Width)")).toBeDefined();
    expect(screen.getByText("CSP")).toBeDefined();
    expect(screen.getByText("굵게 (+)")).toBeDefined();
    expect(screen.getByText("가늘게 (-)")).toBeDefined();
    expect(screen.getByText("배율 (×)")).toBeDefined();
  });

  it("changes preset when clicking a chip", () => {
    render(<StudioLineWidthAdjustmentPanel currentWidth={5} onApply={vi.fn()} />);

    const chip5px = screen.getByRole("button", { name: "+5px" });
    fireEvent.click(chip5px);

    expect(screen.getByText("5px → 10px")).toBeDefined();
  });

  it("calls onApply with calculated options when apply button is clicked", () => {
    const onApply = vi.fn();
    render(<StudioLineWidthAdjustmentPanel currentWidth={4} onApply={onApply} />);

    const applyBtn = screen.getByRole("button", { name: "선택한 선에 선폭 적용" });
    fireEvent.click(applyBtn);

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "thicken",
        value: 2,
        scalePressures: true,
      }),
    );
  });
});
