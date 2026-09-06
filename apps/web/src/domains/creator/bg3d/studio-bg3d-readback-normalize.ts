/** Pure row-stride/Y-axis normalization shared by future WebGPU and current GPU readback tests. */

import { STUDIO_BG3D_LT_RENDER_MAX_PIXELS } from "./studio-bg3d-lt-render";

export interface NormalizeStudioBg3dRgbaReadbackInput {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array | Uint8ClampedArray;
  /** Bytes between source row starts. Omit to infer tight or WebGPU's 256-byte alignment. */
  readonly rowStrideBytes?: number;
  /** Set when the source begins with the framebuffer's bottom row. */
  readonly flipY?: boolean;
}

function assertShape(input: NormalizeStudioBg3dRgbaReadbackInput): number {
  if (!input || typeof input !== "object") throw new TypeError("3D RGBA readback input must be an object.");
  const { width, height } = input;
  if (!Number.isSafeInteger(width) || width < 1) {
    throw new RangeError("3D RGBA readback width must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(height) || height < 1) {
    throw new RangeError("3D RGBA readback height must be a positive safe integer.");
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > STUDIO_BG3D_LT_RENDER_MAX_PIXELS) {
    throw new RangeError("3D RGBA readback exceeds the raster pixel budget.");
  }
  if (!(input.rgba instanceof Uint8Array || input.rgba instanceof Uint8ClampedArray)) {
    throw new TypeError("3D RGBA readback must use an 8-bit typed array.");
  }
  if (input.flipY !== undefined && typeof input.flipY !== "boolean") {
    throw new TypeError("3D RGBA readback flipY must be a boolean when provided.");
  }
  return pixels;
}

function resolveRowStride(input: NormalizeStudioBg3dRgbaReadbackInput, tightRowBytes: number): number {
  if (input.rowStrideBytes !== undefined) {
    if (!Number.isSafeInteger(input.rowStrideBytes) || input.rowStrideBytes < tightRowBytes) {
      throw new RangeError("3D RGBA readback row stride must fit one tightly packed row.");
    }
    return input.rowStrideBytes;
  }
  if (input.rgba.length === tightRowBytes * input.height) return tightRowBytes;
  const webgpuStride = Math.ceil(tightRowBytes / 256) * 256;
  const webgpuLength = (input.height - 1) * webgpuStride + tightRowBytes;
  if (input.rgba.length === webgpuLength) return webgpuStride;
  throw new RangeError("3D RGBA readback layout is neither tightly packed nor WebGPU-aligned.");
}

/** Returns fresh, tightly packed, top-down RGBA bytes. */
export function normalizeStudioBg3dRgbaReadback(
  input: NormalizeStudioBg3dRgbaReadbackInput
): Uint8ClampedArray {
  const pixels = assertShape(input);
  const tightRowBytes = input.width * 4;
  const rowStrideBytes = resolveRowStride(input, tightRowBytes);
  const expectedLength = (input.height - 1) * rowStrideBytes + tightRowBytes;
  if (input.rgba.length !== expectedLength) {
    throw new RangeError("3D RGBA readback length does not match its row stride and dimensions.");
  }

  const packed = new Uint8ClampedArray(pixels * 4);
  for (let targetY = 0; targetY < input.height; targetY += 1) {
    const sourceY = input.flipY ? input.height - 1 - targetY : targetY;
    const sourceOffset = sourceY * rowStrideBytes;
    packed.set(input.rgba.subarray(sourceOffset, sourceOffset + tightRowBytes), targetY * tightRowBytes);
  }
  return packed;
}
