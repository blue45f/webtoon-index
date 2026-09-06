import type { StudioVrmTexturePaintBlendMode } from "./studio-vrm-texture-paint-ops";

export interface StudioVrmTexturePaintCursorSettings {
  readonly blend: StudioVrmTexturePaintBlendMode;
  readonly color: string;
  readonly sizeTexels: number;
  readonly tuning: {
    readonly hardness: number;
  };
}

const HEX_COLOR = /^#[0-9a-f]{6}$/iu;

/**
 * Builds a bounded SVG cursor that communicates brush diameter, hardness, colour, and eraser mode.
 * Texture-space diameter is mapped logarithmically because the exact screen footprint varies with
 * camera distance and UV density; the cursor remains precise without becoming larger than common
 * browser cursor limits.
 */
export function createStudioVrmTexturePaintCursor(
  settings: StudioVrmTexturePaintCursorSettings,
): string {
  const diameter = Math.max(
    14,
    Math.min(64, Math.round(8 + Math.sqrt(Math.max(1, settings.sizeTexels)) * 4)),
  );
  const center = diameter / 2;
  const outerRadius = Math.max(3, center - 2);
  const hardnessRadius = Math.max(1, outerRadius * settings.tuning.hardness);
  const paintColor = HEX_COLOR.test(settings.color) ? settings.color : "#ffffff";
  const eraseMark = settings.blend === "erase"
    ? `<path d="M${center - outerRadius * 0.48} ${center + outerRadius * 0.48}L${center + outerRadius * 0.48} ${center - outerRadius * 0.48}" stroke="#ff6b6b" stroke-width="2"/>`
    : "";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${diameter}" height="${diameter}" viewBox="0 0 ${diameter} ${diameter}">`
    + `<circle cx="${center}" cy="${center}" r="${outerRadius}" fill="none" stroke="#111" stroke-width="3" opacity=".82"/>`
    + `<circle cx="${center}" cy="${center}" r="${outerRadius}" fill="none" stroke="#fff" stroke-width="1"/>`
    + `<circle cx="${center}" cy="${center}" r="${hardnessRadius}" fill="none" stroke="${paintColor}" stroke-width="1" opacity=".9"/>`
    + eraseMark
    + "</svg>";
  const hotspot = Math.floor(center);
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotspot} ${hotspot}, crosshair`;
}
