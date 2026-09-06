import { describe, expect, it } from "vitest";

import {
  STUDIO_CRDT_BINARY_HEADER_BYTES,
  STUDIO_CRDT_BINARY_STATE_VECTOR_MAX_BYTES,
  STUDIO_CRDT_BINARY_SYNC_FRAGMENT_MAX_BYTES,
  STUDIO_CRDT_BINARY_SYNC_MAX_BYTES,
  STUDIO_CRDT_BINARY_UPDATE_MAX_BYTES,
  calculateStudioCrdtCrc32,
  copyStudioCrdtBinaryBytes,
  decodeStudioCrdtBinaryEnvelope,
  encodeStudioCrdtBinaryEnvelope,
  fragmentStudioCrdtBinarySyncEnvelope,
  reassembleStudioCrdtBinarySyncEnvelope,
} from "./studio-crdt-binary-envelope";

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

describe("studio CRDT binary envelope", () => {
  it("writes the exact v1 big-endian header and standard IEEE CRC-32", () => {
    const bytes = new TextEncoder().encode("123456789");
    const envelope = encodeStudioCrdtBinaryEnvelope("update", bytes);

    expect(calculateStudioCrdtCrc32(bytes)).toBe(0xcbf4_3926);
    expect(Array.from(envelope.subarray(0, 24))).toEqual([
      0x54, 0x53, 0x43, 0x52,
      1, 1, 0, 0,
      0, 24, 0, 0,
      0, 0, 0, 9,
      0, 0, 0, 9,
      0xcb, 0xf4, 0x39, 0x26,
    ]);
    expect(decodeStudioCrdtBinaryEnvelope(envelope, "update").bytes).toEqual(bytes);
  });

  it.each([
    ["update", STUDIO_CRDT_BINARY_UPDATE_MAX_BYTES],
    ["state-vector", STUDIO_CRDT_BINARY_STATE_VECTOR_MAX_BYTES],
    ["sync-diff", STUDIO_CRDT_BINARY_SYNC_MAX_BYTES],
  ] as const)("round-trips %s at one byte and its exact maximum", (kind, maximumBytes) => {
    for (const size of [1, maximumBytes]) {
      const bytes = new Uint8Array(size);
      bytes[0] = 17;
      bytes[size - 1] = 91;
      const decoded = decodeStudioCrdtBinaryEnvelope(
        encodeStudioCrdtBinaryEnvelope(kind, bytes),
        kind
      );
      expect(bytesEqual(decoded.bytes, bytes)).toBe(true);
      expect(Object.is(decoded.bytes, bytes)).toBe(false);
    }
  });

  it("normalizes Buffer, ArrayBuffer, and non-zero-offset subarrays into owned bytes", () => {
    const backing = Uint8Array.of(90, 1, 2, 3, 91);
    const subarray = backing.subarray(1, 4);
    const normalized = copyStudioCrdtBinaryBytes(subarray);
    backing.fill(0);
    expect(normalized).toEqual(Uint8Array.of(1, 2, 3));

    const arrayBuffer = Uint8Array.of(4, 5, 6).buffer;
    const copiedArrayBuffer = copyStudioCrdtBinaryBytes(arrayBuffer);
    new Uint8Array(arrayBuffer).fill(0);
    expect(copiedArrayBuffer).toEqual(Uint8Array.of(4, 5, 6));

    expect(copyStudioCrdtBinaryBytes(Buffer.from([7, 8, 9]))).toEqual(
      Uint8Array.of(7, 8, 9)
    );
  });

  it("rejects non-byte views, object-shaped buffers, and SharedArrayBuffer", () => {
    expect(() => copyStudioCrdtBinaryBytes(new Uint16Array([1]))).toThrow();
    expect(() => copyStudioCrdtBinaryBytes(new DataView(new ArrayBuffer(1)))).toThrow();
    expect(() => copyStudioCrdtBinaryBytes({ type: "Buffer", data: [1] })).toThrow();
    if (typeof SharedArrayBuffer === "function") {
      expect(() => copyStudioCrdtBinaryBytes(new SharedArrayBuffer(1))).toThrow();
      expect(() => copyStudioCrdtBinaryBytes(new Uint8Array(new SharedArrayBuffer(1)))).toThrow();
    }
  });

  it("fails closed for malformed, cross-kind, oversized, truncated, and corrupted envelopes", () => {
    expect(() => encodeStudioCrdtBinaryEnvelope("update", new Uint8Array())).toThrow();
    expect(() =>
      encodeStudioCrdtBinaryEnvelope(
        "update",
        new Uint8Array(STUDIO_CRDT_BINARY_UPDATE_MAX_BYTES + 1)
      )
    ).toThrow();

    const valid = encodeStudioCrdtBinaryEnvelope("update", Uint8Array.of(1, 2, 3));
    expect(() => decodeStudioCrdtBinaryEnvelope(valid, "state-vector")).toThrow();
    expect(() => decodeStudioCrdtBinaryEnvelope(valid.subarray(0, 23), "update")).toThrow();

    for (const [offset, replacement] of [
      [0, 0],
      [4, 2],
      [5, 99],
      [6, 1],
      [7, 1],
      [9, 23],
      [11, 1],
    ] as const) {
      const malformed = valid.slice();
      malformed[offset] = replacement;
      expect(() => decodeStudioCrdtBinaryEnvelope(malformed, "update")).toThrow();
    }

    const trailing = new Uint8Array(valid.byteLength + 1);
    trailing.set(valid);
    expect(() => decodeStudioCrdtBinaryEnvelope(trailing, "update")).toThrow();

    const corrupted = valid.slice();
    corrupted[corrupted.byteLength - 1] ^= 0xff;
    expect(() => decodeStudioCrdtBinaryEnvelope(corrupted, "update")).toThrow();
  });

  it("fragments one validated sync envelope and detects damaged fragment sequences", () => {
    const bytes = new Uint8Array(STUDIO_CRDT_BINARY_SYNC_FRAGMENT_MAX_BYTES * 2);
    for (let index = 0; index < bytes.byteLength; index += 1) {
      bytes[index] = index & 0xff;
    }
    const envelope = encodeStudioCrdtBinaryEnvelope("sync-diff", bytes);
    const fragments = fragmentStudioCrdtBinarySyncEnvelope(envelope);

    expect(fragments).toHaveLength(3);
    expect(fragments[0]).toHaveLength(STUDIO_CRDT_BINARY_SYNC_FRAGMENT_MAX_BYTES);
    expect(fragments[1]).toHaveLength(STUDIO_CRDT_BINARY_SYNC_FRAGMENT_MAX_BYTES);
    expect(
      bytesEqual(
        reassembleStudioCrdtBinarySyncEnvelope(fragments, envelope.byteLength),
        envelope
      )
    ).toBe(true);
    expect(() =>
      reassembleStudioCrdtBinarySyncEnvelope(fragments.slice(1), envelope.byteLength)
    ).toThrow();
    expect(() =>
      reassembleStudioCrdtBinarySyncEnvelope(
        [fragments[1]!, fragments[0]!, fragments[2]!],
        envelope.byteLength
      )
    ).toThrow();
    expect(() =>
      reassembleStudioCrdtBinarySyncEnvelope(
        [fragments[0]!, fragments[0]!, fragments[2]!],
        envelope.byteLength
      )
    ).toThrow();
  });

  it("keeps the exact 16 MiB sync diff within the existing 410-fragment budget", () => {
    const envelope = encodeStudioCrdtBinaryEnvelope(
      "sync-diff",
      new Uint8Array(STUDIO_CRDT_BINARY_SYNC_MAX_BYTES)
    );
    const fragments = fragmentStudioCrdtBinarySyncEnvelope(envelope);

    expect(envelope.byteLength).toBe(
      STUDIO_CRDT_BINARY_SYNC_MAX_BYTES + STUDIO_CRDT_BINARY_HEADER_BYTES
    );
    expect(fragments).toHaveLength(410);
    expect(bytesEqual(reassembleStudioCrdtBinarySyncEnvelope(fragments), envelope)).toBe(true);
  });
});
