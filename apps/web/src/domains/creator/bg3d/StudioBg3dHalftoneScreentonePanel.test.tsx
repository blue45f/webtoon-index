// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";

import { StudioBg3dHalftoneScreentonePanel } from "./StudioBg3dHalftoneScreentonePanel";

describe("StudioBg3dHalftoneScreentonePanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders screentone presets and allows preset selection", () => {
    const handleApply = vi.fn();
    render(<StudioBg3dHalftoneScreentonePanel onApplyScreentoneConfig={handleApply} />);

    expect(screen.getByText("3D 스크린톤 & 망점 셰이더")).toBeDefined();
    expect(screen.getByText("소년 만화 망점 (Shonen Manga Dot 60L)")).toBeDefined();

    const noirBtn = screen.getByText("다크 누아르 빗금 (Noir Crosshatch)");
    fireEvent.click(noirBtn);

    expect(handleApply).toHaveBeenCalledTimes(1);
    expect(handleApply.mock.calls[0][0].pattern).toBe("diagonal-crosshatch");
  });
});
