import type { StudioBg3dVec3 } from "./studio-bg3d-scene-document";

/**
 * Direction components use the same persistence boundary as SceneDocument lighting.
 * Values outside this range are clamped before unit-vector normalization.
 */
export const STUDIO_BG3D_LIGHT_DIRECTION_COMPONENT_MIN = -1_000;
export const STUDIO_BG3D_LIGHT_DIRECTION_COMPONENT_MAX = 1_000;

/** Canonical editor range. 0° points along +Z and positive angles rotate toward +X. */
export const STUDIO_BG3D_LIGHT_AZIMUTH_MIN_DEG = -180;
export const STUDIO_BG3D_LIGHT_AZIMUTH_MAX_DEG = 180;
export const STUDIO_BG3D_LIGHT_ELEVATION_MIN_DEG = -90;
export const STUDIO_BG3D_LIGHT_ELEVATION_MAX_DEG = 90;

/**
 * Mirrors the SceneDocument directional-light contract:
 * a unit vector from the lit subject toward the light.
 */
export const DEFAULT_STUDIO_BG3D_LIGHT_DIRECTION: StudioBg3dVec3 = Object.freeze([0, 0, 1]);

export interface StudioBg3dLightAngles {
  readonly azimuthDeg: number;
  readonly elevationDeg: number;
}

export const DEFAULT_STUDIO_BG3D_LIGHT_ANGLES: StudioBg3dLightAngles = Object.freeze({
  azimuthDeg: 0,
  elevationDeg: 0,
});

const DIRECTION_DEGENERATE_LENGTH = 0.000_001;
const DIRECTION_UNIT_TOLERANCE = 1e-12;
const POLE_HORIZONTAL_TOLERANCE = 1e-12;
const ZERO_TOLERANCE = 1e-15;
const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;

function clampFinite(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const finiteValue = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(maximum, Math.max(minimum, finiteValue));
}

function canonicalZero(value: number): number {
  return Math.abs(value) <= ZERO_TOLERANCE ? 0 : value;
}

function isThreeComponentArray(value: unknown): value is readonly [unknown, unknown, unknown] {
  return Array.isArray(value) && value.length === 3;
}

function boundedDirectionComponents(
  value: unknown,
  fallback: StudioBg3dVec3,
): StudioBg3dVec3 {
  if (!isThreeComponentArray(value)) return [...fallback] as StudioBg3dVec3;
  return [
    clampFinite(
      value[0],
      fallback[0],
      STUDIO_BG3D_LIGHT_DIRECTION_COMPONENT_MIN,
      STUDIO_BG3D_LIGHT_DIRECTION_COMPONENT_MAX,
    ),
    clampFinite(
      value[1],
      fallback[1],
      STUDIO_BG3D_LIGHT_DIRECTION_COMPONENT_MIN,
      STUDIO_BG3D_LIGHT_DIRECTION_COMPONENT_MAX,
    ),
    clampFinite(
      value[2],
      fallback[2],
      STUDIO_BG3D_LIGHT_DIRECTION_COMPONENT_MIN,
      STUDIO_BG3D_LIGHT_DIRECTION_COMPONENT_MAX,
    ),
  ];
}

function unitVectorOrNull(direction: StudioBg3dVec3): StudioBg3dVec3 | null {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!Number.isFinite(length) || length < DIRECTION_DEGENERATE_LENGTH) return null;

  if (Math.abs(length - 1) <= DIRECTION_UNIT_TOLERANCE) {
    return [
      canonicalZero(direction[0]),
      canonicalZero(direction[1]),
      canonicalZero(direction[2]),
    ];
  }

  return [
    canonicalZero(direction[0] / length),
    canonicalZero(direction[1] / length),
    canonicalZero(direction[2] / length),
  ];
}

/**
 * Converts any persistence/UI boundary value into a finite unit direction.
 *
 * Component clamping, the degenerate-vector threshold, and the near-unit tolerance intentionally
 * match `studio-bg3d-scene-document.ts`. A malformed fallback ultimately resolves to +Z.
 */
export function normalizeStudioBg3dLightDirection(
  value: unknown,
  fallback: StudioBg3dVec3 = DEFAULT_STUDIO_BG3D_LIGHT_DIRECTION,
): StudioBg3dVec3 {
  const boundedFallback = boundedDirectionComponents(fallback, DEFAULT_STUDIO_BG3D_LIGHT_DIRECTION);
  const normalizedFallback =
    unitVectorOrNull(boundedFallback) ?? DEFAULT_STUDIO_BG3D_LIGHT_DIRECTION;
  const boundedDirection = boundedDirectionComponents(value, boundedFallback);
  return unitVectorOrNull(boundedDirection) ?? normalizedFallback;
}

/**
 * Clamps editable spherical controls to their canonical UI range.
 *
 * Azimuth is clamped rather than wrapped so an in-progress numeric input does not jump across the
 * -180°/180° seam. Direction-to-angle conversion always returns this same canonical range.
 */
export function clampStudioBg3dLightAngles(
  value: Partial<StudioBg3dLightAngles> | null | undefined,
  fallback: StudioBg3dLightAngles = DEFAULT_STUDIO_BG3D_LIGHT_ANGLES,
): StudioBg3dLightAngles {
  const safeFallbackAzimuth = clampFinite(
    fallback.azimuthDeg,
    DEFAULT_STUDIO_BG3D_LIGHT_ANGLES.azimuthDeg,
    STUDIO_BG3D_LIGHT_AZIMUTH_MIN_DEG,
    STUDIO_BG3D_LIGHT_AZIMUTH_MAX_DEG,
  );
  const safeFallbackElevation = clampFinite(
    fallback.elevationDeg,
    DEFAULT_STUDIO_BG3D_LIGHT_ANGLES.elevationDeg,
    STUDIO_BG3D_LIGHT_ELEVATION_MIN_DEG,
    STUDIO_BG3D_LIGHT_ELEVATION_MAX_DEG,
  );

  return {
    azimuthDeg: canonicalZero(
      clampFinite(
        value?.azimuthDeg,
        safeFallbackAzimuth,
        STUDIO_BG3D_LIGHT_AZIMUTH_MIN_DEG,
        STUDIO_BG3D_LIGHT_AZIMUTH_MAX_DEG,
      ),
    ),
    elevationDeg: canonicalZero(
      clampFinite(
        value?.elevationDeg,
        safeFallbackElevation,
        STUDIO_BG3D_LIGHT_ELEVATION_MIN_DEG,
        STUDIO_BG3D_LIGHT_ELEVATION_MAX_DEG,
      ),
    ),
  };
}

/**
 * Converts editor angles to the SceneDocument light-direction convention.
 *
 * - azimuth 0° / elevation 0° → +Z
 * - azimuth 90° / elevation 0° → +X
 * - elevation 90° → +Y
 */
export function studioBg3dLightAnglesToDirection(
  value: Partial<StudioBg3dLightAngles> | null | undefined,
  fallback: StudioBg3dLightAngles = DEFAULT_STUDIO_BG3D_LIGHT_ANGLES,
): StudioBg3dVec3 {
  const angles = clampStudioBg3dLightAngles(value, fallback);
  const azimuth = angles.azimuthDeg * DEGREES_TO_RADIANS;
  const elevation = angles.elevationDeg * DEGREES_TO_RADIANS;
  const horizontal = Math.cos(elevation);

  return normalizeStudioBg3dLightDirection([
    canonicalZero(Math.sin(azimuth) * horizontal),
    canonicalZero(Math.sin(elevation)),
    canonicalZero(Math.cos(azimuth) * horizontal),
  ]);
}

/**
 * Converts a SceneDocument light direction to canonical editor angles.
 *
 * At the vertical poles azimuth has no geometric meaning, so the caller's fallback azimuth is
 * retained. This prevents a light handle from snapping horizontally while crossing the zenith.
 */
export function studioBg3dLightDirectionToAngles(
  value: unknown,
  fallback: StudioBg3dLightAngles = DEFAULT_STUDIO_BG3D_LIGHT_ANGLES,
): StudioBg3dLightAngles {
  const safeFallback = clampStudioBg3dLightAngles(undefined, fallback);
  const fallbackDirection = studioBg3dLightAnglesToDirection(safeFallback);
  const direction = normalizeStudioBg3dLightDirection(value, fallbackDirection);
  const horizontalLength = Math.hypot(direction[0], direction[2]);
  const rawAzimuth =
    horizontalLength <= POLE_HORIZONTAL_TOLERANCE
      ? safeFallback.azimuthDeg
      : Math.atan2(direction[0], direction[2]) * RADIANS_TO_DEGREES;
  const rawElevation = Math.atan2(direction[1], horizontalLength) * RADIANS_TO_DEGREES;

  return clampStudioBg3dLightAngles({
    azimuthDeg:
      Math.abs(Math.abs(rawAzimuth) - 180) <= DIRECTION_UNIT_TOLERANCE
        ? STUDIO_BG3D_LIGHT_AZIMUTH_MAX_DEG
        : rawAzimuth,
    elevationDeg: rawElevation,
  }, safeFallback);
}
