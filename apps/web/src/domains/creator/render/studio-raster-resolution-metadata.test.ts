import { afterEach, describe, expect, it } from "vitest";

import {
  dpiForPixelsInBox,
  dpiToPixelsPerMetre,
  isJpegBytes,
  isPngBytes,
  publishStudioExportPrintBoxMm,
  publishStudioExportResolutionDpi,
  rasterResolutionTagKind,
  readJpegJfifDensity,
  readJpegPixelSize,
  readPngPhysDensity,
  readPngPixelSize,
  readStudioExportPrintBoxMm,
  readStudioExportResolutionDpi,
  resetStudioExportResolutionDpi,
  tagStudioRasterBlobResolution,
  withJpegJfifDensity,
  withPngPhysDensity,
  withRasterResolutionMetadata,
} from "./studio-raster-resolution-metadata";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function crc32(bytes: Uint8Array): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xed_b8_83_20 : crc >>> 1;
    }
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

function chunk(type: string, data: number[]): number[] {
  const body = new Uint8Array(4 + data.length);
  body.set([...type].map((character) => character.charCodeAt(0)), 0);
  body.set(data, 4);
  const crc = crc32(body);
  return [
    (data.length >>> 24) & 0xff,
    (data.length >>> 16) & 0xff,
    (data.length >>> 8) & 0xff,
    data.length & 0xff,
    ...body,
    (crc >>> 24) & 0xff,
    (crc >>> 16) & 0xff,
    (crc >>> 8) & 0xff,
    crc & 0xff,
  ];
}

function fakePng(options: { withPhys?: boolean } = {}): Uint8Array {
  const ihdr = chunk("IHDR", [
    0, 0, 2, 208, // width 720
    0, 0, 4, 56, // height 1080
    8, 6, 0, 0, 0,
  ]);
  const phys = options.withPhys
    ? chunk("pHYs", [0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1])
    : [];
  return new Uint8Array([
    ...PNG_SIGNATURE,
    ...ihdr,
    ...phys,
    ...chunk("IDAT", [1, 2, 3, 4]),
    ...chunk("IEND", []),
  ]);
}

/** Chrome's canvas JPEG has no JFIF APP0 — it opens straight into a DQT segment. */
function jpegWithoutJfif(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x11, 0x22, 0xff, 0xd9]);
}

function jpegWithJfif(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x02,
    0x00, // units: aspect ratio only (the canvas default that print shops read as 72 DPI)
    0x00, 0x01, 0x00, 0x01,
    0x00, 0x00,
    0xff, 0xd9,
  ]);
}

afterEach(() => {
  resetStudioExportResolutionDpi();
});

describe("rasterResolutionTagKind", () => {
  it("only claims the containers that can actually carry a density", () => {
    expect(rasterResolutionTagKind("image/png")).toBe("png-phys");
    expect(rasterResolutionTagKind("image/jpeg")).toBe("jpeg-jfif");
    // WebP density needs a VP8X re-mux and QOI has no resolution field at all.
    expect(rasterResolutionTagKind("image/webp")).toBe("none");
    expect(rasterResolutionTagKind("image/qoi")).toBe("none");
  });
});

describe("PNG pHYs", () => {
  it("writes a metre-unit pHYs chunk that reads back as the requested DPI", () => {
    const tagged = withPngPhysDensity(fakePng(), 300);
    expect(isPngBytes(tagged)).toBe(true);
    const reading = readPngPhysDensity(tagged);
    expect(reading).not.toBeNull();
    expect(reading!.dpiX).toBeCloseTo(300, 1);
    expect(reading!.dpiY).toBeCloseTo(300, 1);
    expect(dpiToPixelsPerMetre(300)).toBe(11_811);
  });

  it("keeps IHDR/IDAT bytes untouched and inserts pHYs before IDAT", () => {
    const source = fakePng();
    const tagged = withPngPhysDensity(source, 300);
    expect(tagged.length).toBe(source.length + 21);
    // Signature + IHDR are byte-identical: pixels and header never move.
    expect([...tagged.subarray(0, 8 + 25)]).toEqual([...source.subarray(0, 8 + 25)]);
    const order: string[] = [];
    let offset = 8;
    while (offset + 12 <= tagged.length) {
      const length =
        (tagged[offset]! << 24) | (tagged[offset + 1]! << 16) | (tagged[offset + 2]! << 8) | tagged[offset + 3]!;
      order.push(String.fromCharCode(...tagged.subarray(offset + 4, offset + 8)));
      offset += 12 + length;
    }
    expect(order).toEqual(["IHDR", "pHYs", "IDAT", "IEND"]);
  });

  it("replaces an existing pHYs instead of appending a second one", () => {
    const tagged = withPngPhysDensity(fakePng({ withPhys: true }), 600);
    const count = [...tagged].filter((_, index) =>
      String.fromCharCode(...tagged.subarray(index, index + 4)) === "pHYs"
    ).length;
    expect(count).toBe(1);
    expect(readPngPhysDensity(tagged)!.dpiX).toBeCloseTo(600, 1);
  });

  it("returns non-PNG or invalid DPI input untouched", () => {
    const notPng = new Uint8Array([1, 2, 3, 4]);
    expect(withPngPhysDensity(notPng, 300)).toBe(notPng);
    const png = fakePng();
    expect(withPngPhysDensity(png, 0)).toBe(png);
    expect(withPngPhysDensity(png, Number.NaN)).toBe(png);
  });
});

describe("JPEG JFIF density", () => {
  it("inserts a JFIF APP0 when the encoder omitted one", () => {
    const source = jpegWithoutJfif();
    const tagged = withJpegJfifDensity(source, 300);
    expect(isJpegBytes(tagged)).toBe(true);
    expect(tagged.length).toBe(source.length + 18);
    expect(readJpegJfifDensity(tagged)).toEqual({ dpiX: 300, dpiY: 300 });
    // The original entropy-coded payload follows the inserted APP0 unchanged.
    expect([...tagged.subarray(20)]).toEqual([...source.subarray(2)]);
  });

  it("rewrites an aspect-ratio-only JFIF to dots-per-inch in place", () => {
    const source = jpegWithJfif();
    expect(readJpegJfifDensity(source)).toBeNull();
    const tagged = withJpegJfifDensity(source, 300);
    expect(tagged.length).toBe(source.length);
    expect(readJpegJfifDensity(tagged)).toEqual({ dpiX: 300, dpiY: 300 });
  });
});

describe("published export resolution channel", () => {
  it("defaults to untagged so untouched export paths keep byte-identical output", async () => {
    expect(readStudioExportResolutionDpi()).toBeNull();
    const blob = new Blob([fakePng() as unknown as BlobPart], { type: "image/png" });
    await expect(tagStudioRasterBlobResolution(blob, "image/png")).resolves.toBe(blob);
  });

  it("tags PNG blobs once a resolution is published", async () => {
    publishStudioExportResolutionDpi(300);
    expect(readStudioExportResolutionDpi()).toBe(300);
    const blob = new Blob([fakePng() as unknown as BlobPart], { type: "image/png" });
    const tagged = await tagStudioRasterBlobResolution(blob, "image/png");
    expect(tagged).not.toBe(blob);
    const reading = readPngPhysDensity(new Uint8Array(await tagged.arrayBuffer()));
    expect(reading!.dpiX).toBeCloseTo(300, 1);
  });

  it("passes containers that cannot carry a density straight through", async () => {
    publishStudioExportResolutionDpi(300);
    const blob = new Blob([new Uint8Array([1, 2, 3]) as unknown as BlobPart], { type: "image/webp" });
    await expect(tagStudioRasterBlobResolution(blob, "image/webp")).resolves.toBe(blob);
  });

  it("rejects unusable DPI values instead of publishing them", () => {
    publishStudioExportResolutionDpi(Number.POSITIVE_INFINITY);
    expect(readStudioExportResolutionDpi()).toBeNull();
    publishStudioExportResolutionDpi(-10);
    expect(readStudioExportResolutionDpi()).toBeNull();
  });
});

describe("withRasterResolutionMetadata", () => {
  it("routes each MIME type to the tag its container supports", () => {
    expect(readPngPhysDensity(withRasterResolutionMetadata(fakePng(), "image/png", 144))!.dpiX)
      .toBeCloseTo(144, 1);
    expect(readJpegJfifDensity(withRasterResolutionMetadata(jpegWithoutJfif(), "image/jpeg", 144)))
      .toEqual({ dpiX: 144, dpiY: 144 });
    const webp = new Uint8Array([1, 2, 3]);
    expect(withRasterResolutionMetadata(webp, "image/webp", 144)).toBe(webp);
  });
});

describe("measured print density (print box channel)", () => {
  /** PNG whose IHDR declares an arbitrary size — stand-in for a real export. */
  function pngWithSize(width: number, height: number): Uint8Array {
    const be32 = (value: number) => [
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ];
    return new Uint8Array([
      ...PNG_SIGNATURE,
      ...chunk("IHDR", [...be32(width), ...be32(height), 8, 6, 0, 0, 0]),
      ...chunk("IDAT", [1, 2, 3, 4]),
      ...chunk("IEND", []),
    ]);
  }

  it("reads the real pixel size out of IHDR", () => {
    expect(readPngPixelSize(pngWithSize(2556, 3833))).toEqual({ width: 2556, height: 3833 });
    expect(readPngPixelSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("reads the real pixel size out of a JPEG frame header", () => {
    // SOI, APP0(JFIF), DQT, SOF0 (height 3833, width 2556), EOI
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x01,
      0x00, 0x48, 0x00, 0x48, 0x00, 0x00,
      0xff, 0xdb, 0x00, 0x04, 0x11, 0x22,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x0e, 0xf9, 0x09, 0xfc, 0x03,
      0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
      0xff, 0xd9,
    ]);
    expect(readJpegPixelSize(jpeg)).toEqual({ width: 2556, height: 3833 });
  });

  it("derives DPI from the limiting axis of the output box", () => {
    // A4 + 3 mm bleed = 216×303 mm. 2556 px wide → 300.57 DPI on the limiting width axis.
    const dpi = dpiForPixelsInBox({ width: 2556, height: 3833 }, { widthMm: 216, heightMm: 303 });
    expect(dpi).toBeCloseTo(300.57, 1);
  });

  it("records the DPI the encoded pixels really achieve, not the predicted one", async () => {
    // The panel predicted 3834 rows; the browser wrote 3833. The tag must follow the bytes.
    publishStudioExportResolutionDpi(999);
    publishStudioExportPrintBoxMm({ widthMm: 216, heightMm: 303 });
    const blob = new Blob([pngWithSize(2556, 3833) as unknown as BlobPart], { type: "image/png" });
    const tagged = await tagStudioRasterBlobResolution(blob, "image/png");
    const reading = readPngPhysDensity(new Uint8Array(await tagged.arrayBuffer()));
    expect(reading!.dpiX).toBeCloseTo(300.57, 0);
    // The stale published DPI must not win.
    expect(reading!.dpiX).toBeLessThan(400);
  });

  it("falls back to the published DPI when no print box is set (screen packs)", async () => {
    publishStudioExportResolutionDpi(72);
    publishStudioExportPrintBoxMm(null);
    const blob = new Blob([pngWithSize(1440, 2160) as unknown as BlobPart], { type: "image/png" });
    const tagged = await tagStudioRasterBlobResolution(blob, "image/png");
    const reading = readPngPhysDensity(new Uint8Array(await tagged.arrayBuffer()));
    expect(reading!.dpiX).toBeCloseTo(72, 0);
  });

  it("rejects a non-positive print box instead of publishing it", () => {
    publishStudioExportPrintBoxMm({ widthMm: 0, heightMm: 303 });
    expect(readStudioExportPrintBoxMm()).toBeNull();
    publishStudioExportPrintBoxMm({ widthMm: Number.NaN, heightMm: 303 });
    expect(readStudioExportPrintBoxMm()).toBeNull();
  });
});
