// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";

import { StudioBg3dTextExtruderPanel } from "./StudioBg3dTextExtruderPanel";

describe("StudioBg3dTextExtruderPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders onomatopoeia presets and generates 3D text specification", () => {
    const handleApply = vi.fn();
    render(<StudioBg3dTextExtruderPanel onApplyText={handleApply} />);

    expect(screen.getByText("쾅!!")).toBeDefined();
    expect(screen.getByText("슉-!")).toBeDefined();

    const applyBtn = screen.getByText("3D 텍스트 / 효과음 씬에 추가");
    fireEvent.click(applyBtn);

    expect(handleApply).toHaveBeenCalledTimes(1);
    expect(handleApply.mock.calls[0][0].text).toBe("쾅!!");
    expect(handleApply.mock.calls[0][0].characterTransforms.length).toBe(3);
  });
});
