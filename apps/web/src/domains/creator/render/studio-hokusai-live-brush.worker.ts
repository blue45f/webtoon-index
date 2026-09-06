/// <reference lib="webworker" />

import {
  planStudioHokusaiContactDwell,
} from "./studio-hokusai-contact-dwell";
import {
  STUDIO_HOKUSAI_LIVE_ADAPTER_VERSION,
  STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
  STUDIO_HOKUSAI_LIVE_SAMPLE_STRIDE,
  snapshotStudioHokusaiLiveInboundMessage,
  studioHokusaiLiveOutboundTransfers,
  type StudioHokusaiLiveAppendMessage,
  type StudioHokusaiLiveBrushConfig,
  type StudioHokusaiLiveFailureMessage,
  type StudioHokusaiLiveWorkerOutboundMessage,
} from "./studio-hokusai-live-brush-protocol";
import {
  STUDIO_HOKUSAI_NATURAL_MEDIA_CONTRACT_VERSION,
  STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS,
} from "./studio-hokusai-natural-media-contract";
import {
  studioHokusaiNaturalMediaPresetJson,
} from "./studio-hokusai-natural-media-presets";
import {
  applyStudioHokusaiNaturalMediaTextureV2,
} from "./studio-hokusai-natural-media-texture-v2";
import {
  STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION,
} from "./studio-hokusai-natural-media-worker-protocol";

interface HokusaiBrushHandle {
  setColorHsv(hue: number, saturation: number, value: number): void;
  setRadiusLog(radiusLogarithmic: number): void;
  dispose?(): void;
  free?(): void;
}

interface HokusaiCanvasHandle {
  beginStroke(brush: HokusaiBrushHandle, seed: number): void;
  addSample(
    brush: HokusaiBrushHandle,
    x: number,
    y: number,
    pressure: number,
    tiltX: number,
    tiltY: number,
    timeMilliseconds: number,
  ): void;
  finishStroke(brush: HokusaiBrushHandle): void;
  fullFrame(): Uint8Array;
  dirtyBounds(): Int32Array;
  dirtyFrame(): Uint8Array;
  clearDirty(): void;
  dispose?(): void;
  free?(): void;
}

interface HokusaiRuntimeModule {
  default(input?: unknown): Promise<unknown>;
  HokusaiBrush: new (mybJson: string) => HokusaiBrushHandle;
  HokusaiCanvas: new (
    width: number,
    height: number,
    seed: number,
  ) => HokusaiCanvasHandle;
}

interface HokusaiLiveWorkerScope {
  readonly constructor?: Readonly<{ name?: string }>;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(
    message: StudioHokusaiLiveWorkerOutboundMessage,
    transfer?: readonly Transferable[],
  ): void;
  close(): void;
}

interface ActiveStroke {
  readonly requestId: number;
  readonly engineEpoch: number;
  readonly strokeId: string;
  readonly config: StudioHokusaiLiveBrushConfig;
  readonly brush: HokusaiBrushHandle;
  readonly canvas: HokusaiCanvasHandle;
  readonly inputChunks: Uint8Array[];
  readonly samples: Array<Readonly<{
    x: number;
    y: number;
    pressure: number;
    tiltX: number;
    tiltY: number;
    timeMilliseconds: number;
  }>>;
  /** Raw, opacity-adjusted Hokusai pixels retained solely for engine parity validation. */
  readonly rawRetainedPixels: Uint8Array;
  /** Product-authoritative pixels after material texture and endpoint shaping. */
  readonly retainedPixels: Uint8Array;
  lastSequence: number;
  sampleCount: number;
  compositeBounds: readonly [number, number, number, number] | null;
  frameInFlight: boolean;
  lastTransmittedSequence: number;
  pendingPresentationSequence: number | null;
  finishing: boolean;
}

const workerScope = globalThis as unknown as HokusaiLiveWorkerScope;
let active: ActiveStroke | null = null;
let highestEpoch = 0;
let operation = Promise.resolve();

function safeDetail(error: unknown, fallback: string): string {
  return (error instanceof Error && error.message ? error.message : fallback).slice(0, 512);
}

function post(message: StudioHokusaiLiveWorkerOutboundMessage): void {
  workerScope.postMessage(message, studioHokusaiLiveOutboundTransfers(message));
}

function failure(
  reason: StudioHokusaiLiveFailureMessage["reason"],
  detail: string,
  identity: Pick<ActiveStroke, "requestId" | "engineEpoch" | "strokeId"> | null = active,
): void {
  post({
    type: "studio-hokusai-live/failure",
    version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
    requestId: identity?.requestId ?? null,
    engineEpoch: identity?.engineEpoch ?? null,
    strokeId: identity?.strokeId ?? null,
    reason,
    detail: detail.slice(0, 512),
  });
}

function dispose(handle: { dispose?(): void; free?(): void } | null): void {
  if (!handle) return;
  try {
    if (typeof handle.dispose === "function") handle.dispose();
    else handle.free?.();
  } catch {
    // The authoritative operation has already completed or failed. Teardown is best effort.
  }
}

function disposeActive(): void {
  if (!active) return;
  dispose(active.canvas);
  dispose(active.brush);
  active = null;
}

function hexToHsv(color: `#${string}`): readonly [number, number, number] {
  const red = Number.parseInt(color.slice(1, 3), 16) / 255;
  const green = Number.parseInt(color.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(color.slice(5, 7), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 0) {
    if (maximum === red) hue = ((green - blue) / delta) % 6;
    else if (maximum === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }
  return [hue, maximum === 0 ? 0 : delta / maximum, maximum];
}

function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

async function sha256(bytes: Uint8Array): Promise<`sha256:${string}`> {
  const source = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", source as ArrayBuffer);
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

function normalizedDirtyBounds(
  bounds: Int32Array,
  width: number,
  height: number,
): readonly [number, number, number, number] | null {
  if (!(bounds instanceof Int32Array) || bounds.length !== 4) return null;
  const [x, y, dirtyWidth, dirtyHeight] = bounds;
  if (
    x === undefined
    || y === undefined
    || dirtyWidth === undefined
    || dirtyHeight === undefined
    || x < 0
    || y < 0
    || dirtyWidth <= 0
    || dirtyHeight <= 0
    || x + dirtyWidth > width
    || y + dirtyHeight > height
  ) return null;
  return [x, y, dirtyWidth, dirtyHeight];
}

function applyOpacity(pixels: Uint8Array, opacity: number): void {
  if (opacity >= 1) return;
  for (let index = 3; index < pixels.length; index += 4) {
    pixels[index] = Math.round((pixels[index] ?? 0) * opacity);
  }
}

function materialPlan(stroke: ActiveStroke) {
  return {
    kind: "studio-hokusai-natural-media/render-plan" as const,
    version: STUDIO_HOKUSAI_NATURAL_MEDIA_CONTRACT_VERSION,
    engine: {
      id: "reearth-hokusai" as const,
      version: "0.3.0" as const,
      brushFormat: "libmypaint-myb-v3" as const,
      alpha: "transparent-straight-rgba8" as const,
      execution: "dedicated-worker-wasm" as const,
    },
    source: {
      elementId: stroke.strokeId,
      brushId: stroke.config.presetId,
      sourcePointCount: stroke.samples.length,
      revision: "hokusai-source-v1:0000000000000000" as const,
    },
    presetId: stroke.config.presetId,
    materialProfileId: stroke.config.materialProfileId,
    color: stroke.config.color,
    opacity: stroke.config.opacity,
    seed: stroke.config.seed,
    logicalBounds: {
      x: stroke.config.logicalOriginX,
      y: stroke.config.logicalOriginY,
      width: stroke.config.surfaceWidth,
      height: stroke.config.surfaceHeight,
    },
    raster: {
      width: stroke.config.surfaceWidth,
      height: stroke.config.surfaceHeight,
      scale: 1,
      radiusPixels: stroke.config.radiusPixels,
    },
    samples: stroke.samples,
  };
}

function hasVisiblePixel(pixels: Uint8Array): boolean {
  for (let index = 3; index < pixels.length; index += 4) {
    if ((pixels[index] ?? 0) > 0) return true;
  }
  return false;
}

interface PackedDirtyFrame {
  readonly bounds: readonly [number, number, number, number];
  readonly pixels: Uint8Array;
  readonly pixelHash: `sha256:${string}`;
}

function unionBounds(
  left: readonly [number, number, number, number] | null,
  right: readonly [number, number, number, number],
): readonly [number, number, number, number] {
  if (!left) return right;
  const x = Math.min(left[0], right[0]);
  const y = Math.min(left[1], right[1]);
  const maximumX = Math.max(left[0] + left[2], right[0] + right[2]);
  const maximumY = Math.max(left[1] + left[3], right[1] + right[3]);
  return [x, y, maximumX - x, maximumY - y];
}

function writePackedPatch(
  destination: Uint8Array,
  surfaceWidth: number,
  bounds: readonly [number, number, number, number],
  patch: Uint8Array,
): void {
  const [x, y, width, height] = bounds;
  for (let row = 0; row < height; row += 1) {
    const sourceStart = row * width * 4;
    const destinationStart = ((y + row) * surfaceWidth + x) * 4;
    destination.set(
      patch.subarray(sourceStart, sourceStart + width * 4),
      destinationStart,
    );
  }
}

function cropPackedFrame(
  source: Uint8Array,
  surfaceWidth: number,
  bounds: readonly [number, number, number, number],
): Uint8Array {
  const [x, y, width, height] = bounds;
  const crop = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * surfaceWidth + x) * 4;
    crop.set(
      source.subarray(sourceStart, sourceStart + width * 4),
      row * width * 4,
    );
  }
  return crop;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function takePackedDirtyFrame(stroke: ActiveStroke): Promise<PackedDirtyFrame | null> {
  const rawBounds = stroke.canvas.dirtyBounds();
  if (rawBounds instanceof Int32Array && rawBounds.length === 0) return null;
  const bounds = normalizedDirtyBounds(
    rawBounds,
    stroke.config.surfaceWidth,
    stroke.config.surfaceHeight,
  );
  if (!bounds) throw new Error("Hokusai returned no valid dirty frame.");
  const pixels = stroke.canvas.dirtyFrame();
  const expectedBytes = bounds[2] * bounds[3] * 4;
  if (!(pixels instanceof Uint8Array) || pixels.byteLength !== expectedBytes) {
    throw new Error("Hokusai returned an invalid packed dirty RGBA frame.");
  }
  applyOpacity(pixels, stroke.config.opacity);
  if (!hasVisiblePixel(pixels)) throw new Error("Hokusai returned a blank frame.");
  // A WASM-memory view is never transferred directly. Only the bounded packed dirty crop is
  // copied once inside the Worker; the main thread receives ownership without a full-frame copy.
  const rawOwned = pixels.slice();
  stroke.canvas.clearDirty();
  writePackedPatch(
    stroke.rawRetainedPixels,
    stroke.config.surfaceWidth,
    bounds,
    rawOwned,
  );
  const owned = rawOwned.slice();
  applyStudioHokusaiNaturalMediaTextureV2(owned, materialPlan(stroke), {
    frameBounds: bounds,
    dirtyBounds: bounds,
  });
  writePackedPatch(stroke.retainedPixels, stroke.config.surfaceWidth, bounds, owned);
  stroke.compositeBounds = unionBounds(stroke.compositeBounds, bounds);
  return { bounds, pixels: owned, pixelHash: await sha256(owned) };
}

async function encodePng(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", {
    alpha: true,
    desynchronized: true,
    willReadFrequently: false,
  });
  if (!context) throw new Error("OffscreenCanvas 2D is unavailable.");
  const image = context.createImageData(width, height);
  image.data.set(pixels);
  context.putImageData(image, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  canvas.width = 1;
  canvas.height = 1;
  if (
    blob.type !== "image/png"
    || blob.size <= 0
    || blob.size > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxPngBytes
  ) throw new Error("Hokusai canonical PNG is invalid or over budget.");
  return new Uint8Array(await blob.arrayBuffer());
}

async function inputHash(stroke: ActiveStroke): Promise<`sha256:${string}`> {
  const config = new TextEncoder().encode(JSON.stringify(stroke.config));
  const byteLength = stroke.inputChunks.reduce(
    (total, chunk) => total + chunk.byteLength,
    config.byteLength,
  );
  const joined = new Uint8Array(byteLength);
  joined.set(config, 0);
  let offset = config.byteLength;
  for (const chunk of stroke.inputChunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return sha256(joined);
}

function sameIdentity(
  stroke: ActiveStroke,
  message: Readonly<{ requestId: number; engineEpoch: number; strokeId: string }>,
): boolean {
  return stroke.requestId === message.requestId
    && stroke.engineEpoch === message.engineEpoch
    && stroke.strokeId === message.strokeId;
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer as ArrayBuffer
    : bytes.slice().buffer as ArrayBuffer;
}

async function handleAppend(message: StudioHokusaiLiveAppendMessage): Promise<void> {
  const stroke = active;
  if (!stroke || !sameIdentity(stroke, message)) {
    failure("stale-epoch", "Hokusai append does not match the active stroke.", message);
    return;
  }
  if (message.sequence !== stroke.lastSequence + 1) {
    failure("invalid-sequence", "Hokusai live batches must be strictly contiguous.", stroke);
    disposeActive();
    return;
  }
  const samples = new Float32Array(message.samples);
  stroke.inputChunks.push(new Uint8Array(message.samples));
  for (let index = 0; index < message.sampleCount; index += 1) {
    const offset = index * STUDIO_HOKUSAI_LIVE_SAMPLE_STRIDE;
    const localX = (samples[offset] ?? 0) - stroke.config.logicalOriginX;
    const localY = (samples[offset + 1] ?? 0) - stroke.config.logicalOriginY;
    const pressure = samples[offset + 2] ?? 0.5;
    const tiltX = samples[offset + 3] ?? 0;
    const tiltY = samples[offset + 4] ?? 0;
    const timeMilliseconds = samples[offset + 5] ?? 0;
    if (
      localX < 0
      || localY < 0
      || localX >= stroke.config.surfaceWidth
      || localY >= stroke.config.surfaceHeight
    ) {
      failure(
        "budget-exceeded",
        "Hokusai sample left the admitted stroke-local segment; the provider must rebase before append.",
        stroke,
      );
      disposeActive();
      return;
    }
    stroke.samples.push({
      x: localX,
      y: localY,
      pressure,
      tiltX,
      tiltY,
      timeMilliseconds,
    });
    stroke.canvas.addSample(
      stroke.brush,
      localX,
      localY,
      pressure,
      tiltX,
      tiltY,
      timeMilliseconds,
    );
  }
  stroke.sampleCount += message.sampleCount;
  stroke.lastSequence = message.sequence;
  if (stroke.frameInFlight) {
    // Input is never dropped. Only stale presentation is coalesced while one transferable frame
    // is owned by the main thread.
    stroke.pendingPresentationSequence = message.sequence;
    return;
  }
  await emitLiveFrame(stroke, message.sequence);
}

async function emitLiveFrame(
  stroke: ActiveStroke,
  sequence: number,
  phase: "live" | "settle-tail" = "live",
  preparedFrame?: PackedDirtyFrame,
): Promise<void> {
  const frame = preparedFrame ?? await takePackedDirtyFrame(stroke);
  if (!frame) {
    if (phase !== "live") {
      throw new Error("Hokusai settle tail did not contain a prepared dirty frame.");
    }
    // Slow tracking intentionally delays its first dab until enough motion or
    // pointer-up time has accumulated. Acknowledge that exact accepted prefix
    // without fabricating transparent pixels; the next dirty frame or finish
    // tail remains the sole visual authority.
    stroke.lastTransmittedSequence = sequence;
    stroke.pendingPresentationSequence = null;
    post({
      type: "studio-hokusai-live/accepted",
      version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
      requestId: stroke.requestId,
      engineEpoch: stroke.engineEpoch,
      strokeId: stroke.strokeId,
      sequence,
      presentation: "no-dirty-pixels",
    });
    return;
  }
  stroke.frameInFlight = true;
  stroke.lastTransmittedSequence = sequence;
  stroke.pendingPresentationSequence = null;
  const pixels = ownedBuffer(frame.pixels);
  post({
    type: "studio-hokusai-live/frame",
    version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
    requestId: stroke.requestId,
    engineEpoch: stroke.engineEpoch,
    strokeId: stroke.strokeId,
    sequence,
    phase,
    segmentIndex: stroke.config.segmentIndex,
    dirtyBounds: frame.bounds,
    logicalPlacement: {
      x: stroke.config.logicalOriginX + frame.bounds[0],
      y: stroke.config.logicalOriginY + frame.bounds[1],
      width: frame.bounds[2],
      height: frame.bounds[3],
    },
    pixelLayout: "packed-dirty-rgba8",
    pixels,
    pixelHash: frame.pixelHash,
  });
}

/**
 * Deposit the planned contact dwell for a stroke whose carrier never reached one dab of travel.
 *
 * This runs strictly after `finishStroke` observed an empty dirty region for the whole stroke, so
 * it cannot alter the geometry of any stroke that already composed pixels. The dwell re-opens the
 * same canvas with the stroke's own seed and brush snapshot, so the deposited mark is a
 * deterministic function of the admitted config plus the artist's own contact samples. The
 * synthesized samples are deliberately absent from `inputChunks`/`sampleCount`: the receipt keeps
 * describing the artist's input, and the recovery stays a pure function of it.
 */
async function depositContactDwell(stroke: ActiveStroke): Promise<PackedDirtyFrame | null> {
  if (stroke.compositeBounds) return null;
  const dwell = planStudioHokusaiContactDwell({
    samples: stroke.samples,
    radiusPixels: stroke.config.radiusPixels,
    surfaceWidth: stroke.config.surfaceWidth,
    surfaceHeight: stroke.config.surfaceHeight,
  });
  if (!dwell) return null;
  stroke.canvas.beginStroke(stroke.brush, stroke.config.seed);
  for (const sample of dwell) {
    stroke.canvas.addSample(
      stroke.brush,
      sample.x,
      sample.y,
      sample.pressure,
      sample.tiltX,
      sample.tiltY,
      sample.timeMilliseconds,
    );
  }
  stroke.canvas.finishStroke(stroke.brush);
  return takePackedDirtyFrame(stroke);
}

/** One full-frame read is permitted only at canonical finish, never on a live pointer batch. */
async function completeCanonicalStroke(stroke: ActiveStroke): Promise<void> {
  const bounds = stroke.compositeBounds;
  if (!bounds) throw new Error("Hokusai canonical stroke has no composed live pixels.");
  const full = stroke.canvas.fullFrame();
  const expectedBytes = stroke.config.surfaceWidth * stroke.config.surfaceHeight * 4;
  if (!(full instanceof Uint8Array) || full.byteLength !== expectedBytes) {
    throw new Error("Hokusai canonical full frame is invalid.");
  }
  applyOpacity(full, stroke.config.opacity);
  const canonical = cropPackedFrame(full, stroke.config.surfaceWidth, bounds);
  const rawRetained = cropPackedFrame(
    stroke.rawRetainedPixels,
    stroke.config.surfaceWidth,
    bounds,
  );
  if (!equalBytes(rawRetained, canonical)) {
    throw new Error(
      "Hokusai raw acknowledged patch composition differs from the canonical full frame.",
    );
  }
  const retained = cropPackedFrame(
    stroke.retainedPixels,
    stroke.config.surfaceWidth,
    bounds,
  );
  // The acknowledged textured live composition is the visual authority. The
  // separate raw parity check above still proves no Hokusai engine pixels were
  // lost while avoiding a second material/opacity pass at canonical finish.
  const texturedCanonical = retained;
  const [lastLivePixelHash, settledPixelHash] = await Promise.all([
    sha256(retained),
    sha256(texturedCanonical),
  ]);
  if (lastLivePixelHash !== settledPixelHash) {
    throw new Error("Hokusai live/canonical composite hash parity failed.");
  }
  const png = await encodePng(texturedCanonical, bounds[2], bounds[3]);
  const [canonicalInputHash, pngHash] = await Promise.all([
    inputHash(stroke),
    sha256(png),
  ]);
  const logicalPlacement = {
    x: stroke.config.logicalOriginX + bounds[0],
    y: stroke.config.logicalOriginY + bounds[1],
    width: bounds[2],
    height: bounds[3],
  };
  const pixels = ownedBuffer(texturedCanonical);
  const pngBytes = ownedBuffer(png);
  post({
    type: "studio-hokusai-live/complete",
    version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
    requestId: stroke.requestId,
    engineEpoch: stroke.engineEpoch,
    strokeId: stroke.strokeId,
    finalSequence: stroke.lastSequence,
    segmentIndex: stroke.config.segmentIndex,
    dirtyBounds: bounds,
    logicalPlacement,
    pixelLayout: "packed-dirty-rgba8",
    pixels,
    pngBytes,
    receipt: {
      kind: "studio-hokusai-live/canonical-receipt",
      version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
      requestId: stroke.requestId,
      engineEpoch: stroke.engineEpoch,
      strokeId: stroke.strokeId,
      presetId: stroke.config.presetId,
      materialProfileId: stroke.config.materialProfileId,
      seed: stroke.config.seed,
      sampleCount: stroke.sampleCount,
      finalSequence: stroke.lastSequence,
      segmentCount: 1,
      segments: [{
        segmentIndex: stroke.config.segmentIndex,
        logicalPlacement,
        pixelHash: settledPixelHash,
        pngHash,
      }],
      dirtyBounds: bounds,
      pixelLayout: "packed-dirty-rgba8",
      inputHash: canonicalInputHash,
      lastLivePixelHash,
      settledPixelHash,
      pngHash,
      exactLiveCommitParity: true,
      materialTexture: "studio-hokusai-material-texture-v2",
      endpointPolicy: "tapered-start-no-dab-carrier-v1",
      colorOpacityApplication: "worker-once-before-material-transfer-v1",
      execution: "dedicated-worker-wasm-packed-dirty-live",
      canonicalAuthority: "settled-png-receipt-v1",
      undoAuthority: "single-stroke-transaction-v1",
      saveAuthority: "canonical-png-plus-versioned-receipt-v1",
      complete: true,
    },
  });
  disposeActive();
}

async function loadRuntime(): Promise<HokusaiRuntimeModule> {
  const runtime = await import("../../../../../../packages/studio-hokusai-wasm/pkg/studio_hokusai_wasm.js"
  ) as unknown as HokusaiRuntimeModule;
  if (
    typeof runtime.default !== "function"
    || typeof runtime.HokusaiBrush !== "function"
    || typeof runtime.HokusaiCanvas !== "function"
  ) throw new Error("Hokusai WASM exports are incomplete.");
  await runtime.default();
  return runtime;
}

async function main(): Promise<void> {
  const scopeName = (() => {
    try {
      return Object.getPrototypeOf(globalThis)?.constructor?.name
        ?? workerScope.constructor?.name
        ?? "";
    } catch {
      return "";
    }
  })();
  if (
    scopeName !== "DedicatedWorkerGlobalScope"
    || typeof WebAssembly !== "object"
    || typeof OffscreenCanvas !== "function"
    || typeof globalThis.crypto?.subtle?.digest !== "function"
  ) {
    failure(
      "runtime-unavailable",
      "Hokusai live requires Dedicated Worker, WebAssembly, OffscreenCanvas and Web Crypto.",
      null,
    );
    workerScope.close();
    return;
  }
  let runtime: HokusaiRuntimeModule;
  try {
    runtime = await loadRuntime();
  } catch (error) {
    failure("runtime-unavailable", safeDetail(error, "Hokusai WASM failed to load."), null);
    workerScope.close();
    return;
  }

  post({
    type: "studio-hokusai-live/ready",
    version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
    capabilities: {
      engine: "reearth-hokusai",
      engineVersion: "0.3.0",
      surfaceAdapterVersion: STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION,
      liveAdapterVersion: STUDIO_HOKUSAI_LIVE_ADAPTER_VERSION,
      wasm: true,
      dedicatedWorker: true,
      packedDirtyFrames: true,
      transferableFrames: true,
      epochCancellation: true,
      canonicalPng: true,
      liveCommitParityReceipt: true,
      materialTexture: "studio-hokusai-material-texture-v2",
      materialProfileRouting: "identity-profile-v1",
      endpointPolicy: "tapered-start-no-dab-carrier-v1",
      mainThreadFullFrameCopy: false,
    },
  });

  workerScope.onmessageerror = () => {
    failure("invalid-message", "Hokusai live request could not be cloned.");
    disposeActive();
  };
  workerScope.onmessage = (event) => {
    const message = snapshotStudioHokusaiLiveInboundMessage(event.data);
    operation = operation.then(async () => {
      if (!message) {
        failure("invalid-message", "Hokusai live request validation failed.");
        disposeActive();
        return;
      }
      if (message.type === "studio-hokusai-live/begin") {
        if (message.engineEpoch <= highestEpoch || active) {
          failure("stale-epoch", "Hokusai live begin epoch is stale or a stroke is active.", message);
          return;
        }
        highestEpoch = message.engineEpoch;
        let brush: HokusaiBrushHandle | null = null;
        let canvas: HokusaiCanvasHandle | null = null;
        try {
          brush = new runtime.HokusaiBrush(
            studioHokusaiNaturalMediaPresetJson(message.config.presetId),
          );
          const [hue, saturation, value] = hexToHsv(message.config.color);
          brush.setColorHsv(hue, saturation, value);
          brush.setRadiusLog(Math.log2(Math.max(0.1, message.config.radiusPixels)));
          canvas = new runtime.HokusaiCanvas(
            message.config.surfaceWidth,
            message.config.surfaceHeight,
            message.config.seed,
          );
          canvas.beginStroke(brush, message.config.seed);
          active = {
            requestId: message.requestId,
            engineEpoch: message.engineEpoch,
            strokeId: message.strokeId,
            config: message.config,
            brush,
            canvas,
            inputChunks: [],
            samples: [],
            rawRetainedPixels: new Uint8Array(
              message.config.surfaceWidth * message.config.surfaceHeight * 4,
            ),
            retainedPixels: new Uint8Array(
              message.config.surfaceWidth * message.config.surfaceHeight * 4,
            ),
            lastSequence: 0,
            sampleCount: 0,
            compositeBounds: null,
            frameInFlight: false,
            lastTransmittedSequence: 0,
            pendingPresentationSequence: null,
            finishing: false,
          };
          post({
            type: "studio-hokusai-live/begun",
            version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
            requestId: message.requestId,
            engineEpoch: message.engineEpoch,
            strokeId: message.strokeId,
          });
        } catch (error) {
          dispose(canvas);
          dispose(brush);
          failure("render-failed", safeDetail(error, "Hokusai live begin failed."), message);
        }
        return;
      }
      if (message.type === "studio-hokusai-live/append") {
        await handleAppend(message);
        return;
      }
      if (message.type === "studio-hokusai-live/frame-ack") {
        const stroke = active;
        if (
          !stroke
          || !sameIdentity(stroke, message)
          || !stroke.frameInFlight
          || message.sequence !== stroke.lastTransmittedSequence
        ) {
          failure("invalid-sequence", "Hokusai live frame acknowledgement is stale.", message);
          return;
        }
        stroke.frameInFlight = false;
        const pending = stroke.pendingPresentationSequence;
        stroke.pendingPresentationSequence = null;
        if (pending !== null) await emitLiveFrame(stroke, pending);
        else if (stroke.finishing) await completeCanonicalStroke(stroke);
        return;
      }
      if (message.type === "studio-hokusai-live/cancel") {
        if (active && sameIdentity(active, message)) disposeActive();
        highestEpoch = Math.max(highestEpoch, message.engineEpoch);
        post({
          type: "studio-hokusai-live/cancelled",
          version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
          requestId: message.requestId,
          engineEpoch: message.engineEpoch,
          strokeId: message.strokeId,
        });
        return;
      }
      const stroke = active;
      if (
        !stroke
        || !sameIdentity(stroke, message)
        || message.finalSequence !== stroke.lastSequence
        || stroke.frameInFlight
        || stroke.pendingPresentationSequence !== null
        || stroke.lastTransmittedSequence !== stroke.lastSequence
        || stroke.sampleCount <= 0
      ) {
        failure("invalid-sequence", "Hokusai finish does not match the accepted live prefix.", message);
        disposeActive();
        return;
      }
      try {
        stroke.finishing = true;
        stroke.canvas.finishStroke(stroke.brush);
        // A zero-travel gesture (a deliberate tap) leaves the carrier with nothing to deposit.
        // Recover it as one bounded contact dwell instead of failing the whole stroke, so a tap
        // lands the natural-media point an artist expects rather than an exact-vector apology.
        const tail = await takePackedDirtyFrame(stroke)
          ?? await depositContactDwell(stroke);
        if (tail) {
          // The main-thread overlay must compose and acknowledge the finish tail before canonical
          // completion. This prevents the pointer-up image from popping to a different result.
          await emitLiveFrame(stroke, stroke.lastSequence, "settle-tail", tail);
        } else {
          await completeCanonicalStroke(stroke);
        }
      } catch (error) {
        const detail = safeDetail(error, "Hokusai live finish failed.");
        failure(
          detail.includes("parity") ? "parity-failed"
            : detail.includes("blank") ? "blank-output"
              : "render-failed",
          detail,
          stroke,
        );
        disposeActive();
      }
    }).catch((error) => {
      failure("render-failed", safeDetail(error, "Hokusai live operation failed."));
      disposeActive();
    });
  };
}

void main();
