/**
 * DOM/canvas/three와 무관한 VRM baseColor 페인트 통 영역 계산 코어.
 *
 * 입력은 straight-alpha RGBA8이지만 색 거리는 premultiplied RGBA 공간에서 계산한다. 따라서
 * 완전히 투명한 텍셀의 보이지 않는 RGB 쓰레기 값은 영역 경계가 되지 않는다. 결과 마스크는
 * 텍셀당 1비트이며 각 바이트의 가장 낮은 비트부터 채운다(LSB-first).
 */

import {
  STUDIO_VRM_TEXTURE_MAX_DIMENSION,
  STUDIO_VRM_TEXTURE_MAX_TEXELS,
} from "./studio-vrm-texture-uv";

export type StudioVrmTextureFillScope = "contiguous" | "whole-material";

export interface StudioVrmTextureFillSeed {
  readonly x: number;
  readonly y: number;
}

export interface StudioVrmTextureFillRequest {
  /** Tightly packed, straight-alpha RGBA8 pixels. This buffer is never mutated. */
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly seed: StudioVrmTextureFillSeed;
  /** Premultiplied RGBA RMS distance threshold, inclusive, in the range 0..255. */
  readonly tolerance: number;
  readonly scope: StudioVrmTextureFillScope;
}

export interface StudioVrmTextureFillBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type StudioVrmTextureFillRgba = readonly [
  red: number,
  green: number,
  blue: number,
  alpha: number,
];

export interface StudioVrmTextureFillResult {
  /** One bit per texel, row-major and LSB-first within each byte. */
  readonly bitMask: Uint8Array;
  readonly bounds: StudioVrmTextureFillBounds | null;
  readonly matchedCount: number;
  /** Exact straight-alpha bytes stored at the requested seed texel. */
  readonly seedRgba: StudioVrmTextureFillRgba;
}

type Checkpoint = (force?: boolean) => void;

const ABORT_CHECK_INTERVAL_MASK = 4_095;

function textureFillAbortError(): Error {
  const error = new Error("VRM 텍스처 채우기 계산을 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function assertSafeIntegerInRange(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): asserts value is number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) {
    throw new RangeError(`${label} must be a safe integer between ${minimum} and ${maximum}.`);
  }
}

function validateRequest(request: StudioVrmTextureFillRequest): {
  readonly pixelCount: number;
  readonly seedPosition: number;
} {
  if (!request || typeof request !== "object") {
    throw new TypeError("request must be a VRM texture fill request object.");
  }

  assertSafeIntegerInRange(
    request.width,
    "request.width",
    1,
    STUDIO_VRM_TEXTURE_MAX_DIMENSION,
  );
  assertSafeIntegerInRange(
    request.height,
    "request.height",
    1,
    STUDIO_VRM_TEXTURE_MAX_DIMENSION,
  );
  const pixelCount = request.width * request.height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > STUDIO_VRM_TEXTURE_MAX_TEXELS) {
    throw new RangeError(
      `request dimensions exceed the ${STUDIO_VRM_TEXTURE_MAX_TEXELS} texel safety limit.`,
    );
  }

  if (!(request.pixels instanceof Uint8ClampedArray)) {
    throw new TypeError("request.pixels must be a Uint8ClampedArray.");
  }
  const expectedByteLength = pixelCount * 4;
  if (
    !Number.isSafeInteger(expectedByteLength)
    || request.pixels.length !== expectedByteLength
  ) {
    throw new RangeError("request.pixels length must equal width * height * 4.");
  }

  if (!request.seed || typeof request.seed !== "object") {
    throw new TypeError("request.seed must be a texel coordinate object.");
  }
  assertSafeIntegerInRange(request.seed.x, "request.seed.x", 0, request.width - 1);
  assertSafeIntegerInRange(request.seed.y, "request.seed.y", 0, request.height - 1);
  assertSafeIntegerInRange(request.tolerance, "request.tolerance", 0, 255);

  if (request.scope !== "contiguous" && request.scope !== "whole-material") {
    throw new TypeError('request.scope must be "contiguous" or "whole-material".');
  }

  return {
    pixelCount,
    seedPosition: request.seed.y * request.width + request.seed.x,
  };
}

function createCheckpoint(shouldAbort: (() => boolean) | undefined): Checkpoint {
  if (shouldAbort !== undefined && typeof shouldAbort !== "function") {
    throw new TypeError("shouldAbort must be a function when supplied.");
  }
  let operations = 0;
  return (force = false) => {
    operations += 1;
    if (
      shouldAbort
      && (force || (operations & ABORT_CHECK_INTERVAL_MASK) === 0)
      && shouldAbort()
    ) {
      throw textureFillAbortError();
    }
  };
}

function isBitSet(mask: Uint8Array, position: number): boolean {
  return (mask[position >>> 3]! & (1 << (position & 7))) !== 0;
}

function setBit(mask: Uint8Array, position: number): void {
  const byteIndex = position >>> 3;
  mask[byteIndex] = mask[byteIndex]! | (1 << (position & 7));
}

function matchesSeedColor(
  pixels: Uint8ClampedArray,
  position: number,
  seedPremultiplied: StudioVrmTextureFillRgba,
  maximumDistanceSquared: number,
): boolean {
  const offset = position * 4;
  const alpha = pixels[offset + 3]!;
  const alphaScale = alpha / 255;
  const redDifference = pixels[offset]! * alphaScale - seedPremultiplied[0];
  const greenDifference = pixels[offset + 1]! * alphaScale - seedPremultiplied[1];
  const blueDifference = pixels[offset + 2]! * alphaScale - seedPremultiplied[2];
  const alphaDifference = alpha - seedPremultiplied[3];
  const distanceSquared =
    redDifference * redDifference
    + greenDifference * greenDifference
    + blueDifference * blueDifference
    + alphaDifference * alphaDifference;
  return distanceSquared <= maximumDistanceSquared;
}

function includePosition(
  mask: Uint8Array,
  position: number,
  width: number,
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  },
): void {
  setBit(mask, position);
  const x = position % width;
  const y = Math.floor(position / width);
  if (x < bounds.minX) bounds.minX = x;
  if (x > bounds.maxX) bounds.maxX = x;
  if (y < bounds.minY) bounds.minY = y;
  if (y > bounds.maxY) bounds.maxY = y;
}

/**
 * Computes an immutable, deterministic fill selection for one VRM baseColor texture.
 *
 * `contiguous` performs a four-neighbour flood fill without wrapping either texture edge. It uses
 * the returned one-bit mask as its visited set and one fixed `Uint32Array(pixelCount)` queue, so it
 * never allocates a byte-per-pixel candidate/visited array. `whole-material` performs one row-major
 * scan and does not allocate the queue.
 */
export function computeStudioVrmTextureFillMask(
  request: StudioVrmTextureFillRequest,
  shouldAbort?: () => boolean,
): StudioVrmTextureFillResult {
  const { pixelCount, seedPosition } = validateRequest(request);
  const checkpoint = createCheckpoint(shouldAbort);
  checkpoint(true);

  const seedOffset = seedPosition * 4;
  const seedRgba: StudioVrmTextureFillRgba = [
    request.pixels[seedOffset]!,
    request.pixels[seedOffset + 1]!,
    request.pixels[seedOffset + 2]!,
    request.pixels[seedOffset + 3]!,
  ];
  const seedAlphaScale = seedRgba[3] / 255;
  const seedPremultiplied: StudioVrmTextureFillRgba = [
    seedRgba[0] * seedAlphaScale,
    seedRgba[1] * seedAlphaScale,
    seedRgba[2] * seedAlphaScale,
    seedRgba[3],
  ];
  const maximumDistanceSquared = request.tolerance * request.tolerance * 4;
  const bitMask = new Uint8Array(Math.ceil(pixelCount / 8));
  const bounds = {
    minX: request.width,
    minY: request.height,
    maxX: -1,
    maxY: -1,
  };
  let matchedCount = 0;

  if (request.scope === "whole-material") {
    for (let position = 0; position < pixelCount; position++) {
      checkpoint();
      if (
        !matchesSeedColor(
          request.pixels,
          position,
          seedPremultiplied,
          maximumDistanceSquared,
        )
      ) {
        continue;
      }
      includePosition(bitMask, position, request.width, bounds);
      matchedCount += 1;
    }
  } else {
    const queue = new Uint32Array(pixelCount);
    includePosition(bitMask, seedPosition, request.width, bounds);
    queue[0] = seedPosition;
    let head = 0;
    let tail = 1;
    matchedCount = 1;

    const enqueueIfMatching = (position: number): void => {
      if (isBitSet(bitMask, position)) return;
      if (
        !matchesSeedColor(
          request.pixels,
          position,
          seedPremultiplied,
          maximumDistanceSquared,
        )
      ) {
        return;
      }
      includePosition(bitMask, position, request.width, bounds);
      queue[tail] = position;
      tail += 1;
      matchedCount += 1;
    };

    while (head < tail) {
      checkpoint();
      const position = queue[head]!;
      head += 1;
      const x = position % request.width;
      if (x > 0) enqueueIfMatching(position - 1);
      if (x + 1 < request.width) enqueueIfMatching(position + 1);
      if (position >= request.width) enqueueIfMatching(position - request.width);
      if (position + request.width < pixelCount) enqueueIfMatching(position + request.width);
    }
  }

  checkpoint(true);
  return {
    bitMask,
    bounds: matchedCount === 0
      ? null
      : {
          x: bounds.minX,
          y: bounds.minY,
          width: bounds.maxX - bounds.minX + 1,
          height: bounds.maxY - bounds.minY + 1,
        },
    matchedCount,
    seedRgba,
  };
}
