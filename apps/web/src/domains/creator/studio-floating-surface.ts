/**
 * Pure geometry and durable placement model for Studio floating surfaces.
 *
 * Positions are stored as ratios of the available viewport travel instead of raw pixels. A layout
 * therefore survives monitor, browser-zoom, and panel-size changes without restoring off screen.
 * The view layer owns pointer sessions; this module only normalizes and resolves deterministic
 * geometry.
 */

export const STUDIO_FLOATING_SURFACE_LAYOUT_VERSION = 2 as const;
export const STUDIO_FLOATING_SURFACE_LEGACY_LAYOUT_VERSION = 1 as const;
export const STUDIO_FLOATING_SURFACE_MAX_DIMENSION = 8_192;

export const STUDIO_FLOATING_SURFACE_DOCKS = [
  "free",
  "left",
  "right",
  "top",
  "bottom",
] as const;
export const STUDIO_FLOATING_SURFACE_RESIZE_EDGES = [
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
  "nw",
] as const;

export type StudioFloatingSurfaceDock =
  (typeof STUDIO_FLOATING_SURFACE_DOCKS)[number];
export type StudioFloatingSurfaceResizeEdge =
  (typeof STUDIO_FLOATING_SURFACE_RESIZE_EDGES)[number];
export type StudioFloatingSurfaceLockKind = "position" | "size";

export interface StudioFloatingSurfaceLayout {
  readonly version: typeof STUDIO_FLOATING_SURFACE_LAYOUT_VERSION;
  readonly xRatio: number;
  readonly yRatio: number;
  readonly width: number;
  readonly height: number;
  /** `free` keeps both ratios; an edge dock stays attached across viewport changes. */
  readonly dock: StudioFloatingSurfaceDock;
  readonly positionLocked: boolean;
  readonly sizeLocked: boolean;
}

export interface StudioFloatingSurfaceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioFloatingSurfaceViewport {
  readonly width: number;
  readonly height: number;
  readonly insetTop?: number;
  readonly insetRight?: number;
  readonly insetBottom?: number;
  readonly insetLeft?: number;
}

export interface StudioFloatingSurfaceConstraints {
  readonly minWidth: number;
  readonly minHeight: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly snapDistance?: number;
}

export interface StudioFloatingSurfaceLayoutOptions {
  readonly dock?: StudioFloatingSurfaceDock;
  readonly positionLocked?: boolean;
  readonly sizeLocked?: boolean;
}

interface StudioFloatingSurfaceBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

const DOCK_SET = new Set<string>(STUDIO_FLOATING_SURFACE_DOCKS);
const RESIZE_EDGE_SET = new Set<string>(STUDIO_FLOATING_SURFACE_RESIZE_EDGES);

const DEFAULT_LAYOUT: StudioFloatingSurfaceLayout = Object.freeze({
  version: STUDIO_FLOATING_SURFACE_LAYOUT_VERSION,
  xRatio: 1,
  yRatio: 0,
  width: 336,
  height: 720,
  dock: "free",
  positionLocked: false,
  sizeLocked: false,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOwn(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundedRatio(value: number): number {
  return Math.round(clamp(value, 0, 1) * 10_000) / 10_000;
}

function normalizeDock(
  value: unknown,
  fallback: StudioFloatingSurfaceDock,
): StudioFloatingSurfaceDock {
  return typeof value === "string" && DOCK_SET.has(value)
    ? value as StudioFloatingSurfaceDock
    : fallback;
}

function normalizeResizeEdge(
  value: unknown,
): StudioFloatingSurfaceResizeEdge {
  return typeof value === "string" && RESIZE_EDGE_SET.has(value)
    ? value as StudioFloatingSurfaceResizeEdge
    : "se";
}

function freezeLayout(layout: StudioFloatingSurfaceLayout): StudioFloatingSurfaceLayout {
  return Object.freeze({
    version: STUDIO_FLOATING_SURFACE_LAYOUT_VERSION,
    xRatio: roundedRatio(layout.xRatio),
    yRatio: roundedRatio(layout.yRatio),
    width: Math.round(clamp(layout.width, 1, STUDIO_FLOATING_SURFACE_MAX_DIMENSION)),
    height: Math.round(clamp(layout.height, 1, STUDIO_FLOATING_SURFACE_MAX_DIMENSION)),
    dock: normalizeDock(layout.dock, "free"),
    positionLocked: layout.positionLocked === true,
    sizeLocked: layout.sizeLocked === true,
  });
}

/**
 * Rebuilds the exact v2 allowlist and bounds hostile or stale persisted values. A v1 rectangle is
 * migrated in place as a free, unlocked surface so existing same-tab placements are retained.
 */
export function normalizeStudioFloatingSurfaceLayout(
  raw: unknown,
  fallback: StudioFloatingSurfaceLayout = DEFAULT_LAYOUT,
): StudioFloatingSurfaceLayout {
  const safeFallback = freezeLayout(fallback);
  try {
    if (!isRecord(raw)) return safeFallback;
    const version = readOwn(raw, "version");
    if (
      version !== STUDIO_FLOATING_SURFACE_LEGACY_LAYOUT_VERSION
      && version !== STUDIO_FLOATING_SURFACE_LAYOUT_VERSION
    ) {
      return safeFallback;
    }
    const legacy = version === STUDIO_FLOATING_SURFACE_LEGACY_LAYOUT_VERSION;
    return freezeLayout({
      version: STUDIO_FLOATING_SURFACE_LAYOUT_VERSION,
      xRatio: finite(readOwn(raw, "xRatio"), safeFallback.xRatio),
      yRatio: finite(readOwn(raw, "yRatio"), safeFallback.yRatio),
      width: finite(readOwn(raw, "width"), safeFallback.width),
      height: finite(readOwn(raw, "height"), safeFallback.height),
      dock: legacy
        ? "free"
        : normalizeDock(readOwn(raw, "dock"), safeFallback.dock),
      positionLocked: legacy
        ? false
        : readOwn(raw, "positionLocked") === true,
      sizeLocked: legacy
        ? false
        : readOwn(raw, "sizeLocked") === true,
    });
  } catch {
    return safeFallback;
  }
}

function resolveBounds(
  viewport: StudioFloatingSurfaceViewport,
): StudioFloatingSurfaceBounds {
  const viewportWidth = Math.max(1, finite(viewport.width, 1));
  const viewportHeight = Math.max(1, finite(viewport.height, 1));
  const left = clamp(finite(viewport.insetLeft, 0), 0, viewportWidth - 1);
  const top = clamp(finite(viewport.insetTop, 0), 0, viewportHeight - 1);
  const rightInset = clamp(
    finite(viewport.insetRight, 0),
    0,
    Math.max(0, viewportWidth - left - 1),
  );
  const bottomInset = clamp(
    finite(viewport.insetBottom, 0),
    0,
    Math.max(0, viewportHeight - top - 1),
  );
  const right = Math.max(left + 1, viewportWidth - rightInset);
  const bottom = Math.max(top + 1, viewportHeight - bottomInset);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function resolveDimensionRange(
  available: number,
  minimum: number,
  maximum: number | undefined,
): readonly [number, number] {
  const min = clamp(finite(minimum, 1), 1, available);
  const max = clamp(finite(maximum, available), min, available);
  return [min, max] as const;
}

function constrainRect(
  rect: StudioFloatingSurfaceRect,
  viewport: StudioFloatingSurfaceViewport,
  constraints: StudioFloatingSurfaceConstraints,
): StudioFloatingSurfaceRect {
  const bounds = resolveBounds(viewport);
  const [minWidth, maxWidth] = resolveDimensionRange(
    bounds.width,
    constraints.minWidth,
    constraints.maxWidth,
  );
  const [minHeight, maxHeight] = resolveDimensionRange(
    bounds.height,
    constraints.minHeight,
    constraints.maxHeight,
  );
  const width = Math.round(clamp(finite(rect.width, minWidth), minWidth, maxWidth));
  const height = Math.round(clamp(finite(rect.height, minHeight), minHeight, maxHeight));
  const x = Math.round(clamp(
    finite(rect.x, bounds.left),
    bounds.left,
    bounds.right - width,
  ));
  const y = Math.round(clamp(
    finite(rect.y, bounds.top),
    bounds.top,
    bounds.bottom - height,
  ));
  return { x, y, width, height };
}

function applyDock(
  rect: StudioFloatingSurfaceRect,
  bounds: StudioFloatingSurfaceBounds,
  dock: StudioFloatingSurfaceDock,
): StudioFloatingSurfaceRect {
  switch (dock) {
    case "left":
      return { ...rect, x: bounds.left };
    case "right":
      return { ...rect, x: bounds.right - rect.width };
    case "top":
      return { ...rect, y: bounds.top };
    case "bottom":
      return { ...rect, y: bounds.bottom - rect.height };
    default:
      return rect;
  }
}

/** Resolves a persisted ratio layout into a visible, viewport-safe pixel rectangle. */
export function resolveStudioFloatingSurfaceRect(
  rawLayout: unknown,
  viewport: StudioFloatingSurfaceViewport,
  constraints: StudioFloatingSurfaceConstraints,
  fallback: StudioFloatingSurfaceLayout = DEFAULT_LAYOUT,
): StudioFloatingSurfaceRect {
  const layout = normalizeStudioFloatingSurfaceLayout(rawLayout, fallback);
  const bounds = resolveBounds(viewport);
  const [minWidth, maxWidth] = resolveDimensionRange(
    bounds.width,
    constraints.minWidth,
    constraints.maxWidth,
  );
  const [minHeight, maxHeight] = resolveDimensionRange(
    bounds.height,
    constraints.minHeight,
    constraints.maxHeight,
  );
  const width = Math.round(clamp(layout.width, minWidth, maxWidth));
  const height = Math.round(clamp(layout.height, minHeight, maxHeight));
  const xTravel = Math.max(0, bounds.width - width);
  const yTravel = Math.max(0, bounds.height - height);
  return applyDock({
    x: Math.round(bounds.left + xTravel * layout.xRatio),
    y: Math.round(bounds.top + yTravel * layout.yRatio),
    width,
    height,
  }, bounds, layout.dock);
}

/** Converts a visible rectangle back to the durable ratio representation. */
export function createStudioFloatingSurfaceLayout(
  rawRect: StudioFloatingSurfaceRect,
  viewport: StudioFloatingSurfaceViewport,
  constraints: StudioFloatingSurfaceConstraints,
  options: StudioFloatingSurfaceLayoutOptions = {},
): StudioFloatingSurfaceLayout {
  const bounds = resolveBounds(viewport);
  const dock = normalizeDock(options.dock, "free");
  const rect = applyDock(
    constrainRect(rawRect, viewport, constraints),
    bounds,
    dock,
  );
  const xTravel = Math.max(0, bounds.width - rect.width);
  const yTravel = Math.max(0, bounds.height - rect.height);
  return freezeLayout({
    version: STUDIO_FLOATING_SURFACE_LAYOUT_VERSION,
    xRatio: xTravel > 0 ? (rect.x - bounds.left) / xTravel : 0,
    yRatio: yTravel > 0 ? (rect.y - bounds.top) / yTravel : 0,
    width: rect.width,
    height: rect.height,
    dock,
    positionLocked: options.positionLocked === true,
    sizeLocked: options.sizeLocked === true,
  });
}

function snapRectToBounds(
  rect: StudioFloatingSurfaceRect,
  viewport: StudioFloatingSurfaceViewport,
  snapDistance: number,
): StudioFloatingSurfaceRect {
  const bounds = resolveBounds(viewport);
  const distance = Math.max(0, finite(snapDistance, 0));
  let x = rect.x;
  let y = rect.y;
  if (Math.abs(rect.x - bounds.left) <= distance) x = bounds.left;
  if (Math.abs(rect.x + rect.width - bounds.right) <= distance) {
    x = bounds.right - rect.width;
  }
  if (Math.abs(rect.y - bounds.top) <= distance) y = bounds.top;
  if (Math.abs(rect.y + rect.height - bounds.bottom) <= distance) {
    y = bounds.bottom - rect.height;
  }
  return { ...rect, x, y };
}

/** Moves and optionally edge-snaps a surface while keeping it fully recoverable on screen. */
export function moveStudioFloatingSurfaceRect(
  start: StudioFloatingSurfaceRect,
  deltaX: number,
  deltaY: number,
  viewport: StudioFloatingSurfaceViewport,
  constraints: StudioFloatingSurfaceConstraints,
  snap = false,
): StudioFloatingSurfaceRect {
  const moved = constrainRect({
    ...start,
    x: start.x + finite(deltaX, 0),
    y: start.y + finite(deltaY, 0),
  }, viewport, constraints);
  return snap
    ? snapRectToBounds(moved, viewport, constraints.snapDistance ?? 0)
    : moved;
}

/**
 * Resizes from any edge or corner while keeping the opposite edges anchored and respecting both
 * surface and viewport constraints. This keeps right/bottom-docked panels expandable.
 */
export function resizeStudioFloatingSurfaceRectFromEdge(
  start: StudioFloatingSurfaceRect,
  deltaX: number,
  deltaY: number,
  edge: StudioFloatingSurfaceResizeEdge,
  viewport: StudioFloatingSurfaceViewport,
  constraints: StudioFloatingSurfaceConstraints,
): StudioFloatingSurfaceRect {
  const resolvedEdge = normalizeResizeEdge(edge);
  const bounds = resolveBounds(viewport);
  const [minWidth, maximumWidth] = resolveDimensionRange(
    bounds.width,
    constraints.minWidth,
    constraints.maxWidth,
  );
  const [minHeight, maximumHeight] = resolveDimensionRange(
    bounds.height,
    constraints.minHeight,
    constraints.maxHeight,
  );
  const west = resolvedEdge.includes("w");
  const east = resolvedEdge.includes("e");
  const north = resolvedEdge.includes("n");
  const south = resolvedEdge.includes("s");
  let x = start.x;
  let y = start.y;
  let width = start.width;
  let height = start.height;

  if (west) {
    const right = start.x + start.width;
    width = clamp(
      start.width - finite(deltaX, 0),
      minWidth,
      Math.min(maximumWidth, right - bounds.left),
    );
    x = right - width;
  } else if (east) {
    width = clamp(
      start.width + finite(deltaX, 0),
      minWidth,
      Math.min(maximumWidth, bounds.right - start.x),
    );
  }

  if (north) {
    const bottom = start.y + start.height;
    height = clamp(
      start.height - finite(deltaY, 0),
      minHeight,
      Math.min(maximumHeight, bottom - bounds.top),
    );
    y = bottom - height;
  } else if (south) {
    height = clamp(
      start.height + finite(deltaY, 0),
      minHeight,
      Math.min(maximumHeight, bounds.bottom - start.y),
    );
  }

  return constrainRect({ x, y, width, height }, viewport, constraints);
}

/** Compatibility helper for the original bottom-right resize contract. */
export function resizeStudioFloatingSurfaceRect(
  start: StudioFloatingSurfaceRect,
  deltaWidth: number,
  deltaHeight: number,
  viewport: StudioFloatingSurfaceViewport,
  constraints: StudioFloatingSurfaceConstraints,
): StudioFloatingSurfaceRect {
  return resizeStudioFloatingSurfaceRectFromEdge(
    start,
    deltaWidth,
    deltaHeight,
    "se",
    viewport,
    constraints,
  );
}

/** Returns the nearest safe edge when a committed move lands within the snap threshold. */
export function resolveStudioFloatingSurfaceDock(
  rect: StudioFloatingSurfaceRect,
  viewport: StudioFloatingSurfaceViewport,
  snapDistance: number,
): StudioFloatingSurfaceDock {
  const bounds = resolveBounds(viewport);
  const distance = Math.max(0, finite(snapDistance, 0));
  const candidates: readonly [StudioFloatingSurfaceDock, number, number][] = [
    ["left", Math.abs(rect.x - bounds.left), 0],
    ["right", Math.abs(rect.x + rect.width - bounds.right), 1],
    ["top", Math.abs(rect.y - bounds.top), 2],
    ["bottom", Math.abs(rect.y + rect.height - bounds.bottom), 3],
  ];
  const nearest = [...candidates]
    .filter(([, edgeDistance]) => edgeDistance <= distance)
    .sort((left, right) => left[1] - right[1] || left[2] - right[2])[0];
  return nearest?.[0] ?? "free";
}

export function setStudioFloatingSurfaceDock(
  layout: StudioFloatingSurfaceLayout,
  dock: StudioFloatingSurfaceDock,
): StudioFloatingSurfaceLayout {
  const current = normalizeStudioFloatingSurfaceLayout(layout);
  const nextDock = normalizeDock(dock, current.dock);
  return current.dock === nextDock
    ? current
    : freezeLayout({ ...current, dock: nextDock });
}

export function setStudioFloatingSurfaceLock(
  layout: StudioFloatingSurfaceLayout,
  kind: StudioFloatingSurfaceLockKind,
  locked: boolean,
): StudioFloatingSurfaceLayout {
  const current = normalizeStudioFloatingSurfaceLayout(layout);
  if (kind === "position") {
    return current.positionLocked === locked
      ? current
      : freezeLayout({ ...current, positionLocked: locked });
  }
  if (kind === "size") {
    return current.sizeLocked === locked
      ? current
      : freezeLayout({ ...current, sizeLocked: locked });
  }
  return current;
}

export function studioFloatingSurfaceLayoutsEqual(
  left: StudioFloatingSurfaceLayout | undefined,
  right: StudioFloatingSurfaceLayout | undefined,
): boolean {
  return left === right || (
    left !== undefined
    && right !== undefined
    && left.version === right.version
    && left.xRatio === right.xRatio
    && left.yRatio === right.yRatio
    && left.width === right.width
    && left.height === right.height
    && left.dock === right.dock
    && left.positionLocked === right.positionLocked
    && left.sizeLocked === right.sizeLocked
  );
}

export interface StudioFloatingSurfaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export const STUDIO_FLOATING_SURFACE_MAX_SERIALIZED_LENGTH = 4_096;

/** Reads one bounded UI-only layout. Invalid values recover without mutating storage. */
export function loadStudioFloatingSurfaceLayout(
  storage: StudioFloatingSurfaceStorage | null | undefined,
  key: string,
  fallback: StudioFloatingSurfaceLayout = DEFAULT_LAYOUT,
): StudioFloatingSurfaceLayout {
  if (!storage || !key || key.length > 256) {
    return normalizeStudioFloatingSurfaceLayout(undefined, fallback);
  }
  try {
    const raw = storage.getItem(key);
    if (
      raw === null
      || raw.length === 0
      || raw.length > STUDIO_FLOATING_SURFACE_MAX_SERIALIZED_LENGTH
    ) {
      return normalizeStudioFloatingSurfaceLayout(undefined, fallback);
    }
    return normalizeStudioFloatingSurfaceLayout(JSON.parse(raw), fallback);
  } catch {
    return normalizeStudioFloatingSurfaceLayout(undefined, fallback);
  }
}

/**
 * Serializes the normalized **exact allowlist**, never the caller's object, so a stray field can
 * never reach a store.
 *
 * Exported because there are two stores. This module's synchronous storage and the SQLite/OPFS
 * repository each wrote this list out by hand; the copies happened to agree, but nothing held them
 * in step, and the next field added to the layout would have reached one and not the other. That
 * is the shape of the bug that already lost `dock` once.
 */
export function encodeStudioFloatingSurfaceLayout(
  layout: StudioFloatingSurfaceLayout,
): string {
  const normalized = normalizeStudioFloatingSurfaceLayout(layout);
  return JSON.stringify({
    version: normalized.version,
    xRatio: normalized.xRatio,
    yRatio: normalized.yRatio,
    width: normalized.width,
    height: normalized.height,
    dock: normalized.dock,
    positionLocked: normalized.positionLocked,
    sizeLocked: normalized.sizeLocked,
  });
}

/** Writes the normalized exact allowlist; storage failures remain non-fatal UI preference loss. */
export function saveStudioFloatingSurfaceLayout(
  storage: StudioFloatingSurfaceStorage | null | undefined,
  key: string,
  layout: StudioFloatingSurfaceLayout,
): boolean {
  if (!storage || !key || key.length > 256) return false;
  try {
    storage.setItem(key, encodeStudioFloatingSurfaceLayout(layout));
    return true;
  } catch {
    return false;
  }
}
