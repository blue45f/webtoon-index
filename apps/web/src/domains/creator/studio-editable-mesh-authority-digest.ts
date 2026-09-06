/**
 * Streaming content digest for editable-mesh authority.
 *
 * The binary schema is deliberately renderer- and JSON-independent. Integers are signed 64-bit
 * big-endian values, geometric scalars are IEEE-754 Float64 big-endian values, and booleans are
 * one byte. Signed zero is canonicalized to +0 to match OPFS JSON snapshot round-trips. Arrays are
 * consumed in canonical authority order and prefixed by their counts.
 */

import { createSha256Portable, type StudioPortableSha256 } from "./studio-sha256";

import type { StudioEditableMesh } from "./studio-editable-half-edge-mesh";

const STUDIO_EDITABLE_MESH_AUTHORITY_DIGEST_CHUNK_BYTES = 64 * 1024;
const STUDIO_EDITABLE_MESH_AUTHORITY_DIGEST_SCHEMA_REVISION = 1;
const UINT32_RADIX = 0x1_0000_0000;
const STUDIO_EDITABLE_MESH_AUTHORITY_DIGEST_MAGIC = Uint8Array.of(
  0x54, 0x53, 0x4d, 0x45, 0x53, 0x48, 0x41, 0x55,
  0x54, 0x48, 0x44, 0x49, 0x47, 0x45, 0x53, 0x54,
);

class StudioEditableMeshAuthorityDigestWriter {
  private readonly bytes = new Uint8Array(STUDIO_EDITABLE_MESH_AUTHORITY_DIGEST_CHUNK_BYTES);
  private readonly view = new DataView(this.bytes.buffer);
  private offset = 0;

  constructor(private readonly hasher: StudioPortableSha256) {}

  writeBytes(source: Uint8Array): void {
    let sourceOffset = 0;
    while (sourceOffset < source.byteLength) {
      if (this.offset === this.bytes.byteLength) this.flush();
      const length = Math.min(
        source.byteLength - sourceOffset,
        this.bytes.byteLength - this.offset,
      );
      this.bytes.set(source.subarray(sourceOffset, sourceOffset + length), this.offset);
      this.offset += length;
      sourceOffset += length;
    }
  }

  writeInteger(value: number): void {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError("Editable mesh authority integer must be a safe integer");
    }
    this.ensureCapacity(8);
    const high = Math.floor(value / UINT32_RADIX);
    const low = value - high * UINT32_RADIX;
    this.view.setInt32(this.offset, high, false);
    this.view.setUint32(this.offset + 4, low, false);
    this.offset += 8;
  }

  writeFloat64(value: number): void {
    this.ensureCapacity(8);
    this.view.setFloat64(this.offset, Object.is(value, -0) ? 0 : value, false);
    this.offset += 8;
  }

  writeBoolean(value: boolean): void {
    if (value !== true && value !== false) {
      throw new TypeError("Editable mesh authority boolean must be true or false");
    }
    this.ensureCapacity(1);
    this.view.setUint8(this.offset, value ? 1 : 0);
    this.offset += 1;
  }

  finalizeHex(): string {
    this.flush();
    return this.hasher.finalizeHex();
  }

  private ensureCapacity(byteLength: number): void {
    if (byteLength > this.bytes.byteLength) {
      throw new RangeError("Editable mesh digest primitive exceeds the fixed chunk size");
    }
    if (this.offset + byteLength > this.bytes.byteLength) this.flush();
  }

  private flush(): void {
    if (this.offset === 0) return;
    this.hasher.update(this.bytes.subarray(0, this.offset));
    this.offset = 0;
  }
}

/**
 * Hashes every editable-mesh authority field without materializing monolithic JSON or bytes.
 * Working serialization memory is one fixed 64 KiB writer chunk plus SHA-256 state.
 */
export function hashStudioEditableMeshAuthority(mesh: StudioEditableMesh): string {
  const writer = new StudioEditableMeshAuthorityDigestWriter(createSha256Portable());
  writer.writeBytes(STUDIO_EDITABLE_MESH_AUTHORITY_DIGEST_MAGIC);
  writer.writeInteger(STUDIO_EDITABLE_MESH_AUTHORITY_DIGEST_SCHEMA_REVISION);
  writer.writeInteger(mesh.revision);
  writer.writeInteger(mesh.vertices.length);
  writer.writeInteger(mesh.halfEdges.length);
  writer.writeInteger(mesh.faces.length);
  writer.writeInteger(mesh.nextVertexId);
  writer.writeInteger(mesh.nextHalfEdgeId);
  writer.writeInteger(mesh.nextFaceId);

  for (const vertex of mesh.vertices) {
    writer.writeInteger(vertex.id);
    writer.writeFloat64(vertex.position.x);
    writer.writeFloat64(vertex.position.y);
    writer.writeFloat64(vertex.position.z);
    writer.writeFloat64(vertex.crease);
    writer.writeInteger(vertex.he);
  }
  for (const halfEdge of mesh.halfEdges) {
    writer.writeInteger(halfEdge.id);
    writer.writeInteger(halfEdge.vertex);
    writer.writeInteger(halfEdge.face);
    writer.writeInteger(halfEdge.next);
    writer.writeInteger(halfEdge.prev);
    writer.writeInteger(halfEdge.twin);
    writer.writeFloat64(halfEdge.crease);
  }
  for (const face of mesh.faces) {
    writer.writeInteger(face.id);
    writer.writeInteger(face.he);
    writer.writeInteger(face.materialSlot);
    writer.writeBoolean(face.smooth);
  }

  return `mesh:sha256:${writer.finalizeHex()}`;
}
