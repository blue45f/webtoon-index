import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1,
  STUDIO_BG3D_THREE_WEBGL_CAPTURE_IMPLEMENTATION_V1,
} from "./studio-bg3d-capture-adapter";
import {
  verifyStudioBg3dOpaqueRgb8PngFile,
  verifyStudioBg3dRgba8PngFile,
} from "./studio-bg3d-file-integrity";
import {
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  serializeStudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";
import {
  reverifyStudioBg3dShotBatchShotArtifacts,
  verifyStudioBg3dShotBatchShotArtifacts,
  type StudioBg3dShotBatchShotArtifacts,
} from "./studio-bg3d-shot-batch-artifact-integrity";
import {
  STUDIO_BG3D_SHOT_BATCH_LT_PIPELINE_V1,
  STUDIO_BG3D_SHOT_BATCH_PNG_ENCODING_V1,
  STUDIO_BG3D_SHOT_BATCH_PSD_ENCODING_V1,
  createStudioBg3dShotBatchPlan,
} from "./studio-bg3d-shot-batch-plan";
import { buildStudioBg3dShotLayeredPsd } from "./studio-bg3d-shot-psd";
import { STUDIO_BG3D_SHOT_PSD_MIME } from "./studio-bg3d-shot-psd-contract";

const SHOT = { id: "shot-a", name: "첫 컷" } as const;
const WIDTH = 640;
const HEIGHT = 360;
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function concatenate(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const typeBytes = Uint8Array.from(type, (character) => character.charCodeAt(0));
  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength, false);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32(chunk.subarray(4, 8 + data.byteLength)), false);
  return chunk;
}

function adler32(bytes: Uint8Array): number {
  const modulus = 65_521;
  let first = 1;
  let second = 0;
  for (const byte of bytes) {
    first = (first + byte) % modulus;
    second = (second + first) % modulus;
  }
  return ((second << 16) | first) >>> 0;
}

/** Produces a standards-compliant zlib stream made of bounded, uncompressed DEFLATE blocks. */
function zlibStored(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const blockCount = Math.ceil(bytes.byteLength / 65_535);
  const output = new Uint8Array(2 + blockCount * 5 + bytes.byteLength + 4);
  const view = new DataView(output.buffer);
  output.set([0x78, 0x01], 0);
  let sourceOffset = 0;
  let outputOffset = 2;
  while (sourceOffset < bytes.byteLength) {
    const length = Math.min(65_535, bytes.byteLength - sourceOffset);
    const isFinal = sourceOffset + length === bytes.byteLength;
    output[outputOffset] = isFinal ? 1 : 0;
    outputOffset += 1;
    view.setUint16(outputOffset, length, true);
    outputOffset += 2;
    view.setUint16(outputOffset, length ^ 0xffff, true);
    outputOffset += 2;
    output.set(bytes.subarray(sourceOffset, sourceOffset + length), outputOffset);
    outputOffset += length;
    sourceOffset += length;
  }
  view.setUint32(outputOffset, adler32(bytes), false);
  return output;
}

function pngIhdr(
  width: number,
  height: number,
  colorType: 2 | 6 = 6,
): Uint8Array<ArrayBuffer> {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdr.set([8, colorType, 0, 0, 0], 8);
  return ihdr;
}

function pngBytes(
  width: number,
  height: number,
  marker = 0,
  firstFilter = 0,
  colorType: 2 | 6 = 6,
): Uint8Array<ArrayBuffer> {
  const rowBytes = width * (colorType === 2 ? 3 : 4) + 1;
  const pixels = new Uint8Array(rowBytes * height);
  for (let row = 0; row < height; row += 1) pixels[row * rowBytes] = 0;
  pixels[0] = firstFilter;
  pixels[1] = marker;
  return concatenate([
    PNG_SIGNATURE,
    pngChunk("IHDR", pngIhdr(width, height, colorType)),
    pngChunk("IDAT", zlibStored(pixels)),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

function pngWithoutIdat(width: number, height: number): Uint8Array<ArrayBuffer> {
  return concatenate([
    PNG_SIGNATURE,
    pngChunk("IHDR", pngIhdr(width, height)),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

function truncatedPngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(25);
  bytes.set(PNG_SIGNATURE);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function psdBytes(
  width: number,
  height: number,
  compression: "raw" | "rle",
): Uint8Array<ArrayBuffer> {
  let composite: Uint8Array<ArrayBuffer>;
  let rowLengths: Uint16Array | null = null;
  if (compression === "raw") {
    composite = new Uint8Array(width * height * 4);
  } else {
    const row = new Uint8Array(Math.ceil(width / 128) * 2);
    let remaining = width;
    let offset = 0;
    while (remaining > 0) {
      const run = Math.min(128, remaining);
      row[offset] = 257 - run;
      row[offset + 1] = 0;
      offset += 2;
      remaining -= run;
    }
    const rowCount = height * 4;
    rowLengths = new Uint16Array(rowCount);
    rowLengths.fill(row.byteLength);
    composite = new Uint8Array(row.byteLength * rowCount);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      composite.set(row, rowIndex * row.byteLength);
    }
  }

  const rowTableBytes = rowLengths ? rowLengths.byteLength : 0;
  const bytes = new Uint8Array(40 + rowTableBytes + composite.byteLength);
  const view = new DataView(bytes.buffer);
  bytes.set([0x38, 0x42, 0x50, 0x53], 0);
  view.setUint16(4, 1, false);
  view.setUint16(12, 4, false);
  view.setUint32(14, height, false);
  view.setUint32(18, width, false);
  view.setUint16(22, 8, false);
  view.setUint16(24, 3, false);
  // The three length-prefixed color-mode, image-resource, and layer/mask sections are empty.
  view.setUint16(38, compression === "raw" ? 0 : 1, false);
  let offset = 40;
  if (rowLengths) {
    for (const length of rowLengths) {
      view.setUint16(offset, length, false);
      offset += 2;
    }
  }
  bytes.set(composite, offset);
  return bytes;
}

const pngBlobs = new Map<number, Blob>();

function validPngBlob(marker = 0): Blob {
  const cached = pngBlobs.get(marker);
  if (cached) return cached;
  const blob = new Blob([pngBytes(WIDTH, HEIGHT, marker)], { type: "image/png" });
  pngBlobs.set(marker, blob);
  return blob;
}

async function plan() {
  const sourceRevision = serializeStudioBg3dSceneDocument({
    ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
    output: { ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.output, exportHeight: 720 },
    shots: [SHOT],
  });
  if (!sourceRevision) throw new Error("canonical test scene unavailable");
  const result = await createStudioBg3dShotBatchPlan([SHOT], {
    sourceRevision,
    scope: {
      durability: "durable",
      authUserId: "user-a",
      workId: "work-a",
      pageId: "page-a",
      elementId: "element-a",
    },
    capture: {
      owner: {
        backend: "three-webgl",
        engineId: "three",
        engineRevision: "184",
        implementationRevision: STUDIO_BG3D_THREE_WEBGL_CAPTURE_IMPLEMENTATION_V1,
        graphicsApi: "webgl2",
        profileId: STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1,
        sourceWidth: 640,
        sourceHeight: 360,
        maxPixels: 640 * 360,
        maxEdge: 4_096,
        deviceProfile: "desktop",
        textureScale: 1,
        lodBias: 0,
        ltPipelineId: STUDIO_BG3D_SHOT_BATCH_LT_PIPELINE_V1,
        pngEncodingId: STUDIO_BG3D_SHOT_BATCH_PNG_ENCODING_V1,
        psdEncodingId: STUDIO_BG3D_SHOT_BATCH_PSD_ENCODING_V1,
      },
      shots: [{
        shotId: SHOT.id,
        width: 640,
        height: 360,
        requestedHeight: 720,
        wasReduced: true,
        includeDepth: true,
        shadows: true,
        shadowMapSize: 1_024,
        background: { color: "#ffffff", alpha: 1 },
      }],
    },
    passes: ["beauty", "depth"],
    layeredPsd: true,
  });
  if (!result.ok) throw new Error(result.message);
  return result.plan;
}

function validArtifacts(marker = 0): StudioBg3dShotBatchShotArtifacts {
  return {
    images: [{
      shotId: SHOT.id,
      shotName: SHOT.name,
      width: WIDTH,
      height: HEIGHT,
      pass: "beauty",
      requestedHeight: 720,
      wasReduced: true,
      png: validPngBlob(marker),
    }],
    skippedArtifacts: [{
      shotId: SHOT.id,
      shotName: SHOT.name,
      pass: "depth",
      reason: "unavailable",
    }],
    layeredPsds: [],
    psdFallbacks: [{
      shotId: SHOT.id,
      shotName: SHOT.name,
      reason: "unavailable",
    }],
  };
}

function artifactsWithPsd(
  input: Uint8Array<ArrayBuffer> | Blob,
): StudioBg3dShotBatchShotArtifacts {
  const artifacts = validArtifacts();
  return {
    ...artifacts,
    layeredPsds: [{
      shotId: SHOT.id,
      shotName: SHOT.name,
      width: WIDTH,
      height: HEIGHT,
      psd: input instanceof Blob
        ? input
        : new Blob([input], { type: STUDIO_BG3D_SHOT_PSD_MIME }),
    }],
    psdFallbacks: [],
  };
}

let realLayeredPsd: Blob | null = null;

function validLayeredPsd(): Blob {
  const data = () => new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  realLayeredPsd ??= buildStudioBg3dShotLayeredPsd([
    { role: "color", width: WIDTH, height: HEIGHT, data: data() },
    { role: "tone", width: WIDTH, height: HEIGHT, data: data() },
    { role: "texture-line", width: WIDTH, height: HEIGHT, data: data() },
    { role: "main-line", width: WIDTH, height: HEIGHT, data: data() },
  ]);
  return realLayeredPsd;
}

describe("Studio BG3D shot artifact integrity", () => {
  it("strictly separates opaque RGB8 contact PNGs from RGBA8 render PNGs", async () => {
    const options = {
      expectedWidth: WIDTH,
      expectedHeight: HEIGHT,
      maxBytes: 8 * 1_024 * 1_024,
    } as const;
    const rgb8 = new Blob([pngBytes(WIDTH, HEIGHT, 0, 0, 2)], { type: "image/png" });
    const rgba8 = validPngBlob();

    await expect(verifyStudioBg3dOpaqueRgb8PngFile(rgb8, options)).resolves.toMatchObject({
      byteSize: rgb8.size,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    await expect(verifyStudioBg3dOpaqueRgb8PngFile(rgba8, options))
      .rejects.toThrow(/opaque RGB8/iu);
    await expect(verifyStudioBg3dRgba8PngFile(rgb8, options))
      .rejects.toThrow(/RGBA8/iu);
    await expect(verifyStudioBg3dRgba8PngFile(rgba8, options)).resolves.toMatchObject({
      byteSize: rgba8.size,
    });
  });

  it("validates completeness and returns immutable SHA-256 receipts", async () => {
    const artifacts = validArtifacts();
    const pngSize = artifacts.images[0]!.png.size;
    const verified = await verifyStudioBg3dShotBatchShotArtifacts(
      await plan(),
      SHOT.id,
      artifacts,
    );

    expect(verified.totalBytes).toBe(pngSize);
    expect(verified.artifactCount).toBe(3);
    expect(verified.blobs).toEqual([{
      kind: "png",
      key: "shot-a:beauty",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      byteSize: pngSize,
    }]);
    expect(Object.isFrozen(verified)).toBe(true);
    expect(Object.isFrozen(verified.images)).toBe(true);
    expect(Object.isFrozen(verified.images[0])).toBe(true);
    await expect(reverifyStudioBg3dShotBatchShotArtifacts(
      await plan(),
      SHOT.id,
      verified,
    )).resolves.toMatchObject({
      totalBytes: pngSize,
      artifactCount: 3,
    });
  });

  it("stops before reading the next Blob when verification is aborted", async () => {
    const controller = new AbortController();
    const source = await validPngBlob().arrayBuffer();
    let firstReads = 0;
    let secondReads = 0;
    class FirstBlob extends Blob {
      override arrayBuffer(): Promise<ArrayBuffer> {
        firstReads += 1;
        controller.abort();
        return super.arrayBuffer();
      }
    }
    class SecondBlob extends Blob {
      override arrayBuffer(): Promise<ArrayBuffer> {
        secondReads += 1;
        return super.arrayBuffer();
      }
    }
    const base = validArtifacts();
    await expect(verifyStudioBg3dShotBatchShotArtifacts(await plan(), SHOT.id, {
      ...base,
      images: [
        { ...base.images[0]!, png: new FirstBlob([source], { type: "image/png" }) },
        {
          ...base.images[0]!,
          pass: "depth",
          png: new SecondBlob([source], { type: "image/png" }),
        },
      ],
      skippedArtifacts: [],
    }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(firstReads).toBe(1);
    expect(secondReads).toBe(0);
  });

  it("validates the actual ag-psd layered output and its receipt", async () => {
      const frozenPlan = await plan();
      const artifacts = artifactsWithPsd(validLayeredPsd());
      const verified = await verifyStudioBg3dShotBatchShotArtifacts(
        frozenPlan,
        SHOT.id,
        artifacts,
      );

      expect(verified.blobs).toEqual([
        expect.objectContaining({ kind: "png", key: "shot-a:beauty" }),
        expect.objectContaining({
          kind: "psd",
          key: "shot-a:layered-psd",
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        }),
      ]);
      await expect(reverifyStudioBg3dShotBatchShotArtifacts(
        frozenPlan,
        SHOT.id,
        verified,
      )).resolves.toMatchObject({ artifactCount: 3 });
  });

  it("rejects header-only, bad-CRC, truncated, IDAT-less, IEND-less, and bad-filter PNGs", async () => {
    const frozenPlan = await plan();
    const complete = pngBytes(WIDTH, HEIGHT);
    const badCrc = complete.slice();
    badCrc[29] = (badCrc[29] ?? 0) ^ 1;
    const malformed = [
      ["header-only", truncatedPngHeader(WIDTH, HEIGHT)],
      ["bad CRC", badCrc],
      ["truncated chunk", complete.slice(0, complete.byteLength - 20)],
      ["missing IDAT", pngWithoutIdat(WIDTH, HEIGHT)],
      ["missing IEND", complete.slice(0, complete.byteLength - 12)],
      ["invalid scanline filter", pngBytes(WIDTH, HEIGHT, 0, 5)],
    ] as const;

    for (const [caseName, bytes] of malformed) {
      const artifacts = validArtifacts();
      await expect(verifyStudioBg3dShotBatchShotArtifacts(frozenPlan, SHOT.id, {
        ...artifacts,
        images: [{
          ...artifacts.images[0]!,
          png: new Blob([bytes], { type: "image/png" }),
        }],
      }), caseName).rejects.toThrow(/PNG/iu);
    }
  });

  it("rejects truncated headers, nonzero reserved bytes, invalid sections, and bad PSD composites", async () => {
    const frozenPlan = await plan();
    const complete = psdBytes(WIDTH, HEIGHT, "raw");
    const nonzeroReserved = complete.slice();
    nonzeroReserved[6] = 1;
    const invalidSection = complete.slice();
    new DataView(invalidSection.buffer).setUint32(26, invalidSection.byteLength, false);
    const unsupportedCompression = complete.slice();
    new DataView(unsupportedCompression.buffer).setUint16(38, 2, false);
    const malformed = [
      ["zero-layer composite-only PSD", complete],
      ["header-only", complete.slice(0, 26)],
      ["nonzero reserved header", nonzeroReserved],
      ["out-of-bounds section", invalidSection],
      ["truncated raw composite", complete.slice(0, complete.byteLength - 1)],
      ["unsupported compression", unsupportedCompression],
    ] as const;

    for (const [caseName, bytes] of malformed) {
      await expect(verifyStudioBg3dShotBatchShotArtifacts(
        frozenPlan,
        SHOT.id,
        artifactsWithPsd(bytes),
      ), caseName).rejects.toThrow(/PSD/iu);
    }
  });

  it("rejects forged layered PSD counts, rectangles, and channel bounds", async () => {
    const frozenPlan = await plan();
    const actual = new Uint8Array(await validLayeredPsd().arrayBuffer());
    const locateFirstLayerRecord = (bytes: Uint8Array) => {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let offset = 26;
      offset += 4 + view.getUint32(offset, false);
      offset += 4 + view.getUint32(offset, false);
      const layerInfoOffset = offset + 4;
      return { view, layerCountOffset: layerInfoOffset + 4, recordOffset: layerInfoOffset + 6 };
    };
    const zeroLayers = actual.slice();
    locateFirstLayerRecord(zeroLayers).view.setInt16(
      locateFirstLayerRecord(zeroLayers).layerCountOffset,
      0,
      false,
    );
    const badRectangle = actual.slice();
    const badRectangleLocation = locateFirstLayerRecord(badRectangle);
    badRectangleLocation.view.setInt32(
      badRectangleLocation.recordOffset + 12,
      WIDTH - 1,
      false,
    );
    const badChannelLength = actual.slice();
    const badChannelLocation = locateFirstLayerRecord(badChannelLength);
    badChannelLocation.view.setUint32(
      badChannelLocation.recordOffset + 20,
      0xffff_ffff,
      false,
    );

    for (const bytes of [zeroLayers, badRectangle, badChannelLength]) {
      await expect(verifyStudioBg3dShotBatchShotArtifacts(
        frozenPlan,
        SHOT.id,
        artifactsWithPsd(bytes),
      )).rejects.toThrow(/PSD/iu);
    }
  });

  it("rejects missing, duplicate, forged, and unknown-field pass metadata", async () => {
    const frozenPlan = await plan();
    const valid = validArtifacts();
    await expect(verifyStudioBg3dShotBatchShotArtifacts(frozenPlan, SHOT.id, {
      ...valid,
      skippedArtifacts: [],
    })).rejects.toThrow(/완료 또는 생략/iu);
    await expect(verifyStudioBg3dShotBatchShotArtifacts(frozenPlan, SHOT.id, {
      ...valid,
      skippedArtifacts: [{
        shotId: SHOT.id,
        shotName: SHOT.name,
        pass: "beauty",
        reason: "disabled",
      }],
    })).rejects.toThrow(/중복/iu);
    await expect(verifyStudioBg3dShotBatchShotArtifacts(frozenPlan, SHOT.id, {
      ...valid,
      images: [{ ...valid.images[0]!, width: 639 }],
    })).rejects.toThrow(/고정 계획/iu);
    await expect(verifyStudioBg3dShotBatchShotArtifacts(
      frozenPlan,
      SHOT.id,
      { ...valid, forgedScope: "user-b" } as StudioBg3dShotBatchShotArtifacts,
    )).rejects.toThrow(/묶음/iu);
  });

  it("detects changed persisted bytes and forged receipt ledgers", async () => {
    const frozenPlan = await plan();
    const verified = await verifyStudioBg3dShotBatchShotArtifacts(
      frozenPlan,
      SHOT.id,
      validArtifacts(),
    );
    const changedBytes = {
      ...verified,
      images: [{ ...verified.images[0]!, png: validArtifacts(1).images[0]!.png }],
    };
    await expect(reverifyStudioBg3dShotBatchShotArtifacts(
      frozenPlan,
      SHOT.id,
      changedBytes,
    )).rejects.toThrow(/영수증/iu);
    await expect(reverifyStudioBg3dShotBatchShotArtifacts(
      frozenPlan,
      SHOT.id,
      { ...verified, totalBytes: verified.totalBytes + 1 },
    )).rejects.toThrow(/영수증/iu);
    const forgedReceipts = {
      ...verified,
      blobs: [{ ...verified.blobs[0]!, unexpected: true }],
    } as unknown as typeof verified;
    await expect(reverifyStudioBg3dShotBatchShotArtifacts(
      frozenPlan,
      SHOT.id,
      forgedReceipts,
    )).rejects.toThrow(/영수증/iu);
  });

  it("uses one pre-await snapshot when caller metadata mutates during hashing", async () => {
    const frozenPlan = await plan();
    const mutable = validArtifacts();
    const pending = verifyStudioBg3dShotBatchShotArtifacts(frozenPlan, SHOT.id, mutable);
    const replacement = { ...mutable.images[0]!, width: 1 };
    (mutable.images as typeof replacement[])[0] = replacement;

    const verified = await pending;
    expect(verified.images[0]?.width).toBe(640);
    expect(verified.blobs[0]?.key).toBe("shot-a:beauty");
  });
});
