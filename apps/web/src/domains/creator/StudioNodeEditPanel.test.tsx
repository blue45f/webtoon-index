// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioNodeEditPanel, type StudioNodeEditPanelProps } from "./StudioNodeEditPanel";

function createProps(overrides: Partial<StudioNodeEditPanelProps> = {}): StudioNodeEditPanelProps {
  return {
    active: true,
    tool: "move",
    handleCount: 4,
    widthModeSupported: true,
    smoothStrength: 0.5,
    onToggle: vi.fn(),
    onToolChange: vi.fn(),
    onSmoothStrengthChange: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("StudioNodeEditPanel", () => {
  it("shows the optional Paper refinement controls and delegates both operations", () => {
    const onRefine = vi.fn();
    render(<StudioNodeEditPanel {...createProps({ onRefine })} />);

    fireEvent.click(screen.getByRole("button", { name: "단순화" }));
    fireEvent.click(screen.getByRole("button", { name: "부드럽게" }));

    expect(onRefine).toHaveBeenNthCalledWith(1, "simplify");
    expect(onRefine).toHaveBeenNthCalledWith(2, "smooth");
    const refinementRegion = screen.getByRole("region", { name: "경로 정리" });
    expect(refinementRegion.getAttribute("aria-busy")).toBe("false");
    expect(within(refinementRegion).getByRole("status").getAttribute("aria-live")).toBe("polite");
  });

  it("uses real disabled controls and keeps unavailable reasons visible", () => {
    const onToolChange = vi.fn();
    const onRefine = vi.fn();
    render(
      <StudioNodeEditPanel
        {...createProps({
          widthModeSupported: false,
          onToolChange,
          onRefine,
          refinementUnavailableReason: "닫힌 벡터 경로를 선택하세요.",
        })}
      />
    );

    const widthButton = screen.getByRole("button", { name: "굵기" });
    expect((widthButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(widthButton);
    expect(onToolChange).not.toHaveBeenCalled();

    expect((screen.getByRole("button", { name: "단순화" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "부드럽게" }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      within(screen.getByRole("region", { name: "경로 정리" })).getByRole("status").textContent
    ).toContain("닫힌 벡터 경로를 선택하세요.");
  });

  it("offers a 44px selection recovery CTA instead of ending at an unavailable reason", () => {
    const onRequestSelectStroke = vi.fn();
    render(
      <StudioNodeEditPanel
        {...createProps({
          onRefine: vi.fn(),
          onRequestSelectStroke,
          refinementUnavailableReason: "자유선 펜 획 하나를 선택하세요.",
        })}
      />,
    );

    const recovery = screen.getByRole("button", { name: "선화 선택하기" });
    expect(recovery.className).toContain("min-h-11");
    expect(recovery.getAttribute("aria-describedby")).toBe(
      "studio-node-refinement-selection-help",
    );
    fireEvent.click(recovery);
    expect(onRequestSelectStroke).toHaveBeenCalledOnce();
    expect(screen.getByText(/Esc를 누르면 선택을 취소/)).toBeTruthy();
  });

  it("announces busy state and exposes cancellation only while work is active", () => {
    const onCancelRefinement = vi.fn();
    const view = render(
      <StudioNodeEditPanel
        {...createProps({
          onRefine: vi.fn(),
          refinementBusy: true,
          onCancelRefinement,
        })}
      />
    );

    const refinementRegion = screen.getByRole("region", { name: "경로 정리" });
    expect(refinementRegion.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("button", { name: "단순화" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "부드럽게" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(refinementRegion).getByRole("status").textContent).toContain("경로를 정리하는 중...");

    fireEvent.click(screen.getByRole("button", { name: "경로 정리 취소" }));
    expect(onCancelRefinement).toHaveBeenCalledOnce();

    view.rerender(
      <StudioNodeEditPanel
        {...createProps({
          onRefine: vi.fn(),
          refinementBusy: false,
          onCancelRefinement,
        })}
      />
    );
    expect(screen.queryByRole("button", { name: "경로 정리 취소" })).toBeNull();
  });

  it("uses shared coarse-pointer sizing for refinement buttons and smoothing controls", () => {
    const onSmoothStrengthChange = vi.fn();
    render(
      <StudioNodeEditPanel
        {...createProps({
          tool: "smooth",
          onRefine: vi.fn(),
          onSmoothStrengthChange,
        })}
      />
    );

    const simplifyButton = screen.getByRole("button", { name: "단순화" });
    const slider = screen.getByRole("slider", { name: "스무딩 강도" });
    const readout = screen.getByText("0.50");

    expect(simplifyButton.className).toContain("pointer-coarse:min-h-11");
    expect(slider.className).toContain("pointer-coarse:h-11");
    expect(readout.className).toContain("pointer-coarse:w-9");

    fireEvent.change(slider, { target: { value: "0.75" } });
    expect(onSmoothStrengthChange).toHaveBeenCalledWith(0.75);
  });
});
