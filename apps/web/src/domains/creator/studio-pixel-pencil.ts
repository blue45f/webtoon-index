/**
 * Versioned, renderer-neutral pixel-pencil geometry.
 *
 * A pixel-pencil stroke is a union of integer document cells, not a one-pixel-wide vector path.
 * Keeping that distinction in the model lets Canvas (`fillRect`), SVG (`<rect>`/path), and WebGPU
 * (instance/storage buffers) replay exactly the same hard-edged result.
 */

export const STUDIO_PIXEL_PENCIL_RENDER_MODE = "pixel-grid-v1" as const;
export type StudioPixelPencilRenderMode = typeof STUDIO_PIXEL_PENCIL_RENDER_MODE;

export const STUDIO_PIXEL_PENCIL_DEFAULT_MAX_CELLS = 100_000;
export const STUDIO_PIXEL_PENCIL_HARD_MAX_CELLS = 1_000_000;
export const STUDIO_PIXEL_PENCIL_DEFAULT_MAX_POINT_PAIRS = 100_000;
export const STUDIO_PIXEL_PENCIL_HARD_MAX_POINT_PAIRS = 1_000_000;
export const STUDIO_PIXEL_PENCIL_DEFAULT_MAX_CELL_VISITS = 400_000;
export const STUDIO_PIXEL_PENCIL_HARD_MAX_CELL_VISITS = 4_000_000;

/**
 * Integer document coordinates are kept inside float32's exact integer range so a WebGPU consumer
 * can upload the cell list without moving a pixel. This is also far beyond the Studio page budget.
 */
export const STUDIO_PIXEL_PENCIL_MAX_ABS_CELL = 16_777_215;

export interface StudioPixelPencilCell {
  readonly x: number;
  readonly y: number;
}

export type StudioPixelPencilPlanReason =
  | "invalid-points"
  | "invalid-coordinate"
  | "coordinate-out-of-range"
  | "invalid-limits"
  | "point-budget-exceeded"
  | "cell-budget-exceeded"
  | "work-budget-exceeded";

export interface StudioPixelPencilPlan {
  readonly mode: StudioPixelPencilRenderMode;
  /** Unique cells in deterministic first-visit order. */
  readonly cells: readonly StudioPixelPencilCell[];
  readonly complete: boolean;
  readonly reason: StudioPixelPencilPlanReason | null;
  /** Number of validated source coordinate pairs (before adjacent-cell coalescing). */
  readonly sourcePointPairs: number;
  /** Bresenham cells visited, including cells later removed as duplicates. */
  readonly cellVisits: number;
}

export interface StudioPixelPencilPlanInput {
  /** Flat document-coordinate pairs. Plain arrays and numeric typed arrays are accepted. */
  readonly points: unknown;
  readonly strokeWidth?: number;
  readonly maximumCells?: number;
  readonly maximumPointPairs?: number;
  readonly maximumCellVisits?: number;
}

/** Structural subset shared by CanvasRenderingContext2D and Konva.Context. */
export interface StudioPixelPencilFillRectContext {
  fillRect(x: number, y: number, width: number, height: number): void;
}

interface StudioPixelPencilLimits {
  readonly maximumCells: number;
  readonly maximumPointPairs: number;
  readonly maximumCellVisits: number;
}

interface NormalizedPointSource {
  readonly length: number;
  readonly at: (index: number) => unknown;
}

export function isStudioPixelPencilRenderMode(
  value: unknown
): value is StudioPixelPencilRenderMode {
  return value === STUDIO_PIXEL_PENCIL_RENDER_MODE;
}

function normalizeLimit(
  value: number | undefined,
  fallback: number,
  hardMaximum: number
): number | null {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return Math.min(value, hardMaximum);
}

function normalizeLimits(input: StudioPixelPencilPlanInput): StudioPixelPencilLimits | null {
  const maximumCells = normalizeLimit(
    input.maximumCells,
    STUDIO_PIXEL_PENCIL_DEFAULT_MAX_CELLS,
    STUDIO_PIXEL_PENCIL_HARD_MAX_CELLS
  );
  const maximumPointPairs = normalizeLimit(
    input.maximumPointPairs,
    STUDIO_PIXEL_PENCIL_DEFAULT_MAX_POINT_PAIRS,
    STUDIO_PIXEL_PENCIL_HARD_MAX_POINT_PAIRS
  );
  const maximumCellVisits = normalizeLimit(
    input.maximumCellVisits,
    STUDIO_PIXEL_PENCIL_DEFAULT_MAX_CELL_VISITS,
    STUDIO_PIXEL_PENCIL_HARD_MAX_CELL_VISITS
  );
  return maximumCells === null || maximumPointPairs === null || maximumCellVisits === null
    ? null
    : { maximumCells, maximumPointPairs, maximumCellVisits };
}

function normalizePointSource(value: unknown): NormalizedPointSource | null {
  if (Array.isArray(value)) {
    return { length: value.length, at: (index) => value[index] };
  }
  if (
    value instanceof Float32Array
    || value instanceof Float64Array
    || value instanceof Int8Array
    || value instanceof Uint8Array
    || value instanceof Uint8ClampedArray
    || value instanceof Int16Array
    || value instanceof Uint16Array
    || value instanceof Int32Array
    || value instanceof Uint32Array
  ) {
    return { length: value.length, at: (index) => value[index] };
  }
  return null;
}

function emptyPlan(
  reason: StudioPixelPencilPlanReason | null,
  sourcePointPairs = 0
): StudioPixelPencilPlan {
  return {
    mode: STUDIO_PIXEL_PENCIL_RENDER_MODE,
    cells: [],
    complete: reason === null,
    reason,
    sourcePointPairs,
    cellVisits: 0,
  };
}

function documentCoordinateToCell(
  value: unknown
): { readonly cell: number } | { readonly reason: "invalid-coordinate" | "coordinate-out-of-range" } {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { reason: "invalid-coordinate" };
  }
  const floored = Math.floor(value);
  const cell = Object.is(floored, -0) ? 0 : floored;
  if (!Number.isSafeInteger(cell) || Math.abs(cell) > STUDIO_PIXEL_PENCIL_MAX_ABS_CELL) {
    return { reason: "coordinate-out-of-range" };
  }
  return { cell };
}

/** Resolves one document position to its authoritative hard-edged pixel cell. */
export function studioPixelPencilCellAt(
  x: unknown,
  y: unknown
): StudioPixelPencilCell | null {
  const cellX = documentCoordinateToCell(x);
  const cellY = documentCoordinateToCell(y);
  return "cell" in cellX && "cell" in cellY
    ? { x: cellX.cell, y: cellY.cell }
    : null;
}

/**
 * Pixel input is accepted when it crosses a cell boundary, even if the physical move is shorter
 * than one document unit. A distance-only filter would lose short edge crossings at pointer-up.
 */
export function shouldAppendStudioPixelPencilSample(input: {
  readonly lastX: unknown;
  readonly lastY: unknown;
  readonly nextX: unknown;
  readonly nextY: unknown;
}): boolean {
  const previous = studioPixelPencilCellAt(input.lastX, input.lastY);
  const next = studioPixelPencilCellAt(input.nextX, input.nextY);
  return previous !== null
    && next !== null
    && (previous.x !== next.x || previous.y !== next.y);
}

function cellKey(cell: StudioPixelPencilCell): number {
  const span = STUDIO_PIXEL_PENCIL_MAX_ABS_CELL * 2 + 1;
  return (cell.x + STUDIO_PIXEL_PENCIL_MAX_ABS_CELL) * span
    + cell.y + STUDIO_PIXEL_PENCIL_MAX_ABS_CELL;
}

/**
 * Visits a conventional one-cell-weight Bresenham line, including both endpoints.
 *
 * Pixel pencils conventionally use 8-connected diagonals rather than supercover's two-cell-wide
 * corner crossings. This fills pointer-sample gaps while preserving a genuinely 1px staircase.
 */
function visitBresenhamCells(
  start: StudioPixelPencilCell,
  end: StudioPixelPencilCell,
  visit: (cell: StudioPixelPencilCell) => boolean
): boolean {
  let x = start.x;
  let y = start.y;
  const dx = Math.abs(end.x - start.x);
  const sx = start.x < end.x ? 1 : -1;
  const dy = -Math.abs(end.y - start.y);
  const sy = start.y < end.y ? 1 : -1;
  let error = dx + dy;

  for (;;) {
    if (!visit({ x, y })) return false;
    if (x === end.x && y === end.y) return true;
    const doubledError = error * 2;
    if (doubledError >= dy) {
      error += dy;
      x += sx;
    }
    if (doubledError <= dx) {
      error += dx;
      y += sy;
    }
  }
}

/**
 * Converts raw document-coordinate samples into a deterministic, globally de-duplicated cell list.
 * Invalid input fails closed with no partial geometry. Budget exhaustion returns the safe prefix and
 * `complete: false`, allowing every renderer to reject or explicitly mark a truncated result.
 */
export function planStudioPixelPencilCells(
  input: StudioPixelPencilPlanInput
): StudioPixelPencilPlan {
  const limits = normalizeLimits(input);
  if (!limits) return emptyPlan("invalid-limits");

  const source = normalizePointSource(input.points);
  if (!source || source.length % 2 !== 0) return emptyPlan("invalid-points");
  const sourcePointPairs = source.length / 2;
  if (sourcePointPairs > limits.maximumPointPairs) {
    return emptyPlan("point-budget-exceeded", sourcePointPairs);
  }
  if (sourcePointPairs === 0) return emptyPlan(null);

  // Validate the whole source before producing cells so a malformed persisted stroke cannot expose
  // a convincing but incomplete prefix. Adjacent samples inside one cell are coalesced up front.
  const vertices: StudioPixelPencilCell[] = [];
  for (let index = 0; index < source.length; index += 2) {
    const x = documentCoordinateToCell(source.at(index));
    const y = documentCoordinateToCell(source.at(index + 1));
    if ("reason" in x) return emptyPlan(x.reason, sourcePointPairs);
    if ("reason" in y) return emptyPlan(y.reason, sourcePointPairs);
    const previous = vertices[vertices.length - 1];
    if (!previous || previous.x !== x.cell || previous.y !== y.cell) {
      vertices.push({ x: x.cell, y: y.cell });
    }
  }

  const cells: StudioPixelPencilCell[] = [];
  const seen = new Set<number>();
  let cellVisits = 0;
  let reason: StudioPixelPencilPlanReason | null = null;
  const visit = (cell: StudioPixelPencilCell): boolean => {
    if (cellVisits >= limits.maximumCellVisits) {
      reason = "work-budget-exceeded";
      return false;
    }
    cellVisits += 1;
    const key = cellKey(cell);
    if (seen.has(key)) return true;
    if (cells.length >= limits.maximumCells) {
      reason = "cell-budget-exceeded";
      return false;
    }
    seen.add(key);
    cells.push(cell);
    return true;
  };

  const width = Math.max(1, Math.round(input.strokeWidth ?? 1));
  const radius = Math.floor(width / 2);
  const isEven = width % 2 === 0;

  const visitStampedCell = (center: StudioPixelPencilCell): boolean => {
    if (width <= 1) return visit(center);
    const radiusSq = (width / 2) * (width / 2);
    for (let dy = -radius; dy <= (isEven ? radius - 1 : radius); dy++) {
      for (let dx = -radius; dx <= (isEven ? radius - 1 : radius); dx++) {
        // Circle constraint for widths >= 3 to maintain smooth round pixel tips
        if (width >= 3 && dx * dx + dy * dy > radiusSq + 0.25) continue;
        if (!visit({ x: center.x + dx, y: center.y + dy })) return false;
      }
    }
    return true;
  };

  if (vertices.length === 1) {
    visitStampedCell(vertices[0]!);
  } else {
    for (let index = 1; index < vertices.length; index += 1) {
      if (!visitBresenhamCells(vertices[index - 1]!, vertices[index]!, visitStampedCell)) break;
    }
  }

  return {
    mode: STUDIO_PIXEL_PENCIL_RENDER_MODE,
    cells,
    complete: reason === null,
    reason,
    sourcePointPairs,
    cellVisits,
  };
}

/** Paints one hard document pixel per planned cell without introducing path antialiasing. */
export function fillStudioPixelPencilCells(
  context: StudioPixelPencilFillRectContext,
  cells: readonly StudioPixelPencilCell[]
): void {
  for (const cell of cells) context.fillRect(cell.x, cell.y, 1, 1);
}

/** Interleaved signed coordinates suitable for a WebGPU storage/instance buffer. */
export function packStudioPixelPencilCells(
  cells: readonly StudioPixelPencilCell[]
): Int32Array {
  const packed = new Int32Array(cells.length * 2);
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index]!;
    packed[index * 2] = cell.x;
    packed[index * 2 + 1] = cell.y;
  }
  return packed;
}
