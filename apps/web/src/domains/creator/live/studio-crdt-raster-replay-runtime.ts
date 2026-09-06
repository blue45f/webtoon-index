import {
  createStudioRasterCompactionCheckpoint,
  type StudioRasterCompactionCheckpoint,
  type StudioRasterCompactionOrderKey,
} from "@/shared/lib/studio-crdt-raster-compaction";
import {
  STUDIO_RASTER_MAX_ASSET_BYTES,
  STUDIO_RASTER_MAX_TILE_SIZE,
  canonicalStudioRasterJson,
  compareStudioRasterEventOrder,
  createStudioRasterOperationLog,
  studioRasterUndoneOperationIds,
  type StudioRasterAssetReference,
  type StudioRasterOperation,
  type StudioRasterOperationLog,
  type StudioRasterSurfaceSpec,
  type StudioRasterTilePatch,
} from "@/shared/lib/studio-crdt-raster-ops";

export const STUDIO_RASTER_REPLAY_DEFAULT_CONCURRENCY = 4;
export const STUDIO_RASTER_REPLAY_MAX_CONCURRENCY = 8;
export const STUDIO_RASTER_REPLAY_DEFAULT_RESIDENT_BYTES = 256 * 1_024 * 1_024;
export const STUDIO_RASTER_REPLAY_MAX_RESIDENT_BYTES = 512 * 1_024 * 1_024;

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_ID_LENGTH = 160;
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const PNG_IHDR = 0x49484452;
const PNG_IDAT = 0x49444154;
const PNG_IEND = 0x49454e44;
const PNG_ACTL = 0x6163544c;
const PNG_FCTL = 0x6663544c;
const PNG_FDAT = 0x66644154;
const PNG_PLTE = 0x504c5445;
const PNG_MAX_CHUNKS = 8_192;
const PNG_MAX_IDAT_CHUNKS = 4_096;
const PNG_KNOWN_CRITICAL_CHUNKS = new Set([PNG_IHDR, PNG_PLTE, PNG_IDAT, PNG_IEND]);

export interface StudioRasterReplayTileFilterInput {
  readonly surfaceId: string;
  readonly tileX: number;
  readonly tileY: number;
  readonly width: number;
  readonly height: number;
}

export type StudioRasterReplayTileFilter = (
  tile: StudioRasterReplayTileFilterInput
) => boolean;

export interface StudioRasterReplayRuntimeRequest {
  readonly workId: string;
  readonly log: StudioRasterOperationLog;
  /**
   * Optional trusted stable-prefix snapshot. Sparse missing tiles are transparent. Operations at
   * or before `through` are never replayed over the snapshot, while the remaining immutable tail
   * keeps the same total-order compositing semantics as a replay from the transparent origin.
   */
  readonly checkpoint?: StudioRasterCompactionCheckpoint;
  /**
   * Selects returned presentation tiles. Conditional replacements pull their complete multi-tile
   * dependency closure into the private replay set so an off-screen conflict can never partially
   * apply an on-screen operation.
   */
  readonly visibleTileFilter?: StudioRasterReplayTileFilter;
  readonly signal?: AbortSignal;
  readonly concurrency?: number;
  readonly maxResidentBytes?: number;
}

export type StudioRasterDownloadedAsset = Uint8Array | Blob;

export interface StudioRasterDecodedPng {
  readonly width: number;
  readonly height: number;
  /** Straight/unpremultiplied RGBA. */
  readonly rgba: Uint8Array | Uint8ClampedArray;
}

export type StudioRasterAssetDownloader = (
  reference: StudioRasterAssetReference,
  signal: AbortSignal
) => Promise<StudioRasterDownloadedAsset>;

export type StudioRasterPngDecoder = (
  bytes: Uint8Array,
  reference: StudioRasterAssetReference,
  signal: AbortSignal
) => Promise<StudioRasterDecodedPng>;

export type StudioRasterReplaySha256 = (
  bytes: Uint8Array,
  signal: AbortSignal
) => Promise<string>;

export interface StudioRasterReplayRuntimeDependencies {
  readonly download: StudioRasterAssetDownloader;
  readonly decode?: StudioRasterPngDecoder;
  readonly sha256?: StudioRasterReplaySha256;
}

export interface StudioRasterImmutableTileFrame {
  readonly surfaceId: string;
  readonly tileX: number;
  readonly tileY: number;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  /** SHA-256 of the complete straight RGBA tile, including transparent pixels. */
  readonly sha256: string;
  /** Returns a fresh copy; mutating it never mutates this frame. */
  readonly rgba: Uint8ClampedArray;
  /** Returns a fresh copy suitable for WebGPU queue.writeTexture or ImageData. */
  copyRgba(): Uint8ClampedArray;
}

export interface StudioRasterReplayRuntimeResult {
  readonly workId: string;
  readonly surface: StudioRasterSurfaceSpec;
  readonly checkpointId: string | null;
  readonly tiles: readonly StudioRasterImmutableTileFrame[];
  readonly appliedOperationIds: readonly string[];
  readonly undoneOperationIds: readonly string[];
  readonly conflictedOperationIds: readonly string[];
  readonly appliedPatchCount: number;
}

export class StudioRasterReplayRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    cause?: unknown
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "StudioRasterReplayRuntimeError";
  }
}

interface ReplayTileState extends StudioRasterReplayTileFilterInput {
  readonly rgba: Uint8ClampedArray;
  sha256?: string;
}

interface DecodedAssetState {
  readonly reference: StudioRasterAssetReference;
  readonly rgba: Uint8ClampedArray;
}

interface ProjectedOperation {
  readonly operation: StudioRasterOperation;
  readonly patches: readonly StudioRasterTilePatch[];
}

interface PreparedCheckpoint {
  readonly value: StudioRasterCompactionCheckpoint;
  readonly tilesByKey: ReadonlyMap<string, StudioRasterAssetReference>;
}

export interface StudioRasterBrowserDecodeEnvironment {
  readonly createImageBitmap?: typeof globalThis.createImageBitmap;
  readonly createOffscreenCanvas?: (width: number, height: number) => OffscreenCanvas;
  readonly createHtmlCanvas?: () => HTMLCanvasElement;
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new StudioRasterReplayRuntimeError(code, message, cause);
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException("래스터 CRDT 재생이 취소되었습니다.", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function positiveBoundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    fail("invalid_option", `${label} 값이 허용 범위를 벗어났습니다.`);
  }
  return resolved;
}

function assertSafeWorkId(workId: string): void {
  if (
    typeof workId !== "string" || workId.length < 1 || workId.length > MAX_ID_LENGTH ||
    !SAFE_ID_PATTERN.test(workId)
  ) {
    fail("invalid_work_id", "작업 범위 식별자가 올바르지 않습니다.");
  }
}

function tileKey(tileX: number, tileY: number): string {
  return `${tileX}:${tileY}`;
}

function tileDimensions(
  surface: StudioRasterSurfaceSpec,
  tileX: number,
  tileY: number
): StudioRasterReplayTileFilterInput {
  return {
    surfaceId: surface.surfaceId,
    tileX,
    tileY,
    width: Math.min(surface.tileSize, surface.width - tileX * surface.tileSize),
    height: Math.min(surface.tileSize, surface.height - tileY * surface.tileSize),
  };
}

function freezeSurface(surface: StudioRasterSurfaceSpec): StudioRasterSurfaceSpec {
  return Object.freeze({ ...surface });
}

function freezeStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...values]);
}

function createImmutableFrame(
  tile: ReplayTileState,
  sha256: string
): StudioRasterImmutableTileFrame {
  // The only retained buffer is captured in this closure. Both public access paths return copies,
  // so Object.freeze is meaningful even though TypedArray instances themselves are mutable.
  const owned = tile.rgba;
  const frame = {
    surfaceId: tile.surfaceId,
    tileX: tile.tileX,
    tileY: tile.tileY,
    width: tile.width,
    height: tile.height,
    byteLength: owned.byteLength,
    sha256,
    get rgba() {
      return Uint8ClampedArray.from(owned);
    },
    copyRgba() {
      return Uint8ClampedArray.from(owned);
    },
  } satisfies StudioRasterImmutableTileFrame;
  return Object.freeze(frame);
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1_00_00_00 +
    bytes[offset + 1]! * 0x1_00_00 +
    bytes[offset + 2]! * 0x1_00 +
    bytes[offset + 3]!
  );
}

function chunkType(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1_00_00_00 +
    bytes[offset + 1]! * 0x1_00_00 +
    bytes[offset + 2]! * 0x1_00 +
    bytes[offset + 3]!
  );
}

function pngChunkName(bytes: Uint8Array, offset: number): string {
  const typeBytes = bytes.subarray(offset, offset + 4);
  if (
    typeBytes.byteLength !== 4 ||
    [...typeBytes].some((byte) => !(
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a)
    )) ||
    // PNG reserves the third type-code bit for future expansion. It must remain uppercase/zero.
    ((typeBytes[2] ?? 0) & 0x20) !== 0
  ) {
    fail("invalid_png_chunk_type", "PNG 청크 타입 또는 예약 비트가 올바르지 않습니다.");
  }
  return String.fromCharCode(...typeBytes);
}

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < table.length; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[value] = crc >>> 0;
  }
  return table;
})();

function pngChunkCrc32(bytes: Uint8Array, typeOffset: number, dataLength: number): number {
  let crc = 0xffffffff;
  const end = typeOffset + 4 + dataLength;
  for (let offset = typeOffset; offset < end; offset += 1) {
    crc = PNG_CRC_TABLE[(crc ^ bytes[offset]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assertPngEnvelope(
  bytes: Uint8Array,
  reference: StudioRasterAssetReference
): void {
  if (
    bytes.byteLength < 57 ||
    !PNG_SIGNATURE.every((value, index) => bytes[index] === value)
  ) {
    fail("invalid_png", `래스터 자산 ${reference.assetId}에 PNG 서명이 없습니다.`);
  }
  let offset = PNG_SIGNATURE.byteLength;
  let chunkIndex = 0;
  let sawIdat = false;
  let idatEnded = false;
  let idatChunkCount = 0;
  let totalIdatBytes = 0;
  let sawPalette = false;
  const zlibHeader: number[] = [];
  let sawIend = false;
  while (offset < bytes.byteLength) {
    if (chunkIndex >= PNG_MAX_CHUNKS) {
      fail("png_chunk_limit", `래스터 자산 ${reference.assetId}의 PNG 청크 수가 안전 한도를 넘었습니다.`);
    }
    if (offset > bytes.byteLength - 12) {
      fail("invalid_png", `래스터 자산 ${reference.assetId}의 PNG 청크가 잘렸습니다.`);
    }
    const length = readUint32BigEndian(bytes, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const typeName = pngChunkName(bytes, typeOffset);
    const type = chunkType(bytes, typeOffset);
    const chunkEnd = offset + 12 + length;
    if (
      length > STUDIO_RASTER_MAX_ASSET_BYTES ||
      !Number.isSafeInteger(chunkEnd) || chunkEnd > bytes.byteLength
    ) {
      fail("invalid_png", `래스터 자산 ${reference.assetId}의 PNG 청크 길이가 올바르지 않습니다.`);
    }
    const expectedCrc = readUint32BigEndian(bytes, offset + 8 + length);
    if (pngChunkCrc32(bytes, offset + 4, length) !== expectedCrc) {
      fail("invalid_png_crc", `래스터 자산 ${reference.assetId}의 PNG 청크 CRC가 올바르지 않습니다.`);
    }
    if (type === PNG_ACTL || type === PNG_FCTL || type === PNG_FDAT) {
      fail("animated_png_unsupported", "래스터 CRDT 자산은 정적 PNG만 사용할 수 있습니다.");
    }
    const isCritical = (bytes[typeOffset]! & 0x20) === 0;
    if (isCritical && !PNG_KNOWN_CRITICAL_CHUNKS.has(type)) {
      fail("unsupported_png_critical_chunk", `지원하지 않는 PNG 필수 청크(${typeName})가 있습니다.`);
    }
    if (chunkIndex === 0) {
      if (type !== PNG_IHDR || length !== 13) {
        fail("invalid_png", `래스터 자산 ${reference.assetId}의 첫 청크가 IHDR가 아닙니다.`);
      }
      const width = readUint32BigEndian(bytes, offset + 8);
      const height = readUint32BigEndian(bytes, offset + 12);
      if (width !== reference.width || height !== reference.height) {
        fail("asset_dimension_mismatch", `래스터 자산 ${reference.assetId}의 PNG 크기가 참조와 다릅니다.`);
      }
      const bitDepth = bytes[offset + 16]!;
      const colorType = bytes[offset + 17]!;
      if (
        bitDepth !== 8 || colorType !== 6 || bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 || bytes[offset + 20] !== 0
      ) {
        fail(
          "unsupported_png_profile",
          `래스터 자산 ${reference.assetId}은 8-bit RGBA 비인터레이스 PNG가 아닙니다.`
        );
      }
    } else if (type === PNG_IHDR) {
      fail("invalid_png", `래스터 자산 ${reference.assetId}에 IHDR가 중복되었습니다.`);
    }
    if (type === PNG_PLTE) {
      if (
        sawPalette || sawIdat || length < 3 || length > 768 || length % 3 !== 0
      ) {
        fail("invalid_png_palette", `래스터 자산 ${reference.assetId}의 PLTE 청크가 올바르지 않습니다.`);
      }
      sawPalette = true;
    } else if (type === PNG_IDAT) {
      if (idatEnded || length === 0 || idatChunkCount >= PNG_MAX_IDAT_CHUNKS) {
        fail(
          "invalid_png_idat_sequence",
          `래스터 자산 ${reference.assetId}의 IDAT 청크가 비어 있거나 연속되지 않습니다.`
        );
      }
      sawIdat = true;
      idatChunkCount += 1;
      totalIdatBytes += length;
      for (let index = dataOffset; index < dataOffset + length && zlibHeader.length < 2; index += 1) {
        zlibHeader.push(bytes[index]!);
      }
    } else if (sawIdat) {
      idatEnded = true;
    }
    if (type === PNG_IEND) {
      if (
        length !== 0 || !sawIdat || totalIdatBytes < 2 || chunkEnd !== bytes.byteLength
      ) {
        fail("invalid_png", `래스터 자산 ${reference.assetId}의 IEND 또는 후행 바이트가 올바르지 않습니다.`);
      }
      const [compressionMethod, flags] = zlibHeader;
      if (
        compressionMethod === undefined || flags === undefined ||
        (compressionMethod & 0x0f) !== 8 || (compressionMethod >> 4) > 7 ||
        ((compressionMethod << 8) + flags) % 31 !== 0 || (flags & 0x20) !== 0
      ) {
        fail("invalid_png_zlib_header", `래스터 자산 ${reference.assetId}의 IDAT zlib 헤더가 올바르지 않습니다.`);
      }
      sawIend = true;
    }
    offset = chunkEnd;
    chunkIndex += 1;
    if (sawIend) break;
  }
  if (!sawIdat || !sawIend) {
    fail("invalid_png", `래스터 자산 ${reference.assetId}에 IDAT/IEND가 없습니다.`);
  }
}

async function defaultSha256(bytes: Uint8Array, signal: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  if (!globalThis.crypto?.subtle) {
    fail("sha256_unavailable", "이 브라우저에서는 SHA-256을 사용할 수 없습니다.");
  }
  const owned = Uint8Array.from(bytes);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", owned.buffer));
  throwIfAborted(signal);
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function checkedSha256(
  bytes: Uint8Array | Uint8ClampedArray,
  signal: AbortSignal,
  sha256: StudioRasterReplaySha256
): Promise<string> {
  const digest = await sha256(Uint8Array.from(bytes), signal);
  throwIfAborted(signal);
  if (!SHA256_PATTERN.test(digest)) {
    fail("invalid_sha256_result", "SHA-256 구현이 소문자 64자리 digest를 반환하지 않았습니다.");
  }
  return digest;
}

async function downloadedBytes(
  value: StudioRasterDownloadedAsset,
  reference: StudioRasterAssetReference,
  signal: AbortSignal
): Promise<Uint8Array> {
  throwIfAborted(signal);
  if (value instanceof Uint8Array) {
    if (value.byteLength !== reference.byteLength) {
      fail("asset_byte_length_mismatch", `래스터 자산 ${reference.assetId} 바이트 길이가 참조와 다릅니다.`);
    }
    return Uint8Array.from(value);
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    if (value.size !== reference.byteLength || (value.type !== "" && value.type !== "image/png")) {
      fail("asset_blob_mismatch", `래스터 자산 ${reference.assetId} Blob 메타데이터가 참조와 다릅니다.`);
    }
    const bytes = new Uint8Array(await value.arrayBuffer());
    throwIfAborted(signal);
    return bytes;
  }
  fail("invalid_download_result", `래스터 자산 ${reference.assetId} 다운로드 결과가 바이트나 Blob이 아닙니다.`);
}

function copyDecodedPixels(
  decoded: StudioRasterDecodedPng,
  reference: StudioRasterAssetReference
): Uint8ClampedArray {
  if (
    !decoded || typeof decoded !== "object" ||
    !Number.isSafeInteger(decoded.width) || !Number.isSafeInteger(decoded.height) ||
    decoded.width !== reference.width || decoded.height !== reference.height ||
    (!(decoded.rgba instanceof Uint8Array) && !(decoded.rgba instanceof Uint8ClampedArray))
  ) {
    fail("invalid_decoded_png", `래스터 자산 ${reference.assetId} 디코드 결과가 올바르지 않습니다.`);
  }
  const expectedLength = reference.width * reference.height * 4;
  if (decoded.rgba.byteLength !== expectedLength) {
    fail("decoded_rgba_length_mismatch", `래스터 자산 ${reference.assetId} RGBA 길이가 크기와 다릅니다.`);
  }
  return Uint8ClampedArray.from(decoded.rgba);
}

function defaultBrowserEnvironment(): StudioRasterBrowserDecodeEnvironment {
  return {
    createImageBitmap: globalThis.createImageBitmap?.bind(globalThis),
    createOffscreenCanvas: typeof OffscreenCanvas === "undefined"
      ? undefined
      : (width, height) => new OffscreenCanvas(width, height),
    createHtmlCanvas: typeof document === "undefined"
      ? undefined
      : () => document.createElement("canvas"),
  };
}

/**
 * Browser PNG decoder for the default runtime. Canvas getImageData returns straight RGBA; bitmap
 * decode explicitly disables alpha premultiplication and color conversion before the bounded
 * readback. The encoded envelope/hash is verified by the runtime before this function is called.
 */
export async function decodeStudioRasterPngInBrowser(
  bytes: Uint8Array,
  reference: StudioRasterAssetReference,
  signal: AbortSignal,
  environment: StudioRasterBrowserDecodeEnvironment = defaultBrowserEnvironment()
): Promise<StudioRasterDecodedPng> {
  throwIfAborted(signal);
  if (reference.mediaType !== "image/png") {
    fail("unsupported_media_type", "브라우저 래스터 재생기는 PNG 자산만 디코드합니다.");
  }
  const createBitmap = environment.createImageBitmap;
  if (typeof createBitmap !== "function") {
    fail("png_decoder_unavailable", "이 브라우저에서는 createImageBitmap을 사용할 수 없습니다.");
  }
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createBitmap(
      new Blob([Uint8Array.from(bytes)], { type: "image/png" }),
      {
        imageOrientation: "none",
        premultiplyAlpha: "none",
        colorSpaceConversion: "none",
      }
    );
    throwIfAborted(signal);
    if (bitmap.width !== reference.width || bitmap.height !== reference.height) {
      fail("decoded_dimension_mismatch", "디코드된 PNG 크기가 자산 참조와 다릅니다.");
    }

    const offscreen = environment.createOffscreenCanvas?.(reference.width, reference.height);
    if (offscreen) {
      const context = offscreen.getContext("2d", {
        alpha: true,
        willReadFrequently: true,
      });
      if (!context) fail("canvas_context_unavailable", "PNG readback 캔버스를 만들 수 없습니다.");
      context.clearRect(0, 0, reference.width, reference.height);
      context.drawImage(bitmap, 0, 0);
      throwIfAborted(signal);
      const data = context.getImageData(0, 0, reference.width, reference.height).data;
      throwIfAborted(signal);
      return {
        width: reference.width,
        height: reference.height,
        rgba: Uint8ClampedArray.from(data),
      };
    }

    const canvas = environment.createHtmlCanvas?.();
    if (!canvas) fail("canvas_unavailable", "PNG readback 캔버스를 만들 수 없습니다.");
    canvas.width = reference.width;
    canvas.height = reference.height;
    const context = canvas.getContext("2d", {
      alpha: true,
      willReadFrequently: true,
    });
    if (!context) fail("canvas_context_unavailable", "PNG readback 컨텍스트를 만들 수 없습니다.");
    context.clearRect(0, 0, reference.width, reference.height);
    context.drawImage(bitmap, 0, 0);
    throwIfAborted(signal);
    const data = context.getImageData(0, 0, reference.width, reference.height).data;
    throwIfAborted(signal);
    return {
      width: reference.width,
      height: reference.height,
      rgba: Uint8ClampedArray.from(data),
    };
  } catch (error) {
    if (signal.aborted) throw abortError(signal);
    if (error instanceof StudioRasterReplayRuntimeError) throw error;
    throw new StudioRasterReplayRuntimeError(
      "png_decode_failed",
      `래스터 자산 ${reference.assetId} PNG 디코드에 실패했습니다.`,
      error
    );
  } finally {
    bitmap?.close();
  }
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  controller: AbortController,
  task: (value: T, index: number, signal: AbortSignal) => Promise<R>
): Promise<R[]> {
  if (values.length === 0) return [];
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  let failed = false;
  let failure: unknown;
  const worker = async () => {
    while (!failed) {
      throwIfAborted(controller.signal);
      const index = nextIndex;
      if (index >= values.length) return;
      nextIndex += 1;
      try {
        results[index] = await task(values[index]!, index, controller.signal);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
          controller.abort(error);
        }
      }
    }
  };
  await Promise.allSettled(
    Array.from({ length: Math.min(values.length, concurrency) }, () => worker())
  );
  if (failed) throw failure;
  throwIfAborted(controller.signal);
  return results;
}

function selectedTileKeys(
  surface: StudioRasterSurfaceSpec,
  filter: StudioRasterReplayTileFilter | undefined
): Set<string> {
  const selected = new Set<string>();
  const columns = Math.ceil(surface.width / surface.tileSize);
  const rows = Math.ceil(surface.height / surface.tileSize);
  for (let tileY = 0; tileY < rows; tileY += 1) {
    for (let tileX = 0; tileX < columns; tileX += 1) {
      const tile = tileDimensions(surface, tileX, tileY);
      let include = true;
      if (filter) {
        const frozenInput = Object.freeze({ ...tile });
        try {
          include = filter(frozenInput);
        } catch (error) {
          fail("visible_filter_failed", "표시 타일 필터 실행에 실패했습니다.", error);
        }
        if (typeof include !== "boolean") {
          fail("invalid_visible_filter_result", "표시 타일 필터는 boolean을 반환해야 합니다.");
        }
      }
      if (include) selected.add(tileKey(tileX, tileY));
    }
  }
  return selected;
}

function operationOrderKey(operation: StudioRasterOperation): StudioRasterCompactionOrderKey {
  return { ...operation.order, eventId: operation.operationId };
}

function prepareCheckpoint(
  checkpoint: StudioRasterCompactionCheckpoint | undefined,
  log: StudioRasterOperationLog
): PreparedCheckpoint | null {
  if (checkpoint === undefined) return null;
  const value = createStudioRasterCompactionCheckpoint(checkpoint);
  if (canonicalStudioRasterJson(value.surface) !== canonicalStudioRasterJson(log.surface)) {
    fail("checkpoint_surface_mismatch", "checkpoint와 래스터 작업 로그의 표면이 일치하지 않습니다.");
  }

  const sealedOperationIds = new Set(value.sealedOperationIds);
  for (const operation of log.operations) {
    const beforeOrAtCheckpoint = compareStudioRasterEventOrder(
      operationOrderKey(operation),
      value.through
    ) <= 0;
    if (beforeOrAtCheckpoint !== sealedOperationIds.has(operation.operationId)) {
      fail(
        "checkpoint_operation_mismatch",
        "checkpoint 봉인 경계와 래스터 작업 로그의 operation 집합이 일치하지 않습니다."
      );
    }
  }

  const sealedUndoOperationIds = new Set(value.sealedUndoOperationIds);
  const sealedUndoAcknowledgementIds = new Set(value.sealedUndoAcknowledgementIds);
  for (const undo of log.undoOperations) {
    if (
      sealedOperationIds.has(undo.targetOperationId) &&
      !sealedUndoOperationIds.has(undo.undoOperationId)
    ) {
      fail("checkpoint_undo_horizon", "checkpoint으로 봉인된 작업을 뒤늦게 실행 취소할 수 없습니다.");
    }
  }
  for (const acknowledgement of log.undoAcknowledgements) {
    if (
      sealedUndoOperationIds.has(acknowledgement.undoOperationId) &&
      !sealedUndoAcknowledgementIds.has(acknowledgement.acknowledgementId)
    ) {
      fail("checkpoint_undo_horizon", "checkpoint으로 봉인된 실행 취소를 뒤늦게 복원할 수 없습니다.");
    }
  }

  return {
    value,
    tilesByKey: new Map(value.tiles.map((tile) => [
      tileKey(tile.tileX, tile.tileY),
      tile.asset,
    ])),
  };
}

function activeOperations(
  log: StudioRasterOperationLog,
  checkpoint: PreparedCheckpoint | null
): readonly StudioRasterOperation[] {
  const undone = studioRasterUndoneOperationIds(log);
  return log.operations.filter((operation) => (
    !undone.has(operation.operationId) &&
    (!checkpoint || compareStudioRasterEventOrder(
      operationOrderKey(operation),
      checkpoint.value.through
    ) > 0)
  ));
}

function replacementDependencyClosure(
  selected: ReadonlySet<string>,
  operations: readonly StudioRasterOperation[]
): Set<string> {
  const closure = new Set(selected);
  let changed = true;
  while (changed) {
    changed = false;
    for (const operation of operations) {
      if (!operation.patches.some((patch) => patch.effect.kind === "replace")) continue;
      const touchesClosure = operation.patches.some((patch) => closure.has(tileKey(patch.tileX, patch.tileY)));
      if (!touchesClosure) continue;
      for (const patch of operation.patches) {
        const key = tileKey(patch.tileX, patch.tileY);
        if (!closure.has(key)) {
          closure.add(key);
          changed = true;
        }
      }
    }
  }
  return closure;
}

function projectedOperations(
  operations: readonly StudioRasterOperation[],
  closure: ReadonlySet<string>
): ProjectedOperation[] {
  const projected: ProjectedOperation[] = [];
  for (const operation of operations) {
    const isConditional = operation.patches.some((patch) => patch.effect.kind === "replace");
    const patches = isConditional
      ? operation.patches.filter((patch) => closure.has(tileKey(patch.tileX, patch.tileY)))
      : operation.patches.filter((patch) => closure.has(tileKey(patch.tileX, patch.tileY)));
    if (patches.length > 0) projected.push({ operation, patches });
  }
  return projected;
}

function uniqueReplayAssets(
  operations: readonly ProjectedOperation[],
  checkpoint: PreparedCheckpoint | null,
  closure: ReadonlySet<string>
): StudioRasterAssetReference[] {
  const assets = new Map<string, StudioRasterAssetReference>();
  const add = (reference: StudioRasterAssetReference) => {
    const existing = assets.get(reference.assetId);
    if (
      existing &&
      canonicalStudioRasterJson(existing) !== canonicalStudioRasterJson(reference)
    ) {
      fail(
        "asset_identity_conflict",
        `checkpoint와 tail이 같은 자산 ID ${reference.assetId}에 서로 다른 내용을 선언합니다.`
      );
    }
    assets.set(reference.assetId, reference);
  };
  for (const [key, reference] of checkpoint?.tilesByKey ?? []) {
    if (closure.has(key)) add(reference);
  }
  for (const { patches } of operations) {
    for (const patch of patches) {
      add(patch.effect.payload);
      if (patch.selectionMask) add(patch.selectionMask);
    }
  }
  return [...assets.values()].sort((left, right) => left.assetId.localeCompare(right.assetId));
}

function assertMemoryBudget(
  surface: StudioRasterSurfaceSpec,
  closure: ReadonlySet<string>,
  assets: readonly StudioRasterAssetReference[],
  concurrency: number,
  maxResidentBytes: number
): void {
  let tileBytes = 0;
  for (const key of closure) {
    const [tileX, tileY] = key.split(":").map(Number);
    const tile = tileDimensions(surface, tileX!, tileY!);
    tileBytes += tile.width * tile.height * 4;
  }
  const decodedBytes = assets.reduce((sum, asset) => sum + asset.width * asset.height * 4, 0);
  const largestEncoded = assets
    .map((asset) => asset.byteLength)
    .sort((left, right) => right - left)
    .slice(0, concurrency)
    .reduce((sum, value) => sum + value, 0);
  const largestTile = Math.min(surface.tileSize, STUDIO_RASTER_MAX_TILE_SIZE) ** 2 * 4;
  const required = tileBytes + decodedBytes + largestEncoded + largestTile;
  if (!Number.isSafeInteger(required) || required > maxResidentBytes) {
    fail(
      "resident_memory_budget",
      "표시 타일, 디코드 자산, 동시 다운로드 및 해시 복사본이 래스터 재생 메모리 예산을 초과했습니다."
    );
  }
}

async function loadAsset(
  reference: StudioRasterAssetReference,
  dependencies: Required<Pick<StudioRasterReplayRuntimeDependencies, "download" | "decode" | "sha256">>,
  signal: AbortSignal
): Promise<DecodedAssetState> {
  throwIfAborted(signal);
  if (reference.mediaType !== "image/png") {
    fail("unsupported_media_type", `래스터 자산 ${reference.assetId}은 PNG가 아닙니다.`);
  }
  if (reference.byteLength < 1 || reference.byteLength > STUDIO_RASTER_MAX_ASSET_BYTES) {
    fail("asset_byte_budget", `래스터 자산 ${reference.assetId} 크기가 허용 범위를 벗어났습니다.`);
  }
  let downloaded: StudioRasterDownloadedAsset;
  try {
    downloaded = await dependencies.download(reference, signal);
  } catch (error) {
    if (signal.aborted) throw abortError(signal);
    fail("asset_download_failed", `래스터 자산 ${reference.assetId} 다운로드에 실패했습니다.`, error);
  }
  const bytes = await downloadedBytes(downloaded, reference, signal);
  assertPngEnvelope(bytes, reference);
  const digest = await checkedSha256(bytes, signal, dependencies.sha256);
  if (digest !== reference.sha256) {
    fail("asset_sha256_mismatch", `래스터 자산 ${reference.assetId} 내용 해시가 참조와 다릅니다.`);
  }
  let decoded: StudioRasterDecodedPng;
  try {
    decoded = await dependencies.decode(Uint8Array.from(bytes), reference, signal);
  } catch (error) {
    if (signal.aborted) throw abortError(signal);
    if (error instanceof StudioRasterReplayRuntimeError) throw error;
    fail("png_decode_failed", `래스터 자산 ${reference.assetId} 디코드에 실패했습니다.`, error);
  }
  throwIfAborted(signal);
  return {
    reference,
    rgba: copyDecodedPixels(decoded, reference),
  };
}

function roundDivide(numerator: number, denominator: number): number {
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

function effectiveSourceAlpha(sourceAlpha: number, maskAlpha: number): number {
  return roundDivide(sourceAlpha * maskAlpha, 255);
}

function sourceOverPixel(
  destination: Uint8ClampedArray,
  destinationOffset: number,
  source: Uint8ClampedArray,
  sourceOffset: number,
  maskAlpha: number
): void {
  const sourceAlpha = effectiveSourceAlpha(source[sourceOffset + 3]!, maskAlpha);
  if (sourceAlpha === 0) return;
  const destinationAlpha = destination[destinationOffset + 3]!;
  const inverseSourceAlpha = 255 - sourceAlpha;
  const alphaNumerator = sourceAlpha * 255 + destinationAlpha * inverseSourceAlpha;
  const outputAlpha = roundDivide(alphaNumerator, 255);
  for (let channel = 0; channel < 3; channel += 1) {
    const colorNumerator = (
      source[sourceOffset + channel]! * sourceAlpha * 255 +
      destination[destinationOffset + channel]! * destinationAlpha * inverseSourceAlpha
    );
    destination[destinationOffset + channel] = roundDivide(colorNumerator, alphaNumerator);
  }
  destination[destinationOffset + 3] = outputAlpha;
}

function destinationOutPixel(
  destination: Uint8ClampedArray,
  destinationOffset: number,
  source: Uint8ClampedArray,
  sourceOffset: number,
  maskAlpha: number
): void {
  const sourceAlpha = effectiveSourceAlpha(source[sourceOffset + 3]!, maskAlpha);
  if (sourceAlpha === 0) return;
  const outputAlpha = roundDivide(destination[destinationOffset + 3]! * (255 - sourceAlpha), 255);
  destination[destinationOffset + 3] = outputAlpha;
  if (outputAlpha === 0) {
    destination[destinationOffset] = 0;
    destination[destinationOffset + 1] = 0;
    destination[destinationOffset + 2] = 0;
  }
}

function maskedReplacePixel(
  destination: Uint8ClampedArray,
  destinationOffset: number,
  source: Uint8ClampedArray,
  sourceOffset: number,
  maskAlpha: number
): void {
  if (maskAlpha === 0) return;
  if (maskAlpha === 255) {
    destination[destinationOffset] = source[sourceOffset]!;
    destination[destinationOffset + 1] = source[sourceOffset + 1]!;
    destination[destinationOffset + 2] = source[sourceOffset + 2]!;
    destination[destinationOffset + 3] = source[sourceOffset + 3]!;
    return;
  }
  const sourceAlpha = source[sourceOffset + 3]!;
  const destinationAlpha = destination[destinationOffset + 3]!;
  const inverseMask = 255 - maskAlpha;
  const alphaNumerator = sourceAlpha * maskAlpha + destinationAlpha * inverseMask;
  const outputAlpha = roundDivide(alphaNumerator, 255);
  if (alphaNumerator === 0) {
    destination[destinationOffset] = 0;
    destination[destinationOffset + 1] = 0;
    destination[destinationOffset + 2] = 0;
    destination[destinationOffset + 3] = 0;
    return;
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const premultiplied = (
      source[sourceOffset + channel]! * sourceAlpha * maskAlpha +
      destination[destinationOffset + channel]! * destinationAlpha * inverseMask
    );
    destination[destinationOffset + channel] = roundDivide(premultiplied, alphaNumerator);
  }
  destination[destinationOffset + 3] = outputAlpha;
}

function applyPatch(
  tile: ReplayTileState,
  patch: StudioRasterTilePatch,
  assets: ReadonlyMap<string, DecodedAssetState>
): void {
  const payload = assets.get(patch.effect.payload.assetId);
  const mask = patch.selectionMask ? assets.get(patch.selectionMask.assetId) : undefined;
  if (!payload || (patch.selectionMask && !mask)) {
    fail("asset_cache_incomplete", "재생에 필요한 래스터 자산이 검증 캐시에 없습니다.");
  }
  const width = patch.region.width;
  const height = patch.region.height;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const sourceOffset = (row * width + column) * 4;
      const destinationOffset = (
        (patch.region.y + row) * tile.width + patch.region.x + column
      ) * 4;
      const maskAlpha = mask ? mask.rgba[sourceOffset + 3]! : 255;
      if (patch.effect.kind === "replace") {
        if (mask) {
          maskedReplacePixel(tile.rgba, destinationOffset, payload.rgba, sourceOffset, maskAlpha);
        } else {
          tile.rgba[destinationOffset] = payload.rgba[sourceOffset]!;
          tile.rgba[destinationOffset + 1] = payload.rgba[sourceOffset + 1]!;
          tile.rgba[destinationOffset + 2] = payload.rgba[sourceOffset + 2]!;
          tile.rgba[destinationOffset + 3] = payload.rgba[sourceOffset + 3]!;
        }
      } else if (patch.effect.blendMode === "source-over") {
        sourceOverPixel(tile.rgba, destinationOffset, payload.rgba, sourceOffset, maskAlpha);
      } else {
        destinationOutPixel(tile.rgba, destinationOffset, payload.rgba, sourceOffset, maskAlpha);
      }
    }
  }
  tile.sha256 = undefined;
}

/**
 * Deterministically materializes semantic raster CRDT operations into sparse immutable RGBA tile
 * frames. All relevant assets are downloaded, content-verified and decoded before replay starts;
 * therefore an abort, missing asset or malformed PNG never exposes a partially replayed result.
 */
export async function replayStudioRasterCrdtPixels(
  request: StudioRasterReplayRuntimeRequest,
  dependencies: StudioRasterReplayRuntimeDependencies
): Promise<StudioRasterReplayRuntimeResult> {
  if (!request || typeof request !== "object") fail("invalid_request", "래스터 재생 요청이 필요합니다.");
  assertSafeWorkId(request.workId);
  if (!dependencies || typeof dependencies !== "object" || typeof dependencies.download !== "function") {
    fail("invalid_dependencies", "래스터 자산 downloader가 필요합니다.");
  }
  if (dependencies.decode !== undefined && typeof dependencies.decode !== "function") {
    fail("invalid_dependencies", "PNG decoder가 함수가 아닙니다.");
  }
  if (dependencies.sha256 !== undefined && typeof dependencies.sha256 !== "function") {
    fail("invalid_dependencies", "SHA-256 구현이 함수가 아닙니다.");
  }
  if (request.visibleTileFilter !== undefined && typeof request.visibleTileFilter !== "function") {
    fail("invalid_visible_filter", "표시 타일 필터가 함수가 아닙니다.");
  }

  const log = createStudioRasterOperationLog(request.log);
  const concurrency = positiveBoundedInteger(
    request.concurrency,
    STUDIO_RASTER_REPLAY_DEFAULT_CONCURRENCY,
    STUDIO_RASTER_REPLAY_MAX_CONCURRENCY,
    "동시 자산 처리 수"
  );
  const maxResidentBytes = positiveBoundedInteger(
    request.maxResidentBytes,
    STUDIO_RASTER_REPLAY_DEFAULT_RESIDENT_BYTES,
    STUDIO_RASTER_REPLAY_MAX_RESIDENT_BYTES,
    "상주 메모리 예산"
  );
  const controller = new AbortController();
  const externalSignal = request.signal;
  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) onExternalAbort();
  else externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    throwIfAborted(controller.signal);
    const checkpoint = prepareCheckpoint(request.checkpoint, log);
    const selected = selectedTileKeys(log.surface, request.visibleTileFilter);
    const operations = activeOperations(log, checkpoint);
    const closure = replacementDependencyClosure(selected, operations);
    const projected = projectedOperations(operations, closure);
    const assetReferences = uniqueReplayAssets(projected, checkpoint, closure);
    assertMemoryBudget(log.surface, closure, assetReferences, concurrency, maxResidentBytes);

    const runtimeDependencies = {
      download: dependencies.download,
      decode: dependencies.decode ?? decodeStudioRasterPngInBrowser,
      sha256: dependencies.sha256 ?? defaultSha256,
    };
    const decodedAssets = await mapConcurrent(
      assetReferences,
      concurrency,
      controller,
      (reference, _index, signal) => loadAsset(reference, runtimeDependencies, signal)
    );
    const assetById = new Map(decodedAssets.map((asset) => [asset.reference.assetId, asset]));
    throwIfAborted(controller.signal);

    const tileByKey = new Map<string, ReplayTileState>();
    for (const key of closure) {
      const [tileX, tileY] = key.split(":").map(Number);
      const dimensions = tileDimensions(log.surface, tileX!, tileY!);
      const checkpointReference = checkpoint?.tilesByKey.get(key);
      const checkpointAsset = checkpointReference
        ? assetById.get(checkpointReference.assetId)
        : undefined;
      if (checkpointReference && !checkpointAsset) {
        fail("asset_cache_incomplete", "checkpoint 타일 자산이 검증 캐시에 없습니다.");
      }
      tileByKey.set(key, {
        ...dimensions,
        rgba: checkpointAsset
          ? Uint8ClampedArray.from(checkpointAsset.rgba)
          : new Uint8ClampedArray(dimensions.width * dimensions.height * 4),
      });
    }

    const appliedOperationIds: string[] = [];
    const conflictedOperationIds: string[] = [];
    let appliedPatchCount = 0;
    for (const { operation, patches } of projected) {
      throwIfAborted(controller.signal);
      const conditionalTiles = new Map<string, string>();
      for (const patch of patches) {
        if (patch.effect.kind === "replace") {
          conditionalTiles.set(tileKey(patch.tileX, patch.tileY), patch.effect.baseTileSha256);
        }
      }
      let conflict = false;
      for (const [key, expectedSha256] of conditionalTiles) {
        const tile = tileByKey.get(key);
        if (!tile) fail("tile_dependency_incomplete", "조건부 교체 타일 의존성이 누락되었습니다.");
        tile.sha256 ??= await checkedSha256(tile.rgba, controller.signal, runtimeDependencies.sha256);
        if (tile.sha256 !== expectedSha256) {
          conflict = true;
          break;
        }
      }
      if (conflict) {
        conflictedOperationIds.push(operation.operationId);
        continue;
      }
      for (const patch of patches) {
        const tile = tileByKey.get(tileKey(patch.tileX, patch.tileY));
        if (!tile) fail("tile_dependency_incomplete", "래스터 패치 대상 타일이 누락되었습니다.");
        applyPatch(tile, patch, assetById);
        appliedPatchCount += 1;
      }
      appliedOperationIds.push(operation.operationId);
    }

    const frames: StudioRasterImmutableTileFrame[] = [];
    const sortedSelected = [...selected].sort((left, right) => {
      const [leftX, leftY] = left.split(":").map(Number);
      const [rightX, rightY] = right.split(":").map(Number);
      return leftY! - rightY! || leftX! - rightX!;
    });
    for (const key of sortedSelected) {
      throwIfAborted(controller.signal);
      const tile = tileByKey.get(key);
      if (!tile) fail("tile_dependency_incomplete", "출력 타일이 재생 집합에 없습니다.");
      tile.sha256 ??= await checkedSha256(tile.rgba, controller.signal, runtimeDependencies.sha256);
      frames.push(createImmutableFrame(tile, tile.sha256));
    }

    return Object.freeze({
      workId: request.workId,
      surface: freezeSurface(log.surface),
      checkpointId: checkpoint?.value.checkpointId ?? null,
      tiles: Object.freeze(frames),
      appliedOperationIds: freezeStrings(appliedOperationIds),
      undoneOperationIds: freezeStrings([...studioRasterUndoneOperationIds(log)].sort()),
      conflictedOperationIds: freezeStrings(conflictedOperationIds),
      appliedPatchCount,
    });
  } catch (error) {
    if (!controller.signal.aborted) controller.abort(error);
    if (externalSignal?.aborted) throw abortError(externalSignal);
    throw error;
  } finally {
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}
