/**
 * Sketchpad-class specialty planners (clean-room, Sketch.io-inspired).
 *
 * Sketchpad's public kit highlights Tile, Mirror, soft markers and stamp-like tools.
 * This module owns pure, deterministic geometry only:
 *
 * - tile: path stations snapped to a regular spacing lattice so each deposit reads as a tile
 * - mirror: every sample is paired with its vertical (or horizontal) reflection
 * - soft-marker: pressure curves for a smooth consumer soft-pen feel
 *
 * No proprietary assets or Sketchpad source are copied. Callers supply centres and widths from
 * the product document so live/commit/SVG can share the same numbers.
 */

export const STUDIO_SKETCHPAD_SPECIALTY_VERSION =
  "sketchpad-specialty-v1" as const;

export const STUDIO_SKETCHPAD_SPECIALTY_BRUSH_IDS = Object.freeze([
  "sketchpad-tile",
  "sketchpad-mirror",
  "sketchpad-soft-marker",
] as const);

export type StudioSketchpadSpecialtyBrushId =
  (typeof STUDIO_SKETCHPAD_SPECIALTY_BRUSH_IDS)[number];

export function isStudioSketchpadSpecialtyBrushId(
  value: unknown,
): value is StudioSketchpadSpecialtyBrushId {
  return typeof value === "string"
    && (STUDIO_SKETCHPAD_SPECIALTY_BRUSH_IDS as readonly string[]).includes(value);
}

export interface StudioSketchpadPoint {
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;
  readonly t?: number;
}

export interface StudioSketchpadTileSpec {
  /** Nominal tile pitch in document units (≈ tip diameter). */
  readonly tileSize: number;
  /** 0..0.45 gap as a fraction of tileSize between neighbouring tiles. */
  readonly gapRatio: number;
  /** Snap stamp angle to 90° lattice when true. */
  readonly snapAngle: boolean;
}

export interface StudioSketchpadMirrorSpec {
  readonly axis: "vertical" | "horizontal";
  readonly centerX: number;
  readonly centerY: number;
}

export interface StudioSketchpadTileStation {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly angleRadians: number;
  readonly pressure: number;
  readonly index: number;
}

export const DEFAULT_STUDIO_SKETCHPAD_TILE_SPEC: StudioSketchpadTileSpec =
  Object.freeze({
    tileSize: 18,
    gapRatio: 0.08,
    snapAngle: true,
  });

export const DEFAULT_STUDIO_SKETCHPAD_MIRROR_SPEC: StudioSketchpadMirrorSpec =
  Object.freeze({
    axis: "vertical",
    centerX: 400,
    centerY: 600,
  });

const POINT_EPS = 1e-6;
const COORD_LIMIT = 1_000_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function quantize(value: number): number {
  return Math.round(clamp(value, -COORD_LIMIT, COORD_LIMIT) * 10_000) / 10_000;
}

function normalizeTileSpec(
  partial?: Partial<StudioSketchpadTileSpec>,
): StudioSketchpadTileSpec {
  const base = DEFAULT_STUDIO_SKETCHPAD_TILE_SPEC;
  return Object.freeze({
    tileSize: clamp(finite(partial?.tileSize, base.tileSize), 2, 512),
    gapRatio: clamp(finite(partial?.gapRatio, base.gapRatio), 0, 0.45),
    snapAngle: partial?.snapAngle ?? base.snapAngle,
  });
}

function normalizeMirrorSpec(
  partial?: Partial<StudioSketchpadMirrorSpec>,
): StudioSketchpadMirrorSpec {
  const base = DEFAULT_STUDIO_SKETCHPAD_MIRROR_SPEC;
  return Object.freeze({
    axis: partial?.axis === "horizontal" ? "horizontal" : "vertical",
    centerX: finite(partial?.centerX, base.centerX),
    centerY: finite(partial?.centerY, base.centerY),
  });
}

/**
 * Soft consumer-marker response used by `sketchpad-soft-marker`.
 * Light pressure keeps a readable core; heavy pressure opens a wide soft envelope.
 */
export function studioSketchpadSoftMarkerPressureScale(pressure: number): {
  readonly widthScale: number;
  readonly opacityScale: number;
  readonly flowScale: number;
} {
  const p = clamp01(finite(pressure, 0.55));
  const feel = p ** 0.78;
  return Object.freeze({
    widthScale: quantize(0.42 + feel * 0.92),
    opacityScale: quantize(0.38 + feel * 0.58),
    flowScale: quantize(0.48 + feel * 0.5),
  });
}

/**
 * Places non-overlapping tile centres along a freehand path.
 * Spacing is tileSize · (1 + gapRatio) so stamps read as discrete tiles, not a ribbon smear.
 */
export function planStudioSketchpadTileStations(
  path: readonly StudioSketchpadPoint[],
  partialSpec?: Partial<StudioSketchpadTileSpec>,
): readonly StudioSketchpadTileStation[] {
  if (!Array.isArray(path) || path.length === 0) return Object.freeze([]);
  const spec = normalizeTileSpec(partialSpec);
  const pitch = Math.max(2, spec.tileSize * (1 + spec.gapRatio));
  const stations: StudioSketchpadTileStation[] = [];
  let previous = path[0]!;
  let carry = 0;
  let index = 0;

  const pushStation = (
    x: number,
    y: number,
    pressure: number,
    angleRadians: number,
  ) => {
    const snappedAngle = spec.snapAngle
      ? Math.round(angleRadians / (Math.PI / 2)) * (Math.PI / 2)
      : angleRadians;
    const scale = 0.72 + clamp01(pressure) * 0.38;
    stations.push(Object.freeze({
      x: quantize(x),
      y: quantize(y),
      size: quantize(spec.tileSize * scale),
      angleRadians: quantize(snappedAngle),
      pressure: clamp01(pressure),
      index,
    }));
    index += 1;
  };

  pushStation(
    previous.x,
    previous.y,
    previous.pressure ?? 0.55,
    0,
  );

  for (let i = 1; i < path.length; i += 1) {
    const current = path[i]!;
    let dx = current.x - previous.x;
    let dy = current.y - previous.y;
    const segment = Math.hypot(dx, dy);
    if (!(segment > POINT_EPS)) {
      previous = current;
      continue;
    }
    dx /= segment;
    dy /= segment;
    let remaining = segment + carry;
    let cursor = -carry;
    while (remaining + POINT_EPS >= pitch) {
      cursor += pitch;
      const x = previous.x + dx * cursor;
      const y = previous.y + dy * cursor;
      const t = clamp01(cursor / segment);
      const pressure = (previous.pressure ?? 0.55) * (1 - t)
        + (current.pressure ?? 0.55) * t;
      pushStation(x, y, pressure, Math.atan2(dy, dx));
      remaining -= pitch;
    }
    carry = remaining;
    previous = current;
  }

  return Object.freeze(stations);
}

/** Reflect one sample across the configured mirror axis. */
export function mirrorStudioSketchpadSample(
  sample: StudioSketchpadPoint,
  partialSpec?: Partial<StudioSketchpadMirrorSpec>,
): StudioSketchpadPoint {
  const spec = normalizeMirrorSpec(partialSpec);
  if (spec.axis === "horizontal") {
    return Object.freeze({
      x: quantize(sample.x),
      y: quantize(spec.centerY * 2 - sample.y),
      pressure: sample.pressure,
      t: sample.t,
    });
  }
  return Object.freeze({
    x: quantize(spec.centerX * 2 - sample.x),
    y: quantize(sample.y),
    pressure: sample.pressure,
    t: sample.t,
  });
}

/**
 * Expands a freehand path into primary + mirror pairs.
 * Order is primary₀, mirror₀, primary₁, mirror₁, … so causal prefixes stay nested.
 */
export function expandStudioSketchpadMirrorPath(
  path: readonly StudioSketchpadPoint[],
  partialSpec?: Partial<StudioSketchpadMirrorSpec>,
): readonly StudioSketchpadPoint[] {
  if (!Array.isArray(path) || path.length === 0) return Object.freeze([]);
  const out: StudioSketchpadPoint[] = [];
  for (const sample of path) {
    out.push(Object.freeze({
      x: quantize(sample.x),
      y: quantize(sample.y),
      pressure: sample.pressure,
      t: sample.t,
    }));
    out.push(mirrorStudioSketchpadSample(sample, partialSpec));
  }
  return Object.freeze(out);
}

/**
 * Symmetry helper for product wiring: sketchpad-mirror strokes default to vertical mirror
 * through the document centre when no explicit symmetry mode is active.
 */
export function resolveStudioSketchpadBrushSymmetryHint(
  brushId: unknown,
): Readonly<{ type: "vertical" } | null> {
  return brushId === "sketchpad-mirror"
    ? Object.freeze({ type: "vertical" as const })
    : null;
}
