import { describe, expect, it } from "vitest";

import {
  inspectStrictJpegDimensions,
  inspectStrictStaticWebpDimensions,
  STRICT_RASTER_MAX_JPEG_SEGMENTS,
  STRICT_RASTER_MAX_WEBP_CHUNKS,
} from "./strict-raster-image-inspector";

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function webpChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(8 + data.byteLength + (data.byteLength % 2));
  output.set(new TextEncoder().encode(type), 0);
  new DataView(output.buffer).setUint32(4, data.byteLength, true);
  output.set(data, 8);
  return output;
}

function vp8l(width: number, height: number): Uint8Array<ArrayBuffer> {
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  return new Uint8Array([
    0x2f,
    widthMinusOne & 0xff,
    ((widthMinusOne >> 8) & 0x3f) | ((heightMinusOne & 0x03) << 6),
    (heightMinusOne >> 2) & 0xff,
    (heightMinusOne >> 10) & 0x0f,
  ]);
}

function vp8x(width: number, height: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(10);
  const view = new DataView(data.buffer);
  view.setUint32(4, width - 1, true);
  view.setUint16(7, height - 1, true);
  data[9] = ((height - 1) >> 16) & 0xff;
  return data;
}

function webp(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const body = concat(chunks);
  const output = new Uint8Array(12 + body.byteLength);
  output.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(output.buffer).setUint32(4, output.byteLength - 8, true);
  output.set(new TextEncoder().encode("WEBP"), 8);
  output.set(body, 12);
  return output;
}

function jpeg(appSegments: number, duplicateSof = false): Uint8Array<ArrayBuffer> {
  const app = new Uint8Array([0xff, 0xe0, 0x00, 0x02]);
  const sof = new Uint8Array([
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01,
    0x01, 0x01, 0x11, 0x00,
  ]);
  const scan = new Uint8Array([
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0x00,
  ]);
  return concat([
    new Uint8Array([0xff, 0xd8]),
    ...Array.from({ length: appSegments }, () => app),
    sof,
    ...(duplicateSof ? [sof] : []),
    scan,
    new Uint8Array([0xff, 0xd9]),
  ]);
}

describe("strict raster image inspector", () => {
  it("accepts one static WebP payload and rejects a mismatched VP8X canvas", () => {
    expect(inspectStrictStaticWebpDimensions(webp([webpChunk("VP8L", vp8l(2, 3))])))
      .toEqual({ width: 2, height: 3 });
    expect(() => inspectStrictStaticWebpDimensions(webp([
      webpChunk("VP8X", vp8x(1, 1)),
      webpChunk("VP8L", vp8l(4_096, 4_096)),
    ]))).toThrow("invalid-webp");
  });

  it("rejects duplicate payloads, RIFF drift, animation, and chunk-count overflow", () => {
    expect(() => inspectStrictStaticWebpDimensions(webp([
      webpChunk("VP8L", vp8l(1, 1)),
      webpChunk("VP8L", vp8l(1, 1)),
    ]))).toThrow("invalid-webp");

    const drift = webp([webpChunk("VP8L", vp8l(1, 1))]);
    new DataView(drift.buffer).setUint32(4, drift.byteLength, true);
    expect(() => inspectStrictStaticWebpDimensions(drift)).toThrow("invalid-webp");

    const nonZeroPadding = webp([webpChunk("VP8L", vp8l(1, 1))]);
    nonZeroPadding[nonZeroPadding.byteLength - 1] = 0xff;
    expect(() => inspectStrictStaticWebpDimensions(nonZeroPadding)).toThrow("invalid-webp");

    const animatedHeader = vp8x(1, 1);
    animatedHeader[0] = 0x02;
    expect(() => inspectStrictStaticWebpDimensions(webp([
      webpChunk("VP8X", animatedHeader),
      webpChunk("ANIM", new Uint8Array(6)),
    ]))).toThrow("invalid-webp");

    const atLimitPadding = Array.from(
      { length: STRICT_RASTER_MAX_WEBP_CHUNKS - 2 },
      () => webpChunk("JUNK", new Uint8Array()),
    );
    expect(inspectStrictStaticWebpDimensions(webp([
      webpChunk("VP8X", vp8x(1, 1)),
      ...atLimitPadding,
      webpChunk("VP8L", vp8l(1, 1)),
    ]))).toEqual({ width: 1, height: 1 });
    expect(() => inspectStrictStaticWebpDimensions(webp([
      webpChunk("VP8X", vp8x(1, 1)),
      ...atLimitPadding,
      webpChunk("JUNK", new Uint8Array()),
      webpChunk("VP8L", vp8l(1, 1)),
    ]))).toThrow("webp-structure-too-complex");
  });

  it("rejects duplicate JPEG SOF and enforces the segment iteration ceiling", () => {
    expect(inspectStrictJpegDimensions(jpeg(0))).toEqual({ width: 1, height: 1 });
    expect(() => inspectStrictJpegDimensions(jpeg(0, true))).toThrow("invalid-jpeg");
    expect(inspectStrictJpegDimensions(
      jpeg(STRICT_RASTER_MAX_JPEG_SEGMENTS - 3),
    )).toEqual({ width: 1, height: 1 });
    expect(() => inspectStrictJpegDimensions(
      jpeg(STRICT_RASTER_MAX_JPEG_SEGMENTS - 2),
    )).toThrow("jpeg-structure-too-complex");

    const restartOutsideEntropy = jpeg(0);
    const withRestart = concat([
      restartOutsideEntropy.subarray(0, 2),
      new Uint8Array([0xff, 0xd0]),
      restartOutsideEntropy.subarray(2),
    ]);
    expect(() => inspectStrictJpegDimensions(withRestart)).toThrow("invalid-jpeg");
  });
});
