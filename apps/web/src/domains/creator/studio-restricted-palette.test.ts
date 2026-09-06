import { describe, expect, it } from "vitest";

import {
  createStudioRestrictedPalette,
  findStudioLospecStylePreset,
  quantizeHexToRestrictedPalette,
  quantizeImageDataToRestrictedPalette,
  STUDIO_LOSPEC_STYLE_PRESETS,
} from "./studio-restricted-palette";

describe("studio-restricted-palette", () => {
  it("ships Lospec-style preset packs", () => {
    expect(STUDIO_LOSPEC_STYLE_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(findStudioLospecStylePreset("lospec-gameboy")?.colors).toHaveLength(4);
  });

  it("snaps arbitrary hex to nearest palette color", () => {
    const palette = ["#000000", "#ffffff", "#ff0000"];
    expect(quantizeHexToRestrictedPalette("#010101", palette)).toBe("#000000");
    expect(quantizeHexToRestrictedPalette("#fefefe", palette)).toBe("#ffffff");
    expect(quantizeHexToRestrictedPalette("#ee1111", palette)).toBe("#ff0000");
  });

  it("creates deduped frozen palettes", () => {
    const palette = createStudioRestrictedPalette("x", "Test", [
      "#FF0000",
      "#ff0000",
      "#00ff00",
    ]);
    expect(palette.colors).toEqual(["#ff0000", "#00ff00"]);
  });

  it("quantizes ImageData pixels in place", () => {
    const image = {
      data: new Uint8ClampedArray([10, 10, 10, 255, 250, 10, 10, 255]),
      width: 2,
      height: 1,
    } as ImageData;
    const changed = quantizeImageDataToRestrictedPalette(image, [
      "#000000",
      "#ff0000",
    ]);
    expect(changed).toBe(2);
    expect([...image.data.slice(0, 3)]).toEqual([0, 0, 0]);
    expect([...image.data.slice(4, 7)]).toEqual([255, 0, 0]);
  });
});
