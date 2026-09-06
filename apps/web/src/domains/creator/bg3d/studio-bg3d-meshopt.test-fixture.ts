const COMPRESSED_TRIANGLE_POSITIONS = new Uint8Array([
  160, 0, 0, 1, 60, 0, 0, 0, 255, 255, 1, 60, 0, 0, 0, 126, 125, 0, 0, 1, 12, 0,
  0, 0, 255, 1, 12, 0, 0, 0, 126, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

function pad(bytes: Uint8Array, fill: number): Uint8Array {
  const result = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4);
  result.fill(fill);
  result.set(bytes);
  return result;
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer).setUint32(offset, value, true);
}

export function createStudioBg3dMeshoptCompressedTriangleGlbFixture(): Uint8Array {
  const root = {
    asset: { version: "2.0", generator: "ToonSpectrum Meshopt integration fixture" },
    extensionsUsed: ["EXT_meshopt_compression"],
    extensionsRequired: ["EXT_meshopt_compression"],
    buffers: [
      { byteLength: COMPRESSED_TRIANGLE_POSITIONS.byteLength },
      { byteLength: 36, extensions: { EXT_meshopt_compression: { fallback: true } } },
    ],
    bufferViews: [{
      buffer: 1,
      byteOffset: 0,
      byteLength: 36,
      byteStride: 12,
      target: 34962,
      extensions: {
        EXT_meshopt_compression: {
          buffer: 0,
          byteOffset: 0,
          byteLength: COMPRESSED_TRIANGLE_POSITIONS.byteLength,
          byteStride: 12,
          count: 3,
          mode: "ATTRIBUTES",
          filter: "NONE",
        },
      },
    }],
    accessors: [{
      bufferView: 0,
      byteOffset: 0,
      componentType: 5126,
      count: 3,
      type: "VEC3",
      min: [0, 0, 0],
      max: [1, 1, 0],
    }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  const json = pad(new TextEncoder().encode(JSON.stringify(root)), 0x20);
  const bin = pad(COMPRESSED_TRIANGLE_POSITIONS, 0);
  const total = 12 + 8 + json.byteLength + 8 + bin.byteLength;
  const bytes = new Uint8Array(total);
  writeU32(bytes, 0, 0x46546c67);
  writeU32(bytes, 4, 2);
  writeU32(bytes, 8, total);
  writeU32(bytes, 12, json.byteLength);
  writeU32(bytes, 16, 0x4e4f534a);
  bytes.set(json, 20);
  const binHeader = 20 + json.byteLength;
  writeU32(bytes, binHeader, bin.byteLength);
  writeU32(bytes, binHeader + 4, 0x004e4942);
  bytes.set(bin, binHeader + 8);
  return bytes;
}
