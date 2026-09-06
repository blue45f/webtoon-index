import {
  STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS,
  STUDIO_HOKUSAI_NATURAL_MEDIA_PRESETS,
  STUDIO_HOKUSAI_RUNTIME_VERSION,
  studioHokusaiMaterialProfileIsCompatible,
  type StudioHokusaiMaterialProfileId,
  type StudioHokusaiNaturalMediaPresetId,
} from "./studio-hokusai-natural-media-contract";
import {
  STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION,
} from "./studio-hokusai-natural-media-worker-protocol";

export const STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION = 2 as const;
export const STUDIO_HOKUSAI_LIVE_SAMPLE_STRIDE = 6 as const;
export const STUDIO_HOKUSAI_LIVE_MAX_BATCH_SAMPLES = 4_096 as const;
// Hokusai's spatial slow-tracking filter becomes geometry-destructive when a
// mouse/legacy path has no sensor clock (or reports sub-millisecond batches).
// A deterministic 100 Hz floor preserves sparse authored curves while staying
// within the Studio pointer sampler's professional 120 Hz response class.
export const STUDIO_HOKUSAI_LIVE_MIN_SAMPLE_INTERVAL_MS = 10 as const;
export const STUDIO_HOKUSAI_LIVE_ADAPTER_VERSION =
  "0.3.0-packed-dirty-live-adapter.3-profile-routing" as const;

export interface StudioHokusaiLiveBrushCapabilities {
  readonly engine: "reearth-hokusai";
  readonly engineVersion: typeof STUDIO_HOKUSAI_RUNTIME_VERSION;
  readonly surfaceAdapterVersion: typeof STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION;
  readonly liveAdapterVersion: typeof STUDIO_HOKUSAI_LIVE_ADAPTER_VERSION;
  readonly wasm: true;
  readonly dedicatedWorker: true;
  readonly packedDirtyFrames: true;
  readonly transferableFrames: true;
  readonly epochCancellation: true;
  readonly canonicalPng: true;
  readonly liveCommitParityReceipt: true;
  readonly materialTexture: "studio-hokusai-material-texture-v2";
  readonly materialProfileRouting: "identity-profile-v1";
  readonly endpointPolicy: "tapered-start-no-dab-carrier-v1";
  readonly mainThreadFullFrameCopy: false;
}

export interface StudioHokusaiLiveBrushConfig {
  /** Logical document extent is informational and may be much larger than the WASM surface. */
  readonly documentWidth: number;
  readonly documentHeight: number;
  /** Bounded stroke-local surface; never allocate a full vertical-webtoon document. */
  readonly surfaceWidth: number;
  readonly surfaceHeight: number;
  readonly logicalOriginX: number;
  readonly logicalOriginY: number;
  readonly segmentIndex: number;
  readonly presetId: StudioHokusaiNaturalMediaPresetId;
  readonly materialProfileId: StudioHokusaiMaterialProfileId;
  readonly color: `#${string}`;
  readonly opacity: number;
  readonly radiusPixels: number;
  readonly seed: number;
}

export interface StudioHokusaiLiveSampleLike {
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;
  readonly tiltX?: number;
  readonly tiltY?: number;
  readonly timeMilliseconds?: number;
}

interface StudioHokusaiLiveMessageIdentity {
  readonly version: typeof STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly engineEpoch: number;
  readonly strokeId: string;
}

export interface StudioHokusaiLiveBeginMessage
  extends StudioHokusaiLiveMessageIdentity {
  readonly type: "studio-hokusai-live/begin";
  readonly config: StudioHokusaiLiveBrushConfig;
}

export interface StudioHokusaiLiveAppendMessage
  extends StudioHokusaiLiveMessageIdentity {
  readonly type: "studio-hokusai-live/append";
  readonly sequence: number;
  readonly sampleCount: number;
  readonly sampleStride: typeof STUDIO_HOKUSAI_LIVE_SAMPLE_STRIDE;
  readonly samples: ArrayBuffer;
}

export interface StudioHokusaiLiveFinishMessage
  extends StudioHokusaiLiveMessageIdentity {
  readonly type: "studio-hokusai-live/finish";
  readonly finalSequence: number;
}

export interface StudioHokusaiLiveFrameAckMessage
  extends StudioHokusaiLiveMessageIdentity {
  readonly type: "studio-hokusai-live/frame-ack";
  readonly sequence: number;
}

export interface StudioHokusaiLiveCancelMessage
  extends StudioHokusaiLiveMessageIdentity {
  readonly type: "studio-hokusai-live/cancel";
  readonly reason: "abort" | "epoch-replaced" | "user-cancelled";
}

export type StudioHokusaiLiveWorkerInboundMessage =
  | StudioHokusaiLiveBeginMessage
  | StudioHokusaiLiveAppendMessage
  | StudioHokusaiLiveFinishMessage
  | StudioHokusaiLiveFrameAckMessage
  | StudioHokusaiLiveCancelMessage;

export interface StudioHokusaiLiveReadyMessage {
  readonly type: "studio-hokusai-live/ready";
  readonly version: typeof STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION;
  readonly capabilities: StudioHokusaiLiveBrushCapabilities;
}

export interface StudioHokusaiLiveBegunMessage
  extends StudioHokusaiLiveMessageIdentity {
  readonly type: "studio-hokusai-live/begun";
}

export interface StudioHokusaiLiveFrameMessage
  extends StudioHokusaiLiveMessageIdentity {
  readonly type: "studio-hokusai-live/frame";
  readonly sequence: number;
  /** The settle tail uses the final input sequence and must be acknowledged before completion. */
  readonly phase: "live" | "settle-tail";
  readonly segmentIndex: number;
  readonly dirtyBounds: readonly [number, number, number, number];
  readonly logicalPlacement: Readonly<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>;
  readonly pixelLayout: "packed-dirty-rgba8";
  readonly pixels: ArrayBuffer;
  readonly pixelHash: `sha256:${string}`;
}

/**
 * The input prefix was consumed but the slow-tracking brush has not produced
 * a dirty pixel yet. Pointer-down commonly takes this path; it is successful
 * backpressure progress, not a blank-frame failure.
 */
export interface StudioHokusaiLiveAcceptedMessage
  extends StudioHokusaiLiveMessageIdentity {
  readonly type: "studio-hokusai-live/accepted";
  readonly sequence: number;
  readonly presentation: "no-dirty-pixels";
}

export interface StudioHokusaiLiveCanonicalReceipt {
  readonly kind: "studio-hokusai-live/canonical-receipt";
  readonly version: typeof STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly engineEpoch: number;
  readonly strokeId: string;
  readonly presetId: StudioHokusaiNaturalMediaPresetId;
  readonly materialProfileId: StudioHokusaiMaterialProfileId;
  readonly seed: number;
  readonly sampleCount: number;
  readonly finalSequence: number;
  readonly segmentCount: number;
  readonly segments: readonly Readonly<{
    readonly segmentIndex: number;
    readonly logicalPlacement: Readonly<{
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }>;
    readonly pixelHash: `sha256:${string}`;
    readonly pngHash: `sha256:${string}`;
  }>[];
  readonly dirtyBounds: readonly [number, number, number, number];
  readonly pixelLayout: "packed-dirty-rgba8";
  readonly inputHash: `sha256:${string}`;
  /** Hash of all acknowledged live patches after the settle tail is composed. */
  readonly lastLivePixelHash: `sha256:${string}`;
  readonly settledPixelHash: `sha256:${string}`;
  readonly pngHash: `sha256:${string}`;
  readonly exactLiveCommitParity: true;
  readonly materialTexture: "studio-hokusai-material-texture-v2";
  readonly endpointPolicy: "tapered-start-no-dab-carrier-v1";
  readonly colorOpacityApplication: "worker-once-before-material-transfer-v1";
  readonly execution: "dedicated-worker-wasm-packed-dirty-live";
  readonly canonicalAuthority: "settled-png-receipt-v1";
  readonly undoAuthority: "single-stroke-transaction-v1";
  readonly saveAuthority: "canonical-png-plus-versioned-receipt-v1";
  readonly complete: true;
}

export interface StudioHokusaiLiveCompleteMessage
  extends StudioHokusaiLiveMessageIdentity {
  readonly type: "studio-hokusai-live/complete";
  readonly finalSequence: number;
  readonly segmentIndex: number;
  readonly dirtyBounds: readonly [number, number, number, number];
  readonly logicalPlacement: Readonly<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>;
  readonly pixelLayout: "packed-dirty-rgba8";
  readonly pixels: ArrayBuffer;
  readonly pngBytes: ArrayBuffer;
  readonly receipt: StudioHokusaiLiveCanonicalReceipt;
}

export interface StudioHokusaiLiveCancelledMessage
  extends StudioHokusaiLiveMessageIdentity {
  readonly type: "studio-hokusai-live/cancelled";
}

export interface StudioHokusaiLiveFailureMessage {
  readonly type: "studio-hokusai-live/failure";
  readonly version: typeof STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION;
  readonly requestId: number | null;
  readonly engineEpoch: number | null;
  readonly strokeId: string | null;
  readonly reason:
    | "blank-output"
    | "budget-exceeded"
    | "invalid-message"
    | "invalid-sequence"
    | "parity-failed"
    | "render-failed"
    | "runtime-unavailable"
    | "stale-epoch";
  readonly detail: string;
}

export type StudioHokusaiLiveWorkerOutboundMessage =
  | StudioHokusaiLiveReadyMessage
  | StudioHokusaiLiveBegunMessage
  | StudioHokusaiLiveAcceptedMessage
  | StudioHokusaiLiveFrameMessage
  | StudioHokusaiLiveCompleteMessage
  | StudioHokusaiLiveCancelledMessage
  | StudioHokusaiLiveFailureMessage;

const PRESET_IDS = new Set<string>(
  STUDIO_HOKUSAI_NATURAL_MEDIA_PRESETS.map(({ id }) => id),
);
const COLOR_PATTERN = /^#[0-9a-f]{6}$/u;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown, minimum = 1): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function arrayBuffer(value: unknown): value is ArrayBuffer {
  return typeof value === "object"
    && value !== null
    && Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

function validIdentity(value: Record<string, unknown>): boolean {
  return value.version === STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION
    && integer(value.requestId)
    && integer(value.engineEpoch)
    && typeof value.strokeId === "string"
    && value.strokeId.length > 0
    && value.strokeId.length <= STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxIdentityCodeUnits;
}

export function snapshotStudioHokusaiLiveConfig(
  candidate: unknown,
): StudioHokusaiLiveBrushConfig | null {
  if (
    !isRecord(candidate)
    || !finite(candidate.documentWidth)
    || !finite(candidate.documentHeight)
    || candidate.documentWidth <= 0
    || candidate.documentHeight <= 0
    || candidate.documentWidth > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxSourceCoordinate
    || candidate.documentHeight > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxSourceCoordinate
    || !integer(candidate.surfaceWidth)
    || !integer(candidate.surfaceHeight)
    || candidate.surfaceWidth > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxDimension
    || candidate.surfaceHeight > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxDimension
    || candidate.surfaceWidth * candidate.surfaceHeight
      > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxPixels
    || !finite(candidate.logicalOriginX)
    || !finite(candidate.logicalOriginY)
    || !integer(candidate.segmentIndex, 0)
    || !PRESET_IDS.has(String(candidate.presetId))
    || !studioHokusaiMaterialProfileIsCompatible(
      candidate.presetId as StudioHokusaiNaturalMediaPresetId,
      candidate.materialProfileId,
    )
    || typeof candidate.color !== "string"
    || !COLOR_PATTERN.test(candidate.color)
    || !finite(candidate.opacity)
    || candidate.opacity <= 0
    || candidate.opacity > 1
    || !finite(candidate.radiusPixels)
    || candidate.radiusPixels < STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.minLogicalSize
    || candidate.radiusPixels > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxLogicalSize
    || !integer(candidate.seed, 0)
    || candidate.seed > 0xffff_ffff
  ) return null;
  return Object.freeze({
    documentWidth: candidate.documentWidth,
    documentHeight: candidate.documentHeight,
    surfaceWidth: candidate.surfaceWidth,
    surfaceHeight: candidate.surfaceHeight,
    logicalOriginX: candidate.logicalOriginX,
    logicalOriginY: candidate.logicalOriginY,
    segmentIndex: candidate.segmentIndex,
    presetId: candidate.presetId as StudioHokusaiNaturalMediaPresetId,
    materialProfileId: candidate.materialProfileId,
    color: candidate.color as `#${string}`,
    opacity: candidate.opacity,
    radiusPixels: candidate.radiusPixels,
    seed: candidate.seed,
  });
}

export function snapshotStudioHokusaiLiveInboundMessage(
  candidate: unknown,
): StudioHokusaiLiveWorkerInboundMessage | null {
  if (!isRecord(candidate) || !validIdentity(candidate)) return null;
  if (candidate.type === "studio-hokusai-live/begin") {
    const config = snapshotStudioHokusaiLiveConfig(candidate.config);
    return config ? Object.freeze({
      type: candidate.type,
      version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
      requestId: candidate.requestId as number,
      engineEpoch: candidate.engineEpoch as number,
      strokeId: candidate.strokeId as string,
      config,
    }) : null;
  }
  if (candidate.type === "studio-hokusai-live/append") {
    if (
      !integer(candidate.sequence)
      || !integer(candidate.sampleCount)
      || candidate.sampleCount > STUDIO_HOKUSAI_LIVE_MAX_BATCH_SAMPLES
      || candidate.sampleStride !== STUDIO_HOKUSAI_LIVE_SAMPLE_STRIDE
      || !arrayBuffer(candidate.samples)
      || candidate.samples.byteLength
        !== candidate.sampleCount * STUDIO_HOKUSAI_LIVE_SAMPLE_STRIDE * Float32Array.BYTES_PER_ELEMENT
    ) return null;
    return candidate as unknown as StudioHokusaiLiveAppendMessage;
  }
  if (candidate.type === "studio-hokusai-live/finish") {
    return integer(candidate.finalSequence, 0)
      ? candidate as unknown as StudioHokusaiLiveFinishMessage
      : null;
  }
  if (candidate.type === "studio-hokusai-live/frame-ack") {
    return integer(candidate.sequence)
      ? candidate as unknown as StudioHokusaiLiveFrameAckMessage
      : null;
  }
  if (candidate.type === "studio-hokusai-live/cancel") {
    return ["abort", "epoch-replaced", "user-cancelled"].includes(String(candidate.reason))
      ? candidate as unknown as StudioHokusaiLiveCancelMessage
      : null;
  }
  return null;
}

export interface StudioHokusaiLivePackedSamples {
  readonly buffer: ArrayBuffer;
  readonly lastTimeMilliseconds: number;
}

export function packStudioHokusaiLiveSamples(
  samples: readonly StudioHokusaiLiveSampleLike[],
  previousBatchTimeMilliseconds: number | null = null,
): StudioHokusaiLivePackedSamples {
  if (
    samples.length === 0
    || samples.length > STUDIO_HOKUSAI_LIVE_MAX_BATCH_SAMPLES
  ) throw new Error("Hokusai live sample batch is empty or over budget.");
  if (
    previousBatchTimeMilliseconds !== null
    && (
      !Number.isFinite(previousBatchTimeMilliseconds)
      || previousBatchTimeMilliseconds < 0
    )
  ) throw new Error("Hokusai live sample clock is invalid.");
  const packed = new Float32Array(samples.length * STUDIO_HOKUSAI_LIVE_SAMPLE_STRIDE);
  let previousTime = previousBatchTimeMilliseconds
    ?? -STUDIO_HOKUSAI_LIVE_MIN_SAMPLE_INTERVAL_MS;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    const minimumTime = previousTime + STUDIO_HOKUSAI_LIVE_MIN_SAMPLE_INTERVAL_MS;
    const time = Math.max(
      0,
      minimumTime,
      sample.timeMilliseconds ?? minimumTime,
    );
    const values = [
      sample.x,
      sample.y,
      sample.pressure ?? 0.5,
      sample.tiltX ?? 0,
      sample.tiltY ?? 0,
      time,
    ];
    if (!values.every(Number.isFinite)) throw new Error("Hokusai live sample is not finite.");
    const offset = index * STUDIO_HOKUSAI_LIVE_SAMPLE_STRIDE;
    packed[offset] = sample.x;
    packed[offset + 1] = sample.y;
    packed[offset + 2] = Math.min(1, Math.max(0, sample.pressure ?? 0.5));
    packed[offset + 3] = Math.min(1, Math.max(-1, (sample.tiltX ?? 0) / 90));
    packed[offset + 4] = Math.min(1, Math.max(-1, (sample.tiltY ?? 0) / 90));
    packed[offset + 5] = time;
    previousTime = time;
  }
  return Object.freeze({
    buffer: packed.buffer,
    lastTimeMilliseconds: previousTime,
  });
}

export function studioHokusaiLiveInboundTransfers(
  message: StudioHokusaiLiveWorkerInboundMessage,
): readonly Transferable[] {
  return message.type === "studio-hokusai-live/append" ? [message.samples] : [];
}

export function studioHokusaiLiveOutboundTransfers(
  message: StudioHokusaiLiveWorkerOutboundMessage,
): readonly Transferable[] {
  if (message.type === "studio-hokusai-live/frame") return [message.pixels];
  if (message.type === "studio-hokusai-live/complete") {
    return [message.pixels, message.pngBytes];
  }
  return [];
}

export function isStudioHokusaiLiveSha256(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && HASH_PATTERN.test(value);
}
