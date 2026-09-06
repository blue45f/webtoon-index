// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioWetMixPanel, type StudioWetMixPanelProps } from "./StudioWetMixPanel";

function baseProps(overrides: Partial<StudioWetMixPanelProps> = {}): StudioWetMixPanelProps {
  return {
    active: false,
    radius: 32,
    strength: 60,
    wetness: 55,
    pickup: 45,
    hardness: 0.5,
    paintColor: "#7c5cfc",
    onToggleActive: vi.fn(),
    onRadiusChange: vi.fn(),
    onStrengthChange: vi.fn(),
    onWetnessChange: vi.fn(),
    onPickupChange: vi.fn(),
    onHardnessChange: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("StudioWetMixPanel", () => {
  it("fires the armed toggle and reflects the pressed state", () => {
    const onToggleActive = vi.fn();
    const { rerender } = render(<StudioWetMixPanel {...baseProps({ onToggleActive })} />);

    const toggle = screen.getByRole("button", { name: "물감 섞어 칠하기 켜기" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(onToggleActive).toHaveBeenCalledOnce();

    rerender(<StudioWetMixPanel {...baseProps({ onToggleActive, active: true })} />);
    const off = screen.getByRole("button", { name: "물감 섞어 칠하기 끄기" });
    expect(off.getAttribute("aria-pressed")).toBe("true");
  });

  it("forwards slider changes for size, strength, wetness, pickup, and hardness with readouts", () => {
    const onRadiusChange = vi.fn();
    const onStrengthChange = vi.fn();
    const onWetnessChange = vi.fn();
    const onPickupChange = vi.fn();
    const onHardnessChange = vi.fn();
    render(
      <StudioWetMixPanel
        {...baseProps({
          wetness: 70,
          pickup: 30,
          onRadiusChange,
          onStrengthChange,
          onWetnessChange,
          onPickupChange,
          onHardnessChange,
        })}
      />
    );

    const sliders = screen.getAllByRole("slider") as HTMLInputElement[];
    expect(sliders).toHaveLength(5);
    expect(screen.getByText("32px")).toBeTruthy();
    expect(screen.getByText("60%")).toBeTruthy(); // 도포량 readout
    expect(screen.getByText("70%")).toBeTruthy(); // 혼색율 readout
    expect(screen.getByText("30%")).toBeTruthy(); // 묻힘율 readout
    expect(screen.getByText("50%")).toBeTruthy(); // 경도 0.5 readout

    fireEvent.change(sliders[0]!, { target: { value: "64" } });
    expect(onRadiusChange).toHaveBeenLastCalledWith(64);
    fireEvent.change(sliders[1]!, { target: { value: "80" } });
    expect(onStrengthChange).toHaveBeenLastCalledWith(80);
    fireEvent.change(sliders[2]!, { target: { value: "100" } });
    expect(onWetnessChange).toHaveBeenLastCalledWith(100);
    fireEvent.change(sliders[3]!, { target: { value: "10" } });
    expect(onPickupChange).toHaveBeenLastCalledWith(10);
    fireEvent.change(sliders[4]!, { target: { value: "0.85" } });
    expect(onHardnessChange).toHaveBeenLastCalledWith(0.85);
  });

  it("shows the current paint color as the pigment swatch", () => {
    render(<StudioWetMixPanel {...baseProps({ paintColor: "#ff0044" })} />);
    const swatch = screen.getByTestId("wet-mix-paint-swatch");
    expect(swatch.style.backgroundColor).toBe("rgb(255, 0, 68)");
  });

  it("announces state through the aria-live status line", () => {
    const { rerender } = render(<StudioWetMixPanel {...baseProps()} />);
    expect(screen.getByRole("status").textContent).toContain("준비됨");
    expect(screen.getByRole("status").textContent).toContain("현재 색을 새로 칠");

    rerender(<StudioWetMixPanel {...baseProps({ active: true })} />);
    expect(screen.getByRole("status").textContent).toContain("바닥색 위를 드래그");

    rerender(<StudioWetMixPanel {...baseProps({ active: true, busy: true })} />);
    expect(screen.getByRole("status").textContent).toContain("반영 중");
  });

  it("disables every control at the panel boundary and swallows interactions", () => {
    const props = baseProps({ disabled: true });
    render(<StudioWetMixPanel {...props} />);

    const toggle = screen.getByRole("button", { name: "물감 섞어 칠하기 켜기" }) as HTMLButtonElement;
    const sliders = screen.getAllByRole("slider") as HTMLInputElement[];
    expect(toggle.disabled).toBe(true);
    expect(sliders.every((slider) => slider.disabled)).toBe(true);
    expect(toggle.className).toContain("pointer-coarse:min-h-11");
    expect(sliders[0]?.className).toContain("pointer-coarse:h-11");

    fireEvent.click(toggle);
    fireEvent.change(sliders[0]!, { target: { value: "64" } });
    expect(props.onToggleActive).not.toHaveBeenCalled();
    expect(props.onRadiusChange).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("편집용 이미지 복사본");
  });

  it("locks controls while busy without losing the current values", () => {
    const props = baseProps({ active: true, busy: true });
    render(<StudioWetMixPanel {...props} />);

    const sliders = screen.getAllByRole("slider") as HTMLInputElement[];
    expect(sliders.every((slider) => slider.disabled)).toBe(true);
    expect((screen.getByRole("button", { name: "물감 섞어 칠하기 끄기" }) as HTMLButtonElement).disabled).toBe(true);
    expect(sliders[0]!.value).toBe("32");

    fireEvent.change(sliders[2]!, { target: { value: "90" } });
    expect(props.onWetnessChange).not.toHaveBeenCalled();
  });
});
