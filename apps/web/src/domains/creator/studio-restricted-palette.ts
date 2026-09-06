/**
 * Lospec-style restricted palette quantizer.
 *
 * Maps any sRGB hex to the nearest locked palette entry (perceptual-ish
 * weighted RGB distance). Pure — no DOM. Used by pixel-art mode and
 * palette-lock stroke admission.
 */

import { normalizeHexColor } from "./studio-color-utils";

export const STUDIO_RESTRICTED_PALETTE_MAX_COLORS = 256;

export interface StudioRestrictedPalette {
  readonly id: string;
  readonly name: string;
  /** Normalized #rrggbb colors. */
  readonly colors: readonly string[];
}

export const STUDIO_LOSPEC_STYLE_PRESETS: readonly StudioRestrictedPalette[] = Object.freeze([
  Object.freeze({
    id: "lospec-1bit-monitor",
    name: "1-Bit Monitor",
    colors: Object.freeze(["#0f0f1b", "#f0f0f0"]),
  }),
  Object.freeze({
    id: "lospec-gameboy",
    name: "Game Boy",
    colors: Object.freeze(["#0f380f", "#306230", "#8bac0f", "#9bbc0f"]),
  }),
  Object.freeze({
    id: "lospec-pico8",
    name: "PICO-8",
    colors: Object.freeze([
      "#000000", "#1d2b53", "#7e2553", "#008751",
      "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
      "#ff004d", "#ffa300", "#ffec27", "#00e436",
      "#29adff", "#83769c", "#ff77a8", "#ffccaa",
    ]),
  }),
  Object.freeze({
    id: "lospec-sweetie-16",
    name: "Sweetie-16",
    colors: Object.freeze([
      "#1a1c2c", "#5d275d", "#b13e53", "#ef7d57",
      "#ffcd75", "#a7f070", "#38b764", "#257179",
      "#29366f", "#3b5dc9", "#41a6f6", "#73eff7",
      "#f4f4f4", "#94b0c2", "#566c86", "#333c57",
    ]),
  }),
  Object.freeze({
    id: "lospec-endessun",
    name: "Endesga 32 (subset)",
    colors: Object.freeze([
      "#be4a2f", "#d77643", "#ead4aa", "#e4a672",
      "#b86f50", "#733e39", "#3e2731", "#a22633",
      "#e43b44", "#f77622", "#feae34", "#fee761",
      "#63c74d", "#3e8948", "#265c42", "#193c3e",
      "#124e89", "#0099db", "#2ce8f5", "#ffffff",
      "#c0cbdc", "#8b9bb4", "#5a6988", "#3a4466",
      "#262b44", "#181425", "#ff0044", "#68386c",
      "#b55088", "#f6757a", "#e8b796", "#c28569",
    ]),
  }),
]);

function parseRgb(hex: string): readonly [number, number, number] | null {
  const normalized = normalizeHexColor(hex);
  if (!normalized || normalized.length !== 7) return null;
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  if (![r, g, b].every((c) => Number.isFinite(c))) return null;
  return [r, g, b] as const;
}

/** Weighted RGB distance (emphasize green) — good enough for palette snapping. */
export function studioRestrictedPaletteDistanceSq(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
}

export function quantizeHexToRestrictedPalette(
  hex: string,
  palette: readonly string[],
): string {
  if (!palette.length) {
    return normalizeHexColor(hex) ?? "#000000";
  }
  const source = parseRgb(hex);
  if (!source) {
    return normalizeHexColor(palette[0]!) ?? "#000000";
  }
  let best = normalizeHexColor(palette[0]!) ?? "#000000";
  let bestDist = Number.POSITIVE_INFINITY;
  for (const entry of palette) {
    const candidate = parseRgb(entry);
    if (!candidate) continue;
    const dist = studioRestrictedPaletteDistanceSq(source, candidate);
    if (dist < bestDist) {
      bestDist = dist;
      best = normalizeHexColor(entry) ?? best;
    }
  }
  return best;
}

export function createStudioRestrictedPalette(
  id: string,
  name: string,
  colors: readonly string[],
): StudioRestrictedPalette {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const color of colors) {
    const hex = normalizeHexColor(color);
    if (!hex || seen.has(hex)) continue;
    seen.add(hex);
    unique.push(hex);
    if (unique.length >= STUDIO_RESTRICTED_PALETTE_MAX_COLORS) break;
  }
  if (unique.length === 0) {
    throw new Error("제한 팔레트에는 하나 이상의 유효한 색이 필요해요.");
  }
  return Object.freeze({
    id: id.trim() || `palette-${unique.length}`,
    name: name.trim() || "제한 팔레트",
    colors: Object.freeze(unique),
  });
}

export function findStudioLospecStylePreset(
  id: string,
): StudioRestrictedPalette | null {
  return STUDIO_LOSPEC_STYLE_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * Quantize entire ImageData buffer in place to the restricted palette.
 * Returns number of pixels changed.
 */
export function quantizeImageDataToRestrictedPalette(
  imageData: ImageData,
  palette: readonly string[],
): number {
  const entries = palette
    .map((hex) => parseRgb(hex))
    .filter((rgb): rgb is readonly [number, number, number] => rgb !== null);
  if (entries.length === 0) return 0;
  const data = imageData.data;
  let changed = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] ?? 0;
    if (a === 0) continue;
    const source: readonly [number, number, number] = [
      data[i] ?? 0,
      data[i + 1] ?? 0,
      data[i + 2] ?? 0,
    ];
    let best = entries[0]!;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const entry of entries) {
      const dist = studioRestrictedPaletteDistanceSq(source, entry);
      if (dist < bestDist) {
        bestDist = dist;
        best = entry;
      }
    }
    if (
      data[i] !== best[0]
      || data[i + 1] !== best[1]
      || data[i + 2] !== best[2]
    ) {
      data[i] = best[0];
      data[i + 1] = best[1];
      data[i + 2] = best[2];
      changed += 1;
    }
  }
  return changed;
}
