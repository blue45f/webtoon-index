// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioInspectorDrawModeControls } from "./StudioInspectorDrawModeControls";

afterEach(cleanup);

describe("StudioInspectorDrawModeControls", () => {
  it("explains the fixed pixel contract without showing it for ordinary pen mode", () => {
    const props = {
      onDrawModeChange: vi.fn(),
      onDrawShapeChange: vi.fn(),
      onStrokeWidthChange: vi.fn(),
      onSymmetryChange: vi.fn(),
    };
    const { rerender } = render(
      <StudioInspectorDrawModeControls drawMode="pen" {...props} />
    );
    // Active draw tool → stable inspector context surface (CSP property dock).
    expect(screen.getByTestId("studio-inspector-context-drawing")).toBeTruthy();
    expect(screen.getByTestId("studio-inspector-draw-mode")).toBeTruthy();
    expect(screen.getByText("그리기 도구 설정")).toBeTruthy();
    expect(screen.getByRole("button", { name: "펜" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("region", { name: "픽셀 펜 특성" })).toBeNull();

    rerender(<StudioInspectorDrawModeControls drawMode="pixel" {...props} />);
    const pixelContract = screen.getByRole("region", { name: "픽셀 펜 특성" });
    expect(pixelContract.textContent).toContain("1 PX");
    expect(pixelContract.textContent).toContain("HARD");
    expect(pixelContract.textContent).toContain("RAW");
    expect(
      screen.getByRole("button", { name: "픽셀 펜" }).getAttribute("aria-pressed")
    ).toBe("true");
    expect(screen.getByTestId("studio-inspector-context-drawing")).toBeTruthy();
  });

  it("normalizes fixed pixel settings and initializes shape mode", () => {
    const onDrawModeChange = vi.fn();
    const onDrawShapeChange = vi.fn();
    const onStrokeWidthChange = vi.fn();
    const onSymmetryChange = vi.fn();
    render(
      <StudioInspectorDrawModeControls
        drawMode="pen"
        onDrawModeChange={onDrawModeChange}
        onDrawShapeChange={onDrawShapeChange}
        onStrokeWidthChange={onStrokeWidthChange}
        onSymmetryChange={onSymmetryChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "픽셀 펜" }));
    expect(onDrawModeChange).toHaveBeenLastCalledWith("pixel");
    expect(onStrokeWidthChange).toHaveBeenCalledWith(1);
    expect(onSymmetryChange).toHaveBeenCalledWith("none");

    fireEvent.click(screen.getByRole("button", { name: "도형" }));
    expect(onDrawModeChange).toHaveBeenLastCalledWith("shape");
    expect(onDrawShapeChange).toHaveBeenCalledWith("line");
  });

  it("does not reset tool settings when the selected mode is clicked again", () => {
    const onDrawModeChange = vi.fn();
    const onDrawShapeChange = vi.fn();
    const onStrokeWidthChange = vi.fn();
    const onSymmetryChange = vi.fn();
    render(
      <StudioInspectorDrawModeControls
        drawMode="shape"
        onDrawModeChange={onDrawModeChange}
        onDrawShapeChange={onDrawShapeChange}
        onStrokeWidthChange={onStrokeWidthChange}
        onSymmetryChange={onSymmetryChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "도형" }));

    expect(onDrawModeChange).not.toHaveBeenCalled();
    expect(onDrawShapeChange).not.toHaveBeenCalled();
    expect(onStrokeWidthChange).not.toHaveBeenCalled();
    expect(onSymmetryChange).not.toHaveBeenCalled();
  });
});
