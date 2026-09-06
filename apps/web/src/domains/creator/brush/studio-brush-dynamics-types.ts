import {
  DEFAULT_STUDIO_STROKE_BUDGET,
  resolveStrokeDabCapacity,
  STUDIO_DYNAMIC_BRUSH_DAB_RESIDENT_BYTES,
} from "@toonspectrum/studio-brush-platform";

import {
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
  isStudioDynamicBrushCausalDepositPipeline,
  STUDIO_BRUSH_DYNAMICS_SETTINGS_VERSION,
  type StudioDryMediaUnionProgramPin,
  type StudioDryMediaKernelProgramPin,
  type StudioSoftFalloffLinearProgramPin,
  type StudioDynamicBrushDepositPipeline,
} from "./studio-brush-dynamics-program-pins";
import { resolveStudioBrushEngineLaneDynamicsPresetId } from "./studio-brush-engine-lane-catalog";

import type {
  NormalizedStudioBrushColorDynamicsSettings,
  NormalizedStudioBrushGrainSettings,
  StudioBrushColorDynamicsSettings,
  StudioBrushGrainSettings,
} from "./studio-brush-material-dynamics";
import type {
  NormalizedStudioBrushDualBrushSettings,
  NormalizedStudioBrushTipLayerSettings,
  StudioBrushDualBrushSettings,
  StudioBrushTipLayerSettings,
} from "./studio-brush-tip-composition";
import type {
  NormalizedStudioBrushTipSettings,
  StudioBrushTipSettings,
} from "./studio-brush-tip-stamp";

export function studioDynamicBrushDepositPipelineUsesContinuation(
  value: unknown,
): value is typeof STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3 {
  return value === STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3;
}

export const STUDIO_BRUSH_DYNAMICS_PROPERTY_LIMITS = {
  width: { min: 0.05, max: 4096 },
  opacity: { min: 0, max: 1 },
  flow: { min: 0, max: 1 },
  spacing: { min: 0.25, max: 4096 },
  scatter: { min: 0, max: 4096 },
  angle: { min: -180, max: 180 },
  roundness: { min: 0.08, max: 1 },
} as const;

/**
 * dab 상한은 이제 고정 상수가 아니라 StrokeBudget 에서 파생된다(2026-09-02 아키텍처 리뷰).
 *
 * 기본 예산 4 MiB / dab 당 128 B = 32,768 — 지금 출하 중인 값과 정확히 같다. 즉 이 파생은
 * 동작 중립이고, 예산을 올리면(예: pro 프로파일) 상한이 따라 올라간다. 진짜 무제한 획은
 * 후속 레인의 "수락된 접두 청크 플러시" 배선이 담당한다.
 */
export const STUDIO_DYNAMIC_BRUSH_DAB_CAP_RANGE = {
  min: 1,
  max: resolveStrokeDabCapacity({
    budget: DEFAULT_STUDIO_STROKE_BUDGET,
    bytesPerDab: STUDIO_DYNAMIC_BRUSH_DAB_RESIDENT_BYTES,
  }),
} as const;
export const DEFAULT_STUDIO_DYNAMIC_BRUSH_MAX_DABS = 8_192;
export const STUDIO_BRUSH_DYNAMICS_RATIO_LIMITS = {
  spacing: { min: 0.01, max: 16 },
  scatter: { min: 0, max: 16 },
} as const;

export type StudioDynamicBrushMinimumDiameterRatio = number;

export function isStudioDynamicBrushMinimumDiameterRatio(
  value: unknown
): value is StudioDynamicBrushMinimumDiameterRatio {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= 1;
}

/**
 * Applies the persisted dynamic-brush floor to geometry only.
 *
 * Callers intentionally resolve pressure mappings and taper before this boundary. Returning the
 * mapped value unchanged for an omitted/invalid ratio preserves old documents and lets the
 * planner's existing finite-value guard fail closed on malformed geometry.
 */
export function applyStudioDynamicBrushMinimumDiameterRatio(
  mappedDiameter: number,
  baseDiameter: number,
  minimumDiameterRatio: unknown
): number {
  return isStudioDynamicBrushMinimumDiameterRatio(minimumDiameterRatio)
    ? Math.max(mappedDiameter, baseDiameter * minimumDiameterRatio)
    : mappedDiameter;
}

/** Shared stroke-start / stroke-end taper (CSP / Procreate style tip thinning). */
export const STUDIO_BRUSH_TAPER_LIMITS = {
  length: { min: 0, max: 0.5 },
  minSizeRatio: { min: 0, max: 1 },
  minOpacityRatio: { min: 0, max: 1 },
  curve: { min: 0.05, max: 8 },
} as const;

export const MAX_POINTER_SPEED = 64;

export type StudioBrushDynamicsSource =
  | "pressure"
  | "tangential-pressure"
  | "speed"
  | "tilt"
  | "tilt-magnitude"
  | "tilt-azimuth"
  | "twist"
  | "direction";

export type StudioBrushDynamicsMappingMode = "multiply" | "add";

/**
 * One serializable input-to-property mapping.
 *
 * `from` and `to` describe either a multiplier or an additive physical value. `amount` blends the
 * mapping with the value accumulated so far; mappings are evaluated in their serialized order.
 */
export interface StudioBrushDynamicsMappingSettings {
  source: StudioBrushDynamicsSource;
  mode?: StudioBrushDynamicsMappingMode;
  from?: number;
  to?: number;
  amount?: number;
  curve?: number;
  curveMode?: "power" | "bezier";
  curveControlPoints?: readonly [number, number, number, number];
  invert?: boolean;
}

export interface StudioBrushDynamicsJitterSettings {
  mode?: StudioBrushDynamicsMappingMode;
  /** multiply: fractional variation 0..1, add: physical property units. */
  amount?: number;
}

export interface StudioBrushDynamicsPropertySettings {
  base?: number;
  min?: number;
  max?: number;
  mappings?: readonly StudioBrushDynamicsMappingSettings[];
  jitter?: StudioBrushDynamicsJitterSettings | null;
}

/** Shared start/end taper along stroke arc length (progress 0..1). */
export interface StudioBrushTaperSettings {
  enabled?: boolean;
  /** Fraction of stroke length for the start taper zone (0..0.5). */
  startLength?: number;
  /** Fraction of stroke length for the end taper zone (0..0.5). */
  endLength?: number;
  /** Size multiplier at a fully tapered tip. */
  minSizeRatio?: number;
  /** Opacity multiplier at a fully tapered tip. */
  minOpacityRatio?: number;
  /** Power curve for taper falloff (>1 = longer thin tip, <1 = faster recovery). */
  curve?: number;
}

export interface NormalizedStudioBrushTaperSettings {
  enabled: boolean;
  startLength: number;
  endLength: number;
  minSizeRatio: number;
  minOpacityRatio: number;
  curve: number;
}

/** JSON-persistable user settings. `size` is accepted as an alias for `width`. */
export interface StudioBrushDynamicsSettings {
  version?: number;
  /**
   * Versioned authored-stroke deposit order. Omitted snapshots retain the historical whole-stroke
   * progress/taper resampler and therefore preserve existing document pixels.
   */
  depositPipeline?: StudioDynamicBrushDepositPipeline;
  /** Absent snapshots are immutable legacy v2; only an exact supported pin enables v3. */
  dryMediaUnionProgram?: StudioDryMediaUnionProgramPin;
  /**
   * Explicit kernel-dab-path opt-in minted only by authored dry-media preset snapshots. Absent
   * snapshots (every persisted pre-wave stroke) replay through the union carrier, not the kernel
   * dab path. The carrier engine is pinned; its grain constants are not.
   */
  dryMediaKernelProgram?: StudioDryMediaKernelProgramPin;
  /**
   * Explicit linear-accumulation opt-in for analytic soft-falloff marks, minted only by freshly
   * authored airbrush-family snapshots. Absent snapshots (every persisted pre-wave stroke) keep
   * blending their soft skirts in sRGB byte-identically.
   */
  softFalloffLinearProgram?: StudioSoftFalloffLinearProgramPin;
  /**
   * Versioned causal stamp-grid selection rule minted only by freshly authored causal alpha-tip
   * snapshots. Absent snapshots — every persisted pre-rule stroke — keep the bounded legacy
   * three-sample causal lattice (see `studio-brush-render-budget.ts`).
   */
  causalStampGridRule?: "causal-stamp-grid-v2";
  seed?: number;
  fallbackPressure?: number;
  /** CSS px/ms at which the normalized speed source reaches 1. */
  maxSpeed?: number;
  /**
   * Stroke-local minimum rendered diameter as a ratio of the selected base width.
   *
   * This is geometry-only: canonical pressure still reaches zero so opacity, flow, grain and
   * colour deposition retain the full stylus range. Omitted legacy snapshots keep their exact
   * historical replay; newly authored strokes persist the stricter artist/family/pack floor.
   */
  minimumDiameterRatio?: number;
  /** Dab spacing as a tip-width ratio. Set null to use spacing.base as legacy absolute px. */
  spacingRatio?: number | null;
  /** Scatter radius as a tip-width ratio. Set null to use scatter.base as absolute px. */
  scatterRatio?: number | null;
  /** Shared start/end taper applied after property mappings. */
  taper?: StudioBrushTaperSettings | null;
  /** PNG-alpha tip stamp shape (procedural or custom alpha map). */
  tip?: StudioBrushTipSettings | null;
  /** Deterministic foreground/background and HSV colour variation. */
  colorDynamics?: StudioBrushColorDynamicsSettings | null;
  /** Document-space texture pinned either to the canvas or to the stroke origin. */
  grain?: StudioBrushGrainSettings | null;
  /** Up to two extra transformed tips; the legacy `tip` remains the primary. */
  tipLayers?: readonly StudioBrushTipLayerSettings[] | null;
  /** Secondary tip texture that modulates the primary tip at composition time (dual brush). */
  dualBrush?: StudioBrushDualBrushSettings | null;
  width?: StudioBrushDynamicsPropertySettings;
  size?: StudioBrushDynamicsPropertySettings;
  opacity?: StudioBrushDynamicsPropertySettings;
  flow?: StudioBrushDynamicsPropertySettings;
  spacing?: StudioBrushDynamicsPropertySettings;
  scatter?: StudioBrushDynamicsPropertySettings;
  angle?: StudioBrushDynamicsPropertySettings;
  roundness?: StudioBrushDynamicsPropertySettings;
}

export type StudioBrushDynamicsPresetId = "ink-particle" | "airbrush" | "dry-media";

export type StudioBrushDynamicsBrushId = StudioBrushDynamicsPresetId
  | "soft-brush"
  | "spray"
  | "hard-airbrush"
  | "crayon"
  | "chalk"
  | "charcoal"
  | "pastel"
  | "oil-pastel"
  | "erodible-pencil"
  | "paint-tube"
  | "tangent-normal-brush"
  | "sketchpad-tile"
  | "sketchpad-mirror"
  | "sketchpad-soft-marker"
  | "web-multi-agent"
  | "web-rough-ink"
  | "web-gravity-drip"
  | "web-soft-cloud"
  | "web-calligraphy-ribbon"
  | "web-dash-stitch"
  | "web-scatter-stamp"
  | "web-rainbow-flow"
  | "web-lazy-ink"
  | "web-hatch-color"
  | "web-cel-flat"
  | "web-blend-softener"
  | "web-dot-tone"
  | "web-kaleido-ink"
  | "web-fur-strand"
  | "web-contour-double"
  | "web-radial-burst"
  | "web-mirror-ink"
  | "web-grid-ink"
  | "web-spiro-orbit"
  | "web-zigzag-edge"
  | "web-neon-tube"
  | "web-pressure-flat"
  | "web-smudge-trail"
  | "web-cross-hatch-pen"
  | "watercolor"
  | "ink-wash"
  | "inkwash-pen"
  | "inkwash-water-brush"
  | "inkwash-bleed-wash"
  | "inkwash-white-ink";

/** Runtime/type guard shared by the editor, persistence and export paths. */
export function isStudioBrushDynamicsPresetId(value: unknown): value is StudioBrushDynamicsPresetId {
  return value === "ink-particle" || value === "airbrush" || value === "dry-media";
}

/**
 * Map commercial brush aliases (spray/crayon/chalk/…) onto a dynamics engine preset.
 * Keeps saved stroke `brush` ids stable while reusing airbrush/dry-media/ink pipelines.
 */
export function resolveStudioBrushDynamicsPresetId(
  brushId: unknown
): StudioBrushDynamicsPresetId | null {
  if (isStudioBrushDynamicsPresetId(brushId)) return brushId;
  if (typeof brushId !== "string") return null;
  const engineLaneDynamics = resolveStudioBrushEngineLaneDynamicsPresetId(brushId);
  if (engineLaneDynamics) return engineLaneDynamics;
  if (brushId === "spray" || brushId === "soft-brush" || brushId === "splatter") return "airbrush";
  if (
    brushId === "hard-airbrush"
    || brushId === "erodible-pencil"
    || brushId === "paint-tube"
    || brushId === "tangent-normal-brush"
    || brushId === "sketchpad-tile"
    || brushId === "sketchpad-mirror"
    || brushId === "web-multi-agent"
    || brushId === "web-rough-ink"
    || brushId === "web-gravity-drip"
    || brushId === "web-calligraphy-ribbon"
    || brushId === "web-dash-stitch"
    || brushId === "web-scatter-stamp"
    || brushId === "web-lazy-ink"
    || brushId === "web-hatch-color"
    || brushId === "web-cel-flat"
    || brushId === "web-dot-tone"
    || brushId === "web-kaleido-ink"
    || brushId === "web-fur-strand"
    || brushId === "web-contour-double"
    || brushId === "web-radial-burst"
    || brushId === "web-mirror-ink"
    || brushId === "web-grid-ink"
    || brushId === "web-spiro-orbit"
    || brushId === "web-zigzag-edge"
    || brushId === "web-pressure-flat"
    || brushId === "web-cross-hatch-pen"
    || brushId === "web-hatch-color-lattice"
    || brushId === "web-cel-flat-block"
    || brushId === "web-dot-tone-grid"
    || brushId === "web-kaleido-ink-fold"
    || brushId === "web-fur-strand-parallel"
    || brushId === "web-contour-double-edge"
    || brushId === "web-radial-burst-rays"
    || brushId === "web-mirror-ink-axis"
    || brushId === "web-grid-ink-snap"
    || brushId === "web-spiro-orbit-loop"
    || brushId === "web-zigzag-edge-wave"
    || brushId === "web-pressure-flat-even"
    || brushId === "web-cross-hatch-pen-x"
    || brushId === "connected-hard-envelope"
    || brushId === "progressive-wear-ribbon"
    || brushId === "extruded-bead-ribbon"
    || brushId === "direction-encoded-ribbon"
    || brushId === "sketchpad-tile-lattice"
    || brushId === "sketchpad-mirror-pair"
    || brushId === "web-multi-agent-swarm"
    || brushId === "web-rough-ink-jitter"
    || brushId === "web-gravity-drip-beads"
    || brushId === "web-calligraphy-chisel"
    || brushId === "web-dash-stitch-pitch"
    || brushId === "web-scatter-stamp-cloud"
    || brushId === "web-lazy-ink-smooth"
  ) return "ink-particle";
  if (
    brushId === "sketchpad-soft-marker"
    || brushId === "sketchpad-soft-envelope"
    || brushId === "web-soft-cloud"
    || brushId === "web-soft-cloud-spray"
    || brushId === "web-rainbow-flow"
    || brushId === "web-rainbow-flow-ribbon"
    || brushId === "web-blend-softener"
    || brushId === "web-blend-softener-mist"
    || brushId === "web-smudge-trail"
    || brushId === "web-smudge-trail-ghost"
  ) return "airbrush";
  if (
    brushId === "web-neon-tube"
    || brushId === "web-neon-tube-core"
  ) return "airbrush";
  if (
    brushId === "crayon"
    || brushId === "chalk"
    || brushId === "charcoal"
    || brushId === "pastel"
    || brushId === "oil-pastel"
  ) return "dry-media";
  return null;
}

const STUDIO_CAPTURED_WET_DYNAMIC_PRESET_BY_BRUSH_ID: Readonly<
  Record<string, StudioBrushDynamicsPresetId>
> = Object.freeze({
  watercolor: "airbrush",
  "ink-wash": "airbrush",
  "inkwash-pen": "ink-particle",
  "inkwash-water-brush": "airbrush",
  "inkwash-bleed-wash": "airbrush",
  "inkwash-white-ink": "ink-particle",
});

/**
 * Pointer-start resolver for the currently selected brush plus its dynamics panel snapshot.
 *
 * Resolution priority:
 * 1. A brush id that itself contracts a dynamics engine (installed shortcut) always resolves —
 *    including legacy snapshots that omit `presetId`/`depositPipeline` for byte-stable
 *    serialization. A snapshot `presetId` is honored only for such brushes; any-brush `presetId`
 *    shortcuts are rejected fail-closed because the collaboration mirror
 *    (`STUDIO_CRDT_BOUNDED_FLOW_DYNAMIC_BRUSH_IDS`) admits bounded-flow strokes by brush id, so a
 *    hijacked pen/stamp stroke would render locally and be refused by the server.
 * 2. Bare wet brush ids deliberately remain legacy watercolor ids. Only a captured causal
 *    dynamics snapshot opts a new wet stroke into the bounded dynamic renderer, so old saved
 *    documents retain their historical watercolor pixels.
 */
export function resolveStudioBrushDynamicsSelectionPresetId(
  brushId: unknown,
  brushDynamics: unknown,
): StudioBrushDynamicsPresetId | null {
  if (isStudioBrushDynamicsPresetId(brushId)) return brushId;
  const installed = resolveStudioBrushDynamicsPresetId(brushId);
  if (typeof brushDynamics === "object" && brushDynamics !== null) {
    const presetId = (brushDynamics as { presetId?: unknown }).presetId;
    if (installed !== null && isStudioBrushDynamicsPresetId(presetId)) return presetId;
    const depositPipeline = (brushDynamics as { depositPipeline?: unknown }).depositPipeline;
    if (isStudioDynamicBrushCausalDepositPipeline(depositPipeline)) {
      const wetPreset = typeof brushId === "string"
        ? (STUDIO_CAPTURED_WET_DYNAMIC_PRESET_BY_BRUSH_ID[brushId as keyof typeof STUDIO_CAPTURED_WET_DYNAMIC_PRESET_BY_BRUSH_ID] as StudioBrushDynamicsPresetId | undefined)
        : undefined;
      return wetPreset ?? installed;
    }
  }
  // Pre-seam installed shortcut: legacy tool memory/slot snapshots (no presetId, no pipeline)
  // must keep selecting the brush id's contracted engine instead of silently losing texture.
  return installed;
}

/**
 * Persisted/render resolver shared verbatim by Canvas (StudioDrawNode), the draft-preview lane,
 * the SVG exporter and the pointer capture gates — one decision point keeps surfaces in parity.
 *
 * - `bounded-flow-v2` elements resolve through the full selection contract (snapshot presetId /
 *   captured wet pipeline / installed shortcut).
 * - Elements with NO paint model are the historical contract (old dynamic strokes and today's
 *   silk-symmetry strokes, which are bounded-flow-incompatible): they resolve through the
 *   installed brush-id shortcut exactly as pre-seam builds did, so legacy documents replay
 *   byte-identically. Wet ids stay null here — their dynamics opt-in requires the versioned seam.
 * - Any explicit non-bounded paint model or wet pipeline fails closed to the legacy renderer.
 */
export function resolveStudioCapturedBrushDynamicsPresetId(input: Readonly<{
  brush?: unknown;
  brushDynamics?: unknown;
  paintModel?: unknown;
  watercolorPipeline?: unknown;
}>): StudioBrushDynamicsPresetId | null {
  if (input.watercolorPipeline !== undefined && input.watercolorPipeline !== null) return null;
  if (input.paintModel === "bounded-flow-v2") {
    return resolveStudioBrushDynamicsSelectionPresetId(input.brush, input.brushDynamics);
  }
  if (input.paintModel === undefined || input.paintModel === null) {
    return resolveStudioBrushDynamicsPresetId(input.brush);
  }
  return null;
}

export interface StudioBrushDynamicsPreset {
  id: StudioBrushDynamicsPresetId;
  name: string;
  description: string;
  settings: StudioBrushDynamicsSettings;
}

export interface NormalizedStudioBrushDynamicsMapping {
  source: StudioBrushDynamicsSource;
  mode: StudioBrushDynamicsMappingMode;
  from: number;
  to: number;
  amount: number;
  curve: number;
  curveMode?: "power" | "bezier";
  curveControlPoints?: readonly [number, number, number, number];
  curveLUT?: Float32Array | null;
  invert: boolean;
}

export interface NormalizedStudioBrushDynamicsJitter {
  mode: StudioBrushDynamicsMappingMode;
  amount: number;
}

export interface NormalizedStudioBrushDynamicsProperty {
  base: number;
  min: number;
  max: number;
  mappings: readonly NormalizedStudioBrushDynamicsMapping[];
  jitter: NormalizedStudioBrushDynamicsJitter | null;
}

export interface NormalizedStudioBrushDynamicsSettings {
  version: typeof STUDIO_BRUSH_DYNAMICS_SETTINGS_VERSION;
  /** Omitted for legacy snapshots so their canonical serialization remains byte-stable. */
  depositPipeline?: StudioDynamicBrushDepositPipeline;
  /**
   * Installed preset identity carried by preset-derived snapshots so selection/render resolvers
   * survive brush-id aliasing. Omitted for legacy snapshots to keep serialization byte-stable.
   */
  presetId?: StudioBrushDynamicsPresetId;
  /** Omitted for legacy v2 snapshots; malformed explicit pins fail normalization closed. */
  dryMediaUnionProgram?: StudioDryMediaUnionProgramPin;
  /**
   * Explicit kernel-dab-path opt-in (fresh authored dry-media presets only). Omitted whenever the
   * source snapshot omits it so persisted canonical serialization stays byte-stable; malformed
   * explicit pins fail normalization closed.
   */
  dryMediaKernelProgram?: StudioDryMediaKernelProgramPin;
  /**
   * Explicit linear-accumulation soft-falloff opt-in (fresh authored airbrush-family snapshots
   * only). Omitted whenever the source snapshot omits it so persisted canonical serialization
   * stays byte-stable; malformed explicit pins fail normalization closed.
   */
  softFalloffLinearProgram?: StudioSoftFalloffLinearProgramPin;
  /**
   * Omitted whenever the source snapshot omits it so persisted canonical serialization stays
   * byte-stable; malformed values drop closed and a default is never injected.
   */
  causalStampGridRule?: "causal-stamp-grid-v2";
  seed: number;
  fallbackPressure: number;
  maxSpeed: number;
  /** Omitted for legacy snapshots; renderers interpret absence as a zero geometry floor. */
  minimumDiameterRatio?: number;
  spacingRatio: number | null;
  scatterRatio: number | null;
  taper: NormalizedStudioBrushTaperSettings;
  tip: NormalizedStudioBrushTipSettings;
  colorDynamics: NormalizedStudioBrushColorDynamicsSettings;
  grain: NormalizedStudioBrushGrainSettings;
  tipLayers: readonly NormalizedStudioBrushTipLayerSettings[];
  /**
   * Omitted while it equals the no-op identity (disabled + untouched secondary tip), keeping the
   * canonical serialization of pre-dual-brush snapshots byte-stable. Consumers treat a missing
   * value as identity via `normalizeStudioBrushDualBrushSettings`/`composeStudioBrushDualTipAlphaMap`.
   */
  dualBrush?: NormalizedStudioBrushDualBrushSettings;
  width: NormalizedStudioBrushDynamicsProperty;
  opacity: NormalizedStudioBrushDynamicsProperty;
  flow: NormalizedStudioBrushDynamicsProperty;
  spacing: NormalizedStudioBrushDynamicsProperty;
  scatter: NormalizedStudioBrushDynamicsProperty;
  angle: NormalizedStudioBrushDynamicsProperty;
  roundness: NormalizedStudioBrushDynamicsProperty;
}

/** PointerEvent fields plus renderer-derived speed, direction and stable dab index. */
export interface StudioBrushDynamicsSample {
  pressure?: number;
  /** Pointer Events barrel pressure range (-1..1). */
  tangentialPressure?: number;
  /** CSS px/ms. */
  speed?: number;
  tiltX?: number;
  tiltY?: number;
  /** Pointer Events barrel rotation in degrees (0..359). */
  twist?: number;
  /** Stroke travel direction in degrees. */
  direction?: number;
  /** Stable per-stroke dab index used by the seeded random channels. */
  stampIndex?: number;
}

export interface NormalizedStudioBrushDynamicsSample {
  pressure: number;
  tangentialPressure: number;
  /** tangentialPressure remapped from -1..1 to 0..1 for property mappings. */
  tangentialPressureNormalized: number;
  speed: number;
  speedNormalized: number;
  tiltX: number;
  tiltY: number;
  tiltMagnitude: number;
  tiltAzimuth: number;
  twist: number;
  direction: number;
  hasTilt: boolean;
  hasDirection: boolean;
  stampIndex: number;
}

/** Fully resolved, finite recipe for one particle/dab. */
export interface StudioBrushDynamicsRecipe {
  /** `size` and `width` are identical aliases for particle and line renderers respectively. */
  size: number;
  width: number;
  opacity: number;
  flow: number;
  spacing: number;
  /** Maximum scatter radius before the deterministic offset is sampled. */
  scatter: number;
  scatterOffsetX: number;
  scatterOffsetY: number;
  scatterAngle: number;
  angle: number;
  roundness: number;
}

export interface StudioDynamicBrushPlanInput {
  /** Flat `[x0, y0, x1, y1, ...]` coordinates. Invalid pairs are ignored. */
  points: readonly number[];
  pressures?: readonly number[] | null;
  tangentialPressures?: readonly number[] | null;
  speeds?: readonly number[] | null;
  tiltXs?: readonly number[] | null;
  tiltYs?: readonly number[] | null;
  twists?: readonly number[] | null;
  /** Optional direction override in degrees; otherwise the path tangent is used. */
  directions?: readonly number[] | null;
  baseWidth: number;
  baseOpacity: number;
  settings?: StudioBrushDynamicsSettings | null;
  /** Overrides settings.seed for this stroke. */
  seed?: number;
  maxDabs?: number;
}

/**
 * Immutable geometry receipt for the station immediately preceding one dynamic dab.
 *
 * It is runtime-only metadata: DrawEl persistence still stores source points and dynamics, then
 * regenerates dabs. Connected carriers use the receipt so a suffix can reproduce the exact start
 * cross-section without reading a discarded live prefix or deriving it from the current tangent.
 */
export interface StudioDynamicBrushSegmentStartFrame {
  readonly index: number;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly direction: number;
  readonly size: number;
  readonly roundness: number;
  /** Runtime-only causal wear receipt; absent legacy fixtures remain valid. */
  readonly distanceFromStrokeStart?: number;
  /** Integrated `distance × contactFactor`, independent from the selected dab spacing. */
  readonly contactLoadFromStrokeStart?: number;
  /** Contact factor at this station, used for trapezoidal continuation integration. */
  readonly contactFactor?: number;
}

export interface StudioDynamicBrushDab {
  index: number;
  progress: number;
  /** Exact unscattered arc-length station, useful for editing and endpoint checks. */
  sourceX: number;
  sourceY: number;
  /**
   * Travel tangent at this station, in degrees. New planners persist it on the ephemeral dab so a
   * connected carrier can reproduce a suffix without looking behind the accepted live prefix.
   */
  direction?: number;
  /** Arc-length travelled from the preceding dab; zero for the initial tap. */
  distanceFromPrevious?: number;
  /** Exact source arc length at this station. Runtime-only and regenerated from source points. */
  distanceFromStrokeStart?: number;
  /** Integrated physical contact receipt used by wear-aware specialist carriers. */
  contactLoadFromStrokeStart?: number;
  /** Current contact factor (`size × opacity × flow`) for incremental continuation. */
  contactFactor?: number;
  /**
   * Exact previous-station frame for a non-initial segment. New canonical and causal planners
   * populate it; absence is retained only for legacy/manual dab fixtures and the initial tap.
   */
  segmentStartFrame?: StudioDynamicBrushSegmentStartFrame;
  x: number;
  y: number;
  size: number;
  opacity: number;
  flow: number;
  spacing: number;
  scatter: number;
  angle: number;
  roundness: number;
}

export interface StudioDynamicBrushPlan {
  dabs: StudioDynamicBrushDab[];
  sourcePointCount: number;
  totalLength: number;
  capped: boolean;
  settings: NormalizedStudioBrushDynamicsSettings;
}

export function studioDynamicBrushContactFactor(
  size: number,
  opacity: number,
  flow: number,
): number {
  const safeSize = Number.isFinite(size) ? Math.max(0, size) : 0;
  const safeOpacity = Number.isFinite(opacity)
    ? Math.min(1, Math.max(0, opacity))
    : 0;
  const safeFlow = Number.isFinite(flow)
    ? Math.min(1, Math.max(0, flow))
    : 0;
  return safeSize * safeOpacity * safeFlow;
}
