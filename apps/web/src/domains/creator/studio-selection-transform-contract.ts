/** Shared contracts and deterministic geometry helpers for precision selection transforms. */

import type { El } from "./studio-element-model";
import type {
  StudioFigmaSelectionLayoutMetrics as LegacyStudioFigmaSelectionLayoutMetrics,
  StudioFigmaSelectionLayoutPatch as LegacyStudioFigmaSelectionLayoutPatch,
} from "./studio-figma-selection-ux";
import type {
  StudioGroupUniformResizeBounds,
  StudioGroupUniformResizeStrokeWidthPolicy,
} from "./studio-group-uniform-resize";

export type StudioSelectionResizeAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type StudioSelectionStrokeWidthPolicy = StudioGroupUniformResizeStrokeWidthPolicy;

export interface StudioFigmaSelectionLayoutPatch extends LegacyStudioFigmaSelectionLayoutPatch {
  /** Persist the same keep-ratio rule used by the on-canvas Transformer. */
  readonly lockAspect?: boolean;
  /** Fixed point for numeric W/H edits. Defaults to today's top-left behavior. */
  readonly resizeAnchor?: StudioSelectionResizeAnchor;
  /** Multi-selection default preserves authored line weight; `scale` opts into proportional ink. */
  readonly strokeWidthPolicy?: StudioSelectionStrokeWidthPolicy;
}

export interface StudioFigmaSelectionLayoutMetrics
  extends LegacyStudioFigmaSelectionLayoutMetrics {
  /** Capability marker: the caller is wired to this façade's atomic commit path. */
  readonly precisionControls?: true;
  readonly aspectLocked?: boolean;
  readonly supportsAspectLock?: boolean;
  /** False when the type-specific constraints section already owns the same checkbox. */
  readonly showAspectLockControl?: boolean;
  readonly hasStrokeWidthSensitiveMember?: boolean;
}

export const TRANSFORM_EPSILON = 1e-7;
export const UNIFORM_SCALE_RELATIVE_EPSILON = 1e-6;
export const GROUP_LAYOUT_SOLVE_TOLERANCE = 1e-4;
export const GROUP_LAYOUT_SOLVE_MAX_STEPS = 6;
const DEFAULT_RESIZE_ANCHOR: StudioSelectionResizeAnchor = "top-left";

const RESIZE_ANCHOR_FACTORS: Record<StudioSelectionResizeAnchor, readonly [number, number]> = {
  "top-left": [0, 0],
  "top-center": [0.5, 0],
  "top-right": [1, 0],
  "middle-left": [0, 0.5],
  center: [0.5, 0.5],
  "middle-right": [1, 0.5],
  "bottom-left": [0, 1],
  "bottom-center": [0.5, 1],
  "bottom-right": [1, 1],
};

export function finiteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function finitePositive(value: number | undefined): value is number {
  return finiteNumber(value) && value > 0;
}

export function nearlyEqual(a: number, b: number, epsilon = TRANSFORM_EPSILON): boolean {
  return Math.abs(a - b) <= epsilon * Math.max(1, Math.abs(a), Math.abs(b));
}

export function normalizeSignedDegrees(degrees: number): number {
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

export function normalizeRotationDelta(degrees: number | undefined): number {
  return finiteNumber(degrees) ? normalizeSignedDegrees(degrees) : 0;
}

export function resizeAnchorFactors(
  anchor: StudioSelectionResizeAnchor | undefined,
): readonly [number, number] {
  return RESIZE_ANCHOR_FACTORS[anchor ?? DEFAULT_RESIZE_ANCHOR];
}

export function supportsPersistentAspectLock(
  element: El,
  metrics: LegacyStudioFigmaSelectionLayoutMetrics,
): boolean {
  return metrics.supportsWidth && metrics.supportsHeight && element.type !== "text" && element.type !== "sticker";
}

export function hasStrokeWidthSensitiveMember(elements: readonly El[]): boolean {
  return elements.some(
    (element) =>
      element.type === "draw"
      || ("strokeWidth" in element
        && typeof element.strokeWidth === "number"
        && Number.isFinite(element.strokeWidth)),
  );
}

/**
 * Rotates the unturned target box's origin around its centre. The group planner rotates around the
 * target origin; this conversion gives the inspector the centre-pivot behavior users see on canvas.
 */
export function rotateBoxOriginAboutCentre(
  box: StudioGroupUniformResizeBounds,
  degrees: number,
): StudioGroupUniformResizeBounds {
  if (degrees === 0) return box;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  return {
    x: box.x + halfW - halfW * cos + halfH * sin,
    y: box.y + halfH - halfW * sin - halfH * cos,
    width: box.width,
    height: box.height,
  };
}

/**
 * Keeps a local resize anchor fixed in document space. Stored box elements rotate around `(x,y)`,
 * so the anchor compensation is rotated by their authored angle; baked draw geometry has no stored
 * angle and uses the axis-aligned selection box directly.
 */
export function anchorAdjustedOrigin(
  element: El,
  source: StudioGroupUniformResizeBounds,
  width: number,
  height: number,
  anchor: StudioSelectionResizeAnchor | undefined,
): { x: number; y: number } {
  const [factorX, factorY] = resizeAnchorFactors(anchor);
  const localX = (source.width - width) * factorX;
  const localY = (source.height - height) * factorY;
  if (element.type === "draw") {
    return { x: source.x + localX, y: source.y + localY };
  }
  const rotation =
    "rotation" in element && typeof element.rotation === "number" && Number.isFinite(element.rotation)
      ? element.rotation
      : 0;
  if (rotation === 0) return { x: source.x + localX, y: source.y + localY };
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: source.x + localX * cos - localY * sin,
    y: source.y + localX * sin + localY * cos,
  };
}
