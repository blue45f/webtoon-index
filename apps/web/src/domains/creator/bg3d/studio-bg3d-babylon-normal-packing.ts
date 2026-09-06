/**
 * Converts Babylon's renderer-owned RGBA normal readback into the renderer-neutral Studio
 * octahedral RG8 profile. No Babylon object or GPU handle crosses this module.
 */

export type StudioBg3dBabylonNormalReadback = Uint8Array | Float32Array;

export interface PackStudioBg3dBabylonNormalsInput {
  readonly data: StudioBg3dBabylonNormalReadback;
  readonly width: number;
  readonly height: number;
  /** Babylon reports whether the G-buffer stores normal components in [0, 1] or [-1, 1]. */
  readonly unsigned: boolean;
  /** WebGL readback is bottom-up; WebGPU/normalized test fixtures are already top-down. */
  readonly flipY: boolean;
  /** Only set when the actual backend readback format is BGRA rather than RGBA. */
  readonly swapRedBlue: boolean;
  /**
   * Optional top-down normalized depth. Far-plane pixels receive a deterministic +Z normal so
   * background clear values can never create false outline noise.
   */
  readonly depth?: Float32Array;
}

export type StudioBg3dBabylonNormalPackingErrorCode =
  | "invalid-dimensions"
  | "invalid-readback";

export class StudioBg3dBabylonNormalPackingError extends Error {
  constructor(readonly code: StudioBg3dBabylonNormalPackingErrorCode) {
    super(`Studio Babylon normal packing failed: ${code}`);
    this.name = "StudioBg3dBabylonNormalPackingError";
  }
}

const MAX_PIXELS = 16_777_216;
const COMPONENT_EPSILON = 1e-4;
const NORMAL_EPSILON = 1e-8;

function fail(code: StudioBg3dBabylonNormalPackingErrorCode): never {
  throw new StudioBg3dBabylonNormalPackingError(code);
}

function boundedPixels(width: number, height: number): number {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return fail("invalid-dimensions");
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_PIXELS) {
    return fail("invalid-dimensions");
  }
  return pixels;
}

function sourceComponent(
  data: StudioBg3dBabylonNormalReadback,
  offset: number,
  unsigned: boolean,
): number {
  const raw = data[offset]!;
  const normalized = data instanceof Uint8Array ? raw / 255 : raw;
  if (!Number.isFinite(normalized)) return fail("invalid-readback");
  if (unsigned) {
    if (normalized < -COMPONENT_EPSILON || normalized > 1 + COMPONENT_EPSILON) {
      return fail("invalid-readback");
    }
    return Math.max(-1, Math.min(1, normalized * 2 - 1));
  }
  if (normalized < -1 - COMPONENT_EPSILON || normalized > 1 + COMPONENT_EPSILON) {
    return fail("invalid-readback");
  }
  return Math.max(-1, Math.min(1, normalized));
}

function packSignedUnit(value: number): number {
  return Math.round((Math.max(-1, Math.min(1, value)) * 0.5 + 0.5) * 255);
}

function packOctahedralNormal(
  target: Uint8Array,
  targetOffset: number,
  xValue: number,
  yValue: number,
  zValue: number,
): void {
  const length = Math.hypot(xValue, yValue, zValue);
  let x = length > NORMAL_EPSILON ? xValue / length : 0;
  let y = length > NORMAL_EPSILON ? yValue / length : 0;
  let z = length > NORMAL_EPSILON ? zValue / length : 1;
  const denominator = Math.abs(x) + Math.abs(y) + Math.abs(z);
  if (denominator <= NORMAL_EPSILON) {
    x = 0;
    y = 0;
    z = 1;
  } else {
    x /= denominator;
    y /= denominator;
    z /= denominator;
  }
  if (z < 0) {
    const previousX = x;
    x = (1 - Math.abs(y)) * (previousX < 0 ? -1 : 1);
    y = (1 - Math.abs(previousX)) * (y < 0 ? -1 : 1);
  }
  target[targetOffset] = packSignedUnit(x);
  target[targetOffset + 1] = packSignedUnit(y);
}

export function packStudioBg3dBabylonNormals(
  input: PackStudioBg3dBabylonNormalsInput,
): Uint8Array {
  const pixels = boundedPixels(input.width, input.height);
  if (
    !(input.data instanceof Uint8Array || input.data instanceof Float32Array) ||
    Object.getPrototypeOf(input.data) !== (
      input.data instanceof Uint8Array
        ? Uint8Array.prototype
        : Float32Array.prototype
    ) ||
    (input.data instanceof Uint8Array && !input.unsigned) ||
    input.data.length !== pixels * 4 ||
    (
      input.depth !== undefined &&
      (
        !(input.depth instanceof Float32Array) ||
        Object.getPrototypeOf(input.depth) !== Float32Array.prototype ||
        input.depth.length !== pixels
      )
    )
  ) {
    return fail("invalid-readback");
  }

  if (input.depth) {
    for (const value of input.depth) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        return fail("invalid-readback");
      }
    }
  }

  const packed = new Uint8Array(pixels * 2);
  const depth = input.depth;
  for (let targetY = 0; targetY < input.height; targetY += 1) {
    const sourceY = input.flipY ? input.height - targetY - 1 : targetY;
    for (let x = 0; x < input.width; x += 1) {
      const targetPixel = targetY * input.width + x;
      const targetOffset = targetPixel * 2;
      if (depth && depth[targetPixel] === 1) {
        packOctahedralNormal(packed, targetOffset, 0, 0, 1);
        continue;
      }
      const sourceOffset = (sourceY * input.width + x) * 4;
      const redOffset = input.swapRedBlue ? sourceOffset + 2 : sourceOffset;
      const blueOffset = input.swapRedBlue ? sourceOffset : sourceOffset + 2;
      packOctahedralNormal(
        packed,
        targetOffset,
        sourceComponent(input.data, redOffset, input.unsigned),
        sourceComponent(input.data, sourceOffset + 1, input.unsigned),
        sourceComponent(input.data, blueOffset, input.unsigned),
      );
    }
  }
  return packed;
}
