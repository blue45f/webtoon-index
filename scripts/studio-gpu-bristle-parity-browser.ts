/**
 * Real-browser parity entry for the GPU bristle lane.
 *
 * Loaded only by `verify-studio-gpu-bristle-parity.mjs`'s synthetic Vite document. Headless WebGPU
 * is unavailable in the Node vitest suite (`tests/visual/living-ink-fluid-quality.test.ts:62-64`),
 * so the gates that need a real device live here:
 *
 *   G1  self-parity      — byte-exact, same device, same shader, two different chunkings.
 *   G3  twin-vs-GPU      — constraint satisfaction, deposit conservation, tip lag, terminal-load KS.
 *   G4  picture admission — the four thresholds the product path itself runs on the artist's device.
 *   plus a REAL `GPUDevice.destroy()` loss observation.
 *
 * A green Node suite is not evidence this lane is correct. This file is.
 */
import {
  evaluateStudioGpuBristleProbe,
  proveStudioGpuBristleAdmission,
  STUDIO_GPU_BRISTLE_PROBE,
} from "../apps/web/src/domains/creator/render/studio-gpu-bristle-admission";
import {
  STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT,
  STUDIO_GPU_BRISTLE_LIMITS,
  studioFluidPaintRgbToRyb,
} from "../apps/web/src/domains/creator/render/studio-gpu-bristle-contract";
import {
  judgeStudioGpuBristleConstraintSatisfaction,
  judgeStudioGpuBristlePigmentConservation,
  judgeStudioGpuBristleTerminalLoadDistribution,
  judgeStudioGpuBristleTipLag,
  studioGpuBristleFailures,
  studioGpuBristleStandardDeviation,
  studioGpuBristleTerminalLoads,
  studioGpuBristleTipLag,
} from "../apps/web/src/domains/creator/render/studio-gpu-bristle-metrics";
import {
  advanceStudioGpuBristleReference,
  createStudioGpuBristleReference,
  packStudioGpuBristleSplats,
  packStudioGpuBristleState,
  resolveStudioGpuBristleConfig,
} from "../apps/web/src/domains/creator/render/studio-gpu-bristle-reference";
import { createStudioGpuBristleRuntime } from "../apps/web/src/domains/creator/render/studio-gpu-bristle-runtime";
import {
  acquireStudioGpuDevice,
  disposeStudioGpuFabric,
} from "../apps/web/src/domains/creator/render/studio-gpu-fabric";

import type { StudioGpuBristleJudgement } from "../apps/web/src/domains/creator/render/studio-gpu-bristle-metrics";
import type {
  StudioGpuBristleStation,
  StudioGpuBristleTuftOptions,
} from "../apps/web/src/domains/creator/render/studio-gpu-bristle-reference";
import type {
  StudioGpuBristleRuntime,
  StudioGpuBristleSurface,
} from "../apps/web/src/domains/creator/render/studio-gpu-bristle-runtime";

const SURFACE: StudioGpuBristleSurface = {
  widthPx: 256,
  heightPx: 256,
  originX: 0,
  originY: 0,
  pixelsPerUnit: 1,
};
const STATION_COUNT = 3200;
const TRACE_BRISTLE = 0;

const TUFT: StudioGpuBristleTuftOptions = {
  baseRadiusPx: 14,
  bristleCount: 32,
  seed: 424242,
  ink: studioFluidPaintRgbToRyb(0.12, 0.09, 0.07),
  inkLoad: 1,
};

type UnsupportedReason =
  | "webgpu-unavailable"
  | "offscreen-canvas-unavailable"
  | "adapter-unavailable"
  | "device-unavailable"
  | "context-unavailable";

interface BrowserCapabilities {
  readonly webgpu: boolean;
  readonly offscreenCanvas: boolean;
  readonly transferToImageBitmap: boolean;
  readonly userAgent: string;
}

declare global {
  interface Window {
    __studioGpuBristleParityResult?: unknown;
  }
}

function capabilities(): BrowserCapabilities {
  return {
    webgpu: typeof navigator !== "undefined" && navigator.gpu !== undefined,
    offscreenCanvas: typeof OffscreenCanvas === "function",
    transferToImageBitmap:
      typeof OffscreenCanvas === "function"
      && typeof OffscreenCanvas.prototype.transferToImageBitmap === "function",
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
  };
}

/**
 * A stroke with a hard 90° corner. The corner is the whole point: a dli bristle tip trails behind
 * its root through it and springs back, and a one-vertex hair cannot.
 */
function cornerStroke(count: number): StudioGpuBristleStation[] {
  const stations: StudioGpuBristleStation[] = [];
  const half = Math.floor(count / 2);
  for (let index = 0; index < count; index += 1) {
    const along = index < half ? index : half;
    const down = index < half ? 0 : index - half;
    stations.push({
      x: 40 + along * 0.05,
      y: 40 + down * 0.05,
      // A pressure step at the corner drives the splay-recovery signal too.
      pressure: index < half ? 0.55 : 0.95,
      dtMs: 1000 / 120,
    });
  }
  return stations;
}

/** Deterministic chunk sizes. No `Math.random`: a failing run must be reproducible. */
function seededChunks(total: number, seed: number): number[] {
  const sizes: number[] = [];
  let state = seed >>> 0;
  let remaining = total;
  const cap = STUDIO_GPU_BRISTLE_LIMITS.maxStationsPerBatch;
  while (remaining > 0) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const size = Math.min(remaining, 1 + (state % cap));
    sizes.push(size);
    remaining -= size;
  }
  return sizes;
}

/** Chunking A: every batch at the dispatch cap. */
function uniformChunks(total: number): number[] {
  const sizes: number[] = [];
  let remaining = total;
  while (remaining > 0) {
    const size = Math.min(remaining, STUDIO_GPU_BRISTLE_LIMITS.maxStationsPerBatch);
    sizes.push(size);
    remaining -= size;
  }
  return sizes;
}

interface RunOutput {
  readonly state: Float32Array;
  readonly splats: Float32Array;
}

async function runChunked(
  runtime: StudioGpuBristleRuntime,
  stations: readonly StudioGpuBristleStation[],
  chunkSizes: readonly number[],
): Promise<RunOutput | null> {
  if (runtime.beginStroke({ tuft: TUFT, surface: SURFACE, opacity: 1 }) !== "ready") {
    return null;
  }
  const collected: Float32Array[] = [];
  let offset = 0;
  let first = true;
  for (const size of chunkSizes) {
    const batch = stations.slice(offset, offset + size);
    if (batch.length === 0) break;
    if (runtime.advance({ stations: batch, place: first }) !== "ready") return null;
    first = false;
    const slots = await runtime.readSplatSlots();
    if (!slots) return null;
    const used = batch.length * (runtime.config?.bristleCount ?? 0)
      * STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT;
    collected.push(slots.subarray(0, used).slice());
    offset += batch.length;
  }
  const state = await runtime.readBristleState();
  if (!state) return null;
  const total = collected.reduce((sum, part) => sum + part.length, 0);
  const splats = new Float32Array(total);
  let cursor = 0;
  for (const part of collected) {
    splats.set(part, cursor);
    cursor += part.length;
  }
  return { state, splats };
}

function bytesEqual(left: Float32Array, right: Float32Array): {
  equal: boolean;
  length: [number, number];
  firstDifferingIndex: number;
} {
  if (left.length !== right.length) {
    return { equal: false, length: [left.length, right.length], firstDifferingIndex: -1 };
  }
  const a = new Uint8Array(left.buffer, left.byteOffset, left.byteLength);
  const b = new Uint8Array(right.buffer, right.byteOffset, right.byteLength);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return {
        equal: false,
        length: [left.length, right.length],
        firstDifferingIndex: Math.floor(index / 4),
      };
    }
  }
  return { equal: true, length: [left.length, right.length], firstDifferingIndex: -1 };
}

/** Tip path of one bristle, read out of the GPU's own splat stream (`seg.zw`). */
function gpuTipPath(
  splats: Float32Array,
  bristleCount: number,
  bristleIndex: number,
): Float64Array {
  const stationCount = splats.length / STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT / bristleCount;
  const path = new Float64Array(stationCount * 2);
  for (let station = 0; station < stationCount; station += 1) {
    const slot =
      (station * bristleCount + bristleIndex) * STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT;
    path[station * 2] = splats[slot + 2]!;
    path[station * 2 + 1] = splats[slot + 3]!;
  }
  return path;
}

async function probeAdmission(runtime: StudioGpuBristleRuntime) {
  const width = STUDIO_GPU_BRISTLE_PROBE.width;
  const height = STUDIO_GPU_BRISTLE_PROBE.height;
  const begun = runtime.beginStroke({
    tuft: {
      baseRadiusPx: STUDIO_GPU_BRISTLE_PROBE.baseRadiusPx,
      bristleCount: STUDIO_GPU_BRISTLE_PROBE.bristleCount,
      seed: STUDIO_GPU_BRISTLE_PROBE.seed,
      ink: [0.05, 0.05, 0.05],
      inkLoad: 1,
    },
    surface: { widthPx: width, heightPx: height, originX: 0, originY: 0, pixelsPerUnit: 1 },
    opacity: 1,
  });
  if (begun !== "ready") return { status: "unavailable" as const, reason: begun };
  const stations: StudioGpuBristleStation[] = [];
  for (let index = 0; index < STUDIO_GPU_BRISTLE_PROBE.strokeStations; index += 1) {
    stations.push({
      x: STUDIO_GPU_BRISTLE_PROBE.strokeStartX + index,
      y: height / 2,
      pressure: STUDIO_GPU_BRISTLE_PROBE.strokePressure,
      dtMs: 1000 / 60,
    });
  }
  if (runtime.advance({ stations, place: true }) !== "ready") {
    return { status: "unavailable" as const, reason: "advance-failed" };
  }
  const bitmap = runtime.present();
  if (!bitmap) return { status: "unavailable" as const, reason: "present-failed" };
  const readback = new OffscreenCanvas(width, height);
  const context = readback.getContext("2d", { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    return { status: "unavailable" as const, reason: "readback-context" };
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = context.getImageData(0, 0, width, height).data;
  const samples = evaluateStudioGpuBristleProbe(pixels, width, height);
  const verdict = proveStudioGpuBristleAdmission(samples);
  return {
    status: "observed" as const,
    admitted: verdict.admitted,
    reasons: [...verdict.reasons],
    samples: { ...verdict.samples },
    pngWidth: width,
    pngHeight: height,
  };
}

async function run(): Promise<unknown> {
  const caps = capabilities();
  if (!caps.webgpu) {
    return { status: "unsupported", reason: "webgpu-unavailable" as UnsupportedReason, capabilities: caps };
  }
  if (!caps.offscreenCanvas || !caps.transferToImageBitmap) {
    return {
      status: "unsupported",
      reason: "offscreen-canvas-unavailable" as UnsupportedReason,
      capabilities: caps,
    };
  }

  const canvas = new OffscreenCanvas(SURFACE.widthPx, SURFACE.heightPx);
  const created = await createStudioGpuBristleRuntime({ canvas });
  if (!created.runtime || created.status !== "ready") {
    return {
      status: "unsupported",
      reason:
        created.status === "webgpu-unavailable"
          ? ("webgpu-unavailable" as UnsupportedReason)
          : created.status === "device-unavailable"
            ? ("device-unavailable" as UnsupportedReason)
            : ("context-unavailable" as UnsupportedReason),
      message: created.reason,
      capabilities: caps,
    };
  }
  const runtime = created.runtime;
  const uncapturedGpuErrors: string[] = [];

  try {
    const admission = await probeAdmission(runtime);

    const stations = cornerStroke(STATION_COUNT);
    const uniform = await runChunked(runtime, stations, uniformChunks(STATION_COUNT));
    const randomized = await runChunked(runtime, stations, seededChunks(STATION_COUNT, 0x5eed));
    if (!uniform || !randomized) {
      return { status: "error", message: "a GPU run did not complete", capabilities: caps };
    }

    const selfParityState = bytesEqual(uniform.state, randomized.state);
    const selfParitySplats = bytesEqual(uniform.splats, randomized.splats);

    // CPU twin over the identical stations.
    const config = resolveStudioGpuBristleConfig(TUFT);
    const reference = createStudioGpuBristleReference(TUFT);
    const advanced = advanceStudioGpuBristleReference(reference, stations, {
      trace: true,
      traceBristle: TRACE_BRISTLE,
    });
    const referenceState = packStudioGpuBristleState(reference);
    const referenceSplats = packStudioGpuBristleSplats(advanced.splats);

    const shape = {
      bristleCount: config.bristleCount,
      verticesPerBristle: config.verticesPerBristle,
      restLengths: reference.restLengths,
    };
    const rootPath = advanced.trace!.root;
    const gpuLag = studioGpuBristleTipLag(
      rootPath,
      gpuTipPath(uniform.splats, config.bristleCount, TRACE_BRISTLE),
    );
    const referenceLag = studioGpuBristleTipLag(rootPath, advanced.trace!.tip);

    const judgements: StudioGpuBristleJudgement[] = [
      judgeStudioGpuBristleConstraintSatisfaction(uniform.state, shape),
      judgeStudioGpuBristlePigmentConservation(uniform.splats, referenceSplats),
      judgeStudioGpuBristleTipLag(
        gpuLag,
        referenceLag,
        config.bristleLength * config.baseRadiusPx,
      ),
      judgeStudioGpuBristleTerminalLoadDistribution(
        studioGpuBristleTerminalLoads(uniform.state, shape),
        studioGpuBristleTerminalLoads(referenceState, shape),
      ),
    ];

    // A real device-loss signal, not a capability claim: destroy the leased device and require the
    // runtime to reach its terminal state through `device.lost`.
    const lease = await acquireStudioGpuDevice();
    let deviceLoss: Record<string, unknown> = { status: "unavailable", reason: "no lease" };
    if (lease) {
      const before = runtime.status;
      lease.device.destroy();
      await lease.device.lost;
      await new Promise((resolve) => setTimeout(resolve, 50));
      deviceLoss = {
        status: "observed",
        trigger: "GPUDevice.destroy",
        statusBefore: before,
        runtimeStatus: runtime.status,
        advanceAfterLoss: runtime.advance({ stations: stations.slice(0, 4), place: false }),
      };
      lease.release();
    }

    return {
      status: "ok",
      backend: "webgpu",
      capabilities: caps,
      surface: SURFACE,
      stationCount: STATION_COUNT,
      tuft: { bristleCount: config.bristleCount, verticesPerBristle: config.verticesPerBristle },
      selfParity: {
        bristleState: selfParityState,
        splatSlots: selfParitySplats,
      },
      metrics: {
        gpuTipLagPx: gpuLag,
        referenceTipLagPx: referenceLag,
        gpuTerminalLoadStdDev: studioGpuBristleStandardDeviation(
          studioGpuBristleTerminalLoads(uniform.state, shape),
        ),
        depositedSplatCount: advanced.depositedSplatCount,
      },
      judgements,
      failures: studioGpuBristleFailures(judgements),
      admission,
      deviceLoss,
      uncapturedGpuErrors,
    };
  } finally {
    runtime.dispose();
    disposeStudioGpuFabric();
  }
}

run()
  .then((result) => {
    window.__studioGpuBristleParityResult = result;
  })
  .catch((error: unknown) => {
    window.__studioGpuBristleParityResult = {
      status: "error",
      message: error instanceof Error ? (error.stack ?? error.message) : String(error),
      capabilities: capabilities(),
    };
  });

export {};
