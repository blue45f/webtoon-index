// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioColorPopover } from "./StudioColorPopover";

describe("StudioColorPopover Advanced Benchmarked Features", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders all 5 competitor-benchmarked mode tabs (팔레트, 휠, 조화, 웹툰, 슬라이더)", async () => {
    render(
      <StudioColorPopover
        value="#ff5500"
        onChange={vi.fn()}
        recentColors={["#ff5500", "#0088ff"]}
        label="채색 팔레트"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "채색 팔레트" }));
    await screen.findByRole("dialog", { name: "채색 팔레트 선택" });

    // Mode tabs
    expect(screen.getByRole("tab", { name: "팔레트 모드" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "휠 모드" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "조화 모드" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "웹툰 모드" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "슬라이더 모드" })).toBeDefined();

    // Tints & Shades strip is present
    expect(screen.getByRole("radiogroup", { name: "명도 및 음영 단계" })).toBeDefined();
  });

  it("switches to Wheel mode and adjusts hue via arrow keys", async () => {
    const onChange = vi.fn();
    render(
      <StudioColorPopover
        value="#ff0000"
        onChange={onChange}
        recentColors={[]}
        label="색상환 테스트"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "색상환 테스트" }));
    await screen.findByRole("dialog", { name: "색상환 테스트 선택" });

    // Switch to Wheel mode
    fireEvent.click(screen.getByRole("tab", { name: "휠 모드" }));

    const hueSlider = screen.getByRole("slider", { name: "색상환 색조 각도" });
    expect(hueSlider).toBeDefined();

    fireEvent.keyDown(hueSlider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalled();
  });

  it("switches to Harmonies mode and applies complementary color", async () => {
    const onChange = vi.fn();
    render(
      <StudioColorPopover
        value="#ff0000"
        onChange={onChange}
        recentColors={[]}
        label="조화 배색 테스트"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "조화 배색 테스트" }));
    await screen.findByRole("dialog", { name: "조화 배색 테스트 선택" });

    fireEvent.click(screen.getByRole("tab", { name: "조화 모드" }));
    expect(screen.getByText(/180도 반대편 색으로/)).toBeDefined();

    const compSwatches = screen.getAllByRole("radio", { name: /조화 색상/ });
    expect(compSwatches.length).toBeGreaterThanOrEqual(2);

    fireEvent.click(compSwatches[1]!);
    expect(onChange).toHaveBeenCalled();
  });

  it("switches to Webtoon mode and shows anti-muddy cel shadow stages", async () => {
    const onChange = vi.fn();
    render(
      <StudioColorPopover
        value="#ffdcc5"
        onChange={onChange}
        recentColors={[]}
        label="웹툰 음영 테스트"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "웹툰 음영 테스트" }));
    await screen.findByRole("dialog", { name: "웹툰 음영 테스트 선택" });

    fireEvent.click(screen.getByRole("tab", { name: "웹툰 모드" }));

    expect(screen.getByText("Anti-Muddy")).toBeDefined();
    const cel1Button = screen.getByRole("radio", { name: /1차 음영/ });
    expect(cel1Button).toBeDefined();

    fireEvent.click(cel1Button);
    expect(onChange).toHaveBeenCalled();
  });

  it("switches to Sliders mode and changes RGB channel", async () => {
    const onChange = vi.fn();
    render(
      <StudioColorPopover
        value="#ff8800"
        onChange={onChange}
        recentColors={[]}
        label="슬라이더 테스트"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "슬라이더 테스트" }));
    await screen.findByRole("dialog", { name: "슬라이더 테스트 선택" });

    fireEvent.click(screen.getByRole("tab", { name: "슬라이더 모드" }));

    const redSlider = screen.getByRole("slider", { name: "빨강 채널 R" });
    fireEvent.change(redSlider, { target: { value: "100" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("reverts to original color when clicking comparison chip", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <StudioColorPopover
        value="#112233"
        onChange={onChange}
        recentColors={[]}
        label="비교 테스트"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "비교 테스트" }));
    await screen.findByRole("dialog", { name: "비교 테스트 선택" });

    rerender(
      <StudioColorPopover
        value="#998877"
        onChange={onChange}
        recentColors={[]}
        label="비교 테스트"
      />
    );

    const revertButton = screen.getByRole("button", { name: "이전 색상 #112233로 되돌리기" });
    fireEvent.click(revertButton);
    expect(onChange).toHaveBeenCalledWith("#112233");
  });
});
