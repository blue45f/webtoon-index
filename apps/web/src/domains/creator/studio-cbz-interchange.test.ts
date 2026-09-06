import { describe, expect, it } from "vitest";

import {
  buildStudioCbzBlob as buildStudioCbzBlobWithBackend,
  buildStudioCbzBytes as buildStudioCbzBytesWithBackend,
  compareStudioCbzPagePaths,
  importStudioCbz,
  STUDIO_CBZ_MIME,
  StudioCbzError,
  type StudioCbzErrorCode,
} from "./studio-cbz-interchange";
import {
  buildStudioPackageArchiveBytes as buildStudioPackageArchiveBytesWithBackend,
} from "./studio-package-archive";
import { readStudioZipArchive } from "./studio-zip-reader";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function buildStudioCbzBytes(
  input: Parameters<typeof buildStudioCbzBytesWithBackend>[0],
  options: NonNullable<Parameters<typeof buildStudioCbzBytesWithBackend>[1]> = {},
): ReturnType<typeof buildStudioCbzBytesWithBackend> {
  return buildStudioCbzBytesWithBackend(input, {
    crc32ExecutionMode: "direct-headless",
    ...options,
  });
}

function buildStudioCbzBlob(
  input: Parameters<typeof buildStudioCbzBlobWithBackend>[0],
  options: NonNullable<Parameters<typeof buildStudioCbzBlobWithBackend>[1]> = {},
): ReturnType<typeof buildStudioCbzBlobWithBackend> {
  return buildStudioCbzBlobWithBackend(input, {
    crc32ExecutionMode: "direct-headless",
    ...options,
  });
}

function buildStudioPackageArchiveBytes(
  entries: Parameters<typeof buildStudioPackageArchiveBytesWithBackend>[0],
  options: NonNullable<Parameters<typeof buildStudioPackageArchiveBytesWithBackend>[1]> = {},
): ReturnType<typeof buildStudioPackageArchiveBytesWithBackend> {
  return buildStudioPackageArchiveBytesWithBackend(entries, {
    crc32ExecutionMode: "direct-headless",
    ...options,
  });
}

function png(seed: number): Uint8Array {
  return pngWithDimensions(1, 1, seed);
}

function pngWithDimensions(width: number, height: number, seed = 1): Uint8Array {
  const bytes = new Uint8Array(58);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set(encoder.encode("IHDR"), 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  bytes.set([8, 6, 0, 0, 0], 24);
  view.setUint32(33, 1, false);
  bytes.set(encoder.encode("IDAT"), 37);
  bytes[41] = seed;
  view.setUint32(46, 0, false);
  bytes.set(encoder.encode("IEND"), 50);
  return bytes;
}

function jpeg(seed: number, width = 1, height = 1): Uint8Array {
  const bytes = new Uint8Array(38);
  const view = new DataView(bytes.buffer);
  bytes.set([0xff, 0xd8, 0xff, 0xc0], 0);
  view.setUint16(4, 17, false);
  bytes[6] = 8;
  view.setUint16(7, height, false);
  view.setUint16(9, width, false);
  bytes[11] = 3;
  bytes.set([1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0], 12);
  bytes.set([0xff, 0xda], 21);
  view.setUint16(23, 12, false);
  bytes.set([3, 1, 0, 2, 0, 3, 0, 0, 63, 0], 25);
  bytes[35] = seed;
  bytes.set([0xff, 0xd9], 36);
  return bytes;
}

function webp(seed: number, width = 1, height = 1): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set(encoder.encode("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, bytes.byteLength - 8, true);
  bytes.set(encoder.encode("WEBP"), 8);
  bytes.set(encoder.encode("VP8 "), 12);
  new DataView(bytes.buffer).setUint32(16, 10, true);
  bytes.set([seed, 0, 0, 0x9d, 0x01, 0x2a], 20);
  new DataView(bytes.buffer).setUint16(26, width, true);
  new DataView(bytes.buffer).setUint16(28, height, true);
  return bytes;
}

function losslessWebp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(26);
  const view = new DataView(bytes.buffer);
  bytes.set(encoder.encode("RIFF"), 0);
  view.setUint32(4, bytes.byteLength - 8, true);
  bytes.set(encoder.encode("WEBPVP8L"), 8);
  view.setUint32(16, 5, true);
  bytes[20] = 0x2f;
  view.setUint32(21, (width - 1) | ((height - 1) << 14), true);
  return bytes;
}

function gif(seed: number, width = 1, height = 1): Uint8Array {
  const bytes = new Uint8Array(29);
  const view = new DataView(bytes.buffer);
  bytes.set(encoder.encode("GIF89a"), 0);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  bytes.set([0, 0, 0, 0x2c], 10);
  view.setUint16(14, 0, true);
  view.setUint16(16, 0, true);
  view.setUint16(18, width, true);
  view.setUint16(20, height, true);
  bytes.set([0, 2, 2, seed, 1, 0, 0x3b], 22);
  return bytes;
}

function replaceEqualLengthUtf8(source: Uint8Array, from: string, to: string): Uint8Array {
  const fromBytes = encoder.encode(from);
  const toBytes = encoder.encode(to);
  expect(toBytes.byteLength).toBe(fromBytes.byteLength);
  const output = source.slice();
  let replacements = 0;
  for (let offset = 0; offset <= output.byteLength - fromBytes.byteLength; offset += 1) {
    let matches = true;
    for (let index = 0; index < fromBytes.byteLength; index += 1) {
      if (output[offset + index] !== fromBytes[index]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    output.set(toBytes, offset);
    replacements += 1;
    offset += fromBytes.byteLength - 1;
  }
  expect(replacements).toBe(2);
  return output;
}

function mutateStoredEntryIntoRatioBomb(source: Uint8Array): Uint8Array {
  const output = source.slice();
  const view = new DataView(output.buffer);
  view.setUint32(22, 101, true);
  let centralOffset = -1;
  for (let offset = 0; offset <= output.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      centralOffset = offset;
      break;
    }
  }
  expect(centralOffset).toBeGreaterThan(0);
  view.setUint32(centralOffset + 24, 101, true);
  return output;
}

function corruptFirstStoredPayload(source: Uint8Array): Uint8Array {
  const output = source.slice();
  const view = new DataView(output.buffer);
  const dataOffset = 30 + view.getUint16(26, true) + view.getUint16(28, true);
  expect(dataOffset).toBeLessThan(output.byteLength);
  output[dataOffset] = (output[dataOffset] ?? 0) ^ 0xff;
  return output;
}

async function expectCbzError(
  promise: Promise<unknown>,
  code: StudioCbzErrorCode
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected ${code}`);
  } catch (cause) {
    expect(cause).toBeInstanceOf(StudioCbzError);
    expect((cause as StudioCbzError).code).toBe(code);
  }
}

describe("CBZ interchange", () => {
  it("exports deterministic canonical page order and escaped ComicInfo metadata", async () => {
    const input = {
      pages: [{ image: png(1) }, { image: jpeg(2) }, { image: webp(3) }, { image: gif(4) }],
      metadata: {
        title: "Hero & <Villain>",
        series: 'Toon "Spectrum"',
        number: "12.5",
        volume: 2,
        summary: "One 'quoted' summary",
        writer: "Writer Kim",
        genre: ["Fantasy", "Drama & Comedy"],
        tags: ["webtoon", "vertical scroll"],
        languageISO: "ko",
        blackAndWhite: false,
      },
    };
    const first = await buildStudioCbzBytes(input);
    const second = await buildStudioCbzBytes(input);
    expect([...first.bytes]).toEqual([...second.bytes]);
    expect(first.warnings).toEqual([]);

    const zip = await readStudioZipArchive(first.bytes);
    expect(zip.entries.map((entry) => entry.path)).toEqual([
      "ComicInfo.xml",
      "pages/0001.png",
      "pages/0002.jpg",
      "pages/0003.webp",
      "pages/0004.gif",
    ]);
    const xml = decoder.decode(await zip.readEntry("ComicInfo.xml"));
    expect(xml).toContain("<Title>Hero &amp; &lt;Villain&gt;</Title>");
    expect(xml).toContain("<Series>Toon &quot;Spectrum&quot;</Series>");
    expect(xml).toContain("<Genre>Fantasy, Drama &amp; Comedy</Genre>");
    expect(xml).toContain('<Page Image="0" Type="FrontCover"/>');
    expect(xml).toContain("<PageCount>4</PageCount>");

    const imported = await importStudioCbz(first.bytes);
    expect(imported.pages.map(({ index, path, mimeType, width, height }) => ({
      index,
      path,
      mimeType,
      width,
      height,
    }))).toEqual([
      { index: 0, path: "pages/0001.png", mimeType: "image/png", width: 1, height: 1 },
      { index: 1, path: "pages/0002.jpg", mimeType: "image/jpeg", width: 1, height: 1 },
      { index: 2, path: "pages/0003.webp", mimeType: "image/webp", width: 1, height: 1 },
      { index: 3, path: "pages/0004.gif", mimeType: "image/gif", width: 1, height: 1 },
    ]);
    expect(imported.metadata).toMatchObject({
      title: "Hero & <Villain>",
      series: 'Toon "Spectrum"',
      number: "12.5",
      volume: 2,
      summary: "One 'quoted' summary",
      writer: "Writer Kim",
      genre: ["Fantasy", "Drama & Comedy"],
      tags: ["webtoon", "vertical scroll"],
      languageISO: "ko",
      blackAndWhite: false,
    });
    expect(imported.warnings).toEqual([]);
    expect(imported.pages[2]?.image.type).toBe("image/webp");
    expect(imported.pages[3]?.image.type).toBe("image/gif");
    expect(imported.summary).toEqual({
      pageCount: 4,
      totalEncodedBytes: png(1).byteLength + jpeg(2).byteLength + webp(3).byteLength + gif(4).byteLength,
      totalDecodedPixels: 4,
      totalDecodedBytes: 16,
      maxWidth: 1,
      maxHeight: 1,
      hasComicInfo: true,
      ignoredEntryCount: 0,
    });
  });

  it("builds an application/vnd.comicbook+zip Blob through the shared writer", async () => {
    const result = await buildStudioCbzBlob({ pages: [{ image: png(1) }] });
    expect(result.blob.type).toBe(STUDIO_CBZ_MIME);
    expect((await importStudioCbz(result.blob)).pages).toHaveLength(1);
  });

  it("uses deterministic natural ordering for arbitrary imported page paths", async () => {
    const archive = await buildStudioPackageArchiveBytes([
      { path: "page10.jpg", data: jpeg(10) },
      { path: "page02.png", data: png(2) },
      { path: "page2.png", data: png(3) },
      { path: "page001.webp", data: webp(1) },
      { path: "notes.txt", data: encoder.encode("ignore") },
      { path: "__MACOSX/._page2.png", data: encoder.encode("resource fork") },
    ]);

    const imported = await importStudioCbz(archive);
    expect(imported.pages.map((page) => page.path)).toEqual([
      "page001.webp",
      "page2.png",
      "page02.png",
      "page10.jpg",
    ]);
    expect(imported.warnings).toEqual([
      expect.objectContaining({ code: "COMICINFO_MISSING" }),
      expect.objectContaining({ code: "IGNORED_ENTRY", path: "notes.txt" }),
      expect.objectContaining({ code: "IGNORED_ENTRY", path: "__MACOSX/._page2.png" }),
    ]);
    expect(imported.summary).toMatchObject({
      pageCount: 4,
      hasComicInfo: false,
      ignoredEntryCount: 2,
    });
    expect([
      "page10.png",
      "page2.png",
      "page001.png",
      "page02.png",
    ].sort(compareStudioCbzPagePaths)).toEqual([
      "page001.png",
      "page2.png",
      "page02.png",
      "page10.png",
    ]);
  });

  it("reports ComicInfo page-count mismatches", async () => {
    const archive = await buildStudioPackageArchiveBytes([
      {
        path: "ComicInfo.xml",
        data: encoder.encode(
          '<?xml version="1.0"?><ComicInfo><Title>Mismatch</Title><PageCount>9</PageCount></ComicInfo>'
        ),
      },
      { path: "1.png", data: png(1) },
      { path: "2.png", data: png(2) },
    ]);

    const imported = await importStudioCbz(archive);
    expect(imported.metadata.title).toBe("Mismatch");
    expect(imported.warnings).toEqual([
      expect.objectContaining({ code: "PAGE_COUNT_MISMATCH" }),
    ]);
  });

  it("rejects extension/signature mismatches and malformed image formats", async () => {
    const mismatch = await buildStudioPackageArchiveBytes([
      { path: "ComicInfo.xml", data: encoder.encode("<ComicInfo>") },
      { path: "page.jpg", data: png(1) },
    ]);
    await expectCbzError(importStudioCbz(mismatch), "COMICINFO_INVALID");

    const badImage = await buildStudioPackageArchiveBytes([
      { path: "page.png", data: encoder.encode("not png") },
    ]);
    await expectCbzError(importStudioCbz(badImage), "IMAGE_INVALID");

    const wrongExtension = await buildStudioPackageArchiveBytes([
      { path: "page.jpg", data: png(1) },
    ]);
    await expectCbzError(importStudioCbz(wrongExtension), "IMAGE_INVALID");

    const malformedWebp = webp(1);
    new DataView(malformedWebp.buffer).setUint32(4, 999, true);
    await expectCbzError(
      buildStudioCbzBytes({ pages: [{ image: malformedWebp }] }),
      "IMAGE_INVALID"
    );

    const truncatedPng = png(1).subarray(0, 24);
    await expectCbzError(
      buildStudioCbzBytes({ pages: [{ image: truncatedPng }] }),
      "IMAGE_INVALID"
    );
    const missingGifTrailer = gif(1).subarray(0, gif(1).byteLength - 1);
    await expectCbzError(
      buildStudioCbzBytes({ pages: [{ image: missingGifTrailer }] }),
      "IMAGE_INVALID"
    );
    const noJpegDimensions = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
    await expectCbzError(
      buildStudioCbzBytes({ pages: [{ image: noJpegDimensions }] }),
      "IMAGE_INVALID"
    );
  });

  it("returns authenticated dimensions and enforces decoded pixel and byte budgets", async () => {
    const archive = await buildStudioPackageArchiveBytes([
      { path: "1.png", data: pngWithDimensions(12, 20) },
      { path: "2.jpg", data: jpeg(2, 30, 7) },
      { path: "3.webp", data: webp(3, 9, 11) },
      { path: "4.webp", data: losslessWebp(13, 17) },
      { path: "5.gif", data: gif(4, 6, 8) },
    ]);
    const imported = await importStudioCbz(archive);
    expect(imported.pages.map(({ width, height, pixelCount, decodedByteSize }) => ({
      width,
      height,
      pixelCount,
      decodedByteSize,
    }))).toEqual([
      { width: 12, height: 20, pixelCount: 240, decodedByteSize: 960 },
      { width: 30, height: 7, pixelCount: 210, decodedByteSize: 840 },
      { width: 9, height: 11, pixelCount: 99, decodedByteSize: 396 },
      { width: 13, height: 17, pixelCount: 221, decodedByteSize: 884 },
      { width: 6, height: 8, pixelCount: 48, decodedByteSize: 192 },
    ]);
    expect(imported.summary).toMatchObject({
      totalDecodedPixels: 818,
      totalDecodedBytes: 3_272,
      maxWidth: 30,
      maxHeight: 20,
    });

    await expectCbzError(
      importStudioCbz(archive, { limits: { maxPagePixels: 239 } }),
      "SIZE_LIMIT"
    );
    await expectCbzError(
      importStudioCbz(archive, { limits: { maxTotalDecodedPixels: 817 } }),
      "SIZE_LIMIT"
    );
    await expectCbzError(
      importStudioCbz(archive, { limits: { maxTotalDecodedBytes: 3_271 } }),
      "SIZE_LIMIT"
    );
    await expectCbzError(
      importStudioCbz(archive, { limits: { maxPageDimension: 29 } }),
      "SIZE_LIMIT"
    );
  });

  it("parses a safe ComicInfo subset and rejects malformed or active XML", async () => {
    const safeArchive = await buildStudioPackageArchiveBytes([
      {
        path: "ComicInfo.xml",
        data: encoder.encode(
          '<?xml version="1.0" encoding="UTF-8"?><ComicInfo xmlns:xsi="urn:test"><!-- safe --><Title>A &amp; B</Title><Characters>Hero, Rival</Characters><Pages><Page Image="0" Type="FrontCover"/></Pages></ComicInfo>'
        ),
      },
      { path: "page.png", data: png(1) },
    ]);
    await expect(importStudioCbz(safeArchive)).resolves.toMatchObject({
      metadata: { title: "A & B" },
      summary: { hasComicInfo: true },
    });

    const cases = [
      '<!DOCTYPE ComicInfo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><ComicInfo><Title>&xxe;</Title></ComicInfo>',
      "<ComicInfo><Title>One</Title><Title>Two</Title></ComicInfo>",
      "<ComicInfo><Month>13</Month></ComicInfo>",
      "<ComicInfo><Title>&unknown;</Title></ComicInfo>",
      "<ComicInfo><Title><b>Nested</b></Title></ComicInfo>",
      "<ComicInfo><Title lang=\"ko\">Attributed</Title></ComicInfo>",
      "<ComicInfo><Title>Unclosed</ComicInfo>",
      "<ComicInfo></ComicInfo><ComicInfo></ComicInfo>",
      "<ComicInfo><![CDATA[unsafe parser branch]]></ComicInfo>",
    ];
    for (const xml of cases) {
      const archive = await buildStudioPackageArchiveBytes([
        { path: "ComicInfo.xml", data: encoder.encode(xml) },
        { path: "page.png", data: png(1) },
      ]);
      await expectCbzError(importStudioCbz(archive), "COMICINFO_INVALID");
    }
  });

  it("bounds ComicInfo element, depth, attribute, and text complexity", async () => {
    const cases = [
      {
        xml: "<ComicInfo><A/><B/></ComicInfo>",
        limits: { maxComicInfoElements: 2 },
      },
      {
        xml: "<ComicInfo><A><B/></A></ComicInfo>",
        limits: { maxComicInfoDepth: 2 },
      },
      {
        xml: '<ComicInfo a="1" b="2"></ComicInfo>',
        limits: { maxComicInfoAttributesPerElement: 1 },
      },
      {
        xml: "<ComicInfo><Title>12345</Title></ComicInfo>",
        limits: { maxComicInfoTextCharacters: 4 },
      },
    ] as const;

    for (const testCase of cases) {
      const archive = await buildStudioPackageArchiveBytes([
        { path: "ComicInfo.xml", data: encoder.encode(testCase.xml) },
        { path: "page.png", data: png(1) },
      ]);
      await expectCbzError(
        importStudioCbz(archive, { limits: testCase.limits }),
        "COMICINFO_INVALID",
      );
    }
  });

  it("enforces page, byte, metadata, and abort limits", async () => {
    await expectCbzError(buildStudioCbzBytes({ pages: [] }), "PAGE_COUNT_LIMIT");
    await expectCbzError(
      buildStudioCbzBytes(
        { pages: [{ image: png(1) }, { image: png(2) }] },
        { limits: { maxPages: 1 } }
      ),
      "PAGE_COUNT_LIMIT"
    );
    await expectCbzError(
      buildStudioCbzBytes({ pages: [{ image: png(1) }] }, { limits: { maxPageBytes: 8 } }),
      "SIZE_LIMIT"
    );
    await expectCbzError(
      buildStudioCbzBytes(
        { pages: [{ image: png(1) }, { image: png(2) }] },
        { limits: { maxTotalPageBytes: 100 } }
      ),
      "SIZE_LIMIT"
    );
    await expectCbzError(
      buildStudioCbzBytes(
        { pages: [{ image: png(1) }], metadata: { title: "long title" } },
        { limits: { maxMetadataCharacters: 2 } }
      ),
      "COMICINFO_INVALID"
    );
    await expectCbzError(
      buildStudioCbzBytes(
        { pages: [{ image: pngWithDimensions(4, 4) }] },
        { limits: { maxPagePixels: 15 } }
      ),
      "SIZE_LIMIT"
    );
    await expectCbzError(
      buildStudioCbzBytes(
        { pages: [{ image: png(1) }, { image: png(2) }] },
        { limits: { maxTotalDecodedBytes: 7 } }
      ),
      "SIZE_LIMIT"
    );
    await expectCbzError(
      buildStudioCbzBytes(
        { pages: [{ image: png(1) }] },
        { limits: { maxCompressionRatio: 0 } }
      ),
      "LIMIT_INVALID"
    );
    await expectCbzError(
      buildStudioCbzBytes(
        { pages: [{ image: png(1) }] },
        { limits: { maxArchiveEntries: 1 } }
      ),
      "PAGE_COUNT_LIMIT"
    );
    await expectCbzError(
      buildStudioCbzBytes({
        pages: [{ image: png(1) }],
        metadata: { title: "bad\u0000title" },
      }),
      "COMICINFO_INVALID"
    );
    await expectCbzError(
      buildStudioCbzBytes({
        pages: [{ image: png(1) }],
        metadata: { genre: ["Drama, Comedy"] },
      }),
      "COMICINFO_INVALID"
    );

    const controller = new AbortController();
    controller.abort();
    await expectCbzError(
      buildStudioCbzBytes({ pages: [{ image: png(1) }] }, { signal: controller.signal }),
      "ABORTED"
    );
  });

  it("rejects empty page archives and unsafe ZIP structures before decoding images", async () => {
    const noPages = await buildStudioPackageArchiveBytes([
      { path: "ComicInfo.xml", data: encoder.encode("<ComicInfo></ComicInfo>") },
      { path: "README.txt", data: encoder.encode("nothing") },
    ]);
    await expectCbzError(importStudioCbz(noPages), "PAGE_COUNT_LIMIT");

    const invalidZip = new Uint8Array([1, 2, 3]);
    await expectCbzError(importStudioCbz(invalidZip), "ARCHIVE_INVALID");

    const safePathArchive = await buildStudioPackageArchiveBytes([
      { path: "aa/page.png", data: png(1) },
    ]);
    await expectCbzError(
      importStudioCbz(replaceEqualLengthUtf8(safePathArchive, "aa/page.png", "../page.png")),
      "ARCHIVE_INVALID"
    );
    await expectCbzError(
      importStudioCbz(corruptFirstStoredPayload(safePathArchive)),
      "ARCHIVE_INVALID"
    );

    const distinctPathArchive = await buildStudioPackageArchiveBytes([
      { path: "pageA.png", data: png(1) },
      { path: "pageB.png", data: png(2) },
    ]);
    await expectCbzError(
      importStudioCbz(replaceEqualLengthUtf8(distinctPathArchive, "pageB.png", "pageA.png")),
      "ARCHIVE_INVALID"
    );

    const ratioSource = await buildStudioPackageArchiveBytes([
      { path: "page.png", data: new Uint8Array([1]) },
    ]);
    await expectCbzError(
      importStudioCbz(mutateStoredEntryIntoRatioBomb(ratioSource)),
      "ARCHIVE_INVALID"
    );

    const excessiveEntries = await buildStudioPackageArchiveBytes([
      { path: "page.png", data: png(1) },
      ...Array.from({ length: 65 }, (_, index) => ({
        path: `notes/${String(index).padStart(2, "0")}.txt`,
        data: new Uint8Array(),
      })),
    ]);
    await expectCbzError(
      importStudioCbz(excessiveEntries, { limits: { maxPages: 1 } }),
      "ARCHIVE_INVALID"
    );

    const controller = new AbortController();
    controller.abort();
    await expectCbzError(
      importStudioCbz(safePathArchive, { signal: controller.signal }),
      "ABORTED"
    );
  });
});
