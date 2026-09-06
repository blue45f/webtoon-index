import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { STUDIO_BG3D_COMPOSITION_GUIDE_MODES } from "./studio-bg3d-composition-guide";
import { StudioBg3dCompositionOverlay } from "./StudioBg3dCompositionOverlay";

describe("StudioBg3dCompositionOverlay", () => {
  it("renders null when mode is none", () => {
    const html = renderToStaticMarkup(<StudioBg3dCompositionOverlay mode="none" />);
    expect(html).toBe("");
  });

  it("renders 3x3 grid when mode is ruleOfThirds", () => {
    const html = renderToStaticMarkup(<StudioBg3dCompositionOverlay mode="ruleOfThirds" />);
    expect(html).toContain('data-testid="bg3d-composition-overlay"');
    expect(html).toContain('data-guide-mode="ruleOfThirds"');
    expect(html).toContain('circle');
  });

  it("renders vertical webtoon mobile cut box when mode is verticalWebtoon", () => {
    const html = renderToStaticMarkup(<StudioBg3dCompositionOverlay mode="verticalWebtoon" />);
    expect(html).toContain('data-testid="bg3d-composition-overlay"');
    expect(html).toContain('data-guide-mode="verticalWebtoon"');
    expect(html).toContain('rect');
  });

  it("renders golden spiral when mode is goldenSpiral", () => {
    const html = renderToStaticMarkup(<StudioBg3dCompositionOverlay mode="goldenSpiral" />);
    expect(html).toContain('data-testid="bg3d-composition-overlay"');
    expect(html).toContain('data-guide-mode="goldenSpiral"');
    expect(html).toContain('path');
  });

  it("renders crosshair when mode is crosshair", () => {
    const html = renderToStaticMarkup(<StudioBg3dCompositionOverlay mode="crosshair" />);
    expect(html).toContain('data-testid="bg3d-composition-overlay"');
    expect(html).toContain('data-guide-mode="crosshair"');
    expect(html).toContain('line');
  });

  it("contains all 5 predefined composition guide modes", () => {
    expect(STUDIO_BG3D_COMPOSITION_GUIDE_MODES).toHaveLength(5);
    expect(STUDIO_BG3D_COMPOSITION_GUIDE_MODES.map((m) => m.id)).toEqual([
      "none",
      "ruleOfThirds",
      "verticalWebtoon",
      "goldenSpiral",
      "crosshair",
    ]);
  });
});
