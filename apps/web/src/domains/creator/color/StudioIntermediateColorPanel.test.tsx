// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioIntermediateColorPanel } from "./StudioIntermediateColorPanel";

describe("StudioIntermediateColorPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders with header, CSP badge, and preset buttons", () => {
    render(<StudioIntermediateColorPanel onSelectColor={vi.fn()} />);

    expect(screen.getByText("중간색 (Intermediate Color)")).toBeDefined();
    expect(screen.getByText("CSP")).toBeDefined();
    expect(screen.getByText("웹툰 피부톤")).toBeDefined();
    expect(screen.getByText("골든 헤어")).toBeDefined();
  });

  it("changes grid density with 4x4, 6x6, and 8x8 buttons", () => {
    render(<StudioIntermediateColorPanel onSelectColor={vi.fn()} />);

    const grid4x4Btn = screen.getByLabelText("4x4 그리드");
    fireEvent.click(grid4x4Btn);

    // In 4x4, there should be 16 cell buttons
    const cells4x4 = screen.getAllByRole("button", { name: /#[0-9a-f]{6} 색상 선택/i });
    expect(cells4x4.length).toBe(16);

    const grid8x8Btn = screen.getByLabelText("8x8 그리드");
    fireEvent.click(grid8x8Btn);
    const cells8x8 = screen.getAllByRole("button", { name: /#[0-9a-f]{6} 색상 선택/i });
    expect(cells8x8.length).toBe(64);
  });

  it("calls onSelectColor when a cell is clicked", () => {
    const onSelectColor = vi.fn();
    render(<StudioIntermediateColorPanel onSelectColor={onSelectColor} />);

    const cells = screen.getAllByRole("button", { name: /#[0-9a-f]{6} 색상 선택/i });
    expect(cells.length).toBeGreaterThan(0);

    const firstCell = cells[0];
    if (firstCell) {
      fireEvent.click(firstCell);
      expect(onSelectColor).toHaveBeenCalledWith(expect.stringMatching(/^#[0-9a-f]{6}$/i));
    }
  });

  it("updates corner to active color when '현재색' is clicked", () => {
    render(
      <StudioIntermediateColorPanel
        activeColor="#123456"
        onSelectColor={vi.fn()}
      />,
    );

    const setCornerBtns = screen.getAllByTitle("현재 선택된 색으로 좌상단 코너 설정");
    const topBtn = setCornerBtns[0];
    if (topBtn) {
      fireEvent.click(topBtn);
      const cells = screen.getAllByRole("button", { name: /#123456 색상 선택/i });
      expect(cells.length).toBeGreaterThan(0);
    }
  });
});
