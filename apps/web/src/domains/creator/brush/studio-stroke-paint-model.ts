import { resolveStudioBrushRenderFamily } from "../studio-brush";

import { isStudioBrushEraserAliasId } from "./studio-brush-alias-profile";
import { resolveStudioCapturedBrushDynamicsPresetId } from "./studio-brush-dynamics";
import { isStudioInkPressureModel } from "./studio-ink-pressure-model";

/**
 * Versioned flow/opacity semantics for persisted Studio strokes.
 *
 * An omitted paint model is deliberately the historical contract: stroke opacity, flow, and
 * dab-local opacity are multiplied into every dab before it is painted directly onto the
 * destination. Existing documents must keep that behavior.
 *
 * `layered-flow-v1` is opt-in for ordinary single-colour ink and the named low-density eraser.
 * Flow and dab-local opacity build coverage on a transparent, stroke-local surface; the
 * element/stroke opacity is then applied exactly once when that surface is composited onto the
 * document. For paint this prevents overlap darkening; for the kneaded eraser it makes one gesture
 * lift a bounded amount instead of compounding the same 38% alpha at every overlapping dab.
 *
 * `bounded-flow-v2` extends the same alpha contract to versioned dynamic brushes through sparse,
 * budgeted stroke-local RGBA tiles. It is a distinct persisted value so old dynamic strokes, which
 * omitted a paint model and painted opacity into every dab, remain byte-for-byte legacy.
 */

export const STUDIO_STROKE_PAINT_MODEL_LAYERED_FLOW_V1 = "layered-flow-v1" as const;
/**
 * Dynamic-brush-only coverage contract.
 *
 * Unlike v1's single-colour compound ink path, v2 is rendered into bounded stroke-local RGBA
 * tiles. Dynamic opacity/flow, tip alpha, grain, colour dynamics and every symmetry copy build the
 * tiles first; the persisted element opacity is applied exactly once when those tiles are
 * composited. A renderer that cannot satisfy the bounded-surface contract must fail closed:
 * replaying the frozen legacy per-dab path would apply opacity repeatedly and change v2 pixels.
 */
export const STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2 = "bounded-flow-v2" as const;

export type StudioStrokePaintModel =
  | typeof STUDIO_STROKE_PAINT_MODEL_LAYERED_FLOW_V1
  | typeof STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2;

function clampAlpha(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/** Accepts only paint contracts whose persisted pixel meaning this build understands. */
export function isStudioStrokePaintModel(value: unknown): value is StudioStrokePaintModel {
  return value === STUDIO_STROKE_PAINT_MODEL_LAYERED_FLOW_V1
    || value === STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2;
}

export interface StudioStrokePaintModelCompatibilityInput {
  paintModel?: unknown;
  kind?: unknown;
  mode?: unknown;
  brush?: unknown;
  sampleSpacing?: unknown;
  pressureModel?: unknown;
  fill?: unknown;
  brushDynamics?: unknown;
  stampPipeline?: unknown;
  watercolorPipeline?: unknown;
  symmetry?: unknown;
}

function hasNonIdentitySymmetry(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== "object" || Array.isArray(value)) return true;
  const type = (value as { type?: unknown }).type;
  return type !== undefined && type !== "none";
}

export function isStudioBoundedFlowSymmetryCompatible(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as {
    type?: unknown;
    centerX?: unknown;
    centerY?: unknown;
    radialCount?: unknown;
  };
  if (source.type === undefined || source.type === "none") return true;
  if (
    source.type !== "vertical"
    && source.type !== "horizontal"
    && source.type !== "radial"
    && source.type !== "kaleidoscope"
  ) return false;
  if (
    typeof source.centerX !== "number"
    || !Number.isFinite(source.centerX)
    || typeof source.centerY !== "number"
    || !Number.isFinite(source.centerY)
  ) return false;
  if (source.type === "vertical" || source.type === "horizontal") return true;
  return typeof source.radialCount === "number"
    && Number.isInteger(source.radialCount)
    && source.radialCount >= 1
    && source.radialCount <= 32;
}

function hasCausalGeometry(input: StudioStrokePaintModelCompatibilityInput): boolean {
  return (
    typeof input.sampleSpacing === "number"
    && Number.isFinite(input.sampleSpacing)
    && input.sampleSpacing >= 0
  ) || isStudioInkPressureModel(input.pressureModel);
}

/** Dynamic-only v2 guard used by the retained Canvas renderer. */
export function isStudioBoundedFlowPaintModelCompatible(
  input: StudioStrokePaintModelCompatibilityInput
): input is StudioStrokePaintModelCompatibilityInput & {
  paintModel: typeof STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2;
} {
  if (input.paintModel !== STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2) return false;
  if ((input.kind ?? "freehand") !== "freehand" || (input.mode ?? "pen") !== "pen") return false;
  if (input.fill !== undefined && input.fill !== null) return false;
  if (input.stampPipeline !== undefined && input.stampPipeline !== null) return false;
  if (input.watercolorPipeline !== undefined && input.watercolorPipeline !== null) return false;
  if (typeof input.brushDynamics !== "object" || input.brushDynamics === null) return false;
  if (resolveStudioCapturedBrushDynamicsPresetId(input) === null) return false;
  if (!hasCausalGeometry(input)) return false;
  return isStudioBoundedFlowSymmetryCompatible(input.symmetry);
}

/**
 * Cross-field guard for every persistence and renderer boundary.
 *
 * v1 remains intentionally limited to ordinary freehand pen/marker strokes plus named erasers
 * whose catalogue contract explicitly owns low-density lifting. v2 admits only snapshotted
 * dynamic-brush presets and renderer-bounded symmetry. Generic erasers, closed fills,
 * stamp/watercolor engines and unknown combinations retain the legacy per-dab compositor.
 */
export function isStudioStrokePaintModelCompatible(
  input: StudioStrokePaintModelCompatibilityInput
): input is StudioStrokePaintModelCompatibilityInput & { paintModel: StudioStrokePaintModel } {
  if (isStudioBoundedFlowPaintModelCompatible(input)) return true;
  if (input.paintModel !== STUDIO_STROKE_PAINT_MODEL_LAYERED_FLOW_V1) return false;
  const mode = input.mode ?? "pen";
  const namedEraser = mode === "eraser" && isStudioBrushEraserAliasId(input.brush);
  if ((input.kind ?? "freehand") !== "freehand" || (mode !== "pen" && !namedEraser)) return false;
  if (input.fill !== undefined && input.fill !== null) return false;
  if (input.brushDynamics !== undefined && input.brushDynamics !== null) return false;
  if (input.stampPipeline !== undefined && input.stampPipeline !== null) return false;
  if (input.watercolorPipeline !== undefined && input.watercolorPipeline !== null) return false;
  if (hasNonIdentitySymmetry(input.symmetry)) return false;
  if (!hasCausalGeometry(input)) return false;
  if (namedEraser) return true;
  const family = resolveStudioBrushRenderFamily(input.brush ?? "pen");
  return family === "pen" || family === "marker";
}

/**
 * Source alpha deposited by one dab into a `layered-flow-v1` stroke-local surface.
 *
 * Stroke opacity is intentionally absent: applying it here would restore the legacy darkening
 * bug when translucent dabs overlap. Each input is bounded independently before multiplication.
 */
export function resolveStudioLayeredFlowDepositionAlpha(
  flow: unknown,
  dabOpacity: unknown = 1,
): number {
  return clampAlpha(flow) * clampAlpha(dabOpacity);
}

/** Applies stroke opacity once to already accumulated stroke-local coverage. */
export function resolveStudioLayeredFlowFinalAlpha(
  strokeOpacity: unknown,
  depositedCoverage: unknown,
): number {
  return clampAlpha(strokeOpacity) * clampAlpha(depositedCoverage);
}

/**
 * Frozen legacy source alpha for one dab painted directly onto the destination.
 *
 * This is an explicit compatibility oracle, not the default for newly authored layered strokes.
 */
export function resolveStudioLegacyPerDabAlpha(
  strokeOpacity: unknown,
  flow: unknown,
  dabOpacity: unknown = 1,
): number {
  return clampAlpha(strokeOpacity) * clampAlpha(flow) * clampAlpha(dabOpacity);
}

/**
 * Alpha produced by repeatedly source-over compositing one constant-alpha dab over transparency.
 * Fractional counts are truncated because a dab count is discrete; invalid/non-positive counts
 * produce no coverage.
 */
export function resolveStudioRepeatedSourceOverAlpha(
  perDabAlpha: unknown,
  dabCount: number,
): number {
  const count = Number.isFinite(dabCount) ? Math.floor(dabCount) : 0;
  if (count <= 0) return 0;

  const alpha = clampAlpha(perDabAlpha);
  if (alpha === 0 || alpha === 1) return alpha;
  return 1 - ((1 - alpha) ** count);
}

/** Final pixel alpha for constant overlapping dabs under the new layered contract. */
export function resolveStudioLayeredFlowOverlapAlpha(
  strokeOpacity: unknown,
  flow: unknown,
  dabCount: number,
  dabOpacity: unknown = 1,
): number {
  const coverage = resolveStudioRepeatedSourceOverAlpha(
    resolveStudioLayeredFlowDepositionAlpha(flow, dabOpacity),
    dabCount,
  );
  return resolveStudioLayeredFlowFinalAlpha(strokeOpacity, coverage);
}

/** Final pixel alpha for constant overlapping dabs under the frozen legacy contract. */
export function resolveStudioLegacyPerDabOverlapAlpha(
  strokeOpacity: unknown,
  flow: unknown,
  dabCount: number,
  dabOpacity: unknown = 1,
): number {
  return resolveStudioRepeatedSourceOverAlpha(
    resolveStudioLegacyPerDabAlpha(strokeOpacity, flow, dabOpacity),
    dabCount,
  );
}
