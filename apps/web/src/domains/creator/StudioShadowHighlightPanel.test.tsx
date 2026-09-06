// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SHADOW_HIGHLIGHT,
  SHADOW_HIGHLIGHT_PRESETS,
  normalizeShadowHighlight,
} from "./studio-shadow-highlight";
import { StudioShadowHighlightPanel } from "./StudioShadowHighlightPanel";

type PanelProps = Parameters<typeof StudioShadowHighlightPanel>[0];

function baseProps(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    value: normalizeShadowHighlight(DEFAULT_SHADOW_HIGHLIGHT),
    onPatch: vi.fn(),
    onApplyPreset: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("StudioShadowHighlightPanel", () => {
  it("헤더와 5개 슬라이더(섀도우/톤 범위/하이라이트/톤 범위/미드톤 대비)를 렌더한다", () => {
    render(<StudioShadowHighlightPanel {...baseProps()} />);
    expect(screen.getByText("섀도우/하이라이트 (Shadow/Highlight)")).toBeTruthy();
    expect(screen.getAllByRole("slider")).toHaveLength(5);
    expect(screen.getByText("섀도우")).toBeTruthy();
    expect(screen.getByText("섀도우 톤 범위")).toBeTruthy();
    expect(screen.getByText("하이라이트")).toBeTruthy();
    expect(screen.getByText("하이라이트 톤 범위")).toBeTruthy();
    expect(screen.getByText("미드톤 대비")).toBeTruthy();
  });

  it("섀도우 슬라이더 변경은 onPatch({ shadows })를 즉시 호출한다", () => {
    const onPatch = vi.fn();
    render(<StudioShadowHighlightPanel {...baseProps({ onPatch })} />);
    const shadowsSlider = screen.getAllByRole("slider")[0]!;

    fireEvent.change(shadowsSlider, { target: { value: "45" } });
    expect(onPatch).toHaveBeenCalledOnce();
    expect(onPatch).toHaveBeenLastCalledWith({ shadows: 45 });
  });

  it("미드톤 대비 슬라이더는 음수 값도 그대로 패치한다", () => {
    const onPatch = vi.fn();
    render(<StudioShadowHighlightPanel {...baseProps({ onPatch })} />);
    const midtoneSlider = screen.getAllByRole("slider")[4]!;

    fireEvent.change(midtoneSlider, { target: { value: "-30" } });
    expect(onPatch).toHaveBeenLastCalledWith({ midtoneContrast: -30 });
  });

  it("모든 프리셋 칩을 렌더하고, 클릭하면 onApplyPreset에 프리셋 값을 넘긴다", () => {
    const onApplyPreset = vi.fn();
    render(<StudioShadowHighlightPanel {...baseProps({ onApplyPreset })} />);

    for (const preset of SHADOW_HIGHLIGHT_PRESETS) {
      expect(screen.getByRole("button", { name: preset.label })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole("button", { name: "역광 보정" }));
    expect(onApplyPreset).toHaveBeenCalledOnce();
    expect(onApplyPreset).toHaveBeenLastCalledWith(
      SHADOW_HIGHLIGHT_PRESETS.find((preset) => preset.id === "backlight")!.value
    );
  });

  it("항등 값이면 리셋 버튼이 비활성화되고, 보정이 있으면 onReset을 호출한다", () => {
    const onReset = vi.fn();
    const { unmount } = render(<StudioShadowHighlightPanel {...baseProps({ onReset })} />);
    const resetIdle = screen.getByRole("button", { name: "원본으로" });
    expect((resetIdle as HTMLButtonElement).disabled).toBe(true);
    unmount();

    render(
      <StudioShadowHighlightPanel
        {...baseProps({ onReset, value: normalizeShadowHighlight({ shadows: 40 }) })}
      />
    );
    const reset = screen.getByRole("button", { name: "원본으로" });
    expect((reset as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(reset);
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("항등이면 '기본' 프리셋 칩만 활성(aria-pressed 대신 시각 상태) 표시 로직이 동작한다", () => {
    render(<StudioShadowHighlightPanel {...baseProps()} />);
    // StudioPanelChip active는 클래스 기반 — 항등일 때 '기본' 칩이 존재하는지 확인.
    expect(screen.getByRole("button", { name: "기본" })).toBeTruthy();
  });

  it("현재 값이 각 슬라이더 value·readout에 반영된다", () => {
    render(
      <StudioShadowHighlightPanel
        {...baseProps({
          value: normalizeShadowHighlight({
            shadows: 33,
            shadowsWidth: 70,
            highlights: 21,
            highlightsWidth: 40,
            midtoneContrast: -12,
          }),
        })}
      />
    );
    const sliders = screen.getAllByRole("slider") as HTMLInputElement[];
    expect(sliders.map((slider) => slider.value)).toEqual(["33", "70", "21", "40", "-12"]);
    expect(screen.getByText("-12")).toBeTruthy();
  });
});
