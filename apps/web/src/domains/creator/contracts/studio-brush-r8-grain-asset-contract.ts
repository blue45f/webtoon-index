/**
 * Persisted identity for one encoded paper-grain asset and its decoded R8 payload.
 *
 * This pure shared contract is consumed by both the browser renderer and the API admission
 * boundary. Binary data, URLs and resolver state deliberately stay outside it. The encoded hash
 * binds the stored PNG while the decoded hash binds the exact `width * height` bytes sampled by
 * Canvas/WebGPU/SVG renderers after decoding.
 */

export const STUDIO_BRUSH_R8_GRAIN_ASSET_LIMITS = Object.freeze({
  maxAssetIdLength: 160,
  maxDimension: 16_384,
  maxEncodedByteLength: 64 * 1_024 * 1_024,
  maxDecodedByteLength: 64 * 1_024 * 1_024,
});

export type StudioBrushR8GrainSha256 = `sha256:${string}`;
export type StudioBrushR8GrainAssetMediaType = "image/png";
export type StudioBrushR8GrainAssetChannel = "alpha" | "luminance";
export type StudioBrushR8GrainAssetEncoding = "r8-unorm";

export interface StudioBrushR8GrainAssetReference {
  /** Project/server lookup key. Content hashes remain the authoritative identities. */
  readonly assetId: string;
  /** Hash of the exact encoded PNG bytes admitted to durable asset storage. */
  readonly encodedSha256: StudioBrushR8GrainSha256;
  /** Hash of the exact tightly packed R8 bytes consumed by renderers. */
  readonly decodedSha256: StudioBrushR8GrainSha256;
  /** Encoded PNG byte length; decoded length is exactly `width * height`. */
  readonly byteLength: number;
  readonly mediaType: StudioBrushR8GrainAssetMediaType;
  readonly width: number;
  readonly height: number;
  readonly channel: StudioBrushR8GrainAssetChannel;
  readonly encoding: StudioBrushR8GrainAssetEncoding;
}

export interface StudioBrushR8TextureGrainSource {
  readonly kind: "r8-texture-v1";
  readonly asset: StudioBrushR8GrainAssetReference;
}

const SOURCE_KEYS = ["kind", "asset"] as const;
const ASSET_KEYS = [
  "assetId",
  "encodedSha256",
  "decodedSha256",
  "byteLength",
  "mediaType",
  "width",
  "height",
  "channel",
  "encoding",
] as const;
const SHA256_PATTERN = /^(?:sha256:)?([a-f0-9]{64})$/iu;
const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/iu;
const RESERVED_IDENTIFIERS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Accepts only a plain, exact-key, enumerable data record. Accessors, symbols, inherited data and
 * future/unknown fields are rejected without being evaluated.
 */
function strictDataRecord(
  value: unknown,
  exactKeys: readonly string[],
): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== exactKeys.length
      || ownKeys.some((key) => typeof key !== "string" || !exactKeys.includes(key))
      || exactKeys.some((key) => !ownKeys.includes(key))
    ) {
      return null;
    }
    for (const key of ownKeys) {
      if (typeof key !== "string") return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor
        || !("value" in descriptor)
        || descriptor.enumerable !== true
      ) {
        return null;
      }
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function canonicalSha256(value: unknown): StudioBrushR8GrainSha256 | null {
  if (typeof value !== "string") return null;
  const match = SHA256_PATTERN.exec(value);
  return match
    ? (`sha256:${match[1]!.toLowerCase()}` as StudioBrushR8GrainSha256)
    : null;
}

function validAssetId(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= STUDIO_BRUSH_R8_GRAIN_ASSET_LIMITS.maxAssetIdLength
    && value.trim() === value
    && ASSET_ID_PATTERN.test(value)
    && !RESERVED_IDENTIFIERS.has(value)
  );
}

function positiveSafeIntegerAtMost(value: unknown, maximum: number): value is number {
  return (
    typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0
    && value <= maximum
  );
}

/**
 * Strictly normalizes an immutable persisted reference. `null` is the fail-closed result for every
 * malformed, accessor-backed, over-budget or unknown-field candidate.
 */
export function normalizeStudioBrushR8GrainAssetReference(
  value: unknown,
): Readonly<StudioBrushR8GrainAssetReference> | null {
  const source = strictDataRecord(value, ASSET_KEYS);
  if (!source || !validAssetId(source.assetId)) return null;

  const encodedSha256 = canonicalSha256(source.encodedSha256);
  const decodedSha256 = canonicalSha256(source.decodedSha256);
  if (!encodedSha256 || !decodedSha256) return null;
  if (
    !positiveSafeIntegerAtMost(
      source.byteLength,
      STUDIO_BRUSH_R8_GRAIN_ASSET_LIMITS.maxEncodedByteLength,
    )
    || !positiveSafeIntegerAtMost(
      source.width,
      STUDIO_BRUSH_R8_GRAIN_ASSET_LIMITS.maxDimension,
    )
    || !positiveSafeIntegerAtMost(
      source.height,
      STUDIO_BRUSH_R8_GRAIN_ASSET_LIMITS.maxDimension,
    )
    || source.width * source.height
      > STUDIO_BRUSH_R8_GRAIN_ASSET_LIMITS.maxDecodedByteLength
    || source.mediaType !== "image/png"
    || (source.channel !== "alpha" && source.channel !== "luminance")
    || source.encoding !== "r8-unorm"
  ) {
    return null;
  }

  return Object.freeze({
    assetId: source.assetId,
    encodedSha256,
    decodedSha256,
    byteLength: source.byteLength,
    mediaType: "image/png",
    width: source.width,
    height: source.height,
    channel: source.channel,
    encoding: "r8-unorm",
  });
}

/**
 * Strictly normalizes the discriminated R8 source envelope. No procedural fallback is performed
 * here: callers can distinguish absence from a rejected external texture.
 */
export function normalizeStudioBrushR8TextureGrainSource(
  value: unknown,
): Readonly<StudioBrushR8TextureGrainSource> | null {
  const source = strictDataRecord(value, SOURCE_KEYS);
  if (!source || source.kind !== "r8-texture-v1") return null;
  const asset = normalizeStudioBrushR8GrainAssetReference(source.asset);
  return asset
    ? Object.freeze({ kind: "r8-texture-v1" as const, asset })
    : null;
}

/**
 * Stable JSON used by dirty checks, collaboration payload fingerprints and asset cache keys.
 * Invalid or poisoned candidates return `null` and never serialize attacker-controlled fields.
 */
export function serializeStudioBrushR8TextureGrainSourceCanonical(
  value: unknown,
): string | null {
  const normalized = normalizeStudioBrushR8TextureGrainSource(value);
  return normalized ? JSON.stringify(normalized) : null;
}
