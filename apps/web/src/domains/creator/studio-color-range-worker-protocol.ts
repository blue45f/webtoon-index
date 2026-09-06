import { MAGIC_WAND_TRACE_MAX_DIM } from "./studio-magic-wand";

import type { ColorRangeSample } from "./studio-color-range";
import type {
  PixelSelection,
  SelectionCombineMode,
} from "./studio-selection-tools";

export const STUDIO_COLOR_RANGE_WORKER_PROTOCOL_VERSION = 1 as const;

/** The browser capture path never exceeds the magic-wand trace raster. */
export const STUDIO_COLOR_RANGE_WORKER_MAX_PIXELS =
  MAGIC_WAND_TRACE_MAX_DIM * MAGIC_WAND_TRACE_MAX_DIM;

/**
 * A Worker response crosses a trust boundary even though the emitted module is same-origin:
 * stale cached chunks and protocol regressions must not be able to inject an unbounded selection
 * graph into React/Konva state.
 */
export const STUDIO_COLOR_RANGE_WORKER_MAX_SUBPATHS = 128;
export const STUDIO_COLOR_RANGE_WORKER_MAX_POINTS_PER_SUBPATH = 4_096;
export const STUDIO_COLOR_RANGE_WORKER_MAX_POINTS = 8_192;
export const STUDIO_COLOR_RANGE_WORKER_MAX_FEATHER_PX = 60;
export const STUDIO_COLOR_RANGE_WORKER_MAX_BRUSH_RADIUS = 4;
const STUDIO_COLOR_RANGE_WORKER_POINT_MIN = -0.25;
const STUDIO_COLOR_RANGE_WORKER_POINT_MAX = 1.25;

export interface StudioColorRangeWorkerRunRequest {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly samples: readonly ColorRangeSample[];
  readonly fuzziness: number;
  readonly antiAlias?: boolean;
  readonly flipX?: boolean;
  readonly flipY?: boolean;
  readonly selection: PixelSelection | null;
  readonly combineMode: SelectionCombineMode;
  readonly aspect?: number;
}

export interface StudioColorRangeWorkerRunMessage {
  type: "studio-color-range/run";
  version: typeof STUDIO_COLOR_RANGE_WORKER_PROTOCOL_VERSION;
  requestId: number;
  request: StudioColorRangeWorkerRunRequest;
}

export interface StudioColorRangeWorkerReadyMessage {
  type: "studio-color-range/ready";
  version: typeof STUDIO_COLOR_RANGE_WORKER_PROTOCOL_VERSION;
}

export interface StudioColorRangeWorkerSuccessMessage {
  type: "studio-color-range/success";
  version: typeof STUDIO_COLOR_RANGE_WORKER_PROTOCOL_VERSION;
  requestId: number;
  selection: PixelSelection | null;
}

export interface StudioColorRangeWorkerFailureMessage {
  type: "studio-color-range/failure";
  version: typeof STUDIO_COLOR_RANGE_WORKER_PROTOCOL_VERSION;
  requestId: number;
  error: {
    name: string;
    message: string;
  };
}

export type StudioColorRangeWorkerResponseMessage =
  | StudioColorRangeWorkerReadyMessage
  | StudioColorRangeWorkerSuccessMessage
  | StudioColorRangeWorkerFailureMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isSelectionCombineMode(value: unknown): value is SelectionCombineMode {
  return value === "add" || value === "subtract" || value === "intersect";
}

function isBoundedSelectionPoint(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const { x, y } = value;
  return (
    typeof x === "number"
    && Number.isFinite(x)
    && x >= STUDIO_COLOR_RANGE_WORKER_POINT_MIN
    && x <= STUDIO_COLOR_RANGE_WORKER_POINT_MAX
    && typeof y === "number"
    && Number.isFinite(y)
    && y >= STUDIO_COLOR_RANGE_WORKER_POINT_MIN
    && y <= STUDIO_COLOR_RANGE_WORKER_POINT_MAX
  );
}

/**
 * Strictly validates clone data returned by the color-range Worker.
 *
 * This intentionally rejects instead of normalizing. Silently sampling or clamping a malformed
 * success response would turn a Worker/version fault into a different visible selection.
 */
export function isStudioColorRangeWorkerSelection(
  value: unknown,
): value is PixelSelection | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  const { subpaths, featherPx, invert } = value;
  if (
    !Array.isArray(subpaths)
    || subpaths.length > STUDIO_COLOR_RANGE_WORKER_MAX_SUBPATHS
    || typeof featherPx !== "number"
    || !Number.isFinite(featherPx)
    || featherPx < 0
    || featherPx > STUDIO_COLOR_RANGE_WORKER_MAX_FEATHER_PX
    || typeof invert !== "boolean"
  ) {
    return false;
  }

  let totalPoints = 0;
  for (const subpath of subpaths) {
    if (!isRecord(subpath) || !isSelectionCombineMode(subpath.mode)) return false;
    const points = subpath.points;
    if (
      !Array.isArray(points)
      || points.length > STUDIO_COLOR_RANGE_WORKER_MAX_POINTS_PER_SUBPATH
    ) {
      return false;
    }
    totalPoints += points.length;
    if (totalPoints > STUDIO_COLOR_RANGE_WORKER_MAX_POINTS) return false;
    if (!points.every(isBoundedSelectionPoint)) return false;

    if (subpath.kind === "brush") {
      if (
        points.length < 1
        || typeof subpath.radius !== "number"
        || !Number.isFinite(subpath.radius)
        || subpath.radius <= 0
        || subpath.radius > STUDIO_COLOR_RANGE_WORKER_MAX_BRUSH_RADIUS
      ) {
        return false;
      }
      continue;
    }
    if (subpath.kind !== undefined || points.length < 3) return false;
  }
  return true;
}

/**
 * Color Range consumes the captured scan raster. The result is vector selection data, so the
 * input ArrayBuffer only travels main → Worker and never needs to be copied back.
 */
export function studioColorRangeRequestTransfers(
  message: StudioColorRangeWorkerRunMessage,
): Transferable[] {
  const buffer = message.request.data.buffer;
  return buffer instanceof ArrayBuffer ? [buffer] : [];
}
