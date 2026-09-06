/**
 * studio-gpu-bristle host — the async→sync bridge between a Konva `sceneFunc` and the GPU worker.
 *
 * Konva's `sceneFunc` is synchronous and this repo has already established the only shape that
 * satisfies both that and the prohibition on heavy synchronous work in a render body:
 * `requestStudioLivingInkSettledBakeDabs` (`../studio-living-ink-settled-bake-v1.ts:1231-1256`) —
 * content-signature cache key, a pending-job map, a listener `Set`, **return `null` on miss**, and
 * a `renderGeneration` counter the caller bumps in `onReady` so a React-Compiler-memoised render
 * body re-executes the call. This module copies that shape verbatim.
 *
 * For a brush that explicitly selects this lane, `null` means pending or unavailable. The caller
 * must preserve the source stroke and paint no substitute provider; only a proven GPU bitmap owns
 * pixels. Non-GPU brush ids remain on their separately selected oil-carrier route.
 *
 * BUNDLE CONTRACT. This module is route-reachable (`StudioDrawNode.tsx` imports it), so it must
 * never statically value-import `studio-gpu-bristle-runtime.ts`, `studio-gpu-bristle-wgsl.ts` or
 * `studio-gpu-fabric.ts` — the last of which value-imports the whole GPU filter runtime at its
 * `:28`. The worker is reached through `new Worker(new URL(…, import.meta.url))`, which Vite emits
 * as its own chunk, and every type this file shares with the worker crosses as `import type`, which
 * `verbatimModuleSyntax` erases completely. `studio-gpu-bristle-route-import-boundary.test.ts`
 * fails the build if any of that stops being true.
 */

import { acceptStudioGpuBristleSurface } from "./studio-gpu-bristle-admission";
import {
  clampStudioGpuBristleCount,
  STUDIO_GPU_BRISTLE_LIMITS,
  studioFluidPaintRgbToRyb,
} from "./studio-gpu-bristle-contract";

import type {
  StudioGpuBristleStation,
  StudioGpuBristleTuftOptions,
} from "./studio-gpu-bristle-reference";
import type { FxOilDab } from "../studio-fx-brush";
import type { StudioGpuBristleSurface } from "./studio-gpu-bristle-runtime";

export const STUDIO_GPU_BRISTLE_HOST_VERSION = "studio-gpu-bristle-host-v1" as const;

/** Active draft plus one settling stroke. Anything older is closed and dropped. */
export const STUDIO_GPU_BRISTLE_MAX_RESIDENT_STROKES = 2;

export interface StudioGpuBristleOverlayRequest {
  /** Stable per-element key. `el.id` at the call site. */
  readonly strokeKey: string;
  readonly tuft: StudioGpuBristleTuftOptions;
  readonly surface: StudioGpuBristleSurface;
  readonly stations: readonly StudioGpuBristleStation[];
  readonly opacity: number;
}

export interface StudioGpuBristleOverlay {
  readonly bitmap: ImageBitmap;
  /** Destination rectangle in the Konva context's own coordinate space. */
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
  readonly consumedStationCount: number;
}

/* -------------------------------------------------------------------------------------------- */
/* Worker protocol. The worker imports these as types only.                                        */
/* -------------------------------------------------------------------------------------------- */

export interface StudioGpuBristleWorkerAdvanceMessage {
  readonly kind: "studio-gpu-bristle-advance";
  readonly jobId: number;
  readonly strokeKey: string;
  /** True → the worker drops any state for `strokeKey` and replays from station 0. */
  readonly reset: boolean;
  readonly tuft: StudioGpuBristleTuftOptions;
  readonly surface: StudioGpuBristleSurface;
  readonly opacity: number;
  /** The suffix to consume. With `reset` it is the whole stroke. */
  readonly stations: readonly StudioGpuBristleStation[];
  readonly consumedStationCount: number;
}

export interface StudioGpuBristleWorkerDisposeMessage {
  readonly kind: "studio-gpu-bristle-dispose";
  readonly strokeKey: string;
}

export type StudioGpuBristleWorkerRequest =
  | StudioGpuBristleWorkerAdvanceMessage
  | StudioGpuBristleWorkerDisposeMessage;

export interface StudioGpuBristleWorkerOkResponse {
  readonly kind: "studio-gpu-bristle-ok";
  readonly jobId: number;
  readonly strokeKey: string;
  readonly bitmap: ImageBitmap;
  readonly consumedStationCount: number;
}

export interface StudioGpuBristleWorkerDeclineResponse {
  readonly kind: "studio-gpu-bristle-decline";
  readonly jobId: number;
  readonly strokeKey: string;
  /** A machine reason plus the Korean sentence the admission module produced, when there is one. */
  readonly reason: string;
  readonly message: string;
  /** True → never ask again for this page session. */
  readonly permanent: boolean;
}

export type StudioGpuBristleWorkerResponse =
  | StudioGpuBristleWorkerOkResponse
  | StudioGpuBristleWorkerDeclineResponse;

/* -------------------------------------------------------------------------------------------- */
/* Host state                                                                                      */
/* -------------------------------------------------------------------------------------------- */

interface StrokeEntry {
  overlay: StudioGpuBristleOverlay | null;
  surface: StudioGpuBristleSurface;
  signature: string;
  consumedStationCount: number;
  lastX: number;
  lastY: number;
  lastPressure: number;
  pending: boolean;
  touchedAt: number;
  readonly listeners: Set<() => void>;
}

const strokes = new Map<string, StrokeEntry>();
let worker: Worker | null = null;
let workerFailed = false;
let laneDisabledReason: string | null = null;
let nextJobId = 1;
let touchCounter = 0;
let forcedSupportForTests: boolean | null = null;

/**
 * Environment gate. Every branch here is a reason the lane never constructs a worker at all, which
 * is what makes "no WebGPU" cost exactly zero rather than costing a failed handshake per stroke.
 */
export function supportsStudioGpuBristleOverlay(): boolean {
  if (laneDisabledReason !== null || workerFailed) return false;
  if (forcedSupportForTests !== null) return forcedSupportForTests;
  const scope = globalThis as {
    readonly Worker?: unknown;
    readonly OffscreenCanvas?: unknown;
    readonly createImageBitmap?: unknown;
    readonly navigator?: { readonly gpu?: unknown };
  };
  return (
    typeof scope.Worker === "function"
    && typeof scope.OffscreenCanvas === "function"
    && typeof scope.createImageBitmap === "function"
    && scope.navigator?.gpu !== undefined
    && scope.navigator.gpu !== null
  );
}

function tuftSignature(tuft: StudioGpuBristleTuftOptions): string {
  return [
    tuft.baseRadiusPx,
    tuft.bristleCount ?? "",
    tuft.seed ?? "",
    tuft.ink?.join(",") ?? "",
    tuft.inkLoad ?? "",
    tuft.gravity ?? "",
    tuft.damping ?? "",
    tuft.iterations ?? "",
    tuft.bristleLength ?? "",
    tuft.bristleJitter ?? "",
    tuft.stiffnessVariation ?? "",
    tuft.brushHeight ?? "",
    tuft.zThreshold ?? "",
  ].join("|");
}

function surfaceSignature(surface: StudioGpuBristleSurface): string {
  return [
    surface.widthPx,
    surface.heightPx,
    surface.originX,
    surface.originY,
    surface.pixelsPerUnit,
  ].join("|");
}

/**
 * Content signature. Station geometry is represented by its count plus the exact last station, so
 * the signature is O(1) in stroke length; the prefix identity that actually guards correctness is
 * checked separately with `Object.is`.
 */
function requestSignature(request: StudioGpuBristleOverlayRequest): string {
  const last = request.stations[request.stations.length - 1];
  return [
    request.stations.length,
    last?.x ?? "",
    last?.y ?? "",
    last?.pressure ?? "",
    request.opacity,
    tuftSignature(request.tuft),
    surfaceSignature(request.surface),
  ].join("#");
}

function closeOverlay(entry: StrokeEntry | undefined): void {
  const bitmap = entry?.overlay?.bitmap;
  if (!bitmap) return;
  try {
    bitmap.close();
  } catch {
    // A transferred bitmap may already be detached.
  }
}

function evictStaleStrokes(): void {
  while (strokes.size > STUDIO_GPU_BRISTLE_MAX_RESIDENT_STROKES) {
    let oldestKey: string | null = null;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [key, entry] of strokes) {
      if (entry.pending) continue;
      if (entry.touchedAt < oldest) {
        oldest = entry.touchedAt;
        oldestKey = key;
      }
    }
    if (oldestKey === null) return;
    closeOverlay(strokes.get(oldestKey));
    strokes.delete(oldestKey);
    worker?.postMessage({
      kind: "studio-gpu-bristle-dispose",
      strokeKey: oldestKey,
    } satisfies StudioGpuBristleWorkerDisposeMessage);
  }
}

function handleResponse(response: StudioGpuBristleWorkerResponse): void {
  const entry = strokes.get(response.strokeKey);
  if (!entry) {
    if (response.kind === "studio-gpu-bristle-ok") {
      try {
        response.bitmap.close();
      } catch {
        // Nothing consumes an orphan bitmap.
      }
    }
    return;
  }
  entry.pending = false;
  if (response.kind === "studio-gpu-bristle-decline") {
    if (response.permanent) {
      laneDisabledReason = response.reason;
      disposeStudioGpuBristleHost();
      return;
    }
    entry.overlay = null;
  } else {
    closeOverlay(entry);
    const surface = entry.surface;
    const perUnit = surface.pixelsPerUnit > 0 ? surface.pixelsPerUnit : 1;
    entry.overlay = {
      bitmap: response.bitmap,
      dx: surface.originX,
      dy: surface.originY,
      dw: surface.widthPx / perUnit,
      dh: surface.heightPx / perUnit,
      consumedStationCount: response.consumedStationCount,
    };
    entry.consumedStationCount = response.consumedStationCount;
  }
  const listeners = [...entry.listeners];
  entry.listeners.clear();
  for (const listener of listeners) listener();
}

function ensureWorker(): Worker | null {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL("./studio-gpu-bristle.worker.ts", import.meta.url), {
      type: "module",
      name: "studio-gpu-bristle",
    });
    worker.onmessage = (event: MessageEvent<StudioGpuBristleWorkerResponse>) => {
      handleResponse(event.data);
    };
    worker.onerror = () => {
      workerFailed = true;
      disposeStudioGpuBristleHost();
    };
  } catch {
    workerFailed = true;
    worker = null;
  }
  return worker;
}

/**
 * Render-safe entry. Returns the overlay when it is already known for these exact inputs, and
 * otherwise enqueues the work and returns `null`. For a selected GPU-bristle brush, the caller must
 * not paint a Canvas/Konva carrier while this value is null. `onReady` fires once the GPU result
 * lands; calling again then returns it.
 *
 * `renderGeneration` exists for compiled render bodies (React Compiler): pass a counter you bump in
 * `onReady` so the memoised call site re-executes. The value itself is never read.
 */
export function requestStudioGpuBristleOverlay(
  request: StudioGpuBristleOverlayRequest,
  onReady: () => void,
  renderGeneration = 0,
): StudioGpuBristleOverlay | null {
  void renderGeneration;
  if (!supportsStudioGpuBristleOverlay()) return null;
  if (request.stations.length === 0) return null;
  if (!acceptStudioGpuBristleSurface(request.surface.widthPx, request.surface.heightPx).accepted) {
    return null;
  }

  const signature = requestSignature(request);
  const existing = strokes.get(request.strokeKey);
  if (existing) {
    touchCounter += 1;
    existing.touchedAt = touchCounter;
    if (existing.signature === signature) {
      if (existing.overlay) return existing.overlay;
      if (existing.pending) {
        existing.listeners.add(onReady);
        return null;
      }
      // A previous attempt declined for this exact input; do not retry it every frame.
      return null;
    }
    if (existing.pending) {
      existing.listeners.add(onReady);
      return null;
    }
  }

  const activeWorker = ensureWorker();
  if (!activeWorker) return null;

  // Prefix identity by exact `Object.is`, the same technique `FxOilDabPlanner`
  // (`../studio-fx-brush.ts:1910-1944`) uses one stage earlier. The surface is part of that identity:
  // `beginStroke` fixes the runtime texture and document-space viewport, so a growing draft bbox
  // must reset and replay into its new surface instead of appending stations to the old texture.
  // Anything else — the documented 4096-dab arc refit, an undo, or a pressure-array resample — is
  // also an explicit reset, never an implicit append that would silently desync the tuft.
  const consumed = existing?.consumedStationCount ?? 0;
  const anchor = consumed > 0 ? request.stations[consumed - 1] : undefined;
  const continues =
    existing !== undefined
    && surfaceSignature(existing.surface) === surfaceSignature(request.surface)
    && consumed > 0
    && request.stations.length >= consumed
    && anchor !== undefined
    && Object.is(anchor.x, existing.lastX)
    && Object.is(anchor.y, existing.lastY)
    && Object.is(anchor.pressure, existing.lastPressure);
  const reset = !continues;
  const suffix = reset ? request.stations : request.stations.slice(consumed);
  if (suffix.length === 0) return existing?.overlay ?? null;

  const last = request.stations[request.stations.length - 1]!;
  const entry: StrokeEntry = existing ?? {
    overlay: null,
    surface: request.surface,
    signature,
    consumedStationCount: 0,
    lastX: Number.NaN,
    lastY: Number.NaN,
    lastPressure: Number.NaN,
    pending: false,
    touchedAt: (touchCounter += 1),
    listeners: new Set<() => void>(),
  };
  entry.signature = signature;
  entry.surface = request.surface;
  entry.pending = true;
  entry.lastX = last.x;
  entry.lastY = last.y;
  entry.lastPressure = last.pressure;
  entry.listeners.add(onReady);
  strokes.set(request.strokeKey, entry);
  evictStaleStrokes();

  activeWorker.postMessage({
    kind: "studio-gpu-bristle-advance",
    jobId: nextJobId++,
    strokeKey: request.strokeKey,
    reset,
    tuft: request.tuft,
    surface: request.surface,
    opacity: request.opacity,
    stations: suffix,
    consumedStationCount: request.stations.length,
  } satisfies StudioGpuBristleWorkerAdvanceMessage);
  return null;
}

/* -------------------------------------------------------------------------------------------- */
/* Oil-lane adapter. Keeps the StudioDrawNode edit to a single call.                               */
/* -------------------------------------------------------------------------------------------- */

/**
 * Brush ids that opt into the lane. Nothing in the shipped catalog matches, so every existing oil
 * brush keeps its exact current pixels; registering a catalog id is increment 2 and belongs to
 * whoever owns `brush/studio-brush-catalog-core.ts`.
 */
export const STUDIO_GPU_BRISTLE_BRUSH_ID_PREFIX = "oil--gpu-bristle";

/** Padding around the dab bbox so a capsule at the edge is not clipped. */
const SURFACE_PADDING_PX = 6;

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value >= 1 ? 1 : value;
}

/** `#rgb` / `#rrggbb` → linear-ish 0..1 RGB. Anything else paints as black ink. */
function parseHexRgb(hex: string): [number, number, number] {
  const value = hex.trim().replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((character) => character + character)
          .join("")
      : value;
  if (full.length !== 6 || !/^[0-9a-fA-F]{6}$/u.test(full)) return [0, 0, 0];
  return [
    Number.parseInt(full.slice(0, 2), 16) / 255,
    Number.parseInt(full.slice(2, 4), 16) / 255,
    Number.parseInt(full.slice(4, 6), 16) / 255,
  ];
}

/**
 * Build an overlay request from the oil lane's own dab plan, or `null` when this brush does not
 * opt in.
 *
 * `dtMs` is the retained-document canonical frame step: a retained `DrawEl` carries points and
 * pressures but no per-point clock. It is never derived from the station index, because that would
 * make a suffix solve disagree with a replay.
 */
export function studioGpuBristleOilRequest(
  elementId: string,
  brushId: string | undefined,
  dabs: readonly FxOilDab[],
  opacity: number,
  strokeHex: string,
): StudioGpuBristleOverlayRequest | null {
  if (!brushId || !brushId.startsWith(STUDIO_GPU_BRISTLE_BRUSH_ID_PREFIX)) return null;
  if (dabs.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let radiusSum = 0;
  let maxRadius = 0;
  const stations: StudioGpuBristleStation[] = [];
  for (const dab of dabs) {
    if (!Number.isFinite(dab.x) || !Number.isFinite(dab.y)) return null;
    const radius = Math.max(dab.radiusX, dab.radiusY);
    if (dab.x - radius < minX) minX = dab.x - radius;
    if (dab.y - radius < minY) minY = dab.y - radius;
    if (dab.x + radius > maxX) maxX = dab.x + radius;
    if (dab.y + radius > maxY) maxY = dab.y + radius;
    radiusSum += dab.radiusY;
    if (radius > maxRadius) maxRadius = radius;
    stations.push({
      x: dab.x,
      y: dab.y,
      pressure: clamp01(dab.opacity),
      dtMs: STUDIO_GPU_BRISTLE_LIMITS.retainedStationDtMs,
    });
  }
  const baseRadiusPx = Math.max(1, radiusSum / dabs.length);
  const originX = minX - SURFACE_PADDING_PX;
  const originY = minY - SURFACE_PADDING_PX;
  const widthPx = Math.ceil(maxX - minX + SURFACE_PADDING_PX * 2);
  const heightPx = Math.ceil(maxY - minY + SURFACE_PADDING_PX * 2);
  const [red, green, blue] = parseHexRgb(strokeHex);
  return {
    strokeKey: elementId,
    tuft: {
      baseRadiusPx,
      // The render lane caps hairs at BRISTLE_MAX_HAIRS; the tuft scales with the head like dli's.
      bristleCount: clampStudioGpuBristleCount(Math.round(baseRadiusPx * 1.5)),
      seed: studioGpuBristleSeedFromKey(elementId),
      ink: studioFluidPaintRgbToRyb(red, green, blue),
      inkLoad: 1,
    },
    surface: { widthPx, heightPx, originX, originY, pixelsPerUnit: 1 },
    stations,
    opacity: clamp01(opacity),
  };
}

/** FNV-1a over the element id — deterministic, no clock, no `Math.random`. */
export function studioGpuBristleSeedFromKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

/** Why the lane refused for this page session, or `null` while it is still eligible. */
export function studioGpuBristleLaneDisabledReason(): string | null {
  return laneDisabledReason;
}

/** Tear the lane down. Idempotent; safe to call when nothing was ever constructed. */
export function disposeStudioGpuBristleHost(): void {
  for (const entry of strokes.values()) closeOverlay(entry);
  strokes.clear();
  try {
    worker?.terminate();
  } catch {
    // Terminating a worker that already died is not an error.
  }
  worker = null;
}

/** Test-only isolation hook: clears every cache and re-enables the lane. */
export function resetStudioGpuBristleHostForTests(): void {
  disposeStudioGpuBristleHost();
  workerFailed = false;
  laneDisabledReason = null;
  nextJobId = 1;
  touchCounter = 0;
  forcedSupportForTests = null;
}

/** Test-only: force `supportsStudioGpuBristleOverlay` so the cache logic runs without a GPU. */
export function setStudioGpuBristleSupportForTests(value: boolean | null): void {
  forcedSupportForTests = value;
}

/** Test-only: inject a worker double so the cache/prefix logic can be exercised without a GPU. */
export function installStudioGpuBristleWorkerForTests(candidate: Worker | null): void {
  worker = candidate;
  workerFailed = false;
  if (candidate) {
    candidate.onmessage = (event: MessageEvent<StudioGpuBristleWorkerResponse>) => {
      handleResponse(event.data);
    };
  }
}

/** Test-only: deliver a worker response without a real `MessageEvent`. */
export function deliverStudioGpuBristleResponseForTests(
  response: StudioGpuBristleWorkerResponse,
): void {
  handleResponse(response);
}
