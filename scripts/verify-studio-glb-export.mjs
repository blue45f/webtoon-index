#!/usr/bin/env node
/**
 * Khronos-conformance gate for the Hybrid DCC GLB exporter.
 *
 * `apps/web/src/domains/creator/hybrid-dcc/studio-hybrid-dcc-glb-export.ts` writes GLB 2.0
 * containers by hand — chunk headers, buffer views, accessor min/max, padding. The
 * existing unit suite asserts that byte layout against our own reader, which means
 * a shared misreading of the spec passes on both sides. This gate closes that loop
 * with two independent third-party checks:
 *
 *   1. Khronos `gltf-validator` (the same Dart validator behind the official web
 *      validator) — the normative authority on whether the bytes are legal glTF 2.0.
 *   2. `@gltf-transform/core` — an independent parser, already a repo dependency.
 *      If it disagrees with our metrics, one of the two is wrong about the file.
 *
 * Determinism is checked too: the exporter documents byte-stable output, so each
 * fixture is exported twice and compared.
 *
 * Run:
 *   pnpm run verify:studio-glb-export
 */
import { NodeIO } from "@gltf-transform/core";
import { validateBytes } from "gltf-validator";

import {
  createStudioEditableMeshFromPolygons,
  createStudioUnitCubeMesh,
  hashStudioEditableMesh,
} from "../apps/web/src/domains/creator/studio-editable-half-edge-mesh.ts";
import {
  exportStudioHybridDccMeshGlb,
  STUDIO_HYBRID_DCC_GLB_EXPORT_GENERATOR,
  STUDIO_HYBRID_DCC_GLB_MIME_TYPE,
} from "../apps/web/src/domains/creator/hybrid-dcc/studio-hybrid-dcc-glb-export.ts";

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_CHUNK_TYPE_JSON = 0x4e4f534a;

/** glTF accessor componentType for UNSIGNED_INT / UNSIGNED_SHORT indices. */
const COMPONENT_TYPE_NAMES = new Map([
  [5121, "UNSIGNED_BYTE"],
  [5123, "UNSIGNED_SHORT"],
  [5125, "UNSIGNED_INT"],
  [5126, "FLOAT"],
]);

function vec(x, y, z) {
  return { x, y, z };
}

/** A single triangle — the minimum legal mesh, and the tightest accessor bounds case. */
function createTriangleMesh() {
  return createStudioEditableMeshFromPolygons(
    [vec(0, 0, 0), vec(1, 0, 0), vec(0, 1, 0)],
    [[0, 1, 2]],
  );
}

/**
 * A convex pentagon in one face. Exercises the fan triangulation path (5 corners ->
 * 3 triangles), which is where a wrong index count or a stale accessor `count`
 * would surface.
 */
function createPentagonMesh() {
  const positions = [];
  for (let corner = 0; corner < 5; corner += 1) {
    const angle = (corner / 5) * Math.PI * 2;
    positions.push(vec(Math.cos(angle), Math.sin(angle), 0));
  }
  return createStudioEditableMeshFromPolygons(positions, [[0, 1, 2, 3, 4]]);
}

/** Two disjoint quads at different depths — multi-face, non-contiguous topology. */
function createTwoQuadMesh() {
  return createStudioEditableMeshFromPolygons(
    [
      vec(-1, -1, 0), vec(0, -1, 0), vec(0, 1, 0), vec(-1, 1, 0),
      vec(1, -1, 2), vec(2, -1, 2), vec(2, 1, 2), vec(1, 1, 2),
    ],
    [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ],
  );
}

const FIXTURES = [
  { name: "unit-cube", build: createStudioUnitCubeMesh },
  { name: "single-triangle", build: createTriangleMesh },
  { name: "pentagon-fan", build: createPentagonMesh },
  { name: "two-disjoint-quads", build: createTwoQuadMesh },
];

const failures = [];
const warnings = [];

function fail(fixture, message) {
  failures.push(`[${fixture}] ${message}`);
}

function warn(fixture, message) {
  warnings.push(`[${fixture}] ${message}`);
}

function exportFixture(name, mesh, revision) {
  return exportStudioHybridDccMeshGlb({
    assetId: `verify-glb-${name}`,
    mesh,
    sourceRevision: revision,
    sourceHash: hashStudioEditableMesh(mesh),
  });
}

/** Parse the GLB container header without our own reader, so a bad header is caught here. */
function readGlbChunks(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const declaredLength = view.getUint32(8, true);
  const chunks = [];
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    chunks.push({ chunkType, chunkLength, dataOffset: offset + 8 });
    offset += 8 + chunkLength;
  }
  const jsonChunk = chunks.find((chunk) => chunk.chunkType === GLB_CHUNK_TYPE_JSON);
  const json = jsonChunk
    ? JSON.parse(
        new TextDecoder().decode(
          bytes.subarray(jsonChunk.dataOffset, jsonChunk.dataOffset + jsonChunk.chunkLength),
        ),
      )
    : undefined;
  return { magic, version, declaredLength, chunks, consumedLength: offset, json };
}

async function verifyFixture({ name, build }) { // NOSONAR javascript:S3776
  const mesh = build();
  const result = exportFixture(name, mesh, 1);

  if (!result.ok) {
    const codes = result.report.issues.map((issue) => issue.code).join(", ");
    fail(name, `export was blocked (${codes || "no issue codes"})`);
    return;
  }

  const { bytes, metrics, report, fileName, mimeType } = result;

  if (mimeType !== STUDIO_HYBRID_DCC_GLB_MIME_TYPE) {
    fail(name, `mimeType ${mimeType} != ${STUDIO_HYBRID_DCC_GLB_MIME_TYPE}`);
  }
  if (!fileName.endsWith(".glb")) {
    fail(name, `fileName ${fileName} does not end in .glb`);
  }

  // ---- determinism -------------------------------------------------------
  const second = exportFixture(name, build(), 1);
  if (!second.ok) {
    fail(name, "second export of an identical mesh was blocked");
  } else if (Buffer.compare(Buffer.from(bytes), Buffer.from(second.bytes)) !== 0) {
    fail(name, "export is not byte-deterministic across two identical runs");
  }

  // ---- container header --------------------------------------------------
  const container = readGlbChunks(bytes);
  if (container.magic !== GLB_MAGIC) {
    fail(name, `GLB magic 0x${container.magic.toString(16)} != 0x${GLB_MAGIC.toString(16)}`);
  }
  if (container.version !== GLB_VERSION) {
    fail(name, `GLB version ${container.version} != ${GLB_VERSION}`);
  }
  if (container.declaredLength !== bytes.byteLength) {
    fail(name, `GLB header length ${container.declaredLength} != actual ${bytes.byteLength}`);
  }
  if (container.consumedLength !== bytes.byteLength) {
    fail(
      name,
      `chunk walk consumed ${container.consumedLength} of ${bytes.byteLength} bytes ` +
        "(chunk length field disagrees with the container)",
    );
  }
  if (metrics.glbByteLength !== bytes.byteLength) {
    fail(name, `metrics.glbByteLength ${metrics.glbByteLength} != actual ${bytes.byteLength}`);
  }

  // asset.* is asserted against the raw JSON chunk, not the parsed Document:
  // @gltf-transform/core stamps its own `generator` onto every Document it builds,
  // so reading it back through the Document would silently test glTF-Transform.
  const assetJson = container.json?.asset;
  if (!assetJson) {
    fail(name, "GLB has no JSON chunk with an `asset` object");
  } else {
    if (assetJson.generator !== STUDIO_HYBRID_DCC_GLB_EXPORT_GENERATOR) {
      fail(
        name,
        `asset.generator ${JSON.stringify(assetJson.generator)} != ` +
          JSON.stringify(STUDIO_HYBRID_DCC_GLB_EXPORT_GENERATOR),
      );
    }
    if (assetJson.version !== "2.0") {
      fail(name, `asset.version ${JSON.stringify(assetJson.version)} != "2.0"`);
    }
  }

  // ---- Khronos glTF-Validator -------------------------------------------
  let validation;
  try {
    validation = await validateBytes(new Uint8Array(bytes), {
      uri: fileName,
      format: "glb",
      maxIssues: 0,
      writeTimestamp: false,
      // Every buffer is embedded in the BIN chunk; there is nothing external to
      // resolve, so a request for one is itself a defect we want reported.
      externalResourceFunction: (uri) =>
        Promise.reject(new Error(`unexpected external resource request: ${uri}`)),
    });
  } catch (error) {
    fail(name, `glTF-Validator threw: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const issues = validation.issues;
  for (const message of issues.messages) {
    let severityLabel = "INFO";
    if (message.severity === 0) severityLabel = "ERROR";
    else if (message.severity === 1) severityLabel = "WARNING";
    const line = `${severityLabel} ` + `${message.code} at ${message.pointer || "(root)"}: ${message.message}`;

    if (message.severity === 0) {
      fail(name, `glTF-Validator ${line}`);
    } else {
      warn(name, `glTF-Validator ${line}`);
    }
  }
  if (issues.numErrors > 0 && issues.messages.length === 0) {
    fail(name, `glTF-Validator reported ${issues.numErrors} errors with no messages`);
  }

  // ---- independent parse: @gltf-transform/core ---------------------------
  let document;
  try {
    document = await new NodeIO().readBinary(new Uint8Array(bytes));
  } catch (error) {
    fail(name, `@gltf-transform/core failed to parse: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const root = document.getRoot();

  const meshes = root.listMeshes();
  if (meshes.length !== 1) {
    fail(name, `expected exactly 1 mesh, found ${meshes.length}`);
    return;
  }
  const primitives = meshes[0].listPrimitives();
  if (primitives.length !== 1) {
    fail(name, `expected exactly 1 primitive, found ${primitives.length}`);
    return;
  }

  const primitive = primitives[0];
  const position = primitive.getAttribute("POSITION");
  const normal = primitive.getAttribute("NORMAL");
  const indices = primitive.getIndices();

  if (!position) {
    fail(name, "primitive has no POSITION attribute");
    return;
  }
  if (!indices) {
    fail(name, "primitive has no indices");
    return;
  }

  // Cross-check the exporter's own metrics against the independent parse.
  if (position.getCount() !== metrics.outputVertexCount) {
    fail(name, `POSITION count ${position.getCount()} != metrics.outputVertexCount ${metrics.outputVertexCount}`);
  }
  if (indices.getCount() !== metrics.triangleCount * 3) {
    fail(name, `index count ${indices.getCount()} != triangleCount*3 ${metrics.triangleCount * 3}`);
  }
  if (indices.getCount() % 3 !== 0) {
    fail(name, `index count ${indices.getCount()} is not a multiple of 3`);
  }
  if (normal && normal.getCount() !== position.getCount()) {
    fail(name, `NORMAL count ${normal.getCount()} != POSITION count ${position.getCount()}`);
  }
  if (!normal) {
    warn(name, "primitive has no NORMAL attribute");
  }

  // Indices must address real vertices. glTF-Validator checks this too; doing it
  // here as well means a validator regression cannot silently drop the check.
  const vertexCount = position.getCount();
  const indexArray = indices.getArray();
  for (let i = 0; i < indexArray.length; i += 1) {
    if (indexArray[i] >= vertexCount) {
      fail(name, `index[${i}] = ${indexArray[i]} is out of range for ${vertexCount} vertices`);
      break;
    }
  }

  // POSITION min/max are REQUIRED by the spec and are what viewers use to frame
  // the asset; a stale bound is invisible until an import looks wrong.
  const declaredMin = position.getMin([]);
  const declaredMax = position.getMax([]);
  const actualMin = [Infinity, Infinity, Infinity];
  const actualMax = [-Infinity, -Infinity, -Infinity];
  const element = [0, 0, 0];
  for (let v = 0; v < vertexCount; v += 1) {
    position.getElement(v, element);
    for (let axis = 0; axis < 3; axis += 1) {
      if (element[axis] < actualMin[axis]) actualMin[axis] = element[axis];
      if (element[axis] > actualMax[axis]) actualMax[axis] = element[axis];
    }
  }
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(declaredMin[axis] - actualMin[axis]) > 1e-6) {
      fail(name, `POSITION min[${axis}] declared ${declaredMin[axis]} != actual ${actualMin[axis]}`);
    }
    if (Math.abs(declaredMax[axis] - actualMax[axis]) > 1e-6) {
      fail(name, `POSITION max[${axis}] declared ${declaredMax[axis]} != actual ${actualMax[axis]}`);
    }
  }

  const indexComponentType = COMPONENT_TYPE_NAMES.get(indices.getComponentType()) ?? indices.getComponentType();
  console.log(
    `  ok  ${name.padEnd(20)} ` +
      `${String(metrics.triangleCount).padStart(5)} tri  ` +
      `${String(vertexCount).padStart(5)} vtx  ` +
      `${String(bytes.byteLength).padStart(7)} B  ` +
      `idx=${indexComponentType}  ` +
      `validator: ${issues.numErrors}E/${issues.numWarnings}W/${issues.numInfos}I  ` +
      `losses=${report.losses.length}`,
  );
}

/**
 * The exporter documents that invalid topology "never yields partial bytes". A gate
 * that only exercises the happy path would not notice that guarantee breaking.
 */
function verifyBlockedExportEmitsNoBytes() {
  const mesh = createStudioUnitCubeMesh();
  const wrongHash = exportStudioHybridDccMeshGlb({
    assetId: "verify-glb-hash-mismatch",
    mesh,
    sourceRevision: 1,
    sourceHash: "0".repeat(64),
  });
  if (wrongHash.ok) {
    fail("blocked-export", "a mismatched sourceHash still produced GLB bytes");
  } else if ("bytes" in wrongHash) {
    fail("blocked-export", "blocked result carried a `bytes` field");
  } else {
    console.log(
      `  ok  ${"blocked-export".padEnd(20)} hash mismatch refused: ` +
        wrongHash.report.errors.map((issue) => issue.code).join(", "),
    );
  }
}

async function main() {
  console.log("Hybrid DCC GLB export — Khronos conformance gate");
  console.log(`  gltf-validator ${(await import("gltf-validator")).version()}`);
  console.log("");

  for (const fixture of FIXTURES) {
    await verifyFixture(fixture);
  }
  verifyBlockedExportEmitsNoBytes();

  if (warnings.length > 0) {
    console.log("");
    console.log(`Warnings (${warnings.length}):`);
    for (const warning of warnings) console.log(`  - ${warning}`);
  }

  if (failures.length > 0) {
    console.log("");
    console.error(`FAILED (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log(`PASS — ${FIXTURES.length} fixtures validated against Khronos glTF-Validator`);
}

await main();
