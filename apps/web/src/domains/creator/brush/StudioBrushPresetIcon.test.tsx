import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { studioBrushIconId } from "./studio-brush-icons";
import { STUDIO_BRUSH_PACK_CATALOG_IDS } from "./studio-brush-pack-id";
import { StudioBrushPresetIcon } from "./StudioBrushPresetIcon";

describe("StudioBrushPresetIcon", () => {
  it("resolves every procedural brush icon to a real SVG glyph", () => {
    for (const brushId of STUDIO_BRUSH_PACK_CATALOG_IDS) {
      const iconId = studioBrushIconId(brushId);
      const html = renderToStaticMarkup(
        <StudioBrushPresetIcon brushId={brushId} size={18} strokeWidth={2} />
      );

      expect(html).toContain("<svg");
      expect(html).toContain(`data-studio-brush-icon="${iconId}"`);
      expect(html).toContain(`data-studio-brush-icon-for="${brushId}"`);
      expect(html).toContain('aria-hidden="true"');
    }
  });

  it("keeps unknown ids on the established pen fallback", () => {
    const html = renderToStaticMarkup(<StudioBrushPresetIcon brushId="future-brush" />);

    expect(html).toContain('data-studio-brush-icon="default"');
    expect(html).toContain('data-studio-brush-icon-for="future-brush"');
  });

  it("exposes a supplied title as the accessible name", () => {
    const html = renderToStaticMarkup(
      <StudioBrushPresetIcon brushId="heart-stamp" title="하트 도장" />
    );

    expect(html).toContain('aria-label="하트 도장"');
    expect(html).not.toContain("aria-hidden");
  });
});
