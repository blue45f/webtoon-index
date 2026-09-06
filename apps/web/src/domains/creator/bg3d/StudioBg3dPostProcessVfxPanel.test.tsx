// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";

import { StudioBg3dPostProcessVfxPanel } from "./StudioBg3dPostProcessVfxPanel";

describe("StudioBg3dPostProcessVfxPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders with color grading presets and toggles DoF", () => {
    const handleApply = vi.fn();
    render(<StudioBg3dPostProcessVfxPanel onApplyPostProcessConfig={handleApply} />);

    expect(screen.getByText("렌즈 VFX & 시네마틱 후가공 (PostFX)")).toBeDefined();
    expect(screen.getByText("생생한 애니 색감 (Anime Vibrant)")).toBeDefined();

    const dofToggle = screen.getByText("비활성 OFF");
    fireEvent.click(dofToggle);

    expect(handleApply).toHaveBeenCalledTimes(1);
    expect(handleApply.mock.calls[0][0].dof.enabled).toBe(true);
  });
});
