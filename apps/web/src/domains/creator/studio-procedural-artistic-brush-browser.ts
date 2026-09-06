/**
 * Browser-only, lossless transport bridge for completed artistic-brush RGBA.
 *
 * This module owns no provider, Worker, canvas scene, document, history or
 * persistence state. It verifies the provider receipt before copying caller
 * pixels into a detached DOM canvas, encodes exactly `image/png`, validates the
 * returned PNG data URL and returns a non-authoritative insertion suggestion.
 */

import {
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS,
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION,
  type StudioProceduralArtisticBrushArtifact,
} from "./studio-procedural-artistic-brush-provider";

export const STUDIO_PROCEDURAL_ARTISTIC_BRUSH_BROWSER_REVISION = 1 as const;
export const STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PNG_ENCODE_WATCHDOG_MS =
  30_000 as const;

export const STUDIO_PROCEDURAL_ARTISTIC_BRUSH_BROWSER_LIMITS = Object.freeze({
  maxWidth: 4_096,
  maxHeight: 4_096,
  maxPixels: 16_777_216,
  maxRgbaBytes: 64 * 1_024 * 1_024,
  maxPngBlobBytes: 80 * 1_024 * 1_024,
  maxDataUrlCodeUnits:
    "data:image/png;base64,".length
    + Math.ceil((80 * 1_024 * 1_024) / 3) * 4,
} as const);

export interface StudioProceduralArtisticBrushBrowserLimits {
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly maxPixels?: number;
  readonly maxRgbaBytes?: number;
  readonly maxPngBlobBytes?: number;
  readonly maxDataUrlCodeUnits?: number;
}

export interface StudioProceduralArtisticBrushBrowserImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export interface StudioProceduralArtisticBrushBrowserContext {
  putImageData(
    imageData: StudioProceduralArtisticBrushBrowserImageData,
    x: number,
    y: number,
  ): void;
}

export interface StudioProceduralArtisticBrushBrowserCanvas {
  width: number;
  height: number;
  getContext(contextId: "2d"): StudioProceduralArtisticBrushBrowserContext | null;
  toBlob(
    callback: (
      blob: StudioProceduralArtisticBrushBrowserBlob | null,
    ) => void,
    type: "image/png",
  ): void;
}

export interface StudioProceduralArtisticBrushBrowserBlob {
  readonly size: number;
  readonly type: string;
}

export interface StudioProceduralArtisticBrushBrowserFileReader {
  result: string | ArrayBuffer | null;
  error: unknown;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  readAsDataURL(blob: StudioProceduralArtisticBrushBrowserBlob): void;
  abort(): void;
}

export type StudioProceduralArtisticBrushBrowserCanvasFactory = (
  width: number,
  height: number,
) => StudioProceduralArtisticBrushBrowserCanvas | null;

export type StudioProceduralArtisticBrushBrowserImageDataFactory = (
  pixels: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
) => StudioProceduralArtisticBrushBrowserImageData | null;

export type StudioProceduralArtisticBrushBrowserBlobGuard = (
  value: unknown,
) => value is StudioProceduralArtisticBrushBrowserBlob;

export type StudioProceduralArtisticBrushBrowserFileReaderFactory =
  () => StudioProceduralArtisticBrushBrowserFileReader | null;

export type StudioProceduralArtisticBrushBrowserBase64Decoder = (
  value: string,
) => Uint8Array | null;

export type StudioProceduralArtisticBrushBrowserSha256Digest = (
  bytes: Uint8Array<ArrayBuffer>,
) => Promise<`sha256:${string}`>;

export interface StudioProceduralArtisticBrushBrowserEnvironment {
  /** `null` disables the primitive; omission resolves the browser global. */
  readonly createCanvas?:
    | StudioProceduralArtisticBrushBrowserCanvasFactory
    | null;
  /** `null` disables the primitive; omission resolves global `ImageData`. */
  readonly createImageData?:
    | StudioProceduralArtisticBrushBrowserImageDataFactory
    | null;
  /** `null` disables Blob validation; omission resolves global `Blob`. */
  readonly isBlob?:
    | StudioProceduralArtisticBrushBrowserBlobGuard
    | null;
  /** `null` disables FileReader; omission resolves global `FileReader`. */
  readonly createFileReader?:
    | StudioProceduralArtisticBrushBrowserFileReaderFactory
    | null;
  /** Used only for the bounded PNG signature/IHDR prefix. */
  readonly decodeBase64?:
    | StudioProceduralArtisticBrushBrowserBase64Decoder
    | null;
  /**
   * Asynchronous SHA-256 primitive. `null` explicitly disables hashing;
   * omission resolves `crypto.subtle.digest("SHA-256", ...)`.
   */
  readonly digestSha256?:
    | StudioProceduralArtisticBrushBrowserSha256Digest
    | null;
}

export interface StudioProceduralArtisticBrushBrowserOptions {
  readonly signal?: AbortSignal;
  readonly environment?: StudioProceduralArtisticBrushBrowserEnvironment;
  readonly limits?: StudioProceduralArtisticBrushBrowserLimits;
}

export interface StudioProceduralArtisticBrushPngDataUrlArtifact {
  readonly kind:
    "studio-procedural-artistic-brush-browser/png-data-url-artifact";
  readonly version:
    typeof STUDIO_PROCEDURAL_ARTISTIC_BRUSH_BROWSER_REVISION;
  readonly width: number;
  readonly height: number;
  readonly mediaType: "image/png";
  readonly dataUrl: `data:image/png;base64,${string}`;
  readonly pngByteLength: number;
  readonly dataUrlCodeUnits: number;
  readonly source: Readonly<{
    readonly providerVersion:
      typeof STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION;
    readonly requestSequence: number;
    readonly engineEpoch: number;
    readonly strokeId: string;
    readonly pixelHash: `sha256:${string}`;
    readonly replayFingerprint: `sha256:${string}`;
  }>;
  readonly authority: Readonly<{
    readonly mainScene: false;
    readonly document: false;
    readonly history: false;
    readonly persistence: false;
    readonly output: "lossless-png-insertion-suggestion";
  }>;
}

export type StudioProceduralArtisticBrushBrowserFailureReason =
  | "invalid-options"
  | "invalid-artifact"
  | "budget-exceeded"
  | "digest-unavailable"
  | "pixel-hash-mismatch"
  | "aborted"
  | "canvas-unavailable"
  | "context-unavailable"
  | "image-data-unavailable"
  | "pixel-copy-mutated"
  | "png-encode-failed"
  | "blob-unavailable"
  | "file-reader-unavailable"
  | "png-read-failed"
  | "invalid-png-result";

export type StudioProceduralArtisticBrushBrowserResult =
  | Readonly<{
      readonly status: "completed";
      readonly consumed: false;
      readonly artifact: StudioProceduralArtisticBrushPngDataUrlArtifact;
    }>
  | Readonly<{
      readonly status: "rejected";
      readonly consumed: false;
      readonly reason: StudioProceduralArtisticBrushBrowserFailureReason;
      readonly detail: string;
    }>;

interface ResolvedLimits {
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxPixels: number;
  readonly maxRgbaBytes: number;
  readonly maxPngBlobBytes: number;
  readonly maxDataUrlCodeUnits: number;
}

interface ResolvedEnvironment {
  readonly createCanvas:
    | StudioProceduralArtisticBrushBrowserCanvasFactory
    | null;
  readonly createImageData:
    | StudioProceduralArtisticBrushBrowserImageDataFactory
    | null;
  readonly isBlob:
    | StudioProceduralArtisticBrushBrowserBlobGuard
    | null;
  readonly createFileReader:
    | StudioProceduralArtisticBrushBrowserFileReaderFactory
    | null;
  readonly decodeBase64:
    | StudioProceduralArtisticBrushBrowserBase64Decoder
    | null;
  readonly digestSha256:
    | StudioProceduralArtisticBrushBrowserSha256Digest
    | null;
}

interface NormalizedArtifact {
  readonly artifact: StudioProceduralArtisticBrushArtifact;
  readonly expectedRgbaBytes: number;
  readonly pixelHash: `sha256:${string}`;
}

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = Object.freeze([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
] as const);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const OPTION_KEYS = Object.freeze(["signal", "environment", "limits"]);
const ENVIRONMENT_KEYS = Object.freeze([
  "createCanvas",
  "createImageData",
  "isBlob",
  "createFileReader",
  "decodeBase64",
  "digestSha256",
]);
const LIMIT_KEYS = Object.freeze([
  "maxWidth",
  "maxHeight",
  "maxPixels",
  "maxRgbaBytes",
  "maxPngBlobBytes",
  "maxDataUrlCodeUnits",
]);
let productGlobalPngEncodeTail: Promise<void> = Promise.resolve();
let productGlobalPngEncodePoisoned = false;

class StudioProceduralArtisticBrushBrowserStop extends Error {
  constructor(
    readonly reason: StudioProceduralArtisticBrushBrowserFailureReason,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "StudioProceduralArtisticBrushBrowserStop";
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKnownKeys(
  value: Readonly<Record<string, unknown>>,
  known: readonly string[],
): boolean {
  return Object.keys(value).every((key) => known.includes(key));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0;
}

function reject(
  reason: StudioProceduralArtisticBrushBrowserFailureReason,
  detail: string,
): StudioProceduralArtisticBrushBrowserResult {
  return Object.freeze({
    status: "rejected",
    consumed: false,
    reason,
    detail: detail.slice(0, 512),
  });
}

function stop(
  reason: StudioProceduralArtisticBrushBrowserFailureReason,
  detail: string,
): never {
  throw new StudioProceduralArtisticBrushBrowserStop(reason, detail);
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) stop("aborted", "PNG conversion was aborted.");
}

function resolvePositiveLimit(
  candidate: unknown,
  fallback: number,
  hardMaximum: number,
  name: string,
): number {
  const value = candidate ?? fallback;
  if (
    !isPositiveSafeInteger(value)
    || value > hardMaximum
  ) {
    stop("invalid-options", `${name} is outside the admitted range.`);
  }
  return value;
}

function resolveLimits(candidate: unknown): ResolvedLimits {
  if (
    candidate !== undefined
    && (
      !isPlainRecord(candidate)
      || !hasOnlyKnownKeys(candidate, LIMIT_KEYS)
    )
  ) {
    stop("invalid-options", "Browser bridge limits are invalid.");
  }
  const input = (candidate ?? {}) as Record<string, unknown>;
  const maxPngBlobBytes = resolvePositiveLimit(
    input.maxPngBlobBytes,
    STUDIO_PROCEDURAL_ARTISTIC_BRUSH_BROWSER_LIMITS.maxPngBlobBytes,
    STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxOutputBytes
      + 16 * 1_024 * 1_024,
    "maxPngBlobBytes",
  );
  const maximumDataUrlCodeUnits =
    PNG_DATA_URL_PREFIX.length + Math.ceil(maxPngBlobBytes / 3) * 4;
  return Object.freeze({
    maxWidth: resolvePositiveLimit(
      input.maxWidth,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_BROWSER_LIMITS.maxWidth,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxWidth,
      "maxWidth",
    ),
    maxHeight: resolvePositiveLimit(
      input.maxHeight,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_BROWSER_LIMITS.maxHeight,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxHeight,
      "maxHeight",
    ),
    maxPixels: resolvePositiveLimit(
      input.maxPixels,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_BROWSER_LIMITS.maxPixels,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxPixels,
      "maxPixels",
    ),
    maxRgbaBytes: resolvePositiveLimit(
      input.maxRgbaBytes,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_BROWSER_LIMITS.maxRgbaBytes,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxOutputBytes,
      "maxRgbaBytes",
    ),
    maxPngBlobBytes,
    maxDataUrlCodeUnits: resolvePositiveLimit(
      input.maxDataUrlCodeUnits,
      maximumDataUrlCodeUnits,
      PNG_DATA_URL_PREFIX.length
        + Math.ceil(
          (STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxOutputBytes
            + 16 * 1_024 * 1_024) / 3,
        ) * 4,
      "maxDataUrlCodeUnits",
    ),
  });
}

function defaultCanvasFactory():
  | StudioProceduralArtisticBrushBrowserCanvasFactory
  | null {
  if (typeof globalThis.document?.createElement !== "function") return null;
  return (width, height) => {
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas as unknown as StudioProceduralArtisticBrushBrowserCanvas;
  };
}

function defaultImageDataFactory():
  | StudioProceduralArtisticBrushBrowserImageDataFactory
  | null {
  if (typeof globalThis.ImageData !== "function") return null;
  return (pixels, width, height) => {
    const imageData = new globalThis.ImageData(pixels, width, height);
    return imageData as StudioProceduralArtisticBrushBrowserImageData;
  };
}

function defaultBlobGuard():
  | StudioProceduralArtisticBrushBrowserBlobGuard
  | null {
  if (typeof globalThis.Blob !== "function") return null;
  return (
    value: unknown,
  ): value is StudioProceduralArtisticBrushBrowserBlob => (
    value instanceof globalThis.Blob
  );
}

function defaultFileReaderFactory():
  | StudioProceduralArtisticBrushBrowserFileReaderFactory
  | null {
  if (typeof globalThis.FileReader !== "function") return null;
  return () => {
    const reader = new globalThis.FileReader();
    return reader as unknown as StudioProceduralArtisticBrushBrowserFileReader;
  };
}

function defaultBase64Decoder():
  | StudioProceduralArtisticBrushBrowserBase64Decoder
  | null {
  if (typeof globalThis.atob !== "function") return null;
  return (value) => {
    const binary = globalThis.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  };
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function defaultSha256Digest():
  | StudioProceduralArtisticBrushBrowserSha256Digest
  | null {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined || typeof subtle.digest !== "function") return null;
  return async (bytes) => {
    // Give Web Crypto an owned ArrayBuffer-backed view. This keeps the exact
    // injectable contract compatible with strict BufferSource implementations
    // and snapshots caller bytes before the asynchronous digest settles.
    const ownedBytes = new Uint8Array(bytes.byteLength);
    ownedBytes.set(bytes);
    const digest = await subtle.digest("SHA-256", ownedBytes);
    return `sha256:${bytesToHex(new Uint8Array(digest))}`;
  };
}

function resolveOptionalPrimitive<T>(
  value: T | null | undefined,
  fallback: () => T | null,
): T | null {
  return value === undefined ? fallback() : value;
}

function resolveEnvironment(candidate: unknown): ResolvedEnvironment {
  if (
    candidate !== undefined
    && (
      !isPlainRecord(candidate)
      || !hasOnlyKnownKeys(candidate, ENVIRONMENT_KEYS)
    )
  ) {
    stop("invalid-options", "Browser bridge environment is invalid.");
  }
  const environment = (candidate ?? {}) as StudioProceduralArtisticBrushBrowserEnvironment;
  const createCanvas = resolveOptionalPrimitive(
    environment.createCanvas,
    defaultCanvasFactory,
  );
  const createImageData = resolveOptionalPrimitive(
    environment.createImageData,
    defaultImageDataFactory,
  );
  const isBlob = resolveOptionalPrimitive(
    environment.isBlob,
    defaultBlobGuard,
  );
  const createFileReader = resolveOptionalPrimitive(
    environment.createFileReader,
    defaultFileReaderFactory,
  );
  const decodeBase64 = resolveOptionalPrimitive(
    environment.decodeBase64,
    defaultBase64Decoder,
  );
  const digestSha256 = resolveOptionalPrimitive(
    environment.digestSha256,
    defaultSha256Digest,
  );
  if (createCanvas !== null && typeof createCanvas !== "function") {
    stop("invalid-options", "createCanvas must be a function or null.");
  }
  if (createImageData !== null && typeof createImageData !== "function") {
    stop("invalid-options", "createImageData must be a function or null.");
  }
  if (isBlob !== null && typeof isBlob !== "function") {
    stop("invalid-options", "isBlob must be a function or null.");
  }
  if (createFileReader !== null && typeof createFileReader !== "function") {
    stop("invalid-options", "createFileReader must be a function or null.");
  }
  if (decodeBase64 !== null && typeof decodeBase64 !== "function") {
    stop("invalid-options", "decodeBase64 must be a function or null.");
  }
  if (digestSha256 !== null && typeof digestSha256 !== "function") {
    stop("invalid-options", "digestSha256 must be a function or null.");
  }
  return Object.freeze({
    createCanvas,
    createImageData,
    isBlob,
    createFileReader,
    decodeBase64,
    digestSha256,
  });
}

function normalizeOptions(
  candidate: unknown,
): Readonly<{
  signal?: AbortSignal;
  environment: ResolvedEnvironment;
  limits: ResolvedLimits;
}> {
  if (
    !isPlainRecord(candidate)
    || !hasOnlyKnownKeys(candidate, OPTION_KEYS)
    || (
      candidate.signal !== undefined
      && !(
        typeof AbortSignal !== "undefined"
        && candidate.signal instanceof AbortSignal
      )
    )
  ) {
    stop("invalid-options", "Browser bridge options are invalid.");
  }
  return Object.freeze({
    signal: candidate.signal as AbortSignal | undefined,
    environment: resolveEnvironment(candidate.environment),
    limits: resolveLimits(candidate.limits),
  });
}

async function digestSha256(
  bytes: Uint8Array<ArrayBuffer>,
  environment: ResolvedEnvironment,
  signal: AbortSignal | undefined,
): Promise<`sha256:${string}`> {
  if (environment.digestSha256 === null) {
    stop("digest-unavailable", "Asynchronous Web Crypto SHA-256 is unavailable.");
  }
  assertNotAborted(signal);
  let digest: unknown;
  try {
    digest = await environment.digestSha256(bytes);
  } catch {
    assertNotAborted(signal);
    stop("digest-unavailable", "Asynchronous SHA-256 digest failed.");
  }
  assertNotAborted(signal);
  if (typeof digest !== "string" || !SHA256_PATTERN.test(digest)) {
    stop("digest-unavailable", "Asynchronous SHA-256 returned an invalid digest.");
  }
  return digest as `sha256:${string}`;
}

async function normalizeArtifact(
  candidate: unknown,
  limits: ResolvedLimits,
  environment: ResolvedEnvironment,
  signal: AbortSignal | undefined,
): Promise<NormalizedArtifact> {
  if (!isPlainRecord(candidate)) {
    stop("invalid-artifact", "Completed provider artifact is required.");
  }
  const {
    kind,
    version,
    width,
    height,
    encoding,
    colorSpace,
    alpha,
    pixels,
    receipt,
  } = candidate;
  if (
    kind !== "studio-procedural-artistic-brush/artifact"
    || version !== STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION
    || !isPositiveSafeInteger(width)
    || !isPositiveSafeInteger(height)
    || width > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxWidth
    || height > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxHeight
    || encoding !== "rgba8-unorm"
    || colorSpace !== "srgb"
    || alpha !== "straight"
    || !(pixels instanceof Uint8ClampedArray)
    || !isPlainRecord(receipt)
  ) {
    stop("invalid-artifact", "Provider artifact fields failed validation.");
  }
  const pixelCount = width * height;
  const expectedRgbaBytes = pixelCount * 4;
  if (
    !Number.isSafeInteger(pixelCount)
    || !Number.isSafeInteger(expectedRgbaBytes)
    || width > limits.maxWidth
    || height > limits.maxHeight
    || pixelCount > limits.maxPixels
    || expectedRgbaBytes > limits.maxRgbaBytes
  ) {
    stop("budget-exceeded", "Provider artifact exceeds browser bridge budgets.");
  }
  if (pixels.byteLength !== expectedRgbaBytes) {
    stop("invalid-artifact", "RGBA byte length does not match dimensions.");
  }
  if (
    receipt.kind !== "studio-procedural-artistic-brush/receipt"
    || receipt.version !== STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION
    || receipt.width !== width
    || receipt.height !== height
    || receipt.outputBytes !== expectedRgbaBytes
    || receipt.complete !== true
    || typeof receipt.pixelHash !== "string"
    || !SHA256_PATTERN.test(receipt.pixelHash)
    || typeof receipt.replayFingerprint !== "string"
    || !SHA256_PATTERN.test(receipt.replayFingerprint)
    || !isPositiveSafeInteger(receipt.requestSequence)
    || !isPositiveSafeInteger(receipt.engineEpoch)
    || typeof receipt.strokeId !== "string"
    || receipt.strokeId.length === 0
    || !isPlainRecord(receipt.execution)
    || receipt.execution.stage !== "settled"
    || !isPlainRecord(receipt.authority)
    || receipt.authority.mainScene !== false
    || receipt.authority.document !== false
    || receipt.authority.history !== false
    || receipt.authority.persistence !== false
    || receipt.authority.output !== "settled-raster-suggestion"
  ) {
    stop("invalid-artifact", "Provider receipt does not match RGBA artifact.");
  }
  const bytes = new Uint8Array(expectedRgbaBytes);
  bytes.set(pixels);
  const pixelHash = await digestSha256(bytes, environment, signal);
  if (pixelHash !== receipt.pixelHash) {
    stop("pixel-hash-mismatch", "RGBA bytes do not match the provider receipt.");
  }
  return Object.freeze({
    artifact: candidate as unknown as StudioProceduralArtisticBrushArtifact,
    expectedRgbaBytes,
    pixelHash,
  });
}

function createPrivateImageData(
  artifact: NormalizedArtifact,
  environment: ResolvedEnvironment,
): Readonly<{
  imageData: StudioProceduralArtisticBrushBrowserImageData;
  ownedPixels: Uint8ClampedArray<ArrayBuffer>;
}> {
  if (environment.createImageData === null) {
    stop("image-data-unavailable", "ImageData is unavailable.");
  }
  const ownedPixels = new Uint8ClampedArray(artifact.expectedRgbaBytes);
  ownedPixels.set(artifact.artifact.pixels);
  let imageData: StudioProceduralArtisticBrushBrowserImageData | null;
  try {
    imageData = environment.createImageData(
      ownedPixels,
      artifact.artifact.width,
      artifact.artifact.height,
    );
  } catch {
    stop("image-data-unavailable", "ImageData construction failed.");
  }
  if (
    imageData === null
    || !(imageData.data instanceof Uint8ClampedArray)
    || imageData.data !== ownedPixels
    || imageData.data.byteLength !== artifact.expectedRgbaBytes
    || imageData.width !== artifact.artifact.width
    || imageData.height !== artifact.artifact.height
  ) {
    stop(
      "image-data-unavailable",
      "ImageData did not preserve the private RGBA buffer contract.",
    );
  }
  return Object.freeze({ imageData, ownedPixels });
}

function createPrivateCanvas(
  width: number,
  height: number,
  environment: ResolvedEnvironment,
): Readonly<{
  canvas: StudioProceduralArtisticBrushBrowserCanvas;
  context: StudioProceduralArtisticBrushBrowserContext;
}> {
  if (environment.createCanvas === null) {
    stop("canvas-unavailable", "Detached DOM canvas is unavailable.");
  }
  let canvas: StudioProceduralArtisticBrushBrowserCanvas | null;
  try {
    canvas = environment.createCanvas(width, height);
  } catch {
    stop("canvas-unavailable", "Detached DOM canvas creation failed.");
  }
  if (canvas === null) {
    stop("canvas-unavailable", "Detached DOM canvas contract is invalid.");
  }
  let validCanvasContract = false;
  try {
    validCanvasContract = canvas.width === width
      && canvas.height === height
      && typeof canvas.getContext === "function"
      && typeof canvas.toBlob === "function";
  } catch {
    releaseCanvasBacking(canvas);
    stop("canvas-unavailable", "Detached DOM canvas contract is invalid.");
  }
  if (!validCanvasContract) {
    releaseCanvasBacking(canvas);
    stop("canvas-unavailable", "Detached DOM canvas contract is invalid.");
  }
  let context: StudioProceduralArtisticBrushBrowserContext | null;
  try {
    context = canvas.getContext("2d");
  } catch {
    releaseCanvasBacking(canvas);
    stop("context-unavailable", "Canvas 2D context creation failed.");
  }
  let validContextContract = false;
  try {
    validContextContract = context !== null
      && typeof context.putImageData === "function";
  } catch {
    releaseCanvasBacking(canvas);
    stop("context-unavailable", "Canvas 2D context is unavailable.");
  }
  if (!validContextContract || context === null) {
    releaseCanvasBacking(canvas);
    stop("context-unavailable", "Canvas 2D context is unavailable.");
  }
  return Object.freeze({ canvas, context });
}

function releaseCanvasBacking(
  canvas: StudioProceduralArtisticBrushBrowserCanvas | null,
): void {
  if (canvas === null) return;
  try {
    canvas.width = 1;
    canvas.height = 1;
  } catch {
    // Canvas backing release is best-effort after every admitted exit.
  }
}

async function withProductGlobalPngEncodeGate<T>(
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const predecessor = productGlobalPngEncodeTail;
  let release!: () => void;
  const slot = new Promise<void>((resolve) => {
    release = resolve;
  });
  productGlobalPngEncodeTail = predecessor.then(
    () => slot,
    () => slot,
  );
  await predecessor;
  try {
    assertNotAborted(signal);
    if (productGlobalPngEncodePoisoned) {
      stop(
        "png-encode-failed",
        "The previous timed-out PNG encoder has not released its native callback.",
      );
    }
    return await operation();
  } finally {
    release();
  }
}

function abortStop(): StudioProceduralArtisticBrushBrowserStop {
  return new StudioProceduralArtisticBrushBrowserStop(
    "aborted",
    "PNG conversion was aborted.",
  );
}

async function canvasToPngBlob(
  canvas: StudioProceduralArtisticBrushBrowserCanvas,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  assertNotAborted(signal);
  return new Promise<unknown>((resolve, rejectPromise) => {
    let settled = false;
    let abortRequested = signal?.aborted ?? false;
    let watchdogExpired = false;
    let watchdog: ReturnType<typeof globalThis.setTimeout> | null = null;
    const cleanup = (): void => {
      signal?.removeEventListener("abort", onAbort);
      if (watchdog !== null) {
        globalThis.clearTimeout(watchdog);
        watchdog = null;
      }
    };
    const settle = (
      callback: (value: unknown) => void,
      value: unknown,
    ): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    // Abort is only a cancellation request here. The canvas backing and the
    // global encode slot remain owned until toBlob actually calls back, or the
    // bounded watchdog proves that it is not going to settle.
    const onAbort = (): void => {
      abortRequested = true;
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    watchdog = globalThis.setTimeout(() => {
      watchdogExpired = true;
      productGlobalPngEncodePoisoned = true;
      settle(
        rejectPromise,
        abortRequested || signal?.aborted
          ? abortStop()
          : new StudioProceduralArtisticBrushBrowserStop(
            "png-encode-failed",
            "Canvas PNG encoding exceeded the bounded watchdog.",
          ),
      );
    }, STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PNG_ENCODE_WATCHDOG_MS);
    try {
      canvas.toBlob(
        (blob) => {
          if (watchdogExpired) {
            productGlobalPngEncodePoisoned = false;
            return;
          }
          if (abortRequested || signal?.aborted) {
            settle(rejectPromise, abortStop());
            return;
          }
          settle(resolve, blob);
        },
        "image/png",
      );
    } catch {
      settle(
        rejectPromise,
        abortRequested || signal?.aborted
          ? abortStop()
          : new StudioProceduralArtisticBrushBrowserStop(
            "png-encode-failed",
            "Canvas PNG encoding failed.",
          ),
      );
    }
  });
}

async function readBlobAsDataUrl(
  blob: StudioProceduralArtisticBrushBrowserBlob,
  environment: ResolvedEnvironment,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (environment.createFileReader === null) {
    stop("file-reader-unavailable", "FileReader is unavailable.");
  }
  let reader: StudioProceduralArtisticBrushBrowserFileReader | null;
  try {
    reader = environment.createFileReader();
  } catch {
    stop("file-reader-unavailable", "FileReader construction failed.");
  }
  if (
    reader === null
    || typeof reader.readAsDataURL !== "function"
    || typeof reader.abort !== "function"
  ) {
    stop("file-reader-unavailable", "FileReader contract is invalid.");
  }
  assertNotAborted(signal);
  return new Promise<string>((resolve, rejectPromise) => {
    let settled = false;
    const cleanup = (): void => {
      signal?.removeEventListener("abort", onSignalAbort);
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
    };
    const rejectOnce = (
      error: StudioProceduralArtisticBrushBrowserStop,
    ): void => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(error);
    };
    const onSignalAbort = (): void => {
      if (settled) return;
      try {
        reader.abort();
      } catch {
        // The caller's abort remains authoritative.
      }
      rejectOnce(abortStop());
    };
    reader.onload = () => {
      if (settled) return;
      if (typeof reader.result !== "string") {
        rejectOnce(new StudioProceduralArtisticBrushBrowserStop(
          "png-read-failed",
          "FileReader returned a non-string PNG result.",
        ));
        return;
      }
      const value = reader.result;
      settled = true;
      cleanup();
      resolve(value);
    };
    reader.onerror = () => rejectOnce(
      new StudioProceduralArtisticBrushBrowserStop(
        "png-read-failed",
        "FileReader could not read the PNG Blob.",
      ),
    );
    reader.onabort = () => rejectOnce(abortStop());
    signal?.addEventListener("abort", onSignalAbort, { once: true });
    try {
      reader.readAsDataURL(blob);
    } catch {
      rejectOnce(new StudioProceduralArtisticBrushBrowserStop(
        "png-read-failed",
        "FileReader.readAsDataURL failed.",
      ));
    }
  });
}

function hasExpectedBase64Shape(
  dataUrl: string,
  blobByteLength: number,
): boolean {
  const payloadLength = dataUrl.length - PNG_DATA_URL_PREFIX.length;
  const expectedLength = Math.ceil(blobByteLength / 3) * 4;
  if (payloadLength !== expectedLength || payloadLength < 32) return false;
  const remainder = blobByteLength % 3;
  const expectedPadding = remainder === 1 ? "==" : remainder === 2 ? "=" : "";
  if (
    expectedPadding.length > 0
      ? !dataUrl.endsWith(expectedPadding)
      : dataUrl.endsWith("=")
  ) {
    return false;
  }

  // FileReader created this data URL from the Blob immediately above. Avoid an
  // O(encoded-size) JavaScript character scan (up to ~112 MiB); inspect only
  // the bounded prefix needed for PNG decoding and the four-character tail
  // that carries the padding contract derived from Blob.size.
  const prefix = dataUrl.slice(
    PNG_DATA_URL_PREFIX.length,
    PNG_DATA_URL_PREFIX.length + 32,
  );
  const suffix = dataUrl.slice(-4);
  return /^[A-Za-z0-9+/]{32}$/u.test(prefix)
    && /^[A-Za-z0-9+/]{2,4}={0,2}$/u.test(suffix);
}

function readPngUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1_000000)
    + ((bytes[offset + 1] ?? 0) << 16)
    + ((bytes[offset + 2] ?? 0) << 8)
    + (bytes[offset + 3] ?? 0)
  );
}

function validatePngDataUrl(
  value: string,
  blob: StudioProceduralArtisticBrushBrowserBlob,
  width: number,
  height: number,
  limits: ResolvedLimits,
  environment: ResolvedEnvironment,
): `data:image/png;base64,${string}` {
  if (
    value.length > limits.maxDataUrlCodeUnits
    || !value.startsWith(PNG_DATA_URL_PREFIX)
  ) {
    stop("invalid-png-result", "PNG data URL prefix or size is invalid.");
  }
  if (
    !hasExpectedBase64Shape(value, blob.size)
    || environment.decodeBase64 === null
  ) {
    stop("invalid-png-result", "PNG data URL base64 payload is invalid.");
  }
  let prefix: Uint8Array | null;
  try {
    prefix = environment.decodeBase64(value.slice(
      PNG_DATA_URL_PREFIX.length,
      PNG_DATA_URL_PREFIX.length + 32,
    ));
  } catch {
    stop("invalid-png-result", "PNG data URL prefix could not be decoded.");
  }
  if (
    prefix === null
    || prefix.byteLength < 24
    || PNG_SIGNATURE.some((byte, index) => prefix?.[index] !== byte)
    || readPngUint32(prefix, 8) !== 13
    || prefix[12] !== 0x49
    || prefix[13] !== 0x48
    || prefix[14] !== 0x44
    || prefix[15] !== 0x52
    || readPngUint32(prefix, 16) !== width
    || readPngUint32(prefix, 20) !== height
  ) {
    stop(
      "invalid-png-result",
      "PNG signature or IHDR dimensions do not match the RGBA artifact.",
    );
  }
  return value as `data:image/png;base64,${string}`;
}

/**
 * Converts one completed provider artifact into a bounded, lossless PNG data
 * URL. The source pixels are only read for receipt verification and copied
 * before ImageData/canvas use; the caller's view and backing buffer are never
 * transferred, detached, cleared or mutated.
 */
export async function encodeStudioProceduralArtisticBrushPngDataUrl(
  candidate: unknown,
  options: StudioProceduralArtisticBrushBrowserOptions = {},
): Promise<StudioProceduralArtisticBrushBrowserResult> {
  try {
    const normalizedOptions = normalizeOptions(options);
    assertNotAborted(normalizedOptions.signal);
    return await withProductGlobalPngEncodeGate(
      normalizedOptions.signal,
      async () => {
        // Admission, integrity copies, canvas encoding and data-URL materialization
        // share one global slot. Waiting callers retain only their provider artifact;
        // they do not allocate another full-size RGBA/ImageData copy before admission.
        const normalized = await normalizeArtifact(
          candidate,
          normalizedOptions.limits,
          normalizedOptions.environment,
          normalizedOptions.signal,
        );
        assertNotAborted(normalizedOptions.signal);
        const privateImage = createPrivateImageData(
          normalized,
          normalizedOptions.environment,
        );
        const privateCanvas = createPrivateCanvas(
          normalized.artifact.width,
          normalized.artifact.height,
          normalizedOptions.environment,
        );
        try {
          try {
            privateCanvas.context.putImageData(privateImage.imageData, 0, 0);
          } catch {
            stop("png-encode-failed", "Copying ImageData to the canvas failed.");
          }
          assertNotAborted(normalizedOptions.signal);
          const privatePixelHash = await digestSha256(
            new Uint8Array(
              privateImage.ownedPixels.buffer,
              privateImage.ownedPixels.byteOffset,
              privateImage.ownedPixels.byteLength,
            ),
            normalizedOptions.environment,
            normalizedOptions.signal,
          );
          if (privatePixelHash !== normalized.pixelHash) {
            stop(
              "pixel-copy-mutated",
              "The private ImageData buffer changed before PNG encoding.",
            );
          }
          const blobCandidate = await canvasToPngBlob(
            privateCanvas.canvas,
            normalizedOptions.signal,
          );
          assertNotAborted(normalizedOptions.signal);
          if (normalizedOptions.environment.isBlob === null) {
            stop("blob-unavailable", "Blob validation is unavailable.");
          }
          if (!normalizedOptions.environment.isBlob(blobCandidate)) {
            stop("png-encode-failed", "Canvas returned an invalid PNG Blob.");
          }
          const blob = blobCandidate;
          if (
            blob.type.toLowerCase() !== "image/png"
            || !isPositiveSafeInteger(blob.size)
            || blob.size > normalizedOptions.limits.maxPngBlobBytes
          ) {
            stop("invalid-png-result", "Canvas PNG Blob type or size is invalid.");
          }
          const rawDataUrl = await readBlobAsDataUrl(
            blob,
            normalizedOptions.environment,
            normalizedOptions.signal,
          );
          assertNotAborted(normalizedOptions.signal);
          const dataUrl = validatePngDataUrl(
            rawDataUrl,
            blob,
            normalized.artifact.width,
            normalized.artifact.height,
            normalizedOptions.limits,
            normalizedOptions.environment,
          );
          const output: StudioProceduralArtisticBrushPngDataUrlArtifact =
            Object.freeze({
              kind:
                "studio-procedural-artistic-brush-browser/png-data-url-artifact",
              version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_BROWSER_REVISION,
              width: normalized.artifact.width,
              height: normalized.artifact.height,
              mediaType: "image/png",
              dataUrl,
              pngByteLength: blob.size,
              dataUrlCodeUnits: dataUrl.length,
              source: Object.freeze({
                providerVersion:
                  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION,
                requestSequence:
                  normalized.artifact.receipt.requestSequence,
                engineEpoch: normalized.artifact.receipt.engineEpoch,
                strokeId: normalized.artifact.receipt.strokeId,
                pixelHash: normalized.pixelHash,
                replayFingerprint:
                  normalized.artifact.receipt.replayFingerprint,
              }),
              authority: Object.freeze({
                mainScene: false,
                document: false,
                history: false,
                persistence: false,
                output: "lossless-png-insertion-suggestion",
              }),
            });
          return Object.freeze({
            status: "completed",
            consumed: false,
            artifact: output,
          });
        } finally {
          releaseCanvasBacking(privateCanvas.canvas);
        }
      },
    );
  } catch (error) {
    if (error instanceof StudioProceduralArtisticBrushBrowserStop) {
      return reject(error.reason, error.detail);
    }
    return reject(
      "png-encode-failed",
      "Artistic brush PNG conversion failed closed.",
    );
  }
}
