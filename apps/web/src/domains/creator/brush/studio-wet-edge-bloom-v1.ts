/**
 * Wet-edge bloom v1 — deterministic CPU wet-texture augmentation for settled watercolor plans.
 *
 * The module is a pure post-pass over the existing `WatercolorBrushDab` contract: it accepts the
 * dab arrays the causal/legacy watercolor planners already emit and returns augmented arrays of
 * the exact same type. Canvas and SVG lanes therefore stay pixel-agreeing for free, and no new
 * render primitive is required — every physical effect below is expressed as per-dab alpha
 * shaping or as extra `diffuse`-role dabs.
 *
 * Physically-derived effects (parameter-only clean-room reimplementations — see PROVENANCE):
 * 1. Edge darkening (coffee ring): rim gain `1 + k·|∇density|`, k default 1.35. The settled plan's
 *    density gradient is estimated per station from the core→halo opacity drop across the bleed
 *    band, then applied as halo alpha shaping plus optional discrete rim beads inscribed at the
 *    halo boundary (real coffee rings are uneven, so beads sit at seeded angles).
 * 2. Granulation: per-dab density modulation (default strength 0.55) driven by a deterministic
 *    paper fibre permeability field (MoXi concept: per-texel permeability steers bleed).
 * 3. Chromatic bleed (chromatography): per-channel bleed radius multipliers
 *    (R 1+0.85C, G 1+0.15C, B max(0.25, 1−0.65C)) split each halo into a lagging dense inner
 *    front and a fast faint outer fringe — the warm-core/cool-halo separation.
 * 4. Fresh-ink wetness: a per-stroke `wetness` input (fresh ink deposits wetness 0.16 at 2.8×
 *    radius) grows a wide soft halo around each core, so fresh lines feather while dry-set lines
 *    hold. Wetness also softens the coffee ring, because edge darkening is a drying phenomenon.
 * 5. W7 paper valley-settle (F1, opt-in `paperPresetId`): the sheet's per-position
 *    granulationScale (`affinity × (1 − height)`, studio-paper-media-profile-v1) multiplies the
 *    granulation strength, so pigment settles into the paper's valleys instead of uniformly.
 *
 * Causality contract: every emitted dab is a pure function of (its own station's dabs so far,
 * station ordinal, seed, settings). Core-derived extras attach immediately after the core; halo
 * pair-derived extras attach immediately after the paired diffuse dab. Both planners emit a
 * station's core before its diffuse dab, so augmenting a station-aligned prefix yields exactly a
 * prefix of the augmented full stroke — the same discipline as studio-causal-watercolor-brush.
 *
 * No Math.random / Date.now: all variation is studioOssUnitHash / studioOssValueNoise2d.
 */

import {
  studioOssUnitHash,
  studioOssValueNoise2d,
} from "../studio-oss-brush-kernels";

import {
  getStudioPaperPresetV1,
  isStudioPaperPresetIdV1,
  resolveStudioPaperMediaModulationV1,
} from "./studio-paper-media-profile-v1";

import type { StudioPaperPresetIdV1, StudioPaperPresetV1 } from "./studio-paper-media-profile-v1";
import type { WatercolorBrushDab } from "./studio-watercolor-brush";

export const STUDIO_WET_EDGE_BLOOM_VERSION_V1 = 1 as const;

/**
 * License hygiene: inkwash (github.com/johnowhitaker/inkwash) has NO LICENSE and MoXi has no
 * public code at all, so nothing here is a port. Only published parameter values and paper-level
 * behavior descriptions were reused; every formula below was written from scratch against the
 * dab-plan contract of this repository.
 */
export const STUDIO_WET_EDGE_BLOOM_PROVENANCE = Object.freeze({
  inkwashEdgeDarkening:
    "inkwash display-shader edge factor 1 + 1.35·|∇density| — parameter-only clean-room reimplementation (repo has NO LICENSE; no code copied)",
  inkwashGranulation:
    "inkwash uGrain 0.55 density modulation — parameter-only clean-room reimplementation (NO LICENSE; no code copied)",
  inkwashChromaticBleed:
    "inkwash per-channel bleed vector (1+0.85C, 1+0.15C, max(0.25, 1−0.65C)) — parameter-only clean-room reimplementation (NO LICENSE; no code copied)",
  inkwashFreshInkWetness:
    "inkwash fresh pen ink wetness 0.16 at 2.8× radius — parameter-only clean-room reimplementation (NO LICENSE; no code copied)",
  moxiFiberPermeability:
    "MoXi (Chu & Tai, SIGGRAPH 2005, ACM TOG 24(3)) per-cell paper permeability steering bleed — concept reimplemented from the paper; no public code exists",
} as const);

export type StudioWetEdgeBloomProvenanceId =
  keyof typeof STUDIO_WET_EDGE_BLOOM_PROVENANCE;

export const STUDIO_WET_EDGE_BLOOM_RANGES = Object.freeze({
  edgeDarkening: Object.freeze({ min: 0, max: 4 }),
  rimBeadCount: Object.freeze({ min: 0, max: 4 }),
  granulation: Object.freeze({ min: 0, max: 1 }),
  chroma: Object.freeze({ min: 0, max: 1 }),
  wetness: Object.freeze({ min: 0, max: 1 }),
  maxExtraDabs: Object.freeze({ min: 0, max: 32_768 }),
} as const);

/** Research defaults: inkwash ships edge 1.35 and grain 0.55; chroma/wetness are strictly opt-in. */
export const STUDIO_WET_EDGE_BLOOM_DEFAULTS = Object.freeze({
  seed: 1,
  edgeDarkening: 1.35,
  rimBeadCount: 2,
  granulation: 0.55,
  chroma: 0,
  wetness: 0,
  maxExtraDabs: STUDIO_WET_EDGE_BLOOM_RANGES.maxExtraDabs.max,
} as const);

/** Fresh pen ink deposits this wetness at FRESH_HALO_RADIUS_RATIO × radius (inkwash behavior). */
export const STUDIO_WET_EDGE_BLOOM_FRESH_INK_WETNESS = 0.16;
export const STUDIO_WET_EDGE_BLOOM_FRESH_HALO_RADIUS_RATIO = 2.8;

const TAU = Math.PI * 2;
const RADIUS_EPSILON = 1e-3;
const MIN_DAB_RADIUS = 0.05;
/** Augmented alpha ceiling: keeps stacked shaping below full occlusion like the planner's caps. */
const AUGMENTED_OPACITY_MAX = 0.95;
/** Extras fainter than this render as nothing; skipping them is pure per-station and stable. */
const MIN_VISIBLE_EXTRA_OPACITY = 0.002;

/** Canonical fresh halo is 10% of core alpha; extra wetness saturates instead of ballooning. */
const FRESH_HALO_OPACITY_RATIO = 0.1;
const FRESH_HALO_WETNESS_SATURATION = 1.8;
/** Wet rims dry softer: the coffee ring forms while drying, so fresh strokes ring less. */
const FRESH_RIM_SOFTENING = 0.35;

/** Granulation amplitude at strength 1; halo pigment is thinner so it granulates half as hard. */
const GRANULATION_CORE_AMPLITUDE = 0.5;
const GRANULATION_HALO_AMPLITUDE = 0.25;

const RIM_BEAD_OPACITY_RATIO = 0.5;
const RIM_BEAD_RADIUS_RATIO = Object.freeze({ min: 0.16, max: 0.26 });
/** MoXi steering: permeable paper carries more pigment to the boundary, so beads darken there. */
const RIM_BEAD_PERMEABILITY_FLOOR = 0.6;
const RIM_BEAD_PERMEABILITY_GAIN = 0.8;

const CHROMA_INNER_LAG_OPACITY_RATIO = 0.45;
const CHROMA_OUTER_FRINGE_OPACITY_RATIO = 0.3;

/** Paper fibre field tuning: orientation drifts slowly; pores stretch along the fibre axis. */
const FIBER_ORIENTATION_FREQUENCY = 0.011;
const FIBER_COARSE_ALONG_FREQUENCY = 0.045;
const FIBER_COARSE_ACROSS_FREQUENCY = 0.24;
const FIBER_FINE_ALONG_FREQUENCY = 0.16;
const FIBER_FINE_ACROSS_FREQUENCY = 0.61;
const FIBER_COARSE_WEIGHT = 0.65;
const FIBER_FINE_WEIGHT = 0.35;

const SALT_FIBER_ORIENTATION = 0x0f1b_e55e;
const SALT_FIBER_COARSE = 0x51be_37a1;
const SALT_FIBER_FINE = 0x7e11_0c4d;
const SALT_RIM_ANGLE = 0x1735_c0de;
const SALT_RIM_RADIUS = 0x2b1e_ed01;

export interface StudioWetEdgeBloomSettings {
  /** Stroke-stable seed (e.g. `watercolorBrushSeedFromKey(element.id)`), never wall-clock. */
  readonly seed: number;
  /** Coffee-ring strength k in `1 + k·|∇density|`; research default 1.35. */
  readonly edgeDarkening: number;
  /** Discrete uneven rim deposits per station riding the halo boundary. */
  readonly rimBeadCount: number;
  /** Pigment granulation strength; research default 0.55. */
  readonly granulation: number;
  /** Chromatography amount C for the per-channel bleed radius vector. */
  readonly chroma: number;
  /** Fresh-ink wetness; 0.16 is canonical fresh pen ink, 0 is a dry-set line. */
  readonly wetness: number;
  /** Safety ceiling for appended dabs; shaped originals are never dropped. */
  readonly maxExtraDabs: number;
  /**
   * Optional W7 paper sheet (studio-paper-media-profile-v1). When set, the valley-settle
   * granulationScale of that sheet multiplies the granulation strength per dab position, so
   * pigment settles into the paper's valleys instead of granulating uniformly (2026-08-13 F1).
   * Absent or unknown ids are exact identity — the pre-paper output stays byte-identical.
   */
  readonly paperPresetId?: StudioPaperPresetIdV1;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clampAugmentedOpacity(value: number): number {
  return clamp(value, 0, AUGMENTED_OPACITY_MAX);
}

export function normalizeStudioWetEdgeBloomSettings(
  input?: Partial<StudioWetEdgeBloomSettings> | null,
): StudioWetEdgeBloomSettings {
  const source = input && typeof input === "object" ? input : {};
  return {
    seed: Math.floor(finiteNumber(source.seed, STUDIO_WET_EDGE_BLOOM_DEFAULTS.seed)) | 0,
    edgeDarkening: clamp(
      finiteNumber(source.edgeDarkening, STUDIO_WET_EDGE_BLOOM_DEFAULTS.edgeDarkening),
      STUDIO_WET_EDGE_BLOOM_RANGES.edgeDarkening.min,
      STUDIO_WET_EDGE_BLOOM_RANGES.edgeDarkening.max,
    ),
    rimBeadCount: Math.floor(clamp(
      finiteNumber(source.rimBeadCount, STUDIO_WET_EDGE_BLOOM_DEFAULTS.rimBeadCount),
      STUDIO_WET_EDGE_BLOOM_RANGES.rimBeadCount.min,
      STUDIO_WET_EDGE_BLOOM_RANGES.rimBeadCount.max,
    )),
    granulation: clamp(
      finiteNumber(source.granulation, STUDIO_WET_EDGE_BLOOM_DEFAULTS.granulation),
      STUDIO_WET_EDGE_BLOOM_RANGES.granulation.min,
      STUDIO_WET_EDGE_BLOOM_RANGES.granulation.max,
    ),
    chroma: clamp(
      finiteNumber(source.chroma, STUDIO_WET_EDGE_BLOOM_DEFAULTS.chroma),
      STUDIO_WET_EDGE_BLOOM_RANGES.chroma.min,
      STUDIO_WET_EDGE_BLOOM_RANGES.chroma.max,
    ),
    wetness: clamp(
      finiteNumber(source.wetness, STUDIO_WET_EDGE_BLOOM_DEFAULTS.wetness),
      STUDIO_WET_EDGE_BLOOM_RANGES.wetness.min,
      STUDIO_WET_EDGE_BLOOM_RANGES.wetness.max,
    ),
    maxExtraDabs: Math.floor(clamp(
      finiteNumber(source.maxExtraDabs, STUDIO_WET_EDGE_BLOOM_DEFAULTS.maxExtraDabs),
      STUDIO_WET_EDGE_BLOOM_RANGES.maxExtraDabs.min,
      STUDIO_WET_EDGE_BLOOM_RANGES.maxExtraDabs.max,
    )),
    // 알 수 없는 종이 id 는 조용히 항등으로 fail-closed 한다(W7 규약과 동일).
    ...(isStudioPaperPresetIdV1(source.paperPresetId)
      ? { paperPresetId: source.paperPresetId }
      : {}),
  };
}

/**
 * True when the normalized settings cannot change any dab — callers may skip the pass.
 * `paperPresetId` deliberately does not participate: the paper sheet only scales the granulation
 * strength, so with every effect at zero it still cannot move a single byte.
 */
export function isStudioWetEdgeBloomIdentitySettings(
  settings: StudioWetEdgeBloomSettings,
): boolean {
  return settings.edgeDarkening === 0
    && settings.granulation === 0
    && settings.chroma === 0
    && settings.wetness === 0;
}

/**
 * Deterministic paper fibre permeability in [0, 1] (MoXi three-layer paper concept).
 *
 * A slowly drifting undirected fibre axis rotates the sampling frame; pore noise is then sampled
 * with a lower frequency along the fibre than across it, producing elongated conductive streaks.
 * Position-only inputs keep the field independent of stroke history, hence prefix-stable.
 */
export function studioWetFiberPermeabilitySample(
  x: number,
  y: number,
  seed: number,
): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0.5;
  const seedInt = Math.floor(finiteNumber(seed, 0)) | 0;
  const axis = studioOssValueNoise2d(
    x * FIBER_ORIENTATION_FREQUENCY,
    y * FIBER_ORIENTATION_FREQUENCY,
    seedInt ^ SALT_FIBER_ORIENTATION,
  ) * Math.PI;
  const tangentX = Math.cos(axis);
  const tangentY = Math.sin(axis);
  const along = x * tangentX + y * tangentY;
  const across = x * -tangentY + y * tangentX;
  const coarse = studioOssValueNoise2d(
    along * FIBER_COARSE_ALONG_FREQUENCY,
    across * FIBER_COARSE_ACROSS_FREQUENCY,
    seedInt ^ SALT_FIBER_COARSE,
  );
  const fine = studioOssValueNoise2d(
    along * FIBER_FINE_ALONG_FREQUENCY,
    across * FIBER_FINE_ACROSS_FREQUENCY,
    seedInt ^ SALT_FIBER_FINE,
  );
  return clamp01(coarse * FIBER_COARSE_WEIGHT + fine * FIBER_FINE_WEIGHT);
}

export interface StudioWetChromaticBleedRadiusMultipliers {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

/**
 * Chromatography radius vector: red dye travels fastest, blue lags (warm core, cool halo).
 * Exact published inkwash parameterization; also consumable by future per-channel compositors.
 */
export function studioWetChromaticBleedRadiusMultipliers(
  chroma: number,
): StudioWetChromaticBleedRadiusMultipliers {
  const amount = clamp01(finiteNumber(chroma, 0));
  return Object.freeze({
    red: 1 + 0.85 * amount,
    green: 1 + 0.15 * amount,
    blue: Math.max(0.25, 1 - 0.65 * amount),
  });
}

/**
 * Dab-level analog of the display-shader `|∇density|`: the settled wash falls from the core
 * opacity to zero across the bleed band, so the boundary gradient scales with the halo's pigment
 * over the band width. Normalized by the core radius so it is zoom-invariant, clamped to [0, 1].
 */
function normalizedRimGradient(core: WatercolorBrushDab, haloRadius: number, haloOpacity: number): number {
  const coreRadius = Math.max(MIN_DAB_RADIUS, finiteNumber(core.radius, MIN_DAB_RADIUS));
  const band = Math.max(RADIUS_EPSILON, haloRadius - coreRadius);
  return clamp01((haloOpacity * coreRadius) / band);
}

function granulationMultiplier(
  permeability: number,
  strength: number,
  amplitude: number,
): number {
  return 1 + strength * amplitude * (permeability * 2 - 1);
}

/**
 * W7 valley-settle granulationScale at a dab position — pigment rides the sheet's valleys
 * (`granulationAffinity × (1 − height)` under the watercolor profile, gain 1). Pressure only
 * drives the deposit/bleed axes of the W7 vector, never this one, so the canonical mid pressure
 * keeps the field a pure function of position. No sheet resolves to the exact multiplier 1.
 */
function paperValleySettleGranulationScale(
  preset: StudioPaperPresetV1 | null,
  x: number,
  y: number,
  seed: number,
): number {
  if (!preset) return 1;
  return resolveStudioPaperMediaModulationV1({
    medium: "watercolor",
    preset,
    pressure: 0.5,
    x,
    y,
    seed,
  }).granulationScale;
}

// ---------------------------------------------------------------------------
// Opt-in lane programs — material tables reference these by id so only lanes
// that declare a program change behavior; every existing lane stays untouched.
// ---------------------------------------------------------------------------

export type StudioWetEdgeBloomProgramId =
  | "edge-bloom"
  | "granulating-wash"
  | "fiber-feather"
  | "chroma-halo";

export type StudioWetEdgeBloomProgram = Omit<StudioWetEdgeBloomSettings, "seed" | "maxExtraDabs">;

/**
 * Four intentional texture programs for the new watercolor/ink-wash lanes:
 * - edge-bloom: canonical drying ring (k 1.35) with uneven bead deposits;
 * - granulating-wash: full-strength pigment granulation over a soft ring;
 * - fiber-feather: fresh-ink feathering steered by the fibre field (sumi wet line);
 * - chroma-halo: cheap-ink chromatography — warm core, faint fast cool fringe.
 *
 * Paper sheets (F1, W7 valley-settle): the two watercolor lanes granulate on 수채 황목
 * (rough — granulationAffinity 0.92, the granulation showcase sheet) and the two ink-wash lanes
 * on 수채 세목 (hot-press — W7's default sheet for the ink-wash medium: pressed-flat tooth, even
 * washes, granulation kept subtle). These four lanes are this wave's experimental lanes; every
 * lane without a program id never reaches this table and stays byte-identical.
 */
export const STUDIO_WET_EDGE_BLOOM_PROGRAMS: Readonly<
  Record<StudioWetEdgeBloomProgramId, StudioWetEdgeBloomProgram>
> = Object.freeze({
  "edge-bloom": Object.freeze({
    edgeDarkening: 1.35, rimBeadCount: 2, granulation: 0.2, chroma: 0, wetness: 0,
    paperPresetId: "watercolor-rough",
  }),
  "granulating-wash": Object.freeze({
    edgeDarkening: 0.6, rimBeadCount: 1, granulation: 0.55, chroma: 0, wetness: 0,
    paperPresetId: "watercolor-rough",
  }),
  "fiber-feather": Object.freeze({
    edgeDarkening: 0.85, rimBeadCount: 2, granulation: 0.42, chroma: 0.12,
    wetness: STUDIO_WET_EDGE_BLOOM_FRESH_INK_WETNESS,
    paperPresetId: "watercolor-hot-press",
  }),
  "chroma-halo": Object.freeze({
    edgeDarkening: 0.7, rimBeadCount: 1, granulation: 0.25, chroma: 0.5, wetness: 0.08,
    paperPresetId: "watercolor-hot-press",
  }),
});

export function resolveStudioWetEdgeBloomProgram(
  programId: string | null | undefined,
): StudioWetEdgeBloomProgram | null {
  if (!programId) return null;
  return (STUDIO_WET_EDGE_BLOOM_PROGRAMS as Record<string, StudioWetEdgeBloomProgram>)[
    programId
  ] ?? null;
}

// ---------------------------------------------------------------------------
// Single wire-in point
// ---------------------------------------------------------------------------

/**
 * Augments a settled watercolor dab plan with wet-texture physics. Pure and allocation-bounded:
 * the input array and its dabs are never mutated; identity settings return the input reference so
 * non-opted lanes stay bit-identical.
 *
 * Ordering contract per station (both planners emit core before its paired diffuse dab):
 *   core' (granulated) → [fresh halo] → halo' (granulated × edge gain, G-channel radius)
 *   → [chroma inner lag, chroma outer fringe] → [rim beads…]
 * Every emission depends only on dabs already seen, the station ordinal and the seed, so
 * augmenting a station-aligned prefix returns exactly a prefix of the augmented full stroke.
 */
export function augmentStudioWetEdgeBloomDabs(
  dabs: readonly WatercolorBrushDab[],
  settings?: Partial<StudioWetEdgeBloomSettings> | null,
): readonly WatercolorBrushDab[] {
  const normalized = normalizeStudioWetEdgeBloomSettings(settings);
  if (dabs.length === 0 || isStudioWetEdgeBloomIdentitySettings(normalized)) {
    return dabs;
  }

  const {
    seed, edgeDarkening, rimBeadCount, granulation, chroma, wetness,
  } = normalized;
  // 종이 낱장(F1): 프리셋이 없으면 스케일이 정확히 1이라 아래 곱셈은 비트 단위 항등이다.
  const paperPreset = normalized.paperPresetId
    ? getStudioPaperPresetV1(normalized.paperPresetId)
    : null;
  const multipliers = studioWetChromaticBleedRadiusMultipliers(chroma);
  /** Rings form while drying; a stroke still holding water rings measurably less. */
  const freshRimSoftening = 1 - FRESH_RIM_SOFTENING
    * clamp01(wetness / (2 * STUDIO_WET_EDGE_BLOOM_FRESH_INK_WETNESS));
  const freshHaloStrength = Math.min(
    FRESH_HALO_WETNESS_SATURATION,
    wetness / STUDIO_WET_EDGE_BLOOM_FRESH_INK_WETNESS,
  );

  const output: WatercolorBrushDab[] = [];
  let extraBudget = normalized.maxExtraDabs;
  let stationOrdinal = -1;
  let pendingCore: WatercolorBrushDab | null = null;

  const pushExtra = (dab: WatercolorBrushDab): void => {
    if (extraBudget <= 0 || dab.opacity < MIN_VISIBLE_EXTRA_OPACITY) return;
    output.push(dab);
    extraBudget -= 1;
  };

  for (const dab of dabs) {
    const radius = Math.max(MIN_DAB_RADIUS, finiteNumber(dab.radius, MIN_DAB_RADIUS));
    const opacity = clamp01(finiteNumber(dab.opacity, 0));
    const positionFinite = Number.isFinite(dab.x) && Number.isFinite(dab.y);

    if (dab.role === "core") {
      stationOrdinal += 1;
      pendingCore = dab;
      const permeability = studioWetFiberPermeabilitySample(dab.x, dab.y, seed);
      // valley-settle: 골에 앉은 코어일수록 과립이 세고, 봉우리 위 코어는 잦아든다.
      const paperScale = paperValleySettleGranulationScale(paperPreset, dab.x, dab.y, seed);
      output.push({
        x: dab.x,
        y: dab.y,
        radius,
        opacity: clampAugmentedOpacity(
          opacity * granulationMultiplier(
            permeability,
            granulation * paperScale,
            GRANULATION_CORE_AMPLITUDE,
          ),
        ),
        role: "core",
      });
      if (wetness > 0 && positionFinite) {
        pushExtra({
          x: dab.x,
          y: dab.y,
          radius: radius * STUDIO_WET_EDGE_BLOOM_FRESH_HALO_RADIUS_RATIO,
          opacity: clampAugmentedOpacity(
            opacity * FRESH_HALO_OPACITY_RATIO * freshHaloStrength,
          ),
          role: "diffuse",
        });
      }
      continue;
    }

    // Diffuse dab. Without a preceding core there is no station geometry to derive a rim from,
    // so the dab only granulates in place (defensive path; planners always pair core → diffuse).
    const core = pendingCore;
    pendingCore = null;
    const permeability = studioWetFiberPermeabilitySample(dab.x, dab.y, seed);
    const haloGranule = granulationMultiplier(
      permeability,
      granulation * paperValleySettleGranulationScale(paperPreset, dab.x, dab.y, seed),
      GRANULATION_HALO_AMPLITUDE,
    );
    if (!core) {
      output.push({
        x: dab.x,
        y: dab.y,
        radius,
        opacity: clampAugmentedOpacity(opacity * haloGranule),
        role: "diffuse",
      });
      continue;
    }

    const rimGradient = normalizedRimGradient(core, radius, opacity);
    const edgeGain = 1 + edgeDarkening * rimGradient * freshRimSoftening;
    const shapedHaloRadius = Math.max(MIN_DAB_RADIUS, radius * multipliers.green);
    output.push({
      x: dab.x,
      y: dab.y,
      radius: shapedHaloRadius,
      opacity: clampAugmentedOpacity(opacity * haloGranule * edgeGain),
      role: "diffuse",
    });

    if (chroma > 0 && positionFinite) {
      // Slow blue front: pigment that lagged behind deepens the wash near the core (warm core).
      pushExtra({
        x: dab.x,
        y: dab.y,
        radius: Math.max(MIN_DAB_RADIUS, radius * multipliers.blue),
        opacity: clampAugmentedOpacity(opacity * CHROMA_INNER_LAG_OPACITY_RATIO * chroma),
        role: "diffuse",
      });
      // Fast red front: a faint fringe past the visible halo (cool halo).
      pushExtra({
        x: dab.x,
        y: dab.y,
        radius: Math.max(MIN_DAB_RADIUS, radius * multipliers.red),
        opacity: clampAugmentedOpacity(opacity * CHROMA_OUTER_FRINGE_OPACITY_RATIO * chroma),
        role: "diffuse",
      });
    }

    if (edgeDarkening > 0 && rimBeadCount > 0 && rimGradient > 0 && positionFinite) {
      for (let bead = 0; bead < rimBeadCount; bead += 1) {
        const angle = studioOssUnitHash(seed ^ SALT_RIM_ANGLE, stationOrdinal, bead) * TAU;
        const beadRadius = shapedHaloRadius * (
          RIM_BEAD_RADIUS_RATIO.min
          + (RIM_BEAD_RADIUS_RATIO.max - RIM_BEAD_RADIUS_RATIO.min)
            * studioOssUnitHash(seed ^ SALT_RIM_RADIUS, stationOrdinal, bead)
        );
        // Inscribed at the halo boundary: the bead disc never leaves the halo footprint, so the
        // stroke bounding box is unchanged by edge darkening.
        const beadDistance = Math.max(0, shapedHaloRadius - beadRadius);
        const beadX = dab.x + Math.cos(angle) * beadDistance;
        const beadY = dab.y + Math.sin(angle) * beadDistance;
        const beadPermeability = studioWetFiberPermeabilitySample(beadX, beadY, seed);
        pushExtra({
          x: beadX,
          y: beadY,
          radius: Math.max(MIN_DAB_RADIUS, beadRadius),
          opacity: clampAugmentedOpacity(
            opacity
            * edgeDarkening
            * rimGradient
            * RIM_BEAD_OPACITY_RATIO
            * (RIM_BEAD_PERMEABILITY_FLOOR + RIM_BEAD_PERMEABILITY_GAIN * beadPermeability),
          ),
          role: "diffuse",
        });
      }
    }
  }

  return output;
}
