/**
 * Pure, canonical entry decision for Studio Advanced Fill.
 *
 * A page may contain many ImageEl items that are not safe fill targets (hidden, locked,
 * animated, immutable, or invalid for the active reference policy). Those raw image items must
 * never suppress the non-destructive vector-line-art fallback. The caller supplies the existing
 * target policy as `getRasterUnsupportedReason`; this module evaluates it once per raster and
 * then applies one deterministic precedence shared by every Advanced Fill entry surface.
 */
import {
  planStudioAdvancedFillVectorTarget,
  type StudioAdvancedFillVectorTargetInput,
  type StudioAdvancedFillVectorTargetPlan,
  type StudioAdvancedFillVirtualTarget,
} from "./studio-vector-fill-reference";

export interface StudioAdvancedFillRasterCandidate {
  readonly id: string;
}

export interface StudioAdvancedFillEntryInput<
  Raster extends StudioAdvancedFillRasterCandidate,
> {
  readonly selectedRasterId: string | null;
  readonly rasterLayers: readonly Raster[];
  readonly getRasterUnsupportedReason: (raster: Raster) => string | null;
  readonly vectorInput: StudioAdvancedFillVectorTargetInput;
}

export interface StudioAdvancedFillIneligibleRaster<Raster> {
  readonly raster: Raster;
  readonly reason: string;
}

interface StudioAdvancedFillEntryDecisionBase<Raster> {
  /** Evaluated once so integration code can render useful recovery copy without rescanning. */
  readonly ineligibleRasters: readonly StudioAdvancedFillIneligibleRaster<Raster>[];
}

export type StudioAdvancedFillEntryDecision<Raster> =
  | (StudioAdvancedFillEntryDecisionBase<Raster> & {
      readonly mode: "selected-raster";
      readonly target: Raster;
    })
  | (StudioAdvancedFillEntryDecisionBase<Raster> & {
      readonly mode: "auto-select-raster";
      readonly target: Raster;
    })
  | (StudioAdvancedFillEntryDecisionBase<Raster> & {
      readonly mode: "ambiguous-raster";
      readonly candidates: readonly Raster[];
    })
  | (StudioAdvancedFillEntryDecisionBase<Raster> & {
      readonly mode: "virtual-vector-fill";
      readonly target: StudioAdvancedFillVirtualTarget;
    })
  | (StudioAdvancedFillEntryDecisionBase<Raster> & {
      readonly mode: "unavailable";
      readonly vectorFailure: Extract<StudioAdvancedFillVectorTargetPlan, { readonly ok: false }>;
    });

/**
 * Resolve Advanced Fill entry without mutating selection, history, or tool state.
 *
 * Precedence is intentionally strict: a selected eligible raster wins; otherwise a unique
 * eligible raster may be auto-selected; multiple eligible rasters require an explicit user
 * choice; only zero eligible rasters may fall back to a planned virtual vector target.
 */
export function resolveStudioAdvancedFillEntry<
  Raster extends StudioAdvancedFillRasterCandidate,
>(input: StudioAdvancedFillEntryInput<Raster>): StudioAdvancedFillEntryDecision<Raster> {
  const eligibleRasters: Raster[] = [];
  const ineligibleRasters: StudioAdvancedFillIneligibleRaster<Raster>[] = [];

  for (const raster of input.rasterLayers) {
    const reason = input.getRasterUnsupportedReason(raster);
    if (reason === null) eligibleRasters.push(raster);
    else ineligibleRasters.push({ raster, reason });
  }

  const selectedRaster = input.selectedRasterId === null
    ? null
    : eligibleRasters.find((raster) => raster.id === input.selectedRasterId) ?? null;
  if (selectedRaster) {
    return {
      mode: "selected-raster",
      target: selectedRaster,
      ineligibleRasters,
    };
  }

  if (eligibleRasters.length === 1) {
    return {
      mode: "auto-select-raster",
      target: eligibleRasters[0]!,
      ineligibleRasters,
    };
  }

  if (eligibleRasters.length > 1) {
    return {
      mode: "ambiguous-raster",
      candidates: eligibleRasters,
      ineligibleRasters,
    };
  }

  const vectorPlan = planStudioAdvancedFillVectorTarget(input.vectorInput);
  if (vectorPlan.ok) {
    return {
      mode: "virtual-vector-fill",
      target: vectorPlan.target,
      ineligibleRasters,
    };
  }

  return {
    mode: "unavailable",
    vectorFailure: vectorPlan,
    ineligibleRasters,
  };
}
