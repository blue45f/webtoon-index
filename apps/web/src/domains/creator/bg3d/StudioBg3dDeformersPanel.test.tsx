// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";

import { StudioBg3dDeformersPanel } from "./StudioBg3dDeformersPanel";

describe("StudioBg3dDeformersPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders deformer types and applies twist deformation", () => {
    const handleApply = vi.fn();
    render(<StudioBg3dDeformersPanel onApplyDeformer={handleApply} />);

    expect(screen.getByText("3D 절차적 디포머 (Mesh Deformers)")).toBeDefined();
    expect(screen.getByText("구부리기 (Bend)")).toBeDefined();

    const twistBtn = screen.getByText("비틀기 (Twist)");
    fireEvent.click(twistBtn);

    expect(handleApply).toHaveBeenCalledTimes(1);
    expect(handleApply.mock.calls[0][0].kind).toBe("twist");
  });
});
