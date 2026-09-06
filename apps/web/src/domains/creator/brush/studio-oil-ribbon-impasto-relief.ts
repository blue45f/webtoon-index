import { computeStudioImpastoReliefShading } from "../studio-impasto-relief-shading-v1";

import type { FxOilBristle } from "../studio-fx-brush";
import type {
  OilCarrierStation,
  StudioOilRibbonImpastoReliefKind,
  StudioOilRibbonImpastoReliefLane,
} from "./studio-oil-ribbon-carrier-types";

export const STUDIO_OIL_IMPASTO_RELIEF_OVERLAY_VERSION =
  "oil-impasto-relief-overlay-v1" as const;

/**
 * Exact glint color both durable surfaces stroke under `screen`. dli adds the GGX specular as an
 * achromatic term on top of the pigment (`color·diffuse + specular`), so the vector expression of
 * "specular" is white-toward light, never a hue shift.
 */
export const STUDIO_OIL_IMPASTO_RELIEF_HIGHLIGHT_COLOR = "#ffffff" as const;

const COORDINATE_LIMIT = 1_000_000;
const GEOMETRY_QUANTIZATION = 10_000;
const POINT_EPSILON = 1e-6;
const BRISTLE_RUN_STATIONS = 3;

const IMPASTO_RELIEF_GRID_LONG_SIDE = 256;
const IMPASTO_RELIEF_GRID_MAX_CELLS = 40_000;
const IMPASTO_RELIEF_MIN_CELL_PX = 0.75;
const IMPASTO_RELIEF_FILM_HEIGHT = 0.5;
const IMPASTO_RELIEF_RIDGE_HEIGHT = 0.55;
const IMPASTO_RELIEF_RIDGE_REACH_MIN_CELLS = 0.8;
const IMPASTO_RELIEF_EDGE_FEATHER_CELLS = 1.5;
const IMPASTO_RELIEF_CELL_STEP_RATIO = 2 ** (1 / 16);
const IMPASTO_RELIEF_STAMP_REACH_RADIUS_RATIO = 1.2;
const IMPASTO_RELIEF_STAMP_REACH_CELLS = 2;
const IMPASTO_RELIEF_CELL_MAX_RUNGS = 512;
const IMPASTO_RELIEF_HEIGHT_SCALE = 3;
const IMPASTO_RELIEF_MIN_STRENGTH = 0.01;
const IMPASTO_RELIEF_HIGHLIGHT_GAIN = 2.6;
const IMPASTO_RELIEF_SHADOW_GAIN = 3.6;
const IMPASTO_RELIEF_MAX_HIGHLIGHT_OPACITY = 0.44;
const IMPASTO_RELIEF_MAX_SHADOW_OPACITY = 0.34;
const IMPASTO_RELIEF_OPACITY_BUCKETS = 3;
const IMPASTO_RELIEF_BUCKET_EDGE_LOW = 0.18;
const IMPASTO_RELIEF_BUCKET_EDGE_HIGH = 0.45;
const IMPASTO_RELIEF_MAX_OFFSET_RATIO = 0.94;
const IMPASTO_RELIEF_DIRTY_CHUNK_STATIONS = 16;
const IMPASTO_RELIEF_DIRTY_MAX_RECTS = 12;
const IMPASTO_RELIEF_BUCKET_HYSTERESIS = 0.06;

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function quantize(value: number): number {
  return (
    Math.round(
      clamp(finite(value, 0), -COORDINATE_LIMIT, COORDINATE_LIMIT) *
        GEOMETRY_QUANTIZATION
    ) / GEOMETRY_QUANTIZATION
  );
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function meanBy<T>(values: readonly T[], select: (value: T) => number): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += select(value);
  return sum / values.length;
}

function weldByTrack<TRun extends { readonly points: readonly number[] }>(
  runs: readonly TRun[],
  trackOf: (run: TRun) => number,
  orderOf: (run: TRun) => number,
  build: (points: readonly number[], first: TRun, last: TRun, members: number) => TRun
): readonly TRun[] {
  const ordered = [...runs].sort(
    (left, right) =>
      trackOf(left) - trackOf(right) || orderOf(left) - orderOf(right)
  );
  const welded: TRun[] = [];
  let buffer: number[] | null = null;
  let first: TRun | null = null;
  let previous: TRun | null = null;
  let members = 0;
  const flush = (): void => {
    if (!buffer || !first || !previous) return;
    welded.push(
      members === 1 ? previous : build(buffer, first, previous, members)
    );
    buffer = null;
    first = null;
    previous = null;
    members = 0;
  };
  for (const run of ordered) {
    if (
      previous &&
      trackOf(previous) === trackOf(run) &&
      orderOf(previous) === orderOf(run) - 1
    ) {
      for (let index = 2; index < run.points.length; index += 1)
        buffer!.push(run.points[index]!);
      previous = run;
      members += 1;
      continue;
    }
    flush();
    buffer = [...run.points];
    first = run;
    previous = run;
    members = 1;
  }
  flush();
  return welded;
}

function impastoReliefCell(natural: number): number {
  let cell = IMPASTO_RELIEF_MIN_CELL_PX;
  for (let rung = 0; rung < IMPASTO_RELIEF_CELL_MAX_RUNGS; rung += 1) {
    const next = cell * IMPASTO_RELIEF_CELL_STEP_RATIO;
    if (next > natural) return cell;
    cell = next;
  }
  return cell;
}

export interface ImpastoReliefField {
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly cell: number;
  readonly originX: number;
  readonly originY: number;
  readonly hairStride: number;
  readonly hairOffset: number;
  readonly shading: Float32Array;
  readonly writtenShading: readonly ImpastoDirtyRect[] | null;
}

function impastoHairStride(
  stations: readonly OilCarrierStation[],
  cell: number,
  bristleCount: number
): number {
  if (bristleCount <= 1 || cell <= POINT_EPSILON) return 1;
  const ribbonWidth = 2 * mean(stations.map((station) => station.radiusY));
  const resolvable = Math.max(1, Math.floor(ribbonWidth / cell));
  return Math.max(
    1,
    Math.round(bristleCount / Math.min(bristleCount, resolvable))
  );
}

function impastoRidgeWidth(
  station: OilCarrierStation,
  hair: FxOilBristle
): number {
  return Math.max(0.38, station.radiusY * (0.15 + hair.radiusYRatio * 1.18));
}

function impastoBristleCount(stations: readonly OilCarrierStation[]): number {
  let count = Number.POSITIVE_INFINITY;
  for (const station of stations) {
    count = Math.min(count, station.source.bristles.length);
  }
  return Number.isFinite(count) ? count : 0;
}

export interface ImpastoReliefGrid {
  readonly cell: number;
  readonly originX: number;
  readonly originY: number;
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly bristleCount: number;
  readonly hairStride: number;
  readonly hairOffset: number;
}

function impastoReliefGrid(
  stations: readonly OilCarrierStation[]
): ImpastoReliefGrid | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let centreMinX = Number.POSITIVE_INFINITY;
  let centreMinY = Number.POSITIVE_INFINITY;
  let centreMaxX = Number.NEGATIVE_INFINITY;
  let centreMaxY = Number.NEGATIVE_INFINITY;
  let maxRadiusY = 0;
  for (const station of stations) {
    const pad = Math.max(station.radiusY, station.radiusX * 0.62) + 2;
    minX = Math.min(minX, station.x - pad);
    minY = Math.min(minY, station.y - pad);
    maxX = Math.max(maxX, station.x + pad);
    maxY = Math.max(maxY, station.y + pad);
    centreMinX = Math.min(centreMinX, station.x);
    centreMinY = Math.min(centreMinY, station.y);
    centreMaxX = Math.max(centreMaxX, station.x);
    centreMaxY = Math.max(centreMaxY, station.y);
    maxRadiusY = Math.max(maxRadiusY, station.radiusY);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const spanX = Math.max(1e-3, maxX - minX);
  const spanY = Math.max(1e-3, maxY - minY);
  let natural = Math.max(
    IMPASTO_RELIEF_MIN_CELL_PX,
    Math.max(spanX, spanY) / IMPASTO_RELIEF_GRID_LONG_SIDE
  );
  const cellsAtLongSide = (spanX / natural) * (spanY / natural);
  if (cellsAtLongSide > IMPASTO_RELIEF_GRID_MAX_CELLS) {
    natural *= Math.sqrt(cellsAtLongSide / IMPASTO_RELIEF_GRID_MAX_CELLS);
  }
  const cell = impastoReliefCell(natural);
  const reach =
    maxRadiusY * IMPASTO_RELIEF_STAMP_REACH_RADIUS_RATIO +
    IMPASTO_RELIEF_STAMP_REACH_CELLS * cell;
  minX = Math.min(minX, centreMinX - reach);
  minY = Math.min(minY, centreMinY - reach);
  maxX = Math.max(maxX, centreMaxX + reach);
  maxY = Math.max(maxY, centreMaxY + reach);
  const originX = Math.floor(minX / cell) * cell;
  const originY = Math.floor(minY / cell) * cell;
  const bristleCount = impastoBristleCount(stations);
  const hairStride = impastoHairStride(stations, cell, bristleCount);
  return {
    cell,
    originX,
    originY,
    gridWidth: Math.max(4, Math.ceil((maxX - originX) / cell) + 1),
    gridHeight: Math.max(4, Math.ceil((maxY - originY) / cell) + 1),
    bristleCount,
    hairStride,
    hairOffset: Math.floor((((bristleCount - 1) % hairStride) + 1) / 2),
  };
}

export interface ImpastoReliefFieldSnapshot {
  readonly shading: Float32Array;
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly cell: number;
  readonly originX: number;
  readonly originY: number;
}

export interface ImpastoDirtyRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ImpastoFilmCursor {
  travelled: number;
  lastX: number;
  lastY: number;
}

function impastoFilmCursor(): ImpastoFilmCursor {
  return { travelled: Number.POSITIVE_INFINITY, lastX: 0, lastY: 0 };
}

function stampImpastoFilm(
  film: Float32Array,
  grid: ImpastoReliefGrid,
  stations: readonly OilCarrierStation[],
  from: number,
  to: number,
  cursor: ImpastoFilmCursor,
  finalIndex: number
): void {
  const { cell, originX, originY, gridWidth, gridHeight } = grid;
  const feather = IMPASTO_RELIEF_EDGE_FEATHER_CELLS * cell;
  for (let index = from; index < to; index += 1) {
    const station = stations[index]!;
    if (index > 0) {
      cursor.travelled += Math.hypot(
        station.x - cursor.lastX,
        station.y - cursor.lastY
      );
    }
    cursor.lastX = station.x;
    cursor.lastY = station.y;
    const stampGap = Math.max(cell, station.radiusY * 0.35);
    if (index !== 0 && index !== finalIndex && cursor.travelled < stampGap)
      continue;
    cursor.travelled = 0;
    const level = IMPASTO_RELIEF_FILM_HEIGHT * (0.72 + 0.28 * station.opacity);
    const radius = station.radiusY;
    const reach = radius + feather;
    const reachSquared = reach * reach;
    const minCellX = Math.max(
      0,
      Math.floor((station.x - reach - originX) / cell)
    );
    const maxCellX = Math.min(
      gridWidth - 1,
      Math.ceil((station.x + reach - originX) / cell)
    );
    const minCellY = Math.max(
      0,
      Math.floor((station.y - reach - originY) / cell)
    );
    const maxCellY = Math.min(
      gridHeight - 1,
      Math.ceil((station.y + reach - originY) / cell)
    );
    const innerSquared = radius * radius;
    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      const deltaY = originY + (cellY + 0.5) * cell - station.y;
      const deltaYSquared = deltaY * deltaY;
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        const deltaX = originX + (cellX + 0.5) * cell - station.x;
        const distanceSquared = deltaX * deltaX + deltaYSquared;
        if (distanceSquared > reachSquared) continue;
        const at = cellY * gridWidth + cellX;
        if (distanceSquared <= innerSquared) {
          if (level > film[at]!) film[at] = level;
          continue;
        }
        const coverage = clamp(
          (radius - Math.sqrt(distanceSquared)) / feather + 1,
          0,
          1
        );
        if (coverage <= 0) continue;
        const value = level * coverage;
        if (value > film[at]!) film[at] = value;
      }
    }
  }
}

function stampImpastoRidge(
  ridge: Float32Array,
  grid: ImpastoReliefGrid,
  stations: readonly OilCarrierStation[],
  from: number,
  to: number
): void {
  const {
    cell,
    originX,
    originY,
    gridWidth,
    gridHeight,
    bristleCount,
    hairStride,
    hairOffset,
  } = grid;
  if (to <= from) return;
  const minRidgeReach = cell * IMPASTO_RELIEF_RIDGE_REACH_MIN_CELLS;
  const span = to - from + 1;
  const hairX = new Float64Array(span);
  const hairY = new Float64Array(span);
  const hairLoad = new Float64Array(span);
  const hairReach = new Float64Array(span);
  for (
    let bristleIndex = hairOffset;
    bristleIndex < bristleCount;
    bristleIndex += hairStride
  ) {
    for (let slot = 0; slot < span; slot += 1) {
      const station = stations[from + slot]!;
      const hair = station.source.bristles[bristleIndex]!;
      const offset = station.radiusY * hair.offsetRatio;
      hairX[slot] = station.x + station.normalX * offset;
      hairY[slot] = station.y + station.normalY * offset;
      hairLoad[slot] = clamp(station.opacity * hair.opacity, 0, 1);
      hairReach[slot] = Math.max(
        minRidgeReach,
        impastoRidgeWidth(station, hair) * 0.5
      );
    }
    for (let slot = 0; slot + 1 < span; slot += 1) {
      const fromX = hairX[slot]!;
      const fromY = hairY[slot]!;
      const toX = hairX[slot + 1]!;
      const toY = hairY[slot + 1]!;
      const fromLoad = hairLoad[slot]!;
      const toLoad = hairLoad[slot + 1]!;
      const segmentX = toX - fromX;
      const segmentY = toY - fromY;
      const ridgeReach = Math.max(hairReach[slot]!, hairReach[slot + 1]!);
      const ridgeReachSquared = ridgeReach * ridgeReach;
      const lengthSquared = segmentX * segmentX + segmentY * segmentY;
      const inverseLengthSquared =
        lengthSquared > POINT_EPSILON ? 1 / lengthSquared : 0;
      const loadSpan = toLoad - fromLoad;
      const minCellX = Math.max(
        0,
        Math.floor((Math.min(fromX, toX) - ridgeReach - originX) / cell)
      );
      const maxCellX = Math.min(
        gridWidth - 1,
        Math.ceil((Math.max(fromX, toX) + ridgeReach - originX) / cell)
      );
      const minCellY = Math.max(
        0,
        Math.floor((Math.min(fromY, toY) - ridgeReach - originY) / cell)
      );
      const maxCellY = Math.min(
        gridHeight - 1,
        Math.ceil((Math.max(fromY, toY) + ridgeReach - originY) / cell)
      );
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const pointY = originY + (cellY + 0.5) * cell - fromY;
        for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
          const pointX = originX + (cellX + 0.5) * cell - fromX;
          const t = clamp(
            (pointX * segmentX + pointY * segmentY) * inverseLengthSquared,
            0,
            1
          );
          const deltaX = pointX - segmentX * t;
          const deltaY = pointY - segmentY * t;
          const distanceSquared = deltaX * deltaX + deltaY * deltaY;
          if (distanceSquared >= ridgeReachSquared) continue;
          const level =
            IMPASTO_RELIEF_RIDGE_HEIGHT *
            (0.25 + 0.75 * (fromLoad + loadSpan * t));
          const value = level * (1 - Math.sqrt(distanceSquared) / ridgeReach);
          const at = cellY * gridWidth + cellX;
          if (value > ridge[at]!) ridge[at] = value;
        }
      }
    }
  }
}

function shadeImpastoRelief(
  film: Float32Array,
  ridge: Float32Array,
  grid: ImpastoReliefGrid,
  retained?: {
    readonly height: Float32Array;
    readonly shading: Float32Array;
    readonly dirty: readonly ImpastoDirtyRect[];
  }
): ImpastoReliefField {
  if (retained) {
    const { height, shading, dirty } = retained;
    for (const rect of dirty) {
      const x0 = Math.max(0, rect.x);
      const y0 = Math.max(0, rect.y);
      const x1 = Math.min(grid.gridWidth, rect.x + rect.width);
      const y1 = Math.min(grid.gridHeight, rect.y + rect.height);
      for (let y = y0; y < y1; y += 1) {
        const row = y * grid.gridWidth;
        for (let x = x0; x < x1; x += 1) {
          const at = row + x;
          height[at] = film[at]! + ridge[at]!;
        }
      }
    }
    const written = dirty.map((rect) => ({
      x: rect.x - 1,
      y: rect.y - 1,
      width: rect.width + 2,
      height: rect.height + 2,
    }));
    for (const region of written) {
      computeStudioImpastoReliefShading(height, {
        width: grid.gridWidth,
        height: grid.gridHeight,
        heightScale: IMPASTO_RELIEF_HEIGHT_SCALE,
        into: shading,
        region,
      });
    }
    return {
      writtenShading: written,
      gridWidth: grid.gridWidth,
      gridHeight: grid.gridHeight,
      cell: grid.cell,
      originX: grid.originX,
      originY: grid.originY,
      hairStride: grid.hairStride,
      hairOffset: grid.hairOffset,
      shading,
    };
  }
  const height = new Float32Array(film.length);
  for (let at = 0; at < film.length; at += 1)
    height[at] = film[at]! + ridge[at]!;
  return {
    writtenShading: null,
    gridWidth: grid.gridWidth,
    gridHeight: grid.gridHeight,
    cell: grid.cell,
    originX: grid.originX,
    originY: grid.originY,
    hairStride: grid.hairStride,
    hairOffset: grid.hairOffset,
    shading: computeStudioImpastoReliefShading(height, {
      width: grid.gridWidth,
      height: grid.gridHeight,
      heightScale: IMPASTO_RELIEF_HEIGHT_SCALE,
    }),
  };
}

export function buildImpastoReliefField(
  stations: readonly OilCarrierStation[]
): ImpastoReliefField | null {
  const grid = impastoReliefGrid(stations);
  if (!grid) return null;
  const cellCount = grid.gridWidth * grid.gridHeight;
  const film = new Float32Array(cellCount);
  const ridge = new Float32Array(cellCount);
  stampImpastoFilm(
    film,
    grid,
    stations,
    0,
    stations.length,
    impastoFilmCursor(),
    stations.length - 1
  );
  stampImpastoRidge(ridge, grid, stations, 0, stations.length - 1);
  return shadeImpastoRelief(film, ridge, grid);
}

export class StudioImpastoReliefPlanner {
  private grid: ImpastoReliefGrid | null = null;
  private settledFilm: Float32Array | null = null;
  private settledRidge: Float32Array | null = null;
  private settledEnd = 0;
  private cursor: ImpastoFilmCursor = impastoFilmCursor();
  private height: Float32Array | null = null;
  private shading: Float32Array | null = null;
  private dirtyFromStation = 0;
  private runTracks: readonly (readonly (PlannedImpastoReliefRun | undefined)[])[] =
    [];
  private runShape: ImpastoReliefRunShape | null = null;
  private runBounds: Float64Array | null = null;
  private lastReusedRuns = 0;

  get reusedRuns(): number {
    return this.lastReusedRuns;
  }

  snapshot(): ImpastoReliefFieldSnapshot | null {
    if (this.shading === null || this.grid === null) return null;
    return {
      shading: this.shading,
      gridWidth: this.grid.gridWidth,
      gridHeight: this.grid.gridHeight,
      cell: this.grid.cell,
      originX: this.grid.originX,
      originY: this.grid.originY,
    };
  }

  reset(): void {
    this.grid = null;
    this.settledFilm = null;
    this.settledRidge = null;
    this.settledEnd = 0;
    this.cursor = impastoFilmCursor();
    this.height = null;
    this.shading = null;
    this.dirtyFromStation = 0;
    this.runTracks = [];
    this.runShape = null;
    this.runBounds = null;
    this.lastReusedRuns = 0;
  }

  retainedRuns(shape: ImpastoReliefRunShape): {
    readonly tracks: readonly (readonly (PlannedImpastoReliefRun | undefined)[])[];
    readonly bounds: Float64Array;
  } | null {
    const held = this.runShape;
    if (
      held === null ||
      this.runBounds === null ||
      held.bristleCount !== shape.bristleCount ||
      held.stripeStride !== shape.stripeStride ||
      held.stripeOffset !== shape.stripeOffset ||
      held.cell !== shape.cell
    ) {
      return null;
    }
    return { tracks: this.runTracks, bounds: this.runBounds };
  }

  keepRuns(
    shape: ImpastoReliefRunShape,
    tracks: readonly (readonly (PlannedImpastoReliefRun | undefined)[])[],
    bounds: Float64Array,
    reused: number
  ): void {
    this.runShape = shape;
    this.runTracks = tracks;
    this.runBounds = bounds;
    this.lastReusedRuns = reused;
  }

  build(
    stations: readonly OilCarrierStation[],
    settled: number
  ): ImpastoReliefField | null {
    const grid = impastoReliefGrid(stations);
    if (!grid) {
      this.reset();
      return null;
    }
    const cellCount = grid.gridWidth * grid.gridHeight;
    const previous = this.grid;
    const bakeTo = Math.max(0, Math.min(settled, stations.length));
    const reusable =
      previous !== null &&
      this.settledFilm !== null &&
      this.settledRidge !== null &&
      previous.cell === grid.cell &&
      previous.hairStride === grid.hairStride &&
      previous.hairOffset === grid.hairOffset &&
      previous.bristleCount === grid.bristleCount &&
      bakeTo >= this.settledEnd;

    const dirty: ImpastoDirtyRect[] = [];
    const reshadeRetained =
      reusable && this.height !== null && this.shading !== null;
    if (!reusable) {
      this.settledFilm = new Float32Array(cellCount);
      this.settledRidge = new Float32Array(cellCount);
      this.settledEnd = 0;
      this.cursor = impastoFilmCursor();
      this.height = null;
      this.shading = null;
      this.dirtyFromStation = 0;
    } else if (
      previous!.gridWidth !== grid.gridWidth ||
      previous!.gridHeight !== grid.gridHeight ||
      previous!.originX !== grid.originX ||
      previous!.originY !== grid.originY
    ) {
      const shiftX = Math.round(
        (previous!.originX - grid.originX) / grid.cell
      );
      const shiftY = Math.round(
        (previous!.originY - grid.originY) / grid.cell
      );
      this.settledFilm = blitImpastoLayer(
        this.settledFilm!,
        previous!,
        grid,
        shiftX,
        shiftY
      );
      this.settledRidge = blitImpastoLayer(
        this.settledRidge!,
        previous!,
        grid,
        shiftX,
        shiftY
      );
      if (reshadeRetained) {
        this.height = blitImpastoLayer(
          this.height!,
          previous!,
          grid,
          shiftX,
          shiftY
        );
        this.shading = blitImpastoLayer(
          this.shading!,
          previous!,
          grid,
          shiftX,
          shiftY
        );
        for (const band of impastoGrowthBands(
          previous!,
          grid,
          shiftX,
          shiftY
        ))
          dirty.push(band);
      }
    }

    if (bakeTo > this.settledEnd) {
      stampImpastoFilm(
        this.settledFilm!,
        grid,
        stations,
        this.settledEnd,
        bakeTo,
        this.cursor,
        -1
      );
      stampImpastoRidge(
        this.settledRidge!,
        grid,
        stations,
        Math.max(0, this.settledEnd - 1),
        bakeTo - 1
      );
      this.settledEnd = bakeTo;
    }

    const film = new Float32Array(this.settledFilm!);
    const ridge = new Float32Array(this.settledRidge!);
    const tailCursor: ImpastoFilmCursor = { ...this.cursor };
    stampImpastoFilm(
      film,
      grid,
      stations,
      this.settledEnd,
      stations.length,
      tailCursor,
      stations.length - 1
    );
    stampImpastoRidge(
      ridge,
      grid,
      stations,
      Math.max(0, this.settledEnd - 1),
      stations.length - 1
    );

    const changedFrom = Math.max(
      0,
      Math.min(this.dirtyFromStation, this.settledEnd) - 1
    );
    if (reshadeRetained)
      impastoStationBounds(stations, changedFrom, grid, dirty);
    this.dirtyFromStation = stations.length;

    this.grid = grid;
    if (
      reshadeRetained &&
      this.height!.length === cellCount &&
      this.shading!.length === cellCount
    ) {
      return shadeImpastoRelief(film, ridge, grid, {
        height: this.height!,
        shading: this.shading!,
        dirty,
      });
    }
    const field = shadeImpastoRelief(film, ridge, grid);
    const height = new Float32Array(cellCount);
    for (let at = 0; at < cellCount; at += 1) height[at] = film[at]! + ridge[at]!;
    this.height = height;
    this.shading = field.shading as Float32Array;
    return field;
  }
}

function impastoStationBounds(
  stations: readonly OilCarrierStation[],
  from: number,
  grid: ImpastoReliefGrid,
  into: ImpastoDirtyRect[]
): void {
  const count = stations.length - from;
  if (count <= 0) return;
  const chunk = Math.max(
    IMPASTO_RELIEF_DIRTY_CHUNK_STATIONS,
    Math.ceil(count / IMPASTO_RELIEF_DIRTY_MAX_RECTS)
  );
  for (let start = from; start < stations.length; start += chunk) {
    const end = Math.min(stations.length, start + chunk + 1);
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let index = start; index < end; index += 1) {
      const station = stations[index]!;
      const reach =
        station.radiusY * IMPASTO_RELIEF_STAMP_REACH_RADIUS_RATIO +
        IMPASTO_RELIEF_STAMP_REACH_CELLS * grid.cell;
      minX = Math.min(minX, station.x - reach);
      minY = Math.min(minY, station.y - reach);
      maxX = Math.max(maxX, station.x + reach);
      maxY = Math.max(maxY, station.y + reach);
    }
    if (!Number.isFinite(minX)) continue;
    const x = Math.floor((minX - grid.originX) / grid.cell);
    const y = Math.floor((minY - grid.originY) / grid.cell);
    const right = Math.ceil((maxX - grid.originX) / grid.cell) + 1;
    const bottom = Math.ceil((maxY - grid.originY) / grid.cell) + 1;
    into.push({ x, y, width: right - x, height: bottom - y });
  }
}

function impastoGrowthBands(
  previous: ImpastoReliefGrid,
  grid: ImpastoReliefGrid,
  shiftX: number,
  shiftY: number
): ImpastoDirtyRect[] {
  const left = shiftX;
  const top = shiftY;
  const right = shiftX + previous.gridWidth;
  const bottom = shiftY + previous.gridHeight;
  const bands: ImpastoDirtyRect[] = [];
  if (left > 0)
    bands.push({ x: 0, y: 0, width: left + 1, height: grid.gridHeight });
  if (right < grid.gridWidth) {
    bands.push({
      x: right - 1,
      y: 0,
      width: grid.gridWidth - right + 1,
      height: grid.gridHeight,
    });
  }
  if (top > 0)
    bands.push({ x: 0, y: 0, width: grid.gridWidth, height: top + 1 });
  if (bottom < grid.gridHeight) {
    bands.push({
      x: 0,
      y: bottom - 1,
      width: grid.gridWidth,
      height: grid.gridHeight - bottom + 1,
    });
  }
  return bands;
}

function blitImpastoLayer(
  source: Float32Array,
  from: ImpastoReliefGrid,
  to: ImpastoReliefGrid,
  shiftX: number,
  shiftY: number
): Float32Array {
  const target = new Float32Array(to.gridWidth * to.gridHeight);
  for (let y = 0; y < from.gridHeight; y += 1) {
    const targetY = y + shiftY;
    if (targetY < 0 || targetY >= to.gridHeight) continue;
    const sourceRow = y * from.gridWidth;
    const targetRow = targetY * to.gridWidth;
    for (let x = 0; x < from.gridWidth; x += 1) {
      const targetX = x + shiftX;
      if (targetX < 0 || targetX >= to.gridWidth) continue;
      target[targetRow + targetX] = source[sourceRow + x]!;
    }
  }
  return target;
}

function sampleImpastoReliefShading(
  field: ImpastoReliefField,
  x: number,
  y: number
): number {
  const gridX = clamp(
    (x - field.originX) / field.cell - 0.5,
    0,
    field.gridWidth - 1
  );
  const gridY = clamp(
    (y - field.originY) / field.cell - 0.5,
    0,
    field.gridHeight - 1
  );
  const x0 = Math.floor(gridX);
  const y0 = Math.floor(gridY);
  const x1 = Math.min(field.gridWidth - 1, x0 + 1);
  const y1 = Math.min(field.gridHeight - 1, y0 + 1);
  const tx = gridX - x0;
  const ty = gridY - y0;
  const top =
    field.shading[y0 * field.gridWidth + x0]! * (1 - tx) +
    field.shading[y0 * field.gridWidth + x1]! * tx;
  const bottom =
    field.shading[y1 * field.gridWidth + x0]! * (1 - tx) +
    field.shading[y1 * field.gridWidth + x1]! * tx;
  return top * (1 - ty) + bottom * ty;
}

export interface ImpastoReliefRunShape {
  readonly bristleCount: number;
  readonly stripeStride: number;
  readonly stripeOffset: number;
  readonly cell: number;
}

export interface ImpastoReliefPoint {
  geomOffset: number;
  sampleOffset: number;
  width: number;
}

export interface PlannedImpastoReliefRun {
  readonly points: readonly number[];
  readonly strength: number;
  readonly width: number;
  readonly trackIndex: number;
  readonly runIndex: number;
}

function bucketEdgeAbove(bucket: number): number {
  return bucket === 0
    ? IMPASTO_RELIEF_BUCKET_EDGE_LOW
    : bucket === 1
      ? IMPASTO_RELIEF_BUCKET_EDGE_HIGH
      : Number.POSITIVE_INFINITY;
}

function bucketEdgeBelow(bucket: number): number {
  return bucket === 0
    ? 0
    : bucket === 1
      ? IMPASTO_RELIEF_BUCKET_EDGE_LOW
      : IMPASTO_RELIEF_BUCKET_EDGE_HIGH;
}

function weldReliefRuns(
  runs: readonly PlannedImpastoReliefRun[]
): readonly PlannedImpastoReliefRun[] {
  return weldByTrack(
    runs,
    (run) => run.trackIndex,
    (run) => run.runIndex,
    (points, first, last) => ({
      points,
      strength: (first.strength + last.strength) / 2,
      width: (first.width + last.width) / 2,
      trackIndex: last.trackIndex,
      runIndex: last.runIndex,
    })
  );
}

function reusableReliefRuns(
  stations: readonly OilCarrierStation[],
  settled: number,
  field: ImpastoReliefField,
  runCount: number,
  bounds: Float64Array
): boolean[] {
  const reusable = new Array<boolean>(runCount).fill(false);
  const written = field.writtenShading;
  if (written === null || settled < 2) return reusable;
  const measured = Math.min(runCount, Math.floor(bounds.length / 4));
  for (let runIndex = 0; runIndex < measured; runIndex += 1) {
    if ((runIndex + 1) * BRISTLE_RUN_STATIONS > settled - 1) break;
    const box = runIndex * 4;
    const x0 = Math.floor((bounds[box]! - field.originX) / field.cell) - 1;
    const y0 = Math.floor((bounds[box + 1]! - field.originY) / field.cell) - 1;
    const x1 = Math.floor((bounds[box + 2]! - field.originX) / field.cell) + 2;
    const y1 = Math.floor((bounds[box + 3]! - field.originY) / field.cell) + 2;
    let touched = false;
    for (const rect of written) {
      if (
        rect.x < x1 &&
        rect.x + rect.width > x0 &&
        rect.y < y1 &&
        rect.y + rect.height > y0
      ) {
        touched = true;
        break;
      }
    }
    reusable[runIndex] = !touched;
  }
  return reusable;
}

export function planImpastoReliefOverlayLanes(
  stations: readonly OilCarrierStation[],
  retained?: { readonly planner: StudioImpastoReliefPlanner; readonly settled: number }
): readonly StudioOilRibbonImpastoReliefLane[] {
  if (stations.length < 2) return Object.freeze([]);
  const field = retained
    ? retained.planner.build(stations, retained.settled)
    : buildImpastoReliefField(stations);
  if (!field) return Object.freeze([]);
  const bristleCount = impastoBristleCount(stations);
  const runCount = Math.max(
    0,
    Math.ceil((stations.length - 1) / BRISTLE_RUN_STATIONS)
  );
  const stripeStride = field.hairStride;
  const stripeOffset = field.hairOffset;

  const at: ImpastoReliefPoint = { geomOffset: 0, sampleOffset: 0, width: 0 };

  const collectRun = (
    runStart: number,
    runEnd: number,
    pointAt: (station: OilCarrierStation, side: 1 | -1, into: ImpastoReliefPoint) => void,
    side: 1 | -1,
    trackIndex: number,
    runIndex: number,
    bounds: Float64Array
  ): PlannedImpastoReliefRun | undefined => {
    const samples = runEnd - runStart + 1;
    const points = new Array<number>(samples > 0 ? samples * 2 : 0);
    let strengthSum = 0;
    let widthSum = 0;
    const box = runIndex * 4;
    for (let index = runStart; index <= runEnd; index += 1) {
      const station = stations[index]!;
      pointAt(station, side, at);
      const slot = (index - runStart) * 2;
      points[slot] = quantize(station.x + station.normalX * at.geomOffset);
      points[slot + 1] = quantize(station.y + station.normalY * at.geomOffset);
      const sampleX = station.x + station.normalX * at.sampleOffset;
      const sampleY = station.y + station.normalY * at.sampleOffset;
      if (sampleX < bounds[box]!) bounds[box] = sampleX;
      if (sampleY < bounds[box + 1]!) bounds[box + 1] = sampleY;
      if (sampleX > bounds[box + 2]!) bounds[box + 2] = sampleX;
      if (sampleY > bounds[box + 3]!) bounds[box + 3] = sampleY;
      strengthSum += sampleImpastoReliefShading(field, sampleX, sampleY) - 1;
      widthSum += at.width;
    }
    if (samples < 2) return undefined;
    return {
      points: Object.freeze(points),
      strength: strengthSum / samples,
      width: widthSum / samples,
      trackIndex,
      runIndex,
    };
  };

  const trackOf = (side: 1 | -1, stripe: number): number =>
    (side === 1 ? 0 : bristleCount + 1) * 2 + stripe;

  const flankPointAt =
    (bristleIndex: number) =>
    (
      station: OilCarrierStation,
      flankSide: 1 | -1,
      into: ImpastoReliefPoint
    ): void => {
      const hair = station.source.bristles[bristleIndex]!;
      const ridgeWidth = impastoRidgeWidth(station, hair);
      const width = Math.max(0.4, ridgeWidth * 0.85);
      const offset = station.radiusY * hair.offsetRatio;
      const flankDelta = Math.max(ridgeWidth * 0.5, field.cell * 0.4);
      const maxOffset =
        station.radiusY * IMPASTO_RELIEF_MAX_OFFSET_RATIO - width * 0.5;
      into.geomOffset = clamp(
        offset + flankSide * flankDelta,
        -maxOffset,
        maxOffset
      );
      into.sampleOffset = offset + flankSide * field.cell * 0.9;
      into.width = width;
    };

  const rimPointAt = (
    station: OilCarrierStation,
    rimSide: 1 | -1,
    into: ImpastoReliefPoint
  ): void => {
    const width = clamp(station.radiusY * 0.26, 0.4, 2.6);
    const inset = Math.min(
      station.radiusY * 0.9,
      Math.max(station.radiusY * 0.7, station.radiusY - 1.6 * field.cell)
    );
    into.geomOffset = rimSide * inset;
    into.sampleOffset =
      rimSide *
      Math.max(station.radiusY - 0.9 * field.cell, station.radiusY * 0.5);
    into.width = width;
  };

  const shape: ImpastoReliefRunShape = {
    bristleCount,
    stripeStride,
    stripeOffset,
    cell: field.cell,
  };
  const cached = retained?.planner.retainedRuns(shape) ?? null;
  const reusable =
    cached === null
      ? null
      : reusableReliefRuns(
          stations,
          retained!.settled,
          field,
          runCount,
          cached.bounds
        );
  const bounds = new Float64Array(runCount * 4);
  for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
    const box = runIndex * 4;
    if (reusable?.[runIndex] === true) {
      bounds[box] = cached!.bounds[box]!;
      bounds[box + 1] = cached!.bounds[box + 1]!;
      bounds[box + 2] = cached!.bounds[box + 2]!;
      bounds[box + 3] = cached!.bounds[box + 3]!;
      continue;
    }
    bounds[box] = Number.POSITIVE_INFINITY;
    bounds[box + 1] = Number.POSITIVE_INFINITY;
    bounds[box + 2] = Number.NEGATIVE_INFINITY;
    bounds[box + 3] = Number.NEGATIVE_INFINITY;
  }
  const stale: number[] = [];
  for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
    if (reusable?.[runIndex] !== true) stale.push(runIndex);
  }
  const tracks: (readonly (PlannedImpastoReliefRun | undefined)[])[] = [];

  const collectTrack = (
    trackIndex: number,
    side: 1 | -1,
    pointAt: (station: OilCarrierStation, side: 1 | -1, into: ImpastoReliefPoint) => void
  ): void => {
    const kept = cached?.tracks[tracks.length];
    const runs = new Array<PlannedImpastoReliefRun | undefined>(runCount);
    if (kept !== undefined) {
      const carry = Math.min(runCount, kept.length);
      for (let runIndex = 0; runIndex < carry; runIndex += 1)
        runs[runIndex] = kept[runIndex];
    }
    for (const runIndex of stale) {
      runs[runIndex] = collectRun(
        runIndex * BRISTLE_RUN_STATIONS,
        Math.min(stations.length - 1, (runIndex + 1) * BRISTLE_RUN_STATIONS),
        pointAt,
        side,
        trackIndex,
        runIndex,
        bounds
      );
    }
    tracks.push(runs);
  };

  for (const side of [1, -1] as const) {
    for (
      let bristleIndex = stripeOffset;
      bristleIndex < bristleCount;
      bristleIndex += stripeStride
    ) {
      collectTrack(
        trackOf(side, bristleIndex),
        side,
        flankPointAt(bristleIndex)
      );
    }
    collectTrack(trackOf(side, bristleCount), side, rimPointAt);
  }
  retained?.planner.keepRuns(
    shape,
    tracks,
    bounds,
    cached === null ? 0 : (runCount - stale.length) * tracks.length
  );

  const buckets = new Map<
    number,
    {
      kind: StudioOilRibbonImpastoReliefKind;
      order: number;
      runs: PlannedImpastoReliefRun[];
      opacities: number[];
    }
  >();
  for (const track of tracks) {
    let heldKind: StudioOilRibbonImpastoReliefKind | null = null;
    let heldBucket = 0;
    for (const run of track) {
      if (run === undefined) continue;
      const magnitude = Math.abs(run.strength);
      if (magnitude < IMPASTO_RELIEF_MIN_STRENGTH) {
        heldKind = null;
        continue;
      }
      const kind: StudioOilRibbonImpastoReliefKind =
        run.strength > 0 ? "highlight" : "shadow";
      const maxOpacity =
        kind === "highlight"
          ? IMPASTO_RELIEF_MAX_HIGHLIGHT_OPACITY
          : IMPASTO_RELIEF_MAX_SHADOW_OPACITY;
      const gain =
        kind === "highlight"
          ? IMPASTO_RELIEF_HIGHLIGHT_GAIN
          : IMPASTO_RELIEF_SHADOW_GAIN;
      const opacity = Math.min(maxOpacity, magnitude * gain);
      const raw =
        opacity < maxOpacity * IMPASTO_RELIEF_BUCKET_EDGE_LOW
          ? 0
          : opacity < maxOpacity * IMPASTO_RELIEF_BUCKET_EDGE_HIGH
            ? 1
            : IMPASTO_RELIEF_OPACITY_BUCKETS - 1;
      const ratio = opacity / maxOpacity;
      const bucket =
        heldKind !== kind
          ? raw
          : raw > heldBucket
            ? ratio >=
              bucketEdgeAbove(heldBucket) + IMPASTO_RELIEF_BUCKET_HYSTERESIS
              ? raw
              : heldBucket
            : raw < heldBucket
              ? ratio <=
                bucketEdgeBelow(heldBucket) - IMPASTO_RELIEF_BUCKET_HYSTERESIS
                ? raw
                : heldBucket
              : raw;
      heldKind = kind;
      heldBucket = bucket;
      const order =
        (kind === "shadow" ? 0 : IMPASTO_RELIEF_OPACITY_BUCKETS) + bucket;
      let entry = buckets.get(order);
      if (entry === undefined) {
        entry = { kind, order, runs: [], opacities: [] };
        buckets.set(order, entry);
      }
      entry.runs.push(run);
      entry.opacities.push(opacity);
    }
  }

  const lanes = [...buckets.values()]
    .sort((left, right) => left.order - right.order)
    .map((entry) => {
      const welded = weldReliefRuns(entry.runs);
      return Object.freeze({
        runs: Object.freeze(
          welded.map((run) =>
            Object.freeze({
              points: Object.freeze(run.points),
            })
          )
        ),
        lineWidth: quantize(meanBy(entry.runs, (run) => run.width)),
        opacity: quantize(mean(entry.opacities)),
        kind: entry.kind,
      });
    });
  return Object.freeze(lanes);
}
