/**
 * Transport-only envelope for raw Yjs bytes.
 *
 * The CRDT document protocol remains versioned separately. This envelope exists so Socket.IO can
 * carry owned binary payloads without Base64 expansion while still failing closed on truncated,
 * reordered, or cross-kind data.
 */

export const STUDIO_CRDT_BINARY_ENVELOPE_VERSION = 1 as const;
export const STUDIO_CRDT_BINARY_HEADER_BYTES = 24 as const;
export const STUDIO_CRDT_BINARY_SYNC_FRAGMENT_MAX_BYTES = 40 * 1_024;
export const STUDIO_CRDT_BINARY_UPDATE_MAX_BYTES = 48 * 1_024;
export const STUDIO_CRDT_BINARY_STATE_VECTOR_MAX_BYTES = 256 * 1_024;
export const STUDIO_CRDT_BINARY_SYNC_MAX_BYTES = 16 * 1_024 * 1_024;
export const STUDIO_CRDT_BINARY_SYNC_MAX_FRAGMENTS = Math.ceil(
  (STUDIO_CRDT_BINARY_SYNC_MAX_BYTES + STUDIO_CRDT_BINARY_HEADER_BYTES) /
    STUDIO_CRDT_BINARY_SYNC_FRAGMENT_MAX_BYTES
);

const MAGIC = Uint8Array.of(0x54, 0x53, 0x43, 0x52);
const CRC32_POLYNOMIAL = 0xedb8_8320;
const UINT32_MAX = 0xffff_ffff;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? CRC32_POLYNOMIAL ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const KIND_CODE = {
  update: 1,
  "state-vector": 2,
  "sync-diff": 3,
} as const;

const CODE_KIND = {
  1: "update",
  2: "state-vector",
  3: "sync-diff",
} as const;

export type StudioCrdtBinaryEnvelopeKind = keyof typeof KIND_CODE;
export type StudioCrdtBinaryEnvelopeCodec = "identity";
export type StudioCrdtBinarySource = ArrayBuffer | Uint8Array;

export interface StudioCrdtDecodedBinaryEnvelope {
  kind: StudioCrdtBinaryEnvelopeKind;
  codec: StudioCrdtBinaryEnvelopeCodec;
  bytes: Uint8Array;
}

export class StudioCrdtBinaryEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioCrdtBinaryEnvelopeError";
  }
}

function kindMaximumBytes(kind: StudioCrdtBinaryEnvelopeKind): number {
  switch (kind) {
    case "update":
      return STUDIO_CRDT_BINARY_UPDATE_MAX_BYTES;
    case "state-vector":
      return STUDIO_CRDT_BINARY_STATE_VECTOR_MAX_BYTES;
    case "sync-diff":
      return STUDIO_CRDT_BINARY_SYNC_MAX_BYTES;
  }
}

function isSharedArrayBuffer(value: unknown): boolean {
  return Object.prototype.toString.call(value) === "[object SharedArrayBuffer]";
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

/**
 * Normalize a Socket.IO binary value into owned storage. Buffer is accepted as Uint8Array; views
 * backed by SharedArrayBuffer and every non-byte typed array are rejected intentionally.
 */
function studioCrdtBinaryByteView(value: unknown): Uint8Array {
  if (isSharedArrayBuffer(value)) {
    throw new StudioCrdtBinaryEnvelopeError("SharedArrayBuffer is not a transferable CRDT payload");
  }
  try {
    if (isArrayBuffer(value)) {
      return new Uint8Array(value);
    }
    if (
      ArrayBuffer.isView(value) &&
      Object.prototype.toString.call(value) === "[object Uint8Array]" &&
      !isSharedArrayBuffer(value.buffer)
    ) {
      return new Uint8Array(
        value.buffer as ArrayBuffer,
        value.byteOffset,
        value.byteLength
      );
    }
  } catch {
    throw new StudioCrdtBinaryEnvelopeError("CRDT binary payload buffer is detached");
  }
  throw new StudioCrdtBinaryEnvelopeError("CRDT binary payload must be an ArrayBuffer byte view");
}

export function copyStudioCrdtBinaryBytes(value: unknown): Uint8Array {
  return studioCrdtBinaryByteView(value).slice();
}

export function calculateStudioCrdtCrc32(bytes: Uint8Array): number {
  let crc = UINT32_MAX;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ (bytes[index] ?? 0)) & 0xff] ?? 0);
  }
  return (crc ^ UINT32_MAX) >>> 0;
}

export function encodeStudioCrdtBinaryEnvelope(
  kind: StudioCrdtBinaryEnvelopeKind,
  source: StudioCrdtBinarySource
): Uint8Array {
  const bytes = studioCrdtBinaryByteView(source);
  const maximumBytes = kindMaximumBytes(kind);
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    throw new StudioCrdtBinaryEnvelopeError(`${kind} payload exceeds its decoded byte budget`);
  }

  const envelope = new Uint8Array(STUDIO_CRDT_BINARY_HEADER_BYTES + bytes.byteLength);
  envelope.set(MAGIC, 0);
  const view = new DataView(envelope.buffer);
  view.setUint8(4, STUDIO_CRDT_BINARY_ENVELOPE_VERSION);
  view.setUint8(5, KIND_CODE[kind]);
  view.setUint8(6, 0);
  view.setUint8(7, 0);
  view.setUint16(8, STUDIO_CRDT_BINARY_HEADER_BYTES, false);
  view.setUint16(10, 0, false);
  view.setUint32(12, bytes.byteLength, false);
  view.setUint32(16, bytes.byteLength, false);
  view.setUint32(20, calculateStudioCrdtCrc32(bytes), false);
  envelope.set(bytes, STUDIO_CRDT_BINARY_HEADER_BYTES);
  return envelope;
}

function parseStudioCrdtBinaryEnvelopeView(
  source: unknown,
  expectedKind: StudioCrdtBinaryEnvelopeKind
): StudioCrdtDecodedBinaryEnvelope {
  const envelope = studioCrdtBinaryByteView(source);
  if (envelope.byteLength < STUDIO_CRDT_BINARY_HEADER_BYTES) {
    throw new StudioCrdtBinaryEnvelopeError("CRDT binary envelope header is truncated");
  }
  for (let index = 0; index < MAGIC.byteLength; index += 1) {
    if (envelope[index] !== MAGIC[index]) {
      throw new StudioCrdtBinaryEnvelopeError("CRDT binary envelope magic is invalid");
    }
  }

  const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
  if (view.getUint8(4) !== STUDIO_CRDT_BINARY_ENVELOPE_VERSION) {
    throw new StudioCrdtBinaryEnvelopeError("CRDT binary envelope version is unsupported");
  }
  const kind = CODE_KIND[view.getUint8(5) as keyof typeof CODE_KIND];
  if (!kind || kind !== expectedKind) {
    throw new StudioCrdtBinaryEnvelopeError("CRDT binary envelope kind is invalid");
  }
  if (view.getUint8(6) !== 0) {
    throw new StudioCrdtBinaryEnvelopeError("CRDT binary envelope codec is unsupported");
  }
  if (view.getUint8(7) !== 0 || view.getUint16(10, false) !== 0) {
    throw new StudioCrdtBinaryEnvelopeError("CRDT binary envelope flags are unsupported");
  }
  if (view.getUint16(8, false) !== STUDIO_CRDT_BINARY_HEADER_BYTES) {
    throw new StudioCrdtBinaryEnvelopeError("CRDT binary envelope header length is invalid");
  }

  const storedLength = view.getUint32(12, false);
  const decodedLength = view.getUint32(16, false);
  const maximumBytes = kindMaximumBytes(kind);
  if (
    storedLength === 0 ||
    storedLength !== decodedLength ||
    decodedLength > maximumBytes ||
    envelope.byteLength !== STUDIO_CRDT_BINARY_HEADER_BYTES + storedLength
  ) {
    throw new StudioCrdtBinaryEnvelopeError("CRDT binary envelope length is invalid");
  }

  const bytes = envelope.subarray(STUDIO_CRDT_BINARY_HEADER_BYTES);
  if (calculateStudioCrdtCrc32(bytes) !== view.getUint32(20, false)) {
    throw new StudioCrdtBinaryEnvelopeError("CRDT binary envelope checksum is invalid");
  }
  return { kind, codec: "identity", bytes };
}

export function decodeStudioCrdtBinaryEnvelope(
  source: unknown,
  expectedKind: StudioCrdtBinaryEnvelopeKind
): StudioCrdtDecodedBinaryEnvelope {
  const decoded = parseStudioCrdtBinaryEnvelopeView(source, expectedKind);
  return { ...decoded, bytes: decoded.bytes.slice() };
}

export function fragmentStudioCrdtBinarySyncEnvelope(
  envelopeSource: StudioCrdtBinarySource
): Uint8Array[] {
  const envelope = studioCrdtBinaryByteView(envelopeSource);
  if (
    envelope.byteLength <= STUDIO_CRDT_BINARY_HEADER_BYTES ||
    envelope.byteLength > STUDIO_CRDT_BINARY_SYNC_MAX_BYTES + STUDIO_CRDT_BINARY_HEADER_BYTES
  ) {
    throw new StudioCrdtBinaryEnvelopeError("CRDT sync envelope exceeds its wire byte budget");
  }
  // Validate before splitting so callers cannot fragment an arbitrary or malformed binary value.
  parseStudioCrdtBinaryEnvelopeView(envelope, "sync-diff");

  const fragments: Uint8Array[] = [];
  for (
    let offset = 0;
    offset < envelope.byteLength;
    offset += STUDIO_CRDT_BINARY_SYNC_FRAGMENT_MAX_BYTES
  ) {
    fragments.push(
      envelope.slice(offset, offset + STUDIO_CRDT_BINARY_SYNC_FRAGMENT_MAX_BYTES)
    );
  }
  return fragments;
}

export function reassembleStudioCrdtBinarySyncEnvelope(
  fragmentSources: readonly unknown[],
  expectedWireBytes?: number
): Uint8Array {
  if (
    fragmentSources.length === 0 ||
    fragmentSources.length > STUDIO_CRDT_BINARY_SYNC_MAX_FRAGMENTS
  ) {
    throw new StudioCrdtBinaryEnvelopeError("CRDT sync fragment count is invalid");
  }

  const fragments: Uint8Array[] = [];
  let wireBytes = 0;
  for (let index = 0; index < fragmentSources.length; index += 1) {
    const fragment = studioCrdtBinaryByteView(fragmentSources[index]);
    const isLast = index === fragmentSources.length - 1;
    if (
      fragment.byteLength === 0 ||
      fragment.byteLength > STUDIO_CRDT_BINARY_SYNC_FRAGMENT_MAX_BYTES ||
      (!isLast && fragment.byteLength !== STUDIO_CRDT_BINARY_SYNC_FRAGMENT_MAX_BYTES)
    ) {
      throw new StudioCrdtBinaryEnvelopeError("CRDT sync fragment length is invalid");
    }
    wireBytes += fragment.byteLength;
    if (wireBytes > STUDIO_CRDT_BINARY_SYNC_MAX_BYTES + STUDIO_CRDT_BINARY_HEADER_BYTES) {
      throw new StudioCrdtBinaryEnvelopeError("CRDT sync fragments exceed their wire byte budget");
    }
    fragments.push(fragment);
  }
  if (
    expectedWireBytes !== undefined &&
    (!Number.isSafeInteger(expectedWireBytes) ||
      expectedWireBytes <= STUDIO_CRDT_BINARY_HEADER_BYTES ||
      wireBytes !== expectedWireBytes)
  ) {
    throw new StudioCrdtBinaryEnvelopeError("CRDT sync fragment total is invalid");
  }

  const envelope = new Uint8Array(wireBytes);
  let offset = 0;
  for (const fragment of fragments) {
    envelope.set(fragment, offset);
    offset += fragment.byteLength;
  }
  parseStudioCrdtBinaryEnvelopeView(envelope, "sync-diff");
  return envelope;
}
