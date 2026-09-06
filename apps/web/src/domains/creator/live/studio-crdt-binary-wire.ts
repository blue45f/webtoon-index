import {
  decodeStudioCrdtStateVector,
  decodeStudioCrdtUpdate,
  encodeStudioCrdtStateVector,
  encodeStudioCrdtSyncChunks,
  encodeStudioCrdtUpdate,
  parseStudioCrdtRemoteUpdate,
  parseStudioCrdtSyncResponse,
  parseStudioCrdtUpdateAck,
  STUDIO_CRDT_PROTOCOL_VERSION,
  type StudioCrdtRemoteUpdate,
  type StudioCrdtSyncRequest,
  type StudioCrdtSyncResponse,
  type StudioCrdtUpdateAck,
  type StudioCrdtUpdateRequest,
} from "./studio-crdt-protocol";

import {
  decodeStudioCrdtBinaryEnvelope,
  encodeStudioCrdtBinaryEnvelope,
  reassembleStudioCrdtBinarySyncEnvelope,
} from "@/shared/lib/studio-crdt-binary-envelope";

export const STUDIO_CRDT_BINARY_WIRE_VERSION = 1 as const;
export const STUDIO_CRDT_BINARY_WIRE_FORMAT = "binary-v1" as const;
export const STUDIO_CRDT_LEGACY_WIRE_FORMAT = "base64-v4" as const;
export const STUDIO_CRDT_SUPPORTED_WIRE_FORMATS = [
  STUDIO_CRDT_BINARY_WIRE_FORMAT,
  STUDIO_CRDT_LEGACY_WIRE_FORMAT,
] as const;

export const STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT = "studio:crdt:wire:select" as const;
export const STUDIO_LIVE_CRDT_BINARY_SYNC_EVENT =
  "studio:crdt:sync:binary:v1" as const;
export const STUDIO_LIVE_CRDT_BINARY_UPDATE_EVENT =
  "studio:crdt:update:binary:v1" as const;
export const STUDIO_LIVE_CRDT_BINARY_REMOTE_EVENT =
  "studio:crdt:remote:binary:v1" as const;

export type StudioCrdtWireFormat =
  (typeof STUDIO_CRDT_SUPPORTED_WIRE_FORMATS)[number];

export interface StudioCrdtWireAdvertisement {
  formats: typeof STUDIO_CRDT_SUPPORTED_WIRE_FORMATS;
  selectionEpoch: string;
}

export interface StudioCrdtBinarySelectionRequest {
  protocolVersion: typeof STUDIO_CRDT_PROTOCOL_VERSION;
  wireVersion: typeof STUDIO_CRDT_BINARY_WIRE_VERSION;
  workId: string;
  format: typeof STUDIO_CRDT_BINARY_WIRE_FORMAT;
  selectionEpoch: string;
}

export interface StudioCrdtBinarySyncRequest {
  protocolVersion: typeof STUDIO_CRDT_PROTOCOL_VERSION;
  wireVersion: typeof STUDIO_CRDT_BINARY_WIRE_VERSION;
  workId: string;
  requestId: string;
  stateVector: Uint8Array;
}

export interface StudioCrdtBinaryUpdateRequest {
  protocolVersion: typeof STUDIO_CRDT_PROTOCOL_VERSION;
  wireVersion: typeof STUDIO_CRDT_BINARY_WIRE_VERSION;
  workId: string;
  updateId: string;
  clientSequence: number;
  update: Uint8Array;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const ownKeys = Object.keys(value);
  return ownKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function hasBinaryCommonContract(
  value: Record<string, unknown>,
  expectedWorkId: string
): boolean {
  return (
    value.protocolVersion === STUDIO_CRDT_PROTOCOL_VERSION &&
    value.wireVersion === STUDIO_CRDT_BINARY_WIRE_VERSION &&
    value.workId === expectedWorkId
  );
}

export function parseStudioCrdtWireAdvertisement(
  value: Record<string, unknown>
): StudioCrdtWireAdvertisement | null | false {
  const formats = value.crdtWireFormats;
  const selectionEpoch = value.crdtWireSelectionEpoch;
  if (formats === undefined && selectionEpoch === undefined) return null;
  if (
    !Array.isArray(formats) ||
    formats.length !== STUDIO_CRDT_SUPPORTED_WIRE_FORMATS.length ||
    formats.some(
      (format, index) => format !== STUDIO_CRDT_SUPPORTED_WIRE_FORMATS[index]
    ) ||
    !isUuid(selectionEpoch)
  ) {
    return false;
  }
  return {
    formats: STUDIO_CRDT_SUPPORTED_WIRE_FORMATS,
    selectionEpoch,
  };
}

export function createStudioCrdtBinarySelectionRequest(
  workId: string,
  selectionEpoch: string
): StudioCrdtBinarySelectionRequest {
  return {
    protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
    wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
    workId,
    format: STUDIO_CRDT_BINARY_WIRE_FORMAT,
    selectionEpoch,
  };
}

export function parseStudioCrdtBinarySelection(
  value: unknown,
  expected: { workId: string; selectionEpoch: string }
): StudioCrdtBinarySelectionRequest & { selected: true } | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "protocolVersion",
      "wireVersion",
      "workId",
      "format",
      "selectionEpoch",
      "selected",
    ]) ||
    !hasBinaryCommonContract(value, expected.workId) ||
    value.format !== STUDIO_CRDT_BINARY_WIRE_FORMAT ||
    value.selectionEpoch !== expected.selectionEpoch ||
    !isUuid(value.selectionEpoch) ||
    value.selected !== true
  ) {
    return null;
  }
  return value as unknown as StudioCrdtBinarySelectionRequest & { selected: true };
}

export function createStudioCrdtBinarySyncRequest(
  request: StudioCrdtSyncRequest
): StudioCrdtBinarySyncRequest {
  return {
    protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
    wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
    workId: request.workId,
    requestId: request.requestId,
    stateVector: encodeStudioCrdtBinaryEnvelope(
      "state-vector",
      decodeStudioCrdtStateVector(request.stateVector)
    ),
  };
}

export function parseStudioCrdtBinarySyncResponse(
  value: unknown,
  options: { expectedWorkId: string }
): StudioCrdtSyncResponse | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "protocolVersion",
      "wireVersion",
      "workId",
      "requestId",
      "transferId",
      "fragments",
      "fragmentCount",
      "wireBytes",
      "totalBytes",
      "serverStateVector",
      "serverSequence",
    ]) ||
    !hasBinaryCommonContract(value, options.expectedWorkId) ||
    !Array.isArray(value.fragments) ||
    typeof value.fragmentCount !== "number" ||
    !Number.isSafeInteger(value.fragmentCount) ||
    value.fragmentCount !== value.fragments.length ||
    typeof value.wireBytes !== "number" ||
    !Number.isSafeInteger(value.wireBytes) ||
    typeof value.totalBytes !== "number" ||
    !Number.isSafeInteger(value.totalBytes)
  ) {
    return null;
  }

  try {
    const envelope = reassembleStudioCrdtBinarySyncEnvelope(
      value.fragments,
      value.wireBytes
    );
    const diff = decodeStudioCrdtBinaryEnvelope(envelope, "sync-diff").bytes;
    if (diff.byteLength !== value.totalBytes) return null;
    const serverStateVector = decodeStudioCrdtBinaryEnvelope(
      value.serverStateVector,
      "state-vector"
    ).bytes;
    const chunks = encodeStudioCrdtSyncChunks(diff);
    return parseStudioCrdtSyncResponse(
      {
        protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
        workId: value.workId,
        requestId: value.requestId,
        transferId: value.transferId,
        chunks,
        chunkCount: chunks.length,
        totalBytes: diff.byteLength,
        serverStateVector: encodeStudioCrdtStateVector(serverStateVector),
        serverSequence: value.serverSequence,
      },
      options
    );
  } catch {
    return null;
  }
}

export function createStudioCrdtBinaryUpdateRequest(
  request: StudioCrdtUpdateRequest
): StudioCrdtBinaryUpdateRequest {
  return {
    protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
    wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
    workId: request.workId,
    updateId: request.updateId,
    clientSequence: request.clientSequence,
    update: encodeStudioCrdtBinaryEnvelope(
      "update",
      decodeStudioCrdtUpdate(request.update)
    ),
  };
}

export function parseStudioCrdtBinaryUpdateAck(
  value: unknown,
  options: { expectedWorkId: string }
): StudioCrdtUpdateAck | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "protocolVersion",
      "wireVersion",
      "workId",
      "updateId",
      "serverSequence",
      "duplicate",
    ]) ||
    !hasBinaryCommonContract(value, options.expectedWorkId)
  ) {
    return null;
  }
  return parseStudioCrdtUpdateAck(
    {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: value.workId,
      updateId: value.updateId,
      serverSequence: value.serverSequence,
      serverStateVector: null,
      duplicate: value.duplicate,
    },
    options
  );
}

export function parseStudioCrdtBinaryRemoteUpdate(
  value: unknown,
  options: { expectedWorkId: string }
): StudioCrdtRemoteUpdate | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "protocolVersion",
      "wireVersion",
      "workId",
      "updateId",
      "serverSequence",
      "update",
    ]) ||
    !hasBinaryCommonContract(value, options.expectedWorkId)
  ) {
    return null;
  }
  try {
    const update = decodeStudioCrdtBinaryEnvelope(value.update, "update").bytes;
    return parseStudioCrdtRemoteUpdate(
      {
        protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
        workId: value.workId,
        updateId: value.updateId,
        serverSequence: value.serverSequence,
        update: encodeStudioCrdtUpdate(update),
      },
      options
    );
  } catch {
    return null;
  }
}
