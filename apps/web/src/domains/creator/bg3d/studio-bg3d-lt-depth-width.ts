/**
 * Per-pixel LT line width field driven by normalized depth.
 *
 * Convention: depth 0 = near (camera), depth 1 = far. Nearer samples receive thicker strokes when
 * `nearBoost` is positive. Pure typed-array math — no DOM, no engine, deterministic.
 */

export const STUDIO_BG3D_LT_DEPTH_WIDTH_MAX_PIXELS = 8_388_608;

export interface StudioBg3dLtDepthWidthFieldInput {
  readonly width: number;
  readonly height: number;
  /** Normalized depth 0..1, row-major, length width*height. depth 0 = near. */
  readonly depth: Float32Array | readonly number[];
  readonly baseWidthPx: number;
  readonly minWidthPx: number;
  readonly maxWidthPx: number;
  /**
   * Extra pixels added at depth 0 (near). Far (depth 1) uses only baseWidthPx.
   * Formula: clamp(baseWidthPx + nearBoost * (1 - depth), minWidthPx, maxWidthPx).
   */
  readonly nearBoost?: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function failClosed(): null {
  return null;
}

/**
 * Builds a fresh Float32Array of per-pixel stroke width in pixels.
 * Returns null on empty, mismatched, or non-finite input (fail closed).
 */
export function buildStudioBg3dLtDepthWidthField(
  input: StudioBg3dLtDepthWidthFieldInput,
): Float32Array | null {
  if (typeof input !== "object" || input === null) return failClosed();
  const { width, height, depth, baseWidthPx, minWidthPx, maxWidthPx } = input;
  if (
    !Number.isSafeInteger(width) || width < 1 ||
    !Number.isSafeInteger(height) || height < 1
  ) {
    return failClosed();
  }
  const pixelCount = width * height;
  if (
    !Number.isSafeInteger(pixelCount) ||
    pixelCount < 1 ||
    pixelCount > STUDIO_BG3D_LT_DEPTH_WIDTH_MAX_PIXELS
  ) {
    return failClosed();
  }
  if (
    depth == null ||
    typeof depth !== "object" ||
    !("length" in depth) ||
    depth.length !== pixelCount
  ) {
    return failClosed();
  }
  if (
    !isFiniteNumber(baseWidthPx) ||
    !isFiniteNumber(minWidthPx) ||
    !isFiniteNumber(maxWidthPx) ||
    minWidthPx < 0 ||
    maxWidthPx < minWidthPx
  ) {
    return failClosed();
  }
  const nearBoost = input.nearBoost ?? 0;
  if (!isFiniteNumber(nearBoost)) return failClosed();

  const field = new Float32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const sample = depth[index];
    if (!isFiniteNumber(sample) || sample < 0 || sample > 1) return failClosed();
    // depth 0 (near) → thicker when nearBoost > 0; depth 1 (far) → base only.
    const raw = baseWidthPx + nearBoost * (1 - sample);
    if (!Number.isFinite(raw)) return failClosed();
    field[index] = Math.min(maxWidthPx, Math.max(minWidthPx, raw));
  }
  return field;
}

/**
 * Optional thin helper: max-expand an LT response using a uniform radius derived from the mean
 * of the width field (keeps the existing separable expand contract without per-pixel dilation).
 * Returns a fresh Uint8ClampedArray, or null on size/shape failure.
 */
export function expandStudioBg3dLtResponseWithWidthField(
  response: Uint8ClampedArray | readonly number[],
  widthField: Float32Array | readonly number[],
  width: number,
  height: number,
): Uint8ClampedArray | null {
  if (
    !Number.isSafeInteger(width) || width < 1 ||
    !Number.isSafeInteger(height) || height < 1
  ) {
    return null;
  }
  const pixelCount = width * height;
  if (
    !Number.isSafeInteger(pixelCount) ||
    response == null ||
    widthField == null ||
    typeof response !== "object" ||
    typeof widthField !== "object" ||
    !("length" in response) ||
    !("length" in widthField) ||
    response.length !== pixelCount ||
    widthField.length !== pixelCount
  ) {
    return null;
  }

  let sum = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const sample = widthField[index];
    if (!isFiniteNumber(sample) || sample < 0) return null;
    sum += sample;
  }
  const meanWidth = sum / pixelCount;
  if (!Number.isFinite(meanWidth)) return null;
  // Match LT renderer's lineWidthRadius: ceil((widthPx - 1) / 2), capped at 4.
  const radius = Math.min(4, Math.max(0, Math.ceil((meanWidth - 1) / 2)));

  const source = response instanceof Uint8ClampedArray
    ? response
    : Uint8ClampedArray.from(response);
  if (radius < 1) return new Uint8ClampedArray(source);

  const horizontal = new Uint8ClampedArray(pixelCount);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let maximum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleX = Math.min(width - 1, Math.max(0, x + offset));
        maximum = Math.max(maximum, source[row + sampleX]!);
      }
      horizontal[row + x] = maximum;
    }
  }

  const output = new Uint8ClampedArray(pixelCount);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let maximum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleY = Math.min(height - 1, Math.max(0, y + offset));
        maximum = Math.max(maximum, horizontal[sampleY * width + x]!);
      }
      output[y * width + x] = maximum;
    }
  }
  return output;
}
