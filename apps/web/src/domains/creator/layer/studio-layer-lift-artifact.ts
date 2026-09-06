import { calculateStudioCrc32 } from "../studio-crc32";
import { sha256HexPortable } from "../studio-sha256";

export const STUDIO_LAYER_LIFT_ARTIFACT_KIND =
  "toonspectrum.scene-layer-lift/png-artifact-pair" as const;
export const STUDIO_LAYER_LIFT_ARTIFACT_VERSION = 1 as const;

export const STUDIO_LAYER_LIFT_ARTIFACT_MAX_AXIS_PIXELS = 8_192;
export const STUDIO_LAYER_LIFT_ARTIFACT_MAX_PIXELS = 16_777_216;
export const STUDIO_LAYER_LIFT_ARTIFACT_MAX_COMPRESSED_BYTES =
  8 * 1024 * 1024;
export const STUDIO_LAYER_LIFT_ARTIFACT_MAX_DECODED_BYTES = 64 * 1024 * 1024;
export const STUDIO_LAYER_LIFT_ARTIFACT_PAIR_MAX_PIXELS =
  STUDIO_LAYER_LIFT_ARTIFACT_MAX_PIXELS * 2;
export const STUDIO_LAYER_LIFT_ARTIFACT_PAIR_MAX_COMPRESSED_BYTES =
  STUDIO_LAYER_LIFT_ARTIFACT_MAX_COMPRESSED_BYTES * 2;
export const STUDIO_LAYER_LIFT_ARTIFACT_PAIR_MAX_DECODED_BYTES =
  STUDIO_LAYER_LIFT_ARTIFACT_MAX_DECODED_BYTES * 2;

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const PNG_IHDR_LENGTH = 13;
const PNG_MINIMUM_BYTES = 57;
const PNG_MAXIMUM_CHUNKS = 4_096;
const ARTIFACT_ID_MAXIMUM_LENGTH = 160;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

const SUPPORTED_CRITICAL_CHUNKS = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);
const APNG_CHUNKS = new Set(["acTL", "fcTL", "fdAT"]);

export type StudioLayerLiftArtifactRole = "background" | "foreground";

export interface StudioLayerLiftArtifactLimits {
  readonly maximumAxisPixels: number;
  readonly maximumPixels: number;
  readonly maximumCompressedBytes: number;
  readonly maximumDecodedBytes: number;
  readonly maximumPairPixels: number;
  readonly maximumPairCompressedBytes: number;
  readonly maximumPairDecodedBytes: number;
}

export const STUDIO_LAYER_LIFT_ARTIFACT_LIMITS: StudioLayerLiftArtifactLimits =
  Object.freeze({
    maximumAxisPixels: STUDIO_LAYER_LIFT_ARTIFACT_MAX_AXIS_PIXELS,
    maximumPixels: STUDIO_LAYER_LIFT_ARTIFACT_MAX_PIXELS,
    maximumCompressedBytes:
      STUDIO_LAYER_LIFT_ARTIFACT_MAX_COMPRESSED_BYTES,
    maximumDecodedBytes: STUDIO_LAYER_LIFT_ARTIFACT_MAX_DECODED_BYTES,
    maximumPairPixels: STUDIO_LAYER_LIFT_ARTIFACT_PAIR_MAX_PIXELS,
    maximumPairCompressedBytes:
      STUDIO_LAYER_LIFT_ARTIFACT_PAIR_MAX_COMPRESSED_BYTES,
    maximumPairDecodedBytes:
      STUDIO_LAYER_LIFT_ARTIFACT_PAIR_MAX_DECODED_BYTES,
  });

export interface StudioLayerLiftArtifactCandidate {
  readonly outputId: string;
  /**
   * The validator snapshots this data before its first asynchronous decode.
   * Worker callers should use the worker client instead when they want
   * zero-copy ownership transfer across the trust boundary.
   */
  readonly bytes: ArrayBuffer | Uint8Array<ArrayBuffer>;
}

export interface StudioLayerLiftArtifactPairInput {
  readonly requestId: string;
  readonly sourceId: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly background: StudioLayerLiftArtifactCandidate;
  readonly foreground: StudioLayerLiftArtifactCandidate;
}

export interface StudioLayerLiftDecodedPngDimensions {
  readonly width: number;
  readonly height: number;
}

export type StudioLayerLiftPngDecoder = (
  bytes: Uint8Array<ArrayBuffer>,
  signal: AbortSignal | undefined,
) => Promise<StudioLayerLiftDecodedPngDimensions>;

export interface StudioLayerLiftArtifactValidationOptions {
  readonly signal?: AbortSignal;
  /**
   * Tests and non-DOM runtimes inject a deterministic decoder here. Production
   * chooses ImageDecoder first and createImageBitmap second.
   */
  readonly decodePngDimensions?: StudioLayerLiftPngDecoder;
  /**
   * Callers may only tighten the production limits. This seam keeps boundary
   * tests small without permitting a relaxed production admission policy.
   */
  readonly limits?: Partial<StudioLayerLiftArtifactLimits>;
}

export type StudioLayerLiftArtifactErrorCode =
  | "aborted"
  | "budget-exceeded"
  | "decode-failed"
  | "decode-unavailable"
  | "dimension-mismatch"
  | "invalid-input"
  | "invalid-png"
  | "receipt-mismatch";

export class StudioLayerLiftArtifactError extends Error {
  readonly code: StudioLayerLiftArtifactErrorCode;

  constructor(code: StudioLayerLiftArtifactErrorCode, message: string) {
    super(message);
    this.name = "StudioLayerLiftArtifactError";
    this.code = code;
  }
}

export interface StudioLayerLiftPngArtifactReceipt {
  readonly outputId: string;
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly byteLength: number;
  readonly decodedByteLength: number;
  readonly sha256: `sha256:${string}`;
}

export interface StudioLayerLiftArtifactPairReceipt {
  readonly kind: typeof STUDIO_LAYER_LIFT_ARTIFACT_KIND;
  readonly version: typeof STUDIO_LAYER_LIFT_ARTIFACT_VERSION;
  readonly requestId: string;
  readonly sourceId: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly background: StudioLayerLiftPngArtifactReceipt;
  readonly foreground: StudioLayerLiftPngArtifactReceipt;
  readonly aggregatePixelCount: number;
  readonly aggregateByteLength: number;
  readonly aggregateDecodedByteLength: number;
  readonly receiptSha256: `sha256:${string}`;
}

export interface StudioLayerLiftTrustedPngArtifact
  extends StudioLayerLiftPngArtifactReceipt {
  /**
   * This buffer is exclusively owned by the result. Mutating it invalidates
   * the associated receipt.
   */
  readonly bytes: ArrayBuffer;
}

export interface StudioLayerLiftTrustedArtifactPair {
  readonly receipt: StudioLayerLiftArtifactPairReceipt;
  readonly background: StudioLayerLiftTrustedPngArtifact;
  readonly foreground: StudioLayerLiftTrustedPngArtifact;
}

const trustedStudioLayerLiftArtifactPairs = new WeakSet<object>();

/**
 * Narrows only artifact-pair identities issued by this module's admission
 * boundaries. Structural equality, freezing, or cloning cannot manufacture
 * runtime trust.
 */
export function isStudioLayerLiftTrustedArtifactPair(
  value: unknown,
): value is StudioLayerLiftTrustedArtifactPair {
  return (
    typeof value === "object" &&
    value !== null &&
    trustedStudioLayerLiftArtifactPairs.has(value)
  );
}

export interface StudioLayerLiftArtifactReceiptVerificationInput {
  readonly requestId: string;
  readonly sourceId: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly backgroundOutputId: string;
  readonly foregroundOutputId: string;
  readonly receipt: unknown;
  readonly backgroundBytes: ArrayBuffer;
  readonly foregroundBytes: ArrayBuffer;
}

interface ParsedPng {
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly decodedByteLength: number;
}

interface SnapshottedCandidate {
  readonly outputId: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

interface PreflightCandidate {
  readonly outputId: string;
  readonly bytes: ArrayBuffer | Uint8Array<ArrayBuffer>;
  readonly byteLength: number;
}

interface PreflightInput {
  readonly requestId: string;
  readonly sourceId: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly background: PreflightCandidate;
  readonly foreground: PreflightCandidate;
}

interface SnapshottedInput {
  readonly requestId: string;
  readonly sourceId: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly background: SnapshottedCandidate;
  readonly foreground: SnapshottedCandidate;
}

interface StructuralImageDecoder {
  readonly tracks: {
    readonly ready: Promise<void>;
  };
  decode(options?: {
    readonly frameIndex?: number;
    readonly completeFramesOnly?: boolean;
  }): Promise<{
    readonly image: {
      readonly displayWidth?: number;
      readonly displayHeight?: number;
      readonly codedWidth?: number;
      readonly codedHeight?: number;
      close(): void;
    };
  }>;
  close(): void;
}

interface StructuralImageDecoderConstructor {
  new (options: {
    readonly data: BufferSource;
    readonly type: string;
  }): StructuralImageDecoder;
}

interface StructuralImageBitmap {
  readonly width: number;
  readonly height: number;
  close(): void;
}

interface DecoderEnvironment {
  readonly ImageDecoder?: StructuralImageDecoderConstructor;
  readonly createImageBitmap?: (
    image: Blob,
  ) => Promise<StructuralImageBitmap>;
}

function hasOwnDataProperties(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.length ||
    ownKeys.some(
      (key) => typeof key !== "string" || !expectedKeys.includes(key),
    )
  ) {
    return false;
  }

  return expectedKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor !== undefined &&
      Object.prototype.hasOwnProperty.call(descriptor, "value")
    );
  });
}

function isArtifactId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= ARTIFACT_ID_MAXIMUM_LENGTH &&
    value === value.normalize("NFC") &&
    !hasAsciiControlCharacters(value) &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\")
  );
}

function hasAsciiControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isOwnedArrayBuffer(value: unknown): value is ArrayBuffer {
  return (
    value instanceof ArrayBuffer &&
    Object.prototype.toString.call(value) === "[object ArrayBuffer]"
  );
}

function isFullOwnedUint8Array(
  value: unknown,
): value is Uint8Array<ArrayBuffer> {
  return (
    value instanceof Uint8Array &&
    isOwnedArrayBuffer(value.buffer) &&
    value.byteOffset === 0 &&
    value.byteLength === value.buffer.byteLength
  );
}

function snapshotBytes(
  value: ArrayBuffer | Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  if (isOwnedArrayBuffer(value)) {
    return Uint8Array.from(new Uint8Array(value));
  }
  if (isFullOwnedUint8Array(value)) {
    return Uint8Array.from(value);
  }

  throw new StudioLayerLiftArtifactError(
    "invalid-input",
    "Artifact bytes must be an owned ArrayBuffer or a full Uint8Array view.",
  );
}

function preflightCandidate(
  value: unknown,
  role: StudioLayerLiftArtifactRole,
  limits: StudioLayerLiftArtifactLimits,
): PreflightCandidate {
  if (!hasOwnDataProperties(value, ["outputId", "bytes"])) {
    throw new StudioLayerLiftArtifactError(
      "invalid-input",
      `${role} artifact candidate has an invalid shape.`,
    );
  }
  if (!isArtifactId(value.outputId)) {
    throw new StudioLayerLiftArtifactError(
      "invalid-input",
      `${role} outputId is invalid.`,
    );
  }
  const bytes = value.bytes;
  if (!isOwnedArrayBuffer(bytes) && !isFullOwnedUint8Array(bytes)) {
    throw new StudioLayerLiftArtifactError(
      "invalid-input",
      `${role} bytes must be an owned ArrayBuffer or a full Uint8Array view.`,
    );
  }
  if (bytes.byteLength > limits.maximumCompressedBytes) {
    throw new StudioLayerLiftArtifactError(
      "budget-exceeded",
      `${role} PNG exceeds the compressed-byte budget.`,
    );
  }
  return Object.freeze({
    outputId: value.outputId,
    bytes,
    byteLength: bytes.byteLength,
  });
}

function preflightInput(
  value: unknown,
  limits: StudioLayerLiftArtifactLimits,
): PreflightInput {
  if (
    !hasOwnDataProperties(value, [
      "requestId",
      "sourceId",
      "sourceWidth",
      "sourceHeight",
      "background",
      "foreground",
    ])
  ) {
    throw new StudioLayerLiftArtifactError(
      "invalid-input",
      "Layer-lift artifact input has an invalid shape.",
    );
  }
  if (!isArtifactId(value.requestId) || !isArtifactId(value.sourceId)) {
    throw new StudioLayerLiftArtifactError(
      "invalid-input",
      "Layer-lift requestId or sourceId is invalid.",
    );
  }
  if (
    !isPositiveSafeInteger(value.sourceWidth) ||
    !isPositiveSafeInteger(value.sourceHeight)
  ) {
    throw new StudioLayerLiftArtifactError(
      "invalid-input",
      "Layer-lift source dimensions must be positive safe integers.",
    );
  }
  const sourceBudget = validateSourceDimensions(
    value.sourceWidth,
    value.sourceHeight,
    limits,
  );

  const background = preflightCandidate(value.background, "background", limits);
  const foreground = preflightCandidate(value.foreground, "foreground", limits);
  if (background.outputId === foreground.outputId) {
    throw new StudioLayerLiftArtifactError(
      "invalid-input",
      "Layer-lift output IDs must be distinct.",
    );
  }
  if (
    background.byteLength + foreground.byteLength
      > limits.maximumPairCompressedBytes
    || sourceBudget.pixelCount * 2 > limits.maximumPairPixels
    || sourceBudget.decodedByteLength * 2
      > limits.maximumPairDecodedBytes
  ) {
    throw new StudioLayerLiftArtifactError(
      "budget-exceeded",
      "Layer-lift artifact pair exceeds its aggregate budget.",
    );
  }

  return Object.freeze({
    requestId: value.requestId,
    sourceId: value.sourceId,
    sourceWidth: value.sourceWidth,
    sourceHeight: value.sourceHeight,
    background,
    foreground,
  });
}

function snapshotInput(input: PreflightInput): SnapshottedInput {
  return Object.freeze({
    requestId: input.requestId,
    sourceId: input.sourceId,
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    background: Object.freeze({
      outputId: input.background.outputId,
      bytes: snapshotBytes(input.background.bytes),
    }),
    foreground: Object.freeze({
      outputId: input.foreground.outputId,
      bytes: snapshotBytes(input.foreground.bytes),
    }),
  });
}

function resolveLimits(
  overrides: Partial<StudioLayerLiftArtifactLimits> | undefined,
): StudioLayerLiftArtifactLimits {
  if (overrides === undefined) {
    return STUDIO_LAYER_LIFT_ARTIFACT_LIMITS;
  }

  const result = { ...STUDIO_LAYER_LIFT_ARTIFACT_LIMITS };
  for (const key of Object.keys(result) as Array<
    keyof StudioLayerLiftArtifactLimits
  >) {
    const override = overrides[key];
    if (override === undefined) {
      continue;
    }
    const productionMaximum = STUDIO_LAYER_LIFT_ARTIFACT_LIMITS[key];
    if (
      !Number.isSafeInteger(override) ||
      override <= 0 ||
      override > productionMaximum
    ) {
      throw new StudioLayerLiftArtifactError(
        "invalid-input",
        `${key} may only tighten its production maximum.`,
      );
    }
    result[key] = override;
  }

  return Object.freeze(result);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new StudioLayerLiftArtifactError(
      "aborted",
      "Layer-lift artifact admission was aborted.",
    );
  }
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! * 0x1000000 +
      bytes[offset + 1]! * 0x10000 +
      bytes[offset + 2]! * 0x100 +
      bytes[offset + 3]!) >>>
    0
  );
}

function decodeAsciiChunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!,
  );
}

function isValidPngBitDepth(colorType: number, bitDepth: number): boolean {
  switch (colorType) {
    case 0:
      return (
        bitDepth === 1 ||
        bitDepth === 2 ||
        bitDepth === 4 ||
        bitDepth === 8 ||
        bitDepth === 16
      );
    case 2:
    case 4:
    case 6:
      return bitDepth === 8 || bitDepth === 16;
    case 3:
      return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8;
    default:
      return false;
  }
}

function validateSourceDimensions(
  width: number,
  height: number,
  limits: StudioLayerLiftArtifactLimits,
): { readonly pixelCount: number; readonly decodedByteLength: number } {
  if (
    width > limits.maximumAxisPixels ||
    height > limits.maximumAxisPixels
  ) {
    throw new StudioLayerLiftArtifactError(
      "budget-exceeded",
      "Layer-lift source dimensions exceed the axis budget.",
    );
  }

  const pixelCount = width * height;
  const decodedByteLength = pixelCount * 4;
  if (
    !Number.isSafeInteger(pixelCount) ||
    pixelCount > limits.maximumPixels ||
    decodedByteLength > limits.maximumDecodedBytes
  ) {
    throw new StudioLayerLiftArtifactError(
      "budget-exceeded",
      "Layer-lift source dimensions exceed the decoded image budget.",
    );
  }

  return Object.freeze({ pixelCount, decodedByteLength });
}

function parsePng(
  bytes: Uint8Array<ArrayBuffer>,
  role: StudioLayerLiftArtifactRole,
  expectedWidth: number,
  expectedHeight: number,
  limits: StudioLayerLiftArtifactLimits,
  signal: AbortSignal | undefined,
): ParsedPng {
  throwIfAborted(signal);
  if (
    bytes.byteLength < PNG_MINIMUM_BYTES ||
    bytes.byteLength > limits.maximumCompressedBytes
  ) {
    throw new StudioLayerLiftArtifactError(
      bytes.byteLength > limits.maximumCompressedBytes
        ? "budget-exceeded"
        : "invalid-png",
      `${role} PNG has an invalid compressed byte length.`,
    );
  }

  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) {
      throw new StudioLayerLiftArtifactError(
        "invalid-png",
        `${role} artifact does not have a PNG signature.`,
      );
    }
  }

  let offset = PNG_SIGNATURE.length;
  let chunkCount = 0;
  let width = 0;
  let height = 0;
  let sawIhdr = false;
  let sawPlte = false;
  let sawIdat = false;
  let leftIdatSequence = false;
  let idatByteLength = 0;
  let sawIend = false;
  let colorType = -1;
  let bitDepth = -1;

  while (offset < bytes.byteLength) {
    throwIfAborted(signal);
    chunkCount += 1;
    if (chunkCount > PNG_MAXIMUM_CHUNKS || offset + 12 > bytes.byteLength) {
      throw new StudioLayerLiftArtifactError(
        "invalid-png",
        `${role} PNG has an invalid chunk envelope.`,
      );
    }

    const chunkLength = readUint32(bytes, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + chunkLength;
    const chunkEnd = dataEnd + 4;
    if (
      chunkLength > bytes.byteLength ||
      dataEnd < dataOffset ||
      chunkEnd < dataEnd ||
      chunkEnd > bytes.byteLength
    ) {
      throw new StudioLayerLiftArtifactError(
        "invalid-png",
        `${role} PNG contains an out-of-bounds chunk.`,
      );
    }

    for (let index = typeOffset; index < typeOffset + 4; index += 1) {
      const code = bytes[index]!;
      const isAsciiLetter =
        (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
      if (!isAsciiLetter) {
        throw new StudioLayerLiftArtifactError(
          "invalid-png",
          `${role} PNG contains an invalid chunk type.`,
        );
      }
    }
    if ((bytes[typeOffset + 2]! & 0x20) !== 0) {
      throw new StudioLayerLiftArtifactError(
        "invalid-png",
        `${role} PNG contains a chunk with an invalid reserved bit.`,
      );
    }

    const type = decodeAsciiChunkType(bytes, typeOffset);
    const isCritical = (bytes[typeOffset]! & 0x20) === 0;
    if (isCritical && !SUPPORTED_CRITICAL_CHUNKS.has(type)) {
      throw new StudioLayerLiftArtifactError(
        "invalid-png",
        `${role} PNG contains an unsupported critical chunk.`,
      );
    }
    if (APNG_CHUNKS.has(type)) {
      throw new StudioLayerLiftArtifactError(
        "invalid-png",
        `${role} artifact must be a still PNG, not APNG.`,
      );
    }

    const expectedCrc = readUint32(bytes, dataEnd);
    const actualCrc = calculateStudioCrc32(
      bytes.subarray(typeOffset, dataEnd),
    );
    if (expectedCrc !== actualCrc) {
      throw new StudioLayerLiftArtifactError(
        "invalid-png",
        `${role} PNG chunk CRC does not match its bytes.`,
      );
    }

    if (chunkCount === 1 && type !== "IHDR") {
      throw new StudioLayerLiftArtifactError(
        "invalid-png",
        `${role} PNG must begin with IHDR.`,
      );
    }

    if (type === "IHDR") {
      if (sawIhdr || chunkLength !== PNG_IHDR_LENGTH) {
        throw new StudioLayerLiftArtifactError(
          "invalid-png",
          `${role} PNG has an invalid IHDR chunk.`,
        );
      }
      sawIhdr = true;
      width = readUint32(bytes, dataOffset);
      height = readUint32(bytes, dataOffset + 4);
      bitDepth = bytes[dataOffset + 8]!;
      colorType = bytes[dataOffset + 9]!;
      const compressionMethod = bytes[dataOffset + 10]!;
      const filterMethod = bytes[dataOffset + 11]!;
      const interlaceMethod = bytes[dataOffset + 12]!;
      if (
        width === 0 ||
        height === 0 ||
        !isValidPngBitDepth(colorType, bitDepth) ||
        compressionMethod !== 0 ||
        filterMethod !== 0 ||
        (interlaceMethod !== 0 && interlaceMethod !== 1)
      ) {
        throw new StudioLayerLiftArtifactError(
          "invalid-png",
          `${role} PNG has an unsupported IHDR profile.`,
        );
      }
      if (width !== expectedWidth || height !== expectedHeight) {
        throw new StudioLayerLiftArtifactError(
          "dimension-mismatch",
          `${role} PNG dimensions do not match the bound source dimensions.`,
        );
      }
      validateSourceDimensions(width, height, limits);
    } else if (!sawIhdr) {
      throw new StudioLayerLiftArtifactError(
        "invalid-png",
        `${role} PNG is missing IHDR.`,
      );
    } else if (type === "PLTE") {
      if (
        sawPlte ||
        sawIdat ||
        chunkLength === 0 ||
        chunkLength > 768 ||
        chunkLength % 3 !== 0 ||
        colorType === 0 ||
        colorType === 4
      ) {
        throw new StudioLayerLiftArtifactError(
          "invalid-png",
          `${role} PNG has an invalid PLTE chunk.`,
        );
      }
      sawPlte = true;
      if (colorType === 3 && chunkLength / 3 > 2 ** bitDepth) {
        throw new StudioLayerLiftArtifactError(
          "invalid-png",
          `${role} PNG palette exceeds its bit-depth capacity.`,
        );
      }
    } else if (type === "IDAT") {
      if (leftIdatSequence || (colorType === 3 && !sawPlte)) {
        throw new StudioLayerLiftArtifactError(
          "invalid-png",
          `${role} PNG has an invalid IDAT sequence.`,
        );
      }
      sawIdat = true;
      idatByteLength += chunkLength;
      if (!Number.isSafeInteger(idatByteLength)) {
        throw new StudioLayerLiftArtifactError(
          "invalid-png",
          `${role} PNG IDAT length is invalid.`,
        );
      }
    } else if (sawIdat) {
      leftIdatSequence = true;
    }

    if (type === "IEND") {
      if (
        sawIend ||
        chunkLength !== 0 ||
        !sawIdat ||
        idatByteLength === 0 ||
        chunkEnd !== bytes.byteLength
      ) {
        throw new StudioLayerLiftArtifactError(
          "invalid-png",
          `${role} PNG has an invalid IEND boundary.`,
        );
      }
      sawIend = true;
    }

    offset = chunkEnd;
    if (sawIend) {
      break;
    }
  }

  if (!sawIhdr || !sawIdat || !sawIend || offset !== bytes.byteLength) {
    throw new StudioLayerLiftArtifactError(
      "invalid-png",
      `${role} PNG is incomplete.`,
    );
  }

  const { pixelCount, decodedByteLength } = validateSourceDimensions(
    width,
    height,
    limits,
  );
  return Object.freeze({
    width,
    height,
    pixelCount,
    decodedByteLength,
  });
}

function isAbortLike(error: unknown): boolean {
  if (error instanceof StudioLayerLiftArtifactError) {
    return error.code === "aborted";
  }
  if (
    typeof DOMException === "function" &&
    error instanceof DOMException
  ) {
    return error.name === "AbortError";
  }
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function awaitWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  throwIfAborted(signal);

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      reject(
        new StudioLayerLiftArtifactError(
          "aborted",
          "Layer-lift artifact admission was aborted.",
        ),
      );
    };

    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function decodeWithImageDecoder(
  ImageDecoderConstructor: StructuralImageDecoderConstructor,
  bytes: Uint8Array<ArrayBuffer>,
  signal: AbortSignal | undefined,
): Promise<StudioLayerLiftDecodedPngDimensions> {
  const decoder = new ImageDecoderConstructor({
    data: bytes,
    type: "image/png",
  });
  let image:
    | Awaited<ReturnType<StructuralImageDecoder["decode"]>>["image"]
    | undefined;
  try {
    await awaitWithAbort(decoder.tracks.ready, signal);
    const decoded = await awaitWithAbort(
      decoder.decode({ frameIndex: 0, completeFramesOnly: true }),
      signal,
    );
    image = decoded.image;
    const width = image.displayWidth ?? image.codedWidth;
    const height = image.displayHeight ?? image.codedHeight;
    if (!isPositiveSafeInteger(width) || !isPositiveSafeInteger(height)) {
      throw new StudioLayerLiftArtifactError(
        "decode-failed",
        "ImageDecoder returned invalid PNG dimensions.",
      );
    }
    return Object.freeze({ width, height });
  } finally {
    image?.close();
    decoder.close();
  }
}

async function decodeWithImageBitmap(
  createImageBitmapFunction: NonNullable<
    DecoderEnvironment["createImageBitmap"]
  >,
  bytes: Uint8Array<ArrayBuffer>,
  signal: AbortSignal | undefined,
): Promise<StudioLayerLiftDecodedPngDimensions> {
  const immutableBytes = Uint8Array.from(bytes);
  const bitmapPromise = createImageBitmapFunction(
    new Blob([immutableBytes], { type: "image/png" }),
  );
  if (signal !== undefined) {
    // Observe both branches: a rejection is already mapped by the awaited original promise, but
    // an unhandled rejection from this late-close side chain would still surface globally.
    void bitmapPromise.then(
      (lateBitmap) => {
        if (signal.aborted) {
          lateBitmap.close();
        }
      },
      () => undefined,
    );
  }
  const bitmap = await awaitWithAbort(bitmapPromise, signal);
  try {
    if (
      !isPositiveSafeInteger(bitmap.width) ||
      !isPositiveSafeInteger(bitmap.height)
    ) {
      throw new StudioLayerLiftArtifactError(
        "decode-failed",
        "createImageBitmap returned invalid PNG dimensions.",
      );
    }
    return Object.freeze({ width: bitmap.width, height: bitmap.height });
  } finally {
    bitmap.close();
  }
}

export async function decodeStudioLayerLiftPngDimensions(
  bytes: Uint8Array<ArrayBuffer>,
  signal: AbortSignal | undefined,
): Promise<StudioLayerLiftDecodedPngDimensions> {
  throwIfAborted(signal);
  const environment = globalThis as unknown as DecoderEnvironment;
  try {
    if (typeof environment.ImageDecoder === "function") {
      return await decodeWithImageDecoder(
        environment.ImageDecoder,
        bytes,
        signal,
      );
    }
    if (typeof environment.createImageBitmap === "function") {
      return await decodeWithImageBitmap(
        environment.createImageBitmap,
        bytes,
        signal,
      );
    }
  } catch (error) {
    if (isAbortLike(error)) {
      throw new StudioLayerLiftArtifactError(
        "aborted",
        "Layer-lift artifact admission was aborted.",
      );
    }
    if (error instanceof StudioLayerLiftArtifactError) {
      throw error;
    }
    throw new StudioLayerLiftArtifactError(
      "decode-failed",
      "The runtime PNG decoder rejected the layer-lift artifact.",
    );
  }

  throw new StudioLayerLiftArtifactError(
    "decode-unavailable",
    "This runtime has neither ImageDecoder nor createImageBitmap.",
  );
}

function sha256(bytes: Uint8Array<ArrayBuffer>): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

async function sha256WithoutBlockingUi(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<`sha256:${string}`> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== "function") {
    // Non-browser test/legacy runtimes retain a deterministic fallback. Production browsers use
    // WebCrypto so an 8 MiB receipt verification cannot monopolize the UI thread.
    return sha256(bytes);
  }
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const value of digest) {
    hex += value.toString(16).padStart(2, "0");
  }
  return `sha256:${hex}`;
}

function receiptBindingText(
  receipt: Omit<StudioLayerLiftArtifactPairReceipt, "receiptSha256">,
): string {
  const background = receipt.background;
  const foreground = receipt.foreground;
  return [
    receipt.kind,
    String(receipt.version),
    receipt.requestId,
    receipt.sourceId,
    String(receipt.sourceWidth),
    String(receipt.sourceHeight),
    background.outputId,
    String(background.width),
    String(background.height),
    String(background.pixelCount),
    String(background.byteLength),
    String(background.decodedByteLength),
    background.sha256,
    foreground.outputId,
    String(foreground.width),
    String(foreground.height),
    String(foreground.pixelCount),
    String(foreground.byteLength),
    String(foreground.decodedByteLength),
    foreground.sha256,
    String(receipt.aggregatePixelCount),
    String(receipt.aggregateByteLength),
    String(receipt.aggregateDecodedByteLength),
  ].join("\u0000");
}

function createReceipt(
  input: Pick<
    SnapshottedInput,
    "requestId" | "sourceId" | "sourceWidth" | "sourceHeight"
  >,
  background: StudioLayerLiftPngArtifactReceipt,
  foreground: StudioLayerLiftPngArtifactReceipt,
): StudioLayerLiftArtifactPairReceipt {
  const unsignedReceipt = Object.freeze({
    kind: STUDIO_LAYER_LIFT_ARTIFACT_KIND,
    version: STUDIO_LAYER_LIFT_ARTIFACT_VERSION,
    requestId: input.requestId,
    sourceId: input.sourceId,
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    background,
    foreground,
    aggregatePixelCount: background.pixelCount + foreground.pixelCount,
    aggregateByteLength: background.byteLength + foreground.byteLength,
    aggregateDecodedByteLength:
      background.decodedByteLength + foreground.decodedByteLength,
  });
  const receiptSha256 = sha256(
    new TextEncoder().encode(receiptBindingText(unsignedReceipt)),
  );
  return Object.freeze({ ...unsignedReceipt, receiptSha256 });
}

function createArtifactReceipt(
  outputId: string,
  parsed: ParsedPng,
  bytes: Uint8Array<ArrayBuffer>,
): StudioLayerLiftPngArtifactReceipt {
  return Object.freeze({
    outputId,
    width: parsed.width,
    height: parsed.height,
    pixelCount: parsed.pixelCount,
    byteLength: bytes.byteLength,
    decodedByteLength: parsed.decodedByteLength,
    sha256: sha256(bytes),
  });
}

function assertDecodedDimensions(
  role: StudioLayerLiftArtifactRole,
  decoded: StudioLayerLiftDecodedPngDimensions,
  expectedWidth: number,
  expectedHeight: number,
): void {
  if (
    !isPositiveSafeInteger(decoded.width) ||
    !isPositiveSafeInteger(decoded.height) ||
    decoded.width !== expectedWidth ||
    decoded.height !== expectedHeight
  ) {
    throw new StudioLayerLiftArtifactError(
      "dimension-mismatch",
      `${role} decoded PNG dimensions do not match the bound source dimensions.`,
    );
  }
}

export async function admitStudioLayerLiftArtifactPair(
  input: StudioLayerLiftArtifactPairInput,
  options: StudioLayerLiftArtifactValidationOptions = {},
): Promise<StudioLayerLiftTrustedArtifactPair> {
  throwIfAborted(options.signal);
  const limits = resolveLimits(options.limits);
  // Reject hostile dimensions and byte lengths before making either full-buffer snapshot.
  const snapshot = snapshotInput(preflightInput(input, limits));

  const backgroundParsed = parsePng(
    snapshot.background.bytes,
    "background",
    snapshot.sourceWidth,
    snapshot.sourceHeight,
    limits,
    options.signal,
  );
  const foregroundParsed = parsePng(
    snapshot.foreground.bytes,
    "foreground",
    snapshot.sourceWidth,
    snapshot.sourceHeight,
    limits,
    options.signal,
  );

  const decodePngDimensions =
    options.decodePngDimensions ?? decodeStudioLayerLiftPngDimensions;
  try {
    const backgroundDecoded = await awaitWithAbort(
      Promise.resolve().then(() =>
        decodePngDimensions(snapshot.background.bytes, options.signal),
      ),
      options.signal,
    );
    throwIfAborted(options.signal);
    assertDecodedDimensions(
      "background",
      backgroundDecoded,
      snapshot.sourceWidth,
      snapshot.sourceHeight,
    );

    const foregroundDecoded = await awaitWithAbort(
      Promise.resolve().then(() =>
        decodePngDimensions(snapshot.foreground.bytes, options.signal),
      ),
      options.signal,
    );
    throwIfAborted(options.signal);
    assertDecodedDimensions(
      "foreground",
      foregroundDecoded,
      snapshot.sourceWidth,
      snapshot.sourceHeight,
    );
  } catch (error) {
    if (error instanceof StudioLayerLiftArtifactError) {
      throw error;
    }
    if (isAbortLike(error) || options.signal?.aborted) {
      throw new StudioLayerLiftArtifactError(
        "aborted",
        "Layer-lift artifact admission was aborted.",
      );
    }
    throw new StudioLayerLiftArtifactError(
      "decode-failed",
      "The runtime PNG decoder rejected a layer-lift artifact.",
    );
  }

  throwIfAborted(options.signal);
  const backgroundReceipt = createArtifactReceipt(
    snapshot.background.outputId,
    backgroundParsed,
    snapshot.background.bytes,
  );
  throwIfAborted(options.signal);
  const foregroundReceipt = createArtifactReceipt(
    snapshot.foreground.outputId,
    foregroundParsed,
    snapshot.foreground.bytes,
  );
  const receipt = createReceipt(
    snapshot,
    backgroundReceipt,
    foregroundReceipt,
  );

  const backgroundBytes = snapshot.background.bytes.buffer;
  const foregroundBytes = snapshot.foreground.bytes.buffer;
  const pair = Object.freeze({
    receipt,
    background: Object.freeze({ ...backgroundReceipt, bytes: backgroundBytes }),
    foreground: Object.freeze({ ...foregroundReceipt, bytes: foregroundBytes }),
  });
  trustedStudioLayerLiftArtifactPairs.add(pair);
  return pair;
}

function isPngArtifactReceipt(
  value: unknown,
  expectedOutputId: string,
  expectedWidth: number,
  expectedHeight: number,
  expectedByteLength: number,
): value is StudioLayerLiftPngArtifactReceipt {
  if (
    !hasOwnDataProperties(value, [
      "outputId",
      "width",
      "height",
      "pixelCount",
      "byteLength",
      "decodedByteLength",
      "sha256",
    ])
  ) {
    return false;
  }

  const pixelCount = expectedWidth * expectedHeight;
  return (
    value.outputId === expectedOutputId &&
    value.width === expectedWidth &&
    value.height === expectedHeight &&
    value.pixelCount === pixelCount &&
    value.byteLength === expectedByteLength &&
    value.decodedByteLength === pixelCount * 4 &&
    typeof value.sha256 === "string" &&
    SHA256_PATTERN.test(value.sha256)
  );
}

function parseReceipt(
  value: unknown,
  input: Omit<StudioLayerLiftArtifactReceiptVerificationInput, "receipt">,
): StudioLayerLiftArtifactPairReceipt {
  if (
    !hasOwnDataProperties(value, [
      "kind",
      "version",
      "requestId",
      "sourceId",
      "sourceWidth",
      "sourceHeight",
      "background",
      "foreground",
      "aggregatePixelCount",
      "aggregateByteLength",
      "aggregateDecodedByteLength",
      "receiptSha256",
    ])
  ) {
    throw new StudioLayerLiftArtifactError(
      "receipt-mismatch",
      "Layer-lift artifact receipt has an invalid shape.",
    );
  }

  if (
    value.kind !== STUDIO_LAYER_LIFT_ARTIFACT_KIND ||
    value.version !== STUDIO_LAYER_LIFT_ARTIFACT_VERSION ||
    value.requestId !== input.requestId ||
    value.sourceId !== input.sourceId ||
    value.sourceWidth !== input.sourceWidth ||
    value.sourceHeight !== input.sourceHeight ||
    !isPngArtifactReceipt(
      value.background,
      input.backgroundOutputId,
      input.sourceWidth,
      input.sourceHeight,
      input.backgroundBytes.byteLength,
    ) ||
    !isPngArtifactReceipt(
      value.foreground,
      input.foregroundOutputId,
      input.sourceWidth,
      input.sourceHeight,
      input.foregroundBytes.byteLength,
    ) ||
    value.aggregatePixelCount !== input.sourceWidth * input.sourceHeight * 2 ||
    value.aggregateByteLength !==
      input.backgroundBytes.byteLength + input.foregroundBytes.byteLength ||
    value.aggregateDecodedByteLength !==
      input.sourceWidth * input.sourceHeight * 8 ||
    typeof value.receiptSha256 !== "string" ||
    !SHA256_PATTERN.test(value.receiptSha256)
  ) {
    throw new StudioLayerLiftArtifactError(
      "receipt-mismatch",
      "Layer-lift artifact receipt is not bound to this request and output pair.",
    );
  }

  return value as unknown as StudioLayerLiftArtifactPairReceipt;
}

function freezeVerifiedReceipt(
  receipt: StudioLayerLiftArtifactPairReceipt,
): StudioLayerLiftArtifactPairReceipt {
  return Object.freeze({
    kind: receipt.kind,
    version: receipt.version,
    requestId: receipt.requestId,
    sourceId: receipt.sourceId,
    sourceWidth: receipt.sourceWidth,
    sourceHeight: receipt.sourceHeight,
    background: Object.freeze({ ...receipt.background }),
    foreground: Object.freeze({ ...receipt.foreground }),
    aggregatePixelCount: receipt.aggregatePixelCount,
    aggregateByteLength: receipt.aggregateByteLength,
    aggregateDecodedByteLength: receipt.aggregateDecodedByteLength,
    receiptSha256: receipt.receiptSha256,
  });
}

/**
 * Re-establishes trust after worker transfer by hashing the buffers that
 * actually arrived on the receiving side and checking the complete authority
 * binding. It deliberately does not decode again; decoding happened inside the
 * worker before the signed receipt was produced.
 */
export async function verifyStudioLayerLiftArtifactPairReceipt(
  input: StudioLayerLiftArtifactReceiptVerificationInput,
): Promise<StudioLayerLiftTrustedArtifactPair> {
  if (
    !isArtifactId(input.requestId) ||
    !isArtifactId(input.sourceId) ||
    !isArtifactId(input.backgroundOutputId) ||
    !isArtifactId(input.foregroundOutputId) ||
    input.backgroundOutputId === input.foregroundOutputId ||
    !isPositiveSafeInteger(input.sourceWidth) ||
    !isPositiveSafeInteger(input.sourceHeight) ||
    !isOwnedArrayBuffer(input.backgroundBytes) ||
    !isOwnedArrayBuffer(input.foregroundBytes)
  ) {
    throw new StudioLayerLiftArtifactError(
      "receipt-mismatch",
      "Layer-lift receipt verification authority is invalid.",
    );
  }

  const sourceBudget = validateSourceDimensions(
    input.sourceWidth,
    input.sourceHeight,
    STUDIO_LAYER_LIFT_ARTIFACT_LIMITS,
  );
  if (
    input.backgroundBytes.byteLength
      > STUDIO_LAYER_LIFT_ARTIFACT_MAX_COMPRESSED_BYTES
    || input.foregroundBytes.byteLength
      > STUDIO_LAYER_LIFT_ARTIFACT_MAX_COMPRESSED_BYTES
    || input.backgroundBytes.byteLength + input.foregroundBytes.byteLength
      > STUDIO_LAYER_LIFT_ARTIFACT_PAIR_MAX_COMPRESSED_BYTES
    || sourceBudget.pixelCount * 2
      > STUDIO_LAYER_LIFT_ARTIFACT_PAIR_MAX_PIXELS
    || sourceBudget.decodedByteLength * 2
      > STUDIO_LAYER_LIFT_ARTIFACT_PAIR_MAX_DECODED_BYTES
  ) {
    throw new StudioLayerLiftArtifactError(
      "budget-exceeded",
      "Layer-lift receipt verification exceeds the artifact pair budget.",
    );
  }

  // structuredClone does not preserve Object.freeze. Snapshot the complete receipt before the
  // first await and return only this product-owned deeply frozen copy.
  const receipt = freezeVerifiedReceipt(parseReceipt(input.receipt, input));
  // The caller still owns the buffers while Web Crypto yields. Snapshot them before the first
  // await so a same-length mutation cannot make the digest and the later PNG parse observe
  // different byte sequences. The returned pair exclusively owns these verified snapshots.
  const ownedBackgroundBuffer = ArrayBuffer.prototype.slice.call(
    input.backgroundBytes,
    0,
  ) as ArrayBuffer;
  const ownedForegroundBuffer = ArrayBuffer.prototype.slice.call(
    input.foregroundBytes,
    0,
  ) as ArrayBuffer;
  const backgroundBytes = new Uint8Array(ownedBackgroundBuffer);
  const foregroundBytes = new Uint8Array(ownedForegroundBuffer);
  const [backgroundSha256, foregroundSha256] = await Promise.all([
    sha256WithoutBlockingUi(backgroundBytes),
    sha256WithoutBlockingUi(foregroundBytes),
  ]);
  if (
    receipt.background.sha256 !== backgroundSha256 ||
    receipt.foreground.sha256 !== foregroundSha256
  ) {
    throw new StudioLayerLiftArtifactError(
      "receipt-mismatch",
      "Layer-lift artifact receipt hashes do not match the transferred bytes.",
    );
  }

  try {
    parsePng(
      backgroundBytes,
      "background",
      input.sourceWidth,
      input.sourceHeight,
      STUDIO_LAYER_LIFT_ARTIFACT_LIMITS,
      undefined,
    );
    parsePng(
      foregroundBytes,
      "foreground",
      input.sourceWidth,
      input.sourceHeight,
      STUDIO_LAYER_LIFT_ARTIFACT_LIMITS,
      undefined,
    );
  } catch {
    throw new StudioLayerLiftArtifactError(
      "receipt-mismatch",
      "Transferred layer-lift bytes no longer satisfy the PNG artifact boundary.",
    );
  }

  const unsignedReceipt = {
    kind: receipt.kind,
    version: receipt.version,
    requestId: receipt.requestId,
    sourceId: receipt.sourceId,
    sourceWidth: receipt.sourceWidth,
    sourceHeight: receipt.sourceHeight,
    background: receipt.background,
    foreground: receipt.foreground,
    aggregatePixelCount: receipt.aggregatePixelCount,
    aggregateByteLength: receipt.aggregateByteLength,
    aggregateDecodedByteLength: receipt.aggregateDecodedByteLength,
  };
  const receiptSha256 = sha256(
    new TextEncoder().encode(receiptBindingText(unsignedReceipt)),
  );
  if (receipt.receiptSha256 !== receiptSha256) {
    throw new StudioLayerLiftArtifactError(
      "receipt-mismatch",
      "Layer-lift artifact receipt authority hash does not match.",
    );
  }

  const pair = Object.freeze({
    receipt,
    background: Object.freeze({
      ...receipt.background,
      bytes: ownedBackgroundBuffer,
    }),
    foreground: Object.freeze({
      ...receipt.foreground,
      bytes: ownedForegroundBuffer,
    }),
  });
  trustedStudioLayerLiftArtifactPairs.add(pair);
  return pair;
}
