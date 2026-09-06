// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioCircularTextPanel } from "./StudioCircularTextPanel";

describe("StudioCircularTextPanel", () => {
  afterEach(() => {
    cleanup();
  });

  const defaultOptions = {
    centerX: 100,
    centerY: 100,
    radius: 80,
    startAngleDeg: -90,
    direction: "clockwise" as const,
    orientation: "outward" as const,
  };

  it("renders with header and toggle", () => {
    render(
      <StudioCircularTextPanel
        text="콰아아아"
        enabled={false}
        options={defaultOptions}
        onToggleEnabled={vi.fn()}
        onOptionsChange={vi.fn()}
      />,
    );

    expect(screen.getByText("원형 텍스트 (Circular Text)")).toBeDefined();
    expect(screen.getByText("원형 배치 Off")).toBeDefined();
  });

  it("calls onToggleEnabled when toggle clicked", () => {
    const onToggleEnabled = vi.fn();
    render(
      <StudioCircularTextPanel
        text="콰아아아"
        enabled={false}
        options={defaultOptions}
        onToggleEnabled={onToggleEnabled}
        onOptionsChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("원형 배치 Off"));
    expect(onToggleEnabled).toHaveBeenCalledWith(true);
  });

  it("renders SVG glyphs and controls when enabled", () => {
    const onOptionsChange = vi.fn();
    render(
      <StudioCircularTextPanel
        text="우르릉"
        enabled={true}
        options={defaultOptions}
        onToggleEnabled={vi.fn()}
        onOptionsChange={onOptionsChange}
      />,
    );

    expect(screen.getByText("원형 배치 On")).toBeDefined();
    expect(screen.getByText("원형 반경 (Radius)")).toBeDefined();

    // Change direction to counter-clockwise
    fireEvent.click(screen.getByText("반시계방향"));
    expect(onOptionsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: "counter-clockwise",
      }),
    );
  });
});
