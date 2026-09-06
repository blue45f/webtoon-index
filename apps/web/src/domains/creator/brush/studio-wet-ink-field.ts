/**
 * Deterministic sparse wet-ink / sumi field.
 *
 * Existing watercolor code plans stable brush stations and the ink-wash filter stylizes an
 * already-finished bitmap. This module owns the missing state between those layers: water,
 * mobile pigment, surface wetness, fixed stain and paper absorbency evolve on world-aligned tiles.
 *
 * It has no DOM, Canvas, Konva or GPU dependency. A renderer consumes bounded RGBA tile uploads,
 * so the field can sit beside the current dynamic-brush renderer without sharing or invalidating
 * its coverage surfaces.
 */

import {
  planCausalWatercolorBrush,
} from "../studio-causal-watercolor-brush";
import { hash2 } from "../studio-grain";
import {
  resolveStudioHandFeelMediaLoadV1,
  studioHandFeelTravelSpeedV1,
} from "../studio-hand-feel-media-load-v1";
import { studioLivingInkChromaBleedMultipliers } from "../studio-living-ink-field";

import type { WatercolorBrushDab } from "./studio-watercolor-brush";

const FIELD_KIND = "toonspectrum.wet-ink-field" as const;
const FIELD_VERSION = 1 as const;
const FIELD_EPSILON = 1 / 65_536;
const FIELD_VALUE_MAX = 4;
const COORDINATE_QUANTUM = 1 / 4_096;
const DEFAULT_PRESSURE = 0.55;
const MAX_COORDINATE_ABS = 1_000_000;
const MAX_INPUT_SAMPLES = 65_536;
const MAX_NORMALIZED_SAMPLES = 131_072;
const MAX_STEPS_PER_CALL = 256;

export const STUDIO_WET_INK_TILE_SIZE_RANGE = { min: 8, max: 128 } as const;
export const STUDIO_WET_INK_MAX_TILE_RANGE = { min: 1, max: 16_384 } as const;
export const STUDIO_WET_INK_MAX_CELL_RANGE = { min: 64, max: 16_777_216 } as const;

export interface StudioWetInkRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface StudioWetInkFieldConfigInput {
  readonly width: number;
  readonly height: number;
  readonly tileSize?: number;
  readonly seed?: number;
  readonly maxTiles?: number;
  readonly maxCells?: number;
  readonly maxSimulationSteps?: number;
  readonly maxUploadBytes?: number;
  /** Explicit finite-difference coefficient; capped at 0.24 for four-neighbour stability. */
  readonly waterDiffusion?: number;
  readonly pigmentDiffusion?: number;
  readonly chromatography?: number;
  readonly bleed?: number;
  readonly absorption?: number;
  readonly evaporation?: number;
  readonly dryingRate?: number;
  readonly fixationRate?: number;
  readonly edgeDarkening?: number;
  readonly granulation?: number;
  readonly paperRoughness?: number;
  readonly inkColor?: StudioWetInkRgb;
  readonly spectralAbsorption?: StudioWetInkRgb;
}

export interface StudioWetInkFieldConfig {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly seed: number;
  readonly maxTiles: number;
  readonly maxCells: number;
  readonly maxSimulationSteps: number;
  readonly maxUploadBytes: number;
  readonly waterDiffusion: number;
  readonly pigmentDiffusion: number;
  readonly chromatography: number;
  readonly bleed: number;
  readonly absorption: number;
  readonly evaporation: number;
  readonly dryingRate: number;
  readonly fixationRate: number;
  readonly edgeDarkening: number;
  readonly granulation: number;
  readonly paperRoughness: number;
  readonly inkColor: StudioWetInkRgb;
  readonly spectralAbsorption?: StudioWetInkRgb;
}

export interface StudioWetInkBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioWetInkTile {
  readonly tileX: number;
  readonly tileY: number;
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
  water: Float32Array;
  pigment: Float32Array;
  wetness: Float32Array;
  stain: Float32Array;
  readonly paper: Float32Array;
  /**
   * Per-channel mobile optical density. Red-absorbing dye can outrun blue when
   * `chromatography` > 0 (InkWash §06). Loaded snapshots without this field are
   * reconstructed from scalar pigment × spectral absorption.
   */
  pigmentOpticalDensity?: [Float32Array, Float32Array, Float32Array];
  revision: number;
}

export interface StudioWetInkField {
  readonly kind: typeof FIELD_KIND;
  readonly version: typeof FIELD_VERSION;
  readonly config: StudioWetInkFieldConfig;
  readonly tiles: Map<string, StudioWetInkTile>;
  allocatedCells: number;
  simulationStep: number;
  revision: number;
  activeBounds: StudioWetInkBounds | null;
  dirtyBounds: StudioWetInkBounds | null;
}

export type StudioWetInkFailureCode =
  | "invalid-config"
  | "invalid-input"
  | "tile-budget-exceeded"
  | "cell-budget-exceeded"
  | "step-budget-exceeded"
  | "dab-budget-exceeded"
  | "upload-budget-exceeded";

export type StudioWetInkResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly code: StudioWetInkFailureCode;
      readonly reason: string;
    };

export interface StudioWetInkStrokeSample {
  readonly x: number;
  readonly y: number;
  readonly timeMs: number;
  readonly pressure?: number;
}

export interface StudioWetInkInputNormalizationOptions {
  /** Defaults to a 240 Hz authoritative field input clock. */
  readonly fixedRateHz?: number;
  readonly coordinateQuantum?: number;
}

export interface StudioNormalizedWetInkStroke {
  readonly samples: readonly Required<StudioWetInkStrokeSample>[];
  readonly fixedRateHz: number;
  readonly sourceSampleCount: number;
}

export interface StudioWetInkBrushInput {
  readonly samples: readonly StudioWetInkStrokeSample[];
  readonly radius: number;
  readonly hardness?: number;
  readonly spacing?: number;
  readonly waterLoad?: number;
  readonly pigmentLoad?: number;
  readonly wetnessLoad?: number;
  readonly seed?: number;
  readonly maxDabs?: number;
  readonly normalization?: StudioWetInkInputNormalizationOptions;
}

/**
 * Already planned causal dabs. This is the low-latency boundary used by the live overlay: the
 * causal walker owns prefix stability while this field owns material transport. Supplying dabs
 * avoids replaying the accepted source prefix on every pointer frame.
 */
export interface StudioWetInkDabDepositInput {
  readonly dabs: readonly WatercolorBrushDab[];
  readonly hardness?: number;
  readonly waterLoad?: number;
  readonly pigmentLoad?: number;
  readonly wetnessLoad?: number;
  readonly maxDabs?: number;
}

export interface StudioWetInkDepositResult {
  readonly normalizedSampleCount: number;
  readonly dabCount: number;
  readonly dirtyBounds: StudioWetInkBounds | null;
}

export interface StudioWetInkSimulationResult {
  readonly requestedSteps: number;
  readonly appliedSteps: number;
  readonly dirtyBounds: StudioWetInkBounds | null;
  readonly activeBounds: StudioWetInkBounds | null;
}

export interface StudioWetInkCell {
  readonly water: number;
  readonly pigment: number;
  readonly wetness: number;
  readonly stain: number;
  readonly paper: number;
  readonly pigmentOpticalDensity: readonly [number, number, number];
}

export interface StudioWetInkTileUpload {
  readonly tileX: number;
  readonly tileY: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly revision: number;
  readonly rgba: Uint8ClampedArray;
}

export const DEFAULT_STUDIO_WET_INK_FIELD_CONFIG = Object.freeze({
  tileSize: 32,
  seed: 41,
  maxTiles: 1_024,
  maxCells: 1_048_576,
  maxSimulationSteps: 4_096,
  maxUploadBytes: 16 * 1024 * 1024,
  waterDiffusion: 0.18,
  pigmentDiffusion: 0.105,
  chromatography: 0.5,
  bleed: 0.32,
  absorption: 0.022,
  evaporation: 0.012,
  dryingRate: 0.035,
  fixationRate: 0.115,
  edgeDarkening: 0.42,
  granulation: 0.36,
  paperRoughness: 0.5,
  inkColor: Object.freeze({ r: 30, g: 37, b: 42 }),
  spectralAbsorption: Object.freeze({ r: 1.0, g: 0.96, b: 0.88 }),
});

/**
 * InkWash §08 display contract (Johno Whitaker, 2026).
 * Applied when rasterizing wet-ink tiles so a wash reads as paper + optical density,
 * not as flat alpha-over mud.
 */
export const STUDIO_WET_INK_INKWASH_DISPLAY = Object.freeze({
  beerLambertStrength: 1.9,
  edgeDarkeningGain: 1.35,
  granulationGain: 0.55,
  fiberAmplitude: 0.05,
  toothAmplitude: 0.022,
  wetSheen: Object.freeze({ r: 0.16, g: 0.15, b: 0.11 }),
  wetSheenGate: Object.freeze({ lo: 0.02, hi: 0.6 }),
  mobility: Object.freeze({ lo: 0.02, hi: 0.45 }),
  capillaryCreep: 0.12,
});

/** InkWash §04: pigment only moves where the paper is wet. */
export function studioWetInkWetMobility(wetness: number): number {
  const { lo, hi } = STUDIO_WET_INK_INKWASH_DISPLAY.mobility;
  const t = clamp01((wetness - lo) / Math.max(1e-8, hi - lo));
  return t * t * (3 - 2 * t);
}

function failure<T>(
  code: StudioWetInkFailureCode,
  reason: string,
): StudioWetInkResult<T> {
  return { ok: false, code, reason };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function inRange(value: unknown, min: number, max: number): value is number {
  return finite(value) && value >= min && value <= max;
}

function safeInteger(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

function clamp(value: number, min: number, max: number): number {
  return value <= min ? min : value >= max ? max : value;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function fieldValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.fround(clamp(value, 0, FIELD_VALUE_MAX));
}

function normalizeRgb(
  value: StudioWetInkRgb | undefined,
): StudioWetInkRgb | null {
  const source = value ?? DEFAULT_STUDIO_WET_INK_FIELD_CONFIG.inkColor;
  if (
    !inRange(source.r, 0, 255)
    || !inRange(source.g, 0, 255)
    || !inRange(source.b, 0, 255)
  ) {
    return null;
  }
  return {
    r: Math.round(source.r),
    g: Math.round(source.g),
    b: Math.round(source.b),
  };
}

/**
 * Creates an empty sparse field. Invalid or unstable coefficients return before allocating any
 * typed array, which keeps hostile import data fail-closed.
 */
export function createStudioWetInkField(
  input: StudioWetInkFieldConfigInput,
): StudioWetInkResult<StudioWetInkField> {
  if (
    !safeInteger(input.width, 1, MAX_COORDINATE_ABS)
    || !safeInteger(input.height, 1, MAX_COORDINATE_ABS)
    || !Number.isSafeInteger(input.width * input.height)
  ) {
    return failure("invalid-config", "Wet-ink field dimensions must be positive safe integers.");
  }

  const tileSize = input.tileSize ?? DEFAULT_STUDIO_WET_INK_FIELD_CONFIG.tileSize;
  const seed = input.seed ?? DEFAULT_STUDIO_WET_INK_FIELD_CONFIG.seed;
  const maxTiles = input.maxTiles ?? DEFAULT_STUDIO_WET_INK_FIELD_CONFIG.maxTiles;
  const maxCells = input.maxCells ?? DEFAULT_STUDIO_WET_INK_FIELD_CONFIG.maxCells;
  const maxSimulationSteps =
    input.maxSimulationSteps ?? DEFAULT_STUDIO_WET_INK_FIELD_CONFIG.maxSimulationSteps;
  const maxUploadBytes =
    input.maxUploadBytes ?? DEFAULT_STUDIO_WET_INK_FIELD_CONFIG.maxUploadBytes;
  if (
    !safeInteger(tileSize, STUDIO_WET_INK_TILE_SIZE_RANGE.min, STUDIO_WET_INK_TILE_SIZE_RANGE.max)
    || !safeInteger(maxTiles, STUDIO_WET_INK_MAX_TILE_RANGE.min, STUDIO_WET_INK_MAX_TILE_RANGE.max)
    || !safeInteger(maxCells, STUDIO_WET_INK_MAX_CELL_RANGE.min, STUDIO_WET_INK_MAX_CELL_RANGE.max)
    || !safeInteger(maxSimulationSteps, 1, 1_000_000)
    || !safeInteger(maxUploadBytes, 1_024, 512 * 1024 * 1024)
    || !safeInteger(seed, 0, 0x7fffffff)
  ) {
    return failure("invalid-config", "Wet-ink tile, memory, step or seed budget is invalid.");
  }

  const coefficients = {
    waterDiffusion:
      input.waterDiffusion ?? DEFAULT_STUDIO_WET_INK_FIELD_CONFIG.waterDiffusion,
    pigmentDiffusion:
      input.pigmentDiffusion ?? DEFAULT_STUDIO_WET_INK_FIELD_CONFIG.pigmentDiffusion,
    chromatography:
      input.chromatography ?? DEFAULT_STUDIO_WET_INK_FIELD_CONFIG.chromatography,
    bleed: input.bleed ?? DEFAULT_STUDIO_WET_INK_FIELD_CONFIG.bleed,
    absorption: input.absorption ?? DEFAULT_STUDIO_WET_INK_FIELD_CONFIG.absorption,
    evaporation: input.evaporation ?? DEFAULT_STUDIO_WET_INK_FIELD_CONFIG.evaporation,
    dryingRate: input.dryingRate ?? DEFAULT_STUDIO_WET_INK_FIELD_CONFIG.dryingRate,
    fixationRate: input.fixationRate ?? DEFAULT_STUDIO_WET_INK_FIELD_CONFIG.fixationRate,
    edgeDarkening:
      input.edgeDarkening ?? DEFAULT_STUDIO_WET_INK_FIELD_CONFIG.edgeDarkening,
    granulation: input.granulation ?? DEFAULT_STUDIO_WET_INK_FIELD_CONFIG.granulation,
    paperRoughness:
      input.paperRoughness ?? DEFAULT_STUDIO_WET_INK_FIELD_CONFIG.paperRoughness,
  };
  if (
    !inRange(coefficients.waterDiffusion, 0, 0.24)
    || !inRange(coefficients.pigmentDiffusion, 0, 0.24)
    || !inRange(coefficients.chromatography, 0, 1)
    || !inRange(coefficients.bleed, 0, 1)
    || !inRange(coefficients.absorption, 0, 0.25)
    || !inRange(coefficients.evaporation, 0, 0.25)
    || !inRange(coefficients.dryingRate, 0, 0.5)
    || !inRange(coefficients.fixationRate, 0, 0.5)
    || !inRange(coefficients.edgeDarkening, 0, 1)
    || !inRange(coefficients.granulation, 0, 1)
    || !inRange(coefficients.paperRoughness, 0, 1)
  ) {
    return failure("invalid-config", "Wet-ink physical coefficients are non-finite or unstable.");
  }
  const inkColor = normalizeRgb(input.inkColor);
  if (!inkColor) return failure("invalid-config", "Wet-ink pigment color is invalid.");
  const spectralAbsorption = input.spectralAbsorption ?? DEFAULT_STUDIO_WET_INK_FIELD_CONFIG.spectralAbsorption;

  return {
    ok: true,
    value: {
      kind: FIELD_KIND,
      version: FIELD_VERSION,
      config: {
        width: input.width,
        height: input.height,
        tileSize,
        seed,
        maxTiles,
        maxCells,
        maxSimulationSteps,
        maxUploadBytes,
        ...coefficients,
        inkColor,
        spectralAbsorption,
      },
      tiles: new Map(),
      allocatedCells: 0,
      simulationStep: 0,
      revision: 0,
      activeBounds: null,
      dirtyBounds: null,
    },
  };
}

function tileKey(tileX: number, tileY: number): string {
  return `${tileX}:${tileY}`;
}

function compareTiles(
  left: Pick<StudioWetInkTile, "tileX" | "tileY">,
  right: Pick<StudioWetInkTile, "tileX" | "tileY">,
): number {
  return left.tileY - right.tileY || left.tileX - right.tileX;
}

function smoothNoiseWeight(value: number): number {
  // Cubic Hermite interpolation has zero slope at both lattice boundaries. Unlike a nearest-cell
  // hash, crossing an 8 px paper cell therefore cannot create a visible square seam after the
  // physical field is downsampled to the document surface.
  return value * value * (3 - 2 * value);
}

function smoothPaperNoise(
  x: number,
  y: number,
  cellWidth: number,
  cellHeight: number,
  seed: number,
): number {
  const latticeX = x / cellWidth;
  const latticeY = y / cellHeight;
  const x0 = Math.floor(latticeX);
  const y0 = Math.floor(latticeY);
  const tx = smoothNoiseWeight(latticeX - x0);
  const ty = smoothNoiseWeight(latticeY - y0);
  const top = hash2(x0, y0, seed)
    + (hash2(x0 + 1, y0, seed) - hash2(x0, y0, seed)) * tx;
  const bottom = hash2(x0, y0 + 1, seed)
    + (hash2(x0 + 1, y0 + 1, seed) - hash2(x0, y0 + 1, seed)) * tx;
  return top + (bottom - top) * ty;
}

function paperAt(field: StudioWetInkField, x: number, y: number): number {
  const { seed, paperRoughness } = field.config;
  // Three world-aligned bands model mould-made paper without exposing the square lattice:
  // - cloud: broad uneven sizing;
  // - tooth: the short-range granulating surface;
  // - fibre: a lightly anisotropic horizontal pulp direction.
  //
  // The field is normally 4× document resolution, so these wavelengths become approximately
  // 6 px, 2 px and 4.5×0.75 px in the final image. All bands are continuous at their boundaries.
  const cloud = smoothPaperNoise(x, y, 24, 24, seed + 17) - 0.5;
  const tooth = smoothPaperNoise(x, y, 7, 7, seed + 47) - 0.5;
  const fibre = smoothPaperNoise(x, y, 18, 3, seed + 71) - 0.5;
  return Math.fround(clamp01(
    0.5 + paperRoughness * (cloud * 0.48 + tooth * 0.34 + fibre * 0.18),
  ));
}

function tileDimensions(
  field: StudioWetInkField,
  tileX: number,
  tileY: number,
): { width: number; height: number; originX: number; originY: number } {
  const originX = tileX * field.config.tileSize;
  const originY = tileY * field.config.tileSize;
  return {
    originX,
    originY,
    width: Math.min(field.config.tileSize, field.config.width - originX),
    height: Math.min(field.config.tileSize, field.config.height - originY),
  };
}

function createTile(
  field: StudioWetInkField,
  tileX: number,
  tileY: number,
): StudioWetInkTile {
  const dimensions = tileDimensions(field, tileX, tileY);
  const count = dimensions.width * dimensions.height;
  const paper = new Float32Array(count);
  for (let localY = 0; localY < dimensions.height; localY += 1) {
    for (let localX = 0; localX < dimensions.width; localX += 1) {
      paper[localY * dimensions.width + localX] = paperAt(
        field,
        dimensions.originX + localX,
        dimensions.originY + localY,
      );
    }
  }
  return {
    tileX,
    tileY,
    ...dimensions,
    water: new Float32Array(count),
    pigment: new Float32Array(count),
    wetness: new Float32Array(count),
    stain: new Float32Array(count),
    paper,
    pigmentOpticalDensity: [
      new Float32Array(count),
      new Float32Array(count),
      new Float32Array(count),
    ],
    revision: 0,
  };
}

function spectralWeights(field: StudioWetInkField): StudioWetInkRgb {
  const spec = field.config.spectralAbsorption;
  if (!spec || spec.r < 0 || spec.g < 0 || spec.b < 0) {
    return { r: 1, g: 0.96, b: 0.88 };
  }
  return spec;
}

function ensurePigmentOpticalDensity(
  tile: StudioWetInkTile,
  spec: StudioWetInkRgb,
): [Float32Array, Float32Array, Float32Array] {
  const existing = tile.pigmentOpticalDensity;
  if (
    existing
    && existing.length === 3
    && existing[0]!.length === tile.pigment.length
  ) {
    return existing;
  }
  const count = tile.pigment.length;
  const reconstructed: [Float32Array, Float32Array, Float32Array] = [
    new Float32Array(count),
    new Float32Array(count),
    new Float32Array(count),
  ];
  const weights = [spec.r, spec.g, spec.b] as const;
  for (let index = 0; index < count; index += 1) {
    const mass = tile.pigment[index]!;
    reconstructed[0][index] = fieldValue(mass * weights[0]);
    reconstructed[1][index] = fieldValue(mass * weights[1]);
    reconstructed[2][index] = fieldValue(mass * weights[2]);
  }
  tile.pigmentOpticalDensity = reconstructed;
  return reconstructed;
}

function readOpticalDensity(
  field: StudioWetInkField,
  channel: 0 | 1 | 2,
  x: number,
  y: number,
): number {
  const target = tileAndIndexAt(field, x, y);
  if (!target) return 0;
  const density = ensurePigmentOpticalDensity(target.tile, spectralWeights(field));
  return density[channel][target.index] ?? 0;
}

function clipBounds(
  field: StudioWetInkField,
  bounds: StudioWetInkBounds,
): StudioWetInkBounds | null {
  const x = Math.max(0, Math.floor(bounds.x));
  const y = Math.max(0, Math.floor(bounds.y));
  const right = Math.min(field.config.width, Math.ceil(bounds.x + bounds.width));
  const bottom = Math.min(field.config.height, Math.ceil(bounds.y + bounds.height));
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

function unionBounds(
  left: StudioWetInkBounds | null,
  right: StudioWetInkBounds | null,
): StudioWetInkBounds | null {
  if (!left) return right;
  if (!right) return left;
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const endX = Math.max(left.x + left.width, right.x + right.width);
  const endY = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: endX - x, height: endY - y };
}

function expandBounds(
  field: StudioWetInkField,
  bounds: StudioWetInkBounds,
  amount: number,
): StudioWetInkBounds | null {
  return clipBounds(field, {
    x: bounds.x - amount,
    y: bounds.y - amount,
    width: bounds.width + amount * 2,
    height: bounds.height + amount * 2,
  });
}

function boundsFromExtents(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): StudioWetInkBounds | null {
  return maxX >= minX && maxY >= minY
    ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    : null;
}

interface TileCoordinate {
  readonly tileX: number;
  readonly tileY: number;
}

function tileCoordinatesForBounds(
  field: StudioWetInkField,
  bounds: StudioWetInkBounds,
): TileCoordinate[] {
  const firstX = Math.floor(bounds.x / field.config.tileSize);
  const firstY = Math.floor(bounds.y / field.config.tileSize);
  const lastX = Math.floor((bounds.x + bounds.width - 1) / field.config.tileSize);
  const lastY = Math.floor((bounds.y + bounds.height - 1) / field.config.tileSize);
  const coordinates: TileCoordinate[] = [];
  for (let tileY = firstY; tileY <= lastY; tileY += 1) {
    for (let tileX = firstX; tileX <= lastX; tileX += 1) {
      coordinates.push({ tileX, tileY });
    }
  }
  return coordinates;
}

function preflightTiles(
  field: StudioWetInkField,
  bounds: StudioWetInkBounds,
): StudioWetInkResult<readonly TileCoordinate[]> {
  const coordinates = tileCoordinatesForBounds(field, bounds);
  const missing = coordinates.filter(
    ({ tileX, tileY }) => !field.tiles.has(tileKey(tileX, tileY)),
  );
  if (field.tiles.size + missing.length > field.config.maxTiles) {
    return failure("tile-budget-exceeded", "Wet-ink tile budget would be exceeded.");
  }
  let nextCells = field.allocatedCells;
  for (const { tileX, tileY } of missing) {
    const dimensions = tileDimensions(field, tileX, tileY);
    nextCells += dimensions.width * dimensions.height;
    if (nextCells > field.config.maxCells) {
      return failure("cell-budget-exceeded", "Wet-ink cell memory budget would be exceeded.");
    }
  }
  return { ok: true, value: coordinates };
}

function ensureTiles(
  field: StudioWetInkField,
  coordinates: readonly TileCoordinate[],
): void {
  for (const { tileX, tileY } of coordinates) {
    const key = tileKey(tileX, tileY);
    if (field.tiles.has(key)) continue;
    const tile = createTile(field, tileX, tileY);
    field.tiles.set(key, tile);
    field.allocatedCells += tile.width * tile.height;
  }
}

function tileAndIndexAt(
  field: StudioWetInkField,
  x: number,
  y: number,
): { tile: StudioWetInkTile; index: number } | null {
  if (x < 0 || y < 0 || x >= field.config.width || y >= field.config.height) return null;
  const tileX = Math.floor(x / field.config.tileSize);
  const tileY = Math.floor(y / field.config.tileSize);
  const tile = field.tiles.get(tileKey(tileX, tileY));
  if (!tile) return null;
  const localX = x - tile.originX;
  const localY = y - tile.originY;
  return { tile, index: localY * tile.width + localX };
}

function readFieldValue(
  field: StudioWetInkField,
  name: "water" | "pigment" | "wetness" | "stain",
  x: number,
  y: number,
): number {
  const target = tileAndIndexAt(field, x, y);
  return target?.tile[name][target.index] ?? 0;
}

function quantize(value: number, quantum: number): number {
  return Math.round(value / quantum) * quantum;
}

/**
 * Reconstructs one authoritative 240 Hz sequence from coalesced 60/120/240 Hz pointer samples.
 * Piecewise-linear motion therefore produces byte-identical field deposition at all three rates.
 */
export function normalizeStudioWetInkStrokeInput(
  source: readonly StudioWetInkStrokeSample[],
  options: StudioWetInkInputNormalizationOptions = {},
): StudioWetInkResult<StudioNormalizedWetInkStroke> {
  if (!Array.isArray(source) || source.length === 0 || source.length > MAX_INPUT_SAMPLES) {
    return failure("invalid-input", "Wet-ink stroke sample count is invalid.");
  }
  const fixedRateHz = options.fixedRateHz ?? 240;
  const coordinateQuantum = options.coordinateQuantum ?? COORDINATE_QUANTUM;
  if (
    !inRange(fixedRateHz, 60, 1_000)
    || !inRange(coordinateQuantum, 1 / 65_536, 1)
  ) {
    return failure("invalid-input", "Wet-ink normalization clock or quantum is invalid.");
  }

  const sanitized: Required<StudioWetInkStrokeSample>[] = [];
  for (const sample of source) {
    if (
      !finite(sample.x)
      || !finite(sample.y)
      || Math.abs(sample.x) > MAX_COORDINATE_ABS
      || Math.abs(sample.y) > MAX_COORDINATE_ABS
      || !finite(sample.timeMs)
      || (sample.pressure !== undefined && !finite(sample.pressure))
    ) {
      return failure("invalid-input", "Wet-ink stroke contains a non-finite sample.");
    }
    const normalized = {
      x: sample.x,
      y: sample.y,
      timeMs: sample.timeMs,
      pressure: clamp01(sample.pressure ?? DEFAULT_PRESSURE),
    };
    const previous = sanitized.at(-1);
    if (previous && normalized.timeMs < previous.timeMs) {
      return failure("invalid-input", "Wet-ink sample timestamps must be monotonic.");
    }
    if (previous && normalized.timeMs === previous.timeMs) {
      sanitized[sanitized.length - 1] = normalized;
    } else {
      sanitized.push(normalized);
    }
  }
  const first = sanitized[0]!;
  const last = sanitized.at(-1)!;
  const duration = last.timeMs - first.timeMs;
  const interval = 1_000 / fixedRateHz;
  const estimatedCount = Math.floor(duration / interval) + 2;
  if (!finite(duration) || duration < 0 || estimatedCount > MAX_NORMALIZED_SAMPLES) {
    return failure("invalid-input", "Wet-ink stroke duration exceeds the replay budget.");
  }
  if (sanitized.length === 1 || duration === 0) {
    return {
      ok: true,
      value: {
        samples: [{
          x: quantize(last.x, coordinateQuantum),
          y: quantize(last.y, coordinateQuantum),
          timeMs: last.timeMs,
          pressure: quantize(last.pressure, 1 / 4_096),
        }],
        fixedRateHz,
        sourceSampleCount: source.length,
      },
    };
  }

  const samples: Required<StudioWetInkStrokeSample>[] = [];
  let segment = 0;
  const appendAt = (timeMs: number): void => {
    while (
      segment + 1 < sanitized.length - 1
      && sanitized[segment + 1]!.timeMs < timeMs
    ) {
      segment += 1;
    }
    const left = sanitized[segment]!;
    const right = sanitized[Math.min(sanitized.length - 1, segment + 1)]!;
    const span = right.timeMs - left.timeMs;
    const amount = span <= 0 ? 1 : clamp01((timeMs - left.timeMs) / span);
    samples.push({
      x: quantize(left.x + (right.x - left.x) * amount, coordinateQuantum),
      y: quantize(left.y + (right.y - left.y) * amount, coordinateQuantum),
      timeMs: quantize(timeMs, 1 / 65_536),
      pressure: quantize(
        left.pressure + (right.pressure - left.pressure) * amount,
        1 / 4_096,
      ),
    });
  };

  for (
    let timeMs = first.timeMs;
    timeMs < last.timeMs - 1e-7;
    timeMs += interval
  ) {
    appendAt(timeMs);
  }
  appendAt(last.timeMs);
  return {
    ok: true,
    value: { samples, fixedRateHz, sourceSampleCount: source.length },
  };
}

interface NormalizedBrushSettings {
  readonly radius: number;
  readonly hardness: number;
  readonly spacing: number;
  readonly waterLoad: number;
  readonly pigmentLoad: number;
  readonly wetnessLoad: number;
  readonly seed: number;
  readonly maxDabs: number;
}

function normalizeBrushSettings(
  input: StudioWetInkBrushInput,
): StudioWetInkResult<NormalizedBrushSettings> {
  const hardness = input.hardness ?? 0.35;
  const spacing = input.spacing ?? input.radius * 0.32;
  const waterLoad = input.waterLoad ?? 0.9;
  const pigmentLoad = input.pigmentLoad ?? 0.72;
  const wetnessLoad = input.wetnessLoad ?? 0.95;
  const seed = input.seed ?? 1;
  const maxDabs = input.maxDabs ?? 16_384;
  if (
    !inRange(input.radius, 0.25, 2_048)
    || !inRange(hardness, 0, 1)
    || !inRange(spacing, 0.25, 4_096)
    || !inRange(waterLoad, 0, FIELD_VALUE_MAX)
    || !inRange(pigmentLoad, 0, FIELD_VALUE_MAX)
    || !inRange(wetnessLoad, 0, 1)
    || !safeInteger(seed, 0, 0x7fffffff)
    || !safeInteger(maxDabs, 2, 16_384)
  ) {
    return failure("invalid-input", "Wet-ink brush settings are invalid.");
  }
  return {
    ok: true,
    value: {
      radius: input.radius,
      hardness,
      spacing,
      waterLoad,
      pigmentLoad,
      wetnessLoad,
      seed,
      maxDabs,
    },
  };
}

/**
 * Deposits one stroke after fixed-clock normalization. The existing causal watercolor planner
 * supplies prefix-stable, seeded stations; this field only owns material transport.
 */
export function depositStudioWetInkStroke(
  field: StudioWetInkField,
  input: StudioWetInkBrushInput,
): StudioWetInkResult<StudioWetInkDepositResult> {
  const normalized = normalizeStudioWetInkStrokeInput(input.samples, input.normalization);
  if (!normalized.ok) return normalized;
  const settings = normalizeBrushSettings(input);
  if (!settings.ok) return settings;
  const { samples } = normalized.value;
  const dabPlan = planCausalWatercolorBrush({
    points: samples.flatMap((sample) => [sample.x, sample.y]),
    pressures: samples.map((sample) => sample.pressure),
    baseWidth: settings.value.radius * 2,
    spacing: settings.value.spacing,
    seed: settings.value.seed,
    maxDabs: settings.value.maxDabs,
    diffuse: true,
  });
  if (dabPlan.capped) {
    return failure("dab-budget-exceeded", "Wet-ink brush dab budget would truncate the stroke.");
  }

  return depositStudioWetInkDabsWithSettings(
    field,
    dabPlan.dabs,
    settings.value,
    samples.length,
  );
}

function depositStudioWetInkDabsWithSettings(
  field: StudioWetInkField,
  dabs: readonly WatercolorBrushDab[],
  settings: Pick<
    NormalizedBrushSettings,
    "hardness" | "waterLoad" | "pigmentLoad" | "wetnessLoad"
  >,
  normalizedSampleCount: number,
): StudioWetInkResult<StudioWetInkDepositResult> {
  let rawBounds: StudioWetInkBounds | null = null;
  for (const dab of dabs) {
    rawBounds = unionBounds(rawBounds, {
      x: dab.x - dab.radius - 1,
      y: dab.y - dab.radius - 1,
      width: dab.radius * 2 + 2,
      height: dab.radius * 2 + 2,
    });
  }
  const bounds = rawBounds ? clipBounds(field, rawBounds) : null;
  if (!bounds || (settings.waterLoad === 0
    && settings.pigmentLoad === 0
    && settings.wetnessLoad === 0)) {
    return {
      ok: true,
      value: {
        normalizedSampleCount,
        dabCount: dabs.length,
        dirtyBounds: null,
      },
    };
  }
  const tilePlan = preflightTiles(field, bounds);
  if (!tilePlan.ok) return tilePlan;
  ensureTiles(field, tilePlan.value);

  let minX = field.config.width;
  let minY = field.config.height;
  let maxX = -1;
  let maxY = -1;
  const touchedTiles = new Set<StudioWetInkTile>();
  const sumiFamily = (field.config.chromatography ?? 0) >= 0.55;
  for (let dabIndex = 0; dabIndex < dabs.length; dabIndex += 1) {
    const dab = dabs[dabIndex]!;
    const previous = dabs[dabIndex - 1];
    const travel = previous
      ? Math.hypot(dab.x - previous.x, dab.y - previous.y)
      : 0;
    const feel = resolveStudioHandFeelMediaLoadV1({
      pressure: dab.opacity,
      speed: studioHandFeelTravelSpeedV1(travel, dab.radius),
      family: sumiFamily ? "sumi" : "wash",
    });
    const waterLoad = settings.waterLoad * feel.waterScale;
    const pigmentLoad = settings.pigmentLoad * feel.pigmentScale;
    const wetnessLoad = settings.wetnessLoad * feel.wetnessScale;
    const radius = Math.max(0.25, dab.radius);
    const startX = Math.max(0, Math.floor(dab.x - radius));
    const endX = Math.min(field.config.width - 1, Math.ceil(dab.x + radius));
    const startY = Math.max(0, Math.floor(dab.y - radius));
    const endY = Math.min(field.config.height - 1, Math.ceil(dab.y + radius));
    const coreRole = dab.role === "core";
    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        const dx = x + 0.5 - dab.x;
        const dy = y + 0.5 - dab.y;
        const normalizedDistance = Math.hypot(dx, dy) / radius;
        if (normalizedDistance >= 1) continue;
        const edgeAmount = settings.hardness >= 1
          ? 1
          : clamp01(
              (1 - normalizedDistance)
              / Math.max(1e-6, 1 - settings.hardness),
            );
        const falloff = normalizedDistance <= settings.hardness
          ? 1
          : edgeAmount * edgeAmount * (3 - 2 * edgeAmount);
        const target = tileAndIndexAt(field, x, y);
        if (!target) continue;
        const paperResistance = 0.82 + target.tile.paper[target.index]! * 0.28;
        const opacity = dab.opacity * falloff;
        const roleWater = coreRole ? 0.72 : 1;
        const rolePigment = coreRole ? 1 : 0.14;
        const nextWater = fieldValue(
          target.tile.water[target.index]!
          + waterLoad * roleWater * opacity,
        );
        const pigmentDelta = pigmentLoad * rolePigment * opacity * paperResistance;
        const nextPigment = fieldValue(
          target.tile.pigment[target.index]! + pigmentDelta,
        );
        const nextWetness = Math.fround(clamp01(Math.max(
          target.tile.wetness[target.index]!,
          wetnessLoad * falloff * (coreRole ? 0.9 : 1),
        )));
        const directFixation = Math.max(
          0,
          pigmentLoad * rolePigment * opacity
          * (1 - Math.min(1, waterLoad)) * 0.22,
        );
        const spec = spectralWeights(field);
        const density = ensurePigmentOpticalDensity(target.tile, spec);
        target.tile.water[target.index] = nextWater;
        target.tile.pigment[target.index] = nextPigment;
        target.tile.wetness[target.index] = nextWetness;
        target.tile.stain[target.index] = fieldValue(
          target.tile.stain[target.index]! + directFixation,
        );
        density[0][target.index] = fieldValue(
          density[0][target.index]! + pigmentDelta * spec.r,
        );
        density[1][target.index] = fieldValue(
          density[1][target.index]! + pigmentDelta * spec.g,
        );
        density[2][target.index] = fieldValue(
          density[2][target.index]! + pigmentDelta * spec.b,
        );
        touchedTiles.add(target.tile);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  const dirtyBounds = boundsFromExtents(minX, minY, maxX, maxY);
  if (dirtyBounds) {
    field.revision += 1;
    for (const tile of touchedTiles) tile.revision = field.revision;
    field.activeBounds = unionBounds(field.activeBounds, dirtyBounds);
    field.dirtyBounds = unionBounds(field.dirtyBounds, dirtyBounds);
  }
  return {
    ok: true,
    value: {
      normalizedSampleCount,
      dabCount: dabs.length,
      dirtyBounds,
    },
  };
}

/**
 * Deposits only newly emitted causal dabs. The operation preflights every touched tile before
 * allocating or mutating, so a malformed live suffix cannot partially paint the field.
 */
export function depositStudioWetInkDabs(
  field: StudioWetInkField,
  input: StudioWetInkDabDepositInput,
): StudioWetInkResult<StudioWetInkDepositResult> {
  const hardness = input.hardness ?? 0.35;
  const waterLoad = input.waterLoad ?? 0.9;
  const pigmentLoad = input.pigmentLoad ?? 0.72;
  const wetnessLoad = input.wetnessLoad ?? 0.95;
  const maxDabs = input.maxDabs ?? 16_384;
  if (
    !Array.isArray(input.dabs)
    || input.dabs.length > maxDabs
    || !safeInteger(maxDabs, 2, 16_384)
    || !inRange(hardness, 0, 1)
    || !inRange(waterLoad, 0, FIELD_VALUE_MAX)
    || !inRange(pigmentLoad, 0, FIELD_VALUE_MAX)
    || !inRange(wetnessLoad, 0, 1)
    || input.dabs.some((dab) => (
      !finite(dab.x)
      || !finite(dab.y)
      || Math.abs(dab.x) > MAX_COORDINATE_ABS
      || Math.abs(dab.y) > MAX_COORDINATE_ABS
      || !inRange(dab.radius, 0.25, 2_048)
      || !inRange(dab.opacity, 0, 1)
      || (dab.role !== "core" && dab.role !== "diffuse")
    ))
  ) {
    return failure("invalid-input", "Wet-ink causal dab input is invalid.");
  }
  return depositStudioWetInkDabsWithSettings(
    field,
    input.dabs,
    { hardness, waterLoad, pigmentLoad, wetnessLoad },
    0,
  );
}

interface ScratchTile {
  readonly tile: StudioWetInkTile;
  readonly water: Float32Array;
  readonly pigment: Float32Array;
  readonly wetness: Float32Array;
  readonly stain: Float32Array;
  readonly pigmentOpticalDensity: [Float32Array, Float32Array, Float32Array];
}

function createScratchTiles(
  field: StudioWetInkField,
  bounds: StudioWetInkBounds,
): Map<string, ScratchTile> {
  const scratch = new Map<string, ScratchTile>();
  const spec = spectralWeights(field);
  for (const coordinate of tileCoordinatesForBounds(field, bounds)) {
    const key = tileKey(coordinate.tileX, coordinate.tileY);
    const tile = field.tiles.get(key)!;
    const density = ensurePigmentOpticalDensity(tile, spec);
    scratch.set(key, {
      tile,
      water: tile.water.slice(),
      pigment: tile.pigment.slice(),
      wetness: tile.wetness.slice(),
      stain: tile.stain.slice(),
      pigmentOpticalDensity: [
        density[0].slice(),
        density[1].slice(),
        density[2].slice(),
      ],
    });
  }
  return scratch;
}

function scratchAt(
  field: StudioWetInkField,
  scratch: Map<string, ScratchTile>,
  x: number,
  y: number,
): { scratch: ScratchTile; index: number } {
  const tileX = Math.floor(x / field.config.tileSize);
  const tileY = Math.floor(y / field.config.tileSize);
  const target = scratch.get(tileKey(tileX, tileY))!;
  return {
    scratch: target,
    index: (y - target.tile.originY) * target.tile.width + (x - target.tile.originX),
  };
}

/**
 * Advances bounded explicit diffusion and drying. All required neighbour tiles are preflighted
 * before step one, so a budget failure leaves the field byte-for-byte unchanged.
 */
export function simulateStudioWetInkField(
  field: StudioWetInkField,
  requestedSteps: number,
): StudioWetInkResult<StudioWetInkSimulationResult> {
  if (!safeInteger(requestedSteps, 0, MAX_STEPS_PER_CALL)) {
    return failure("invalid-input", "Wet-ink simulation step count is invalid.");
  }
  if (field.simulationStep + requestedSteps > field.config.maxSimulationSteps) {
    return failure("step-budget-exceeded", "Wet-ink lifetime simulation budget would be exceeded.");
  }
  if (requestedSteps === 0 || !field.activeBounds) {
    return {
      ok: true,
      value: {
        requestedSteps,
        appliedSteps: 0,
        dirtyBounds: null,
        activeBounds: field.activeBounds,
      },
    };
  }

  const maximumBounds = expandBounds(field, field.activeBounds, requestedSteps);
  if (!maximumBounds) {
    return {
      ok: true,
      value: {
        requestedSteps,
        appliedSteps: 0,
        dirtyBounds: null,
        activeBounds: null,
      },
    };
  }
  const tilePlan = preflightTiles(field, maximumBounds);
  if (!tilePlan.ok) return tilePlan;
  ensureTiles(field, tilePlan.value);

  let mobileBounds: StudioWetInkBounds | null = field.activeBounds;
  let operationDirty: StudioWetInkBounds | null = null;
  let appliedSteps = 0;
  for (let step = 0; step < requestedSteps && mobileBounds; step += 1) {
    const region = expandBounds(field, mobileBounds, 1);
    if (!region) break;
    const scratch = createScratchTiles(field, region);
    let dirtyMinX = field.config.width;
    let dirtyMinY = field.config.height;
    let dirtyMaxX = -1;
    let dirtyMaxY = -1;
    let activeMinX = field.config.width;
    let activeMinY = field.config.height;
    let activeMaxX = -1;
    let activeMaxY = -1;
    const touched = new Set<StudioWetInkTile>();

    for (let y = region.y; y < region.y + region.height; y += 1) {
      for (let x = region.x; x < region.x + region.width; x += 1) {
        const water = readFieldValue(field, "water", x, y);
        const pigment = readFieldValue(field, "pigment", x, y);
        const wetness = readFieldValue(field, "wetness", x, y);
        const stain = readFieldValue(field, "stain", x, y);
        const waterLeft = readFieldValue(field, "water", x - 1, y);
        const waterRight = readFieldValue(field, "water", x + 1, y);
        const waterUp = readFieldValue(field, "water", x, y - 1);
        const waterDown = readFieldValue(field, "water", x, y + 1);
        const pigmentAverage = (
          readFieldValue(field, "pigment", x - 1, y)
          + readFieldValue(field, "pigment", x + 1, y)
          + readFieldValue(field, "pigment", x, y - 1)
          + readFieldValue(field, "pigment", x, y + 1)
        ) * 0.25;
        const wetnessAverage = (
          readFieldValue(field, "wetness", x - 1, y)
          + readFieldValue(field, "wetness", x + 1, y)
          + readFieldValue(field, "wetness", x, y - 1)
          + readFieldValue(field, "wetness", x, y + 1)
        ) * 0.25;
        const waterAverage = (waterLeft + waterRight + waterUp + waterDown) * 0.25;
        const paper = paperAt(field, x, y);
        const absorption = field.config.absorption * (0.65 + paper * 0.7);
        let nextWater = water
          + field.config.waterDiffusion * (waterAverage - water)
          - absorption * water
          - field.config.evaporation * Math.min(1, water) * 0.55;
        nextWater = nextWater <= FIELD_EPSILON ? 0 : fieldValue(nextWater);

        let nextWetness = wetness
          + field.config.waterDiffusion * 0.45 * (wetnessAverage - wetness)
          - field.config.dryingRate * (0.24 + 0.76 * (1 - Math.min(1, nextWater)));
        nextWetness = Math.max(nextWater * 0.72, nextWetness);
        nextWetness = nextWetness <= FIELD_EPSILON ? 0 : Math.fround(clamp01(nextWetness));

        const wetMobility = studioWetInkWetMobility(
          Math.max(nextWetness, Math.min(1, nextWater)),
        );
        const mobileFactor = wetMobility <= FIELD_EPSILON ? 0 : wetMobility;
        nextWater = nextWater
          + (waterAverage - nextWater)
            * STUDIO_WET_INK_INKWASH_DISPLAY.capillaryCreep
            * mobileFactor;
        nextWater = nextWater <= FIELD_EPSILON ? 0 : fieldValue(nextWater);
        const outwardWater = Math.max(0, waterAverage - water);
        const bleedTransport = mobileFactor <= 0
          ? 0
          : field.config.bleed * outwardWater * pigmentAverage * 0.18;
        let nextPigment = pigment
          + field.config.pigmentDiffusion * mobileFactor * (pigmentAverage - pigment)
          + bleedTransport;
        nextPigment = Math.max(0, nextPigment);
        const chroma = studioLivingInkChromaBleedMultipliers(field.config.chromatography);
        const nextOpticalDensity: [number, number, number] = [0, 0, 0];
        for (const channel of [0, 1, 2] as const) {
          const current = readOpticalDensity(field, channel, x, y);
          const average = (
            readOpticalDensity(field, channel, x - 1, y)
            + readOpticalDensity(field, channel, x + 1, y)
            + readOpticalDensity(field, channel, x, y - 1)
            + readOpticalDensity(field, channel, x, y + 1)
          ) * 0.25;
          const channelBleed = mobileFactor <= 0
            ? 0
            : field.config.bleed * outwardWater * average * 0.18 * chroma[channel]!;
          let next = current
            + field.config.pigmentDiffusion
              * mobileFactor
              * chroma[channel]!
              * (average - current)
            + channelBleed;
          next = Math.max(0, next);
          nextOpticalDensity[channel] = next;
        }
        const waterGradient = (
          Math.abs(waterLeft - waterRight)
          + Math.abs(waterUp - waterDown)
        ) * 0.25;
        const baseFixation = field.config.fixationRate
          * (0.18 + 0.82 * (1 - nextWetness))
          * (0.72 + paper * 0.56);
        const edgeFixation = field.config.edgeDarkening
          * waterGradient
          * (0.12 + 0.22 * Math.min(1, pigment));
        const fixed = Math.min(
          nextPigment,
          nextPigment * clamp(baseFixation + edgeFixation, 0, 0.92),
        );
        const pigmentBeforeFix = nextPigment;
        nextPigment -= fixed;
        nextPigment = nextPigment <= FIELD_EPSILON ? 0 : fieldValue(nextPigment);
        const remain = pigmentBeforeFix <= FIELD_EPSILON
          ? 0
          : nextPigment / pigmentBeforeFix;
        const granuleMultiplier = 1
          + (paper - 0.5) * field.config.granulation * 0.9;
        const nextStain = fieldValue(stain + fixed * granuleMultiplier);

        const target = scratchAt(field, scratch, x, y);
        target.scratch.water[target.index] = nextWater;
        target.scratch.pigment[target.index] = nextPigment;
        target.scratch.wetness[target.index] = nextWetness;
        target.scratch.stain[target.index] = nextStain;
        for (const channel of [0, 1, 2] as const) {
          const next = nextOpticalDensity[channel]! * remain;
          target.scratch.pigmentOpticalDensity[channel][target.index] =
            next <= FIELD_EPSILON ? 0 : fieldValue(next);
        }
        if (
          Math.abs(nextWater - water) > FIELD_EPSILON
          || Math.abs(nextPigment - pigment) > FIELD_EPSILON
          || Math.abs(nextWetness - wetness) > FIELD_EPSILON
          || Math.abs(nextStain - stain) > FIELD_EPSILON
        ) {
          dirtyMinX = Math.min(dirtyMinX, x);
          dirtyMinY = Math.min(dirtyMinY, y);
          dirtyMaxX = Math.max(dirtyMaxX, x);
          dirtyMaxY = Math.max(dirtyMaxY, y);
          touched.add(target.scratch.tile);
        }
        if (
          nextWater > FIELD_EPSILON
          || nextPigment > FIELD_EPSILON
          || nextWetness > FIELD_EPSILON
        ) {
          activeMinX = Math.min(activeMinX, x);
          activeMinY = Math.min(activeMinY, y);
          activeMaxX = Math.max(activeMaxX, x);
          activeMaxY = Math.max(activeMaxY, y);
        }
      }
    }

    for (const target of scratch.values()) {
      target.tile.water = target.water;
      target.tile.pigment = target.pigment;
      target.tile.wetness = target.wetness;
      target.tile.stain = target.stain;
      target.tile.pigmentOpticalDensity = target.pigmentOpticalDensity;
    }
    const stepDirty = boundsFromExtents(dirtyMinX, dirtyMinY, dirtyMaxX, dirtyMaxY);
    operationDirty = unionBounds(operationDirty, stepDirty);
    mobileBounds = boundsFromExtents(activeMinX, activeMinY, activeMaxX, activeMaxY);
    appliedSteps += 1;
    field.simulationStep += 1;
    if (stepDirty) {
      field.revision += 1;
      for (const tile of touched) tile.revision = field.revision;
    }
  }
  field.activeBounds = mobileBounds;
  field.dirtyBounds = unionBounds(field.dirtyBounds, operationDirty);
  return {
    ok: true,
    value: {
      requestedSteps,
      appliedSteps,
      dirtyBounds: operationDirty,
      activeBounds: mobileBounds,
    },
  };
}

export function readStudioWetInkCell(
  field: StudioWetInkField,
  x: number,
  y: number,
): StudioWetInkCell | null {
  if (!safeInteger(x, 0, field.config.width - 1) || !safeInteger(y, 0, field.config.height - 1)) {
    return null;
  }
  const target = tileAndIndexAt(field, x, y);
  if (!target) {
    return {
      water: 0,
      pigment: 0,
      wetness: 0,
      stain: 0,
      paper: paperAt(field, x, y),
      pigmentOpticalDensity: [0, 0, 0],
    };
  }
  const density = ensurePigmentOpticalDensity(target.tile, spectralWeights(field));
  return {
    water: target.tile.water[target.index] ?? 0,
    pigment: target.tile.pigment[target.index] ?? 0,
    wetness: target.tile.wetness[target.index] ?? 0,
    stain: target.tile.stain[target.index] ?? 0,
    paper: target.tile.paper[target.index] ?? paperAt(field, x, y),
    pigmentOpticalDensity: [
      density[0][target.index] ?? 0,
      density[1][target.index] ?? 0,
      density[2][target.index] ?? 0,
    ],
  };
}

export function consumeStudioWetInkDirtyBounds(
  field: StudioWetInkField,
): StudioWetInkBounds | null {
  const dirty = field.dirtyBounds;
  field.dirtyBounds = null;
  return dirty;
}

function tileOverlapsBounds(
  tile: StudioWetInkTile,
  bounds: StudioWetInkBounds,
): boolean {
  return tile.originX < bounds.x + bounds.width
    && tile.originX + tile.width > bounds.x
    && tile.originY < bounds.y + bounds.height
    && tile.originY + tile.height > bounds.y;
}

function clampByte(value: number): number {
  return value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value);
}

function tileScalarAt(
  values: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const cx = x <= 0 ? 0 : x >= width - 1 ? width - 1 : x;
  const cy = y <= 0 ? 0 : y >= height - 1 ? height - 1 : y;
  return values[cy * width + cx] ?? 0;
}

function renderTileRgba(
  field: StudioWetInkField,
  tile: StudioWetInkTile,
): Uint8ClampedArray {
  const bytes = new Uint8Array(tile.width * tile.height * 4);
  const color = field.config.inkColor;
  const spec = field.config.spectralAbsorption ?? { r: 1.0, g: 0.96, b: 0.88 };
  const paperRoughness = field.config.paperRoughness ?? 0.72;
  const edgeDarkening = field.config.edgeDarkening ?? 0.68;
  const chromatography = field.config.chromatography ?? 0.5;
  const granulation = field.config.granulation ?? 0.36;
  const display = STUDIO_WET_INK_INKWASH_DISPLAY;
  const channelDensity = ensurePigmentOpticalDensity(tile, spec);
  const isWhiteHighlight = spec.r < 0 || spec.g < 0 || spec.b < 0;
  const { width, height } = tile;

  const luminanceAt = (x: number, y: number): number => {
    const index = (
      (y <= 0 ? 0 : y >= height - 1 ? height - 1 : y) * width
      + (x <= 0 ? 0 : x >= width - 1 ? width - 1 : x)
    );
    return (
      (channelDensity[0][index] ?? 0)
      + (channelDensity[1][index] ?? 0)
      + (channelDensity[2][index] ?? 0)
      + (tile.stain[index] ?? 0)
    );
  };

  for (let index = 0; index < width * height; index += 1) {
    const lx = index % width;
    const ly = Math.floor(index / width);
    const paper = tile.paper[index]!;
    const wetness = tile.wetness[index]!;
    const mobile = tile.pigment[index]! * (0.62 + wetness * 0.2);
    const fixed = tile.stain[index]!;
    const grainBump = (paper - 0.5) * paperRoughness * 0.55;
    const wetEdgeContrast = Math.pow(Math.max(0, wetness), 1.35) * edgeDarkening * 0.35;
    const density = Math.max(0, mobile + fixed + wetEdgeContrast) * (0.92 + grainBump);
    const mobileGain = 0.62 + wetness * 0.2;
    const odScale = 0.92 + grainBump;
    const pigmentAmount = clamp01(density * 2);
    const fiber = paper;
    const tooth = tileScalarAt(tile.paper, width, height, lx + 1, ly);
    const grain = 0.5 + (paper - 0.5) * 0.7 + (tooth - 0.5) * 0.3;
    const edge = Math.hypot(
      luminanceAt(lx + 1, ly) - luminanceAt(lx - 1, ly),
      luminanceAt(lx, ly + 1) - luminanceAt(lx, ly - 1),
    );
    const granulationMod = 1
      + (grain - 0.5) * display.granulationGain * granulation * pigmentAmount;
    const fiberMod = 1 + (fiber - 0.5) * display.fiberAmplitude * paperRoughness;
    const toothMod = 1 + (tooth - 0.5) * display.toothAmplitude * paperRoughness;
    const edgeMod = 1 + edge * display.edgeDarkeningGain * edgeDarkening;
    const extinction = display.beerLambertStrength * granulationMod * fiberMod * toothMod * edgeMod;
    const wetGate = studioWetInkWetMobility(wetness);
    const sheenR = 1 - wetGate * display.wetSheen.r;
    const sheenG = 1 - wetGate * display.wetSheen.g;
    const sheenB = 1 - wetGate * display.wetSheen.b;

    let r: number;
    let g: number;
    let b: number;
    let a: number;

    if (isWhiteHighlight) {
      const scattering = clamp01(1 - Math.exp(-density * extinction * (2.2 / 1.9)));
      r = 255;
      g = 255;
      b = 255;
      a = Math.round(scattering * 255);
    } else {
      const chromFringe = chromatography * (paper - 0.5) * 0.3;
      const densityR = Math.max(
        0,
        channelDensity[0][index]! * mobileGain + fixed * spec.r + wetEdgeContrast * spec.r,
      ) * odScale;
      const densityG = Math.max(
        0,
        channelDensity[1][index]! * mobileGain + fixed * spec.g + wetEdgeContrast * spec.g,
      ) * odScale;
      const densityB = Math.max(
        0,
        channelDensity[2][index]! * mobileGain + fixed * spec.b + wetEdgeContrast * spec.b,
      ) * odScale;
      const transR = Math.exp(-densityR * extinction * (1.0 + chromFringe)) * sheenR;
      const transG = Math.exp(-densityG * extinction) * sheenG;
      const transB = Math.exp(-densityB * extinction * (1.0 - chromFringe)) * sheenB;

      r = clampByte(color.r * transR);
      g = clampByte(color.g * transG);
      b = clampByte(color.b * transB);

      const alphaExtinction = clamp01(1 - Math.min(transR, Math.min(transG, transB)));
      a = Math.round(alphaExtinction * 255);
    }

    const offset = index * 4;
    bytes[offset] = r;
    bytes[offset + 1] = g;
    bytes[offset + 2] = b;
    bytes[offset + 3] = a;
  }

  return new Uint8ClampedArray(bytes.buffer);
}

/**
 * Renderer-neutral adapter. Uploads are world-aligned, cropped to real edge-tile dimensions and
 * never include neighbouring tile pixels, so Canvas/WebGL/WebGPU can composite them without seams.
 */
export function planStudioWetInkTileUploads(
  field: StudioWetInkField,
  bounds: StudioWetInkBounds | null = field.dirtyBounds,
): StudioWetInkResult<readonly StudioWetInkTileUpload[]> {
  if (!bounds) return { ok: true, value: [] };
  const clipped = clipBounds(field, bounds);
  if (!clipped) return { ok: true, value: [] };
  const tiles = [...field.tiles.values()]
    .filter((tile) => tileOverlapsBounds(tile, clipped))
    .sort(compareTiles);
  const byteLength = tiles.reduce((sum, tile) => sum + tile.width * tile.height * 4, 0);
  if (byteLength > field.config.maxUploadBytes) {
    return failure("upload-budget-exceeded", "Wet-ink tile upload budget would be exceeded.");
  }
  return {
    ok: true,
    value: tiles.map((tile) => ({
      tileX: tile.tileX,
      tileY: tile.tileY,
      x: tile.originX,
      y: tile.originY,
      width: tile.width,
      height: tile.height,
      revision: tile.revision,
      rgba: renderTileRgba(field, tile),
    })),
  };
}

function hashByte(hash: number, value: number): number {
  return Math.imul(hash ^ value, 0x01000193) >>> 0;
}

/** Stable replay/debug digest over every allocated physical field in deterministic tile order. */
export function studioWetInkFieldDigest(field: StudioWetInkField): string {
  let hash = 0x811c9dc5;
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  const feedNumber = (value: number): void => {
    view.setFloat32(0, Math.fround(value), false);
    for (const byte of bytes) hash = hashByte(hash, byte);
  };
  feedNumber(field.simulationStep);
  feedNumber(field.revision);
  for (const tile of [...field.tiles.values()].sort(compareTiles)) {
    feedNumber(tile.tileX);
    feedNumber(tile.tileY);
    for (const source of [
      tile.water,
      tile.pigment,
      tile.wetness,
      tile.stain,
      tile.paper,
    ]) {
      for (const value of source) feedNumber(value);
    }
  }
  return `wet-ink-v${FIELD_VERSION}:${hash.toString(16).padStart(8, "0")}`;
}
