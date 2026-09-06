/**
 * Character Shaper — pure raster math for the semantic PSD passes.
 *
 * Everything here operates on **straight-alpha RGBA8** (`Uint8ClampedArray`, row-major, top-left
 * origin) — the exact shape `captureStudioVrmRgba` returns and `ag-psd` accepts. No DOM, no WebGL,
 * no randomness: the semantic export is assembled from these functions so the layer separation can
 * be proved on tiny synthetic buffers instead of a GPU.
 *
 * Conventions shared by every function:
 *  - inputs are never mutated; each call allocates exactly one output buffer;
 *  - loops are single-pass over the pixels (plus one luma/coverage field for the Sobel);
 *  - `Uint8ClampedArray` assignment does the rounding and the 0–255 clamping, so the bodies stay
 *    free of `Math.min`/`Math.max` ladders.
 */

/** Ink used by the line pass — the warm-ink foreground, not `#000`. */
export const CHARACTER_INK_HEX = "#1b1714";

/** Default Sobel gradient threshold (0–255). Below this a gradient is texture noise, not a line. */
export const CHARACTER_EDGE_THRESHOLD = 40;

/** Default luma below which a flat-pass pixel counts as an MToon outline / ink pixel. */
export const CHARACTER_NEAR_BLACK_THRESHOLD = 48;

export interface CharacterSobelOptions {
  /** Gradient magnitude below which no ink is written. Defaults to `CHARACTER_EDGE_THRESHOLD`. */
  readonly threshold?: number;
  /** `#rrggbb` written into the RGB channels. Defaults to `CHARACTER_INK_HEX`. */
  readonly inkColor?: string;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/iu;

function assertRgba(rgba: Uint8ClampedArray, label: string): void {
  if (!(rgba instanceof Uint8ClampedArray) || rgba.length === 0 || rgba.length % 4 !== 0) {
    throw new TypeError(`${label} RGBA 버퍼가 올바르지 않습니다.`);
  }
}

function parseInk(hex: string | undefined): readonly [number, number, number] {
  const value = typeof hex === "string" && HEX_COLOR.test(hex.trim()) ? hex.trim() : CHARACTER_INK_HEX;
  const int = Number.parseInt(value.slice(1), 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/**
 * Rec.709-ish luma in 0–255, matching the integer weights the VRM texture analysis already uses
 * (`(54R + 183G + 19B) / 256`) so line extraction and texture recolor agree on "how dark is this".
 */
export function lumaOf(r: number, g: number, b: number): number {
  return Math.round((54 * r + 183 * g + 19 * b) / 256);
}

/**
 * Per-pixel `max(0, a − b)` on the colour channels.
 *
 * The alpha channel is **not** subtracted: `beauty` and `flat` share one silhouette, so a channel
 * subtraction would cancel to zero and produce an empty layer. Instead the result carries the
 * shared coverage (`min` of both alphas) scaled by the largest channel difference — a pixel that
 * did not change between the two passes stays fully transparent instead of painting black, and a
 * pixel that changed a lot is both darker and more opaque. That is what makes the difference
 * usable as a 음영(multiply) / 하이라이트(screen) layer.
 */
export function subtractClamped(a: Uint8ClampedArray, b: Uint8ClampedArray): Uint8ClampedArray {
  assertRgba(a, "차분 원본");
  assertRgba(b, "차분 대상");
  if (a.length !== b.length) throw new TypeError("차분할 두 패스의 크기가 다릅니다.");

  const out = new Uint8ClampedArray(a.length);
  for (let i = 0; i < a.length; i += 4) {
    const dr = a[i] - b[i];
    const dg = a[i + 1] - b[i + 1];
    const db = a[i + 2] - b[i + 2];
    const r = dr > 0 ? dr : 0;
    const g = dg > 0 ? dg : 0;
    const bl = db > 0 ? db : 0;
    const coverage = a[i + 3] < b[i + 3] ? a[i + 3] : b[i + 3];
    let strongest = r;
    if (g > strongest) strongest = g;
    if (bl > strongest) strongest = bl;
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = bl;
    out[i + 3] = (strongest * coverage) / 255;
  }
  return out;
}

/**
 * Alpha-and-luminance Sobel over a straight-alpha pass, written out as ink.
 *
 * Two gradient fields are combined with `max`: the silhouette (alpha) edge, which gives the outer
 * contour even on a flat-lit character, and the alpha-weighted luma edge, which gives the interior
 * lines (collar, hair partings, eye rims). Transparent pixels contribute luma 0, so the two fields
 * agree at the silhouette instead of fighting.
 */
export function sobelEdgeAlpha(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options: CharacterSobelOptions = {},
): Uint8ClampedArray {
  assertRgba(rgba, "에지 추출");
  if (
    !Number.isSafeInteger(width) || width < 1 ||
    !Number.isSafeInteger(height) || height < 1 ||
    rgba.length !== width * height * 4
  ) {
    throw new TypeError("에지 추출 버퍼 크기가 가로·세로와 맞지 않습니다.");
  }

  const rawThreshold = options.threshold;
  const threshold = Number.isFinite(rawThreshold) && (rawThreshold as number) > 0
    ? (rawThreshold as number)
    : CHARACTER_EDGE_THRESHOLD;
  const [inkR, inkG, inkB] = parseInk(options.inkColor);

  const pixels = width * height;
  const luma = new Uint8ClampedArray(pixels);
  const cover = new Uint8ClampedArray(pixels);
  for (let p = 0; p < pixels; p += 1) {
    const i = p * 4;
    const alpha = rgba[i + 3];
    cover[p] = alpha;
    luma[p] = (lumaOf(rgba[i], rgba[i + 1], rgba[i + 2]) * alpha) / 255;
  }

  const out = new Uint8ClampedArray(rgba.length);
  const lastX = width - 1;
  const lastY = height - 1;
  for (let y = 0; y < height; y += 1) {
    const yUp = (y > 0 ? y - 1 : 0) * width;
    const yMid = y * width;
    const yDown = (y < lastY ? y + 1 : lastY) * width;
    for (let x = 0; x < width; x += 1) {
      const xLeft = x > 0 ? x - 1 : 0;
      const xRight = x < lastX ? x + 1 : lastX;
      let magnitude = 0;
      for (let field = 0; field < 2; field += 1) {
        const source = field === 0 ? luma : cover;
        const tl = source[yUp + xLeft];
        const tm = source[yUp + x];
        const tr = source[yUp + xRight];
        const ml = source[yMid + xLeft];
        const mr = source[yMid + xRight];
        const bl = source[yDown + xLeft];
        const bm = source[yDown + x];
        const br = source[yDown + xRight];
        const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
        const gy = bl + 2 * bm + br - (tl + 2 * tm + tr);
        const value = Math.sqrt(gx * gx + gy * gy);
        if (value > magnitude) magnitude = value;
      }
      const i = (yMid + x) * 4;
      out[i] = inkR;
      out[i + 1] = inkG;
      out[i + 2] = inkB;
      out[i + 3] = magnitude > threshold ? ((magnitude - threshold) * 255) / threshold : 0;
    }
  }
  return out;
}

/**
 * Gate a pass by a mask's coverage: colour is kept, alpha becomes `alpha × mask / 255`.
 *
 * `maskAlpha` accepts either a full RGBA mask pass (the shape `alphaOnly` returns and the shape a
 * `mask-*` pass carries) or a one-byte-per-pixel coverage plane.
 */
export function maskMultiply(
  rgba: Uint8ClampedArray,
  maskAlpha: Uint8ClampedArray,
): Uint8ClampedArray {
  assertRgba(rgba, "마스크 적용");
  const pixels = rgba.length / 4;
  let stride: number;
  let offset: number;
  if (maskAlpha.length === rgba.length) {
    stride = 4;
    offset = 3;
  } else if (maskAlpha.length === pixels) {
    stride = 1;
    offset = 0;
  } else {
    throw new TypeError("마스크 크기가 원본 패스와 맞지 않습니다.");
  }

  const out = new Uint8ClampedArray(rgba.length);
  for (let p = 0; p < pixels; p += 1) {
    const i = p * 4;
    out[i] = rgba[i];
    out[i + 1] = rgba[i + 1];
    out[i + 2] = rgba[i + 2];
    out[i + 3] = (rgba[i + 3] * maskAlpha[p * stride + offset]) / 255;
  }
  return out;
}

/**
 * Discard colour, keep coverage: a white matte with the source alpha. This is the shape every
 * `mask-*` pass carries, so a mask opened on its own reads as a plain silhouette.
 */
export function alphaOnly(rgba: Uint8ClampedArray): Uint8ClampedArray {
  assertRgba(rgba, "알파 추출");
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    out[i] = 255;
    out[i + 1] = 255;
    out[i + 2] = 255;
    out[i + 3] = rgba[i + 3];
  }
  return out;
}

/**
 * Keep only the pixels darker than `threshold` (their own colour, their own coverage). On the flat
 * pass those are the MToon outline draws, which no luminance gradient can recover once shading is
 * neutralised — the line pass unions them back in.
 */
export function nearBlackAlpha(
  rgba: Uint8ClampedArray,
  threshold: number = CHARACTER_NEAR_BLACK_THRESHOLD,
): Uint8ClampedArray {
  assertRgba(rgba, "암부 추출");
  const limit = Number.isFinite(threshold) ? threshold : CHARACTER_NEAR_BLACK_THRESHOLD;
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3];
    if (alpha === 0) continue;
    if (lumaOf(rgba[i], rgba[i + 1], rgba[i + 2]) > limit) continue;
    out[i] = rgba[i];
    out[i + 1] = rgba[i + 1];
    out[i + 2] = rgba[i + 2];
    out[i + 3] = alpha;
  }
  return out;
}

/**
 * Merge two coverage passes: `base`'s colour with the per-pixel maximum coverage. Used to fold the
 * near-black outline pixels into the Sobel line pass without repainting them a second ink colour.
 */
export function unionAlpha(
  base: Uint8ClampedArray,
  addition: Uint8ClampedArray,
): Uint8ClampedArray {
  assertRgba(base, "합집합 원본");
  assertRgba(addition, "합집합 대상");
  if (base.length !== addition.length) throw new TypeError("합칠 두 패스의 크기가 다릅니다.");

  const out = new Uint8ClampedArray(base.length);
  for (let i = 0; i < base.length; i += 4) {
    out[i] = base[i];
    out[i + 1] = base[i + 1];
    out[i + 2] = base[i + 2];
    out[i + 3] = base[i + 3] > addition[i + 3] ? base[i + 3] : addition[i + 3];
  }
  return out;
}

/** `true` when nothing is visible — the caller records an honest skip instead of a blank layer. */
export function isEmptyPass(rgba: Uint8ClampedArray): boolean {
  if (!(rgba instanceof Uint8ClampedArray) || rgba.length === 0) return true;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] > 0) return false;
  }
  return true;
}
