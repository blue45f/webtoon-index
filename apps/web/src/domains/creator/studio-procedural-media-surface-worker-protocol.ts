import { sha256HexPortable } from "./studio-sha256";

import type {
  StudioProceduralMediaSurfaceErrorCode,
  StudioProceduralMediaSurfaceRecipe,
  StudioProceduralMediaSurfaceRenderReceipt,
  StudioProceduralMediaSurfaceRenderRequest,
} from "./studio-procedural-media-surface-provider";

export const STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION =
  1 as const;
export const STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_VECTOR_COUNT = 8 as const;

const MEBIBYTE = 1_048_576;
const WORKER_PIPELINE_RESIDENT_FLOATS_PER_PIXEL = 12;
const COOPERATIVE_RESULT_FLOAT_CHUNK = 16_384;

export const STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS = Object.freeze({
  maximumInputBytes: 1 * MEBIBYTE,
  maximumOutputBytes: 512 * MEBIBYTE,
  maximumResidentBytes: 768 * MEBIBYTE,
  maximumWorkUnits: 2_147_483_648,
  maximumOutputPixels: 67_108_864,
  maximumWidth: 16_384,
  maximumHeight: 16_384,
  maximumHalo: 1_024,
  maximumFailureDetailCodeUnits: 512,
} as const);

interface StudioProceduralMediaSurfaceWorkerWireFlow {
  readonly gradientStep: number;
  readonly downhillWeight: number;
  readonly tangentWeight: number;
}

export interface StudioProceduralMediaSurfaceWorkerWireRecipe
  extends Omit<
    StudioProceduralMediaSurfaceRecipe,
    "offset" | "seamlessPeriod" | "flow"
  > {
  /**
   * offset x/y, period x/y, gravity x/y, wind x/y. Null period uses zeroes
   * with seamlessPeriodEnabled=false. Float64 preserves recipe fingerprints.
   */
  readonly vectors: Float64Array;
  readonly seamlessPeriodEnabled: boolean;
  readonly flow: StudioProceduralMediaSurfaceWorkerWireFlow;
}

export interface StudioProceduralMediaSurfaceWorkerWireRequest {
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly recipe: StudioProceduralMediaSurfaceWorkerWireRecipe;
  readonly region: StudioProceduralMediaSurfaceRenderRequest["region"];
}

export type StudioProceduralMediaSurfaceWorkerFailureReason =
  | "aborted"
  | "backpressure"
  | "disposed"
  | "execution-failed"
  | "invalid-message"
  | "invalid-result"
  | "operation-timeout"
  | "protocol-error"
  | "startup-timeout"
  | "worker-unavailable";

export interface StudioProceduralMediaSurfaceWorkerOnlyReceipt {
  readonly kind: "studio-procedural-media-surface-worker-only-receipt";
  readonly execution: "dedicated-worker";
  readonly mainThreadComputationFallback: false;
  readonly workerTerminated: boolean;
  readonly complete: false;
  readonly reason: StudioProceduralMediaSurfaceWorkerFailureReason;
}

export interface StudioProceduralMediaSurfaceWorkerFailure {
  readonly status: "worker-failed";
  readonly reason: StudioProceduralMediaSurfaceWorkerFailureReason;
  readonly detail: string;
  readonly fallback: StudioProceduralMediaSurfaceWorkerOnlyReceipt;
}

export interface StudioProceduralMediaSurfaceWorkerRejection {
  readonly status: "rejected";
  readonly reason: StudioProceduralMediaSurfaceErrorCode;
}

export interface StudioProceduralMediaSurfaceWorkerCompleted {
  readonly status: "completed";
  readonly receipt: StudioProceduralMediaSurfaceRenderReceipt;
}

export type StudioProceduralMediaSurfaceWorkerResult =
  | StudioProceduralMediaSurfaceWorkerCompleted
  | StudioProceduralMediaSurfaceWorkerRejection
  | StudioProceduralMediaSurfaceWorkerFailure;

export interface StudioProceduralMediaSurfaceWorkerExecuteMessage {
  readonly type: "studio-procedural-media-surface/execute";
  readonly version:
    typeof STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly request: StudioProceduralMediaSurfaceWorkerWireRequest;
}

export interface StudioProceduralMediaSurfaceWorkerCancelMessage {
  readonly type: "studio-procedural-media-surface/cancel";
  readonly version:
    typeof STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
}

export interface StudioProceduralMediaSurfaceWorkerReleaseMessage {
  readonly type: "studio-procedural-media-surface/release";
  readonly version:
    typeof STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly engineEpoch: number;
}

export interface StudioProceduralMediaSurfaceWorkerAdvanceEpochMessage {
  readonly type: "studio-procedural-media-surface/advance-epoch";
  readonly version:
    typeof STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly engineEpoch: number;
}

export type StudioProceduralMediaSurfaceWorkerInboundMessage =
  | StudioProceduralMediaSurfaceWorkerExecuteMessage
  | StudioProceduralMediaSurfaceWorkerCancelMessage
  | StudioProceduralMediaSurfaceWorkerReleaseMessage
  | StudioProceduralMediaSurfaceWorkerAdvanceEpochMessage;

export interface StudioProceduralMediaSurfaceWorkerReadyMessage {
  readonly type: "studio-procedural-media-surface/ready";
  readonly version:
    typeof STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION;
  readonly engineEpoch: number;
}

export interface StudioProceduralMediaSurfaceWorkerResultMessage {
  readonly type: "studio-procedural-media-surface/result";
  readonly version:
    typeof STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly result: StudioProceduralMediaSurfaceWorkerResult;
  readonly verification:
    StudioProceduralMediaSurfaceWorkerVerifiedAttestation | null;
}

export interface StudioProceduralMediaSurfaceWorkerVerifiedAttestation {
  readonly kind:
    "studio-procedural-media-surface-worker-verified-attestation";
  readonly version:
    typeof STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION;
  readonly verification: "host-recomputed-sha256";
  readonly requestId: number;
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly recipeFingerprint: `sha256:${string}`;
  readonly periodicMode: "aperiodic" | "integer-fourier-torus";
  readonly coreOrigin: readonly [x: number, y: number];
  readonly coreSize: readonly [width: number, height: number];
  readonly outputOrigin: readonly [x: number, y: number];
  readonly outputSize: readonly [width: number, height: number];
  readonly halo: number;
  readonly workUnits: number;
  readonly residentBytes: number;
  readonly artifactHash: `sha256:${string}`;
  readonly receiptHash: `sha256:${string}`;
  readonly bindingHash: `sha256:${string}`;
  readonly complete: true;
}

export interface StudioProceduralMediaSurfaceWorkerControlReceipt {
  readonly kind: "studio-procedural-media-surface-worker-control-receipt";
  readonly control: "release" | "advance-epoch";
  readonly requestId: number;
  readonly engineEpoch: number;
  readonly released: boolean;
  readonly execution: "dedicated-worker";
  readonly mainThreadComputationFallback: false;
  readonly workerTerminated: boolean;
  readonly complete: true;
}

export interface StudioProceduralMediaSurfaceWorkerControlResultMessage {
  readonly type: "studio-procedural-media-surface/control-result";
  readonly version:
    typeof STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION;
  readonly receipt: StudioProceduralMediaSurfaceWorkerControlReceipt;
}

export type StudioProceduralMediaSurfaceWorkerOutboundMessage =
  | StudioProceduralMediaSurfaceWorkerReadyMessage
  | StudioProceduralMediaSurfaceWorkerResultMessage
  | StudioProceduralMediaSurfaceWorkerControlResultMessage;

export type StudioProceduralMediaSurfaceWorkerRequestSnapshot =
  | Readonly<{
      ok: true;
      request: StudioProceduralMediaSurfaceWorkerWireRequest;
      inputBytes: number;
      outputBytes: number;
      residentBytes: number;
      workUnits: number;
      outputPixels: number;
    }>
  | Readonly<{
      ok: false;
      reason: "invalid-request" | "budget-exceeded";
    }>;

const RECIPE_KEYS = Object.freeze([
  "kind",
  "version",
  "seed",
  "worldScale",
  "rotationRadians",
  "offset",
  "contrast",
  "seamlessPeriod",
  "relief",
  "fibers",
  "weave",
  "pores",
  "speckles",
  "channels",
  "flow",
  "fingerprint",
]);
const WIRE_RECIPE_KEYS = Object.freeze([
  "kind",
  "version",
  "seed",
  "worldScale",
  "rotationRadians",
  "contrast",
  "relief",
  "fibers",
  "weave",
  "pores",
  "speckles",
  "channels",
  "fingerprint",
  "vectors",
  "seamlessPeriodEnabled",
  "flow",
]);
const REGION_KEYS = Object.freeze([
  "originX",
  "originY",
  "width",
  "height",
  "halo",
]);
const ARTIFACT_KEYS = Object.freeze([
  "kind",
  "version",
  "width",
  "height",
  "originX",
  "originY",
  "heightField",
  "absorbency",
  "grain",
  "flow",
  "receipt",
]);
const SURFACE_RECEIPT_KEYS = Object.freeze([
  "kind",
  "version",
  "providerRevision",
  "backend",
  "samplingConvention",
  "tileContract",
  "periodicMode",
  "flowModel",
  "gradientModel",
  "recipeFingerprint",
  "origin",
  "coreOrigin",
  "coreSize",
  "outputSize",
  "halo",
  "outputPixels",
  "workUnits",
  "residentBytes",
  "heightHash",
  "absorbencyHash",
  "grainHash",
  "flowHash",
  "artifactHash",
  "complete",
]);
const RENDER_RECEIPT_KEYS = Object.freeze([
  "kind",
  "requestSequence",
  "engineEpoch",
  "artifact",
  "receiptHash",
  "complete",
]);
const VERIFIED_ATTESTATION_KEYS = Object.freeze([
  "kind",
  "version",
  "verification",
  "requestId",
  "requestSequence",
  "engineEpoch",
  "recipeFingerprint",
  "periodicMode",
  "coreOrigin",
  "coreSize",
  "outputOrigin",
  "outputSize",
  "halo",
  "workUnits",
  "residentBytes",
  "artifactHash",
  "receiptHash",
  "bindingHash",
  "complete",
]);

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (!plainRecord(value)) return false;
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => allowed.has(key));
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function range(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return finite(value) && value >= minimum && value <= maximum;
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= minimum
    && (value as number) <= maximum;
}

function vector2(
  value: unknown,
  minimum: number,
  maximum: number,
): value is readonly [number, number] {
  return Array.isArray(value)
    && value.length === 2
    && value.every((component) => range(component, minimum, maximum));
}

function contentHash(value: unknown): value is `sha256:${string}` {
  return typeof value === "string"
    && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function finiteFloat32(value: unknown): value is Float32Array {
  return value instanceof Float32Array
    && value.buffer instanceof ArrayBuffer;
}

function finiteFloat64(value: unknown): value is Float64Array {
  return value instanceof Float64Array
    && value.buffer instanceof ArrayBuffer
    && value.every(Number.isFinite);
}

function validateRelief(value: unknown): boolean {
  return exactKeys(
    value,
    ["frequency", "octaves", "lacunarity", "gain", "amplitude"],
  )
    && range(value.frequency, 0.000_001, 1_024)
    && integer(value.octaves, 1, 12)
    && range(value.lacunarity, 1, 4)
    && range(value.gain, 0, 1)
    && range(value.amplitude, 0, 8);
}

function validateRecipeScalars(value: Record<string, unknown>): boolean {
  return value.kind === "studio-procedural-media-surface-recipe"
    && value.version === 1
    && integer(value.seed, 0, 0xffff_ffff)
    && range(value.worldScale, 0.03125, 1_000_000)
    && range(value.rotationRadians, -Math.PI * 2, Math.PI * 2)
    && range(value.contrast, 0.03125, 16)
    && validateRelief(value.relief)
    && exactKeys(
      value.fibers,
      ["frequency", "amplitude", "directionRadians", "irregularity"],
    )
    && range(value.fibers.frequency, 0.000_001, 4_096)
    && range(value.fibers.amplitude, 0, 8)
    && range(value.fibers.directionRadians, -Math.PI * 2, Math.PI * 2)
    && range(value.fibers.irregularity, 0, 4)
    && exactKeys(
      value.weave,
      ["warpFrequency", "weftFrequency", "amplitude", "balance"],
    )
    && range(value.weave.warpFrequency, 0.000_001, 4_096)
    && range(value.weave.weftFrequency, 0.000_001, 4_096)
    && range(value.weave.amplitude, 0, 8)
    && range(value.weave.balance, 0, 1)
    && exactKeys(value.pores, ["frequency", "density", "amplitude"])
    && range(value.pores.frequency, 0.000_001, 4_096)
    && range(value.pores.density, 0, 1)
    && range(value.pores.amplitude, 0, 8)
    && exactKeys(value.speckles, ["frequency", "density", "amplitude"])
    && range(value.speckles.frequency, 0.000_001, 8_192)
    && range(value.speckles.density, 0, 1)
    && range(value.speckles.amplitude, 0, 8)
    && exactKeys(
      value.channels,
      [
        "absorbencyBase",
        "reliefToAbsorbency",
        "poreToAbsorbency",
        "speckleToAbsorbency",
        "grainBase",
        "reliefToGrain",
        "fiberToGrain",
        "weaveToGrain",
        "speckleToGrain",
      ],
    )
    && range(value.channels.absorbencyBase, 0, 1)
    && range(value.channels.reliefToAbsorbency, -8, 8)
    && range(value.channels.poreToAbsorbency, -8, 8)
    && range(value.channels.speckleToAbsorbency, -8, 8)
    && range(value.channels.grainBase, 0, 1)
    && range(value.channels.reliefToGrain, -8, 8)
    && range(value.channels.fiberToGrain, -8, 8)
    && range(value.channels.weaveToGrain, -8, 8)
    && range(value.channels.speckleToGrain, -8, 8)
    && contentHash(value.fingerprint);
}

function snapshotWireRecipe(
  value: unknown,
): StudioProceduralMediaSurfaceWorkerWireRecipe | null {
  if (
    !exactKeys(value, WIRE_RECIPE_KEYS)
    || !validateRecipeScalars(value)
    || !finiteFloat64(value.vectors)
    || value.vectors.length
      !== STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_VECTOR_COUNT
    || typeof value.seamlessPeriodEnabled !== "boolean"
    || !exactKeys(
      value.flow,
      ["gradientStep", "downhillWeight", "tangentWeight"],
    )
    || !range(value.flow.gradientStep, 0.03125, 1_024)
    || !range(value.flow.downhillWeight, 0, 8)
    || !range(value.flow.tangentWeight, -8, 8)
  ) return null;
  const vectors = new Float64Array(value.vectors);
  if (
    !range(vectors[0], -1_000_000_000, 1_000_000_000)
    || !range(vectors[1], -1_000_000_000, 1_000_000_000)
    || (
      value.seamlessPeriodEnabled
      && (
        !range(vectors[2], 1, 100_000_000)
        || !range(vectors[3], 1, 100_000_000)
      )
    )
    || !range(vectors[4], -8, 8)
    || !range(vectors[5], -8, 8)
    || !range(vectors[6], -8, 8)
    || !range(vectors[7], -8, 8)
  ) return null;
  const recipe =
    value as unknown as StudioProceduralMediaSurfaceWorkerWireRecipe;
  return Object.freeze({
    kind: "studio-procedural-media-surface-recipe",
    version: 1,
    seed: value.seed,
    worldScale: value.worldScale,
    rotationRadians: value.rotationRadians,
    contrast: value.contrast,
    relief: Object.freeze({ ...recipe.relief }),
    fibers: Object.freeze({ ...recipe.fibers }),
    weave: Object.freeze({ ...recipe.weave }),
    pores: Object.freeze({ ...recipe.pores }),
    speckles: Object.freeze({ ...recipe.speckles }),
    channels: Object.freeze({ ...recipe.channels }),
    fingerprint: value.fingerprint,
    vectors,
    seamlessPeriodEnabled: value.seamlessPeriodEnabled,
    flow: Object.freeze({
      gradientStep: value.flow.gradientStep,
      downhillWeight: value.flow.downhillWeight,
      tangentWeight: value.flow.tangentWeight,
    }),
  }) as StudioProceduralMediaSurfaceWorkerWireRecipe;
}

function snapshotRecipe(
  value: unknown,
): StudioProceduralMediaSurfaceWorkerWireRecipe | null {
  if (
    !exactKeys(value, RECIPE_KEYS)
    || !validateRecipeScalars(value)
    || !vector2(value.offset, -1_000_000_000, 1_000_000_000)
    || (
      value.seamlessPeriod !== null
      && !vector2(value.seamlessPeriod, 1, 100_000_000)
    )
    || !exactKeys(
      value.flow,
      [
        "gradientStep",
        "downhillWeight",
        "tangentWeight",
        "gravity",
        "wind",
      ],
    )
    || !range(value.flow.gradientStep, 0.03125, 1_024)
    || !range(value.flow.downhillWeight, 0, 8)
    || !range(value.flow.tangentWeight, -8, 8)
    || !vector2(value.flow.gravity, -8, 8)
    || !vector2(value.flow.wind, -8, 8)
  ) return null;
  const period = value.seamlessPeriod ?? [0, 0];
  const vectors = new Float64Array([
    value.offset[0],
    value.offset[1],
    period[0],
    period[1],
    value.flow.gravity[0],
    value.flow.gravity[1],
    value.flow.wind[0],
    value.flow.wind[1],
  ]);
  return snapshotWireRecipe({
    kind: value.kind,
    version: value.version,
    seed: value.seed,
    worldScale: value.worldScale,
    rotationRadians: value.rotationRadians,
    contrast: value.contrast,
    relief: value.relief,
    fibers: value.fibers,
    weave: value.weave,
    pores: value.pores,
    speckles: value.speckles,
    channels: value.channels,
    fingerprint: value.fingerprint,
    vectors,
    seamlessPeriodEnabled: value.seamlessPeriod !== null,
    flow: {
      gradientStep: value.flow.gradientStep,
      downhillWeight: value.flow.downhillWeight,
      tangentWeight: value.flow.tangentWeight,
    },
  });
}

function snapshotRegion(
  value: unknown,
): StudioProceduralMediaSurfaceRenderRequest["region"] | null {
  if (
    !exactKeys(value, REGION_KEYS)
    || !integer(value.originX, -1_000_000_000, 1_000_000_000)
    || !integer(value.originY, -1_000_000_000, 1_000_000_000)
    || !integer(
      value.width,
      1,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS.maximumWidth,
    )
    || !integer(
      value.height,
      1,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS.maximumHeight,
    )
    || !integer(
      value.halo,
      0,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS.maximumHalo,
    )
  ) return null;
  return Object.freeze({
    originX: value.originX,
    originY: value.originY,
    width: value.width,
    height: value.height,
    halo: value.halo,
  });
}

function finishSnapshot(
  request: StudioProceduralMediaSurfaceWorkerWireRequest,
): StudioProceduralMediaSurfaceWorkerRequestSnapshot {
  const outputWidth = request.region.width + request.region.halo * 2;
  const outputHeight = request.region.height + request.region.halo * 2;
  const outputPixels = outputWidth * outputHeight;
  const workUnits =
    outputPixels * (request.recipe.relief.octaves * 8 + 84) * 5;
  const outputBytes =
    outputPixels * 5 * Float32Array.BYTES_PER_ELEMENT;
  // Provider output (five floats), defensive result snapshot (five floats),
  // and the largest cooperative hash buffer (two floats).
  const residentBytes =
    outputPixels
    * WORKER_PIPELINE_RESIDENT_FLOATS_PER_PIXEL
    * Float32Array.BYTES_PER_ELEMENT;
  const inputBytes = request.recipe.vectors.byteLength;
  if (
    !Number.isSafeInteger(outputPixels)
    || !Number.isSafeInteger(workUnits)
    || inputBytes
      > STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS.maximumInputBytes
    || outputPixels
      > STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS.maximumOutputPixels
    || outputBytes
      > STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS.maximumOutputBytes
    || residentBytes
      > STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS.maximumResidentBytes
    || workUnits
      > STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS.maximumWorkUnits
  ) return Object.freeze({ ok: false, reason: "budget-exceeded" });
  return Object.freeze({
    ok: true,
    request: Object.freeze(request),
    inputBytes,
    outputBytes,
    residentBytes,
    workUnits,
    outputPixels,
  });
}

export function snapshotStudioProceduralMediaSurfaceWorkerRequest(
  value: unknown,
): StudioProceduralMediaSurfaceWorkerRequestSnapshot {
  if (
    !exactKeys(
      value,
      ["requestSequence", "engineEpoch", "recipe", "region"],
    )
    || !integer(value.requestSequence, 1, Number.MAX_SAFE_INTEGER)
    || !integer(value.engineEpoch, 1, Number.MAX_SAFE_INTEGER)
  ) return Object.freeze({ ok: false, reason: "invalid-request" });
  const recipe = snapshotRecipe(value.recipe);
  const region = snapshotRegion(value.region);
  if (!recipe || !region) {
    return Object.freeze({ ok: false, reason: "invalid-request" });
  }
  return finishSnapshot({
    requestSequence: value.requestSequence,
    engineEpoch: value.engineEpoch,
    recipe,
    region,
  });
}

function snapshotWireRequest(
  value: unknown,
): StudioProceduralMediaSurfaceWorkerRequestSnapshot {
  if (
    !exactKeys(
      value,
      ["requestSequence", "engineEpoch", "recipe", "region"],
    )
    || !integer(value.requestSequence, 1, Number.MAX_SAFE_INTEGER)
    || !integer(value.engineEpoch, 1, Number.MAX_SAFE_INTEGER)
  ) return Object.freeze({ ok: false, reason: "invalid-request" });
  const recipe = snapshotWireRecipe(value.recipe);
  const region = snapshotRegion(value.region);
  if (!recipe || !region) {
    return Object.freeze({ ok: false, reason: "invalid-request" });
  }
  return finishSnapshot({
    requestSequence: value.requestSequence,
    engineEpoch: value.engineEpoch,
    recipe,
    region,
  });
}

export function studioProceduralMediaSurfaceWireRequestToProviderRequest(
  value: StudioProceduralMediaSurfaceWorkerWireRequest,
  signal: AbortSignal,
): StudioProceduralMediaSurfaceRenderRequest {
  const vectors = value.recipe.vectors;
  const recipe: StudioProceduralMediaSurfaceRecipe = Object.freeze({
    kind: value.recipe.kind,
    version: value.recipe.version,
    seed: value.recipe.seed,
    worldScale: value.recipe.worldScale,
    rotationRadians: value.recipe.rotationRadians,
    offset: Object.freeze([
      vectors[0] ?? 0,
      vectors[1] ?? 0,
    ] as const),
    contrast: value.recipe.contrast,
    seamlessPeriod: value.recipe.seamlessPeriodEnabled
      ? Object.freeze([
        vectors[2] ?? 1,
        vectors[3] ?? 1,
      ] as const)
      : null,
    relief: value.recipe.relief,
    fibers: value.recipe.fibers,
    weave: value.recipe.weave,
    pores: value.recipe.pores,
    speckles: value.recipe.speckles,
    channels: value.recipe.channels,
    flow: Object.freeze({
      ...value.recipe.flow,
      gravity: Object.freeze([
        vectors[4] ?? 0,
        vectors[5] ?? 0,
      ] as const),
      wind: Object.freeze([
        vectors[6] ?? 0,
        vectors[7] ?? 0,
      ] as const),
    }),
    fingerprint: value.recipe.fingerprint,
  });
  return Object.freeze({
    requestSequence: value.requestSequence,
    engineEpoch: value.engineEpoch,
    recipe,
    region: value.region,
    signal,
  });
}

function workerFailureReason(
  value: unknown,
): value is StudioProceduralMediaSurfaceWorkerFailureReason {
  return (
    value === "aborted"
    || value === "backpressure"
    || value === "disposed"
    || value === "execution-failed"
    || value === "invalid-message"
    || value === "invalid-result"
    || value === "operation-timeout"
    || value === "protocol-error"
    || value === "startup-timeout"
    || value === "worker-unavailable"
  );
}

function providerReason(
  value: unknown,
): value is StudioProceduralMediaSurfaceErrorCode {
  return (
    value === "invalid-recipe"
    || value === "invalid-region"
    || value === "invalid-request"
    || value === "budget-exceeded"
    || value === "request-sequence"
    || value === "engine-epoch"
    || value === "backpressure"
    || value === "aborted"
    || value === "disposed"
  );
}

export function studioProceduralMediaSurfaceWorkerFailure(
  reason: StudioProceduralMediaSurfaceWorkerFailureReason,
  detail: string,
  workerTerminated = false,
): StudioProceduralMediaSurfaceWorkerFailure {
  return Object.freeze({
    status: "worker-failed",
    reason,
    detail: detail.slice(
      0,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS
        .maximumFailureDetailCodeUnits,
    ),
    fallback: Object.freeze({
      kind: "studio-procedural-media-surface-worker-only-receipt",
      execution: "dedicated-worker",
      mainThreadComputationFallback: false,
      workerTerminated,
      complete: false,
      reason,
    }),
  });
}

function snapshotFailure(
  value: unknown,
): StudioProceduralMediaSurfaceWorkerFailure | null {
  if (
    !exactKeys(value, ["status", "reason", "detail", "fallback"])
    || value.status !== "worker-failed"
    || !workerFailureReason(value.reason)
    || typeof value.detail !== "string"
    || value.detail.length
      > STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS
        .maximumFailureDetailCodeUnits
    || !exactKeys(
      value.fallback,
      [
        "kind",
        "execution",
        "mainThreadComputationFallback",
        "workerTerminated",
        "complete",
        "reason",
      ],
    )
    || value.fallback.kind
      !== "studio-procedural-media-surface-worker-only-receipt"
    || value.fallback.execution !== "dedicated-worker"
    || value.fallback.mainThreadComputationFallback !== false
    || typeof value.fallback.workerTerminated !== "boolean"
    || value.fallback.complete !== false
    || value.fallback.reason !== value.reason
  ) return null;
  return studioProceduralMediaSurfaceWorkerFailure(
    value.reason,
    value.detail,
    value.fallback.workerTerminated,
  );
}

function pair(value: unknown): value is readonly [number, number] {
  return Array.isArray(value)
    && value.length === 2
    && value.every(finite);
}

function snapshotRenderReceipt(
  value: unknown,
  copyChannels = true,
): StudioProceduralMediaSurfaceRenderReceipt | null {
  if (
    !exactKeys(value, RENDER_RECEIPT_KEYS)
    || value.kind !== "studio-procedural-media-surface-render-receipt"
    || !integer(value.requestSequence, 1, Number.MAX_SAFE_INTEGER)
    || !integer(value.engineEpoch, 1, Number.MAX_SAFE_INTEGER)
    || !contentHash(value.receiptHash)
    || value.complete !== true
    || !exactKeys(value.artifact, ARTIFACT_KEYS)
    || value.artifact.kind
      !== "studio-procedural-media-surface-artifact"
    || value.artifact.version !== 1
    || !integer(
      value.artifact.width,
      1,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS.maximumWidth
        + STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS.maximumHalo * 2,
    )
    || !integer(
      value.artifact.height,
      1,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS.maximumHeight
        + STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS.maximumHalo * 2,
    )
    || !integer(
      value.artifact.originX,
      -1_000_002_048,
      1_000_002_048,
    )
    || !integer(
      value.artifact.originY,
      -1_000_002_048,
      1_000_002_048,
    )
    || !finiteFloat32(value.artifact.heightField)
    || !finiteFloat32(value.artifact.absorbency)
    || !finiteFloat32(value.artifact.grain)
    || !finiteFloat32(value.artifact.flow)
    || !exactKeys(value.artifact.receipt, SURFACE_RECEIPT_KEYS)
  ) return null;
  const receipt = value.artifact.receipt;
  const pixels = value.artifact.width * value.artifact.height;
  if (
    receipt.kind !== "studio-procedural-media-surface-receipt"
    || receipt.version !== 1
    || receipt.providerRevision !== 1
    || receipt.backend !== "cpu-f32-global-coordinate-oracle"
    || receipt.samplingConvention
      !== "integer-pixel-centers-plus-one-half"
    || receipt.tileContract !== "global-origin-with-symmetric-halo"
    || !(
      receipt.periodicMode === "aperiodic"
      || receipt.periodicMode === "integer-fourier-torus"
    )
    || receipt.flowModel
      !== "unit-clamp(downhill*(-normalized-height-gradient)+tangent*perpendicular+gravity+wind)"
    || receipt.gradientModel
      !== "global-central-difference-composite-height"
    || !contentHash(receipt.recipeFingerprint)
    || !pair(receipt.origin)
    || !pair(receipt.coreOrigin)
    || !pair(receipt.coreSize)
    || !pair(receipt.outputSize)
    || !integer(
      receipt.coreOrigin[0],
      -1_000_000_000,
      1_000_000_000,
    )
    || !integer(
      receipt.coreOrigin[1],
      -1_000_000_000,
      1_000_000_000,
    )
    || !integer(
      receipt.coreSize[0],
      1,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS.maximumWidth,
    )
    || !integer(
      receipt.coreSize[1],
      1,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS.maximumHeight,
    )
    || !integer(
      receipt.halo,
      0,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS.maximumHalo,
    )
    || receipt.outputPixels !== pixels
    || !integer(
      receipt.outputPixels,
      1,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS.maximumOutputPixels,
    )
    || !integer(
      receipt.workUnits,
      1,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS.maximumWorkUnits,
    )
    || !integer(
      receipt.residentBytes,
      1,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS.maximumResidentBytes,
    )
    || !contentHash(receipt.heightHash)
    || !contentHash(receipt.absorbencyHash)
    || !contentHash(receipt.grainHash)
    || !contentHash(receipt.flowHash)
    || !contentHash(receipt.artifactHash)
    || receipt.complete !== true
    || receipt.origin[0] !== value.artifact.originX
    || receipt.origin[1] !== value.artifact.originY
    || receipt.origin[0] !== receipt.coreOrigin[0] - receipt.halo
    || receipt.origin[1] !== receipt.coreOrigin[1] - receipt.halo
    || receipt.outputSize[0]
      !== receipt.coreSize[0] + receipt.halo * 2
    || receipt.outputSize[1]
      !== receipt.coreSize[1] + receipt.halo * 2
    || receipt.outputSize[0] !== value.artifact.width
    || receipt.outputSize[1] !== value.artifact.height
    || value.artifact.heightField.length !== pixels
    || value.artifact.absorbency.length !== pixels
    || value.artifact.grain.length !== pixels
    || value.artifact.flow.length !== pixels * 2
  ) return null;
  const outputBytes =
    value.artifact.heightField.byteLength
    + value.artifact.absorbency.byteLength
    + value.artifact.grain.byteLength
    + value.artifact.flow.byteLength;
  if (
    outputBytes
    > STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_LIMITS.maximumOutputBytes
  ) return null;
  if (
    copyChannels
    && (
      !value.artifact.heightField.every(Number.isFinite)
      || !value.artifact.absorbency.every(Number.isFinite)
      || !value.artifact.grain.every(Number.isFinite)
      || !value.artifact.flow.every(Number.isFinite)
    )
  ) return null;
  const artifact = Object.freeze({
    kind: "studio-procedural-media-surface-artifact" as const,
    version: 1 as const,
    width: value.artifact.width,
    height: value.artifact.height,
    originX: value.artifact.originX,
    originY: value.artifact.originY,
    heightField: copyChannels
      ? new Float32Array(value.artifact.heightField)
      : value.artifact.heightField,
    absorbency: copyChannels
      ? new Float32Array(value.artifact.absorbency)
      : value.artifact.absorbency,
    grain: copyChannels
      ? new Float32Array(value.artifact.grain)
      : value.artifact.grain,
    flow: copyChannels
      ? new Float32Array(value.artifact.flow)
      : value.artifact.flow,
    receipt: Object.freeze({
      ...receipt,
      origin: Object.freeze([...receipt.origin]),
      coreOrigin: Object.freeze([...receipt.coreOrigin]),
      coreSize: Object.freeze([...receipt.coreSize]),
      outputSize: Object.freeze([...receipt.outputSize]),
    }),
  }) as unknown as StudioProceduralMediaSurfaceRenderReceipt["artifact"];
  return Object.freeze({
    kind: "studio-procedural-media-surface-render-receipt",
    requestSequence: value.requestSequence,
    engineEpoch: value.engineEpoch,
    artifact,
    receiptHash: value.receiptHash,
    complete: true,
  });
}

function cooperativeTaskYield(): Promise<void> {
  const channel = new MessageChannel();
  return new Promise((resolve) => {
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}

async function copyFloat32ChannelsCooperatively(
  values: readonly Float32Array[],
  shouldContinue: () => boolean,
): Promise<readonly Float32Array[] | null> {
  const copies: Float32Array[] = [];
  for (const value of values) {
    const copy = new Float32Array(value.length);
    for (
      let start = 0;
      start < value.length;
      start += COOPERATIVE_RESULT_FLOAT_CHUNK
    ) {
      if (!shouldContinue()) return null;
      const end = Math.min(
        value.length,
        start + COOPERATIVE_RESULT_FLOAT_CHUNK,
      );
      for (let index = start; index < end; index += 1) {
        const sample = value[index];
        if (sample === undefined || !Number.isFinite(sample)) return null;
        copy[index] = sample;
      }
      if (end < value.length) await cooperativeTaskYield();
    }
    copies.push(copy);
  }
  return shouldContinue() ? copies : null;
}

async function snapshotRenderReceiptCooperatively(
  value: unknown,
  shouldContinue: () => boolean,
): Promise<StudioProceduralMediaSurfaceRenderReceipt | null> {
  const borrowed = snapshotRenderReceipt(value, false);
  if (!borrowed || !shouldContinue()) return null;
  const source = borrowed.artifact;
  const copies = await copyFloat32ChannelsCooperatively(
    [
      source.heightField,
      source.absorbency,
      source.grain,
      source.flow,
    ],
    shouldContinue,
  );
  if (!copies) return null;
  const [heightField, absorbency, grain, flow] = copies;
  if (!heightField || !absorbency || !grain || !flow) return null;
  return snapshotRenderReceipt({
    ...borrowed,
    artifact: {
      ...source,
      heightField,
      absorbency,
      grain,
      flow,
    },
  }, false);
}

function hashCanonicalJson(value: unknown): `sha256:${string}` {
  return `sha256:${sha256HexPortable(
    new TextEncoder().encode(JSON.stringify(value)),
  )}`;
}

function verifiedAttestationBinding(
  value: Omit<
    StudioProceduralMediaSurfaceWorkerVerifiedAttestation,
    "bindingHash"
  >,
): Readonly<Record<string, unknown>> {
  return {
    kind: value.kind,
    version: value.version,
    verification: value.verification,
    requestId: value.requestId,
    requestSequence: value.requestSequence,
    engineEpoch: value.engineEpoch,
    recipeFingerprint: value.recipeFingerprint,
    periodicMode: value.periodicMode,
    coreOrigin: value.coreOrigin,
    coreSize: value.coreSize,
    outputOrigin: value.outputOrigin,
    outputSize: value.outputSize,
    halo: value.halo,
    workUnits: value.workUnits,
    residentBytes: value.residentBytes,
    artifactHash: value.artifactHash,
    receiptHash: value.receiptHash,
    complete: value.complete,
  };
}

export function createStudioProceduralMediaSurfaceWorkerVerifiedAttestation(
  requestId: number,
  receipt: StudioProceduralMediaSurfaceRenderReceipt,
): StudioProceduralMediaSurfaceWorkerVerifiedAttestation {
  const attestation = {
    kind:
      "studio-procedural-media-surface-worker-verified-attestation" as const,
    version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
    verification: "host-recomputed-sha256" as const,
    requestId,
    requestSequence: receipt.requestSequence,
    engineEpoch: receipt.engineEpoch,
    recipeFingerprint: receipt.artifact.receipt.recipeFingerprint,
    periodicMode: receipt.artifact.receipt.periodicMode,
    coreOrigin: Object.freeze([
      ...receipt.artifact.receipt.coreOrigin,
    ]) as readonly [number, number],
    coreSize: Object.freeze([
      ...receipt.artifact.receipt.coreSize,
    ]) as readonly [number, number],
    outputOrigin: Object.freeze([
      receipt.artifact.originX,
      receipt.artifact.originY,
    ]) as readonly [number, number],
    outputSize: Object.freeze([
      receipt.artifact.width,
      receipt.artifact.height,
    ]) as readonly [number, number],
    halo: receipt.artifact.receipt.halo,
    workUnits: receipt.artifact.receipt.workUnits,
    residentBytes: receipt.artifact.receipt.residentBytes,
    artifactHash: receipt.artifact.receipt.artifactHash,
    receiptHash: receipt.receiptHash,
    complete: true as const,
  };
  return Object.freeze({
    ...attestation,
    bindingHash: hashCanonicalJson(verifiedAttestationBinding(attestation)),
  });
}

function snapshotVerifiedAttestation(
  value: unknown,
  requestId: number,
  receipt: StudioProceduralMediaSurfaceRenderReceipt,
): StudioProceduralMediaSurfaceWorkerVerifiedAttestation | null {
  if (
    !exactKeys(value, VERIFIED_ATTESTATION_KEYS)
    || value.kind
      !== "studio-procedural-media-surface-worker-verified-attestation"
    || value.version
      !== STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION
    || value.verification !== "host-recomputed-sha256"
    || value.requestId !== requestId
    || value.requestSequence !== receipt.requestSequence
    || value.engineEpoch !== receipt.engineEpoch
    || value.recipeFingerprint
      !== receipt.artifact.receipt.recipeFingerprint
    || value.periodicMode !== receipt.artifact.receipt.periodicMode
    || !pair(value.coreOrigin)
    || !pair(value.coreSize)
    || !pair(value.outputOrigin)
    || !pair(value.outputSize)
    || value.coreOrigin[0] !== receipt.artifact.receipt.coreOrigin[0]
    || value.coreOrigin[1] !== receipt.artifact.receipt.coreOrigin[1]
    || value.coreSize[0] !== receipt.artifact.receipt.coreSize[0]
    || value.coreSize[1] !== receipt.artifact.receipt.coreSize[1]
    || value.outputOrigin[0] !== receipt.artifact.originX
    || value.outputOrigin[1] !== receipt.artifact.originY
    || value.outputSize[0] !== receipt.artifact.width
    || value.outputSize[1] !== receipt.artifact.height
    || value.halo !== receipt.artifact.receipt.halo
    || value.workUnits !== receipt.artifact.receipt.workUnits
    || value.residentBytes !== receipt.artifact.receipt.residentBytes
    || value.artifactHash !== receipt.artifact.receipt.artifactHash
    || value.receiptHash !== receipt.receiptHash
    || !contentHash(value.bindingHash)
    || value.complete !== true
  ) return null;
  const attestation: Omit<
    StudioProceduralMediaSurfaceWorkerVerifiedAttestation,
    "bindingHash"
  > = {
    kind:
      "studio-procedural-media-surface-worker-verified-attestation",
    version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
    verification: "host-recomputed-sha256",
    requestId: value.requestId,
    requestSequence: value.requestSequence,
    engineEpoch: value.engineEpoch,
    recipeFingerprint: value.recipeFingerprint,
    periodicMode: receipt.artifact.receipt.periodicMode,
    coreOrigin: Object.freeze([
      ...value.coreOrigin,
    ]) as readonly [number, number],
    coreSize: Object.freeze([
      ...value.coreSize,
    ]) as readonly [number, number],
    outputOrigin: Object.freeze([
      ...value.outputOrigin,
    ]) as readonly [number, number],
    outputSize: Object.freeze([
      ...value.outputSize,
    ]) as readonly [number, number],
    halo: value.halo,
    workUnits: receipt.artifact.receipt.workUnits,
    residentBytes: receipt.artifact.receipt.residentBytes,
    artifactHash: value.artifactHash,
    receiptHash: value.receiptHash,
    complete: true as const,
  };
  const bindingHash = hashCanonicalJson(
    verifiedAttestationBinding(attestation),
  );
  return bindingHash === value.bindingHash
    ? Object.freeze({ ...attestation, bindingHash })
    : null;
}

function platformUsesLittleEndianFloat32(): boolean {
  const marker = new Uint16Array([0x00ff]);
  return new Uint8Array(marker.buffer)[0] === 0xff;
}

async function digestFloat32Channel(
  value: Float32Array,
): Promise<`sha256:${string}` | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || !platformUsesLittleEndianFloat32()) return null;
  try {
    const digest = await subtle.digest(
      "SHA-256",
      new Uint8Array(
        value.buffer as ArrayBuffer,
        value.byteOffset,
        value.byteLength,
      ),
    );
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (const byte of bytes) {
      hex += byte.toString(16).padStart(2, "0");
    }
    return `sha256:${hex}`;
  } catch {
    return null;
  }
}

export async function verifyStudioProceduralMediaSurfaceWorkerPayloadIntegrity(
  receipt: StudioProceduralMediaSurfaceRenderReceipt,
): Promise<boolean> {
  const artifact = receipt.artifact;
  const surfaceReceipt = artifact.receipt;
  const heightHash = await digestFloat32Channel(artifact.heightField);
  const absorbencyHash = await digestFloat32Channel(artifact.absorbency);
  const grainHash = await digestFloat32Channel(artifact.grain);
  const flowHash = await digestFloat32Channel(artifact.flow);
  if (
    heightHash === null
    || absorbencyHash === null
    || grainHash === null
    || flowHash === null
    || heightHash !== surfaceReceipt.heightHash
    || absorbencyHash !== surfaceReceipt.absorbencyHash
    || grainHash !== surfaceReceipt.grainHash
    || flowHash !== surfaceReceipt.flowHash
  ) return false;
  const artifactHash = hashCanonicalJson({
    recipeFingerprint: surfaceReceipt.recipeFingerprint,
    origin: [artifact.originX, artifact.originY],
    size: [artifact.width, artifact.height],
    heightHash,
    absorbencyHash,
    grainHash,
    flowHash,
  });
  if (artifactHash !== surfaceReceipt.artifactHash) return false;
  return receipt.receiptHash === hashCanonicalJson({
    requestSequence: receipt.requestSequence,
    engineEpoch: receipt.engineEpoch,
    artifactHash,
  });
}

export function snapshotStudioProceduralMediaSurfaceWorkerResult(
  value: unknown,
): StudioProceduralMediaSurfaceWorkerResult | null {
  if (!plainRecord(value) || typeof value.status !== "string") return null;
  if (value.status === "worker-failed") return snapshotFailure(value);
  if (
    value.status === "rejected"
    && exactKeys(value, ["status", "reason"])
    && providerReason(value.reason)
  ) return Object.freeze({ status: "rejected", reason: value.reason });
  if (
    value.status === "completed"
    && exactKeys(value, ["status", "receipt"])
  ) {
    const receipt = snapshotRenderReceipt(value.receipt);
    return receipt
      ? Object.freeze({ status: "completed", receipt })
      : null;
  }
  return null;
}

export async function snapshotStudioProceduralMediaSurfaceWorkerResultCooperatively(
  value: unknown,
  shouldContinue: () => boolean = () => true,
): Promise<StudioProceduralMediaSurfaceWorkerResult | null> {
  if (!plainRecord(value) || typeof value.status !== "string") return null;
  if (value.status !== "completed") {
    return snapshotStudioProceduralMediaSurfaceWorkerResult(value);
  }
  if (!exactKeys(value, ["status", "receipt"])) return null;
  const receipt = await snapshotRenderReceiptCooperatively(
    value.receipt,
    shouldContinue,
  );
  return receipt && shouldContinue()
    ? Object.freeze({ status: "completed", receipt })
    : null;
}

export function snapshotStudioProceduralMediaSurfaceWorkerInboundMessage(
  value: unknown,
): StudioProceduralMediaSurfaceWorkerInboundMessage | null {
  if (
    !plainRecord(value)
    || value.version
      !== STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION
    || !integer(value.requestId, 1, Number.MAX_SAFE_INTEGER)
    || typeof value.type !== "string"
  ) return null;
  if (
    value.type === "studio-procedural-media-surface/execute"
    && exactKeys(value, ["type", "version", "requestId", "request"])
  ) {
    const snapshot = snapshotWireRequest(value.request);
    return snapshot.ok
      ? Object.freeze({
          type: value.type,
          version:
            STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
          requestId: value.requestId,
          request: snapshot.request,
        })
      : null;
  }
  if (
    value.type === "studio-procedural-media-surface/cancel"
    && exactKeys(value, ["type", "version", "requestId"])
  ) return Object.freeze({
    type: value.type,
    version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
    requestId: value.requestId,
  });
  if (
    value.type === "studio-procedural-media-surface/release"
    && exactKeys(
      value,
      ["type", "version", "requestId", "engineEpoch"],
    )
    && integer(value.engineEpoch, 1, Number.MAX_SAFE_INTEGER)
  ) return Object.freeze({
    type: value.type,
    version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
    requestId: value.requestId,
    engineEpoch: value.engineEpoch,
  });
  if (
    value.type === "studio-procedural-media-surface/advance-epoch"
    && exactKeys(
      value,
      ["type", "version", "requestId", "engineEpoch"],
    )
    && integer(value.engineEpoch, 1, Number.MAX_SAFE_INTEGER)
  ) return Object.freeze({
    type: value.type,
    version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
    requestId: value.requestId,
    engineEpoch: value.engineEpoch,
  });
  return null;
}

function snapshotControlReceipt(
  value: unknown,
): StudioProceduralMediaSurfaceWorkerControlReceipt | null {
  if (
    !exactKeys(
      value,
      [
        "kind",
        "control",
        "requestId",
        "engineEpoch",
        "released",
        "execution",
        "mainThreadComputationFallback",
        "workerTerminated",
        "complete",
      ],
    )
    || value.kind
      !== "studio-procedural-media-surface-worker-control-receipt"
    || !(value.control === "release" || value.control === "advance-epoch")
    || !integer(value.requestId, 1, Number.MAX_SAFE_INTEGER)
    || !integer(value.engineEpoch, 1, Number.MAX_SAFE_INTEGER)
    || typeof value.released !== "boolean"
    || value.execution !== "dedicated-worker"
    || value.mainThreadComputationFallback !== false
    || typeof value.workerTerminated !== "boolean"
    || value.complete !== true
  ) return null;
  return Object.freeze({
    kind: value.kind,
    control: value.control,
    requestId: value.requestId,
    engineEpoch: value.engineEpoch,
    released: value.released,
    execution: "dedicated-worker",
    mainThreadComputationFallback: false,
    workerTerminated: value.workerTerminated,
    complete: true,
  });
}

export function snapshotStudioProceduralMediaSurfaceWorkerOutboundMessage(
  value: unknown,
): StudioProceduralMediaSurfaceWorkerOutboundMessage | null {
  if (
    !plainRecord(value)
    || value.version
      !== STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION
    || typeof value.type !== "string"
  ) return null;
  if (
    value.type === "studio-procedural-media-surface/ready"
    && exactKeys(value, ["type", "version", "engineEpoch"])
    && integer(value.engineEpoch, 1, Number.MAX_SAFE_INTEGER)
  ) return Object.freeze({
    type: value.type,
    version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
    engineEpoch: value.engineEpoch,
  });
  if (
    value.type === "studio-procedural-media-surface/result"
    && exactKeys(
      value,
      [
        "type",
        "version",
        "requestId",
        "requestSequence",
        "engineEpoch",
        "result",
        "verification",
      ],
    )
    && integer(value.requestId, 1, Number.MAX_SAFE_INTEGER)
    && integer(value.requestSequence, 1, Number.MAX_SAFE_INTEGER)
    && integer(value.engineEpoch, 1, Number.MAX_SAFE_INTEGER)
  ) {
    const result = snapshotStudioProceduralMediaSurfaceWorkerResult(
      value.result,
    );
    if (!result) return null;
    const verification = result.status === "completed"
      ? snapshotVerifiedAttestation(
          value.verification,
          value.requestId,
          result.receipt,
        )
      : value.verification === null ? null : undefined;
    if (verification === undefined || (
      result.status === "completed" && verification === null
    )) return null;
    return Object.freeze({
      type: value.type,
      version:
        STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
      requestId: value.requestId,
      requestSequence: value.requestSequence,
      engineEpoch: value.engineEpoch,
      result,
      verification,
    });
  }
  if (
    value.type === "studio-procedural-media-surface/control-result"
    && exactKeys(value, ["type", "version", "receipt"])
  ) {
    const receipt = snapshotControlReceipt(value.receipt);
    return receipt
      ? Object.freeze({
          type: value.type,
          version:
            STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
          receipt,
        })
      : null;
  }
  return null;
}

export async function snapshotStudioProceduralMediaSurfaceWorkerOutboundMessageCooperatively(
  value: unknown,
  shouldContinue: () => boolean = () => true,
): Promise<StudioProceduralMediaSurfaceWorkerOutboundMessage | null> {
  if (
    !plainRecord(value)
    || value.type !== "studio-procedural-media-surface/result"
    || !plainRecord(value.result)
    || value.result.status !== "completed"
  ) {
    return snapshotStudioProceduralMediaSurfaceWorkerOutboundMessage(value);
  }
  if (
    value.version
      !== STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION
    || !exactKeys(
      value,
      [
        "type",
        "version",
        "requestId",
        "requestSequence",
        "engineEpoch",
        "result",
        "verification",
      ],
    )
    || !integer(value.requestId, 1, Number.MAX_SAFE_INTEGER)
    || !integer(value.requestSequence, 1, Number.MAX_SAFE_INTEGER)
    || !integer(value.engineEpoch, 1, Number.MAX_SAFE_INTEGER)
  ) return null;
  const result =
    await snapshotStudioProceduralMediaSurfaceWorkerResultCooperatively(
      value.result,
      shouldContinue,
    );
  if (!result || result.status !== "completed" || !shouldContinue()) {
    return null;
  }
  const verification = snapshotVerifiedAttestation(
    value.verification,
    value.requestId,
    result.receipt,
  );
  if (!verification) return null;
  return Object.freeze({
    type: "studio-procedural-media-surface/result",
    version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
    requestId: value.requestId,
    requestSequence: value.requestSequence,
    engineEpoch: value.engineEpoch,
    result,
    verification,
  });
}

export function studioProceduralMediaSurfaceRequestTransfers(
  message: StudioProceduralMediaSurfaceWorkerInboundMessage,
): Transferable[] {
  if (
    message.type !== "studio-procedural-media-surface/execute"
  ) return [];
  const { vectors } = message.request.recipe;
  return vectors.byteOffset === 0
    && vectors.byteLength === vectors.buffer.byteLength
    ? [vectors.buffer]
    : [];
}

export function studioProceduralMediaSurfaceResultTransfers(
  message: StudioProceduralMediaSurfaceWorkerOutboundMessage,
): Transferable[] {
  if (
    message.type !== "studio-procedural-media-surface/result"
    || message.result.status !== "completed"
  ) return [];
  const { artifact } = message.result.receipt;
  return [
    artifact.heightField.buffer,
    artifact.absorbency.buffer,
    artifact.grain.buffer,
    artifact.flow.buffer,
  ];
}
