import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";

import { StudioBg3dAtmospherePanel } from "./StudioBg3dAtmospherePanel";

describe("StudioBg3dAtmospherePanel", () => {
  it("renders all 12 weather atmosphere preset options and sun dials", () => {
    const markup = renderToStaticMarkup(
      <StudioBg3dAtmospherePanel
        currentPresetId="golden-hour"
        onPresetChange={vi.fn()}
        onSunAngleChange={vi.fn()}
      />,
    );

    expect(markup).toContain("3D 하늘 및 기상 분위기 프리셋 (12종)");
    expect(markup).toContain("쾌청한 한낮");
    expect(markup).toContain("골든 아워");
    expect(markup).toContain("사이버펑크 네온 나이트");
    expect(markup).toContain("폭풍우와 번개");
    expect(markup).toContain("흩날리는 벚꽃잎");
    expect(markup).toContain("환상적인 오로라 &amp; 별빛");
    expect(markup).toContain("태양 고도 및 방위각 제어");
  });

  it("renders disabled state when disabled prop is provided", () => {
    const markup = renderToStaticMarkup(
      <StudioBg3dAtmospherePanel
        disabled
        onPresetChange={vi.fn()}
      />,
    );

    expect(markup).toContain("disabled");
  });
});
