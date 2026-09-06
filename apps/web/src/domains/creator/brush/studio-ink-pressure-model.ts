/**
 * Versioned pressure-to-diameter semantics for persisted ink.
 *
 * An omitted model is intentionally the historical ToonSpectrum contract. Never reinterpret an
 * existing stroke as a newer model merely because a renderer learned about one: old documents
 * depend on the 0.3 + 1.4p width factor and the quarter-pixel minimum radius.
 */

export const STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1 = "linear-full-v1" as const;
/**
 * Magma-compatible pressure and dab-placement contract.
 *
 * V1 remains frozen because its persisted strokes place an endpoint dab per source segment. V2
 * keeps the same pressure-to-diameter mapping while carrying residual brush spacing across source
 * segments, so extending a stroke can only append pixels.
 */
export const STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2 = "linear-residual-v2" as const;
/**
 * Path-faithful residual placement for new ink.
 *
 * V2 is retained verbatim for persisted-document compatibility. Its carried path distance was
 * projected onto the chord from the last dab to the newest pointer, which could place a later dab
 * across a corner. V3 consumes that distance on each actual source segment, so sample subdivision
 * cannot move a constant-pressure dab off the pointer polyline or alter an already-visible prefix.
 */
export const STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3 =
  "linear-residual-path-v3" as const;

export type StudioInkPressureModel =
  | typeof STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1
  | typeof STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2
  | typeof STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3;

export const STUDIO_INK_MAX_BRUSH_SIZE = 8_192;
export const STUDIO_INK_LEGACY_FALLBACK_PRESSURE = 0.5;
export const STUDIO_INK_LINEAR_FULL_FALLBACK_PRESSURE = 1;

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function isStudioInkPressureModel(value: unknown): value is StudioInkPressureModel {
  return value === STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1
    || value === STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2
    || value === STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3;
}

export function studioInkUsesResidualDabSpacing(model?: StudioInkPressureModel): boolean {
  return model === STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2
    || model === STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3;
}

/** Whether residual path distance must be consumed on the actual source polyline. */
export function studioInkUsesPathResidualDabSpacing(
  model?: StudioInkPressureModel
): boolean {
  return model === STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3;
}

function isLinearFullPressureModel(model?: StudioInkPressureModel): boolean {
  return model === STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1
    || model === STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2
    || model === STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3;
}

/** Missing hardware samples retain legacy 0.5, while Magma-compatible ink is full-size at 1. */
export function studioInkFallbackPressure(model?: StudioInkPressureModel): number {
  return isLinearFullPressureModel(model)
    ? STUDIO_INK_LINEAR_FULL_FALLBACK_PRESSURE
    : STUDIO_INK_LEGACY_FALLBACK_PRESSURE;
}

/** Resolves one possibly missing/non-finite persisted sample under its versioned model. */
export function resolveStudioInkPressure(
  value: unknown,
  model?: StudioInkPressureModel
): number {
  return clamp(finiteOr(value, studioInkFallbackPressure(model)), 0, 1);
}

/**
 * Aligns persisted samples to their source points before any geometry resampling.
 *
 * This distinction matters for `linear-full-v1`: a short array means that the omitted source
 * points came from a non-pressure pointer and therefore carry nominal pressure `1`. Repeating the
 * last provided value would incorrectly turn `[0]` into an invisible entire stroke.
 */
export function resolveStudioInkPressureSamples(
  pressures: readonly number[] | undefined,
  sourcePointCount: number,
  model?: StudioInkPressureModel
): number[] {
  const count = Number.isSafeInteger(sourcePointCount) && sourcePointCount > 0
    ? sourcePointCount
    : 0;
  return Array.from(
    { length: count },
    (_, index) => resolveStudioInkPressure(pressures?.[index], model)
  );
}

/**
 * Canonical document-pixel radius shared by Canvas2D, WebGPU, export, and raster publication.
 *
 * `linear-full-v1` matches Magma's default pen contract: pressure 0/0.5/1 maps to diameter
 * 0/0.5x/1x of the selected size. In particular, zero pressure has zero coverage. `undefined`
 * remains byte-for-byte compatible with the legacy GPU planner, including its 0.25px radius floor.
 */
export function studioInkPressureRadius(
  size: number,
  pressure: number,
  model?: StudioInkPressureModel
): number {
  const safeSize = clamp(finiteOr(size, 1), 0.01, STUDIO_INK_MAX_BRUSH_SIZE);
  const safePressure = clamp(finiteOr(pressure, 1), 0, 1);
  if (isLinearFullPressureModel(model)) {
    return (safeSize * safePressure) / 2;
  }
  return Math.max(0.25, (safeSize * (0.3 + safePressure * 1.4)) / 2);
}

export function studioInkPressureDiameter(
  size: number,
  pressure: number,
  model?: StudioInkPressureModel
): number {
  return studioInkPressureRadius(size, pressure, model) * 2;
}
