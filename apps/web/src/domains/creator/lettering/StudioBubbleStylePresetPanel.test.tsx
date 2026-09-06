import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StudioBubbleStylePresetPanel } from "./StudioBubbleStylePresetPanel";

describe("StudioBubbleStylePresetPanel", () => {
  it("renders visual bubble swatches for commercial style pickers", () => {
    const html = renderToStaticMarkup(
      <StudioBubbleStylePresetPanel
        selected={{
          fill: "#fffdfa",
          textFill: "#211d19",
          stroke: "#211d19",
          strokeWidth: 2,
          variant: "speech",
        }}
        onApplyPreset={vi.fn()}
      />
    );
    expect(html).toContain('data-studio-bubble-style-presets="true"');
    expect(html).toContain("분위기 스와치");
    expect(html).toContain('data-studio-bubble-swatch="classic_white"');
    expect(html).toContain('data-studio-bubble-swatch-variant="speech"');
    expect(html).toContain('data-studio-bubble-swatch-variant="thought"');
    expect(html).toContain('data-studio-bubble-swatch-variant="scared"');
    expect(html).toContain('data-studio-bubble-swatch-variant="heart"');
    expect(html).toContain("기본 흰색");
    // SVG speech-body path present (not text-only row)
    expect(html).toContain("<svg");
    expect(html).toContain("가");
  });
});
