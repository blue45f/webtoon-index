// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";

import { StudioBg3dMatCapStudioPanel } from "./StudioBg3dMatCapStudioPanel";

describe("StudioBg3dMatCapStudioPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders stylized material presets and triggers onApplyShader", () => {
    const handleApply = vi.fn();
    render(<StudioBg3dMatCapStudioPanel onApplyShader={handleApply} />);

    expect(screen.getAllByText(/애니메이션/i).length).toBeGreaterThan(0);

    const chromeBtn = screen.getByText("미러");
    fireEvent.click(chromeBtn);

    expect(handleApply).toHaveBeenCalledTimes(1);
    expect(handleApply.mock.calls[0][0].id).toBe("metallic-chrome");
  });
});
