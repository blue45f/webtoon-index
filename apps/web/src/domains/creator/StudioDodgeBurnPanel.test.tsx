// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioDodgeBurnPanel,
  type StudioDodgeBurnPanelProps,
} from "./StudioDodgeBurnPanel";

function baseProps(
  overrides: Partial<StudioDodgeBurnPanelProps> = {}
): StudioDodgeBurnPanelProps {
  return {
    active: false,
    mode: "dodge",
    range: "midtones",
    sponge: "saturate",
    radiusPx: 32,
    hardness: 0.5,
    exposure: 50,
    onToggleActive: vi.fn(),
    onModeChange: vi.fn(),
    onRangeChange: vi.fn(),
    onSpongeChange: vi.fn(),
    onRadiusChange: vi.fn(),
    onHardnessChange: vi.fn(),
    onExposureChange: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("StudioDodgeBurnPanel", () => {
  it("fires the armed toggle and reflects the pressed state", () => {
    const onToggleActive = vi.fn();
    const { rerender } = render(
      <StudioDodgeBurnPanel {...baseProps({ onToggleActive })} />
    );

    const toggle = screen.getByRole("button", { name: "밝기·채도 붓 켜기" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(onToggleActive).toHaveBeenCalledOnce();

    rerender(<StudioDodgeBurnPanel {...baseProps({ onToggleActive, active: true })} />);
    const off = screen.getByRole("button", { name: "밝기·채도 붓 끄기" });
    expect(off.getAttribute("aria-pressed")).toBe("true");
  });

  it("selects modes through the segmented control", () => {
    const onModeChange = vi.fn();
    render(<StudioDodgeBurnPanel {...baseProps({ onModeChange })} />);

    const dodgeChip = screen.getByRole("button", { name: "밝게 · 닷지" });
    expect(dodgeChip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "어둡게 · 번" }));
    expect(onModeChange).toHaveBeenLastCalledWith("burn");
    fireEvent.click(screen.getByRole("button", { name: "채도 · 스펀지" }));
    expect(onModeChange).toHaveBeenLastCalledWith("sponge");
  });

  it("shows the tonal range selector for dodge/burn and hides the sponge sub-mode", () => {
    const onRangeChange = vi.fn();
    render(<StudioDodgeBurnPanel {...baseProps({ mode: "burn", onRangeChange })} />);

    expect(screen.queryByRole("button", { name: "채도 올리기" })).toBeNull();
    const midtones = screen.getByRole("button", { name: "중간 영역" });
    expect(midtones.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "어두운 영역" }));
    expect(onRangeChange).toHaveBeenLastCalledWith("shadows");
    fireEvent.click(screen.getByRole("button", { name: "밝은 영역" }));
    expect(onRangeChange).toHaveBeenLastCalledWith("highlights");
  });

  it("shows the sponge sub-mode selector in sponge mode and hides the tonal range", () => {
    const onSpongeChange = vi.fn();
    render(<StudioDodgeBurnPanel {...baseProps({ mode: "sponge", onSpongeChange })} />);

    expect(screen.queryByRole("button", { name: "중간 영역" })).toBeNull();
    const saturate = screen.getByRole("button", { name: "채도 올리기" });
    expect(saturate.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "채도 빼기" }));
    expect(onSpongeChange).toHaveBeenLastCalledWith("desaturate");
  });

  it("forwards slider changes for size, hardness, and exposure with readouts", () => {
    const onRadiusChange = vi.fn();
    const onHardnessChange = vi.fn();
    const onExposureChange = vi.fn();
    render(
      <StudioDodgeBurnPanel
        {...baseProps({ exposure: 40, onRadiusChange, onHardnessChange, onExposureChange })}
      />
    );

    const sliders = screen.getAllByRole("slider") as HTMLInputElement[];
    expect(sliders).toHaveLength(3);
    expect(screen.getByText("32px")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy(); // 경도 0.5 readout
    expect(screen.getByText("40%")).toBeTruthy(); // 노출 readout

    fireEvent.change(sliders[0]!, { target: { value: "64" } });
    expect(onRadiusChange).toHaveBeenLastCalledWith(64);
    fireEvent.change(sliders[1]!, { target: { value: "0.85" } });
    expect(onHardnessChange).toHaveBeenLastCalledWith(0.85);
    fireEvent.change(sliders[2]!, { target: { value: "80" } });
    expect(onExposureChange).toHaveBeenLastCalledWith(80);
  });

  it("announces state through the aria-live status line", () => {
    const { rerender } = render(<StudioDodgeBurnPanel {...baseProps()} />);
    expect(screen.getByRole("status").textContent).toContain("준비됨");
    expect(screen.getByRole("status").textContent).toContain("지나간 자리만");

    rerender(<StudioDodgeBurnPanel {...baseProps({ active: true, mode: "dodge" })} />);
    expect(screen.getByRole("status").textContent).toContain("보정할 부분을 짧게 드래그");

    rerender(<StudioDodgeBurnPanel {...baseProps({ active: true, busy: true })} />);
    expect(screen.getByRole("status").textContent).toContain("반영 중");
  });

  it("disables every control at the panel boundary and swallows interactions", () => {
    const props = baseProps({ disabled: true });
    render(<StudioDodgeBurnPanel {...props} />);

    const toggle = screen.getByRole("button", { name: "밝기·채도 붓 켜기" }) as HTMLButtonElement;
    const chips = ["밝게 · 닷지", "어둡게 · 번", "채도 · 스펀지", "중간 영역"].map(
      (name) => screen.getByRole("button", { name }) as HTMLButtonElement
    );
    const sliders = screen.getAllByRole("slider") as HTMLInputElement[];
    expect(toggle.disabled).toBe(true);
    expect(chips.every((chip) => chip.disabled)).toBe(true);
    expect(sliders.every((slider) => slider.disabled)).toBe(true);
    expect(toggle.className).toContain("pointer-coarse:min-h-11");
    expect(sliders[0]?.className).toContain("pointer-coarse:h-11");

    fireEvent.click(toggle);
    fireEvent.click(chips[1]!);
    fireEvent.change(sliders[0]!, { target: { value: "64" } });
    expect(props.onToggleActive).not.toHaveBeenCalled();
    expect(props.onModeChange).not.toHaveBeenCalled();
    expect(props.onRadiusChange).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("편집용 이미지 복사본");
  });

  it("locks controls while busy without losing the current values", () => {
    const props = baseProps({ active: true, busy: true });
    render(<StudioDodgeBurnPanel {...props} />);

    const sliders = screen.getAllByRole("slider") as HTMLInputElement[];
    expect(sliders.every((slider) => slider.disabled)).toBe(true);
    expect((screen.getByRole("button", { name: "밝게 · 닷지" }) as HTMLButtonElement).disabled).toBe(true);
    expect(sliders[0]!.value).toBe("32");

    fireEvent.click(screen.getByRole("button", { name: "어둡게 · 번" }));
    expect(props.onModeChange).not.toHaveBeenCalled();
  });
});
