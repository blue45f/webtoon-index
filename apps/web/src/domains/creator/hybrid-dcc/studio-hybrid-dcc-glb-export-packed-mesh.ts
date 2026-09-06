import { calculateStudioCrc32 } from "../studio-crc32";
import {
  STUDIO_EDITABLE_MESH_LIMITS,
  STUDIO_EDITABLE_MESH_REVISION,
} from "../studio-editable-half-edge-mesh";

import type { StudioEditableMesh } from "../studio-editable-half-edge-mesh";
import type { StudioHybridDccMeshGlbExportInput } from "./studio-hybrid-dcc-glb-export";

export const STUDIO_HYBRID_DCC_PACKED_MESH_FORMAT =
  "toonspectrum.hybrid-dcc-editable-mesh-soa" as const;
export const STUDIO_HYBRID_DCC_PACKED_MESH_REVISION = 1 as const;
export const STUDIO_HYBRID_DCC_PACKED_MESH_ENDIANNESS = "little" as const;

const FLOAT64_BYTES = Float64Array.BYTES_PER_ELEMENT;
const UINT8_BYTES = Uint8Array.BYTES_PER_ELEMENT;
const UINT32_MAX = 0xffff_ffff;
const PACKED_VERTEX_BYTES = 6 * FLOAT64_BYTES;
const PACKED_HALF_EDGE_BYTES = 7 * FLOAT64_BYTES;
const PACKED_FACE_BYTES = 3 * FLOAT64_BYTES + UINT8_BYTES;

export const STUDIO_HYBRID_DCC_PACKED_MESH_MAX_BYTES =
  STUDIO_EDITABLE_MESH_LIMITS.maxVertices * PACKED_VERTEX_BYTES
  + STUDIO_EDITABLE_MESH_LIMITS.maxEdges * 2 * PACKED_HALF_EDGE_BYTES
  + STUDIO_EDITABLE_MESH_LIMITS.maxFaces * PACKED_FACE_BYTES;

export const STUDIO_HYBRID_DCC_PACKED_MESH_SECTION_NAMES = [
  "vertexIds",
  "vertexPositions",
  "vertexCreases",
  "vertexHalfEdges",
  "halfEdgeIds",
  "halfEdgeVertices",
  "halfEdgeFaces",
  "halfEdgeNext",
  "halfEdgePrevious",
  "halfEdgeTwins",
  "halfEdgeCreases",
  "faceIds",
  "faceHalfEdges",
  "faceMaterialSlots",
  "faceSmooth",
] as const;

export type StudioHybridDccPackedMeshSectionName =
  typeof STUDIO_HYBRID_DCC_PACKED_MESH_SECTION_NAMES[number];
export type StudioHybridDccPackedMeshEncoding =
  | "float64"
  | "float64-safe-integer"
  | "uint8-boolean";

export interface StudioHybridDccPackedMeshSection {
  readonly offset: number;
  readonly byteLength: number;
  readonly count: number;
  readonly components: 1 | 3;
  readonly encoding: StudioHybridDccPackedMeshEncoding;
}

export interface StudioHybridDccPackedMeshManifest {
  readonly format: typeof STUDIO_HYBRID_DCC_PACKED_MESH_FORMAT;
  readonly revision: typeof STUDIO_HYBRID_DCC_PACKED_MESH_REVISION;
  readonly endianness: typeof STUDIO_HYBRID_DCC_PACKED_MESH_ENDIANNESS;
  readonly assetId: string;
  readonly sourceRevision: number;
  readonly sourceHash: string;
  readonly meshRevision: typeof STUDIO_EDITABLE_MESH_REVISION;
  readonly counts: {
    readonly vertices: number;
    readonly halfEdges: number;
    readonly faces: number;
  };
  readonly counters: {
    readonly nextVertexId: number;
    readonly nextHalfEdgeId: number;
    readonly nextFaceId: number;
  };
  readonly byteLength: number;
  readonly payloadCrc32: number;
  /** Binds source provenance, counts, offsets, encodings, and payload CRC into one receipt. */
  readonly provenanceCrc32: number;
  readonly sections: Readonly<Record<StudioHybridDccPackedMeshSectionName, StudioHybridDccPackedMeshSection>>;
}

export interface StudioHybridDccPackedMeshPayload {
  readonly manifest: StudioHybridDccPackedMeshManifest;
  readonly buffer: ArrayBuffer;
}

interface SectionSpec {
  readonly name: StudioHybridDccPackedMeshSectionName;
  readonly count: number;
  readonly components: 1 | 3;
  readonly encoding: StudioHybridDccPackedMeshEncoding;
}

interface ExpectedLayout {
  readonly byteLength: number;
  readonly sections: Readonly<Record<StudioHybridDccPackedMeshSectionName, StudioHybridDccPackedMeshSection>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isSafeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function checkedProduct(left: number, right: number): number {
  if (
    !Number.isSafeInteger(left)
    || left < 0
    || !Number.isSafeInteger(right)
    || right < 0
    || (left !== 0 && right > Math.floor(Number.MAX_SAFE_INTEGER / left))
  ) throw new RangeError("packed mesh byte budget overflow");
  return left * right;
}

function checkedSum(left: number, right: number): number {
  if (!Number.isSafeInteger(right) || right < 0 || left > Number.MAX_SAFE_INTEGER - right) {
    throw new RangeError("packed mesh byte budget overflow");
  }
  return left + right;
}

function sectionSpecs(
  vertices: number,
  halfEdges: number,
  faces: number,
): readonly SectionSpec[] {
  return [
    { name: "vertexIds", count: vertices, components: 1, encoding: "float64-safe-integer" },
    { name: "vertexPositions", count: vertices, components: 3, encoding: "float64" },
    { name: "vertexCreases", count: vertices, components: 1, encoding: "float64" },
    { name: "vertexHalfEdges", count: vertices, components: 1, encoding: "float64-safe-integer" },
    { name: "halfEdgeIds", count: halfEdges, components: 1, encoding: "float64-safe-integer" },
    { name: "halfEdgeVertices", count: halfEdges, components: 1, encoding: "float64-safe-integer" },
    { name: "halfEdgeFaces", count: halfEdges, components: 1, encoding: "float64-safe-integer" },
    { name: "halfEdgeNext", count: halfEdges, components: 1, encoding: "float64-safe-integer" },
    { name: "halfEdgePrevious", count: halfEdges, components: 1, encoding: "float64-safe-integer" },
    { name: "halfEdgeTwins", count: halfEdges, components: 1, encoding: "float64-safe-integer" },
    { name: "halfEdgeCreases", count: halfEdges, components: 1, encoding: "float64" },
    { name: "faceIds", count: faces, components: 1, encoding: "float64-safe-integer" },
    { name: "faceHalfEdges", count: faces, components: 1, encoding: "float64-safe-integer" },
    { name: "faceMaterialSlots", count: faces, components: 1, encoding: "float64-safe-integer" },
    { name: "faceSmooth", count: faces, components: 1, encoding: "uint8-boolean" },
  ];
}

function expectedLayout(vertices: number, halfEdges: number, faces: number): ExpectedLayout {
  let offset = 0;
  const sections = {} as Record<StudioHybridDccPackedMeshSectionName, StudioHybridDccPackedMeshSection>;
  for (const spec of sectionSpecs(vertices, halfEdges, faces)) {
    const componentBytes = spec.encoding === "uint8-boolean" ? UINT8_BYTES : FLOAT64_BYTES;
    const byteLength = checkedProduct(checkedProduct(spec.count, spec.components), componentBytes);
    sections[spec.name] = {
      offset,
      byteLength,
      count: spec.count,
      components: spec.components,
      encoding: spec.encoding,
    };
    offset = checkedSum(offset, byteLength);
  }
  return { byteLength: offset, sections };
}

function sameSection(
  value: unknown,
  expected: StudioHybridDccPackedMeshSection,
): value is StudioHybridDccPackedMeshSection {
  return isRecord(value)
    && hasExactKeys(value, ["offset", "byteLength", "count", "components", "encoding"])
    && value.offset === expected.offset
    && value.byteLength === expected.byteLength
    && value.count === expected.count
    && value.components === expected.components
    && value.encoding === expected.encoding;
}

function manifestEnvelope(value: unknown): value is StudioHybridDccPackedMeshManifest {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "format",
      "revision",
      "endianness",
      "assetId",
      "sourceRevision",
      "sourceHash",
      "meshRevision",
      "counts",
      "counters",
      "byteLength",
      "payloadCrc32",
      "provenanceCrc32",
      "sections",
    ])
    || value.format !== STUDIO_HYBRID_DCC_PACKED_MESH_FORMAT
    || value.revision !== STUDIO_HYBRID_DCC_PACKED_MESH_REVISION
    || value.endianness !== STUDIO_HYBRID_DCC_PACKED_MESH_ENDIANNESS
    || !isBoundedString(value.assetId, 1, 160)
    || !isSafeInteger(value.sourceRevision, 1)
    || !isBoundedString(value.sourceHash, 1, 160)
    || value.meshRevision !== STUDIO_EDITABLE_MESH_REVISION
    || !isRecord(value.counts)
    || !hasExactKeys(value.counts, ["vertices", "halfEdges", "faces"])
    || !isSafeInteger(value.counts.vertices)
    || value.counts.vertices > STUDIO_EDITABLE_MESH_LIMITS.maxVertices
    || !isSafeInteger(value.counts.halfEdges)
    || value.counts.halfEdges > STUDIO_EDITABLE_MESH_LIMITS.maxEdges * 2
    || !isSafeInteger(value.counts.faces)
    || value.counts.faces > STUDIO_EDITABLE_MESH_LIMITS.maxFaces
    || !isRecord(value.counters)
    || !hasExactKeys(value.counters, ["nextVertexId", "nextHalfEdgeId", "nextFaceId"])
    || !isSafeInteger(value.counters.nextVertexId)
    || !isSafeInteger(value.counters.nextHalfEdgeId)
    || !isSafeInteger(value.counters.nextFaceId)
    || !isSafeInteger(value.byteLength)
    || value.byteLength > STUDIO_HYBRID_DCC_PACKED_MESH_MAX_BYTES
    || !isSafeInteger(value.payloadCrc32)
    || value.payloadCrc32 > UINT32_MAX
    || !isSafeInteger(value.provenanceCrc32)
    || value.provenanceCrc32 > UINT32_MAX
    || !isRecord(value.sections)
    || !hasExactKeys(value.sections, STUDIO_HYBRID_DCC_PACKED_MESH_SECTION_NAMES)
  ) return false;

  let layout: ExpectedLayout;
  try {
    layout = expectedLayout(value.counts.vertices, value.counts.halfEdges, value.counts.faces);
  } catch {
    return false;
  }
  const sections = value.sections as Record<string, unknown>;
  return value.byteLength === layout.byteLength
    && STUDIO_HYBRID_DCC_PACKED_MESH_SECTION_NAMES.every(
      (name) => sameSection(sections[name], layout.sections[name]),
    );
}

export function isStudioHybridDccPackedMeshPayloadEnvelope(
  value: unknown,
): value is StudioHybridDccPackedMeshPayload {
  return isRecord(value)
    && hasExactKeys(value, ["manifest", "buffer"])
    && manifestEnvelope(value.manifest)
    && value.buffer instanceof ArrayBuffer
    && value.buffer.byteLength === value.manifest.byteLength;
}

function provenanceValues(manifest: StudioHybridDccPackedMeshManifest): readonly unknown[] {
  const sectionValues = STUDIO_HYBRID_DCC_PACKED_MESH_SECTION_NAMES.flatMap((name) => {
    const section = manifest.sections[name];
    return [name, section.offset, section.byteLength, section.count, section.components, section.encoding];
  });
  return [
    manifest.format,
    manifest.revision,
    manifest.endianness,
    manifest.assetId,
    manifest.sourceRevision,
    manifest.sourceHash,
    manifest.meshRevision,
    manifest.counts.vertices,
    manifest.counts.halfEdges,
    manifest.counts.faces,
    manifest.counters.nextVertexId,
    manifest.counters.nextHalfEdgeId,
    manifest.counters.nextFaceId,
    manifest.byteLength,
    manifest.payloadCrc32,
    ...sectionValues,
  ];
}

function provenanceCrc32(manifest: StudioHybridDccPackedMeshManifest): number {
  const bytes = new TextEncoder().encode(JSON.stringify(provenanceValues(manifest)));
  return calculateStudioCrc32(bytes);
}

export function hasValidStudioHybridDccPackedMeshChecksums(
  payload: StudioHybridDccPackedMeshPayload,
): boolean {
  if (!isStudioHybridDccPackedMeshPayloadEnvelope(payload)) return false;
  return calculateStudioCrc32(new Uint8Array(payload.buffer)) === payload.manifest.payloadCrc32
    && provenanceCrc32(payload.manifest) === payload.manifest.provenanceCrc32;
}

function writeFloat64(
  view: DataView,
  section: StudioHybridDccPackedMeshSection,
  index: number,
  value: number,
  component = 0,
): void {
  view.setFloat64(
    section.offset + (index * section.components + component) * FLOAT64_BYTES,
    value,
    true,
  );
}

function readFloat64(
  view: DataView,
  section: StudioHybridDccPackedMeshSection,
  index: number,
  component = 0,
): number {
  return view.getFloat64(
    section.offset + (index * section.components + component) * FLOAT64_BYTES,
    true,
  );
}

function assertSafeInteger(value: unknown, minimum: number, field: string): asserts value is number {
  if (!isSafeInteger(value, minimum)) throw new TypeError(`${field} must be a safe integer >= ${minimum}`);
}

function assertFinite(value: unknown, field: string): asserts value is number {
  if (!isFiniteNumber(value)) throw new TypeError(`${field} must be finite`);
}

function assertCrease(value: unknown, field: string): asserts value is number {
  assertFinite(value, field);
  if (value < 0 || value > 1) throw new TypeError(`${field} must be in [0, 1]`);
}

export function packStudioHybridDccGlbExportInput(
  input: StudioHybridDccMeshGlbExportInput,
): StudioHybridDccPackedMeshPayload {
  if (
    !isRecord(input)
    || !isBoundedString(input.assetId, 1, 160)
    || !isSafeInteger(input.sourceRevision, 1)
    || !isBoundedString(input.sourceHash, 1, 160)
    || !isRecord(input.mesh)
    || input.mesh.revision !== STUDIO_EDITABLE_MESH_REVISION
    || !Array.isArray(input.mesh.vertices)
    || input.mesh.vertices.length > STUDIO_EDITABLE_MESH_LIMITS.maxVertices
    || !Array.isArray(input.mesh.halfEdges)
    || input.mesh.halfEdges.length > STUDIO_EDITABLE_MESH_LIMITS.maxEdges * 2
    || !Array.isArray(input.mesh.faces)
    || input.mesh.faces.length > STUDIO_EDITABLE_MESH_LIMITS.maxFaces
  ) throw new TypeError("invalid Hybrid DCC packed-mesh input");
  assertSafeInteger(input.mesh.nextVertexId, 0, "nextVertexId");
  assertSafeInteger(input.mesh.nextHalfEdgeId, 0, "nextHalfEdgeId");
  assertSafeInteger(input.mesh.nextFaceId, 0, "nextFaceId");

  const counts = {
    vertices: input.mesh.vertices.length,
    halfEdges: input.mesh.halfEdges.length,
    faces: input.mesh.faces.length,
  };
  const layout = expectedLayout(counts.vertices, counts.halfEdges, counts.faces);
  const buffer = new ArrayBuffer(layout.byteLength);
  const view = new DataView(buffer);

  for (let index = 0; index < input.mesh.vertices.length; index += 1) {
    const vertex = input.mesh.vertices[index];
    if (!isRecord(vertex) || !isRecord(vertex.position)) throw new TypeError("invalid vertex record");
    assertSafeInteger(vertex.id, 0, `vertices[${index}].id`);
    assertFinite(vertex.position.x, `vertices[${index}].position.x`);
    assertFinite(vertex.position.y, `vertices[${index}].position.y`);
    assertFinite(vertex.position.z, `vertices[${index}].position.z`);
    assertCrease(vertex.crease, `vertices[${index}].crease`);
    assertSafeInteger(vertex.he, -1, `vertices[${index}].he`);
    writeFloat64(view, layout.sections.vertexIds, index, vertex.id);
    writeFloat64(view, layout.sections.vertexPositions, index, vertex.position.x, 0);
    writeFloat64(view, layout.sections.vertexPositions, index, vertex.position.y, 1);
    writeFloat64(view, layout.sections.vertexPositions, index, vertex.position.z, 2);
    writeFloat64(view, layout.sections.vertexCreases, index, vertex.crease);
    writeFloat64(view, layout.sections.vertexHalfEdges, index, vertex.he);
  }
  for (let index = 0; index < input.mesh.halfEdges.length; index += 1) {
    const halfEdge = input.mesh.halfEdges[index];
    if (!isRecord(halfEdge)) throw new TypeError("invalid half-edge record");
    assertSafeInteger(halfEdge.id, 0, `halfEdges[${index}].id`);
    assertSafeInteger(halfEdge.vertex, 0, `halfEdges[${index}].vertex`);
    assertSafeInteger(halfEdge.face, -1, `halfEdges[${index}].face`);
    assertSafeInteger(halfEdge.next, 0, `halfEdges[${index}].next`);
    assertSafeInteger(halfEdge.prev, 0, `halfEdges[${index}].prev`);
    assertSafeInteger(halfEdge.twin, -1, `halfEdges[${index}].twin`);
    assertCrease(halfEdge.crease, `halfEdges[${index}].crease`);
    writeFloat64(view, layout.sections.halfEdgeIds, index, halfEdge.id);
    writeFloat64(view, layout.sections.halfEdgeVertices, index, halfEdge.vertex);
    writeFloat64(view, layout.sections.halfEdgeFaces, index, halfEdge.face);
    writeFloat64(view, layout.sections.halfEdgeNext, index, halfEdge.next);
    writeFloat64(view, layout.sections.halfEdgePrevious, index, halfEdge.prev);
    writeFloat64(view, layout.sections.halfEdgeTwins, index, halfEdge.twin);
    writeFloat64(view, layout.sections.halfEdgeCreases, index, halfEdge.crease);
  }
  for (let index = 0; index < input.mesh.faces.length; index += 1) {
    const face = input.mesh.faces[index];
    if (!isRecord(face)) throw new TypeError("invalid face record");
    assertSafeInteger(face.id, 0, `faces[${index}].id`);
    assertSafeInteger(face.he, 0, `faces[${index}].he`);
    assertSafeInteger(face.materialSlot, 0, `faces[${index}].materialSlot`);
    if (typeof face.smooth !== "boolean") throw new TypeError(`faces[${index}].smooth must be boolean`);
    writeFloat64(view, layout.sections.faceIds, index, face.id);
    writeFloat64(view, layout.sections.faceHalfEdges, index, face.he);
    writeFloat64(view, layout.sections.faceMaterialSlots, index, face.materialSlot);
    view.setUint8(layout.sections.faceSmooth.offset + index, face.smooth ? 1 : 0);
  }

  const payloadCrc32 = calculateStudioCrc32(new Uint8Array(buffer));
  const manifestWithoutProvenance: StudioHybridDccPackedMeshManifest = {
    format: STUDIO_HYBRID_DCC_PACKED_MESH_FORMAT,
    revision: STUDIO_HYBRID_DCC_PACKED_MESH_REVISION,
    endianness: STUDIO_HYBRID_DCC_PACKED_MESH_ENDIANNESS,
    assetId: input.assetId,
    sourceRevision: input.sourceRevision,
    sourceHash: input.sourceHash,
    meshRevision: STUDIO_EDITABLE_MESH_REVISION,
    counts,
    counters: {
      nextVertexId: input.mesh.nextVertexId,
      nextHalfEdgeId: input.mesh.nextHalfEdgeId,
      nextFaceId: input.mesh.nextFaceId,
    },
    byteLength: buffer.byteLength,
    payloadCrc32,
    provenanceCrc32: 0,
    sections: layout.sections,
  };
  const manifest: StudioHybridDccPackedMeshManifest = {
    ...manifestWithoutProvenance,
    provenanceCrc32: provenanceCrc32(manifestWithoutProvenance),
  };
  return { manifest, buffer };
}

function safeDecodedInteger(value: number, minimum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum;
}

export function unpackStudioHybridDccGlbExportInput(
  payload: StudioHybridDccPackedMeshPayload,
): StudioHybridDccMeshGlbExportInput | null {
  if (!hasValidStudioHybridDccPackedMeshChecksums(payload)) return null;
  const { manifest } = payload;
  const view = new DataView(payload.buffer);
  const vertices: StudioEditableMesh["vertices"][number][] = [];
  const halfEdges: StudioEditableMesh["halfEdges"][number][] = [];
  const faces: StudioEditableMesh["faces"][number][] = [];

  for (let index = 0; index < manifest.counts.vertices; index += 1) {
    const id = readFloat64(view, manifest.sections.vertexIds, index);
    const x = readFloat64(view, manifest.sections.vertexPositions, index, 0);
    const y = readFloat64(view, manifest.sections.vertexPositions, index, 1);
    const z = readFloat64(view, manifest.sections.vertexPositions, index, 2);
    const crease = readFloat64(view, manifest.sections.vertexCreases, index);
    const he = readFloat64(view, manifest.sections.vertexHalfEdges, index);
    if (
      !safeDecodedInteger(id, 0)
      || !Number.isFinite(x)
      || !Number.isFinite(y)
      || !Number.isFinite(z)
      || !Number.isFinite(crease)
      || crease < 0
      || crease > 1
      || !safeDecodedInteger(he, -1)
    ) return null;
    vertices.push({ id, position: { x, y, z }, crease, he });
  }
  for (let index = 0; index < manifest.counts.halfEdges; index += 1) {
    const id = readFloat64(view, manifest.sections.halfEdgeIds, index);
    const vertex = readFloat64(view, manifest.sections.halfEdgeVertices, index);
    const face = readFloat64(view, manifest.sections.halfEdgeFaces, index);
    const next = readFloat64(view, manifest.sections.halfEdgeNext, index);
    const prev = readFloat64(view, manifest.sections.halfEdgePrevious, index);
    const twin = readFloat64(view, manifest.sections.halfEdgeTwins, index);
    const crease = readFloat64(view, manifest.sections.halfEdgeCreases, index);
    if (
      !safeDecodedInteger(id, 0)
      || !safeDecodedInteger(vertex, 0)
      || !safeDecodedInteger(face, -1)
      || !safeDecodedInteger(next, 0)
      || !safeDecodedInteger(prev, 0)
      || !safeDecodedInteger(twin, -1)
      || !Number.isFinite(crease)
      || crease < 0
      || crease > 1
    ) return null;
    halfEdges.push({ id, vertex, face, next, prev, twin, crease });
  }
  for (let index = 0; index < manifest.counts.faces; index += 1) {
    const id = readFloat64(view, manifest.sections.faceIds, index);
    const he = readFloat64(view, manifest.sections.faceHalfEdges, index);
    const materialSlot = readFloat64(view, manifest.sections.faceMaterialSlots, index);
    const smooth = view.getUint8(manifest.sections.faceSmooth.offset + index);
    if (
      !safeDecodedInteger(id, 0)
      || !safeDecodedInteger(he, 0)
      || !safeDecodedInteger(materialSlot, 0)
      || (smooth !== 0 && smooth !== 1)
    ) return null;
    faces.push({ id, he, materialSlot, smooth: smooth === 1 });
  }

  const mesh: StudioEditableMesh = {
    revision: STUDIO_EDITABLE_MESH_REVISION,
    vertices,
    halfEdges,
    faces,
    nextVertexId: manifest.counters.nextVertexId,
    nextHalfEdgeId: manifest.counters.nextHalfEdgeId,
    nextFaceId: manifest.counters.nextFaceId,
  };
  return {
    assetId: manifest.assetId,
    mesh,
    sourceRevision: manifest.sourceRevision,
    sourceHash: manifest.sourceHash,
  };
}

export function studioHybridDccPackedMeshPayloadTransfers(
  payloads: readonly StudioHybridDccPackedMeshPayload[],
): Transferable[] {
  return payloads.map(({ buffer }) => buffer);
}
