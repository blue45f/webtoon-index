import {
  STUDIO_SCENE_PROVIDER_CONTRACT_REVISION,
  getStudioSceneShapeBounds,
  resolveStudioSceneDocumentTransform,
  studioSceneShapeContainsPoint,
  validateStudioSceneSelectableOverlay,
  validateStudioSceneViewport,
  type StudioSceneDocumentTransform,
  type StudioSceneHitResult,
  type StudioSceneOverlayIdentity,
  type StudioScenePoint,
  type StudioSceneProvider,
  type StudioSceneRendererReceipt,
  type StudioSceneSelectableOverlay,
  type StudioSceneViewportMetrics,
} from "../studio-scene-provider";

import type {
  Application,
  Container,
  Ellipse,
  Graphics,
  Polygon,
  Rectangle,
  RendererType,
} from "pixi.js";

export const STUDIO_PIXI_SCENE_ROOT_LABEL = "studio-pixi-scene-root" as const;
export const STUDIO_PIXI_SCENE_CANVAS_MARKER = "dedicated-pixi-overlay" as const;
export const STUDIO_PIXI_SCENE_LABEL_PREFIX = "studio-document:" as const;

const DEFAULT_FILL = Object.freeze({ color: 0x2563eb, alpha: 0.08 });
const DEFAULT_STROKE = Object.freeze({
  color: 0x2563eb,
  alpha: 0.92,
  width: 1,
});

export interface StudioPixiRuntime {
  readonly Application: typeof Application;
  readonly Container: typeof Container;
  readonly Graphics: typeof Graphics;
  readonly Rectangle: typeof Rectangle;
  readonly Ellipse: typeof Ellipse;
  readonly Polygon: typeof Polygon;
  readonly RendererType: typeof RendererType;
}

export type StudioPixiRuntimeLoader = () => Promise<StudioPixiRuntime>;

export interface CreateStudioPixiSceneProviderOptions
  extends StudioSceneViewportMetrics {
  /** One renderer is selected before initialization; Pixi must not choose an alternate. */
  readonly renderer: "webgpu" | "webgl";
  /** Injection seam for deterministic unit tests. Production always uses the lazy loader. */
  readonly loadRuntime?: StudioPixiRuntimeLoader;
  /** A document may be supplied by an iframe host or a DOM test environment. */
  readonly ownerDocument?: Document;
}

interface StudioPixiOverlayEntry {
  readonly label: string;
  readonly graphics: Graphics;
  overlay: StudioSceneSelectableOverlay;
}

async function loadStudioPixiRuntime(): Promise<StudioPixiRuntime> {
  return await import("pixi.js");
}

function requireOwnerDocument(ownerDocument?: Document): Document {
  if (ownerDocument) return ownerDocument;
  if (typeof document === "undefined") {
    throw new Error(
      "A DOM Document is required to create the dedicated Studio scene overlay.",
    );
  }
  return document;
}

function createDedicatedOverlayCanvas(ownerDocument: Document): HTMLCanvasElement {
  const canvas = ownerDocument.createElement("canvas");
  canvas.dataset.studioSceneOverlay = STUDIO_PIXI_SCENE_CANVAS_MARKER;
  canvas.dataset.studioSceneInputAuthority = "inactive";
  canvas.setAttribute("aria-hidden", "true");
  canvas.setAttribute("role", "presentation");
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.display = "block";
  canvas.style.background = "transparent";
  canvas.style.pointerEvents = "none";
  canvas.style.touchAction = "none";
  return canvas;
}

function applyCanvasCssViewport(
  canvas: HTMLCanvasElement,
  viewport: StudioSceneViewportMetrics,
): void {
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
}

function labelForDocumentId(documentId: string): string {
  return `${STUDIO_PIXI_SCENE_LABEL_PREFIX}${encodeURIComponent(documentId)}`;
}

function cloneOverlay(
  overlay: StudioSceneSelectableOverlay,
): StudioSceneSelectableOverlay {
  const shape =
    overlay.shape.kind === "polygon"
      ? {
          kind: "polygon" as const,
          points: overlay.shape.points.map((point) => ({
            x: point.x,
            y: point.y,
          })),
        }
      : {
          kind: overlay.shape.kind,
          bounds: { ...overlay.shape.bounds },
        };

  return {
    documentId: overlay.documentId,
    shape,
    zIndex: overlay.zIndex,
    visible: overlay.visible,
    selectable: overlay.selectable,
    opacity: overlay.opacity,
    fill: overlay.fill ? { ...overlay.fill } : undefined,
    stroke: overlay.stroke ? { ...overlay.stroke } : undefined,
  };
}

function compareOverlayEntries(
  left: StudioPixiOverlayEntry,
  right: StudioPixiOverlayEntry,
): number {
  const zDifference = left.overlay.zIndex - right.overlay.zIndex;
  return zDifference !== 0
    ? zDifference
    : left.overlay.documentId.localeCompare(right.overlay.documentId);
}

/**
 * Selection chrome must keep a constant on-screen thickness like the primary stage's non-scaling
 * stroke contract. The root carries the document scale, so authored width is divided before draw;
 * this mirrors the authoritative canvas while preserving Pixi's independent overlay ownership.
 */
function chromeStrokeScale(transform: StudioSceneDocumentTransform): number {
  const magnitude = Math.max(Math.abs(transform.scaleX), Math.abs(transform.scaleY));
  return magnitude > 0 ? 1 / magnitude : 1;
}

function configureGraphicsShape(
  runtime: StudioPixiRuntime,
  graphics: Graphics,
  overlay: StudioSceneSelectableOverlay,
  strokeScale: number,
): void {
  const fill = overlay.fill ?? DEFAULT_FILL;
  const stroke = overlay.stroke ?? DEFAULT_STROKE;

  graphics.clear();
  if (overlay.shape.kind === "rect") {
    const { x, y, width, height } = overlay.shape.bounds;
    graphics.rect(x, y, width, height);
    graphics.hitArea = new runtime.Rectangle(x, y, width, height);
  } else if (overlay.shape.kind === "ellipse") {
    const { x, y, width, height } = overlay.shape.bounds;
    const radiusX = width / 2;
    const radiusY = height / 2;
    graphics.ellipse(x + radiusX, y + radiusY, radiusX, radiusY);
    graphics.hitArea = new runtime.Ellipse(
      x + radiusX,
      y + radiusY,
      radiusX,
      radiusY,
    );
  } else {
    const flatPoints = overlay.shape.points.flatMap((point) => [
      point.x,
      point.y,
    ]);
    graphics.poly(flatPoints, true);
    graphics.hitArea = new runtime.Polygon(flatPoints);
  }

  graphics.fill({ color: fill.color, alpha: fill.alpha });
  graphics.stroke({
    color: stroke.color,
    alpha: stroke.alpha,
    width: stroke.width * strokeScale,
  });
  graphics.visible = overlay.visible !== false;
  graphics.alpha = overlay.opacity ?? 1;
  graphics.eventMode = overlay.selectable === false ? "none" : "static";
}

function rendererReceipt(
  selectedRenderer: "webgpu" | "webgl",
): StudioSceneRendererReceipt {
  return Object.freeze({
    providerId: "pixi",
    selectedRenderer,
    attemptedRenderer: selectedRenderer,
    activeRenderer: selectedRenderer,
    attemptCount: 1,
    failureIsolation: "fail-closed",
    surface: Object.freeze({
      ownership: "exclusive-dedicated-overlay",
      contextSharing: "forbidden",
      background: "transparent",
    }),
  });
}

class PixiStudioSceneProvider implements StudioSceneProvider {
  readonly contractRevision = STUDIO_SCENE_PROVIDER_CONTRACT_REVISION;
  readonly canvas: HTMLCanvasElement;
  readonly receipt: StudioSceneRendererReceipt;

  private readonly app: Application;
  private readonly root: Container;
  private readonly runtime: StudioPixiRuntime;
  private readonly entries = new Map<string, StudioPixiOverlayEntry>();
  private readonly documentIdsByLabel = new Map<string, string>();
  private currentViewport: StudioSceneViewportMetrics;
  private isDestroyed = false;

  constructor(input: {
    readonly app: Application;
    readonly root: Container;
    readonly runtime: StudioPixiRuntime;
    readonly canvas: HTMLCanvasElement;
    readonly viewport: StudioSceneViewportMetrics;
    readonly receipt: StudioSceneRendererReceipt;
  }) {
    this.app = input.app;
    this.root = input.root;
    this.runtime = input.runtime;
    this.canvas = input.canvas;
    this.currentViewport = Object.freeze({ ...input.viewport });
    this.receipt = input.receipt;
    this.applyDocumentTransform();
  }

  /**
   * Overlay geometry stays in document units; the root carries the document → viewport transform,
   * so one place (and only one place) knows about zoom, flip and rotation.
   */
  private applyDocumentTransform(): void {
    const transform = resolveStudioSceneDocumentTransform(this.currentViewport);
    this.root.position.set(transform.offsetX, transform.offsetY);
    this.root.scale.set(transform.scaleX, transform.scaleY);
    this.root.rotation = (transform.rotation * Math.PI) / 180;
  }

  private redrawChromeForScale(): void {
    const strokeScale = chromeStrokeScale(
      resolveStudioSceneDocumentTransform(this.currentViewport),
    );
    for (const entry of this.entries.values()) {
      configureGraphicsShape(this.runtime, entry.graphics, entry.overlay, strokeScale);
    }
  }

  get viewport(): StudioSceneViewportMetrics {
    return this.currentViewport;
  }

  get destroyed(): boolean {
    return this.isDestroyed;
  }

  private assertAlive(): void {
    if (this.isDestroyed) {
      throw new Error("The Studio Pixi scene provider has been destroyed.");
    }
  }

  private restoreDeterministicDisplayOrder(): void {
    const orderedEntries = [...this.entries.values()].sort(compareOverlayEntries);
    orderedEntries.forEach((entry, index) => {
      entry.graphics.zIndex = index;
    });
    this.root.sortChildren();
  }

  resize(viewport: StudioSceneViewportMetrics): void {
    this.assertAlive();
    validateStudioSceneViewport(viewport);
    const previous = resolveStudioSceneDocumentTransform(this.currentViewport);
    this.app.renderer.resize(viewport.width, viewport.height, viewport.dpr);
    applyCanvasCssViewport(this.canvas, viewport);
    this.currentViewport = Object.freeze({ ...viewport });
    this.applyDocumentTransform();
    const next = resolveStudioSceneDocumentTransform(this.currentViewport);
    if (previous.scaleX !== next.scaleX || previous.scaleY !== next.scaleY) {
      this.redrawChromeForScale();
    }
  }

  upsertSelectableOverlay(
    overlay: StudioSceneSelectableOverlay,
  ): StudioSceneOverlayIdentity {
    this.assertAlive();
    validateStudioSceneSelectableOverlay(overlay);
    const storedOverlay = cloneOverlay(overlay);
    const existing = this.entries.get(storedOverlay.documentId);
    const label =
      existing?.label ?? labelForDocumentId(storedOverlay.documentId);
    const graphics = existing?.graphics ?? new this.runtime.Graphics();

    graphics.label = label;
    configureGraphicsShape(
      this.runtime,
      graphics,
      storedOverlay,
      chromeStrokeScale(resolveStudioSceneDocumentTransform(this.currentViewport)),
    );

    if (!existing) {
      this.root.addChild(graphics);
      this.documentIdsByLabel.set(label, storedOverlay.documentId);
    }
    this.entries.set(storedOverlay.documentId, {
      label,
      graphics,
      overlay: storedOverlay,
    });
    this.restoreDeterministicDisplayOrder();

    return Object.freeze({
      documentId: storedOverlay.documentId,
      label,
    });
  }

  removeSelectableOverlay(documentId: string): boolean {
    this.assertAlive();
    const entry = this.entries.get(documentId);
    if (!entry) return false;

    this.entries.delete(documentId);
    this.documentIdsByLabel.delete(entry.label);
    this.root.removeChild(entry.graphics);
    entry.graphics.destroy();
    this.restoreDeterministicDisplayOrder();
    return true;
  }

  documentIdForLabel(label: string): string | null {
    this.assertAlive();
    return this.documentIdsByLabel.get(label) ?? null;
  }

  hitTest(point: StudioScenePoint): StudioSceneHitResult | null {
    this.assertAlive();
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;

    const topFirst = [...this.entries.values()].sort((left, right) =>
      compareOverlayEntries(right, left),
    );
    for (const entry of topFirst) {
      if (
        entry.overlay.visible === false ||
        entry.overlay.selectable === false ||
        !studioSceneShapeContainsPoint(entry.overlay.shape, point)
      ) {
        continue;
      }
      return Object.freeze({
        documentId: entry.overlay.documentId,
        label: entry.label,
        zIndex: entry.overlay.zIndex,
        shapeKind: entry.overlay.shape.kind,
        point: Object.freeze({ x: point.x, y: point.y }),
        bounds: Object.freeze(getStudioSceneShapeBounds(entry.overlay.shape)),
      });
    }
    return null;
  }

  render(): void {
    this.assertAlive();
    this.app.render();
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.entries.clear();
    this.documentIdsByLabel.clear();

    try {
      this.app.destroy(
        { removeView: true },
        { children: true, texture: true, textureSource: true, context: true },
      );
    } finally {
      this.canvas.remove();
    }
  }
}

function activeRendererKind(
  app: Application,
  runtime: StudioPixiRuntime,
): "webgpu" | "webgl" | null {
  if (app.renderer.type === runtime.RendererType.WEBGPU) return "webgpu";
  if (app.renderer.type === runtime.RendererType.WEBGL) return "webgl";
  return null;
}

function destroyFailedApplication(
  app: Application,
  canvas: HTMLCanvasElement,
): void {
  try {
    app.destroy({ removeView: true }, { children: true, context: true });
  } catch {
    canvas.remove();
  }
}

export async function createStudioPixiSceneProvider(
  options: CreateStudioPixiSceneProviderOptions,
): Promise<StudioSceneProvider> {
  const viewport: StudioSceneViewportMetrics = {
    width: options.width,
    height: options.height,
    dpr: options.dpr,
    ...(options.documentTransform
      ? { documentTransform: options.documentTransform }
      : {}),
  };
  validateStudioSceneViewport(viewport);

  const ownerDocument = requireOwnerDocument(options.ownerDocument);
  const canvas = createDedicatedOverlayCanvas(ownerDocument);
  applyCanvasCssViewport(canvas, viewport);

  const loadRuntime = options.loadRuntime ?? loadStudioPixiRuntime;
  const runtime = await loadRuntime();
  const app = new runtime.Application();
  try {
    await app.init({
      canvas,
      width: viewport.width,
      height: viewport.height,
      resolution: viewport.dpr,
      autoDensity: true,
      antialias: true,
      backgroundAlpha: 0,
      autoStart: false,
      sharedTicker: false,
      // Pixi's string form appends its default renderer order. A one-item array
      // excludes every alternate renderer and therefore preserves the selected
      // provider for the whole initialization operation.
      preference: [options.renderer],
      powerPreference: "high-performance",
    });
  } catch (error) {
    destroyFailedApplication(app, canvas);
    throw error;
  }

  const activeRenderer = activeRendererKind(app, runtime);
  if (!activeRenderer) {
    destroyFailedApplication(app, canvas);
    throw new Error(
      "Pixi selected an unsupported renderer; Studio scene overlays require WebGPU or WebGL.",
    );
  }
  if (activeRenderer !== options.renderer) {
    destroyFailedApplication(app, canvas);
    throw new Error(
      `Pixi activated ${activeRenderer} after ${options.renderer} was selected; automatic renderer substitution is forbidden.`,
    );
  }

  const root = new runtime.Container({
    label: STUDIO_PIXI_SCENE_ROOT_LABEL,
    isRenderGroup: true,
  });
  root.sortableChildren = true;
  root.eventMode = "passive";
  app.stage.addChild(root);

  return new PixiStudioSceneProvider({
    app,
    root,
    runtime,
    canvas,
    viewport,
    receipt: rendererReceipt(options.renderer),
  });
}
