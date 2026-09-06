/**
 * studio-gpu-bristle worker — the only module that reaches the WebGPU runtime and its WGSL.
 *
 * PROVENANCE (derived work, MIT): David Li, "Fluid Paint" — http://david.li/paint —
 * https://github.com/dli/paint, © 2017 David Li. Full per-shader attribution lives in
 * `studio-gpu-bristle-wgsl.ts`; the verbatim permission notice is at `third_party/dli-paint/LICENSE`.
 *
 * Why a worker at all: `dist/assets/studio-living-ink.worker-*.js` is 148 KB raw and does not
 * appear in the bundle baseline's static metrics, while the Studio route is ratcheted at
 * 5,417,705 raw / 194 chunks with `countSlack: 2`. Shader text in a worker chunk costs ~0 against
 * the ratchet; the same text in the route closure costs its full weight plus a chunk. The
 * 2026-08-14 leak (`../studio-living-ink-route-import-boundary.test.ts:7-23`) is the precedent.
 *
 * Requests are serialised: exactly one job is in flight, later jobs for the same stroke queue
 * behind it. There is no readback here at all — `present()` transfers an ImageBitmap, which is a
 * queue submission plus a transfer, never a `mapAsync`.
 */

import {
  evaluateStudioGpuBristleProbe,
  proveStudioGpuBristleAdmission,
  STUDIO_GPU_BRISTLE_PROBE,
} from "./studio-gpu-bristle-admission";
import { STUDIO_GPU_BRISTLE_LIMITS } from "./studio-gpu-bristle-contract";
import { createStudioGpuBristleRuntime } from "./studio-gpu-bristle-runtime";

import type { StudioGpuBristleAdmissionVerdict } from "./studio-gpu-bristle-admission";
import type {
  StudioGpuBristleWorkerAdvanceMessage,
  StudioGpuBristleWorkerRequest,
  StudioGpuBristleWorkerResponse,
} from "./studio-gpu-bristle-host";
import type { StudioGpuBristleStation } from "./studio-gpu-bristle-reference";
import type {
  StudioGpuBristleRuntime,
  StudioGpuBristleRuntimeStatus,
} from "./studio-gpu-bristle-runtime";

/** Probe surface for the admission run. Geometry is shared with the browser parity verifier. */
const PROBE_WIDTH = STUDIO_GPU_BRISTLE_PROBE.width;
const PROBE_HEIGHT = STUDIO_GPU_BRISTLE_PROBE.height;

interface StrokeState {
  readonly key: string;
  consumed: number;
  started: boolean;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

let runtime: StudioGpuBristleRuntime | null = null;
let runtimeStatus: StudioGpuBristleRuntimeStatus | "uninitialised" = "uninitialised";
let admission: StudioGpuBristleAdmissionVerdict | null = null;
let queue: Promise<void> = Promise.resolve();
const strokes = new Map<string, StrokeState>();

function decline(
  message: StudioGpuBristleWorkerAdvanceMessage,
  reason: string,
  text: string,
  permanent: boolean,
): void {
  const response: StudioGpuBristleWorkerResponse = {
    kind: "studio-gpu-bristle-decline",
    jobId: message.jobId,
    strokeKey: message.strokeKey,
    reason,
    message: text,
    permanent,
  };
  scope.postMessage(response);
}

async function ensureRuntime(): Promise<StudioGpuBristleRuntime | null> {
  if (runtime) return runtime;
  if (runtimeStatus !== "uninitialised") return null;
  if (typeof OffscreenCanvas !== "function") {
    runtimeStatus = "surface-unavailable";
    return null;
  }
  // The runtime owns the surface from here; it is resized per stroke by `beginStroke`.
  const result = await createStudioGpuBristleRuntime({
    canvas: new OffscreenCanvas(PROBE_WIDTH, PROBE_HEIGHT),
  });
  runtimeStatus = result.status;
  runtime = result.runtime;
  return runtime;
}

/**
 * Picture admission — run once per device epoch, on the artist's own machine.
 *
 * A liveness check is not admission: `studio-living-ink-webgpu-pure-runtime.ts:9-16` records a gate
 * that once accepted a resolve drawing ink roughly thirty times too faint. So the probe paints a
 * real stroke, reads the pixels back, and requires paper grain, stroke darkness, a clean untouched
 * region and — the check unique to this lane — measurable relief contrast across a ridge.
 */
async function proveAdmission(
  active: StudioGpuBristleRuntime,
): Promise<StudioGpuBristleAdmissionVerdict | null> {
  if (admission) return admission;
  const surface = {
    widthPx: PROBE_WIDTH,
    heightPx: PROBE_HEIGHT,
    originX: 0,
    originY: 0,
    pixelsPerUnit: 1,
  };
  const begun = active.beginStroke({
    tuft: {
      baseRadiusPx: STUDIO_GPU_BRISTLE_PROBE.baseRadiusPx,
      bristleCount: STUDIO_GPU_BRISTLE_PROBE.bristleCount,
      seed: STUDIO_GPU_BRISTLE_PROBE.seed,
      ink: [0.05, 0.05, 0.05],
      inkLoad: 1,
    },
    surface,
    opacity: 1,
  });
  if (begun !== "ready") return null;
  // A straight horizontal drag across the middle, slow enough that every station deposits.
  const stations: StudioGpuBristleStation[] = [];
  for (let index = 0; index < STUDIO_GPU_BRISTLE_PROBE.strokeStations; index += 1) {
    stations.push({
      x: STUDIO_GPU_BRISTLE_PROBE.strokeStartX + index,
      y: PROBE_HEIGHT / 2,
      pressure: STUDIO_GPU_BRISTLE_PROBE.strokePressure,
      dtMs: 1000 / 60,
    });
  }
  if (active.advance({ stations, place: true }) !== "ready") return null;
  const bitmap = active.present();
  if (!bitmap) return null;
  let pixels: Uint8ClampedArray;
  try {
    const readback = new OffscreenCanvas(PROBE_WIDTH, PROBE_HEIGHT);
    const context = readback.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    // The probe composites over white paper so the luminance statistics mean what they say.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, PROBE_WIDTH, PROBE_HEIGHT);
    context.drawImage(bitmap, 0, 0);
    pixels = context.getImageData(0, 0, PROBE_WIDTH, PROBE_HEIGHT).data;
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
  admission = proveStudioGpuBristleAdmission(
    evaluateStudioGpuBristleProbe(pixels, PROBE_WIDTH, PROBE_HEIGHT),
  );
  return admission;
}

async function runAdvance(message: StudioGpuBristleWorkerAdvanceMessage): Promise<void> {
  const active = await ensureRuntime();
  if (!active) {
    decline(message, runtimeStatus, "", true);
    return;
  }
  const verdict = await proveAdmission(active);
  if (!verdict) {
    decline(message, "admission-probe-failed", "", true);
    return;
  }
  if (!verdict.admitted) {
    decline(message, verdict.reasons[0] ?? "admission-refused", verdict.message, true);
    return;
  }
  if (active.status !== "ready") {
    // Device loss mid-session: decline this stroke only. The next stroke re-acquires.
    decline(message, active.status, "", active.status === "device-lost");
    return;
  }

  let state = strokes.get(message.strokeKey);
  if (message.reset || !state) {
    state = { key: message.strokeKey, consumed: 0, started: false };
    strokes.set(message.strokeKey, state);
  }
  if (!state.started) {
    const begun = active.beginStroke({
      tuft: message.tuft,
      surface: message.surface,
      opacity: message.opacity,
    });
    if (begun !== "ready") {
      decline(message, begun, "", begun === "device-lost");
      return;
    }
    state.started = true;
    state.consumed = 0;
  }

  // The runtime's per-dispatch station cap is a buffer size, not a semantic boundary: the
  // station-major slot layout makes any chunking produce the identical deposit sequence.
  const batchSize = STUDIO_GPU_BRISTLE_LIMITS.maxStationsPerBatch;
  for (let offset = 0; offset < message.stations.length; offset += batchSize) {
    const batch = message.stations.slice(offset, offset + batchSize);
    const status = active.advance({
      stations: batch,
      place: state.consumed === 0 && offset === 0,
    });
    if (status !== "ready") {
      decline(message, status, "", status === "device-lost");
      return;
    }
  }
  state.consumed += message.stations.length;

  const bitmap = active.present();
  if (!bitmap) {
    decline(message, "present-unavailable", "", false);
    return;
  }
  const response: StudioGpuBristleWorkerResponse = {
    kind: "studio-gpu-bristle-ok",
    jobId: message.jobId,
    strokeKey: message.strokeKey,
    bitmap,
    consumedStationCount: message.consumedStationCount,
  };
  scope.postMessage(response, [bitmap]);
}

scope.onmessage = (event: MessageEvent<StudioGpuBristleWorkerRequest>) => {
  const message = event.data;
  if (message.kind === "studio-gpu-bristle-dispose") {
    strokes.delete(message.strokeKey);
    return;
  }
  if (message.kind !== "studio-gpu-bristle-advance") return;
  queue = queue
    .then(() => runAdvance(message))
    .catch(() => {
      decline(message, "worker-exception", "", false);
    });
};

export {};
