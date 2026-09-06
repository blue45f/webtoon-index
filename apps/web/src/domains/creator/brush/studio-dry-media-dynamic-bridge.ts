/**
 * Pure bridge from the existing dynamic-dab authority to the anisotropic dry-media kernel.
 *
 * Dynamic dabs already contain the final pressure-resolved size, opacity and flow. Reapplying the
 * kernel's pressure curves here would square the stylus response, so this bridge deliberately
 * consumes only its deterministic material geometry and coverage variation. The original dab
 * remains the pigment authority; the adjusted dab and renderer-neutral mark are two equivalent
 * lowerings of that same deposit.
 *
 * The bridge is fail-closed. Unsupported identities, malformed dabs or an invalid kernel response
 * never fall back to a generic circular tip.
 */

import {
  STUDIO_DRY_MEDIA_ANISOTROPIC_PRESETS_V1,
  resolveStudioDryMediaAnisotropicDabResponseV1,
  resolveStudioDryMediaAnisotropicPresetIdV1,
  type StudioDryMediaAnisotropicMarkShapeV1,
  type StudioDryMediaAnisotropicPresetIdV1,
} from "./studio-dry-media-anisotropic-grain-v1";

import type { StudioDynamicBrushDab } from "./studio-brush-dynamics";

export const STUDIO_DRY_MEDIA_DYNAMIC_BRIDGE_VERSION = 1 as const;
export const STUDIO_DRY_MEDIA_DYNAMIC_BRIDGE_CONTRACT =
  "studio-dry-media-dynamic-bridge-v1" as const;

export interface StudioDryMediaDynamicBridgeInput {
  readonly brushId: unknown;
  readonly brushCatalogId?: unknown;
  readonly seed: number;
  readonly dabs: readonly StudioDynamicBrushDab[];
}

/**
 * Persisted material identity shared by live, retained and export planners.
 *
 * `brushId` is the runtime renderer id while `brushCatalogId` preserves the authored catalogue
 * material. The resolved preset is explicit so downstream plans can distinguish an intentionally
 * authored dry-media renderer from an anisotropic material route without guessing from dynamics.
 */
export interface StudioDynamicBrushMaterialIdentity {
  readonly brushId: string;
  readonly brushCatalogId?: string;
  readonly dryMediaPresetId: StudioDryMediaAnisotropicPresetIdV1 | null;
}

export function resolveStudioDynamicBrushMaterialIdentity(
  brushId: unknown,
  brushCatalogId?: unknown,
): StudioDynamicBrushMaterialIdentity | null {
  if (typeof brushId !== "string" || brushId.length === 0) return null;
  const normalizedCatalogId = typeof brushCatalogId === "string"
    && brushCatalogId.length > 0
    ? brushCatalogId
    : undefined;
  return Object.freeze({
    brushId,
    ...(normalizedCatalogId ? { brushCatalogId: normalizedCatalogId } : {}),
    dryMediaPresetId: resolveStudioDryMediaAnisotropicPresetIdV1(
      brushId,
      normalizedCatalogId,
    ),
  });
}

export interface StudioDryMediaDynamicBridgeMark {
  readonly kind: "studio-dry-media-dynamic-coverage-mark";
  readonly version: typeof STUDIO_DRY_MEDIA_DYNAMIC_BRIDGE_VERSION;
  readonly presetId: StudioDryMediaAnisotropicPresetIdV1;
  readonly shape: StudioDryMediaAnisotropicMarkShapeV1;
  readonly sourceDabIndex: number;
  /** Dense product lane index, independent from the kernel preset's wider native lane table. */
  readonly laneIndex: number;
  readonly laneCount: number;
  readonly x: number;
  readonly y: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly angleRadians: number;
  /** Final pressure-resolved dab opacity; pressure is not applied again. */
  readonly opacity: number;
  /** Final pressure-resolved dab flow; pressure is not applied again. */
  readonly flow: number;
  /** Seeded material coverage only, independent from the pressure channels above. */
  readonly coverageScale: number;
  /** Exact source-over alpha represented by the equivalent adjusted dab. */
  readonly alpha: number;
}

export interface StudioDryMediaDynamicBridgeReceipt {
  readonly contract: typeof STUDIO_DRY_MEDIA_DYNAMIC_BRIDGE_CONTRACT;
  readonly version: typeof STUDIO_DRY_MEDIA_DYNAMIC_BRIDGE_VERSION;
  readonly presetId: StudioDryMediaAnisotropicPresetIdV1;
  readonly sourceDabCount: number;
  /** Number of physical fibres emitted for every source dab. */
  readonly laneCount: number;
  readonly adjustedDabs: readonly StudioDynamicBrushDab[];
  readonly marks: readonly StudioDryMediaDynamicBridgeMark[];
}

export type StudioDryMediaDynamicBridgeFailureReason =
  | "invalid-dab"
  | "invalid-seed"
  | "kernel-response"
  | "unsupported-identity";

export type StudioDryMediaDynamicBridgeResult =
  | Readonly<{
      readonly ok: true;
      readonly receipt: StudioDryMediaDynamicBridgeReceipt;
    }>
  | Readonly<{
      readonly ok: false;
      readonly reason: StudioDryMediaDynamicBridgeFailureReason;
    }>;

export interface StudioDryMediaDynamicSegmentedDabVariation {
  readonly kind: "studio-dynamic-brush-segmented-dab-variation";
  readonly segments: readonly (readonly StudioDynamicBrushDab[])[];
}

export type StudioDryMediaDynamicDabVariation =
  | readonly StudioDynamicBrushDab[]
  | StudioDryMediaDynamicSegmentedDabVariation;

export type StudioDryMediaDynamicVariationBridgeResult =
  | Readonly<{
      readonly ok: true;
      readonly applied: false;
      readonly variation: StudioDryMediaDynamicDabVariation;
    }>
  | Readonly<{
      readonly ok: true;
      readonly applied: true;
      readonly presetId: StudioDryMediaAnisotropicPresetIdV1;
      readonly variation: StudioDryMediaDynamicDabVariation;
    }>
  | Readonly<{
      readonly ok: false;
      readonly reason:
        | StudioDryMediaDynamicBridgeFailureReason
        | "invalid-material-identity";
    }>;

const UINT32_MAX = 0xffff_ffff;
const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;
const POINT_EPSILON = 1e-8;
/**
 * Product lane counts are deliberately bounded below the full simulation's most expensive
 * presets, but never collapse a selected-width nib to one representative fibre.
 *
 * Every material runs its kernel's full native lane count. Crayon was briefly cut to three
 * because a 3,000-sample stroke plans 76,565 marks at five lanes against a quoted 65,536 ceiling.
 * That reasoning used the wrong ceiling: 65,536 is the per-segment budget, while a complete causal
 * stroke is bounded by CAUSAL_CONTINUATION_MARK_BUDGET (16x that), so those 76,565 marks are drawn
 * whole — measured, not inferred: the live renderer records all 76,565 with no accepted-prefix
 * truncation, inside the same frame-time gates. What three lanes did buy was a defect: they map
 * onto native fibres 0/2/4 and drop 1 and 3, leaving ~1.1px bare bands inside the stroke — the
 * "too much white showing" the bed was reported for. See `depositionLinearize` in the kernel tip
 * for the paired change that keeps the restored five-fibre bed off the half-tone band.
 */
const PRODUCT_LANE_COUNT = Object.freeze({
  crayon: 5,
  charcoal: 5,
  chalk: 5,
  pastel: 5,
} as const satisfies Readonly<
  Record<StudioDryMediaAnisotropicPresetIdV1, 3 | 5>
>);

/**
 * Exact physical-mark expansion applied by the dry-media bridge for one authored source dab.
 *
 * Budget planners must charge this multiplier before admitting a causal prefix. Waiting until the
 * bridge has materialized all lanes can exceed the shared mark ceiling and turn a valid long stroke
 * into an all-or-nothing `mark-budget` failure.
 */
export function studioDryMediaDynamicBridgeMarkMultiplier(
  materialIdentity?: StudioDynamicBrushMaterialIdentity | null,
): 1 | 3 | 5 {
  const presetId = materialIdentity?.dryMediaPresetId;
  return presetId === null || presetId === undefined
    ? 1
    : PRODUCT_LANE_COUNT[presetId];
}

function fail(
  reason: StudioDryMediaDynamicBridgeFailureReason,
): StudioDryMediaDynamicBridgeResult {
  return Object.freeze({ ok: false, reason });
}

function finiteInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function validDab(
  dab: StudioDynamicBrushDab,
  previousIndex: number,
): boolean {
  return typeof dab === "object"
    && dab !== null
    && Number.isSafeInteger(dab.index)
    && dab.index >= 0
    && dab.index > previousIndex
    && finiteInRange(dab.progress, 0, 1)
    && finiteInRange(dab.sourceX, -1_000_000_000, 1_000_000_000)
    && finiteInRange(dab.sourceY, -1_000_000_000, 1_000_000_000)
    && finiteInRange(dab.x, -1_000_000_000, 1_000_000_000)
    && finiteInRange(dab.y, -1_000_000_000, 1_000_000_000)
    && finiteInRange(dab.size, 0.05, 4_096)
    && finiteInRange(dab.opacity, 0, 1)
    && finiteInRange(dab.flow, 0, 1)
    && finiteInRange(dab.spacing, 0, 1_000_000)
    && finiteInRange(dab.scatter, 0, 1_000_000)
    && finiteInRange(dab.angle, -360_000, 360_000)
    && finiteInRange(dab.roundness, 0.01, 1);
}

function resolvedDabAxisRadians(dab: StudioDynamicBrushDab): number {
  // Dynamic planning has already resolved direction, twist, tilt mappings and authored jitter
  // into this angle. Treating it as the sole causal authority makes arbitrary suffix/segment
  // boundaries byte-identical to full replay; recomputing a tangent from a previous dab would make
  // every first dab in an incremental chunk differ from the retained plan.
  return dab.angle * DEGREES_TO_RADIANS;
}

function finiteBridgeOutput(
  dab: StudioDynamicBrushDab,
  mark: StudioDryMediaDynamicBridgeMark,
): boolean {
  return [
    dab.x,
    dab.y,
    dab.size,
    dab.opacity,
    dab.flow,
    dab.angle,
    dab.roundness,
    mark.x,
    mark.y,
    mark.radiusX,
    mark.radiusY,
    mark.angleRadians,
    mark.laneIndex,
    mark.laneCount,
    mark.opacity,
    mark.flow,
    mark.coverageScale,
    mark.alpha,
  ].every(Number.isFinite)
    && mark.radiusX > 0
    && mark.radiusY > 0
    && Number.isSafeInteger(mark.laneIndex)
    && mark.laneIndex >= 0
    && mark.laneIndex < mark.laneCount
    && (mark.laneCount === 3 || mark.laneCount === 5)
    && mark.alpha >= 0
    && mark.alpha <= 1;
}

function nativeLaneIndex(
  laneIndex: number,
  laneCount: number,
  nativeLaneCount: number,
): number {
  if (laneCount <= 1 || nativeLaneCount <= 1) return 0;
  return Math.round(
    laneIndex * (nativeLaneCount - 1) / (laneCount - 1),
  );
}

/**
 * Converts a deterministic dynamic-dab sequence into anisotropic material coverage.
 *
 * `pressure: 0.5` is only a valid kernel-domain placeholder. The response's width/opacity/flow
 * scales are intentionally ignored; `dab.size`, `dab.opacity` and `dab.flow` have already consumed
 * the canonical stylus pressure. Geometry and seeded coverage remain material-specific.
 */
export function bridgeStudioDynamicDabsToDryMediaV1(
  input: StudioDryMediaDynamicBridgeInput,
): StudioDryMediaDynamicBridgeResult {
  const presetId = resolveStudioDryMediaAnisotropicPresetIdV1(
    input?.brushId,
    input?.brushCatalogId,
  );
  if (!presetId) return fail("unsupported-identity");
  if (
    !Number.isSafeInteger(input.seed)
    || input.seed < 0
    || input.seed > UINT32_MAX
  ) {
    return fail("invalid-seed");
  }
  if (!Array.isArray(input.dabs)) return fail("invalid-dab");

  const preset = STUDIO_DRY_MEDIA_ANISOTROPIC_PRESETS_V1[presetId];
  const laneCount = PRODUCT_LANE_COUNT[presetId];
  const adjustedDabs: StudioDynamicBrushDab[] = [];
  const marks: StudioDryMediaDynamicBridgeMark[] = [];
  let previousIndex = -1;

  for (const dab of input.dabs) {
    if (!validDab(dab, previousIndex)) return fail("invalid-dab");
    const tangentRadians = resolvedDabAxisRadians(dab);
    const tangentX = Math.cos(tangentRadians);
    const tangentY = Math.sin(tangentRadians);
    const normalX = -tangentY;
    const normalY = tangentX;

    for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
      const kernelLaneIndex = nativeLaneIndex(
        laneIndex,
        laneCount,
        preset.laneCount,
      );
      const expandedIndex =
        dab.index * preset.laneCount + kernelLaneIndex;
      if (!Number.isSafeInteger(expandedIndex)) return fail("kernel-response");
      const response = resolveStudioDryMediaAnisotropicDabResponseV1({
        presetId,
        seed: input.seed,
        // Encoding the source dab and selected native lane in one integer lets the kernel expose
        // its real lateral lanes while arbitrary causal chunks produce byte-identical fibres.
        stationIndex: expandedIndex,
        // See the function contract: pressure geometry and pigment scales are not consumed below.
        pressure: 0.5,
        tangentRadians,
        tiltX: 0,
        tiltY: 0,
        twist: 0,
      });
      if (!response) return fail("kernel-response");

      const x = dab.x
        + tangentX * dab.spacing * response.longitudinalOffsetRatio
        + normalX * dab.size * response.lateralOffsetRatio;
      const y = dab.y
        + tangentY * dab.spacing * response.longitudinalOffsetRatio
        + normalY * dab.size * response.lateralOffsetRatio;
      const size = dab.size * response.majorAxisScale;
      const flow = Math.min(1, Math.max(0, dab.flow * response.coverageScale));
      const adjusted: StudioDynamicBrushDab = Object.freeze({
        ...dab,
        // One stable expanded index gives every lane independent tip/grain sampling downstream.
        index: expandedIndex,
        x,
        y,
        size,
        opacity: dab.opacity,
        flow,
        angle: response.angleRadians * RADIANS_TO_DEGREES,
        roundness: response.roundness,
      });
      const radiusX = Math.max(0.125, size / 2);
      const radiusY = radiusX * response.roundness;
      const mark: StudioDryMediaDynamicBridgeMark = Object.freeze({
        kind: "studio-dry-media-dynamic-coverage-mark",
        version: STUDIO_DRY_MEDIA_DYNAMIC_BRIDGE_VERSION,
        presetId,
        shape: response.shape,
        sourceDabIndex: dab.index,
        laneIndex,
        laneCount,
        x,
        y,
        radiusX,
        radiusY,
        angleRadians: response.angleRadians,
        opacity: dab.opacity,
        flow: dab.flow,
        coverageScale: response.coverageScale,
        alpha: dab.opacity * flow,
      });
      if (
        !finiteBridgeOutput(adjusted, mark)
        || radiusX / radiusY + POINT_EPSILON < preset.minimumAspectRatio
      ) {
        return fail("kernel-response");
      }
      adjustedDabs.push(adjusted);
      marks.push(mark);
    }
    previousIndex = dab.index;
  }

  return Object.freeze({
    ok: true,
    receipt: Object.freeze({
      contract: STUDIO_DRY_MEDIA_DYNAMIC_BRIDGE_CONTRACT,
      version: STUDIO_DRY_MEDIA_DYNAMIC_BRIDGE_VERSION,
      presetId,
      sourceDabCount: input.dabs.length,
      laneCount,
      adjustedDabs: Object.freeze(adjustedDabs),
      marks: Object.freeze(marks),
    }),
  });
}

function isSegmentedVariation(
  variation: StudioDryMediaDynamicDabVariation,
): variation is StudioDryMediaDynamicSegmentedDabVariation {
  return !Array.isArray(variation);
}

/**
 * Applies the anisotropic bridge without flattening causal-v3 continuation segments.
 *
 * Unsupported identities intentionally preserve the existing authored renderer. A mapped material
 * must bridge every segment successfully; partial material conversion is rejected instead of
 * falling back to a circular carrier. Because each adjusted dab depends only on its resolved dab
 * and stable index, planning one suffix, many segments or a full replay is byte-identical.
 */
export function bridgeStudioDynamicDabVariationToDryMediaV1(
  input: Readonly<{
    materialIdentity: StudioDynamicBrushMaterialIdentity;
    seed: number;
    variation: StudioDryMediaDynamicDabVariation;
  }>,
): StudioDryMediaDynamicVariationBridgeResult {
  const canonicalIdentity = resolveStudioDynamicBrushMaterialIdentity(
    input?.materialIdentity?.brushId,
    input?.materialIdentity?.brushCatalogId,
  );
  if (
    !canonicalIdentity
    || canonicalIdentity.dryMediaPresetId
      !== input?.materialIdentity?.dryMediaPresetId
  ) {
    return Object.freeze({
      ok: false,
      reason: "invalid-material-identity",
    });
  }
  if (canonicalIdentity.dryMediaPresetId === null) {
    return Object.freeze({
      ok: true,
      applied: false,
      variation: input.variation,
    });
  }

  const bridgeDabs = (
    dabs: readonly StudioDynamicBrushDab[],
  ): Readonly<{
    ok: true;
    dabs: readonly StudioDynamicBrushDab[];
  }> | Readonly<{
    ok: false;
    reason: StudioDryMediaDynamicBridgeFailureReason;
  }> => {
    const result = bridgeStudioDynamicDabsToDryMediaV1({
      brushId: canonicalIdentity.brushId,
      brushCatalogId: canonicalIdentity.brushCatalogId,
      seed: input.seed,
      dabs,
    });
    return result.ok
      ? { ok: true, dabs: result.receipt.adjustedDabs }
      : result;
  };

  if (!isSegmentedVariation(input.variation)) {
    const adjusted = bridgeDabs(input.variation);
    if (!adjusted.ok) return adjusted;
    return Object.freeze({
      ok: true,
      applied: true,
      presetId: canonicalIdentity.dryMediaPresetId,
      variation: adjusted.dabs,
    });
  }

  const adjustedSegments: Array<readonly StudioDynamicBrushDab[]> = [];
  for (const segment of input.variation.segments) {
    const adjusted = bridgeDabs(segment);
    if (!adjusted.ok) return adjusted;
    adjustedSegments.push(adjusted.dabs);
  }
  return Object.freeze({
    ok: true,
    applied: true,
    presetId: canonicalIdentity.dryMediaPresetId,
    variation: Object.freeze({
      kind: "studio-dynamic-brush-segmented-dab-variation",
      segments: Object.freeze(adjustedSegments),
    }),
  });
}
