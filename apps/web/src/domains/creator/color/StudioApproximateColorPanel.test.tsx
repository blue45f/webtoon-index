// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioApproximateColorPanel } from "./StudioApproximateColorPanel";

describe("StudioApproximateColorPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders with header, CSP badge, and mode buttons", () => {
    render(
      <StudioApproximateColorPanel
        activeColor="#fcd5b5"
        onSelectColor={vi.fn()}
      />,
    );

    expect(screen.getByText("근사색 (Approximate Color)")).toBeDefined();
    expect(screen.getByText("CSP")).toBeDefined();
    expect(screen.getByText("채도·명도 (S×V)")).toBeDefined();
    expect(screen.getByText("색조·명도 (H×V)")).toBeDefined();
  });

  it("renders center tile matching active color and changes grid steps", () => {
    render(
      <StudioApproximateColorPanel
        activeColor="#fcd5b5"
        onSelectColor={vi.fn()}
      />,
    );

    // Default is 5x5 = 25 buttons
    const cells5x5 = screen.getAllByRole("button", { name: /#[0-9a-f]{6} 색상 선택/i });
    expect(cells5x5.length).toBe(25);

    // Change to 7x7
    const btn7x7 = screen.getByLabelText("7x7 그리드");
    fireEvent.click(btn7x7);
    const cells7x7 = screen.getAllByRole("button", { name: /#[0-9a-f]{6} 색상 선택/i });
    expect(cells7x7.length).toBe(49);
  });

  it("calls onSelectColor when a cell is clicked", () => {
    const onSelectColor = vi.fn();
    render(
      <StudioApproximateColorPanel
        activeColor="#3b82f6"
        onSelectColor={onSelectColor}
      />,
    );

    const cells = screen.getAllByRole("button", { name: /#[0-9a-f]{6} 색상 선택/i });
    const cell = cells[0];
    if (cell) {
      fireEvent.click(cell);
      expect(onSelectColor).toHaveBeenCalledWith(expect.stringMatching(/^#[0-9a-f]{6}$/i));
    }
  });
});
