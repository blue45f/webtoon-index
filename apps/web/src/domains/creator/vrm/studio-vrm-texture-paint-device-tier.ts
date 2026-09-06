import {
  STUDIO_VRM_TEXTURE_PAINT_STANDARD_GEOMETRY_MAX_TRIANGLES,
  type CreateStudioVrmTexturePaintRuntimeOptions,
} from "./studio-vrm-texture-paint-runtime";

/** @deprecated Logical RGBA compatibility telemetry. Admission uses resident-byte limits below. */
export const STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_MAX_EDGE = 2_048;
/** @deprecated Logical RGBA compatibility telemetry. Admission uses resident-byte limits below. */
export const STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_RGBA_BYTES =
  STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_MAX_EDGE
  * STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_MAX_EDGE
  * 4;
export const STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_MAX_RESIDENT_BYTES = 64 * 1024 * 1024;
export const STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_MAX_HISTORY_BYTES = 8 * 1024 * 1024;
export const STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_MAX_TARGET_RESIDENT_BYTES =
  STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_MAX_RESIDENT_BYTES
  - STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_MAX_HISTORY_BYTES;
export const STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_GEOMETRY_MAX_TRIANGLES = 30_000;
export const STUDIO_VRM_TEXTURE_PAINT_NARROW_VIEWPORT_MAX_CSS_PX = 768;
export const STUDIO_VRM_TEXTURE_PAINT_LOW_MEMORY_GB = 4;

export type StudioVrmTexturePaintDeviceTier = "constrained" | "standard";

export interface StudioVrmTexturePaintEnvironmentSignals {
  readonly coarsePointer: boolean;
  readonly viewportWidthCssPixels: number | null;
  readonly deviceMemoryGb: number | null;
}

export interface StudioVrmTexturePaintDevicePlan {
  readonly tier: StudioVrmTexturePaintDeviceTier;
  readonly runtimeOptions: Readonly<Pick<
    CreateStudioVrmTexturePaintRuntimeOptions,
    | "maxAggregateResidentBytes"
    | "maxConcurrentReads"
    | "maxGeometryIndexTriangles"
    | "maxHistoryBytes"
    | "maxTargetResidentBytes"
  >>;
}

const STANDARD_PLAN: StudioVrmTexturePaintDevicePlan = Object.freeze({
  tier: "standard",
  runtimeOptions: Object.freeze({
    maxGeometryIndexTriangles: STUDIO_VRM_TEXTURE_PAINT_STANDARD_GEOMETRY_MAX_TRIANGLES,
  }),
});

const CONSTRAINED_PLAN: StudioVrmTexturePaintDevicePlan = Object.freeze({
  tier: "constrained",
  runtimeOptions: Object.freeze({
    maxTargetResidentBytes: STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_MAX_TARGET_RESIDENT_BYTES,
    maxAggregateResidentBytes: STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_MAX_RESIDENT_BYTES,
    maxConcurrentReads: 1,
    maxHistoryBytes: STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_MAX_HISTORY_BYTES,
    maxGeometryIndexTriangles: STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_GEOMETRY_MAX_TRIANGLES,
  }),
});

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Selects a fail-safe resident target budget without reading browser globals.
 *
 * A constrained device stays within a 64 MiB resident envelope, including an 8 MiB undo reserve.
 * Four conservative raster copies are charged per target, so oversized 2K/4K textures fail closed
 * before Canvas/GPU allocation. Desktop keeps the wider runtime memory defaults but still caps the
 * synchronous UV topology build.
 */
export function planStudioVrmTexturePaintDeviceTier(
  signals: StudioVrmTexturePaintEnvironmentSignals,
): StudioVrmTexturePaintDevicePlan {
  const narrowViewport =
    finiteNumber(signals.viewportWidthCssPixels)
    && signals.viewportWidthCssPixels > 0
    && signals.viewportWidthCssPixels <= STUDIO_VRM_TEXTURE_PAINT_NARROW_VIEWPORT_MAX_CSS_PX;
  const lowMemory =
    finiteNumber(signals.deviceMemoryGb)
    && signals.deviceMemoryGb < STUDIO_VRM_TEXTURE_PAINT_LOW_MEMORY_GB;
  return signals.coarsePointer || narrowViewport || lowMemory
    ? CONSTRAINED_PLAN
    : STANDARD_PLAN;
}
