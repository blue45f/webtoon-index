import {
  CONTENT_AWARE_FILL_TILE_PX_DEFAULT,
  CONTENT_AWARE_FILL_TILE_PX_RANGE,
} from "../studio-content-aware-fill-contract";
import { sha256HexPortable } from "../studio-sha256";

import {
  STUDIO_LAYER_LIFT_ARTIFACT_LIMITS,
  StudioLayerLiftArtifactError,
  admitStudioLayerLiftArtifactPair,
  isStudioLayerLiftTrustedArtifactPair,
} from "./studio-layer-lift-artifact";
import {
  STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_LIMITS,
  createStudioLayerLiftCompositionReceipt,
  isTrustedStudioLayerLiftCompositionReceipt,
} from "./studio-layer-lift-composition-receipt";
import {
  STUDIO_SCENE_LAYER_LIFT_BUDGETS,
  STUDIO_SCENE_LAYER_LIFT_SEMANTIC_LAYER_ROLES,
} from "./studio-layer-lift-contract";

import type {
  StudioLayerLiftPngDecoder,
  StudioLayerLiftTrustedArtifactPair,
} from "./studio-layer-lift-artifact";
import type {
  StudioLayerLiftCompositionReceipt,
  StudioLayerLiftCompositionProviderLayerProvenance,
} from "./studio-layer-lift-composition-receipt";
import type {
  StudioSceneLayerLiftSemanticLayerRole,
  StudioSceneLayerLiftSha256,
} from "./studio-layer-lift-contract";

export const STUDIO_LAYER_LIFT_COMPOSITOR_ID =
  "toonspectrum.layer-lift-compositor" as const;
export const STUDIO_LAYER_LIFT_COMPOSITOR_VERSION = "1.0.0-beta.1" as const;
export const STUDIO_LAYER_LIFT_COMPOSITOR_ALGORITHM =
  "source-mask-foreground+bounded-tile-background-v1" as const;

/**
 * Peak memory is estimated before any output plane is allocated. The estimate
 * accounts for the source/mask snapshots, two output RGBA planes, the
 * content-aware-fill RGBA mask/work copies, two encoder input copies, and both
 * bounded PNG artifacts. It intentionally overestimates rather than allowing a
 * large full-frame selection to surprise the Worker realm.
 */
export const STUDIO_LAYER_LIFT_COMPOSITOR_LIMITS = Object.freeze({
  maximumAxisPixels: STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumAxisPixels,
  maximumPixels: STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumPixels,
  maximumInputBytes:
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumInputBytes
    + STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumPixels,
  maximumPeakBytes: 512 * 1_024 * 1_024,
  maximumWorkUnits: 2_000_000_000,
  maximumPngBytes: STUDIO_LAYER_LIFT_ARTIFACT_LIMITS.maximumCompressedBytes,
  maximumIdentifierCharacters:
    STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_LIMITS.maximumIdentifierCharacters,
  maximumProviderLayers:
    STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_LIMITS.maximumLayerCount,
} as const);

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SEMANTIC_ROLES = new Set<string>(
  STUDIO_SCENE_LAYER_LIFT_SEMANTIC_LAYER_ROLES,
);
const TEXT_ENCODER = new TextEncoder();
const TRUSTED_RESULTS = new WeakSet<object>();

export interface StudioLayerLiftCompositorProviderLayer {
  readonly layerId: string;
  readonly role: StudioSceneLayerLiftSemanticLayerRole;
  readonly order: number;
  readonly rgbaSha256: StudioSceneLayerLiftSha256;
  readonly maskSha256: StudioSceneLayerLiftSha256;
}

/**
 * Minimal compositor authority. Provider RGBA is deliberately not transported:
 * the first beta keeps original source colour and uses exactly one provider
 * mask to split foreground from the flattened source. All provider plane hashes
 * remain in the provenance receipt so later semantic-layer versions can reuse
 * the same authority shape.
 */
export interface StudioLayerLiftCompositorInput {
  readonly requestId: string;
  readonly sourceId: string;
  readonly width: number;
  readonly height: number;
  readonly sourceSha256: StudioSceneLayerLiftSha256;
  readonly sourceRgba:
    | Uint8Array<ArrayBuffer>
    | Uint8ClampedArray<ArrayBuffer>;
  readonly providerReceiptSha256: StudioSceneLayerLiftSha256;
  readonly providerLayers: readonly StudioLayerLiftCompositorProviderLayer[];
  readonly foregroundLayerId: string;
  readonly foregroundMaskSha256: StudioSceneLayerLiftSha256;
  readonly foregroundMask: Uint8Array<ArrayBuffer>;
  readonly backgroundOutputId: string;
  readonly foregroundOutputId: string;
  readonly fillTilePixels?: number;
}

export interface StudioLayerLiftCompositorOwnedInput
  extends Omit<
    StudioLayerLiftCompositorInput,
    "sourceRgba" | "foregroundMask" | "providerLayers" | "fillTilePixels"
  > {
  readonly sourceRgba: Uint8ClampedArray<ArrayBuffer>;
  readonly foregroundMask: Uint8Array<ArrayBuffer>;
  readonly providerLayers: readonly StudioLayerLiftCompositorProviderLayer[];
  readonly fillTilePixels: number;
}

export interface StudioLayerLiftCompositorPlane {
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  readonly sha256: StudioSceneLayerLiftSha256;
  /** This complete ArrayBuffer is exclusively owned by the result. */
  readonly bytes: Uint8ClampedArray<ArrayBuffer>;
}

export interface StudioLayerLiftCompositorMask {
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  readonly sha256: StudioSceneLayerLiftSha256;
  /** This complete ArrayBuffer is exclusively owned by the result. */
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export interface StudioLayerLiftCompositorDiagnostics {
  readonly algorithm: typeof STUDIO_LAYER_LIFT_COMPOSITOR_ALGORITHM;
  readonly fillTilePixels: number;
  readonly pixelCount: number;
  readonly selectedPixelCount: number;
  readonly partialPixelCount: number;
  readonly transparentSelectedPixelCount: number;
  readonly estimatedPeakBytes: number;
  readonly estimatedWorkUnits: number;
  readonly sourceRgbaSha256: StudioSceneLayerLiftSha256;
  readonly foregroundMaskSha256: StudioSceneLayerLiftSha256;
  readonly backgroundRgbaSha256: StudioSceneLayerLiftSha256;
  readonly foregroundRgbaSha256: StudioSceneLayerLiftSha256;
  readonly paritySha256: StudioSceneLayerLiftSha256;
}

export interface StudioLayerLiftTrustedComposition {
  readonly requestId: string;
  readonly sourceId: string;
  readonly width: number;
  readonly height: number;
  readonly backgroundRgba: StudioLayerLiftCompositorPlane;
  readonly foregroundRgba: StudioLayerLiftCompositorPlane;
  readonly removalMask: StudioLayerLiftCompositorMask;
  readonly diagnostics: StudioLayerLiftCompositorDiagnostics;
  readonly artifacts: StudioLayerLiftTrustedArtifactPair;
  readonly compositionReceipt: StudioLayerLiftCompositionReceipt;
}

export type StudioLayerLiftCompositorErrorCode =
  | "aborted"
  | "artifact-invalid"
  | "budget-exceeded"
  | "encode-failed"
  | "encode-unavailable"
  | "invalid-input"
  | "provenance-mismatch";

export class StudioLayerLiftCompositorError extends Error {
  constructor(
    readonly code: StudioLayerLiftCompositorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StudioLayerLiftCompositorError";
  }
}

export type StudioLayerLiftCompositorPngEncoder = (
  plane: Readonly<{
    readonly width: number;
    readonly height: number;
    readonly bytes: Uint8ClampedArray<ArrayBuffer>;
  }>,
  signal: AbortSignal | undefined,
) => Promise<ArrayBuffer | Uint8Array<ArrayBuffer>>;

export interface StudioLayerLiftCompositorOptions {
  readonly signal?: AbortSignal;
  readonly encodePng?: StudioLayerLiftCompositorPngEncoder;
  readonly decodePngDimensions?: StudioLayerLiftPngDecoder;
}

type ExactRecord = Readonly<Record<string, unknown>>;

function fail(
  code: StudioLayerLiftCompositorErrorCode,
  message: string,
): never {
  throw new StudioLayerLiftCompositorError(code, message);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    fail("aborted", "Scene Layer Lift composition was aborted.");
  }
}

function exactRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): ExactRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("invalid-input", "Compositor input must be a plain record.");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return fail("invalid-input", "Compositor input has a custom prototype.");
  }
  const permitted = new Set([...requiredKeys, ...optionalKeys]);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some(
      (key) => typeof key !== "string" || !permitted.has(key),
    )
    || requiredKeys.some((key) => !ownKeys.includes(key))
  ) {
    return fail("invalid-input", "Compositor input fields are not canonical.");
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of ownKeys) {
    if (typeof key !== "string") {
      return fail("invalid-input", "Compositor input fields are not canonical.");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined
      || !Object.prototype.hasOwnProperty.call(descriptor, "value")
    ) {
      return fail("invalid-input", "Compositor input cannot contain accessors.");
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function exactArray(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): readonly unknown[] {
  if (
    !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < minimumLength
    || value.length > maximumLength
  ) {
    return fail("invalid-input", "Provider layers are not canonical.");
  }
  const expectedKeys = Array.from(
    { length: value.length },
    (_, index) => String(index),
  );
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.length + 1
    || ownKeys.some(
      (key) =>
        typeof key !== "string"
        || (key !== "length" && !expectedKeys.includes(key)),
    )
  ) {
    return fail("invalid-input", "Provider layers are not dense.");
  }
  return Object.freeze(expectedKeys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined
      || !Object.prototype.hasOwnProperty.call(descriptor, "value")
    ) {
      return fail("invalid-input", "Provider layers cannot contain accessors.");
    }
    return descriptor.value;
  }));
}

function identifier(value: unknown, field: string): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length
      > STUDIO_LAYER_LIFT_COMPOSITOR_LIMITS.maximumIdentifierCharacters
    || value !== value.normalize("NFC")
    || value.trim() !== value
    || value === "."
    || value === ".."
    || value.includes("/")
    || value.includes("\\")
  ) {
    return fail("invalid-input", `${field} is not a canonical identifier.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return fail("invalid-input", `${field} contains a control character.`);
    }
  }
  return value;
}

function sha256(
  value: unknown,
  field: string,
): StudioSceneLayerLiftSha256 {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    return fail("invalid-input", `${field} is not a SHA-256 authority.`);
  }
  return value as StudioSceneLayerLiftSha256;
}

function isCompleteOwnedByteView(
  value: unknown,
): value is
  | Uint8Array<ArrayBuffer>
  | Uint8ClampedArray<ArrayBuffer> {
  return (
    (value instanceof Uint8Array || value instanceof Uint8ClampedArray)
    && value.buffer instanceof ArrayBuffer
    && Object.prototype.toString.call(value.buffer) === "[object ArrayBuffer]"
    && value.byteOffset === 0
    && value.byteLength === value.buffer.byteLength
  );
}

function hashBytes(
  bytes: Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer>,
): StudioSceneLayerLiftSha256 {
  return `sha256:${sha256HexPortable(new Uint8Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ))}`;
}

function parseProviderLayer(
  value: unknown,
  expectedOrder: number,
): StudioLayerLiftCompositorProviderLayer {
  const layer = exactRecord(value, [
    "layerId",
    "role",
    "order",
    "rgbaSha256",
    "maskSha256",
  ]);
  if (layer.order !== expectedOrder) {
    return fail("invalid-input", "Provider layer order must be dense.");
  }
  if (
    typeof layer.role !== "string"
    || !SEMANTIC_ROLES.has(layer.role)
  ) {
    return fail("invalid-input", "Provider layer role is unsupported.");
  }
  return Object.freeze({
    layerId: identifier(layer.layerId, "providerLayers.layerId"),
    role: layer.role as StudioSceneLayerLiftSemanticLayerRole,
    order: expectedOrder,
    rgbaSha256: sha256(
      layer.rgbaSha256,
      "providerLayers.rgbaSha256",
    ),
    maskSha256: sha256(
      layer.maskSha256,
      "providerLayers.maskSha256",
    ),
  });
}

function inputKeys(): readonly string[] {
  return [
    "requestId",
    "sourceId",
    "width",
    "height",
    "sourceSha256",
    "sourceRgba",
    "providerReceiptSha256",
    "providerLayers",
    "foregroundLayerId",
    "foregroundMaskSha256",
    "foregroundMask",
    "backgroundOutputId",
    "foregroundOutputId",
  ];
}

/**
 * Copies source RGBA and the selected provider mask before any asynchronous
 * work. The returned storage is full-buffer, non-shared and product-owned.
 */
export function admitStudioLayerLiftCompositorInput(
  value: StudioLayerLiftCompositorInput,
): StudioLayerLiftCompositorOwnedInput {
  const input = exactRecord(value, inputKeys(), ["fillTilePixels"]);
  const width = input.width;
  const height = input.height;
  if (
    !Number.isSafeInteger(width)
    || Number(width) < 1
    || Number(width) > STUDIO_LAYER_LIFT_COMPOSITOR_LIMITS.maximumAxisPixels
    || !Number.isSafeInteger(height)
    || Number(height) < 1
    || Number(height) > STUDIO_LAYER_LIFT_COMPOSITOR_LIMITS.maximumAxisPixels
  ) {
    return fail("invalid-input", "Compositor dimensions are invalid.");
  }
  const canonicalWidth = Number(width);
  const canonicalHeight = Number(height);
  const pixelCount = canonicalWidth * canonicalHeight;
  if (
    !Number.isSafeInteger(pixelCount)
    || pixelCount > STUDIO_LAYER_LIFT_COMPOSITOR_LIMITS.maximumPixels
  ) {
    return fail("budget-exceeded", "Compositor pixel budget was exceeded.");
  }
  if (
    !isCompleteOwnedByteView(input.sourceRgba)
    || input.sourceRgba.byteLength !== pixelCount * 4
    || !isCompleteOwnedByteView(input.foregroundMask)
    || !(input.foregroundMask instanceof Uint8Array)
    || input.foregroundMask instanceof Uint8ClampedArray
    || input.foregroundMask.byteLength !== pixelCount
  ) {
    return fail("invalid-input", "Compositor planes are not complete RGBA8/alpha8 buffers.");
  }

  const providerLayers = exactArray(
    input.providerLayers,
    1,
    STUDIO_LAYER_LIFT_COMPOSITOR_LIMITS.maximumProviderLayers,
  ).map((layer, index) => parseProviderLayer(layer, index));
  const providerIds = new Set<string>();
  for (const layer of providerLayers) {
    if (providerIds.has(layer.layerId)) {
      return fail("invalid-input", "Provider layer IDs must be unique.");
    }
    providerIds.add(layer.layerId);
  }

  const foregroundLayerId = identifier(
    input.foregroundLayerId,
    "foregroundLayerId",
  );
  const foregroundLayer = providerLayers.find(
    (layer) => layer.layerId === foregroundLayerId,
  );
  if (!foregroundLayer) {
    return fail(
      "provenance-mismatch",
      "Foreground layer does not belong to provider provenance.",
    );
  }

  const sourceRgba = new Uint8ClampedArray(input.sourceRgba.byteLength);
  sourceRgba.set(input.sourceRgba);
  const foregroundMask = new Uint8Array(input.foregroundMask.byteLength);
  foregroundMask.set(input.foregroundMask);
  const sourceSha256 = sha256(input.sourceSha256, "sourceSha256");
  const foregroundMaskSha256 = sha256(
    input.foregroundMaskSha256,
    "foregroundMaskSha256",
  );
  if (
    hashBytes(sourceRgba) !== sourceSha256
    || hashBytes(foregroundMask) !== foregroundMaskSha256
    || foregroundLayer.maskSha256 !== foregroundMaskSha256
  ) {
    return fail(
      "provenance-mismatch",
      "Source or foreground mask bytes do not match their provider authority.",
    );
  }

  const inputBytes = sourceRgba.byteLength + foregroundMask.byteLength;
  if (inputBytes > STUDIO_LAYER_LIFT_COMPOSITOR_LIMITS.maximumInputBytes) {
    return fail("budget-exceeded", "Compositor input byte budget was exceeded.");
  }
  const fillTilePixels = input.fillTilePixels
    ?? CONTENT_AWARE_FILL_TILE_PX_DEFAULT;
  if (
    !Number.isSafeInteger(fillTilePixels)
    || Number(fillTilePixels) < CONTENT_AWARE_FILL_TILE_PX_RANGE.min
    || Number(fillTilePixels) > CONTENT_AWARE_FILL_TILE_PX_RANGE.max
  ) {
    return fail("invalid-input", "fillTilePixels is outside the supported range.");
  }
  const backgroundOutputId = identifier(
    input.backgroundOutputId,
    "backgroundOutputId",
  );
  const foregroundOutputId = identifier(
    input.foregroundOutputId,
    "foregroundOutputId",
  );
  if (backgroundOutputId === foregroundOutputId) {
    return fail("invalid-input", "Compositor output IDs must be distinct.");
  }

  return Object.freeze({
    requestId: identifier(input.requestId, "requestId"),
    sourceId: identifier(input.sourceId, "sourceId"),
    width: canonicalWidth,
    height: canonicalHeight,
    sourceSha256,
    sourceRgba,
    providerReceiptSha256: sha256(
      input.providerReceiptSha256,
      "providerReceiptSha256",
    ),
    providerLayers: Object.freeze(providerLayers),
    foregroundLayerId,
    foregroundMaskSha256,
    foregroundMask,
    backgroundOutputId,
    foregroundOutputId,
    fillTilePixels: Number(fillTilePixels),
  });
}

function scanMask(
  mask: Uint8Array<ArrayBuffer>,
  source: Uint8ClampedArray<ArrayBuffer>,
): Readonly<{
  selectedPixelCount: number;
  partialPixelCount: number;
  transparentSelectedPixelCount: number;
}> {
  let selectedPixelCount = 0;
  let partialPixelCount = 0;
  let transparentSelectedPixelCount = 0;
  for (let index = 0; index < mask.length; index += 1) {
    const alpha = mask[index]!;
    if (alpha === 0) continue;
    selectedPixelCount += 1;
    if (alpha < 255) partialPixelCount += 1;
    if (source[index * 4 + 3] === 0) {
      transparentSelectedPixelCount += 1;
    }
  }
  return Object.freeze({
    selectedPixelCount,
    partialPixelCount,
    transparentSelectedPixelCount,
  });
}

function estimateBudgets(
  pixelCount: number,
  selectedPixelCount: number,
): Readonly<{
  estimatedPeakBytes: number;
  estimatedWorkUnits: number;
}> {
  const estimatedPeakBytes =
    pixelCount * 29
    + STUDIO_LAYER_LIFT_ARTIFACT_LIMITS.maximumPairCompressedBytes;
  const estimatedWorkUnits =
    pixelCount * 10
    + selectedPixelCount * 400;
  if (
    estimatedPeakBytes
      > STUDIO_LAYER_LIFT_COMPOSITOR_LIMITS.maximumPeakBytes
    || estimatedWorkUnits
      > STUDIO_LAYER_LIFT_COMPOSITOR_LIMITS.maximumWorkUnits
  ) {
    return fail(
      "budget-exceeded",
      "Compositor peak-memory or interpolation work budget was exceeded.",
    );
  }
  return Object.freeze({ estimatedPeakBytes, estimatedWorkUnits });
}

function createForeground(
  source: Uint8ClampedArray<ArrayBuffer>,
  mask: Uint8Array<ArrayBuffer>,
): Uint8ClampedArray<ArrayBuffer> {
  const foreground = new Uint8ClampedArray(source.byteLength);
  for (let index = 0; index < mask.length; index += 1) {
    const sourceOffset = index * 4;
    const outputAlpha = Math.round(
      source[sourceOffset + 3]! * mask[index]! / 255,
    );
    if (outputAlpha === 0) continue;
    foreground[sourceOffset] = source[sourceOffset]!;
    foreground[sourceOffset + 1] = source[sourceOffset + 1]!;
    foreground[sourceOffset + 2] = source[sourceOffset + 2]!;
    foreground[sourceOffset + 3] = outputAlpha;
  }
  return foreground;
}

function createFillMask(
  mask: Uint8Array<ArrayBuffer>,
): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(mask.length * 4);
  for (let index = 0; index < mask.length; index += 1) {
    pixels[index * 4 + 3] = mask[index]!;
  }
  return pixels;
}

function createBackground(
  source: Uint8ClampedArray<ArrayBuffer>,
  mask: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
  fillTilePixels: number,
  fillPixels: typeof import("../studio-content-aware-fill")["contentAwareFillPixels"],
): Uint8ClampedArray<ArrayBuffer> {
  const filled = fillPixels(
    { data: source, width, height },
    { data: createFillMask(mask), width, height },
    { tilePx: fillTilePixels },
  );
  const background = new Uint8ClampedArray(filled.data.byteLength);
  background.set(filled.data);
  return background;
}

function plane(
  bytes: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
): StudioLayerLiftCompositorPlane {
  return Object.freeze({
    width,
    height,
    byteLength: bytes.byteLength,
    sha256: hashBytes(bytes),
    bytes,
  });
}

function maskPlane(
  bytes: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
): StudioLayerLiftCompositorMask {
  return Object.freeze({
    width,
    height,
    byteLength: bytes.byteLength,
    sha256: hashBytes(bytes),
    bytes,
  });
}

export function calculateStudioLayerLiftCompositorParitySha256(
  input: Readonly<{
    readonly sourceSha256: StudioSceneLayerLiftSha256;
    readonly foregroundMaskSha256: StudioSceneLayerLiftSha256;
    readonly foregroundLayerId: string;
    readonly fillTilePixels: number;
  }>,
  backgroundSha256: StudioSceneLayerLiftSha256,
  foregroundSha256: StudioSceneLayerLiftSha256,
): StudioSceneLayerLiftSha256 {
  return `sha256:${sha256HexPortable(TEXT_ENCODER.encode(JSON.stringify([
    STUDIO_LAYER_LIFT_COMPOSITOR_ID,
    STUDIO_LAYER_LIFT_COMPOSITOR_VERSION,
    STUDIO_LAYER_LIFT_COMPOSITOR_ALGORITHM,
    input.sourceSha256,
    input.foregroundMaskSha256,
    input.foregroundLayerId,
    input.fillTilePixels,
    backgroundSha256,
    foregroundSha256,
  ])))}`;
}

function snapshotEncodedPng(
  value: ArrayBuffer | Uint8Array<ArrayBuffer>,
): ArrayBuffer {
  if (value instanceof ArrayBuffer) {
    return ArrayBuffer.prototype.slice.call(value, 0) as ArrayBuffer;
  }
  if (
    !(value instanceof Uint8Array)
    || !(value.buffer instanceof ArrayBuffer)
  ) {
    return fail("encode-failed", "PNG encoder returned invalid storage.");
  }
  return value.slice().buffer as ArrayBuffer;
}

interface StructuralBlob {
  readonly type: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface StructuralCanvasContext {
  createImageData(width: number, height: number): {
    readonly data: Uint8ClampedArray;
  };
  putImageData(
    imageData: { readonly data: Uint8ClampedArray },
    x: number,
    y: number,
  ): void;
}

interface StructuralOffscreenCanvas {
  width: number;
  height: number;
  getContext(type: "2d"): StructuralCanvasContext | null;
  convertToBlob(options: { readonly type: "image/png" }): Promise<StructuralBlob>;
}

interface StructuralOffscreenCanvasConstructor {
  new (width: number, height: number): StructuralOffscreenCanvas;
}

/**
 * Product-owned Worker encoder. There is intentionally no silent main-thread
 * fallback: an unavailable or failing browser PNG codec rejects the operation.
 */
export async function encodeStudioLayerLiftRgbaPng(
  planeInput: Readonly<{
    readonly width: number;
    readonly height: number;
    readonly bytes: Uint8ClampedArray<ArrayBuffer>;
  }>,
  signal: AbortSignal | undefined,
): Promise<ArrayBuffer> {
  throwIfAborted(signal);
  const constructor = (
    globalThis as typeof globalThis & {
      readonly OffscreenCanvas?: StructuralOffscreenCanvasConstructor;
    }
  ).OffscreenCanvas;
  if (typeof constructor !== "function") {
    return fail(
      "encode-unavailable",
      "OffscreenCanvas PNG encoding is unavailable in this Worker.",
    );
  }
  const surface = new constructor(planeInput.width, planeInput.height);
  try {
    const context = surface.getContext("2d");
    if (!context) {
      return fail(
        "encode-unavailable",
        "OffscreenCanvas 2D context is unavailable in this Worker.",
      );
    }
    const imageData = context.createImageData(
      planeInput.width,
      planeInput.height,
    );
    imageData.data.set(planeInput.bytes);
    context.putImageData(imageData, 0, 0);
    const blob = await surface.convertToBlob({ type: "image/png" });
    throwIfAborted(signal);
    if (
      blob.type !== "image/png"
      || blob.size < 57
      || blob.size > STUDIO_LAYER_LIFT_COMPOSITOR_LIMITS.maximumPngBytes
    ) {
      return fail("encode-failed", "Browser PNG encoder returned an invalid blob.");
    }
    const bytes = await blob.arrayBuffer();
    throwIfAborted(signal);
    if (bytes.byteLength !== blob.size) {
      return fail("encode-failed", "Browser PNG blob changed while being read.");
    }
    return bytes;
  } catch (error) {
    if (error instanceof StudioLayerLiftCompositorError) throw error;
    return fail("encode-failed", "Browser PNG encoding failed.");
  } finally {
    surface.width = 1;
    surface.height = 1;
  }
}

function providerReceiptLayers(
  layers: readonly StudioLayerLiftCompositorProviderLayer[],
): readonly StudioLayerLiftCompositionProviderLayerProvenance[] {
  return Object.freeze(layers.map((layer) => Object.freeze({
    layerId: layer.layerId,
    role: layer.role,
    order: layer.order,
    rgba: Object.freeze({ sha256: layer.rgbaSha256 }),
    mask: Object.freeze({ sha256: layer.maskSha256 }),
  })));
}

/**
 * One-shot compositor authority for the local two-layer beta. Every output is
 * derived from the same owned source/mask snapshots admitted at function entry.
 */
export async function composeStudioLayerLiftBeta(
  rawInput: StudioLayerLiftCompositorInput,
  options: StudioLayerLiftCompositorOptions = {},
): Promise<StudioLayerLiftTrustedComposition> {
  throwIfAborted(options.signal);
  const input = admitStudioLayerLiftCompositorInput(rawInput);
  throwIfAborted(options.signal);
  const maskStatistics = scanMask(input.foregroundMask, input.sourceRgba);
  if (maskStatistics.selectedPixelCount === 0) {
    return fail("invalid-input", "Foreground mask does not select any pixels.");
  }
  const pixelCount = input.width * input.height;
  const budget = estimateBudgets(
    pixelCount,
    maskStatistics.selectedPixelCount,
  );

  const foregroundBytes = createForeground(
    input.sourceRgba,
    input.foregroundMask,
  );
  throwIfAborted(options.signal);
  // The fill kernel is used only by an explicit Layer Lift composition. Its tile search and
  // pixel helpers must remain outside the Studio page/client graph.
  const { contentAwareFillPixels } = await import("../studio-content-aware-fill");
  throwIfAborted(options.signal);
  const backgroundBytes = createBackground(
    input.sourceRgba,
    input.foregroundMask,
    input.width,
    input.height,
    input.fillTilePixels,
    contentAwareFillPixels,
  );
  throwIfAborted(options.signal);
  const backgroundRgba = plane(
    backgroundBytes,
    input.width,
    input.height,
  );
  const foregroundRgba = plane(
    foregroundBytes,
    input.width,
    input.height,
  );
  const removalMaskBytes = new Uint8Array(input.foregroundMask);
  const removalMask = maskPlane(
    removalMaskBytes,
    input.width,
    input.height,
  );
  const parity = calculateStudioLayerLiftCompositorParitySha256(
    input,
    backgroundRgba.sha256,
    foregroundRgba.sha256,
  );
  const diagnostics: StudioLayerLiftCompositorDiagnostics = Object.freeze({
    algorithm: STUDIO_LAYER_LIFT_COMPOSITOR_ALGORITHM,
    fillTilePixels: input.fillTilePixels,
    pixelCount,
    ...maskStatistics,
    ...budget,
    sourceRgbaSha256: input.sourceSha256,
    foregroundMaskSha256: input.foregroundMaskSha256,
    backgroundRgbaSha256: backgroundRgba.sha256,
    foregroundRgbaSha256: foregroundRgba.sha256,
    paritySha256: parity,
  });

  const encodePng = options.encodePng ?? encodeStudioLayerLiftRgbaPng;
  let encodedBackground: ArrayBuffer;
  let encodedForeground: ArrayBuffer;
  try {
    [encodedBackground, encodedForeground] = await Promise.all([
      encodePng({
        width: input.width,
        height: input.height,
        bytes: new Uint8ClampedArray(backgroundRgba.bytes),
      }, options.signal).then(snapshotEncodedPng),
      encodePng({
        width: input.width,
        height: input.height,
        bytes: new Uint8ClampedArray(foregroundRgba.bytes),
      }, options.signal).then(snapshotEncodedPng),
    ]);
  } catch (error) {
    if (error instanceof StudioLayerLiftCompositorError) throw error;
    if (options.signal?.aborted) {
      return fail("aborted", "Scene Layer Lift composition was aborted.");
    }
    return fail("encode-failed", "Layer Lift PNG encoding failed.");
  }
  throwIfAborted(options.signal);
  if (
    encodedBackground.byteLength
      > STUDIO_LAYER_LIFT_COMPOSITOR_LIMITS.maximumPngBytes
    || encodedForeground.byteLength
      > STUDIO_LAYER_LIFT_COMPOSITOR_LIMITS.maximumPngBytes
  ) {
    return fail("budget-exceeded", "Encoded PNG budget was exceeded.");
  }

  let artifacts: StudioLayerLiftTrustedArtifactPair;
  try {
    artifacts = await admitStudioLayerLiftArtifactPair({
      requestId: input.requestId,
      sourceId: input.sourceId,
      sourceWidth: input.width,
      sourceHeight: input.height,
      background: {
        outputId: input.backgroundOutputId,
        bytes: encodedBackground,
      },
      foreground: {
        outputId: input.foregroundOutputId,
        bytes: encodedForeground,
      },
    }, {
      signal: options.signal,
      ...(options.decodePngDimensions
        ? { decodePngDimensions: options.decodePngDimensions }
        : {}),
    });
  } catch (error) {
    if (
      error instanceof StudioLayerLiftArtifactError
      && error.code === "aborted"
    ) {
      return fail("aborted", "Scene Layer Lift composition was aborted.");
    }
    return fail(
      "artifact-invalid",
      "Encoded Layer Lift artifacts failed strict PNG admission.",
    );
  }
  throwIfAborted(options.signal);
  if (!isStudioLayerLiftTrustedArtifactPair(artifacts)) {
    return fail("artifact-invalid", "Layer Lift artifact trust was not established.");
  }

  const backgroundContributorLayerIds = input.providerLayers
    .filter((layer) => layer.layerId !== input.foregroundLayerId)
    .map((layer) => layer.layerId);
  const compositionReceipt = createStudioLayerLiftCompositionReceipt({
    requestId: input.requestId,
    sourceSha256: input.sourceSha256,
    providerReceiptSha256: input.providerReceiptSha256,
    providerLayers: providerReceiptLayers(input.providerLayers),
    compositor: {
      id: STUDIO_LAYER_LIFT_COMPOSITOR_ID,
      version: STUDIO_LAYER_LIFT_COMPOSITOR_VERSION,
    },
    background: {
      outputId: input.backgroundOutputId,
      artifactSha256: artifacts.background.sha256,
      contributorLayerIds: backgroundContributorLayerIds,
    },
    foreground: {
      outputId: input.foregroundOutputId,
      artifactSha256: artifacts.foreground.sha256,
      contributorLayerIds: [input.foregroundLayerId],
    },
  });
  if (!isTrustedStudioLayerLiftCompositionReceipt(compositionReceipt)) {
    return fail(
      "provenance-mismatch",
      "Layer Lift composition provenance trust was not established.",
    );
  }

  const result: StudioLayerLiftTrustedComposition = Object.freeze({
    requestId: input.requestId,
    sourceId: input.sourceId,
    width: input.width,
    height: input.height,
    backgroundRgba,
    foregroundRgba,
    removalMask,
    diagnostics,
    artifacts,
    compositionReceipt,
  });
  TRUSTED_RESULTS.add(result);
  return result;
}

export function isStudioLayerLiftTrustedComposition(
  value: unknown,
): value is StudioLayerLiftTrustedComposition {
  return (
    typeof value === "object"
    && value !== null
    && TRUSTED_RESULTS.has(value)
  );
}
