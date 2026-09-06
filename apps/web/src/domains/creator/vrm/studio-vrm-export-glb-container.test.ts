import { describe, expect, it } from "vitest";

import { StudioVrmExportError } from "./studio-vrm-export-error";
import {
  canonicalStudioVrmExportJsonText,
  planStudioVrmExportGlbLayout,
  readStudioVrmExportGlb,
  writeStudioVrmExportGlb,
  STUDIO_VRM_EXPORT_BIN_CHUNK_TYPE,
  STUDIO_VRM_EXPORT_BIN_PAD_BYTE,
  STUDIO_VRM_EXPORT_GLB_MAGIC,
  STUDIO_VRM_EXPORT_GLB_VERSION,
  STUDIO_VRM_EXPORT_JSON_CHUNK_TYPE,
  STUDIO_VRM_EXPORT_JSON_PAD_BYTE,
  STUDIO_VRM_EXPORT_MAX_JSON_BYTES,
} from "./studio-vrm-export-glb-container";

/** `{"asset":{"version":"2.0"}}` — 27 UTF-8 bytes, i.e. deliberately not a multiple of four. */
const ASSET_ONLY = { asset: { version: "2.0" } };
const ASSET_ONLY_JSON_BYTES = 27;

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function expectExportError(run: () => unknown, code: string): void {
  expect(run).toThrowError(StudioVrmExportError);
  try {
    run();
    expect.unreachable("expected a StudioVrmExportError");
  } catch (error) {
    expect((error as StudioVrmExportError).code).toBe(code);
  }
}

describe("canonicalStudioVrmExportJsonText", () => {
  it("emits object keys in sorted order regardless of insertion order", () => {
    const first = canonicalStudioVrmExportJsonText({ b: 1, a: { z: 1, y: 2 } });
    const second = canonicalStudioVrmExportJsonText({ a: { y: 2, z: 1 }, b: 1 });
    expect(first).toBe('{"a":{"y":2,"z":1},"b":1}');
    expect(second).toBe(first);
  });

  it("preserves array order because glTF indexes into arrays", () => {
    expect(canonicalStudioVrmExportJsonText({ nodes: [3, 1, 2] })).toBe('{"nodes":[3,1,2]}');
  });

  it("drops undefined members instead of emitting null", () => {
    expect(canonicalStudioVrmExportJsonText({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("normalizes -0 so equal data cannot produce two different texts", () => {
    expect(canonicalStudioVrmExportJsonText({ v: -0 })).toBe('{"v":0}');
  });

  it("rejects non-finite numbers rather than silently writing null", () => {
    expectExportError(() => canonicalStudioVrmExportJsonText({ v: Number.NaN }), "json-not-serializable");
    expectExportError(
      () => canonicalStudioVrmExportJsonText({ v: Number.POSITIVE_INFINITY }),
      "json-not-serializable",
    );
  });

  it("rejects a cyclic graph with an honest error instead of overflowing the stack", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expectExportError(() => canonicalStudioVrmExportJsonText(cyclic), "json-not-serializable");
  });

  it("rejects undefined holes inside arrays", () => {
    expectExportError(
      () => canonicalStudioVrmExportJsonText({ nodes: [1, undefined, 3] }),
      "json-not-serializable",
    );
  });

  it("rejects values JSON cannot represent, such as functions and Maps", () => {
    expectExportError(() => canonicalStudioVrmExportJsonText({ v: () => 1 }), "json-not-serializable");
    expectExportError(() => canonicalStudioVrmExportJsonText({ v: new Map() }), "json-not-serializable");
  });
});

describe("planStudioVrmExportGlbLayout", () => {
  it("computes every chunk offset for a JSON-only document", () => {
    const layout = planStudioVrmExportGlbLayout(ASSET_ONLY_JSON_BYTES, 0);
    expect(layout).toMatchObject({
      totalByteLength: 48,
      jsonChunkOffset: 12,
      jsonContentOffset: 20,
      jsonByteLength: 27,
      jsonPaddedByteLength: 28,
      jsonPaddingBytes: 1,
      binChunkOffset: null,
      binContentOffset: null,
      binByteLength: 0,
      binPaddedByteLength: 0,
      binPaddingBytes: 0,
    });
  });

  it("computes offsets for a document with a padded BIN chunk", () => {
    const layout = planStudioVrmExportGlbLayout(ASSET_ONLY_JSON_BYTES, 5);
    expect(layout).toMatchObject({
      totalByteLength: 64,
      jsonPaddedByteLength: 28,
      binChunkOffset: 48,
      binContentOffset: 56,
      binByteLength: 5,
      binPaddedByteLength: 8,
      binPaddingBytes: 3,
    });
  });

  it("adds no padding when both payloads are already 4-byte aligned", () => {
    const layout = planStudioVrmExportGlbLayout(28, 8);
    expect(layout.jsonPaddingBytes).toBe(0);
    expect(layout.binPaddingBytes).toBe(0);
    expect(layout.totalByteLength).toBe(12 + 8 + 28 + 8 + 8);
  });

  it("rejects an empty JSON chunk and a negative BIN length", () => {
    expectExportError(() => planStudioVrmExportGlbLayout(0, 0), "invalid-snapshot");
    expectExportError(() => planStudioVrmExportGlbLayout(4, -1), "invalid-snapshot");
  });
});

describe("writeStudioVrmExportGlb", () => {
  it("writes a byte-exact header and JSON chunk with space padding", () => {
    const bytes = writeStudioVrmExportGlb({ json: ASSET_ONLY });
    const view = dataView(bytes);

    expect(bytes.byteLength).toBe(48);
    expect(view.getUint32(0, true)).toBe(STUDIO_VRM_EXPORT_GLB_MAGIC);
    expect(view.getUint32(4, true)).toBe(STUDIO_VRM_EXPORT_GLB_VERSION);
    expect(view.getUint32(8, true)).toBe(48);
    expect(view.getUint32(12, true)).toBe(28);
    expect(view.getUint32(16, true)).toBe(STUDIO_VRM_EXPORT_JSON_CHUNK_TYPE);

    const jsonText = new TextDecoder().decode(bytes.subarray(20, 20 + ASSET_ONLY_JSON_BYTES));
    expect(jsonText).toBe('{"asset":{"version":"2.0"}}');
    expect(bytes[47]).toBe(STUDIO_VRM_EXPORT_JSON_PAD_BYTE);
  });

  it("writes a BIN chunk padded with zeroes and never overruns the payload", () => {
    const binary = Uint8Array.of(1, 2, 3, 4, 5);
    const bytes = writeStudioVrmExportGlb({ json: ASSET_ONLY, binary });
    const view = dataView(bytes);

    expect(bytes.byteLength).toBe(64);
    expect(view.getUint32(8, true)).toBe(64);
    expect(view.getUint32(48, true)).toBe(8);
    expect(view.getUint32(52, true)).toBe(STUDIO_VRM_EXPORT_BIN_CHUNK_TYPE);
    expect([...bytes.subarray(56, 61)]).toEqual([1, 2, 3, 4, 5]);
    expect([...bytes.subarray(61, 64)]).toEqual([
      STUDIO_VRM_EXPORT_BIN_PAD_BYTE,
      STUDIO_VRM_EXPORT_BIN_PAD_BYTE,
      STUDIO_VRM_EXPORT_BIN_PAD_BYTE,
    ]);
  });

  it("omits the BIN chunk entirely for an empty binary payload", () => {
    const bytes = writeStudioVrmExportGlb({ json: ASSET_ONLY, binary: new Uint8Array(0) });
    expect(bytes.byteLength).toBe(48);
    expect(readStudioVrmExportGlb(bytes).binary.byteLength).toBe(0);
  });

  it("is deterministic: equal input yields byte-identical output", () => {
    const binary = Uint8Array.of(9, 8, 7);
    const first = writeStudioVrmExportGlb({
      json: { asset: { version: "2.0", generator: "t" }, scene: 0 },
      binary,
    });
    const second = writeStudioVrmExportGlb({
      json: { scene: 0, asset: { generator: "t", version: "2.0" } },
      binary: Uint8Array.of(9, 8, 7),
    });
    expect([...second]).toEqual([...first]);
  });

  it("keeps every chunk length a multiple of four for arbitrary payload sizes", () => {
    for (let binByteLength = 0; binByteLength <= 8; binByteLength += 1) {
      const bytes = writeStudioVrmExportGlb({
        json: { asset: { version: "2.0" }, pad: "x".repeat(binByteLength) },
        binary: new Uint8Array(binByteLength).fill(0xab),
      });
      const view = dataView(bytes);
      expect(bytes.byteLength % 4).toBe(0);
      expect(view.getUint32(12, true) % 4).toBe(0);
      if (binByteLength > 0) {
        const binChunkOffset = 20 + view.getUint32(12, true);
        expect(view.getUint32(binChunkOffset, true) % 4).toBe(0);
      }
    }
  });

  it("refuses a JSON chunk beyond the importer's ceiling", () => {
    const oversized = { asset: { version: "2.0" }, pad: "x".repeat(STUDIO_VRM_EXPORT_MAX_JSON_BYTES) };
    expectExportError(() => writeStudioVrmExportGlb({ json: oversized }), "json-too-large");
  });

  it("rejects a non-object root and a non-Uint8Array binary", () => {
    expectExportError(() => writeStudioVrmExportGlb({ json: [1, 2, 3] }), "json-not-serializable");
    expectExportError(
      () => writeStudioVrmExportGlb({ json: ASSET_ONLY, binary: [1, 2] as unknown as Uint8Array }),
      "invalid-snapshot",
    );
  });
});

describe("readStudioVrmExportGlb", () => {
  it("round-trips its own output structurally and byte-wise", () => {
    const json = { asset: { version: "2.0" }, extensions: { VRMC_vrm: { specVersion: "1.0" } } };
    const binary = Uint8Array.of(1, 2, 3, 4, 5, 6, 7);
    const parsed = readStudioVrmExportGlb(writeStudioVrmExportGlb({ json, binary }));

    expect(parsed.json).toEqual(json);
    // The BIN chunk is padded to 8 bytes; without a `buffers` table the reader can only report the
    // padded payload, which still carries the original bytes as its prefix.
    expect(parsed.binary.byteLength).toBe(8);
    expect([...parsed.binary.subarray(0, 7)]).toEqual([...binary]);
    expect(parsed.jsonByteLength % 4).toBe(0);
  });

  it("recovers the unpadded buffer length from buffers[0]", () => {
    const binary = Uint8Array.of(1, 2, 3, 4, 5);
    const parsed = readStudioVrmExportGlb(
      writeStudioVrmExportGlb({
        json: { asset: { version: "2.0" }, buffers: [{ byteLength: 5 }] },
        binary,
      }),
    );
    expect(parsed.layout.binByteLength).toBe(5);
    expect(parsed.layout.binPaddingBytes).toBe(3);
    // The padding is stripped, so the recovered payload equals the bytes that were handed in.
    expect([...parsed.binary]).toEqual([...binary]);
  });

  it("accepts an ArrayBuffer as well as a Uint8Array", () => {
    const bytes = writeStudioVrmExportGlb({ json: ASSET_ONLY });
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    expect(readStudioVrmExportGlb(copy).json).toEqual(ASSET_ONLY);
  });

  it("rejects a truncated file", () => {
    expectExportError(() => readStudioVrmExportGlb(new Uint8Array(8)), "glb-truncated");
  });

  it("rejects a wrong magic, version and declared length", () => {
    const base = writeStudioVrmExportGlb({ json: ASSET_ONLY });

    const badMagic = Uint8Array.from(base);
    dataView(badMagic).setUint32(0, 0x12345678, true);
    expectExportError(() => readStudioVrmExportGlb(badMagic), "glb-magic-mismatch");

    const badVersion = Uint8Array.from(base);
    dataView(badVersion).setUint32(4, 1, true);
    expectExportError(() => readStudioVrmExportGlb(badVersion), "glb-version-unsupported");

    const badLength = Uint8Array.from(base);
    dataView(badLength).setUint32(8, base.byteLength + 4, true);
    expectExportError(() => readStudioVrmExportGlb(badLength), "glb-length-mismatch");
  });

  it("rejects an unaligned chunk length and an out-of-bounds chunk", () => {
    const base = writeStudioVrmExportGlb({ json: ASSET_ONLY });

    const unaligned = Uint8Array.from(base);
    dataView(unaligned).setUint32(12, 27, true);
    expectExportError(() => readStudioVrmExportGlb(unaligned), "glb-chunk-alignment");

    const overflowing = Uint8Array.from(base);
    dataView(overflowing).setUint32(12, 64, true);
    expectExportError(() => readStudioVrmExportGlb(overflowing), "glb-chunk-bounds");
  });

  it("rejects an unknown chunk type and a missing JSON chunk", () => {
    const base = writeStudioVrmExportGlb({ json: ASSET_ONLY, binary: Uint8Array.of(1, 2, 3, 4) });

    const unknownChunk = Uint8Array.from(base);
    dataView(unknownChunk).setUint32(52, 0x11223344, true);
    expectExportError(() => readStudioVrmExportGlb(unknownChunk), "glb-chunk-type-unsupported");

    const noJson = Uint8Array.from(base);
    dataView(noJson).setUint32(16, STUDIO_VRM_EXPORT_BIN_CHUNK_TYPE, true);
    expectExportError(() => readStudioVrmExportGlb(noJson), "glb-json-chunk-missing");
  });

  it("rejects a duplicated JSON chunk", () => {
    const duplicated = writeStudioVrmExportGlb({ json: ASSET_ONLY, binary: Uint8Array.of(1, 2, 3, 4) });
    dataView(duplicated).setUint32(52, STUDIO_VRM_EXPORT_JSON_CHUNK_TYPE, true);
    expectExportError(() => readStudioVrmExportGlb(duplicated), "glb-json-chunk-duplicate");
  });

  it("rejects malformed UTF-8 and malformed JSON in the JSON chunk", () => {
    const badUtf8 = writeStudioVrmExportGlb({ json: ASSET_ONLY });
    badUtf8[20] = 0xff;
    expectExportError(() => readStudioVrmExportGlb(badUtf8), "glb-json-encoding-invalid");

    const badJson = writeStudioVrmExportGlb({ json: ASSET_ONLY });
    badJson[20] = 0x7b; // an extra '{' makes the document unparsable
    badJson[21] = 0x7b;
    expectExportError(() => readStudioVrmExportGlb(badJson), "glb-json-parse-failed");
  });
});
