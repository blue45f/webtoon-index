/**
 * Studio Circular Text Path Layout Engine
 *
 * CLIP STUDIO PAINT Ver.3.0 Parity:
 * - Circular Text Arrangement (원형 텍스트 배치):
 *   - Allows lettering, sound effects (SFX), magical spells, and title stamps to follow a circular arc.
 *   - Calculates per-glyph position (x, y) and tangent rotation angle along the circle circumference.
 *   - Supports:
 *     - Clockwise / Counter-Clockwise flow
 *     - Outward / Inward letter orientation
 *     - Auto-spacing based on font size and radius
 *
 * Pure, deterministic, zero-dependency.
 */

export interface CircularTextOptions {
  readonly centerX: number;
  readonly centerY: number;
  readonly radius: number;
  readonly startAngleDeg?: number; // default: -90 (top)
  readonly direction?: "clockwise" | "counter-clockwise"; // default: clockwise
  readonly orientation?: "outward" | "inward"; // default: outward
  readonly fontSizePx?: number; // default: 24
  readonly letterSpacingDeg?: number; // if omitted, calculated from fontSize / circumference
}

export interface CircularGlyphLayout {
  readonly char: string;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly rotationDeg: number;
}

export interface CircularTextResult {
  readonly glyphs: readonly CircularGlyphLayout[];
  readonly totalSpanDeg: number;
}

/**
 * Computes circular coordinates and rotation for each character in a text string.
 */
export function layoutCircularText(
  text: string,
  options: CircularTextOptions,
): CircularTextResult {
  const chars = Array.from(text);
  if (chars.length === 0) {
    return Object.freeze({ glyphs: Object.freeze([]), totalSpanDeg: 0 });
  }

  const {
    centerX,
    centerY,
    radius,
    startAngleDeg = -90,
    direction = "clockwise",
    orientation = "outward",
    fontSizePx = 24,
    letterSpacingDeg,
  } = options;

  const r = Math.max(10, radius);
  const circumference = 2 * Math.PI * r;

  // Angular width per character if not explicitly provided
  const glyphAngularWidth = (fontSizePx / circumference) * 360 * 1.05;
  const stepDeg = letterSpacingDeg ?? glyphAngularWidth;

  const dirSign = direction === "clockwise" ? 1 : -1;
  const glyphs: CircularGlyphLayout[] = [];

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const angleDeg = startAngleDeg + i * stepDeg * dirSign;
    const angleRad = (angleDeg * Math.PI) / 180;

    const x = centerX + r * Math.cos(angleRad);
    const y = centerY + r * Math.sin(angleRad);

    // Tangent or normal rotation for glyph
    const rotDeg = orientation === "outward" ? angleDeg + 90 : angleDeg - 90;

    glyphs.push(
      Object.freeze({
        char,
        index: i,
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        rotationDeg: Math.round(rotDeg * 10) / 10,
      }),
    );
  }

  const totalSpan = (chars.length - 1) * stepDeg;

  return Object.freeze({
    glyphs: Object.freeze(glyphs),
    totalSpanDeg: Math.round(totalSpan * 10) / 10,
  });
}
