import { describe, expect, it } from "vitest";

import { buildStudioPackageArchiveBytes } from "./studio-package-archive";
import {
  buildStudioWillV1OpcBytes,
  importStudioWillV1Opc,
  STUDIO_WILL_V1_OPC_ASSURANCE,
  STUDIO_WILL_V1_OPC_PARTS,
  STUDIO_WILL_V1_OPC_PROFILE,
  STUDIO_WILL_V1_OPC_REQUIRED_PARTS,
  STUDIO_WILL_V1_OPC_STROKE_RELATIONSHIP_TYPE,
  StudioWillV1OpcInterchangeError,
  type StudioWillV1OpcExportInput,
} from "./studio-will-v1-opc-interchange";
import { readStudioZipArchive } from "./studio-zip-reader";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const SAMPLE: StudioWillV1OpcExportInput = {
  width: 328,
  height: 439,
  title: "첫 화 & <연습>",
  createdAt: "2026-07-30T12:34:56Z",
  application: "ToonSpectrum Studio",
  applicationVersion: "1.0.0",
  paths: [
    {
      points: [
        { x: 1.25, y: 2.5 },
        { x: 10.5, y: 20.25 },
        { x: 30.75, y: 40.5 },
        { x: 50, y: 60 },
      ],
      strokeWidths: [2.5, 3, 3.5, 4],
      strokeColor: { r: 12, g: 34, b: 56, a: 255 },
      decimalPrecision: 2,
      startParameter: 0,
      endParameter: 1,
    },
  ],
};

async function entriesOf(source: Uint8Array): Promise<Map<string, Uint8Array>> {
  const archive = await readStudioZipArchive(source);
  const entries = new Map<string, Uint8Array>();
  for (const entry of archive.entries) {
    entries.set(entry.path, await archive.readEntry(entry));
  }
  return entries;
}

async function repack(
  source: Uint8Array,
  update: (
    entries: Map<string, Uint8Array>
  ) => void
): Promise<Uint8Array> {
  const entries = await entriesOf(source);
  update(entries);
  return buildStudioPackageArchiveBytes(
    [...entries].map(([path, data]) => ({ path, data })),
    { crc32ExecutionMode: "direct-headless" }
  );
}

async function replaceTextPart(
  source: Uint8Array,
  path: string,
  replace: (value: string) => string
): Promise<Uint8Array> {
  return repack(source, (entries) => {
    const current = entries.get(path);
    if (!current) throw new Error(`missing fixture part ${path}`);
    entries.set(path, textEncoder.encode(replace(textDecoder.decode(current))));
  });
}

async function expectOpcError(
  promise: Promise<unknown>,
  code: StudioWillV1OpcInterchangeError["code"]
): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (cause: unknown) => cause
  );
  expect(error).toBeInstanceOf(StudioWillV1OpcInterchangeError);
  expect(error).toMatchObject({ code });
}

describe("studio-will-v1-opc-interchange", () => {
  it("encodes a strokes part above the 1 MiB direct CRC slice with the default execution mode", async () => {
    // The bounded profile admits a 32 MiB strokes part, but the default `direct-bounded` CRC used
    // to refuse anything above one 1 MiB task — so a document that passed every profile check
    // failed at archive time. Build a real multi-MiB path list and require the default route to
    // accept it and round-trip.
    const paths: Array<StudioWillV1OpcExportInput["paths"][number]> = [];
    let totalPoints = 0;
    for (let pathIndex = 0; pathIndex < 48; pathIndex += 1) {
      const points: Array<{ x: number; y: number }> = [];
      const strokeWidths: number[] = [];
      for (let pointIndex = 0; pointIndex < 4_000; pointIndex += 1) {
        // Non-repeating fractional coordinates so delta coding cannot collapse the payload, kept
        // under ~1,500 so 6-decimal fixed point stays inside the signed 32-bit range.
        points.push({
          x: 12.345678 + pathIndex * 3.14159 + pointIndex * 0.31 + Math.sin(pointIndex * 0.37) * 5,
          y: 98.765432 + pathIndex * 2.71828 + pointIndex * 0.29 + Math.cos(pointIndex * 0.41) * 7,
        });
        strokeWidths.push(1.5 + ((pointIndex * 7 + pathIndex) % 23) * 0.173);
      }
      totalPoints += points.length;
      paths.push({
        points,
        strokeWidths,
        strokeColor: { r: (pathIndex * 37) & 0xff, g: (pathIndex * 59) & 0xff, b: 40, a: 255 },
        decimalPrecision: 6,
        startParameter: 0,
        endParameter: 1,
      });
    }
    expect(totalPoints).toBe(192_000);

    const built = await buildStudioWillV1OpcBytes({ ...SAMPLE, paths });
    const entries = await entriesOf(built.bytes);
    const strokes = entries.get(STUDIO_WILL_V1_OPC_PARTS.strokes);
    expect(strokes).toBeDefined();
    // Guard the premise: this fixture really crosses the direct slice boundary.
    expect(strokes!.byteLength).toBeGreaterThan(1024 * 1024);
    expect(strokes!.byteLength).toBeLessThanOrEqual(32 * 1024 * 1024);

    const imported = await importStudioWillV1Opc(built.bytes);
    expect(imported.paths).toHaveLength(paths.length);
    expect(imported.paths.reduce((sum, path) => sum + path.points.length, 0)).toBe(totalPoints);
  }, 60_000);

  it("builds deterministic seven-part OPC bytes and round-trips Annex A paths", async () => {
    const first = await buildStudioWillV1OpcBytes(SAMPLE);
    const second = await buildStudioWillV1OpcBytes(SAMPLE);

    expect(first.bytes).toEqual(second.bytes);
    expect(first.loss.status).toBe("exact");
    expect(first.assurance).toBe(STUDIO_WILL_V1_OPC_ASSURANCE);
    expect(first.assurance).toMatchObject({
      profile: STUDIO_WILL_V1_OPC_PROFILE,
      publicSpecificationDefinesTopLevelMediaType: false,
      canonicalTopLevelMediaTypeOwner: "ToonSpectrum",
      sectionRelationshipNormativeInPublicSpecification: false,
      vendorCertified: false,
      vendorTrademarkAuthorized: false,
      arbitraryVendorFileInteroperabilityCertified: false,
    });

    const archive = await readStudioZipArchive(first.bytes);
    expect(archive.entries.map((entry) => entry.path).sort()).toEqual(
      [...STUDIO_WILL_V1_OPC_REQUIRED_PARTS].sort()
    );
    expect(archive.entries).toHaveLength(7);
    expect(archive.comment).toBe("");
    expect(archive.entries.every((entry) => entry.compressionMethod === 0)).toBe(true);

    const imported = await importStudioWillV1Opc(first.bytes);
    expect(imported).toMatchObject({
      width: 328,
      height: 439,
      title: SAMPLE.title,
      createdAt: SAMPLE.createdAt,
      application: SAMPLE.application,
      applicationVersion: SAMPLE.applicationVersion,
    });
    expect(imported.paths).toEqual(first.paths);
    expect(imported.assurance).toBe(STUDIO_WILL_V1_OPC_ASSURANCE);
  });

  it("uses canonical metadata defaults and safely round-trips XML entities", async () => {
    const escaped = await buildStudioWillV1OpcBytes({
      width: 100.25,
      height: 80.5,
      title: `A&B <C> "D" 'E'`,
      paths: SAMPLE.paths,
    });
    const parts = await entriesOf(escaped.bytes);
    expect(textDecoder.decode(parts.get(STUDIO_WILL_V1_OPC_PARTS.coreProperties))).toContain(
      "A&amp;B &lt;C&gt; &quot;D&quot; &apos;E&apos;"
    );
    await expect(importStudioWillV1Opc(escaped.bytes)).resolves.toMatchObject({
      width: 100.25,
      height: 80.5,
      title: `A&B <C> "D" 'E'`,
      createdAt: "1980-01-01T00:00:00Z",
      application: "ToonSpectrum",
      applicationVersion: "1.0",
    });
  });

  it("pins the public content types and root relationship graph", async () => {
    const built = await buildStudioWillV1OpcBytes(SAMPLE);
    const wrongContentType = await replaceTextPart(
      built.bytes,
      STUDIO_WILL_V1_OPC_PARTS.contentTypes,
      (xml) =>
        xml.replace(
          "application/vnd.willfileformat.path+protobuf",
          "application/octet-stream"
        )
    );
    await expectOpcError(importStudioWillV1Opc(wrongContentType), "CONTENT_TYPES_INVALID");

    const externalRootTarget = await replaceTextPart(
      built.bytes,
      STUDIO_WILL_V1_OPC_PARTS.rootRelationships,
      (xml) =>
        xml.replace(
          'Target="/sections/section0.svg"',
          'Target="https://attacker.invalid/section.svg"'
        )
    );
    await expectOpcError(importStudioWillV1Opc(externalRootTarget), "RELATIONSHIP_INVALID");
  });

  it("pins ToonSpectrum's non-normative stroke relationship to the SVG r:id one-to-one", async () => {
    const built = await buildStudioWillV1OpcBytes(SAMPLE);
    const parts = await entriesOf(built.bytes);
    expect(
      textDecoder.decode(parts.get(STUDIO_WILL_V1_OPC_PARTS.sectionRelationships))
    ).toContain(STUDIO_WILL_V1_OPC_STROKE_RELATIONSHIP_TYPE);

    const mismatchedSvg = await replaceTextPart(
      built.bytes,
      STUDIO_WILL_V1_OPC_PARTS.section,
      (xml) => xml.replace('r:id="strokes0"', 'r:id="strokes1"')
    );
    await expectOpcError(importStudioWillV1Opc(mismatchedSvg), "SVG_INVALID");

    const traversal = await replaceTextPart(
      built.bytes,
      STUDIO_WILL_V1_OPC_PARTS.sectionRelationships,
      (xml) =>
        xml.replace(
          'Target="media/strokes.protobuf"',
          'Target="../media/strokes.protobuf"'
        )
    );
    await expectOpcError(importStudioWillV1Opc(traversal), "RELATIONSHIP_INVALID");

    const vendorLookingType = await replaceTextPart(
      built.bytes,
      STUDIO_WILL_V1_OPC_PARTS.sectionRelationships,
      (xml) =>
        xml.replace(
          STUDIO_WILL_V1_OPC_STROKE_RELATIONSHIP_TYPE,
          "http://schemas.willfileformat.org/2015/relationships/strokes"
        )
    );
    await expectOpcError(importStudioWillV1Opc(vendorLookingType), "RELATIONSHIP_INVALID");
  });

  it("rejects missing, extra, duplicate-by-case, and directory parts", async () => {
    const built = await buildStudioWillV1OpcBytes(SAMPLE);
    const missing = await repack(built.bytes, (entries) => {
      entries.delete(STUDIO_WILL_V1_OPC_PARTS.coreProperties);
    });
    await expectOpcError(importStudioWillV1Opc(missing), "PART_SET_INVALID");

    const extra = await repack(built.bytes, (entries) => {
      entries.set("sections/media/extra.bin", Uint8Array.of(1));
    });
    await expectOpcError(importStudioWillV1Opc(extra), "ARCHIVE_INVALID");

    const duplicateCase = await repack(built.bytes, (entries) => {
      entries.set("Props/core.xml", entries.get(STUDIO_WILL_V1_OPC_PARTS.coreProperties)!);
    }).then(
      (value) => value,
      (error: unknown) => error
    );
    expect(duplicateCase).toBeInstanceOf(Error);
  });

  it("rejects DTDs, entities, processing instructions, scripts, and foreign SVG", async () => {
    const built = await buildStudioWillV1OpcBytes(SAMPLE);
    const xxe = await replaceTextPart(
      built.bytes,
      STUDIO_WILL_V1_OPC_PARTS.coreProperties,
      (xml) =>
        xml.replace(
          "<coreProperties",
          '<!DOCTYPE coreProperties [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><coreProperties'
        )
    );
    await expectOpcError(importStudioWillV1Opc(xxe), "XML_INVALID");

    const processingInstruction = await replaceTextPart(
      built.bytes,
      STUDIO_WILL_V1_OPC_PARTS.applicationProperties,
      (xml) => xml.replace("<Properties", "<?fetch external?><Properties")
    );
    await expectOpcError(importStudioWillV1Opc(processingInstruction), "XML_INVALID");

    const script = await replaceTextPart(
      built.bytes,
      STUDIO_WILL_V1_OPC_PARTS.section,
      (xml) => xml.replace('<g r:id="strokes0"/>', '<script>alert(1)</script>')
    );
    await expectOpcError(importStudioWillV1Opc(script), "SVG_INVALID");

    const foreignObject = await replaceTextPart(
      built.bytes,
      STUDIO_WILL_V1_OPC_PARTS.section,
      (xml) => xml.replace('<g r:id="strokes0"/>', "<foreignObject/>")
    );
    await expectOpcError(importStudioWillV1Opc(foreignObject), "SVG_INVALID");
  });

  it("fails closed for malformed Annex A bytes and resource budgets", async () => {
    const built = await buildStudioWillV1OpcBytes(SAMPLE);
    const invalidStrokes = await repack(built.bytes, (entries) => {
      entries.set(STUDIO_WILL_V1_OPC_PARTS.strokes, Uint8Array.of(0xff));
    });
    await expectOpcError(importStudioWillV1Opc(invalidStrokes), "STROKES_INVALID");

    await expectOpcError(
      buildStudioWillV1OpcBytes(SAMPLE, { limits: { maxXmlPartBytes: 32 } }),
      "RESOURCE_LIMIT"
    );
    await expectOpcError(
      importStudioWillV1Opc(built.bytes, {
        limits: { maxArchiveBytes: built.bytes.byteLength - 1 },
      }),
      "ARCHIVE_INVALID"
    );
    await expectOpcError(
      buildStudioWillV1OpcBytes({ ...SAMPLE, width: 100.0000001 }),
      "DIMENSION_INVALID"
    );
    const adversarialPaths = new Proxy([], {
      get() {
        throw new Error("path trap");
      },
    });
    await expectOpcError(
      buildStudioWillV1OpcBytes({
        ...SAMPLE,
        paths: adversarialPaths,
      }),
      "STROKES_INVALID"
    );
  });

  it("honors cancellation before codec work starts", async () => {
    const controller = new AbortController();
    controller.abort();
    await expectOpcError(
      buildStudioWillV1OpcBytes(SAMPLE, { signal: controller.signal }),
      "ABORTED"
    );
    await expectOpcError(
      importStudioWillV1Opc(new Uint8Array(), { signal: controller.signal }),
      "ABORTED"
    );
  });
});
