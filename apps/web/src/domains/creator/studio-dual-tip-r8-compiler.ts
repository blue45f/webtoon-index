import { sha256HexPortable } from "./studio-sha256";

import type {
  StudioEngineWebGpuTexturedBrushAssetPayload,
} from "./render/studio-engine-webgpu-textured-brush-plan";

/**
 * Clean-room, worker-friendly compiler for a baked dual-tip mask.
 *
 * It implements the publicly documented behaviour that a secondary tip constrains or blends with
 * a primary tip. It does not read a vendor preset or claim the dynamic second-tip spacing/scatter
 * model; those remain a separate runtime provider capability.
 */
export const STUDIO_DUAL_TIP_R8_COMPILER_VERSION = 1 as const;

export const STUDIO_DUAL_TIP_R8_COMPILER_BUDGETS = Object.freeze({
  maxDimension: 16_384,
  maxPixels: 64 * 1024 * 1024,
  maxIdentifierCharacters: 128,
} as const);

export type StudioDualTipR8BlendMode =
  | "intersect"
  | "darken"
  | "lighten"
  | "add"
  | "subtract"
  | "difference"
  | "screen";

export interface StudioDualTipR8Source {
  readonly kind: "studio-r8-tip-source";
  readonly version: 1;
  readonly assetId: string;
  readonly contentHash: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
  readonly invert: boolean;
  readonly edgeMode: "transparent" | "repeat";
  /**
   * Source-normalized to output-normalized affine transform. Translation is expressed in output
   * normalized coordinates; pixel sampling uses inverse mapping at output pixel centres.
   */
  readonly transform: Readonly<{
    m11: number;
    m12: number;
    m21: number;
    m22: number;
    translateX: number;
    translateY: number;
  }>;
}

export interface StudioDualTipR8CompileRequest {
  readonly kind: "studio-dual-tip-r8-compile-request";
  readonly version: typeof STUDIO_DUAL_TIP_R8_COMPILER_VERSION;
  readonly outputAssetId: string;
  readonly width: number;
  readonly height: number;
  readonly mode: StudioDualTipR8BlendMode;
  readonly secondaryOpacity: number;
  readonly primary: StudioDualTipR8Source;
  readonly secondary: StudioDualTipR8Source;
}

export interface StudioDualTipR8CompileOptions {
  readonly maximumPixels?: number;
  readonly signal?: AbortSignal;
  readonly shouldCancel?: (progress: Readonly<{
    completedRows: number;
    totalRows: number;
  }>) => boolean;
}

export type StudioDualTipR8CompileResult =
  | Readonly<{
      status: "compiled";
      kind: "studio-dual-tip-r8-asset";
      version: typeof STUDIO_DUAL_TIP_R8_COMPILER_VERSION;
      assetId: string;
      width: number;
      height: number;
      format: "r8-unorm";
      byteLength: number;
      bytes: Uint8Array;
      contentHash: string;
      recipeFingerprint: string;
      mode: StudioDualTipR8BlendMode;
    }>
  | Readonly<{
      status: "rejected";
      reason:
        | "invalid-request"
        | "invalid-options"
        | "source-content-hash-mismatch"
        | "pixel-budget-exceeded"
        | "singular-transform";
      path?: string;
    }>
  | Readonly<{
      status: "cancelled";
      completedRows: number;
      totalRows: number;
    }>;

export type StudioDualTipR8TexturedAssetAdaptationResult =
  | Readonly<{
      status: "ready";
      payload: StudioEngineWebGpuTexturedBrushAssetPayload;
      recipeFingerprint: string;
    }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-compiled-asset" | "content-hash-mismatch";
    }>;

interface ParsedSource {
  readonly assetId: string;
  readonly contentHash: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
  readonly invert: boolean;
  readonly edgeMode: "transparent" | "repeat";
  readonly inverse: readonly [number, number, number, number, number, number];
  readonly transformTuple: readonly [number, number, number, number, number, number];
}

const REQUEST_KEYS = [
  "kind",
  "version",
  "outputAssetId",
  "width",
  "height",
  "mode",
  "secondaryOpacity",
  "primary",
  "secondary",
] as const;
const SOURCE_KEYS = [
  "kind",
  "version",
  "assetId",
  "contentHash",
  "width",
  "height",
  "bytes",
  "invert",
  "edgeMode",
  "transform",
] as const;
const TRANSFORM_KEYS = [
  "m11",
  "m12",
  "m21",
  "m22",
  "translateX",
  "translateY",
] as const;
const OPTION_KEYS = ["maximumPixels", "signal", "shouldCancel"] as const;
const COMPILED_ASSET_KEYS = [
  "status",
  "kind",
  "version",
  "assetId",
  "width",
  "height",
  "format",
  "byteLength",
  "bytes",
  "contentHash",
  "recipeFingerprint",
  "mode",
] as const;
const MODES: readonly StudioDualTipR8BlendMode[] = [
  "intersect",
  "darken",
  "lighten",
  "add",
  "subtract",
  "difference",
  "screen",
];

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function identifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= STUDIO_DUAL_TIP_R8_COMPILER_BUDGETS.maxIdentifierCharacters
    && /^[A-Za-z0-9._:/+~-]+$/u.test(value);
}

function contentHash(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function exactDataRecord(
  input: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | null {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length
      || keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
    ) return null;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (
        !descriptor
        || descriptor.enumerable !== true
        || !Object.prototype.hasOwnProperty.call(descriptor, "value")
      ) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function optionalDataRecord(
  input: unknown,
  allowedKeys: readonly string[],
): Readonly<Record<string, unknown>> | null {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key))
    ) return null;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (
        !descriptor
        || descriptor.enumerable !== true
        || !Object.prototype.hasOwnProperty.call(descriptor, "value")
      ) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function parseSource(
  input: unknown,
  path: "$.primary" | "$.secondary",
): ParsedSource | Readonly<{ error: "invalid-request" | "singular-transform"; path: string }> {
  const source = exactDataRecord(input, SOURCE_KEYS);
  if (
    !source
    || source.kind !== "studio-r8-tip-source"
    || source.version !== 1
    || !identifier(source.assetId)
    || !contentHash(source.contentHash)
    || !positiveSafeInteger(source.width)
    || !positiveSafeInteger(source.height)
    || source.width > STUDIO_DUAL_TIP_R8_COMPILER_BUDGETS.maxDimension
    || source.height > STUDIO_DUAL_TIP_R8_COMPILER_BUDGETS.maxDimension
    || !(source.bytes instanceof Uint8Array)
    || Object.getPrototypeOf(source.bytes) !== Uint8Array.prototype
    || source.bytes.byteLength !== source.width * source.height
    || typeof source.invert !== "boolean"
    || (source.edgeMode !== "transparent" && source.edgeMode !== "repeat")
  ) return { error: "invalid-request", path };
  if (
    typeof SharedArrayBuffer !== "undefined"
    && source.bytes.buffer instanceof SharedArrayBuffer
  ) return { error: "invalid-request", path: `${path}.bytes` };
  const transform = exactDataRecord(source.transform, TRANSFORM_KEYS);
  if (
    !transform
    || ![
      transform.m11,
      transform.m12,
      transform.m21,
      transform.m22,
      transform.translateX,
      transform.translateY,
    ].every((value) => finite(value) && Math.abs(value) <= 1_000_000)
  ) return { error: "invalid-request", path: `${path}.transform` };
  const m11 = transform.m11 as number;
  const m12 = transform.m12 as number;
  const m21 = transform.m21 as number;
  const m22 = transform.m22 as number;
  const translateX = transform.translateX as number;
  const translateY = transform.translateY as number;
  const determinant = m11 * m22 - m21 * m12;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    return { error: "singular-transform", path: `${path}.transform` };
  }
  const inverseM11 = m22 / determinant;
  const inverseM12 = -m12 / determinant;
  const inverseM21 = -m21 / determinant;
  const inverseM22 = m11 / determinant;
  return Object.freeze({
    assetId: source.assetId,
    contentHash: source.contentHash,
    width: source.width,
    height: source.height,
    bytes: new Uint8Array(source.bytes),
    invert: source.invert,
    edgeMode: source.edgeMode,
    inverse: Object.freeze([
      inverseM11,
      inverseM12,
      inverseM21,
      inverseM22,
      -(inverseM11 * translateX + inverseM21 * translateY),
      -(inverseM12 * translateX + inverseM22 * translateY),
    ] as const),
    transformTuple: Object.freeze([
      m11,
      m12,
      m21,
      m22,
      translateX,
      translateY,
    ] as const),
  });
}

function wrap(value: number): number {
  return value - Math.floor(value);
}

function texel(
  source: ParsedSource,
  x: number,
  y: number,
): number {
  let sourceX = x;
  let sourceY = y;
  if (source.edgeMode === "repeat") {
    sourceX = ((sourceX % source.width) + source.width) % source.width;
    sourceY = ((sourceY % source.height) + source.height) % source.height;
  } else if (
    sourceX < 0
    || sourceY < 0
    || sourceX >= source.width
    || sourceY >= source.height
  ) return 0;
  const ix = Math.max(0, Math.min(source.width - 1, sourceX));
  const iy = Math.max(0, Math.min(source.height - 1, sourceY));
  const value = source.bytes[iy * source.width + ix]! / 255;
  return source.invert ? 1 - value : value;
}

function sampleBilinear(source: ParsedSource, outputU: number, outputV: number): number {
  const inverse = source.inverse;
  let sourceU = inverse[0] * outputU + inverse[2] * outputV + inverse[4];
  let sourceV = inverse[1] * outputU + inverse[3] * outputV + inverse[5];
  if (source.edgeMode === "repeat") {
    sourceU = wrap(sourceU);
    sourceV = wrap(sourceV);
  } else if (sourceU < 0 || sourceV < 0 || sourceU > 1 || sourceV > 1) {
    return 0;
  }
  // Pixel-centre convention: normalized edges lie half a texel outside the first/last centres.
  const x = sourceU * source.width - 0.5;
  const y = sourceV * source.height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const amountX = x - x0;
  const amountY = y - y0;
  const top = texel(source, x0, y0) * (1 - amountX)
    + texel(source, x0 + 1, y0) * amountX;
  const bottom = texel(source, x0, y0 + 1) * (1 - amountX)
    + texel(source, x0 + 1, y0 + 1) * amountX;
  return top * (1 - amountY) + bottom * amountY;
}

function blend(mode: StudioDualTipR8BlendMode, primary: number, secondary: number): number {
  switch (mode) {
    case "intersect":
      return primary * secondary;
    case "darken":
      return Math.min(primary, secondary);
    case "lighten":
      return Math.max(primary, secondary);
    case "add":
      return Math.min(1, primary + secondary);
    case "subtract":
      return Math.max(0, primary - secondary);
    case "difference":
      return Math.abs(primary - secondary);
    case "screen":
      return 1 - (1 - primary) * (1 - secondary);
  }
}

function recipeFingerprint(
  request: Readonly<{
    outputAssetId: string;
    width: number;
    height: number;
    mode: StudioDualTipR8BlendMode;
    secondaryOpacity: number;
    primary: ParsedSource;
    secondary: ParsedSource;
  }>,
): string {
  const values = [
    "studio-dual-tip-r8-v1",
    request.outputAssetId,
    request.width,
    request.height,
    request.mode,
    request.secondaryOpacity,
    request.primary.assetId,
    request.primary.contentHash,
    request.primary.width,
    request.primary.height,
    request.primary.edgeMode,
    request.primary.invert ? 1 : 0,
    ...request.primary.transformTuple,
    request.secondary.assetId,
    request.secondary.contentHash,
    request.secondary.width,
    request.secondary.height,
    request.secondary.edgeMode,
    request.secondary.invert ? 1 : 0,
    ...request.secondary.transformTuple,
  ].join("|");
  return `sha256:${sha256HexPortable(new TextEncoder().encode(values))}`;
}

export function compileStudioDualTipR8(
  requestInput: unknown,
  optionsInput: StudioDualTipR8CompileOptions = {},
): StudioDualTipR8CompileResult {
  const request = exactDataRecord(requestInput, REQUEST_KEYS);
  const options = optionalDataRecord(optionsInput, OPTION_KEYS);
  if (!request) return Object.freeze({ status: "rejected", reason: "invalid-request" });
  if (!options) return Object.freeze({ status: "rejected", reason: "invalid-options" });
  if (
    request.kind !== "studio-dual-tip-r8-compile-request"
    || request.version !== STUDIO_DUAL_TIP_R8_COMPILER_VERSION
    || !identifier(request.outputAssetId)
    || !positiveSafeInteger(request.width)
    || !positiveSafeInteger(request.height)
    || request.width > STUDIO_DUAL_TIP_R8_COMPILER_BUDGETS.maxDimension
    || request.height > STUDIO_DUAL_TIP_R8_COMPILER_BUDGETS.maxDimension
    || !MODES.includes(request.mode as StudioDualTipR8BlendMode)
    || !finite(request.secondaryOpacity)
    || request.secondaryOpacity < 0
    || request.secondaryOpacity > 1
  ) return Object.freeze({ status: "rejected", reason: "invalid-request" });
  const maximumPixels = options.maximumPixels
    ?? STUDIO_DUAL_TIP_R8_COMPILER_BUDGETS.maxPixels;
  if (
    !positiveSafeInteger(maximumPixels)
    || maximumPixels > STUDIO_DUAL_TIP_R8_COMPILER_BUDGETS.maxPixels
    || (
      options.signal !== undefined
      && (
        typeof AbortSignal === "undefined"
        || !(options.signal instanceof AbortSignal)
      )
    )
    || (
      options.shouldCancel !== undefined
      && typeof options.shouldCancel !== "function"
    )
  ) return Object.freeze({ status: "rejected", reason: "invalid-options" });
  const pixelCount = request.width * request.height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > maximumPixels) {
    return Object.freeze({ status: "rejected", reason: "pixel-budget-exceeded" });
  }
  const primary = parseSource(request.primary, "$.primary");
  if ("error" in primary) {
    return Object.freeze({ status: "rejected", reason: primary.error, path: primary.path });
  }
  const secondary = parseSource(request.secondary, "$.secondary");
  if ("error" in secondary) {
    return Object.freeze({ status: "rejected", reason: secondary.error, path: secondary.path });
  }
  if (
    primary.contentHash !== `sha256:${sha256HexPortable(primary.bytes)}`
    || secondary.contentHash !== `sha256:${sha256HexPortable(secondary.bytes)}`
  ) {
    return Object.freeze({
      status: "rejected",
      reason: "source-content-hash-mismatch",
    });
  }
  const parsed = Object.freeze({
    outputAssetId: request.outputAssetId as string,
    width: request.width as number,
    height: request.height as number,
    mode: request.mode as StudioDualTipR8BlendMode,
    secondaryOpacity: request.secondaryOpacity as number,
    primary,
    secondary,
  });
  const bytes = new Uint8Array(pixelCount);
  for (let y = 0; y < parsed.height; y += 1) {
    let cancelled = options.signal?.aborted === true;
    if (!cancelled) {
      try {
        cancelled = options.shouldCancel?.(Object.freeze({
          completedRows: y,
          totalRows: parsed.height,
        })) === true;
      } catch {
        cancelled = true;
      }
    }
    if (cancelled) {
      return Object.freeze({
        status: "cancelled",
        completedRows: y,
        totalRows: parsed.height,
      });
    }
    const outputV = (y + 0.5) / parsed.height;
    for (let x = 0; x < parsed.width; x += 1) {
      const outputU = (x + 0.5) / parsed.width;
      const primaryValue = sampleBilinear(primary, outputU, outputV);
      const secondaryValue = sampleBilinear(secondary, outputU, outputV);
      const combined = blend(parsed.mode, primaryValue, secondaryValue);
      const value = primaryValue
        + (combined - primaryValue) * parsed.secondaryOpacity;
      bytes[y * parsed.width + x] = Math.max(0, Math.min(255, Math.round(value * 255)));
    }
  }
  const content = `sha256:${sha256HexPortable(bytes)}`;
  return Object.freeze({
    status: "compiled",
    kind: "studio-dual-tip-r8-asset",
    version: STUDIO_DUAL_TIP_R8_COMPILER_VERSION,
    assetId: parsed.outputAssetId,
    width: parsed.width,
    height: parsed.height,
    format: "r8-unorm",
    byteLength: bytes.byteLength,
    bytes,
    contentHash: content,
    recipeFingerprint: recipeFingerprint(parsed),
    mode: parsed.mode,
  });
}

/**
 * Produces the exact payload accepted by the content-addressed textured-brush resolver. The bytes
 * are detached again so mutating a compile result after adaptation cannot change an in-flight
 * resolver response.
 */
export function adaptStudioDualTipR8ToTexturedBrushAsset(
  input: unknown,
): StudioDualTipR8TexturedAssetAdaptationResult {
  const value = exactDataRecord(input, COMPILED_ASSET_KEYS);
  if (
    !value
    || value.status !== "compiled"
    || value.kind !== "studio-dual-tip-r8-asset"
    || value.version !== STUDIO_DUAL_TIP_R8_COMPILER_VERSION
    || !identifier(value.assetId)
    || !positiveSafeInteger(value.width)
    || !positiveSafeInteger(value.height)
    || value.width > STUDIO_DUAL_TIP_R8_COMPILER_BUDGETS.maxDimension
    || value.height > STUDIO_DUAL_TIP_R8_COMPILER_BUDGETS.maxDimension
    || value.format !== "r8-unorm"
    || !positiveSafeInteger(value.byteLength)
    || value.byteLength !== value.width * value.height
    || !(value.bytes instanceof Uint8Array)
    || Object.getPrototypeOf(value.bytes) !== Uint8Array.prototype
    || value.bytes.byteLength !== value.byteLength
    || !contentHash(value.contentHash)
    || !contentHash(value.recipeFingerprint)
    || !MODES.includes(value.mode as StudioDualTipR8BlendMode)
    || (
      typeof SharedArrayBuffer !== "undefined"
      && value.bytes.buffer instanceof SharedArrayBuffer
    )
  ) return Object.freeze({ status: "rejected", reason: "invalid-compiled-asset" });
  const bytes = new Uint8Array(value.bytes);
  if (value.contentHash !== `sha256:${sha256HexPortable(bytes)}`) {
    return Object.freeze({ status: "rejected", reason: "content-hash-mismatch" });
  }
  const payload: StudioEngineWebGpuTexturedBrushAssetPayload = Object.freeze({
    kind: "studio-textured-brush-r8-asset",
    version: 1,
    assetId: value.assetId,
    contentHash: value.contentHash,
    width: value.width,
    height: value.height,
    channel: "alpha",
    format: "r8-unorm",
    byteLength: bytes.byteLength,
    bytes,
  });
  return Object.freeze({
    status: "ready",
    payload,
    recipeFingerprint: value.recipeFingerprint,
  });
}
