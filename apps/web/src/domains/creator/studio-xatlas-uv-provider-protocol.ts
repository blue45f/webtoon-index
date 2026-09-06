import { sha256HexPortable } from "./studio-sha256";

import type {
  StudioXAtlasUvProviderLimits,
  StudioXAtlasUvRequest,
  StudioXAtlasUvResult,
  StudioXAtlasUvRuntimeAssets,
} from "./studio-xatlas-uv-provider";

export const STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION = 1 as const;

export interface StudioXAtlasUvWorkerConfigureMessage {
  readonly type: "studio-xatlas-uv/configure";
  readonly version: typeof STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION;
  readonly requestEpoch: number;
  readonly documentEpoch: number;
  readonly runtimeAssets?: StudioXAtlasUvRuntimeAssets;
  readonly limits?: StudioXAtlasUvProviderLimits;
}

export interface StudioXAtlasUvWorkerExecuteMessage {
  readonly type: "studio-xatlas-uv/execute";
  readonly version: typeof STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly request: StudioXAtlasUvRequest;
}

export interface StudioXAtlasUvWorkerCancelMessage {
  readonly type: "studio-xatlas-uv/cancel";
  readonly version: typeof STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION;
  readonly requestId: string;
}

export interface StudioXAtlasUvWorkerAdvanceEpochsMessage {
  readonly type: "studio-xatlas-uv/advance-epochs";
  readonly version: typeof STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION;
  readonly requestEpoch: number;
  readonly documentEpoch: number;
}

export type StudioXAtlasUvWorkerInboundMessage =
  | StudioXAtlasUvWorkerConfigureMessage
  | StudioXAtlasUvWorkerExecuteMessage
  | StudioXAtlasUvWorkerCancelMessage
  | StudioXAtlasUvWorkerAdvanceEpochsMessage;

export interface StudioXAtlasUvWorkerReadyMessage {
  readonly type: "studio-xatlas-uv/ready";
  readonly version: typeof STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION;
}

export interface StudioXAtlasUvWorkerStartupFailureMessage {
  readonly type: "studio-xatlas-uv/startup-failure";
  readonly version: typeof STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION;
  readonly detail: string;
}

export interface StudioXAtlasUvWorkerProgressMessage {
  readonly type: "studio-xatlas-uv/progress";
  readonly version: typeof STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly sequence: number;
  readonly mode: string;
  readonly progress: number;
}

export interface StudioXAtlasUvWorkerResultMessage {
  readonly type: "studio-xatlas-uv/result";
  readonly version: typeof STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly result: StudioXAtlasUvResult;
  readonly binding?: StudioXAtlasUvWorkerResultBinding;
}

export interface StudioXAtlasUvWorkerResultBinding {
  readonly requestEpoch: number;
  readonly documentEpoch: number;
  readonly requestHash: `sha256:${string}`;
  readonly resultHash: `sha256:${string}`;
}

export type StudioXAtlasUvWorkerOutboundMessage =
  | StudioXAtlasUvWorkerReadyMessage
  | StudioXAtlasUvWorkerStartupFailureMessage
  | StudioXAtlasUvWorkerProgressMessage
  | StudioXAtlasUvWorkerResultMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return keys.length >= required.length
    && keys.length <= required.length + optional.length
    && required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function isEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isRequestId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function isSha256(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function bytesHash(value: ArrayBufferView): `sha256:${string}` {
  return `sha256:${sha256HexPortable(
    new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
  )}`;
}

function jsonHash(value: unknown): `sha256:${string}` {
  return `sha256:${sha256HexPortable(
    new TextEncoder().encode(JSON.stringify(value)),
  )}`;
}

export function studioXAtlasUvRequestHash(
  request: StudioXAtlasUvRequest,
): `sha256:${string}` {
  return jsonHash({
    operation: request.operation,
    requestEpoch: request.requestEpoch,
    documentEpoch: request.documentEpoch,
    meshes: request.meshes.map((mesh) => ({
      id: mesh.id,
      positions: bytesHash(mesh.positions),
      indices: bytesHash(mesh.indices),
      normals: mesh.normals === undefined ? null : bytesHash(mesh.normals),
      uv: mesh.uv === undefined ? null : bytesHash(mesh.uv),
    })),
    options: request.options ?? null,
  });
}

export function studioXAtlasUvResultHash(
  result: Extract<StudioXAtlasUvResult, { readonly ok: true }>,
): `sha256:${string}` {
  const { artifact } = result;
  return jsonHash({
    kind: artifact.kind,
    version: artifact.version,
    positions: bytesHash(artifact.positions),
    uv: bytesHash(artifact.uv),
    indices: bytesHash(artifact.indices),
    meshes: artifact.meshes,
    atlas: artifact.atlas,
    receipt: artifact.receipt,
  });
}

function isRuntimeAssets(value: unknown): value is StudioXAtlasUvRuntimeAssets {
  return isRecord(value)
    && exactKeys(value, ["wasmUrl", "moduleUrl"])
    && typeof value.wasmUrl === "string"
    && typeof value.moduleUrl === "string";
}

export function isStudioXAtlasUvWorkerInboundMessage(
  value: unknown,
): value is StudioXAtlasUvWorkerInboundMessage {
  if (
    !isRecord(value)
    || value.version !== STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION
    || typeof value.type !== "string"
  ) {
    return false;
  }
  if (value.type === "studio-xatlas-uv/configure") {
    return exactKeys(
      value,
      ["type", "version", "requestEpoch", "documentEpoch"],
      ["runtimeAssets", "limits"],
    )
      && isEpoch(value.requestEpoch)
      && isEpoch(value.documentEpoch)
      && (value.runtimeAssets === undefined || isRuntimeAssets(value.runtimeAssets))
      && (value.limits === undefined || isRecord(value.limits));
  }
  if (value.type === "studio-xatlas-uv/execute") {
    return exactKeys(value, ["type", "version", "requestId", "request"])
      && isRequestId(value.requestId)
      && isRecord(value.request);
  }
  if (value.type === "studio-xatlas-uv/cancel") {
    return exactKeys(value, ["type", "version", "requestId"])
      && isRequestId(value.requestId);
  }
  if (value.type === "studio-xatlas-uv/advance-epochs") {
    return exactKeys(value, ["type", "version", "requestEpoch", "documentEpoch"])
      && isEpoch(value.requestEpoch)
      && isEpoch(value.documentEpoch);
  }
  return false;
}

function isFallback(value: unknown): boolean {
  return isRecord(value)
    && exactKeys(
      value,
      [
        "kind",
        "workerAvailable",
        "mainThreadFallback",
        "originalInputPreserved",
        "reason",
      ],
    )
    && value.kind === "no-fallback"
    && value.workerAvailable === false
    && value.mainThreadFallback === false
    && value.originalInputPreserved === true
    && typeof value.reason === "string";
}

function isFailure(value: unknown): boolean {
  return isRecord(value)
    && exactKeys(value, ["ok", "reason", "detail"], ["fallback"])
    && value.ok === false
    && typeof value.reason === "string"
    && typeof value.detail === "string"
    && (value.fallback === undefined || isFallback(value.fallback));
}

function finiteInteger(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function isAtlasSegment(value: unknown): boolean {
  return isRecord(value)
    && exactKeys(value, ["indexOffset", "indexCount", "atlasIndex"])
    && finiteInteger(value.indexOffset)
    && finiteInteger(value.indexCount, 1)
    && finiteInteger(value.atlasIndex);
}

function isMeshRange(value: unknown): boolean {
  return isRecord(value)
    && exactKeys(
      value,
      [
        "id",
        "sourceVertexCount",
        "vertexOffset",
        "vertexCount",
        "indexOffset",
        "indexCount",
        "atlasSegments",
      ],
    )
    && typeof value.id === "string"
    && finiteInteger(value.sourceVertexCount, 1)
    && finiteInteger(value.vertexOffset)
    && finiteInteger(value.vertexCount, 1)
    && finiteInteger(value.indexOffset)
    && finiteInteger(value.indexCount, 1)
    && Array.isArray(value.atlasSegments)
    && value.atlasSegments.every(isAtlasSegment);
}

function isAtlasReceipt(value: unknown): boolean {
  return isRecord(value)
    && exactKeys(value, ["width", "height", "count", "texelsPerUnit"])
    && finiteInteger(value.width, 1)
    && finiteInteger(value.height, 1)
    && finiteInteger(value.count, 1)
    && typeof value.texelsPerUnit === "number"
    && Number.isFinite(value.texelsPerUnit)
    && value.texelsPerUnit > 0;
}

function isCapabilityReceipt(value: unknown): boolean {
  return isRecord(value)
    && exactKeys(
      value,
      [
        "packageName",
        "packageVersion",
        "runtimeSource",
        "intendedHost",
        "executionTopology",
        "rendererNeutral",
        "defensiveInputCopy",
        "defensiveOutputCopy",
        "originalInputPreserved",
        "nativeHandlesReturned",
        "mainThreadFallback",
        "atlasCleanup",
        "geometryCleanup",
        "wasmCleanup",
      ],
    )
    && value.packageName === "xatlasjs"
    && typeof value.packageVersion === "string"
    && (value.runtimeSource === "package-dynamic-import" || value.runtimeSource === "injected")
    && value.intendedHost === "dedicated-worker"
    && value.executionTopology === "single-dedicated-worker"
    && value.rendererNeutral === true
    && value.defensiveInputCopy === true
    && value.defensiveOutputCopy === true
    && value.originalInputPreserved === true
    && value.nativeHandlesReturned === false
    && value.mainThreadFallback === false
    && value.atlasCleanup === "direct-destroyAtlas-finally"
    && value.geometryCleanup === "release-typed-array-snapshots"
    && value.wasmCleanup === "dedicated-worker-termination";
}

function isSuccess(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, ["ok", "artifact"]) || value.ok !== true) {
    return false;
  }
  const artifact = value.artifact;
  return isRecord(artifact)
    && exactKeys(
      artifact,
      ["kind", "version", "positions", "uv", "indices", "meshes", "atlas", "receipt"],
    )
    && artifact.kind === "studio-xatlas-uv-atlas"
    && artifact.version === STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION
    && artifact.positions instanceof Float32Array
    && artifact.uv instanceof Float32Array
    && artifact.indices instanceof Uint32Array
    && Array.isArray(artifact.meshes)
    && artifact.meshes.every(isMeshRange)
    && isAtlasReceipt(artifact.atlas)
    && isCapabilityReceipt(artifact.receipt);
}

function isResultBinding(value: unknown): value is StudioXAtlasUvWorkerResultBinding {
  return isRecord(value)
    && exactKeys(
      value,
      ["requestEpoch", "documentEpoch", "requestHash", "resultHash"],
    )
    && isEpoch(value.requestEpoch)
    && isEpoch(value.documentEpoch)
    && isSha256(value.requestHash)
    && isSha256(value.resultHash);
}

export function isStudioXAtlasUvResult(value: unknown): value is StudioXAtlasUvResult {
  return isFailure(value) || isSuccess(value);
}

export function isStudioXAtlasUvWorkerOutboundMessage(
  value: unknown,
): value is StudioXAtlasUvWorkerOutboundMessage {
  if (
    !isRecord(value)
    || value.version !== STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION
    || typeof value.type !== "string"
  ) {
    return false;
  }
  if (value.type === "studio-xatlas-uv/ready") {
    return exactKeys(value, ["type", "version"]);
  }
  if (value.type === "studio-xatlas-uv/startup-failure") {
    return exactKeys(value, ["type", "version", "detail"])
      && typeof value.detail === "string";
  }
  if (value.type === "studio-xatlas-uv/progress") {
    return exactKeys(
      value,
      ["type", "version", "requestId", "sequence", "mode", "progress"],
    )
      && isRequestId(value.requestId)
      && finiteInteger(value.sequence, 1)
      && typeof value.mode === "string"
      && typeof value.progress === "number"
      && Number.isFinite(value.progress)
      && value.progress >= 0
      && value.progress <= 1;
  }
  if (value.type === "studio-xatlas-uv/result") {
    return exactKeys(value, ["type", "version", "requestId", "result"], ["binding"])
      && isRequestId(value.requestId)
      && isStudioXAtlasUvResult(value.result)
      && (
        value.result.ok
          ? isResultBinding(value.binding)
          : value.binding === undefined
      );
  }
  return false;
}

function addBuffer(buffers: Set<ArrayBuffer>, view: ArrayBufferView): void {
  if (view.buffer instanceof ArrayBuffer) buffers.add(view.buffer);
}

export function studioXAtlasUvRequestTransfers(
  request: StudioXAtlasUvRequest,
): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  for (const mesh of request.meshes) {
    addBuffer(buffers, mesh.positions);
    addBuffer(buffers, mesh.indices);
    if (mesh.normals !== undefined) addBuffer(buffers, mesh.normals);
    if (mesh.uv !== undefined) addBuffer(buffers, mesh.uv);
  }
  return [...buffers];
}

export function studioXAtlasUvResultTransfers(result: StudioXAtlasUvResult): Transferable[] {
  if (!result.ok) return [];
  const buffers = new Set<ArrayBuffer>();
  addBuffer(buffers, result.artifact.positions);
  addBuffer(buffers, result.artifact.uv);
  addBuffer(buffers, result.artifact.indices);
  return [...buffers];
}
