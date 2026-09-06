// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_STUDIO_EYEDROPPER_SETTINGS } from "./studio-eyedropper";
import { StudioEyedropperPanel, type StudioEyedropperPanelProps } from "./StudioEyedropperPanel";

function props(overrides: Partial<StudioEyedropperPanelProps> = {}): StudioEyedropperPanelProps {
  return {
    active: false,
    settings: DEFAULT_STUDIO_EYEDROPPER_SETTINGS,
    primaryColor: "#123456",
    secondaryColor: "#abcdef",
    recentColors: ["#112233", "#445566", "#112233"],
    onToggleActive: vi.fn(),
    onSettingsChange: vi.fn(),
    onSelectRecentColor: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("StudioEyedropperPanel", () => {
  it("exposes canvas activation, Magma shortcuts, reference modes, and color targets", () => {
    const onToggleActive = vi.fn();
    const onSettingsChange = vi.fn();
    render(<StudioEyedropperPanel {...props({ onToggleActive, onSettingsChange })} />);

    const activate = screen.getByRole("button", { name: "캔버스 스포이드 켜기" });
    expect(activate.getAttribute("aria-keyshortcuts")).toBe("I");
    fireEvent.click(activate);
    expect(onToggleActive).toHaveBeenCalledOnce();
    expect(screen.getByText("Alt")).toBeTruthy();

    const references = screen.getByRole("radiogroup", { name: "스포이드 참조 대상" });
    expect(within(references).getAllByRole("radio")).toHaveLength(3);
    fireEvent.click(within(references).getByRole("radio", { name: /현재 레이어/ }));
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ reference: "active-layer" }));

    const slots = screen.getByRole("radiogroup", { name: "스포이드 색상 슬롯" });
    fireEvent.click(within(slots).getByRole("radio", { name: /보조 색에 채집/ }));
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ target: "secondary" }));
  });

  it("supports roving arrow-key selection for compact radio groups", () => {
    const onSettingsChange = vi.fn();
    render(<StudioEyedropperPanel {...props({ onSettingsChange })} />);
    const references = screen.getByRole("radiogroup", { name: "스포이드 참조 대상" });
    const merged = within(references).getByRole("radio", { name: /표시색/ });
    fireEvent.keyDown(merged, { key: "ArrowRight" });
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ reference: "active-layer" }));
    expect(document.activeElement).toBe(within(references).getByRole("radio", { name: /현재 레이어/ }));
  });

  it("offers exact-to-32px average sampling and quick presets", () => {
    const onSettingsChange = vi.fn();
    render(<StudioEyedropperPanel {...props({
      settings: { ...DEFAULT_STUDIO_EYEDROPPER_SETTINGS, averageRadius: 5 },
      onSettingsChange,
    })} />);
    expect(screen.getByText("11×11 원형 평균")).toBeTruthy();
    const slider = screen.getByRole("slider", { name: "스포이드 평균 반경 · 5픽셀" });
    expect((slider as HTMLInputElement).max).toBe("32");
    fireEvent.change(slider, { target: { value: "32" } });
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ averageRadius: 32 }));
    fireEvent.click(screen.getByRole("button", { name: "정확히" }));
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ averageRadius: 0 }));
  });

  it("progressively enables CSP-style exclusions only for layer references", () => {
    const onSettingsChange = vi.fn();
    const { rerender } = render(<StudioEyedropperPanel {...props({ onSettingsChange })} />);
    fireEvent.click(screen.getByText("제외 설정"));
    expect((screen.getByRole("switch", { name: "잠긴 레이어" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("switch", { name: "용지·배경" }) as HTMLButtonElement).disabled).toBe(true);

    rerender(<StudioEyedropperPanel {...props({
      settings: { ...DEFAULT_STUDIO_EYEDROPPER_SETTINGS, reference: "top-layer" },
      onSettingsChange,
    })} />);
    const referenceSwitch = screen.getByRole("switch", { name: "참조 레이어" });
    expect((referenceSwitch as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(referenceSwitch);
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ excludeReference: true }));
  });

  it("shows active-layer guidance, loupe/return switches, last sample, and deduped recent history", () => {
    const onSettingsChange = vi.fn();
    const onSelectRecentColor = vi.fn();
    render(<StudioEyedropperPanel {...props({
      settings: { ...DEFAULT_STUDIO_EYEDROPPER_SETTINGS, reference: "active-layer", target: "secondary" },
      activeLayerName: "선화",
      lastSample: { hex: "#fedcba", layerName: "선화", reference: "active-layer" },
      onSettingsChange,
      onSelectRecentColor,
    })} />);
    expect(screen.getByText("현재 레이어 · 선화")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: /확대 루페/ }));
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ showLoupe: false }));
    expect(screen.getByText("#fedcba")).toBeTruthy();

    const recent = screen.getByLabelText("최근 스포이드 색상");
    expect(within(recent).getAllByRole("button")).toHaveLength(2);
    fireEvent.click(within(recent).getByRole("button", { name: /#112233.*보조 색/ }));
    expect(onSelectRecentColor).toHaveBeenCalledWith("#112233", "secondary");
  });

  it("keeps every coarse-pointer control at an explicit 44px target contract", () => {
    render(<StudioEyedropperPanel {...props()} />);
    const panel = screen.getByRole("region", { name: "정밀 스포이드" });
    expect(panel.className).toContain("rounded-xl");
    expect(screen.getByRole("button", { name: "캔버스 스포이드 켜기" }).className).toContain("pointer-coarse:min-h-11");
    expect(screen.getByRole("radio", { name: /주 색에 채집/ }).className).toContain("pointer-coarse:min-h-11");
  });
});
