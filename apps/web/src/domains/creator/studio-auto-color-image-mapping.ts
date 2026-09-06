/**
 * Pure document-canvas → decoded-image coordinate mapping for auto-color seed placement.
 *
 * Konva convention (with the offset and skew left at their default zero values):
 *
 *   canvasPoint = T(x, y) · R(rotation) · S(scaleX, scaleY) · localPoint
 *
 * `width`/`height` describe the node-local image rectangle. Negative scales therefore mirror
 * around the node-local origin, exactly like Konva; callers that want a flip within the same
 * visual bounds must supply the correspondingly translated Konva x/y origin.
 */

export const STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_COORDINATE = 10_000_000;
export const STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_SOURCE_DIMENSION = 131_072;
export const STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_SCALE = 1_000_000;
export const STUDIO_AUTO_COLOR_IMAGE_MAPPING_MIN_ABS_SCALE = 1e-9;
export const STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_ROTATION = 1_000_000_000;

const SOURCE_EDGE_EPSILON = 1e-6;
const MIN_NORMALIZED_BOUNDARY_EPSILON = 1e-12;
const MAX_NORMALIZED_BOUNDARY_EPSILON = 1e-7;
const FLOAT_ERROR_MULTIPLIER = 64;
const QUADRANT_SNAP_EPSILON_DEGREES = 1e-10;

export interface StudioAutoColorImageTransform {
  /** Konva node origin in document-canvas coordinates. */
  readonly x: number;
  readonly y: number;
  /** Positive node-local image dimensions before scale is applied. */
  readonly width: number;
  readonly height: number;
  /** Konva scale; omitted values default to 1. Negative values are origin-based flips. */
  readonly scaleX?: number;
  readonly scaleY?: number;
  /** Clockwise visual degrees in the canvas coordinate system; omitted value defaults to 0. */
  readonly rotation?: number;
  /** Positive integer dimensions of the decoded/planner source image. */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

export interface StudioAutoColorImageMappingInput {
  readonly canvasX: number;
  readonly canvasY: number;
  readonly image: StudioAutoColorImageTransform;
}

export type StudioAutoColorImageMappingResult =
  | Readonly<{
      inside: true;
      /** Continuous, addressable source-pixel coordinate; safe to truncate for pixel lookup. */
      sourceX: number;
      sourceY: number;
    }>
  | Readonly<{
      inside: false;
      /** Outside hits deliberately expose no accidentally usable pixel coordinate. */
      sourceX: null;
      sourceY: null;
    }>;

const OUTSIDE_IMAGE = Object.freeze({
  inside: false,
  sourceX: null,
  sourceY: null,
}) satisfies StudioAutoColorImageMappingResult;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataValue(
  value: Record<string, unknown>,
  key: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) return undefined;
  return descriptor.value;
}

function finiteOwnNumber(
  value: Record<string, unknown>,
  key: string,
  fallback?: number,
): number | null {
  const candidate = ownDataValue(value, key);
  if (candidate === undefined && fallback !== undefined) return fallback;
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : null;
}

function withinAbsBudget(value: number, maximum: number): boolean {
  return Math.abs(value) <= maximum;
}

function normalizeRotationDegrees(rotation: number): number {
  const wrapped = ((rotation % 360) + 360) % 360;
  const nearestQuadrant = Math.round(wrapped / 90) * 90;
  if (Math.abs(wrapped - nearestQuadrant) <= QUADRANT_SNAP_EPSILON_DEGREES) {
    return nearestQuadrant === 360 ? 0 : nearestQuadrant;
  }
  return wrapped;
}

function rotationComponents(rotation: number): Readonly<{ cos: number; sin: number }> {
  if (rotation === 0) return Object.freeze({ cos: 1, sin: 0 });
  if (rotation === 90) return Object.freeze({ cos: 0, sin: 1 });
  if (rotation === 180) return Object.freeze({ cos: -1, sin: 0 });
  if (rotation === 270) return Object.freeze({ cos: 0, sin: -1 });
  const radians = rotation * Math.PI / 180;
  return Object.freeze({ cos: Math.cos(radians), sin: Math.sin(radians) });
}

function stableNormalizedBoundaryEpsilon(input: {
  readonly coordinateMagnitude: number;
  readonly localDimension: number;
  readonly scale: number;
}): number | null {
  const normalizedError = (
    input.coordinateMagnitude
    * Number.EPSILON
    * FLOAT_ERROR_MULTIPLIER
    / (Math.abs(input.scale) * input.localDimension)
  );
  if (!Number.isFinite(normalizedError) || normalizedError > MAX_NORMALIZED_BOUNDARY_EPSILON) {
    return null;
  }
  return Math.max(MIN_NORMALIZED_BOUNDARY_EPSILON, normalizedError);
}

function transformedCornersStayBounded(input: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}): boolean {
  const corners = [
    [0, 0],
    [input.width, 0],
    [0, input.height],
    [input.width, input.height],
  ] as const;
  return corners.every(([localX, localY]) => {
    const canvasX = input.x + input.a * localX + input.c * localY;
    const canvasY = input.y + input.b * localX + input.d * localY;
    return (
      Number.isFinite(canvasX)
      && Number.isFinite(canvasY)
      && withinAbsBudget(canvasX, STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_COORDINATE)
      && withinAbsBudget(canvasY, STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_COORDINATE)
    );
  });
}

/**
 * Invert a zero-offset/zero-skew Konva image transform and map a canvas point into source pixels.
 *
 * `null` means the transform or numeric inputs are invalid/ill-conditioned. A valid transform with
 * a point outside the transformed image returns `{ inside: false, sourceX: null, sourceY: null }`.
 * Exact right/bottom edge hits retain the existing auto-color behavior by mapping just below the
 * exclusive source dimension (`sourceWidth - 1e-6`, `sourceHeight - 1e-6`).
 */
export function mapStudioAutoColorCanvasPointToSource(
  input: StudioAutoColorImageMappingInput,
): StudioAutoColorImageMappingResult | null {
  try {
    if (!isPlainRecord(input)) return null;
    const canvasX = finiteOwnNumber(input, "canvasX");
    const canvasY = finiteOwnNumber(input, "canvasY");
    const imageValue = ownDataValue(input, "image");
    if (
      canvasX === null
      || canvasY === null
      || !withinAbsBudget(canvasX, STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_COORDINATE)
      || !withinAbsBudget(canvasY, STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_COORDINATE)
      || !isPlainRecord(imageValue)
    ) {
      return null;
    }

    const x = finiteOwnNumber(imageValue, "x");
    const y = finiteOwnNumber(imageValue, "y");
    const width = finiteOwnNumber(imageValue, "width");
    const height = finiteOwnNumber(imageValue, "height");
    const scaleX = finiteOwnNumber(imageValue, "scaleX", 1);
    const scaleY = finiteOwnNumber(imageValue, "scaleY", 1);
    const rotationInput = finiteOwnNumber(imageValue, "rotation", 0);
    const sourceWidth = finiteOwnNumber(imageValue, "sourceWidth");
    const sourceHeight = finiteOwnNumber(imageValue, "sourceHeight");
    if (
      x === null
      || y === null
      || width === null
      || height === null
      || scaleX === null
      || scaleY === null
      || rotationInput === null
      || sourceWidth === null
      || sourceHeight === null
      || !withinAbsBudget(x, STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_COORDINATE)
      || !withinAbsBudget(y, STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_COORDINATE)
      || width <= 0
      || height <= 0
      || width > STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_COORDINATE
      || height > STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_COORDINATE
      || Math.abs(scaleX) < STUDIO_AUTO_COLOR_IMAGE_MAPPING_MIN_ABS_SCALE
      || Math.abs(scaleY) < STUDIO_AUTO_COLOR_IMAGE_MAPPING_MIN_ABS_SCALE
      || Math.abs(scaleX) > STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_SCALE
      || Math.abs(scaleY) > STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_SCALE
      || !withinAbsBudget(
        rotationInput,
        STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_ROTATION,
      )
      || !Number.isSafeInteger(sourceWidth)
      || !Number.isSafeInteger(sourceHeight)
      || sourceWidth < 1
      || sourceHeight < 1
      || sourceWidth > STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_SOURCE_DIMENSION
      || sourceHeight > STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_SOURCE_DIMENSION
    ) {
      return null;
    }

    const rotation = normalizeRotationDegrees(rotationInput);
    const { cos, sin } = rotationComponents(rotation);
    // Konva's T · R · S matrix with offset=skew=0.
    const a = cos * scaleX;
    const b = sin * scaleX;
    const c = -sin * scaleY;
    const d = cos * scaleY;
    const determinant = a * d - b * c;
    if (
      ![a, b, c, d, determinant].every(Number.isFinite)
      || determinant === 0
      || !transformedCornersStayBounded({ x, y, width, height, a, b, c, d })
    ) {
      return null;
    }

    const deltaX = canvasX - x;
    const deltaY = canvasY - y;
    // [localX localY]ᵀ = (R · S)⁻¹ · ([canvasX canvasY]ᵀ - [x y]ᵀ).
    const localX = (d * deltaX - c * deltaY) / determinant;
    const localY = (-b * deltaX + a * deltaY) / determinant;
    const normalizedX = localX / width;
    const normalizedY = localY / height;
    if (![localX, localY, normalizedX, normalizedY].every(Number.isFinite)) return null;

    // Rotation couples both document axes, so each local-axis error budget must use the largest
    // magnitude from the complete translation/pointer pair rather than only its nominal axis.
    const coordinateMagnitude = Math.max(
      1,
      Math.abs(canvasX),
      Math.abs(canvasY),
      Math.abs(x),
      Math.abs(y),
    );
    const epsilonX = stableNormalizedBoundaryEpsilon({
      coordinateMagnitude,
      localDimension: width,
      scale: scaleX,
    });
    const epsilonY = stableNormalizedBoundaryEpsilon({
      coordinateMagnitude,
      localDimension: height,
      scale: scaleY,
    });
    if (epsilonX === null || epsilonY === null) return null;
    if (
      normalizedX < -epsilonX
      || normalizedX > 1 + epsilonX
      || normalizedY < -epsilonY
      || normalizedY > 1 + epsilonY
    ) {
      return OUTSIDE_IMAGE;
    }

    const boundedX = Math.min(1, Math.max(0, normalizedX));
    const boundedY = Math.min(1, Math.max(0, normalizedY));
    const sourceX = Math.min(
      sourceWidth - SOURCE_EDGE_EPSILON,
      boundedX * sourceWidth,
    );
    const sourceY = Math.min(
      sourceHeight - SOURCE_EDGE_EPSILON,
      boundedY * sourceHeight,
    );
    if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) return null;
    return Object.freeze({ inside: true, sourceX, sourceY });
  } catch {
    // Proxies and hostile property descriptors must not escape the pure mapping boundary.
    return null;
  }
}
