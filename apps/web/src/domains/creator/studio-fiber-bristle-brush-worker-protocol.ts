import {
  hashStudioFiberBristleRequestFlow,
} from "./studio-fiber-bristle-brush-integrity";
import { sha256HexPortable } from "./studio-sha256";

import type {
  StudioFiberBristleBrushRecipe,
  StudioFiberBristleBrushRecipeInput,
  StudioFiberBristleCpuOracleReceipt,
  StudioFiberBristleErrorCode,
  StudioFiberBristleRenderReceipt,
  StudioFiberBristleRenderRequest,
  StudioFiberBristleSampleInput,
} from "./studio-fiber-bristle-brush-provider";

export const STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION = 1 as const;
export const STUDIO_FIBER_BRISTLE_WORKER_SAMPLE_STRIDE = 9 as const;

const MEBIBYTE = 1_048_576;

export const STUDIO_FIBER_BRISTLE_WORKER_LIMITS = Object.freeze({
  maximumInputBytes: 8 * MEBIBYTE,
  maximumOutputBytes: 512 * MEBIBYTE,
  maximumResidentBytes: 768 * MEBIBYTE,
  maximumSamples: 16_384,
  maximumFibers: 512,
  maximumStations: 262_144,
  maximumDepositions: 8_388_608,
  maximumWorkUnits: 134_217_728,
  maximumIdentifierCodeUnits: 192,
  maximumFailureDetailCodeUnits: 512,
} as const);

export interface StudioFiberBristleWorkerWireRequest {
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly strokeId: string;
  readonly operation: "replace" | "append";
  readonly recipe: StudioFiberBristleBrushRecipe;
  /** Interleaved x/y/time/pressure/tilt/azimuth/pickup-r/g/b. */
  readonly samples: Float32Array;
  readonly sampleCount: number;
}

export type StudioFiberBristleWorkerBoundaryFailureReason =
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

export interface StudioFiberBristleWorkerOnlyReceipt {
  readonly kind: "studio-fiber-bristle-worker-only-receipt";
  readonly execution: "dedicated-worker";
  readonly mainThreadComputationFallback: false;
  readonly workerTerminated: boolean;
  readonly complete: false;
  readonly reason: StudioFiberBristleWorkerBoundaryFailureReason;
}

export interface StudioFiberBristleWorkerBoundaryFailure {
  readonly status: "worker-failed";
  readonly reason: StudioFiberBristleWorkerBoundaryFailureReason;
  readonly detail: string;
  readonly fallback: StudioFiberBristleWorkerOnlyReceipt;
}

export interface StudioFiberBristleWorkerProviderRejection {
  readonly status: "rejected";
  readonly reason: StudioFiberBristleErrorCode;
}

export interface StudioFiberBristleWorkerCompleted {
  readonly status: "completed";
  readonly receipt: StudioFiberBristleRenderReceipt;
}

export type StudioFiberBristleWorkerResult =
  | StudioFiberBristleWorkerCompleted
  | StudioFiberBristleWorkerProviderRejection
  | StudioFiberBristleWorkerBoundaryFailure;

export interface StudioFiberBristleWorkerExecuteMessage {
  readonly type: "studio-fiber-bristle/execute";
  readonly version: typeof STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly request: StudioFiberBristleWorkerWireRequest;
}

export interface StudioFiberBristleWorkerCancelMessage {
  readonly type: "studio-fiber-bristle/cancel";
  readonly version: typeof STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
}

export interface StudioFiberBristleWorkerReleaseMessage {
  readonly type: "studio-fiber-bristle/release";
  readonly version: typeof STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly engineEpoch: number;
  readonly strokeId: string;
}

export interface StudioFiberBristleWorkerAdvanceEpochMessage {
  readonly type: "studio-fiber-bristle/advance-epoch";
  readonly version: typeof STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly engineEpoch: number;
}

export type StudioFiberBristleWorkerInboundMessage =
  | StudioFiberBristleWorkerExecuteMessage
  | StudioFiberBristleWorkerCancelMessage
  | StudioFiberBristleWorkerReleaseMessage
  | StudioFiberBristleWorkerAdvanceEpochMessage;

export interface StudioFiberBristleWorkerReadyMessage {
  readonly type: "studio-fiber-bristle/ready";
  readonly version: typeof STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION;
  readonly engineEpoch: number;
}

export interface StudioFiberBristleWorkerResultMessage {
  readonly type: "studio-fiber-bristle/result";
  readonly version: typeof STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly result: StudioFiberBristleWorkerResult;
}

export interface StudioFiberBristleWorkerControlReceipt {
  readonly kind: "studio-fiber-bristle-worker-control-receipt";
  readonly control: "release" | "advance-epoch";
  readonly requestId: number;
  readonly engineEpoch: number;
  readonly released: boolean;
  readonly execution: "dedicated-worker";
  readonly mainThreadComputationFallback: false;
  readonly workerTerminated: boolean;
  readonly complete: true;
}

export interface StudioFiberBristleWorkerControlResultMessage {
  readonly type: "studio-fiber-bristle/control-result";
  readonly version: typeof STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION;
  readonly receipt: StudioFiberBristleWorkerControlReceipt;
}

export type StudioFiberBristleWorkerOutboundMessage =
  | StudioFiberBristleWorkerReadyMessage
  | StudioFiberBristleWorkerResultMessage
  | StudioFiberBristleWorkerControlResultMessage;

export type StudioFiberBristleWorkerRequestSnapshot =
  | Readonly<{
      ok: true;
      request: StudioFiberBristleWorkerWireRequest;
      inputBytes: number;
      maximumOutputBytes: number;
      workUnits: number;
      stationCount: number;
      depositionCount: number;
    }>
  | Readonly<{
      ok: false;
      reason: "invalid-request" | "budget-exceeded";
    }>;

const RECIPE_KEYS = Object.freeze([
  "kind",
  "version",
  "seed",
  "bundleShape",
  "fiberCount",
  "diameter",
  "fiberLength",
  "stiffness",
  "stationSpacing",
  "baseWidth",
  "baseOpacity",
  "baseColor",
  "pressureWidth",
  "pressureSplay",
  "tiltSplay",
  "lagMilliseconds",
  "bendGain",
  "maximumBend",
  "initialLoad",
  "loadVariation",
  "depletionPerUnit",
  "velocityOpacity",
  "paper",
  "reload",
  "pickup",
  "dirty",
  "fingerprint",
]);
const REQUEST_KEYS = Object.freeze([
  "requestSequence",
  "engineEpoch",
  "strokeId",
  "operation",
  "recipe",
  "samples",
]);
const ORACLE_RECEIPT_KEYS = Object.freeze([
  "kind",
  "version",
  "backend",
  "integration",
  "recipeFingerprint",
  "replayHash",
  "topologyHash",
  "depositionHash",
  "artifactHash",
  "inputSampleCount",
  "canonicalSampleCount",
  "stationCount",
  "fiberCount",
  "depositionCount",
  "contactDepositionCount",
  "droppedDepositionCount",
  "pathLength",
  "workUnits",
  "residentBytes",
  "endpoint",
  "complete",
]);
const PROVIDER_RECEIPT_KEYS = Object.freeze([
  "kind",
  "providerRevision",
  "requestSequence",
  "engineEpoch",
  "strokeId",
  "operation",
  "requestFlowHash",
  "artifact",
  "receiptHash",
  "complete",
]);
const ARTIFACT_KEYS = Object.freeze([
  "kind",
  "version",
  "fiberTopology",
  "depositions",
  "finalLoads",
  "finalColors",
  "receipt",
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

function identifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length
      <= STUDIO_FIBER_BRISTLE_WORKER_LIMITS.maximumIdentifierCodeUnits;
}

function contentHash(value: unknown): value is `sha256:${string}` {
  return typeof value === "string"
    && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function color(
  value: unknown,
): value is readonly [number, number, number] {
  return Array.isArray(value)
    && value.length === 3
    && value.every((component) => range(component, 0, 64));
}

function finiteFloat32(value: unknown): value is Float32Array {
  return value instanceof Float32Array
    && value.buffer instanceof ArrayBuffer
    && value.every((component) => Number.isFinite(component));
}

function hashJson(value: unknown): `sha256:${string}` {
  return `sha256:${sha256HexPortable(
    new TextEncoder().encode(JSON.stringify(value)),
  )}`;
}

function hashFloat32(value: Float32Array): `sha256:${string}` {
  const bytes = new Uint8Array(value.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < value.length; index += 1) {
    view.setFloat32(
      index * Float32Array.BYTES_PER_ELEMENT,
      value[index] ?? 0,
      true,
    );
  }
  return `sha256:${sha256HexPortable(bytes)}`;
}

function snapshotRecipe(
  value: unknown,
): StudioFiberBristleBrushRecipe | null {
  if (
    !exactKeys(value, RECIPE_KEYS)
    || value.kind !== "studio-fiber-bristle-brush-recipe"
    || value.version !== 1
    || !integer(value.seed, 0, 0xffff_ffff)
    || !(
      value.bundleShape === "elliptical"
      || value.bundleShape === "fan"
      || value.bundleShape === "flat"
    )
    || !integer(
      value.fiberCount,
      1,
      STUDIO_FIBER_BRISTLE_WORKER_LIMITS.maximumFibers,
    )
    || !range(value.diameter, 0.125, 4_096)
    || !range(value.fiberLength, 0, 4_096)
    || !range(value.stiffness, 0.01, 1)
    || !range(value.stationSpacing, 0.03125, 256)
    || !range(value.baseWidth, 0.03125, 1_024)
    || !range(value.baseOpacity, 0, 1)
    || !color(value.baseColor)
    || !range(value.pressureWidth, 0, 4)
    || !range(value.pressureSplay, 0, 4)
    || !range(value.tiltSplay, 0, 4)
    || !range(value.lagMilliseconds, 0, 2_000)
    || !range(value.bendGain, 0, 8)
    || !range(value.maximumBend, 0, 8_192)
    || !range(value.initialLoad, 0, 1)
    || !range(value.loadVariation, 0, 1)
    || !range(value.depletionPerUnit, 0, 64)
    || !range(value.velocityOpacity, 0, 64)
    || !exactKeys(value.paper, ["scale", "dropout"])
    || !range(value.paper.scale, 0.03125, 8_192)
    || !range(value.paper.dropout, 0, 1)
    || !exactKeys(
      value.reload,
      ["mode", "intervalDistance", "amount"],
    )
    || !(value.reload.mode === "none" || value.reload.mode === "periodic")
    || !range(value.reload.intervalDistance, 0.03125, 16_777_216)
    || !range(value.reload.amount, 0, 1)
    || !exactKeys(value.pickup, ["enabled", "rate"])
    || typeof value.pickup.enabled !== "boolean"
    || !range(value.pickup.rate, 0, 1)
    || !exactKeys(value.dirty, ["color", "mix"])
    || !color(value.dirty.color)
    || !range(value.dirty.mix, 0, 1)
    || !contentHash(value.fingerprint)
  ) return null;
  return Object.freeze({
    kind: "studio-fiber-bristle-brush-recipe",
    version: 1,
    seed: value.seed,
    bundleShape: value.bundleShape,
    fiberCount: value.fiberCount,
    diameter: value.diameter,
    fiberLength: value.fiberLength,
    stiffness: value.stiffness,
    stationSpacing: value.stationSpacing,
    baseWidth: value.baseWidth,
    baseOpacity: value.baseOpacity,
    baseColor: Object.freeze([...value.baseColor]) as readonly [
      number,
      number,
      number,
    ],
    pressureWidth: value.pressureWidth,
    pressureSplay: value.pressureSplay,
    tiltSplay: value.tiltSplay,
    lagMilliseconds: value.lagMilliseconds,
    bendGain: value.bendGain,
    maximumBend: value.maximumBend,
    initialLoad: value.initialLoad,
    loadVariation: value.loadVariation,
    depletionPerUnit: value.depletionPerUnit,
    velocityOpacity: value.velocityOpacity,
    paper: Object.freeze({
      scale: value.paper.scale,
      dropout: value.paper.dropout,
    }),
    reload: Object.freeze({
      mode: value.reload.mode,
      intervalDistance: value.reload.intervalDistance,
      amount: value.reload.amount,
    }),
    pickup: Object.freeze({
      enabled: value.pickup.enabled,
      rate: value.pickup.rate,
    }),
    dirty: Object.freeze({
      color: Object.freeze([...value.dirty.color]) as readonly [
        number,
        number,
        number,
      ],
      mix: value.dirty.mix,
    }),
    fingerprint: value.fingerprint,
  });
}

function sampleBuffer(
  samples: readonly StudioFiberBristleSampleInput[],
): Float32Array | "invalid-request" | "budget-exceeded" {
  if (
    !Array.isArray(samples)
    || samples.length < 1
    || samples.length
      > STUDIO_FIBER_BRISTLE_WORKER_LIMITS.maximumSamples
  ) return samples.length > STUDIO_FIBER_BRISTLE_WORKER_LIMITS.maximumSamples
    ? "budget-exceeded"
    : "invalid-request";
  const output = new Float32Array(
    samples.length * STUDIO_FIBER_BRISTLE_WORKER_SAMPLE_STRIDE,
  );
  let previousTime = -1;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (
      !exactKeys(
        sample,
        [
          "x",
          "y",
          "timeMilliseconds",
          "pressure",
          "tiltRadians",
          "azimuthRadians",
        ],
        ["pickupColor"],
      )
      || !finite(sample.x)
      || !finite(sample.y)
      || !range(sample.timeMilliseconds, 0, 16_777_216)
      || sample.timeMilliseconds < previousTime
      || !range(sample.pressure, 0, 1)
      || !range(sample.tiltRadians, 0, Math.PI / 2)
      || !range(sample.azimuthRadians, -Math.PI * 2, Math.PI * 2)
      || (
        sample.pickupColor !== undefined
        && !color(sample.pickupColor)
      )
    ) return "invalid-request";
    previousTime = sample.timeMilliseconds;
    const offset = index * STUDIO_FIBER_BRISTLE_WORKER_SAMPLE_STRIDE;
    output[offset] = sample.x;
    output[offset + 1] = sample.y;
    output[offset + 2] = sample.timeMilliseconds;
    output[offset + 3] = sample.pressure;
    output[offset + 4] = sample.tiltRadians;
    output[offset + 5] = sample.azimuthRadians;
    output[offset + 6] = sample.pickupColor?.[0] ?? -1;
    output[offset + 7] = sample.pickupColor?.[1] ?? -1;
    output[offset + 8] = sample.pickupColor?.[2] ?? -1;
  }
  return output;
}

function inspectWireSamples(
  samples: Float32Array,
  sampleCount: number,
): Readonly<{
  pathLength: number;
  valid: boolean;
}> {
  let pathLength = 0;
  let previousTime = -1;
  for (let index = 0; index < sampleCount; index += 1) {
    const offset = index * STUDIO_FIBER_BRISTLE_WORKER_SAMPLE_STRIDE;
    const x = samples[offset] ?? Number.NaN;
    const y = samples[offset + 1] ?? Number.NaN;
    const time = samples[offset + 2] ?? Number.NaN;
    const pressure = samples[offset + 3] ?? Number.NaN;
    const tilt = samples[offset + 4] ?? Number.NaN;
    const azimuth = samples[offset + 5] ?? Number.NaN;
    const pickup = [
      samples[offset + 6],
      samples[offset + 7],
      samples[offset + 8],
    ];
    const absentPickup = pickup.every((component) => component === -1);
    if (
      !finite(x)
      || !finite(y)
      || !range(time, 0, 16_777_216)
      || time < previousTime
      || !range(pressure, 0, 1)
      || !range(tilt, 0, Math.PI / 2)
      || !range(azimuth, -Math.PI * 2, Math.PI * 2)
      || (
        !absentPickup
        && !pickup.every((component) => range(component, 0, 64))
      )
    ) return Object.freeze({ pathLength: 0, valid: false });
    if (index > 0) {
      const previousOffset =
        (index - 1) * STUDIO_FIBER_BRISTLE_WORKER_SAMPLE_STRIDE;
      pathLength += Math.hypot(
        x - (samples[previousOffset] ?? x),
        y - (samples[previousOffset + 1] ?? y),
      );
    }
    previousTime = time;
  }
  return Object.freeze({
    pathLength,
    valid: Number.isFinite(pathLength),
  });
}

function snapshotWireRequest(
  value: unknown,
): StudioFiberBristleWorkerRequestSnapshot {
  if (
    !exactKeys(value, [
      "requestSequence",
      "engineEpoch",
      "strokeId",
      "operation",
      "recipe",
      "samples",
      "sampleCount",
    ])
    || !integer(value.requestSequence, 1, Number.MAX_SAFE_INTEGER)
    || !integer(value.engineEpoch, 1, Number.MAX_SAFE_INTEGER)
    || !identifier(value.strokeId)
    || !(value.operation === "replace" || value.operation === "append")
    || !finiteFloat32(value.samples)
    || !integer(
      value.sampleCount,
      1,
      STUDIO_FIBER_BRISTLE_WORKER_LIMITS.maximumSamples,
    )
    || value.samples.length
      !== value.sampleCount * STUDIO_FIBER_BRISTLE_WORKER_SAMPLE_STRIDE
  ) return Object.freeze({ ok: false, reason: "invalid-request" });
  const recipe = snapshotRecipe(value.recipe);
  if (!recipe) {
    return Object.freeze({ ok: false, reason: "invalid-request" });
  }
  const samples = new Float32Array(value.samples);
  return finishRequestSnapshot({
    requestSequence: value.requestSequence,
    engineEpoch: value.engineEpoch,
    strokeId: value.strokeId,
    operation: value.operation,
    recipe,
    samples,
    sampleCount: value.sampleCount,
  });
}

function finishRequestSnapshot(
  request: StudioFiberBristleWorkerWireRequest,
): StudioFiberBristleWorkerRequestSnapshot {
  const inspected = inspectWireSamples(request.samples, request.sampleCount);
  if (!inspected.valid) {
    return Object.freeze({ ok: false, reason: "invalid-request" });
  }
  const stationCount = inspected.pathLength === 0
    ? 1
    : Math.ceil(
      inspected.pathLength / request.recipe.stationSpacing,
    ) + 1;
  const depositionCount = stationCount * request.recipe.fiberCount;
  const workUnits = depositionCount * 12 + request.sampleCount * 4;
  const inputBytes = request.samples.byteLength;
  const maximumOutputBytes =
    depositionCount * 15 * Float32Array.BYTES_PER_ELEMENT
    + request.recipe.fiberCount * 12 * Float32Array.BYTES_PER_ELEMENT;
  if (
    inputBytes > STUDIO_FIBER_BRISTLE_WORKER_LIMITS.maximumInputBytes
    || stationCount > STUDIO_FIBER_BRISTLE_WORKER_LIMITS.maximumStations
    || depositionCount
      > STUDIO_FIBER_BRISTLE_WORKER_LIMITS.maximumDepositions
    || workUnits > STUDIO_FIBER_BRISTLE_WORKER_LIMITS.maximumWorkUnits
    || maximumOutputBytes
      > STUDIO_FIBER_BRISTLE_WORKER_LIMITS.maximumOutputBytes
  ) return Object.freeze({ ok: false, reason: "budget-exceeded" });
  return Object.freeze({
    ok: true,
    request: Object.freeze(request),
    inputBytes,
    maximumOutputBytes,
    workUnits,
    stationCount,
    depositionCount,
  });
}

export function snapshotStudioFiberBristleWorkerRequest(
  value: unknown,
): StudioFiberBristleWorkerRequestSnapshot {
  if (
    !exactKeys(value, REQUEST_KEYS)
    || !integer(value.requestSequence, 1, Number.MAX_SAFE_INTEGER)
    || !integer(value.engineEpoch, 1, Number.MAX_SAFE_INTEGER)
    || !identifier(value.strokeId)
    || !(value.operation === "replace" || value.operation === "append")
    || !Array.isArray(value.samples)
  ) return Object.freeze({ ok: false, reason: "invalid-request" });
  const recipe = snapshotRecipe(value.recipe);
  if (!recipe) {
    return Object.freeze({ ok: false, reason: "invalid-request" });
  }
  const samples = sampleBuffer(
    value.samples as readonly StudioFiberBristleSampleInput[],
  );
  if (typeof samples === "string") {
    return Object.freeze({ ok: false, reason: samples });
  }
  return finishRequestSnapshot({
    requestSequence: value.requestSequence,
    engineEpoch: value.engineEpoch,
    strokeId: value.strokeId,
    operation: value.operation,
    recipe,
    samples,
    sampleCount: value.samples.length,
  });
}

export function studioFiberBristleWireSamplesToInput(
  value: StudioFiberBristleWorkerWireRequest,
): readonly StudioFiberBristleSampleInput[] {
  const result: StudioFiberBristleSampleInput[] = [];
  for (let index = 0; index < value.sampleCount; index += 1) {
    const offset = index * STUDIO_FIBER_BRISTLE_WORKER_SAMPLE_STRIDE;
    const red = value.samples[offset + 6] ?? -1;
    const green = value.samples[offset + 7] ?? -1;
    const blue = value.samples[offset + 8] ?? -1;
    const hasPickup = red >= 0 && green >= 0 && blue >= 0;
    result.push(Object.freeze({
      x: value.samples[offset] ?? 0,
      y: value.samples[offset + 1] ?? 0,
      timeMilliseconds: value.samples[offset + 2] ?? 0,
      pressure: value.samples[offset + 3] ?? 0,
      tiltRadians: value.samples[offset + 4] ?? 0,
      azimuthRadians: value.samples[offset + 5] ?? 0,
      ...(hasPickup
        ? { pickupColor: Object.freeze([red, green, blue]) as readonly [
            number,
            number,
            number,
          ] }
        : {}),
    }));
  }
  return Object.freeze(result);
}

export function studioFiberBristleWorkerRequestFlowHash(
  request: StudioFiberBristleWorkerWireRequest,
  previousReplayHash: `sha256:${string}` | null,
): `sha256:${string}` {
  return hashStudioFiberBristleRequestFlow({
    requestSequence: request.requestSequence,
    engineEpoch: request.engineEpoch,
    strokeId: request.strokeId,
    operation: request.operation,
    recipeFingerprint: request.recipe.fingerprint,
    previousReplayHash,
    samples: studioFiberBristleWireSamplesToInput(request),
  });
}

function rejectionReason(value: unknown): value is StudioFiberBristleErrorCode {
  return (
    value === "invalid-recipe"
    || value === "invalid-samples"
    || value === "invalid-request"
    || value === "budget-exceeded"
    || value === "missing-stroke"
    || value === "recipe-mismatch"
    || value === "request-sequence"
    || value === "engine-epoch"
    || value === "aborted"
    || value === "disposed"
  );
}

function boundaryReason(
  value: unknown,
): value is StudioFiberBristleWorkerBoundaryFailureReason {
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

export function studioFiberBristleWorkerFailure(
  reason: StudioFiberBristleWorkerBoundaryFailureReason,
  detail: string,
  workerTerminated = false,
): StudioFiberBristleWorkerBoundaryFailure {
  return Object.freeze({
    status: "worker-failed",
    reason,
    detail: detail.slice(
      0,
      STUDIO_FIBER_BRISTLE_WORKER_LIMITS.maximumFailureDetailCodeUnits,
    ),
    fallback: Object.freeze({
      kind: "studio-fiber-bristle-worker-only-receipt",
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
): StudioFiberBristleWorkerBoundaryFailure | null {
  if (
    !exactKeys(value, ["status", "reason", "detail", "fallback"])
    || value.status !== "worker-failed"
    || !boundaryReason(value.reason)
    || typeof value.detail !== "string"
    || value.detail.length
      > STUDIO_FIBER_BRISTLE_WORKER_LIMITS.maximumFailureDetailCodeUnits
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
      !== "studio-fiber-bristle-worker-only-receipt"
    || value.fallback.execution !== "dedicated-worker"
    || value.fallback.mainThreadComputationFallback !== false
    || typeof value.fallback.workerTerminated !== "boolean"
    || value.fallback.complete !== false
    || value.fallback.reason !== value.reason
  ) return null;
  return studioFiberBristleWorkerFailure(
    value.reason,
    value.detail,
    value.fallback.workerTerminated,
  );
}

function snapshotRenderReceipt(
  value: unknown,
): StudioFiberBristleRenderReceipt | null {
  if (
    !exactKeys(value, PROVIDER_RECEIPT_KEYS)
    || value.kind !== "studio-fiber-bristle-render-receipt"
    || value.providerRevision !== 1
    || !integer(value.requestSequence, 1, Number.MAX_SAFE_INTEGER)
    || !integer(value.engineEpoch, 1, Number.MAX_SAFE_INTEGER)
    || !identifier(value.strokeId)
    || !(value.operation === "replace" || value.operation === "append")
    || !contentHash(value.requestFlowHash)
    || !contentHash(value.receiptHash)
    || value.complete !== true
    || !exactKeys(value.artifact, ARTIFACT_KEYS)
    || value.artifact.kind !== "studio-fiber-bristle-brush-artifact"
    || value.artifact.version !== 1
    || !finiteFloat32(value.artifact.fiberTopology)
    || !finiteFloat32(value.artifact.depositions)
    || !finiteFloat32(value.artifact.finalLoads)
    || !finiteFloat32(value.artifact.finalColors)
    || !exactKeys(value.artifact.receipt, ORACLE_RECEIPT_KEYS)
  ) return null;
  const receipt = value.artifact.receipt;
  if (
    receipt.kind !== "studio-fiber-bristle-cpu-oracle-receipt"
    || receipt.version !== 1
    || receipt.backend !== "cpu-f32-individual-fiber"
    || receipt.integration !== "bounded-lag-arc-length-v1"
    || !contentHash(receipt.recipeFingerprint)
    || !contentHash(receipt.replayHash)
    || !contentHash(receipt.topologyHash)
    || !contentHash(receipt.depositionHash)
    || !contentHash(receipt.artifactHash)
    || !integer(
      receipt.inputSampleCount,
      1,
      STUDIO_FIBER_BRISTLE_WORKER_LIMITS.maximumSamples,
    )
    || !integer(
      receipt.canonicalSampleCount,
      1,
      STUDIO_FIBER_BRISTLE_WORKER_LIMITS.maximumSamples,
    )
    || !integer(
      receipt.stationCount,
      1,
      STUDIO_FIBER_BRISTLE_WORKER_LIMITS.maximumStations,
    )
    || !integer(
      receipt.fiberCount,
      1,
      STUDIO_FIBER_BRISTLE_WORKER_LIMITS.maximumFibers,
    )
    || !integer(
      receipt.depositionCount,
      1,
      STUDIO_FIBER_BRISTLE_WORKER_LIMITS.maximumDepositions,
    )
    || !integer(
      receipt.contactDepositionCount,
      0,
      receipt.depositionCount,
    )
    || !integer(
      receipt.droppedDepositionCount,
      0,
      receipt.depositionCount,
    )
    || !finite(receipt.pathLength)
    || receipt.pathLength < 0
    || !integer(
      receipt.workUnits,
      1,
      STUDIO_FIBER_BRISTLE_WORKER_LIMITS.maximumWorkUnits,
    )
    || !integer(
      receipt.residentBytes,
      1,
      STUDIO_FIBER_BRISTLE_WORKER_LIMITS.maximumResidentBytes,
    )
    || !Array.isArray(receipt.endpoint)
    || receipt.endpoint.length !== 2
    || !receipt.endpoint.every(finite)
    || receipt.complete !== true
    || value.artifact.fiberTopology.length !== receipt.fiberCount * 8
    || value.artifact.depositions.length !== receipt.depositionCount * 15
    || value.artifact.finalLoads.length !== receipt.fiberCount
    || value.artifact.finalColors.length !== receipt.fiberCount * 3
  ) return null;
  const outputBytes =
    value.artifact.fiberTopology.byteLength
    + value.artifact.depositions.byteLength
    + value.artifact.finalLoads.byteLength
    + value.artifact.finalColors.byteLength;
  if (
    outputBytes > STUDIO_FIBER_BRISTLE_WORKER_LIMITS.maximumOutputBytes
  ) return null;
  const topologyHash = hashFloat32(value.artifact.fiberTopology);
  const depositionHash = hashFloat32(value.artifact.depositions);
  const artifactHash = hashJson({
    replayHash: receipt.replayHash,
    topologyHash,
    depositionHash,
    finalLoadsHash: hashFloat32(value.artifact.finalLoads),
    finalColorsHash: hashFloat32(value.artifact.finalColors),
  });
  if (
    receipt.topologyHash !== topologyHash
    || receipt.depositionHash !== depositionHash
    || receipt.artifactHash !== artifactHash
    || value.receiptHash !== hashJson({
      providerRevision: 1,
      requestSequence: value.requestSequence,
      engineEpoch: value.engineEpoch,
      strokeId: value.strokeId,
      operation: value.operation,
      requestFlowHash: value.requestFlowHash,
      artifactHash,
    })
  ) return null;
  const fiberTopology = new Float32Array(value.artifact.fiberTopology);
  const depositions = new Float32Array(value.artifact.depositions);
  const finalLoads = new Float32Array(value.artifact.finalLoads);
  const finalColors = new Float32Array(value.artifact.finalColors);
  const oracleReceipt = Object.freeze({
    ...receipt,
    endpoint: Object.freeze([
      receipt.endpoint[0],
      receipt.endpoint[1],
    ]) as readonly [number, number],
  }) as unknown as StudioFiberBristleCpuOracleReceipt;
  const artifact = Object.freeze({
    kind: "studio-fiber-bristle-brush-artifact" as const,
    version: 1 as const,
    fiberTopology,
    depositions,
    finalLoads,
    finalColors,
    receipt: oracleReceipt,
  });
  return Object.freeze({
    kind: "studio-fiber-bristle-render-receipt",
    providerRevision: 1,
    requestSequence: value.requestSequence,
    engineEpoch: value.engineEpoch,
    strokeId: value.strokeId,
    operation: value.operation,
    requestFlowHash: value.requestFlowHash,
    artifact,
    receiptHash: value.receiptHash,
    complete: true,
  });
}

export function snapshotStudioFiberBristleWorkerResult(
  value: unknown,
): StudioFiberBristleWorkerResult | null {
  if (!plainRecord(value) || typeof value.status !== "string") return null;
  if (value.status === "worker-failed") return snapshotFailure(value);
  if (
    value.status === "rejected"
    && exactKeys(value, ["status", "reason"])
    && rejectionReason(value.reason)
  ) {
    return Object.freeze({
      status: "rejected",
      reason: value.reason,
    });
  }
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

export function snapshotStudioFiberBristleWorkerInboundMessage(
  value: unknown,
): StudioFiberBristleWorkerInboundMessage | null {
  if (
    !plainRecord(value)
    || value.version !== STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION
    || !integer(value.requestId, 1, Number.MAX_SAFE_INTEGER)
    || typeof value.type !== "string"
  ) return null;
  if (
    value.type === "studio-fiber-bristle/execute"
    && exactKeys(value, ["type", "version", "requestId", "request"])
  ) {
    const snapshot = snapshotWireRequest(value.request);
    return snapshot.ok
      ? Object.freeze({
          type: value.type,
          version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
          requestId: value.requestId,
          request: snapshot.request,
        })
      : null;
  }
  if (
    value.type === "studio-fiber-bristle/cancel"
    && exactKeys(value, ["type", "version", "requestId"])
  ) {
    return Object.freeze({
      type: value.type,
      version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
      requestId: value.requestId,
    });
  }
  if (
    value.type === "studio-fiber-bristle/release"
    && exactKeys(
      value,
      ["type", "version", "requestId", "engineEpoch", "strokeId"],
    )
    && integer(value.engineEpoch, 1, Number.MAX_SAFE_INTEGER)
    && identifier(value.strokeId)
  ) {
    return Object.freeze({
      type: value.type,
      version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
      requestId: value.requestId,
      engineEpoch: value.engineEpoch,
      strokeId: value.strokeId,
    });
  }
  if (
    value.type === "studio-fiber-bristle/advance-epoch"
    && exactKeys(
      value,
      ["type", "version", "requestId", "engineEpoch"],
    )
    && integer(value.engineEpoch, 1, Number.MAX_SAFE_INTEGER)
  ) {
    return Object.freeze({
      type: value.type,
      version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
      requestId: value.requestId,
      engineEpoch: value.engineEpoch,
    });
  }
  return null;
}

function snapshotControlReceipt(
  value: unknown,
): StudioFiberBristleWorkerControlReceipt | null {
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
    || value.kind !== "studio-fiber-bristle-worker-control-receipt"
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
    execution: value.execution,
    mainThreadComputationFallback: false,
    workerTerminated: value.workerTerminated,
    complete: true,
  });
}

export function snapshotStudioFiberBristleWorkerOutboundMessage(
  value: unknown,
): StudioFiberBristleWorkerOutboundMessage | null {
  if (
    !plainRecord(value)
    || value.version !== STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION
    || typeof value.type !== "string"
  ) return null;
  if (
    value.type === "studio-fiber-bristle/ready"
    && exactKeys(value, ["type", "version", "engineEpoch"])
    && integer(value.engineEpoch, 1, Number.MAX_SAFE_INTEGER)
  ) {
    return Object.freeze({
      type: value.type,
      version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
      engineEpoch: value.engineEpoch,
    });
  }
  if (
    value.type === "studio-fiber-bristle/result"
    && exactKeys(
      value,
      [
        "type",
        "version",
        "requestId",
        "requestSequence",
        "engineEpoch",
        "result",
      ],
    )
    && integer(value.requestId, 1, Number.MAX_SAFE_INTEGER)
    && integer(value.requestSequence, 1, Number.MAX_SAFE_INTEGER)
    && integer(value.engineEpoch, 1, Number.MAX_SAFE_INTEGER)
  ) {
    const result = snapshotStudioFiberBristleWorkerResult(value.result);
    return result
      ? Object.freeze({
          type: value.type,
          version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
          requestId: value.requestId,
          requestSequence: value.requestSequence,
          engineEpoch: value.engineEpoch,
          result,
        })
      : null;
  }
  if (
    value.type === "studio-fiber-bristle/control-result"
    && exactKeys(value, ["type", "version", "receipt"])
  ) {
    const receipt = snapshotControlReceipt(value.receipt);
    return receipt
      ? Object.freeze({
          type: value.type,
          version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
          receipt,
        })
      : null;
  }
  return null;
}

export function studioFiberBristleRequestTransfers(
  message: StudioFiberBristleWorkerInboundMessage,
): Transferable[] {
  if (message.type !== "studio-fiber-bristle/execute") return [];
  const { samples } = message.request;
  return samples.byteOffset === 0
    && samples.byteLength === samples.buffer.byteLength
    ? [samples.buffer]
    : [];
}

export function studioFiberBristleResultTransfers(
  message: StudioFiberBristleWorkerOutboundMessage,
): Transferable[] {
  if (
    message.type !== "studio-fiber-bristle/result"
    || message.result.status !== "completed"
  ) return [];
  const { artifact } = message.result.receipt;
  return [
    artifact.fiberTopology.buffer,
    artifact.depositions.buffer,
    artifact.finalLoads.buffer,
    artifact.finalColors.buffer,
  ];
}

export function studioFiberBristleWireRequestToProviderRequest(
  value: StudioFiberBristleWorkerWireRequest,
  signal: AbortSignal,
): StudioFiberBristleRenderRequest {
  return {
    requestSequence: value.requestSequence,
    engineEpoch: value.engineEpoch,
    strokeId: value.strokeId,
    operation: value.operation,
    recipe: value.recipe,
    samples: studioFiberBristleWireSamplesToInput(value),
    signal,
  };
}

export function studioFiberBristleRecipeInputSnapshot(
  value: StudioFiberBristleBrushRecipeInput,
): StudioFiberBristleBrushRecipeInput | null {
  const candidate = {
    kind: "studio-fiber-bristle-brush-recipe",
    version: 1,
    ...value,
    fingerprint: `sha256:${"0".repeat(64)}`,
  };
  const snapshot = snapshotRecipe(candidate);
  if (!snapshot) return null;
  const {
    kind: _kind,
    version: _version,
    fingerprint: _fingerprint,
    ...input
  } = snapshot;
  return Object.freeze(input);
}
