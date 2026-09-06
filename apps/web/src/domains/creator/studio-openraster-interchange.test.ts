import { describe, expect, it } from "vitest";

import {
  buildStudioOpenRasterBlob as buildStudioOpenRasterBlobWithBackend,
  buildStudioOpenRasterBytes as buildStudioOpenRasterBytesWithBackend,
  importStudioOpenRaster,
  STUDIO_OPENRASTER_BLEND_MODES,
  STUDIO_OPENRASTER_LIMITS,
  STUDIO_OPENRASTER_MIME,
  StudioOpenRasterError,
  type StudioOpenRasterErrorCode,
} from "./studio-openraster-interchange";
import {
  buildStudioPackageArchiveBytes as buildStudioPackageArchiveBytesWithBackend,
} from "./studio-package-archive";
import { readStudioZipArchive } from "./studio-zip-reader";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function buildStudioOpenRasterBytes(
  input: Parameters<typeof buildStudioOpenRasterBytesWithBackend>[0],
  options: NonNullable<Parameters<typeof buildStudioOpenRasterBytesWithBackend>[1]> = {},
): ReturnType<typeof buildStudioOpenRasterBytesWithBackend> {
  return buildStudioOpenRasterBytesWithBackend(input, {
    crc32ExecutionMode: "direct-headless",
    ...options,
  });
}

function buildStudioOpenRasterBlob(
  input: Parameters<typeof buildStudioOpenRasterBlobWithBackend>[0],
  options: NonNullable<Parameters<typeof buildStudioOpenRasterBlobWithBackend>[1]> = {},
): ReturnType<typeof buildStudioOpenRasterBlobWithBackend> {
  return buildStudioOpenRasterBlobWithBackend(input, {
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

function png(seed: number, width = 1, height = 1): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  bytes[24] = 8;
  bytes[25] = 6;
  bytes[32] = seed;
  return bytes;
}

async function expectOraError(
  promise: Promise<unknown>,
  code: StudioOpenRasterErrorCode,
  path?: string
): Promise<StudioOpenRasterError> {
  let caught: unknown;
  try {
    await promise;
  } catch (cause) {
    caught = cause;
  }
  expect(caught).toBeInstanceOf(StudioOpenRasterError);
  const error = caught as StudioOpenRasterError;
  expect(error.code).toBe(code);
  if (path !== undefined) expect(error.path).toBe(path);
  return error;
}

async function customOra(stackXml: string, overrides?: {
  firstPath?: string;
  includeMerged?: boolean;
  includeThumbnail?: boolean;
  layer?: Uint8Array;
  merged?: Uint8Array;
  thumbnail?: Uint8Array;
  extraEntries?: ReadonlyArray<{ path: string; data: Uint8Array }>;
}): Promise<Uint8Array> {
  return buildStudioPackageArchiveBytes([
    {
      path: overrides?.firstPath ?? "mimetype",
      data: encoder.encode(STUDIO_OPENRASTER_MIME),
    },
    { path: "stack.xml", data: encoder.encode(stackXml) },
    ...(overrides?.includeMerged === false
      ? []
      : [{ path: "mergedimage.png", data: overrides?.merged ?? png(1) }]),
    ...(overrides?.includeThumbnail === false
      ? []
      : [{ path: "Thumbnails/thumbnail.png", data: overrides?.thumbnail ?? png(2) }]),
    { path: "data/layer.png", data: overrides?.layer ?? png(3) },
    ...(overrides?.extraEntries ?? []),
  ]);
}

function replaceAsciiEverywhere(source: Uint8Array, from: string, to: string): Uint8Array {
  const fromBytes = encoder.encode(from);
  const toBytes = encoder.encode(to);
  expect(toBytes.byteLength).toBe(fromBytes.byteLength);
  const output = source.slice();
  let replacements = 0;
  for (let offset = 0; offset <= output.byteLength - fromBytes.byteLength; offset += 1) {
    if (!fromBytes.every((value, index) => output[offset + index] === value)) continue;
    output.set(toBytes, offset);
    offset += fromBytes.byteLength - 1;
    replacements += 1;
  }
  expect(replacements).toBeGreaterThanOrEqual(2);
  return output;
}

describe("OpenRaster interchange", () => {
  it("exports deterministic ORA entry order and round-trips layer semantics", async () => {
    const input = {
      width: 800,
      height: 1_200,
      name: "Episode & <One>",
      mergedImage: png(10, 800, 1_200),
      thumbnail: png(11),
      layers: [
        {
          name: "Back & base",
          png: png(12),
          x: -20,
          y: 5,
          opacity: 0.75,
          visible: false,
          blendMode: "multiply" as const,
        },
        {
          name: 'Front "ink"',
          png: png(13),
          x: 12,
          y: -7,
          opacity: 1,
          visible: true,
          blendMode: "normal" as const,
        },
      ],
    };

    const first = await buildStudioOpenRasterBytes(input);
    const second = await buildStudioOpenRasterBytes(input);
    expect(first.warnings).toEqual([]);
    expect([...first.bytes]).toEqual([...second.bytes]);

    const zip = await readStudioZipArchive(first.bytes);
    expect(zip.entries.map((entry) => entry.path)).toEqual([
      "mimetype",
      "stack.xml",
      "mergedimage.png",
      "Thumbnails/thumbnail.png",
      "data/layer0000.png",
      "data/layer0001.png",
    ]);
    expect(zip.entries[0]?.compressionMethod).toBe(0);
    expect(decoder.decode(await zip.readEntry("mimetype"))).toBe(STUDIO_OPENRASTER_MIME);
    const xml = decoder.decode(await zip.readEntry("stack.xml"));
    expect(xml.indexOf("Front &quot;ink&quot;")).toBeLessThan(xml.indexOf("Back &amp; base"));
    expect(xml).toContain('name="Episode &amp; &lt;One&gt;"');

    const imported = await importStudioOpenRaster(first.bytes);
    expect(imported).toMatchObject({ width: 800, height: 1_200, name: "Episode & <One>" });
    expect(imported.layers.map(({ z, name, x, y, opacity, visible, blendMode }) => ({
      z,
      name,
      x,
      y,
      opacity,
      visible,
      blendMode,
    }))).toEqual([
      {
        z: 0,
        name: "Back & base",
        x: -20,
        y: 5,
        opacity: 0.75,
        visible: false,
        blendMode: "multiply",
      },
      {
        z: 1,
        name: 'Front "ink"',
        x: 12,
        y: -7,
        opacity: 1,
        visible: true,
        blendMode: "normal",
      },
    ]);
    expect(imported.layers[0]?.png.type).toBe("image/png");
    expect(imported.layers[0]).toMatchObject({
      width: 1,
      height: 1,
      byteLength: 33,
      decodedRgbaBytes: 4,
      groupIds: [],
      groupPath: [],
      depth: 0,
      effectiveOpacity: 0.75,
      effectiveVisible: false,
    });
    expect([...new Uint8Array(await imported.layers[0]!.png.arrayBuffer())]).toEqual([...png(12)]);
    expect(imported.mergedImage.type).toBe("image/png");
    expect(imported.thumbnail.type).toBe("image/png");
    expect(imported.groups).toEqual([]);
    expect(imported.mergedImageInfo).toMatchObject({
      path: "mergedimage.png",
      width: 800,
      height: 1_200,
      byteLength: 33,
      decodedRgbaBytes: 3_840_000,
      bitDepth: 8,
      colorType: 6,
      interlaced: false,
    });
    expect(imported.thumbnailInfo).toMatchObject({ width: 1, height: 1 });
    expect(imported.summary).toMatchObject({
      layerCount: 2,
      groupCount: 0,
      hiddenLayerCount: 1,
      hiddenGroupCount: 0,
      unsupportedFeatureCount: 0,
    });
    expect([
      imported,
      imported.layers,
      imported.layers[0],
      imported.layers[0]?.groupIds,
      imported.groups,
      imported.mergedImageInfo,
      imported.thumbnailInfo,
      imported.summary,
      imported.warnings,
    ].every((value) => Object.isFrozen(value))).toBe(true);
  });

  it("builds an image/openraster Blob through the shared ZIP writer", async () => {
    const result = await buildStudioOpenRasterBlob({
      width: 10,
      height: 20,
      layers: [{ name: "Layer", png: png(1) }],
      mergedImage: png(2, 10, 20),
      thumbnail: png(3),
    });

    expect(result.blob.type).toBe(STUDIO_OPENRASTER_MIME);
    const imported = await importStudioOpenRaster(result.blob);
    expect(imported.layers).toHaveLength(1);
  });

  it("warns and safely falls back for unsupported exported blend modes", async () => {
    const result = await buildStudioOpenRasterBytes({
      width: 10,
      height: 10,
      layers: [{ name: "Layer", png: png(1), blendMode: "linear-burn" }],
      mergedImage: png(2, 10, 10),
      thumbnail: png(3),
    });

    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "UNSUPPORTED_BLEND_MODE", layerIndex: 0 }),
    ]);
    const imported = await importStudioOpenRaster(result.bytes);
    expect(imported.layers[0]?.blendMode).toBe("normal");
  });

  it("round-trips every baseline OpenRaster composite operation", async () => {
    const result = await buildStudioOpenRasterBytes({
      width: 10,
      height: 10,
      layers: STUDIO_OPENRASTER_BLEND_MODES.map((blendMode, index) => ({
        name: blendMode,
        png: png(index + 1),
        blendMode,
      })),
      mergedImage: png(80, 10, 10),
      thumbnail: png(81),
    });

    expect(result.warnings).toEqual([]);
    const imported = await importStudioOpenRaster(result.bytes);
    expect(imported.layers.map((layer) => layer.blendMode)).toEqual([
      ...STUDIO_OPENRASTER_BLEND_MODES,
    ]);
    expect(imported.layers.map((layer) => layer.sourceCompositeOp)).toEqual([
      "svg:src-over",
      "svg:multiply",
      "svg:screen",
      "svg:overlay",
      "svg:darken",
      "svg:lighten",
      "svg:color-dodge",
      "svg:color-burn",
      "svg:hard-light",
      "svg:soft-light",
      "svg:difference",
      "svg:exclusion",
      "svg:color",
      "svg:luminosity",
      "svg:hue",
      "svg:saturation",
      "svg:plus",
      "svg:dst-in",
      "svg:dst-out",
      "svg:src-atop",
      "svg:dst-atop",
    ]);
  });

  it("preserves nested groups, cumulative state, resolution, and unsupported-feature warnings", async () => {
    const archive = await customOra(`<?xml version="1.0"?>
<image version="0.0.6" w="10" h="20" name="Grouped" xres="300" yres="600">
  <stack>
    <stack name="Characters" opacity="0.8" composite-op="svg:multiply" isolation="isolate">
      <stack name="Hidden FX" opacity="0.5" visibility="hidden" composite-op="svg:screen" isolation="auto">
        <layer name="Hero" src="data/layer.png" x="2" y="3" opacity="0.5" visibility="visible" composite-op="krita:linear-burn">
          <mask src="data/mask.png"/>
        </layer>
        <metadata value="ignored">extension payload</metadata>
      </stack>
    </stack>
  </stack>
</image>`);

    const imported = await importStudioOpenRaster(archive);
    expect(imported).toMatchObject({
      version: "0.0.6",
      resolution: { xPpi: 300, yPpi: 600 },
    });
    expect(imported.groups).toEqual([
      {
        id: "group-0000",
        name: "Characters",
        depth: 1,
        siblingIndex: 0,
        opacity: 0.8,
        visible: true,
        blendMode: "multiply",
        sourceCompositeOp: "svg:multiply",
        isolation: "isolate",
        effectiveOpacity: 0.8,
        effectiveVisible: true,
      },
      {
        id: "group-0001",
        parentId: "group-0000",
        name: "Hidden FX",
        depth: 2,
        siblingIndex: 0,
        opacity: 0.5,
        visible: false,
        blendMode: "screen",
        sourceCompositeOp: "svg:screen",
        isolation: "auto",
        effectiveOpacity: 0.4,
        effectiveVisible: false,
      },
    ]);
    expect(imported.groups.every((group) => Object.isFrozen(group))).toBe(true);
    expect(imported.layers[0]).toMatchObject({
      name: "Hero",
      x: 2,
      y: 3,
      opacity: 0.5,
      blendMode: "normal",
      sourceCompositeOp: "krita:linear-burn",
      parentGroupId: "group-0001",
      groupIds: ["group-0000", "group-0001"],
      groupPath: ["Characters", "Hidden FX"],
      depth: 2,
      siblingIndex: 0,
      effectiveOpacity: 0.2,
      effectiveVisible: false,
    });
    expect(imported.warnings.map((warning) => warning.code)).toEqual([
      "UNSUPPORTED_BLEND_MODE",
      "MASKS_IGNORED",
      "UNSUPPORTED_XML_ELEMENT",
      "PREVIEW_DIMENSION_MISMATCH",
    ]);
    expect(imported.summary).toMatchObject({
      layerCount: 1,
      groupCount: 2,
      hiddenLayerCount: 1,
      hiddenGroupCount: 1,
      unsupportedFeatureCount: 3,
    });
  });

  it("requires first-and-stored mimetype plus all canonical preview entries", async () => {
    const stack = '<image w="10" h="10"><stack><layer src="data/layer.png"/></stack></image>';
    await expectOraError(
      importStudioOpenRaster(await customOra(stack, { firstPath: "not-mimetype" })),
      "MIMETYPE_INVALID"
    );
    await expectOraError(
      importStudioOpenRaster(await customOra(stack, { includeMerged: false })),
      "REQUIRED_ENTRY_MISSING"
    );
    await expectOraError(
      importStudioOpenRaster(await customOra(stack, { includeThumbnail: false })),
      "REQUIRED_ENTRY_MISSING"
    );
  });

  it("rejects malformed XML, DTD/entity declarations, bad PNGs, and missing layer sources", async () => {
    await expectOraError(
      importStudioOpenRaster(
        await customOra('<!DOCTYPE image [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><image w="1" h="1"><stack><layer src="data/layer.png"/></stack></image>')
      ),
      "STACK_XML_INVALID"
    );
    await expectOraError(
      importStudioOpenRaster(
        await customOra('<image w="1" h="1"><stack><layer src="data/layer.png"></stack></image>')
      ),
      "STACK_XML_INVALID"
    );
    await expectOraError(
      importStudioOpenRaster(
        await customOra('<image w="1" h="1"><stack><layer src="data/layer.png"/></stack></image><extra/>')
      ),
      "STACK_XML_INVALID"
    );
    await expectOraError(
      importStudioOpenRaster(
        await customOra('<image w="1" h="1"><stack><layer src="data/layer.png"/></stack></image>', {
          layer: encoder.encode("not png"),
        })
      ),
      "IMAGE_INVALID",
      "data/layer.png"
    );
    await expectOraError(
      importStudioOpenRaster(
        await customOra('<image w="1" h="1"><stack><layer src="data/missing.png"/></stack></image>')
      ),
      "REQUIRED_ENTRY_MISSING"
    );
  });

  it("rejects unsafe, reserved, normalized, and duplicate layer references before extraction", async () => {
    const wrap = (layers: string) => `<image w="1" h="1"><stack>${layers}</stack></image>`;
    const unsafe = await expectOraError(
      importStudioOpenRaster(await customOra(wrap('<layer src="../escape0.png"/>'))),
      "STACK_XML_INVALID",
      "../escape0.png",
    );
    expect(unsafe.message).toContain("안전하지 않은 경로");

    await expectOraError(
      importStudioOpenRaster(await customOra(wrap('<layer src="mergedimage.png"/>'))),
      "STACK_XML_INVALID",
      "mergedimage.png",
    );
    await expectOraError(
      importStudioOpenRaster(await customOra(wrap('<layer src="data/cafe\u0301.png"/>'))),
      "STACK_XML_INVALID",
      "data/cafe\u0301.png",
    );
    const duplicate = await expectOraError(
      importStudioOpenRaster(await customOra(wrap(
        '<layer src="data/layer.png"/><layer src="DATA/LAYER.PNG"/>',
      ))),
      "STACK_XML_INVALID",
      "DATA/LAYER.PNG",
    );
    expect(duplicate.message).toContain("중복 참조");
  });

  it("does not interpret supported-looking descendants inside unknown XML extensions", async () => {
    const archive = await customOra(`<image w="1" h="1"><stack>
      <extension vendor="example">text payload<layer src="data/layer.png"/></extension>
      <layer name="Real" src="data/layer.png" selected="true"/>
    </stack></image>`);

    const imported = await importStudioOpenRaster(archive);
    expect(imported.layers.map((layer) => layer.name)).toEqual(["Real"]);
    expect(imported.warnings.map((warning) => warning.code)).toEqual([
      "UNSUPPORTED_XML_ELEMENT",
      "UNSUPPORTED_XML_ATTRIBUTE",
    ]);
    expect(imported.warnings.every((warning) => warning.message.includes("보존") || warning.message.includes("저장"))).toBe(true);
  });

  it("rejects ambiguous ZIP paths and preserves the offending archive path", async () => {
    const valid = await customOra(
      '<image w="1" h="1"><stack><layer src="data/layer.png"/></stack></image>',
      { extraEntries: [{ path: "data/other.png", data: png(9) }] },
    );
    const duplicatePaths = replaceAsciiEverywhere(valid, "data/other.png", "data/layer.png");
    const error = await expectOraError(
      importStudioOpenRaster(duplicatePaths),
      "ARCHIVE_INVALID",
      "data/layer.png",
    );
    expect(error.message).toContain("경로");
  });

  it("normalizes deferred ZIP CRC failures into a path-aware ORA error", async () => {
    const valid = await customOra(
      '<image w="1" h="1"><stack><layer src="data/layer.png"/></stack></image>',
    );
    const parsed = await readStudioZipArchive(valid);
    const layerEntry = parsed.getEntry("data/layer.png")!;
    const corrupted = valid.slice();
    const corruptOffset = layerEntry.dataOffset + layerEntry.uncompressedBytes - 1;
    corrupted[corruptOffset] = (corrupted[corruptOffset] ?? 0) ^ 0xff;

    const error = await expectOraError(
      importStudioOpenRaster(corrupted),
      "ARCHIVE_INVALID",
      "data/layer.png",
    );
    expect(error.message).toContain("CRC-32");
  });

  it("fails closed on invalid XML placement, declarations, comments, and resolution metadata", async () => {
    const invalidXmlDocuments = [
      '<image w="1" h="1"><stack><layer src="data/layer.png"><layer src="data/other.png"/></layer></stack></image>',
      '<image w="1" h="1"><stack><layer src="data/layer.png"/></stack><stack/></image>',
      '<image w="1" h="1" xres="300"><stack><layer src="data/layer.png"/></stack></image>',
      '<image version="future" w="1" h="1"><stack><layer src="data/layer.png"/></stack></image>',
      '<image w="1" h="1"><stack><layer src="data/layer.png"/></stack></image><?target value?>',
      '<!-- invalid -- comment --><image w="1" h="1"><stack><layer src="data/layer.png"/></stack></image>',
    ];
    for (const xml of invalidXmlDocuments) {
      await expectOraError(importStudioOpenRaster(await customOra(xml)), "STACK_XML_INVALID");
    }
  });

  it("enforces XML element, attribute, depth, group, and stack-byte budgets", async () => {
    const flat = '<image w="1" h="1"><stack><layer src="data/layer.png"/></stack></image>';
    await expectOraError(
      importStudioOpenRaster(await customOra(flat), { limits: { maxXmlElements: 2 } }),
      "STACK_XML_INVALID",
      "stack.xml",
    );
    await expectOraError(
      importStudioOpenRaster(await customOra(flat), { limits: { maxXmlAttributesPerElement: 1 } }),
      "STACK_XML_INVALID",
    );
    await expectOraError(
      importStudioOpenRaster(await customOra(flat), { limits: { maxXmlDepth: 2 } }),
      "STACK_XML_INVALID",
      "stack.xml",
    );
    const grouped = '<image w="1" h="1"><stack><stack><layer src="data/layer.png"/></stack></stack></image>';
    await expectOraError(
      importStudioOpenRaster(await customOra(grouped), { limits: { maxGroups: 0 } }),
      "STACK_XML_INVALID",
      "stack.xml",
    );
    await expectOraError(
      importStudioOpenRaster(await customOra(flat), { limits: { maxStackXmlBytes: 20 } }),
      "SIZE_LIMIT",
      "stack.xml",
    );
  });

  it("returns preview metadata and warns on noncanonical preview dimensions or profiles", async () => {
    const thumbnail = png(2, 300, 100);
    thumbnail[28] = 1;
    const archive = await customOra(
      '<image version="0.0.6" w="10" h="20"><stack><layer src="data/layer.png"/></stack></image>',
      { merged: png(1, 9, 20), thumbnail },
    );

    const imported = await importStudioOpenRaster(archive);
    expect(imported.mergedImageInfo).toMatchObject({
      width: 9,
      height: 20,
      bitDepth: 8,
      colorType: 6,
      interlaced: false,
    });
    expect(imported.thumbnailInfo).toMatchObject({
      width: 300,
      height: 100,
      interlaced: true,
    });
    expect(imported.warnings.map((warning) => warning.code)).toEqual([
      "PREVIEW_DIMENSION_MISMATCH",
      "PREVIEW_PROFILE_MISMATCH",
    ]);
  });

  it("validates a complete PNG IHDR instead of accepting signature-only image entries", async () => {
    const stack = '<image w="1" h="1"><stack><layer src="data/layer.png"/></stack></image>';
    const signatureOnly = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const incompleteError = await expectOraError(
      importStudioOpenRaster(await customOra(stack, { layer: signatureOnly })),
      "IMAGE_INVALID",
      "data/layer.png"
    );
    expect(incompleteError.message).toContain("IHDR");

    const zeroWidth = png(4);
    new DataView(zeroWidth.buffer).setUint32(16, 0, false);
    const dimensionError = await expectOraError(
      importStudioOpenRaster(await customOra(stack, { merged: zeroWidth })),
      "IMAGE_INVALID",
      "mergedimage.png"
    );
    expect(dimensionError.message).toContain("너비와 높이");

    const wrongFirstChunk = png(5);
    wrongFirstChunk.set([73, 68, 65, 84], 12);
    const chunkError = await expectOraError(
      importStudioOpenRaster(await customOra(stack, { thumbnail: wrongFirstChunk })),
      "IMAGE_INVALID",
      "Thumbnails/thumbnail.png"
    );
    expect(chunkError.message).toContain("첫 chunk");
  });

  it("enforces conservative per-image pixels and cumulative decoded RGBA memory", async () => {
    expect(STUDIO_OPENRASTER_LIMITS.maxDecodedPixelsPerImage).toBe(16_777_216);
    expect(STUDIO_OPENRASTER_LIMITS.maxTotalDecodedRgbaBytes).toBe(128 * 1024 * 1024);

    const stack = '<image w="1" h="1"><stack><layer src="data/layer.png"/></stack></image>';
    const perImageError = await expectOraError(
      importStudioOpenRaster(
        await customOra(stack, { layer: png(1, 4_097, 4_096) })
      ),
      "SIZE_LIMIT",
      "data/layer.png"
    );
    expect(perImageError.message).toContain("16,777,216px");

    const cumulativeError = await expectOraError(
      importStudioOpenRaster(
        await customOra(stack, {
          merged: png(2, 4_096, 4_096),
          thumbnail: png(3, 4_096, 4_096),
          layer: png(4, 4_096, 4_096),
        })
      ),
      "SIZE_LIMIT",
      "data/layer.png"
    );
    expect(cumulativeError.message).toContain("디코딩 RGBA 메모리");
    expect(cumulativeError.message).toContain("134,217,728바이트");
  });

  it("applies decoded image budgets to export inputs before ZIP creation", async () => {
    const input = {
      width: 5,
      height: 5,
      layers: [{ name: "Layer", png: png(1, 5, 5) }],
      mergedImage: png(2, 5, 5),
      thumbnail: png(3, 5, 5),
    };
    await expectOraError(
      buildStudioOpenRasterBytes(input, { limits: { maxDecodedPixelsPerImage: 24 } }),
      "SIZE_LIMIT",
      "data/layer0000.png"
    );
    await expectOraError(
      buildStudioOpenRasterBytes(input, { limits: { maxTotalDecodedRgbaBytes: 299 } }),
      "SIZE_LIMIT",
      "Thumbnails/thumbnail.png"
    );
  });

  it("enforces dimensions, layer count, names, offsets, image bytes, and aborts", async () => {
    const base = {
      width: 10,
      height: 10,
      layers: [{ name: "Layer", png: png(1) }],
      mergedImage: png(2),
      thumbnail: png(3),
    };
    await expectOraError(
      buildStudioOpenRasterBytes({ ...base, width: 0 }),
      "DIMENSION_INVALID"
    );
    await expectOraError(
      buildStudioOpenRasterBytes({ ...base, layers: [] }),
      "LAYER_COUNT_LIMIT"
    );
    await expectOraError(
      buildStudioOpenRasterBytes({
        ...base,
        layers: [{ name: "", png: png(1) }],
      }),
      "LAYER_INVALID"
    );
    await expectOraError(
      buildStudioOpenRasterBytes({
        ...base,
        layers: [{ name: "Layer", png: png(1), x: 2_000_000 }],
      }),
      "LAYER_INVALID"
    );
    await expectOraError(
      buildStudioOpenRasterBytes(base, { limits: { maxLayerBytes: 8 } }),
      "SIZE_LIMIT"
    );

    const controller = new AbortController();
    controller.abort();
    await expectOraError(
      buildStudioOpenRasterBytes(base, { signal: controller.signal }),
      "ABORTED"
    );
  });
});
