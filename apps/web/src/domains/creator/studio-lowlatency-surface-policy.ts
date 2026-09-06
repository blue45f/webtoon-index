/**
 * Desynchronized-presentation policy for every Studio canvas surface.
 *
 * `desynchronized: true` asks the browser to take the canvas off the ordinary compositor commit
 * path. On the win side the drawing surface can be scanned out ahead of (or independently of) the
 * DOM frame that produced it, which removes roughly one compositor frame from the pen-down to
 * photon path. On the cost side the surface is no longer guaranteed to be presented atomically
 * with the rest of the page, and readback semantics change.
 *
 * Because the tradeoff is per-surface rather than per-app, the decision lives in one pure table
 * instead of being re-argued at every `getContext(` call site. The repo already requests the flag
 * for the Canvas2D live-ink/stamp overlays and the WebGL2 live-ink runtime; this module makes the
 * remaining surfaces explicit, refuses the contradictory attribute combinations, and adds a probe
 * that reports whether the browser actually *granted* the request instead of assuming it did.
 *
 * ## Why committed content stays synchronized
 *
 * 1. Tearing against the page. A desynchronized surface can present a frame the compositor has not
 *    yet paired with the current DOM transform. On a transient overlay that is invisible (the
 *    overlay is discarded within a few frames, and a one-frame-early ink tip is exactly the point).
 *    On the committed document layer it shows up as ink sliding relative to rulers, selection
 *    marquees, and panel chrome during a pan/zoom — a correctness-looking artifact on durable art.
 * 2. Readback cost and correctness. Committed layers are precisely the surfaces this app reads back
 *    (`getImageData` for histogram/magic wand/masks, `toDataURL`/`convertToBlob` for export, PSD,
 *    thumbnails, timelapse). Implementations back a low-latency canvas with a swap chain whose
 *    front buffer must be copied before it can be read, so every readback pays a GPU->CPU copy that
 *    a synchronized canvas does not, and can observe a partially presented frame.
 * 3. `willReadFrequently: true` and `desynchronized: true` are opposite hints — one asks for a CPU
 *    -resident backing store, the other for a GPU low-latency swap chain. Requesting both lets the
 *    UA pick either, so the pair is rejected here rather than silently degrading.
 *
 * ## Why the live surfaces take it
 *
 * The live overlays are write-only, cleared every stroke, never exported, and never read back.
 * A torn or early frame on them is not observable as a defect, so the latency win is free.
 */

export type StudioLowLatencySurfaceRole =
  /** Canvas2D transient ink overlay that presents the in-flight stroke. */
  | "live-ink-overlay"
  /** Canvas2D transient stamp-brush overlay. */
  | "live-stamp-overlay"
  /** Canvas2D surface that renders the speculative predicted tail only. */
  | "live-prediction-overlay"
  /** WebGL2 live-ink runtime surface. */
  | "webgl-live-ink"
  /** WebGPU live-ink surface (configured through GPUCanvasConfiguration). */
  | "webgpu-live-ink"
  /** Konva main/document layer holding already-committed art. */
  | "committed-document-layer"
  /** Konva hit-test canvas. */
  | "hit-test"
  /** Any surface sampled with getImageData (histogram, wand, masks, color pickers). */
  | "readback-scratch"
  /** Export/thumbnail/PSD/timelapse composition targets. */
  | "export-composite"
  /** OffscreenCanvas inside a worker: never composited, so the flag is meaningless. */
  | "offscreen-worker";

export interface StudioLowLatencySurfaceDecision {
  readonly role: StudioLowLatencySurfaceRole;
  /** True when `desynchronized: true` should be requested at getContext time. */
  readonly desynchronized: boolean;
  /** True when `willReadFrequently: true` should be requested. Never true with desynchronized. */
  readonly willReadFrequently: boolean;
  /** Machine-readable justification, asserted by the contract test. */
  readonly reason:
    | "transient-write-only"
    | "not-expressible"
    | "tears-against-page"
    | "readback-owner"
    | "not-composited";
}

const SURFACE_POLICY: Readonly<Record<StudioLowLatencySurfaceRole, StudioLowLatencySurfaceDecision>> =
  Object.freeze({
    "live-ink-overlay": Object.freeze({
      role: "live-ink-overlay",
      desynchronized: true,
      willReadFrequently: false,
      reason: "transient-write-only",
    } as const),
    "live-stamp-overlay": Object.freeze({
      role: "live-stamp-overlay",
      desynchronized: true,
      willReadFrequently: false,
      reason: "transient-write-only",
    } as const),
    "live-prediction-overlay": Object.freeze({
      role: "live-prediction-overlay",
      desynchronized: true,
      willReadFrequently: false,
      reason: "transient-write-only",
    } as const),
    "webgl-live-ink": Object.freeze({
      role: "webgl-live-ink",
      desynchronized: true,
      willReadFrequently: false,
      reason: "transient-write-only",
    } as const),
    // GPUCanvasConfiguration has no desynchronized member. The WebGPU presentation path is already
    // a swap chain; asking for the flag is not expressible rather than merely unnecessary.
    "webgpu-live-ink": Object.freeze({
      role: "webgpu-live-ink",
      desynchronized: false,
      willReadFrequently: false,
      reason: "not-expressible",
    } as const),
    "committed-document-layer": Object.freeze({
      role: "committed-document-layer",
      desynchronized: false,
      willReadFrequently: false,
      reason: "tears-against-page",
    } as const),
    "hit-test": Object.freeze({
      role: "hit-test",
      desynchronized: false,
      willReadFrequently: true,
      reason: "readback-owner",
    } as const),
    "readback-scratch": Object.freeze({
      role: "readback-scratch",
      desynchronized: false,
      willReadFrequently: true,
      reason: "readback-owner",
    } as const),
    "export-composite": Object.freeze({
      role: "export-composite",
      desynchronized: false,
      willReadFrequently: false,
      reason: "readback-owner",
    } as const),
    "offscreen-worker": Object.freeze({
      role: "offscreen-worker",
      desynchronized: false,
      willReadFrequently: false,
      reason: "not-composited",
    } as const),
  });

export const STUDIO_LOW_LATENCY_SURFACE_ROLES: readonly StudioLowLatencySurfaceRole[] =
  Object.freeze(Object.keys(SURFACE_POLICY) as StudioLowLatencySurfaceRole[]);

/** Unknown roles fail closed onto the synchronized, non-readback default. */
export function resolveStudioLowLatencySurfacePolicy(
  role: StudioLowLatencySurfaceRole | (string & {})
): StudioLowLatencySurfaceDecision {
  const decision = (SURFACE_POLICY as Record<string, StudioLowLatencySurfaceDecision | undefined>)[
    role
  ];
  return decision ?? Object.freeze({
    role: "committed-document-layer",
    desynchronized: false,
    willReadFrequently: false,
    reason: "tears-against-page",
  } as const);
}

export interface StudioLowLatencyContextAttributes {
  readonly alpha: boolean;
  readonly desynchronized?: true;
  readonly willReadFrequently?: true;
}

/**
 * Builds the exact attribute bag for a role. `desynchronized`/`willReadFrequently` are emitted
 * only when true so the object stays byte-identical to what the existing call sites already pass
 * and never sends the contradictory pair.
 */
export function studioLowLatencyContextAttributes(
  role: StudioLowLatencySurfaceRole,
  options: { readonly alpha?: boolean } = {}
): StudioLowLatencyContextAttributes {
  const decision = resolveStudioLowLatencySurfacePolicy(role);
  const alpha = options.alpha !== false;
  if (decision.desynchronized) return { alpha, desynchronized: true };
  if (decision.willReadFrequently) return { alpha, willReadFrequently: true };
  return { alpha };
}

/** True when an attribute bag asks for both the CPU-resident and the low-latency backing hint. */
export function isStudioContradictoryCanvasAttributes(attributes: unknown): boolean {
  if (!attributes || typeof attributes !== "object") return false;
  const candidate = attributes as { desynchronized?: unknown; willReadFrequently?: unknown };
  return candidate.desynchronized === true && candidate.willReadFrequently === true;
}

export type StudioLowLatencyProbeStatus =
  /** Requested and the context reports the attribute back as honored. */
  | "granted"
  /** Requested, a context exists, but the UA reported the attribute as not honored. */
  | "denied"
  /** Requested, a context exists, but the UA exposes no attribute reflection to verify with. */
  | "unverifiable"
  /** getContext threw on the attribute bag; the caller must retry without it. */
  | "rejected"
  /** No context could be created at all. */
  | "unsupported"
  /** The surface role cannot express the request (WebGPU, worker offscreen). */
  | "not-applicable";

export interface StudioLowLatencyProbeResult {
  readonly status: StudioLowLatencyProbeStatus;
  /** True only for "granted". Callers gate latency telemetry on this. */
  readonly desynchronized: boolean;
  /** True when the probe had to retry getContext without the attribute bag. */
  readonly usedFallback: boolean;
}

interface ProbeContextLike {
  getContextAttributes?: unknown;
}

interface ProbeCanvasLike {
  getContext: (contextId: string, attributes?: unknown) => unknown;
}

function readReflectedDesynchronized(context: unknown): boolean | null {
  if (!context || typeof context !== "object") return null;
  const reflector = (context as ProbeContextLike).getContextAttributes;
  if (typeof reflector !== "function") return null;
  try {
    const attributes = (reflector as (this: unknown) => unknown).call(context);
    if (!attributes || typeof attributes !== "object") return null;
    const value = (attributes as { desynchronized?: unknown }).desynchronized;
    return typeof value === "boolean" ? value : null;
  } catch {
    // Embedded WebViews have shipped a throwing reflector; treat it as "no evidence".
    return null;
  }
}

/** getContext is a browser boundary: a null return and a thrown attribute bag mean the same thing. */
function tryStudioGetContext(
  canvas: ProbeCanvasLike,
  contextId: string,
  attributes?: unknown
): unknown {
  try {
    const context = attributes === undefined
      ? canvas.getContext(contextId)
      : canvas.getContext(contextId, attributes);
    return context ?? null;
  } catch {
    return null;
  }
}

/**
 * Asks for the low-latency presentation path and reports what the browser actually did.
 *
 * Every failure mode still yields a usable context when one is obtainable: an attribute bag that
 * throws is retried bare, and a denied request is reported rather than assumed. Callers therefore
 * never have to choose between "no low-latency path" and "no canvas".
 */
export function probeStudioLowLatencySurface(
  canvas: ProbeCanvasLike | null | undefined,
  role: StudioLowLatencySurfaceRole,
  contextId: "2d" | "webgl2" = "2d"
): { readonly context: unknown; readonly probe: StudioLowLatencyProbeResult } {
  const decision = resolveStudioLowLatencySurfacePolicy(role);
  if (!canvas || typeof canvas.getContext !== "function") {
    return {
      context: null,
      probe: { status: "unsupported", desynchronized: false, usedFallback: false },
    };
  }

  const attributes = studioLowLatencyContextAttributes(role);
  if (!decision.desynchronized) {
    const context = tryStudioGetContext(canvas, contextId, attributes)
      ?? tryStudioGetContext(canvas, contextId);
    return {
      context,
      probe: {
        status: decision.reason === "not-expressible" || decision.reason === "not-composited"
          ? "not-applicable"
          : context
            ? "denied"
            : "unsupported",
        desynchronized: false,
        usedFallback: false,
      },
    };
  }

  const context = tryStudioGetContext(canvas, contextId, attributes);
  if (context === null) {
    // Either the attribute bag threw or the UA refused it outright. A bare retry keeps the surface
    // renderable at ordinary latency instead of leaving the caller with no context at all.
    const fallback = tryStudioGetContext(canvas, contextId);
    return {
      context: fallback,
      probe: {
        status: fallback ? "rejected" : "unsupported",
        desynchronized: false,
        usedFallback: true,
      },
    };
  }

  const reflected = readReflectedDesynchronized(context);
  if (reflected === true) {
    return {
      context,
      probe: { status: "granted", desynchronized: true, usedFallback: false },
    };
  }
  return {
    context,
    probe: {
      status: reflected === false ? "denied" : "unverifiable",
      desynchronized: false,
      usedFallback: false,
    },
  };
}
