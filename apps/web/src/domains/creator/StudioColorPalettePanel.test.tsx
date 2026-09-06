// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioColorPalettePanel } from "./StudioColorPalettePanel";

vi.mock("./studio-color-palette", () => ({
  extractPalette: vi.fn(async (src: string, count: number) => {
    if (src === "empty") return [];
    if (src === "error") throw new Error("Image corrupt");
    return ["#ff0000", "#00ff00", "#0000ff", "#ffffff"].slice(0, count);
  }),
}));

describe("StudioColorPalettePanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders extracted colors with count selector and gradient bar", async () => {
    const onPickColor = vi.fn();
    render(
      <StudioColorPalettePanel
        src="sample.jpg"
        onPickColor={onPickColor}
      />
    );

    expect(screen.getByText("이미지의 고유 배색을 분석하는 중…")).toBeDefined();

    await screen.findByText("이미지 주요 색상");
    expect(screen.getByRole("button", { name: /#ff0000/ })).toBeDefined();

    // Pick a swatch
    fireEvent.click(screen.getByRole("button", { name: /#ff0000/ }));
    expect(onPickColor).toHaveBeenCalledWith("#ff0000");

    // Copy all button
    expect(screen.getByRole("button", { name: /전체 복사/ })).toBeDefined();
    // Save to library button
    expect(screen.getByRole("button", { name: /내 팔레트에 저장/ })).toBeDefined();
  });

  it("handles empty extracted colors state", async () => {
    render(
      <StudioColorPalettePanel
        src="empty"
        onPickColor={vi.fn()}
      />
    );

    expect(await screen.findByText("추출할 색이 없어요(투명 이미지).")).toBeDefined();
  });

  it("handles extraction error state", async () => {
    render(
      <StudioColorPalettePanel
        src="error"
        onPickColor={vi.fn()}
      />
    );

    expect(await screen.findByText("Image corrupt")).toBeDefined();
  });
});
