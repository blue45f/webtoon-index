// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";

import { StudioBg3dClonerPanel } from "./StudioBg3dClonerPanel";

describe("StudioBg3dClonerPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders with default Linear mode and triggers cloner generation", () => {
    const handleApply = vi.fn();
    render(<StudioBg3dClonerPanel onApplyCloner={handleApply} />);

    expect(screen.getByText("선형 복제 (Linear)")).toBeDefined();
    expect(screen.getByText("복제 개수:")).toBeDefined();

    const applyBtn = screen.getByText("3D 클로너 인스턴스 배열 생성");
    fireEvent.click(applyBtn);

    expect(handleApply).toHaveBeenCalledTimes(1);
    expect(handleApply.mock.calls[0][0].clonerType).toBe("linear");
    expect(handleApply.mock.calls[0][0].totalInstances).toBe(5);
  });

  it("switches to Radial mode and generates radial instances", () => {
    const handleApply = vi.fn();
    render(<StudioBg3dClonerPanel onApplyCloner={handleApply} />);

    const radialTab = screen.getByText("원형 복제 (Radial)");
    fireEvent.click(radialTab);

    expect(screen.getByText("원주 개수:")).toBeDefined();
    expect(screen.getByText("반지름 / 각도(°):")).toBeDefined();

    const applyBtn = screen.getByText("3D 클로너 인스턴스 배열 생성");
    fireEvent.click(applyBtn);

    expect(handleApply).toHaveBeenCalledTimes(1);
    expect(handleApply.mock.calls[0][0].clonerType).toBe("radial");
    expect(handleApply.mock.calls[0][0].totalInstances).toBe(8);
  });
});
