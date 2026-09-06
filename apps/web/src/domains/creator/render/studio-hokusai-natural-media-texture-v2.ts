import {
  studioOssApplyMaterialColorChannel,
  studioOssDirectionalWaxSample,
  studioOssKlecksChalkCoverage,
  studioOssMaterialColorModeForProfile,
  studioOssOilBristleFilm,
} from "../studio-oss-brush-kernels";

import {
  studioHokusaiMaterialProfileIsCompatible,
  type StudioHokusaiMaterialProfileId,
  type StudioHokusaiNaturalMediaPresetId,
  type StudioHokusaiNaturalMediaRenderPlan,
} from "./studio-hokusai-natural-media-contract";

export const STUDIO_HOKUSAI_NATURAL_MEDIA_TEXTURE_VERSION =
  "studio-hokusai-material-texture-v2" as const;

export const STUDIO_HOKUSAI_LOCAL_DIRECTION_INDEX_LIMITS = Object.freeze({
  maxRasterPixels: 4_194_304,
  maxSegments: 16_384,
  maxCellReferences: 65_536,
  maxCells: 16_384,
  maxCandidatesPerCell: 256,
} as const);

export interface StudioHokusaiNaturalMediaTextureMetrics {
  readonly version: typeof STUDIO_HOKUSAI_NATURAL_MEDIA_TEXTURE_VERSION;
  readonly presetId: StudioHokusaiNaturalMediaPresetId;
  readonly materialProfileId: StudioHokusaiMaterialProfileId;
  readonly visiblePixels: number;
  readonly alphaChangedPixels: number;
  readonly colorChangedPixels: number;
  readonly dominantDirectionRadians: number;
  readonly directionIndexMode:
    | "not-applicable"
    | "local-grid"
    | "global-budget-fallback";
  readonly directionIndexSegments: number;
  readonly directionIndexCellReferences: number;
}

export interface StudioHokusaiNaturalMediaPixelLayout {
  /**
   * Raster-space rectangle represented by the tightly packed `pixels` buffer.
   * A full-frame caller uses `[0, 0, rasterWidth, rasterHeight]`; the Worker
   * uses the smaller Hokusai dirty rectangle.
   */
  readonly frameBounds: readonly [
    x: number,
    y: number,
    width: number,
    height: number,
  ];
  /** Raster-space rectangle that may be changed by this material pass. */
  readonly dirtyBounds: readonly [
    x: number,
    y: number,
    width: number,
    height: number,
  ];
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

/**
 * A stable integer hash. It is deliberately used as the control points of a
 * continuous value field, never as per-dab scatter.
 */
function hash01(coordinate: number, lane: number, seed: number): number {
  let value = (
    Math.imul(coordinate | 0, 0x45d9_f3b)
    ^ Math.imul(lane | 0, 0x27d4_eb2d)
    ^ (seed >>> 0)
  ) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb_352d) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x846c_a68b) >>> 0;
  value ^= value >>> 16;
  return (value >>> 0) / 0xffff_ffff;
}

function valueNoise1d(
  coordinate: number,
  lane: number,
  seed: number,
  diagnostics?: NoiseEvaluationDiagnostics,
): number {
  if (diagnostics) diagnostics.count += 1;
  const lower = Math.floor(coordinate);
  const fraction = coordinate - lower;
  const eased = fraction * fraction * (3 - 2 * fraction);
  return mix(
    hash01(lower, lane, seed),
    hash01(lower + 1, lane, seed),
    eased,
  );
}

function valueNoise2d(
  x: number,
  y: number,
  lane: number,
  seed: number,
  diagnostics?: NoiseEvaluationDiagnostics,
): number {
  if (diagnostics) diagnostics.count += 1;
  const lowerX = Math.floor(x);
  const lowerY = Math.floor(y);
  const fractionX = x - lowerX;
  const fractionY = y - lowerY;
  const easedX = fractionX * fractionX * (3 - 2 * fractionX);
  const easedY = fractionY * fractionY * (3 - 2 * fractionY);
  const rowStride = 0x1f12_3bb5;
  const top = mix(
    hash01(lowerX, lowerY + lane * rowStride, seed),
    hash01(lowerX + 1, lowerY + lane * rowStride, seed),
    easedX,
  );
  const bottom = mix(
    hash01(lowerX, lowerY + 1 + lane * rowStride, seed),
    hash01(lowerX + 1, lowerY + 1 + lane * rowStride, seed),
    easedX,
  );
  return mix(top, bottom, easedY);
}

interface MaterialTextureSample {
  readonly alpha: number;
  readonly color: number;
  readonly lift: number;
}

interface NoiseEvaluationDiagnostics {
  count: number;
}

function dominantStrokeDirection(
  samples: StudioHokusaiNaturalMediaRenderPlan["samples"],
): number {
  // Use doubled angles so a stroke travelling right-to-left has the same
  // bristle axis as one travelling left-to-right.
  let cosine = 0;
  let sine = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (!previous || !current) continue;
    const deltaX = current.x - previous.x;
    const deltaY = current.y - previous.y;
    const length = Math.hypot(deltaX, deltaY);
    if (length <= 0.001) continue;
    const angle = Math.atan2(deltaY, deltaX);
    cosine += Math.cos(angle * 2) * length;
    sine += Math.sin(angle * 2) * length;
  }
  return Math.abs(cosine) + Math.abs(sine) <= 0.000_001
    ? 0
    : canonicalAxisRadians(Math.atan2(sine, cosine) / 2);
}

function canonicalAxisRadians(angle: number): number {
  return ((angle % Math.PI) + Math.PI) % Math.PI;
}

interface StrokeSegment {
  readonly startX: number;
  readonly startY: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly lengthSquared: number;
  readonly axisRadians: number;
}

interface LocalStrokeDirectionResolver {
  readonly resolve: (x: number, y: number) => number;
  readonly mode: "local-grid" | "global-budget-fallback";
  readonly indexedSegments: number;
  readonly cellReferences: number;
}

function globalDirectionFallback(
  fallback: number,
  indexedSegments = 0,
  cellReferences = 0,
): LocalStrokeDirectionResolver {
  return {
    resolve: () => fallback,
    mode: "global-budget-fallback",
    indexedSegments,
    cellReferences,
  };
}

function localStrokeDirectionResolver(
  plan: StudioHokusaiNaturalMediaRenderPlan,
  fallback: number,
): LocalStrokeDirectionResolver {
  const limits = STUDIO_HOKUSAI_LOCAL_DIRECTION_INDEX_LIMITS;
  if (
    plan.raster.width * plan.raster.height > limits.maxRasterPixels
    || plan.samples.length - 1 > limits.maxSegments
  ) {
    return globalDirectionFallback(fallback);
  }
  const cellSize = Math.max(
    8,
    Math.min(64, plan.raster.radiusPixels * 1.5),
  );
  const columns = Math.max(1, Math.ceil(plan.raster.width / cellSize));
  const rows = Math.max(1, Math.ceil(plan.raster.height / cellSize));
  const influence = Math.max(12, plan.raster.radiusPixels * 4);
  const segments: StrokeSegment[] = [];
  const cells = new Map<number, number[]>();
  let cellReferences = 0;
  for (let index = 1; index < plan.samples.length; index += 1) {
    const previous = plan.samples[index - 1];
    const current = plan.samples[index];
    if (!previous || !current) continue;
    const deltaX = current.x - previous.x;
    const deltaY = current.y - previous.y;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    if (lengthSquared <= 0.000_001) continue;
    const segmentIndex = segments.length;
    segments.push({
      startX: previous.x,
      startY: previous.y,
      deltaX,
      deltaY,
      lengthSquared,
      axisRadians: canonicalAxisRadians(Math.atan2(deltaY, deltaX)),
    });
    const minimumCellX = Math.max(
      0,
      Math.floor((Math.min(previous.x, current.x) - influence) / cellSize),
    );
    const maximumCellX = Math.min(
      columns - 1,
      Math.floor((Math.max(previous.x, current.x) + influence) / cellSize),
    );
    const minimumCellY = Math.max(
      0,
      Math.floor((Math.min(previous.y, current.y) - influence) / cellSize),
    );
    const maximumCellY = Math.min(
      rows - 1,
      Math.floor((Math.max(previous.y, current.y) + influence) / cellSize),
    );
    const segmentCellReferences =
      (maximumCellX - minimumCellX + 1)
      * (maximumCellY - minimumCellY + 1);
    if (
      segmentCellReferences <= 0
      || cellReferences + segmentCellReferences > limits.maxCellReferences
    ) {
      return globalDirectionFallback(
        fallback,
        segments.length,
        cellReferences,
      );
    }
    for (let cellY = minimumCellY; cellY <= maximumCellY; cellY += 1) {
      for (let cellX = minimumCellX; cellX <= maximumCellX; cellX += 1) {
        const key = cellY * columns + cellX;
        const bucket = cells.get(key);
        if (bucket) {
          if (bucket.length >= limits.maxCandidatesPerCell) {
            return globalDirectionFallback(
              fallback,
              segments.length,
              cellReferences,
            );
          }
          bucket.push(segmentIndex);
        } else {
          if (cells.size >= limits.maxCells) {
            return globalDirectionFallback(
              fallback,
              segments.length,
              cellReferences,
            );
          }
          cells.set(key, [segmentIndex]);
        }
        cellReferences += 1;
      }
    }
  }
  return {
    mode: "local-grid",
    indexedSegments: segments.length,
    cellReferences,
    resolve: (x, y) => {
      const cellX = Math.max(
        0,
        Math.min(columns - 1, Math.floor(x / cellSize)),
      );
      const cellY = Math.max(
        0,
        Math.min(rows - 1, Math.floor(y / cellSize)),
      );
      const candidates = cells.get(cellY * columns + cellX);
      if (!candidates || candidates.length === 0) return fallback;
      let bestDistanceSquared = Number.POSITIVE_INFINITY;
      let bestAngle = fallback;
      for (const segmentIndex of candidates) {
        const segment = segments[segmentIndex];
        if (!segment) continue;
        const relativeX = x - segment.startX;
        const relativeY = y - segment.startY;
        const station = Math.max(
          0,
          Math.min(
            1,
            (
              relativeX * segment.deltaX
              + relativeY * segment.deltaY
            ) / segment.lengthSquared,
          ),
        );
        const closestX = segment.startX + segment.deltaX * station;
        const closestY = segment.startY + segment.deltaY * station;
        const distanceSquared =
          (x - closestX) ** 2 + (y - closestY) ** 2;
        if (distanceSquared < bestDistanceSquared) {
          bestDistanceSquared = distanceSquared;
          bestAngle = segment.axisRadians;
        }
      }
      return bestAngle;
    },
  };
}

function pencilTexture(
  x: number,
  y: number,
  seed: number,
  diagnostics?: NoiseEvaluationDiagnostics,
): MaterialTextureSample {
  // Low-frequency coordinate warping prevents independent fibre/tooth fields
  // from locking into a visible weave. The graphite fibre is itself a 2-D
  // anisotropic field rather than a 1-D stripe, so it stays irregular while
  // retaining a subtle paper direction at high zoom.
  const warpX = valueNoise2d(
    x * 0.018,
    y * 0.018,
    8,
    seed ^ 0x6ab3_91e5,
    diagnostics,
  );
  const warpY = valueNoise2d(
    x * -0.015 + y * 0.009,
    x * 0.009 + y * 0.015,
    9,
    seed ^ 0x381d_e72b,
    diagnostics,
  );
  const warpedX = x + (warpX - 0.5) * 5.2;
  const warpedY = y + (warpY - 0.5) * 5.2;
  const fibre = valueNoise2d(
    warpedX * 0.31 + warpedY * 0.08,
    warpedX * -0.014 + warpedY * 0.052,
    11,
    seed ^ 0x50a3_7e91,
    diagnostics,
  );
  const paper = valueNoise2d(
    warpedX * 0.44,
    warpedY * 0.44,
    12,
    seed ^ 0x8dc4_5a13,
    diagnostics,
  );
  const tooth = valueNoise2d(
    warpedX * -0.15 + warpedY * 0.12,
    warpedX * 0.12 + warpedY * 0.15,
    13,
    seed ^ 0x2f6e_2b1d,
    diagnostics,
  );
  const graphite = 0.34 * fibre + 0.39 * paper + 0.27 * tooth;
  return {
    alpha: 0.39 + graphite * 0.61,
    color: 0.69 + graphite * 0.41,
    lift: 0,
  };
}

function charcoalTexture(
  x: number,
  y: number,
  seed: number,
  diagnostics?: NoiseEvaluationDiagnostics,
): MaterialTextureSample {
  // Warp the paper domain before sampling the pigment fields. Sampling a
  // coarse value-noise lattice directly made its square interpolation cells
  // readable at high zoom and amplified Hokusai's circular dab joints on long
  // strokes. The oblique, independently warped fields below remain continuous
  // in document coordinates, but no longer expose an axis-aligned cell grid.
  const domainWarp = valueNoise2d(
    x * 0.014 + y * 0.005,
    x * -0.005 + y * 0.014,
    19,
    seed ^ 0x4dc8_72a1,
    diagnostics,
  );
  const warpOffset = domainWarp - 0.5;
  // One shared low-frequency sample is deliberately projected on two
  // different axes. That keeps the live Worker pass bounded at four noise
  // samples per visible pixel while still breaking the square source lattice.
  const warpedX = x + warpOffset * 7.4;
  const warpedY = y - warpOffset * 5.6;
  const coarseA = valueNoise2d(
    warpedX * 0.077 + warpedY * 0.051,
    warpedX * -0.035 + warpedY * 0.083,
    21,
    seed ^ 0x1c35_7d9b,
    diagnostics,
  );
  const coarseB = valueNoise2d(
    warpedX * -0.049 + warpedY * 0.071,
    warpedX * 0.063 + warpedY * 0.044,
    22,
    seed ^ 0xa46f_28c7,
    diagnostics,
  );
  const fine = valueNoise2d(
    warpedX * 0.29 + warpedY * 0.17,
    warpedX * -0.14 + warpedY * 0.31,
    23,
    seed ^ 0x73bd_14e5,
    diagnostics,
  );
  const broadPigment = 0.56 * coarseA + 0.44 * coarseB;
  const carbonGrain = broadPigment * 0.78 + fine * 0.22;
  return {
    // Keep the material floor high enough that continuous source coverage is
    // never broken into a train of isolated circular stamps. Fine paper tooth
    // remains visible through colour variation instead of destructive holes.
    alpha: 0.38 + carbonGrain * 0.56,
    color: 0.61 + carbonGrain * 0.43,
    lift: 0,
  };
}

function pigmentFields(
  x: number,
  y: number,
  seed: number,
  lane: number,
  broadScale: number,
  fineScale: number,
  diagnostics?: NoiseEvaluationDiagnostics,
): Readonly<{ broad: number; fine: number; fibre: number }> {
  const warp = valueNoise2d(
    x * 0.011 + y * 0.007,
    x * -0.008 + y * 0.014,
    lane,
    seed ^ 0x6d2b_79f5,
    diagnostics,
  ) - 0.5;
  const warpedX = x + warp * (5.2 + lane * 0.11);
  const warpedY = y - warp * (4.1 + lane * 0.07);
  const broad = valueNoise2d(
    warpedX * broadScale + warpedY * broadScale * 0.57,
    warpedX * broadScale * -0.43 + warpedY * broadScale * 0.91,
    lane + 1,
    seed ^ 0x9e37_79b9,
    diagnostics,
  );
  const fine = valueNoise2d(
    warpedX * fineScale - warpedY * fineScale * 0.31,
    warpedX * fineScale * 0.47 + warpedY * fineScale * 0.88,
    lane + 2,
    seed ^ 0x85eb_ca6b,
    diagnostics,
  );
  const fibre = valueNoise2d(
    warpedX * fineScale * 0.73 + warpedY * 0.041,
    warpedX * -0.037 + warpedY * fineScale * 0.19,
    lane + 3,
    seed ^ 0xc2b2_ae35,
    diagnostics,
  );
  return { broad, fine, fibre };
}

function chalkTexture(
  x: number,
  y: number,
  seed: number,
  diagnostics?: NoiseEvaluationDiagnostics,
): MaterialTextureSample {
  // Klecks genBrushAlpha01 structure via studio-oss-brush-kernels (MIT).
  // Four internal multi-octave samples (budget = 4). Document coords map into
  // a local tip cell so mineral tooth is structural, not a flat opacity knob.
  if (diagnostics) diagnostics.count += 4;
  const cellX = Math.sin(x * 0.11 + y * 0.03) * 0.95;
  const cellY = Math.cos(y * 0.11 - x * 0.04) * 0.95;
  const chalk = studioOssKlecksChalkCoverage(cellX, cellY, seed ^ 0x41);
  return {
    alpha: 0.34 + chalk * 0.62,
    color: 0.7 + chalk * 0.4,
    lift: 0.02 + (1 - chalk) * 0.055,
  };
}

function crayonTexture(
  x: number,
  y: number,
  seed: number,
  directionRadians: number,
  diagnostics?: NoiseEvaluationDiagnostics,
): MaterialTextureSample {
  // Direction-aligned wax scrape (OSS kernel, 3 value-noise samples) over paper tooth.
  //
  // The scrape alone was this material's entire texture, and it reads as procedural: a wax stick
  // does not lay an even film, it rides the peaks of the sheet and skips the valleys, and that
  // skipping is what the eye recognises as wax. Every sibling dry medium already carried a tooth
  // term — chalk, charcoal and pastel each spend 4 samples — while crayon spent 3 and had none,
  // which is why it was the one material that looked wrong. The extra field is deliberate cost:
  // texture is not traded away to keep a smaller noise budget.
  if (diagnostics) diagnostics.count += 3;
  const sample = studioOssDirectionalWaxSample(
    x,
    y,
    directionRadians,
    seed ^ 0x47,
  );
  // Two samples, not a full pigment field: the wax only needs the sheet's undulation and the
  // grain riding on it, so crayon lands at 5 like pencil rather than becoming the costliest
  // material. `broad` is the sheet, `fine` the grain.
  const broad = valueNoise2d(x * 0.026, y * 0.026, 0x47, seed, diagnostics);
  const fine = valueNoise2d(x * 0.071, y * 0.071, 0x48, seed, diagnostics);
  // Bias above the midpoint so the bed stays continuous instead of punching holes: a light pass
  // breaks up on the peaks while a burnished second pass still fills in.
  const peak = Math.min(1, Math.max(0, 0.46 + (broad - 0.5) * 1.24 + (fine - 0.5) * 0.52));
  const deposit = Math.min(1, Math.max(0, sample.wax * (0.58 + peak * 0.62)));
  return {
    alpha: 0.5 + deposit * 0.46,
    color: 0.62 + deposit * 0.54,
    // A bare valley reads as lifted paper, so skipped tooth joins the scrape and grit.
    lift: sample.scrape * 0.12 + sample.grit * 0.05 + (1 - peak) * 0.05,
  };
}

function pastelTexture(
  x: number,
  y: number,
  seed: number,
  diagnostics?: NoiseEvaluationDiagnostics,
): MaterialTextureSample {
  // Soft cake body via pigment fields (budget 4) with subtractive fine crumb.
  const field = pigmentFields(x, y, seed, 53, 0.034, 0.56, diagnostics);
  const powder = Math.max(
    0,
    field.broad * 0.62 + field.fine * 0.28 + field.fibre * 0.1 - field.fine * 0.12,
  );
  return {
    alpha: 0.36 + powder * 0.58,
    color: 0.68 + powder * 0.46,
    lift: 0.024 + (1 - field.broad) * 0.06 + Math.max(0, field.fine - 0.62) * 0.04,
  };
}

function oilTexture(
  x: number,
  y: number,
  seed: number,
  directionRadians: number,
  diagnostics?: NoiseEvaluationDiagnostics,
): MaterialTextureSample {
  // libmypaint modelling + soft bristle film (OSS kernel, 3× valueNoise1d).
  const film = studioOssOilBristleFilm(
    x,
    y,
    directionRadians,
    seed,
    (coordinate, lane, filmSeed) =>
      valueNoise1d(coordinate, lane, filmSeed, diagnostics),
  );
  return {
    alpha: film.alpha,
    color: film.color,
    lift: film.lift,
  };
}

/**
 * Two oblique document-coordinate fields are enough to add broken pigment
 * body to the multi-scale bristle evaluations above. Earlier profiles called
 * the full four-field powder kernel after `oilTexture`, exploding oil's
 * per-pixel noise cost. This compact pair keeps acrylic/oil-pastel/painterly
 * within a 2× oil budget while retaining non-square, deterministic variation.
 */
function compactPaintBodyFields(
  x: number,
  y: number,
  seed: number,
  lane: number,
  broadScale: number,
  detailScale: number,
  diagnostics?: NoiseEvaluationDiagnostics,
): Readonly<{ broad: number; detail: number }> {
  const broad = valueNoise2d(
    x * broadScale + y * broadScale * 0.61,
    x * broadScale * -0.47 + y * broadScale * 0.89,
    lane,
    seed ^ 0x6d2b_79f5,
    diagnostics,
  );
  const detail = valueNoise2d(
    x * detailScale - y * detailScale * 0.29,
    x * detailScale * 0.43 + y * detailScale * 0.83,
    lane + 1,
    seed ^ 0x85eb_ca6b,
    diagnostics,
  );
  return { broad, detail };
}

function oilPastelTexture(
  x: number,
  y: number,
  seed: number,
  directionRadians: number,
  diagnostics?: NoiseEvaluationDiagnostics,
): MaterialTextureSample {
  const oil = oilTexture(
    x,
    y,
    seed ^ 0x7f4a_7c15,
    directionRadians,
    diagnostics,
  );
  const tooth = compactPaintBodyFields(
    x,
    y,
    seed,
    59,
    0.046,
    0.28,
    diagnostics,
  );
  // Oil-pastel = soft oil film + wax scrape tooth (Krita oil pastel feel).
  const wax = tooth.broad * 0.38 + tooth.detail * 0.62;
  return {
    alpha: 0.7 + (oil.alpha * 0.4 + wax * 0.6) * 0.28,
    color: 0.72 + (oil.color * 0.35 + wax * 0.65) * 0.38,
    lift: oil.lift * 0.45 + Math.max(0, wax - 0.58) * 0.1,
  };
}

function acrylicTexture(
  x: number,
  y: number,
  seed: number,
  directionRadians: number,
  diagnostics?: NoiseEvaluationDiagnostics,
): MaterialTextureSample {
  const oil = oilTexture(
    x,
    y,
    seed ^ 0x1656_67b1,
    directionRadians,
    diagnostics,
  );
  const polymer = compactPaintBodyFields(
    x,
    y,
    seed,
    67,
    0.031,
    0.24,
    diagnostics,
  );
  return {
    alpha: 0.85 + (oil.alpha * 0.55 + polymer.broad * 0.45) * 0.14,
    color: 0.75 + (oil.color * 0.63 + polymer.detail * 0.37) * 0.34,
    lift: Math.max(0, polymer.detail - 0.66) * 0.085,
  };
}

function gouacheTexture(
  x: number,
  y: number,
  seed: number,
  diagnostics?: NoiseEvaluationDiagnostics,
): MaterialTextureSample {
  const field = pigmentFields(x, y, seed, 71, 0.026, 0.21, diagnostics);
  const matte = field.broad * 0.69 + field.fine * 0.21 + field.fibre * 0.1;
  return {
    alpha: 0.88 + matte * 0.11,
    color: 0.78 + matte * 0.27,
    lift: 0.018 + (1 - field.fine) * 0.035,
  };
}

function painterlyTexture(
  x: number,
  y: number,
  seed: number,
  directionRadians: number,
  diagnostics?: NoiseEvaluationDiagnostics,
): MaterialTextureSample {
  const oil = oilTexture(
    x,
    y,
    seed ^ 0x27d4_eb2f,
    directionRadians,
    diagnostics,
  );
  const broken = compactPaintBodyFields(
    x,
    y,
    seed,
    79,
    0.044,
    0.37,
    diagnostics,
  );
  const body = oil.alpha * 0.5 + broken.broad * 0.3 + broken.detail * 0.2;
  return {
    alpha: 0.71 + body * 0.28,
    color: 0.65 + (oil.color * 0.53 + broken.detail * 0.47) * 0.49,
    lift: oil.lift * 0.7 + Math.max(0, broken.detail - 0.55) * 0.1,
  };
}

function materialCoverage(
  alpha: number,
  materialProfileId: StudioHokusaiMaterialProfileId,
): number {
  const normalized = alpha / 255;
  // A monotonic contrast transfer suppresses Hokusai's low-alpha circular
  // halo without a blur/median pass. It keeps partial paper tooth inside the
  // body and cannot invert one-pass/retrace coverage ordering.
  switch (materialProfileId) {
    case "pencil":
      // A sub-3px graphite stroke is dominated by antialias coverage rather
      // than a fully opaque core. A gamma below one raises those legitimate
      // edge/core samples without painting transparent pixels, so the same
      // material transfer remains deterministic for packed live patches and
      // the canonical crop. Larger pencils still saturate naturally.
      return Math.min(1, normalized ** 0.72 * 1.35);
    case "charcoal":
      // The previous super-linear curve suppressed antialiased overlap between
      // neighbouring Hokusai dabs much more than their centres. That converted
      // a continuous carrier into visible beads during a long stroke. A
      // monotonic sub-linear transfer lifts legitimate overlap coverage while
      // preserving pressure order and never painting transparent pixels.
      return Math.min(1, normalized ** 0.86 * 1.28);
    case "chalk":
      // Powder build: sub-linear so overlapping mineral flakes accumulate softly.
      return Math.min(1, normalized ** 0.78 * 1.28);
    case "crayon":
      // Wax scrape still needs a continuous core; mild sub-linear keeps tooth
      // without bead gaps between Hokusai dabs.
      return Math.min(1, normalized ** 0.9 * 1.2);
    case "pastel":
      return Math.min(1, normalized ** 0.8 * 1.24);
    case "oil-pastel":
      return Math.min(1, normalized ** 0.94 * 1.18);
    case "oil":
      // Super-linear **1.18 punched soft dab shoulders into hard plastic ridges
      // (Magma-class oil wants soft film build, not posterized edges).
      return Math.min(1, normalized ** 0.94 * 1.16);
    case "acrylic":
      return Math.min(1, normalized ** 1.0 * 1.2);
    case "gouache":
      return Math.min(1, normalized ** 0.9 * 1.18);
    case "painterly":
      return Math.min(1, normalized ** 0.98 * 1.18);
    case "calligraphy":
    case "marker":
      return normalized;
  }
}

function materialTexture(
  materialProfileId: StudioHokusaiMaterialProfileId,
  x: number,
  y: number,
  seed: number,
  directionRadians: number,
  diagnostics?: NoiseEvaluationDiagnostics,
): MaterialTextureSample {
  switch (materialProfileId) {
    case "pencil":
      return pencilTexture(x, y, seed, diagnostics);
    case "charcoal":
      return charcoalTexture(x, y, seed, diagnostics);
    case "chalk":
      return chalkTexture(x, y, seed, diagnostics);
    case "crayon":
      return crayonTexture(x, y, seed, directionRadians, diagnostics);
    case "pastel":
      return pastelTexture(x, y, seed, diagnostics);
    case "oil-pastel":
      return oilPastelTexture(x, y, seed, directionRadians, diagnostics);
    case "oil":
      return oilTexture(x, y, seed, directionRadians, diagnostics);
    case "acrylic":
      return acrylicTexture(x, y, seed, directionRadians, diagnostics);
    case "gouache":
      return gouacheTexture(x, y, seed, diagnostics);
    case "painterly":
      return painterlyTexture(x, y, seed, directionRadians, diagnostics);
    case "calligraphy":
    case "marker":
      return { alpha: 1, color: 1, lift: 0 };
  }
}

/**
 * Deterministic operation-count probe for CI. It executes the same profile
 * kernel as production but counts noise-field evaluations instead of relying
 * on machine-dependent wall-clock timing.
 */
export function studioHokusaiMaterialProfileNoiseEvaluationCount(
  materialProfileId: StudioHokusaiMaterialProfileId,
): number {
  const diagnostics: NoiseEvaluationDiagnostics = { count: 0 };
  materialTexture(
    materialProfileId,
    37.25,
    19.75,
    0x1234_5678,
    Math.PI / 7,
    diagnostics,
  );
  return diagnostics.count;
}

/**
 * Applies a deterministic material transfer to Hokusai's transparent frame.
 *
 * The coverage curve is monotonic and every texture factor is positive; both
 * depend only on source alpha, document coordinates, preset and seed.
 * Therefore a retraced Hokusai stroke whose source alpha is non-decreasing
 * remains non-decreasing after this pass. The pass cannot punch a new
 * centreline hole and it never paints transparent pixels.
 */
export function applyStudioHokusaiNaturalMediaTextureV2(
  pixels: Uint8Array,
  plan: StudioHokusaiNaturalMediaRenderPlan,
  layout: StudioHokusaiNaturalMediaPixelLayout,
): StudioHokusaiNaturalMediaTextureMetrics {
  const [frameX, frameY, frameWidth, frameHeight] = layout.frameBounds;
  const [dirtyX, dirtyY, dirtyWidth, dirtyHeight] = layout.dirtyBounds;
  if (
    ![
      frameX,
      frameY,
      frameWidth,
      frameHeight,
      dirtyX,
      dirtyY,
      dirtyWidth,
      dirtyHeight,
    ].every(Number.isSafeInteger)
    || frameX < 0
    || frameY < 0
    || frameWidth <= 0
    || frameHeight <= 0
    || dirtyX < frameX
    || dirtyY < frameY
    || dirtyWidth <= 0
    || dirtyHeight <= 0
    || dirtyX + dirtyWidth > frameX + frameWidth
    || dirtyY + dirtyHeight > frameY + frameHeight
    || frameX + frameWidth > plan.raster.width
    || frameY + frameHeight > plan.raster.height
    || pixels.byteLength !== frameWidth * frameHeight * 4
  ) {
    throw new RangeError("Hokusai material texture pixel layout is invalid.");
  }
  if (!studioHokusaiMaterialProfileIsCompatible(
    plan.presetId,
    plan.materialProfileId,
  )) {
    throw new RangeError("Hokusai material profile does not match its carrier preset.");
  }
  const directionRadians = dominantStrokeDirection(plan.samples);
  if (
    plan.presetId !== "pencil"
    && plan.presetId !== "charcoal"
    && plan.presetId !== "oil"
  ) {
    let visiblePixels = 0;
    for (let y = dirtyY; y < dirtyY + dirtyHeight; y += 1) {
      let index = (
        (y - frameY) * frameWidth
        + dirtyX
        - frameX
      ) * 4 + 3;
      for (let x = 0; x < dirtyWidth; x += 1, index += 4) {
        if ((pixels[index] ?? 0) > 0) visiblePixels += 1;
      }
    }
    return Object.freeze({
      version: STUDIO_HOKUSAI_NATURAL_MEDIA_TEXTURE_VERSION,
      presetId: plan.presetId,
      materialProfileId: plan.materialProfileId,
      visiblePixels,
      alphaChangedPixels: 0,
      colorChangedPixels: 0,
      dominantDirectionRadians: directionRadians,
      directionIndexMode: "not-applicable",
      directionIndexSegments: 0,
      directionIndexCellReferences: 0,
    });
  }

  let visiblePixels = 0;
  let alphaChangedPixels = 0;
  let colorChangedPixels = 0;
  const inverseScale = 1 / plan.raster.scale;
  const directionAwareProfile = (
    plan.materialProfileId === "oil"
    || plan.materialProfileId === "oil-pastel"
    || plan.materialProfileId === "acrylic"
    || plan.materialProfileId === "painterly"
    || plan.materialProfileId === "crayon"
  );
  const localMaterialDirection = directionAwareProfile
    ? localStrokeDirectionResolver(plan, directionRadians)
    : null;
  const colorMode = studioOssMaterialColorModeForProfile(
    plan.materialProfileId,
  );
  for (let y = dirtyY; y < dirtyY + dirtyHeight; y += 1) {
    const documentY = plan.logicalBounds.y + y * inverseScale;
    let index = (
      (y - frameY) * frameWidth
      + dirtyX
      - frameX
    ) * 4;
    for (let x = dirtyX; x < dirtyX + dirtyWidth; x += 1, index += 4) {
      const alpha = pixels[index + 3] ?? 0;
      if (alpha <= 0) continue;
      visiblePixels += 1;
      const documentX = plan.logicalBounds.x + x * inverseScale;
      const texture = materialTexture(
        plan.materialProfileId,
        documentX,
        documentY,
        plan.seed,
        localMaterialDirection?.resolve(x, y) ?? directionRadians,
      );
      const coverage = materialCoverage(alpha, plan.materialProfileId);
      const powderCoefficient = plan.materialProfileId === "charcoal"
        ? 0.55
        : plan.materialProfileId === "chalk"
          ? 0.48
          : plan.materialProfileId === "pastel"
            ? 0.38
            : plan.materialProfileId === "crayon"
              ? 0.22
              : 0;
      const materialAlpha = powderCoefficient > 0
        ? texture.alpha ** (1 + (1 - coverage) * powderCoefficient)
        : texture.alpha;
      const texturedAlpha = Math.max(
        1,
        clampByte(255 * coverage * materialAlpha),
      );
      if (texturedAlpha !== alpha) alphaChangedPixels += 1;
      pixels[index + 3] = texturedAlpha;

      for (let channel = 0; channel < 3; channel += 1) {
        const source = pixels[index + channel] ?? 0;
        // Paint-film mode multiplies density only (OSS hybrid): dark oil no longer
        // invents grey glitter via (255-source)*lift white mix.
        const textured = clampByte(
          studioOssApplyMaterialColorChannel(
            source,
            texture.color,
            texture.lift,
            colorMode,
          ),
        );
        if (textured !== source) colorChangedPixels += 1;
        pixels[index + channel] = textured;
      }
    }
  }
  return Object.freeze({
    version: STUDIO_HOKUSAI_NATURAL_MEDIA_TEXTURE_VERSION,
    presetId: plan.presetId,
    materialProfileId: plan.materialProfileId,
    visiblePixels,
    alphaChangedPixels,
    colorChangedPixels,
    dominantDirectionRadians: directionRadians,
    directionIndexMode: localMaterialDirection?.mode ?? "not-applicable",
    directionIndexSegments: localMaterialDirection?.indexedSegments ?? 0,
    directionIndexCellReferences: localMaterialDirection?.cellReferences ?? 0,
  });
}
