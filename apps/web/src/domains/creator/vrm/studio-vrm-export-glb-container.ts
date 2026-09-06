/**
 * Pure GLB 2.0 container writer/reader for the VRM 내보내기 boundary.
 *
 * The repo already *reads* GLB in `studio-bg3d-glb-validation.ts` and hands validator-owned bytes to
 * a download in `studio-bg3d-canonical-glb-download.ts`; nothing here re-implements those checks.
 * What was missing is a **writer**: `three/examples/jsm/exporters/GLTFExporter` (used by
 * `studio-bg3d-model-import.ts`) can emit a GLB, but it offers no hook for *root-level* glTF
 * extensions — `includeCustomExtensions` only forwards `object.userData.gltfExtensions` onto node
 * and material defs. `VRMC_vrm` lives at `json.extensions`, so a VRM cannot be produced by
 * GLTFExporter alone. This module owns the container so the VRM JSON can be authored directly.
 *
 * Constants and limits deliberately reuse `studio-bg3d-glb-validation.ts` so anything written here
 * survives the app's own import gate instead of inventing a second, looser envelope.
 */

import {
  STUDIO_BG3D_GLB_MAX_BYTES,
  STUDIO_BG3D_GLB_MAX_JSON_BYTES,
  STUDIO_BG3D_GLB_MIME_TYPE,
} from "../bg3d/studio-bg3d-glb-validation";

import { StudioVrmExportError, studioVrmExportError } from "./studio-vrm-export-error";

export const STUDIO_VRM_EXPORT_GLB_MAGIC = 0x46546c67;
export const STUDIO_VRM_EXPORT_GLB_VERSION = 2;
export const STUDIO_VRM_EXPORT_GLB_HEADER_BYTES = 12;
export const STUDIO_VRM_EXPORT_GLB_CHUNK_HEADER_BYTES = 8;
export const STUDIO_VRM_EXPORT_JSON_CHUNK_TYPE = 0x4e4f534a;
export const STUDIO_VRM_EXPORT_BIN_CHUNK_TYPE = 0x004e4942;
/** glTF 2.0 §3.3: JSON chunk trailing padding is spaces, BIN chunk trailing padding is zeroes. */
export const STUDIO_VRM_EXPORT_JSON_PAD_BYTE = 0x20;
export const STUDIO_VRM_EXPORT_BIN_PAD_BYTE = 0x00;

/** VRM files are GLB containers; the repo's canonical GLB media type applies unchanged. */
export const STUDIO_VRM_EXPORT_MIME_TYPE = STUDIO_BG3D_GLB_MIME_TYPE;
/**
 * The tighter of the two import gates wins. `validateStudioBg3dGlb` caps a model at 100 MiB and its
 * JSON chunk at 4 MiB; `vrm-library.ts` allows 128 MiB / 8 MiB. Emitting past the tighter ceiling
 * would produce a file this very app refuses to re-import.
 */
export const STUDIO_VRM_EXPORT_MAX_BYTES = STUDIO_BG3D_GLB_MAX_BYTES;
export const STUDIO_VRM_EXPORT_MAX_JSON_BYTES = STUDIO_BG3D_GLB_MAX_JSON_BYTES;

export interface StudioVrmExportGlbLayout {
  readonly totalByteLength: number;
  /** Offset of the JSON chunk header (always immediately after the 12-byte file header). */
  readonly jsonChunkOffset: number;
  readonly jsonContentOffset: number;
  readonly jsonByteLength: number;
  readonly jsonPaddedByteLength: number;
  readonly jsonPaddingBytes: number;
  /** `null` when the document embeds no binary buffer at all. */
  readonly binChunkOffset: number | null;
  readonly binContentOffset: number | null;
  readonly binByteLength: number;
  readonly binPaddedByteLength: number;
  readonly binPaddingBytes: number;
}

export interface StudioVrmExportGlbInput {
  readonly json: unknown;
  /** Omit (or pass an empty view) to emit a JSON-only GLB with no BIN chunk. */
  readonly binary?: Uint8Array | null;
}

export interface StudioVrmExportParsedGlb {
  readonly json: Record<string, unknown>;
  readonly jsonByteLength: number;
  /** Unpadded BIN chunk payload; empty when the file carries no BIN chunk. */
  readonly binary: Uint8Array<ArrayBuffer>;
  readonly layout: StudioVrmExportGlbLayout;
}

function alignToFour(byteLength: number): number {
  return (byteLength + 3) & ~3;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

/**
 * Canonical JSON: object keys are emitted in sorted order and `undefined` members are dropped, so
 * two runs over equal data produce byte-identical text regardless of property insertion order.
 * Array order is never touched — glTF indexes into arrays.
 */
function canonicalizeJsonValue(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    // NaN/Infinity would silently become `null` in JSON.stringify and corrupt the glTF document.
    if (!Number.isFinite(value)) throw studioVrmExportError("json-not-serializable");
    // `-0` stringifies as `0`; normalize first so structural comparisons stay stable too.
    return value === 0 ? 0 : value;
  }
  if (typeof value !== "object") throw studioVrmExportError("json-not-serializable");
  // A cycle would otherwise recurse until the stack overflows instead of failing honestly.
  if (seen.has(value)) throw studioVrmExportError("json-not-serializable");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => {
        if (entry === undefined) throw studioVrmExportError("json-not-serializable");
        return canonicalizeJsonValue(entry, seen);
      });
    }
    if (!isPlainObject(value)) throw studioVrmExportError("json-not-serializable");
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry === undefined) continue;
      result[key] = canonicalizeJsonValue(entry, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

/** Deterministic UTF-8 JSON text for a glTF root. Exported so tests can assert byte stability. */
export function canonicalStudioVrmExportJsonText(json: unknown): string {
  if (!isPlainObject(json)) throw studioVrmExportError("json-not-serializable");
  const canonical = canonicalizeJsonValue(json, new Set<object>());
  let text: string;
  try {
    text = JSON.stringify(canonical);
  } catch (cause) {
    // `canonicalizeJsonValue` already rejected cycles and every non-JSON value type, so this is a
    // defence-in-depth branch rather than an expected path.
    throw new StudioVrmExportError("json-not-serializable", undefined, { cause });
  }
  if (typeof text !== "string") throw studioVrmExportError("json-not-serializable");
  return text;
}

/**
 * Pure arithmetic for the chunk table. Given payload sizes it yields every offset in the file, so
 * the binary layout can be asserted byte-exactly without allocating the output.
 */
export function planStudioVrmExportGlbLayout(
  jsonByteLength: number,
  binByteLength: number,
): StudioVrmExportGlbLayout {
  if (
    !Number.isSafeInteger(jsonByteLength) ||
    jsonByteLength <= 0 ||
    !Number.isSafeInteger(binByteLength) ||
    binByteLength < 0
  ) {
    throw studioVrmExportError("invalid-snapshot");
  }
  const jsonPaddedByteLength = alignToFour(jsonByteLength);
  const binPaddedByteLength = alignToFour(binByteLength);
  const jsonChunkOffset = STUDIO_VRM_EXPORT_GLB_HEADER_BYTES;
  const jsonContentOffset = jsonChunkOffset + STUDIO_VRM_EXPORT_GLB_CHUNK_HEADER_BYTES;
  const jsonChunkEnd = jsonContentOffset + jsonPaddedByteLength;
  const hasBin = binByteLength > 0;
  const binChunkOffset = hasBin ? jsonChunkEnd : null;
  const binContentOffset =
    binChunkOffset === null ? null : binChunkOffset + STUDIO_VRM_EXPORT_GLB_CHUNK_HEADER_BYTES;
  const totalByteLength =
    binContentOffset === null ? jsonChunkEnd : binContentOffset + binPaddedByteLength;
  return Object.freeze({
    totalByteLength,
    jsonChunkOffset,
    jsonContentOffset,
    jsonByteLength,
    jsonPaddedByteLength,
    jsonPaddingBytes: jsonPaddedByteLength - jsonByteLength,
    binChunkOffset,
    binContentOffset,
    binByteLength,
    binPaddedByteLength,
    binPaddingBytes: hasBin ? binPaddedByteLength - binByteLength : 0,
  });
}

/**
 * Serializes a glTF root (plus optional BIN payload) into a GLB 2.0 file.
 *
 * Determinism contract: the output depends only on `input`. No timestamps, no random ids, no
 * locale-sensitive formatting.
 */
export function writeStudioVrmExportGlb(input: StudioVrmExportGlbInput): Uint8Array<ArrayBuffer> {
  if (!input || typeof input !== "object") throw studioVrmExportError("invalid-snapshot");
  const binary = input.binary ?? null;
  if (binary !== null && !(binary instanceof Uint8Array)) {
    throw studioVrmExportError("invalid-snapshot");
  }
  const jsonBytes = new TextEncoder().encode(canonicalStudioVrmExportJsonText(input.json));
  if (jsonBytes.byteLength > STUDIO_VRM_EXPORT_MAX_JSON_BYTES) {
    throw studioVrmExportError("json-too-large", {
      jsonByteLength: jsonBytes.byteLength,
      maxJsonByteLength: STUDIO_VRM_EXPORT_MAX_JSON_BYTES,
    });
  }
  const binByteLength = binary?.byteLength ?? 0;
  const layout = planStudioVrmExportGlbLayout(jsonBytes.byteLength, binByteLength);
  if (layout.totalByteLength > STUDIO_VRM_EXPORT_MAX_BYTES) {
    throw studioVrmExportError("output-too-large", {
      byteLength: layout.totalByteLength,
      maxByteLength: STUDIO_VRM_EXPORT_MAX_BYTES,
    });
  }

  const out = new Uint8Array(layout.totalByteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, STUDIO_VRM_EXPORT_GLB_MAGIC, true);
  view.setUint32(4, STUDIO_VRM_EXPORT_GLB_VERSION, true);
  view.setUint32(8, layout.totalByteLength, true);

  view.setUint32(layout.jsonChunkOffset, layout.jsonPaddedByteLength, true);
  view.setUint32(layout.jsonChunkOffset + 4, STUDIO_VRM_EXPORT_JSON_CHUNK_TYPE, true);
  // Fill padding first, then overwrite with content: the tail keeps the spec-mandated space bytes.
  out.fill(
    STUDIO_VRM_EXPORT_JSON_PAD_BYTE,
    layout.jsonContentOffset,
    layout.jsonContentOffset + layout.jsonPaddedByteLength,
  );
  out.set(jsonBytes, layout.jsonContentOffset);

  if (binary && layout.binChunkOffset !== null && layout.binContentOffset !== null) {
    view.setUint32(layout.binChunkOffset, layout.binPaddedByteLength, true);
    view.setUint32(layout.binChunkOffset + 4, STUDIO_VRM_EXPORT_BIN_CHUNK_TYPE, true);
    out.fill(
      STUDIO_VRM_EXPORT_BIN_PAD_BYTE,
      layout.binContentOffset,
      layout.binContentOffset + layout.binPaddedByteLength,
    );
    out.set(binary, layout.binContentOffset);
  }
  return out;
}

/**
 * Strict re-parse of a GLB produced here. This is the round-trip guard used by tests and by the
 * export pipeline itself before a file is ever offered for download.
 */
export function readStudioVrmExportGlb(
  input: ArrayBuffer | Uint8Array,
): StudioVrmExportParsedGlb {
  if (!(input instanceof ArrayBuffer) && !(input instanceof Uint8Array)) {
    throw studioVrmExportError("invalid-snapshot");
  }
  const bytes =
    input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (
    bytes.byteLength <
    STUDIO_VRM_EXPORT_GLB_HEADER_BYTES + STUDIO_VRM_EXPORT_GLB_CHUNK_HEADER_BYTES
  ) {
    throw studioVrmExportError("glb-truncated");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== STUDIO_VRM_EXPORT_GLB_MAGIC) {
    throw studioVrmExportError("glb-magic-mismatch");
  }
  if (view.getUint32(4, true) !== STUDIO_VRM_EXPORT_GLB_VERSION) {
    throw studioVrmExportError("glb-version-unsupported");
  }
  if (view.getUint32(8, true) !== bytes.byteLength) {
    throw studioVrmExportError("glb-length-mismatch");
  }

  let offset = STUDIO_VRM_EXPORT_GLB_HEADER_BYTES;
  let index = 0;
  let jsonChunk: { offset: number; byteLength: number } | null = null;
  let binChunk: { offset: number; byteLength: number } | null = null;
  while (offset < bytes.byteLength) {
    if (offset % 4 !== 0) throw studioVrmExportError("glb-chunk-alignment");
    if (bytes.byteLength - offset < STUDIO_VRM_EXPORT_GLB_CHUNK_HEADER_BYTES) {
      throw studioVrmExportError("glb-chunk-bounds");
    }
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    if (chunkLength % 4 !== 0) throw studioVrmExportError("glb-chunk-alignment");
    const contentOffset = offset + STUDIO_VRM_EXPORT_GLB_CHUNK_HEADER_BYTES;
    if (chunkLength > bytes.byteLength - contentOffset) {
      throw studioVrmExportError("glb-chunk-bounds");
    }
    if (index === 0 && chunkType !== STUDIO_VRM_EXPORT_JSON_CHUNK_TYPE) {
      throw studioVrmExportError("glb-json-chunk-missing");
    }
    if (chunkType === STUDIO_VRM_EXPORT_JSON_CHUNK_TYPE) {
      if (jsonChunk) throw studioVrmExportError("glb-json-chunk-duplicate");
      jsonChunk = { offset: contentOffset, byteLength: chunkLength };
    } else if (chunkType === STUDIO_VRM_EXPORT_BIN_CHUNK_TYPE) {
      if (binChunk) throw studioVrmExportError("glb-bin-chunk-duplicate");
      binChunk = { offset: contentOffset, byteLength: chunkLength };
    } else {
      throw studioVrmExportError("glb-chunk-type-unsupported");
    }
    offset = contentOffset + chunkLength;
    index += 1;
  }
  if (!jsonChunk) throw studioVrmExportError("glb-json-chunk-missing");

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(jsonChunk.offset, jsonChunk.offset + jsonChunk.byteLength),
    );
  } catch (cause) {
    throw new StudioVrmExportError("glb-json-encoding-invalid", undefined, { cause });
  }
  let parsed: unknown;
  try {
    // The padded tail is spaces, which `JSON.parse` treats as insignificant whitespace.
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw studioVrmExportError("glb-json-parse-failed");
  }
  if (!isPlainObject(parsed)) throw studioVrmExportError("glb-json-parse-failed");

  const paddedBinByteLength = binChunk?.byteLength ?? 0;
  // `buffers[0].byteLength` is the logical size; the chunk itself carries up to 3 padding bytes.
  const declaredBinByteLength = readDeclaredBufferByteLength(parsed, paddedBinByteLength);
  const binary = binChunk
    ? Uint8Array.from(bytes.subarray(binChunk.offset, binChunk.offset + declaredBinByteLength))
    : new Uint8Array(0);
  return Object.freeze({
    json: parsed,
    jsonByteLength: jsonChunk.byteLength,
    binary,
    // Recomputing the layout from the parsed sizes proves the writer's arithmetic round-trips.
    layout: planStudioVrmExportGlbLayout(jsonChunk.byteLength, declaredBinByteLength),
  });
}

/**
 * The BIN chunk is padded, so `buffers[0].byteLength` is the authoritative unpadded size. Falling
 * back to the padded length keeps the reader usable for foreign files that omit the buffer table.
 */
function readDeclaredBufferByteLength(json: Record<string, unknown>, paddedByteLength: number): number {
  const buffers = json.buffers;
  if (!Array.isArray(buffers) || buffers.length === 0) return paddedByteLength;
  const first = buffers[0];
  if (!isPlainObject(first)) return paddedByteLength;
  const declared = first.byteLength;
  if (
    typeof declared !== "number" ||
    !Number.isSafeInteger(declared) ||
    declared < 0 ||
    declared > paddedByteLength ||
    paddedByteLength - declared > 3
  ) {
    return paddedByteLength;
  }
  return declared;
}
