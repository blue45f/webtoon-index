/**
 * Renderer-neutral contract for the Studio's accelerated scene overlay.
 *
 * The document remains authoritative. A provider receives serialisable overlay
 * descriptors and may keep vendor objects privately, but opaque runtime handles,
 * GPU contexts, and vendor display objects never cross this boundary.
 */

export const STUDIO_SCENE_PROVIDER_CONTRACT_REVISION = 2 as const;

export type StudioSceneRendererKind = "webgpu" | "webgl";
export type StudioSceneSelectableShapeKind = "rect" | "ellipse" | "polygon";

export interface StudioScenePoint {
  readonly x: number;
  readonly y: number;
}

export interface StudioSceneBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioSceneRectShape {
  readonly kind: "rect";
  readonly bounds: StudioSceneBounds;
}

export interface StudioSceneEllipseShape {
  readonly kind: "ellipse";
  readonly bounds: StudioSceneBounds;
}

export interface StudioScenePolygonShape {
  readonly kind: "polygon";
  /** Absolute document-space points. At least three points are required. */
  readonly points: readonly StudioScenePoint[];
}

export type StudioSceneSelectableShape =
  | StudioSceneRectShape
  | StudioSceneEllipseShape
  | StudioScenePolygonShape;

export interface StudioSceneOverlayPaint {
  /** 24-bit RGB. Alpha is carried separately to avoid renderer-specific colour sources. */
  readonly color: number;
  readonly alpha: number;
}

export interface StudioSceneOverlayStroke extends StudioSceneOverlayPaint {
  readonly width: number;
}

export interface StudioSceneSelectableOverlay {
  readonly documentId: string;
  readonly shape: StudioSceneSelectableShape;
  readonly zIndex: number;
  readonly visible?: boolean;
  readonly selectable?: boolean;
  readonly opacity?: number;
  readonly fill?: StudioSceneOverlayPaint;
  readonly stroke?: StudioSceneOverlayStroke;
}

export interface StudioSceneOverlayIdentity {
  readonly documentId: string;
  readonly label: string;
}

export interface StudioSceneHitResult extends StudioSceneOverlayIdentity {
  readonly zIndex: number;
  readonly shapeKind: StudioSceneSelectableShapeKind;
  readonly point: StudioScenePoint;
  readonly bounds: StudioSceneBounds;
}

/**
 * Document → overlay-surface placement.
 *
 * Overlay shapes are authored in **document** units, while the surface is sized in **viewport CSS
 * px**. Without this transform the two spaces are silently assumed to be identical, which only
 * holds at 100% zoom with no flip and no rotation; at any other view state the overlay paints a
 * correctly shaped rectangle in the wrong place at the wrong size. The fields mirror the primary
 * host stage transform one-for-one so the overlay and the authoritative canvas cannot drift apart.
 */
export interface StudioSceneDocumentTransform {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly offsetX: number;
  readonly offsetY: number;
  /** Degrees, clockwise. Studio only uses 0/90/180/270. */
  readonly rotation: number;
}

export const STUDIO_SCENE_IDENTITY_DOCUMENT_TRANSFORM: StudioSceneDocumentTransform =
  Object.freeze({
    scaleX: 1,
    scaleY: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
  });

export function studioSceneDocumentTransformFromScale(
  scale: number,
): StudioSceneDocumentTransform {
  return Object.freeze({
    scaleX: scale,
    scaleY: scale,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
  });
}

export interface StudioSceneViewportMetrics {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  /**
   * Document → viewport placement for this surface. Omitting it means identity, i.e. one document
   * unit is one CSS pixel; every zoomed, flipped or rotated host must supply it.
   */
  readonly documentTransform?: StudioSceneDocumentTransform;
}

export interface StudioSceneRendererReceipt {
  readonly providerId: string;
  /** Exactly one renderer is selected before provider initialization. */
  readonly selectedRenderer: StudioSceneRendererKind;
  readonly attemptedRenderer: StudioSceneRendererKind;
  readonly activeRenderer: StudioSceneRendererKind;
  readonly attemptCount: 1;
  readonly failureIsolation: "fail-closed";
  readonly surface: {
    readonly ownership: "exclusive-dedicated-overlay";
    readonly contextSharing: "forbidden";
    readonly background: "transparent";
  };
}

export interface StudioSceneProvider {
  readonly contractRevision: typeof STUDIO_SCENE_PROVIDER_CONTRACT_REVISION;
  /**
   * A provider-created canvas dedicated to the overlay. It is never the brush
   * surface and its rendering context never crosses this interface.
   */
  readonly canvas: HTMLCanvasElement;
  readonly receipt: StudioSceneRendererReceipt;
  readonly viewport: StudioSceneViewportMetrics;
  readonly destroyed: boolean;

  resize(viewport: StudioSceneViewportMetrics): void;
  upsertSelectableOverlay(
    overlay: StudioSceneSelectableOverlay,
  ): StudioSceneOverlayIdentity;
  removeSelectableOverlay(documentId: string): boolean;
  documentIdForLabel(label: string): string | null;
  /** `point` is in document units, the same space overlay shapes are authored in. */
  hitTest(point: StudioScenePoint): StudioSceneHitResult | null;
  render(): void;
  destroy(): void;
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function assertUnitInterval(value: number, path: string): void {
  if (!isFiniteNumber(value) || value < 0 || value > 1) {
    throw new RangeError(`${path} must be a finite number in the range 0..1.`);
  }
}

function assertBounds(bounds: StudioSceneBounds, path: string): void {
  if (
    !isFiniteNumber(bounds.x) ||
    !isFiniteNumber(bounds.y) ||
    !isFiniteNumber(bounds.width) ||
    !isFiniteNumber(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    throw new RangeError(
      `${path} must contain finite x/y values and positive width/height values.`,
    );
  }
}

function assertPaint(paint: StudioSceneOverlayPaint, path: string): void {
  if (
    !Number.isInteger(paint.color) ||
    paint.color < 0 ||
    paint.color > 0xffffff
  ) {
    throw new RangeError(`${path}.color must be a 24-bit RGB integer.`);
  }
  assertUnitInterval(paint.alpha, `${path}.alpha`);
}

export function validateStudioSceneDocumentTransform(
  transform: StudioSceneDocumentTransform,
): void {
  if (
    !isFiniteNumber(transform.scaleX) ||
    !isFiniteNumber(transform.scaleY) ||
    transform.scaleX === 0 ||
    transform.scaleY === 0
  ) {
    throw new RangeError(
      "Scene document transform scaleX/scaleY must be finite and non-zero.",
    );
  }
  if (
    !isFiniteNumber(transform.offsetX) ||
    !isFiniteNumber(transform.offsetY) ||
    !isFiniteNumber(transform.rotation)
  ) {
    throw new RangeError(
      "Scene document transform offsetX/offsetY/rotation must be finite.",
    );
  }
}

export function resolveStudioSceneDocumentTransform(
  viewport: StudioSceneViewportMetrics,
): StudioSceneDocumentTransform {
  return viewport.documentTransform ?? STUDIO_SCENE_IDENTITY_DOCUMENT_TRANSFORM;
}

/** Project a document-space point into the overlay surface's CSS-pixel space. */
export function projectStudioSceneDocumentPoint(
  transform: StudioSceneDocumentTransform,
  point: StudioScenePoint,
): StudioScenePoint {
  const radians = (transform.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = point.x * transform.scaleX;
  const y = point.y * transform.scaleY;
  return {
    x: transform.offsetX + x * cos - y * sin,
    y: transform.offsetY + x * sin + y * cos,
  };
}

export function validateStudioSceneViewport(
  viewport: StudioSceneViewportMetrics,
): void {
  if (
    !isFiniteNumber(viewport.width) ||
    !isFiniteNumber(viewport.height) ||
    !isFiniteNumber(viewport.dpr) ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    viewport.dpr <= 0
  ) {
    throw new RangeError(
      "Scene viewport width, height, and DPR must be finite positive numbers.",
    );
  }
  if (viewport.documentTransform) {
    validateStudioSceneDocumentTransform(viewport.documentTransform);
  }
}

export function validateStudioSceneSelectableOverlay(
  overlay: StudioSceneSelectableOverlay,
): void {
  if (overlay.documentId.trim().length === 0) {
    throw new TypeError("Scene overlay documentId must not be empty.");
  }
  if (!isFiniteNumber(overlay.zIndex)) {
    throw new RangeError("Scene overlay zIndex must be finite.");
  }
  if (overlay.opacity !== undefined) {
    assertUnitInterval(overlay.opacity, "Scene overlay opacity");
  }
  if (overlay.fill) {
    assertPaint(overlay.fill, "Scene overlay fill");
  }
  if (overlay.stroke) {
    assertPaint(overlay.stroke, "Scene overlay stroke");
    if (!isFiniteNumber(overlay.stroke.width) || overlay.stroke.width <= 0) {
      throw new RangeError("Scene overlay stroke.width must be positive.");
    }
  }

  if (overlay.shape.kind === "polygon") {
    if (overlay.shape.points.length < 3) {
      throw new RangeError("Scene polygon overlays require at least three points.");
    }
    if (
      overlay.shape.points.some(
        (point) => !isFiniteNumber(point.x) || !isFiniteNumber(point.y),
      )
    ) {
      throw new RangeError("Scene polygon points must be finite.");
    }
    return;
  }

  assertBounds(overlay.shape.bounds, `Scene ${overlay.shape.kind} bounds`);
}

export function getStudioSceneShapeBounds(
  shape: StudioSceneSelectableShape,
): StudioSceneBounds {
  if (shape.kind !== "polygon") {
    return {
      x: shape.bounds.x,
      y: shape.bounds.y,
      width: shape.bounds.width,
      height: shape.bounds.height,
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of shape.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function pointOnSegment(
  point: StudioScenePoint,
  start: StudioScenePoint,
  end: StudioScenePoint,
): boolean {
  const cross =
    (point.y - start.y) * (end.x - start.x) -
    (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > Number.EPSILON * 64) return false;

  const dot =
    (point.x - start.x) * (end.x - start.x) +
    (point.y - start.y) * (end.y - start.y);
  if (dot < 0) return false;

  const lengthSquared =
    (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  return dot <= lengthSquared;
}

function polygonContainsPoint(
  points: readonly StudioScenePoint[],
  point: StudioScenePoint,
): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const start = points[previous];
    const end = points[index];
    if (pointOnSegment(point, start, end)) return true;

    const crossesHorizontalRay =
      start.y > point.y !== end.y > point.y &&
      point.x <
        ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) +
          start.x;
    if (crossesHorizontalRay) inside = !inside;
  }
  return inside;
}

export function studioSceneShapeContainsPoint(
  shape: StudioSceneSelectableShape,
  point: StudioScenePoint,
): boolean {
  if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return false;

  if (shape.kind === "polygon") {
    return polygonContainsPoint(shape.points, point);
  }

  const { x, y, width, height } = shape.bounds;
  if (shape.kind === "rect") {
    return (
      point.x >= x &&
      point.x <= x + width &&
      point.y >= y &&
      point.y <= y + height
    );
  }

  const radiusX = width / 2;
  const radiusY = height / 2;
  const normalX = (point.x - (x + radiusX)) / radiusX;
  const normalY = (point.y - (y + radiusY)) / radiusY;
  return normalX ** 2 + normalY ** 2 <= 1;
}
