/**
 * Renderer-neutral handoff from a completed Studio background-3D capture to an AI Method
 * reference. The creator deliberately owns no renderer, scene, provider, DOM, or network state.
 *
 * Only a bounded, fragment-free PNG data URL crosses this boundary. The creator verifies the
 * canonical base64 shape, decoded byte budget, PNG signature/IHDR, declared dimensions, and
 * capture identity before returning an immutable DTO.
 */

export const STUDIO_BG3D_AI_METHOD_REFERENCE_CAPTURE_VERSION = 1 as const;

export const STUDIO_BG3D_AI_METHOD_REFERENCE_CAPTURE_LIMITS = Object.freeze({
  maximumAxisPixels: 4_096,
  maximumPixels: 16_777_216,
  /** Matches Studio's per-image browser admission budget for paid AI references. */
  maximumDecodedPngBytes: 12 * 1_024 * 1_024,
  maximumShotIdCharacters: 80,
  maximumCaptureIdentityCharacters: 160,
} as const);

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
const SHOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;
const CAPTURE_IDENTITY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,159}$/u;

export const STUDIO_BG3D_AI_METHOD_REFERENCE_CAPTURE_MAX_DATA_URL_CODE_UNITS =
  PNG_DATA_URL_PREFIX.length
  + Math.ceil(
    STUDIO_BG3D_AI_METHOD_REFERENCE_CAPTURE_LIMITS.maximumDecodedPngBytes / 3,
  ) * 4;

export type StudioBg3dAiMethodReferencePngDataUrl =
  `data:image/png;base64,${string}`;
export type StudioBg3dAiMethodReferenceSceneDigest = `sha256:${string}`;

export interface StudioBg3dAiMethodReferenceCaptureIdentity {
  readonly backend: string;
  readonly engineId: string;
  readonly engineVersion: string;
  readonly implementationRevision: string;
  readonly graphicsApi: "webgl2" | "webgpu";
  readonly profileId: string;
}

export interface CreateStudioBg3dAiMethodReferenceCaptureInput {
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
  readonly captureIdentity: StudioBg3dAiMethodReferenceCaptureIdentity;
  readonly sceneDigest?: StudioBg3dAiMethodReferenceSceneDigest;
  readonly shotId?: string;
}

export interface StudioBg3dAiMethodReferenceCapture {
  readonly version: typeof STUDIO_BG3D_AI_METHOD_REFERENCE_CAPTURE_VERSION;
  readonly sourceKind: "bg3d";
  readonly dataUrl: StudioBg3dAiMethodReferencePngDataUrl;
  readonly width: number;
  readonly height: number;
  readonly captureIdentity: Readonly<StudioBg3dAiMethodReferenceCaptureIdentity>;
  readonly sceneDigest?: StudioBg3dAiMethodReferenceSceneDigest;
  readonly shotId?: string;
  readonly suggestedRole: "method";
}

const INPUT_REQUIRED_KEYS = Object.freeze([
  "dataUrl",
  "width",
  "height",
  "captureIdentity",
] as const);
const INPUT_OPTIONAL_KEYS = Object.freeze(["sceneDigest", "shotId"] as const);
const CAPTURE_IDENTITY_KEYS = Object.freeze([
  "backend",
  "engineId",
  "engineVersion",
  "implementationRevision",
  "graphicsApi",
  "profileId",
] as const);

function invalidType(message: string): never {
  throw new TypeError(`studio-bg3d-ai-method-reference: ${message}`);
}

function invalidRange(message: string): never {
  throw new RangeError(`studio-bg3d-ai-method-reference: ${message}`);
}

/**
 * Copies only enumerable own data properties. Accessor-bearing or exotic objects are rejected so
 * validation cannot accidentally preserve a live renderer object or invoke a caller-owned getter.
 */
function copyPlainDataRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidType(`${label} must be a plain data object.`);
  }
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return invalidType(`${label} could not be inspected safely.`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidType(`${label} must be a plain data object.`);
  }

  const copy: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string") {
      return invalidType(`${label} contains an unsupported property key.`);
    }
    const descriptor = descriptors[key];
    if (
      descriptor === undefined
      || !descriptor.enumerable
      || !("value" in descriptor)
      || descriptor.get !== undefined
      || descriptor.set !== undefined
    ) {
      return invalidType(`${label}.${key} must be an enumerable data property.`);
    }
    copy[key] = descriptor.value;
  }
  return copy;
}

function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
    || keys.some((key) => !allowed.has(key))
  ) {
    invalidType(`${label} has missing or unknown properties.`);
  }
}

function base64Value(code: number): number {
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26;
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52;
  if (code === 0x2b) return 62;
  if (code === 0x2f) return 63;
  return -1;
}

interface InspectedBase64 {
  readonly decodedByteLength: number;
  readonly prefix: Uint8Array;
}

function inspectCanonicalBase64(payload: string): InspectedBase64 {
  if (payload.length < 32 || payload.length % 4 !== 0) {
    return invalidType("PNG data URL contains malformed base64.");
  }
  const padding = payload.endsWith("==")
    ? 2
    : payload.endsWith("=")
      ? 1
      : 0;
  const contentLength = payload.length - padding;
  if (
    contentLength % 4 !== (padding === 0 ? 0 : padding === 1 ? 3 : 2)
  ) {
    return invalidType("PNG data URL contains malformed base64 padding.");
  }

  for (let index = 0; index < contentLength; index += 1) {
    if (base64Value(payload.charCodeAt(index)) < 0) {
      return invalidType("PNG data URL contains non-base64 characters.");
    }
  }
  for (let index = contentLength; index < payload.length; index += 1) {
    if (payload.charCodeAt(index) !== 0x3d) {
      return invalidType("PNG data URL contains malformed base64 padding.");
    }
  }

  // Reject non-canonical encodings with non-zero unused bits in the final quartet.
  const finalValue = base64Value(payload.charCodeAt(contentLength - 1));
  if (
    finalValue < 0
    || (padding === 2 && (finalValue & 0x0f) !== 0)
    || (padding === 1 && (finalValue & 0x03) !== 0)
  ) {
    return invalidType("PNG data URL contains non-canonical base64.");
  }

  const decodedByteLength = (payload.length / 4) * 3 - padding;
  if (!Number.isSafeInteger(decodedByteLength) || decodedByteLength < 24) {
    return invalidType("PNG data URL is too short to contain a PNG header.");
  }
  if (
    decodedByteLength
    > STUDIO_BG3D_AI_METHOD_REFERENCE_CAPTURE_LIMITS.maximumDecodedPngBytes
  ) {
    return invalidRange("decoded PNG exceeds the per-reference byte budget.");
  }

  // The first 32 base64 characters encode exactly the 24 bytes needed for signature + IHDR size.
  const prefix = new Uint8Array(24);
  let writeOffset = 0;
  for (let offset = 0; offset < 32; offset += 4) {
    const first = base64Value(payload.charCodeAt(offset));
    const second = base64Value(payload.charCodeAt(offset + 1));
    const third = base64Value(payload.charCodeAt(offset + 2));
    const fourth = base64Value(payload.charCodeAt(offset + 3));
    if (first < 0 || second < 0 || third < 0 || fourth < 0) {
      return invalidType("PNG header base64 could not be decoded.");
    }
    prefix[writeOffset] = (first << 2) | (second >> 4);
    prefix[writeOffset + 1] = ((second & 0x0f) << 4) | (third >> 2);
    prefix[writeOffset + 2] = ((third & 0x03) << 6) | fourth;
    writeOffset += 3;
  }
  return { decodedByteLength, prefix };
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) * 0x1_000000
    + (bytes[offset + 1] ?? 0) * 0x1_0000
    + (bytes[offset + 2] ?? 0) * 0x100
    + (bytes[offset + 3] ?? 0)
  );
}

function validatePngDataUrl(
  value: unknown,
  width: number,
  height: number,
): StudioBg3dAiMethodReferencePngDataUrl {
  if (typeof value !== "string") {
    return invalidType("dataUrl must be a PNG data URL string.");
  }
  if (value.includes("#")) {
    return invalidType("PNG data URL fragments are not allowed.");
  }
  if (!value.startsWith(PNG_DATA_URL_PREFIX)) {
    return invalidType("dataUrl must use the exact PNG base64 data URL prefix.");
  }
  if (
    value.length
    > STUDIO_BG3D_AI_METHOD_REFERENCE_CAPTURE_MAX_DATA_URL_CODE_UNITS
  ) {
    return invalidRange("PNG data URL exceeds the encoded character budget.");
  }

  const payload = value.slice(PNG_DATA_URL_PREFIX.length);
  const { prefix } = inspectCanonicalBase64(payload);
  if (
    PNG_SIGNATURE.some((byte, index) => prefix[index] !== byte)
    || readUint32Be(prefix, 8) !== 13
    || prefix[12] !== 0x49
    || prefix[13] !== 0x48
    || prefix[14] !== 0x44
    || prefix[15] !== 0x52
  ) {
    return invalidType("decoded bytes do not contain a PNG signature and IHDR.");
  }
  if (
    readUint32Be(prefix, 16) !== width
    || readUint32Be(prefix, 20) !== height
  ) {
    return invalidType("PNG IHDR dimensions do not match width and height.");
  }
  return value as StudioBg3dAiMethodReferencePngDataUrl;
}

function validateDimension(value: unknown, label: "width" | "height"): number {
  if (!Number.isSafeInteger(value)) {
    return invalidType(`${label} must be a positive safe integer.`);
  }
  const dimension = value as number;
  if (
    dimension < 1
    || dimension
      > STUDIO_BG3D_AI_METHOD_REFERENCE_CAPTURE_LIMITS.maximumAxisPixels
  ) {
    return invalidRange(`${label} exceeds the capture axis budget.`);
  }
  return dimension;
}

function validateCaptureIdentity(
  value: unknown,
): Readonly<StudioBg3dAiMethodReferenceCaptureIdentity> {
  const identity = copyPlainDataRecord(value, "captureIdentity");
  assertExactKeys(identity, CAPTURE_IDENTITY_KEYS, [], "captureIdentity");
  for (const key of [
    "backend",
    "engineId",
    "engineVersion",
    "implementationRevision",
    "profileId",
  ] as const) {
    if (
      typeof identity[key] !== "string"
      || !CAPTURE_IDENTITY_PATTERN.test(identity[key])
    ) {
      return invalidType(`captureIdentity.${key} is invalid.`);
    }
  }
  if (identity.graphicsApi !== "webgl2" && identity.graphicsApi !== "webgpu") {
    return invalidType("captureIdentity.graphicsApi is invalid.");
  }
  return Object.freeze({
    backend: identity.backend,
    engineId: identity.engineId,
    engineVersion: identity.engineVersion,
    implementationRevision: identity.implementationRevision,
    graphicsApi: identity.graphicsApi,
    profileId: identity.profileId,
  }) as Readonly<StudioBg3dAiMethodReferenceCaptureIdentity>;
}

/**
 * Creates one immutable AI Method-reference suggestion from a completed background-3D capture.
 *
 * Throws `TypeError` for malformed or inconsistent data and `RangeError` for bounded resource
 * limits. The returned object owns a frozen copy of capture identity metadata.
 */
export function createStudioBg3dAiMethodReferenceCapture(
  input: CreateStudioBg3dAiMethodReferenceCaptureInput,
): Readonly<StudioBg3dAiMethodReferenceCapture> {
  const candidate = copyPlainDataRecord(input, "input");
  assertExactKeys(candidate, INPUT_REQUIRED_KEYS, INPUT_OPTIONAL_KEYS, "input");

  const width = validateDimension(candidate.width, "width");
  const height = validateDimension(candidate.height, "height");
  const pixelCount = width * height;
  if (
    !Number.isSafeInteger(pixelCount)
    || pixelCount
      > STUDIO_BG3D_AI_METHOD_REFERENCE_CAPTURE_LIMITS.maximumPixels
  ) {
    return invalidRange("capture exceeds the pixel budget.");
  }

  const dataUrl = validatePngDataUrl(candidate.dataUrl, width, height);
  const captureIdentity = validateCaptureIdentity(candidate.captureIdentity);

  const sceneDigest = candidate.sceneDigest;
  if (
    sceneDigest !== undefined
    && (
      typeof sceneDigest !== "string"
      || !SHA256_PATTERN.test(sceneDigest)
    )
  ) {
    return invalidType("sceneDigest must be a canonical sha256 digest.");
  }
  const shotId = candidate.shotId;
  if (
    shotId !== undefined
    && (
      typeof shotId !== "string"
      || shotId.length
        > STUDIO_BG3D_AI_METHOD_REFERENCE_CAPTURE_LIMITS
          .maximumShotIdCharacters
      || !SHOT_ID_PATTERN.test(shotId)
    )
  ) {
    return invalidType("shotId is invalid.");
  }

  return Object.freeze({
    version: STUDIO_BG3D_AI_METHOD_REFERENCE_CAPTURE_VERSION,
    sourceKind: "bg3d",
    dataUrl,
    width,
    height,
    captureIdentity,
    ...(sceneDigest !== undefined
      ? {
          sceneDigest:
            sceneDigest as StudioBg3dAiMethodReferenceSceneDigest,
        }
      : {}),
    ...(shotId !== undefined ? { shotId } : {}),
    suggestedRole: "method",
  });
}
