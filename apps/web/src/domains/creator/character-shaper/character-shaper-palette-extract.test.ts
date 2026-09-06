import { describe, expect, it } from "vitest";

import { extractCharacterReferencePalette } from "./character-shaper-palette-extract";

import type { CharacterReferenceImage } from "./character-shaper-palette-extract";

type Band = { readonly hex: string; readonly rows: number; readonly alpha?: number };

function hexToBytes(hex: string): readonly [number, number, number] {
  const int = Number.parseInt(hex.slice(1), 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/** Horizontal colour bands — the shape a flat cel-shaded reference reduces to. */
function banded(width: number, bands: readonly Band[]): CharacterReferenceImage {
  const height = bands.reduce((total, band) => total + band.rows, 0);
  const data = new Uint8ClampedArray(width * height * 4);
  let y = 0;
  for (const band of bands) {
    const [r, g, b] = hexToBytes(band.hex);
    for (let row = 0; row < band.rows; row += 1, y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = band.alpha ?? 255;
      }
    }
  }
  return { data, width, height };
}

const PORTRAIT = banded(16, [
  { hex: "#000000", rows: 4, alpha: 0 },
  { hex: "#2a1f1a", rows: 4 },
  { hex: "#e8b48c", rows: 4 },
  { hex: "#c8323c", rows: 4 },
]);

describe("character shaper reference palette", () => {
  it("returns the flat colour fields of a cut-out reference, not blends of them", () => {
    const palette = extractCharacterReferencePalette(PORTRAIT);

    expect(palette.swatches).toEqual(["#2a1f1a", "#c8323c", "#e8b48c"]);
    expect(palette.swatches.every((hex) => /^#[0-9a-f]{6}$/u.test(hex))).toBe(true);
  });

  it("reads skin from the warm mid-tone, hair from the dark field, accent from the saturated one", () => {
    const palette = extractCharacterReferencePalette(PORTRAIT);

    expect(palette.skin).toBe("#e8b48c");
    expect(palette.hair).toBe("#2a1f1a");
    expect(palette.accent).toBe("#c8323c");
  });

  it("ignores transparent pixels entirely", () => {
    const withNoise = banded(16, [
      { hex: "#00ff00", rows: 8, alpha: 0 },
      { hex: "#e8b48c", rows: 8 },
    ]);

    const palette = extractCharacterReferencePalette(withNoise);

    expect(palette.swatches).toEqual(["#e8b48c"]);
    expect(palette.skin).toBe("#e8b48c");
  });

  it("is deterministic across repeated runs and independent of image scale", () => {
    const first = extractCharacterReferencePalette(PORTRAIT);
    const second = extractCharacterReferencePalette(PORTRAIT);
    expect(second).toEqual(first);

    // 512px tall: the sampler decimates to ≤ 96 rows, and the palette does not move.
    const large = banded(64, [
      { hex: "#2a1f1a", rows: 128 },
      { hex: "#e8b48c", rows: 128 },
      { hex: "#c8323c", rows: 128 },
    ]);
    expect(extractCharacterReferencePalette(large).swatches).toEqual(first.swatches);
  });

  it("honours the swatch budget and clamps it to 1–8", () => {
    const five = banded(16, [
      { hex: "#2a1f1a", rows: 4 },
      { hex: "#e8b48c", rows: 4 },
      { hex: "#c8323c", rows: 4 },
      { hex: "#3f6fd0", rows: 4 },
      { hex: "#f0e6d2", rows: 4 },
    ]);

    expect(extractCharacterReferencePalette(five, { swatches: 3 }).swatches).toHaveLength(3);
    expect(extractCharacterReferencePalette(five, { swatches: 0 }).swatches).toHaveLength(1);
    expect(extractCharacterReferencePalette(five, { swatches: 99 }).swatches.length)
      .toBeLessThanOrEqual(8);
  });

  it("deduplicates swatches that are the same colour to the eye", () => {
    const nearlyIdentical = banded(16, [
      { hex: "#c8323c", rows: 8 },
      { hex: "#cd3741", rows: 8 },
    ]);

    expect(extractCharacterReferencePalette(nearlyIdentical).swatches).toHaveLength(1);
  });

  it("reports null for a role no colour in the image can fill", () => {
    const monochrome = banded(8, [{ hex: "#8a8a8a", rows: 8 }]);

    const palette = extractCharacterReferencePalette(monochrome);

    expect(palette.swatches).toEqual(["#8a8a8a"]);
    // A neutral grey is neither skin nor an accent; it is still the darkest thing present.
    expect(palette.skin).toBeNull();
    expect(palette.hair).toBe("#8a8a8a");
    expect(palette.accent).toBeNull();
  });

  it("returns an empty palette for an empty or fully transparent image", () => {
    const empty = { data: new Uint8ClampedArray(0), width: 0, height: 0 };
    expect(extractCharacterReferencePalette(empty)).toEqual({
      swatches: [],
      skin: null,
      hair: null,
      accent: null,
    });

    const invisible = banded(4, [{ hex: "#ffffff", rows: 4, alpha: 0 }]);
    expect(extractCharacterReferencePalette(invisible).swatches).toEqual([]);
  });
});
