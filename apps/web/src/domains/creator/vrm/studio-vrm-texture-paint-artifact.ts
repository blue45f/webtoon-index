/**
 * Content-addressed persistence boundary for VRM surface-paint PNGs.
 *
 * Structured project documents persist only the canonical metadata below. Encoded PNG bytes live
 * in archive entries addressed by their SHA-256. Raw RGBA pixels, data/object URLs, and transient
 * canvas state never cross this boundary.
 */

export const STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_SCHEMA_VERSION = 1 as const;
export const STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_KIND =
  "toonspectrum/vrm-texture-paint-png" as const;
export const STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME = "image/png" as const;

export const STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_LIMITS = Object.freeze({
  maxArtifactBytes: 96_000_000,
  maxAggregateBytes: 96_000_000,
  maxWidth: 4_096,
  maxHeight: 4_096,
  maxPixels: 16_777_216,
  maxAggregatePixels: 33_554_432,
  maxBindings: 128,
  maxArtifacts: 128,
});

export interface StudioVrmTexturePaintArtifactLimits {
  readonly maxArtifactBytes: number;
  readonly maxAggregateBytes: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxPixels: number;
  readonly maxAggregatePixels: number;
  readonly maxBindings: number;
  readonly maxArtifacts: number;
}

export type StudioVrmTexturePaintArtifactHash = `sha256:${string}`;
export type StudioVrmTexturePaintArtifactSource = Blob | Uint8Array;

/**
 * Canonical project-document record. Property order is intentional and stable for JSON encoding.
 */
export interface StudioVrmTexturePaintArtifactMetadata {
  readonly schemaVersion: typeof STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_SCHEMA_VERSION;
  readonly kind: typeof STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_KIND;
  readonly bindingKey: string;
  readonly contentHash: StudioVrmTexturePaintArtifactHash;
  readonly mimeType: typeof STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioVrmTexturePaintArtifactManifest {
  readonly schemaVersion: typeof STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_SCHEMA_VERSION;
  readonly kind: "toonspectrum/vrm-texture-paint-artifact-manifest";
  readonly bindings: readonly StudioVrmTexturePaintArtifactMetadata[];
}

/** Direct input for a newly encoded paint texture. */
export interface StudioVrmTexturePaintArtifactInput {
  /** Stable caller-owned material/texture identity, not a display name or archive path. */
  readonly bindingKey: string;
  readonly source: StudioVrmTexturePaintArtifactSource;
  /** Optional encoder receipt. When supplied, the PNG IHDR must match exactly. */
  readonly expectedWidth?: number;
  /** Optional encoder receipt. When supplied, the PNG IHDR must match exactly. */
  readonly expectedHeight?: number;
}

/** Compatible with the project's archive writer (`{ path, data }`). */
export interface StudioVrmTexturePaintArtifactArchiveEntry {
  readonly path: string;
  readonly data: Blob;
  readonly contentHash: StudioVrmTexturePaintArtifactHash;
  readonly mimeType: typeof STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioVrmTexturePaintArtifact {
  readonly metadata: StudioVrmTexturePaintArtifactMetadata;
  readonly archiveEntry: StudioVrmTexturePaintArtifactArchiveEntry;
}

export interface StudioVrmTexturePaintArtifactBundle {
  readonly manifest: StudioVrmTexturePaintArtifactManifest;
  /** One entry per unique content hash, sorted by hash. */
  readonly archiveEntries: readonly StudioVrmTexturePaintArtifactArchiveEntry[];
  readonly totalBytes: number;
  readonly totalPixels: number;
  readonly artifactCount: number;
}

export interface StudioVrmTexturePaintArtifactOptions {
  /** Callers may lower, but never raise, the browser-safety hard limits. */
  readonly limits?: Partial<StudioVrmTexturePaintArtifactLimits>;
  readonly signal?: AbortSignal;
}

export interface StudioVrmTexturePaintArtifactResolveContext {
  readonly signal?: AbortSignal;
}

/** Structurally compatible with `StudioVrmTexturePaintReadableImage` in the paint runtime. */
export interface StudioVrmTexturePaintArtifactReadableImage {
  readonly width: number;
  readonly height: number;
  /** Tightly packed, straight-alpha RGBA8. Ownership transfers to the paint runtime. */
  readonly data: Uint8ClampedArray;
}

export type StudioVrmTexturePaintArtifactDecoder = (
  png: Blob,
  metadata: StudioVrmTexturePaintArtifactMetadata,
  context: StudioVrmTexturePaintArtifactResolveContext,
) =>
  | Promise<StudioVrmTexturePaintArtifactReadableImage>
  | StudioVrmTexturePaintArtifactReadableImage;

export interface StudioVrmTexturePaintArtifactDecodeDependencies {
  /**
   * Preferred worker/WASM decoder seam. It must return a new, caller-owned straight-alpha RGBA8
   * buffer. The default browser path uses createImageBitmap and a temporary 2D canvas.
   */
  readonly decode?: StudioVrmTexturePaintArtifactDecoder;
  readonly createImageBitmap?: (png: Blob) => Promise<ImageBitmap>;
  readonly createCanvas?: (width: number, height: number) => HTMLCanvasElement;
}

export interface StudioVrmTexturePaintArtifactDecodeOptions
  extends StudioVrmTexturePaintArtifactOptions {
  readonly dependencies?: StudioVrmTexturePaintArtifactDecodeDependencies;
}

/**
 * Archive/server adapters implement only this byte resolver. Returning a URL is deliberately not
 * supported: every returned Blob/byte view is revalidated and rehashed before use.
 */
export interface StudioVrmTexturePaintArtifactResolver {
  resolve(
    contentHash: StudioVrmTexturePaintArtifactHash,
    context: StudioVrmTexturePaintArtifactResolveContext,
  ):
    | Promise<StudioVrmTexturePaintArtifactSource | null>
    | StudioVrmTexturePaintArtifactSource
    | null;
}

export type StudioVrmTexturePaintArtifactErrorCode =
  | "ABORTED"
  | "AGGREGATE_BYTE_LIMIT_EXCEEDED"
  | "AGGREGATE_PIXEL_LIMIT_EXCEEDED"
  | "ARTIFACT_COUNT_LIMIT_EXCEEDED"
  | "ARTIFACT_MISSING"
  | "BINDING_CONFLICT"
  | "BINDING_KEY_INVALID"
  | "BYTE_LIMIT_EXCEEDED"
  | "CONTENT_CONFLICT"
  | "CRYPTO_UNAVAILABLE"
  | "DECODE_DIMENSION_MISMATCH"
  | "DECODE_FAILED"
  | "DECODE_UNAVAILABLE"
  | "DIMENSION_LIMIT_EXCEEDED"
  | "DIMENSION_MISMATCH"
  | "HASH_FAILED"
  | "HASH_MISMATCH"
  | "LIMIT_INVALID"
  | "MANIFEST_INVALID"
  | "METADATA_INVALID"
  | "MIME_INVALID"
  | "PIXEL_LIMIT_EXCEEDED"
  | "PNG_INVALID"
  | "RESOLVE_FAILED"
  | "RESOLVER_INVALID"
  | "SOURCE_INVALID";

export class StudioVrmTexturePaintArtifactError extends Error {
  constructor(
    readonly code: StudioVrmTexturePaintArtifactErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = code === "ABORTED"
      ? "AbortError"
      : "StudioVrmTexturePaintArtifactError";
  }
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_IHDR_DATA_BYTES = 13;
const PNG_MINIMUM_BYTES = 57;
const PNG_MAX_CHUNKS = 4_096;
const PNG_CHUNK_TYPE_PATTERN = /^[A-Za-z]{4}$/u;
const PNG_CRITICAL_CHUNKS = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);
const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const BINDING_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/u;
const MANIFEST_KIND = "toonspectrum/vrm-texture-paint-artifact-manifest" as const;
const CRC_YIELD_BYTES = 1024 * 1024;
const NATIVE_BLOB_ARRAY_BUFFER = Blob.prototype.arrayBuffer;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

interface PngHeader {
  readonly width: number;
  readonly height: number;
}

interface PreparedSource {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly blob: Blob;
}

interface VerifiedBlobReceipt {
  readonly contentHash: StudioVrmTexturePaintArtifactHash;
  readonly mimeType: typeof STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Blob is immutable, so an identity-scoped receipt safely avoids repeating CRC + SHA-256 work
 * inside this module. Structured clones and caller-created lookalikes have different identities
 * and therefore always take the full public verification path.
 */
const verifiedBlobReceipts = new WeakMap<Blob, VerifiedBlobReceipt>();

interface StudioVrmTexturePaintArtifactInputSnapshot {
  readonly bindingKey: string;
  readonly source: Blob | Uint8Array<ArrayBuffer>;
  readonly expectedWidth?: number;
  readonly expectedHeight?: number;
}

function fail(
  code: StudioVrmTexturePaintArtifactErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new StudioVrmTexturePaintArtifactError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function abortError(): StudioVrmTexturePaintArtifactError {
  return new StudioVrmTexturePaintArtifactError(
    "ABORTED",
    "VRM 표면 페인팅 PNG 작업이 취소되었습니다.",
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}

function awaitWithAbort<T>(promise: PromiseLike<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return Promise.resolve(promise);
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (cause: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(cause);
      },
    );
  });
}

function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactDataKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isPlainDataRecord(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort(compareStrings);
  const expected = [...keys].sort(compareStrings);
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) return false;
  return actual.every((key) => {
    const descriptor = descriptors[key];
    return descriptor !== undefined && "value" in descriptor;
  });
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function resolveLimit(
  value: number | undefined,
  hardMaximum: number,
  key: keyof StudioVrmTexturePaintArtifactLimits,
): number {
  if (value === undefined) return hardMaximum;
  if (!Number.isSafeInteger(value) || value < 1 || value > hardMaximum) {
    fail(
      "LIMIT_INVALID",
      `${key} 한도는 1 이상 ${hardMaximum.toLocaleString("en-US")} 이하의 안전한 정수여야 합니다.`,
    );
  }
  return value;
}

function resolveLimits(
  limits: Partial<StudioVrmTexturePaintArtifactLimits> | undefined,
): StudioVrmTexturePaintArtifactLimits {
  if (limits !== undefined && !isPlainDataRecord(limits)) {
    fail("LIMIT_INVALID", "VRM 표면 페인팅 PNG 안전 한도가 올바르지 않습니다.");
  }
  return {
    maxArtifactBytes: resolveLimit(
      limits?.maxArtifactBytes,
      STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_LIMITS.maxArtifactBytes,
      "maxArtifactBytes",
    ),
    maxAggregateBytes: resolveLimit(
      limits?.maxAggregateBytes,
      STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_LIMITS.maxAggregateBytes,
      "maxAggregateBytes",
    ),
    maxWidth: resolveLimit(
      limits?.maxWidth,
      STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_LIMITS.maxWidth,
      "maxWidth",
    ),
    maxHeight: resolveLimit(
      limits?.maxHeight,
      STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_LIMITS.maxHeight,
      "maxHeight",
    ),
    maxPixels: resolveLimit(
      limits?.maxPixels,
      STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_LIMITS.maxPixels,
      "maxPixels",
    ),
    maxAggregatePixels: resolveLimit(
      limits?.maxAggregatePixels,
      STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_LIMITS.maxAggregatePixels,
      "maxAggregatePixels",
    ),
    maxBindings: resolveLimit(
      limits?.maxBindings,
      STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_LIMITS.maxBindings,
      "maxBindings",
    ),
    maxArtifacts: resolveLimit(
      limits?.maxArtifacts,
      STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_LIMITS.maxArtifacts,
      "maxArtifacts",
    ),
  };
}

function assertBindingKey(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value !== value.normalize("NFC") ||
    !BINDING_KEY_PATTERN.test(value) ||
    value.includes("//") ||
    value.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    fail(
      "BINDING_KEY_INVALID",
      "VRM 표면 페인팅 bindingKey는 정규화된 안전 식별자여야 합니다.",
    );
  }
}

function assertExpectedDimension(value: unknown): asserts value is number | undefined {
  if (
    value !== undefined &&
    (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 0xffff_ffff)
  ) {
    fail("DIMENSION_MISMATCH", "예상 PNG 해상도가 올바르지 않습니다.");
  }
}

function assertSourceShape(
  source: unknown,
  limits: StudioVrmTexturePaintArtifactLimits,
): asserts source is StudioVrmTexturePaintArtifactSource {
  if (!(source instanceof Blob) && !(source instanceof Uint8Array)) {
    fail("SOURCE_INVALID", "VRM 표면 페인팅 artifact는 Blob 또는 Uint8Array여야 합니다.");
  }
  if (source instanceof Blob && source.type !== STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME) {
    fail("MIME_INVALID", "VRM 표면 페인팅 Blob MIME은 image/png여야 합니다.");
  }
  const byteLength = source instanceof Blob ? source.size : source.byteLength;
  if (!Number.isSafeInteger(byteLength) || byteLength < PNG_MINIMUM_BYTES) {
    fail("SOURCE_INVALID", "VRM 표면 페인팅 PNG가 비었거나 잘렸습니다.");
  }
  if (byteLength > limits.maxArtifactBytes) {
    fail("BYTE_LIMIT_EXCEEDED", "VRM 표면 페인팅 PNG가 개별 바이트 예산을 초과했습니다.");
  }
}

async function prepareSource(
  source: StudioVrmTexturePaintArtifactSource,
  limits: StudioVrmTexturePaintArtifactLimits,
  signal: AbortSignal | undefined,
): Promise<PreparedSource> {
  assertSourceShape(source, limits);
  throwIfAborted(signal);
  if (source instanceof Uint8Array) {
    // Uint8Array is caller-mutable. Exactly one owned snapshot closes the validation/hash TOCTOU
    // window; Blob then takes its immutable archive snapshot from these same verified bytes.
    const bytes = Uint8Array.from(source);
    return {
      bytes,
      blob: new Blob([bytes], { type: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME }),
    };
  }
  try {
    // Call the intrinsic, not a subclass/proxy override. Only a plain native Blob can retain
    // identity; exotic Blob inputs are snapshotted into a canonical immutable Blob below.
    const buffer = await awaitWithAbort(
      NATIVE_BLOB_ARRAY_BUFFER.call(source),
      signal,
    );
    throwIfAborted(signal);
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength !== source.size) {
      fail("SOURCE_INVALID", "VRM 표면 페인팅 Blob 크기와 실제 바이트 수가 다릅니다.");
    }
    let retainSource = false;
    try {
      retainSource =
        Object.getPrototypeOf(source) === Blob.prototype
        && Object.getOwnPropertyDescriptor(source, "arrayBuffer") === undefined
        && Object.getOwnPropertyDescriptor(source, "size") === undefined
        && Object.getOwnPropertyDescriptor(source, "type") === undefined;
    } catch {
      retainSource = false;
    }
    return {
      bytes,
      blob: retainSource
        ? source
        : new Blob([bytes], { type: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME }),
    };
  } catch (cause) {
    if (cause instanceof StudioVrmTexturePaintArtifactError) throw cause;
    if (isAbortError(cause)) throw abortError();
    fail("SOURCE_INVALID", "VRM 표면 페인팅 Blob을 읽지 못했습니다.", cause);
  }
}

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

async function crc32(
  bytes: Uint8Array,
  start: number,
  end: number,
  signal: AbortSignal | undefined,
): Promise<number> {
  let crc = 0xffff_ffff;
  let nextYield = start + CRC_YIELD_BYTES;
  for (let index = start; index < end; index += 1) {
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ (bytes[index] ?? 0)) & 0xff] ?? 0);
    if (index >= nextYield) {
      throwIfAborted(signal);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      throwIfAborted(signal);
      nextYield += CRC_YIELD_BYTES;
    }
  }
  throwIfAborted(signal);
  return (crc ^ 0xffff_ffff) >>> 0;
}

function validBitDepth(colorType: number, bitDepth: number): boolean {
  if (colorType === 0) return [1, 2, 4, 8, 16].includes(bitDepth);
  if (colorType === 2) return bitDepth === 8 || bitDepth === 16;
  if (colorType === 3) return [1, 2, 4, 8].includes(bitDepth);
  if (colorType === 4 || colorType === 6) return bitDepth === 8 || bitDepth === 16;
  return false;
}

async function verifyPng(
  bytes: Uint8Array<ArrayBuffer>,
  limits: StudioVrmTexturePaintArtifactLimits,
  expectedWidth: number | undefined,
  expectedHeight: number | undefined,
  signal: AbortSignal | undefined,
): Promise<PngHeader> {
  throwIfAborted(signal);
  if (
    bytes.byteLength < PNG_MINIMUM_BYTES ||
    PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)
  ) fail("PNG_INVALID", "PNG signature 또는 전체 구조가 올바르지 않습니다.");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.byteLength;
  let chunkCount = 0;
  let sawIhdr = false;
  let sawPlte = false;
  let sawIdat = false;
  let endedIdat = false;
  let sawIend = false;
  let totalIdatBytes = 0;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let bitDepth = -1;

  while (offset < bytes.byteLength) {
    throwIfAborted(signal);
    chunkCount += 1;
    if (chunkCount > PNG_MAX_CHUNKS || offset + 12 > bytes.byteLength) {
      fail("PNG_INVALID", "PNG chunk 수 또는 경계가 안전 범위를 벗어났습니다.");
    }
    const length = view.getUint32(offset, false);
    const typeOffset = offset + 4;
    const dataOffset = typeOffset + 4;
    const dataEnd = dataOffset + length;
    const crcOffset = dataEnd;
    const nextOffset = crcOffset + 4;
    if (!Number.isSafeInteger(dataEnd) || nextOffset > bytes.byteLength) {
      fail("PNG_INVALID", "PNG chunk 길이가 파일 경계를 벗어났습니다.");
    }
    const type = chunkType(bytes, typeOffset);
    if (
      !PNG_CHUNK_TYPE_PATTERN.test(type) ||
      type.charCodeAt(2) < 0x41 ||
      type.charCodeAt(2) > 0x5a
    ) fail("PNG_INVALID", "PNG chunk type 또는 reserved bit가 올바르지 않습니다.");
    if (
      type.charCodeAt(0) >= 0x41 &&
      type.charCodeAt(0) <= 0x5a &&
      !PNG_CRITICAL_CHUNKS.has(type)
    ) fail("PNG_INVALID", "지원하지 않는 PNG critical chunk가 있습니다.");
    if (await crc32(bytes, typeOffset, dataEnd, signal) !== view.getUint32(crcOffset, false)) {
      fail("PNG_INVALID", "PNG chunk CRC가 올바르지 않습니다.");
    }

    if (!sawIhdr) {
      if (type !== "IHDR" || length !== PNG_IHDR_DATA_BYTES) {
        fail("PNG_INVALID", "PNG의 첫 chunk는 단일 13바이트 IHDR여야 합니다.");
      }
      width = view.getUint32(dataOffset, false);
      height = view.getUint32(dataOffset + 4, false);
      bitDepth = bytes[dataOffset + 8] ?? -1;
      colorType = bytes[dataOffset + 9] ?? -1;
      const compression = bytes[dataOffset + 10];
      const filter = bytes[dataOffset + 11];
      const interlace = bytes[dataOffset + 12];
      if (
        width < 1 ||
        height < 1 ||
        !validBitDepth(colorType, bitDepth) ||
        compression !== 0 ||
        filter !== 0 ||
        (interlace !== 0 && interlace !== 1)
      ) fail("PNG_INVALID", "PNG IHDR 값이 표준 PNG profile과 일치하지 않습니다.");
      if (
        (expectedWidth !== undefined && width !== expectedWidth) ||
        (expectedHeight !== undefined && height !== expectedHeight)
      ) fail("DIMENSION_MISMATCH", "PNG IHDR 해상도가 encoder 영수증과 일치하지 않습니다.");
      if (width > limits.maxWidth || height > limits.maxHeight) {
        fail("DIMENSION_LIMIT_EXCEEDED", "PNG IHDR 해상도가 축별 안전 한도를 초과했습니다.");
      }
      const pixels = width * height;
      if (!Number.isSafeInteger(pixels) || pixels > limits.maxPixels) {
        fail("PIXEL_LIMIT_EXCEEDED", "PNG IHDR 픽셀 수가 안전 예산을 초과했습니다.");
      }
      sawIhdr = true;
    } else if (type === "IHDR") {
      fail("PNG_INVALID", "PNG에 IHDR chunk가 중복되었습니다.");
    } else if (type === "PLTE") {
      const paletteEntries = length / 3;
      if (
        sawPlte ||
        sawIdat ||
        colorType === 0 ||
        colorType === 4 ||
        length < 3 ||
        length > 768 ||
        length % 3 !== 0 ||
        (colorType === 3 && paletteEntries > 2 ** bitDepth)
      ) fail("PNG_INVALID", "PNG PLTE chunk의 순서, 색상 profile 또는 길이가 올바르지 않습니다.");
      sawPlte = true;
    } else if (type === "IDAT") {
      if (endedIdat || length < 1) {
        fail("PNG_INVALID", "PNG IDAT chunk가 비었거나 연속 순서를 벗어났습니다.");
      }
      if (colorType === 3 && !sawPlte) {
        fail("PNG_INVALID", "Indexed PNG에는 IDAT 앞에 PLTE가 필요합니다.");
      }
      sawIdat = true;
      totalIdatBytes += length;
      if (!Number.isSafeInteger(totalIdatBytes) || totalIdatBytes > bytes.byteLength) {
        fail("PNG_INVALID", "PNG IDAT 합계가 안전 범위를 벗어났습니다.");
      }
    } else if (type === "IEND") {
      if (!sawIdat || length !== 0 || sawIend || nextOffset !== bytes.byteLength) {
        fail("PNG_INVALID", "PNG IEND 또는 trailing bytes가 올바르지 않습니다.");
      }
      sawIend = true;
    } else if (sawIdat) {
      endedIdat = true;
    }
    offset = nextOffset;
  }
  if (
    !sawIhdr ||
    !sawIdat ||
    !sawIend ||
    totalIdatBytes < 1 ||
    offset !== bytes.byteLength
  ) fail("PNG_INVALID", "PNG에 완전한 IHDR/IDAT/IEND 구조가 없습니다.");
  return { width, height };
}

async function sha256(
  bytes: Uint8Array<ArrayBuffer>,
  signal: AbortSignal | undefined,
): Promise<StudioVrmTexturePaintArtifactHash> {
  throwIfAborted(signal);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== "function") {
    fail("CRYPTO_UNAVAILABLE", "이 브라우저에서는 PNG SHA-256 무결성을 확인할 수 없습니다.");
  }
  let digest: ArrayBuffer;
  try {
    digest = await awaitWithAbort(subtle.digest("SHA-256", bytes), signal);
  } catch (cause) {
    if (isAbortError(cause)) throw abortError();
    fail("HASH_FAILED", "PNG SHA-256 계산에 실패했습니다.", cause);
  }
  throwIfAborted(signal);
  const hex = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  if (hex.length !== 64) fail("HASH_FAILED", "PNG SHA-256 결과 길이가 올바르지 않습니다.");
  return `sha256:${hex}`;
}

export function studioVrmTexturePaintArtifactArchivePath(
  contentHash: StudioVrmTexturePaintArtifactHash,
): string {
  if (!CONTENT_HASH_PATTERN.test(contentHash)) {
    fail("METADATA_INVALID", "VRM 표면 페인팅 contentHash 형식이 올바르지 않습니다.");
  }
  return `artifacts/vrm-texture-paint/${contentHash.slice("sha256:".length)}.png`;
}

function canonicalMetadata(
  bindingKey: string,
  contentHash: StudioVrmTexturePaintArtifactHash,
  byteLength: number,
  width: number,
  height: number,
): StudioVrmTexturePaintArtifactMetadata {
  return Object.freeze({
    schemaVersion: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_SCHEMA_VERSION,
    kind: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_KIND,
    bindingKey,
    contentHash,
    mimeType: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME,
    byteLength,
    width,
    height,
  });
}

function canonicalArchiveEntry(
  metadata: StudioVrmTexturePaintArtifactMetadata,
  blob: Blob,
): StudioVrmTexturePaintArtifactArchiveEntry {
  return Object.freeze({
    path: studioVrmTexturePaintArtifactArchivePath(metadata.contentHash),
    data: blob,
    contentHash: metadata.contentHash,
    mimeType: metadata.mimeType,
    byteLength: metadata.byteLength,
    width: metadata.width,
    height: metadata.height,
  });
}

function parseMetadata(value: unknown): StudioVrmTexturePaintArtifactMetadata {
  if (!hasExactDataKeys(value, [
    "schemaVersion",
    "kind",
    "bindingKey",
    "contentHash",
    "mimeType",
    "byteLength",
    "width",
    "height",
  ])) fail("METADATA_INVALID", "VRM 표면 페인팅 artifact metadata 구조가 올바르지 않습니다.");

  const {
    schemaVersion,
    kind,
    bindingKey,
    contentHash,
    mimeType,
    byteLength,
    width,
    height,
  } = value;
  assertBindingKey(bindingKey);
  if (
    schemaVersion !== STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_SCHEMA_VERSION ||
    kind !== STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_KIND ||
    typeof contentHash !== "string" ||
    !CONTENT_HASH_PATTERN.test(contentHash) ||
    mimeType !== STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME ||
    !Number.isSafeInteger(byteLength) ||
    (byteLength as number) < PNG_MINIMUM_BYTES ||
    !Number.isSafeInteger(width) ||
    (width as number) < 1 ||
    !Number.isSafeInteger(height) ||
    (height as number) < 1
  ) fail("METADATA_INVALID", "VRM 표면 페인팅 artifact metadata 값이 올바르지 않습니다.");
  return canonicalMetadata(
    bindingKey,
    contentHash as StudioVrmTexturePaintArtifactHash,
    byteLength as number,
    width as number,
    height as number,
  );
}

function assertMetadataBudgets(
  metadata: StudioVrmTexturePaintArtifactMetadata,
  limits: StudioVrmTexturePaintArtifactLimits,
): void {
  if (metadata.byteLength > limits.maxArtifactBytes) {
    fail("BYTE_LIMIT_EXCEEDED", "저장된 PNG metadata가 개별 바이트 예산을 초과했습니다.");
  }
  if (metadata.width > limits.maxWidth || metadata.height > limits.maxHeight) {
    fail("DIMENSION_LIMIT_EXCEEDED", "저장된 PNG metadata가 축별 해상도 한도를 초과했습니다.");
  }
  const pixels = metadata.width * metadata.height;
  if (!Number.isSafeInteger(pixels) || pixels > limits.maxPixels) {
    fail("PIXEL_LIMIT_EXCEEDED", "저장된 PNG metadata가 픽셀 예산을 초과했습니다.");
  }
}

function metadataMatches(
  left: StudioVrmTexturePaintArtifactMetadata,
  right: StudioVrmTexturePaintArtifactMetadata,
): boolean {
  return left.schemaVersion === right.schemaVersion &&
    left.kind === right.kind &&
    left.bindingKey === right.bindingKey &&
    left.contentHash === right.contentHash &&
    left.mimeType === right.mimeType &&
    left.byteLength === right.byteLength &&
    left.width === right.width &&
    left.height === right.height;
}

function verifiedBlobMatchesMetadata(
  receipt: VerifiedBlobReceipt,
  metadata: StudioVrmTexturePaintArtifactMetadata,
): boolean {
  return receipt.contentHash === metadata.contentHash
    && receipt.mimeType === metadata.mimeType
    && receipt.byteLength === metadata.byteLength
    && receipt.width === metadata.width
    && receipt.height === metadata.height;
}

function registerVerifiedBlobArtifact(
  metadata: StudioVrmTexturePaintArtifactMetadata,
  blob: Blob,
): StudioVrmTexturePaintArtifact {
  const artifact = Object.freeze({
    metadata,
    archiveEntry: canonicalArchiveEntry(metadata, blob),
  });
  verifiedBlobReceipts.set(blob, Object.freeze({
    contentHash: metadata.contentHash,
    mimeType: metadata.mimeType,
    byteLength: metadata.byteLength,
    width: metadata.width,
    height: metadata.height,
  }));
  return artifact;
}

function resolveVerifiedBlobArtifact(
  metadata: StudioVrmTexturePaintArtifactMetadata,
  source: StudioVrmTexturePaintArtifactSource,
): StudioVrmTexturePaintArtifact | null {
  if (!(source instanceof Blob)) return null;
  const receipt = verifiedBlobReceipts.get(source);
  return receipt && verifiedBlobMatchesMetadata(receipt, metadata)
    ? registerVerifiedBlobArtifact(metadata, source)
    : null;
}

async function artifactFromPrepared(
  bindingKey: string,
  prepared: PreparedSource,
  limits: StudioVrmTexturePaintArtifactLimits,
  signal: AbortSignal | undefined,
  expectedWidth?: number,
  expectedHeight?: number,
  expectedMetadata?: StudioVrmTexturePaintArtifactMetadata,
): Promise<StudioVrmTexturePaintArtifact> {
  const dimensions = await verifyPng(
    prepared.bytes,
    limits,
    expectedWidth,
    expectedHeight,
    signal,
  );
  const contentHash = await sha256(prepared.bytes, signal);
  if (expectedMetadata && contentHash !== expectedMetadata.contentHash) {
    fail("HASH_MISMATCH", "저장된 VRM 표면 페인팅 PNG SHA-256이 metadata와 다릅니다.");
  }
  const metadata = canonicalMetadata(
    bindingKey,
    contentHash,
    prepared.bytes.byteLength,
    dimensions.width,
    dimensions.height,
  );
  if (expectedMetadata && !metadataMatches(metadata, expectedMetadata)) {
    fail("DIMENSION_MISMATCH", "저장된 VRM 표면 페인팅 PNG receipt가 metadata와 다릅니다.");
  }
  return registerVerifiedBlobArtifact(metadata, prepared.blob);
}

/**
 * Verifies PNG structure and creates a deterministic content-addressed archive artifact.
 */
export async function createStudioVrmTexturePaintArtifact(
  input: StudioVrmTexturePaintArtifactInput,
  options: StudioVrmTexturePaintArtifactOptions = {},
): Promise<StudioVrmTexturePaintArtifact> {
  const limits = resolveLimits(options.limits);
  if (!isPlainDataRecord(input)) {
    fail("SOURCE_INVALID", "VRM 표면 페인팅 artifact 입력이 올바르지 않습니다.");
  }
  assertBindingKey(input.bindingKey);
  assertExpectedDimension(input.expectedWidth);
  assertExpectedDimension(input.expectedHeight);
  const prepared = await prepareSource(input.source, limits, options.signal);
  return artifactFromPrepared(
    input.bindingKey,
    prepared,
    limits,
    options.signal,
    input.expectedWidth,
    input.expectedHeight,
  );
}

/**
 * Revalidates a persisted archive entry against canonical metadata. No metadata field is trusted.
 */
export async function verifyStudioVrmTexturePaintArtifact(
  metadataValue: unknown,
  source: StudioVrmTexturePaintArtifactSource,
  options: StudioVrmTexturePaintArtifactOptions = {},
): Promise<StudioVrmTexturePaintArtifact> {
  const limits = resolveLimits(options.limits);
  const metadata = parseMetadata(metadataValue);
  assertMetadataBudgets(metadata, limits);
  throwIfAborted(options.signal);
  const verified = resolveVerifiedBlobArtifact(metadata, source);
  if (verified) return verified;
  const prepared = await prepareSource(source, limits, options.signal);
  if (prepared.bytes.byteLength !== metadata.byteLength) {
    fail("HASH_MISMATCH", "저장된 VRM 표면 페인팅 PNG 바이트 수가 metadata와 다릅니다.");
  }
  return artifactFromPrepared(
    metadata.bindingKey,
    prepared,
    limits,
    options.signal,
    metadata.width,
    metadata.height,
    metadata,
  );
}

function assertReadableImage(
  value: unknown,
  metadata: StudioVrmTexturePaintArtifactMetadata,
): asserts value is StudioVrmTexturePaintArtifactReadableImage {
  if (
    !hasExactDataKeys(value, ["width", "height", "data"]) ||
    value.width !== metadata.width ||
    value.height !== metadata.height ||
    !(value.data instanceof Uint8ClampedArray)
  ) {
    fail(
      "DECODE_DIMENSION_MISMATCH",
      "디코딩한 VRM 표면 페인팅 RGBA8 이미지가 PNG metadata와 일치하지 않습니다.",
    );
  }
  const expectedBytes = metadata.width * metadata.height * 4;
  if (
    !Number.isSafeInteger(expectedBytes) ||
    value.data.byteLength !== expectedBytes
  ) {
    fail(
      "DECODE_DIMENSION_MISMATCH",
      "디코딩한 VRM 표면 페인팅 RGBA8 바이트 수가 PNG 해상도와 일치하지 않습니다.",
    );
  }
}

function defaultCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document !== "object" || typeof document.createElement !== "function") {
    fail("DECODE_UNAVAILABLE", "이 환경에서는 PNG를 RGBA8 이미지로 디코딩할 수 없습니다.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function decodeWithBrowserCanvas(
  artifact: StudioVrmTexturePaintArtifact,
  dependencies: StudioVrmTexturePaintArtifactDecodeDependencies | undefined,
  signal: AbortSignal | undefined,
): Promise<StudioVrmTexturePaintArtifactReadableImage> {
  const createBitmap = dependencies?.createImageBitmap ?? globalThis.createImageBitmap;
  if (typeof createBitmap !== "function") {
    fail("DECODE_UNAVAILABLE", "이 브라우저에서는 PNG ImageBitmap 디코더를 사용할 수 없습니다.");
  }
  let bitmapPromise: Promise<ImageBitmap>;
  try {
    bitmapPromise = Promise.resolve(createBitmap(artifact.archiveEntry.data));
  } catch (cause) {
    fail("DECODE_FAILED", "VRM 표면 페인팅 PNG 디코더를 시작하지 못했습니다.", cause);
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await awaitWithAbort(bitmapPromise, signal);
  } catch (cause) {
    // createImageBitmap itself is not cancellable. Close a late result instead of leaking it or
    // allowing it to mutate current state after the request has been cancelled.
    void bitmapPromise.then((lateBitmap) => lateBitmap.close(), () => undefined);
    if (isAbortError(cause)) throw abortError();
    fail("DECODE_FAILED", "VRM 표면 페인팅 PNG를 디코딩하지 못했습니다.", cause);
  }
  try {
    throwIfAborted(signal);
    if (
      bitmap.width !== artifact.metadata.width ||
      bitmap.height !== artifact.metadata.height
    ) {
      fail(
        "DECODE_DIMENSION_MISMATCH",
        "디코딩한 PNG 해상도가 검증된 IHDR과 일치하지 않습니다.",
      );
    }
    const canvas = (dependencies?.createCanvas ?? defaultCanvas)(
      artifact.metadata.width,
      artifact.metadata.height,
    );
    if (!(canvas instanceof HTMLCanvasElement)) {
      fail("DECODE_UNAVAILABLE", "PNG 디코딩 canvas factory가 올바르지 않습니다.");
    }
    canvas.width = artifact.metadata.width;
    canvas.height = artifact.metadata.height;
    const context = canvas.getContext("2d", {
      alpha: true,
      colorSpace: "srgb",
      willReadFrequently: true,
    });
    if (!context) {
      fail("DECODE_UNAVAILABLE", "PNG RGBA8 canvas context를 만들 수 없습니다.");
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = {
      width: imageData.width,
      height: imageData.height,
      data: imageData.data,
    };
    assertReadableImage(result, artifact.metadata);
    throwIfAborted(signal);
    return Object.freeze(result);
  } catch (cause) {
    if (cause instanceof StudioVrmTexturePaintArtifactError) throw cause;
    if (isAbortError(cause)) throw abortError();
    fail("DECODE_FAILED", "VRM 표면 페인팅 PNG의 RGBA8 픽셀을 읽지 못했습니다.", cause);
  } finally {
    bitmap.close();
  }
}

/**
 * Verifies stored bytes first, then creates the transient RGBA8 object accepted by
 * `runtime.rehydrateTarget({ binding, image, signal })`. The returned pixels are never included in
 * metadata or archive manifests.
 */
export async function decodeStudioVrmTexturePaintArtifact(
  metadataValue: unknown,
  source: StudioVrmTexturePaintArtifactSource,
  options: StudioVrmTexturePaintArtifactDecodeOptions = {},
): Promise<StudioVrmTexturePaintArtifactReadableImage> {
  const artifact = await verifyStudioVrmTexturePaintArtifact(metadataValue, source, options);
  throwIfAborted(options.signal);
  const decoder = options.dependencies?.decode;
  if (!decoder) {
    return decodeWithBrowserCanvas(artifact, options.dependencies, options.signal);
  }
  let result: StudioVrmTexturePaintArtifactReadableImage;
  try {
    result = await awaitWithAbort(
      Promise.resolve(decoder(
        artifact.archiveEntry.data,
        artifact.metadata,
        { signal: options.signal },
      )),
      options.signal,
    );
  } catch (cause) {
    if (cause instanceof StudioVrmTexturePaintArtifactError) throw cause;
    if (isAbortError(cause)) throw abortError();
    fail("DECODE_FAILED", "VRM 표면 페인팅 PNG RGBA8 디코더가 실패했습니다.", cause);
  }
  throwIfAborted(options.signal);
  assertReadableImage(result, artifact.metadata);
  return Object.freeze({
    width: result.width,
    height: result.height,
    data: result.data,
  });
}

function canonicalManifest(
  bindings: readonly StudioVrmTexturePaintArtifactMetadata[],
): StudioVrmTexturePaintArtifactManifest {
  return Object.freeze({
    schemaVersion: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_SCHEMA_VERSION,
    kind: MANIFEST_KIND,
    bindings: Object.freeze([...bindings].sort(
      (left, right) => compareStrings(left.bindingKey, right.bindingKey),
    )),
  });
}

function bundleFromArtifacts(
  bindings: ReadonlyMap<string, StudioVrmTexturePaintArtifactMetadata>,
  entries: ReadonlyMap<StudioVrmTexturePaintArtifactHash, StudioVrmTexturePaintArtifactArchiveEntry>,
  totalBytes: number,
  totalPixels: number,
): StudioVrmTexturePaintArtifactBundle {
  return Object.freeze({
    manifest: canonicalManifest([...bindings.values()]),
    archiveEntries: Object.freeze([...entries.values()].sort(
      (left, right) => compareStrings(left.contentHash, right.contentHash),
    )),
    totalBytes,
    totalPixels,
    artifactCount: entries.size,
  });
}

function checkedAdd(
  current: number,
  increment: number,
  maximum: number,
  code:
    | "AGGREGATE_BYTE_LIMIT_EXCEEDED"
    | "AGGREGATE_PIXEL_LIMIT_EXCEEDED"
    | "ARTIFACT_COUNT_LIMIT_EXCEEDED",
  message: string,
): number {
  const result = current + increment;
  if (!Number.isSafeInteger(result) || result > maximum) fail(code, message);
  return result;
}

/**
 * Creates a deterministic manifest and deduplicates identical PNG bytes by content hash.
 * The aggregate input-byte preflight also caps caller-owned mutable snapshots before hashing.
 */
export async function buildStudioVrmTexturePaintArtifactBundle(
  inputValues: readonly StudioVrmTexturePaintArtifactInput[],
  options: StudioVrmTexturePaintArtifactOptions = {},
): Promise<StudioVrmTexturePaintArtifactBundle> {
  const limits = resolveLimits(options.limits);
  if (!Array.isArray(inputValues)) {
    fail("SOURCE_INVALID", "VRM 표면 페인팅 artifact 목록이 배열이 아닙니다.");
  }
  if (inputValues.length > limits.maxBindings) {
    fail("ARTIFACT_COUNT_LIMIT_EXCEEDED", "VRM 표면 페인팅 binding 수가 안전 한도를 초과했습니다.");
  }
  throwIfAborted(options.signal);

  const snapshots: StudioVrmTexturePaintArtifactInputSnapshot[] = [];
  let inputBytes = 0;
  // Snapshot every mutable byte view synchronously before the first await.
  for (const input of inputValues) {
    if (!isPlainDataRecord(input)) {
      fail("SOURCE_INVALID", "VRM 표면 페인팅 artifact 입력이 올바르지 않습니다.");
    }
    assertBindingKey(input.bindingKey);
    assertExpectedDimension(input.expectedWidth);
    assertExpectedDimension(input.expectedHeight);
    assertSourceShape(input.source, limits);
    inputBytes = checkedAdd(
      inputBytes,
      input.source instanceof Blob ? input.source.size : input.source.byteLength,
      limits.maxAggregateBytes,
      "AGGREGATE_BYTE_LIMIT_EXCEEDED",
      "VRM 표면 페인팅 입력 PNG 합계가 안전 예산을 초과했습니다.",
    );
    snapshots.push({
      bindingKey: input.bindingKey,
      source: input.source instanceof Uint8Array ? Uint8Array.from(input.source) : input.source,
      expectedWidth: input.expectedWidth,
      expectedHeight: input.expectedHeight,
    });
  }

  const bindings = new Map<string, StudioVrmTexturePaintArtifactMetadata>();
  const entries = new Map<
    StudioVrmTexturePaintArtifactHash,
    StudioVrmTexturePaintArtifactArchiveEntry
  >();
  let totalBytes = 0;
  let totalPixels = 0;
  for (const snapshot of snapshots) {
    throwIfAborted(options.signal);
    // Uint8Array snapshots are already exclusively owned. Reuse them for structure/hash work and
    // take only the one Blob snapshot required by the archive instead of copying through
    // Blob.arrayBuffer() again.
    const prepared = snapshot.source instanceof Uint8Array
      ? {
          bytes: snapshot.source,
          blob: new Blob(
            [snapshot.source],
            { type: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME },
          ),
        }
      : await prepareSource(snapshot.source, limits, options.signal);
    const artifact = await artifactFromPrepared(
      snapshot.bindingKey,
      prepared,
      limits,
      options.signal,
      snapshot.expectedWidth,
      snapshot.expectedHeight,
    );
    const existingBinding = bindings.get(artifact.metadata.bindingKey);
    if (existingBinding) {
      if (!metadataMatches(existingBinding, artifact.metadata)) {
        fail(
          "BINDING_CONFLICT",
          "하나의 VRM 표면 bindingKey가 서로 다른 PNG를 가리킵니다.",
        );
      }
      continue;
    }
    const existingEntry = entries.get(artifact.metadata.contentHash);
    if (
      existingEntry &&
      (
        existingEntry.byteLength !== artifact.archiveEntry.byteLength ||
        existingEntry.width !== artifact.archiveEntry.width ||
        existingEntry.height !== artifact.archiveEntry.height ||
        existingEntry.mimeType !== artifact.archiveEntry.mimeType
      )
    ) fail("CONTENT_CONFLICT", "동일한 SHA-256 PNG의 무결성 receipt가 서로 충돌합니다.");

    if (!existingEntry) {
      if (entries.size >= limits.maxArtifacts) {
        fail("ARTIFACT_COUNT_LIMIT_EXCEEDED", "고유 PNG artifact 수가 안전 한도를 초과했습니다.");
      }
      totalBytes = checkedAdd(
        totalBytes,
        artifact.archiveEntry.byteLength,
        limits.maxAggregateBytes,
        "AGGREGATE_BYTE_LIMIT_EXCEEDED",
        "고유 VRM 표면 페인팅 PNG 합계가 안전 예산을 초과했습니다.",
      );
      totalPixels = checkedAdd(
        totalPixels,
        artifact.archiveEntry.width * artifact.archiveEntry.height,
        limits.maxAggregatePixels,
        "AGGREGATE_PIXEL_LIMIT_EXCEEDED",
        "고유 VRM 표면 페인팅 PNG의 decoded 픽셀 합계가 안전 예산을 초과했습니다.",
      );
      entries.set(artifact.metadata.contentHash, artifact.archiveEntry);
    }
    bindings.set(artifact.metadata.bindingKey, artifact.metadata);
  }
  return bundleFromArtifacts(bindings, entries, totalBytes, totalPixels);
}

function parseManifest(
  value: unknown,
  limits: StudioVrmTexturePaintArtifactLimits,
): StudioVrmTexturePaintArtifactManifest {
  if (
    !hasExactDataKeys(value, ["schemaVersion", "kind", "bindings"]) ||
    value.schemaVersion !== STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_SCHEMA_VERSION ||
    value.kind !== MANIFEST_KIND ||
    !Array.isArray(value.bindings) ||
    value.bindings.length > limits.maxBindings
  ) fail("MANIFEST_INVALID", "VRM 표면 페인팅 artifact manifest가 올바르지 않습니다.");

  const bindings: StudioVrmTexturePaintArtifactMetadata[] = [];
  const bindingKeys = new Map<string, StudioVrmTexturePaintArtifactMetadata>();
  const contentReceipts = new Map<
    StudioVrmTexturePaintArtifactHash,
    StudioVrmTexturePaintArtifactMetadata
  >();
  let totalBytes = 0;
  let totalPixels = 0;
  for (const metadataValue of value.bindings) {
    const metadata = parseMetadata(metadataValue);
    assertMetadataBudgets(metadata, limits);
    const existingBinding = bindingKeys.get(metadata.bindingKey);
    if (existingBinding) {
      fail(
        "BINDING_CONFLICT",
        metadataMatches(existingBinding, metadata)
          ? "VRM 표면 페인팅 manifest에 bindingKey가 중복되었습니다."
          : "VRM 표면 페인팅 manifest의 bindingKey가 서로 다른 PNG를 가리킵니다.",
      );
    }
    const existingContent = contentReceipts.get(metadata.contentHash);
    if (
      existingContent &&
      (
        existingContent.byteLength !== metadata.byteLength ||
        existingContent.width !== metadata.width ||
        existingContent.height !== metadata.height ||
        existingContent.mimeType !== metadata.mimeType
      )
    ) fail("CONTENT_CONFLICT", "동일한 SHA-256 PNG metadata가 서로 충돌합니다.");
    if (!existingContent) {
      if (contentReceipts.size >= limits.maxArtifacts) {
        fail("ARTIFACT_COUNT_LIMIT_EXCEEDED", "고유 PNG artifact 수가 안전 한도를 초과했습니다.");
      }
      totalBytes = checkedAdd(
        totalBytes,
        metadata.byteLength,
        limits.maxAggregateBytes,
        "AGGREGATE_BYTE_LIMIT_EXCEEDED",
        "VRM 표면 페인팅 manifest 바이트 합계가 안전 예산을 초과했습니다.",
      );
      totalPixels = checkedAdd(
        totalPixels,
        metadata.width * metadata.height,
        limits.maxAggregatePixels,
        "AGGREGATE_PIXEL_LIMIT_EXCEEDED",
        "VRM 표면 페인팅 manifest의 decoded 픽셀 합계가 안전 예산을 초과했습니다.",
      );
      contentReceipts.set(metadata.contentHash, metadata);
    }
    bindingKeys.set(metadata.bindingKey, metadata);
    bindings.push(metadata);
  }
  return canonicalManifest(bindings);
}

/**
 * Loads every unique hash once, then revalidates PNG structure, dimensions, byte count, and SHA-256
 * before returning archive-ready immutable Blobs.
 */
export async function rehydrateStudioVrmTexturePaintArtifactManifest(
  manifestValue: unknown,
  resolver: StudioVrmTexturePaintArtifactResolver,
  options: StudioVrmTexturePaintArtifactOptions = {},
): Promise<StudioVrmTexturePaintArtifactBundle> {
  const limits = resolveLimits(options.limits);
  const manifest = parseManifest(manifestValue, limits);
  if (
    !isPlainDataRecord(resolver) ||
    typeof resolver.resolve !== "function"
  ) fail("RESOLVER_INVALID", "VRM 표면 페인팅 artifact resolver가 올바르지 않습니다.");
  throwIfAborted(options.signal);

  const bindings = new Map<string, StudioVrmTexturePaintArtifactMetadata>();
  const entries = new Map<
    StudioVrmTexturePaintArtifactHash,
    StudioVrmTexturePaintArtifactArchiveEntry
  >();
  let totalBytes = 0;
  let totalPixels = 0;
  for (const metadata of manifest.bindings) {
    bindings.set(metadata.bindingKey, metadata);
    if (entries.has(metadata.contentHash)) continue;
    let source: StudioVrmTexturePaintArtifactSource | null;
    try {
      source = await awaitWithAbort(
        Promise.resolve(resolver.resolve(metadata.contentHash, { signal: options.signal })),
        options.signal,
      );
    } catch (cause) {
      if (cause instanceof StudioVrmTexturePaintArtifactError) throw cause;
      if (isAbortError(cause)) throw abortError();
      fail("RESOLVE_FAILED", "VRM 표면 페인팅 PNG를 artifact 저장소에서 읽지 못했습니다.", cause);
    }
    throwIfAborted(options.signal);
    if (source === null) {
      fail("ARTIFACT_MISSING", "VRM 표면 페인팅 PNG가 artifact 저장소에 없습니다.");
    }
    const artifact = await verifyStudioVrmTexturePaintArtifact(
      metadata,
      source,
      { limits, signal: options.signal },
    );
    totalBytes = checkedAdd(
      totalBytes,
      artifact.archiveEntry.byteLength,
      limits.maxAggregateBytes,
      "AGGREGATE_BYTE_LIMIT_EXCEEDED",
      "재복원한 VRM 표면 페인팅 PNG 합계가 안전 예산을 초과했습니다.",
    );
    totalPixels = checkedAdd(
      totalPixels,
      artifact.archiveEntry.width * artifact.archiveEntry.height,
      limits.maxAggregatePixels,
      "AGGREGATE_PIXEL_LIMIT_EXCEEDED",
      "재복원한 VRM 표면 페인팅 PNG의 decoded 픽셀 합계가 안전 예산을 초과했습니다.",
    );
    entries.set(metadata.contentHash, artifact.archiveEntry);
  }
  return bundleFromArtifacts(bindings, entries, totalBytes, totalPixels);
}

/**
 * Canonical JSON for project/archive manifests. It validates untrusted data before serialization.
 */
export function canonicalStudioVrmTexturePaintArtifactManifestJson(
  manifestValue: unknown,
  limits?: Partial<StudioVrmTexturePaintArtifactLimits>,
): string {
  return JSON.stringify(parseManifest(manifestValue, resolveLimits(limits)));
}
