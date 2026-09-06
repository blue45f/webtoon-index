import {
  resolveStudioInkPressure,
  studioInkUsesResidualDabSpacing,
} from "../brush/studio-ink-pressure-model";
import { planStudioCausalInkDabs } from "../studio-causal-ink";

import {
  STUDIO_GPU_STROKE_FEED_REVISION,
  orderStudioGpuStrokes,
  studioGpuPressureRadius,
  type StudioGpuStroke,
} from "./studio-webgpu-stroke";
import {
  isTrustedStudioGpuStrokeFeedRevision,
  isTrustedStudioGpuStrokeFeedStroke,
} from "./studio-webgpu-stroke-feed";

export const STUDIO_GPU_TILE_SIZE = 512;
export const STUDIO_GPU_TILE_BLEED = 2;

export interface StudioGpuRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioGpuTile extends StudioGpuRect {
  readonly id: string;
  readonly column: number;
  readonly row: number;
}

export interface StudioGpuTileOperation {
  readonly id: string;
  /** Fast cache precheck only; exact equality must also compare `signature`. */
  readonly fingerprint: string;
  /** Collision-free semantic snapshot, or a process-unique trusted feed revision identity. */
  readonly signature: string;
  /** Exact metadata used only to prove that the terminal live stroke is an immutable point suffix. */
  readonly strokeStyleSignature?: string;
  readonly pointSamplesSignature?: string;
  readonly pressureSamplesSignature?: string;
  readonly pointCount?: number;
  /** Trusted in-process lineage; equal lineage plus a larger point count proves an append. */
  readonly feedLineage?: string;
  readonly feedRevisionToken?: string;
}

export interface StudioGpuTileStrokeExtension {
  readonly previous: StudioGpuTileOperation;
  readonly next: StudioGpuTileOperation;
}

export interface StudioGpuTileState extends StudioGpuTile {
  readonly operations: readonly StudioGpuTileOperation[];
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly tileSize: number;
  readonly bleed: number;
}

export interface StudioGpuTilePlanOptions {
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly tileSize?: number;
  /** Logical-pixel expansion that preserves anti-aliased edges at tile boundaries. */
  readonly bleed?: number;
}

export interface StudioGpuVisibleTileOptions extends StudioGpuTilePlanOptions {
  readonly viewBox: StudioGpuRect;
  readonly overscanRows?: number;
  readonly overscanColumns?: number;
}

export type StudioGpuTileUpdateMode = "clean" | "append" | "rebuild";

export interface StudioGpuTileUpdate {
  readonly tile: StudioGpuTile;
  readonly mode: StudioGpuTileUpdateMode;
  /** Full sequence for rebuilds, immutable suffix for appends, empty for clean tiles. */
  readonly operations: readonly StudioGpuTileOperation[];
  readonly previousOperationCount: number;
  readonly nextOperationCount: number;
  /** Present only when the final operation itself grew by an exact immutable point suffix. */
  readonly strokeExtension?: StudioGpuTileStrokeExtension;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveOr(value: unknown, fallback: number): number {
  const finite = finiteOr(value, fallback);
  return finite > 0 ? finite : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return Math.max(0, Math.floor(finiteOr(value, fallback)));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function tileId(column: number, row: number): string {
  return `${column}:${row}`;
}

function normalizeDimensions(options: StudioGpuTilePlanOptions) {
  return {
    logicalWidth: positiveOr(options.logicalWidth, 1),
    logicalHeight: positiveOr(options.logicalHeight, 1),
    tileSize: positiveOr(options.tileSize, STUDIO_GPU_TILE_SIZE),
    bleed: Math.max(0, finiteOr(options.bleed, STUDIO_GPU_TILE_BLEED)),
  };
}

function tileAt(
  column: number,
  row: number,
  logicalWidth: number,
  logicalHeight: number,
  tileSize: number
): StudioGpuTile {
  const x = column * tileSize;
  const y = row * tileSize;
  return {
    id: tileId(column, row),
    column,
    row,
    x,
    y,
    width: Math.min(tileSize, logicalWidth - x),
    height: Math.min(tileSize, logicalHeight - y),
  };
}

function stableNumber(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "+Infinity";
  if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
  if (Object.is(value, -0)) return "-0";
  return String(value);
}

function fnv1a(value: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function semanticToken(value: string | number | undefined): string {
  if (value === undefined) return "u0:";
  const payload = typeof value === "number" ? stableNumber(value) : value;
  const type = typeof value === "number" ? "n" : "s";
  return `${type}${payload.length}:${payload}`;
}

function sequenceSignature(values: readonly number[]): string {
  return values.map((value) => semanticToken(value)).join("");
}

function effectiveStrokePressure(stroke: StudioGpuStroke, index: number): number {
  return resolveStudioInkPressure(stroke.pressures?.[index], stroke.pressureModel);
}

function strokeStyleSignature(stroke: StudioGpuStroke): string {
  const legacySignature = [
    stroke.id,
    stroke.color,
    stroke.size,
    stroke.opacity,
    stroke.composite,
    stroke.orderKey,
  ].map((value) => semanticToken(value)).join("");
  return stroke.pressureModel === undefined
    ? legacySignature
    : `${legacySignature}${semanticToken(`pressure-model:${stroke.pressureModel}`)}`;
}

/**
 * Per-pass operation identity cache — the audit's hotspot #6.
 *
 * `planStudioGpuTileStates` runs every frame request, and each non-feed stroke rebuilt four
 * O(points) token strings (fingerprint, signature, point samples, pressure samples) per pass even
 * though settled strokes are documented immutable snapshots. The WeakMap keys the exact stroke
 * object: untouched strokes hit in O(1), and only genuinely new snapshots (appends) pay one build.
 * Length + feed-token guards detect a contract-breaking in-place mutation and force a rebuild.
 */
interface StudioGpuTileOperationCacheRecord {
  readonly operation: StudioGpuTileOperation;
  readonly pointCount: number;
  readonly pressuresLength: number;
  readonly feedToken: string | undefined;
}

const studioGpuTileOperationCache = new WeakMap<
  StudioGpuStroke,
  StudioGpuTileOperationCacheRecord
>();

function cachedStudioGpuTileOperation(
  stroke: StudioGpuStroke,
  feedToken: string | undefined,
): StudioGpuTileOperation | null {
  const record = studioGpuTileOperationCache.get(stroke);
  if (!record) return null;
  const pointCount = Math.floor(stroke.points.length / 2);
  if (
    record.pointCount !== pointCount
    || record.pressuresLength !== (stroke.pressures?.length ?? -1)
    || record.feedToken !== feedToken
  ) return null;
  return record.operation;
}

function operationForStudioGpuStroke(stroke: StudioGpuStroke): StudioGpuTileOperation {
  const feed = stroke[STUDIO_GPU_STROKE_FEED_REVISION];
  const trustedFeed = isTrustedStudioGpuStrokeFeedStroke(stroke)
    && isTrustedStudioGpuStrokeFeedRevision(feed);
  if (trustedFeed) {
    const operation: StudioGpuTileOperation = {
      id: stroke.id,
      fingerprint: `feed:${feed.token}`,
      signature: `feed:${feed.token}`,
      strokeStyleSignature: feed.styleSignature,
      pointSamplesSignature: `feed:${feed.token}:points`,
      pressureSamplesSignature: `feed:${feed.token}:pressures`,
      pointCount: feed.pointCount,
      feedLineage: feed.lineage,
      feedRevisionToken: feed.token,
    };
    // 피드 스트로크는 토큰이 개정을 증명하므로 문자열 조립 없이 토큰만 캐시 가드로 쓴다.
    studioGpuTileOperationCache.set(stroke, {
      operation,
      pointCount: Number.NaN,
      pressuresLength: Number.NaN,
      feedToken: feed.token,
    });
    return operation;
  }
  const cached = cachedStudioGpuTileOperation(stroke, undefined);
  if (cached) return cached;
  const pointCount = Math.floor(stroke.points.length / 2);
  const operation: StudioGpuTileOperation = {
    id: stroke.id,
    fingerprint: fingerprintStudioGpuStroke(stroke),
    signature: signatureStudioGpuStroke(stroke),
    strokeStyleSignature: strokeStyleSignature(stroke),
    pointSamplesSignature: sequenceSignature(stroke.points),
    pressureSamplesSignature: sequenceSignature(Array.from(
      { length: pointCount },
      (_, index) => effectiveStrokePressure(stroke, index)
    )),
    pointCount,
  };
  studioGpuTileOperationCache.set(stroke, {
    operation,
    pointCount,
    pressuresLength: stroke.pressures?.length ?? -1,
    feedToken: undefined,
  });
  return operation;
}

/** Exact immutable operation identity. Full strokes use unambiguous length-prefixed fields. */
export function signatureStudioGpuStroke(stroke: StudioGpuStroke): string {
  const feed = stroke[STUDIO_GPU_STROKE_FEED_REVISION];
  if (
    isTrustedStudioGpuStrokeFeedStroke(stroke)
    && isTrustedStudioGpuStrokeFeedRevision(feed)
  ) return `feed:${feed.token}`;
  const tokens: string[] = [];
  const write = (value: string | number | undefined) => tokens.push(semanticToken(value));
  write(stroke.id);
  write(stroke.color);
  write(stroke.size);
  write(stroke.opacity);
  write(stroke.composite);
  write(stroke.orderKey);
  if (stroke.pressureModel !== undefined) {
    write(`pressure-model:${stroke.pressureModel}`);
  }
  write(stroke.points.length);
  for (const point of stroke.points) write(point);
  write(stroke.pressures?.length);
  for (const pressure of stroke.pressures ?? []) write(pressure);
  return tokens.join("");
}

/** Stable, locale-independent precheck; callers must retain the exact signature beside it. */
export function fingerprintStudioGpuStroke(stroke: StudioGpuStroke): string {
  const feed = stroke[STUDIO_GPU_STROKE_FEED_REVISION];
  if (
    isTrustedStudioGpuStrokeFeedStroke(stroke)
    && isTrustedStudioGpuStrokeFeedRevision(feed)
  ) return `feed:${feed.token}`;
  let hash = fnv1a(stroke.id);
  const write = (value: string | number | undefined) => {
    const token = typeof value === "number" ? stableNumber(value) : value ?? "<undefined>";
    hash = fnv1a(`\u0000${token}`, hash);
  };
  write(stroke.color);
  write(stroke.size);
  write(stroke.opacity);
  write(stroke.composite);
  write(stroke.orderKey);
  if (stroke.pressureModel !== undefined) {
    write(`pressure-model:${stroke.pressureModel}`);
  }
  write(stroke.points.length);
  for (const point of stroke.points) write(point);
  write(stroke.pressures?.length);
  for (const pressure of stroke.pressures ?? []) write(pressure);
  return `${stroke.id}:${hash.toString(16).padStart(8, "0")}`;
}

/** Conservative bounds for every round dab generated along a pressure-interpolated stroke. */
export function boundsForStudioGpuStroke(
  stroke: StudioGpuStroke,
  bleed = STUDIO_GPU_TILE_BLEED
): StudioGpuRect | null {
  const feed = stroke[STUDIO_GPU_STROKE_FEED_REVISION];
  if (
    isTrustedStudioGpuStrokeFeedStroke(stroke)
    && isTrustedStudioGpuStrokeFeedRevision(feed)
  ) {
    const edgeBleed = Math.max(0, finiteOr(bleed, STUDIO_GPU_TILE_BLEED));
    return {
      x: feed.minimumX - edgeBleed,
      y: feed.minimumY - edgeBleed,
      width: Math.max(0, feed.maximumX - feed.minimumX + edgeBleed * 2),
      height: Math.max(0, feed.maximumY - feed.minimumY + edgeBleed * 2),
    };
  }
  const pointCount = Math.floor(stroke.points.length / 2);
  if (pointCount < 1) return null;
  const size = positiveOr(stroke.size, 1);
  const edgeBleed = Math.max(0, finiteOr(bleed, STUDIO_GPU_TILE_BLEED));
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;

  if (studioInkUsesResidualDabSpacing(stroke.pressureModel) && stroke.pressureModel) {
    const samples = Array.from({ length: pointCount }, (_, sourceIndex) => ({
        x: stroke.points[sourceIndex * 2]!,
        y: stroke.points[sourceIndex * 2 + 1]!,
        pressure: resolveStudioInkPressure(
          stroke.pressures?.[sourceIndex],
          stroke.pressureModel
        ),
        sourceIndex,
      }));
    const plan = planStudioCausalInkDabs({
      samples,
      size,
      pressureModel: stroke.pressureModel,
    });
    if (!plan.complete) {
      // A cap-exceeding residual stroke must never become an apparently complete blank tile frame.
      // Magma's chord quirk can overshoot the source envelope, but no dab can travel farther than
      // the stroke's total source path length from it. Use that rare conservative bound so the
      // tile dab planner can reject the frame as incomplete instead of omitting its operation.
      let pathLength = 0;
      for (let index = 1; index < samples.length; index += 1) {
        pathLength += Math.hypot(
          samples[index]!.x - samples[index - 1]!.x,
          samples[index]!.y - samples[index - 1]!.y
        );
      }
      if (!Number.isFinite(pathLength)) {
        const extent = Number.MAX_SAFE_INTEGER / 4;
        return { x: -extent, y: -extent, width: extent * 2, height: extent * 2 };
      }
      const maximumRadius = studioGpuPressureRadius(size, 1, stroke.pressureModel)
        + edgeBleed + pathLength;
      for (const sample of samples) {
        minimumX = Math.min(minimumX, sample.x - maximumRadius);
        minimumY = Math.min(minimumY, sample.y - maximumRadius);
        maximumX = Math.max(maximumX, sample.x + maximumRadius);
        maximumY = Math.max(maximumY, sample.y + maximumRadius);
      }
      return {
        x: minimumX,
        y: minimumY,
        width: Math.max(0, maximumX - minimumX),
        height: Math.max(0, maximumY - minimumY),
      };
    }
    if (plan.dabs.length === 0) return null;
    for (const dab of plan.dabs) {
      const radius = dab.radius + edgeBleed;
      minimumX = Math.min(minimumX, dab.x - radius);
      minimumY = Math.min(minimumY, dab.y - radius);
      maximumX = Math.max(maximumX, dab.x + radius);
      maximumY = Math.max(maximumY, dab.y + radius);
    }
    return {
      x: minimumX,
      y: minimumY,
      width: Math.max(0, maximumX - minimumX),
      height: Math.max(0, maximumY - minimumY),
    };
  }

  for (let index = 0; index < pointCount; index += 1) {
    const x = stroke.points[index * 2];
    const y = stroke.points[index * 2 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const radius = studioGpuPressureRadius(
      size,
      resolveStudioInkPressure(stroke.pressures?.[index], stroke.pressureModel),
      stroke.pressureModel
    ) + edgeBleed;
    minimumX = Math.min(minimumX, x! - radius);
    minimumY = Math.min(minimumY, y! - radius);
    maximumX = Math.max(maximumX, x! + radius);
    maximumY = Math.max(maximumY, y! + radius);
  }

  if (![minimumX, minimumY, maximumX, maximumY].every(Number.isFinite)) return null;
  return {
    x: minimumX,
    y: minimumY,
    width: Math.max(0, maximumX - minimumX),
    height: Math.max(0, maximumY - minimumY),
  };
}

function tileRangeForRect(rect: StudioGpuRect, options: StudioGpuTilePlanOptions) {
  const dimensions = normalizeDimensions(options);
  const columnCount = Math.ceil(dimensions.logicalWidth / dimensions.tileSize);
  const rowCount = Math.ceil(dimensions.logicalHeight / dimensions.tileSize);
  const right = rect.x + Math.max(0, rect.width);
  const bottom = rect.y + Math.max(0, rect.height);
  if (right < 0 || bottom < 0 || rect.x > dimensions.logicalWidth || rect.y > dimensions.logicalHeight) {
    return null;
  }
  return {
    ...dimensions,
    columnCount,
    rowCount,
    minimumColumn: clamp(Math.floor(rect.x / dimensions.tileSize), 0, columnCount - 1),
    maximumColumn: clamp(Math.floor(right / dimensions.tileSize), 0, columnCount - 1),
    minimumRow: clamp(Math.floor(rect.y / dimensions.tileSize), 0, rowCount - 1),
    maximumRow: clamp(Math.floor(bottom / dimensions.tileSize), 0, rowCount - 1),
  };
}

/** Builds ordered per-tile operation logs without allocating any GPU resources. */
export function planStudioGpuTileStates(
  strokes: readonly StudioGpuStroke[],
  options: StudioGpuTilePlanOptions,
  includedTiles?: readonly StudioGpuTile[]
): readonly StudioGpuTileState[] {
  const dimensions = normalizeDimensions(options);
  const operationsByTile = new Map<string, StudioGpuTileOperation[]>();
  const includedIds = includedTiles === undefined
    ? null
    : new Set(includedTiles.map(({ id }) => id));
  if (includedIds?.size === 0) return [];
  const includedRange = includedTiles && includedTiles.length > 0
    ? includedTiles.reduce((range, tile) => ({
        minimumColumn: Math.min(range.minimumColumn, tile.column),
        maximumColumn: Math.max(range.maximumColumn, tile.column),
        minimumRow: Math.min(range.minimumRow, tile.row),
        maximumRow: Math.max(range.maximumRow, tile.row),
      }), {
        minimumColumn: Number.POSITIVE_INFINITY,
        maximumColumn: Number.NEGATIVE_INFINITY,
        minimumRow: Number.POSITIVE_INFINITY,
        maximumRow: Number.NEGATIVE_INFINITY,
      })
    : null;

  for (const stroke of orderStudioGpuStrokes(strokes)) {
    const bounds = boundsForStudioGpuStroke(stroke, dimensions.bleed);
    if (!bounds) continue;
    const range = tileRangeForRect(bounds, dimensions);
    if (!range) continue;
    if (
      includedRange && (
        range.maximumColumn < includedRange.minimumColumn ||
        range.minimumColumn > includedRange.maximumColumn ||
        range.maximumRow < includedRange.minimumRow ||
        range.minimumRow > includedRange.maximumRow
      )
    ) {
      continue;
    }
    const operation = operationForStudioGpuStroke(stroke);
    for (let row = range.minimumRow; row <= range.maximumRow; row += 1) {
      for (let column = range.minimumColumn; column <= range.maximumColumn; column += 1) {
        const id = tileId(column, row);
        if (includedIds && !includedIds.has(id)) continue;
        const operations = operationsByTile.get(id) ?? [];
        operations.push(operation);
        operationsByTile.set(id, operations);
      }
    }
  }

  return [...operationsByTile.entries()]
    .map(([id, operations]) => {
      const [columnToken, rowToken] = id.split(":");
      const column = Number(columnToken);
      const row = Number(rowToken);
      return {
        ...tileAt(
          column,
          row,
          dimensions.logicalWidth,
          dimensions.logicalHeight,
          dimensions.tileSize
        ),
        operations,
        logicalWidth: dimensions.logicalWidth,
        logicalHeight: dimensions.logicalHeight,
        tileSize: dimensions.tileSize,
        bleed: dimensions.bleed,
      };
    })
    .sort((left, right) => left.row - right.row || left.column - right.column);
}

/** Returns only viewport tiles plus bounded overscan, keeping tall documents texture-size agnostic. */
export function planVisibleStudioGpuTiles(
  options: StudioGpuVisibleTileOptions
): readonly StudioGpuTile[] {
  const dimensions = normalizeDimensions(options);
  if (options.viewBox.width <= 0 || options.viewBox.height <= 0) return [];
  const baseRange = tileRangeForRect(options.viewBox, dimensions);
  if (!baseRange) return [];
  const overscanRows = nonNegativeInteger(options.overscanRows, 1);
  const overscanColumns = nonNegativeInteger(options.overscanColumns, 1);
  const minimumRow = Math.max(0, baseRange.minimumRow - overscanRows);
  const maximumRow = Math.min(baseRange.rowCount - 1, baseRange.maximumRow + overscanRows);
  const minimumColumn = Math.max(0, baseRange.minimumColumn - overscanColumns);
  const maximumColumn = Math.min(
    baseRange.columnCount - 1,
    baseRange.maximumColumn + overscanColumns
  );
  const tiles: StudioGpuTile[] = [];
  for (let row = minimumRow; row <= maximumRow; row += 1) {
    for (let column = minimumColumn; column <= maximumColumn; column += 1) {
      tiles.push(tileAt(
        column,
        row,
        dimensions.logicalWidth,
        dimensions.logicalHeight,
        dimensions.tileSize
      ));
    }
  }
  return tiles;
}

function sameOperation(left: StudioGpuTileOperation, right: StudioGpuTileOperation): boolean {
  return left.id === right.id
    && left.fingerprint === right.fingerprint
    && left.signature === right.signature;
}

function sameSequence(
  left: readonly StudioGpuTileOperation[],
  right: readonly StudioGpuTileOperation[]
): boolean {
  return left.length === right.length && left.every((operation, index) => (
    sameOperation(operation, right[index]!)
  ));
}

function isStrictSequencePrefix(
  prefix: readonly StudioGpuTileOperation[],
  sequence: readonly StudioGpuTileOperation[]
): boolean {
  return prefix.length < sequence.length && prefix.every((operation, index) => (
    sameOperation(operation, sequence[index]!)
  ));
}

function terminalStrokeExtension(
  previous: readonly StudioGpuTileOperation[],
  next: readonly StudioGpuTileOperation[]
): StudioGpuTileStrokeExtension | null {
  if (previous.length === 0 || previous.length !== next.length) return null;
  const terminalIndex = previous.length - 1;
  if (!previous.slice(0, terminalIndex).every((operation, index) => (
    sameOperation(operation, next[index]!)
  ))) {
    return null;
  }
  const before = previous[terminalIndex]!;
  const after = next[terminalIndex]!;
  const trustedFeedExtension = before.id === after.id
    && before.feedLineage !== undefined
    && after.feedLineage === before.feedLineage
    && before.strokeStyleSignature !== undefined
    && after.strokeStyleSignature === before.strokeStyleSignature
    && before.pointCount !== undefined
    && after.pointCount !== undefined
    && Number.isSafeInteger(before.pointCount)
    && Number.isSafeInteger(after.pointCount)
    && before.pointCount >= 1
    && after.pointCount > before.pointCount;
  if (trustedFeedExtension) return { previous: before, next: after };
  if (
    before.id !== after.id
    || before.strokeStyleSignature === undefined
    || before.pointSamplesSignature === undefined
    || before.pressureSamplesSignature === undefined
    || before.pointCount === undefined
    || after.strokeStyleSignature !== before.strokeStyleSignature
    || after.pointSamplesSignature === undefined
    || after.pressureSamplesSignature === undefined
    || after.pointCount === undefined
    || !Number.isSafeInteger(before.pointCount)
    || !Number.isSafeInteger(after.pointCount)
    || before.pointCount < 1
    || after.pointCount <= before.pointCount
    || !after.pointSamplesSignature.startsWith(before.pointSamplesSignature)
    || !after.pressureSamplesSignature.startsWith(before.pressureSamplesSignature)
  ) {
    return null;
  }
  return { previous: before, next: after };
}

function sameTileContract(left: StudioGpuTileState, right: StudioGpuTileState): boolean {
  return left.id === right.id
    && left.column === right.column
    && left.row === right.row
    && Object.is(left.x, right.x)
    && Object.is(left.y, right.y)
    && Object.is(left.width, right.width)
    && Object.is(left.height, right.height)
    && Object.is(left.logicalWidth, right.logicalWidth)
    && Object.is(left.logicalHeight, right.logicalHeight)
    && Object.is(left.tileSize, right.tileSize)
    && Object.is(left.bleed, right.bleed);
}

/**
 * Exact tile logs stay clean, immutable suffixes append, and edits/deletes/reorders rebuild only
 * the old/new coverage union. This is the retained-texture contract used by the tiled compositor.
 */
export function diffStudioGpuTileStates(
  previousStates: readonly StudioGpuTileState[],
  nextStates: readonly StudioGpuTileState[]
): readonly StudioGpuTileUpdate[] {
  const previousById = new Map(previousStates.map((state) => [state.id, state]));
  const nextById = new Map(nextStates.map((state) => [state.id, state]));
  const ids = new Set([...previousById.keys(), ...nextById.keys()]);
  return [...ids]
    .map((id): StudioGpuTileUpdate => {
      const previous = previousById.get(id);
      const next = nextById.get(id);
      const previousOperations = previous?.operations ?? [];
      const nextOperations = next?.operations ?? [];
      const tile = next ?? previous;
      if (!tile) throw new Error(`Missing tile state for ${id}`);
      const contractMatches = Boolean(previous && next && sameTileContract(previous, next));
      if (contractMatches && sameSequence(previousOperations, nextOperations)) {
        return {
          tile,
          mode: "clean",
          operations: [],
          previousOperationCount: previousOperations.length,
          nextOperationCount: nextOperations.length,
        };
      }
      const strokeExtension = contractMatches
        ? terminalStrokeExtension(previousOperations, nextOperations)
        : null;
      if (strokeExtension) {
        return {
          tile,
          mode: "append",
          operations: [strokeExtension.next],
          previousOperationCount: previousOperations.length,
          nextOperationCount: nextOperations.length,
          strokeExtension,
        };
      }
      if (
        (contractMatches || (!previous && Boolean(next)))
        && isStrictSequencePrefix(previousOperations, nextOperations)
      ) {
        return {
          tile,
          mode: "append",
          operations: nextOperations.slice(previousOperations.length),
          previousOperationCount: previousOperations.length,
          nextOperationCount: nextOperations.length,
        };
      }
      return {
        tile,
        mode: "rebuild",
        operations: nextOperations,
        previousOperationCount: previousOperations.length,
        nextOperationCount: nextOperations.length,
      };
    })
    .sort((left, right) => left.tile.row - right.tile.row || left.tile.column - right.tile.column);
}
