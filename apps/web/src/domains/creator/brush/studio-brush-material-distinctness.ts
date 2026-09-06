/**
 * Deterministic material-response distinctness for dynamic brushes.
 *
 * The historical listed uniqueness key intentionally protects compatibility and only compares
 * carrier/tip identity. This diagnostic measures the rendered response that users actually feel:
 * spacing, size variation, scatter, opacity/flow buildup, tip alpha, grain and dual-tip blending.
 *
 * It is governance-only and does not change catalogue ids, saved documents or renderer selection.
 */

import {
  profileStudioBrushMaterialResponse,
  type StudioBrushMaterialResponse,
} from "./studio-brush-material-response";

import type { StudioBrushDynamicsSettings } from "./studio-brush-dynamics";

export const STUDIO_BRUSH_MATERIAL_DISTINCTNESS_VERSION =
  "studio-brush-material-distinctness-v1" as const;

export interface StudioBrushMaterialDistinctnessInput {
  readonly catalogId: string;
  readonly runtimeBrushId: string;
  readonly defaultWidth: number;
  readonly defaultOpacity: number;
  readonly brushDynamics?: StudioBrushDynamicsSettings | null;
  readonly seed?: number;
}

export interface StudioBrushMaterialDistinctnessProfile {
  readonly version: typeof STUDIO_BRUSH_MATERIAL_DISTINCTNESS_VERSION;
  readonly catalogId: string;
  readonly runtimeBrushId: string;
  readonly response: StudioBrushMaterialResponse;
  /** Unit-normalized response vector. It intentionally excludes identity strings. */
  readonly vector: readonly number[];
  readonly behaviorFingerprint: string;
}

export interface StudioBrushMaterialDistinctnessPair {
  readonly leftId: string;
  readonly rightId: string;
  readonly distance: number;
  readonly exactBehaviorCollision: boolean;
}

const RESPONSE_AXIS_WEIGHTS = Object.freeze([
  // geometry
  0.055, // spacing / width
  0.035, // spacing sigma / width
  0.055, // size / width
  0.035, // size sigma / width
  0.10, // scatter / size
  // deposition
  0.035, // opacity ceiling
  0.035, // dab opacity
  0.045, // flow
  0.055, // overlap 4
  0.06, // overlap 16
  0.035, // prevented darkening
  // texture
  0.055, // tip mean
  0.04, // tip sigma
  0.055, // grain mean
  0.05, // grain sigma
  0.055, // material mean
  0.05, // material sigma
  0.055, // occupied ratio
  0.035, // dual blend
  0.025, // dual size ratio
] as const);

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizedRatio(value: number, scale: number): number {
  return clamp01(finite(value) / Math.max(Number.EPSILON, scale));
}

function normalizedSigma(variance: number, scale: number): number {
  return normalizedRatio(Math.sqrt(Math.max(0, finite(variance))), scale);
}

function blendModeAxis(mode: "multiply" | "none" | "screen"): number {
  if (mode === "multiply") return 0.5;
  if (mode === "screen") return 1;
  return 0;
}

function rounded(value: number, digits = 8): number {
  const multiplier = 10 ** digits;
  return Math.round(finite(value) * multiplier) / multiplier;
}

function responseVector(
  response: StudioBrushMaterialResponse,
  defaultWidthInput: number,
): readonly number[] {
  const defaultWidth = Math.max(0.25, finite(defaultWidthInput, 1));
  const { geometry, deposition, texture } = response;
  const vector = [
    normalizedRatio(geometry.meanSpacing / defaultWidth, 1.5),
    normalizedSigma(geometry.spacingVariance, defaultWidth * 1.5),
    normalizedRatio(geometry.meanSize / defaultWidth, 2),
    normalizedSigma(geometry.sizeVariance, defaultWidth * 2),
    normalizedRatio(geometry.meanScatterRatio, 2),
    clamp01(deposition.opacityCeiling),
    clamp01(deposition.dabOpacity),
    clamp01(deposition.flow),
    clamp01(deposition.overlap4Alpha),
    clamp01(deposition.overlap16Alpha),
    clamp01(deposition.preventedDarkeningAt16),
    clamp01(texture.tipMeanAlpha),
    normalizedSigma(texture.tipAlphaVariance, 0.5),
    clamp01(texture.grainMeanMultiplier),
    normalizedSigma(texture.grainMultiplierVariance, 0.5),
    clamp01(texture.materialMeanAlpha),
    normalizedSigma(texture.materialAlphaVariance, 0.5),
    clamp01(texture.occupiedRatio),
    blendModeAxis(texture.dualBlendMode),
    normalizedRatio(texture.dualSizeRatio, 4),
  ].map((value) => rounded(value));
  if (vector.length !== RESPONSE_AXIS_WEIGHTS.length) {
    throw new Error("Studio material distinctness vector/weight length drift");
  }
  return Object.freeze(vector);
}

/**
 * Profiles one dynamic brush through the real tip/grain/deposition planner.
 *
 * Width is normalized out of geometry so slider-scale siblings remain recognisable as the same
 * material behavior; opacity remains because accumulation darkness is part of the authored feel.
 */
export function profileStudioBrushMaterialDistinctness(
  input: StudioBrushMaterialDistinctnessInput,
): StudioBrushMaterialDistinctnessProfile {
  const response = profileStudioBrushMaterialResponse({
    brushDynamics: input.brushDynamics,
    defaultWidth: input.defaultWidth,
    defaultOpacity: input.defaultOpacity,
    seed: input.seed,
  });
  const vector = responseVector(response, input.defaultWidth);
  return Object.freeze({
    version: STUDIO_BRUSH_MATERIAL_DISTINCTNESS_VERSION,
    catalogId: input.catalogId,
    runtimeBrushId: input.runtimeBrushId,
    response,
    vector,
    behaviorFingerprint: JSON.stringify({
      version: STUDIO_BRUSH_MATERIAL_DISTINCTNESS_VERSION,
      vector,
      response: response.fingerprints.combined,
    }),
  });
}

export function studioBrushMaterialDistinctnessDistance(
  left: StudioBrushMaterialDistinctnessProfile,
  right: StudioBrushMaterialDistinctnessProfile,
): number {
  if (left.vector.length !== right.vector.length) {
    throw new Error("Cannot compare Studio material profiles with different vector lengths");
  }
  let weightedSquaredDistance = 0;
  let totalWeight = 0;
  for (let index = 0; index < left.vector.length; index += 1) {
    const weight = RESPONSE_AXIS_WEIGHTS[index] ?? 0;
    const delta = (left.vector[index] ?? 0) - (right.vector[index] ?? 0);
    weightedSquaredDistance += weight * delta * delta;
    totalWeight += weight;
  }
  return rounded(Math.sqrt(weightedSquaredDistance / Math.max(Number.EPSILON, totalWeight)));
}

export function listStudioBrushMaterialNearestPairs(
  profiles: readonly StudioBrushMaterialDistinctnessProfile[],
  limit = 20,
): readonly StudioBrushMaterialDistinctnessPair[] {
  const safeLimit = Math.max(0, Math.trunc(finite(limit, 20)));
  const pairs: StudioBrushMaterialDistinctnessPair[] = [];
  for (let leftIndex = 0; leftIndex < profiles.length; leftIndex += 1) {
    const left = profiles[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < profiles.length; rightIndex += 1) {
      const right = profiles[rightIndex]!;
      pairs.push({
        leftId: left.catalogId,
        rightId: right.catalogId,
        distance: studioBrushMaterialDistinctnessDistance(left, right),
        exactBehaviorCollision:
          left.behaviorFingerprint === right.behaviorFingerprint,
      });
    }
  }
  pairs.sort((left, right) => (
    left.distance - right.distance
    || left.leftId.localeCompare(right.leftId)
    || left.rightId.localeCompare(right.rightId)
  ));
  return Object.freeze(pairs.slice(0, safeLimit).map((pair) => Object.freeze(pair)));
}
