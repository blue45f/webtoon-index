import {
  STUDIO_HOKUSAI_NATURAL_MEDIA_CONTRACT_VERSION,
  STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS,
  STUDIO_HOKUSAI_NATURAL_MEDIA_PRESETS,
  STUDIO_HOKUSAI_RUNTIME_VERSION,
  studioHokusaiMaterialProfileIsCompatible,
  type StudioHokusaiNaturalMediaRenderPlan,
} from "./studio-hokusai-natural-media-contract";

export const STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION = 3 as const;
export const STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION =
  "0.3.0-packed-dirty-frame-adapter.3-profile-routing" as const;

export interface StudioHokusaiWorkerRenderMessage {
  readonly type: "studio-hokusai/render";
  readonly version: typeof STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly engineEpoch: number;
  readonly plan: StudioHokusaiNaturalMediaRenderPlan;
}

export interface StudioHokusaiWorkerReadyMessage {
  readonly type: "studio-hokusai/ready";
  readonly version: typeof STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION;
  readonly runtime: Readonly<{
    readonly engine: "reearth-hokusai";
    readonly version: typeof STUDIO_HOKUSAI_RUNTIME_VERSION;
    readonly adapterVersion: typeof STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION;
    readonly wasm: true;
    readonly dedicatedWorker: true;
    readonly transparentRgba: true;
    readonly dirtyTiles: true;
    readonly packedDirtyFrame: true;
    readonly mainThreadFallback: false;
  }>;
}

export interface StudioHokusaiWorkerReceipt {
  readonly kind: "studio-hokusai/receipt";
  readonly version: typeof STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly engineEpoch: number;
  readonly sourceElementId: string;
  readonly presetId: StudioHokusaiNaturalMediaRenderPlan["presetId"];
  readonly materialProfileId: StudioHokusaiNaturalMediaRenderPlan["materialProfileId"];
  readonly seed: number;
  readonly rasterWidth: number;
  readonly rasterHeight: number;
  readonly outputRasterWidth: number;
  readonly outputRasterHeight: number;
  readonly dirtyBounds: readonly [number, number, number, number];
  readonly pixelLayout: "packed-dirty-rgba8";
  readonly inputHash: `sha256:${string}`;
  readonly pixelHash: `sha256:${string}`;
  readonly pngHash: `sha256:${string}`;
  readonly adapterVersion: typeof STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION;
  readonly execution: "dedicated-worker-wasm-packed-dirty-frame";
  readonly complete: true;
}

export interface StudioHokusaiWorkerResultMessage {
  readonly type: "studio-hokusai/result";
  readonly version: typeof STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly engineEpoch: number;
  readonly pngBytes: ArrayBuffer;
  readonly receipt: StudioHokusaiWorkerReceipt;
}

export interface StudioHokusaiWorkerFailureMessage {
  readonly type: "studio-hokusai/failure";
  readonly version: typeof STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION;
  readonly requestId: number | null;
  readonly reason:
    | "invalid-message"
    | "runtime-unavailable"
    | "budget-exceeded"
    | "render-failed"
    | "blank-output"
    | "png-failed";
  readonly detail: string;
}

export type StudioHokusaiWorkerOutboundMessage =
  | StudioHokusaiWorkerReadyMessage
  | StudioHokusaiWorkerResultMessage
  | StudioHokusaiWorkerFailureMessage;

const PRESET_IDS = new Set<string>(
  STUDIO_HOKUSAI_NATURAL_MEDIA_PRESETS.map(({ id }) => id),
);
const COLOR_PATTERN = /^#[0-9a-f]{6}$/u;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeInteger(value: unknown, minimum = 1): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.every((key) => typeof key === "string")
    && keys.length === expected.length
    && expected.every((key) => Object.hasOwn(value, key));
}

function snapshotPlan(
  candidate: unknown,
): StudioHokusaiNaturalMediaRenderPlan | null {
  if (
    !isPlainRecord(candidate)
    || !exactKeys(candidate, [
      "kind",
      "version",
      "engine",
      "source",
      "presetId",
      "materialProfileId",
      "color",
      "opacity",
      "seed",
      "logicalBounds",
      "raster",
      "samples",
    ])
    || candidate.kind !== "studio-hokusai-natural-media/render-plan"
    || candidate.version !== STUDIO_HOKUSAI_NATURAL_MEDIA_CONTRACT_VERSION
    || !PRESET_IDS.has(String(candidate.presetId))
    || !studioHokusaiMaterialProfileIsCompatible(
      candidate.presetId as StudioHokusaiNaturalMediaRenderPlan["presetId"],
      candidate.materialProfileId,
    )
    || typeof candidate.color !== "string"
    || !COLOR_PATTERN.test(candidate.color)
    || !finite(candidate.opacity)
    || candidate.opacity <= 0
    || candidate.opacity > 1
    || !safeInteger(candidate.seed, 0)
    || candidate.seed > 0xffff_ffff
    || !isPlainRecord(candidate.engine)
    || !exactKeys(candidate.engine, [
      "id",
      "version",
      "brushFormat",
      "alpha",
      "execution",
    ])
    || candidate.engine.id !== "reearth-hokusai"
    || candidate.engine.version !== STUDIO_HOKUSAI_RUNTIME_VERSION
    || candidate.engine.brushFormat !== "libmypaint-myb-v3"
    || candidate.engine.alpha !== "transparent-straight-rgba8"
    || candidate.engine.execution !== "dedicated-worker-wasm"
    || !isPlainRecord(candidate.source)
    || !exactKeys(candidate.source, [
      "elementId",
      "brushId",
      "sourcePointCount",
      "revision",
    ])
    || typeof candidate.source.elementId !== "string"
    || candidate.source.elementId.length === 0
    || typeof candidate.source.brushId !== "string"
    || candidate.source.brushId.length === 0
    || !safeInteger(candidate.source.sourcePointCount)
    || typeof candidate.source.revision !== "string"
    || !/^hokusai-source-v1:[a-f0-9]{16}$/u.test(
      candidate.source.revision,
    )
    || !isPlainRecord(candidate.logicalBounds)
    || !exactKeys(candidate.logicalBounds, ["x", "y", "width", "height"])
    || !finite(candidate.logicalBounds.x)
    || !finite(candidate.logicalBounds.y)
    || !safeInteger(candidate.logicalBounds.width)
    || !safeInteger(candidate.logicalBounds.height)
    || !isPlainRecord(candidate.raster)
    || !exactKeys(candidate.raster, [
      "width",
      "height",
      "scale",
      "radiusPixels",
    ])
    || !safeInteger(candidate.raster.width)
    || !safeInteger(candidate.raster.height)
    || candidate.raster.width > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxDimension
    || candidate.raster.height > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxDimension
    || candidate.raster.width * candidate.raster.height
      > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxPixels
    || !finite(candidate.raster.scale)
    || candidate.raster.scale <= 0
    || candidate.raster.scale > 1
    || !finite(candidate.raster.radiusPixels)
    || candidate.raster.radiusPixels <= 0
    || !Array.isArray(candidate.samples)
    || candidate.samples.length < 2
    || candidate.samples.length
      > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxSamples
    || candidate.samples.length !== candidate.source.sourcePointCount
  ) {
    return null;
  }

  const samples = [];
  let previousTime = -1;
  for (const raw of candidate.samples) {
    if (
      !isPlainRecord(raw)
      || !exactKeys(raw, [
        "x",
        "y",
        "pressure",
        "tiltX",
        "tiltY",
        "timeMilliseconds",
      ])
      || !finite(raw.x)
      || !finite(raw.y)
      || !finite(raw.pressure)
      || raw.pressure < 0
      || raw.pressure > 1
      || !finite(raw.tiltX)
      || raw.tiltX < -1
      || raw.tiltX > 1
      || !finite(raw.tiltY)
      || raw.tiltY < -1
      || raw.tiltY > 1
      || !finite(raw.timeMilliseconds)
      || raw.timeMilliseconds < 0
      || raw.timeMilliseconds < previousTime
    ) {
      return null;
    }
    previousTime = raw.timeMilliseconds;
    samples.push(Object.freeze({
      x: raw.x,
      y: raw.y,
      pressure: raw.pressure,
      tiltX: raw.tiltX,
      tiltY: raw.tiltY,
      timeMilliseconds: raw.timeMilliseconds,
    }));
  }

  return Object.freeze({
    kind: candidate.kind,
    version: candidate.version,
    engine: Object.freeze({
      id: candidate.engine.id,
      version: candidate.engine.version,
      brushFormat: candidate.engine.brushFormat,
      alpha: candidate.engine.alpha,
      execution: candidate.engine.execution,
    }),
    source: Object.freeze({
      elementId: candidate.source.elementId,
      brushId: candidate.source.brushId,
      sourcePointCount: candidate.source.sourcePointCount,
      revision:
        candidate.source.revision as `hokusai-source-v1:${string}`,
    }),
    presetId:
      candidate.presetId as StudioHokusaiNaturalMediaRenderPlan["presetId"],
    materialProfileId: candidate.materialProfileId,
    color: candidate.color as `#${string}`,
    opacity: candidate.opacity,
    seed: candidate.seed,
    logicalBounds: Object.freeze({
      x: candidate.logicalBounds.x,
      y: candidate.logicalBounds.y,
      width: candidate.logicalBounds.width,
      height: candidate.logicalBounds.height,
    }),
    raster: Object.freeze({
      width: candidate.raster.width,
      height: candidate.raster.height,
      scale: candidate.raster.scale,
      radiusPixels: candidate.raster.radiusPixels,
    }),
    samples: Object.freeze(samples),
  });
}

export function snapshotStudioHokusaiWorkerRenderMessage(
  candidate: unknown,
): StudioHokusaiWorkerRenderMessage | null {
  if (
    !isPlainRecord(candidate)
    || !exactKeys(candidate, [
      "type",
      "version",
      "requestId",
      "engineEpoch",
      "plan",
    ])
    || candidate.type !== "studio-hokusai/render"
    || candidate.version !== STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION
    || !safeInteger(candidate.requestId)
    || !safeInteger(candidate.engineEpoch)
  ) {
    return null;
  }
  const plan = snapshotPlan(candidate.plan);
  if (!plan) return null;
  return Object.freeze({
    type: candidate.type,
    version: candidate.version,
    requestId: candidate.requestId,
    engineEpoch: candidate.engineEpoch,
    plan,
  });
}

export interface StudioHokusaiWorkerResultExpectation {
  readonly requestId: number;
  readonly engineEpoch: number;
  readonly sourceElementId: string;
  readonly presetId: StudioHokusaiNaturalMediaRenderPlan["presetId"];
  readonly materialProfileId: StudioHokusaiNaturalMediaRenderPlan["materialProfileId"];
  readonly seed: number;
  readonly rasterWidth: number;
  readonly rasterHeight: number;
}

function sha256Digest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function arrayBufferBytes(value: unknown): Uint8Array | null {
  if (
    typeof value !== "object"
    || value === null
    || Object.prototype.toString.call(value) !== "[object ArrayBuffer]"
  ) return null;
  try {
    return new Uint8Array(value as ArrayBuffer);
  } catch {
    return null;
  }
}

function pngDimensions(
  bytes: Uint8Array,
): readonly [width: number, height: number] | null {
  if (
    bytes.byteLength < 33
    || bytes[0] !== 0x89
    || bytes[1] !== 0x50
    || bytes[2] !== 0x4e
    || bytes[3] !== 0x47
    || bytes[4] !== 0x0d
    || bytes[5] !== 0x0a
    || bytes[6] !== 0x1a
    || bytes[7] !== 0x0a
    || bytes[8] !== 0
    || bytes[9] !== 0
    || bytes[10] !== 0
    || bytes[11] !== 13
    || bytes[12] !== 0x49
    || bytes[13] !== 0x48
    || bytes[14] !== 0x44
    || bytes[15] !== 0x52
  ) return null;
  const width = (
    ((bytes[16] ?? 0) << 24)
    | ((bytes[17] ?? 0) << 16)
    | ((bytes[18] ?? 0) << 8)
    | (bytes[19] ?? 0)
  ) >>> 0;
  const height = (
    ((bytes[20] ?? 0) << 24)
    | ((bytes[21] ?? 0) << 16)
    | ((bytes[22] ?? 0) << 8)
    | (bytes[23] ?? 0)
  ) >>> 0;
  return width > 0 && height > 0 ? [width, height] : null;
}

export function snapshotStudioHokusaiWorkerResultMessage(
  candidate: unknown,
  expected: StudioHokusaiWorkerResultExpectation,
): StudioHokusaiWorkerResultMessage | null {
  if (
    !isPlainRecord(candidate)
    || !exactKeys(candidate, [
      "type",
      "version",
      "requestId",
      "engineEpoch",
      "pngBytes",
      "receipt",
    ])
    || candidate.type !== "studio-hokusai/result"
    || candidate.version !== STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION
    || candidate.requestId !== expected.requestId
    || candidate.engineEpoch !== expected.engineEpoch
    || !isPlainRecord(candidate.receipt)
  ) return null;

  const png = arrayBufferBytes(candidate.pngBytes);
  const receipt = candidate.receipt;
  if (
    !png
    || png.byteLength <= 0
    || png.byteLength > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxPngBytes
    || !exactKeys(receipt, [
      "kind",
      "version",
      "requestId",
      "engineEpoch",
      "sourceElementId",
      "presetId",
      "materialProfileId",
      "seed",
      "rasterWidth",
      "rasterHeight",
      "outputRasterWidth",
      "outputRasterHeight",
      "dirtyBounds",
      "pixelLayout",
      "inputHash",
      "pixelHash",
      "pngHash",
      "adapterVersion",
      "execution",
      "complete",
    ])
    || receipt.kind !== "studio-hokusai/receipt"
    || receipt.version !== STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION
    || receipt.requestId !== expected.requestId
    || receipt.engineEpoch !== expected.engineEpoch
    || receipt.sourceElementId !== expected.sourceElementId
    || receipt.presetId !== expected.presetId
    || receipt.materialProfileId !== expected.materialProfileId
    || receipt.seed !== expected.seed
    || receipt.rasterWidth !== expected.rasterWidth
    || receipt.rasterHeight !== expected.rasterHeight
    || !safeInteger(receipt.outputRasterWidth)
    || !safeInteger(receipt.outputRasterHeight)
    || !Array.isArray(receipt.dirtyBounds)
    || receipt.dirtyBounds.length !== 4
    || !receipt.dirtyBounds.every((value) => safeInteger(value, 0))
    || receipt.pixelLayout !== "packed-dirty-rgba8"
    || !sha256Digest(receipt.inputHash)
    || !sha256Digest(receipt.pixelHash)
    || !sha256Digest(receipt.pngHash)
    || receipt.adapterVersion !== STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION
    || receipt.execution !== "dedicated-worker-wasm-packed-dirty-frame"
    || receipt.complete !== true
  ) return null;

  const [x, y, width, height] = receipt.dirtyBounds;
  if (
    x === undefined
    || y === undefined
    || width === undefined
    || height === undefined
    || width <= 0
    || height <= 0
    || x + width > expected.rasterWidth
    || y + height > expected.rasterHeight
    || receipt.outputRasterWidth !== width
    || receipt.outputRasterHeight !== height
  ) return null;
  const encodedDimensions = pngDimensions(png);
  if (
    !encodedDimensions
    || encodedDimensions[0] !== width
    || encodedDimensions[1] !== height
  ) return null;
  return candidate as unknown as StudioHokusaiWorkerResultMessage;
}

export function studioHokusaiWorkerResultTransfers(
  result: StudioHokusaiWorkerResultMessage,
): readonly Transferable[] {
  return [result.pngBytes];
}
