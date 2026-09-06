// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioLayerTonePanel } from "./StudioLayerTonePanel";

describe("StudioLayerTonePanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders with header, CSP badge, and toggles tone on/off", () => {
    const onChange = vi.fn();
    render(<StudioLayerTonePanel onChange={onChange} />);

    expect(screen.getByText("스크린톤 (Tone)")).toBeDefined();
    expect(screen.getByText("CSP")).toBeDefined();

    const toggleBtn = screen.getByRole("button", { name: "톤 Off" });
    fireEvent.click(toggleBtn);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        strength: 85,
        mode: "mono",
        dotSize: 4,
        angle: 45,
        pattern: "circle",
      }),
    );
  });

  it("renders sliders and pattern options when tone is enabled", () => {
    const onChange = vi.fn();
    render(
      <StudioLayerTonePanel
        value={{
          strength: 80,
          dotSize: 4,
          angle: 45,
          mode: "mono",
          pattern: "circle",
        }}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("85L (초미세)")).toBeDefined();
    expect(screen.getByText("60L (만화 표준)")).toBeDefined();
    expect(screen.getByLabelText("망점 크기 조절")).toBeDefined();
    expect(screen.getByLabelText("망점 각도 조절")).toBeDefined();
    expect(screen.getByLabelText("망점 농도 조절")).toBeDefined();
  });

  it("switches frequency preset on click", () => {
    const onChange = vi.fn();
    render(
      <StudioLayerTonePanel
        value={{
          strength: 80,
          dotSize: 4,
          angle: 45,
          mode: "mono",
          pattern: "circle",
        }}
        onChange={onChange}
      />,
    );

    const preset28L = screen.getByText("28L (굵은 도트)");
    fireEvent.click(preset28L);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        dotSize: 10,
      }),
    );
  });
});
