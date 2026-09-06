/**
 * Smallest production-capable bridge from the atomic RGBA16F tile authority to the existing
 * OffscreenCanvas render Worker.
 *
 * Each materialised tile coordinate is composited in authority layer order while still in
 * premultiplied linear light. The flattened tile is then converted to straight sRGB RGBA8 for the
 * Worker/ImageData boundary. This avoids both gamma-space cross-layer blending and a Konva
 * full-page capture.
 */

import {
  createStudioOffscreenRasterSession,
  type StudioOffscreenRasterRunResult,
} from "../studio-offscreen-raster-worker-client";
import {
  STUDIO_OFFSCREEN_RASTER_MAX_DIMENSION,
  STUDIO_OFFSCREEN_RASTER_MAX_JOB_KEY_CHARS,
  STUDIO_OFFSCREEN_RASTER_MAX_PIXELS,
  STUDIO_OFFSCREEN_RASTER_MAX_SOURCES,
  adoptStudioOffscreenPixelBuffer,
  isStudioOffscreenRasterEncodedBlobExact,
  type StudioOffscreenRasterOutput,
  type StudioOffscreenRasterPixelSource,
} from "../studio-offscreen-raster-worker-protocol";

import {
  STUDIO_ENGINE_SETTLED_TILE_RASTER_BACKEND,
  STUDIO_ENGINE_SETTLED_TILE_RASTER_COMPOSITE,
  STUDIO_ENGINE_SETTLED_TILE_RASTER_CONVERSION,
  STUDIO_ENGINE_SETTLED_TILE_RASTER_SOURCE_COLOR_SPACE,
  STUDIO_ENGINE_SETTLED_TILE_RASTER_VERSION,
  type StudioEngineSettledTileAuthorityBoundary,
  type StudioEngineSettledTileRasterReceipt,
  type StudioEngineSettledTileRasterRequest,
  type StudioEngineSettledTileRasterResult,
  type StudioEngineSettledTileRasterSessionBoundary,
  type StudioEngineSettledTileRevision,
} from "./studio-engine-settled-tile-raster-contract";
import {
  STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
  STUDIO_ENGINE_TILE_ENCODING,
  studioEngineRgba16FloatTileDigest,
  type StudioEngineTileDeviceLossReplaySource,
  type StudioEngineTileReadResult,
} from "./studio-engine-tile-authority";

const MAX_AUTHORITY_LAYERS = 4_096;
const MAX_AUTHORITY_TILES = 262_144;
const MAX_DIGEST_CHARACTERS = 512;
const HALF_FLOAT_CHANNELS = 4;
const HALF_FLOAT_BYTES = 2;
const PIXEL_DOMAIN_EPSILON = 2 / 1_024;

interface ValidatedAuthorityMetadata {
  readonly documentId: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly tileSize: number;
  readonly tileByteLength: number;
  readonly shardBytes: bigint;
  readonly tileColumns: number;
  readonly tileRows: number;
  readonly tilesPerLayer: bigint;
}

interface ValidatedSnapshot {
  readonly source: StudioEngineTileDeviceLossReplaySource;
  readonly metadata: ValidatedAuthorityMetadata;
  readonly layers: readonly Readonly<{
    layerId: string;
    layerRevision: number;
  }>[];
  readonly tiles: readonly StudioEngineTileReadResult[];
}

interface FlattenedSources {
  readonly sources: readonly StudioOffscreenRasterPixelSource[];
  readonly flattenedTileCount: number;
  readonly sourcePixelBytes: number;
}

interface TileGroup {
  readonly column: number;
  readonly row: number;
  readonly tiles: StudioEngineTileReadResult[];
}

export interface StudioEngineSettledTileRasterAdapterOptions {
  readonly authority: StudioEngineSettledTileAuthorityBoundary;
  /**
   * Required because the current authority encoding does not persist a colour-space tag. The
   * WebGPU tile provider V1 accepts only this working space; arbitrary providers must attest the
   * same invariant before using this adapter.
   */
  readonly sourceColorSpace: typeof STUDIO_ENGINE_SETTLED_TILE_RASTER_SOURCE_COLOR_SPACE;
  /**
   * Defaults to the real Vite module-Worker session. An injected session remains caller-owned
   * unless `disposeSession` is true.
   */
  readonly session?: StudioEngineSettledTileRasterSessionBoundary;
  readonly disposeSession?: boolean;
}

function rejected(
  reason: Extract<StudioEngineSettledTileRasterResult, { status: "rejected" }>["reason"],
  message: string,
  runId: number | null = null,
  workerCode?: Extract<
  StudioEngineSettledTileRasterResult,
  { status: "rejected" }
  >["workerCode"],
): StudioEngineSettledTileRasterResult {
  return Object.freeze({
    status: "rejected",
    reason,
    message,
    runId,
    ...(workerCode ? { workerCode } : {}),
  });
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}

function validDigest(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_DIGEST_CHARACTERS;
}

function validOutput(output: unknown): output is StudioOffscreenRasterOutput {
  if (!output || typeof output !== "object") return false;
  const value = output as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  if (value.kind === "pixels" || value.kind === "bitmap") {
    return keys.length === 1 && keys[0] === "kind";
  }
  if (value.kind !== "encoded") return false;
  if (
    value.mime !== "image/png"
    && value.mime !== "image/webp"
    && value.mime !== "image/jpeg"
  ) return false;
  const allowedKeys = "quality" in value
    ? ["kind", "mime", "quality"]
    : ["kind", "mime"];
  if (keys.length !== allowedKeys.length || keys.some((key, index) => key !== allowedKeys[index])) {
    return false;
  }
  if (!("quality" in value)) return true;
  return value.mime !== "image/png"
    && typeof value.quality === "number"
    && Number.isFinite(value.quality)
    && value.quality > 0
    && value.quality <= 1;
}

function validExpectedRevision(value: unknown): value is StudioEngineSettledTileRevision {
  if (!value || typeof value !== "object") return false;
  const revision = value as Record<string, unknown>;
  return Object.keys(revision).length === 5
    && revision.kind === "studio-engine-settled-tile-revision"
    && revision.version === STUDIO_ENGINE_SETTLED_TILE_RASTER_VERSION
    && validId(revision.documentId)
    && nonNegativeSafeInteger(revision.documentRevision)
    && validDigest(revision.journalHeadDigest);
}

function validateRequest(
  input: StudioEngineSettledTileRasterRequest,
): Readonly<{
  scale: number;
  background: string | null;
}> | null {
  const scale = input?.scale ?? 1;
  const background = input?.background ?? null;
  if (
    !input
    || typeof input.jobKey !== "string"
    || input.jobKey.length === 0
    || input.jobKey.length > STUDIO_OFFSCREEN_RASTER_MAX_JOB_KEY_CHARS
    || typeof scale !== "number"
    || !Number.isFinite(scale)
    || scale <= 0
    || (
      background !== null
      && (
        typeof background !== "string"
        || background.length === 0
        || background.length > 64
      )
    )
    || !validOutput(input.output)
    || (
      input.expectedRevision !== undefined
      && !validExpectedRevision(input.expectedRevision)
    )
  ) return null;
  return Object.freeze({ scale, background });
}

function validateMetadata(
  authority: StudioEngineSettledTileAuthorityBoundary,
): ValidatedAuthorityMetadata | null {
  try {
    if (
      !authority
      || !validId(authority.documentId)
      || !positiveSafeInteger(authority.documentWidth)
      || !positiveSafeInteger(authority.documentHeight)
      || !positiveSafeInteger(authority.tileSize)
      || !positiveSafeInteger(authority.tileByteLength)
      || typeof authority.shardBytes !== "bigint"
      || authority.shardBytes <= BigInt(0)
      || typeof authority.deviceLossReplaySource !== "function"
    ) return null;
    const expectedByteLength =
      authority.tileSize
      * authority.tileSize
      * HALF_FLOAT_CHANNELS
      * HALF_FLOAT_BYTES;
    if (
      !Number.isSafeInteger(expectedByteLength)
      || expectedByteLength !== authority.tileByteLength
    ) return null;
    const tileColumns = Math.ceil(authority.documentWidth / authority.tileSize);
    const tileRows = Math.ceil(authority.documentHeight / authority.tileSize);
    const tilesPerLayer = BigInt(tileColumns) * BigInt(tileRows);
    return Object.freeze({
      documentId: authority.documentId,
      documentWidth: authority.documentWidth,
      documentHeight: authority.documentHeight,
      tileSize: authority.tileSize,
      tileByteLength: authority.tileByteLength,
      shardBytes: authority.shardBytes,
      tileColumns,
      tileRows,
      tilesPerLayer,
    });
  } catch {
    return null;
  }
}

function compareTiles(left: StudioEngineTileReadResult, right: StudioEngineTileReadResult): number {
  return left.layerIndex - right.layerIndex
    || left.row - right.row
    || left.column - right.column;
}

function validateSnapshot(
  authority: StudioEngineSettledTileAuthorityBoundary,
  source: StudioEngineTileDeviceLossReplaySource,
): ValidatedSnapshot | null {
  const metadata = validateMetadata(authority);
  if (!metadata) return null;
  try {
    if (
      !source
      || source.kind !== "studio-engine-tile-device-loss-replay"
      || source.version !== STUDIO_ENGINE_TILE_AUTHORITY_VERSION
      || source.encoding !== STUDIO_ENGINE_TILE_ENCODING
      || source.documentId !== metadata.documentId
      || !nonNegativeSafeInteger(source.documentRevision)
      || !validDigest(source.journalHeadDigest)
      || !Array.isArray(source.layers)
      || source.layers.length === 0
      || source.layers.length > MAX_AUTHORITY_LAYERS
      || !Array.isArray(source.tiles)
      || source.tiles.length > MAX_AUTHORITY_TILES
    ) return null;

    const layerById = new Map<string, Readonly<{
      layerId: string;
      layerRevision: number;
      layerIndex: number;
    }>>();
    let revisionSum = 0;
    const layers = source.layers.map((layer, layerIndex) => {
      if (
        !layer
        || !validId(layer.layerId)
        || !nonNegativeSafeInteger(layer.layerRevision)
        || layerById.has(layer.layerId)
      ) throw new TypeError("invalid layer");
      const normalized = Object.freeze({
        layerId: layer.layerId,
        layerRevision: layer.layerRevision,
        layerIndex,
      });
      revisionSum += normalized.layerRevision;
      if (!Number.isSafeInteger(revisionSum)) throw new TypeError("invalid revision frontier");
      layerById.set(layer.layerId, normalized);
      return Object.freeze({
        layerId: normalized.layerId,
        layerRevision: normalized.layerRevision,
      });
    });
    if (revisionSum !== source.documentRevision) {
      throw new TypeError("invalid revision frontier");
    }

    const seen = new Set<string>();
    const tiles = source.tiles.map((tile) => {
      const layer = layerById.get(tile?.layerId);
      if (
        !tile
        || !layer
        || tile.layerIndex !== layer.layerIndex
        || !nonNegativeSafeInteger(tile.column)
        || !nonNegativeSafeInteger(tile.row)
        || tile.column >= metadata.tileColumns
        || tile.row >= metadata.tileRows
        || tile.tileId !== `${tile.column}:${tile.row}`
        || !positiveSafeInteger(tile.tileRevision)
        || tile.tileRevision > layer.layerRevision
        || tile.baseTileRevision !== Math.max(0, tile.tileRevision - 1)
        || tile.byteLength !== metadata.tileByteLength
        || !(tile.encoded instanceof ArrayBuffer)
        || tile.encoded.byteLength !== metadata.tileByteLength
        || !validDigest(tile.contentDigest)
      ) throw new TypeError("invalid tile");
      const key = `${tile.layerId}\u0000${tile.tileId}`;
      if (seen.has(key)) throw new TypeError("duplicate tile");
      seen.add(key);

      const tileInLayer =
        BigInt(tile.row) * BigInt(metadata.tileColumns) + BigInt(tile.column);
      const logicalTileIndex = BigInt(tile.layerIndex) * metadata.tilesPerLayer + tileInLayer;
      const logicalByteOffset = logicalTileIndex * BigInt(metadata.tileByteLength);
      if (
        tile.logicalTileIndex !== logicalTileIndex
        || tile.logicalByteOffset !== logicalByteOffset
        || tile.shardIndex !== logicalByteOffset / metadata.shardBytes
        || tile.shardByteOffset !== logicalByteOffset % metadata.shardBytes
        || studioEngineRgba16FloatTileDigest(tile.encoded) !== tile.contentDigest
      ) throw new TypeError("invalid tile provenance");
      return tile;
    }).sort(compareTiles);

    return Object.freeze({
      source,
      metadata,
      layers: Object.freeze(layers),
      tiles: Object.freeze(tiles),
    });
  } catch {
    return null;
  }
}

function matchesExpectedRevision(
  source: StudioEngineTileDeviceLossReplaySource,
  expected: StudioEngineSettledTileRevision | undefined,
): boolean {
  return expected === undefined
    || (
      source.documentId === expected.documentId
      && source.documentRevision === expected.documentRevision
      && source.journalHeadDigest === expected.journalHeadDigest
    );
}

/** Exact IEEE-754 binary16 decode; encoded authority words are explicitly little-endian. */
function float16ToNumber(word: number): number {
  const sign = (word & 0x8000) === 0 ? 1 : -1;
  const exponent = (word >>> 10) & 0x1f;
  const fraction = word & 0x03ff;
  if (exponent === 0) {
    return sign * fraction * 2 ** -24;
  }
  if (exponent === 0x1f) {
    return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN;
  }
  return sign * (1 + fraction / 1_024) * 2 ** (exponent - 15);
}

function normalizedPremultipliedChannel(value: number, alpha: number): number | null {
  if (
    !Number.isFinite(value)
    || value < -PIXEL_DOMAIN_EPSILON
    || value > 1 + PIXEL_DOMAIN_EPSILON
    || value > alpha + PIXEL_DOMAIN_EPSILON
  ) return null;
  return Math.min(Math.max(value, 0), alpha);
}

function normalizedAlpha(value: number): number | null {
  if (
    !Number.isFinite(value)
    || value < -PIXEL_DOMAIN_EPSILON
    || value > 1 + PIXEL_DOMAIN_EPSILON
  ) return null;
  return Math.min(Math.max(value, 0), 1);
}

function linearToSrgb(value: number): number {
  const clamped = Math.min(Math.max(value, 0), 1);
  return clamped <= 0.003_130_8
    ? clamped * 12.92
    : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

function byte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value * 255)));
}

function groupTiles(tiles: readonly StudioEngineTileReadResult[]): readonly TileGroup[] {
  const groups = new Map<string, TileGroup>();
  for (const tile of tiles) {
    const key = tile.tileId;
    let group = groups.get(key);
    if (!group) {
      group = { column: tile.column, row: tile.row, tiles: [] };
      groups.set(key, group);
    }
    group.tiles.push(tile);
  }
  return Object.freeze([...groups.values()].sort((left, right) => (
    left.row - right.row || left.column - right.column
  )));
}

function flattenGroup(
  group: TileGroup,
  metadata: ValidatedAuthorityMetadata,
  outputWidth: number,
  outputHeight: number,
): StudioOffscreenRasterPixelSource | null {
  const visibleWidth = Math.min(
    metadata.tileSize,
    metadata.documentWidth - group.column * metadata.tileSize,
  );
  const visibleHeight = Math.min(
    metadata.tileSize,
    metadata.documentHeight - group.row * metadata.tileSize,
  );
  if (visibleWidth <= 0 || visibleHeight <= 0) return null;

  const composite = new Float32Array(visibleWidth * visibleHeight * HALF_FLOAT_CHANNELS);
  for (const tile of group.tiles) {
    const view = new DataView(tile.encoded);
    for (let y = 0; y < visibleHeight; y += 1) {
      for (let x = 0; x < visibleWidth; x += 1) {
        const sourcePixel = (y * metadata.tileSize + x) * HALF_FLOAT_CHANNELS;
        const destinationPixel = (y * visibleWidth + x) * HALF_FLOAT_CHANNELS;
        const alpha = normalizedAlpha(float16ToNumber(
          view.getUint16(
            (sourcePixel + 3) * HALF_FLOAT_BYTES,
            true,
          ),
        ));
        if (alpha === null) return null;
        const red = normalizedPremultipliedChannel(
          float16ToNumber(view.getUint16(sourcePixel * HALF_FLOAT_BYTES, true)),
          alpha,
        );
        const green = normalizedPremultipliedChannel(
          float16ToNumber(view.getUint16((sourcePixel + 1) * HALF_FLOAT_BYTES, true)),
          alpha,
        );
        const blue = normalizedPremultipliedChannel(
          float16ToNumber(view.getUint16((sourcePixel + 2) * HALF_FLOAT_BYTES, true)),
          alpha,
        );
        if (red === null || green === null || blue === null) return null;

        const inverseSourceAlpha = 1 - alpha;
        composite[destinationPixel] =
          red + composite[destinationPixel]! * inverseSourceAlpha;
        composite[destinationPixel + 1] =
          green + composite[destinationPixel + 1]! * inverseSourceAlpha;
        composite[destinationPixel + 2] =
          blue + composite[destinationPixel + 2]! * inverseSourceAlpha;
        composite[destinationPixel + 3] =
          alpha + composite[destinationPixel + 3]! * inverseSourceAlpha;
      }
    }
  }

  const pixels = new Uint8ClampedArray(visibleWidth * visibleHeight * HALF_FLOAT_CHANNELS);
  for (let pixel = 0; pixel < visibleWidth * visibleHeight; pixel += 1) {
    const offset = pixel * HALF_FLOAT_CHANNELS;
    const alpha = Math.min(Math.max(composite[offset + 3]!, 0), 1);
    if (alpha > 0) {
      pixels[offset] = byte(linearToSrgb(composite[offset]! / alpha));
      pixels[offset + 1] = byte(linearToSrgb(composite[offset + 1]! / alpha));
      pixels[offset + 2] = byte(linearToSrgb(composite[offset + 2]! / alpha));
    }
    pixels[offset + 3] = byte(alpha);
  }

  const scaleX = outputWidth / metadata.documentWidth;
  const scaleY = outputHeight / metadata.documentHeight;
  return Object.freeze({
    kind: "pixels",
    width: visibleWidth,
    height: visibleHeight,
    pixels: adoptStudioOffscreenPixelBuffer(pixels),
    placement: Object.freeze({
      dx: group.column * metadata.tileSize * scaleX,
      dy: group.row * metadata.tileSize * scaleY,
      dw: visibleWidth * scaleX,
      dh: visibleHeight * scaleY,
      opacity: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
    }),
  });
}

function transparentSentinel(
  outputWidth: number,
  outputHeight: number,
): StudioOffscreenRasterPixelSource {
  return Object.freeze({
    kind: "pixels",
    width: 1,
    height: 1,
    pixels: adoptStudioOffscreenPixelBuffer(new Uint8ClampedArray(4)),
    placement: Object.freeze({
      dx: 0,
      dy: 0,
      dw: outputWidth,
      dh: outputHeight,
      opacity: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
    }),
  });
}

function flattenSources(
  snapshot: ValidatedSnapshot,
  outputWidth: number,
  outputHeight: number,
): FlattenedSources | "invalid-pixels" | "source-budget" {
  const groups = groupTiles(snapshot.tiles);
  if (groups.length > STUDIO_OFFSCREEN_RASTER_MAX_SOURCES) return "source-budget";
  const sources: StudioOffscreenRasterPixelSource[] = [];
  let sourcePixelBytes = 0;
  for (const group of groups) {
    const source = flattenGroup(group, snapshot.metadata, outputWidth, outputHeight);
    if (!source) return "invalid-pixels";
    sourcePixelBytes += source.pixels.byteLength;
    if (
      !Number.isSafeInteger(sourcePixelBytes)
      || sourcePixelBytes > STUDIO_OFFSCREEN_RASTER_MAX_PIXELS * HALF_FLOAT_CHANNELS
    ) return "source-budget";
    sources.push(source);
  }
  const flattenedTileCount = sources.length;
  if (sources.length === 0) {
    const sentinel = transparentSentinel(outputWidth, outputHeight);
    sources.push(sentinel);
    sourcePixelBytes = sentinel.pixels.byteLength;
  }
  return Object.freeze({
    sources: Object.freeze(sources),
    flattenedTileCount,
    sourcePixelBytes,
  });
}

function outputDimensions(
  metadata: ValidatedAuthorityMetadata,
  scale: number,
): Readonly<{ width: number; height: number }> | null {
  const width = Math.round(metadata.documentWidth * scale);
  const height = Math.round(metadata.documentHeight * scale);
  const pixelCount = width * height;
  if (
    !positiveSafeInteger(width)
    || !positiveSafeInteger(height)
    || width > STUDIO_OFFSCREEN_RASTER_MAX_DIMENSION
    || height > STUDIO_OFFSCREEN_RASTER_MAX_DIMENSION
    || !Number.isSafeInteger(pixelCount)
    || pixelCount > STUDIO_OFFSCREEN_RASTER_MAX_PIXELS
  ) return null;
  return Object.freeze({ width, height });
}

function validWorkerSuccess(
  result: Extract<StudioOffscreenRasterRunResult, { ok: true }>,
  output: StudioOffscreenRasterOutput,
  width: number,
  height: number,
): boolean {
  if (
    !positiveSafeInteger(result.runId)
    || result.width !== width
    || result.height !== height
    || result.payload.kind !== output.kind
  ) return false;
  const payload = result.payload;
  if (payload.kind === "pixels") {
    return payload.pixels instanceof ArrayBuffer
      && payload.pixels.byteLength === width * height * HALF_FLOAT_CHANNELS;
  }
  if (payload.kind === "bitmap") {
    return typeof payload.bitmap === "object" && payload.bitmap !== null;
  }
  return output.kind === "encoded"
    && payload.mime === output.mime
    && payload.blob instanceof Blob
    && payload.blob.size > 0;
}

function receipt(
  snapshot: ValidatedSnapshot,
  dimensions: Readonly<{ width: number; height: number }>,
  flattened: FlattenedSources,
  output: StudioOffscreenRasterOutput,
  runId: number,
): StudioEngineSettledTileRasterReceipt {
  return Object.freeze({
    kind: "studio-engine-settled-tile-raster-receipt",
    version: STUDIO_ENGINE_SETTLED_TILE_RASTER_VERSION,
    backend: STUDIO_ENGINE_SETTLED_TILE_RASTER_BACKEND,
    conversion: STUDIO_ENGINE_SETTLED_TILE_RASTER_CONVERSION,
    composite: STUDIO_ENGINE_SETTLED_TILE_RASTER_COMPOSITE,
    sourceColorSpace: STUDIO_ENGINE_SETTLED_TILE_RASTER_SOURCE_COLOR_SPACE,
    documentId: snapshot.source.documentId,
    documentRevision: snapshot.source.documentRevision,
    journalHeadDigest: snapshot.source.journalHeadDigest,
    nativeWidth: snapshot.metadata.documentWidth,
    nativeHeight: snapshot.metadata.documentHeight,
    outputWidth: dimensions.width,
    outputHeight: dimensions.height,
    layerCount: snapshot.layers.length,
    authorityTileCount: snapshot.tiles.length,
    flattenedTileCount: flattened.flattenedTileCount,
    workerSourceCount: flattened.sources.length,
    sourcePixelBytes: flattened.sourcePixelBytes,
    outputKind: output.kind,
    runId,
    konvaCapture: false,
  });
}

export class StudioEngineSettledTileRasterAdapter {
  private readonly authority: StudioEngineSettledTileAuthorityBoundary;
  private readonly session: StudioEngineSettledTileRasterSessionBoundary;
  private readonly disposeSession: boolean;
  private disposed = false;

  public constructor(options: StudioEngineSettledTileRasterAdapterOptions) {
    if (
      !options
      || !options.authority
      || options.sourceColorSpace !== STUDIO_ENGINE_SETTLED_TILE_RASTER_SOURCE_COLOR_SPACE
      || (
        options.session !== undefined
        && (
          typeof options.session.run !== "function"
          || typeof options.session.dispose !== "function"
        )
      )
    ) {
      throw new TypeError("Studio engine settled tile raster adapter options are invalid.");
    }
    this.authority = options.authority;
    this.session = options.session ?? createStudioOffscreenRasterSession();
    this.disposeSession = options.session === undefined
      ? true
      : options.disposeSession ?? false;
  }

  public async render(
    input: StudioEngineSettledTileRasterRequest,
  ): Promise<StudioEngineSettledTileRasterResult> {
    if (this.disposed) {
      return rejected("disposed", "The settled tile raster adapter is disposed.");
    }
    if (input?.signal?.aborted) {
      return rejected("aborted", "The settled tile raster request was aborted.");
    }
    const request = validateRequest(input);
    if (!request) {
      return rejected("invalid-request", "The settled tile raster request is invalid.");
    }

    let source: StudioEngineTileDeviceLossReplaySource;
    try {
      source = this.authority.deviceLossReplaySource();
    } catch {
      return rejected(
        "authority-unavailable",
        "The tile authority could not provide an atomic replay snapshot.",
      );
    }
    if (!matchesExpectedRevision(source, input.expectedRevision)) {
      return rejected(
        "stale-authority-revision",
        "The tile authority no longer matches the selected settled revision.",
      );
    }
    const snapshot = validateSnapshot(this.authority, source);
    if (!snapshot) {
      return rejected(
        "invalid-authority-snapshot",
        "The tile authority replay snapshot failed provenance validation.",
      );
    }
    const dimensions = outputDimensions(snapshot.metadata, request.scale);
    if (!dimensions) {
      return rejected(
        "source-budget",
        "The requested output exceeds the render Worker dimension or pixel budget.",
      );
    }
    const flattened = flattenSources(snapshot, dimensions.width, dimensions.height);
    if (flattened === "invalid-pixels") {
      return rejected(
        "invalid-authority-pixels",
        "The authority contains non-finite or non-premultiplied RGBA16F pixels.",
      );
    }
    if (flattened === "source-budget") {
      return rejected(
        "source-budget",
        "The authority projection exceeds the render Worker source or byte budget.",
      );
    }
    if (input.signal?.aborted) {
      return rejected("aborted", "The settled tile raster request was aborted.");
    }

    let workerResult: StudioOffscreenRasterRunResult;
    try {
      workerResult = await this.session.run(
        input.jobKey,
        {
          target: {
            width: dimensions.width,
            height: dimensions.height,
            background: request.background,
          },
          sources: flattened.sources,
          output: input.output,
        },
        { signal: input.signal },
      );
    } catch {
      return rejected(
        "worker-failed",
        "The render Worker session threw while accepting the tile projection.",
      );
    }
    if (!workerResult.ok) {
      return rejected(
        workerResult.code === "cancelled" ? "aborted" : "worker-rejected",
        workerResult.message,
        workerResult.runId,
        workerResult.code,
      );
    }
    if (
      !validWorkerSuccess(
        workerResult,
        input.output,
        dimensions.width,
        dimensions.height,
      )
    ) {
      return rejected(
        "worker-failed",
        "The render Worker returned a result that does not match the requested output.",
        workerResult.runId,
      );
    }
    if (
      input.output.kind === "encoded"
      && workerResult.payload.kind === "encoded"
      && !await isStudioOffscreenRasterEncodedBlobExact(
        workerResult.payload.blob,
        input.output.mime,
      )
    ) {
      return rejected(
        "worker-failed",
        "The render Worker substituted or mislabeled the requested encoded container.",
        workerResult.runId,
      );
    }
    const rasterReceipt = receipt(
      snapshot,
      dimensions,
      flattened,
      input.output,
      workerResult.runId,
    );
    return Object.freeze({
      status: "rendered",
      receipt: rasterReceipt,
      payload: workerResult.payload,
    });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.disposeSession) this.session.dispose();
  }
}

export function createStudioEngineSettledTileRasterAdapter(
  options: StudioEngineSettledTileRasterAdapterOptions,
): StudioEngineSettledTileRasterAdapter {
  return new StudioEngineSettledTileRasterAdapter(options);
}
