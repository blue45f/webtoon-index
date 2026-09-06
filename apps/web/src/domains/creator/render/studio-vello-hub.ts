import {
  HysteresisPolicy,
  ProviderCostModel,
  RemoteKillSwitch,
  WinnerCache,
  computeSceneFingerprint,
  createFuzzyNeighborhoodGate,
  runShadowComparison,
  type ShadowComparisonReport,
} from "@toonspectrum/studio-engine-registry";
import {
  pathBounds,
  sceneIRSchema,
  type PathIR,
  type PathVerbIR,
  type SceneIR,
  type SceneNodeIR,
} from "@toonspectrum/studio-project-model";

import {
  projectStudioSceneDocumentPoint,
  resolveStudioSceneDocumentTransform,
  validateStudioSceneSelectableOverlay,
  validateStudioSceneViewport,
  type StudioSceneDocumentTransform,
  type StudioScenePoint,
  type StudioSceneSelectableOverlay,
  type StudioSceneViewportMetrics,
} from "../studio-scene-provider";

import {
  StudioEngineUnavailableError,
  type StudioEngineFailureStage,
} from "./studio-engine-failure-policy";
import {
  acquireStudioGpuDevice,
  onStudioGpuDeviceLost,
  type StudioGpuDeviceLease,
  type StudioGpuDeviceLossEvent,
} from "./studio-gpu-fabric";
import {
  STUDIO_VELLO_HUB_PRODUCT_CAPABILITY,
  STUDIO_VELLO_HYBRID_COMPOSITOR,
  STUDIO_VELLO_HYBRID_SPARSE_CANDIDATE,
} from "./studio-vello-hub-capability";

import type { GpuCpuComparison } from "@toonspectrum/studio-engine-vello";

export {
  resolveStudioVelloHubProductCapability,
  STUDIO_VELLO_HUB_PRODUCT_CAPABILITY,
  STUDIO_VELLO_HYBRID_COMPOSITOR,
  STUDIO_VELLO_HYBRID_SPARSE_CANDIDATE,
  type StudioVelloHubCapabilityDecision,
} from "./studio-vello-hub-capability";

/**
 * Product Vello Hub (V13).
 *
 * Visible product frames are Vello Classic or Hybrid GPU. Vello CPU is an
 * explicitly requested QA reference lane only. Product render/present/device
 * loss failures fail closed and never select another pixel renderer. Product
 * rendering never schedules comparison or reference work after presentation.
 */

export const STUDIO_VELLO_CLASSIC_BACKEND_ID =
  "vello-gpu-browser" as const;
export const STUDIO_VELLO_HYBRID_BACKEND_ID =
  "vello-hybrid-wgpu" as const;
export const STUDIO_VELLO_CPU_BACKEND_ID = "vello-cpu" as const;
export const STUDIO_VELLO_HUB_ENGINE_HASH =
  "vello-hub-v13:vello-0.9.0:hybrid-compositor:vello_cpu-0.2.0" as const;

export type StudioVelloHubBackendId =
  | typeof STUDIO_VELLO_CLASSIC_BACKEND_ID
  | typeof STUDIO_VELLO_HYBRID_BACKEND_ID
  | typeof STUDIO_VELLO_CPU_BACKEND_ID;

export function isStudioVelloGpuBackendId(
  id: StudioVelloHubBackendId,
): id is typeof STUDIO_VELLO_CLASSIC_BACKEND_ID | typeof STUDIO_VELLO_HYBRID_BACKEND_ID {
  return id === STUDIO_VELLO_CLASSIC_BACKEND_ID || id === STUDIO_VELLO_HYBRID_BACKEND_ID;
}

export interface StudioVelloIslandPlacement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

export interface StudioVelloSceneIsland {
  readonly id: string;
  readonly scene: SceneIR;
  readonly placement: StudioVelloIslandPlacement;
  readonly documentIds: readonly string[];
}

export type StudioVelloIslandAdmission =
  | {
      readonly admitted: true;
      readonly island: StudioVelloSceneIsland;
    }
  | {
      readonly admitted: false;
      readonly reason:
        | "empty-island"
        | "outside-viewport"
        | "css-dimension-limit"
        | "backing-pixel-limit";
    };

function colorChannels(color: number, alpha: number) {
  return {
    r: ((color >> 16) & 0xff) / 255,
    g: ((color >> 8) & 0xff) / 255,
    b: (color & 0xff) / 255,
    a: alpha,
  };
}

function projectPoint(
  transform: StudioSceneDocumentTransform,
  point: StudioScenePoint,
): StudioScenePoint {
  return projectStudioSceneDocumentPoint(transform, point);
}

function pathForOverlay(
  overlay: StudioSceneSelectableOverlay,
  transform: StudioSceneDocumentTransform,
): PathIR {
  const { shape } = overlay;
  if (shape.kind === "polygon") {
    const verbs: PathVerbIR[] = shape.points.map((point, index) => {
      const projected = projectPoint(transform, point);
      return index === 0
        ? { v: "M", x: projected.x, y: projected.y }
        : { v: "L", x: projected.x, y: projected.y };
    });
    verbs.push({ v: "Z" });
    return { verbs };
  }

  const { x, y, width, height } = shape.bounds;
  if (shape.kind === "rect") {
    const points = [
      projectPoint(transform, { x, y }),
      projectPoint(transform, { x: x + width, y }),
      projectPoint(transform, { x: x + width, y: y + height }),
      projectPoint(transform, { x, y: y + height }),
    ];
    return {
      verbs: [
        { v: "M", x: points[0]!.x, y: points[0]!.y },
        { v: "L", x: points[1]!.x, y: points[1]!.y },
        { v: "L", x: points[2]!.x, y: points[2]!.y },
        { v: "L", x: points[3]!.x, y: points[3]!.y },
        { v: "Z" },
      ],
    };
  }

  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width / 2;
  const ry = height / 2;
  const kappa = 0.5522847498307936;
  const p = (px: number, py: number) => projectPoint(transform, { x: px, y: py });
  const top = p(cx, cy - ry);
  const right = p(cx + rx, cy);
  const bottom = p(cx, cy + ry);
  const left = p(cx - rx, cy);
  const topRight1 = p(cx + rx * kappa, cy - ry);
  const topRight2 = p(cx + rx, cy - ry * kappa);
  const bottomRight1 = p(cx + rx, cy + ry * kappa);
  const bottomRight2 = p(cx + rx * kappa, cy + ry);
  const bottomLeft1 = p(cx - rx * kappa, cy + ry);
  const bottomLeft2 = p(cx - rx, cy + ry * kappa);
  const topLeft1 = p(cx - rx, cy - ry * kappa);
  const topLeft2 = p(cx - rx * kappa, cy - ry);
  return {
    verbs: [
      { v: "M", x: top.x, y: top.y },
      {
        v: "C",
        c1x: topRight1.x,
        c1y: topRight1.y,
        c2x: topRight2.x,
        c2y: topRight2.y,
        x: right.x,
        y: right.y,
      },
      {
        v: "C",
        c1x: bottomRight1.x,
        c1y: bottomRight1.y,
        c2x: bottomRight2.x,
        c2y: bottomRight2.y,
        x: bottom.x,
        y: bottom.y,
      },
      {
        v: "C",
        c1x: bottomLeft1.x,
        c1y: bottomLeft1.y,
        c2x: bottomLeft2.x,
        c2y: bottomLeft2.y,
        x: left.x,
        y: left.y,
      },
      {
        v: "C",
        c1x: topLeft1.x,
        c1y: topLeft1.y,
        c2x: topLeft2.x,
        c2y: topLeft2.y,
        x: top.x,
        y: top.y,
      },
      { v: "Z" },
    ],
  };
}

function transformPathToBacking(
  path: PathIR,
  left: number,
  top: number,
  dpr: number,
): PathIR {
  const x = (value: number) => (value - left) * dpr;
  const y = (value: number) => (value - top) * dpr;
  return {
    verbs: path.verbs.map((verb): PathVerbIR => {
      switch (verb.v) {
        case "M":
        case "L":
          return { v: verb.v, x: x(verb.x), y: y(verb.y) };
        case "Q":
          return {
            v: "Q",
            cx: x(verb.cx),
            cy: y(verb.cy),
            x: x(verb.x),
            y: y(verb.y),
          };
        case "C":
          return {
            v: "C",
            c1x: x(verb.c1x),
            c1y: y(verb.c1y),
            c2x: x(verb.c2x),
            c2y: y(verb.c2y),
            x: x(verb.x),
            y: y(verb.y),
          };
        case "Z":
          return { v: "Z" };
      }
    }),
  };
}

/** Lower the existing neutral selectable-overlay seam into a bounded SceneIR. */
export function lowerStudioSceneOverlaysToVelloIsland(
  overlays: readonly StudioSceneSelectableOverlay[],
  viewport: StudioSceneViewportMetrics,
  limits: {
    readonly maxCssDimension?: number;
    readonly maxBackingPixelArea?: number;
  } = {},
): StudioVelloIslandAdmission {
  validateStudioSceneViewport(viewport);
  const visible = overlays.filter((overlay) => overlay.visible !== false);
  if (visible.length === 0) return { admitted: false, reason: "empty-island" };
  for (const overlay of visible) validateStudioSceneSelectableOverlay(overlay);

  const transform = resolveStudioSceneDocumentTransform(viewport);
  const paths = visible.map((overlay) => ({
    overlay,
    path: pathForOverlay(overlay, transform),
  }));
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const meanScale = (Math.abs(transform.scaleX) + Math.abs(transform.scaleY)) / 2;
  for (const { overlay, path } of paths) {
    const bounds = pathBounds(path);
    if (!bounds) continue;
    const strokePadding = (overlay.stroke?.width ?? 0) * meanScale / 2 + 2;
    minX = Math.min(minX, bounds.minX - strokePadding);
    minY = Math.min(minY, bounds.minY - strokePadding);
    maxX = Math.max(maxX, bounds.maxX + strokePadding);
    maxY = Math.max(maxY, bounds.maxY + strokePadding);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { admitted: false, reason: "empty-island" };
  }

  const left = Math.max(0, Math.floor(minX));
  const top = Math.max(0, Math.floor(minY));
  const right = Math.min(viewport.width, Math.ceil(maxX));
  const bottom = Math.min(viewport.height, Math.ceil(maxY));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) {
    return { admitted: false, reason: "outside-viewport" };
  }

  const maxCssDimension = limits.maxCssDimension
    ?? STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.maxCssDimension;
  if (width > maxCssDimension || height > maxCssDimension) {
    return { admitted: false, reason: "css-dimension-limit" };
  }
  const dpr = Math.max(1, Math.min(3, viewport.dpr));
  const backingWidth = Math.max(1, Math.ceil(width * dpr));
  const backingHeight = Math.max(1, Math.ceil(height * dpr));
  const maxBackingPixelArea = limits.maxBackingPixelArea
    ?? STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.maxBackingPixelArea;
  if (backingWidth * backingHeight > maxBackingPixelArea) {
    return { admitted: false, reason: "backing-pixel-limit" };
  }

  const nodes: SceneNodeIR[] = [];
  for (const { overlay, path } of paths.sort(
    (a, b) => a.overlay.zIndex - b.overlay.zIndex,
  )) {
    const localPath = transformPathToBacking(path, left, top, dpr);
    if (overlay.fill) {
      nodes.push({
        id: `${overlay.documentId}:selection-fill`,
        kind: "fill-path",
        path: localPath,
        paint: {
          kind: "solid",
          color: colorChannels(overlay.fill.color, overlay.fill.alpha),
        },
        fillRule: "nonzero",
        opacity: overlay.opacity ?? 1,
        blend: "src-over",
      });
    }
    if (overlay.stroke) {
      nodes.push({
        id: `${overlay.documentId}:selection-stroke`,
        kind: "stroke-path",
        path: localPath,
        paint: {
          kind: "solid",
          color: colorChannels(overlay.stroke.color, overlay.stroke.alpha),
        },
        strokeWidth: overlay.stroke.width * meanScale * dpr,
        cap: "round",
        join: "round",
        miterLimit: 4,
        opacity: overlay.opacity ?? 1,
        blend: "src-over",
      });
    }
  }
  if (nodes.length === 0) return { admitted: false, reason: "empty-island" };

  const scene = sceneIRSchema.parse({
    version: 11,
    width: backingWidth,
    height: backingHeight,
    background: { r: 0, g: 0, b: 0, a: 0 },
    nodes,
  });
  return {
    admitted: true,
    island: {
      id: `selection:${visible.map(({ documentId }) => documentId).join(",")}`,
      scene,
      placement: { left, top, width, height, dpr },
      documentIds: Object.freeze(visible.map(({ documentId }) => documentId)),
    },
  };
}

export interface StudioVelloCpuFrame {
  readonly backendId: typeof STUDIO_VELLO_CPU_BACKEND_ID;
  readonly kind: "pixels";
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

export interface StudioVelloGpuFrame {
  readonly backendId:
    | typeof STUDIO_VELLO_CLASSIC_BACKEND_ID
    | typeof STUDIO_VELLO_HYBRID_BACKEND_ID;
  readonly kind: "texture";
  readonly width: number;
  readonly height: number;
  readonly device: GPUDevice;
  readonly texture: GPUTexture;
  readonly release: () => void;
}

export type StudioVelloBackendFrame = StudioVelloCpuFrame | StudioVelloGpuFrame;

export interface StudioVelloBackendAvailability {
  readonly available: boolean;
  readonly reason: string | null;
}

export interface StudioVelloHubBackend {
  readonly id: StudioVelloHubBackendId;
  availability(): Promise<StudioVelloBackendAvailability>;
  render(scene: SceneIR): Promise<StudioVelloBackendFrame>;
  compareToReference?(scene: SceneIR): Promise<GpuCpuComparison>;
  dispose(): void;
}

type StudioVelloEngineModule = typeof import("@toonspectrum/studio-engine-vello");
type StudioVelloEngineLoader = () => Promise<StudioVelloEngineModule>;

const loadStudioVelloEngine: StudioVelloEngineLoader = () =>
  import("@toonspectrum/studio-engine-vello");

export function createStudioVelloCpuReferenceBackend(
  loadEngine: StudioVelloEngineLoader = loadStudioVelloEngine,
): StudioVelloHubBackend {
  let enginePromise: Promise<StudioVelloEngineModule> | null = null;
  const engine = async () => {
    enginePromise ??= loadEngine().then(async (loaded) => {
      await loaded.loadVelloWasm();
      return loaded;
    });
    return enginePromise;
  };
  return {
    id: STUDIO_VELLO_CPU_BACKEND_ID,
    async availability() {
      try {
        await engine();
        return { available: true, reason: null };
      } catch (error) {
        return {
          available: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async render(scene) {
      const loaded = await engine();
      return {
        backendId: STUDIO_VELLO_CPU_BACKEND_ID,
        kind: "pixels",
        width: scene.width,
        height: scene.height,
        pixels: loaded.renderSceneToPixels(scene),
      };
    },
    dispose() {
      // wasm-pack CPU module is process-scoped and owns no external device.
    },
  };
}

export function createStudioVelloClassicBrowserBackend(options: {
  readonly loadEngine?: StudioVelloEngineLoader;
  readonly acquireDevice?: typeof acquireStudioGpuDevice;
} = {}): StudioVelloHubBackend {
  const loadEngine = options.loadEngine ?? loadStudioVelloEngine;
  const acquireDevice = options.acquireDevice ?? acquireStudioGpuDevice;
  let lease: StudioGpuDeviceLease | null = null;
  let enginePromise: Promise<StudioVelloEngineModule> | null = null;
  let readyPromise: Promise<StudioVelloBackendAvailability> | null = null;

  const ready = async (): Promise<StudioVelloBackendAvailability> => {
    if (lease && !lease.lost && !lease.released) {
      return { available: true, reason: null };
    }
    readyPromise ??= (async () => {
      const nextLease = await acquireDevice();
      if (!nextLease) {
        return { available: false, reason: "StudioGpuFabric device unavailable" };
      }
      try {
        const loaded = await loadEngine();
        await loaded.loadVelloGpuBrowser();
        await loaded.adoptGpuDevice(nextLease.device);
        const adopted = await loaded.gpuDeviceHandle();
        if (adopted !== nextLease.device) {
          throw new Error("Vello Classic did not adopt the StudioGpuFabric GPUDevice");
        }
        lease = nextLease;
        enginePromise = Promise.resolve(loaded);
        return { available: true, reason: null };
      } catch (error) {
        nextLease.release();
        return {
          available: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    })();
    const result = await readyPromise;
    if (!result.available) readyPromise = null;
    return result;
  };

  const requireReady = async () => {
    const availability = await ready();
    if (!availability.available || !lease || !enginePromise) {
      throw new Error(availability.reason ?? "Vello Classic backend unavailable");
    }
    if (lease.lost) throw new Error("Vello Classic GPUDevice is lost");
    return { loaded: await enginePromise, lease };
  };

  return {
    id: STUDIO_VELLO_CLASSIC_BACKEND_ID,
    availability: ready,
    async render(scene) {
      const current = await requireReady();
      const texture = await current.loaded.renderSceneToTextureGpu(scene);
      let released = false;
      return {
        backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
        kind: "texture",
        width: scene.width,
        height: scene.height,
        device: current.lease.device,
        texture,
        release() {
          if (released) return;
          released = true;
          try {
            texture.destroy();
          } catch {
            // A texture from a lost device may already be invalidated.
          }
        },
      };
    },
    async compareToReference(scene) {
      const current = await requireReady();
      return current.loaded.compareGpuVsCpu(scene);
    },
    dispose() {
      lease?.release();
      lease = null;
      readyPromise = null;
    },
  };
}

export function createStudioVelloHybridBrowserBackend(
  classic: StudioVelloHubBackend = createStudioVelloClassicBrowserBackend(),
): StudioVelloHubBackend {
  return {
    id: STUDIO_VELLO_HYBRID_BACKEND_ID,
    availability: () => classic.availability(),
    async render(scene) {
      const frame = await classic.render(scene);
      if (frame.kind === "pixels") return frame;
      return { ...frame, backendId: STUDIO_VELLO_HYBRID_BACKEND_ID };
    },
    compareToReference: classic.compareToReference
      ? (scene) => classic.compareToReference!(scene)
      : undefined,
    dispose() {
      // The Classic backend owns the fabric lease when the facade wraps it.
    },
  };
}

export interface StudioVelloHubPresentationTarget {
  /** Atomically makes a completed frame primary; the target consumes the frame. */
  present(frame: StudioVelloBackendFrame): Promise<void>;
  /** Must not clear or hide the current primary frame. */
  holdLastGood(reason: string): void;
  /**
   * Drops every GPU resource still bound to a device that the browser lost.
   * Like `holdLastGood` it must not clear or hide the current primary frame.
   * Only targets that adopt a `GPUDevice` need to implement it; a target that
   * never holds one has nothing to release.
   */
  releaseLostDevice?(reason: string): void;
}

export type StudioVelloHubDecision =
  | "gpu-first"
  | "reference"
  | "cached"
  | "hysteresis-hold"
  | "switched";

export interface StudioVelloHubRenderReceipt {
  readonly requestId: number;
  readonly primarySurfaceOwner: "vello-hub";
  readonly islandScope: typeof STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.scope;
  readonly backendId: StudioVelloHubBackendId;
  readonly decision: StudioVelloHubDecision;
  readonly expectedGainPct: number | null;
  readonly referenceOnly: boolean;
  /** Never implies PromotionRegistry approval or durable product-wide promotion. */
  readonly admissionMode: typeof STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.admissionMode;
  readonly productWidePromoted: false;
}

export interface StudioVelloHubSnapshot {
  readonly disposed: boolean;
  readonly lastGoodFrame: StudioVelloHubRenderReceipt | null;
  readonly killedBackends: ReadonlyArray<{ providerId: string; reason: string }>;
  readonly hybridSparseCandidate: typeof STUDIO_VELLO_HYBRID_SPARSE_CANDIDATE;
  readonly hybridCompositor: typeof STUDIO_VELLO_HYBRID_COMPOSITOR;
  readonly admissionMode: typeof STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.admissionMode;
  readonly persistentWinnerStorage: false;
  readonly productWidePromoted: false;
}

export interface StudioVelloHubOptions {
  readonly target: StudioVelloHubPresentationTarget;
  readonly cpuBackend?: StudioVelloHubBackend;
  readonly classicBackend?: StudioVelloHubBackend;
  readonly hybridBackend?: StudioVelloHubBackend;
  readonly now?: () => number;
  readonly deviceHash?: string;
  /** Live input-state reader. A read failure is treated as pen-down (fail-closed). */
  readonly isPenDown?: () => boolean;
  readonly onUnavailable?: (
    failure: StudioVelloHubUnavailable,
  ) => void;
  readonly subscribeDeviceLoss?: (
    listener: (event: StudioGpuDeviceLossEvent) => void,
  ) => () => void;
}

export interface StudioVelloHubUnavailable {
  readonly source:
    | "selection"
    | "render"
    | "presentation"
    | "device-loss";
  readonly backendId:
    | typeof STUDIO_VELLO_CLASSIC_BACKEND_ID
    | typeof STUDIO_VELLO_HYBRID_BACKEND_ID
    | null;
  readonly reason: string;
  readonly cause: unknown;
}

const STUDIO_VELLO_FAILURE_STAGE: Record<
  StudioVelloHubUnavailable["source"],
  StudioEngineFailureStage
> = {
  selection: "capability",
  render: "render",
  presentation: "presentation",
  "device-loss": "device-loss",
};

export interface StudioVelloQaReferenceComparison {
  readonly backendId:
    | typeof STUDIO_VELLO_CLASSIC_BACKEND_ID
    | typeof STUDIO_VELLO_HYBRID_BACKEND_ID;
  readonly pass: boolean;
  readonly mismatchPct: number;
  readonly error: string | null;
}

export class StudioVelloHubUnavailableError extends StudioEngineUnavailableError {
  readonly failure: StudioVelloHubUnavailable;

  constructor(failure: StudioVelloHubUnavailable) {
    super({
      providerId: failure.backendId ?? "studio-gpu-fabric",
      stage: STUDIO_VELLO_FAILURE_STAGE[failure.source],
      message: `Studio Vello unavailable (${failure.source}): ${failure.reason}`,
      cause: failure.cause,
    });
    this.name = "StudioVelloHubUnavailableError";
    this.failure = failure;
  }
}

export class StudioVelloHubRenderSupersededError extends Error {
  constructor() {
    super("StudioVelloHub render superseded before presentation");
    this.name = "StudioVelloHubRenderSupersededError";
  }
}

function defaultDeviceHash(): string {
  if (typeof navigator === "undefined") return "server:no-gpu";
  const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
  return `${navigator.userAgent}|dpr:${dpr}`;
}

function discardFrame(frame: StudioVelloBackendFrame): void {
  if (frame.kind === "texture") frame.release();
}

/**
 * Selected-GPU runtime. CPU is explicit QA/reference only. A switch is
 * impossible while pen-down. Any selected GPU-path failure kills the product
 * lane and is surfaced as unavailable without pixel fallback.
 */
export class StudioVelloHub {
  private readonly target: StudioVelloHubPresentationTarget;
  private readonly cpuBackend: StudioVelloHubBackend;
  private readonly classicBackend: StudioVelloHubBackend;
  private readonly hybridBackend: StudioVelloHubBackend;
  private readonly ownsHybridBackend: boolean;
  private readonly now: () => number;
  private readonly deviceHash: string;
  private readonly isPenDown: (() => boolean) | undefined;
  private readonly onUnavailable: StudioVelloHubOptions["onUnavailable"];
  private readonly costModel = new ProviderCostModel();
  private readonly winnerCache = new WinnerCache();
  private readonly hysteresis = new HysteresisPolicy(12);
  private readonly killSwitch = new RemoteKillSwitch();
  private readonly renderCounts = new Map<StudioVelloHubBackendId, number>();
  private readonly unsubscribeDeviceLoss: () => void;
  private requestId = 0;
  private productRenderEpoch = 0;
  private disposed = false;
  private hasProductGpuAttempt = false;
  private lastGoodFrame: StudioVelloHubRenderReceipt | null = null;

  constructor(options: StudioVelloHubOptions) {
    this.target = options.target;
    this.cpuBackend = options.cpuBackend ?? createStudioVelloCpuReferenceBackend();
    this.classicBackend = options.classicBackend
      ?? createStudioVelloClassicBrowserBackend();
    this.ownsHybridBackend = options.hybridBackend !== undefined;
    this.hybridBackend = options.hybridBackend
      ?? createStudioVelloHybridBrowserBackend(this.classicBackend);
    this.now = options.now ?? (() => performance.now());
    this.deviceHash = `${options.deviceHash ?? defaultDeviceHash()}|${STUDIO_VELLO_HUB_ENGINE_HASH}`;
    this.isPenDown = options.isPenDown;
    this.onUnavailable = options.onUnavailable;
    const subscribe = options.subscribeDeviceLoss ?? onStudioGpuDeviceLost;
    this.unsubscribeDeviceLoss = subscribe((event) => {
      void this.handleDeviceLoss(`device-lost:${event.epoch}:${event.reason}`);
    });
  }

  private resolvePenDown(explicit: boolean): boolean {
    if (explicit) return true;
    try {
      return this.isPenDown?.() ?? false;
    } catch {
      // Input-state uncertainty must never authorize a renderer switch mid-stroke.
      return true;
    }
  }

  private markUnavailable(
    source: StudioVelloHubUnavailable["source"],
    backendId: StudioVelloHubUnavailable["backendId"],
    reason: string,
    cause: unknown,
  ): StudioVelloHubUnavailableError {
    const failure: StudioVelloHubUnavailable = { source, backendId, reason, cause };
    if (!this.disposed && !(cause instanceof StudioVelloHubRenderSupersededError)) {
      this.invalidatePendingProductRender();
      this.killGpuBackends(`${source}:${reason}`);
      this.target.holdLastGood(`unavailable-${source}:${reason}`);
      try {
        this.onUnavailable?.(failure);
      } catch {
        // Product unavailability must not be hidden by an observer failure.
      }
    }
    return new StudioVelloHubUnavailableError(failure);
  }

  /**
   * Invalidates product GPU work that has not completed presentation yet.
   *
   * Canvas-island, document-revision, and parked-surface transitions call this
   * before changing target state. Explicit CPU reference work has a separate
   * contract and is not cancelled by a product-surface transition.
   */
  invalidatePendingProductRender(): void {
    if (this.disposed) return;
    this.productRenderEpoch += 1;
  }

  private recordDuration(
    backendId: StudioVelloHubBackendId,
    bucket: string,
    milliseconds: number,
  ): void {
    const count = this.renderCounts.get(backendId) ?? 0;
    this.renderCounts.set(backendId, count + 1);
    if (count === 0) {
      this.costModel.record(backendId, bucket, { coldMs: milliseconds });
    } else {
      this.costModel.record(backendId, bucket, { warmMs: milliseconds });
    }
  }

  private preferredGpuBackend(
    scene: SceneIR,
    preferred?: StudioVelloHubBackendId,
  ): typeof STUDIO_VELLO_CLASSIC_BACKEND_ID | typeof STUDIO_VELLO_HYBRID_BACKEND_ID {
    if (preferred === STUDIO_VELLO_HYBRID_BACKEND_ID) return STUDIO_VELLO_HYBRID_BACKEND_ID;
    if (preferred === STUDIO_VELLO_CLASSIC_BACKEND_ID) return STUDIO_VELLO_CLASSIC_BACKEND_ID;
    const fingerprint = computeSceneFingerprint(scene);
    return fingerprint.textCount > 0 || fingerprint.gradientCount > 2
      ? STUDIO_VELLO_HYBRID_BACKEND_ID
      : STUDIO_VELLO_CLASSIC_BACKEND_ID;
  }

  private liveGpuBackend(
    preferred: typeof STUDIO_VELLO_CLASSIC_BACKEND_ID | typeof STUDIO_VELLO_HYBRID_BACKEND_ID,
  ): typeof STUDIO_VELLO_CLASSIC_BACKEND_ID | typeof STUDIO_VELLO_HYBRID_BACKEND_ID | null {
    return this.killSwitch.isKilled(preferred) ? null : preferred;
  }

  private chooseBackend(
    scene: SceneIR,
    penDown: boolean,
    preferred?: typeof STUDIO_VELLO_CLASSIC_BACKEND_ID | typeof STUDIO_VELLO_HYBRID_BACKEND_ID,
  ): {
    backendId:
      | typeof STUDIO_VELLO_CLASSIC_BACKEND_ID
      | typeof STUDIO_VELLO_HYBRID_BACKEND_ID;
    decision: Exclude<StudioVelloHubDecision, "reference">;
    expectedGainPct: number | null;
  } | null {
    const bucket = computeSceneFingerprint(scene).bucket;
    const gpuId = this.liveGpuBackend(this.preferredGpuBackend(scene, preferred));
    if (!gpuId) {
      return null;
    }
    const cached = this.winnerCache.get(bucket, this.deviceHash);
    if (!cached || !isStudioVelloGpuBackendId(
      cached.providerId as StudioVelloHubBackendId,
    )) {
      return { backendId: gpuId, decision: "gpu-first", expectedGainPct: null };
    }
    const incumbentId = this.killSwitch.isKilled(cached.providerId)
      ? gpuId
      : cached.providerId as StudioVelloHubBackendId;
    if (!isStudioVelloGpuBackendId(incumbentId)) {
      return { backendId: gpuId, decision: "gpu-first", expectedGainPct: null };
    }
    const challengerId = incumbentId === STUDIO_VELLO_CLASSIC_BACKEND_ID
      ? STUDIO_VELLO_HYBRID_BACKEND_ID
      : STUDIO_VELLO_CLASSIC_BACKEND_ID;
    if (this.killSwitch.isKilled(challengerId) || incumbentId === gpuId) {
      return { backendId: incumbentId, decision: "cached", expectedGainPct: null };
    }
    const incumbentMs = this.costModel.estimate(incumbentId, bucket)?.warmP50Ms;
    const challengerMs = this.costModel.estimate(challengerId, bucket)?.warmP50Ms;
    if (incumbentMs === null || incumbentMs === undefined
      || challengerMs === null || challengerMs === undefined) {
      return { backendId: incumbentId, decision: "cached", expectedGainPct: null };
    }
    const switchDecision = this.hysteresis.evaluate({
      incumbentWarmMs: incumbentMs,
      challengerWarmMs: challengerMs,
      penDown,
    });
    if (!switchDecision.allow) {
      return {
        backendId: incumbentId,
        decision: switchDecision.reason === "no-gain"
          ? "cached"
          : "hysteresis-hold",
        expectedGainPct: switchDecision.expectedGainPct,
      };
    }
    this.winnerCache.set(bucket, this.deviceHash, {
      providerId: challengerId,
      expectedWarmMs: challengerMs,
      decidedAtSample: this.costModel.sampleCount(challengerId, bucket),
    });
    return {
      backendId: challengerId,
      decision: "switched",
      expectedGainPct: switchDecision.expectedGainPct,
    };
  }

  private async renderBackend(
    backend: StudioVelloHubBackend,
    scene: SceneIR,
    bucket: string,
  ): Promise<StudioVelloBackendFrame> {
    const startedAt = this.now();
    const frame = await backend.render(scene);
    this.recordDuration(backend.id, bucket, Math.max(0, this.now() - startedAt));
    return frame;
  }

  private renderWasSuperseded(
    requestId: number,
    productRenderEpoch: number,
    referenceOnly: boolean,
  ): boolean {
    return this.disposed
      || requestId !== this.requestId
      || (!referenceOnly && productRenderEpoch !== this.productRenderEpoch);
  }

  async render(
    scene: SceneIR,
    options: {
      readonly penDown?: boolean;
      readonly preferredBackend?:
        | typeof STUDIO_VELLO_CLASSIC_BACKEND_ID
        | typeof STUDIO_VELLO_HYBRID_BACKEND_ID;
    } = {},
  ): Promise<StudioVelloHubRenderReceipt> {
    return this.renderInternal(sceneIRSchema.parse(scene), {
      penDown: this.resolvePenDown(options.penDown ?? false),
      referenceOnly: false,
      preferredBackend: options.preferredBackend,
    });
  }

  /** Explicit golden/reference render. Product code must never call this as recovery. */
  async renderReference(
    scene: SceneIR,
    options: { readonly penDown?: boolean } = {},
  ): Promise<StudioVelloHubRenderReceipt> {
    return this.renderInternal(sceneIRSchema.parse(scene), {
      penDown: this.resolvePenDown(options.penDown ?? false),
      referenceOnly: true,
    });
  }

  private killGpuBackends(reason: string): void {
    this.killSwitch.kill(STUDIO_VELLO_CLASSIC_BACKEND_ID, reason);
    this.killSwitch.kill(STUDIO_VELLO_HYBRID_BACKEND_ID, reason);
    this.winnerCache.evictProvider(STUDIO_VELLO_CLASSIC_BACKEND_ID);
    this.winnerCache.evictProvider(STUDIO_VELLO_HYBRID_BACKEND_ID);
  }

  private backendFor(id: StudioVelloHubBackendId): StudioVelloHubBackend {
    if (id === STUDIO_VELLO_CLASSIC_BACKEND_ID) return this.classicBackend;
    if (id === STUDIO_VELLO_HYBRID_BACKEND_ID) return this.hybridBackend;
    return this.cpuBackend;
  }

  private async renderInternal(
    scene: SceneIR,
    options: {
      readonly penDown: boolean;
      readonly referenceOnly: boolean;
      readonly preferredBackend?:
        | typeof STUDIO_VELLO_CLASSIC_BACKEND_ID
        | typeof STUDIO_VELLO_HYBRID_BACKEND_ID;
    },
  ): Promise<StudioVelloHubRenderReceipt> {
    if (this.disposed) throw new Error("StudioVelloHub is disposed");
    const penDown = this.resolvePenDown(options.penDown);
    this.requestId += 1;
    const requestId = this.requestId;
    const productRenderEpoch = this.productRenderEpoch;
    const fingerprint = computeSceneFingerprint(scene);
    const selection = options.referenceOnly
      ? {
          backendId: STUDIO_VELLO_CPU_BACKEND_ID,
          decision: "reference" as const,
          expectedGainPct: null,
        }
      : this.chooseBackend(scene, penDown, options.preferredBackend);
    if (!selection) {
      const preferred = this.preferredGpuBackend(scene, options.preferredBackend);
      const reason = `backend-killed:${preferred}`;
      throw this.markUnavailable("selection", preferred, reason, new Error(reason));
    }
    const selectedGpuBackendId = isStudioVelloGpuBackendId(selection.backendId)
      ? selection.backendId
      : null;
    const backend = this.backendFor(selection.backendId);
    if (backend.id !== selection.backendId) {
      const reason = `selected backend ${selection.backendId} resolved ${backend.id}`;
      const error = new Error(reason);
      if (options.referenceOnly) throw error;
      throw this.markUnavailable("render", selectedGpuBackendId, reason, error);
    }
    if (!options.referenceOnly) this.hasProductGpuAttempt = true;
    let frame: StudioVelloBackendFrame;
    try {
      frame = await this.renderBackend(backend, scene, fingerprint.bucket);
    } catch (error) {
      // An older request may reject after a newer product render already owns this hub. That
      // rejection belongs to the discarded request; it must not kill the selected provider,
      // invalidate the newer epoch, or cover the newer scene with an unavailable state.
      if (this.renderWasSuperseded(requestId, productRenderEpoch, options.referenceOnly)) {
        throw new StudioVelloHubRenderSupersededError();
      }
      if (options.referenceOnly) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw this.markUnavailable("render", selectedGpuBackendId, reason, error);
    }

    if (this.renderWasSuperseded(requestId, productRenderEpoch, options.referenceOnly)) {
      discardFrame(frame);
      throw new StudioVelloHubRenderSupersededError();
    }

    const frameContractError = options.referenceOnly
      ? frame.kind !== "pixels" || frame.backendId !== STUDIO_VELLO_CPU_BACKEND_ID
        ? `explicit CPU reference returned ${frame.kind}:${frame.backendId}`
        : null
      : frame.kind !== "texture" || frame.backendId !== selection.backendId
        ? `selected GPU ${selection.backendId} returned ${frame.kind}:${frame.backendId}`
        : null;
    if (frameContractError) {
      discardFrame(frame);
      const error = new Error(frameContractError);
      if (options.referenceOnly) throw error;
      throw this.markUnavailable(
        "render",
        selectedGpuBackendId,
        frameContractError,
        error,
      );
    }

    try {
      await this.target.present(frame);
    } catch (error) {
      discardFrame(frame);
      if (this.renderWasSuperseded(requestId, productRenderEpoch, options.referenceOnly)) {
        throw new StudioVelloHubRenderSupersededError();
      }
      if (options.referenceOnly) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw this.markUnavailable("presentation", selectedGpuBackendId, reason, error);
    }
    if (this.renderWasSuperseded(requestId, productRenderEpoch, options.referenceOnly)) {
      throw new StudioVelloHubRenderSupersededError();
    }

    const existingWinner = this.winnerCache.get(fingerprint.bucket, this.deviceHash);
    if (!options.referenceOnly && !existingWinner) {
      const estimate = this.costModel.estimate(backend.id, fingerprint.bucket);
      this.winnerCache.set(fingerprint.bucket, this.deviceHash, {
        providerId: backend.id,
        expectedWarmMs: estimate?.warmP50Ms ?? estimate?.coldP50Ms ?? 0,
        decidedAtSample: this.costModel.sampleCount(backend.id, fingerprint.bucket),
      });
    }
    const receipt: StudioVelloHubRenderReceipt = {
      requestId,
      primarySurfaceOwner: "vello-hub",
      islandScope: STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.scope,
      backendId: backend.id,
      decision: selection.decision,
      expectedGainPct: selection.expectedGainPct,
      referenceOnly: options.referenceOnly,
      admissionMode: STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.admissionMode,
      productWidePromoted: false,
    };
    this.lastGoodFrame = receipt;
    return receipt;
  }

  /**
   * Explicit QA-only GPU/CPU comparison.
   *
   * This method never presents pixels, records product selection evidence,
   * invalidates pending product work, kills a provider, or emits unavailable.
   * Product surfaces must not call it from render or recovery paths.
   */
  async compareToReferenceForQa(
    scene: SceneIR,
    options: {
      readonly backendId?:
        | typeof STUDIO_VELLO_CLASSIC_BACKEND_ID
        | typeof STUDIO_VELLO_HYBRID_BACKEND_ID;
    } = {},
  ): Promise<StudioVelloQaReferenceComparison> {
    if (this.disposed) throw new Error("StudioVelloHub is disposed");
    const parsedScene = sceneIRSchema.parse(scene);
    const backendId = options.backendId ?? STUDIO_VELLO_CLASSIC_BACKEND_ID;
    const backend = this.backendFor(backendId);
    const availability = await backend.availability();
    if (!availability.available) {
      throw new Error(
        `QA comparison backend unavailable:${backendId}:${availability.reason ?? "unknown"}`,
      );
    }
    if (!backend.compareToReference) {
      throw new Error(`QA comparison unsupported:${backendId}`);
    }
    const comparison = await backend.compareToReference(parsedScene);
    const gate = createFuzzyNeighborhoodGate({
      fuzzyDelta: 48,
      mismatchPctGate: STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.qaVisualMismatchPctGate,
    });
    const report = await new Promise<ShadowComparisonReport>((resolve) => {
      void runShadowComparison({
        winnerRender: () => comparison.cpuPixels,
        shadowRender: () => comparison.gpuPixels,
        gate,
        width: comparison.width,
        height: comparison.height,
        onReport: resolve,
      });
    });
    return {
      backendId,
      pass: report.gate?.pass ?? false,
      mismatchPct: report.gate?.mismatchPct ?? Number.POSITIVE_INFINITY,
      error: report.error ?? null,
    };
  }

  async handleDeviceLoss(reason: string): Promise<null> {
    if (this.disposed || !this.hasProductGpuAttempt) return null;
    // The adopted device is gone: release it, retain the last completed frame,
    // and surface an explicit unavailable state. No CPU frame is presented.
    this.target.releaseLostDevice?.(reason);
    this.markUnavailable("device-loss", null, reason, new Error(reason));
    return null;
  }

  snapshot(): StudioVelloHubSnapshot {
    return {
      disposed: this.disposed,
      lastGoodFrame: this.lastGoodFrame,
      killedBackends: this.killSwitch.listKilled(),
      hybridSparseCandidate: STUDIO_VELLO_HYBRID_SPARSE_CANDIDATE,
      hybridCompositor: STUDIO_VELLO_HYBRID_COMPOSITOR,
      admissionMode: STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.admissionMode,
      persistentWinnerStorage: false,
      productWidePromoted: false,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.invalidatePendingProductRender();
    this.disposed = true;
    this.requestId += 1;
    this.unsubscribeDeviceLoss();
    this.cpuBackend.dispose();
    this.classicBackend.dispose();
    if (this.ownsHybridBackend) this.hybridBackend.dispose();
  }
}

export function createStudioVelloHub(
  options: StudioVelloHubOptions,
): StudioVelloHub {
  return new StudioVelloHub(options);
}
