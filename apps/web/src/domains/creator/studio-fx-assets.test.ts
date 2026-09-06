import { describe, expect, it } from "vitest";

import { COMIC_VECTOR_STICKERS, FX_OVERLAYS } from "./studio-fx-assets";

describe("studio FX vector assets", () => {
  it("ships 33 unique overlays and preserves the comic sticker catalog", () => {
    expect(FX_OVERLAYS).toHaveLength(33);
    expect(COMIC_VECTOR_STICKERS.length).toBeGreaterThanOrEqual(28);
    const ids = FX_OVERLAYS.map((overlay) => overlay.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every overlay standalone, finite and placeable", () => {
    for (const overlay of FX_OVERLAYS) {
      expect(overlay.svg.startsWith("<svg xmlns=")).toBe(true);
      expect(overlay.svg.endsWith("</svg>")).toBe(true);
      expect(overlay.svg).not.toContain("NaN");
      expect(overlay.svg).not.toContain("undefined");
      expect(overlay.width).toBeGreaterThan(0);
      expect(overlay.height).toBeGreaterThan(0);
    }
  });

  it("includes the new directional, weather and impact effects", () => {
    const ids = new Set(FX_OVERLAYS.map((overlay) => overlay.id));
    for (const id of [
      "concentric-shockwave",
      "corner-focus-lines",
      "vertical-speed-fall",
      "diagonal-rain",
      "motion-arcs",
      "ink-impact-burst",
      "floating-embers",
      "manga-shock-marks",
    ]) {
      expect(ids.has(id), `missing FX overlay: ${id}`).toBe(true);
    }
  });
});
