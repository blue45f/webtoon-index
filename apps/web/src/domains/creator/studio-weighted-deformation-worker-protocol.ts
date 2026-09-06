import {
  hashStudioWeightedDeformationFloat32,
  hashStudioWeightedDeformationRequest,
} from "./studio-weighted-deformation-integrity";

import type {
  StudioWeightedDeformationArtifact,
  StudioWeightedDeformationFailureReason,
  StudioWeightedDeformationReceipt,
  StudioWeightedDeformationRequest,
  StudioWeightedDeformationResult,
  StudioWeightedDeformationSource,
} from "./studio-weighted-deformation-provider";

export const STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION = 1 as const;

const MEBIBYTE = 1_048_576;

/**
 * Worker transport limits are deliberately no larger than the CPU oracle
 * limits. Byte limits additionally bound structured-clone and transfer costs.
 */
export const STUDIO_WEIGHTED_DEFORMATION_WORKER_LIMITS = Object.freeze({
  maxInputBytes: 64 * MEBIBYTE,
  maxOutputBytes: 64 * MEBIBYTE,
  maxVertices: 2_000_000,
  maxSources: 128,
  maxPointsPerSource: 8_192,
  maxTotalSourcePoints: 65_536,
  maxWorkUnits: 100_000_000,
  maxIdentifierCharacters: 128,
  maxFailureDetailCharacters: 512,
} as const);

export type StudioWeightedDeformationWorkerRequest = Omit<
  StudioWeightedDeformationRequest,
  "signal"
>;

export type StudioWeightedDeformationWorkerBoundaryFailureReason =
  | "backpressure"
  | "disposed"
  | "execution-failed"
  | "invalid-message"
  | "operation-timeout"
  | "protocol-error"
  | "startup-timeout"
  | "worker-unavailable";

export interface StudioWeightedDeformationWorkerOnlyReceipt {
  readonly kind: "studio-weighted-deformation-worker-only";
  readonly execution: "dedicated-worker";
  readonly mainThreadComputationFallback: false;
  readonly complete: false;
  readonly reason: StudioWeightedDeformationWorkerBoundaryFailureReason;
}

export interface StudioWeightedDeformationWorkerBoundaryFailure {
  readonly status: "worker-failed";
  readonly reason: StudioWeightedDeformationWorkerBoundaryFailureReason;
  readonly detail: string;
  readonly fallback: StudioWeightedDeformationWorkerOnlyReceipt;
}

export type StudioWeightedDeformationWorkerResult =
  | StudioWeightedDeformationResult
  | StudioWeightedDeformationWorkerBoundaryFailure;

export interface StudioWeightedDeformationWorkerExecuteMessage {
  readonly type: "studio-weighted-deformation/execute";
  readonly version: typeof STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly request: StudioWeightedDeformationWorkerRequest;
}

export interface StudioWeightedDeformationWorkerCancelMessage {
  readonly type: "studio-weighted-deformation/cancel";
  readonly version: typeof STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
}

export interface StudioWeightedDeformationWorkerAdvanceEpochMessage {
  readonly type: "studio-weighted-deformation/advance-epoch";
  readonly version: typeof STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION;
  readonly currentEpoch: number;
}

export type StudioWeightedDeformationWorkerInboundMessage =
  | StudioWeightedDeformationWorkerExecuteMessage
  | StudioWeightedDeformationWorkerCancelMessage
  | StudioWeightedDeformationWorkerAdvanceEpochMessage;

export interface StudioWeightedDeformationWorkerReadyMessage {
  readonly type: "studio-weighted-deformation/ready";
  readonly version: typeof STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION;
  readonly currentEpoch: number;
}

export interface StudioWeightedDeformationWorkerResultMessage {
  readonly type: "studio-weighted-deformation/result";
  readonly version: typeof STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly requestEpoch: number;
  readonly result: StudioWeightedDeformationWorkerResult;
}

export type StudioWeightedDeformationWorkerOutboundMessage =
  | StudioWeightedDeformationWorkerReadyMessage
  | StudioWeightedDeformationWorkerResultMessage;

export type StudioWeightedDeformationRequestSnapshot =
  | Readonly<{
      ok: true;
      request: StudioWeightedDeformationWorkerRequest;
      inputBytes: number;
      maximumOutputBytes: number;
      workUnits: number;
      requestSha256: `sha256:${string}`;
      textureCoordinatesSha256: `sha256:${string}` | null;
    }>
  | Readonly<{
      ok: false;
      reason: "invalid-request" | "budget-exceeded";
    }>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key))
    && keys.every(
      (key) => required.includes(key) || optional.includes(key),
    )
  );
}

function isPositiveEpoch(value: unknown): value is number {
  return (
    typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0
  );
}

function isNonNegativeEpoch(value: unknown): value is number {
  return (
    typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
  );
}

function isRequestId(value: unknown): value is number {
  return isPositiveEpoch(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteFloat32Array(value: unknown): value is Float32Array {
  return (
    value instanceof Float32Array
    && value.buffer instanceof ArrayBuffer
    && value.every((component) => Number.isFinite(component))
  );
}

function addBytes(total: number, addition: number): number | null {
  const next = total + addition;
  return Number.isSafeInteger(next) ? next : null;
}

function sourceSegmentCount(
  pointCount: number,
  closed: boolean,
): number {
  if (pointCount === 1) return 1;
  return pointCount - 1 + (closed ? 1 : 0);
}

function copySource(
  value: unknown,
  dimension: 2 | 3,
  ids: Set<string>,
): Readonly<{
  source: StudioWeightedDeformationSource;
  pointCount: number;
  segmentCount: number;
  bytes: number;
}> | "invalid-request" | "budget-exceeded" {
  if (
    !isPlainRecord(value)
    || !hasOnlyKeys(value, [
      "id",
      "dimension",
      "restPoints",
      "deformedPoints",
      "closed",
      "radius",
      "falloff",
      "strength",
    ])
    || typeof value.id !== "string"
    || value.id.length === 0
    || value.id.length
      > STUDIO_WEIGHTED_DEFORMATION_WORKER_LIMITS.maxIdentifierCharacters
    || ids.has(value.id)
    || value.dimension !== dimension
    || !isFiniteFloat32Array(value.restPoints)
    || !isFiniteFloat32Array(value.deformedPoints)
    || value.restPoints.length === 0
    || value.restPoints.length !== value.deformedPoints.length
    || value.restPoints.length % dimension !== 0
    || typeof value.closed !== "boolean"
    || !isFiniteNumber(value.radius)
    || value.radius <= 0
    || !isFiniteNumber(value.falloff)
    || value.falloff < 0.125
    || value.falloff > 32
    || !isFiniteNumber(value.strength)
    || value.strength < 0
    || value.strength > 8
  ) {
    return "invalid-request";
  }
  const pointCount = value.restPoints.length / dimension;
  if (
    pointCount
      > STUDIO_WEIGHTED_DEFORMATION_WORKER_LIMITS.maxPointsPerSource
    || (value.closed && pointCount < 3)
  ) {
    return "budget-exceeded";
  }
  ids.add(value.id);
  const restPoints = new Float32Array(value.restPoints);
  const deformedPoints = new Float32Array(value.deformedPoints);
  return Object.freeze({
    source: Object.freeze({
      id: value.id,
      dimension,
      restPoints,
      deformedPoints,
      closed: value.closed,
      radius: value.radius,
      falloff: value.falloff,
      strength: value.strength,
    }),
    pointCount,
    segmentCount: sourceSegmentCount(pointCount, value.closed),
    bytes: restPoints.byteLength + deformedPoints.byteLength,
  });
}

/**
 * Strictly validates plain transport data and returns owned typed arrays.
 *
 * AbortSignal is intentionally not part of the wire request. Cancellation is
 * transported as its own protocol message and enforced by Worker termination
 * in the browser client when the synchronous CPU oracle is already running.
 */
export function snapshotStudioWeightedDeformationWorkerRequest(
  value: unknown,
): StudioWeightedDeformationRequestSnapshot {
  if (
    !isPlainRecord(value)
    || !hasOnlyKeys(
      value,
      ["requestEpoch", "currentEpoch", "mesh", "sources"],
      ["maximumWorkUnits"],
    )
    || !isPositiveEpoch(value.requestEpoch)
    || !isPositiveEpoch(value.currentEpoch)
    || (
      value.maximumWorkUnits !== undefined
      && (
        !isPositiveEpoch(value.maximumWorkUnits)
        || value.maximumWorkUnits
          > STUDIO_WEIGHTED_DEFORMATION_WORKER_LIMITS.maxWorkUnits
      )
    )
    || !isPlainRecord(value.mesh)
    || !hasOnlyKeys(
      value.mesh,
      ["dimension", "positions"],
      ["textureCoordinates"],
    )
    || (value.mesh.dimension !== 2 && value.mesh.dimension !== 3)
    || !(value.mesh.positions instanceof Float32Array)
    || !(value.mesh.positions.buffer instanceof ArrayBuffer)
    || value.mesh.positions.length === 0
    || value.mesh.positions.length % value.mesh.dimension !== 0
    || value.mesh.positions.length / value.mesh.dimension
      > STUDIO_WEIGHTED_DEFORMATION_WORKER_LIMITS.maxVertices
    || value.mesh.positions.byteLength
      > STUDIO_WEIGHTED_DEFORMATION_WORKER_LIMITS.maxInputBytes
    || !value.mesh.positions.every((component) => Number.isFinite(component))
    || !Array.isArray(value.sources)
    || value.sources.length === 0
  ) {
    return Object.freeze({ ok: false, reason: "invalid-request" });
  }
  if (
    value.sources.length
      > STUDIO_WEIGHTED_DEFORMATION_WORKER_LIMITS.maxSources
  ) {
    return Object.freeze({ ok: false, reason: "budget-exceeded" });
  }

  const dimension = value.mesh.dimension;
  const vertexCount = value.mesh.positions.length / dimension;
  const positions = new Float32Array(value.mesh.positions);
  let textureCoordinates: Float32Array | undefined;
  if (value.mesh.textureCoordinates !== undefined) {
    if (
      !isFiniteFloat32Array(value.mesh.textureCoordinates)
      || value.mesh.textureCoordinates.length !== vertexCount * 2
    ) {
      return Object.freeze({ ok: false, reason: "invalid-request" });
    }
    textureCoordinates = new Float32Array(value.mesh.textureCoordinates);
  }

  const ids = new Set<string>();
  const sources: StudioWeightedDeformationSource[] = [];
  let totalSourcePoints = 0;
  let totalSegments = 0;
  let inputBytes = positions.byteLength
    + (textureCoordinates?.byteLength ?? 0);
  for (const candidate of value.sources) {
    const copied = copySource(candidate, dimension, ids);
    if (typeof copied === "string") {
      return Object.freeze({ ok: false, reason: copied });
    }
    totalSourcePoints += copied.pointCount;
    totalSegments += copied.segmentCount;
    const nextBytes = addBytes(inputBytes, copied.bytes);
    if (nextBytes === null) {
      return Object.freeze({ ok: false, reason: "budget-exceeded" });
    }
    inputBytes = nextBytes;
    sources.push(copied.source);
  }
  if (
    totalSourcePoints
      > STUDIO_WEIGHTED_DEFORMATION_WORKER_LIMITS.maxTotalSourcePoints
    || inputBytes
      > STUDIO_WEIGHTED_DEFORMATION_WORKER_LIMITS.maxInputBytes
  ) {
    return Object.freeze({ ok: false, reason: "budget-exceeded" });
  }
  const workUnits = vertexCount * totalSegments;
  const maximumWorkUnits = value.maximumWorkUnits
    ?? STUDIO_WEIGHTED_DEFORMATION_WORKER_LIMITS.maxWorkUnits;
  if (
    !Number.isSafeInteger(workUnits)
    || workUnits > maximumWorkUnits
    || workUnits
      > STUDIO_WEIGHTED_DEFORMATION_WORKER_LIMITS.maxWorkUnits
  ) {
    return Object.freeze({ ok: false, reason: "budget-exceeded" });
  }
  const maximumOutputBytes = positions.byteLength
    + (textureCoordinates?.byteLength ?? 0);
  if (
    maximumOutputBytes
      > STUDIO_WEIGHTED_DEFORMATION_WORKER_LIMITS.maxOutputBytes
  ) {
    return Object.freeze({ ok: false, reason: "budget-exceeded" });
  }

  const request: StudioWeightedDeformationWorkerRequest = Object.freeze({
    requestEpoch: value.requestEpoch,
    currentEpoch: value.currentEpoch,
    mesh: Object.freeze({
      dimension,
      positions,
      ...(textureCoordinates === undefined
        ? {}
        : { textureCoordinates }),
    }),
    sources: Object.freeze(sources),
    ...(value.maximumWorkUnits === undefined
      ? {}
      : { maximumWorkUnits: value.maximumWorkUnits }),
  });
  return Object.freeze({
    ok: true,
    request,
    inputBytes,
    maximumOutputBytes,
    workUnits,
    requestSha256: hashStudioWeightedDeformationRequest(request),
    textureCoordinatesSha256: textureCoordinates
      ? hashStudioWeightedDeformationFloat32(textureCoordinates)
      : null,
  });
}

export function studioWeightedDeformationWorkerFailure(
  reason: StudioWeightedDeformationWorkerBoundaryFailureReason,
  detail: string,
): StudioWeightedDeformationWorkerBoundaryFailure {
  const boundedDetail = detail.slice(
    0,
    STUDIO_WEIGHTED_DEFORMATION_WORKER_LIMITS.maxFailureDetailCharacters,
  );
  return Object.freeze({
    status: "worker-failed",
    reason,
    detail: boundedDetail,
    fallback: Object.freeze({
      kind: "studio-weighted-deformation-worker-only",
      execution: "dedicated-worker",
      mainThreadComputationFallback: false,
      complete: false,
      reason,
    }),
  });
}

function isWorkerFailureReason(
  value: unknown,
): value is StudioWeightedDeformationWorkerBoundaryFailureReason {
  return (
    value === "backpressure"
    || value === "disposed"
    || value === "execution-failed"
    || value === "invalid-message"
    || value === "operation-timeout"
    || value === "protocol-error"
    || value === "startup-timeout"
    || value === "worker-unavailable"
  );
}

function copyWorkerFailure(
  value: unknown,
): StudioWeightedDeformationWorkerBoundaryFailure | null {
  if (
    !isPlainRecord(value)
    || !hasOnlyKeys(value, ["status", "reason", "detail", "fallback"])
    || value.status !== "worker-failed"
    || !isWorkerFailureReason(value.reason)
    || typeof value.detail !== "string"
    || value.detail.length
      > STUDIO_WEIGHTED_DEFORMATION_WORKER_LIMITS.maxFailureDetailCharacters
    || !isPlainRecord(value.fallback)
    || !hasOnlyKeys(value.fallback, [
      "kind",
      "execution",
      "mainThreadComputationFallback",
      "complete",
      "reason",
    ])
    || value.fallback.kind
      !== "studio-weighted-deformation-worker-only"
    || value.fallback.execution !== "dedicated-worker"
    || value.fallback.mainThreadComputationFallback !== false
    || value.fallback.complete !== false
    || value.fallback.reason !== value.reason
  ) {
    return null;
  }
  return studioWeightedDeformationWorkerFailure(value.reason, value.detail);
}

function isProviderFailureReason(
  value: unknown,
): value is StudioWeightedDeformationFailureReason {
  return (
    value === "invalid-request"
    || value === "budget-exceeded"
    || value === "stale-epoch"
  );
}

function copyReceipt(
  value: unknown,
  vertexCount: number,
  sourceCountMaximum: number,
): StudioWeightedDeformationReceipt | null {
  if (
    !isPlainRecord(value)
    || !hasOnlyKeys(value, [
      "kind",
      "version",
      "backend",
      "algorithm",
      "vertexCount",
      "sourceCount",
      "sourcePointCount",
      "workUnits",
      "influencedVertices",
      "untouchedVertices",
      "maximumDisplacement",
      "textureCoordinatePolicy",
      "requestSha256",
      "positionsSha256",
      "textureCoordinatesSha256",
      "complete",
    ])
    || value.kind !== "studio-weighted-deformation-receipt"
    || value.version !== 1
    || value.backend !== "cpu-f32-oracle"
    || value.algorithm !== "normalized-compact-distance-polyline-v1"
    || value.vertexCount !== vertexCount
    || !Number.isSafeInteger(value.sourceCount)
    || (value.sourceCount as number) <= 0
    || (value.sourceCount as number) > sourceCountMaximum
    || !Number.isSafeInteger(value.sourcePointCount)
    || (value.sourcePointCount as number) <= 0
    || (value.sourcePointCount as number)
      > STUDIO_WEIGHTED_DEFORMATION_WORKER_LIMITS.maxTotalSourcePoints
    || !Number.isSafeInteger(value.workUnits)
    || (value.workUnits as number) <= 0
    || (value.workUnits as number)
      > STUDIO_WEIGHTED_DEFORMATION_WORKER_LIMITS.maxWorkUnits
    || !Number.isSafeInteger(value.influencedVertices)
    || (value.influencedVertices as number) < 0
    || !Number.isSafeInteger(value.untouchedVertices)
    || (value.untouchedVertices as number) < 0
    || (value.influencedVertices as number)
      + (value.untouchedVertices as number) !== vertexCount
    || !isFiniteNumber(value.maximumDisplacement)
    || value.maximumDisplacement < 0
    || value.textureCoordinatePolicy !== "copied-unchanged"
    || typeof value.requestSha256 !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(value.requestSha256)
    || typeof value.positionsSha256 !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(value.positionsSha256)
    || !(
      value.textureCoordinatesSha256 === null
      || (
        typeof value.textureCoordinatesSha256 === "string"
        && /^sha256:[0-9a-f]{64}$/u.test(
          value.textureCoordinatesSha256,
        )
      )
    )
    || value.complete !== true
  ) {
    return null;
  }
  return Object.freeze({
    kind: "studio-weighted-deformation-receipt",
    version: 1,
    backend: "cpu-f32-oracle",
    algorithm: "normalized-compact-distance-polyline-v1",
    vertexCount,
    sourceCount: value.sourceCount as number,
    sourcePointCount: value.sourcePointCount as number,
    workUnits: value.workUnits as number,
    influencedVertices: value.influencedVertices as number,
    untouchedVertices: value.untouchedVertices as number,
    maximumDisplacement: value.maximumDisplacement,
    textureCoordinatePolicy: "copied-unchanged",
    requestSha256: value.requestSha256 as `sha256:${string}`,
    positionsSha256: value.positionsSha256 as `sha256:${string}`,
    textureCoordinatesSha256:
      value.textureCoordinatesSha256 as `sha256:${string}` | null,
    complete: true,
  });
}

function copyCompletedResult(
  value: Readonly<Record<string, unknown>>,
): StudioWeightedDeformationResult | null {
  if (
    !hasOnlyKeys(value, ["status", "artifact"])
    || value.status !== "completed"
    || !isPlainRecord(value.artifact)
    || !hasOnlyKeys(
      value.artifact,
      ["kind", "version", "dimension", "positions", "receipt"],
      ["textureCoordinates"],
    )
    || value.artifact.kind !== "studio-weighted-deformation-artifact"
    || value.artifact.version !== 1
    || (
      value.artifact.dimension !== 2
      && value.artifact.dimension !== 3
    )
    || !isFiniteFloat32Array(value.artifact.positions)
    || value.artifact.positions.length === 0
    || value.artifact.positions.length % value.artifact.dimension !== 0
  ) {
    return null;
  }
  const dimension = value.artifact.dimension;
  const positions = new Float32Array(value.artifact.positions);
  const vertexCount = positions.length / dimension;
  if (
    vertexCount > STUDIO_WEIGHTED_DEFORMATION_WORKER_LIMITS.maxVertices
  ) {
    return null;
  }
  let textureCoordinates: Float32Array | undefined;
  if (value.artifact.textureCoordinates !== undefined) {
    if (
      !isFiniteFloat32Array(value.artifact.textureCoordinates)
      || value.artifact.textureCoordinates.length !== vertexCount * 2
    ) {
      return null;
    }
    textureCoordinates = new Float32Array(
      value.artifact.textureCoordinates,
    );
  }
  const outputBytes = positions.byteLength
    + (textureCoordinates?.byteLength ?? 0);
  if (
    outputBytes > STUDIO_WEIGHTED_DEFORMATION_WORKER_LIMITS.maxOutputBytes
  ) {
    return null;
  }
  const receipt = copyReceipt(
    value.artifact.receipt,
    vertexCount,
    STUDIO_WEIGHTED_DEFORMATION_WORKER_LIMITS.maxSources,
  );
  if (receipt === null) return null;
  if (
    receipt.positionsSha256
      !== hashStudioWeightedDeformationFloat32(positions)
    || receipt.textureCoordinatesSha256
      !== (
        textureCoordinates
          ? hashStudioWeightedDeformationFloat32(textureCoordinates)
          : null
      )
  ) return null;
  const artifact: StudioWeightedDeformationArtifact = Object.freeze({
    kind: "studio-weighted-deformation-artifact",
    version: 1,
    dimension,
    positions,
    ...(textureCoordinates === undefined ? {} : { textureCoordinates }),
    receipt,
  });
  return Object.freeze({ status: "completed", artifact });
}

/**
 * Validates Worker output and returns newly owned typed arrays so a WorkerLike
 * implementation cannot retain mutable aliases after delivery.
 */
export function snapshotStudioWeightedDeformationWorkerResult(
  value: unknown,
): StudioWeightedDeformationWorkerResult | null {
  if (!isPlainRecord(value) || typeof value.status !== "string") return null;
  if (value.status === "completed") return copyCompletedResult(value);
  if (
    value.status === "cancelled"
    && hasOnlyKeys(value, ["status"])
  ) {
    return Object.freeze({ status: "cancelled" });
  }
  if (
    value.status === "rejected"
    && hasOnlyKeys(value, ["status", "reason"])
    && isProviderFailureReason(value.reason)
  ) {
    return Object.freeze({
      status: "rejected",
      reason: value.reason,
    });
  }
  if (value.status === "worker-failed") return copyWorkerFailure(value);
  return null;
}

export function snapshotStudioWeightedDeformationWorkerInboundMessage(
  value: unknown,
): StudioWeightedDeformationWorkerInboundMessage | null {
  if (
    !isPlainRecord(value)
    || value.version
      !== STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION
  ) {
    return null;
  }
  if (value.type === "studio-weighted-deformation/execute") {
    if (
      !hasOnlyKeys(value, ["type", "version", "requestId", "request"])
      || !isRequestId(value.requestId)
    ) {
      return null;
    }
    const snapshot = snapshotStudioWeightedDeformationWorkerRequest(
      value.request,
    );
    return snapshot.ok
      ? Object.freeze({
          type: "studio-weighted-deformation/execute",
          version: STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
          requestId: value.requestId,
          request: snapshot.request,
        })
      : null;
  }
  if (value.type === "studio-weighted-deformation/cancel") {
    return (
      hasOnlyKeys(value, ["type", "version", "requestId"])
      && isRequestId(value.requestId)
    )
      ? Object.freeze({
          type: "studio-weighted-deformation/cancel",
          version: STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
          requestId: value.requestId,
        })
      : null;
  }
  if (value.type === "studio-weighted-deformation/advance-epoch") {
    return (
      hasOnlyKeys(value, ["type", "version", "currentEpoch"])
      && isPositiveEpoch(value.currentEpoch)
    )
      ? Object.freeze({
          type: "studio-weighted-deformation/advance-epoch",
          version: STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
          currentEpoch: value.currentEpoch,
        })
      : null;
  }
  return null;
}

export function isStudioWeightedDeformationWorkerInboundMessage(
  value: unknown,
): value is StudioWeightedDeformationWorkerInboundMessage {
  return snapshotStudioWeightedDeformationWorkerInboundMessage(value) !== null;
}

export function snapshotStudioWeightedDeformationWorkerOutboundMessage(
  value: unknown,
): StudioWeightedDeformationWorkerOutboundMessage | null {
  if (
    !isPlainRecord(value)
    || value.version
      !== STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION
  ) {
    return null;
  }
  if (value.type === "studio-weighted-deformation/ready") {
    return (
      hasOnlyKeys(value, ["type", "version", "currentEpoch"])
      && isNonNegativeEpoch(value.currentEpoch)
    )
      ? Object.freeze({
          type: "studio-weighted-deformation/ready",
          version: STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
          currentEpoch: value.currentEpoch,
        })
      : null;
  }
  if (
    value.type !== "studio-weighted-deformation/result"
    || !hasOnlyKeys(value, [
      "type",
      "version",
      "requestId",
      "requestEpoch",
      "result",
    ])
    || !isRequestId(value.requestId)
    || !isPositiveEpoch(value.requestEpoch)
  ) {
    return null;
  }
  const result = snapshotStudioWeightedDeformationWorkerResult(value.result);
  return result === null
    ? null
    : Object.freeze({
        type: "studio-weighted-deformation/result",
        version: STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
        requestId: value.requestId,
        requestEpoch: value.requestEpoch,
        result,
      });
}

export function isStudioWeightedDeformationWorkerOutboundMessage(
  value: unknown,
): value is StudioWeightedDeformationWorkerOutboundMessage {
  return snapshotStudioWeightedDeformationWorkerOutboundMessage(value)
    !== null;
}

function transferableBuffer(view: ArrayBufferView): ArrayBuffer | null {
  if (
    !(view.buffer instanceof ArrayBuffer)
    || view.byteOffset !== 0
    || view.byteLength !== view.buffer.byteLength
  ) {
    return null;
  }
  return view.buffer;
}

export function studioWeightedDeformationRequestTransfers(
  message: StudioWeightedDeformationWorkerExecuteMessage,
): Transferable[] {
  const buffers: ArrayBuffer[] = [];
  const append = (view: ArrayBufferView | undefined): void => {
    if (view === undefined) return;
    const buffer = transferableBuffer(view);
    if (buffer !== null) buffers.push(buffer);
  };
  append(message.request.mesh.positions);
  append(message.request.mesh.textureCoordinates);
  for (const source of message.request.sources) {
    append(source.restPoints);
    append(source.deformedPoints);
  }
  return [...new Set(buffers)];
}

export function studioWeightedDeformationResultTransfers(
  message: StudioWeightedDeformationWorkerResultMessage,
): Transferable[] {
  if (message.result.status !== "completed") return [];
  const buffers: ArrayBuffer[] = [];
  const positions = transferableBuffer(message.result.artifact.positions);
  if (positions !== null) buffers.push(positions);
  const textureCoordinates = message.result.artifact.textureCoordinates;
  if (textureCoordinates !== undefined) {
    const textureBuffer = transferableBuffer(textureCoordinates);
    if (textureBuffer !== null) buffers.push(textureBuffer);
  }
  return [...new Set(buffers)];
}
