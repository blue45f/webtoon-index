/**
 * Deterministic binary persistence for the sparse wet-ink field.
 *
 * The snapshot preserves water, mobile pigment, wetness, fixed stain and paper
 * absorbency as first-class document state. Reopening a document therefore
 * resumes the same physical simulation instead of flattening the material to
 * RGBA. The codec is renderer/DOM independent and suitable for IndexedDB,
 * OPFS, CRDT blob storage or a Worker boundary.
 */

import { sha256HexPortable } from "../studio-sha256";

import {
  createStudioWetInkField,
  studioWetInkFieldDigest,
  type StudioWetInkBounds,
  type StudioWetInkField,
  type StudioWetInkFieldConfig,
  type StudioWetInkTile,
} from "./studio-wet-ink-field";

export const STUDIO_WET_INK_SNAPSHOT_KIND =
  "toonspectrum.wet-ink-snapshot" as const;
export const STUDIO_WET_INK_SNAPSHOT_VERSION = 1 as const;

export const STUDIO_WET_INK_SNAPSHOT_LIMITS = Object.freeze({
  headerBytes: 20,
  tileHeaderBytes: 28,
  maxMetadataBytes: 64 * 1_024,
  maxSnapshotBytes: 512 * 1_024 * 1_024,
  maxTiles: 16_384,
  fieldChannels: 5,
} as const);

const MAGIC = Object.freeze([0x54, 0x53, 0x57, 0x49] as const); // TSWI
const LITTLE_ENDIAN = true;
const MAX_FIELD_VALUE = 4;

export interface StudioWetInkSnapshotReceipt {
  readonly kind: "studio-wet-ink-snapshot-receipt";
  readonly snapshotKind: typeof STUDIO_WET_INK_SNAPSHOT_KIND;
  readonly snapshotVersion: typeof STUDIO_WET_INK_SNAPSHOT_VERSION;
  readonly fieldVersion: 1;
  readonly byteLength: number;
  readonly metadataBytes: number;
  readonly tileCount: number;
  readonly allocatedCells: number;
  readonly simulationStep: number;
  readonly fieldDigest: string;
  readonly snapshotSha256: `sha256:${string}`;
  readonly continuation: "physical-state-preserved";
}

export interface StudioWetInkEncodedSnapshot {
  readonly bytes: Uint8Array;
  readonly receipt: StudioWetInkSnapshotReceipt;
}

export type StudioWetInkSnapshotFailureCode =
  | "invalid-field"
  | "invalid-snapshot"
  | "unsupported-version"
  | "budget-exceeded"
  | "integrity-mismatch";

export type StudioWetInkSnapshotResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      code: StudioWetInkSnapshotFailureCode;
      reason: string;
    }>;

export interface StudioWetInkSnapshotOptions {
  readonly maxBytes?: number;
}

interface SnapshotMetadata {
  readonly kind: typeof STUDIO_WET_INK_SNAPSHOT_KIND;
  readonly snapshotVersion: typeof STUDIO_WET_INK_SNAPSHOT_VERSION;
  readonly fieldVersion: 1;
  readonly config: StudioWetInkFieldConfig;
  readonly allocatedCells: number;
  readonly simulationStep: number;
  readonly fieldRevision: number;
  readonly activeBounds: StudioWetInkBounds | null;
  readonly dirtyBounds: StudioWetInkBounds | null;
  readonly fieldDigest: string;
}

function failure<T>(
  code: StudioWetInkSnapshotFailureCode,
  reason: string,
): StudioWetInkSnapshotResult<T> {
  return Object.freeze({ ok: false, code, reason });
}

function safeInteger(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length
    && expected.every((key) => Object.hasOwn(value, key));
}

function normalizedMaxBytes(options: StudioWetInkSnapshotOptions): number | null {
  const value =
    options.maxBytes ?? STUDIO_WET_INK_SNAPSHOT_LIMITS.maxSnapshotBytes;
  return safeInteger(
    value,
    STUDIO_WET_INK_SNAPSHOT_LIMITS.headerBytes + 1,
    STUDIO_WET_INK_SNAPSHOT_LIMITS.maxSnapshotBytes,
  )
    ? value
    : null;
}

function validBounds(
  value: unknown,
  width: number,
  height: number,
): value is StudioWetInkBounds | null {
  if (value === null) return true;
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, ["x", "y", "width", "height"])
    || !safeInteger(value.x, 0, width - 1)
    || !safeInteger(value.y, 0, height - 1)
    || !safeInteger(value.width, 1, width)
    || !safeInteger(value.height, 1, height)
  ) {
    return false;
  }
  return value.x + value.width <= width && value.y + value.height <= height;
}

function sortedTiles(field: StudioWetInkField): readonly StudioWetInkTile[] {
  return [...field.tiles.values()].sort(
    (left, right) =>
      left.tileY - right.tileY || left.tileX - right.tileX,
  );
}

function expectedTileShape(
  config: StudioWetInkFieldConfig,
  tileX: number,
  tileY: number,
): Readonly<{
  originX: number;
  originY: number;
  width: number;
  height: number;
}> | null {
  if (!safeInteger(tileX, 0, Math.ceil(config.width / config.tileSize) - 1)) {
    return null;
  }
  if (!safeInteger(tileY, 0, Math.ceil(config.height / config.tileSize) - 1)) {
    return null;
  }
  const originX = tileX * config.tileSize;
  const originY = tileY * config.tileSize;
  return Object.freeze({
    originX,
    originY,
    width: Math.min(config.tileSize, config.width - originX),
    height: Math.min(config.tileSize, config.height - originY),
  });
}

function validFloatArray(
  value: unknown,
  length: number,
  maximum: number,
): value is Float32Array {
  if (!(value instanceof Float32Array) || value.length !== length) return false;
  for (const item of value) {
    if (!Number.isFinite(item) || item < 0 || item > maximum) return false;
  }
  return true;
}

function validateTile(
  config: StudioWetInkFieldConfig,
  tile: StudioWetInkTile,
): number | null {
  const expected = expectedTileShape(config, tile.tileX, tile.tileY);
  if (
    !expected
    || tile.originX !== expected.originX
    || tile.originY !== expected.originY
    || tile.width !== expected.width
    || tile.height !== expected.height
    || !safeInteger(tile.revision, 0, 0xffff_ffff)
  ) {
    return null;
  }
  const cellCount = expected.width * expected.height;
  return (
    validFloatArray(tile.water, cellCount, MAX_FIELD_VALUE)
    && validFloatArray(tile.pigment, cellCount, MAX_FIELD_VALUE)
    && validFloatArray(tile.wetness, cellCount, 1)
    && validFloatArray(tile.stain, cellCount, MAX_FIELD_VALUE)
    && validFloatArray(tile.paper, cellCount, 1)
  )
    ? cellCount
    : null;
}

function canonicalMetadata(
  field: StudioWetInkField,
  config: StudioWetInkFieldConfig,
): SnapshotMetadata {
  return {
    kind: STUDIO_WET_INK_SNAPSHOT_KIND,
    snapshotVersion: STUDIO_WET_INK_SNAPSHOT_VERSION,
    fieldVersion: 1,
    config,
    allocatedCells: field.allocatedCells,
    simulationStep: field.simulationStep,
    fieldRevision: field.revision,
    activeBounds: field.activeBounds ? { ...field.activeBounds } : null,
    dirtyBounds: field.dirtyBounds ? { ...field.dirtyBounds } : null,
    fieldDigest: studioWetInkFieldDigest(field),
  };
}

function createReceipt(
  bytes: Uint8Array,
  metadataBytes: number,
  metadata: SnapshotMetadata,
  tileCount: number,
): StudioWetInkSnapshotReceipt {
  return Object.freeze({
    kind: "studio-wet-ink-snapshot-receipt",
    snapshotKind: STUDIO_WET_INK_SNAPSHOT_KIND,
    snapshotVersion: STUDIO_WET_INK_SNAPSHOT_VERSION,
    fieldVersion: 1,
    byteLength: bytes.byteLength,
    metadataBytes,
    tileCount,
    allocatedCells: metadata.allocatedCells,
    simulationStep: metadata.simulationStep,
    fieldDigest: metadata.fieldDigest,
    snapshotSha256: `sha256:${sha256HexPortable(bytes)}`,
    continuation: "physical-state-preserved",
  });
}

/**
 * Encodes a self-contained, deterministic snapshot. The returned bytes do not
 * alias any live field array.
 */
export function encodeStudioWetInkFieldSnapshot(
  field: StudioWetInkField,
  options: StudioWetInkSnapshotOptions = {},
): StudioWetInkSnapshotResult<StudioWetInkEncodedSnapshot> {
  const maxBytes = normalizedMaxBytes(options);
  if (!maxBytes) {
    return failure("budget-exceeded", "Wet-ink snapshot byte budget is invalid.");
  }
  if (
    !field
    || field.kind !== "toonspectrum.wet-ink-field"
    || field.version !== 1
    || !safeInteger(field.simulationStep, 0, field.config.maxSimulationSteps)
    || !safeInteger(field.revision, 0, Number.MAX_SAFE_INTEGER)
    || !validBounds(field.activeBounds, field.config.width, field.config.height)
    || !validBounds(field.dirtyBounds, field.config.width, field.config.height)
  ) {
    return failure("invalid-field", "Wet-ink field state is invalid.");
  }

  const normalized = createStudioWetInkField(field.config);
  if (!normalized.ok) {
    return failure("invalid-field", "Wet-ink field configuration is invalid.");
  }
  const config = normalized.value.config;
  const tiles = sortedTiles(field);
  if (
    tiles.length > config.maxTiles
    || tiles.length > STUDIO_WET_INK_SNAPSHOT_LIMITS.maxTiles
  ) {
    return failure("budget-exceeded", "Wet-ink snapshot tile budget exceeded.");
  }

  const seen = new Set<string>();
  let allocatedCells = 0;
  let tilePayloadBytes = 0;
  for (const tile of tiles) {
    const key = `${tile.tileX}:${tile.tileY}`;
    const cellCount = validateTile(config, tile);
    if (seen.has(key) || cellCount === null) {
      return failure("invalid-field", "Wet-ink field contains an invalid tile.");
    }
    seen.add(key);
    allocatedCells += cellCount;
    tilePayloadBytes +=
      STUDIO_WET_INK_SNAPSHOT_LIMITS.tileHeaderBytes
      + cellCount * STUDIO_WET_INK_SNAPSHOT_LIMITS.fieldChannels * 4;
  }
  if (
    allocatedCells !== field.allocatedCells
    || allocatedCells > config.maxCells
  ) {
    return failure("invalid-field", "Wet-ink allocated-cell accounting is invalid.");
  }

  const metadata = canonicalMetadata(field, config);
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
  if (metadataBytes.byteLength > STUDIO_WET_INK_SNAPSHOT_LIMITS.maxMetadataBytes) {
    return failure("budget-exceeded", "Wet-ink snapshot metadata budget exceeded.");
  }
  const byteLength =
    STUDIO_WET_INK_SNAPSHOT_LIMITS.headerBytes
    + metadataBytes.byteLength
    + tilePayloadBytes;
  if (!Number.isSafeInteger(byteLength) || byteLength > maxBytes) {
    return failure("budget-exceeded", "Wet-ink snapshot byte budget exceeded.");
  }

  const bytes = new Uint8Array(byteLength);
  bytes.set(MAGIC, 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, STUDIO_WET_INK_SNAPSHOT_VERSION, LITTLE_ENDIAN);
  view.setUint16(
    6,
    STUDIO_WET_INK_SNAPSHOT_LIMITS.headerBytes,
    LITTLE_ENDIAN,
  );
  view.setUint32(8, metadataBytes.byteLength, LITTLE_ENDIAN);
  view.setUint32(12, tiles.length, LITTLE_ENDIAN);
  view.setUint32(16, byteLength, LITTLE_ENDIAN);
  bytes.set(metadataBytes, STUDIO_WET_INK_SNAPSHOT_LIMITS.headerBytes);

  let offset =
    STUDIO_WET_INK_SNAPSHOT_LIMITS.headerBytes + metadataBytes.byteLength;
  for (const tile of tiles) {
    const cellCount = tile.width * tile.height;
    view.setInt32(offset, tile.tileX, LITTLE_ENDIAN);
    view.setInt32(offset + 4, tile.tileY, LITTLE_ENDIAN);
    view.setUint32(offset + 8, tile.originX, LITTLE_ENDIAN);
    view.setUint32(offset + 12, tile.originY, LITTLE_ENDIAN);
    view.setUint16(offset + 16, tile.width, LITTLE_ENDIAN);
    view.setUint16(offset + 18, tile.height, LITTLE_ENDIAN);
    view.setUint32(offset + 20, tile.revision, LITTLE_ENDIAN);
    view.setUint32(offset + 24, cellCount, LITTLE_ENDIAN);
    offset += STUDIO_WET_INK_SNAPSHOT_LIMITS.tileHeaderBytes;
    for (const channel of [
      tile.water,
      tile.pigment,
      tile.wetness,
      tile.stain,
      tile.paper,
    ]) {
      for (const value of channel) {
        view.setFloat32(offset, value, LITTLE_ENDIAN);
        offset += 4;
      }
    }
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      bytes,
      receipt: createReceipt(bytes, metadataBytes.byteLength, metadata, tiles.length),
    }),
  });
}

function parseMetadata(
  bytes: Uint8Array,
  configFactory: (config: StudioWetInkFieldConfig) => ReturnType<
    typeof createStudioWetInkField
  >,
): Readonly<{
  metadata: SnapshotMetadata;
  emptyField: StudioWetInkField;
}> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (
    !isPlainRecord(parsed)
    || !hasExactKeys(parsed, [
      "kind",
      "snapshotVersion",
      "fieldVersion",
      "config",
      "allocatedCells",
      "simulationStep",
      "fieldRevision",
      "activeBounds",
      "dirtyBounds",
      "fieldDigest",
    ])
    || parsed.kind !== STUDIO_WET_INK_SNAPSHOT_KIND
    || parsed.snapshotVersion !== STUDIO_WET_INK_SNAPSHOT_VERSION
    || parsed.fieldVersion !== 1
    || !isPlainRecord(parsed.config)
    || typeof parsed.fieldDigest !== "string"
    || !/^wet-ink-v1:[0-9a-f]{8}$/u.test(parsed.fieldDigest)
  ) {
    return null;
  }
  const candidate = configFactory(parsed.config as unknown as StudioWetInkFieldConfig);
  if (!candidate.ok) return null;
  const { config } = candidate.value;
  if (
    !safeInteger(parsed.allocatedCells, 0, config.maxCells)
    || !safeInteger(parsed.simulationStep, 0, config.maxSimulationSteps)
    || !safeInteger(parsed.fieldRevision, 0, Number.MAX_SAFE_INTEGER)
    || !validBounds(parsed.activeBounds, config.width, config.height)
    || !validBounds(parsed.dirtyBounds, config.width, config.height)
  ) {
    return null;
  }
  return Object.freeze({
    metadata: parsed as unknown as SnapshotMetadata,
    emptyField: candidate.value,
  });
}

function readFloatChannel(
  view: DataView,
  offset: number,
  count: number,
  maximum: number,
): Readonly<{ values: Float32Array; offset: number }> | null {
  const byteLength = count * 4;
  if (offset + byteLength > view.byteLength) return null;
  const values = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const value = view.getFloat32(offset, LITTLE_ENDIAN);
    if (!Number.isFinite(value) || value < 0 || value > maximum) return null;
    values[index] = value;
    offset += 4;
  }
  return Object.freeze({ values, offset });
}

/**
 * Decodes a snapshot atomically. No partially hydrated field escapes when the
 * header, metadata, tile topology, physical values or final digest is invalid.
 */
export function decodeStudioWetInkFieldSnapshot(
  input: Uint8Array,
  options: StudioWetInkSnapshotOptions = {},
): StudioWetInkSnapshotResult<Readonly<{
  field: StudioWetInkField;
  receipt: StudioWetInkSnapshotReceipt;
}>> {
  const maxBytes = normalizedMaxBytes(options);
  if (!maxBytes) {
    return failure("budget-exceeded", "Wet-ink snapshot byte budget is invalid.");
  }
  if (
    !(input instanceof Uint8Array)
    || input.byteLength < STUDIO_WET_INK_SNAPSHOT_LIMITS.headerBytes
    || input.byteLength > maxBytes
  ) {
    return failure("budget-exceeded", "Wet-ink snapshot byte budget exceeded.");
  }
  const bytes = input.slice();
  if (MAGIC.some((value, index) => bytes[index] !== value)) {
    return failure("invalid-snapshot", "Wet-ink snapshot magic is invalid.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, LITTLE_ENDIAN);
  if (version !== STUDIO_WET_INK_SNAPSHOT_VERSION) {
    return failure("unsupported-version", "Wet-ink snapshot version is unsupported.");
  }
  const headerBytes = view.getUint16(6, LITTLE_ENDIAN);
  const metadataLength = view.getUint32(8, LITTLE_ENDIAN);
  const tileCount = view.getUint32(12, LITTLE_ENDIAN);
  const declaredLength = view.getUint32(16, LITTLE_ENDIAN);
  if (
    headerBytes !== STUDIO_WET_INK_SNAPSHOT_LIMITS.headerBytes
    || metadataLength > STUDIO_WET_INK_SNAPSHOT_LIMITS.maxMetadataBytes
    || tileCount > STUDIO_WET_INK_SNAPSHOT_LIMITS.maxTiles
    || declaredLength !== bytes.byteLength
    || headerBytes + metadataLength > bytes.byteLength
  ) {
    return failure("invalid-snapshot", "Wet-ink snapshot header is invalid.");
  }

  const parsed = parseMetadata(
    bytes.subarray(headerBytes, headerBytes + metadataLength),
    createStudioWetInkField,
  );
  if (!parsed) {
    return failure("invalid-snapshot", "Wet-ink snapshot metadata is invalid.");
  }
  const { metadata, emptyField: field } = parsed;
  if (tileCount > field.config.maxTiles) {
    return failure("budget-exceeded", "Wet-ink snapshot tile budget exceeded.");
  }

  let offset = headerBytes + metadataLength;
  let allocatedCells = 0;
  const keys = new Set<string>();
  for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
    if (
      offset + STUDIO_WET_INK_SNAPSHOT_LIMITS.tileHeaderBytes
      > bytes.byteLength
    ) {
      return failure("invalid-snapshot", "Wet-ink tile header is truncated.");
    }
    const tileX = view.getInt32(offset, LITTLE_ENDIAN);
    const tileY = view.getInt32(offset + 4, LITTLE_ENDIAN);
    const originX = view.getUint32(offset + 8, LITTLE_ENDIAN);
    const originY = view.getUint32(offset + 12, LITTLE_ENDIAN);
    const width = view.getUint16(offset + 16, LITTLE_ENDIAN);
    const height = view.getUint16(offset + 18, LITTLE_ENDIAN);
    const revision = view.getUint32(offset + 20, LITTLE_ENDIAN);
    const cellCount = view.getUint32(offset + 24, LITTLE_ENDIAN);
    offset += STUDIO_WET_INK_SNAPSHOT_LIMITS.tileHeaderBytes;

    const expected = expectedTileShape(field.config, tileX, tileY);
    const key = `${tileX}:${tileY}`;
    if (
      !expected
      || keys.has(key)
      || originX !== expected.originX
      || originY !== expected.originY
      || width !== expected.width
      || height !== expected.height
      || cellCount !== width * height
      || allocatedCells + cellCount > field.config.maxCells
    ) {
      return failure("invalid-snapshot", "Wet-ink tile topology is invalid.");
    }
    keys.add(key);
    allocatedCells += cellCount;

    const water = readFloatChannel(view, offset, cellCount, MAX_FIELD_VALUE);
    if (!water) return failure("invalid-snapshot", "Wet-ink water channel is invalid.");
    const pigment = readFloatChannel(
      view,
      water.offset,
      cellCount,
      MAX_FIELD_VALUE,
    );
    if (!pigment) {
      return failure("invalid-snapshot", "Wet-ink pigment channel is invalid.");
    }
    const wetness = readFloatChannel(view, pigment.offset, cellCount, 1);
    if (!wetness) {
      return failure("invalid-snapshot", "Wet-ink wetness channel is invalid.");
    }
    const stain = readFloatChannel(
      view,
      wetness.offset,
      cellCount,
      MAX_FIELD_VALUE,
    );
    if (!stain) return failure("invalid-snapshot", "Wet-ink stain channel is invalid.");
    const paper = readFloatChannel(view, stain.offset, cellCount, 1);
    if (!paper) return failure("invalid-snapshot", "Wet-ink paper channel is invalid.");
    offset = paper.offset;

    field.tiles.set(key, {
      tileX,
      tileY,
      originX,
      originY,
      width,
      height,
      revision,
      water: water.values,
      pigment: pigment.values,
      wetness: wetness.values,
      stain: stain.values,
      paper: paper.values,
    });
  }
  if (
    offset !== bytes.byteLength
    || allocatedCells !== metadata.allocatedCells
  ) {
    return failure("invalid-snapshot", "Wet-ink snapshot payload length is invalid.");
  }

  field.allocatedCells = allocatedCells;
  field.simulationStep = metadata.simulationStep;
  field.revision = metadata.fieldRevision;
  field.activeBounds = metadata.activeBounds ? { ...metadata.activeBounds } : null;
  field.dirtyBounds = metadata.dirtyBounds ? { ...metadata.dirtyBounds } : null;
  if (studioWetInkFieldDigest(field) !== metadata.fieldDigest) {
    return failure("integrity-mismatch", "Wet-ink physical-state digest does not match.");
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      field,
      receipt: createReceipt(bytes, metadataLength, metadata, tileCount),
    }),
  });
}
