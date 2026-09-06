export type StudioGpuRgba = readonly [number, number, number, number];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function parseHexPair(value: string): number {
  return Number.parseInt(value, 16) / 255;
}

/** Exact color grammar shared by authority planning and both compositor backends. */
export function parseStudioGpuColor(value: unknown): StudioGpuRgba | null {
  if (typeof value !== "string") return null;
  const color = value.trim().toLowerCase();
  if (color === "transparent") return [0, 0, 0, 0];
  if (/^#[0-9a-f]{3,4}$/u.test(color)) {
    const red = parseHexPair(`${color[1]}${color[1]}`);
    const green = parseHexPair(`${color[2]}${color[2]}`);
    const blue = parseHexPair(`${color[3]}${color[3]}`);
    const alpha = color.length === 5 ? parseHexPair(`${color[4]}${color[4]}`) : 1;
    return [red, green, blue, alpha];
  }
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/u.test(color)) {
    return [
      parseHexPair(color.slice(1, 3)),
      parseHexPair(color.slice(3, 5)),
      parseHexPair(color.slice(5, 7)),
      color.length === 9 ? parseHexPair(color.slice(7, 9)) : 1,
    ];
  }
  const rgb = color.match(
    /^rgba?\(\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*[, ]\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*[, ]\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:\s*[,/]\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)%?))?\s*\)$/u
  );
  if (!rgb) return null;
  const alphaToken = rgb[4];
  const alpha = alphaToken?.endsWith("%")
    ? Number.parseFloat(alphaToken) / 100
    : Number.parseFloat(alphaToken ?? "1");
  const red = Number.parseFloat(rgb[1] ?? "0") / 255;
  const green = Number.parseFloat(rgb[2] ?? "0") / 255;
  const blue = Number.parseFloat(rgb[3] ?? "0") / 255;
  if (![red, green, blue, alpha].every(Number.isFinite)) return null;
  return [clamp(red, 0, 1), clamp(green, 0, 1), clamp(blue, 0, 1), clamp(alpha, 0, 1)];
}

export function isStudioGpuColorSupported(value: unknown): value is string {
  return parseStudioGpuColor(value) !== null;
}
