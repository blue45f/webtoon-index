import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";

import { StudioBg3dSpatialFxPanel } from "./StudioBg3dSpatialFxPanel";

describe("StudioBg3dSpatialFxPanel", () => {
  it("renders SFX preset buttons and options", () => {
    const markup = renderToStaticMarkup(
      <StudioBg3dSpatialFxPanel
        onInsertSfxTypography={vi.fn()}
        onInsertSpeedLines={vi.fn()}
      />,
    );

    expect(markup).toContain("3D 입체 효과음 (SFX)");
    expect(markup).toContain("쿵");
    expect(markup).toContain("쾅");
    expect(markup).toContain("촤아악");
    expect(markup).toContain("입체 두께");
    expect(markup).toContain("3D 씬에 입체 효과음 추가");
  });

  it("renders disabled state when disabled prop is passed", () => {
    const markup = renderToStaticMarkup(
      <StudioBg3dSpatialFxPanel
        disabled
        onInsertSfxTypography={vi.fn()}
        onInsertSpeedLines={vi.fn()}
      />,
    );

    expect(markup).toContain("disabled");
  });
});
