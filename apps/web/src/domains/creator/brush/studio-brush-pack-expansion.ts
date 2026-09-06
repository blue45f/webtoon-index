/**
 * 2026-07 procedural brush pack expansion wave — per-preset professional tuning data.
 *
 * The compact profile rows in studio-brush-pack-runtime.ts derive most parameters from the row
 * index, which is perfect for bulk variety but too coarse for presets that imitate a specific
 * physical tool (a G-pen's dramatic pressure swell, a pastel's canvas-pinned paper tooth, rain
 * falling at one fixed angle...). This module carries explicit, hand-tuned dynamics overrides for
 * the 73 expansion ids plus a deliberately tiny visibility-correction set for legacy soft media.
 *
 * Determinism: no override introduces a new random stream. Jitters/mappings run through the
 * engine's seeded planner and every grain override pins an explicit constant seed.
 */
import type {
  StudioBrushDynamicsPropertySettings,
  StudioBrushDynamicsSettings,
  StudioBrushTaperSettings,
} from "./studio-brush-dynamics";
import type {
  StudioBrushColorDynamicsSettings,
  StudioBrushGrainSettings,
} from "./studio-brush-material-dynamics";
import type { StudioBrushPackCatalogId } from "./studio-brush-pack-id";
import type { StudioBrushDualBrushSettings } from "./studio-brush-tip-composition";

/** Original procedural material/effect wave. Kept separate for coverage and visual regression. */
export const STUDIO_BRUSH_PACK_MATERIAL_WAVE_IDS = [
  "bristle-round-loaded",
  "bristle-fan-dry",
  "bristle-flat-streak",
  "palette-knife-edge",
  "watercolor-dry-granule",
  "watercolor-salt-bloom",
  "watercolor-backrun-ring",
  "watercolor-wet-wash",
  "gouache-grain-flat",
  "acrylic-stiff-flat",
  "oil-linen-filbert",
  "sumi-wash-fray",
  "ribbon-satin-fold",
  "rope-double-cord",
  "chain-link-alternate",
  "lace-scallop-trim",
  "stitch-running-thread",
  "stitch-cross-seam",
  "fabric-knit-loop",
  "metal-scratch-brush",
  "smoke-wisp-layered",
  "flame-tongue-spark",
  "rain-mist-combo",
  "snow-powder-drift",
  "dust-mote-depth",
  "stage-safe-splatter",
  "bokeh-ring-glow",
  "cloud-cirrus-stream",
  "foliage-broad-canopy",
  "tree-bark-crack",
  "flower-petal-scatter",
  "rock-shard-texture",
  "brick-mortar-pattern",
  "wood-knot-rake",
  "fur-undercoat-soft",
  "hair-curl-ribbon",
  "food-sesame-sprinkle",
  "halftone-gradient-dot",
  "hatching-contour-rake",
  "focus-ray-streak",
] as const satisfies readonly StudioBrushPackCatalogId[];

/** Ids appended by the 2026-07 expansions, in catalogue order. Used by tests and tuning. */
export const STUDIO_BRUSH_PACK_EXPANSION_WAVE_IDS = [
  "pencil-4b-rough",
  "pencil-hb-mechanical",
  "pencil-colored-soft",
  "pencil-charcoal-stick",
  "pencil-tilt-shading",
  "g-pen-flex",
  "maru-pen-fine",
  "spoon-pen-round",
  "brush-pen-ink",
  "calligraphy-tilt-nib",
  "milli-pen-uniform",
  "watercolor-wet-bleed",
  "watercolor-edge-stain",
  "oil-impasto-heavy",
  "oil-dry-scumble",
  "pastel-paper-soft",
  "crayon-wax-bold",
  "airbrush-grand-soft",
  "sponge-stipple-dab",
  "marker-colorless-blender",
  "marker-wide-chisel",
  "spray-noise-fine",
  "stardust-star-scatter",
  "leaf-fall-flurry",
  "cloud-billow-soft",
  "rope-twist-stamp",
  "halftone-sparse-dot",
  "rain-streak-diagonal",
  "sparkle-glint-cross",
  "snow-flurry-flake",
  "ink-splatter-burst",
  "fur-soft-clumps",
  "wood-grain-flow",
  ...STUDIO_BRUSH_PACK_MATERIAL_WAVE_IDS,
] as const satisfies readonly StudioBrushPackCatalogId[];

export type StudioBrushPackExpansionWaveId =
  (typeof STUDIO_BRUSH_PACK_EXPANSION_WAVE_IDS)[number];

/**
 * Original soft-media profiles whose first browser stroke fell below a useful contrast floor.
 * Keeping this set explicit prevents a general opacity multiplier from flattening the catalogue.
 */
export const STUDIO_BRUSH_PACK_VISIBILITY_TUNING_IDS = [
  "mist-soft",
  "bokeh-scatter",
  "bleeding-stain",
  "cotton-fiber",
  "watercolor-flat-wash",
] as const satisfies readonly StudioBrushPackCatalogId[];

type StudioBrushPackVisibilityTuningId =
  (typeof STUDIO_BRUSH_PACK_VISIBILITY_TUNING_IDS)[number];

/**
 * Original presets whose formula-built carrier cadence broke the mark they are named after.
 * `dry-rake` carried a +0.15 authored spacing offset on top of the dry-media base, three times
 * the cadence of the sibling rakes (0.11–0.12): each stamp of its bristle-row alpha map landed
 * as an isolated bar, so a drag read as a picket fence instead of the parallel scratches a rake
 * leaves (long gate: 1.8× the neighbouring spacing, bars visible in every frame).
 */
export const STUDIO_BRUSH_PACK_CARRIER_TUNING_IDS = [
  "dry-rake",
] as const satisfies readonly StudioBrushPackCatalogId[];

type StudioBrushPackCarrierTuningId =
  (typeof STUDIO_BRUSH_PACK_CARRIER_TUNING_IDS)[number];
type StudioBrushPackTuningId =
  | StudioBrushPackExpansionWaveId
  | StudioBrushPackVisibilityTuningId
  | StudioBrushPackCarrierTuningId;

/**
 * Additive override applied on top of the formula-built settings snapshot before normalization.
 * Channel objects merge shallowly (`{ ...formula, ...override }`), so an override that only sets
 * `jitter` keeps the formula's mappings. `width.base`/`opacity.base` are re-asserted by the
 * runtime after merging — catalogue width and toolbar opacity remain the artist's outer controls.
 */
export interface StudioBrushPackExpansionTuning {
  /** Edge softness for the primary procedural tip (0 = sharp, 1 = softest). */
  tipSoftness?: number;
  /** CSS px/ms at which the normalized speed source saturates. Lower = livelier speed response. */
  maxSpeed?: number;
  /** Dab spacing as a tip-width ratio. */
  spacingRatio?: number;
  /** Scatter radius as a tip-width ratio. */
  scatterRatio?: number;
  taper?: StudioBrushTaperSettings;
  colorDynamics?: StudioBrushColorDynamicsSettings;
  grain?: StudioBrushGrainSettings;
  dualBrush?: StudioBrushDualBrushSettings;
  width?: StudioBrushDynamicsPropertySettings;
  opacity?: StudioBrushDynamicsPropertySettings;
  flow?: StudioBrushDynamicsPropertySettings;
  spacing?: StudioBrushDynamicsPropertySettings;
  scatter?: StudioBrushDynamicsPropertySettings;
  angle?: StudioBrushDynamicsPropertySettings;
  roundness?: StudioBrushDynamicsPropertySettings;
}

const EXPANSION_TUNING: Readonly<
  Record<StudioBrushPackTuningId, StudioBrushPackExpansionTuning>
> = {
  // ── Legacy soft-media visibility corrections ──────────────────────────
  "mist-soft": {
    // Remains a build-up brush, but no longer starts below the browser's perceptual floor.
    tipSoftness: 0.72,
    // Dense soft carriers — wide spacing made mist draw as separated beads.
    spacingRatio: 0.09,
    scatterRatio: 0.04,
    flow: { base: 0.32, mappings: [{ source: "pressure", from: 0.52, to: 1, curve: 0.92 }] },
  },
  "bokeh-scatter": {
    // Preserve sparse light orbs while making a single pass legible on white paper.
    tipSoftness: 0.68,
    flow: { base: 0.38, mappings: [{ source: "pressure", from: 0.54, to: 1, curve: 0.96 }] },
  },
  "bleeding-stain": {
    // Keep the irregular sponge edge, but move one wash pass clear of the near-white floor.
    // Denser stations stop the stain reading as discrete round blobs while dragging.
    spacingRatio: 0.09,
    scatterRatio: 0.05,
    flow: { base: 0.34 },
  },
  "cotton-fiber": {
    // Preserve the cotton-soft custom hair map while a closer, less scattered carrier cadence
    // smooths its fibrous silhouette. The measured flow lifts useful strands above white-paper
    // contrast without crossing the preset's deliberately gradual first-contact density.
    spacingRatio: 0.2,
    scatterRatio: 0.22,
    flow: { base: 0.49 },
    grain: { space: "canvas-fixed", amount: 0.28, scale: 8.25, contrast: 0.38, seed: 0xebc6_79ee },
  },
  "watercolor-flat-wash": {
    // A flat wash should read on the first pass while retaining a deliberately low opacity ceiling.
    spacingRatio: 0.09,
    scatterRatio: 0.04,
    flow: { base: 0.28 },
  },

  // ── Carrier cadence corrections ─────────────────────────────────────────
  "dry-rake": {
    // Same cadence as the rakes that pass the continuity gate (hatching-contour-rake 0.11,
    // wood-knot-rake 0.12), so consecutive bristle-row stamps overlap into continuous scratches.
    // Less scatter keeps each bristle on its own line instead of smearing rows into each other.
    spacingRatio: 0.11,
    scatterRatio: 0.05,
  },

  // ── 연필/스케치 ─────────────────────────────────────────────────────────
  "pencil-4b-rough": {
    // Soft 4B lead: wide pressure swell, heavy canvas-pinned paper tooth.
    tipSoftness: 0.3,
    width: {
      mappings: [{ source: "pressure", from: 0.3, to: 1.6, curve: 1.35 }],
      jitter: { mode: "multiply", amount: 0.14 },
    },
    flow: { base: 0.6, mappings: [{ source: "pressure", from: 0.45, to: 1, curve: 1.2 }] },
    grain: { space: "canvas-fixed", amount: 0.42, scale: 3.2, contrast: 0.62, seed: 0x4b0a_1101 },
    taper: { startLength: 0.05, endLength: 0.12, minSizeRatio: 0.3, curve: 1.3 },
  },
  "pencil-hb-mechanical": {
    // Stiff HB refill: barely any pressure response, faint grain, short taper.
    tipSoftness: 0.05,
    width: {
      mappings: [{ source: "pressure", from: 0.62, to: 1.15, curve: 0.9 }],
      jitter: null,
    },
    flow: { base: 0.85 },
    grain: { space: "canvas-fixed", amount: 0.12, scale: 1.6, contrast: 0.4, seed: 0x4b0a_1102 },
    spacing: { mappings: [{ source: "speed", from: 0.9, to: 1.15 }] },
    taper: { startLength: 0.03, endLength: 0.06, minSizeRatio: 0.6, curve: 1 },
  },
  "pencil-colored-soft": {
    // Wax colored pencil: subtle deterministic hue drift between dabs. Preserve the deliberately
    // translucent wax flow while keeping a short click-flick from spending its whole 14px route at
    // a sub-pixel taper. These floors only affect the two endpoint ramps; long-stroke grain,
    // pressure swell and source-over accumulation keep their authored channels below.
    colorDynamics: { hueJitter: 6, saturationJitter: 0.05, valueJitter: 0.05 },
    taper: { minSizeRatio: 0.36, minOpacityRatio: 0.92 },
    width: {
      mappings: [{ source: "pressure", from: 0.4, to: 1.5, curve: 1.1 }],
      jitter: { mode: "multiply", amount: 0.1 },
    },
    flow: { base: 0.58, mappings: [{ source: "pressure", from: 0.5, to: 1 }] },
    grain: { space: "canvas-fixed", amount: 0.3, scale: 2.6, contrast: 0.5, seed: 0x4b0a_1103 },
    roundness: { jitter: { mode: "multiply", amount: 0.06 } },
  },
  "pencil-charcoal-stick": {
    // Charcoal: crumbling opacity, smears that travel with the stroke.
    tipSoftness: 0.22,
    width: {
      mappings: [{ source: "pressure", from: 0.35, to: 1.7, curve: 1.25 }],
      jitter: { mode: "multiply", amount: 0.2 },
    },
    opacity: { jitter: { mode: "multiply", amount: 0.2 } },
    flow: { base: 0.5, mappings: [{ source: "pressure", from: 0.4, to: 1 }] },
    grain: { space: "stroke-fixed", amount: 0.5, scale: 4.5, contrast: 0.55, seed: 0x4b0a_1104 },
  },
  "pencil-tilt-shading": {
    // Side-of-lead shading: tilt magnitude broadens and flattens the mark.
    width: {
      mappings: [
        { source: "pressure", from: 0.5, to: 1.2 },
        { source: "tilt-magnitude", from: 0.8, to: 2.2, curve: 1.1 },
      ],
    },
    roundness: { mappings: [{ source: "tilt-magnitude", from: 1, to: 0.4 }] },
    flow: { base: 0.42, mappings: [{ source: "pressure", from: 0.5, to: 1 }] },
    grain: { space: "canvas-fixed", amount: 0.36, scale: 3.8, contrast: 0.5, seed: 0x4b0a_1105 },
  },

  // ── 펜/잉크 ────────────────────────────────────────────────────────────
  "g-pen-flex": {
    // Manga G-pen: dramatic 0.12x→1.9x swell and a long thin exit stroke.
    tipSoftness: 0.03,
    width: {
      mappings: [{ source: "pressure", from: 0.12, to: 1.9, curve: 1.5 }],
      jitter: null,
    },
    taper: {
      startLength: 0.03,
      endLength: 0.22,
      minSizeRatio: 0.05,
      minOpacityRatio: 0.85,
      curve: 1.6,
    },
    flow: { base: 0.95, mappings: [] },
    spacing: { mappings: [{ source: "speed", from: 0.85, to: 1.2 }] },
  },
  "maru-pen-fine": {
    // Maru (mapping) nib: stiff, precise, nearly constant hairline.
    tipSoftness: 0.02,
    width: {
      mappings: [{ source: "pressure", from: 0.5, to: 1.25, curve: 1.1 }],
      jitter: null,
    },
    opacity: { mappings: [{ source: "pressure", from: 0.75, to: 1 }] },
    taper: { startLength: 0.02, endLength: 0.08, minSizeRatio: 0.35, minOpacityRatio: 0.9, curve: 1.1 },
    flow: { base: 1, mappings: [] },
  },
  "spoon-pen-round": {
    // Spoon (school) nib: gentle early swell, forgiving dialogue-line feel.
    width: {
      mappings: [{ source: "pressure", from: 0.42, to: 1.45, curve: 0.85 }],
      jitter: null,
    },
    taper: { startLength: 0.04, endLength: 0.12, minSizeRatio: 0.25, curve: 1.05 },
    flow: { base: 0.98, mappings: [] },
  },
  "brush-pen-ink": {
    // Sumi brush pen: pressure loads ink, speed starves the bristles.
    tipSoftness: 0.12,
    // The compact profile's inherited 0.1217 tip ratio left visible holes when both speed
    // starvation and the long exit taper made the tip narrow. Keep the expressive width/flow
    // response, but stamp densely enough that a fast curved stroke remains one continuous mark.
    spacingRatio: 0.06,
    width: {
      mappings: [
        { source: "pressure", from: 0.18, to: 2, curve: 1.3 },
        { source: "speed", from: 1.05, to: 0.72 },
      ],
    },
    taper: {
      startLength: 0.05,
      endLength: 0.3,
      minSizeRatio: 0.04,
      minOpacityRatio: 0.4,
      curve: 1.8,
    },
    flow: { base: 0.9, mappings: [{ source: "pressure", from: 0.7, to: 1 }] },
  },
  "calligraphy-tilt-nib": {
    // Broad-edge nib: the flat follows the stylus azimuth/barrel, not the stroke direction.
    width: { mappings: [{ source: "pressure", from: 0.55, to: 1.3, curve: 0.95 }] },
    angle: {
      mappings: [
        { source: "tilt-azimuth", mode: "add", from: 0, to: 360, amount: 0.85 },
        { source: "twist", mode: "add", from: 0, to: 360, amount: 0.4 },
      ],
      jitter: null,
    },
    roundness: { mappings: [{ source: "tilt-magnitude", from: 1, to: 0.6, amount: 0.6 }] },
    taper: { startLength: 0.04, endLength: 0.1, minSizeRatio: 0.4, curve: 1 },
    flow: { base: 0.96 },
  },
  "milli-pen-uniform": {
    // Technical liner: pressure is ignored entirely; the line never varies.
    width: { mappings: [], jitter: null },
    opacity: { mappings: [] },
    flow: { base: 1, mappings: [] },
    spacingRatio: 0.09,
  },

  // ── 채색 ───────────────────────────────────────────────────────────────
  "watercolor-wet-bleed": {
    // Wet-on-wet wash: slow strokes deposit more water, fast strokes dry out.
    // Soft tips hide most of the tip disk — keep stations dense so live strokes do not bead.
    tipSoftness: 0.86,
    spacingRatio: 0.085,
    scatterRatio: 0.035,
    spacing: { mappings: [] },
    flow: {
      base: 0.46,
      mappings: [
        { source: "pressure", from: 0.5, to: 1 },
        { source: "speed", from: 1.12, to: 0.78 },
      ],
    },
    opacity: { mappings: [{ source: "pressure", from: 0.35, to: 1, curve: 0.8 }] },
    width: { mappings: [{ source: "pressure", from: 0.75, to: 1.35 }] },
    grain: { space: "stroke-fixed", amount: 0.18, scale: 9, contrast: 0.3, seed: 0x4b0a_1201 },
  },
  "watercolor-edge-stain": {
    // Drying pool: high-contrast canvas-pinned blotches read as pigment edges.
    tipSoftness: 0.75,
    spacingRatio: 0.09,
    scatterRatio: 0.05,
    flow: { base: 0.36, mappings: [{ source: "pressure", from: 0.45, to: 1 }] },
    opacity: { jitter: { mode: "multiply", amount: 0.15 } },
    grain: { space: "canvas-fixed", amount: 0.34, scale: 14, contrast: 0.7, seed: 0x4b0a_1202 },
    // Mild scatter only — wide speed scatter reopened visible holes in the wash body.
    scatter: { mappings: [{ source: "speed", from: 0.85, to: 1.1 }] },
  },
  "oil-impasto-heavy": {
    // Impasto: near-continuous dabs plus stroke-locked ridge grain = thick paint.
    spacingRatio: 0.045,
    flow: { base: 0.95, mappings: [] },
    width: {
      mappings: [{ source: "pressure", from: 0.6, to: 1.35, curve: 0.8 }],
      jitter: { mode: "multiply", amount: 0.08 },
    },
    roundness: { jitter: { mode: "multiply", amount: 0.08 } },
    grain: { space: "stroke-fixed", amount: 0.5, scale: 5.5, contrast: 0.75, seed: 0x4b0a_1203 },
    colorDynamics: { valueJitter: 0.045 },
  },
  "oil-dry-scumble": {
    // Dry brush: speed starves flow so fast passes break over the canvas tooth.
    flow: {
      base: 0.5,
      mappings: [
        { source: "pressure", from: 0.5, to: 1 },
        { source: "speed", from: 1.1, to: 0.55 },
      ],
    },
    opacity: { jitter: { mode: "multiply", amount: 0.18 } },
    width: {
      mappings: [{ source: "pressure", from: 0.55, to: 1.3 }],
      jitter: { mode: "multiply", amount: 0.16 },
    },
    grain: { space: "canvas-fixed", amount: 0.44, scale: 3, contrast: 0.68, seed: 0x4b0a_1204 },
  },
  "pastel-paper-soft": {
    // Soft pastel: strong paper tooth pinned to the canvas, powder-light flow. The old near-round
    // sponge (roundness≈.85) exposed every station as a circle on long strokes. A tangent-aligned
    // low-roundness fibre keeps the same R8 paper grain while forming one continuous powder band.
    tipSoftness: 0.55,
    spacingRatio: 0.12,
    scatterRatio: 0.04,
    flow: { base: 0.38, mappings: [{ source: "pressure", from: 0.55, to: 1 }] },
    width: { mappings: [{ source: "pressure", from: 0.7, to: 1.2 }] },
    angle: {
      base: 0,
      mappings: [{ source: "direction", mode: "add", from: 0, to: 360 }],
      jitter: { mode: "add", amount: 4 },
    },
    roundness: {
      base: 0.24,
      mappings: [{ source: "pressure", from: 0.2, to: 0.3 }],
      jitter: { mode: "multiply", amount: 0.06 },
    },
    grain: { space: "canvas-fixed", amount: 0.55, scale: 6, contrast: 0.5, seed: 0x4b0a_1205 },
  },
  "crayon-wax-bold": {
    // Wax crayon: streaks drag with the stroke, hard pressure packs the wax.
    flow: { base: 0.85, mappings: [{ source: "pressure", from: 0.6, to: 1 }] },
    opacity: { mappings: [{ source: "pressure", from: 0.5, to: 1, curve: 1.4 }] },
    grain: { space: "stroke-fixed", amount: 0.4, scale: 2.2, contrast: 0.8, seed: 0x4b0a_1206 },
    roundness: { jitter: { mode: "multiply", amount: 0.05 } },
  },
  "airbrush-grand-soft": {
    // Grand airbrush: size stays stable; pressure only meters the paint.
    tipSoftness: 0.52,
    // The compact catalogue formula produced a 39.55%-of-diameter cadence, exposing individual
    // 64px nozzles as beads. An analytic soft falloff still needs dense stations to behave like a
    // continuous spray envelope; flow is reduced so that density builds tone instead of instantly
    // clipping to an opaque ribbon.
    spacingRatio: 0.09,
    flow: { base: 0.37, mappings: [{ source: "pressure", from: 0.38, to: 1, curve: 0.85 }] },
    width: { mappings: [{ source: "pressure", from: 0.85, to: 1.15 }], jitter: null },
    taper: { enabled: false },
    scatterRatio: 0.025,
  },
  "sponge-stipple-dab": {
    // Stipple: dabs separate into distinct sponge prints with rotational chaos.
    spacingRatio: 0.82,
    width: {
      mappings: [{ source: "pressure", from: 0.5, to: 1.6 }],
      jitter: { mode: "multiply", amount: 0.3 },
    },
    angle: { jitter: { mode: "add", amount: 90 } },
    scatter: { jitter: { mode: "add", amount: 0.3 } },
    flow: { base: 0.75, mappings: [{ source: "pressure", from: 0.6, to: 1 }] },
  },
  "marker-colorless-blender": {
    // Low-flow glaze marker: softly layers the selected colour without pretending to sample
    // or redistribute destination pixels like a true blender/smudge engine.
    tipSoftness: 0.7,
    flow: { base: 0.4, mappings: [{ source: "pressure", from: 0.44, to: 1 }] },
    opacity: { mappings: [{ source: "pressure", from: 0.3, to: 1 }] },
    width: { mappings: [{ source: "pressure", from: 0.9, to: 1.1 }], jitter: null },
  },
  "marker-wide-chisel": {
    // Poster chisel: fixed-angle flat held steady; only layering builds tone.
    tipSoftness: 0.04,
    spacingRatio: 0.06,
    width: { mappings: [], jitter: null },
    opacity: { mappings: [] },
    flow: { base: 0.6, mappings: [{ source: "pressure", from: 0.75, to: 1 }] },
  },

  // ── 효과/질감 ──────────────────────────────────────────────────────────
  "spray-noise-fine": {
    // Noise spray: huge scatter radius, speed widens the cone.
    spacingRatio: 0.5,
    scatterRatio: 1.15,
    width: {
      mappings: [{ source: "pressure", from: 0.3, to: 1.2 }],
      jitter: { mode: "multiply", amount: 0.5 },
    },
    opacity: { jitter: { mode: "multiply", amount: 0.3 } },
    flow: { base: 0.5 },
    scatter: {
      mappings: [{ source: "speed", from: 0.5, to: 1.6 }],
      jitter: { mode: "add", amount: 0.4 },
    },
  },
  "stardust-star-scatter": {
    // Stardust: fully random star rotation and size, gentle hue shimmer.
    spacingRatio: 0.75,
    width: {
      mappings: [{ source: "pressure", from: 0.6, to: 1.3 }],
      jitter: { mode: "multiply", amount: 0.45 },
    },
    angle: { jitter: { mode: "add", amount: 180 } },
    opacity: { jitter: { mode: "multiply", amount: 0.25 } },
    colorDynamics: { hueJitter: 8, valueJitter: 0.12 },
    scatter: { jitter: { mode: "add", amount: 0.4 } },
  },
  "leaf-fall-flurry": {
    // Falling leaves: tumbling rotation (no direction-follow) and autumn hue spread.
    angle: { jitter: { mode: "add", amount: 150 } },
    colorDynamics: { hueJitter: 14, saturationJitter: 0.08, valueJitter: 0.09 },
    scatter: {
      mappings: [{ source: "speed", from: 0.6, to: 1.5 }],
      jitter: { mode: "add", amount: 0.3 },
    },
    width: {
      mappings: [{ source: "pressure", from: 0.55, to: 1.4 }],
      jitter: { mode: "multiply", amount: 0.35 },
    },
  },
  "cloud-billow-soft": {
    // Cumulus smoke: giant soft dabs shaped by very large canvas-pinned noise.
    tipSoftness: 0.58,
    // Keep the cloud airy, but make the first contact readable on a white webtoon canvas.
    flow: { base: 0.34, mappings: [{ source: "pressure", from: 0.38, to: 1, curve: 0.75 }] },
    width: {
      mappings: [{ source: "pressure", from: 0.8, to: 1.2 }],
      jitter: { mode: "multiply", amount: 0.25 },
    },
    roundness: { jitter: { mode: "multiply", amount: 0.12 } },
    grain: { space: "canvas-fixed", amount: 0.3, scale: 22, contrast: 0.45, seed: 0x4b0a_1301 },
  },
  "rope-twist-stamp": {
    // Rope: one twist segment per tip width, aligned to the stroke direction.
    spacingRatio: 0.98,
    width: { mappings: [{ source: "pressure", from: 0.85, to: 1.1 }], jitter: null },
    flow: { base: 1, mappings: [] },
  },
  "halftone-sparse-dot": {
    // Sparse screentone: pressure drives dot gain like a real tone gradient.
    spacingRatio: 0.42,
    width: {
      mappings: [{ source: "pressure", from: 0.6, to: 1.5, curve: 1.2 }],
      jitter: null,
    },
    flow: { base: 1, mappings: [] },
  },
  "rain-streak-diagonal": {
    // Rain: streaks keep one fixed diagonal; stroke speed stretches and spreads them. Pressure is
    // deliberately a weak pigment/deposit control rather than another width input, so a stylus can
    // bring the rain forward without destroying the authored velocity-shaped silhouette.
    maxSpeed: 1.1,
    width: {
      mappings: [{ source: "speed", from: 0.7, to: 1.5 }],
      jitter: { mode: "multiply", amount: 0.2 },
    },
    angle: { jitter: { mode: "add", amount: 4 } },
    opacity: {
      mappings: [{ source: "pressure", from: 0.86, to: 1, curve: 0.9 }],
      jitter: { mode: "multiply", amount: 0.3 },
    },
    scatter: { jitter: { mode: "add", amount: 0.5 } },
    spacing: { mappings: [{ source: "speed", from: 0.7, to: 1.7 }] },
    flow: {
      base: 0.85,
      mappings: [{ source: "pressure", from: 0.82, to: 1, curve: 0.88 }],
    },
  },
  "sparkle-glint-cross": {
    // Glints: isolated cross-flare stamps with strong size variance, mostly upright.
    spacingRatio: 1.05,
    width: {
      mappings: [{ source: "pressure", from: 0.6, to: 1.4 }],
      jitter: { mode: "multiply", amount: 0.55 },
    },
    angle: { jitter: { mode: "add", amount: 24 } },
    colorDynamics: { valueJitter: 0.15 },
    scatter: { jitter: { mode: "add", amount: 0.35 } },
  },
  "snow-flurry-flake": {
    // Snow: tumbling flakes, speed widens the flurry, gentle brightness shimmer.
    angle: { jitter: { mode: "add", amount: 180 } },
    width: {
      mappings: [{ source: "pressure", from: 0.7, to: 1.25 }],
      jitter: { mode: "multiply", amount: 0.4 },
    },
    opacity: { jitter: { mode: "multiply", amount: 0.2 } },
    scatter: { mappings: [{ source: "speed", from: 0.6, to: 1.5 }] },
    flow: { base: 0.9 },
    colorDynamics: { valueJitter: 0.06 },
  },
  "ink-splatter-burst": {
    // Splatter: pressure (not speed) drives the burst radius — press to explode.
    scatter: {
      mappings: [{ source: "pressure", from: 0.5, to: 1.7, curve: 1.3 }],
      jitter: { mode: "add", amount: 0.3 },
    },
    width: {
      mappings: [{ source: "pressure", from: 0.5, to: 1.3 }],
      jitter: { mode: "multiply", amount: 0.6 },
    },
    opacity: { jitter: { mode: "multiply", amount: 0.15 } },
    flow: { base: 0.95 },
  },
  "fur-soft-clumps": {
    // Fur: strand fans diverge from the stroke and thin out at the tip.
    angle: { jitter: { mode: "add", amount: 26 } },
    taper: {
      startLength: 0.08,
      endLength: 0.28,
      minSizeRatio: 0.1,
      minOpacityRatio: 0.45,
      curve: 1.4,
    },
    width: { mappings: [{ source: "pressure", from: 0.4, to: 1.3 }] },
    flow: { base: 0.8, mappings: [{ source: "pressure", from: 0.6, to: 1 }] },
  },
  "wood-grain-flow": {
    // Wood grain: fibre lines ride the stroke while rings stay locked to it.
    grain: { space: "stroke-fixed", amount: 0.42, scale: 7, contrast: 0.6, seed: 0x4b0a_1302 },
    width: { mappings: [{ source: "pressure", from: 0.7, to: 1.25 }] },
    roundness: { jitter: { mode: "multiply", amount: 0.06 } },
    flow: { base: 0.62, mappings: [{ source: "pressure", from: 0.55, to: 1 }] },
  },

  // ── 재료 확장: 강모·나이프·수채·불투명 물감 ─────────────────────────
  "bristle-round-loaded": {
    tipSoftness: 0.1,
    spacingRatio: 0.055,
    width: {
      mappings: [
        { source: "pressure", from: 0.28, to: 1.72, curve: 1.22 },
        { source: "tilt-magnitude", from: 0.9, to: 1.28, amount: 0.45 },
      ],
      jitter: { mode: "multiply", amount: 0.07 },
    },
    flow: { base: 0.86, mappings: [{ source: "pressure", from: 0.46, to: 1 }] },
    angle: {
      mappings: [
        { source: "direction", mode: "add", from: 0, to: 360 },
        { source: "tilt-azimuth", mode: "add", from: 0, to: 360, amount: 0.18 },
      ],
    },
    grain: { space: "stroke-fixed", amount: 0.22, scale: 3.8, contrast: 0.46, seed: 0x4b0a_2101 },
    dualBrush: {
      enabled: true,
      tip: { shape: "bristle", softness: 0.12 },
      blendMode: "multiply",
      sizeRatio: 0.72,
    },
  },
  "bristle-fan-dry": {
    tipSoftness: 0.04,
    spacingRatio: 0.2,
    scatterRatio: 0.09,
    width: {
      mappings: [
        { source: "pressure", from: 0.42, to: 1.38, curve: 1.1 },
        { source: "tilt-magnitude", from: 0.88, to: 1.42, amount: 0.7 },
      ],
      jitter: { mode: "multiply", amount: 0.16 },
    },
    opacity: { jitter: { mode: "multiply", amount: 0.18 } },
    flow: {
      base: 0.58,
      mappings: [
        { source: "pressure", from: 0.38, to: 1 },
        { source: "speed", from: 1.08, to: 0.62 },
      ],
    },
    grain: { space: "canvas-fixed", amount: 0.48, scale: 5.6, contrast: 0.72, seed: 0x4b0a_2102 },
    dualBrush: {
      enabled: true,
      tip: { shape: "grain", softness: 0.04 },
      blendMode: "multiply",
      sizeRatio: 0.82,
    },
  },
  "bristle-flat-streak": {
    tipSoftness: 0.06,
    spacingRatio: 0.07,
    width: {
      mappings: [
        { source: "pressure", from: 0.52, to: 1.36 },
        { source: "speed", from: 1.08, to: 0.76, amount: 0.75 },
      ],
      jitter: { mode: "multiply", amount: 0.08 },
    },
    roundness: {
      mappings: [{ source: "tilt-magnitude", from: 0.82, to: 0.38, amount: 0.7 }],
      jitter: { mode: "multiply", amount: 0.04 },
    },
    flow: { base: 0.76, mappings: [{ source: "pressure", from: 0.48, to: 1 }] },
    grain: { space: "stroke-fixed", amount: 0.36, scale: 4.4, contrast: 0.58, seed: 0x4b0a_2103 },
    dualBrush: {
      enabled: true,
      tip: { shape: "bristle", softness: 0.02 },
      blendMode: "multiply",
      sizeRatio: 1.18,
    },
  },
  "palette-knife-edge": {
    tipSoftness: 0.015,
    spacingRatio: 0.045,
    width: {
      mappings: [
        { source: "pressure", from: 0.72, to: 1.42, curve: 0.82 },
        { source: "tilt-magnitude", from: 0.78, to: 1.24, amount: 0.55 },
      ],
      jitter: null,
    },
    angle: {
      mappings: [
        { source: "direction", mode: "add", from: 0, to: 360 },
        { source: "twist", mode: "add", from: 0, to: 360, amount: 0.34 },
      ],
      jitter: { mode: "add", amount: 1.5 },
    },
    flow: { base: 0.92, mappings: [{ source: "speed", from: 1, to: 0.7 }] },
    grain: { space: "canvas-fixed", amount: 0.28, scale: 7.2, contrast: 0.68, seed: 0x4b0a_2104 },
    dualBrush: {
      enabled: true,
      tip: { shape: "grain", softness: 0 },
      blendMode: "multiply",
      sizeRatio: 0.58,
    },
  },
  "watercolor-dry-granule": {
    tipSoftness: 0.2,
    spacingRatio: 0.18,
    width: {
      mappings: [
        { source: "pressure", from: 0.48, to: 1.4 },
        { source: "speed", from: 1.12, to: 0.74 },
      ],
      jitter: { mode: "multiply", amount: 0.16 },
    },
    opacity: { jitter: { mode: "multiply", amount: 0.2 } },
    // Browser pixel QA showed the previous 0.52 base left the committed paper-granule carrier at
    // mean Δ6.9/P95 Δ12 on white paper. Raise pigment load—not element opacity—so pressure,
    // texture holes and layer compositing remain honest while useful grains clear the perceptual
    // contrast floor.
    flow: { base: 0.68, mappings: [{ source: "pressure", from: 0.42, to: 1 }] },
    grain: { space: "canvas-fixed", amount: 0.5, scale: 4.8, contrast: 0.66, seed: 0x4b0a_2105 },
    colorDynamics: { hueJitter: 2.5, saturationJitter: 0.025, valueJitter: 0.045 },
    dualBrush: {
      enabled: true,
      tip: { shape: "sponge", softness: 0.18 },
      blendMode: "multiply",
      sizeRatio: 1.12,
    },
  },
  "watercolor-salt-bloom": {
    tipSoftness: 0.08,
    spacingRatio: 0.48,
    scatterRatio: 0.34,
    width: {
      mappings: [{ source: "pressure", from: 0.54, to: 1.52 }],
      jitter: { mode: "multiply", amount: 0.34 },
    },
    opacity: { jitter: { mode: "multiply", amount: 0.24 } },
    flow: { base: 0.34, mappings: [{ source: "pressure", from: 0.36, to: 0.92 }] },
    angle: { jitter: { mode: "add", amount: 180 } },
    scatter: {
      mappings: [{ source: "speed", from: 0.74, to: 1.34 }],
      jitter: { mode: "add", amount: 0.34 },
    },
    grain: { space: "canvas-fixed", amount: 0.44, scale: 9.5, contrast: 0.58, seed: 0x4b0a_2106 },
    colorDynamics: { hueJitter: 3, saturationJitter: 0.02, valueJitter: 0.08 },
  },
  "watercolor-backrun-ring": {
    tipSoftness: 0.42,
    // Continuous wash body — denser than the old sparse ring scatter so the stroke does not bead.
    spacingRatio: 0.12,
    scatterRatio: 0.08,
    width: {
      mappings: [{ source: "pressure", from: 0.66, to: 1.55, curve: 0.9 }],
      jitter: { mode: "multiply", amount: 0.22 },
    },
    // Preserve the translucent backrun while keeping first contact above the planner's
    // 12-channel white-paper visibility floor after denser carrier + soft dual-tip sampling.
    flow: { base: 0.355, mappings: [{ source: "pressure", from: 0.3, to: 0.9 }] },
    opacity: { jitter: { mode: "multiply", amount: 0.16 } },
    angle: { jitter: { mode: "add", amount: 140 } },
    grain: { space: "canvas-fixed", amount: 0.24, scale: 14, contrast: 0.5, seed: 0x4b0a_2107 },
    dualBrush: {
      enabled: true,
      tip: { shape: "soft", softness: 0.78 },
      blendMode: "screen",
      sizeRatio: 1.35,
    },
  },
  "watercolor-wet-wash": {
    tipSoftness: 0.88,
    spacingRatio: 0.085,
    scatterRatio: 0.035,
    spacing: { mappings: [] },
    maxSpeed: 1.05,
    width: {
      mappings: [
        { source: "pressure", from: 0.76, to: 1.3 },
        { source: "tilt-magnitude", from: 0.86, to: 1.48, amount: 0.62 },
      ],
      jitter: { mode: "multiply", amount: 0.1 },
    },
    // Slightly higher base after denser soft dual-tip carriers so first contact stays ≥Δ12.
    flow: {
      base: 0.43,
      mappings: [
        { source: "pressure", from: 0.3, to: 1 },
        { source: "speed", from: 1.08, to: 0.62 },
      ],
    },
    grain: { space: "canvas-fixed", amount: 0.18, scale: 18, contrast: 0.36, seed: 0x4b0a_2108 },
    dualBrush: {
      enabled: true,
      tip: { shape: "sponge", softness: 0.64 },
      blendMode: "screen",
      sizeRatio: 1.5,
    },
  },
  "gouache-grain-flat": {
    tipSoftness: 0.08,
    spacingRatio: 0.06,
    width: {
      mappings: [{ source: "pressure", from: 0.62, to: 1.34 }],
      jitter: { mode: "multiply", amount: 0.06 },
    },
    flow: { base: 0.84, mappings: [{ source: "pressure", from: 0.7, to: 1 }] },
    opacity: { jitter: { mode: "multiply", amount: 0.05 } },
    grain: { space: "canvas-fixed", amount: 0.34, scale: 3.2, contrast: 0.62, seed: 0x4b0a_2109 },
    dualBrush: {
      enabled: true,
      tip: { shape: "grain", softness: 0.05 },
      blendMode: "multiply",
      sizeRatio: 0.9,
    },
  },
  "acrylic-stiff-flat": {
    tipSoftness: 0.025,
    spacingRatio: 0.045,
    width: {
      mappings: [{ source: "pressure", from: 0.68, to: 1.32, curve: 0.82 }],
      jitter: null,
    },
    angle: {
      mappings: [
        { source: "direction", mode: "add", from: 0, to: 360 },
        { source: "tilt-azimuth", mode: "add", from: 0, to: 360, amount: 0.26 },
      ],
      jitter: null,
    },
    roundness: { mappings: [{ source: "tilt-magnitude", from: 0.86, to: 0.42, amount: 0.75 }] },
    flow: { base: 0.96, mappings: [] },
    taper: { startLength: 0.025, endLength: 0.08, minSizeRatio: 0.36, curve: 1.2 },
  },
  "oil-linen-filbert": {
    tipSoftness: 0.1,
    spacingRatio: 0.035,
    width: {
      mappings: [{ source: "pressure", from: 0.44, to: 1.58, curve: 1.14 }],
      jitter: { mode: "multiply", amount: 0.08 },
    },
    flow: { base: 0.88, mappings: [{ source: "pressure", from: 0.62, to: 1 }] },
    grain: { space: "canvas-fixed", amount: 0.46, scale: 5.2, contrast: 0.7, seed: 0x4b0a_210b },
    roundness: {
      mappings: [{ source: "tilt-magnitude", from: 0.92, to: 0.56, amount: 0.66 }],
      jitter: { mode: "multiply", amount: 0.035 },
    },
    dualBrush: {
      enabled: true,
      tip: { shape: "bristle", softness: 0.08 },
      blendMode: "multiply",
      sizeRatio: 1.08,
    },
  },
  "sumi-wash-fray": {
    tipSoftness: 0.14,
    spacingRatio: 0.08,
    maxSpeed: 1.1,
    width: {
      mappings: [
        { source: "pressure", from: 0.2, to: 1.86, curve: 1.34 },
        { source: "speed", from: 1.08, to: 0.7 },
      ],
      jitter: { mode: "multiply", amount: 0.1 },
    },
    flow: {
      base: 0.72,
      mappings: [
        { source: "pressure", from: 0.42, to: 1 },
        { source: "speed", from: 1.04, to: 0.54 },
      ],
    },
    // A 7 px mouse flick replaces the initial tap with start-taper deposits. The previous
    // 4% diameter / 30% opacity floor could quantize the multiplied sumi × bristle tip to
    // 0–3 alpha for otherwise valid seeds, making a released short stroke appear to vanish.
    // Keep the body, grain, flow, dual-tip and long tail unchanged; only lift that start floor.
    taper: { startLength: 0.05, endLength: 0.32, minSizeRatio: 0.12, minOpacityRatio: 0.62, curve: 1.7 },
    grain: { space: "stroke-fixed", amount: 0.38, scale: 4.1, contrast: 0.64, seed: 0x4b0a_210c },
    dualBrush: {
      enabled: true,
      tip: { shape: "bristle", softness: 0.04 },
      blendMode: "multiply",
      sizeRatio: 0.76,
    },
  },

  // ── 장식·직물·소재 패턴 ───────────────────────────────────────────────
  "ribbon-satin-fold": {
    tipSoftness: 0.12,
    spacingRatio: 0.24,
    width: {
      mappings: [
        { source: "pressure", from: 0.72, to: 1.32 },
        { source: "tilt-magnitude", from: 0.92, to: 1.18, amount: 0.35 },
      ],
      jitter: null,
    },
    flow: { base: 0.96, mappings: [] },
    angle: {
      mappings: [
        { source: "direction", mode: "add", from: 0, to: 360 },
        { source: "twist", mode: "add", from: 0, to: 360, amount: 0.18 },
      ],
    },
    colorDynamics: { hueJitter: 1.5, saturationJitter: 0.015, valueJitter: 0.09 },
  },
  "rope-double-cord": {
    tipSoftness: 0.04,
    spacingRatio: 0.48,
    width: {
      mappings: [{ source: "pressure", from: 0.82, to: 1.18 }],
      jitter: { mode: "multiply", amount: 0.045 },
    },
    flow: { base: 1, mappings: [] },
    grain: { space: "stroke-fixed", amount: 0.24, scale: 2.8, contrast: 0.52, seed: 0x4b0a_2202 },
    dualBrush: {
      enabled: true,
      tip: { shape: "bristle", softness: 0.06 },
      blendMode: "multiply",
      sizeRatio: 0.52,
    },
  },
  "chain-link-alternate": {
    tipSoftness: 0.025,
    spacingRatio: 0.74,
    width: {
      mappings: [{ source: "pressure", from: 0.88, to: 1.12 }],
      jitter: null,
    },
    angle: {
      mappings: [{ source: "direction", mode: "add", from: 0, to: 360 }],
      jitter: { mode: "add", amount: 2 },
    },
    flow: { base: 1, mappings: [] },
    colorDynamics: { hueJitter: 1, saturationJitter: 0.01, valueJitter: 0.12 },
    dualBrush: {
      enabled: true,
      tip: { shape: "hard", softness: 0 },
      blendMode: "screen",
      sizeRatio: 0.36,
    },
  },
  "lace-scallop-trim": {
    tipSoftness: 0.045,
    spacingRatio: 0.58,
    width: {
      mappings: [{ source: "pressure", from: 0.78, to: 1.24 }],
      jitter: { mode: "multiply", amount: 0.035 },
    },
    angle: { mappings: [{ source: "direction", mode: "add", from: 0, to: 360 }] },
    flow: { base: 0.94, mappings: [{ source: "pressure", from: 0.72, to: 1 }] },
    colorDynamics: { hueJitter: 2, saturationJitter: 0.015, valueJitter: 0.055 },
  },
  "stitch-running-thread": {
    tipSoftness: 0.02,
    spacingRatio: 0.62,
    width: {
      mappings: [
        { source: "pressure", from: 0.7, to: 1.24 },
        { source: "speed", from: 0.96, to: 1.12 },
      ],
      jitter: null,
    },
    taper: { startLength: 0.02, endLength: 0.08, minSizeRatio: 0.3, curve: 1.1 },
    flow: { base: 1, mappings: [] },
  },
  "stitch-cross-seam": {
    tipSoftness: 0.025,
    spacingRatio: 0.52,
    width: {
      mappings: [{ source: "pressure", from: 0.8, to: 1.18 }],
      jitter: { mode: "multiply", amount: 0.025 },
    },
    angle: { mappings: [{ source: "direction", mode: "add", from: 0, to: 360 }] },
    grain: { space: "canvas-fixed", amount: 0.16, scale: 2.2, contrast: 0.48, seed: 0x4b0a_2206 },
    flow: { base: 0.98, mappings: [] },
  },
  "fabric-knit-loop": {
    tipSoftness: 0.08,
    spacingRatio: 0.34,
    width: {
      mappings: [{ source: "pressure", from: 0.78, to: 1.22 }],
      jitter: { mode: "multiply", amount: 0.06 },
    },
    opacity: { jitter: { mode: "multiply", amount: 0.08 } },
    grain: { space: "canvas-fixed", amount: 0.42, scale: 3.4, contrast: 0.58, seed: 0x4b0a_2207 },
    dualBrush: {
      enabled: true,
      tip: { shape: "bristle", softness: 0.16 },
      blendMode: "multiply",
      sizeRatio: 0.48,
    },
  },
  "metal-scratch-brush": {
    tipSoftness: 0.015,
    spacingRatio: 0.24,
    scatterRatio: 0.16,
    maxSpeed: 0.95,
    width: {
      mappings: [
        { source: "pressure", from: 0.38, to: 1.28 },
        { source: "speed", from: 0.74, to: 1.42 },
      ],
      jitter: { mode: "multiply", amount: 0.24 },
    },
    opacity: { jitter: { mode: "multiply", amount: 0.26 } },
    angle: { jitter: { mode: "add", amount: 14 } },
    grain: { space: "stroke-fixed", amount: 0.3, scale: 6.5, contrast: 0.72, seed: 0x4b0a_2208 },
  },

  // ── 날씨·빛·입자 효과 ─────────────────────────────────────────────────
  "smoke-wisp-layered": {
    tipSoftness: 0.72,
    spacingRatio: 0.24,
    scatterRatio: 0.18,
    width: {
      mappings: [
        { source: "pressure", from: 0.7, to: 1.38 },
        { source: "speed", from: 1.08, to: 0.76 },
      ],
      jitter: { mode: "multiply", amount: 0.2 },
    },
    // A visible first touch prevents the soft dual tip from feeling broken before pressure builds.
    flow: { base: 0.32, mappings: [{ source: "pressure", from: 0.32, to: 1 }] },
    angle: { jitter: { mode: "add", amount: 32 } },
    grain: { space: "canvas-fixed", amount: 0.28, scale: 20, contrast: 0.4, seed: 0x4b0a_2301 },
    dualBrush: {
      enabled: true,
      tip: { shape: "soft", softness: 0.92 },
      blendMode: "screen",
      sizeRatio: 1.45,
    },
  },
  "flame-tongue-spark": {
    tipSoftness: 0.08,
    spacingRatio: 0.34,
    scatterRatio: 0.28,
    maxSpeed: 1,
    width: {
      mappings: [
        { source: "pressure", from: 0.42, to: 1.48 },
        { source: "speed", from: 0.72, to: 1.38 },
      ],
      jitter: { mode: "multiply", amount: 0.28 },
    },
    flow: { base: 0.88, mappings: [{ source: "pressure", from: 0.48, to: 1 }] },
    taper: { startLength: 0.04, endLength: 0.3, minSizeRatio: 0.05, minOpacityRatio: 0.34, curve: 1.8 },
    angle: { mappings: [{ source: "direction", mode: "add", from: 0, to: 360 }], jitter: { mode: "add", amount: 18 } },
    colorDynamics: { hueJitter: 12, saturationJitter: 0.08, valueJitter: 0.12 },
    dualBrush: {
      enabled: true,
      tip: { shape: "star", softness: 0.06 },
      blendMode: "screen",
      sizeRatio: 0.34,
    },
  },
  "rain-mist-combo": {
    tipSoftness: 0.28,
    spacingRatio: 0.42,
    scatterRatio: 0.52,
    maxSpeed: 0.9,
    width: {
      mappings: [{ source: "speed", from: 0.62, to: 1.58 }],
      jitter: { mode: "multiply", amount: 0.22 },
    },
    opacity: {
      mappings: [{ source: "pressure", from: 0.84, to: 1, curve: 0.9 }],
      jitter: { mode: "multiply", amount: 0.28 },
    },
    spacing: { mappings: [{ source: "speed", from: 0.72, to: 1.62 }] },
    scatter: { mappings: [{ source: "speed", from: 0.64, to: 1.56 }], jitter: { mode: "add", amount: 0.42 } },
    angle: { base: -68, mappings: [], jitter: { mode: "add", amount: 5 } },
    flow: {
      base: 0.54,
      mappings: [{ source: "pressure", from: 0.8, to: 1, curve: 0.88 }],
    },
    dualBrush: {
      enabled: true,
      tip: { shape: "soft", softness: 0.9 },
      blendMode: "screen",
      sizeRatio: 0.58,
    },
  },
  "snow-powder-drift": {
    tipSoftness: 0.38,
    // Snow remains a sparse flake carrier, but its former 0.62 spacing × 1.62 speed multiplier
    // plus 0.88 scatter could move the last meaningful deposit more than one 84 px audit segment
    // behind a fast pointer endpoint. Keep the irregular size/opacity field while bounding the
    // longitudinal hole so one sparse one-move stroke still reaches every route segment.
    spacingRatio: 0.36,
    scatterRatio: 0.46,
    width: {
      mappings: [{ source: "pressure", from: 0.62, to: 1.32 }],
      jitter: { mode: "multiply", amount: 0.52 },
    },
    opacity: { jitter: { mode: "multiply", amount: 0.26 } },
    angle: { jitter: { mode: "add", amount: 180 } },
    scatter: {
      mappings: [{ source: "speed", from: 0.76, to: 1.2 }],
      jitter: { mode: "add", amount: 0.24 },
    },
    colorDynamics: { hueJitter: 2, saturationJitter: 0.015, valueJitter: 0.1 },
    dualBrush: {
      enabled: true,
      tip: { shape: "soft", softness: 0.86 },
      blendMode: "screen",
      sizeRatio: 0.72,
    },
  },
  "dust-mote-depth": {
    tipSoftness: 0.62,
    spacingRatio: 0.58,
    scatterRatio: 1.18,
    width: {
      mappings: [{ source: "pressure", from: 0.48, to: 1.3 }],
      jitter: { mode: "multiply", amount: 0.68 },
    },
    opacity: { jitter: { mode: "multiply", amount: 0.56 } },
    angle: { jitter: { mode: "add", amount: 180 } },
    scatter: { mappings: [{ source: "speed", from: 0.7, to: 1.34 }], jitter: { mode: "add", amount: 0.58 } },
    flow: { base: 0.36 },
    colorDynamics: { hueJitter: 4, saturationJitter: 0.025, valueJitter: 0.16 },
  },
  "stage-safe-splatter": {
    tipSoftness: 0.04,
    spacingRatio: 0.46,
    scatterRatio: 1.05,
    width: {
      mappings: [{ source: "pressure", from: 0.42, to: 1.46, curve: 1.26 }],
      jitter: { mode: "multiply", amount: 0.62 },
    },
    opacity: { jitter: { mode: "multiply", amount: 0.18 } },
    scatter: {
      mappings: [{ source: "pressure", from: 0.52, to: 1.72, curve: 1.25 }],
      jitter: { mode: "add", amount: 0.44 },
    },
    angle: { jitter: { mode: "add", amount: 180 } },
    flow: { base: 0.92 },
    dualBrush: {
      enabled: true,
      tip: { shape: "grain", softness: 0.02 },
      blendMode: "screen",
      sizeRatio: 0.44,
    },
  },
  "bokeh-ring-glow": {
    tipSoftness: 0.48,
    spacingRatio: 0.72,
    scatterRatio: 0.72,
    width: {
      mappings: [{ source: "pressure", from: 0.64, to: 1.28 }],
      jitter: { mode: "multiply", amount: 0.48 },
    },
    opacity: { jitter: { mode: "multiply", amount: 0.32 } },
    angle: { jitter: { mode: "add", amount: 180 } },
    colorDynamics: { hueJitter: 10, saturationJitter: 0.06, valueJitter: 0.18 },
    flow: { base: 0.46 },
    dualBrush: {
      enabled: true,
      tip: { shape: "soft", softness: 0.94 },
      blendMode: "screen",
      sizeRatio: 1.22,
    },
  },
  "cloud-cirrus-stream": {
    tipSoftness: 0.82,
    spacingRatio: 0.18,
    scatterRatio: 0.12,
    width: {
      mappings: [
        { source: "pressure", from: 0.78, to: 1.28 },
        { source: "speed", from: 1.12, to: 0.68 },
      ],
      jitter: { mode: "multiply", amount: 0.16 },
    },
    // Cirrus remains lighter than opaque paint while clearing the planner's first-tap floor.
    flow: { base: 0.34, mappings: [{ source: "pressure", from: 0.28, to: 1 }] },
    spacing: { mappings: [{ source: "speed", from: 0.78, to: 1.28 }] },
    grain: { space: "canvas-fixed", amount: 0.22, scale: 26, contrast: 0.34, seed: 0x4b0a_2308 },
    dualBrush: {
      enabled: true,
      tip: { shape: "soft", softness: 0.96 },
      blendMode: "screen",
      sizeRatio: 1.7,
    },
  },

  // ── 자연·재질·음식 소재 ───────────────────────────────────────────────
  "foliage-broad-canopy": {
    tipSoftness: 0.08,
    spacingRatio: 0.42,
    scatterRatio: 0.62,
    width: {
      mappings: [{ source: "pressure", from: 0.5, to: 1.46 }],
      jitter: { mode: "multiply", amount: 0.4 },
    },
    angle: { jitter: { mode: "add", amount: 150 } },
    scatter: { mappings: [{ source: "speed", from: 0.74, to: 1.42 }], jitter: { mode: "add", amount: 0.38 } },
    colorDynamics: { hueJitter: 12, saturationJitter: 0.1, valueJitter: 0.12 },
    flow: { base: 0.86, mappings: [{ source: "pressure", from: 0.56, to: 1 }] },
  },
  "tree-bark-crack": {
    tipSoftness: 0.05,
    spacingRatio: 0.13,
    scatterRatio: 0.05,
    width: {
      mappings: [
        { source: "pressure", from: 0.5, to: 1.38 },
        { source: "speed", from: 1.08, to: 0.78 },
      ],
      jitter: { mode: "multiply", amount: 0.14 },
    },
    opacity: { jitter: { mode: "multiply", amount: 0.16 } },
    grain: { space: "canvas-fixed", amount: 0.5, scale: 8.4, contrast: 0.74, seed: 0x4b0a_2402 },
    flow: { base: 0.72, mappings: [{ source: "pressure", from: 0.5, to: 1 }] },
    dualBrush: {
      enabled: true,
      tip: { shape: "grain", softness: 0.03 },
      blendMode: "multiply",
      sizeRatio: 0.64,
    },
  },
  "flower-petal-scatter": {
    tipSoftness: 0.045,
    spacingRatio: 0.58,
    scatterRatio: 0.82,
    width: {
      mappings: [{ source: "pressure", from: 0.56, to: 1.38 }],
      jitter: { mode: "multiply", amount: 0.42 },
    },
    angle: { jitter: { mode: "add", amount: 180 } },
    scatter: { mappings: [{ source: "speed", from: 0.58, to: 1.6 }], jitter: { mode: "add", amount: 0.44 } },
    colorDynamics: { hueJitter: 14, saturationJitter: 0.09, valueJitter: 0.1 },
    flow: { base: 0.9 },
  },
  "rock-shard-texture": {
    tipSoftness: 0.025,
    spacingRatio: 0.36,
    scatterRatio: 0.42,
    width: {
      mappings: [{ source: "pressure", from: 0.5, to: 1.48 }],
      jitter: { mode: "multiply", amount: 0.42 },
    },
    opacity: { jitter: { mode: "multiply", amount: 0.18 } },
    angle: { jitter: { mode: "add", amount: 180 } },
    grain: { space: "canvas-fixed", amount: 0.48, scale: 11, contrast: 0.72, seed: 0x4b0a_2404 },
    dualBrush: {
      enabled: true,
      tip: { shape: "grain", softness: 0.02 },
      blendMode: "multiply",
      sizeRatio: 0.5,
    },
  },
  "brick-mortar-pattern": {
    tipSoftness: 0.025,
    spacingRatio: 0.82,
    scatterRatio: 0,
    width: {
      mappings: [{ source: "pressure", from: 0.92, to: 1.08 }],
      jitter: null,
    },
    angle: { mappings: [{ source: "direction", mode: "add", from: 0, to: 360 }], jitter: null },
    flow: { base: 1, mappings: [] },
    grain: { space: "canvas-fixed", amount: 0.2, scale: 5, contrast: 0.46, seed: 0x4b0a_2405 },
  },
  "wood-knot-rake": {
    tipSoftness: 0.06,
    spacingRatio: 0.12,
    width: {
      mappings: [
        { source: "pressure", from: 0.48, to: 1.36 },
        { source: "speed", from: 1.06, to: 0.74 },
      ],
      jitter: { mode: "multiply", amount: 0.1 },
    },
    flow: { base: 0.68, mappings: [{ source: "pressure", from: 0.48, to: 1 }] },
    grain: { space: "stroke-fixed", amount: 0.48, scale: 7.6, contrast: 0.66, seed: 0x4b0a_2406 },
    angle: { mappings: [{ source: "direction", mode: "add", from: 0, to: 360 }], jitter: { mode: "add", amount: 4 } },
    dualBrush: {
      enabled: true,
      tip: { shape: "bristle", softness: 0.06 },
      blendMode: "multiply",
      sizeRatio: 0.74,
    },
  },
  "fur-undercoat-soft": {
    tipSoftness: 0.56,
    spacingRatio: 0.12,
    scatterRatio: 0.18,
    width: {
      mappings: [
        { source: "pressure", from: 0.44, to: 1.34 },
        { source: "tilt-magnitude", from: 0.9, to: 1.28, amount: 0.48 },
      ],
      jitter: { mode: "multiply", amount: 0.18 },
    },
    flow: { base: 0.32, mappings: [{ source: "pressure", from: 0.36, to: 1 }] },
    angle: { jitter: { mode: "add", amount: 28 } },
    taper: { startLength: 0.05, endLength: 0.24, minSizeRatio: 0.08, minOpacityRatio: 0.34, curve: 1.46 },
    dualBrush: {
      enabled: true,
      tip: { shape: "bristle", softness: 0.08 },
      blendMode: "screen",
      sizeRatio: 0.52,
    },
  },
  "hair-curl-ribbon": {
    tipSoftness: 0.035,
    spacingRatio: 0.1,
    width: {
      mappings: [
        { source: "pressure", from: 0.3, to: 1.46, curve: 1.26 },
        { source: "tilt-magnitude", from: 0.9, to: 1.2, amount: 0.42 },
      ],
      jitter: { mode: "multiply", amount: 0.08 },
    },
    flow: { base: 0.9, mappings: [{ source: "pressure", from: 0.58, to: 1 }] },
    taper: { startLength: 0.05, endLength: 0.3, minSizeRatio: 0.045, minOpacityRatio: 0.52, curve: 1.55 },
    angle: {
      mappings: [
        { source: "direction", mode: "add", from: 0, to: 360 },
        { source: "twist", mode: "add", from: 0, to: 360, amount: 0.22 },
      ],
      jitter: { mode: "add", amount: 8 },
    },
    dualBrush: {
      enabled: true,
      tip: { shape: "bristle", softness: 0.04 },
      blendMode: "screen",
      sizeRatio: 0.4,
    },
  },
  "food-sesame-sprinkle": {
    tipSoftness: 0.025,
    spacingRatio: 0.72,
    scatterRatio: 0.74,
    width: {
      mappings: [{ source: "pressure", from: 0.68, to: 1.24 }],
      jitter: { mode: "multiply", amount: 0.34 },
    },
    angle: { jitter: { mode: "add", amount: 180 } },
    scatter: { jitter: { mode: "add", amount: 0.42 } },
    colorDynamics: { hueJitter: 7, saturationJitter: 0.06, valueJitter: 0.16 },
    flow: { base: 0.96 },
  },

  // ── 만화 톤·해칭·집중선 ───────────────────────────────────────────────
  "halftone-gradient-dot": {
    tipSoftness: 0.015,
    spacingRatio: 0.34,
    width: {
      mappings: [
        { source: "pressure", from: 0.42, to: 1.62, curve: 1.24 },
        { source: "speed", from: 1.08, to: 0.78, amount: 0.5 },
      ],
      jitter: null,
    },
    spacing: {
      mappings: [
        { source: "pressure", from: 1.24, to: 0.76, curve: 1.12 },
        { source: "speed", from: 0.9, to: 1.24 },
      ],
    },
    opacity: { mappings: [{ source: "pressure", from: 0.54, to: 1 }] },
    flow: { base: 1, mappings: [] },
  },
  "hatching-contour-rake": {
    tipSoftness: 0.02,
    spacingRatio: 0.11,
    width: {
      mappings: [
        { source: "pressure", from: 0.42, to: 1.38 },
        { source: "tilt-magnitude", from: 0.88, to: 1.24, amount: 0.5 },
      ],
      jitter: { mode: "multiply", amount: 0.06 },
    },
    angle: {
      mappings: [
        { source: "direction", mode: "add", from: 0, to: 360 },
        { source: "tilt-azimuth", mode: "add", from: 0, to: 360, amount: 0.28 },
      ],
      jitter: { mode: "add", amount: 3 },
    },
    flow: { base: 0.84, mappings: [{ source: "pressure", from: 0.58, to: 1 }] },
    taper: { startLength: 0.035, endLength: 0.2, minSizeRatio: 0.08, minOpacityRatio: 0.66, curve: 1.4 },
    grain: { space: "canvas-fixed", amount: 0.18, scale: 3, contrast: 0.48, seed: 0x4b0a_2502 },
  },
  "focus-ray-streak": {
    tipSoftness: 0.015,
    spacingRatio: 0.1,
    scatterRatio: 0.09,
    maxSpeed: 0.82,
    width: {
      mappings: [
        { source: "pressure", from: 0.3, to: 1.24 },
        { source: "speed", from: 0.52, to: 1.76, curve: 1.2 },
      ],
      jitter: { mode: "multiply", amount: 0.14 },
    },
    opacity: {
      mappings: [{ source: "speed", from: 0.64, to: 1 }],
      jitter: { mode: "multiply", amount: 0.12 },
    },
    spacing: { mappings: [{ source: "speed", from: 0.68, to: 1.42 }] },
    flow: { base: 0.96, mappings: [] },
    taper: { startLength: 0.025, endLength: 0.34, minSizeRatio: 0.025, minOpacityRatio: 0.48, curve: 1.9 },
  },
};

/** Tuning lookup for the expansion wave and the explicit legacy visibility-correction set. */
export function studioBrushPackExpansionTuningById(
  catalogId: StudioBrushPackCatalogId
): StudioBrushPackExpansionTuning | null {
  return Object.prototype.hasOwnProperty.call(EXPANSION_TUNING, catalogId)
    ? EXPANSION_TUNING[catalogId as StudioBrushPackTuningId]
    : null;
}

function mergeChannel(
  base: StudioBrushDynamicsPropertySettings | undefined,
  override: StudioBrushDynamicsPropertySettings | undefined
): StudioBrushDynamicsPropertySettings | undefined {
  if (!override) return base;
  return { ...base, ...override };
}

/**
 * Merge a tuning entry over the formula-built settings snapshot. Only fields present in the
 * tuning are replaced; channels merge shallowly so partial overrides keep formula sub-fields.
 * The caller re-asserts `width.base`/`opacity.base` after this merge.
 */
export function applyStudioBrushPackExpansionTuning(
  settings: StudioBrushDynamicsSettings,
  tuning: StudioBrushPackExpansionTuning
): StudioBrushDynamicsSettings {
  return {
    ...settings,
    ...(tuning.maxSpeed !== undefined ? { maxSpeed: tuning.maxSpeed } : {}),
    ...(tuning.spacingRatio !== undefined ? { spacingRatio: tuning.spacingRatio } : {}),
    ...(tuning.scatterRatio !== undefined ? { scatterRatio: tuning.scatterRatio } : {}),
    ...(tuning.taper ? { taper: { ...settings.taper, ...tuning.taper } } : {}),
    ...(tuning.colorDynamics ? { colorDynamics: tuning.colorDynamics } : {}),
    ...(tuning.grain ? { grain: tuning.grain } : {}),
    ...(tuning.dualBrush ? { dualBrush: tuning.dualBrush } : {}),
    width: mergeChannel(settings.width, tuning.width),
    opacity: mergeChannel(settings.opacity, tuning.opacity),
    flow: mergeChannel(settings.flow, tuning.flow),
    spacing: mergeChannel(settings.spacing, tuning.spacing),
    scatter: mergeChannel(settings.scatter, tuning.scatter),
    angle: mergeChannel(settings.angle, tuning.angle),
    roundness: mergeChannel(settings.roundness, tuning.roundness),
  };
}
