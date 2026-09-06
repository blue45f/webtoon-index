// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COLOR_MATCH_PRESETS,
  createSyntheticReferenceRgba,
} from "./studio-color-match-presets";
import { StudioColorMatchPanel } from "./StudioColorMatchPanel";

describe("StudioColorMatchPanel", () => {
  afterEach(() => {
    cleanup();
  });

  const sampleSourceImage = createSyntheticReferenceRgba(
    [
      [100, 100, 100],
      [200, 200, 200],
    ],
    16,
  );

  it("renders atmospheric presets correctly", () => {
    render(<StudioColorMatchPanel sourceImage={sampleSourceImage} />);

    expect(screen.getByText("컬러 매치 (Color Match)")).toBeDefined();
    for (const preset of COLOR_MATCH_PRESETS) {
      expect(screen.getByText(preset.name)).toBeDefined();
    }
  });

  it("switches presets on click", () => {
    render(<StudioColorMatchPanel sourceImage={sampleSourceImage} />);

    const cyberpunkButton = screen.getByText("사이버펑크 네온");
    fireEvent.click(cyberpunkButton);
    expect(cyberpunkButton).toBeDefined();
  });

  it("calls onApply when applying color match", () => {
    const onApply = vi.fn();
    render(
      <StudioColorMatchPanel
        sourceImage={sampleSourceImage}
        onApply={onApply}
      />,
    );

    const applyButton = screen.getByText("컬러 매치 적용");
    expect(applyButton).toBeDefined();
    fireEvent.click(applyButton);

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 16,
        height: 16,
        data: expect.any(Uint8ClampedArray),
      }),
    );
  });
});
