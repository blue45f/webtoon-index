/**
 * BigInt-only logical address space for tiled Studio documents.
 *
 * Existing tiled-document modules intentionally use `number` because every decoded tile is a
 * normal JavaScript typed array. That is still the right representation for a resident 1 MiB
 * tile, but it is not a safe representation for the address of that tile in a document whose
 * logical payload crosses 4 GiB (or eventually `Number.MAX_SAFE_INTEGER`).
 *
 * This module never allocates pixels and never calls OPFS. It plans fixed-size, padded tile slots
 * with exact BigInt offsets so a tile/shard OPFS adapter can hydrate a bounded Memory64 window
 * without converting the whole document address space to `number`. A logical offset above 2^53
 * must be split into a BigInt shard index plus a Number-safe offset inside that shard; it must not
 * be passed as one JavaScript File System API offset.
 */

export const STUDIO_LARGE_DOCUMENT_DEFAULT_TILE_SIZE = BigInt(512);
export const STUDIO_LARGE_DOCUMENT_DEFAULT_BYTES_PER_PIXEL = BigInt(4);
export const STUDIO_LARGE_DOCUMENT_FOUR_GIB_BYTES = BigInt(1) << BigInt(32);
export const STUDIO_LARGE_DOCUMENT_MAX_TILE_PAYLOAD_BYTES =
  BigInt(256) * BigInt(1024) * BigInt(1024);
export const STUDIO_LARGE_DOCUMENT_DEFAULT_SHARD_BYTES =
  BigInt(1) * BigInt(1024) * BigInt(1024) * BigInt(1024);

/**
 * Highest interoperable logical byte length.
 *
 * Memory64 addresses are carried as i64 values by JavaScript WebAssembly APIs and the server-side
 * persistence boundary also uses signed 64-bit integers. Keeping the exclusive end at or below
 * `2^63 - 1` avoids a later signed/unsigned reinterpretation at either boundary.
 */
export const STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES = (BigInt(1) << BigInt(63)) - BigInt(1);

export type StudioLargeDocumentInteger = bigint | number;

export interface StudioLargeDocumentAddressSpaceInput {
  readonly widthPixels: StudioLargeDocumentInteger;
  readonly heightPixels: StudioLargeDocumentInteger;
  readonly layerCount?: StudioLargeDocumentInteger;
  readonly tileSizePixels?: StudioLargeDocumentInteger;
  readonly bytesPerPixel?: StudioLargeDocumentInteger;
}

export interface StudioLargeDocumentAddressSpace {
  readonly widthPixels: bigint;
  readonly heightPixels: bigint;
  readonly layerCount: bigint;
  readonly tileSizePixels: bigint;
  readonly bytesPerPixel: bigint;
  /** Full padded bytes reserved for every tile, including document-edge tiles. */
  readonly tilePayloadBytes: bigint;
  readonly tileColumns: bigint;
  readonly tileRows: bigint;
  readonly tilesPerLayer: bigint;
  readonly layerStrideBytes: bigint;
  readonly logicalTileCount: bigint;
  readonly logicalByteLength: bigint;
}

export interface StudioLargeDocumentTileCoordinateInput {
  readonly column: StudioLargeDocumentInteger;
  readonly row: StudioLargeDocumentInteger;
  readonly layerIndex?: StudioLargeDocumentInteger;
}

export interface StudioLargeDocumentTileAddress {
  /** Existing tiledoc-compatible id. Layer identity remains a separate dimension. */
  readonly tileId: string;
  readonly column: bigint;
  readonly row: bigint;
  readonly layerIndex: bigint;
  readonly slotIndex: bigint;
  readonly originX: bigint;
  readonly originY: bigint;
  /** Actual document pixels in this tile; edge tiles can be smaller than the padded payload. */
  readonly pixelWidth: bigint;
  readonly pixelHeight: bigint;
  readonly byteOffset: bigint;
  readonly byteLength: bigint;
  readonly byteEndExclusive: bigint;
}

export interface StudioLargeDocumentPixelAddressInput {
  readonly x: StudioLargeDocumentInteger;
  readonly y: StudioLargeDocumentInteger;
  readonly layerIndex?: StudioLargeDocumentInteger;
  readonly channelOffset?: StudioLargeDocumentInteger;
}

export interface StudioLargeDocumentPixelAddress {
  readonly tile: StudioLargeDocumentTileAddress;
  readonly byteOffsetInTile: bigint;
  readonly byteOffset: bigint;
}

export interface StudioLargeDocumentWorkingSetInput {
  readonly focus: StudioLargeDocumentTileCoordinateInput;
  readonly tilesBefore?: StudioLargeDocumentInteger;
  readonly tilesAfter?: StudioLargeDocumentInteger;
  /** Hard resident-byte ceiling. It must hold at least one complete tile payload. */
  readonly maxResidentBytes: StudioLargeDocumentInteger;
}

export interface StudioLargeDocumentWorkingSetWindow {
  readonly focusSlotIndex: bigint;
  readonly firstSlotIndex: bigint;
  readonly lastSlotIndexExclusive: bigint;
  readonly tileCount: bigint;
  readonly byteOffset: bigint;
  readonly byteLength: bigint;
  readonly byteEndExclusive: bigint;
}

export interface StudioLargeDocumentShardSpan {
  readonly shardIndex: bigint;
  readonly shardByteOffset: number;
  readonly byteLength: number;
  readonly byteLengthI64: bigint;
  readonly globalByteOffset: bigint;
  readonly globalByteEndExclusive: bigint;
}

function boundedInteger(
  value: StudioLargeDocumentInteger,
  options: { readonly allowZero: boolean },
): bigint | null {
  let parsed: bigint;
  if (typeof value === "bigint") {
    parsed = value;
  } else {
    if (!Number.isSafeInteger(value)) return null;
    parsed = BigInt(value);
  }
  if (parsed < BigInt(0) || (!options.allowZero && parsed === BigInt(0))) return null;
  if (parsed > STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES) return null;
  return parsed;
}

function checkedAdd(left: bigint, right: bigint): bigint | null {
  if (left < BigInt(0) || right < BigInt(0)) return null;
  if (left > STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES - right) return null;
  return left + right;
}

function checkedMultiply(left: bigint, right: bigint): bigint | null {
  if (left < BigInt(0) || right < BigInt(0)) return null;
  if (left === BigInt(0) || right === BigInt(0)) return BigInt(0);
  if (left > STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES / right) return null;
  return left * right;
}

function ceilDividePositive(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor;
  return value % divisor === BigInt(0) ? quotient : quotient + BigInt(1);
}

function minimum(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

/**
 * Creates a padded tile-slot address space, failing closed on every invalid or overflowing input.
 *
 * Number inputs are accepted only when they are safe integers. Callers with larger values must
 * pass BigInt so precision cannot already have been lost before this boundary.
 */
export function createStudioLargeDocumentAddressSpace(
  input: StudioLargeDocumentAddressSpaceInput,
): StudioLargeDocumentAddressSpace | null {
  const widthPixels = boundedInteger(input.widthPixels, { allowZero: false });
  const heightPixels = boundedInteger(input.heightPixels, { allowZero: false });
  const layerCount = boundedInteger(input.layerCount ?? BigInt(1), { allowZero: false });
  const tileSizePixels = boundedInteger(
    input.tileSizePixels ?? STUDIO_LARGE_DOCUMENT_DEFAULT_TILE_SIZE,
    { allowZero: false },
  );
  const bytesPerPixel = boundedInteger(
    input.bytesPerPixel ?? STUDIO_LARGE_DOCUMENT_DEFAULT_BYTES_PER_PIXEL,
    { allowZero: false },
  );
  if (
    widthPixels === null
    || heightPixels === null
    || layerCount === null
    || tileSizePixels === null
    || bytesPerPixel === null
  ) {
    return null;
  }

  const tileArea = checkedMultiply(tileSizePixels, tileSizePixels);
  if (tileArea === null) return null;
  const tilePayloadBytes = checkedMultiply(tileArea, bytesPerPixel);
  if (
    tilePayloadBytes === null
    || tilePayloadBytes > STUDIO_LARGE_DOCUMENT_MAX_TILE_PAYLOAD_BYTES
  ) {
    return null;
  }

  const tileColumns = ceilDividePositive(widthPixels, tileSizePixels);
  const tileRows = ceilDividePositive(heightPixels, tileSizePixels);
  const tilesPerLayer = checkedMultiply(tileColumns, tileRows);
  if (tilesPerLayer === null) return null;
  const layerStrideBytes = checkedMultiply(tilesPerLayer, tilePayloadBytes);
  if (layerStrideBytes === null) return null;
  const logicalTileCount = checkedMultiply(tilesPerLayer, layerCount);
  if (logicalTileCount === null) return null;
  const logicalByteLength = checkedMultiply(layerStrideBytes, layerCount);
  if (logicalByteLength === null) return null;

  return Object.freeze({
    widthPixels,
    heightPixels,
    layerCount,
    tileSizePixels,
    bytesPerPixel,
    tilePayloadBytes,
    tileColumns,
    tileRows,
    tilesPerLayer,
    layerStrideBytes,
    logicalTileCount,
    logicalByteLength,
  });
}

/** Resolves one tile to its exact row-major logical slot and byte range. */
export function resolveStudioLargeDocumentTileAddress(
  space: StudioLargeDocumentAddressSpace,
  input: StudioLargeDocumentTileCoordinateInput,
): StudioLargeDocumentTileAddress | null {
  const column = boundedInteger(input.column, { allowZero: true });
  const row = boundedInteger(input.row, { allowZero: true });
  const layerIndex = boundedInteger(input.layerIndex ?? BigInt(0), { allowZero: true });
  if (column === null || row === null || layerIndex === null) return null;
  if (
    column >= space.tileColumns
    || row >= space.tileRows
    || layerIndex >= space.layerCount
  ) {
    return null;
  }

  const rowBase = checkedMultiply(row, space.tileColumns);
  if (rowBase === null) return null;
  const slotInLayer = checkedAdd(rowBase, column);
  if (slotInLayer === null || slotInLayer >= space.tilesPerLayer) return null;
  const layerBase = checkedMultiply(layerIndex, space.tilesPerLayer);
  if (layerBase === null) return null;
  const slotIndex = checkedAdd(layerBase, slotInLayer);
  if (slotIndex === null || slotIndex >= space.logicalTileCount) return null;

  const originX = checkedMultiply(column, space.tileSizePixels);
  const originY = checkedMultiply(row, space.tileSizePixels);
  const byteOffset = checkedMultiply(slotIndex, space.tilePayloadBytes);
  if (originX === null || originY === null || byteOffset === null) return null;
  const byteEndExclusive = checkedAdd(byteOffset, space.tilePayloadBytes);
  if (byteEndExclusive === null || byteEndExclusive > space.logicalByteLength) return null;

  return Object.freeze({
    tileId: `${column}:${row}`,
    column,
    row,
    layerIndex,
    slotIndex,
    originX,
    originY,
    pixelWidth: minimum(space.tileSizePixels, space.widthPixels - originX),
    pixelHeight: minimum(space.tileSizePixels, space.heightPixels - originY),
    byteOffset,
    byteLength: space.tilePayloadBytes,
    byteEndExclusive,
  });
}

/**
 * Resolves a document pixel/channel to the padded tile payload that owns it.
 *
 * This deliberately does not expose a `number` conversion. A tile/shard I/O or Memory64 adapter
 * must retain the BigInt address and only materialise the bounded working-set byte length.
 */
export function resolveStudioLargeDocumentPixelAddress(
  space: StudioLargeDocumentAddressSpace,
  input: StudioLargeDocumentPixelAddressInput,
): StudioLargeDocumentPixelAddress | null {
  const x = boundedInteger(input.x, { allowZero: true });
  const y = boundedInteger(input.y, { allowZero: true });
  const layerIndex = boundedInteger(input.layerIndex ?? BigInt(0), { allowZero: true });
  const channelOffset = boundedInteger(input.channelOffset ?? BigInt(0), { allowZero: true });
  if (x === null || y === null || layerIndex === null || channelOffset === null) return null;
  if (
    x >= space.widthPixels
    || y >= space.heightPixels
    || layerIndex >= space.layerCount
    || channelOffset >= space.bytesPerPixel
  ) {
    return null;
  }

  const tile = resolveStudioLargeDocumentTileAddress(space, {
    column: x / space.tileSizePixels,
    row: y / space.tileSizePixels,
    layerIndex,
  });
  if (!tile) return null;
  const localX = x % space.tileSizePixels;
  const localY = y % space.tileSizePixels;
  const localRowBase = checkedMultiply(localY, space.tileSizePixels);
  if (localRowBase === null) return null;
  const localPixelIndex = checkedAdd(localRowBase, localX);
  if (localPixelIndex === null) return null;
  const localPixelByteOffset = checkedMultiply(localPixelIndex, space.bytesPerPixel);
  if (localPixelByteOffset === null) return null;
  const byteOffsetInTile = checkedAdd(localPixelByteOffset, channelOffset);
  if (byteOffsetInTile === null || byteOffsetInTile >= space.tilePayloadBytes) return null;
  const byteOffset = checkedAdd(tile.byteOffset, byteOffsetInTile);
  if (byteOffset === null || byteOffset >= tile.byteEndExclusive) return null;

  return Object.freeze({ tile, byteOffsetInTile, byteOffset });
}

/**
 * Plans one bounded, contiguous row-major tile window around a focus tile.
 *
 * A window always contains the focus tile, never splits a tile payload, never exceeds
 * `maxResidentBytes`, and stays inside the logical document. The result remains entirely BigInt,
 * including documents whose offsets are not exactly representable as JavaScript numbers.
 */
export function planStudioLargeDocumentWorkingSetWindow(
  space: StudioLargeDocumentAddressSpace,
  input: StudioLargeDocumentWorkingSetInput,
): StudioLargeDocumentWorkingSetWindow | null {
  const focus = resolveStudioLargeDocumentTileAddress(space, input.focus);
  const tilesBefore = boundedInteger(input.tilesBefore ?? BigInt(0), { allowZero: true });
  const tilesAfter = boundedInteger(input.tilesAfter ?? BigInt(0), { allowZero: true });
  const maxResidentBytes = boundedInteger(input.maxResidentBytes, { allowZero: false });
  if (!focus || tilesBefore === null || tilesAfter === null || maxResidentBytes === null) {
    return null;
  }

  const maxResidentTiles = maxResidentBytes / space.tilePayloadBytes;
  if (maxResidentTiles < BigInt(1)) return null;
  const withFocus = checkedAdd(tilesBefore, BigInt(1));
  if (withFocus === null) return null;
  const requestedTiles = checkedAdd(withFocus, tilesAfter);
  if (requestedTiles === null) return null;
  const tileCount = minimum(
    minimum(requestedTiles, maxResidentTiles),
    space.logicalTileCount,
  );
  if (tileCount < BigInt(1)) return null;

  const keptBefore = minimum(tilesBefore, tileCount - BigInt(1));
  let firstSlotIndex = focus.slotIndex > keptBefore
    ? focus.slotIndex - keptBefore
    : BigInt(0);
  const candidateEnd = checkedAdd(firstSlotIndex, tileCount);
  if (candidateEnd === null) return null;
  if (candidateEnd > space.logicalTileCount) {
    firstSlotIndex = space.logicalTileCount - tileCount;
  }
  const lastSlotIndexExclusive = checkedAdd(firstSlotIndex, tileCount);
  if (
    lastSlotIndexExclusive === null
    || focus.slotIndex < firstSlotIndex
    || focus.slotIndex >= lastSlotIndexExclusive
  ) {
    return null;
  }

  const byteOffset = checkedMultiply(firstSlotIndex, space.tilePayloadBytes);
  const byteLength = checkedMultiply(tileCount, space.tilePayloadBytes);
  if (byteOffset === null || byteLength === null || byteLength > maxResidentBytes) return null;
  const byteEndExclusive = checkedAdd(byteOffset, byteLength);
  if (byteEndExclusive === null || byteEndExclusive > space.logicalByteLength) return null;

  return Object.freeze({
    focusSlotIndex: focus.slotIndex,
    firstSlotIndex,
    lastSlotIndexExclusive,
    tileCount,
    byteOffset,
    byteLength,
    byteEndExclusive,
  });
}

/**
 * Converts one BigInt logical range into a Number-safe span inside a bounded
 * OPFS shard. Repeating this call with the returned global end traverses an
 * arbitrarily large logical document without ever passing a >2^53 offset to a
 * browser File System API.
 */
export function resolveStudioLargeDocumentShardSpan(input: {
  readonly globalByteOffset: bigint;
  readonly remainingByteLength: bigint;
  readonly shardBytes?: bigint;
  readonly maxSpanBytes?: number;
}): StudioLargeDocumentShardSpan | null {
  const shardBytes =
    input.shardBytes ?? STUDIO_LARGE_DOCUMENT_DEFAULT_SHARD_BYTES;
  const maxSpanBytes = input.maxSpanBytes ?? 64 * 1024 * 1024;
  if (
    input.globalByteOffset < BigInt(0)
    || input.remainingByteLength <= BigInt(0)
    || shardBytes <= BigInt(0)
    || shardBytes > BigInt(Number.MAX_SAFE_INTEGER)
    || !Number.isSafeInteger(maxSpanBytes)
    || maxSpanBytes <= 0
  ) {
    return null;
  }
  const globalByteEndExclusive = checkedAdd(
    input.globalByteOffset,
    input.remainingByteLength,
  );
  if (globalByteEndExclusive === null) return null;

  const shardIndex = input.globalByteOffset / shardBytes;
  const shardByteOffsetI64 = input.globalByteOffset % shardBytes;
  const availableInShard = shardBytes - shardByteOffsetI64;
  const byteLengthI64 = minimum(
    minimum(input.remainingByteLength, availableInShard),
    BigInt(maxSpanBytes),
  );
  if (
    byteLengthI64 <= BigInt(0)
    || shardByteOffsetI64 > BigInt(Number.MAX_SAFE_INTEGER)
    || byteLengthI64 > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return null;
  }

  return Object.freeze({
    shardIndex,
    shardByteOffset: Number(shardByteOffsetI64),
    byteLength: Number(byteLengthI64),
    byteLengthI64,
    globalByteOffset: input.globalByteOffset,
    globalByteEndExclusive: input.globalByteOffset + byteLengthI64,
  });
}
