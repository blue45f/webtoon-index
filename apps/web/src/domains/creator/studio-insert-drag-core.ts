import type { BubbleVariant } from "./studio-assets";

export const STUDIO_ASSET_DRAG_MIME = "application/json-asset";
export const STUDIO_INSERT_DRAG_MIME = "application/json-insert";

export type StudioInsertDragPayload =
  | { kind: "bubble"; variant: BubbleVariant }
  | { kind: "sticker"; emoji: string }
  | { kind: "text" };

export interface StudioWritableDataTransfer {
  effectAllowed: DataTransfer["effectAllowed"];
  setData(format: string, data: string): void;
}

export interface StudioInsertPoint {
  readonly x: number;
  readonly y: number;
}

export interface StudioInsertBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioInsertViewportTarget {
  readonly center?: StudioInsertPoint | null;
  readonly bounds?: StudioInsertBounds | null;
}

export interface StudioInsertTargetInput {
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly pointer?: StudioInsertPoint | null;
  readonly selectedFrame?: StudioInsertBounds | null;
  readonly viewport?: StudioInsertViewportTarget | null;
}

export interface StudioInsertTarget {
  readonly source: "pointer" | "selected-frame" | "viewport" | "document";
  readonly anchor: StudioInsertPoint;
  readonly bounds: StudioInsertBounds;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function normalizePoint(
  point: StudioInsertPoint | null | undefined,
  bounds: StudioInsertBounds
): StudioInsertPoint | null {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return {
    x: clamp(point.x, bounds.x, bounds.x + bounds.width),
    y: clamp(point.y, bounds.y, bounds.y + bounds.height),
  };
}

function normalizeBounds(
  bounds: StudioInsertBounds | null | undefined,
  documentBounds: StudioInsertBounds
): StudioInsertBounds | null {
  if (
    !bounds
    || !Number.isFinite(bounds.x)
    || !Number.isFinite(bounds.y)
    || !Number.isFinite(bounds.width)
    || !Number.isFinite(bounds.height)
    || bounds.width <= 0
    || bounds.height <= 0
  ) return null;
  const left = clamp(bounds.x, documentBounds.x, documentBounds.x + documentBounds.width);
  const top = clamp(bounds.y, documentBounds.y, documentBounds.y + documentBounds.height);
  const right = clamp(
    bounds.x + bounds.width,
    documentBounds.x,
    documentBounds.x + documentBounds.width
  );
  const bottom = clamp(
    bounds.y + bounds.height,
    documentBounds.y,
    documentBounds.y + documentBounds.height
  );
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function boundsCenter(bounds: StudioInsertBounds): StudioInsertPoint {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

export function resolveStudioInsertTarget(
  input: StudioInsertTargetInput
): StudioInsertTarget {
  const documentBounds: StudioInsertBounds = {
    x: 0,
    y: 0,
    width: finitePositive(input.documentWidth, 1),
    height: finitePositive(input.documentHeight, 1),
  };
  const pointer = normalizePoint(input.pointer, documentBounds);
  if (pointer) return { source: "pointer", anchor: pointer, bounds: documentBounds };

  const selectedFrame = normalizeBounds(input.selectedFrame, documentBounds);
  if (selectedFrame) {
    return {
      source: "selected-frame",
      anchor: boundsCenter(selectedFrame),
      bounds: selectedFrame,
    };
  }

  const normalizedViewportBounds = normalizeBounds(input.viewport?.bounds, documentBounds);
  const viewportBounds = normalizedViewportBounds ?? documentBounds;
  const viewportCenter =
    normalizePoint(input.viewport?.center, viewportBounds)
    ?? (normalizedViewportBounds ? boundsCenter(viewportBounds) : null);
  if (viewportCenter) {
    return {
      source: "viewport",
      anchor: viewportCenter,
      bounds: viewportBounds,
    };
  }

  return {
    source: "document",
    anchor: boundsCenter(documentBounds),
    bounds: documentBounds,
  };
}

export function consumeStudioInsertDropTransfer(
  consumed: WeakSet<object>,
  dataTransfer: unknown
): boolean {
  if (
    (typeof dataTransfer !== "object" && typeof dataTransfer !== "function")
    || dataTransfer === null
  ) return false;
  if (consumed.has(dataTransfer)) return false;
  consumed.add(dataTransfer);
  return true;
}
