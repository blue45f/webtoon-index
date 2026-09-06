// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_STUDIO_LAYER_BORDER_EFFECT,
  type StudioLayerBorderEffectSettings,
} from "./studio-layer-border-effect";
import { StudioLayerBorderEffectPanel } from "./StudioLayerBorderEffectPanel";

const ACTIVE: StudioLayerBorderEffectSettings = {
  enabled: true,
  thickness: 4,
  color: "#ff0000",
  type: "outer",
  antiAliased: true,
  respectTransparency: true,
};

describe("StudioLayerBorderEffectPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the labelled group with enable/type/thickness/color controls", () => {
    render(<StudioLayerBorderEffectPanel value={ACTIVE} onChange={() => {}} />);

    expect(screen.getByRole("group", { name: "레이어 경계 효과" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "경계 효과 사용" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "경계 효과 종류" })).toBeTruthy();
    expect(screen.getByLabelText("경계 굵기")).toBeTruthy();
    expect(screen.getByLabelText("경계 색")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "경계 부드럽게" })).toBeTruthy();
  });

  it("enabling from empty commits a normalized default recipe (enabled + 유효 굵기)", () => {
    const onChange = vi.fn();
    render(<StudioLayerBorderEffectPanel onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "경계 효과 사용" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_STUDIO_LAYER_BORDER_EFFECT,
      enabled: true,
    });
  });

  it("commits thickness/color/type changes as normalized absolute values", () => {
    const onChange = vi.fn();
    render(<StudioLayerBorderEffectPanel value={ACTIVE} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("경계 굵기"), { target: { value: "9" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...ACTIVE, thickness: 9 });

    fireEvent.change(screen.getByLabelText("경계 색"), { target: { value: "#00ff00" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...ACTIVE, color: "#00ff00" });

    fireEvent.click(screen.getByRole("radio", { name: "안쪽" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...ACTIVE, type: "inner" });
  });

  it("unchecking 사용 keeps the recipe so re-enabling restores the settings", () => {
    const onChange = vi.fn();
    render(<StudioLayerBorderEffectPanel value={ACTIVE} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "경계 효과 사용" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...ACTIVE, enabled: false });
  });

  it("disables every control when the inspector is read-only", () => {
    render(<StudioLayerBorderEffectPanel value={ACTIVE} disabled onChange={() => {}} />);

    expect((screen.getByRole("checkbox", { name: "경계 효과 사용" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("경계 굵기") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("경계 색") as HTMLInputElement).disabled).toBe(true);
    for (const radio of screen.getAllByRole("radio")) {
      expect((radio as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("keeps type/thickness controls inert while the effect is off (checkbox 만 살아 있다)", () => {
    render(
      <StudioLayerBorderEffectPanel
        value={{ ...ACTIVE, enabled: false }}
        onChange={() => {}}
      />
    );

    expect((screen.getByRole("checkbox", { name: "경계 효과 사용" }) as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText("경계 굵기") as HTMLInputElement).disabled).toBe(true);
    for (const radio of screen.getAllByRole("radio")) {
      expect((radio as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
