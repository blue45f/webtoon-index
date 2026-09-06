/**
 * Verified open-source brush kernels used by ToonSpectrum's hybrid natural-media stack.
 *
 * These are clean re-implementations of public algorithms from:
 * - Klecks (MIT) — pen scatter, chalk multi-octave alpha tip
 *   https://github.com/bitbof/klecks — pen-brush.ts, brushes/alphas/brush-alphas.ts
 * - Krita Spray (GPL-2.0+; math only, no code copy) — equal-area polar distance
 *   plugins/paintops/spray/KisSprayRandomDistributions.cpp :: √U
 * - libmypaint (ISC) — .myb setting recipes for oil/charcoal carriers
 *   tests/brushes/modelling.myb, charcoal.myb; Krita-bundled Wet_Paint_Plus.myb
 *
 * Proprietary sites (Expresii CFD, Magma, Photopea) are not copied. They only
 * inform which OSS engine owns each family in the hybrid registry.
 *
 * All randomness is seed-driven so live/commit/replay stay byte-deterministic.
 */

export const STUDIO_OSS_BRUSH_KERNELS_VERSION =
  "studio-oss-brush-kernels-v1" as const;

const TAU = Math.PI * 2;

/** Provenance tags embedded in metrics and tests. */
export const STUDIO_OSS_BRUSH_PROVENANCE = Object.freeze({
  klecksScatter: "klecks/pen-brush.ts equal-area disk scatter (MIT)",
  klecksChalkAlpha: "klecks/brushes/alphas genBrushAlpha01 multi-octave chalk (MIT)",
  klecksChalkRotate: "klecks/pen-brush.ts chalk rotate by (x+y)*53123 (MIT)",
  kritaPolarDistance: "Krita KisSprayUniformDistributionPolarDistance √U (math)",
  libmypaintModelling: "libmypaint tests/brushes/modelling.myb (ISC)",
  libmypaintCharcoal: "libmypaint tests/brushes/charcoal.myb (ISC)",
  libmypaintWetPaint: "Krita mypaint bundle Wet_Paint_Plus.myb hardness/opaque shape",
  harmonyProximityWeb: "Harmony (mrdoob) sketchy & web procedural proximity coupling (clean-room math)",
  fabricCrayonWaxTooth: "fabric-brushes (av01d) & p5.brush anisotropic wax crayon tooth (clean-room math)",
  fabricLongFurStrand: "fabric-brushes (av01d) & Harmony tangent strand hair fiber ribbons (clean-room math)",
  fabricSquaresMesh: "fabric-brushes (av01d) procedural square mosaic mesh (clean-room math)",
  klecksSmudgeBlend: "Klecks (bitbof) smudge & blend canvas pixel color transfer (clean-room math)",
  p5BrushFlowfield: "p5.brush (acapv) dynamic vector field curvature & flowfield curl (clean-room math)",
} as const);

export type StudioOssBrushProvenanceId =
  keyof typeof STUDIO_OSS_BRUSH_PROVENANCE;

/** Deterministic unit hash in [0, 1). Same family as stampJitter / dynamics seededUnit. */
export function studioOssUnitHash(
  seed: number,
  saltA: number,
  saltB = 0,
): number {
  let h =
    (Math.imul((seed | 0) + 1, 374761393)
      + Math.imul((saltA | 0) + 1, 668265263)
      + Math.imul((saltB | 0) + 1, 0x27d4_eb2d))
    | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Equal-area disk scatter (Klecks pen + Krita polar distance).
 * `distance = √U · radius` so particles fill the disk uniformly instead of
 * clustering at the centre (raw U would bias inward).
 */
export function studioOssEqualAreaDiskOffset(
  seed: number,
  index: number,
  radius: number,
  salt = 0,
): Readonly<{ x: number; y: number; angle: number; distance: number }> {
  const angle = studioOssUnitHash(seed, index, 0x243f_6a88 ^ salt) * TAU;
  const distance =
    Math.sqrt(studioOssUnitHash(seed, index, 0x85a3_08d3 ^ salt))
    * Math.max(0, radius);
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
    angle,
    distance,
  };
}

/**
 * Klecks chalk tip rotation — rotates stamp alpha by document position so
 * successive dabs never tile the same grain orientation.
 */
export function studioOssChalkRotationRadians(x: number, y: number): number {
  // pen-brush.ts: rotate(((x + y) * 53123) % TWO_PI)
  return ((x + y) * 53123) % TAU;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hashLattice(ix: number, iy: number, seed: number): number {
  let v =
    (Math.imul(ix | 0, 0x45d9_f3b)
      ^ Math.imul(iy | 0, 0x27d4_eb2d)
      ^ (seed >>> 0))
    >>> 0;
  v = Math.imul(v ^ (v >>> 16), 0x7feb_352d) >>> 0;
  v = Math.imul(v ^ (v >>> 15), 0x846c_a68b) >>> 0;
  v ^= v >>> 16;
  return (v >>> 0) / 0xffff_ffff;
}

/** Smooth value-noise in [0, 1] — Klecks chalk uses simplex; value-noise is the deterministic substitute. */
export function studioOssValueNoise2d(
  x: number,
  y: number,
  seed: number,
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hashLattice(x0, y0, seed);
  const b = hashLattice(x0 + 1, y0, seed);
  const c = hashLattice(x0, y0 + 1, seed);
  const d = hashLattice(x0 + 1, y0 + 1, seed);
  return mix(mix(a, b, ux), mix(c, d, ux), uy);
}

/**
 * Klecks genBrushAlpha01 structure (clean-room):
 *   base = mid + coarse*mid
 *   base -= fine
 *   * circular soft falloff
 *   * centre darkening
 * Returns coverage in [0, 1].
 *
 * `grainStretch` (default 1) pre-compensates anisotropic stamping: the dry-media kernel path
 * stretches this tip onto a fibre ellipse λ:1 (long axis = map X). Baking with the noise
 * coordinates compressed λ× along X means the stretched stamp lands isotropic pigment grain in
 * document space instead of λ:1 streaks. Only the NOISE inputs warp — `centerDist` and every
 * envelope term stay computed on the unwarped coordinates, so the tip silhouette is unchanged.
 */
export function studioOssKlecksChalkCoverage(
  normalizedX: number,
  normalizedY: number,
  seed: number,
  grainStretch: number = 1,
): number {
  // Coordinates in a unit disk tip (−1..1). Scale matches 128-px tip sampling.
  const px = normalizedX * 64 * grainStretch;
  const py = normalizedY * 64;
  const scaleFac = 128 / 500;
  const sFac2 =
    scaleFac
    + (studioOssValueNoise2d(px / 50 / scaleFac, py / 50 / scaleFac, seed ^ 0x11)
      - 0.5)
      * 0.08;
  let noisePattern =
    100
    + studioOssValueNoise2d(px / 50 / sFac2, py / 50 / sFac2, seed ^ 0x22)
      * 100;
  noisePattern -=
    studioOssValueNoise2d(px / 10 / scaleFac, py / 10 / scaleFac, seed ^ 0x33)
    * 100;

  const centerDist = Math.hypot(normalizedX, normalizedY);
  // Soft disk edge with noise-perturbed rim (Klecks falloff).
  const rimNoise = studioOssValueNoise2d(
    px / 22 / sFac2,
    py / 22 / sFac2,
    seed ^ 0x44,
  );
  const falloff = Math.min(
    1,
    Math.max(0, 1 - ((centerDist - 0.8) / 0.28 + (rimNoise - 0.5) * 0.6)),
  );
  noisePattern *= falloff;
  // Make the middle denser.
  const falloff2 = Math.min(1, Math.max(0, 1 - centerDist)) * 2;
  noisePattern *= falloff2;
  return Math.min(1, Math.max(0, noisePattern / 255));
}

/**
 * Kleki/Krita spray tip: soft radial envelope × multi-octave grit.
 * Unlike a pure gradient disc, grit remains visible after many overlapping dabs.
 */
export function studioOssSprayTipCoverage(
  normalizedX: number,
  normalizedY: number,
  seed: number,
  hardness: number,
): number {
  const r = Math.hypot(normalizedX, normalizedY);
  if (r >= 1) return 0;
  const hard = Math.min(1, Math.max(0, hardness));
  // Soft analytic shoulder (similar to (1-r)^exp, exp grows as hardness falls).
  const exponent = 1.4 + (1 - hard) * 3.6;
  const envelope = (1 - r) ** exponent;
  const grit =
    studioOssValueNoise2d(normalizedX * 7.5, normalizedY * 7.5, seed ^ 0xa1)
      * 0.55
    + studioOssValueNoise2d(normalizedX * 19, normalizedY * 19, seed ^ 0xb2)
      * 0.3
    + studioOssValueNoise2d(normalizedX * 41, normalizedY * 41, seed ^ 0xc3)
      * 0.15;
  // Outer mist thins more (spray cloud).
  const mist = 0.55 + grit * 0.45;
  return Math.min(1, Math.max(0, envelope * mist));
}

/**
 * Watercolor wet-edge ring coverage (Expresii/Kleki wash feel via soft ring).
 * Core soft body + thin darker rim — structural, not a numeric opacity tweak.
 */
export function studioOssWatercolorTipCoverage(
  normalizedX: number,
  normalizedY: number,
  seed: number,
  hardness: number,
): number {
  const r = Math.hypot(normalizedX, normalizedY);
  if (r >= 1) return 0;
  const hard = Math.min(1, Math.max(0, hardness));
  const bodyExp = 1.1 + (1 - hard) * 2.2;
  const body = (1 - r) ** bodyExp;
  const granulation =
    studioOssValueNoise2d(normalizedX * 11, normalizedY * 11, seed ^ 0xd4)
      * 0.35
    + 0.65;
  // Edge darkening band near r≈0.88–0.98.
  const edge = Math.exp(-((r - 0.92) ** 2) / 0.0045) * 0.22;
  return Math.min(1, Math.max(0, body * granulation + edge));
}

/** libmypaint modelling.myb — oil/paint body carrier (smudge left to host; transparent-safe). */
export const STUDIO_OSS_LIBMYPAINT_MODELLING_RECIPE = Object.freeze({
  provenance: "libmypaintModelling" as const,
  antiAliasing: 1,
  dabsPerActualRadius: 4.02,
  ellipticalDabRatio: 1.0,
  hardness: 0.71,
  opaque: 0.8,
  opaqueLinearize: 0.9,
  radiusLogarithmic: 1.1,
  // Product surface is often transparent: smudge must stay 0 until underpaint exists.
  smudge: 0,
  smudgeLength: 0.3,
  offsetByRandom: 0,
});

/**
 * Transparent-safe oil film recipe: Wet_Paint_Plus hardness/opaque shape +
 * modelling density, smudge forced off (Klecks smudge also skips empty alpha).
 */
export const STUDIO_OSS_OIL_FILM_RECIPE = Object.freeze({
  provenance: ["libmypaintWetPaint", "libmypaintModelling"] as const,
  antiAliasing: 1,
  dabsPerActualRadius: 8.5,
  dabsPerBasicRadius: 0.9,
  directionFilter: 0.4,
  ellipticalDabRatio: 1.45,
  hardness: 0.52,
  opaque: 0.74,
  opaqueLinearize: 0.9,
  paintMode: 0.88,
  radiusLogarithmic: 1.35,
  radiusByRandom: 0.02,
  offsetByRandom: 0.035,
  slowTracking: 0.85,
  slowTrackingPerDab: 0.3,
  smudge: 0,
  smudgeLength: 0.5,
});

/** libmypaint charcoal.myb — dry carrier (high offset_by_random). */
export const STUDIO_OSS_LIBMYPAINT_CHARCOAL_RECIPE = Object.freeze({
  provenance: "libmypaintCharcoal" as const,
  antiAliasing: 0,
  dabsPerActualRadius: 5,
  ellipticalDabRatio: 1,
  hardness: 0.2,
  opaque: 0.4,
  offsetByRandom: 1.6,
  radiusLogarithmic: 0.7,
  slowTracking: 2,
});

/**
 * Transparent-safe dry carrier: charcoal.myb offset/hardness DNA with denser
 * dabs so material texture v2 tooth does not bead.
 */
export const STUDIO_OSS_DRY_CARRIER_RECIPE = Object.freeze({
  provenance: "libmypaintCharcoal" as const,
  antiAliasing: 0.7,
  dabsPerActualRadius: 14,
  dabsPerBasicRadius: 0.6,
  ellipticalDabRatio: 1.25,
  hardness: 0.72,
  opaque: 0.72,
  opaqueLinearize: 0.9,
  offsetByRandom: 0.22,
  radiusByRandom: 0.03,
  radiusLogarithmic: 0.85,
  slowTracking: 1.1,
  trackingNoise: 0.018,
});

/**
 * Material colour transfer modes.
 * Dry powder may reveal paper (white mix); paint film only multiplies density
 * so dark oil never becomes grey glitter.
 */
export type StudioOssMaterialColorMode = "dry-paper" | "paint-film";

export function studioOssMaterialColorModeForProfile(
  materialProfileId: string,
): StudioOssMaterialColorMode {
  switch (materialProfileId) {
    case "oil":
    case "acrylic":
    case "gouache":
    case "painterly":
    case "oil-pastel":
      return "paint-film";
    default:
      return "dry-paper";
  }
}

/**
 * Apply material colour. `color` is multiplicative density [~0.5..1.2].
 * `lift` is paper reveal (dry) or valley darken amount (paint).
 */
export function studioOssApplyMaterialColorChannel(
  source: number,
  color: number,
  lift: number,
  mode: StudioOssMaterialColorMode,
): number {
  if (mode === "paint-film") {
    // Pure density multiply + subtle ridge darkening (never inject white).
    const density = Math.max(0.05, color);
    const darken = Math.min(0.35, Math.max(0, lift));
    return source * density * (1 - darken * 0.22);
  }
  // Dry: traditional tooth mix toward paper.
  return source * color + (255 - source) * Math.max(0, lift);
}

/**
 * Direction-aligned wax scrape field (Krita dry-media / Photopea crayon feel).
 * Samples pigment in stroke-local (along, across) space so grain follows the stylus.
 */
/**
 * Tip-normalized coordinates scaled into this sampler's lattice space.
 *
 * `studioOssDirectionalWaxSample` is written for coordinates in TEXEL units — its three value-noise
 * terms run at 0.42, 0.55 and 0.06 cycles per unit against a lattice of cell size one. The tip
 * kernels feed it normalized coordinates in [-1, 1] instead, so the whole tip spans at most 0.84 of
 * ONE lattice cell and the "wax grain" is a constant: measured over a 128-square tip, sd 0.0081 and
 * total range 0.038. Crayon, charcoal and oil-pastel each declare that grain as their texture and
 * none of them has ever had it — what looks like texture in their strokes comes from stamp-to-stamp
 * scatter, not from within-tip structure.
 *
 * Ten is the knee of the measured curve: sd rises 0.0081 -> 0.150 and range 0.038 -> 0.61 by scale
 * 8-12 and then plateaus, because past that the fibre term decorrelates between neighbouring texels
 * and stops reading as fibres at all. At ten the fibre term crosses about eight lattice cells over
 * the tip diameter, which is a wax stick's worth of strands.
 */
export const STUDIO_OSS_TIP_WAX_LATTICE_SCALE = 10;

export function studioOssDirectionalWaxSample(
  x: number,
  y: number,
  directionRadians: number,
  seed: number,
  grainStretch: number = 1,
): Readonly<{ wax: number; scrape: number; grit: number }> {
  const tangentX = Math.cos(directionRadians);
  const tangentY = Math.sin(directionRadians);
  // grainStretch > 1 compresses the map-X noise frequency so an anisotropically stretched stamp
  // (fibre ellipse, long axis = map X) lands isotropic grain — see
  // studioOssKlecksChalkCoverage. Warping the raw input before the across/along rotation keeps
  // the compensation aligned with the stamp's actual stretch axis.
  const warpedX = x * grainStretch;
  const warpedY = y;
  const across = warpedX * -tangentY + warpedY * tangentX;
  const along = warpedX * tangentX + warpedY * tangentY;
  const fibre = studioOssValueNoise2d(
    along * 0.09 + across * 0.42,
    along * 0.02 - across * 0.08,
    seed ^ 0x47,
  );
  const fine = studioOssValueNoise2d(
    across * 0.55 + along * 0.03,
    across * -0.12 + along * 0.18,
    seed ^ 0x53,
  );
  const broad = studioOssValueNoise2d(
    along * 0.035 + across * 0.06,
    along * -0.04 + across * 0.05,
    seed ^ 0x59,
  );
  const wax = broad * 0.18 + fine * 0.22 + fibre * 0.6;
  return {
    wax,
    // Scrape grooves get a fine-threshold modulation: a raw `fibre` cut makes paper-reveal
    // grooves with optically smooth (C1) edges, which reads as etched plastic rather than a waxy
    // stick skipping over tooth. Dithering the threshold with the high-frequency `fine` octave
    // raggeds the groove boundary at pigment-grain scale while leaving groove placement,
    // depth statistics and determinism untouched.
    scrape: Math.max(0, fibre - 0.42 + (fine - 0.5) * 0.12),
    grit: Math.max(0, fine - 0.55),
  };
}

/**
 * Oil bristle film (Magma-class look via multi-scale loaded channels).
 * Uses three 1-D value samples across the stroke — same noise budget as before.
 */
export function studioOssOilBristleFilm(
  x: number,
  y: number,
  directionRadians: number,
  seed: number,
  sample1d: (
    coordinate: number,
    lane: number,
    seed: number,
  ) => number,
): Readonly<{ alpha: number; color: number; lift: number; ridge: number }> {
  const tangentX = Math.cos(directionRadians);
  const tangentY = Math.sin(directionRadians);
  const across = x * -tangentY + y * tangentX;
  const along = x * tangentX + y * tangentY;
  const fine = sample1d(across * 1.42 + along * 0.022, 31, seed ^ 0x9e57_41b3);
  const mid = sample1d(across * 0.48 + along * 0.011, 33, seed ^ 0x2c1b_8e47);
  const broad = sample1d(across * 0.18 - along * 0.006, 32, seed ^ 0x4b16_f2d9);
  // Weighted load preserves long directional lanes. Expanding its useful
  // range restores visible loaded ridges and dark grooves while keeping a
  // continuous paint bed and the original three-sample noise budget.
  const load = fine * 0.5 + mid * 0.32 + broad * 0.18;
  const ridge = Math.min(1, Math.max(0, (load - 0.28) / 0.52));
  return {
    alpha: 0.68 + ridge * 0.3,
    color: 0.32 + ridge * 0.98,
    // paint-film darken amount only (never white lift)
    lift: (1 - ridge) * 0.35,
    ridge,
  };
}

/**
 * Harmony-style procedural proximity coupling (Sketchy / Web / Shaded math).
 * Computes deterministic distance falloff and dynamic coupling weight between stroke points.
 */
export function studioOssHarmonyProximityCoupling(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  neighbourhoodRadius: number,
  seed: number,
  salt = 0,
): Readonly<{ connected: boolean; opacity: number; distance: number; weight: number }> {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const distance = Math.hypot(dx, dy);
  const radius = Math.max(1, neighbourhoodRadius);
  if (distance > radius || distance < 1e-4) {
    return { connected: false, opacity: 0, distance, weight: 0 };
  }
  const ratio = distance / radius;
  const jitter = studioOssUnitHash(seed, salt, (distance * 10) | 0) * 0.25;
  const weight = Math.max(0, Math.min(1, (1 - ratio * ratio) * (0.8 + jitter)));
  const opacity = Math.max(0.04, Math.min(0.95, weight * 0.75));
  return { connected: weight > 0.08, opacity, distance, weight };
}

/**
 * fabric-brushes / p5.brush anisotropic wax crayon adhesion.
 * Models microscopic wax tooth bite, scrape grooves, and pressure-dependent fiber transfer.
 */
export function studioOssFabricCrayonGrainAdhesion(
  x: number,
  y: number,
  pressure: number,
  velocity: number,
  seed: number,
): Readonly<{ deposit: number; toothBite: number; groove: number }> {
  const p = Math.max(0.05, Math.min(1, pressure));
  const v = Math.max(0, Math.min(50, velocity));
  const roughness = studioOssValueNoise2d(x * 0.28, y * 0.28, seed ^ 0x6e31);
  const toothBite = Math.max(0, Math.min(1, roughness * 0.65 + p * 0.45 - v * 0.008));
  const grooveNoise = studioOssValueNoise2d(x * 0.85, y * 0.85, seed ^ 0x9a13);
  const groove = Math.max(0, grooveNoise - (0.35 + p * 0.3));
  const deposit = Math.max(0.05, Math.min(1, toothBite * (0.6 + p * 0.5) * (1 - groove * 0.4)));
  return { deposit, toothBite, groove };
}

/**
 * fabric-brushes Long Fur / Harmony Fur tangent strand offset.
 * Emits continuous tangent-relative offsets for hair/fur strands with curl angle and length jitter.
 */
export function studioOssFabricLongFurTangentOffset(
  strandIndex: number,
  strandCount: number,
  tangentAngle: number,
  strandLength: number,
  seed: number,
  step = 0,
): Readonly<{ offsetX: number; offsetY: number; angle: number; curl: number; opacity: number }> {
  const count = Math.max(1, strandCount);
  const u = (strandIndex / count) - 0.5;
  const hash = studioOssUnitHash(seed, strandIndex, step);
  const curl = (studioOssUnitHash(seed, strandIndex ^ 0x5a, step) - 0.5) * 0.6;
  const length = strandLength * (0.7 + hash * 0.6);
  const angle = tangentAngle + curl + (u * 0.3);
  const normalAngle = tangentAngle + Math.PI / 2;
  const lateralSpread = u * strandLength * 0.5;
  const offsetX = Math.cos(normalAngle) * lateralSpread + Math.cos(angle) * length;
  const offsetY = Math.sin(normalAngle) * lateralSpread + Math.sin(angle) * length;
  const opacity = Math.max(0.08, Math.min(0.85, 0.45 + (1 - Math.abs(u * 2)) * 0.4));
  return { offsetX, offsetY, angle, curl, opacity };
}

/**
 * fabric-brushes Squares procedural mosaic mesh.
 * Aligns square tiles to a local grid cell with controlled rotation jitter and pressure scaling.
 */
export function studioOssFabricSquaresMeshOffset(
  x: number,
  y: number,
  tileSize: number,
  pressure: number,
  seed: number,
  index = 0,
): Readonly<{ tileX: number; tileY: number; size: number; rotation: number; opacity: number }> {
  const size = Math.max(2, tileSize);
  const p = Math.max(0.05, Math.min(1, pressure));
  const gridX = Math.floor(x / size) * size + size * 0.5;
  const gridY = Math.floor(y / size) * size + size * 0.5;
  const jitterAngle = (studioOssUnitHash(seed, index, 0x3c) - 0.5) * 0.45;
  const scale = size * (0.6 + p * 0.55 + studioOssUnitHash(seed, index, 0x7b) * 0.2);
  const opacity = Math.max(0.1, Math.min(0.95, 0.4 + p * 0.5));
  return {
    tileX: gridX,
    tileY: gridY,
    size: scale,
    rotation: jitterAngle,
    opacity,
  };
}

/**
 * Klecks-style dynamic pigment smudge & blend transfer.
 * Computes blending ratio between current brush color and sampled background canvas color.
 */
export function studioOssKlecksSmudgeColorBlend(
  brushR: number,
  brushG: number,
  brushB: number,
  sampledR: number,
  sampledG: number,
  sampledB: number,
  sampledAlpha: number,
  smudgeRate: number,
  wetness: number,
): Readonly<{ r: number; g: number; b: number; pickupRate: number }> {
  const smudge = Math.max(0, Math.min(1, smudgeRate));
  const wet = Math.max(0, Math.min(1, wetness));
  const sA = Math.max(0, Math.min(1, sampledAlpha));
  // Dynamic pickup is higher when canvas has pigment and brush is wet.
  const pickupRate = smudge * (0.3 + wet * 0.7) * sA;
  const r = Math.round(brushR * (1 - pickupRate) + sampledR * pickupRate);
  const g = Math.round(brushG * (1 - pickupRate) + sampledG * pickupRate);
  const b = Math.round(brushB * (1 - pickupRate) + sampledB * pickupRate);
  return {
    r: Math.max(0, Math.min(255, r)),
    g: Math.max(0, Math.min(255, g)),
    b: Math.max(0, Math.min(255, b)),
    pickupRate,
  };
}

/**
 * p5.brush dynamic vector field curvature & flowfield curl.
 * Calculates flowfield direction angle and natural curve divergence for watercolor flow.
 */
export function studioOssP5BrushFlowfieldVector(
  x: number,
  y: number,
  scale: number,
  force: number,
  seed: number,
): Readonly<{ angle: number; velocityX: number; velocityY: number; curlMagnitude: number }> {
  const s = Math.max(0.001, scale);
  const f = Math.max(0.1, Math.min(10, force));
  const n1 = studioOssValueNoise2d(x * s, y * s, seed ^ 0x1f4a);
  const n2 = studioOssValueNoise2d((x + 100) * s, (y + 100) * s, seed ^ 0x8b32);
  const angle = n1 * Math.PI * 4;
  const curlMagnitude = Math.abs(n2 - 0.5) * 2;
  const velocityX = Math.cos(angle) * f * (0.5 + curlMagnitude * 0.5);
  const velocityY = Math.sin(angle) * f * (0.5 + curlMagnitude * 0.5);
  return {
    angle,
    velocityX,
    velocityY,
    curlMagnitude,
  };
}
